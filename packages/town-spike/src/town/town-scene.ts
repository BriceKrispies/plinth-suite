// The town scene: one scene graph for the landing (compact) and the plinth vista (expanded), spec 01 sections
// 1.4.2 and 1.4.6. The blocks, their lots and facades are the same objects in both; a layout only moves each block
// rigidly (and turns it by a multiple of 90° in the vista), scales it to its tile on the landing, and picks the
// camera: an axonometric orthographic camera for the landing (heading north, elevation 35°, no roll), a perspective
// camera with eight headings for the vista.

import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
} from "../engine/three";
import { sharedMaterials } from "./parts";
import { BOROUGHS, buildBlock, type Block, type BoroughId } from "./model";
import { buildFlows, type Flows } from "./flows";
import type { StatementLine } from "../interior/api";

import type { Rect } from "./rect";
export type { Rect };

/** Axonometric bake and landing camera: heading north, elevation 35° (spec 01 section 1.4.3). */
export const ELEVATION = (35 * Math.PI) / 180;
/** CSS px per model unit on the landing's ground plane (any value works: blocks are scaled to their tiles). */
const K = 3;
export const PLINTH_RADIUS = 128;
const PAPER = new Color("#d6cfc2");

interface Placed {
  readonly pivot: Group;
  readonly block: Block;
}

export type TownLayout = "landing" | "vista";

export class TownScene {
  readonly scene = new Scene();
  readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  readonly persp = new PerspectiveCamera(28, 1, 1, 3000);
  readonly blocks = new Map<BoroughId, Placed>();
  readonly flows: Flows;
  readonly sun: DirectionalLight;
  layout: TownLayout = "landing";
  /** Vista heading in 45° steps (0 = south, toward the default viewer). */
  heading = 0;
  /** The borough the vista is framed on, or null for the whole plinth. */
  framed: BoroughId | null = null;
  private readonly plates: InstancedMesh;
  private readonly plinth: Mesh;
  private landingView = { W: 390, H: 844 };
  /** Where each tile sits on screen (CSS px) for the current landing layout. */
  readonly tileRects = new Map<BoroughId, Rect>();

  constructor(recent: StatementLine[]) {
    this.scene.background = PAPER.clone();
    for (const def of BOROUGHS) {
      const block = buildBlock(def);
      const pivot = new Group();
      pivot.name = `pivot-${def.id}`;
      block.group.position.set(0, 0, block.depth / 2); // centre the block's footprint on the pivot
      pivot.add(block.group);
      this.scene.add(pivot);
      this.blocks.set(def.id, { pivot, block });
    }
    const mats = sharedMaterials();
    // Tile plates and the landing's plinth slab: one instanced draw.
    this.plates = new InstancedMesh(new BoxGeometry(1, 1, 1).translate(0, -0.5, 0), mats.card, 10);
    this.plates.name = "plates";
    this.plates.receiveShadow = true;
    this.plates.frustumCulled = false;
    this.scene.add(this.plates);
    // The vista's octagonal plinth.
    const plinthGeo = new CylinderGeometry(PLINTH_RADIUS, PLINTH_RADIUS + 5, 8, 8).translate(0, -4, 0);
    plinthGeo.rotateY(Math.PI / 8);
    const colors = new Float32Array(plinthGeo.getAttribute("position").count * 3);
    const tint = new Color("#cfc6b3");
    for (let i = 0; i < colors.length; i += 3) colors.set([tint.r, tint.g, tint.b], i);
    plinthGeo.setAttribute("color", new Float32BufferAttribute(colors, 3));
    this.plinth = new Mesh(plinthGeo, mats.card);
    this.plinth.name = "plinth";
    this.plinth.receiveShadow = true;
    this.scene.add(this.plinth);

    this.scene.add(new HemisphereLight(new Color("#f6f1e7"), new Color("#7d7468"), 1.25));
    const sun = new DirectionalLight(new Color("#fff0d8"), 2.6);
    sun.position.set(-110, 170, 120);
    sun.castShadow = false;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -160;
    sc.right = 160;
    sc.top = 160;
    sc.bottom = -160;
    sc.near = 10;
    sc.far = 600;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.35;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    this.flows = buildFlows(
      [
        { id: "credit", points: [new Vector3(), new Vector3(1, 0, 0)] },
        { id: "debit", points: [new Vector3(), new Vector3(1, 0, 0)] },
        { id: "award", points: [new Vector3(), new Vector3(1, 0, 0)] },
      ],
      recent,
    );
    this.scene.add(this.flows.mesh);
  }

  /** Shadow maps are an Enhanced-tier effect (spec 00 section 0.6): Base has none. */
  setShadows(on: boolean): void {
    this.sun.castShadow = on;
  }

  // ------------------------------------------------------------ landing

