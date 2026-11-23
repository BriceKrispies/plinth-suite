import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Effect, Either, Runtime, Schedule, Schema } from "effect";
import { workspaceId } from "@plinth/core";
import {
  AppConfig,
  ControlStore,
  applyClockAction,
  parseVirtualStart,
  readClockState,
  store,
  virtualAt,
  type ClockAction,
  type ClockState,
} from "@plinth/engine";
import { landPartition } from "@plinth/ingest";
import { HISTORY_FAULT, ORDERS_COLUMNS, generateWindow, liveFault, type FaultProfile } from "./orders";
import { partitionKeyOf } from "./history";

/**
 * Live mode (spec 09, README ruling 34): a virtual clock (`clock.speed`, default 6) starting at the history end.
 * Every virtual minute the generator emits one Parquet partition of orders placed in that minute and lands it
 * (temp key, publish by rename, `source_partitions` row), so the watermark advances one minute per tick. The rows
 * are a pure function of seed, tick and the cued fault profiles.
 */

const TICK_MS = 60_000;
/** Stage times of an order are well under a second; the lookahead completes every row of the minute. */
const LOOKAHEAD_MS = 10_000;

const iso = (ms: number): string => new Date(ms).toISOString();

const watermarkMs = Effect.gen(function* () {
  const { sql } = yield* ControlStore;
  const rows = yield* store(
    sql<{ wm: string | null }>`
      SELECT CASE WHEN isfinite(watermark) THEN (extract(epoch FROM watermark) * 1000)::text END AS wm
      FROM source_watermark WHERE source_id = 'orders'`,
  );
  const wm = rows[0]?.wm;
  return wm === null || wm === undefined ? undefined : Number(wm);
});

/** Create the clock row at the history end, running at the configured speed, if there is none. */
export const initClock = Effect.gen(function* () {
  const cfg = yield* AppConfig;
  const { sql } = yield* ControlStore;
  const wm = yield* watermarkMs;
  const start = wm ?? parseVirtualStart(cfg.demo.virtualDate, cfg.demo.virtualStart).getTime();
  yield* store(
    sql`INSERT INTO virtual_clock (id, virtual_ref, wall_ref, speed, paused)
        VALUES (1, ${iso(start)}::timestamptz, now(), ${cfg.demo.clockRate}, false)
        ON CONFLICT (id) DO NOTHING`,
  );
});

const readFaults = Effect.gen(function* () {
  const { sql } = yield* ControlStore;
  const rows = yield* store(sql<{ faults: FaultProfile[] }>`SELECT faults FROM virtual_clock WHERE id = 1`);
  return rows[0]?.faults ?? [];
});

const writeClock = (s: ClockState) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    yield* store(
      sql`UPDATE virtual_clock SET virtual_ref = ${iso(s.virtualRefMs)}::timestamptz, wall_ref = ${iso(s.wallRefMs)}::timestamptz,
                                   speed = ${s.speed}, paused = ${s.paused}, updated_at = now() WHERE id = 1`,
    );
  });

/** Emit every tick whose window has fully elapsed on the virtual clock. Returns the number of partitions landed. */
export const emitDueTicks = Effect.gen(function* () {
  const cfg = yield* AppConfig;
  const { sql } = yield* ControlStore;
  const ws = workspaceId(cfg.workspaceSlug);
  const state = yield* readClockState;
  if (!state) return 0;
  const vnow = virtualAt(state, Date.now()).getTime();
  const runs = yield* store(
    sql<{ run_prefix: string }>`SELECT run_prefix FROM workspaces WHERE workspace_id = ${ws}`,
  );
  const runPrefix = runs[0]?.run_prefix;
  if (!runPrefix) return 0;
  let wm = yield* watermarkMs;
  if (wm === undefined) return 0;
  let landed = 0;
  while (wm + TICK_MS <= vnow && landed < 30) {
    const start = new Date(wm);
    const end = new Date(wm + TICK_MS);
    const faults = yield* readFaults;
    const rows = generateWindow(
      {
        seed: cfg.demo.seed,
        workspaceId: ws,
        ordersPerDay: cfg.demo.ordersPerDay,
        fault: HISTORY_FAULT(cfg.demo.virtualDate),
        extraFaults: faults,
        historyEnd: new Date(end.getTime() + LOOKAHEAD_MS),
      },
      start,
      end,
    );
    const r = yield* landPartition({
      sourceId: "orders",
      shard: 0,
      partitionKey: partitionKeyOf("orders", 0, start, end),
      runPrefix,
      eventMin: start,
      eventMax: end,
      columns: ORDERS_COLUMNS,
      rows,
    });
    yield* Effect.logInfo(`tick ${iso(wm)} rows=${rows.length} published=${r.published}`);
    wm += TICK_MS;
    landed += 1;
  }
  return landed;
});

