// Flows on real streets (township.md S.5; on the landing, streaks between tiles, spec 01 section 1.4.2): a PathTable (RGBA32F DataTexture, 64 arc-length samples per row) and a
// ring of instanced camera-facing dots whose positions are analytic in the vertex shader. No compute, so the WebGL2
// backend runs the same code; this is also the spike's RGBA32F `textureLoad`-in-a-vertex-shader portability check.
//
// Honesty rule (1.2 rule 2): the dots replay the viewer's 12 most recent real statement lines, credits from the
// Bank to the viewer's house and debits from the house to the Market. Live rt frames are out of the spike's scope.

import {
  AdditiveBlending,
  BufferAttribute,
  DataTexture,
  FloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  RGBAFormat,
  TSL,
  type Vector3,
} from "../engine/three";
import type { StatementLine } from "../interior/api";

const {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  exp,
  float,
  floor,
  fract,
  int,
  ivec2,
  min,
  mix,
  mod,
  positionGeometry,
  select,
  sin,
  textureLoad,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
  dot,
  normalize,
  cross,
  mrt,
} = TSL;

export const SAMPLES = 64;
export const REPLAY_PERIOD = 14; // seconds

const resample = (pts: Vector3[]): Float32Array => {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
  const total = cum[cum.length - 1]! || 1;
  const out = new Float32Array(SAMPLES * 4);
  let seg = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const d = (s / (SAMPLES - 1)) * total;
    while (seg < pts.length - 2 && cum[seg + 1]! < d) seg++;
    const a = pts[seg]!;
    const b = pts[seg + 1] ?? a;
    const span = cum[seg + 1]! - cum[seg]! || 1;
    const t = Math.min(1, Math.max(0, (d - cum[seg]!) / span));
    out[s * 4] = a.x + (b.x - a.x) * t;
    out[s * 4 + 1] = a.y + (b.y - a.y) * t;
    out[s * 4 + 2] = a.z + (b.z - a.z) * t;
    out[s * 4 + 3] = d / total;
  }
  return out;
};

export interface Flows {
  readonly mesh: Mesh;
  readonly time: { value: number };
  /** Dot radius multiplier (world units differ between the landing and the vista). */
  readonly size: { value: number };
  readonly count: number;
  /** Move the streets the flows run on (a layout change): rewrites the path table and the path lengths. */
  setPaths(paths: { id: string; points: Vector3[] }[]): void;
}

