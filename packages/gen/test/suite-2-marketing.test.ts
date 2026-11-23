import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { nodeId, nodeUri, workspaceId } from "@plinth/core";
import type { DomainError, Kind, NodeChange } from "@plinth/spec";
import {
  ChangeLog,
  ControlStore,
  Identity,
  StoreLive,
  automationEmitCtx,
  automationMatchEvents,
  automationPrincipal,
  domainEventsAfter,
  emitDomainEvent,
  inTx,
  invoke,
  resetAndSeed,
  store,
  type Principal,
} from "@plinth/engine";
import { contentSchedule } from "../../worker/src/engines/content";
import { promotionSchedule } from "../../worker/src/engines/promotions";
import { automationOnMinute } from "../../worker/src/engines/automation";
import type { WorkerCtx } from "../../worker/src/hooks";
import { runSuiteSeed } from "../src/suite";
import { SEED_MEMBERS } from "../src/suite/people";
import {
  groups,
  members,
  openingBalances,
  preferences,
  program,
  roles,
  servicePrincipals,
} from "../src/suite/steps/people";

// Needs Postgres (plinth_test). Marketing and content: segments, promotions, automation and content handlers, and the
// worker engines that publish, schedule and match. The foundation seed steps only: these tests create their own nodes.

const WS = workspaceId("northwind");
const NOW = new Date("2026-11-20T14:30:00Z");
const FOUNDATION = [servicePrincipals, members, program, roles, preferences, groups, openingBalances];

const setup = Effect.gen(function* () {
  yield* resetAndSeed;
  yield* runSuiteSeed({ steps: FOUNDATION });
  const id = yield* Identity;
  const who = (s: string) => id.bySubject(s);
  return {
    maya: yield* who("user:ops-lead"),
    jonas: yield* who("user:emea-lead"),
    priya: yield* who("user:finance-analyst"),
    tomas: yield* who("user:marketing-lead"),
    leah: yield* who("user:content-editor"),
    ana: yield* who("user:ana-silva"),
    system: yield* who("service:ingest"),
  };
});

const uriOf = (kind: Kind, slug: string) => nodeUri("northwind", kind, nodeId(WS, kind, slug));
const createNode = (kind: Kind, slug: string, spec: unknown, title = slug): NodeChange => ({
  target: uriOf(kind, slug),
  base_revision: null,
  ops: [
    {
      op: "create",
      kind,
      slug,
      body: { apiVersion: "plinth/v1", kind, metadata: { slug, title }, spec } as never,
    },
  ],
});
const commit = (system: Principal, changes: NodeChange[], managed?: { by: string }) =>
  Effect.flatMap(ChangeLog, (log) =>
    log.commit({
      actor: { principal: system, surface: "system" },
      changes,
      reason: "test",
      ...(managed ? { managed } : {}),
    }),
  );

const call = (p: Principal, name: string, input: Record<string, unknown>, at?: Date) =>
  invoke({ actor: { principal: p, surface: "api" }, name, input, ...(at ? { at } : {}) }).pipe(
    Effect.map((o) => (o.kind === "result" ? (o.data as any) : (o as any))),
  );

const refusal = <A, E>(eff: Effect.Effect<A, E, any>) =>
  eff.pipe(
    Effect.either,
    Effect.map((r) => (Either.isLeft(r) ? (r.left as unknown as DomainError) : undefined)),
  );

const rows = <T extends object>(q: Effect.Effect<ReadonlyArray<T>, any, any>) =>
  q as Effect.Effect<ReadonlyArray<T>, any, any>;

const eventsOf = (type: string) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    return yield* store(
      sql<{ seq: string; payload: any; audience: string[]; subject_id: string | null }>`
        SELECT seq::text AS seq, payload, audience, subject_id FROM domain_events WHERE type = ${type} ORDER BY seq`,
    );
  });

const status = (kind: string, slug: string) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const r = yield* store(
      sql<{ s: string; revision: string }>`
        SELECT body -> 'spec' ->> 'status' AS s, revision::text AS revision FROM nodes WHERE kind = ${kind} AND slug = ${slug}`,
    );
    return { status: r[0]?.s, revision: Number(r[0]?.revision) };
  });

const wctx = (iso: string): WorkerCtx => ({
  workspaceId: WS,
  workspaceSlug: "northwind",
  now: new Date(iso),
});
const tick = (iso: string) => ({ bucket: new Date(iso), previous: null });

const ALL_EMEA = SEED_MEMBERS.filter((m) => m.region === "EMEA").length;

