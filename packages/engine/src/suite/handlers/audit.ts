import { Effect, Schema as S } from "effect";
import { evalRowPredicate } from "@plinth/query";
import { SuiteWork, type DomainEventType } from "@plinth/spec";
import { Authorizer } from "../../authz";
import { ChangeLog } from "../../change-log";
import { verifyDomainChain } from "../domain-events";
import type { ActionCtx, ActionHandler, HandlerError, SuiteEnv } from "../types";
import type { HandlerTable } from "./stub";
import { describeEvent } from "./activity3";
import { ISO, decodeCursor, encodeCursor, limitOf, pgArr, personRefs, q, ref } from "./util3";

/**
 * Module `audit` (CONTRACT.md 12.8): the change log and the domain events merged by virtual time, the events alone, and
 * verification of both hash chains. A scoped `audit:view` (a regional manager) sees only events about members in its scope.
 */

type Entry = S.Schema.Type<typeof SuiteWork.AuditEntry>;

interface EventRow {
  seq: string;
  type: DomainEventType;
  at: string;
  at_us: string;
  actor_id: string;
  actor: string;
  on_behalf_of: string | null;
  approved_by_id: string | null;
  approved_by: string | null;
  surface: string;
  subject_kind: string | null;
  subject_id: string | null;
  cause: unknown;
  payload: Record<string, unknown>;
  hash: string;
  m_handle: string | null;
  m_region: string | null;
  m_department: string | null;
  m_tier: string | null;
}

interface EventFilter {
  readonly types?: ReadonlyArray<string> | undefined;
  readonly actor?: string | undefined;
  readonly memberHandle?: string | undefined;
  readonly subjectKind?: string | undefined;
  readonly subjectId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly text?: string | undefined;
  readonly region?: string | undefined;
}

interface Cur {
  readonly at: string;
  readonly rank: number;
  readonly seq: string;
}

const parseCursor = (c: string | undefined): Cur | undefined => {
  const p = decodeCursor(c);
  return p && p.length === 3 ? { at: p[0] as string, rank: Number(p[1]), seq: p[2] as string } : undefined;
};

