# 03. Rendering

Part of the Township canonical spec (`README.md`). Requirement IDs are `TWN-R-3.<section>.<n>`.

Base: `../proposals/township.md` sections R2, R3.1, R3.2, R7, S and R10. Grafts: Orbit's legibility contract (B.3:
UI text is never tonemapped, bloomed, fogged or blurred) and its Lumen as a real light (here the agent lamp);
Instrument's well and morph shaders; Atelier's stamps and vellum; Constellation's circuit pulses. Facts in
`README.md` section "Canonical facts" override every proposal: the pinned stack is three r187, not r180.

Shader code here is **TSL sketch code**. Every TSL or three API named is marked in section 3.2 as needing a check in
the 0.187 source before it is relied on.

**Mobile first.** `00-mobile-first.md` binds this file. The rendering tiers are defined in `00` section 0.6; the
**Base** tier is the design tier and runs on the mid-range phone. Budgets below are stated for Base on the phone
first, and the reference machine's figures are the expansion. **On phones text is the browser's own** (hybrid text,
section 3.5.7): the GPU paints surfaces, charts, dioramas, the town and transitions, and GPU text is an expansion for
fine-pointer devices at Enhanced and Full. Painted text must still be correct at fractional DPRs and after reflows
wherever it is used, which is where the prototype's "double vision" came from (section 3.5.6).

---

## 3.1 The stack, pinned

| Layer | Package | Exact version | Use |
|---|---|---|---|
| Renderer and scene graph | `three` (`three/webgpu`, `three/tsl`, `three/addons`) | `0.187.0` | `WebGPURenderer`; WebGPU backend first, its WebGL2 backend (`forceWebGL`) second; TSL node materials compile to WGSL and to GLSL ES 3.0 |
| Types | `@types/three` | `0.187.0` | kept in lockstep with three |
| WebGPU types | `@webgpu/types` | `0.1.74` | `navigator.gpu`, adapter limits, `timestamp-query` |
| Runtime SDF glyphs | `@mapbox/tiny-sdf` | `2.3.0` | SDF glyphs for display text, non-Latin singletons and plaques |
| UI font | `@fontsource-variable/inter` | `5.3.0` | the woff2 files loaded both as `FontFace` for the Plat and for canvas measuring and rasterising |
| Mono and tabular font | `@fontsource/jetbrains-mono` | `5.3.0` | hashes, seq numerals, code; tabular numerals (section 3.5.4) |
| Build | `vite` | `7.3.8` | the town app, served under `/town/` (`06` section 6.7) |
| Test runner and browser | `vitest`, `playwright`, `@axe-core/playwright` | as the workspace root (`^4.1.12`, `^1.65.1`, `4.10.2`) | unit, interaction and a11y tests |

**Pinning policy.**

- Exact versions, no carets, in every `packages/town-*/package.json`. The test tools follow the workspace root.
- Every import from `three/webgpu`, `three/tsl` and `three/addons` goes through `packages/town-engine/src/three.ts`,
  so an upstream rename touches one file.
- A three upgrade is its own change: it re-runs the full visual and parity suite on the stack.
- Any further dependency (a visual-diff library, a mesh packer, a texture transcoder) is added only by a change that
  pins it exactly and names the requirement it serves. The procedural kit (`01` section 1.7) means no glTF, KTX2 or
  BVH dependency is needed for the city; they are not part of this spec.

**Not chosen.** Raw WebGPU (every signature pass written twice for the WebGL2 path); Babylon.js (its GUI and text
stack fight Plat-driven layout); troika-three-text (WebGL `ShaderMaterial` only, not node materials); a UI framework
between widgets and the Plat (a second tree to keep in sync).

| ID | Requirement | Test |
|---|---|---|
| TWN-R-3.1.1 | Every `town-*` package pins the versions above exactly. | `scripts/check-pins.mjs` in CI over every `packages/town-*/package.json` and the lockfile. |
| TWN-R-3.1.2 | Only `town-engine/src/three.ts` imports from `three/webgpu`, `three/tsl` or `three/addons`; all other modules import from it. | Dependency lint in `scripts/check-deps.mjs`. |

## 3.2 APIs to verify in the 0.187 source

The proposals named APIs from r180. Each name below is used by this spec and must be confirmed in
`node_modules/three@0.187.0` (source and `@types/three@0.187.0`) before the code that uses it is written. A name that
moved is renamed in `three.ts` and this table is updated in the same change.

| API | Used for | Section |
|---|---|---|
| `WebGPURenderer`, its `forceWebGL` option, `renderer.init()`, `renderer.backend` type check | backend selection | 3.3 |
| `renderer.compileAsync(scene, camera)` | pipeline warm-up | 3.14 |
| post-processing entry point (r180's `PostProcessing`), `pass()`, `mrt()`, `output`, `emissive` | frame graph | 3.7 |
| `three/addons/tsl/display/BloomNode` (`bloom()`), `GaussianBlurNode` (`gaussianBlur()`), `GTAONode` (`ao()`) | post | 3.7 |
| TSL `Fn`, `If`, `Loop`, `Discard`, `select`, `uniform`, `attribute`, `instanceIndex`, `varyingProperty`, `vertexIndex` | all shaders | 3.9 |
| TSL `textureLoad` in a vertex stage on an `RGBA32F` `DataTexture`; `ivec2`, `int` | flow paths, terrain heights | 3.9.3, 3.9.10 |
| TSL `screenUV`, `screenCoordinate`, `screenSize`, `perspectiveDepthToViewZ`, `cameraNear`, `cameraFar`, `positionWorld`, `normalWorld`, `modelViewMatrix`, `cameraProjectionMatrix` | post and effects | 3.9 |
| `MeshStandardNodeMaterial` with `colorNode`, `emissiveNode`, `positionNode`, `outputNode`, `roughnessNode` | uber-material | 3.8 |
| `RenderTarget` with `count` (MRT) and with `depth` layers (array targets) | MRT, pane cards | 3.7, 3.9.1 |
| `renderer.info` counters, `trackTimestamp`, `resolveTimestampsAsync` | budgets and the governor | 3.11, 3.12 |
| `device.lost` handling through the WebGPU backend | device loss | 3.15 |
| `InstancedMesh`, `InstancedBufferAttribute`, `DataTexture`, `PointLight`, `SpotLight` shadow support under node materials | city and lamp | 3.8, 3.9.5 |

| ID | Requirement | Test |
|---|---|---|
| TWN-R-3.2.1 | Each API in the table carries a `// verified-0.187: <file>:<line>` comment at its single import site in `three.ts`. | Lint: every exported binding in `three.ts` has the comment. |

## 3.3 Capability ladder and backends

Decided at boot in `town-engine/src/capability.ts` before any scene work:

```
             ┌─ navigator.gpu ─ requestAdapter() ─ required limits ok ─────────────────────────▶ BACKEND "webgpu"
 boot ───────┤                                                                                  (tier: 00 section 0.6)
             ├─ else canvas.getContext("webgl2") ─ MAX_TEXTURE_SIZE ≥ 4096, EXT_color_buffer_float ─▶ BACKEND "webgl2"
             ├─ else ─────────────────────────────────────────────────────────────────────────▶ REDIRECT to Classic
             │                                                                                   with a notice (6.7)
             ├─ forced-colors active, ?render=plain, preference "Plain", Save-Data,
             │  device lost twice in 60 s ────────────────────────────────────────────────────▶ PLAIN mode (no canvas)
             └─ ANY failure after the probe (renderer.init() rejects, a required pipeline fails to
                compile, the text measurer cannot be created, an exception during the first frame) ─▶ PLAIN mode with
                                                                                                   the notice below
```

- **Init failures end in Plain mode, never in an error screen.** The town app's boot wraps every GPU-side step (probe,
  `renderer.init()`, warm-up, the text measurer, the first frame) in one guard. Any rejection or exception leaves the
  Plat, which has already rendered visibly (section 3.14), in Plain mode, records the reason in `renderStore`, logs one
  `render.init-failed` event, and shows a dismissible notice: "Graphics could not start on this browser; showing the
  plain view." Only a browser with neither WebGPU nor WebGL2 at the probe is redirected to Classic (`06` section
  6.7.5).
- **OffscreenCanvas is optional.** The text measurer and the raster-run rasteriser use `OffscreenCanvas` where it
  exists and a detached `HTMLCanvasElement` (`document.createElement("canvas")`, never attached) otherwise; both are
  wrapped by `town-text/src/surface.ts`, which also supplies `measureText` and `fillText`. Older iOS Safari has no
  `OffscreenCanvas` (the prototype showed only an error there); with the fallback it paints normally. If neither
  surface can produce a 2D context, the app is in Plain mode by the rule above.

- **Required WebGPU limits:** `maxTextureDimension2D ≥ 8192`, `maxColorAttachments ≥ 4`,
  `maxStorageBufferBindingSize ≥ 128 MiB` (we use ≤ 32 MiB). Optional: `float32-filterable` (nearest-sample path
  otherwise), `timestamp-query` (rAF timing otherwise).
