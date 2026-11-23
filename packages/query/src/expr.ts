/**
 * Expression language of the query AST (spec 02 section 3.4.4), L1 subset: literals, field references,
 * `$param`, arithmetic, comparison, `and`/`or`/`not`, and the closed function list. Pure and total.
 */
import { Either } from "effect";

export type Ty = "bool" | "int" | "float" | "string" | "timestamp" | "duration" | "null";

export type Expr =
  | { readonly t: "lit"; readonly ty: Ty; readonly v: string | number | boolean | null }
  | { readonly t: "field"; readonly name: string }
  | { readonly t: "param"; readonly name: string }
  | { readonly t: "bin"; readonly op: string; readonly l: Expr; readonly r: Expr }
  | { readonly t: "un"; readonly op: "not" | "-"; readonly e: Expr }
  | { readonly t: "call"; readonly fn: string; readonly args: ReadonlyArray<Expr> };

export interface ExprError {
  readonly message: string;
}

type Tok =
  | { readonly k: "num"; readonly v: number; readonly float: boolean }
  | { readonly k: "dur"; readonly ms: number }
  | { readonly k: "str"; readonly v: string }
  | { readonly k: "id"; readonly v: string }
  | { readonly k: "param"; readonly v: string }
  | { readonly k: "op"; readonly v: string };

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
export const ISO_TS =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

const tokenize = (src: string): Either.Either<ReadonlyArray<Tok>, ExprError> => {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ws = /^\s+/.exec(rest);
    if (ws) {
      i += ws[0].length;
      continue;
    }
    const p = /^\$([a-z_][a-z0-9_]*)/.exec(rest);
    if (p) {
      toks.push({ k: "param", v: p[1] ?? "" });
      i += p[0].length;
      continue;
    }
    const n = /^\d+(?:\.\d+)?/.exec(rest);
    if (n) {
      const after = rest.slice(n[0].length);
      const unit = /^([smhd])(?![A-Za-z0-9_])/.exec(after);
      if (unit && !n[0].includes(".")) {
        toks.push({ k: "dur", ms: Number(n[0]) * (UNIT_MS[unit[1] ?? "s"] ?? 1000) });
        i += n[0].length + 1;
      } else {
        toks.push({ k: "num", v: Number(n[0]), float: n[0].includes(".") });
        i += n[0].length;
      }
      continue;
    }
    const s = /^'([^']*)'/.exec(rest);
    if (s) {
      toks.push({ k: "str", v: s[1] ?? "" });
      i += s[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?/.exec(rest);
    if (id) {
      toks.push({ k: "id", v: id[0] });
      i += id[0].length;
      continue;
    }
    const op = /^(<=|>=|!=|=|<|>|\+|-|\*|\/|\(|\)|,)/.exec(rest);
    if (op) {
      toks.push({ k: "op", v: op[0] });
      i += op[0].length;
      continue;
    }
    return Either.left({ message: `unexpected character '${rest[0]}' at offset ${i}` });
  }
  return Either.right(toks);
};

const BIN_PREC: Record<string, number> = {
  or: 1,
  and: 2,
  "=": 4,
  "!=": 4,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
};
export const FUNC_NAMES = ["now", "coalesce", "abs", "ms", "round", "date_trunc", "bucket"] as const;
const FUNCS = new Set<string>(FUNC_NAMES);

class ParseFail {
  constructor(readonly message: string) {}
}

/** Parse an expression. The internal parser signals failure with a value that is caught at this boundary. */
export const parseExpr = (src: string): Either.Either<Expr, ExprError> => {
  const lexed = tokenize(src);
  if (Either.isLeft(lexed)) return Either.left(lexed.left);
  const toks = lexed.right;
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  const result = ((): Expr | ParseFail => {
    const primary = (): Expr | ParseFail => {
      const t = next();
      if (!t) return new ParseFail("unexpected end of expression");
      switch (t.k) {
        case "num":
          return { t: "lit", ty: t.float ? "float" : "int", v: t.v };
        case "dur":
          return { t: "lit", ty: "duration", v: t.ms };
        case "str":
          return { t: "lit", ty: ISO_TS.test(t.v) ? "timestamp" : "string", v: t.v };
        case "param":
          return { t: "param", name: t.v };
        case "op": {
          if (t.v === "(") {
            const e = expr(1);
            if (e instanceof ParseFail) return e;
            const close = next();
            return close && close.k === "op" && close.v === ")" ? e : new ParseFail("expected ')'");
          }
          if (t.v === "-") {
            const e = expr(7);
            return e instanceof ParseFail ? e : { t: "un", op: "-", e };
          }
          return new ParseFail(`unexpected '${t.v}'`);
        }
        case "id": {
          if (t.v === "true" || t.v === "false") return { t: "lit", ty: "bool", v: t.v === "true" };
          if (t.v === "null") return { t: "lit", ty: "null", v: null };
          if (t.v === "not") {
            const e = expr(3);
            return e instanceof ParseFail ? e : { t: "un", op: "not", e };
          }
          const nx = peek();
          if (nx && nx.k === "op" && nx.v === "(") {
            if (!FUNCS.has(t.v)) return new ParseFail(`unknown function '${t.v}'`);
            next();
            const args: Expr[] = [];
            const close = peek();
            if (close && close.k === "op" && close.v === ")") next();
            else
              for (;;) {
                const a = expr(1);
                if (a instanceof ParseFail) return a;
                args.push(a);
                const sep = next();
                if (sep && sep.k === "op" && sep.v === ",") continue;
                if (sep && sep.k === "op" && sep.v === ")") break;
                return new ParseFail("expected ',' or ')'");
              }
            return { t: "call", fn: t.v, args };
          }
          return { t: "field", name: t.v };
        }
      }
    };
    const expr = (minPrec: number): Expr | ParseFail => {
      let left = primary();
      if (left instanceof ParseFail) return left;
      for (;;) {
        const t = peek();
        if (!t) break;
        const op = t.k === "op" ? t.v : t.k === "id" && (t.v === "and" || t.v === "or") ? t.v : undefined;
        const prec = op === undefined ? undefined : BIN_PREC[op];
        if (op === undefined || prec === undefined || prec < minPrec) break;
        next();
        const right = expr(prec + 1);
        if (right instanceof ParseFail) return right;
        left = { t: "bin", op, l: left, r: right };
      }
      return left;
    };
    const e = expr(1);
    if (e instanceof ParseFail) return e;
    return pos < toks.length ? new ParseFail("unexpected trailing input") : e;
  })();
  return result instanceof ParseFail ? Either.left({ message: result.message }) : Either.right(result);
};
