# 00. Mobile first

Part of the Township canonical spec (`README.md`). Requirement IDs are `TWN-R-0.<section>.<n>`. This file binds every
other file: where 01 to 07 and this file differ on layout, input, tiers or budgets, this file wins.

The owner's instruction (WG-5536): "make it mobile-first design ... i dont just want mobile stuff patched on i want it
designed mobile first and then 'expansive' for desktop". Every screen in this spec is therefore designed first for a
phone held upright in one hand. Tablet and desktop layouts are written as **expansions** of that design, and nothing
exists on desktop without a phone equivalent. The README's ruling log ("Mobile-first restructure" and "Mobile review")
lists what changed, what was torn out and what was ruled against.

---

## 0.1 Principles

1. **The phone is the design target.** Every screen, interaction and budget is specified first for the primary target
   (section 0.2). A design that works only with a mouse, a keyboard, hover, a wide viewport or a discrete GPU is not a
   design in this spec.
2. **Expansion, not adaptation.** Wider screens get *more of the same design at once*: more panes visible, the town
   vista widening, side-by-side interiors, hover previews, keyboard accelerators and higher quality tiers. They never
   get a different concept. Each expansion is written as a rule on a named breakpoint (section 0.3).
3. **No desktop-only concept.** Every capability available at an expanded width has a phone equivalent that reaches
   the same data and the same actions, including client-only capabilities such as sorting, filtering and view changes.
   Section 0.7 is the equivalence table, and each row is tested.
4. **The thumb decides placement.** Every control a task uses more than once lives in the bottom thumb zone; the top of
   the screen is for reading (section 0.4).
5. **Gestures are primary, never exclusive.** Touch gestures are the fast path on a phone, and every gesture has a
   visible single-pointer, non-path alternative (WCAG 2.5.1, 2.5.7). No gesture is the only way to do anything
   (section 0.5).
6. **One focused thing at a time on a phone.** A phone shows one pane, one sheet or one borough in focus. Wider screens
   show several at once by the expansion rules; they do not change what each one is.
7. **The phone has a vote in the information architecture.** A page's phone order and card kinds are authored data on
   the Page node, not a reflow of the desktop grid (`02` section 2.1, `06` section 6.8).
8. **The baseline tier is the mid-range phone.** The Base rendering tier must meet its budgets on the mid-range phone
   class. On phones text is the browser's own (hybrid text); higher tiers add effects, and GPU text only with a fine
   pointer. Nothing that carries meaning is added by a higher tier (section 0.6).
9. **Containers, not devices.** Layout follows the width of the container it lives in: the shell follows the app
   container, and a widget follows its own pane. A widget in a narrow desktop column uses the same presentation as on
   a phone, from the same code.
10. **Every requirement stays testable.** Phone behaviour is tested first, in the default harness viewport (section
    0.8), and desktop is the expansion pass.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-0.1.1 | No route, control, view or action exists only at medium width or wider: for every interactive capability found at 1440 × 900 there is an equivalent at 390 × 844 that reaches the same data and has the same effect. Capabilities are inventoried from the **Plat's controls** (every button, link, input, menu item and segmented option, classified by the kit's capability tag: `action:<name>`, `sort:<column>`, `filter:<field>`, `view:<presentation>`, `select`, `copy`, `export`, `navigate:<route>`), not only from server actions. | Capability inventory job: crawl every route × persona at 1440 × 900 and at 390 × 844 with touch, opening every menu and sheet; collect the capability tags and the Plat data cells reachable; assert the 390 sets contain the 1440 sets. |

## 0.2 The primary target and the mobile-web platform

| Property | Value |
|---|---|
| Orientation | portrait first; landscape is the **short** layout (section 0.3.3) |
| Width | 360 to 430 CSS px (design width 390; test widths 360, 390 and 430) |
| Height | 640 to 932 CSS px (design height 844) |
| Device pixel ratio | 2 to 3 (test DPRs 2, 2.625 and 3) |
| Input | touch, one hand, thumb; no hover; an on-screen keyboard that covers up to 40 % of the height in portrait |
| Assistive technology | VoiceOver on iOS Safari, TalkBack on Android Chrome; switch access; Voice Control; system text size up to 200 % |
| GPU class | mid-range: Qualcomm Adreno 6xx class (Android) or Apple A15 class (iPhone 13) |
| Thermal | sustained load throttles within minutes; the design never relies on sustained peak GPU clocks |
| Network | variable: the design network is 1.6 Mbit/s down, 750 kbit/s up, 150 ms round trip (Lighthouse "slow 4G"), with drops to offline |
| Graphics API | WebGL2 is the common case on a LAN over plain HTTP; WebGPU when the page is a secure context and the browser and GPU expose it (section 0.9) |

### 0.2.1 Viewport model

