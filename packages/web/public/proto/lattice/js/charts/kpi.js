import { h } from '../dom.js';
import { icon } from '../icons.js';
import { num } from '../format.js';
import { ChannelError, axisKind, axisValue, col, numeric, optCol } from './data.js';
import { extent } from './scale.js';
import { s } from './svg.js';

const spark = (result, xc, yc, label) => {
  const xk = axisKind(xc);
  const pts = result.rows
    .map((r) => ({ x: xk === 'category' ? 0 : axisValue(r[xc.index], xk), y: numeric(r[yc.index]) }))
    .filter((p) => p.y !== null);
  if (pts.length < 2) return null;
  if (xk !== 'category') pts.sort((a, b) => a.x - b.x);
  const [y0, y1] = extent(pts.map((p) => p.y));
  const W = 100;
  const H = 32;
  const px = (i) => (i / (pts.length - 1)) * W;
  const py = (v) => H - 3 - ((v - y0) / (y1 - y0 || 1)) * (H - 6);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${px(i).toFixed(2)} ${py(p.y).toFixed(2)}`).join('');
  return s(
    'svg',
    { class: 'kpi__spark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `${label}: from ${num(pts[0].y)} to ${num(pts.at(-1).y)} over ${pts.length} points` },
    s('path', { class: 'kpi__spark-area', d: `${d}L${W} ${H}L0 ${H}Z` }),
    s('path', { class: 'kpi__spark-line', d }),
  );
};

const draw = ({ result, visual }) => {
  const ch = visual.channels;
  const unit = visual.options?.unit;
  const vc = col(result, 'value', ch.value);
  const dc = optCol(result, 'delta', ch.delta);
  const xc = optCol(result, 'x', ch.x);
  const yc = optCol(result, 'y', ch.y);
  const last = result.rows.at(-1);
  const value = numeric(last[vc.index]);
  if (value === null) throw new ChannelError(`The last row has no numeric ${vc.name}.`);

  const root = h('div', { class: 'kpi' });
  root.append(h('p', { class: 'kpi__value' }, h('span', { class: 'kpi__number' }, num(value)), unit ? h('span', { class: 'kpi__unit' }, unit) : null));

  const row = h('p', { class: 'kpi__meta' });
  if (dc) {
    const d = numeric(last[dc.index]);
    if (d !== null) {
      const good = visual.options?.good ?? 'up';
      const tone = d === 0 ? 'flat' : (d > 0) === (good === 'up') ? 'good' : 'bad';
      const word = tone === 'good' ? 'favourable' : tone === 'bad' ? 'unfavourable' : 'unchanged';
      row.append(
        h('span', { class: `kpi__delta kpi__delta--${tone}` }, icon(d === 0 ? 'flat' : d > 0 ? 'up' : 'down', 14), `${d > 0 ? '+' : ''}${num(d)}`, h('span', { class: 'sr-only' }, ` (${word})`)),
      );
    }
  }
  if (visual.threshold) {
    const over = value > visual.threshold.value;
    row.append(
      h('span', { class: `kpi__limit${over ? ' kpi__limit--over' : ''}` }, over ? icon('warn', 14) : null, over ? `Above threshold ${num(visual.threshold.value, unit)}` : `Threshold ${num(visual.threshold.value, unit)}`),
    );
  }
  if (row.childNodes.length) root.append(row);
  const sp = xc && yc ? spark(result, xc, yc, `Trend of ${yc.name}`) : null;
  if (sp) root.append(sp);
  return { node: root };
};

export const kpi = { sized: false, draw };
