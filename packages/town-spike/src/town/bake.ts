// Render to texture once, then show it as an image (spec 01 section 1.4.3, "bands scroll with the page, as
// images"). A bake renders a scene into a half-float target, applies ACES and the sRGB transfer with renderOutput into
// an RGBA8 target, reads the pixels back and returns them as ImageData for a <canvas> element inside the scroller.
// The compositor then scrolls the image with its DOM links at any refresh rate, with no canvas frame per scroll.
//
// Bakes are queued and run one per animation-loop frame (at most one band re-baked per frame, TWN-R-1.4.7).
// Readback orientation: WebGPU textures are top-down; the WebGL2 backend's targets are bottom-up, so rows are
// flipped there.

import {
  ACESFilmicToneMapping,
  Color,
  HalfFloatType,
  MeshBasicNodeMaterial,
  QuadMesh,
  RenderTarget,
  SRGBColorSpace,
  TSL,
  type Camera,
  type Scene,
  type WebGPURenderer,
} from "../engine/three";

const { renderOutput, texture, vec4 } = TSL;

interface Job {
  readonly scene: Scene;
  readonly camera: Camera;
  readonly width: number;
  readonly height: number;
  readonly resolve: (img: ImageData | null) => void;
}

export interface BakeStats {
  bakes: number;
  queued: number;
  lastMs: number;
  maxMs: number;
  failures: number;
}

export class Baker {
  private readonly hdr = new RenderTarget(4, 4, { type: HalfFloatType, depthBuffer: true });
  private readonly out = new RenderTarget(4, 4, { depthBuffer: false });
  private readonly quad: QuadMesh;
  private readonly queue: Job[] = [];
  readonly stats: BakeStats = { bakes: 0, queued: 0, lastMs: 0, maxMs: 0, failures: 0 };

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly topDown: boolean,
  ) {
    this.hdr.texture.name = "bake-hdr";
    this.out.texture.name = "bake-out";
    const m = new MeshBasicNodeMaterial();
    m.name = "bake-output";
    m.depthTest = false;
    m.depthWrite = false;
    const c = texture(this.hdr.texture);
    m.colorNode = renderOutput(vec4(c.rgb, 1), ACESFilmicToneMapping, SRGBColorSpace);
    this.quad = new QuadMesh(m);
  }

  /** Queue a bake of `scene` through `camera` at width × height device pixels. */
  bake(scene: Scene, camera: Camera, width: number, height: number): Promise<ImageData | null> {
    return new Promise((resolve) => {
      this.queue.push({
        scene,
        camera,
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
        resolve,
      });
      this.stats.queued = this.queue.length;
    });
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Run at most one queued bake. Call from the animation loop. Returns true when a bake ran. */
  step(clear: Color): boolean {
    const job = this.queue.shift();
    this.stats.queued = this.queue.length;
    if (!job) return false;
    const r = this.renderer;
    const t0 = performance.now();
    try {
      this.hdr.setSize(job.width, job.height);
      this.out.setSize(job.width, job.height);
      const prevClear = new Color();
      r.getClearColor(prevClear);
      const prevAlpha = r.getClearAlpha();
      r.setClearColor(clear, 1);
      r.setRenderTarget(this.hdr);
      r.clear();
      r.render(job.scene, job.camera);
      r.setRenderTarget(this.out);
      this.quad.render(r);
      r.setRenderTarget(null);
      r.setClearColor(prevClear, prevAlpha);
    } catch (e) {
      r.setRenderTarget(null);
      this.stats.failures++;
      console.error(e);
      job.resolve(null);
      return true;
    }
    const ms = performance.now() - t0;
    this.stats.bakes++;
    this.stats.lastMs = ms;
    this.stats.maxMs = Math.max(this.stats.maxMs, ms);
    const { width: w, height: h } = job;
    void r
      .readRenderTargetPixelsAsync(this.out, 0, 0, w, h)
      .then((buf) => {
        const src = new Uint8Array(buf.buffer, buf.byteOffset, w * h * 4);
        const img = new ImageData(w, h);
        if (this.topDown) img.data.set(src);
        else
          for (let y = 0; y < h; y++)
            img.data.set(src.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        job.resolve(img);
      })
      .catch((e: unknown) => {
        this.stats.failures++;
        console.error(e);
        job.resolve(null);
      });
    return true;
  }
}

export { paintImage } from "./paint-image";
