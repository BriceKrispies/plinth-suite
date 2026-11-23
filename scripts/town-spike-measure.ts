// Township prototype, mobile first: the G0 measurement run (docs/gpu-frontend/spike/SPIKE.md, criteria C1 to C14 as
// spec 07 section 7.2 words them).
//
//   npx tsx scripts/town-spike-measure.ts <out-dir>
//   TOWN_SPIKE_URL=http://localhost:5173/town/ npx tsx scripts/town-spike-measure.ts shots/town-mobile
//
// Order (phone first, then the expansion pass):
//   1. Pixel 7 (installed Chrome, DPR 2.625, touch) on WebGPU and on WebGL2, then iPhone 13 (WebKit, touch): the
//      landing, the Rewards street, the Bank lobby, the Statement room (list, expanded item, Select-mode copy, Flow,
//      search sheet), the Transfer room (typing, keyboard emulation, review), landscape, a breakpoint crossing, the
//      command sheet, the You sheet and the swap toggle round trip. Every step records doubleText(), the layout
//      checks (landing fits one screen, bottom bar and dock), tap targets under 44 px and a screenshot.
//   2. Zoom transitions under Motion Full, held mid-way for screenshots; the reduced-motion crossfade.
//   3. C10: GPU text forced in narrow panes (fine pointer, DPR 2.625), OffscreenCanvas deleted, fault injection.
//   4. C14: Chromium 390 × 844 DPR 3 with CPU 4× slower and the design network: t1, t3, bytes, CPU per frame.
//   5. Desktop 1440 × 900 (the expansion): the vista, a street, the Bank side by side with the table, on WebGPU and
//      WebGL2: alignment (C1), line breaks (C2), frames (C3, C4), copy (C6), typing (C7), Plain and forced colours
//      (C8), focus after navigation (C9).
//   6. Pixel checks: every screenshot non-black; the same scene on WebGPU and WebGL2 alike (downsampled MAD).
// C11 to C13 need the two real phones over HTTPS and are reported as not run.
//
// The base URL should be Classic's origin (5173 or the HTTPS 5443 server), which proxies /town, so the swap toggle
// can land on Classic. TOWN_SPIKE_LIVE_SWAP=1 also flips the site default through site.appearance.set (as
// maya-ortiz) to check the live swap, then restores it.
import { chromium, devices, webkit, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import { spawnSync } from "node:child_process";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const outDir = process.argv[2] ?? "shots/town-mobile";
const BASE_URL = process.env["TOWN_SPIKE_URL"] ?? "http://localhost:5173/town/";
const ARGS = ["--enable-unsafe-webgpu", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];
// Playwright's bundled Chromium lacks the D3D12 shader compiler on Windows, so WebGPU silently falls back there.
const CHANNEL = process.env["TOWN_SPIKE_CHANNEL"] ?? "chrome";
const LIVE_SWAP = process.env["TOWN_SPIKE_LIVE_SWAP"] === "1";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const spike = (page: Page, method: string, ...args: unknown[]): Promise<Json> =>
  page.evaluate(
    async ({ method, args }) => {
      const h = (window as unknown as { __spike: Record<string, (...a: unknown[]) => unknown> }).__spike;
      return await h[method]!(...args);
    },
    { method, args },
  );

const urlFor = (route: string, params: Record<string, string>): string => {
  const u = new URL(route.replace(/^\//, ""), BASE_URL);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
};

// ---------------------------------------------------------------- pixels

const GRID_W = 24;
const GRID_H = 40;
interface PixelStats {
  nonBlackShare: number;
  meanLuma: number;
  grid: number[];
}
const PIXELS: Record<string, PixelStats> = {};
let decoder: Page | null = null;

/** Decode a PNG in a helper Chromium page (works whatever engine took the shot) and summarise it. */
const pixelStats = async (png: Buffer): Promise<PixelStats> => {
  if (!decoder) throw new Error("no decoder page");
  return decoder.evaluate(
    async ({ b64, gw, gh }) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, bmp.width, bmp.height);
      let nonBlack = 0;
      let sum = 0;
      const cells = new Float64Array(gw * gh * 3);
      const counts = new Float64Array(gw * gh);
      for (let y = 0; y < height; y++) {
        const cy = Math.min(gh - 1, Math.floor((y / height) * gh));
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const r = data[i]! / 255;
          const g = data[i + 1]! / 255;
          const b = data[i + 2]! / 255;
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          sum += l;
          if (l > 0.08) nonBlack++;
          const cell = cy * gw + Math.min(gw - 1, Math.floor((x / width) * gw));
          cells[cell * 3] = cells[cell * 3]! + r;
          cells[cell * 3 + 1] = cells[cell * 3 + 1]! + g;
          cells[cell * 3 + 2] = cells[cell * 3 + 2]! + b;
          counts[cell] = counts[cell]! + 1;
        }
      }
      const grid: number[] = [];
      for (let k = 0; k < gw * gh; k++)
        for (let ch = 0; ch < 3; ch++) grid.push(+(cells[k * 3 + ch]! / Math.max(1, counts[k]!)).toFixed(4));
      const n = width * height;
      return { nonBlackShare: nonBlack / n, meanLuma: sum / n, grid };
    },
    { b64: png.toString("base64"), gw: GRID_W, gh: GRID_H },
  );
};

const shot = async (page: Page, name: string): Promise<string> => {
  const file = `${name}.png`;
  const png = await page.screenshot({ path: join(outDir, file) });
  try {
    PIXELS[name] = await pixelStats(png);
  } catch {
    // decoding is a check, not the shot
  }
  return file;
};

const gridDiff = (a: PixelStats | undefined, b: PixelStats | undefined): number | null => {
  if (!a || !b || a.grid.length !== b.grid.length) return null;
  let d = 0;
  for (let i = 0; i < a.grid.length; i++) d += Math.abs(a.grid[i]! - b.grid[i]!);
  return d / a.grid.length;
};

/** Fixed before the run: every screenshot is mostly non-black, and webgpu and webgl2 shots of a scene agree. */
const PIXEL_LIMITS = { nonBlack: 0.9, crossBackendMad: 0.06 };
const CROSS_PAIRS: [string, string][] = [
  ["pixel7-webgpu-landing", "pixel7-webgl2-landing"],
  ["pixel7-webgpu-street", "pixel7-webgl2-street"],
  ["pixel7-webgpu-lobby", "pixel7-webgl2-lobby"],
  ["pixel7-webgpu-statement", "pixel7-webgl2-statement"],
  ["pixel7-webgpu-statement-flow", "pixel7-webgl2-statement-flow"],
  ["desktop-webgpu-vista", "desktop-webgl2-vista"],
  ["desktop-webgpu-street", "desktop-webgl2-street"],
  ["desktop-webgpu-interior", "desktop-webgl2-interior"],
  ["desktop-webgpu-ribbon", "desktop-webgl2-ribbon"],
];

