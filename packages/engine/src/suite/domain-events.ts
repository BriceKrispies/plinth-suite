import { Effect } from "effect";
import { GENESIS_HASH, canonicalize, sha256 } from "@plinth/core";
import type { DOMAIN_EVENT_PAYLOADS, DomainEventType, Surface } from "@plinth/spec";
import { ControlStore, store } from "../control-store";
import type { StoreError } from "../errors";

/** A principal as the domain chain names it: the id for the foreign key, the subject for the hash. */
export interface PrincipalRef {
  readonly id: string;
  readonly subject: string;
}

export type EventPayload<T extends DomainEventType> = (typeof DOMAIN_EVENT_PAYLOADS)[T]["Type"];

export interface DomainEventInput<T extends DomainEventType = DomainEventType> {
  readonly type: T;
  readonly occurredAt: Date;
  readonly actor: PrincipalRef;
  readonly onBehalfOf?: PrincipalRef | undefined;
  readonly approvedBy?: PrincipalRef | undefined;
  readonly surface: Surface;
  readonly sessionId?: string | undefined;
  /** `*`, a subject, or `role:<slug>`: who the realtime stream delivers the event to. At least one entry. */
  readonly audience: ReadonlyArray<string>;
  readonly subject?: { readonly kind: string; readonly id: string } | undefined;
  /** The member the event is about; drives badges, automations and activity timelines. */
  readonly member?: PrincipalRef | undefined;
  readonly payload: EventPayload<T>;
  /** Set when an automation step produced the event. */
  readonly cause?:
    | {
        readonly automation: string;
        readonly run_id: string;
        readonly step_index: number;
        readonly depth: number;
      }
    | undefined;
}

const pgTextArray = (xs: ReadonlyArray<string>): string =>
  "{" + xs.map((s) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"').join(",") + "}";

/** The fields the hash covers (CONTRACT.md 2.4, "Domain event hash"). Subjects are text; `prev_hash` is hex. */
export interface DomainEventHashFields {
  readonly workspace_id: string;
  readonly seq: number;
  readonly type: string;
  readonly occurred_at: string;
  readonly actor: string;
  readonly on_behalf_of: string | null;
  readonly approved_by: string | null;
  readonly surface: string;
  readonly audience: ReadonlyArray<string>;
  readonly subject_kind: string | null;
  readonly subject_id: string | null;
  readonly member: string | null;
  readonly payload: unknown;
  readonly cause: unknown;
  readonly prev_hash: string;
}

export const domainEventHash = (f: DomainEventHashFields): Buffer => sha256(canonicalize(f));

/** Create the chain head for a workspace if it does not exist yet (idempotent). */
export const ensureDomainChain = (ws: string): Effect.Effect<void, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    yield* store(
      sql`INSERT INTO domain_chain (workspace_id, head_seq, head_hash) VALUES (${ws}, 0, ${GENESIS_HASH})
          ON CONFLICT (workspace_id) DO NOTHING`,
    );
  });

/**
 * Append one event to the workspace chain. Takes `domain_chain FOR UPDATE` (the last lock of the Suite lock order), so
 * every writer serialises here and `seq` is gapless. Must run inside the action's transaction; the NOTIFY is delivered
 * at COMMIT. Returns the event's seq.
 */
export const emitDomainEvent = <T extends DomainEventType>(
  ws: string,
  ev: DomainEventInput<T>,
): Effect.Effect<number, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    yield* ensureDomainChain(ws);
    const head = yield* store(
      sql<{ head_seq: string; head_hash: Buffer }>`
        SELECT head_seq, head_hash FROM domain_chain WHERE workspace_id = ${ws} FOR UPDATE`,
    );
    const h = head[0];
    const prevSeq = Number(h?.head_seq ?? 0);
    const prevHash = h?.head_hash ?? GENESIS_HASH;
    const seq = prevSeq + 1;
    const occurred = ev.occurredAt.toISOString();
    // hash the JSON round trip, so `undefined` properties cannot make the stored row differ from what was hashed
    const cause = ev.cause === undefined ? null : (JSON.parse(JSON.stringify(ev.cause)) as unknown);
    const payload = JSON.parse(JSON.stringify(ev.payload)) as unknown;
    const hash = domainEventHash({
      workspace_id: ws,
      seq,
      type: ev.type,
      occurred_at: occurred,
      actor: ev.actor.subject,
      on_behalf_of: ev.onBehalfOf?.subject ?? null,
      approved_by: ev.approvedBy?.subject ?? null,
      surface: ev.surface,
      audience: ev.audience,
      subject_kind: ev.subject?.kind ?? null,
      subject_id: ev.subject?.id ?? null,
      member: ev.member?.subject ?? null,
      payload,
      cause,
      prev_hash: Buffer.from(prevHash).toString("hex"),
    });
    yield* store(
      sql`
        INSERT INTO domain_events (workspace_id, seq, type, occurred_at, actor_id, on_behalf_of, approved_by, surface, session_id,
                                   audience, subject_kind, subject_id, member_id, payload, cause, cause_depth, prev_hash, hash)
        VALUES (${ws}, ${seq}, ${ev.type}, ${occurred}::timestamptz, ${ev.actor.id}, ${ev.onBehalfOf?.id ?? null},
                ${ev.approvedBy?.id ?? null}, ${ev.surface}, ${ev.sessionId ?? null}, ${pgTextArray(ev.audience)}::text[],
                ${ev.subject?.kind ?? null}, ${ev.subject?.id ?? null}, ${ev.member?.id ?? null},
                ${JSON.stringify(payload)}::jsonb, ${cause === null ? null : JSON.stringify(cause)}::jsonb,
                ${ev.cause?.depth ?? 0}, ${prevHash}, ${hash})`,
    );
    yield* store(
      sql`UPDATE domain_chain SET head_seq = ${seq}, head_hash = ${hash} WHERE workspace_id = ${ws}`,
    );
    yield* store(sql`SELECT pg_notify('plinth_domain', ${ws})`);
    return seq;
  });

