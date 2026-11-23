import { JSONSchema, type Schema } from "effect";

type Json = Record<string, unknown>;

const inline = (node: unknown, defs: Record<string, unknown>, seen: ReadonlyArray<string>): unknown => {
  if (Array.isArray(node)) return node.map((n) => inline(n, defs, seen));
  if (node === null || typeof node !== "object") return node;
  const obj = node as Json;
  const ref = obj["$ref"];
  if (typeof ref === "string") {
    const name = ref.split("/").pop() ?? "";
    const def = defs[name];
    if (def === undefined || seen.includes(name)) return { description: `see ${name}` };
    const { $ref: _r, $defs: _d, ...siblings } = obj;
    const inlined = inline(def, defs, [...seen, name]) as Json;
    return { ...inlined, ...siblings };
  }
  const out: Json = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "$schema" || k === "$defs" || (k === "title" && typeof v === "string")) continue;
    out[k] = inline(v, defs, seen);
  }
  return out;
};

const AUTO_DESCRIPTION =
  /^(a|an) (string|array|integer|number|non-empty|non-negative|positive|finite|unique)/;
const SCALARS = ["string", "number", "boolean", "null", "integer"];

/** Drop what the generator adds that an agent does not need: auto descriptions, empty objects, scalar unions. */
const slim = (node: unknown, keepNoExtra: boolean, root: boolean): unknown => {
  if (Array.isArray(node)) return node.map((n) => slim(n, keepNoExtra, false));
  if (node === null || typeof node !== "object") return node;
  const obj = node as Json;
  const out: Json = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "description" && typeof v === "string" && AUTO_DESCRIPTION.test(v)) continue;
    if (k === "propertyNames") continue;
    if (k === "required" && Array.isArray(v) && v.length === 0) continue;
    if (k === "properties" && v !== null && typeof v === "object" && Object.keys(v).length === 0) continue;
    if (k === "additionalProperties" && v === false && !keepNoExtra && !root) continue;
    if (k === "patternProperties") {
      const only = Object.values(v as Json)[0];
      out["additionalProperties"] = slim(only, keepNoExtra, false);
      continue;
    }
    out[k] = slim(v, keepNoExtra, false);
  }
  const any = out["anyOf"];
  if (
    Array.isArray(any) &&
    any.length > 1 &&
    any.every(
      (m) =>
        m !== null &&
        typeof m === "object" &&
        Object.keys(m).length === 1 &&
        SCALARS.includes((m as Json)["type"] as string),
    )
  ) {
    delete out["anyOf"];
    out["type"] = any.map((m) => (m as Json)["type"]);
  }
  if (Array.isArray(any)) {
    const flat = any.flatMap((m) =>
      m !== null &&
      typeof m === "object" &&
      Object.keys(m).length === 1 &&
      Array.isArray((m as Json)["anyOf"])
        ? ((m as Json)["anyOf"] as unknown[])
        : [m],
    );
    if (flat.length !== any.length) out["anyOf"] = flat;
  }
  return out;
};

/**
 * A compact JSON Schema for an MCP tool or a node kind: every `$ref` is inlined (the schemas are not recursive),
 * the `$defs` block and the `$schema` and `title` keys are dropped, descriptions are kept, generator noise is
 * removed. `keepNoExtra` keeps nested `additionalProperties: false` (node bodies); tool inputs drop it.
 */
export const compactJsonSchema = (schema: Schema.Schema.AnyNoContext, keepNoExtra = true): Json => {
  const root = JSONSchema.make(schema) as unknown as Json;
  const defs = (root["$defs"] ?? {}) as Record<string, unknown>;
  return slim(inline(root, defs, []), keepNoExtra, true) as Json;
};
