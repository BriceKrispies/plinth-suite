import { NodeRuntime } from "@effect/platform-node";
import { StoreLive, migrate } from "@plinth/engine";
import { Effect } from "effect";
import { workerProgram } from "./worker";

/** `pnpm start:worker`: the Suite worker (domain-event consumers and the virtual-time scheduler). */
NodeRuntime.runMain(
  Effect.gen(function* () {
    yield* migrate;
    return yield* workerProgram();
  }).pipe(Effect.provide(StoreLive)),
);
