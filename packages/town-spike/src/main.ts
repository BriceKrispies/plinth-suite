// Entry: the swap contract's boot rule (UI-MAP 8.5 rule 1, spec 06 section 6.7.4), then the app and the harness.
//
// Before anything renders: consume ?experience=, compute the effective experience from the override and the site
// default (the cached value first, corrected by `site.appearance.get`), and go to Classic when it says so. A browser
// with neither WebGPU nor WebGL2 goes to Classic with a notice and a session flag (no loop). A renderer that fails
// after this probe does not redirect: the app stays on the route in Plain mode.

import "./styles/plat.css";
import { App } from "./app";
import { installHarness } from "./harness/harness";
import { fetchAppearance } from "./interior/api";
import {
  CLASSIC_BASE,
  UNSUPPORTED_KEY,
  consumeUrlOverride,
  getOverride,
  hasGpu,
  readCachedSite,
  toClassic,
  writeCachedSite,
  type Experience,
} from "./swap/experience";

const goClassic = (notice?: string): void => {
  const target = new URL(toClassic(), location.href);
  if (notice) target.searchParams.set("notice", notice);
  location.replace(`${target.pathname}${target.search}${target.hash}`);
};

const boot = async (): Promise<void> => {
  // Static demo (GitHub Pages): recorded data and a stand-in realtime socket, installed before anything fetches. The
  // recordings sit beside Classic, at <classic base>demo-data/.
  if (import.meta.env.MODE === "demo") {
    const { installDemo } = await import("../../demo-data/src/mock.js");
    await installDemo({ base: CLASSIC_BASE });
  }
  consumeUrlOverride();
  const override = getOverride();
  const cached = readCachedSite();
  if (override === "classic") {
    // The viewer's own choice needs no network. (A cached "classic" site default is not trusted for a redirect:
    // Classic does not update this cache, so a stale value could bounce the viewer between the two apps.)
    goClassic();
    return;
  }
  if (!hasGpu()) {
    try {
      sessionStorage.setItem(UNSUPPORTED_KEY, "1");
    } catch {
      // ignore
    }
    goClassic("town-unsupported");
    return;
  }
  let site: Experience | null = cached;
  try {
    const a = await Promise.race([
      fetchAppearance(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    site = a.experience === "town" ? "town" : "classic";
    writeCachedSite(site);
  } catch {
    // Unknown site default: stay (an unreachable API must not bounce the viewer between the two apps).
  }
  // An explicit Classic override already returned above. A viewer who follows the site default and opens a town URL
  // directly (a shared link, the demo) has chosen the town by the address, so a Classic site default does not bounce
  // them at boot; a live change of the site default while they are here still swaps them (App follows the site).
  const app = new App();
  installHarness(app);
  await app.start(site);
};

void boot();
