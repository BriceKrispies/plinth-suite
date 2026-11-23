import { toErrorInfo } from "./api.js";
import { attributeCauses, loadBoard } from "./board.js";
import { h } from "./dom.js";
import { clock } from "./format.js";
import { pageHref, patchSearch, search } from "./url.js";
import { createPanel } from "./panel.js";
import { actorLabel, shortId, tagOf } from "./trace.js";

const WINDOW_KEY = "incident_window";
const paramKey = (name) => `p.${name}`;

const parseWindow = (raw) => {
  const [a, b] = (raw ?? "").split("..");
  const from = a ? new Date(a).getTime() : NaN;
  const to = b ? new Date(b).getTime() : NaN;
  return Number.isNaN(from) || Number.isNaN(to) ? undefined : [from, to];
};

const coerce = (decl, raw) => {
  if (decl.type === "int" || decl.type === "float") {
    const n = decl.type === "int" ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
    return Number.isNaN(n) ? undefined : n;
  }
  return decl.type === "bool" ? raw === "true" : raw;
};

/** Parameter values: the URL first, then the declared default, typed per the declaration. */
const paramValues = (parameters) => {
  const q = search();
  const out = {};
  for (const [name, decl] of Object.entries(parameters ?? {})) {
    const raw = q.get(paramKey(name));
    const value = raw === null ? decl.default : coerce(decl, raw);
    if (value !== undefined) out[name] = value;
  }
  return out;
};

const byPosition = (a, b) => a.at.y - b.at.y || a.at.x - b.at.x;

const emptyState = ({ title, body, action }) =>
  h("div", { class: "empty" },
    h("span", { class: "plates", "aria-hidden": "true" }, h("i"), h("i"), h("i")),
    h("h2", { class: "empty__title" }, title),
    h("p", { class: "empty__body" }, body),
    action ?? null);

const skeleton = () =>
  [0, 1, 2, 3].map((i) =>
    h("section", { class: "panel panel--skeleton", "aria-busy": "true", "aria-label": "Loading panel",
      style: `--x:${(i % 2) * 6};--y:${Math.floor(i / 2) * 4};--w:6;--h:4`, dataset: { state: "loading", visual: "chart" } },
    h("div", { class: "skeleton", "aria-hidden": "true" })));