const pixelChecks = () => {
  const dark = Object.entries(PIXELS)
    .filter(([, v]) => v.nonBlackShare < PIXEL_LIMITS.nonBlack)
    .map(([k, v]) => ({ shot: k, nonBlackShare: +v.nonBlackShare.toFixed(3) }));
  const cross = CROSS_PAIRS.map(([a, b]) => {
    const mad = gridDiff(PIXELS[a], PIXELS[b]);
    return { a, b, mad, ok: mad !== null && mad <= PIXEL_LIMITS.crossBackendMad };
  });
  return {
    limits: PIXEL_LIMITS,
    shots: Object.keys(PIXELS).length,
    dark,
    cross,
    ok: dark.length === 0 && cross.every((c) => c.ok),
  };
};

// ---------------------------------------------------------------- contexts

interface Logged {
  scene: string;
  type: string;
  text: string;
}

interface Profile {
  name: string;
  engine: "chromium" | "webkit";
  device?: keyof typeof devices;
  viewport?: { width: number; height: number };
  dpr?: number;
  touch: boolean;
}

const PIXEL7: Profile = { name: "pixel7", engine: "chromium", device: "Pixel 7", touch: true };
const IPHONE13: Profile = { name: "iphone13", engine: "webkit", device: "iPhone 13", touch: true };
const PHONE390: Profile = {
  name: "phone390",
  engine: "chromium",
  viewport: { width: 390, height: 844 },
  dpr: 3,
  touch: true,
};
const DESKTOP: Profile = {
  name: "desktop",
  engine: "chromium",
  viewport: { width: 1440, height: 900 },
  dpr: 1,
  touch: false,
};

const browsers: Partial<Record<"chromium" | "webkit", Browser>> = {};
const browserFor = async (engine: "chromium" | "webkit"): Promise<Browser> => {
  const have = browsers[engine];
  if (have) return have;
  const b =
    engine === "webkit"
      ? await webkit.launch({ headless: true })
      : await chromium.launch({
          headless: true,
          args: ARGS,
          ...(CHANNEL === "bundled" ? {} : { channel: CHANNEL }),
        });
  browsers[engine] = b;
  return b;
};

interface Opened {
  ctx: BrowserContext;
  page: Page;
  log: Logged[];
  scene: { name: string };
}

const openContext = async (
  p: Profile,
  opts: {
    reducedMotion?: "reduce" | "no-preference";
    forcedColors?: "active" | "none";
    noOffscreen?: boolean;
    finePointer?: boolean;
  } = {},
): Promise<Opened> => {
  const browser = await browserFor(p.engine);
  const base = p.device ? { ...devices[p.device] } : {};
  const ctx = await browser.newContext({
    ...base,
    ...(p.viewport
      ? { viewport: p.viewport, deviceScaleFactor: p.dpr ?? 1, isMobile: p.touch, hasTouch: p.touch }
      : {}),
    ...(opts.finePointer ? { hasTouch: false, isMobile: false } : {}),
    reducedMotion: opts.reducedMotion ?? "no-preference",
    forcedColors: opts.forcedColors ?? "none",
  });
  if (p.engine === "chromium")
    await ctx
      .grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE_URL).origin })
      .catch(() => undefined);
  // tsx compiles with keepNames: functions passed to page.evaluate call a __name helper the page lacks.
  await ctx.addInitScript({ content: "window.__name = function (f) { return f; };" });
  // Stay in the town app for the run (the site default may be Classic). Once per tab, so the swap test can change it.
  await ctx.addInitScript({
    content: `try { if (!sessionStorage.getItem("spike-init")) { localStorage.setItem("plinth.experience", "town"); sessionStorage.setItem("spike-init", "1"); } } catch (e) {}`,
  });
  if (opts.noOffscreen)
    await ctx.addInitScript({ content: "try { delete window.OffscreenCanvas; } catch (e) {}" });
  const page = await ctx.newPage();
  const log: Logged[] = [];
  const scene = { name: "boot" };
  // Only the town app's own messages count: the swap test also loads Classic pages in this tab.
  const inTown = () => {
    try {
      return new URL(page.url()).pathname.startsWith("/town");
    } catch {
      return false;
    }
  };
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && inTown())
      log.push({ scene: scene.name, type: m.type(), text: m.text().slice(0, 400) });
  });
  page.on("pageerror", (e) => {
    if (inTown()) log.push({ scene: scene.name, type: "pageerror", text: e.message.slice(0, 400) });
  });
  return { ctx, page, log, scene };
};

const load = async (page: Page, url: string): Promise<void> => {
  await page.goto(url);
  await page.waitForFunction(() => "__spike" in window, null, { timeout: 30_000 });
  await page.evaluate(() => (window as unknown as { __spike: { ready: Promise<void> } }).__spike.ready);
  for (let i = 0; i < 4; i++) await spike(page, "waitFrame");
};

const tap = async (page: Page, selector: string, touch: boolean): Promise<void> => {
  const loc = page.locator(selector).first();
  if (touch) await loc.tap();
  else await loc.click();
};

const settle = async (page: Page): Promise<void> => {
  await page
    .waitForFunction(
      () =>
        (window as unknown as { __spike: { state(): { transition: unknown } } }).__spike.state()
          .transition === null,
      null,
      {
        timeout: 10_000,
      },
    )
    .catch(() => undefined);
  for (let i = 0; i < 3; i++) await spike(page, "waitFrame");
};

/** One recorded step: state, the one-copy check, layout facts, small tap targets and a screenshot. */
const record = async (page: Page, tag: string, min = 44): Promise<Json> => {
  await settle(page);
  const state = await spike(page, "state");
  const doubleText = await spike(page, "doubleText");
  const layout = await spike(page, "layout");
  const targets = await spike(page, "tapTargets", min);
  const file = await shot(page, tag);
  return {
    tag,
    view: state.view,
    path: state.path,
    textMode: state.textMode,
    tier: state.tier,
    layoutClass: state.layoutClass,
    mode: state.mode,
    activeElement: state.activeElement,
    errors: state.errors,
    doubleText,
    layout,
    smallTargets: targets.small,
    shot: file,
  };
};

