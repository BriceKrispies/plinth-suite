/**
 * Minimal query compiler (spec 02 section 3.4, 05 section 8.9): typecheck a QueryAst against a Source schema and
 * compile it to parameterised DuckDB SQL over the published partitions. The workspace predicate and the event-time
 * bound (`time_column <= as_of`) are always injected. Pure and total: failures are `DomainError` values.
 */
import { Either } from "effect";
import {
  DomainError,
  didYouMean,
  withPath,
  type AggObject,
  type QueryAst,
  type SourceSpec,
  type ErrorCode,
} from "@plinth/spec";
import { FUNC_NAMES, ISO_TS, parseExpr, type Expr, type Ty } from "./expr";

export { didYouMean };

export interface ColumnInfo {
  readonly name: string;
  readonly type: Exclude<Ty, "null">;
}

export interface CompileInput {
  readonly ast: QueryAst;
  readonly source: SourceSpec;
  readonly sourceSlug: string;
  readonly workspaceId: string;
  readonly asOf: Date;
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
  /** `s3://bucket/key` URIs of the published partitions to read. Chosen by the caller from `source_partitions`. */
  readonly files: ReadonlyArray<string>;
  /** Cap on rows returned. The compiler asks for one extra row so the caller can set `truncated`. */
  readonly limit: number;
  /**
   * Row predicate in expression syntax, already combined across grants (allows OR'd, denies subtracted). It is
   * injected at the source relation, before any operator. Null or absent means all rows.
   */
  readonly rowPredicate?: string | null;
  /** Columns hidden from the caller. A reference to one is reported exactly as a reference to an absent column. */
  readonly maskedColumns?: ReadonlyArray<string>;
  /** Name of a pre-loaded table to read instead of `files` (metadata sources). It carries `workspace_id`. */
  readonly relation?: string;
}

export interface Compiled {
  readonly sql: string;
  readonly values: ReadonlyArray<string | number | boolean | null>;
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly lineage: ReadonlyArray<{ readonly source: string; readonly field: string }>;
  readonly injected: ReadonlyArray<{
    readonly kind: "workspace" | "event_time" | "row" | "mask";
    readonly predicate: string;
  }>;
  readonly maskedColumns: ReadonlyArray<string>;
  readonly limit: number;
}

type Val = string | number | boolean | null;
type Err = DomainError;
const err = (
  code: ErrorCode,
  path: string,
  message: string,
  extra?: Partial<ConstructorParameters<typeof DomainError>[0]>,
) => new DomainError({ code, path, message, ...extra });

const q = (id: string): string => `"${id.replace(/"/g, '""')}"`;

const toDuckTs = (d: Date): string => d.toISOString().replace("T", " ").replace("Z", "");
const isoToDuck = (s: string): string => {
  const d = new Date(
    /Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s.replace(" ", "T") + (s.length <= 10 ? "T00:00:00Z" : "Z"),
  );
  return Number.isNaN(d.getTime()) ? s : toDuckTs(d);
};

const tyOfField = (t: string): Ty => (t.startsWith("enum(") ? "string" : (t as Ty));
const isNum = (t: Ty): boolean => t === "int" || t === "float";
const comparable = (a: Ty, b: Ty): boolean =>
  a === b || (isNum(a) && isNum(b)) || a === "null" || b === "null";

/** Object aggregate {fn, of?, p?} to its string form. The string form is the alias of the object form. */
export const normalizeAgg = (a: string | AggObject): Either.Either<string, DomainError> => {
  if (typeof a === "string") return Either.right(a);
  const bad = (message: string, expected: string) =>
    Either.left(new DomainError({ code: "VALIDATION_FAILED", path: "", message, expected }));
  if (a.fn === "count") return Either.right("count()");
  if (a.of === undefined)
    return bad(
      `aggregate fn '${a.fn}' needs "of" (the field or expression)`,
      `{"fn":"${a.fn}","of":"latency_ms"}`,
    );
  if (a.fn === "percentile") {
    if (a.p === undefined)
      return bad(
        'percentile needs "p" strictly between 0 and 1',
        '{"fn":"percentile","of":"latency_ms","p":0.95}',
      );
    return Either.right(`percentile(${a.of}, ${a.p})`);
  }
  return Either.right(`${a.fn}(${a.of})`);
};

