import { dateTime, num, tickTime } from '../format.js';
import { ChannelError, axisKind, axisValue, col, groupRows, numeric, optCol } from './data.js';
import { extent, linear, niceDomain, timeTicks } from './scale.js';
import { chartRoot, leftMargin, s, thresholdLine, triangle, xAxis, yAxis } from './svg.js';

const MAX_HIT_POINTS = 300;
const VISIBLE_DOTS = 30;

const pathOf = (pts, x, y) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)} ${y(p.y1 ?? p.y).toFixed(1)}`).join('');
const areaOf = (pts, x, y) => {
  const top = pathOf(pts, x, y);
  const back = [...pts].reverse().map((p) => `L${x(p.x).toFixed(1)} ${y(p.y0).toFixed(1)}`).join('');
  return `${top}${back}Z`;
};

const collect = (result, visual, type) => {
  const ch = visual.channels;
  const xc = col(result, 'x', ch.x);
  const yc = col(result, 'y', ch.y);
  const sc = optCol(result, 'series', ch.series);
  const xk = axisKind(xc);
  const cats = xk === 'category' ? [...new Set(result.rows.map((r) => String(r[xc.index])))] : null;
  const xOf = (r) => (cats ? cats.indexOf(String(r[xc.index])) : axisValue(r[xc.index], xk));
  const series = [...groupRows(result, sc)].map(([name, rows], i) => ({
    name: name || yc.name,
    i,
    pts: rows
      .map((r) => ({ x: xOf(r), y: numeric(r[yc.index]), raw: r[xc.index] }))
      .filter((p) => p.y !== null && Number.isFinite(p.x))
      .sort((a, b) => a.x - b.x),
  }));
  if (!series.some((sr) => sr.pts.length)) throw new ChannelError(`No plottable rows for ${xc.name} / ${yc.name}.`);

  const stacked = type === 'area' && visual.options?.stacked && sc;
  const cumulative = new Map();
  for (const sr of series)
    for (const p of sr.pts) {
      p.y0 = stacked ? (cumulative.get(p.x) ?? 0) : 0;
      p.y1 = p.y0 + p.y;
      cumulative.set(p.x, p.y1);
    }
  return { xc, yc, xk, cats, series };
};

const drawXY = (type) => (ctx) => {
  const { result, visual, width, height, em } = ctx;
  const unit = visual.options?.unit;
  const th = visual.threshold;
  const { xc, yc, xk, cats, series } = collect(result, visual, type);

  const all = series.flatMap((sr) => sr.pts);
  let [x0, x1] = extent(all.map((p) => p.x));
  if (ctx.window && xk === 'time') [x0, x1] = ctx.window;
  if (x0 === x1) [x0, x1] = [x0 - 1, x1 + 1];

  const ys = all.map((p) => p.y1);
  if (type === 'area') ys.push(0);
  if (th) ys.push(th.value);
  const yd = niceDomain(...extent(ys));

  const m = { t: Math.ceil(em), r: Math.ceil(em * 1.2), b: Math.ceil(em * 2.4), l: leftMargin(em, yd.ticks.map((t) => num(t))) };
  const x = linear(x0, x1, m.l, width - m.r);
  const y = linear(yd.min, yd.max, height - m.b, m.t);
  const plotH = height - m.b - m.t;

  const label = `${type === 'area' ? 'Area' : 'Line'} chart of ${yc.name} by ${xc.name}`;
  const desc = [
    `${series.length} series, ${all.length} points.`,
    ...series.slice(0, 6).map((sr) => {
      const [lo, hi] = extent(sr.pts.map((p) => p.y));
      return `${sr.name}: min ${num(lo, unit)}, max ${num(hi, unit)}, latest ${num(sr.pts.at(-1).y, unit)}.`;
    }),
    th ? `Threshold ${num(th.value, unit)}.` : '',
  ].join(' ');
  const { svg, id } = chartRoot({ width, height, label, desc });

  const axes = s('g', { class: 'chart__axes' });
  yAxis(axes, y, yd.ticks, m, width, (t) => num(t));
  if (cats) {
    const stride = Math.max(1, Math.ceil(cats.length / Math.floor((width - m.l - m.r) / (em * 6))));
    const ticks = cats.map((_, i) => i).filter((i) => i % stride === 0);
    xAxis(axes, x, ticks, m, height, (i) => cats[i]);
  } else if (xk === 'time') {
    xAxis(axes, x, timeTicks(x0, x1, Math.max(2, Math.floor((width - m.l) / (em * 7)))), m, height, tickTime(x1 - x0));
  } else {
    const xd = niceDomain(x0, x1, 6);
    xAxis(axes, x, xd.ticks.filter((t) => t >= x0 && t <= x1), m, height, (t) => num(t));
  }
  svg.append(axes);

  const clipId = `${id}-clip`;
  svg.append(s('clipPath', { id: clipId }, s('rect', { x: m.l, y: m.t, width: width - m.l - m.r, height: plotH })));
  const data = s('g', { class: 'chart__data', 'clip-path': `url(#${clipId})` });
  if (th) thresholdLine(svg, y(th.value), m, width, `Threshold ${num(th.value, unit)}`);

  const xLabel = (p) => (cats ? String(p.raw) : xk === 'time' ? dateTime(p.x) : num(p.x));
  for (const sr of series) {
    const g = s('g', { class: 'chart__series', 'data-s': sr.i % 8 });
    if (type === 'area') g.append(s('path', { class: 'chart__area', d: areaOf(sr.pts, x, y) }));
    g.append(s('path', { class: 'chart__line', d: pathOf(sr.pts, x, y) }));
    const hits = sr.pts.length <= MAX_HIT_POINTS;
    for (const p of hits ? sr.pts : []) {
      const breach = th && p.y > th.value;
      const tip = `${sr.name} · ${xLabel(p)}: ${num(p.y, unit)}${breach ? ' (above threshold)' : ''}`;
      if (breach) g.append(triangle(x(p.x), y(p.y1), em * 0.5, { class: 'chart__breach', 'data-tip': tip }));
      else g.append(s('circle', { class: sr.pts.length <= VISIBLE_DOTS ? 'chart__dot' : 'chart__hit', cx: x(p.x), cy: y(p.y1), r: sr.pts.length <= VISIBLE_DOTS ? 3 : 6, 'data-tip': tip }));
    }
    data.append(g);
  }
  svg.append(data);

  if (visual.options?.brush && xk === 'time' && ctx.onBrush) attachBrush(svg, { x, m, width, plotH, onBrush: ctx.onBrush });

  return {
    node: svg,
    brushable: Boolean(visual.options?.brush && xk === 'time'),
    legend: series.length > 1 ? series.map((sr) => ({ label: sr.name, s: sr.i % 8 })) : null,
  };
};

