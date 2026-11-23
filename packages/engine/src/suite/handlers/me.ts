import { Effect, Schema as S } from "effect";
import { nodeId, nodeUri } from "@plinth/core";
import {
  SUITE_EXAMPLES,
  SUITE_PERMISSIONS,
  SuiteDiscovery,
  SuiteMe,
  type PreferenceSpec,
  type ProgramSpec,
} from "@plinth/spec";
import { AppConfig } from "../../config";
import { store } from "../../control-store";
import { Authorizer } from "../../authz";
import { ChangeLog } from "../../change-log";
import { PlinthClock, readClockState } from "../../clock";
import { parseDevTokens } from "../../identity";
import { domainHead } from "../domain-stream";
import { emitFrom } from "../domain-events";
import { navCounts } from "../notify";
import { loadProgram, tierOf } from "../program";
import type { ActionCtx, ActionHandler, HandlerError, SuiteEnv } from "../types";
import type { HandlerTable } from "./stub";
import { activityOf, PLUMBING } from "./activity3";
import { ISO, dom, pgArr, personRefs, q, ref, refusal } from "./util3";

/**
 * Module `me` (CONTRACT.md 12.1): the shell bootstrap, own activity, sessions, profile and preferences, and the dev
 * identity switcher list. Sessions use wall time (CONTRACT.md 1.5); everything else uses the command's virtual time.
 */

type MeOut = S.Schema.Type<typeof SuiteMe.MeOut>;

const KERNEL_PERMISSIONS: ReadonlyArray<{ perm: string; module: string }> = [
  { perm: "approval:decide", module: "suite/approvals" },
  { perm: "query:run", module: "Source" },
  { perm: "node:write", module: "Page" },
];

const effectivePermissions = (ctx: ActionCtx) =>
  Effect.gen(function* () {
    const authz = yield* Authorizer;
    const p = ctx.principal;
    const out: string[] = [];
    for (const perm of SUITE_PERMISSIONS) {
      const d = yield* authz.authorize(p, perm, `plinth://${p.workspaceSlug}/suite/me`);
      if (d.kind === "allow") out.push(perm);
    }
    for (const k of KERNEL_PERMISSIONS) {
      const res = k.module.startsWith("suite/")
        ? `plinth://${p.workspaceSlug}/${k.module}`
        : `plinth://${p.workspaceSlug}/${k.module}/`;
      const d = yield* authz.authorize(p, k.perm, res);
      if (d.kind === "allow") out.push(k.perm);
    }
    return out;
  });

/** The `Preference` node of a member merged over the Program defaults. */
export const loadPreferences = (ws: string, handle: string, subject: string, program: ProgramSpec) =>
  Effect.gen(function* () {
    const rows = yield* q<{ revision: string; body: { spec?: Partial<PreferenceSpec> } }>(
      `SELECT revision::text AS revision, body FROM nodes WHERE workspace_id = $1 AND kind = 'Preference' AND slug = $2 AND deleted_at IS NULL`,
      [ws, `prefs.${handle}`],
    );
    const spec = rows[0]?.body.spec;
    const base = SUITE_EXAMPLES.Preference.spec as unknown as PreferenceSpec;
    const merged: PreferenceSpec = {
      ...base,
      ...(spec ?? {}),
      owner: spec?.owner ?? subject,
      notifications: { ...program.notification_defaults, ...(spec?.notifications ?? {}) },
      digest: spec?.digest ?? program.digest_default,
      muted_threads: spec?.muted_threads ?? [],
      ui: spec?.ui ?? base.ui,
    } as PreferenceSpec;
    return { spec: merged, revision: rows[0] ? Number(rows[0].revision) : null };
  });

