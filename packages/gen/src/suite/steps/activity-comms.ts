import { createHash } from "node:crypto";
import { Effect } from "effect";
import { DEFAULT_NOTIFICATION_PREFS } from "@plinth/spec";
import {
  ControlStore,
  createNotifications,
  emitFrom,
  newId,
  store,
  type Principal,
  type SuiteEnv,
} from "@plinth/engine";
import type { SeedCtx, SeedError } from "../seed";
import { SEED_MEMBERS, type SeedMember } from "../people";
import { profileShowcase } from "./people";

/**
 * The communications part of the 90-day activity history (CONTRACT.md 11.8): about 60 message threads with about 220
 * messages (direct, group, two broadcasts by the operations lead to `all-staff`, system messages), notifications
 * (created by the handlers themselves, plus a few ad-hoc ones and the read state), 30 tasks (mixed status, 6 from
 * automations), preference and profile edits, and the held role change (Samir proposes adding Ana Silva to `manager`,
 * scoped NA, awaiting Maya). Everything is replayed through the action handlers at its own virtual timestamp, in time
 * order, and the engines drain after each command.
 */

const DAY = 86_400_000;
const MIN = 60_000;

const SUBJECTS_DIRECT = [
  "Shift swap on Thursday",
  "Question about my last order",
  "Dock 4 schedule",
  "Great work on the peak push",
  "Can you cover the early shift?",
  "Pallet labels running low",
  "Safety walk follow-up",
  "Wellness club this week",
  "Cycle count results",
  "Inbound delay from the carrier",
  "Training slot next week",
  "Returns backlog",
  "Quick favour",
  "Lunch and learn topic",
  "Equipment booking",
  "Handover notes",
  "Peak roster draft",
  "Forklift check sign-off",
  "Slotting idea for aisle 14",
  "Welcome to the team",
  "Points question",
  "Holiday cover",
  "Reporting numbers for Friday",
  "Customer escalation",
];
const BODIES_OPEN = [
  "Hi, do you have a minute to look at this when you are free?",
  "Quick one: could we move this to after the morning stand-up?",
  "Thanks for yesterday, it made a real difference to the shift.",
  "Sharing the latest numbers below. Let me know if anything looks off.",
  "Could you confirm you have what you need before Thursday?",
  "Heads up, the carrier has pushed the window by two hours.",
  "I have drafted a plan and would love your eyes on it.",
  "We are short a couple of people on nights. Any chance you can help?",
  "Following up on our chat at the dock. Notes are in the attachment.",
  "Just checking in. Is the new process working for your team?",
];
const BODIES_REPLY = [
  "Yes, that works for me.",
  "Thanks, I will pick it up first thing.",
  "Can we do 10:30 instead?",
  "Done. Let me know if you need anything else.",
  "Good catch, I will fix it today.",
  "I am on it.",
  "Happy to help. Count me in.",
  "Let me check with the team and come back to you.",
  "Perfect, thank you!",
  "Not this week, but the week after is clear.",
  "Agreed. I will add it to the board.",
  "That is great news.",
];
const SUBJECTS_GROUP = [
  "Peak season readiness",
  "Weekend overtime sign-up",
  "New pick path trial",
  "Safety reminder: wet floors",
  "Team lunch on Friday",
  "Wellness challenge week 3",
  "Carpool and shuttle changes",
  "Recognition roundup",
  "Break room refresh",
  "Cold weather gear",
  "Volunteer day sign-up",
  "Scanner updates tonight",
  "Stretch and strengthen session",
  "Quarterly region update",
];
const BODIES_GROUP = [
  "Reminder for everyone: please read the notes before your next shift.",
  "Sign-up sheet is open until Wednesday. First come, first served.",
  "We are trialling a new pick path in zone B. Feedback welcome.",
  "Great effort last week. Thank you all.",
  "Please keep walkways clear and report spills straight away.",
  "Bring a friend. All levels welcome.",
];
const SYSTEM_THREADS: ReadonlyArray<readonly [string, string]> = [
  [
    "Your weekly points summary",
    "Here is your points summary for the week. Check the Points page for the full statement.",
  ],
  ["New badge available", "A new badge is now in the catalogue. See how close you are on the Badges page."],
  ["Order update", "One of your orders has moved to the next stage. Open Orders for the timeline."],
  [
    "Points expiring soon",
    "Some of your points are about to expire. Spend them in the Store before they do.",
  ],
  ["Welcome offer is live", "A new promotion has started. Look for the banner at the top of the Store."],
  [
    "Automation run failed",
    "An automation run did not finish. Open Automations to see the failing step and retry.",
  ],
  [
    "Content ready for review",
    "An item is waiting for your review. Open the review queue to approve it or request changes.",
  ],
  ["Task assigned to you", "A task was assigned to you. Open Tasks to see the details and due date."],
];
const TASKS: ReadonlyArray<readonly [string, string]> = [
  ["Recount aisle 14 bins", "Cycle count variance above threshold. Recount and log the result."],
  ["Prepare EMEA peak roster", "Draft the peak roster and share it with the regional leads."],
  ["Review wellness club budget", "Check the quarterly spend against the plan."],
  ["Update dock 4 safety signage", "Replace faded signs and photograph the result."],
  ["Reconcile December gift card batch", "Match the batch to the ledger and flag any gaps."],
  ["Onboard new joiners", "Run the welcome session and set up their accounts."],
  ["Audit forklift inspection logs", "Confirm every unit has a signed check this week."],
  ["Draft the giving campaign announcement", "Two short paragraphs and a call to action."],
  ["Refresh the break room poster", "Swap in the new peak season poster."],
  ["Check scanner firmware", "All scanners on the latest version before Monday."],
  ["Plan the volunteer day", "Pick a charity, book transport, open sign-ups."],
  ["Follow up on carrier delay", "Get a revised ETA and update the inbound board."],
  ["Test the returns flow", "Place and return a test order, note anything confusing."],
  ["Tidy the shared drive", "Archive last year's folders and fix naming."],
  ["Write the safety walk summary", "Findings, owners and dates in one page."],
  ["Order cold weather gear", "Check sizes with the team and place the order."],
  ["Prepare Friday reporting pack", "Points issued, orders, fulfilment time."],
  ["Slotting trial for aisle 9", "Move the fast movers to the front and measure picks per hour."],
  ["Collect feedback on the new pick path", "Short survey for zone B."],
  ["Renew the first aid kits", "Check expiry dates and restock."],
  ["Set up the quiet room rota", "Weekly rota, shared on the board."],
  ["Review open approvals", "Clear anything older than three days."],
  ["Update the rewards FAQ", "Add the new expiry rules and the transfer limit."],
  ["Plan the recognition roundup", "Pick five stories and share them on Friday."],
  ["Check stock of tote bags", "Low stock on the store item; confirm a restock date."],
  ["Customer escalation follow-up", "Call back and log the outcome."],
  ["Prepare the regional update", "Numbers, wins and one ask."],
  ["Rota for holiday cover", "Make sure every shift has a lead."],
  ["Compare carrier invoices", "Spot check three weeks against the system."],
  ["Clean up old segments", "Remove segments nobody uses."],
];

