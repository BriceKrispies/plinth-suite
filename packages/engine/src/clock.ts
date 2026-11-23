import { Context, Effect, Layer } from "effect";
import { AppConfig } from "./config";
import { ControlStore } from "./control-store";

/**
 * The platform clock (README: Clock and VirtualClock). `now` is wall time, `virtualNow` is the demo time that
 * `as_of` and `virtual_at` follow. When the live generator runs it owns the `virtual_clock` row; without a row the
 * virtual clock is frozen at the configured start time.
 */
export class PlinthClock extends Context.Tag("plinth/Clock")<
  PlinthClock,
  {
    readonly now: Effect.Effect<Date>;
    readonly virtualNow: Effect.Effect<Date>;
  }
>() {
  static readonly fixed = (wall: Date, virtual: Date = wall) =>
    Layer.succeed(PlinthClock, { now: Effect.succeed(wall), virtualNow: Effect.succeed(virtual) });
}

export const parseVirtualStart = (date: string, time: string): Date => new Date(`${date}T${time}Z`);

export interface ClockState {
  readonly virtualRefMs: number;
  readonly wallRefMs: number;
  readonly speed: number;
  readonly paused: boolean;
}

/** Virtual time at a wall instant: `virtual_ref + (wall - wall_ref) * speed`, frozen while paused. Pure. */
export const virtualAt = (s: ClockState, wallMs: number): Date =>
  new Date(s.paused ? s.virtualRefMs : s.virtualRefMs + Math.max(0, wallMs - s.wallRefMs) * s.speed);

export const readClockState = Effect.gen(function* () {
  const { sql } = yield* ControlStore;
  const rows = yield* sql<{ v: string; w: string; speed: number; paused: boolean }>`
    SELECT (extract(epoch FROM virtual_ref) * 1000)::text AS v, (extract(epoch FROM wall_ref) * 1000)::text AS w,
           speed, paused FROM virtual_clock WHERE id = 1`;
  const r = rows[0];
  return r === undefined
    ? undefined
    : ({
        virtualRefMs: Number(r.v),
        wallRefMs: Number(r.w),
        speed: Number(r.speed),
        paused: r.paused,
      } satisfies ClockState);
});

export const PlinthClockLive = Layer.effect(
  PlinthClock,
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const cs = yield* ControlStore;
    const start = parseVirtualStart(cfg.demo.virtualDate, cfg.demo.virtualStart);
    const now = Effect.sync(() => new Date());
    const virtualNow = readClockState.pipe(
      Effect.provideService(ControlStore, cs),
      Effect.map((s) => (s === undefined ? start : virtualAt(s, Date.now()))),
      Effect.catchAll(() => Effect.succeed(start)),
    );
    return PlinthClock.of({ now, virtualNow });
  }),
);

export type ClockAction =
  | { readonly action: "pause" }
  | { readonly action: "resume" }
  | { readonly action: "speed"; readonly speed: number };

/** Apply a presenter clock action at a wall instant: re-anchor the reference so virtual time never jumps. Pure. */
export const applyClockAction = (s: ClockState, a: ClockAction, wallMs: number): ClockState => {
  const vnow = virtualAt(s, wallMs).getTime();
  switch (a.action) {
    case "pause":
      return { ...s, virtualRefMs: vnow, wallRefMs: wallMs, paused: true };
    case "resume":
      return { ...s, virtualRefMs: vnow, wallRefMs: wallMs, paused: false };
    case "speed":
      return { ...s, virtualRefMs: vnow, wallRefMs: wallMs, speed: a.speed };
  }
};
