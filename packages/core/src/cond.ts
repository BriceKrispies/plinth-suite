import type { CondTree } from "@plinth/spec";

/**
 * The pure condition evaluator (CONTRACT.md 4.3). No I/O, no clock: `now` arrives as a fact. A missing fact makes
 * every comparison false except `not_exists`, `ne`, `not_in` and `not_contains`, which are true. Type mismatches are
 * false, never errors.
 */
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Facts are looked up by dotted path (`member.tier`, `event.points`), exact key first. */
const lookup = (facts: Readonly<Record<string, unknown>>, path: string): unknown => {
  if (path in facts) return facts[path];
  let cur: unknown = facts;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
};

const order = (a: unknown, b: unknown): number | undefined => {
  if (isNum(a) && isNum(b)) return a - b;
  if (typeof a === "string" && typeof b === "string") {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (
      /^\d{4}-\d{2}-\d{2}T/.test(a) &&
      /^\d{4}-\d{2}-\d{2}T/.test(b) &&
      !Number.isNaN(ta) &&
      !Number.isNaN(tb)
    )
      return ta - tb;
  }
  return undefined;
};

const evalLeaf = (
  field: string,
  op: string,
  value: unknown,
  facts: Readonly<Record<string, unknown>>,
): boolean => {
  const x = lookup(facts, field);
  const present = x !== undefined && x !== null;
  switch (op) {
    case "exists":
      return present;
    case "not_exists":
      return !present;
    case "ne":
      return !present || x !== value;
    case "not_in":
      return !present || !Array.isArray(value) || !value.includes(x);
    case "not_contains":
      return !present || !Array.isArray(x) || !x.includes(value);
  }
  if (!present) return false;
  switch (op) {
    case "eq":
      return x === value;
    case "in":
      return Array.isArray(value) && value.includes(x);
    case "contains":
      return Array.isArray(x) && x.includes(value);
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const c = order(x, value);
      if (c === undefined) return false;
      return op === "lt" ? c < 0 : op === "lte" ? c <= 0 : op === "gt" ? c > 0 : c >= 0;
    }
    case "between": {
      if (!Array.isArray(value) || value.length !== 2) return false;
      const lo = order(x, value[0]);
      const hi = order(x, value[1]);
      return lo !== undefined && hi !== undefined && lo >= 0 && hi <= 0;
    }
    default:
      return false;
  }
};

export const evalCond = (tree: CondTree, facts: Readonly<Record<string, unknown>>): boolean => {
  if ("all" in tree) return tree.all.every((t) => evalCond(t, facts));
  if ("any" in tree) return tree.any.some((t) => evalCond(t, facts));
  if ("not" in tree) return !evalCond(tree.not, facts);
  return evalLeaf(tree.field, tree.op, tree.value, facts);
};
