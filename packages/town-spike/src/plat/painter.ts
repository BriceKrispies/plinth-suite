// The Plat painter: READ the Plat (rects, clip, focus), BUILD instances (surfaces, raster runs, SDF glyphs), then
// UPLOAD (township.md R9.4). The same painter draws the city HUD and plaques after post, the live interior and the
// pane cards for the Enter transition, so cards and live panes come from one code path (S.3 hand-off).

import { Mesh, Scene, type OrthographicCamera } from "../engine/three";
import { makeGlyphMaterial, makeSurfaceMaterial, type LayerUniforms } from "../engine/layers";
import { QuadInstances, makeCssCamera, resizeCssCamera } from "../engine/quads";
import { Measurer, graphemes } from "../text/breaker";
import { layoutLeaf, styleOf } from "../text/layout";
import { RunAtlas } from "../text/run-atlas";
import { SDF_BUFFER, SDF_CUTOFF, SDF_EM, SDF_RADIUS, SdfAtlas } from "../text/sdf-atlas";
import { FIELD_FOCUS_BORDER, SURFACES, paintKinds, surfaceOf, toneOf } from "./registry";

/** Device-pixel size below which text takes the raster-run path (R3.1: "below 15 device px"). */
export const RASTER_BELOW_DEVICE_PX = 15;

export type GlyphPath = "raster" | "sdf";

/** One painted line of one text leaf: what the GPU drew, in viewport CSS px. */
export interface PaintedRun {
  readonly el: Element;
  readonly node: Text;
  readonly line: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly path: GlyphPath;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** One painted text leaf with our line starts, for line-break parity. */
export interface PaintedLeaf {
  readonly el: Element;
  readonly node: Text;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
  /** The leaf's border box size when painted: parity re-checks a leaf only when this or its text changes. */
  readonly w: number;
  readonly h: number;
  /** text-overflow: ellipsis or a line clamp: not paintable, handed back to the DOM. */
  readonly truncates: boolean;
  /** Lines of this leaf (the browser's line count must match). */
  readonly lines: number;
  /** Lines inside the clip chain, which must each have a painted run. */
  readonly visibleLines: number;
}

export interface PaintStats {
  frame: number;
  elements: number;
  surfaces: number;
  runs: number;
  glyphs: number;
  truncated: number;
  readBuildMs: number;
  runAtlasEntries: number;
  sdfAtlasEntries: number;
  atlasUploads: number;
  atlasUploadBytes: number;
  /** Elements left to DOM text by rule this frame (truncated by the browser), not counted as fallbacks. */
  domByRule: number;
}

type SurfaceAttr = "aRect" | "aFill" | "aBorder" | "aParam" | "aClip";
type GlyphAttr = "aRect" | "aUV" | "aColor" | "aClip" | "aSoft";

type Box = [number, number, number, number]; // x0, y0, x1, y1

export class PlatPainter {
  readonly scene = new Scene();
  readonly camera: OrthographicCamera;
  readonly measurer = new Measurer();
  readonly runAtlas = new RunAtlas(2048);
  readonly sdfAtlas = new SdfAtlas(2048);
  private readonly surfaces = new QuadInstances<SurfaceAttr>(
    { aRect: 4, aFill: 4, aBorder: 4, aParam: 4, aClip: 4 },
    8192,
  );
  private readonly runs = new QuadInstances<GlyphAttr>(
    { aRect: 4, aUV: 4, aColor: 4, aClip: 4, aSoft: 4 },
    8192,
  );
  private readonly glyphs = new QuadInstances<GlyphAttr>(
    { aRect: 4, aUV: 4, aColor: 4, aClip: 4, aSoft: 4 },
    16384,
  );
  private readonly uniforms: LayerUniforms[] = [];
  private frame = 0;
  /** Elements whose DOM text is visible (parity fallback): never painted. */
  readonly domText = new Set<Element>();
  /** App-wide K1 fallback: no text is painted at all, only surfaces. */
  textOff = false;
  lastRuns: PaintedRun[] = [];
  lastLeaves: PaintedLeaf[] = [];
  readonly stats: PaintStats = {
    frame: 0,
    elements: 0,
    surfaces: 0,
    runs: 0,
    glyphs: 0,
    truncated: 0,
    readBuildMs: 0,
    runAtlasEntries: 0,
    sdfAtlasEntries: 0,
    atlasUploads: 0,
    atlasUploadBytes: 0,
    domByRule: 0,
  };
  private domByRule = 0;
  /** Elements left to the DOM by rule (truncated by the browser); re-checked every frame they are read. */
  private readonly domRule = new Set<Element>();

