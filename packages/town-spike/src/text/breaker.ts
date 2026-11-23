// Measure and break (township.md R3.1 steps 2 to 4): Intl.Segmenter boundaries, OffscreenCanvas measureText with the
// same font string as the Plat, and greedy breaking to the Plat box width.

import type { FontSpec } from "./fonts";
import { makeCanvas, setLetterSpacing, type Ctx2D } from "./canvas";

export interface Line {
  readonly start: number; // offset of the first character in the text node
  readonly end: number; // exclusive end, trailing spaces excluded
  readonly text: string;
  readonly width: number; // CSS px, measured
}

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯぀-ヿ]/;
const SPACE = /\s/;

export class Measurer {
  private readonly ctx: Ctx2D;
  private current = "";
  private readonly cache = new Map<string, number>();
  private metricsCache = new Map<string, { ascent: number; descent: number }>();

  constructor() {
    this.ctx = makeCanvas(16, 16).ctx;
  }

  private use(spec: FontSpec): void {
    if (this.current === spec.key) return;
    this.ctx.font = spec.font;
    setLetterSpacing(this.ctx, spec.letterSpacing);
    this.current = spec.key;
  }

  width(spec: FontSpec, text: string): number {
    if (text.length === 0) return 0;
    const key = `${spec.key}|${text}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    this.use(spec);
    const w = this.ctx.measureText(text).width;
    if (this.cache.size > 200_000) this.cache.clear();
    this.cache.set(key, w);
    return w;
  }

  /** The font's ascent and descent as the browser uses them for the inline content area. */
  metrics(spec: FontSpec): { ascent: number; descent: number } {
    const hit = this.metricsCache.get(spec.key);
    if (hit) return hit;
    this.use(spec);
    const m = this.ctx.measureText("Hg");
    const out = { ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
    this.metricsCache.set(spec.key, out);
    return out;
  }
}

const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });
const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

export const graphemes = (text: string): string[] =>
  Array.from(graphemeSegmenter.segment(text), (s) => s.segment);

/** Offsets where a line may start (always includes 0). */
export const breakOpportunities = (text: string): number[] => {
  const out = new Set<number>([0]);
  for (const seg of wordSegmenter.segment(text)) {
    const i = seg.index;
    if (i === 0) continue;
    const prev = text[i - 1] ?? "";
    const ch = text[i] ?? "";
    if (SPACE.test(ch)) continue; // never start a line on a space
    if (SPACE.test(prev)) out.add(i);
    else if (prev === "-" && /\p{L}/u.test(ch) && i >= 2 && /\p{L}/u.test(text[i - 2] ?? "")) out.add(i);
    else if (CJK.test(ch) || CJK.test(prev)) out.add(i);
  }
  // CJK runs inside one "word" segment: every ideograph is an opportunity.
  for (let i = 1; i < text.length; i++) {
    if (CJK.test(text[i] ?? "") && !SPACE.test(text[i] ?? "")) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
};

const trimEnd = (text: string, start: number, end: number): number => {
  let e = end;
  while (e > start && SPACE.test(text[e - 1] ?? "")) e--;
  return e;
};

/** Greedy line breaking, as the browser does for `white-space: normal; overflow-wrap: normal`. */
export const breakLines = (
  m: Measurer,
  spec: FontSpec,
  text: string,
  maxWidth: number,
  wrap: boolean,
): Line[] => {
  if (!wrap) {
    const end = trimEnd(text, 0, text.length);
    return [{ start: 0, end, text: text.slice(0, end), width: m.width(spec, text.slice(0, end)) }];
  }
  const ops = breakOpportunities(text);
  ops.push(text.length);
  const lines: Line[] = [];
  let lineStart = 0;
  let lastFit = -1; // index into ops of the last opportunity that still fits
  let k = 1;
  const tolerance = 0.02; // layout units are 1/64 px; avoid flipping on rounding
  while (k < ops.length) {
    const candEnd = trimEnd(text, lineStart, ops[k] ?? text.length);
    const w = m.width(spec, text.slice(lineStart, candEnd));
    if (w <= maxWidth + tolerance) {
      lastFit = k;
      k++;
      continue;
    }
    if (lastFit < 0) {
      // A single unbreakable word wider than the box overflows on its own line.
      lines.push({ start: lineStart, end: candEnd, text: text.slice(lineStart, candEnd), width: w });
      lineStart = ops[k] ?? text.length;
      k++;
      continue;
    }
    const e = trimEnd(text, lineStart, ops[lastFit] ?? text.length);
    lines.push({
      start: lineStart,
      end: e,
      text: text.slice(lineStart, e),
      width: m.width(spec, text.slice(lineStart, e)),
    });
    lineStart = ops[lastFit] ?? text.length;
    lastFit = -1;
  }
  if (lineStart < text.length) {
    const e = trimEnd(text, lineStart, text.length);
    if (e > lineStart)
      lines.push({
        start: lineStart,
        end: e,
        text: text.slice(lineStart, e),
        width: m.width(spec, text.slice(lineStart, e)),
      });
  }
  if (lines.length === 0) lines.push({ start: 0, end: 0, text: "", width: 0 });
  return lines;
};
