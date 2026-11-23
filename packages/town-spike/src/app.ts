// The town app, designed for a phone held upright in one hand and expanded for wider screens (spec 00).
//
// Altitudes and routes (all under the /town/ base, ?as= and every other query parameter kept):
//   /  or /city              the landing: the whole town on one screen (compact); the plinth vista (expanded)
//   /city/b/:borough         a borough's high street of baked bands (compact); the vista framed on it plus the
//                            bands (expanded). /rewards is an alias of /city/b/rewards.
//   /points                  the Bank lobby (compact); lobby and Statement side by side (medium and wider)
//   /points/statement        the Statement room; ?focus=points-ledger also opens it
//   /points/transfer         the Transfer room; ?focus=points-transfer also opens it
//   anything else            a stub interior for that building, linking to Classic
//
// Rendering: the Base tier (every coarse pointer, and compact and medium containers) runs hybrid text: all text is
// the browser's own and the GPU draws the town, the baked band and diorama images, the backdrop and transitions.
// Enhanced (an expanded container with a fine pointer) paints text and surfaces on the GPU from the Plat, with the
// parity fallback (plat/parity.ts) handing any mismatching element back to visible DOM text. Any GPU failure after
// the probe ends in Plain mode on the same route with a notice (spec 03 section 3.3, 06 section 6.7.5).

import {
  coarsePointer,
  resolveBoot,
  storeMotion,
  watchForcedColors,
  type BootOptions,
  type Motion,
  type Tier,
} from "./engine/capability";
import type { Engine } from "./engine/renderer";
import type { QuadMesh, RenderTarget } from "./engine/three";
import type { CityPost } from "./engine/tiltshift";
import { h } from "./plat/dom";
import type { PlatPainter } from "./plat/painter";
import type { Parity } from "./plat/parity";
import {
  fetchAppearance,
  fetchMe,
  fetchPeople,
  fetchStatement,
  fetchSummary,
  type MemberCard,
  type PointsSummary,
} from "./interior/api";
import type { TownScene } from "./town/town-scene";
import type { Rect } from "./town/rect";
import type { Baker } from "./town/bake";
import { BOROUGHS, boroughById, buildingByRoute, type BoroughId } from "./town/boroughs";
import { Shell, type DirectoryEntry } from "./shell/shell";
import { LandingView } from "./views/landing";
import { StreetView } from "./views/street";
import { BankView, type RoomId } from "./views/bank";
import { StubView } from "./views/stub";
import type { AppData, GpuViews, ViewCtx } from "./views/types";
import * as rt from "./swap/rt";
import { principal } from "./swap/identity";
import {
  classicLink,
  effectiveExperience,
  getOverride,
  setOverride,
  toClassic,
  writeCachedSite,
  type Experience,
  type ExperienceOverride,
} from "./swap/experience";
import type { Camera, Scene } from "./engine/three";

export type ViewId = "landing" | "street" | "bank" | "stub";
export type LayoutClass = "compact" | "medium" | "expanded";

export interface RouteInfo {
  readonly view: ViewId;
  readonly path: string; // the route path under the base, e.g. "/points/statement"
  readonly borough: BoroughId | null;
  readonly room: RoomId | null;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, ""); // "/town"
/** The GPU chunk (three.js, the engine, the painter, the town), loaded after the Plain render with data. */
type Gpu = typeof import("./gpu");
const DEPTH: Record<ViewId, number> = { landing: 0, street: 1, bank: 2, stub: 2 };

/** Route path under the base for a pathname and query. */
export const parseRoute = (pathname: string, search: string): RouteInfo => {
  let rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  rest = `/${rest.replace(/^\/+|\/+$/g, "")}`;
  const focus = new URLSearchParams(search).get("focus");
  if (rest === "/" || rest === "/city") return { view: "landing", path: "/", borough: null, room: null };
  const street = /^\/city\/b\/([a-z]+)$/.exec(rest) ?? (rest === "/rewards" ? [rest, "rewards"] : null);
  if (street && boroughById(street[1]!))
    return { view: "street", path: rest, borough: street[1] as BoroughId, room: null };
  const district = /^\/city\/([a-z-]+)$/.exec(rest);
  if (district) {
    const b = BOROUGHS.find((x) => x.districts.some((d) => d.id === district[1]));
    if (b) return { view: "street", path: rest, borough: b.id, room: null };
  }
  if (rest === "/points") {
    const room: RoomId | null =
      focus === "points-ledger" ? "statement" : focus === "points-transfer" ? "transfer" : null;
    return { view: "bank", path: rest, borough: "rewards", room };
  }
  if (rest === "/points/statement")
    return { view: "bank", path: rest, borough: "rewards", room: "statement" };
  if (rest === "/points/transfer") return { view: "bank", path: rest, borough: "rewards", room: "transfer" };
  const hit = buildingByRoute(rest);
  return {
    view: "stub",
    path: rest,
    borough: hit && hit.borough.id !== "square" ? hit.borough.id : null,
    room: null,
  };
};

interface Transition {
  readonly from: ViewId;
  readonly to: ViewId;
  readonly kind: "zoom-in" | "zoom-out" | "fade";
  readonly duration: number;
  readonly reduced: boolean;
  readonly origin: Rect | null;
  readonly fromEl: HTMLElement | null;
  readonly toEl: HTMLElement;
  /** Untransformed boxes at the start, so transform origins are in each element's own coordinates. */
  readonly fromBox: Rect | null;
  readonly toBox: Rect;
  readonly zoomFrom: number;
  readonly zoomTo: number;
  elapsed: number;
  readonly done: () => void;
}

const ease = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};
const editable = (el: Element | null): boolean =>
  !!el &&
  (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable) &&
  !["checkbox", "radio", "button", "submit"].includes((el as HTMLInputElement).type);

export class App {
  readonly boot: BootOptions;
  engine: Engine | null = null;
  /** The GPU chunk, once loaded. */
  g: Gpu | null = null;
  private gpuViews: GpuViews | null = null;
  private painterLoading: Promise<void> | null = null;
  painter: PlatPainter | null = null;
  parity: Parity | null = null;
  town: TownScene | null = null;
  post: CityPost | null = null;
  baker: Baker | null = null;
  private backdropRT: RenderTarget | null = null;
  private backdropQuad: QuadMesh | null = null;
  private backdropPending = false;
  private backdropKey = "";

  readonly plat: HTMLElement;
  readonly main: HTMLElement;
  shell!: Shell;
  landing!: LandingView;
  bank!: BankView;
  stub!: StubView;
  readonly streets = new Map<BoroughId, StreetView>();
  private readonly politeRegion: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;

  readonly data: AppData = { me: null, lines: [], summary: null, people: [], handle: principal.handle };
  route: RouteInfo;
  view: ViewId = "landing";
  layoutClass: LayoutClass = "compact";
  short = false;
  widthRem = 24;
  tier: Tier = "base";
  textMode: "hybrid" | "gpu" | "plain" = "hybrid";
  motion: Motion;
  hand: "right" | "left" = "right";
  /** Landing camera zoom: 0 the whole town, 1 into the borough's tile, 2 deeper (a building). */
  zoom = { borough: null as BoroughId | null, level: 0 };
  transition: Transition | null = null;
  /** How long the last transition took, start to focus hand-off (ms, wall clock). */
  lastTransitionMs: number | null = null;
  private transitionStart = 0;
  private fade: {
    anims: Animation[];
    timer: number;
    finish: () => void;
    remaining: number;
    started: number;
  } | null = null;
  private pause: { at: number; resolve: () => void } | null = null;
  private paused = false;
  siteExperience: Experience | null = null;
  private stayHere = false;
  private composing = false;
  dirty = true;
  framesRendered = 0;
  private lastNow = 0;
  private frameHook: ((now: number) => void) | null = null;
  private frameWaiters: (() => void)[] = [];
  private lastSize = { w: 0, h: 0 };
  private scrollMemory = new Map<string, number>();
  private firstFrameDone = false;
  lastGpuMs: number | null = null;
  errors: string[] = [];
  notices: string[] = [];
  fontsOk = false;
  readonly ready: Promise<void>;
  private markReady!: () => void;

