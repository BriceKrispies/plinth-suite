# Judge review: engineering feasibility and architecture

Task-ID: WG-5532. Lens: what will break when this is built. Inputs: `BRIEF.md` and the five proposals
(`orbit.md`, `township.md`, `instrument.md`, `atelier.md`, `constellation.md`), read in full except where noted
below, plus three spot checks against the repository.

## 0. Method, and what I could not verify

I ran nothing. I read the specs and checked three claims against the code in `C:\dev\showpiece`.

Facts established from the repository:

- **`ui.present` writes no change.** `packages/mcp/src/tools.ts` lines 935-970: the tool description says "Writes
  no change and no audit row", it only calls `pg_notify('plinth_present', ...)`, and it returns `delivered_to: 0`
  with the reason "no live session registry in this layer". `ChangeEvent.kind` includes `"present"` in
  `packages/spec/src/change.ts` (line 71) and `changesSince` selects a `kind` column
  (`packages/engine/src/change-log.ts` line 1871), but nothing writes a present row, and `packages/rt` has no
  reference to `present`. So the realtime gateway must be changed to LISTEN and forward. Orbit (A.1, 6.6, S12) and
  Constellation (Appendix A.2, R6.6) say so. Township, Instrument and Atelier describe a change-stream item that
  does not exist.
- **Workspace pins.** Root `package.json` has `playwright ^1.65.1`, `vitest ^4.1.12`, `typescript ~5.9.3`.
  Township, Instrument, Atelier and Constellation match them. Orbit pins `vitest@3.2.4`,
  `@playwright/test@1.55.0` and `typescript@5.9.2` (Orbit 2.1, lines 495-496), which conflict with the repo.
- **Dependency pins.** All five pin `three@0.180.0` exactly. The names I know from that release are real:
  `three/webgpu`, `three/tsl`, `WebGPURenderer({forceWebGL})`, `renderer.compileAsync`, `mrt()`, `PostProcessing`,
  `MeshPhysicalNodeMaterial`, `instancedArray`, `storage`, `Fn().compute()`. They also pin `yoga-layout@3.2.1`,
  `@mapbox/tiny-sdf@2.0.6`, `msdf-atlas-gen 1.3`, `@preact/signals-core@1.8.0` and `vite@7.1.x`; none looks
  invented.

Claims I could not verify, and the spike list in section 7 turns each into a measurement:

- How completely three r180's WebGL2 backend supports per-attachment MRT blending, integer instanced attributes,
  `storage()` nodes and `textureLoad` on `RGBA32F` data textures.
- Whether `wgslFn` plus `Fn().compute()` can express kernels that use workgroup memory, barriers and hand-assigned
  `@group/@binding` (Constellation S1, Instrument 3.4).
- The headless-WebGPU flags `--use-webgpu-adapter=swiftshader` and `--use-vulkan=swiftshader` on the CI Chromium.
- Timestamp-query availability on Safari, Firefox and Android.
- `@modelcontextprotocol/sdk@1.32.2` (Atelier R9.10) and `AC-RT-5` (Atelier R6.6). I found no `AC-RT-5` in
  `docs/suite`.
- Every performance number in every spec. None is measured. They are targets, and I judge them by arithmetic and
  plausibility only.

Time estimates: I searched all five for sprint, person-day, week-of-work, t-shirt and similar phrases and found
none. Every plan is dependency-ordered and states "no durations". No automatic finding was raised for any
proposal. (Animation durations in milliseconds are scene data, not work estimates, and are fine.)

## 1. The architecture all five share, and what I think of it

All five are the same machine at different art direction.

1. A widget returns a declarative tree (Orbit view tree, Township "Plat" DOM plus PaintSpecs, Instrument
   `IElement`, Atelier `VNode`, Constellation `ViewTree`).
2. A reconciler lays it out (Yoga, or the browser for Township) and emits **GPU instances** and a **transparent DOM
   mirror** at the same boxes.
3. The mirror owns focus, forms, IME, selection, find and AT. The GPU draws chrome, text, charts and the 3D
   scene. Text is drawn twice.
4. A visible-mirror mode ("Plain", "Paper", "Plan") is the fallback and the first paint.

Verdict on this shared design:

- **It is sound for accessibility** and it is the only sensible way to meet the brief's requirement 5. Real
  `<input>`, `<dialog>`, `<a href>` and `<table>` elements with transparent text give IME, autofill, native
  selection, find-in-page and AT without emulation. The pattern is proven by CSS3D-style overlays.
