// Dynamic SDF (township.md R3.1 item 2, third path): glyphs are rasterised once with tiny-sdf at a 48 px em and
// appended to an R8 SDF page. In the spike this path carries all display and large text (≥ 15 device px), standing in
// for the deferred MSDF atlases.

import TinySDF from "@mapbox/tiny-sdf";
import { R8Atlas } from "./r8-atlas";

export const SDF_EM = 48;
export const SDF_BUFFER = 4;
export const SDF_RADIUS = 12;
export const SDF_CUTOFF = 0.25;

export interface SdfGlyph {
  readonly x: number;
  readonly y: number;
  readonly w: number; // texels, including the buffer
  readonly h: number;
  readonly left: number; // glyphLeft in em px
  readonly top: number; // glyphTop in em px
  shelf: number;
}

export class SdfAtlas {
  readonly atlas: R8Atlas;
  private readonly glyphs = new Map<string, SdfGlyph | null>();
  private readonly makers = new Map<string, TinySDF>();
  frame = 0;
  overflowed = false;
  rasterised = 0;

  constructor(size = 2048) {
    this.atlas = new R8Atlas(size, size, "linear", "sdf-atlas");
  }

  get size(): number {
    return this.glyphs.size;
  }

  reset(): void {
    this.glyphs.clear();
    this.atlas.packer.reset();
    this.overflowed = false;
  }

  private maker(family: string, weight: string, style: string): TinySDF {
    const k = `${style}|${weight}|${family}`;
    let m = this.makers.get(k);
    if (!m) {
      m = new TinySDF({
        fontSize: SDF_EM,
        buffer: SDF_BUFFER,
        radius: SDF_RADIUS,
        cutoff: SDF_CUTOFF,
        fontFamily: family,
        fontWeight: weight,
        fontStyle: style,
      });
      this.makers.set(k, m);
    }
    return m;
  }

  /** null for an empty glyph (a space). */
  get(family: string, weight: string, style: string, grapheme: string): SdfGlyph | null {
    const key = `${style}|${weight}|${family}|${grapheme}`;
    if (this.glyphs.has(key)) {
      const g = this.glyphs.get(key) ?? null;
      if (g) this.atlas.packer.touch(g.shelf, this.frame);
      return g;
    }
    const d = this.maker(family, weight, style).draw(grapheme);
    if (d.glyphWidth === 0 || d.glyphHeight === 0) {
      this.glyphs.set(key, null);
      return null;
    }
    const got = this.atlas.packer.alloc(key, d.width, d.height, this.frame);
    if (!got) {
      this.overflowed = true;
      return null;
    }
    for (const k of got.evicted) this.glyphs.delete(k);
    this.atlas.write(got.slot.x, got.slot.y, d.width, d.height, d.data);
    const g: SdfGlyph = {
      x: got.slot.x,
      y: got.slot.y,
      w: d.width,
      h: d.height,
      left: d.glyphLeft,
      top: d.glyphTop,
      shelf: got.slot.shelf,
    };
    this.glyphs.set(key, g);
    this.rasterised++;
    return g;
  }
}