- **The document scrolls.** At compact width the page content (the lobby, a room's list, a borough street) is the
  document's own scroller (`document.scrollingElement`), so Safari's and Chrome's toolbars collapse while scrolling and
  the content gets the extra height. The top bar is `position: sticky; top: 0`; the bottom bar, room dock and status
  layer are `position: fixed` at the bottom with `env(safe-area-inset-bottom)`.
- **The canvas never resizes for toolbars.** The canvas is `position: fixed; inset: 0; height: 100lvh` (the large
  viewport), so a toolbar collapse or re-expansion changes neither its CSS size nor its backing store.
- **Toolbar resizes are not reflows.** A `visualViewport` or window resize in which the width is unchanged, the height
  changes by at most 140 px and no editable element has focus is classed as a **toolbar resize**: it bumps no pane
  epoch, triggers no read batch and reallocates no target (`03` section 3.6). A height change with an editable focused
  is a **keyboard resize** (section 0.4.5). Any width change, orientation change or scale change is a **reflow**.
- **Safe areas:** `viewport-fit=cover`; the shell pads with `env(safe-area-inset-*)` on every edge. The viewport meta
  never disables user scaling.
- **Overscroll:** `html { overscroll-behavior-y: none }` (no pull-to-refresh reload on Android Chrome, no bounce chaining
  into the page), and every sheet, room list and street sets `overscroll-behavior: contain`.

### 0.2.2 Installed and offline

- **Web app manifest** (`/town/manifest.webmanifest`): `name`, `short_name`, `start_url: "/town/"`, `scope: "/town/"`,
  `display: "standalone"`, `orientation: "any"`, theme and background colours from the default look, maskable icons.
  Installed, the app has no URL bar, which also suits the mirrored demo.
- **Service worker** (scope `/town/`, registered only in a secure context): precaches the shell (HTML, critical CSS,
  shell and Plat runtime, the Base engine chunks and the Latin font subset) and caches the town chunk after its first
  use; the API and realtime are always network. An offline cold start shows the shell, the offline banner with Retry
  and an "Offline" page; no data is cached on the device. A new worker waits and the status layer offers "Update ·
  Reload".

### 0.2.3 System text size and handedness

- **System text size is the default.** The root font size is never set in px. On iOS the root uses
  `font: -apple-system-body` (inside `@supports`), so Dynamic Type sets the base size; on Android Chrome the browser's
  default font size, which follows the system font scale, flows through `rem`. `text-size-adjust` is never `none`. The
  in-app Text size setting multiplies the system default.
- **At 150 % text and above** the bottom bar shows icons only (each keeps its label as its accessible name and shows
  it in a tooltip-free way: a long-press is not needed because the You sheet lists the bar with labels), the top bar's
  breadcrumb moves under the `h1`, the balance chip moves to the You sheet, and the landing becomes a scrolling list of
  tiles (`01` section 1.4.2).
- **Hand.** Settings → Hand (Right, Left; default Right) mirrors every edge control. On the first visit the status layer
  shows once: "Controls are set for your right hand · Use left hand".

| ID | Requirement | Test |
|---|---|---|
| TWN-R-0.2.1 | Every route at 360 × 640, 390 × 844 and 430 × 932 (portrait) and at 844 × 390 and 667 × 375 (landscape), with DPR 3 and touch, has no horizontal page scroll, no content under a safe-area inset and no control outside the visual viewport. | Phone layout job over the route sweep with simulated insets (a test stylesheet setting the inset properties to 47/34 px portrait and 47/21 px landscape). |
| TWN-R-0.2.2 | The viewport meta contains `viewport-fit=cover` and neither `user-scalable=no` nor a `maximum-scale` below 5. | Static check of `town-app/index.html`. |
| TWN-R-0.2.3 | A toolbar resize (width unchanged, height change ≤ 140 px, nothing editable focused) bumps no epoch, runs no read batch and leaves the canvas backing size unchanged; the canvas height is `100lvh`. | Phone test emulating toolbar collapse by resizing the viewport height by 100 px during a street and a list scroll; assert counters. |
| TWN-R-0.2.4 | `overscroll-behavior-y` is `none` on the root and `contain` on every sheet, room list and street; pulling down at the top of the landing, a street or a list does not reload the page. | Computed-style scan; Android Chrome manual check at G1. |
| TWN-R-0.2.5 | With the service worker installed, an offline cold start of `/town/` and `/town/points` renders the shell, the offline banner and Retry within 1 s in the phone profile, and no API response is served from a cache. | Playwright with `context.setOffline(true)` after a first online visit. |
| TWN-R-0.2.6 | With the browser default font size at 32 px (200 %) and at 360 px width, the bottom bar's and top bar's controls do not overlap or truncate, each is ≥ 44 × 44, and each keeps its full accessible name. | Text-size test at 360 × 640 and 390 × 844 with the default font size set through the browser context. |

## 0.3 Breakpoints and the expansion model

### 0.3.1 Shell breakpoints (the app container)

The shell queries the width of `#plat` (`container-type: inline-size`). Breakpoints are in rem, so raising the text
size moves a screen toward the compact layout, which is the reflow WCAG 1.4.10 asks for. Each boundary is placed where
the next layout actually fits; the arithmetic is given at 100 % text (1 rem = 16 px).

| Name | Container width | What the design is | Why the boundary is here |
|---|---|---|---|
| **compact** | < 50 rem (800 px) | the phone design: one focus, bottom bar, landing and borough streets, lobby and rooms, sheets; content max width 40 rem, centred, on wider compact screens (a portrait iPad mini) | below 800 px two pane-compact columns (each at least 328 px, the narrowest phone pane) plus a 72 px rail and three 16 px gutters (2 × 328 + 72 + 48 = 776) do not fit with margin |
| **medium** | 50 to 64 rem | tablets and small windows: the rail on the leading edge; the lobby in two columns of at least 340 px; a room opens beside the lobby; detail sheets become a side panel; from 52.5 rem the landing and a borough street side by side (`01` section 1.4.4) | at 800 px: (800 − 72 − 48) / 2 = 340 px per column; landing beside a street needs 72 + 16 + 358 + 16 + 358 + 16 = 836 px |
| **expanded** | 64 to 100 rem | laptop and desktop: the plinth vista with orbit; the page's 12-column grid with every pane at work; the Directory column; hover previews; keyboard accelerators; Enhanced tier eligible | the 12-column grid's narrowest useful column (≈ 60 px) at 1024 − 256 (Directory) − 48 |
| **wide** | ≥ 100 rem | large monitors and wall screens: the vista and the interior side by side; a detail column; Full tier eligible | — |

### 0.3.2 Pane breakpoints (each pane's own container)

| Name | Pane width | Widget presentation |
|---|---|---|
| **pane-compact** | < 30 rem | the compact presentation of `02` section 2.10: lists not tables, one chart, stacked forms, the matrix by role |
| **pane-regular** | 30 to 56 rem | lists with a second trailing column, two-column forms, tables with up to 4 columns, side legends |
| **pane-wide** | ≥ 56 rem | the full presentation: dense tables, the matrix grid, multi-series charts, side panels inside the pane |

### 0.3.3 The short layout (landscape phones)

When the container is narrower than 64 rem **and** shorter than 30 rem (480 px), the **short** layout applies,
whatever the width class:

- the top bar becomes a 40 px title row (up, title, Motion);
- the bottom bar becomes a **rail** of the same destinations on the thumb side, 64 px wide;
- the room dock becomes a 44 px row at the bottom of the content column;
- the status layer holds at most one item;
- dioramas use their landscape framing, capped at the content height;
- the landing and streets reflow as in `01` section 1.4.5.

**Arithmetic.** 844 × 390 (iPhone 13 class, 47 px side insets, 21 px bottom inset): content 844 − 94 − 64 = 686 px
wide by 390 − 21 − 40 = 329 px tall; a room's content is 329 − 44 (dock) = 285 px tall. 667 × 375 (iPhone SE class,
no insets): 667 − 64 = 603 px by 375 − 40 = 335 px; room content 291 px.