  constructor(width: number, height: number) {
    this.camera = makeCssCamera(width, height);
    const s = makeSurfaceMaterial();
    const r = makeGlyphMaterial(this.runAtlas.atlas.texture, "coverage", 0);
    const g = makeGlyphMaterial(this.sdfAtlas.atlas.texture, "sdf", 1 - SDF_CUTOFF);
    this.uniforms.push(s.uniforms, r.uniforms, g.uniforms);
    const add = (
      geo: QuadInstances<string>["geometry"],
      mat: typeof s.material,
      order: number,
      name: string,
    ) => {
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      mesh.name = name;
      this.scene.add(mesh);
    };
    add(this.surfaces.geometry, s.material, 1, "surfaces");
    add(this.runs.geometry, r.material, 2, "raster-runs");
    add(this.glyphs.geometry, g.material, 3, "sdf-glyphs");
  }

  resize(width: number, height: number): void {
    resizeCssCamera(this.camera, width, height);
  }

  set opacity(v: number) {
    for (const u of this.uniforms) u.opacity.value = v;
  }

  /** READ + BUILD + UPLOAD for the given Plat roots. `record` keeps painted runs for the harness. */
  paint(roots: readonly Element[], vw: number, vh: number, dpr: number, record = true, dprY = dpr): void {
    const t0 = performance.now();
    this.build(roots, vw, vh, dpr, record, dprY);
    if (this.runAtlas.overflowed || this.sdfAtlas.overflowed) {
      // Everything visible this frame did not fit with what was cached: start the pages over once.
      if (this.runAtlas.overflowed) this.runAtlas.reset();
      if (this.sdfAtlas.overflowed) this.sdfAtlas.reset();
      this.build(roots, vw, vh, dpr, record, dprY);
    }
    this.surfaces.commit();
    this.runs.commit();
    this.glyphs.commit();
    this.runAtlas.atlas.flush();
    this.sdfAtlas.atlas.flush();
    const st = this.stats;
    st.frame = this.frame;
    st.surfaces = this.surfaces.count;
    st.runs = this.runs.count;
    st.glyphs = this.glyphs.count;
    st.truncated = this.surfaces.truncated + this.runs.truncated + this.glyphs.truncated;
    st.readBuildMs = performance.now() - t0;
    st.runAtlasEntries = this.runAtlas.size;
    st.sdfAtlasEntries = this.sdfAtlas.size;
    st.atlasUploads = this.runAtlas.atlas.uploads + this.sdfAtlas.atlas.uploads;
    st.atlasUploadBytes = this.runAtlas.atlas.uploadedBytes + this.sdfAtlas.atlas.uploadedBytes;
  }

  /** Paint nothing (for example in the middle of a transition). */
  empty(): void {
    this.surfaces.begin();
    this.runs.begin();
    this.glyphs.begin();
    this.surfaces.commit();
    this.runs.commit();
    this.glyphs.commit();
    this.lastRuns = [];
    this.lastLeaves = [];
  }

