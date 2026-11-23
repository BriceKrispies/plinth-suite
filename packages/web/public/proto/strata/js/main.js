import { verifyAudit } from "./api.js";
import { createBanner } from "./banner.js";
import { mountDashboard } from "./dashboard-view.js";
import { $ } from "./dom.js";
import { initHeader } from "./header.js";
import { principal } from "./identity.js";
import { mountIndex } from "./index-view.js";
import { createInspector } from "./inspector.js";
import { connect } from "./realtime.js";
import { createTrace } from "./trace.js";
import { search } from "./url.js";

/** Entry point: wire the static shell, mount one view, open the realtime socket. */
const announcer = $("#announcer");
const announce = (text) => {
  // Clear first so repeating the same sentence is still announced.
  announcer.textContent = "";
  requestAnimationFrame(() => { announcer.textContent = text; });
};

const header = initHeader($("#masthead"));
const trace = createTrace($("#trace"));
const banner = createBanner($("#notice"));
const inspector = createInspector($("#inspector"));
const ui = { main: $("#main"), header, trace, banner, announce, inspector };

const slug = search().get("d");
const view = slug === null ? mountIndex(ui) : mountDashboard(ui, slug);

let auditTimer;
const checkAudit = () => {
  clearTimeout(auditTimer);
  auditTimer = setTimeout(() => {
    verifyAudit().then((ok) => trace.setAudit(ok ? "ok" : "bad"), () => trace.setAudit("unknown"));
  }, 600);
};
checkAudit();

connect({
  token: principal.token,
  onState(state) {
    header.setConnection(state);
    banner.set("offline", state === "offline"
      ? { tone: "warn", title: "Connection lost.", message: "Showing the last known state. Reconnecting automatically; missed changes will be replayed." }
      : null);
  },
  onEvents(items) {
    view.onEvents(items);
    checkAudit();
  },
});
