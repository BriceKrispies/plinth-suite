// The page host (UI-MAP 3.2): resolves a path to a Page, lays its widgets out on the 12-column grid, mounts
// them through the widget runtime and keeps the page live from the change stream.
import * as api from "./api.js";
import * as rt from "./rt.js";
import * as router from "./router.js";
import { createBus } from "./bus.js";
import { resolveBindings, effectiveSize, catalogEntry } from "./widgets.js";
import { meStore } from "./stores.js";
import { h, announce } from "../ds/js/dom.js";
import { pageHeader } from "../ds/js/layout.js";
import { button } from "../ds/js/button.js";
import { emptyState, errorState } from "../ds/js/states.js";
import { toast } from "../ds/js/toast.js";
import { confirmDialog } from "../ds/js/dialog.js";
import { transition, supported as canTransition, vtName } from "./transition.js";

/** Routes that are not Pages (the styleguide): `(path, query) => { match: Params | null }`-style, see addClientRoute. */
const clientRoutes = [];

/**
 * Register a client-only route. `pattern` is a path with `:params`; `render(el, { params, query })` fills
 * `el` and returns `{ title, dispose? }`. Client routes win over `pages.resolve`.
 */
export const addClientRoute = (pattern, render) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:([a-z_]+)/g, (_, k) => (keys.push(k), "([^/]+)"))}/?$`);
  clientRoutes.push({ re, keys, render });
};

const matchClient = (path) => {
  for (const r of clientRoutes) {
    const m = r.re.exec(path);
    if (m) return { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
};

let live = null; // the page currently shown: { dispose() }
let token = 0;

const WIDGET_KEY = (item) => item.node?.uri ?? item.item;

/** `--_vt` names the cell for view transitions (transitions.css applies it only while a live reconcile runs). */
const gridVars = (at, item) => {
  const x6 = Math.floor(at.x / 2) + 1;
  const w6 = Math.max(1, Math.min(Math.ceil(at.w / 2), 7 - x6));
  const vt = item ? `;--_vt:${vtName("w", item.node?.slug ?? WIDGET_KEY(item))}` : "";
  return `--x:${at.x + 1};--y:${at.y + 1};--w:${at.w};--h:${at.h};--x6:${x6};--w6:${w6}${vt}`;
};

/** Give a cell that arrived live the enter animation (live-build.css), removed once it has played. Used only where view transitions are unavailable. */
export const enterAnimation = (el) => {
  el.classList.add("is-entering");
  const done = () => el.classList.remove("is-entering");
  el.addEventListener("animationend", done, { once: true });
  setTimeout(done, 800);
  return el;
};

/** How long a live change stays marked on its cell (`data-live-change`). */
const LIVE_CHANGE_MS = 2500;

/** A change frame (`{ actor, surface, ... }`, spec ChangeEvent) made by an agent: an `agent:` actor or the MCP surface. */
const changeSource = (c) =>
  String(c?.actor ?? "").startsWith("agent:") || c?.surface === "mcp" ? "agent" : "human";

const liveTimers = new WeakMap();
/**
 * Mark `cell` as just changed by a person or an agent: sets `data-live-change="human" | "agent"` for LIVE_CHANGE_MS,
 * then removes it. A new change restarts the clock (and the value if the source differs).
 */
export const markLiveChange = (cell, source) => {
  clearTimeout(liveTimers.get(cell));
  cell.setAttribute("data-live-change", source);
  liveTimers.set(
    cell,
    setTimeout(() => {
      cell.removeAttribute("data-live-change");
      liveTimers.delete(cell);
    }, LIVE_CHANGE_MS),
  );
};

const byPosition = (a, b) => a.at.y - b.at.y || a.at.x - b.at.x;

/**
 * Lay the visible items out. Items sharing a row band share the 12 columns proportionally when some of the
 * band was hidden from this viewer; items that size to their content take `rowsFor(item)` rows (a band shares
 * its tallest); then every item slides up until it touches the one above it. Returns Map(item -> at).
 */
const arrange = (all, shown, rowsFor) => {
  const hidden = all.length - shown.length;
  const bands = new Map();
  for (const i of shown) {
    const k = `${i.at.y}:${i.at.h}`;
    bands.set(k, [...(bands.get(k) ?? []), i]);
  }
  const geo = new Map();
  for (const row of bands.values()) {
    row.sort((a, b) => a.at.x - b.at.x);
    const total = row.reduce((n, i) => n + i.at.w, 0);
    const h = Math.max(...row.map(rowsFor));
    let x = 0;
    row.forEach((i, k) => {
      const w =
        hidden === 0
          ? i.at.w
          : k === row.length - 1
            ? 12 - x
            : Math.max(1, Math.round((i.at.w / total) * 12));
      geo.set(i, { ...i.at, x: hidden === 0 ? i.at.x : x, w, h });
      x += w;
    });
  }
  const placed = [];
  const out = new Map();
  for (const i of [...shown].sort(byPosition)) {
    const g = geo.get(i);
    const y = placed
      .filter((p) => p.x < g.x + g.w && g.x < p.x + p.w)
      .reduce((n, p) => Math.max(n, p.y + p.h), 0);
    const at = { ...g, y };
    placed.push(at);
    out.set(i, at);
  }
  return out;
};

const CARD_MAX_ROWS = 14;
const px = (v) => Number.parseFloat(v) || 0;
const narrow = matchMedia("(max-width: 47.99rem)");

/**
 * Let a widget shrink to the rows its content needs. Observes the widget body's children; when the content is
 * shorter than the cell, records the rows it needs and asks the page to re-lay out. Cards grow to CARD_MAX_ROWS at most, rule widgets without limit.
 * Returns a function that stops observing.
 */
const fitToContent = (cell, widget, keyOf, baseRows, grows, needed, relayout) => {
  if (typeof ResizeObserver !== "function") return null;
  const body = widget.frame.body;
  const frame = widget.frame.element;
  let raf = 0;
  const measure = () => {
    raf = 0;
    const grid = cell.parentElement;
    if (!grid || narrow.matches || body.hidden) return;
    const cs = getComputedStyle(grid);
    const row = px(cs.gridAutoRows);
    const gap = px(cs.rowGap);
    if (!row || body.children.length === 0) return;
    const bs = getComputedStyle(body);
    let content = 0;
    for (const c of body.children) {
      const m = getComputedStyle(c);
      content += c.offsetHeight + px(m.marginTop) + px(m.marginBottom);
    }
    const chrome = frame.offsetHeight - body.clientHeight + px(bs.paddingTop) + px(bs.paddingBottom);
    body.classList.toggle("is-clipped", body.scrollHeight > body.clientHeight + 2);
    const want = Math.max(2, Math.ceil((chrome + content - 3 + gap) / (row + gap)));
    // Cards may grow to a cap (a form should not be clipped); rule-chrome widgets grow without one.
    const rows = grows ? want : Math.min(Math.max(baseRows(), CARD_MAX_ROWS), want);
    const key = keyOf();
    if (needed.get(key) === rows || (rows === baseRows() && !needed.has(key))) return;
    needed.set(key, rows);
    relayout();
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(measure);
  };
  const ro = new ResizeObserver(schedule);
  const watch = () => {
    ro.disconnect();
    ro.observe(body);
    for (const c of body.children) ro.observe(c);
    schedule();
  };
  const mo = new MutationObserver(watch);
  mo.observe(body, { childList: true });
  watch();
  return () => {
    ro.disconnect();
    mo.disconnect();
    if (raf) cancelAnimationFrame(raf);
  };
};

const headerActions = (res, rerender) => {
  const { spec, page } = res;
  const out = [];
  const personalisable =
    (spec.kind === "home" || spec.kind === "profile") && !String(spec.route ?? "").includes(":");
  if (res.personal_of) {
    out.push(
      button({
        label: "Reset to default",
        icon: "history",
        onClick: async () => {
          if (
            !(await confirmDialog({
              title: "Reset this page?",
              message: "Your customised layout is removed and the shared default returns.",
              confirmLabel: "Reset",
            }))
          )
            return;
          try {
            await api.call("pages.reset", { page: res.personal_of.slug });
            announce("Page reset to default");
            rerender();
          } catch (e) {
            toast({ title: "Could not reset the page", body: e.message, tone: "danger" });
          }
        },
      }),
    );
  } else if (personalisable) {
    out.push(
      button({
        label: "Customise",
        icon: "sliders",
        onClick: async () => {
          try {
            await api.call("pages.personalize", { page: page.slug });
            announce("You can now customise this page");
            rerender();
          } catch (e) {
            if (e.details?.reason === "ALREADY_EXISTS") rerender();
            else toast({ title: "Could not customise the page", body: e.message, tone: "danger" });
          }
        },
      }),
    );
  }
  if (res.editable)
    out.push(
      button({
        label: "Edit page",
        icon: "edit",
        variant: "secondary",
        onClick: () => router.navigate(`/pages/${page.slug}/edit`),
      }),
    );
  return out;
};

const renderPage = (main, res, query) => {
  const bus = createBus();
  const me = meStore.get();
  const params = { ...res.params, ...Object.fromEntries(Object.entries(query).filter(([k]) => k !== "as")) };
  const pageInfo = { slug: res.page.slug, kind: res.spec.kind, editable: res.editable };
  const mounted = new Map(); // key -> { widget, cell, item, fit }
  const grid = h("div", { class: "c-page-grid", "data-page": res.page.slug });
  const host = h("div", { class: "c-page-host" });

  const available = (items) => items.filter((i) => i.available).sort(byPosition);
  let placement = new Map();
  let latest = res.items;
  const needed = new Map(); // item key -> rows its content needs (widgets size to content, never beyond `at.h`)
  const rowsFor = (item) => needed.get(WIDGET_KEY(item)) ?? item.at.h;
  const place = (all) => {
    latest = all;
    placement = arrange(all, available(all), rowsFor);
  };
  const atOf = (item) => placement.get(item) ?? item.at;
  place(res.items);
  const relayout = () => {
    place(latest);
    for (const [, have] of mounted) have.cell.setAttribute("style", gridVars(atOf(have.item), have.item));
  };

  /** Config and size go to the element as attributes; it applies them (module `update` or remount). */
  const syncAttributes = (widget, item) => {
    widget.setAttribute("config", JSON.stringify(resolveBindings(item.config, params, me)));
    widget.setAttribute("size", effectiveSize(item.widget, item.size));
  };

  const mountItem = (item, arrived) => {
    const cell = h("div", {
      class: "c-page-grid__item",
      style: gridVars(atOf(item), item),
      "data-item": item.item,
    });
    const widget = document.createElement("plinth-widget");
    widget.host = {
      bus,
      params,
      page: pageInfo,
      instance: item.node ? { uri: item.node.uri, slug: item.node.slug, title: item.title } : undefined,
      title: item.title,
      arrived,
      onRemove: item.node ? () => removeItem(item) : undefined,
    };
    widget.setAttribute("type", item.widget);
    widget.setAttribute("page", pageInfo.slug);
    if (item.node) widget.setAttribute("instance", item.node.slug);
    syncAttributes(widget, item);
    cell.append(widget);
    const entry = { widget, cell, item, fit: null };
    mounted.set(WIDGET_KEY(item), entry);
    // the element builds its frame when it connects (the cell may not be in the document yet): measure once it exists
    cell.addEventListener("plinth-widget:mount", () => {
      entry.fit?.();
      entry.fit = fitToContent(
        cell,
        widget,
        () => WIDGET_KEY(entry.item),
        () => entry.item.at.h,
        // rule-chrome widgets (full width on module pages) grow to their content; cards stop at CARD_MAX_ROWS
        effectiveSize(entry.item.widget, entry.item.size) === "full" && pageInfo?.kind === "module",
        needed,
        relayout,
      );
    });
    return cell;
  };

  const removeItem = async (item) => {
    try {
      const fresh = await api.call("pages.resolve", { page: res.page.slug });
      const index = fresh.spec.layout.items.findIndex((i) => i.item === item.item);
      if (index < 0) return;
      await api.nodes.patch(res.page.uri, fresh.page.revision, [
        { op: "remove", path: `/layout/items/${index}` },
      ]);
    } catch (e) {
      toast({ title: "Could not remove the widget", body: e.message, tone: "danger" });
    }
  };

  const reconcile = (next) => {
    if (!grid.isConnected) {
      host.querySelector(".c-state")?.remove();
      host.append(grid);
    }
    place(next.items);
    const wanted = available(next.items);
    const seen = new Set();
    for (const item of wanted) {
      const key = WIDGET_KEY(item);
      seen.add(key);
      const have = mounted.get(key);
      if (!have) {
        {
          const cell = mountItem(item, true);
          grid.append(canTransition() ? cell : enterAnimation(cell));
          markLiveChange(cell, lastSource);
        }
        continue;
      }
      const style = gridVars(atOf(item), item);
      const moved = have.cell.getAttribute("style") !== style;
      const configBefore = have.widget.getAttribute("config");
      have.cell.setAttribute("style", style);
      syncAttributes(have.widget, item);
      if (moved || have.widget.getAttribute("config") !== configBefore) markLiveChange(have.cell, lastSource);
      have.item = item;
    }
    for (const [key, have] of [...mounted]) {
      if (seen.has(key)) continue;
      have.fit?.();
      needed.delete(key);
      have.widget.unmount();
      have.cell.remove();
      mounted.delete(key);
    }
    // Re-order the DOM to (y, x) so the one-column reading order follows the layout.
    for (const item of wanted) {
      const have = mounted.get(WIDGET_KEY(item));
      if (have) grid.append(have.cell);
    }
  };

  /** Would reconciling `next` add, remove or move a cell? Only then is a view transition worth running. */
  const layoutChanges = (next) => {
    const wanted = available(next.items);
    if (wanted.length !== mounted.size) return true;
    const tmp = arrange(next.items, wanted, rowsFor);
    return wanted.some((item) => {
      const have = mounted.get(WIDGET_KEY(item));
      return !have || have.cell.getAttribute("style") !== gridVars(tmp.get(item), item);
    });
  };

  const items = available(res.items);
  for (const item of items) grid.append(mountItem(item, false));
  if (items.length === 0) {
    const withheldAll = res.items.length > 0;
    host.append(
      emptyState({
        icon: withheldAll ? "lock" : "board",
        title: withheldAll ? "Not available to your role" : "Nothing on this page yet",
        body: withheldAll
          ? "Every widget on this page needs a permission your role does not include. Ask an administrator for access."
          : res.editable
            ? "Use Edit page to add widgets."
            : "Widgets appear here when they are added.",
      }),
    );
  }

  host.prepend(
    pageHeader({
      title: res.page.title,
      meta: res.spec.description ? [res.spec.description] : [],
      actions: headerActions(res, () => router.refresh()),
    }),
  );
  if (items.length > 0) host.append(grid);
  const withheld = res.items.length - items.length;
  if (items.length > 0 && withheld > 0)
    host.append(
      h(
        "p",
        { class: "c-page-host__note", role: "note" },
        `${withheld} ${withheld === 1 ? "widget is" : "widgets are"} hidden because your role does not include ${withheld === 1 ? "it" : "them"}.`,
      ),
    );
  main.replaceChildren(host);

  // Live: a change to the page node re-lays out; a change to one of its widget nodes updates that widget.
  let timer = 0;
  let pending = false;
  const refetch = async () => {
    if (pending) return;
    pending = true;
    try {
      const next = await api.call("pages.resolve", { path: router.current().path });
      if (next.page.uri !== res.page.uri) router.refresh();
      else if (canTransition() && layoutChanges(next))
        await transition(() => reconcile(next), { kind: "live" });
      else reconcile(next);
    } catch (e) {
      // the page was removed (the site was cleared): show the empty-site state
      if (e?.code === "UNKNOWN_REFERENCE") router.refresh();
      /* otherwise a transient failure: the next change retries */
    } finally {
      pending = false;
    }
  };
  // Who made the latest change: the cells it touches carry `data-live-change` = "human" | "agent" for a moment.
  // A change to a widget node marks its cell at once; one to the page node marks the cells the re-layout moves or adds.
  let lastSource = "human";
  const offChange = rt.onChange(
    (c) => c.node === res.page.uri || c.node === res.personal_of?.uri || mounted.has(c.node),
    (c) => {
      lastSource = changeSource(c);
      const touched = mounted.get(c.node);
      if (touched) markLiveChange(touched.cell, lastSource);
      clearTimeout(timer);
      timer = setTimeout(refetch, 150);
    },
  );
  const onNarrow = () => {
    for (const { widget, item } of mounted.values()) syncAttributes(widget, item);
  };
  const mq = matchMedia("(max-width: 47.99rem)");
  mq.addEventListener("change", onNarrow);

  return {
    /** A `present` frame named `uri`: outline and scroll to its cell if this page shows it. */
    present(uri) {
      const have = mounted.get(uri);
      if (!have) return false;
      markLiveChange(have.cell, "agent");
      have.cell.scrollIntoView({ block: "center", behavior: "smooth" });
      return true;
    },
    dispose() {
      clearTimeout(timer);
      offChange();
      mq.removeEventListener("change", onNarrow);
      for (const { widget, cell, fit } of mounted.values()) {
        fit?.();
        widget.unmount();
        clearTimeout(liveTimers.get(cell));
      }
      mounted.clear();
      bus.dispose();
    },
  };
};

/**
 * Show a node the agent presented: outline its widget on the current page, else open the Page node's route.
 * Returns whether anything was shown (a node with no screen is ignored).
 */
export const presentNode = async (uri) => {
  if (live?.present?.(uri)) return true;
  const { items } = await api.call("pages.list");
  const page = items.find((p) => p.page.uri === uri && p.route && !p.route.includes(":"));
  if (!page) return false;
  await router.navigate(page.route);
  return true;
};

/** Page changes announced by the change stream (a page created, changed or removed). */
const isPageChange = (c) => String(c.node).includes("/Page/");

/**
 * No page serves this path: the site is cleared (pages.list is empty) or the page is not built yet. Shows the
 * empty-site state or the normal not-found, and watches Page changes: when a page for this path appears the route
 * runs again, so it renders live. Returns `{ empty }`, or null when pages.list could not be read.
 */
const showMissing = async (main, path, mine) => {
  let empty;
  try {
    empty = (await api.call("pages.list")).items.length === 0;
  } catch {
    return null;
  }
  if (mine !== token) return { empty };
  live?.dispose();
  const draw = (isEmpty) =>
    main.replaceChildren(
      isEmpty
        ? h(
            "div",
            { class: "c-site-empty", role: "status" },
            h("h1", { class: "c-site-empty__title" }, "This workspace is empty"),
            h("p", { class: "c-site-empty__note" }, "Pages appear here as they are built."),
          )
        : h(
            "div",
            { class: "c-page-host" },
            pageHeader({ title: "Page not found" }),
            emptyState({
              icon: "search",
              title: "There is nothing at this address",
              body: path,
              action: button({ label: "Go home", variant: "primary", onClick: () => router.navigate("/") }),
            }),
          ),
    );
  main.removeAttribute("aria-busy");
  draw(empty);
  let timer = 0;
  const recheck = async () => {
    try {
      await api.call("pages.resolve", { path });
      router.refresh();
      return;
    } catch {
      /* still missing */
    }
    try {
      const now = (await api.call("pages.list")).items.length === 0;
      if (now !== empty) {
        empty = now;
        draw(now);
      }
    } catch {
      /* the next change retries */
    }
  };
  const off = rt.onChange(isPageChange, () => {
    clearTimeout(timer);
    timer = setTimeout(recheck, 150);
  });
  live = {
    dispose: () => {
      clearTimeout(timer);
      off();
    },
  };
  return { empty };
};

/** Render the page for `path` into #main. Resolves with `{ title }`. */
export const render = async (path, query = {}, { animate = false } = {}) => {
  const main = document.getElementById("main");
  const mine = ++token;
  main.setAttribute("aria-busy", "true");
  // Navigation cross-fades the main region only (transitions.css names it); the first render has nothing to fade from.
  const swap = (fn) =>
    animate && main.firstElementChild ? transition(fn, { kind: "route" }) : Promise.resolve(fn());

  const client = matchClient(path);
  if (client) {
    return swap(async () => {
      live?.dispose();
      live = null;
      main.replaceChildren();
      main.removeAttribute("aria-busy");
      const out = await client.r.render(main, { params: client.params, query });
      live = { dispose: () => out?.dispose?.() };
      return { title: out?.title ?? "" };
    });
  }

  let res;
  try {
    res = await api.call("pages.resolve", { path });
  } catch (e) {
    if (mine !== token) return { title: "" };
    live?.dispose();
    live = null;
    main.removeAttribute("aria-busy");
    const missing = e.code === "UNKNOWN_REFERENCE";
    if (missing) {
      const shown = await showMissing(main, path, mine);
      if (shown) return { title: shown.empty ? "Empty workspace" : "Page not found" };
    }
    main.replaceChildren(
      h(
        "div",
        { class: "c-page-host" },
        pageHeader({ title: missing ? "Page not found" : "This page could not load" }),
        missing
          ? emptyState({
              icon: "search",
              title: "There is nothing at this address",
              body: path,
              action: button({ label: "Go home", variant: "primary", onClick: () => router.navigate("/") }),
            })
          : errorState({ error: e, retry: () => router.refresh() }),
      ),
    );
    return { title: missing ? "Page not found" : "Error" };
  }
  if (mine !== token) return { title: "" };
  await swap(() => {
    if (mine !== token) return;
    live?.dispose();
    main.removeAttribute("aria-busy");
    live = renderPage(main, res, query);
  });
  return { title: mine === token ? res.page.title : "" };
};

export { catalogEntry };
