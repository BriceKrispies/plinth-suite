// The city frame graph (township.md S.1 passes 2, 4, 5, 6): scene pass with an MRT (output + emissive), bloom from
// the emissive target, tilt-shift depth of field (S.4), the interior backdrop (S.1 B), then ACES tone mapping and
// the sRGB transfer done explicitly with renderOutput. Plaques, the HUD and all text are drawn after this, straight
// to the canvas, so text is never blurred, bloomed or tone-mapped.
//
// three r187: `PostProcessing` is deprecated (since r183) in favour of `RenderPipeline`; the spike uses the new name.
//
// Tilt-shift here is two Gaussian levels at half resolution mixed by a circle of confusion built from the screen
// band and view depth (S.4's CoC), rather than S.4's 13-tap variable-radius gather. SPIKE.md lists the deviation.

import {
  ACESFilmicToneMapping,
  RenderPipeline,
  SRGBColorSpace,
  TSL,
  bloom,
  gaussianBlur,
  type Camera,
  type Scene,
  type WebGPURenderer,
} from "./three";

const {
  abs,
  clamp,
  emissive,
  float,
  max,
  mix,
  mrt,
  output,
  pass,
  renderOutput,
  saturation,
  screenUV,
  smoothstep,
  uniform,
  vec3,
  vec4,
} = TSL;

export interface CityPost {
  readonly pipeline: RenderPipeline;
  readonly u: {
    focusY: { value: number };
    bandHalf: { value: number };
    falloff: { value: number };
    focusZ: { value: number };
    focusRange: { value: number };
    depthMix: { value: number };
    cocScale: { value: number };
    smallRadius: { value: number };
    largeRadius: { value: number };
    backdrop: { value: number };
    bloomStrength: { value: number };
  };
  setCamera(camera: Camera): void;
  readonly effects: string[];
}

export const makeCityPost = (renderer: WebGPURenderer, scene: Scene, camera: Camera): CityPost => {
  const u = {
    focusY: uniform(0.52),
    bandHalf: uniform(0.12),
    falloff: uniform(0.26),
    focusZ: uniform(-300),
    focusRange: uniform(140),
    depthMix: uniform(0.6),
    cocScale: uniform(1),
    smallRadius: uniform(1.4),
    largeRadius: uniform(2.6),
    backdrop: uniform(0),
    bloomStrength: uniform(0.65),
  };
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, emissive }));
  const color = scenePass.getTextureNode("output");
  const emissiveTex = scenePass.getTextureNode("emissive");
  const viewZ = scenePass.getViewZNode();

  const blurSmall = gaussianBlur(color, u.smallRadius, 3, { resolutionScale: 0.5 });
  const blurLarge = gaussianBlur(color, u.largeRadius, 5, { resolutionScale: 0.5 });

  const band = clamp(abs(screenUV.y.sub(u.focusY)).sub(u.bandHalf).div(u.falloff), 0, 1);
  const dz = clamp(abs(viewZ.sub(u.focusZ)).div(u.focusRange), 0, 1);
  const coc = clamp(mix(band, max(band, dz), u.depthMix).mul(u.cocScale), 0, 1);
  const k1 = smoothstep(0.05, 0.45, coc);
  const k2 = smoothstep(0.45, 1.0, coc);
  const dof = mix(mix(color.rgb, blurSmall.rgb, k1), blurLarge.rgb, k2);
  const graded = saturation(dof, mix(float(1.08), float(1.0), k1));

  const glow = bloom(emissiveTex, u.bloomStrength, 0.45, 0.0);
  const hdr = graded.add(glow.rgb);

  // Interior backdrop: the city, heavily blurred and dimmed toward the paper tone (S.1 B).
  const paper = vec3(0.86, 0.82, 0.75);
  const back = mix(blurLarge.rgb, paper, 0.35).mul(0.78);
  const final = mix(hdr, back, u.backdrop);

  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  pipeline.outputNode = renderOutput(vec4(final, 1), ACESFilmicToneMapping, SRGBColorSpace);

  return {
    pipeline,
    u,
    setCamera(cam: Camera) {
      scenePass.camera = cam;
    },
    effects: [
      "mrt(output,emissive)",
      "shadows(PCF 2048)",
      "tilt-shift(band+depth, 2 gaussian levels)",
      "bloom(emissive)",
      "aces+srgb(renderOutput)",
      "flows(textureLoad RGBA32F)",
    ],
  };
};
