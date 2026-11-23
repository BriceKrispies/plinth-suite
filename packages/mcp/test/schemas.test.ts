import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { TOOLS, defaultPlacement, normalizeBody } from "../src/tools";

const bytes = (x: unknown): number => Buffer.byteLength(JSON.stringify(x));

describe("tool catalogue (MCP tuning 1)", () => {
  it("has the 15 kernel tools of the README plus action.list and action.invoke, in order", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      "schema.describe",
      "node.get",
      "node.search",
      "source.list",
      "query.run",
      "query.explain",
      "node.preview",
      "node.commit",
      "node.delete",
      "node.undo",
      "change.history",
      "diff",
      "grant.check",
      "ui.present",
      "change.status",
      "action.list",
      "action.invoke",
    ]);
  });
  it("keeps each input schema under its byte budget and the whole list under 40 KB", () => {
    for (const t of TOOLS) {
      const budget = t.name === "query.run" ? 10_240 : 6_144;
      expect(bytes(t.inputSchema), t.name).toBeLessThan(budget);
    }
    const list = TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    expect(bytes(list)).toBeLessThan(40_960);
  });
  it("does not repeat a schema inside $defs", () => {
    for (const t of TOOLS) {
      const text = JSON.stringify(t.inputSchema);
      expect(text, t.name).not.toContain("$defs");
      expect(text, t.name).not.toContain("$ref");
    }
  });
  it("documents both aggregate forms and the value rule in query.run", () => {
    const run = TOOLS.find((t) => t.name === "query.run");
    const text = JSON.stringify(run);
    expect(text).toContain('\\"fn\\":\\"percentile\\"');
    expect(text).toContain("percentile(latency_ms, 0.95)");
    expect(text).toContain("EMEA, never 'EMEA'");
    expect(text).toContain("bucket(");
  });
  it("accepts a node by slug in every tool that names a node", () => {
    for (const name of ["node.get", "node.preview", "source.list", "change.history"]) {
      const t = TOOLS.find((x) => x.name === name);
      expect(JSON.stringify(t?.inputSchema), name).toContain("kind:slug");
    }
  });
});

describe("node.preview body defaults (MCP tuning 7, 8)", () => {
  const body = { metadata: { slug: "p1", title: "P" }, spec: {} };
  it("defaults apiVersion and kind from the call", () => {
    const r = normalizeBody("Panel", body);
    expect(Either.isRight(r) && r.right["apiVersion"]).toBe("plinth/v1");
    expect(Either.isRight(r) && r.right["kind"]).toBe("Panel");
  });
  it("accepts them when they agree and rejects a conflict", () => {
    expect(Either.isRight(normalizeBody("Panel", { ...body, apiVersion: "plinth/v1", kind: "Panel" }))).toBe(
      true,
    );
    const r = normalizeBody("Panel", { ...body, kind: "Dashboard" });
    expect(Either.isLeft(r) && r.left.path).toBe("/body/kind");
    const v = normalizeBody("Panel", { ...body, apiVersion: "plinth/v2" });
    expect(Either.isLeft(v) && v.left.path).toBe("/body/apiVersion");
  });
  it("turns a flat Grant into an envelope with a stable slug", () => {
    const flat = {
      principal: "user:emea-lead",
      action: "node:read",
      resource: "dashboard:finance-board",
      row_predicate: "region = 'EMEA'",
    };
    const a = normalizeBody("Grant", flat);
    const b = normalizeBody("Grant", flat);
    expect(Either.isRight(a) && Either.isRight(b) && a.right).toEqual(Either.isRight(b) ? b.right : null);
    if (Either.isRight(a)) {
      expect((a.right["spec"] as { actions: string[] }).actions).toEqual(["node:read"]);
      expect((a.right["metadata"] as { slug: string }).slug).toMatch(/^grant-[0-9a-f]{8}$/);
    }
  });
  it("names the allowed keys of a flat Grant", () => {
    const r = normalizeBody("Grant", {
      principal: "user:x",
      actions: ["node:read"],
      resource: "a",
      rows: "x",
    });
    expect(Either.isLeft(r) && r.left.code).toBe("UNKNOWN_FIELD");
    expect(Either.isLeft(r) && r.left.allowed).toContain("row_predicate");
  });
  it("auto-places below the lowest item at full width", () => {
    expect(defaultPlacement({ spec: { layout: { columns: 12, items: [] } } })).toEqual({
      x: 0,
      y: 0,
      w: 12,
      h: 6,
    });
    expect(
      defaultPlacement({
        spec: { layout: { columns: 12, items: [{ at: { y: 0, h: 6 } }, { at: { y: 6, h: 4 } }] } },
      }),
    ).toEqual({ x: 0, y: 10, w: 12, h: 6 });
  });
});
