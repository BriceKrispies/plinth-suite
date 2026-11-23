import { Effect } from "effect";
import { workspaceId } from "@plinth/core";
import { AppConfig, ControlStore, store, parseVirtualStart } from "@plinth/engine";
import { landPartition } from "@plinth/ingest";
import { HISTORY_FAULT, ORDERS_COLUMNS, generateWindow } from "./orders";

const pad = (n: number): string => String(n).padStart(2, "0");
const compact = (d: Date): string =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`;

export const partitionKeyOf = (source: string, shard: number, start: Date, end: Date): string =>
  `${source}-s${shard}-${compact(start)}-${compact(end)}`;

/** Hourly windows covering the history, oldest first. The last window is cut at `historyEnd`. */
export const historyWindows = (
  virtualDate: string,
  virtualStart: string,
  days: number,
): ReadonlyArray<readonly [Date, Date]> => {
  const end = parseVirtualStart(virtualDate, virtualStart);
  const firstDay = new Date(`${virtualDate}T00:00:00Z`).getTime() - (days - 1) * 86_400_000;
  const out: Array<readonly [Date, Date]> = [];
  for (let t = firstDay; t < end.getTime(); t += 3_600_000) {
    out.push([new Date(t), new Date(Math.min(t + 3_600_000, end.getTime()))] as const);
  }
  return out;
};

/**
 * Generate the seeded orders history and land it as hourly Parquet partitions (temp key, final key, then the
 * `source_partitions` row), oldest first so each shard's published set stays a prefix. Returns partitions landed.
 */
export const buildHistory = Effect.gen(function* () {
  const cfg = yield* AppConfig;
  const { sql } = yield* ControlStore;
  const ws = workspaceId(cfg.workspaceSlug);
  const runs = yield* store(
    sql<{ run_prefix: string }>`SELECT run_prefix FROM workspaces WHERE workspace_id = ${ws}`,
  );
  const runPrefix = runs[0]?.run_prefix;
  if (!runPrefix) return yield* Effect.die(new Error("workspace not seeded: run `pnpm reset` first"));
  const historyEnd = parseVirtualStart(cfg.demo.virtualDate, cfg.demo.virtualStart);
  const fault = HISTORY_FAULT(cfg.demo.virtualDate);
  let landed = 0;
  for (const [start, end] of historyWindows(
    cfg.demo.virtualDate,
    cfg.demo.virtualStart,
    cfg.demo.historyDays,
  )) {
    const rows = generateWindow(
      { seed: cfg.demo.seed, workspaceId: ws, ordersPerDay: cfg.demo.ordersPerDay, fault, historyEnd },
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
    if (r.published) landed += 1;
    yield* Effect.logInfo(`landed ${r.objectKey} rows=${rows.length} published=${r.published}`);
  }
  return landed;
});
