import { verifyAudit } from './api.js';
import { $, h } from './dom.js';
import { icon } from './icons.js';
import { PRINCIPALS, href, principal } from './identity.js';
import { createInspector } from './inspector.js';
import { initMenus } from './menu.js';
import { applyPrefs, readPrefs, savePrefs } from './prefs.js';
import { connect } from './realtime.js';
import { createTrace } from './trace.js';
import { mountDashboard } from './views/dashboard.js';
import { mountIndex } from './views/index.js';

const LIVE = {
  connecting: { text: 'Connecting', icon: 'live' },
  live: { text: 'Live', icon: 'live' },
  reconnecting: { text: 'Reconnecting', icon: 'offline' },
  offline: { text: 'Offline', icon: 'offline' },
};

// ---- Shell: header, display preferences, identity, live state, footer --------------------------
const prefs = readPrefs();
applyPrefs(prefs);
initMenus();

for (const group of ['theme', 'density']) {
  const radios = document.querySelectorAll(`input[name="${group}"]`);
  for (const r of radios) {
    r.checked = r.value === prefs[group];
    r.addEventListener('change', () => {
      prefs[group] = r.value;
      savePrefs(prefs);
    });
  }
}

const crumb = $('#crumb-current');

const brandLink = $('#brand-link');
brandLink.href = href();



const identity = $('#identity-select');
for (const p of PRINCIPALS) identity.append(h('option', { value: p.id }, `${p.name} · ${p.role}`));
identity.value = principal.id;
identity.addEventListener('change', () => {
  const url = new URL(location.href);
  url.searchParams.set('as', identity.value);
  location.assign(url);
});
$('#identity-avatar').textContent = principal.initials;
const me = $('#presence-me');
me.textContent = principal.initials;
me.title = `${principal.name} (you)`;
$('#presence-me-name').textContent = `${principal.name} (you)`;

const liveEl = $('#live');
const banner = $('#banner');
const setLive = (state) => {
  const s = LIVE[state];
  liveEl.dataset.state = state;
  liveEl.replaceChildren(icon(s.icon, 14), h('span', { class: 'live__text' }, s.text));
  const down = state === 'offline' || state === 'reconnecting';
  banner.hidden = !down;
  banner.textContent = down ? 'Connection to the live feed was lost. Reconnecting automatically; panels show the last data received and will catch up when the link returns.' : '';
};

const crumbRoot = $('#crumb-root');
const setCrumb = (title) => {
  crumb.textContent = title ?? '';
  crumb.closest('li').hidden = title === null;
  if (title === null) crumbRoot.setAttribute('aria-current', 'page');
  else crumbRoot.removeAttribute('aria-current');
};

const audit = $('#audit');
verifyAudit().then(
  (data) => {
    const bad = data && (data.valid === false || data.ok === false);
    audit.dataset.state = bad ? 'bad' : 'ok';
    audit.replaceChildren(icon(bad ? 'warn' : 'check', 14), bad ? 'Audit chain failed verification' : 'Audit chain verified');
  },
  () => {
    audit.dataset.state = 'unknown';
    audit.textContent = 'Audit chain not checked';
  },
);

const shell = {
  trace: createTrace($('#trace')),
  inspector: createInspector($('#inspector')),
  setCrumb,
};

// ---- Route -------------------------------------------------------------------------------------
const slug = new URLSearchParams(location.search).get('d');
const main = $('#main');
const view = slug ? mountDashboard({ slug, main, shell }) : mountIndex({ main, shell });

// Hold announcements while the backfill fills the trace, then let new events through politely.
const traceList = $('.trace__list');
let released = false;
const releaseTrace = () => {
  if (released) return;
  released = true;
  setTimeout(() => traceList.removeAttribute('aria-busy'), 900);
};

let wasDown = false;
setLive('connecting');
connect({
  onState: (state) => {
    setLive(state);
    if (state === 'live') releaseTrace();
    if (state === 'live' && wasDown) view.reload();
    wasDown = state === 'offline' || state === 'reconnecting';
  },
  onHead: (seq) => shell.trace.setHead(seq),
  onEvents: (items, { replayed }) => {
    for (const e of items) shell.trace.add(e, { fresh: !replayed });
    if (!replayed) view.onEvents(items);
  },
});
