import { canonicalize } from "./canonical";
import { Either } from "effect";
import type { Json, Op } from "@plinth/spec";

/** Pure change application: apply ops to a node body, compute inverse ops, name touched paths. */

export interface OpFailure {
  readonly path: string;
  readonly message: string;
}
export interface Applied {
  /** The body after the ops. For a soft delete the body is unchanged and `deleted` is true. */
  readonly body: Json | undefined;
  readonly deleted: boolean;
}

type R<T> = { readonly ok: true; readonly v: T } | { readonly ok: false; readonly e: OpFailure };
const ok = <T>(v: T): R<T> => ({ ok: true, v });
const fail = (path: string, message: string): R<never> => ({ ok: false, e: { path, message } });

export const parsePointer = (p: string): ReadonlyArray<string> =>
  p === ""
    ? []
    : p
        .split("/")
        .slice(1)
        .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));

export const formatPointer = (tokens: ReadonlyArray<string>): string =>
  tokens.map((t) => "/" + t.replace(/~/g, "~0").replace(/\//g, "~1")).join("");

const isObj = (v: unknown): v is { readonly [k: string]: Json } =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isIndex = (t: string): boolean => /^(0|[1-9][0-9]*)$/.test(t);

export const getAt = (root: Json | undefined, tokens: ReadonlyArray<string>): Json | undefined => {
  let cur: Json | undefined = root;
  for (const t of tokens) {
    if (Array.isArray(cur)) cur = isIndex(t) ? (cur as ReadonlyArray<Json>)[Number(t)] : undefined;
    else if (isObj(cur)) cur = Object.prototype.hasOwnProperty.call(cur, t) ? cur[t] : undefined;
    else return undefined;
    if (cur === undefined) return undefined;
  }
  return cur;
};

/**
 * `set`: object member is created or replaced. Array element: an existing index replaces, `-` or the index equal
 * to the length appends. Parents must exist.
 */
const setAt = (cur: Json | undefined, tokens: ReadonlyArray<string>, value: Json, full: string): R<Json> => {
  const [head, ...rest] = tokens;
  if (head === undefined) return ok(value);
  if (Array.isArray(cur)) {
    const arr = cur as ReadonlyArray<Json>;
    const idx = head === "-" ? arr.length : isIndex(head) ? Number(head) : -1;
    if (idx < 0 || idx > arr.length)
      return fail(full, `array index '${head}' is out of range (length ${arr.length})`);
    if (rest.length === 0) {
      const next = arr.slice();
      next[idx] = value;
      return ok(next);
    }
    if (idx === arr.length) return fail(full, `parent '${head}' does not exist`);
    const child = setAt(arr[idx], rest, value, full);
    if (!child.ok) return child;
    const next = arr.slice();
    next[idx] = child.v;
    return ok(next);
  }
  if (isObj(cur)) {
    if (rest.length === 0) return ok({ ...cur, [head]: value });
    if (!Object.prototype.hasOwnProperty.call(cur, head))
      return fail(full, `parent '${head}' does not exist`);
    const child = setAt(cur[head], rest, value, full);
    if (!child.ok) return child;
    return ok({ ...cur, [head]: child.v });
  }
  return fail(full, `cannot descend into a scalar at '${head}'`);
};

const removeAt = (cur: Json | undefined, tokens: ReadonlyArray<string>, full: string): R<Json> => {
  const [head, ...rest] = tokens;
  if (head === undefined) return fail(full, "cannot remove the document root");
  if (Array.isArray(cur)) {
    const arr = cur as ReadonlyArray<Json>;
    if (!isIndex(head) || Number(head) >= arr.length) return fail(full, `no array element '${head}'`);
    const idx = Number(head);
    if (rest.length === 0) return ok(arr.filter((_, i) => i !== idx));
    const child = removeAt(arr[idx], rest, full);
    if (!child.ok) return child;
    const next = arr.slice();
    next[idx] = child.v;
    return ok(next);
  }
  if (isObj(cur)) {
    if (!Object.prototype.hasOwnProperty.call(cur, head)) return fail(full, `no member '${head}'`);
    if (rest.length === 0) {
      const { [head]: _gone, ...others } = cur;
      return ok(others);
    }
    const child = removeAt(cur[head], rest, full);
    if (!child.ok) return child;
    return ok({ ...cur, [head]: child.v });
  }
  return fail(full, `cannot descend into a scalar at '${head}'`);
};

const applyOne = (cur: Applied, op: Op): R<Applied> => {
  switch (op.op) {
    case "create":
      return cur.body === undefined
        ? ok({ body: op.body as Json, deleted: false })
        : fail("", "node already exists");
    case "set": {
      if (cur.body === undefined) return fail(op.path, "node does not exist");
      const r = setAt(cur.body, parsePointer(op.path), op.value as Json, op.path);
      return r.ok ? ok({ body: r.v, deleted: cur.deleted }) : r;
    }
    case "remove": {
      if (cur.body === undefined) return fail(op.path, "node does not exist");
      const r = removeAt(cur.body, parsePointer(op.path), op.path);
      return r.ok ? ok({ body: r.v, deleted: cur.deleted }) : r;
    }
    case "delete":
      return cur.body === undefined ? fail("", "node does not exist") : ok({ body: cur.body, deleted: true });
  }
};

export const applyOps = (
  body: Json | undefined,
  ops: ReadonlyArray<Op>,
  deleted = false,
): Either.Either<Applied, OpFailure> => {
  let cur: Applied = { body, deleted };
  for (const op of ops) {
    const r = applyOne(cur, op);
    if (!r.ok) return Either.left(r.e);
    cur = r.v;
  }
  return Either.right(cur);
};

/**
 * Inverse ops computed from the pre-image (spec 02 section 3.9.10). Applying the result to the post-image restores
 * the body. A removal from an array is inverted by restoring the whole array, which is coarse but exact.
 * Inverting a create is a soft `delete`; inverting a `delete` has no body to restore and is reported as `remove` of
 * nothing, so callers treat deletes as non-invertible here (undo of a delete is an L5 concern).
 */
export const inverseOps = (before: Json | undefined, ops: ReadonlyArray<Op>): ReadonlyArray<Op> => {
  const inverses: Op[] = [];
  let cur: Applied = { body: before, deleted: false };
  for (const op of ops) {
    if (op.op === "create") inverses.push({ op: "delete" });
    else if (op.op === "set") {
      const tokens = parsePointer(op.path);
      const parentTokens = tokens.slice(0, -1);
      const last = tokens[tokens.length - 1];
      const parent = getAt(cur.body, parentTokens);
      const prev = getAt(cur.body, tokens);
      if (
        Array.isArray(parent) &&
        last !== undefined &&
        (last === "-" || (isIndex(last) && Number(last) === parent.length))
      ) {
        inverses.push({ op: "remove", path: formatPointer([...parentTokens, String(parent.length)]) });
      } else if (prev === undefined) inverses.push({ op: "remove", path: op.path });
      else inverses.push({ op: "set", path: op.path, value: prev });
    } else if (op.op === "remove") {
      const tokens = parsePointer(op.path);
      const parentTokens = tokens.slice(0, -1);
      const parent = getAt(cur.body, parentTokens);
      if (Array.isArray(parent))
        inverses.push({ op: "set", path: formatPointer(parentTokens), value: parent });
      else {
        const prev = getAt(cur.body, tokens);
        if (prev !== undefined) inverses.push({ op: "set", path: op.path, value: prev });
      }
    }
    const r = applyOne(cur, op);
    if (r.ok) cur = r.v;
  }
  return inverses.reverse();
};

/** JSON Pointer paths a list of ops touches (stored in `changes.paths`). A create or delete touches the root. */
export const touchedPaths = (ops: ReadonlyArray<Op>): ReadonlyArray<string> => {
  const out = new Set<string>();
  for (const op of ops) out.add(op.op === "create" || op.op === "delete" ? "" : op.path);
  return [...out].sort();
};

/** Two paths overlap when equal or one is an ancestor of the other. The root overlaps everything. */
export const pathsOverlap = (a: string, b: string): boolean =>
  a === "" || b === "" || a === b || a.startsWith(b + "/") || b.startsWith(a + "/");

export const anyOverlap = (as: ReadonlyArray<string>, bs: ReadonlyArray<string>): ReadonlyArray<string> =>
  as.filter((a) => bs.some((b) => pathsOverlap(a, b)));

const sameJson = (a: unknown, b: unknown): boolean => canonicalize(a) === canonicalize(b);

/**
 * A structural diff between two bodies as `set`/`remove` ops (objects recurse, equal-length arrays recurse by index,
 * other arrays are replaced whole). `changed_paths` lists the pointers touched. Pure.
 */
export const diffJson = (
  a: Json | undefined,
  b: Json | undefined,
): { readonly ops: ReadonlyArray<Op>; readonly changed_paths: ReadonlyArray<string> } => {
  const ops: Op[] = [];
  const walk = (x: Json | undefined, y: Json | undefined, tokens: ReadonlyArray<string>): void => {
    if (sameJson(x, y)) return;
    const path = formatPointer(tokens);
    if (y === undefined) {
      ops.push({ op: "remove", path });
      return;
    }
    if (isObj(x) && isObj(y)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)]).values())
        walk(x[k], y[k], [...tokens, k]);
      return;
    }
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length) {
      y.forEach((_, i) =>
        walk((x as ReadonlyArray<Json>)[i], (y as ReadonlyArray<Json>)[i], [...tokens, String(i)]),
      );
      return;
    }
    ops.push({ op: "set", path, value: y });
  };
  walk(a, b, []);
  return {
    ops,
    changed_paths: [...new Set(ops.map((o) => (o.op === "set" || o.op === "remove" ? o.path : "")))].sort(),
  };
};

/** A value-free summary of ops, e.g. `set /metadata/title (1); remove /spec/x (1)`. */
export const summarizeOps = (ops: ReadonlyArray<Op>): string => {
  const counts = new Map<string, number>();
  for (const o of ops) {
    const key = o.op === "set" || o.op === "remove" ? `${o.op} ${o.path || "(document)"}` : o.op;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => `${k} (${n})`).join("; ");
};
