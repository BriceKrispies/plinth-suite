// The Suite shell (UI-MAP section 5): side navigation, top bar with balance chip, inbox, bell and live mark,
// the command palette, toasts for realtime events and the identity switcher. `mountShell` is the entry point
// main.js calls; it takes over from the built-in frame in src/app/shell.js.
import { h } from "../ds/js/dom.js";
import { toastRegion } from "../ds/js/toast.js";
import * as api from "../core/api.js";
import * as rt from "../core/rt.js";
import * as router from "../core/router.js";
import { applyMe, meStore } from "../core/stores.js";
import { navContent } from "./nav.js";
import { mountTopbar } from "./topbar.js";
import { createPalette } from "./palette.js";
import { wireToasts } from "./toasts.js";

export const mountShell = ({ nav, topbar, toasts, palette }) => {
  toastRegion(toasts);
  const pal = createPalette(palette);

  nav.append(
    h(
      "div",
      { class: "c-nav__brand" },
      h("a", { class: "app__brand", href: router.href("/") }, "Plinth Suite"),
    ),
    navContent(),
  );
  mountTopbar(topbar, { openPalette: pal.open });
  wireToasts(rt);

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      pal.toggle();
    }
  });

  // The viewer's own profile changed (name, avatar): re-read the bootstrap so the chrome follows.
  let refreshing = false;
  rt.on("member.updated", async (ev) => {
    const handle = meStore.get()?.member?.handle;
    if (!handle || ev.payload.member !== handle || refreshing) return;
    refreshing = true;
    try {
      applyMe(await api.call("me.get"));
    } catch {
      /* the next navigation reads it again */
    } finally {
      refreshing = false;
    }
  });
};
