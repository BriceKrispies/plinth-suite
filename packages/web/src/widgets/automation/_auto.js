// Automation helpers shared by the list, builder and runs widgets.
import { h } from "../../ds/js/dom.js";
import { icon } from "../../ds/js/icons.js";
import { enumLabel } from "../promotions/_kit.js";

export const STEP_META = {
  award_points: { label: "Award points", icon: "award", permission: "points:award" },
  notify: { label: "Send a notification", icon: "bell", permission: "notifications:send" },
  send_message: { label: "Send a message", icon: "send", permission: "messages:use" },
  apply_promotion: { label: "Grant a promotion", icon: "percent", permission: "promotions:manage" },
  create_task: { label: "Create a task", icon: "task", permission: "tasks:manage" },
  webhook: { label: "Record a webhook", icon: "webhook", permission: "automation:manage" },
};
export const STEP_ORDER = Object.keys(STEP_META);
export const TRIGGER_ICON = { event: "bolt", schedule: "clock", metric: "chart" };
export const RUN_STATUSES = ["queued", "running", "succeeded", "failed", "skipped", "cancelled"];

export const runTriggerText = (t) => {
  switch (t?.type) {
    case "event":
      return `Event ${t.event_type}`;
    case "schedule":
      return `Schedule ${t.minute?.slice(0, 16).replace("T", " ")} UTC`;
    case "metric":
      return `Metric at ${t.value}`;
    case "manual":
      return `Run now by ${t.by}`;
    case "retry":
      return "Retry of an earlier run";
    default:
      return enumLabel(t?.type);
  }
};

export const stepIcon = (type, size = 16) => icon(STEP_META[type]?.icon ?? "workflow", { size });

export const durationText = (start, end) => {
  if (!start || !end) return "";
  const ms = new Date(end) - new Date(start);
  if (ms < 1000) return `${Math.max(0, ms)} ms`;
  const s = ms / 1000;
  if (s < 90) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  return `${Math.round(s / 60)} min`;
};

export const errorLine = (err) =>
  err
    ? h(
        "span",
        { class: "wa-error" },
        h("code", {}, err.code),
        ` ${err.message}`,
        err.retryable ? " (retryable)" : "",
      )
    : null;

/** Plain-language cron description for the common shapes; falls back to the raw expression. */
export const describeCron = (cron) => {
  const f = String(cron ?? "")
    .trim()
    .split(/\s+/);
  if (f.length !== 5) return "Not a five-field cron expression";
  const [m, hr, dom, mon, dow] = f;
  const time =
    /^\d+$/.test(m) && /^\d+$/.test(hr) ? `${hr.padStart(2, "0")}:${m.padStart(2, "0")} UTC` : null;
  const DOW = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  if (time && dom === "*" && mon === "*" && dow === "*") return `Every day at ${time}`;
  if (time && dom === "*" && mon === "*" && dow === "1-5") return `Weekdays at ${time}`;
  if (time && dom === "*" && mon === "*" && /^[1-7]$/.test(dow))
    return `Every ${DOW[Number(dow)]} at ${time}`;
  if (time && /^\d+$/.test(dom) && mon === "*" && dow === "*") return `Day ${dom} of each month at ${time}`;
  if (m.startsWith("*/") && hr === "*" && dom === "*" && mon === "*" && dow === "*")
    return `Every ${m.slice(2)} minutes`;
  if (m === "0" && hr.startsWith("*/") && dom === "*" && mon === "*" && dow === "*")
    return `Every ${hr.slice(2)} hours`;
  return `Cron ${cron}`;
};

export const CRON_PRESETS = [
  { label: "Every weekday at 09:00", cron: "0 9 * * 1-5" },
  { label: "Every Monday at 08:00", cron: "0 8 * * 1" },
  { label: "First of the month at 06:00", cron: "0 6 1 * *" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
];