/** The Windows clipboard turns LF into CRLF in text/plain: compare with line endings normalised. */
const eol = (s: string): string => s.replace(/\r\n/g, "\n");

const readClipboard = (page: Page) =>
  page.evaluate(() => navigator.clipboard.readText()).catch((e: Error) => `clipboard error: ${e.message}`);

// ---------------------------------------------------------------- 1. the phone walk

const runPhone = async (p: Profile, backend: "webgpu" | "webgl2" | "default"): Promise<Json> => {
  const tag = (s: string) => `${p.name}-${backend}-${s}`;
  const params: Record<string, string> = backend === "webgl2" ? { backend: "webgl2" } : {};
  const o = await openContext(p);
  const { page } = o;
  const r: Json = { profile: p.name, backend, steps: [] as Json[] };
  const step = async (name: string) => {
    o.scene.name = name;
    const rec = await record(page, tag(name));
    r.steps.push(rec);
    return rec;
  };
  try {
    // Landing: the whole town on one screen.
    await load(page, urlFor("/", params));
    r.backendInfo = await spike(page, "backend");
    const landing = await step("landing");
    r.landing = {
      fits: landing.layout.landingFits,
      verticalScroll: landing.layout.verticalScroll,
      plinth: landing.layout.landing,
    };

    // Tap the Rewards tile: zoom into its street.
    await tap(page, '.tile[data-borough="rewards"] a', p.touch);
    await page.waitForFunction(() => location.pathname.includes("/city/b/rewards"));
    const street = await step("street");
    await page
      .waitForFunction(
        () => {
          const s = (
            window as unknown as { __spike: { street(): { bands: { baked: boolean }[] } | null } }
          ).__spike.street();
          return !!s && s.bands.every((b) => b.baked);
        },
        null,
        { timeout: 15_000 },
      )
      .catch(() => undefined);
    r.street = await spike(page, "street");
    r.streetShot = await shot(page, tag("street"));
    void street;
    // Scrolling the street draws no canvas frame (the bands are images in the scroller).
    r.streetScroll = await spike(page, "frameStats", 90, { scroll: "window" });

    // Tap the Bank: zoom into the building.
    await page.evaluate(() => window.scrollTo(0, 0));
    await tap(page, 'a.lot[data-building="bank"]', p.touch);
    await page.waitForFunction(() => location.pathname.endsWith("/points"));
    r.lobby = await step("lobby");

    // The Statement room.
    await tap(page, 'a.card-head[data-room-link="statement"]', p.touch);
    await page.waitForFunction(() => location.pathname.endsWith("/points/statement"));
    r.statement = await step("statement");
    await tap(page, 'li.item[data-row="0"] .item-btn', p.touch);
    r.statementExpanded = await step("statement-expanded");
    r.memoSelection = await spike(page, "selectMemo", 1);
    await page.evaluate(() => document.getSelection()?.removeAllRanges());

    // Select mode: three lines, Copy 3 (TSV exactly as the table copies it).
    await tap(page, ".room[data-room=statement] .dock-btn.select", p.touch);
    for (const i of [0, 1, 2]) await tap(page, `li.item[data-row="${i}"] .item-btn`, p.touch);
    const expectedTsv = await spike(page, "expectedTsv", [0, 1, 2]);
    r.selectShot = await shot(page, tag("statement-select"));
    await tap(page, ".room[data-room=statement] .dock-btn.copy", p.touch);
    await spike(page, "waitFrame");
    const clip = p.engine === "chromium" ? await readClipboard(page) : "not readable in WebKit";
    r.selectCopy = {
      expected: expectedTsv,
      clipboard: clip,
      ok: p.engine !== "chromium" || eol(clip) === expectedTsv,
    };
    await tap(page, ".room[data-room=statement] .dock-btn.select", p.touch); // Done

    // View → Flow: the diorama opens to at most 35 % of the viewport.
    await tap(page, ".room[data-room=statement] .seg:nth-child(2)", p.touch);
    await page
      .waitForFunction(() => !!document.querySelector(".ribbon-band[data-baked]"), null, { timeout: 8000 })
      .catch(() => undefined);
    const flow = await step("statement-flow");
    const ribbon = await page.evaluate(() => {
      const f = document.querySelector(".ribbon-band")!.getBoundingClientRect();
      const well = document.querySelector<HTMLElement>(".ribbon-well")!;
      return {
        height: f.height,
        viewport: window.visualViewport?.height ?? window.innerHeight,
        touchAction: getComputedStyle(well).touchAction,
      };
    });
    r.flow = {
      ...ribbon,
      share: ribbon.height / ribbon.viewport,
      ok: ribbon.height <= 0.35 * ribbon.viewport + 1 && ribbon.touchAction !== "none",
      step: flow.tag,
    };
    await tap(page, ".room[data-room=statement] .seg:nth-child(1)", p.touch);

    // Search sheet: field at the bottom, the filtered list above it.
    await tap(page, ".room[data-room=statement] .dock-btn.search", p.touch);
    await page.locator("#statement-search").fill("a");
    r.search = await step("statement-search");
    await page.locator("#statement-search").fill("");
    await page.keyboard.press("Escape");

    // Back to the lobby, then the Transfer room.
    await tap(page, ".room[data-room=statement] .dock-btn.back", p.touch);
    await page.waitForFunction(() => location.pathname.endsWith("/points"));
    await settle(page);
    await tap(page, 'a.card-head[data-room-link="transfer"]', p.touch);
    await page.waitForFunction(() => location.pathname.endsWith("/points/transfer"));
    r.transfer = await step("transfer");
    const typed = { "#tr-to": "jonas-becker", "#tr-amount": "25", "#tr-memo": "Spike typing check" };
    for (const [sel, text] of Object.entries(typed)) {
      await tap(page, sel, p.touch);
      await page.locator(sel).pressSequentially(text, { delay: 10 });
    }
    // The on-screen keyboard: the visual viewport shrinks to 60 % with the memo focused.
    const vp = page.viewportSize()!;
    await page.locator("#tr-memo").focus();
    await page.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.6) });
    await spike(page, "waitFrame");
    const kb = await page.evaluate(() => {
      const dock = document
        .querySelector<HTMLElement>(".room[data-room=transfer] .dock")!
        .getBoundingClientRect();
      const field = document.getElementById("tr-memo")!.getBoundingClientRect();
      const vv = window.visualViewport;
      const h = vv ? vv.height + vv.offsetTop : window.innerHeight;
      return {
        kbMode: document.documentElement.getAttribute("data-kb"),
        dockBottom: dock.bottom,
        dockTop: dock.top,
        fieldBottom: field.bottom,
        viewportBottom: h,
        topbarShown: getComputedStyle(document.getElementById("topbar")!).display !== "none",
        bottomBarShown: getComputedStyle(document.getElementById("bottombar")!).display !== "none",
      };
    });
    r.keyboard = {
      ...kb,
      ok:
        kb.kbMode === "open" &&
        kb.dockBottom <= kb.viewportBottom + 1 &&
        kb.dockTop >= kb.viewportBottom * 0.4 &&
        !kb.topbarShown,
    };
    r.keyboardShot = await shot(page, tag("transfer-keyboard"));
    r.keyboardDoubleText = await spike(page, "doubleText");
    await page.setViewportSize(vp);
    await page.locator("#tr-memo").blur();
    const values: Record<string, string> = {};
    for (const sel of Object.keys(typed)) values[sel] = await page.locator(sel).inputValue();
    await tap(page, ".room[data-room=transfer] .dock-btn.primary", p.touch);
    await spike(page, "waitFrame");
    const confirm = await page
      .locator('[data-step="confirm"]')
      .innerText()
      .catch(() => "");
    r.transferConfirm = await step("transfer-confirm");
    r.typing = {
      values,
      confirm,
      ok:
        Object.entries(typed).every(([k, v]) => values[k] === v) &&
        confirm.includes("jonas-becker") &&
        confirm.includes("25") &&
        confirm.includes("Spike typing check"),
    };

    // Landscape (the short layout) on the landing, a street and the Statement room; then a breakpoint crossing.
    r.landscape = [];
    for (const path of ["/", "/city/b/rewards", "/points/statement"]) {
      await load(page, urlFor(path, params));
      await page.setViewportSize({ width: vp.height, height: vp.width });
      await spike(page, "reflow");
      r.landscape.push(
        await record(page, tag(`landscape-${path.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "landing"}`)),
      );
      await page.setViewportSize(vp);
      await spike(page, "reflow");
      r.landscape.push(
        await record(
          page,
          tag(`portrait-again-${path.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "landing"}`),
        ),
      );
    }
    await load(page, urlFor("/points/statement", params));
    await page.setViewportSize({ width: 800, height: vp.height });
    await spike(page, "reflow");
    r.breakpoint = [await record(page, tag("medium-800"))];
    await page.setViewportSize(vp);
    await spike(page, "reflow");
    r.breakpoint.push(await record(page, tag("back-to-phone")));

    // Command sheet: its field at the bottom; type and go.
    await load(page, urlFor("/", params));
    await tap(page, '#bottombar [data-slot="command"]', p.touch);
    await page.locator("#cmd-input").fill("transfer");
    r.command = await step("command-sheet");
    const fieldBelowList = await page.evaluate(() => {
      const f = document.getElementById("cmd-input")!.getBoundingClientRect();
      const first = document.querySelector("#cmd-list .cmd-opt")?.getBoundingClientRect();
      return { fieldTop: f.top, firstResultBottom: first?.bottom ?? null, viewport: window.innerHeight };
    });
    r.commandOrder = {
      ...fieldBelowList,
      ok:
        fieldBelowList.firstResultBottom !== null &&
        fieldBelowList.firstResultBottom <= fieldBelowList.fieldTop + 1 &&
        fieldBelowList.fieldTop >= 0.6 * fieldBelowList.viewport,
    };
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.pathname.endsWith("/points/transfer")).catch(() => undefined);
    r.commandResult = await spike(page, "state").then((s: Json) => s.path);

    // The You sheet and the swap toggle: Classic view goes to the classic mirror with ?as= kept; ?experience=town
    // brings the viewer back and sets the override.
    await load(page, urlFor("/points/statement", { ...params, as: "maya-ortiz" }));
    await tap(page, '#bottombar [data-slot="you"]', p.touch);
    r.you = await step("you-sheet");
    const townPath = new URL(page.url()).pathname;
    // Click the label, not check(): choosing Classic navigates away at once, so check() never sees the radio
    // checked on this page and retries until it times out.
    await page.locator('label[for="exp-classic"]').click();
    await page.waitForURL((u) => !u.pathname.startsWith("/town"), { timeout: 10_000 }).catch(() => undefined);
    const classicUrl = new URL(page.url());
    const back = urlFor("/points/statement", { ...params, as: "maya-ortiz", experience: "town" });
    await load(page, back);
    const exp = await spike(page, "experience");
    r.swap = {
      townPath,
      classicPath: classicUrl.pathname,
      classicSearch: classicUrl.search,
      backPath: new URL(page.url()).pathname,
      backSearch: new URL(page.url()).search,
      override: exp.override,
      ok:
        classicUrl.pathname === "/points" &&
        classicUrl.searchParams.get("as") === "maya-ortiz" &&
        !classicUrl.searchParams.has("backend") &&
        new URL(page.url()).pathname.endsWith("/points/statement") &&
        !new URL(page.url()).searchParams.has("experience") &&
        exp.override === "town",
    };
    // Boot rule: with the override "classic", a town URL lands on Classic before any content renders.
    await page.evaluate(() => localStorage.setItem("plinth.experience", "classic"));
    await page.goto(urlFor("/points", { as: "maya-ortiz" }));
    await page.waitForURL((u) => !u.pathname.startsWith("/town"), { timeout: 10_000 }).catch(() => undefined);
    r.bootRedirect = { url: page.url(), ok: new URL(page.url()).pathname === "/points" };
    await page.evaluate(() => localStorage.setItem("plinth.experience", "town")).catch(() => undefined);
  } catch (e) {
    r.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
  }
  r.console = o.log;
  await o.ctx.close();
  return r;
};

