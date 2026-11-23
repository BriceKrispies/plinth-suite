import { dateTime, num, tickTime } from '../format.js';
import { ChannelError, axisKind, axisValue, col, groupRows, numeric, optCol } from './data.js';
import { extent, linear, niceDomain, timeTicks } from './scale.js';
import { chartRoot, leftMargin, s, xAxis, yAxis } from './svg.js';

const SHAPES = ['circle', 'square', 'diamond', 'triangle'];

const marker = (shape, cx, cy, r, attrs) => {
  if (shape === 'square') return s('rect', { x: cx - r, y: cy - r, width: r * 2, height: r * 2, ...attrs });
  if (shape === 'diamond') return s('path', { d: `M${cx} ${cy - r * 1.2}L${cx + r * 1.2} ${cy}L${cx} ${cy + r * 1.2}L${cx - r * 1.2} ${cy}Z`, ...attrs });
  if (shape === 'triangle') return s('path', { d: `M${cx} ${cy - r * 1.2}L${cx + r * 1.1} ${cy + r}L${cx - r * 1.1} ${cy + r}Z`, ...attrs });
  return s('circle', { cx, cy, r, ...attrs });
};

const draw = (ctx) => {
  const { result, visual, width, height, em } = ctx;
  const unit = visual.options?.unit;
  const ch = visual.channels;
  const xc = col(result, 'x', ch.x);
  const yc = col(result, 'y', ch.y);
  const sc = optCol(result, 'series', ch.series);
  const zc = optCol(result, 'size', ch.size);
  const xk = axisKind(xc);

  const series = [...groupRows(result, sc)].map(([name, rows], i) => ({
    name: name || yc.name,
    i,
    pts: rows
      .map((r) => ({ x: axisValue(r[xc.index], xk === 'category' ? 'value' : xk), y: numeric(r[yc.index]), z: zc ? numeric(r[zc.index]) : null }))
      .filter((p) => p.y !== null && Number.isFinite(p.x)),
  }));
  const all = series.flatMap((sr) => sr.pts);
  if (!all.length) throw new ChannelError(`No plottable rows for ${xc.name} / ${yc.name}. Scatter needs numeric or time values.`);

  const [x0, x1] = extent(all.map((p) => p.x));
  const xd = xk === 'time' ? { min: x0, max: x1 === x0 ? x0 + 1 : x1 } : niceDomain(x0, x1, 6);
  const yd = niceDomain(...extent(all.map((p) => p.y)));
  const [z0, z1] = zc ? extent(all.filter((p) => p.z !== null).map((p) => p.z)) : [0, 0];

  const m = { t: Math.ceil(em), r: Math.ceil(em * 1.4), b: Math.ceil(em * 2.4), l: leftMargin(em, yd.ticks.map((t) => num(t))) };
  const x = linear(xd.min, xd.max, m.l, width - m.r);
  const y = linear(yd.min, yd.max, height - m.b, m.t);

  const label = `Scatter plot of ${yc.name} against ${xc.name}`;
  const desc = `${all.length} points in ${series.length} series. ${xc.name} ranges ${num(x0)} to ${num(x1)}; ${yc.name} ranges ${num(Math.min(...all.map((p) => p.y)), unit)} to ${num(Math.max(...all.map((p) => p.y)), unit)}.${zc ? ` Marker size encodes ${zc.name}.` : ''}`;
  const { svg } = chartRoot({ width, height, label, desc });

  const axes = s('g', { class: 'chart__axes' });
  yAxis(axes, y, yd.ticks, m, width, (t) => num(t));
  if (xk === 'time') xAxis(axes, x, timeTicks(xd.min, xd.max, Math.max(2, Math.floor((width - m.l) / (em * 7)))), m, height, tickTime(xd.max - xd.min));
  else xAxis(axes, x, xd.ticks, m, height, (t) => num(t));
  svg.append(axes);

  const g = s('g', { class: 'chart__data' });
  for (const sr of series) {
    const shape = SHAPES[sr.i % SHAPES.length];
    const sg = s('g', { class: 'chart__series', 'data-s': sr.i % 8 });
    for (const p of sr.pts) {
      const r = zc && p.z !== null ? 3.5 + (z1 === z0 ? 0.5 : (p.z - z0) / (z1 - z0)) * 6 : 4.5;
      const xl = xk === 'time' ? dateTime(p.x) : num(p.x);
      const tip = `${sr.name} · ${xc.name} ${xl}, ${yc.name} ${num(p.y, unit)}${zc && p.z !== null ? `, ${zc.name} ${num(p.z)}` : ''}`;
      sg.append(marker(shape, x(p.x), y(p.y), r, { class: 'chart__point', 'data-tip': tip }));
    }
    g.append(sg);
  }
  svg.append(g);
  return { node: svg, legend: series.length > 1 ? series.map((sr) => ({ label: sr.name, s: sr.i % 8, shape: SHAPES[sr.i % SHAPES.length] })) : null };
};

export const scatter = { sized: true, draw };
