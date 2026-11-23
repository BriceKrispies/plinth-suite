import { describe, expect, it } from "vitest";
import type { CondTree } from "@plinth/spec";
import { evalCond } from "../src";

const facts = {
  tier: "gold",
  region: "EMEA",
  balance: 15000,
  badges: ["peak-hero", "mentor"],
  joined_days: 90,
  last_seen: "2026-11-01T00:00:00Z",
  "event.delta": -50,
  member: { orders_90d: 1 },
};
const t = (x: CondTree) => evalCond(x, facts);

describe("evalCond (CONTRACT 4.3)", () => {
  it("compares scalars, ranges and timestamps", () => {
    expect(t({ field: "tier", op: "eq", value: "gold" })).toBe(true);
    expect(t({ field: "tier", op: "eq", value: "silver" })).toBe(false);
    expect(t({ field: "balance", op: "gte", value: 15000 })).toBe(true);
    expect(t({ field: "balance", op: "between", value: [10000, 14999] })).toBe(false);
    expect(t({ field: "joined_days", op: "lt", value: 120 })).toBe(true);
    expect(t({ field: "last_seen", op: "lt", value: "2026-11-20T00:00:00Z" })).toBe(true);
  });
  it("tests membership in both directions", () => {
    expect(t({ field: "region", op: "in", value: ["EMEA", "NA"] })).toBe(true);
    expect(t({ field: "region", op: "not_in", value: ["EMEA"] })).toBe(false);
    expect(t({ field: "badges", op: "contains", value: "mentor" })).toBe(true);
    expect(t({ field: "badges", op: "not_contains", value: "critic" })).toBe(true);
  });
  it("reads dotted paths, flat or nested", () => {
    expect(t({ field: "event.delta", op: "lt", value: 0 })).toBe(true);
    expect(t({ field: "member.orders_90d", op: "eq", value: 1 })).toBe(true);
  });
  it("a missing fact is false except not_exists, ne, not_in and not_contains; a type mismatch is false", () => {
    expect(t({ field: "nope", op: "eq", value: 1 })).toBe(false);
    expect(t({ field: "nope", op: "gt", value: 1 })).toBe(false);
    expect(t({ field: "nope", op: "not_exists" })).toBe(true);
    expect(t({ field: "nope", op: "ne", value: 1 })).toBe(true);
    expect(t({ field: "nope", op: "not_in", value: [1] })).toBe(true);
    expect(t({ field: "nope", op: "not_contains", value: 1 })).toBe(true);
    expect(t({ field: "tier", op: "gt", value: 3 })).toBe(false);
    expect(t({ field: "tier", op: "contains", value: "g" })).toBe(false);
  });
  it("combines with all, any and not", () => {
    expect(
      t({
        all: [
          { field: "tier", op: "eq", value: "gold" },
          {
            any: [
              { field: "region", op: "eq", value: "NA" },
              { not: { field: "balance", op: "lt", value: 1 } },
            ],
          },
        ],
      }),
    ).toBe(true);
    expect(t({ not: { field: "tier", op: "eq", value: "gold" } })).toBe(false);
  });
});