// ---------------------------------------------------------------- 2. transitions

const runTransitions = async (p: Profile, backend: "webgpu" | "default"): Promise<Json> => {
  const tag = (s: string) => `${p.name}-${backend}-${s}`;
  const out: Json = { profile: p.name, backend };
  const o = await openContext(p);
  try {
    await load(o.page, urlFor("/", { motion: "full" }));
    for (const [name, path] of [
      ["zoom-landing-street", "/city/b/rewards"],
      ["zoom-street-bank", "/points"],
      ["zoom-lobby-room", "/points/statement"],
      ["zoom-room-lobby", "/points"],
    ] as const) {
      await spike(o.page, "go", path, { pauseAt: 0.5 });
      const mid = await spike(o.page, "state");
      const file = await shot(o.page, tag(name));
      await spike(o.page, "resume");
      const after = await spike(o.page, "state");
      out[name] = {
        mid: mid.transition,
        shot: file,
        after: { view: after.view, activeElement: after.activeElement },
        doubleText: await spike(o.page, "doubleText"),
      };
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  out.console = o.log;
  await o.ctx.close();
  // Reduced motion: a crossfade of at most 200 ms (timed with harness overhead), focus on the new heading.
  const rm = await openContext(p, { reducedMotion: "reduce" });
  try {
    await load(rm.page, urlFor("/", { motion: "reduced" }));
    const go = await spike(rm.page, "go", "/city/b/rewards");
    const st = await spike(rm.page, "state");
    out.reduced = {
      ms: go.ms,
      transitionMs: go.transitionMs ?? null,
      activeElement: st.activeElement,
      view: st.view,
    };
  } catch (e) {
    out.reducedError = e instanceof Error ? e.message : String(e);
  }
  await rm.ctx.close();
  return out;
};

// ---------------------------------------------------------------- 3. C10: text integrity

const runC10 = async (): Promise<Json> => {
  const out: Json = {};
  // (b) to (d): GPU text forced in narrow panes with a fine pointer, at DPR 2.625 (412 × 915).
  const fine: Profile = {
    name: "c10-gputext",
    engine: "chromium",
    viewport: { width: 412, height: 915 },
    dpr: 2.625,
    touch: false,
  };
  const o = await openContext(fine, { finePointer: true });
  out.gpuText = [];
  try {
    for (const path of ["/", "/points", "/points/statement"]) {
      await load(o.page, urlFor(path, { text: "gpu" }));
      const rec = await record(
        o.page,
        `c10-gputext-${path.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "landing"}`,
        24,
      );
      const alignment = await spike(o.page, "alignment");
      const dpr = await o.page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>("canvas#scene");
        return c
          ? {
              backing: [c.width, c.height],
              css: [c.clientWidth, c.clientHeight],
              dpr: window.devicePixelRatio,
            }
          : null;
      });
      out.gpuText.push({
        path,
        record: rec,
        alignment: {
          count: alignment.count,
          shareWithin1px: alignment.shareWithin1px,
          maxDelta: alignment.maxDelta,
          fallback: alignment.fallback,
          failing: alignment.failing.slice(0, 10),
        },
        canvas: dpr,
      });
    }
  } catch (e) {
    out.gpuTextError = e instanceof Error ? e.message : String(e);
  }
  out.gpuTextConsole = o.log;
  await o.ctx.close();

  // (e) OffscreenCanvas deleted before boot, on every phone project; then each init step forced to fail.
  out.noOffscreen = [];
  out.faults = [];
  for (const p of [PHONE390, PIXEL7, IPHONE13]) {
    const n = await openContext(p, { noOffscreen: true });
    try {
      await load(n.page, urlFor("/points/statement", {}));
      const st = await spike(n.page, "state");
      const be = await spike(n.page, "backend");
      out.noOffscreen.push({
        profile: p.name,
        offscreen: be.offscreenCanvas,
        mode: st.mode,
        errors: st.errors,
        doubleText: await spike(n.page, "doubleText"),
        shot: await shot(n.page, `c10-no-offscreen-${p.name}`),
        pageErrors: n.log.filter((l) => l.type === "pageerror"),
      });
    } catch (e) {
      out.noOffscreen.push({ profile: p.name, error: e instanceof Error ? e.message : String(e) });
    }
    await n.ctx.close();
    for (const fail of ["init", "warmup", "text-surface", "first-frame"]) {
      const f = await openContext(p);
      try {
        await load(f.page, urlFor("/points", { fail }));
        await spike(f.page, "waitFrame");
        const st = await spike(f.page, "state");
        const probe = await f.page.evaluate(() => {
          const h1 = document.getElementById("bank-title");
          return {
            canvas: !!document.querySelector("canvas#scene"),
            h1Color: h1 ? getComputedStyle(h1).color : null,
            notice: document.getElementById("updates")?.textContent ?? "",
          };
        });
        out.faults.push({
          profile: p.name,
          fail,
          mode: st.mode,
          view: st.view,
          probe,
          pageErrors: f.log.filter((l) => l.type === "pageerror"),
          ok:
            st.mode === "plain" &&
            !probe.canvas &&
            /plain view/.test(probe.notice) &&
            f.log.every((l) => l.type !== "pageerror"),
        });
      } catch (e) {
        out.faults.push({
          profile: p.name,
          fail,
          error: e instanceof Error ? e.message : String(e),
          ok: false,
        });
      }
      await f.ctx.close();
    }
  }
  return out;
};

