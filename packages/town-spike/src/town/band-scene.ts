// One street band: a district's row of buildings, seen by the axonometric bake camera (heading north, elevation
// 35°, no roll; spec 01 section 1.4.3), so its image does not depend on the scroll position. The same recipes and
// lots as the block on the landing tile and in the vista.

import {
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
  Scene,
  Vector3,
} from "../engine/three";
import { Parts } from "./parts";
import { drawRow, rowWidth, type DistrictDef } from "./model";
import { ELEVATION } from "./town-scene";

import type { BandRect } from "../views/types";
export type { BandRect };

export interface BandScene {
  readonly scene: Scene;
  readonly camera: OrthographicCamera;
  /** Frame the band for a CSS box; returns each building's facade rect in that box (CSS px). */
  frame(width: number, height: number): BandRect[];
}

export const BAND_PAPER = new Color("#e4dccb");

export const buildBandScene = (district: DistrictDef, azimuth = 0): BandScene => {
  const scene = new Scene();
  scene.background = BAND_PAPER.clone();
  const p = new Parts();
  drawRow(p, district);
  const W = rowWidth(district) + 6;
  p.box(0, -0.6, -8, W + 40, 0.6, 46, "#ddd4c2"); // the terrace the lots stand on
  scene.add(p.build(`band-${district.id}`));
  scene.add(new HemisphereLight(new Color("#f6f1e7"), new Color("#7d7468"), 1.3));
  const sun = new DirectionalLight(new Color("#fff0d8"), 2.4);
  sun.position.set(-60, 90, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -W;
  sc.right = W;
  sc.top = 60;
  sc.bottom = -60;
  sc.near = 1;
  sc.far = 400;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.3;
  scene.add(sun, sun.target);

  const all = new Box3();
  for (const bb of p.bounds.values()) all.union(bb);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 1, 2000);

  const frame = (width: number, height: number): BandRect[] => {
    // Fit the row's width with a margin, then put the lane at 82 % of the band's height.
    const k = Math.min(
      (width * 0.94) / W,
      (height * 0.72) / Math.max(1, all.max.y * Math.cos(ELEVATION) + 4),
    );
    const halfW = width / (2 * k);
    const halfH = height / (2 * k);
    const dir = new Vector3(Math.sin(azimuth), Math.tan(ELEVATION), Math.cos(azimuth)).normalize();
    const target = new Vector3(0, 0, 2);
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.position.copy(target).addScaledVector(dir, 600);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // Shift the view up so the lane sits low in the band: move the frustum, not the camera direction.
    const shift = height * 0.32;
    camera.top = halfH + shift / k;
    camera.bottom = -halfH + shift / k;
    camera.updateProjectionMatrix();
    const out: BandRect[] = [];
    for (const [id, bb] of p.bounds) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const x of [bb.min.x, bb.max.x])
        for (const y of [bb.min.y, bb.max.y])
          for (const z of [bb.min.z, bb.max.z]) {
            const v = new Vector3(x, y, z).project(camera);
            xs.push((v.x * 0.5 + 0.5) * width);
            ys.push((1 - (v.y * 0.5 + 0.5)) * height);
          }
      const left = Math.max(0, Math.min(...xs));
      const top = Math.max(0, Math.min(...ys));
      out.push({
        id,
        left,
        top,
        width: Math.min(width, Math.max(...xs)) - left,
        height: Math.min(height, Math.max(...ys)) - top,
      });
    }
    return out;
  };
  return { scene, camera, frame };
};
