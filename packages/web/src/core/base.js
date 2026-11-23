// The app's base path (Vite `base`, "/" in development, e.g. "/plinth-suite/" on GitHub Pages) and demo mode.
// Route paths inside the app never carry the base ("/store/orders"); URLs in the address bar and in hrefs do.
const env = import.meta.env ?? {};
const raw = typeof env.BASE_URL === "string" && env.BASE_URL.startsWith("/") ? env.BASE_URL : "/";

/** The base with a trailing slash: "/" or "/plinth-suite/". */
export const BASE = raw.endsWith("/") ? raw : `${raw}/`;
const ROOT = BASE.slice(0, -1); // "" or "/plinth-suite"

/** Static demo build (`vite --mode demo`): recorded data, simulated writes, no backend. */
export const DEMO = env.MODE === "demo";

const underBase = (path) =>
  path === ROOT || path.startsWith(`${ROOT}/`) || path.startsWith(`${ROOT}?`) || path.startsWith(`${ROOT}#`);

/** An app path as a URL path: "/store" -> "/plinth-suite/store". Idempotent; leaves "#x", "//host" and URLs alone. */
export const withBase = (path) => {
  if (!ROOT || typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return path;
  return underBase(path) ? path : `${ROOT}${path}`;
};

/** A URL pathname as an app path: "/plinth-suite/store" -> "/store". */
export const stripBase = (pathname) => {
  if (!ROOT) return pathname;
  if (pathname === ROOT) return "/";
  return pathname.startsWith(`${ROOT}/`) ? pathname.slice(ROOT.length) : pathname;
};
