# Township GPU frontend spike (WG-5533, mobile first: WG-5544)

This document has two parts.

- **Part A** is the current prototype, rebuilt **mobile first** (WG-5544) after the owner's instruction "i dont just
  want mobile stuff patched on i want it designed mobile first and then 'expansive' for desktop". It follows the
  canonical spec in `../spec/` (`00-mobile-first.md` binds the rest) and is measured against G0 criteria C1 to C14 as
  `../spec/07-plan-and-gates.md` section 7.2 words them. Its Results section is empty until the coordinator's run.
- **Part B** is the original desktop-first spike (WG-5533): its questions, its C1 to C9 as fixed before that
  measurement, its deviations, its three r187 findings, and its results, now marked superseded.

---

# Part A. The mobile-first prototype

Code: `packages/town-spike`. Measurement: `scripts/town-spike-measure.ts`.

## A1. What is built

Phone portrait (390 × 844, touch, one hand) is the design; tablet and desktop are expansions of it.

| Altitude | Route | Compact (the design) | Expansion |
|---|---|---|---|
| Town | `/town/` (also `/town/city`) | the **landing**: the Town Square and seven borough tiles on one screen, with no scroll. Each tile is a DOM link at least 44 px (in practice about 175 × 112) over its block vignette. Its live signals are text: Rewards shows the viewer's balance from `me.get`, Personal the unread counts, kept live by the rt `counts` frame. Flows run as streaks between tiles | expanded: the **plinth vista**, from the same scene graph. The blocks are turned by multiples of 90° to face the Square, and the tiles become plaques over the projected blocks. Orbit buttons (⟲ ⟳ ⌖), and drag to orbit with a fine pointer |
| Borough | `/town/city/b/:borough`; `/town/rewards` is an alias | the **high street**: one to six district bands. Each band is baked once to an image in a `<canvas>` inside the document scroller, so scrolling draws no canvas frame. Every building is a real link over its facade. The street dock holds ‹ Town, the neighbouring boroughs and a switcher. Rewards has three bands (Points with the Bank as the hero, Store, Badges); the other boroughs are stubs with one band | medium from 52.5 rem: the landing beside the street. Expanded: the vista framed on the borough, with the bands in a column |
| Building | `/town/points` | the Bank **lobby**: cards in the authored phone order (balance whole, Statement summary, Transfer entry) | medium and wider: the lobby beside the Statement room |
| Room | `/town/points/statement`, `/town/points/transfer` (also `?focus=points-ledger`, `?focus=points-transfer`) | one pane, full height. Its **dock** sits directly above the persistent bottom bar: Back, Search, View (List / Flow), Select, Copy N in Select mode, and Transfer's primary action | beside the lobby; the Statement becomes a table once its pane is 30 rem wide |
| Other buildings | for example `/town/store`, `/town/messages` | a stub page that names the building and says it is not built here, with "Open in Classic" and the way back to its street | same |

**The Statement on phones.** It is a list of two-line items. One item at a time expands to show every field. **Select**
mode adds a checkbox per item, and **Copy N** writes TSV and an HTML table. Search is a peek sheet with its field at
the bottom.

**The flow-ribbon diorama** opens collapsed, as a still frame. With View → Flow it opens to at most 35 % of the visual
viewport. It is baked to an image, so it scrolls with the page, and is orbited by ⟲ ⟳. Drag to orbit exists only with
a fine pointer, and `touch-action` is never changed on touch.

**Transfer** is a page pushed in the room, never a modal. Its primary action is in the dock, which rides directly above
the on-screen keyboard.

**Shell.**
- A read-only top bar: up, title, breadcrumb, balance chip, Motion.
- The **Updates** status layer, directly after the top bar in the DOM: at most two items, "+N" for the rest.
- The **bottom bar** at every altitude: City, Inbox, Approvals (only for viewers who may decide approvals), Command,
  Alerts, You.
- Command opens a bottom sheet whose search field is at the bottom, with the best match nearest it.
- You holds identity, balance and tier, the experience toggle, Motion and Hand.
- From 50 rem the bottom bar is a rail on the leading edge, and sheets are centred dialogs.
- In landscape (height below 30 rem) the short layout applies, whatever the width class: a title row and the rail on
  the thumb side. The title row is 44 px, not the spec's 40 px, so its up and Motion buttons keep the 44 px target.

**Transitions.**
- Landing → street zooms from the tile into the street: the canvas camera zooms into the tile while the street grows
  out of it.
- Street → building and lobby → room grow out of the tapped link. Going up reverses them.
- Motion Reduced (the default) is a 150 ms crossfade with a camera cut. Off is a cut. The crossfade does not depend on
  the render loop: two opacity animations on the compositor (the outgoing view, frozen in place, over the incoming
  one), ended by a 150 ms timer that then moves focus. A slow GPU or a software rasteriser cannot stretch it; Playwright
  WebKit, which rasterises in software, took 969 ms when the crossfade advanced per animation frame.
- Focus moves to the new view's heading.

**Swap contract (town side, UI-MAP 8.5).**
- **Boot.** `?experience=` is consumed first. The override `classic` goes to the classic mirror at once. Otherwise
  `site.appearance.get` decides. A cached value is kept, but it is not trusted for a redirect.
- **No WebGPU and no WebGL2:** Classic with `?notice=town-unsupported` and the session flag `plinth.town.unsupported`.
- **Live.** The app connects to `/rt` exactly as Classic's `core/rt.js` does, and re-reads the appearance on a Program
  change. A viewer following the site leaves for Classic after a fade. Typed input, an open sheet or a composition
  makes it wait behind "The site switched to Classic. Switch now · Stay here".
- **The toggle.** The You sheet offers "Classic view", "3D view" and "Follow site default". Classic navigates to the
  classic route with `?as=` kept and the town-only parameters dropped.
