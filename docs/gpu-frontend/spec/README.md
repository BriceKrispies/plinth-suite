# Township: the canonical GPU frontend spec

Task: WG-5534. This directory is the implementation spec for the GPU frontend of Plinth Suite. The owner chose
**Township** (a living miniature city; `../proposals/township.md`) as the base, WebGPU first with a WebGL2 fallback, with
grafts from Orbit, Instrument, Atelier and Constellation as recommended in `../evaluation-matrix.md`. It resolves every
defect the three judges raised against Township (`../reviews/`) and turns the access judge's 14 must-adds into numbered
requirements.

**Mobile first (WG-5536).** The owner asked for the design to be "mobile-first ... designed mobile first and then
'expansive' for desktop", not phone support patched on. The spec was restructured accordingly: `00-mobile-first.md`
binds every other file, every screen is designed for a portrait phone in one hand first, and tablet and desktop are
written as expansions at named breakpoints. The ruling log section "Mobile-first restructure" below records each core
concept that changed, why, and what was torn out.

Where this spec and any proposal differ, this spec wins. Where this spec and `docs/suite/CONTRACT.md` differ on
backend behaviour, the contract wins and this spec is corrected.

## Index

| File | Contents |
|---|---|
| [`00-mobile-first.md`](00-mobile-first.md) | the mobile-first principles, the primary target device, shell and pane breakpoints and the expansion model, the thumb-zone map with the bottom bar at every altitude, the room dock, the status layer and the keyboard mode, the viewport model, overscroll, manifest, service worker and system text size, the gesture vocabulary with its alternatives, the rendering tiers with hybrid text on phones and the Base (mid-range phone) targets, the expansion rules per screen, phone-first testing, HTTPS on the LAN |
| [`01-concept-and-city.md`](01-concept-and-city.md) | concept and principles, altitudes, the town on a phone as a landing of the whole town opening per-borough high streets with baked band images, side by side at medium, the plinth vista at expanded with rotated blocks, the 19 districts, page-to-building placement with overflow, the procedural kit with a Base level of detail, homes and streets, wayfinding, privacy, art-direction rules, the art-direction gate judged on the phone; the retired phone section |
| [`02-interiors-and-widgets.md`](02-interiors-and-widgets.md) | the lobby in each page's authored phone order and its cards, panes, rooms (pane focus) with their dock, sheets, dioramas with portrait framings (15 widgets), dense lists and tables (list presentation, Select mode, fast-scroll rail, whole-dataset search), the matrix by role, by permission and by person, portrait-first charts and morphs, floors, all 77 widgets with their compact presentation and expansion, shell parity |
| [`03-rendering.md`](03-rendering.md) | the pinned stack, the APIs to verify in three 0.187, the capability ladder with Plain on any init failure and the `OffscreenCanvas` fallback, WebGL2 parity, the legibility contract, the text pipeline with phone text integrity (clip chain, one copy of every text, the runtime fallbacks, fractional-DPR snapping, reflow epochs), painting from the Plat, the frame graph per tier, materials, signature effects (compact and vista Enter), picking, budgets phone first, tiers, power and thermal, memory, boot and warm-up, device loss, looks |
| [`04-plat-accessibility-input.md`](04-plat-accessibility-input.md) | the Plat and its data structures, Plain mode, focus (rooms, sheets, the city scroller), keyboard as an expansion, announcements with mobile screen readers, forms and on-screen keyboards, the Motion control, forced colours and contrast preferences, contrast checks, zoom and reflow, target size and gestures, the city for AT, VoiceOver and TalkBack flows, the 14 must-adds, a11y tests, the task-time study on phones and desktops |
| [`05-realtime-agent-demo.md`](05-realtime-agent-demo.md) | the realtime dispatcher, the event-to-world map, person versus agent versus system, `ui.present` with the status-layer plate, the agent lamp, the agent strip, one Follow rule, the build board and the vista's chevron, stamps and the agent log, clear and rebuild on the high street, the Choreographer, the History sheet scrubber, automation circuits, the five-minute demo presented from a phone and then on a big screen |
| [`06-architecture-testing.md`](06-architecture-testing.md) | packages, the widget authoring contract (card kind, list mapping, expansion), the scene graph, layout by container queries, state, routing and history for rooms and sheets, the Classic/Town swap contract, backend surface with the `PageItem.compact` schema change, phone-first testing with the golden policy, CI, HTTPS on the LAN for development |
| [`07-plan-and-gates.md`](07-plan-and-gates.md) | gates, the G0 spike with its phone half (C10 to C14), the dependency-ordered plan (HTTPS, the compact page schema and spike additions first, compact before expansion, the expansion pass P17), gate details, kill criteria K1 to K14, the fallback ladder, the comparison with "Classic plus a GPU layer" |

**Requirement IDs** have the form `TWN-R-<file>.<section>.<n>` (for example `TWN-R-4.7.2` is file 04, section 4.7,
item 2). IDs are stable: a requirement that is withdrawn keeps its ID, marked retired with its reason, and new requirements take the
next free number in their section. Every requirement names its test. File 00 uses `TWN-R-0.<section>.<n>`. In file 02
the sections were reordered for the mobile-first design while the IDs were kept, so some IDs carry the old section
number (the note at the end of `02` maps them).

## Canonical facts

These override the proposals.

1. **Stack, pinned exactly:** `three@0.187.0`, `@types/three@0.187.0`, `@mapbox/tiny-sdf@2.3.0`,
   `@fontsource-variable/inter@5.3.0`, `@fontsource/jetbrains-mono@5.3.0`, `vite@7.3.8`, `@webgpu/types@0.1.74`. The
   proposals said three 0.180; every three API this spec relies on is listed in `03` section 3.2 to be verified in the
   0.187 source.
2. **The design device is the mid-range phone** (`00` section 0.2): portrait, 360 to 430 CSS px, DPR 2 to 3, touch,
   an Adreno 6xx class or A15 class GPU. The Base rendering tier is designed for it and must meet its budgets there.
   **Reference measurement machine:** the Windows 10 desktop with an NVIDIA GTX 1080 Ti. WebGPU works in headless
   Chromium with `--enable-unsafe-webgpu --use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`. It runs the phone
   emulation profile (layout, touch, main-thread cost with 4× CPU slowdown, text at phone DPRs, loading) and the
   expanded design at Full. Phone GPU, thermal, battery and memory budgets cannot be measured there; they are measured
   on two real phones at G0 (C11 to C13) and G-PERF, and labelled unmeasured until then.