### 0.3.4 What may change between breakpoints

Only these may differ, and only toward "more at once":

1. how many panes, columns, boroughs or sheets are visible together;
2. where the navigation sits (bottom bar, rail, Directory column);
3. whether a detail opens as a pushed view, a sheet, a side panel or in place;
4. the town's layout (landing and streets, side by side, the plinth vista) and its camera;
5. the starting rendering tier;
6. accelerators: hover previews, keyboard shortcuts, the right-click menu, drag where a button already exists.

The data a screen shows, the actions it offers and the accessible names of controls do not change by breakpoint. The
**order of panes** follows the page's compact order at compact width and its grid at expanded width (both authored,
`02` section 2.1); every other content order is the same at every width.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-0.3.1 | Shell layout is selected only by `@container` queries on `#plat` (plus the short-height query) and widget presentation only by `@container` queries on the pane root or by the kit's `ResizeObserver` on the pane root; no layout code reads `window.innerWidth`, `screen.*` or the user agent. | Lint over `town-app`, `town-plat`, `town-kit` and `town-widgets`; unit test of the kit's presentation selector with synthetic pane widths. |
| TWN-R-0.3.2 | A widget mounted in a 360 px pane on a 1440 px desktop renders the same Plat structure (element tree and accessible names) as the same widget on a 390 px phone. | Kit parity test: mount each of the 77 widgets in a 360 px pane at both viewport sizes; compare Plat snapshots. |
| TWN-R-0.3.3 | At 200 % text size on a 1440 px window the shell is medium, at 400 % zoom it is compact, and at each boundary of the table (799/800, 839/840, 1023/1024 px) every layout of the next class fits without horizontal scroll. | Breakpoint test with root font-size 32 px, 4× zoom, and widths at each side of every boundary. |
| TWN-R-0.3.4 | Between any two breakpoints the Plat reading order of each pane's content is the same, and the pane order equals the page's authored compact order at compact width and its grid order at expanded width. | Outline snapshot at 390, 800, 1440 and 1920 px for every route, compared with the Page node's `compact` data and grid. |
| TWN-R-0.3.5 | At 844 × 390 and 667 × 375 the short layout applies, the rail is on the thumb side, and every room has at least 280 px of content height. | Short-layout test at both sizes with each Hand setting. |

## 0.4 The thumb-zone map

