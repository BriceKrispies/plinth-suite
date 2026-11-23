// Masthead behaviour: live status, identity switch, presence, theme, breadcrumb.
import { h } from "./dom.js";
import { initials } from "./format.js";
import { PRINCIPALS, href, principal } from "./identity.js";

const THEMES = ["auto", "light", "dark"];
const THEME_LABEL = { auto: "Auto", light: "Light", dark: "Dark" };

const readTheme = () => {
  try {
    const v = localStorage.getItem("meridian-theme");
    return THEMES.includes(v) ? v : "auto";
  } catch {
    return "auto";
  }
};

const applyTheme = (mode) => {
  if (mode === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
};

const saveTheme = (mode) => {
  try {
    localStorage.setItem("meridian-theme", mode);
  } catch {
    /* storage unavailable: the choice lasts for this page view only */
  }
};

export const initMasthead = ({ currentLabel, showStatus }) => {
  // identity switch: a labelled native <select>; switching navigates so every request uses the new token
  const select = document.getElementById("identity-select");
  for (const p of PRINCIPALS) {
    select.append(h("option", { value: p.id, selected: p.id === principal.id }, `${p.name}, ${p.role}`));
  }
  select.addEventListener("change", () => {
    const q = new URLSearchParams(location.search);
    q.set("as", select.value);
    location.search = q.toString();
  });

  const avatar = document.getElementById("presence-self");
  avatar.textContent = initials(principal.name);
  avatar.title = `${principal.name} (you)`;
  document.getElementById("presence-name").textContent = `${principal.name} (you)`;

  const crumbIndex = document.getElementById("crumb-index");
  crumbIndex.href = href({});
  const current = document.getElementById("crumb-current");
  current.textContent = currentLabel ?? "";
  current.hidden = !currentLabel;
  if (!currentLabel) crumbIndex.setAttribute("aria-current", "page");

  document.getElementById("live-status").hidden = !showStatus;

  const button = document.getElementById("theme-toggle");
  let mode = readTheme();
  const paint = () => {
    applyTheme(mode);
    button.textContent = THEME_LABEL[mode];
    button.setAttribute("aria-label", `Colour theme: ${THEME_LABEL[mode].toLowerCase()}. Activate to change.`);
  };
  button.addEventListener("click", () => {
    mode = THEMES[(THEMES.indexOf(mode) + 1) % THEMES.length];
    saveTheme(mode);
    paint();
  });
  paint();

  const status = document.getElementById("live-status");
  const statusText = status.querySelector(".status__text");
  const banner = document.getElementById("banner");
  const bannerText = banner.querySelector(".banner__text");
  let head = null;

  return {
    setCurrent(text) {
      current.textContent = text;
      current.hidden = !text;
    },
    setHead(seq) {
      head = seq;
    },
    setConnection(state, info = {}) {
      status.dataset.state = state;
      if (state === "live") statusText.textContent = head === null ? "Live" : `Live · seq ${head}`;
      else if (state === "connecting") statusText.textContent = "Connecting";
      else statusText.textContent = "Offline";
      banner.hidden = state !== "offline";
      if (state === "offline") {
        const secs = Math.round((info.retryInMs ?? 1000) / 1000);
        bannerText.textContent = `Connection lost. Reconnecting in ${secs} s; the board resumes from the last change it saw.`;
      }
    },
    refreshHead() {
      if (status.dataset.state === "live") statusText.textContent = head === null ? "Live" : `Live · seq ${head}`;
    },
  };
};
