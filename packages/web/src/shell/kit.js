// Package A helper kit: small pieces shared by the shell and the messaging, notifications, people and search
// widgets. Nothing here mounts itself; every export is a pure helper or returns DOM nodes built with h().
import { h, clear, uid } from "../ds/js/dom.js";
import { icon, ICON_PATHS } from "../ds/js/icons.js";
import { relativeTime, dateTime } from "../ds/js/format.js";
import { pill } from "../ds/js/pill.js";
import { avatar, isViewer } from "../ds/js/avatar.js";
import { iconButton, button } from "../ds/js/button.js";
import "../ds/js/elements.js";
import { toErrorInfo } from "../core/api.js";
import { href as routeHref } from "../core/router.js";
import { clockStore, meStore } from "../core/stores.js";

// ---- icons, time, text ----

/** An icon by name; a name the design system does not draw falls back instead of throwing. */
export const safeIcon = (name, fallback = "info", opts) => icon(ICON_PATHS[name] ? name : fallback, opts);

export const nowIso = () => clockStore.get().virtual_now;
export const ago = (iso) => (iso ? relativeTime(iso, nowIso()) : "");
export const when = (iso) => (iso ? dateTime(iso) : "");
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const link = (path, query) => routeHref(path, query);
export const myHandle = () => meStore.get()?.member?.handle ?? null;
export const mySubject = () => meStore.get()?.principal?.subject ?? null;

/** Group label for a timestamp relative to the virtual clock: Today, Yesterday, This week, Earlier. */
export const dayBucket = (iso) => {
  const day = (d) => Math.floor(new Date(d).getTime() / 86_400_000);
  const diff = day(nowIso()) - day(iso);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return "This week";
  return "Earlier";
};

