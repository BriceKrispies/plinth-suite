// Client-side evaluation of the condition grammar (CONTRACT 4.1 to 4.3) over a facts object, used to explain why a
// member matches a segment rule. Pure and total: a missing fact makes every comparison false except the negations.

const read = (facts, path) => {
  if (path in facts) return facts[path];
  let cur = facts;
  for (const part of String(path).split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
};

const NEGATIVE = new Set(["ne", "not_in", "not_contains", "not_exists"]);

export const evalCondition = (c, facts) => {
  const x = read(facts, c.field);
  const missing = x === undefined || x === null;
  if (c.op === "exists") return !missing;
  if (c.op === "not_exists") return missing;
  if (missing) return NEGATIVE.has(c.op);
  const v = c.value;
  switch (c.op) {
    case "eq":
      return x === v;
    case "ne":
      return x !== v;
    case "lt":
      return typeof x === typeof v && x < v;
    case "lte":
      return typeof x === typeof v && x <= v;
    case "gt":
      return typeof x === typeof v && x > v;
    case "gte":
      return typeof x === typeof v && x >= v;
    case "between":
      return Array.isArray(v) && v.length === 2 && x >= v[0] && x <= v[1];
    case "in":
      return Array.isArray(v) && v.includes(x);
    case "not_in":
      return !(Array.isArray(v) && v.includes(x));
    case "contains":
      return Array.isArray(x) && x.includes(v);
    case "not_contains":
      return !(Array.isArray(x) && x.includes(v));
    default:
      return false;
  }
};

export const evalCond = (tree, facts) => {
  if (tree && "all" in tree) return tree.all.every((t) => evalCond(t, facts));
  if (tree && "any" in tree) return tree.any.some((t) => evalCond(t, facts));
  if (tree && "not" in tree) return !evalCond(tree.not, facts);
  return evalCondition(tree, facts);
};

/** The tree annotated with `pass`, and for conditions the fact value seen: for an explanation view. */
export const explain = (tree, facts) => {
  if (tree && "all" in tree) {
    const children = tree.all.map((t) => explain(t, facts));
    return { kind: "all", children, pass: children.every((c) => c.pass) };
  }
  if (tree && "any" in tree) {
    const children = tree.any.map((t) => explain(t, facts));
    return { kind: "any", children, pass: children.some((c) => c.pass) };
  }
  if (tree && "not" in tree) {
    const child = explain(tree.not, facts);
    return { kind: "not", children: [child], pass: !child.pass };
  }
  return { kind: "cond", cond: tree, seen: read(facts, tree.field), pass: evalCondition(tree, facts) };
};
