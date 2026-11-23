import { findNode, listNodes, runQuery, toErrorInfo } from './api.js';

/** Dashboard document plus the panel nodes it references. No query results yet. */
export const loadLayout = async (slug) => {
  const dashboard = await findNode('Dashboard', slug);
  if (!dashboard) return undefined;
  const body = dashboard.body;
  const panelNodes = await listNodes('Panel');
  const bySlug = new Map(panelNodes.map((p) => [p.slug, p]));

  const titles = new Map([[dashboard.uri, body.metadata.title]]);
  for (const p of panelNodes) titles.set(p.uri, p.body?.metadata?.title ?? p.slug);

  const items = body.spec.layout.items.map((item) => {
    const panelSlug = item.panel.replace(/^panel:/, '');
    const node = bySlug.get(panelSlug);
    const pb = node?.body;
    return {
      slug: panelSlug,
      node,
      title: pb?.metadata?.title ?? panelSlug,
      visual: pb?.spec?.visual,
      query: pb?.spec?.query,
      at: item.at,
    };
  });
  return {
    dashboard,
    title: body.metadata.title,
    columns: body.spec.layout.columns ?? 12,
    parameters: body.spec.parameters ?? {},
    items,
    titles,
  };
};

/** Runs one panel's query. Returns the entry with either `result` or `error`, never both. */
export const fetchResult = async (entry, params) => {
  if (!entry.node)
    return { ...entry, result: undefined, error: { code: 'UNKNOWN_REFERENCE', message: `No Panel '${entry.slug}' exists.` } };
  if (typeof entry.query === 'string')
    return { ...entry, result: undefined, error: { code: 'UNSUPPORTED', message: 'Query references are not available yet.' } };
  try {
    return { ...entry, result: await runQuery(entry.query, params), error: undefined };
  } catch (e) {
    return { ...entry, result: undefined, error: toErrorInfo(e) };
  }
};

/** One-line description of a query for empty states and the inspector. */
export const summarizeQuery = (q) => {
  if (!q || typeof q === 'string') return q ? `reference ${q}` : 'no query';
  const parts = [`from ${q.from}`];
  if (q.where?.length)
    parts.push(`where ${q.where.map((p) => `${p.field} ${p.op}${p.value === undefined ? '' : ` ${JSON.stringify(p.value)}`}`).join(' and ')}`);
  if (q.group?.length) parts.push(`group by ${q.group.join(', ')}`);
  if (q.aggregate) parts.push(`aggregate ${Object.keys(q.aggregate).join(', ')}`);
  if (q.limit) parts.push(`limit ${q.limit}`);
  return parts.join(' · ');
};

/** Change detector: same revision, rows and error means nothing to redraw or attribute. */
export const signature = (entry) =>
  [entry.node?.revision, entry.result ? (entry.result.result_hash ?? JSON.stringify(entry.result.rows)) : '', entry.error?.code, entry.error?.message, entry.visual ? JSON.stringify(entry.visual) : ''].join('|');

/** Parameter values: defaults from the dashboard, overridden by `p.<name>` in the URL. */
export const parameterValues = (decls, search) => {
  const out = {};
  for (const [name, decl] of Object.entries(decls)) {
    const raw = search.get(`p.${name}`);
    if (raw === null) {
      if (decl.default !== undefined) out[name] = decl.default;
    } else if (decl.type === 'int' || decl.type === 'float') {
      if (raw !== '' && Number.isFinite(Number(raw))) out[name] = Number(raw);
    } else if (decl.type === 'bool') out[name] = raw === 'true';
    else out[name] = raw;
  }
  return out;
};