const TASK_STATUS_PLAN: ReadonlyArray<"done" | "in_progress" | "open" | "blocked" | "cancelled"> = [
  ...Array(11).fill("done"),
  ...Array(6).fill("in_progress"),
  ...Array(8).fill("open"),
  ...Array(2).fill("blocked"),
  ...Array(3).fill("cancelled"),
];

interface Cmd {
  readonly at: Date;
  readonly run: Effect.Effect<void, SeedError, SuiteEnv>;
}

const hex = (s: string): string => createHash("sha256").update(s).digest("hex");

export const activityComms = (ctx: SeedCtx): Effect.Effect<void, SeedError, SuiteEnv> =>
  Effect.gen(function* () {
    const rng = ctx.rng("activity-comms");
    const start = ctx.demoNow.getTime() - 89 * DAY;
    const span = 88.9 * DAY;
    const people = new Map<string, Principal>();
    for (const m of SEED_MEMBERS) people.set(m.handle, yield* ctx.principal(m.subject));
    const as = (m: SeedMember): Principal => people.get(m.handle) as Principal;
    const byHandle = (h: string): SeedMember => SEED_MEMBERS.find((m) => m.handle === h) as SeedMember;
    const maya = byHandle("maya-ortiz");
    const samir = byHandle("samir-haddad");
    const automation = yield* ctx.principal("service:automation");
    const other = (m: SeedMember, pool: ReadonlyArray<SeedMember> = SEED_MEMBERS): SeedMember => {
      let x = rng.pick(pool);
      while (x.handle === m.handle) x = rng.pick(pool);
      return x;
    };
    /** A business-hours instant (UTC 7:00 to 19:00) in the history window. */
    const businessTime = (): Date => {
      const d = new Date(start + Math.floor(rng.float() * span));
      d.setUTCHours(7 + rng.int(12), rng.int(60), rng.int(60), 0);
      return d;
    };
    const after = (t: Date, maxMinutes: number): Date =>
      new Date(t.getTime() + (5 + rng.int(maxMinutes)) * MIN);
    const cap = (t: Date): Date =>
      t.getTime() > ctx.demoNow.getTime() - 2 * 3_600_000
        ? new Date(ctx.demoNow.getTime() - (30 + rng.int(90)) * MIN)
        : t;

    const cmds: Cmd[] = [];
    const threadIds = new Map<string, { id: string; viewers: Principal[]; last: Date }>();
    let n = 0;
    const key = (p: string): string => `seed-${p}-${++n}`;
    const act = (who: Principal, at: Date, action: string, input: Record<string, unknown>, k?: string) =>
      ctx.act(who, action, input, { at, ...(k ? { key: k } : {}) });
    const touch = (tk: string, at: Date) => {
      const t = threadIds.get(tk);
      if (t && at > t.last) t.last = at;
    };

    interface Plan {
      readonly tk: string;
      readonly at: Date;
      readonly sender: SeedMember;
      readonly to: ReadonlyArray<string>;
      readonly subject: string;
      readonly body: string;
      readonly attach?: boolean;
      readonly repliers: ReadonlyArray<SeedMember>;
      readonly replyCount: number;
      readonly viewers: ReadonlyArray<SeedMember>;
    }

    const plans: Plan[] = [];
    // ---- direct threads (36, six with attachments) ------------------------------------------------------
    for (let i = 0; i < 36; i++) {
      const sender = rng.pick(SEED_MEMBERS);
      const rcpt = other(sender);
      const body = `${rng.int(3) === 0 ? `Hi @${rcpt.handle}, ` : ""}${rng.pick(BODIES_OPEN)}`;
      plans.push({
        tk: `d${i}`,
        at: businessTime(),
        sender,
        to: [`user:${rcpt.handle}`],
        subject: SUBJECTS_DIRECT[i % SUBJECTS_DIRECT.length] as string,
        body,
        attach: i % 6 === 0,
        repliers: [rcpt, sender],
        replyCount: 1 + rng.int(5),
        viewers: [rcpt, sender],
      });
    }
    // ---- group threads (13): region groups, wellness club, peak crew by the manager ---------------------
    const REGION_GROUPS: ReadonlyArray<readonly [string, string]> = [
      ["na-ops", "NA"],
      ["emea-ops", "EMEA"],
      ["apac-ops", "APAC"],
      ["latam-ops", "LATAM"],
      ["anz-ops", "ANZ"],
    ];
    for (let i = 0; i < 13; i++) {
      const pick = i % 3;
      let group: string;
      let pool: ReadonlyArray<SeedMember>;
      if (pick === 0) {
        const [g, r] = rng.pick(REGION_GROUPS);
        group = g;
        pool = SEED_MEMBERS.filter((m) => m.region === r);
      } else if (pick === 1) {
        group = "wellness-club";
        pool = SEED_MEMBERS.filter((m) => m.index % 4 === 0);
      } else {
        group = "peak-crew";
        pool = [maya];
      }
      const sender = pick === 0 ? (pool.find((m) => m.handle === "jonas-becker") ?? maya) : maya;
      plans.push({
        tk: `g${i}`,
        at: businessTime(),
        sender,
        to: [`group:${group}`],
        subject: SUBJECTS_GROUP[i % SUBJECTS_GROUP.length] as string,
        body: rng.pick(BODIES_GROUP),
        repliers: [],
        replyCount: 0,
        viewers: [],
      });
    }
    // ---- two broadcasts by Maya to all-staff -------------------------------------------------------------
    plans.push(
      {
        tk: "b0",
        at: new Date(ctx.demoNow.getTime() - 41 * DAY + 9 * 3_600_000),
        sender: maya,
        to: ["group:all-staff"],
        subject: "Peak season kickoff",
        body: "Team, peak season starts next week. Thank you for everything you do. Rosters are on the Tasks board and the rewards programme has extra offers running all month.",
        repliers: [],
        replyCount: 0,
        viewers: [],
      },
      {
        tk: "b1",
        at: new Date(ctx.demoNow.getTime() - 9 * DAY + 8 * 3_600_000),
        sender: maya,
        to: ["group:all-staff"],
        subject: "Giving campaign starts Monday",
        body: "Every point you give to a cause is matched this month. See the Giving category in the Store and read the announcement in News.",
        repliers: [],
        replyCount: 0,
        viewers: [],
      },
    );

    // ---- schedule sends, replies and read state ------------------------------------------------------------
    const { sql } = yield* ControlStore;
    // the members of every Group node as the groups step created them
    const groupRows = yield* store(
      sql<{ slug: string; members: string[] }>`
        SELECT slug, ARRAY(SELECT jsonb_array_elements_text(body -> 'spec' -> 'members')) AS members
        FROM nodes WHERE workspace_id = ${ctx.workspaceId} AND kind = 'Group' AND deleted_at IS NULL`,
    );
    const GROUP_MEMBERS = (slug: string): ReadonlyArray<SeedMember> => {
      const subjects = new Set(groupRows.find((g) => g.slug === slug)?.members ?? []);
      return SEED_MEMBERS.filter((m) => subjects.has(m.subject));
    };
    for (const p of plans) {
      const sendAt = cap(p.at);
      const isGroup = p.to[0]?.startsWith("group:") === true;
      const groupSlug = isGroup ? (p.to[0] as string).slice(6) : "";
      cmds.push({
        at: sendAt,
        run: Effect.gen(function* () {
          const sent = (yield* act(
            as(p.sender),
            sendAt,
            "messages.send",
            {
              to: p.to,
              subject: p.subject,
              body: p.body,
              ...(p.attach
                ? {
                    attachments: [
                      {
                        file_name: `${p.subject
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/^-|-$/g, "")}.pdf`,
                        media_type: "application/pdf",
                        size_bytes: 40_000 + rng.int(900_000),
                        sha256: hex(p.tk),
                      },
                    ],
                  }
                : {}),
              idempotency_key: key("send"),
            },
            key("send-k"),
          )) as { thread_id: string };
          threadIds.set(p.tk, { id: sent.thread_id, viewers: [], last: sendAt });
        }),
      });
      // replies
      const repliers: ReadonlyArray<SeedMember> = isGroup
        ? (() => {
            const pool = GROUP_MEMBERS(groupSlug).filter((m) => m.handle !== p.sender.handle);
            return [other(p.sender, pool), other(p.sender, pool), other(p.sender, pool)];
          })()
        : p.repliers;
      const replyCount = isGroup
        ? groupSlug === "all-staff"
          ? 2 + rng.int(3)
          : 2 + rng.int(4)
        : p.replyCount;
      let t = sendAt;
      for (let r = 0; r < replyCount; r++) {
        t = cap(after(t, r === 0 ? 240 : 1400));
        const by = repliers[r % repliers.length] as SeedMember;
        const at = t;
        const body = `${rng.int(4) === 0 && r > 0 ? `Thanks @${p.sender.handle}. ` : ""}${rng.pick(BODIES_REPLY)}`;
        const k = key("reply");
        cmds.push({
          at,
          run: Effect.gen(function* () {
            const th = threadIds.get(p.tk);
            if (!th) return;
            yield* act(as(by), at, "messages.reply", { thread_id: th.id, body, idempotency_key: k }, k);
            touch(p.tk, at);
          }),
        });
      }
      // read state, star, archive, mute: a few participants act after the thread settled
      const viewers = isGroup
        ? [
            other(
              p.sender,
              GROUP_MEMBERS(groupSlug).filter((m) => m.handle !== p.sender.handle),
            ),
            other(p.sender, GROUP_MEMBERS(groupSlug)),
          ]
        : p.viewers;
      for (const v of viewers.slice(0, isGroup ? 2 : 2)) {
        const at = cap(new Date(t.getTime() + (20 + rng.int(300)) * MIN));
        const old = at.getTime() < ctx.demoNow.getTime() - 3 * DAY;
        const read = rng.float() < (old ? 0.9 : 0.35);
        const star = rng.int(9) === 0;
        const archive = old && rng.int(6) === 0;
        const mute = isGroup && rng.int(8) === 0;
        if (!read && !star && !archive && !mute) continue;
        cmds.push({
          at,
          run: Effect.gen(function* () {
            const th = threadIds.get(p.tk);
            if (!th) return;
            // only participants may change state; a viewer who is not one is skipped
            yield* act(as(v), at, "messages.state", {
              thread_id: th.id,
              ...(read ? { read: true } : {}),
              ...(star ? { starred: true } : {}),
              ...(archive ? { archived: true } : {}),
              ...(mute ? { muted: true } : {}),
            }).pipe(Effect.catchAll(() => Effect.void));
          }),
        });
      }
    }

    // ---- system messages from the automation service ---------------------------------------------------------
    for (let i = 0; i < SYSTEM_THREADS.length; i++) {
      const [subject, body] = SYSTEM_THREADS[i] as readonly [string, string];
      const rcpt = rng.pick(SEED_MEMBERS);
      const at = cap(businessTime());
      cmds.push({ at, run: systemMessage(ctx, automation, at, rcpt, subject, body) });
    }

    // ---- ad-hoc notifications from the operations lead -----------------------------------------------------------
    const adhoc: ReadonlyArray<readonly [number, string, string, string]> = [
      [
        60,
        "system",
        "Welcome to Northwind Rewards",
        "Earn points, spend them in the Store and collect badges. Start on the Home page.",
      ],
      [
        33,
        "promotion_started",
        "Peak season offers are live",
        "Extra points on selected rewards all month. See the banner in the Store.",
      ],
      [
        5,
        "system",
        "Scheduled maintenance tonight",
        "The Store will be read-only for ten minutes after midnight UTC.",
      ],
    ];
    for (const [daysAgo, type, title, body] of adhoc) {
      const at = new Date(ctx.demoNow.getTime() - daysAgo * DAY + 10 * 3_600_000);
      cmds.push({
        at,
        run: act(
          as(maya),
          at,
          "notifications.send",
          { to: ["group:all-staff"], type, title, body, link: "/store", idempotency_key: key("note") },
          key("note-k"),
        ).pipe(Effect.asVoid),
      });
    }

    // ---- tasks ---------------------------------------------------------------------------------------------------
    const managers = ["maya-ortiz", "jonas-becker"].map(byHandle);
    const statuses = [...TASK_STATUS_PLAN];
    for (let i = statuses.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [statuses[i], statuses[j]] = [
        statuses[j] as (typeof statuses)[number],
        statuses[i] as (typeof statuses)[number],
      ];
    }
    const taskIds: Array<{ idx: number; id: string }> = [];
    for (let i = 0; i < TASKS.length; i++) {
      const [title, description] = TASKS[i] as readonly [string, string];
      const final = statuses[i] as (typeof statuses)[number];
      const manager = i % 3 === 0 ? rng.pick(managers) : undefined;
      const assignee = rng.pick(
        SEED_MEMBERS.filter(
          (m) => m.department === "fulfilment" || m.department === "operations" || i % 4 === 0,
        ),
      );
      const creator = manager ?? assignee;
      const createdAt = cap(businessTime());
      const dueOffset =
        (final === "open" || final === "in_progress" || final === "blocked"
          ? 1 + rng.int(14)
          : -(1 + rng.int(20))) * DAY;
      const dueAt = new Date(
        Math.min(
          ctx.demoNow.getTime() + 20 * DAY,
          createdAt.getTime() + Math.abs(dueOffset) + (dueOffset < 0 ? 0 : 3 * DAY),
        ),
      );
      cmds.push({
        at: createdAt,
        run: Effect.gen(function* () {
          const made = (yield* act(as(creator), createdAt, "tasks.create", {
            title,
            description,
            priority: rng.pick(["low", "normal", "normal", "high", "urgent"] as const),
            due_at: dueAt.toISOString(),
            ...(manager && assignee.handle !== manager.handle ? { assignee: assignee.subject } : {}),
            idempotency_key: key("task"),
          })) as { task_id: string; version: number };
          taskIds.push({ idx: i, id: made.task_id });
          let version = made.version;
          const updater = as(manager && assignee.handle !== manager.handle ? assignee : creator);
          let t = createdAt;
          const move = (status: string) =>
            Effect.gen(function* () {
              t = cap(after(t, 2000));
              const upd = (yield* act(updater, t, "tasks.update", {
                task_id: made.task_id,
                status,
                version,
              })) as { version: number };
              version = upd.version;
            });
          if (final === "done") {
            yield* move("in_progress");
            t = cap(after(t, 600));
            yield* act(
              updater,
              t,
              "tasks.comment",
              {
                task_id: made.task_id,
                body: "Finished, notes added to the shared drive.",
                idempotency_key: key("tc"),
              },
              key("tc-k"),
            );
            yield* move("done");
          } else if (final === "in_progress") yield* move("in_progress");
          else if (final === "blocked") {
            yield* move("in_progress");
            yield* move("blocked");
            t = cap(after(t, 300));
            yield* act(
              updater,
              t,
              "tasks.comment",
              {
                task_id: made.task_id,
                body: `Waiting on @${rng.pick(managers).handle} for sign-off.`,
                idempotency_key: key("tc"),
              },
              key("tc-k"),
            );
          } else if (final === "cancelled") yield* move("cancelled");
          if (rng.int(4) === 0 && final !== "cancelled") {
            t = cap(after(t, 300));
            yield* act(
              as(creator),
              t,
              "tasks.comment",
              { task_id: made.task_id, body: "Thanks, please keep me posted.", idempotency_key: key("tc") },
              key("tc-k"),
            );
          }
        }),
      });
    }

    // ---- preference and profile edits through the real handlers -------------------------------------------
    for (let i = 0; i < 8; i++) {
      const m = rng.pick(SEED_MEMBERS);
      const at = cap(businessTime());
      cmds.push({
        at,
        run: act(as(m), at, "me.preferences.update", {
          notifications: {
            ...DEFAULT_NOTIFICATION_PREFS,
            message: { in_app: true, email: rng.int(2) === 0, digest: false },
            points_awarded: { in_app: true, email: false, digest: rng.int(2) === 0 },
          },
          digest: {
            frequency: rng.pick(["daily", "weekly", "off"] as const),
            hour_utc: 6 + rng.int(6),
            weekday: 1 + rng.int(5),
          },
          ...(rng.int(3) === 0 ? { quiet_hours: { start_hour: 21, end_hour: 6 } } : {}),
        }).pipe(Effect.asVoid),
      });
    }
    for (let i = 0; i < 4; i++) {
      const m = rng.pick(SEED_MEMBERS);
      const at = cap(businessTime());
      cmds.push({
        at,
        run: act(as(m), at, "me.profile.update", {
          bio: `${m.title}. Always up for a chat about the next peak season.`,
          location: "Working remotely this month",
        }).pipe(Effect.asVoid),
      });
    }

    // ---- run in time order --------------------------------------------------------------------------------------
    cmds.sort((a, b) => a.at.getTime() - b.at.getTime());
    for (const c of cmds) {
      yield* c.run;
      yield* ctx.drain(c.at);
    }

    // ---- six tasks come from automations (created by service:automation, with a run when one exists) -------------
    const runs = yield* store(
      sql<{
        run_id: string;
      }>`SELECT run_id FROM automation_runs WHERE workspace_id = ${ctx.workspaceId} ORDER BY created_at, run_id LIMIT 6`,
    );
    const picked = [...taskIds]
      .sort((a, b) => a.idx - b.idx)
      .filter((t) => t.idx % 5 === 2)
      .slice(0, 6);
    for (const [i, t] of picked.entries())
      yield* store(
        sql`UPDATE tasks SET source = 'automation', created_by = ${automation.id}, run_id = ${runs[i]?.run_id ?? null} WHERE task_id = ${t.id}`,
      );

    // ---- the held role change: Samir proposes adding Ana Silva to manager, scoped NA ------------------------------
    const role = yield* store(
      sql<{
        revision: string;
      }>`SELECT revision::text AS revision FROM nodes WHERE workspace_id = ${ctx.workspaceId} AND kind = 'Role' AND slug = 'manager'`,
    );
    const heldAt = new Date(ctx.demoNow.getTime() - 6 * 3_600_000);
    // the system surface bypasses approval rules; a person on the UI is held under R-ROLE
    yield* ctx.act(as(samir), "admin.role_members", {
      slug: "manager",
      add: [{ subject: byHandle("ana-silva").subject, scope: { region: "NA" } }],
      base_revision: Number(role[0]?.revision ?? 1),
      reason: "Ana is covering the NA regional lead role this quarter",
    }, { at: heldAt, surface: "ui" });
    yield* ctx.drain(heldAt);

    // ---- read state: most members cleared their feed up to two days ago, the recent ones stay unread -----------------
    const readAt = new Date(ctx.demoNow.getTime() - 2 * DAY);
    for (const m of SEED_MEMBERS) {
      if (rng.float() < 0.3) continue;
      yield* act(as(m), readAt, "notifications.read_all", {
        before: new Date(ctx.demoNow.getTime() - 3 * DAY).toISOString(),
      });
    }

    // badge showcases need the awards of the activity step: harmless when none exist yet
    yield* profileShowcase(ctx);
  });