  /** Ground point (y = 0) under the CSS point (px, py) for the landing camera. */
  private ground(px: number, py: number, y = 0): Vector3 {
    const { W, H } = this.landingView;
    return new Vector3((px - W / 2) / K, y, (py - H / 2) / (K * Math.sin(ELEVATION)));
  }

  /**
   * Lay the landing out over the tile rects (viewport CSS px, from the Plat). The camera frames the whole viewport
   * so the tiles' DOM links sit exactly over their vignettes.
   */
  layoutLanding(tiles: Map<BoroughId, Rect>, plinth: Rect | null, W: number, H: number): void {
    this.layout = "landing";
    this.landingView = { W, H };
    this.tileRects.clear();
    for (const [k, v] of tiles) this.tileRects.set(k, v);
    this.plinth.visible = false;
    this.plates.visible = true;
    this.setLandingCamera({ left: 0, top: 0, width: W, height: H });
    const sinE = Math.sin(ELEVATION);
    const cosE = Math.cos(ELEVATION);
    const thick = 5 / (K * cosE); // the plate's front edge shows as about 5 px
    let n = 0;
    const plate = (r: Rect, color: string, lift = 0) => {
      const z0 = (r.top - H / 2) / (K * sinE);
      const z1 = (r.top + r.height - 5 - H / 2) / (K * sinE);
      const m = new Matrix4().compose(
        new Vector3((r.left + r.width / 2 - W / 2) / K, lift, (z0 + z1) / 2),
        new Quaternion(),
        new Vector3(r.width / K, thick, Math.max(0.1, z1 - z0)),
      );
      this.plates.setMatrixAt(n, m);
      this.plates.setColorAt(n, new Color(color));
      n++;
    };
    if (plinth) plate({ ...plinth, height: plinth.height + 4 }, "#a59a88", -thick);
    for (const [id, r] of tiles) plate(r, id === "square" ? "#ddd3bf" : "#e6decd");
    this.plates.count = n;
    this.plates.instanceMatrix.needsUpdate = true;
    if (this.plates.instanceColor) this.plates.instanceColor.needsUpdate = true;

    for (const [id, placed] of this.blocks) {
      const r = tiles.get(id);
      placed.pivot.visible = !!r;
      if (!r) continue;
      const bl = placed.block;
      const label = Math.min(40, r.height * 0.36); // the tile's DOM label sits in its top part
      const availH = Math.max(12, r.height - label - 8);
      const sW = (r.width * 0.84) / (bl.width * K);
      const sH = availH / ((bl.depth * sinE + bl.height * cosE) * K);
      const s = Math.max(0.05, Math.min(sW, sH));
      const front = this.ground(r.left + r.width / 2, r.top + r.height - 9);
      placed.pivot.scale.setScalar(s);
      placed.pivot.rotation.set(0, 0, 0);
      placed.pivot.position.set(front.x, 0, front.z - (bl.depth / 2) * s);
    }
    this.flows.size.value = 2.2;
    this.flows.setPaths(this.landingPaths(tiles));
  }

  /** Streets between tiles: out of the source tile, along the gutters, into the destination tile. */
  private landingPaths(tiles: Map<BoroughId, Rect>): { id: string; points: Vector3[] }[] {
    const c = (r: Rect | undefined) =>
      r
        ? {
            x: r.left + r.width / 2,
            top: r.top,
            bottom: r.top + r.height,
            left: r.left,
            right: r.left + r.width,
          }
        : null;
    const rew = c(tiles.get("rewards"));
    const per = c(tiles.get("personal"));
    const adm = c(tiles.get("admin"));
    const sq = c(tiles.get("square"));
    if (!rew || !per || !adm) {
      const p = [this.ground(0, 0, 0.6), this.ground(1, 0, 0.6)];
      return [0, 1, 2].map((i) => ({ id: String(i), points: p }));
    }
    const midX = sq ? sq.x : (rew.x + per.x) / 2;
    const g = (x: number, y: number) => this.ground(x, y, 0.6);
    const credit = [
      g(rew.x, rew.bottom - 8),
      g(rew.x, rew.bottom + 3),
      g(midX, rew.bottom + 3),
      g(midX, per.top - 3),
      g(per.x, per.top - 3),
      g(per.x, per.top + (per.bottom - per.top) * 0.7),
    ];
    const debit = [
      g(per.x - 20, per.top + (per.bottom - per.top) * 0.7),
      g(per.x - 20, per.top - 3),
      g(midX - 8, per.top - 3),
      g(midX - 8, rew.bottom + 3),
      g(rew.x - 30, rew.bottom + 3),
      g(rew.x - 30, rew.bottom - 10),
    ];
    const award = [
      g(adm.x, adm.bottom - 8),
      g(adm.x, adm.bottom + 3),
      g(rew.x + 20, adm.bottom + 3),
      g(rew.x + 20, rew.top + (rew.bottom - rew.top) * 0.6),
    ];
    return [
      { id: "credit", points: credit },
      { id: "debit", points: debit },
      { id: "award", points: award },
    ];
  }

