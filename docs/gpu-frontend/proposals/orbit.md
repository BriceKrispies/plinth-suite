# Orbit: a spatial workspace for Plinth Suite

Proposal for the GPU frontend round (`docs/gpu-frontend/BRIEF.md`). Codename **Orbit**. Task WG-5532.

Orbit renders the whole Suite as a calm, luminous room you stand inside. The 19 domains sit as **stations** on a
gentle ring around you. Widgets are **physically lit panels** standing at those stations. Moving between routes is a
**camera path**. **Focus mode** brings one widget flat to the camera for dense work. The agent is a visible light, the
**Lumen**, that flies to where it is working, and during the MCP rebuild it weaves panels into place in front of you.

The 3D is bold where it carries meaning and strict where it could cost legibility. Every glyph you read is drawn
unlit, untonemapped and pixel-snapped, in the exact colour of its look token. Every control is a real DOM element in a
semantic mirror that sits glyph-run for glyph-run over the picture, so screen readers, magnifiers, voice control,
native selection, copy, find-in-page, autofill and IME all work on the real thing rather than on a description of it.

---

## Contents

- [A. Reading guide and what changed from the DOM round](#a-reading-guide-and-what-changed-from-the-dom-round)
- [B. The world: spatial model, poses and the legibility contract](#b-the-world-spatial-model-poses-and-the-legibility-contract)
- [Requirement 1. Feature parity](#requirement-1-feature-parity)
- [Requirement 2. WebGPU first, WebGL2 fallback](#requirement-2-webgpu-first-webgl2-fallback)
- [Requirement 3. Text and data density](#requirement-3-text-and-data-density)
- [Requirement 4. Input and forms](#requirement-4-input-and-forms)
- [Requirement 5. Accessibility](#requirement-5-accessibility)
- [Requirement 6. Realtime and the agent](#requirement-6-realtime-and-the-agent)
- [Requirement 7. Performance budgets](#requirement-7-performance-budgets)
- [Requirement 8. Phone](#requirement-8-phone)
- [Requirement 9. Architecture](#requirement-9-architecture)
- [Requirement 10. Looks and theming](#requirement-10-looks-and-theming)
- [Requirement 11. Demo choreography](#requirement-11-demo-choreography)
- [Requirement 12. A plan ordered by dependency](#requirement-12-a-plan-ordered-by-dependency)
- [Requirement 13. Risks and kill criteria](#requirement-13-risks-and-kill-criteria)
- [Appendix S. Shader listings](#appendix-s-shader-listings)
- [Appendix T. Type definitions](#appendix-t-type-definitions)

---

## A. Reading guide and what changed from the DOM round

### A.1 What stays

Everything listed under "What stays" in the brief is consumed unchanged: the 122-action registry over
`POST /suite/actions/:name`, the 17 MCP tools, the `/rt` socket with its `changes` and `domain` streams and `counts`
frames, Page and Widget nodes, the `site.*` actions, the Program node's `appearance`, identity by dev token and
`?as=<handle>`, and the seeded Northwind world. Orbit adds **no** server action. It needs exactly one server-side
touch, which is already half there: the realtime gateway must forward `ui.present` notifications (`pg_notify
('plinth_present', ...)` in `packages/mcp/src/tools.ts`) to target sessions as `ChangeEvent` items with
`kind: "present"` on the `changes` stream. `ChangeEvent.kind` already includes `"present"` in
`packages/spec/src/change.ts`. Section 6.6 specifies the client side and Requirement 12 places the gateway touch in
the dependency order.

### A.2 Lessons from the DOM round, carried in as rules

The previous round (`docs/frontend-competition/SELECTION.md` and the three judge reports) produced specific failures.
Orbit turns each into a rule with a test.

| DOM-round finding | Orbit rule | Where enforced |
|---|---|---|
| Every realtime event reloaded the whole board; the new panel arrived late | An event re-reads only the node or widget it names; layout re-runs only for the affected bay; GPU uploads only dirty instance ranges | 9.6, test `rt-incremental.spec.ts` |
| `try` around the whole frame handler swallowed errors and lost events (Lattice) | `try` wraps `JSON.parse` only; a gap (`prev_through > through`) forces a scoped resync; a frame from a non-current socket is dropped | 9.6 |
| Local time shown against UTC data | Every timestamp is formatted in UTC with the zone printed (`14:30:00 UTC`); mirror uses `<time datetime>` | 3.6, mirror lint |
| "null" and "nullnull" rendered as text | The view-tree `Text` primitive rejects `null`/`undefined` at build time (TypeScript) and at run time renders the widget's error state and logs | 9.3 |
| New bar panels too short; labels collided | Chart primitives declare a minimum content height; the layout engine refuses to give less and the bay grows a row instead; label collision is resolved by tick thinning, then rotation, never overlap | 3.5 |
| Folio's bars did not draw while its SVG description described them | Mirror parity test: every chart's mirror description is generated from the same draw list that the GPU receives; a mark count of zero with non-empty data fails the test | 9.9 |
| Breach was a slightly different grey | Breach is accent + hatch + glyph + a text row ("1 cell over 600 ms: Crane / EMEA 759.9"), in every look | 3.5 |
| Attribution banner was the clearest live cue (Lattice) | The full-width band "Added by agent claude-code · mcp · change 412" sits on the new panel's top edge for 8 s, then retires to a header glyph | 6.3 |
| Announcements did not fire when the render path failed | Announcements are raised from the store layer (the event arrived), not from the render path; render failure produces its own announcement | 5.5 |
| Actor names truncated at wall width | Truncation order: rule chip, then node path, then never the actor | 6.4 |

### A.3 Vocabulary

| Term | Meaning |
|---|---|
| **Atrium** | The whole 3D room: floor, sky, the ring. |
| **Ring** | The circle of stations, divided into six **arcs** that match the nav sections (Personal, Rewards, Engage, Insight, Operate, Admin) plus a seventh **Custom arc** for pages without a nav section. |
| **Station** | One nav page's place on the ring: a flat **bay wall** facing the ring centre, its **lintel** (page header) and its **plinth marker** on the floor (label, icon, count). |
| **Layer** | A non-nav page (product, thread, order, profile, editor) shown as a wall that slides forward in front of its parent station. |
| **Panel** | One Widget instance: a rounded slab with bevel, depth and shadow, whose face carries the widget's UI. |
| **Reading pose** | Camera at rest, square to a bay or a focused panel, so that one world unit maps to one CSS pixel. All dense reading and all editing happen here. |
| **Mirror** | The semantic DOM layer aligned over the canvas (Requirement 5). |
| **HUD** | The screen-space layer: top bar, toasts, palette, focus ring, off-screen indicators. |
| **Lumen** | The agent's visible presence. |
| **Motes** | Small presence markers for other humans' changes. |
| **Threads** | Arcs of light from the station where a change happened to every station it updated. |
| **Trace ring** | The thin luminous band on the atrium floor listing the latest changes, newest in front. |

---

## B. The world: spatial model, poses and the legibility contract

### B.1 The spatial model

```
                         Overview pose (camera above centre, pitch -32 deg)
                                          o
                                         /|\
                Admin arc         .-----' | '-----.        Personal arc
                          .-'  [Set] [Prg]|[Home] [Inbx] '-.
                       .'  [Grnt]         |          [Notf] '.
                     /  [Role]            |             [Task] \
                    | [Mbrs]       inner camera path       [Appr]|
       Operate arc  |[Ledg]        (radius R - d)         [Pts] |  Rewards arc
                    | [Invt]       . - - - - - .          [Awd] |
                     \  [Ordr]   .'      c     '.      [Stor] /
                      '. [Audt]   '.    (*)   .'    [Bdgs] .'
                         '-. [Rprt] ' - - - - '  [Ppl]  .-'
                 Insight arc '-----[Cal][Seg][Aut][Prom][Cont][News]   Engage arc
                                                                 
   (*) = the Lumen's rest position above the floor centre.   c = trace ring on the floor.
```

- The ring is a regular polygon of bay walls, one facet per station, each facing the ring centre. Facets are flat:
  text is never drawn on a curved surface.
- **World unit = one CSS pixel at reading distance.** The camera's vertical field of view is fixed at 40 degrees and
  never animates. The reading distance is `d = (viewportHeightCss / 2) / tan(20 deg)`, which is 1,099 units at an
  800-px-high viewport. A bay wall placed `d` in front of the camera therefore maps 1 unit to 1 CSS pixel. Layout is
  computed in CSS pixels and placed on the wall with no scaling.
- **Facet width** `W = clamp(viewportWidthCss - 2 * 24, 960, 1600)`; the gap between facets is 160 units, which shows
  as dark air with the arc rule running through it. The ring's radius is `R = N * (W + 160) / (2 * pi)` for `N`
  stations. With the 26 seeded nav pages at `W = 1232` (1280-px viewport), `R = 5,760`. The camera's inner path has
  radius `R - d`.
- **Arcs.** Stations are ordered by nav section, then by the order `pages.list` returns within a section. Arc gates
  are 2-degree gaps with a soft floor light labelled with the section name, drawn in the floor shader.
- **Custom arc.** Pages served under `/p/:page` with no nav section sit on the Custom arc between Admin and Personal.
  It exists only when such a page exists.
- **Layers.** A non-nav page attaches to the station whose nav route is the longest path prefix of its route
  (`/store/p/:product` attaches to `/store`; `/people/:handle` to `/people`; `/read/:content` to `/news`;
  `/messages/t/:thread` to `/messages`; `/d/:dashboard` to `/reports`; `/profile` to `home`). A layer wall is placed
  at `d - 220` units from the camera (220 units in front of its parent bay), so the parent remains visible behind it,
  dimmed to 40% and blurred (Requirement 2, pass F6). Back (browser Back, `Esc`, the lintel's back chevron) retracts it.
- **Vertical extent.** A bay wall is as tall as its page's grid (rows of 72 units at the default 16-px root, from
  `SIZE_GRID`'s 4.5 rem rows). Scrolling moves the camera vertically (a crane), so tall pages are walls you rise
  along; panels at different elevations show natural parallax.
- **Elevation.** Panels stand off the wall by their tier: tier 0 (full-width module widgets in heading-rule style) at
  0 units, tier 1 (ordinary widgets) at 12, tier 2 (popovers, drawers) at 40, tier 3 (dialogs) at 90. A panel
  standing `z` units off the wall is `d - z` from the camera, so to keep reading scale exact its model transform is
  scaled by `(d - z) / d`: its projected size at the reading pose is exactly 1:1 while its shadow and parallax still
  read as depth.

### B.2 Camera poses

| Pose | Camera | When | Content fidelity |
|---|---|---|---|
| `overview` | Above the ring centre at height `0.55 R`, pitch -32 deg, yaw towards the current station | `O`, pinch-in on touch, `?view=overview`, logo click, empty site | Bays as impostors (cached 512 x 320 renders), lintel titles and counts in live MSDF |
| `station(bay, scrollY)` | On the inner path facing the bay, at `d` from the wall, height `scrollY + viewportHeight / 2` | Any nav route | Full: every panel live |
| `layer(bay, layerId, scrollY)` | As station, layer wall at `d` | Any non-nav route | Full on the layer; parent dimmed and blurred |
| `focus(panel)` | Panel brought to `d` and squared to the camera; the rest dimmed and blurred | Widget menu "Focus", `F`, `?focus=<widget-slug>`, double-click a panel header, any form opened from a compact size | Full; panel re-laid out at size `full` for the viewport |
| `follow(lumen)` | Chase pose 1.4 `d` behind and 0.2 `d` above the Lumen's target bay | Presenter toggle `Shift+F` during agent work | Full on the target bay |

Poses are values; the rig interpolates between any two (B.4). Only `station`, `layer` and `focus` are **reading
poses**.

### B.3 The legibility contract

These are hard rules for the renderer. Each has a test (Requirement 9.9).

1. **Text is never lit, bloomed, fogged, blurred or tonemapped.** All UI content (text, rules, fills, chart marks,
   icons) renders into a separate UI colour target that is composited over the tonemapped scene (Requirement 2, F7).
   Its colours are the look's tokens, exactly.
2. **The panel face is the token colour.** The face fill is part of the UI layer. Lighting shows on the bevel, rim,
   edge glow, shadow and a bounded sheen (`|delta L| <= 0.015` in OKLCH) that the contrast test includes at its worst
   case. The slab is physically lit; the page you read is not.
3. **Reading poses are 1:1 and pixel-snapped.** At rest in a reading pose the projected scale of a panel's face is 1
   to within 0.1% and its rotation from square is under 0.05 deg; glyph and rule origins snap to the device pixel
   grid. A panel that fails the test (for example during a camera move) is drawn without snapping, and any small-text
   hinted runs switch to MSDF until it is at rest again (3.3).
4. **Data marks are never foreshortened in a reading pose.** Bars, lines, heatmap cells and table cells are drawn on
   the panel plane. No 3D bar charts, no perspective pies. Data-object views that use depth (ledger pillars, hash
   chain, tier stair, permission layers, automation graph) are explanatory, are drawn under an orthographic
   sub-camera inside the panel, and always have a flat view one key away with the same data.
5. **Motion never carries information alone.** Every animated cue (arrival pulse, thread, Lumen flight, weave) has a
   text or glyph equivalent that stays after the motion ends, and a mirror announcement.
6. **No roll, no FOV change, level horizon.** Angular velocity of the camera is capped at 90 deg/s, linear velocity at
   `2.5 d` per second; transits use a critically damped spring so there is no overshoot.

### B.4 Camera paths: route changes are camera moves

A navigation computes a target pose from the route (9.7), then a path:

- **Neighbouring move** (`|delta theta| <= 40 deg`): an arc along the inner path at constant radius, yaw slewing to
  face the target bay, with a dolly back of `0.15 d` at the midpoint so both bays are briefly visible.
- **Far move** (`|delta theta| > 40 deg`): rise towards the overview height (to `0.25 R`), swing around the centre,
  descend to the target. The path is a centripetal Catmull-Rom spline through four control poses.
- **Layer move:** a straight dolly; the layer slides out of the parent wall towards the camera along the wall normal.
- **Focus move:** the camera stays; the panel moves (its transform interpolates to the focus pose) while the
  background dims and the blur ramps.
- **Duration:** `t = 420 ms + 260 ms * |delta theta| / pi`, capped at 900 ms; focus and layer moves are 320 ms.
  Positions follow a critically damped spring with that settle time; orientation follows a slerp on the same
  parameter.
- **Interruptible.** A new navigation during a move retargets from the current pose and velocity. Keyboard focus
  changes that require bringing an off-screen element into view use the same rig (Requirement 5.4).
- **Reduced motion:** no camera travel. The old pose fades to the page background colour and the new pose fades in
  over 160 ms total (an opacity change, not motion). Parallax, ambient light drift and the Lumen's flight are off.
- **First load and deep links** start at the target pose with no move.

### B.5 Light that responds to the look

- The **key light** is a large soft area light (approximated as a spherical light with radius 0.4 `d`) that sits
  above and behind the camera and follows it with a damped lag of 180 ms. As you move, highlights slide across bevels
  and shadows swing softly on the wall: the room responds to where you look.
- The **fill** is the sky's hemisphere (a two-colour gradient from the look).
- **Rim light** traces the top edge of the panel nearest the pointer (desktop) or the focused panel (keyboard),
  a 1.5-px emissive line in the accent at 35% intensity: a pointer-independent "this is live" cue that also serves as
  the visual focus confirmation (the focus ring itself is in the HUD, 5.4).
- The **Lumen** is a real point light: panels near it brighten on their bevels and cast a second, sharper shadow on
  the wall. That is what makes the agent read as present in the room rather than drawn on top of it.

---

## Requirement 1. Feature parity

### 1.1 The model is unchanged: widgets are apps

Each of the 77 catalogue widgets (`WIDGET_CATALOGUE`) is a self-contained module in
`packages/orbit-widgets/src/<domain>/<name>.tsx`. It owns its state, calls only its catalogue actions, listens only
to its catalogue events, switches its own internal views, and interacts with others only through the page bus and
domain events. What changes is the output: a widget returns an **Orbit view tree** (9.3) instead of DOM, and the
runtime projects that tree into both the GPU scene and the semantic mirror. Pages remain Page nodes laying out Widget
nodes on the 12-column grid; nothing about a page is hard-coded in the client. A page becomes a station or a layer
(B.1) by rule, so an agent creating a page creates a station.

Every widget renders at each of its catalogue sizes (`s` compact through `full`), shows loading, empty, error and
unavailable states, and has a focus-mode presentation (size `full`, re-laid out for the viewport). A build check
(`orbit-parity`, 9.9) fails when a catalogue id has no module, when a module's `sizes` differ from the catalogue, or
when a widget calls an action or subscribes to an event its catalogue entry does not list.

### 1.2 The panel: what every widget gets

```
   .--------------------------------------------------------------.   <- rim light (accent, nearest/focused panel)
  /  Ledger                                       912   [...]      \   <- header: title, count, menu (Focus,
 |   -----------------------------------------------------------   |      Refresh, Open as page, Configure,
 |   Date (UTC)      Txn     Type          Memo            Delta   |      Remove from personal page,
 |   22 Nov 14:30    #8812   award         Q4 bonus        +250    |      Flat view, Data view)
 |   22 Nov 14:02    #8807   redemption    Order 1043      −1,200  |
 |   ...                                                           |
  \_______________________________________________________________/   <- bevel: lit by key light and the Lumen
     ~~~~~~~~~ soft analytic shadow on the bay wall ~~~~~~~~~
```

- Header with the config `title` or catalogue title, the count from `ctx.setCount`, and the menu.
- Agent attribution band on the top edge for 8 s after an agent change, then a diamond glyph in the header (6.3).
- States: loading (a shimmer skeleton on first load only; static under reduced motion), empty (`EmptyState` with
  the widget's own copy and primary action), error (`ErrorState` with retry and the `fix_hint` from `ApiError`),
  unavailable (frosted face, lock glyph, "Not available to you: needs points:ledger").
- Overlays (`ctx.openDrawer`, `ctx.openDialog`, `ctx.confirm`) are tier-2 and tier-3 panels that rise in front of
  the panel that opened them and are modal in the mirror (`<dialog>` opened with `showModal()`).

### 1.3 The shell, in the room

| Shell element (UI-MAP 5) | Orbit presentation | Operation and mirror |
|---|---|---|
| Side nav | **The ring itself** plus the **Station dial**: a HUD strip along the bottom edge listing the arcs and stations as icon-and-label chips with count badges, the current one lit; hovering a chip lights the target station's floor marker | Click or Enter navigates (camera path). `[` and `]` previous and next station. `G` then a letter jumps (`G H` home, `G I` inbox, `G A` approvals, `G P` points, `G S` store, and so on). Mirror: `<nav aria-label="Stations">` with one list per arc, `aria-current="page"`; arc headings are disclosure buttons as in DESIGN-SYSTEM 6A. |
| Top bar | HUD strip at the top: product mark, page title, palette trigger, balance chip, inbox, bell, live mark, avatar menu | Mirror `<header>` banner; each control is a real button. |
| Balance chip | Tabular numeral that rolls from old to new balance on `points.posted` for the viewer, with a signed delta that floats up and fades (a static "+250" for 4 s under reduced motion); a thread arrives at the chip from the source station | Click goes to Points. Announces "Balance 12,450 points, up 250, award". |
| Inbox count, bell | Counts from the `counts` frame; the bell popover is a tier-2 HUD panel with the latest 8 notifications, "Mark all read", "Open all" | Roving-focus list in the popover. |
| Live mark | A small ring: solid when `live`, dashed while `connecting`, hollow with the word "Offline" while offline | `role="status"`. |
| Command palette | HUD dialog (Ctrl+K, Cmd+K) with a native input overlay (4.2) and a result list drawn in the HUD; commands, nav pages and `search.global` results ranked together; Enter opens, Ctrl+Enter opens `/search?q=` | Mirror `<dialog>` with a `role="combobox"` input and a `role="listbox"` of results with `aria-activedescendant`. |
| Toasts | HUD stack top-right, at most 4, newest on top; each toast also sends a small light ping to its originating station's floor marker | `role="status"` region; a toast that holds an action stays until dismissed (WCAG 2.2.1). |
| Identity switcher | Avatar menu item listing `dev.principals`, featured first; switching navigates with `?as=` and the atrium cross-fades | Menu with roving focus. |
| Approvals banner | When `approvals_pending > 0` for an approver: a slim accent band under the top bar, "3 approvals wait for you", with Go; the Approvals floor marker pulses once per new request | `role="status"`. |
| Offline banner | HUD band with retry countdown; the ring's arc rules dim to 50% and the trace ring stops advancing | `role="status"`. |
| Session revoked | Full-HUD notice "This tab was signed out" with Reload; the renderer stops after one final frame | Focus moves to the notice; assertive announcement. |
| Trace ring (new) | The last 12 changes as ticks on a floor band in front of the camera: large mono `#412`, actor, node title; newest at the front; agent ticks carry the diamond | `<section aria-label="Recent changes">` with an `<ol>` and a polite live region; `T` opens it as a HUD list. |

### 1.4 Per-domain screens

Default layouts are those of UI-MAP section 2. The table under each domain says where each widget lands, how it is
presented and operated, its 3D treatment, and its mirror semantics. "Station X" means the bay of the nav page X;
sizes and grid positions come from the Page node, never from this document.

Mirror patterns used below: **grid** = `role="grid"` with `aria-rowcount` and `aria-rowindex` and sortable header
buttons with `aria-sort`; **list** = `<ul>` of rows with a roving tabindex; **form** = `<form>` with labelled native
controls; **tabs** = `role="tablist"`; **chart** = `role="img"` with a generated description plus a "Show as table"
`aria-pressed` toggle in the header.

#### 1.4.1 points (Rewards arc: stations Points and Award points; Operate arc: station Ledger)

The Points lintel carries a large tabular balance. The bay wall has a faint engraved scale down its left edge
(lifetime points), purely ambient and `aria-hidden`.

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `points.balance` | Points (l), Home (m), profiles (m), Cart layer (m) | Hero tabular balance, tier pill, progress to next tier ("1,550 to Gold"), "820 expire 31 Dec"; rolls on `points.posted` | The numeral rolls; a thread lands from the cause station | `<section>` with an `<output>`; delta announced |
| `points.ledger` | Points (full) | Virtualized statement, 912 rows for Maya: date (UTC), txn no, type, memo, delta (signed, tabular, decimal-aligned), running balance; filters; opening and closing balances pinned above and below; a row opens the transaction view (entries, lots) inside the widget | Transaction **Data view** (key `D`): a debit and a credit pillar per entry on the panel's orthographic stage, equal heights showing balance, lots as stacked slices labelled with expiry dates; the flat view is the entries table | grid (`aria-rowcount="912"`); transaction view is a `<section>` with an entries table |
| `points.transfer` | Points (m) | Recipient (combobox over `people.directory`), amount with limits shown, memo; confirm view shows "balance after"; done view | The confirm view tilts the panel 3 degrees towards the camera and brightens the rim, a physical "are you sure"; reduced motion uses a heavier border only | form; confirm as an `alertdialog` region |
| `points.award` | Award points (l) | One or many members, category, reason; promotion multipliers and the approval hold threshold shown | A held award leaves a ghost (6.3) | form |
| `points.expiry` | Points (m) | List by date with points and a relative bar | none | list |
| `points.tiers` | Points (l) | Ladder with perks, member counts, the viewer's position | **Tier stair**: shallow steps rising left to right on the ortho stage, the viewer a lit marker on their step, counts engraved; the flat view is the table | table, `aria-current` on the viewer's tier |
| `points.trial-balance` | Ledger (l) | Invariants (debits equal credits, no negative member balance), system account balances, one pass or fail line with glyph per invariant | A pass shows a level beam across the panel; a failure tilts it, with "Out of balance by 40" in text | list of results |
| `points.accounts` | Ledger (full) | All accounts with balances; statement; transaction; reverse (confirm, idempotent) | The same pillar data view as the ledger | grid, nested views |

#### 1.4.2 store (Rewards arc: station Store; Operate arc: stations Orders and Inventory)

Product artwork is the generated artwork of DESIGN-SYSTEM 7, drawn as SDF shapes in the UI layer, so it stays crisp
and follows the look.

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `store.catalog` | Store (full), category layer | Product grid, filters (category, price, in stock, tier), sort, search; add to cart and wishlist in place; product detail inside the widget, or `product.selected`, or the product layer, per `open_in` | Thin tiles that lift 2 units on hover and focus with a contact shadow; out-of-stock tiles are matte with "Out of stock" text | `role="list"` of `article`s; filters as a form |
| `store.product` | Product layer (xl) | Artwork, price, stock, tier gate, add to cart, wishlist, reviews with histogram, write a review | Artwork on a raised plate; histogram flat | `article`; review form |
| `store.featured` | Store (full), product layer (m) | A row of featured products, scrolled horizontally inside the panel | Card lift | list |
| `store.cart` | Cart layer (xl), product layer (m, compact) | Lines with steppers and issues, live quote with promotions, checkout steps: delivery, confirm, placed | On "placed", threads leave the cart for Points, Orders, the bell and the KPIs (6.2) | form per step; `<ol aria-label="Checkout steps">` |
| `store.orders` | Orders layer; Orders station (store-manage) | Own orders, or all for staff; status filters; transitions; detail inside | none | grid |
| `store.order` | Order layer (full) | Lines, promotions, timeline, allowed transitions | none | `article` with an `<ol>` timeline |
| `store.wishlist` | Wishlist layer, Cart layer (m) | Saved products with stock and affordability; move to cart | none | list |
| `store.inventory` | Inventory station (full) | Stock table with low and out filters; restock and correction form | Low rows carry hatch and "Low: 3 left" in text | grid, form |

#### 1.4.3 promotions (Engage arc: station Promotions; layers New promotion and Promotion)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `promotions.list` | Promotions (full) | By status with window, usage bar, pending approvals; create new | The usage bar takes hatch above 80%, with text | grid |
| `promotions.builder` | Promotion layers (full; opens in focus mode) | Eligibility (rule builder and pickers), effects, budget, schedule, stacking, review; save draft; transition; history and diff | The review view states the rule as a readable sentence block | tabs, form, `role="tree"` for rule groups |
| `promotions.simulator` | Promotion layer (l) | Member and sample cart or earn event; applied and rejected with reasons, totals, baseline | Result rows slide in once per run | form, results table |
| `promotions.performance` | Promotions (l), promotion layer (l) | Redemptions, cost, budget, by tier and region, uplift | Flat charts; live counter rolls | chart |
| `promotions.active` | Home (full strip), Store (full strip) | Member-facing banners | Light-box banners: the only faces allowed a gradient, tested for contrast at their worst point | list of `article`s |

#### 1.4.4 badges (Rewards arc: station Badges; also Home and profiles)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `badges.showcase` | Badges (m), profiles (m) | Up to three pinned badges and the earned count; the owner re-picks | Medallions: SDF artwork on a bevelled disc lit by the key light, turning up to 8 degrees towards the pointer (off under reduced motion) | list of images with names |
| `badges.progress` | Badges (m), Home (m), profiles (m) | Rings with what is left ("3 of 5 reviews") | Rings fill on `badge.progress` | `<progress>` with labels |
| `badges.catalog` | Badges (full) | Earned, in progress and locked filters; detail; manual award for managers | Locked medallions are matte with a lock glyph | grid of cards, award form |
| `badges.recent` | Badges (m) | Organisation-wide award ticker | Awards drop in at the top; for the viewer's own award a medallion travels a thread from the Badges marker to the balance chip | list with polite live region |

#### 1.4.5 messaging (Personal arc: station Inbox; layers thread and new message)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `messaging.inbox` | Inbox (l), thread layer (l) | Folders, thread list, search, bulk star, archive and read; selection publishes `thread.selected` | Unread rows: a dot and heavier weight | list with `aria-multiselectable`; folder tabs |
| `messaging.thread` | Inbox (xl), thread layer (xl) | Messages, mentions, attachment metadata, read receipts, reply box | New messages slide in at the bottom | `role="log"` list, reply form |
| `messaging.compose` | New message layer (xl), Group layer (m, collapsed) | Recipients (people and groups), subject, body with @mentions, send | none | form with a recipient combobox |
| `messaging.unread` | Home (s) | Count and the latest three unread threads | none | list |

#### 1.4.6 notifications (Personal arc: station Notifications; Admin arc: station Settings)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `notifications.feed` | Notifications (full), Home (m) | Type filters, mark read, mark all read; rows link to their subjects | Rows drop in; a thread lands on the row from the cause station | list, polite region |
| `notifications.preferences` | Settings (xl) | Type x channel matrix (in-app, email, digest), digest schedule, quiet hours | Flat matrix with sticky headers | `<table>` of checkboxes with row and column headers |
| `notifications.deliveries` | Settings (xl) | Email and digest log with suppression reasons; detail | none | grid |
| `notifications.send` | Any page an admin places it on | Ad-hoc notice to people and groups | none | form |

#### 1.4.7 tasks (Personal arc: station Tasks; layer All tasks)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `tasks.list` | All tasks layer (full), Home (m) | Filters, inline status, detail with comments | none | grid |
| `tasks.board` | Tasks (full) | Kanban by status; cards move by drag, by keyboard (Space lifts, arrows move, Space drops, Esc cancels), or by a "Move to" menu (WCAG 2.5.7) | Lifted cards rise to tier 2 with a deeper shadow; columns are shallow trays | a `<section>` per column with a list; live region: "Task 41 moved to In progress, position 2 of 5" |
| `tasks.quick-add` | Tasks (m) | Title, assignee, due, priority, optional link | none | form |

#### 1.4.8 approvals (Personal arc: station Approvals; also Home and Orders)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `approvals.inbox` | Approvals (full to decide; xl requested), Home (m), Orders (m) | Changes, actions, high-value orders and content reviews in one list; separation-of-duties reasons ("You requested this, so another approver must decide"); item view with diff or detail; approve, reject with reason, withdraw | Each pending item links to its **ghost**, the held change shown as a hatched translucent panel at its target station (6.3); "Show where" flies there. Approving solidifies the ghost live for everyone | list; item view as `article`; decision buttons with confirm |

#### 1.4.9 content (Engage arc: stations News and Content; layers reader, new, edit)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `content.feed` | Home (xl, cards), News (full, list) | Targeted published content, pinned first, reactions inline, reader view inside | Pinned items carry a pin glyph and rest 4 units proud | `role="feed"` of `article`s |
| `content.reader` | Reader layer (xl) | One item rendered from its blocks; reactions | Opens in focus mode; body at 18 px with a 68-character measure | `article` with real headings |
| `content.editor` | New and edit layers (full; always focus mode) | Block editor with side preview, metadata, audience, reviewers, schedule, workflow actions, versions and block diff | Each block is edited through a native overlay (4.4); the diff marks inserted and removed blocks with text markers, not colour alone | form; each block a labelled textarea; diff as a table |
| `content.review-queue` | Content (l) | Items awaiting the viewer's review with diff since last review; approve or request changes | none | list, item view |
| `content.list` | Content (full) | All content by status, type, tag and author, with engagement | none | grid |

#### 1.4.10 people (Engage arc: station People; layers profile, my profile, group)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `people.directory` | People (full, grid), Award points (l, table) | Search, filters (region, tier, group), grid or table | Generated SDF portraits on small lit discs | grid or list |
| `people.profile-card` | Profile layers (l) | Identity, avatar, title, region, tier, groups, roles, message and award actions; edit view for self | Avatar disc lit by the key light | `article`; edit form |
| `people.activity` | Profile layers (xl) | The member's activity timeline | Items drop in | `<ol>` |
| `people.group` | Group layer (xl) | Description, managers, members | none | `article` with member list |
| `people.groups` | People (m) | All groups with membership markers | none | list |
| `people.sessions` | My profile (m), Settings (m) | Own browser and MCP sessions with revoke; the agent's MCP session carries the diamond | A revoked row dissolves | list with confirm |

#### 1.4.11 segments (Engage arc: station Segments; layers new and segment)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `segments.list` | Segments (l) | Live counts and where each segment is used | none | list |
| `segments.builder` | Segment layers (full; focus mode) | Rule builder over member facts, live count, distribution, sample members | **Population field**: the 40 members as discs on the ortho stage; each rule edit lifts matching members 6 units and lights them, so the effect of a condition is visible as it is typed; the count and distribution table are always beside it | form and `role="tree"`; live count in a polite `<output>` |
| `segments.members` | Segments (xl), segment layer (l) | Members matching now | none | list |

#### 1.4.12 automation (Engage arc: station Automations; layers new and automation)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `automation.list` | Automations (full) | Trigger, enabled switch, last run, failures, next fire | Failure counts carry the warning glyph | grid with `role="switch"` |
| `automation.builder` | Automation layers (full; focus mode) | Trigger (event, schedule, metric with query), conditions, steps with per-step forms, limits; dry run, run now, enable | **Step graph**: trigger and steps as linked nodes on the ortho stage; a dry run sends a light pulse through each step and stops, red-hatched, at a failing step with its error text; the step list form stays beside it | form; steps as an `<ol>` |
| `automation.runs` | Automations (full), automation layer (full) | Runs with status filters; run detail with per-step status, retry, cancel | A running row shows a moving step marker (static under reduced motion) | grid, run view |

#### 1.4.13 calendar (Engage arc: station Calendar; also Content and Promotions)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `calendar.month` | Calendar (full) | Month, week and day views of promotion windows, content schedules, cron fires, expiry and due dates; selection publishes `date.selected` | Flat grid; promotion windows as continuous bands across days | `role="grid"` of date cells with `aria-selected` |
| `calendar.agenda` | Calendar (m), Content (l), Promotions (l) | The next N days | none | list under day headings |

#### 1.4.14 reporting (Insight arc: station Reports; also Home and Ledger)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `reporting.suite-kpis` | Home (xl), Reports (full) | Programme figures with 14-day sparklines | Numerals roll on events | list of `<figure>`s |
| `reporting.board` | Reports (full), dashboard layers | A whole Dashboard with its panels; its trace merges into the trace ring while the board is current | Each kernel Panel is a sub-panel on the board panel | region of chart regions |
| `reporting.panel` | Ledger (l), anywhere | An existing Panel by reference; chart, table, inspector | As its visual | chart |
| `reporting.kpi` | anywhere | Figure, delta, sparkline | none | `<figure>` |
| `reporting.bar` | anywhere | Bars with value labels when they fit; clicking a bar publishes `filter.changed` | Flat bars; a selected bar lifts 2 units with a shadow, its length unchanged | chart; each bar a mirror button |
| `reporting.line` | anywhere | Time series; brushing publishes `date.selected` | Translucent brush band | chart; brush by Shift+arrows |
| `reporting.area` | anywhere | Stacked or single area | none | chart |
| `reporting.heatmap` | anywhere | Threshold hatching; breach cells in the accent with glyph and a text row | none | chart; cells navigable as a grid |
| `reporting.scatter` | anywhere | Two measures | none | chart |
| `reporting.table` | anywhere | Sortable, paged | none | grid |

Every reporting visual carries the inspector view and a source and as-of caption in UTC.

#### 1.4.15 audit (Insight arc: station Audit; content edit layer)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `audit.verify` | Audit (s) | Verifies both hash chains, shows heads | **Hash chain**: linked blocks receding into depth on the ortho stage; Verify runs a light down the chain; a break stops it at a split block with "Chain broken at change 3,812" | `role="status"` result text |
| `audit.timeline` | Audit (full) | Change log and domain events merged, filters, undo for undoable changes, hashes | Agent rows carry the diamond; undo previews the prior revision as a ghost | grid |
| `audit.node-history` | Content edit layer (l) | Revisions, diff between any two, undo | Two flat diff columns | list, diff table |

#### 1.4.16 admin (Admin arc: stations Members, Roles, Grants, Programme)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `admin.members` | Members (full) | Members with private fields, roles, status; create, disable, sessions | Column-masked fields show "Hidden" with a mask glyph | grid, forms |
| `admin.roles` | Roles (full) | Roles with members and scopes; propose a membership change (held) | The proposal leaves a ghost | list, role view |
| `admin.matrix` | Roles (full) | Role x permission matrix, agent ceiling, one principal's effective permissions | **Permission layers** (key `D`): three translucent layers (role grants, Maya's effective permissions, the agent ceiling) tilted 20 degrees on the ortho stage; the agent column lights only where all three intersect, which shows why the agent cannot do some things Maya can. The flat matrix is the default, with glyph-plus-text cells | grid with row and column headers; cell text "Granted", "Not granted", "Held for approval" |
| `admin.grants` | Grants (full) | Grant nodes; propose a grant (held, R-GRANT) with `grant.check` counts | The proposed grant as a ghost | grid, form |
| `admin.program` | Programme (full) | Program node editor (tiers, expiry, limits, thresholds, defaults); every change held (R-PROGRAM) | none | form, history |

#### 1.4.17 pages (the Workshop: editing a station in place)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `pages.editor` | `/pages/:page/edit` | The edited page's bay becomes a **blueprint**: the 12-column grid projected on the wall as light lines, every panel labelled with slug and size, panels liftable (tier 2), movable and resizable by pointer or keyboard (arrows move one cell, Shift+arrows resize, Enter drops). The catalogue tray along the bottom lists widgets by domain with their sizes; adding places a ghost in the first free slot. Configure opens a drawer with a form generated from the widget's JSON Schema. Save commits through the kernel change path | The bay tilts back 6 degrees and grid lights rise from the floor; the lintel says "Editing Home · 2 unsaved changes" | `role="grid"` of cells; every panel also has "Move to row, column" and "Size" menu items |

#### 1.4.18 search (a lens, not a station)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `search.results` | `/search?q=` | Grouped results (people, products, content, promotions, automations, segments, orders, tasks, threads, dashboards) with type filters | Opens as a **lens layer** in front of whatever station you are at, so context stays visible behind it; each group header carries its domain's station icon; Enter on a result travels from the lens to that station | grouped lists with headings; result count announced |

#### 1.4.19 settings (Admin arc: station Settings)

| Widget | Where | Presentation and operation | 3D treatment | Mirror |
|---|---|---|---|---|
| `settings.appearance` | Settings (m) | Theme (light, dark, system), density, reduced motion, plus Orbit's viewer preferences: Plan view, Low power, Follow agent by default, single-key shortcuts on or off, text scale 100 to 200% | Each look previewed as a small live atrium thumbnail on the ortho stage | `<fieldset>` radio groups (Lattice graft) |

The site look (`site.appearance.set`, `admin:settings`) belongs to the Program node and is switched by the agent or by
an admin from the palette ("Set site look") or from `admin.program`. Theme, density and motion stay each viewer's own.

Count check: reporting 10, messaging 4, notifications 4, people 6, search 1, points 8, store 8, badges 4,
promotions 5, automation 3, content 5, segments 3, calendar 2, approvals 1, tasks 3, audit 3, admin 5, settings 1,
pages 1: **77**, equal to `WIDGET_IDS.length`.

### 1.5 Cross-widget behaviour (UI-MAP 7) as it plays in the room

| Action | What updates, and how it looks |
|---|---|
| Checkout in `store.cart` | One commit emits `order.placed`, `points.posted`, `stock.changed`, `notification.created` and `cart.updated`. Threads leave the cart for the balance chip, Points, Orders, the bell and the KPIs strip; each lands as a rim pulse on the panel that changed. The balance rolls, the catalogue's stock text updates, the cart count drops. |
| A manager awards in `points.award` | The recipient's tabs: the chip rolls, a ledger row drops in, a toast. The awarder's view shows a mote on the recipient's balance where it is on screen. |
| Selecting a thread in `messaging.inbox` | Bus `thread.selected`; the thread panel cross-fades its content. Bus traffic draws no thread: it is local, not a change. |
| A message arrives | Inbox count, list row, unread panel, toast; a thread from the Lumen (agent sender) or from the Inbox marker (human sender) to the panels that changed. |
| Approving a promotion | The ghost solidifies; threads to Promotions, Calendar and the `promotions.active` strips for eligible members; a toast to the requester. |
| Publishing in `content.editor` | Threads to News, the Home feed, the Content list and the agenda. |
| Brushing `reporting.line` | Bus `date.selected`; linked widgets filter; each states the range in its caption ("Filtered to 1 to 14 Nov UTC"). |
| The agent places a widget on `page:home` | Every open Home sees the Lumen fly to the Home station and weave the panel into its cell (6.5). |
| Revoking a session | The revoked tab dims to the signed-out notice. |

---

## Requirement 2. WebGPU first, WebGL2 fallback

### 2.1 The stack, pinned

| Concern | Choice | Exact version | Why |
|---|---|---|---|
| Renderer | three.js `WebGPURenderer` from `three/webgpu`, shaders in **TSL** (`three/tsl`) | `three@0.180.0` | One shader source compiles to WGSL for the WebGPU backend and to GLSL ES 3.00 for the built-in WebGL2 backend. The fallback is the same renderer, the same materials, the same render graph; we do not maintain two shader dialects. It also gives MRT with per-material outputs (`mrt()`, `material.mrtNode`), `PassNode` post chains, `renderer.compileAsync` for warm-up, and instanced attributes that work on both backends. |
| Layout | Yoga (flexbox) compiled to WebAssembly | `yoga-layout@3.2.1` | Mature, deterministic, fast flex layout for panel internals; tables, grids and charts use Orbit's own layout (3.4) |
| Reactive state | Signals | `@preact/signals-core@1.8.0` | Fine-grained re-render of view trees; no virtual DOM framework in the path |
| Config validation | JSON Schema | `ajv@8.17.1` | Same `widget-schemas` JSON the server serves |
| Runtime SDF for complex scripts | Tiny SDF | `@mapbox/tiny-sdf@2.0.6` | Single-channel SDF of browser-rasterised glyph runs (3.2) |
| Font metrics at build | opentype.js | `opentype.js@1.3.4` | Extracts advances, kerning and `tnum` substitutions into the atlas manifest |
| Atlas generation (build only) | msdf-atlas-gen (C++ CLI) | `msdf-atlas-gen` v1.3, `msdfgen` v1.12 | MTSDF atlases for Inter, JetBrains Mono, Source Serif 4 and the icon set |
| Fonts | Inter 4.1 (variable), JetBrains Mono 2.304, Source Serif 4.005 (folio look) | as listed, OFL | Inter has tabular figures and wide Latin, Greek and Cyrillic coverage |
| Build | Vite, TypeScript | `vite@7.1.5`, `typescript@5.9.2` | Vite is already the workspace's bundler |
| Tests | Vitest, Playwright, axe-core, pixelmatch | `vitest@3.2.4`, `@playwright/test@1.55.0`, `axe-core@4.10.3`, `@axe-core/playwright@4.10.2`, `pixelmatch@7.1.0` | Headless Chromium with WebGPU and WebGL2, visual and a11y checks |

Versions are exact in `package.json` (no ranges) and locked in `pnpm-lock.yaml`. A bump of `three` is a change of its
own that must pass the full visual-regression suite on both backends before it lands.

**Why not raw WebGPU?** Raw WebGPU with hand-written WGSL would give the tightest control, but the WebGL2 fallback
would then be a second renderer with a second shader language. That doubles the surface where text and contrast
guarantees can diverge. **Why not Babylon.js?** Babylon's WebGPU engine is capable, but its GUI and text stack are
not what Orbit needs, its bundle is larger for our use, and TSL's single-source portability to WebGL2 is the deciding
property. **What we take from three.js:** renderer, backends, node materials, MRT, post passes, render targets,
instancing. **What we write ourselves:** text, UI layout and primitives, the mirror, picking, the camera rig, the
render graph's ordering, and every material.

### 2.2 Backend selection and the three paths

```
 boot
  |-- navigator.gpu? --> requestAdapter({ powerPreference }) --> adapter.info.isFallbackAdapter? --yes--> WebGL2 path
  |        |                                   |
  |        no                               requestDevice OK? --no--> WebGL2 path
  |        v                                   v
  |   WebGL2 context with EXT_color_buffer_float?              WebGPU path  (full fidelity)
  |        |yes --> WebGL2 path (full fidelity, see 2.5 deltas)
  |        |no  --> WebGL2 LDR path (no HDR bloom; looks use their LDR variant)
  |   no WebGL2, or a software renderer (UNMASKED_RENDERER contains "SwiftShader" or "llvmpipe"
  |   outside tests), or 3 device losses in one session --> Plain path
  v
 Plain path: no canvas. The mirror becomes the visible interface with the plain stylesheet (2.6).
```

- WebGPU path: Chrome and Edge 113+, Safari 26+, Firefox 141+ on Windows. `powerPreference` is `"high-performance"`
  unless Low power is on (then `"low-power"`).
- `device.lost` is handled: the renderer rebuilds from the scene graph (which is CPU-side truth) and re-uploads
  atlases; the mirror is untouched, so focus and form state survive. A third loss in one session falls to the Plain
  path with a HUD-free notice in the mirror.
- The user can force any path from Settings or with `?render=webgpu|webgl2|plan|plain`, kept in `localStorage`
  inside try/catch.

### 2.3 Render graph

Each frame is the graph below. Everything a pass reads is listed, so the graph is testable pass by pass (9.9).

```
F0  CPU update      rt frames -> stores -> widget signals -> view trees -> layout (dirty bays) -> draw lists
                     -> dirty-range uploads (instanced attributes, panel transform texture)
F1  CPU rig         camera spring, panel transform springs, Lumen path, thread packets -> uniforms
F2  scene pass      target: MSAA x4, MRT { hdr: rgba16float, emissive: rgba16float, ui: rgba8unorm }, depth24plus
                    draw order:
                      a. environment: sky dome (gradient + horizon band), floor (ring rules, arc gates,
                         station markers, trace ring base), analytic shadows from panels onto floor and walls
                      b. bay walls (matte), lintels
                      c. per bay, back to front by tier: panel slab (writes hdr, emissive, and clears ui to 0
                         under its face), then that panel's UI content (writes ui only, depth-tested,
                         depth bias -2 units per tier step), then the panel's ortho-stage data object if any
                      d. ghosts (hatched translucent slabs), Lumen body, threads (additive into hdr + emissive)
F3  resolve         MSAA resolve of all three targets
F4  bloom           emissive only: 5-level dual-filter down/up chain at half resolution; never reads ui
F5  impostors       only when a bay is dirty and overview is visible or imminent: render that bay to its 512x320
                    impostor (ortho, UI layer included) - at most 1 bay per frame
F6  focus blur      only when focus, layer or a modal is up: dual-Kawase blur (4 down, 4 up) of tonemapped
                    scene + composited ui of everything behind the front plane
F7  composite       out = tonemap(hdr + bloom) (AgX; Neutral for meridian and folio), vignette 4%, blue-noise dither;
                    then out = mix(out, ui.rgb, ui.a) with ui in premultiplied form. Text colour is exact.
F8  front plane     focus panel or layer drawn again into a non-MSAA target at the reading pose, pixel-snapped,
                    then composited over F6's blur
F9  HUD             ortho, pixel-snapped: top bar, dial, toasts, palette, banners, focus ring, Lumen off-screen
                    indicator, trace ring list when open
F10 present
```

**Render on demand.** The loop runs only while something is dirty: a camera or panel spring not at rest, a running
animation (arrival, thread, weave, Lumen while the agent is active), an upload, or a resize. A static workspace renders
zero frames per second. Ambient drift (the key light's slow breathing, 0.5% intensity) runs at 20 Hz only when Low
power is off and the tab is visible, and stops entirely under reduced motion.

**Pipeline count.** The whole frontend uses 14 render pipelines plus their WebGL2 programs: environment, wall, slab,
ui-rect, ui-glyph-msdf, ui-glyph-sdf, ui-glyph-bitmap (hinted small text), ghost, lumen, thread, data-object,
bloom-down, bloom-up, composite (blur and impostor reuse these with defines). Uber-shaders with flag bits keep it
there; new widget types never add pipelines.

### 2.4 Signature effects: exact pass placement

| Effect | Passes | Shader | Budget (measured on the reference integrated GPU, 2.7) |
|---|---|---|---|
| Lit panel slab | F2c | `slabMaterial` (S.1): rounded-box SDF bevel normal, GGX on bevel only, rim, Lumen point light, face writes token colour into `ui` | 0.35 ms for 40 panels at 1080p |
| Analytic soft shadows | F2a | `floorMaterial`, `wallMaterial` (S.2): sum of up to 32 rounded-rect penumbra integrals per fragment, from a uniform array of the current bay's panels | 0.30 ms |
| UI content | F2c | `uiRect`, `uiGlyph` (S.3): instanced quads; rounded-rect SDF with stroke, hatch, dash; MSDF median; clip rect discard | 0.9 ms for 30k glyphs and 6k rects |
| Weave (materialisation) | F2c, F2d | `weave` uniforms in `slabMaterial` and `uiRect` (S.4): edge trace from the Lumen's position, then a noise-threshold fill, then row-by-row content reveal | 0.1 ms per weaving panel |
| Threads | F2d, F4 | `threadMaterial` (S.5): instanced ribbon along a quadratic Bezier lifted over the floor; a travelling packet with a Gaussian profile | 0.05 ms per thread, max 24 live |
| Lumen | F2d, F4, and as a light in F2a-c | `lumenMaterial` (S.6): an octahedral core with a soft halo sprite; its position and intensity are a uniform read by slab, wall and floor | 0.08 ms |
| Ghost (held change) | F2d | `ghostMaterial` (S.7): translucent slab, 45-degree hatch in the accent, dashed edge | 0.05 ms per ghost |
| Focus blur | F6 | dual-Kawase | 0.6 ms at 1080p |
| Look sweep | F2a-c, F7 | look uniforms interpolated per fragment by ring angle from a sweeping front (S.8) | 0 extra passes |

### 2.5 WebGL2 deltas

- Instanced attributes and the panel transform `DataTexture` work identically.
- MRT uses `drawBuffers`; MSAA through multisampled renderbuffers with `blitFramebuffer` resolve.
- Without `EXT_color_buffer_float` the HDR target is `rgba8` with a pre-tonemapped scene; bloom is skipped. Looks
  carry an LDR variant (lower rim intensity) so the difference reads as "softer", not "broken".
- `KHR_parallel_shader_compile` is used when present for warm-up without stalls (7.4).
- The hinted small-text path (3.3) is identical.

### 2.6 The Plain path (unsupported browsers)

The mirror is already a complete semantic DOM of every widget with real controls (Requirement 5). On the Plain path
it is made visible with `plain.css`: a single-column, Meridian-derived stylesheet (system font stack, hairline rules,
tabular numerals, the look's palette as CSS custom properties). Tables, forms, menus and dialogs work because they are
native. Charts show their tables. This is not a separate app: it is the same widget code, the same stores, the same
router, with the scene not mounted. It is also how the a11y and interaction suites can run with no GPU at all.

### 2.7 Reference hardware for every budget in this document

| Tier | Reference device | Browser |
|---|---|---|
| Desktop | Windows 11, RTX 3060 12 GB, Ryzen 5 5600X, 2560 x 1440 at DPR 1 | Chrome stable, WebGPU |
| Integrated | Intel Core i5-1235U, Iris Xe, 1920 x 1080 at DPR 1.25; and a MacBook Air M1 8 GB at 2560 x 1600 DPR 2 | Chrome stable WebGPU; Safari 26 WebGPU |
| Phone | iPhone 13 (A15), 390 x 844 at DPR 3; Pixel 7 (Tensor G2), 412 x 915 at DPR 2.625 | Safari 26; Chrome Android |
| Fallback | The integrated tier with `?render=webgl2` | Chrome, Firefox |

---

## Requirement 3. Text and data density

### 3.1 Principles

- Glyphs are **instanced quads** in panel-local coordinates, drawn in the UI layer (B.3 rule 1). There is no
  per-panel texture of text; panels can move, tilt and weave and their text stays sharp at every frame.
- **Three glyph paths, chosen per run:**
  1. **MTSDF atlas** (default): prebuilt for Inter (400, 500, 600, plus 600 italic), JetBrains Mono 400 and 600,
     Source Serif 4 (600, folio only) and the icon set.
  2. **Hinted bitmap** for small text at rest: runs under 14 CSS px at DPR below 2 in a reading pose (3.3).
  3. **Runtime SDF runs** for any script or glyph outside the atlases (CJK, Arabic, Hebrew, Devanagari, Thai,
     emoji): the browser shapes and rasterises the run, Tiny SDF converts it (3.2).
- One layout authority: Orbit's text layout decides line breaks, and the mirror reproduces the same lines (5.2), so
  selection and screen-reader highlight land on what you see.

### 3.2 Fonts, atlases and fallbacks

| Atlas | Content | Format | Size (measured build output target) |
|---|---|---|---|
| `inter-core` | Basic Latin, Latin-1, Latin Extended-A, punctuation, currency, arrows, `▲▼✓–·`, tabular and proportional figures; weights 400 and 600 | MTSDF, em 40 px, pxrange 6, 2048 x 2048, lossless WebP | 1.1 MB |
| `inter-ext` | Latin Extended-B, Greek, Cyrillic; weight 500; 600 italic | MTSDF, 2048 x 2048 | 1.3 MB, lazy |
| `mono` | JetBrains Mono 400 and 600, ASCII plus hex, `#`, arrows | MTSDF, 1024 x 1024 | 0.3 MB |
| `serif` | Source Serif 4 600 (folio display) | MTSDF, 1024 x 1024 | 0.4 MB, lazy, folio only |
| `icons` | The DS icon set (generated from the existing SVG sprite) | MSDF, 1024 x 1024, 48 px cells | 0.25 MB |

- Each atlas has a JSON manifest (glyph id, codepoint, advance, plane bounds, atlas bounds, kerning pairs and `tnum`
  substitution map) produced at build by `packages/orbit-text/scripts/build-atlases.ts` (opentype.js plus the
  msdf-atlas-gen CLI). Manifests are about 120 KB gzipped in total.
- **Fallback chain** per code point: `inter-core` -> `inter-ext` (loaded on first need) -> runtime SDF run. A run is
  split into maximal script-homogeneous segments with `Intl.Segmenter` (grapheme granularity) and a Unicode script
  table; segments whose code points are all in an atlas use it, others go to the runtime path.
- **Runtime SDF runs.** The segment is drawn by `OffscreenCanvas` 2D `fillText` with `font: 400 32px Inter, system-ui,
  "Noto Sans", sans-serif` and `direction` set from the bidi level; the browser does shaping (Arabic joining, Indic
  reordering, CJK), font fallback and emoji. Tiny SDF (buffer 4, radius 8, cutoff 0.25) converts the run to a
  single-channel SDF, which is packed into a 2048 x 2048 `r8unorm` **run cache** page with a skyline packer. Key:
  `(text, fontKey, sizeBucket, direction)`; size buckets 32 and 64 px; LRU eviction at 85% occupancy; at most 2
  pages (8 MB). Emoji keep colour: they are cached as `rgba8` bitmaps at 2x and drawn by the bitmap path.
- **Bidi.** Paragraph direction from the first strong character (or the widget's `dir`); runs are reordered with the
  Unicode Bidi Algorithm implemented in `orbit-text/bidi.ts` (levels and reordering only; shaping stays in the
  browser for complex runs). The mirror carries `dir` attributes so AT reads in logical order.
- **Line breaking:** `Intl.Segmenter` word granularity for break opportunities, hyphenation off, `overflow-wrap:
  anywhere` behaviour for URLs and hashes, ellipsis only where the view tree asks for `truncate` (and the full text
  is always in the mirror and in a tooltip).

### 3.3 Glyph rendering quality

- **MTSDF shading** uses the median of three channels with screen-space range from `fwidth`, plus the true-SDF alpha
  channel to keep corners clean at large sizes (S.3).
- **Pixel snapping** in reading poses: each glyph's origin and each rule's edge snap to the device pixel grid in the
  vertex stage when the panel's `aligned` flag is set (B.3 rule 3).
- **Hinted small text.** MSDF text under 13 CSS px at DPR 1 looks soft next to the browser's hinted text. For runs
  under 14 px at DPR below 2 in an aligned panel, Orbit rasterises the glyphs with `OffscreenCanvas` `fillText` at the
  exact device size into a grayscale coverage atlas (`r8unorm`, 1024 x 1024 per size, keyed by font, weight, size,
  subpixel x offset in quarter pixels) and draws them with the bitmap pipeline. During motion those runs switch to
  MTSDF; the swap happens on the first frame at rest and is part of the visual-regression set. At DPR 2 and above,
  MTSDF is used everywhere.
- **Gamma.** Coverage is applied in linear space with a contrast boost exponent of 1/1.25 for dark-on-light and 1.0
  for light-on-dark, which matches the stem weight of the browser's own text within 3% in the comparison test (9.9).
- **Minimum sizes.** Body 14 px (compact 13 px), table cells 13 px (compact 12 px), captions 12 px; nothing smaller.
  Text scale (5.7) multiplies all of them.

### 3.4 Numerals and data formatting

- Numbers in tables, statements, KPIs, counts and the balance chip use **tabular lining figures** (Inter `tnum`
  substitutions from the manifest); columns of numbers are right-aligned and decimal-aligned on the decimal separator
  (or the units digit when there is none).
- Grouping and signs come from `Intl.NumberFormat` in the viewer's locale; signed deltas use a true minus `−` and a
  plus `+`, never colour alone; points carry no decimals.
- Times: `Intl.DateTimeFormat` with `timeZone: "UTC"` and the zone printed (`14:30:00 UTC`); the mirror wraps each in
  `<time datetime="2026-11-22T14:30:00Z">`. A footer line on every bay reads "Times are UTC" (Nocturne graft).
- Hashes and seq numbers use JetBrains Mono; seq always reads "Change #412" in the mirror (Meridian graft).

### 3.5 Tables, grids and charts at density

**The 912-row ledger.**

- Data: `points.statement` pages of 100 rows are fetched as the viewport approaches them (prefetch one page ahead);
  rows are kept in a columnar store in the widget (typed arrays for numbers, interned strings).
- Layout: Orbit's `Table` primitive is not Yoga. Column widths are computed once per data page from measured content
  (advance sums from the manifest; no DOM measuring), with min and max per column type; row height is fixed (32 px
  comfortable, 26 px compact, multiplied by text scale).
- Virtualisation: only the visible rows plus 12 overscan rows on each side are laid out and instanced: about 52 rows
  x 6 columns x about 14 glyphs = about 4,400 glyph instances for the ledger. Scrolling is a change of the table's
  scroll offset uniform plus an instance-range rebuild when a row enters or leaves the window. Sticky header and the
  pinned opening and closing balance rows are separate instance ranges that do not scroll.
- Measured-style target on the integrated tier: scrolling the ledger at 60 fps with p95 CPU frame time under 4 ms and
  no frame over 16.7 ms; re-sort of 912 rows by any column under 6 ms CPU.
- Mirror: `role="grid"` with `aria-rowcount="912"` and only the visible rows present (with `aria-rowindex`), so the
  mirror stays small and screen-reader table navigation (Ctrl+Alt+arrows in NVDA and VoiceOver) works; arrow keys move
  the active cell and scroll the table; Home, End, PageUp, PageDown, Ctrl+Home and Ctrl+End are implemented.

**The permission matrix** (7 roles plus the agent ceiling, about 60 permissions).

- Laid out as a grid with a sticky first column (permission names, grouped by domain with group headings) and a
  sticky header row (role names, rotated 0 degrees: they wrap to two lines rather than rotate).
- Cells hold a glyph and a word in compact form (`✓ Granted`, `– No`, `◐ Held`), so the matrix never depends on colour.
- The agent column is separated by a 2-px accent rule and titled "Agent (ceiling ∩ Maya)".
- Hovering or focusing a cell highlights its row and column (UI layer bands, 6% accent) and shows the grant source
  in a tooltip that is also the cell's `aria-describedby`.
- At 1280 x 800 the whole matrix is visible in focus mode at 13 px with 28-px rows; on a phone it scrolls in both axes
  with both headers sticky.

**Charts.**

- Charts are draw lists of rects, polylines (as SDF segments) and glyphs inside the panel, so they get the same
  sharpness and exact colours as text.
- Every chart type declares a minimum content height that fits its axis and category labels (bar: 160 px plus 18 px
  per category row beyond 6; line and area: 140 px; heatmap: 18 px per row plus labels). If a layout cell is shorter,
  the layout engine extends the panel and the bay grows a row (the Page node is untouched; the client lays out more
  rows). Labels never collide: tick thinning, then two-line wrapping, then 45-degree rotation; value labels on bars
  when they fit inside or above the bar.
- Breach: accent fill + 45-degree hatch + `▲` glyph on the mark + a text row under the chart ("1 cell over 600 ms:
  Crane / EMEA 759.9") + the panel header flag "▲ 1 over limit" (Strata graft).

### 3.6 Where 3D helps comprehension, and where it is not allowed

3D is used where depth, position or light carries a relationship that flat layout cannot show as directly:

| Use | What depth or light shows |
|---|---|
| The ring and stations | Spatial memory: each domain has a place; you know where Approvals is relative to Store |
| Threads | Causality across domains: one checkout touched five places |
| The Lumen | Agency: who is acting, and where, right now |
| Ghosts | Pending state: this change exists but is not real yet |
| Ledger pillars | Double entry: every transaction balances |
| Hash chain | Integrity: each change is linked to the last; a break is a physical gap |
| Tier stair | Ordinal progression and the viewer's position |
| Permission layers | Intersection: why the agent may do less than Maya |
| Automation step graph | Flow: where a run is and where it failed |
| Population field | Set membership as a rule is edited |

3D is **not** used for: bar, line, area, scatter, heatmap and KPI marks; tables; forms; long-form text; the calendar.
Data objects live on an orthographic stage inside the panel (no perspective distortion of magnitudes) and always have
a flat view with the same data one key away (`D` toggles; the mirror always exposes the flat view's table).

---

## Requirement 4. Input and forms

### 4.1 The principle: native controls, GPU chrome

Every input control is a **native element in the mirror** (`<input>`, `<textarea>`, `<select>`, `<button>`,
`<input type="checkbox">`, `<input type="date">` where the platform picker is acceptable). The mirror is aligned over
the canvas (5.2), so the native element sits exactly where its GPU chrome is drawn. The GPU draws the field's box,
label, border, placeholder, validation state and, when the field is not focused, its value. The native element draws
the caret, selection, IME composition, spell-check underline and autofill, and, while focused, the value text.

This gives, with no emulation: IME (Japanese, Chinese, Korean composition windows positioned by the OS at the real
caret), dead keys, selection by mouse and keyboard, copy, cut, paste, undo within the field, spell check, password
managers, autofill, voice dictation, on-screen keyboards with the right `inputmode`, and every screen reader's
editing commands.

### 4.2 Overlay positioning and synchronisation

- Each panel has a mirror container `div.m-panel` with `position: absolute; left: 0; top: 0; width: Wpx; height:
  Hpx; transform-origin: 0 0; transform: matrix3d(...)`. The matrix is `viewport * projection * view * panelModel`,
  converted to CSS pixel space (the same technique as three.js's `CSS3DRenderer`). Children are placed at their layout
  coordinates in panel-local CSS pixels with plain `left`/`top`.
- During camera or panel motion only the panel containers' transforms change: at most 64 style writes per frame,
  batched in one `requestAnimationFrame` callback **after** the GPU frame's matrices are final, so the overlay and the
  picture are from the same pose. Measured target: overlay drift against the GPU chrome under 0.5 CSS px at rest and
  under 1.5 px in motion on the integrated tier (test in 9.9).
- A focused text field's element switches from `color: transparent` to the token ink colour, `caret-color` to the
  accent, `background: transparent`, `font` to the same Inter file (loaded as a `@font-face` from the same woff2 the
  atlas was built from), same size, weight, letter spacing and line height as the GPU run; the GPU stops drawing that
  field's value for as long as it is focused. On blur the GPU resumes. Because both use the same font file and Orbit
  places the run at the browser's own baseline (measured once per font and size with `measureText`
  `fontBoundingBoxAscent`), the hand-over shows no shift in the comparison test.
- Fields are only editable in a reading pose. If the camera starts a move while a field has focus (for example a
  `ui.present` arrives), the move is deferred (6.6) rather than tearing the user away mid-edit.

### 4.3 Forms

- Each widget form is a real `<form>` in the mirror with `novalidate` (Orbit shows errors itself) and native
  `autocomplete` tokens (`name`, `email`, `off` for amounts and memos).
- **Autofill:** a CSS animation on `:autofill` (and `:-webkit-autofill`) fires `animationstart`; Orbit listens and
  tints the GPU field chrome with the look's autofill tint, and reads the filled value into the widget's signal.
- **Validation:** client-side from the action's JSON Schema with ajv, then server-side through `ApiError`.
  `formErrors(error)` maps `error.path` to the field exactly as UI-MAP 4.3 specifies. An invalid field gets
  `aria-invalid="true"` and `aria-describedby` pointing to its mirror error text; the GPU draws the error text under
  the field with a `!` glyph in the danger token, and the field border at 2 px. On submit with errors, focus moves to
  the first invalid field and a summary is announced ("2 fields need attention: amount, recipient").
- **Idempotency:** one `idempotencyKey(prefix)` per user intent, created when the form opens and renewed only after
  success or an explicit edit after failure.
- **Confirm steps** (`points.transfer`, `ledger.reverse`, `orders.transition`, `site.clear` from the palette) are
  `alertdialog` regions with the consequence spelled out ("Balance after: 11,200").
- **Pickers.** Combobox (people, products, groups, segments) is a native input with a GPU-drawn listbox; the mirror
  holds `role="listbox"` with `aria-activedescendant`. Date fields use native `<input type="date">` overlays (the
  platform picker), with a GPU-drawn calendar grid as an alternative inside `calendar.*` widgets.
- **Rule builders** (promotions, segments, automation conditions) are trees of native selects and inputs grouped in
  `fieldset`s with `role="tree"` semantics for the group structure; "Add condition" and "Add group" are buttons.

### 4.4 Long-form and block editing

`content.editor` always opens in focus mode, so its panel is screen-aligned and the overlay is pixel-exact. Each
block is a native `<textarea>` (auto-height) with inline marks (bold, italic, link) applied through toolbar buttons
and `Ctrl+B`, `Ctrl+I`, `Ctrl+K`, stored as the content node's block marks. While a block has focus, the native
textarea is the renderer of its text; the GPU draws the block chrome, the drag handle and the preview column. This is
a deliberate choice: long-form editing is where the browser's text engine (selection by word and line, IME, spell
check, accessibility) is irreplaceable, so Orbit does not imitate it.

### 4.5 Selection and copy outside fields

In a reading pose the mirror's text layer takes pointer events (`pointer-events: auto` on `.m-text`), so a drag
selects real DOM text: the browser draws the selection highlight with `::selection { background: var(--sel) }` on
transparent text, aligned over the GPU glyphs, and `Ctrl+C` copies exactly what is shown. Find in page (`Ctrl+F`)
works the same way: the browser highlights matches over the canvas. Tables copy as tab-separated rows through a
`copy` handler on the grid (the selection's rows, in display order). During motion `pointer-events` on the text layer
are off and picking goes through the scene (9.5).

### 4.6 Keyboard shortcuts

| Keys | Action | Scope |
|---|---|---|
| Ctrl+K, Cmd+K | Command palette | global |
| `/` | Palette in search mode | global, single key (can be turned off) |
| `G` then a letter | Go to a station | global, single key sequence (can be turned off or remapped) |
| `[` `]` | Previous, next station | global, single key (can be turned off) |
| `O` | Overview | global, single key (can be turned off) |
| `F` | Focus the widget containing focus; again to unfocus | global, single key (can be turned off) |
| Esc | Close the top overlay, then leave focus mode, then leave a layer | global |
| `D` | Toggle Data view and Flat view on a widget that has one | widget |
| `T` | Open the trace list | global, single key (can be turned off) |
| Shift+F | Follow the agent | global |
| `?` | Shortcut help (a HUD dialog listing everything here) | global |
| F6, Shift+F6 | Cycle landmarks: top bar, station dial, main bay, trace | global |
| Ctrl+Enter | Submit the focused form | form |

Single-key shortcuts are inactive while focus is in a text field and can be turned off or remapped in Settings
(WCAG 2.1.4). Shortcuts are advertised in the mirror with `aria-keyshortcuts`.

---

## Requirement 5. Accessibility

Orbit is designed so that its accessibility layer is not a description of the canvas but the interface itself,
placed under the picture. The target is WCAG 2.2 AA in every look, theme, density and render path.

### 5.1 The mirror: one tree, two projections

Widgets build an **Orbit view tree** (9.3). The reconciler projects each view node into:

1. **scene instances** (rects, glyphs, data objects) in the panel's draw list, and
2. a **mirror node**: a real DOM element with the right element type, role, name, state and text.

The mirror is not generated after the fact from the scene; both are generated from the same node in the same pass,
which is what makes them agree (the parity test in 9.9 checks it).

```
 view node  Button { label: "Approve", tone: "primary", onPress }
   |-- scene: Rect(box, radius 6, fill accent) + Glyphs("Approve") + focus anchor
   '-- mirror: <button type="button" id="m-approvals-inbox-7-approve" data-scene="s:9312">Approve</button>
```

Mirror data structures are in Appendix T (`MirrorNode`, `MirrorPatch`). Rules:

- **Landmarks:** `<header>` (top bar), `<nav aria-label="Stations">` (the dial and ring), `<main aria-labelledby=
  "bay-title">` (the current station or layer; other stations are present as `inert` containers so they are not in
  the tab order or reading order), `<aside aria-label="Agent">` (the Lumen's activity log), `<section
  aria-label="Recent changes">` (trace).
- **Headings:** `h1` is the station or layer title (from the lintel); each widget panel is a `<section
  aria-labelledby>` with an `h2` from its header; internal views use `h3`.
- **Names and states** come from the view tree: `aria-pressed`, `aria-expanded`, `aria-selected`, `aria-current`,
  `aria-invalid`, `aria-busy` (first load only), `aria-sort`, `aria-describedby` for errors and tooltips.
- **Charts:** `role="img"` with a description generated from the same draw list that the GPU receives (highest and
  lowest values, breaches in words, series count) and a "Show as table" `aria-pressed` toggle that swaps the mirror to
  a real `<table>` with caption and `scope` (and the GPU to the table view).
- **3D objects** (pillars, chain, stair, layers, step graph, population field) are `aria-hidden`; their flat view is
  always present in the mirror.
- **Ambient scenery** (sky, floor, ring rules, threads, ghosts' hatch, the Lumen's body) is not in the mirror;
  everything they mean is in text elsewhere (6.3, 6.4).
- **No null text:** the `Text` primitive's type forbids `null` and `undefined`; an empty value renders an explicit
  fallback ("No title") or nothing, decided by the widget.

### 5.2 Alignment: the mirror sits under the picture

- Each mirror panel container carries the panel's `matrix3d` (4.2), and each text line is its own absolutely
  positioned `span` at the line box Orbit's layout computed, with the same font file, size and letter spacing. The
  browser's text and Orbit's glyphs therefore overlap within a fraction of a pixel.
- This alignment is what lets assistive technology that works on screen geometry behave: screen-reader focus
  highlights (NVDA, VoiceOver cursor), screen magnifiers that follow focus and caret (ZoomText, Windows Magnifier,
  macOS Zoom), voice control ("click Approve" in Voice Control, Dragon), switch access scanning, browser find and
  native selection.
- `pointer-events` policy: in reading poses the mirror receives pointer events (so links are real `<a href>` and
  middle-click, "Open in new tab" and "Copy link" work, and hover tooltips are native), and the scene receives the
  pointer only where no mirror element is hit (wall, floor, 3D objects). In motion and in overview the mirror is
  `pointer-events: none` and the scene picks.
- The mirror is visible on demand: `Alt+Shift+M` toggles a debug tint that outlines every mirror box over the canvas,
  used in development and in the demo (Requirement 11).

### 5.3 Keyboard operation

- DOM focus is the single source of truth. The scene observes `focusin` and `focusout` on the mirror and draws the
  focus ring (5.4); it never keeps a focus of its own.
- Tab order is the mirror's DOM order, which is the reading order: lintel actions, then panels in grid `(y, x)`
  order, then within a panel in view-tree order.
- Composite widgets use roving tabindex (lists, menus, tabs, toolbars, the station dial) or
  `aria-activedescendant` (comboboxes, grids), with arrows, Home and End, PageUp and PageDown and typeahead.
- Dialogs and drawers use native `<dialog>` with `showModal()` (focus trap and `Esc` for free), focus their heading on
  open and restore focus to the opener on close. A dialog that live-updates keeps focus where it was (Meridian
  inspector `refresh()` graft).
- Every pointer interaction has a keyboard path: drag in `tasks.board` and `pages.editor` has keyboard and menu
  alternatives (WCAG 2.5.7); the Data views are toggled by `D`; brushing on `reporting.line` by Shift+arrows; overview
  stations are buttons in the dial.
- Moving focus to an element in another station (by Tab from the last element of the bay, which moves to the station
  dial, never silently to another bay) or by a search result moves the camera there first and then focuses.

### 5.4 Focus visibility (WCAG 2.4.7, 2.4.11, 2.4.13 as a goal)

- The **focus ring** is drawn in the HUD pass (F9), on top of everything, as a 3-px ring in the look's `--focus`
  token with a 1-px contrasting inner halo, following the projected rounded rectangle of the focused element. Its
  contrast against both the panel face and the wall is at least 3:1 in every look (tested).
- Focus is never obscured (2.4.11): when an element receives focus, the camera rig ensures its projected box is inside
  the safe area (not under the top bar, dial, toasts or the trace ring); if it is not, the bay scrolls (camera crane)
  just enough, with the reduced-motion rule applying.
- The rim light on the focused panel is a secondary cue, not the indicator.

### 5.5 Announcements

- Two live regions at the top of the mirror body: `#announce-polite` (`role="status"`) and `#announce-assertive`
  (`role="alert"`, used only for session revoked, offline after being live, and destructive confirmations).
- Announcer: debounced at 250 ms, clears then sets on the next frame so repeated messages repeat (Strata, Folio
  grafts), and merges bursts ("3 new notifications").
- Announcements are raised from the **store layer** when the event is accepted, not from the render path. If the
  render fails, the widget error state adds its own announcement.
- Wording (Folio and Lattice grafts):
  - "Panel added: Points balance, on Home, by agent claude-code, change 412."
  - "Page built: Store, by agent claude-code, change 418. 3 widgets."
  - "Held for approval: new promotion Spring Double, requested by agent claude-code for Maya Ortiz."
  - "Agent is presenting: Promotions performance. Press G then P to go there." (when the camera does not follow)
  - "Balance 12,450 points, up 250, award."
  - "Moved to Store." (after a camera navigation, from the router, with the new `h1` focused per UI-MAP 3.2)
- Backfill (the last 8 changes loaded at boot) is never announced; `aria-busy` on the trace list is released on the
  first live frame or after 3 s, whichever comes first (Lattice weakness fixed).

### 5.6 Reduced motion and other user preferences

| Preference | Source | Orbit behaviour |
|---|---|---|
| Reduced motion | `prefers-reduced-motion: reduce`, or the viewer's preference | Camera moves become 160-ms fades; no parallax; no ambient drift; Lumen appears at its target instead of flying, with a static beam to the panel; threads are replaced by a 1.2-s static highlight at origin and destination; weave becomes a 200-ms fade per panel; rolling numerals jump; card tilt and medallion turn off |
| Reduced transparency | `prefers-reduced-transparency` | Ghosts become opaque hatched outlines; blur behind layers becomes a solid dim |
| More contrast | `prefers-contrast: more` | Looks switch to their high-contrast variant: rules 2 px, muted ink raised to 7:1, shadows off, bevel and rim off |
| Forced colours | `forced-colors: active` | The **System** look: unlit, flat, no shadows, no bloom. Colours are read at run time from probe elements in the mirror with `background: Canvas; color: CanvasText`, `Highlight`, `HighlightText`, `LinkText`, `ButtonFace`, `ButtonText`, `GrayText` (computed styles give the actual RGB), and the GPU uses those values. The mirror's own native controls already follow forced colours |
| Light, dark | viewer preference, `prefers-color-scheme` | Each look has both variants |
| Low power | Settings, or battery saver signals (7.6) | Plan view or reduced fidelity |
| Pause live motion | HUD control in the trace section, and `Shift+P` | Stops ambient drift, threads and the trace ring's advance; content still updates (WCAG 2.2.2) |

Flashing: no effect flashes more than twice per second, and arrival pulses change luminance by under 10% over under
25% of the viewport (WCAG 2.3.1).

### 5.7 Zoom, text scaling and reflow

- **Browser zoom** changes CSS pixel size and DPR; Orbit re-derives the reading distance and facet width from the new
  CSS viewport and re-lays out. At 200% zoom on a 1280-px window the CSS viewport is 640 px wide and Orbit switches to
  the narrow layout of Requirement 8 automatically (reflow, WCAG 1.4.10, at 320 CSS px works the same way).
- **Text size:** the root font size of the mirror (the user's browser default, read from a probe `rem`) and Orbit's
  own text scale (100 to 200%) multiply every type size, row height and control height. Panels grow; the bay grows
  rows; nothing truncates that was not truncated at 100% except where marked, and the full text is always in the
  mirror.
- **Text spacing (WCAG 1.4.12):** a probe element `.m-text-probe` in the mirror is measured on every layout pass for
  `line-height`, `letter-spacing`, `word-spacing` and paragraph spacing. A user stylesheet or bookmarklet that sets
  `line-height: 1.5`, `letter-spacing: 0.12em`, `word-spacing: 0.16em` and paragraph spacing `2em` on all elements
  changes the probe, and Orbit's layout applies the same values to its GPU text. The 1.4.12 bookmarklet test is part
  of the a11y suite.
- **Target size (WCAG 2.5.8):** every interactive element's projected box at the reading pose is at least 24 x 24
  CSS px, enforced by the primitives' minimum sizes and checked in the parity test.

### 5.8 Contrast in every look

Contrast is measured on **rendered pixels**, not only on tokens, because lighting could otherwise move it.

- Body text, muted text, accent text, pill text, error text and placeholder against the panel face at its worst sheen
  point: at least 4.5:1 (body text targets 7:1). Large text (24 px and up, or 18.7 px bold): at least 3:1.
- Non-text contrast (WCAG 1.4.11): field borders, focus ring, chart marks against their neighbours, table rules that
  carry structure, toggle states: at least 3:1.
- The test renders a contrast scene per look x theme x density (a station with every primitive) on both backends,
  samples the pixels inside each glyph's bounds and just outside them, and computes the ratio. A failure blocks.

Token pairs for the six looks (OKLCH; ratios are the computed values the CI asserts as minimums):

| Look / theme | Panel face | Ink (body) | Ink-3 (muted) | Accent (as text) | Body ratio | Muted ratio |
|---|---|---|---|---|---|---|
| calm light | `oklch(0.985 0.004 95)` | `oklch(0.24 0.01 260)` | `oklch(0.50 0.01 260)` | `oklch(0.50 0.13 250)` | 15.5:1 | 5.6:1 |
| calm dark | `oklch(0.22 0.008 260)` | `oklch(0.95 0.005 95)` | `oklch(0.72 0.01 260)` | `oklch(0.78 0.11 250)` | 14.8:1 | 6.8:1 |
| meridian light | `oklch(0.99 0.002 90)` | `oklch(0.18 0 0)` | `oklch(0.48 0 0)` | `oklch(0.52 0.19 33)` | 18.0:1 | 6.3:1 |
| meridian dark | `oklch(0.19 0 0)` | `oklch(0.96 0 0)` | `oklch(0.73 0 0)` | `oklch(0.72 0.16 33)` | 16.4:1 | 7.4:1 |
| nocturne dark (default) | `oklch(0.20 0.02 255)` | `oklch(0.94 0.01 230)` | `oklch(0.74 0.02 230)` | `oklch(0.82 0.11 200)` | 14.6:1 | 7.4:1 |
| nocturne light | `oklch(0.97 0.006 240)` | `oklch(0.22 0.02 255)` | `oklch(0.49 0.02 255)` | `oklch(0.48 0.10 210)` | 15.0:1 | 6.0:1 |
| folio light | `oklch(0.975 0.012 85)` | `oklch(0.23 0.02 60)` | `oklch(0.49 0.02 60)` | `oklch(0.50 0.15 30)` | 15.0:1 | 5.9:1 |
| folio dark | `oklch(0.21 0.012 60)` | `oklch(0.94 0.012 85)` | `oklch(0.72 0.015 85)` | `oklch(0.76 0.12 40)` | 14.9:1 | 6.9:1 |
| lattice light | `oklch(0.99 0.003 250)` | `oklch(0.25 0.02 255)` | `oklch(0.50 0.02 255)` | `oklch(0.50 0.17 258)` | 15.0:1 | 5.6:1 |
| lattice dark | `oklch(0.22 0.015 255)` | `oklch(0.95 0.005 250)` | `oklch(0.72 0.015 250)` | `oklch(0.76 0.12 258)` | 14.7:1 | 6.8:1 |
| strata light | `oklch(0.98 0.008 70)` | `oklch(0.24 0.02 40)` | `oklch(0.50 0.02 40)` | `oklch(0.52 0.14 45)` | 15.3:1 | 5.6:1 |
| strata dark | `oklch(0.22 0.015 40)` | `oklch(0.95 0.008 70)` | `oklch(0.73 0.015 70)` | `oklch(0.78 0.11 55)` | 14.6:1 | 7.0:1 |

(Ratios derive from relative luminance `Y ≈ L³` for these near-achromatic values; the rendered-pixel test is the
authority and runs with the worst-case sheen applied.)

### 5.9 Test obligations for accessibility

- axe-core on the mirror for every default page, every identity of UI-MAP 6 acceptance, every look x theme, on the
  WebGPU, WebGL2 and Plain paths: zero serious or critical violations.
- Parity test (9.9): every interactive mirror element has a GPU counterpart whose projected box matches within 2 CSS
  px; every visible GPU text run has its text in the mirror.
- Scripted screen-reader task suite with NVDA 2025.x on Windows Chrome and VoiceOver on macOS Safari: 12 tasks
  (navigate to Points by the dial; read the ledger's first five rows; transfer points with a validation error and
  fix it; approve a held promotion; find a member by search; open a thread and reply; move a task on the board by
  keyboard; switch theme; read a chart as a table; follow the announcement of an agent-built panel; open the bell
  popover and mark all read; complete checkout). All must complete.
- Keyboard-only suite in Playwright (no pointer events) for the same 12 tasks.

---

## Requirement 6. Realtime and the agent

### 6.1 From frames to the room

```
 /rt socket (one, two subscriptions)
   s1 changes  -> ChangeEvent { seq, kind: change|present|event, node, rev, surface, actor, on_behalf_of, ... }
   s2 domain   -> DomainEvent { seq, type, actor, on_behalf_of, surface, subject, cause, payload }
   counts      -> NavCounts
        |
        v
 orbit-client/rt.ts  (try only around JSON.parse; gap -> scoped resync; non-current socket frames dropped;
                      resume each stream from its last seq in sessionStorage; backoff 1, 2, 4, 8 s)
        |
        +--> stores (meStore, countsStore, navStore, pagesStore, presenceStore, traceStore)
        +--> widget scoped rt views (ctx.rt.on / onChange / onNode)
        '--> choreographer (orbit-shell/choreo.ts): decides threads, pulses, Lumen moves, ghosts, toasts
```

The **choreographer** is a pure function from `(event batch, scene index, viewer prefs)` to a list of **cues**
(`Thread`, `RimPulse`, `RowGlow`, `LumenMove`, `Weave`, `Unweave`, `Ghost`, `Solidify`, `Toast`, `Announce`,
`TraceTick`, `MoteAt`). It is tested without a GPU: given a recorded batch, it must produce a given cue list.

### 6.2 Live changes

- **Arrival in a panel:** the widget updates its own state (re-read through its action, or in place from the payload
  when it carries everything, as UI-MAP 4.3 rule 3). The view-tree diff marks the changed nodes; the runtime adds a
  `RowGlow` (a 6% accent band in the UI layer that fades over 1.2 s; under reduced motion it stays 8 s, static) and a
  `RimPulse` (a light that runs once around the panel's bevel, 600 ms). First loads never animate.
- **Threads:** events in one batch that share a `cause` form one causal group. The origin is the panel that made the
  call when it is in this tab, the Lumen when the actor is an agent, the station of the first event's domain
  otherwise. A thread runs from the origin to every panel on screen (or the floor marker of every off-screen station)
  whose widget changed in response. Threads lift over the floor in a gentle arc (apex 0.12 `R`), carry a light packet
  that travels in 700 ms, and land with the rim pulse. At most 24 live; beyond that they merge per destination
  station. Threads are additive light in the HDR and emissive targets and never cross the UI layer.
- **Counts:** the HUD count badges change with a 150-ms scale bump (none under reduced motion); the floor marker of the
  station that owns a count shows the same number in overview.
- **Toasts:** per UI-MAP 5 Toasts, at most 4. Each toast's left edge carries the origin station's icon and a short
  ping travels on the floor to that station's marker.
- **Node changes to pages:** a change on a Page node re-runs `pages.resolve` for that page only; a Widget node change
  calls the widget's `update(config, size)`. Layout changes animate panels to their new cells with a spring (no
  animation under reduced motion). `pages.list` is re-read into `navStore` debounced 150 ms; a new nav entry raises a
  station (6.5).
- **Offline:** the live mark goes hollow, the trace ring stops, arcs dim, the offline banner counts down; on reconnect
  each stream resumes from its last seq; a gap triggers a resync of the stores and of mounted widgets only.

### 6.3 Who did it: agent, person, system

| Actor | Detection | Visual | Persistent mark | Mirror |
|---|---|---|---|---|
| **The viewer** | `actor === me.subject` | No marker (you know you did it); threads from your panel | none | nothing extra |
| **Another person** | `actor` starts with `user:` | A **mote**: a small disc with the person's generated avatar that appears at the changed panel's top-left corner for 4 s with their name | "Changed by Jonas Weber · change 409" in the panel's header tooltip | announced if the panel is in the current bay: "Updated by Jonas Weber" |
| **The agent** | `actor` starts with `agent:` or `surface === "mcp"` | The **Lumen** flies to the panel; the **attribution band** across the panel's top edge reads "Added by agent claude-code · mcp · change 412" (or "Changed by") for 8 s in the agent accent with the diamond glyph, then retires to a diamond glyph in the header | Diamond glyph in the header until the next human change; the trace tick carries the diamond | Announced with actor and change number; the header glyph has the text "Last changed by agent claude-code for Maya Ortiz, change 412" |
| **System or automation** | `actor` starts with `service:` or `surface === "system"` | A hollow ring mote with a gear glyph, "Automation: Welcome series" | Tooltip | Announced only when the viewer is the subject |
| **Held for approval** | `approval.requested` whose subject is a node or action | A **ghost** at the target: a translucent slab with accent hatch and a dashed edge where the panel would appear (or over the panel it would change), labelled "Held for approval · requested by agent claude-code · Approve in Approvals" | Stays until decided; approving solidifies it (weave), rejecting dissolves it with "Rejected by Priya Shah" for 6 s | "Held for approval: ..." and a link to the item |

The agent accent is its own token per look (`--agent`, a violet family in calm, a cool white in nocturne), always
paired with the diamond glyph and the words "agent claude-code", so agent attribution never depends on colour. The
`on_behalf_of` principal is always named ("for Maya Ortiz").

### 6.4 The trace ring

- The last 12 changes visible to the viewer, newest at the front of the floor band, each a tick with: change number
  in large JetBrains Mono, actor (never truncated; the node path truncates first), action summary from
  `ops_summary`, node title, UTC time. Agent ticks carry the diamond; held ones carry a hatch.
- On boot the trace backfills the last 8 changes without motion (Folio graft).
- The lintel's dek under the station title rewrites itself to the latest change on this page and who made it
  ("Latest: change #412 by agent claude-code, Points balance added") (Folio graft).
- `T` opens the trace as a HUD list with filters (agent, people, this page); the mirror always has it as an `<ol>`.

### 6.5 Clear and rebuild over MCP, in 3D

The agent drives `site.clear` (dry run, then commit), `site.restore`, `site.page.put`, `site.widget.add`,
`site.widget.remove`, `site.appearance.set` through `action.invoke`. Each commit is an ordinary change; Orbit plays it
as follows. Every step is driven by events that every open browser receives, so the whole room plays it everywhere.

1. **Before anything commits.** The agent's MCP session is live (the agent's `session` row is listed in
   `people.sessions`); when the first `surface: "mcp"` change of the session arrives the Lumen wakes at the atrium
   centre: a soft white light that brightens over 400 ms, settles at head height, and the `<aside aria-label="Agent">`
   log says "Agent claude-code is active for Maya Ortiz".
2. **`site.clear` commits.** One change batch deletes every Page and Widget node. The choreographer emits `Unweave`
   for every panel, ordered by ring angle outward from the Lumen: content withdraws row by row, the slab's fill
   dissolves through the noise threshold, the edge trace runs back to a point and flies into the Lumen as a short
   thread. Stations then sink: lintels and floor markers fade, the ring's arc rules dim to a faint line, the dial
   empties. The cascade is staggered so it reads as one gesture: 40 ms between panels, at most 2.2 s in total. The
   empty atrium shows a single centred lintel: "This workspace is empty. Pages appear here as they are built." The
   announcement: "Site cleared by agent claude-code, change 431. 31 pages and 74 widgets removed."
3. **`site.page.put` (or `site.restore { pages: [...] }`) commits a page.** `navStore` gains an entry. The ring is
   recomputed (the new station's angle is fixed by its nav section and order), existing stations glide to their new
   angles (spring, 600 ms), and the new station **rises**: its floor marker lights, its bay wall extrudes up from the
   floor, its lintel title types on in the agent accent. The Lumen flies there along a thread.
4. **Each widget arrives** (the page's items in the same commit, or later `site.widget.add` calls). For each panel,
   in grid order, the Lumen moves to the cell's centre 120 units in front of the wall and **weaves**: a bright line
   leaves the Lumen, traces the panel's rounded outline on the wall (edge trace, 350 ms), the slab fills from the
   traced edge inward through a blue-noise threshold (300 ms), the panel lifts to its tier with its shadow resolving,
   and the content appears row by row from the top as the widget's first data arrives (the loading skeleton is
   skipped when data is already there). The attribution band "Added by agent claude-code · mcp · change 437" lights
   across the top edge.
5. **Follow camera.** Viewers who opted in (presenter: `Shift+F`, or the Settings default) see the camera follow the
   Lumen in the follow pose; others stay where they are and see an **off-screen indicator**: a HUD chevron at the
   viewport edge pointing to where the agent is working, labelled "Agent building Store", which is a button that
   travels there.
6. **`site.appearance.set`** sends the **look sweep** (S.8): from the Lumen's position, a front of the new look's
   light, palette and material travels around the ring at 120 degrees per second; behind the front everything is in
   the new look. The UI layer's colours switch per panel when the front passes the panel's centre (a 200-ms colour
   cross-fade, so text is never at an intermediate contrast for longer than that, and both end states pass the
   contrast test). Reduced motion: a 200-ms cross-fade of the whole frame.
7. **Held steps.** If the agent's change is held (for example editing a system page under R-PAGE-SYSTEM when the
   principal lacks the rule), a ghost appears instead of a weave, and the approvals banner lights for approvers.
8. **The agent goes idle** 10 s after its last change: the Lumen dims and drifts back to the atrium centre.

During a rebuild the trace ring fills with agent ticks, so at the end a presenter can step to overview and show, in
one frame, every station the agent built and every change number.

### 6.6 `ui.present`: the agent showing something

- **Delivery.** The MCP tool notifies `plinth_present` with `{ ws, node, target, focus, by }`. The realtime gateway
  forwards it on the `changes` subscription of each targeted session as a `ChangeEvent` with `kind: "present"`, the
  `node` uri, `actor` set to the agent, and the `focus` parameter in `ops_summary` (as JSON) or a dedicated field.
  This forwarding is the one server-side touch Orbit needs (A.1).
- **Resolving what to show.** `presentResolver(uri)` maps the node to a place:
  1. a panel on the current page that shows that node (by widget config or bound param) -> that panel;
  2. a page whose route renders it (`Product` -> `/store/p/:slug`, `Promotion` -> `/promotions/:slug`, `Dashboard`
     -> `/d/:slug`, `Content` -> `/read/:slug` or the editor for authors, `Thread` -> `/messages/t/:id`, `Member` ->
     `/people/:handle`, `Order` -> `/store/orders/:id`, `Automation` -> `/automations/:slug`, `Segment` ->
     `/segments/:slug`) -> that layer;
  3. otherwise a **presentation panel**: a temporary tier-3 panel in front of the camera rendering the node with the
     widget that best shows its kind (`reporting.panel` for a Panel, `audit.node-history` as the generic fallback).
- **The move.** The Lumen flies to the target first and casts a soft **spotlight** cone on it; then, if the viewer
  follows the agent, the camera follows along the normal camera path and the target panel enters focus mode with the
  `focus` parameter applied (for example `region = EMEA` on a dashboard). The URL is updated with `replaceState` so
  the presented view is shareable.
- **Respecting the viewer.** The camera never moves if: a text field has focus with unsaved input, a dialog is open,
  the viewer pressed a key or pointer in the last 2 s, or "Follow agent" is off for this viewer. Then the spotlight
  still lights the target, and a HUD beacon says "Agent is presenting Promotions performance · Go (G P)"; the
  announcement offers the same. The presenter session typically follows; the audience's own phones need not.
- `ui.present` writes no change, so it puts no tick on the trace ring; the agent log in the `<aside>` lists it
  ("Presented Promotions performance to all screens").

---

## Requirement 7. Performance budgets

All figures are **targets measured on the reference hardware of 2.7**, by the harness in 9.9 (`orbit-bench`), on
the seeded Northwind world signed in as Maya Ortiz. A target is met when the stated percentile over the stated run
holds on three consecutive runs. Frame times are GPU time from timestamp queries (`timestamp-query` on WebGPU,
`EXT_disjoint_timer_query_webgl2` on WebGL2) and CPU time from `performance.now()` around F0 and F1.

### 7.1 Frame time

| Scenario | Desktop (p95) | Integrated (p95) | Phone (p95) |
|---|---|---|---|
| Station at rest, Home (9 widgets) | 0 frames rendered (render on demand) | 0 frames | 0 frames |
| Station at rest with ambient drift on | GPU 1.6 ms, CPU 0.6 ms at 20 Hz | GPU 4.5 ms, CPU 1.2 ms at 20 Hz | ambient off by default |
| Scrolling the 912-row ledger | GPU 2.5 ms, CPU 2.0 ms, 120 Hz held | GPU 7.5 ms, CPU 4.0 ms, 60 Hz held | GPU 11 ms, CPU 6 ms, 60 Hz held on iPhone 13 |
| Neighbouring camera move | GPU 3.0 ms, CPU 1.5 ms | GPU 9.0 ms, CPU 3.0 ms | GPU 13 ms, CPU 5 ms |
| Far move through overview (26 impostors) | GPU 3.5 ms | GPU 11 ms | GPU 15 ms |
| Focus mode with blur | GPU 3.2 ms | GPU 9.5 ms | GPU 12 ms (blur at quarter resolution) |
| Rebuild: 4 panels weaving, 12 threads, Lumen | GPU 4.0 ms, CPU 3.0 ms | GPU 12 ms, CPU 5.0 ms | GPU 15 ms, CPU 7 ms |
| Worst-case burst: 40 events in one batch | no frame over 16.7 ms | no frame over 25 ms; at most 2 frames over 16.7 ms | no frame over 33 ms |

Frames over budget are counted, not averaged away: the harness reports the count of frames over 16.7 ms and 33.3 ms
per scenario, and the targets above are gates.

### 7.2 Memory

| Item | Desktop | Integrated | Phone |
|---|---|---|---|
| Atlases resident (fonts, icons) | 32 MB | 32 MB | 16 MB (1024 x 1024 pages, `inter-ext` paged in on demand) |
| Runtime SDF run cache and hinted small-text caches | 8 MB + 4 MB | 8 MB + 4 MB | 4 MB, no hinted cache (DPR 3) |
| Render targets (MSAA x4 MRT at 1440p / 1080p / phone native capped DPR 2) | 120 MB | 70 MB | 48 MB, MSAA off (2.5) |
| Impostors (26 x 512 x 320 RGBA8) | 17 MB | 17 MB | 8.5 MB (26 x 256 x 160 at 2x) |
| Instance buffers (glyphs, rects for the current bay and its neighbours) | 12 MB | 12 MB | 6 MB |
| **GPU total ceiling** | **256 MB** | **192 MB** | **128 MB** |
| JS heap at rest after visiting all 26 stations | 140 MB | 140 MB | 110 MB |
| Mirror DOM nodes at a station | under 3,000 | under 3,000 | under 2,000 |

Bays more than two stations away from the camera release their instance buffers and keep only their impostor and
mirror subtree (stores stay warm). Unvisited widgets are not mounted.

### 7.3 Asset sizes and first meaningful paint

| Asset | Budget (transfer, gzip or Brotli as served) |
|---|---|
| Initial JS (app shell, client, scene, UI kit, text, three.js subset) | 360 KB |
| three.js subset within that | 175 KB (tree-shaken `three/webgpu` + `three/tsl` nodes used) |
| Yoga WebAssembly | 45 KB |
| Each station's widget chunk | 30 KB or less (lazy, by domain) |
| `inter-core` atlas + manifest | 1.15 MB, fetched in parallel with JS, `fetchpriority="high"` |
| Mono and icons | 0.55 MB |
| Inter woff2 for the overlay (one variable file, Latin) | 110 KB |
| Environment textures | 0 bytes: sky, floor, hatch and noise are procedural (the blue-noise tile is a 64 x 64 `r8` generated at boot) |

First meaningful paint is the moment the current station's lintel title and the first widget's content are drawn and
the mirror's `<main>` holds the same content.

| Network and device | Target (p75 of 20 cold loads) |
|---|---|
| Desktop, local network to the demo host | 650 ms |
| Integrated, 50 Mbps, 20 ms RTT | 1.1 s |
| iPhone 13, 4G profile (9 Mbps, 85 ms RTT) | 2.4 s |

Progressive fidelity makes this possible: the first frame is drawn with the **Plan pipeline set** (environment,
wall, ui-rect, ui-glyph-msdf, composite: five pipelines) under an orthographic camera at the target station; the lit
pipelines compile in the background (7.4) and the scene eases into full lighting over 300 ms when they are ready
(instant under reduced motion). The mirror's `<main>` is filled from the same view trees before the first GPU frame.

### 7.4 Shader compilation and warm-up

- **Few pipelines** (2.3): 14 in total, all known at build time. Widgets never compile shaders.
- **Boot order:** create the five Plan pipelines with `createRenderPipelineAsync` (WebGPU) or link with
  `KHR_parallel_shader_compile` polling (WebGL2) and draw the first frame; then call `renderer.compileAsync(scene,
  camera)` on a warm-up scene that contains one instance of every material and every MRT and blend state
  combination, off screen, so no pipeline is first compiled during a camera move or the rebuild.
- **Caching:** the browser's pipeline caches (Dawn's blob cache in Chromium, Metal's in Safari, ANGLE's program cache
  for WebGL2) do the persistence; Orbit keeps shader source byte-stable across sessions (no generated identifiers
  that vary per run) so those caches hit. The harness measures cold and warm boots separately.
- **Measured targets:** warm boot full-fidelity ready by 900 ms on integrated; cold by 2.2 s on integrated and 3.5 s
  on iPhone 13. No frame stalls over 50 ms after first meaningful paint (gate).

### 7.5 Battery, low power and the 2D mode

- **Render on demand** (2.3) is the main battery saving: an idle Orbit draws nothing.
- **Low power mode** (Settings, or automatic when `navigator.getBattery()` reports discharging under 20% where the
  API exists, or when the device-tier heuristic in 8.4 trips): `powerPreference: "low-power"`, DPR capped at 1.5, no
  MSAA, bloom off, ambient drift off, threads reduced to static highlights, impostor refresh only on overview entry.
- **Plan view** (the 2D mode): the same scene graph and widgets drawn with an orthographic camera looking straight
  at one bay, unlit, no post, no slabs (panels are flat cards with a 1-px rule and a CSS-like shadow drawn as an SDF);
  navigation is a cross-fade. Plan view uses the five Plan pipelines only. Measured target on integrated: GPU under
  2 ms for any station, and the same mirror, so accessibility, input and tests are identical. It is the default on
  the WebGL2 LDR path and selectable everywhere (`?render=plan`).
- **Hidden tabs** render nothing (`visibilitychange`), keep the socket, and on return redraw once.

---

## Requirement 8. Phone

### 8.1 The 390-px experience

On a viewport under 640 CSS px (any phone, and desktop at 200% zoom or more), Orbit uses its **narrow layout**:

```
 +--------------------------------------+   390 x 844
 | [≡] Points            ◉ 12,450  🔔3  |   HUD top bar (48 px): station title, live mark, chip, bell
 |--------------------------------------|
 |  ╭──────────────────────────────╮    |   the station's bay wall, one column, panels full width
 |  │ Points balance               │    |   with their soft shadow; neighbours' edges visible at
 |  │ 12,450   Silver · 1,550 to Gold   |   the sides as a hint of the ring (12 px each side)
 |  ╰──────────────────────────────╯    |
 |  ╭──────────────────────────────╮    |
 |  │ Transfer points              │    |
 |  ╰──────────────────────────────╯    |
 |  ╭──────────────────────────────╮    |
 |  │ Ledger                   912 │    |
 |  │ 22 Nov  award      +250      │    |   tables switch to their stacked-row form below 480 px
 |  ╰──────────────────────────────╯    |
 |--------------------------------------|
 |  ◂ Badges   ● Points ●   Store ▸     |   Station dial (56 px): a horizontal arc of the stations,
 +--------------------------------------+   current centred, swipe or tap; counts on chips
```

- The ring becomes a carousel of stations seen one at a time; a horizontal swipe on the dial rotates the ring by one
  station (a camera yaw with the same spring, 380 ms); a long swipe flings across several with deceleration.
- Each bay is one column in `(y, x)` order with each widget at its `m` size or its smallest size (as UI-MAP 3.2
  page-host rule); `full` tables use their stacked-row form below 480 px (each row a two-line card: primary text and
  amount on the first line, metadata on the second) with the same grid semantics in the mirror.
- **Scrolling is native.** The mirror's `<main>` is a real scroll container whose content height equals the bay's
  laid-out height; its `scrollTop` drives the camera crane. Momentum, rubber-banding, scroll-to-top on status bar tap
  (iOS), and screen-reader three-finger scrolling all come from the platform. The same is true on desktop (B.1),
  which is why `PageDown`, `Space` and scroll wheels behave exactly as users expect.
- **Focus mode** is how forms open on a phone: tapping into `points.transfer` brings it full screen, square to the
  camera, with the keyboard's `visualViewport` respected (the panel's bottom edge tracks `visualViewport.height` so
  the focused field is never under the keyboard).
- **Overview** on a phone: pinch in (or tap the station title) shows the ring from above with 26 station tiles in an
  arc; tap a tile to descend.
- The HUD top bar shows the station title instead of the full product mark; the palette opens from the `≡` button
  and from a downward swipe on the top bar.

### 8.2 Touch gestures

| Gesture | Where | Action |
|---|---|---|
| Vertical drag | anywhere in the bay | Native scroll (camera crane) |
| Horizontal swipe | on the station dial | Previous or next station |
| Horizontal swipe | inside a horizontally scrolling widget (featured row, wide table) | That widget scrolls; never changes station |
| Pinch in | anywhere in the bay | Overview |
| Pinch out | in overview | Descend to the station under the pinch centre |
| Tap | panel header | Focus mode |
| Long press (500 ms) | a row or card | Its context menu (the same items as its kebab menu) |
| Edge swipe from the left | screen edge | Browser back (we do not intercept it) |
| Two-finger tap | anywhere | Toggle "Follow agent" during a presentation (presenter convenience; also a button) |

Every gesture has a button alternative (the dial's chips, an Overview button in the dial, the panel menu's Focus
item), so nothing depends on a path gesture (WCAG 2.5.1). Touch targets are at least 44 x 44 CSS px on the phone
layout.

### 8.3 Phone rendering settings

| Setting | Phone value |
|---|---|
| DPR | min(devicePixelRatio, 2) for the scene; the HUD and focus-mode front plane render at full DPR so text is sharp |
| MSAA | off; slab edges are anti-aliased analytically in the slab shader (SDF coverage) |
| Bloom | half the levels (3), quarter resolution |
| Shadows | analytic, max 12 casters per bay |
| Threads | max 8 live |
| Impostors | 256 x 160 |
| Ambient drift | off |
| Hinted small text | off (DPR 2+) |

### 8.4 Thermal limits

There is no thermal API on the web, so Orbit uses a **frame-time governor**:

- It keeps a rolling 3-second window of GPU frame times during animated frames.
- If p90 exceeds 20 ms for two consecutive windows, it steps down one level: (1) bloom off, (2) scene DPR 1.5,
  (3) threads become static highlights and the Lumen loses its halo, (4) Plan view. It steps back up one level only
  after 60 s with p90 under 10 ms.
- Measured target on iPhone 13 in a 10-minute scripted session (station tours, a rebuild replay, ledger scrolling):
  no step below level 1, and frame-time p95 drift between the first and last minute under 15%.
- Low power mode on iOS (detected heuristically: `requestAnimationFrame` capped at 30 Hz) starts the governor at
  level 2.

---

## Requirement 9. Architecture

### 9.1 Packages

New packages live beside the existing ones. `packages/web` stays until cutover (Requirement 12, step 16).

```
packages/
  spec/                     (exists) schemas, WIDGET_CATALOGUE, actions, rt frames; unchanged
  orbit-client/             renderer-independent client runtime (TypeScript)
    src/api.ts                request, call, idempotencyKey, nodes, query       (ported from web/src/core/api.js)
    src/rt.ts                 one socket, s1 changes + s2 domain + counts; gap, resume, guard
    src/router.ts             path <-> route, history, deep links, ?as, ?focus, ?view, ?render
    src/stores.ts             createStore + meStore, countsStore, prefsStore, clockStore, navStore,
                              pagesStore, presenceStore, traceStore
    src/identity.ts           principal, token, sessionId, switchTo
    src/bus.ts                createBus(linkGroup scopes)
    src/widget-schemas.ts     generated by `pnpm schema:gen` (never hand-edited)
    src/action-routes.ts      generated
    src/announce.ts           polite/assertive announcer (writes into the mirror's regions)
  orbit-text/               fonts, atlases, shaping split, bidi, line breaking, glyph caches
    scripts/build-atlases.ts  opentype.js + msdf-atlas-gen CLI -> public/atlases/*.webp + *.json
    src/atlas.ts  src/runs.ts  src/bidi.ts  src/breaker.ts  src/smalltext.ts  src/measure.ts
  orbit-scene/              renderer, render graph, materials (TSL), camera rig, picking, budgets governor
    src/renderer.ts           backend selection (2.2), device loss, render-on-demand loop
    src/graph.ts              passes F0-F10
    src/materials/            slab.ts wall.ts floor.ts sky.ts uiRect.ts uiGlyph.ts ghost.ts lumen.ts thread.ts
                              dataObject.ts bloom.ts composite.ts blur.ts
    src/rig.ts                poses, paths, springs, reduced-motion fades
    src/ring.ts               station placement (B.1)
    src/pick.ts               ray picking (9.5)
    src/governor.ts           frame-time governor (8.4)
  orbit-ui/                 view tree, primitives, layout, reconciler, mirror projector, input routing
    src/jsx.ts                JSX factory for view trees (TS `jsxImportSource: "@plinth/orbit-ui"`)
    src/primitives/           Stack Text Heading Numeral Icon Button IconButton Link TextField TextArea NumberField
                              Select Combobox Checkbox Radio Switch DateField Table List Tabs Menu Pill Count
                              PersonChip Avatar Progress Ring Meter Chart Sparkline RuleBuilder Diff Timeline
                              Kanban MonthGrid Matrix StepGraph Dialog Drawer Toast EmptyState ErrorState
                              Skeleton Stage3D
    src/layout/               yoga bridge, table layout, chart layout, grid (12-col) placement
    src/reconcile.ts          view tree diff -> scene patches + mirror patches
    src/mirror/               projector, panel containers, overlay sync, probes (rem, spacing, forced colours)
    src/input.ts              pointer routing (mirror first in reading poses, scene otherwise), keyboard map
  orbit-looks/              look presets, token tables, LDR and high-contrast variants, contrast checker
  orbit-shell/              HUD (top bar, dial, palette, toasts, banners), trace ring, Lumen, choreographer,
                            presentResolver, page host (pages -> stations and layers)
  orbit-widgets/            src/<domain>/<name>.tsx for all 77 widgets; src/<domain>/_*.ts domain helpers
  orbit-app/                index.html, main.ts (boot), vite.config.ts, plain.css, public/atlases
  orbit-testkit/            harness (render-once, pose control, clock control), golden runner, parity checks,
                            bench (orbit-bench), recorded rt sessions
```

Dependency direction (enforced by an ESLint `import/no-restricted-paths` rule and a package-graph check):

```
 spec  <-  orbit-client  <-  orbit-shell  ->  orbit-ui  ->  orbit-text
                 ^               |   \            |
                 |               |    '------> orbit-scene  ->  three
          orbit-widgets ---------'---> orbit-ui (only)         orbit-looks <- orbit-scene, orbit-ui
 orbit-app -> everything; orbit-testkit -> everything
```

**Widgets may import only `@plinth/orbit-ui`, `@plinth/orbit-client` (api types, bus types) and their own domain
helpers.** They cannot import three.js, the scene, or another widget. A widget never knows it is in 3D.

### 9.2 How widgets stay self-contained apps

```tsx
// packages/orbit-widgets/src/points/ledger.tsx
import { defineWidget, Table, Column, Numeral, Text, Toolbar, Select, Stage3D } from "@plinth/orbit-ui";
import { schemaOf } from "@plinth/orbit-client/widget-schemas";

export default defineWidget({
  id: "points.ledger",
  domain: "points",
  title: "Ledger",
  configSchema: schemaOf("points.ledger"),
  sizes: ["l", "xl", "full"],                       // must equal the catalogue entry (orbit-parity check)
  setup(ctx) {                                     // runs once per mount; ctx as UI-MAP 4.2, plus ctx.view
    const member = ctx.memberHandle(ctx.config.member ?? "$me");
    const rows = ctx.resource(() => ctx.api.call("points.statement", { member, limit: 100 }), { pages: true });
    const view = ctx.signal<"lines" | { txn: string }>("lines");
    ctx.rt.on("points.posted", (e) => { if (e.payload.member === member) rows.prepend(e.payload); });
    ctx.setCount(() => rows.total());
    return (size) => view.value === "lines"
      ? <Column gap={8}>
          <Toolbar><Select label="Type" value={...} options={...} /></Toolbar>
          <Table rows={rows} rowKey="txn_id" rowHeight="row" onOpen={(r) => (view.value = { txn: r.txn_id })}
                 columns={[ { key: "posted_at", label: "Date (UTC)", type: "datetime-utc" },
                            { key: "txn_no", label: "Txn", type: "mono" },
                            { key: "txn_type", label: "Type" },
                            { key: "memo", label: "Memo", truncate: true },
                            { key: "delta", label: "Delta", type: "signed-points", align: "decimal" },
                            { key: "balance", label: "Balance", type: "points", align: "decimal" } ]} />
        </Column>
      : <TransactionView txn={view.value.txn} back={() => (view.value = "lines")} dataView={<Stage3D .../>} />;
  },
});
```

- `defineWidget` produces the same shape the runtime contract of UI-MAP 4.1 describes (id, domain, title,
  configSchema, sizes, mount, update), so the contract, the catalogue checks and the page host's lifecycle are
  unchanged in meaning.
- `ctx` is UI-MAP 4.2's context unchanged, plus `ctx.signal`, `ctx.resource` (a cached, re-readable action call
  with loading, error and page support) and `ctx.motion` (the viewer's reduced-motion and low-power flags).
- **Rules** (UI-MAP 4.3 carried over, with Orbit additions): render only through the returned view tree; data only
  through catalogue actions; realtime only through `ctx.rt`; overlays only through `ctx.openDrawer` and friends;
  `Stage3D` content must have a flat equivalent in the same view (the primitive requires a `flat` prop); text only
  through `Text`-family primitives (no string concatenation of `null`).
- **Isolation at run time:** each widget instance's reconciler patch is applied inside a guard; an exception during
  render or an event handler puts that panel in its error state (with retry) and leaves the rest of the scene and
  mirror untouched. The runtime asserts on unmount that the scoped `rt` and `bus` handles were released.

### 9.3 The view tree and primitives

A view node is a plain object `{ type, props, children, key }` produced by the JSX factory. The reconciler keeps a
**retained tree** per panel and diffs by `(type, key)`. Each primitive implements four functions:

```ts
interface Primitive<P> {
  layout(node: ViewNode<P>, cx: LayoutCx): LayoutBox;           // Yoga node or custom layout (Table, Chart, Matrix)
  draw(node: ViewNode<P>, box: LayoutBox, dl: DrawList): void;   // rects, glyph runs, data-object handles
  mirror(node: ViewNode<P>, box: LayoutBox, m: MirrorBuilder): void; // element, role, attrs, text lines
  input?: InputSpec<P>;                                          // hit region, cursor, press, keys, drag
}
```

Layout runs only for dirty subtrees (a text change re-measures its run and re-lays out its ancestors up to the first
fixed-size box). Draw emits into per-panel instance ranges; only changed ranges are uploaded.

### 9.4 Scene graph and layout engine

Types are in Appendix T. The structure:

```
 SceneRoot
  |- Environment (sky, floor, ring rules, arc gates, station markers, trace ring)
  |- Ring
  |   '- Station[]           (one per nav page; angle, facet transform, lintel, marker, impostor)
  |        |- Bay            (the wall; grid metrics; scroll extent)
  |        |    '- Panel[]   (one per resolved item; transform spring; tier; draw list; mirror container)
  |        |         '- Stage3D?  (ortho sub-scene for data objects)
  |        '- Layer[]        (non-nav pages attached here; each has its own Bay)
  |- Ghost[]                 (held changes)
  |- Lumen                   (agent presence; path; light)
  |- Thread[]                (cues; pooled)
  '- HUD                     (screen-space: top bar, dial, toasts, palette, banners, focus ring, indicators)
```

**Layout pipeline per page:**

1. `pages.resolve` gives items with `at {x, y, w, h}` on the 12-column grid.
2. **Grid placement:** column width `cw = (W - 11 * gutter) / 12` with `gutter = 24` (comfortable) or `16` (compact);
   row height `rh = 4.5 * rem`. A panel's rect is `x = at.x * (cw + gutter)`, `width = at.w * cw + (at.w - 1) *
   gutter`, `y = at.y * (rh + gutter)`, `height = at.h * rh + (at.h - 1) * gutter`.
3. **Panel content layout:** the widget's view tree is laid out in the panel's content box. If a primitive declares a
   minimum height above what the cell gives (3.5), the panel's height grows and every item below it in the same
   columns shifts down (a deterministic "push-down" pass in `y` order), so nothing overlaps or clips.
4. **Narrow layout** (under 640 CSS px): one column in `(y, x)` order at `m` or smallest size, per UI-MAP 3.2.
5. **Station placement** (B.1): `theta_i = 2 * pi * (sum of facet widths and gaps before i + W_i / 2) / circumference`,
   arc gates adding 2 degrees each, Custom arc last. The ring is recomputed when `navStore` changes; stations spring to
   their new angles.

Every step is a pure function of (page specs, viewport, density, text scale, prefs), cached by input hash, so it can
be tested without a GPU.

### 9.5 Hit testing and picking

- **Reading poses:** the mirror is the hit target for UI (4.5, 5.2). A pointer event on a mirror element is routed to
  that element's view node's `input` handler by its `data-scene` id. Hover state comes from `pointerenter` on the
  mirror element and is drawn by the GPU.
- **Everywhere else and for 3D:** CPU ray picking. The pointer's NDC gives a ray from the camera; it is tested against
  (a) HUD rectangles (screen space), (b) panel planes of the visible bays (at most 64; each a rounded rectangle in its
  plane: ray-plane intersection then a 2D rounded-rect test), (c) Stage3D objects (their own small BVH of boxes),
  (d) station markers and impostors in overview, (e) the floor (for the trace ring ticks). The nearest hit wins.
  A panel-plane hit is converted to panel-local CSS px and resolved in the panel's **hit grid** (a uniform 32-px
  grid of interactive box ids built at layout), giving the same element the mirror would.
- No GPU readback is used for picking, so picks are synchronous and deterministic. Measured target: under 0.2 ms per
  pick on integrated.

### 9.6 State: stores fed by rt

- `orbit-client/rt.ts` is a port of UI-MAP 3.2 `rt.js` with the DOM round's fixes: `try` around `JSON.parse` only;
  `socket !== current` guard; `prev_through > through` gap flag triggering a scoped resync; each stream's last seq in
  `sessionStorage`; backoff 1, 2, 4, 8 s; `onSessionRevoked` on close code 4401.
- Stores (`createStore` with `get`, `set`, `update`, `subscribe`) as UI-MAP 3.2, plus:
  - `pagesStore`: resolved pages by slug, invalidated per Page or Widget node change;
  - `presenceStore`: current agent activity (last agent change, target, idle timer) and recent motes;
  - `traceStore`: the last 50 change events visible to the viewer, inserted by seq (Lattice graft).
- Widgets hold their own state in signals; they read app stores through `ctx.me`, `ctx.can`. Incremental rule: an
  event re-reads only what it names (the widget's own resource, or one page), never the whole site.
- The choreographer subscribes to the raw batches before widgets do, so cues and widget updates land in the same
  frame.

### 9.7 Routing and deep links

- URLs are exactly the UI-MAP 2 routes; every one still works and is shareable. The router calls `pages.resolve`, then
  maps the result to a pose: a nav page -> `station(bay)`; a non-nav page -> `layer(parentBay, layer)` (B.1);
  `/search` -> the lens layer at the current station (or at Home when deep-linked).
- Query parameters: `?as=<handle>` (identity, kept by `href`), `?focus=<widget-slug>` (focus mode on that
  instance), `?view=overview`, `?render=webgpu|webgl2|plan|plain`, `?scroll=<rows>` (bay scroll in grid rows, written
  with `replaceState` on scroll end so a shared link lands at the same place), and widget-owned params the page
  binds.
- History: each navigation is a `pushState`; focus mode and overview are `pushState` too, so Back leaves them. Camera
  scroll is `replaceState`. `popstate` animates the reverse path (or fades under reduced motion).
- After every navigation the router focuses the new `h1` in the mirror and announces "Moved to Store" (UI-MAP 3.2).
- Deep links start at the pose with no camera move and no weave; the trace backfills without motion.

### 9.8 Looks and the scene

See Requirement 10. A look is one uniform block plus token tables; switching it rebuilds no pipeline.

### 9.9 Testing

| Layer | What | How |
|---|---|---|
| Pure logic | Ring placement, grid placement, push-down, path planning, choreographer cues, presentResolver, text layout (line breaks, bidi order, tnum), contrast maths | Vitest (`vitest@3.2.4`) in Node, no GPU; golden JSON outputs |
| Headless rendering | Every station, every look x theme, both densities, at 1280 x 800 and 390 x 844, on WebGPU and WebGL2 | Playwright 1.55 Chromium with `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=swiftshader --use-webgpu-adapter=swiftshader` (Dawn on SwiftShader Vulkan) for WebGPU, and ANGLE SwiftShader for WebGL2. The `orbit-testkit` harness exposes `window.__orbit.renderOnce(pose)`, a frozen clock, a fixed blue-noise seed and `?test=1` (no ambient drift) so frames are deterministic |
| Visual regression | Screenshots against goldens per backend | pixelmatch with threshold 0.1 and at most 0.05% differing pixels outside text; **text regions** (from the draw list's glyph bounds) must match at 0 differing pixels on the same backend and driver; goldens are regenerated only by an explicit command and reviewed as images in the PR |
| Text quality | MSDF and hinted text against the browser's own text | A test page renders the same strings with Orbit and with DOM text in the same font; SSIM per string at 12, 13, 14, 16 px must be at least 0.97 (hinted path) and 0.94 (MSDF at DPR 2) |
| Contrast | Rendered pixels (5.8) | Per look x theme x density, both backends |
| Interaction | The 12 tasks of 5.9 and every widget's primary action | Playwright driving the **mirror** with `getByRole` (keyboard and pointer), plus pointer at projected coordinates during motion to exercise ray picking |
| a11y mirror | axe-core and parity | `@axe-core/playwright` on every station; parity check: for every focusable mirror element, the GPU draw list has a box with the same `data-scene` id whose projected rect matches within 2 CSS px, and every GPU glyph run's string appears in the mirror; zero-mark charts with non-empty data fail |
| Overlay sync | Native input over GPU chrome | Focus each text field at rest and during a scripted camera move; compare the element's `getBoundingClientRect()` corners with the projected chrome rect: under 0.5 px at rest, under 1.5 px in motion |
| IME | Composition | Chromium's `Input.imeSetComposition` via CDP for Japanese and Korean in the palette, a reply box and a content block; the committed text must equal the input |
| Realtime | Recorded rt sessions | `orbit-testkit/sessions/*.jsonl` (a checkout, an award, the full rebuild, a gap and resume) replayed against the client; assertions on stores, cues, announcements and the final screenshot |
| Performance | `orbit-bench` | The scenarios of 7.1 on the reference hardware (a manual run; results recorded in the PR), plus a CI smoke on SwiftShader that checks pipeline count, upload sizes and frames rendered at rest (must be 0) |
| Catalogue parity | `orbit-parity` | Every catalogue id has a module with equal `sizes`; actions and events used are a subset of the catalogue's (static analysis of `ctx.api.call` and `ctx.rt.on` literals) |
| Plain path | Mirror visible | The interaction suite runs again with `?render=plain` |

Per the repository's working rules, agents working on one change run only type checks, formatting and lint; the
suites above run once on the stacked changes.

---

## Requirement 10. Looks and theming

### 10.1 What a look is on the GPU

A look is a **scene preset**: palette, environment, lighting, material, post, typography and motion, each with a
light and a dark variant, plus derived LDR and high-contrast variants. It is data in `orbit-looks/src/looks/<id>.ts`:

```ts
interface LookPreset {
  id: "calm" | "meridian" | "nocturne" | "folio" | "lattice" | "strata";
  variants: { light: LookVariant; dark: LookVariant };
  defaultTheme: "light" | "dark";
}
interface LookVariant {
  tokens: {                                  // OKLCH strings; UI layer colours, exact
    face: string; face2: string; ink: string; ink2: string; ink3: string; rule: string; accent: string;
    accentOn: string; agent: string; focus: string; success: string; warning: string; danger: string;
    info: string; selection: string; hatch: string; autofill: string;
  };
  environment: { skyTop: string; skyHorizon: string; horizonBand: number; floor: string; floorRule: string;
                 arcGlow: number; fogDensity: number };
  lighting: { keyColor: string; keyIntensity: number; keyElevationDeg: number; keyLagMs: number;
              fillTop: string; fillBottom: string; rimIntensity: number; lumenColor: string; lumenIntensity: number };
  material: { slabEdge: string; bevelPx: number; roughness: number; sheenMaxDeltaL: number;  // <= 0.015
              shadowSoftness: number; shadowOpacity: number; cornerRadiusPx: number };
  post: { bloomStrength: number; bloomThreshold: number; tonemap: "agx" | "neutral"; vignette: number };
  type: { sans: "inter"; display: "inter" | "serif"; titleWeight: 500 | 600; numeralWeight: 400 | 600;
          trackingCaps: number };
  motion: { springStiffness: number; threadSpeed: number; weaveStyle: "trace" | "rise" | "fold" };
}
```

Tokens map one-to-one to the DESIGN-SYSTEM 6A token names where they exist (`--paper` -> `face`, `--ink-3` ->
`ink3`, `--accent`, `--focus`), so the Plain path's `plain.css` is generated from the same table and the two never
disagree.

### 10.2 The six looks as rooms

| Look | Room | Light | Material | Signature |
|---|---|---|---|---|
| **calm** (default) | A daylight atrium: pale warm-white sky, soft stone floor, the ring rules a faint sand line | Large soft key from above-behind, warm; very soft shadows | Matte porcelain slabs, 10-px corner radius, 3-px bevel | Quiet; the Lumen is a soft violet-white |
| **meridian** | A gallery: paper-white walls, near-black type, no sky gradient, a single vermilion floor rule | Almost flat; key light only on bevels; shadows short and crisp | Thin card slabs, 2-px radius, 1-px bevel; heading-rule panels drawn as ruled sheets with no slab | Vermilion reserved for live, attribution and breaches, as in the DOM winner |
| **nocturne** (dark by default) | A night observatory: deep blue-black sky with a faint horizon glow, dark floor with cyan ring rules | Cool key, strong rim, bloom on rules and the Lumen | Smoked slabs with a luminous 1-px edge | The trace ring glows; best for a dim room and a wall display |
| **folio** | A reading room: warm paper, Source Serif display titles, an ink-brown floor rule | Warm low key from the side, long soft shadows | Paper slabs with a faint deckle edge (SDF noise on the outline) | Lintels set like a briefing ("Fig. 3 · Points"); the dek line rewrites itself to the latest change |
| **lattice** | A cool studio: a fine light grid on the floor and walls, blue accent | Even, neutral; short shadows | Crisp slabs, 6-px radius | Grid lines align with the 12-column grid, so the layout structure is visible |
| **strata** | A layered horizon: dusk bands across the sky, warm-to-cool, sand floor | Low golden key, longer shadows, gentle bloom | Slabs with a two-tone edge | Arcs are tinted by stratum, a subtle per-arc hue shift in the rules and markers, never in the UI layer |

Plus two non-site looks applied by the viewer's environment: **System** (forced colours, 5.6) and the
**high-contrast** variant of whichever look is active (`prefers-contrast: more`).

### 10.3 Live switching

- Look, theme and density changes arrive through `site.appearance.get`/the Program node change (site look and
  density) or the viewer's Preference node (theme, density override, motion).
- **Site look change:** the look sweep (6.5 step 6 and S.8). All look parameters live in one uniform buffer per look;
  during a sweep both buffers are bound and every material blends them by `sweepMask(worldPos)`. UI-layer tokens
  switch per panel when the front passes it, with a 200-ms colour cross-fade.
- **Theme change** (light/dark for one viewer): a 300-ms cross-fade of both buffers everywhere, no sweep.
- **Density change:** re-layout of every mounted bay; panels spring to their new rects.
- No pipeline is rebuilt for any of these; the warm-up set covers all looks (7.4).
- The looks are tested for contrast on rendered pixels (5.8) in both variants and their LDR and high-contrast
  derivatives.

---

## Requirement 11. Demo choreography

Five minutes, one presenter, one agent (Claude Code over MCP as `agent:claude-code` for Maya Ortiz), three screens:
the **room display** (1920 x 1080, Maya, Follow agent on, calm look), the **presenter laptop** (Maya, terminal with
Claude Code beside the browser), and a **phone** (Ana Silva, a plain member, 390 px). Timestamps are beats of the
script, read from a cue card.

| Time | Beat | On screen | Presenter says (gist) |
|---|---|---|---|
| 0:00 | **Overview** | The room display opens in overview: the ring of 26 stations under a daylight sky, counts glowing on floor markers (Approvals 3, Inbox 5), the trace ring showing the last 8 changes | "This is Northwind's loyalty programme. Every domain has a place in this room." |
| 0:15 | **Arrive** | Camera descends to Home in one smooth path. Panels resolve with their shadows; the KPI strip, balance, approvals, feed | "Everything you see is drawn by the GPU, and everything you can do is a real control." |
| 0:30 | **A checkout, seen as cause and effect** (impossible in the DOM) | Ana checks out on her phone. On the room display, light threads leave the Store station, cross the room and land on Maya's KPI strip (orders today 18 -> 19), the Orders station marker, and Ana's balance on her own phone rolls down; Maya's trace ring gains "#8813 user:ana-silva checkout.place" | "One transaction, five places updated, and you can see the path it took." |
| 0:55 | **Travel** | Presenter presses `G P`: the camera arcs to Points; then scrolls the 912-row ledger (native scroll, crisp tabular numerals); opens a transaction; presses `D`: debit and credit pillars rise, equal heights | "Dense data stays flat and exact. Depth is used where it explains something: this transaction balances." |
| 1:25 | **Focus** | `G R`, opens Roles, focuses the permission matrix (`F`), presses `D`: three layers tilt apart and the agent column lights where they intersect | "Why can't the agent publish content? Here is the intersection." |
| 1:50 | **The mirror** | `Alt+Shift+M`: the mirror's boxes outline every control and line of text over the scene; VoiceOver reads "Permission matrix, grid, 62 rows" as the presenter tabs; `Alt+Shift+M` off | "Under the picture is a real document. Screen readers, magnifiers and voice control use it directly." |
| 2:05 | **Clear** | In the terminal the presenter asks Claude Code to "clear the site and rebuild it for the Spring campaign". The agent dry-runs `site.clear` (terminal shows 31 pages, 74 widgets), then commits. The Lumen wakes at the centre; panels unweave outward from it, threading into the light; stations sink; the room is empty and dim with one lintel: "This workspace is empty". Ana's phone shows the same empty room | "The agent is allowed to do this, and you can watch it happen everywhere at once." |
| 2:35 | **Rebuild** | `site.page.put` for Home: a station rises; the Lumen flies to it and weaves `promotions.active`, `points.balance`, `badges.progress`, the KPI strip, each with "Added by agent claude-code · mcp · change 437" bands. Follow camera tracks it. Store rises next; then Points; the trace ring fills with diamond ticks | "It is building pages from the same widget catalogue a person uses in the page editor." |
| 3:25 | **Look** | The agent sets the look to nocturne: a wave of night light sweeps around the ring from the Lumen; behind it the room is dark blue with cyan rules; text switches cleanly panel by panel | "Looks are whole rooms now: light, material, palette." |
| 3:40 | **Held** | The agent creates the "Spring Double" promotion. It is held: a hatched ghost appears in the Promotions station with "Held for approval · requested by agent claude-code". The approvals banner lights | "Anything the agent may not do alone waits for a person." |
| 3:55 | **Approve** | Presenter (as Jonas, the other approver, via the identity switcher on the laptop) approves in the Approvals inbox in focus mode. On the room display the ghost weaves solid; threads run to Calendar and to the Store's active-promotions strip; Ana's phone gets the new banner live | "Separation of duties, then the whole room updates." |
| 4:20 | **Present** | The agent calls `ui.present` on the promotion's performance panel with `focus: region = EMEA`. The Lumen flies there and lights it; the room display follows into focus mode; Ana's phone (not following) shows "Agent is presenting Promotions performance · Go" | "The agent can show you something without changing anything." |
| 4:40 | **Close** | `O`: the camera rises to overview. Every station, rebuilt; the trace ring lists every change, agent and human; the presenter switches the room display to Plan view and back to show the same app flat | "A room you can stand in, built and rebuilt live, and every pixel of it still a real, accessible application." |
| 5:00 | End | | |

**Fallbacks during the demo.** If the agent stalls, `pnpm tsx scripts/rebuild-live.ts` drives the same `site.*`
sequence (the actor is then a service, shown as a hollow mote, which the presenter names). If the room display's GPU
fails, it is already on the WebGL2 path in its second browser profile, which the presenter switches to; Plan view is
the last fallback and shows the same rebuild flat.

---

## Requirement 12. A plan ordered by dependency

Each step names what it touches and what it unblocks. Steps on the same line of the graph can proceed in parallel.
Gates are measured checks that must pass before the steps after them start; they come from Requirement 13.

```
 S1 client ---------------------------------------------.
 S2 text --------.                                       \
 S3 scene core --+--> G1 (text and mirror spike gate) --> S4 ui kit --> S5 testkit --> S6 shell + page host
 S7 looks ------' (needs S3)                                                  |
                                                                              v
                       S8 widgets A | S9 widgets B | S10 widgets C | S11 widgets D   (parallel by package)
                                                                              |
 S12 server: forward ui.present  ------------------------------------------.  |
                                                                            v v
                                  S13 choreography (threads, Lumen, weave, ghosts, trace, present)
                                                                              |
                                  S14 phone + governor     S15 Plan and Plain paths
                                                                              |
                                  G2 (performance and a11y gate) --> S16 demo rehearsal --> S17 cutover
```

| Step | Touches | Depends on | Unblocks |
|---|---|---|---|
| **S1 orbit-client** | New package: port `api.js`, `rt.js` (with the DOM-round fixes), `router.js` (pose-aware query params), `stores.js`, `identity.js`, `bus.js` to TypeScript; the generated `widget-schemas.ts` and `action-routes.ts` targets added to `pnpm schema:gen` | `packages/spec` | S6, S8 to S11, S13 |
| **S2 orbit-text** | Atlas build script and CLI wiring; the atlas manifest format; run splitting, bidi, line breaking, tnum; runtime SDF run cache; hinted small-text cache | none | G1, S4 |
| **S3 orbit-scene core** | Renderer init with backend selection and device-loss handling; render graph F0 to F10 with placeholder materials; slab, wall, floor, ui-rect and ui-glyph materials; MRT and composite; camera rig and ring placement; ray picking | three.js pinned | G1, S4, S7 |
| **G1 text and mirror spike gate** | One station with `points.ledger` (912 rows), `points.transfer` and `admin.matrix` at 1280 x 800, on WebGPU and WebGL2: text SSIM, overlay drift, ledger scroll frame times, axe and parity on the mirror, one IME test | S2, S3, and the minimal parts of S4 they need | Everything after; failure triggers kill criterion K1 or K2 (13.2) |
| **S4 orbit-ui** | JSX factory, reconciler, all primitives, Yoga bridge, table, chart and matrix layouts, mirror projector with panel containers and overlay sync, probes (rem, spacing, forced colours), input routing, focus ring feed | G1 | S5, S6, S8 to S11 |
| **S5 orbit-testkit** | Harness hooks (`renderOnce`, frozen clock, seeds), golden runner, parity checks, overlay sync check, recorded rt sessions, `orbit-bench` scaffolding, CI job definitions for SwiftShader WebGPU and WebGL2 | S3, S4 | All verification from S6 on |
| **S7 orbit-looks** | Six presets with light and dark, LDR and high-contrast derivation, System look, contrast checker, `plain.css` generation | S3 | S6, contrast tests |
| **S6 orbit-shell and page host** | HUD (top bar, dial, palette, toasts, banners, bell popover, identity switcher, session revoked), page host (resolve -> stations and layers, push-down layout, focus mode, lens), router-to-pose mapping, trace ring (static), `defineWidget` runtime with the "widget not built yet" placeholder so widget packages land independently | S1, S4, S5, S7 | S8 to S11, S13 |
| **S8 widgets, package A** | messaging (4), notifications (4), people (6), search (1) | S6 | S13, G2 |
| **S9 widgets, package B** | points (8), store (8), badges (4), including the ledger pillars and tier stair Stage3D views | S6 | S13, G2 |
| **S10 widgets, package C** | promotions (5), automation (3), content (5), segments (3), calendar (2), including the step graph and population field and the block editor overlays | S6 | S13, G2 |
| **S11 widgets, package D** | reporting (10), approvals (1), tasks (3), audit (3), admin (5), settings (1), pages (1), including the chart kit, hash chain, permission layers, and the Workshop | S6 | S13, G2 |
| **S12 server: `ui.present` forwarding** | The rt gateway LISTENs on `plinth_present` and delivers `kind: "present"` items to matching sessions; a test in `packages/api` beside `beat5.test.ts` | none | S13's present cue |
| **S13 choreography** | Choreographer cues; threads, rim pulse, row glow, motes; the Lumen (path, light, idle); weave and unweave; ghosts and solidify; the look sweep; station rise and sink; follow pose and off-screen indicator; presentResolver and the presentation panel; announcements wording | S6, at least one widget package for real targets, S12 for present | G2, S16 |
| **S14 phone and governor** | Narrow layout, dial carousel, gestures, `visualViewport` handling, phone render settings, frame-time governor, low power | S6, S13 | G2 |
| **S15 Plan view and Plain path** | Plan pipeline set as the first-frame path and as the user mode; Plain path stylesheet and the mirror-visible switch | S6, S7 | G2 |
| **G2 performance and accessibility gate** | `orbit-bench` on the reference hardware; the full a11y suite including the NVDA and VoiceOver task scripts; contrast tests in every look; the 10-minute phone thermal run | S8 to S15 | S16; failures map to K3 to K7 |
| **S16 demo rehearsal** | `scripts/rebuild-live.ts` reviewed against the new choreography; the cue card; the room display's two browser profiles; recorded-session replay of the whole script as a test | G2 | S17 |
| **S17 cutover** | `orbit-app` served at the Suite's web origin; `packages/web` removed after the last route parity check; the DOM-round prototypes in `public/proto/` kept as a record | S16 | none |

---

## Requirement 13. Risks and kill criteria

### 13.1 The risks, specifically

| # | Risk | Why it is real | Mitigation in this design |
|---|---|---|---|
| R1 | **Text does not look as good as the browser's** | MSDF is soft below 14 px at DPR 1; hinting and subpixel positioning are what make DOM text crisp on Windows | Pixel snapping, hinted small-text path at rest, gamma matching, SSIM gate against DOM text (G1) |
| R2 | **The mirror drifts from the picture** | Two layout systems (Orbit's for placement, the browser's for line content inside each positioned line) can disagree by sub-pixels; transforms update after the GPU frame | One layout authority (Orbit positions every line), same font file, per-frame panel-container transforms after the GPU frame, drift tests |
| R3 | **Assistive technology quirks with a transformed, transparent DOM** | Some AT (older JAWS, Dragon) may mishandle `matrix3d` transforms or transparent text; Windows high contrast and magnifiers depend on geometry | Reading poses use near-identity transforms (pure translation at rest: `matrix3d` reduces to `translate`), transparent text uses `color: transparent` not `opacity: 0`, the scripted AT suite in G2, Plain path as a per-user escape hatch |
| R4 | **Integrated GPUs and phones run hot or drop frames** | Lit slabs, MSAA MRT and bloom are not free; Safari's WebGPU is young | Render on demand, governor, Plan view, phone settings, budgets as gates |
| R5 | **Motion sickness or "it's a game" reaction** | Camera travel and parallax can disturb some users and read as frivolous to enterprise buyers | No roll, fixed FOV, capped angular velocity, critically damped paths, reduced motion honoured fully, calm defaults (meridian and calm are near-still), and Plan view as a first-class mode |
| R6 | **Scope**: every one of 77 widgets must be rebuilt on a new UI kit | The DOM widgets cannot be reused as they are | The UI kit is the leverage: widgets are view trees of about 40 primitives, and the domain logic (actions, events, state) ports across from the DOM widgets almost line for line |
| R7 | **three.js WebGPU API churn** | `WebGPURenderer` and TSL change between releases | Exact pin; Orbit owns its materials and graph ordering; a bump is a separate verified change |
| R8 | **Editing feels foreign** | Overlays in a 3D scene can misalign and confuse | Editing only in reading poses, and long-form editing always in focus mode where the overlay is pixel-exact |
| R9 | **`ui.present` forwarding** does not exist in the gateway yet | It is a server change | Isolated step S12 with its own test; the demo beat has a fallback (the presenter navigates) |

### 13.2 Kill criteria: the measurable signals and what we fall back to

| Id | Signal (measured as stated) | Fallback |
|---|---|---|
| **K1 Text** | At G1: SSIM of Orbit text against DOM text below 0.97 at 13 and 14 px at DPR 1 (hinted path), or below 0.94 at DPR 2 (MSDF), on either reference integrated machine; or 3 of 5 internal reviewers prefer the DOM rendering in a blind side-by-side of the ledger and matrix | **Hybrid content**: panel faces' text and controls are rendered by the mirror itself (visible DOM, CSS3D-transformed into the panels), and the GPU draws everything else (room, slabs, light, Lumen, threads, data objects). Requirement 3's MSDF path stays for HUD numerals, lintels and the trace ring. The rest of this spec is unchanged |
| **K2 Mirror parity and AT** | At G1 or G2: any axe serious or critical violation that is caused by the transformed mirror; any of the 12 scripted AT tasks failing on NVDA or VoiceOver after one fix round; overlay drift above 1 px at rest | Mirror rendered without transforms at rest (absolute 2D positions, which is exact at rest), and per-user "Plain path" offered on first Tab press as "Use the document view"; if still failing, K1's hybrid |
| **K3 Frame time** | At G2 on the integrated tier: p95 GPU above 16.7 ms at a station at rest with ambient on, or more than 2 frames over 33 ms during any camera move, or the ledger scroll dropping below 60 Hz | Integrated tier defaults to Plan view with camera travel; full lighting becomes opt-in |
| **K4 Phone thermals** | On iPhone 13: governor reaches level 3 within the 10-minute scripted session, or p95 drift above 30% | Phones default to Plan view; the room becomes the overview only |
| **K5 First paint** | p75 first meaningful paint above 1.5 s on integrated or 3.5 s on iPhone 13 (4G profile) | Ship the Plan pipeline set only on first load and stream the rest; if still failing, defer the three.js lit materials into a second chunk and accept Plan-first boot everywhere |
| **K6 Input** | IME tests failing on any of Japanese, Korean or Chinese in the palette or content editor; or autofill not populating the transfer and compose forms in Chrome and Safari | Edit fields render as visible native inputs (DOM text) at all times, not only while focused |
| **K7 Bundle** | Initial JS above 450 KB compressed | Remove the lit pipeline set from the initial chunk (as K5) |

Kill criteria are evaluated at the gates of Requirement 12 and recorded on the Workgraph task with the measurements.

### 13.3 Honest comparison with "keep the DOM app and add a GPU layer"

The alternative: keep the Meridian-derived DOM Suite, and add a WebGPU canvas behind and around it (an animated
backdrop, page transitions, agent effects, maybe CSS 3D transforms on the panels).

| Property | DOM + GPU layer | Orbit |
|---|---|---|
| Text quality and i18n | Native, best possible, no work | Must be earned (R1); matched by tests, with K1's hybrid as the floor |
| Forms, IME, autofill, selection | Native | Native too (overlays and the aligned mirror), with alignment work |
| Accessibility | Native semantics; still needs the DOM round's fixes | The same native semantics (the mirror is real DOM) plus geometry alignment work; Plain path exists |
| Spatial navigation (route = camera path) | CSS 3D can fake transitions, but the page and the room are different worlds; the GPU layer cannot occlude or light DOM content | One world: panels are lit by the same light, cast shadows on the same walls, and stand in the same room the camera moves through |
| Causality threads across domains | The canvas can draw lines over the page, but they cannot pass behind panels, land on their bevels, or follow panels in perspective | Threads are scene objects with depth and light |
| The rebuild | Panels fade and slide into a grid | A visible agent builds each panel in place, physically, while every screen watches |
| Looks | Palettes and CSS hooks | Whole rooms (light, material, palette) switched by a wave |
| Risk | Low | Medium to high, gated by K1 to K7 |
| Fallbacks | It is the fallback | Plan view, Plain path, and K1's hybrid, all from the same widget code |

The honest summary: the DOM-plus-GPU-layer approach would be better at text out of the box and would carry less
risk, and it would still look like a website with effects around it, which is the owner's complaint. Orbit is
designed so that its worst outcome, if K1 fires, is close to the best version of the alternative (GPU room, real DOM
text in the panels), while its intended outcome is a workspace that the DOM cannot express.

---

## Appendix S. Shader listings

All materials are TSL node graphs in `packages/orbit-scene/src/materials/`, so the same source compiles to WGSL
(WebGPU) and GLSL ES 3.00 (WebGL2). Sketches below show the exact maths; imports are from `three/tsl` and
`three/webgpu`. Per-instance data uses `InstancedBufferAttribute`s read with `attribute()`; per-panel data is a
`DataTexture` (`RGBA32F`, 8 texels per panel) read with `textureLoad`, which works on both backends.

### S.0 Shared helpers

```js
import { Fn, float, vec2, vec3, vec4, abs, max, min, length, clamp, smoothstep, mix, dot, exp, sqrt,
         fwidth, floor, fract, sin, atan, PI, ivec2, int, textureLoad, uniform } from "three/tsl";

// Signed distance to a rounded box centred at 0 with half-size b and radius r (CSS px units).
export const sdRoundRect = Fn(([p, b, r]) => {
  const q = abs(p).sub(b).add(r);
  return length(max(q, 0.0)).add(min(max(q.x, q.y), 0.0)).sub(r);
});

// Panel record: 8 texels per panel in panelTex (width = 8 * maxPanels).
//  t0..t3 model matrix columns | t4 (w, h, radius, tier) | t5 (weaveT, fillT, revealT, dim)
//  t6 (rimT, agentGlow, aligned, ghost) | t7 (weaveOriginX, weaveOriginY, sweepMix, reserved)
export const panelTexel = Fn(([tex, panel, i]) => textureLoad(tex, ivec2(panel.mul(8).add(i), int(0))));

// Cheap blue-noise lookup (64x64 r8 generated at boot) for dissolves and dither.
export const blueNoise = Fn(([tex, px]) => textureLoad(tex, ivec2(px.mod(64.0))).r);

// 45-degree hatch: stripes of 'ink' px every 'period' px, anti-aliased with fwidth. Returns 0..1 coverage.
export const hatchStripe = Fn(([p, period, ink]) => {
  const u  = p.x.add(p.y).mul(0.70710678);                     // distance along the 45-degree normal
  const t  = fract(u.div(period)).sub(0.5).abs().mul(period);  // px from the stripe centre
  const aa = fwidth(u).max(1e-4);
  return clamp(ink.mul(0.5).sub(t).div(aa).add(0.5), 0.0, 1.0);
});

// Gaussian-integrated rounded-rect shadow (after Evan Wallace's closed form, erf approximation).
const erf2 = Fn(([x]) => {           // vec2 erf approximation, max error ~5e-4
  const s = x.sign(), a = abs(x);
  const t = a.mul(a.mul(a.mul(0.078108).add(0.230389)).add(0.278393)).add(1.0);
  return s.sub(s.div(t.mul(t).mul(t).mul(t)));
});
export const roundRectShadow = Fn(([p, half, radius, sigma]) => {
  // Approximation: integrate a Gaussian over a box shrunk by the radius, then soften by the radius.
  const lo = half.negate().add(radius), hi = half.sub(radius);
  const k = float(0.70710678).div(sigma);
  const ix = erf2(vec2(p.x.sub(lo.x), hi.x.sub(p.x)).mul(k));
  const iy = erf2(vec2(p.y.sub(lo.y), hi.y.sub(p.y)).mul(k));
  return clamp(ix.x.add(ix.y).mul(0.5).mul(iy.x.add(iy.y).mul(0.5)), 0.0, 1.0);
});
```

### S.1 Slab (lit panel body) and face write

```js
// slabMaterial: MeshStandardNodeMaterial-like but hand-built; geometry is a unit quad per panel scaled in the
// vertex stage, extruded 'depth' units, with the bevel computed analytically from the rounded-box SDF.
const slabFragment = Fn(() => {
  const panel   = attribute("iPanel", "uint");
  const size    = panelTexel(panelTex, panel, 4).xy;           // CSS px
  const radius  = panelTexel(panelTex, panel, 4).z;
  const st5     = panelTexel(panelTex, panel, 5);              // weaveT, fillT, revealT, dim
  const st6     = panelTexel(panelTex, panel, 6);              // rimT, agentGlow, aligned, ghost
  const p       = vLocal.xy.sub(size.mul(0.5));                // panel-local, centred
  const d       = sdRoundRect(p, size.mul(0.5), radius);

  // Analytic coverage for the outline (no MSAA needed on phones).
  const aa      = fwidth(d);
  const cover   = clamp(float(0.5).sub(d.div(aa)), 0.0, 1.0);

  // Bevel normal: gradient of the SDF over the bevel band [-bevel, 0].
  const bevel   = lookUniforms.bevelPx;
  const inBevel = smoothstep(bevel.negate(), 0.0, d);          // 0 on the face, 1 at the edge
  const grad    = vec2(dFdx(d), dFdy(d)).normalize();          // screen-space gradient approximates outward dir
  const nLocal  = normalize(vec3(grad.mul(inBevel), float(1.0).sub(inBevel.mul(0.85))));
  const n       = panelNormalMatrix(panel).mul(nLocal).normalize();

  // Lighting: key (sphere light approx.), hemisphere fill, rim, Lumen point light. GGX only on the bevel.
  const v       = cameraDir(vWorld);
  const key     = sphereLight(n, v, vWorld, keyPos, keyRadius, keyColor, roughness).mul(inBevel.add(0.08));
  const fill    = mix(fillBottom, fillTop, n.y.mul(0.5).add(0.5));
  const lumen   = pointLight(n, v, vWorld, lumenPos, lumenColor, lumenIntensity, roughness);
  const rim     = smoothstep(bevel.negate().mul(0.35), 0.0, d).mul(st6.x).mul(rimIntensity).mul(accentLinear);

  // Weave: fill dissolves in through blue noise as fillT goes 0 -> 1 (S.4); outside it, discard.
  const noise   = blueNoise(noiseTex, vLocal.xy);
  const fillMask= step(noise, st5.y.mul(1.15).sub(edgeFalloff(d, size)));
  If(cover.mul(fillMask).lessThan(0.002), () => Discard());

  const albedo  = slabEdgeColor;                               // the bevel and sides; the face is in the UI layer
  const hdr     = albedo.mul(key.add(fill).add(lumen)).add(rim).mul(float(1.0).sub(st5.w.mul(0.6)));
  const emissive= rim.add(lumen.mul(st6.y).mul(0.4));
  // Face: write the token face colour into the UI target, unlit, plus the bounded sheen (|dL| <= 0.015).
  const sheen   = sheenTerm(n, v).mul(lookUniforms.sheenMaxDeltaL);  // applied in OKLab L, clamped
  const face    = applySheen(faceToken, sheen).mul(float(1.0).sub(inBevel));
  return { hdr: vec4(hdr, cover), emissive: vec4(emissive, cover), ui: vec4(face.rgb.mul(cover), cover) };
});
// slabMaterial.mrtNode = mrt({ output: hdr, emissive, ui }) with blend: hdr/emissive alpha-over, ui REPLACE
// (so a front panel's face clears whatever UI content of a farther panel lay under it).
```

### S.2 Floor and wall: analytic soft shadows

```js
const wallFragment = Fn(() => {
  let occl = float(1.0);
  Loop({ start: 0, end: casterCount }, ({ i }) => {            // casterCount <= 32 (12 on phones)
    const c      = casters.element(i);                         // uniform array: centre.xy, half.xy, radius, elev
    const sigma  = c.elev.mul(shadowSoftness).add(2.0);        // higher tiers cast softer shadows
    const offset = keyDirOnWall.mul(c.elev.mul(0.6));          // shadow shifts away from the key light
    const s      = roundRectShadow(vWall.sub(c.centre).sub(offset), c.half, c.radius, sigma);
    occl.assign(occl.mul(float(1.0).sub(s.mul(shadowOpacity))));
  });
  // Second, sharper shadow from the Lumen when it is within 0.5 d of the wall.
  const lumenShadow = lumenCasterShadow(vWall, casters, lumenPos).mul(lumenNear);
  const base = wallColor.mul(fillAt(vWall)).mul(occl).mul(float(1.0).sub(lumenShadow.mul(0.35)));
  return { hdr: vec4(base, 1.0), emissive: vec4(0.0), ui: vec4(0.0) };
});
// The floor uses the same loop over the stations' panel footprints projected straight down (sigma from height),
// plus the ring rules: smoothstep bands at |r - Rrule| with fwidth AA, arc gates as gaps, station markers as SDF discs.
```

### S.3 UI content: rects and glyphs (the legibility path)

```js
// One instanced quad per rect or glyph. Vertex stage places the quad in panel-local px, applies the panel model,
// and snaps to the device pixel grid when the panel's 'aligned' flag is set (B.3 rule 3).
const uiVertex = Fn(() => {
  const panel  = attribute("iPanel", "uint");
  const rect   = attribute("iRect", "vec4");                   // x, y, w, h in panel px
  const corner = positionLocal.xy;                             // 0..1
  const local  = rect.xy.add(rect.zw.mul(corner));
  const world  = panelModel(panel).mul(vec4(local.x, local.y.negate(), tierZ(panel), 1.0));
  const clip   = cameraProjectionMatrix.mul(cameraViewMatrix).mul(world);
  const aligned= panelTexel(panelTex, panel, 6).z;
  const snapped= snapToPixel(clip, viewportPx);                // round(ndc * vp / 2) * 2 / vp, keeping w
  vLocal.assign(local); vRectUv.assign(corner);
  return mix(clip, snapped, aligned);
});

// Rect fragment: rounded rect fill + stroke + optional hatch / dash; exact token colour; clip rect discard.
const uiRectFragment = Fn(() => {
  const rect = attribute("iRect", "vec4"), radii = attribute("iRadii", "vec4");
  const fill = unpackColor(attribute("iFill", "uint")), stroke = unpackColor(attribute("iStroke", "uint"));
  const flags = attribute("iFlags", "uint"), strokeW = attribute("iStrokeW", "float");
  const clipR = clipRects.element(attribute("iClip", "uint"));
  If(outside(vLocal, clipR), () => Discard());
  const p  = vLocal.sub(rect.xy).sub(rect.zw.mul(0.5));
  const r  = pickCornerRadius(p, radii);
  const d  = sdRoundRect(p, rect.zw.mul(0.5), r);
  const aa = fwidth(d).max(1e-4);
  const inside = clamp(float(0.5).sub(d.div(aa)), 0.0, 1.0);
  const ring   = clamp(float(0.5).sub(abs(d.add(strokeW.mul(0.5))).sub(strokeW.mul(0.5)).div(aa)), 0.0, 1.0);
  // Hatch (breach, held, low stock): 45-degree stripes, 6 px period, 2 px ink, in the hatch token.
  const hatchOn = flagSet(flags, HATCH);
  const stripe  = hatchStripe(vLocal, 6.0, 2.0);
  const base    = mix(fill, hatchToken, stripe.mul(hatchOn));
  const col     = mix(base.mul(inside), stroke, ring);         // premultiplied
  const reveal  = revealMask(attribute("iPanel", "uint"), vLocal.y); // S.4 row-by-row reveal
  return { ui: col.mul(reveal) };                              // writes only the ui MRT
});

// Glyph fragment: MTSDF median with screen-space range; true SDF in alpha keeps corners at large sizes.
const uiGlyphFragment = Fn(() => {
  const uvRect = attribute("iUv", "vec4");                     // atlas rect in texels
  const color  = unpackColor(attribute("iColor", "uint"));
  If(outside(vLocal, clipRects.element(attribute("iClip", "uint"))), () => Discard());
  const tuv    = mix(uvRect.xy, uvRect.zw, vRectUv).div(atlasSize);
  const s      = texture(atlas, tuv);
  const med    = max(min(s.r, s.g), min(max(s.r, s.g), s.b));
  const sd     = mix(med, min(med, s.a), smallSizeWeight);      // blend toward true SDF for very large text
  const unit   = vec2(pxRange).div(atlasSize);
  const screenTex = vec2(1.0).div(fwidth(tuv));
  const spr    = max(float(0.5).mul(dot(unit, screenTex)), 1.0);
  let   a      = clamp(spr.mul(sd.sub(0.5)).add(0.5), 0.0, 1.0);
  a = pow(a, select(darkOnLight, float(1.0 / 1.25), float(1.0)));  // stem weight match (3.3)
  const reveal = revealMask(attribute("iPanel", "uint"), vLocal.y);
  return { ui: vec4(color.rgb.mul(a), a).mul(color.a).mul(reveal) };
});
// ui-glyph-sdf (runtime runs): the same with sd = s.r. ui-glyph-bitmap (hinted small text): a = s.r, no range maths.
```

### S.4 Weave and unweave (materialisation)

Driven by three per-panel parameters in `panelTex` t5 (`weaveT`, `fillT`, `revealT`) and the origin in t7, animated
by the choreographer (6.5 step 4): edge trace over `weaveT` 0 -> 1 (350 ms), fill over `fillT` 0 -> 1 (300 ms),
content reveal over `revealT` 0 -> 1 (per row, 40 ms per 32 px). Unweave plays the same in reverse with the origin
at the point nearest the Lumen.

```js
// Edge trace, in the slab fragment before the face write.
const perimeterParam = Fn(([p, half]) => {                    // 0..1 around the outline, starting at origin
  const ang = atan(p.y, p.x).div(PI.mul(2.0)).add(0.5);
  const o   = atan(origin.y, origin.x).div(PI.mul(2.0)).add(0.5);
  return fract(ang.sub(o));
});
const traceFragment = Fn(() => {
  const u      = perimeterParam(p, size.mul(0.5));
  const both   = min(u, float(1.0).sub(u)).mul(2.0);           // grows symmetrically both ways from the origin
  const onEdge = float(1.0).sub(smoothstep(0.0, 1.5, abs(d)));  // 1.5-px line
  const lit    = step(both, weaveT).mul(onEdge);
  const head   = exp(both.sub(weaveT).mul(both.sub(weaveT)).mul(-400.0)).mul(onEdge);   // bright leading point
  return { emissive: agentLinear.mul(lit.mul(0.6).add(head.mul(3.0))), hdr: agentLinear.mul(lit.mul(0.2)) };
});
// Fill: see slabFragment's fillMask; edgeFalloff(d, size) = clamp(-d / (0.5 * min(size.x, size.y)), 0, 1) so the
// fill grows from the traced edge inward. Reveal: revealMask(panel, y) = step(y, revealT * contentHeight).
// Reduced motion: the choreographer sets weaveT = fillT = 1 and fades revealT over 200 ms.
```

### S.5 Threads

```js
// Each thread is one instanced ribbon of 48 segments along a quadratic Bezier P0 -> P1 -> P2 (world), P1 lifted
// to apex 0.12 R above the floor midpoint. The vertex stage expands the ribbon to a constant 3-px screen width.
const threadVertex = Fn(() => {
  const s   = float(vertexSegment).div(48.0);
  const P   = bezier2(iP0, iP1, iP2, s);
  const T   = bezier2Tangent(iP0, iP1, iP2, s).normalize();
  const clip= viewProj.mul(vec4(P, 1.0));
  const side= screenSideVector(T, clip).mul(vertexSide).mul(1.5).mul(pxToNdc);
  vS.assign(s);
  return clip.add(vec4(side.mul(clip.w), 0.0, 0.0));
});
const threadFragment = Fn(() => {
  const base   = float(0.18).mul(smoothstep(0.0, 0.08, vS)).mul(smoothstep(1.0, 0.92, vS));
  const packet = exp(vS.sub(iPacket).mul(vS.sub(iPacket)).mul(-900.0));  // iPacket 0 -> 1 over 700 ms
  const fade   = iLife;                                          // 1 -> 0 over 600 ms after arrival
  const c      = threadColor.mul(base.add(packet.mul(4.0))).mul(fade);
  return { hdr: vec4(c, 0.0), emissive: vec4(c.mul(packet.add(0.1)), 0.0) };   // additive blend, no ui write
});
```

### S.6 The Lumen

```js
// The Lumen is (a) a uniform light read by slab, wall and floor; (b) a camera-facing sprite for its halo;
// (c) a small octahedron mesh for its core, so it has a shape (not colour alone) and catches the key light.
const lumenSprite = Fn(() => {
  const r     = length(vRectUv.sub(0.5)).mul(2.0);
  const halo  = exp(r.mul(r).mul(-6.0)).mul(lumenIntensity).mul(activity);    // activity: idle 0.35, working 1.0
  const pulse = float(1.0).add(sin(time.mul(2.4)).mul(0.06).mul(motionAllowed)); // under 1 Hz, 6%
  return { hdr: vec4(lumenColor.mul(halo).mul(pulse), 0.0), emissive: vec4(lumenColor.mul(halo), 0.0) };
});
// Flight: the choreographer moves the Lumen along a Catmull-Rom path through (current, lift point 0.3 d above,
// target - 120 * wallNormal) with a critically damped spring; speed capped at 1.6 d per second. Under reduced
// motion the Lumen is placed at the target and a static beam (a thread with iPacket fixed) joins it to the panel.
```

### S.7 Ghost (held change)

```js
const ghostFragment = Fn(() => {
  const d      = sdRoundRect(p, size.mul(0.5), radius);
  const inside = clamp(float(0.5).sub(d.div(fwidth(d))), 0.0, 1.0);
  const dash   = step(0.5, fract(perimeterParam(p, size.mul(0.5)).mul(perimeterPx.div(12.0))));  // 6-on/6-off
  const edge   = float(1.0).sub(smoothstep(0.0, 1.5, abs(d))).mul(dash);
  const hatch  = hatchStripe(vLocal, 10.0, 2.0);
  const a      = inside.mul(0.10).add(hatch.mul(inside).mul(0.22)).add(edge.mul(0.9));
  return { ui: vec4(accent.rgb.mul(a), a) };     // drawn in the UI layer so its label text stays exact
});
// Reduced transparency: a = inside * 0 + hatch * 0.5 + edge, on an opaque face token background.
```

### S.8 Look sweep

```js
// Both look uniform blocks are bound during a sweep. For any world position, its angular distance from the
// sweep origin (the Lumen's ring angle) is compared with the advancing front (120 deg per second).
const sweepMix = Fn(([worldPos]) => {
  const ang   = atan(worldPos.z, worldPos.x);
  const dist  = abs(wrapPi(ang.sub(sweepOrigin)));               // 0..PI
  return smoothstep(sweepFront.sub(sweepWidth), sweepFront, dist).oneMinus();   // 1 = new look
});
// Every environment, wall, slab, thread and Lumen parameter is mix(lookA.x, lookB.x, sweepMix(vWorld)).
// UI-layer tokens are NOT mixed per fragment: each panel's tokens switch when the front passes its centre,
// via a 200-ms per-panel cross-fade written into panelTex t7.z, so text never sits at an untested contrast.
```

### S.9 Composite

```js
// F7: tonemap the HDR scene (+ bloom), then lay the UI layer over it unchanged.
const composite = Fn(() => {
  const scene = tonemap(hdrTex.sample(uv).rgb.add(bloomTex.sample(uv).rgb.mul(bloomStrength)), look.tonemap);
  const vig   = float(1.0).sub(look.vignette.mul(smoothstep(0.4, 1.0, length(uv.sub(0.5)).mul(1.4))));
  const base  = linearToSrgb(scene.mul(vig)).add(blueNoise(noiseTex, fragCoord).sub(0.5).div(255.0));
  const ui    = uiTex.sample(uv);                                 // premultiplied, sRGB-encoded token colours
  return vec4(base.mul(float(1.0).sub(ui.a)).add(ui.rgb), 1.0);
});
```

---

## Appendix T. Type definitions

All types live in the package named in the comment. They are the contract between packages.

```ts
// ---------- orbit-scene: scene graph ----------
export type SceneId = number & { readonly __scene: unique symbol };

export type SceneKind =
  | "root" | "environment" | "ring" | "station" | "bay" | "layer" | "panel" | "stage3d"
  | "ghost" | "lumen" | "thread" | "hud";

export interface SceneNode {
  id: SceneId;
  kind: SceneKind;
  parent: SceneId | null;
  children: SceneId[];
  local: Float32Array;            // 4x4 column-major, relative to parent
  world: Float32Array;            // cached; recomputed when worldDirty
  worldDirty: boolean;
  bounds: Aabb;                   // world-space, for culling and picking
  visible: boolean;
  layer: "scene" | "hud";
}

export interface Station extends SceneNode {
  kind: "station";
  pageSlug: string;               // the nav page this station shows
  route: string;
  arc: "Personal" | "Rewards" | "Engage" | "Insight" | "Operate" | "Admin" | "Custom";
  theta: Spring<number>;          // ring angle, springs when the ring is recomputed
  facetWidth: number;             // W, CSS px
  lintel: { title: string; dek: string; actions: LintelAction[] };
  marker: { icon: IconId; count: number | null; countKey: keyof NavCounts | null };
  impostor: { texture: RenderTargetHandle | null; dirty: boolean; lastSeq: number };
  bay: SceneId;
  layers: SceneId[];
  state: "rising" | "live" | "sinking";
}

export interface Bay extends SceneNode {
  kind: "bay" | "layer";
  page: ResolvedPage;             // pages.resolve output, cached
  grid: GridMetrics;              // cw, gutter, rh, columns = 12 (or 1 in narrow layout)
  height: number;                 // laid-out height in CSS px after push-down
  panels: SceneId[];
  scrollY: number;                // driven by the mirror's main scroll container
  editing: boolean;               // the Workshop (pages.editor)
}

export interface Panel extends SceneNode {
  kind: "panel";
  gpuIndex: number;               // row in panelTex
  instance: { uri: string; slug: string; widget: string; title: string | null };
  size: WidgetSize;
  cell: LayoutAt;                 // from the Page node
  rect: Rect;                     // bay-local CSS px after push-down
  tier: 0 | 1 | 2 | 3;
  xf: Spring<Transform>;          // position/rotation/scale target for focus, layout moves, weave lift
  aligned: boolean;               // reading-pose test (B.3 rule 3)
  drawList: DrawList;
  mirror: MirrorId;               // the panel's mirror container
  stage3d: SceneId | null;
  fx: PanelFx;
  attribution: { actor: string; onBehalfOf: string | null; seq: number; until: number } | null;
  state: "loading" | "ready" | "empty" | "error" | "unavailable";
}

export interface PanelFx {
  weaveT: number; fillT: number; revealT: number; dim: number;
  rimT: number; agentGlow: number; ghost: boolean;
  weaveOrigin: [number, number];  // panel-local px nearest the Lumen
  tokenMix: number;               // per-panel look cross-fade during a sweep
}

// GPU mirror of Panel (8 texels of RGBA32F in panelTex), packed by orbit-scene/graph.ts
export interface PanelGpu {
  model: Float32Array;            // t0..t3
  sizeRadiusTier: [number, number, number, number];          // t4
  weave: [number, number, number, number];                   // t5: weaveT, fillT, revealT, dim
  state: [number, number, number, number];                   // t6: rimT, agentGlow, aligned, ghost
  extra: [number, number, number, number];                   // t7: originX, originY, tokenMix, reserved
}

// ---------- orbit-ui: draw lists (per panel) ----------
export interface DrawList {
  rects: RectInstanceArray;       // SoA typed arrays, dirty range tracked
  glyphs: GlyphInstanceArray;
  clips: Float32Array;            // vec4 per clip rect (x, y, w, h) in panel px
  objects: Stage3DHandle[];
  dirty: { rects: [number, number] | null; glyphs: [number, number] | null };
}

export interface RectInstanceArray {   // one entry per instance, 48 bytes
  rect: Float32Array;     // x, y, w, h
  radii: Float32Array;    // tl, tr, br, bl
  fill: Uint32Array;      // packed RGBA8 sRGB, premultiplied in shader
  stroke: Uint32Array;
  strokeW: Float32Array;
  panel: Uint32Array;
  clip: Uint32Array;
  flags: Uint32Array;     // HATCH | DASH | SHAPE_DISC | SHAPE_SEGMENT | SELECTED | FOCUS_ANCHOR | ...
  sceneKey: Uint32Array;  // links back to the view node for parity tests and picking
  count: number;
}

export interface GlyphInstanceArray {  // one entry per glyph, 40 bytes
  rect: Float32Array;     // x, y, w, h in panel px (already pixel-snapped at layout when aligned)
  uv: Float32Array;       // atlas rect in texels
  color: Uint32Array;
  panel: Uint32Array;
  clip: Uint32Array;
  page: Uint8Array;       // atlas page or cache page
  path: Uint8Array;       // 0 MTSDF, 1 runtime SDF, 2 hinted bitmap
  sceneKey: Uint32Array;
  count: number;
}

// ---------- orbit-ui: view tree and layout ----------
export interface ViewNode<P = unknown> {
  type: PrimitiveName;
  props: P;
  key: string | number | null;
  children: ViewNode[];
}

export interface LayoutBox {
  x: number; y: number; w: number; h: number;   // panel-local CSS px
  baseline?: number;
  minH?: number;                                 // a primitive's declared minimum content height
  lines?: TextLine[];                            // for text: one entry per laid-out line
}

export interface TextLine {
  text: string;                                  // logical order
  visual: GlyphRun[];                            // visual-order runs with their path (atlas, runtime, hinted)
  x: number; y: number; w: number; ascent: number; descent: number;
  dir: "ltr" | "rtl";
}

// ---------- orbit-ui: the accessibility mirror ----------
export type MirrorId = string;                   // "m-<widget-slug>-<view-key>", stable across renders

export interface MirrorNode {
  id: MirrorId;
  sceneKey: number | null;                       // the view node's key in the draw list (parity link)
  tag: keyof HTMLElementTagNameMap;              // "button", "a", "input", "section", "table", "span", ...
  role?: string;                                 // only when the tag does not imply it
  attrs: Record<string, string>;                 // aria-*, href, type, name, autocomplete, inputmode, dir, ...
  text?: string;                                 // text content (never null; empty string when none)
  lines?: { text: string; x: number; y: number; w: number; h: number }[];  // positioned line spans
  box: { x: number; y: number; w: number; h: number } | null;              // panel-local CSS px
  focusable: boolean;
  editable: boolean;                             // native field: overlay rules of 4.2 apply
  inert: boolean;                                // stations other than the current one
  children: MirrorId[];
}

export type MirrorPatch =
  | { op: "create"; node: MirrorNode; parent: MirrorId; before: MirrorId | null }
  | { op: "update"; id: MirrorId; attrs?: Record<string, string | null>; text?: string; lines?: MirrorNode["lines"];
      box?: MirrorNode["box"] }
  | { op: "move"; id: MirrorId; parent: MirrorId; before: MirrorId | null }
  | { op: "remove"; id: MirrorId }
  | { op: "panelTransform"; panel: MirrorId; matrix3d: string };   // per frame during motion only

// ---------- orbit-scene: camera ----------
export type Pose =
  | { kind: "overview"; yaw: number }
  | { kind: "station"; station: string; scrollY: number }
  | { kind: "layer"; station: string; layer: string; scrollY: number }
  | { kind: "focus"; base: Pose; panel: string }
  | { kind: "follow"; target: string };

export interface CameraPath {
  from: CameraState; to: CameraState;
  controls: CameraState[];                       // centripetal Catmull-Rom control poses
  durationMs: number;                            // 420 + 260 * |dTheta| / PI, max 900; 160 fade when reduced motion
  mode: "arc" | "overview-hop" | "dolly" | "fade";
}
export interface CameraState { position: Vec3; yaw: number; pitch: number }   // roll is always 0; FOV fixed 40

// ---------- orbit-shell: choreography cues ----------
export type Cue =
  | { t: "thread"; from: Anchor; to: Anchor; color: "agent" | "person" | "system" | "self"; causeSeq: number }
  | { t: "rimPulse"; panel: string }
  | { t: "rowGlow"; panel: string; sceneKey: number }
  | { t: "lumenMove"; to: Anchor; activity: "working" | "idle" }
  | { t: "weave"; panel: string; origin: Anchor }
  | { t: "unweave"; panel: string; origin: Anchor; delayMs: number }
  | { t: "stationRise" | "stationSink"; station: string }
  | { t: "ghost"; approvalId: string; target: Anchor; label: string }
  | { t: "solidify" | "dissolve"; approvalId: string; by: string }
  | { t: "lookSweep"; to: LookId; origin: Anchor }
  | { t: "mote"; panel: string; actor: string; kind: "person" | "system" }
  | { t: "traceTick"; seq: number; actor: string; summary: string; node: string; agent: boolean; held: boolean }
  | { t: "present"; target: Anchor; focus: { parameter: string; value: string | number | boolean } | null;
      follow: boolean }
  | { t: "toast"; toast: ToastSpec; origin: Anchor | null }
  | { t: "announce"; text: string; politeness: "polite" | "assertive" };

export type Anchor =
  | { kind: "panel"; slug: string }
  | { kind: "station"; slug: string }
  | { kind: "hud"; element: "balance" | "bell" | "inbox" | "cart" }
  | { kind: "lumen" }
  | { kind: "point"; world: Vec3 };
```
