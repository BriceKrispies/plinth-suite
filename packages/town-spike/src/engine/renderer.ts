// The renderer: WebGPURenderer on the WebGPU backend by default, three's WebGL2 backend with ?backend=webgl2.
//
// Colour policy (township.md R3.1 item 4, Orbit graft "UI text is never tonemapped"):
// - the renderer itself does no tone mapping and no output colour conversion (NoToneMapping + LinearSRGB output), so
//   everything drawn straight to the canvas (plaques, HUD, interior panes and text) is written as the sRGB values the
//   Plat tokens name, and alpha-blended in sRGB space like the browser blends its own text;
// - the lit city goes through the render pipeline, which applies ACES tone mapping and the sRGB transfer explicitly
//   with `renderOutput(...)`.

import {
  LinearSRGBColorSpace,
  NoToneMapping,
  PCFShadowMap,
  WebGPURenderer,
  type WebGPURendererParameters,
} from "./three";
import type { BackendRequest } from "./capability";

export interface BackendInfo {
  readonly requested: BackendRequest;
  readonly active: "webgpu" | "webgl2";
  readonly compatibilityMode: boolean | null;
  readonly timestamps: boolean;
  readonly adapter: Record<string, string> | null;
  readonly features: string[];
  readonly webglRenderer: string | null;
  readonly fallbackUsed: boolean;
}

interface BackendShape {
  isWebGPUBackend?: boolean;
  isWebGLBackend?: boolean;
  compatibilityMode?: boolean | null;
  trackTimestamp?: boolean;
  device?: GPUDevice;
  gl?: WebGL2RenderingContext;
}

export class Engine {
  readonly renderer: WebGPURenderer;
  readonly canvas: HTMLCanvasElement;
  private info: BackendInfo | null = null;

  private constructor(
    canvas: HTMLCanvasElement,
    readonly requested: BackendRequest,
  ) {
    this.canvas = canvas;
    const params: WebGPURendererParameters = {
      canvas,
      // No canvas MSAA. In r187 a fullscreen pass (RenderPipeline's quad, QuadMesh) always draws the canvas with
      // samples = 0 (Renderer.currentSamples), while ordinary renders draw into the persistent MSAA colour buffer
      // (loadOp "load", storeOp "store") and resolve over the canvas. With autoClear off for the overlay, the
      // WebGPU backend therefore loaded last frame's MSAA buffer (stale painted text) and resolved it over the
      // post-processed city: a black scene with ghost text. Nothing we draw to the canvas needs MSAA: the city's
      // geometry is rendered by the scene pass into its own target, and 2D layers are pixel-aligned.
      antialias: false,
      alpha: false,
      forceWebGL: requested === "webgl2",
      trackTimestamp: true,
      powerPreference: "high-performance",
    };
    this.renderer = new WebGPURenderer(params);
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // r187 removed PCFSoftShadowMap on WebGPURenderer (it warns and falls back); ask for PCF explicitly.
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setPixelRatio(this.pixelRatio());
    const { w, h } = this.cssSize();
    this.renderer.setSize(w, h, false);
  }

  /** Base renders at min(DPR, 2) (spec 00 section 0.6); Enhanced, which paints text, at the native DPR. */
  dprCap = 2;

  private pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.dprCap);
  }

  /**
   * The canvas's CSS size. The canvas is `position: fixed; height: 100lvh` (spec 00 section 0.2.1), so a mobile
   * toolbar collapsing changes neither its CSS size nor its backing store: read the element, not innerHeight.
   */
  cssSize(): { w: number; h: number } {
    const w = this.canvas.clientWidth || window.innerWidth || 1;
    const h = this.canvas.clientHeight || window.innerHeight || 1;
    return { w, h };
  }

  static async create(canvas: HTMLCanvasElement, requested: BackendRequest): Promise<Engine> {
    const engine = new Engine(canvas, requested);
    await engine.renderer.init();
    engine.info = engine.describe();
    return engine;
  }

  get backend(): BackendShape {
    return this.renderer.backend as unknown as BackendShape;
  }

  get isWebGPU(): boolean {
    return this.backend.isWebGPUBackend === true;
  }

  get timestamps(): boolean {
    return this.backend.trackTimestamp === true;
  }

  get dpr(): number {
    return this.renderer.getPixelRatio();
  }

  /**
   * Backing-store pixels per CSS px, as the canvas really has them. three floors width * pixelRatio, so at a
   * fractional DPR (2.625 on a 412 px phone: 1081.5 -> 1081) the real ratio is a hair under the nominal one. The
   * painter snaps to THIS grid so raster runs land on whole backing-store pixels and are sampled texel for texel.
   */
  get paintScale(): { x: number; y: number } {
    const { w, h } = this.cssSize();
    const x = this.canvas.width / w;
    const y = this.canvas.height / h;
    return { x: x > 0 ? x : this.dpr, y: y > 0 ? y : this.dpr };
  }

  /** Returns true when the backing store changed. */
  resize(): boolean {
    const before = `${this.canvas.width}x${this.canvas.height}`;
    this.renderer.setPixelRatio(this.pixelRatio());
    const { w, h } = this.cssSize();
    this.renderer.setSize(w, h, false);
    return before !== `${this.canvas.width}x${this.canvas.height}`;
  }

  backendInfo(): BackendInfo {
    return this.info ?? this.describe();
  }

  private describe(): BackendInfo {
    const b = this.backend;
    const active = b.isWebGPUBackend ? "webgpu" : "webgl2";
    let adapter: Record<string, string> | null = null;
    let features: string[] = [];
    let webglRenderer: string | null = null;
    if (b.isWebGPUBackend && b.device) {
      const ai = (b.device as GPUDevice & { adapterInfo?: GPUAdapterInfo }).adapterInfo;
      if (ai) {
        adapter = {
          vendor: ai.vendor,
          architecture: ai.architecture,
          device: ai.device,
          description: ai.description,
        };
      }
      features = [...b.device.features].map(String).sort();
    }
    if (b.gl) {
      const gl = b.gl;
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      webglRenderer = ext
        ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
        : String(gl.getParameter(gl.RENDERER));
      adapter = {
        vendor: ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR)),
        renderer: webglRenderer,
        version: String(gl.getParameter(gl.VERSION)),
      };
      features = (gl.getSupportedExtensions() ?? []).slice().sort();
    }
    return {
      requested: this.requested,
      active,
      compatibilityMode: b.compatibilityMode ?? null,
      timestamps: this.timestamps,
      adapter,
      features,
      webglRenderer,
      fallbackUsed: this.requested === "webgpu" && active !== "webgpu",
    };
  }
}
