import { describe, expect, it } from "vitest";
import { evalRowPredicate } from "../src";

const emea = { handle: "jakob-meyer", region: "EMEA", tier: "gold", department: "fulfilment" };

describe("evalRowPredicate (CONTRACT 3.2, K9)", () => {
  it("no predicate allows every member", () => {
    expect(evalRowPredicate(null, emea)).toBe(true);
    expect(evalRowPredicate("  ", emea)).toBe(true);
  });
  it("evaluates =, !=, and, or, not over the target member's facts", () => {
    expect(evalRowPredicate("region = 'EMEA'", emea)).toBe(true);
    expect(evalRowPredicate("region = 'NA'", emea)).toBe(false);
    expect(evalRowPredicate("region != 'NA' and tier = 'gold'", emea)).toBe(true);
    expect(evalRowPredicate("(region = 'NA' or region = 'APAC') or handle = 'jakob-meyer'", emea)).toBe(true);
    expect(evalRowPredicate("not (department = 'fulfilment')", emea)).toBe(false);
  });
  it("a scoped manager's ANDed predicate refuses the other region (AC-AUTHZ-ROLES)", () => {
    const scoped = "(tier = 'gold') and region = 'EMEA'";
    expect(evalRowPredicate(scoped, emea)).toBe(true);
    expect(evalRowPredicate(scoped, { ...emea, region: "NA" })).toBe(false);
  });
  it("a predicate it cannot evaluate never widens access", () => {
    expect(evalRowPredicate("region >> 1", emea)).toBe(false);
    expect(evalRowPredicate("now() > 3", emea)).toBe(false);
  });
});
