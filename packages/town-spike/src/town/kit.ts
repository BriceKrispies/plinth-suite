// The model-making look (township.md S.2; procedural kit, spec 01 section 1.7): matte card, painted basswood, stone, brushed brass. One uber-material for
// card and wood, whose colour is the instance colour times a procedural fibre term, so no texture assets are needed.

import {
  Color,
  MeshStandardNodeMaterial,
  TSL,
  BufferGeometry,
  Float32BufferAttribute,
} from "../engine/three";

/** Palette indices; a tone ≥ 100 encodes a painted roof hue. */
export const TONE = { card: 0, basswood: 1, stone: 2, brass: 3, cardWarm: 4, slate: 5, plaster: 6 } as const;

/** Deterministic RNG (mulberry32) so the town is the same on every load and every backend. */
export const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const { mx_noise_float, positionWorld, vec3, float } = TSL;

const PALETTE: Record<number, string> = {
  [TONE.card]: "#ece5d6",
  [TONE.basswood]: "#d8bf94",
  [TONE.stone]: "#c9c1b2",
  [TONE.brass]: "#b38b3e",
  [TONE.cardWarm]: "#e5cfae",
  [TONE.slate]: "#7d8079",
  [TONE.plaster]: "#e9dcc6",
};

/** Palette colour, or a painted roof (tone ≥ 100 encodes a hue, kept low in chroma so it reads as paint on card). */
export const toneColor = (tone: number): Color => {
  if (tone >= 100) {
    const hue = (tone - 100) / 360;
    return new Color().setHSL(hue, 0.28, 0.62);
  }
  return new Color(PALETTE[tone] ?? "#e8e1d3");
};

/** Card and basswood: matte, with a faint fibre/grain so surfaces read as material, not flat colour. */
export const makeCardMaterial = (): MeshStandardNodeMaterial => {
  const m = new MeshStandardNodeMaterial({ roughness: 0.88, metalness: 0 });
  m.name = "model-card";
  const grain = mx_noise_float(positionWorld.mul(vec3(0.9, 7.0, 0.9)));
  const speck = mx_noise_float(positionWorld.mul(vec3(11.0, 11.0, 11.0)));
  m.colorNode = vec3(float(0.93).add(grain.mul(0.05)).add(speck.mul(0.025)));
  return m;
};

export const makeBrassMaterial = (): MeshStandardNodeMaterial => {
  const m = new MeshStandardNodeMaterial({ color: new Color("#b8913f"), roughness: 0.36, metalness: 0.35 });
  m.name = "model-brass";
  return m;
};

/** Lit windows: emissive, so they also land in the emissive MRT target that feeds bloom. */
export const makeWindowMaterial = (): MeshStandardNodeMaterial => {
  const m = new MeshStandardNodeMaterial({
    color: new Color("#3a2f22"),
    emissive: new Color("#ffc977"),
    emissiveIntensity: 2.4,
    roughness: 0.6,
  });
  m.name = "lit-window";
  return m;
};

/** A unit gable prism: footprint 1 × 1 centred on the origin, ridge along x, height 1. */
export const gableGeometry = (): BufferGeometry => {
  const a = [-0.5, 0, -0.5];
  const b = [0.5, 0, -0.5];
  const c = [0.5, 0, 0.5];
  const d = [-0.5, 0, 0.5];
  const e = [-0.5, 1, 0];
  const f = [0.5, 1, 0];
  const tris = [
    // slopes
    d,
    c,
    f,
    d,
    f,
    e,
    b,
    a,
    e,
    b,
    e,
    f,
    // gable ends
    a,
    d,
    e,
    c,
    b,
    f,
    // base
    a,
    b,
    c,
    a,
    c,
    d,
  ];
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
};
