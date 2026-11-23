import { Schema as S, SchemaAST as AST } from "effect";

/**
 * Untrusted-text wrapping of `action.invoke` results (CONTRACT.md 14.3). Every string value whose schema is a plain
 * string (no pattern, no literal set, not a timestamp, id, slug, handle, subject, URI or route) is returned as
 * `{ "untrusted": "<string>" }`, at any depth. The walk is guided by the action's output schema, so a string the schema
 * declares as an id, a literal or a pattern is never wrapped and a free-text field always is.
 */

const jsonSchemaOf = (ast: AST.AST): Record<string, unknown> => {
  const o = AST.getJSONSchemaAnnotation(ast);
  return o._tag === "Some" ? (o.value as Record<string, unknown>) : {};
};

/** A string AST that is free text: a bare string, or one refined only by length. */
const isPlainString = (ast: AST.AST): boolean => {
  switch (ast._tag) {
    case "StringKeyword":
      return true;
    case "Refinement": {
      const js = jsonSchemaOf(ast);
      if ("pattern" in js || "format" in js || "enum" in js || "const" in js) return false;
      return isPlainString(ast.from);
    }
    case "Transformation":
      return isPlainString(ast.from);
    case "Suspend":
      return isPlainString(ast.f());
    default:
      return false;
  }
};

const resolve = (ast: AST.AST): AST.AST => {
  if (ast._tag === "Suspend") return resolve(ast.f());
  if (ast._tag === "Transformation") return resolve(ast.to);
  return ast;
};

/** Plain-string fields that are identifiers by name (the schema says string, the meaning is an id, URI, route or key). */
const IDENTIFIER_KEY =
  /^(uri|href|link|route|slug|kind|code|path|.*_id|.*_uri|.*_slug|.*_hash|.*_token|.*_key|.*_no)$/;

const wrap = (ast: AST.AST, value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  const a = resolve(ast);
  if (typeof value === "string") {
    if (isPlainString(ast) || isPlainString(a)) return { untrusted: value };
    if (a._tag === "Union")
      return a.types.some((t) => isPlainString(t)) &&
        !a.types.some((t) => t._tag === "Literal" && t.literal === value)
        ? { untrusted: value }
        : value;
    return value;
  }
  if (Array.isArray(value)) {
    let el: AST.AST | undefined;
    const tuple = a._tag === "Refinement" ? resolve(a.from) : a;
    if (tuple._tag === "TupleType") el = tuple.rest[0]?.type ?? tuple.elements[0]?.type;
    if (tuple._tag === "Union") {
      const t = tuple.types.map(resolve).find((x) => x._tag === "TupleType");
      if (t && t._tag === "TupleType") el = t.rest[0]?.type ?? t.elements[0]?.type;
    }
    return el === undefined ? value : value.map((v) => wrap(el as AST.AST, v));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (a._tag === "Union") {
      const member = a.types.map(resolve).find((m) => S.is(S.make(m))(value));
      return member ? wrap(member, value) : value;
    }
    const lit = a._tag === "Refinement" ? resolve(a.from) : a;
    if (lit._tag !== "TypeLiteral") return value;
    const out: Record<string, unknown> = {};
    const props = new Map(lit.propertySignatures.map((p) => [String(p.name), p.type] as const));
    for (const [k, v] of Object.entries(obj)) {
      const t = props.get(k);
      if (t !== undefined) out[k] = typeof v === "string" && IDENTIFIER_KEY.test(k) ? v : wrap(t, v);
      else if (lit.indexSignatures.length > 0)
        out[k] = wrap(lit.indexSignatures[0]?.type ?? AST.unknownKeyword, v);
      else out[k] = v;
    }
    return out;
  }
  return value;
};

/** Wrap the data-origin strings of an action result according to the action's output schema. */
export const wrapUntrusted = (output: S.Schema.AnyNoContext, value: unknown): unknown =>
  wrap(output.ast, value);