- **Renderer failure.** A failure after the probe stays on the route in **Plain mode** with a notice, and never
  redirects (spec ruling M-18).

**Rendering.**
- three@0.187.0 `WebGPURenderer` and TSL with the WebGL2 fallback, canvas MSAA off.
- Phones run the Base tier with **hybrid text**: all text is DOM text, and no glyph is painted.
- An expanded container with a fine pointer runs Enhanced: text and surfaces are GPU-painted from the Plat with the
  parity fallback and clip chain (`plat/painter.ts`, `plat/parity.ts`), the text atlases with the `OffscreenCanvas`
  fallback, shadow maps and bloom.
- The town keeps the tilt-shift and the procedural model-making materials. Every building is a procedural recipe
  (`town/model.ts`), merged into three draw calls per block (`town/parts.ts`).

**The first paint (C14).** The first paint is the Plat shell and the route's data, nothing else:
- The main chunk holds the shell, the views, the realtime client and the borough data (`town/boroughs.ts`), and no
  three.js. Everything that needs three (the engine, the town, the bakes, the painter, parity's GPU half, the ribbon)
  is in `src/gpu.ts`, requested with a dynamic import **after** t1, so it never competes with the data on a slow
  connection. three is its own named chunk (`three`), so the loading report shows its size apart.
- Phones use the system UI font stack. Inter and JetBrains Mono (`text/font-faces.ts`) load only when the GPU paints
  text (Enhanced), and only their Latin subsets; before, a preload sample with Cyrillic, Greek and Latin Extended
  characters fetched those subsets on every device.
- The people directory (the Transfer form's recipient suggestions) loads after t1.
- Until the GPU chunk has baked a band, a street shows its buildings as a plain list of links.

**Torn out:** the plinth overview as the only town, the dolly Enter into the Bank facade with its pane cards, the
two-column 12-column interior, the HUD and the projected city links.

## A2. Deliberate deviations (prototype scope)

- **Desktop-tier risk: whole-atlas re-uploads.** The second run reported `atlasUploadBytes` of 100,663,296 for 24
  uploads: every glyph or run added to an atlas re-uploads the whole 4 MiB page (2048 × 2048 R8), because three r187's
  `WebGPURenderer` honours neither `Texture.updateRanges` nor sub-rectangle uploads on either backend (Part B, B5a).
  This affects only GPU text, so only the Enhanced and Full tiers; phones paint no glyphs. Mitigations, in order:
  (1) batch every glyph and run added in a frame into one upload per page per frame (the painter already builds a whole
  frame before it flushes, so this means flushing once and never mid-build); (2) smaller atlas pages (512 × 512 R8, 256
  KiB each) filled in order, so an addition re-uploads one small page, not 4 MiB; (3) warm the atlas with the route's
  known strings at load, so uploads during scrolling are rare; (4) if three adds sub-rectangle uploads, use them.
  Record upload bytes per frame in the C3 run; if scrolling the table uploads more than one small page per frame,
  this is a K11 concern (read and build budget) for the desktop tiers.

- **Shell breakpoints are rem media queries**, not `@container` queries on `#plat`. Container containment would make
  `#plat` the containing block of the fixed bottom bar, dock and status layer. Here the app container is the
  viewport, so the classes come out the same. Widget presentation does follow each pane's width (the Statement's
  `ResizeObserver`).
- **The street's live overlay is not built.** Bands are baked images; flows, the lamp and constructions are not drawn
  on a street. The landing draws the flows.
- **Base-tier surfaces at compact are CSS twins.** The document scrolls on phones, and a canvas-painted surface would
  lag the compositor (ruling M-12). So lobby cards, rooms and docks are CSS at compact; the GPU draws the town, the
  baked bands and diorama, the backdrop and the transitions.
- **Tilt-shift at Base** keeps the spike's two half-resolution Gaussian levels; the spec's Base is one level at quarter
  resolution. Bloom strength is 0 at Base.
- **Not built:**
  - the web app manifest and service worker;
  - the agent strip, the `ui.present` plate and the History sheet;
  - omitting unavailable districts for members, and the People lanes;
  - the borough streets other than Rewards (one-band stubs);
  - the Approvals, Inbox and Alerts destinations (they reach stub pages or a short sheet);
  - the landing's list mode at text sizes above 150 %;
  - the sibling swipe on the room title strip (the ‹ › links exist).
- **Real-phone criteria (C11 to C13)** need the two owner-named phones over HTTPS and the device reporter, which is
  not built. The script reports them as not run.

## A3. Criteria (spec 07 section 7.2, as they now read)

C1 to C9 (reference machine) are checked in the desktop expansion pass, on the Bank interior and the vista. C10 to
C14 (phones) are copied from spec 07 section 7.2.2 with its wording, before any phone measurement is recorded here.

### A3.1 Reference machine (C1 to C9)

| Id | Criterion | Pass | Kill |
|---|---|---|---|
| C1 | Paint ↔ Plat alignment of text runs | ≥ 99.5 % of runs within 1 CSS px | < 97 %, or any run off by > 4 px not explained by a line break |
| C2 | Line-break parity | ≥ 99.5 % of text nodes match | < 99.0 % |
| C3 | Interior frame time (ledger scroll and static) | p95 ≤ 16.7 ms | p95 > 33 ms |
| C4 | City overview frame time (shadows, tilt-shift, bloom, flows, plaques) | p95 ≤ 16.7 ms | p95 > 33 ms |
| C5 | WebGL2 parity | every scene renders with graceful, listed degradations | a scene fails, a shader fails, or an effect is missing |
| C6 | Selection and copy | exact memo string and exact three-row TSV | any mismatch |
| C7 | Typing into transfer inputs | values land, inputs visible, confirm shows them | lost typing or invisible inputs |
| C8 | Plain mode and forced colours | readable Plat text, no canvas | transparent text or a canvas over it |
| C9 | Enter and Exit hand-off | focus on `h1`, Plat live, altitude right; reduced motion is a ≤ 200 ms crossfade | lost focus or inert Plat |

### A3.2 Phone (C10 to C14)

| Id | Criterion | Where | Pass | Kill |
|---|---|---|---|---|
| C10 | **Text integrity in phone emulation.** Phones run hybrid text (`03` section 3.5.7), so (a) and (e) test the phone path and (b) to (d) test GPU text in narrow panes with a fine pointer forced (the desktop narrow-pane case at phone DPRs). (a) `doubleText()` empty on every spike scene and after each of: a breakpoint crossing (resize 390 → 800 → 390), rotation (844 × 390 and back), keyboard open and close (`visualViewport` emulation), a scroll fling, Enter and Exit. (b) No painted glyph ink outside its element's clip chain on the test page; every ellipsis-truncated element shows the browser's visible string or is DOM-painted. (c) After each reflow in (a), every **painted** run within 1 CSS px of the browser's box, with the per-element guard on; the DOM-fallback share reported. (d) Every glyph baseline on an integer device pixel at DPR 2.625 and 3, and the canvas backing size equal to `round(css × dpr)`. (e) With `OffscreenCanvas` deleted before boot (all three projects) the scenes paint and pass (a) to (d); with each init step forced to fail, the route ends in Plain mode with its notice and no uncaught error. | emulation, all three projects | (a), (b), (d), (e) hold everywhere; (c) 100 % of painted runs within 1 CSS px and DOM-fallback share ≤ 0.5 % | any double text, any ink outside a clip, an error screen on any injected failure, or a DOM-fallback share > 2 % in any project |
| C11 | **WebGPU and the Base tier on real phones over HTTPS.** Each phone loads the spike over HTTPS from the LAN: record `isSecureContext`, `navigator.gpu`, the adapter's info and limits, and the active backend; then run the portrait scenes on WebGPU (where exposed) and forced WebGL2, recording frame p95 for the Statement list scroll, the Rewards street (the scroll must need no canvas frame; the overlay at rest with effects), one band re-bake, the busy landing (8 constructions, 1,500 particles, the lamp) and the compact Enter, plus the interior warm-up time after `renderer.init()`. Also record whether WebGPU is exposed when the certificate is clicked through (`@vitejs/plugin-basic-ssl@2.3.0`). | the two real phones | secure context on both; WebGPU active on at least one of the two (each phone's result recorded); every portrait scene renders on both backends; list scroll p95 ≤ 16.7 ms, street scroll with zero canvas frames, overlay at rest ≤ 16.7 ms, band re-bake ≤ 8 ms, busy landing ≤ 33 ms, compact Enter ≤ 16.7 ms, warm-up ≤ 600 ms (targets), on at least the WebGL2 backend of both phones | no secure context on either phone with either certificate method; a scene or shader failing on either backend; list scroll or overlay p95 > 33 ms on either phone |
| C12 | **Touch, scrolling and thermals on real phones.** (a) In the Rewards street, 50 taps after a fling has settled land on the link under the finger, and 50 taps during a fling stop the scroll and activate nothing (TWN-R-1.4.3). (b) A slow-motion recording (240 fps where the camera allows, else the device's screen recording) of a street fling shows the buildings and their DOM plaques moving together (no frame with a plaque more than 2 px from its building), and of a Statement fling shows no frame with text missing or doubled. (c) A 10-minute scripted soak (landing and street, two rebuild bursts, interior work) at Base: on Android, `dumpsys thermalservice` status every 10 s and `dumpsys battery` level before and after (unplugged, 50 % brightness); on iOS, the drift guard's log and the frame-time trace, recorded as "guard only". | the two real phones | (a) 100 % as described; (b) no such frame; (c) Android status ≤ LIGHT, drain ≤ 4 %, no thermal step-down; iPhone: no thermal step-down by the guard | (a) any tap navigating to a building other than the one under the finger, or any tap during a fling navigating; (b) any frame with a plaque more than 8 px from its building, or text missing or doubled; (c) Android status above MODERATE, or drain > 8 %, or the guard firing within 3 minutes on either phone |
| C13 | **Memory on real phones.** GPU allocation accounting and the JS heap (`performance.memory` on Chrome, Web Inspector on Safari) through 20 Enter and Exit cycles and the soak; context loss and tab reloads counted. | the two real phones | GPU ≤ 96 MiB, heap ≤ 64 MiB, no context loss and no tab reload | GPU > 160 MiB, or a tab reload or two context losses during the run |
| C14 | **Main-thread cost and loading in phone emulation.** Main-thread CPU per frame (read, build, submit) while scrolling the Statement list and the Rewards street, a full read-batch re-read of the lobby, t1 and t3 on the design network with a cold cache, and the compressed bytes before t1 and before t3, with the three r187 build's own size reported separately. | emulation, Chromium 390 × 844 DPR 3, 4× CPU | CPU per frame p95 ≤ 6 ms; re-read ≤ 4 ms p95; t1 ≤ 2.5 s, t3 ≤ 4.0 s; ≤ 170 KB before t1 and ≤ 450 KB before t3 (targets) | CPU per frame p95 > 12 ms; t1 > 4 s; bytes before t1 > 250 KB |

### A3.3 Phone-first checks the script adds (from spec 00, 01 and 02)

The harness (`window.__spike`) computes each from the Plat, at every recorded step of the phone walk.

| Check | Pass |
|---|---|
| One copy of every text | `doubleText()` is empty at every step: after landscape and back, after 390 → 800 → 390, with the keyboard emulated open, and with `OffscreenCanvas` deleted |
| Hybrid text on phones | every phone step reports `textMode: "hybrid"` (or Plain mode) and no glyph instances |
| Tap targets | no visible control is smaller than 44 × 44 CSS px under a coarse pointer (24 × 24 on the desktop) |
| The landing is one screen | at the phone viewport the plinth ends above the bottom bar and the document does not scroll vertically; in landscape it fits the content area |
| The bottom bar in rooms | the bottom bar is present in the Statement and Transfer rooms, and the room dock sits directly above it |
| Street links | every band is baked; every building link is at least 44 × 44, none overlap, and the band image is inside the scroller |
| Street scroll | scrolling a street draws no canvas frame |
| The diorama | the open flow ribbon is at most 35 % of the visual viewport and does not set `touch-action: none` |
| Keyboard | with the visual viewport at 60 % and the memo focused: keyboard mode is on, the top bar is hidden, the dock is on the keyboard's top edge, and at least 40 % of the viewport is above it |
| Command sheet | its field is in the bottom 40 % of the screen, and the results sit above it |
| Swap toggle round trip | You → Classic view lands on the classic mirror (`/points`) with `?as=` kept and the town-only parameters dropped. `?experience=town` brings the viewer back, sets the override and strips the parameter. With the override `classic`, a town URL redirects at boot |
| Pixels | every screenshot has at least 90 % non-near-black pixels. The same scene on WebGPU and WebGL2 differs by at most 0.06 (mean absolute RGB difference over a 24 × 40 grid): the Pixel 7 landing, street, lobby, Statement and Flow; the desktop vista, street, interior and ribbon |

## A4. How to run

The backend must be running (the API on 8782, realtime on 8781). Run Classic's dev server too, so the town app is
served from one origin with Classic and the swap toggle can land there.

```sh
pnpm dev                                       # api, rt, worker, mcp and Classic on http://localhost:5173
pnpm --filter @plinth/town-spike dev           # the town app on 5180, proxied by Classic at /town/
npx tsx scripts/town-spike-measure.ts shots/town-mobile
# another origin (Classic's HTTPS server for phones on the LAN, or the town server alone):
TOWN_SPIKE_URL=https://<host>:5443/town/ npx tsx scripts/town-spike-measure.ts shots/town-mobile
# also flip the site default through site.appearance.set to check the live swap (restored afterwards):
TOWN_SPIKE_LIVE_SWAP=1 npx tsx scripts/town-spike-measure.ts shots/town-mobile
```

The run is phone first:

1. Pixel 7 (installed Chrome, DPR 2.625, touch) on WebGPU and on WebGL2, then iPhone 13 (WebKit, touch).
2. The zoom transitions, held mid-way under Motion Full, and the reduced-motion crossfade.
3. C10: GPU text forced in narrow panes at DPR 2.625, `OffscreenCanvas` deleted, each init step forced to fail.
4. C14: Chromium 390 × 844 at DPR 3, CPU 4× slower, the design network, against the production build (below).
5. The desktop expansion pass at 1440 × 900 on both backends.
6. Plain mode and forced colours, on a phone and on the desktop.

It writes `report.json` and a PNG of every view on phone and desktop to the output directory.

**C14 measures the production build, not the dev server.** The loading budgets (t1 ≤ 2.5 s, t3 ≤ 4.0 s, ≤ 170 KB
before t1, ≤ 450 KB before t3, all compressed) are about what a phone downloads. The Vite dev server serves unbundled,
unminified modules, so the first run measured 4.7 MB and a t1 of 25.8 s there, which says nothing about the design.
For C14 the script therefore:

1. runs `pnpm --filter @plinth/town-spike build` (`vite build`, base `/town/`, output in `packages/town-spike/dist`,
   which is not committed);
2. serves `dist` under `/town/` from a small static server inside the script on port 5181
   (`TOWN_SPIKE_PROD_PORT`), gzip-compressed (level 9) with the SPA fallback, proxying `/api` to the API process
   (`PLINTH_API_URL`, default `http://127.0.0.1:8782`); `/rt` is not proxied, because the realtime socket is not on
   the path to t1 or t3;
3. loads `/town/points/statement` cold, with the cache disabled, the design network and the CPU 4× slower, and reads
   t1, t3 and the transferred (compressed) bytes before each, with the three r187 chunk reported separately.

The budgets are unchanged. Every other pass still runs against `TOWN_SPIKE_URL`. The report's `c14.loading.table`
lists every resource (document, scripts, styles, fonts, API calls) by transferred size, with its decoded size and
when it finished, so the bytes before t1 and t3 can be read line by line.

Run 2 (the first against the production build) measured t1 4,531 ms and 556,618 bytes before t1 (19 resources; the
per-resource breakdown was not yet recorded). Then the whole app, three.js included, was one chunk loaded before the
first paint (which is why the three-named byte count read 0), and the preload sample pulled four font subsets of
Inter and two weights of JetBrains Mono. The changes in "The first paint" above move all of that behind t1.

**Clipboard line endings.** On Windows the clipboard turns LF into CRLF in `text/plain`, so the copy checks compare
with line endings normalised; the TSV the app writes uses LF.

URL parameters:

| Parameter | Effect |
|---|---|
| `?as=<handle>` | the dev principal (default `maya-ortiz`) |
| `?backend=webgl2` | three's WebGL2 backend (`forceWebGL`); the default is WebGPU with automatic fallback |
| `?plain=1` or `?render=plain` | Plain mode: no canvas |
| `?motion=full`, `reduced` or `off` | Motion (the default is Reduced, or the viewer's stored choice) |
| `?tier=base` or `enhanced`; `?text=gpu` or `dom` | pin the tier; force GPU text (C10 b to d) or hybrid text |
| `?fail=init`, `warmup`, `text-surface` or `first-frame` | fault injection: that step throws, and the route must end in Plain mode |
| `?experience=classic` or `town` | sets the override, then is removed from the URL |
| `?debug=overlay` | with GPU text, the DOM text in red at 50 % over the painted text |

## A5. Results

Run 3 (decisive): 2026-11-23T14:30:33.411Z, installed Chrome (channel `chrome`) for Pixel 7 and desktop, Playwright WebKit for
iPhone 13, GTX 1080 Ti. Phone profiles are emulation; C11–C13 need real phones and are not run.

| Id | Verdict | Notes |
|---|---|---|
| C1 | pass | desktop painted runs within 1 CSS px on both backends; phones use DOM text by design (hybrid text) |
| C2 | pass | line-break parity on desktop |
| C3 | pass | interior frames inside budget on both backends |
| C4 | pass | desktop vista frames inside budget |
| C5 | pass | pixel checks: no dark shots; WebGPU vs WebGL2 mean absolute difference ≈ 1e-5 on every compared view |
| C6 | pass | Select-mode copy (phones) and table copy (desktop), line endings normalised |
| C7 | pass | transfer typing and confirm step |
| C8 | pass | plain and forced colours |
| C9 | pass | focus to each new heading; reduced-motion crossfade 158 ms (Pixel 7), 166 ms (iPhone 13), compositor-driven |
| C10 | pass | doubleText() empty on every view; fault injection and missing-OffscreenCanvas runs fall back cleanly |
| C11–C13 | not run | need the two reference phones over HTTPS (`pnpm --filter @plinth/web dev:https`, port 5443) |
| C14 | target miss on t3 only | production build, phone390, 4× CPU, 1.6 Mbit / 150 ms: t1 1.78 s (≤ 2.5), 43.8 KB before t1 (≤ 170), statement and street scroll CPU p95 ≤ 2 ms (≤ 6); **t3 4.83 s against the 4.0 s target** (kill is t1 > 4 s, not reached). The cost is the `three` chunk, 231 KB compressed, fetched after t1. Mitigations per K12: stream the Base pipeline set only, warm-fetch the GPU chunk at low priority during t1, and defer the city chunk until the first City tap. |

Phone sub-checks: the landing fits one screen; tap targets are at least 44 px; the bottom bar is in rooms; street links work; street scrolling draws no canvas frame; the flow ribbon takes at most 35 %; the command field is at the bottom; the swap round-trips; hybrid text is on for phones; landscape fits. All pass.

Before and after for first paint (C14):
- **Run 2:** one bundle, with three.js imported statically and the font subsets awaited. 557 KB arrived before t1, and t1 was 4.53 s.
- **Run 3:** the shell chunk is 36.6 KB, CSS 6.5 KB, plus API calls. The GPU chunk and three.js load after t1, and phones use the system font. 43.8 KB arrives before t1, and t1 is 1.78 s.

Known risk recorded above: atlas re-uploads on the desktop tier (100,663,296 B over 24 uploads in run 2).

Decision: **G0 passes in emulation for the mobile-first prototype.** The open items are C11–C13 on real phones and the t3 target.

---

# Part B. The desktop-first spike (WG-5533, superseded)

The owner chose Township (`../proposals/township.md`), with the grafts in `../evaluation-matrix.md`. Before any
city shell or widget work, this spike checks whether the core idea holds: GPU-painted text over a real, transparent,
semantic DOM (the Plat) on three.js `WebGPURenderer`, on both the WebGPU and WebGL2 backends.

It covers spikes 1 and 2 of `../reviews/judge-feasibility.md` section 7.2, as far as one interior can, and the
blocking forced-colours and focus requirements of `../reviews/judge-access.md`.

Code: `packages/town-spike` (one package, laid out as the spec's packages: `src/engine`, `src/text`, `src/plat`,
`src/city`, `src/interior`, `src/harness`; Part A describes the current layout). Measurement: `scripts/town-spike-measure.ts`.

The pass and kill criteria below were fixed **before** any number was measured. Do not edit them after the run. If a
criterion turns out to be wrong, add a note under Results and leave the criterion as written.

## B1. Questions the spike answers

| # | Question | Why it matters |
|---|---|---|
| Q1 | Can glyphs painted on the GPU, positioned only from Plat-measured element rects and our own line breaker, land within 1 CSS px of the browser's own text? | This is the core bet of every proposal. If it fails, Plat text stays visible and the GPU paints surfaces only (Township R13). |
| Q2 | Does our line breaker (Intl.Segmenter word boundaries plus `measureText` widths) break lines where the browser does? | This is Township's stated kill signal: a mismatch rate above 0.5 %. |
| Q3 | Do native selection, copy, form typing and native scrolling still work when the text is transparent DOM over a canvas? | These are enterprise needs. The design only makes sense if they come free from the DOM. |
| Q4 | Can three r187 `WebGPURenderer` with TSL hold the frame budget at both altitudes on this machine? | The budgets in R7 are targets only. Nobody has measured them yet. |
| Q5 | Does the same TSL source run on the WebGL2 backend (`forceWebGL`) with no missing effect? | "One shader source" is what made the stack choice. The spike exercises MRT (output plus emissive), an RGBA32F `textureLoad` in a vertex shader, R8 textures, instanced attributes, shadows, Gaussian blur and bloom. |
| Q6 | Do Plain mode and forced colours show readable text, drawn only once? | Access must-add 1 (X1): transparent text and forced colours. |
| Q7 | Does the Enter transition (dolly, flatten to orthographic, windows unfolding into panes) hand off to the live interior? And does reduced motion replace it with a crossfade? | This is the signature moment of S.3, and access must-add 3. |

**Out of scope:**
- MSDF atlases. The third glyph path is deferred (see B5).
- IME in Japanese and Korean, autofill, zoom to 200 %, text spacing, Safari, Firefox and phones.
- `ui.present`, construction and realtime.
- Picking with three-mesh-bvh. City links are DOM hit targets over the projected building rects.

## B2. Reference machine

- The Windows 10 desktop this repository runs on, with a **discrete NVIDIA GTX 1080 Ti** (Pascal).
- Playwright's bundled Chromium, headless, launched with
  `--enable-unsafe-webgpu --use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`.
- WebGPU gets a real adapter on that GPU, and WebGL2 is ANGLE D3D11 on the same GPU.
- The viewport is 1440 × 900 CSS px at DPR 1.

**What this machine cannot tell us.** The spec's integrated-GPU (Iris Xe), Apple-laptop and phone budgets (R7.1,
R7.2) cannot be measured here. The frame numbers below only show whether a fast discrete GPU has headroom. A pass here
is necessary for the budgets, not sufficient. A fail here is a kill.

## B3. Pass and kill criteria (fixed in advance)

Every criterion is checked for each backend: `webgpu` (the default) and `webgl2` (`?backend=webgl2`, which is three's
`forceWebGL`). A criterion passes only if it passes on both, unless the row says otherwise.

| Id | Criterion | Pass | Kill (stop and fall back) | How the script measures it |
|---|---|---|---|---|
| C1 | Paint ↔ Plat alignment of text runs | max delta ≤ 1 CSS px for **≥ 99.5 %** of painted runs | < 97 % of runs within 1 CSS px, or any run off by > 4 CSS px that is not explained by a line-break mismatch | `__spike.alignment()` in the interior after the ledger scroll. Each painted glyph run's box (left, top, right, bottom, from our engine) is compared with the browser's box for the same characters (a DOM `Range` over the browser's line, so `Range.getBoundingClientRect`). The delta is the largest of the four edge differences. The script reports count, max, p99, the share within 1 px and the failing runs. |
| C2 | Line-break parity | **≥ 99.5 %** of Plat text nodes have the same painted line count and the same line-start offsets as the browser's line boxes | < 99.0 % (township.md R13 kill signal: a mismatch rate above 0.5 %, with a 0.5 % grace for measurement) | `__spike.lineBreakParity()`. The browser's line starts come from `Range.getClientRects()` per character: a new line starts when a non-space character's top moves down. These are compared with the engine's line starts. |
| C3 | Interior frame time | **p95 ≤ 16.7 ms** at 1440 × 900, DPR 1, while scrolling the ledger and on a static interior | p95 > 33 ms | `__spike.frameStats(240)` while the script scrolls the ledger. Frame time is max(GPU time, CPU time) per frame. GPU time comes from `timestamp-query` (three `trackTimestamp`, `resolveTimestampsAsync`) where available. CPU time is the JS time of the read, build and submit phases. Without timestamps (WebGL2 under ANGLE usually hides `EXT_disjoint_timer_query_webgl2`), the rAF delta over a free-running loop is used, and the report says which source it used. |
| C4 | City overview frame time | **p95 ≤ 16.7 ms** with shadows, tilt-shift, bloom, flows and plaques at 1440 × 900, DPR 1 | p95 > 33 ms | `__spike.frameStats(240)` at the city altitude, measured as in C3. |
| C5 | WebGL2 parity | Every scene (overview, transition, interior, ribbon, debug overlay) renders on `?backend=webgl2` with no missing effect. Any degradation is listed in the report and is graceful (a lower-quality path, not an absent one). | A scene fails to render, a shader fails to compile, or an effect is missing on WebGL2 | `__spike.backend()` must report `webgl2` as active when forced. The script records console errors and warnings per scene, and `__spike.state().effects` (which effects were built per backend). It saves a screenshot per scene and backend for the coordinator to compare by eye. |
| C6 | Selection and copy | Copy returns the **exact** ledger text: (a) one memo cell gives the memo string; (b) a selection across 3 rows gives the TSV of those rows, built from the data | Any mismatch | The script calls `__spike.selectLedger()` to set a DOM selection, presses `Control+C` and reads the clipboard (permissions granted). It compares with the expected string the harness builds from the fetched rows. |
| C7 | Typing into transfer inputs | Text typed with the keyboard into Recipient, Amount and Memo lands in the inputs. The inputs are visible (their computed `color` is not transparent). "Review transfer" moves to the confirm step, which shows the typed values. Nothing is sent. | Typing is lost, or the inputs are not visible | Playwright `getByLabel(...).pressSequentially(...)`, then `inputValue()`. It reads the computed style and clicks "Review transfer". |
| C8 | Plain mode and forced colours | `?plain=1` and `forced-colors: active` (Playwright `forcedColors: "active"`) show readable Plat text: computed `color` alpha is 1, no canvas is created or visible, and the ledger's first visible row text is present | Text is transparent, or a canvas is visible over it | `page.emulateMedia({ forcedColors: "active" })` and `?plain=1`. The script reads computed styles, checks that `canvas` is absent or `display: none`, and takes a screenshot of each. |
| C9 | Enter and Exit hand-off | After Enter, focus is on the interior `h1`, the Plat is visible and non-inert, and `state().altitude === "interior"`. After Escape it is `city`, with focus on the Bank link. With `prefers-reduced-motion: reduce`, the transition is a crossfade of ≤ 200 ms. | Focus is lost, or the Plat stays inert after the transition | The script reads `document.activeElement` and `__spike.state()`. Reduced motion uses `page.emulateMedia({ reducedMotion: "reduce" })` and times the `enter()` promise. |

**Amendment after run 1 (added at the coordinator's request; the original rows above are unchanged).** Run 1 passed every
verdict while the WebGPU city rendered black with stale painted text drawn over it. Only the screenshots showed it.
These checks now gate C5 and C9 from run 2 onward:

- **C5 pixels, per backend.**
  - The overview screenshot has ≥ 90 % non-near-black pixels (luma > 0.08), and the plinth region (x 30–70 %,
    y 40–75 %) has mean luma ≥ 0.30.
  - The interior screenshot has ≥ 90 % non-near-black pixels.
- **C5 pixels, across backends.** The screenshots of the same scene on webgpu and webgl2 are downsampled to 48 × 30
  cells and compared by mean absolute RGB difference (0..1). The limit is ≤ 0.06 for the overview, interior and
  ribbon, and ≤ 0.10 for the mid-transition unfold.
- **C9 stale runs.** `__spike.staleRuns()` counts painted runs whose Plat element is outside the roots painted at
  the current altitude, or is hidden. It must be 0 during the transition, after Enter and after Exit. This check runs
  in the painter, so it cannot see GPU-side staleness. That is covered by the cross-backend pixel check above.

**Reading the results:**
- If C1 to C3 and C6 to C8 pass, the text-over-Plat architecture is cleared for the spec synthesis.
- If C5 fails, the "one TSL source" claim is downgraded and the degradation table in R2.2 is rewritten from the
  findings.
- If C1 or C2 hits a kill, Township falls back to visible Plat text with GPU surfaces only. That was R13's fallback.

## B4. How to run

The backend must be running already (the API on 8782 and realtime on 8781; `pnpm dev`, or `pnpm start:api` plus
`pnpm start:rt`).

```sh
pnpm --filter @plinth/town-spike dev          # http://localhost:5180/town/
# in another shell:
npx tsx scripts/town-spike-measure.ts shots/town-spike
# or against another URL:
TOWN_SPIKE_URL=http://localhost:5180/town/ npx tsx scripts/town-spike-measure.ts shots/town-spike
```

The script writes `report.json` and PNGs to the output directory.

URL parameters:

| Parameter | Effect |
|---|---|
| `?as=<handle>` | The dev principal (default `maya-ortiz`) |
| `?backend=webgl2` | Forces three's WebGL2 backend (`forceWebGL: true`); the default is WebGPU with automatic fallback |
| `?plain=1` | Plain mode: the Plat is visible with a simple stylesheet, and no canvas is created |
| `?debug=overlay` | The Plat text is shown in red at 50 % opacity over the GPU text |
| `?motion=reduced` | Forces the reduced-motion crossfade (same as the OS preference) |

Routes: the app is served under the base path `/town/`, so the classic dev server (5173) can proxy `/town` to it.
`/town/` is the overview and `/town/points` is the Bank interior. A deep link renders the interior directly. Every
navigation keeps `?as=` and the other query parameters.

## B5. Deliberate deviations from the spec in this spike

- **Two of the three glyph paths.**
  - **Raster runs**: text below 15 device px is drawn whole with `fillText` into an R8 run atlas, with a shelf packer
    and LRU eviction by shelf.
  - **Dynamic SDF**: text of 15 device px and above (titles, headings, KPIs, plaques) uses tiny-sdf glyphs at a 48 px
    em.
  - **MSDF atlases** (`msdf-atlas-gen` at build time) are **deferred**. They need a build-time tool and
    per-face atlases. The dynamic SDF path stands in for display text, which is the job that MSDF would do.
- **Tabular numerals use JetBrains Mono, not Inter `tnum`.** Canvas 2D cannot turn on OpenType features, so
  `measureText` and `fillText` cannot match DOM text that uses `font-variant-numeric: tabular-nums`. The Plat uses the
  monospace face for numeric cells instead. This is a finding for the spec (R3.1 item 3).
- **No MSAA anywhere.** The canvas has none (see B5a), and the scene pass has none, because a multisampled depth target would complicate the depth-of-field read.
- **Tilt-shift** mixes the sharp frame with two Gaussian levels at half resolution (`gaussianBlur` from the three
  addons) by a CoC built from the screen band and view depth. It does not use the spec's 13-tap variable-radius
  gather.
- **Pane cards** for the Enter transition come from one render target. The live interior is painted into it once, and
  each card samples its pane's rect. The spec uses a render-target array with one layer per card. The facade around
  the windows fades through the backdrop blur instead of the ordered-dither dissolve.
- **The flows replay real data.** They are the viewer's 12 most recent real statement lines (credits run from the
  Bank to the viewer's house, debits from the house to the Market), on a loop. Live `points.posted` frames are not
  wired up in the spike.
- **The ledger fetches every line up front** (pages of 200 through `points.statement`). The DOM is still virtualised
  (the window plus 30 rows of overscan). The in-widget search scans all rows (access must-add 6).

## B5a. three r187 facts checked in `node_modules/three` (the spec assumed r180)

| Spec assumption | What r187 does | Where |
|---|---|---|
| `PostProcessing` is the post chain class (R2.1, S.1) | It was renamed `RenderPipeline` in r183. `PostProcessing` remains as a deprecated subclass that warns once. The spike uses `RenderPipeline`, which is imported only through `src/engine/three.ts`. | `src/renderers/common/PostProcessing.js`, `RenderPipeline.js` |
| The capability probe calls `requestAdapter({ powerPreference })` and checks limits (R2.2) | The WebGPU backend requests the adapter with `featureLevel: "compatibility"`, and requests the device with **every** feature the adapter has. If the device lacks `core-features-and-limits`, three sets `compatibilityMode` and forces MSAA samples to 0. The harness reports `compatibilityMode`. | `src/renderers/webgpu/WebGPUBackend.js` `init()` |
| Atlases upload only the changed region (R3.4 "glyph uploads 0 after warm-up", R9.4 UPLOAD) | `Texture.updateRanges` is honoured only by the classic `WebGLRenderer`. Neither `WebGPURenderer` backend uploads a sub-rectangle, so any atlas change re-uploads the whole page. Buffer attributes do support `updateRanges`. The harness counts atlas uploads and bytes. | `src/renderers/webgl/WebGLTextures.js` (the only texture user); `src/renderers/webgpu/utils/WebGPUAttributeUtils.js` |
| Viewport and scissor are lower-left, as in WebGL | `Renderer.setViewport` and `setScissor` take the **upper-left** corner in logical px, on both backends. Render-target textures are flipped on the GLSL backend (`isFlipY()`), so `uv` and `screenUV` are top-left on both. | `src/renderers/common/Renderer.js`; `src/nodes/display/ScreenNode.js`; `src/nodes/accessors/TextureNode.js` `setupUV` |
| `forceWebGL` selects the fallback | It is confirmed: `forceWebGL: true` constructs `WebGLBackend` directly. Without it, `getFallback` builds the WebGL backend when WebGPU init fails, with a warning. | `src/renderers/webgpu/WebGPURenderer.js` |
| GPU frame time comes from `timestamp-query` | `trackTimestamp: true` turns on queries (only if the device has the feature). `resolveTimestampsAsync("render")` returns the summed duration in ms of all render passes since the last resolve. The pool holds 2048 queries, so the app resolves every frame. | `src/renderers/common/Backend.js`, `src/renderers/webgpu/utils/WebGPUTimestampQueryPool.js` |

Found in run 1 and fixed:

| Symptom | Cause in r187 | Fix |
|---|---|---|
| The WebGPU city was black, with stale painted text from earlier frames over it. The interior backdrop was black too. | `Renderer.currentSamples` returns 0 for fullscreen passes (the RenderPipeline quad, `QuadMesh`), so those draw straight into the canvas texture. Ordinary renders with `antialias: true` draw into a persistent 4× MSAA colour buffer: `loadOp` is "load" when `autoClear` is off, `storeOp` is "store", and it is resolved over the canvas. The overlay pass therefore loaded the previous overlay's MSAA buffer, which never held the city, and resolved it over the post-processed frame. WebGL2 draws both into the default framebuffer, so it was unaffected. | `antialias: false` on the canvas. Nothing drawn to the canvas needs MSAA: the city is rendered by the scene pass into its own target, and the 2D layers are pixel-aligned. |
| GPU timestamps were constant (p50 = p95 = max). | FRAME-updated nodes (the scene pass, Gaussian blurs, bloom) render once per `nodeFrame.frameId`. The frame id and `info.frame`, which groups timestamp queries, advance only in three's own animation loop. Back-to-back renders in the measurement re-ran only the final quad. | The app loop is now `renderer.setAnimationLoop`. Each measured frame runs in its own loop frame, and its queries are resolved before the next frame. The interior backdrop is captured at the start of the next frame, so the scene pass and blurs re-run for it. |
| The warning "PCFSoftShadowMap has been removed" | `WebGPURenderer` no longer has PCFSoftShadowMap and falls back to PCF. | `PCFShadowMap` is set explicitly. |

## B6. Results: desktop-first run (superseded)

These results are for the desktop-first prototype (a plinth overview, a dolly into the Bank, a two-column
interior), which WG-5544 replaced with the mobile-first build in Part A. They stay as the record of C1 to C9 on that
design.

Run 4 (the decisive run): 2026-11-23T12:36:46.175Z, installed Chrome 157.0.8103.80 (headless, channel `chrome`), 1440×900 DPR 1,
flags `--enable-unsafe-webgpu --use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`. Report and screenshots are kept out of the repository; rerun with B4 (or A4 for the current prototype).

| Id | webgpu | webgl2 | Verdict | Notes |
|---|---|---|---|---|
| C1 | max 1 px, 100% ≤ 1 px (156 runs) | max 1 px, 100% | pass | raster runs and SDF runs both inside 1 CSS px |
| C2 | 100% (153 nodes) | 100% | pass | includes the CJK/Latin mixed fixture and the longest memo |
| C3 | static p95 2.5 ms, scroll 2.4 ms | static 4.3 ms, scroll 3.2 ms | pass | limit 16.7 ms |
| C4 | p95 5.9 ms | p95 5.8 ms | pass | city with shadows, bloom and tilt-shift |
| C5 | pixel checks ok | pixel checks ok | pass | non-black and lit plinth on both; cross-backend downsampled difference inside limits; compared by eye: identical |
| C6 | single cell and three rows exact | same | pass | clipboard TSV equals the Plat text |
| C7 | recipient, amount, memo typed | same | pass | native inputs |
| C8 | plain: canvas absent, text opaque; forced colours: canvas absent, system colours | | pass | |
| C9 | enter, exit, focus return, reduced-motion crossfade, no stale runs | same | pass | |

Adapter (from the report): WebGPU nvidia / pascal (GTX 1080 Ti), core features (not compatibility mode); WebGL2 ANGLE D3D11 on the same card.

Graceful degradations observed on WebGL2: none visible in the screenshots; GPU time is higher (overview GPU p95 5.8 ms vs 0.74 ms on WebGPU).

Bugs the spike found and fixed (see the amendment above):
- **Canvas MSAA with full-screen passes.** It drew a black city and stale text on WebGPU only. Fixed by disabling canvas MSAA, which the spec must forbid.
- **GPU timestamp reads.** Frame stats read timestamps outside three's animation loop. Fixed.
- **The test browser.** Playwright's bundled Chromium cannot create a WebGPU device on Windows (`dxcompiler.dll` missing), so three silently fell back to WebGL2. The installed Chrome is now the default harness browser.

Limits of this run:
- **Small ledger.** Maya's statement has 26 lines, so the 900-row virtualisation is implemented but not exercised at volume.
- **Desktop only.** Phone and integrated-GPU budgets are unmeasured. The owner has since asked for a mobile-first redesign (WG-5536), so G0 is extended with phone-emulation and real-phone checks.

Decision: **G0 passes for the desktop text-over-Plat architecture on both backends.** The text architecture, WebGL2 parity and the Enter hand-off hold. Phone measurements are the remaining part of G0 under the mobile-first spec.
