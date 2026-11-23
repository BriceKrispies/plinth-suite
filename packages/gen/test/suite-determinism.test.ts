import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { ControlStore, StoreLive, resetAndSeed, store } from "@plinth/engine";
import { runSuiteSeed } from "../src/suite";

// Needs Postgres (plinth_test). The slow tier: two full seeds, one after the other (a full seed takes about a minute).
// AC-SEED: two resets give identical ids, domain events and ledger.

interface Ev {
  readonly seq: string;
  readonly type: string;
  readonly occurred_at: string;
  readonly actor: string;
  readonly member: string | null;
  readonly subject: string | null;
  readonly payload: unknown;
  readonly hash: string;
}

describe("full seed determinism", () => {
  it.effect(
    "two full seeds give identical domain events and ledger transactions",
    () =>
      Effect.gen(function* () {
        const { sql } = yield* ControlStore;
        const snapshot = Effect.gen(function* () {
          const ev = yield* store(
            sql<Ev>`
              SELECT e.seq::text AS seq, e.type, to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at,
                     a.subject AS actor, m.subject AS member, e.subject_kind || ':' || e.subject_id AS subject, e.payload,
                     encode(e.hash, 'hex') AS hash
              FROM domain_events e JOIN principals a ON a.principal_id = e.actor_id
              LEFT JOIN principals m ON m.principal_id = e.member_id ORDER BY e.seq`,
          );
          const tx = yield* store(
            sql<{
              txn_id: string;
              txn_no: string;
            }>`SELECT txn_id, txn_no::text AS txn_no FROM ledger_transactions ORDER BY txn_no`,
          );
          return { ev, tx: tx.map((t) => `${t.txn_no}:${t.txn_id}`) };
        });
        yield* resetAndSeed;
        yield* runSuiteSeed();
        const a = yield* snapshot;
        yield* resetAndSeed;
        yield* runSuiteSeed();
        const b = yield* snapshot;
        expect(a.ev.length).toBeGreaterThan(500);
        // the first differing event, with both sides in full (the hashes are chained, so later ones differ as well)
        const strip = (e: Ev | undefined) => (e ? { ...e, hash: undefined } : undefined);
        const first = a.ev.findIndex((e, i) => JSON.stringify(strip(e)) !== JSON.stringify(strip(b.ev[i])));
        if (first >= 0)
          expect({ at_index: first, first: strip(a.ev[first]), second: strip(b.ev[first]) }).toEqual({
            at_index: first,
            first: strip(b.ev[first]),
            second: strip(a.ev[first]),
          });
        expect(b.ev.length).toBe(a.ev.length);
        expect(b.ev.map((e) => e.hash)).toEqual(a.ev.map((e) => e.hash));
        expect(b.tx).toEqual(a.tx);
      }).pipe(Effect.provide(StoreLive)),
    900_000,
  );
});
