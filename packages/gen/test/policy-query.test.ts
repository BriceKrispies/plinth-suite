import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Layer } from "effect";
import { workspaceId } from "@plinth/core";
import { DomainError, type QueryAst } from "@plinth/spec";
import {
  BlobStore,
  ChangeLog,
  ControlStore,
  EngineLive,
  Identity,
  QueryEngine,
  resetAndSeed,
  store,
} from "@plinth/engine";
import { ParquetWriterLive, landPartition } from "@plinth/ingest";
import { HISTORY_FAULT, ORDERS_COLUMNS, generateWindow, partitionKeyOf } from "../src";

// Needs Postgres, object storage and DuckDB (compose stack). Runs against the isolated plinth_test database.
const Live = Layer.mergeAll(EngineLive, ParquetWriterLive);

const start = new Date("2026-11-20T13:30:00Z");
const end = new Date("2026-11-20T14:30:00Z");

const setup = Effect.gen(function* () {
  const { workspaceId: ws, runPrefix } = yield* resetAndSeed;
  const blob = yield* BlobStore;
  yield* blob.ensureBucket;
  const rows = generateWindow(
    {
      seed: 2026,
      workspaceId: workspaceId("northwind"),
      ordersPerDay: 20_000,
      fault: HISTORY_FAULT("2026-11-20"),
      historyEnd: end,
    },
    start,
    end,
  );
  yield* landPartition({
    sourceId: "orders",
    shard: 0,
    partitionKey: partitionKeyOf("orders", 0, start, end),
    runPrefix,
    eventMin: start,
    eventMax: end,
    columns: ORDERS_COLUMNS,
    rows,
  });
  const id = yield* Identity;
  return {
    ws,
    ops: yield* id.bySubject("user:ops-lead"),
    emea: yield* id.bySubject("user:emea-lead"),
    agent: yield* id.bySubject("agent:claude-code"),
  };
});

const byRegion = (extra: Partial<QueryAst> = {}): QueryAst => ({
  from: "source:orders",
  where: [{ field: "placed_at", op: "gte", value: "2026-11-20T13:30:00Z" }],
  group: ["region"],
  aggregate: { n: { fn: "count" } },
  order: [{ field: "region", dir: "asc" }],
  ...extra,
});