const AGG_RE = /^(count|count_distinct|sum|avg|min|max|percentile)\((.*)\)$/s;

export const compileQuery = (input: CompileInput): Either.Either<Compiled, Err> => {
  const { ast, source } = input;
  const values: Val[] = [input.workspaceId, toDuckTs(input.asOf)];
  const bind = (v: Val): string => {
    values.push(v);
    return `$${values.length}`;
  };
  const lineage = new Map<string, { source: string; field: string }>();
  const env = new Map<string, Ty>(source.fields.map((f) => [f.name, tyOfField(f.type)] as const));
  const sourceFields = source.fields.map((f) => f.name);
  const fullEnv = new Map(env);
  const maskedSet = new Set<string>([
    ...source.fields.filter((f) => f.masked === true).map((f) => f.name),
    ...(input.maskedColumns ?? []),
  ]);
  for (const m of maskedSet) env.delete(m);
  const fieldEnums = new Map<string, ReadonlyArray<string>>();
  for (const f of source.fields) {
    const m = /^enum\(([a-z_]+)\)$/.exec(f.type);
    const vals = m ? source.enums?.[m[1] ?? ""] : undefined;
    if (vals) fieldEnums.set(f.name, vals);
  }
  const known = (): string[] => [...env.keys()];

  if (!ast.from.startsWith("source:")) {
    return Either.left(
      err("VALIDATION_FAILED", "/from", "subqueries (query:slug) are not available yet", {
        expected: "source:<slug>",
      }),
    );
  }

  type G = Either.Either<{ readonly sql: string; readonly ty: Ty }, Err>;
  const ok = (sql: string, ty: Ty): G => Either.right({ sql, ty });
  const bad = (
    code: ErrorCode,
    path: string,
    message: string,
    extra?: Partial<ConstructorParameters<typeof DomainError>[0]>,
  ): G => Either.left(err(code, path, message, extra));

  const paramTy = (v: Val): Ty =>
    v === null
      ? "null"
      : typeof v === "boolean"
        ? "bool"
        : typeof v === "number"
          ? Number.isInteger(v)
            ? "int"
            : "float"
          : ISO_TS.test(v)
            ? "timestamp"
            : "string";

  const gen = (e: Expr, path: string): G => {
    switch (e.t) {
      case "lit":
        switch (e.ty) {
          case "int":
          case "float":
          case "duration":
            return ok(String(e.v), e.ty);
          case "bool":
            return ok(e.v ? "TRUE" : "FALSE", "bool");
          case "null":
            return ok("NULL", "null");
          case "timestamp":
            return ok(`CAST(${bind(isoToDuck(String(e.v)))} AS TIMESTAMP)`, "timestamp");
          default:
            return ok(bind(String(e.v)), "string");
        }
      case "field": {
        const ty = env.get(e.name);
        if (ty === undefined)
          return bad("UNKNOWN_FIELD", path, `unknown field '${e.name}'`, {
            allowed: known().slice(0, 20),
            did_you_mean: didYouMean(e.name, known()),
          });
        if (sourceFields.includes(e.name)) lineage.set(e.name, { source: input.sourceSlug, field: e.name });
        return ok(q(e.name), ty);
      }
      case "param": {
        if (!(e.name in input.params))
          return bad("VALIDATION_FAILED", path, `parameter '$${e.name}' has no value`, {
            expected: "a value in params",
          });
        const v = input.params[e.name] as Val;
        const ty = paramTy(v);
        return ty === "timestamp"
          ? ok(`CAST(${bind(isoToDuck(String(v)))} AS TIMESTAMP)`, ty)
          : ok(bind(v), ty);
      }
      case "un": {
        const inner = gen(e.e, path);
        if (Either.isLeft(inner)) return inner;
        if (e.op === "not")
          return inner.right.ty === "bool"
            ? ok(`(NOT ${inner.right.sql})`, "bool")
            : bad("TYPE_MISMATCH", path, "'not' needs a bool", {
                expected: "bool",
                details: { got: inner.right.ty },
              });
        return isNum(inner.right.ty) || inner.right.ty === "duration"
          ? ok(`(-${inner.right.sql})`, inner.right.ty)
          : bad("TYPE_MISMATCH", path, "unary '-' needs a number or duration", {
              expected: "int|float|duration",
              details: { got: inner.right.ty },
            });
      }
      case "bin": {
        const l = gen(e.l, path);
        if (Either.isLeft(l)) return l;
        const r = gen(e.r, path);
        if (Either.isLeft(r)) return r;
        const a = l.right;
        const b = r.right;
        const mismatch = (expected: string) =>
          bad("TYPE_MISMATCH", path, `operator '${e.op}' cannot combine ${a.ty} and ${b.ty}`, {
            expected,
            details: { got: `${a.ty} ${e.op} ${b.ty}` },
          });
        switch (e.op) {
          case "and":
          case "or":
            return a.ty === "bool" && b.ty === "bool"
              ? ok(`(${a.sql} ${e.op.toUpperCase()} ${b.sql})`, "bool")
              : mismatch("bool and bool");
          case "=":
          case "!=":
          case "<":
          case "<=":
          case ">":
          case ">=":
            return comparable(a.ty, b.ty)
              ? ok(`(${a.sql} ${e.op === "!=" ? "<>" : e.op} ${b.sql})`, "bool")
              : mismatch("operands of equal type");
          case "+":
          case "-": {
            if (isNum(a.ty) && isNum(b.ty))
              return ok(
                `(${a.sql} ${e.op} ${b.sql})`,
                a.ty === "float" || b.ty === "float" ? "float" : "int",
              );
            if (a.ty === "duration" && b.ty === "duration")
              return ok(`(${a.sql} ${e.op} ${b.sql})`, "duration");
            if (a.ty === "timestamp" && b.ty === "timestamp" && e.op === "-")
              return ok(`(epoch_ms(${a.sql}) - epoch_ms(${b.sql}))`, "duration");
            if (a.ty === "timestamp" && b.ty === "duration")
              return ok(`(${a.sql} ${e.op} to_milliseconds(CAST(${b.sql} AS BIGINT)))`, "timestamp");
            return mismatch("numbers, durations, or timestamp and duration");
          }
          case "*":
          case "/": {
            if (isNum(a.ty) && isNum(b.ty))
              return ok(
                `(${a.sql} ${e.op} ${b.sql})`,
                e.op === "/" || a.ty === "float" || b.ty === "float" ? "float" : "int",
              );
            if (a.ty === "duration" && isNum(b.ty)) return ok(`(${a.sql} ${e.op} ${b.sql})`, "duration");
            return mismatch("numbers");
          }
          default:
            return bad("VALIDATION_FAILED", path, `unsupported operator '${e.op}'`);
        }
      }
      case "call": {
        const args: Array<{ sql: string; ty: Ty }> = [];
        for (const [ai, a] of e.args.entries()) {
          if (e.fn === "bucket" && ai === 1) {
            args.push({ sql: "", ty: "string" });
            continue;
          }
          const g = gen(a, path);
          if (Either.isLeft(g)) return g;
          args.push(g.right);
        }
        const arity = (n: number): G | undefined =>
          args.length === n
            ? undefined
            : bad("VALIDATION_FAILED", path, `${e.fn}() takes ${n} argument(s), got ${args.length}`);
        const a0 = args[0];
        const a1 = args[1];
        switch (e.fn) {
          case "now":
            return arity(0) ?? ok("CAST($2 AS TIMESTAMP)", "timestamp");
          case "abs":
            return (
              arity(1) ??
              (a0 && isNum(a0.ty)
                ? ok(`abs(${a0.sql})`, a0.ty)
                : bad("TYPE_MISMATCH", path, "abs() needs a number", { expected: "int|float" }))
            );
          case "ms":
            return (
              arity(1) ??
              (a0 && a0.ty === "duration"
                ? ok(`CAST(${a0.sql} AS BIGINT)`, "int")
                : bad("TYPE_MISMATCH", path, "ms() needs a duration", {
                    expected: "duration",
                    details: { got: a0?.ty ?? "none" },
                  }))
            );
          case "round":
            return (
              arity(2) ??
              (a0 && a1 && isNum(a0.ty) && a1.ty === "int"
                ? ok(`round(${a0.sql}, ${a1.sql})`, "float")
                : bad("TYPE_MISMATCH", path, "round(number, int)", { expected: "round(int|float, int)" }))
            );
          case "coalesce": {
            if (args.length === 0) return bad("VALIDATION_FAILED", path, "coalesce() needs arguments");
            const first = args.find((x) => x.ty !== "null");
            const t = first?.ty ?? "null";
            return args.every((x) => comparable(x.ty, t))
              ? ok(`coalesce(${args.map((x) => x.sql).join(", ")})`, t)
              : bad("TYPE_MISMATCH", path, "coalesce() arguments must share a type", { expected: t });
          }
          case "date_trunc": {
            const d = e.args[0];
            if (arity(2) || !a1 || !d || d.t !== "lit" || d.ty !== "duration" || a1.ty !== "timestamp")
              return bad("TYPE_MISMATCH", path, "date_trunc(<duration literal>, <timestamp>)", {
                expected: "date_trunc(1h, timestamp)",
              });
            return ok(
              `(TIMESTAMP '1970-01-01' + to_milliseconds(CAST(floor(epoch_ms(${a1.sql}) / ${String(d.v)}) * ${String(d.v)} AS BIGINT)))`,
              "timestamp",
            );
          }
          case "bucket": {
            const u = e.args[1];
            const m =
              u && u.t === "lit" && u.ty === "string"
                ? /^\s*(\d+)\s*(second|minute|hour|day)s?\s*$/i.exec(String(u.v))
                : null;
            if (arity(2) || !a0 || a0.ty !== "timestamp" || !m)
              return bad("TYPE_MISMATCH", path, "bucket(<timestamp>, '<n> <second|minute|hour|day>')", {
                expected: "bucket(placed_at, '1 minute')",
              });
            const unit = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 }[
              (m[2] ?? "minute").toLowerCase() as "second" | "minute" | "hour" | "day"
            ];
            const size = Number(m[1]) * unit;
            if (size <= 0) return bad("VALIDATION_FAILED", path, "bucket size must be positive");
            return ok(
              `(TIMESTAMP '1970-01-01' + to_milliseconds(CAST(floor(epoch_ms(${a0.sql}) / ${size}) * ${size} AS BIGINT)))`,
              "timestamp",
            );
          }
          default:
            return bad("VALIDATION_FAILED", path, `unknown function '${e.fn}'`);
        }
      }
    }
  };

  const genStr = (src: string, path: string): G => {
    const p = parseExpr(src);
    return Either.isLeft(p)
      ? bad("VALIDATION_FAILED", path, `cannot parse expression '${src}': ${p.left.message}`, {
          expected:
            "an expression, e.g. ms(fulfilled_at - placed_at), now() - 1h, bucket(placed_at, '1 minute')",
          ...(p.left.message.startsWith("unknown function")
            ? {
                allowed: [...FUNC_NAMES],
                did_you_mean: didYouMean(/'([^']*)'/.exec(p.left.message)?.[1] ?? "", [...FUNC_NAMES]),
              }
            : {}),
        })
      : gen(p.right, path);
  };

  // --- bounded scan rule (02 section 3.4.6 item 6) ---
  const timeCol = source.time_column;
  const bounded = (ast.where ?? []).some((p) => p.field === timeCol && (p.op === "gt" || p.op === "gte"));
  if (source.kind === "landed" && !bounded) {
    return Either.left(
      err("QUERY_TIMEOUT", "/where", `a query over a landed source needs a lower bound on '${timeCol}'`, {
        expected: `a top-level where conjunct on ${timeCol} with op gt or gte`,
        fix_hint: `Add {"field":"${timeCol}","op":"gte","value":"now() - 24h"} to where.`,
        suggestion: {
          kind: "replace",
          path: "/where",
          value: [...(ast.where ?? []), { field: timeCol, op: "gte", value: "now() - 24h" }],
        },
      }),
    );
  }
  if (!env.has(timeCol))
    return Either.left(err("VALIDATION_FAILED", "", `source time_column '${timeCol}' is not a field`));

  // --- file list: only keys of a safe alphabet reach the SQL text ---
  for (const f of input.files) {
    if (!/^s3:\/\/[A-Za-z0-9_.\-/=]+$/.test(f))
      return Either.left(err("VALIDATION_FAILED", "", `unsafe partition key '${f}'`));
  }

  const ctes: string[] = [];
  let rowSql: string | undefined;
  const rp = input.rowPredicate?.trim();
  if (rp) {
    const parsed = parseExpr(rp);
    if (Either.isLeft(parsed))
      return Either.left(
        err("VALIDATION_FAILED", "/policy/row_predicate", `row predicate is invalid: ${parsed.left.message}`),
      );
    const saved = new Map(env);
    for (const [k, v] of fullEnv) env.set(k, v);
    const g = gen(parsed.right, "/policy/row_predicate");
    env.clear();
    for (const [k, v] of saved) env.set(k, v);
    if (Either.isLeft(g)) return Either.left(g.left);
    if (g.right.ty !== "bool")
      return Either.left(
        err("TYPE_MISMATCH", "/policy/row_predicate", "row predicate must be a bool expression"),
      );
    rowSql = g.right.sql;
  }
  const injected: Array<{ kind: "workspace" | "event_time" | "row" | "mask"; predicate: string }> = [
    { kind: "workspace", predicate: `workspace_id = $1` },
    { kind: "event_time", predicate: `${timeCol} <= $2` },
  ];
  const fileList = input.files.length === 0 ? "" : input.files.map((f) => `'${f}'`).join(", ");
  const relation =
    input.relation !== undefined
      ? q(input.relation)
      : input.files.length === 0
        ? `(SELECT ${sourceFields.map((f) => `CAST(NULL AS ${duckType(env.get(f) ?? "string")}) AS ${q(f)}`).join(", ")} WHERE FALSE)`
        : `read_parquet([${fileList}], union_by_name = true)`;
  ctes.push(
    `src AS (SELECT ${sourceFields.map(q).join(", ")} FROM ${relation} WHERE ${input.files.length === 0 && input.relation === undefined ? "TRUE" : `"workspace_id" = $1`} AND ${q(timeCol)} <= CAST($2 AS TIMESTAMP)${rowSql !== undefined ? ` AND (${rowSql})` : ""})`,
  );
  let prev = "src";
  if (rp) injected.push({ kind: "row", predicate: rp });
  if (maskedSet.size > 0) injected.push({ kind: "mask", predicate: [...maskedSet].sort().join(", ") });

  // --- where ---
  const preds: string[] = [];
  for (const [i, p] of (ast.where ?? []).entries()) {
    const path = `/where/${i}`;
    const ty = env.get(p.field);
    if (ty === undefined)
      return Either.left(
        err("UNKNOWN_FIELD", `${path}/field`, `unknown field '${p.field}'`, {
          allowed: known().slice(0, 20),
          did_you_mean: didYouMean(p.field, known()),
        }),
      );
    if (sourceFields.includes(p.field)) lineage.set(p.field, { source: input.sourceSlug, field: p.field });
    const col = q(p.field);
    if (p.op === "is_null") {
      preds.push(`${col} IS NULL`);
      continue;
    }
    if (p.op === "not_null") {
      preds.push(`${col} IS NOT NULL`);
      continue;
    }
    if (p.value === undefined)
      return Either.left(
        err("VALIDATION_FAILED", `${path}/value`, `operator '${p.op}' needs a value`, {
          expected: "a literal or expression",
        }),
      );
    const enumVals = fieldEnums.get(p.field);
    const one = (v: unknown, vpath: string): G => {
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        const e = (v as { expr?: unknown }).expr;
        return typeof e === "string"
          ? genStr(e, vpath)
          : bad("VALIDATION_FAILED", vpath, 'an object value must be {"expr": "<expression>"}', {
              expected: '{"expr":"now() - 1h"}',
            });
      }
      if (v === null) return ok("NULL", "null");
      if (typeof v === "boolean") return ok(v ? "TRUE" : "FALSE", "bool");
      if (typeof v === "number") return ok(String(v), Number.isInteger(v) ? "int" : "float");
      const sv = String(v);
      if (ty === "string") {
        if (
          sv.length >= 2 &&
          ((sv.startsWith("'") && sv.endsWith("'")) || (sv.startsWith('"') && sv.endsWith('"')))
        ) {
          const raw = sv.slice(1, -1);
          return bad("VALIDATION_FAILED", vpath, `value looks quoted; pass the raw string ${raw}`, {
            expected: `the raw string ${raw}, without quotes`,
            suggestion: { kind: "replace", path: vpath, value: raw },
          });
        }
        if (/^\$[a-z_][a-z0-9_]*$/.test(sv)) return genStr(sv, vpath);
        if (enumVals && !enumVals.includes(sv))
          return bad(
            "VALIDATION_FAILED",
            vpath,
            `'${sv}' is not a value of ${p.field}; allowed: ${enumVals.join(", ")}`,
            {
              expected: `one of ${enumVals.join(", ")}`,
              allowed: [...enumVals],
              did_you_mean: didYouMean(sv, enumVals),
            },
          );
        return ok(bind(sv), "string");
      }
      if (ty === "timestamp" && ISO_TS.test(sv))
        return ok(`CAST(${bind(isoToDuck(sv))} AS TIMESTAMP)`, "timestamp");
      return genStr(sv, vpath);
    };
    if (p.op === "in" || p.op === "not_in") {
      const list: ReadonlyArray<unknown> = Array.isArray(p.value) ? p.value : [p.value];
      const parts: string[] = [];
      for (const [j, v] of list.entries()) {
        const g = one(v, `${path}/value/${j}`);
        if (Either.isLeft(g)) return Either.left(g.left);
        if (!comparable(ty, g.right.ty))
          return Either.left(
            err("TYPE_MISMATCH", `${path}/value/${j}`, `'${p.field}' is ${ty}, value is ${g.right.ty}`, {
              expected: ty,
              details: { got: g.right.ty },
            }),
          );
        parts.push(g.right.sql);
      }
      preds.push(`${col} ${p.op === "in" ? "IN" : "NOT IN"} (${parts.join(", ")})`);
      continue;
    }
    if (Array.isArray(p.value))
      return Either.left(
        err("TYPE_MISMATCH", `${path}/value`, `operator '${p.op}' takes a single value`, {
          expected: "scalar",
        }),
      );
    const g = one(p.value, `${path}/value`);
    if (Either.isLeft(g)) return Either.left(g.left);
    if (!comparable(ty, g.right.ty))
      return Either.left(
        err("TYPE_MISMATCH", `${path}/value`, `'${p.field}' is ${ty}, value is ${g.right.ty}`, {
          expected: ty,
          details: { got: g.right.ty },
        }),
      );
    const sqlOp = { eq: "=", ne: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=" }[
      p.op as "eq" | "ne" | "lt" | "lte" | "gt" | "gte"
    ];
    preds.push(`${col} ${sqlOp} ${g.right.sql}`);
  }
  if (preds.length > 0) {
    ctes.push(`w AS (SELECT * FROM ${prev} WHERE ${preds.join(" AND ")})`);
    prev = "w";
  }

  // --- derive (sequential: a later expression may use an earlier name) ---
  const derivedNames: string[] = [];
  for (const [name, src] of Object.entries(ast.derive ?? {})) {
    if (env.has(name))
      return Either.left(
        err(
          "VALIDATION_FAILED",
          `/derive/${name}`,
          `derived name '${name}' collides with an existing field`,
          { expected: "a new name" },
        ),
      );
    const g = genStr(src, `/derive/${name}`);
    if (Either.isLeft(g)) return Either.left(g.left);
    const cte = `d_${derivedNames.length}`;
    ctes.push(`${cte} AS (SELECT *, ${g.right.sql} AS ${q(name)} FROM ${prev})`);
    prev = cte;
    env.set(name, g.right.ty);
    derivedNames.push(name);
  }

  // --- group / aggregate / select ---
  const outCols: ColumnInfo[] = [];
  const selectParts: string[] = [];
  let groupBy = "";
  const group = ast.group ?? [];
  const aggs = Object.entries(ast.aggregate ?? {});
  const colType = (t: Ty): ColumnInfo["type"] => (t === "null" ? "string" : t);

  if (group.length > 0 || aggs.length > 0) {
    for (const [i, g] of group.entries()) {
      const ty = env.get(g);
      if (ty === undefined)
        return Either.left(
          err("UNKNOWN_FIELD", `/group/${i}`, `unknown field '${g}'`, {
            allowed: known().slice(0, 20),
            did_you_mean: didYouMean(g, known()),
          }),
        );
      if (sourceFields.includes(g)) lineage.set(g, { source: input.sourceSlug, field: g });
      outCols.push({ name: g, type: colType(ty) });
      selectParts.push(q(g));
    }
    for (const [name, raw] of aggs) {
      const norm = normalizeAgg(raw);
      if (Either.isLeft(norm))
        return Either.left(withPath(norm.left, `/aggregate/${name}`));
      const src = norm.right;
      const m = AGG_RE.exec(src.trim());
      const path = `/aggregate/${name}`;
      if (!m)
        return Either.left(
          err("VALIDATION_FAILED", path, `'${src}' is not an aggregate`, {
            expected:
              '{"fn":"percentile","of":"latency_ms","p":0.95} or "count()" / "sum(x)" / "percentile(x, 0.95)"',
          }),
        );
      const fn = m[1] ?? "";
      const inner = (m[2] ?? "").trim();
      if (outCols.some((c) => c.name === name))
        return Either.left(err("VALIDATION_FAILED", path, `duplicate output name '${name}'`));
      if (fn === "count") {
        if (inner !== "") return Either.left(err("VALIDATION_FAILED", path, "count() takes no argument"));
        outCols.push({ name, type: "int" });
        selectParts.push(`count(*) AS ${q(name)}`);
        continue;
      }
      let argSrc = inner;
      let p = 0;
      if (fn === "percentile") {
        const cut = inner.lastIndexOf(",");
        if (cut < 0)
          return Either.left(
            err("VALIDATION_FAILED", path, "percentile(expr, p) needs p", {
              expected: "percentile(expr, 0.95)",
            }),
          );
        argSrc = inner.slice(0, cut).trim();
        p = Number(inner.slice(cut + 1).trim());
        if (!(p > 0 && p < 1))
          return Either.left(
            err("TYPE_MISMATCH", path, "percentile p must be strictly between 0 and 1", {
              expected: "0 < p < 1",
            }),
          );
      }
      const g = genStr(argSrc, path);
      if (Either.isLeft(g)) return Either.left(g.left);
      const { sql, ty } = g.right;
      switch (fn) {
        case "count_distinct":
          outCols.push({ name, type: "int" });
          selectParts.push(`count(DISTINCT ${sql}) AS ${q(name)}`);
          break;
        case "sum":
        case "avg":
        case "percentile":
          if (!isNum(ty) && !(ty === "duration"))
            return Either.left(
              err("TYPE_MISMATCH", path, `${fn}() needs a numeric argument`, {
                expected: "int|float|duration",
                details: { got: ty },
              }),
            );
          outCols.push({ name, type: fn === "sum" ? colType(ty) : "float" });
          selectParts.push(
            fn === "percentile"
              ? `quantile_cont(${sql}, ${String(p)}) AS ${q(name)}`
              : `${fn}(${sql}) AS ${q(name)}`,
          );
          break;
        default:
          outCols.push({ name, type: colType(ty) });
          selectParts.push(`${fn}(${sql}) AS ${q(name)}`);
      }
    }
    if (group.length > 0) groupBy = ` GROUP BY ${group.map(q).join(", ")}`;
  } else {
    const names = ast.select ?? [...sourceFields.filter((f) => !maskedSet.has(f)), ...derivedNames];
    for (const [i, n] of names.entries()) {
      const ty = env.get(n);
      if (ty === undefined)
        return Either.left(
          err("UNKNOWN_FIELD", `/select/${i}`, `unknown field '${n}'`, {
            allowed: known().slice(0, 20),
            did_you_mean: didYouMean(n, known()),
          }),
        );
      if (sourceFields.includes(n)) lineage.set(n, { source: input.sourceSlug, field: n });
      outCols.push({ name: n, type: colType(ty) });
      selectParts.push(q(n));
    }
  }

  // --- order / limit ---
  const outNames = outCols.map((c) => c.name);
  const orderParts: string[] = [];
  for (const [i, o] of (ast.order ?? []).entries()) {
    if (!outNames.includes(o.field))
      return Either.left(
        err("UNKNOWN_FIELD", `/order/${i}/field`, `cannot order by '${o.field}': not in the output`, {
          allowed: outNames,
          did_you_mean: didYouMean(o.field, outNames),
        }),
      );
    orderParts.push(`${q(o.field)} ${o.dir === "desc" ? "DESC" : "ASC"}`);
  }
  const limit = Math.min(ast.limit ?? input.limit, input.limit);
  const sql =
    `WITH ${ctes.join(",\n")}\n` +
    `SELECT ${selectParts.join(", ")} FROM ${prev}${groupBy}` +
    (orderParts.length > 0 ? ` ORDER BY ${orderParts.join(", ")}` : "") +
    ` LIMIT ${limit + 1}`;
  return Either.right({
    sql,
    values,
    columns: outCols,
    lineage: [...lineage.values()],
    injected,
    maskedColumns: [...maskedSet].sort(),
    limit,
  });
};

const duckType = (t: Ty): string => {
  switch (t) {
    case "int":
    case "duration":
      return "BIGINT";
    case "float":
      return "DOUBLE";
    case "bool":
      return "BOOLEAN";
    case "timestamp":
      return "TIMESTAMP";
    default:
      return "VARCHAR";
  }
};

/** Typecheck only: the output columns of a query against a source, without needing partitions. */
export const typecheckQuery = (
  ast: QueryAst,
  source: SourceSpec,
  sourceSlug: string,
): Either.Either<ReadonlyArray<ColumnInfo>, Err> =>
  Either.map(
    compileQuery({
      ast,
      source,
      sourceSlug,
      workspaceId: "00000000-0000-0000-0000-000000000000",
      asOf: new Date(0),
      params: {},
      files: [],
      limit: 1,
    }),
    (c) => c.columns,
  );