const buildMe = (ctx: ActionCtx): Effect.Effect<MeOut, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const p = ctx.principal;
    const ws = p.workspaceId;
    const log = yield* ChangeLog;
    const clock = yield* PlinthClock;
    const program = yield* loadProgram(ws);
    const refs = yield* personRefs(ws, [p.id, ...(ctx.onBehalfOf ? [ctx.onBehalfOf.id] : [])]);
    const mem = yield* q<{
      handle: string;
      email: string;
      title: string;
      department: string;
      region: string;
      location: string;
      bio: string;
      showcase: string[];
      joined_at: string;
      disabled: boolean;
      balance: string | null;
      lifetime: string | null;
    }>(
      `SELECT m.handle, m.email, m.title, m.department, m.region, m.location, m.bio, m.showcase,
              ${ISO("m.joined_at")} AS joined_at, (pr.disabled_at IS NOT NULL) AS disabled,
              a.balance::text AS balance, a.lifetime_earned::text AS lifetime
       FROM members m JOIN principals pr ON pr.principal_id = m.member_id
       LEFT JOIN ledger_accounts a ON a.member_id = m.member_id WHERE m.member_id = $1`,
      [p.id],
    );
    const m = mem[0];
    const self = ref(refs, p.id);
    const lifetime = Number(m?.lifetime ?? 0);
    const tier = tierOf(program, lifetime);
    const tiers = [...program.tiers].sort((a, b) => a.min_lifetime_points - b.min_lifetime_points);
    const idx = tiers.findIndex((t) => t.tier === tier);
    const next = tiers[idx + 1];
    const floor = tiers[idx]?.min_lifetime_points ?? 0;
    const progress = next
      ? Math.min(1, Math.max(0, (lifetime - floor) / (next.min_lifetime_points - floor)))
      : 1;
    // roles from the Role nodes
    const roleRows = yield* q<{
      slug: string;
      body: {
        metadata?: { title?: string };
        spec?: { members?: Array<{ subject?: string; scope?: { region: string } }> };
      };
    }>(
      `SELECT slug, body FROM nodes WHERE workspace_id = $1 AND kind = 'Role' AND deleted_at IS NULL ORDER BY slug`,
      [ws],
    );
    const roles = roleRows.flatMap((r) => {
      const mm = (r.body.spec?.members ?? []).find((x) => x.subject === p.subject);
      return mm ? [{ role: r.slug, title: r.body.metadata?.title ?? r.slug, scope: mm.scope ?? null }] : [];
    });
    const prefs = m ? (yield* loadPreferences(ws, m.handle, p.subject, program)).spec : null;
    const cs = yield* store(readClockState);
    const virtualNow = yield* clock.virtualNow;
    return {
      principal: self,
      member: m
        ? {
            handle: m.handle,
            subject: p.subject,
            display_name: p.displayName,
            avatar: self.avatar,
            title: m.title,
            department: m.department,
            region: m.region,
            location: m.location,
            joined_at: m.joined_at,
            status: m.disabled ? "disabled" : "active",
            bio: m.bio,
            email: m.email,
            showcase: m.showcase,
          }
        : null,
      on_behalf_of: ctx.onBehalfOf ? ref(refs, ctx.onBehalfOf.id) : null,
      roles,
      permissions: yield* effectivePermissions(ctx),
      balance: m ? Number(m.balance ?? 0) : null,
      tier: m
        ? {
            tier,
            lifetime_points: lifetime,
            next_tier: next?.tier ?? null,
            next_tier_at: next?.min_lifetime_points ?? null,
            progress,
          }
        : null,
      counts: yield* navCounts(p),
      preferences: prefs,
      program: { name: program.name, currency_label: program.currency_label },
      virtual_now: virtualNow.toISOString(),
      clock: { speed: cs?.speed ?? 6, paused: cs?.paused ?? false },
      session_id: ctx.sessionId ?? null,
      rt: { head_seq: yield* log.headSeq(ws), domain_head_seq: yield* domainHead(ws) },
    } as MeOut;
  });

const get: ActionHandler<unknown, MeOut> = { run: (_i, ctx) => buildMe(ctx) };

// ---- activity ------------------------------------------------------------------------------------------

const activity: ActionHandler<S.Schema.Type<typeof SuiteMe.ActivityIn>, unknown> = {
  run: (input, ctx) =>
    activityOf(ctx.principal.workspaceId, ctx.principal.id, {
      types: input.types,
      excludeTypes: PLUMBING,
      cursor: input.cursor,
      limit: input.limit,
    }),
};