  private build(
    roots: readonly Element[],
    vw: number,
    vh: number,
    dpr: number,
    record: boolean,
    dprY: number,
  ): void {
    this.frame++;
    this.domByRule = 0;
    this.runAtlas.frame = this.frame;
    this.sdfAtlas.frame = this.frame;
    this.runAtlas.overflowed = false;
    this.sdfAtlas.overflowed = false;
    this.surfaces.begin();
    this.runs.begin();
    this.glyphs.begin();
    const runsOut: PaintedRun[] = [];
    const leavesOut: PaintedLeaf[] = [];
    const viewport: Box = [0, 0, vw, vh];
    // Clip = the nearest [data-clip] ancestor's rect, intersected up the chain. A scroller with
    // data-clip-sticky="<selector>" also clips content that scrolls under its sticky header (the ledger's thead).
    const clipCache = new Map<string, Box>();
    const hostIds = new Map<Element, number>();
    // The clip of every Plat ancestor that clips its content (overflow hidden / clip / auto / scroll), the
    // element itself included, intersected up the chain and snapped to the device pixel grid like the browser's
    // own clips. Per axis: overflow-x and overflow-y clip independently.
    const chain = new Map<Element, Box>();
    const chainOf = (el: Element | null): Box => {
      if (!el || el === document.documentElement || el === document.body) return viewport;
      const hit = chain.get(el);
      if (hit) return hit;
      const parent = chainOf(el.parentElement);
      const cs = getComputedStyle(el);
      const cx = cs.overflowX !== "visible";
      const cy = cs.overflowY !== "visible";
      let box = parent;
      if (cx || cy) {
        const r = el.getBoundingClientRect();
        const bl = parseFloat(cs.borderLeftWidth) || 0;
        const bt = parseFloat(cs.borderTopWidth) || 0;
        const br = parseFloat(cs.borderRightWidth) || 0;
        const bb = parseFloat(cs.borderBottomWidth) || 0;
        let x1 = r.right - br;
        let y1 = r.bottom - bb;
        if (cs.overflowX === "auto" || cs.overflowX === "scroll")
          x1 = Math.min(x1, r.left + bl + el.clientWidth);
        if (cs.overflowY === "auto" || cs.overflowY === "scroll")
          y1 = Math.min(y1, r.top + bt + el.clientHeight);
        const sx = (v: number) => Math.round(v * dpr) / dpr;
        const sy = (v: number) => Math.round(v * dprY) / dprY;
        box = [
          cx ? Math.max(parent[0], sx(r.left + bl)) : parent[0],
          cy ? Math.max(parent[1], sy(r.top + bt)) : parent[1],
          cx ? Math.min(parent[2], sx(x1)) : parent[2],
          cy ? Math.min(parent[3], sy(y1)) : parent[3],
        ];
      }
      chain.set(el, box);
      return box;
    };
    // `self`: include the element's own overflow clip (its text is clipped by its padding box; its own surface is not).
    const clipOf = (el: Element, self: boolean): Box => {
      const c = chainOf(self ? el : el.parentElement);
      const d = dataClipOf(el);
      return [Math.max(c[0], d[0]), Math.max(c[1], d[1]), Math.min(c[2], d[2]), Math.min(c[3], d[3])];
    };
    const dataClipOf = (el: Element): Box => {
      const host = el.closest("[data-clip]");
      if (!host) return viewport;
      const stickySel = host.getAttribute("data-clip-sticky");
      const sticky = stickySel ? host.querySelector(stickySel) : null;
      const underSticky = !!sticky && !sticky.contains(el) && el !== host;
      let id = hostIds.get(host);
      if (id === undefined) {
        id = hostIds.size;
        hostIds.set(host, id);
      }
      const key = `${id}|${underSticky ? 1 : 0}`;
      const hit = clipCache.get(key);
      if (hit) return hit;
      const r = host.getBoundingClientRect();
      const parent = host.parentElement ? dataClipOf(host.parentElement) : viewport;
      const top = underSticky && sticky ? Math.max(r.top, sticky.getBoundingClientRect().bottom) : r.top;
      const box: Box = [
        Math.max(r.left, parent[0]),
        Math.max(top, parent[1]),
        Math.min(r.right, parent[2]),
        Math.min(r.bottom, parent[3]),
      ];
      clipCache.set(key, box);
      return box;
    };
    const active = document.activeElement;
    let elements = 0;
    for (const root of roots) {
      for (const el of root.querySelectorAll("[data-paint]")) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) continue;
        const clip = clipOf(el, false);
        if (rect.right < clip[0] || rect.left > clip[2] || rect.bottom < clip[1] || rect.top > clip[3])
          continue;
        elements++;
        const kinds = paintKinds(el);
        if (kinds.includes("surface") || kinds.includes("field"))
          this.emitSurface(el, rect, clip, kinds, active);
        if (kinds.includes("text") && !this.textOff && !this.domText.has(el))
          this.emitText(el, rect, clipOf(el, true), dpr, dprY, record, runsOut, leavesOut);
      }
    }
    this.stats.elements = elements;
    this.stats.domByRule = this.domByRule;
    this.lastRuns = runsOut;
    this.lastLeaves = leavesOut;
  }

  private emitSurface(el: Element, rect: DOMRect, clip: Box, kinds: string, active: Element | null): void {
    const style = kinds.includes("field") ? SURFACES.field : surfaceOf(el);
    if (!style) return;
    const i = this.surfaces.next();
    if (i < 0) return;
    const s = this.surfaces;
    s.set4("aRect", i, rect.left, rect.top, rect.width, rect.height);
    s.set4v("aFill", i, style.fill);
    s.set4v("aBorder", i, kinds.includes("field") && active === el ? FIELD_FOCUS_BORDER : style.border);
    const bw = kinds.includes("field") && active === el ? 2 : style.borderWidth;
    s.set4("aParam", i, style.radius, bw, style.shadow, 0);
    s.set4("aClip", i, clip[0], clip[1], clip[2], clip[3]);
  }

  private emitText(
    el: Element,
    rect: DOMRect,
    clip: Box,
    dpr: number,
    dprY: number,
    record: boolean,
    runsOut: PaintedRun[],
    leavesOut: PaintedLeaf[],
  ): void {
    const node = el.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE || el.childNodes.length !== 1) {
      // Not a text leaf (markup inside, or empty): never leave it transparent with nothing painted.
      if (el.textContent?.trim()) {
        this.domText.add(el);
        el.classList.add("dom-text");
      }
      return;
    }
    const textNode = node as Text;
    const text = textNode.data;
    if (!text.trim()) return;
    const style = styleOf(el);
    // Text the browser truncates right now (ellipsis, line clamp) is DOM text by rule (spec 03 TWN-R-3.5.2): the
    // painter cannot reproduce the browser's cut, so it never paints it. That is the design, not a parity failure,
    // so it is counted apart from the fallback share (stats.domByRule).
    if (style.truncates && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
      this.domRule.add(el);
      el.classList.add("dom-text");
      this.domByRule++;
      return;
    }
    if (this.domRule.delete(el)) el.classList.remove("dom-text"); // it fits again: paint it
    const lay = layoutLeaf(this.measurer, style, text, rect);
    const color = toneOf(el);
    const path: GlyphPath = style.spec.size * dpr < RASTER_BELOW_DEVICE_PX ? "raster" : "sdf";
    // Lines wholly outside the clip are not drawn and not owed: parity compares the drawn runs with these.
    const visible = lay.lines.filter(
      (l) => l.text && l.baseline + lay.descent >= clip[1] && l.baseline - lay.ascent <= clip[3],
    ).length;
    if (record)
      leavesOut.push({
        el,
        node: textNode,
        starts: lay.lines.map((l) => l.start),
        ends: lay.lines.map((l) => l.end),
        w: rect.width,
        h: rect.height,
        truncates: style.truncates,
        lines: lay.lines.filter((l) => l.text).length,
        visibleLines: visible,
      });
    lay.lines.forEach((line, li) => {
      if (!line.text) return;
      const top = line.baseline - lay.ascent;
      const bottom = line.baseline + lay.descent;
      if (bottom < clip[1] || top > clip[3]) return;
      let box: { left: number; top: number; right: number; bottom: number } | null;
      box =
        path === "raster"
          ? this.emitRun(
              style.spec,
              line.text,
              line.x,
              line.baseline,
              line.width,
              lay,
              dpr,
              dprY,
              color,
              clip,
            )
          : this.emitSdf(style, line.text, line.x, line.baseline, line.width, lay, dpr, dprY, color, clip);
      if (box && record)
        runsOut.push({
          el,
          node: textNode,
          line: li,
          start: line.start,
          end: line.end,
          text: line.text,
          path,
          ...box,
        });
    });
  }

  private emitRun(
    spec: ReturnType<typeof styleOf>["spec"],
    text: string,
    x: number,
    baseline: number,
    width: number,
    lay: { ascent: number; descent: number },
    dpr: number,
    dprY: number,
    color: readonly number[],
    clip: Box,
  ) {
    const e = this.runAtlas.get(spec, text, width, lay.ascent, lay.descent, dpr);
    if (!e) return null;
    const i = this.runs.next();
    if (i < 0) return null;
    const devX = Math.round(x * dpr);
    const devBase = Math.round(baseline * dprY);
    const qx = devX - e.pad;
    const qy = devBase - e.ascentPx - e.pad;
    const A = this.runAtlas.atlas;
    this.runs.set4("aRect", i, qx / dpr, qy / dprY, e.w / dpr, e.h / dprY);
    this.runs.set4("aUV", i, e.x / A.width, e.y / A.height, (e.x + e.w) / A.width, (e.y + e.h) / A.height);
    this.runs.set4v("aColor", i, color);
    this.runs.set4("aClip", i, clip[0], clip[1], clip[2], clip[3]);
    this.runs.set4("aSoft", i, 0, 0, 0, 0);
    const left = devX / dpr;
    const b = devBase / dprY;
    return { left, right: left + width, top: b - lay.ascent, bottom: b + lay.descent };
  }

  private emitSdf(
    style: ReturnType<typeof styleOf>,
    text: string,
    x: number,
    baseline: number,
    width: number,
    lay: { ascent: number; descent: number },
    dpr: number,
    dprY: number,
    color: readonly number[],
    clip: Box,
  ) {
    const spec = style.spec;
    // The run origin and the baseline sit on the device pixel grid (the rounding the raster path uses); advances
    // inside the run stay fractional, as the browser's own subpixel text positioning does.
    const x0 = Math.round(x * dpr) / dpr;
    const scale = spec.size / SDF_EM;
    const soft = 1 / (SDF_RADIUS * scale * dpr);
    const b = Math.round(baseline * dprY) / dprY;
    const A = this.sdfAtlas.atlas;
    let off = 0;
    for (const g of graphemes(text)) {
      const penX = x0 + this.measurer.width(spec, text.slice(0, off));
      off += g.length;
      if (g.trim() === "") continue;
      const glyph = this.sdfAtlas.get(style.family, style.weight, style.fontStyle, g);
      if (!glyph) continue;
      const i = this.glyphs.next();
      if (i < 0) break;
      const qx = penX + (glyph.left - SDF_BUFFER) * scale;
      const qy = b - (glyph.top + SDF_BUFFER) * scale;
      this.glyphs.set4("aRect", i, qx, qy, glyph.w * scale, glyph.h * scale);
      this.glyphs.set4(
        "aUV",
        i,
        glyph.x / A.width,
        glyph.y / A.height,
        (glyph.x + glyph.w) / A.width,
        (glyph.y + glyph.h) / A.height,
      );
      this.glyphs.set4v("aColor", i, color);
      this.glyphs.set4("aClip", i, clip[0], clip[1], clip[2], clip[3]);
      this.glyphs.set4("aSoft", i, soft, 0, 0, 0);
    }
    return { left: x0, right: x0 + width, top: b - lay.ascent, bottom: b + lay.descent };
  }
}
