import { Effect } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { StoreLive, migrate } from "@plinth/engine";

const program = migrate.pipe(
  Effect.flatMap((applied) => Effect.logInfo(`migrations applied: ${applied.join(", ") || "none"}`)),
);
NodeRuntime.runMain(program.pipe(Effect.provide(StoreLive)));