// ---- sessions ------------------------------------------------------------------------------------------

const sessions: ActionHandler<unknown, S.Schema.Type<typeof SuiteMe.SessionsOut>> = {
  run: (_i, ctx) =>
    Effect.gen(function* () {
      const rows = yield* q<{
        session_id: string;
        label: string;
        surface: "ui" | "mcp" | "api";
        created_at: string;
        last_seen_at: string;
        revoked_at: string | null;
      }>(
        `SELECT session_id, label, surface, ${ISO("created_at")} AS created_at, ${ISO("last_seen_at")} AS last_seen_at,
                ${ISO("revoked_at")} AS revoked_at
         FROM member_sessions WHERE principal_id = $1 ORDER BY (revoked_at IS NULL) DESC, last_seen_at DESC, session_id LIMIT 100`,
        [ctx.principal.id],
      );
      return { items: rows.map((r) => ({ ...r, current: r.session_id === ctx.sessionId })) } as never;
    }),
};

export const revokeSession = (
  ctx: ActionCtx,
  sessionId: string,
  owner: string | null,
): Effect.Effect<{ session_id: string; revoked_at: string }, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const rows = yield* q<{ principal_id: string; revoked_at: string | null }>(
      `SELECT principal_id, ${ISO("revoked_at")} AS revoked_at FROM member_sessions WHERE workspace_id = $1 AND session_id = $2 FOR UPDATE`,
      [ctx.principal.workspaceId, sessionId],
    );
    const r = rows[0];
    if (!r || (owner !== null && r.principal_id !== owner))
      return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/session_id", "no such session"));
    if (r.revoked_at !== null) return { session_id: sessionId, revoked_at: r.revoked_at };
    const done = yield* q<{ revoked_at: string }>(
      `UPDATE member_sessions SET revoked_at = now(), revoked_by = $2 WHERE session_id = $1 RETURNING ${ISO("revoked_at")} AS revoked_at`,
      [sessionId, ctx.principal.id],
    );
    const who = yield* q<{ subject: string }>(`SELECT subject FROM principals WHERE principal_id = $1`, [
      r.principal_id,
    ]);
    const subject = who[0]?.subject ?? ctx.principal.subject;
    yield* emitFrom(ctx, "session.revoked", {
      audience: [...new Set([subject, ctx.principal.subject])],
      subject: { kind: "session", id: sessionId },
      member: { id: r.principal_id, subject },
      payload: { session_id: sessionId, by: ctx.principal.subject },
    });
    return { session_id: sessionId, revoked_at: done[0]?.revoked_at ?? ctx.now.toISOString() };
  });

const sessionRevoke: ActionHandler<
  S.Schema.Type<typeof SuiteMe.SessionRevokeIn>,
  S.Schema.Type<typeof SuiteMe.SessionRevokeOut>
> = {
  run: (input, ctx) => revokeSession(ctx, input.session_id, ctx.principal.id),
};

// ---- profile -------------------------------------------------------------------------------------------

