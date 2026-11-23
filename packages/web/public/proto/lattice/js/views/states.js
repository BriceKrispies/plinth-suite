import { h } from '../dom.js';
import { icon } from '../icons.js';
import { href } from '../identity.js';

/** A full-width state block: a title, a sentence of detail and optional actions. */
export const stateBlock = ({ tone = 'neutral', iconName = 'grid', title, detail, actions = [] }) =>
  h(
    'section',
    { class: 'state', 'data-tone': tone, 'aria-labelledby': 'state-title' },
    h('div', { class: 'state__icon' }, icon(iconName, 24)),
    h('h2', { class: 'state__title', id: 'state-title' }, title),
    h('p', { class: 'state__detail' }, detail),
    actions.length ? h('div', { class: 'state__actions' }, ...actions) : null,
  );

export const backToIndex = () => h('a', { class: 'btn btn--primary', href: href() }, 'All dashboards');

export const unknownDashboard = (slug) =>
  stateBlock({ tone: 'warn', iconName: 'warn', title: 'Dashboard not found', detail: `There is no dashboard with the slug “${slug}”, or your identity cannot see it.`, actions: [backToIndex()] });

export const emptyBoard = () =>
  stateBlock({ iconName: 'grid', title: 'This board has no panels yet', detail: 'Panels appear here the moment they are added. This page is live, so you can leave it open.' });

export const loadFailure = (info, retry) =>
  stateBlock({ tone: 'bad', iconName: 'warn', title: 'Could not load this view', detail: `${info.code}: ${info.message}`, actions: [h('button', { class: 'btn btn--primary', type: 'button', onclick: retry }, 'Try again'), backToIndex()] });
