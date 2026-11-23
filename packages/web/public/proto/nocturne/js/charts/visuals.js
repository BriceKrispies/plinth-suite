import { num } from "../format.js";
import { barChart } from "./bar.js";
import { col } from "./data.js";
import { dataTable } from "./datatable.js";
import { heatmapChart } from "./heatmap.js";
import { kpiTile } from "./kpi.js";
import { xyChart } from "./xy.js";

export const VISUAL_LABEL = { line: "Line", bar: "Bar", heatmap: "Heatmap", kpi: "KPI", table: "Table", area: "Area", scatter: "Scatter" };

/** The channel that carries the thresholded value for each visual type. */
const VALUE_CHANNEL = { bar: "y", line: "y", area: "y", heatmap: "value", kpi: "value" };

/** Build the graphical view. Returns {el, destroy}. Throws ChannelError when a channel maps a missing column. */
export const buildVisual = ({ visual, result, title, titleId }) => {
  switch (visual.type) {
    case "kpi":
      return kpiTile({ result, visual });
    case "bar":
      return barChart({ result, visual, title });
    case "heatmap":
      return heatmapChart({ result, visual, title });
    case "line":
    case "area":
    case "scatter":
      return xyChart(visual.type, { result, visual, title });
    case "table": {
      const columns = visual.columns;
      for (const name of columns) col(result, "columns", name);
      return { el: dataTable({ result, columns, caption: `${title} data`, labelledBy: titleId, sortable: true, pageSize: visual.options?.page_size ?? 50 }), destroy() {} };
    }
    default:
      throw new Error(`Unknown visual type '${visual.type}'.`);
  }
};

/** The accessible alternative: every chart's rows as a real table, with the limit status spelled out in words. */
export const buildTable = ({ visual, result, title, titleId }) => {
  const channel = VALUE_CHANNEL[visual.type];
  const limit = visual.threshold?.value;
  let extra;
  if (channel && limit !== undefined) {
    const idx = col(result, channel, visual.channels[channel]).index;
    const over = (r) => Number(r[idx]) > limit;
    extra = { header: `Against limit ${num(limit)}`, flag: over, text: (r) => (over(r) ? "▲ Above limit" : "Within limit") };
  }
  return dataTable({ result, caption: `${title}: data table`, labelledBy: titleId, extra });
};
