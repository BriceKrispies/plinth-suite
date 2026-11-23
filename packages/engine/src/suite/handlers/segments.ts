import { Effect } from "effect";
import { evalCond } from "@plinth/core";
import {
  REGIONS,
  TIERS,
  type CondTree,
  type ContentSpec,
  type PromotionSpec,
  type SegmentSpec,
  SuitePeople,
} from "@plinth/spec";
import { memberFactsFor, type MemberWithFacts } from "../segments";
import { mayTarget } from "../target";
import {
  decodeCursor,
  dom,
  encodeCursor,
  loadNodes,
  memberCardsFor,
  nodeLinkOf,
  refSlug,
  requireNode,
  type SuiteNode,
} from "../marketing/common";
import type { ActionCtx, ActionHandler } from "../types";
import type { HandlerTable } from "./stub";

type In<K extends keyof typeof SuitePeople> = (typeof SuitePeople)[K] extends { Type: infer T } ? T : never;

/** Active members the caller's grant reaches (a regional manager sees only their region). */
const scoped = (ctx: ActionCtx, all: ReadonlyArray<MemberWithFacts>): ReadonlyArray<MemberWithFacts> =>
  all.filter(
    (m) =>
      m.facts.status === "active" &&
      mayTarget(ctx, {
        handle: m.facts.handle,
        region: m.facts.region,
        tier: m.facts.tier,
        department: m.facts.department,
      }),
  );

const matching = (rule: CondTree, members: ReadonlyArray<MemberWithFacts>): ReadonlyArray<MemberWithFacts> =>
  members.filter((m) => evalCond(rule, m.facts as unknown as Record<string, unknown>));

/** Promotions and content that name a segment. */
const usersOf = (
  slug: string,
  promos: ReadonlyArray<SuiteNode<PromotionSpec>>,
  content: ReadonlyArray<SuiteNode<ContentSpec>>,
): ReadonlyArray<{ kind: "Promotion" | "Content"; node: SuiteNode }> => [
  ...promos
    .filter((p) => (p.spec.eligibility.segments ?? []).some((r) => refSlug(r) === slug))
    .map((node) => ({ kind: "Promotion" as const, node: node as SuiteNode })),
  ...content
    .filter((c) => (c.spec.audience.segments ?? []).some((r) => refSlug(r) === slug))
    .map((node) => ({ kind: "Content" as const, node: node as SuiteNode })),
];

const list: ActionHandler<unknown, In<"SegmentsListOut">> = {
  run: (_input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const segs = yield* loadNodes<SegmentSpec>(ws, "Segment");
      const promos = yield* loadNodes<PromotionSpec>(ws, "Promotion");
      const content = yield* loadNodes<ContentSpec>(ws, "Content");
      const members = scoped(ctx, yield* memberFactsFor(ws, ctx.now));
      return {
        items: segs.map((s) => ({
          node: nodeLinkOf(ctx.principal.workspaceSlug, ws, "Segment", s),
          description: s.spec.description,
          count: matching(s.spec.rule, members).length,
          owner: s.spec.owner,
          used_by: usersOf(s.slug, promos, content).length,
        })),
      };
    }),
};

const preview: ActionHandler<In<"SegmentPreviewIn">, In<"SegmentPreviewOut">> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const wsSlug = ctx.principal.workspaceSlug;
      if ((input.rule === undefined) === (input.segment === undefined))
        return yield* Effect.fail(
          dom("VALIDATION_FAILED", "", "give exactly one of rule or segment", {
            expected: "rule or segment",
            fix_hint: "Pass the condition tree as rule, or segment:<slug> to evaluate a saved segment.",
          }),
        );
      let rule: CondTree;
      let usedBy: ReadonlyArray<{ kind: "Promotion" | "Content"; node: SuiteNode }> = [];
      if (input.segment !== undefined) {
        const slug = refSlug(input.segment);
        const n = yield* requireNode<SegmentSpec>(ws, "Segment", slug);
        rule = n.spec.rule;
        usedBy = usersOf(
          slug,
          yield* loadNodes<PromotionSpec>(ws, "Promotion"),
          yield* loadNodes<ContentSpec>(ws, "Content"),
        );
      } else rule = input.rule!;
      const members = scoped(ctx, yield* memberFactsFor(ws, ctx.now));
      const hit = matching(rule, members);
      const byTier = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<(typeof TIERS)[number], number>;
      const byRegion = Object.fromEntries(REGIONS.map((r) => [r, 0])) as Record<
        (typeof REGIONS)[number],
        number
      >;
      for (const m of hit) {
        byTier[m.facts.tier] += 1;
        byRegion[m.facts.region] += 1;
      }
      const n = input.sample ?? 5;
      const sample = yield* memberCardsFor(
        ws,
        hit.slice(0, n).map((m) => m.memberId),
      );
      return {
        count: hit.length,
        total_members: members.length,
        sample: [...sample],
        by_tier: byTier,
        by_region: byRegion,
        used_by: usedBy.map((u) => nodeLinkOf(wsSlug, ws, u.kind, u.node)),
      };
    }),
};

const membersOf: ActionHandler<In<"SegmentMembersIn">, In<"SegmentMembersOut">> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const n = yield* requireNode<SegmentSpec>(ws, "Segment", input.slug);
      const members = scoped(ctx, yield* memberFactsFor(ws, ctx.now));
      const hit = [...matching(n.spec.rule, members)].sort((a, b) =>
        a.facts.handle < b.facts.handle ? -1 : a.facts.handle > b.facts.handle ? 1 : 0,
      );
      const after = decodeCursor<{ h: string }>(input.cursor)?.h;
      const limit = input.limit ?? 50;
      const rest = after === undefined ? hit : hit.filter((m) => m.facts.handle > after);
      const page = rest.slice(0, limit);
      const items = yield* memberCardsFor(
        ws,
        page.map((m) => m.memberId),
      );
      return {
        items: [...items],
        next_cursor: rest.length > limit ? encodeCursor({ h: page[page.length - 1]!.facts.handle }) : null,
        count: hit.length,
      };
    }),
};

export const segmentsHandlers = {
  "segments.list": list,
  "segments.preview": preview,
  "segments.members": membersOf,
} satisfies HandlerTable;
