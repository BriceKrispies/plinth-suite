// Helpers shared by the widgets of the reporting, approvals, tasks, audit, admin, settings and pages domains
// (one package). Nothing here touches the shell, the body or another widget.
import { h, clear } from "../../ds/js/dom.js";
import { errorState, delayedSkeleton } from "../../ds/js/states.js";
import { toErrorInfo } from "../../core/api.js";
import { clockStore } from "../../core/stores.js";
import { relativeTime, dateTime } from "../../ds/js/format.js";

export { toErrorInfo };

/** Virtual now as an ISO string (never read from the wall clock). */
export const nowIso = () => clockStore.get().virtual_now;

export const isCompact = (size) => size === "s" || size === "m";

/**
 * Marks content that is rendered outside a widget frame (a drawer body) as belonging to a domain, so the domain's
 * `@scope` stylesheet reaches it. Takes a node or a function that returns one; returns the same kind.
 */
export const scoped = (domain, body) =>
  typeof body === "function"
    ? (...args) => scoped(domain, body(...args))
    : h("div", { "data-widget-domain": domain }, body);

/** Relative time for a timestamp, with the absolute value in a title. */
export const timeNode = (iso, { className = "u-muted" } = {}) =>
  iso
    ? h("time", { class: className, datetime: iso, title: dateTime(iso) }, relativeTime(iso, nowIso()))
    : h("span", { class: className }, "–");

export const debounce = (fn, ms) => {
  let t = 0;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
};

/** `const next = latest(); const ok = next(); await x; if (!ok()) return;` drops stale async results. */
export const latest = () => {
  let n = 0;
  return () => {
    const mine = ++n;
    return () => mine === n;
  };
};

/**
 * A content region with delayed skeleton, error and content states.
 * `show(...nodes)` replaces the content; `loading()` shows a skeleton only after 300 ms (first loads);
 * `error(e, retry)` shows the error state. Keep calling `show` for later refreshes: the old content stays.
 */
export const region = (className = "") => {
  const el = h("div", { class: className });
  let cancel = null;
  const stop = () => {
    cancel?.();
    cancel = null;
    el.removeAttribute("aria-busy");
  };
  return {
    el,
    loading(opts = { lines: 4 }) {
      stop();
      clear(el);
      cancel = delayedSkeleton(el, opts);
    },
    busy(on) {
      if (on) el.setAttribute("aria-busy", "true");
      else el.removeAttribute("aria-busy");
    },
    error(e, retry) {
      stop();
      clear(el).append(errorState({ error: toErrorInfo(e), retry }));
    },
    show(...nodes) {
      stop();
      el.replaceChildren(...nodes.flat().filter(Boolean));
    },
  };
};

/** Show a danger toast for a failed action; STALE_VERSION gets its own wording. */
export const toastError = (toast, e, title = "That did not work") => {
  const info = toErrorInfo(e);
  const stale = info.code === "CONFLICT" && info.details?.reason === "STALE_VERSION";
  toast({
    title: stale ? "This changed while you were editing" : title,
    body: stale ? "The latest version has been loaded." : (info.message ?? info.code),
    tone: "danger",
  });
  return info;
};

export const isStale = (info) => info?.code === "CONFLICT" && info?.details?.reason === "STALE_VERSION";

// ---- datetime-local conversions ----

const pad = (n) => String(n).padStart(2, "0");
/** ISO instant to the value a `datetime-local` input wants (browser local time). */
export const isoToLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** The value of a `datetime-local` input to an ISO instant (UTC), or null when empty. */
export const localInputToIso = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** The Subject (`user:<handle>`) of a PersonRef. */
export const subjectOf = (person) => person?.subject ?? null;

export const PRIORITY_TONE = { low: "neutral", normal: "info", high: "warning", urgent: "danger" };
export const PRIORITY_LABEL = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };

/** A short plain-text key/value list (`dl`). `rows` are `[term, value]` where value is a string or a node. */
export const keyValues = (rows, className = "rp-kv") =>
  h(
    "dl",
    { class: className },
    ...rows
      .filter((r) => r && r[1] !== undefined && r[1] !== null && r[1] !== "")
      .flatMap(([term, value]) => [h("dt", {}, term), h("dd", {}, value)]),
  );

/** Pretty JSON for display inside `pre`. */
export const jsonText = (value) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

/** Move focus after a DOM swap without scrolling the page. */
export const focusSoon = (el) => {
  if (!el) return;
  requestAnimationFrame(() => el.focus?.({ preventScroll: true }));
};