// ---------------------------------------------------------------- 4. C14: main-thread cost and loading
//
// C14's loading budgets are about what a phone downloads, so they are measured against the PRODUCTION build
// (`vite build`, base /town/), served compressed (gzip) by a small static server started here, not the Vite dev
// server (unbundled modules, no minification: run 1 measured 4.7 MB and t1 25.8 s there). The server serves
// packages/town-spike/dist under /town/ with the SPA fallback and proxies /api to the API process; /rt is not
// proxied (the realtime socket is not on the critical path to t1 or t3).

const REPO = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(REPO, "packages", "town-spike", "dist");
const PROD_PORT = Number(process.env["TOWN_SPIKE_PROD_PORT"] ?? 5181);
const API_URL = new URL(process.env["PLINTH_API_URL"] ?? "http://127.0.0.1:8782");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
};

const buildProduction = (): { ok: boolean; output: string } => {
  const res = spawnSync("pnpm", ["--filter", "@plinth/town-spike", "build"], {
    cwd: REPO,
    shell: true,
    encoding: "utf8",
  });
  return { ok: res.status === 0, output: `${res.stdout ?? ""}${res.stderr ?? ""}`.slice(-4000) };
};

const serveProduction = (): Promise<Server> =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${PROD_PORT}`);
      if (url.pathname.startsWith("/api/")) {
        const up = httpRequest(
          {
            host: API_URL.hostname,
            port: API_URL.port,
            method: req.method,
            path: url.pathname.replace(/^\/api/, "") + url.search,
            headers: { ...req.headers, host: API_URL.host },
          },
          (r) => {
            res.writeHead(r.statusCode ?? 502, r.headers);
            r.pipe(res);
          },
        );
        up.on("error", () => {
          res.writeHead(502);
          res.end();
        });
        req.pipe(up);
        return;
      }
      if (!url.pathname.startsWith("/town")) {
        res.writeHead(404);
        res.end();
        return;
      }
      void (async () => {
        const rel = normalize(decodeURIComponent(url.pathname.replace(/^\/town\/?/, ""))).replace(
          /^(\.\.[\\/])+/,
          "",
        );
        let file = join(DIST, rel);
        const isFile = await stat(file)
          .then((st) => st.isFile())
          .catch(() => false);
        if (!isFile) file = join(DIST, "index.html"); // the SPA fallback for every town route
        const body = await readFile(file);
        const type = TYPES[extname(file)] ?? "application/octet-stream";
        const gzip = /gzip/.test(String(req.headers["accept-encoding"] ?? "")) && !/png|woff2/.test(type);
        const out = gzip ? gzipSync(body, { level: 9 }) : body;
        res.writeHead(200, {
          "content-type": type,
          "content-length": out.length,
          "cache-control": "no-cache",
          ...(gzip ? { "content-encoding": "gzip" } : {}),
        });
        res.end(out);
      })().catch(() => {
        res.writeHead(500);
        res.end();
      });
    });
    server.on("error", reject);
    server.listen(PROD_PORT, () => resolve(server));
  });

const runC14 = async (): Promise<Json> => {
  const build = buildProduction();
  if (!build.ok) return { error: "vite build failed", build: build.output };
  const server = await serveProduction();
  const prodBase = `http://localhost:${PROD_PORT}/town/`;
  const o = await openContext(PHONE390);
  const out: Json = {
    served: { base: prodBase, build: "vite build (production), gzip level 9" },
    profile: "phone390",
    cpuThrottle: 4,
    network: { downKbit: 1600, upKbit: 750, latencyMs: 150 },
  };
  try {
    const cdp = await o.ctx.newCDPSession(o.page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1600 * 1000) / 8,
      uploadThroughput: (750 * 1000) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await load(o.page, new URL("points/statement", prodBase).toString());
    out.loading = await spike(o.page, "loading");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    out.statementScroll = await spike(o.page, "frameStats", 120, { scroll: "window" });
    await spike(o.page, "go", "/city/b/rewards");
    await o.page.waitForTimeout(1500);
    out.streetScroll = await spike(o.page, "frameStats", 120, { scroll: "window" });
    await spike(o.page, "go", "/");
    out.landingFrames = await spike(o.page, "frameStats", 60);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  out.console = o.log;
  await o.ctx.close();
  await new Promise<void>((r) => server.close(() => r()));
  return out;
};

