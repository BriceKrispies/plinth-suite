import { ParseResult, SchemaAST, type Schema } from "effect";
import { DomainError } from "./errors";
import { didYouMean } from "./suggest";

/**
 * Map a schema decoding failure onto the closed error enum with everything an agent needs to correct itself: a
 * non-empty message, `expected`, `allowed` (when the set is finite) and `did_you_mean`. Pure.
 */

const pointer = (path: ReadonlyArray<PropertyKey>): string =>
  path.map((p) => "/" + String(p).replace(/~/g, "~0").replace(/\//g, "~1")).join("");

const unwrap = (ast: SchemaAST.AST): ReadonlyArray<SchemaAST.AST> => {
  switch (ast._tag) {
    case "Refinement":
      return unwrap(ast.from);
    case "Transformation":
      return unwrap(ast.to);
    case "Suspend":
      return unwrap(ast.f());
    case "Union":
      return ast.types.flatMap(unwrap);
    default:
      return [ast];
  }
};

const child = (ast: SchemaAST.AST, key: PropertyKey): ReadonlyArray<SchemaAST.AST> =>
  unwrap(ast).flatMap((node): ReadonlyArray<SchemaAST.AST> => {
    if (node._tag === "TypeLiteral") {
      const ps = node.propertySignatures.find((p) => p.name === key);
      if (ps) return [ps.type];
      return node.indexSignatures.map((i) => i.type);
    }
    if (node._tag === "TupleType") {
      const i = typeof key === "number" ? key : Number(key);
      const el = node.elements[i];
      if (el) return [el.type];
      const rest = node.rest[0];
      return rest ? [rest.type] : [];
    }
    return [];
  });

const nodesAt = (root: SchemaAST.AST, path: ReadonlyArray<PropertyKey>): ReadonlyArray<SchemaAST.AST> => {
  let cur: ReadonlyArray<SchemaAST.AST> = [root];
  for (const k of path) cur = cur.flatMap((n) => child(n, k));
  return cur;
};

/** Property names of the object schemas at a path (the union of every member when the schema is a union). */
export const propertyNamesAt = (
  schema: Schema.Schema.AnyNoContext,
  path: ReadonlyArray<PropertyKey>,
): string[] => {
  const names = new Set<string>();
  for (const n of nodesAt(schema.ast, path))
    for (const u of unwrap(n))
      if (u._tag === "TypeLiteral") for (const p of u.propertySignatures) names.add(String(p.name));
  return [...names];
};

/** The finite set of literal values a schema at a path accepts, if it is an enumeration. */
export const literalsAt = (
  schema: Schema.Schema.AnyNoContext,
  path: ReadonlyArray<PropertyKey>,
): string[] | undefined => {
  const out: string[] = [];
  for (const n of nodesAt(schema.ast, path)) {
    for (const u of unwrap(n)) {
      if (u._tag === "Literal") out.push(String(u.literal));
      else return undefined;
    }
  }
  return out.length > 0 ? out : undefined;
};

const valueAt = (input: unknown, path: ReadonlyArray<PropertyKey>): unknown => {
  let cur: unknown = input;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[String(k)];
  }
  return cur;
};

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

export const decodeIssueToDomainError = (
  schema: Schema.Schema.AnyNoContext,
  input: unknown,
  error: ParseResult.ParseError,
  prefix: ReadonlyArray<PropertyKey> = [],
): DomainError => {
  const issue = ParseResult.ArrayFormatter.formatErrorSync(error)[0];
  const path = issue ? issue.path : [];
  const at = pointer([...prefix, ...path]);
  const last = path[path.length - 1];
  if (issue?._tag === "Unexpected" && last !== undefined) {
    const container = path.slice(0, -1);
    const allowed = propertyNamesAt(schema, container);
    const name = String(last);
    const where = container.length > 0 ? pointer([...prefix, ...container]) : "the document root";
    return new DomainError({
      code: "UNKNOWN_FIELD",
      path: at,
      message:
        `unknown field '${name}' at ${where}` +
        (allowed.length > 0 ? `; allowed: ${allowed.join(", ")}` : ""),
      expected: allowed.length > 0 ? `one of ${allowed.join(", ")}` : "no further fields",
      ...(allowed.length > 0 ? { allowed: allowed.slice(0, 20) } : {}),
      did_you_mean: didYouMean(name, allowed),
    });
  }
  if (issue?._tag === "Missing" && last !== undefined) {
    const container = path.slice(0, -1);
    const allowed = propertyNamesAt(schema, container);
    return new DomainError({
      code: "VALIDATION_FAILED",
      path: at,
      message: `required field '${String(last)}' is missing at ${container.length > 0 ? pointer([...prefix, ...container]) : "the document root"}`,
      expected: `a value for '${String(last)}'`,
      ...(allowed.length > 0 ? { allowed: allowed.slice(0, 20) } : {}),
    });
  }
  const lits = literalsAt(schema, path);
  const actual = valueAt(input, path);
  const raw = clean(issue?.message ?? "") || clean(ParseResult.TreeFormatter.formatErrorSync(error));
  const message =
    lits !== undefined
      ? `invalid value ${JSON.stringify(actual) ?? "(none)"} at ${at || "the document root"}; expected ${lits.map((l) => JSON.stringify(l)).join(" | ")}`
      : raw.length > 0
        ? `${raw}${at ? ` (at ${at})` : ""}`
        : `invalid value at ${at || "the document root"}`;
  return new DomainError({
    code: "VALIDATION_FAILED",
    path: at,
    message,
    ...(lits !== undefined
      ? {
          expected: lits.map((l) => JSON.stringify(l)).join(" | "),
          ...(lits.length <= 20 ? { allowed: lits } : {}),
          ...(typeof actual === "string" ? { did_you_mean: didYouMean(actual, lits) } : {}),
        }
      : { expected: "a value matching the schema at this path; see schema.describe" }),
  });
};