/** What an emitter needs to attribute an event: satisfied by `ActionCtx`, and built by the worker and engines. */
export interface EmitCtx {
  readonly principal: PrincipalRef & { readonly workspaceId: string };
  readonly onBehalfOf?: PrincipalRef | undefined;
  readonly approvedBy?: PrincipalRef | undefined;
  readonly surface: Surface;
  readonly sessionId?: string | undefined;
  /** Virtual time of the command. */
  readonly now: Date;
}

/** Emit as the action's caller: actor, on_behalf_of, approver, surface and session come from the context. */
export const emitFrom = <T extends DomainEventType>(
  ctx: EmitCtx,
  type: T,
  fields: {
    readonly audience: ReadonlyArray<string>;
    readonly payload: EventPayload<T>;
    readonly subject?: { readonly kind: string; readonly id: string } | undefined;
    readonly member?: PrincipalRef | undefined;
    readonly cause?: DomainEventInput<T>["cause"];
    readonly occurredAt?: Date;
  },
): Effect.Effect<number, StoreError, ControlStore> =>
  emitDomainEvent(ctx.principal.workspaceId, {
    type,
    occurredAt: fields.occurredAt ?? ctx.now,
    actor: ctx.principal,
    onBehalfOf: ctx.onBehalfOf,
    approvedBy: ctx.approvedBy,
    surface: ctx.surface,
    sessionId: ctx.sessionId,
    audience: fields.audience,
    subject: fields.subject,
    member: fields.member,
    payload: fields.payload,
    cause: fields.cause,
  });

export interface DomainVerifyResult {
  readonly ok: boolean;
  readonly checked: number;
  readonly head_seq: number;
  readonly head_hash: string;
  readonly error?: { readonly seq: number; readonly reason: string };
}

/** Recompute the domain chain (`GET /suite/audit/verify`, AC-AUDIT-CHAINS): hashes, links, gapless seq, head. */
export const verifyDomainChain = (ws: string): Effect.Effect<DomainVerifyResult, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const head = yield* store(
      sql<{
        head_seq: string;
        head_hash: Buffer;
      }>`SELECT head_seq, head_hash FROM domain_chain WHERE workspace_id = ${ws}`,
    );
    const rows = yield* store(
      sql<{
        seq: string;
        type: string;
        occurred_at: string;
        actor: string;
        on_behalf_of: string | null;
        approved_by: string | null;
        surface: string;
        audience: string[];
        subject_kind: string | null;
        subject_id: string | null;
        member: string | null;
        payload: unknown;
        cause: unknown;
        prev_hash: Buffer;
        hash: Buffer;
      }>`
        SELECT e.seq, e.type,
               to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at,
               a.subject AS actor, o.subject AS on_behalf_of, ap.subject AS approved_by, e.surface, e.audience,
               e.subject_kind, e.subject_id, m.subject AS member, e.payload, e.cause, e.prev_hash, e.hash
        FROM domain_events e
        JOIN principals a ON a.principal_id = e.actor_id
        LEFT JOIN principals o ON o.principal_id = e.on_behalf_of
        LEFT JOIN principals ap ON ap.principal_id = e.approved_by
        LEFT JOIN principals m ON m.principal_id = e.member_id
        WHERE e.workspace_id = ${ws} ORDER BY e.seq`,
    );
    let prev: Buffer = GENESIS_HASH;
    let expectSeq = 1;
    for (const r of rows) {
      const seq = Number(r.seq);
      const bad = (reason: string): DomainVerifyResult => ({
        ok: false,
        checked: expectSeq - 1,
        head_seq: Number(head[0]?.head_seq ?? 0),
        head_hash: Buffer.from(head[0]?.head_hash ?? GENESIS_HASH).toString("hex"),
        error: { seq, reason },
      });
      if (seq !== expectSeq) return bad(`seq gap: expected ${expectSeq}`);
      if (Buffer.compare(r.prev_hash, prev) !== 0)
        return bad("prev_hash does not link to the previous event");
      const want = domainEventHash({
        workspace_id: ws,
        seq,
        type: r.type,
        occurred_at: r.occurred_at,
        actor: r.actor,
        on_behalf_of: r.on_behalf_of,
        approved_by: r.approved_by,
        surface: r.surface,
        audience: r.audience,
        subject_kind: r.subject_kind,
        subject_id: r.subject_id,
        member: r.member,
        payload: r.payload,
        cause: r.cause,
        prev_hash: Buffer.from(r.prev_hash).toString("hex"),
      });
      if (Buffer.compare(want, r.hash) !== 0) return bad("hash mismatch: the event was altered");
      prev = r.hash;
      expectSeq += 1;
    }
    const headSeq = Number(head[0]?.head_seq ?? 0);
    const headHash = Buffer.from(head[0]?.head_hash ?? GENESIS_HASH);
    if (headSeq !== rows.length || Buffer.compare(headHash, prev) !== 0)
      return {
        ok: false,
        checked: rows.length,
        head_seq: headSeq,
        head_hash: headHash.toString("hex"),
        error: { seq: rows.length, reason: "domain_chain head does not match the last event" },
      };
    return { ok: true, checked: rows.length, head_seq: headSeq, head_hash: headHash.toString("hex") };
  });