3. **Classic is kept.** The current DOM app (`packages/web`) is not deleted. It is the reference that Plain mode is
   checked against, the fallback for browsers with neither WebGPU nor WebGL2, and the baseline of the task-time
   study.
4. **The Classic/Town swap contract** (`06` section 6.7):
   - one origin; the town app is served under `/town/` and its routes mirror Classic's 1:1 (`/store` ↔ `/town/store`);
   - `?as=` is preserved;
   - the site default is `appearance.experience: "classic" | "town"` on the Program node, set by `site.appearance.set`
     (MCP-settable); every browser following the site default swaps live on the rt Program change;
   - a per-viewer override in `localStorage["plinth.experience"]` = `classic | town | site`;
   - a toggle in each top bar;
   - the town app without WebGPU or WebGL2 redirects to Classic with a notice.
5. **`ui.present`** (CONTRACT 6.3): the gateway forwards `{ t, node, target, focus, by, at }` only to the presenter
   session's own principals (the agent and its delegator) that match `target` and can read the node. Frames are not
   stored or replayed. The tool returns `delivered_to: null, queued: true`. There is no change-stream item of kind
   `present`.
6. **`site.*` actions** (CONTRACT 5A.5 and M18): `site.clear` (dry run then commit), `site.restore { pages? }`,
   `site.page.put`, `site.widget.add`, `site.widget.remove`, `site.appearance.get` and `.set`, all under
   `admin:settings`; each is an ordinary change-log commit.
7. **The G0 spike** (`packages/town-spike`, `docs/gpu-frontend/spike/SPIKE.md` on branch `suite/town-spike`, WG-5533)
   is the first gate. C1 to C9 were fixed before measurement; C10 to C14 (phone emulation and real phones over HTTPS)
   are added by WG-5536 and fixed in `07` section 7.2.2 before any phone measurement. Known so far: on the reference
   machine, text alignment within 1 px, 100 % line-break parity and frame p95 of 1 to 6 ms; in an exploratory phone
   emulation run, "double vision" text (see "Mobile-first restructure", item M-11).
8. **HTTPS on the LAN.** Phones reaching the dev machine over plain HTTP are not in a secure context and get WebGL2 at
   best. `pnpm --filter @plinth/web dev:https` (on the integration line) serves the shared origin at
   `https://<host>:5443` with `@vitejs/plugin-basic-ssl@2.3.0`, proxying `/town`, `/api` and `/rt`; mkcert replaces the
   click-through certificate only if G0 C11 shows WebGPU hidden behind it (`06` section 6.11).
9. **Phones run hybrid text.** On coarse pointers and at the Base tier all text is the browser's own; the GPU paints
   surfaces, charts, dioramas, the town and transitions (`03` section 3.5.7).

