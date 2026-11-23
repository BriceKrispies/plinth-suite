/** Loading a dashboard document, resolving its panels and running their queries. */
import { findNode, listNodes, runQuery, toErrorInfo } from "./api.js";

const slugOfRef = (ref) => ref.replace(/^panel:/, "");

const coerce = (decl, raw) => {
  if (raw === undefined) return decl.default;
  if (decl.type === "int" || decl.type === "float") return Number(raw);
  if (decl.type === "bool") return raw === "true" || raw === "1";
  return raw;
};

/** Dashboard parameter defaults, overridden by same-named URL parameters. */
export const paramsFor = (parameters) => {
  const url = new URLSearchParams(location.search);
  const out = {};
  for (const [name, decl] of Object.entries(parameters ?? {})) {
    const value = coerce(decl, url.get(name) ?? undefined);
    if (value !== undefined) out[name] = value;
  }
  return out;
};

const toEntry = (item, nodes) => {
  const slug = slugOfRef(item.panel);
  const node = nodes.get(slug);
  const base = { slug, node, at: item.at };
  if (!node) return { ...base, title: slug, error: { code: "UNKNOWN_REFERENCE", message: `No panel named '${slug}' exists.` } };
  const body = node.body;
  const entry = { ...base, title: body.metadata.title, visual: body.spec.visual, query: body.spec.query };
  if (typeof body.spec.query === "string")
    entry.error = { code: "UNSUPPORTED", message: "Query references are not available yet." };
  return entry;
};

/** The dashboard document and its panel entries (no query results yet). Undefined when unknown. */
export const loadLayout = async (slug) => {
  const dashboard = await findNode("Dashboard", slug);
  if (!dashboard) return undefined;
  const body = dashboard.body;
  const nodes = new Map((await listNodes("Panel")).map((p) => [p.slug, p]));
  const entries = body.spec.layout.items.map((item) => toEntry(item, nodes));
  return {
    dashboard,
    title: body.metadata.title,
    columns: body.spec.layout.columns ?? 12,
    params: paramsFor(body.spec.parameters),
    entries,
  };
};

/** Run one panel's query. Resolves to `{result}` or `{error}`; never throws. */
export const runPanel = async (entry, params) => {
  if (entry.error) return { error: entry.error };
  try {
    return { result: await runQuery(entry.query, params) };
  } catch (e) {
    return { error: toErrorInfo(e) };
  }
};

export const listDashboards = () => listNodes("Dashboard");
