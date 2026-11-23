import { VISUALS, ChannelError, breachNote, buildTable } from './charts/index.js';
import { h, uid } from './dom.js';
import { actorLabel, cell, clock } from './format.js';
import { icon } from './icons.js';
import { signature, summarizeQuery } from './board.js';

const CAUSE_MS = 8000;

const problem = (code, message, hint) =>
  h(
    'div',
    { class: 'problem', role: 'group', 'aria-label': 'Panel error' },
    h('p', { class: 'problem__code' }, icon('warn', 16), code),
    h('p', { class: 'problem__message' }, message),
    hint ? h('p', { class: 'problem__hint' }, hint) : null,
  );

/**
 * One panel: owns its DOM, its states (loading, error, empty, ready) and its draw cycle.
 * Charts are redrawn from the last size reported by a ResizeObserver, so rendering never reads layout.
 */
export const createPanel = ({ onInspect, onWindow }) => {
  const titleId = uid('panel-title');
  let entry;
  let sig = null;
  let first = true;
  let tableOn = false;
  let sort = null;
  let win = null;
  let size = null;
  let drawQueued = false;
  let causeTimer;
  let brushable = false;

  const title = h('h2', { class: 'panel__title', id: titleId });
  const chip = h('p', { class: 'panel__cause', hidden: true });
  const tableLabel = h('span', { class: 'btn__label' }, 'Table');
  const tableBtn = h('button', { class: 'btn btn--subtle btn--sm', type: 'button', 'aria-pressed': 'false', onclick: () => toggleTable() }, icon('table'), tableLabel);
  const summary = h('summary', { class: 'btn btn--subtle btn--icon' }, icon('more'));
  const inspectItem = h('button', { class: 'menu__item', type: 'button', onclick: () => onInspect(entry, summary) }, icon('inspect'), 'Inspect');
  const tableItem = h('button', { class: 'menu__item', type: 'button', onclick: () => toggleTable() }, icon('table'), 'View as table');
  const menu = h('details', { class: 'menu menu--panel' }, summary, h('div', { class: 'menu__list' }, inspectItem, tableItem));

  const viz = h('div', { class: 'panel__viz' });
  const tip = h('div', { class: 'tip', hidden: true, 'aria-hidden': 'true' });
  const legend = h('div', { class: 'panel__legend' });
  const windowText = h('span', { class: 'panel__window-text' });
  const windowClear = h('button', { class: 'btn btn--subtle btn--sm', type: 'button', onclick: () => onWindow(null) }, 'Clear window');
  const windowBar = h('p', { class: 'panel__window', hidden: true }, icon('sliders', 14), windowText, windowClear);
  const note = h('p', { class: 'panel__note', hidden: true });
  const meta = h('p', { class: 'panel__meta' });

  const bodyEl = h('div', { class: 'panel__body' }, windowBar, viz, legend, tip);

  const el = h(
    'section',
    { class: 'panel', 'aria-labelledby': titleId },
    h('header', { class: 'panel__head' }, title, h('div', { class: 'panel__tools' }, tableBtn, menu)),
    chip,
    bodyEl,
    h('footer', { class: 'panel__foot' }, note, meta),
  );

  const state = () => (!entry.result && !entry.error ? 'loading' : entry.error ? 'error' : entry.result.rows.length === 0 ? 'empty' : 'ready');

  const failure = (code, message) => {
    el.dataset.state = 'error';
    viz.dataset.sized = 'false';
    viz.replaceChildren(problem(code, message));
    legend.replaceChildren();
  };

  const renderLegend = (out) => {
    if (out.ramp) {
      const { lo, hi, unit, threshold } = out.ramp;
      legend.replaceChildren(
        h(
          'div',
          { class: 'ramp' },
          h('span', { class: 'ramp__end' }, cell(lo, 'float')),
          h('span', { class: 'ramp__bar', 'aria-hidden': 'true' }),
          h('span', { class: 'ramp__end' }, `${cell(hi, 'float')}${unit ? ` ${unit}` : ''}`),
          threshold !== null ? h('span', { class: 'ramp__hatch' }, h('span', { class: 'ramp__swatch', 'aria-hidden': 'true' }), `Hatched: above ${cell(threshold, 'float')}`) : null,
        ),
      );
    } else if (out.legend) {
      legend.replaceChildren(
        h('ul', { class: 'legend', 'aria-label': 'Series' }, ...out.legend.map((item) => h('li', { class: 'legend__item' }, h('span', { class: `legend__swatch legend__swatch--${item.shape ?? 'bar'}`, 'data-s': item.s, 'aria-hidden': 'true' }), item.label))),
      );
    } else legend.replaceChildren();
  };

  const renderWindow = () => {
    windowBar.hidden = !brushable;
    if (!brushable) return;
    windowText.textContent = win ? `Window ${clock(win[0])} to ${clock(win[1])}` : 'Drag across the chart to select a time window';
    windowClear.hidden = !win;
  };

  const draw = () => {
    drawQueued = false;
    if (!entry || state() !== 'ready') return;
    const visual = entry.visual;
    const mod = visual && VISUALS[visual.type];
    if (!mod) return failure('UNSUPPORTED_VISUAL', `Visual type '${visual?.type ?? 'none'}' is not supported.`);
    try {
      if (tableOn) {
        viz.dataset.sized = 'false';
        viz.replaceChildren(buildTable({ result: entry.result, visual, title: entry.title, state: tableState }));
        legend.replaceChildren();
        brushable = false;
        renderWindow();
        return;
      }
      if (mod.sized && !size) return; // the observer will call back with a size
      viz.dataset.sized = String(mod.sized);
      const out = mod.draw({ result: entry.result, visual, title: entry.title, width: size?.w, height: size?.h, em: size?.em, window: win, onBrush: onWindow, tableState });
      viz.replaceChildren(out.node);
      brushable = Boolean(out.brushable);
      renderLegend(out);
      renderWindow();
    } catch (e) {
      failure(e instanceof ChannelError ? 'CHANNEL_MISMATCH' : 'RENDER_FAILED', e instanceof Error ? e.message : String(e));
    }
  };
  const queueDraw = () => {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(draw);
  };

  const tableState = {
    get sort() {
      return sort;
    },
    onSort: (name) => {
      sort = sort?.name === name ? (sort.dir === 'asc' ? { name, dir: 'desc' } : null) : { name, dir: 'asc' };
      draw();
    },
  };

  const toggleTable = () => {
    tableOn = !tableOn;
    syncTableControls();
    draw();
  };
  const syncTableControls = () => {
    tableBtn.setAttribute('aria-pressed', String(tableOn));
    tableLabel.textContent = tableOn ? 'Chart' : 'Table';
    tableBtn.firstChild.replaceWith(icon(tableOn ? 'chart' : 'table'));
    tableItem.lastChild.textContent = tableOn ? 'View as chart' : 'View as table';
    el.dataset.view = tableOn ? 'table' : 'chart';
  };

  const render = () => {
    const st = state();
    el.dataset.state = st;
    el.dataset.visual = entry.visual?.type ?? 'unknown';
    el.setAttribute('aria-busy', String(st === 'loading'));
    title.textContent = entry.title;
    summary.setAttribute('aria-label', `Actions for ${entry.title}`);
    const canTable = st === 'ready' && entry.visual?.type !== 'table';
    tableBtn.hidden = !canTable;
    tableItem.disabled = !canTable;
    note.hidden = true;
    meta.textContent = '';
    legend.replaceChildren();
    viz.dataset.sized = 'false';
    brushable = false;
    renderWindow();

    if (st === 'loading') {
      viz.replaceChildren(h('div', { class: 'skeleton', 'aria-hidden': 'true' }), h('span', { class: 'sr-only' }, `Loading ${entry.title}`));
    } else if (st === 'error') {
      viz.replaceChildren(problem(entry.error.code, entry.error.message, entry.error.fix_hint));
    } else if (st === 'empty') {
      viz.replaceChildren(h('div', { class: 'empty' }, h('p', { class: 'empty__title' }, 'No rows for this query'), h('p', { class: 'empty__detail' }, summarizeQuery(entry.query))));
      meta.textContent = 'Query returned 0 rows';
    } else {
      const { result } = entry;
      const text = breachNote(entry.visual, result);
      if (text) {
        note.replaceChildren(icon('warn', 14), text);
        note.hidden = false;
      }
      const asOf = result.as_of ? cell(result.as_of, 'timestamp') : null;
      meta.textContent = `${asOf ? `As of ${asOf} · ` : ''}${result.row_count ?? result.rows.length} rows`;
      draw();
    }
  };

  const setCause = ({ event, kind }) => {
    clearTimeout(causeTimer);
    const resolved = el.dataset.cause === "new" || first ? "new" : kind;
    chip.replaceChildren(icon(resolved === 'new' ? 'plus' : 'live', 14), h('strong', {}, resolved === 'new' ? 'Added' : 'Updated'), ` by ${actorLabel(event.actor)} · ${event.surface} · `, h('span', { class: 'panel__cause-seq' }, `seq ${event.seq}`));
    chip.hidden = false;
    delete el.dataset.cause;
    void el.offsetWidth; // restart the arrival animation for a repeat cause
    el.dataset.cause = resolved;
    causeTimer = setTimeout(() => {
      delete el.dataset.cause;
      chip.hidden = true;
    }, CAUSE_MS);
  };

  const observer = new ResizeObserver(([e]) => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const next = { w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height), em: rem * 0.75 };
    if (next.w < 40 || next.h < 40) return;
    if (size && size.w === next.w && size.h === next.h) return;
    size = next;
    if (entry && state() === 'ready' && !tableOn) queueDraw();
  });
  observer.observe(viz);

  // Tooltip: one delegated handler, positioned from the pointer, never from measured layout.
  viz.addEventListener('pointermove', (e) => {
    const target = e.target.closest?.('[data-tip]');
    if (!target) {
      tip.hidden = true;
      return;
    }
    const box = bodyEl.getBoundingClientRect();
    const x = e.clientX - box.left;
    tip.textContent = target.dataset.tip;
    tip.classList.toggle('tip--left', x > box.width * 0.6);
    tip.style.insetInlineStart = `${x}px`;
    tip.style.insetBlockStart = `${e.clientY - box.top}px`;
    tip.hidden = false;
  });
  viz.addEventListener('pointerleave', () => {
    tip.hidden = true;
  });

  return {
    el,
    get entry() {
      return entry;
    },
    get titleEl() {
      return title;
    },
    /** Apply a fresh entry. `cause` is { event, kind } only when a realtime change produced it. */
    update(next, cause) {
      entry = next;
      const nextSig = signature(next);
      const changed = nextSig !== sig;
      sig = nextSig;
      if (changed) {
        render();
        if (cause) setCause(cause);
      }
      first = false;
      return changed;
    },
    setWindow(range) {
      win = range;
      if (entry && state() === 'ready' && !tableOn && brushable) draw();
      else renderWindow();
    },
    destroy() {
      observer.disconnect();
      clearTimeout(causeTimer);
    },
  };
};