```
 390 × 844 CSS px, portrait, right hand ("Hand: left" mirrors every edge control)
 ┌──────────────────────────────────────────┐   0
 │ ‹  Statement · 912 lines          ◉12,480 ◐│      TOP BAR (56 + inset 47): READ ZONE
 │    Points · Bank                          │      up, title, balance chip, Motion. Toasts appear here as
 ├──────────────────────────────────────────┤ 103  passive text with no controls.
 │                                          │
 │   CONTENT (the document scrolls)         │      a room's list, the lobby, a borough street
 │                                          │
 │                                      ┃   │      fast-scroll rail on the thumb edge (rooms with long lists)
 ├──────────────────────────────────────────┤ ≈ 506
 │ ◇ claude-code · building Store   Follow │      STATUS LAYER (0 to 2 items × 44): agent strip, present
 │ Offline · retrying in 4 s     Retry now │      plate, banners, "Back to where you were"; DOM landmark "Updates"
 │ ‹ Back  ⌕ Search  ⇅ Sort  View▾  ☐  ⋯   │ 698  ROOM DOCK (56): every control a room's task uses repeatedly
 │  ⌂ City  ✉ 3   ⛩ 2   ⌕ Search   ♪ 5  ◯ You│ 754  BOTTOM BAR (56 + inset 34): always present at every altitude
 └──────────────────────────────────────────┘ 844
```

### 0.4.1 The bottom bar

`<nav aria-label="Main">`, present at every altitude (landing, street, lobby, room, pushed detail); hidden only
behind the on-screen keyboard and under a modal sheet's scrim. Each slot is at least 60 × 56 CSS px at 360 px width.

| Slot | Label | Does | Count |
|---|---|---|---|
| 1 | **City** | from an interior: the town, at the landing (or, with "Return to street" on, the borough street of the building the viewer was in); in the town: open the **district switcher** sheet | none |
| 2 | **Inbox** | `/messages` | `messages_unread` |
| 3 | **Approvals** (only for viewers who hold `approval:decide`) | `/approvals` | `approvals_pending` |
| 4 | **Search** | opens the **command sheet**: the palette as a bottom sheet with its search field at the bottom edge above the keyboard and results above it (`04` section 4.13.1 for its DOM order); with an empty query it lists the **Directory** (every page, grouped by section, with counts) | none |
| 5 | **Alerts** | the notifications sheet: the latest items, Mark all read, Open all; every toast since the session began | `notifications_unread` |
| 6 | **You** | the you sheet: identity and switcher, balance and tier, Settings, Motion, Hand, Text size, Classic toggle, Agent log, Live status, sessions, the bar's labels | none |

Viewers without `approval:decide` have five slots (City, Inbox, Search, Alerts, You). The set is fixed per viewer, not
by count, so slots never move under a thumb.

### 0.4.2 The room dock

Inside a room (and a pushed detail view) a **dock** of 56 px sits directly above the bottom bar. It holds **every
control the room's task uses more than once**:

- **Back** at the leading edge (thumb side mirrored by Hand);
- the room's **tools**: Search (opens a search sheet with the field at the bottom, at peek height so the filtered list
  stays visible above it), Sort (a sheet), Filter (a sheet), the **View** control (a menu button showing the current
  view, opening a sheet of the options; two-option views are an inline two-segment toggle), **Select** (enters Select
  mode), and the room's **steppers and switchers** (step ‹ ›, column ‹ ›, role ‹ ›, each with the current value as a
  button that opens a picker sheet);
- the **primary actions** (up to two) at the trailing edge ("Review transfer"; "Reject" and "Approve");
- **⋯** for the rest (Copy all, Export, Jump to, sibling panes, Show in city, Refresh).

Each room declares its dock in the widget manifest (`06` section 6.2); at most six controls show and the rest fold into
⋯ in declared priority order. The room's title strip at the top holds only the title and the sibling ‹ ›, which a task
uses at most once.

### 0.4.3 The top bar

The read zone: the up button (secondary to Back and the platform gesture), the title (plain name first, then the
landmark), a one-line breadcrumb, the balance chip and the **Motion** button. Toasts appear under it as passive text,
one at a time, for 6 s; they carry no controls (their content and actions are in the Alerts sheet).

### 0.4.4 The status layer

One fixed stack between the content and the dock or bottom bar holding transient, actionable status. **At most two
items show at once** (one in the short layout); the rest wait, and a "+N" button in the second slot opens an
**Updates** sheet listing them. Priority, highest first:

| Priority | Item | Height |
|---|---|---|
| 1 | the `ui.present` plate (peek, `05` section 5.4) | 96 |
| 2 | the offline banner with **Retry now** | 44 |
| 3 | the agent strip with **Follow** and **Show** (`05` section 5.5) | 44 |
| 4 | "Back to where you were" | 44 |
| 5 | the approvals banner with **Open approvals** | 44 |
| 6 | "Update · Reload" (service worker) | 44 |
| 7 | the first-run Hand chip | 44 |

In the DOM the status layer is `<section id="updates" aria-label="Updates">` placed **directly after the top bar**, so a
screen-reader user reaches it with one swipe from the top bar and by the landmarks rotor (`04` section 4.13). The
layer never covers the focused element: when the focused element would be covered, the layer collapses to its "+N"
button.

**Arithmetic.** In a room at 390 × 844: 844 − 103 (top bar) − 90 (bottom bar) − 56 (dock) − 88 (two status items) =
507 px of content, 60 % of the height, at the worst case.

### 0.4.5 While the keyboard is open

When an editable element has focus at compact or short width (a keyboard resize, section 0.2.1):

- the top bar, banners, toasts and the status layer are hidden (the status layer's items return when focus leaves;
  announcements still play);
- the bottom bar is hidden (the keyboard covers it);
- the dock stays, directly above the keyboard (`visualViewport` offset), with Back and the form's primary action;
- the focused field, its label and its error message stay inside the visual viewport, above the dock.

