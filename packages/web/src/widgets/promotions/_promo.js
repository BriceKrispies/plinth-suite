// Promotion helpers shared by the promotions widgets: lifecycle transitions and plain-language summaries.
import { h } from "../../ds/js/dom.js";
import { number, points, percent } from "../../ds/js/format.js";
import { promptNote, failToast, nowIso, enumLabel } from "./_kit.js";

export const STATUSES = ["draft", "scheduled", "active", "paused", "ended"];
export const TIERS = ["bronze", "silver", "gold", "platinum"];
export const REGIONS = ["NA", "EMEA", "APAC", "LATAM", "ANZ"];
export const CHANNELS = ["store", "recognition", "automation", "content"];
export const CHANNEL_LABEL = {
  store: "Store checkout",
  recognition: "Recognition awards",
  automation: "Automations",
  content: "Content",
};
export const EFFECT_TYPES = [
  { value: "store_discount", label: "Store discount" },
  { value: "bonus_points", label: "Bonus points" },
  { value: "points_multiplier", label: "Points multiplier" },
  { value: "free_item", label: "Free item" },
];
export const REJECTION_LABEL = {
  status: "Not active",
  window: "Outside its schedule window",
  channel: "Does not apply to this channel",
  context: "No effect applies to this kind of event",
  tier: "Member tier not eligible",
  region: "Member region not eligible",
  segment: "Member is not in a listed segment",
  group: "Member is not in a listed group",
  new_member: "Member is not new enough",
  filter: "Custom rule not met",
  entitlement: "No entitlement held",
  min_cart: "Cart is below the minimum",
  scope: "No cart line in scope",
  per_member: "Member limit reached",
  budget: "Budget used up",
  stacking: "Blocked by stacking rules",
};

/** Transitions offered from a status (CONTRACT 8.1). `held` ones go through approval. */
export const transitionsFor = (status, startsAt) => {
  const future = startsAt && new Date(startsAt).getTime() > new Date(nowIso()).getTime();
  switch (status) {
    case "draft":
      return [
        future
          ? { to: "scheduled", label: "Schedule", icon: "calendar", variant: "primary", held: true }
          : { to: "active", label: "Activate", icon: "play", variant: "primary", held: true },
      ];
    case "scheduled":
      return [
        { to: "paused", label: "Pause", icon: "pause" },
        { to: "draft", label: "Return to draft", icon: "history" },
        { to: "ended", label: "End", icon: "stop", danger: true },
      ];
    case "active":
      return [
        { to: "paused", label: "Pause", icon: "pause" },
        { to: "ended", label: "End now", icon: "stop", danger: true },
      ];
    case "paused":
      return [
        { to: "active", label: "Resume", icon: "play", variant: "primary" },
        { to: "ended", label: "End", icon: "stop", danger: true },
      ];
    default:
      return [];
  }
};

/**
 * Ask for an optional reason, then call `promotions.transition`. Resolves `{ status }` or null when cancelled or failed.
 */
export const runTransition = async (ctx, api, { slug, title, revision, step }) => {
  const reason = await promptNote(ctx, {
    title: `${step.label}: ${title}`,
    label: "Reason (optional)",
    hint: step.held
      ? "Going live is held until a promotions approver accepts it."
      : step.danger
        ? "This cannot be undone for an ended promotion."
        : undefined,
    submitLabel: step.label,
    danger: Boolean(step.danger),
  });
  if (reason === null) return null;
  try {
    const out = await api.call("promotions.transition", {
      slug,
      to: step.to,
      base_revision: revision,
      ...(reason ? { reason } : {}),
    });
    if (out.status === "pending_approval")
      ctx.toast({
        title: "Sent for approval",
        body: `${title} will change once an approver accepts it.`,
        tone: "info",
      });
    else ctx.toast({ title: `${title}: ${enumLabel(step.to)}`, tone: "success" });
    ctx.announce(out.status === "pending_approval" ? "Sent for approval" : `${title} is now ${step.to}`);
    return out;
  } catch (e) {
    failToast(ctx, e, `Could not ${step.label.toLowerCase()} ${title}`);
    return null;
  }
};

export const describeEffect = (e) => {
  switch (e.type) {
    case "points_multiplier":
      return `${number(e.factor)}x points on earnings`;
    case "bonus_points":
      return `${points(e.points)} bonus on ${e.on === "earn" ? "earnings" : "purchases"}`;
    case "store_discount": {
      const scope = [...(e.categories ?? []), ...(e.products ?? [])];
      return `${e.percent}% off${scope.length ? ` ${scope.map((s) => s.split(":")[1]).join(", ")}` : " the cart"}${
        e.max_discount_points ? ` (up to ${points(e.max_discount_points)})` : ""
      }`;
    }
    case "free_item":
      return `Free ${String(e.product).split(":")[1] ?? e.product} over ${points(e.min_cart_points)}`;
    default:
      return enumLabel(e.type);
  }
};

export const describeEligibility = (e = {}) => {
  const parts = [];
  if (e.tiers?.length) parts.push(`${e.tiers.map(enumLabel).join(" or ")} tier`);
  if (e.regions?.length) parts.push(`region ${e.regions.join(", ")}`);
  if (e.segments?.length) parts.push(`in ${e.segments.map((s) => s.split(":")[1]).join(" or ")}`);
  if (e.groups?.length) parts.push(`group ${e.groups.map((s) => s.split(":")[1]).join(" or ")}`);
  if (e.new_members_days) parts.push(`joined within ${e.new_members_days} days`);
  if (e.min_cart_points) parts.push(`cart of at least ${points(e.min_cart_points)}`);
  if (e.entitlement_only) parts.push("holds an entitlement");
  if (e.filter) parts.push("matches a custom rule");
  if (e.channels?.length) parts.push(`via ${e.channels.map((c) => CHANNEL_LABEL[c] ?? c).join(", ")}`);
  return parts.length ? parts.join("; ") : "Everyone";
};

/** A compact usage readout: budget bar when the promotion has a cost cap, otherwise the redemption count. */
export const usageText = (usage) =>
  usage.budget_used_pct !== null && usage.budget_used_pct !== undefined
    ? `${percent(Math.min(1, usage.budget_used_pct / 100))} of budget`
    : `${number(usage.redemptions)} redemptions`;

export const windowText = (starts, ends, fmt) => `${fmt(starts)} to ${fmt(ends)}`;

export const usageMeter = (usage, label) => {
  const pct = usage.budget_used_pct;
  const el = h("div", { class: "wp-usage" });
  if (pct === null || pct === undefined) {
    el.append(h("span", { class: "u-tabular" }, `${number(usage.redemptions)} uses`));
  } else {
    const clamped = Math.max(0, Math.min(100, pct));
    el.append(
      h("progress", {
        class: `wp-usage__bar${pct >= 80 ? " is-hot" : ""}`,
        value: clamped,
        max: 100,
        "aria-label": `${label} budget used`,
      }),
      h("span", { class: "u-tabular wp-usage__pct" }, percent(clamped / 100)),
    );
  }
  return el;
};
