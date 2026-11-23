import { Effect } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { StoreLive, relayLoop } from "@plinth/engine";
import { gateway } from "./gateway";

// The recovery relay runs beside the gateway: it re-notifies any outbox row whose wake-up was missed.
const program = Effect.scoped(
  Effect.gen(function* () {
    yield* Effect.forkScoped(relayLoop);
    return yield* gateway;
  }),
);

NodeRuntime.runMain(program.pipe(Effect.provide(StoreLive)));
