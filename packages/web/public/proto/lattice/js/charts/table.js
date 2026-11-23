import { h } from '../dom.js';
import { icon } from '../icons.js';
import { cell, isNumericType, num } from '../format.js';
import { col, isBreach, thresholdOf } from './data.js';

const compare = (type) => (a, b) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (isNumericType(type)) return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'en', { numeric: true });
};

/**
 * A real <table>. `columns` are result column names (all when omitted). `state` is
 * { sort: {name, dir} | null, onSort(name) } so the owner keeps sort across re-renders.
 */
export const buildTable = ({ result, columns, visual, title, limit = 200, state }) => {
  const cols = (columns ?? result.columns.map((c) => c.name)).map((name) => col(result, 'columns', name));
  const th = thresholdOf(visual, result);
  let rows = result.rows;
  const sort = state?.sort;
  if (sort) {
    const c = cols.find((x) => x.name === sort.name);
    if (c) rows = [...rows].sort((a, b) => compare(c.type)(a[c.index], b[c.index]) * (sort.dir === 'desc' ? -1 : 1));
  }
  const shown = rows.slice(0, limit);

  const head = h('tr');
  for (const c of cols) {
    const numeric = isNumericType(c.type);
    const active = sort?.name === c.name;
    head.append(
      h(
        'th',
        { scope: 'col', class: numeric ? 'is-num' : null, 'aria-sort': active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : state ? 'none' : null },
        state
          ? h('button', { class: 'th-sort', type: 'button', onclick: () => state.onSort(c.name) }, c.name, h('span', { class: 'th-sort__mark', 'aria-hidden': 'true' }, active ? (sort.dir === 'desc' ? '▾' : '▴') : '↕'))
          : c.name,
      ),
    );
  }
  if (th) head.append(h('th', { scope: 'col' }, 'Status'));

  const body = h('tbody');
  for (const row of shown) {
    const tr = h('tr');
    const breach = th && isBreach(th, row);
    if (breach) tr.dataset.breach = '';
    for (const c of cols) {
      const v = row[c.index];
      tr.append(h('td', { class: isNumericType(c.type) ? 'is-num' : v === null || v === undefined ? 'is-nil' : null }, cell(v, c.type)));
    }
    if (th) tr.append(h('td', { class: 'td-status' }, breach ? h('span', { class: 'status status--bad' }, icon('warn', 14), `Above ${num(th.value, th.unit)}`) : h('span', { class: 'status' }, 'Within limit')));
    body.append(tr);
  }

  const more = rows.length > shown.length ? h('p', { class: 'table-more' }, `Showing ${shown.length} of ${rows.length} rows`) : null;
  const wrap = h(
    'div',
    { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': `${title}: rows, scrollable` },
    h('table', { class: 'data' }, h('caption', { class: 'sr-only' }, `${title}. ${result.rows.length} rows.${state ? ' Column headers sort the table.' : ''}`), h('thead', {}, head), body),
  );
  return more ? h('div', { class: 'table-frame' }, wrap, more) : h('div', { class: 'table-frame' }, wrap);
};

export const table = {
  sized: false,
  draw: ({ result, visual, title, tableState }) => ({
    node: buildTable({ result, columns: visual.columns, visual, title, limit: visual.options?.page_size ?? 200, state: tableState }),
  }),
};
