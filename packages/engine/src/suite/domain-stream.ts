import { Effect } from "effect";
import type { DomainEvent, DomainEventType } from "@plinth/spec";
import { Authorizer } from "../authz";
import { ControlStore, store } from "../control-store";
import type { StoreError } from "../errors";
import type { Principal } from "../identity";

/**
 * The server side of the realtime `domain` stream (CONTRACT.md 6.1). A domain event is delivered to a principal only
 * when its `audience` contains `*`, the principal's subject, or `role:<r>` for a Role the principal holds; an agent
 * matches its delegator's audience (and its own subject). Nothing in a notification carries authority: the gateway reads
 * `domain_events` itself, through these functions, on every wake-up.
 */

/** Postgres channel a Suite write notifies with the workspace id. */
export const DOMAIN_CHANNEL = "plinth_domain";

/** The audience entries a principal matches. */
export const audienceOf = (p: Principal): Effect.Effect<ReadonlyArray<string>, StoreError, Authorizer> =>
  Effect.gen(function* () {
    const authz = yield* Authorizer;
    const snap = yield* authz.snapshot(p);
    const effective = p.kind === "agent" ? (p.delegatorSubject ?? p.subject) : p.subject;
    const roles = (snap.roleMembers?.get(effective) ?? []).map((r) => `role:${r.role}`);
    return [...new Set(["*", p.subject, effective, ...roles])];
  });

export const domainHead = (ws: string): Effect.Effect<number, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{
        head_seq: string;
      }>`SELECT head_seq::text AS head_seq FROM domain_chain WHERE workspace_id = ${ws}`,
    );
    return Number(rows[0]?.head_seq ?? 0);
  });

interface Row {
  seq: string;
  type: DomainEventType;
  occurred_at: string;
  actor: string;
  on_behalf_of: string | null;
  surface: string;
  subject_kind: string | null;
  subject_id: string | null;
  cause: unknown;
  payload: unknown;
}

/**
 * Visible events with `after < seq <= through`, where `through = min(head, after + window)`. The caller advances its
 * cursor to `through` even when `items` is empty, so events hidden from the principal are never re-read.
 */
export const domainEventsSince = (
  ws: string,
  audience: ReadonlyArray<string>,
  after: number,
  opts?: { readonly types?: ReadonlyArray<DomainEventType> | undefined; readonly window?: number },
): Effect.Effect<{ items: ReadonlyArray<DomainEvent>; through: number }, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const head = yield* domainHead(ws);
    const through = Math.min(head, after + (opts?.window ?? 500));
    if (through <= after) return { items: [], through: after };
    const types = opts?.types && opts.types.length > 0 ? [...opts.types] : null;
    const aud =
      "{" + audience.map((s) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"').join(",") + "}";
    const rows = yield* store(
      sql<Row>`
        SELECT e.seq::text AS seq, e.type,
               to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at,
               a.subject AS actor, o.subject AS on_behalf_of, e.surface, e.subject_kind, e.subject_id, e.cause, e.payload
        FROM domain_events e
        JOIN principals a ON a.principal_id = e.actor_id
        LEFT JOIN principals o ON o.principal_id = e.on_behalf_of
        WHERE e.workspace_id = ${ws} AND e.seq > ${after} AND e.seq <= ${through}
          AND e.audience && ${aud}::text[]
          AND (${types === null}::boolean OR e.type = ANY (${types ?? []}::text[]))
        ORDER BY e.seq`,
    );
    const items = rows.map(
      (r) =>
        ({
          seq: Number(r.seq),
          type: r.type,
          occurred_at: r.occurred_at,
          actor: r.actor,
          on_behalf_of: r.on_behalf_of,
          surface: r.surface,
          subject:
            r.subject_kind !== null && r.subject_id !== null
              ? { kind: r.subject_kind, id: r.subject_id }
              : null,
          cause: r.cause ?? null,
          payload: r.payload,
        }) as unknown as DomainEvent,
    );
    return { items, through };
  });

