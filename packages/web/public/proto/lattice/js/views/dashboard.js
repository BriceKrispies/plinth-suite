import { toErrorInfo } from '../api.js';
import { fetchResult, loadLayout, parameterValues } from '../board.js';
import { announce, h } from '../dom.js';
import { actorLabel, clock } from '../format.js';
import { createPanel } from '../panel.js';
import { buildParams } from './params.js';
import { emptyBoard, loadFailure, unknownDashboard } from './states.js';

const WINDOW_KEY = 'incident_window';

const readWindow = () => {
  const [a, b] = (new URLSearchParams(location.search).get(WINDOW_KEY) ?? '').split('..');
  const from = a ? new Date(a).getTime() : NaN;
  const to = b ? new Date(b).getTime() : NaN;
  return Number.isNaN(from) || Number.isNaN(to) ? null : [from, to];
};

const writeWindow = (range) => {
  const url = new URL(location.href);
  if (range) url.searchParams.set(WINDOW_KEY, `${new Date(range[0]).toISOString()}..${new Date(range[1]).toISOString()}`);
  else url.searchParams.delete(WINDOW_KEY);
  history.replaceState(null, '', url);
};

const skeleton = () =>
  h('div', { class: 'board', 'aria-busy': 'true', 'aria-label': 'Loading panels' }, ...[0, 1, 2, 3].map((i) => h('div', { class: 'panel panel--ghost', 'data-state': 'loading', style: `--x:${(i % 2) * 6 + 1};--y:${Math.floor(i / 2) * 3 + 1};--w:6;--h:3` }, h('div', { class: 'skeleton' }))));

/** Dashboard view: loads the layout, keeps one panel view per panel slug, and reconciles on change. */
export const mountDashboard = ({ slug, main, shell }) => {
  const views = new Map();
  let board = null;
  let layout = null;
  let params = {};
  let win = readWindow();
  let busy = false;
  let again = false;
  let pending = [];
  let paramForm = null;
  let paramKey = '';

  const title = h('h1', { class: 'pagehead__title' }, ' ');
  const meta = h('p', { class: 'pagehead__meta' });
  const tools = h('div', { class: 'pagehead__tools' });
  const stage = h('div', { class: 'stage' }, skeleton());
  main.replaceChildren(h('div', { class: 'pagehead' }, h('div', { class: 'pagehead__text' }, title, meta), tools), stage);

  const onWindow = (range) => {
    win = range;
    writeWindow(range);
    for (const v of views.values()) v.setWindow(range);
    shell.trace.addSession(range ? `Brushed window ${clock(range[0])} to ${clock(range[1])}` : 'Cleared brushed window');
  };

  const newView = () => {
    const view = createPanel({ onInspect: (entry, trigger) => shell.inspector.open(entry, trigger), onWindow });
    view.setWindow(win);
    return view;
  };

  const causeFor = (entry, batch) => {
    if (!batch.length) return null;
    const own = batch.filter((e) => e.node === entry.node?.uri);
    const pool = own.length ? own : batch;
    return { event: pool.reduce((a, b) => (b.seq > a.seq ? b : a)), kind: 'updated' };
  };

  const showBoard = () => {
    if (!board) {
      board = h('div', { class: 'board' });
      stage.replaceChildren(board);
    }
    return board;
  };

  const reconcile = (next, batch) => {
    const items = [...next.items].sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x);
    if (!items.length) {
      for (const v of views.values()) v.destroy();
      views.clear();
      board = null;
      stage.replaceChildren(emptyBoard());
      return [];
    }
    const grid = showBoard();
    grid.style.setProperty('--cols', next.columns);
    const added = [];
    const order = [];
    for (const item of items) {
      let view = views.get(item.slug);
      if (!view) {
        view = newView();
        views.set(item.slug, view);
        view.update({ ...item, result: undefined, error: undefined }, causeFor(item, batch));
        added.push(item);
      }
      const { el } = view;
      el.style.setProperty('--x', item.at.x + 1);
      el.style.setProperty('--y', item.at.y + 1);
      el.style.setProperty('--w', item.at.w);
      el.style.setProperty('--h', item.at.h);
      order.push(el);
    }
    for (const [key, view] of views) {
      if (items.some((i) => i.slug === key)) continue;
      view.destroy();
      view.el.remove();
      views.delete(key);
    }
    if (order.some((el, i) => grid.children[i] !== el) || grid.children.length !== order.length) grid.replaceChildren(...order);
    return added;
  };

  const refresh = async (batch = []) => {
    if (busy) {
      again = true;
      pending.push(...batch);
      return;
    }
    busy = true;
    const events = [...pending, ...batch];
    pending = [];
    try {
      const next = await loadLayout(slug);
      if (!next) {
        shell.setCrumb(null);
        stage.replaceChildren(unknownDashboard(slug));
        title.textContent = 'Dashboard not found';
        return;
      }
      layout = next;
      shell.trace.setTitles(next.titles);
      shell.setCrumb(next.title);
      document.title = `${next.title} · Plinth`;
      title.textContent = next.title;
      meta.textContent = `${slug} · revision ${next.dashboard.revision} · ${next.items.length} ${next.items.length === 1 ? 'panel' : 'panels'}`;
      if (!paramForm && Object.keys(next.parameters).length && paramKey !== JSON.stringify(next.parameters)) {
        paramKey = JSON.stringify(next.parameters);
        paramForm = buildParams(next.parameters, new URLSearchParams(location.search), () => refresh());
        if (paramForm) tools.replaceChildren(paramForm);
      }
      params = parameterValues(next.parameters, new URLSearchParams(location.search));

      const added = reconcile(next, events);
      const changed = [];
      await Promise.all(
        next.items.map(async (item) => {
          const entry = await fetchResult(item, params);
          const view = views.get(item.slug);
          if (!view) return;
          const cause = causeFor(entry, events);
          if (view.update(entry, cause) && cause) changed.push({ item, cause });
        }),
      );
      if (events.length) {
        const top = events.reduce((a, b) => (b.seq > a.seq ? b : a));
        const names = (list) => list.map((i) => i.title).join(', ');
        const bits = [];
        if (added.length) bits.push(`${added.length === 1 ? 'Panel' : 'Panels'} added: ${names(added)}`);
        const updated = changed.filter((c) => !added.includes(c.item));
        if (updated.length) bits.push(`Updated: ${names(updated.map((c) => c.item))}`);
        if (bits.length) announce(`${bits.join('. ')}. Caused by change ${top.seq} from ${actorLabel(top.actor)}.`);
      }
    } catch (e) {
      stage.replaceChildren(loadFailure(toErrorInfo(e), () => refresh()));
      board = null;
      views.clear();
    } finally {
      busy = false;
      if (again) {
        again = false;
        refresh();
      }
    }
  };

  refresh();

  return {
    /** Realtime change events (never the replayed backfill). */
    onEvents(items) {
      refresh(items);
    },
    reload: () => refresh(),
    destroy() {
      for (const v of views.values()) v.destroy();
    },
    get layout() {
      return layout;
    },
  };
};
