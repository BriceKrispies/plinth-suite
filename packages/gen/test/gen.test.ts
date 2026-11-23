import { describe, expect, it } from "vitest";
import { HISTORY_FAULT, faultFactor, generateWindow, liveFault } from "../src";

const params = {
  seed: 2026,
  workspaceId: "11111111-1111-1111-1111-111111111111",
  ordersPerDay: 80_000,
  fault: HISTORY_FAULT("2026-11-20"),
  historyEnd: new Date("2026-11-20T14:30:00Z"),
};
const at = (hhmm: string) => new Date(`2026-11-20T${hhmm}:00Z`);
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? 0;
const latencies = (start: string, end: string) =>
  generateWindow(params, at(start), at(end))
    .filter((r) => r["region"] === "EMEA" && r["carrier"] === "Crane" && r["fulfilled_at"] !== null)
    .map((r) => Date.parse(`${r["fulfilled_at"]}Z`) - Date.parse(`${r["placed_at"]}Z`));

describe("orders generator", () => {
  it("is deterministic for a seed", () => {
    expect(generateWindow(params, at("10:00"), at("11:00"))).toEqual(
      generateWindow(params, at("10:00"), at("11:00")),
    );
  });
  it("ramps the fault factor", () => {
    expect(faultFactor(params.fault, at("13:59"))).toBe(1);
    expect(faultFactor(params.fault, at("14:10"))).toBe(2.2);
    expect(faultFactor(params.fault, at("14:25"))).toBe(1);
  });
  it("episode_in_history: EMEA/Crane p95 exceeds 900 ms in the episode and not at 13:00", () => {
    expect(p95(latencies("14:05", "14:20"))).toBeGreaterThan(900);
    expect(p95(latencies("13:00", "14:00"))).toBeLessThan(900);
  });
});

describe("live generation", () => {
  it("a window is a pure function of seed, tick and cued faults", () => {
    const start = at("14:30");
    const end = at("14:31");
    const live = { ...params, extraFaults: [liveFault(start)], historyEnd: new Date(end.getTime() + 10_000) };
    expect(generateWindow(live, start, end)).toEqual(generateWindow(live, start, end));
  });
  it("a cued fault slows EMEA/Crane handoff from the cued tick and leaves other windows alone", () => {
    const start = at("14:40");
    const end = at("14:50");
    const plain = { ...params, historyEnd: new Date(end.getTime() + 10_000) };
    const cued = { ...plain, extraFaults: [liveFault(at("14:30"))] };
    const lat = (p: typeof plain) =>
      generateWindow(p, start, end)
        .filter(
          (r) => r["region"] === "EMEA" && r["carrier"] === "Crane" && r["handed_to_carrier_at"] !== null,
        )
        .map((r) => Date.parse(`${r["handed_to_carrier_at"]}Z`) - Date.parse(`${r["packed_at"]}Z`));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    expect(mean(lat(cued))).toBeGreaterThan(mean(lat(plain)) * 1.5);
    const before = at("14:00");
    expect(generateWindow({ ...cued, historyEnd: at("14:31") }, before, at("14:01"))).toEqual(
      generateWindow({ ...plain, historyEnd: at("14:31") }, before, at("14:01")),
    );
  });
  it("liveFault is the history profile type starting at the tick", () => {
    const f = liveFault(at("14:30"));
    expect([f.region, f.carrier, f.rampStart, f.rampEnd, f.holdEnd, f.recoverEnd, f.peak]).toEqual([
      "EMEA",
      "Crane",
      870,
      875,
      890,
      895,
      2.2,
    ]);
  });
});