// ---------------------------------------------------------------- 5. desktop, the expansion pass

const runDesktop = async (backend: "webgpu" | "webgl2"): Promise<Json> => {
  const tag = (s: string) => `desktop-${backend}-${s}`;
  const params: Record<string, string> = backend === "webgl2" ? { backend: "webgl2" } : {};
  const o = await openContext(DESKTOP);
  const { page } = o;
  const r: Json = { backend, steps: [] as Json[] };
  const step = async (name: string) => {
    o.scene.name = name;
    const rec = await record(page, tag(name), 24);
    r.steps.push(rec);
    return rec;
  };
  try {
    await load(page, urlFor("/", params));
    r.backendInfo = await spike(page, "backend");
    r.vista = await step("vista");
    r.vistaFrames = await spike(page, "frameStats", 240);
    await page.locator('.camera-tools [aria-label="Orbit right"]').click();
    r.vistaOrbit = await step("vista-orbit");
    await page.locator('.tile[data-borough="rewards"] a').click();
    await page.waitForFunction(() => location.pathname.includes("/city/b/rewards"));
    await page
      .waitForFunction(
        () => {
          const s = (
            window as unknown as { __spike: { street(): { bands: { baked: boolean }[] } | null } }
          ).__spike.street();
          return !!s && s.bands.every((b) => b.baked);
        },
        null,
        { timeout: 15_000 },
      )
      .catch(() => undefined);
    r.street = await step("street");
    r.streetLinks = await spike(page, "street");
    await page.locator('a.lot[data-building="bank"]').click();
    await page.waitForFunction(() => location.pathname.endsWith("/points"));
    r.interior = await step("interior");
    r.interiorStaticFrames = await spike(page, "frameStats", 120);
    const box = await page.locator(".room[data-room=statement] .scroller").boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 8; i++) {
        await page.mouse.wheel(0, 320);
        await spike(page, "waitFrame");
      }
    }
    r.interiorScrolled = await step("interior-scrolled");
    r.alignment = await spike(page, "alignment");
    r.lineBreakParity = await spike(page, "lineBreakParity");
    r.interiorScrollFrames = await spike(page, "frameStats", 240, { scroll: "table" });
    // C6: one cell, then three rows.
    await page.locator(".room[data-room=statement] .scroller").focus();
    const one = await spike(page, "selectTable", 2);
    await page.keyboard.press("Control+C");
    const oneClip = await readClipboard(page);
    const many = await spike(page, "selectTable", 3, 5);
    await page.keyboard.press("Control+C");
    const manyClip = await readClipboard(page);
    r.copy = {
      singleCell: { expected: one?.expected, clipboard: oneClip, ok: eol(oneClip) === one?.expected },
      threeRows: { expected: many?.expected, clipboard: manyClip, ok: eol(manyClip) === many?.expected },
    };
    await page.evaluate(() => document.getSelection()?.removeAllRanges());
    // Flow ribbon.
    await page.locator(".room[data-room=statement] .seg:nth-child(2)").click();
    await page
      .waitForFunction(() => !!document.querySelector(".ribbon-band[data-baked]"), null, { timeout: 8000 })
      .catch(() => undefined);
    r.ribbon = await step("ribbon");
    await page.locator(".room[data-room=statement] .seg:nth-child(1)").click();
    // C7: typing in the Transfer room (beside the lobby).
    await page.locator('a.card-head[data-room-link="transfer"]').click();
    await page.waitForFunction(() => location.pathname.endsWith("/points/transfer"));
    const typed = { Recipient: "jonas-becker", Amount: "25", Memo: "Spike typing check" };
    const values: Record<string, string> = {};
    const colors: Record<string, string> = {};
    for (const [label, text] of Object.entries(typed)) {
      const input = page.getByLabel(label, { exact: true });
      await input.click();
      await input.pressSequentially(text, { delay: 10 });
      values[label] = await input.inputValue();
      colors[label] = await input.evaluate((el) => getComputedStyle(el).color);
    }
    r.formTyped = await step("form-typed");
    await page.locator(".room[data-room=transfer] .dock-btn.primary").click();
    await spike(page, "waitFrame");
    const confirm = await page
      .locator('[data-step="confirm"]')
      .innerText()
      .catch(() => "");
    r.formConfirm = await step("form-confirm");
    r.form = {
      values,
      inputColors: colors,
      ok:
        Object.entries(typed).every(([k, v]) => values[k] === v) &&
        Object.values(colors).every((c) => !/rgba\(.*,\s*0\)$/.test(c) && c !== "transparent") &&
        confirm.includes("jonas-becker") &&
        confirm.includes("Spike typing check"),
    };
    // C9: Escape walks back up; focus lands on each view's heading; nothing painted is stale.
    await page.locator("#transfer-title").focus();
    await page.keyboard.press("Escape");
    await settle(page);
    r.afterEscape1 = await spike(page, "state");
    await page.keyboard.press("Escape");
    await settle(page);
    r.afterEscape2 = await spike(page, "state");
    r.staleAfter = await spike(page, "staleRuns");
  } catch (e) {
    r.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
  }
  r.console = o.log;
  await o.ctx.close();
  return r;
};

