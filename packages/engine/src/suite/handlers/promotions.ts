import { Effect } from "effect";
import { evalCond, evaluatePromotions } from "@plinth/core";
import {
  DomainError,
  type MemberFacts,
  type NodeChange,
  type PromoCandidate,
  type PromotionSpec,
  type PromotionStatus,
  type SegmentSpec,
  PROMOTION_STATUSES,
  SuitePromotions,
} from "@plinth/spec";
import { ControlStore, store } from "../../control-store";
import { emitFrom } from "../domain-events";
import { memberFactsFor } from "../segments";
import { requireTarget } from "../target";
import {
  DAY_MS,
  dom,
  iso,
  loadNodes,
  nodeLinkOf,
  nodeUriOf,
  refSlug,
  requireNode,
} from "../marketing/common";
import {
  buildCandidates,
  effectSummary,
  eligibilitySummary,
  loadPromotions,
  loadUsage,
  withTitles,
} from "../marketing/promotions-core";
import { promotionQualifies } from "@plinth/core";
import { announceHeldChange, commitNodeChange } from "../marketing/commit";
import type { ActionHandler, ActionCtx } from "../types";
import type { HandlerTable } from "./stub";

type In<K extends keyof typeof SuitePromotions> = (typeof SuitePromotions)[K] extends { Type: infer T }
  ? T
  : never;

/** Transitions a person (or the agent) may request (CONTRACT.md 8.1). The scheduler moves the rest. */
const ALLOWED: Readonly<Record<PromotionStatus, ReadonlyArray<PromotionStatus>>> = {
  draft: ["scheduled", "active"],
  scheduled: ["draft", "paused", "ended"],
  active: ["paused", "ended"],
  paused: ["active", "ended"],
  ended: [],
};

const invalid = (from: string, to: string, why: string, allowed: ReadonlyArray<string>) =>
  dom("CONFLICT", "/to", `cannot move a ${from} promotion to ${to}: ${why}`, {
    details: { reason: "INVALID_TRANSITION", from, to, allowed: [...allowed] },
    fix_hint: allowed.length > 0 ? `Allowed from ${from}: ${allowed.join(", ")}.` : `${from} is terminal.`,
  });

/** Validate a requested transition against the status table and the window (2.3, 8.1). */
const checkTransition = (spec: PromotionSpec, to: PromotionStatus, now: Date): DomainError | undefined => {
  const from = spec.status;
  const allowed = ALLOWED[from];
  if (!allowed.includes(to)) return invalid(from, to, "the state machine does not allow it", allowed);
  const starts = Date.parse(spec.schedule.starts_at);
  const ends = Date.parse(spec.schedule.ends_at);
  const t = now.getTime();
  if (from === "draft" && to === "scheduled" && !(starts > t && ends > t))
    return invalid(from, to, "scheduling needs starts_at in the future (use active to start now)", allowed);
  if (from === "draft" && to === "active" && !(starts <= t && t < ends))
    return invalid(
      from,
      to,
      "activating needs now inside the window (use scheduled for a future start)",
      allowed,
    );
  if (from === "paused" && to === "active" && !(t < ends))
    return invalid(from, to, "the window has already ended", allowed);
  return undefined;
};

// ---- list ------------------------------------------------------------------------------------------------------

const list: ActionHandler<In<"PromotionsListIn">, In<"PromotionsListOut">> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const wsSlug = ctx.principal.workspaceSlug;
      const nodes = yield* loadPromotions(ws);
      const usage = yield* loadUsage(ws);
      const pend = yield* store(
        sql<{ approval_id: string; targets: string[] }>`
          SELECT approval_id, ARRAY(SELECT c ->> 'target' FROM jsonb_array_elements(payload -> 'changes') c) AS targets
          FROM change_approvals WHERE workspace_id = ${ws} AND status = 'pending_approval' ORDER BY created_at`,
      );
      const want = input.status ? new Set<string>(input.status) : undefined;
      const counts = Object.fromEntries(PROMOTION_STATUSES.map((s) => [s, 0])) as Record<
        PromotionStatus,
        number
      >;
      const items: Array<In<"PromotionsListOut">["items"][number]> = [];
      for (const n of nodes) {
        counts[n.spec.status] += 1;
        if (want && !want.has(n.spec.status)) continue;
        const uri = nodeUriOf(wsSlug, ws, "Promotion", n.slug);
        const u = usage.get(n.id);
        const max = n.spec.budget.max_cost_points;
        items.push({
          node: nodeLinkOf(wsSlug, ws, "Promotion", n),
          status: n.spec.status,
          description: n.spec.description,
          starts_at: n.spec.schedule.starts_at,
          ends_at: n.spec.schedule.ends_at,
          priority: n.spec.priority,
          stacking: n.spec.stacking,
          effect_summary: effectSummary(n.spec),
          eligibility_summary: eligibilitySummary(n.spec),
          owner: n.spec.owner,
          usage: {
            redemptions: u?.redemptions ?? 0,
            cost_points: u?.cost_points ?? 0,
            budget_used_pct: max !== undefined ? Math.round(((u?.cost_points ?? 0) * 1000) / max) / 10 : null,
            members_reached: u?.members_reached ?? 0,
          },
          pending_approval_id: pend.find((p) => p.targets.includes(uri))?.approval_id ?? null,
        });
      }
      items.sort((a, b) => b.priority - a.priority || (a.node.slug < b.node.slug ? -1 : 1));
      return { items, status_counts: counts };
    }),
};

