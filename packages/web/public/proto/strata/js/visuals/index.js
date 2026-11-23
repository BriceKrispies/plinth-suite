import { ChannelError, col, numeric } from "./data.js";
import { mountBar } from "./bar.js";
import { mountHeatmap } from "./heatmap.js";
import { mountKpi } from "./kpi.js";
import { buildTable, mountTable } from "./table.js";
import { mountXy } from "./xy.js";

/** The seven visual types. Each mount returns `{ breaches, destroy }`. */
const MOUNTS = {
  line: mountXy,
  area: mountXy,
  scatter: mountXy,
  bar: mountBar,
  heatmap: mountHeatmap,
  kpi: mountKpi,
  table: mountTable,
};

export const KIND_LABEL = {
  line: "Line", area: "Area", scatter: "Scatter", bar: "Bar", heatmap: "Heatmap", kpi: "KPI", table: "Table",
};

export const mountVisual = (host, context) => {
  const mount = MOUNTS[context.visual?.type];
  if (!mount) throw new ChannelError(`Unsupported visual type '${context.visual?.type}'.`);
  return mount(host, context);
};

/** The channel whose value is compared with the threshold. */
const valueChannel = (visual) => visual.channels?.value ?? visual.channels?.y;

/** Show the same rows as a real table, with a status column when the visual has a threshold. */
export const mountDataTable = (host, { result, visual, title }) => {
  const columns = result.columns.map((c, index) => ({ index, name: c.name, type: c.type }));
  const name = valueChannel(visual);
  let flag;
  if (visual.threshold && name !== undefined) {
    const valueIndex = col(result, "value", name).index;
    flag = (row) => {
      const v = numeric(row[valueIndex]);
      return v !== null && v > visual.threshold.value ? `▲ Over limit ${visual.threshold.value}` : "";
    };
  }
  host.replaceChildren(buildTable(result, columns, { flag, caption: `${title}, as a table`, limit: 500 }));
  return { breaches: 0, destroy() {} };
};
