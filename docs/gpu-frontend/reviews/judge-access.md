# Judge review: accessibility and daily enterprise use (GPU frontend round)

Lens: WCAG 2.2 AA as a hard gate, and whether a person who lives in the Suite all day (operations lead, finance,
approver, screen-reader user, magnifier user) is faster or slower than in the DOM app. Sources: the brief, the five
proposals read in full for the sections cited, and `docs/frontend-competition/judge-a11y.md` for the bar the DOM round
was held to (real controls, announcements from the data path, UTC `<time>`, no "null", focus restore, forced colours,
reduced motion). Nothing was run. Every finding below is from the spec text; none is observed behaviour.

## Summary table

| Rank | Proposal | Mirror completeness | Motion safety | Focus model | Dense-task efficiency | Test coverage | One-line verdict |
|---|---|---|---|---|---|---|---|
| 1 | Township | 9 | 4 | 9 | 7 | 8 | The DOM is the layout, the focus ring and the scroller; the GPU only paints. Worst motion defaults in the set. |
| 2 | Orbit | 8 | 6 | 7 | 7 | 8 | One view tree, real DOM mirror, the most complete a11y spec. Mirror is a second layout that must be kept aligned. |
| 3 | Instrument | 7 | 7 | 7 | 8 | 9 | Best for dense work and best-tested, but it replaces native scrolling and selection with its own. |
| 4 | Atelier | 8 | 5 | 8 | 6 | 7 | Native scroll and input, good Paper mode. Physics, page turns and physical metaphors tax daily users. |
| 5 | Constellation | 6 | 4 | 5 | 6 | 6 | A free-orbit graph backdrop and panels that reshuffle on focus. Highest cognitive load, thinnest AT proof. |

Scores are 1 to 10, higher is better. "Motion safety" scores the defaults a user gets without setting anything.

## Cross-cutting findings (apply to more than one proposal)

**X1. Forced colours and transparent mirror text.** Orbit 5.6, Instrument 5.9, Atelier R5.6 and Constellation R5.7 all
say: in `forced-colors: active`, read system colours from probe elements and draw a flat "System" look on the GPU. All
four also make the mirror's text `color: transparent`. Under forced colours the browser overrides `color` on those
spans (it ignores `transparent` unless `forced-color-adjust: none` is set), so the mirror text becomes visible
`CanvasText` laid over the GPU text. A grep of all five proposals finds no mention of `forced-color-adjust`. Failure
scenario: a Windows High Contrast user opens the ledger; every line is drawn twice, once by the GPU and once by the
mirror, with the sub-pixel drift (`scaleX` calibration in Atelier R3.6, per-line spans in Orbit 5.2) visible as
doubled, smeared text. WCAG 1.4.3 and 1.4.12 legibility fail. Township avoids this by construction: under forced
colours it drops the canvas and shows the Plat as Plan mode (R2.3, R5.6). Atelier's Paper mode would also work, but
R5.6 sends forced colours to a GPU "Q0 flat" tier first.

**X2. Single-key shortcuts versus screen-reader browse mode.** Orbit 4.6 (`G`, `O`, `F`, `D`, `T`, `[`, `]`),
Township R4.4 (`G` chords, `.`), Instrument 4.5 (`V`, `F`, `I`, `T`, `X`, `G`) and Constellation R4.7 (`g`, `F`, `/`,
`[`) all default single-character shortcuts on and rely on "turn off in Settings" to meet 2.1.4. In NVDA and JAWS
browse mode those letters are quick-navigation keys (`G` graphic, `F` form field, `T` table, `D` landmark) and are
consumed before the page sees them. The shortcuts do not fire for the people who most need keyboard access, and the
ones that do fire (focus mode, a grid) collide with typeahead: Orbit 5.3 gives lists and menus typeahead, so pressing
`d` to find "Delivered" in a roving list also toggles Data view. 2.1.4 is met on paper; the product is still
unreliable for AT users. Only Atelier (R4.6) uses modifiers or widget-scoped keys throughout.

**X3. Virtualised tables break Find in page and select-all.** All five keep only a window of rows in the DOM (Orbit
3.5: about 52; Township R3.4: about 90; Instrument 5.3: window plus 20; Atelier R3.5: plus 20; Constellation R3.4:
plus 8). Ctrl+F, Ctrl+A and copy see the window only. Township's demo (R11, 0:35) says Ctrl+F "finds Peak in the
painted table", which is true only for the rows currently mounted. Instrument is the only one that replaces this with
a better in-app filter (GPU filter, 3.4); Orbit's ledger has a type filter only; Atelier's R5.8 task 6 uses Ctrl+F on
a report, not a ledger. Failure scenario: finance asks a screen-reader user to find memo "Q4 bonus" in 912 lines;
Ctrl+F reports no match for rows outside the window.

**X4. F6 and Alt+Shift chords.** All five bind F6 to landmark cycling, which removes the browser's F6 route to the
address bar. Orbit (Alt+Shift+M), Atelier (Alt+Shift+F, C, O, T) and Constellation (Alt+Shift+P) use Alt+Shift
letters, which collide with browser access-key chords in Firefox and with some AT layers. Low severity, easy to fix.

