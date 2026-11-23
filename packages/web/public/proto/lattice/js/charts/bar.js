import { num } from '../format.js';
import { ChannelError, col, numeric, optCol } from './data.js';
import { band, extent, linear, niceDomain } from './scale.js';
import { chartRoot, leftMargin, s, thresholdLine, triangle, truncate } from './svg.js';

/** Bar chart. Vertical columns for a few categories, horizontal bars when labels need room. */
const draw = (ctx) => {
  const { result, visual, width, height, em } = ctx;
  const unit = visual.options?.unit;
  const th = visual.threshold;
  const stacked = Boolean(visual.options?.stacked);
  const xc = col(result, 'x', visual.channels.x);
  const yc = col(result, 'y', visual.channels.y);
  const cc = optCol(result, 'color', visual.channels.color);

  const cats = [...new Set(result.rows.map((r) => String(r[xc.index])))];
  const groups = cc ? [...new Set(result.rows.map((r) => String(r[cc.index])))] : [''];
  const value = new Map();
  for (const r of result.rows) {
    const v = numeric(r[yc.index]);
    if (v === null) continue;
    const key = `${cats.indexOf(String(r[xc.index]))}|${cc ? groups.indexOf(String(r[cc.index])) : 0}`;
    value.set(key, (value.get(key) ?? 0) + v);
  }
  if (!value.size) throw new ChannelError(`No plottable rows for ${xc.name} / ${yc.name}.`);

  // One bar per (category, group): grouped side by side, or stacked from a running total.
  const bars = [];
  cats.forEach((cat, ci) => {
    let run = 0;
    groups.forEach((group, gi) => {
      const v = value.get(`${ci}|${gi}`);
      if (v === undefined) return;
      const from = stacked ? run : 0;
      run += v;
      bars.push({ ci, gi, cat, group, v, from, to: stacked ? run : v });
    });
  });

  const horizontal = cats.length > 7 || (width < 380 && cats.length > 4);
  const vals = bars.flatMap((b) => [b.from, b.to]);
  vals.push(0);
  if (th) vals.push(th.value);
  const vd = niceDomain(...extent(vals));
  const fmt = (t) => num(t);

  const catLabelMax = horizontal ? 16 : Math.max(4, Math.floor(width / cats.length / (em * 0.6)));
  const m = horizontal
    ? { t: Math.ceil(em), r: Math.ceil(em * 1.4), b: Math.ceil(em * 2.2), l: leftMargin(em, cats.map((c) => truncate(c, catLabelMax))) }
    : { t: Math.ceil(em * 1.2), r: Math.ceil(em * 1.2), b: Math.ceil(em * 2.4), l: leftMargin(em, vd.ticks.map(fmt)) };

  const label = `Bar chart of ${yc.name} by ${xc.name}`;
  const top = [...bars].sort((a, b) => b.to - a.to)[0];
  const desc = `${cats.length} categories${cc ? `, ${groups.length} groups` : ''}. Highest: ${top.cat}${top.group ? ` / ${top.group}` : ''} at ${num(top.to, unit)}.${th ? ` Threshold ${num(th.value, unit)}.` : ''}`;
  const { svg, hatchBar } = chartRoot({ width, height, label, desc });

  const bandAxis = horizontal ? band(cats.length, m.t, height - m.b) : band(cats.length, m.l, width - m.r);
  const valueScale = horizontal ? linear(vd.min, vd.max, m.l, width - m.r) : linear(vd.min, vd.max, height - m.b, m.t);

  const axes = s('g', { class: 'chart__axes' });
  for (const t of vd.ticks) {
    const p = valueScale(t);
    if (horizontal)
      axes.append(
        s('line', { class: 'chart__grid', x1: p, x2: p, y1: m.t, y2: height - m.b }),
        s('text', { class: 'chart__tick', x: p, y: height - m.b + 8, dy: '0.9em', 'text-anchor': 'middle' }, fmt(t)),
      );
    else
      axes.append(
        s('line', { class: 'chart__grid', x1: m.l, x2: width - m.r, y1: p, y2: p }),
        s('text', { class: 'chart__tick', x: m.l - 8, y: p, dy: '0.32em', 'text-anchor': 'end' }, fmt(t)),
      );
  }
  cats.forEach((cat, i) => {
    const c = bandAxis(i) + bandAxis.width / 2;
    const text = truncate(cat, catLabelMax);
    axes.append(
      horizontal
        ? s('text', { class: 'chart__tick', x: m.l - 8, y: c, dy: '0.32em', 'text-anchor': 'end' }, s('title', {}, cat), text)
        : s('text', { class: 'chart__tick', x: c, y: height - m.b + 8, dy: '0.9em', 'text-anchor': 'middle' }, s('title', {}, cat), text),
    );
  });
  svg.append(axes);

  const sub = bandAxis.width / (stacked ? 1 : groups.length);
  const g = s('g', { class: 'chart__data' });
  for (const b of bars) {
    const offset = stacked ? 0 : b.gi * sub;
    const thick = Math.max(sub - (stacked || groups.length === 1 ? 0 : 2), 1);
    const a = valueScale(b.from);
    const z = valueScale(b.to);
    const breach = th && b.to > th.value;
    const tip = `${b.cat}${b.group ? ` · ${b.group}` : ''}: ${num(b.v, unit)}${breach ? ' (above threshold)' : ''}`;
    const geom = horizontal
      ? { x: Math.min(a, z), y: bandAxis(b.ci) + offset, width: Math.abs(z - a), height: thick }
      : { x: bandAxis(b.ci) + offset, y: Math.min(a, z), width: thick, height: Math.abs(z - a) };
    const bar = s('g', { class: 'chart__bar-group', 'data-s': b.gi % 8, 'data-tip': tip });
    bar.append(s('rect', { class: 'chart__bar', rx: 2, ...geom }));
    if (breach) {
      bar.append(s('rect', { class: 'chart__bar chart__bar--breach', rx: 2, style: `fill:${hatchBar}`, ...geom }));
      const mx = horizontal ? geom.x + geom.width + em * 0.8 : geom.x + geom.width / 2;
      const my = horizontal ? geom.y + geom.height / 2 : geom.y - em * 0.7;
      bar.append(triangle(mx, my, em * 0.45, { class: 'chart__breach' }));
    }
    g.append(bar);
  }
  svg.append(g);
  if (th) {
    const p = valueScale(th.value);
    const text = `Threshold ${num(th.value, unit)}`;
    if (horizontal) {
      svg.append(s('line', { class: 'chart__threshold', x1: p, x2: p, y1: m.t, y2: height - m.b }), s('text', { class: 'chart__threshold-label', x: p + 4, y: m.t + em * 0.9 }, text));
    } else thresholdLine(svg, p, m, width, text);
  }
  return { node: svg, legend: cc ? groups.map((name, i) => ({ label: name, s: i % 8 })) : null };
};

export const bar = { sized: true, draw };
