import { h, s, icon, uid } from "../dom.js";
import { marker } from "./marks.js";

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/** Legend as a real list. Each swatch repeats the series' marker shape so colour is never the only cue. */
export const legend = (items) =>
  h(
    "ul",
    { class: "legend", "aria-label": "Series" },
    items.map((item) =>
      h(
        "li",
        { class: `legend-item series-${item.index % 6}` },
        s("svg", { class: "legend-swatch", width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": "true" }, s("path", { d: marker(item.shape, 7, 7, 4.5) })),
        h("span", null, item.name),
      ),
    ),
  );

/**
 * A chart figure: an accessible SVG sized to its container, redrawn when the container resizes.
 * `draw({g, width, height, rem, id, tip, frame})` fills the group; it may be called many times.
 */
export const chartFrame = ({ title, desc, draw, legendEl, note, toolbar, idleTip = "", className = "" }) => {
  const id = uid("chart");
  const g = s("g");
  const svg = s(
    "svg",
    { class: "chart-svg", role: "img", "aria-labelledby": `${id}-title ${id}-desc` },
    s("title", { id: `${id}-title` }, title),
    s("desc", { id: `${id}-desc` }, desc),
    g,
  );
  const canvas = h("div", { class: "chart-canvas" }, svg);
  const tipEl = h("p", { class: "chart-tip", "aria-hidden": "true" }, idleTip);
  const noteEl = note ? h("p", { class: "chart-note", "data-tone": note.tone ?? "bad" }, icon("alert"), h("span", null, note.text)) : null;
  const el = h("figure", { class: `chart ${className}`.trim() }, h("div", { class: "chart-top" }, tipEl, toolbar), canvas, legendEl, noteEl);

  let width = 0;
  let height = 0;
  let raf = 0;
  const frame = {
    redraw() {
      g.replaceChildren();
      if (width < 16 || height < 16) return;
      draw({ g, svg, width, height, rem: remPx(), id, tip: (text) => (tipEl.textContent = text || idleTip), frame });
    },
    destroy() {
      observer.disconnect();
      cancelAnimationFrame(raf);
    },
  };

  svg.addEventListener("pointerover", (e) => {
    const target = e.target.closest?.("[data-tip]");
    if (target) tipEl.textContent = target.dataset.tip;
  });
  svg.addEventListener("pointerleave", () => (tipEl.textContent = idleTip));

  const observer = new ResizeObserver(([entry]) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const w = Math.round(entry.contentRect.width);
      const hgt = Math.round(entry.contentRect.height);
      if (w === width && hgt === height) return;
      width = w;
      height = hgt;
      svg.setAttribute("viewBox", `0 0 ${w} ${hgt}`);
      frame.redraw();
    });
  });
  observer.observe(canvas);

  return { el, destroy: frame.destroy, frame };
};