const attachBrush = (svg, { x, m, width, plotH, onBrush }) => {
  let start = null;
  let rect = null;
  const local = (e) => {
    const box = svg.getBoundingClientRect();
    return Math.min(Math.max(((e.clientX - box.left) * width) / box.width, m.l), width - m.r);
  };
  const finish = (e, commit) => {
    if (start === null) return;
    const end = local(e);
    rect?.remove();
    if (commit && Math.abs(end - start) > 8) onBrush([x.invert(Math.min(start, end)), x.invert(Math.max(start, end))]);
    start = null;
  };
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) * width) / box.width;
    if (px < m.l || px > width - m.r) return;
    start = px;
    svg.setPointerCapture(e.pointerId);
    rect = s('rect', { class: 'chart__brush', x: px, y: m.t, width: 0, height: plotH });
    svg.append(rect);
  });
  svg.addEventListener('pointermove', (e) => {
    if (start === null) return;
    const cur = local(e);
    rect.setAttribute('x', Math.min(start, cur));
    rect.setAttribute('width', Math.abs(cur - start));
  });
  svg.addEventListener('pointerup', (e) => finish(e, true));
  svg.addEventListener('pointercancel', (e) => finish(e, false));
};

export const line = { sized: true, draw: drawXY('line') };
export const area = { sized: true, draw: drawXY('area') };
