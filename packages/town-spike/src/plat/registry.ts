// What the painter needs to draw a Plat element (township.md R5.2 PaintSpec, reduced to the spike's kinds).
//
// Elements opt in with `data-paint` (space-separated kinds). Details ride on data attributes so a plain
// `querySelectorAll` in the read phase finds everything in document order:
//   data-paint="text"     a text leaf: a block box whose only child is one text node. data-tone picks the colour.
//   data-paint="surface"  a rounded rect behind the element. data-surface picks the style.
//   data-paint="field"    field chrome under a native, visible input (R4.1).
//   data-clip             marks a clipping ancestor (scrollers, table cells).

export type Tone =
  "ink" | "ink-2" | "ink-3" | "accent" | "credit" | "debit" | "on-accent" | "plaque" | "hud" | "critical";

export type SurfaceKind =
  | "pane"
  | "hud"
  | "zebra"
  | "rule"
  | "thead"
  | "button"
  | "button-primary"
  | "chip"
  | "chip-on"
  | "plaque"
  | "plaque-hero"
  | "field"
  | "summary"
  | "note"
  | "ribbon-well";

type RGBA = readonly [number, number, number, number];

const hex = (h: string, a = 1): RGBA => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
};

/** The interior look's tokens, in sRGB (they are written to the canvas as-is; see engine/renderer.ts). */
export const TONES: Record<Tone, RGBA> = {
  ink: hex("#1f1c17"),
  "ink-2": hex("#585248"),
  "ink-3": hex("#7a7368"),
  accent: hex("#2f5d50"),
  credit: hex("#2c6a3b"),
  debit: hex("#9b3a2c"),
  "on-accent": hex("#fbf8f1"),
  plaque: hex("#2a241b"),
  hud: hex("#1f1c17"),
  critical: hex("#9b2c2c"),
};

export interface SurfaceStyle {
  readonly fill: RGBA;
  readonly border: RGBA;
  readonly radius: number;
  readonly borderWidth: number;
  readonly shadow: number;
}

export const SURFACES: Record<SurfaceKind, SurfaceStyle> = {
  pane: { fill: hex("#fbf9f4"), border: hex("#ddd5c6"), radius: 10, borderWidth: 1, shadow: 6 },
  hud: { fill: hex("#f3efe6", 0.94), border: hex("#d8cfbe"), radius: 0, borderWidth: 1, shadow: 4 },
  zebra: { fill: hex("#f2eee5"), border: hex("#000000", 0), radius: 0, borderWidth: 0, shadow: 0 },
  rule: { fill: hex("#e3dccf"), border: hex("#000000", 0), radius: 0, borderWidth: 0, shadow: 0 },
  thead: { fill: hex("#efe9dd"), border: hex("#d8cfbe"), radius: 0, borderWidth: 1, shadow: 0 },
  button: { fill: hex("#f4efe5"), border: hex("#bdb3a2"), radius: 6, borderWidth: 1, shadow: 0 },
  "button-primary": { fill: hex("#2f5d50"), border: hex("#264c41"), radius: 6, borderWidth: 1, shadow: 2 },
  chip: { fill: hex("#efe9dd"), border: hex("#d2c8b6"), radius: 999, borderWidth: 1, shadow: 0 },
  "chip-on": { fill: hex("#dfeae4"), border: hex("#2f5d50"), radius: 999, borderWidth: 1, shadow: 0 },
  plaque: { fill: hex("#f7f1e3", 0.96), border: hex("#b39c6e"), radius: 4, borderWidth: 1, shadow: 3 },
  "plaque-hero": {
    fill: hex("#2f2a22", 0.96),
    border: hex("#c9a45a"),
    radius: 4,
    borderWidth: 1.5,
    shadow: 4,
  },
  field: { fill: hex("#ffffff"), border: hex("#a99f8e"), radius: 6, borderWidth: 1, shadow: 0 },
  summary: { fill: hex("#f4f0e7"), border: hex("#e0d8c9"), radius: 8, borderWidth: 1, shadow: 0 },
  note: { fill: hex("#eef3ef"), border: hex("#c3d6cb"), radius: 8, borderWidth: 1, shadow: 0 },
  "ribbon-well": { fill: hex("#f1ece2"), border: hex("#ddd5c6"), radius: 8, borderWidth: 1, shadow: 0 },
};

export const FIELD_FOCUS_BORDER: RGBA = hex("#2f5d50");

export const toneOf = (el: Element): RGBA => {
  const t = (el.getAttribute("data-tone") ?? "ink") as Tone;
  return TONES[t] ?? TONES.ink;
};

export const surfaceOf = (el: Element): SurfaceStyle | null => {
  const k = el.getAttribute("data-surface") as SurfaceKind | null;
  return k ? (SURFACES[k] ?? null) : null;
};

export const paintKinds = (el: Element): string => el.getAttribute("data-paint") ?? "";
