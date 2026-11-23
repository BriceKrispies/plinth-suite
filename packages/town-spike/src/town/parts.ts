// Procedural model parts merged into a few meshes per model (spec 01 section 1.7: the kit is code, deterministic).
//
// A recipe adds unit primitives (box, gable, pyramid, dome, drum, cone, window) with a transform and a colour. `build`
// merges them by material into at most three meshes (card with vertex colours, brass, lit windows), so a whole
// borough block is three draw calls whatever its detail. The geometry is the same for the landing tile, the vista and
// a street band: only where the group stands, how it is turned (multiples of 90°) and the camera differ.

import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
} from "../engine/three";
import { gableGeometry, makeBrassMaterial, makeCardMaterial, makeWindowMaterial, toneColor } from "./kit";

export type Prim = "box" | "gable" | "pyramid" | "dome" | "drum" | "cone" | "window";
export type Mat = "card" | "brass" | "window";

const up = new Vector3(0, 1, 0);

let templates: Record<Prim, BufferGeometry> | null = null;
const template = (p: Prim): BufferGeometry => {
  templates ??= {
    box: new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    gable: gableGeometry(),
    pyramid: new ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0),
    dome: new SphereGeometry(0.5, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    drum: new CylinderGeometry(0.5, 0.5, 1, 18).translate(0, 0.5, 0),
    cone: new ConeGeometry(0.5, 1, 7).translate(0, 0.5, 0),
    // A window pane facing +z, its bottom edge on y = 0.
    window: new PlaneGeometry(1, 1).translate(0, 0.5, 0),
  };
  return templates[p];
};

let materials: Record<Mat, Material> | null = null;
/** One material per kind for the whole app: every model shares the compiled pipelines. */
export const sharedMaterials = (): Record<Mat, Material> => {
  if (!materials) {
    const card = makeCardMaterial();
    card.vertexColors = true;
    const brass = makeBrassMaterial();
    brass.vertexColors = true;
    materials = { card, brass, window: makeWindowMaterial() };
  }
  return materials;
};

interface Part {
  prim: Prim;
  mat: Mat;
  m: Matrix4;
  c: Color;
  tag: string | null;
}

export class Parts {
  private readonly parts: Part[] = [];
  /** World bounds per tag (a building id), in the parts' own frame. */
  readonly bounds = new Map<string, Box3>();
  tag: string | null = null;

  add(prim: Prim, pos: Vector3, scale: Vector3, color: Color | string | number, rotY = 0, mat?: Mat): this {
    const m = new Matrix4().compose(pos, new Quaternion().setFromAxisAngle(up, rotY), scale);
    const c =
      color instanceof Color ? color : typeof color === "number" ? toneColor(color) : new Color(color);
    const kind: Mat = mat ?? (prim === "window" ? "window" : prim === "dome" ? "brass" : "card");
    this.parts.push({ prim, mat: kind, m, c, tag: this.tag });
    if (this.tag) {
      const g = template(prim);
      g.computeBoundingBox();
      const bb = g.boundingBox!.clone().applyMatrix4(m);
      const cur = this.bounds.get(this.tag);
      if (cur) cur.union(bb);
      else this.bounds.set(this.tag, bb);
    }
    return this;
  }

  /** Box helper with x, z centre and the base at y. */
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: Color | string | number,
  ): this {
    return this.add("box", new Vector3(x, y, z), new Vector3(w, h, d), color);
  }

  /** A row of lit windows across a facade facing +z at depth z: light means a widget exists (spec 01 rule 3). */
  windows(cx: number, y: number, z: number, width: number, count: number, w = 1.1, h = 1.5): this {
    for (let i = 0; i < count; i++) {
      const x = cx - width / 2 + (width * (i + 0.5)) / count;
      this.add("window", new Vector3(x, y, z + 0.03), new Vector3(w, h, 1), "#ffc977");
    }
    return this;
  }

  /** Copy another set's parts (and tagged bounds) into this one, moved by `offset`. */
  absorb(other: Parts, offset: Vector3): this {
    const t = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    for (const part of other.parts) this.parts.push({ ...part, m: t.clone().multiply(part.m) });
    for (const [tag, bb] of other.bounds) {
      const moved = bb.clone().translate(offset);
      const cur = this.bounds.get(tag);
      if (cur) cur.union(moved);
      else this.bounds.set(tag, moved);
    }
    return this;
  }

  get count(): number {
    return this.parts.length;
  }

  build(name: string): Group {
    const group = new Group();
    group.name = name;
    const mats = sharedMaterials();
    for (const kind of ["card", "brass", "window"] as const) {
      const list = this.parts.filter((p) => p.mat === kind);
      if (list.length === 0) continue;
      const geo = merge(list);
      const mesh = new Mesh(geo, mats[kind]);
      mesh.name = `${name}-${kind}`;
      mesh.castShadow = kind !== "window";
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

const merge = (list: Part[]): BufferGeometry => {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const nm = new Matrix4();
  const v = new Vector3();
  for (const p of list) {
    const g = template(p.prim);
    const flat = g.index ? g.toNonIndexed() : g;
    const P = flat.getAttribute("position");
    const N = flat.getAttribute("normal");
    nm.copy(p.m).invert().transpose();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(p.m);
      pos.push(v.x, v.y, v.z);
      if (N) {
        v.fromBufferAttribute(N, i).transformDirection(nm);
        nor.push(v.x, v.y, v.z);
      } else nor.push(0, 1, 0);
      col.push(p.c.r, p.c.g, p.c.b);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  geo.setAttribute("color", new Float32BufferAttribute(col, 3));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
};