- **WebGL2 parity rules** (the feasibility judge's portability findings, made into design constraints):
  1. No compute shaders anywhere. Flows, construction, terrain normals and morphs are analytic in vertex shaders.
  2. No per-attachment blend states: every MRT draw uses one blend state for all attachments. The UI layer is a
     separate pass, not an MRT attachment.
  3. No integer vertex attributes: instance data is `float` or normalised, with indices below 2^24 stored as floats.
  4. No GPU readback for picking (section 3.10).
  5. `RGBA32F` sampled with `textureLoad` in the vertex stage is the one float-texture dependency; the spike (G0,
     criterion C5) proves it on both backends. If it fails on WebGL2, path tables move to `RGBA16F` with a position
     offset per row.
- **Backend and tier are separate axes.** The tier (`00` section 0.6) sets which effects run; the backend only limits
  the Full tier. **Base and Low-power are identical on WebGPU and WebGL2**, which matters because a phone on the LAN
  over plain HTTP, or an older phone, has WebGL2 only. What WebGL2 loses at Enhanced and Full (to be rewritten from
  the spike's C5 findings):

| Effect | WebGPU | WebGL2 |
|---|---|---|
| Tilt-shift (Enhanced, Full) | screen band plus depth-aware circle of confusion | screen band only |
| GTAO (Full) | half resolution | off; baked vertex AO only |
| Bloom (Full) | 6 mip levels | 4 |
| Particle pool (Full) | 24,000 | 8,000 |
| Pane cards (Full) | render-target array, up to 24 layers | individual targets, up to 12 |
| Everything at Base and Low-power | identical | identical |
| Everything that carries meaning (flows, construction, hatch, stamps, text, lamp, dioramas) | identical | identical |

| ID | Requirement | Test |
|---|---|---|
| TWN-R-3.3.1 | A browser with neither WebGPU nor WebGL2 is redirected to the same route in Classic with the notice of `06` section 6.7. | Playwright with WebGPU disabled and `--disable-webgl`; assert the Classic URL and notice. |
| TWN-R-3.3.4 | Any failure after the capability probe (renderer init, pipeline compile, text surface creation, an exception in the first frame) leaves the route in Plain mode with its data and the notice, never an error page or a blank screen. | Fault-injection tests, one per step, via `?test=1` hooks (`__town.failAt("init" \| "warmup" \| "text-surface" \| "first-frame")`) in the phone profile and on WebKit; assert visible Plat text, the notice and no uncaught error. |
| TWN-R-3.3.5 | With `OffscreenCanvas` undefined, text measuring and raster runs use a detached canvas and the painted result passes the same parity and alignment checks. | The text suite run with `globalThis.OffscreenCanvas` deleted before boot, in Chromium and WebKit. |
| TWN-R-3.3.2 | Every scene and effect renders on the WebGL2 backend with no missing effect; degradations are only those listed. | Spike criterion C5, then the visual suite on `?backend=webgl2` on the reference machine; the effects manifest per backend must match the table. |
| TWN-R-3.3.3 | The pipeline inventory contains no compute pipeline and no draw with per-attachment blend states. | Unit test over `pipelines.ts`. |

## 3.4 The legibility contract (Orbit graft)

Hard rules for every renderer path. Each has a test.

1. **UI content is never lit, bloomed, fogged, blurred, tone-mapped or colour-graded.** Pane faces, text, rules,
   icons, chart marks, plaques, stamps' text, the HUD and toasts render in the **UI pass**, after all scene
   post-processing, straight to the canvas. Their colours are the look's tokens exactly.
2. **The pane face is the token colour.** Shadows, rims and the agent lamp's rim glow fall outside the face.
3. **At rest, UI is 1:1 and pixel-snapped.** Pane origins and glyph baselines sit on integer device pixels;
   projected scale is 1 within 0.1 %; rotation is 0.
4. **Data marks are never foreshortened outside a diorama viewport.** Dioramas draw under their own camera and always
   have a flat twin (`02` section 2.5).
5. **Motion never carries information alone.** Every animated cue has a text or glyph equivalent that stays after
   the motion ends.
6. **Text in the city is screen-space.** Plaques and stamp labels are camera-facing quads anchored to projected
   world points, snapped, drawn in the UI pass on opaque plates.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-3.4.1 | No UI-pass draw samples the HDR, emissive, bloom, fog, tilt-shift or grade targets, and the UI pass runs after the grade. | Frame-graph unit test over pass inputs and order. |
| TWN-R-3.4.2 | Pane face pixels equal the token colour exactly (ΔE = 0 in 8-bit sRGB) in every look and theme, outside glyphs and rules. | Render test on the reference machine: sample 200 face pixels per pane on three routes × 12 look variants. |
| TWN-R-3.4.3 | At rest, every pane origin and glyph baseline is on an integer device pixel at DPR 1, 1.25, 1.5, 2, 2.625 and 3, using the snapping rule of section 3.5.6 rule 4. | Painter unit test with fractional layouts; render test at each DPR. |

## 3.5 The text pipeline

Text is laid out by the browser in the Plat and painted on the GPU. The Plat and the painter load the same woff2
files from the pinned fontsource packages as `FontFace` objects, so metrics agree by construction.

```
 Plat (DOM, transparent text)      town-text                                             GPU
 <td class="num">12,480</td>  ──▶ 1. read run: text, font, size, weight, spacing, align  glyph instances (32 B)
                                   2. segment: Intl.Segmenter (grapheme, word)           one draw per atlas page
                                   3. measure: OffscreenCanvas measureText, same FontFace
                                   4. break to the Plat box width
                                   5. guard: predicted line count vs measured height
                                   6. choose path per run: raster run | dynamic SDF
                                   7. place glyphs; snap baselines to device pixels
```

### 3.5.1 Glyph paths

| Path | When | How |
|---|---|---|
| **Raster runs** | text below 15 device px (body and table text at DPR 1), every complex-script run, every RTL run, emoji | the whole run drawn with `fillText` into an `OffscreenCanvas` with the same font string, packed into an R8 run atlas (shelf packer, LRU by last frame used, keyed by `font|size|dpr|text|spacing`); colour emoji go to an RGBA8 page. This is the browser's own rasterisation and shaping (HarfBuzz or CoreText), so small text looks as the DOM's does. |
| **Dynamic SDF** | text of 15 device px and above (titles, KPIs, plaques, stamps), and single non-Latin glyphs inside Latin runs at those sizes | `@mapbox/tiny-sdf` at a 48 px em into an R8 SDF page; the fragment shader uses `fwidth` for a screen-space edge |
| **MSDF atlases** | deferred | built only if G0 or G1 shows dynamic SDF failing quality (SSIM below the K1 line) or cost (glyph upload stalls); it would need a pinned build-time generator |

### 3.5.2 Line breaking and the runtime guard

The engine breaks lines with `Intl.Segmenter` word boundaries and measured advances. The feasibility judge found
Township's tolerance ("≥ 99.5 % parity") would ship visibly wrong pages. Ruling:

- **No mismatched run is ever painted.** In the read batch (section 3.6) the painter already has each text element's
  measured height and box. An element is handed to DOM paint (`data-paint="dom"`: its Plat text becomes visible,
  `color: var(--ink)`, and the GPU skips it) when **any** of these holds:
  1. `lines × lineHeight` predicted by the engine differs from the measured height by more than half a line;
  2. the engine's predicted line box for any line differs from the browser's (`Range.getClientRects()` on that
     element, sampled in the read batch for elements whose epoch changed) by more than 1 CSS px on any edge;
  3. the element's text overflows its clip and the browser would show an ellipsis the engine cannot reproduce
     exactly (section 3.5.6 rule 1).
  The swap is per element and lasts until the element's epoch changes, when it is re-checked.
- **CI holds the line-start check.** The parity sweep compares engine line starts with `Range.getClientRects()` for
  every run on every route; any painted run that differs fails the build.
- **The fallback rate is a kill signal.** If more than 0.5 % of text elements fall back to DOM paint across the
  sweep, kill criterion K1 fires (`07` section 7.5) and the whole app moves to visible Plat text with GPU surfaces.

### 3.5.3 Scroll hand-off

Native scrolling of the Plat can lead the canvas by a frame on a fling (the access and feasibility judges' finding),
and on a phone the compositor scrolls at the display's rate (up to 120 Hz) while the canvas may draw at 60. Ruling,
designed for the phone: **while a registered scroller is scrolling, everything inside it is drawn by the DOM.**

- A passive `scroll` listener sets `data-scrolling` on the scroller; the stylesheet makes its text visible
  (`color: var(--ink)`) and gives its painted surfaces their CSS equivalents (row stripes, rules, field chrome, item
  backgrounds, the selection tint, all from the same tokens), and the painter stops emitting anything inside that
  scroller's clip. Because the pane face is the token colour (legibility contract rule 2), the swap is not visible.
- 120 ms after the last scroll event the painter re-reads the scroller's offset, paints its contents in the next frame,
  and only then clears `data-scrolling`, in the same frame, so no frame shows the scroller's text twice or not at all.
- Small text is a raster run, the browser's own rasterisation, so the hand-off is not visible at rest sizes; the
  spike (C1, C10) measures the rest of the difference.
- **Under hybrid text** (every coarse-pointer device, and Base and Low-power always; section 3.5.7) text is DOM text at
  all times, so the hand-off concerns only surfaces.
- **A borough street is not an exception:** its buildings are baked band images inside the scroller, moved by the
  compositor like any DOM content, and its live effects fade out while it scrolls (`01` section 1.4.3).

### 3.5.4 Numerals

- Canvas 2D cannot enable OpenType features, so `measureText` and `fillText` cannot match DOM text set with
  `font-variant-numeric: tabular-nums` (finding of the spike). Ruling: **numeric cells, KPIs, balances, seq numbers
  and counts use a face whose default figures are tabular.** The spike uses JetBrains Mono. The owner may choose a
  feature-frozen Inter subset instead (open question, README); the Plat and painter use the same face either way.
- Figures never change width when they change. Digit rolls (balance chip, KPI tiles, counts) render each digit column
  as a strip of the ten digits and scroll its UV: no layout, no glyph upload.

### 3.5.5 Other rules

- **Weight compensation.** In dark looks, SDF text below 20 CSS px gets a threshold offset of +0.04.
- **Directionality.** The Plat sets `lang` and `dir`; RTL and complex scripts are raster runs.
- **Fallback chain:** `"Inter", system-ui, "Segoe UI", "Noto Sans", "Hiragino Sans", "PingFang SC", "Microsoft
  YaHei", sans-serif` for the Plat; the raster-run path inherits the browser's fallback for free.
- **Dates and times** are UTC with the zone shown and `<time datetime>` in the Plat; grouping follows the viewer's
  locale through `Intl.NumberFormat`.
- **Type scale** is the design-system scale (`--step--2` to `--step-3`) read in CSS px from the Plat. Body
  line-height 1.45, titles 1.15, long-form reading 17 px (compact) or 18 px (wider) at 1.55 with at most a
  68-character measure.

### 3.5.6 Text integrity: one copy, in the right place, inside its clip

The owner saw "double vision" text on a phone running the prototype in emulation (Pixel 7 in Chrome at DPR 2.625,
iPhone 13 in WebKit). The coordinator traced four causes: painted text was not clipped by its Plat ancestors'
`overflow`, so KPI values in narrow tiles painted over their neighbours; painted runs drifted up to 52 px from their
DOM boxes after the narrow-layout reflow, with only 70.6 % of runs within 1 px; some Plat text (breadcrumbs) was never
made transparent, so two copies showed; and older iOS Safari has no `OffscreenCanvas`, so the app showed only an
error. Each becomes a rule with a test.

1. **Painted text respects the ancestor clip chain, including ellipsis.** In the read batch, each text item records
   the intersection of the clip rects of every ancestor up to the pane root whose computed `overflow-x` or
   `overflow-y` is not `visible` (and of any `clip-path: inset()` or `contain: paint` ancestor), in the same
   scroller-relative space as its rect (`PaintItem.clip`, `04` section 4.1.1). The glyph shader discards fragments
   outside it (a scissor per pane plus a per-instance clip rect). Where the element itself has
   `text-overflow: ellipsis` and its text overflows, the engine shapes the same truncated string the browser shows
   (measured to the clip width minus the ellipsis advance, cut at a grapheme boundary) and paints the ellipsis glyph;
   if the browser's visible string cannot be determined exactly (`Range` over the visible line differs from the
   engine's truncation), the element goes to DOM paint (section 3.5.2 condition 3). Multi-line clamps
   (`-webkit-line-clamp`) are always DOM-painted.
2. **One copy of every text, never two: painted-with-transparent-DOM XOR visible-DOM.** Every Plat text element is in
   exactly one of two states: **painted** (`data-paint="gpu"`: computed text colour alpha 0 and glyph instances
   present) or **DOM** (`data-paint="dom"` or no PaintSpec: computed text colour alpha 1 and no glyph instances). The
   transparency is set by one stylesheet rule keyed on `data-paint="gpu"`, and only the painter sets that attribute,
   in the same frame in which it first emits the element's glyphs (and removes it in the frame it stops). No other
   rule may make Plat text transparent, and no text is visible without a PaintSpec decision: shell chrome
   (breadcrumbs, top bar, bottom bar, sheets) goes through the same registry as panes. The development and test
   builds expose `__town.doubleText()`, which walks the Plat and returns every text element that is both painted and
   visible, every painted element whose DOM text is visible, and every visible text element with neither state
   recorded; an empty result is the invariant.
3. **The runtime per-element parity fallback and the app-wide fallback.** The per-element guard of section 3.5.2
   hands any mismatching element to DOM paint at runtime on the viewer's device, so a parity failure in the field shows
   one correct copy, not two. If on a device the DOM-fallback share exceeds 2 % of text elements on the current route,
   or the guard fires on more than 20 elements in one frame, the tab switches to **hybrid text** for the session (all
   Plat text visible, the GPU paints surfaces only, K1's form) and logs `text.k1-local`. Across CI, a fallback share
   above 0.5 % fires kill criterion K1 for the whole app (`07` section 7.5).
4. **Device-pixel snapping at fractional DPR.** Positions are snapped in device pixels, never in CSS px: a glyph
   baseline is `round(cssY × dpr) / dpr`, a pane origin likewise, and the raster run is rasterised at the device scale
   with its origin fraction removed. The canvas's backing size is `round(cssWidth × dpr)` by
   `round(cssHeight × dpr)` (from `ResizeObserver`'s `devicePixelContentBoxSize` where available), and the CSS-to-device
   scale used by every shader is that backing size divided by the canvas's CSS size, so that at DPR 2.625 the scale is
   exact and the error does not accumulate down a long page.
5. **Every reflow re-reads.** A container-query layout change (a breakpoint crossing), an orientation change, the
   on-screen keyboard resizing the visual viewport, a text-size change and `visualViewport` scale changes bump the epoch
   of every affected pane, and the read batch re-reads before the next paint. Until a pane has been re-read after such a
   change, its text is DOM text (the scroll hand-off rule), so stale positions are never painted. This removes the
   prototype's post-reflow drift.

| ID | Requirement | Test |
|---|---|---|
### 3.5.7 Hybrid text is the phone default

**Decision (mobile review, finding 11).** On every device whose primary pointer is coarse, and at the Base and
Low-power tiers on any device, the town app runs **hybrid text**: every Plat text node is visible DOM text, and the GPU
paints pane surfaces and shadows, rules, icons, chart marks, the hatch, the agent rim, dioramas, the town and the
transitions. GPU text (raster runs and SDF) is used only at Enhanced and Full with a fine pointer.

Why:

- **The evidence.** The prototype's phone-emulation run showed the phone interior is where painted text breaks (no
  clipping, drift after reflow, doubled copies, 70.6 % of runs within 1 px), and the runtime guard's own design hands a
  phone's text to the DOM whenever it scrolls, reflows or the keyboard opens, which on a phone is most of the time.
  GPU text on a phone would mostly be DOM text with swaps at every stop.
- **What it costs.** On a phone, painted text has no visible benefit over the browser's own rasteriser at DPR 2 to 3.
  The one place it mattered, the Enter transition's pane cards, now carries surfaces only at Base, and the DOM text
  fades in at the hand-off (120 ms, cut under Off).
- **What it saves.** No glyph atlases or SDF code on the phone's download path (`00` section 0.6), no scroll hand-off
  for text, no line-break parity risk on phones, and K1 becomes a desktop-only question.

The rules of section 3.5.6 still bind: under hybrid text `doubleText()` must find no painted text at all, and the
runtime guard's per-tab switch (rule 3) is the same mechanism a desktop uses when its own text fails.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-3.5.1 | Text below 15 device px and every complex-script, RTL or emoji run uses the raster-run path; text at 15 device px and above uses dynamic SDF. | Unit test of the path chooser over a corpus of 2,000 strings at DPR 1, 1.25, 1.5, 2, 2.625 and 3. |
| TWN-R-3.5.2 | A text element whose predicted line count differs from its measured height by more than half a line, whose predicted line boxes differ from the browser's by more than 1 CSS px, or whose ellipsis cannot be reproduced exactly, is painted by the DOM, never by the GPU. | Inject a font-metric perturbation and a box offset in a test build; assert `data-paint="dom"` on the affected elements and no glyph instances for them. |
| TWN-R-3.5.3 | Across the CI parity sweep (every route × 6 looks × {390 × 844 at DPR 2.625 and 3, 1440 × 900 at DPR 1, 1.25 and 2}), zero GPU-painted runs differ from the browser's line starts, and the DOM-fallback share is reported per profile. | Parity sweep job, phone profile first; fails on any painted mismatch; publishes the fallback share for K1. |
| TWN-R-3.5.4 | Every GPU-painted run lands within 1 CSS px of the browser's box for the same characters, on every route and DPR in the sweep, including after a breakpoint crossing, a rotation and the on-screen keyboard opening and closing. | Alignment sweep (spike C1 method) with the reflow events scripted, in the phone profile and on the reference machine. |
| TWN-R-3.5.5 | During a scroll, everything inside the scrolling container is DOM-drawn, and no frame shows that container's text twice or not at all. | Playwright fling test on the ledger list in the phone profile and the table at 1440: frame-by-frame screenshot check of text coverage plus `doubleText()` sampled every frame. |
| TWN-R-3.5.6 | Numeric cells use the tabular face in both the Plat and the painter, and a digit change never changes a numeric cell's width. | Unit test on the numeral run builder; render test of a rolling balance. |
| TWN-R-3.5.7 | No painted glyph fragment lies outside the clip chain of its Plat element, and an ellipsis-truncated element shows exactly the browser's visible string or is DOM-painted. | Clip test page with nested `overflow: hidden`, `auto` and `clip`, `contain: paint`, and narrow KPI tiles with `text-overflow: ellipsis`, at 360 px width and DPR 2.625: render with DOM text hidden and with painted text hidden; assert no painted ink outside each element's clip and identical visible strings. |
| TWN-R-3.5.8 | `__town.doubleText()` returns an empty result on every route, at every breakpoint, after every navigation, transition, scroll settle, reflow and device loss in the interaction suite. | The harness calls `doubleText()` after every step of every interaction and scenario test and fails on any entry. |
| TWN-R-3.5.9 | At DPR 2.625 and 3, every glyph baseline and pane origin is on an integer device pixel at rest, and the canvas backing size equals `round(css × dpr)` in both dimensions. | Painter unit test with DPR 2.625 and layouts 10,000 px tall; render test in the phone profile. |
| TWN-R-3.5.10 | When the per-route DOM-fallback share on a device exceeds 2 %, or the guard fires on more than 20 elements in one frame, the tab switches to hybrid text and logs `text.k1-local`; `doubleText()` stays empty through the switch. | Test build with injected metric drift on 3 % of elements. |
| TWN-R-3.5.11 | Under a coarse primary pointer, and at Base and Low-power on any device, the painter emits no glyph instances, every Plat text node is visible DOM text, and the glyph-atlas and SDF modules are not loaded. | Phone-profile route sweep: glyph instance counter 0, computed text alpha 1, and the loaded-module list without `town-text/glyph*`; the same at Base on the desktop profile. |

## 3.6 Painting from the Plat: the read batch

The feasibility judge found that reading `getBoundingClientRect` for about 1,400 elements per dirty pane would force
layout and stall flings. Ruling: **rects are read rarely, stored relative to their scroller, and scrolling never
triggers a read.**

```
 rAF ─▶ [READ]   only for panes whose epoch changed: one TreeWalker pass over PaintSpec elements,
                   rect stored relative to the nearest registered scroller's content box
                   (rect − scrollerRect + scrollTop/Left), :focus-visible, computed spacing once per epoch
        [BUILD]  shape changed runs (cache by run key); emit instances into per-pane typed-array arenas
        [UPLOAD] write only changed pane slices
        [DRAW]   frame graph; each scroller's offset is a uniform, so scrolling re-reads nothing
```

**What bumps a pane's epoch:** its `MutationObserver` (child list, character data, and `class`, `hidden`, `aria-*`,
`data-*`, `value` attributes), its `ResizeObserver`, `document.fonts` `loadingdone`, a zoom or DPR change, a
breakpoint crossing of the shell or of the pane's own container, an orientation change, a `visualViewport` resize or
scale change (the on-screen keyboard, pinch zoom), and the virtualised list or table adding items to its window (only
the new items are read). Until a pane whose epoch changed has been re-read, its text is DOM text (section 3.5.6 rule
5).

**What does not:** a toolbar resize (`00` section 0.2.1: width unchanged, height change ≤ 140 px, nothing editable
focused), scrolling, hover (read from `:hover` on the one hovered element), focus changes (read on the
focused element only), the camera.

**Budget.** Reads are batched in one phase with no writes, so the browser lays out at most once per frame. On a phone
the heaviest lobby (Home at compact, about 600 painted elements, since summary cards cap what is mounted) re-reads in
≤ 4 ms in the phone profile (4× CPU slowdown); the heaviest expanded page (Home, about 1,400 painted elements) in
≤ 2.2 ms on the reference machine. A full re-read that exceeds 4 ms is split across frames by pane, with the unread
panes showing DOM text until read.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-3.6.1 | Scrolling any registered scroller causes zero `getBoundingClientRect` calls for elements already read. | Instrumented build: count rect reads during a 2 s scripted scroll of the ledger; assert reads only for newly windowed rows. |
| TWN-R-3.6.2 | No write to the DOM happens between the first and the last read of a read phase. | Dev-build assertion with a write trap during READ. |
| TWN-R-3.6.3 | A full re-read of Home completes in ≤ 2.2 ms p95 at 1440 × 900 on the reference machine. | Perf runner, 100 forced resizes. |
| TWN-R-3.6.4 | A full re-read of Home's lobby at 390 × 844 completes in ≤ 4 ms p95 in the phone profile, and a breakpoint crossing or keyboard open leaves no pane painted from pre-change rects. | Perf runner phone profile, 100 forced reflows; `doubleText()` and the alignment check after each. |

## 3.7 Frame graph and passes

Passes marked with a tier run only at that tier and above (`00` section 0.6). At **Base**, the phone's tier, the city
is passes 2 (no MRT: one RGBA8 output plus depth, windows and signals in lit colours), 5 (quarter-resolution screen
band) and 7, and the interior is P2 to P7 over a flat backdrop.

```
 CITY / DISTRICT (render on demand; scroll and touch at display rate up to 60 Hz on Base; event effects 30 Hz;
                  decor at 30 Hz only at Enhanced and Full under Motion Full)
 1 Shadow map 1024² (Enhanced) or 2048² (Full), only when the sun, a building or the lamp's spot target changed
 2 Scene MRT: output RGBA16F, emissive RGBA16F, depth (normal RGBA8 for the lattice outline only); no MSAA
 3 GTAO, half resolution (Full tier, WebGPU only)
 4 Bloom from emissive (6 levels webgpu, 4 webgl2; off when the look has no bloom)
 5 Tilt-shift (3.9.2)
 6 Grade: look LUT, vignette, spotlight (3.9.8), offline fog; output to the canvas
 7 UI pass: plaques, stamp labels, leader lines, HUD, toasts, focus halo, off-screen chevron (screen space, tokens)

 INTERIOR (render on demand; zero frames when idle)
 B  Backdrop (Enhanced and Full): the city graph 1 to 6 at half resolution, 2 × gaussian (σ 12 px), dimmed to the
    look's cap; cached and re-rendered only when a city beat is visible in the margins (≤ 4 Hz), on resize or on look
    change. At Base and Low-power the backdrop is the flat surface token with a static vignette.
 P1 Backdrop blit
 P2 Pane shadows and surfaces: instanced SDF rounded rects with analytic soft shadow (one draw)
 P3 Pane contents: rules, icons, chart marks, images, hatch, density strips, agent rim glow
 P4 Dioramas: scissored viewports, own depth clear, ≤ 8 draws each
 P5 Text: one draw per atlas page in use (raster run, SDF, emoji)
 P6 Overlays: dialog dim, popovers, menus, palette (P2, P3, P5 again for the overlay layer)
 P7 HUD, toasts, focus halo

 TRANSITION (Enter, Exit, travel): CITY 1 to 6, then T1 pane-card pass (3.9.1), then 7
```

The interior passes P2 to P7 are all UI-pass work in the sense of the legibility contract: none is tone-mapped. The
backdrop B is scene work and is never under a pane face.

**MSAA is off** everywhere (the feasibility judge's memory finding against Orbit). Geometry edges use analytic AA in
SDF shaders and, in the city, the tilt-shift and the model scale hide stair-stepping; a TAA pass is not used.

## 3.8 Materials

One uber-material serves all city geometry: a `MeshStandardNodeMaterial` with node overrides (verify in 0.187
source). Per-instance state (tone, construction progress, hatch, window state, actor) lives in instance attributes,
not material variants, which keeps the pipeline count fixed.

```js
// town-world/src/kit/materials.ts (sketch)
import { Fn, attribute, float, triplanarTexture, uniform } from "../../town-engine/src/three"; // re-exports
export const uLook = lookUniforms();                       // albedo set, roughness, fibre, window colours

export const modelMaterial = new MeshStandardNodeMaterial();
modelMaterial.colorNode = Fn(() => {
  const tone = attribute("aTone", "float");               // 0 basswood, 1 card, 2 stone, 3 brass, 4 acrylic, 5 roof
  const base = lookPalette(tone, attribute("aHue", "float"));
  const fibre = triplanarTexture(fibreTex, null, null, float(0.35)).r.sub(0.5).mul(uLook.fibre);
  const ao = attribute("aAO", "float");                   // baked by the procedural generator
  return base.mul(ao.mul(0.35).add(0.65)).add(fibre);
})();
modelMaterial.roughnessNode = lookRoughness(attribute("aTone", "float"));   // brass 0.35, others 0.82
modelMaterial.emissiveNode  = windowGlow();                // light means signal: windows only (3.8.1)
modelMaterial.positionNode  = constructionPosition();      // 3.9.4
modelMaterial.outputNode    = constructionOutput();        // 3.9.4 (clip, weld, hatch)
```

**3.8.1 Window glow.** Windows are emissive quads in facade modules with per-instance `aWindowState` (0 dark, 1 lit,
2 arriving, 3 removed). Lit uses the look's window colour; arriving pulses the actor tone over 1.2 s and settles. The
emissive target feeds bloom. Nothing else in the uber-material writes emissive.

## 3.9 Signature effects

Time in every shader is `uFrameTime`, the app clock's uniform, never three's own time node, so tests can freeze it.
Every effect has the Motion variants of `04` section 4.7: **Full**, **Reduced** (no camera travel, no ambient motion,
event effects as static highlights) and **Off** (no animation at all; end states only).

### 3.9.1 Enter: from facade to interior

Because the facade equals the page layout (`01` section 1.6 rule 5), each window maps to its pane exactly.

**Preparation on intent** (`pointerdown` on a building link, which on a phone precedes the click by about 100 ms;
hover over 150 ms with a fine pointer; focus on a building link; or the start of Enter): pre-resolve the page and
pre-mount its Plat offscreen (`visibility: hidden; inert`) at the final viewport; start widget first loads.

**Compact Enter (the design), Full motion.** From a borough street (or from the Town Square tile on the landing,
which enters Home), the facade already faces the viewer in the axonometric bake, so Enter needs no camera flight and
no change of projection. The band image is hidden and the band is drawn live on the main canvas for the transition:

- Phase A (0 to 0.4 of 600 ms): the orthographic camera scales about the tapped facade's centre until the facade's
  width fills the viewport width minus the gutters; neighbouring bands fade to the backdrop token. Each window's lit
  quad swaps to its pane card (the lobby card painted into a target from the pre-mounted Plat), at most 6 cards (the
  cards that will be visible in the lobby's first viewport; windows of cards below it dissolve with the facade).
- Phase B (0.4 to 1): pass T1 moves each card from its window rect to its lobby card rect: windows spread across a
  facade become a vertical stack in the page's compact order, staggered by that order. Under hybrid text the cards
  carry surfaces only and the DOM text fades in over 120 ms at the hand-off. The facade dissolves with an ordered
  dither.
- Hand-off at `s = 1` as below.

**Compact Exit** reverses it: the lobby's visible cards fold back into their windows as the camera scales out to the
band, and the city scroller is restored to the band's position.

**Vista Enter (expanded), Full motion.**

- Phase A (0 to 0.55 of 900 ms): the camera moves on a spline to the facade pose, looking straight at the facade with
  the facade width filling the viewport. The fov narrows from 32° to 2° while the distance is recomputed so the
  facade width stays constant (the dolly zoom). At 2° the projection differs from orthographic by under 0.03 % at the
  edges, so the switch to the real orthographic camera is invisible. Within 2.5 facade widths, each window's emissive
  quad swaps to its pane card (the pane painted into a target layer from the offscreen Plat).
- Phase B (0.55 to 1): screen-space card pass T1. Each card's four projected corners interpolate to the pane's final
  rect with perspective-correct UVs, staggered by `(y, x)` order. The facade dissolves with an ordered dither; the
  tilt-shift band collapses.
- Hand-off at `s = 1`: the painter switches from cards to live panes, the Plat becomes visible and non-inert, focus
  moves to the `h1`, the announcement fires. The hand-off frame differs from the settled interior by ≤ 0.05 % of
  pixels.

**Reduced and Off.** No camera travel and no fov change: a 150 ms crossfade (Reduced) or a cut (Off) from the city
frame to the interior frame. The dolly zoom exists only under Full (access must-add 3).

**Focus and IME safety** (feasibility defect JF-5). Enter, Exit and travel are only ever started by the viewer's own
navigation, which moves focus anyway. A transition is never started by realtime, by `ui.present` or by a look change
while an editable element has focus or a composition is active; such requests wait for `compositionend` and blur, or
fall back to a toast.

```js
// town-engine/src/post/pane-cards.ts: T1 vertex (sketch; verify varyingProperty and texture array sampling in 0.187)
const cardVertex = Fn(() => {
  const corner = attribute("aCorner", "vec2");                // (0,0)…(1,1)
  const from = cornerFromFrozen(instanceIndex, corner);       // vec3: clip xy and w frozen at phase B start
  const to = cornerToRect(instanceIndex, corner);             // vec2: NDC of the final pane rect
  const k = cardProgress(instanceIndex);                      // staggered, eased
  const w = mix(from.z, float(1), k);
  varyingProperty("vec3", "vUVW").assign(vec3(corner.mul(w), w));
  return vec4(mix(from.xy, to, k).mul(w), 0, w);
});
const cardFragment = Fn(() => {
  const uvw = varyingProperty("vec3", "vUVW");
  return sampleCard(instanceIndex, uvw.xy.div(uvw.z));       // array layer on WebGPU; own target on WebGL2
});
```

Pane cards use individual targets on Base (up to 6) and Enhanced (up to 12, then a crossfade for the rest), and a
render-target array of up to 24 layers at Full on WebGPU; WebGL2 and Safari (if its array targets fail the visual
suite) use individual targets at every tier.

**Room push and pop** (compact) and **sheets** are not camera transitions: the room is painted live at its final
rect and translated in from the trailing edge (220 ms Full, 120 ms crossfade Reduced, cut Off); a sheet translates up
from the bottom by the same rule. Both move painted surfaces only by a translation uniform; text inside them is DOM
text until they settle (the scroll hand-off rule), so nothing is re-read during the motion.

### 3.9.2 Tilt-shift (the miniature look)

A screen-space focus band combined with a depth term. At **Base** (the landing and the street overlay, orthographic, where a
depth term adds little) it is the screen band only, at quarter resolution with one blur level, the band centred on
the middle of the viewport so the band in focus is the one under the reader's eye; the governor drops it first. At
Enhanced the depth term is added on WebGPU at half resolution; at Full there are two blur levels. The spike mixes the
sharp frame with two Gaussian levels by a circle of confusion; the final form is chosen after G0 measures both on the
reference machine and in the phone runs (C11).

```js
// town-engine/src/post/tiltshift.ts (sketch)
export const uFocusY = uniform(0.52), uBandHalf = uniform(0.11), uFalloff = uniform(0.24);
export const uFocusZ = uniform(-180), uFocusRange = uniform(90), uDepthMix = uniform(0.6); // 0 on WebGL2

export const coc = Fn(([uv, depth]) => {
  const band = clamp(abs(uv.y.sub(uFocusY)).sub(uBandHalf).div(uFalloff), 0, 1);
  const viewZ = perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
  const dz = clamp(abs(viewZ.sub(uFocusZ)).div(uFocusRange), 0, 1);
  return mix(band, max(band, dz), uDepthMix);                       // 0 sharp … 1 most blurred
});
export const tiltComposite = Fn(([sharp, blurSmall, blurLarge, c]) => {
  const a = smoothstep(0.05, 0.45, c), b = smoothstep(0.45, 0.95, c);
  return vec4(mix(mix(sharp.rgb, blurSmall.rgb, a), blurLarge.rgb, b), 1);
});
```

The band follows the hovered or focused building only under Full; under Reduced and Off it is fixed. Text is drawn
after this pass, so it is never blurred.

### 3.9.3 Flows: particles, letters and parcels on real streets

- `PathTable`: an `RGBA32F` `DataTexture`, 64 texels per row: arc-length resampled door-to-door positions (xyz) and
  cumulative length fraction (a). At most 2,048 rows, LRU; Bank, Emporium and Post Office to every house are
  precomputed.
- A **ring of instances** per pool, sized by tier (`00` section 0.6): 1,500 at Base, 6,000 at Enhanced, 24,000 at
  Full on WebGPU and 8,000 on WebGL2. When the pool is smaller than a burst needs, the burst keeps its full path and
  count on the destination plaque and draws fewer, brighter particles. Instance data (all floats): `path`, `kind`,
  `actor`, `t0`, `speed`, `length`, `seed`, `tone`, `size`. Written only at spawn.

```js
// town-world/src/effects/flows.ts (sketch; verify textureLoad in the vertex stage in 0.187)
const flowVertex = Fn(() => {
  const s = uFrameTime.sub(attribute("aT0")).mul(attribute("aSpeed")).div(attribute("aLen"))
            .sub(attribute("aSeed").mul(0.12));                       // burst stagger
  const alive = s.greaterThanEqual(0).and(s.lessThanEqual(1));
  const fx = clamp(s, 0, 1).mul(63); const i0 = floor(fx); const f = fract(fx);
  const row = int(attribute("aPath"));
  const p0 = textureLoad(pathTex, ivec2(int(i0), row)).xyz;
  const p1 = textureLoad(pathTex, ivec2(int(min(i0.add(1), 63)), row)).xyz;
  const tangent = normalize(p1.sub(p0).add(vec3(1e-4, 0, 0)));
  const side = normalize(cross(tangent, vec3(0, 1, 0)));
  const hop = sin(s.mul(Math.PI)).mul(kindHop(attribute("aKind")));   // letters arc, particles hug the street
  const centre = mix(p0, p1, f).add(side.mul(attribute("aSeed").sub(0.5).mul(0.9))).add(vec3(0, hop.add(0.6), 0));
  return select(alive, billboardAlongTangent(centre, tangent, attribute("aCorner", "vec2"), attribute("aSize")),
                vec4(0, 0, 2, 1));                                    // dead → clipped
});
```

Spawn rules: a credit of Δ points spawns `clamp(round(Δ / 50), 3, 64)` particles; above 64 the trail brightness
scales with `log10(Δ)`. Parcels are instances of a small box mesh (pool ≤ 512) on the same paths and stop at stations
until the next `order.status_changed`. Positions are pure functions of `(path, t0, speed, now)`, which is what makes
CPU picking exact. Reduced motion: a static highlighted path for 1.5 s plus the count on the destination plaque.

### 3.9.4 Construction and demolition

Per-instance attributes on every kit module: `aBaseY`, `aBuildH`, `aBuildT0`, `aBuildDur`, `aDir` (+1 build, −1
demolish), `aCourse`, `aActor`, `aLotId`.

```js
// town-world/src/effects/construction.ts (sketch)
const buildFront = Fn(() => {
  const p = clamp(uFrameTime.sub(attribute("aBuildT0")).div(attribute("aBuildDur")), 0, 1);
  const prog = select(attribute("aDir").greaterThan(0), easeOutCubic(p), float(1).sub(easeInCubic(p)));
  const h = prog.mul(attribute("aBuildH"));
  return vec2(floor(h.div(0.6)).mul(0.6), fract(h.div(0.6)));        // completed height, current course progress
});
export const constructionOutput = Fn(([lit]) => {
  const y = positionWorld.y.sub(attribute("aBaseY"));
  const bf = buildFront();
  const along = fract(positionWorld.x.mul(0.05).add(positionWorld.z.mul(0.05)));
  const inCurrent = y.greaterThanEqual(bf.x).and(y.lessThan(bf.x.add(0.6)));
  If(y.lessThan(bf.x).or(inCurrent.and(along.lessThan(bf.y))).not(), () => { Discard(); });
  const nearFront = smoothstep(0.12, 0.0, min(abs(y.sub(bf.x.add(0.6))), abs(along.sub(bf.y)).mul(4)));
  const weld = actorTone(attribute("aActor")).mul(nearFront).mul(3.0);              // HDR into emissive, blooms
  const foundation = y.lessThan(0.6).and(attribute("aActor").equal(1));             // agent-built foundation course
  return vec4(mix(lit.rgb, actorTone(1), agentHatch(screenCoordinate, foundation).mul(0.35)).add(weld), lit.a);
});
```

The static city uses a variant without the clip (both in the pipeline inventory); an instance uses the constructing
variant only while `aBuildT0 + aBuildDur > now`. Scaffolds are an instanced pole pool following `buildFront + 1.2`.
Demolition staggers `aBuildT0` by the survey line's arrival. Reduced: buildings fade in and out over 150 ms; Off:
they appear and disappear.

### 3.9.5 The agent lamp (Orbit's Lumen, carried by the surveyor drone)

The agent is a brass surveying instrument carrying a **real light**:

- In the city it is a three `PointLight` (no shadow map) attached to the drone, in the look's agent tone, intensity
  0.35 when idle and 1.0 while working. Facades near it brighten; the light is what makes the agent read as present.
- At Enhanced and Full, while it builds a lot, a `SpotLight` with a 512² shadow map aims from the drone at the
  lot, so the rising building casts a sharp second shadow. It is switched off when the build ends. At Base the lamp
  is the point light plus a projected light pool decal on the lot (no shadow map); on a phone the light on the facades
  is what reads, and it costs one light in the forward pass.
- In interiors, the pane being added or changed by the agent gets a **rim glow**: a 1.5 px additive line around the
  pane edge in the agent tone and a soft glow on the backdrop behind it, for the 8 s attribution window. The pane
  face is untouched (legibility contract rule 2).
- The drone's shape (tripod, lens, rotor ring) and the hatch tell it apart without colour.

```js
// town-world/src/effects/lamp.ts (sketch)
export const lamp = new PointLight(lookAgentTone(), 0.35, 60, 2);   // verify PointLight under node lighting in 0.187
export const lampHalo = Fn(() => {                                   // camera-facing sprite on the drone
  const r = length(vQuadUv.sub(0.5)).mul(2.0);
  return vec4(uAgentTone.mul(exp(r.mul(r).mul(-6.0))).mul(uLampActivity), 0);   // into emissive only
});
export const paneRim = Fn(([d /* signed distance to the pane edge, px */]) =>    // P3, outside the face only
  uAgentTone.mul(smoothstep(1.5, 0.0, abs(d.sub(0.75)))).mul(step(0.0, d)).mul(uRimAmount));
```

Under Reduced the lamp is placed at its target without flight; under Off its intensity is fixed. No pulse exists
under any state (the Lumen's idle pulse is not adopted).

### 3.9.6 Stamps along the trail (Atelier graft)

Each MCP call that reaches the viewer as a change (a commit, or a held request through `approval.requested`) leaves a
**stamp** where the lamp was when it landed:

- On the ground: a ring decal (no text) in the agent tone. **Solid** for a commit, **hollow** for a dry run shown by
  the agent's own session preview, **tagged** for held, **struck** for refused. Shape, not colour, carries outcome.
- Above it: a screen-space label plate, `site.widget.add · #48,231`, drawn in the UI pass (legibility contract rule
  6), visible at district altitude and on hover at city altitude.
- The trail itself: a thin ground ribbon along the lamp's path, dashed for dry runs.
- Stamps fade to 25 % over 20 s and remain until the session's agent goes idle for 10 minutes or the viewer clears
  them; "Show trail" in the Agent log restores them.
- **On a phone** there is no hover and no district altitude: the label plates of the **three most recent stamps** in
  view are always shown, as DOM buttons over the ring; any other stamp's ring is a ≥ 44 px DOM button that reveals its
  plate on tap. On the landing, each tile shows its borough's stamp count. The full list is in the Agent log and the
  build board (`05` section 5.5).

Which calls can be stamped is set by what the browser can observe: `05` section 5.6.

### 3.9.7 The agent hatch

One function serves the pane attribution band, agent rows in tables, the matrix's agent column, agent-built
foundations, agent flows, the audit frieze's agent links, Gatehouse carts and held-change ghosts:

```js
export const agentHatch = Fn(([frag /* device px */, on]) => {
  const t = fract(frag.x.add(frag.y).div(float(7).mul(uDpr)));          // 45°, 7 CSS px period
  return select(on, smoothstep(0.0, 0.06, t).mul(smoothstep(0.36, 0.30, t)), float(0));
});
```

In Plain mode the hatch is a CSS `repeating-linear-gradient(45deg, …)`; under forced colours it is dropped and the
text label (always present) carries the meaning.

### 3.9.8 Spotlight and the off-screen chevron

- **Spotlight** (for an accepted `ui.present`), in the grade pass: `col × (1 − smoothstep(r0, r1, d) × amount)` with
  `amount` springing to 0.45. Never applied to the UI pass.
- **Off-screen chevron** (Orbit graft), in the UI pass: when the lamp is outside the viewport or the viewer is in
  another building, a chevron sits on the viewport edge at the lamp's projected bearing, with the label "Agent
  building Store" and the Plat button behind it (`05` section 5.5).

### 3.9.9 Look sweep (`site.appearance.set`)

Both looks' uniform blocks are bound (`uLookA`, `uLookB`); every city material and the grade blend with
`k = smoothstep(r − 12, r + 12, distance(worldPos.xz, studioXZ))` where `r` grows from the Lamp Studio at 140 u/s. When
the front leaves the plinth, B is copied to A. Interior tokens never sweep: they swap in one frame as CSS custom
properties and the painter's tone buffer, so text is never mid-blend. Reduced: a 150 ms crossfade; Off: a cut.

### 3.9.10 Heatmap to terrain (Instrument graft, D13)

```
mesh:     (cols × 8 + 1) × (rows × 8 + 1) grid; heights read with textureLoad from an R32F cell texture,
          smoothstepped at cell edges so cells read as plateaus with bevelled slopes
vertex:   h = mix(0, valueNorm(cell) × H, raiseT)              // raiseT 0 → 1 over 600 ms Full; cut otherwise
normals:  analytic central differences of the same texture in the vertex stage (no compute)
fragment: base = sequential palette(valueNorm); lit = base × (ambient + key·n), matte
          contour = 1 − smoothstep(0, fwidth(h·k), |fract(h·k + 0.5) − 0.5|)
threshold plane: a separate quad at thresholdNorm × H, breach tone at 25 % alpha with the hatch;
          cells above it carry the hatch on their faces
camera:   tilt 0 → 52°, orbit −18° (Full); final framing at once otherwise; [ and ] rotate ±15°
labels:   axis and focused-cell labels projected to screen and drawn in the UI pass
```

### 3.9.11 Chart morphs (Instrument graft)

Every 2D chart writes marks into one `MarkInstance` layout: `a` (x, y, w, h in layout A), `b` (layout B), corner
radius A and B, shape, colour index, flags (breach, selected, focused, hidden). The vertex shader draws
`mix(a, b, uMorphT)`; a bar becomes a line vertex by radius going from 0 to w/2. Axes and labels crossfade in the UI
pass. 500 ms under Full, a 120 ms crossfade under Reduced, a cut under Off.

```js
const r = mix(attribute("aA", "vec4"), attribute("aB", "vec4"), uMorphT);
const radius = mix(attribute("aRadiusA"), attribute("aRadiusB"), uMorphT);
// fragment: coverage = sdRoundRect(local, r.zw × 0.5, radius); breach marks mix the hatch and carry ▲ in text
```

### 3.9.12 Ledger to flow ribbon (Instrument graft, D3 and D4)

```
data:     transactions aggregated by (day, txn type, direction) → flows; running balance per day
geometry: one triangle strip per flow along a cubic Bézier from its source to its join on the balance band;
          width ∝ points (1 px per k points, k so the widest day fits the viewport); the balance band's width at
          x(day) = balance(day) / k
fragment: flat colour per type, 1 px darker edge, matte; focus raises the ribbon 4 px and outlines it in the focus
          token (and the Plat row is focused)
live:     a new points.posted draws its ribbon in with one bead travelling along it (Full only)
camera:   tilt 0 → 28° (Full); ← → walk days, ↑ ↓ walk flows
```

### 3.9.13 Permission matrix exploded by role (Instrument graft, D14)

Each role of the selected principal is a translucent matrix plane at depth `z = −i × 40 px` in the diorama camera; the
effective plane is in front. Cells are instanced quads with the matrix glyph set; for each effective cell a line
segment instance joins it to the cell on the role plane that granted it. Focus on a cell highlights its line and
focuses the matching row in the principal-view list. Plane alpha is 0.85 minimum so text plates stay legible.

### 3.9.14 Vellum revision fan (Atelier graft, D6 to D8)

Revisions are sheets (one quad each) holding their text as a pane card rendered by the interior painter. Fanned, sheet
`i` sits at `z = −i × 18 px` with a 4° yaw step; the material is a matte translucent card at 0.55 alpha over the pane
face colour (no refraction: transmission is not used, which keeps WebGL2 parity). Choosing two sheets slides them
together over 400 ms (Full) so unchanged text overlaps into one line and changed text doubles; the exact diff is in
the Plat beside the fan (TWN-R-2.4.5).

### 3.9.15 Circuit pulses (Constellation graft)

A machine is a polyline graph: trigger, gates, stations. A run's pulse is an instanced quad sampling the same path
table as flows, with `s` driven by the run state instead of time alone:

```
queued         pulse waits at the hopper
running step i pulse travels to station i (300 ms Full) and the station's gears turn
step skipped   a hollow pulse passes the station
failed         the pulse stops at the station with a ✕ plate and the error code as text; red steam (Full)
succeeded      the pulse exits into the tray and fades
```

Runs are keyed by `run_id`; out-of-order frames reorder by `step_index`. Reduced: the station lights statically;
Off: the state plate only.

### 3.9.16 Requirements for the signature effects

| ID | Requirement | Test |
|---|---|---|
| TWN-R-3.9.1 | The Enter hand-off frame differs from the settled interior frame by ≤ 0.05 % of pixels, and no frame during Enter or Exit shows neither the Plat nor the painted panes. | Frame capture of Enter on three buildings per backend; per-frame coverage check. |
| TWN-R-3.9.2 | No transition is started by realtime, `ui.present` or a look change while an editable element has focus or a composition is active; focus and composition survive every viewer-started transition request made during composition (it waits for `compositionend`). | Interaction tests: start a composition in the transfer memo, inject a present frame with Follow agent on and a look change; assert no transition and the composition intact. |
| TWN-R-3.9.3 | When render-target arrays are unavailable or fail the visual suite (WebGL2, or Safari by a capability switch), pane cards use individual targets (up to 12, crossfade beyond) with the same hand-off result. | Enter test with the array path forced off. |
| TWN-R-3.9.4 | Every effect in 3.9 has Full, Reduced and Off variants as specified, and the Off variant reaches the same end state as Full. | Effect test matrix: each effect × three Motion states; compare end-state snapshots. |
| TWN-R-3.9.5 | Stamp labels, plaques and the off-screen chevron are drawn in the UI pass on opaque plates, never in the scene pass. | Frame-graph unit test over the draw lists. |
| TWN-R-3.9.6 | The agent lamp has no idle pulse or flicker in any Motion state; its intensity changes only on activity changes. | Render test sampling the lamp halo over 10 s idle. |

## 3.10 Picking

- **Interior:** native DOM hit testing. Plat elements are above the canvas with `pointer-events: auto`; the canvas has
  `pointer-events: none` in interiors.
- **Town at compact and medium (the landing and borough streets):** no picking at all. Tiles and building links are
  DOM elements over the landing's tiles and over the baked band images inside the street's scroller, so the browser's
  own hit testing is exact (`01` section 1.4). Moving effects are tapped only through their destination's plaque menu,
  and stamps through their DOM buttons.
- **City in the vista (expanded):** Plat links sit over each building's projected rect, padded to at least 24 × 24
  CSS px, 44 × 44 under a coarse pointer (`04` section 4.11). Precise picking is a CPU ray test against one axis-aligned box per building, landmark and house
  (about 600 boxes; no BVH library), throttled to once per frame on `pointermove`. Moving effects are picked
  analytically from their pure position functions (the ≤ 64 most recent, within 12 CSS px).
- **No GPU readback** in either backend.
- **During camera motion** pointer events on city links are ignored until the camera settles, and the hit target set
  is rebuilt in the settle frame, so a click never lands on a target that moved (feasibility finding JF-12).

| ID | Requirement | Test |
|---|---|---|
| TWN-R-3.10.1 | A pointer click during camera motion never activates a city link; a click in the first settled frame activates the link under the pointer. | Playwright: start an orbit, click at a building's pre-motion rect mid-motion and after settle; assert navigation only in the second case. |
| TWN-R-3.10.2 | No code path calls a GPU readback (`readRenderTargetPixels`, `mapAsync` on a render result) outside the test harness. | Static check over `town-*` sources excluding `town-test`. |

## 3.11 Performance budgets

**The design class is the mid-range phone at the Base tier** (`00` sections 0.2 and 0.6): an Adreno 6xx class Android
phone in Chrome and an A15 class iPhone in Safari, at 390 × 844 CSS px. Its budgets come first; the other columns are
expansions. **Every phone figure is a target**, recorded beside its measured value at G0 and G-PERF; a target that
proves unreachable is reset by the owner on the G0 task before P8 (`07` section 7.2), never silently.

**What can be measured where.**

- **Phone emulation** (the default harness profile, `00` section 0.8) on the reference machine measures main-thread
  cost per frame (read, build, submit), layout, text parity at phone DPRs and loading over the design network. It does
  not measure the phone's GPU: its GPU time is the reference machine's.
- **Real phones** (G0 C11 to C13, then G-PERF) measure GPU time, frame time, memory, thermals and battery. Until a
  figure is measured it is labelled unmeasured.
- **The reference machine** (Windows 10, NVIDIA GTX 1080 Ti, Playwright's Chromium with `--enable-unsafe-webgpu
  --use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`, 1440 × 900 at DPR 1) measures the expanded design at
  Full. The prototype measured frame p95 of 1 to 6 ms there.

Frame time is max(GPU time, CPU time) per frame: GPU from `timestamp-query` where available, otherwise the rAF delta,
with the source recorded. On phones without `timestamp-query`, the rAF delta of a forced continuous loop is used.

| Scene (p95 frame time) | **Mid-range phone, Base, 390 × 844** (unmeasured until G0 C11) | Phone emulation, main-thread CPU per frame (4× slowdown) | Iris Xe class laptop, Enhanced (unmeasured) | Apple M-class laptop, Enhanced (unmeasured) | Reference, Full, WebGPU | Reference, Full, WebGL2 |
|---|---|---|---|---|---|---|
| Interior or city, idle | 0 frames | 0 frames | 0 | 0 | 0 | 0 |
| Interior, scrolling a 912-line list | ≤ 16.7 ms | ≤ 6 ms | ≤ 16.7 ms | ≤ 16.7 ms | ≤ 8.3 ms | ≤ 8.3 ms |
| Interior with a live diorama | ≤ 16.7 ms | ≤ 6 ms | ≤ 16.7 ms | ≤ 16.7 ms | ≤ 8.3 ms | ≤ 10 ms |
| Room push, sheet open | ≤ 16.7 ms | ≤ 6 ms | ≤ 16.7 ms | ≤ 16.7 ms | ≤ 8.3 ms | ≤ 8.3 ms |
| Borough street, scrolling | compositor-scrolled band images: no canvas frame needed; overlay faded | ≤ 2 ms (scroll listener only) | same | same | n/a (vista) | n/a |
| Borough street, overlay at rest with effects | ≤ 16.7 ms | ≤ 6 ms | ≤ 16.7 ms | ≤ 16.7 ms | n/a | n/a |
| Band re-bake (one band) | ≤ 8 ms, at most one per frame | ≤ 4 ms | ≤ 8 ms | ≤ 8 ms | ≤ 2 ms | ≤ 2 ms |
| Landing or vista, busy (8 constructions, the tier's particle pool, the lamp) | ≤ 33 ms (event effects at 30 Hz) | ≤ 10 ms | ≤ 16.7 ms | ≤ 16.7 ms | ≤ 12 ms | ≤ 14 ms |
| Enter (compact: 6 cards; vista: 12 cards) | ≤ 16.7 ms | ≤ 8 ms | ≤ 16.7 ms | ≤ 16.7 ms | ≤ 12 ms | ≤ 14 ms |
| Vista, idle with decor (expanded only) | n/a | n/a | ≤ 16.7 ms at 30 Hz | ≤ 16.7 ms | ≤ 8.3 ms | ≤ 10 ms |

- **No long frames.** On the phone no frame in the scripted scenes exceeds 50 ms.
- **Input latency:** tap to the first changed frame ≤ 100 ms on the phone; pointer-down to the first changed frame
  within one frame on the reference machine. Interaction to Next Paint p75 ≤ 200 ms over the phone interaction suite.
- **Navigation:** a tap on a Directory entry or lobby card to an interactive interior or room (Plat `h1` focused)
  ≤ 300 ms in the phone profile with data cached and Motion Reduced, ≤ 700 ms with Motion Full; ≤ 120 ms and ≤ 500 ms
  on the reference machine.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-3.11.1 | Every reference-machine budget and every phone-emulation CPU budget in the table holds on both backends on the integration line. | Perf runner job per stack: phone profile first, then the reference profile; fails the stack on a breach. |
| TWN-R-3.11.2 | An idle interior or room draws zero frames over 10 s at every tier and width; an idle city draws zero frames at Base and Low-power at any Motion setting, and at every tier under Motion Reduced or Off; the city draws zero frames while an interior is shown at any width except wide with "City beside". | Frame counter assertion in both profiles. |
| TWN-R-3.11.3 | Before the town app becomes the site default, every unmeasured column has been measured on a named device and recorded on the G-PERF task, the mid-range phone column first. | Gate checklist on Workgraph. |
| TWN-R-3.11.4 | In the phone profile, tap-to-first-changed-frame is ≤ 100 ms p95 and INP p75 ≤ 200 ms across the phone interaction suite. | Event-timing instrumentation (`PerformanceObserver` on `event` entries) in the phone suite. |

## 3.12 Tiers in the engine, render on demand, power and thermal

- **Tiers** are those of `00` section 0.6: Plain, Low-power, Base, Enhanced, Full. `town-engine/src/tiers.ts` holds one
  record per tier (DPRs, passes, pool sizes, shadow sizes, frame-rate caps); every effect reads its settings from the
  active record, so a tier change is a data change plus the creation or release of the affected targets.
- **Demand-driven loop.** A frame is requested only by a dirty pane, a running beat, a camera motion or scroll, a
  running diorama animation, or decor at Enhanced and Full under Motion Full. Event effects run at most 30 Hz at Base
  (15 Hz at Low-power); user-driven motion (scroll, transitions, touch) runs at the display rate up to the tier's cap.
- **Hidden tab:** no frames; the Choreographer suspends and applies end states on return. `pagehide` and
  `visibilitychange` release pane-card and post targets on phones, so a backgrounded tab holds the least memory.
- **Low-power tier:** chosen by the viewer, by the governor stepping down from Base, by the thermal guard, or by the
  Battery API (`!charging && level < 0.2`, Chromium only; iOS exposes neither the Battery API nor Low Power Mode, so
  on iOS this trigger does not exist and the governor reacts to the halved frame rate instead). Its column in `00`
  section 0.6: town DPR 1.5, no post, no particles (static highlighted paths and counts), event effects at 15 Hz;
  interiors unchanged except that dioramas show their flat twins.
- **Governor.** A rolling p90 of frame time; above 1.25 × the tier budget for 120 consecutive drawn frames it steps
  down one tier (Full → Enhanced → Base → Low-power); it steps up only after 600 drawn frames under 0.6 × budget, at
  most once a minute, never during a transition, and never above the tier the viewer pinned. The last tier is
  remembered per device (`plinth.town.tier`).
- **Thermal guard.** If drawn-frame p90 drifts up by more than 30 % over a 3-minute window at constant scene load,
  the tab steps to Low-power and Settings shows "Reduced effects to keep your phone cool". It steps back up only by the
  governor's rule after 10 minutes.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-3.12.1 | The governor's thresholds and hysteresis behave as specified, move one tier at a time along the four GPU tiers, never change tier during a transition and never exceed a pinned tier. | Unit test with synthetic frame-time series. |
| TWN-R-3.12.2 | The thermal guard fires on the drift signature and not on a constant load. | Unit test with recorded series; on-device check at G0 C12 and G-PERF. |
| TWN-R-3.12.3 | Over a 10-minute scripted session (landing and street scrolling, two rebuild bursts, interior work at Base) on the named **Android** phone, `adb shell dumpsys thermalservice` reports a status at or below LIGHT throughout and the governor makes no thermal step-down; on the named **iPhone**, where no thermal ground truth is available to a web page, the record states "guard only" with the drift guard's log and the frame-time trace. | On-device run at G0 C12 and G-PERF; Android status sampled every 10 s by the harness over `adb`; recorded on the gate task. |
| TWN-R-3.12.4 | The same session on the named Android phone, unplugged at 50 % screen brightness, drains at most 4 % of battery. | `adb shell dumpsys battery` level before and after, recorded at G0 C12 and G-PERF. |

## 3.13 Memory and assets

| Item | **Phone, Base** (the design) | Expanded, Full |
|---|---|---|
| Text | none (hybrid text: no glyph atlases) | run atlas 2048² + emoji 1024² + SDF 2 × 2048² (16 MiB) |
| Town geometry | Base level of detail: the landing's vignettes plus one borough's bands at a time: ≤ 6 MiB | detail level, whole town ≤ 18 MiB |
| Band images (street) | one per band in view ± 1, at the band's CSS box × min(DPR, 2): 716 × 490 px RGBA8 ≈ 1.4 MiB each, at most 5 resident: ≤ 7 MiB (counted as GPU-backed canvas memory) | n/a |
| Textures | fibre and grain ≤ 4 MiB; product atlas ≤ 8 MiB (loaded per page); badge and avatar atlas ≤ 2 MiB | 8 + 16 + 4 MiB |
| Render targets | at min(DPR, 2) for interiors and the town (no text is painted at Base): 780 × 1688 device px at 390 × 844: one RGBA8 output 5.3 MiB, depth 5.3 MiB, quarter-resolution tilt band 0.4 MiB, pane cards ≤ 6 × 1 MiB during Enter only; no HDR, no shadow map, no MSAA | at 1440 × 900: HDR RGBA16F 10, emissive 10, depth 5, post chain 8, shadow 2048² 16, lamp spot 1, backdrop 5, pane cards ≤ 32 during transitions |
| **Total GPU** | **≤ 96 MiB** | ≤ 256 MiB |
| JS heap | **≤ 64 MiB**, including the Plat (≤ 2,500 elements on the heaviest lobby or room) | ≤ 120 MiB (≤ 6,000 elements) |
| Download before the Plain render (compressed) | **≤ 170 KB**: HTML and critical CSS, shell and Plat runtime, the route's widget chunk, Inter Latin subset (one weight axis) | same |
| Download before the first painted frame (compressed, total) | **≤ 450 KB target**: adds the three WebGPU/WebGL2 build and the engine; no glyph or SDF code (hybrid text). The three r187 build's real size is measured at G0 C14; if the target cannot hold, the K12 plan (stream the renderer after the Plain render; the Plain render is already a complete page) applies and the target is reset on the G0 task | adds text and the tabular face subset |
| City chunk | world code plus kit output for the Base level ≤ 160 KB compressed, fetched on the first City tap or in idle time on an unmetered connection | detail level ≤ 400 KB compressed |
| Per-domain widget chunk | ≤ 35 KB compressed | same |

| ID | Requirement | Test |
|---|---|---|
| TWN-R-3.13.1 | Bundle and asset sizes stay within the table, the phone column's download limits first. | Build-size check in CI against the route manifests. |
| TWN-R-3.13.2 | Total GPU memory stays within the tier's budget in the busy-city and Enter scenes at 390 × 844 DPR 3 (Base) and 1440 × 900 (Full). | Allocation accounting in `town-engine` (sum of created targets, textures and buffers) asserted in the perf runner in both profiles; on-device heap and memory readings at G0 C13. |

## 3.14 Boot, first paint and shader warm-up

```
 t0  HTML + critical CSS (plain.css inline)                 ──▶ top bar and bottom bar skeleton, h1 "Loading page…"
 t1  app JS, identity, me.get, pages.resolve, rt.connect    ──▶ PLAIN RENDER: the page's Plat, visible, with data
 t2  in parallel: capability probe, three chunk, fonts, text surface (OffscreenCanvas or detached canvas),
     renderer.init(); interior warm-up. Any failure here ends in Plain mode (section 3.3)
 t3  first GPU frame rendered and checked (doubleText() empty, parity guard run)
                                                            ──▶ 200 ms crossfade Plain → painted (cut under Off);
                                                                Plat text turns transparent in the frame the canvas shows
 t4  city chunk and city pipelines in idle time on an unmetered connection, or on the first City tap
```

- **First meaningful paint is the Plain render**, which is a complete, usable page. Phone targets on the design
  network with 4× CPU slowdown and a cold cache: **t1 ≤ 2.5 s, t3 ≤ 4.0 s**, the city's first frame ≤ 1.5 s after the
  first City tap (≤ 3.0 s if the city chunk was not prefetched). Reference machine (local backend, cold cache): t1
  ≤ 1.0 s, t3 ≤ 1.8 s.
- **On a slow or metered connection** (`saveData`, or `effectiveType` of `3g` or slower) the town app stays in Plain
  mode until the viewer chooses graphics (a one-line offer under the top bar), so the first visit costs only the
  Plain download.
- **Fixed pipeline inventory.** Uber-materials keep the set fixed and enumerated in `town-engine/src/pipelines.ts`,
  grouped by tier (Base: city static and constructing uber, plaques, flows, parcels, scaffold, decals, lamp halo,
  tilt band; interior: pane surfaces, contents, raster text, SDF text, emoji, dioramas (one per kind), card pass.
  Enhanced and Full add: shadow, sky, water, bloom down and up, depth tilt-shift, grade, backdrop blit, GTAO (Full),
  outline (lattice look)). CI fails if a pipeline is created at runtime that is not in the list.
- **Warm-up** with `renderer.compileAsync(warmScene, camera)` (verify in 0.187) during t2: the Base interior set
  first (target on the phone: ready ≤ 600 ms after `renderer.init()`; driver compilation of generated uber-shaders on
  an Adreno 6xx can take hundreds of milliseconds each, so the target is measured at G0 C11 and reset there if needed;
  nothing waits for it because the Plain render stays until each pipeline is ready), then the city set in
  idle time with `KHR_parallel_shader_compile` where WebGL2 offers it, then higher-tier and look-specific pipelines
  only when the governor or the viewer selects that tier or look. A look switch or tier step never compiles on the
  critical frame.
- **Readiness tiers.** If a pipeline is not ready when first needed, its draw is skipped and the element stays visible
  in the Plat (its text) until the next frame; nothing blocks.
- Browsers' own shader caches speed repeat visits; nothing depends on them.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-3.14.1 | Every route's first paint is the Plain render with data, before any GPU frame. | Playwright in the phone profile with the three chunk delayed by 5 s; assert the visible Plat with data and no canvas frame. |
| TWN-R-3.14.2 | No pipeline outside `pipelines.ts` is created at runtime in any test scenario, and no pipeline of a higher tier is created while a lower tier is active. | Pipeline creation hook in the harness, asserted across the interaction and visual suites per tier. |
| TWN-R-3.14.3 | After warm-up, no frame in the scripted scenes compiles a shader. | Harness counter on pipeline creation after `warmed`. |
| TWN-R-3.14.4 | In the phone profile on the design network with a cold cache, t1 ≤ 2.5 s and t3 ≤ 4.0 s on Home, `/points` and `/approvals`, and the bytes fetched before t1 and before t3 are within the limits of section 3.13. | Load job in the phone profile with CDP network emulation; transfer sizes from the resource timing entries. |

## 3.15 Device loss

- WebGPU `device.lost` (or WebGL context loss): the Plat text becomes visible at once (Plain styling for the
  interior), the renderer is recreated, and painting resumes; the Plat never changes, so focus, selection,
  composition and scroll survive.
- A second loss within 60 s moves the tab to Plain mode with the notice "Graphics were reset twice; showing the
  plain view. Turn graphics back on in Settings."
- Phones lose the context more often than desktops (backgrounding, memory pressure, iOS reclaiming WebGL contexts in
  background tabs). On `visibilitychange` to visible, the app checks the context and recreates it if lost without
  counting that as a loss for the two-in-60-s rule.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-3.15.1 | Losing the device mid-session keeps focus, input values and an active selection, and the focus outline stays visible throughout. | Test hook `__town.loseDevice()`; Tab through the transfer form before, during and after; assert focus, values and the outline (access must-add 5). |

## 3.16 Looks in GPU terms

A look is a scene preset, a material set, a post preset and interior tokens, switched live.

```ts
// packages/town-looks/src/types.ts
export interface Look {
  readonly id: "calm" | "meridian" | "nocturne" | "folio" | "lattice" | "strata";
  readonly scene: Record<"light" | "dark", ScenePreset>;
  readonly tokens: Record<"light" | "dark" | "light-more" | "dark-more", InteriorTokens>;   // "-more": prefers-contrast
  readonly density: Record<"comfortable" | "compact", DensityTokens>;
}
export interface ScenePreset {
  sky: { zenith: Oklch; horizon: Oklch; sunElevationDeg: number; sunAzimuthDeg: number };
  light: { sunLux: number; sunColourK: number; ambient: Oklch; shadowSoftness: number };
  materials: { basswood: Oklch; card: Oklch; stone: Oklch; brass: Oklch; acrylic: Oklch; roofChroma: number;
               fibre: number; roughness: number; windowLit: Oklch; streetLamp: Oklch | null };
  post: { bloom: { threshold: number; strength: number } | null; tiltShift: { bandHalf: number };
          lut: string; vignette: number; outline: boolean; contours: boolean };
  plaque: { plate: Oklch; ink: Oklch; edge: Oklch };
  backdropLuminanceCap: number;
}
export interface InteriorTokens {   // written to :root as CSS custom properties and to the painter's tone buffer
  surface0: string; surface1: string; surface2: string; surface3: string; rule: string;
  ink: string; ink2: string; accent: string; agent: string; focus: string; selection: string;
  credit: string; debit: string; positive: string; warning: string; critical: string; series: string[];
}
```

| Look | City scene | Materials and post | Interior light tokens: surface / ink / ink-2 / accent / agent |
|---|---|---|---|
| calm (default) | soft overcast morning, sun 38° | pale basswood and card, stone plinth; no bloom; warm LUT | `#FBFAF7` / `#1C1B19` / `#5A5752` / `#A64B26` / `#0E7C86` |
| meridian | white-card model at noon, sun 62° | white card, grey stone, vermilion on plaques only; wide sharp band; no bloom | `#FFFFFF` / `#111111` / `#555555` / `#C8381B` / `#0B5F8A` |
| nocturne | night: navy sky, lit windows, street lamps | dark-stained wood, enamel plaques; bloom on emissive only (light means signal) | dark first: `#12161C` / `#E8ECF1` / `#A3ADBA` / `#F2B544` / `#4FD1C5` |
| folio | paper-craft city on a desk at golden hour | paper with fibre 0.6, sepia LUT; serif titles need a third face (pinned when added) | `#F4EEE2` / `#2A2118` / `#6B5D4C` / `#8C2F1B` / `#1D6E72` |
| lattice | blueprint line drawing | normal and depth outline pass (the only look-specific pipeline), flat fills at 12 % | `#F5F8FC` / `#0F1B2D` / `#4A5A70` / `#1B5FD6` / `#6B3FB8` |
| strata | geological model with layered plinth | contour lines on terrain, earth palette | `#F6F3EE` / `#1E1A16` / `#5E554B` / `#9A4E1C` / `#0F7A6E` |

Dark variants keep the scene's time of day at dusk (sun −4°, windows lit, lamps on); their tokens derive in OKLCH
(surfaces L 0.17 / 0.20 / 0.23 / 0.26, C 0.01; ink L 0.93; ink-2 L 0.74; accents L ≥ 0.72). The hex values are design
intent; the checkers of `04` section 4.9 are the gate, and a failing value is adjusted in `town-looks`.

**Switching live.** `site.appearance.set` arrives as a Program node change: the new look resolves, interior tokens
swap in one frame (CSS custom properties plus one 256-byte tone buffer write), and the city runs the look sweep
(3.9.9). The viewer's own theme and density remain theirs.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-3.16.1 | A look change updates interior tokens in one frame with no intermediate token values, and the city sweep completes in ≤ 2.5 s under Full. | rt replay of a Program change; frame capture of an interior and of the city. |
| TWN-R-3.16.2 | A look switch causes no shader compilation and no atlas load on the frame it applies. | Harness counters during the switch. |
