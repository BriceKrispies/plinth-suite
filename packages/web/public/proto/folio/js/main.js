/** Entry point: wires the masthead, ledger, inspector, realtime socket and the active view. */
import { verifyAudit } from "./api.js";
import { $ } from "./dom.js";
import { token } from "./identity.js";
import { createInspector } from "./inspector.js";
import { initMasthead } from "./masthead.js";
import { connect } from "./realtime.js";
import { createTrace } from "./trace.js";
import { mountBoard } from "./view-board.js";
import { mountIndex } from "./view-index.js";

const slug = new URLSearchParams(location.search).get("d");
const titles = new Map();

const masthead = initMasthead();
const trace = createTrace({
  root: $("#trace"),
  list: $("#trace-list"),
  meta: $("#trace-meta"),
  moreButton: $("#trace-more"),
  titleOf: (uri) => titles.get(uri),
});
const inspector = createInspector($("#inspector"));
const root = $("#main");

const view = slug
  ? mountBoard({ root, slug, titles, trace, inspector, masthead })
  : mountIndex({ root, masthead });

// Colophon: the audit chain, re-checked shortly after changes settle.
const audit = $("#audit");
let auditTimer = 0;
const checkAudit = async () => {
  try {
    const d = await verifyAudit();
    audit.dataset.state = d.ok ? "ok" : "bad";
    audit.textContent = d.ok
      ? `Change log verified: ${d.checked} entries, head #${d.head_seq} (${String(d.head_hash).slice(0, 8)})`
      : "Change log verification failed";
  } catch {
    audit.dataset.state = "bad";
    audit.textContent = "Change log verification unavailable";
  }
};
checkAudit();

let rt;
rt = connect({
  token,
  onState: (state) => {
    masthead.setConn(state);
    view.setConn(state, rt?.through);
  },
  onEvents: (items, flags) => {
    trace.add(items, flags);
    const newest = items.filter((e) => e.kind !== "present").reduce((a, b) => (!a || b.seq > a.seq ? b : a), null);
    if (newest) view.noteEvent(newest);
    view.onEvents(items, flags);
    if (!flags.backfill) { clearTimeout(auditTimer); auditTimer = setTimeout(checkAudit, 1500); }
  },
});
