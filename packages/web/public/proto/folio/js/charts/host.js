import { h } from "../dom.js";

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/**
 * Owns one chart's frame. Measures the frame only inside the ResizeObserver callback, then redraws the
 * SVG at its real pixel size on the next animation frame (no layout reads while drawing).
 */
export const createChartHost = (container, draw, { brush = false, label } = {}) => {
  const frame = h("div", { class: "chart", dataset: brush ? { brush: "" } : {} });
  if (label) frame.setAttribute("aria-label", label);
  container.append(frame);

  let width = 0;
  let height = 0;
  let frameId = 0;
  const paint = () => {
    frameId = 0;
    if (width < 24 || height < 24) return;
    frame.replaceChildren(draw({ width, height, u: remPx() }));
  };
  const redraw = () => { if (!frameId) frameId = requestAnimationFrame(paint); };

  const observer = new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    const hh = Math.round(entry.contentRect.height);
    if (w === width && hh === height) return;
    width = w; height = hh;
    redraw();
  });
  observer.observe(frame);

  return {
    frame,
    redraw,
    dispose() { observer.disconnect(); cancelAnimationFrame(frameId); frame.remove(); },
  };
};
