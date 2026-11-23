import { Effect } from "effect";
import { nodeId, nodeUri } from "@plinth/core";
import type { Artwork, ContentBlock, ContentSpec } from "@plinth/spec";
import { ControlStore, inTx, store, transitionContent, type Principal } from "@plinth/engine";
import type { SeedCtx, SeedStep } from "../seed";
import { SEED_MEMBERS } from "../people";

/**
 * Seed step `content` (CONTRACT.md 11.7, 10): the 25 Content nodes in their seeded workflow states, moved through
 * `content.transition` at their own virtual times, with engagement history (10 to 38 views per published item) written
 * through `content.engage` as the members themselves.
 *
 * 12 published (4 announcements, 6 articles, 2 pages including `rewards-faq` and `how-points-work`), 3 approved (one
 * scheduled for 2026-11-21 09:00), 3 in review (reviewer Tomas; two by Leah, one awaiting him after a round of requested
 * changes), 4 drafts (two by the agent for Maya, one of Leah's, and a published page being revised) and 3 archived.
 * Authors: Leah 15, Tomas 5, Maya 3, the agent 2. A person who cannot hold content:review (Maya) reviews Tomas's items and
 * submits her own through the same workflow code with the permission check off.
 */

const DAY = 86_400_000;
const LEAH = "user:content-editor";
const TOMAS = "user:marketing-lead";
const MAYA = "user:ops-lead";
const AGENT = "agent:claude-code";

type Topic = "peak" | "safety" | "regional" | "rewards" | "giving" | "tiers";
type Final =
  "published" | "approved" | "scheduled" | "in_review" | "review_changes" | "draft" | "revising" | "archived";

interface Item {
  readonly slug: string;
  readonly title: string;
  readonly type: "page" | "article" | "announcement";
  readonly author: string;
  readonly topic: Topic;
  readonly final: Final;
  /** Days before the demo time of the first submission. */
  readonly day: number;
  readonly pinned?: boolean;
  readonly groups?: ReadonlyArray<string>;
  readonly segments?: ReadonlyArray<string>;
  readonly extra?: ReadonlyArray<ContentBlock>;
}

