import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { DEFAULT_NOTIFICATION_PREFS, type DomainError } from "@plinth/spec";
import {
  ControlStore,
  Identity,
  StoreLive,
  callAction,
  resetAndSeed,
  store,
  type Principal,
} from "@plinth/engine";
import { ALL_STEPS, runSuiteSeed } from "../src/suite";

// Needs Postgres (plinth_test). Messages, notifications, tasks, people and me, through the real dispatcher and handlers.

const DEMO = new Date("2026-11-20T14:30:00Z");
const at = (minutes: number): Date => new Date(DEMO.getTime() + minutes * 60_000);

/** People, roles, preferences, groups and opening balances: enough for the communications modules. */
const BASE = ALL_STEPS.slice(0, 7);

const setup = Effect.gen(function* () {
  yield* resetAndSeed;
  yield* runSuiteSeed({ steps: BASE });
  const id = yield* Identity;
  const who = (s: string) => id.bySubject(s);
  return {
    maya: yield* who("user:ops-lead"),
    jonas: yield* who("user:emea-lead"),
    ana: yield* who("user:ana-silva"),
    ben: yield* who("user:ben-carter"),
    chloe: yield* who("user:chloe-nguyen"),
  };
});

const run = (p: Principal, name: string, input: Record<string, unknown>, minutes = 0) =>
  callAction(p, name, input, { surface: "ui", at: at(minutes) });

const refused = <A, E>(eff: Effect.Effect<A, E, never> | Effect.Effect<A, E, any>) =>
  eff.pipe(
    Effect.either,
    Effect.map((r) => (Either.isLeft(r) ? (r.left as unknown as DomainError) : undefined)),
  );

const q = <T extends object>(text: string, ...params: unknown[]) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    return yield* store(sql.unsafe<T>(text, params as never));
  });

const notificationsOf = (handle: string, type?: string) =>
  q<{ type: string; title: string; read_at: string | null }>(
    `SELECT n.type, n.title, n.read_at::text FROM notifications n JOIN members m ON m.member_id = n.recipient_id
     WHERE m.handle = $1 ${type ? "AND n.type = $2" : ""} ORDER BY n.created_at, n.notification_id`,
    ...(type ? [handle, type] : [handle]),
  );

type Sent = { thread_id: string; message_id: string; recipient_count: number };