  constructor() {
    this.boot = resolveBoot();
    this.motion = this.boot.motion;
    this.ready = new Promise((r) => (this.markReady = r));
    try {
      this.hand = localStorage.getItem("plinth.town.hand") === "left" ? "left" : "right";
    } catch {
      this.hand = "right";
    }
    const root = document.documentElement;
    root.dataset["render"] = this.boot.mode;
    root.dataset["hand"] = this.hand;
    root.dataset["motion"] = this.motion;
    if (this.boot.debugOverlay) root.dataset["debug"] = "overlay";
    this.route = parseRoute(location.pathname, location.search);

    const skip = h("a", { class: "skip", href: "#main" }, "Skip to content");
    skip.addEventListener("click", (e) => {
      e.preventDefault();
      this.headingOf(this.view).focus();
    });
    this.politeRegion = h("div", { class: "sr-only", "aria-live": "polite", "aria-atomic": "true" });
    this.main = h("main", { id: "main" });
    this.plat = h("div", { id: "plat" });
    document.body.append(skip);
    if (this.boot.mode === "gpu") {
      this.canvas = h("canvas", { id: "scene", "aria-hidden": "true", role: "presentation", tabindex: -1 });
      document.body.append(this.canvas);
    }
    document.body.append(this.plat);
    watchForcedColors(() => location.reload());
  }

  // ---------------------------------------------------------------- the context views get

  private readonly ctx: ViewCtx = {
    data: this.data,
    navigate: (path, opts) =>
      this.navigate(path, { push: !opts?.replace, replace: !!opts?.replace, origin: opts?.origin ?? null }),
    back: (fallback) => this.back(fallback),
    href: (path) => this.href(path),
    announce: (m) => this.announce(m),
    markDirty: () => this.markDirty(),
    motion: () => this.motion,
    gpu: () => (this.engine && this.baker ? this.gpuViews : null),
  };

  /** A town URL for a route path, keeping ?as= and the other query parameters (UI-MAP 8.5 rule 5). */
  href(path: string): string {
    const q = new URLSearchParams(location.search);
    q.delete("focus");
    const s = q.toString();
    return `${BASE}${path === "/" ? "/" : path}${s ? `?${s}` : ""}`;
  }

  // ---------------------------------------------------------------- boot