- **For dense widgets the GPU does very little that the browser does not already do well.** A 912-row table or a
  permission matrix drawn as instanced glyph quads gains nothing in speed (the DOM virtualises that fine) and
  loses text fidelity, selection fidelity and scroll smoothness. The gain is purely visual consistency (shared
  light, exact transitions). Each proposal is honest about this in its section 13, and each lists "make the mirror
  visible" as the kill-criterion fallback.
- **Township is the one that admits it outright**: its interior is a DOM app with GPU-painted surfaces (R13.2,
  lines 2787-2803). The others differ only in how much of the interior is genuinely scene-lit. In practice every
  proposal's dense work happens on a flat, orthographic, pixel-snapped sheet (Orbit "reading pose", Township
  "Interior", Instrument "screen-parallel", Atelier "flat focus", Constellation "Panel mode"). The 3D is real in
  navigation, transitions, the agent rebuild and a few "data object" insets, and absent from the reading surface.
  That is a defensible product, but it is "DOM app with a very expensive painted backdrop plus 3D navigation" for
  the 60 to 70 percent of widgets that are tables, forms and lists.
- **Scroll ownership is the sharpest differentiator** and the one nobody spiked:
  - Orbit (8.1), Township (R4.2), Atelier (R9.5) and Constellation (R4.2) let a real DOM scroller own `scrollTop`
    and have the canvas follow in `rAF`. Correct ownership, but compositor-thread scroll leads the canvas by a
    frame or more on a fling, and under fractional scroll offsets (DPR 1.25, 2.625) the "pixel-snapped" text
    shimmers.
  - Instrument reimplements scroll with its own inertia and rubber band (8.2, line 1413; 9.4 line 1700; 13.11 line
    2444: "GPU scroll"), which is wrong for AT scrolling, find-in-page, iOS status-bar tap and scroll anchoring.

## 2. Orbit

**Strongest 3 points**

1. **Mirror contract is the most rigorous of the five.** In reading poses the mirror receives real pointer events
   (5.2), links are real `<a href>`, `<main>` is the native scroll container (8.1), `Primitive.mirror()` is part of
   the primitive interface (9.3), and a parity check ties `data-scene` ids to draw-list boxes (9.9). That is the
   design most likely to survive a real screen-reader session.
2. **Backend integration is correct.** It identifies exactly one server change, `ui.present` forwarding through the
   rt gateway (A.1, 6.6, S12), states that the tool writes no change, and gives the client side. It adds no action.
3. **The plan has a real riskiest-first gate.** G1 (Requirement 12) puts the 912-row ledger, the transfer form and
   the matrix on both backends, with SSIM, overlay drift, axe, parity and an IME test, before the UI kit and the
   77 widgets. K1 and K2 name the fallbacks.

**Five most serious defects**

1. **The render-target memory arithmetic is wrong by about 3x and breaks the stated ceiling (2.3 F2 line 538; 7.2
   line 1201; line 1204).**
   - F2 renders MSAA x4 into three MRT colour targets plus `depth24plus`: `rgba16float` (8 B), `rgba16float` (8
     B), `rgba8unorm` (4 B), depth (4 B), so 24 B per sample.
   - At 2560 x 1440 with 4 samples that is about 354 MB for the multisampled attachments alone, plus the resolved
     targets. The spec budgets 120 MB (and 256 MB GPU total).
   - On the integrated tier (1080p at DPR 1.25, about 3.24 MP) it is about 311 MB against a 70 MB claim and a 192
     MB ceiling.
   - Failure scenario: on Iris Xe the allocation exceeds the shared-memory budget, or the MSAA resolve of three
     targets every frame costs several milliseconds, so the 7.5 ms ledger-scroll GPU target is not reachable. The
     governor then drops tiers on exactly the reference device. The fix (no MSAA on the HDR targets, analytic edge
     AA as phones already use) is available but changes the look.
2. **WebGL2 parity of the slab shader is assumed, not shown (S.1 lines 1882-1883; 2.5).** The slab writes `hdr`,
   `emissive` and `ui` with different blend states per attachment ("hdr/emissive alpha-over, ui REPLACE"). In core
   WebGL2 blending is global to all draw buffers; per-attachment blend needs `OES_draw_buffers_indexed`, which I
   cannot confirm three r180's WebGL backend uses or that Safari exposes. The same shader also reads per-instance
   `uint` attributes and an `RGBA32F` data texture via `textureLoad` (S.0 and S.1).
   - Failure scenario: on the WebGL2 path a nearer panel's face blends over the farther panel's UI layer instead
     of replacing it, so text from the panel behind shows through. The text-legibility contract (B.3 rules 1 and
     2) fails on the fallback path only, and SwiftShader CI may not expose the extension difference.