**X5. Camera-driven navigation in the default path.** Orbit (B.4: 420 to 900 ms flight per route), Township
(S.3: 900 ms dolly zoom per Enter), Instrument (route dolly, 300 to 600 ms), Constellation (unfold) and Atelier (flat
focus transition) move something on every navigation. Each honours `prefers-reduced-motion` and each has a cut or fade
variant, but none defaults to the reduced variant for a first-time user who has not set an OS preference, and only
Orbit ships an in-app pause control (5.6, `Shift+P`).

**X6. No proposal analyses screen-magnifier use beyond "mirror rects follow focus".** Only Orbit 5.2 and Instrument
5.3 spell out why co-registration matters for ZoomText and Windows Magnifier. None specifies what happens when a
magnifier at 4x pans while a camera flight is in progress, or when the canvas is upscaled (Instrument 8.3 caps DPR at
2 on a DPR 3 phone, then upscales the canvas). Nobody tests with a magnifier.

---

## Township

### Concrete WCAG failures and risks

1. **2.2.2 Pause, Stop, Hide (A): the city has autonomous motion with no pause control.** Section 1.2 rule 2 and R7.3
   allow "weather, water, foliage and a slow sun" and keep the city at 30 Hz when idle. R5.5 stills them only under
   reduced motion. There is no in-app pause or "calm city" control, and `/city` is the first demo screen (R11, 0:00).
   Scenario: a user with an attention disorder and no OS reduced-motion setting opens `/city` and the scene never
   stops moving for more than 5 seconds, with no way to stop it short of changing OS settings.
2. **Vestibular harm, not an AA failure but the worst default in the set: the Enter transition is a dolly zoom.**
   S.3 narrows the FOV from 32 to 2 degrees while the camera dollies, flattening perspective over 900 ms, then
   unfolds cards with a tilt-shift band collapsing. A dolly zoom is the classic vertigo effect. It runs on every
   city-to-page entry by default. R5.3 also moves the city camera on every keyboard focus change (450 ms). Scenario:
   a keyboard user arrows through 19 district links in the city and triggers 19 camera flights. Mitigation exists
   (Travel setting "cut", R1.3.19), but it is a setting, not the default.
3. **2.5.8 Target Size (Minimum) in the city.** R9.5 positions up to 120 invisible links over the projected rects of
   buildings and houses (40 houses on five lanes). Nothing enforces 24 x 24 CSS px for a distant house or a far
   building, and the targets move while the camera orbits. Section R5.7 states the 24 px rule for "every Plat
   control", but the city links are projected, not laid out. Scenario: at city altitude on a 1280 px window a house
   link is about 10 px wide; a pointer user misses it, a switch user cannot scan to it in a sensible order.
4. **2.4.7 and legibility during scroll.** R4.2 admits that the compositor scroll can lead the GPU paint by one frame,
   so the real DOM focus outline and caret move before the painted text. The mitigation paints the field chrome as
   CSS during scroll, but table text is not covered. Scenario: a low-vision user scrolls the ledger with the keyboard
   and sees the focus rail one row ahead of the painted row text during a fling.
5. **X3 above.** The demo claim about Find in page over the 912-row table overstates what a 90-row window delivers.
6. **Contrast on the city.** Plaques sit on opaque plates (R5.6) and the backdrop is luminance-capped, which is a
   good answer. The check is token-level (`town-looks check`); the "contrast on rendered pixels" test that Orbit and
   Instrument both specify is absent for the city plaques over bloom and fog.
7. **No `prefers-contrast` handling** (grep: not mentioned). Forced colours is covered by Plan mode, but
   `prefers-contrast: more` users get no high-contrast variant of the six looks.

### Strongest a11y design decisions

- The Plat is the layout engine (R9.4). Real CSS grid, real `<table>` with `aria-rowcount`, native scroll containers,
  native `<dialog>`, native focus outline. There is no second layout to keep aligned, so there is no mirror drift to
  test for. "Painted text drifts" is the named kill signal, and the fallback is simply making the DOM text visible.
- The visible focus indicator is a real CSS outline on a real element (R5.3), with `Highlight` under forced colours.
  2.4.7, 2.4.11 (`scroll-padding-top` equal to the HUD height) and 2.4.13 are satisfied by the browser, not by a
  shader.
- Plan mode is the first paint of every load (R7.5), the forced-colours path, the Save-Data path and a keyboard toggle
  (`.`), and it is built first (D1, D2). After D2 the product is a complete accessible app.
- Honest, tested "no ghost text" rule (R9.8): every painted run maps to a Plat node and every named Plat element has
  a PaintSpec. Plus a "stalled painter" test that proves the "pane added" announcement still fires.
- `ui.present` never moves the camera without consent outside an opt-in presentation mode (R6.5), with a Back chip.
- Interior panes have no perspective, tilt or parallax (R3.3). All motion risk is confined to city, travel and the
  rebuild, and "Travel: cut" exists.

### Experience for specific users

