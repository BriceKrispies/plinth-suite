// Loading a dashboard document, resolving its panels and running their queries, and updating a loaded board
// incrementally from change events (only the nodes the events name, and the queries they can affect).
import { toErrorInfo } from "../../core/api.js";
import { kindOf } from "./_events.js";

const slugOfRef = (ref) => String(ref).replace(/^panel:/, "");

/** One node by kind and slug, or undefined when it does not exist (or is not readable). */
export const findNode = async (api, kind, slug) => {
  try {
    return await api.nodes.get(`${kind.toLowerCase()}:${slug}`);
  } catch (e) {
    if (toErrorInfo(e).code === "UNKNOWN_REFERENCE") return undefined;
    throw e;
  }
};

const baseEntry = (item, node) => {
  const slug = slugOfRef(item.panel);
  if (!node) {
    return {
      slug,
      node,
      title: slug,
      at: item.at,
      error: { code: "UNKNOWN_REFERENCE", message: `No Panel named '${slug}'.` },
    };
  }
  const body = node.body;
  const entry = { slug, node, title: body.metadata.title, visual: body.spec.visual, at: item.at };
  if (typeof body.spec.query === "string")
    return { ...entry, error: { code: "UNSUPPORTED", message: "Query references are not available yet." } };
  return { ...entry, query: body.spec.query };
};

/** Run the panel's query (when it has one) and return the entry with a result or an error. */
const withResult = async (api, entry, params, dashboardSlug) => {
  if (!entry.query || entry.error) return entry;
  const { result: _r, error: _e, ...rest } = entry;
  try {
    return { ...rest, result: await api.query(entry.query, { params, dashboard: dashboardSlug }) };
  } catch (e) {
    return { ...rest, error: toErrorInfo(e) };
  }
};

const layoutOf = (dashboard) => {
  const body = dashboard.body;
  return {
    dashboard,
    title: body.metadata.title,
    columns: body.spec.layout.columns ?? 12,
    parameters: body.spec.parameters ?? {},
    items: body.spec.layout.items,
  };
};

const finish = (layout, panels) => {
  panels.sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x);
  const { items: _items, ...rest } = layout;
  return { ...rest, panels };
};

/** Resolves to undefined when no dashboard has this slug. */
export const loadBoard = async (api, slug, params) => {
  const dashboard = await findNode(api, "Dashboard", slug);
  if (!dashboard) return undefined;
  const layout = layoutOf(dashboard);
  const all = await api.nodes.list("Panel");
  const bySlug = new Map(all.map((p) => [p.slug, p]));
  const panels = await Promise.all(
    layout.items.map((item) =>
      withResult(api, baseEntry(item, bySlug.get(slugOfRef(item.panel))), params, slug),
    ),
  );
  return finish(layout, panels);
};

/** Re-run every panel query (parameters changed); no node is refetched. */
export const requery = async (api, board, slug, params) => ({
  ...board,
  panels: await Promise.all(board.panels.map((p) => withResult(api, p, params, slug))),
});

const sourceAffects = (entry, sourceSlug) =>
  entry.query && (entry.query.from === sourceSlug || entry.query.from === `source:${sourceSlug}`);

/**
 * Apply change events to a loaded board. Fetches only the nodes the events name: the dashboard for layout
 * changes, a panel for a panel change. Re-runs only the queries that can be affected: new or changed panels,
 * and panels reading a changed source. Throws on failure; the caller falls back to a full reload.
 */
export const updateBoard = async (api, prev, events, slug, params) => {
  const dashUri = prev.dashboard.uri;
  const named = new Set(events.map((e) => e.node));
  const byUri = new Map(prev.panels.filter((p) => p.node).map((p) => [p.node.uri, p]));
  const hasUnknown = prev.panels.some((p) => p.error?.code === "UNKNOWN_REFERENCE");

  const dashboard = named.has(dashUri) ? await api.nodes.get(dashUri) : prev.dashboard;
  const layout = layoutOf(dashboard);
  const known = new Map(prev.panels.map((p) => [p.slug, p]));

  const otherUris = [...named].filter(
    (u) => u !== dashUri && kindOf(u) !== "Panel" && kindOf(u) !== "Dashboard",
  );
  let allQueries = false;
  const sources = new Set();
  await Promise.all(
    otherUris.map(async (uri) => {
      if (kindOf(uri) !== "Source") {
        allQueries = true;
        return;
      }
      try {
        sources.add((await api.nodes.get(uri)).slug);
      } catch {
        allQueries = true;
      }
    }),
  );

  const touched = new Set([...named].filter((u) => byUri.has(u)));
  const strayPanels = hasUnknown ? [...named].filter((u) => kindOf(u) === "Panel" && !byUri.has(u)) : [];

  const panels = await Promise.all(
    layout.items.map(async (item) => {
      const pslug = slugOfRef(item.panel);
      const old = known.get(pslug);
      let entry;
      let rerun = false;
      if (old?.node && !touched.has(old.node.uri)) {
        entry = { ...old, at: item.at };
        rerun = allQueries || [...sources].some((s) => sourceAffects(old, s));
      } else if (old?.node) {
        entry = baseEntry(item, await api.nodes.get(old.node.uri));
        rerun = true;
      } else if (!old || strayPanels.length > 0 || named.has(dashUri)) {
        const node = await findNode(api, "Panel", pslug);
        entry = baseEntry(item, node);
        rerun = true;
      } else {
        entry = { ...old, at: item.at };
      }
      return rerun ? withResult(api, entry, params, slug) : entry;
    }),
  );
  return finish(layout, panels);
};

/** Fingerprint of everything that should repaint a panel when it changes. */
export const signature = (p) =>
  [
    p.node?.revision,
    p.result?.result_hash ?? p.result?.as_of,
    p.error?.code,
    p.at.x,
    p.at.y,
    p.at.w,
    p.at.h,
  ].join("|");

/**
 * Animation honesty: only a realtime change event may cause an animation. Returns a Map of panel slug to the
 * causing event, empty when nothing in `events` explains a visible change.
 */
export const attributeCauses = (prev, next, events, history = new Map()) => {
  const out = new Map();
  if (!prev || events.length === 0) return out;
  const before = new Map(prev.panels.map((p) => [p.slug, signature(p)]));
  const newest = events.reduce((a, b) => (b.seq > a.seq ? b : a));
  for (const p of next.panels) {
    if (before.get(p.slug) === signature(p)) continue;
    const own = events.filter((e) => e.node === p.node?.uri);
    const earlier = history.get(p.node?.uri);
    out.set(p.slug, {
      event:
        own.length > 0
          ? own.reduce((a, b) => (b.seq > a.seq ? b : a))
          : (!before.has(p.slug) && earlier) || newest,
      isNew: !before.has(p.slug),
    });
  }
  return out;
};