/** An event as the engines (automation, badges) read it: everything, with no audience filter. */
export interface StoredDomainEvent {
  readonly seq: number;
  readonly type: DomainEventType;
  readonly occurredAt: Date;
  readonly actor: { readonly id: string; readonly subject: string };
  readonly onBehalfOf: { readonly id: string; readonly subject: string } | null;
  readonly surface: string;
  readonly subject: { readonly kind: string; readonly id: string } | null;
  /** The member the event is about. */
  readonly member: { readonly id: string; readonly subject: string; readonly handle: string } | null;
  readonly payload: Record<string, unknown>;
  readonly cause: {
    readonly automation: string;
    readonly run_id: string;
    readonly step_index: number;
    readonly depth: number;
  } | null;
  readonly causeDepth: number;
}

/**
 * The next events after a cursor, oldest first, for the engines. The automation and badge engines each keep their own
 * cursor in `engine_cursors`; at-least-once delivery, so consumers must be idempotent (run keys, award uniqueness).
 */
export const domainEventsAfter = (
  ws: string,
  after: number,
  limit = 200,
): Effect.Effect<ReadonlyArray<StoredDomainEvent>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{
        seq: string;
        type: DomainEventType;
        occurred_at: Date;
        actor_id: string;
        actor: string;
        on_behalf_id: string | null;
        on_behalf: string | null;
        surface: string;
        subject_kind: string | null;
        subject_id: string | null;
        member_id: string | null;
        member_subject: string | null;
        member_handle: string | null;
        payload: Record<string, unknown>;
        cause: StoredDomainEvent["cause"];
        cause_depth: number;
      }>`
        SELECT e.seq::text AS seq, e.type, e.occurred_at, e.actor_id, a.subject AS actor, e.on_behalf_of AS on_behalf_id,
               o.subject AS on_behalf, e.surface, e.subject_kind, e.subject_id, e.member_id, m.subject AS member_subject,
               mm.handle AS member_handle, e.payload, e.cause, e.cause_depth
        FROM domain_events e
        JOIN principals a ON a.principal_id = e.actor_id
        LEFT JOIN principals o ON o.principal_id = e.on_behalf_of
        LEFT JOIN principals m ON m.principal_id = e.member_id
        LEFT JOIN members mm ON mm.member_id = e.member_id
        WHERE e.workspace_id = ${ws} AND e.seq > ${after}
        ORDER BY e.seq LIMIT ${limit}`,
    );
    return rows.map((r): StoredDomainEvent => ({
      seq: Number(r.seq),
      type: r.type,
      occurredAt: new Date(r.occurred_at),
      actor: { id: r.actor_id, subject: r.actor },
      onBehalfOf: r.on_behalf_id && r.on_behalf ? { id: r.on_behalf_id, subject: r.on_behalf } : null,
      surface: r.surface,
      subject:
        r.subject_kind !== null && r.subject_id !== null ? { kind: r.subject_kind, id: r.subject_id } : null,
      member:
        r.member_id && r.member_subject && r.member_handle
          ? { id: r.member_id, subject: r.member_subject, handle: r.member_handle }
          : null,
      payload: r.payload,
      cause: r.cause,
      causeDepth: r.cause_depth,
    }));
  });

/** The cursor of an engine consumer (`automation` or `badges`); a missing row reads as 0. */
export const readCursor = (
  ws: string,
  consumer: "automation" | "badges",
): Effect.Effect<number, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{
        last_seq: string;
      }>`SELECT last_seq::text AS last_seq FROM engine_cursors WHERE workspace_id = ${ws} AND consumer = ${consumer}`,
    );
    return Number(rows[0]?.last_seq ?? 0);
  });

export const writeCursor = (
  ws: string,
  consumer: "automation" | "badges",
  seq: number,
): Effect.Effect<void, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    yield* store(
      sql`INSERT INTO engine_cursors (workspace_id, consumer, last_seq) VALUES (${ws}, ${consumer}, ${seq})
          ON CONFLICT (workspace_id, consumer) DO UPDATE SET last_seq = GREATEST(engine_cursors.last_seq, ${seq}), updated_at = now()`,
    );
  });