export const liveLoop = Effect.gen(function* () {
  yield* initClock;
  yield* Effect.repeat(
    emitDueTicks.pipe(
      Effect.catchAll((e) =>
        Effect.logWarning(`live tick failed: ${(e as { message?: string }).message ?? e}`),
      ),
    ),
    Schedule.spaced("500 millis"),
  );
});

// ---- presenter control (separate port, separate token, never exposed through MCP) -------------------------------

const ClockBody = Schema.Union(
  Schema.Struct({ action: Schema.Literal("pause", "resume") }),
  Schema.Struct({ action: Schema.Literal("speed"), speed: Schema.Number.pipe(Schema.between(0.1, 600)) }),
);

export const controlStatus = Effect.gen(function* () {
  const state = yield* readClockState;
  const wm = yield* watermarkMs;
  const faults = yield* readFaults;
  return {
    wall_now: iso(Date.now()),
    virtual_now: state ? virtualAt(state, Date.now()).toISOString() : null,
    speed: state?.speed ?? null,
    paused: state?.paused ?? null,
    watermark: wm === undefined ? null : iso(wm),
    faults,
    next_tick: wm === undefined ? null : iso(wm),
  };
});

/** Cue the live fault: the EMEA/Crane profile, applied from the next tick's window. */
export const cueFault = Effect.gen(function* () {
  const { sql } = yield* ControlStore;
  const wm = yield* watermarkMs;
  if (wm === undefined) return yield* Effect.fail(new Error("no watermark: land history first"));
  const profile = liveFault(new Date(wm));
  const existing = yield* readFaults;
  if (existing.some((f) => f.id === profile.id)) return { applied_from: iso(wm), profile, duplicate: true };
  yield* store(
    sql`UPDATE virtual_clock SET faults = faults || ${JSON.stringify([profile])}::jsonb, updated_at = now() WHERE id = 1`,
  );
  return { applied_from: iso(wm), profile, duplicate: false };
});

export const setClock = (a: ClockAction) =>
  Effect.gen(function* () {
    const state = yield* readClockState;
    if (!state) return yield* Effect.fail(new Error("the virtual clock is not initialised"));
    const next = applyClockAction(state, a, Date.now());
    yield* writeClock(next);
    return yield* controlStatus;
  });

const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const t = Buffer.concat(chunks).toString("utf8");
        resolve(t.length === 0 ? {} : JSON.parse(t));
      } catch {
        resolve(undefined);
      }
    });
  });

/** The presenter control HTTP server. Scoped by the caller: close it with the returned release. */
export const controlServer = Effect.gen(function* () {
  const cfg = yield* AppConfig;
  const runtime = yield* Effect.runtime<ControlStore | AppConfig>();
  const run = Runtime.runPromise(runtime);
  const reply = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const auth = req.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
    if (auth !== cfg.presenter.token)
      return reply(res, 401, {
        ok: false,
        error: { code: "UNAUTHENTICATED", message: "presenter token required" },
      });
    const url = (req.url ?? "").split("?")[0];
    try {
      if (req.method === "GET" && url === "/control/status")
        return reply(res, 200, { ok: true, data: await run(controlStatus) });
      if (req.method === "POST" && url === "/control/fault/cue")
        return reply(res, 200, { ok: true, data: await run(cueFault) });
      if (req.method === "POST" && url === "/control/clock") {
        const body = Schema.decodeUnknownEither(ClockBody)(await readBody(req));
        if (Either.isLeft(body))
          return reply(res, 422, {
            ok: false,
            error: {
              code: "VALIDATION_FAILED",
              message: 'body is {"action":"pause"|"resume"} or {"action":"speed","speed":6}',
            },
          });
        return reply(res, 200, { ok: true, data: await run(setClock(body.right as ClockAction)) });
      }
      return reply(res, 404, {
        ok: false,
        error: { code: "UNKNOWN_REFERENCE", message: "no such control endpoint" },
      });
    } catch (e) {
      return reply(res, 500, {
        ok: false,
        error: { code: "INTERNAL", message: String((e as Error).message ?? e).slice(0, 200) },
      });
    }
  };
  const server = createServer((req, res) => void handler(req, res));
  yield* Effect.acquireRelease(
    Effect.async<void>(
      (resume) => void server.listen(cfg.presenter.port, "127.0.0.1", () => resume(Effect.void)),
    ),
    () => Effect.async<void>((resume) => void server.close(() => resume(Effect.void))),
  );
  yield* Effect.logInfo(`presenter control listening on 127.0.0.1:${cfg.presenter.port}`);
});
