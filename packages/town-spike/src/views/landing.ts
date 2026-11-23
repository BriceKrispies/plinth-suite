// The landing (spec 01 section 1.4.2): the whole town as one portrait miniature on one screen, the Town Square and
// seven borough tiles. Each tile is a DOM link laid over its painted vignette, with its live signals as text; the
// vignettes, the plates and the flows between tiles are drawn on the main canvas (town/town-scene.ts) from the tiles'
// own rects. At the expanded breakpoint the same list becomes the plinth vista's plaques, positioned over the
// projected blocks, with camera buttons (the vista's gesture alternatives, spec 00 section 0.5).

import { h, t, setText } from "../plat/dom";
import { BOROUGHS, type BoroughId } from "../town/boroughs";
import type { Rect } from "../town/rect";
import { fmt, signed } from "../format";
import { routeLink, type ViewCtx } from "./types";

export interface LandingCallbacks {
  orbit(step: -1 | 1): void;
  resetCamera(): void;
}

export class LandingView {
  readonly root: HTMLElement;
  readonly h1: HTMLElement;
  readonly plinth: HTMLElement;
  readonly tiles = new Map<
    BoroughId,
    { li: HTMLElement; link: HTMLAnchorElement; signals: HTMLElement; desc: HTMLElement }
  >();
  readonly caption: HTMLElement;
  readonly cameraTools: HTMLElement;

  constructor(
    private readonly ctx: ViewCtx,
    cb: LandingCallbacks,
  ) {
    this.h1 = t("h1", "Northwind town", {
      id: "landing-title",
      class: "view-title",
      tabindex: -1,
      "data-paint": "text",
    });
    this.plinth = h("ul", { class: "plinth", "aria-label": "Boroughs" });
    for (const b of BOROUGHS) {
      const path = b.id === "square" ? "/home" : `/city/b/${b.id}`;
      const link = routeLink(
        ctx,
        h(
          "a",
          {
            class: "tile-link",
            "aria-describedby": `t-${b.id}`,
            "data-paint": "surface",
            "data-surface": "plaque",
          },
          t("span", `${b.glyph} ${b.id === "square" ? "Town Square · Home" : b.name}`, {
            class: "tile-name",
          }),
        ),
        path,
      );
      const signals = t("span", "", { class: "tile-signals", "aria-hidden": "true", "data-tone": "ink-2" });
      const desc = h("span", { id: `t-${b.id}`, class: "sr-only" }, b.blurb);
      link.append(signals);
      const li = h("li", { class: "tile", "data-borough": b.id }, link, desc);
      this.plinth.append(li);
      this.tiles.set(b.id, { li, link, signals, desc });
    }
    this.caption = t("p", "", { class: "live-caption", "data-tone": "ink-2", "data-paint": "text" });
    const btn = (label: string, glyph: string, fn: () => void) =>
      h("button", { type: "button", class: "cam-btn", "aria-label": label, onclick: fn }, glyph);
    this.cameraTools = h(
      "div",
      { class: "camera-tools", role: "group", "aria-label": "Camera" },
      btn("Orbit left", "⟲", () => cb.orbit(-1)),
      btn("Orbit right", "⟳", () => cb.orbit(1)),
      btn("Reset camera", "⌖", () => cb.resetCamera()),
    );
    this.root = h(
      "section",
      { id: "landing", class: "view", "data-view": "landing", "aria-labelledby": "landing-title" },
      this.h1,
      this.plinth,
      this.caption,
      this.cameraTools,
    );
    this.update();
  }

  /** Live signals from me.get and the rt counts frame (spec 01 section 1.5: only real data). */
  update(): void {
    const d = this.ctx.data;
    const c = d.me?.counts ?? {};
    const n = (k: string) => c[k] ?? 0;
    const balance = d.me?.balance ?? d.summary?.balance ?? null;
    const set = (id: BoroughId, visible: string, sentence: string) => {
      const tile = this.tiles.get(id);
      if (!tile) return;
      setText(tile.signals, visible);
      setText(tile.desc, sentence);
    };
    set(
      "rewards",
      balance === null
        ? "Bank · Store · Badges"
        : `Bank · ${fmt(balance)}${n("cart_items") ? ` · cart ${n("cart_items")}` : ""}`,
      balance === null
        ? "Points, store and badges."
        : `Your balance is ${fmt(balance)} points. Points, store and badges.`,
    );
    set(
      "personal",
      `✉ ${n("messages_unread")} · ♪ ${n("notifications_unread")} · ☐ ${n("tasks_open")}`,
      `${n("messages_unread")} unread messages, ${n("notifications_unread")} unread notifications, ${n("tasks_open")} open tasks.`,
    );
    set(
      "engage",
      n("content_reviews") ? `✎ ${n("content_reviews")} to review` : "Promotions · Content",
      n("content_reviews")
        ? `${n("content_reviews")} content reviews waiting.`
        : "Promotions, content, automation and the calendar.",
    );
    set(
      "operate",
      n("orders_attention") ? `▲ ${n("orders_attention")} orders` : "Ledger · Stock",
      n("orders_attention")
        ? `${n("orders_attention")} orders need attention.`
        : "The ledger, store management and inventory.",
    );
    set("insight", "Reports · Audit", "Reports and audit.");
    set(
      "admin",
      n("approvals_pending") ? `⛩ ${n("approvals_pending")} waiting` : "Town Hall · Search",
      n("approvals_pending") ? `${n("approvals_pending")} approvals waiting.` : "Admin, search and settings.",
    );
    set("square", "Home", "Home: your start page.");
    set("newtown", "No custom pages yet", "Custom pages. None yet.");
    const last = d.lines[0];
    setText(
      this.caption,
      last
        ? `Latest: ${last.memo?.trim() || last.txn_type} ${signed(last.amount)} · Bank`
        : "The town is quiet.",
    );
  }

  /** The tiles' rects (viewport CSS px) for laying the scene out under them. */
  tileRects(): { tiles: Map<BoroughId, Rect>; plinth: Rect | null } {
    const tiles = new Map<BoroughId, Rect>();
    for (const [id, tile] of this.tiles) {
      const r = tile.li.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        tiles.set(id, { left: r.left, top: r.top, width: r.width, height: r.height });
    }
    const p = this.plinth.getBoundingClientRect();
    return {
      tiles,
      plinth: p.width > 0 ? { left: p.left, top: p.top, width: p.width, height: p.height } : null,
    };
  }

  /** In the vista, plaques stand over their projected blocks. */
  placePlaques(anchor: (id: BoroughId) => { x: number; y: number; visible: boolean }): void {
    for (const [id, tile] of this.tiles) {
      const a = anchor(id);
      tile.li.style.setProperty("--px", `${Math.round(a.x)}px`);
      tile.li.style.setProperty("--py", `${Math.round(a.y)}px`);
      tile.li.toggleAttribute("data-offscreen", !a.visible);
    }
  }

  clearPlaques(): void {
    for (const tile of this.tiles.values()) {
      tile.li.style.removeProperty("--px");
      tile.li.style.removeProperty("--py");
      tile.li.removeAttribute("data-offscreen");
    }
  }
}