/** Events newest first, filtered; the scope predicate is applied in code over chunks until `want` rows are kept. */
const eventRows = (
  ctx: ActionCtx,
  f: EventFilter,
  cur: Cur | undefined,
  want: number,
  keyOrder: "seq" | "time",
): Effect.Effect<ReadonlyArray<EventRow>, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const pred = ctx.allow?.rowPredicate ?? null;
    const kept: EventRow[] = [];
    let after = cur;
    for (let round = 0; round < 8 && kept.length < want; round++) {
      const params: unknown[] = [ctx.principal.workspaceId];
      const where = ["e.workspace_id = $1"];
      const add = (sql: string, v: unknown) => {
        params.push(v);
        where.push(sql.replaceAll("$$", () => `$${params.length}`));
      };
      if (f.types && f.types.length > 0) add("e.type = ANY($$::text[])", pgArr(f.types));
      if (f.actor) add("a.subject = $$", f.actor);
      if (f.memberHandle) add("mm.handle = $$", f.memberHandle);
      if (f.subjectKind) add("e.subject_kind = $$", f.subjectKind);
      if (f.subjectId) add("e.subject_id = $$", f.subjectId);
      if (f.from) add("e.occurred_at >= $$::timestamptz", f.from);
      if (f.to) add("e.occurred_at <= $$::timestamptz", f.to);
      if (f.region) add("mm.region = $$", f.region);
      if (f.text) add("(e.type ILIKE '%' || $$ || '%' OR a.subject ILIKE '%' || $$ || '%')", f.text);
      if (pred !== null) where.push("e.member_id IS NOT NULL");
      if (after) {
        if (keyOrder === "seq") add("e.seq < $$", Number(after.seq));
        else {
          params.push(after.at);
          const t = `$${params.length}::timestamptz`;
          if (after.rank === 1) {
            params.push(Number(after.seq));
            where.push(`(e.occurred_at < ${t} OR (e.occurred_at = ${t} AND e.seq < $${params.length}))`);
          } else where.push(`e.occurred_at < ${t}`);
          // rank 0 = change: events with the same instant sort above changes, so they are not "after" it
        }
      }
      params.push(Math.max(want, 50) * 2);
      const rows = yield* q<EventRow>(
        `SELECT e.seq::text AS seq, e.type, ${ISO("e.occurred_at")} AS at,
                to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_us,
                e.actor_id, a.subject AS actor, o.subject AS on_behalf_of, e.approved_by AS approved_by_id, ap.subject AS approved_by,
                e.surface, e.subject_kind, e.subject_id, e.cause, e.payload, encode(e.hash, 'hex') AS hash,
                mm.handle AS m_handle, mm.region AS m_region, mm.department AS m_department, la.tier AS m_tier
         FROM domain_events e
         JOIN principals a ON a.principal_id = e.actor_id
         LEFT JOIN principals o ON o.principal_id = e.on_behalf_of
         LEFT JOIN principals ap ON ap.principal_id = e.approved_by
         LEFT JOIN members mm ON mm.member_id = e.member_id
         LEFT JOIN ledger_accounts la ON la.member_id = e.member_id
         WHERE ${where.join(" AND ")} ORDER BY ${keyOrder === "seq" ? "e.seq DESC" : "e.occurred_at DESC, e.seq DESC"} LIMIT $${params.length}`,
        params,
      );
      for (const r of rows) {
        if (
          pred === null ||
          evalRowPredicate(pred, {
            handle: r.m_handle ?? "",
            region: r.m_region ?? "",
            tier: r.m_tier ?? "bronze",
            department: r.m_department ?? "",
          })
        )
          kept.push(r);
      }
      const last = rows[rows.length - 1];
      if (rows.length < Math.max(want, 50) * 2 || !last) break;
      after = { at: last.at_us, rank: 1, seq: last.seq };
    }
    return kept;
  });

// ---- timeline ------------------------------------------------------------------------------------------

const LINKS: Record<string, (slug: string) => string | null> = {
  Product: (s) => `/store/p/${s}`,
  Promotion: (s) => `/promotions/${s}`,
  Automation: (s) => `/automations/${s}`,
  Content: (s) => `/content/${s}`,
  Segment: (s) => `/segments/${s}`,
  Page: (s) => `/pages/${s}/edit`,
  Role: () => "/admin/roles",
  Program: () => "/admin/program",
  Grant: () => "/admin/grants",
  Badge: () => "/badges",
};

interface ChangeRow {
  seq: string;
  at: string;
  at_us: string;
  kind: string;
  slug: string;
  result_revision: string;
  head_revision: string;
  actor_id: string;
  on_behalf_of: string | null;
  approved_by: string | null;
  surface: string;
  rule_id: string[];
  paths: string[];
  undo_of: string | null;
  hash: string;
  created: boolean;
}

