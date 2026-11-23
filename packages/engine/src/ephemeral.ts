import { Context, Effect, Layer, PubSub, Stream } from "effect";
import type { EphemeralError } from "./errors";

/**
 * Ephemeral store: presence and non-authoritative signals only. L1 ships an in-memory Layer for a single process;
 * a multi-replica Layer can implement the same Tag later. Nothing here carries authority.
 */
export class Ephemeral extends Context.Tag("plinth/Ephemeral")<
  Ephemeral,
  {
    readonly publish: (channel: string, message: string) => Effect.Effect<void, EphemeralError>;
    readonly subscribe: (channel: string) => Stream.Stream<string, EphemeralError>;
    readonly ping: Effect.Effect<void, EphemeralError>;
  }
>() {}

export const EphemeralMemory = Layer.effect(
  Ephemeral,
  Effect.gen(function* () {
    const channels = new Map<string, PubSub.PubSub<string>>();
    const get = (c: string) =>
      Effect.gen(function* () {
        const existing = channels.get(c);
        if (existing) return existing;
        const ps = yield* PubSub.unbounded<string>();
        channels.set(c, ps);
        return ps;
      });
    return Ephemeral.of({
      publish: (c, m) => Effect.flatMap(get(c), (ps) => PubSub.publish(ps, m)).pipe(Effect.asVoid),
      subscribe: (c) => Stream.unwrapScoped(Effect.map(get(c), (ps) => Stream.fromPubSub(ps))),
      ping: Effect.void,
    });
  }),
);
