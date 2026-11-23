// Dashboard view controller: loads the board, reconciles panels, reacts to realtime changes.
import { h, clear } from "./dom.js";
import { toErrorInfo, verifyAudit } from "./api.js";
import { attributeCauses, loadBoard, signature } from "./board.js";
import { shortId } from "./events.js";
import { clock } from "./format.js";
import { href } from "./identity.js";
import { Panel } from "./panel.js";
import { connectRealtime } from "./rt.js";

const WINDOW_KEY = "incident_window";
const REFETCH_AUDIT_MS = 1500;

const parseWindow = (raw) => {
  if (!raw) return undefined;
  const [a, b] = raw.split("..").map((t) => Date.parse(t));
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : undefined;
};

const updateUrl = (patch) => {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  const text = q.toString();
  history.replaceState(null, "", `${location.pathname}${text ? `?${text}` : ""}`);
};

const coerce = (decl, raw) => {
  if (decl.type === "int") return Number.isNaN(Number.parseInt(raw, 10)) ? undefined : Number.parseInt(raw, 10);
  if (decl.type === "float") return Number.isNaN(Number.parseFloat(raw)) ? undefined : Number.parseFloat(raw);
  if (decl.type === "bool") return raw === "true";
  return raw;
};

const paramValues = (parameters) => {
  const q = new URLSearchParams(location.search);
  const out = {};
  for (const [name, decl] of Object.entries(parameters ?? {})) {
    const raw = q.get(`p.${name}`);
    const v = raw !== null ? coerce(decl, raw) : decl.default;
    if (v !== undefined) out[name] = v;
  }
  return out;
};

const notice = (kind, title, text, ...extra) =>
  h("div", { class: `notice notice--${kind}` }, h("h2", { class: "notice__title" }, title), text ? h("p", { class: "notice__text" }, text) : null, ...extra);

