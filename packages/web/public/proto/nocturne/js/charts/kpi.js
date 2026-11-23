import { h, icon, s } from "../dom.js";
import { num } from "../format.js";
import { axisKind, axisValue, col, numeric, optCol } from "./data.js";
import { chartFrame } from "./frame.js";
import { linePath } from "./marks.js";
import { linear } from "./scales.js";

const TONE_WORD = { good: "favourable", bad: "adverse", flat: "unchanged" };

/** Headline number from the last row, with an optional change figure and a sparkline of earlier rows. */
export const kpiTile = ({ result, visual }) => {
  const value = col(result, "value", visual.channels.value);
  const delta = optCol(result, "delta", visual.channels.delta);
  const sx = optCol(result, "x", visual.channels.x);
  const sy = optCol(result, "y", visual.channels.y);
  const unit = visual.options?.unit;
  const good = visual.options?.good ?? "up";
  const limit = visual.threshold?.value;
  const last = result.rows[result.rows.length - 1];
  const v = last ? numeric(last[value.index]) : null;
  const d = last && delta ? numeric(last[delta.index]) : null;
  const over = limit !== undefined && v !== null && v > limit;
  const tone = d === null || d === 0 ? "flat" : d > 0 === (good === "up") ? "good" : "bad";

  let spark = null;
  if (sx && sy && result.rows.length > 1) {
    const kind = axisKind(sx);
    const pts = result.rows.map((r) => ({ x: axisValue(r[sx.index], kind), y: numeric(r[sy.index]) })).filter((p) => p.y !== null && (kind === "category" || Number.isFinite(p.x)));
    const idx = kind === "category" ? (p, i) => i : (p) => p.x;
    const xs = pts.map(idx);
    const ys = pts.map((p) => p.y);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    spark = chartFrame({
      title: `Trend of ${sy.name}`,
      desc: `Sparkline of ${sy.name} over ${sx.name}, ${pts.length} points, from ${num(ys[0])} to ${num(ys[ys.length - 1])}. Low ${num(y0)}, high ${num(y1)}.`,
      className: "spark",
      draw: ({ g, width: W, height: H }) => {
        const pad = 3;
        const X = linear(x0, x1, pad, W - pad);
        const Y = linear(y0, y1, H - pad, pad);
        const line = pts.map((p, i) => [X(idx(p, i)), Y(p.y)]);
        const dPath = linePath(line, true);
        g.append(
          s("path", { class: "area series-0", d: `${dPath}L${W - pad},${H}L${pad},${H}Z` }),
          s("path", { class: "line series-0", d: dPath }),
          s("circle", { class: "dot series-0", cx: line[line.length - 1][0], cy: line[line.length - 1][1], r: 3 }),
        );
      },
    });
  }

  const el = h(
    "div",
    { class: "kpi", "data-over": over ? "" : null },
    h(
      "p",
      { class: "kpi-value" },
      h("span", { class: "kpi-num" }, v === null ? "—" : num(v)),
      unit ? h("span", { class: "kpi-unit" }, unit) : null,
    ),
    d !== null
      ? h(
          "p",
          { class: "kpi-delta", "data-tone": tone },
          icon(d > 0 ? "up" : d < 0 ? "down" : "flat"),
          h("span", { class: "kpi-delta-num" }, num(Math.abs(d))),
          h("span", { class: "kpi-delta-word" }, TONE_WORD[tone]),
        )
      : null,
    limit !== undefined
      ? h("p", { class: "kpi-limit" }, over ? icon("alert") : null, h("span", null, over ? `Above limit ${num(limit, unit)}` : `Limit ${num(limit, unit)}`))
      : null,
    spark?.el,
  );
  return { el, destroy: () => spark?.destroy() };
};
