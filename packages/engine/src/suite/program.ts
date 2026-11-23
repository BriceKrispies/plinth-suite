import { Effect } from "effect";
import { SUITE_EXAMPLES, type ProgramSpec, type Tier } from "@plinth/spec";
import { ControlStore, store } from "../control-store";
import type { StoreError } from "../errors";

/** The Program policy (node `program:rewards`), or the documented defaults when the node does not exist yet. */
export const loadProgram = (ws: string): Effect.Effect<ProgramSpec, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ body: { spec?: ProgramSpec } }>`
        SELECT body FROM nodes WHERE workspace_id = ${ws} AND kind = 'Program' AND slug = 'rewards' AND deleted_at IS NULL`,
    );
    return rows[0]?.body.spec ?? (SUITE_EXAMPLES.Program.spec as unknown as ProgramSpec);
  });

/** The tier of a lifetime total: the highest tier whose `min_lifetime_points` is reached (invariant L9). */
export const tierOf = (program: Pick<ProgramSpec, "tiers">, lifetime: number): Tier => {
  let best: Tier = "bronze";
  for (const t of program.tiers) if (lifetime >= t.min_lifetime_points) best = t.tier;
  return best;
};

export const TIER_RANK: Readonly<Record<Tier, number>> = { bronze: 0, silver: 1, gold: 2, platinum: 3 };

/** Allocate the next number of a `suite_counters` sequence (`txn`, `order`, `task`). Lock order position 7. */
export const nextCounter = (
  ws: string,
  name: "txn" | "order" | "task",
): Effect.Effect<number, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ value: string }>`
        INSERT INTO suite_counters (workspace_id, name, value) VALUES (${ws}, ${name}, 1)
        ON CONFLICT (workspace_id, name) DO UPDATE SET value = suite_counters.value + 1
        RETURNING value`,
    );
    return Number(rows[0]?.value ?? 1);
  });

/** `R-000123` from the order counter. */
export const orderNo = (n: number): string => `R-${String(n).padStart(6, "0")}`;

/** Add calendar months to a virtual instant (point-lot expiry: `occurred_at + Program.expiry.months`). */
export const addMonths = (d: Date, months: number): Date => {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
};
