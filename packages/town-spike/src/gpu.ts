// The GPU chunk: everything that needs three.js, loaded with a dynamic import AFTER the Plat has rendered with its
// data (t1). The first paint on a phone is therefore the Plat shell and the route's data, with no three.js, glyph
// atlas or SDF code on the critical path (spec 00 section 0.6, C14). The app reaches this module only through
// `import("./gpu")`.

import { Color, QuadMesh, RenderTarget, Vector3, type Camera, type Scene } from "./engine/three";
import { Engine } from "./engine/renderer";
import { makeBlitMaterial } from "./engine/layers";
import { makeCityPost } from "./engine/tiltshift";
import { PlatPainter } from "./plat/painter";
import { Parity } from "./plat/parity";
import { fontsResolveInCanvas } from "./text/fonts";
import { TownScene } from "./town/town-scene";
import { Baker } from "./town/bake";
import { BAND_PAPER, buildBandScene, type BandScene } from "./town/band-scene";
import { buildRibbon, type Ribbon } from "./interior/ribbon";
import type { DistrictDef } from "./town/boroughs";
import type { StatementLine } from "./interior/api";
import type { GpuViews } from "./views/types";

export {
  BAND_PAPER,
  Baker,
  Color,
  Engine,
  Parity,
  PlatPainter,
  QuadMesh,
  RenderTarget,
  TownScene,
  Vector3,
  fontsResolveInCanvas,
  makeBlitMaterial,
  makeCityPost,
};

/** The paper the town is drawn on (the canvas clear colour). */
export const PAPER = new Color("#d6cfc2");

/** The bake services the views use: band scenes and the ribbon are built once and cached. */
export const makeGpuViews = (
  bake: (scene: Scene, camera: Camera, w: number, h: number) => Promise<ImageData | null>,
): GpuViews => {
  const bands = new Map<string, BandScene>();
  let ribbon: { lines: StatementLine[]; r: Ribbon } | null = null;
  return {
    async bakeBand(district: DistrictDef, width: number, height: number, dpr: number) {
      let band = bands.get(district.id);
      if (!band) bands.set(district.id, (band = buildBandScene(district)));
      const rects = band.frame(width, height);
      const image = await bake(band.scene, band.camera, width * dpr, height * dpr);
      return { rects, image };
    },
    async bakeRibbon(lines: StatementLine[], azimuth: number, width: number, height: number, dpr: number) {
      if (!ribbon || ribbon.lines !== lines) ribbon = { lines, r: buildRibbon(lines) };
      ribbon.r.azimuth = azimuth;
      ribbon.r.frame(width / height);
      return bake(ribbon.r.scene, ribbon.r.camera, width * dpr, height * dpr);
    },
  };
};