const ITEMS: ReadonlyArray<Item> = [
  // ---- published (12)
  {
    slug: "peak-season-kickoff",
    title: "Peak season kickoff",
    type: "announcement",
    author: MAYA,
    topic: "peak",
    final: "published",
    day: 56,
    pinned: true,
  },
  {
    slug: "safety-first-this-peak",
    title: "Safety first this peak",
    type: "announcement",
    author: LEAH,
    topic: "safety",
    final: "published",
    day: 52,
    pinned: true,
  },
  {
    slug: "new-rewards-drop",
    title: "New rewards just dropped",
    type: "announcement",
    author: TOMAS,
    topic: "rewards",
    final: "published",
    day: 33,
  },
  {
    slug: "giving-campaign-launch",
    title: "Our giving campaign is live",
    type: "announcement",
    author: LEAH,
    topic: "giving",
    final: "published",
    day: 24,
  },
  {
    slug: "emea-wins-q3",
    title: "EMEA wins of the quarter",
    type: "article",
    author: LEAH,
    topic: "regional",
    final: "published",
    day: 47,
    groups: ["group:emea-ops"],
  },
  {
    slug: "tier-perks-spotlight",
    title: "Tier perks spotlight",
    type: "article",
    author: TOMAS,
    topic: "tiers",
    final: "published",
    day: 41,
  },
  {
    slug: "warehouse-wellness-tips",
    title: "Warehouse wellness tips",
    type: "article",
    author: LEAH,
    topic: "safety",
    final: "published",
    day: 37,
    groups: ["group:wellness-club"],
  },
  {
    slug: "giving-impact-report",
    title: "What your giving achieved",
    type: "article",
    author: LEAH,
    topic: "giving",
    final: "published",
    day: 18,
  },
  {
    slug: "regional-recognition-roundup",
    title: "Regional recognition roundup",
    type: "article",
    author: LEAH,
    topic: "regional",
    final: "published",
    day: 12,
  },
  {
    slug: "store-picks-for-peak",
    title: "Store picks for peak season",
    type: "article",
    author: TOMAS,
    topic: "rewards",
    final: "published",
    day: 9,
    extra: [{ type: "products", products: ["product:fleece-quarter-zip", "product:canvas-tote"] }],
  },
  {
    slug: "rewards-faq",
    title: "Rewards FAQ",
    type: "page",
    author: LEAH,
    topic: "rewards",
    final: "published",
    day: 60,
  },
  {
    slug: "how-points-work",
    title: "How points work",
    type: "page",
    author: LEAH,
    topic: "tiers",
    final: "published",
    day: 58,
    extra: [{ type: "badge", badge: "badge:first-redemption" }],
  },
  // ---- approved (3), one scheduled for 2026-11-21 09:00
  {
    slug: "holiday-hours-notice",
    title: "Holiday hours and cover",
    type: "announcement",
    author: LEAH,
    topic: "peak",
    final: "scheduled",
    day: 4,
  },
  {
    slug: "black-friday-playbook",
    title: "Black Friday playbook",
    type: "article",
    author: TOMAS,
    topic: "rewards",
    final: "approved",
    day: 5,
  },
  {
    slug: "year-end-awards-guide",
    title: "Year-end awards guide",
    type: "article",
    author: LEAH,
    topic: "tiers",
    final: "approved",
    day: 3,
  },
  // ---- in review (3), reviewer Tomas
  {
    slug: "winter-safety-reminders",
    title: "Winter safety reminders",
    type: "announcement",
    author: LEAH,
    topic: "safety",
    final: "in_review",
    day: 2,
  },
  {
    slug: "new-badges-explained",
    title: "New badges explained",
    type: "article",
    author: LEAH,
    topic: "rewards",
    final: "review_changes",
    day: 3,
  },
  {
    slug: "recognition-culture-note",
    title: "A note on recognition culture",
    type: "article",
    author: MAYA,
    topic: "regional",
    final: "in_review",
    day: 1,
  },
  // ---- drafts (4)
  {
    slug: "peak-faq-draft",
    title: "Peak season FAQ (draft)",
    type: "page",
    author: AGENT,
    topic: "peak",
    final: "draft",
    day: 2,
  },
  {
    slug: "tier-perks-explainer-draft",
    title: "Tier perks explainer (draft)",
    type: "article",
    author: AGENT,
    topic: "tiers",
    final: "draft",
    day: 1,
  },
  {
    slug: "rewards-store-tour",
    title: "A tour of the rewards store",
    type: "article",
    author: LEAH,
    topic: "rewards",
    final: "draft",
    day: 1,
  },
  {
    slug: "tier-perks-guide",
    title: "Tier perks guide",
    type: "page",
    author: LEAH,
    topic: "tiers",
    final: "revising",
    day: 44,
  },
  // ---- archived (3)
  {
    slug: "summer-picnic-recap",
    title: "Summer picnic recap",
    type: "article",
    author: LEAH,
    topic: "regional",
    final: "archived",
    day: 85,
  },
  {
    slug: "old-store-hours",
    title: "Store hours (superseded)",
    type: "announcement",
    author: TOMAS,
    topic: "rewards",
    final: "archived",
    day: 80,
  },
  {
    slug: "q2-awards-recap",
    title: "Q2 awards recap",
    type: "article",
    author: MAYA,
    topic: "regional",
    final: "archived",
    day: 76,
  },
];

const TOPIC: Readonly<
  Record<
    Topic,
    {
      icon: Artwork["icon"];
      hue: number;
      tag: string;
      href: string;
      cta: string;
      points: ReadonlyArray<string>;
      callout: string;
    }
  >
