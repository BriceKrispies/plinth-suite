import { findNode, listNodes, runQuery, toErrorInfo } from "./api.js";

/**
 * Load a dashboard, its panels and every panel's query result. `paramsFor` turns the dashboard's parameter
 * declarations into values (URL first, then defaults). Never throws for one bad panel.
 */
export const loadBoard = async (slug, paramsFor) => {
  const dashboard = await findNode("Dashboard", slug);
  if (!dashboard) return undefined;
  const body = dashboard.body;
  const params = paramsFor(body.spec.parameters ?? {});
  const panelNodes = await listNodes("Panel");
  const bySlug = new Map(panelNodes.map((p) => [p.slug, p]));
  const titles = new Map(panelNodes.map((p) => [p.uri, p.body?.metadata?.title ?? p.slug]));
  titles.set(dashboard.uri, body.metadata.title);

  const panels = await Promise.all(
    body.spec.layout.items.map(async (item) => {
      const panelSlug = String(item.panel).replace(/^panel:/, "");
      const node = bySlug.get(panelSlug);
      if (!node) {
        return {
          slug: panelSlug, node, title: panelSlug, at: item.at,
          error: { code: "UNKNOWN_REFERENCE", message: `No Panel named '${panelSlug}' exists.` },
        };
      }
      const spec = node.body.spec;
      const base = { slug: panelSlug, node, title: node.body.metadata.title, visual: spec.visual, at: item.at };
      if (typeof spec.query === "string") {
        return { ...base, error: { code: "UNSUPPORTED", message: "Query references are not available yet." } };
      }
      try {
        return { ...base, query: spec.query, result: await runQuery(spec.query, params) };
      } catch (e) {
        return { ...base, query: spec.query, error: toErrorInfo(e) };
      }
    }),
  );

  return {
    dashboard,
    title: body.metadata.title,
    columns: body.spec.layout.columns ?? 12,
    parameters: body.spec.parameters ?? {},
    panels,
    titles,
  };
};

/** Identity of a panel's rendered content: equal keys mean nothing visible changed. */
export const panelKey = (entry) =>
  [
    entry.node?.revision ?? "",
    entry.error ? `${entry.error.code}:${entry.error.message}` : "",
    entry.result ? JSON.stringify(entry.result.rows) + entry.result.columns.map((c) => c.name).join() : "",
  ].join("|");

/**
 * Animation honesty: only a realtime change event may cause something to animate. Without events there
 * are no causes, so first loads, parameter edits and plain refetches stay still.
 */
export const attributeCauses = (prev, next, events) => {
  const causes = new Map();
  if (!prev || events.length === 0) return causes;
  const before = new Map(prev.panels.map((p) => [p.slug, p]));
  const latest = Math.max(...events.map((e) => e.seq));
  for (const panel of next.panels) {
    const old = before.get(panel.slug);
    if (old && panelKey(old) === panelKey(panel)) continue;
    const own = events.filter((e) => e.node === panel.node?.uri).map((e) => e.seq);
    causes.set(panel.slug, { seq: own.length > 0 ? Math.max(...own) : latest, kind: old ? "updated" : "added" });
  }
  return causes;
};

/** One-line description of a query for empty states. */
export const summarizeQuery = (q) => {
  if (!q) return "no query";
  const parts = [`from ${q.from}`];
  if (q.where?.length) {
    parts.push(
      "where " + q.where.map((p) => `${p.field} ${p.op}${p.value === undefined ? "" : ` ${JSON.stringify(p.value)}`}`).join(" and "),
    );
  }
  if (q.group?.length) parts.push(`group by ${q.group.join(", ")}`);
  if (q.aggregate) parts.push(`aggregate ${Object.keys(q.aggregate).join(", ")}`);
  if (q.limit) parts.push(`limit ${q.limit}`);
  return parts.join(" · ");
};

/** The query as formatted lines of [keyword, text] pairs, for the inspector. */
export const formatQuery = (q) => {
  if (!q) return [["note", "No inline query. This panel references one."]];
  const lines = [["from", q.from]];
  for (const [i, p] of (q.where ?? []).entries()) {
    const value = p.value === undefined ? "" : ` ${JSON.stringify(p.value)}`;
    lines.push([i === 0 ? "where" : "and", `${p.field} ${p.op}${value}`]);
  }
  for (const [name, expr] of Object.entries(q.derive ?? {})) lines.push(["derive", `${name} = ${expr}`]);
  if (q.group?.length) lines.push(["group by", q.group.join(", ")]);
  for (const [name, expr] of Object.entries(q.aggregate ?? {})) lines.push(["aggregate", `${name} = ${expr}`]);
  if (q.select?.length) lines.push(["select", q.select.join(", ")]);
  if (q.order?.length) lines.push(["order by", q.order.map((o) => `${o.field} ${o.dir}`).join(", ")]);
  if (q.limit) lines.push(["limit", String(q.limit)]);
  return lines;
};
