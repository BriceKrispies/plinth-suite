import { Effect, Schema as S } from "effect";
import { nodeId, nodeUri, principalId } from "@plinth/core";
import {
  APPROVER_PERMISSION,
  AGENT_SUITE_CEILING,
  SUITE_EXAMPLES,
  SUITE_PERMISSIONS,
  SUITE_ROLES,
  SuiteAdmin,
  type PreferenceSpec,
} from "@plinth/spec";
import { ChangeLog } from "../../change-log";
import { Identity } from "../../identity";
import { approversFor } from "../approvals-core";
import { emitFrom } from "../domain-events";
import { ensureMemberAccount } from "../ledger";
import { createNotifications } from "../notify";
import { loadProgram } from "../program";
import { memberByHandle } from "../people";
import type { ActionCtx, ActionHandler, HandlerError, SuiteEnv } from "../types";
import type { HandlerTable } from "./stub";
import { revokeSession } from "./me";
import {
  ISO,
  clip,
  decodeCursor,
  dom,
  encodeCursor,
  limitOf,
  pgArr,
  personRefs,
  q,
  ref,
  refusal,
} from "./util3";

/**
 * Module `admin` (CONTRACT.md 12.9): members, sessions, roles, effective permissions and the role x permission matrix.
 * Role membership changes are Role node changes held under R-ROLE (a second admin approves); grants use the kernel API.
 */

type In<K extends keyof typeof SuiteAdmin> = (typeof SuiteAdmin)[K] extends S.Schema.Any
  ? S.Schema.Type<(typeof SuiteAdmin)[K]>
  : never;

interface RoleNode {
  slug: string;
  revision: string;
  body: {
    metadata?: { title?: string };
    spec?: {
      description?: string;
      system?: boolean;
      members?: Array<{ subject: string; scope?: { region: string } }>;
    };
  };
}

const loadRoles = (ws: string) =>
  q<RoleNode>(
    `SELECT slug, revision::text AS revision, body FROM nodes WHERE workspace_id = $1 AND kind = 'Role' AND deleted_at IS NULL ORDER BY slug`,
    [ws],
  );

const rolesBySubject = (roles: ReadonlyArray<RoleNode>) => {
  const m = new Map<string, Array<{ role: string; scope: { region: string } | null }>>();
  for (const r of roles)
    for (const x of r.body.spec?.members ?? [])
      m.set(x.subject, [...(m.get(x.subject) ?? []), { role: r.slug, scope: x.scope ?? null }]);
  return m;
};

// ---- members -------------------------------------------------------------------------------------------

