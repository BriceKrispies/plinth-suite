// Lay out one Plat text leaf from its measured rect (township.md R3.1, R9.4 READ then BUILD).
//
// Input: the leaf's border box from getBoundingClientRect, and its computed style (read once per element). Output:
// lines with pen origin and baseline in viewport CSS px. Line breaking and advances are ours (breaker.ts). The
// browser's line boxes are NOT read here; the harness reads them separately to check us.

import { breakLines, type Line, type Measurer } from "./breaker";
import { fontSpecOf, type FontSpec } from "./fonts";

export interface LeafStyle {
  readonly spec: FontSpec;
  readonly family: string;
  readonly weight: string;
  readonly fontStyle: string;
  readonly insetL: number;
  readonly insetT: number;
  readonly insetR: number;
  readonly insetB: number;
  readonly align: "left" | "right" | "center";
  readonly wrap: boolean;
  /** text-overflow: ellipsis, or a line clamp: the browser draws something we do not (parity falls back). */
  readonly truncates: boolean;
}

let styles = new WeakMap<Element, LeafStyle>();

export const styleOf = (el: Element): LeafStyle => {
  const hit = styles.get(el);
  if (hit) return hit;
  const cs = getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  const ta = cs.textAlign;
  const align = ta === "right" || ta === "end" ? "right" : ta === "center" ? "center" : "left";
  const s: LeafStyle = {
    spec: fontSpecOf(cs),
    family: cs.fontFamily,
    weight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    insetL: px(cs.borderLeftWidth) + px(cs.paddingLeft),
    insetT: px(cs.borderTopWidth) + px(cs.paddingTop),
    insetR: px(cs.borderRightWidth) + px(cs.paddingRight),
    insetB: px(cs.borderBottomWidth) + px(cs.paddingBottom),
    align,
    wrap: !(cs.whiteSpace === "nowrap" || cs.whiteSpace === "pre"),
    truncates:
      cs.textOverflow.includes("ellipsis") ||
      (cs.getPropertyValue("-webkit-line-clamp") || "none") !== "none",
  };
  styles.set(el, s);
  return s;
};

/** Forget every cached style (viewport, media query or stylesheet change). */
export const forgetAllStyles = (): void => {
  styles = new WeakMap();
};

/** Forget cached styles, e.g. after a stylesheet or mode change. */
export const forgetStyle = (el: Element): void => {
  styles.delete(el);
};

export interface LaidLine extends Line {
  readonly x: number; // pen origin, CSS px
  readonly baseline: number; // CSS px
}

export interface LeafLayout {
  readonly lines: readonly LaidLine[];
  readonly ascent: number;
  readonly descent: number;
  readonly contentWidth: number;
}

const breakCache = new Map<string, Line[]>();

export const layoutLeaf = (
  m: Measurer,
  style: LeafStyle,
  text: string,
  rect: DOMRectReadOnly,
): LeafLayout => {
  const contentLeft = rect.left + style.insetL;
  const contentTop = rect.top + style.insetT;
  const contentWidth = Math.max(0, rect.width - style.insetL - style.insetR);
  const key = `${style.spec.key}|${style.wrap ? Math.round(contentWidth * 64) : -1}|${text}`;
  let lines = breakCache.get(key);
  if (!lines) {
    lines = breakLines(m, style.spec, text, contentWidth, style.wrap);
    if (breakCache.size > 50_000) breakCache.clear();
    breakCache.set(key, lines);
  }
  const { ascent, descent } = m.metrics(style.spec);
  const lh = style.spec.lineHeight;
  const halfLeading = (lh - (ascent + descent)) / 2;
  const laid: LaidLine[] = lines.map((l, i) => {
    const baseline = contentTop + i * lh + halfLeading + ascent;
    const x =
      style.align === "right"
        ? contentLeft + contentWidth - l.width
        : style.align === "center"
          ? contentLeft + (contentWidth - l.width) / 2
          : contentLeft;
    return { ...l, x, baseline };
  });
  return { lines: laid, ascent, descent, contentWidth };
};
