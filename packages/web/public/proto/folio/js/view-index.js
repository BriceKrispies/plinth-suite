/** The dashboard index: a table of contents for the workspace. */
import { listDashboards } from "./board.js";
import { h } from "./dom.js";
import { hrefFor } from "./identity.js";
import { notice } from "./states.js";

const entryFor = (node, i) => {
  const panels = node.body?.spec?.layout?.items?.length ?? 0;
  return h("li", null,
    h("a", { class: "contents__link", href: hrefFor({ d: node.slug }) },
      h("span", { class: "contents__no" }, String(i + 1).padStart(2, "0")),
      h("span", { class: "contents__title" }, node.body?.metadata?.title ?? node.slug,
        h("span", { class: "contents__slug" }, node.slug)),
      h("span", { class: "contents__meta" }, `${panels} panel${panels === 1 ? "" : "s"} · revision ${node.revision}`)));
};

export const mountIndex = ({ root, masthead }) => {
  const body = h("div", null, h("p", { class: "page-dek" }, "Loading dashboards…"));
  root.replaceChildren(
    h("header", { class: "page-head" },
      h("div", { class: "page-head__main" },
        h("p", { class: "eyebrow" }, "Workspace"),
        h("h1", { class: "page-title" }, "Dashboards"),
        h("p", { class: "page-dek" }, "Every board in this workspace. Open one to watch it update as changes are committed."))),
    body);
  document.title = "Dashboards · Plinth";
  masthead.setCrumb(["Dashboards"]);

  let disposed = false;
  const load = async () => {
    try {
      const nodes = (await listDashboards()).filter((n) => !n.deleted);
      if (disposed) return;
      body.replaceChildren(nodes.length
        ? h("ol", { class: "contents", role: "list", "aria-label": "Dashboards" }, nodes.map(entryFor))
        : notice({ title: "No dashboards yet", body: "When an agent or a person creates a dashboard it will be listed here." }));
    } catch (e) {
      if (disposed) return;
      body.replaceChildren(notice({ title: "The Plinth service cannot be reached", body: `${e.info?.message ?? e.message}. Check that the service is running, then retry.`, action: { label: "Retry", onClick: load } }));
    }
  };
  load();

  return {
    noteEvent() {},
    onEvents(items, { backfill }) { if (!backfill && items.length) load(); },
    setConn() {},
    dispose() { disposed = true; },
  };
};