const timeline: ActionHandler<
  S.Schema.Type<typeof SuiteWork.AuditTimelineIn>,
  S.Schema.Type<typeof SuiteWork.AuditTimelineOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const limit = limitOf(input.limit, 40);
      const sources =
        input.sources && input.sources.length > 0 ? input.sources : (["change", "event"] as const);
      const cur = parseCursor(input.cursor);
      const scoped = (ctx.allow?.rowPredicate ?? null) !== null;
      const merged: Array<{ at: string; at_us: string; rank: number; seq: string; entry: Entry }> = [];

      // ---- changes (configuration) --------------------------------------------------------------------------
      if (sources.includes("change") && !scoped && !input.region) {
        const params: unknown[] = [ws];
        const where = ["c.workspace_id = $1", "c.kind = 'change'"];
        if (input.actor) (params.push(input.actor), where.push(`a.subject = $${params.length}`));
        if (input.from)
          (params.push(input.from),
            where.push(`coalesce(c.virtual_at, c.created_at) >= $${params.length}::timestamptz`));
        if (input.to)
          (params.push(input.to),
            where.push(`coalesce(c.virtual_at, c.created_at) <= $${params.length}::timestamptz`));
        if (input.q)
          (params.push(input.q),
            where.push(
              `(n.slug ILIKE '%' || $${params.length} || '%' OR n.kind ILIKE '%' || $${params.length} || '%')`,
            ));
        if (cur) {
          params.push(cur.at);
          const t = `$${params.length}::timestamptz`;
          if (cur.rank === 0) {
            params.push(Number(cur.seq));
            where.push(
              `(coalesce(c.virtual_at, c.created_at) < ${t} OR (coalesce(c.virtual_at, c.created_at) = ${t} AND c.seq < $${params.length}))`,
            );
          } else where.push(`coalesce(c.virtual_at, c.created_at) < ${t}`);
        }
        params.push(limit + 1);
        const rows = yield* q<ChangeRow>(
          `SELECT c.seq::text AS seq, ${ISO("coalesce(c.virtual_at, c.created_at)")} AS at,
                  to_char(coalesce(c.virtual_at, c.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_us,
                  n.kind, n.slug, c.result_revision::text AS result_revision, n.revision::text AS head_revision,
                  c.actor_id, c.on_behalf_of, c.approved_by, c.surface, c.rule_id, c.paths, c.undo_of::text AS undo_of,
                  encode(c.hash, 'hex') AS hash, (c.base_revision = 0) AS created
           FROM changes c JOIN nodes n ON n.workspace_id = c.workspace_id AND n.node_id = c.node_id
           JOIN principals a ON a.principal_id = c.actor_id
           WHERE ${where.join(" AND ")} ORDER BY coalesce(c.virtual_at, c.created_at) DESC, c.seq DESC LIMIT $${params.length}`,
          params,
        );
        const authz = yield* Authorizer;
        const mayWrite = new Map<string, boolean>();
        const refs = yield* personRefs(
          ws,
          rows.flatMap((r) => [
            r.actor_id,
            ...(r.on_behalf_of ? [r.on_behalf_of] : []),
            ...(r.approved_by ? [r.approved_by] : []),
          ]),
        );
        for (const r of rows) {
          let ok = mayWrite.get(r.kind);
          if (ok === undefined) {
            const d = yield* authz.authorize(
              ctx.principal,
              "node:write",
              `plinth://${ctx.principal.workspaceSlug}/${r.kind}/`,
            );
            ok = d.kind === "allow";
            mayWrite.set(r.kind, ok);
          }
          const fields = r.paths
            .map((p) => p.replace(/^\/spec\//, "").split("/")[0] ?? p)
            .filter((x, i, a) => x && a.indexOf(x) === i)
            .slice(0, 6);
          const verb = r.undo_of ? "Undid a change to" : r.created ? "Created" : "Edited";
          merged.push({
            at: r.at,
            at_us: r.at_us,
            rank: 0,
            seq: r.seq,
            entry: {
              source: "change",
              seq: Number(r.seq),
              at: r.at,
              actor: ref(refs, r.actor_id),
              on_behalf_of: r.on_behalf_of ? ref(refs, r.on_behalf_of) : null,
              approved_by: r.approved_by ? ref(refs, r.approved_by) : null,
              surface: r.surface,
              what: `${r.kind} ${r.slug} r${r.result_revision}`,
              summary: `${verb} ${r.kind} ${r.slug}${!r.created && fields.length > 0 ? ` (${fields.join(", ")})` : ""}`,
              rule_id: r.rule_id,
              link: LINKS[r.kind]?.(r.slug) ?? null,
              undoable: ok && r.result_revision === r.head_revision,
              hash: r.hash,
            } as Entry,
          });
        }
      }

      // ---- events -------------------------------------------------------------------------------------------
      if (sources.includes("event")) {
        const rows = yield* eventRows(
          ctx,
          { actor: input.actor, from: input.from, to: input.to, text: input.q, region: input.region },
          cur,
          limit + 1,
          "time",
        );
        const refs = yield* personRefs(
          ws,
          rows.flatMap((r) => [r.actor_id]),
        );
        const behalfSubjects = rows.flatMap((r) => (r.on_behalf_of ? [r.on_behalf_of] : []));
        const approverIds = rows.flatMap((r) => (r.approved_by_id ? [r.approved_by_id] : []));
        const more = yield* personRefs(ws, approverIds);
        const behalf = new Map<string, ReturnType<typeof ref>>();
        if (behalfSubjects.length > 0) {
          const bs = yield* q<{ principal_id: string; subject: string }>(
            `SELECT principal_id, subject FROM principals WHERE workspace_id = $1 AND subject = ANY($2::text[])`,
            [ws, pgArr(behalfSubjects)],
          );
          const bref = yield* personRefs(
            ws,
            bs.map((b) => b.principal_id),
          );
          for (const b of bs) behalf.set(b.subject, ref(bref, b.principal_id));
        }
        for (const r of rows) {
          const d = describeEvent(r.type, r.payload);
          merged.push({
            at: r.at,
            at_us: r.at_us,
            rank: 1,
            seq: r.seq,
            entry: {
              source: "event",
              seq: Number(r.seq),
              at: r.at,
              actor: ref(refs, r.actor_id),
              on_behalf_of: r.on_behalf_of ? (behalf.get(r.on_behalf_of) ?? null) : null,
              approved_by: r.approved_by_id ? ref(more, r.approved_by_id) : null,
              surface: r.surface,
              what: r.type,
              summary: d.summary,
              rule_id: [],
              link: d.link,
              undoable: false,
              hash: r.hash,
            } as Entry,
          });
        }
      }

      merged.sort((a, b) =>
        a.at_us !== b.at_us
          ? a.at_us < b.at_us
            ? 1
            : -1
          : a.rank !== b.rank
            ? b.rank - a.rank
            : Number(b.seq) - Number(a.seq),
      );
      const page = merged.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((m) => m.entry),
        next_cursor: merged.length > limit && last ? encodeCursor([last.at_us, last.rank, last.seq]) : null,
      };
    }),
};

