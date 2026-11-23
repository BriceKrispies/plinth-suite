import { area, line } from './line.js';
import { bar } from './bar.js';
import { heatmap } from './heatmap.js';
import { kpi } from './kpi.js';
import { scatter } from './scatter.js';
import { table } from './table.js';

/** Registry of the seven visual types. Each: { sized, draw(ctx) -> { node, legend?, ramp?, brushable? } }. */
export const VISUALS = { line, area, bar, heatmap, kpi, scatter, table };
export { ChannelError, breachNote } from './data.js';
export { buildTable } from './table.js';
