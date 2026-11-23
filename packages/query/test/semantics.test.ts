import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { PANEL_EXAMPLES, PanelNode, ordersSourceBody, type QueryAst } from "@plinth/spec";
import { compileQuery, typecheckQuery } from "../src";

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
const lower = { field: "placed_at", op: "gte", value: { expr: "now() - 1h" } } as const;
const ast = (extra: Partial<QueryAst>): QueryAst => ({
  from: "source:orders",
  where: [lower],
  aggregate: { n: { fn: "count" } },
  ...extra,
});
const compile = (a: QueryAst, more: Partial<Parameters<typeof compileQuery>[0]> = {}) =>
  compileQuery({ ...base, ast: a, ...more });

describe("aggregates (MCP tuning 2)", () => {
  it("accepts the object form {fn, of, p} and compiles it like the string alias", () => {
    const obj = compile(
      ast({
        derive: { latency_ms: "ms(fulfilled_at - placed_at)" },
        aggregate: { p95: { fn: "percentile", of: "latency_ms", p: 0.95 } },
      }),
    );
    const str = compile(
      ast({
        derive: { latency_ms: "ms(fulfilled_at - placed_at)" },
        aggregate: { p95: "percentile(latency_ms, 0.95)" },
      }),
    );
    expect(Either.isRight(obj) && Either.isRight(str) && obj.right.sql === str.right.sql).toBe(true);
  });
  it("names the missing field of an object aggregate", () => {
    const r = compile(ast({ aggregate: { s: { fn: "sum" } } }));
    expect(Either.isLeft(r) && r.left.message).toContain('needs "of"');
  });
});

describe("predicate values (MCP tuning 3)", () => {
  const where = (value: unknown, field = "region", op = "eq") =>
    compile(ast({ where: [lower, { field, op, value } as never] }));
  it("matches a raw string", () => expect(Either.isRight(where("EMEA"))).toBe(true));
  it("rejects a quoted string instead of silently matching nothing", () => {
    const r = where("'EMEA'");
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) {
      expect(r.left.message).toContain("value looks quoted; pass the raw string EMEA");
      expect(r.left.suggestion).toEqual({ kind: "replace", path: "/where/1/value", value: "EMEA" });
    }
  });
  it("accepts a bare ISO timestamp for a timestamp field", () =>
    expect(Either.isRight(where("2026-11-20T14:00:00Z", "placed_at", "gte"))).toBe(true));
  it("accepts {expr} and the bare relative-time string", () => {
    expect(Either.isRight(where({ expr: "now() - 30m" }, "placed_at", "gte"))).toBe(true);
    expect(Either.isRight(where("now() - 30m", "placed_at", "gte"))).toBe(true);
  });
  it("validates enum values and lists them", () => {
    const r = where("EMAE");
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) {
      expect(r.left.allowed).toEqual(["NA", "EMEA", "APAC", "LATAM", "ANZ"]);
      expect(r.left.did_you_mean).toContain("EMEA");
    }
  });
  it("validates every member of an in-list", () => {
    const r = where(["EMEA", "'NA'"], "region", "in");
    expect(Either.isLeft(r) && r.left.message).toContain("quoted");
  });
});

describe("bucket() (MCP tuning 9)", () => {
  it("buckets a timestamp and groups by the derived name", () => {
    const r = compile(
      ast({
        derive: { minute: "bucket(placed_at, '1 minute')" },
        group: ["minute"],
        order: [{ field: "minute", dir: "asc" }],
      }),
    );
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.columns.map((c) => c.type)).toEqual(["timestamp", "int"]);
      expect(r.right.sql).toContain("60000");
    }
  });
  it("reports the signature on misuse", () => {
    const r = compile(ast({ derive: { m: "bucket(placed_at, 5)" }, group: ["m"] }));
    expect(Either.isLeft(r) && r.left.expected).toBe("bucket(placed_at, '1 minute')");
  });
  it("types timestamp subtraction as a duration in milliseconds", () => {
    const r = compile(ast({ derive: { d: "handed_to_carrier_at - packed_at" }, group: ["d"] }));
    expect(Either.isRight(r) && r.right.columns[0]?.type).toBe("duration");
    expect(Either.isRight(r) && r.right.sql).toContain("epoch_ms");
  });
});

describe("policy injection", () => {
  it("injects the row predicate at the source relation, before any operator", () => {
    const r = compile(ast({}), { rowPredicate: "(region = 'EMEA')" });
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      const src = r.right.sql.split("\n")[0] ?? "";
      expect(src).toContain('("region" = ');
      expect(r.right.injected.map((i) => i.kind)).toContain("row");
    }
  });
  it("a masked column is reported exactly like an absent column", () => {
    const masked = compile(ast({ group: ["carrier"] }), { maskedColumns: ["carrier"] });
    const absent = compile(ast({ group: ["no_such_column"] }), { maskedColumns: ["carrier"] });
    expect(Either.isLeft(masked) && Either.isLeft(absent)).toBe(true);
    if (Either.isLeft(masked) && Either.isLeft(absent)) {
      expect(masked.left.code).toBe("UNKNOWN_FIELD");
      expect(masked.left.allowed).toEqual(absent.left.allowed);
      expect(masked.left.allowed).not.toContain("carrier");
      expect(masked.left.message.replace("carrier", "X")).toBe(
        absent.left.message.replace("no_such_column", "X"),
      );
    }
  });
  it("a row predicate may use a masked column; the column stays hidden from the query", () => {
    const r = compile(ast({}), { rowPredicate: "carrier = 'Crane'", maskedColumns: ["carrier"] });
    expect(Either.isRight(r)).toBe(true);
  });
  it("a static masked field is never selectable", () => {
    const r = compile(ast({ group: ["customer_ref"] }));
    expect(Either.isLeft(r) && r.left.code).toBe("UNKNOWN_FIELD");
  });
});

describe("expression errors", () => {
  it("carry a valid one-line example and no spec section", () => {
    const r = compile(ast({ derive: { x: "nonsense(" } }));
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) {
      expect(r.left.expected).toContain("ms(fulfilled_at - placed_at)");
      expect(r.left.expected).not.toContain("3.4.4");
    }
  });
  it("lists the functions for an unknown function", () => {
    const r = compile(ast({ derive: { x: "bucked(placed_at, '1 minute')" } }));
    expect(Either.isLeft(r) && r.left.allowed).toContain("bucket");
    expect(Either.isLeft(r) && r.left.did_you_mean).toContain("bucket");
  });
});

describe("schema.describe examples", () => {
  for (const [name, example] of Object.entries(PANEL_EXAMPLES)) {
    it(`the ${name} Panel example is valid and its query typechecks against orders`, () => {
      const decoded = Schema.decodeUnknownEither(PanelNode, { onExcessProperty: "error" })(example);
      expect(Either.isRight(decoded)).toBe(true);
      if (Either.isRight(decoded)) {
        const q = decoded.right.spec.query;
        expect(typeof q).toBe("object");
        if (typeof q === "object") expect(Either.isRight(typecheckQuery(q, source, "orders"))).toBe(true);
      }
    });
  }
});