/**
 * A system message from the automation service. The service holds no grant on the messages module (it is not a person),
 * so this writes what `messages.send` writes for a sender of kind `service`: a `system` thread, one message, receipts,
 * `message.sent`, `message.received` and the `message` notification.
 */
const systemMessage = (
  ctx: SeedCtx,
  from: Principal,
  at: Date,
  rcpt: SeedMember,
  subject: string,
  body: string,
): Effect.Effect<void, SeedError, SuiteEnv> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ctx.workspaceId;
    const to = yield* ctx.principal(rcpt.subject);
    const threadId = newId();
    const messageId = newId();
    const iso = at.toISOString();
    yield* store(
      sql`INSERT INTO message_threads (thread_id, workspace_id, subject, kind, created_by, created_at, last_message_at, message_count)
          VALUES (${threadId}, ${ws}, ${subject}, 'system', ${from.id}, ${iso}::timestamptz, ${iso}::timestamptz, 1)`,
    );
    yield* store(
      sql`INSERT INTO thread_participants (thread_id, principal_id, role, via_group, joined_at)
          VALUES (${threadId}, ${from.id}, 'from', NULL, ${iso}::timestamptz), (${threadId}, ${to.id}, 'to', NULL, ${iso}::timestamptz)`,
    );
    yield* store(
      sql`INSERT INTO messages (message_id, thread_id, workspace_id, sender_id, body, mentions, sent_at)
          VALUES (${messageId}, ${threadId}, ${ws}, ${from.id}, ${body}, '{}', ${iso}::timestamptz)`,
    );
    yield* store(
      sql`INSERT INTO message_receipts (message_id, principal_id, thread_id, read_at)
          VALUES (${messageId}, ${from.id}, ${threadId}, ${iso}::timestamptz), (${messageId}, ${to.id}, ${threadId}, NULL)`,
    );
    const ec = { principal: from, surface: "system" as const, now: at };
    yield* emitFrom(ec, "message.sent", {
      audience: [from.subject],
      subject: { kind: "thread", id: threadId },
      member: from,
      payload: { thread_id: threadId, message_id: messageId, subject, recipient_count: 1 },
    });
    const seq = yield* emitFrom(ec, "message.received", {
      audience: [to.subject],
      subject: { kind: "thread", id: threadId },
      member: to,
      payload: {
        thread_id: threadId,
        message_id: messageId,
        subject,
        preview: body.slice(0, 140),
        from: {
          subject: from.subject,
          handle: null,
          display_name: from.displayName,
          kind: "service",
          avatar: { initials: "AU", hue: 210 },
        },
        mentioned: false,
      },
    });
    yield* createNotifications(ec, {
      recipients: [to],
      type: "message",
      title: `${from.displayName}: ${subject}`.slice(0, 140),
      body: body.slice(0, 140),
      link: `/messages/t/${threadId}`,
      actorId: from.id,
      subject: { kind: "thread", id: threadId },
      sourceEventSeq: seq,
      dedupeKey: `${seq}:message`,
    });
  });
