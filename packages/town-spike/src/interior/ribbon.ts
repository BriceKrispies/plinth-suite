// Instrument graft: the ledger as a flow-ribbon diorama (township.md 3.3, evaluation-matrix "ledger to flow
// ribbon"). 3D only where it adds meaning: height is the running balance, ribbon width is the size of each line's
// credit or debit, and colour (plus the rise or fall) tells the direction. The list (or table) and the figcaption
// stay the accessible source of truth. The diorama is baked to an image inside the room (engine/bake), so it scrolls
// with the page; it is orbited by the ⟲ ⟳ buttons (and by drag only with a fine pointer), each re-baking it.

import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  Scene,
} from "../engine/three";
import type { StatementLine } from "./api";

export interface Ribbon {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Azimuth in degrees around the ribbon (0 = the default three-quarter view). */
  azimuth: number;
  /** Aim the camera for a viewport of this aspect ratio at the current azimuth. */
  frame(aspect: number): void;
}

export const buildRibbon = (newestFirst: StatementLine[]): Ribbon => {
  const lines = newestFirst.slice().reverse();
  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 2, 1, 400);
  const n = lines.length;
  const L = 64;
  const H = 18;
  const maxBal = Math.max(1, ...lines.map((l) => l.balance_after));
  const maxD = Math.max(1, ...lines.map((l) => Math.abs(l.amount)));
  const xs = (i: number) => (n > 1 ? (i / (n - 1) - 0.5) * L : 0);
  const ys = (i: number) => ((lines[i]?.balance_after ?? 0) / maxBal) * H + 0.4;
  const ws = (i: number) =>
    0.5 + (3.2 * Math.log10(1 + Math.abs(lines[i]?.amount ?? 0))) / Math.log10(1 + maxD);
  const credit = new Color("#3f8a52");
  const debit = new Color("#b4503d");
  const wallCredit = new Color("#cfe0d2");
  const wallDebit = new Color("#ecd2ca");
  const pos: number[] = [];
  const col: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], color: Color) => {
    for (const v of [a, b, c, a, c, d]) {
      pos.push(v[0]!, v[1]!, v[2]!);
      col.push(color.r, color.g, color.b);
    }
  };
  for (let i = 0; i + 1 < n; i++) {
    const up = (lines[i + 1]?.amount ?? 0) >= 0;
    const x0 = xs(i);
    const x1 = xs(i + 1);
    const y0 = ys(i);
    const y1 = ys(i + 1);
    const w0 = ws(i) / 2;
    const w1 = ws(i + 1) / 2;
    // top surface
    quad([x0, y0, w0], [x1, y1, w1], [x1, y1, -w1], [x0, y0, -w0], up ? credit : debit);
    // front curtain down to the base, a light tint so the area under the balance reads as volume
    quad([x0, 0, w0], [x1, 0, w1], [x1, y1, w1], [x0, y0, w0], up ? wallCredit : wallDebit);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  mat.side = 2; // DoubleSide
  scene.add(new Mesh(geo, mat));
  const base = new Mesh(
    new BoxGeometry(L + 6, 0.4, 14).translate(0, -0.2, 0),
    new MeshStandardNodeMaterial({ color: new Color("#e4dccb"), roughness: 0.9 }),
  );
  scene.add(base);
  scene.add(new AmbientLight(new Color("#ffffff"), 1.1));
  const sun = new DirectionalLight(new Color("#fff3df"), 2.2);
  sun.position.set(-30, 60, 40);
  scene.add(sun);
  scene.background = new Color("#f1ece2");
  const ribbon: Ribbon = {
    scene,
    camera,
    azimuth: 0,
    frame(aspect: number) {
      // Portrait-ish wells look from higher up; wide wells from the side (framing follows the aspect ratio).
      const a = ((-28 + ribbon.azimuth) * Math.PI) / 180;
      const dist = aspect < 1.4 ? 96 : 70;
      const height = aspect < 1.4 ? 46 : 30;
      camera.aspect = aspect;
      camera.position.set(Math.sin(a) * dist, height, Math.cos(a) * dist);
      camera.lookAt(0, 6, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    },
  };
  ribbon.frame(2);
  return ribbon;
};
