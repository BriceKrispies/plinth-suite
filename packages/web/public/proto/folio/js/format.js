/** Number, time, URI and query formatting. Pure functions. */

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const pad = (n) => String(n).padStart(2, "0");

export const toMs = (v) => {
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  return new Date(String(v)).getTime();
};

export const isNumericType = (t) => t === "int" || t === "float" || t === "duration";

export const num = (v, unit) => {
  const s = Math.abs(v) >= 100000 ? compact.format(v) : full.format(v);
  return unit ? `${s} ${unit}` : s;
};
export const axisNum = (v) => (Math.abs(v) >= 10000 ? compact.format(v) : full.format(v));

/** Times are shown in UTC so they match the queries' own windows. */
export const hm = (ms) => { const d = new Date(ms); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
export const hms = (ms) => `${hm(ms)}:${pad(new Date(ms).getUTCSeconds())}`;
export const dayHm = (ms) => {
  const d = new Date(ms);
  return `${d.toLocaleString("en", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()} ${hm(ms)}`;
};
export const isoUtc = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
export const localClock = (ms = Date.now()) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export const cell = (v, type) => {
  if (v === null || v === undefined) return "—";
  if (type === "timestamp") { const ms = toMs(v); return Number.isNaN(ms) ? String(v) : isoUtc(ms); }
  if (typeof v === "number") return full.format(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

export const truncate = (s, n) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);
export const pretty = (v) => JSON.stringify(v, null, 2);

export const idOfUri = (uri) => uri.slice(uri.lastIndexOf("/") + 1);
export const kindOfUri = (uri) => /\/([A-Za-z]+)\/[^/]+$/.exec(uri)?.[1] ?? "Node";
export const shortId = (uri) => `…${uri.slice(-6)}`;

const OPS = { eq: "=", ne: "≠", lt: "<", lte: "≤", gt: ">", gte: "≥", in: "in", not_in: "not in", is_null: "is null", not_null: "is not null" };
const scalar = (v) => (typeof v === "string" ? v : JSON.stringify(v));

/** A query AST as [keyword, text] clauses, for the inspector and for empty states. */
export const queryClauses = (q) => {
  if (!q || typeof q !== "object") return [];
  const out = [["from", q.from]];
  for (const p of q.where ?? []) out.push([out.some((c) => c[0] === "where") ? "and" : "where", `${p.field} ${OPS[p.op] ?? p.op}${p.value === undefined ? "" : ` ${scalar(p.value)}`}`]);
  for (const [k, v] of Object.entries(q.derive ?? {})) out.push(["derive", `${k} = ${v}`]);
  if (q.group?.length) out.push(["group by", q.group.join(", ")]);
  for (const [k, v] of Object.entries(q.aggregate ?? {})) out.push(["aggregate", `${k} = ${v}`]);
  if (q.select?.length) out.push(["select", q.select.join(", ")]);
  if (q.order?.length) out.push(["order by", q.order.map((o) => `${o.field} ${o.dir}`).join(", ")]);
  if (q.limit) out.push(["limit", String(q.limit)]);
  return out;
};

export const summarizeQuery = (q) =>
  q && typeof q === "object"
    ? queryClauses(q).map(([k, v]) => `${k} ${v}`).join(" · ")
    : "no query";
