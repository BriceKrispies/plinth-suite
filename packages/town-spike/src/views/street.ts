// A borough's high street (spec 01 section 1.4.3): 1 to 6 district bands stacked down the page, the document's own
// scroller. Each band's static model is rendered once into a texture and shown as an image in a <canvas> inside the
// scroller, so the compositor scrolls the buildings with their DOM links, at any refresh rate, with no canvas frame
// per scroll. Each building is a real link over its facade rect (at least 44 × 44). The street dock (‹ Town, the
// neighbouring boroughs and a switcher) sits above the bottom bar.

import { h, t, setText } from "../plat/dom";
import { BOROUGHS, type BoroughDef, type DistrictDef } from "../town/boroughs";
import { paintImage } from "../town/paint-image";
import { fmt, signed } from "../format";
import { routeLink, type BandRect, type ViewCtx } from "./types";

interface Band {
  readonly district: DistrictDef;
  readonly section: HTMLElement;
  readonly stage: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly links: Map<string, HTMLAnchorElement>;
  readonly summary: HTMLElement;
  bakedKey: string;
}

/** A band's height (CSS px) for a content width: 160 to 245 px (spec 01 section 1.4.3), capped in landscape. */
const bandHeight = (width: number, hero: boolean): number => {
  const base = Math.round(Math.min(245, Math.max(160, width * (hero ? 0.56 : 0.46))));
  const short = window.matchMedia("(max-height: 30rem)").matches;
  return short ? Math.min(base, Math.round(window.innerHeight * 0.62)) : base;
};

export class StreetView {
  readonly root: HTMLElement;
  readonly h1: HTMLElement;
  readonly dock: HTMLElement;
  readonly bands: Band[] = [];
  bakes = 0;
  private baking: Promise<void> | null = null;

  constructor(
    private readonly ctx: ViewCtx,
    readonly borough: BoroughDef,
    openSwitcher: (opener: HTMLElement) => void,
  ) {
    const id = borough.id;
    this.h1 = t("h1", borough.name, {
      id: `street-title-${id}`,
      class: "view-title",
      tabindex: -1,
      "data-paint": "text",
    });
    const intro = t(
      "p",
      `${borough.districts.length === 1 ? "One district" : `${borough.districts.length} districts`}. ${borough.blurb}`,
      { class: "view-sub", "data-tone": "ink-2", "data-paint": "text" },
    );
    const list = h("div", { class: "bands" });
    for (const d of borough.districts) list.append(this.buildBand(d).section);

    // The street dock: ‹ Town, previous and next borough (tile order), and the switcher sheet.
    const order = BOROUGHS.filter((b) => b.id !== "square");
    const i = order.findIndex((b) => b.id === id);
    const prev = order[(i - 1 + order.length) % order.length]!;
    const next = order[(i + 1) % order.length]!;
    const dockLink = (label: string, path: string, cls: string, aria?: string) =>
      routeLink(
        ctx,
        h("a", { class: `dock-btn ${cls}`, ...(aria ? { "aria-label": aria } : {}) }, label),
        path,
      );
    const switcher = h(
      "button",
      {
        type: "button",
        class: "dock-btn switcher",
        "aria-haspopup": "dialog",
        "aria-label": `Borough: ${borough.name}. Choose another`,
      },
      `${borough.name} ▾`,
    );
    switcher.addEventListener("click", () => openSwitcher(switcher));
    this.dock = h(
      "nav",
      { class: "dock street-dock", "aria-label": "Street" },
      dockLink("‹ Town", "/", "back", "Back to the town"),
      dockLink(`‹ ${prev.name}`, `/city/b/${prev.id}`, "prev", `Previous borough, ${prev.name}`),
      switcher,
      dockLink(`${next.name} ›`, `/city/b/${next.id}`, "next", `Next borough, ${next.name}`),
    );
    this.root = h(
      "section",
      {
        class: "view street",
        "data-view": "street",
        "data-borough": id,
        "aria-labelledby": `street-title-${id}`,
      },
      h("div", { class: "view-head" }, this.h1, intro),
      list,
      this.dock,
    );
    this.update();
  }