describe("row security and masks through the compiler (rls_differential, cache_isolation)", () => {
  it.effect("the EMEA lead sees only EMEA rows on the Ops board; the presenter sees every region", () =>
    Effect.gen(function* () {
      const { ops, emea } = yield* setup;
      const engine = yield* QueryEngine;
      const all = yield* engine.run({ principal: ops, ast: byRegion() });
      const scoped = yield* engine.run({ principal: emea, ast: byRegion(), dashboard: "ops-board" });
      expect(all.rows.map((r) => r[0])).toEqual(["ANZ", "APAC", "EMEA", "LATAM", "NA"]);
      expect(scoped.rows.map((r) => r[0])).toEqual(["EMEA"]);
      expect(scoped.rows[0]?.[1]).toBe(all.rows[2]?.[1]);
      expect(scoped.policy_hash).not.toBe(all.policy_hash);
      // the cache key includes the policy hash: the same query never returns another principal's rows
      const again = yield* engine.run({ principal: ops, ast: byRegion() });
      expect(again.cache).toBe("hit");
      expect(again.rows).toEqual(all.rows);
      // the EMEA lead has no query:run on a source outside a dashboard context
      const direct = yield* engine.run({ principal: emea, ast: byRegion() }).pipe(Effect.either);
      expect(Either.isLeft(direct) && direct.left instanceof DomainError && direct.left.code).toBe(
        "FORBIDDEN",
      );
    }).pipe(Effect.provide(Live)),
  );

  it.effect(
    "the predicate applies before any operator: a derived or grouped path cannot reach other regions",
    () =>
      Effect.gen(function* () {
        const { emea } = yield* setup;
        const engine = yield* QueryEngine;
        const r = yield* engine.run({
          principal: emea,
          dashboard: "ops-board",
          ast: {
            from: "source:orders",
            where: [{ field: "placed_at", op: "gte", value: "2026-11-20T13:30:00Z" }],
            derive: { everyone: "region != 'EMEA'" },
            group: ["everyone"],
            aggregate: { n: { fn: "count" } },
          },
        });
        expect(r.rows.map((x) => x[0])).toEqual([false]);
      }).pipe(Effect.provide(Live)),
  );

  it.effect("query.explain prints the injected predicates and the policy hash that run reports", () =>
    Effect.gen(function* () {
      const { emea } = yield* setup;
      const engine = yield* QueryEngine;
      const ex = yield* engine.explain({ principal: emea, ast: byRegion(), dashboard: "ops-board" });
      const run = yield* engine.run({ principal: emea, ast: byRegion(), dashboard: "ops-board" });
      expect(ex.policy_hash).toBe(run.policy_hash);
      expect(ex.injected_predicates.map((p) => p.kind)).toEqual(expect.arrayContaining(["workspace", "row"]));
      expect(ex.masked_columns).toEqual(["customer_ref"]);
      expect(ex.compiled_sql).not.toContain("EMEA");
    }).pipe(Effect.provide(Live)),
  );

  it.effect("a masked column answers UNKNOWN_FIELD exactly like an absent one", () =>
    Effect.gen(function* () {
      const { ops } = yield* setup;
      const engine = yield* QueryEngine;
      const a = yield* engine
        .run({ principal: ops, ast: byRegion({ group: ["customer_ref"] }) })
        .pipe(Effect.either);
      const b = yield* engine
        .run({ principal: ops, ast: byRegion({ group: ["no_such_col"] }) })
        .pipe(Effect.either);
      expect(Either.isLeft(a) && Either.isLeft(b)).toBe(true);
      if (
        Either.isLeft(a) &&
        Either.isLeft(b) &&
        a.left instanceof DomainError &&
        b.left instanceof DomainError
      ) {
        expect(a.left.code).toBe("UNKNOWN_FIELD");
        expect(a.left.allowed).toEqual(b.left.allowed);
      }
    }).pipe(Effect.provide(Live)),
  );

  it.effect("a quoted string is an error, never a silent zero rows", () =>
    Effect.gen(function* () {
      const { ops } = yield* setup;
      const engine = yield* QueryEngine;
      const r = yield* engine
        .run({
          principal: ops,
          ast: byRegion({
            where: [
              { field: "placed_at", op: "gte", value: "2026-11-20T13:30:00Z" },
              { field: "region", op: "eq", value: "'EMEA'" },
            ],
          }),
        })
        .pipe(Effect.either);
      expect(Either.isLeft(r) && r.left instanceof DomainError && r.left.message).toContain(
        "value looks quoted",
      );
    }).pipe(Effect.provide(Live)),
  );

  it.effect("timestamp subtraction is milliseconds and bucket() builds a one-minute series", () =>
    Effect.gen(function* () {
      const { ops } = yield* setup;
      const engine = yield* QueryEngine;
      const r = yield* engine.run({
        principal: ops,
        ast: {
          from: "source:orders",
          where: [
            { field: "placed_at", op: "gte", value: "2026-11-20T14:00:00Z" },
            { field: "handed_to_carrier_at", op: "not_null" },
          ],
          derive: { handoff_ms: "handed_to_carrier_at - packed_at", minute: "bucket(placed_at, '1 minute')" },
          group: ["minute"],
          aggregate: { p50: { fn: "percentile", of: "handoff_ms", p: 0.5 } },
          order: [{ field: "minute", dir: "asc" }],
          limit: 100,
        },
      });
      expect(r.row_count).toBeGreaterThan(20);
      const first = r.rows[0] ?? [];
      expect(String(first[0]).endsWith(":00.000Z")).toBe(true);
      expect(Number(first[1])).toBeGreaterThan(50); // milliseconds, not seconds
      expect(Number(first[1])).toBeLessThan(2000);
    }).pipe(Effect.provide(Live)),
  );

  it.effect(
    "audit.changes is queried through the same compiler, with grants applied (beat 3: 0 changes in window)",
    () =>
      Effect.gen(function* () {
        const { ops, emea, agent } = yield* setup;
        const engine = yield* QueryEngine;
        const q = (from: string, until: string): QueryAst => ({
          from: "source:audit.changes",
          where: [
            { field: "virtual_at", op: "gte", value: from },
            { field: "virtual_at", op: "lt", value: until },
            { field: "node_kind", op: "eq", value: "Dashboard" },
          ],
          aggregate: { changes: { fn: "count" } },
        });
        // every seed change was written at the configured virtual time (14:30): none fall in 14:00 to 14:20
        const window = yield* engine.run({
          principal: ops,
          ast: q("2026-11-20T14:00:00Z", "2026-11-20T14:20:00Z"),
        });
        expect(window.rows[0]?.[0]).toBe(0);
        const wide = yield* engine.run({
          principal: agent,
          ast: q("2026-11-20T00:00:00Z", "2026-11-20T23:00:00Z"),
        });
        expect(Number(wide.rows[0]?.[0])).toBeGreaterThanOrEqual(2);
        const log = yield* ChangeLog;
        expect(
          (yield* log.headSeq(
            (yield* Identity.pipe(Effect.flatMap((i) => i.bySubject("user:ops-lead")))).workspaceId,
          )) > 0,
        ).toBe(true);
        // the EMEA lead holds no query:run on the audit source
        const denied = yield* engine
          .run({ principal: emea, ast: q("2026-11-20T00:00:00Z", "2026-11-20T23:00:00Z") })
          .pipe(Effect.either);
        expect(Either.isLeft(denied)).toBe(true);
        const { sql } = yield* ControlStore;
        void store;
        void sql;
      }).pipe(Effect.provide(Live)),
  );
});
