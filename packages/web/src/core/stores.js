// Tiny observable stores and the app stores (UI-MAP 3.2).
import { configureFormat } from "../ds/js/format.js";

export const createStore = (initial) => {
  let value = initial;
  const subs = new Set();
  const store = {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const fn of [...subs]) fn(value);
    },
    update: (fn) => store.set(fn(value)),
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
  return store;
};

export const EMPTY_COUNTS = {
  notifications_unread: 0,
  messages_unread: 0,
  approvals_pending: 0,
  tasks_open: 0,
  cart_items: 0,
  content_reviews: 0,
  orders_attention: 0,
};

/** `MeOut` from `me.get`, or null until the shell has booted. */
export const meStore = createStore(null);
/** Whether the viewer holds a permission (UI hint only; the server decides). Understands `*` and `ns:*`. */
export const can = (permission) => {
  const perms = meStore.get()?.permissions ?? [];
  if (perms.includes("*") || perms.includes(permission)) return true;
  return perms.includes(`${permission.split(":")[0]}:*`);
};
/** `NavCounts`, fed by `me.get` and the rt `counts` frame. */
export const countsStore = createStore({ ...EMPTY_COUNTS });
/** `{ balance, tier }` for the viewer: from `me.get`, then `points.posted` and `tier.changed` events. */
export const balanceStore = createStore({ balance: null, tier: null, lastDelta: null });
/** `{ virtual_now, speed, paused }`, ticking locally between server reads. */
export const clockStore = createStore({ virtual_now: new Date().toISOString(), speed: 1, paused: false });
/** `pages.list` items that carry a `nav` entry. */
export const navStore = createStore([]);

// ---- preferences: applied to <html> ----

const THEME_KEY = "plinth-theme";
const readTheme = () => {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "auto";
  } catch {
    return "auto";
  }
};

/** `PreferenceSpec.ui` plus the formatting locale and zone. */
export const prefsStore = createStore({
  theme: readTheme(),
  density: "comfortable",
  reduced_motion: false,
  locale: undefined,
  timezone: undefined,
});

const applyPrefs = (p) => {
  const root = document.documentElement;
  if (p.theme === "light" || p.theme === "dark") root.dataset.theme = p.theme;
  else delete root.dataset.theme;
  root.dataset.density = p.density === "compact" ? "compact" : "comfortable";
  root.dataset.reducedMotion = p.reduced_motion ? "true" : "false";
  if (p.locale) root.lang = p.locale;
  configureFormat({ locale: p.locale, timeZone: p.timezone });
};
prefsStore.subscribe(applyPrefs);

/** Choose a theme ("auto", "light", "dark") and remember it for this browser (try/catch: storage may be absent). */
export const setTheme = (theme) => {
  try {
    if (theme === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* the choice lasts for this page view */
  }
  prefsStore.update((p) => ({ ...p, theme }));
};

/** Seed every store from a `MeOut`. */
export const applyMe = (me) => {
  meStore.set(me);
  if (me.counts) countsStore.set({ ...EMPTY_COUNTS, ...me.counts });
  balanceStore.set({ balance: me.balance ?? null, tier: me.tier ?? null, lastDelta: null });
  const ui = me.preferences?.ui;
  if (ui)
    prefsStore.update((p) => ({
      ...p,
      density: ui.density ?? p.density,
      reduced_motion: Boolean(ui.reduced_motion),
      theme: readTheme() === "auto" ? (ui.theme ?? p.theme) : p.theme,
    }));
  else applyPrefs(prefsStore.get());
  clockStore.set({
    virtual_now: me.virtual_now ?? new Date().toISOString(),
    speed: me.clock?.speed ?? 1,
    paused: Boolean(me.clock?.paused),
  });
};

let clockTimer = 0;
/** Tick the virtual clock once a second at the server's speed. */
export const startClock = () => {
  clearInterval(clockTimer);
  clockTimer = setInterval(() => {
    const c = clockStore.get();
    if (c.paused) return;
    clockStore.set({
      ...c,
      virtual_now: new Date(new Date(c.virtual_now).getTime() + 1000 * c.speed).toISOString(),
    });
  }, 1000);
};

/** Keep counts and balance live from the realtime client. Returns an unsubscribe. */
export const wireStores = (rt) => {
  const offs = [
    rt.onCounts((counts) => countsStore.set({ ...EMPTY_COUNTS, ...counts })),
    rt.on("points.posted", (ev) => {
      const me = meStore.get();
      if (!me?.member || ev.payload.member !== me.member.handle) return;
      balanceStore.update((b) => ({
        ...b,
        balance: ev.payload.balance,
        lastDelta: { delta: ev.payload.delta, seq: ev.seq },
      }));
    }),
    rt.on("tier.changed", (ev) => {
      const me = meStore.get();
      if (!me?.member || ev.payload.member !== me.member.handle) return;
      balanceStore.update((b) => ({
        ...b,
        tier: { ...(b.tier ?? {}), tier: ev.payload.to, lifetime_points: ev.payload.lifetime },
      }));
    }),
  ];
  return () => offs.forEach((off) => off());
};

applyPrefs(prefsStore.get());