  private buildBand(d: DistrictDef): Band {
    const hid = `d-${d.id}`;
    const summary = t("p", "", {
      id: `${hid}-sum`,
      class: "band-sum",
      "data-tone": "ink-2",
      "data-paint": "text",
    });
    const canvas = h("canvas", { class: "band-image", "aria-hidden": "true" });
    const links = new Map<string, HTMLAnchorElement>();
    const lots = h("ul", { class: "lots", "aria-label": `Buildings in ${d.plaque}` });
    for (const b of d.buildings) {
      if (!b.route) {
        lots.append(
          h("li", { class: "lot-scenery" }, t("span", b.name, { class: "lot-label", "data-tone": "ink-2" })),
        );
        continue;
      }
      const a = routeLink(
        this.ctx,
        h(
          "a",
          // Plaques sit over the band image (a DOM canvas), so they are always DOM text and CSS surfaces: a
          // GPU-painted copy would be drawn under the image.
          { class: `lot${b.hero ? " hero" : ""}`, "data-building": b.id },
          h("span", { class: "lot-label" }, b.name),
        ),
        b.route,
      );
      links.set(b.id, a);
      lots.append(h("li", {}, a));
    }
    const stage = h("div", { class: "band-stage" }, canvas, lots);
    const section = h(
      "section",
      { class: "band", "data-district": d.id, "aria-labelledby": hid, "aria-describedby": `${hid}-sum` },
      h(
        "div",
        { class: "band-head" },
        t("h2", d.plaque, { id: hid, class: "band-title", "data-paint": "text" }),
        summary,
      ),
      stage,
    );
    const band: Band = { district: d, section, stage, canvas, links, summary, bakedKey: "" };
    this.bands.push(band);
    return band;
  }

  update(): void {
    const d = this.ctx.data;
    const balance = d.me?.balance ?? d.summary?.balance ?? null;
    for (const band of this.bands) {
      let text = `${band.district.buildings.length} building${band.district.buildings.length === 1 ? "" : "s"}.`;
      if (band.district.id === "points") {
        const last = d.lines[0];
        text =
          balance === null
            ? "Your statement, transfers and balance."
            : `Your balance ${fmt(balance)}.${last ? ` Last: ${last.memo?.trim() || last.txn_type} ${signed(last.amount)}.` : ""}`;
      } else if (band.district.id === "store") {
        const cart = d.me?.counts["cart_items"] ?? 0;
        text = cart ? `${cart} in your cart.` : "The Emporium: rewards to spend points on.";
      } else if (band.district.id === "badges") text = "The Hall of Honours: badges and their holders.";
      setText(band.summary, text);
    }
  }

  /**
   * Lay each band out for the current width and bake its image (one band per engine frame). Links are placed from
   * the bake camera's projection of each building, so they sit over their facades exactly, whether or not the image
   * itself could be baked (Plain mode keeps the links as a list).
   */
  layout(): Promise<void> {
    const run = async () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const band of this.bands) {
        const width = band.stage.clientWidth || band.section.clientWidth;
        if (width <= 0) continue;
        const hero = band.district.buildings.some((b) => b.hero);
        const height = bandHeight(width, hero);
        const gpu = this.ctx.gpu();
        const key = `${width}x${height}@${dpr}`;
        // Until the GPU chunk has loaded (and in Plain mode) the buildings are a plain list of links.
        if (!gpu || band.bakedKey === key) continue;
        band.stage.style.height = `${height}px`;
        const { rects, image } = await gpu.bakeBand(band.district, width, height, dpr);
        this.placeLinks(band, rects, width, height);
        band.section.setAttribute("data-placed", "");
        band.canvas.style.width = `${width}px`;
        band.canvas.style.height = `${height}px`;
        if (image) {
          paintImage(band.canvas, image);
          band.bakedKey = key;
          band.section.setAttribute("data-baked", "");
          this.bakes++;
        }
      }
    };
    const p = (this.baking ?? Promise.resolve()).then(run, run);
    this.baking = p;
    return p;
  }

  private placeLinks(band: Band, rects: BandRect[], width: number, height: number): void {
    // Links at least 44 × 44, never overlapping: grow each rect to the minimum about its centre, then push apart.
    const placed: { a: HTMLAnchorElement; l: number; t: number; w: number; h: number }[] = [];
    for (const r of rects) {
      const a = band.links.get(r.id);
      if (!a) continue;
      const w = Math.max(48, r.width);
      const hh = Math.max(48, r.height);
      const l = Math.min(width - w, Math.max(0, r.left + r.width / 2 - w / 2));
      const tp = Math.min(height - hh, Math.max(0, r.top + r.height / 2 - hh / 2));
      placed.push({ a, l, t: tp, w, h: hh });
    }
    placed.sort((x, y) => x.l - y.l);
    for (let i = 1; i < placed.length; i++) {
      const p = placed[i - 1]!;
      const c = placed[i]!;
      if (c.l < p.l + p.w) {
        const overlap = p.l + p.w - c.l;
        p.w = Math.max(44, p.w - overlap / 2);
        c.l = p.l + p.w;
        c.w = Math.max(44, c.w - overlap / 2);
      }
    }
    for (const p of placed) {
      p.a.style.left = `${Math.round(p.l)}px`;
      p.a.style.top = `${Math.round(p.t)}px`;
      p.a.style.width = `${Math.round(p.w)}px`;
      p.a.style.height = `${Math.round(p.h)}px`;
    }
  }

  /** The band showing the Bank (hero), for the zoom into the building. */
  heroLink(): HTMLAnchorElement | null {
    for (const band of this.bands) for (const [, a] of band.links) if (a.classList.contains("hero")) return a;
    return null;
  }
}
