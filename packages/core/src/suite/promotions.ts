import type {
  AppliedPromotion,
  PromoCandidate,
  PromoEvalInput,
  PromoEvaluation,
  PromotionEffect,
} from "@plinth/spec";
import { evalCond } from "../cond";

/**
 * `evaluatePromotions` (CONTRACT.md 8.3): pure, total, deterministic, integer arithmetic. The caller loads the
 * candidates with their usage counters and segment and group membership, and calls this. No I/O, no clock.
 */

type Rejection = PromoEvaluation["rejected"][number];
type Reason = Rejection["reason"];
type Ctx = PromoEvalInput["context"];
type Totals = PromoEvaluation["totals"];
const NO_SKIP: ReadonlySet<Reason> = new Set();
type AppliedEffect = AppliedPromotion["effects"][number];

const refSlug = (r: string): string => {
  const i = r.indexOf(":");
  return i >= 0 ? r.slice(i + 1) : r;
};

const clip = (s: string): string => (s.length > 200 ? s.slice(0, 200) : s);

/** The effects of a promotion that apply to this context kind. */
const effectsFor = (c: PromoCandidate, kind: Ctx["kind"]): ReadonlyArray<PromotionEffect> =>
  c.spec.effects.filter((e) => {
    switch (e.type) {
      case "store_discount":
      case "free_item":
        return kind === "purchase";
      case "points_multiplier":
        return kind === "earn";
      case "bonus_points":
        return e.on === kind;
    }
  });

const isoDow = (d: Date): number => (d.getUTCDay() === 0 ? 7 : d.getUTCDay());

const subtotalOf = (ctx: Ctx): number =>
  ctx.kind === "purchase" ? ctx.lines.reduce((a, l) => a + l.qty * l.unit_points, 0) : 0;

/** The first failing check of CONTRACT.md 8.3 step 1, or undefined when the candidate is eligible. */
const firstFailure = (
  c: PromoCandidate,
  input: PromoEvalInput,
  now: Date,
  skip: ReadonlySet<Reason> = NO_SKIP,
): { readonly reason: Reason; readonly detail: string } | undefined => {
  const { spec } = c;
  const el = spec.eligibility;
  const m = input.member;
  const ctx = input.context;
  const fail = (reason: Reason, detail: string) => ({ reason, detail: clip(detail) });
  const on = (reason: Reason, cond: () => unknown): boolean => !skip.has(reason) && Boolean(cond());

  if (on("status", () => (input.mode === "live" ? spec.status !== "active" : spec.status === "ended")))
    return fail("status", `promotion is ${spec.status}`);
  const t = now.getTime();
  const starts = Date.parse(spec.schedule.starts_at);
  const ends = Date.parse(spec.schedule.ends_at);
  if (on("window", () => t < starts || t >= ends)) return fail("window", "outside the promotion window");
  const dow = spec.schedule.days_of_week;
  if (on("window", () => dow && !dow.includes(isoDow(now))))
    return fail("window", "not a promotion day of the week");
  const hrs = spec.schedule.hours_utc;
  if (on("window", () => hrs !== undefined && !(now.getUTCHours() >= hrs.from && now.getUTCHours() < hrs.to)))
    return fail("window", "outside the promotion hours");
  if (on("channel", () => el.channels && !el.channels.includes(ctx.channel)))
    return fail("channel", `not offered on ${ctx.channel}`);
  if (on("context", () => effectsFor(c, ctx.kind).length === 0))
    return fail("context", `no effect applies to ${ctx.kind}`);
  if (on("tier", () => el.tiers && !el.tiers.includes(m.tier)))
    return fail("tier", `tier ${m.tier} is not eligible`);
  if (on("region", () => el.regions && !el.regions.includes(m.region)))
    return fail("region", `region ${m.region} is not eligible`);
  if (on("segment", () => el.segments && !el.segments.some((s) => c.member_in_segments[s] === true)))
    return fail("segment", "member is in none of the listed segments");
  if (on("group", () => el.groups && !el.groups.some((g) => c.member_in_groups[g] === true)))
    return fail("group", "member is in none of the listed groups");
  if (on("new_member", () => el.new_members_days !== undefined && m.joined_days > el.new_members_days))
    return fail("new_member", `member joined ${m.joined_days} days ago`);
  const facts = m as unknown as Record<string, unknown>;
  if (on("filter", () => el.filter !== undefined && !evalCond(el.filter, { ...facts, member: facts })))
    return fail("filter", "member fails the filter");
  if (on("entitlement", () => el.entitlement_only === true && !c.entitled))
    return fail("entitlement", "member holds no entitlement");
  if (on("min_cart", () => el.min_cart_points !== undefined && subtotalOf(ctx) < el.min_cart_points))
    return fail("min_cart", `cart is below ${el.min_cart_points} points`);
  const products = (el.products ?? []).map(refSlug);
  const cats = (el.categories ?? []).map(refSlug);
  if (
    on(
      "scope",
      () =>
        ctx.kind === "purchase" &&
        (el.products !== undefined || el.categories !== undefined) &&
        !ctx.lines.some((l) => products.includes(refSlug(l.product)) || cats.includes(refSlug(l.category))),
    )
  )
    return fail("scope", "no cart line is in scope");
  const b = spec.budget;
  if (
    on("per_member", () => b.max_per_member !== undefined && c.usage.member_redemptions >= b.max_per_member)
  )
    return fail("per_member", "member reached the per-member limit");
  if (on("budget", () => b.max_redemptions !== undefined && c.usage.redemptions >= b.max_redemptions))
    return fail("budget", "redemption budget is used up");
  if (on("budget", () => b.max_cost_points !== undefined && c.usage.cost_points >= b.max_cost_points))
    return fail("budget", "points budget is used up");
  return undefined;
};

