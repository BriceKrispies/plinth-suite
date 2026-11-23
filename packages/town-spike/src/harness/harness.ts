// window.__spike: the measurement harness (SPIKE.md). Every call reads state, or drives the app through the paths a
// person would use (navigation, scrolling, taps, selection), and every async call resolves after the frame it
// depends on has been drawn. Phone first: the layout, tap-target, bottom-bar and landing-fit checks of the G0 phone
// half are computed here from the Plat, so the script only has to collect them.

import type { App } from "../app";
import { cellTexts } from "../interior/statement";
import { runParity } from "../plat/parity";
import { getOverride, effectiveExperience } from "../swap/experience";

const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i]!;
};
const summarise = (xs: number[]) => ({
  n: xs.length,
  p50: pct(xs, 50),
  p95: pct(xs, 95),
  p99: pct(xs, 99),
  max: xs.length ? Math.max(...xs) : NaN,
  mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN,
});

/** Offsets where the browser starts a new line: a non-space character whose top moved down. */
const domLineStarts = (node: Text): number[] => {
  const text = node.data;
  const starts: number[] = [];
  let prevTop: number | null = null;
  const range = document.createRange();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) continue;
    const len = /[\uD800-\uDBFF]/.test(ch) ? 2 : 1;
    range.setStart(node, i);
    range.setEnd(node, Math.min(text.length, i + len));
    const r = range.getClientRects()[0];
    if (len === 2) i++;
    if (!r) continue;
    if (prevTop === null || r.top > prevTop + 2) starts.push(i - (len === 2 ? 1 : 0));
    prevTop = prevTop === null ? r.top : Math.max(prevTop, r.top);
  }
  return starts;
};

/** Alpha of a computed colour string. */
const alphaOf = (c: string): number => {
  if (!c || c === "transparent") return 0;
  const slash = /\/\s*([\d.]+)(%?)\s*\)/.exec(c);
  if (slash) return parseFloat(slash[1]!) / (slash[2] ? 100 : 1);
  const comma = /^rgba\(\s*[^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/.exec(c);
  if (comma) return parseFloat(comma[1]!);
  return 1;
};

const describe = (el: Element): string =>
  el.tagName.toLowerCase() +
  (el.id ? `#${el.id}` : "") +
  (el.className && typeof el.className === "string"
    ? `.${el.className.split(" ").filter(Boolean).join(".")}`
    : "");

const visible = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
  if (el.closest("[hidden],[inert],.sr-only")) return false;
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
};

