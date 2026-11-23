// What every view gets from the app.

import type { Me, MemberCard, PointsSummary, StatementLine } from "../interior/api";
import type { Motion } from "../engine/capability";
import type { DistrictDef } from "../town/boroughs";

/** A building's facade rect in its band image (CSS px of the band's box). */
export interface BandRect {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * What the GPU chunk offers the views once it has loaded (null before that, and in Plain mode). The views never
 * import three.js: the first paint is the Plat alone.
 */
export interface GpuViews {
  /** Frame a district's band for a box and bake it: the facade rects, and the image (null if the bake failed). */
  bakeBand(
    district: DistrictDef,
    width: number,
    height: number,
    dpr: number,
  ): Promise<{ rects: BandRect[]; image: ImageData | null }>;
  /** Bake the statement's flow ribbon at an azimuth for a box. */
  bakeRibbon(
    lines: StatementLine[],
    azimuth: number,
    width: number,
    height: number,
    dpr: number,
  ): Promise<ImageData | null>;
}

export interface AppData {
  me: Me | null;
  lines: StatementLine[];
  summary: PointsSummary | null;
  people: MemberCard[];
  handle: string;
}

export interface ViewCtx {
  readonly data: AppData;
  navigate(path: string, opts?: { origin?: Element | null; replace?: boolean }): void;
  back(fallback: string): void;
  href(path: string): string;
  announce(msg: string): void;
  markDirty(): void;
  motion(): Motion;
  /** The GPU chunk's view services, or null (not loaded yet, or Plain mode). */
  gpu(): GpuViews | null;
}

/** A link that routes in-app on a plain click and stays a real link for middle-click and copy. */
export const routeLink = (ctx: ViewCtx, a: HTMLAnchorElement, path: string): HTMLAnchorElement => {
  a.href = ctx.href(path);
  a.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    ctx.navigate(path, { origin: a });
  });
  return a;
};
