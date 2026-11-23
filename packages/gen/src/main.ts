import { Effect, Layer } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { AppConfigLive, BlobStore, BlobStoreLive, ControlStoreLive } from "@plinth/engine";
import { ParquetWriterLive } from "@plinth/ingest";
import { buildHistory } from "./history";
import { controlServer, liveLoop } from "./live";

const AppLive = Layer.mergeAll(BlobStoreLive, ParquetWriterLive).pipe(
  Layer.provideMerge(ControlStoreLive),
  Layer.provideMerge(AppConfigLive),
);

/** `gen` builds the seeded history. `gen live` runs the virtual clock, emits a partition per tick and serves the presenter control API. */
const live = process.argv.slice(2).includes("live");

const program = live
  ? Effect.scoped(
      Effect.gen(function* () {
        const blob = yield* BlobStore;
        yield* blob.ensureBucket;
        yield* controlServer;
        yield* liveLoop;
      }),
    )
  : Effect.gen(function* () {
      const blob = yield* BlobStore;
      yield* blob.ensureBucket;
      const n = yield* buildHistory;
      yield* Effect.logInfo(`history built: ${n} new partitions`);
    });

NodeRuntime.runMain(program.pipe(Effect.provide(AppLive)));
