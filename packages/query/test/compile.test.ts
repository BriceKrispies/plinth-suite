import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { ordersSourceBody, type QueryAst } from "@plinth/spec";
import { compileQuery } from "../src";

const source = ordersSourceBody().spec;
const base = {
  source,
  sourceSlug: "orders",
  workspaceId: "11111111-1111-1111-1111-111111111111",
  asOf: new Date("2026-11-20T14:30:00Z"),
  params: {},
  files: ["s3://plinth-data/runs/r1/orders/0/p.parquet"],
  limit: 200,
};

const p95: QueryAst = {
  from: "source:orders",
  where: [{ field: "placed_at", op: "gte", value: "now() - 1h" }],
  derive: { latency_ms: "ms(fulfilled_at - placed_at)" },
  group: ["region"],
  aggregate: { p95: "percentile(latency_ms, 0.95)" },
  order: [{ field: "region", dir: "asc" }],
};

describe("query compiler", () => {
  it("compiles p95 by region with the workspace predicate injected", () => {
    const r = compileQuery({ ...base, ast: p95 });
    expect(Either.isRight(r)).toBe(true);
    if (Either.isLeft(r)) return;
    expect(r.right.sql).toContain('"workspace_id" = $1');
    expect(r.right.sql).toContain("quantile_cont");
    expect(r.right.values[0]).toBe(base.workspaceId);
    expect(r.right.columns.map((c) => c.name)).toEqual(["region", "p95"]);
  });
  it("refuses an unbounded scan with QUERY_TIMEOUT", () => {
    const r = compileQuery({ ...base, ast: { ...p95, where: [] } });
    expect(Either.isLeft(r) && r.left.code).toBe("QUERY_TIMEOUT");
  });
  it("names the allowed fields for an unknown field", () => {
    const r = compileQuery({ ...base, ast: { ...p95, group: ["regoin"] } });
    expect(Either.isLeft(r) && r.left.code).toBe("UNKNOWN_FIELD");
    expect(Either.isLeft(r) && r.left.did_you_mean).toContain("region");
  });
});
