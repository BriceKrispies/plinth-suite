// Loading a dashboard document, resolving its panels and running their queries.
import { findNode, listNodes, runQuery, toErrorInfo } from "./api.js";

const slugOfRef = (ref) => String(ref).replace(/^panel:/, "");

const loadPanel = async (item, bySlug, params) => {
  const slug = slugOfRef(item.panel);
  const node = bySlug.get(slug);
  if (!node) {
    return { slug, node, title: slug, at: item.at, error: { code: "UNKNOWN_REFERENCE", message: `No Panel named '${slug}'.` } };
  }
  const body = node.body;
  const entry = { slug, node, title: body.metadata.title, visual: body.spec.visual, at: item.at };
  if (typeof body.spec.query === "string") {
    return { ...entry, error: { code: "UNSUPPORTED", message: "Query references are not available yet." } };
  }
  try {
    return { ...entry, query: body.spec.query, result: await runQuery(body.spec.query, params) };
  } catch (e) {
    return { ...entry, query: body.spec.query, error: toErrorInfo(e) };
  }
};

/** Resolves to undefined when no dashboard has this slug. */
export const loadBoard = async (slug, params) => {
  const dashboard = await findNode("Dashboard", slug);
  if (!dashboard) return undefined;
  const body = dashboard.body;
  const all = await listNodes("Panel");
  const bySlug = new Map(all.map((p) => [p.slug, p]));
  const panels = await Promise.all(body.spec.layout.items.map((item) => loadPanel(item, bySlug, params)));
  panels.sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x);
  return {
    dashboard,
    title: body.metadata.title,
    columns: body.spec.layout.columns ?? 12,
    parameters: body.spec.parameters ?? {},
    panels,
  };
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
 * Animation honesty: only a realtime change event may cause an animation. Returns a Map of
 * panel slug to the causing event, empty when nothing in `events` explains a visible change.
 */
export const attributeCauses = (prev, next, events) => {
  const out = new Map();
  if (!prev || events.length === 0) return out;
  const before = new Map(prev.panels.map((p) => [p.slug, signature(p)]));
  const newest = events.reduce((a, b) => (b.seq > a.seq ? b : a));
  for (const p of next.panels) {
    if (before.get(p.slug) === signature(p)) continue;
    const own = events.filter((e) => e.node === p.node?.uri);
    out.set(p.slug, {
      event: own.length > 0 ? own.reduce((a, b) => (b.seq > a.seq ? b : a)) : newest,
      isNew: !before.has(p.slug),
    });
  }
  return out;
};

const fmtValue = (v) => (Array.isArray(v) ? `[${v.map(fmtValue).join(", ")}]` : JSON.stringify(v));

/** One-line summary for empty states. */
export const summarizeQuery = (q) => {
  if (!q) return "no query";
  const parts = [`from ${q.from}`];
  if (q.where?.length) parts.push(`where ${q.where.map((p) => `${p.field} ${p.op}${p.value === undefined ? "" : ` ${fmtValue(p.value)}`}`).join(" and ")}`);
  if (q.group?.length) parts.push(`group by ${q.group.join(", ")}`);
  if (q.aggregate) parts.push(`aggregate ${Object.keys(q.aggregate).join(", ")}`);
  if (q.limit) parts.push(`limit ${q.limit}`);
  return parts.join(" · ");
};

/** Multi-line, human-readable rendering of a query AST for the inspector. */
export const formatQuery = (q) => {
  if (!q) return "No query.";
  const lines = [`from       ${q.from}`];
  for (const [i, p] of (q.where ?? []).entries()) {
    lines.push(`${i === 0 ? "where     " : "  and     "} ${p.field} ${p.op}${p.value === undefined ? "" : ` ${fmtValue(p.value)}`}`);
  }
  for (const [name, expr] of Object.entries(q.derive ?? {})) lines.push(`derive     ${name} = ${expr}`);
  if (q.group?.length) lines.push(`group by   ${q.group.join(", ")}`);
  for (const [name, expr] of Object.entries(q.aggregate ?? {})) lines.push(`aggregate  ${name} = ${expr}`);
  if (q.select?.length) lines.push(`select     ${q.select.join(", ")}`);
  if (q.order?.length) lines.push(`order by   ${q.order.map((o) => `${o.field} ${o.dir}`).join(", ")}`);
  if (q.limit) lines.push(`limit      ${q.limit}`);
  return lines.join("\n");
};
