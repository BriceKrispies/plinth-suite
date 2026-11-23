import { listNodes, toErrorInfo } from '../api.js';
import { h, uid } from '../dom.js';
import { href } from '../identity.js';
import { icon } from '../icons.js';
import { loadFailure, stateBlock } from './states.js';

/** Dashboard index: a filterable, accessible data table of every dashboard the identity can see. */
export const mountIndex = ({ main, shell }) => {
  let nodes = [];
  let query = '';
  shell.setCrumb(null);
  document.title = 'Dashboards · Plinth';

  const filterId = uid('filter');
  const count = h('p', { class: 'pagehead__meta', role: 'status' }, 'Loading dashboards');
  const input = h('input', { id: filterId, class: 'input', type: 'search', autocomplete: 'off', placeholder: 'Filter by title or slug' });
  const form = h('form', { class: 'params', role: 'search', 'aria-label': 'Filter dashboards', onsubmit: (e) => e.preventDefault() }, h('div', { class: 'field' }, h('label', { for: filterId }, 'Filter'), input));
  const stage = h('div', { class: 'stage' }, h('div', { class: 'panel panel--ghost', 'data-state': 'loading' }, h('div', { class: 'skeleton' })));
  main.replaceChildren(h('div', { class: 'pagehead' }, h('div', { class: 'pagehead__text' }, h('h1', { class: 'pagehead__title' }, 'Dashboards'), count), h('div', { class: 'pagehead__tools' }, form)), stage);

  const render = () => {
    const q = query.trim().toLowerCase();
    const rows = nodes
      .map((n) => ({ n, title: n.body?.metadata?.title ?? n.slug, panels: n.body?.spec?.layout?.items?.length ?? 0, columns: n.body?.spec?.layout?.columns ?? 12 }))
      .filter((r) => !q || r.title.toLowerCase().includes(q) || r.n.slug.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title));
    count.textContent = `${rows.length} of ${nodes.length} ${nodes.length === 1 ? 'dashboard' : 'dashboards'}`;
    if (!nodes.length) {
      stage.replaceChildren(stateBlock({ iconName: 'grid', title: 'No dashboards yet', detail: 'Dashboards created in this workspace will be listed here.' }));
      return;
    }
    if (!rows.length) {
      stage.replaceChildren(stateBlock({ iconName: 'inspect', title: 'No matches', detail: `No dashboard matches “${query}”.` }));
      return;
    }
    const body = h('tbody');
    for (const r of rows)
      body.append(
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, h('a', { class: 'link-strong', href: href({ d: r.n.slug }) }, r.title)),
          h('td', { class: 'is-mono' }, r.n.slug),
          h('td', { class: 'is-num' }, r.panels),
          h('td', { class: 'is-num' }, r.columns),
          h('td', { class: 'is-num' }, `r${r.n.revision}`),
          h('td', { class: 'td-action' }, h('a', { class: 'btn btn--sm', href: href({ d: r.n.slug }), 'aria-label': `Open ${r.title}` }, 'Open', icon('up', 14))),
        ),
      );
    stage.replaceChildren(
      h(
        'div',
        { class: 'table-frame table-frame--page' },
        h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Dashboards, scrollable' }, h('table', { class: 'data data--index' }, h('caption', { class: 'sr-only' }, 'Dashboards'), h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Dashboard'), h('th', { scope: 'col' }, 'Slug'), h('th', { scope: 'col', class: 'is-num' }, 'Panels'), h('th', { scope: 'col', class: 'is-num' }, 'Columns'), h('th', { scope: 'col', class: 'is-num' }, 'Revision'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Actions')))), body)),
      ),
    );
  };

  const load = async () => {
    try {
      nodes = await listNodes('Dashboard');
      render();
    } catch (e) {
      stage.replaceChildren(loadFailure(toErrorInfo(e), load));
    }
  };
  input.addEventListener('input', () => {
    query = input.value;
    if (nodes.length) render();
  });
  load();

  return { onEvents: () => load(), reload: load, destroy() {} };
};
