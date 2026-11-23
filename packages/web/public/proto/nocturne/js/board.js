import { findNode, listNodes, runQuery, toErrorInfo } from "./api.js";

const slugOf = (ref) => String(ref).replace(/^panel:/, "");

export const paramDefaults = (spec) =>
  Object.fromEntries(
    Object.entries(spec.parameters ?? {})
      .filter(([, decl]) => decl.default !== undefined)
      .map(([name, decl]) => [name, decl.default]),
  );

const entryFor = (item, panelsBySlug) => {
  const slug = slugOf(item.panel);
  const node = panelsBySlug.get(slug);
  if (!node)
    return {
      slug,
      node,
      title: slug,
      at: item.at,
      state: "error",
      error: { code: "UNKNOWN_REFERENCE", message: `No Panel named '${slug}' exists.` },
    };
  const body = node.body;
  const base = { slug, node, title: body.metadata.title, visual: body.spec.visual, query: body.spec.query, at: item.at };
  if (typeof body.spec.query === "string")
    return {
      ...base,
      query: undefined,
      state: "error",
      error: { code: "UNSUPPORTED", message: "Query references are not available yet." },
    };
  return { ...base, state: "loading" };
};

/** Phase one: the dashboard and its panel definitions, with every query still pending. */
export const loadStructure = async (slug) => {
  const dashboard = await findNode("Dashboard", slug);
  if (!dashboard) return undefined;
  const body = dashboard.body;
  const panelNodes = await listNodes("Panel");
  const bySlug = new Map(panelNodes.map((p) => [p.slug, p]));
  return {
    dashboard,
    title: body.metadata.title,
    params: paramDefaults(body.spec),
    panels: body.spec.layout.items.map((item) => entryFor(item, bySlug)),
    nodes: [dashboard, ...panelNodes],
  };
};

/** Phase two: run one panel's query. Never throws; failures become the panel's error state. */
export const hydrate = async (entry, params) => {
  if (entry.state === "error" || !entry.query) return entry;
  try {
    return { ...entry, state: "ready", result: await runQuery(entry.query, params) };
  } catch (e) {
    return { ...entry, state: "error", error: toErrorInfo(e) };
  }
};

export const listDashboards = () => listNodes("Dashboard");

const predicate = (p) => `${p.field} ${p.op}${p.value === undefined ? "" : ` ${JSON.stringify(p.value)}`}`;

/** One-line description of a query, used by empty states. */
export const summarizeQuery = (q) => {
  if (!q) return "no query";
  const parts = [`from ${q.from}`];
  if (q.where?.length) parts.push(`where ${q.where.map(predicate).join(" and ")}`);
  if (q.group?.length) parts.push(`group by ${q.group.join(", ")}`);
  if (q.aggregate) parts.push(`aggregate ${Object.keys(q.aggregate).join(", ")}`);
  if (q.limit) parts.push(`limit ${q.limit}`);
  return parts.join(" · ");
};

const KNOWN = ["from", "where", "group", "aggregate", "order", "limit"];

/** Break a query AST into labelled lines for the inspector. Unknown keys are kept as JSON, never dropped. */
export const formatQuery = (q) => {
  if (!q) return [];
  const lines = [["from", String(q.from)]];
  if (q.where?.length) lines.push(["where", q.where.map(predicate).join("\nand ")]);
  if (q.group?.length) lines.push(["group by", q.group.join(", ")]);
  if (q.aggregate)
    lines.push([
      "aggregate",
      Object.entries(q.aggregate)
        .map(([k, v]) => `${k} = ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join("\n"),
    ]);
  if (q.order) lines.push(["order", typeof q.order === "string" ? q.order : JSON.stringify(q.order)]);
  if (q.limit) lines.push(["limit", String(q.limit)]);
  for (const [key, value] of Object.entries(q)) if (!KNOWN.includes(key)) lines.push([key, JSON.stringify(value)]);
  return lines;
};

/** Resolve a node uri to a kind and title for the trace, falling back to the uri's own parts. */
export const describeNode = (uri, titles) => {
  const known = titles.get(uri);
  if (known) return known;
  const m = /^([A-Za-z]+)[:/](.+)$/.exec(String(uri));
  return m
    ? { kind: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), title: m[2] }
    : { kind: "Node", title: String(uri) };
};