**Arithmetic.** Portrait 390 × 844 with the iOS keyboard and its accessory bar (≈ 336 px): visual viewport 508 px − dock
56 = 452 px for the form, 89 % of the visual viewport. Landscape 844 × 390 with a ≈ 200 px keyboard: 190 − 44 = 146 px,
77 %.

**Hand.** Mirrors the fast-scroll rail, Back, the rail and the status layer's buttons. Edge controls on the leading side
sit at least 24 px from the edge, outside the platform back gesture's zone.

**Expansion.** At medium the bottom bar becomes a rail on the leading edge with the same slots plus **Directory**, the
dock stays at the bottom of the room's column, and the status layer sits at the bottom of the content column. At
expanded the rail becomes the Directory column, the top bar becomes the full HUD (`02` section 2.11), the dock's tools
move into the pane header, and the status layer becomes a stack at the bottom trailing corner.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-0.4.1 | At compact width, every control that a room's, sheet's or form's task uses more than once (its search field or Search button, View control, segmented controls, tab and step strips, role, column and borough switchers, Sort, Filter, Select, and its primary actions) has its rect in the bottom 40 % of the visual viewport, including while the keyboard is open; the top bar and room title strip contain only up, title, sibling ‹ ›, the balance chip and Motion. | Phone interaction suite: for each room and form, read the rects of the controls tagged with those capabilities (from the dock manifest and a Plat scan) with and without keyboard emulation; assert `top ≥ 0.6 × visualViewport.height`; scan the top bar's and title strip's contents. |
| TWN-R-0.4.2 | No control is placed in the top bar or toast area at compact width other than up, the balance chip and Motion; toasts are non-interactive. | Plat scan of the top bar and toast region on every route. |
| TWN-R-0.4.3 | The bottom bar is present at every altitude including rooms and pushed details, with five slots (six for `approval:decide` holders) each ≥ 60 × 56 CSS px at 360 px, and is hidden only while the keyboard is open or a modal sheet's scrim is shown. | Shell interaction test at 360 × 640 and 390 × 844 for a member and an approver, walking every altitude. |
| TWN-R-0.4.4 | Hand: Left mirrors the fast-scroll rail, Back, the rail and the status layer's buttons, keeps leading-edge controls ≥ 24 px from the edge, and leaves the Plat order unchanged. | Shell test comparing rects and the outline in both settings. |
| TWN-R-0.4.5 | The status layer never shows more than two items (one in the short layout), shows them by the priority table, offers the rest through "+N", sits in the DOM directly after the top bar as a landmark named "Updates", and never covers the focused element. | Status-layer test injecting all seven item kinds at once; DOM order check; focus-coverage check. |
| TWN-R-0.4.6 | While an editable element has focus at compact or short width, the top bar, toasts and status layer are hidden, the dock sits on the keyboard's top edge, and at least 40 % of the visual viewport is available above the dock with the field, its label and its error inside it. | Keyboard emulation (`visualViewport` height set to 60 % and, in landscape, 50 %) on every form at 390 × 844 and 844 × 390. |

## 0.5 The gesture vocabulary

These are the only custom gestures in the town app. Everything else is the platform's own (native scroll, text
selection, browser zoom, the platform back gesture).

