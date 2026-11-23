import { Context, Effect, Layer } from "effect";
import { DomainError, type PrincipalKind } from "@plinth/spec";
import { AppConfig } from "./config";
import { ControlStore, store } from "./control-store";
import type { StoreError } from "./errors";

export interface Principal {
  readonly id: string;
  /** `user:ops-lead`, `agent:claude-code`, `service:replay-driver`. */
  readonly subject: string;
  readonly kind: PrincipalKind;
  readonly displayName: string;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  /** For agents: the human they act for (`on_behalf_of`). */
  readonly delegatorId: string | null;
  readonly delegatorSubject: string | null;
  /** Agents: the ceiling (`principals.max_scope.permissions`). */
  readonly ceiling?: ReadonlyArray<string> | null;
  /** The permissions the presented token was issued with. Absent or null: the token does not narrow. */
  readonly tokenScope?: ReadonlyArray<string> | null;
}

/**
 * Identity: maps a bearer token to a principal. L1 ships a dev Layer with static tokens from configuration. The
 * Keycloak and Cognito layers arrive with L4 behind the same interface.
 */
export class Identity extends Context.Tag("plinth/Identity")<
  Identity,
  {
    readonly authenticate: (bearer: string | undefined) => Effect.Effect<Principal, DomainError | StoreError>;
    /** Resolve a principal by subject without a token (stdio startup assertion, seeds). */
    readonly bySubject: (subject: string) => Effect.Effect<Principal, DomainError | StoreError>;
  }
>() {}

export const parseDevTokens = (spec: string): ReadonlyMap<string, string> =>
  new Map(
    spec
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.includes("="))
      .map((s) => {
        const i = s.indexOf("=");
        return [s.slice(i + 1), s.slice(0, i)] as const; // token -> subject
      }),
  );

interface PrincipalRow {
  readonly principal_id: string;
  readonly subject: string;
  readonly kind: PrincipalKind;
  readonly display_name: string;
  readonly workspace_id: string;
  readonly workspace_slug: string;
  readonly delegator_id: string | null;
  readonly delegator_subject: string | null;
  readonly max_scope: { permissions?: string[] } | null;
  readonly disabled: boolean;
}

export const IdentityDev = Layer.effect(
  Identity,
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const { sql } = yield* ControlStore;
    const tokens = parseDevTokens(cfg.devTokens);
    const unauth = (message: string) => new DomainError({ code: "UNAUTHENTICATED", path: "", message });

    const bySubject = (subject: string) =>
      store(
        sql<PrincipalRow>`
          SELECT p.principal_id, p.subject, p.kind, p.display_name, p.workspace_id, w.slug AS workspace_slug,
                 p.delegator_id, d.subject AS delegator_subject, p.max_scope, (p.disabled_at IS NOT NULL) AS disabled
          FROM principals p
          JOIN workspaces w ON w.workspace_id = p.workspace_id
          LEFT JOIN principals d ON d.principal_id = p.delegator_id
          WHERE w.slug = ${cfg.workspaceSlug} AND p.subject = ${subject}`,
      ).pipe(
        Effect.flatMap((rows) => {
          const r = rows[0];
          if (!r || r.disabled) return Effect.fail(unauth(`unknown or disabled principal '${subject}'`));
          const p: Principal = {
            id: r.principal_id,
            subject: r.subject,
            kind: r.kind,
            displayName: r.display_name,
            workspaceId: r.workspace_id,
            workspaceSlug: r.workspace_slug,
            delegatorId: r.delegator_id,
            delegatorSubject: r.delegator_subject,
            ceiling: r.max_scope?.permissions ?? null,
            tokenScope: null,
          };
          return Effect.succeed(p);
        }),
      );

    return Identity.of({
      bySubject,
      authenticate: (bearer) => {
        const token = bearer?.replace(/^Bearer\s+/i, "").trim();
        const fixed = token ? tokens.get(token) : undefined;
        if (fixed) return bySubject(fixed);
        // K8: dev-user-<handle> is the token of every seeded human member, by member handle (named people keep their kernel subject)
        const open = cfg.devOpenTokens && token ? /^dev-user-([a-z][a-z0-9-]{1,39})$/.exec(token) : null;
        if (!open) return Effect.fail(unauth("missing or unknown bearer token"));
        const handle = open[1] ?? "";
        return store(
          sql<{ subject: string }>`
            SELECT p.subject FROM members m
            JOIN principals p ON p.principal_id = m.member_id
            JOIN workspaces w ON w.workspace_id = m.workspace_id
            WHERE w.slug = ${cfg.workspaceSlug} AND m.handle = ${handle}`,
        ).pipe(Effect.flatMap((rows) => bySubject(rows[0]?.subject ?? `user:${handle}`)));
      },
    });
  }),
);
