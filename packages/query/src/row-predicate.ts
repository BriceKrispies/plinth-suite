import { Either } from "effect";
import { parseExpr, type Expr } from "./expr";

/**
 * Evaluate a grant's row predicate against the facts of one target member (CONTRACT.md 3.2, K9). The grammar is the
 * kernel expression grammar restricted to `=`, `!=`, `and`, `or`, `not` and literals; anything else is false (a
 * predicate that cannot be evaluated never widens access). Pure and total.
 */
export const evalRowPredicate = (
  predicate: string | null,
  facts: Readonly<Record<string, string | number | boolean | null>>,
): boolean => {
  if (predicate === null || predicate.trim() === "") return true;
  const parsed = parseExpr(predicate);
  if (Either.isLeft(parsed)) return false;
  const go = (e: Expr): string | number | boolean | null | undefined => {
    switch (e.t) {
      case "lit":
        return e.v;
      case "field":
        return facts[e.name] ?? null;
      case "un":
        return e.op === "not" ? go(e.e) !== true : undefined;
      case "bin": {
        if (e.op === "and") return go(e.l) === true && go(e.r) === true;
        if (e.op === "or") return go(e.l) === true || go(e.r) === true;
        if (e.op === "=") return go(e.l) === go(e.r);
        if (e.op === "!=") return go(e.l) !== go(e.r);
        return undefined;
      }
      default:
        return undefined;
    }
  };
  return go(parsed.right) === true;
};
