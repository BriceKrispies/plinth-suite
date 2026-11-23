// A 2D scratch canvas that works without OffscreenCanvas (older iOS Safari, WebKit test engines): the same
// context API from a detached DOM canvas. Both flavours resolve the page's FontFace set the same way.

export type Canvas2D = HTMLCanvasElement | OffscreenCanvas;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Scratch {
  readonly canvas: Canvas2D;
  readonly ctx: Ctx2D;
}

export const makeCanvas = (width: number, height: number, readback = false): Scratch => {
  let canvas: Canvas2D;
  if (typeof OffscreenCanvas !== "undefined") canvas = new OffscreenCanvas(width, height);
  else {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    canvas = c;
  }
  const ctx = canvas.getContext("2d", readback ? { willReadFrequently: true } : undefined) as Ctx2D | null;
  if (!ctx) throw new Error("2D canvas unavailable");
  return { canvas, ctx };
};

/** letterSpacing is missing on some engines; assigning it there is a silent no-op, which the parity check catches. */
export const setLetterSpacing = (ctx: Ctx2D, px: number): void => {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
};
