// Dashboard index: a typographic list of every board the current identity can see.
import { h, clear } from "./dom.js";
import { listNodes, toErrorInfo } from "./api.js";
import { href } from "./identity.js";

export const startIndex = async ({ main }) => {
  clear(main).append(h("div", { class: "board__head" }, h("h1", { class: "board__title", id: "board-title" }, "Boards"), h("p", { class: "board__lede", id: "index-count" }, "Loading")));
  const stage = h("section", { class: "board-list", "aria-labelledby": "board-title", "aria-busy": "true" });
  main.append(stage);
  document.title = "Boards · Plinth";
  try {
    const items = (await listNodes("Dashboard")).sort((a, b) => a.slug.localeCompare(b.slug));
    stage.removeAttribute("aria-busy");
    document.getElementById("index-count").textContent = items.length === 1 ? "1 dashboard" : `${items.length} dashboards`;
    if (items.length === 0) {
      stage.append(h("div", { class: "notice notice--empty" }, h("h2", { class: "notice__title" }, "No dashboards yet"), h("p", { class: "notice__text" }, "Ask an agent to create one over MCP and it will be listed here.")));
      return;
    }
    stage.append(
      h(
        "ol",
        { class: "board-list__rows" },
        items.map((d, i) => {
          const count = d.body.spec.layout.items.length;
          return h(
            "li",
            null,
            h(
              "a",
              { class: "board-row", href: href({ d: d.slug }) },
              h("span", { class: "board-row__n", "aria-hidden": "true" }, String(i + 1).padStart(2, "0")),
              h("span", { class: "board-row__name" }, d.body.metadata.title),
              h("span", { class: "board-row__meta" }, `${count} ${count === 1 ? "panel" : "panels"} · revision ${d.revision}`),
              h("span", { class: "board-row__slug is-mono" }, d.slug),
              h("span", { class: "board-row__go", "aria-hidden": "true" }, "→"),
            ),
          );
        }),
      ),
    );
  } catch (err) {
    const info = toErrorInfo(err);
    stage.removeAttribute("aria-busy");
    document.getElementById("index-count").textContent = "";
    stage.append(h("div", { class: "notice notice--error" }, h("h2", { class: "notice__title" }, "Could not list dashboards"), h("p", { class: "notice__text" }, `${info.code}: ${info.message}`), h("button", { type: "button", class: "button", onclick: () => location.reload() }, "Try again")));
  }
};
