// Shared pieces of the badges widgets: artwork, rarity, criteria text, the badge tile and how a badge is opened.
import { h } from "../../ds/js/dom.js";
import { badgeArt, hashSlug } from "../../ds/js/artwork.js";
import { pill } from "../../ds/js/pill.js";
import { progressRing } from "../../ds/js/progress.js";
import { icon } from "../../ds/js/icons.js";
import { points, number, date } from "../../ds/js/format.js";

const SHAPES = {
  circle: "disc",
  ribbon: "diamond",
  shield: "shield",
  hexagon: "hexagon",
  star: "star",
  disc: "disc",
  diamond: "diamond",
};

/** Generated badge artwork from a BadgeArtwork `{ shape, icon, hue, ring }`. */
export const badgeArtFor = (art, size = 64, label) => {
  try {
    return badgeArt(
      { shape: SHAPES[art.shape] ?? "disc", icon: art.icon, hue: art.hue, ring: art.ring ?? null },
      { size, label },
    );
  } catch {
    return badgeArt({ shape: "disc", icon: "award", hue: art.hue ?? 0, ring: null }, { size, label });
  }
};

/** Artwork derived from the slug and rarity for events that carry no artwork (DESIGN-SYSTEM 7.5 rule). */
export const derivedArt = (slug, rarity) => {
  const hash = hashSlug(slug);
  const shapes = ["disc", "hexagon", "shield", "star", "diamond"];
  const rings = { common: null, uncommon: "bronze", rare: "silver", epic: "gold", legendary: "platinum" };
  return { shape: shapes[hash % shapes.length], icon: "award", hue: hash % 360, ring: rings[rarity] ?? null };
};

export const RARITY = {
  common: ["Common", "neutral"],
  uncommon: ["Uncommon", "info"],
  rare: ["Rare", "success"],
  epic: ["Epic", "signal"],
  legendary: ["Legendary", "warning"],
};
export const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary"];

export const rarityPill = (rarity) => {
  const [label, tone] = RARITY[rarity] ?? [rarity, "neutral"];
  return pill({ label, tone });
};

const EVENT_VERBS = {
  "message.received": "receive a message",
  "message.sent": "send a message",
  "points.posted": "earn points",
  "tier.changed": "change tier",
  "order.placed": "place an order",
  "order.status_changed": "have an order change status",
  "review.created": "write a review",
  "badge.awarded": "earn a badge",
  "content.engaged": "read or react to content",
  "content.published": "publish content",
  "task.assigned": "get a task assigned",
  "task.updated": "update a task",
  "approval.requested": "request an approval",
  "approval.decided": "decide an approval",
};
const verb = (event) => EVENT_VERBS[event] ?? event.replaceAll(".", " ").replaceAll("_", " ");

/** A sentence for a BadgeCriteria; `null` means the badge is hidden until earned. */
export const criteriaText = (c) => {
  if (!c) return "This is a hidden badge. How to earn it is revealed once you have it.";
  switch (c.type) {
    case "points_threshold":
      return `Earn ${points(c.lifetime_points)} in total.`;
    case "action_count":
      return `${cap(verb(c.event))} ${c.count} ${c.count === 1 ? "time" : "times"}${c.window_days ? ` within ${c.window_days} days` : ""}.`;
    case "streak":
      return `${cap(verb(c.event))} on ${c.days} days in a row.`;
    case "event":
      return `The first time you ${verb(c.event)}.`;
    case "manual":
      return "Awarded by a manager.";
    default:
      return "";
  }
};
const cap = (t) => `${t[0].toUpperCase()}${t.slice(1)}`;

/** Status of a card for a member: earned, in progress or locked. */
export const stateOf = (card) =>
  card.awarded_at ? "earned" : card.progress && card.progress.current > 0 ? "in_progress" : "locked";

export const STATE_PILL = {
  earned: () => pill({ label: "Earned", tone: "success", icon: "check-circle" }),
  in_progress: () => pill({ label: "In progress", tone: "info", icon: "target" }),
  locked: () => pill({ label: "Locked", tone: "neutral", icon: "lock" }),
};

/** `3 to go` or `Done`. */
export const remainingText = (p) => {
  if (!p) return "";
  const left = Math.max(0, p.target - p.current);
  return left === 0 ? "Ready to earn" : `${number(left)} to go`;
};

export const ring = (p, label, size = 48) =>
  progressRing({ value: p.current, max: Math.max(1, p.target), label, size });

/**
 * Open a badge from a widget that has no catalogue beside it: announce it on the bus, and when the page is not
 * the badges page go there with the badge preselected (`?badge=`).
 */
export const openBadge = ({ slug, ctx, bus, nav }) => {
  bus.publish("badge.selected", { id: slug });
  if (ctx.page?.slug !== "badges") nav.go(nav.href("/badges", { badge: slug }));
};

/** A grid tile for one BadgeCard. */
export const badgeTile = (card, { onOpen, selected = false } = {}) => {
  const state = stateOf(card);
  const btn = h(
    "button",
    {
      type: "button",
      class: `w-badges-tile is-${state}${selected ? " is-selected" : ""}`,
      "data-slug": card.slug,
      "aria-label": `${card.title}, ${state === "earned" ? "earned" : state === "in_progress" ? "in progress" : "locked"}`,
      onclick: () => onOpen(card),
    },
    h(
      "span",
      { class: "w-badges-tile__art" },
      badgeArtFor(card.artwork, 72),
      card.progress && state === "in_progress"
        ? h("span", { class: "w-badges-tile__ring" }, ring(card.progress, `${card.title} progress`, 32))
        : null,
    ),
    h("span", { class: "w-badges-tile__title" }, card.title),
    h("span", { class: "w-badges-tile__meta" }, rarityPill(card.rarity), STATE_PILL[state]()),
    state === "earned" && card.awarded_at
      ? h("span", { class: "u-muted w-kit-small" }, `Earned ${date(card.awarded_at)}`)
      : card.progress && card.criteria_type !== "hidden"
        ? h(
            "span",
            { class: "u-muted w-kit-small u-tabular" },
            card.progress.label || `${card.progress.current} of ${card.progress.target}`,
          )
        : card.criteria_type === "hidden"
          ? h("span", { class: "u-muted w-kit-small" }, icon("eye-off", { size: 16 }), " Hidden")
          : null,
    h(
      "span",
      { class: "u-muted w-kit-small u-tabular" },
      card.points_reward ? `+${points(card.points_reward)} reward` : "No points reward",
    ),
  );
  return btn;
};
