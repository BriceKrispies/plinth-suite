import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  DashboardNode,
  GrantNode,
  KIND_EXAMPLES,
  PanelNode,
  decodeIssueToDomainError,
  type Kind,
  bodySchemaFor,
} from "../src";

const decodeErr = (schema: Schema.Schema.AnyNoContext, input: unknown) => {
  const r = Schema.decodeUnknownEither(schema, { onExcessProperty: "error", errors: "first" })(input);
  if (Either.isRight(r)) throw new Error("expected a decode failure");
  return decodeIssueToDomainError(schema, input, r.left);
};

const panel = (visualExtra: Record<string, unknown> = {}, root: Record<string, unknown> = {}) => ({
  apiVersion: "plinth/v1",
  kind: "Panel",
  metadata: { slug: "p1", title: "P" },
  spec: {
    query: {
      from: "source:orders",
      where: [{ field: "placed_at", op: "gte", value: { expr: "now() - 1h" } }],
    },
    visual: { type: "bar", channels: { x: "region", y: "n" }, ...visualExtra },
  },
  ...root,
});

describe("errors an agent can self-correct from (MCP tuning 6)", () => {
  it("UNKNOWN_FIELD names the allowed fields and a suggestion (visual)", () => {
    const e = decodeErr(PanelNode, panel({ x: 1 }));
    expect(e.code).toBe("UNKNOWN_FIELD");
    expect(e.path).toBe("/spec/visual/x");
    expect(e.message.length).toBeGreaterThan(10);
    expect(e.allowed).toEqual(expect.arrayContaining(["type", "channels"]));
  });
  it("UNKNOWN_FIELD inside channels suggests the near miss", () => {
    const e = decodeErr(PanelNode, panel({ channels: { x: "region", y: "n", colour: "carrier" } }));
    expect(e.code).toBe("UNKNOWN_FIELD");
    expect(e.did_you_mean).toContain("color");
    expect(e.allowed).toEqual(expect.arrayContaining(["x", "y"]));
  });
  it("a wrong apiVersion has a non-empty message, expected and allowed", () => {
    const e = decodeErr(PanelNode, panel({}, { apiVersion: "plinth/v2" }));
    expect(e.path).toBe("/apiVersion");
    expect(e.message).toContain("plinth/v1");
    expect(e.expected).toBe('"plinth/v1"');
    expect(e.allowed).toEqual(["plinth/v1"]);
  });
  it("a missing field is named", () => {
    const e = decodeErr(DashboardNode, {
      apiVersion: "plinth/v1",
      kind: "Dashboard",
      metadata: { slug: "d1", title: "D" },
    });
    expect(e.message).toContain("spec");
    expect(e.expected).toContain("spec");
  });
  it("every decode failure has a non-empty message and an expected", () => {
    for (const bad of [
      panel({ type: "pie" }),
      panel({ channels: "x" }),
      { kind: 5 },
      panel({}, { metadata: { slug: "A", title: "" } }),
    ]) {
      const e = decodeErr(PanelNode, bad);
      expect(e.message.trim().length).toBeGreaterThan(0);
      expect((e.expected ?? "").length).toBeGreaterThan(0);
    }
  });
});

describe("kind examples", () => {
  it("every example decodes against its kind schema", () => {
    for (const [kind, example] of Object.entries(KIND_EXAMPLES)) {
      const schema = bodySchemaFor(kind as Kind);
      expect(schema, kind).toBeDefined();
      const r = Schema.decodeUnknownEither(schema as Schema.Schema.AnyNoContext, {
        onExcessProperty: "error",
      })(example);
      expect(Either.isRight(r), kind).toBe(true);
    }
    expect(Either.isRight(Schema.decodeUnknownEither(GrantNode)(KIND_EXAMPLES.Grant))).toBe(true);
  });
});
