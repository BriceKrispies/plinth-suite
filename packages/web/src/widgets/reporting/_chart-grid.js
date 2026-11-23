// Bar chart (horizontal, labelled directly) and heatmap (cells carry their values).
import { h, s } from "../../ds/js/dom.js";
import { label, num, niceTicks } from "./_format.js";
import {
  chartSvg,
  col,
  extent,
  hatchDef,
  legend,
  linear,
  mountChart,
  numeric,
  optCol,
  seriesClass,
  textWidth,
  truncate,
} from "./_chart-kit.js";

const figure = (plot, ...rest) => h("figure", { class: "rp-chart" }, plot, ...rest);

export const buildBar = (result, visual, ctx) => {
  const x = col(result, "x", visual.channels.x);
  const y = col(result, "y", visual.channels.y);
  const color = optCol(result, "color", visual.channels.color);
  const unit = visual.options?.unit;
  const limit = visual.threshold?.value;
  const cats = [...new Set(result.rows.map((r) => String(r[x.index])))];
  const names = color ? [...new Set(result.rows.map((r) => String(r[color.index])))] : [""];
  const stacked = visual.options?.stacked === true && names.length > 1;

  // value[cat][series]
  const cell = new Map(cats.map((c) => [c, new Map()]));
  for (const r of result.rows) {
    const v = numeric(r[y.index]);
    if (v === null) continue;
    const name = color ? String(r[color.index]) : "";
    const row = cell.get(String(r[x.index]));
    row.set(name, (row.get(name) ?? 0) + v);
  }
  const totalOf = (c) => [...cell.get(c).values()].reduce((a, b) => a + b, 0);
  const marks = cats.flatMap((c) => {
    let acc = 0;
    return names
      .filter((n) => cell.get(c).has(n))
      .map((n) => {
        const v = cell.get(c).get(n);
        const start = stacked ? acc : 0;
        acc += v;
        return { cat: c, name: n, v, start, end: stacked ? acc : v };
      });
  });
  const [lo, hi] = extent(marks.flatMap((m) => [m.start, m.end]));
  const xt = niceTicks(Math.min(0, lo), Math.max(hi, limit ?? -Infinity), 5);
  const over = limit === undefined ? [] : marks.filter((m) => (stacked ? totalOf(m.cat) : m.v) > limit);
  const overCats = [...new Set(over.map((m) => m.cat))];
  const desc =
    `Bar chart of ${label(y.name)} by ${label(x.name)}: ` +
    cats
      .map((c) => `${c} ${num(stacked ? totalOf(c) : (cell.get(c).get(names[0]) ?? totalOf(c)), unit)}`)
      .join(", ") +
    (limit === undefined
      ? "."
      : `. Threshold ${num(limit, unit)}: ${overCats.length} ${overCats.length === 1 ? "bar is" : "bars are"} above it.`);
  const title = `${ctx.title}: bar chart`;

  // Room the labels need, in rem: a band per bar (per series when grouped) plus the axis. The panel
  // grows its grid row to fit instead of clipping or overprinting the labels.
  const perBar = stacked ? 1 : names.length;
  const plotRem = 3.6 + cats.length * perBar * 1.5;
  const minRem = plotRem + (color ? 1.5 : 0) + (visual.threshold ? 2 : 0) + 0.5;
  const plot = h("div", { class: "rp-chart__plot" });
  plot.style.minBlockSize = `${plotRem}rem`;
  const mounted = mountChart(plot, ({ width, height, fs }) => {
    const small = fs * 0.75;
    const labelSize = fs * 0.85;
    const left = Math.ceil(Math.min(22, Math.max(...cats.map((c) => c.length))) * labelSize * 0.58) + 14;
    const m = {
      top: fs * 1.8,
      right: textWidth(`▲ ${num(xt.max, unit)}`, labelSize) + 10,
      bottom: small + 16,
      left,
    };
    const pw = width - m.left - m.right;
    const ph = height - m.top - m.bottom;
    // Fewer ticks before they would touch: the count follows the width the labels need.
    const room = Math.max(2, Math.floor(pw / (textWidth(num(xt.max), small) + 18)));
    const tk = room < 5 ? niceTicks(Math.min(0, lo), Math.max(hi, limit ?? -Infinity), room) : xt;
    const sx = linear(tk.min, tk.max, 0, pw);
    const band = ph / cats.length;
    const grouped = !stacked && names.length > 1;
    const thick = Math.min((band * 0.66) / (grouped ? names.length : 1), fs * 2.1);
    const hatch = hatchDef();
    const svg = chartSvg({ width, height, title, desc, className: "rp-chart__svg--bar", interactive: true });
    svg.append(s("defs", null, hatch.def));
    svg.append(
      s(
        "text",
        { class: "rp-chart__caption", x: 0, y: fs * 0.95, "font-size": small },
        label(y.name) + (unit ? ` (${unit})` : ""),
      ),
    );

    for (const t of tk.ticks) {
      svg.append(
        s("line", {
          class: t === 0 ? "rp-chart__grid rp-chart__grid--zero" : "rp-chart__grid",
          x1: m.left + sx(t),
          x2: m.left + sx(t),
          y1: m.top,
          y2: m.top + ph,
        }),
        s(
          "text",
          {
            class: "rp-chart__tick",
            x: m.left + sx(t),
            y: m.top + ph + 6 + small,
            "text-anchor": "middle",
            "font-size": small,
          },
          num(t),
        ),
      );
    }
    cats.forEach((c, ci) => {
      const cy = m.top + band * ci + band / 2;
      svg.append(
        s(
          "text",
          {
            class: "rp-chart__cat",
            x: m.left - 10,
            y: cy,
            dy: "0.32em",
            "text-anchor": "end",
            "font-size": labelSize,
          },
          s("title", null, c),
          truncate(c, 22),
        ),
      );
    });
    marks.forEach((mk) => {
      const ci = cats.indexOf(mk.cat);
      const ni = names.indexOf(mk.name);
      const offset = grouped ? (ni - (names.length - 1) / 2) * thick : 0;
      const cy = m.top + band * ci + band / 2 + offset;
      const x0 = m.left + sx(Math.min(mk.start, mk.end));
      const w = Math.max(1, Math.abs(sx(mk.end) - sx(mk.start)));
      const total = stacked ? totalOf(mk.cat) : mk.v;
      const breach = limit !== undefined && total > limit;
      const g = s("g", { class: "rp-chart__bar" });
      if (typeof ctx.onSelect === "function") {
        const picked = ctx.selected !== undefined && ctx.selected !== null && String(ctx.selected) === mk.cat;
        g.classList.add("is-pickable");
        if (picked) g.classList.add("is-picked");
        g.setAttribute("role", "button");
        g.setAttribute("tabindex", "0");
        g.setAttribute("aria-pressed", String(picked));
        g.setAttribute("aria-label", `${picked ? "Clear filter" : "Filter by"} ${x.name} ${mk.cat}`);
        const pick = () => ctx.onSelect({ key: x.name, value: picked ? null : mk.cat });
        g.addEventListener("click", pick);
        g.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            pick();
          }
        });
      }
      g.append(
        s(
          "rect",
          {
            class: `rp-chart__fill ${color ? seriesClass(ni) : "rp-s0"}`,
            x: x0,
            y: cy - thick / 2,
            width: w,
            height: thick,
          },
          s("title", null, `${mk.cat}${mk.name ? ` / ${mk.name}` : ""}: ${num(mk.v, unit)}`),
        ),
      );
      if (breach)
        g.append(
          s("rect", {
            class: "rp-chart__breach-fill",
            x: x0,
            y: cy - thick / 2,
            width: w,
            height: thick,
            fill: hatch.ref,
          }),
        );
      const isLast =
        !stacked || ni === names.length - 1 || mk === marks.filter((q) => q.cat === mk.cat).at(-1);
      // Value labels sit on the bar when the bar is long and thick enough to hold them, else after it.
      const fitsInside = thick >= labelSize * 1.05 && !breach && w > textWidth(num(mk.v), labelSize) + 12;
      if (fitsInside && (stacked || isLast)) {
        g.append(
          s(
            "text",
            {
              class: "rp-chart__value rp-chart__value--in",
              x: x0 + w - 6,
              y: cy,
              dy: "0.34em",
              "text-anchor": "end",
              "font-size": labelSize,
            },
            num(mk.v),
          ),
        );
      }
      if (isLast && (stacked || !fitsInside)) {
        g.append(
          s(
            "text",
            {
              class: `rp-chart__value${breach ? " is-breach" : ""}`,
              x: m.left + sx(mk.end) + 6,
              y: cy,
              dy: "0.34em",
              "font-size": labelSize,
            },
            `${breach ? "▲ " : ""}${num(total)}`,
          ),
        );
      }
      svg.append(g);
    });
    if (limit !== undefined) {
      svg.append(
        s("line", {
          class: "rp-chart__threshold",
          x1: m.left + sx(limit),
          x2: m.left + sx(limit),
          y1: m.top - 4,
          y2: m.top + ph,
        }),
        s(
          "text",
          {
            class: "rp-chart__threshold-label",
            x: m.left + sx(limit),
            y: m.top - 8,
            "text-anchor": "middle",
            "font-size": small,
          },
          `Threshold ${num(limit, unit)}`,
        ),
      );
    }
    return svg;
  });

  const key = color
    ? legend(
        names.map((n, i) => ({ name: n, cls: seriesClass(i), kind: "area" })),
        "Series",
      )
    : null;
  const breachNote =
    limit === undefined
      ? null
      : h(
          "p",
          { class: "rp-chart__note", "data-tone": over.length ? "breach" : "ok" },
          over.length
            ? `▲ ${overCats.length} ${overCats.length === 1 ? "bar" : "bars"} over ${num(limit, unit)}: ${over.map((m) => `${m.cat}${m.name ? ` / ${m.name}` : ""} ${num(stacked ? totalOf(m.cat) : m.v)}`).join(", ")}`
            : `No bars over ${num(limit, unit)}`,
        );
  return { el: figure(plot, key, breachNote), dispose: mounted.dispose, minRem };
};

