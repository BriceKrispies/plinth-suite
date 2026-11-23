import { h } from "./dom.js";
import { initials } from "./format.js";
import { PRINCIPALS, principal, switchTo } from "./identity.js";
import { pageHref } from "./url.js";

const CONNECTION = {
  connecting: "Connecting",
  live: "Live",
  offline: "Offline, reconnecting",
};

/** Wire up the static masthead: identity switch, presence, connection state and breadcrumb. */
export function initHeader(root) {
  const select = root.querySelector("[data-identity]");
  select.replaceChildren(
    ...PRINCIPALS.map((p) => h("option", { value: p.id, selected: p.id === principal.id }, `${p.name} · ${p.role}`)));
  select.addEventListener("change", () => switchTo(select.value));

  for (const node of root.querySelectorAll("[data-initials]")) node.textContent = initials(principal.name);
  for (const node of root.querySelectorAll("[data-principal-name]")) node.textContent = principal.name;
  const me = root.querySelector("[data-me]");
  me.title = `${principal.name} (you)`;
  me.querySelector(".sr-only").textContent = `${principal.name}, you`;

  for (const link of root.querySelectorAll("[data-link-index]")) link.href = pageHref();

  const conn = root.querySelector("[data-conn]");
  const text = conn.querySelector("[data-conn-text]");
  const crumb = root.querySelector("[data-crumb-current]");

  return {
    setConnection(state) {
      conn.dataset.state = state;
      text.textContent = CONNECTION[state];
    },
    setCrumb(title) {
      crumb.hidden = !title;
      crumb.querySelector("span").textContent = title ?? "";
    },
  };
}
