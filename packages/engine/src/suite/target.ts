import { Effect } from "effect";
import { evalRowPredicate } from "@plinth/query";
import { DomainError } from "@plinth/spec";
import type { ActionCtx } from "./types";

/** The facts a Suite row predicate sees (CONTRACT.md 3.2): the target member's handle, region, tier and department. */
export interface TargetFacts {
  readonly handle: string;
  readonly region: string;
  readonly tier: string;
  readonly department: string;
}

/** Does the caller's grant reach this member? (`region = 'EMEA'` scopes a regional manager.) */
export const mayTarget = (ctx: Pick<ActionCtx, "allow">, facts: TargetFacts): boolean =>
  evalRowPredicate(ctx.allow?.rowPredicate ?? null, { ...facts });

/**
 * Actions that target a member (award, view another statement, orders of a member, approve an order) call this with the
 * member's facts. A miss is `FORBIDDEN` with `details.reason = "row_predicate"` and never reveals whether the member
 * exists outside the caller's scope (CONTRACT.md 1.2).
 */
export const requireTarget = (
  ctx: Pick<ActionCtx, "allow">,
  facts: TargetFacts,
): Effect.Effect<void, DomainError> =>
  mayTarget(ctx, facts)
    ? Effect.void
    : Effect.fail(
        new DomainError({
          code: "FORBIDDEN",
          path: "",
          message: "this member is outside the scope of your grant",
          details: { reason: "row_predicate" },
          retryable: false,
          fix_hint: "Do not retry. Report the missing scope to a person.",
        }),
      );
