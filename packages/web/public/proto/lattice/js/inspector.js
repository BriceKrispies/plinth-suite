import { h } from './dom.js';
import { cell, plain } from './format.js';
import { icon } from './icons.js';

/** Multi-line, human-readable rendering of a query AST. */
export const formatQuery = (q) => {
  if (!q || typeof q === 'string') return q ? `ref ${q}` : '(no query)';
  const lines = [`from ${q.from}`];
  for (const p of q.where ?? []) lines.push(`${lines.length === 1 ? 'where' : '  and'} ${p.field} ${p.op}${p.value === undefined ? '' : ` ${JSON.stringify(p.value)}`}`);
  if (q.derive) lines.push(`derive ${JSON.stringify(q.derive)}`);
  if (q.group?.length) lines.push(`group by ${q.group.join(', ')}`);
  if (q.aggregate) lines.push(`aggregate ${Object.entries(q.aggregate).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')}`);
  if (q.select) lines.push(`select ${[].concat(q.select).join(', ')}`);
  if (q.order) lines.push(`order ${JSON.stringify(q.order)}`);
  if (q.limit) lines.push(`limit ${q.limit}`);
  return lines.join('\n');
};

const json = (v) => JSON.stringify(v, null, 2);

const row = (term, value, mono = false) =>
  h('div', { class: 'kv__row' }, h('dt', {}, term), h('dd', { class: mono ? 'is-mono' : null }, value));

const section = (heading, ...kids) => h('section', { class: 'insp__section' }, h('h3', { class: 'insp__h' }, heading), ...kids);

/** Modal inspector. Focus moves in on open (to the close button) and returns to the trigger on close. */
export const createInspector = (dialog) => {
  let trigger = null;
  const body = dialog.querySelector('.insp__content');
  const titleEl = dialog.querySelector('#inspector-title');
  const subtitle = dialog.querySelector('.insp__sub');

  const close = () => dialog.open && dialog.close();
  dialog.querySelector('.insp__close').addEventListener('click', close);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close(); // backdrop
  });
  dialog.addEventListener('close', () => {
    if (trigger?.isConnected) trigger.focus();
    trigger = null;
  });

  return {
    open(entry, from) {
      trigger = from;
      titleEl.textContent = entry.title;
      subtitle.textContent = `Panel · ${entry.node?.uri ?? entry.slug}`;
      const { result, node } = entry;

      const meta = result
        ? h(
            'dl',
            { class: 'kv' },
            row('As of', result.as_of ? cell(result.as_of, 'timestamp') : '—'),
            row('Rows', String(result.row_count ?? result.rows.length)),
            row('Columns', result.columns.map((c) => `${c.name} (${c.type})`).join(', ')),
            result.policy_hash ? row('Policy hash', result.policy_hash, true) : null,
            result.plan_summary ? row('Plan summary', plain(result.plan_summary)) : null,
            result.watermarks && Object.keys(result.watermarks).length ? row('Watermarks', plain(result.watermarks), true) : null,
          )
        : h('p', { class: 'insp__note' }, entry.error ? `${entry.error.code}: ${entry.error.message}` : 'No result yet.');

      body.replaceChildren(
        section('Query', h('pre', { class: 'code', tabindex: '0', 'aria-label': 'Formatted query' }, h('code', {}, formatQuery(entry.query))), h('details', { class: 'insp__raw' }, h('summary', {}, 'Raw query JSON'), h('pre', { class: 'code', tabindex: '0' }, h('code', {}, json(entry.query ?? null))))),
        section('Visual', h('pre', { class: 'code', tabindex: '0', 'aria-label': 'Visual specification' }, h('code', {}, json(entry.visual ?? null)))),
        section('Result', meta),
        section('Node', h('dl', { class: 'kv' }, row('URI', node?.uri ?? '—', true), row('Revision', node ? String(node.revision) : '—'), row('Kind', node?.kind ?? 'Panel'), row('Slug', entry.slug, true))),
      );
      dialog.showModal();
    },
  };
};

export const closeIcon = () => icon('close');
