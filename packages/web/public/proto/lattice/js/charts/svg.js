// SVG building blocks shared by every chart: element factory, root with accessible naming,
// hatch patterns (the non-colour threshold signal) and axes.
const NS = 'http://www.w3.org/2000/svg';

export const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v));
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
};

let counter = 0;
export const nextId = (prefix) => `${prefix}-${++counter}`;

const hatch = (id, cls) =>
  s(
    'pattern',
    { id, class: cls, width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
    s('rect', { class: 'hatch__bg', width: 7, height: 7 }),
    s('line', { class: 'hatch__line', x1: 0, y1: 0, x2: 0, y2: 7 }),
  );

/** Root <svg role="img"> named by <title> and described by <desc>. */
export const chartRoot = ({ width, height, label, desc }) => {
  const id = nextId('chart');
  const svg = s(
    'svg',
    {
      class: 'chart',
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-labelledby': `${id}-title`,
      'aria-describedby': `${id}-desc`,
      focusable: 'false',
    },
    s('title', { id: `${id}-title` }, label),
    s('desc', { id: `${id}-desc` }, desc),
    s('defs', {}, hatch(`${id}-bar`, 'hatch hatch--bar'), hatch(`${id}-cell`, 'hatch hatch--cell')),
  );
  return { svg, id, hatchBar: `url(#${id}-bar)`, hatchCell: `url(#${id}-cell)` };
};

export const yAxis = (g, scale, ticks, m, width, fmt) => {
  for (const t of ticks) {
    const y = scale(t);
    g.append(
      s('line', { class: 'chart__grid', x1: m.l, x2: width - m.r, y1: y, y2: y }),
      s('text', { class: 'chart__tick', x: m.l - 8, y, dy: '0.32em', 'text-anchor': 'end' }, fmt(t)),
    );
  }
};

export const xAxis = (g, scale, ticks, m, height, fmt) => {
  const base = height - m.b;
  g.append(s('line', { class: 'chart__axis', x1: scale.range[0], x2: scale.range[1], y1: base, y2: base }));
  for (const t of ticks) {
    const x = scale(t);
    g.append(
      s('line', { class: 'chart__axis', x1: x, x2: x, y1: base, y2: base + 4 }),
      s('text', { class: 'chart__tick', x, y: base + 8, dy: '0.9em', 'text-anchor': 'middle' }, fmt(t)),
    );
  }
};

/** A small up-pointing triangle, the threshold-breach glyph. */
export const triangle = (cx, cy, r, attrs = {}) =>
  s('path', { d: `M${cx} ${cy - r}L${cx + r} ${cy + r * 0.8}L${cx - r} ${cy + r * 0.8}Z`, ...attrs });

export const thresholdLine = (g, y, m, width, text) => {
  g.append(
    s('line', { class: 'chart__threshold', x1: m.l, x2: width - m.r, y1: y, y2: y }),
    s('text', { class: 'chart__threshold-label', x: width - m.r - 4, y: y - 5, 'text-anchor': 'end' }, text),
  );
};

/** Left margin wide enough for the widest tick label. */
export const leftMargin = (em, labels) => Math.ceil(Math.max(...labels.map((l) => String(l).length), 2) * em * 0.62) + 14;

export const truncate = (text, max) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text);