// ---- events --------------------------------------------------------------------------------------------

const events: ActionHandler<
  S.Schema.Type<typeof SuiteWork.AuditEventsIn>,
  S.Schema.Type<typeof SuiteWork.AuditEventsOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const limit = limitOf(input.limit, 50);
      const cursor = decodeCursor(input.cursor);
      const rows = yield* eventRows(
        ctx,
        {
          types: input.types,
          actor: input.actor,
          memberHandle: input.member,
          subjectKind: input.subject_kind,
          subjectId: input.subject_id,
          from: input.from,
          to: input.to,
        },
        cursor && cursor.length === 1 ? { at: "", rank: 1, seq: cursor[0] as string } : undefined,
        limit + 1,
        "seq",
      );
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => ({
          seq: Number(r.seq),
          type: r.type,
          occurred_at: r.at,
          actor: r.actor,
          on_behalf_of: r.on_behalf_of,
          surface: r.surface,
          subject: r.subject_kind && r.subject_id ? { kind: r.subject_kind, id: r.subject_id } : null,
          cause: r.cause ?? null,
          payload: r.payload,
        })),
        next_cursor: rows.length > limit && last ? encodeCursor([last.seq]) : null,
      } as never;
    }),
};

// ---- verify --------------------------------------------------------------------------------------------

const verify: ActionHandler<unknown, S.Schema.Type<typeof SuiteWork.AuditVerifyOut>> = {
  run: (_i, ctx) =>
    Effect.gen(function* () {
      const log = yield* ChangeLog;
      const ws = ctx.principal.workspaceId;
      const changes = yield* log.verify(ws);
      const domain = yield* verifyDomainChain(ws);
      return { changes, domain, verified_at: ctx.now.toISOString() } as never;
    }),
};

export const auditHandlers = {
  "audit.timeline": timeline,
  "audit.events": events,
  "audit.verify": verify,
} satisfies HandlerTable;
