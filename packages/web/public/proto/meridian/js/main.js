// Entry point: routes between the dashboard index and a dashboard view.
import { $ } from "./dom.js";
import { createInspector } from "./inspector.js";
import { startDashboard } from "./dashboard.js";
import { startIndex } from "./index-page.js";
import { initMasthead } from "./masthead.js";
import { createTrace } from "./trace.js";

const main = $("#main");
const slug = new URLSearchParams(location.search).get("d");
document.body.dataset.view = slug ? "board" : "index";

if (!slug) {
  initMasthead({ currentLabel: "", showStatus: false });
  $("#ribbon").hidden = true;
  startIndex({ main });
} else {
  const masthead = initMasthead({ currentLabel: slug, showStatus: true });

  // Status region: polite announcements for "panel added or changed".
  const announcer = $("#announcer");
  let announceTimer;
  const announce = (text) => {
    clearTimeout(announceTimer);
    announcer.textContent = "";
    // A beat between clearing and setting makes repeated identical messages announce again.
    announceTimer = setTimeout(() => {
      announcer.textContent = text;
    }, 60);
  };

  const inspector = createInspector($("#inspector"), {
    onClose: () => {
      const q = new URLSearchParams(location.search);
      q.delete("panel");
      const text = q.toString();
      history.replaceState(null, "", `${location.pathname}${text ? `?${text}` : ""}`);
    },
  });

  let resolveTitle = (uri) => uri;
  const trace = createTrace($("#ribbon"), { titleOf: (uri) => resolveTitle(uri) });
  const dashboard = startDashboard({ main, slug, masthead, trace, inspector, announce });
  resolveTitle = dashboard.titleOf;
}
