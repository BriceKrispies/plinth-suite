// Runtime text parity (spec K1: "a runtime check hands any element back to visible DOM text").
//
// The invariant this module keeps: a Plat text leaf is EITHER painted by the GPU with transparent DOM text, OR its
// DOM text is visible and nothing is painted for it. Never both (that is the "double vision").
//
// After each paint pass the painter's runs are compared with the browser's own line boxes (the same measure the
// harness reports). A leaf whose painted run is off by more than 1 CSS px, whose line breaks differ, that the
// browser truncates (ellipsis, line clamp) or that overflows its own unclipped box gets the `dom-text` class
// (CSS restores its colour, including -webkit-text-fill-color) and is excluded from painting. When more than
// FALLBACK_SHARE of all runs fall back, the whole Plat switches to visible DOM text with no painted text (the
// app-wide K1 fallback, html[data-k1="dom"]).
//
// Cost model: a leaf is re-checked only when its text or its size changed since it last passed. Anything that can
// change layout globally (resize, orientation, fonts, viewport, scroll-container size) calls `markFull()`: the next
// frame drops every fallback, paints everything, and decides again from scratch.

import type { PlatPainter, PaintedLeaf, PaintedRun } from "./painter";
import { forgetAllStyles } from "../text/layout";

export interface LineBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The browser's line boxes for [start, end) of a text node: one union rect per distinct line top. */
export const domLines = (node: Text, start: number, end: number): LineBox[] => {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
  const lines: LineBox[] = [];
  for (const r of rects) {
    const same = lines.find((l) => Math.abs(l.top - r.top) < 2);
    if (same) {
      same.left = Math.min(same.left, r.left);
      same.right = Math.max(same.right, r.right);
      same.bottom = Math.max(same.bottom, r.bottom);
    } else lines.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  return lines;
};

/** The union of a run's DOM line boxes and the largest edge difference to the painted run (CSS px). */
export const runParity = (run: PaintedRun): { delta: number; lines: LineBox[]; dom: LineBox } | null => {
  if (!run.node.isConnected) return null;
  const lines = domLines(run.node, run.start, run.end);
  if (lines.length === 0) return null;
  const dom: LineBox = {
    left: Math.min(...lines.map((l) => l.left)),
    top: Math.min(...lines.map((l) => l.top)),
    right: Math.max(...lines.map((l) => l.right)),
    bottom: Math.max(...lines.map((l) => l.bottom)),
  };
  const delta = Math.max(
    Math.abs(dom.left - run.left),
    Math.abs(dom.top - run.top),
    Math.abs(dom.right - run.right),
    Math.abs(dom.bottom - run.bottom),
  );
  return { delta, lines, dom };
};

/** Share of runs that may fall back per element before the whole interior switches to DOM text. */
export const FALLBACK_SHARE = 0.005;
/** Largest tolerated painted-vs-DOM difference, CSS px. */
export const ALIGN_TOLERANCE = 1;

export type FallbackReason = "misaligned" | "line-breaks" | "truncated" | "overflow" | "unpainted";

export interface FallbackState {
  /** none: all text painted. elements: some leaves are DOM text. app: all text is DOM text. plain: no GPU. */
  mode: "none" | "elements" | "app" | "plain";
  elements: number;
  runs: number;
  totalRuns: number;
  share: number;
  threshold: number;
  reasons: Record<string, number>;
  examples: { element: string; reason: string; text: string; delta?: number }[];
  fullChecks: number;
}

interface Excluded {
  runs: number;
  reason: FallbackReason;
  text: string;
  delta?: number;
}

const describe = (el: Element): string =>
  el.tagName.toLowerCase() +
  (el.className
    ? `.${String(el.className)
        .split(" ")
        .filter((c) => c && c !== "dom-text")
        .join(".")}`
    : "");

export class Parity {
  private readonly excluded = new Map<Element, Excluded>();
  private readonly sigs = new WeakMap<Element, string>();
  private generation = 0;
  private full = true;
  private fullChecks = 0;
  private lastTotal = 0;
  private appMode = false;
  private readonly root = document.documentElement;

  constructor(private readonly painter: PlatPainter) {}

  /** Something that can change layout globally happened: re-decide everything on the next frame. */
  markFull(): void {
    this.full = true;
  }

  /** Call before painting a frame. Drops every fallback when a global change is pending. */
  begin(): void {
    if (!this.full) return;
    this.full = false;
    this.fullChecks++;
    for (const el of this.excluded.keys()) el.classList.remove("dom-text");
    this.excluded.clear();
    this.painter.domText.clear();
    this.painter.textOff = false;
    this.appMode = false;
    delete this.root.dataset["k1"];
    forgetAllStyles();
    this.lastTotal = 0;
    this.generation++; // every leaf is verified again
  }

  private signature(leaf: PaintedLeaf): string {
    return `${this.generation}|${leaf.node.data}|${leaf.w.toFixed(2)}|${leaf.h.toFixed(2)}`;
  }

  private reasonFor(
    leaf: PaintedLeaf,
    runs: PaintedRun[],
  ): { reason: FallbackReason; delta?: number } | null {
    const el = leaf.el;
    if (leaf.truncates && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1))
      return { reason: "truncated" };
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === "visible")
      return { reason: "overflow" };
    if (runs.length < leaf.visibleLines) return { reason: "unpainted" };
    const lines = domLines(leaf.node, 0, leaf.node.data.length);
    if (lines.length !== leaf.lines) return { reason: "line-breaks" };
    let worst = 0;
    for (const run of runs) {
      const p = runParity(run);
      if (!p) continue;
      if (p.lines.length > 1) return { reason: "line-breaks" };
      worst = Math.max(worst, p.delta);
    }
    if (worst > ALIGN_TOLERANCE) return { reason: "misaligned", delta: worst };
    return null;
  }

  /**
   * Check the leaves painted in the last pass. Returns true when painting must be redone (some leaf was handed
   * back to the DOM, or the whole Plat switched to DOM text).
   */
  check(): boolean {
    const p = this.painter;
    if (p.textOff) return false;
    const byEl = new Map<Element, PaintedRun[]>();
    for (const r of p.lastRuns) {
      const a = byEl.get(r.el);
      if (a) a.push(r);
      else byEl.set(r.el, [r]);
    }
    let changed = false;
    let painted = 0;
    let paintedExcluded = 0;
    for (const leaf of p.lastLeaves) {
      painted += leaf.lines;
      if (!leaf.node.isConnected) continue;
      const sig = this.signature(leaf);
      if (this.sigs.get(leaf.el) === sig) continue;
      const why = this.reasonFor(leaf, byEl.get(leaf.el) ?? []);
      if (!why) {
        this.sigs.set(leaf.el, sig);
        continue;
      }
      this.excluded.set(leaf.el, {
        runs: leaf.lines,
        reason: why.reason,
        text: leaf.node.data.slice(0, 60),
        ...(why.delta !== undefined ? { delta: why.delta } : {}),
      });
      p.domText.add(leaf.el);
      leaf.el.classList.add("dom-text");
      paintedExcluded += leaf.lines;
      changed = true;
    }
    for (const el of [...this.excluded.keys()])
      if (!el.isConnected) {
        this.excluded.delete(el);
        p.domText.delete(el);
      }
    let failed = 0;
    for (const e of this.excluded.values()) failed += e.runs;
    // Runs of leaves excluded in this very pass are in `painted` and in `failed`: count them once.
    this.lastTotal = painted + failed - paintedExcluded;
    if (this.lastTotal > 0 && failed / this.lastTotal > FALLBACK_SHARE && !this.appMode) {
      this.appMode = true;
      p.textOff = true;
      this.root.dataset["k1"] = "dom";
      changed = true;
    }
    return changed;
  }

  state(gpu: boolean): FallbackState {
    let runs = 0;
    const reasons: Record<string, number> = {};
    const examples: FallbackState["examples"] = [];
    for (const [el, e] of this.excluded) {
      runs += e.runs;
      reasons[e.reason] = (reasons[e.reason] ?? 0) + 1;
      if (examples.length < 20)
        examples.push({
          element: describe(el),
          reason: e.reason,
          text: e.text,
          ...(e.delta !== undefined ? { delta: +e.delta.toFixed(2) } : {}),
        });
    }
    const total = this.lastTotal;
    return {
      mode: !gpu ? "plain" : this.appMode ? "app" : this.excluded.size > 0 ? "elements" : "none",
      elements: this.excluded.size,
      runs,
      totalRuns: total,
      share: total > 0 ? runs / total : 0,
      threshold: FALLBACK_SHARE,
      reasons,
      examples,
      fullChecks: this.fullChecks,
    };
  }
}
