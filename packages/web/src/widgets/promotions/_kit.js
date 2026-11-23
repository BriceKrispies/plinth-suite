// Shared helpers for package C (promotions, automation, content, segments, calendar). Not a widget:
// the manifest only looks up `<domain>/<name>.js` for catalogue ids, so underscore files are never mounted.
import { h, uid, announce } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { icon } from "../../ds/js/icons.js";
import { pill, statusPill } from "../../ds/js/pill.js";
import { delayedSkeleton, errorState } from "../../ds/js/states.js";
import { formErrors, textArea } from "../../ds/js/field.js";
import { dateTime, relativeTime } from "../../ds/js/format.js";
import { ApiError, toErrorInfo } from "../../core/api.js";
import { clockStore } from "../../core/stores.js";

export { toErrorInfo };

// ---- lifecycle: one place that owns every listener and timer a widget creates ----

export const lifecycle = () => {
  const offs = new Set();
  const timers = new Set();
  let dead = false;
  const life = {
    get dead() {
      return dead;
    },
    /** Register a cleanup (an `off` function from rt/bus, or any teardown). Returns it. */
    add(off) {
      offs.add(off);
      return off;
    },
    timeout(fn, ms) {
      const t = setTimeout(() => {
        timers.delete(t);
        if (!dead) fn();
      }, ms);
      timers.add(t);
      return t;
    },
    clear(t) {
      clearTimeout(t);
      timers.delete(t);
    },
    /** Wrap a callback so it does nothing after unmount. */
    guard:
      (fn) =>
      (...a) =>
        dead ? undefined : fn(...a),
    dispose() {
      dead = true;
      for (const off of offs) {
        try {
          off();
        } catch (e) {
          console.error(e);
        }
      }
      offs.clear();
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
  return life;
};

export const debounce = (life, fn, ms = 250) => {
  let t = 0;
  const run = (...a) => {
    life.clear(t);
    t = life.timeout(() => fn(...a), ms);
  };
  run.cancel = () => life.clear(t);
  return run;
};

/** Run async work into `host`: skeleton after 300 ms on the first load, aria-busy on later loads, error state with retry. */
export const asyncRegion = (
  host,
  life,
  { load, render, skeleton = { shape: "table", lines: 4 }, onError },
) => {
  let seq = 0;
  let first = true;
  const run = async () => {
    const mine = ++seq;
    let cancel = null;
    if (first) cancel = delayedSkeleton(host, skeleton);
    else host.setAttribute("aria-busy", "true");
    try {
      const data = await load();
      if (life.dead || mine !== seq) return;
      cancel?.();
      host.removeAttribute("aria-busy");
      first = false;
      host.replaceChildren();
      render(host, data);
    } catch (e) {
      if (life.dead || mine !== seq) return;
      cancel?.();
      host.removeAttribute("aria-busy");
      host.replaceChildren(errorState({ error: e, retry: run }));
      onError?.(e);
    }
  };
  run();
  return { reload: run, invalidate: () => ++seq };
};

// ---- time and text ----

export const nowIso = () => clockStore.get().virtual_now;
export const rel = (iso) => (iso ? relativeTime(iso, nowIso()) : "");
export const when = (iso) => (iso ? dateTime(iso) : "");

const p2 = (n) => String(n).padStart(2, "0");
/** ISO instant -> value for `datetime-local`, in UTC (the UI shows UTC, CONTRACT 1.5). */
export const toUtcInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
};
/** `datetime-local` value read as UTC -> ISO instant with Z. */
export const fromUtcInput = (v) => {
  if (!v) return "";
  const d = new Date(`${v}Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
};
export const addDays = (iso, days) => new Date(new Date(iso).getTime() + days * 86400000).toISOString();

export const dayKey = (iso) => String(iso).slice(0, 10);
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const FULL_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const enumLabel = (s) => {
  const t = String(s ?? "").replace(/[_.-]+/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const slugify = (text) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 63);

export const SLUG_RE = /^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/;

export const csv = (text) =>
  String(text ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export const numOr = (v, fallback) => (v === null || v === undefined || Number.isNaN(v) ? fallback : v);
/** Drop undefined, null and empty-string entries (shallow) so optional spec fields stay absent. */
export const prune = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ""));

export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const userSubject = (ctx) => {
  const handle = ctx.memberHandle("$me");
  return handle ? `user:${handle}` : "user:unknown";
};

// ---- errors ----

export const invalid = (path, message) => new ApiError({ code: "VALIDATION_FAILED", path, message });
export const isStale = (e) => {
  const info = toErrorInfo(e);
  return info.code === "CONFLICT" && (info.details?.reason === "STALE_VERSION" || !info.details?.reason);
};
export const reasonOf = (e) => toErrorInfo(e).details?.reason ?? null;

const REASONS = {
  INVALID_TRANSITION: "That change is not allowed from the current state",
  SELF_ACTION: "You cannot do this to your own item",
  NOT_ELIGIBLE: "You are not eligible for this",
  BUDGET_EXHAUSTED: "The budget is used up",
};
export const failToast = (ctx, e, title) => {
  const info = toErrorInfo(e);
  ctx.toast({
    title,
    body: REASONS[info.details?.reason] ? `${REASONS[info.details.reason]}. ${info.message}` : info.message,
    tone: "danger",
  });
};

// ---- small views ----

export const banner = ({ tone = "info", title, body, actions = [], role = "status" } = {}) =>
  h(
    "div",
    { class: `wk-banner wk-banner--${tone}`, role },
    h(
      "span",
      { class: "wk-banner__icon", "aria-hidden": "true" },
      icon(tone === "danger" || tone === "warning" ? "alert" : tone === "success" ? "check-circle" : "info", {
        size: 16,
      }),
    ),
    h(
      "div",
      { class: "wk-banner__text" },
      title ? h("strong", {}, title) : null,
      body ? h("span", {}, ` ${body}`) : null,
    ),
    actions.length ? h("div", { class: "wk-banner__actions" }, ...actions) : null,
  );

export const staleBanner = (onReload) =>
  banner({
    tone: "warning",
    title: "This changed while you were editing.",
    body: "Reload to see the latest version; your edits here will be lost.",
    actions: [button({ label: "Reload", size: "sm", onClick: onReload })],
  });

/** A group of toggle buttons acting as a single choice. */
export const segmented = ({ label, options, value, onChange, size = "sm" }) => {
  const root = h("div", { class: "wk-segmented", role: "group", "aria-label": label });
  let current = value;
  const draw = () => {
    root.replaceChildren(
      ...options.map((o) =>
        button({
          label: o.count === undefined ? o.label : `${o.label} (${o.count})`,
          size,
          variant: o.value === current ? "primary" : "secondary",
          pressed: o.value === current,
          onClick: () => {
            if (current === o.value) return;
            current = o.value;
            draw();
            onChange(current);
          },
        }),
      ),
    );
  };
  draw();
  root.setValue = (v) => {
    current = v;
    draw();
  };
  root.setCounts = (counts) => {
    for (const o of options) if (counts[o.value] !== undefined) o.count = counts[o.value];
    draw();
  };
  return root;
};

/** Multi-select chip filter (aria-pressed toggles). `onChange(values[])`. */
export const chipFilter = ({ label, options, value = [], onChange }) => {
  const root = h("div", { class: "wk-segmented", role: "group", "aria-label": label });
  let cur = new Set(value);
  const draw = () => {
    root.replaceChildren(
      ...options.map((o) =>
        button({
          label: o.count === undefined ? o.label : `${o.label} (${o.count})`,
          size: "sm",
          variant: cur.has(o.value) ? "primary" : "secondary",
          pressed: cur.has(o.value),
          onClick: () => {
            if (cur.has(o.value)) cur.delete(o.value);
            else cur.add(o.value);
            draw();
            onChange([...cur]);
          },
        }),
      ),
    );
  };
  draw();
  root.setCounts = (counts) => {
    for (const o of options) if (counts[o.value] !== undefined) o.count = counts[o.value];
    draw();
  };
  return root;
};

export const kv = (rows) =>
  h(
    "dl",
    { class: "wk-kv" },
    ...rows
      .filter((r) => r && r[1] !== null && r[1] !== undefined && r[1] !== "")
      .flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]),
  );

export const jsonBlock = (value, summary = "Details") =>
  h(
    "details",
    { class: "wk-json" },
    h("summary", {}, summary),
    h("pre", { class: "wk-json__pre" }, JSON.stringify(value, null, 2)),
  );

/** Add the arrival marker to a list item after a realtime change (never on first load). */
export const arrive = (life, el, withPill = true) => {
  if (!el) return;
  el.classList.add("u-arrive");
  if (withPill && !el.querySelector(":scope .wk-new"))
    el.querySelector(".wk-new-slot, td, .wk-row__main")?.append(
      h("span", { class: "wk-new" }, pill({ label: "New", tone: "signal" })),
    );
  life.timeout(() => el.classList.remove("u-arrive"), 6000);
};

export const sectionHeading = (text, level = 3) => h(`h${level}`, { class: "wk-heading" }, text);

export const iconText = (name, text) => h("span", { class: "wk-icon-text" }, icon(name, { size: 16 }), text);

export const displayPill = (display) => {
  if (display === "scheduled") return pill({ label: "Scheduled", tone: "info", icon: "clock" });
  if (display === "revising") return pill({ label: "Revising", tone: "warning", icon: "edit" });
  return statusPill("content", display === "live" ? "published" : display);
};

/** Pages a fully loaded array: returns `{ slice, hasNext, hasPrev, pages }`. */
export const pageOf = (items, page, size) => ({
  slice: items.slice(page * size, page * size + size),
  hasNext: (page + 1) * size < items.length,
  hasPrev: page > 0,
  pages: Math.max(1, Math.ceil(items.length / size)),
});

// ---- forms in a drawer ----

/**
 * A form in a drawer. `fields` are field nodes; `onSubmit({ form })` may throw (an ApiError, or `invalid(path, msg)`)
 * to show errors on the matching field `name` (a JSON pointer), or return `false` to keep the drawer open.
 */
export const openForm = (
  ctx,
  { title, width = "md", fields, intro, submitLabel = "Save", danger = false, onSubmit, onClose },
) => {
  const fid = uid("wkform");
  const form = h(
    "form",
    { class: "wk-form", id: fid, novalidate: true },
    ...[].concat(intro ?? []),
    ...[].concat(fields),
  );
  let drawer = null;
  let busy = false;
  const submit = button({ label: submitLabel, variant: danger ? "danger" : "primary", type: "submit" });
  submit.setAttribute("form", fid);
  const cancel = button({ label: "Cancel", onClick: () => drawer.close() });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    submit.setAttribute("aria-busy", "true");
    submit.disabled = true;
    formErrors(null, { form });
    try {
      const out = await onSubmit({ form, close: () => drawer.close() });
      if (out !== false) drawer.close();
    } catch (err) {
      const summary = formErrors(toErrorInfo(err), { form });
      summary?.focus?.();
    } finally {
      busy = false;
      submit.removeAttribute("aria-busy");
      submit.disabled = false;
    }
  });
  drawer = ctx.openDrawer({
    title,
    width,
    body: form,
    footer: h("div", { class: "wk-form__foot" }, cancel, submit),
    onClose,
  });
  return drawer;
};

/** Ask for a short note (optionally required) in a drawer. Resolves to the note, "" when optional and empty, or null when cancelled. */
export const promptNote = (
  ctx,
  { title, label = "Note", hint, required = false, submitLabel = "Confirm", danger = false, intro },
) =>
  new Promise((resolve) => {
    let value = "";
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    openForm(ctx, {
      title,
      width: "sm",
      intro,
      submitLabel,
      danger,
      fields: textArea({
        name: "/note",
        label,
        hint,
        required,
        rows: 4,
        onInput: (v) => {
          value = v;
        },
      }),
      onSubmit: async () => {
        if (required && value.trim() === "") throw invalid("/note", `${label} is required`);
        finish(value.trim());
      },
      onClose: () => finish(null),
    });
  });

// ---- the kernel node API, for saving what the builders edit ----

/** `{ uri, revision, slug, title, spec, body }` from a node read. */
export const readNode = async (api, ref) => {
  const v = await api.nodes.get(ref);
  return {
    uri: v.uri,
    revision: v.revision,
    slug: v.slug,
    title: v.body?.metadata?.title ?? v.slug,
    spec: v.body?.spec ?? {},
    body: v.body,
  };
};

/** All nodes of a kind as `{ slug, title, uri, revision, spec }`. */
export const listNodes = async (api, kind) =>
  (await api.nodes.list(kind)).map((n) => ({
    slug: n.slug ?? n.body?.metadata?.slug,
    title: n.body?.metadata?.title ?? n.title ?? n.slug,
    uri: n.uri,
    revision: n.revision,
    spec: n.body?.spec ?? n.spec ?? {},
  }));

/** Patch ops that turn `before` into `after` at the top level of `/spec`, skipping managed fields. */
export const specOps = (before, after, skip = []) => {
  const ops = [];
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (skip.includes(key)) continue;
    if (same(before?.[key], after?.[key])) continue;
    const path = `/spec/${key}`;
    if (after[key] === undefined) ops.push({ op: "remove", path });
    else ops.push({ op: "set", path, value: after[key] });
  }
  return ops;
};

/**
 * Create or patch a Suite node. `existing` is `{ uri, revision, title, spec }` or null for a new node.
 * Resolves `{ status, revision, approval_id }` (`status: "pending_approval"` when a rule holds the change).
 */
export const saveNode = async (api, { kind, slug, title, spec, existing, skip = [], reason, prefix }) => {
  const opts = {
    idempotency_key: api.idempotencyKey(prefix ?? `save-${kind.toLowerCase()}`),
    ...(reason ? { reason } : {}),
  };
  if (!existing) {
    const out = await api.nodes.create(
      kind,
      slug,
      { apiVersion: "plinth/v1", kind, metadata: { slug, title }, spec },
      opts,
    );
    return {
      status: out.status,
      revision: out.nodes?.[0]?.result_revision ?? 1,
      approval_id: out.approval_id,
      uri: out.nodes?.[0]?.uri,
    };
  }
  const ops = specOps(existing.spec, spec, skip);
  if (title !== existing.title) ops.push({ op: "set", path: "/metadata/title", value: title });
  if (ops.length === 0) return { status: "unchanged", revision: existing.revision, uri: existing.uri };
  const out = await api.nodes.patch(existing.uri, existing.revision, ops, opts);
  return {
    status: out.status,
    revision: out.nodes?.[0]?.result_revision ?? existing.revision,
    approval_id: out.approval_id,
    uri: existing.uri,
  };
};

/** Render the kernel history rows defensively (the row shape is the change log's). */
export const historyItems = (rows) =>
  rows.map((r) => ({
    title: r.ops_summary ?? r.summary ?? r.what ?? `Change ${r.seq ?? ""}`,
    at: r.at ?? r.occurred_at ?? r.recorded_at ?? null,
    actor: typeof r.actor === "string" ? r.actor : (r.actor?.display_name ?? r.actor?.subject ?? ""),
    rev: r.rev ?? r.revision ?? r.result_revision ?? null,
    seq: r.seq ?? null,
  }));

export const historyList = (rows, label = "Change history") => {
  const items = historyItems(rows);
  if (items.length === 0) return h("p", { class: "u-muted" }, "No recorded changes yet.");
  return h(
    "ol",
    { class: "wk-history", "aria-label": label },
    ...items.map((it) =>
      h(
        "li",
        { class: "wk-history__item" },
        h("p", { class: "wk-history__title" }, it.title),
        h(
          "p",
          { class: "wk-history__meta u-muted" },
          it.rev !== null ? `Revision ${it.rev}` : null,
          it.actor ? ` · ${it.actor}` : null,
          it.at ? ` · ${when(it.at)}` : null,
        ),
      ),
    ),
  );
};

export const say = announce;