describe("messages (CONTRACT 12.2)", () => {
  it.effect("a send creates receipts, a mention notification and a thread both sides can read", () =>
    Effect.gen(function* () {
      const { ana, ben } = yield* setup;
      const sent = (yield* run(ana, "messages.send", {
        to: ["user:ben-carter"],
        subject: "Shift swap",
        body: "Hi @ben-carter, can you swap Thursday with me?",
        idempotency_key: "t3:msg:1",
      })) as Sent;
      expect(sent.recipient_count).toBe(1);
      const receipts = yield* q<{ handle: string; read: boolean }>(
        `SELECT m.handle, (r.read_at IS NOT NULL) AS read FROM message_receipts r JOIN members m ON m.member_id = r.principal_id
         WHERE r.message_id = $1 ORDER BY m.handle`,
        sent.message_id,
      );
      expect(receipts).toEqual([
        { handle: "ana-silva", read: true },
        { handle: "ben-carter", read: false },
      ]);
      // a mentioned participant gets `mention` instead of `message`
      expect((yield* notificationsOf("ben-carter")).map((n) => n.type)).toEqual(["mention"]);
      const inbox = (yield* run(ben, "messages.list", {})) as {
        items: Array<{ unread_count: number; kind: string }>;
        folder_counts: { inbox_unread: number };
      };
      expect(inbox.items).toHaveLength(1);
      expect(inbox.items[0]).toMatchObject({ unread_count: 1, kind: "direct" });
      expect(inbox.folder_counts.inbox_unread).toBe(1);
      // opening the thread does not mark it read; the state action does
      const t = (yield* run(ben, "messages.thread", { thread_id: sent.thread_id })) as {
        messages: Array<{ read_by_me: boolean }>;
      };
      expect(t.messages[0]?.read_by_me).toBe(false);
      yield* run(ben, "messages.state", { thread_id: sent.thread_id, read: true });
      const after = (yield* run(ben, "messages.thread", { thread_id: sent.thread_id })) as {
        messages: Array<{ read_by_me: boolean }>;
      };
      expect(after.messages[0]?.read_by_me).toBe(true);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("a reply un-archives the thread for recipients and a stranger is NOT_PARTICIPANT", () =>
    Effect.gen(function* () {
      const { ana, ben, chloe } = yield* setup;
      const sent = (yield* run(ana, "messages.send", {
        to: ["user:ben-carter"],
        subject: "Dock 4",
        body: "Schedule attached.",
        idempotency_key: "t3:msg:2",
      })) as Sent;
      yield* run(ben, "messages.state", { thread_id: sent.thread_id, archived: true }, 1);
      const archived = (yield* run(ben, "messages.list", { folder: "archived" })) as { items: unknown[] };
      expect(archived.items).toHaveLength(1);
      yield* run(
        ana,
        "messages.reply",
        { thread_id: sent.thread_id, body: "Any news?", idempotency_key: "t3:reply:2" },
        2,
      );
      const inbox = (yield* run(ben, "messages.list", {})) as { items: Array<{ thread_id: string }> };
      expect(inbox.items.map((i) => i.thread_id)).toContain(sent.thread_id);
      const e = yield* refused(run(chloe, "messages.thread", { thread_id: sent.thread_id }));
      expect(e?.details).toMatchObject({ reason: "NOT_PARTICIPANT" });
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("muted threads notify only on mention; recipients with every channel off get no row", () =>
    Effect.gen(function* () {
      const { ana, ben } = yield* setup;
      const sent = (yield* run(ana, "messages.send", {
        to: ["user:ben-carter"],
        subject: "Muted",
        body: "first",
        idempotency_key: "t3:msg:3",
      })) as Sent;
      expect(yield* notificationsOf("ben-carter", "message")).toHaveLength(1);
      yield* run(ben, "messages.state", { thread_id: sent.thread_id, muted: true }, 1);
      yield* run(
        ana,
        "messages.reply",
        { thread_id: sent.thread_id, body: "second", idempotency_key: "t3:reply:3a" },
        2,
      );
      expect(yield* notificationsOf("ben-carter", "message")).toHaveLength(1);
      yield* run(
        ana,
        "messages.reply",
        { thread_id: sent.thread_id, body: "@ben-carter are you there?", idempotency_key: "t3:reply:3b" },
        3,
      );
      expect(yield* notificationsOf("ben-carter", "mention")).toHaveLength(1);
      // every channel off for message: no row at all
      yield* run(
        ben,
        "me.preferences.update",
        {
          notifications: {
            ...DEFAULT_NOTIFICATION_PREFS,
            message: { in_app: false, email: false, digest: false },
          },
        },
        4,
      );
      const other = (yield* run(
        ana,
        "messages.send",
        { to: ["user:ben-carter"], subject: "Quiet", body: "no ping", idempotency_key: "t3:msg:3c" },
        5,
      )) as Sent;
      expect(other.recipient_count).toBe(1);
      expect(yield* notificationsOf("ben-carter", "message")).toHaveLength(1);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("closed groups, broadcast limits and idempotent sends", () =>
    Effect.gen(function* () {
      const { maya, ana } = yield* setup;
      // all-staff is closed to posting for a member
      const closed = yield* refused(
        run(ana, "messages.send", {
          to: ["group:all-staff"],
          subject: "Hi all",
          body: "x",
          idempotency_key: "t3:msg:4a",
        }),
      );
      expect(closed?.details).toMatchObject({ reason: "NOT_ELIGIBLE" });
      // peak-crew is open but reaches the broadcast minimum, which needs messages:broadcast
      const big = yield* refused(
        run(ana, "messages.send", {
          to: ["group:peak-crew"],
          subject: "Crew",
          body: "x",
          idempotency_key: "t3:msg:4b",
        }),
      );
      expect(big?.code).toBe("RULE_REFUSED");
      expect(big?.details).toMatchObject({ reason: "LIMIT_EXCEEDED", permission: "messages:broadcast" });
      // the operations lead may broadcast to everyone; groups expand once, the sender is removed
      const b = (yield* run(maya, "messages.send", {
        to: ["group:all-staff"],
        subject: "Kickoff",
        body: "Welcome",
        idempotency_key: "t3:msg:4c",
      })) as Sent;
      expect(b.recipient_count).toBe(39);
      const kind = yield* q<{ kind: string }>(
        `SELECT kind FROM message_threads WHERE thread_id = $1`,
        b.thread_id,
      );
      expect(kind[0]?.kind).toBe("broadcast");
      // the same key returns the stored result and creates nothing new
      const again = (yield* run(maya, "messages.send", {
        to: ["group:all-staff"],
        subject: "Kickoff",
        body: "Welcome",
        idempotency_key: "t3:msg:4c",
      })) as Sent;
      expect(again.thread_id).toBe(b.thread_id);
      expect(
        (yield* q<{ n: string }>(
          `SELECT count(*)::text AS n FROM message_threads WHERE subject = 'Kickoff'`,
        ))[0]?.n,
      ).toBe("1");
      const changed = yield* refused(
        run(maya, "messages.send", {
          to: ["group:all-staff"],
          subject: "Kickoff",
          body: "Other",
          idempotency_key: "t3:msg:4c",
        }),
      );
      expect(changed?.code).toBe("IDEMPOTENCY_KEY_REUSED");
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("a disabled recipient is refused by name and recipients search finds people and groups", () =>
    Effect.gen(function* () {
      const { ana } = yield* setup;
      yield* q(`UPDATE principals SET disabled_at = now() WHERE subject = 'user:chloe-nguyen'`);
      const e = yield* refused(
        run(ana, "messages.send", {
          to: ["user:chloe-nguyen"],
          subject: "Hi",
          body: "x",
          idempotency_key: "t3:msg:5",
        }),
      );
      expect(e?.details).toMatchObject({ reason: "MEMBER_DISABLED" });
      const r = (yield* run(ana, "messages.recipients", { q: "wel" })) as {
        items: Array<{ recipient: string; kind: string }>;
      };
      expect(r.items.map((i) => i.recipient)).toContain("group:wellness-club");
      const p = (yield* run(ana, "messages.recipients", { q: "ben" })) as {
        items: Array<{ recipient: string }>;
      };
      expect(p.items.map((i) => i.recipient)).toContain("user:ben-carter");
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("notifications (CONTRACT 12.3)", () => {
  it.effect("read and read_all move the unread count and emit notification.read", () =>
    Effect.gen(function* () {
      const { maya, ben } = yield* setup;
      yield* run(maya, "notifications.send", {
        to: ["user:ben-carter"],
        type: "system",
        title: "One",
        body: "a",
        idempotency_key: "t3:note:1",
      });
      yield* run(
        maya,
        "notifications.send",
        { to: ["user:ben-carter"], type: "system", title: "Two", body: "b", idempotency_key: "t3:note:2" },
        1,
      );
      const list = (yield* run(ben, "notifications.list", { filter: "unread" })) as {
        items: Array<{ notification_id: string; title: string }>;
        unread_count: number;
      };
      expect(list.unread_count).toBe(2);
      expect(list.items.map((i) => i.title)).toEqual(["Two", "One"]);
      const one = yield* run(
        ben,
        "notifications.read",
        { ids: [list.items[0]?.notification_id as string] },
        2,
      );
      expect(one).toEqual({ marked: 1, unread_count: 1 });
      const all = yield* run(ben, "notifications.read_all", {}, 3);
      expect(all).toEqual({ marked: 1, unread_count: 0 });
      const ev = yield* q<{ n: string }>(
        `SELECT count(*)::text AS n FROM domain_events WHERE type = 'notification.read'`,
      );
      expect(Number(ev[0]?.n)).toBe(2);
      expect(
        ((yield* run(ben, "me.counts", {})) as { notifications_unread: number }).notifications_unread,
      ).toBe(0);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("send needs notifications:send, expands groups and counts suppressed recipients", () =>
    Effect.gen(function* () {
      const { maya, ana, ben } = yield* setup;
      const denied = yield* refused(
        run(ana, "notifications.send", {
          to: ["user:ben-carter"],
          type: "system",
          title: "x",
          body: "y",
          idempotency_key: "t3:note:3",
        }),
      );
      expect(denied?.code).toBe("FORBIDDEN");
      yield* run(ben, "me.preferences.update", {
        notifications: {
          ...DEFAULT_NOTIFICATION_PREFS,
          system: { in_app: false, email: false, digest: false },
        },
      });
      const r = (yield* run(
        maya,
        "notifications.send",
        {
          to: ["group:wellness-club"],
          type: "system",
          title: "Club",
          body: "z",
          idempotency_key: "t3:note:4",
        },
        1,
      )) as { recipients: number; suppressed: number };
      expect(r.recipients + r.suppressed).toBe(9);
      const mem = yield* q<{ n: string }>(
        `SELECT jsonb_array_length(body -> 'spec' -> 'members')::text AS n FROM nodes WHERE kind = 'Group' AND slug = 'wellness-club'`,
      );
      expect(Number(mem[0]?.n)).toBe(9);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("deliveries are own-only unless the viewer holds people:view-private", () =>
    Effect.gen(function* () {
      const { maya, ana, ben } = yield* setup;
      yield* run(ben, "me.preferences.update", {
        notifications: {
          ...DEFAULT_NOTIFICATION_PREFS,
          system: { in_app: true, email: true, digest: false },
        },
      });
      yield* run(
        maya,
        "notifications.send",
        { to: ["user:ben-carter"], type: "system", title: "Mail", body: "m", idempotency_key: "t3:note:5" },
        1,
      );
      const own = (yield* run(ben, "notifications.deliveries", { channel: "email" })) as {
        items: Array<{ status: string }>;
      };
      expect(own.items).toHaveLength(1);
      expect(own.items[0]?.status).toBe("queued");
      const other = yield* refused(run(ana, "notifications.deliveries", { member: "ben-carter" }));
      expect(other?.code).toBe("FORBIDDEN");
      const admin = (yield* run(maya, "notifications.deliveries", { member: "ben-carter" })) as {
        items: unknown[];
      };
      expect(admin.items).toHaveLength(1);
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("tasks (CONTRACT 12.6)", () => {
  type Task = {
    task_id: string;
    task_no: number;
    status: string;
    version: number;
    completed_at: string | null;
    assignee: { subject: string } | null;
    comments: unknown[];
    history: unknown[];
  };

  it.effect("create, assign rights, optimistic version and terminal states", () =>
    Effect.gen(function* () {
      const { maya, ana, ben } = yield* setup;
      const mine = (yield* run(ana, "tasks.create", {
        title: "Recount aisle 14",
        idempotency_key: "t3:task:1",
      })) as Task;
      expect(mine.assignee?.subject).toBe("user:ana-silva");
      expect(mine.task_no).toBeGreaterThan(0);
      // assigning someone else needs tasks:manage
      const denied = yield* refused(
        run(ana, "tasks.create", {
          title: "For Ben",
          assignee: "user:ben-carter",
          idempotency_key: "t3:task:2",
        }),
      );
      expect(denied?.code).toBe("FORBIDDEN");
      const given = (yield* run(
        maya,
        "tasks.create",
        { title: "For Ben", assignee: "user:ben-carter", priority: "high", idempotency_key: "t3:task:3" },
        1,
      )) as Task;
      expect((yield* notificationsOf("ben-carter", "task_assigned")).length).toBe(1);
      // the assignee updates; a stale version is refused with the current one
      const doing = (yield* run(
        ben,
        "tasks.update",
        { task_id: given.task_id, status: "in_progress", version: given.version },
        2,
      )) as Task;
      expect(doing.version).toBe(given.version + 1);
      const stale = yield* refused(
        run(ben, "tasks.update", { task_id: given.task_id, status: "done", version: given.version }, 3),
      );
      expect(stale?.details).toMatchObject({ reason: "STALE_VERSION", current_version: doing.version });
      const done = (yield* run(
        ben,
        "tasks.update",
        { task_id: given.task_id, status: "done", version: doing.version },
        4,
      )) as Task;
      expect(done.completed_at).not.toBeNull();
      // done is terminal for the assignee, but tasks:manage may reopen it and that clears completed_at
      const reopen = yield* refused(
        run(ben, "tasks.update", { task_id: given.task_id, status: "open", version: done.version }, 5),
      );
      expect(reopen?.details).toMatchObject({ reason: "INVALID_TRANSITION" });
      const back = (yield* run(
        maya,
        "tasks.update",
        { task_id: given.task_id, status: "open", version: done.version },
        6,
      )) as Task;
      expect(back.completed_at).toBeNull();
      expect(back.history.length).toBeGreaterThanOrEqual(4);
      // a stranger cannot see it
      const hidden = yield* refused(run(ana, "tasks.get", { task_id: given.task_id }));
      expect(hidden?.code).toBe("UNKNOWN_REFERENCE");
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("lists by scope with status counts, comments notify mentions, scope=all needs tasks:manage", () =>
    Effect.gen(function* () {
      const { maya, ana, ben } = yield* setup;
      const t1 = (yield* run(ana, "tasks.create", { title: "A", idempotency_key: "t3:task:11" })) as Task;
      yield* run(ana, "tasks.create", { title: "B", priority: "urgent", idempotency_key: "t3:task:12" }, 1);
      yield* run(ana, "tasks.update", { task_id: t1.task_id, status: "blocked", version: t1.version }, 2);
      const list = (yield* run(ana, "tasks.list", {})) as {
        items: unknown[];
        status_counts: Record<string, number>;
      };
      expect(list.items).toHaveLength(2);
      expect(list.status_counts).toMatchObject({ open: 1, blocked: 1, done: 0 });
      expect(((yield* run(ana, "me.counts", {})) as { tasks_open: number }).tasks_open).toBe(2);
      const all = yield* refused(run(ana, "tasks.list", { scope: "all" }));
      expect(all?.code).toBe("FORBIDDEN");
      expect(((yield* run(maya, "tasks.list", { scope: "all" })) as { items: unknown[] }).items).toHaveLength(
        2,
      );
      yield* run(
        maya,
        "tasks.comment",
        { task_id: t1.task_id, body: "Looping in @ben-carter too", idempotency_key: "t3:task-comment:1" },
        3,
      );
      expect((yield* notificationsOf("ben-carter", "task_assigned")).length).toBe(1);
      const detail = (yield* run(ana, "tasks.get", { task_id: t1.task_id })) as Task;
      expect(detail.comments).toHaveLength(1);
      void ben;
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("people, groups and me (CONTRACT 12.1, 12.5)", () => {
  it.effect("the directory filters, profiles hide private fields and groups list their members", () =>
    Effect.gen(function* () {
      const { maya, ana, ben } = yield* setup;
      const emea = (yield* run(ana, "people.directory", { region: "EMEA", limit: 50 })) as {
        items: Array<{ person: { handle: string }; region: string }>;
        total: number;
      };
      expect(emea.total).toBeGreaterThan(0);
      expect(emea.items.every((m) => m.region === "EMEA")).toBe(true);
      const byName = (yield* run(ana, "people.directory", { q: "ortiz" })) as {
        items: Array<{ person: { handle: string } }>;
      };
      expect(byName.items.map((m) => m.person.handle)).toEqual(["maya-ortiz"]);
      const self = (yield* run(ana, "people.profile", { handle: "ana-silva" })) as {
        is_self: boolean;
        private: { email: string } | null;
        balance: number | null;
      };
      expect(self.is_self).toBe(true);
      expect(self.private?.email).toContain("@");
      expect(self.balance).not.toBeNull();
      const seen = (yield* run(ben, "people.profile", { handle: "ana-silva" })) as {
        private: unknown;
        balance: number | null;
      };
      expect(seen.private).toBeNull();
      expect(seen.balance).toBeNull();
      const admin = (yield* run(maya, "people.profile", { handle: "ana-silva" })) as {
        private: { email: string } | null;
      };
      expect(admin.private).not.toBeNull();
      const g = (yield* run(ana, "groups.get", { slug: "all-staff" })) as {
        members: unknown[];
        summary: { member_count: number; is_member: boolean };
      };
      expect(g.members).toHaveLength(40);
      expect(g.summary).toMatchObject({ member_count: 40, is_member: true });
      const facts = yield* refused(run(ana, "people.facts", { handle: "ben-carter" }));
      expect(facts?.code).toBe("FORBIDDEN");
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect(
    "me.get bootstraps the shell, preferences create a revisioned node and showcases need held badges",
    () =>
      Effect.gen(function* () {
        const { jonas, ana } = yield* setup;
        const me = (yield* run(jonas, "me.get", {})) as {
          roles: Array<{ role: string; scope: { region: string } | null }>;
          permissions: string[];
          tier: { tier: string } | null;
          program: { name: string };
          counts: { messages_unread: number };
        };
        expect(me.roles).toEqual(
          expect.arrayContaining([{ role: "manager", title: "Manager", scope: { region: "EMEA" } }]),
        );
        expect(me.permissions).toContain("points:award");
        expect(me.permissions).not.toContain("admin:members");
        expect(me.tier?.tier).toBe("gold");
        expect(me.program.name.length).toBeGreaterThan(0);
        const first = (yield* run(ana, "me.preferences.get", {})) as { revision: number | null };
        const upd = (yield* run(ana, "me.preferences.update", {
          digest: { frequency: "weekly", hour_utc: 9, weekday: 2 },
          quiet_hours: { start_hour: 22, end_hour: 6 },
        })) as { revision: number; preferences: { digest: { frequency: string } } };
        expect(upd.revision).toBeGreaterThan(first.revision ?? 0);
        expect(upd.preferences.digest.frequency).toBe("weekly");
        const stale = yield* refused(
          run(ana, "me.preferences.update", { base_revision: 1, digest: { frequency: "off", hour_utc: 8 } }),
        );
        expect(stale?.details).toMatchObject({ reason: "STALE_VERSION" });
        const showcase = yield* refused(run(ana, "me.profile.update", { showcase: ["no-such-badge"] }));
        expect(showcase?.details).toMatchObject({ reason: "NOT_ELIGIBLE" });
        const bio = (yield* run(ana, "me.profile.update", { bio: "Picks and packs.", avatar_hue: 120 })) as {
          member: { bio: string } | null;
        };
        expect(bio.member?.bio).toBe("Picks and packs.");
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("sessions list, revoke and the revoked tab is reported", () =>
    Effect.gen(function* () {
      const { ana } = yield* setup;
      const list = (yield* run(ana, "me.sessions", {})) as {
        items: Array<{ session_id: string; revoked_at: string | null }>;
      };
      expect(list.items.length).toBeGreaterThan(0);
      const first = list.items[0]?.session_id as string;
      const r = (yield* run(ana, "me.sessions.revoke", { session_id: first })) as { revoked_at: string };
      expect(r.revoked_at).toMatch(/Z$/);
      const after = (yield* run(ana, "me.sessions", {})) as {
        items: Array<{ session_id: string; revoked_at: string | null }>;
      };
      expect(after.items.find((s) => s.session_id === first)?.revoked_at).not.toBeNull();
      const ev = yield* q<{ n: string }>(
        `SELECT count(*)::text AS n FROM domain_events WHERE type = 'session.revoked'`,
      );
      expect(Number(ev[0]?.n)).toBe(1);
    }).pipe(Effect.provide(StoreLive)),
  );
});