> = {
  peak: {
    icon: "megaphone",
    hue: 18,
    tag: "peak",
    href: "/store",
    cta: "Open the rewards store",
    points: [
      "Extended shifts in every region",
      "Double recognition points for Gold members",
      "Weekly offers in the store",
    ],
    callout: "Recognition awards earn double points for Gold members this season.",
  },
  safety: {
    icon: "shield",
    hue: 150,
    tag: "safety",
    href: "/news",
    cta: "Read more news",
    points: [
      "Check your footing on wet floors",
      "Lift with your legs and ask for help",
      "Report near misses the same day",
    ],
    callout: "If something looks unsafe, stop and tell your lead.",
  },
  regional: {
    icon: "globe",
    hue: 260,
    tag: "regions",
    href: "/people",
    cta: "Meet the teams",
    points: [
      "Record throughput in two sites",
      "Three new peak crew members",
      "Zero lost-time incidents this month",
    ],
    callout: "Recognise a colleague today: awards are open to every manager.",
  },
  rewards: {
    icon: "gift",
    hue: 330,
    tag: "rewards",
    href: "/store",
    cta: "Browse the rewards",
    points: ["New apparel and wellness picks", "Experiences for two", "Giving options at every price"],
    callout: "Points expire after twelve months, so spend the oldest first.",
  },
  giving: {
    icon: "heart",
    hue: 350,
    tag: "giving",
    href: "/store/c/giving",
    cta: "Give with your points",
    points: [
      "Plant trees, fund meals, support shelters",
      "Every giving order earns a 200 point match",
      "Totals are shared with the whole company",
    ],
    callout: "The programme matches your giving, up to three times each.",
  },
  tiers: {
    icon: "crown",
    hue: 45,
    tag: "tiers",
    href: "/points",
    cta: "See your tier",
    points: [
      "Silver unlocks early access to drops",
      "Gold adds priority fulfilment",
      "Platinum opens the experiences catalogue",
    ],
    callout: "Your tier is set by lifetime points earned, never by points spent.",
  },
};

const PATTERNS: ReadonlyArray<Artwork["pattern"]> = ["dots", "stripes", "rings", "grid", "waves", "solid"];

const blocksOf = (it: Item, n: number): ContentBlock[] => {
  const t = TOPIC[it.topic];
  const out: ContentBlock[] = [
    { type: "heading", level: 2, text: it.title },
    {
      type: "paragraph",
      text: `**${it.title}.** Here is what you need to know, written for every team across the five regions. Thank you for everything you do.`,
    },
    { type: "list", ordered: false, items: [...t.points] },
    {
      type: "callout",
      tone: it.topic === "safety" ? "warning" : "info",
      icon: it.topic === "safety" ? "alert" : "bolt",
      text: t.callout,
    },
  ];
  if (it.type === "article")
    out.push({
      type: "quote",
      text: "Small recognitions add up to a team people want to work in.",
      cite: "Operations",
    });
  if (it.type === "page")
    out.push(
      { type: "heading", level: 3, text: "Good to know" },
      { type: "paragraph", text: "Ask your lead or message the rewards team if anything here is unclear." },
    );
  out.push(...(it.extra ?? []));
  out.push({ type: "cta", label: t.cta, href: t.href });
  return out.slice(0, 12 + (n % 2));
};

const specOf = (it: Item, i: number): ContentSpec => ({
  type: it.type,
  status: "draft",
  summary: `${it.title}: what changes, what to do and where to find help.`.slice(0, 280),
  hero: {
    icon: TOPIC[it.topic].icon,
    hue: (TOPIC[it.topic].hue + i * 7) % 360,
    pattern: PATTERNS[i % PATTERNS.length] as Artwork["pattern"],
  },
  blocks: blocksOf(it, i),
  tags: [TOPIC[it.topic].tag, it.type],
  audience: {
    everyone: it.groups === undefined && it.segments === undefined,
    ...(it.groups ? { groups: [...it.groups] } : {}),
    ...(it.segments ? { segments: [...it.segments] } : {}),
  },
  author: it.author,
  reviewers: it.author === TOMAS ? [MAYA] : [TOMAS],
  schedule: {},
  pinned: it.pinned === true,
  allow_reactions: true,
  published_revision: null,
  review_log: [],
});

