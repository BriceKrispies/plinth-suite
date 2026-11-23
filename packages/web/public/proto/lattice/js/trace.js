import { h } from './dom.js';
import { actorLabel, clockSeconds, nodeKind, plain } from './format.js';
import { icon } from './icons.js';

const MAX = 30;
const FRESH_MS = 8000;

/** The tag comes from the transport (actor and surface), never from timing. */
export const tagOf = (e) => {
  if (e.surface === 'mcp' && e.actor.startsWith('agent:')) return { name: 'live', icon: 'live' };
  if (e.surface === 'driver') return { name: 'replay', icon: 'replay' };
  if (e.surface === 'ui') return { name: 'ui', icon: 'ui' };
  return { name: e.surface, icon: 'system' };
};

const tail = (uri) => uri.split(/[/:]/).filter(Boolean).at(-1) ?? uri;

/** Trace ribbon: newest change first, built like an instrument cluster rather than a log. */
export const createTrace = (root) => {
  const list = root.querySelector('.trace__list');
  const empty = root.querySelector('.trace__empty');
  const head = root.querySelector('.trace__head');
  const seen = new Set();
  let titles = new Map();

  const titleOf = (uri) => titles.get(uri) ?? tail(uri);
  const syncEmpty = () => {
    empty.hidden = list.children.length > 0;
  };

  const eventItem = (e, fresh) => {
    const tag = tagOf(e);
    const rules = e.rule_id ?? [];
    const li = h(
      'li',
      { class: 'evt', 'data-tag': tag.name, 'data-seq': e.seq, 'data-fresh': fresh ? '' : null },
      h('div', { class: 'evt__seq' }, h('span', { class: 'evt__seq-label' }, 'seq'), h('span', { class: 'evt__seq-num' }, e.seq)),
      h(
        'div',
        { class: 'evt__body' },
        h(
          'p',
          { class: 'evt__who' },
          h('span', { class: 'tag' }, icon(tag.icon, 12), tag.name),
          h('span', { class: 'evt__actor' }, actorLabel(e.actor)),
          e.on_behalf_of ? h('span', { class: 'evt__behalf' }, `for ${e.on_behalf_of}`) : null,
          ...rules.map((r) => h('code', { class: 'evt__rule' }, r)),
        ),
        h('p', { class: 'evt__what' }, h('span', { class: 'evt__kind' }, nodeKind(e.node)), h('span', { class: 'evt__title', 'data-node': e.node }, titleOf(e.node))),
        h('p', { class: 'evt__ops', title: plain(e.ops_summary) }, plain(e.ops_summary)),
      ),
    );
    if (fresh) setTimeout(() => li.removeAttribute('data-fresh'), FRESH_MS);
    return li;
  };

  const insert = (li, seq) => {
    const before = [...list.children].find((c) => c.dataset.seq !== '' && Number(c.dataset.seq) < seq);
    if (before) before.before(li);
    else list.append(li);
    while (list.children.length > MAX) list.lastElementChild.remove();
    syncEmpty();
  };

  return {
    /** `fresh` is true only for a realtime event: it alone may animate in. */
    add(e, { fresh }) {
      if (seen.has(e.seq)) return;
      seen.add(e.seq);
      insert(eventItem(e, fresh), e.seq);
    },
    /** A local, non-committed row (a brush or parameter edit). */
    addSession(text) {
      const li = h('li', { class: 'evt', 'data-tag': 'session', 'data-seq': '' }, h('div', { class: 'evt__seq' }, h('span', { class: 'evt__seq-label' }, 'local'), h('span', { class: 'evt__seq-num' }, '—')), h('div', { class: 'evt__body' }, h('p', { class: 'evt__who' }, h('span', { class: 'tag' }, 'session'), h('span', { class: 'evt__actor' }, clockSeconds(Date.now()))), h('p', { class: 'evt__what' }, h('span', { class: 'evt__title' }, text))));
      list.prepend(li);
      while (list.children.length > MAX) list.lastElementChild.remove();
      syncEmpty();
    },
    /** Titles arrive after events do (a new panel is fetched after its change is announced). */
    setTitles(map) {
      titles = map;
      for (const span of list.querySelectorAll('.evt__title[data-node]')) span.textContent = titleOf(span.dataset.node);
    },
    setHead(seq) {
      head.textContent = `head ${seq}`;
    },
  };
};
