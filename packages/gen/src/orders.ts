import { ORDERS_ENUMS } from "@plinth/spec";
import type { ColumnDef } from "@plinth/ingest";
import { Xoshiro, streamSeed } from "./rng";

/** Seeded `orders` generator (spec 02 section 3.6, 09 section 17). Pure: a window in, rows out. */

export interface FaultProfile {
  readonly id: string;
  readonly region: string;
  readonly carrier: string;
  /** UTC date the episode applies to, `YYYY-MM-DD`. */
  readonly date: string;
  /** Minutes of day. Factor ramps 1 -> peak over [rampStart, rampEnd], holds to holdEnd, returns to 1 by recoverEnd. */
  readonly rampStart: number;
  readonly rampEnd: number;
  readonly holdEnd: number;
  readonly recoverEnd: number;
  readonly peak: number;
}

export const HISTORY_FAULT = (date: string): FaultProfile => ({
  id: "history-emea-crane-1400",
  region: "EMEA",
  carrier: "Crane",
  date,
  rampStart: 14 * 60,
  rampEnd: 14 * 60 + 5,
  holdEnd: 14 * 60 + 20,
  recoverEnd: 14 * 60 + 25,
  peak: 2.2,
});

export const faultFactor = (f: FaultProfile, t: Date): number => {
  if (t.toISOString().slice(0, 10) !== f.date) return 1;
  const m = t.getUTCHours() * 60 + t.getUTCMinutes() + t.getUTCSeconds() / 60;
  if (m <= f.rampStart || m >= f.recoverEnd) return 1;
  if (m < f.rampEnd) return 1 + ((f.peak - 1) * (m - f.rampStart)) / (f.rampEnd - f.rampStart);
  if (m <= f.holdEnd) return f.peak;
  return f.peak - ((f.peak - 1) * (m - f.holdEnd)) / (f.recoverEnd - f.holdEnd);
};

export const ORDERS_COLUMNS: ReadonlyArray<ColumnDef> = [
  { name: "workspace_id", type: "VARCHAR" },
  { name: "order_id", type: "VARCHAR" },
  { name: "region", type: "VARCHAR" },
  { name: "carrier", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "placed_at", type: "TIMESTAMP" },
  { name: "picked_at", type: "TIMESTAMP" },
  { name: "packed_at", type: "TIMESTAMP" },
  { name: "handed_to_carrier_at", type: "TIMESTAMP" },
  { name: "fulfilled_at", type: "TIMESTAMP" },
  { name: "returned_at", type: "TIMESTAMP" },
  { name: "sku_count", type: "BIGINT" },
  { name: "order_value_cents", type: "BIGINT" },
  { name: "customer_ref", type: "VARCHAR" },
  { name: "fault_profile", type: "VARCHAR" },
];

export type OrderRow = Record<string, string | number | null>;

const REGION_WEIGHTS = [
  ["NA", 0.32],
  ["EMEA", 0.27],
  ["APAC", 0.22],
  ["LATAM", 0.11],
  ["ANZ", 0.08],
] as const;

/** Diurnal order intensity by UTC hour, normalised so the 24 weights sum to 1. */
const HOUR_WEIGHTS: ReadonlyArray<number> = (() => {
  const raw = Array.from(
    { length: 24 },
    (_, h) => 0.35 + 0.65 * Math.max(0, Math.sin(((h - 5) / 24) * 2 * Math.PI)) + 0.2,
  );
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => x / sum);
})();

const fmt = (ms: number): string => new Date(ms).toISOString().replace("T", " ").replace("Z", "");

const logn = (rng: Xoshiro, median: number, sigma: number): number =>
  Math.max(1, Math.round(median * Math.exp(sigma * rng.normal())));

export interface WindowParams {
  readonly seed: number;
  readonly workspaceId: string;
  readonly ordersPerDay: number;
  readonly fault: FaultProfile;
  /** Profiles cued live (the presenter's F7). Applied together with `fault`; the strongest factor wins. */
  readonly extraFaults?: ReadonlyArray<FaultProfile>;
  /** Rows whose stage times pass this instant are not yet complete (null timestamps). */
  readonly historyEnd: Date;
}

export const generateWindow = (p: WindowParams, start: Date, end: Date): ReadonlyArray<OrderRow> => {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const hour = start.getUTCHours();
  const count = Math.round(p.ordersPerDay * (HOUR_WEIGHTS[hour] ?? 0) * ((endMs - startMs) / 3_600_000));
  const rng = new Xoshiro(streamSeed(p.seed, "orders", Math.floor(startMs / 60_000)));
  const placed = Array.from({ length: count }, () => startMs + rng.int(endMs - startMs)).sort(
    (a, b) => a - b,
  );
  const endHistory = p.historyEnd.getTime();
  const rows: OrderRow[] = [];
  for (const t of placed) {
    const region = rng.weighted(REGION_WEIGHTS);
    const carrier = rng.pick(ORDERS_ENUMS.carrier);
    const hex =
      (rng.next() & 0xffffffffffffn).toString(16).padStart(12, "0") +
      (rng.next() & 0xffffffffn).toString(16).padStart(8, "0");
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${(rng.next() & 0xffffffffffffn).toString(16).padStart(12, "0")}`;
    const pick = logn(rng, 90, 0.3);
    const pack = logn(rng, 120, 0.3);
    const packedAt = t + pick + pack;
    const factor = Math.max(
      1,
      ...[p.fault, ...(p.extraFaults ?? [])].map((f) =>
        region === f.region && carrier === f.carrier ? faultFactor(f, new Date(packedAt)) : 1,
      ),
    );
    const handoff = logn(rng, 200 * factor, 0.35);
    const deliver = logn(rng, 100, 0.3);
    const pickedAt = t + pick;
    const handedAt = packedAt + handoff;
    const fulfilledAt = handedAt + deliver;
    const done = (x: number): string | null => (x <= endHistory ? fmt(x) : null);
    const status =
      fulfilledAt <= endHistory
        ? "delivered"
        : handedAt <= endHistory
          ? "in_transit"
          : packedAt <= endHistory
            ? "packed"
            : pickedAt <= endHistory
              ? "picked"
              : "placed";
    rows.push({
      workspace_id: p.workspaceId,
      order_id: id,
      region,
      carrier: handedAt <= endHistory ? carrier : null,
      status,
      placed_at: fmt(t),
      picked_at: done(pickedAt),
      packed_at: done(packedAt),
      handed_to_carrier_at: done(handedAt),
      fulfilled_at: done(fulfilledAt),
      returned_at: null,
      sku_count: 1 + rng.int(6),
      order_value_cents: 500 + rng.int(49_500),
      customer_ref: `cust-${(rng.next() & 0xffffffn).toString(16).padStart(6, "0")}`,
      fault_profile:
        factor > 1
          ? ([p.fault, ...(p.extraFaults ?? [])].find(
              (f) =>
                region === f.region && carrier === f.carrier && faultFactor(f, new Date(packedAt)) === factor,
            )?.id ?? p.fault.id)
          : null,
    });
  }
  return rows;
};

/** The live fault the presenter cues (F7): the EMEA/Crane profile type, starting at a tick boundary. Pure. */
export const liveFault = (start: Date): FaultProfile => {
  const m = start.getUTCHours() * 60 + start.getUTCMinutes();
  return {
    id: `live-emea-crane-${start.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`,
    region: "EMEA",
    carrier: "Crane",
    date: start.toISOString().slice(0, 10),
    rampStart: m,
    rampEnd: m + 5,
    holdEnd: m + 20,
    recoverEnd: m + 25,
    peak: 2.2,
  };
};
