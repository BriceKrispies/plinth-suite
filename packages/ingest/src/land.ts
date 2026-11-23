import { Effect } from "effect";
import { sha256 } from "@plinth/core";
import { BlobStore, ControlStore, store, type BlobError, type StoreError } from "@plinth/engine";
import { ParquetWriter, type ColumnDef } from "./parquet";
import type { EngineError } from "@plinth/engine";

/**
 * Landing and publish-by-rename (spec 05 section 8.8). A partition becomes visible to queries only through its
 * `source_partitions` row, and that row is written after the final object exists. Temporary objects are never named
 * in a plan.
 */
export interface PartitionInput {
  readonly sourceId: string;
  readonly shard: number;
  /** Deterministic from source, shard, window: a re-landed window writes the same key and is a no-op. */
  readonly partitionKey: string;
  readonly runPrefix: string;
  /** The window `[eventMin, eventMax)` this partition covers. `eventMax` is the watermark it advances to. */
  readonly eventMin: Date;
  readonly eventMax: Date;
  readonly columns: ReadonlyArray<ColumnDef>;
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

export interface StagedPartition {
  readonly input: PartitionInput;
  readonly objectKey: string;
  readonly contentHash: Buffer;
}

export const tmpKeyOf = (runPrefix: string, partitionKey: string): string =>
  `${runPrefix}/_tmp/${partitionKey}`;
export const finalKeyOf = (
  runPrefix: string,
  sourceId: string,
  shard: number,
  partitionKey: string,
): string => `${runPrefix}/${sourceId}/${shard}/${partitionKey}.parquet`;

/** Steps 1 and 2: write to the temp key, copy to the final key, delete the temp object. Nothing is visible yet. */
export const stagePartition = (
  input: PartitionInput,
): Effect.Effect<StagedPartition, BlobError | EngineError, BlobStore | ParquetWriter> =>
  Effect.gen(function* () {
    const blob = yield* BlobStore;
    const writer = yield* ParquetWriter;
    const bytes = yield* writer.write(input.columns, input.rows);
    const tmp = tmpKeyOf(input.runPrefix, input.partitionKey);
    const finalKey = finalKeyOf(input.runPrefix, input.sourceId, input.shard, input.partitionKey);
    yield* blob.put(tmp, bytes, "application/vnd.apache.parquet");
    yield* blob.copy(tmp, finalKey);
    yield* blob.remove(tmp);
    return { input, objectKey: finalKey, contentHash: sha256(bytes) };
  });

/**
 * Step 3: in one transaction insert the `source_partitions` row (published, `shard_seq` = previous shard maximum
 * plus one) and notify. `ON CONFLICT DO NOTHING` makes a re-landed window a no-op. Returns whether this call
 * published the partition.
 */
export const publishPartition = (staged: StagedPartition): Effect.Effect<boolean, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const i = staged.input;
    return yield* store(
      sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${i.sourceId}))`;
          const rows = yield* sql<{ partition_key: string }>`
            INSERT INTO source_partitions (source_id, shard, shard_seq, partition_key, object_key, event_min, event_max,
                                           row_count, content_hash, published, published_at)
            SELECT ${i.sourceId}, ${i.shard}, coalesce(max(shard_seq), 0) + 1, ${i.partitionKey}, ${staged.objectKey},
                   ${i.eventMin.toISOString()}::timestamptz, ${i.eventMax.toISOString()}::timestamptz,
                   ${i.rows.length}, ${staged.contentHash}, true, now()
            FROM source_partitions WHERE source_id = ${i.sourceId} AND shard = ${i.shard}
            ON CONFLICT (source_id, partition_key) DO NOTHING
            RETURNING partition_key`;
          yield* sql`SELECT pg_notify('plinth_watermark', ${i.sourceId})`;
          return rows.length > 0;
        }),
      ),
    );
  });

export const landPartition = (input: PartitionInput) =>
  stagePartition(input).pipe(
    Effect.flatMap((s) => publishPartition(s).pipe(Effect.map((published) => ({ ...s, published })))),
  );
