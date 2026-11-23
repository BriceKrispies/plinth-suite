// Shared helpers for the points, store and badges widgets (package B). Not a widget: the manifest ignores files
// that are not named after a catalogue id. Everything here is plain DOM through h(); nothing renders data as HTML.
import { h, announce } from "../../ds/js/dom.js";
import { toErrorInfo } from "../../core/api.js";
import { clockStore, meStore } from "../../core/stores.js";
import { relativeTime, dateTime, signedPoints } from "../../ds/js/format.js";
import { pill } from "../../ds/js/pill.js";
import { errorState } from "../../ds/js/states.js";
import { pager } from "../../ds/js/table.js";
import { formErrors } from "../../ds/js/field.js";

// ---- time ----

export const nowIso = () => clockStore.get().virtual_now;
export const when = (iso) => (iso ? relativeTime(iso, nowIso()) : "");
/** A `time` element showing relative time with the full date as its title. */
export const timeEl = (iso) =>
  iso ? h("time", { datetime: iso, title: dateTime(iso) }, when(iso)) : h("span", {}, "");
/** Whole days from now (virtual clock) to an ISO date or timestamp; negative when past. */
export const daysUntil = (iso) =>
  Math.ceil((new Date(iso).getTime() - new Date(nowIso()).getTime()) / 86400000);

// ---- the viewer ----

export const myHandle = () => meStore.get()?.member?.handle ?? null;

/**
 * The member a widget shows. `target` is a MemberTarget (`"$me"`, a handle or null from a missing binding).
 * Returns `{ handle, mine, arg }`; `arg` is what to send as `member` (undefined for yourself, so the server
 * applies its default and no points:view-all is needed).
 */
export const resolveMember = (ctx, target) => {
  const handle = ctx.memberHandle(target ?? "$me") ?? null;
  const mine = handle !== null && handle === myHandle();
  return { handle, mine, arg: handle && !mine ? handle : undefined };
};

// ---- errors ----

const REASONS = {
  INSUFFICIENT_POINTS: "There are not enough points for that.",
  LIMIT_EXCEEDED: "That is over a programme limit.",
  SELF_ACTION: "You cannot do that to yourself.",
  MEMBER_DISABLED: "That member is disabled.",
  OUT_OF_STOCK: "There is not enough stock.",
  NOT_ELIGIBLE: "You are not eligible for that.",
  ALREADY_EXISTS: "That already exists.",
  INVALID_TRANSITION: "That is not possible in the current state.",
  PRICE_CHANGED: "Prices changed while you were deciding.",
  CART_EMPTY: "The cart is empty.",
  BUDGET_EXHAUSTED: "A promotion budget ran out.",
  STALE_VERSION: "This changed while you were editing.",
};

/** Error info from an API error, any other thrown value, or an already-shaped `{ code, path, message }`. */
const infoOf = (e) => (e instanceof Error || typeof e !== "object" || e === null ? toErrorInfo(e) : e);

/** A sentence for an error, preferring the refusal reason (CONTRACT 1.2) over the server text. */
export const messageOf = (e) => {
  const info = infoOf(e);
  const reason = info.details?.reason;
  const base = REASONS[reason];
  if (reason === "LIMIT_EXCEEDED" && info.details?.limit !== undefined)
    return `${base} The limit is ${String(info.details.limit)}.`;
  if (reason === "INVALID_TRANSITION" && Array.isArray(info.details?.allowed))
    return `${base} Allowed now: ${info.details.allowed.join(", ") || "nothing"}.`;
  if (info.message) return base && !info.path ? `${base} ${info.message}` : info.message;
  return base ?? "Something went wrong.";
};

/** `{ code, path, message }` for formErrors; refusals without a path are mapped through `fieldFor[reason]`. */
export const errorBody = (e, fieldFor = {}) => {
  const info = infoOf(e);
  const reason = info.details?.reason;
  return { code: info.code ?? "ERROR", path: info.path ?? fieldFor[reason] ?? null, message: messageOf(e) };
};

/** Show an API error on a form (field plus summary) and move focus to the summary. */
export const showFormError = (form, e, fieldFor) => {
  const summary = formErrors(errorBody(e, fieldFor), { form });
  summary?.focus?.();
  return summary;
};

/** Replace the contents of `host` with an error state (retry optional). */
export const inlineError = (host, e, retry) =>
  host.replaceChildren(errorState({ error: toErrorInfo(e), retry }));

/**
 * Report a load failure: the first load puts the frame in its error state (whose Try again calls `retry`),
 * later reads show the error inline in `host`.
 */
export const reportLoadError = ({ ctx, host, error, retry, initial }) => {
  if (initial) {
    ctx.setState("error", {
      error: toErrorInfo(error),
      retry: () => {
        ctx.setState("ready");
        retry();
      },
    });
  } else inlineError(host, error, retry);
};

// ---- lifecycle ----

/** Cleanup collector: timers, listeners and observers are released together on unmount. */
export const disposer = () => {
  const fns = new Set();
  let done = false;
  const life = {
    get done() {
      return done;
    },
    /** Register a cleanup; runs at once when the widget is already gone. */
    add(fn) {
      if (done) fn();
      else fns.add(fn);
      return fn;
    },
    timeout(fn, ms) {
      let cancel;
      const t = setTimeout(() => {
        fns.delete(cancel);
        if (!done) fn();
      }, ms);
      cancel = () => clearTimeout(t);
      if (done) cancel();
      else fns.add(cancel);
      return cancel;
    },
    /** A debounced function whose pending call is cancelled on unmount. */
    debounce(fn, ms) {
      let cancel = null;
      return (...args) => {
        cancel?.();
        cancel = life.timeout(() => fn(...args), ms);
      };
    },
    dispose() {
      if (done) return;
      done = true;
      for (const f of [...fns]) {
        try {
          f();
        } catch (e) {
          console.error(e);
        }
      }
      fns.clear();
    },
  };
  return life;
};

