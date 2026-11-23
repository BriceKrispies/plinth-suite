import { Either } from "effect";
import { describe, expect, it } from "vitest";
import type { Json, Op } from "@plinth/spec";
import { applyOps, canonicalize, diffJson, inverseOps, nodeId, summarizeOps, uuidv5 } from "../src";

describe("canonical JSON", () => {
  it("sorts keys and drops whitespace", () => {
    expect(canonicalize({ b: 1, a: [true, null, { d: 2, c: "x" }] })).toBe(
      '{"a":[true,null,{"c":"x","d":2}],"b":1}',
    );
  });
  it("writes -0 as 0", () => {
    expect(canonicalize({ n: -0 })).toBe('{"n":0}');
  });
});

describe("ids", () => {
  it("derives stable node ids", () => {
    const ws = uuidv5("6f0a7d2e-5b1c-4c1e-9d3a-7c2f4a1b8e90", "workspace|northwind");
    expect(nodeId(ws, "Dashboard", "ops-board")).toBe(nodeId(ws, "Dashboard", "ops-board"));
    expect(nodeId(ws, "Dashboard", "ops-board")).not.toBe(nodeId(ws, "Panel", "ops-board"));
  });
});

describe("ops", () => {
  const body: Json = { spec: { layout: { items: [{ panel: "panel:a" }], columns: 12 }, title: "t" } };
  const ops: Op[] = [
    { op: "set", path: "/spec/layout/items/-", value: { panel: "panel:b" } },
    { op: "set", path: "/spec/title", value: "u" },
    { op: "remove", path: "/spec/layout/columns" },
  ];
  it("applies and inverts", () => {
    const applied = applyOps(body, ops);
    expect(Either.isRight(applied)).toBe(true);
    if (Either.isLeft(applied)) return;
    const inv = inverseOps(body, ops);
    const back = applyOps(applied.right.body, inv);
    expect(Either.isRight(back) && canonicalize(back.right.body)).toBe(canonicalize(body));
  });
});

describe("diffJson and summarizeOps", () => {
  it("diffs objects by path and summarizes without values", () => {
    const a = { metadata: { title: "A" }, spec: { w: 6, xs: [1, 2] } } as never;
    const b = { metadata: { title: "B" }, spec: { w: 6, xs: [1, 3], extra: true } } as never;
    const d = diffJson(a, b);
    expect(d.changed_paths).toEqual(["/metadata/title", "/spec/extra", "/spec/xs/1"]);
    expect(summarizeOps(d.ops)).toBe("set /metadata/title (1); set /spec/xs/1 (1); set /spec/extra (1)");
    expect(diffJson(a, a).ops).toEqual([]);
  });
});
