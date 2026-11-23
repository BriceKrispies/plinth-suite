import { listDashboards } from "./board.js";
import { h, icon, s } from "./dom.js";
import { plural } from "./format.js";
import { href } from "./identity.js";

/** Miniature of a board's grid, drawn from its layout so boards are recognisable at a glance. */
const thumbnail = (items) => {
  const rows = Math.max(4, ...items.map((i) => i.at.y + i.at.h));
  return s(
    "svg",
    { class: "thumb", viewBox: `0 0 12 ${rows}`, preserveAspectRatio: "xMidYMid meet", "aria-hidden": "true" },
    items.map((i) => s("rect", { x: i.at.x + 0.08, y: i.at.y + 0.08, width: i.at.w - 0.16, height: i.at.h - 0.16, rx: 0.25 })),
  );
};

export const createIndexView = ({ root, setHeading }) => {
  setHeading("Boards", null);
  const card = (node) => {
    const items = node.body.spec?.layout?.items ?? [];
    return h(
      "li",
      null,
      h(
        "a",
        { class: "board-card", href: href({ d: node.slug }) },
        thumbnail(items),
        h("span", { class: "board-card-body" }, h("span", { class: "board-card-title" }, node.body.metadata.title), h("span", { class: "board-card-meta" }, h("code", null, node.slug), h("span", null, `r${node.revision}`), h("span", null, plural(items.length, "panel")))),
        icon("chevron"),
      ),
    );
  };

  const paint = (nodes) => {
    root.replaceChildren(
      h(
        "section",
        { class: "index", "aria-labelledby": "index-title" },
        h("h2", { id: "index-title", class: "vh" }, "Dashboards"),
        nodes.length
          ? h("ul", { class: "board-list" }, nodes.map(card))
          : h("div", { class: "empty-board" }, icon("grid"), h("h2", null, "No boards yet"), h("p", null, "Boards created by an agent or a teammate will be listed here.")),
      ),
    );
  };

  const load = async () => {
    try {
      paint(await listDashboards());
    } catch (e) {
      root.replaceChildren(h("div", { class: "state-page" }, icon("alert"), h("h2", null, "Could not load boards"), h("p", null, String(e.message ?? e))));
    }
  };

  return {
    start: load,
    onEvents: (events) => events.some((e) => !e.backfill && e.kind !== "present") && load(),
    resync: load,
  };
};