// ---- active for me ---------------------------------------------------------------------------------------------

const active: ActionHandler<unknown, In<"ActiveForMeOut">> = {
  run: (_input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const memberId = ctx.onBehalfOf?.id ?? ctx.principal.id;
      const facts = (yield* memberFactsFor(ws, ctx.now, [memberId]))[0]?.facts;
      if (!facts) return { items: [] };
      const promos = (yield* loadPromotions(ws)).filter((p) => p.spec.status === "active");
      const cands = yield* buildCandidates(ws, promos, { id: memberId, facts }, ctx.now);
      const items: Array<In<"ActiveForMeOut">["items"][number]> = [];
      for (const c of cands) {
        if (!promotionQualifies(c, facts, ctx.now)) continue;
        const node = promos.find((p) => p.slug === c.slug)!;
        items.push({
          slug: node.slug,
          title: node.title,
          description: node.spec.description,
          headline: node.spec.banner?.headline ?? null,
          tone: node.spec.banner?.tone ?? null,
          icon: node.spec.banner?.icon ?? null,
          ends_at: node.spec.schedule.ends_at,
          effect_summary: effectSummary(node.spec),
          channels: [
            ...(node.spec.eligibility.channels ?? ["store", "recognition", "automation", "content"]),
          ],
        });
      }
      items.sort((a, b) => (a.ends_at < b.ends_at ? -1 : a.ends_at > b.ends_at ? 1 : 0));
      return { items };
    }),
};

// ---- simulate --------------------------------------------------------------------------------------------------

const simulate: ActionHandler<In<"SimulateIn">, In<"SimulateOut">> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const at = input.at ? new Date(input.at) : ctx.now;
      const m = yield* store(
        sql<{ member_id: string; handle: string; region: string; department: string; tier: string | null }>`
          SELECT m.member_id, m.handle, m.region, m.department, a.tier FROM members m
          LEFT JOIN ledger_accounts a ON a.member_id = m.member_id
          WHERE m.workspace_id = ${ws} AND m.handle = ${input.member}`,
      );
      const row = m[0];
      if (!row) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/member", `no member '${input.member}'`));
      yield* requireTarget(ctx, {
        handle: row.handle,
        region: row.region,
        tier: row.tier ?? "bronze",
        department: row.department,
      });
      const facts = (yield* memberFactsFor(ws, at, [row.member_id]))[0]!.facts;
      const member = { id: row.member_id, facts };

      let target: { slug: string; revision: number; spec: PromotionSpec; id?: string; title: string };
      if (typeof input.promotion === "string") {
        const n = yield* requireNode<PromotionSpec>(ws, "Promotion", refSlug(input.promotion));
        target = { slug: n.slug, revision: n.revision, spec: n.spec, id: n.id, title: n.title };
      } else {
        target = {
          slug: input.promotion.slug,
          revision: 0,
          spec: input.promotion.spec,
          title: input.promotion.title,
        };
      }
      const live =
        input.include_live === true
          ? (yield* loadPromotions(ws)).filter((p) => p.spec.status === "active" && p.slug !== target.slug)
          : [];
      const specs = [target, ...live];
      const candidates = yield* buildCandidates(ws, specs, member, at);
      // an unsaved promotion has no usage
      const cands: PromoCandidate[] = candidates.map((c) =>
        c.slug === target.slug && target.id === undefined
          ? { ...c, usage: { cost_points: 0, redemptions: 0, member_redemptions: 0 } }
          : c,
      );
      const titles = new Map(specs.map((s) => [s.slug, s.title] as const));
      const run = (list: PromoCandidate[]) =>
        withTitles(
          evaluatePromotions({
            now: iso(at),
            mode: "simulate",
            member: facts,
            context: input.context,
            candidates: list,
          }),
          titles,
        );
      return {
        member: { handle: row.handle, tier: facts.tier, region: facts.region },
        at: iso(at),
        evaluation: run(cands),
        baseline: run([]),
      };
    }),
};

