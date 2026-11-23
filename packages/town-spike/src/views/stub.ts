// Interiors the prototype does not build (every building except the Bank): an honest page that names the building,
// says it is not built here, and links to the same page in Classic and back to its street.

import { h, t, setText, clear } from "../plat/dom";
import { buildingByRoute } from "../town/boroughs";
import { classicLink } from "../swap/experience";
import { routeLink, type ViewCtx } from "./types";

export class StubView {
  readonly root: HTMLElement;
  readonly h1: HTMLElement;
  private readonly body: HTMLElement;
  path = "";

  constructor(private readonly ctx: ViewCtx) {
    this.h1 = t("h1", "", { id: "stub-title", class: "view-title", tabindex: -1, "data-paint": "text" });
    this.body = h("div", { class: "stub-body", "data-paint": "surface", "data-surface": "pane" });
    this.root = h(
      "section",
      { class: "view stub", "data-view": "stub", "aria-labelledby": "stub-title" },
      h("div", { class: "view-head" }, this.h1),
      this.body,
    );
  }

  show(path: string): { title: string; borough: string | null } {
    this.path = path;
    const hit = buildingByRoute(path);
    const title = hit ? hit.building.name : path === "/home" ? "Town Square · Home" : `Page ${path}`;
    setText(this.h1, title);
    clear(this.body);
    const classic = h(
      "a",
      { class: "btn-link primary", href: classicLink(this.ctx.href(path)) },
      "Open in Classic",
    );
    this.body.append(
      t("p", "This building is not built in the 3D prototype yet. Its page works in Classic.", {
        class: "prose",
        "data-paint": "text",
      }),
      h("div", { class: "stub-actions" }, classic),
    );
    if (hit && hit.borough.id !== "square")
      this.body
        .querySelector(".stub-actions")
        ?.append(
          routeLink(
            this.ctx,
            h("a", { class: "btn-link" }, `Back to ${hit.borough.name}`),
            `/city/b/${hit.borough.id}`,
          ),
        );
    return { title, borough: hit && hit.borough.id !== "square" ? hit.borough.id : null };
  }
}