interface Computed {
  readonly applied: ReadonlyArray<AppliedPromotion>;
  readonly noEffect: ReadonlyArray<{
    readonly slug: string;
    readonly reason: Reason;
    readonly detail: string;
  }>;
  readonly totals: Totals;
}

/** Steps 3 and 4: stacking, then effects. `ordered` is already sorted. */
const stackAndCompute = (
  ordered: ReadonlyArray<PromoCandidate>,
  input: PromoEvalInput,
  rejected: Rejection[],
): Computed => {
  const ctx = input.context;
  // step 3: stacking
  let selected: PromoCandidate[] = [];
  const first = ordered[0];
  if (first && first.spec.stacking === "exclusive") {
    selected = [first];
    for (const c of ordered.slice(1))
      rejected.push({ slug: c.slug, reason: "stacking", detail: `excluded by exclusive ${first.slug}` });
  } else {
    const groups = new Set<string>();
    for (const c of ordered) {
      if (c.spec.stacking === "exclusive") {
        rejected.push({ slug: c.slug, reason: "stacking", detail: "an exclusive promotion cannot stack" });
        continue;
      }
      const g = c.spec.stack_group;
      if (g !== undefined) {
        if (groups.has(g)) {
          rejected.push({
            slug: c.slug,
            reason: "stacking",
            detail: clip(`stack group ${g} already has a winner`),
          });
          continue;
        }
        groups.add(g);
      }
      selected.push(c);
    }
  }

  // step 4: effects
  const subtotal = subtotalOf(ctx);
  const effs = selected.map((c) => ({ c, list: effectsFor(c, ctx.kind) }));

  // the best multiplier applies once
  let bestMult: { slug: string; factor: number } | undefined;
  for (const { c, list } of effs)
    for (const e of list)
      if (e.type === "points_multiplier" && (bestMult === undefined || e.factor > bestMult.factor))
        bestMult = { slug: c.slug, factor: e.factor };

  // per-line best discount percent (the first effect wins a tie)
  type Disc = { slug: string; ei: number; percent: number };
  const lineBest: Array<Disc | undefined> = [];
  if (ctx.kind === "purchase") {
    ctx.lines.forEach((line, li) => {
      let best: Disc | undefined;
      for (const { c, list } of effs)
        list.forEach((e, ei) => {
          if (e.type !== "store_discount") return;
          const prods = e.products?.map(refSlug);
          const cats = e.categories?.map(refSlug);
          const covers =
            !prods && !cats
              ? true
              : (prods?.includes(refSlug(line.product)) ?? false) ||
                (cats?.includes(refSlug(line.category)) ?? false);
          if (covers && (best === undefined || e.percent > best.percent))
            best = { slug: c.slug, ei, percent: e.percent };
        });
      lineBest[li] = best;
    });
  }
  const capUsed = new Map<string, number>();

  const applied: AppliedPromotion[] = [];
  const noEffect: Array<{ slug: string; reason: Reason; detail: string }> = [];
  let discount = 0;
  let bonus = 0;
  let multBonus = 0;
  const freeItems: Array<{ product: string; unit_points: number }> = [];

  for (const { c, list } of effs) {
    const out: AppliedEffect[] = [];
    list.forEach((e, ei) => {
      switch (e.type) {
        case "points_multiplier": {
          if (ctx.kind !== "earn" || !bestMult || bestMult.slug !== c.slug || bestMult.factor !== e.factor)
            return;
          if (out.some((x) => x.type === "points_multiplier")) return;
          const b = Math.floor(ctx.base_points * (e.factor - 1));
          if (b <= 0) return;
          multBonus += b;
          out.push({ type: "points_multiplier", benefit_points: b, cost_points: b });
          return;
        }
        case "bonus_points": {
          out.push({ type: "bonus_points", benefit_points: e.points, cost_points: e.points });
          bonus += e.points;
          return;
        }
        case "store_discount": {
          if (ctx.kind !== "purchase") return;
          const lines: Array<{ line: number; points: number; product: string }> = [];
          let total = 0;
          ctx.lines.forEach((line, li) => {
            const w = lineBest[li];
            if (!w || w.slug !== c.slug || w.ei !== ei) return;
            let d = Math.floor((line.qty * line.unit_points * w.percent) / 100);
            if (e.max_discount_points !== undefined) {
              const key = `${c.slug}#${ei}`;
              const used = capUsed.get(key) ?? 0;
              d = Math.min(d, Math.max(0, e.max_discount_points - used));
              capUsed.set(key, used + d);
            }
            if (d > 0) {
              lines.push({ line: li, points: d, product: line.product });
              total += d;
            }
          });
          if (total > 0) {
            out.push({ type: "store_discount", benefit_points: total, cost_points: total, lines });
            discount += total;
          }
          return;
        }
        case "free_item": {
          if (ctx.kind !== "purchase") return;
          const slug = refSlug(e.product);
          const info = c.free_items[e.product] ?? c.free_items[slug];
          if (!info || !info.in_stock || subtotal < e.min_cart_points) return;
          out.push({
            type: "free_item",
            benefit_points: info.unit_points,
            cost_points: info.unit_points,
            lines: [{ line: -1, points: info.unit_points, product: slug }],
          });
          freeItems.push({ product: slug, unit_points: info.unit_points });
          return;
        }
      }
    });
    if (out.length === 0) {
      noEffect.push({
        slug: c.slug,
        reason: ctx.kind === "purchase" ? "scope" : "stacking",
        detail: ctx.kind === "purchase" ? "no effect reaches this cart" : "a larger effect applies",
      });
      continue;
    }
    applied.push({
      slug: c.slug,
      revision: c.revision,
      title: c.slug,
      effects: out,
      cost_points: out.reduce((a, x) => a + x.cost_points, 0),
    });
  }

  const totals: Totals =
    ctx.kind === "purchase"
      ? {
          kind: "purchase",
          subtotal_points: subtotal,
          discount_points: discount,
          total_points: subtotal - discount,
          bonus_points: bonus,
          free_items: freeItems,
        }
      : {
          kind: "earn",
          base_points: ctx.base_points,
          bonus_points: bonus + multBonus,
          final_points: ctx.base_points + bonus + multBonus,
        };
  return { applied, noEffect, totals };
};