// ---- transition ------------------------------------------------------------------------------------------------

const transitionPreview = (input: In<"PromotionTransitionIn">, ctx: ActionCtx) =>
  Effect.gen(function* () {
    const n = yield* requireNode<PromotionSpec>(ctx.principal.workspaceId, "Promotion", input.slug);
    const bad = checkTransition(n.spec, input.to, ctx.now);
    if (bad) return yield* Effect.fail(bad);
    const held = n.spec.status === "draft" && (input.to === "scheduled" || input.to === "active");
    return {
      effect: `Move promotion ${n.slug} from ${n.spec.status} to ${input.to}${held ? " (R-PROMO-ACTIVATE: the change is held for approval by promotions:approve)" : ""}`,
      facts: {
        promotion: n.slug,
        from: n.spec.status,
        to: input.to,
        revision: n.revision,
        held_for_approval: held,
      },
      // the hold is the change log's (a `change` approval), not the dispatcher's action approval: the commit itself
      // returns `pending_approval`, so the decision stays auto
      decision: "auto" as const,
    };
  });

const transition: ActionHandler<In<"PromotionTransitionIn">, unknown> = {
  preview: transitionPreview,
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const wsSlug = ctx.principal.workspaceSlug;
      const n = yield* requireNode<PromotionSpec>(ws, "Promotion", input.slug);
      const bad = checkTransition(n.spec, input.to, ctx.now);
      if (bad) return yield* Effect.fail(bad);
      const change: NodeChange = {
        target: nodeUriOf(wsSlug, ws, "Promotion", n.slug),
        base_revision: input.base_revision,
        ops: [{ op: "set", path: "/spec/status", value: input.to }],
      };
      const res = yield* commitNodeChange(ctx, change, {
        reason: input.reason,
        managedBy: "promotions.transition",
      });
      const revision = res.revision;
      if (res.status === "pending_approval") {
        yield* announceHeldChange(ctx, {
          approvalId: res.approval_id!,
          title: `Move promotion ${n.title} from ${n.spec.status} to ${input.to}`,
          approverPermission: "promotions:approve",
        });
      } else {
        yield* emitFrom(ctx, "promotion.state_changed", {
          audience: ["*"],
          subject: { kind: "promotion", id: n.slug },
          payload: {
            promotion: n.slug,
            title: n.title,
            from: n.spec.status,
            to: input.to,
            revision: revision ?? n.revision + 1,
          },
        });
      }
      return {
        status: res.status,
        ...(res.approval_id !== undefined ? { approval_id: res.approval_id } : {}),
        ...(res.change_seq !== undefined ? { change_seq: res.change_seq } : {}),
        ...(revision !== undefined ? { revision } : {}),
        rule_id: res.rule_id,
      };
    }),
};

// ---- analytics -------------------------------------------------------------------------------------------------

/** Member-level eligibility that needs no cart: tier, region, segment, group, newness and the filter. */
const staticEligible = (
  spec: PromotionSpec,
  f: MemberFacts,
  segs: ReadonlyArray<{ slug: string; spec: SegmentSpec }>,
): boolean => {
  const el = spec.eligibility;
  if (el.tiers && !el.tiers.includes(f.tier)) return false;
  if (el.regions && !el.regions.includes(f.region)) return false;
  if (
    el.segments &&
    !el.segments.some((r) => {
      const s = segs.find((x) => x.slug === refSlug(r));
      return s ? evalCond(s.spec.rule, f as unknown as Record<string, unknown>) : false;
    })
  )
    return false;
  if (el.groups && !el.groups.some((g) => f.groups.includes(refSlug(g)))) return false;
  if (el.new_members_days !== undefined && f.joined_days > el.new_members_days) return false;
  if (el.filter && !evalCond(el.filter, { ...(f as unknown as Record<string, unknown>), member: f }))
    return false;
  return true;
};

