import { Context, Effect, Either, Layer, Schema } from "effect";
import { DomainError, GrantSpec } from "@plinth/spec";
import { PlinthClock } from "./clock";
import { ControlStore, store } from "./control-store";
import type { StoreError } from "./errors";
import type { Principal } from "./identity";
import {
  authorize as authorizePure,
  canonicalResource,
  checkApprover,
  grantFromBody,
  type Allow,
  type AuthzSnapshot,
  type AuthzSubject,
  type Decision,
  type Deny,
  type GrantRec,
  type HeldChangeFacts,
  type RoleMembership,
} from "./authz-core";

/**
 * The one `Authorizer` service (spec 03 section 4). Every surface asks it: the HTTP API, the MCP server, the query
 * engine, the change log. It loads a snapshot of the grant index and calls the pure `authorize`.
 */
export interface AuthorizerShape {
  readonly snapshot: (
    p: Pick<Principal, "workspaceId" | "workspaceSlug">,
  ) => Effect.Effect<AuthzSnapshot, StoreError>;
  /** `resource` is a node URI (UUID or slug form), a URI prefix ending in `/`, or a source slug. */
  readonly authorize: (
    principal: Principal,
    action: string,
    resource: string,
    context?: { readonly dashboard?: string | undefined; readonly owner?: string | undefined },
  ) => Effect.Effect<Decision, StoreError>;
  /** As `authorize`, with a deny turned into `FORBIDDEN` naming the permission. */
  readonly require: (
    principal: Principal,
    action: string,
    resource: string,
    context?: { readonly dashboard?: string | undefined; readonly owner?: string | undefined },
  ) => Effect.Effect<Allow, StoreError | DomainError>;
  readonly checkApprover: (
    approver: Principal,
    held: HeldChangeFacts,
  ) => Effect.Effect<Deny | undefined, StoreError>;
}

export class Authorizer extends Context.Tag("plinth/Authorizer")<Authorizer, AuthorizerShape>() {}

export const subjectOf = (p: Principal): AuthzSubject => ({
  subject: p.subject,
  kind: p.kind,
  delegatorSubject: p.delegatorSubject,
  ceiling: p.ceiling ?? null,
  tokenScope: p.tokenScope ?? null,
});

export const forbidden = (d: Deny, resource: string): DomainError =>
  new DomainError({
    code: "FORBIDDEN",
    path: "",
    message:
      d.permission !== undefined
        ? `denied: missing permission ${d.permission} (${d.reason})`
        : `denied: ${d.reason}`,
    expected:
      d.permission !== undefined ? `the ${d.permission} permission on this resource` : "a granted permission",
    details: {
      reason: d.reason,
      policy: d.policy,
      ...(d.permission ? { permission: d.permission } : {}),
      resource,
    },
    fix_hint: "Do not retry. Report the missing permission to a person.",
    retryable: false,
  });

export const AuthorizerLive = Layer.effect(
  Authorizer,
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const clock = yield* PlinthClock;

    const snapshot: AuthorizerShape["snapshot"] = (p) =>
      Effect.gen(function* () {
        const rows = yield* store(
          sql<{ node_id: string; body: { spec?: unknown }; updated_seq: string }>`
            SELECT node_id, body, updated_seq FROM nodes
            WHERE workspace_id = ${p.workspaceId} AND kind = 'Grant' AND deleted_at IS NULL`,
        );
        const ws = yield* store(
          sql<{ grant_index_version: string; mask_version: number }>`
            SELECT grant_index_version, mask_version FROM workspaces WHERE workspace_id = ${p.workspaceId}`,
        );
        const roleRows = yield* store(
          sql<{ slug: string; body: { spec?: unknown } }>`
            SELECT slug, body FROM nodes
            WHERE workspace_id = ${p.workspaceId} AND kind = 'Role' AND deleted_at IS NULL`,
        );
        const roleMembers = new Map<string, RoleMembership[]>();
        for (const r of roleRows) {
          const members = (
            r.body.spec as { members?: Array<{ subject?: string; scope?: { region?: string } }> }
          )?.members;
          for (const m of members ?? []) {
            if (typeof m.subject !== "string") continue;
            const list = roleMembers.get(m.subject) ?? [];
            list.push({ role: r.slug, region: m.scope?.region ?? null });
            roleMembers.set(m.subject, list);
          }
        }
        const now = yield* clock.virtualNow;
        const base = { workspaceId: p.workspaceId, workspaceSlug: p.workspaceSlug };
        const grants: GrantRec[] = [];
        for (const r of rows) {
          const spec = Schema.decodeUnknownEither(GrantSpec)(r.body.spec);
          if (Either.isRight(spec))
            grants.push(grantFromBody(base, r.node_id, Number(r.updated_seq), spec.right));
        }
        return {
          ...base,
          grants,
          roleMembers,
          grantIndexVersion: Number(ws[0]?.grant_index_version ?? 0),
          maskVersion: Number(ws[0]?.mask_version ?? 0),
          now,
        } satisfies AuthzSnapshot;
      });

    const authorize: AuthorizerShape["authorize"] = (principal, action, resource, context) =>
      snapshot(principal).pipe(
        Effect.map((snap) =>
          authorizePure(
            {
              principal: subjectOf(principal),
              action,
              resource: canonicalResource(snap, resource),
              context:
                context?.dashboard || context?.owner
                  ? {
                      ...(context.dashboard ? { dashboard: canonicalResource(snap, context.dashboard) } : {}),
                      ...(context.owner ? { owner: context.owner } : {}),
                    }
                  : undefined,
            },
            snap,
          ),
        ),
      );

    return Authorizer.of({
      snapshot,
      authorize,
      require: (principal, action, resource, context) =>
        authorize(principal, action, resource, context).pipe(
          Effect.flatMap((d) =>
            d.kind === "allow" ? Effect.succeed(d) : Effect.fail(forbidden(d, resource)),
          ),
        ),
      checkApprover: (approver, held) =>
        snapshot(approver).pipe(
          Effect.map((snap) =>
            checkApprover(
              subjectOf(approver),
              { ...held, resource: canonicalResource(snap, held.resource) },
              snap,
            ),
          ),
        ),
    });
  }),
);