export const buildFlows = (paths: { id: string; points: Vector3[] }[], recent: StatementLine[]): Flows => {
  // PathTable
  const rows = paths.length;
  const data = new Float32Array(SAMPLES * rows * 4);
  const lengths: number[] = [];
  paths.forEach((p, r) => {
    data.set(resample(p.points), r * SAMPLES * 4);
    let len = 0;
    for (let i = 1; i < p.points.length; i++) len += p.points[i]!.distanceTo(p.points[i - 1]!);
    lengths.push(len);
  });
  const pathTex = new DataTexture(data, SAMPLES, Math.max(1, rows), RGBAFormat, FloatType);
  pathTex.magFilter = NearestFilter;
  pathTex.minFilter = NearestFilter;
  pathTex.generateMipmaps = false;
  pathTex.needsUpdate = true;

  // Spawn: one burst per real statement line. Credits ride the Bank-to-home path, debits home-to-market, and
  // awards (credits of type "award") come from the Town Hall.
  type Inst = {
    path: number;
    t0: number;
    speed: number;
    len: number;
    seed: number;
    tone: [number, number, number, number];
    size: number;
  };
  const insts: Inst[] = [];
  const credit: [number, number, number, number] = [0.45, 1.0, 0.62, 1];
  const debit: [number, number, number, number] = [1.0, 0.55, 0.4, 1];
  recent.slice(0, 12).forEach((l, k) => {
    const path = l.amount >= 0 ? (l.txn_type === "award" ? 2 : 0) : 1;
    const n = Math.max(3, Math.min(16, Math.round(Math.abs(l.amount) / 50)));
    for (let i = 0; i < n; i++)
      insts.push({
        path,
        t0: k * (REPLAY_PERIOD / 12),
        speed: l.amount >= 0 ? 38 : 30,
        len: lengths[path] ?? 100,
        seed: i / n,
        tone: l.amount >= 0 ? credit : debit,
        size: 0.55,
      });
  });
  const count = Math.max(1, insts.length);
  const geo = new InstancedBufferGeometry();
  geo.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3),
  );
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  const a = new Float32Array(count * 4); // path, t0, speed, len
  const b = new Float32Array(count * 4); // seed, size, 0, 0
  const c = new Float32Array(count * 4); // tone
  insts.forEach((it, i) => {
    a.set([it.path, it.t0, it.speed, it.len], i * 4);
    b.set([it.seed, it.size, 0, 0], i * 4);
    c.set(it.tone, i * 4);
  });
  geo.setAttribute("aFlowA", new InstancedBufferAttribute(a, 4));
  geo.setAttribute("aFlowB", new InstancedBufferAttribute(b, 4));
  geo.setAttribute("aTone", new InstancedBufferAttribute(c, 4));
  geo.instanceCount = insts.length;

  const uTime = uniform(0);
  const uSize = uniform(1);
  const fa = attribute("aFlowA", "vec4");
  const fb = attribute("aFlowB", "vec4");
  const local = mod(uTime.sub(fa.y), float(REPLAY_PERIOD));
  const s = local.mul(fa.z).div(fa.w).sub(fb.x.mul(0.12));
  const alive = s.greaterThanEqual(0).and(s.lessThanEqual(1));
  const fx = clamp(s, 0, 1).mul(SAMPLES - 1);
  const i0 = floor(fx);
  const f = fract(fx);
  const row = int(fa.x);
  const p0 = textureLoad(pathTex, ivec2(int(i0), row)).xyz;
  const p1 = textureLoad(pathTex, ivec2(int(min(i0.add(1), SAMPLES - 1)), row)).xyz;
  const tangent = normalize(p1.sub(p0).add(vec3(0.0001, 0, 0)));
  const side = normalize(cross(tangent, vec3(0, 1, 0)));
  const lane = fb.x.sub(0.5).mul(1.6);
  const hop = sin(clamp(s, 0, 1).mul(Math.PI)).mul(0.5);
  const centre = mix(p0, p1, f)
    .add(side.mul(lane))
    .add(vec3(0, hop.add(0.9), 0));
  const viewCentre = cameraViewMatrix.mul(vec4(centre, 1));
  const corner = positionGeometry.xy;
  const offset = corner.mul(fb.y.mul(uSize));
  const clip = cameraProjectionMatrix.mul(viewCentre.add(vec4(offset, 0, 0)));
  const mat = new MeshBasicNodeMaterial();
  mat.name = "flows";
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = AdditiveBlending;
  mat.vertexNode = select(alive, clip, vec4(0, 0, 2, 1));
  const q = varying(corner as unknown as ReturnType<typeof vec2>);
  const core = exp(dot(q, q).mul(-3.5));
  const vTone = varying(attribute("aTone", "vec4"));
  mat.colorNode = vec4(vTone.xyz.mul(1.6), core);
  // Write the emissive MRT target explicitly (a basic material has no emissive of its own), so the dots bloom.
  mat.mrtNode = mrt({ emissive: vec4(vTone.xyz.mul(core).mul(1.2), core) });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = "flows";
  mesh.renderOrder = 5;
  const aAttr = geo.getAttribute("aFlowA") as InstancedBufferAttribute;
  const setPaths = (next: { id: string; points: Vector3[] }[]) => {
    const lens: number[] = [];
    next.slice(0, rows).forEach((p, r) => {
      data.set(resample(p.points), r * SAMPLES * 4);
      let len = 0;
      for (let i = 1; i < p.points.length; i++) len += p.points[i]!.distanceTo(p.points[i - 1]!);
      lens.push(len);
    });
    pathTex.needsUpdate = true;
    insts.forEach((it, i) => {
      a[i * 4 + 3] = lens[it.path] ?? it.len;
    });
    aAttr.needsUpdate = true;
  };
  return { mesh, time: uTime, size: uSize, count: insts.length, setPaths };
};