3. **The camera move is the main navigation, and every move ends with a visible text change (3.3 lines 666-673).**
   Small text uses a hinted bitmap path at rest and switches to MTSDF during motion.
   - Failure scenario: after each route change the user sees all body text change weight and shape on the first
     frame at rest. The visual-regression suite must golden both states.
   - The hinted cache is keyed by font, size and quarter-pixel subpixel offset. That key space is large for tables
     of distinct strings, and it is exactly the text the ledger uses.
   - It stays invisible only if the swap is imperceptible, which the spec itself treats as a risk ("hinted runs
     switch to MSDF").
4. **Scroll/camera coupling is not covered by the drift tests (8.1 line 1298; 4.2; 9.9 overlay-sync row).**
   - `<main>`'s `scrollTop` drives the camera crane while the mirror (the hit target) is positioned by native
     compositor scroll and the canvas by `rAF`. The overlay-sync test only scripts camera moves, not momentum
     scroll.
   - Failure scenario: on an iPhone fling, a tap lands on a mirror button that has already moved a frame ahead of
     the drawn button. Fractional `scrollTop` also violates "origins snap to the device pixel grid" (B.3 rule 3)
     unless the snapped offset is rounded to device pixels and the mirror is rounded identically.
5. **Authoring cost is understated (R6 line 1743; 9.3).** Every one of about 40 primitives implements
   `layout`, `draw`, `mirror` and `input`, and Table, ten chart kinds, RuleBuilder, Diff, Kanban, MonthGrid, Matrix,
   StepGraph and `Stage3D` each also need a flat twin and a mirror table. The statement that the DOM widgets
   "port across almost line for line" is unsupported: today's widgets build DOM from DS components and CSS, and
   none of that survives.
   - Failure scenario: G1 validates three widgets. The other 74 depend on a primitive set that does not exist
     until S4, and S8 to S11 all wait on S6 (shell, page host).

Minor: the pins `vitest@3.2.4`, `playwright@1.55.0` and `typescript@5.9.2` disagree with the repository root, so
the new packages would not even share the workspace's test runner. The 26-station ring is geometrically fine but
the "Custom arc" and far-move spline add path-planning code with no user need that a flat route change would not
meet.

**Scores (1 to 10; higher is better, "authoring cost" higher = cheaper)**

| Dimension | Score | Note |
|---|---|---|
| Stack soundness | 6 | Right stack; memory arithmetic wrong; WebGL2 parity of the central shader unproven |
| A11y-mirror soundness | 9 | Best contract; real pointer events, native scroll, parity test |
| Widget authoring cost | 4 | Full primitive kit with three outputs each; 3D data objects with flat twins |
| Backend integration | 9 | Only gap identified correctly; no new actions |
| Perf credibility | 5 | Render-on-demand good; target tables rest on a wrong memory model |
| Plan quality | 8 | G1 spike before the widget wave; kill criteria K1 to K7 |

## 3. Township

**Strongest 3 points**

1. **The most honest architecture about what the GPU does.** The DOM (the "Plat") is the layout engine and the
   product, built and accepted first in "Plan mode" (D1, D2), and the interior painter is a layer on top (D5).
   Rollback is bounded at every step (R12 closing paragraph).
2. **Memory arithmetic is right.** R7.4 line 1778: RGBA16F at 1440p = 29 MiB, depth = 15 MiB, which matches
   2560 x 1440 x 8 B and x 4 B. No MSAA, no hidden multipliers.
3. **Pipeline and honesty discipline.** 31 plus 9 enumerated pipelines with a CI check (R7.5), a CPU picking
   design with no GPU readback (R9.5), and the "honesty rule" that only real events drive data-shaped motion.

**Five most serious defects**

1. **`ui.present` delivery rests on a non-existent change-stream item (R6.5 lines 1659-1665; Appendix B).** It
   claims `present` "reaches the browsers it targets ... as a change-stream item" and that the `packages/rt` relay
   is "optional, since the change-stream item already carries it". The tool writes no change (tools.ts:936) and the
   gateway forwards nothing.
   - Failure scenario: skipping the "optional" relay (D11) means demo beat "present" never fires. The relay is
     mandatory.
2. **Painting from live DOM geometry is the weakest mechanism in the five (R9.4 lines 2049-2078).** Each frame it
   reads `getBoundingClientRect` for the elements of every dirty pane (about 1,400 on Home) plus text line rects.
   - Triggers: a `MutationObserver` per pane, `ResizeObserver`, scroll, fonts loading.
   - Failure scenario: a font swap, a window resize or a filter keystroke dirties a pane and forces style and
     layout, then reads. 2.2 ms on Iris Xe is unmeasured and optimistic. On the Pixel 7 the same read batch blocks
     the main thread during a fling, which then drives scroll jank, the very thing native scrolling was kept for.
3. **The text-parity kill criterion tolerates visibly wrong pages (R12 D5, R13 row 1).** "Line-break parity
   ≥ 99.5 % of runs" means up to 0.5 % of runs may be painted on different lines than the DOM. A page of 1,400
   elements then ships with several misplaced runs, each a visible duplicate against selection and find
   highlights. The paint-versus-Plat check allows 1 CSS px of error on 0.1 % of elements, which likewise permits
   shipped defects.
4. **The city's asset pipeline is a single plan row with no tooling (A0, R2.1 line 964, R9.3).** Forty kit modules
   and 19 unique landmark meshes at 600 KB of glTF, hand-surveyed lots, KTX2 materials, 90 draw calls, 140k
   triangles visible.
   - Failure scenario: D8 (city), D9 (transitions), D10 and D11 (the demo's signature moments) cannot start
     without art that no step produces. Nothing says whether the kit is procedural or authored. The Iris Xe budget
     of 12 ms for a busy city with GTAO, DOF, a 2048 shadow map and 6,000 particles (R7.2 line 1743) is
     unmeasured.
5. **Enter transition hand-off puts focus and IME at risk (R4.2 lines 1249-1254, R9 D9).** During Enter/Exit the
   moving panes' Plat subtree is `inert` and `visibility: hidden` while the GPU paints "texture snapshots" of the
   panes.
   - Failure scenario: a focused input loses focus and composition when the user triggers a floor change or
     look-driven transition mid-edit. The spec only asserts "no frame where neither is visible". It does not
     preserve focus or IME state. Render-target arrays are also named as a Safari risk (R13 row 6) with a 12-card
     cap on WebGL2.

**Scores**

| Dimension | Score | Note |
|---|---|---|
| Stack soundness | 7 | Sound, avoids compute; Safari render-target arrays flagged |
| A11y-mirror soundness | 7 | Plat is visible DOM in Plan mode; "painted from DOM" model has parity risk |
| Widget authoring cost | 8 | DOM widgets port mechanically to `town-kit`; lowest authoring cost |
| Backend integration | 5 | Present claim wrong; otherwise no backend change |
| Perf credibility | 6 | Memory right; DOM read batch and city budgets unmeasured |
| Plan quality | 7 | Product ships at D2 as an accessible app; gate for text is too lax; art unplanned |

## 4. Instrument

**Strongest 3 points**

1. **Early, measured kill gates in the plan.** Step 2 gates legibility (13.1), step 4 gates IME and overlay
   alignment in three browsers (13.3), step 9 gates widget authoring cost as a ratio against today's widget line
   counts (13.4). The authoring-cost gate is the only quantified one in the five.
2. **Closed pipeline inventory and tiered readiness (7.6, 7.7, Appendix B).** The first paint uses three tier-A
   pipelines, with a flat fallback for any pipeline not yet compiled. A CI check fails if the inventory grows.
3. **Honest about dry runs and refusals (6.7).** It does not pretend to see previews, which keeps the realtime
   model truthful.

**Five most serious defects**

1. **Backend claims are wrong, and the spec says nothing needs changing (1.4 line 212; 6.6 line 1179; 6.7 line
   1197: "Nothing here needs a backend change").** It states `ui.present` "writes a change-log item with `kind:
   "present"`". It does not (tools.ts:936). Failure scenario: demo beat 3:55 (present with `focus: region = EMEA`)
   never reaches any browser, and no plan step owns the gateway change.
2. **Scroll and pointer ownership are given to the canvas (4.7 line 840; 5.3 lines 908-910; 8.2 line 1413; 9.4
   line 1700; 13.11).** The mirror is `position:fixed; pointer-events:none; contain:strict`, scroll is a custom
   inertia (`0.95` decay per frame) with a hand-built rubber band, and a click on a control becomes `click()` on
   its mirror element.
   - Failure scenarios:
     - `select.click()` and `input[type=date].click()` do not open the native picker. The kit lists native
       `<select>` and date inputs.
     - NVDA browse-mode `scrollIntoView` and `Ctrl+F` scroll the fixed mirror, not the deck.
     - iOS status-bar tap does nothing.
     - Programmatic `click()` loses middle-click and context-menu semantics on links.
     - Each is a separate regression against the DOM app.
3. **GPU filtering and sorting of tables is wrong-sized and double-implemented (3.4 lines 619-690; 2.1 line 461;
   Appendix B).** For 900 and 8,500 rows (the seed) it adds compute predicate, scan, compact and bitonic sort,
   `mapAsync` readback, plus a worker twin for WebGL2.
   - Raw compute outside three (`RawComputePass`) needs shared `GPUBuffer` handles with three's renderer, which I
     could not verify is supported.
   - The window text lands one frame after the stripes (line 687), so rapid typing shows stale text under fresh
     row stripes.
   - Scenes S2 and S3 benchmark 100,000-row and 1,000,000-point synthetic data the brief does not ask for. That is
     scope with no requirement behind it.
4. **Authoring cost is high and the kit is the whole company (1.2, 1.3, 9.2, 13.4).** About 25 kit components plus
   12 instruments plus 4 wells. Every control needs mirror semantics, GPU draw, hit test and keyboard path.
   - The authoring gate fires at step 9, after steps 0 to 8 (renderer, text, layout, mirror, kit, looks, shell,
     table instrument) are built.
   - Failure scenario: step 9 shows a 2x ratio, the "second wave" rule then defers the call another wave, and the
     plan has committed the kit and compute table.
5. **Frame-time targets conflate percentiles and ignore main-thread jitter (7.3 lines 1241-1254).** Desktop "p99
   frame interval ≤ 8.3 ms at 120 fps" with "GPU p95 ≤ 4.5 ms, main-thread CPU p95 ≤ 3.0 ms".
   - Failure scenario: any GC pause, Long Animation Frame or font decode breaks p99 at 8.3 ms on a mid-range
     laptop. The spec's own S2 and S3 scenarios (100k rows, 1M points) are the ones most likely to blow it.
   - The 3-tier readiness warm-up is good, but nothing measures a compile hitching a frame on Safari.

**Scores**

| Dimension | Score | Note |
|---|---|---|
| Stack soundness | 5 | Raw compute interop and compute-dependent features double the surface |
| A11y-mirror soundness | 5 | Pointer-events none, custom scroll, `click()` conversion break natives |
| Widget authoring cost | 3 | Largest kit; gate arrives late |
| Backend integration | 3 | Wrong present claim; "no backend change" is false |
| Perf credibility | 4 | p99 at 120 fps on an enterprise UI with synthetic mega-scenes |
| Plan quality | 7 | Good gates, wrong ordering of table compute before domain proof |

## 5. Atelier

**Strongest 3 points**

1. **DOM-first plan with Paper mode as the product (R12 S1, R9.6, R7.7).** The "glass DOM" and Paper mode render
   before any GPU code exists, widgets are written and verified against it (R12 closing paragraph), and the canvas
   is "revealed under a now-transparent DOM" without touching focus or scroll position.
2. **Native scrolling and native text semantics are kept (R9.5).** `#glass` is the scroll container, inner regions
   are nested `overflow:auto`, links are real `<a href>`, `<select>` is native.
3. **Memory arithmetic is correct (R2.3 lines 526-528).** 29.5 + 14.7 x 4 + 3.7 + 9.8 + 22 comes to about 124 MB at
   1440p with no MSAA and analytic edge AA, so the 384 MB desktop ceiling is credible.

**Five most serious defects**

1. **`ui.present` delivery is wrong and no plan step touches the server (R6.6 line 1390; R12).** It "arrives as a
   change event with `kind: "present"` ... server-enforced, AC-RT-5". Nothing writes it (tools.ts:936), I found no
   `AC-RT-5`, and S0 to S15 contain no gateway work. Failure scenario: the lightbox beat of R11 is unbuildable as
   planned.
2. **The "same TSL code on both backends" claim does not hold for the central material (R2.4 line 544; R2.2 table
   lines 477-484).** The uber-material reads a `storage()` buffer indexed by `instanceIndex`; the WebGL2
   replacement is a data texture. Shadow binning is compute on WebGPU and a CPU-sorted 24-caster loop on WebGL2.
   The id target is `R32Uint` on one and packed `RGBA8` on the other. Failure scenario: two shader variants per
   material, so cards past the 24th caster are shadowed differently on the fallback, which R13 row 5 admits is
   possible (0.1 % pixel threshold on 5 % of shots).
3. **GPU cost is aimed at the wrong place and unmeasured on the target hardware (R2.3, R2.5, R7.2).** Frosted
   glass is a 5-level down / 5-level up blur pyramid plus transmission, with GTAO, photon caustics, Rapier physics,
   SMAA and a post-tonemap ink pass. "GPU 9 ms scrolling Home on Xe" and "GPU 12 ms agent rebuild at Q2" are
   targets without a derivation. Failure scenario: on Iris Xe at 1080p DPR 1.25 the pyramid, bloom and SMAA alone
   consume most of a 16.6 ms frame, the governor drops to Q1 ("static frosted snapshot") on the reference
   machine, and the proposal's signature material (glass) is exactly what is lost.
4. **Transparent-DOM alignment relies on a per-family `scaleX` correction (R3.6 lines 931-934).** GPU lines use
   atlas advances and manifest kerning, the browser shapes with its own kerning and rounding, so error grows along
   a line and with fractional DPR and is not a uniform scale. Failure scenario: memo and description lines of 60
   or more characters drift by more than 1 CSS px at the line end, so selection highlights and find matches miss
   the glyphs. The threshold (0.5 % of lines, R13 row 1) is the only guard and the fallback degrades flat focus to
   visible DOM text.
5. **Scope is the largest of the five for a data UI (R2.6 to R2.9, S10, S11).** Procedural medal generator with
   guilloché and enamel, product families, a page-turning ledger book, envelopes, a hand silhouette, stamps with
   ink spread, a Rapier-driven clear-desk sweep, plus the 77 widgets. The risk table lists "procedural objets
   look cheap" as risk 9 with an authored-glTF fallback that is itself an art pipeline. S11 gates S12 (the demo).

**Scores**

| Dimension | Score | Note |
|---|---|---|
| Stack soundness | 5 | PBR/transmission/compute reasonable on WebGPU, two code paths on WebGL2 |
| A11y-mirror soundness | 8 | Native scroll, native controls, parity test, Paper mode |
| Widget authoring cost | 6 | Widgets authored against a small `VNode` set and verified in Paper mode first; no per-widget GPU code |
| Backend integration | 3 | Wrong present claim, no server step |
| Perf credibility | 5 | Correct memory model, ambitious GPU passes on iGPU |
| Plan quality | 8 | Paper mode first; harness fixtures first; strong exit conditions |

## 6. Constellation

**Strongest 3 points**

1. **Backend honesty about the present gap.** R6.6 line 1523 states `ui.present` "writes no change", defines the
   rt forward, and makes `delivered_to` real (Appendix A.2). Plus actor classification derived from transport, not
   timing (R6.2).
2. **Widgets can be ported and accepted in Plain mode before any GPU code (R12 step 5 depends on 2, not 3).** Two
   explicit gates, K1 (text) and K2 (the field's legibility), with named fallbacks, and an escape hatch `k: "dom"`
   whose use is counted and capped (R13 K5).
3. **Careful local-reheat and bounded-simulation thinking (R6.1 lines 1445-1448; S1).** Stability under change is
   designed rather than hoped for.

**Five most serious defects**

1. **It rewrites the backend contract, which the brief says to build on (Appendix A; R9.4 lines 2631-2645; R12
   S0).**
   - It adds `graph.snapshot`, a new action over 13,600 nodes and 41,000 edges built per principal "under grants
     and column masks", cached per `(principal, change_head, domain_head)`. It also amends the widget catalogue
     (`BUS_TOPICS`, new subscriptions on `points.accounts`, `points.ledger`, `audit.timeline`, `approvals.inbox`) and
     the Preference node, and extends `audit.verify`.
   - Failure scenarios: (a) a second authorisation path that must agree with every domain action, where a leak of
     degree or existence of masked entities is possible; (b) a bulk read action with agent permission `direct`,
     which is an exfiltration route not in the 122-action registry; (c) many of the edge kinds (txn-order,
     run-step-target, widget-entity) are derived relations the Node model may not store.
2. **The compute design is probably not expressible as written (R2.1 line 837; S1 lines 1606-1665).** The
   WGSL uses hand-assigned `@group/@binding`, workgroup-shared histograms, `workgroupBarrier`, and `array<...>`
   storage layouts, to be run "through three's compute pipeline (`wgslFn` wrapped in `Fn().compute(n)`)". `wgslFn`
   wraps a function, not an entry point with builtins and workgroup memory, and three assigns bindings itself. I
   could not verify otherwise. Failure scenario: C2 (radix sort) and C6 (forces) need a raw WebGPU pipeline beside
   three, giving two device owners, and the WebGL2 path (d3-force-3d in a worker, capped at 16,384 nodes, line 899)
   is then the only portable layout, making the GPU simulation optional rather than central.
3. **Layout determinism does not survive real GPUs (R9.7 line 2684; S1 C4).** "Byte-identical positions after 200
   ticks" is asserted from a SwiftShader test. FMA contraction, reduction order and driver differences change
   float results across devices, and positions are cached per viewer in IndexedDB (R7.5 M3).
   - Failure scenario: the presenter laptop, the wall display and the audience phone each show a different
     constellation, so "the comet flies to the entity" and shared spatial references from the demo
     have different geometry per screen.
4. **The thesis is gated after the largest commitments, and the phone number already fails (R12 order; R7.2 line
   2296).**
   - Order: S0 (backend amendments) and steps 1 to 5 happen before K2, the gate on whether the field is findable
     at all (6 of 8 participants find an order within 6 interactions).
   - Phone "Field, sim settling" is 22 ms GPU p95 against a 30 fps cap and the Pixel 6a floor is untested in CI.
   - Failure scenario: K2 fails after the server contract, 77 widget ports and the compute kernels exist.
5. **3D-transformed live DOM at scale, and focus that moves the scene (R4.2; R9.5 row 3; R7.3).** Panels in Orbit
   are `contain: strict` DOM roots with per-frame `matrix3d`, hit-tested natively; a focused control forces its
   panel to the "front slot" with a 220 ms move.
   - Failure scenarios: many perspective-transformed DOM layers raise compositor cost and re-raster text; Tab
     across five panels rearranges the scene on every stop, for keyboard users the constant motion defeats the
     "spatial" idea and complicates the "focus never obscured" rule.
   - The 64 MiB angled-panel texture pool re-rasterises panel text per frame while moving.

**Scores**

| Dimension | Score | Note |
|---|---|---|
| Stack soundness | 4 | Compute kernels likely need a second device owner; split compute/CPU worker paths |
| A11y-mirror soundness | 6 | Strong model; 3D-transformed DOM and focus-driven moves are risky |
| Widget authoring cost | 5 | Same kit cost as the others, but also needs entity unfold sets and catalogue amendments |
| Backend integration | 4 | Present correct; `graph.snapshot` is a large, risky new surface |
| Perf credibility | 4 | Field on iGPU and phone is the heaviest GPU workload of the five |
| Plan quality | 6 | Good gate structure, thesis gate placed too late |

## 7. Cross-proposal section

### 7.1 Shared assumptions that are risky for all five

1. **The GPU can reproduce browser text closely enough to be the only visible text.** All five draw text on the GPU
   and keep transparent DOM text on top for selection and AT. Every one lists "make the DOM text visible" as the
   K1-style fallback, which means the credible floor is the DOM app. The honest framing is that GPU text is a
   cost with no user benefit except visual continuity inside the 3D scene. No proposal gives a user-visible
   reason that outweighs the measured risk, and none spiked it on Windows ClearType at DPR 1, 1.25 and 1.5 with
   mixed-script and long lines.
2. **three r180 `WebGPURenderer` and TSL are portable and stable.** The WebGL2 fallback is described as "the same
   code". Each proposal's central shader uses features whose WebGL2 behaviour I could not confirm: MRT with
   per-attachment blend and multisample resolve, `uint` instanced attributes, `storage()` buffers,
   `RGBA32F` `textureLoad`, `R32Uint` MRT picking, compute. Also, the pin is exact but old relative to the date of
   this round (the spec dates itself November 2026). The proposals pin an API (`PostProcessing`, TSL names) that
   three has been renaming.
3. **A DOM mirror with `matrix3d` tracks the picture closely enough under motion.** The overlay-sync tests are
   specified for camera moves, not for compositor-driven momentum scroll, fractional DPR, or font swaps. Drift
   thresholds (0.5 CSS px at rest, 1.5 in motion) are asserted before any measurement.
4. **Every widget is rewritten onto a new kit.** Orbit, Instrument, Atelier and Constellation rewrite 77 widgets
   against a primitive set that does not exist yet; only Township ports mechanically. None gives a per-primitive
   cost model. The kit, not the renderer, is the long pole of the work, and it is on the critical path of every
   domain.
5. **Performance numbers.** Every budget (Iris Xe, Pixel 7, iPhone 13) is a target. None derives a number from a
   measured spike, and two contain memory arithmetic that is only right if MSAA is off (Orbit is wrong; Township
   and Atelier are right).
6. **Testing realism.** Headless WebGPU on SwiftShader proves boot and structure, not driver behaviour. Visual
   goldens on SwiftShader are a different image from an RTX 3060 or an Apple GPU, and Safari and Firefox are not
   automatable with the stated flags. All five make screen-reader scripts (NVDA, VoiceOver) a gate, and these are
   manual. None says who runs them or how often. Pixel-diff goldens are specified for 6 looks x 2 themes x 2
   viewports x 2 backends per route, which is a large golden set to curate.
7. **`ui.present` and the agent-rebuild moment depend on realtime behaviour that the repository does not have.**
   Verified: the MCP tool writes no change and the gateway forwards nothing. Three of the five (Township,
   Instrument, Atelier) plan the demo beat on an event that will never arrive; two (Orbit, Constellation) plan the
   gateway change correctly. Dry runs are invisible by design and the rebuild depends on every `site.*` commit
   arriving with `surface: "mcp"` and `actor: agent:*`, which none verified against the seed.
8. **Pointer arbitration between mirror and canvas is declared and not exercised.** Orbit and Constellation give the
   mirror pointer events in reading poses; Instrument and Atelier route pointer to the canvas or to both with CPU
   hit tests. The transitions between these states during camera moves are where focus-stealing and mis-clicks
   occur, and are not covered by any proposed test.

### 7.2 What must be proven by a spike before committing (in this order)

1. **Text and mirror spike (one page).** Build one screen: the 912-row ledger (virtualised), `points.transfer`, and
   the permission matrix. Draw text with the proposed path on WebGPU and WebGL2. Overlay a transparent mirror.
   Measure on Windows Chrome at DPR 1, 1.25 and 1.5, Safari 26 and Firefox:
   - Glyph-box alignment against browser line rects (include a 60-character memo and a mixed CJK/Latin row).
   - Selection, find and copy against the transparent mirror.
   - Native `<select>`, `type=date`, IME (Japanese, Korean) and autofill.
   - Momentum scroll on iOS and Android while the canvas follows: tap accuracy during a fling.
   - SSIM of GPU text against DOM text.
   Pass criteria are numbers set before the run. If it fails, the mirror text is visible, which is the cheapest
   fallback in all five.
2. **Backend portability spike.** One uber-shader with MRT, per-attachment blend, a `uint` instanced attribute, a
   `RGBA32F` data texture, MSAA resolve, and an id-picking target, on three `forceWebGL` and the WebGPU backend,
   on Safari, Firefox and Chrome on Windows and Android. Add one compute pass if any proposal keeps compute
   (Instrument, Constellation, Atelier). Record what three does and does not support. This decides whether
   "one TSL source" holds.
3. **Present path.** Implement `pg_notify` forwarding in `packages/rt` and prove a browser receives it with the
   right principal filtering. This is a small change but three demo scripts depend on it.
4. **Memory and bandwidth.** Allocate the proposed render targets (with and without MSAA) on Iris Xe at 1080p DPR
   1.25 and on an iPhone 13 and measure GPU time of one resolve and one blur pyramid. This settles Orbit's
   and Atelier's integrated-tier claims.
5. **Authoring cost.** Port three widgets of different shapes (`points.ledger`, `promotions.builder`,
   `reporting.board`) onto the chosen kit and report line count and primitive count against today's DOM versions.
6. **Headless CI reality.** Run the proposed Chromium flags on the CI image, confirm WebGPU boots, and render the
   same scene on SwiftShader and on a real GPU. Compare the pixel difference so the golden policy (threshold and
   per-GPU baselines) is set from data.

## 8. Ranking

Ranking is by engineering feasibility only, not by visual ambition.

1. **Orbit.** Best mirror contract, correct backend scope, a real riskiest-first gate (G1) and named kill criteria.
   Its defects are fixable by decisions (turn MSAA off, drop the hinted-text swap, pin to the workspace versions)
   and by one WebGL2 blend check, not by redesign.
2. **Atelier.** The best plan shape: Paper mode and native scroll first, widgets verified without a GPU, correct
   memory arithmetic. It loses on backend (no server step, wrong present claim), on scope (procedural objets,
   caustics, physics) and on two code paths on WebGL2.
3. **Township.** The lowest realistic engineering risk because the DOM is the product, and the cheapest widget
   port. It ranks third because the GPU adds little inside interiors, the painting-from-DOM read batch is
   fragile, the text-parity tolerance is too loose, the present claim is wrong, and the city art pipeline is an
   unplanned dependency.
4. **Instrument.** Strong gates, but it gives scroll, pointer and activation to the canvas, double-implements a
   table engine that the seed does not need, has the largest kit, and states that no backend change is needed
   when one is.
5. **Constellation.** The most original and the highest risk: a new privileged server read surface, compute
   kernels that probably need a second device owner, per-device layouts, the heaviest GPU workload on integrated
   hardware and phones, and a thesis gate placed after the commitments. Its backend present handling is the
   correct one, and its Panel mode plus Plain fallback keep it from being unsafe.

If the owner wants one design to continue with, the practical choice is Orbit or Atelier, after the section 7.2
spikes 1, 2 and 4. A combination that reads well technically is Atelier's DOM-first delivery order (Paper mode, then
GPU) with Orbit's mirror contract and its backend change for `ui.present`.
