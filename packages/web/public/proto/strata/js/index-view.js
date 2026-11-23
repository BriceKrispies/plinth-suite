import { listNodes, toErrorInfo } from "./api.js";
import { h } from "./dom.js";
import { pageHref } from "./url.js";

/** A miniature of the dashboard's layout: each panel as a block on the 12-column grid. */
const thumbnail = (items, columns) => {
  const rows = Math.max(1, ...items.map((i) => i.at.y + i.at.h));
  return h("span", {
    class: "thumb", "aria-hidden": "true", style: `--cols:${columns};--rows:${rows}`,
  }, items.map((item) =>
    h("i", { style: `--x:${item.at.x};--y:${item.at.y};--w:${item.at.w};--h:${item.at.h}` })));
};

const card = (node) => {
  const body = node.body;
  const items = body.spec.layout.items;
  const count = items.length;
  const titleId = `dash-${node.slug}`;
  return h("li", { class: "dash" },
    h("article", { class: "dash__card", "aria-labelledby": titleId },
      thumbnail(items, body.spec.layout.columns ?? 12),
      h("div", { class: "dash__text" },
        h("h2", { class: "dash__title", id: titleId },
          h("a", { href: pageHref({ d: node.slug }) }, body.metadata.title)),
        h("p", { class: "dash__meta" },
          h("code", null, node.slug), ` · ${count} ${count === 1 ? "panel" : "panels"} · revision ${node.revision}`))));
};

/** The dashboard index: every board this identity can see. */
export function mountIndex(ui) {
  const { main, header, banner } = ui;
  header.setCrumb(null);
  document.title = "Dashboards · Plinth";
  let timer;

  const list = h("ul", { class: "dash-list", "aria-label": "Dashboards" });
  const status = h("div", { class: "board__notice" });
  main.replaceChildren(
    h("div", { class: "board__head" },
      h("div", { class: "board__heading" },
        h("p", { class: "eyebrow" }, "Workspace"),
        h("h1", { class: "board__title" }, "Dashboards"),
        h("p", { class: "board__meta" }, "Boards built and maintained by people and agents."))),
    status, list);
  list.append(...[0, 1, 2].map(() => h("li", { class: "dash dash--skeleton", "aria-hidden": "true" }, h("div", { class: "skeleton" }))));

  const load = async () => {
    try {
      const nodes = (await listNodes("Dashboard")).sort((a, b) => a.body.metadata.title.localeCompare(b.body.metadata.title));
      banner.set("load", null);
      list.replaceChildren(...nodes.map(card));
      status.replaceChildren(nodes.length === 0
        ? h("div", { class: "empty" },
            h("span", { class: "plates", "aria-hidden": "true" }, h("i"), h("i"), h("i")),
            h("h2", { class: "empty__title" }, "No dashboards yet"),
            h("p", { class: "empty__body" }, "Ask an agent to build one. It will appear here the moment it is committed."))
        : "");
    } catch (e) {
      const info = toErrorInfo(e);
      list.replaceChildren();
      banner.set("load", { tone: "bad", title: "Could not list dashboards.", message: `${info.code}: ${info.message}`, action: { label: "Retry", run: load } });
    }
  };
  load();

  return {
    onEvents() {
      clearTimeout(timer);
      timer = setTimeout(load, 250);
    },
  };
}
