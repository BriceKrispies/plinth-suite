// The town side of the Classic/Town swap contract (UI-MAP section 8, spec 06 section 6.7). The same contract as
// packages/web/src/core/experience.js: one origin, mirrored routes, the site default on the Program node
// (`site.appearance.get`), the per-viewer override in localStorage `plinth.experience`, and `?experience=` as a
// one-shot demo link. Every storage access is guarded: storage can be blocked.

export type Experience = "classic" | "town";

/** The town app's root without a trailing slash: "/town", or "/plinth-suite/town" under a base path. */
const TOWN_ROOT = import.meta.env.BASE_URL.replace(/\/$/, "");
/** Classic's root: the town root minus its "/town" segment ("" at the origin root, "/plinth-suite" on Pages). */
export const CLASSIC_ROOT = TOWN_ROOT.replace(/\/town$/, "");
/** Classic's base path with a trailing slash ("/" or "/plinth-suite/"). */
export const CLASSIC_BASE = `${CLASSIC_ROOT}/`;

const under = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);
export type ExperienceOverride = Experience | "site";

export const EXPERIENCE_KEY = "plinth.experience";
/** The last site default this browser read, so the boot rule can decide before the network answers. */
export const SITE_CACHE_KEY = "plinth.experience.site";
/** Set when the town app found no GPU path and sent the viewer to Classic (06 section 6.7.5). */
export const UNSUPPORTED_KEY = "plinth.town.unsupported";
/** Query parameters that only mean something to the town app; dropped on the way to Classic. */
export const TOWN_ONLY_PARAMS = [
  "focus",
  "cam",
  "render",
  "plain",
  "backend",
  "motion",
  "test",
  "tier",
  "text",
  "fail",
  "debug",
  "experience",
] as const;

const OVERRIDES: readonly ExperienceOverride[] = ["classic", "town", "site"];

export const getOverride = (): ExperienceOverride => {
  try {
    const v = localStorage.getItem(EXPERIENCE_KEY) as ExperienceOverride | null;
    return v && OVERRIDES.includes(v) ? v : "site";
  } catch {
    return "site";
  }
};

/** "site" is stored by removing the key. */
export const setOverride = (value: ExperienceOverride): void => {
  try {
    if (value === "site") localStorage.removeItem(EXPERIENCE_KEY);
    else localStorage.setItem(EXPERIENCE_KEY, value);
  } catch {
    // storage blocked: the choice lasts only for this navigation
  }
};

export const readCachedSite = (): Experience | null => {
  try {
    const v = localStorage.getItem(SITE_CACHE_KEY);
    return v === "town" || v === "classic" ? v : null;
  } catch {
    return null;
  }
};

export const writeCachedSite = (v: Experience): void => {
  try {
    localStorage.setItem(SITE_CACHE_KEY, v);
  } catch {
    // ignore
  }
};

/** `?experience=classic|town` sets the override, then is removed with history.replaceState. */
export const consumeUrlOverride = (): void => {
  try {
    const url = new URL(location.href);
    const v = url.searchParams.get("experience");
    if (v === null) return;
    if (v === "classic" || v === "town") setOverride(v);
    url.searchParams.delete("experience");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  } catch {
    // ignore
  }
};

/** The experience this viewer gets: their own choice, or the site default when they follow the site. */
export const effectiveExperience = (
  override: ExperienceOverride,
  site: Experience | null | undefined,
): Experience => (override === "site" ? (site === "town" ? "town" : "classic") : override);

/** True when the browser can run the town renderer (WebGPU or WebGL2), the same probe as Classic's. */
export const hasGpu = (): boolean => {
  try {
    if ("gpu" in navigator && (navigator as Navigator & { gpu?: unknown }).gpu) return true;
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
};

/** Classic URL to its town twin: `/store?as=x#h` -> `/town/store?as=x#h`. */
export const toTown = (url: string = location.href): string => {
  const u = new URL(url, location.href);
  let path = u.pathname;
  if (under(path, TOWN_ROOT)) path = path.slice(TOWN_ROOT.length) || "/";
  else if (CLASSIC_ROOT && under(path, CLASSIC_ROOT)) path = path.slice(CLASSIC_ROOT.length) || "/";
  return `${TOWN_ROOT}${path}${u.search}${u.hash}`;
};

/**
 * Town-only routes and the classic route nearest to each (UI-MAP 8.3: a town route with no classic page maps to the
 * nearest classic route, keeping search and hash). The landing, every borough street and district framing go to
 * Classic's home; the Bank's rooms go to the Bank page.
 */
const nearestClassic = (path: string): string => {
  if (path === "/" || path === "") return "/";
  if (/^\/city(\/|$)/.test(path)) return "/";
  if (/^\/(rewards|insight|engage|personal|operate|newtown)\/?$/.test(path)) return "/";
  if (/^\/points\/(statement|transfer)\/?$/.test(path)) return "/points";
  return path.replace(/\/+$/, "") || "/";
};

/** Town URL to its classic twin: `/town/store?as=x&backend=webgl2#h` -> `/store?as=x#h`. */
export const toClassic = (url: string = location.href): string => {
  const u = new URL(url, location.href);
  const rest = under(u.pathname, TOWN_ROOT) ? u.pathname.slice(TOWN_ROOT.length) : u.pathname;
  const path = `${CLASSIC_ROOT}${nearestClassic(rest || "/")}`;
  for (const p of TOWN_ONLY_PARAMS) u.searchParams.delete(p);
  const search = u.searchParams.toString();
  return `${path}${search ? `?${search}` : ""}${u.hash}`;
};

/** The classic mirror as a link that also sets the override (06 section 6.7.3: middle-click and copy-link work). */
export const classicLink = (url: string = location.href): string => {
  const target = new URL(toClassic(url), location.href);
  target.searchParams.set("experience", "classic");
  return `${target.pathname}${target.search}${target.hash}`;
};
