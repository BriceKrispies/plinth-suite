import { Effect } from "effect";
import { SUITE_EXAMPLES, type CondTree } from "@plinth/spec";
import type { SeedStep } from "../seed";

/**
 * Seed step `segments` (CONTRACT.md 11.2, 12.5): the 6 Segment nodes, owned by the engagement marketing lead. Membership
 * is computed live from member facts, so the segments need no history of their own; promotions, content and automations
 * that name them are seeded after this step.
 */
const SEGMENTS: ReadonlyArray<{
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly rule: CondTree;
}> = [
  {
    slug: "emea-gold-plus",
    title: SUITE_EXAMPLES.Segment.metadata.title,
    description: SUITE_EXAMPLES.Segment.spec.description,
    rule: SUITE_EXAMPLES.Segment.spec.rule,
  },
  {
    slug: "new-joiners",
    title: "New joiners",
    description: "Members who joined in the last 120 days.",
    rule: { field: "joined_days", op: "lte", value: 120 },
  },
  {
    slug: "high-balance",
    title: "High balance",
    description: "Members sitting on 15 000 points or more.",
    rule: { field: "balance", op: "gte", value: 15000 },
  },
  {
    slug: "at-risk",
    title: "At risk",
    description: "Members with no activity for two weeks or more.",
    rule: { field: "last_active_days", op: "gte", value: 14 },
  },
  {
    slug: "fulfilment-floor",
    title: "Fulfilment floor",
    description: "Everyone working in the fulfilment department.",
    rule: { field: "department", op: "eq", value: "fulfilment" },
  },
  {
    slug: "big-spenders",
    title: "Big spenders",
    description: "Members who redeemed 5 000 points or more in the last 30 days.",
    rule: { field: "points_redeemed_30d", op: "gte", value: 5000 },
  },
];

export const segmentsStep: SeedStep = {
  name: "segments",
  spec: "11.2, 12.5",
  run: (ctx) =>
    ctx
      .commitNodes(
        SEGMENTS.map((s) =>
          ctx.create("Segment", s.slug, {
            apiVersion: "plinth/v1",
            kind: "Segment",
            metadata: { slug: s.slug, title: s.title },
            spec: { description: s.description, rule: s.rule, owner: "user:marketing-lead" },
          }),
        ),
        "seed: segments",
      )
      .pipe(Effect.asVoid),
};
