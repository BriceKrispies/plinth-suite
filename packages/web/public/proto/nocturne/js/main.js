import { verifyAudit } from "./api.js";
import { createBoardView } from "./board-view.js";
import { $, h, icon } from "./dom.js";
import { initials } from "./format.js";
import { createIndexView } from "./index-view.js";
import { createInspector } from "./inspector.js";
import { PRINCIPALS, principal, switchTo } from "./identity.js";
import { connect } from "./realtime.js";
import { createTrace } from "./trace.js";

const root = document.documentElement;
const slug = new URLSearchParams(location.search).get("d");

// ---- theme: dark by default, light on request; the choice is a per-viewer convenience only ----
const THEME_KEY = "nocturne.theme";
const readTheme = () => {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};
const applyTheme = (theme) => {
  root.dataset.theme = theme;
  themeButton.setAttribute("aria-pressed", String(theme === "light"));
};
const themeButton = $("#theme-toggle");
applyTheme(readTheme());
themeButton.addEventListener("click", () => {
  const next = root.dataset.theme === "light" ? "dark" : "light";
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* storage unavailable: the theme simply lasts for this page view */
  }
});

// ---- identity ----
const select = $("#identity-select");
select.replaceChildren(...PRINCIPALS.map((p) => h("option", { value: p.id, selected: p.id === principal.id }, `${p.name} · ${p.role}`)));
select.addEventListener("change", () => switchTo(select.value));
for (const node of document.querySelectorAll("[data-avatar]")) node.textContent = initials(principal.name);
$("#presence-self").setAttribute("aria-label", `${principal.name} (you) is viewing this board`);

// ---- announcer and heading ----
const announcer = $("#announcer");
let announceTick = 0;
const announce = (text) => {
  // Clearing first makes repeated identical messages announce again.
  announcer.textContent = "";
  const tick = ++announceTick;
  setTimeout(() => tick === announceTick && (announcer.textContent = text), 50);
};

const titles = new Map();
const onTitles = (nodes) => {
  for (const n of nodes) titles.set(n.uri, { kind: n.kind, title: n.body?.metadata?.title ?? n.slug });
};
const setHeading = (text, dashboard) => {
  $("#page-title").textContent = text;
  document.title = `${text} · Plinth`;
  $("#crumb").hidden = !slug;
  if (dashboard) titles.set(dashboard.uri, { kind: "Dashboard", title: text });
};

// ---- inspector ----
const inspector = createInspector($("#inspector"), { fallbackFocus: () => $("#main") });

// ---- trace ----
const trace = createTrace({ list: $("#trace-list"), headOutput: $("#trace-head"), titles: () => titles });

// ---- view ----
const main = $("#view");
const view = slug
  ? createBoardView({ root: main, slug, announce, onTitles, onInspect: inspector.open, setHeading })
  : createIndexView({ root: main, setHeading });
view.start();

// ---- connection ----
const connLabel = $("#conn-label");
let wasOffline = false;
const CONN = { live: "Live", connecting: "Connecting", offline: "Offline" };
const rt = connect({
  onState: (state, attempt) => {
    root.dataset.conn = state;
    connLabel.textContent = state === "offline" ? `${CONN.offline}, reconnecting` + (attempt > 1 ? ` (attempt ${attempt})` : "") : CONN[state];
    if (state === "offline") wasOffline = true;
    if (state === "live" && wasOffline) {
      wasOffline = false;
      view.resync();
    }
  },
  onHead: (seq) => trace.setHead(seq),
  onEvents: (events) => {
    trace.add(events);
    view.onEvents(events);
  },
});
addEventListener("pagehide", () => rt.close());

// ---- audit chain ----
const audit = $("#audit");
verifyAudit()
  .then((data) => {
    const broken = data && (data.valid === false || data.ok === false || data.verified === false);
    audit.dataset.state = broken ? "bad" : "good";
    audit.replaceChildren(icon(broken ? "alert" : "check"), h("span", null, broken ? "Audit chain failed verification" : "Audit chain verified"));
  })
  .catch(() => {
    audit.dataset.state = "unknown";
    audit.replaceChildren(icon("flat"), h("span", null, "Audit chain not checked"));
  });
