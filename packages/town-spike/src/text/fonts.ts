// Same font, same metrics (township.md R3.1 item 1). The faces themselves are registered by text/font-faces.ts,
// which only the GPU-text tier loads (phones use the system UI font and never download them). The Plat and the text engine use the same FontFace objects:
// fontsource's @font-face rules load into document.fonts, and canvases created on the main thread (OffscreenCanvas
// included) resolve families from that same set.

import { makeCanvas, type Ctx2D } from "./canvas";

export const UI_FAMILY = '"Inter Variable"';
export const MONO_FAMILY = '"JetBrains Mono"';

/** The resolved font of a text leaf, as the canvas needs it. */
export interface FontSpec {
  readonly font: string; // canvas `font` shorthand: style weight size family
  readonly size: number; // CSS px
  readonly lineHeight: number; // CSS px
  readonly letterSpacing: number; // CSS px
  readonly key: string;
}

export const fontSpecOf = (cs: CSSStyleDeclaration): FontSpec => {
  const size = parseFloat(cs.fontSize) || 13;
  const lh = cs.lineHeight === "normal" ? size * 1.2 : parseFloat(cs.lineHeight);
  const ls = cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing) || 0;
  const font = `${cs.fontStyle === "italic" ? "italic " : ""}${cs.fontWeight} ${size}px ${cs.fontFamily}`;
  return { font, size, lineHeight: lh, letterSpacing: ls, key: `${font}|${ls}` };
};

/**
 * True when the canvas really measures with the web font and not a fallback. The harness reports it, because every
 * alignment number is meaningless if the canvas fell back to a system face.
 */
export const fontsResolveInCanvas = (): boolean => {
  let c: Ctx2D;
  try {
    c = makeCanvas(8, 8).ctx;
  } catch {
    return false;
  }
  const sample = "Statement 1,234 Wwwiii";
  c.font = `400 20px ${UI_FAMILY}, monospace`;
  const a = c.measureText(sample).width;
  c.font = "400 20px monospace";
  const b = c.measureText(sample).width;
  return Math.abs(a - b) > 1 && document.fonts.check(`400 20px ${UI_FAMILY}`);
};
