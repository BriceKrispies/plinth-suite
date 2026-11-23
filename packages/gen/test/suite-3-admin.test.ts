import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import type { DomainError } from "@plinth/spec";
import {
  ControlStore,
  Identity,
  StoreLive,
  callAction,
  resetAndSeed,
  store,
  verifyDomainChain,
  type Principal,
} from "@plinth/engine";
import { workspaceId } from "@plinth/core";
import { ALL_STEPS, runSuiteSeed } from "../src/suite";
import { activityStep } from "../src/suite/steps/activity";
import { pagesStep } from "../src/suite/steps/pages";
import { reportingStep } from "../src/suite/steps/reporting";

// Needs Postgres (plinth_test). Approvals, admin, audit, pages and search, and the communications seed.

const WS = workspaceId("northwind");
const DEMO = new Date("2026-11-20T14:30:00Z");
const at = (minutes: number): Date => new Date(DEMO.getTime() + minutes * 60_000);
const BASE = ALL_STEPS.slice(0, 7);

const setup = (extra: typeof ALL_STEPS = []) =>
  Effect.gen(function* () {
    yield* resetAndSeed;
    yield* runSuiteSeed({ steps: [...BASE, ...extra] });
    const id = yield* Identity;
    const who = (s: string) => id.bySubject(s);
    return {
      maya: yield* who("user:ops-lead"),
      jonas: yield* who("user:emea-lead"),
      samir: yield* who("user:it-admin"),
      ana: yield* who("user:ana-silva"),
      ben: yield* who("user:ben-carter"),
    };
  });

const run = (p: Principal, name: string, input: Record<string, unknown>, minutes = 0) =>
  callAction(p, name, input, { surface: "ui", at: at(minutes) });

const refused = <A, E>(eff: Effect.Effect<A, E, any>) =>
  eff.pipe(
    Effect.either,
    Effect.map((r) => (Either.isLeft(r) ? (r.left as unknown as DomainError) : undefined)),
  );

const q = <T extends object>(text: string, ...params: unknown[]) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    return yield* store(sql.unsafe<T>(text, params as never));
  });

type Held = { status: string; approval_id?: string; rule_id: string[] };
type Item = {
  type: string;
  id: string;
  status: string;
  can_decide: boolean;
  blocked_reason: string | null;
  summary: string;
  requested_by: { subject: string };
};