const MEMBER_LEVEL_SKIP: ReadonlySet<Reason> = new Set<Reason>(["channel", "context", "min_cart", "scope"]);

/**
 * Does a member qualify for a promotion right now, ignoring what they are buying or earning (channel, context, cart
 * minimum and scope)? Used for store banners and for the eligible population of the uplift analysis.
 */
export const promotionQualifies = (c: PromoCandidate, member: PromoEvalInput["member"], now: Date): boolean =>
  firstFailure(
    c,
    {
      now: now.toISOString(),
      mode: "live",
      member,
      context: { kind: "earn", channel: "recognition", base_points: 0, earn_type: "award" },
      candidates: [],
    },
    now,
    MEMBER_LEVEL_SKIP,
  ) === undefined;

export const evaluatePromotions = (input: PromoEvalInput): PromoEvaluation => {
  const now = new Date(input.now);
  const rejected: Rejection[] = [];
  const advisories: Array<{ slug: string; reason: Reason; detail: string }> = [];
  let eligible: PromoCandidate[] = [];

  for (const c of input.candidates) {
    const f = firstFailure(c, input, now);
    if (f) {
      rejected.push({ slug: c.slug, ...f });
      continue;
    }
    if (input.mode === "simulate" && c.spec.status !== "active")
      advisories.push({ slug: c.slug, reason: "status", detail: clip(`promotion is ${c.spec.status}`) });
    eligible.push(c);
  }
  // step 2: priority descending, then slug ascending
  eligible.sort((a, b) =>
    b.spec.priority !== a.spec.priority
      ? b.spec.priority - a.spec.priority
      : a.slug < b.slug
        ? -1
        : a.slug > b.slug
          ? 1
          : 0,
  );

  // steps 3 to 5, rerun until the budget drops stabilise (at most one pass per candidate)
  let computed: Computed | undefined;
  let stackRejected: Rejection[] = [];
  for (let pass = 0; pass <= input.candidates.length; pass++) {
    stackRejected = [];
    computed = stackAndCompute(eligible, input, stackRejected);
    const over = computed.applied.find((a) => {
      const c = eligible.find((x) => x.slug === a.slug);
      const max = c?.spec.budget.max_cost_points;
      return c !== undefined && max !== undefined && c.usage.cost_points + a.cost_points > max;
    });
    if (!over) break;
    rejected.push({ slug: over.slug, reason: "budget", detail: "the effect would exceed the points budget" });
    eligible = eligible.filter((x) => x.slug !== over.slug);
  }
  const final = computed ?? stackAndCompute([], input, []);
  for (const r of stackRejected) rejected.push(r);
  for (const r of final.noEffect) rejected.push(r);

  const cost = final.applied.reduce((a, x) => a + x.cost_points, 0);
  const t = final.totals;
  const delta = t.kind === "purchase" ? t.total_points - t.subtotal_points : t.final_points - t.base_points;
  return {
    applied: final.applied,
    rejected,
    advisories,
    totals: t,
    cost_points: cost,
    delta_points: delta,
  };
};