export const buildHeatmap = (result, visual, ctx) => {
  const x = col(result, "x", visual.channels.x);
  const y = col(result, "y", visual.channels.y);
  const val = col(result, "value", visual.channels.value);
  const unit = visual.options?.unit;
  const limit = visual.threshold?.value;
  const xs = [...new Set(result.rows.map((r) => String(r[x.index])))];
  const ys = [...new Set(result.rows.map((r) => String(r[y.index])))];
  const cells = new Map(result.rows.map((r) => [`${r[x.index]}\u0000${r[y.index]}`, numeric(r[val.index])]));
  const values = [...cells.values()].filter((v) => v !== null);
  const [dmin, dmax] = visual.options?.domain ?? extent(values);
  const t = (v) => (dmax === dmin ? 0.5 : Math.min(1, Math.max(0, (v - dmin) / (dmax - dmin))));
  const overCells =
    limit === undefined ? [] : [...cells.entries()].filter(([, v]) => v !== null && v > limit);
  const nameOf = (key) => key.split("\u0000").join(" / ");
  const desc =
    `Heatmap of ${label(val.name)} by ${label(y.name)} (rows) and ${label(x.name)} (columns), ${values.length} cells ranging from ${num(dmin, unit)} to ${num(dmax, unit)}.` +
    (limit === undefined
      ? ""
      : overCells.length > 0
        ? ` Threshold ${num(limit, unit)} exceeded in ${overCells.map(([k, v]) => `${nameOf(k)} at ${num(v, unit)}`).join("; ")}.`
        : ` No cell exceeds the threshold ${num(limit, unit)}.`);
  const title = `${ctx.title}: heatmap`;

  const plotRem = 1.6 + ys.length * 1.7;
  const minRem = plotRem + 4.5;
  const plot = h("div", { class: "rp-chart__plot rp-chart__plot--heat" });
  plot.style.minBlockSize = `${plotRem}rem`;
  const mounted = mountChart(plot, ({ width, height, fs }) => {
    const small = fs * 0.75;
    const labelSize = fs * 0.85;
    const left = Math.ceil(Math.min(20, Math.max(...ys.map((c) => c.length))) * labelSize * 0.58) + 12;
    const top = small + 12;
    const cw = (width - left) / xs.length;
    const ch = Math.min((height - top) / ys.length, fs * 3.4);
    const hatch = hatchDef({ solid: true });
    const svg = chartSvg({
      width,
      height: Math.ceil(top + ch * ys.length),
      title,
      desc,
      className: "rp-chart__svg--heat",
    });
    svg.append(s("defs", null, hatch.def));
    xs.forEach((c, i) =>
      svg.append(
        s(
          "text",
          {
            class: "rp-chart__cat rp-chart__cat--col",
            x: left + cw * i + cw / 2,
            y: small + 2,
            "text-anchor": "middle",
            "font-size": small,
          },
          c,
        ),
      ),
    );
    ys.forEach((r, j) => {
      svg.append(
        s(
          "text",
          {
            class: "rp-chart__cat",
            x: left - 10,
            y: top + ch * j + ch / 2,
            dy: "0.32em",
            "text-anchor": "end",
            "font-size": labelSize,
          },
          s("title", null, r),
          truncate(r, 20),
        ),
      );
      xs.forEach((c, i) => {
        const v = cells.get(`${c}\u0000${r}`);
        const cx = left + cw * i;
        const cy = top + ch * j;
        const g = s("g", { class: "rp-chart__cell" });
        if (v === null || v === undefined) {
          g.append(
            s(
              "rect",
              { class: "rp-chart__cell-empty", x: cx + 1, y: cy + 1, width: cw - 2, height: ch - 2 },
              s("title", null, `${c} / ${r}: no value`),
            ),
          );
        } else {
          const breach = limit !== undefined && v > limit;
          const p = t(v);
          g.append(
            s(
              "rect",
              {
                class: `rp-chart__cell-fill${breach ? " is-breach" : p > 0.5 ? " is-dark" : ""}`,
                x: cx + 1,
                y: cy + 1,
                width: cw - 2,
                height: ch - 2,
                style: `--w-reporting-t:${(6 + 74 * p).toFixed(1)}%`,
              },
              s(
                "title",
                null,
                `${r} / ${c}: ${num(v, unit)}${breach ? ` (above threshold ${num(limit, unit)})` : ""}`,
              ),
            ),
          );
          if (breach) {
            g.append(
              s("rect", {
                class: "rp-chart__breach-fill",
                x: cx + 1,
                y: cy + 1,
                width: cw - 2,
                height: ch - 2,
                fill: hatch.ref,
              }),
              s("rect", {
                class: "rp-chart__breach-frame",
                x: cx + 2,
                y: cy + 2,
                width: cw - 4,
                height: ch - 4,
              }),
            );
          }
          g.append(
            s(
              "text",
              {
                class: `rp-chart__cell-value${breach ? " is-breach" : p > 0.5 ? " is-dark" : ""}`,
                x: cx + cw / 2,
                y: cy + ch / 2,
                dy: "0.34em",
                "text-anchor": "middle",
                "font-size": labelSize,
              },
              `${breach ? "▲ " : ""}${num(v)}`,
            ),
          );
        }
        svg.append(g);
      });
    });
    return svg;
  });

  const scale = h(
    "div",
    { class: "rp-scale" },
    h("span", { class: "rp-scale__end" }, num(dmin, unit)),
    h("span", { class: "rp-scale__ramp", "aria-hidden": "true" }),
    h("span", { class: "rp-scale__end" }, num(dmax, unit)),
    limit === undefined
      ? null
      : h(
          "span",
          { class: "rp-scale__key" },
          h("span", { class: "rp-scale__hatch", "aria-hidden": "true" }),
          `Above threshold ${num(limit, unit)}`,
        ),
  );
  const note =
    limit === undefined
      ? null
      : h(
          "p",
          { class: "rp-chart__note", "data-tone": overCells.length ? "breach" : "ok" },
          overCells.length
            ? `▲ ${overCells.length} ${overCells.length === 1 ? "cell" : "cells"} over ${num(limit, unit)}: ${overCells.map(([k, v]) => `${nameOf(k)} ${num(v)}`).join(", ")}`
            : `No cells over ${num(limit, unit)}`,
        );
  return { el: figure(plot, scale, note), dispose: mounted.dispose, minRem };
};