const profileUpdate: ActionHandler<S.Schema.Type<typeof SuiteMe.ProfileUpdateIn>, MeOut> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const mem = yield* q<{ handle: string }>(`SELECT handle FROM members WHERE member_id = $1`, [
        ctx.principal.id,
      ]);
      const handle = mem[0]?.handle;
      if (!handle)
        return yield* Effect.fail(
          dom("FORBIDDEN", "", "only members have a profile", { details: { reason: "no_member" } }),
        );
      if (input.showcase !== undefined) {
        const held = yield* q<{ badge_slug: string }>(
          `SELECT badge_slug FROM badge_awards WHERE member_id = $1 AND revoked_at IS NULL AND badge_slug = ANY($2::text[])`,
          [ctx.principal.id, pgArr(input.showcase)],
        );
        const have = new Set(held.map((h) => h.badge_slug));
        const missing = input.showcase.filter((x) => !have.has(x));
        if (missing.length > 0)
          return yield* Effect.fail(
            refusal("RULE_REFUSED", "NOT_ELIGIBLE", "showcase badges must be badges you hold", {
              badges: missing,
            }),
          );
      }
      const sets: string[] = [];
      const params: unknown[] = [ctx.principal.id];
      const fields: string[] = [];
      const add = (col: string, v: unknown, cast = "") => {
        params.push(v);
        sets.push(`${col} = $${params.length}${cast}`);
      };
      if (input.title !== undefined) (add("title", input.title), fields.push("title"));
      if (input.bio !== undefined) (add("bio", input.bio), fields.push("bio"));
      if (input.location !== undefined) (add("location", input.location), fields.push("location"));
      if (input.avatar_hue !== undefined) (add("avatar_hue", input.avatar_hue), fields.push("avatar_hue"));
      if (input.showcase !== undefined)
        (add("showcase", pgArr(input.showcase), "::text[]"), fields.push("showcase"));
      if (sets.length > 0) yield* q(`UPDATE members SET ${sets.join(", ")} WHERE member_id = $1`, params);
      if (input.display_name !== undefined) {
        yield* q(`UPDATE principals SET display_name = $2 WHERE principal_id = $1`, [
          ctx.principal.id,
          input.display_name,
        ]);
        fields.push("display_name");
      }
      if (fields.length > 0)
        yield* emitFrom(ctx, "member.updated", {
          audience: ["*"],
          subject: { kind: "member", id: handle },
          member: ctx.principal,
          payload: { member: handle, fields },
        });
      void ws;
      return yield* buildMe({
        ...ctx,
        principal: { ...ctx.principal, displayName: input.display_name ?? ctx.principal.displayName },
      });
    }),
};

// ---- preferences ---------------------------------------------------------------------------------------

const handleOf = (ctx: ActionCtx) =>
  q<{ handle: string }>(`SELECT handle FROM members WHERE member_id = $1`, [ctx.principal.id]).pipe(
    Effect.flatMap((r) =>
      r[0]
        ? Effect.succeed(r[0].handle)
        : Effect.fail(
            dom("FORBIDDEN", "", "only members have preferences", { details: { reason: "no_member" } }),
          ),
    ),
  );

const prefsGet: ActionHandler<unknown, S.Schema.Type<typeof SuiteMe.PreferencesOut>> = {
  run: (_i, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const handle = yield* handleOf(ctx);
      const program = yield* loadProgram(ws);
      const { spec, revision } = yield* loadPreferences(ws, handle, ctx.principal.subject, program);
      return {
        preferences: spec,
        revision,
        defaults: { notifications: program.notification_defaults, digest: program.digest_default },
      } as never;
    }),
};

const prefsUpdate: ActionHandler<
  S.Schema.Type<typeof SuiteMe.PreferencesUpdateIn>,
  S.Schema.Type<typeof SuiteMe.PreferencesUpdateOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const log = yield* ChangeLog;
      const handle = yield* handleOf(ctx);
      const program = yield* loadProgram(ws);
      const { spec: cur, revision } = yield* loadPreferences(ws, handle, ctx.principal.subject, program);
      if (
        input.base_revision !== undefined &&
        input.base_revision !== null &&
        revision !== null &&
        input.base_revision !== revision
      )
        return yield* Effect.fail(
          dom("CONFLICT", "/base_revision", "your preferences changed since you loaded them", {
            details: { reason: "STALE_VERSION", current_version: revision },
          }),
        );
      const merged: PreferenceSpec = {
        ...cur,
        ...(input.notifications ? { notifications: { ...cur.notifications, ...input.notifications } } : {}),
        ...(input.digest ? { digest: input.digest } : {}),
        ...(input.muted_threads ? { muted_threads: [...input.muted_threads] } : {}),
        ...(input.ui ? { ui: input.ui } : {}),
      } as PreferenceSpec;
      let withQuiet: Record<string, unknown> = { ...merged };
      if (input.quiet_hours === null) {
        const { quiet_hours: _q, ...rest } = withQuiet;
        withQuiet = rest;
      } else if (input.quiet_hours !== undefined) withQuiet["quiet_hours"] = input.quiet_hours;
      const slug = `prefs.${handle}`;
      const target = nodeUri(ctx.principal.workspaceSlug, "Preference", nodeId(ws, "Preference", slug));
      const change =
        revision === null
          ? {
              target,
              base_revision: null,
              ops: [
                {
                  op: "create" as const,
                  kind: "Preference" as const,
                  slug,
                  body: {
                    ...SUITE_EXAMPLES.Preference,
                    metadata: { slug, title: `Preferences of ${ctx.principal.displayName}` },
                    spec: withQuiet,
                  },
                },
              ],
            }
          : {
              target,
              base_revision: revision,
              ops: [{ op: "set" as const, path: "/spec", value: withQuiet }],
            };
      const res = yield* log.commit({
        actor: { principal: ctx.principal, surface: ctx.surface, sessionId: ctx.sessionId },
        changes: [change],
        reason: "update notification and display preferences",
      });
      const node = res.nodes?.[0];
      return {
        preferences: withQuiet as unknown as PreferenceSpec,
        revision: node?.result_revision ?? (revision ?? 0) + 1,
        change_seq: node?.change_seq ?? res.change_seq ?? 0,
      };
    }),
};