const waitFor = (cond: () => boolean, timeout = 8000): Promise<boolean> =>
  new Promise((resolve) => {
    const t0 = performance.now();
    const check = () => {
      if (cond()) resolve(true);
      else if (performance.now() - t0 > timeout) resolve(false);
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });

export const installHarness = (app: App): void => {
  const api = {
    ready: app.ready,

    backend() {
      return {
        mode: app.mode,
        plainReason: app.boot.plainReason,
        ...(app.engine ? app.engine.backendInfo() : { requested: app.boot.backend, active: "none" }),
        tier: app.tier,
        textMode: app.textMode,
        effects: app.post
          ? [
              ...app.post.effects.filter((e) => (app.tier === "enhanced" ? true : !/bloom|shadows/.test(e))),
              `tier:${app.tier}`,
            ]
          : [],
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        secureContext: window.isSecureContext,
        offscreenCanvas: typeof OffscreenCanvas !== "undefined",
      };
    },

    state() {
      const st = app.bank?.statement;
      const tr = app.transition;
      return {
        view: app.view,
        route: app.route,
        path: location.pathname,
        search: location.search,
        mode: app.mode,
        textMode: app.textMode,
        tier: app.tier,
        layoutClass: app.layoutClass,
        short: app.short,
        motion: app.motion,
        transition: tr
          ? {
              from: tr.from,
              to: tr.to,
              kind: tr.kind,
              reduced: tr.reduced,
              progress: tr.elapsed / tr.duration,
            }
          : null,
        zoom: { ...app.zoom },
        statement: st
          ? {
              presentation: st.presentation,
              total: st.total,
              filtered: st.filtered.length,
              selecting: st.selecting,
              selected: st.selected.size,
              expanded: st.expanded,
              flowOpen: st.flowOpen,
              windowStart: st.windowStart,
              windowEnd: st.windowEnd,
              domItems: st.list.querySelectorAll("li.item").length,
              domRows: st.table.querySelectorAll("tr.row").length,
            }
          : null,
        transferStep: app.bank?.transfer.step ?? null,
        activeElement: document.activeElement ? describe(document.activeElement) : null,
        fontsResolveInCanvas: app.fontsOk,
        fallback: app.parity
          ? app.parity.state(true)
          : {
              mode: app.textMode === "gpu" ? "none" : app.textMode,
              elements: 0,
              runs: 0,
              totalRuns: 0,
              share: 0,
            },
        paint: app.painter ? { ...app.painter.stats } : null,
        bakes: app.baker ? { ...app.baker.stats } : null,
        lastGpuMs: app.lastGpuMs,
        framesRendered: app.framesRendered,
        errors: app.errors.slice(),
        notices: app.notices.slice(),
        sheet: app.shell?.openName ?? null,
      };
    },

    /** Timing marks: t1 (the Plat with data) and t3 (the first painted frame), and transferred bytes before each. */
    loading() {
      const mark = (name: string) => performance.getEntriesByName(name)[0]?.startTime ?? null;
      const t1 = mark("town:t1");
      const t3 = mark("town:t3");
      const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const bytesBefore = (t: number | null) =>
        t === null
          ? null
          : res
              .filter((r) => r.responseEnd <= t && !r.name.includes("/api/"))
              .reduce((s, r) => s + (r.transferSize || 0), nav?.transferSize ?? 0);
      const three = res.filter((r) => /three/.test(r.name)).reduce((s, r) => s + (r.transferSize || 0), 0);
      const threeBefore = (t: number | null) =>
        t === null
          ? null
          : res
              .filter((r) => /three/.test(r.name) && r.responseEnd <= t)
              .reduce((s, r) => s + (r.transferSize || 0), 0);
      // Every resource, largest first: what the budget is spent on (the API's data responses are listed, not counted).
      const table = [
        ...(nav
          ? [
              {
                name: nav.name,
                kind: "document",
                transfer: nav.transferSize,
                decoded: nav.decodedBodySize,
                end: nav.responseEnd,
              },
            ]
          : []),
        ...res.map((r) => ({
          name: r.name.replace(location.origin, ""),
          kind: r.initiatorType,
          transfer: r.transferSize,
          decoded: r.decodedBodySize,
          end: +r.responseEnd.toFixed(0),
        })),
      ].sort((x, y) => y.transfer - x.transfer);
      return {
        t1,
        t3,
        bytesBeforeT1: bytesBefore(t1),
        bytesBeforeT3: bytesBefore(t3),
        threeBytes: three,
        threeBytesBeforeT1: threeBefore(t1),
        resources: res.length,
        table,
      };
    },

    async frameStats(n = 120, opts: { scroll?: "window" | "table" } = {}) {
      const before = app.framesRendered;
      const m = await app.measure(n, opts);
      const source = m.frame.length ? "gpu-timestamp" : "raf";
      return {
        view: app.view,
        source,
        frameMs: summarise(m.frame.length ? m.frame : m.raf),
        gpuMs: summarise(m.gpu),
        cpuMs: summarise(m.cpu),
        rafMs: summarise(m.raf),
        canvasFrames: app.framesRendered - before,
        droppedShare: m.raf.length
          ? m.raf.filter((d) => d > 1.5 * pct(m.raf, 50)).length / m.raf.length
          : null,
        paint: { ...(app.painter?.stats ?? {}) },
      };
    },

    alignment(limit = 50) {
      const runs = app.painter?.lastRuns ?? [];
      const deltas: number[] = [];
      const failing: unknown[] = [];
      let breakMismatches = 0;
      for (const run of runs) {
        const par = runParity(run);
        if (!par) continue;
        if (par.lines.length > 1) breakMismatches++;
        deltas.push(par.delta);
        if (par.delta > 1 && failing.length < limit)
          failing.push({
            text: run.text.slice(0, 80),
            path: run.path,
            delta: +par.delta.toFixed(3),
            element: describe(run.el),
          });
      }
      const within = deltas.filter((d) => d <= 1).length;
      return {
        count: deltas.length,
        rasterRuns: runs.filter((r) => r.path === "raster").length,
        sdfRuns: runs.filter((r) => r.path === "sdf").length,
        maxDelta: deltas.length ? Math.max(...deltas) : null,
        p99Delta: deltas.length ? pct(deltas, 99) : null,
        shareWithin1px: deltas.length ? within / deltas.length : null,
        runsSpanningSeveralDomLines: breakMismatches,
        fallback: app.parity ? app.parity.state(true) : null,
        failing,
      };
    },

    /**
     * The one-copy invariant (spec 03 section 3.5.6): painted elements whose DOM text is not transparent. Under
     * hybrid text nothing is painted, so this is empty by construction and `glyphInstances` must be 0.
     */
    doubleText(limit = 50) {
      const out: unknown[] = [];
      if (app.boot.debugOverlay) return out;
      const seen = new Set<Element>();
      for (const run of app.painter?.lastRuns ?? []) {
        const el = run.el;
        if (seen.has(el) || !el.isConnected) continue;
        seen.add(el);
        if (app.textMode !== "gpu") {
          out.push({
            text: run.text.slice(0, 60),
            element: describe(el),
            reason: "painted under hybrid text",
          });
          continue;
        }
        const cs = getComputedStyle(el);
        const fill = (cs as CSSStyleDeclaration & { webkitTextFillColor?: string }).webkitTextFillColor;
        if (alphaOf(fill || cs.color) > 0 && out.length < limit)
          out.push({
            text: run.text.slice(0, 60),
            element: describe(el),
            color: cs.color,
            textFillColor: fill ?? null,
          });
      }
      return out;
    },

    lineBreakParity(limit = 50) {
      const leaves = app.painter?.lastLeaves ?? [];
      let matching = 0;
      let counted = 0;
      const mismatches: unknown[] = [];
      for (const leaf of leaves) {
        if (!leaf.node.isConnected) continue;
        const dom = domLineStarts(leaf.node);
        if (dom.length === 0) continue;
        counted++;
        const ok = dom.length === leaf.starts.length && dom.every((v, i) => v === leaf.starts[i]);
        if (ok) matching++;
        else if (mismatches.length < limit)
          mismatches.push({ text: leaf.node.data.slice(0, 120), painted: leaf.starts, dom });
      }
      return { count: counted, matching, share: counted ? matching / counted : null, mismatches };
    },

    staleRuns(limit = 20) {
      const roots = app.viewRoots();
      const runs = app.painter?.lastRuns ?? [];
      const stale = runs.filter(
        (r) => !r.el.isConnected || !roots.some((root) => root.contains(r.el)) || !!r.el.closest("[hidden]"),
      );
      return {
        view: app.view,
        paintedRuns: runs.length,
        stale: stale.length,
        examples: stale.slice(0, limit).map((r) => ({ text: r.text.slice(0, 60), element: describe(r.el) })),
        glyphInstances: app.painter ? app.painter.stats.runs + app.painter.stats.glyphs : 0,
      };
    },

    /**
     * Layout facts for the phone criteria: the breakpoint, whether the landing fits one screen, the bottom bar and
     * dock, and every visible control smaller than the tap-target minimum (44 px under a coarse pointer).
     */
    layout() {
      const doc = document.documentElement;
      const bar = document.getElementById("bottombar");
      const barRect = bar?.getBoundingClientRect() ?? null;
      const dock = document.querySelector<HTMLElement>(
        "[data-current] .dock, .view[data-current] .room[data-active] .dock",
      );
      const roomDock =
        app.view === "bank" && app.route.room
          ? document.querySelector<HTMLElement>(`.room[data-room="${app.route.room}"] .dock`)
          : app.view === "street"
            ? document.querySelector<HTMLElement>(".view.street[data-current] .dock")
            : dock;
      const dockRect = roomDock && visible(roomDock) ? roomDock.getBoundingClientRect() : null;
      const top = document.getElementById("topbar")?.getBoundingClientRect() ?? null;
      const plinth = app.landing?.plinth.getBoundingClientRect() ?? null;
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
        layoutClass: app.layoutClass,
        short: app.short,
        textMode: app.textMode,
        coarse: matchMedia("(pointer: coarse)").matches,
        scrollHeight: doc.scrollHeight,
        clientHeight: doc.clientHeight,
        verticalScroll: doc.scrollHeight > doc.clientHeight + 1,
        horizontalScroll: doc.scrollWidth > doc.clientWidth + 1,
        topbar: top ? { top: top.top, bottom: top.bottom, height: top.height } : null,
        bottomBar:
          barRect && bar && visible(bar)
            ? {
                top: barRect.top,
                bottom: barRect.bottom,
                height: barRect.height,
                left: barRect.left,
                width: barRect.width,
              }
            : null,
        bottomBarSlots: bar
          ? [...bar.querySelectorAll<HTMLElement>(".slot")]
              .filter((s) => !s.hidden)
              .map((s) => s.getAttribute("data-slot"))
          : [],
        dock: dockRect ? { top: dockRect.top, bottom: dockRect.bottom, height: dockRect.height } : null,
        dockAboveBar:
          !!dockRect && !!barRect && (dockRect.bottom <= barRect.top + 1 || app.layoutClass !== "compact"),
        landing: plinth
          ? { top: plinth.top, bottom: plinth.bottom, width: plinth.width, height: plinth.height }
          : null,
        // In the short layout the bar is a rail at the side, so only a horizontal bar bounds the landing.
        landingFits:
          app.view !== "landing" ||
          !plinth ||
          (plinth.bottom <=
            (barRect && barRect.width > barRect.height && visible(bar!) ? barRect.top : window.innerHeight) +
              1 &&
            plinth.top >= 0 &&
            doc.scrollHeight <= doc.clientHeight + 1),
      };
    },

    /** Interactive elements on screen smaller than `min` CSS px in either dimension (spec 00 section 0.5.3). */
    tapTargets(min = 44) {
      const sel =
        "a[href], button, input, select, textarea, [role=button], [role=option], [role=radio], [tabindex]:not([tabindex='-1'])";
      const all = [...document.querySelectorAll<HTMLElement>(sel)].filter(
        (el) => visible(el) && !el.closest("[data-mark]") && el.id !== "scene",
      );
      const small = all
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ el, r }) => {
          // A checkbox inside a larger tap area (its list item or label) counts as that area.
          const host = el.closest("li.item, label");
          const hr = host && host !== el ? host.getBoundingClientRect() : r;
          return Math.max(r.width, hr.width) < min - 0.5 || Math.max(r.height, hr.height) < min - 0.5;
        })
        .map(({ el, r }) => ({
          element: describe(el),
          text: (el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 40),
          width: +r.width.toFixed(1),
          height: +r.height.toFixed(1),
        }));
      return { checked: all.length, min, small };
    },

    /** Street links: inside the band, at least 44 × 44, not overlapping; and whether each band image is baked. */
    street() {
      const view = document.querySelector<HTMLElement>(".view.street[data-current]");
      if (!view) return null;
      const bands = [...view.querySelectorAll<HTMLElement>(".band")].map((band) => {
        const stage = band.querySelector<HTMLElement>(".band-stage")!.getBoundingClientRect();
        const canvas = band.querySelector<HTMLCanvasElement>("canvas.band-image");
        const links = [...band.querySelectorAll<HTMLAnchorElement>("a.lot")].map((a) => {
          const r = a.getBoundingClientRect();
          return {
            href: a.getAttribute("href"),
            left: r.left - stage.left,
            top: r.top - stage.top,
            width: r.width,
            height: r.height,
          };
        });
        let overlaps = 0;
        for (let i = 0; i < links.length; i++)
          for (let j = i + 1; j < links.length; j++) {
            const a = links[i]!;
            const b = links[j]!;
            if (
              a.left < b.left + b.width - 0.5 &&
              b.left < a.left + a.width - 0.5 &&
              a.top < b.top + b.height - 0.5 &&
              b.top < a.top + a.height - 0.5
            )
              overlaps++;
          }
        return {
          district: band.getAttribute("data-district"),
          baked: band.hasAttribute("data-baked"),
          canvasInScroller: !!canvas && getComputedStyle(canvas).position !== "fixed",
          imageSize: canvas ? { width: canvas.width, height: canvas.height } : null,
          stage: { width: stage.width, height: stage.height },
          links,
          minLink: links.length ? Math.min(...links.map((l) => Math.min(l.width, l.height))) : null,
          overlaps,
        };
      });
      return { borough: view.getAttribute("data-borough"), bands, bakes: app.baker?.stats ?? null };
    },

    experience() {
      const o = getOverride();
      return { override: o, site: app.siteExperience, effective: effectiveExperience(o, app.siteExperience) };
    },

    /** Navigate in-app (as a link would). With pauseAt, resolves when the transition holds at that progress. */
    async go(path: string, opts: { pauseAt?: number; replace?: boolean } = {}) {
      const t0 = performance.now();
      const paused = opts.pauseAt !== undefined ? app.pauseAt(opts.pauseAt) : null;
      app.navigate(path, opts.replace ? { replace: true } : { push: true });
      if (paused && app.transition) {
        await paused;
        await app.nextFrame();
        return { paused: true, ms: performance.now() - t0 };
      }
      if (paused) app.resume();
      await waitFor(() => !app.transition);
      const ms = performance.now() - t0;
      await app.nextFrame();
      // transitionMs: the transition itself (start to focus on the new heading), apart from harness polling and the
      // next drawn frame, which a software rasteriser makes slow.
      return { paused: false, ms, transitionMs: app.lastTransitionMs };
    },

    async resume() {
      app.resume();
      await waitFor(() => !app.transition);
      await app.nextFrame();
    },

    /** Statement room helpers. */
    async setFlow(on: boolean) {
      app.bank.statement.setFlow(on);
      await waitFor(
        () => !on || app.bank.statement.ribbonFigure.hasAttribute("data-baked") || !app.engine,
        4000,
      );
      await app.nextFrame();
      return app.bank.statement.ribbonFigure.getBoundingClientRect().height;
    },

    async expandItem(i: number) {
      const st = app.bank.statement;
      st.scrollToRow(i);
      await app.nextFrame();
      const btn = st.list.querySelector<HTMLElement>(`li.item[data-row="${i}"] .item-btn`);
      btn?.click();
      await app.nextFrame();
      return st.expanded;
    },

    /** Select the memo of item i (list presentation, after expanding it): expected is the Details string. */
    async selectMemo(i: number) {
      const st = app.bank.statement;
      if (st.expanded !== i) await api.expandItem(i);
      const dd = st.list.querySelector(`li.item[data-row="${i}"] dd.memo`);
      const sel = document.getSelection();
      if (!dd || !sel) return null;
      const range = document.createRange();
      range.selectNodeContents(dd);
      sel.removeAllRanges();
      sel.addRange(range);
      await app.nextFrame();
      return { expected: cellTexts(st.filtered[i]!)[3], selection: sel.toString() };
    },

    /** Select table text: one cell (row a) or rows a..b (expected TSV), as the desktop table copies it. */
    async selectTable(a: number, b?: number) {
      const st = app.bank.statement;
      if (a < st.windowStart || (b ?? a) >= st.windowEnd) st.scrollToRow(a);
      await app.nextFrame();
      const rowEl = (i: number) => st.table.querySelector<HTMLTableRowElement>(`tr.row[data-row="${i}"]`);
      const sel = document.getSelection();
      if (!sel) return null;
      const range = document.createRange();
      let expected: string;
      if (b === undefined) {
        const td = rowEl(a)?.cells[3];
        if (!td?.firstChild) return null;
        range.selectNodeContents(td);
        expected = st.rowText(a)[3] ?? "";
      } else {
        const first = rowEl(a)?.cells[0];
        const lastRow = rowEl(b);
        const last = lastRow?.cells[lastRow.cells.length - 1];
        if (!first?.firstChild || !last?.firstChild) return null;
        range.setStart(first.firstChild, 0);
        range.setEnd(last.firstChild, (last.firstChild as Text).length);
        const idx: number[] = [];
        for (let i = a; i <= b; i++) idx.push(i);
        expected = st.rowsTsv(idx);
      }
      sel.removeAllRanges();
      sel.addRange(range);
      await app.nextFrame();
      return { expected, selection: sel.toString() };
    },

    /** The TSV Select mode would copy for these items (the script taps them and presses Copy itself). */
    expectedTsv(rows: number[]) {
      return app.bank.statement.rowsTsv(rows.slice().sort((x, y) => x - y));
    },

    async waitFrame() {
      app.markDirty();
      await app.nextFrame();
    },

    /** Re-run the reflow path (as a rotation or breakpoint crossing would) and wait for the next frame. */
    async reflow() {
      app.layoutChanged();
      await app.nextFrame();
      await app.nextFrame();
    },
  };
  (window as unknown as { __spike: typeof api }).__spike = api;
};