| Gesture | Where | Does | Visible single-pointer alternative (no path, no timing) | Keyboard | Screen reader |
|---|---|---|---|---|---|
| Tap | everywhere | activate | (is single-pointer) | Enter or Space | double-tap |
| Long-press (500 ms) | list items, lobby cards, buildings | opens the item's action sheet | the item's visible **⋯** button (≥ 44 px) | the ⋯ button; Shift+F10 | the ⋯ button |
| Vertical scroll | streets, lobby, rooms, sheets | scroll (native) | the street dock's switcher, **Jump to** (long lists), Page Down | arrows, Page Up/Down | the platform's scroll gesture |
| Horizontal swipe on a strip | the room title strip (sibling panes), the board's column value in the dock, the floor strip | previous or next | the **‹ ›** buttons beside it; the value opens a picker sheet | arrows within the tab list | the tab list |
| Sheet drag (handle) | every bottom sheet | move between detents, dismiss | **Expand**, **Collapse** and **Close** buttons; tapping the handle cycles detents | Escape closes | Close; the platform escape (assumed until G1, `04` section 4.13) |
| Edge swipe from the leading edge | everywhere | history back (the platform's) | **Back** in the dock; the top-bar up button | Alt+← | browser back |
| Drag to move | board cards, page-editor blocks, content blocks | move | **Move to…** sheet; **Move up** and **Move down** buttons | Space to lift, arrows, Space to drop | Move to… |
| Rail drag | the fast-scroll rail on long lists | jump through the list | tap a point on the rail; **Back 100** and **Forward 100** in ⋯; **Jump to** | Page Up/Down (10 %), Home, End | the rail is a slider stepping 5 % per swipe (`04` section 4.13) |
| Scrub | the timeline slider, a chart's range | set a value or range | tap on the track; **−** and **+** step buttons; **Set range** fields | arrows, Page Up/Down | adjustable slider |
| Pinch, twist, one-finger pan | **the vista only** (expanded) | zoom, orbit, pan the camera | the camera buttons (+, −, ⟲, ⟳, arrows, Reset) | `+`, `-`, `Q`, `E`, arrows in the camera group | the city Plat list |
| Drag on a diorama | **fine pointer only** (expanded), Full motion | orbit the diorama | ⟲ ⟳ buttons and named framings | `[` and `]` | the flat twin |

**Not used, on purpose:**

- **No custom pinch at compact or medium width.** Pinch is always browser zoom there.
- **No drag-to-orbit under a coarse pointer.** A diorama inside a vertically scrolling room keeps the default
  `touch-action` so a flick on it scrolls the room; orbit is by buttons.
- **No swipe-to-act on list items.** Bulk actions use **Select** mode.
- **No gesture starts within 24 px of the leading edge**, which belongs to the platform back gesture.
- **No pull-to-refresh** (`overscroll-behavior`, section 0.2.1). Data is live.
- **No gesture that depends on speed or path shape.** Swipes are recognised by direction and distance only (≥ 40 px,
  within 30° of the axis).

| ID | Requirement | Test |
|---|---|---|
| TWN-R-0.5.1 | Every gesture in the table has its listed visible alternative on every screen where the gesture is available, and the alternative produces the same end state. | Gesture parity suite: for each (screen, gesture), perform the gesture with Playwright touch emulation and the alternative with a single tap; compare Plat and route snapshots. |
| TWN-R-0.5.2 | No custom gesture handler is attached outside the elements named in the table, none starts within 24 px of the leading edge, and at compact and medium widths and under a coarse pointer at any width no element other than the vista's canvas sets `touch-action` to `none` or `pinch-zoom`; dioramas register their drag handler only when `(pointer: fine)` matches. | Static check over handler registrations; computed-style scan of `touch-action` on every route at 390 and 800 px with touch and at 1440 with a fine pointer. |
| TWN-R-0.5.3 | Every target is at least 44 × 44 CSS px when the primary pointer is coarse, and at least 24 × 24 CSS px otherwise. Chart marks and diorama elements are not targets for this rule: they are selected by nearest-mark tap with ‹ › step buttons and the Plat table as the equivalent controls (WCAG 2.5.8's equivalent exception), and those controls meet the rule. | Target-size scan on the route sweep with `pointer: coarse` at 390 × 844 and fine pointer at 1440 × 900, excluding elements tagged `mark`, with a check that every chart and diorama has its step buttons. |

## 0.6 Rendering tiers

The **Base** tier is the design tier: it is what the mid-range phone runs. Higher tiers add effects that do not carry
meaning; lower tiers remove effects. What "carries meaning" is defined by the **effects manifest**
(`town-world/src/effects/manifest.ts`): every effect is listed with `meaning: true | false`, its text or glyph
equivalent, and the tiers it runs at. Every `meaning: true` effect runs, at least in its static form, at Low-power,
Base, Enhanced and Full.

| | **Plain** | **Low-power** | **Base** (baseline) | **Enhanced** | **Full** |
|---|---|---|---|---|---|
| Who starts here | forced colours, Save-Data, a slow connection until opted in, the Plain choice, two device losses in 60 s, any init failure | battery below 20 % and not charging (Chromium only), the thermal guard, the viewer's choice | every device with `pointer: coarse` or a compact or medium container, and every device with no remembered tier | expanded or wide container with a fine pointer and no remembered tier; reached from Base by the governor | reached from Enhanced by the governor; remembered per device |
| Text | DOM | DOM (hybrid) | **DOM (hybrid text)**: the GPU paints surfaces, rules, charts, icons, dioramas, the town and transitions | GPU text with a fine pointer; DOM (hybrid) with a coarse pointer | as Enhanced |
| Canvas | none | yes | yes | yes | yes |
| Interior DPR | n/a | min(DPR, 2) | min(DPR, 2) (no text is painted) | native (GPU text) | native |
| Town DPR | n/a | 1.5 | min(DPR, 2) | min(DPR, 2) | native |
| Town on a phone | Plan list | landing and streets, static effects | landing, streets with baked band images and a live overlay | adds the vista at expanded | vista with decor |
| Shadows | none | baked contact shadows only | baked per-vertex AO and contact shadows | 1024² shadow map, on change only; lamp spot shadow 512² while building | 2048² shadow map; lamp spot shadow |
| Ambient occlusion | none | baked | baked | baked | GTAO at half resolution (WebGPU) |
| Bloom | none | none (windows lit by colour) | none (windows lit by colour) | 4 levels, half resolution | 6 levels (WebGPU), 4 (WebGL2) |
| Tilt-shift | none | none | screen band, quarter resolution, one blur level (landing and street overlay) | screen band plus depth term (WebGPU), half resolution | as Enhanced, two blur levels |
| Particles (pool) | none | 0 (static highlighted path and count) | 1,500 | 6,000 | 24,000 (WebGPU), 8,000 (WebGL2) |
| Decor (sky, water, foliage) | none | still | still | moving at 30 Hz under Motion Full | as Enhanced |
| Interior backdrop | none | flat surface | flat surface with a static vignette | blurred town, cached, ≤ 4 Hz | blurred live town |
| Dioramas | flat twins | flat twins | yes, ≤ 6 draws, ≤ 10,000 triangles, portrait framing | desktop budget (`02` section 2.5) | desktop budget |
| Pane cards (Enter) | crossfade | crossfade | surfaces only, up to 6; DOM text fades in at hand-off | up to 12 with text | render-target array up to 24 (WebGPU) |
| Frame rate | n/a | user-driven 60 Hz, event effects 15 Hz | user-driven at display rate up to 60 Hz; event effects 30 Hz; zero when idle | as Base, up to 120 Hz | as Enhanced |

**Base-tier budgets on the mid-range phone.** Every figure below is a **target**, unmeasured until G0 (C11, C14) and
G-PERF; G0 records the measured value and, if a target proves unreachable, the owner resets it on the G0 task before
P8 starts (`07` section 7.2). `03` section 3.11 holds the full table.

| Budget | Target |
|---|---|
| Interior, scrolling a 912-line list | p95 ≤ 16.7 ms, no frame over 50 ms |
| Borough street, scrolling | compositor-scrolled band images: no main-thread work per scroll frame; overlay p95 ≤ 16.7 ms at rest |
| Landing busy (8 constructions, 1,500 particles, the lamp) | p95 ≤ 33 ms |
| Enter (compact), room push and pop, sheet open | p95 ≤ 16.7 ms |
| Tap to first visual response | ≤ 100 ms; Interaction to Next Paint p75 ≤ 200 ms |
| GPU memory | ≤ 96 MiB |
| JS heap | ≤ 64 MiB, Plat included |
| Idle | zero frames drawn in an idle interior and an idle town (Motion Reduced or Off, or Base at any Motion) |
| Thermals | a 10-minute scripted session ends with no tier step-down by the thermal guard; on Android, `thermalservice` status at or below LIGHT throughout. **iOS has no thermal or battery ground truth** available to a web page; there the guard (frame-time drift) is the only signal and the iPhone result is reported as "guard only" |
| Battery (Android only) | the 10-minute session at 50 % screen brightness drains ≤ 4 % of battery (`dumpsys battery` level before and after, the phone unplugged) |
| First paint on the design network, 4× CPU slowdown, cold cache | Plain render with data (t1) ≤ 2.5 s; first painted frame (t3) ≤ 4.0 s; landing first frame ≤ 1.5 s after the first City tap |
| Download before the Plain render | ≤ 170 KB compressed (HTML, critical CSS, shell JS, the route's widget chunk, one Latin font subset) |
| Download before the first painted frame | ≤ 450 KB compressed in total; Base needs no glyph-atlas or SDF code (hybrid text); the three r187 build is measured at G0 C14 and, if this target cannot hold, K12's streaming plan applies |
| Shader warm-up | the Base interior pipelines ready ≤ 600 ms after `renderer.init()` (target; until ready, the Plain render stays and nothing blocks); no frame after warm-up compiles a pipeline |

**Tier movement.** The governor of `03` section 3.12 moves one tier at a time between Low-power, Base, Enhanced and
Full by measured frame time, remembers the last tier per device (`plinth.town.tier`), and never moves during a
transition. The viewer can pin a tier in Settings → Rendering. iOS Low Power Mode is not detectable by a web page; it
halves `requestAnimationFrame` on iOS, which the governor sees as frame time.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-0.6.1 | A first visit with no remembered tier starts at Base under `pointer: coarse` or a compact or medium container, and at Enhanced otherwise. | Boot test across the four breakpoints × both pointer types. |
| TWN-R-0.6.2 | Each tier enables exactly the effects of its column, and every effect with `meaning: true` in the effects manifest is present (at least in its static form) with its text or glyph equivalent at Low-power, Base, Enhanced and Full. | Effects manifest test: the manifest's tier sets equal the table; per tier, an rt replay of one event per kind asserts each meaning-carrying effect's presence and its equivalent in the Plat. |
| TWN-R-0.6.3 | The Base budgets above are measured on the mid-range phone classes at G0 C11 and C14 and at G-PERF and recorded with the measured value beside each target; the CPU-side figures hold in phone emulation on every stack. | G0 and G-PERF records; perf runner phone profile on every stack. |
| TWN-R-0.6.4 | Under a coarse pointer at any tier, and at Base and Low-power always, no text is GPU-painted: every Plat text node is visible DOM text and the painter emits no glyph instances. | Phone-profile render test on every route: zero glyph instances; computed text colour alpha 1. |

## 0.7 Expansion rules per screen

Each row is the phone design and what each breakpoint adds. "Same" means the previous column's design is kept.

| Screen | compact (the design) | medium | expanded | wide |
|---|---|---|---|---|
| Shell navigation | bottom bar of five or six at every altitude; top bar read zone; room dock; status layer; command sheet | rail with Directory; dock and status layer in the content column; command as a centred sheet | Directory column, full HUD, palette dialog (`Ctrl+K`); dock tools in pane headers | same |
| Town | the **landing** (whole town, one screen) and a borough's **high street** (`01` section 1.4) | from 52.5 rem the landing beside the street | the **plinth vista**: perspective, 8 headings, orbit and zoom, hover plaques | the vista beside the current interior |
| District | its band in the borough street, its plaque menu as a sheet | same | the vista framed on the district | same |
| Interior | the **lobby** in the page's authored compact order and card kinds | lobby in two columns; a card opens its room beside the lobby | the page's 12-column grid, every pane at its working presentation | the grid plus a detail column |
| Pane at work | a **room**: one pane, full height, its dock above the bottom bar; detail pushes inside the room | room beside the lobby or list | in place in the grid; **Open pane** maximises it (`?focus=`) | same, with the detail column |
| Detail of a row | pushed inside the room, or an inline expansion of a list item | side panel within the room | side panel within the pane, or in place | detail column |
| Forms | pushed inside the room (never a modal sheet), fields stacked, dock above the keyboard | two-column fields where the form declares pairs | dialog ≤ 40 rem or in place | same |
| Dense list | two-line list items with expandable detail; Search, Sort, Filter, Select in the dock; fast-scroll rail | adds a trailing column | the table with every column, sortable headers, column resize | same |
| Permission matrix | by role (with Select for several changes), by permission, by person, and Compare two roles | same, two roles side by side | the full grid with crosshair | same |
| Charts | portrait-first chart, one series focused, nearest-mark tap with step buttons | side legend | multi-series, hover crosshair | same |
| Dioramas | list, form or checklist first in working rooms; diorama as a collapsed band (≤ 35 % of the viewport when open) or a View; buttons to orbit | same | landscape framing beside the content, drag to orbit (fine pointer) | same |
| Board | one column at a time, column switcher in the dock | two columns | all columns | same |
| Calendar | month grid of dots and the selected day's list below | month grid with item titles | month grid with spanning bars | same |
| Page editor | the **Phone layout** tab (ordered list with card kinds) first; the Desktop layout as a miniature 12-column grid with tap-to-place | the two side by side | drag on the 12-column canvas; Phone layout as a side list | same |
| Toasts | one at a time under the top bar, passive | two, top trailing | four, top trailing, with leader lines in the vista | same |
| Agent presence | the agent strip in the status layer; the lamp on the landing | same | HUD status and the edge chevron | same |
| `ui.present` plate | the status layer's first item (peek) | same | plate under the HUD | same |
| Timeline scrubber | History sheet with a slider in the thumb zone | same | strip above the Directory foot | same |
| Agent log and build board | sheets from the agent strip | side panels | side panels | same |

| ID | Requirement | Test |
|---|---|---|
| TWN-R-0.7.1 | Each screen in the table renders its compact design at 390 × 844 and each listed expansion at 800 × 1280, 1440 × 900 and 1920 × 1080, and no expansion removes a control or datum present at compact. | Expansion suite: per screen, snapshot the Plat's capability tags and data at each size; assert each larger set contains the compact set. |

## 0.8 Phone-first testing

- **Default harness viewport:** 390 × 844 CSS px, DPR 3, `isMobile: true`, `hasTouch: true`, CPU slowed 4× through CDP
  `Emulation.setCPUThrottlingRate`, and for load tests the design network through CDP
  `Network.emulateNetworkConditions` (1.6 Mbit/s, 750 kbit/s, 150 ms). Every interaction, a11y, parity and scenario
  test runs here first, then at 844 × 390 (short layout).
- **Expansion pass:** the same suites at 800 × 1280 (touch), 1440 × 900 (mouse, DPR 1) and 1920 × 1080.
- **What emulation proves and what it does not.** Emulation checks layout, touch handling, main-thread cost with
  slowed CPU, network loading and DPR-dependent text. It does **not** measure a phone GPU, compositor scrolling,
  thermals, battery, memory pressure or real WebGPU availability. Those are measured on real devices at G0 (C11 to
  C13) and G-PERF.
- **Real devices:** one Adreno 6xx class Android phone with Chrome and one A15 class iPhone with Safari, named by the
  owner, reached over the LAN under HTTPS (section 0.9).

| ID | Requirement | Test |
|---|---|---|
| TWN-R-0.8.1 | The town-test Playwright configuration's default project is the phone profile above, the short-layout project runs next, and each suite's expansion projects run after them on the same stack. | Review of `town-test/playwright.config.ts`: project order and settings. |

## 0.9 HTTPS on the LAN

WebGPU is only exposed in a secure context. `localhost` is secure, so desktop development needs no certificate, but a
phone reaching the dev machine at `http://192.168.x.y:5173` is not, and gets WebGL2 at best. Classic's dev server
therefore also serves over HTTPS for phones; the details are in `06` section 6.11:

- **What exists now** (integration line, commit `a65851f`): `pnpm --filter @plinth/web dev:https` runs Classic's Vite
  server on **port 5443** with `--mode https`, which adds `@vitejs/plugin-basic-ssl@2.3.0` (a self-signed certificate
  the phone accepts once). It is the same config, so it proxies `/town`, `/api` and `/rt` as the 5173 server does, and
  the phone sees one HTTPS origin, `https://<host>:5443`.
- **The default stays the click-through certificate** while G0 C11 shows WebGPU exposed on a page reached through it;
  if C11 shows it is not, **mkcert** (a locally trusted CA installed on the phones once) replaces it.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-0.9.1 | With `dev:https` running, a phone on the LAN loading `https://<host>:5443/town/` gets a secure context, and the town app reports the WebGPU backend wherever the browser and GPU expose it. | G0 C11 on the two real phones; recorded `isSecureContext`, `navigator.gpu`, certificate method and the active backend. |