const at = (demo: Date, daysBefore: number, hour: number, minute = 0): Date => {
  const d = new Date(demo.getTime() - daysBefore * DAY);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
};

export const contentStep: SeedStep = {
  name: "content",
  spec: "11.7, 10",
  run: (ctx) =>
    Effect.gen(function* () {
      const rng = ctx.rng("content");
      const uri = (slug: string) =>
        nodeUri(ctx.workspaceSlug, "Content", nodeId(ctx.workspaceId, "Content", slug));
      const who = new Map<string, Principal>();
      for (const s of [LEAH, TOMAS, MAYA, AGENT]) who.set(s, yield* ctx.principal(s));
      const maya = who.get(MAYA)!;

      // the 25 drafts, created in batches (a change set holds at most 16 nodes)
      const nodes = ITEMS.map((it, i) =>
        ctx.create("Content", it.slug, {
          apiVersion: "plinth/v1",
          kind: "Content",
          metadata: { slug: it.slug, title: it.title },
          spec: specOf(it, i),
        }),
      );
      for (let i = 0; i < nodes.length; i += 10)
        yield* ctx.commitNodes(nodes.slice(i, i + 10), `seed: content drafts ${i / 10 + 1}`);

      const rev = new Map<string, number>(ITEMS.map((it) => [it.slug, 1]));
      // one workflow step: through the handler for people who hold the permission, through the workflow code otherwise
      const step = (
        it: Item,
        by: string,
        action: "submit" | "approve" | "request_changes" | "publish" | "schedule" | "archive" | "revise",
        when: Date,
        extra?: { note?: string; publish_at?: string },
        bypass = false,
      ) =>
        Effect.gen(function* () {
          const input = { slug: it.slug, action, base_revision: rev.get(it.slug) ?? 1, ...(extra ?? {}) };
          if (bypass) {
            const p = who.get(by)!;
            const res = yield* inTx(
              transitionContent({ principal: p, surface: "system", now: when }, input, false),
            );
            rev.set(it.slug, res.revision ?? (rev.get(it.slug) ?? 1) + 1);
            return;
          }
          const out = (yield* ctx.act(who.get(by)!, "content.transition", input, { at: when })) as {
            revision?: number;
          };
          rev.set(it.slug, out.revision ?? (rev.get(it.slug) ?? 1) + 1);
        });
      const edit = (it: Item, text: string) =>
        ctx
          .commitNodes(
            [
              {
                target: uri(it.slug),
                base_revision: rev.get(it.slug) ?? 1,
                ops: [{ op: "set", path: "/spec/blocks/1/text", value: text }],
              },
            ],
            `seed: edit ${it.slug}`,
          )
          .pipe(
            Effect.tap((r) =>
              Effect.sync(() =>
                rev.set(it.slug, r.nodes?.[0]?.result_revision ?? (rev.get(it.slug) ?? 1) + 1),
              ),
            ),
          );

      const publishedAt = new Map<string, Date>();
      for (const it of ITEMS) {
        const reviewer = it.author === TOMAS ? MAYA : TOMAS;
        const submitter = it.author;
        const viaHelper = (s: string) => s === MAYA || s === AGENT;
        const t0 = at(ctx.demoNow, it.day, 9 + (it.day % 4));
        const t1 = new Date(t0.getTime() + 20 * 3_600_000);
        const t2 = new Date(t1.getTime() + 18 * 3_600_000);
        if (it.final === "draft") continue;
        yield* step(it, submitter, "submit", t0, undefined, viaHelper(submitter));
        if (it.final === "in_review") continue;
        if (it.final === "review_changes") {
          yield* step(
            it,
            reviewer,
            "request_changes",
            t1,
            { note: "Please add the badge criteria and shorten the intro." },
            viaHelper(reviewer),
          );
          yield* edit(it, `**${it.title}.** Shorter intro, with the badge criteria added as asked.`);
          yield* step(it, submitter, "submit", t2, undefined, viaHelper(submitter));
          continue;
        }
        yield* step(it, reviewer, "approve", t1, undefined, viaHelper(reviewer));
        if (it.final === "approved") continue;
        if (it.final === "scheduled") {
          yield* step(it, TOMAS, "schedule", t2, { publish_at: "2026-11-21T09:00:00Z" });
          continue;
        }
        yield* step(it, TOMAS, "publish", t2);
        publishedAt.set(it.slug, t2);
        if (it.final === "archived") {
          const t3 = new Date(t2.getTime() + 30 * DAY);
          yield* step(
            it,
            TOMAS,
            "archive",
            t3 > ctx.demoNow ? new Date(ctx.demoNow.getTime() - 3_600_000) : t3,
          );
        }
        if (it.final === "revising") {
          yield* step(it, LEAH, "revise", new Date(t2.getTime() + 20 * DAY));
          yield* edit(it, `**${it.title}.** Updated for the new tier thresholds, pending review.`);
        }
      }

      // engagement: 10 to 38 views per published item, written as the members themselves
      const members = SEED_MEMBERS;
      const principals = new Map<string, Principal>();
      for (const m of members) principals.set(m.handle, yield* ctx.principal(m.subject));
      const reactions = ["like", "celebrate", "insightful"] as const;
      for (const it of ITEMS) {
        const pub = publishedAt.get(it.slug);
        if (!pub || (it.final !== "published" && it.final !== "revising")) continue;
        const target = 10 + rng.int(29);
        // a group audience can only be engaged by its own members
        let eligible = members;
        if (it.groups) {
          const { sql } = yield* ControlStore;
          const rows = yield* store(
            sql<{ subject: string }>`
              SELECT s.subject FROM nodes n
              JOIN LATERAL jsonb_array_elements_text(n.body -> 'spec' -> 'members') s(subject) ON true
              WHERE n.workspace_id = ${ctx.workspaceId} AND n.kind = 'Group'
                AND n.slug = ANY (${"{" + it.groups.map((g) => g.replace(/^group:/, "")).join(",") + "}"}::text[])`,
          );
          const subjects = new Set(rows.map((r) => r.subject));
          eligible = members.filter((m) => subjects.has(m.subject));
        }
        const pool = [...eligible];
        const viewers: string[] = [];
        while (viewers.length < Math.min(target, pool.length))
          viewers.push(pool.splice(rng.int(pool.length), 1)[0]!.handle);
        const events: Array<{ handle: string; when: Date; reaction: (typeof reactions)[number] | null }> = [];
        const span = Math.max(3_600_000, ctx.demoNow.getTime() - pub.getTime() - 3_600_000);
        for (let k = 0; k < target; k++) {
          const handle = viewers[k % viewers.length]!;
          events.push({
            handle,
            when: new Date(pub.getTime() + 600_000 + rng.int(Math.floor(span / 60_000)) * 60_000),
            reaction: k < viewers.length && rng.float() < 0.45 ? rng.pick(reactions) : null,
          });
        }
        events.sort((a, b) => a.when.getTime() - b.when.getTime());
        for (const e of events)
          yield* ctx
            .act(
              principals.get(e.handle)!,
              "content.engage",
              { slug: it.slug, view: true, ...(e.reaction ? { reaction: e.reaction } : {}) },
              { at: e.when },
            )
            .pipe(Effect.ignore);
      }
      void maya;
      yield* ctx.drain();
    }),
};
