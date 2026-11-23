// The town as geometry: procedural recipes for every building (spec 01 section 1.7: the kit is code), and the
// functions that draw a district row (a street band) and a borough's block (a landing tile, a block in the vista)
// from the data in town/boroughs.ts. This module is part of the GPU chunk; the Plat never imports it.

import { Group, Vector3 } from "../engine/three";
import { TONE } from "./kit";
import { Parts } from "./parts";
import { rowWidth, type BoroughDef, type DistrictDef, type RecipeId } from "./boroughs";

export { BOROUGHS, boroughById, buildingByRoute, rowWidth } from "./boroughs";
export type { BoroughDef, BoroughId, BuildingDef, DistrictDef } from "./boroughs";

/** A recipe draws one building with its front face on z = 0, centred on x, extending to negative z. */
type Recipe = (p: Parts, x: number) => void;

// ---------------------------------------------------------------- recipes

const stone = TONE.stone;
const plaster = TONE.plaster;
const card = TONE.card;
const warm = TONE.cardWarm;
const wood = TONE.basswood;
const slate = TONE.slate;

const gableRoof = (p: Parts, x: number, y: number, z: number, w: number, d: number, h: number, c: number) =>
  p.add("gable", new Vector3(x, y, z), new Vector3(w * 1.04, h, d * 1.06), c);

const bank: Recipe = (p, x) => {
  p.box(x, 0, -8.5, 25, 2.2, 17, stone); // podium
  for (let s = 0; s < 3; s++) p.box(x, 0, 1.4 - s * 0.9, 10 - s * 1.2, 0.75 * (s + 1), 1.0, stone); // steps
  p.box(x, 2.2, -7, 22, 10, 14, plaster); // body
  p.box(x, 12.2, -7, 23, 0.7, 15, stone); // cornice
  p.add("gable", new Vector3(x, 12.9, -7), new Vector3(15, 3.2, 23), stone, Math.PI / 2); // pediment
  p.add("drum", new Vector3(x, 12.9, -9), new Vector3(9, 2.4, 9), plaster);
  p.add("dome", new Vector3(x, 15.3, -9), new Vector3(9.4, 9.4, 9.4), TONE.brass);
  for (const sx of [-1, 1])
    for (const k of [0, 1]) p.box(x + sx * (10.3 - k * 1.6), 2.2, 0.25, 0.9, 10, 0.6, stone);
  p.windows(x, 3.4, 0, 15, 4, 2.4, 3.6);
  p.windows(x, 8.0, 0, 15, 4, 2.4, 2.8);
};

const awardOffice: Recipe = (p, x) => {
  p.box(x, 0, -3.5, 8, 5, 7, warm);
  gableRoof(p, x, 5, -3.5, 8, 7, 3.2, slate);
  p.windows(x, 1.4, 0, 6, 2, 1.4, 2);
};

const emporium: Recipe = (p, x) => {
  p.box(x, 0, -4.5, 24, 6, 9, warm);
  gableRoof(p, x, 6, -4.5, 24, 9, 3, card);
  const tints = ["#c9876a", "#7fa08a", "#c7a45c", "#8a8fb3"];
  for (let i = 0; i < 4; i++) {
    const ax = x - 9 + i * 6;
    p.add("box", new Vector3(ax, 3.4, 1.0), new Vector3(4.6, 0.35, 2.2), tints[i] ?? "#c9876a");
    p.windows(ax, 0.8, 0, 4, 1, 3.6, 2.2);
  }
};

const hallOfHonours: Recipe = (p, x) => {
  p.box(x, 0, -4.5, 18, 1.2, 9, stone);
  for (let i = 0; i < 7; i++)
    p.add("drum", new Vector3(x - 7.5 + i * 2.5, 1.2, -0.8), new Vector3(0.9, 6, 0.9), plaster);
  p.box(x, 1.2, -5.5, 16, 6, 5, plaster);
  p.box(x, 7.2, -4.5, 18.5, 0.8, 9.5, stone);
  p.windows(x, 2.5, -3, 12, 3, 1.6, 2.6);
};

const postOffice: Recipe = (p, x) => {
  p.box(x, 0, -4.5, 12, 7, 9, warm);
  gableRoof(p, x, 7, -4.5, 12, 9, 3.6, slate);
  p.windows(x, 1.5, 0, 9, 3, 1.6, 2.4);
  p.add("drum", new Vector3(x + 7, 0, 1), new Vector3(1, 2.2, 1), "#b0473b");
};

const bellTower: Recipe = (p, x) => {
  p.box(x, 0, -2, 4, 18, 4, wood);
  p.add("pyramid", new Vector3(x, 18, -2), new Vector3(4.3, 4, 4.3), slate);
  p.windows(x, 13, 0, 2, 1, 2, 2);
};

