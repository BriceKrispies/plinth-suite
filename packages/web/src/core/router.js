// History-API router (UI-MAP 3.2). Every navigation calls the registered renderer (the page host), then
// sets the document title, announces it, focuses #main and scrolls (DESIGN-SYSTEM 5.5). Route paths never carry the
// app's base path ("/store"); hrefs and the address bar do ("/plinth-suite/store" on GitHub Pages), see core/base.js.
import { stripBase, withBase } from "./base.js";

const handlers = new Set();
let renderer = null;
let now = {
  path: stripBase(location.pathname),
  query: Object.fromEntries(new URLSearchParams(location.search)),
};

const parse = () => ({
  path: stripBase(location.pathname),
  query: Object.fromEntries(new URLSearchParams(location.search)),
});

/** Keep `?as=` across navigation so the chosen identity survives. */
const withIdentity = (query = {}) => {
  const q = { ...query };
  const as = new URLSearchParams(location.search).get("as");
  if (as && q.as === undefined) q.as = as;
  return q;
};

export const href = (path, query) => {
  const [p, existing] = String(path).split("?");
  const q = new URLSearchParams(existing ?? "");
  for (const [k, v] of Object.entries(withIdentity(query)))
    if (v !== undefined && v !== null) q.set(k, String(v));
  const text = q.toString();
  return withBase(`${p}${text ? `?${text}` : ""}`);
};

/** The route being shown: `{ path, query }`. */
export const current = () => now;

/** The handler the page host registers: `(path, query, { animate }) => Promise<{ title }>` (`animate`: a navigation, not a refresh). */
export const setRenderer = (fn) => {
  renderer = fn;
};

export const onRoute = (handler) => {
  handlers.add(handler);
  return () => handlers.delete(handler);
};

const announce = (text) => {
  const el = document.getElementById("announcer");
  if (!el) return;
  el.textContent = "";
  setTimeout(() => (el.textContent = text), 60);
};

const go = async ({ focus = true } = {}) => {
  now = parse();
  for (const fn of [...handlers]) fn(now);
  let title = "";
  try {
    title = (await renderer?.(now.path, now.query, { animate: focus }))?.title ?? "";
  } catch (e) {
    console.error(e);
  }
  document.title = title ? `${title} · Plinth Suite` : "Plinth Suite";
  if (!focus) return;
  announce(title || "Page loaded");
  const main = document.getElementById("main");
  main?.focus({ preventScroll: true });
  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  else window.scrollTo(0, 0);
};

export const navigate = (path, { replace = false } = {}) => {
  const target = path.startsWith("/") ? href(path) : path;
  if (replace) history.replaceState(null, "", target);
  else history.pushState(null, "", target);
  return go();
};

/** Re-render the current route without moving focus (a realtime layout change, for example). */
export const refresh = () => go({ focus: false });

const sameOriginLink = (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!a || a.target || a.hasAttribute("download") || a.getAttribute("rel")?.includes("external"))
    return null;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return null;
  // the Township site (<base>town/) is another app: a full navigation
  if (/^\/town(\/|$)/.test(stripBase(url.pathname))) return null;
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;
  return url;
};

export const start = () => {
  window.addEventListener("popstate", () => go());
  document.addEventListener("click", (e) => {
    const url = sameOriginLink(e);
    if (!url) return;
    e.preventDefault();
    navigate(`${url.pathname}${url.search}${url.hash}`);
  });
  // the first render leaves focus at the top of the document, so the first Tab reaches the skip link
  return go({ focus: false });
};
