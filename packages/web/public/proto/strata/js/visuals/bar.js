import { s, uid } from "../dom.js";
import { num } from "../format.js";
import { col, groupRows, numeric, optCol } from "./data.js";
import { chartSvg, hatchDef, legendList, linear, mountPlot, niceScale, thresholdMark, yAxis } from "./core.js";

/** Bar chart: categories on x, optional colour series (grouped, or stacked when asked). */
export function mountBar(host, { result, visual }) {
  const x = col(result, "x", visual.channels.x);
  const y = col(result, "y", visual.channels.y);
  const color = optCol(result, "color", visual.channels.color);
  const unit = visual.options?.unit;
  const threshold = visual.threshold;
  const stacked = visual.options?.stacked === true;

  const categories = [...new Set(result.rows.map((r) => String(r[x.index])))];
  const groups = [...groupRows(result, color)].map(([name, rows], i) => ({
    name: name || y.name,
    i,
    values: categories.map((c) => {
      const hit = rows.find((r) => String(r[x.index]) === c);
      return hit ? numeric(hit[y.index]) : null;
    }),
  }));

  // Each bar spans [from, to] on the value axis; stacked bars sit on the running total.
  const totals = categories.map(() => 0);
  for (const g of groups) {
    g.bars = g.values.map((v, ci) => {
      const from = stacked ? totals[ci] : 0;
      if (stacked && v !== null) totals[ci] += v;
      return v === null ? null : { from, to: from + v, value: v };
    });
  }
  const bars = groups.flatMap((g) => g.bars.filter(Boolean));
  const breaches = threshold ? bars.filter((b) => b.to > threshold.value).length : 0;
  const lo = Math.min(0, ...bars.map((b) => Math.min(b.from, b.to)));
  const hi = Math.max(0, ...bars.map((b) => b.to), threshold?.value ?? 0);
  const yScale = niceScale(lo, hi === lo ? lo + 1 : hi, 4);

  const handle = mountPlot(host, {
    legend: legendList(groups.map((g) => g.name)),
    draw({ width, height, rem }) {
      const fs = rem * 0.75;
      const labels = yScale.ticks.map((t) => num(t, unit));
      const left = Math.ceil(Math.max(...labels.map((l) => l.length)) * fs * 0.6) + rem * 0.9;
      const right = width - rem * 0.6;
      const slot = (right - left) / categories.length;
      const longest = Math.max(...categories.map((c) => c.length)) * fs * 0.58;
      const rotate = longest > slot - 6;
      const top = rem * 1.3;
      const bottom = height - (rotate ? Math.min(longest * 0.75 + rem, rem * 6) : rem * 1.7);
      const scale = linear(yScale.lo, yScale.hi, bottom, top);
      const band = slot * 0.68;
      const each = stacked ? band : band / groups.length;

      const peak = bars.length ? Math.max(...bars.map((b) => b.to)) : 0;
      const svg = chartSvg(
        width, height, `Bar chart of ${visual.channels.y} by ${visual.channels.x}`,
        `${categories.length} categories, ${groups.length > 1 ? `${groups.length} series, ` : ""}highest value ${num(peak, unit)}.` +
          (threshold ? ` Limit ${num(threshold.value, unit)}: ${breaches === 0 ? "not exceeded" : `exceeded by ${breaches} bar${breaches === 1 ? "" : "s"}`}.` : "") +
          " Use View as table for exact values.",
      );
      const hatch = uid("hatch");
      svg.append(hatchDef(hatch), yAxis(yScale.ticks, scale, (t) => num(t, unit), left, right));

      const base = scale(0);
      svg.append(s("line", { class: "axis__base", x1: left, x2: right, y1: base, y2: base }));

      const marks = s("g", { class: "marks" });
      categories.forEach((c, ci) => {
        const cx = left + slot * ci + slot / 2;
        groups.forEach((g, gi) => {
          const b = g.bars[ci];
          if (!b) return;
          const bx = stacked ? cx - band / 2 : cx - band / 2 + each * gi;
          const y1 = scale(Math.max(b.from, b.to));
          const y2 = scale(Math.min(b.from, b.to));
          const breach = threshold && b.to > threshold.value;
          const w = Math.max(2, each - (stacked ? 0 : 2));
          marks.append(s("rect", { class: "bar", dataset: { s: g.i % 6 }, x: bx, y: y1, width: w, height: Math.max(1, y2 - y1), rx: Math.min(4, w / 3) }));
          if (breach) marks.append(s("rect", { class: "bar bar--breach", x: bx, y: y1, width: w, height: Math.max(1, y2 - y1), rx: Math.min(4, w / 3), style: `fill:url(#${hatch})` }));
          if (!stacked && groups.length === 1 && each > rem * 2.4) {
            marks.append(s("text", { class: breach ? "bar__value bar__value--breach" : "bar__value", x: bx + w / 2, y: y1 - 5, "text-anchor": "middle" },
              `${breach ? "▲ " : ""}${num(b.value)}`));
          }
        });
      });
      svg.append(marks);
      if (threshold) svg.append(thresholdMark(threshold, scale, left, right, unit));

      const stride = rotate ? 1 : Math.ceil((longest + 8) / slot);
      svg.append(
        s("g", { class: "axis axis--x" },
          categories.map((c, ci) => {
            if (ci % stride) return null;
            const cx = left + slot * ci + slot / 2;
            const props = rotate
              ? { x: cx, y: bottom + rem * 0.9, "text-anchor": "end", transform: `rotate(-35 ${cx} ${bottom + rem * 0.9})` }
              : { x: cx, y: bottom + rem * 1.25, "text-anchor": "middle" };
            return s("text", props, c);
          })));
      return svg;
    },
  });
  handle.breaches = breaches;
  return handle;
}