**Names that changed from the Township proposal:** Plan mode is **Plain mode** (as in the spike's `?plain=1`); the
surveyor drone is the **surveyor lamp** (it carries Orbit's light); the Information Kiosk is the **Signal Mast**; the
Lamplighter's Studio is the **Lamp Studio**; every plaque leads with the plain domain name. Dropped from the Township
stack: `three-mesh-bvh`, glTF and KTX2 tooling, `msdf-atlas-gen` (deferred), `pixelmatch` (added only with a pin if
the golden runner needs it). Dropped from the Township plan: D15 (retiring `packages/web`).

## Ruling log

Every defect the judges raised against Township, the cross-cutting findings that apply to it, the graft-related
defects raised against the donor proposals, and the matrix's unproven items, with the ruling and the requirements
that carry it. "Upheld" means the defect is real and fixed; "overruled" means the spec keeps the original design, with
the reason.

### Feasibility judge (`judge-feasibility.md`)

| # | Defect | Ruling | Requirements |
|---|---|---|---|
| JF-1 | `ui.present` rests on a change-stream item of kind `present` that does not exist; the relay was called optional | Upheld. The gateway `present` frame (CONTRACT 6.3, now implemented) is the only path; no code reads a `present` change kind | TWN-R-5.4.1 to TWN-R-5.4.6; plan step BE1 |
| JF-2 | Painting from live DOM geometry: `getBoundingClientRect` over ~1,400 elements per dirty pane stalls flings | Upheld. Rects are stored relative to their scroller, scrolling never re-reads, epochs bump only on mutation, resize, font load or window growth; reads are batched with no writes; a 2.2 ms budget with frame splitting; K11 as the kill | TWN-R-3.6.1 to TWN-R-3.6.3; K11 |
| JF-3 | Text-parity kill criterion (≥ 99.5 %, 1 px on 0.1 % of elements) would ship visibly wrong pages | Upheld. Zero GPU-painted mismatches are allowed: a runtime guard hands any mismatching element to visible DOM text; CI fails on any painted mismatch; the DOM-fallback share above 0.5 % fires K1. The 99.5 % figure survives only as the spike's go/no-go threshold | TWN-R-3.5.2 to TWN-R-3.5.4; G2; K1 |
| JF-4 | The city's asset pipeline is one plan row with no tooling; art is an unplanned dependency | Upheld. The building kit and landmarks are procedural code with deterministic output; a dedicated plan step (P11) and the art-direction gate precede district work | TWN-R-1.7.1, TWN-R-1.7.2, TWN-R-1.12.1, TWN-R-1.12.2; P11, G-ART |
| JF-5 | Enter hand-off can drop focus and IME composition when a transition starts mid-edit | Upheld. Transitions start only from the viewer's own navigation; realtime, present and look changes never start one while an editable has focus or a composition is active | TWN-R-3.9.2, TWN-R-4.3.4, TWN-R-5.4.4 |
| JF-6 | Render-target arrays are a Safari risk with a 12-card WebGL2 cap | Upheld. An individual-target path with the same hand-off, selected by capability or by visual-suite failure | TWN-R-3.9.3 |
| JF-7 | GPU text is a cost with no user benefit; ClearType at DPR 1, 1.25, 1.5 never spiked | Partly upheld. GPU text is kept for one continuous world and exact transitions, but only where it matches the browser: small text is the browser's own rasterisation (raster runs), G2 sweeps DPR 1, 1.25 and 2 with SSIM and a blind reviewer test, and K1 drops to visible DOM text | TWN-R-3.5.1, TWN-R-3.5.3; G2; K1 |
| JF-8 | three's WebGL2 support for per-attachment blending, integer attributes, storage buffers and RGBA32F `textureLoad` is unconfirmed | Upheld. Design rules remove all but one: no compute, no per-attachment blend, no integer attributes, no readback; RGBA32F vertex `textureLoad` is proven in G0 C5 with an RGBA16F fallback | TWN-R-3.3.2, TWN-R-3.3.3; G0 C5; K3 |
| JF-9 | The three pin is old and names (`PostProcessing`, TSL) are being renamed | Upheld. Pinned to 0.187.0; every API listed for verification in 0.187 source; one import site | TWN-R-3.1.1, TWN-R-3.1.2, TWN-R-3.2.1; K13 |
| JF-10 | Mirror tracking under momentum scroll, fractional DPR and font swaps is untested | Upheld. Scroll hand-off to DOM text while scrolling; pixel snapping tested at DPR 1, 1.25, 1.5, 2; font loads bump the epoch | TWN-R-3.5.5, TWN-R-3.4.3, TWN-R-3.6.1 |
| JF-11 | Every performance number, including Township's Iris Xe city budget, is unmeasured | Upheld. Reference-machine budgets are measured at G0 and on every stack; other classes are labelled unmeasured and measured on owner-named devices at G-PERF before the site default can change | TWN-R-3.11.1 to TWN-R-3.11.3; G-PERF |
| JF-12 | Visual goldens on SwiftShader differ from real GPUs; the golden set is too large; screen-reader scripts are manual with no owner or cadence | Upheld. Golden thresholds come from measured noise per adapter class; SwiftShader gets no pixel goldens if noisy; the golden set is bounded; screen-reader scripts are run by the owner's designated tester at named gates | TWN-R-6.9.1, TWN-R-6.9.2, TWN-R-4.15.3 |
| JF-13 | The rebuild depends on `site.*` commits carrying `surface: "mcp"` and an agent actor, never verified | Upheld. An integration test asserts it for `rebuild-live.ts` | TWN-R-5.3.1 |
| JF-14 | Pointer arbitration during camera moves is not exercised | Upheld. City links ignore pointers mid-motion and are rebuilt on the settle frame | TWN-R-3.10.1 |
| JF-15 | (Instrument, relevant to its graft) GPU table filtering is wrong-sized, double-implemented and needs raw compute interop | Upheld. The graft is taken as behaviour, not mechanism: CPU columnar filtering over the whole dataset, GPU-drawn stripes and density strip, no compute | TWN-R-2.5.2, TWN-R-2.5.3, TWN-R-3.3.3 |
| JF-16 | (Orbit, relevant as donor) MSAA on HDR MRT targets breaks the memory budget | Upheld. No MSAA anywhere; memory budget counted without it | TWN-R-3.13.2; `03` section 3.7 |
| JF-17 | (Orbit, donor) Hinted text swapped for MSDF during motion changes text on every arrival | Not adopted. Interiors never move at rest; transitions use pane cards painted by the same painter | `03` section 3.9.1 |
| JF-18 | (Instrument, donor) canvas-owned scroll, pointer and `click()` re-dispatch break native behaviour | Not adopted. The Plat's native scrollers, pointer events and controls are kept | TWN-R-4.6.5, TWN-R-3.6.1 |
| JF-19 | (Atelier, Constellation, donors) compute kernels and physics need a second device owner | Not adopted. No compute and no physics anywhere | TWN-R-3.3.3 |

### Experience judge (`judge-experience.md`)

| # | Defect | Ruling | Requirements |
|---|---|---|---|
| JE-1 | Inside a building 3D is gone; the screen people live in is a flat site | Partly upheld. The reading surface stays flat, token-exact and pixel-snapped (that is the enterprise credibility). The interior keeps the world present: 15 dioramas on a visible View control, summary widgets opening on their diorama, Instrument's terrain, flow ribbons and exploded matrix, Atelier's vellum fan, chart morphs, the agent lamp's rim glow, construction arrivals and the live backdrop | TWN-R-2.4.1 to TWN-R-2.4.5, TWN-R-2.7.2, TWN-R-5.7.1 |
| JE-2 | It can read as a toy to a buyer | Upheld. Art-direction rules with checks, the G-ART gate, K7 with `meridian` as the fallback default, and the task-time study (K9) | TWN-R-1.11.1 to TWN-R-1.11.4, TWN-R-1.12.1; K7, K9 |
| JE-3 | Forced metaphors send people to the wrong building (notification preferences live in Settings) | Upheld. Plain names lead every plaque and entry; each district lists "Also elsewhere" widgets; the palette indexes widget titles | TWN-R-1.9.2 to TWN-R-1.9.4 |
| JE-4 | Quality depends on authored art and there is no art-direction gate | Upheld. Procedural kit and G-ART before district work | TWN-R-1.7.1, TWN-R-1.12.1, TWN-R-1.12.2 |
| JE-5 | No rule for a ninth page in a district or a full New Town | Upheld. Annex strips, New Town rings, then terrace blocks with unlimited floors; placement by creation `seq` so nothing moves | TWN-R-1.6.2 to TWN-R-1.6.4 |
| JE-6 | (Graft 1) Orbit's legibility contract should be a testable contract | Upheld | TWN-R-3.4.1 to TWN-R-3.4.3 |
| JE-7 | (Graft 1) Orbit's threads and trace ring as a "ticker road" | Not adopted. Stamps with the Agent log, toasts with leader lines and the Record Office frieze carry the same information without another system | `05` sections 5.6, 5.11 |
| JE-8 | (Graft 4) Constellation's field navigator as the city Plat model | Upheld | TWN-R-4.12.1 |
| JE-9 | (Graft 5) Presenter follow pose and off-screen indicator | Upheld, with follow opt-in (access must-add 12) | TWN-R-5.5.1 to TWN-R-5.5.3 |
| JE-10 | (Graft 6) "Light means signal" for the night look | Upheld, for every look | TWN-R-1.11.4 |
| JE-11 | (Graft 7) Art gate with one landmark and one Enter transition per look; explicit overflow rule | Upheld | TWN-R-1.12.1, TWN-R-1.12.2, TWN-R-1.6.4 |

### Access judge (`judge-access.md`)

| # | Finding | Ruling | Requirements |
|---|---|---|---|
| JA-1 | 2.2.2: the city moves autonomously with no pause control | Upheld. A visible Motion control (Full, Reduced, Off), Reduced by default, no autonomous motion in Reduced or Off | TWN-R-4.7.1 to TWN-R-4.7.3 |
| JA-2 | The Enter dolly zoom runs by default; the camera flies on every focus change | Upheld. The dolly zoom exists only under Full; focus never moves the camera (a cut brings an off-screen building into view) | TWN-R-4.7.4, TWN-R-4.3.3 |
| JA-3 | 2.5.8: projected city links can be ~10 px and move | Upheld. Padded to 24 × 24 at every settled pose, overlaps resolved by an equivalent list, rebuilt on settle | TWN-R-4.11.1, TWN-R-4.11.2, TWN-R-3.10.1 |
| JA-4 | The focus rail moves a frame ahead of painted text during a fling | Upheld. Text inside a scrolling container is DOM text until the scroll settles; the row cursor is a DOM outline | TWN-R-3.5.5, TWN-R-4.3.1 |
| JA-5 | Find in page over a virtualised 912-row table finds only the window | Upheld. Search all rows, count announcement, Copy all, Export CSV, a visible hint; the demo uses Search, not Ctrl+F | TWN-R-2.5.1, TWN-R-2.5.2 |
| JA-6 | No rendered-pixel contrast test for plaques over bloom and fog | Upheld | TWN-R-4.9.2, TWN-R-4.9.3 |
| JA-7 | No `prefers-contrast` handling | Upheld, with `prefers-reduced-transparency` | TWN-R-4.8.3, TWN-R-4.8.4 |
| JA-8 | No 320 px reflow test named | Upheld | TWN-R-4.10.1 |
| JA-9 | Magnifier behaviour over moving city links is unspecified | Upheld. Focus never triggers motion; the magnifier proxy test | TWN-R-4.3.3, TWN-R-4.10.3 |
| X1 | Forced colours with transparent mirror text draws text twice | Upheld (Township already avoided it). Forced colours means Plain mode with no canvas; a text-pixel-count test | TWN-R-4.8.1, TWN-R-4.8.2 |
| X2 | Single-key shortcuts collide with browse mode and typeahead | Upheld. Off by default; modifier chords for defaults; none inside typeahead composites | TWN-R-4.4.1, TWN-R-4.4.2, TWN-R-4.4.4 |
| X3 | Virtualised tables break find and select-all | Upheld, as JA-5 | TWN-R-2.5.1, TWN-R-2.5.2 |
| X4 | `F6` and `Alt+Shift` chords take over browser routes | Upheld. Neither is bound | TWN-R-4.4.3 |
| X5 | Camera-driven navigation is the default path | Upheld. Motion defaults to Reduced | TWN-R-4.7.2 |
| X6 | No magnifier analysis | Upheld, as JA-9 | TWN-R-4.10.3 |
| JA-O1 | (Orbit, donor) per-line absolute spans fragment reading | Not adopted; real paragraphs, the browser wraps | TWN-R-4.1.3 |
| JA-O2 | (Orbit, donor) focus waits for the camera | Not adopted | TWN-R-4.3.4 |
| JA-O3 | (Orbit, donor) idle-2-seconds heuristic treats a listening screen-reader user as idle | Not adopted; explicit Follow agent only | TWN-R-5.4.3 |
| JA-O4 | (Orbit, donor) ghost label contrast over hatch not named as a worst case | Upheld for every hatch under text | TWN-R-4.9.2 |
| JA-I1 | (Instrument, donor) parallax on scroll by default | Not adopted; no parallax anywhere in interiors | TWN-R-2.1.2 |
| JA-A1 | (Atelier, donor) Ctrl+wheel captured for Overview | Not adopted; Ctrl+wheel is never captured | TWN-R-4.11.4 |
| JA-A2 | (Atelier, donor) `contenteditable` blocks; glass contrast analytic only | Not adopted; textareas and opaque surfaces (vellum is translucent card without refraction, tested on rendered pixels) | TWN-R-4.9.2, TWN-R-4.8.4 |
| JA-C1 | (Constellation, donor) focus moves panels to a front slot | Rejected | TWN-R-4.3.3 |
| MA-1 to MA-14 | The 14 must-add requirements | All upheld; the mapping table is `04` section 4.14 | `04` section 4.14 |

### Evaluation matrix: items no proposal had proven

| # | Item | Ruling | Where |
|---|---|---|---|
| U-1 | GPU text over a transparent DOM: 1 px alignment, selection, IME, native scroll, zoom, spacing | Spiked at G0 (C1, C2, C6, C7), held at G2 | `07` sections 7.2, 7.4 |
| U-2 | WebGL2 parity of the central materials | Spiked at G0 (C5); design rules in `03` section 3.3 | TWN-R-3.3.2, TWN-R-3.3.3 |
| U-3 | Forced colours | Plain mode | TWN-R-4.8.1, TWN-R-4.8.2 |
| U-4 | `ui.present` does not reach browsers | Gateway change made (CONTRACT 6.3) | TWN-R-5.4.1 |

### Mobile-first restructure (WG-5536)

The owner: "Can we make it mobile-first design please, might have to tear out a lot of it, sorry, i dont just want
mobile stuff patched on i want it designed mobile first and then 'expansive' for desktop". The previous spec was
written for a 1440 × 900 desktop, with the phone handled in `01` section 1.13, `04` section 4.13, a "Phones" bullet in
`03` section 3.12 and plan step P17. Each core concept that changed:

| # | Concept | Before | After (mobile first) | Why | Torn out | Requirements |
|---|---|---|---|---|---|---|
| M-1 | Design target | desktop at 1440 × 900; phone as a variant at ≤ 30 rem | the portrait phone in one hand is the design; medium, expanded and wide are expansions at container breakpoints in rem; no desktop-only concept | the owner's instruction | the ≤ 30 rem "phone shell" switch and every width-based phone exception | TWN-R-0.1.1, 0.2.*, 0.3.*, 0.7.1 |
| M-2 | City layout | an octagonal plinth with boroughs around the Town Square; on a phone, the same plinth framed per borough at 62° tilt | the **high street**: the town as rigid blocks (Square, six boroughs, New Town) of stacked district bands, every facade facing the viewer, in one column on a phone; two columns at medium; the plinth vista at expanded | 19 districts in a 390 px square gave tens-of-pixel buildings, moving projected links and two-finger navigation; a vertical street of bands is what a thumb scrolls | the phone framing of the plinth (62°, fov 24°), select-then-enter with the peek sheet, the plinth as the only layout | TWN-R-1.4.1 to 1.4.7, 1.6.6 |
| M-3 | City camera and gestures | perspective with pan, pinch, twist and 8 headings at every width | an **axonometric rail camera** whose position is the native scroller's `scrollTop`; building links are DOM rows that move with the scroll; Overview and the borough index; orbit, pinch and twist only in the vista | native scrolling is the one reliable phone gesture; DOM links make taps exact during flings (JF-14, JA-3 at their root) | pinch, twist and pan on phones; projected links on phones; the mini-map (replaced by Overview) | TWN-R-1.3.2, 1.4.2, 1.4.3, 4.11.1 |
| M-4 | Navigation shell | the HUD across the top and the Directory column; on phones a tab bar (City, Inbox, Notifications, More) and an overflow menu | a **bottom bar** of five (City, Inbox, Command, Alerts, You) in the thumb zone; a read-only **top bar** with the Motion button; the **command sheet** with its field at the bottom holding the Directory; the district switcher; Hand (left or right); the rail at medium; the HUD and Directory column at expanded | primary actions where the thumb is; one place for "go anywhere" | the "More" Directory sheet; Motion inside an overflow menu | TWN-R-0.4.1 to 0.4.4, 1.9.1, 4.7.1 |
| M-5 | Interior | the page's 12-column grid; a single column of full panes below 48 rem | the **lobby**: panes as cards (whole, summary or entry); work happens in a **room** (one pane, full height, an action bar); details push inside the room; forms and secondary panes are **sheets**; two columns and master-detail at medium; the grid at expanded | one focused pane at a time with actions under the thumb | the single column of full-size panes on phones | TWN-R-2.1.3, 2.3.1 to 2.3.3, 2.4.6 to 2.4.8 |
| M-6 | Pane focus | an expanded-only maximise | the same altitude as the room; `?focus=` means the room on a phone and pane focus on a desktop; "Focus this pane" is renamed "Open pane" | one concept at every width | the separate pane-focus concept | TWN-R-2.2.2, 2.3.1 |
| M-7 | Dense data | tables everywhere; on phones a CSS re-styling of each table row as a card | the **list presentation** designed for phones: two-line items with an expansion holding every other field, Search all, **Select mode** for copy and bulk actions, a **fast-scroll rail** that is also the density strip, lazy full load on metered connections; the table is the expansion by pane width | dense data designed for a thumb rather than squeezed | table-to-card CSS on phones; drag selection as the only multi-row selection | TWN-R-2.5.1 to 2.5.7 |
| M-8 | Permission matrix | the grid; on phones a horizontally scrolled grid with a sticky first column | **By role** (default on phones, a role switcher), **By permission** and **By person**; the grid is added at expanded | a 9-column grid cannot be read at 390 px | the horizontally scrolled grid on phones | TWN-R-2.6.1 to 2.6.3 |
| M-9 | Charts and dioramas | landscape framings, hover readouts, drag to orbit and brush | portrait first: horizontal bars, no rotated labels, tap value plates with step buttons, Set range; the ledger flow ribbon runs down the screen; every diorama has a portrait framing and orbit buttons; per-tier diorama budgets | portrait aspect and no hover | hover as the only readout; drag as the only orbit or brush | TWN-R-2.4.1, 2.4.9, 2.7.4 |
| M-10 | Rendering tiers | full, balanced and low-power, plus a "Phones" bullet of phone defaults | **Plain, Low-power, Base, Enhanced, Full**; Base is the mid-range phone's tier and the design tier, with its own budgets (frame, input, memory, battery and thermal, first paint over slow 4G, download size, warm-up); higher tiers add only non-meaning effects; backend and tier are separate axes | the baseline must be the phone | the "Phones" bullet; phone bloom and shadow-map defaults; desktop-first budget columns | TWN-R-0.6.1 to 0.6.3, 3.11.*, 3.12.*, 3.13.*, 3.14.4 |
| M-11 | Text integrity on phones | parity measured at desktop DPRs only | after the coordinator's phone-emulation run found "double vision" text (no clipping by Plat ancestors, drift up to 52 px after reflow with 70.6 % of runs within 1 px, untransparented breadcrumbs, an error screen without `OffscreenCanvas`): painted text respects the clip chain and ellipsis; one copy of every text (painted with transparent DOM text, or visible DOM text, never both) with `doubleText()`; the per-element runtime fallback and a per-tab hybrid switch, with K1 app-wide; device-pixel snapping at DPR 2.625 and 3; every reflow re-reads; a detached-canvas fallback for `OffscreenCanvas`; any init failure ends in Plain mode | the phone is where text breaks first | — | TWN-R-3.3.4, 3.3.5, 3.4.3, 3.5.2 to 3.5.5, 3.5.7 to 3.5.10, 3.6.4; G0 C10; K1 |
| M-12 | Scroll hand-off | only text inside a scrolling container switched to the DOM | everything inside a scrolling container is DOM-drawn while it scrolls (surfaces have CSS twins in the same tokens), so phones scrolling at 120 Hz never show a lagging canvas | compositor scroll outruns the canvas on phones | painting surfaces from a scroll uniform during scroll | TWN-R-3.5.5 |
| M-13 | Agent presence and `ui.present` | HUD status, camera follow, an edge chevron, a plate under the HUD | the **agent strip** in the thumb zone with Follow; following is scrolling the street (a touch pauses it); the **edge pill**; the present request is a non-modal peek sheet answered with the thumb; the vista keeps the camera follow and chevron | the agent must read on a phone in one hand | — | TWN-R-5.4.7, 5.5.1 to 5.5.5 |
| M-14 | The demo | a projector desktop with Ana's phone mirrored in a corner | presented **from a phone** (the presenter's iPhone mirrored), every beat written for the thumb, then the same script on a big screen | the phone is the design and the device the audience holds | — | TWN-R-5.12.1, 5.12.2 |
| M-15 | Testing | 1440 × 900 default; a phone suite at the end | the phone profile (390 × 844, DPR 3, touch, 4× CPU) is the default project; WebKit 390 and Pixel 7 DPR 2.625 projects; real phones over HTTPS with a device reporter; desktop is the expansion pass; goldens phone first | test what is designed first | — | TWN-R-0.8.1, 6.9.1 to 6.9.3, 6.10.1 |
| M-16 | HTTPS on the LAN | not covered; phones over HTTP never get WebGPU | mkcert (primary) or `@vitejs/plugin-basic-ssl@2.3.0` on Classic's Vite server, which still proxies `/town`, `/api` and `/rt`, so the swap contract holds on one HTTPS origin | WebGPU needs a secure context | — | TWN-R-0.9.1, 6.11.1 to 6.11.3 |
| M-17 | Plan and gates | P17 "phone shell" near the end; G0 on the desktop only | H1 (HTTPS) and S1 (spike phone additions) before G0; G0 adds C10 to C14 (phone emulation and real phones); every step accepts compact before expansion; P17 is the expansion pass (the vista, grid interiors, hover, accelerators, Enhanced and Full); K14 (Base tier on phones) added; K1, K5, K12 rewritten for phones | dependency order follows the design order | the old P17 | TWN-R-7.2.1 to 7.2.3, 7.3.2 |
| M-18 | Renderer failure after the probe | (UI-MAP 8.5) write the override "classic" and redirect | stay on the route in Plain mode with a notice; the redirect stays only for no WebGPU and no WebGL2 | an error or a forced swap is worse than the Plain page the viewer already has; no loop is possible | — | TWN-R-3.3.4, 6.7.8 |
| M-19 | Task-time study | keyboard only and NVDA, on a desktop | four conditions: phone touch, phone screen reader, desktop keyboard, desktop NVDA | daily use on phones must not be slower either | — | TWN-R-4.16.1, 4.16.2 |

**Retired IDs.**

| ID | Reason | Replaced by |
|---|---|---|
| TWN-R-1.13.1 | the phone framing of the plinth with a peek sheet no longer exists | TWN-R-1.4.2 to 1.4.5, 1.6.6 |
| TWN-R-1.13.2 | "zero city frames while an interior is shown" applied only to phones | TWN-R-3.11.2, which now covers every width and tier |
| TWN-R-4.13.1 | the patched-on phone input requirement (CSS row cards keeping table semantics, the keyboard not covering fields) | TWN-R-0.2.1, 2.5.6, 2.9.4, 4.6.7, 4.13.2 to 4.13.4 |

**Kept IDs whose wording changed in substance** (same intent, now phone first): TWN-R-1.3.1, 1.3.2, 1.5.2, 1.6.1,
1.6.4, 1.7.2, 1.9.1, 1.11.4, 1.12.2; 2.1.1, 2.2.2, 2.3.1, 2.4.1, 2.4.3 to 2.4.5, 2.5.1 to 2.5.5, 2.9.1, 2.9.3, 2.10.1;
3.4.3, 3.5.1 to 3.5.5, 3.11.1 to 3.11.3, 3.12.1, 3.12.2, 3.13.1, 3.13.2, 3.14.1, 3.14.2; 4.2.2, 4.6.5, 4.7.1, 4.11.1 to
4.11.4, 4.12.1, 4.15.1 to 4.15.4, 4.16.1, 4.16.2; 5.4.3, 5.4.5, 5.5.1 to 5.5.3, 5.9.3, 5.12.1; 6.6.2, 6.7.8, 6.9.1,
6.9.2, 6.10.1; 7.2.1.

**New IDs.** TWN-R-0.1.1, 0.2.1, 0.2.2, 0.3.1 to 0.3.4, 0.4.1 to 0.4.4, 0.5.1 to 0.5.3, 0.6.1 to 0.6.3, 0.7.1, 0.8.1,
0.9.1; 1.4.1 to 1.4.7, 1.6.6, 1.7.3; 2.1.3, 2.3.2, 2.3.3, 2.4.6 to 2.4.9, 2.5.6, 2.5.7, 2.6.2, 2.6.3, 2.7.4, 2.8.1, 2.9.4;
3.3.4, 3.3.5, 3.5.7 to 3.5.10, 3.6.4, 3.11.4, 3.12.3, 3.14.4; 4.6.6, 4.6.7, 4.11.5, 4.13.2 to 4.13.4; 5.4.7, 5.5.4,
5.5.5, 5.12.2; 6.6.3, 6.9.3, 6.11.1 to 6.11.3; 7.2.2, 7.2.3, 7.3.2.

**Earlier rulings this restructure touches.** JF-14 and JA-3 (moving projected city links) are now solved at the root
on phones by DOM links in a native scroller, and still by padding and settle-frame rebuilds in the vista. JA-8 (320 px
reflow) is the base design rather than a test of a desktop layout. JF-11 (unmeasured budgets) now measures the phone
first, at G0. The README's earlier tables are otherwise unchanged.


### Mobile review (`../reviews/judge-mobile.md`)

An adversarial mobile reviewer scored the first mobile-first version 6 out of 10. Every finding is ruled below.
"Upheld" means fixed in the spec; "partly upheld" names what was ruled against and why.

| # | Finding | Ruling | Requirements |
|---|---|---|---|
| JM-1 | The page model is desktop-first: the phone lobby is the desktop grid in reading order; card kind is per widget, not per placement; the editor edits only the grid | Upheld. `PageItem.compact { order, card?, pin? }` on the Page node with a uniqueness and pin check; `site.page.put`, `site.widget.add` and `pages.resolve` carry it; existing pages fall back to the derived order; seeded pages get a hand-authored phone order tested against each persona's first task; the page editor's **Phone layout** tab edits it and is the default on a phone; hidden cards stay reachable under "More on this page"; `pages.editor` is an entry card | TWN-R-2.1.3 to 2.1.5, 2.9.5, 6.8.1 to 6.8.3; BE3 |
| JM-2 | The thumb-zone rule tested only the submit button; search, View, tab strips and role switchers sat at the top | Upheld. The rule covers every control a task uses more than once; a **room dock** above the bottom bar holds Back, Search (a sheet with its field at the bottom), Sort, Filter, View, Select, steppers and switchers, and the primary actions; the top holds only up, title, sibling ‹ ›, balance and Motion; banners with actions moved to the bottom status layer; toasts are passive; the demo's exemption list is exact | TWN-R-0.4.1, 0.4.2, 2.3.4; `05` rehearsal facts |
| JM-3 | The bottom bar disappeared in rooms, breaking the two-activation rule | Upheld. The bottom bar is present at every altitude; the dock sits above it; forms push inside rooms instead of modal sheets; TWN-R-1.9.1 is tested from rooms and pushed details. **Ruled:** while a modal sheet is open its scrim covers the bar, by design, because a modal sheet is a single pending choice (a confirmation, a picker); no form is a modal sheet | TWN-R-0.4.3, 1.9.1 |
| JM-4 | Overview could not fit (21 bands × 44 px against about 607 px); the town was never one object | Upheld with the reviewer's first alternative. The town altitude on a phone is a **landing**: the whole town as one portrait miniature, the Square and seven borough tiles (about 175 × 112 px each) with live signals, ripples as streaks between tiles; a tile opens that borough's **high street** of 1 to 6 bands (one district per band). Overview and the borough index are retired; the arithmetic is in `01` section 1.4.2; demo beat 1:05 plays on the landing | TWN-R-1.4.8, 1.4.10 to 1.4.12; retired 1.4.1, 1.4.4, 1.4.5 |
| JM-5 | The canvas lags the compositor on a fling; the tap-during-fling test describes behaviour platforms do not have | Upheld. Each band's static model is baked to an image inside the scroller, so the compositor scrolls it with its DOM links; live effects draw in a sticky overlay that fades out while scrolling; a building under construction is drawn live until done. The tap test now asserts a tap after settling lands on the link and a tap during a fling only stops it | TWN-R-1.4.2, 1.4.3, 1.4.7, 1.4.9; G0 C12 |
| JM-6 | Drag-to-orbit contradicted the `touch-action` rule; D9 and D11 stacked desktop side-by-side layouts | Upheld. No drag-orbit under a coarse pointer (buttons only; default `touch-action`, so a flick scrolls the room); a diorama that accompanies work is a 160 px collapsed band opening to at most 35 % of the viewport; D9 opens on the step list, D11 on the checklist with the decision and SoD verdict in the dock; "always visible" is now true because it is in the dock | TWN-R-0.5.2, 2.4.1, 2.4.9, 2.4.10 |
| JM-7 | Medium and landscape layouts did not fit; the keyboard left no room | Upheld. Breakpoints are placed by arithmetic: compact below 50 rem (two 340 px columns plus rail fit from 800 px), the town side by side from 52.5 rem (836 px needed); a **short** layout for landscape (title row, rail, 44 px dock) with its arithmetic; keyboard mode hides the top bar, toasts and status layer and requires 40 % of the visual viewport for the form; 844 × 390 and 667 × 375 added to the layout tests. **Partly:** the reviewer suggested medium at about 52 rem; the lobby's two columns fit from 50 rem, so only the town's side-by-side waits for 52.5 rem | TWN-R-0.2.1, 0.3.3, 0.3.5, 0.4.6, 1.4.12, 4.6.7 |
| JM-8 | The rebuild read on three of 21 bands; Follow was inconsistent; floating layers could stack; stamps had no touch rule | Upheld. The landing shows the whole clear and rebuild on one screen (survey line across all tiles, per-tile progress meters and stamp counts); a **build board** lists every page being built with the lamp's row highlighted; one Follow rule for every width (it moves the town's view, never a viewer in an interior; returns a street to the landing during a `site.*` sequence; a touch pauses it); the status layer shows at most two items by a fixed priority with "+N"; the three latest stamps' plates are always shown and older stamps reveal on tap | TWN-R-0.4.5, 5.5.1 to 5.5.6, 5.7.4 |
| JM-9 | Screen-reader order contradicted "two swipes from the top bar"; the command sheet's order was undefined; the rail stepped one item per swipe; VoiceOver claims were untested | Upheld. The status layer is the "Updates" landmark directly after the top bar in the DOM; the command sheet's DOM order (field, then results in rank order, drawn outward from the field) and its arrow keys are specified and tested; the rail is a range input stepping 5 % with Back 100, Forward 100 and Jump to; every VoiceOver and TalkBack claim is marked assumed until G1 with a named fallback | TWN-R-4.13.4 to 4.13.6, 2.5.9 |
| JM-10 | The demo's Follow state contradicted its beats; AirPlay shows no touches; the phone would auto-lock; pasting into Notes backgrounds Safari; the script needed four people | Upheld. A Follow column per beat (on until 4:20, then off, and Follow never pulls the presenter out of an interior); presentation mode requests a screen wake lock and draws its own touch indicators; copying shows an in-page plate; four named roles; a composed **room view** (the phone capture beside a second Maya window showing the expanded design). **Partly:** the reviewer's "laptop mirrored from the same session with the phone as controller" would need a new backend relay for session mirroring; not adopted, and the second window follows the agent in presentation mode instead | TWN-R-5.12.1 to 5.12.3 |
| JM-11 | Base budgets were guesses promoted to requirements; no iOS thermal or battery signal; a DPR contradiction; GPU text on phones is mostly DOM text anyway | Upheld. **Hybrid text is the default on coarse pointers and at Base** (all phone text is DOM text; GPU text only at Enhanced and Full with a fine pointer); phone figures are targets recorded beside measured values, resettable by the owner at G0 with reasons, kill thresholds never; Android battery drain ≤ 4 % per 10-minute soak; iOS recorded as "guard only"; Base interiors and the town render at min(DPR, 2) | TWN-R-0.6.3, 0.6.4, 3.5.11, 3.12.3, 3.12.4, 3.13.2; G0 C11 to C14 |
| JM-12 | No viewport model, overscroll, manifest or service worker, system text size or first-run Hand | Upheld. Document scroll with a `100lvh` canvas; toolbar resizes bump nothing; `overscroll-behavior`; a web app manifest and a shell service worker with an offline start; the system text size is the default (Dynamic Type through `-apple-system-body`, Android's default font size through `rem`); a 200 % test at 360 px for both bars; a first-run Hand chip | TWN-R-0.2.3 to 0.2.6 |
| JM-13 | No Sort on phones and an inventory that could not see it; 28 px heatmap cells against the 44 px rule; one-at-a-time matrix review; an undefined page-editor swap; `pages.editor` declared whole | Upheld. Sort in the dock and the inventory scans Plat capability tags; chart and diorama marks are selected by nearest-mark tap with 44 px step buttons as the equivalent control (WCAG 2.5.8's equivalent exception), and wide heatmaps pan; By role gets Select for several changes in one confirmation and a Compare two roles view; the Desktop layout editor uses a defined push-down rule; `pages.editor` is an entry card | TWN-R-0.1.1, 0.5.3, 2.5.8, 2.6.4, 2.9.5 |
| JM-14 | Requirements that could not fail or could not pass | Upheld. Tap test reworded (JM-5); thermals measured, not inferred (JM-11); the study is a within-subject non-inferiority test with at least 8 participants per condition and confidence intervals; the demo exemption is an exact list; TWN-R-2.4.9 uses step buttons and nearest-element tap; "meaning" is defined by an effects manifest; TWN-R-1.4.5 retired | TWN-R-4.16.1, 4.16.2, 2.4.9, 0.6.2 |
| JM-15 | The vista hid the cost of rotated blocks | Upheld. Blocks rotate by multiples of 90° to face the Square; every module and landmark has back and side elevations; G-ART reviews them from the opposite headings | TWN-R-1.4.6; `01` sections 1.7 and 1.12 |
| JM-16 | Smaller items | Upheld. The borough index (cryptic labels, overlap with the last lot, the left-edge conflict) is removed with the single street; the fast-scroll rail sits 24 px inside the leading edge with Hand left; Low-power's "interiors unchanged" now says dioramas show flat twins; approvers get an **Approvals** slot in the bottom bar (six slots); members' streets omit unavailable districts; the HTTPS default is the click-through certificate that is already on the integration line, with mkcert only if G0 C11 shows WebGPU hidden behind it | TWN-R-0.4.3, 0.4.4, 1.5.2; `03` section 3.12; `06` section 6.11 |

**Retired by the review:** TWN-R-1.4.1 (one street of every block), TWN-R-1.4.4 (borough index), TWN-R-1.4.5
(Overview).

**Added by the review:** TWN-R-0.2.3 to 0.2.6, 0.3.5, 0.4.5, 0.4.6, 0.6.4; 1.4.8 to 1.4.12; 2.1.4, 2.1.5, 2.3.4, 2.4.10,
2.5.8, 2.5.9, 2.6.4, 2.9.5; 3.5.11, 3.12.4; 4.13.5, 4.13.6; 5.5.6, 5.7.4, 5.12.3; 6.8.1 to 6.8.3.

**Changed in substance, IDs kept:** TWN-R-0.1.1, 0.2.1, 0.3.3, 0.3.4, 0.4.1 to 0.4.4, 0.5.2, 0.5.3, 0.6.2, 0.6.3,
0.9.1; 1.3.1, 1.4.2, 1.4.3, 1.4.6, 1.4.7, 1.5.2, 1.9.1; 2.1.3, 2.4.1, 2.4.8, 2.4.9; 3.12.3, 3.13.1; 4.6.7, 4.12.1,
4.13.4, 4.15.3, 4.16.2; 5.5.1 to 5.5.5, 5.12.1, 5.12.2; 6.7.1, 6.11.1 to 6.11.3; G0 C10 to C14 (revised before any
measurement).

## What is gated on the spike (G0)

- The text architecture: whether glyphs painted from Plat rects land within 1 CSS px of the browser and break lines
  where it does (C1, C2). A kill means hybrid text for the whole spec (K1).
- The WebGL2 claim of one TSL source, including RGBA32F `textureLoad` in a vertex shader (C5); the degradation table in
  `03` section 3.3 is rewritten from the results.
- Whether a GTX 1080 Ti has headroom for the interior and the city at 1440 × 900 (C3, C4).
- Whether text stays one correct copy, in its box and inside its clip, in phone emulation at DPR 2.625 and 3, after
  reflows, without `OffscreenCanvas`, and with init failures ending in Plain mode (C10).
- Whether real phones get WebGPU over HTTPS on the LAN, and whether the Base tier meets its frame, touch, thermal and
  memory budgets on them (C11 to C13), and its main-thread and loading budgets in emulation (C14).
- Native selection, copy and typing over the canvas (C6, C7), Plain mode and forced colours (C8), and the Enter
  hand-off with focus and the reduced-motion crossfade (C9).
- Decisions the spike already forced: tabular numerals need a tabular-by-default face; MSDF is deferred; tilt-shift and
  pane-card variants are chosen from the measured ones.

No step that paints with the GPU starts until G0 is recorded (TWN-R-7.2.1). The Plain-mode work (P1 to P6) does not
depend on it.

## Open questions for the owner

1. **Motion default.** This spec defaults every viewer to Reduced until they choose Full (access must-add 3). First-time
   visitors will not see flights, flows in motion or the Enter transitions unless they choose Full; the demo sets Full
   explicitly. Keep Reduced as the default?
2. **Tabular numerals face.** JetBrains Mono (as in the spike) or a feature-frozen Inter subset built at asset time.
   Phones now use DOM text, so this affects desktops' GPU text and the shared Plat face.
3. **Dry-run and refused stamps.** Browsers cannot see calls that write nothing. Add an `agent.activity` notice to the
   gateway (forwarded to the session's owners like `present`) so the trail can show hollow and struck stamps?
4. **Devices and people.** Which two phones are the G0 and G-PERF phones (an Adreno 6xx class Android phone and an A15
   class iPhone are assumed), which laptops measure Enhanced, who runs the VoiceOver (iOS), TalkBack, NVDA and
   VoiceOver (macOS) scripts, who fills the demo's four roles, and who takes part in the task-time study (at least 8
   per condition, including daily screen-reader users).
5. **`ui.present` consent.** The town app asks before navigating unless Follow agent is on, whereas Classic navigates
   directly. Confirm the difference is acceptable.
6. **Looks that fail G-ART.** May a look be dropped from the town app only while Classic keeps it? Looks are judged on
   the phone captures first; nocturne will be judged at Base, without bloom.
7. **Renderer failure behaviour.** A viewer whose renderer fails after the probe stays in the town app's Plain mode
   instead of writing the override "classic" and redirecting (a refinement of UI-MAP section 8.5). Confirm.
8. **Slow connections.** On Save-Data or a 3G-class connection the town app stays in Plain mode until the viewer
   chooses graphics. Confirm, or start painting anyway?
9. **G1 ratio.** The authoring-cost pass line moves from 1.2 × to 1.3 × Classic's lines (kill from 1.5 × to 1.6 ×),
   because each widget now has a compact presentation and a dock declaration Classic does not have. Accept?
10. **Classic and the phone order.** `PageItem.compact` is a backend field both apps can read. Should Classic's own
    single column below 48 rem use it too, so a page reads in the same order on a phone in either experience?
11. **Phone target resets.** G0 may show that some phone targets (warm-up, the 450 KB first-frame download) cannot hold.
    This spec lets the owner reset a target on the G0 task with the measured value and reason (never a kill
    threshold). Is that the right authority, or should a reset need a spec change?
