import { Effect } from "effect";
import { type AutomationSpec, type ContentSpec, type PromotionSpec, SuiteDiscovery } from "@plinth/spec";
import { Authorizer } from "../../authz";
import { ControlStore, store } from "../../control-store";
import { DAY_MS, dom, iso, loadNodes } from "../marketing/common";
import { firesBetween, parseCron } from "../marketing/cron";
import type { ActionCtx, ActionHandler } from "../types";
import type { HandlerTable } from "./stub";

type In = (typeof SuiteDiscovery.CalendarIn)["Type"];
type Out = (typeof SuiteDiscovery.CalendarOut)["Type"];
type Entry = Out["items"][number];

const PROMO_TONE = {
  active: "success",
  scheduled: "info",
  paused: "warning",
  ended: "neutral",
  draft: "neutral",
} as const;

const allowed = (ctx: ActionCtx, permission: string, module: string) =>
  Effect.flatMap(Authorizer, (a) =>
    a.authorize(ctx.principal, permission, `plinth://${ctx.principal.workspaceSlug}/suite/${module}`),
  ).pipe(Effect.map((d) => d.kind === "allow"));

/** Promotion windows, content schedules, cron fires, the viewer's expiry dates and task due dates in a range. */
const range: ActionHandler<In, Out> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const from = new Date(input.from);
      const to = new Date(input.to);
      if (!(to.getTime() >= from.getTime()) || to.getTime() - from.getTime() > 62 * DAY_MS)
        return yield* Effect.fail(
          dom("VALIDATION_FAILED", "/to", "to must not precede from and the range is at most 62 days", {
            expected: "to - from at most 62 days",
          }),
        );
      const want = new Set<string>(input.types ?? ["promotion", "content", "automation", "expiry", "task"]);
      const items: Entry[] = [];
      const inRange = (t: Date) => t.getTime() >= from.getTime() && t.getTime() <= to.getTime();
      const memberId = ctx.onBehalfOf?.id ?? ctx.principal.id;

      if (want.has("promotion")) {
        const seeDrafts = yield* allowed(ctx, "promotions:simulate", "promotions");
        for (const p of yield* loadNodes<PromotionSpec>(ws, "Promotion")) {
          if (p.spec.status === "draft" && !seeDrafts) continue;
          const s = Date.parse(p.spec.schedule.starts_at);
          const e = Date.parse(p.spec.schedule.ends_at);
          if (!(s <= to.getTime() && e >= from.getTime())) continue;
          items.push({
            id: `promotion:${p.slug}`,
            type: "promotion",
            title: p.title,
            starts_at: p.spec.schedule.starts_at,
            ends_at: p.spec.schedule.ends_at,
            status: p.spec.status,
            tone: PROMO_TONE[p.spec.status],
            icon: "percent",
            href: `/promotions/${p.slug}`,
          });
        }
      }

      if (want.has("content")) {
        const author =
          (yield* allowed(ctx, "content:author", "content")) ||
          (yield* allowed(ctx, "content:review", "content")) ||
          (yield* allowed(ctx, "content:publish", "content"));
        if (author)
          for (const c of yield* loadNodes<ContentSpec>(ws, "Content")) {
            const pa = c.spec.schedule.publish_at;
            if (pa && c.spec.status === "approved" && inRange(new Date(pa)))
              items.push({
                id: `content:${c.slug}:publish`,
                type: "content",
                title: `Publish: ${c.title}`,
                starts_at: pa,
                ends_at: null,
                status: "scheduled",
                tone: "info",
                icon: "article",
                href: `/content/${c.slug}`,
              });
            const ua = c.spec.schedule.unpublish_at;
            if (ua && c.spec.status === "published" && inRange(new Date(ua)))
              items.push({
                id: `content:${c.slug}:unpublish`,
                type: "content",
                title: `Unpublish: ${c.title}`,
                starts_at: ua,
                ends_at: null,
                status: "scheduled",
                tone: "neutral",
                icon: "archive",
                href: `/content/${c.slug}`,
              });
          }
      }

      if (want.has("automation") && (yield* allowed(ctx, "automation:manage", "automation"))) {
        let budget = 200;
        for (const a of yield* loadNodes<AutomationSpec>(ws, "Automation")) {
          const t = a.spec.trigger;
          if (!a.spec.enabled || t.type !== "schedule" || budget <= 0) continue;
          const cron = parseCron(t.cron);
          if (!cron) continue;
          for (const f of firesBetween(cron, new Date(from.getTime() - 60_000), to, budget)) {
            budget -= 1;
            items.push({
              id: `automation:${a.slug}:${iso(f)}`,
              type: "automation",
              title: a.title,
              starts_at: iso(f),
              ends_at: null,
              status: "enabled",
              tone: "neutral",
              icon: "workflow",
              href: `/automations/${a.slug}`,
            });
          }
        }
      }

      if (want.has("expiry")) {
        const rows = yield* store(
          sql<{ day: string; points: string; first_at: Date }>`
            SELECT to_char(l.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, sum(l.remaining)::text AS points,
                   min(l.expires_at) AS first_at
            FROM point_lots l JOIN ledger_accounts a ON a.account_id = l.account_id
            WHERE a.workspace_id = ${ws} AND a.member_id = ${memberId} AND l.remaining > 0
              AND l.expires_at >= ${from.toISOString()}::timestamptz AND l.expires_at <= ${to.toISOString()}::timestamptz
            GROUP BY 1 ORDER BY 1`,
        );
        for (const r of rows)
          items.push({
            id: `expiry:${r.day}`,
            type: "expiry",
            title: `${r.points} points expire`,
            starts_at: iso(r.first_at),
            ends_at: null,
            status: "expiring",
            tone: "warning",
            icon: "clock",
            href: "/points",
          });
      }

      if (want.has("task")) {
        const rows = yield* store(
          sql<{ task_no: number; title: string; due_at: Date; status: string }>`
            SELECT task_no, title, due_at, status FROM tasks
            WHERE workspace_id = ${ws} AND assignee_id = ${memberId} AND status NOT IN ('done', 'cancelled')
              AND due_at >= ${from.toISOString()}::timestamptz AND due_at <= ${to.toISOString()}::timestamptz
            ORDER BY due_at`,
        );
        for (const r of rows)
          items.push({
            id: `task:${r.task_no}`,
            type: "task",
            title: r.title,
            starts_at: iso(r.due_at),
            ends_at: null,
            status: r.status,
            tone: new Date(r.due_at).getTime() < ctx.now.getTime() ? "danger" : "neutral",
            icon: "task",
            href: "/tasks",
          });
      }

      items.sort((a, b) =>
        a.starts_at === b.starts_at ? (a.id < b.id ? -1 : 1) : a.starts_at < b.starts_at ? -1 : 1,
      );
      return { items, virtual_now: iso(ctx.now) };
    }),
};

export const calendarHandlers = {
  "calendar.range": range,
} satisfies HandlerTable;
