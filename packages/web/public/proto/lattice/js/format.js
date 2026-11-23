export const toMs = (v) => {
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  return new Date(String(v)).getTime();
};

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });

export const num = (v, unit) => {
  const text = Math.abs(v) >= 100_000 ? compact.format(v) : full.format(v);
  return unit ? `${text} ${unit}` : text;
};

export const isNumericType = (t) => t === 'int' || t === 'float' || t === 'duration';

const pad = (n) => String(n).padStart(2, '0');
export const clock = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const clockSeconds = (ms) => `${clock(ms)}:${pad(new Date(ms).getSeconds())}`;
export const dateTime = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clockSeconds(ms)}`;
};

const dayFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
export const tickTime = (spanMs) => (ms) => (spanMs < 2 * 864e5 ? clock(ms) : dayFmt.format(ms));

export const cell = (v, type) => {
  if (v === null || v === undefined) return '—';
  if (type === 'timestamp') {
    const ms = toMs(v);
    return Number.isNaN(ms) ? String(v) : dateTime(ms);
  }
  if (typeof v === 'number') return full.format(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

export const actorLabel = (actor) =>
  actor.startsWith('agent:') ? `agent · ${actor.slice(6)}` : actor.replace(/^(user|service):/, '');

export const nodeKind = (uri) => /\/([A-Za-z]+)\/[^/]+$/.exec(uri)?.[1] ?? uri.split(':')[0] ?? 'node';

/** Stable text for anything a server hands us in a free-form slot. */
export const plain = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