  /**
   * Frame the viewport rect `view` (CSS px of the landing's full view) with the landing camera. Used for the zoom
   * transitions: lerping `view` from the whole screen to a tile zooms into that tile.
   */
  setLandingCamera(view: Rect): void {
    const { W, H } = this.landingView;
    const cam = this.ortho;
    cam.left = (view.left - W / 2) / K;
    cam.right = (view.left + view.width - W / 2) / K;
    cam.top = (H / 2 - view.top) / K;
    cam.bottom = (H / 2 - view.top - view.height) / K;
    const dir = new Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION));
    cam.position.copy(dir.multiplyScalar(1200));
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.near = 1;
    cam.far = 4000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /** The rect to zoom into for a tile: the tile, widened to the viewport's aspect ratio. */
  zoomRectFor(id: BoroughId, depth = 1): Rect | null {
    const r = this.tileRects.get(id);
    if (!r) return null;
    const { W, H } = this.landingView;
    const w = Math.max(40, r.width * (depth > 1 ? 0.45 : 1));
    const h = (w * H) / W;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height * 0.62;
    return { left: cx - w / 2, top: cy - h / 2, width: w, height: h };
  }

  // ------------------------------------------------------------ vista

  layoutVista(aspect: number): void {
    this.layout = "vista";
    this.plinth.visible = true;
    this.plates.visible = false;
    // Blocks stand around the Square, turned by multiples of 90° to face it (spec 01 section 1.4.6).
    const D = 74;
    const spots: Record<BoroughId, [number, number, number]> = {
      square: [0, 0, 0],
      personal: [0, D, Math.PI],
      rewards: [D, 0, -Math.PI / 2],
      engage: [-D, 0, Math.PI / 2],
      insight: [0, -D, 0],
      operate: [D * 0.86, D * 0.86, Math.PI],
      admin: [-D * 0.86, D * 0.86, Math.PI],
      newtown: [D * 0.86, -D * 0.86, 0],
    };
    for (const [id, placed] of this.blocks) {
      const [x, z, rot] = spots[id];
      placed.pivot.visible = true;
      placed.pivot.scale.setScalar(id === "square" ? 1.1 : 0.9);
      placed.pivot.rotation.set(0, rot, 0);
      placed.pivot.position.set(x, 0, z);
    }
    const pos = (id: BoroughId) => this.blocks.get(id)!.pivot.position.clone().setY(0.6);
    const via = (a: Vector3, b: Vector3) => [
      a,
      a.clone().multiplyScalar(0.45),
      b.clone().multiplyScalar(0.45),
      b,
    ];
    this.flows.size.value = 1;
    this.flows.setPaths([
      { id: "credit", points: via(pos("rewards"), pos("personal")) },
      { id: "debit", points: via(pos("personal"), pos("rewards")) },
      { id: "award", points: via(pos("admin"), pos("rewards")) },
    ]);
    this.persp.aspect = aspect;
    this.applyVistaCamera();
  }

  /** The vista camera for the current heading and framing (fov 28°, tilt 55°; a borough at fov 32°, tilt 48°). */
  applyVistaCamera(): void {
    const cam = this.persp;
    const framedOn = this.framed ? this.blocks.get(this.framed)?.pivot.position : null;
    const target = framedOn ? framedOn.clone() : new Vector3(0, 0, 4);
    const tilt = ((framedOn ? 48 : 55) * Math.PI) / 180;
    const dist = framedOn ? 150 : 340;
    cam.fov = framedOn ? 32 : 28;
    const a = (this.heading * Math.PI) / 4;
    const horiz = Math.cos(tilt) * dist;
    cam.position.set(target.x + Math.sin(a) * horiz, Math.sin(tilt) * dist, target.z + Math.cos(a) * horiz);
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    cam.near = 5;
    cam.far = dist + 900;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /** Screen anchor (CSS px) above a block in the vista, for its plaque. */
  plaqueAnchor(id: BoroughId, W: number, H: number): { x: number; y: number; visible: boolean } {
    const placed = this.blocks.get(id);
    if (!placed) return { x: 0, y: 0, visible: false };
    const top = placed.pivot.position.clone().setY(placed.block.height * placed.pivot.scale.x + 4);
    const v = top.project(this.persp);
    return {
      x: (v.x * 0.5 + 0.5) * W,
      y: (1 - (v.y * 0.5 + 0.5)) * H,
      visible: v.z < 1 && Math.abs(v.x) < 1.1,
    };
  }

  get camera(): OrthographicCamera | PerspectiveCamera {
    return this.layout === "landing" ? this.ortho : this.persp;
  }
}