const guildHall: Recipe = (p, x) => {
  p.box(x, 0, -4, 10, 6, 8, wood);
  gableRoof(p, x, 6, -4, 10, 8, 4.5, slate);
  p.windows(x, 1.5, 0, 7, 3, 1.4, 2);
};

const gatehouse: Recipe = (p, x) => {
  for (const sx of [-1, 1]) {
    p.box(x + sx * 4.2, 0, -2, 3.6, 11, 4, stone);
    p.add("pyramid", new Vector3(x + sx * 4.2, 11, -2), new Vector3(3.9, 3, 3.9), slate);
  }
  p.box(x, 5.5, -2, 4.8, 3, 3.4, stone);
  p.windows(x, 6, 0, 3, 1, 2.2, 1.6);
};

const fairground: Recipe = (p, x) => {
  const tints = ["#d9a46b", "#9bb39a", "#c98d84"];
  for (let i = 0; i < 3; i++) {
    p.add("drum", new Vector3(x - 4.5 + i * 4.5, 0, -2.5), new Vector3(3.6, 2.4, 3.6), card);
    p.add("cone", new Vector3(x - 4.5 + i * 4.5, 2.4, -2.5), new Vector3(4.4, 3.6, 4.4), tints[i] ?? card);
  }
  p.windows(x, 0.6, -0.6, 9, 3, 1.2, 1.4);
};

const gazettePress: Recipe = (p, x) => {
  p.box(x, 0, -4.5, 11, 7, 9, card);
  p.box(x, 7, -4.5, 11.3, 0.4, 9.3, slate);
  p.add("drum", new Vector3(x + 3.5, 7, -6), new Vector3(1.2, 4, 1.2), wood);
  p.windows(x, 1.5, 0, 8, 3, 1.6, 2.4);
};

const works: Recipe = (p, x) => {
  p.box(x, 0, -4.5, 12, 6, 9, plaster);
  for (let i = 0; i < 3; i++) gableRoof(p, x - 4 + i * 4, 6, -4.5, 4, 9, 2.4, slate);
  p.windows(x, 1.2, 0, 9, 3, 1.8, 2.4);
};

const clockTower: Recipe = (p, x) => {
  p.box(x, 0, -2.5, 5, 15, 5, stone);
  p.add("pyramid", new Vector3(x, 15, -2.5), new Vector3(5.3, 4, 5.3), TONE.brass, 0, "brass");
  p.windows(x, 10.5, 0, 2.6, 1, 2.6, 2.6);
};

const countingHouse: Recipe = (p, x) => {
  p.box(x, 0, -4, 9, 7, 8, wood);
  gableRoof(p, x, 7, -4, 9, 8, 3.2, slate);
  p.windows(x, 1.5, 0, 6, 2, 1.6, 2.4);
};

const depotYard: Recipe = (p, x) => {
  p.box(x - 3, 0, -4, 8, 4, 8, card);
  p.box(x + 4, 0, -2, 4, 2, 4, wood);
  p.box(x + 5.5, 0, -5, 0.5, 9, 0.5, slate);
  p.box(x + 3.5, 8.5, -5, 4.5, 0.4, 0.4, slate);
  p.windows(x - 3, 1, 0, 5, 2, 1.6, 1.8);
};

const stockroom: Recipe = (p, x) => {
  p.box(x, 0, -4, 10, 5, 8, plaster);
  p.box(x, 5, -4, 10.3, 0.4, 8.3, slate);
  p.windows(x, 1.2, 0, 7, 3, 1.4, 1.8);
};

const observatory: Recipe = (p, x) => {
  p.add("drum", new Vector3(x, 0, -6), new Vector3(12, 6, 12), stone);
  p.add("dome", new Vector3(x, 6, -6), new Vector3(12.3, 12.3, 12.3), TONE.brass);
  p.box(x, 0, -0.8, 5, 4, 2, stone);
  p.windows(x, 1, 0.2, 3, 1, 2.2, 2.4);
};

const recordOffice: Recipe = (p, x) => {
  p.box(x, 0, -4.5, 12, 6, 9, stone);
  p.box(x, 6, -4.5, 12.4, 0.8, 9.4, plaster);
  p.windows(x, 1.5, 0, 9, 4, 1.2, 2.6);
};

const townHall: Recipe = (p, x) => {
  p.box(x, 0, -5, 12, 7, 10, plaster);
  gableRoof(p, x, 7, -5, 12, 10, 3, slate);
  p.box(x, 7, -2, 4, 9, 4, stone);
  p.add("pyramid", new Vector3(x, 16, -2), new Vector3(4.4, 4, 4.4), TONE.brass, 0, "brass");
  p.windows(x, 1.6, 0, 9, 4, 1.4, 2.6);
};

