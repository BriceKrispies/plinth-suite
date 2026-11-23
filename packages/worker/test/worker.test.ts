import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { principalId, workspaceId } from "@plinth/core";
import {
  ControlStore,
  Identity,
  StoreLive,
  emitDomainEvent,
  readCursor,
  resetAndSeed,
  store,
} from "@plinth/engine";
import {
  bucketOf,
  drainConsumer,
  drainEngines,
  dueBucket,
  inQuietHours,
  runTickJob,
  sendQueuedEmails,
  workOnce,
  DEFAULT_HOOKS,
  type EventHook,
  type WorkerCtx,
  type WorkerHooks,
} from "../src";

// Pure parts run anywhere; the rest needs Postgres (plinth_test).
const WS = workspaceId("northwind");
const ctxAt = (iso: string): WorkerCtx => ({
  workspaceId: WS,
  workspaceSlug: "northwind",
  now: new Date(iso),
});

describe("virtual-time buckets", () => {
  it("floors to the UTC minute, hour and day", () => {
    const d = new Date("2026-11-20T14:30:45.500Z");
    expect(bucketOf(d, "minute").toISOString()).toBe("2026-11-20T14:30:00.000Z");
    expect(bucketOf(d, "hour").toISOString()).toBe("2026-11-20T14:00:00.000Z");
    expect(bucketOf(d, "day").toISOString()).toBe("2026-11-20T00:00:00.000Z");
  });
  it("a bucket runs once, and missed buckets collapse into the current one", () => {
    const now = new Date("2026-11-20T14:30:45Z");
    expect(dueBucket(null, now, "minute")?.toISOString()).toBe("2026-11-20T14:30:00.000Z");
    expect(dueBucket(new Date("2026-11-20T14:30:00Z"), now, "minute")).toBeNull();
    expect(dueBucket(new Date("2026-11-20T14:12:00Z"), now, "minute")?.toISOString()).toBe(
      "2026-11-20T14:30:00.000Z",
    );
  });
  it("quiet hours may wrap midnight; equal bounds mean none", () => {
    expect(inQuietHours(23, 22, 7)).toBe(true);
    expect(inQuietHours(3, 22, 7)).toBe(true);
    expect(inQuietHours(7, 22, 7)).toBe(false);
    expect(inQuietHours(12, 9, 17)).toBe(true);
    expect(inQuietHours(12, 5, 5)).toBe(false);
  });
});

const setup = Effect.gen(function* () {
  yield* resetAndSeed;
  const id = yield* Identity;
  return { maya: yield* id.bySubject("user:ops-lead") };
});

const event = (maya: { id: string; subject: string }, n: number) =>
  emitDomainEvent(WS, {
    type: "member.updated",
    occurredAt: new Date("2026-11-20T14:30:00Z"),
    actor: maya,
    surface: "system",
    audience: ["*"],
    payload: { member: "maya-ortiz", fields: [`f${n}`] },
  });

