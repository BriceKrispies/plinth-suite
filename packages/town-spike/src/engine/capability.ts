// Mode resolution at boot (spec 03 section 3.3 and 00 section 0.6, trimmed to what the prototype needs).
//
//   ?plain=1, ?render=plain or forced-colors: active -> "plain" (the Plat visible, no canvas is created)
//   ?backend=webgl2                                   -> GPU with three's WebGL2 backend (forceWebGL)
//   otherwise                                         -> GPU with the WebGPU backend, falling back to WebGL2
//
// Backend and tier are separate axes. The tier follows the pointer and the layout class (00 section 0.6.1): a
// coarse pointer or a compact or medium container starts at Base (hybrid text: all text is DOM text); an expanded
// container with a fine pointer starts at Enhanced (GPU-painted text with the parity fallback). `?tier=` pins one.
//
// Fault injection for C10(e): `?fail=init|warmup|text-surface|first-frame` makes that step throw; the app must end in
// Plain mode with its notice and no uncaught error.

export type RenderMode = "gpu" | "plain";
export type PlainReason = "param" | "forced-colors" | "no-gpu" | "init-failed" | null;
export type BackendRequest = "webgpu" | "webgl2";
export type Motion = "full" | "reduced" | "off";
export type Tier = "base" | "enhanced";
export type FailStep = "init" | "warmup" | "text-surface" | "first-frame";

export interface BootOptions {
  readonly mode: RenderMode;
  readonly plainReason: PlainReason;
  readonly backend: BackendRequest;
  readonly debugOverlay: boolean;
  readonly motion: Motion;
  readonly tierParam: Tier | null;
  readonly textParam: "gpu" | "dom" | null;
  readonly fail: FailStep | null;
  readonly test: boolean;
}

const forcedColorsQuery = "(forced-colors: active)";
export const MOTION_KEY = "plinth.town.motion";

export const forcedColorsActive = (): boolean => matchMedia(forcedColorsQuery).matches;
export const coarsePointer = (): boolean => matchMedia("(pointer: coarse)").matches;

const storedMotion = (): Motion | null => {
  try {
    const v = localStorage.getItem(MOTION_KEY);
    return v === "full" || v === "reduced" || v === "off" ? v : null;
  } catch {
    return null;
  }
};

export const storeMotion = (m: Motion): void => {
  try {
    localStorage.setItem(MOTION_KEY, m);
  } catch {
    // the choice lasts for this page view
  }
};

export const resolveBoot = (): BootOptions => {
  const q = new URLSearchParams(location.search);
  const forced = forcedColorsActive();
  const plainParam = q.get("plain") === "1" || q.get("render") === "plain";
  const mq = q.get("motion");
  // Spec 04 section 4.7: Reduced for every viewer until they choose otherwise, whatever the OS reports.
  const motion: Motion =
    mq === "full" || mq === "reduced" || mq === "off" ? mq : (storedMotion() ?? "reduced");
  const backend: BackendRequest = q.get("backend") === "webgl2" ? "webgl2" : "webgpu";
  let hasGpuApi = false;
  try {
    hasGpuApi = "gpu" in navigator || !!document.createElement("canvas").getContext("webgl2");
  } catch {
    hasGpuApi = false;
  }
  const plainReason: PlainReason = plainParam
    ? "param"
    : forced
      ? "forced-colors"
      : !hasGpuApi
        ? "no-gpu"
        : null;
  const tq = q.get("tier");
  const xq = q.get("text");
  const fq = q.get("fail");
  return {
    mode: plainReason ? "plain" : "gpu",
    plainReason,
    backend,
    debugOverlay: q.get("debug") === "overlay",
    motion,
    tierParam: tq === "base" || tq === "enhanced" ? tq : null,
    textParam: xq === "gpu" || xq === "dom" ? xq : null,
    fail: fq === "init" || fq === "warmup" || fq === "text-surface" || fq === "first-frame" ? fq : null,
    test: q.has("test"),
  };
};

/** Live changes to forced colours switch modes; the prototype reloads, which is the simplest honest answer. */
export const watchForcedColors = (onChange: () => void): void => {
  matchMedia(forcedColorsQuery).addEventListener("change", onChange);
};