/** C8 on a phone and on the desktop: readable Plat text, no canvas. */
const runPlainLike = async (p: Profile, kind: "plain" | "forced-colors"): Promise<Json> => {
  const o = await openContext(p, kind === "forced-colors" ? { forcedColors: "active" } : {});
  try {
    await load(o.page, urlFor("/points/statement", kind === "plain" ? { plain: "1" } : {}));
    const file = await shot(o.page, `${p.name}-${kind}`);
    const probe = await o.page.evaluate(() => {
      const canvas = document.querySelector("canvas#scene");
      const el = document.querySelector(".items .primary, table.ledger td:nth-child(4)");
      const h = document.querySelector("#statement-title");
      const alpha = (e: Element | null) => {
        if (!e) return null;
        const c = getComputedStyle(e).color;
        const m = c.match(/rgba?\(([^)]+)\)/);
        const parts = m ? m[1]!.split(",").map((s) => s.trim()) : [];
        return parts.length === 4 ? Number(parts[3]) : c === "transparent" ? 0 : 1;
      };
      return {
        canvasPresent: !!canvas,
        firstLine: el?.textContent ?? null,
        lineAlpha: alpha(el),
        headingAlpha: alpha(h),
      };
    });
    await o.ctx.close();
    return {
      profile: p.name,
      kind,
      shot: file,
      probe,
      ok: !probe.canvasPresent && probe.lineAlpha === 1 && probe.headingAlpha === 1 && !!probe.firstLine,
    };
  } catch (e) {
    await o.ctx.close();
    return { profile: p.name, kind, error: e instanceof Error ? e.message : String(e), ok: false };
  }
};