export const fmtBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / 104857.6) / 10} MB`;
};

/** First `n` characters of a string with an ellipsis. */
export const clip = (text, n = 80) => {
  const t = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Split `text` around case-insensitive matches of `q` into text and <mark> nodes. */
export const highlight = (text, q) => {
  const src = String(text ?? "");
  const needle = String(q ?? "").trim();
  if (!needle) return [src];
  const lower = src.toLowerCase();
  const out = [];
  let at = 0;
  const key = needle.toLowerCase();
  for (let i = lower.indexOf(key); i >= 0; i = lower.indexOf(key, at)) {
    if (i > at) out.push(src.slice(at, i));
    out.push(h("mark", { class: "w-mark" }, src.slice(i, i + key.length)));
    at = i + key.length;
  }
  if (at < src.length) out.push(src.slice(at));
  return out;
};

// ---- errors ----

const REASON = {
  NOT_PARTICIPANT: "You are not a participant in this conversation.",
  MEMBER_DISABLED: "One of the recipients has a disabled account.",
  SELF_ACTION: "You cannot do that to yourself.",
  NOT_ELIGIBLE: "You are not allowed to do that.",
};

/** A short, human sentence for any thrown API error. */
export const errorText = (e) => {
  const info = toErrorInfo(e);
  const reason = info.details?.reason;
  if (reason === "LIMIT_EXCEEDED") {
    if (info.details?.permission) return `This needs the ${info.details.permission} permission.`;
    if (info.details?.limit !== undefined)
      return `Over the limit (${info.details.limit}): you tried ${info.details.value}.`;
  }
  if (info.code === "UNREACHABLE") return "The server could not be reached.";
  return REASON[reason] ?? info.message ?? "Something went wrong.";
};

export const isCode = (e, code) => toErrorInfo(e).code === code;

// ---- lifecycle and async guards ----

/** Collects everything a widget must release on unmount. */
export const lifecycle = () => {
  const offs = new Set();
  let dead = false;
  const life = {
    get dead() {
      return dead;
    },
    add(off) {
      if (dead) off();
      else offs.add(off);
      return off;
    },
    timeout(fn, ms) {
      const t = setTimeout(() => {
        offs.delete(cancel);
        fn();
      }, ms);
      const cancel = () => clearTimeout(t);
      offs.add(cancel);
      return cancel;
    },
    interval(fn, ms) {
      const t = setInterval(fn, ms);
      const cancel = () => clearInterval(t);
      offs.add(cancel);
      return cancel;
    },
    dispose() {
      dead = true;
      for (const off of [...offs]) {
        try {
          off();
        } catch (e) {
          console.error(e);
        }
      }
      offs.clear();
    },
  };
  return life;
};

/** Trailing debounce with cancel(). */
export const debounce = (fn, ms) => {
  let t = 0;
  const run = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  run.cancel = () => clearTimeout(t);
  return run;
};

/** A sequence guard: `const mine = seq.next()` then `if (!seq.ok(mine)) return` after each await. */
export const sequence = () => {
  let n = 0;
  return { next: () => ++n, ok: (mine) => mine === n };
};

/** Mark an element as arrived by a realtime event: signal rule and wash for the hold period. */
export const arrive = (el, life) => {
  if (!el) return;
  el.classList.add("u-arrive");
  const done = () => el.classList.remove("u-arrive");
  if (life) life.timeout(done, 6000);
  else setTimeout(done, 6000);
};

export const newPill = () => pill({ label: "New", tone: "signal" });

/** Batches "n new ..." announcements so a burst of events posts one message. */
export const batchAnnouncer = (ctx, life, text) => {
  let n = 0;
  let pending = false;
  return () => {
    n += 1;
    if (pending) return;
    pending = true;
    life.timeout(() => {
      pending = false;
      ctx.announce(text(n));
      n = 0;
    }, 900);
  };
};

// ---- the thread currently open on screen (the toast rule for new messages reads it) ----

const openThreads = new Set();
export const markThreadOpen = (id) => {
  openThreads.add(id);
  return () => openThreads.delete(id);
};
export const isThreadOpen = (id) => openThreads.has(id);

// ---- small UI builders ----

/** Row of toggle buttons (aria-pressed). `onChange(value)`; returns an element with `.set(value)`. */
export const segmented = ({ label, options, value, onChange }) => {
  const root = h("div", { class: "w-seg", role: "group", "aria-label": label });
  const buttons = new Map();
  const paint = (v) => {
    for (const [val, b] of buttons) b.setAttribute("aria-pressed", String(val === v));
  };
  for (const opt of options) {
    const b = h(
      "button",
      {
        type: "button",
        class: "c-button c-button--secondary c-button--sm w-seg__btn",
        "aria-pressed": String(opt.value === value),
        onclick: () => {
          paint(opt.value);
          onChange?.(opt.value);
        },
      },
      h("span", { class: "c-button__label" }, opt.label),
      opt.count !== undefined && opt.count !== null
        ? h("span", { class: "w-seg__count u-tabular", "data-count": String(opt.count) }, String(opt.count))
        : null,
    );
    buttons.set(opt.value, b);
    root.append(b);
  }
  root.set = paint;
  root.setCount = (val, n) => {
    const c = buttons.get(val)?.querySelector(".w-seg__count");
    if (c) {
      c.textContent = String(n);
      c.hidden = !n;
    }
  };
  return root;
};

/** A person as avatar and name, optionally a link to the profile. */
export const personLine = (person, { size = "sm", href = true, sub } = {}) => {
  const target = href && person.handle ? link(`/people/${person.handle}`) : null;
  const me = isViewer(person);
  const kids = [
    me ? "You" : person.display_name,
    me || person.handle
      ? h("span", { class: "sr-only" }, me ? ` (${person.display_name})` : ` @${person.handle}`)
      : null,
  ];
  const tip = person.handle ? `${person.display_name} @${person.handle}` : null;
  const name = target
    ? h("a", { class: "w-person__name", href: target, title: tip }, ...kids)
    : h("span", { class: "w-person__name", title: tip }, ...kids);
  return h(
    "span",
    { class: "w-person" },
    avatar({ name: person.display_name, avatar: person.avatar, size }),
    h(
      "span",
      { class: "w-person__text" },
      name,
      person.kind && person.kind !== "human"
        ? pill({ label: person.kind === "agent" ? "Agent" : "Service" })
        : null,
      sub ? h("span", { class: "w-person__sub" }, sub) : null,
    ),
  );
};

/** Counter text for a field with a max length: "12 / 140". */
export const charCounter = (max) => {
  const el = h("p", { class: "w-counter u-tabular", "aria-hidden": "true" }, `0 / ${max}`);
  el.update = (len) => {
    el.textContent = `${len} / ${max}`;
    el.classList.toggle("w-counter--over", len > max);
  };
  return el;
};

/** Visible "New" mark plus the arrival rule for a list row; the pill is added once. */
export const markArrived = (row, life, anchorSelector) => {
  arrive(row, life);
  const anchor = anchorSelector ? row.querySelector(anchorSelector) : null;
  if (anchor && !row.querySelector(".c-pill--signal")) anchor.append(newPill());
};

// ---- recipient picker ----

/**
 * People and groups through `messages.recipients`. Returns `{ el, value(), set(recipients), setError(text) }`.
 * `value()` is an array of Recipient strings (`user:<handle>`, `group:<slug>`).
 */
export const recipientPicker = ({ api, label, name, initial = [], hint, required, onChange, max = 50 }) => {
  const el = document.createElement("p-people-picker");
  el.api = api;
  el.onRecipients = onChange ?? null;
  el.configure({
    label,
    name: name ?? null,
    placeholder: "Search people and groups",
    hint: hint ?? null,
    required: Boolean(required),
    max,
    recipients: initial,
  });
  const fire = () => onChange?.(el.recipients, el.known);
  return {
    el,
    value: () => el.recipients,
    options: () => el.known,
    set(list) {
      el.recipients = list;
      fire();
    },
    add(recipient, text) {
      if (el.recipients.includes(recipient) || el.recipients.length >= max) return false;
      el.selection = [...el.selection, { value: recipient, label: text ?? labelFor(recipient) }];
      fire();
      return true;
    },
    setError(text) {
      el.error = text;
    },
  };
};

function labelFor(recipient) {
  const [kind, id] = String(recipient).split(":");
  return kind === "group" ? `Group ${id}` : `@${id}`;
}

/** Rough audience size from the picker's known options: people count one, groups their member count. */
export const audienceEstimate = (values, known) =>
  values.reduce((sum, v) => {
    const o = known.get(v);
    if (o?.kind === "group") return sum + (o.member_count ?? 0);
    return sum + 1;
  }, 0);

// ---- @mention completion for a textarea ----

/**
 * Suggest `@handle` while typing. `getPeople()` returns `[{ handle, display_name, avatar }]`.
 * Returns `{ list, destroy }`; place `list` after the textarea inside a relatively positioned host.
 */
export const attachMentions = (textarea, getPeople) => {
  const id = uid("mn");
  const list = h("ul", {
    class: "w-mention",
    role: "listbox",
    id,
    hidden: true,
    "aria-label": "Mention a person",
  });
  const status = h("p", { class: "sr-only", "aria-live": "polite" });
  let options = [];
  let active = 0;
  let range = null;

  const close = () => {
    list.hidden = true;
    options = [];
    range = null;
    textarea.removeAttribute("aria-activedescendant");
    textarea.removeAttribute("aria-controls");
  };
  const paint = () => {
    [...list.children].forEach((li, i) => {
      li.classList.toggle("is-active", i === active);
      li.setAttribute("aria-selected", String(i === active));
      if (i === active) textarea.setAttribute("aria-activedescendant", li.id);
    });
  };
  const pick = (p) => {
    if (!range) return;
    const v = textarea.value;
    const next = `${v.slice(0, range.start)}@${p.handle} ${v.slice(range.end)}`;
    const caret = range.start + p.handle.length + 2;
    textarea.value = next;
    textarea.setSelectionRange(caret, caret);
    close();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
  };
  const update = () => {
    const caret = textarea.selectionStart ?? 0;
    const before = textarea.value.slice(0, caret);
    const m = /(^|[\s(])@([a-z0-9-]{0,39})$/.exec(before);
    if (!m) return close();
    const token = m[2].toLowerCase();
    const start = caret - token.length - 1;
    const found = getPeople()
      .filter((p) => p.handle)
      .filter((p) => p.handle.startsWith(token) || p.display_name.toLowerCase().includes(token))
      .slice(0, 6);
    if (found.length === 0) return close();
    options = found;
    range = { start, end: caret };
    active = Math.min(active, found.length - 1);
    clear(list);
    found.forEach((p, i) => {
      const li = h(
        "li",
        { role: "option", id: `${id}-${i}`, class: "w-mention__opt", "aria-selected": "false" },
        avatar({ name: p.display_name, avatar: p.avatar, size: "xs" }),
        h("span", { class: "w-mention__name" }, p.display_name),
        h("span", { class: "w-mention__handle" }, `@${p.handle}`),
      );
      li.addEventListener("pointerdown", (e) => e.preventDefault());
      li.addEventListener("click", () => pick(p));
      list.append(li);
    });
    list.hidden = false;
    textarea.setAttribute("aria-controls", id);
    status.textContent = `${found.length} people to mention`;
    paint();
  };
  const onKey = (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      paint();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      pick(options[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  textarea.addEventListener("input", update);
  textarea.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") update();
  });
  textarea.addEventListener("keydown", onKey);
  textarea.addEventListener("blur", () => setTimeout(close, 120));
  const wrap = h("div", { class: "w-mention-wrap" }, list, status);
  return {
    list: wrap,
    destroy() {
      textarea.removeEventListener("input", update);
      textarea.removeEventListener("keydown", onKey);
    },
  };
};

// ---- attachment metadata ----

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/** AttachmentMeta for a File. The bytes are hashed in the browser and never sent. */
export const fileMeta = async (file) => {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return {
    file_name: file.name.slice(0, 200),
    media_type: /^[a-z]+\/[a-z0-9.+-]+$/.test(file.type) ? file.type : "application/octet-stream",
    size_bytes: file.size,
    sha256: hex(digest),
  };
};

/**
 * Attachments as metadata only. Returns `{ el, get(), reset() }`; `onChange(list)` after each change.
 */
export const attachmentPicker = ({ max = 10, onChange, label = "Attach files" } = {}) => {
  let items = [];
  let problem = "";
  const input = h("input", {
    type: "file",
    multiple: true,
    class: "sr-only",
    tabindex: "-1",
    "aria-hidden": "true",
  });
  const note = h("p", { class: "w-hint", role: "status" });
  const listEl = h("ul", { class: "w-attach__list", "aria-label": "Attached files" });
  const paint = () => {
    clear(listEl);
    items.forEach((a, i) => {
      listEl.append(
        h(
          "li",
          { class: "w-attach__item" },
          safeIcon("attachment", "link", { size: 16 }),
          h("span", { class: "w-attach__name" }, a.file_name),
          h("span", { class: "w-attach__meta u-tabular" }, fmtBytes(a.size_bytes)),
          iconButton({
            icon: "x",
            label: `Remove ${a.file_name}`,
            size: "sm",
            onClick: () => {
              items = items.filter((_, k) => k !== i);
              paint();
              onChange?.(items);
            },
          }),
        ),
      );
    });
    note.textContent =
      problem || (items.length ? "Only file details are sent. Contents are never stored." : "");
  };
  const choose = button({
    label,
    icon: "attachment",
    size: "sm",
    onClick: () => input.click(),
  });
  input.addEventListener("change", async () => {
    problem = "";
    for (const file of [...input.files]) {
      if (items.length >= max) {
        problem = `You can attach up to ${max} files.`;
        break;
      }
      if (file.size < 1) {
        problem = `${file.name} is empty.`;
        continue;
      }
      if (file.size > 50_000_000) {
        problem = `${file.name} is larger than 50 MB.`;
        continue;
      }
      try {
        items = [...items, await fileMeta(file)];
      } catch {
        problem = `${file.name} could not be read.`;
      }
    }
    input.value = "";
    paint();
    onChange?.(items);
  });
  const el = h(
    "div",
    { class: "w-attach" },
    h("div", { class: "w-attach__bar" }, input, choose),
    listEl,
    note,
  );
  paint();
  return {
    el,
    get: () => items,
    reset() {
      items = [];
      problem = "";
      paint();
    },
  };
};

// ---- notification type vocabulary (feed, bell, send, preferences) ----

export const NOTIFICATION_TYPES = {
  mention: { label: "Mentions", icon: "mention", tone: "info", group: "Messages" },
  message: { label: "Messages", icon: "inbox", tone: "info", group: "Messages" },
  approval_request: { label: "Approval requests", icon: "check-circle", tone: "warning", group: "Approvals" },
  approval_decision: { label: "Approval decisions", icon: "check", tone: "success", group: "Approvals" },
  points_awarded: { label: "Points awarded", icon: "coins", tone: "success", group: "Rewards" },
  points_expiring: { label: "Points expiring", icon: "clock", tone: "warning", group: "Rewards" },
  badge_earned: { label: "Badges earned", icon: "trophy", tone: "signal", group: "Rewards" },
  tier_changed: { label: "Tier changes", icon: "crown", tone: "signal", group: "Rewards" },
  order_status: { label: "Order updates", icon: "box", tone: "info", group: "Store" },
  automation_alert: { label: "Automation alerts", icon: "workflow", tone: "danger", group: "Work" },
  content_review: { label: "Content reviews", icon: "document", tone: "warning", group: "Work" },
  content_published: { label: "Content published", icon: "article", tone: "info", group: "Work" },
  task_assigned: { label: "Task assignments", icon: "task", tone: "info", group: "Work" },
  promotion_started: { label: "Promotions started", icon: "percent", tone: "info", group: "Store" },
  system: { label: "System notices", icon: "megaphone", tone: "neutral", group: "System" },
};

export const typeInfo = (type) =>
  NOTIFICATION_TYPES[type] ?? { label: type, icon: "bell", tone: "neutral", group: "System" };

/** One notification as a row body (icon, text, time). Used by the feed, the bell and the send preview. */
export const notificationRow = (n, { compact = false, now } = {}) => {
  const info = typeInfo(n.type);
  return h(
    "span",
    { class: `w-note w-note--${info.tone}` },
    h("span", { class: "w-note__icon" }, safeIcon(info.icon, "bell")),
    h(
      "span",
      { class: "w-note__text" },
      h("span", { class: "w-note__title" }, n.title),
      !compact && n.body ? h("span", { class: "w-note__body" }, n.body) : null,
      h(
        "span",
        { class: "w-note__meta" },
        h("span", {}, info.label),
        n.actor ? h("span", {}, n.actor.display_name) : null,
        h(
          "time",
          { datetime: n.created_at, title: when(n.created_at) },
          now ? relativeTime(n.created_at, now) : ago(n.created_at),
        ),
      ),
    ),
  );
};

// ---- global search vocabulary (search.results and the command palette) ----

import { artwork } from "../ds/js/artwork.js";

export const SEARCH_TYPES = {
  person: { label: "People", one: "Person", icon: "user" },
  group: { label: "Groups", one: "Group", icon: "group" },
  product: { label: "Products", one: "Product", icon: "tag" },
  badge: { label: "Badges", one: "Badge", icon: "trophy" },
  content: { label: "Content", one: "Content", icon: "article" },
  promotion: { label: "Promotions", one: "Promotion", icon: "percent" },
  automation: { label: "Automations", one: "Automation", icon: "workflow" },
  segment: { label: "Segments", one: "Segment", icon: "segment" },
  order: { label: "Orders", one: "Order", icon: "box" },
  task: { label: "Tasks", one: "Task", icon: "task" },
  thread: { label: "Conversations", one: "Conversation", icon: "inbox" },
  dashboard: { label: "Dashboards", one: "Dashboard", icon: "board" },
};
export const SEARCH_ORDER = Object.keys(SEARCH_TYPES);

/** The leading visual of a search hit: an avatar, generated artwork or the type icon. */
export const hitVisual = (hit, { size = "md" } = {}) => {
  if (hit.avatar) return avatar({ name: hit.title, avatar: hit.avatar, size });
  if (hit.artwork)
    return h("span", { class: "w-hitart" }, artwork(hit.artwork, { size: size === "md" ? 32 : 24 }));
  return h(
    "span",
    { class: "w-hitart w-hitart--icon" },
    safeIcon(hit.icon ?? SEARCH_TYPES[hit.type]?.icon, "search"),
  );
};
