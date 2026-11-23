// Toasts for the events UI-MAP section 5 lists, one per arriving event for the viewer (never for page loads).
import { toast } from "../ds/js/toast.js";
import { signedPoints } from "../ds/js/format.js";
import * as router from "../core/router.js";
import { meStore, can } from "../core/stores.js";
import { isThreadOpen, myHandle, mySubject, clip } from "./kit.js";

/** Notification types that have no toast of their own from another event, so `notification.created` shows them. */
const OWN_TOAST = new Set(["system", "promotion_started", "points_expiring", "content_review"]);

const recent = new Map();
/** The same thing twice within a couple of seconds (two tabs of events, replays) shows once. */
const once = (key) => {
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > 4000) recent.delete(k);
  if (recent.has(key)) return false;
  recent.set(key, now);
  return true;
};

export const wireToasts = (rt) => {
  const muted = new Set(meStore.get()?.preferences?.muted_threads ?? []);
  const href = (path) => router.href(path);

  const offs = [
    meStore.subscribe((me) => {
      muted.clear();
      for (const id of me?.preferences?.muted_threads ?? []) muted.add(id);
    }),

    rt.on("message.state_changed", (ev) => {
      if (typeof ev.payload.muted !== "boolean") return;
      for (const id of ev.payload.thread_ids) {
        if (ev.payload.muted) muted.add(id);
        else muted.delete(id);
      }
    }),

    rt.on("message.received", (ev) => {
      const p = ev.payload;
      if (isThreadOpen(p.thread_id)) return;
      if (router.current().path === `/messages/t/${p.thread_id}`) return;
      if (muted.has(p.thread_id) && !p.mentioned) return;
      if (!once(`msg:${p.message_id}`)) return;
      toast({
        title: p.mentioned
          ? `${p.from.display_name} mentioned you`
          : `New message from ${p.from.display_name}`,
        body: `${p.subject}: ${clip(p.preview, 80)}`,
        tone: "info",
        icon: p.mentioned ? "mention" : "inbox",
        action: { label: "Open", href: href(`/messages/t/${p.thread_id}`) },
      });
    }),

    rt.on("notification.created", (ev) => {
      const n = ev.payload.notification;
      if (!OWN_TOAST.has(n.type)) return;
      const channel = meStore.get()?.preferences?.notifications?.[n.type];
      if (channel && channel.in_app === false) return;
      if (!once(`note:${n.notification_id}`)) return;
      toast({
        title: n.title,
        body: n.body ? clip(n.body, 100) : undefined,
        tone: n.type === "points_expiring" || n.type === "content_review" ? "warning" : "info",
        icon:
          n.type === "points_expiring"
            ? "clock"
            : n.type === "promotion_started"
              ? "percent"
              : n.type === "content_review"
                ? "document"
                : "megaphone",
        action: n.link ? { label: "Open", href: href(n.link) } : undefined,
      });
    }),

    rt.on("points.posted", (ev) => {
      const p = ev.payload;
      if (p.member !== myHandle() || p.delta <= 0) return;
      // Only credits of the kinds that matter: awards, badge rewards and promotion bonuses.
      if (!["award", "badge_reward", "promotion_bonus"].includes(p.txn_type)) return;
      if (!once(`pts:${p.txn_id}`)) return;
      toast({ title: signedPoints(p.delta), body: p.memo || undefined, tone: "success", icon: "coins" });
    }),

    rt.on("badge.awarded", (ev) => {
      const p = ev.payload;
      if (p.member?.handle !== myHandle()) return;
      if (!once(`badge:${p.award_id}`)) return;
      toast({
        title: `Badge earned: ${p.title}`,
        body: p.points_reward ? `${signedPoints(p.points_reward)} reward` : undefined,
        tone: "signal",
        icon: "trophy",
        action: { label: "View badges", href: href("/badges") },
      });
    }),

    rt.on("tier.changed", (ev) => {
      const p = ev.payload;
      if (p.member !== myHandle()) return;
      if (!once(`tier:${p.to}:${p.lifetime}`)) return;
      toast({ title: `You reached ${p.to}`, body: `From ${p.from}`, tone: "signal", icon: "crown" });
    }),

    rt.on("order.status_changed", (ev) => {
      const p = ev.payload;
      if (p.member !== myHandle()) return;
      if (!once(`ord:${p.order_id}:${p.to}`)) return;
      toast({
        title: `Order ${p.order_no} is ${p.to}`,
        body: p.note || undefined,
        tone: p.to === "cancelled" || p.to === "refunded" ? "warning" : "info",
        icon: "box",
        action: { label: "View order", href: href(`/store/orders/${p.order_id}`) },
      });
    }),

    rt.on("approval.requested", (ev) => {
      const p = ev.payload;
      if (p.requested_by === mySubject()) return;
      if (!once(`apr:${p.id}`)) return;
      toast({
        title: "Approval requested",
        body: p.title,
        tone: "warning",
        icon: "check-circle",
        action: { label: "Review", href: href("/approvals") },
      });
    }),

    rt.on("approval.decided", (ev) => {
      const p = ev.payload;
      if (p.by === mySubject()) return;
      if (!once(`apd:${p.id}:${p.decision}`)) return;
      const word = p.decision === "approve" ? "approved" : p.decision === "reject" ? "rejected" : "withdrawn";
      toast({
        title: `Request ${word}`,
        body: p.status,
        tone: p.decision === "approve" ? "success" : p.decision === "reject" ? "danger" : "neutral",
        icon: "check-circle",
        action: { label: "Open approvals", href: href("/approvals") },
      });
    }),

    rt.on("task.assigned", (ev) => {
      const p = ev.payload;
      if (p.assignee !== mySubject()) return;
      if (!once(`task:${p.task_id}:${p.assignee}`)) return;
      toast({
        title: `Task assigned: ${p.title}`,
        body: p.priority === "urgent" || p.priority === "high" ? `${p.priority} priority` : undefined,
        tone: "info",
        icon: "task",
        action: { label: "Open tasks", href: href("/tasks") },
      });
    }),

    rt.on("promotion.budget_alert", (ev) => {
      const p = ev.payload;
      if (!once(`bud:${p.promotion}:${p.used_pct}`)) return;
      toast({
        title: `Promotion budget ${p.used_pct}% used`,
        body: p.promotion,
        tone: p.used_pct >= 100 ? "danger" : "warning",
        icon: "percent",
        action: can("promotions:simulate")
          ? { label: "Open promotions", href: href(`/promotions/${p.promotion}`) }
          : undefined,
      });
    }),

    rt.on("automation.run_updated", (ev) => {
      const p = ev.payload;
      // Run-level failures only; step-level updates arrive for every step.
      if (p.status !== "failed" || p.step_index !== null) return;
      if (!once(`run:${p.run_id}`)) return;
      toast({
        title: "An automation run failed",
        body: p.error_code ? `${p.automation}: ${p.error_code}` : p.automation,
        tone: "danger",
        icon: "workflow",
        action: { label: "Open automations", href: href(`/automations/${p.automation}`) },
      });
    }),

    rt.on("content.published", (ev) => {
      const p = ev.payload;
      if (!p.pinned) return;
      if (!once(`pub:${p.content}`)) return;
      toast({
        title: p.title,
        body: clip(p.summary, 100),
        tone: "info",
        icon: "announcement",
        action: { label: "Read", href: href(`/read/${p.content}`) },
      });
    }),
  ];
  return () => offs.forEach((off) => off());
};
