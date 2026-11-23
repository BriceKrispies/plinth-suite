// Experience swap (UI-MAP "Experience swap"): the classic site and the Township GPU site are two frontends over
// one backend, served from one origin (the town app lives under /town/). The site default is
// `appearance.experience` ("classic" | "town"); a viewer may override it with localStorage `plinth.experience`
// ("classic" | "town" | "site", default "site"). Every storage access is guarded: storage can be blocked.
// Both apps sit under the base path: Classic at <base>, the town at <base>town/ (core/base.js).
import { BASE, stripBase, withBase } from "./base.js";

export const EXPERIENCE_KEY = "plinth.experience";
export const OVERRIDES = ["classic", "town", "site"];

export const getOverride = () => {
  try {
    const v = localStorage.getItem(EXPERIENCE_KEY);
    return OVERRIDES.includes(v) ? v : "site";
  } catch {
    return "site";
  }
};

export const setOverride = (value) => {
  if (!OVERRIDES.includes(value)) return;
  try {
    if (value === "site") localStorage.removeItem(EXPERIENCE_KEY);
    else localStorage.setItem(EXPERIENCE_KEY, value);
  } catch {
    /* storage blocked: the choice lasts only for this navigation */
  }
};

/** `?experience=classic|town` (a demo link) sets the override, then is removed from the URL. */
export const consumeUrlOverride = () => {
  try {
    const url = new URL(location.href);
    const v = url.searchParams.get("experience");
    if (v === null) return;
    if (v === "classic" || v === "town") setOverride(v);
    url.searchParams.delete("experience");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
};

/** The experience this viewer gets: their own choice, or the site default when they follow the site. */
export const effectiveExperience = (override, site) => {
  const siteExperience = site === "town" ? "town" : "classic";
  return override === "site" ? siteExperience : override;
};

/** True when the browser can run the Township renderer (WebGPU or WebGL2). */
export const hasGpu = () => {
  try {
    if (navigator.gpu) return true;
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
};

/** Classic URL to its town twin: `/store?as=x#h` -> `/town/store?as=x#h`. Query and hash are kept. */
export const toTown = (url = location.href) => {
  const u = new URL(url, location.href);
  const path = stripBase(u.pathname);
  return `${BASE}town${path === "/town" ? "/" : path}${u.search}${u.hash}`;
};

/** Town URL to its classic twin: `/town/store?as=x#h` -> `/store?as=x#h`. */
export const toClassic = (url = location.href) => {
  const u = new URL(url, location.href);
  const path = stripBase(u.pathname).replace(/^\/town(?=\/|$)/, "") || "/";
  return `${withBase(path)}${u.search}${u.hash}`;
};

export const TOWN_FALLBACK_MESSAGE = "3D view needs WebGPU or WebGL2. Showing the classic site.";
