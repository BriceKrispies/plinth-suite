import { mountBar } from "./bar.js";
import { mountHeatmap } from "./heatmap.js";
import { mountKpi } from "./kpi.js";
import { mountScatter } from "./scatter.js";
import { mountTable } from "./table.js";
import { mountXY } from "./xy.js";

export { ChannelError } from "./data.js";
export { buildTable } from "./table.js";

const MOUNTERS = {
  line: (c, ctx) => mountXY(c, ctx, false),
  area: (c, ctx) => mountXY(c, ctx, true),
  bar: mountBar,
  heatmap: mountHeatmap,
  scatter: mountScatter,
  kpi: mountKpi,
  table: mountTable,
};

export const TYPE_NAMES = {
  line: "Line chart", area: "Area chart", bar: "Bar chart", heatmap: "Heatmap",
  scatter: "Scatter plot", kpi: "Indicator", table: "Table",
};

/** Mount a visual into `container`. Throws ChannelError when a channel maps a column the query lacks. */
export const mountVisual = (container, ctx) => {
  const mount = MOUNTERS[ctx.visual.type];
  if (!mount) throw new Error(`Unknown visual type '${ctx.visual.type}'.`);
  return mount(container, ctx);
};