describe("segments (M9)", () => {
  it.effect("preview, list and members evaluate live and honour the caller's row scope", () =>
    Effect.gen(function* () {
      const { system, tomas, jonas } = yield* setup;
      yield* commit(system, [
        createNode("Segment", "emea-all", {
          description: "Everyone in EMEA",
          rule: { field: "region", op: "eq", value: "EMEA" },
          owner: "user:marketing-lead",
        }),
      ]);
      const pv = yield* call(tomas, "segments.preview", { segment: "segment:emea-all", sample: 3 });
      expect(pv.count).toBe(ALL_EMEA);
      expect(pv.total_members).toBe(SEED_MEMBERS.length);
      expect(pv.sample).toHaveLength(3);
      expect(pv.by_region.EMEA).toBe(ALL_EMEA);
      expect(pv.by_region.NA).toBe(0);

      const both = yield* refusal(call(tomas, "segments.preview", { sample: 0 }));
      expect(both?.code).toBe("VALIDATION_FAILED");

      const list = yield* call(tomas, "segments.list", {});
      expect(list.items.find((s: any) => s.node.slug === "emea-all")).toMatchObject({
        count: ALL_EMEA,
        used_by: 0,
      });

      // the EMEA regional manager sees only the EMEA people: an NA rule matches nobody, the total is EMEA only
      const scoped = yield* call(jonas, "segments.preview", {
        rule: { field: "region", op: "eq", value: "NA" },
      });
      expect(scoped.count).toBe(0);
      expect(scoped.total_members).toBe(ALL_EMEA);

      const page1 = yield* call(tomas, "segments.members", { slug: "emea-all", limit: 4 });
      expect(page1.items).toHaveLength(4);
      expect(page1.count).toBe(ALL_EMEA);
      expect(page1.next_cursor).not.toBeNull();
      const page2 = yield* call(tomas, "segments.members", {
        slug: "emea-all",
        limit: 4,
        cursor: page1.next_cursor,
      });
      expect(page2.items[0].person.handle > page1.items[3].person.handle).toBe(true);
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("promotions (M6)", () => {
  const promo = (over: Record<string, unknown> = {}) => ({
    status: "draft",
    description: "ten percent off apparel",
    eligibility: { channels: ["store"] },
    effects: [{ type: "store_discount", percent: 10, categories: ["category:apparel"] }],
    budget: { max_cost_points: 10000 },
    schedule: { starts_at: "2026-11-01T00:00:00Z", ends_at: "2026-12-01T00:00:00Z" },
    priority: 100,
    stacking: "stack",
    owner: "user:marketing-lead",
    ...over,
  });
  const seedPromo = (system: Principal) =>
    Effect.gen(function* () {
      yield* commit(system, [
        createNode("Category", "apparel", {
          description: "Apparel",
          artwork: { icon: "shirt", hue: 212, pattern: "stripes" },
          sort: 10,
          status: "active",
        }),
      ]);
      yield* commit(system, [createNode("Promotion", "ten-off", promo(), "Ten off apparel")]);
    });

  it.effect("activating from draft is held for promotions:approve and announced to the approvers", () =>
    Effect.gen(function* () {
      const { system, tomas, priya } = yield* setup;
      yield* seedPromo(system);
      const bad = yield* refusal(
        call(tomas, "promotions.transition", { slug: "ten-off", to: "paused", base_revision: 1 }),
      );
      expect(bad?.code).toBe("CONFLICT");
      expect(bad?.details).toMatchObject({ reason: "INVALID_TRANSITION", from: "draft", to: "paused" });

      const held = yield* call(tomas, "promotions.transition", {
        slug: "ten-off",
        to: "active",
        base_revision: 1,
      });
      expect(held.status).toBe("pending_approval");
      expect(held.rule_id).toContain("R-PROMO-ACTIVATE");
      expect(held.approval_id).toBeTruthy();
      expect((yield* status("Promotion", "ten-off")).status).toBe("draft");

      const requested = yield* eventsOf("approval.requested");
      expect(requested.at(-1)?.payload).toMatchObject({ approval_type: "change", id: held.approval_id });
      expect(requested.at(-1)?.audience).toContain("user:finance-analyst");
      const { sql } = yield* ControlStore;
      const notes = yield* store(
        sql<{ n: string }>`
          SELECT count(*)::text AS n FROM notifications n JOIN principals p ON p.principal_id = n.recipient_id
          WHERE p.subject = 'user:finance-analyst' AND n.type = 'approval_request'`,
      );
      expect(Number(notes[0]?.n)).toBeGreaterThanOrEqual(1);

      // the approver applies it; the list shows it active and the scheduler hook announces the state change
      const log = yield* ChangeLog;
      const done = yield* log.decideApproval(priya, held.approval_id, "approve");
      expect(done.status).toBe("approved");
      expect((yield* status("Promotion", "ten-off")).status).toBe("active");
      yield* inTx(promotionSchedule(tick("2026-11-20T14:31:00Z"), wctx("2026-11-20T14:31:00Z")));
      const states = yield* eventsOf("promotion.state_changed");
      expect(states.at(-1)?.payload).toMatchObject({ promotion: "ten-off", from: "draft", to: "active" });
      // once per revision: a second tick adds nothing
      yield* inTx(promotionSchedule(tick("2026-11-20T14:32:00Z"), wctx("2026-11-20T14:32:00Z")));
      expect((yield* eventsOf("promotion.state_changed")).length).toBe(states.length);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("pause, resume and end commit directly with an event; ended is terminal", () =>
    Effect.gen(function* () {
      const { system, tomas } = yield* setup;
      yield* seedPromo(system);
      yield* commit(
        system,
        [
          {
            target: uriOf("Promotion", "ten-off"),
            base_revision: 1,
            ops: [{ op: "set", path: "/spec/status", value: "active" }],
          },
        ],
        { by: "promotions.transition" },
      );
      const paused = yield* call(tomas, "promotions.transition", {
        slug: "ten-off",
        to: "paused",
        base_revision: 2,
      });
      expect(paused).toMatchObject({ status: "committed", rule_id: ["R-PROMO-CONTROL"] });
      const resumed = yield* call(tomas, "promotions.transition", {
        slug: "ten-off",
        to: "active",
        base_revision: paused.revision,
      });
      expect(resumed.status).toBe("committed");
      const ended = yield* call(tomas, "promotions.transition", {
        slug: "ten-off",
        to: "ended",
        base_revision: resumed.revision,
      });
      expect(ended.status).toBe("committed");
      const states = (yield* eventsOf("promotion.state_changed")).map(
        (e) => `${e.payload.from}>${e.payload.to}`,
      );
      expect(states).toEqual(["active>paused", "paused>active", "active>ended"]);
      const again = yield* refusal(
        call(tomas, "promotions.transition", {
          slug: "ten-off",
          to: "active",
          base_revision: ended.revision,
        }),
      );
      expect(again?.details).toMatchObject({ reason: "INVALID_TRANSITION", from: "ended" });
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("simulate evaluates an unsaved spec and a saved draft against a member, with a baseline", () =>
    Effect.gen(function* () {
      const { system, tomas } = yield* setup;
      yield* seedPromo(system);
      const context = {
        kind: "purchase",
        channel: "store",
        lines: [{ product: "fleece", category: "apparel", qty: 1, unit_points: 1000 }],
      };
      const saved = yield* call(tomas, "promotions.simulate", {
        promotion: "promotion:ten-off",
        member: "ana-silva",
        context,
      });
      expect(saved.evaluation.totals).toMatchObject({ discount_points: 100, total_points: 900 });
      expect(saved.evaluation.advisories[0]).toMatchObject({ slug: "ten-off", reason: "status" });
      expect(saved.evaluation.applied[0].title).toBe("Ten off apparel");
      expect(saved.baseline.totals).toMatchObject({ discount_points: 0, total_points: 1000 });
      const unsaved = yield* call(tomas, "promotions.simulate", {
        promotion: {
          slug: "scratch",
          title: "Scratch",
          spec: promo({ effects: [{ type: "store_discount", percent: 50 }] }),
        },
        member: "ana-silva",
        context,
      });
      expect(unsaved.evaluation.totals).toMatchObject({ discount_points: 500 });
      const list = yield* call(tomas, "promotions.list", {});
      expect(list.status_counts).toMatchObject({ draft: 1, active: 0 });
      expect(list.items[0]).toMatchObject({ status: "draft", effect_summary: "10% off apparel" });
      const analytics = yield* call(tomas, "promotions.analytics", { slug: "ten-off" });
      expect(analytics).toMatchObject({ status: "draft", benefit_points: 0, uplift: null });
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("the scheduler starts a scheduled promotion at starts_at and ends it at ends_at", () =>
    Effect.gen(function* () {
      const { system } = yield* setup;
      yield* seedPromo(system);
      yield* commit(
        system,
        [
          {
            target: uriOf("Promotion", "ten-off"),
            base_revision: 1,
            ops: [
              { op: "set", path: "/spec/status", value: "scheduled" },
              { op: "set", path: "/spec/schedule/starts_at", value: "2026-11-25T00:00:00Z" },
            ],
          },
        ],
        { by: "promotions.transition" },
      );
      yield* inTx(promotionSchedule(tick("2026-11-24T23:59:00Z"), wctx("2026-11-24T23:59:00Z")));
      expect((yield* status("Promotion", "ten-off")).status).toBe("scheduled");
      yield* inTx(promotionSchedule(tick("2026-11-25T00:00:30Z"), wctx("2026-11-25T00:00:30Z")));
      expect((yield* status("Promotion", "ten-off")).status).toBe("active");
      const { sql } = yield* ControlStore;
      const started = yield* store(
        sql<{ n: string }>`SELECT count(*)::text AS n FROM notifications WHERE type = 'promotion_started'`,
      );
      expect(Number(started[0]?.n)).toBe(SEED_MEMBERS.length);
      yield* inTx(promotionSchedule(tick("2026-12-01T00:00:10Z"), wctx("2026-12-01T00:00:10Z")));
      expect((yield* status("Promotion", "ten-off")).status).toBe("ended");
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("content (M8)", () => {
  const blocks = [
    { type: "heading", level: 2, text: "Peak starts Monday" },
    { type: "paragraph", text: "Every region moves to **extended shifts**." },
  ];
  const draft = (over: Record<string, unknown> = {}) => ({
    type: "announcement",
    status: "draft",
    summary: "What peak means",
    hero: { icon: "megaphone", hue: 18, pattern: "waves" },
    blocks,
    tags: ["peak"],
    audience: { everyone: true },
    author: "user:content-editor",
    reviewers: ["user:marketing-lead"],
    schedule: {},
    pinned: false,
    allow_reactions: true,
    published_revision: null,
    review_log: [],
    ...over,
  });

  it.effect("the workflow moves a draft to published; each step is logged, announced and notified", () =>
    Effect.gen(function* () {
      const { system, leah, tomas, ana } = yield* setup;
      yield* commit(system, [createNode("Content", "kickoff", draft(), "Kickoff")]);
      const step = (p: Principal, action: string, extra: Record<string, unknown> = {}) =>
        Effect.gen(function* () {
          const s = yield* status("Content", "kickoff");
          return yield* call(p, "content.transition", {
            slug: "kickoff",
            action,
            base_revision: s.revision,
            ...extra,
          });
        });

      // only the author (or a publisher) submits; a reviewer needs a note to send it back
      const early = yield* refusal(step(tomas, "approve"));
      expect(early?.details).toMatchObject({ reason: "INVALID_TRANSITION", from: "draft" });
      expect((yield* step(leah, "submit")).status).toBe("committed");
      expect((yield* status("Content", "kickoff")).status).toBe("in_review");
      const requested = yield* eventsOf("approval.requested");
      expect(requested.at(-1)?.payload).toMatchObject({ approval_type: "content_review", id: "kickoff" });
      const noNote = yield* refusal(step(tomas, "request_changes"));
      expect(noNote?.code).toBe("VALIDATION_FAILED");
      const notReviewer = yield* refusal(step(leah, "approve"));
      expect(notReviewer?.code).toBe("FORBIDDEN");

      expect((yield* step(tomas, "approve")).status).toBe("committed");
      const pub = yield* step(tomas, "publish");
      const head = yield* status("Content", "kickoff");
      expect(head.status).toBe("published");
      expect(pub.revision).toBe(head.revision);
      const { sql } = yield* ControlStore;
      const pr = yield* store(
        sql<{ pr: string; log: any }>`
          SELECT body -> 'spec' ->> 'published_revision' AS pr, body -> 'spec' -> 'review_log' AS log FROM nodes WHERE slug = 'kickoff'`,
      );
      expect(Number(pr[0]?.pr)).toBe(head.revision);
      expect(pr[0]?.log.map((e: any) => e.decision)).toEqual(["submitted", "approved", "published"]);
      expect((yield* eventsOf("content.published")).at(-1)?.payload).toMatchObject({
        content: "kickoff",
        content_type: "announcement",
      });
      // an announcement notifies its audience on publication
      const pn = yield* store(
        sql<{ n: string }>`SELECT count(*)::text AS n FROM notifications WHERE type = 'content_published'`,
      );
      expect(Number(pn[0]?.n)).toBeGreaterThan(0);

      // the feed, the reader and engagement
      const feed = yield* call(ana, "content.feed", {});
      expect(feed.items.map((i: any) => i.slug)).toContain("kickoff");
      const read = yield* call(ana, "content.published", { slug: "kickoff" });
      expect(read.revision).toBe(head.revision);
      expect(read.blocks).toHaveLength(2);
      const e1 = yield* call(ana, "content.engage", { slug: "kickoff", view: true, reaction: "celebrate" });
      expect(e1).toMatchObject({ views: 1, my_reaction: "celebrate" });
      const e2 = yield* call(ana, "content.engage", { slug: "kickoff", view: true });
      expect(e2.views).toBe(2);
      const e3 = yield* call(ana, "content.engage", { slug: "kickoff", reaction: null });
      expect(e3.my_reaction).toBeNull();
      expect((yield* eventsOf("content.engaged")).length).toBe(3);
      const draftOnly = yield* refusal(call(ana, "content.published", { slug: "nope" }));
      expect(draftOnly?.code).toBe("UNKNOWN_REFERENCE");
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("revising keeps serving the published revision; versions and diff read the change log", () =>
    Effect.gen(function* () {
      const { system, leah, tomas, ana } = yield* setup;
      yield* commit(system, [createNode("Content", "guide", draft({ type: "page" }), "Guide")]);
      const go = (p: Principal, action: string, extra: Record<string, unknown> = {}) =>
        Effect.gen(function* () {
          const s = yield* status("Content", "guide");
          return yield* call(p, "content.transition", {
            slug: "guide",
            action,
            base_revision: s.revision,
            ...extra,
          });
        });
      yield* go(leah, "submit");
      yield* go(tomas, "approve");
      yield* go(tomas, "publish");
      const published = (yield* status("Content", "guide")).revision;
      yield* go(leah, "revise");
      const s = yield* status("Content", "guide");
      expect(s.status).toBe("draft");
      // edit the draft: a new first block text; the feed still serves the published body
      yield* commit(system, [
        {
          target: uriOf("Content", "guide"),
          base_revision: s.revision,
          ops: [{ op: "set", path: "/spec/blocks/1/text", value: "A rewritten paragraph." }],
        },
      ]);
      const read = yield* call(ana, "content.published", { slug: "guide" });
      expect(read.revision).toBe(published);
      expect(read.blocks[1].text).toBe("Every region moves to **extended shifts**.");

      const versions = yield* call(leah, "content.versions", { slug: "guide" });
      expect(versions.published_revision).toBe(published);
      expect(versions.items.find((v: any) => v.revision === published)).toMatchObject({
        published: true,
        status: "published",
      });
      expect(versions.head).toBeGreaterThan(published);
      const diff = yield* call(leah, "content.diff", { slug: "guide", from: published, to: versions.head });
      expect(diff.blocks.find((b: any) => b.change === "modified")).toBeTruthy();
      const prev = yield* call(leah, "content.preview", { slug: "guide", revision: published });
      expect(prev.spec.blocks[1].text).toBe("Every region moves to **extended shifts**.");
      const list = yield* call(leah, "content.list", { status: ["draft"] });
      expect(list.items[0]).toMatchObject({ display_status: "revising", published_revision: published });
      expect(list.status_counts.draft).toBe(1);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect(
    "the scheduler publishes an approved item at publish_at and archives a published one at unpublish_at",
    () =>
      Effect.gen(function* () {
        const { system, leah, tomas } = yield* setup;
        yield* commit(system, [
          createNode("Content", "later", draft(), "Later"),
          createNode(
            "Content",
            "expiring",
            draft({ schedule: { unpublish_at: "2026-11-22T00:00:00Z" } }),
            "Expiring",
          ),
        ]);
        for (const slug of ["later", "expiring"]) {
          for (const [p, action, extra] of [
            [leah, "submit", {}],
            [tomas, "approve", {}],
          ] as const) {
            const s = yield* status("Content", slug);
            yield* call(p, "content.transition", { slug, action, base_revision: s.revision, ...extra });
          }
        }
        const s = yield* status("Content", "later");
        yield* call(tomas, "content.transition", {
          slug: "later",
          action: "schedule",
          base_revision: s.revision,
          publish_at: "2026-11-21T09:00:00Z",
        });
        const e = yield* status("Content", "expiring");
        yield* call(tomas, "content.transition", {
          slug: "expiring",
          action: "publish",
          base_revision: e.revision,
        });

        yield* inTx(contentSchedule(tick("2026-11-21T08:59:00Z"), wctx("2026-11-21T08:59:00Z")));
        expect((yield* status("Content", "later")).status).toBe("approved");
        yield* inTx(contentSchedule(tick("2026-11-21T09:00:30Z"), wctx("2026-11-21T09:00:30Z")));
        expect((yield* status("Content", "later")).status).toBe("published");
        expect((yield* status("Content", "expiring")).status).toBe("published");
        yield* inTx(contentSchedule(tick("2026-11-22T00:00:10Z"), wctx("2026-11-22T00:00:10Z")));
        expect((yield* status("Content", "expiring")).status).toBe("archived");
        // idempotent: a second pass does nothing more
        const before = (yield* eventsOf("content.state_changed")).length;
        yield* inTx(contentSchedule(tick("2026-11-22T00:01:10Z"), wctx("2026-11-22T00:01:10Z")));
        expect((yield* eventsOf("content.state_changed")).length).toBe(before);
      }).pipe(Effect.provide(StoreLive)),
  );
});

describe("automation (M7)", () => {
  const notifyAuto = (over: Record<string, unknown> = {}) => ({
    enabled: true,
    description: "Thank members for an order",
    trigger: { type: "event", event: "order.placed" },
    steps: [
      {
        id: "thank",
        type: "notify",
        to: ["$member"],
        notification_type: "system",
        title: "Order {{event.order_no}} received",
        body: "Thanks {{member.handle}}",
        on_error: "stop",
      },
    ],
    limits: { max_runs_per_member_per_day: 1 },
    owner: "user:ops-lead",
    ...over,
  });
  const sample = {
    type: "order.placed",
    payload: { order_no: "R-000001", requires_approval: false },
    member: "ana-silva",
  };

  it.effect(
    "a manual run executes its steps with substituted text, is idempotent and honours the daily limit",
    () =>
      Effect.gen(function* () {
        const { system, tomas } = yield* setup;
        yield* commit(system, [createNode("Automation", "thanks", notifyAuto(), "Thanks")]);
        const run = yield* call(tomas, "automation.trigger", {
          slug: "thanks",
          event: sample,
          idempotency_key: "manual-key-0001",
        });
        expect(run).toMatchObject({
          status: "succeeded",
          steps_total: 1,
          steps_succeeded: 1,
          trigger: { type: "manual" },
        });
        const { sql } = yield* ControlStore;
        const n = yield* store(
          sql<{ title: string; body: string }>`
          SELECT n.title, n.body FROM notifications n JOIN principals p ON p.principal_id = n.recipient_id
          WHERE p.subject = 'user:ana-silva' AND n.type = 'system'`,
        );
        expect(n).toEqual([{ title: "Order R-000001 received", body: "Thanks ana-silva" }]);

        // the same key replays the stored result; no second run
        const again = yield* invoke({
          actor: { principal: tomas, surface: "api" },
          name: "automation.trigger",
          input: { slug: "thanks", event: sample, idempotency_key: "manual-key-0001" },
        });
        expect(again.kind === "result" && again.replayed).toBe(true);
        const count = yield* store(sql<{ n: string }>`SELECT count(*)::text AS n FROM automation_runs`);
        expect(Number(count[0]?.n)).toBe(1);

        // a second run for the same member the same day is skipped by the limit
        const limited = yield* call(tomas, "automation.trigger", {
          slug: "thanks",
          event: sample,
          idempotency_key: "manual-key-0002",
        });
        expect(limited).toMatchObject({ status: "skipped", error: { code: "LIMIT" } });

        const detail = yield* call(tomas, "automation.run", { run_id: run.run_id });
        expect(detail.steps[0]).toMatchObject({ id: "thank", status: "succeeded", attempts: 1 });
        expect(detail.steps[0].input.title).toBe("Order R-000001 received");
        const runs = yield* call(tomas, "automation.runs", { automation: "thanks" });
        expect(runs.items).toHaveLength(2);
        const failedOnly = yield* call(tomas, "automation.runs", { status: ["failed"] });
        expect(failedOnly.items).toHaveLength(0);
        const upd = yield* eventsOf("automation.run_updated");
        expect(upd.map((e) => e.payload.status)).toContain("succeeded");
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("dry run reports trigger, conditions, limits and each step without writing", () =>
    Effect.gen(function* () {
      const { system, tomas } = yield* setup;
      yield* commit(system, [
        createNode(
          "Automation",
          "thanks",
          notifyAuto({ conditions: { field: "member.orders_90d", op: "eq", value: 99 } }),
          "Thanks",
        ),
      ]);
      const dry = yield* call(tomas, "automation.dry_run", {
        automation: "automation:thanks",
        event: sample,
      });
      expect(dry).toMatchObject({ trigger_matched: true, conditions_passed: false, limits_ok: true });
      expect(dry.steps[0]).toMatchObject({ id: "thank", would_run: true });
      expect(dry.steps[0].input.title).toBe("Order R-000001 received");
      const wrong = yield* call(tomas, "automation.dry_run", {
        automation: "automation:thanks",
        event: { ...sample, type: "tier.changed", payload: {} },
      });
      expect(wrong.trigger_matched).toBe(false);
      const cron = yield* call(tomas, "automation.dry_run", {
        automation: {
          slug: "scratch",
          title: "Scratch",
          spec: notifyAuto({ trigger: { type: "schedule", cron: "0 9 * * 1" } }),
        },
        at: "2026-11-20T14:30:00Z",
      });
      expect(cron.next_fires[0]).toBe("2026-11-23T09:00:00.000Z");
      expect(cron.next_fires).toHaveLength(5);
      const { sql } = yield* ControlStore;
      const n = yield* store(
        sql<{ n: string }>`SELECT count(*)::text AS n FROM notifications WHERE type = 'system'`,
      );
      expect(Number(n[0]?.n)).toBe(0);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect(
    "a step outside the owner's grants fails the run (FORBIDDEN, not retryable); retry re-runs failed steps with the original keys",
    () =>
      Effect.gen(function* () {
        const { system, tomas } = yield* setup;
        const { sql } = yield* ControlStore;
        // Tomas owns an award automation but holds no points:award
        yield* commit(system, [
          createNode(
            "Automation",
            "bonus",
            notifyAuto({
              steps: [
                {
                  id: "award",
                  type: "award_points",
                  to: "$member",
                  points: 50,
                  memo: "Thanks",
                  on_error: "stop",
                },
              ],
              owner: "user:marketing-lead",
            }),
            "Bonus",
          ),
        ]);
        const failed = yield* call(tomas, "automation.trigger", {
          slug: "bonus",
          event: sample,
          idempotency_key: "manual-key-0003",
        });
        expect(failed).toMatchObject({
          status: "failed",
          steps_succeeded: 0,
          error: { code: "no_grant", retryable: false },
        });
        const detail = yield* call(tomas, "automation.run", { run_id: failed.run_id });
        expect(detail.steps[0]).toMatchObject({ status: "failed", attempts: 1 });
        const notFailed = yield* refusal(
          call(tomas, "automation.retry", {
            run_id: "00000000-0000-4000-8000-000000000000",
            idempotency_key: "retry-key-0001",
          }),
        );
        expect(notFailed?.code).toBe("UNKNOWN_REFERENCE");

        // fix the owner (Maya holds points:award), then retry: a new run with the same step key posts exactly one award
        const rev = (yield* status("Automation", "bonus")).revision;
        yield* commit(system, [
          {
            target: uriOf("Automation", "bonus"),
            base_revision: rev,
            ops: [{ op: "set", path: "/spec/owner", value: "user:ops-lead" }],
          },
        ]);
        const before = yield* store(
          sql<{ n: string }>`SELECT count(*)::text AS n FROM ledger_transactions WHERE txn_type = 'award'`,
        );
        const retried = yield* call(tomas, "automation.retry", {
          run_id: failed.run_id,
          idempotency_key: "retry-key-0002",
        });
        expect(retried).toMatchObject({
          status: "succeeded",
          trigger: { type: "retry", of_run: failed.run_id },
        });
        const after = yield* store(
          sql<{ n: string }>`SELECT count(*)::text AS n FROM ledger_transactions WHERE txn_type = 'award'`,
        );
        expect(Number(after[0]?.n)).toBe(Number(before[0]?.n) + 1);
        const key = yield* store(
          sql<{
            k: string;
          }>`SELECT idempotency_key AS k FROM automation_steps WHERE run_id = ${retried.run_id}`,
        );
        expect(key[0]?.k).toBe(`run:${failed.run_id}:step:award`);
        // retrying a succeeded run is refused
        const notFailedAgain = yield* refusal(
          call(tomas, "automation.retry", { run_id: retried.run_id, idempotency_key: "retry-key-0003" }),
        );
        expect(notFailedAgain?.details).toMatchObject({ reason: "INVALID_TRANSITION" });
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect(
    "event triggers match once per event, apply the filter, and a loop-suspected event is skipped",
    () =>
      Effect.gen(function* () {
        const { system } = yield* setup;
        const { sql } = yield* ControlStore;
        yield* commit(system, [
          createNode(
            "Automation",
            "thanks",
            notifyAuto({
              trigger: {
                type: "event",
                event: "order.placed",
                filter: { field: "event.requires_approval", op: "eq", value: false },
              },
              limits: {},
            }),
            "Thanks",
          ),
        ]);
        const ana = yield* Effect.flatMap(Identity, (i) => i.bySubject("user:ana-silva"));
        const placed = (
          requires: boolean,
          cause?: { automation: string; run_id: string; step_index: number; depth: number },
        ) =>
          emitDomainEvent(WS, {
            type: "order.placed",
            occurredAt: NOW,
            actor: ana,
            surface: "system",
            audience: ["*"],
            member: ana,
            payload: {
              order_id: "00000000-0000-4000-8000-0000000000aa",
              order_no: "R-000002",
              member: {
                subject: "user:ana-silva",
                handle: "ana-silva",
                display_name: "Ana Silva",
                kind: "human",
                avatar: { initials: "AS", hue: 0 },
              },
              total_points: 100,
              item_count: 1,
              requires_approval: requires,
            },
            ...(cause ? { cause } : {}),
          });
        yield* inTx(placed(false));
        yield* inTx(placed(true));
        yield* inTx(
          placed(false, {
            automation: "other",
            run_id: "00000000-0000-4000-8000-0000000000bb",
            step_index: 0,
            depth: 3,
          }),
        );
        const svc = yield* automationPrincipal();
        const evs = (yield* domainEventsAfter(WS, 0)).filter((e) => e.type === "order.placed");
        expect(evs).toHaveLength(3);
        yield* inTx(automationMatchEvents(automationEmitCtx(svc, NOW), evs));
        const runs = yield* store(
          sql<{ trigger_key: string; status: string; error: any }>`
          SELECT trigger_key, status, error FROM automation_runs ORDER BY created_at, trigger_key`,
        );
        // the filtered-out event creates no run; the loop-suspected one is recorded as skipped
        expect(runs.map((r) => r.status).sort()).toEqual(["skipped", "succeeded"]);
        expect(runs.find((r) => r.status === "skipped")?.error?.code).toBe("LOOP_SUSPECTED");
        // exactly once: delivering the same events again creates nothing
        yield* inTx(automationMatchEvents(automationEmitCtx(svc, NOW), evs));
        const n = yield* store(sql<{ n: string }>`SELECT count(*)::text AS n FROM automation_runs`);
        expect(Number(n[0]?.n)).toBe(2);
        const notes = yield* store(
          sql<{ n: string }>`SELECT count(*)::text AS n FROM notifications WHERE type = 'system'`,
        );
        expect(Number(notes[0]?.n)).toBe(1);
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("the minute tick fires a cron automation once per matching minute", () =>
    Effect.gen(function* () {
      const { system } = yield* setup;
      const { sql } = yield* ControlStore;
      yield* commit(system, [
        createNode(
          "Automation",
          "weekly",
          notifyAuto({
            trigger: { type: "schedule", cron: "0 9 * * 1" },
            steps: [
              {
                id: "nudge",
                type: "notify",
                to: ["user:ana-silva"],
                notification_type: "promotion_started",
                title: "This week",
                body: "Offers are live",
                on_error: "stop",
              },
            ],
            limits: {},
          }),
          "Weekly",
        ),
      ]);
      // Monday 2026-11-23 09:00 UTC
      yield* inTx(automationOnMinute(tick("2026-11-23T09:00:00Z"), wctx("2026-11-23T09:00:20Z")));
      yield* inTx(automationOnMinute(tick("2026-11-23T09:00:00Z"), wctx("2026-11-23T09:00:40Z")));
      yield* inTx(automationOnMinute(tick("2026-11-23T09:01:00Z"), wctx("2026-11-23T09:01:10Z")));
      const runs = yield* store(
        sql<{ trigger_key: string; status: string }>`SELECT trigger_key, status FROM automation_runs`,
      );
      expect(runs).toEqual([{ trigger_key: "cron:2026-11-23T09:00:00.000Z", status: "succeeded" }]);
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("calendar and catalogue (M16, M17)", () => {
  it.effect(
    "the calendar lists promotion windows, scheduled content and cron fires by permission; the catalogue is static",
    () =>
      Effect.gen(function* () {
        const { system, tomas, ana } = yield* setup;
        yield* commit(system, [
          createNode("Category", "apparel", {
            description: "Apparel",
            artwork: { icon: "shirt", hue: 212, pattern: "stripes" },
            sort: 10,
            status: "active",
          }),
        ]);
        yield* commit(system, [
          createNode("Promotion", "ten-off", {
            status: "draft",
            description: "ten off",
            eligibility: { channels: ["store"] },
            effects: [{ type: "store_discount", percent: 10, categories: ["category:apparel"] }],
            budget: {},
            schedule: { starts_at: "2026-11-18T00:00:00Z", ends_at: "2026-11-30T00:00:00Z" },
            priority: 1,
            stacking: "stack",
            owner: "user:marketing-lead",
          }),
          createNode("Automation", "weekly", {
            enabled: true,
            description: "weekly",
            trigger: { type: "schedule", cron: "0 9 * * 1" },
            steps: [
              {
                id: "n",
                type: "notify",
                to: ["user:ana-silva"],
                notification_type: "system",
                title: "t",
                body: "b",
                on_error: "stop",
              },
            ],
            limits: {},
            owner: "user:ops-lead",
          }),
        ]);
        const range = { from: "2026-11-16T00:00:00Z", to: "2026-11-30T00:00:00Z" };
        const asTomas = yield* call(tomas, "calendar.range", range);
        const types = new Set(asTomas.items.map((i: any) => i.type));
        expect(types.has("promotion")).toBe(true);
        expect(
          asTomas.items.filter((i: any) => i.type === "automation").map((i: any) => i.starts_at),
        ).toEqual(["2026-11-16T09:00:00.000Z", "2026-11-23T09:00:00.000Z"]);
        // a plain member sees no draft promotions and no automation fires
        const asAna = yield* call(ana, "calendar.range", range);
        expect(
          asAna.items.filter((i: any) => i.type === "promotion" || i.type === "automation"),
        ).toHaveLength(0);
        const tooWide = yield* refusal(
          call(tomas, "calendar.range", { from: "2026-01-01T00:00:00Z", to: "2026-12-31T00:00:00Z" }),
        );
        expect(tooWide?.code).toBe("VALIDATION_FAILED");
        const cat = yield* call(ana, "catalog.get", {});
        expect(cat.events.length).toBe(20);
        expect(cat.step_types).toHaveLength(6);
      }).pipe(Effect.provide(StoreLive)),
  );
});

void rows;