  async start(siteExperience: Experience | null): Promise<void> {
    this.siteExperience = siteExperience;
    try {
      // The first paint needs the shell and the route's data only. The GPU chunk is requested after t1, so it never
      // competes with the data for a slow phone connection; the people directory loads after t1 too.
      const [st, summary, me] = await Promise.all([
        fetchStatement().catch((e: unknown) => {
          this.errors.push(`statement: ${e instanceof Error ? e.message : String(e)}`);
          return { lines: [], first: null };
        }),
        fetchSummary().catch(() => null as PointsSummary | null),
        fetchMe().catch(() => null),
      ]);
      this.data.lines = st.lines;
      this.data.summary = summary;
      this.data.me = me;
      this.buildPlat();
      this.measureLayout();
      this.applyTextMode();
      this.showRoute(this.route, null, false);
      // t1: the Plat with data, visible (the Plain render). The canvas comes after.
      performance.mark("town:t1");
      const gpuChunk = this.boot.mode === "gpu" ? import("./gpu") : null;
      void fetchPeople()
        .catch(() => [] as MemberCard[])
        .then((people) => {
          this.data.people = people;
          this.bank.transfer.setPeople(people);
        });
      if (gpuChunk) {
        try {
          this.g = await gpuChunk;
          await this.buildGpu();
        } catch (e) {
          this.fallBackToPlain(`init: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (this.engine) {
        this.layoutTown();
        this.afterShow();
      }
      this.installListeners();
      this.connectRealtime();
      if (this.engine) {
        void this.engine.renderer.setAnimationLoop((now: number) => this.tick(now));
        await this.nextFrame();
        if (this.engine) performance.mark("town:t3");
      }
      this.markReady();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.errors.push(msg);
      // Never show only an error: the Plat (or what exists of it) stays, in Plain mode, with a notice.
      this.fallBackToPlain(msg);
      if (!this.main.firstChild)
        this.main.append(
          h("p", { role: "alert", class: "load-error" }, `The town could not load its data: ${msg}`),
        );
      this.markReady();
    }
  }

  private buildPlat(): void {
    this.shell = new Shell({
      navigate: (p) => this.navigate(p, { push: true }),
      href: (p) => this.href(p),
      motion: () => this.motion,
      setMotion: (m) => this.setMotion(m),
      hand: () => this.hand,
      setHand: (v) => this.setHand(v),
      experience: () => getOverride(),
      chooseExperience: (c) => this.chooseExperience(c),
      classicHref: () => classicLink(),
      cityPressed: () => this.cityPressed(),
      directory: () => this.directory(),
      announce: (m) => this.announce(m),
    });
    this.landing = new LandingView(this.ctx, {
      orbit: (step) => this.orbit(step),
      resetCamera: () => {
        if (!this.town) return;
        this.town.heading = 0;
        this.town.applyVistaCamera();
        this.updatePlaques();
        this.markDirty();
      },
    });
    this.bank = new BankView(this.ctx, (balance) => {
      if (this.data.me) this.data.me = { ...this.data.me, balance };
      if (this.data.summary) this.data.summary = { ...this.data.summary, balance };
      this.refreshLive();
    });
    this.stub = new StubView(this.ctx);
    this.landing.root.setAttribute("data-away", "");
    this.landing.root.inert = true;
    this.bank.root.hidden = true;
    this.stub.root.hidden = true;
    this.main.append(this.landing.root, this.bank.root, this.stub.root);
    this.plat.append(
      this.shell.topbar,
      this.shell.updates,
      this.main,
      this.shell.bottombar,
      this.shell.sheetHost,
      this.politeRegion,
    );
    const me = this.data.me;
    this.shell.setMe({
      name: me?.member?.display_name ?? me?.principal.display_name ?? principal.handle,
      handle: me?.member?.handle ?? principal.handle,
      balance: me?.balance ?? this.data.summary?.balance ?? null,
      tier: me?.tier ? me.tier.tier : null,
      approver: !!me?.permissions.some((p) => p === "*" || p === "approval:decide" || p === "approval:*"),
    });
    this.shell.setCounts(me?.counts ?? {});
    if (this.boot.mode === "plain") this.showPlainNotice(this.boot.plainReason);
  }

  private street(id: BoroughId): StreetView {
    let s = this.streets.get(id);
    if (!s) {
      const def = boroughById(id)!;
      s = new StreetView(this.ctx, def, (opener) => this.openBoroughs(opener));
      s.root.hidden = true;
      this.main.insertBefore(s.root, this.bank.root);
      this.streets.set(id, s);
    }
    return s;
  }

  private async buildGpu(): Promise<void> {
    if (!this.canvas) return;
    if (this.boot.fail === "init") throw new Error("injected failure: init");
    const g = this.g;
    if (!g) throw new Error("the GPU chunk did not load");
    const engine = await g.Engine.create(this.canvas, this.boot.backend);
    this.engine = engine;
    engine.dprCap = this.textMode === "gpu" ? 8 : 2;
    engine.resize();
    const r = engine.renderer;
    r.setClearColor(g.PAPER, 1);
    this.town = new g.TownScene(this.data.lines);
    this.post = g.makeCityPost(r, this.town.scene, this.town.ortho);
    this.baker = new g.Baker(r, engine.isWebGPU);
    this.gpuViews = g.makeGpuViews((scene, camera, w, h2) => this.bake(scene, camera, w, h2));
    const { w, h: hh } = engine.cssSize();
    const dpr = engine.dpr;
    this.backdropRT = new g.RenderTarget(Math.round(w * dpr), Math.round(hh * dpr), { depthBuffer: false });
    this.backdropRT.texture.name = "interior-backdrop";
    this.backdropQuad = new g.QuadMesh(g.makeBlitMaterial(this.backdropRT.texture));
    if (this.boot.fail === "warmup") throw new Error("injected failure: warmup");
    // The text surface (the measurer's 2D canvas, OffscreenCanvas or a detached canvas) must exist on every tier.
    if (this.boot.fail === "text-surface") throw new Error("injected failure: text-surface");
    // Warm the town's pipelines before the first frame (spec 03 section 3.14).
    await r.compileAsync(this.town.scene, this.town.ortho);
    if (this.textMode === "gpu") await this.ensurePainter();
  }

  /** GPU text (Enhanced): the web fonts, the painter and the parity guard, all loaded only for this tier. */
  private async ensurePainter(): Promise<void> {
    if (this.painter || !this.engine || !this.g) return;
    if (this.boot.fail === "text-surface") throw new Error("injected failure: text-surface");
    if (!this.painterLoading) {
      this.painterLoading = (async () => {
        const fonts = await import("./text/font-faces");
        await fonts
          .loadFonts()
          .catch((e: unknown) => this.errors.push(`fonts: ${e instanceof Error ? e.message : String(e)}`));
        const g = this.g!;
        if (!this.engine) return;
        const { w, h: hh } = this.engine.cssSize();
        this.painter = new g.PlatPainter(w, hh);
        this.parity = new g.Parity(this.painter);
        this.fontsOk = g.fontsResolveInCanvas();
        this.layoutChanged();
      })();
    }
    await this.painterLoading;
  }

  /** Any GPU failure after the probe: stay on the route, in Plain mode, with the notice (no redirect). */
  fallBackToPlain(reason: string): void {
    if (reason) this.errors.push(`plain: ${reason}`);
    try {
      void this.engine?.renderer.setAnimationLoop(null);
    } catch {
      // the renderer may not have initialised
    }
    this.engine = null;
    this.painter = null;
    this.parity = null;
    this.baker = null;
    for (const el of this.plat.querySelectorAll(".dom-text")) el.classList.remove("dom-text");
    this.canvas?.remove();
    this.canvas = null;
    document.documentElement.dataset["render"] = "plain";
    this.textMode = "plain";
    document.documentElement.dataset["text"] = "hybrid";
    delete document.documentElement.dataset["k1"];
    if (this.shell) this.showPlainNotice("init-failed");
    for (const w of this.frameWaiters.splice(0)) w();
  }

  private showPlainNotice(reason: BootOptions["plainReason"]): void {
    if (reason === "param" || reason === "forced-colors" || reason === null) return;
    const msg = "Graphics could not start on this browser; showing the plain view.";
    this.notices.push(msg);
    const dismiss = h("button", { type: "button", class: "status-btn" }, "Dismiss");
    const el = h("div", { class: "status-item", role: "status" }, h("span", {}, msg), dismiss);
    dismiss.addEventListener("click", () => this.shell.hideStatus("plain"));
    this.shell.showStatus("plain", 2, el);
  }

  get mode(): "gpu" | "plain" {
    return this.engine ? "gpu" : "plain";
  }

  // ---------------------------------------------------------------- layout classes and text mode

  /** The shell's breakpoint from the container's width in rem (spec 00 section 0.3.1). */
  private measureLayout(): void {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const w = this.plat.clientWidth || document.documentElement.clientWidth;
    const hgt = document.documentElement.clientHeight;
    this.widthRem = w / rem;
    this.layoutClass = this.widthRem < 50 ? "compact" : this.widthRem < 64 ? "medium" : "expanded";
    this.short = hgt / rem < 30 && this.widthRem < 64;
    const root = document.documentElement;
    root.dataset["layout"] = this.layoutClass;
    root.toggleAttribute("data-short", this.short);
    root.toggleAttribute("data-side", this.layoutClass === "medium" && this.widthRem >= 52.5 && !this.short);
  }

  /** Base (hybrid text) or Enhanced (GPU text) from the pointer and the layout (spec 00 section 0.6.1). */
  private applyTextMode(): void {
    const root = document.documentElement;
    if (this.boot.mode === "plain" || this.textMode === "plain") {
      this.textMode = "plain";
      root.dataset["text"] = "hybrid";
      return;
    }
    const coarse = coarsePointer();
    this.tier = this.boot.tierParam ?? (coarse || this.layoutClass !== "expanded" ? "base" : "enhanced");
    const want: "hybrid" | "gpu" =
      this.boot.textParam === "gpu"
        ? "gpu"
        : this.boot.textParam === "dom"
          ? "hybrid"
          : this.tier === "enhanced" && !coarse
            ? "gpu"
            : "hybrid";
    const changed = want !== this.textMode;
    this.textMode = want;
    root.dataset["text"] = want;
    root.dataset["tier"] = this.tier;
    if (this.engine) {
      this.engine.dprCap = want === "gpu" ? 8 : 2;
      if (want === "gpu") void this.ensurePainter().catch((e: unknown) => this.fallBackToPlain(String(e)));
    }
    if (changed) {
      this.parity?.markFull();
      if (want === "hybrid") {
        this.painter?.empty();
        for (const el of this.plat.querySelectorAll(".dom-text")) el.classList.remove("dom-text");
      }
    }
    if (this.town) {
      this.town.setShadows(this.tier === "enhanced");
      if (this.post) this.post.u.bloomStrength.value = this.tier === "enhanced" ? 0.65 : 0;
    }
  }

  // ---------------------------------------------------------------- routing

  navigate(path: string, opts: { push?: boolean; replace?: boolean; origin?: Element | null } = {}): void {
    const url = this.href(path);
    const next = parseRoute(url.split("?")[0]!, url.includes("?") ? url.slice(url.indexOf("?")) : "");
    this.scrollMemory.set(location.pathname, window.scrollY);
    if (opts.replace) history.replaceState({ n: (history.state?.n as number | undefined) ?? 0 }, "", url);
    else if (opts.push !== false && `${location.pathname}${location.search}` !== url)
      history.pushState({ n: ((history.state?.n as number | undefined) ?? 0) + 1 }, "", url);
    this.showRoute(next, opts.origin ? rectOf(opts.origin) : null, true, opts.replace ? 0 : undefined);
  }

  /** Up one level: history back when the previous entry is ours, else the fallback route. */
  back(fallback: string): void {
    if (((history.state?.n as number | undefined) ?? 0) > 0) history.back();
    else this.navigate(fallback, { replace: true });
  }

  private onPopState(): void {
    if (this.shell.onPopState()) return;
    const next = parseRoute(location.pathname, location.search);
    this.showRoute(next, null, true, this.scrollMemory.get(location.pathname) ?? 0);
  }

  private cityPressed(): void {
    if (this.view === "landing" || this.view === "street")
      this.openBoroughs(this.shell.bottombar.querySelector('[data-slot="city"]'));
    else this.navigate("/", { push: true });
  }

  private openBoroughs(opener: HTMLElement | null): void {
    this.shell.renderBoroughs([
      { label: "The whole town", path: "/", current: this.view === "landing" },
      ...BOROUGHS.filter((b) => b.id !== "square").map((b) => ({
        label: b.name,
        path: `/city/b/${b.id}`,
        current: this.view === "street" && this.route.borough === b.id,
      })),
    ]);
    this.shell.open("boroughs", opener);
  }

  private directory(): DirectoryEntry[] {
    const out: DirectoryEntry[] = [
      { label: "Town", section: "City", path: "/", keywords: "landing home map" },
      { label: "Points · Bank", section: "Rewards", path: "/points", keywords: "balance lobby" },
      {
        label: "Statement",
        section: "Points · Bank",
        path: "/points/statement",
        keywords: "ledger lines history",
      },
      { label: "Transfer points", section: "Points · Bank", path: "/points/transfer", keywords: "send give" },
    ];
    for (const b of BOROUGHS) {
      if (b.id !== "square")
        out.push({ label: b.name, section: "Boroughs", path: `/city/b/${b.id}`, keywords: b.blurb });
      for (const d of b.districts)
        for (const bd of d.buildings)
          if (bd.route && bd.route !== "/points")
            out.push({ label: bd.name, section: b.name, path: bd.route });
    }
    return out;
  }

  private viewEl(v: ViewId, r: RouteInfo = this.route): HTMLElement {
    if (v === "landing") return this.landing.root;
    if (v === "street") return this.street(r.borough ?? "rewards").root;
    if (v === "bank") return this.bank.root;
    return this.stub.root;
  }

  headingOf(v: ViewId): HTMLElement {
    if (v === "landing") return this.landing.h1;
    if (v === "street") return this.street(this.route.borough ?? "rewards").h1;
    if (v === "bank") return this.bank.heading();
    return this.stub.h1;
  }

  /**
   * Show a route: prepare the incoming view, then run the spatial transition (zoom from the tile into the street,
   * from the street into the building; reduced motion is a crossfade, Off a cut) and move focus to its heading.
   */
  private showRoute(next: RouteInfo, origin: Rect | null, animate: boolean, restoreScroll?: number): void {
    const prev = this.route;
    const fromView = this.view;
    const fromEl = this.main.contains(this.viewEl(fromView, prev)) ? this.viewEl(fromView, prev) : null;
    this.route = next;
    this.view = next.view;
    if (this.shell.isOpen()) this.shell.close(false);
    this.finishTransitionNow();
    // Prepare the incoming view.
    const toEl = this.viewEl(next.view, next);
    if (next.view === "bank") this.bank.show(next.room);
    if (next.view === "stub") this.stub.show(next.path);
    const sameEl = toEl === fromEl;
    const zoomTo = next.view === "landing" ? 0 : next.view === "street" ? 1 : 2;
    const zoomFrom = this.zoom.level;
    this.zoom.borough = next.borough ?? (next.view === "landing" ? this.zoom.borough : "square");
    this.setTop(next);
    this.updateDocClasses();
    // Inside the Bank, opening or closing a room is the same view: animate only the part that arrives (the room
    // grows out of its card; the lobby comes back), the part that leaves is hidden at once.
    const roomChange =
      sameEl &&
      next.view === "bank" &&
      prev.view === "bank" &&
      prev.room !== next.room &&
      this.layoutClass === "compact";
    const depthChange = roomChange ? (next.room ? 1 : -1) : DEPTH[next.view] - DEPTH[fromView];
    const run = animate && this.motion !== "off" && ((!sameEl && fromEl) || roomChange);
    if (!run) {
      if (fromEl && !sameEl) this.hideView(fromView, fromEl);
      this.revealView(next.view, toEl);
      this.zoom.level = zoomTo;
      window.scrollTo(0, restoreScroll ?? 0);
      this.afterShow();
      if (animate) this.arrive();
      return;
    }
    const outEl = roomChange ? null : fromEl;
    const inEl = roomChange
      ? next.room === "statement"
        ? this.bank.statement.root
        : next.room === "transfer"
          ? this.bank.transfer.root
          : this.bank.lobby
      : toEl;
    // Freeze the outgoing view where it is, so resetting the document scroll does not move it.
    const fr = outEl ? outEl.getBoundingClientRect() : null;
    if (outEl && fr) {
      outEl.style.position = "fixed";
      outEl.style.top = `${fr.top}px`;
      outEl.style.left = `${fr.left}px`;
      outEl.style.width = `${fr.width}px`;
      outEl.style.zIndex = "2";
      outEl.inert = true;
    }
    this.revealView(next.view, toEl);
    window.scrollTo(0, restoreScroll ?? 0);
    const reduced = this.motion === "reduced";
    const kind = depthChange > 0 ? "zoom-in" : depthChange < 0 ? "zoom-out" : "fade";
    const tileOrigin =
      next.view === "street" && next.borough ? (this.town?.tileRects.get(next.borough) ?? null) : null;
    this.transition = {
      from: fromView,
      to: next.view,
      kind,
      reduced,
      duration: reduced ? 150 : roomChange ? 260 : 420,
      origin: origin ?? tileOrigin,
      fromEl: outEl,
      toEl: inEl,
      fromBox: fr ? { left: fr.left, top: fr.top, width: fr.width, height: fr.height } : null,
      toBox: rectOf(inEl),
      zoomFrom,
      zoomTo,
      elapsed: 0,
      done: () => {
        if (outEl && fromEl) this.hideView(fromView, fromEl);
        for (const el of outEl ? [outEl, inEl] : [inEl]) {
          el.style.removeProperty("position");
          el.style.removeProperty("top");
          el.style.removeProperty("left");
          el.style.removeProperty("width");
          el.style.removeProperty("z-index");
          el.style.removeProperty("opacity");
          el.style.removeProperty("transform");
          el.style.removeProperty("transform-origin");
        }
        this.zoom.level = zoomTo;
        document.documentElement.removeAttribute("data-transit");
        this.afterShow();
        this.arrive();
      },
    };
    document.documentElement.setAttribute("data-transit", "");
    this.transitionStart = performance.now();
    if (reduced) {
      this.crossfade();
      return;
    }
    this.stepTransition(0);
    this.driveTransition();
  }

  /**
   * Reduced motion: a 150 ms crossfade that does not depend on the render loop (spec 04 section 4.7). Two opacity
   * animations on the compositor (the outgoing view, frozen in place, over the incoming one), finished by a timer,
   * not by animation frames, so a slow GPU or software rasteriser cannot stretch it. The camera cuts.
   */
  private crossfade(): void {
    const tr = this.transition!;
    this.zoom.level = tr.zoomTo;
    const opts: KeyframeAnimationOptions = { duration: tr.duration, easing: "linear", fill: "both" };
    const anims: Animation[] = [];
    try {
      anims.push(tr.toEl.animate([{ opacity: 0 }, { opacity: 1 }], opts));
      if (tr.fromEl) anims.push(tr.fromEl.animate([{ opacity: 1 }, { opacity: 0 }], opts));
    } catch {
      // no Web Animations: the timer still finishes the transition (a cut)
    }
    const finish = () => {
      if (this.transition !== tr) return;
      this.endCrossfade();
      this.transition = null;
      this.lastTransitionMs = performance.now() - this.transitionStart;
      tr.done();
      this.markDirty();
    };
    this.fade = { anims, timer: 0, finish, remaining: tr.duration, started: performance.now() };
    if (this.pause) {
      // Harness: hold at the requested progress.
      for (const a of anims) {
        a.pause();
        a.currentTime = this.pause.at * tr.duration;
      }
      this.fade.remaining = (1 - this.pause.at) * tr.duration;
      this.paused = true;
      tr.elapsed = this.pause.at * tr.duration;
      queueMicrotask(this.pause.resolve);
      this.markDirty();
      return;
    }
    this.fade.timer = window.setTimeout(finish, tr.duration);
    this.markDirty();
  }

  private endCrossfade(): void {
    const f = this.fade;
    if (!f) return;
    clearTimeout(f.timer);
    for (const a of f.anims) a.cancel();
    this.fade = null;
  }

  private revealView(v: ViewId, el: HTMLElement): void {
    if (v === "landing") {
      el.removeAttribute("data-away");
      el.inert = false;
    } else el.hidden = false;
    el.setAttribute("data-current", "");
  }

  private hideView(v: ViewId, el: HTMLElement): void {
    el.removeAttribute("data-current");
    el.inert = false;
    if (v === "landing") {
      // The landing stays laid out (fixed, invisible, inert) so its tile rects drive the canvas everywhere.
      const keep = this.view === "street" && document.documentElement.hasAttribute("data-side");
      if (!keep) {
        el.setAttribute("data-away", "");
        el.inert = true;
      }
    } else if (el !== this.viewEl(this.view)) el.hidden = true;
    if (el === this.bank.root && this.view !== "bank") this.bank.statement.unmount();
  }

  /** Focus the new view's heading and announce it (spec C9: focus on the heading, the Plat live). */
  private arrive(): void {
    const h1 = this.headingOf(this.view);
    h1.focus({ preventScroll: true });
    this.announce(h1.textContent ?? "");
  }

  private finishTransitionNow(): void {
    const tr = this.transition;
    if (!tr) return;
    this.endCrossfade();
    this.transition = null;
    this.pause = null;
    this.paused = false;
    tr.done();
  }

  private driveTransition(): void {
    let last = performance.now();
    const step = (now: number) => {
      const tr = this.transition;
      if (!tr) return;
      // Wall-clock time: a slow or throttled rAF must not stretch a 150 ms crossfade (WebKit ran it for 1.5 s).
      if (!this.paused) tr.elapsed = Math.min(tr.duration, tr.elapsed + Math.max(0, now - last));
      last = now;
      let s = tr.elapsed / tr.duration;
      if (this.pause && s >= this.pause.at) {
        s = this.pause.at;
        tr.elapsed = s * tr.duration;
        if (!this.paused) {
          this.paused = true;
          queueMicrotask(this.pause.resolve);
        }
      }
      this.stepTransition(s);
      if (!this.paused && tr.elapsed >= tr.duration) {
        this.transition = null;
        this.lastTransitionMs = performance.now() - this.transitionStart;
        tr.done();
        this.markDirty();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Apply the transition at progress s (0..1) to the DOM and the canvas zoom. */
  private stepTransition(s: number): void {
    const tr = this.transition;
    if (!tr) return;
    const out = tr.fromEl;
    const inn = tr.toEl;
    if (tr.reduced || tr.kind === "fade") {
      if (out) out.style.opacity = String(1 - ease(s));
      inn.style.opacity = String(ease(s));
      this.zoom.level = s < 0.5 ? tr.zoomFrom : tr.zoomTo; // the camera cuts
    } else {
      const o = tr.origin;
      const ox = o ? o.left + o.width / 2 : window.innerWidth / 2;
      const oy = o ? o.top + o.height / 2 : window.innerHeight / 2;
      const a = ease(Math.min(1, s / 0.6));
      const b = ease(Math.max(0, (s - 0.35) / 0.65));
      const fb = tr.fromBox ?? { left: 0, top: 0, width: 0, height: 0 };
      const tb = tr.toBox;
      if (tr.kind === "zoom-in") {
        if (out) {
          out.style.transformOrigin = `${ox - fb.left}px ${oy - fb.top}px`;
          out.style.transform = `scale(${lerp(1, 2.2, a)})`;
          out.style.opacity = String(1 - a);
        }
        inn.style.transformOrigin = `${ox - tb.left}px ${oy - tb.top}px`;
        inn.style.transform = `scale(${lerp(0.6, 1, b)})`;
        inn.style.opacity = String(b);
      } else {
        if (out) {
          out.style.transformOrigin = "50% 40%";
          out.style.transform = `scale(${lerp(1, 0.6, a)})`;
          out.style.opacity = String(1 - a);
        }
        inn.style.transformOrigin = o ? `${ox - tb.left}px ${oy - tb.top}px` : "50% 40%";
        inn.style.transform = `scale(${lerp(1.6, 1, b)})`;
        inn.style.opacity = String(b);
      }
      this.zoom.level = lerp(tr.zoomFrom, tr.zoomTo, ease(s));
    }
    this.markDirty();
  }

  /** Harness: run the next transition and hold at progress `at`. */
  pauseAt(at: number): Promise<void> {
    return new Promise((resolve) => (this.pause = { at, resolve }));
  }

  resume(): void {
    this.pause = null;
    this.paused = false;
    const f = this.fade;
    if (f && this.transition) {
      for (const a of f.anims) a.play();
      f.timer = window.setTimeout(f.finish, f.remaining);
    }
  }

  private setTop(r: RouteInfo): void {
    const b = r.borough ? boroughById(r.borough) : null;
    if (r.view === "landing") this.shell.setTop({ title: "Northwind", crumb: "Town", up: null });
    else if (r.view === "street")
      this.shell.setTop({ title: b?.name ?? "Street", crumb: "Town", up: { path: "/", label: "the town" } });
    else if (r.view === "bank") {
      if (r.room === "statement")
        this.shell.setTop({
          title: `Statement · ${this.data.lines.length} lines`,
          crumb: "Points · Bank",
          up: { path: "/points", label: "the Bank lobby" },
        });
      else if (r.room === "transfer")
        this.shell.setTop({
          title: "Transfer points",
          crumb: "Points · Bank",
          up: { path: "/points", label: "the Bank lobby" },
        });
      else
        this.shell.setTop({
          title: "Points · Bank",
          crumb: "Rewards",
          up: { path: "/city/b/rewards", label: "Rewards" },
        });
    } else {
      const hit = buildingByRoute(r.path);
      this.shell.setTop({
        title: hit?.building.name ?? r.path,
        crumb: b?.name ?? "Town",
        up: b ? { path: `/city/b/${b.id}`, label: b.name } : { path: "/", label: "the town" },
      });
    }
  }

  private updateDocClasses(): void {
    const root = document.documentElement;
    root.dataset["view"] = this.view;
    root.dataset["room"] = this.view === "bank" ? (this.route.room ?? "none") : "none";
  }

  /** Work that follows a view becoming current: bakes, layout of the town, the backdrop. */
  private afterShow(): void {
    // From 52.5 rem at medium the landing stays beside a street (spec 01 section 1.4.4).
    const side = this.view === "street" && document.documentElement.hasAttribute("data-side");
    if (this.view !== "landing") {
      this.landing.root.toggleAttribute("data-away", !side);
      this.landing.root.inert = !side;
    }
    if (this.view === "street" && this.route.borough) {
      const s = this.street(this.route.borough);
      void s.layout().then(() => this.markDirty());
      if (this.route.path.startsWith("/city/") && !this.route.path.startsWith("/city/b/")) {
        const band = s.root.querySelector(`[data-district="${this.route.path.slice(6)}"]`);
        band?.scrollIntoView({ block: "start" });
      }
    }
    if (this.view === "bank") {
      this.bank.statement.mount();
      void this.bank.statement.bakeRibbon(); // the collapsed band shows a still frame of the flow
    }
    if (this.town?.layout === "vista") {
      this.town.framed = this.view === "street" ? this.route.borough : null;
      this.town.applyVistaCamera();
      this.updatePlaques();
    }
    this.backdropPending = true;
    this.markDirty();
  }

  // ---------------------------------------------------------------- the town's layout

  /** Landing (compact and medium) or plinth vista (expanded), from the same scene graph. */
  layoutTown(): void {
    const town = this.town;
    const engine = this.engine;
    if (!town || !engine) return;
    const { w, h: hh } = engine.cssSize();
    if (this.layoutClass === "expanded") {
      town.layoutVista(w / hh);
      town.framed = this.view === "street" ? this.route.borough : null;
      town.applyVistaCamera();
      this.post?.setCamera(town.persp);
      this.updatePlaques();
    } else {
      this.landing.clearPlaques();
      const { tiles, plinth } = this.landing.tileRects();
      town.layoutLanding(tiles, plinth, w, hh);
      this.post?.setCamera(town.ortho);
    }
    this.backdropPending = true;
    this.markDirty();
  }

  private updatePlaques(): void {
    const town = this.town;
    const engine = this.engine;
    if (!town || !engine || town.layout !== "vista") return;
    const { w, h: hh } = engine.cssSize();
    this.landing.placePlaques((id) => town.plaqueAnchor(id, w, hh));
  }

  private orbit(step: -1 | 1): void {
    if (!this.town) return;
    this.town.heading = (Math.round(this.town.heading) + step + 8) % 8;
    this.town.applyVistaCamera();
    this.updatePlaques();
    this.markDirty();
  }

  // ---------------------------------------------------------------- baking

  bake(scene: Scene, camera: Camera, w: number, h2: number): Promise<ImageData | null> {
    if (!this.baker || !this.engine) return Promise.resolve(null);
    const p = this.baker.bake(scene, camera, w, h2);
    this.markDirty();
    return p;
  }

  // ---------------------------------------------------------------- listeners, live data, swap

  private installListeners(): void {
    window.addEventListener("popstate", () => this.onPopState());
    history.replaceState(
      { ...(history.state ?? {}), n: (history.state?.n as number | undefined) ?? 0 },
      "",
      location.href,
    );
    window.addEventListener("resize", () => this.onResize());
    window.visualViewport?.addEventListener("resize", () => this.onViewport());
    window.visualViewport?.addEventListener("scroll", () => this.onViewport());
    window.addEventListener("orientationchange", () => this.onResize());
    document.fonts?.addEventListener?.("loadingdone", () => this.layoutChanged());
    const mo = new MutationObserver(() => {
      if (this.textMode === "gpu") this.markDirty();
    });
    mo.observe(this.plat, { subtree: true, childList: true, characterData: true, attributes: true });
    // Scrolling repaints only when the GPU paints text that scrolls (Enhanced); with hybrid text nothing on the
    // canvas follows the scroll, so a street fling draws no canvas frame (spec 01 section 1.4.3, C11).
    document.addEventListener(
      "scroll",
      () => {
        if (this.textMode === "gpu") this.markDirty();
      },
      { capture: true, passive: true },
    );
    for (const ev of ["focusin", "focusout", "input", "selectionchange"])
      document.addEventListener(ev, () => {
        if (this.textMode === "gpu") this.markDirty();
      });
    document.addEventListener("focusin", (e) => this.onFocusIn(e));
    document.addEventListener("focusout", () => setTimeout(() => this.onFocusOut(), 0));
    document.addEventListener("compositionstart", () => (this.composing = true));
    document.addEventListener("compositionend", () => (this.composing = false));
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented || this.shell.isOpen()) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && editable(tgt) && (tgt as HTMLInputElement).value) return; // let the field clear first
      if (this.view === "bank" && this.route.room) this.back("/points");
      else if (this.view === "bank" || this.view === "stub")
        this.back(this.route.borough ? `/city/b/${this.route.borough}` : "/");
      else if (this.view === "street") this.back("/");
      else return;
      e.preventDefault();
    });
    // Drag to orbit the vista: only at the expanded breakpoint with a fine pointer (spec 00 section 0.5).
    let drag: { x: number; heading: number } | null = null;
    this.landing.root.addEventListener("pointerdown", (e) => {
      if (
        this.town?.layout !== "vista" ||
        e.pointerType !== "mouse" ||
        (e.target as HTMLElement).closest("a,button")
      )
        return;
      drag = { x: e.clientX, heading: this.town.heading };
      this.landing.root.setPointerCapture(e.pointerId);
    });
    this.landing.root.addEventListener("pointermove", (e) => {
      if (!drag || !this.town) return;
      this.town.heading = (((drag.heading + (e.clientX - drag.x) / 120) % 8) + 8) % 8;
      this.town.applyVistaCamera();
      this.updatePlaques();
      this.markDirty();
    });
    this.landing.root.addEventListener("pointerup", () => {
      if (!drag || !this.town) return;
      drag = null;
      this.town.heading = Math.round(this.town.heading) % 8;
      this.town.applyVistaCamera();
      this.updatePlaques();
      this.markDirty();
    });
    // The landing's tiles move when the status layer or the text size changes: re-lay the scene under them.
    if (typeof ResizeObserver !== "undefined") {
      let last = "";
      new ResizeObserver(() => {
        const r = this.landing.plinth.getBoundingClientRect();
        const key = `${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)}`;
        if (key === last) return;
        last = key;
        if (this.town?.layout === "landing") this.layoutTown();
      }).observe(this.landing.plinth);
    }
    this.lastSize = { w: window.innerWidth, h: window.innerHeight };
  }

  /** The on-screen keyboard (spec 00 section 0.4.5): editable focused at compact or short width. */
  private onFocusIn(e: FocusEvent): void {
    if (this.layoutClass === "expanded" && !this.short) return;
    if (editable(e.target as Element)) {
      document.documentElement.setAttribute("data-kb", "open");
      this.onViewport();
    }
  }

  private onFocusOut(): void {
    if (editable(document.activeElement)) return;
    document.documentElement.removeAttribute("data-kb");
    document.documentElement.style.setProperty("--kb", "0px");
  }

  private onViewport(): void {
    const vv = window.visualViewport;
    if (!vv) return;
    document.documentElement.style.setProperty("--vvh", `${vv.height / 100}px`);
    if (document.documentElement.hasAttribute("data-kb")) {
      const kb = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      document.documentElement.style.setProperty("--kb", `${Math.round(kb)}px`);
    }
  }

  /**
   * Viewport resizes. A toolbar resize (width unchanged, height within 140 px, nothing editable focused) changes
   * nothing: no epoch, no read batch, no target reallocation (spec 00 section 0.2.1). Anything else is a reflow.
   */
  private onResize(): void {
    const w = window.innerWidth;
    const hh = window.innerHeight;
    const dh = Math.abs(hh - this.lastSize.h);
    const toolbar = w === this.lastSize.w && dh <= 140 && dh > 0 && !editable(document.activeElement);
    this.lastSize = { w, h: hh };
    this.onViewport();
    if (toolbar) return;
    this.layoutChanged();
  }

  /** A reflow: breakpoints, text mode, canvas size, the town's layout and the street's bakes are re-decided. */
  layoutChanged(): void {
    const before = this.layoutClass;
    this.measureLayout();
    this.applyTextMode();
    if (this.engine) {
      const changed = this.engine.resize();
      const { w, h: hh } = this.engine.cssSize();
      this.painter?.resize(w, hh);
      if (changed && this.backdropRT) {
        const dpr = this.engine.dpr;
        this.backdropRT.setSize(Math.round(w * dpr), Math.round(hh * dpr));
      }
      this.layoutTown();
    }
    if (before !== this.layoutClass) this.updateDocClasses();
    this.afterShow();
    this.parity?.markFull();
    this.backdropPending = true;
    this.markDirty();
  }

  private connectRealtime(): void {
    rt.connect();
    rt.onCounts((counts) => {
      if (this.data.me) this.data.me = { ...this.data.me, counts: { ...this.data.me.counts, ...counts } };
      this.shell.setCounts(this.data.me?.counts ?? counts);
      this.refreshLive();
    });
    rt.on("points.posted", (ev) => {
      const p = ev.payload as { member?: string; balance?: number };
      if (p.member !== this.data.handle || typeof p.balance !== "number") return;
      if (this.data.me) this.data.me = { ...this.data.me, balance: p.balance };
      this.shell.setBalance(p.balance);
      this.refreshLive();
    });
    rt.onState((s, info) => {
      if (s === "offline" && !info["revoked"]) {
        const retry = h("button", { type: "button", class: "status-btn" }, "Retry now");
        retry.addEventListener("click", () => rt.retryNow());
        this.shell.showStatus(
          "offline",
          2,
          h("div", { class: "status-item", role: "status" }, h("span", {}, "Offline · retrying"), retry),
        );
      } else this.shell.hideStatus("offline");
    });
    // The live swap (UI-MAP 8.5 rule 3): a Program change re-reads the site default.
    let timer = 0;
    rt.onChange(
      (c) => String(c.node ?? "").includes("/Program/"),
      () => {
        clearTimeout(timer);
        timer = window.setTimeout(() => void this.onProgramChange(), 150);
      },
    );
  }

  async onProgramChange(): Promise<void> {
    let site: Experience;
    try {
      const a = await fetchAppearance();
      site = a.experience === "town" ? "town" : "classic";
    } catch {
      return;
    }
    const previous = this.siteExperience;
    this.siteExperience = site;
    writeCachedSite(site);
    if (previous === site || getOverride() !== "site" || site !== "classic" || this.stayHere) return;
    this.swapToClassic(true);
  }

  /** Go to Classic. Live swaps wait behind a banner while work is unsaved, a sheet is open or IME is composing. */
  swapToClassic(live: boolean): void {
    const busy = this.bank.transfer.dirty || this.shell.isOpen() || this.composing;
    if (live && busy) {
      const now = h("button", { type: "button", class: "status-btn" }, "Switch now");
      const stay = h("button", { type: "button", class: "status-btn" }, "Stay here");
      now.addEventListener("click", () => this.swapToClassic(false));
      stay.addEventListener("click", () => {
        this.stayHere = true;
        this.shell.hideStatus("swap");
      });
      this.shell.showStatus(
        "swap",
        1,
        h(
          "div",
          { class: "status-item", role: "status" },
          h("span", {}, "The site switched to Classic."),
          now,
          stay,
        ),
      );
      this.announce("The site switched to Classic. Switch now or stay here.");
      return;
    }
    const go = () => location.replace(toClassic());
    if (this.motion === "off") go();
    else {
      this.plat.style.transition = `opacity ${this.motion === "full" ? 220 : 120}ms`;
      this.plat.style.opacity = "0";
      setTimeout(go, this.motion === "full" ? 230 : 130);
    }
  }

  /** The You sheet's toggle (UI-MAP 8.5 rule 2): writes the override and, when the result is Classic, goes there. */
  chooseExperience(choice: ExperienceOverride): void {
    setOverride(choice);
    const eff = effectiveExperience(choice, this.siteExperience);
    if (eff === "classic") {
      this.shell.close(false);
      location.assign(toClassic());
    } else this.announce(choice === "site" ? "Following the site default: 3D view." : "3D view chosen.");
  }

  private refreshLive(): void {
    this.landing.update();
    for (const s of this.streets.values()) s.update();
    this.bank.update();
    this.markDirty();
  }

  setMotion(m: Motion): void {
    this.motion = m;
    storeMotion(m);
    document.documentElement.dataset["motion"] = m;
    this.shell.setMotion(m);
    this.markDirty();
  }

  setHand(v: "right" | "left"): void {
    this.hand = v;
    document.documentElement.dataset["hand"] = v;
    try {
      localStorage.setItem("plinth.town.hand", v);
    } catch {
      // the choice lasts for this page view
    }
  }

  markDirty(): void {
    this.dirty = true;
  }

  announce(msg: string): void {
    this.politeRegion.textContent = "";
    setTimeout(() => (this.politeRegion.textContent = msg), 60);
  }

  // ---------------------------------------------------------------- frames

  /** Whether the canvas has autonomous motion right now (only flows under Full motion in the town). */
  private animating(): boolean {
    return (
      !!this.transition ||
      (this.motion === "full" &&
        (this.view === "landing" || (this.view === "street" && this.town?.layout === "vista")))
    );
  }

  private tick(now: number): void {
    if (this.frameHook) {
      this.frameHook(now);
      return;
    }
    let baked = false;
    try {
      baked = this.g && this.baker ? this.baker.step(this.g.BAND_PAPER) : false;
      if (this.animating() || this.dirty || baked) this.renderFrame(now);
    } catch (e) {
      // A GPU failure mid-session: Plain mode on the same route, never stale pixels or an error screen.
      this.fallBackToPlain(`render: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (this.engine?.timestamps && this.dirty === false) {
      void this.engine.renderer.resolveTimestampsAsync("render").then((ms) => {
        if (typeof ms === "number") this.lastGpuMs = ms;
      });
    }
  }

  nextFrame(): Promise<void> {
    if (!this.engine) return new Promise((r) => requestAnimationFrame(() => r()));
    this.dirty = true;
    return new Promise((r) => this.frameWaiters.push(r));
  }

  /** Is the canvas showing the live town (landing or vista), or the cached backdrop behind an interior? */
  private liveTown(): boolean {
    if (this.transition && this.town?.layout === "landing") return true;
    if (this.view === "landing") return true;
    if (this.town?.layout === "vista" && this.view === "street") return true;
    return this.view === "street" && document.documentElement.hasAttribute("data-side");
  }

  /** Render one frame of whatever is current. Returns the CPU time spent, in ms. */
  renderFrame(now: number): number {
    const t0 = performance.now();
    this.lastNow = now;
    if (!this.engine || !this.town || !this.post) return 0;
    if (this.boot.fail === "first-frame" && !this.firstFrameDone)
      throw new Error("injected failure: first-frame");
    const town = this.town;
    const post = this.post;
    town.flows.time.value = this.motion === "full" ? now / 1000 : 4.2; // Reduced and Off: a still frame
    if (this.liveTown()) {
      this.applyTownCamera(this.zoom.level);
      post.pipeline.render();
    } else {
      const key = `${this.zoom.borough}|${this.zoom.level}|${town.layout}|${town.heading}`;
      if (this.backdropPending || key !== this.backdropKey) {
        this.renderBackdrop();
        this.backdropKey = key;
        this.backdropPending = false;
      }
      this.backdropQuad!.render(this.engine.renderer);
    }
    if (this.textMode === "gpu" && this.painter) this.overlay(this.viewRoots());
    this.dirty = false;
    this.firstFrameDone = true;
    this.framesRendered++;
    for (const w of this.frameWaiters.splice(0)) w();
    return performance.now() - t0;
  }

  /** The landing camera at a zoom level (0 whole town, 1 the tile, 2 deeper) and the matching backdrop blur. */
  private applyTownCamera(level: number): void {
    const town = this.town!;
    const post = this.post!;
    if (town.layout === "vista") {
      post.setCamera(town.persp);
      const target = town.framed
        ? town.blocks.get(town.framed)!.pivot.position
        : new this.g!.Vector3(0, 0, 4);
      post.u.focusY.value = 0.52;
      post.u.focusZ.value = -town.persp.position.distanceTo(target);
      post.u.bandHalf.value = 0.14;
      post.u.depthMix.value = 0.6;
      post.u.backdrop.value = this.view === "landing" || this.view === "street" ? 0 : 1;
      return;
    }
    const { w, h: hh } = this.engine!.cssSize();
    const full: Rect = { left: 0, top: 0, width: w, height: hh };
    const b = this.zoom.borough ?? "rewards";
    const r1 = town.zoomRectFor(b, 1) ?? full;
    const r2 = town.zoomRectFor(b, 2) ?? r1;
    const mix = (a: Rect, c: Rect, t: number): Rect => ({
      left: lerp(a.left, c.left, t),
      top: lerp(a.top, c.top, t),
      width: lerp(a.width, c.width, t),
      height: lerp(a.height, c.height, t),
    });
    const view = level <= 1 ? mix(full, r1, ease(level)) : mix(r1, r2, ease(level - 1));
    town.setLandingCamera(view);
    post.setCamera(town.ortho);
    post.u.depthMix.value = 0; // view depth from an orthographic camera is not a perspective depth
    post.u.focusY.value = 0.5;
    post.u.bandHalf.value = 0.3;
    post.u.falloff.value = 0.35;
    post.u.backdrop.value = Math.min(1, level);
  }

  private renderBackdrop(): void {
    const r = this.engine!.renderer;
    const post = this.post!;
    this.applyTownCamera(Math.max(1, this.zoom.level));
    if (this.town?.layout === "vista") post.u.backdrop.value = 1;
    post.u.largeRadius.value = 6;
    r.setRenderTarget(this.backdropRT);
    post.pipeline.render();
    r.setRenderTarget(null);
    post.u.largeRadius.value = 2.6;
  }

  /** The Plat roots the GPU paints (Enhanced): the bars and the current view. */
  viewRoots(): Element[] {
    if (this.transition) return [this.shell.topbar, this.shell.bottombar];
    return [this.shell.topbar, this.shell.bottombar, this.viewEl(this.view)];
  }

  private overlay(roots: Element[]): void {
    const r = this.engine!.renderer;
    const p = this.painter!;
    const par = this.parity;
    const sc = this.engine!.paintScale;
    const { w, h: hh } = this.engine!.cssSize();
    par?.begin();
    p.paint(roots, w, hh, sc.x, true, sc.y);
    // Hand back to the DOM any leaf that does not match, then paint again so no frame shows both copies.
    if (par?.check()) p.paint(roots, w, hh, sc.x, true, sc.y);
    r.autoClear = false;
    r.render(p.scene, p.camera);
    r.autoClear = true;
  }

  // ---------------------------------------------------------------- measurement support

  /**
   * Render n frames for the harness, each in its own animation-loop frame. `scroll` moves the document (lists and
   * streets at compact) or the table's own scroller by 24 px per frame. Returns rAF deltas and CPU time per frame,
   * and GPU timestamps where the backend has them.
   */
  async measure(
    n: number,
    opts: { scroll?: "window" | "table" } = {},
  ): Promise<{ cpu: number[]; raf: number[]; gpu: number[]; frame: number[] }> {
    const cpu: number[] = [];
    const raf: number[] = [];
    const gpu: number[] = [];
    const frame: number[] = [];
    const engine = this.engine;
    if (!engine) return { cpu, raf, gpu, frame };
    const r = engine.renderer;
    const scroll = () => {
      if (opts.scroll === "window") {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, window.scrollY + 24 > max ? 0 : window.scrollY + 24);
      } else if (opts.scroll === "table") {
        const sc = this.bank.statement.scroller;
        const max = sc.scrollHeight - sc.clientHeight;
        sc.scrollTop = sc.scrollTop + 24 > max ? 0 : sc.scrollTop + 24;
      }
      if (opts.scroll) this.dirty = this.textMode === "gpu";
    };
    try {
      if (engine.timestamps) await r.resolveTimestampsAsync("render");
      await new Promise<void>((resolve) => {
        let i = 0;
        let last = 0;
        this.frameHook = (t) => {
          if (last) raf.push(t - last);
          last = t;
          const c0 = performance.now();
          scroll();
          // A frame is drawn only when something changed or moves, as in the real loop; the CPU cost of a frame
          // that draws nothing is the scroll handling itself.
          if (this.animating() || this.dirty || !opts.scroll) this.renderFrame(t);
          cpu.push(performance.now() - c0);
          if (engine.timestamps) void r.resolveTimestampsAsync("render");
          if (++i >= n) {
            this.frameHook = null;
            resolve();
          }
        };
      });
      // GPU timestamps per frame: for a static view, and for a scroll whose frames the GPU really draws (GPU text).
      // A hybrid-text scroll draws no canvas frame, so there is nothing to time on the GPU.
      if (engine.timestamps && (!opts.scroll || this.textMode === "gpu")) {
        await r.resolveTimestampsAsync("render");
        await new Promise<void>((resolve) => {
          let i = 0;
          let waiting = false;
          this.frameHook = (t) => {
            if (waiting) return;
            scroll();
            const c = this.renderFrame(t);
            waiting = true;
            void r.resolveTimestampsAsync("render").then((ms) => {
              if (typeof ms === "number" && ms > 0) {
                gpu.push(ms);
                frame.push(Math.max(ms, c));
              }
              waiting = false;
              if (++i >= n) {
                this.frameHook = null;
                resolve();
              }
            });
          };
        });
      }
    } finally {
      this.frameHook = null;
    }
    return { cpu, raf, gpu, frame };
  }
}