describe("event consumers and the scheduler", () => {
  it.effect(
    "a consumer sees each event once, in order, and its cursor moves with the hook's transaction",
    () =>
      Effect.gen(function* () {
        const { maya } = yield* setup;
        for (let i = 1; i <= 5; i++) yield* event(maya, i);
        const seen: number[] = [];
        const hook: EventHook = (events) => Effect.sync(() => void seen.push(...events.map((e) => e.seq)));
        const n = yield* drainConsumer("automation", hook, ctxAt("2026-11-20T14:30:00Z"));
        expect(n).toBe(5);
        expect(seen).toEqual([1, 2, 3, 4, 5]);
        expect(yield* readCursor(WS, "automation")).toBe(5);
        // caught up: nothing is delivered twice
        expect(yield* drainConsumer("automation", hook, ctxAt("2026-11-20T14:30:00Z"))).toBe(0);
        // the badge consumer has its own cursor
        expect(yield* readCursor(WS, "badges")).toBe(0);
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("a failing hook leaves the cursor where it was (at-least-once)", () =>
    Effect.gen(function* () {
      const { maya } = yield* setup;
      yield* event(maya, 1);
      const boom: EventHook = () => Effect.die(new Error("boom"));
      const r = yield* Effect.exit(drainConsumer("badges", boom, ctxAt("2026-11-20T14:30:00Z")));
      expect(r._tag).toBe("Failure");
      expect(yield* readCursor(WS, "badges")).toBe(0);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect(
    "a scheduler job runs once per virtual bucket, and a failing hook does not consume the bucket",
    () =>
      Effect.gen(function* () {
        yield* setup;
        const ran: string[] = [];
        const ok = [
          {
            name: "t",
            run: (t: { bucket: Date }) => Effect.sync(() => void ran.push(t.bucket.toISOString())),
          },
        ];
        expect(yield* runTickJob("minute", "minute", ok, ctxAt("2026-11-20T14:30:10Z"))).toBe(true);
        expect(yield* runTickJob("minute", "minute", ok, ctxAt("2026-11-20T14:30:50Z"))).toBe(false);
        expect(yield* runTickJob("minute", "minute", ok, ctxAt("2026-11-20T14:31:01Z"))).toBe(true);
        expect(ran).toEqual(["2026-11-20T14:30:00.000Z", "2026-11-20T14:31:00.000Z"]);
        const failing = [{ name: "f", run: () => Effect.die(new Error("no")) }];
        expect(
          (yield* Effect.exit(runTickJob("minute", "minute", failing, ctxAt("2026-11-20T14:32:00Z"))))._tag,
        ).toBe("Failure");
        // the bucket is still due
        expect(yield* runTickJob("minute", "minute", ok, ctxAt("2026-11-20T14:32:05Z"))).toBe(true);
        expect(ran).toHaveLength(3);
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect(
    "workOnce drains both consumers and runs due ticks; events a tick hook appends are consumed in the same pass",
    () =>
      Effect.gen(function* () {
        const { maya } = yield* setup;
        const seen: string[] = [];
        const hooks: WorkerHooks = {
          ...DEFAULT_HOOKS,
          automationEvents: (events) => Effect.sync(() => void seen.push(...events.map((e) => `a${e.seq}`))),
          badgeEvents: (events) => Effect.sync(() => void seen.push(...events.map((e) => `b${e.seq}`))),
          minute: [{ name: "emit", run: () => event(maya, 9).pipe(Effect.asVoid) }],
          hourly: [],
          daily: [],
        };
        const r = yield* workOnce(hooks);
        expect(r.ticks).toEqual(["minute", "digest", "expiry"]);
        // the event the tick produced was drained by both consumers in the same pass
        expect(seen.sort()).toEqual(["a1", "b1"]);
        expect(yield* workOnce(hooks)).toMatchObject({ ticks: [] });
        const d = yield* drainEngines(DEFAULT_HOOKS, ctxAt("2026-11-20T14:30:00Z"));
        expect(d).toEqual({ automation: 0, badges: 0 });
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("the email stub marks a queued delivery sent, and suppresses it for a disabled member", () =>
    Effect.gen(function* () {
      yield* setup;
      const { sql } = yield* ControlStore;
      const mk = (subject: string, handle: string, disabled: boolean) =>
        Effect.gen(function* () {
          const id = principalId(WS, subject);
          yield* store(
            sql`INSERT INTO principals (principal_id, workspace_id, kind, subject, display_name, disabled_at)
                VALUES (${id}, ${WS}, 'human', ${subject}, ${handle}, ${disabled ? new Date().toISOString() : null}::timestamptz)`,
          );
          yield* store(
            sql`INSERT INTO members (member_id, workspace_id, handle, email, department, region, avatar_hue, joined_at)
                VALUES (${id}, ${WS}, ${handle}, ${handle + "@x.example"}, 'operations', 'NA', 10, now())`,
          );
          yield* store(
            sql`INSERT INTO notification_deliveries (delivery_id, workspace_id, recipient_id, channel, status, subject, body, notification_ids, created_at)
                VALUES (gen_random_uuid(), ${WS}, ${id}, 'email', 'queued', 's', 'b', '{}', now())`,
          );
        });
      yield* mk("user:ok-person", "ok-person", false);
      yield* mk("user:gone-person", "gone-person", true);
      yield* sendQueuedEmails({ bucket: new Date(), previous: null }, ctxAt("2026-11-20T14:30:00Z"));
      const rows = yield* store(
        sql<{ status: string; suppressed_reason: string | null }>`
          SELECT status, suppressed_reason FROM notification_deliveries ORDER BY status`,
      );
      expect(rows).toEqual([
        { status: "sent", suppressed_reason: null },
        { status: "suppressed", suppressed_reason: "member_disabled" },
      ]);
    }).pipe(Effect.provide(StoreLive)),
  );
});