/** The dashboard screen: board header, parameters, the panel grid, and every realtime consequence. */
export function mountDashboard(ui, slug) {
  const { main, header, trace, banner, announce, inspector } = ui;
  const controllers = new Map();
  const events = new Map();
  let board;
  let paramsKey = "";
  let loading = false;
  let again = false;
  let pending = [];

  const titleEl = h("h1", { class: "board__title" }, slug);
  const metaEl = h("p", { class: "board__meta" });
  const tools = h("div", { class: "board__tools" });
  const notice = h("div", { class: "board__notice" });
  const grid = h("section", { class: "board", "aria-label": "Panels" }, ...skeleton());
  main.replaceChildren(
    h("div", { class: "board__head" },
      h("div", { class: "board__heading" }, h("p", { class: "eyebrow" }, "Dashboard"), titleEl, metaEl), tools),
    notice, grid);
  trace.show();

  const titleOf = (uri) => board?.titles.get(uri) ?? shortId(uri);
  const getWindow = () => parseWindow(search().get(WINDOW_KEY));

  const onBrush = (range) => {
    patchSearch({ [WINDOW_KEY]: range ? `${new Date(range[0]).toISOString()}..${new Date(range[1]).toISOString()}` : null });
    trace.addSession(range ? `brush ${WINDOW_KEY.replace("_", " ")} ${clock(range[0])} → ${clock(range[1])}` : `cleared ${WINDOW_KEY.replace("_", " ")}`);
    renderTools();
    for (const c of controllers.values()) if (c.usesWindow) c.rerender();
  };

  const onInspect = (entry, opener) => inspector.open(entry, opener);

  const renderTools = () => {
    const parameters = Object.entries(board?.parameters ?? {});
    const win = getWindow();
    tools.replaceChildren(
      parameters.length === 0 ? null : h("fieldset", { class: "params" },
        h("legend", { class: "sr-only" }, "Dashboard parameters"),
        parameters.map(([name, decl]) => {
          const current = search().get(paramKey(name)) ?? (decl.default === undefined ? "" : String(decl.default));
          const commit = (value) => {
            patchSearch({ [paramKey(name)]: value === "" || value === String(decl.default ?? "") ? null : value });
            trace.addSession(`parameter ${name.replace(/_/g, " ")} = ${value === "" ? "default" : value}`);
            refresh();
          };
          const input = decl.type === "bool"
            ? h("input", { type: "checkbox", checked: current === "true", onChange: (e) => commit(e.target.checked ? "true" : "false") })
            : h("input", {
                type: "text", value: current, inputmode: decl.type === "int" || decl.type === "float" ? "decimal" : "text",
                onChange: (e) => commit(e.target.value.trim()),
              });
          return h("label", { class: "field" }, h("span", { class: "field__label" }, name.replace(/_/g, " ")), input);
        })),
      win ? h("p", { class: "chip" },
        h("span", null, `Window ${clock(win[0])} → ${clock(win[1])}`),
        h("button", { class: "chip__clear", type: "button", "aria-label": "Clear window", onClick: () => onBrush(null) }, "×")) : null);
  };

  const who = (seq) => {
    const e = events.get(seq);
    if (!e) return "a change";
    return tagOf(e) === "live" ? actorLabel(e.actor) : `${actorLabel(e.actor)} (${tagOf(e)})`;
  };

  const render = (causes) => {
    const panels = [...board.panels].sort(byPosition);
    grid.removeAttribute("aria-busy");
    grid.querySelectorAll(".panel--skeleton").forEach((n) => n.remove());
    const live = new Set(panels.map((p) => p.slug));
    for (const [key, c] of controllers) {
      if (!live.has(key)) { c.destroy(); controllers.delete(key); }
    }
    panels.forEach((entry, i) => {
      let c = controllers.get(entry.slug);
      if (!c) {
        c = createPanel({ onInspect, getWindow, onBrush });
        controllers.set(entry.slug, c);
      }
      c.update(entry);
      if (grid.children[i] !== c.el) grid.insertBefore(c.el, grid.children[i] ?? null);
      const cause = causes.get(entry.slug);
      if (cause) c.showCause({ ...cause, who: who(cause.seq) });
    });

    titleEl.textContent = board.title;
    document.title = `${board.title} · Plinth`;
    header.setCrumb(board.title);
    metaEl.textContent = `${board.dashboard.slug} · revision ${board.dashboard.revision} · ${panels.length} ${panels.length === 1 ? "panel" : "panels"}`;
    const key = JSON.stringify(board.parameters);
    if (key !== paramsKey) { paramsKey = key; renderTools(); }
    notice.replaceChildren(panels.length === 0
      ? emptyState({ title: "This board has no panels yet", body: "Panels an agent adds will rise into place here, each marked with the change that caused it." })
      : "");

    if (causes.size > 0) {
      announce([...causes].map(([key2, c]) => `Panel ${board.panels.find((p) => p.slug === key2)?.title ?? key2} ${c.kind} by ${who(c.seq)}, change ${c.seq}.`).join(" "));
    }
    inspector.sync(panels);
  };

  const renderMissing = () => {
    for (const c of controllers.values()) c.destroy();
    controllers.clear();
    grid.replaceChildren();
    titleEl.textContent = "Dashboard not found";
    metaEl.textContent = "";
    tools.replaceChildren();
    header.setCrumb(null);
    document.title = "Not found · Plinth";
    notice.replaceChildren(emptyState({
      title: "Unknown dashboard",
      body: `No dashboard is named “${slug}”. It may have been renamed, or your identity may not be allowed to see it.`,
      action: h("a", { class: "btn", href: pageHref() }, "Back to all dashboards"),
    }));
  };

  async function refresh() {
    if (loading) { again = true; return; }
    loading = true;
    try {
      const batch = pending;
      pending = [];
      const next = await loadBoard(slug, paramValues);
      const causes = next ? attributeCauses(board, next, batch) : new Map();
      board = next;
      banner.set("load", null);
      if (board) render(causes);
      else renderMissing();
      trace.retitle(titleOf);
    } catch (e) {
      const info = toErrorInfo(e);
      banner.set("load", { tone: "bad", title: "Could not load this dashboard.", message: `${info.code}: ${info.message}`, action: { label: "Retry", run: refresh } });
      grid.querySelectorAll(".panel--skeleton").forEach((n) => n.remove());
    } finally {
      loading = false;
      if (again) { again = false; refresh(); }
    }
  }

  refresh();
  if (search().get("panel")) {
    // Deep link: open the inspector once the first board arrives.
    const wait = setInterval(() => {
      if (!board) return;
      clearInterval(wait);
      const entry = board.panels.find((p) => p.slug === search().get("panel"));
      if (entry) inspector.open(entry);
    }, 100);
    setTimeout(() => clearInterval(wait), 10_000);
  }

  return {
    onEvents(items) {
      const shown = items.filter((e) => e.kind !== "present");
      if (shown.length === 0) return;
      for (const e of shown) events.set(e.seq, e);
      pending.push(...shown);
      trace.add(shown, titleOf);
      refresh();
    },
  };
}