describe("approvals and admin roles (CONTRACT 12.7, 12.9)", () => {
  it.effect(
    "a held role change reaches the approvers' inbox, the proposer cannot decide it, a second admin can",
    () =>
      Effect.gen(function* () {
        const { maya, samir, ben } = yield* setup();
        const rev = yield* q<{ revision: string }>(
          `SELECT revision::text AS revision FROM nodes WHERE kind = 'Role' AND slug = 'manager'`,
        );
        const held = (yield* run(samir, "admin.role_members", {
          slug: "manager",
          add: [{ subject: "user:ana-silva", scope: { region: "NA" } }],
          base_revision: Number(rev[0]?.revision),
          reason: "Ana covers the NA regional lead role",
        })) as Held;
        expect(held.status).toBe("pending_approval");
        expect(held.rule_id).toContain("R-ROLE");
        const id = held.approval_id as string;
        // the approvers are told through an approval_request notification and the event
        const note = yield* q<{ n: string }>(
          `SELECT count(*)::text AS n FROM notifications n JOIN principals p ON p.principal_id = n.recipient_id
         WHERE n.type = 'approval_request' AND p.subject = 'user:ops-lead'`,
        );
        expect(Number(note[0]?.n)).toBe(1);
        const inbox = (yield* run(maya, "approvals.list", {})) as {
          items: Item[];
          counts: Record<string, number>;
        };
        expect(inbox.items).toHaveLength(1);
        expect(inbox.items[0]).toMatchObject({
          type: "change",
          id,
          status: "pending_approval",
          can_decide: true,
        });
        expect(inbox.counts["change"]).toBe(1);
        // the proposer sees it under requested, never under to_decide, and is blocked by separation of duties
        const mine = (yield* run(samir, "approvals.list", { scope: "requested" })) as { items: Item[] };
        expect(mine.items[0]?.can_decide).toBe(false);
        expect(mine.items[0]?.blocked_reason).toBe("sod_requester");
        expect(((yield* run(samir, "approvals.list", {})) as { items: Item[] }).items).toHaveLength(0);
        const self = yield* refused(
          run(samir, "approvals.decide", { type: "change", id, decision: "approve" }, 1),
        );
        expect(self?.details).toMatchObject({ reason: "SELF_ACTION" });
        // a member without approval rights cannot decide
        const denied = yield* refused(
          run(ben, "approvals.decide", { type: "change", id, decision: "approve" }, 1),
        );
        expect(denied?.code).toBe("FORBIDDEN");
        // the second administrator approves; the role now lists Ana with her scope and the proposer is told
        const decided = (yield* run(
          maya,
          "approvals.decide",
          { type: "change", id, decision: "approve" },
          2,
        )) as Item;
        expect(decided.status).toBe("approved");
        const role = yield* q<{ members: Array<{ subject: string; scope?: { region: string } }> }>(
          `SELECT body -> 'spec' -> 'members' AS members FROM nodes WHERE kind = 'Role' AND slug = 'manager'`,
        );
        expect(role[0]?.members).toEqual(
          expect.arrayContaining([{ subject: "user:ana-silva", scope: { region: "NA" } }]),
        );
        const told = yield* q<{ n: string }>(
          `SELECT count(*)::text AS n FROM notifications n JOIN principals p ON p.principal_id = n.recipient_id
         WHERE n.type = 'approval_decision' AND p.subject = 'user:it-admin'`,
        );
        expect(Number(told[0]?.n)).toBe(1);
        const again = yield* refused(
          run(maya, "approvals.decide", { type: "change", id, decision: "reject" }, 3),
        );
        expect(again?.details).toMatchObject({ reason: "INVALID_TRANSITION" });
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("the requester withdraws a pending change; rejecting leaves the role untouched", () =>
    Effect.gen(function* () {
      const { maya, samir } = yield* setup();
      const rev = yield* q<{ revision: string }>(
        `SELECT revision::text AS revision FROM nodes WHERE kind = 'Role' AND slug = 'finance'`,
      );
      const held = (yield* run(samir, "admin.role_members", {
        slug: "finance",
        add: [{ subject: "user:ben-carter" }],
        base_revision: Number(rev[0]?.revision),
        reason: "test",
      })) as Held;
      const withdrawn = (yield* run(samir, "approvals.withdraw", {
        type: "change",
        id: held.approval_id as string,
      })) as Item;
      expect(withdrawn.status).toBe("withdrawn");
      const other = yield* refused(
        run(maya, "approvals.withdraw", { type: "change", id: held.approval_id as string }),
      );
      expect(other?.details).toMatchObject({ reason: "INVALID_TRANSITION" });
      const rev2 = yield* q<{ revision: string }>(
        `SELECT revision::text AS revision FROM nodes WHERE kind = 'Role' AND slug = 'finance'`,
      );
      const held2 = (yield* run(
        samir,
        "admin.role_members",
        {
          slug: "finance",
          add: [{ subject: "user:ben-carter" }],
          base_revision: Number(rev2[0]?.revision),
          reason: "again",
        },
        1,
      )) as Held;
      const rejected = (yield* run(
        maya,
        "approvals.decide",
        { type: "change", id: held2.approval_id as string, decision: "reject", reason: "not now" },
        2,
      )) as Item;
      expect(rejected.status).toBe("rejected");
      const role = yield* q<{ n: string }>(
        `SELECT jsonb_array_length(body -> 'spec' -> 'members')::text AS n FROM nodes WHERE kind = 'Role' AND slug = 'finance'`,
      );
      expect(Number(role[0]?.n)).toBe(1);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect(
    "member_create provisions the person, the account and the preference, and holds the role change",
    () =>
      Effect.gen(function* () {
        const { maya, samir } = yield* setup();
        const input = {
          handle: "new-hire",
          display_name: "Nia Hire",
          email: "nia.hire@northwind.example",
          title: "Picker",
          department: "fulfilment",
          region: "ANZ",
          location: "Auckland, NZ",
        };
        const made = (yield* run(maya, "admin.member_create", input)) as {
          person: { handle: string };
          account: string;
          preference_uri: string;
          role_change: Held;
        };
        expect(made.person.handle).toBe("new-hire");
        expect(made.role_change.status).toBe("pending_approval");
        const rows = yield* q<{ n: string }>(
          `SELECT (SELECT count(*) FROM members WHERE handle = 'new-hire') + (SELECT count(*) FROM ledger_accounts WHERE code = 'member:new-hire')
              + (SELECT count(*) FROM nodes WHERE kind = 'Preference' AND slug = 'prefs.new-hire') AS n`,
        );
        expect(Number(rows[0]?.n)).toBe(3);
        const dup = yield* refused(run(maya, "admin.member_create", { ...input, handle: "new-hire-2" }, 1));
        expect(dup?.details).toMatchObject({ reason: "ALREADY_EXISTS" });
        // a second administrator approves, and only then is the member in the member role
        yield* run(
          samir,
          "approvals.decide",
          { type: "change", id: made.role_change.approval_id as string, decision: "approve" },
          2,
        );
        const role = yield* q<{ has: boolean }>(
          `SELECT body -> 'spec' -> 'members' @> '[{"subject":"user:new-hire"}]'::jsonb AS has FROM nodes WHERE kind = 'Role' AND slug = 'member'`,
        );
        expect(role[0]?.has).toBe(true);
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect(
    "member_status disables, revokes sessions, refuses self-action and the audit trail shows it",
    () =>
      Effect.gen(function* () {
        const { maya, jonas, ana } = yield* setup();
        const open = yield* q<{ n: string }>(
          `SELECT count(*)::text AS n FROM member_sessions s JOIN members m ON m.member_id = s.principal_id WHERE m.handle = 'ana-silva' AND s.revoked_at IS NULL`,
        );
        const r = (yield* run(maya, "admin.member_status", {
          handle: "ana-silva",
          status: "disabled",
          reason: "left the company",
        })) as { sessions_revoked: number };
        expect(r.sessions_revoked).toBe(Number(open[0]?.n));
        yield* run(
          maya,
          "admin.member_status",
          { handle: "jakob-meyer", status: "disabled", reason: "left the company" },
          1,
        );
        const self = yield* refused(
          run(maya, "admin.member_status", { handle: "maya-ortiz", status: "disabled", reason: "oops" }, 2),
        );
        expect(self?.details).toMatchObject({ reason: "SELF_ACTION" });
        const list = (yield* run(maya, "admin.members", { status: "disabled" })) as {
          items: Array<{ person: { handle: string } }>;
          total: number;
        };
        expect(list.items.map((m) => m.person.handle).sort()).toEqual(["ana-silva", "jakob-meyer"]);
        const sessions = (yield* run(maya, "admin.sessions", { member: "ana-silva", active_only: true })) as {
          items: unknown[];
        };
        expect(sessions.items).toHaveLength(0);
        yield* run(maya, "admin.member_status", { handle: "ana-silva", status: "active", reason: "back" }, 3);
        expect(((yield* run(maya, "admin.members", { status: "disabled" })) as { total: number }).total).toBe(
          1,
        );
        void ana;
        // a regional manager's audit view only reaches events about members in the region
        const ev = (yield* run(jonas, "audit.events", { types: ["member.updated"] })) as {
          items: Array<{ payload: { member: string } }>;
        };
        expect(ev.items.length).toBeGreaterThan(0);
        expect(ev.items.every((e) => e.payload.member === "jakob-meyer")).toBe(true);
        // the full timeline merges changes and events newest first; both chains verify
        const tl = (yield* run(maya, "audit.timeline", { limit: 100 })) as {
          items: Array<{ source: string; at: string; summary: string }>;
        };
        expect(new Set(tl.items.map((i) => i.source))).toEqual(new Set(["change", "event"]));
        const times = tl.items.map((i) => i.at);
        expect([...times].sort().reverse()).toEqual(times);
        const v = (yield* run(maya, "audit.verify", {})) as {
          changes: { ok: boolean };
          domain: { ok: boolean; checked: number };
        };
        expect(v.changes.ok).toBe(true);
        expect(v.domain.ok).toBe(true);
        expect(v.domain.checked).toBeGreaterThan(0);
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("roles, effective permissions and the matrix describe the seeded grants", () =>
    Effect.gen(function* () {
      const { maya } = yield* setup();
      const roles = (yield* run(maya, "admin.roles", {})) as {
        items: Array<{ node: { slug: string }; members: unknown[]; grants: unknown[]; system: boolean }>;
      };
      expect(roles.items.map((r) => r.node.slug).sort()).toEqual([
        "admin",
        "content-editor",
        "finance",
        "manager",
        "marketing-manager",
        "member",
      ]);
      expect(roles.items.find((r) => r.node.slug === "member")?.members).toHaveLength(40);
      expect(roles.items.every((r) => r.system && r.grants.length > 0)).toBe(true);
      const perms = (yield* run(maya, "admin.permissions", { principal: "user:emea-lead" })) as {
        roles: string[];
        permissions: Array<{ permission: string; row_predicate: string | null }>;
      };
      expect(perms.roles).toEqual(expect.arrayContaining(["manager", "member"]));
      expect(perms.permissions.find((p) => p.permission === "points:award")?.row_predicate).toBe(
        "region = 'EMEA'",
      );
      const m = (yield* run(maya, "admin.matrix", {})) as {
        roles: string[];
        cells: Record<string, Record<string, string[]>>;
        agent_ceiling: string[];
      };
      expect(m.roles).toContain("manager");
      expect(m.cells["points:award"]?.["manager"]).toEqual(["suite/"]);
      expect(m.cells["points:award"]?.["member"]).toEqual([]);
      expect(m.agent_ceiling.length).toBeGreaterThan(0);
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("pages and widgets (CONTRACT 5A.4)", () => {
  it.effect(
    "pages resolve by route with parameters, personal copies win and the catalogue marks availability",
    () =>
      Effect.gen(function* () {
        const { maya, ana, ben } = yield* setup([reportingStep, pagesStep]);
        const p = (yield* run(ana, "pages.resolve", { path: "/store/p/fleece-quarter-zip" })) as {
          page: { slug: string };
          params: Record<string, string>;
          items: Array<{ widget: string; available: boolean }>;
        };
        expect(p.page.slug).toBe("store-product");
        expect(p.params).toEqual({ product: "fleece-quarter-zip" });
        expect(p.items.map((i) => i.widget)).toEqual(["store.product", "store.cart", "store.featured"]);
        expect(
          ((yield* run(ana, "pages.resolve", { path: "/people/maya-ortiz" })) as { page: { slug: string } })
            .page.slug,
        ).toBe("profile");
        expect(
          ((yield* run(ana, "pages.resolve", { path: "/d/engagement" })) as { page: { slug: string } }).page
            .slug,
        ).toBe("report-engagement");
        const q1 = (yield* run(ana, "pages.resolve", { path: "/search?q=peak" })) as {
          params: Record<string, string>;
        };
        expect(q1.params).toEqual({ q: "peak" });
        const missing = yield* refused(run(ana, "pages.resolve", { path: "/no/such/place" }));
        expect(missing?.code).toBe("UNKNOWN_REFERENCE");
        // the reports page is there for everyone, but a member may not run queries: the widget is flagged
        const reports = (yield* run(ana, "pages.resolve", { path: "/reports" })) as {
          items: Array<{ widget: string; available: boolean; unavailable_reason: string | null }>;
        };
        // programme KPIs need suite:use (every member); the board needs query:run (CONTRACT 5A.3)
        expect(reports.items.map((i) => [i.widget, i.available, i.unavailable_reason])).toEqual([
          ["reporting.suite-kpis", true, null],
          ["reporting.board", false, "forbidden"],
        ]);
        // Maya's seeded personal home wins for her only
        const mayaHome = (yield* run(maya, "pages.resolve", { path: "/" })) as {
          page: { slug: string };
          personal_of: { slug: string } | null;
          editable: boolean;
        };
        expect(mayaHome.page.slug).toBe("home.maya-ortiz");
        expect(mayaHome.personal_of?.slug).toBe("home");
        expect(mayaHome.editable).toBe(true);
        const benHome = (yield* run(ben, "pages.resolve", { path: "/" })) as {
          page: { slug: string };
          personal_of: unknown;
          editable: boolean;
          items: unknown[];
        };
        expect(benHome).toMatchObject({ page: { slug: "home" }, personal_of: null, editable: false });
        expect(benHome.items).toHaveLength(9);
        const cat = (yield* run(ana, "widgets.catalog", { domain: "admin", include_schemas: true })) as {
          items: Array<{ id: string; available: boolean; config_schema: unknown }>;
        };
        expect(cat.items.length).toBeGreaterThan(0);
        // admin widgets need admin:* except the programme editor, which is suite:use (CONTRACT 5A.3)
        expect(cat.items.every((w) => w.config_schema !== null)).toBe(true);
        expect(cat.items.filter((w) => w.available).map((w) => w.id)).toEqual(["admin.program"]);
        const own = (yield* run(ana, "widgets.catalog", { domain: "points" })) as {
          items: Array<{ id: string; available: boolean }>;
        };
        expect(own.items.find((w) => w.id === "points.balance")?.available).toBe(true);
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect(
    "personalize copies a shared page and its widgets, is idempotent, and reset removes the copy",
    () =>
      Effect.gen(function* () {
        const { ana, ben } = yield* setup([reportingStep, pagesStep]);
        const made = (yield* run(ben, "pages.personalize", { page: "home" })) as {
          page: { slug: string };
          widgets: unknown[];
        };
        expect(made.page.slug).toBe("home.ben-carter");
        expect(made.widgets).toHaveLength(9);
        const again = (yield* run(ben, "pages.personalize", { page: "home" }, 1)) as {
          page: { slug: string };
        };
        expect(again.page.slug).toBe("home.ben-carter");
        const n = yield* q<{ n: string }>(
          `SELECT count(*)::text AS n FROM nodes WHERE kind = 'Widget' AND slug LIKE '%.ben-carter' AND deleted_at IS NULL`,
        );
        expect(Number(n[0]?.n)).toBe(9);
        const served = (yield* run(ben, "pages.resolve", { path: "/" }, 2)) as {
          page: { slug: string };
          editable: boolean;
        };
        expect(served).toMatchObject({ page: { slug: "home.ben-carter" }, editable: true });
        // others do not list it
        const list = (yield* run(ana, "pages.list", {})) as {
          items: Array<{ page: { slug: string }; kind: string }>;
        };
        expect(list.items.some((i) => i.page.slug === "home.ben-carter")).toBe(false);
        expect(list.items.filter((i) => i.kind === "module").length).toBeGreaterThan(30);
        const gone = (yield* run(ben, "pages.reset", { page: "home" }, 3)) as { deleted: unknown[] };
        expect(gone.deleted).toHaveLength(10);
        expect(
          ((yield* run(ben, "pages.resolve", { path: "/" }, 4)) as { page: { slug: string } }).page.slug,
        ).toBe("home");
        const none = yield* refused(run(ben, "pages.reset", { page: "home" }, 5));
        expect(none?.code).toBe("UNKNOWN_REFERENCE");
      }).pipe(Effect.provide(StoreLive)),
  );
});

describe("site build (CONTRACT 5A.5)", () => {
  it.effect(
    "clear empties the site, it is rebuilt page by page and widget by widget, and the look is switchable",
    () =>
      Effect.gen(function* () {
        const { samir, ana } = yield* setup([reportingStep, pagesStep]);
        expect((yield* refused(run(ana, "site.clear", {})))?.code).toBe("FORBIDDEN");
        const cleared = (yield* run(samir, "site.clear", {})) as Record<string, unknown>;
        expect(JSON.stringify(cleared)).toMatch(/\d/);
        const live = yield* q<{ n: string }>(
          `SELECT count(*)::text AS n FROM nodes WHERE kind IN ('Page', 'Widget') AND deleted_at IS NULL`,
        );
        expect(Number(live[0]?.n)).toBe(0);
        const empty = (yield* run(ana, "pages.list", {}, 1)) as { items: unknown[] };
        expect(empty.items).toHaveLength(0);

        // build home by hand, one widget at a time
        yield* run(
          samir,
          "site.page.put",
          {
            slug: "home",
            title: "Home",
            route: "/",
            kind: "home",
            nav: { section: "personal", label: "Home", icon: "home" },
          },
          2,
        );
        const a = (yield* run(
          samir,
          "site.widget.add",
          { page: "home", widget: "points.balance", config: { member: "$me" } },
          3,
        )) as {
          at: { x: number; y: number };
        };
        const b = (yield* run(
          samir,
          "site.widget.add",
          { page: "home", widget: "badges.progress", config: { member: "$me" } },
          4,
        )) as {
          at: { x: number; y: number };
        };
        expect(a.at).not.toEqual(b.at);
        const home = (yield* run(ana, "pages.resolve", { path: "/" }, 5)) as { items: unknown[] };
        expect(home.items).toHaveLength(2);

        // the remaining defaults come back in stages, the cleared system pages revived
        yield* run(samir, "site.restore", { pages: ["messages", "notifications"] }, 6);
        const some = (yield* run(ana, "pages.list", {}, 7)) as { items: Array<{ page: { slug: string } }> };
        expect(some.items.map((i) => i.page.slug).sort()).toEqual(["home", "messages", "notifications"]);
        yield* run(samir, "site.restore", {}, 8);
        const all = (yield* run(ana, "pages.list", {}, 9)) as { items: unknown[] };
        expect(all.items.length).toBeGreaterThan(30);

        expect(yield* run(ana, "site.appearance.get", {}, 10)).toMatchObject({
          appearance: { look: "calm" },
        });
        yield* run(samir, "site.appearance.set", { look: "nocturne", density: "compact" }, 11);
        expect(yield* run(ana, "site.appearance.get", {}, 12)).toMatchObject({
          appearance: { look: "nocturne", density: "compact", experience: "classic" },
        });

        // the experience flips alone, the look and density stay; a bad value and an empty set are refused
        yield* run(samir, "site.appearance.set", { experience: "town" }, 13);
        expect(yield* run(ana, "site.appearance.get", {}, 14)).toMatchObject({
          appearance: { look: "nocturne", density: "compact", experience: "town" },
        });
        yield* run(samir, "site.appearance.set", { look: "folio" }, 15);
        expect(yield* run(ana, "site.appearance.get", {}, 16)).toMatchObject({
          appearance: { look: "folio", density: "comfortable", experience: "town" },
        });
        expect(yield* refused(run(samir, "site.appearance.set", { experience: "vr" }, 17))).toBeDefined();
        expect(yield* refused(run(samir, "site.appearance.set", {}, 18))).toBeDefined();
        expect(yield* refused(run(ana, "site.appearance.set", { experience: "classic" }, 19))).toBeDefined();
        yield* run(samir, "site.appearance.set", { experience: "classic" }, 20);
        expect(yield* run(ana, "site.appearance.get", {}, 21)).toMatchObject({
          appearance: { look: "folio", experience: "classic" },
        });
      }).pipe(Effect.provide(StoreLive)),
  );
});

describe("search (CONTRACT 12.10)", () => {
  it.effect("groups hits by type, ranks prefix over substring and keeps threads private", () =>
    Effect.gen(function* () {
      const { ana, ben, jonas } = yield* setup();
      const r = (yield* run(ana, "search.global", { q: "maya" })) as {
        groups: Array<{ type: string; total: number; items: Array<{ href: string; title: string }> }>;
      };
      expect(r.groups.find((g) => g.type === "person")?.items[0]).toMatchObject({
        href: "/people/maya-ortiz",
        title: "Maya Ortiz",
      });
      const w = (yield* run(ana, "search.global", { q: "well", types: ["group"] })) as {
        groups: Array<{ type: string; items: Array<{ id: string }> }>;
      };
      expect(w.groups[0]?.items.map((i) => i.id)).toEqual(["wellness-club"]);
      yield* run(ana, "messages.send", {
        to: ["user:ben-carter"],
        subject: "Peak roster draft",
        body: "see attached",
        idempotency_key: "t3:search:1",
      });
      const mine = (yield* run(ben, "search.global", { q: "roster", types: ["thread"] })) as {
        groups: Array<{ items: unknown[] }>;
      };
      expect(mine.groups[0]?.items).toHaveLength(1);
      const other = (yield* run(jonas, "search.global", { q: "roster", types: ["thread"] })) as {
        groups: unknown[];
      };
      expect(other.groups).toHaveLength(0);
      // a member may not find automations or segments
      const hidden = (yield* run(ana, "search.global", { q: "a", types: ["automation", "segment"] })) as {
        groups: unknown[];
      };
      expect(hidden.groups).toHaveLength(0);
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("seeded communications history (CONTRACT 11.8)", () => {
  it.effect("about 60 threads, 220 messages, 30 tasks, one held role change, and both chains verify", () =>
    Effect.gen(function* () {
      yield* setup([activityStep]);
      const count = (sql: string) => q<{ n: string }>(sql).pipe(Effect.map((r) => Number(r[0]?.n)));
      const threads = yield* count(`SELECT count(*)::text AS n FROM message_threads`);
      const messages = yield* count(`SELECT count(*)::text AS n FROM messages`);
      expect(threads).toBeGreaterThanOrEqual(55);
      expect(threads).toBeLessThanOrEqual(70);
      expect(messages).toBeGreaterThanOrEqual(180);
      expect(messages).toBeLessThanOrEqual(280);
      expect(
        yield* count(`SELECT count(*)::text AS n FROM message_threads WHERE kind = 'broadcast'`),
      ).toBeGreaterThanOrEqual(2);
      expect(yield* count(`SELECT count(*)::text AS n FROM message_threads WHERE kind = 'system'`)).toBe(8);
      expect(yield* count(`SELECT count(*)::text AS n FROM tasks`)).toBe(30);
      expect(yield* count(`SELECT count(*)::text AS n FROM tasks WHERE source = 'automation'`)).toBe(6);
      expect(yield* count(`SELECT count(DISTINCT status)::text AS n FROM tasks`)).toBeGreaterThanOrEqual(4);
      expect(
        yield* count(`SELECT count(*)::text AS n FROM change_approvals WHERE status = 'pending_approval'`),
      ).toBe(1);
      expect(yield* count(`SELECT count(*)::text AS n FROM notifications`)).toBeGreaterThan(150);
      // recent notifications stay unread, older ones are mostly read
      expect(
        yield* count(`SELECT count(*)::text AS n FROM notifications WHERE read_at IS NULL`),
      ).toBeGreaterThan(0);
      expect((yield* verifyDomainChain(WS)).ok).toBe(true);
    }).pipe(Effect.provide(StoreLive)),
  );
});
