import { Effect, Layer } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { AppConfig, BlobStore, StoreLive, resetAndSeed } from "@plinth/engine";
import { runSuiteSeed } from "@plinth/gen";
import { DEFAULT_HOOKS, drainEngines } from "@plinth/worker";

/**
 * Reset the control store to the seed with a new run prefix, delete objects of older run prefixes, then run the Suite
 * seed (K12): people, roles, groups, ledger opening balances and the domain steps, with the engines drained inline
 * after each command.
 */
const program = Effect.gen(function* () {
  const blob = yield* BlobStore;
  const cfg = yield* AppConfig;
  yield* blob.ensureBucket;
  const { runPrefix, workspaceId } = yield* resetAndSeed;
  const old = yield* blob.list("runs/");
  yield* Effect.forEach(
    old.filter((k) => !k.startsWith(runPrefix + "/")),
    (k) => blob.remove(k),
    { concurrency: 8, discard: true },
  );
  yield* Effect.logInfo(`reset complete, run prefix ${runPrefix}; removed ${old.length} old objects`);
  const ran = yield* runSuiteSeed({
    drain: (at) =>
      drainEngines(DEFAULT_HOOKS, { workspaceId, workspaceSlug: cfg.workspaceSlug, now: at }).pipe(
        Effect.asVoid,
      ),
  });
  yield* Effect.logInfo(`suite seed complete: ${ran.join(", ")}`);
});

NodeRuntime.runMain(program.pipe(Effect.provide(Layer.fresh(StoreLive))));