const signalMast: Recipe = (p, x) => {
  p.box(x, 0, -2, 4, 1.4, 4, stone);
  p.add("drum", new Vector3(x, 1.4, -2), new Vector3(0.9, 18, 0.9), slate);
  p.add("cone", new Vector3(x, 19.4, -2), new Vector3(1.8, 2.4, 1.8), TONE.brass, 0, "brass");
  p.windows(x, 16, -1.5, 1, 1, 0.9, 0.9);
};

const lampStudio: Recipe = (p, x) => {
  p.box(x, 0, -3.5, 8, 4.5, 7, warm);
  gableRoof(p, x, 4.5, -3.5, 8, 7, 2.8, slate);
  p.windows(x, 1.2, 0, 5, 2, 1.4, 1.8);
};

const fountainSquare: Recipe = (p, x) => {
  p.add("drum", new Vector3(x, 0, -6), new Vector3(20, 0.3, 12), "#d5ccbb");
  p.add("drum", new Vector3(x, 0, -6), new Vector3(4, 1.4, 4), stone);
  p.add("drum", new Vector3(x, 1.4, -6), new Vector3(1, 2.4, 1), stone);
  p.box(x - 12, 0, -5, 6, 4, 6, plaster);
  p.add("pyramid", new Vector3(x - 12, 4, -5), new Vector3(6.4, 3, 6.4), slate);
  p.windows(x - 12, 1, -2, 4, 2, 1.3, 1.8);
  for (let i = 0; i < 5; i++)
    p.add("cone", new Vector3(x + 9 + (i % 2) * 3, 0, -2 - i * 2.4), new Vector3(2.2, 4, 2.2), "#8f9a6e");
};

const newTownPlots: Recipe = (p, x) => {
  p.box(x - 4, 0, -3, 5, 3.5, 5, card);
  gableRoof(p, x - 4, 3.5, -3, 5, 5, 2, 120);
  for (let i = 0; i < 4; i++) p.box(x + 2 + (i % 2) * 4, 0, -1 - Math.floor(i / 2) * 4, 0.3, 5, 0.3, wood);
  p.box(x + 4, 4.8, -3, 4.6, 0.25, 4.6, wood);
};

const RECIPES: Record<RecipeId, Recipe> = {
  bank,
  awardOffice,
  emporium,
  hallOfHonours,
  postOffice,
  bellTower,
  guildHall,
  gatehouse,
  fairground,
  gazettePress,
  works,
  clockTower,
  countingHouse,
  depotYard,
  stockroom,
  observatory,
  recordOffice,
  townHall,
  signalMast,
  lampStudio,
  fountainSquare,
  newTownPlots,
};

/** Model units between two district rows of a block, and the step up of each row behind (the hillside). */
const ROW_GAP = 5;
const ROW_STEP_UP = 1.2;

/** Draw one district row with its lots centred on x = 0, fronts on z = 0. Each building's parts carry its id. */
export const drawRow = (p: Parts, d: DistrictDef): void => {
  let x = -rowWidth(d) / 2;
  for (const bd of d.buildings) {
    p.tag = bd.id;
    RECIPES[bd.recipe](p, x + bd.lot / 2);
    p.tag = null;
    x += bd.lot;
  }
  // The lane in front of the row.
  p.add("box", new Vector3(0, -0.15, 3), new Vector3(rowWidth(d) + 4, 0.3, 4.5), "#cfc6b4");
};

export interface Block {
  readonly group: Group;
  /** Footprint in the block's own frame: x from -width/2 to width/2, z from -depth to front. */
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly parts: Parts;
}

/** A borough's block: its district rows stacked back and stepped up, front row first (spec 01 section 1.4.3). */
export const buildBlock = (borough: BoroughDef): Block => {
  const p = new Parts();
  let z = 0;
  let width = 0;
  let height = 0;
  borough.districts.forEach((d, i) => {
    const sub = new Parts();
    drawRow(sub, d);
    // Shift the row back and up by building it through an offset parts set.
    const off = new Vector3(0, i * ROW_STEP_UP, z);
    p.absorb(sub, off);
    width = Math.max(width, rowWidth(d) + 4);
    const deepest = Math.max(...[...sub.bounds.values()].map((bb) => -bb.min.z), 8);
    const tallest = Math.max(...[...sub.bounds.values()].map((bb) => bb.max.y), 4);
    height = Math.max(height, tallest + i * ROW_STEP_UP);
    if (i > 0) p.box(0, 0, z + 1, rowWidth(d) + 4, i * ROW_STEP_UP, 6, "#d9d0bf"); // retaining terrace
    z -= deepest + ROW_GAP;
  });
  const group = p.build(`block-${borough.id}`);
  return { group, width, depth: -z, height, parts: p };
};
