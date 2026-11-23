import { num } from '../format.js';
import { ChannelError, col, numeric } from './data.js';
import { extent } from './scale.js';
import { chartRoot, leftMargin, s, triangle, truncate } from './svg.js';

/**
 * Heatmap. Colour is a CSS ramp driven by the custom property `--t` (0..1) on each cell, so the
 * theme owns the palette. Cells above the threshold carry a hatch, an outline and a glyph.
 */
const draw = (ctx) => {
  const { result, visual, width, height, em } = ctx;
  const unit = visual.options?.unit;
  const th = visual.threshold;
  const xc = col(result, 'x', visual.channels.x);
  const yc = col(result, 'y', visual.channels.y);
  const vc = col(result, 'value', visual.channels.value);

  const xs = [...new Set(result.rows.map((r) => String(r[xc.index])))];
  const ys = [...new Set(result.rows.map((r) => String(r[yc.index])))];
  const cells = new Map();
  for (const r of result.rows) cells.set(`${xs.indexOf(String(r[xc.index]))}|${ys.indexOf(String(r[yc.index]))}`, numeric(r[vc.index]));
  const values = [...cells.values()].filter((v) => v !== null);
  if (!values.length) throw new ChannelError(`No numeric values in ${vc.name}.`);
  const domain = visual.options?.domain ?? extent(values);
  const [lo, hi] = domain[0] === domain[1] ? [domain[0], domain[0] + 1] : domain;

  const labelMax = 14;
  const m = { t: Math.ceil(em * 0.5), r: Math.ceil(em * 0.5), b: Math.ceil(em * 2.4), l: leftMargin(em, ys.map((l) => truncate(l, labelMax))) };
  const gap = 3;
  const cw = (width - m.l - m.r) / xs.length;
  const ch = (height - m.t - m.b) / ys.length;

  const label = `Heatmap of ${vc.name} by ${xc.name} and ${yc.name}`;
  const hot = th ? [...cells].filter(([, v]) => v !== null && v > th.value) : [];
  const desc = `${xs.length} by ${ys.length} cells, values ${num(Math.min(...values), unit)} to ${num(Math.max(...values), unit)}.${hot.length ? ` ${hot.length} cells above threshold ${num(th.value, unit)}.` : ''}`;
  const { svg, hatchCell } = chartRoot({ width, height, label, desc });

  const axes = s('g', { class: 'chart__axes' });
  ys.forEach((name, j) => axes.append(s('text', { class: 'chart__tick', x: m.l - 8, y: m.t + ch * (j + 0.5), dy: '0.32em', 'text-anchor': 'end' }, s('title', {}, name), truncate(name, labelMax))));
  const xMax = Math.max(3, Math.floor(cw / (em * 0.6)));
  xs.forEach((name, i) => axes.append(s('text', { class: 'chart__tick', x: m.l + cw * (i + 0.5), y: height - m.b + 8, dy: '0.9em', 'text-anchor': 'middle' }, s('title', {}, name), truncate(name, xMax))));
  svg.append(axes);

  const showLabels = cw > em * 3.2 && ch > em * 1.6;
  const g = s('g', { class: 'chart__data' });
  ys.forEach((yn, j) =>
    xs.forEach((xn, i) => {
      const v = cells.get(`${i}|${j}`);
      const px = m.l + cw * i + gap / 2;
      const py = m.t + ch * j + gap / 2;
      const w = Math.max(cw - gap, 1);
      const hgt = Math.max(ch - gap, 1);
      if (v === null || v === undefined) {
        g.append(s('rect', { class: 'heat__cell heat__cell--empty', x: px, y: py, width: w, height: hgt, rx: 3, 'data-tip': `${xn} / ${yn}: no value` }));
        return;
      }
      const t = Math.min(Math.max((v - lo) / (hi - lo), 0), 1);
      const breach = th && v > th.value;
      const group = s('g', { class: 'heat__group', 'data-tip': `${xn} / ${yn}: ${num(v, unit)}${breach ? ' (above threshold)' : ''}` });
      group.append(s('rect', { class: 'heat__cell', x: px, y: py, width: w, height: hgt, rx: 3, style: `--t:${t.toFixed(3)}` }));
      if (breach) {
        group.append(s('rect', { class: 'heat__cell heat__cell--breach', x: px, y: py, width: w, height: hgt, rx: 3, style: `fill:${hatchCell}` }));
        group.append(triangle(px + w - em * 0.8, py + em * 0.8, em * 0.45, { class: 'chart__breach chart__breach--cell' }));
      }
      if (showLabels)
        group.append(s('text', { class: `heat__label${t > 0.5 ? ' heat__label--hi' : ''}${breach ? ' heat__label--strong' : ''}`, x: px + w / 2, y: py + hgt / 2, dy: '0.32em', 'text-anchor': 'middle' }, num(v)));
      g.append(group);
    }),
  );
  svg.append(g);
  return { node: svg, ramp: { lo, hi, unit, threshold: th ? th.value : null } };
};

export const heatmap = { sized: true, draw };
