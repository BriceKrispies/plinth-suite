import { Effect } from "effect";
import type { BadgeSpec } from "@plinth/spec";
import type { SeedStep } from "../seed";

/**
 * Seed step `badges` (CONTRACT.md 11.4, 12.4): the 15 Badge nodes. Criteria awards are produced by the badge engine as the
 * activity history drains; the two manual badges are awarded by the activity step through `badges.award`.
 */

interface BadgeDef {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly criteria: BadgeSpec["criteria"];
  readonly reward: number;
  readonly rarity: BadgeSpec["rarity"];
  readonly shape: BadgeSpec["artwork"]["shape"];
  readonly icon: BadgeSpec["artwork"]["icon"];
  readonly hue: number;
  readonly ring?: BadgeSpec["artwork"]["ring"];
  readonly hidden?: boolean;
}

export const BADGES: ReadonlyArray<BadgeDef> = [
  {
    slug: "first-redemption",
    title: "First redemption",
    description: "Placed a first order in the rewards store.",
    criteria: { type: "event", event: "order.placed" },
    reward: 100,
    rarity: "common",
    shape: "circle",
    icon: "bag",
    hue: 150,
  },
  {
    slug: "silver-standard",
    title: "Silver standard",
    description: "Earned 5,000 lifetime points.",
    criteria: { type: "points_threshold", lifetime_points: 5000 },
    reward: 250,
    rarity: "common",
    shape: "shield",
    icon: "medal",
    hue: 220,
    ring: "silver",
  },
  {
    slug: "gold-standard",
    title: "Gold standard",
    description: "Earned 20,000 lifetime points.",
    criteria: { type: "points_threshold", lifetime_points: 20000 },
    reward: 500,
    rarity: "rare",
    shape: "shield",
    icon: "medal",
    hue: 45,
    ring: "gold",
  },
  {
    slug: "platinum-club",
    title: "Platinum club",
    description: "Earned 50,000 lifetime points.",
    criteria: { type: "points_threshold", lifetime_points: 50000 },
    reward: 1000,
    rarity: "epic",
    shape: "star",
    icon: "crown",
    hue: 265,
    ring: "platinum",
  },
  {
    slug: "big-heart",
    title: "Big heart",
    description: "Gave to three good causes from the store.",
    criteria: {
      type: "action_count",
      event: "order.placed",
      count: 3,
      filter: { field: "event.categories", op: "contains", value: "giving" },
    },
    reward: 300,
    rarity: "uncommon",
    shape: "circle",
    icon: "heart",
    hue: 350,
  },
  {
    slug: "conversation-starter",
    title: "Conversation starter",
    description: "Sent 25 messages.",
    criteria: { type: "action_count", event: "message.sent", count: 25 },
    reward: 150,
    rarity: "common",
    shape: "hexagon",
    icon: "mention",
    hue: 200,
  },
  {
    slug: "team-player",
    title: "Team player",
    description: "Shared points with colleagues ten times.",
    criteria: {
      type: "action_count",
      event: "points.posted",
      count: 10,
      filter: {
        all: [
          { field: "event.txn_type", op: "eq", value: "transfer" },
          { field: "event.delta", op: "lt", value: 0 },
        ],
      },
    },
    reward: 200,
    rarity: "uncommon",
    shape: "hexagon",
    icon: "users",
    hue: 170,
  },
  {
    slug: "streak-7",
    title: "On a roll",
    description: "Sent a message on seven days in a row.",
    criteria: { type: "streak", event: "message.sent", days: 7 },
    reward: 200,
    rarity: "uncommon",
    shape: "ribbon",
    icon: "flame",
    hue: 20,
  },
  {
    slug: "streak-30",
    title: "Unstoppable",
    description: "Earned points on thirty days in a row.",
    criteria: {
      type: "streak",
      event: "points.posted",
      days: 30,
      filter: { field: "event.delta", op: "gt", value: 0 },
    },
    reward: 750,
    rarity: "epic",
    shape: "star",
    icon: "bolt",
    hue: 50,
  },
  {
    slug: "critic",
    title: "Critic",
    description: "Reviewed five products.",
    criteria: { type: "action_count", event: "review.created", count: 5 },
    reward: 150,
    rarity: "common",
    shape: "circle",
    icon: "star",
    hue: 290,
  },
  {
    slug: "early-bird",
    title: "Early bird",
    description: "Read a new story within an hour of publication.",
    criteria: {
      type: "event",
      event: "content.engaged",
      filter: {
        all: [
          { field: "event.viewed", op: "eq", value: true },
          { field: "event.minutes_since_publish", op: "lte", value: 60 },
        ],
      },
    },
    reward: 50,
    rarity: "common",
    shape: "circle",
    icon: "sun",
    hue: 40,
  },
  {
    slug: "peak-hero",
    title: "Peak hero",
    description: "Went above and beyond in peak season. Awarded by a manager.",
    criteria: { type: "manual" },
    reward: 1000,
    rarity: "legendary",
    shape: "shield",
    icon: "trophy",
    hue: 330,
    ring: "platinum",
  },
  {
    slug: "mentor",
    title: "Mentor",
    description: "Helped a colleague grow. Awarded by a manager.",
    criteria: { type: "manual" },
    reward: 500,
    rarity: "rare",
    shape: "ribbon",
    icon: "book",
    hue: 120,
  },
  {
    slug: "automation-pioneer",
    title: "Automation pioneer",
    description: "Owned ten automation runs that succeeded.",
    criteria: {
      type: "action_count",
      event: "automation.run_updated",
      count: 10,
      filter: { field: "event.status", op: "eq", value: "succeeded" },
    },
    reward: 300,
    rarity: "rare",
    shape: "hexagon",
    icon: "workflow",
    hue: 230,
    hidden: true,
  },
  {
    slug: "collector",
    title: "Collector",
    description: "Collected eight badges.",
    criteria: { type: "action_count", event: "badge.awarded", count: 8 },
    reward: 400,
    rarity: "epic",
    shape: "star",
    icon: "sparkle",
    hue: 300,
  },
];

export const badgesStep: SeedStep = {
  name: "badges",
  spec: "11.4, 12.4",
  run: (ctx) =>
    ctx
      .commitNodes(
        BADGES.map((b, i) => {
          const spec: BadgeSpec = {
            description: b.description,
            artwork: { shape: b.shape, icon: b.icon, hue: b.hue, ...(b.ring ? { ring: b.ring } : {}) },
            criteria: b.criteria,
            points_reward: b.reward,
            rarity: b.rarity,
            hidden: b.hidden === true,
            sort: (i + 1) * 10,
            status: "active",
          };
          return ctx.create("Badge", b.slug, {
            apiVersion: "plinth/v1",
            kind: "Badge",
            metadata: { slug: b.slug, title: b.title },
            spec,
          });
        }),
        "seed: badges",
      )
      .pipe(Effect.asVoid),
};