/** Optional: the live swap. Flip the site default to Classic as an admin; a tab following the site leaves. */
const runLiveSwap = async (): Promise<Json> => {
  const o = await openContext(PIXEL7);
  const out: Json = {};
  try {
    await load(o.page, urlFor("/points", {}));
    await o.page.evaluate(() => localStorage.removeItem("plinth.experience")); // follow the site
    const call = (experience: string) =>
      o.page.evaluate(async (exp) => {
        const res = await fetch("/api/suite/actions/site.appearance.set", {
          method: "POST",
          headers: { authorization: "Bearer dev-user-maya-ortiz", "content-type": "application/json" },
          body: JSON.stringify({ input: { experience: exp } }),
        });
        return res.status;
      }, experience);
    const before = await spike(o.page, "experience");
    out.before = before;
    out.setStatus = await call("classic");
    await o.page
      .waitForURL((u) => !u.pathname.startsWith("/town"), { timeout: 15_000 })
      .catch(() => undefined);
    out.after = o.page.url();
    out.ok = !new URL(o.page.url()).pathname.startsWith("/town");
    out.restoreStatus = await call(before.site ?? "classic");
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  await o.ctx.close();
  return out;
};

// ---------------------------------------------------------------- verdicts

const every = <T>(xs: T[] | undefined, f: (x: T) => boolean) => !!xs && xs.length > 0 && xs.every(f);

const verdicts = (rep: Json) => {
  const phones: Json[] = rep.phones ?? [];
  const desk = (b: string) => rep.desktop?.[b] ?? {};
  const steps = (r: Json): Json[] => [...(r.steps ?? []), ...(r.landscape ?? []), ...(r.breakpoint ?? [])];
  const noDouble = (s: Json) => Array.isArray(s.doubleText) && s.doubleText.length === 0;
  const errs = (r: Json) =>
    (r.console ?? []).filter((l: Logged) => l.type === "pageerror" || l.type === "error");
  const both = (f: (r: Json) => boolean) =>
    ["webgpu", "webgl2"].every((b) => {
      try {
        return f(desk(b));
      } catch {
        return false;
      }
    });
  return {
    C1_alignment: both((b) => b.alignment.shareWithin1px >= 0.995),
    C2_lineBreakParity: both((b) => b.lineBreakParity.share >= 0.995),
    C3_interiorFrames: both(
      (b) => b.interiorScrollFrames.frameMs.p95 <= 16.7 && b.interiorStaticFrames.frameMs.p95 <= 16.7,
    ),
    C4_vistaFrames: both((b) => b.vistaFrames.frameMs.p95 <= 16.7),
    C5_webgl2Parity:
      desk("webgpu").backendInfo?.active === "webgpu" &&
      desk("webgl2").backendInfo?.active === "webgl2" &&
      phones.some((p) => p.backend === "webgl2" && p.backendInfo?.active === "webgl2") &&
      both((b) => errs(b).length === 0) &&
      phones.every((p) => errs(p).length === 0) &&
      rep.pixelChecks?.ok === true,
    C6_copy:
      both((b) => b.copy.singleCell.ok && b.copy.threeRows.ok) &&
      phones.every(
        (p) => p.selectCopy?.ok && p.memoSelection && p.memoSelection.selection === p.memoSelection.expected,
      ),
    C7_typing: both((b) => b.form.ok) && phones.every((p) => p.typing?.ok && p.keyboard?.ok),
    C8_plainAndForcedColors: every(rep.plainLike, (x: Json) => x.ok),
    C9_navigationFocus:
      every(
        rep.transitions,
        (t: Json) =>
          ["zoom-landing-street", "zoom-street-bank", "zoom-lobby-room", "zoom-room-lobby"].every((k) =>
            /^h[12]#/.test(String(t[k]?.after?.activeElement)),
          ) &&
          (typeof t.reduced?.transitionMs === "number"
            ? t.reduced.transitionMs <= 200
            : t.reduced?.ms <= 400) &&
          /^h1#street-title/.test(String(t.reduced?.activeElement)),
      ) &&
      both(
        (b) =>
          b.afterEscape1?.view === "bank" && b.afterEscape2?.view === "street" && b.staleAfter?.stale === 0,
      ),
    C10_textIntegrity:
      phones.every((p) => every(steps(p), noDouble) && (p.keyboardDoubleText ?? []).length === 0) &&
      every(
        rep.c10?.gpuText,
        (g: Json) =>
          noDouble(g.record) &&
          (g.alignment.count === 0 || g.alignment.maxDelta <= 1) &&
          (g.alignment.fallback?.share ?? 0) <= 0.005,
      ) &&
      every(
        rep.c10?.noOffscreen,
        (n: Json) =>
          n.offscreen === false &&
          Array.isArray(n.doubleText) &&
          n.doubleText.length === 0 &&
          (n.pageErrors ?? []).length === 0,
      ) &&
      every(rep.c10?.faults, (f: Json) => f.ok),
    C11_C13_realPhones: "not run: needs the two real phones over HTTPS (device reporter)",
    C14_mainThreadAndLoading: rep.c14
      ? {
          statementCpuP95: rep.c14.statementScroll?.cpuMs?.p95 ?? null,
          streetCpuP95: rep.c14.streetScroll?.cpuMs?.p95 ?? null,
          streetCanvasFrames: rep.c14.streetScroll?.canvasFrames ?? null,
          t1: rep.c14.loading?.t1 ?? null,
          t3: rep.c14.loading?.t3 ?? null,
          bytesBeforeT1: rep.c14.loading?.bytesBeforeT1 ?? null,
          bytesBeforeT3: rep.c14.loading?.bytesBeforeT3 ?? null,
          pass:
            (rep.c14.statementScroll?.cpuMs?.p95 ?? 99) <= 6 &&
            (rep.c14.streetScroll?.cpuMs?.p95 ?? 99) <= 6 &&
            (rep.c14.loading?.t1 ?? 1e9) <= 2500 &&
            (rep.c14.loading?.t3 ?? 1e9) <= 4000 &&
            (rep.c14.loading?.bytesBeforeT1 ?? 1e9) <= 170_000 &&
            (rep.c14.loading?.bytesBeforeT3 ?? 1e9) <= 450_000,
        }
      : null,
    phone: {
      landingFitsOneScreen: phones.every(
        (p) => p.landing?.fits === true && p.landing?.verticalScroll === false,
      ),
      tapTargets44: phones.every((p) => every(p.steps, (s: Json) => s.smallTargets.length === 0)),
      bottomBarInRooms: phones.every(
        (p) =>
          !!p.statement?.layout?.bottomBar &&
          !!p.transfer?.layout?.bottomBar &&
          p.statement?.layout?.dockAboveBar,
      ),
      streetLinks: phones.every((p) =>
        every(
          p.street?.bands,
          (b: Json) => b.baked && (b.minLink ?? 0) >= 44 && b.overlaps === 0 && b.canvasInScroller,
        ),
      ),
      streetScrollDrawsNoCanvasFrame: phones.every((p) => p.streetScroll?.canvasFrames === 0),
      flowAtMost35: phones.every((p) => p.flow?.ok),
      commandFieldAtBottom: phones.every((p) => p.commandOrder?.ok),
      swapRoundTrip: phones.every((p) => p.swap?.ok && p.bootRedirect?.ok),
      hybridTextOnPhones: phones.every((p) =>
        every(p.steps, (s: Json) => s.textMode === "hybrid" || s.mode === "plain"),
      ),
      landscapeFits: phones.every((p) =>
        every(
          (p.landscape ?? []).filter((s: Json) => /landscape-landing/.test(s.tag)),
          (s: Json) => s.layout.landingFits,
        ),
      ),
    },
    liveSwap: rep.liveSwap ? rep.liveSwap.ok : "not run (set TOWN_SPIKE_LIVE_SWAP=1)",
    note: "Phone criteria come first (spec 00 section 0.8); desktop is the expansion pass. C5 needs the screenshots compared by eye as well as the pixel checks.",
  };
};

// ---------------------------------------------------------------- run

await mkdir(outDir, { recursive: true });
const chrome = await browserFor("chromium");
decoder = await (await chrome.newContext()).newPage();
const report: Json = {
  meta: {
    url: BASE_URL,
    when: new Date().toISOString(),
    chromium: chrome.version(),
    channel: CHANNEL,
    args: ARGS,
  },
  phones: [] as Json[],
  transitions: [] as Json[],
  desktop: {} as Json,
  plainLike: [] as Json[],
};
const safely = async (label: string, f: () => Promise<Json>): Promise<Json> => {
  try {
    const v = await f();
    console.log(`${label}: done`);
    return v;
  } catch (e) {
    console.log(`${label}: failed`);
    return { error: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) };
  }
};

// 1. Phones first.
report.phones.push(await safely("pixel7 webgpu", () => runPhone(PIXEL7, "webgpu")));
report.phones.push(await safely("pixel7 webgl2", () => runPhone(PIXEL7, "webgl2")));
report.phones.push(await safely("iphone13", () => runPhone(IPHONE13, "default")));
// 2. Transitions.
report.transitions.push(await safely("transitions pixel7", () => runTransitions(PIXEL7, "webgpu")));
report.transitions.push(await safely("transitions iphone13", () => runTransitions(IPHONE13, "default")));
// 3, 4. Text integrity and the phone budgets in emulation.
report.c10 = await safely("c10", runC10);
report.c14 = await safely("c14", runC14);
// 5. The expansion pass.
report.desktop.webgpu = await safely("desktop webgpu", () => runDesktop("webgpu"));
report.desktop.webgl2 = await safely("desktop webgl2", () => runDesktop("webgl2"));
for (const p of [PIXEL7, DESKTOP])
  for (const kind of ["plain", "forced-colors"] as const)
    report.plainLike.push(await safely(`${p.name} ${kind}`, () => runPlainLike(p, kind)));
if (LIVE_SWAP) report.liveSwap = await safely("live swap", runLiveSwap);
// 6. Pixels.
report.pixelChecks = pixelChecks();
report.pixels = Object.fromEntries(
  Object.entries(PIXELS).map(([k, v]) => [
    k,
    { nonBlackShare: +v.nonBlackShare.toFixed(4), meanLuma: +v.meanLuma.toFixed(4) },
  ]),
);
report.verdicts = verdicts(report);
for (const b of Object.values(browsers)) await b?.close();
await writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      verdicts: report.verdicts,
      pixelChecks: {
        ok: report.pixelChecks.ok,
        dark: report.pixelChecks.dark,
        cross: report.pixelChecks.cross,
      },
    },
    null,
    2,
  ),
);
