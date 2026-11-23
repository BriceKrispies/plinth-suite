import { Effect } from "effect";
import { DomainError } from "@plinth/spec";
import type { ActionHandler } from "../types";

/** Every handler table is a record of action name to handler. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HandlerTable = Record<string, ActionHandler<any, any>>;

/**
 * The placeholder every action starts with. The kernel error enum is closed (ruling 9), so "no handler yet" is
 * `UNKNOWN_REFERENCE` with `details.reason = "NOT_IMPLEMENTED"` (HTTP 404).
 */
export const notImplemented = <I, O>(name: string): ActionHandler<I, O> => ({
  run: () =>
    Effect.fail(
      new DomainError({
        code: "UNKNOWN_REFERENCE",
        path: "/action",
        message: `action '${name}' has no handler yet`,
        details: { reason: "NOT_IMPLEMENTED", action: name },
        retryable: false,
        fix_hint: "This action is registered but its domain handler has not landed. Do not retry.",
      }),
    ),
});

/** True for the placeholder's refusal (tests and the dispatcher's coverage report). */
export const isNotImplemented = (e: unknown): boolean =>
  e instanceof DomainError && e.details?.["reason"] === "NOT_IMPLEMENTED";
