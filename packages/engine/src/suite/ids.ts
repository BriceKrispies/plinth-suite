import { randomUUID } from "node:crypto";
import { uuidv5 } from "@plinth/core";

/**
 * Identity of new rows (transactions, lots, notifications, deliveries, approvals). Random in production; the Suite seed
 * swaps in a counter-based generator so that two resets produce identical ids, and therefore identical domain
 * payloads and ledger (CONTRACT.md 11.1, AC-SEED). The generator is process-global: only the seed (single-threaded,
 * one command at a time) installs one.
 */
let generator: (() => string) | undefined;

export const newId = (): string => (generator ? generator() : randomUUID());

/** Install a deterministic generator for the duration of `f`'s synchronous setup, and remove it with the returned function. */
export const useDeterministicIds = (seed: number): (() => void) => {
  let n = 0;
  generator = () => uuidv5("6f0a7d2e-5b1c-4c1e-9d3a-7c2f4a1b8e90", `suite-seed|${seed}|${++n}`);
  return () => {
    generator = undefined;
  };
};