/** Serialises async work: each task starts after the previous one settles (used for cart line edits). */
export const serialQueue = () => {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
};

export const setBusy = (btn, on) => {
  if (!btn) return;
  if (on) {
    btn.setAttribute("aria-busy", "true");
    btn.setAttribute("aria-disabled", "true");
  } else {
    btn.removeAttribute("aria-busy");
    btn.removeAttribute("aria-disabled");
  }
};

/** Runs `fn` with the button marked busy; always clears the mark. */
export const withBusy = async (btn, fn) => {
  setBusy(btn, true);
  try {
    return await fn();
  } finally {
    setBusy(btn, false);
  }
};

// ---- motion: only ever from realtime events, never on first load ----

export const reducedMotion = () =>
  document.documentElement.dataset.reducedMotion === "true" ||
  (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);

/** Count a formatted number from `from` to `to`; instant under reduced motion. */
export const countTo = (life, el, from, to, format) => {
  if (reducedMotion() || from === to || from === null || from === undefined) {
    el.textContent = format(to);
    return;
  }
  const t0 = performance.now();
  const span = 600;
  let frame = 0;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / span);
    const eased = 1 - (1 - k) ** 3;
    el.textContent = format(Math.round(from + (to - from) * eased));
    if (k < 1 && !life.done) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  life.add(() => cancelAnimationFrame(frame));
};

/** Mark an item that a realtime event added or changed (DESIGN-SYSTEM 9.4). The pill stays until re-render. */
export const markArrived = (life, node, slot) => {
  if (!node) return;
  node.classList.add("u-arrive");
  if (slot && !slot.querySelector(".w-kit-new")) {
    const p = pill({ label: "New", tone: "signal" });
    p.classList.add("w-kit-new");
    slot.append(p);
  }
  life.timeout(() => node.classList.remove("u-arrive"), 6000);
};

/** One announcement per batch of arrivals (DESIGN-SYSTEM 9.6). */
export const batchAnnouncer = (life, textFor, ms = 600) => {
  let n = 0;
  const fire = life.debounce(() => {
    const count = n;
    n = 0;
    if (count > 0) announce(textFor(count));
  }, ms);
  return () => {
    n += 1;
    fire();
  };
};

// ---- small pieces ----

export const muted = (text, tag = "p") => h(tag, { class: "u-muted w-kit-muted" }, text);

/** A definition-list row: caps label above or beside a value. */
export const kv = (label, value, cls = "") =>
  h("div", { class: `w-kit-kv ${cls}`.trim() }, h("dt", {}, label), h("dd", {}, value));

export const dl = (rows, cls = "") => h("dl", { class: `w-kit-dl ${cls}`.trim() }, ...rows);

export const sectionHead = (title, ...actions) =>
  h(
    "div",
    { class: "w-kit-head" },
    h("h3", { class: "w-kit-head__title" }, title),
    actions.length ? h("div", { class: "w-kit-head__actions" }, ...actions) : null,
  );

/** A signed points amount: the sign is in the text, colour only reinforces it. */
export const amount = (n, extra = "") =>
  h(
    "span",
    {
      class:
        `w-kit-amount u-tabular ${n > 0 ? "w-kit-amount--pos" : n < 0 ? "w-kit-amount--neg" : ""} ${extra}`.trim(),
    },
    signedPoints(n),
  );

export const TXN_TYPES = {
  award: ["Award", "success"],
  purchase: ["Purchase", "neutral"],
  refund: ["Refund", "info"],
  transfer: ["Transfer", "info"],
  expiry: ["Expiry", "warning"],
  adjustment: ["Adjustment", "warning"],
  promotion_bonus: ["Promotion bonus", "success"],
  badge_reward: ["Badge reward", "success"],
  reversal: ["Reversal", "danger"],
};

export const txnPill = (type) => {
  const [label, tone] = TXN_TYPES[type] ?? [type, "neutral"];
  return pill({ label, tone });
};

/** Cursor paging with a stack of visited cursors, for Previous and Next. */
export const cursorPaging = () => {
  const stack = [undefined];
  return {
    current: () => stack[stack.length - 1],
    push: (cursor) => stack.push(cursor),
    pop: () => (stack.length > 1 ? stack.pop() : undefined),
    canPrev: () => stack.length > 1,
    reset: () => {
      stack.length = 1;
    },
    depth: () => stack.length,
  };
};

export const pagerFor = (paging, nextCursor, { label, onChange }) =>
  pager({
    label,
    nextCursor,
    onNext: (c) => {
      paging.push(c);
      onChange();
    },
    onPrev: paging.canPrev()
      ? () => {
          paging.pop();
          onChange();
        }
      : undefined,
  });

/** Combobox search over people.directory, excluding handles and disabled members. */
export const peopleSearch =
  (api, { exclude = [] } = {}) =>
  async (q) => {
    const res = await api.call("people.directory", { q: q || undefined, limit: 8, sort: "name" });
    return res.items
      .filter((m) => m.status === "active" && m.person.handle && !exclude.includes(m.person.handle))
      .map((m) => ({
        value: m.person.handle,
        label: m.person.display_name,
        description: [m.title, m.department].filter(Boolean).join(" · "),
        avatar: m.person.avatar,
        card: m,
      }));
  };

/** Save text as a download. */
export const downloadText = (name, text, type = "text/csv") => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const csvCell = (v) => {
  const t = String(v ?? "");
  return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
};

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
