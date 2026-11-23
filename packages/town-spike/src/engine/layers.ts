// TSL materials for the 2D layers. One source compiles to WGSL on WebGPU and GLSL ES 3.0 on WebGL2.
//
// Every layer draws instanced quads whose instance attributes are in CSS px (see quads.ts). Clipping to the nearest
// Plat scroller or cell is done per fragment with a varying pixel position, so no derivatives and no discard are
// needed (both backends, uniform control flow).

import { DoubleSide, MeshBasicNodeMaterial, NormalBlending, TSL, type Node, type Texture } from "./three";

const {
  attribute,
  clamp,
  float,
  length,
  max,
  min,
  mix,
  positionGeometry,
  smoothstep,
  step,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
  abs,
} = TSL;

const baseMaterial = (name: string): MeshBasicNodeMaterial => {
  const m = new MeshBasicNodeMaterial();
  m.name = name;
  m.transparent = true;
  m.depthTest = false;
  m.depthWrite = false;
  m.side = DoubleSide;
  m.blending = NormalBlending;
  return m;
};

/** Pixel position of the quad corner, plus the varying the fragment stage uses for clipping. */
type V2 = Node<"vec2">;
type V4 = Node<"vec4">;

const quadPosition = (rect: V4, pad: Node<"float"> | number): V2 => {
  const corner = positionGeometry.xy;
  const p = vec2(pad, pad);
  const px = rect.xy.sub(p).add(corner.mul(rect.zw.add(p.mul(2))));
  return px;
};

const clipFactor = (pix: V2, clip: V4) =>
  step(clip.x, pix.x).mul(step(pix.x, clip.z)).mul(step(clip.y, pix.y)).mul(step(pix.y, clip.w));

/** Global opacity of a whole layer (transitions and the reduced-motion crossfade). */
export interface LayerUniforms {
  readonly opacity: { value: number };
}

/**
 * Surfaces: rounded rectangles with a fill, an inside border and an analytic soft shadow.
 * aRect (x, y, w, h), aFill rgba, aBorder rgba, aParam (radius, borderWidth, shadow, 0), aClip (x0, y0, x1, y1).
 */
export const makeSurfaceMaterial = (): { material: MeshBasicNodeMaterial; uniforms: LayerUniforms } => {
  const opacity = uniform(1);
  const m = baseMaterial("plat-surfaces");
  const rect = attribute("aRect", "vec4");
  const param = attribute("aParam", "vec4");
  const shadowPad = param.z.mul(2).add(1);
  const px = quadPosition(rect, shadowPad);
  m.positionNode = vec3(px.x, px.y.negate(), 0);
  const vPix = varying(px);
  const vRect = varying(rect);
  const vFill = varying(attribute("aFill", "vec4"));
  const vBorder = varying(attribute("aBorder", "vec4"));
  const vParam = varying(param);
  const vClip = varying(attribute("aClip", "vec4"));

  const half = vRect.zw.mul(0.5);
  const centre = vRect.xy.add(half);
  const radius = min(vParam.x, min(half.x, half.y));
  const sdf = (p: V2) => {
    const q = abs(p).sub(half).add(radius);
    return length(max(q, vec2(0, 0)))
      .add(min(max(q.x, q.y), 0))
      .sub(radius);
  };
  const d = sdf(vPix.sub(centre));
  const fillA = clamp(float(0.5).sub(d), 0, 1).mul(vFill.w);
  const inner = clamp(float(0.5).sub(d.add(vParam.y)), 0, 1);
  const borderA = clamp(float(0.5).sub(d), 0, 1).sub(inner).mul(vBorder.w).mul(step(0.001, vParam.y));
  const a = borderA.add(fillA.mul(float(1).sub(borderA)));
  const rgb = vBorder.xyz
    .mul(borderA)
    .add(vFill.xyz.mul(fillA).mul(float(1).sub(borderA)))
    .div(max(a, 0.0001));
  const sh = vParam.z;
  const dS = sdf(vPix.sub(centre).sub(vec2(0, sh.mul(0.5))));
  const shadowA = float(1)
    .sub(smoothstep(sh.negate(), sh, dS))
    .mul(0.16)
    .mul(step(0.001, sh))
    .mul(float(1).sub(a));
  const total = a.add(shadowA);
  const outRgb = rgb.mul(a).div(max(total, 0.0001));
  m.colorNode = vec4(outRgb, total.mul(clipFactor(vPix, vClip)).mul(opacity));
  return { material: m, uniforms: { opacity } };
};

/**
 * Glyph quads sampling an R8 atlas. `coverage` mode is the raster-run path (the texel is the browser's coverage);
 * `sdf` mode is the tiny-sdf path. aRect (x, y, w, h), aUV (u0, v0, u1, v1), aColor rgba, aClip, aSoft (per-instance
 * distance units per screen px, sdf only, in x).
 */
export const makeGlyphMaterial = (
  atlas: Texture,
  mode: "coverage" | "sdf",
  edge: number,
): { material: MeshBasicNodeMaterial; uniforms: LayerUniforms } => {
  const opacity = uniform(1);
  const m = baseMaterial(mode === "coverage" ? "plat-raster-runs" : "plat-sdf-glyphs");
  const rect = attribute("aRect", "vec4");
  const uvr = attribute("aUV", "vec4");
  const px = quadPosition(rect, 0);
  m.positionNode = vec3(px.x, px.y.negate(), 0);
  const vPix = varying(px);
  const vUV = varying(mix(uvr.xy, uvr.zw, positionGeometry.xy));
  const vColor = varying(attribute("aColor", "vec4"));
  const vClip = varying(attribute("aClip", "vec4"));
  const vSoft = varying(attribute("aSoft", "vec4"));
  const t = texture(atlas, vUV).r;
  const cover = mode === "coverage" ? t : clamp(t.sub(edge).div(max(vSoft.x, 0.0001)).add(0.5), 0, 1);
  m.colorNode = vec4(vColor.xyz, vColor.w.mul(cover).mul(clipFactor(vPix, vClip)).mul(opacity));
  return { material: m, uniforms: { opacity } };
};

/** A full-screen blit of a cached texture (the interior backdrop). */
export const makeBlitMaterial = (tex: Texture): MeshBasicNodeMaterial => {
  const m = new MeshBasicNodeMaterial();
  m.name = "backdrop-blit";
  m.depthTest = false;
  m.depthWrite = false;
  m.colorNode = texture(tex, TSL.screenUV);
  return m;
};