const members: ActionHandler<In<"AdminMembersIn">, S.Schema.Type<typeof SuiteAdmin.AdminMembersOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const roles = yield* loadRoles(ws);
      const bySubject = rolesBySubject(roles);
      const params: unknown[] = [ws];
      const where = ["m.workspace_id = $1"];
      if (input.q && input.q.trim() !== "") {
        params.push(input.q.trim().toLowerCase());
        const n = params.length;
        where.push(
          `(lower(p.display_name) LIKE '%' || $${n} || '%' OR m.handle LIKE '%' || $${n} || '%' OR lower(m.email) LIKE '%' || $${n} || '%')`,
        );
      }
      if (input.status === "active") where.push("p.disabled_at IS NULL");
      if (input.status === "disabled") where.push("p.disabled_at IS NOT NULL");
      if (input.role) {
        const holders = (roles.find((r) => r.slug === input.role)?.body.spec?.members ?? []).map(
          (x) => x.subject,
        );
        params.push(pgArr(holders));
        where.push(`p.subject = ANY($${params.length}::text[])`);
      }
      const total = yield* q<{ n: string }>(
        `SELECT count(*)::text AS n FROM members m JOIN principals p ON p.principal_id = m.member_id WHERE ${where.join(" AND ")}`,
        params,
      );
      const limit = limitOf(input.limit, 25);
      const offset = Number(decodeCursor(input.cursor)?.[0] ?? 0) || 0;
      params.push(limit + 1, offset);
      const rows = yield* q<{
        member_id: string;
        subject: string;
        email: string;
        title: string;
        department: string;
        region: string;
        disabled: boolean;
        last_active_at: string | null;
        joined_at: string;
        sessions_active: string;
      }>(
        `SELECT m.member_id, p.subject, m.email, m.title, m.department, m.region, (p.disabled_at IS NOT NULL) AS disabled,
                ${ISO("m.last_active_at")} AS last_active_at, ${ISO("m.joined_at")} AS joined_at,
                (SELECT count(*) FROM member_sessions s WHERE s.principal_id = m.member_id AND s.revoked_at IS NULL)::text AS sessions_active
         FROM members m JOIN principals p ON p.principal_id = m.member_id
         WHERE ${where.join(" AND ")} ORDER BY lower(p.display_name), m.handle LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const page = rows.slice(0, limit);
      const refs = yield* personRefs(
        ws,
        page.map((r) => r.member_id),
      );
      return {
        items: page.map((r) => ({
          person: ref(refs, r.member_id),
          email: r.email,
          title: r.title,
          department: r.department,
          region: r.region,
          roles: bySubject.get(r.subject) ?? [],
          status: r.disabled ? "disabled" : "active",
          last_active_at: r.last_active_at,
          sessions_active: Number(r.sessions_active),
          joined_at: r.joined_at,
        })),
        next_cursor: rows.length > limit ? encodeCursor([offset + limit]) : null,
        total: Number(total[0]?.n ?? 0),
      } as never;
    }),
};

interface Held {
  status: "committed" | "pending_approval";
  approval_id?: string;
  change_seq?: number;
  revision?: number;
  rule_id: string[];
}

/** A Role node change as the caller; when held, announce the request to the approvers. */
const commitRoleChange = (
  ctx: ActionCtx,
  role: RoleNode,
  nextMembers: ReadonlyArray<{ subject: string; scope?: { region: string } | undefined }>,
  baseRevision: number,
  reason: string,
  summary: string,
): Effect.Effect<Held, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const log = yield* ChangeLog;
    const target = nodeUri(ctx.principal.workspaceSlug, "Role", nodeId(ws, "Role", role.slug));
    const res = yield* log.commit({
      actor: { principal: ctx.principal, surface: ctx.surface, sessionId: ctx.sessionId },
      changes: [
        {
          target,
          base_revision: baseRevision,
          ops: [
            {
              op: "set",
              path: "/spec/members",
              value: nextMembers.map((m) => ({ subject: m.subject, ...(m.scope ? { scope: m.scope } : {}) })),
            },
          ],
        },
      ],
      reason,
    });
    if (res.status === "pending_approval" && res.approval_id) {
      const approvalId = res.approval_id;
      const rows = yield* q<{ rule_id: string[]; approver_permission: string }>(
        `SELECT rule_id, approver_permission FROM change_approvals WHERE approval_id = $1`,
        [approvalId],
      );
      const rule = rows[0]?.rule_id ?? ["R-ROLE"];
      const perm = rows[0]?.approver_permission ?? APPROVER_PERMISSION["R-ROLE"] ?? "admin:roles";
      const exclude = [ctx.principal.id, ...(ctx.onBehalfOf ? [ctx.onBehalfOf.id] : [])];
      const approvers = yield* approversFor(ws, ctx.principal.workspaceSlug, perm, exclude);
      const seq = yield* emitFrom(ctx, "approval.requested", {
        audience: approvers.length > 0 ? approvers.map((a) => a.subject) : ["role:admin"],
        subject: { kind: "approval", id: approvalId },
        member: ctx.principal,
        payload: {
          approval_type: "change",
          id: approvalId,
          title: clip(summary, 140),
          requested_by: ctx.principal.subject,
        },
      });
      yield* createNotifications(ctx, {
        recipients: approvers,
        type: "approval_request",
        title: "Approval needed",
        body: clip(summary, 500),
        link: "/approvals",
        actorId: ctx.principal.id,
        subject: { kind: "approval", id: approvalId },
        sourceEventSeq: seq,
        dedupeKey: `${seq}:approval_request`,
      });
      return { status: "pending_approval" as const, approval_id: approvalId, rule_id: [...rule] };
    }
    const node = res.nodes?.[0];
    return {
      status: "committed" as const,
      ...(node?.change_seq !== undefined ? { change_seq: node.change_seq } : {}),
      ...(node?.result_revision !== undefined ? { revision: node.result_revision } : {}),
      rule_id: ["R-ROLE"],
    };
  });

const memberCreate: ActionHandler<In<"MemberCreateIn">, S.Schema.Type<typeof SuiteAdmin.MemberCreateOut>> = {
  preview: (input) =>
    Effect.succeed({
      effect: `Create member ${input.handle} (${input.region}, ${input.department}) and propose adding them to the member role`,
      facts: { handle: input.handle, region: input.region, department: input.department },
      decision: "approval",
      approverPermission: "admin:roles",
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const subject = `user:${input.handle}`;
      const dup = yield* q<{ n: number }>(
        `SELECT 1 AS n FROM members WHERE workspace_id = $1 AND (handle = $2 OR lower(email) = lower($3))
         UNION ALL SELECT 1 FROM principals WHERE workspace_id = $1 AND subject = $4`,
        [ws, input.handle, input.email, subject],
      );
      if (dup.length > 0)
        return yield* Effect.fail(
          refusal("CONFLICT", "ALREADY_EXISTS", "a member with this handle or email already exists", {
            handle: input.handle,
          }),
        );
      const id = principalId(ws, subject);
      const count = yield* q<{ n: string }>(
        `SELECT count(*)::text AS n FROM members WHERE workspace_id = $1`,
        [ws],
      );
      const hue = (Number(count[0]?.n ?? 0) * 47) % 360;
      yield* q(
        `INSERT INTO principals (principal_id, workspace_id, kind, subject, display_name) VALUES ($1, $2, 'human', $3, $4)`,
        [id, ws, subject, input.display_name],
      );
      yield* q(
        `INSERT INTO members (member_id, workspace_id, handle, email, title, department, region, location, bio, avatar_hue, showcase, joined_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '', $9, '{}', $10::timestamptz)`,
        [
          id,
          ws,
          input.handle,
          input.email,
          input.title,
          input.department,
          input.region,
          input.location,
          hue,
          ctx.now.toISOString(),
        ],
      );
      const account = yield* ensureMemberAccount(ws, { id, handle: input.handle }, ctx.now);
      // the member's Preference node is provisioned by the system: an admin holds no grant on Preference nodes
      const identity = yield* Identity;
      const system = yield* identity.bySubject("service:ingest");
      const log = yield* ChangeLog;
      const program = yield* loadProgram(ws);
      const slug = `prefs.${input.handle}`;
      const prefUri = nodeUri(ctx.principal.workspaceSlug, "Preference", nodeId(ws, "Preference", slug));
      const spec: PreferenceSpec = {
        ...(SUITE_EXAMPLES.Preference.spec as unknown as PreferenceSpec),
        owner: subject,
        notifications: program.notification_defaults,
        digest: program.digest_default,
      };
      yield* log.commit({
        actor: { principal: system, surface: "system" },
        changes: [
          {
            target: prefUri,
            base_revision: null,
            ops: [
              {
                op: "create",
                kind: "Preference",
                slug,
                body: {
                  ...SUITE_EXAMPLES.Preference,
                  metadata: { slug, title: `Preferences of ${input.display_name}` },
                  spec,
                },
              },
            ],
          },
        ],
        reason: `provision preferences for ${input.handle}`,
      });
      // the Role change adding the member to `member`
      const roles = yield* loadRoles(ws);
      const memberRole = roles.find((r) => r.slug === "member");
      if (!memberRole)
        return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "", "the member role does not exist"));
      const cur = memberRole.body.spec?.members ?? [];
      const held = yield* commitRoleChange(
        ctx,
        memberRole,
        [...cur, { subject }],
        Number(memberRole.revision),
        `add ${input.handle} to the member role`,
        `Add ${input.handle} to the member role`,
      );
      // domain events come last in the lock order, after every node commit
      yield* emitFrom(ctx, "member.updated", {
        audience: ["role:admin", ctx.principal.subject],
        subject: { kind: "member", id: input.handle },
        member: { id, subject },
        payload: { member: input.handle, fields: ["created"] },
      });
      return {
        person: ref(yield* personRefs(ws, [id]), id),
        account,
        preference_uri: prefUri,
        role_change: held,
      } as never;
    }),
};

// ---- status --------------------------------------------------------------------------------------------

const memberStatus: ActionHandler<In<"MemberStatusIn">, S.Schema.Type<typeof SuiteAdmin.MemberStatusOut>> = {
  preview: (input) =>
    Effect.succeed({
      effect: `${input.status === "disabled" ? "Disable" : "Re-enable"} member ${input.handle}${input.status === "disabled" ? " and sign out all their sessions" : ""}`,
      facts: { handle: input.handle, status: input.status },
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const m = yield* memberByHandle(ws, input.handle);
      if (m.id === ctx.principal.id)
        return yield* Effect.fail(
          refusal("RULE_REFUSED", "SELF_ACTION", "you cannot change your own status"),
        );
      let revoked = 0;
      if (input.status === "disabled") {
        yield* q(
          `UPDATE principals SET disabled_at = $2::timestamptz WHERE principal_id = $1 AND disabled_at IS NULL`,
          [m.id, ctx.now.toISOString()],
        );
        const open = yield* q<{ session_id: string }>(
          `UPDATE member_sessions SET revoked_at = now(), revoked_by = $2 WHERE principal_id = $1 AND revoked_at IS NULL RETURNING session_id`,
          [m.id, ctx.principal.id],
        );
        revoked = open.length;
        for (const s of open)
          yield* emitFrom(ctx, "session.revoked", {
            audience: [m.subject, ctx.principal.subject],
            subject: { kind: "session", id: s.session_id },
            member: { id: m.id, subject: m.subject },
            payload: { session_id: s.session_id, by: ctx.principal.subject },
          });
      } else yield* q(`UPDATE principals SET disabled_at = NULL WHERE principal_id = $1`, [m.id]);
      yield* emitFrom(ctx, "member.updated", {
        audience: ["*"],
        subject: { kind: "member", id: m.handle },
        member: { id: m.id, subject: m.subject },
        payload: { member: m.handle, fields: ["status"] },
      });
      return { handle: m.handle, status: input.status, sessions_revoked: revoked };
    }),
};

// ---- sessions ------------------------------------------------------------------------------------------

const sessions: ActionHandler<In<"AdminSessionsIn">, S.Schema.Type<typeof SuiteAdmin.AdminSessionsOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const params: unknown[] = [ws];
      const where = ["s.workspace_id = $1"];
      if (input.member) {
        const m = yield* memberByHandle(ws, input.member);
        params.push(m.id);
        where.push(`s.principal_id = $${params.length}`);
      }
      if (input.active_only === true) where.push("s.revoked_at IS NULL");
      const cur = decodeCursor(input.cursor);
      if (cur && cur.length === 2) {
        params.push(cur[0], cur[1]);
        where.push(
          `(s.last_seen_at, s.session_id) < ($${params.length - 1}::timestamptz, $${params.length})`,
        );
      }
      const limit = limitOf(input.limit, 50);
      params.push(limit + 1);
      const rows = yield* q<{
        session_id: string;
        principal_id: string;
        label: string;
        surface: "ui" | "mcp" | "api";
        created_at: string;
        last_seen_at: string;
        seen_us: string;
        revoked_at: string | null;
      }>(
        `SELECT s.session_id, s.principal_id, s.label, s.surface, ${ISO("s.created_at")} AS created_at, ${ISO("s.last_seen_at")} AS last_seen_at,
                to_char(s.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS seen_us, ${ISO("s.revoked_at")} AS revoked_at
         FROM member_sessions s WHERE ${where.join(" AND ")} ORDER BY s.last_seen_at DESC, s.session_id DESC LIMIT $${params.length}`,
        params,
      );
      const page = rows.slice(0, limit);
      const refs = yield* personRefs(
        ws,
        page.map((r) => r.principal_id),
      );
      const last = page[page.length - 1];
      return {
        items: page.map((r) => ({
          session_id: r.session_id,
          label: r.label,
          created_at: r.created_at,
          last_seen_at: r.last_seen_at,
          revoked_at: r.revoked_at,
          current: r.session_id === ctx.sessionId,
          surface: r.surface,
          person: ref(refs, r.principal_id),
        })),
        next_cursor: rows.length > limit && last ? encodeCursor([last.seen_us, last.session_id]) : null,
      } as never;
    }),
};

const sessionRevokeAny: ActionHandler<
  In<"AdminSessionRevokeIn">,
  { session_id: string; revoked_at: string }
> = {
  run: (input, ctx) => revokeSession(ctx, input.session_id, null),
};

// ---- roles ---------------------------------------------------------------------------------------------

interface GrantNode {
  slug: string;
  revision: string;
  body: {
    metadata?: { title?: string };
    spec?: {
      principal?: string;
      effect?: string;
      actions?: string[];
      resource?: string;
      row_predicate?: string | null;
      status?: string;
      owner_only?: boolean;
    };
  };
}

const loadGrants = (ws: string) =>
  q<GrantNode>(
    `SELECT slug, revision::text AS revision, body FROM nodes WHERE workspace_id = $1 AND kind = 'Grant' AND deleted_at IS NULL ORDER BY slug`,
    [ws],
  );

const link = (ctx: ActionCtx, kind: string, slug: string, title: string, revision: string) => ({
  uri: nodeUri(
    ctx.principal.workspaceSlug,
    kind as never,
    nodeId(ctx.principal.workspaceId, kind as never, slug),
  ),
  kind,
  slug,
  title,
  revision: Number(revision),
});

const rolesList: ActionHandler<unknown, S.Schema.Type<typeof SuiteAdmin.RolesOut>> = {
  run: (_i, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const roles = yield* loadRoles(ws);
      const grants = yield* loadGrants(ws);
      const subjects = [...new Set(roles.flatMap((r) => (r.body.spec?.members ?? []).map((m) => m.subject)))];
      const idRows = subjects.length
        ? yield* q<{ principal_id: string; subject: string }>(
            `SELECT principal_id, subject FROM principals WHERE workspace_id = $1 AND subject = ANY($2::text[])`,
            [ws, pgArr(subjects)],
          )
        : [];
      const refs = yield* personRefs(
        ws,
        idRows.map((r) => r.principal_id),
      );
      const idOf = new Map(idRows.map((r) => [r.subject, r.principal_id]));
      const pending = yield* q<{
        approval_id: string;
        requester_id: string;
        payload: { changes?: Array<{ target: string }> };
      }>(
        `SELECT approval_id, requester_id, payload FROM change_approvals WHERE workspace_id = $1 AND status = 'pending_approval'`,
        [ws],
      );
      const requesterRefs = yield* personRefs(
        ws,
        pending.map((p) => p.requester_id),
      );
      const items = roles.map((r) => {
        const target = nodeId(ws, "Role", r.slug);
        return {
          node: link(ctx, "Role", r.slug, r.body.metadata?.title ?? r.slug, r.revision),
          description: r.body.spec?.description ?? "",
          system: r.body.spec?.system ?? false,
          members: (r.body.spec?.members ?? []).flatMap((m) => {
            const id = idOf.get(m.subject);
            return id ? [{ person: ref(refs, id), scope: m.scope ?? null }] : [];
          }),
          grants: grants
            .filter((g) => g.body.spec?.principal === `role:${r.slug}`)
            .map((g) => ({
              grant: link(ctx, "Grant", g.slug, g.body.metadata?.title ?? g.slug, g.revision),
              actions: g.body.spec?.actions ?? [],
              resource: g.body.spec?.resource ?? "",
              owner_only: g.body.spec?.owner_only ?? false,
            })),
          pending: pending
            .filter((p) => (p.payload.changes ?? []).some((c) => c.target.endsWith(target)))
            .map((p) => ({
              approval_id: p.approval_id,
              requested_by: ref(requesterRefs, p.requester_id),
              summary: `Change membership of role ${r.slug}`,
            })),
        };
      });
      return { items } as never;
    }),
};

const roleMembers: ActionHandler<S.Schema.Type<typeof SuiteAdmin.RoleMembersIn>, Held> = {
  preview: (input) =>
    Effect.succeed({
      effect: `Propose role ${input.slug}: add ${(input.add ?? []).length}, remove ${(input.remove ?? []).length} member(s); held for a second administrator`,
      facts: { role: input.slug, add: (input.add ?? []).length, remove: (input.remove ?? []).length },
      decision: "approval",
      approverPermission: "admin:roles",
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const touched = [...(input.add ?? []).map((a) => a.subject), ...(input.remove ?? [])];
      if (touched.includes(ctx.principal.subject))
        return yield* Effect.fail(
          refusal("RULE_REFUSED", "SELF_ACTION", "you cannot change your own role membership"),
        );
      const roles = yield* loadRoles(ws);
      const role = roles.find((r) => r.slug === input.slug);
      if (!role) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/slug", `no role '${input.slug}'`));
      const removed = new Set(input.remove ?? []);
      const added = new Map((input.add ?? []).map((a) => [a.subject, a]));
      const next = [
        ...(role.body.spec?.members ?? []).filter((m) => !removed.has(m.subject) && !added.has(m.subject)),
        ...[...added.values()].map((a) => ({ subject: a.subject, ...(a.scope ? { scope: a.scope } : {}) })),
      ];
      const names = [...added.keys(), ...removed]
        .map((s) => s.replace(/^user:/, ""))
        .slice(0, 4)
        .join(", ");
      return yield* commitRoleChange(
        ctx,
        role,
        next as never,
        input.base_revision,
        input.reason,
        `Change membership of role ${input.slug}: ${added.size} added, ${removed.size} removed (${names})`,
      );
    }),
};

// ---- permissions and matrix ----------------------------------------------------------------------------

const permissions: ActionHandler<In<"PermissionsIn">, S.Schema.Type<typeof SuiteAdmin.PermissionsOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const identity = yield* Identity;
      const target = input.principal ? yield* identity.bySubject(input.principal) : ctx.principal;
      const roles = yield* loadRoles(ws);
      const grants = yield* loadGrants(ws);
      const effective =
        target.kind === "agent" && target.delegatorSubject ? target.delegatorSubject : target.subject;
      const mine = rolesBySubject(roles).get(effective) ?? [];
      const ceiling = target.kind === "agent" ? (target.ceiling ?? null) : null;
      const refs = yield* personRefs(ws, [target.id, ...(target.delegatorId ? [target.delegatorId] : [])]);
      const out: Array<Record<string, unknown>> = [];
      for (const g of grants) {
        const sp = g.body.spec;
        if (!sp || (sp.status ?? "active") !== "active" || (sp.effect ?? "allow") !== "allow") continue;
        let via: Record<string, unknown> | undefined;
        let scopeRegion: string | undefined;
        if (sp.principal === effective || sp.principal === target.subject) via = { direct: true };
        else if (sp.principal?.startsWith("role:")) {
          const hit = mine.find((m) => `role:${m.role}` === sp.principal);
          if (hit) {
            via = { role: hit.role, scope: hit.scope };
            scopeRegion = hit.scope?.region;
          }
        }
        if (!via) continue;
        const predicate =
          [sp.row_predicate, scopeRegion ? `region = '${scopeRegion}'` : null]
            .filter(Boolean)
            .join(" and ") || null;
        for (const a of sp.actions ?? []) {
          if (ceiling && !ceiling.some((c) => c === a || c.startsWith(`${a}:`))) continue;
          out.push({
            permission: a,
            resource: sp.resource ?? "",
            row_predicate: predicate,
            owner_only: sp.owner_only ?? false,
            via,
            grant: link(ctx, "Grant", g.slug, g.body.metadata?.title ?? g.slug, g.revision),
          });
        }
      }
      out.sort(
        (a, b) =>
          String(a["permission"]).localeCompare(String(b["permission"])) ||
          String(a["resource"]).localeCompare(String(b["resource"])),
      );
      return {
        principal: ref(refs, target.id),
        ceiling: ceiling ? [...ceiling] : null,
        delegator: target.delegatorId ? ref(refs, target.delegatorId) : null,
        roles: mine.map((m) => m.role),
        permissions: out,
      } as never;
    }),
};

const matrix: ActionHandler<unknown, S.Schema.Type<typeof SuiteAdmin.MatrixOut>> = {
  run: (_i, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const grants = yield* loadGrants(ws);
      const prefix = `plinth://${ctx.principal.workspaceSlug}/`;
      const cells: Record<string, Record<string, string[]>> = {};
      const perms = new Set<string>(SUITE_PERMISSIONS);
      for (const g of grants) {
        const sp = g.body.spec;
        if (
          !sp?.principal?.startsWith("role:") ||
          (sp.status ?? "active") !== "active" ||
          (sp.effect ?? "allow") !== "allow"
        )
          continue;
        const role = sp.principal.slice(5);
        const res = (sp.resource ?? "").replace(prefix, "");
        for (const a of sp.actions ?? []) {
          perms.add(a);
          const row = (cells[a] ??= {});
          row[role] = [...new Set([...(row[role] ?? []), res])];
        }
      }
      const permList = [...perms].sort();
      for (const p of permList) {
        cells[p] ??= {};
        for (const r of SUITE_ROLES) cells[p]![r] ??= [];
      }
      const agent = yield* q<{ perms: string[] | null }>(
        `SELECT ARRAY(SELECT jsonb_array_elements_text(max_scope -> 'permissions')) AS perms FROM principals
         WHERE workspace_id = $1 AND kind = 'agent' AND max_scope IS NOT NULL ORDER BY subject LIMIT 1`,
        [ws],
      );
      return {
        roles: [...SUITE_ROLES],
        permissions: permList,
        cells,
        agent_ceiling:
          agent[0]?.perms && agent[0].perms.length > 0 ? agent[0].perms : [...AGENT_SUITE_CEILING],
      } as never;
    }),
};

export const adminHandlers = {
  "admin.members": members,
  "admin.member_create": memberCreate,
  "admin.member_status": memberStatus,
  "admin.sessions": sessions,
  "admin.session_revoke": sessionRevokeAny,
  "admin.roles": rolesList,
  "admin.role_members": roleMembers,
  "admin.permissions": permissions,
  "admin.matrix": matrix,
} satisfies HandlerTable;
