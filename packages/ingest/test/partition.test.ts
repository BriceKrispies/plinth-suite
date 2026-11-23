import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { BlobStore, ControlStore, StoreLive, resetAndSeed } from "@plinth/engine";
import { ParquetWriterLive, finalKeyOf, publishPartition, stagePartition, tmpKeyOf } from "../src";

// partition_publish_atomic (AC-VS-3). Needs the compose stack.
const Live = Layer.mergeAll(StoreLive, ParquetWriterLive);

const input = {
  sourceId: "orders",
  shard: 0,
  partitionKey: "orders-s0-test-1",
  runPrefix: "test-runs/partition",
  eventMin: new Date("2026-11-20T00:00:00Z"),
  eventMax: new Date("2026-11-20T01:00:00Z"),
  columns: [{ name: "order_id", type: "VARCHAR" as const }],
  rows: [{ order_id: "a" }, { order_id: "b" }],
};

describe("partition publication", () => {
  it.effect("is invisible until its row is written, and the watermark follows the published prefix", () =>
    Effect.gen(function* () {
      yield* resetAndSeed;
      const blob = yield* BlobStore;
      const { sql } = yield* ControlStore;
      yield* blob.ensureBucket;
      const wm = () =>
        sql<{
          wm: string | null;
        }>`SELECT watermark::text AS wm FROM source_watermark WHERE source_id = 'orders'`;

      const staged = yield* stagePartition(input);
      expect(yield* blob.exists(finalKeyOf(input.runPrefix, "orders", 0, input.partitionKey))).toBe(true);
      expect(yield* blob.exists(tmpKeyOf(input.runPrefix, input.partitionKey))).toBe(false);
      expect((yield* sql`SELECT 1 FROM source_partitions WHERE published`).length).toBe(0);
      expect((yield* wm())[0]?.wm).toBe("-infinity");

      expect(yield* publishPartition(staged)).toBe(true);
      // watermark::text renders as "2026-11-20 01:00:00+00"
      expect(
        new Date(`${(yield* wm())[0]?.wm}`.replace(" ", "T").replace(/\+00$/, "Z"))
          .toISOString()
          .slice(0, 13),
      ).toBe("2026-11-20T01");
      // a re-landed window is a no-op
      expect(yield* publishPartition(staged)).toBe(false);
    }).pipe(Effect.provide(Live)),
  );
});
