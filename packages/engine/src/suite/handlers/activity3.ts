import { Effect } from "effect";
import type { DomainEventType, SuiteMe } from "@plinth/spec";
type ActivityItem = typeof SuiteMe.ActivityItem.Type;
import type { ControlStore } from "../../control-store";
import type { StoreError } from "../../errors";
import { ISO, decodeCursor, encodeCursor, limitOf, pgArr, personRefs, q, ref } from "./util3";

/**
 * Activity timelines (me.activity, people.activity): a Plinth-authored sentence per domain event, never embedding user
 * text (message bodies, titles, free text). Shared by the `me` and `people` handlers.
 */

const n = (x: unknown): number => (typeof x === "number" ? x : Number(x ?? 0));
const s = (x: unknown): string => (typeof x === "string" ? x : "");

export const describeEvent = (
  type: DomainEventType,
  p: Record<string, unknown>,
): { summary: string; icon: ActivityItem["icon"]; link: string | null } => {
  switch (type) {
    case "points.posted": {
      const d = n(p["delta"]);
      return {
        summary: `${d >= 0 ? "Earned" : "Spent"} ${Math.abs(d).toLocaleString("en-US")} points (${s(p["txn_type"])})`,
        icon: "coins",
        link: "/points",
      };
    }
    case "points.expiring":
      return {
        summary: `${n(p["points"]).toLocaleString("en-US")} points expiring on ${s(p["expires_on"])}`,
        icon: "clock",
        link: "/points",
      };
    case "tier.changed":
      return { summary: `Moved from ${s(p["from"])} to ${s(p["to"])}`, icon: "crown", link: "/points" };
    case "order.placed":
      return {
        summary: `Placed order ${s(p["order_no"])} for ${n(p["total_points"]).toLocaleString("en-US")} points`,
        icon: "bag",
        link: `/store/orders/${s(p["order_id"])}`,
      };
    case "order.status_changed":
      return {
        summary: `Order ${s(p["order_no"])} moved from ${s(p["from"])} to ${s(p["to"])}`,
        icon: "truck",
        link: `/store/orders/${s(p["order_id"])}`,
      };
    case "review.created":
      return {
        summary: `Reviewed a product with ${n(p["rating"])} stars`,
        icon: "star",
        link: `/store/p/${s(p["product"])}`,
      };
    case "badge.awarded":
      return { summary: `Earned the ${s(p["badge"])} badge`, icon: "trophy", link: "/badges" };
    case "badge.revoked":
      return { summary: `The ${s(p["badge"])} badge was revoked`, icon: "trophy", link: "/badges" };
    case "badge.progress":
      return {
        summary: `Progress on the ${s(p["badge"])} badge: ${n(p["current"])} of ${n(p["target"])}`,
        icon: "target",
        link: "/badges",
      };
    case "promotion.redeemed":
      return {
        summary: `Redeemed promotion ${s(p["promotion"])}`,
        icon: "percent",
        link: `/promotions/${s(p["promotion"])}`,
      };
    case "content.published":
      return {
        summary: `Published ${s(p["content_type"])} ${s(p["content"])}`,
        icon: "article",
        link: `/read/${s(p["content"])}`,
      };
    case "content.state_changed":
      return {
        summary: `Content ${s(p["content"])} moved from ${s(p["from"])} to ${s(p["to"])}`,
        icon: "document",
        link: `/content/${s(p["content"])}`,
      };
    case "content.engaged":
      return {
        summary: `Engaged with content ${s(p["content"])}`,
        icon: "eye",
        link: `/read/${s(p["content"])}`,
      };
    case "task.assigned":
      return { summary: `Task #${n(p["task_no"])} assigned`, icon: "task", link: "/tasks" };
    case "task.updated":
      return {
        summary: `Task #${n(p["task_no"])} updated (${s(p["status"])})`,
        icon: "task",
        link: "/tasks",
      };
    case "task.commented":
      return { summary: `Commented on task #${n(p["task_no"])}`, icon: "reply", link: "/tasks" };
    case "message.sent":
      return {
        summary: `Sent a message to ${n(p["recipient_count"])} ${n(p["recipient_count"]) === 1 ? "person" : "people"}`,
        icon: "send",
        link: `/messages/t/${s(p["thread_id"])}`,
      };
    case "message.received":
      return { summary: "Received a message", icon: "inbox", link: `/messages/t/${s(p["thread_id"])}` };
    case "approval.requested":
      return {
        summary: `Approval requested (${s(p["approval_type"])})`,
        icon: "check-circle",
        link: "/approvals",
      };
    case "approval.decided":
      return {
        summary: `Approval ${s(p["status"])} (${s(p["approval_type"])})`,
        icon: "check-circle",
        link: "/approvals",
      };
    case "member.updated":
      return {
        summary: `Profile updated (${(Array.isArray(p["fields"]) ? p["fields"] : []).join(", ")})`,
        icon: "user",
        link: `/people/${s(p["member"])}`,
      };
    case "session.revoked":
      return { summary: "A session was signed out", icon: "logout", link: "/settings" };
    case "automation.run_updated":
      return {
        summary: `Automation ${s(p["automation"])} ${s(p["status"])}`,
        icon: "workflow",
        link: `/automations/${s(p["automation"])}`,
      };
    case "promotion.state_changed":
      return {
        summary: `Promotion ${s(p["promotion"])} is now ${s(p["to"])}`,
        icon: "percent",
        link: `/promotions/${s(p["promotion"])}`,
      };
    default:
      return { summary: type, icon: "info", link: null };
  }
};