export const startDashboard = ({ main, slug, masthead, trace, inspector, announce }) => {
  let board;
  const panels = new Map();
  const pending = [];
  let inflight = false;
  let again = false;
  let auditTimer;

  // ---- static frame -----------------------------------------------------------------------
  const titleEl = h("h1", { class: "board__title", id: "board-title" }, slug);
  const meta = h("dl", { class: "board__meta" });
  const params = h("aside", { class: "params", "aria-label": "Board parameters and session state", hidden: true });
  const grid = h("section", { class: "board__grid", "aria-labelledby": "board-title", "aria-busy": "true" });
  const stage = h("div", { class: "board__stage" }, grid);
  const auditEl = h("dd", { class: "is-mono" }, "Checking");

  const skeleton = () =>
    grid.append(
      h("p", { class: "sr-only" }, "Loading board"),
      ...[0, 1, 2, 3].map((i) => h("div", { class: "panel panel--skeleton", "data-slot": String(i), "aria-hidden": "true" }, h("div", { class: "skeleton__bar" }), h("div", { class: "skeleton__block" }))),
    );

  clear(main).append(h("div", { class: "board__head" }, titleEl, meta), params, stage);
  skeleton();

  // ---- helpers ---------------------------------------------------------------------------
  const titles = () => {
    const m = new Map();
    if (board) {
      m.set(board.dashboard.uri, board.title);
      for (const p of board.panels) if (p.node) m.set(p.node.uri, p.title);
    }
    return m;
  };
  const titleOf = (uri) => titles().get(uri) ?? shortId(uri);

  const win = () => parseWindow(new URLSearchParams(location.search).get(WINDOW_KEY));

  const onBrush = (range) => {
    updateUrl({ [WINDOW_KEY]: range ? `${new Date(range[0]).toISOString()}..${new Date(range[1]).toISOString()}` : null });
    trace.session(range ? `brush ${WINDOW_KEY.replace("_", " ")} ${clock(range[0])} → ${clock(range[1])}` : `clear ${WINDOW_KEY.replace("_", " ")}`);
    renderParams();
    for (const p of panels.values()) p.refreshWindow();
  };

  const handlers = {
    getWindow: win,
    onBrush,
    onInspect: (panelSlug) => {
      const entry = board?.panels.find((p) => p.slug === panelSlug);
      if (!entry) return;
      updateUrl({ panel: panelSlug });
      inspector.open(entry, panels.get(panelSlug)?.menu.trigger);
    },
  };

  const renderParams = () => {
    clear(params);
    const decls = Object.entries(board?.parameters ?? {});
    const w = win();
    params.hidden = decls.length === 0 && !w;
    const q = new URLSearchParams(location.search);
    for (const [name, decl] of decls) {
      const current = q.get(`p.${name}`) ?? (decl.default === undefined ? "" : String(decl.default));
      const id = `param-${name}`;
      const input =
        decl.type === "bool"
          ? h("input", { id, type: "checkbox", checked: current === "true" })
          : h("input", { id, type: decl.type === "int" || decl.type === "float" ? "number" : "text", value: current, step: decl.type === "float" ? "any" : null });
      input.addEventListener("change", () => {
        const v = decl.type === "bool" ? String(input.checked) : input.value;
        updateUrl({ [`p.${name}`]: v === "" || v === String(decl.default ?? "") ? null : v });
        trace.session(`parameter ${name} = ${v === "" ? "default" : v}`);
        refresh();
      });
      params.append(h("div", { class: "param" }, h("label", { for: id }, name.replace(/_/g, " ")), input));
    }
    if (w) {
      params.append(
        h("p", { class: "param param--window" }, h("span", null, `Window ${clock(w[0])} → ${clock(w[1])}`), h("button", { type: "button", onclick: () => onBrush(null) }, "Clear window")),
      );
    }
  };

  const renderMeta = () => {
    clear(meta).append(
      h("div", null, h("dt", null, "Revision"), h("dd", null, String(board.dashboard.revision))),
      h("div", null, h("dt", null, "Panels"), h("dd", null, String(board.panels.length))),
      h("div", null, h("dt", null, "Audit chain"), auditEl),
    );
  };

  const checkAudit = async () => {
    try {
      const r = await verifyAudit();
      auditEl.textContent = r.ok === false ? "Broken" : `Verified${typeof r.checked === "number" ? `, ${r.checked} entries` : ""}`;
      auditEl.dataset.state = r.ok === false ? "bad" : "ok";
    } catch {
      auditEl.textContent = "Unavailable";
      auditEl.dataset.state = "bad";
    }
  };
  const scheduleAudit = () => {
    clearTimeout(auditTimer);
    auditTimer = setTimeout(checkAudit, REFETCH_AUDIT_MS);
  };

  // ---- reconciling -----------------------------------------------------------------------
  const place = (entry, panel) => {
    panel.el.style.setProperty("--x", entry.at.x + 1);
    panel.el.style.setProperty("--y", entry.at.y + 1);
    panel.el.style.setProperty("--w", entry.at.w);
    panel.el.style.setProperty("--h", entry.at.h);
  };

  const apply = (next, events) => {
    const first = board === undefined;
    const causes = attributeCauses(board, next, events);
    const prevSig = new Map((board?.panels ?? []).map((p) => [p.slug, signature(p)]));
    board = next;

    if (first) clear(grid);
    grid.removeAttribute("aria-busy");
    grid.style.setProperty("--cols", next.columns);
    titleEl.textContent = next.title;
    document.title = `${next.title} · Plinth`;
    masthead.setCurrent(next.title);

    const live = new Set(next.panels.map((p) => p.slug));
    for (const [key, panel] of panels) {
      if (live.has(key)) continue;
      panel.destroy();
      panel.el.remove();
      panels.delete(key);
    }
    for (const entry of next.panels) {
      let panel = panels.get(entry.slug);
      if (!panel) {
        panel = new Panel(entry, handlers);
        panels.set(entry.slug, panel);
        grid.append(panel.el);
      } else if (prevSig.get(entry.slug) !== signature(entry)) {
        panel.update(entry);
        inspector.refresh(entry);
      }
      place(entry, panel);
    }
    const wanted = next.panels.map((p) => panels.get(p.slug).el);
    const current = [...grid.children].filter((el) => el.classList.contains("panel"));
    if (wanted.some((el, i) => current[i] !== el)) grid.append(...wanted);
    next.panels.forEach((p, i) => panels.get(p.slug).setIndex(i + 1));

    grid.querySelector(".empty-board")?.remove();
    if (next.panels.length === 0) {
      grid.prepend(h("div", { class: "empty-board" }, h("h2", { class: "empty-board__title" }, "This board has no panels yet"), h("p", { class: "empty-board__text" }, "An agent can add panels over MCP. They will appear here as they are created, each one attributed to the change that caused it.")));
    }

    renderMeta();
    renderParams();
    trace.retitle();

    const notes = [];
    for (const [key, cause] of causes) {
      panels.get(key)?.showCause(cause);
      const p = next.panels.find((q) => q.slug === key);
      notes.push(`${cause.isNew ? "Panel added" : "Panel changed"}: ${p.title}, change ${cause.event.seq}.`);
    }
    if (notes.length > 0) announce(notes.join(" "));
  };

  // ---- loading ---------------------------------------------------------------------------
  const showFailure = (err) => {
    const info = toErrorInfo(err);
    clear(stage).append(
      notice("error", "Could not load this board", `${info.code}: ${info.message}`, h("button", { type: "button", class: "button", onclick: () => location.reload() }, "Try again")),
    );
  };

  const showNotFound = () => {
    titleEl.textContent = "Unknown board";
    document.title = "Unknown board · Plinth";
    masthead.setCurrent("Unknown board");
    clear(meta);
    clear(stage).append(
      notice("empty", "No dashboard named “" + slug + "”", "It may have been renamed or removed, or your identity may not be able to see it.", h("a", { class: "button", href: href({}) }, "Back to all boards")),
    );
  };

  const refresh = async () => {
    if (inflight) {
      again = true;
      return;
    }
    inflight = true;
    try {
      do {
        again = false;
        let loaded = await loadBoard(slug, paramValues(board?.parameters));
        // The first load does not know the declared parameters yet; rerun once with their values.
        if (loaded && !board && Object.keys(loaded.parameters).length > 0) {
          loaded = await loadBoard(slug, paramValues(loaded.parameters));
        }
        const events = pending.splice(0);
        if (!loaded) {
          if (!board) return showNotFound();
          continue;
        }
        apply(loaded, events);
      } while (again);
    } catch (err) {
      if (!board) showFailure(err);
    } finally {
      inflight = false;
    }
  };

  // ---- realtime --------------------------------------------------------------------------
  const stop = connectRealtime({
    onState: (state, info) => {
      masthead.setConnection(state, info);
      if (state === "live" && info.resumed) refresh();
    },
    onHead: (seq) => {
      masthead.setHead(seq);
      trace.setHead(seq);
      masthead.refreshHead();
    },
    onEvents: (items) => {
      const shown = items.filter((e) => e.kind !== "present");
      if (shown.length === 0) return;
      trace.push(shown);
      pending.push(...shown);
      refresh();
      scheduleAudit();
    },
  });

  const requested = new URLSearchParams(location.search).get("panel");
  refresh().then(() => {
    checkAudit();
    const entry = requested && board?.panels.find((p) => p.slug === requested);
    if (entry) inspector.open(entry, panels.get(entry.slug)?.menu.trigger);
  });

  return { stop, titleOf };
};
