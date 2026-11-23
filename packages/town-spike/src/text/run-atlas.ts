// Raster runs (township.md R3.1 item 2): small text is drawn whole with fillText, using the Plat's own font string,
// into an OffscreenCanvas. Its coverage (alpha) goes into an R8 run atlas, keyed font|size|dpr|text|tracking, with
// LRU eviction by shelf. Each run is painted at an integer device-pixel origin and sampled texel for texel, so it
// is the browser's rasteriser output (grayscale; see SPIKE.md for the ClearType note).

import type { FontSpec } from "./fonts";
import { R8Atlas } from "./r8-atlas";
import { makeCanvas, setLetterSpacing, type Canvas2D, type Ctx2D } from "./canvas";

export interface RunEntry {
  readonly x: number; // atlas texels
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly pad: number; // device px left of the pen origin
  readonly ascentPx: number; // device px from the top of the ink box (after pad) to the baseline
  shelf: number;
}

const PAD = 3;

export class RunAtlas {
  readonly atlas: R8Atlas;
  private readonly entries = new Map<string, RunEntry>();
  private readonly scratch: Canvas2D;
  private readonly ctx: Ctx2D;
  frame = 0;
  rasterised = 0;
  /** Set when an allocation failed for lack of space this frame; the painter repaints next frame. */
  overflowed = false;

  constructor(size = 2048) {
    this.atlas = new R8Atlas(size, size, "nearest", "run-atlas");
    const s = makeCanvas(512, 64, true);
    this.scratch = s.canvas;
    this.ctx = s.ctx;
  }

  get size(): number {
    return this.entries.size;
  }

  reset(): void {
    this.entries.clear();
    this.atlas.packer.reset();
    this.overflowed = false;
  }

  get(
    spec: FontSpec,
    text: string,
    width: number,
    ascent: number,
    descent: number,
    dpr: number,
  ): RunEntry | null {
    const key = `${spec.key}|${dpr}|${text}`;
    const hit = this.entries.get(key);
    if (hit) {
      this.atlas.packer.touch(hit.shelf, this.frame);
      return hit;
    }
    const ascPx = Math.ceil(ascent * dpr);
    const w = Math.ceil(width * dpr) + PAD * 2;
    const h = ascPx + Math.ceil(descent * dpr) + PAD * 2;
    const got = this.atlas.packer.alloc(key, w, h, this.frame);
    if (!got) {
      this.overflowed = true;
      return null;
    }
    for (const k of got.evicted) this.entries.delete(k);
    const { slot } = got;
    // Raster at device resolution with the same font string, scaled to device pixels.
    if (this.scratch.width < w || this.scratch.height < h) {
      this.scratch.width = Math.max(this.scratch.width, w);
      this.scratch.height = Math.max(this.scratch.height, h);
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = spec.font.replace(/(\d+(?:\.\d+)?)px/, (_, n: string) => `${parseFloat(n) * dpr}px`);
    setLetterSpacing(ctx, spec.letterSpacing * dpr);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.fillText(text, PAD, PAD + ascPx);
    const img = ctx.getImageData(0, 0, w, h);
    this.atlas.clearRect(slot.x, slot.y, w, h);
    this.atlas.write(slot.x, slot.y, w, h, img.data, w, 3, 4);
    const entry: RunEntry = { x: slot.x, y: slot.y, w, h, pad: PAD, ascentPx: ascPx, shelf: slot.shelf };
    this.entries.set(key, entry);
    this.rasterised++;
    return entry;
  }
}
