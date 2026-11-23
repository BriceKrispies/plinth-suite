/** Masthead behaviour: connection state, identity switch, presence and breadcrumb. */
import { h } from "./dom.js";
import { PRINCIPALS, hrefFor, initials, principal, switchTo } from "./identity.js";

const CONN_TEXT = { live: "Live", connecting: "Connecting", offline: "Offline, reconnecting" };

export const initMasthead = () => {
  const conn = document.getElementById("conn");
  const connText = conn.querySelector(".conn__text");
  const select = document.getElementById("identity-select");
  const avatar = document.getElementById("identity-avatar");
  const presence = document.getElementById("presence");
  const crumb = document.getElementById("crumb");

  select.replaceChildren(...PRINCIPALS.map((p) =>
    h("option", { value: p.id, selected: p.id === principal.id }, `${p.name}, ${p.role}`)));
  select.addEventListener("change", () => switchTo(select.value));
  avatar.textContent = initials(principal.name);
  presence.replaceChildren(
    h("li", null, h("span", { class: "avatar", role: "img", "aria-label": `You, ${principal.name}`, title: `You (${principal.name})` }, initials(principal.name))));

  return {
    setConn(state) {
      conn.dataset.state = state;
      connText.textContent = CONN_TEXT[state] ?? state;
    },
    /** `trail` is a list of strings or {label, href}; the last is the current page. */
    setCrumb(trail) {
      const items = trail.map((item, i) => {
        const last = i === trail.length - 1;
        const text = typeof item === "string" ? item : item.label;
        return h("li", last ? { "aria-current": "page" } : null,
          !last && item.href ? h("a", { href: item.href }, text) : text,
          last ? null : h("span", { "aria-hidden": "true" }, " / "));
      });
      crumb.replaceChildren(h("ol", { class: "crumb", role: "list" }, items));
    },
    homeHref: hrefFor(),
  };
};