/** Event types that are UI plumbing and stay out of a person's own timeline unless asked for. */
export const PLUMBING: ReadonlyArray<DomainEventType> = [
  "notification.created",
  "notification.read",
  "message.state_changed",
  "message.received",
  "cart.updated",
  "wishlist.changed",
  "stock.changed",
  "badge.progress",
  "content.engaged",
  "points.expiring",
  "promotion.budget_alert",
];

/** Types shown on a public profile timeline (everything else is for the member and audit:view). */
export const PUBLIC_TYPES: ReadonlyArray<DomainEventType> = [
  "badge.awarded",
  "review.created",
  "content.published",
  "tier.changed",
];

/**
 * Newest-first events where the member is the actor or the subject member. `includeTypes` restricts the types;
 * `excludeTypes` drops plumbing. Cursor is the last seq.
 */
export const activityOf = (
  ws: string,
  memberId: string,
  o: {
    readonly types?: ReadonlyArray<string> | undefined;
    readonly includeTypes?: ReadonlyArray<string> | undefined;
    readonly excludeTypes?: ReadonlyArray<string> | undefined;
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
  },
): Effect.Effect<{ items: ActivityItem[]; next_cursor: string | null }, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const limit = limitOf(o.limit, 30);
    const params: unknown[] = [ws, memberId];
    const where = ["e.workspace_id = $1", "(e.member_id = $2 OR e.actor_id = $2)"];
    const only = o.types && o.types.length > 0 ? o.types : o.includeTypes;
    if (only && only.length > 0) {
      params.push(pgArr(only));
      where.push(`e.type = ANY($${params.length}::text[])`);
    } else if (o.excludeTypes && o.excludeTypes.length > 0) {
      params.push(pgArr(o.excludeTypes));
      where.push(`NOT (e.type = ANY($${params.length}::text[]))`);
    }
    const cur = decodeCursor(o.cursor);
    if (cur && cur.length === 1) {
      params.push(Number(cur[0]));
      where.push(`e.seq < $${params.length}`);
    }
    params.push(limit + 1);
    const rows = yield* q<{
      seq: string;
      type: DomainEventType;
      occurred_at: string;
      actor_id: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT e.seq::text AS seq, e.type, ${ISO("e.occurred_at")} AS occurred_at, e.actor_id, e.payload
       FROM domain_events e WHERE ${where.join(" AND ")} ORDER BY e.seq DESC LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, limit);
    const refs = yield* personRefs(
      ws,
      page.map((r) => r.actor_id),
    );
    const last = page[page.length - 1];
    return {
      items: page.map((r) => {
        const d = describeEvent(r.type, r.payload);
        return {
          seq: Number(r.seq),
          type: r.type,
          occurred_at: r.occurred_at,
          actor: ref(refs, r.actor_id),
          summary: d.summary,
          icon: d.icon,
          link: d.link,
        } as ActivityItem;
      }),
      next_cursor: rows.length > limit && last ? encodeCursor([last.seq]) : null,
    };
  });