- **Screen reader, 3D-only moments.** Rebuild, flows and construction are decoration (R6.6: "work never waits for
  animation"). Announcements are per-event with a batch rule ("4 panes added to Home by agent claude-code, changes
  #48,212 to #48,215", R5.4). The rebuild is the best-announced of the five because the DOM changes in the same frame
  as the event.
- **Magnifier.** Strong in interiors (real DOM, real rects). In the city the magnifier follows projected link rects
  that are moving; unspecified.
- **Cognitive load and wayfinding.** The city is a metaphor layered on top of a standard Directory, breadcrumb, `G`
  shortcuts and palette (1.2 rule 5). A daily user never has to touch the city. The cost is a second navigation
  model that must be learned for the demo moment. Kill criterion R13.1 row 3 (median task time over 1.15x the DOM
  app) is the right gate.
- **Forms.** Native visible inputs over painted chrome (R4.1), native IME and autofill, native `<dialog>`. Best of the
  five because inputs are always the real element in the real flow.
- **Data-dense tasks.** Trial balance, matrix and triage are DOM-grade (R3.4, R3.5, R1.3.8). Matrix is a real
  `role="grid"` with row headers and glyph plus scope (never colour alone). Equal to the DOM app on speed once inside
  a page; slower to reach it if the user starts from the city. Approvals item view uses a two-key diorama with a flat
  checklist twin.
- **Testing.** Axe on city and interior for seven principals, landmark and focus-order snapshots, an announcement-log
  assertion with the painter artificially stalled, line-break parity, no ghost text, WCAG text-spacing bookmarklet
  values (R5.7), a 10-task NVDA/VoiceOver smoke (R13.1 row 4). No 320 px reflow test is named.

---

## Orbit

### Concrete WCAG failures and risks

1. **X1: forced colours with transparent mirror text** (5.2, 5.6). The doubled-text failure above. Orbit specifies
   the probe approach well but not `forced-color-adjust: none` on the mirror text layer, nor a switch to the Plain
   path in forced colours.
2. **2.1.4 and X2: single-key defaults** (4.6). `D` toggles Data view and `F` toggles focus mode while the same
   widgets have roving lists with typeahead (5.3). Scenario: in the permission matrix grid a user types `d` to jump
   to a row beginning with D and the Data view toggles instead, tilting three layers with a 20 degree animation.
3. **2.2.2 and motion defaults.** Every route change is a camera flight (B.4), scrolling shows "natural parallax"
   between tiers (B.1), ambient light drift runs at 20 Hz (2.3), the Lumen pulses (S.6, under 1 Hz, 6%). `Shift+P`
   pauses motion (5.6) but nothing in the UI offers it to a first-time user; reduced motion is OS-driven. Mitigated
   by: no roll, fixed FOV, level horizon, angular velocity cap 90 degrees per second (B.3 rule 6), critically damped
   springs. That is the most careful camera spec in the set, but a full default session is still flights.
4. **1.3.1 and 1.3.2: per-line absolute spans** (5.2). "Each text line is its own absolutely positioned span".
   NVDA and VoiceOver read each span as its own line, so a paragraph is read in fragments with a pause at every wrap,
   and the fragments change with the viewport width and text scale. Scenario: a screen-reader user reads a message
   body in `messaging.thread`; the sentence is split mid-clause at the GPU's wrap points and reflows when they raise
   text scale to 150%. The text is in logical order and complete, but it is not one paragraph. Atelier's R3.6 has the
   same property.
5. **2.4.7 depends on a frame being drawn** (5.4). The ring is a HUD-pass draw. Render-on-demand (2.3) means it
   draws only if the focus event marks the frame dirty; after the first and second `device.lost` (2.2) the canvas is
   rebuilt but the ring, the only visible indicator outside forced colours, is gone until the next draw. A native
   outline on the mirror element, shown only when the canvas is not presenting, would close this.
6. **Focus waits for the camera** (5.3: "moves the camera there first and then focuses"). Tab from the last element of
   a bay goes to the dial by design, so most moves are local, but a search result or palette command focuses after
   up to 900 ms of flight. Between keypress and focus a screen reader hears nothing. Scenario: NVDA user opens a
   search result and presses an arrow before focus lands; the key goes nowhere or to the previous element.
7. **X3.** Ledger Ctrl+F and copy see about 52 rows (3.5, 4.5).
8. **Ghost label contrast.** The ghost's label sits on a 45 degree hatch at 22% accent (S.7). The contrast test
   covers "every primitive" (5.8) but the hatch under text is not named as a worst case.

### Strongest a11y design decisions

- Both projections come from one view-tree node in one pass, and the mirror is typed so a control with no label does
  not compile (5.1, 9.3). Parity test with a 2 px box tolerance and glyph-run string equality (9.9). This is the
  best-specified parity contract.
- Native scroll: the mirror `<main>` is the real scroll container and its `scrollTop` drives the camera crane (8.1).
  Keyboard scrolling, find-scroll, three-finger scroll and `scrollIntoView` work.
- Plain path and Plan view both exist, run the same widget code, and the interaction suite runs on Plain too (9.9).
- Announcements are raised from the store layer, not the render path (5.5, A.2). The wording copies the best of the
  DOM round. Backfill is `aria-busy` released at first live frame or 3 s.
- A twelve-task scripted screen-reader and keyboard-only suite is a G2 gate (5.9, Requirement 12), plus rendered-pixel
  contrast at worst-case sheen (5.8) and a CDP IME test (9.9).
- Every Data-view 3D object has a `D` toggle and a flat twin that is always in the mirror (B.3 rule 4). Dragging has
  menu and keyboard equivalents (1.4.7 board, 1.4.17 editor).
- Ghost, thread and Lumen are all paired with text and glyph (6.3). Agent attribution never depends on colour.
- Honours `prefers-reduced-transparency` and `prefers-contrast: more` (5.6), which no other proposal except
  Constellation mentions.

### Experience for specific users

- **Screen reader, 3D-only moments.** Rebuild is a store-level event batch: "Page built: Store, by agent claude-code,
  change 418. 3 widgets." plus an `<aside aria-label="Agent">` log (5.1, 6.5). Pulses and threads have a static
  highlight plus a trace tick. Good. Weak point: during the weave the bay mounts panels progressively, so a user
  exploring `<main>` mid-rebuild sees a changing outline; `aria-busy` on affected sections is not specified for this.
- **Magnifier.** Best-reasoned in the set (5.2: reading poses are 1:1, near-identity transforms at rest so the
  `matrix3d` reduces to `translate`, R3 mitigation in R13). Panning during a flight is not covered.
- **Cognitive load.** Twenty-six stations on a ring with six arcs is a large spatial model, but the station dial, `G`
  chords and palette are present at all times and the URLs are unchanged.
- **Forms.** Native controls overlaid, `autofill` tint hook, error summary announced, idempotency key per intent (4.3).
  Edit fields only in reading poses and `ui.present` is deferred while a field has focus (4.2, 6.6).
- **Data-dense tasks.** Ledger: native scroll, 912 rows, tabular numerals, pinned opening and closing balance,
  decimal alignment (3.4, 3.5). Matrix: glyph plus word cells, sticky headers, flat by default. Triage of 40 approvals
  is the list-plus-item pattern. Slightly slower than the DOM app on cross-station work because every `G` jump is a
  420 to 900 ms flight, and faster than nothing on single-station work.
- **Testing.** Highest coverage after Instrument: axe on three render paths, parity, rendered contrast, overlay drift
  at 0.5 px, 1.4.12 bookmarklet, CDP IME for Japanese and Korean, recorded rt sessions, `aria-rowcount` checks.
  The NVDA and VoiceOver suite is manual, which is realistic but means regressions are caught late.

---

## Instrument

### Concrete WCAG failures and risks

1. **X1: forced colours with transparent mirror text** (5.3, 5.9). Same doubled-text failure.
2. **GPU-owned scrolling and selection (1.3.1, 2.1.1 risk, 4.1.2).** Section 8.2 describes the deck scroll as
   "platform-like inertia (velocity decay 0.95 per 16.7 ms, rubber band at ends)", not native scroll. The mirror is
   `pointer-events: none` (5.3), pointer events go to the canvas (4.7), and read-only text selection is reimplemented:
   a drag over ink resolves a glyph range and calls `setBaseAndExtent` on the mirror (4.3), with a
   `selectionchange` listener mapping AT selections back. Consequences: browser scroll keys, scroll anchoring, rubber
   banding, Windows scroll settings, "scroll lines per notch", Smooth scrolling off, `scrollIntoView` for
   find-in-page and for screen-reader focus all rely on code Instrument must replicate, and the context menu, link
   drag and "Open in new tab" on the mirror anchors need a click to be re-dispatched to the mirror. Scenario: a user
   with tremor who relies on an OS-level scroll speed setting finds the deck moves at the app's speed instead. A
   mirror built from real scroll containers (Orbit 8.1, Atelier R9.5, Township R4.2) avoids all of it.
3. **2.3.3-class motion in the default state.** The "parallax while scrolling" is on by default (5.7 lists it under
   full motion; 8.1 turns it off only on phones). Planes move at different rates while the user scrolls a dense
   table. Rule 7 ("motion only on events") and rule 4 ("the camera moves rarely") are the best principles in the set,
   but parallax on scroll contradicts the spirit of rule 7. 3D wells tilt (`T`, `X`) and can be orbited with
   two-finger drag (8.2).
4. **2.2.2.** The beacon "lit steadily (no idle animation)" and a static bench is good. Trails, pulses and bloom pulses
   are single events. There is no pause control; with no ambient motion it is not needed.
5. **2.4.7 depends on a frame** (5.4). Same as Orbit item 5; the ring is an ink pass draw. They add a faint emissive
   halo, which is a visual extra, not a fallback.
6. **X2** (4.5: `V`, `F`, `I`, `T`, `X`, `.`). The `F` key focuses the filter field and `.` opens a panel menu while
   panels contain grids with typeahead.
7. **Reduced-motion default for the wall display** (6.6): `?display=wall` defaults to Follow agent presentations, i.e.
   a camera dolly toward the presented panel. It stops on any input; acceptable for a wall.
8. **3.2.6 Consistent help and ARIA application roles** are handled; no gap found.

### Strongest a11y design decisions

- "The mirror is generated, not written" (5.1) with required `a11y` blocks for every instrument and required accessible
  names at the type level. Parity test: same role, same name, rect within 1 px, and no invisible focus stops (9.9.7).
- The most complete WCAG 2.2 table (5.10): 2.1.1, 2.4.1, 2.4.3, 2.5.1, 2.5.7, 2.5.8, 3.2.1, 3.2.6, 3.3.8, 4.1.2,
  4.1.3. Target sizes are 24 px compact and 32 px comfortable, with hit boxes enlarged beyond drawn bounds (4.7).
- The only automated 320 CSS px and 200% reflow test with no overlapping text runs and no horizontal page scroll
  (9.9.7), plus media emulation for forced colours and reduced motion, plus a "keyboard walk" that checks every focus
  stop has a visible ring in the rendered pixels and an accessible name (9.9.5). The best test design in the set for
  catching regressions.
- Rendered contrast gate with ink hidden to sample the darkest and lightest background under each run (5.8), and a
  minimum glass tint opacity (0.72 dark, 0.78 light) so refractive surfaces cannot defeat text contrast. This is the
  strongest answer in the set to "contrast on refractive surfaces".
- Rate-limited announcements: one per 1.5 s from realtime, bursts merged, "Quiet live updates" preference, and a
  merged rebuild sentence every 5 s (5.5). The best answer in the set for a screen-reader user during a 74-widget
  rebuild.
- `ui.present` never moves focus; preference-gated camera move; chip with `G G` otherwise (6.6).
- Deletions of a focused item announce and move focus (5.4). Same as Orbit and Atelier; best worded.
- AT matrix is the widest: NVDA with Chrome and Firefox, JAWS, VoiceOver macOS and iOS, TalkBack (5.11).

### Experience for specific users

- **Screen reader, 3D-only moments.** Wells (terrain, flow ribbon, chain, exploded matrix) have a flat default and a
  mirror table plus a one-sentence description (5.6). The rebuild is merged into progress sentences. Held ghosts are
  listed as text in the panel description. This is accurate and calm.
- **Magnifier.** Co-registered rects (5.3) and a double focus ring that stays visible against any surface. Scroll is
  custom, so a magnifier that follows scrolling has less to go on than with native scroll.
- **Cognitive load.** One command line (Ctrl+K) that can run any action, `G` chords, a trace strip. Fewest
  metaphors of the five. A mission-control surface is dense but familiar.
- **Forms.** Real controls always present, validated against the JSON Schema, an error summary slab that takes focus
  with links to each field (3.3.1, 3.3.3), redundant entry avoided (3.3.7). Overlay fields snap their panel flat
  and remove parallax while editing (4.2). Strong.
- **Data-dense tasks.** Faster than the DOM app: GPU filtering for 100k rows in two frames, sticky header and column,
  inline bars and a match-density scrollbar (3.4), keyboard cursor and `Alt+Enter` maximise. Triage of 40 approvals
  is the table plus `I` inspector. It loses to DOM on exactly the things in item 2 above, and on Find in page for
  rows outside the window (X3), partly redeemed by the in-app filter. Kill criterion 13.9 (median task time more than
  10% slower than Meridian) is the right gate.
- **Testing.** The best in the set (keyboard walk, reflow, media emulation, overlay baseline within 0.5 px,
  announcement templates in Appendix D asserted against injected frames, scripted AT sessions at each domain gate).

---

## Atelier

### Concrete WCAG failures and risks

1. **X1: forced colours with transparent text** (R5.6). R5.6 routes to Q0 flat with `outline: 2px solid Highlight` on
   the glass DOM, but the glass DOM text stays transparent. Same doubled-text failure unless it falls through to
   Paper mode.
2. **Ctrl+wheel hijack** (1.1). "Overview (`Ctrl` + wheel down, pinch-in on touch)". Ctrl+wheel is the browser zoom
   gesture. Taking it for Overview breaks zoom for low-vision users who zoom with a mouse wheel, and on a trackpad
   pinch (which browsers report as Ctrl+wheel) makes the page go to Overview instead of zooming. WCAG 1.4.4 resize
   text is still available by keyboard, but this is a hostile default. Remove it.
3. **Physics and tumbling in the signature moment** (R6.5). `site.clear` is a sweep in which every card falls off the
   desk with real rigid-body tumbling (Rapier); coins drop and settle (R1.2); page curls and flips (R2.7). The camera
   is near-orthographic (FOV 12 degrees, R1.1), which removes most perspective parallax, but body motion over a
   1.1 s window across the whole viewport is a vestibular and photosensitivity risk and has no pause. Reduced-motion
   path is thorough (R5.6: fades and cuts, nothing flashes more than once per second, stricter than 2.3.1).
4. **1.3.1 and 1.3.2: per-line spans with `scaleX` correction** (R3.6). Same fragment reading as Orbit item 4, plus a
   `transform: scaleX(k)` hack to fit DOM text under GPU glyphs. If the font fails to load, `k` is wrong and
   selection highlights and find highlights land off the glyphs.
5. **Text on glass, "light through frost"** (R3.8, R1.3). Charts are drawn on frosted glass with refraction and
   dispersion (R2.5). The contrast governor (R3.4) is computed analytically from the lights and the card's
   albedo, not from what the glass refracts from the desk behind it. The rendered-pixel contrast test (R5.6) samples
   400 known positions per look; whether those include glass over a high-contrast desk (terrazzo, newsprint) is not
   stated. Instrument's explicit minimum tint opacity is the stronger answer.
6. **Cognitive load: physical metaphors that rename familiar controls** (R1.2). A transfer is a cheque slip that turns
   over; a ledger is an open book with page turns (`PageUp` and `PageDown` turn pages while the wheel scrolls
   continuously); the permission matrix is a perforated punch card; the approvals decision is "the stamp rack". A
   daily finance user must learn that "PageDown turns a page". The mitigation, flat focus (R3.7), is default for dense
   widgets and deep-linkable, which is good; it costs one more transition for every dense task and is not the
   default for the transfer and award flows.
7. **`contenteditable` per block** (R4.4, R4.3). Rich blocks use `contenteditable` rather than plain text areas.
   Screen readers and IMEs behave worst in `contenteditable`; Constellation uses `contenteditable="plaintext-only"`
   (R4.5), Township and Orbit use textarea.
8. **X2 is absent here** (modifier chords only), but **X4** applies: Alt+Shift letters and F6.
9. **No explicit 320 px or 200% test** in R9.10. R5.7 states behaviour and R5.8 lists seven walkthroughs, but there is
   no automated reflow assertion, unlike Instrument 9.9.7.

### Strongest a11y design decisions

- The glass DOM is the page scroll container, receives all pointer input, owns focus, links, find and selection
  (R5.1, R9.5). All scene gestures are arbitrated so that text and controls stay native (R9.7). A native `<a href>`
  everywhere, native `<select>`, native date inputs (R4.3).
- Paper mode is the same DOM made visible (R9.6): first paint, unsupported browsers, forced colours when the GPU is
  absent, low-power setting. The recommendation section makes the point that the kill-criteria fallback is a complete
  accessible DOM edition, not a rewrite (R13.1).
- **Flat focus as a first-class mode** (R3.7): the card rises, camera goes orthographic, material becomes a matte
  uniformly lit sheet, the rest of the page is `inert` and out of the accessibility tree, Escape restores focus to the
  invoking button, deep link `?focus=`. This is the cleanest "dense work gets a plain surface" design in the set.
- Modifier-only shortcuts and a shortcut sheet (R4.6); no single-key traps.
- Contrast governor chooses the ink from the lit paper luminance per card and caps shading on text (R3.4); shadows
  from other cards over text are bounded to 18% luminance loss.
- Masked cells render "Masked", never empty (R1.17, R5.3 `masked`); stamps and seals have text in the owner element.
- Focus restoration and removal announcements ("Approval 77 was decided by Jonas Berg; moved to the next approval").
- Rebuild test asserts "the board never lags the trail": each card's DOM section exists in the same frame as its
  stamp entry (R9.10).

### Experience for specific users

- **Screen reader, 3D-only moments.** The agent log is a `role="log"` region that can be followed alone (R5.8 task 7),
  and `Alt+P` moves focus into a presented item (R6.6). The hand, stamps, tool trail and tumbling are invisible to AT
  but each has a text counterpart. Per-widget announcements during rebuild are not merged as in Instrument; the
  announcement is per event. A 74-widget rebuild is a long run of "Agent claude-code added ..." sentences unless the
  debounce (600 ms) coalesces them.
- **Magnifier.** Native scroll plus resting-pose pixel alignment give good behaviour; moving cards only track the
  focused control (R4.2), which is a clever limit.
- **Cognitive load and wayfinding.** A card file with index tabs by section is familiar; the object vocabulary is
  large (coins, tags, tiles, plates, vellum).
- **Forms.** Excellent mechanics (always-present real controls, native select, ARIA combobox, chips with remove
  buttons, `visualViewport` handling), with the cheque-slip and stamp metaphors on top.
- **Data-dense tasks.** Flat focus with 890 virtualised rows, a typed column store, 0.6 ms sort and a crosshair. The
  ledger is "book" by default on non-flat pages. Triage of 40 approvals is a tray plus a stamp rack; the flat version
  is a table with decision buttons. Slower than the DOM app by one transition per dense task and by the metaphor
  vocabulary; the kill criterion R13 row 6 (median task time more than 10% slower) acknowledges the risk.
- **Testing.** Parity, axe, a slow-render announcement test, pixel-sampled contrast, a scripted MCP rebuild
  test with a same-frame assertion, seven AT walkthroughs on five AT and browser pairs. No reflow or keyboard-walk
  automation.

---

## Constellation

### Concrete WCAG failures and risks

1. **X1: forced colours with transparent mirror text** (R5.7). Same, with the added problem that the mirror panels
   carry a `matrix3d` perspective transform (R4.2), so the doubled text would also be skewed.
2. **Perspective panels as the default regime for most routes** (1.2). `auto` gives Panel mode only for ledger,
   admin, audit, reports, `/d/*`, inventory, manage, `/tasks/all`, page editor and every phone. Home, Store, Points,
   Messages, Notifications and People open in Orbit: panels on a cylindrical arc seen in perspective, with their
   text drawn into a mip-mapped panel texture sampled with 8x anisotropy (R3.2). Text is therefore filtered, not
   pixel-snapped, on the default screens, and 1.4.3 and 1.4.12 are met by tokens only. Perspective text for daily
   reading is the opposite of what the other four proposals do.
3. **Focus triggers layout motion** (R4.2). When focus enters a control in a panel that is not screen-aligned, the
   arranger moves that panel to the front slot over 220 ms. Tabbing across a Home page therefore reshuffles panels
   on each Tab press. 2.4.3, 3.2.1 (on focus) and 2.4.11 are all at risk: the moved panel can cover siblings,
   including the next element in the Tab order. Scenario: a keyboard user tabs from the balance panel to the
   transfer panel; the transfer panel jumps forward over the balance panel they were reading; the user's focus
   rectangle is correct but the screen the magnifier was centred on has changed.
4. **Motion defaults.** A force-simulated 13,600-node field is the backdrop of every route (R1.1 and 1.2). It runs
   to convergence and sleeps (R5.6, R9.3), and pulses are decoration, which helps. Defaults still include a
   free-orbit camera, "Follow focus in field" on for keyboard users (R5.5), comet camera-follow on `ui.present` when
   not editing (R6.6) and panel condensation from particles. No pause control; reduced motion removes most of it.
5. **The field navigator is a lossy equivalent** (R5.5). A `role=tree` "Entities by domain" lists "first 50 by
   relevance, then Load more, and Search this domain" for 13,600 entities and 41,000 edges, with `Alt+→` for
   connections. A screen-reader user can reach any entity, but gets no overview of structure that a sighted user
   gets from the field. Entity, edge and pulse meaning is mapped to other widgets rather than made navigable.
6. **Mirror is not the single source of focus size** (R5.3, R5.1). `#mirror` root is `pointer-events: none` while
   `.pm` has `auto` (R9.5); the focus ring is a GPU draw except under forced colours, where a CSS outline is shown on
   a mirror element that is transformed in perspective.
7. **X2** (`g` chords, `[`, `]`, `F`, `/`, `?`) and **X4** (`F6`, `Alt+Shift+P`).
8. **Server-side scope:** a new `graph.snapshot` action (Appendix A) that builds per-principal graph data. An a11y
   judge notes only that it is an authorisation risk, not an a11y one; no accessibility test of the snapshot exists.
9. **Cognitive load.** The unit of navigation changes from "page" to "entity in a graph with lenses". K2 itself sets
   the bar at 6 of 8 participants finding a member's latest order from the field without the palette. For a
   daily enterprise user the field is a route that must be justified every time.
10. **Test depth.** Axe, a co-registration test, a recorded-frame replay, `getByRole` interaction, but no specified
    screen-reader task script, no keyboard walk, no reflow test, no contrast test on rendered pixels (token-level
    `looks:check` only, plus label plates). K4 mentions "a failed NVDA or VoiceOver script step" without defining the
    script.

### Strongest a11y design decisions

- Panel mode is the same panels under an orthographic camera and is the automatic mode for dense routes and all
  phones (1.2). Focused or edited panels and any panel with more than 12 rows are screen-aligned (0, decision 2).
- Required-name typing for mirror nodes, one heading outline, DOM order equals `(y, x)` reading order rather than 3D
  depth (R5.1).
- Field navigator as a first-class tree rather than a hidden fallback (R5.5), and a Plain mode (`Alt+Shift+P`) equal to
  the mirror with a documented K1 and K4 fallback to "hybrid panels".
- Focus never moves on realtime; deleted focused panels announce and move focus (R5.3).
- Contrast against label plates rather than the field (R3.7); `prefers-contrast: more` variant (R5.7).
- Pinch zoom stays enabled on phones and the renderer re-rasterises at `dpr x scale` (R5.8).
- `ui.present` asks first while editing and gives a Back chip (R6.6).

### Experience for specific users

- **Screen reader, 3D-only moments.** Pulses are never announced; meaning arrives as toasts, panel updates and an
  opt-in "Announce live activity" log (R5.4, R5.5). One sentence per page built during a rebuild (R5.4).
- **Magnifier.** Co-registered rects are claimed (R5.1), but in Orbit regime they are perspective-skewed and move when
  the arranger front-slots a panel.
- **Forms, IME, autofill.** Same overlay pattern as the others; screen-aligned on focus (R4.2). Good, with the
  front-slot caveat above.
- **Data-dense tasks.** Matrix, ledger and audit open in Panel mode and match the other proposals' tables
  (virtualised, `aria-rowcount`, TSV copy). Everything else is slower than the DOM app because it starts from a 3D
  scene.
- **Testing.** Weakest of the five on a11y automation.

---

## The minimum a11y requirements the winning spec must add before implementation

These are additive to whichever proposal wins. Items 1 to 6 are blocking; they close failures that no proposal
currently closes.

1. **Forced colours must show the DOM, not a doubled canvas.** When `forced-colors: active`, either drop the canvas
   and render the mirror visibly (Township's Plan mode, Orbit's Plain path, Atelier's Paper mode), or set
   `forced-color-adjust: none` on every transparent-text mirror node and prove with a test that the text is drawn
   once. Add a forced-colours Playwright project that screenshots the ledger and compares text-pixel counts against a
   Plain render.
2. **Single-key shortcuts default off for AT.** Ship all single-character shortcuts disabled until the user turns
   them on in Settings (or activate them only inside an element with `role="application"`-equivalent focus mode
   confirmed by the user), and use modifier chords for the defaults. Document the browse-mode conflict (`G`, `F`, `T`,
   `D`, `H`) in the shortcut sheet. Never bind a single letter in a widget that has typeahead.
3. **A visible, persistent "Motion" control** in the HUD (not buried in Settings) with three states: Full, Reduced,
   Off, defaulting to Reduced when `prefers-reduced-motion` is set or unknown. "Off" must stop all autonomous
   motion (weather, drift, pulses, physics, Lumen idle, parallax), satisfying 2.2.2, and must cut every camera
   transition. Remove dolly-zoom (Township S.3), scroll parallax by default (Orbit B.1, Instrument 5.7), physics
   tumbling and Ctrl+wheel capture (Atelier 1.1) from the default path, or put them behind this control's "Full".
4. **Mirror text is one paragraph, not one span per line.** Real wrapped paragraphs, `<p>` for prose, with the GPU
   following the browser's wrap (Township's order), or an explicit proof that line spans read as continuous sentences
   in NVDA, JAWS and VoiceOver at 100% and 200% text scale. Add a screen-reader reading-order test.
5. **A native focus indicator fallback.** The focus ring must be rendered by the browser (a real CSS `outline` on the
   mirror element, transparent only while the GPU confirms it drew the equivalent that frame) so that device loss,
   a stalled frame or a render-on-demand miss never hides focus. Test: kill the device mid-session and Tab through the
   form.
6. **Dense tables must expose the whole dataset to find and copy.** For every virtualised table of more than 100 rows
   provide an in-widget search that scans all rows (client-side over the columnar store), announces a match count,
   and moves the row cursor, plus "Copy all rows" and "Export CSV" buttons. Document that Ctrl+F covers only the
   window and show a visible "Showing rows 391 to 440 of 912. Use Search to find any row" hint.
7. **Focus must not wait for, or trigger, camera or layout motion.** Focus lands on the element immediately; the rig
   brings it into view in the same frame (cut) when the pose change is larger than a threshold. No panel may move
   in response to focus alone (rejects Constellation R4.2's front slot). Add a test that records the viewport rect
   of every focus stop and asserts it does not change between focus and the next frame.
8. **Rendered-pixel contrast on every refractive, hatched or glass surface**, with the worst case defined: text over
   glass over the busiest desk or sky, text over hatch (ghosts, agent attribution), text under bloom. Adopt
   Instrument's glass minimum tint opacity and sampling with ink hidden (5.8) as the standard.
9. **Target size enforced in projected space.** Every Plat or mirror link over a 3D object (Township city links,
   Orbit overview tiles, Constellation entities) must be at least 24 x 24 CSS px at its current projection or be
   replaced by an equivalent list or Directory entry that the user can reach; define the rule and test it.
10. **Automated regression tests that none of the five has in full.** Combine the best of each:
    - Instrument's keyboard walk (ring visible in rendered pixels, accessible name, Escape exits), and the
      320 px / 200% text reflow assertions;
    - Orbit's 1.4.12 text-spacing bookmarklet and parity (string equality and box tolerance);
    - Township's stalled-painter announcement test and no-ghost-text check;
    - a magnifier proxy: assert that at 2x, 3x and 4x CSS zoom every focus stop remains inside the visual viewport
      with 24 px margin;
    - a forced-colours project and a `prefers-contrast: more` project;
    - NVDA and VoiceOver scripts for the 12 tasks in Orbit 5.9 run at every domain gate and at the demo rehearsal,
      recorded as pass or fail, plus a "follow the rebuild by announcements alone" task (Instrument 5.11).
11. **Announce the rebuild as a summary, not a stream.** One merged sentence per 5 s plus a final summary (Instrument
    5.5), aria-busy on the affected panels during construction, and a way to open the agent activity log by keyboard.
12. **Camera-driven `ui.present` and agent follow are opt-in everywhere,** with a visible control and the Back chip;
    a screen-reader user's idle listening must not count as "idle" (Orbit 6.6 treats 2 s without key or pointer
    input as idle). Use an explicit "Follow agent" toggle only.
13. **`prefers-contrast: more` and `prefers-reduced-transparency`** for every look (only Orbit and Constellation
    mention them).
14. **Trace ranking for daily users:** publish the task-time study (Township R13.1 row 3, Instrument 13.9, Atelier
    R13 row 6) as a gate before cutover, using the 10 routine tasks (find and approve, reconcile the trial balance,
    edit the permission matrix, triage 40 approvals, find a ledger line) on keyboard only and on a screen reader, and
    keep the DOM app as the working surface if any of those is more than 10% slower.

## Ranking (accessibility and daily enterprise use)

1. **Township.** The DOM is the source of layout, scroll, focus outline and text; the GPU paints. Plan mode is first
   paint, forced-colours path and the floor. The interior is DOM-grade for every dense task. Its weaknesses are
   confined to the city and transitions (dolly zoom, ambient city motion without a pause, projected link targets)
   and can be fixed by removing or gating motion, which does not touch the architecture. Add requirements 1 to 3, 9.
2. **Orbit.** The most complete accessibility specification and the strongest explicit contracts (parity, rendered
   contrast, 12-task AT suite, 1.4.12 test, native scroll). It carries the highest ongoing risk of the mirror
   drifting, a camera flight on every route, and the doubled-text forced-colours failure. Add requirements 1 to 7.
3. **Instrument.** The fastest for operators, the best-tested, and the calmest design; held back by custom scroll,
   selection and pointer routing (a class of regressions the browser would otherwise prevent), and by default
   parallax. Add requirements 1, 2, 3 and replace the GPU scroll with a real scroll container.
4. **Atelier.** Sound native architecture and the best "flat focus" idea; held back by physics-driven motion, the
   Ctrl+wheel capture, the metaphor load for daily finance and approval work, glass contrast that is analytic rather
   than measured, and thinner automated a11y tests. Flat focus should be adopted by whichever proposal wins.
5. **Constellation.** The highest cognitive load, perspective panels as default reading surface, focus that moves
   panels, a lossy graph equivalent for AT, and the thinnest test plan. Its Panel mode is good and is also the part
   every other proposal already has.

Combining the strongest parts: Township's DOM-first layout and native outline with Orbit's parity and AT suite,
Instrument's keyboard walk, reflow and glass contrast tests, and Atelier's flat focus, under the fourteen
requirements above.