// ---- dev principals ------------------------------------------------------------------------------------

const FEATURED = new Set([
  "user:ops-lead",
  "user:emea-lead",
  "user:finance-analyst",
  "user:marketing-lead",
  "user:content-editor",
  "user:it-admin",
  "agent:claude-code",
]);

const devPrincipals: ActionHandler<unknown, S.Schema.Type<typeof SuiteMe.DevPrincipalsOut>> = {
  run: (_i, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const cfg = yield* AppConfig;
      const statics = new Map([...parseDevTokens(cfg.devTokens)].map(([tok, subj]) => [subj, tok]));
      const rows = yield* q<{
        principal_id: string;
        subject: string;
        kind: "human" | "agent" | "service";
        display_name: string;
        handle: string | null;
        region: string | null;
      }>(
        `SELECT p.principal_id, p.subject, p.kind, p.display_name, m.handle, m.region
         FROM principals p LEFT JOIN members m ON m.member_id = p.principal_id
         WHERE p.workspace_id = $1 AND p.disabled_at IS NULL AND p.kind IN ('human', 'agent') ORDER BY p.kind, p.subject`,
        [ws],
      );
      const refs = yield* personRefs(
        ws,
        rows.map((r) => r.principal_id),
      );
      const roleRows = yield* q<{ slug: string; body: { spec?: { members?: Array<{ subject?: string }> } } }>(
        `SELECT slug, body FROM nodes WHERE workspace_id = $1 AND kind = 'Role' AND deleted_at IS NULL`,
        [ws],
      );
      const items = rows.flatMap((r) => {
        const token = r.kind === "human" && r.handle ? `dev-user-${r.handle}` : statics.get(r.subject);
        if (!token) return [];
        const roles = roleRows
          .filter((x) => (x.body.spec?.members ?? []).some((mm) => mm.subject === r.subject))
          .map((x) => x.slug);
        const p = ref(refs, r.principal_id);
        return [
          {
            handle: r.handle,
            subject: r.subject,
            display_name: r.display_name,
            avatar: p.avatar,
            roles,
            region: r.region,
            token,
            featured: FEATURED.has(r.subject),
          },
        ];
      });
      return { items } as never;
    }),
};

export const meHandlers = {
  "me.get": get,
  "me.counts": {
    // Shared helper: the same function the rt gateway uses for the `counts` frame.
    run: (_input, ctx) => navCounts(ctx.principal),
  } satisfies ActionHandler<unknown, S.Schema.Type<typeof SuiteDiscovery.HomeOut.fields.counts>>,
  "me.activity": activity,
  "me.sessions": sessions,
  "me.sessions.revoke": sessionRevoke,
  "me.profile.update": profileUpdate,
  "me.preferences.get": prefsGet,
  "me.preferences.update": prefsUpdate,
  "dev.principals": devPrincipals,
} satisfies HandlerTable;
