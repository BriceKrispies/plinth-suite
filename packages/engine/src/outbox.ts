import { Effect, Schedule, Stream } from "effect";
import { ControlStore, store } from "./control-store";
import type { StoreError } from "./errors";

/** Postgres channel a commit notifies with the workspace id. Gateways LISTEN on it and re-read `changes`. */
export const CHANGES_CHANNEL = "plinth_changes";

/** Postgres channel `ui.present` notifies with a JSON `PresentNotice`. Gateways LISTEN on it and push `present` frames. */
export const PRESENT_CHANNEL = "plinth_present";

/**
 * Recovery relay: any outbox row not yet marked relayed is re-notified and marked. The commit transaction already
 * notifies directly, so this only repairs a missed wake-up. Returns the number of rows marked.
 */
export const relayOnce: Effect.Effect<number, StoreError, ControlStore> = Effect.gen(function* () {
  const { sql } = yield* ControlStore;
  return yield* store(
    sql.withTransaction(
      Effect.gen(function* () {
        const rows = yield* sql<{ workspace_id: string; seq: string }>`
          SELECT workspace_id, seq FROM outbox WHERE relayed_at IS NULL
          ORDER BY workspace_id, seq LIMIT 500 FOR UPDATE SKIP LOCKED`;
        const byWs = new Map<string, number[]>();
        for (const r of rows) byWs.set(r.workspace_id, [...(byWs.get(r.workspace_id) ?? []), Number(r.seq)]);
        for (const [ws, seqs] of byWs) {
          yield* sql`SELECT pg_notify(${CHANGES_CHANNEL}, ${ws})`;
          yield* sql`UPDATE outbox SET relayed_at = now() WHERE workspace_id = ${ws} AND seq IN ${sql.in(seqs)}`;
        }
        return rows.length;
      }),
    ),
  );
});

export const relayLoop: Effect.Effect<never, never, ControlStore> = Stream.fromSchedule(
  Schedule.spaced("1 second"),
).pipe(
  Stream.mapEffect(() =>
    relayOnce.pipe(Effect.catchAll((e) => Effect.logWarning(`outbox relay: ${e.message}`))),
  ),
  Stream.runDrain,
  Effect.zipRight(Effect.never),
);