const analytics: ActionHandler<In<"AnalyticsIn">, In<"AnalyticsOut">> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const n = yield* requireNode<PromotionSpec>(ws, "Promotion", input.slug);
      const bucket = input.bucket ?? "day";
      const usage = (yield* loadUsage(ws)).get(n.id);
      const max = n.spec.budget.max_cost_points;
      const ben = yield* store(
        sql<{ b: string }>`
          SELECT coalesce(sum(benefit_points), 0)::text AS b FROM promotion_redemptions
          WHERE workspace_id = ${ws} AND promotion_id = ${n.id} AND reversed_at IS NULL`,
      );
      const series = yield* store(
        sql.unsafe<{ b: string; r: string; c: string }>(
          `SELECT to_char(date_trunc('${bucket === "hour" ? "hour" : "day"}', occurred_at AT TIME ZONE 'UTC'),
                          'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS b,
                  count(DISTINCT ref_kind || ':' || ref_id)::text AS r, coalesce(sum(cost_points), 0)::text AS c
           FROM promotion_redemptions WHERE workspace_id = $1 AND promotion_id = $2 AND reversed_at IS NULL
           GROUP BY 1 ORDER BY 1`,
          [ws, n.id],
        ),
      );
      const byTier = yield* store(
        sql<{ k: string; r: string; c: string }>`
          SELECT coalesce(a.tier, 'bronze') AS k, count(DISTINCT p.ref_kind || ':' || p.ref_id)::text AS r,
                 coalesce(sum(p.cost_points), 0)::text AS c
          FROM promotion_redemptions p LEFT JOIN ledger_accounts a ON a.member_id = p.member_id
          WHERE p.workspace_id = ${ws} AND p.promotion_id = ${n.id} AND p.reversed_at IS NULL GROUP BY 1`,
      );
      const byRegion = yield* store(
        sql<{ k: string; r: string; c: string }>`
          SELECT m.region AS k, count(DISTINCT p.ref_kind || ':' || p.ref_id)::text AS r,
                 coalesce(sum(p.cost_points), 0)::text AS c
          FROM promotion_redemptions p JOIN members m ON m.member_id = p.member_id
          WHERE p.workspace_id = ${ws} AND p.promotion_id = ${n.id} AND p.reversed_at IS NULL GROUP BY 1`,
      );

      // uplift: store orders per eligible member-day, during versus an equal window before starts_at
      let uplift: In<"AnalyticsOut">["uplift"] = null;
      const starts = Date.parse(n.spec.schedule.starts_at);
      const endCap = Math.min(ctx.now.getTime(), Date.parse(n.spec.schedule.ends_at));
      const elapsed = (endCap - starts) / DAY_MS;
      if (
        (n.spec.status === "active" || n.spec.status === "paused" || n.spec.status === "ended") &&
        elapsed >= 1
      ) {
        const facts = yield* memberFactsFor(ws, ctx.now);
        const segs = yield* loadNodes<SegmentSpec>(ws, "Segment");
        const eligible = facts.filter(
          (m) => m.facts.status === "active" && staticEligible(n.spec, m.facts, segs),
        );
        const ids = eligible.map((m) => m.memberId);
        const windowDays = Math.round(elapsed * 100) / 100;
        const count = (from: number, to: number) =>
          ids.length === 0
            ? Effect.succeed(0)
            : store(
                sql<{ n: string }>`
                  SELECT count(*)::text AS n FROM store_orders
                  WHERE workspace_id = ${ws} AND member_id IN ${sql.in(ids)} AND status <> 'cancelled'
                    AND placed_at >= ${new Date(from).toISOString()}::timestamptz
                    AND placed_at < ${new Date(to).toISOString()}::timestamptz`,
              ).pipe(Effect.map((r) => Number(r[0]?.n ?? 0)));
        const during = yield* count(starts, endCap);
        const before = yield* count(starts - (endCap - starts), starts);
        const denom = Math.max(1, ids.length) * Math.max(windowDays, 0.01);
        const rateDuring = during / denom;
        const rateBefore = before / denom;
        uplift = {
          eligible_members: ids.length,
          window_days: windowDays,
          rate_before: Math.round(rateBefore * 10000) / 10000,
          rate_during: Math.round(rateDuring * 10000) / 10000,
          uplift_pct:
            rateBefore > 0
              ? Math.round(((rateDuring - rateBefore) / rateBefore) * 10000) / 100
              : rateDuring > 0
                ? 100
                : 0,
        };
      }
      const tally = (rows: ReadonlyArray<{ k: string; r: string; c: string }>) =>
        Object.fromEntries(rows.map((r) => [r.k, { redemptions: Number(r.r), cost_points: Number(r.c) }]));
      return {
        slug: n.slug,
        status: n.spec.status,
        usage: {
          redemptions: usage?.redemptions ?? 0,
          cost_points: usage?.cost_points ?? 0,
          budget_used_pct:
            max !== undefined ? Math.round(((usage?.cost_points ?? 0) * 1000) / max) / 10 : null,
          members_reached: usage?.members_reached ?? 0,
        },
        benefit_points: Number(ben[0]?.b ?? 0),
        series: series.map((r) => ({ bucket: r.b, redemptions: Number(r.r), cost_points: Number(r.c) })),
        by_tier: tally(byTier),
        by_region: tally(byRegion),
        uplift,
      };
    }),
};

export const promotionsHandlers = {
  "promotions.list": list,
  "promotions.active": active,
  "promotions.simulate": simulate,
  "promotions.transition": transition,
  "promotions.analytics": analytics,
} satisfies HandlerTable;
