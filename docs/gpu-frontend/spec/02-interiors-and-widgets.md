# 02. Interiors, rooms, sheets, dioramas and all 77 widgets

Part of the Township canonical spec (`README.md`). Requirement IDs are `TWN-R-2.<section>.<n>`.
`00-mobile-first.md` binds this file.

Base: `../proposals/township.md` sections 3, R1 and R3.3 to R3.6, redesigned mobile-first. Grafts: Instrument's wells
(heatmap to terrain, ledger to flow ribbon, permission matrix exploded by role), its whole-dataset table search and
chart morphs; Atelier's vellum revision fan and flat focus (now the room); Constellation's automation circuits. Where
this file and a proposal differ, this file wins.

**The interior is designed for one hand first.** On a phone you arrive in a building's **lobby**: its panes as a
vertical stack of cards, each showing what that widget most needs to say at phone width. You work in one pane at a
time in a **room**: the pane at full height, with its **dock** of tools and actions under your thumb and the bottom
bar still there. Details and forms push inside the room; pickers, filters and secondary panes rise as **sheets** from
the bottom. The phone's lobby order is **authored**, not derived from the desktop grid. Wider screens show more of this at once: two columns, the room beside the
list, and on a desktop the page's whole 12-column grid with every pane at work.

The ruling on the experience judge's "inside a building, 3D is gone" (README, JE-1) stands at every width: the reading
surface is flat, pixel-snapped and token-exact, and the world stays present through dioramas on a visible View
control, the agent's light on the pane it changes, arrivals as construction and (from Enhanced) the live backdrop.

---

## 2.1 What an interior is

An interior is the page as its Page node says. The page host semantics of UI-MAP section 3.2 hold unchanged:
`pages.resolve`, binding resolution, permission omission (unavailable items are omitted, the page editor shows
placeholders), "Customise", "Reset to default" and "Edit page".

### 2.1.1 The lobby (compact, the design)

```
 390 × 844
 ┌──────────────────────────────────────────┐
 │ ‹  Points · Bank             ◉ 12,480  ◐ │  top bar (read zone)
 │    Rewards › Points                      │
 ├──────────────────────────────────────────┤
 │  Points                                  │  h1, then the floor strip when the building has floors
 │  Bank · balance, statement and transfers │
 │ ╭──────────────────────────────────────╮ │
 │ │ Points balance                     ⋯ │ │  card: summary widget shown whole
 │ │ 12,480  Gold ▮▮▮▮▮▮▯▯  1,520 to Plat. │ │
 │ ╰──────────────────────────────────────╯ │
 │ ╭──────────────────────────────────────╮ │
 │ │ Statement · 912 lines         Open › │ │  card header = the room's link (≥ 48 px row)
 │ │ Peak week bonus           +500       │ │  card body: the first 3 items of the compact list
 │ │ 23 Nov 14:30 · award      12,480     │ │
 │ │ Hoodie (order N-1042)     −1,200     │ │
 │ │ 22 Nov 09:12 · purchase   11,980     │ │
 │ ╰──────────────────────────────────────╯ │
 │ ╭──────────────────────────────────────╮ │
 │ │ Transfer points               Open › │ │  entry card for a form
 │ ╰──────────────────────────────────────╯ │
 │  ⌂ City  ✉ 3   ⛩ 2   ⌕ Search   ♪ 5  ◯ You│  bottom bar
 └──────────────────────────────────────────┘
```

- **Order and card kind are authored per placement.** Each layout item of the Page node may carry
  `compact: { order, card?, pin? }` (`06` section 6.8). The lobby shows items in ascending `order`; `card` overrides
  the widget's default card kind and may be `hidden`; `pin: true` puts the card in the **pinned** group at the top of
  the lobby (at most three per page). An item without `compact` follows the items that have it, in `(y, x)` order of
  the grid, with its widget's default card kind, so pages written before this change still work.
- **Hidden is not removed.** A `hidden` card is listed under **More on this page** at the foot of the lobby (title,
  one-line status, Open), so every widget on the page stays reachable on a phone.
- **Seeded pages carry a hand-authored phone order** (section 2.1.3).
- **Card kinds** (the widget's default comes from its manifest, section 2.10):
  - **whole**: the widget fits and is shown entire (balance, KPI strip, verify, quick-add, unread, agenda);
  - **summary**: a capped preview (at most 50 % of the viewport height): the first items of a list, one chart, the
    current status; the header opens the room;
  - **entry**: a one-line card for widgets that only make sense full height (builders, editors, the board, the
    matrix): title, one line of status ("Peak Week · Draft · 3 of 6 steps"), Open.
- **Card header:** title, count, the **⋯** button (the pane menu as an action sheet), and for summary and entry cards
  **Open ›**. The whole header row is the room's link (≥ 48 px tall).

### 2.1.3 The seeded phone order

Every seeded page in `packages/spec/src/suite/default-pages.ts` carries `compact` data, authored for the persona that
uses the page most, and tested against that persona's first task on it. For example:

| Page | Compact order (card kind; pinned in bold) | First task it serves |
|---|---|---|
| Home | **points.balance (whole)**, **approvals.inbox (summary; omitted for viewers without the permission)**, **messaging.unread (whole)**, tasks.list (summary), notifications.feed (summary), promotions.active (whole), badges.progress (whole), reporting.suite-kpis (whole), content.feed (summary) | a member checks their balance and anything waiting for them |
| Points `/points` | **points.balance (whole)**, points.ledger (summary), points.transfer (entry), points.expiry (whole), points.tiers (summary) | read the latest statement lines |
| Inbox `/messages` | messaging.inbox (summary), messaging.thread (entry) | open the newest unread thread |
| Approvals `/approvals` | **approvals.inbox (summary)** | decide the first approval |
| Ledger `/ledger` | **points.trial-balance (whole)**, points.accounts (summary), reporting.panel (summary) | check the trial balance |
| Roles `/admin/roles` | admin.roles (summary), admin.matrix (entry) | change one permission for a role |

The full set is reviewed in plan step P5 and P6 (each wave authors the compact data of its pages) and recorded in
`default-pages.ts`; `site.restore` restores it.

### 2.1.2 Expansion

| Breakpoint | Interior |
|---|---|
| medium | the lobby in two columns (cards keep the compact order, filled column by column); opening a card shows its room in the right column with the lobby still visible on the left |
| expanded | the page's 12-column grid with rows of 4.5 rem, each pane in its cell at its working presentation, chosen per pane by its width (`00` section 0.3.2); the HUD and the Directory column |
| wide | the grid plus a detail column on the trailing side for the focused pane's detail; with the vista beside it when the viewer chooses "City beside" |

The interior Plat is the layout at every width: CSS grid and flex, real lists and tables, inputs and dialogs. The
camera is orthographic and screen-aligned (1 world unit = 1 CSS px, snapped to device pixels). The GPU paints from the
Plat's measured rects (`03` section 3.6).

| ID | Requirement | Test |
|---|---|---|
| TWN-R-2.1.1 | For every route, the town interior renders the same set of widget instances as `pages.resolve` returns and as Classic renders: at expanded width in the same grid cells, at compact width in `(y, x)` order. | Route sweep in both experiences for the seven personas at 390 and 1440 px; compare instance URIs and order or cells per route. |
| TWN-R-2.1.2 | No pane, table, list, form, paragraph or chart in an interior is drawn with perspective, tilt or parallax. Only diorama viewports (section 2.4) may use a perspective camera. | Render test: for every route at both widths, read the painter's pane transforms; assert identity rotation and integer device-pixel origins at rest. |
| TWN-R-2.1.3 | At compact width each pane renders as the card kind its placement declares (or its manifest default); a summary card is at most 50 % of the visual viewport height; every summary or entry card's header opens the pane's room; hidden cards are listed under More on this page. | Lobby test for every seeded route at 390 × 844 and for a fixture page using every `compact` value. |
| TWN-R-2.1.4 | The lobby orders cards by `compact.order`, pinned cards first, then items without `compact` in grid `(y, x)` order; changing only `compact` never changes the expanded grid, and changing only `at` never changes the compact order of items that have `compact`. | Unit test over the page host's ordering function with property-based fixtures; interaction test editing each field through `site.page.put`. |
| TWN-R-2.1.5 | Every seeded page has `compact` data on every item, and for each persona's first task on that page (the table in 2.1.3, completed for all seeded pages in P5 and P6) the card that serves it is pinned or is within the first viewport at 390 × 844. | Seed test over `default-pages.ts` plus a lobby screenshot-free rect check per persona. |

## 2.2 Panes

A **pane** is the GPU face of a widget frame (UI-MAP section 4.4): an opaque rounded card at elevation tier 1 with an
analytic soft shadow, a header and a body.

- **Header:** title, optional count, the **View** control when the widget has more than one presentation (sections
  2.4, 2.7), the **⋯** menu (Open pane; Refresh; Search all, Select, Copy all, Export where the widget has a list;
  Configure in the page editor; Remove from personal page; Show in city) and the domain emblem. At compact width the
  View control sits in the room's header, not on the lobby card.
- **`full` panes** on module pages drop the card for a heading rule (Meridian) at expanded width; at compact every
  pane is a card.
- **Arrival tab** on the top edge when an event added or changed the pane: `#48,231 Added by agent claude-code`, and
  the full-width **attribution band** under the header for 8 s.
- At expanded width with a fine pointer, panes lift by a 1-unit shadow offset on hover and never tilt.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-2.2.1 | The pane header's arrival tab and attribution band are drawn by the PaneHost from the change-stream cause (`seq`, `actor`, `surface`, `on_behalf_of`), never by widget code, and both exist as text in the Plat, on lobby cards and in rooms. | rt replay at 390 and 1440 px: inject a `site.widget.add` commit by `agent:claude-code`; assert the Plat text "Added by agent claude-code" and the change number within one frame of insertion. |
| TWN-R-2.2.2 | The pane menu offers "Open pane" and "Show in city" for every widget, at every width. | Unit test over the PaneHost menu builder for all 77 widgets. |

## 2.3 Rooms (pane focus)

A **room** is one pane at full height: the phone's way of working in a widget. It is the same altitude as desktop
pane focus (Atelier's flat focus), so they share one route parameter, `?focus=<widget-instance-slug>`.

```
 390 × 844, room: Statement
 ┌──────────────────────────────────────────┐
 │ ‹  Statement · 912 lines           ◐    │  top bar (read zone): up, title, Motion
 │ ‹ Points balance   ·   Transfer ›        │  title strip: sibling ‹ › only (used at most once a task)
 ├──────────────────────────────────────────┤
 │ Showing 1 to 40 of 912. Search finds any │  hint line
 │ ─────────────────────────────────────── ┃│
 │ Peak week bonus               +500     ┃│  two-line items; tap expands
 │ 23 Nov 14:30 UTC · award · No. 8,912    ┃│  fast-scroll rail / density strip on the thumb edge
 │ ▾ Entries: points:member +500 …          ┃│
 │   Open transaction ›                     ┃│
 │ ─────────────────────────────────────── ┃│
 │ Hoodie (order N-1042)        −1,200     ┃│
 │ 22 Nov 09:12 UTC · purchase · 8,911      ┃│
 ├──────────────────────────────────────────┤
 │ ‹ Back  ⌕ Search  ⇅ Sort  ⚲ Filter Table▾ ⋯│  DOCK (56): every repeated control; Search opens a sheet
 │  ⌂ City  ✉ 3   ⛩ 2   ⌕ Search   ♪ 5  ◯ You│  bottom bar stays
 └──────────────────────────────────────────┘
```

- **Opening:** the lobby card's header, **Open pane** in the ⋯ menu, a deep link `?focus=<slug>`, or (expanded) a
  double-click on the pane header. At compact width opening pushes a history entry and the room slides in from the
  trailing edge (Full: 220 ms; Reduced: 120 ms crossfade; Off: cut). The rest of the page is `inert`.
- **Closing:** Back in the dock, the platform back gesture, Escape, or the top-bar up button. Focus returns to
  the card header that opened it (or the pane heading after a deep link).
- **Siblings:** the title strip's **‹ ›** buttons, a horizontal swipe on the title strip, or the switcher sheet (tap
  the title) move to the previous or next pane of the page without returning to the lobby (each is a `replaceState`,
  so Back still returns to the lobby).
- **Inside a room** the widget may push its own detail views (list → transaction → reverse). Each push is a history
  entry; Back pops one level at a time.
- **The dock** (`00` section 0.4.2) sits directly above the bottom bar, which stays. It holds Back, the room's tools
  (Search, Sort, Filter, the View control, Select, and its steppers and switchers: tabs and steps as **‹ value ›**,
  board columns, matrix roles) and up to two primary actions; the rest is in ⋯. Wherever a widget row in section 2.10
  says "tabs", "stepper", "strip", "segmented control" or "Search" for a room, that control is in the dock or in a
  sheet opened from it, never at the top of the room. The dock rides above the on-screen keyboard.
- **Search** opens a search sheet at peek height with its field at the bottom edge, above the keyboard; the filtered
  list stays visible above the sheet, and the match count shows in the sheet.
- **Forms** in a room are pushed views inside the room, not modal sheets, so the bottom bar stays reachable.

**Expansion.** At medium the room opens in the right column beside the lobby (the lobby stays operable; no `inert`).
At expanded the pane grows in place to the content width (capped at 120 rem), the rest of the page becomes `inert`
and the backdrop dims (the former pane focus). Detail views push inside the room at compact, open as a side panel
inside the pane at medium and expanded, and use the detail column at wide.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-2.3.1 | `?focus=<slug>` opens the page with that pane as its room (compact) or focused (expanded); the rest of the page is `inert` where the breakpoint says so; Back and Escape return focus to the opener. | Interaction test for `points.ledger`, `admin.matrix` and `audit.timeline` at 390 and 1440 px. |
| TWN-R-2.3.2 | Opening a room and each detail push inside it add one history entry; the platform back gesture (emulated `history.back()`), the Back button and Escape each pop exactly one level and restore focus to the control that opened it. | Interaction test: lobby → room → detail → back → back, asserting route, altitude and `activeElement` at each step. |
| TWN-R-2.3.3 | Sibling navigation by the ‹ › buttons, by the title swipe and by the switcher sheet reaches the same pane and does not add a history entry. | Gesture parity test on a three-pane page. |
| TWN-R-2.3.4 | Every room declares its dock in the widget manifest; at 390 × 844 the dock shows at most six controls with the rest in ⋯, contains every control the room's views use repeatedly (TWN-R-0.4.1), and the bottom bar remains visible beneath it. | Manifest test over all 77 widgets plus the phone room suite. |

## 2.4 Sheets

A **sheet** rises from the bottom for a picker, a filter or sort set, a menu, a confirmation, a secondary pane (an
inspector, a diorama on request), the command sheet, the Alerts and You sheets, the Agent log, the build board, the
present plate and the district switcher. **Forms are not sheets** at compact width: they push inside the room, so
the bottom bar and its two-activation route stay available (TWN-R-1.9.1). The only form-like sheets are confirmations
(a summary and one decision) and short note sheets (a reject reason).

- **Detents:** peek (content height up to 30 %), half (50 %) and full (100 % minus the top inset). Each sheet declares
  which detents it uses.
- **Semantics:** a sheet at half or full is a modal `<dialog>` opened with `showModal()`; a peek sheet that does not
  block the page (the present plate, the agent strip's expansion) is a non-modal `role="dialog"` with a label and no
  focus trap.
- **Header:** a drag handle (a button: tapping cycles the detents), the title, **Expand** or **Collapse**, and
  **Close**. Every drag has these buttons as its alternative.
- **History:** opening a modal sheet pushes a history entry, so the platform back gesture and TalkBack's back close
  it; Escape fires the dialog's `cancel`. That VoiceOver's two-finger scrub fires `cancel` on a WebKit `<dialog>` is
  **assumed until G1**; the fallback is the visible Close button, which every sheet has.
- **Keyboard:** the sheet's content scrolls inside it; its own action row rides above the on-screen keyboard; the
  focused field stays inside the visual viewport.
- **Stacking:** at most two sheets stacked (a form's confirmation over the form). A third replaces the second.

**Expansion.** At medium and wider, a sheet whose content is a detail or a secondary pane becomes a side panel on the
trailing side; a confirmation or a short form (≤ 40 rem) becomes a centred dialog; menus become popovers anchored to
their button; the command sheet becomes the `Ctrl+K` palette dialog.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-2.4.6 | Every modal sheet is a `<dialog>` opened with `showModal()`, has a visible Close button, closes on Escape and on history back, and returns focus to its opener. | Sheet test over every sheet kind at 390 × 844. |
| TWN-R-2.4.7 | Every sheet's detents can be reached by its Expand and Collapse buttons and by tapping the handle, with the same end states as dragging. | Gesture parity test per sheet. |
| TWN-R-2.4.8 | While the on-screen keyboard is open, a sheet's action row or a room's dock sits directly above it and the focused field is inside the visual viewport. | `visualViewport` emulation test on every form at 390 × 844. |

(TWN-R-2.4.1 to TWN-R-2.4.5 are the diorama requirements in section 2.5 below; their IDs are kept, and the sheet
requirements take the next free numbers in section 2.4.)

## 2.5 Dioramas

A **diorama** is a small live 3D view inside a pane, rendered in its own scissored viewport with its own camera and
depth. It carries orientation, structure and comparison, never a value that must be read off depth alone.

**Contract** (every diorama):

1. **A visible View control** in the pane header (in the room's dock at compact width), a segmented
   `role="radiogroup"` ("Table | Flow", "Flat | Terrain", "List | Chain"). The choice is remembered per widget
   instance in the viewer's Preference node.
2. **A flat twin** with the same information as a 2D chart, list or table. The flat twin is what shows in Plain mode,
   under Motion Off, at the Low-power tier and when the diorama's budget is exceeded.
3. **A Plat source of truth:** a list, table or text description that the screen reader reads in every view, plus a
   one-sentence `describe()` summary announced when the view changes.
4. **Portrait first.** Every diorama's camera framing is authored first for a portrait viewport of 358 × 448 CSS px
   (4:5), then for a landscape viewport; the framing in use follows the viewport's aspect ratio.
5. **A budget per tier:** Base ≤ 6 draw calls, ≤ 10,000 triangles, ≤ 2 ms GPU on the mid-range phone class
   (unmeasured until G-PERF); Enhanced and Full ≤ 8 draw calls, ≤ 20,000 triangles, ≤ 0.4 ms GPU at 1440 × 900 on the
   reference machine. Exceeding it in dev throws; in production it shows the flat twin and logs once.
6. **Operation without drag:** ⟲ and ⟳ buttons and named framings orbit the diorama; drag to orbit exists only with a
   fine pointer under Full motion. Under a coarse pointer the diorama keeps the default `touch-action`, so a flick on
   it scrolls the room. Keyboard: arrow keys walk its elements (cells, ribbons, links, planes), Enter drills to the Plat
   row, Escape returns to the View control. A tap on an element selects it and shows its value plate. Camera tilt is
   Full-motion only; Reduced and Off cut to the final framing.
7. **No compute shaders** (WebGL2 parity, `03` section 3.3).
8. **Placement on a phone.** A diorama that **is** a view (the ledger's Flow, the heatmap's Terrain) fills the room's
   content area when chosen. A diorama that **accompanies** work (D9 beside the steps, D10 beside the run, D11 beside
   the decision, D12 beside the rule, D14 beside the by-person list) is, at compact width, a **collapsed band** 160 px
   tall at the top of the content (a still frame with "Show machine", "Show gate" and so on), which opens to at most
   35 % of the visual viewport height and never pushes the dock or the work's first control below the fold. In the
   short layout it is a one-tap sheet instead. On wider panes it sits beside the work.

**Default view.** Summary widgets, whose diorama is the clearest single view, open on the diorama. Dense-work widgets
open on their list or table; their diorama is one tap away on the visible control.

| # | Widget | Diorama (portrait framing first) | Default view | What 3D adds | Flat twin |
|---|---|---|---|---|---|
| D1 | `points.tiers` | tier stair: tiers as storeys of a tower, height ∝ lifetime floor; the viewer's figure on their storey; the tower is naturally portrait | Diorama | distances between floors read as height | vertical ladder with floors as numerals |
| D2 | `points.trial-balance` | brass beam balance: debits left, credits right; level when balanced | Diorama | an unbalanced ledger is a tilted beam | "Balanced · Δ 0" plus the invariant list |
| D3 | `points.ledger` | **flow ribbon** (Instrument): in portrait **time runs down the screen**, the running balance a vertical band whose width is the balance, credits join from the left by type, debits leave to the right; in landscape time runs left to right | List (compact), Table (wider) | conservation is visible: in minus out is what remains | the statement list or table plus "Flows by type and day" |
| D4 | `points.accounts` | **accounts flow**: system accounts (issuance, redemption, expiry, breakage) as gates stacked down the screen, members as one band per tier | List / Table | where points go across the programme | accounts list plus flows table |
| D5 | `audit.verify` | hash chain as linked stone blocks running down the screen, a sweep light during verification; a break is an opened link | Diorama | the chain is literally a chain | status text plus both heads |
| D6 | `audit.node-history` | **vellum revision fan** (Atelier): revisions as translucent sheets stacked down and back in depth (portrait), fanned sideways (landscape); choosing two slides them together so unchanged text overlaps and changed text doubles | List | many revisions at once; the shape of change | revision list plus the text diff (stacked at compact, two columns wider) |
| D7 | `content.editor` (Versions and Diff) | vellum revision fan, as D6 | List | as D6 | as D6 |
| D8 | `promotions.builder` (History) | vellum revision fan, as D6 | List | as D6 | as D6 |
| D9 | `automation.builder` (Steps) | the automation as a machine laid out top to bottom: trigger hopper, condition gates, step stations; a dry run sends a token down through the stations it would pass | Steps list with the machine as a collapsed band (compact); machine beside the steps (wider) | a step's place in the flow; the dry-run path | numbered step list with outcome per step |
| D10 | `automation.runs` (run view) | the same machine with the run's **circuit**: a pulse that advances per `step_index` (`05` section 5.10) | per-step timeline with the circuit as a collapsed band (compact); circuit beside (wider) | where a run is and where it failed | per-step timeline |
| D11 | `approvals.inbox` (item view) | the gate with the request cart; separation of duties as two keys | the decision checklist (compact), with the gate as a collapsed band; Reject and Approve in the dock; beside the checklist (wider) | two-person rules read as two keys | decision checklist |
| D12 | `segments.builder` (preview) | the People district's five lanes from above, stacked as in its street, matching houses lit | Diorama (Preview is a view) | where the segment lives by region and tier | distribution bars by region and tier |
| D13 | `reporting.heatmap` | **terrain** (Instrument): cells as a heightfield with plateaus, contour lines and a translucent threshold plane; breach cells rise through it with the hatch on their faces; the grid is transposed to be taller than wide when it would otherwise be wider than the viewport | Flat | the breach is a ridge above a plane | flat heatmap with hatch, ▲ glyph and breach text row |
| D14 | `admin.matrix` (by person) | **exploded by role** (Instrument): each of the person's roles a plane separated in depth, effective plane in front; each effective permission traces a line to the role plane that granted it; in portrait the planes show one permission group at a time | Flat | "why can this person do that" becomes a line you follow | the by-person list with sources per permission |
| D15 | `badges.showcase` | three medallions on plinths, lit, stacked in portrait | Diorama | presentation | medallion row |

D6 to D8 share one component (`kit/vellum-fan`) and D9 and D10 share the machine, so there are 12 distinct diorama
kinds.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-2.4.1 | Every diorama implements the seven-point contract: View control, flat twin, Plat source plus `describe()`, portrait and landscape framings, budget per tier, operation without drag, no compute. | Per-diorama test file (`*.diorama.test.ts`): the control's role and name, flat-twin parity (same numbers in the Plat for both views), budget counters per tier, ⟲ ⟳ buttons and arrow-key walk, framing by aspect ratio, no compute entry in the pipeline list. |
| TWN-R-2.4.2 | Changing the View announces `describe()` politely ("Flow view. Credits 14,200 in, debits 1,720 out, over 30 days."). | Announcement log assertion in the interaction test. |
| TWN-R-2.4.3 | In Plain mode, under Motion Off and at the Low-power tier, every diorama shows its flat twin and the View control is still present and operable (it switches between flat presentations or is disabled with the reason as text). | Run the diorama suite with `?render=plain`, `?motion=off` and `?tier=low-power`. |
| TWN-R-2.4.4 | A diorama exceeding its tier's budget in production shows its flat twin and logs one `diorama.budget` warning per session. | Test with an artificially inflated model in a production build at Base and at Full. |
| TWN-R-2.4.5 | The vellum fan diff shows the exact textual diff in the Plat beside or below the fan; overlapping text is decoration, the diff text is the source of truth. | Interaction test on `audit.node-history` with two seeded revisions at 390 and 1440 px: Plat diff equals the server diff. |
| TWN-R-2.4.9 | Every diorama at 390 × 844 uses its portrait framing with every labelled element inside its viewport at rest; its elements are selectable by the ‹ › step buttons (each ≥ 44 × 44) in Plat order and by nearest-element tap within 22 px; an accompanying diorama is a collapsed band of 160 px that opens to at most 35 % of the visual viewport, and the work's first control and the dock stay visible with it open. | Diorama layout test in the phone profile for every diorama, including D9 and D11 with the keyboard emulated open. |
| TWN-R-2.4.10 | Under a coarse pointer no diorama attaches a drag handler or changes `touch-action`, and a vertical flick starting on a diorama scrolls the room. | Touch test on D3, D9, D11 and D13 in the phone profile. |

## 2.6 Dense lists and tables (`kit/table`)

One component serves every dense list: `points.ledger`, `points.accounts`, `store.orders`, `store.inventory`,
`audit.timeline`, `admin.members`, `content.list`, `automation.runs`, `reporting.table` and the rest. It has two
presentations chosen by the pane's width; the data, search, selection and copy are one implementation.

### 2.6.1 The list presentation (pane-compact, the design)

- **Item:** two lines. Line 1: the **primary** field (memo, title, name) and the **trailing** value (Δ, total,
  status), right-aligned, tabular. Line 2: **secondary** fields joined by " · " (date UTC, type, number) and the
  **trailing-sub** value (balance). Each widget declares the mapping from its columns to these four slots; every
  column the table has appears either in the two lines or in the item's **expansion**.
- **Expansion:** tapping the item (a `<button aria-expanded>` covering the two lines) shows every remaining field as a
  `<dl>` and the item's actions ("Open transaction ›", "Reverse…"). One item is expanded at a time.
- **Plat:** `<ul role="list">` with `aria-setsize` and `aria-posinset` per rendered item; each item's button has an
  accessible name that reads as one sentence ("Peak week bonus, plus 500 points, 23 November 14:30 UTC, award,
  balance 12,480").
- **Windowing:** items in the viewport plus 30 above and below; spacers keep the scroll height honest.
- **Fast-scroll rail:** on the thumb edge (at least 24 px from the leading edge when Hand is left), the **density
  strip** (one tick per search match) doubles as a fast-scroll rail: an `<input type="range">` over the item index
  with `step` equal to 5 % of the item count (so a screen-reader swipe moves 5 %), `aria-valuetext` "Item 391 of 912,
  14 October", Page Up and Down at 10 %. Tapping a point on the rail jumps there; dragging is an accelerator. **Back
  100**, **Forward 100** and **Jump to** (a row number or date) are in ⋯.
- **Sort:** **Sort** in the dock opens a sheet listing every sortable column with ascending and descending; it is the
  same client-side sort as the table's header buttons and is remembered per instance.
- **Select mode:** **Select** in the dock adds a checkbox to every item; the dock then reads "Copy 12",
  "Export 12" and the widget's bulk actions ("Fulfil 3"). This replaces drag selection on touch. Copy writes TSV and an
  HTML table, exactly as a table selection does.

### 2.6.2 The table presentation (pane-regular and pane-wide)

At pane-regular the table shows up to 4 columns (primary, two secondary, trailing) with the rest in the row's
expansion; at pane-wide every column. A real `<table>` with `<caption>`, `<th scope="col">` header buttons with
`aria-sort`, `aria-rowcount` set to the total and `aria-rowindex` per rendered row, in a
`<div class="scroller" tabindex="0" role="region" aria-label="Statement, 912 lines">`. Columns resize by dragging the
header edge or with `Alt+←/→` on a focused header, or through **Columns…** in the ⋯ menu (widths as steppers),
remembered per instance in the Preference node. Native drag selection and copy work as well as Select mode.

### 2.6.3 Whole-dataset search and copy (both presentations)

- The table loads the whole result into a **columnar store** in the page (pages of 100 to 200 through the widget's
  own action until complete, up to 20,000 rows; above that it pages from the server and says so). On the Base tier
  and on a metered connection (`navigator.connection.saveData` or `effectiveType` below 4g) it loads the first page
  eagerly and the rest when the viewer first searches, sorts, copies all or scrolls past the first page.
- **"Search all N lines"** (the dock's Search, a field at the bottom of a peek sheet at compact width; a field in
  the pane header at wider widths) filters on the CPU over the columnar store on
  every keystroke (dictionary codes for strings, lower-cased once, numeric columns as typed arrays). No compute
  shader.
- It announces the match count politely ("23 lines match Peak"), moves the cursor to the first match and draws the
  density strip (instanced ticks on the GPU; a DOM list of ticks in Plain mode).
- The hint line: "Showing 391 to 440 of 912. Search finds any line."
- **Copy all** and **Export CSV** in the ⋯ menu. A copy shows an in-page confirmation plate ("Copied 12 lines as
  TSV") with the first two lines as a preview.
- The shortcut sheet and the hint document that browser Find covers only the items on screen.

**GPU.** Zebra and selection quads, hairline rules as one instanced line batch, glyph instances per field, in 2 draws.
Rows 56 CSS px (two-line items) at compact; 32 comfortable and 26 compact density in the table.

**Legibility.** Tabular numerals (`03` section 3.5), right-aligned numbers; the Δ value has a sign glyph and the
credit or debit tone, never colour alone; the cursor is a DOM outline.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-2.5.1 | Every `kit/table` with more than 100 rows has "Search all N", the hint line, "Copy all", "Export CSV" and, in the list presentation, Select mode and the fast-scroll rail. | Unit test over kit/table props for every widget that uses it; interaction test on the ledger at both presentations. |
| TWN-R-2.5.2 | Search returns every matching row in the whole dataset, announces the count and moves the cursor to the first match, including rows never rendered, in both presentations. | Interaction test at 390 and 1440 px: search a memo present only on row 880 of 912; assert count, the cursor's item or `aria-rowindex`, and the announcement. |
| TWN-R-2.5.3 | A keystroke in Search over 8,500 rows updates the stripes and density strip in the next frame and the window text within two frames, on the reference machine, and within four frames in the phone profile (4× CPU slowdown). | Perf runner on `audit.timeline`: keystroke-to-frame timings over 50 keystrokes, p95, in both profiles. |
| TWN-R-2.5.4 | Copy of a three-row selection yields exactly the TSV of those rows' data, whether selected by drag (table) or by Select mode (list). | Spike criterion C6, carried into the interaction suite at both presentations. |
| TWN-R-2.5.5 | Sorting 912 rows client-side completes within 4 ms on the reference machine and within 16 ms in the phone profile. | Unit benchmark in the perf runner, both profiles. |
| TWN-R-2.5.6 | In the list presentation every column of the table appears in the item's two lines or its expansion, and each item's accessible name contains the primary, trailing, secondary and trailing-sub values. | Kit test over every list-mapping declaration against the widget's column set; Plat name check. |
| TWN-R-2.5.7 | Every list item's actions are reachable without long-press: in its expansion or by its ⋯ button. | Plat scan: each long-press handler has an equivalent button. |
| TWN-R-2.5.8 | Every column sortable in the table presentation is sortable from the list presentation's Sort sheet with the same result order. | Parity test per `kit/table` widget at 390 and 1440 px. |
| TWN-R-2.5.9 | The fast-scroll rail is a range input whose step is 5 % of the item count, and Back 100, Forward 100 and Jump to are in the list's ⋯ menu. | Kit test plus a VoiceOver check at G1. |

## 2.7 The permission matrix (`admin.matrix`, `notifications.preferences`)

### 2.7.1 `admin.matrix` at compact width (the design)

The grid of 8 role columns × about 70 permissions cannot be read on a phone, so the phone gets three **views** of the
same data, chosen with the View control in the dock:

- **By role** (default): a role switcher in the dock (**‹ Finance ›**, the value opening a sheet of the 8 roles plus
  **agent ceiling**) and in the content the permissions grouped by domain in collapsible sections. Each row is the
  permission name, the state glyph (● granted, ◐ granted with a scope shown as a sub-label, ▣ with a column mask, ⧗
  held for the agent, ✕ never because the agent ceiling denies it, ○ not granted) and the state in words. Tapping a row
  opens the **grant sheet**: the explanation (which grants and role give it), and for admins **Propose change** (held
  under R-ROLE, said in text).
- **By permission:** a permission picker (search field) and below it the 8 roles plus the agent ceiling as rows with
  their states: "who can do this".
- **Select in By role:** Select mode adds a checkbox per row; the dock then reads "Propose 5 changes", which opens one
  confirmation listing the five changes and files them in one step (one `admin.*` call per change, each the same call
  as from the grid, under one idempotency key prefix), so reviewing a role is not twelve round trips.
- **Compare two roles:** a fourth view: two role switchers in the dock and, per permission row, the two state glyphs
  side by side (name 238 px + 2 × 56 px glyph columns at 390 px), differences first.
- **By person** (the principal view): a person picker; the person's effective permissions grouped by domain, each
  with its sources (role chips, grant links, ceiling intersection), with the exploded diorama D14 on the View control.

### 2.7.2 Expansion

At medium, **By role** shows two roles side by side (two switchers) for comparison. At expanded, a fourth view,
**Grid**, is added and becomes the default: `role="grid"` with row headers (permissions grouped by domain, `rowgroup`
headers) and column headers (the roles and the agent ceiling). Cells are `gridcell`s labelled in full ("finance:
points:adjust, granted on suite/"); arrows move, Home and End within a row, Ctrl+Home to the first cell, Enter opens
the grant sheet (a side panel); no typeahead. Focus or hover draws a crosshair. About 600 instances in 3 draws. All
three phone views remain available at expanded.

### 2.7.3 `notifications.preferences`

The type × channel matrix at compact width is one list item per notification type, each with its channel switches
inline (in-app, email, digest: three `role="switch"` targets of 44 × 44), the digest schedule as a select and quiet
hours as two UTC time inputs below. At pane-wide it is the grid with sticky headers.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-2.6.1 | Every matrix cell or row conveys its state by glyph and accessible name, never by colour alone, in every view. | Unit test over the cell and row renderers; forced-colours screenshot check of each view. |
| TWN-R-2.6.2 | The By role, By permission and By person views together expose every (role, permission) state of the grid, and each state equals the grid's for the same data. | Parity test at 390 px against the grid at 1440 px for every role and permission. |
| TWN-R-2.6.3 | An admin can propose a change to any (role, permission) state from the By role view at 390 × 844 with taps only, and the proposal is the same action call as from the grid. | Touch interaction test comparing the recorded `admin.*` action payloads from both paths. |
| TWN-R-2.6.4 | In By role, Select mode proposes several changes from one confirmation, and Compare two roles shows every permission's state for both roles with differing rows first. | Phone interaction test proposing 5 changes and comparing finance with ops lead. |

## 2.8 Charts and morphs

Charts are GPU primitives on the 2D layer: instanced rounded-rect bars; screen-space SDF polylines with miter-limited
joins; triangle-strip areas; instanced SDF scatter discs; instanced heatmap cells with the breach hatch and ▲ glyph
plus the breach text row ("1 cell over 600 ms: Crane / EMEA 759.9"). Axes and labels are text runs.

**Portrait first** (pane-compact):

- **Bar:** horizontal bars, categories down the screen, the label above each bar and the value at its end; no rotated
  labels ever. A bar is a ≥ 44 px tall target.
- **Line and area:** time on the horizontal axis at an aspect of 4:5 or taller; at most 2 series drawn at once, with a
  series chip strip to choose which; tapping the plot places a **value plate** for the nearest point (the readout a
  hover crosshair gives on desktop), and ‹ › buttons step it point by point.
- **Scatter:** square plot; tap selects the nearest disc within 22 px and shows its plate.
- **Heatmap:** transposed so the longer dimension runs down the screen; cells at least 28 px drawn (more than 12
  columns do not fit 358 px at 28 px, so wider heatmaps pan horizontally inside the chart with ‹ › page buttons); a tap
  selects the **nearest cell** (cells are marks, not targets, `00` TWN-R-0.5.3) and shows its plate; ‹ › and ▲ ▼ step
  buttons (44 px) walk cells; the breach text row stays under the chart.
- **KPI and sparkline:** the figure at `--step-3`, delta with sign glyph and word, sparkline below.
- **Too small:** ticks drop first, then labels move into the plate, then the pane switches to its table view with
  "Too small for a chart; showing the table".
- **Range selection** (`reporting.line` brushing): **Set range** fields (two dates) and a range slider with two thumbs
  and step buttons; drag-brushing is the expanded-width accelerator.

**Expansion:** vertical bars when every category label fits unrotated, multi-series lines with a side legend, hover
crosshair and value plate with a fine pointer, drag-brushing.

- **Views:** every reporting visual has **Chart, Table, Inspector** on the View control; the inspector is a sheet
  (compact) or `<dialog>` (wider) with the query, source, watermark, as-of, row count and "3 rows hidden by your
  grants".
- **Morphs** (Instrument graft): `reporting.bar`, `line`, `area` and `scatter` offer the other chart kinds on the View
  control. A change morphs marks between layouts in the vertex shader over 500 ms at Full, a 120 ms crossfade at
  Reduced and a cut at Off (`03` section 3.9.11). The choice is a view, not a config change.
- Chart Plat: `role="img"` with a generated description ("Bar chart, orders by status, 5 bars, highest Delivered 612,
  lowest Cancelled 18") plus the data table behind the Table view.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-2.7.1 | Every chart has a generated description and a data table in the Plat whose values equal the plotted values. | Unit test over the chart description generator; parity test between chart model and Plat table. |
| TWN-R-2.7.2 | A morph never writes to the Widget node and leaves the Plat table unchanged. | Interaction test: morph bar to line; assert no `POST /changes` and an identical Plat table. |
| TWN-R-2.7.3 | No chart uses depth to encode a value that must be compared; 3D bar charts and perspective pies do not exist in the kit. | Kit API review test: the chart kinds enum is closed and listed. |
| TWN-R-2.7.4 | At pane-compact width bar charts are horizontal, no axis label is rotated, every value of every chart can be read by tapping (value plate) or by the ‹ › step buttons, and range selection works through Set range fields. | Chart test for each chart kind at 358 px pane width with touch. |

## 2.9 Floors and the floor strip

A building with several floors (routes) shows a **floor strip** under the `h1`: chips for each floor ("Store ·
Category · Product · Cart · Orders · Wishlist"), horizontally scrollable at compact width with ‹ › buttons at its ends;
a horizontal swipe on the strip scrolls it. In the Plat it is `<nav aria-label="Floors of Emporium">` with links and
`aria-current="page"`. Parameter floors appear only while you are on them. A floor change is an ordinary route change
(crossfade, focus to the new `h1`). At expanded width the strip is the brass directory board across the top of the
interior with every floor visible.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-2.8.1 | Every floor of a building is reachable from its floor strip at 390 px by taps only (chips or ‹ ›), and the current floor's chip is scrolled into view on arrival. | Interaction test on the Emporium at 390 × 844. |

## 2.10 The 77 widgets

Columns: **Home** is the default building and route (UI-MAP section 2). **Compact (the design)** is the card kind in
the lobby (whole, summary or entry, section 2.1.1) and the presentation and interaction at pane-compact width, in the
room. **Expansion** is what pane-regular and pane-wide add. **Diorama** refers to section 2.5. **Street** is the
read-only presence in the city (always a link to the pane, never the only way to operate anything).

Every widget keeps its catalogue entry unchanged: config schema, sizes, views, actions, events and bus topics
(CONTRACT 5A.6). Catalogue sizes (`s` to `full`) govern the expanded grid only; at compact width every widget uses its
compact presentation whatever its size. Widgets with no default placement (`notifications.send`, `reporting.table`,
`bar`, `line`, `area`, `heatmap`, `scatter`, `kpi`) are placed by the agent or the page editor.

### points (8)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| points.balance | Bank `/points`; Home; profiles | **whole**: hero numeral (tabular) at `--step-3`, tier pill, progress bar to the next tier, expiring line; digit roll on `points.posted` with a signed delta chip for 2.4 s; the card opens `/points` from Home | regular: numeral and progress side by side | none | balance on the viewer's own house plaque and the balance chip |
| points.ledger | Bank `/points` | **summary** (first 3 items); room: the list presentation (2.6.1): primary memo, trailing Δ, secondary date · type · No., trailing-sub balance; expansion shows entries and lots and "Open transaction ›" (pushed); Filter sheet (type, date range); opening and closing balance as a sticky footer line; Search all, Select, Copy all, Export; publishes `order.selected`, subscribes `member.selected` | regular: 4-column table; wide: No., Date (UTC), Type, Memo, Δ, Balance with sorting; transaction as a side panel | D3 flow ribbon (default List or Table) | flows from the Bank |
| points.transfer | Bank `/points` | **entry**; room: form at full height: recipient combobox (people search in a sheet), amount (`inputmode="numeric"`) with the daily limit shown, memo; dock "Review transfer" → confirm view (balance after) with "Send" → done | two-column fields; confirm as a dialog | none | particles from the viewer's house to the recipient's |
| points.award | Award Office `/points/award` | **entry**; room: recipients as chips added from a people sheet (multi-select with checkboxes), category, amount, reason, multiplier preview ("× 1.5 Peak Week, +250"); dock "Review award" → confirm → done (each recipient's new balance); for the agent "Request approval"; held badge when the action will be held | recipients picker beside the form | none | particles from the Bank on commit |
| points.expiry | Bank `/points` | **whole** (up to 3 dates, then summary): list by date with amounts; "expiring soon" with ▲ hourglass glyph and text; items link to the statement filtered to the lot | table | none | hourglass glyph on the viewer's house when anything expires within 30 days |
| points.tiers | Bank `/points` | **summary**: the tier stair diorama in portrait with the viewer's storey; room: tiers as a vertical list with perks and member counts; ‹ › step tiers | the ladder horizontal; perks beside | D1 tier stair (default Diorama) | house storeys |
| points.trial-balance | Counting House `/ledger` | **whole**: verdict line ("Balanced · Δ 0" or "Out of balance by 40 points" with ▲), the beam; room: invariant list (debits = credits, no negative member balance, lots reconcile) and system account balances | invariant table beside the beam | D2 beam balance (default Diorama) | vault door glow (finance only) |
| points.accounts | Counting House `/ledger` | **summary**; room: accounts list (account, type; trailing balance; last posting) → statement (pushed, list presentation) → transaction (pushed) → **Reverse** in a full sheet stating the reversing entries and requiring a reason (finance only; not available to the agent) | accounts, statement and transaction in panes side by side | D4 accounts flow (default List or Table) | none |

### store (8)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| store.catalog | Emporium `/store`, `/store/c/:category` | **summary** (6 products); room: two-column product grid of instanced cards (image, title, price, stock text), category chips strip, **Filters** sheet (price range as two number fields plus a two-thumb slider, in stock, affordable), sort select; product opens as pushed view (`open_in: widget`) or navigates to `/store/p/:product` (`open_in: page`); Plat `role="list"` of `<article>` | 3 to 6 per row; filters column at pane-wide | none | an awning per category |
| store.product | Emporium `/store/p/:product` | **whole**: image (full width, 4:3), title, price (tabular), stock lamp plus "12 in stock", quantity stepper (− and + of 44 px), wishlist toggle (`aria-pressed`); dock "Add to cart"; reviews below → write review in a sheet (rating radio group, body textarea) | image beside details | none | stock lamp on its awning |
| store.featured | Emporium `/store`, product floors | **whole**: a horizontal scroller of six product cards with ‹ › buttons; "Add" on each card; tap opens the product | all six in a row | none | shop-window display |
| store.cart | Emporium `/store/cart`; compact on product floors | **summary** (count and total) on product floors, **whole** on `/store/cart`; lines with steppers and issues ("Only 2 left" ▲); the quote with applied promotions; delivery address form in a full sheet with native autofill (`autocomplete` tokens, `inputmode`); dock "Review order" → confirm (balance after) → placed with the order number | lines and quote side by side; delivery inline | none | cart count on the balance chip's neighbour and the viewer's handcart at the Emporium door |
| store.orders | Emporium `/store/orders`; Depot yard `/store/manage` | **summary**; room: list presentation (order no. and status pill; total; placed · items; approval flag); staff: Select mode for bulk transitions ("Fulfil 3") in the dock; refund only with `store:refund`; order opens pushed; Search all, Export; publishes `order.selected` | table with every column; bulk bar above it | none | parcels in transit |
| store.order | Emporium `/store/orders/:order` | **whole**: status rail as a **vertical** list of stations (placed, approved, fulfilled, shipped, delivered), each with actor and UTC time; lines; promotions; allowed transitions in the dock | rail horizontal | none | the parcel itself while in transit |
| store.wishlist | Emporium `/store/wishlist`, `/store/cart` | **summary**; room: items with stock and affordability ("You need 1,200 more"), "Move to cart" and ⋯ (Remove) per item | table | none | none |
| store.inventory | Stockroom `/store/inventory` | **summary** (Low and Out counts); room: list presentation (product; on hand; SKU · reserved; status chip); item expansion → **Adjust** sheet (delta stepper, reason, note) | table with chips | none | Stockroom shelves fill and empty |

### promotions (5)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| promotions.list | Fairground Office `/promotions` | **summary**; room: list (name and status pill; usage numeral; window; usage bar; "pending approval" marker); dock "New promotion" | table | none | one pavilion each |
| promotions.builder | Fairground Office `/promotions/new`, `/promotions/:promotion` | **entry**; room: a **stepper** through Eligibility · Effects · Budget · Schedule · Review · History in the dock (**‹ Step 2 of 6: Effects ›**, the value opening the step list); the condition builder as stacked condition cards, each edited in **one** condition sheet holding its three fields (field, operator, value) together, with the live eligible count in the sheet and above the dock; Review shows the diff and the dock "Submit" ("Activation needs approval by finance", R-PROMO-ACTIVATE) | tabs across the top; condition rows inline; review diff in two columns | D8 vellum fan on History (default List) | scaffolded pavilion while draft |
| promotions.simulator | Fairground Office promotion floors | **entry**; room: inputs (member or segment picker sheet, cart lines) → dock "Simulate" → result (per-member benefit and cost as a list, totals sticky); while a result shows, the city lights the simulated members' houses (visible on return to the city or in the backdrop from Enhanced) | inputs beside the result | none | lit houses during a simulation |
| promotions.performance | Fairground Office | **whole**: four KPI tiles in a 2 × 2 grid (redemptions, cost, budget used, uplift); room adds the series chart (portrait line, morphs); counter rolls on `promotion.redeemed` | KPIs in a row beside the series | none | the pavilion's budget pennant |
| promotions.active | Emporium `/store`; Home | **whole**: offer cards stacked (one visible at a time in a horizontal scroller with ‹ › when there are more than two), window and "Shop now" | cards in a row | none | bunting across the Emporium lane |

### badges (4)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| badges.showcase | Hall of Honours `/badges`; profiles | **whole**: three pinned medallions; owner: "Choose" opens the pick view as a sheet (radio grid of earned badges, limit three) | medallions in a row | D15 medallions (default Diorama) | medallions on the viewer's house |
| badges.progress | `/badges`; `/people/:handle`; Home | **whole** (up to 3, then summary): progress rings (SDF arcs) with "4 of 5 peer thanks", one per line | rings in a row | none | none |
| badges.catalog | `/badges` | **summary**; room: three-column grid of badges (earned, in progress, locked, each with a text state) → badge view pushed (criteria, holders) → award view in a full sheet (managers, admins; held for the agent) and revoke (admin) | 5 to 8 per row; badge view as a side panel | none | the Hall's plinths |
| badges.recent | `/badges`; Home | **whole** (latest 3) then summary; list of awards, newest first; not a live region | table | none | medallion rises at the Hall |

### messaging (4)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| messaging.inbox | Post Office `/messages` | **summary**; room: thread list (sender and time; subject; one-line preview; glyphs for unread with bold, star, muted, "@"); Search in the dock; Select mode bulk bar (read, star, archive, mute); a thread opens pushed (or `/messages/t/:thread`); publishes `thread.selected` | list and thread side by side (master and detail) | none | Post Office count |
| messaging.thread | Post Office `/messages`, `/messages/t/:thread` | **whole** on its floor; messages with author, UTC time, mentions, attachment chips, receipts ("Read by 3"); the reply `<textarea>` docked in the dock above the keyboard with **Send** beside it; empty view "Select a conversation" | wider measure; Send with Ctrl+Enter | none | letter flights |
| messaging.compose | Post Office `/messages/new`; group pages (collapsed) | **entry**; room: recipients as chips from a sheet (people, groups, roles), subject, body; dock "Send" → sent view with "Go to conversation" | two-column header fields | none | a letter departs |
| messaging.unread | Home | **whole**: count and the latest three unread threads as links | same | none | mailbox flag |

### notifications (4)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| notifications.feed | Bell Tower `/notifications` | **summary**; room: type chips strip, Unread or All toggle, items (type glyph, title, two-line body, time, subject link); ⋯ per item: Mark read; dock "Mark all read"; items lose unread on `notification.read` from other tabs | table-like rows with inline actions | none | bell swing |
| notifications.preferences | Lamp Studio `/settings` (listed under "Also elsewhere" at the Bell Tower) | **entry**; room: one item per type with three channel switches inline, digest schedule select, quiet hours (two UTC time inputs); dock "Save" (section 2.7.3) | the type × channel grid with sticky headers | none | none |
| notifications.deliveries | Lamp Studio `/settings` | **summary**; room: list (to and status; type · channel; suppression reason in the expansion) → detail pushed | table and detail panel | none | none |
| notifications.send | placed by the agent or page editor | **entry**; room: audience combobox in a sheet, title, body; dock "Send" | two-column | none | the Bell Tower rings for the audience as they receive it |

### tasks (3)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| tasks.list | Guild Hall `/tasks/all` | **summary**; room: list (title and priority; due "Overdue 2 d" with glyph; assignee · links); status select in the expansion; task view pushed with comments (list and a docked textarea) | table with inline status select | none | facade cards |
| tasks.board | Guild Hall `/tasks` | **entry** (counts per column); room: **one column at a time** with a column strip (Open 4 · In progress 3 · Blocked 1 · Done 9, ‹ ›, swipe on the strip); each card has **Move to…** (sheet: column and position) as the primary move; long-press then drag between columns (the strip's chips are drop targets) is the accelerator; keyboard: Space lifts, arrows move, Space drops, Escape cancels; every move announced ("Task 42 moved to In progress, position 2 of 5"); task view pushed | medium: two columns; expanded: all four columns, drag between them, task view as a side sheet | none | facade cards |
| tasks.quick-add | Guild Hall `/tasks` | **whole**: title field with **Add** beside it; "More" expands assignee combobox, due date, priority (segmented radio), link; Enter submits | all fields in one row | none | a card pinned on the facade |

### approvals (1)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| approvals.inbox | Gatehouse `/approvals`; Depot yard (`types: ["order"]`); Home | **summary** (count and the first 3); room: list (title and due; type · requested by, agent rows hatched with the "agent" label · requested at); item view pushed: the separation-of-duties checklist first (three lines, each a glyph and text), then effect text, typed facts and the diff (stacked), with D11 as a collapsed band; the dock holds **Reject** and **Approve** and a one-line SoD verdict above them, so the decision and its reason are always on screen (reject opens a note sheet); disabled with the reason as text when SoD forbids; Withdraw on own requests in ⋯; after a decision the next item opens ("Next approval ›") so 40 can be triaged in a row | list and item side by side; decisions in the item pane | D11 two keys (collapsed band on phones; beside the checklist wider) | carts at the Gatehouse |

### content (5)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| content.feed | Gazette Press `/news`; Home (cards) | **summary** (2 items); room: items (title, type, summary, author, published at, reaction counts) → reader | cards in two or three columns | none | broadsheet at the square's kiosk |
| content.reader | Gazette Press `/read/:content` | **whole**: article blocks (headings, paragraphs as real `<p>`, quotes, lists, images full width, callouts) at 17 CSS px, line-height 1.55, measure the column (≤ 68 characters); reactions (`aria-pressed`) in the dock | 18 px at a 68-character measure, centred | none | none |
| content.editor | Gazette Press `/content/new`, `/content/:content` | **entry**; room: tabs Blocks · Settings · Preview · Versions · Diff as a strip; one auto-growing `<textarea>` per text block; each block's ⋯: Move up, Move down, Delete, Change type; **Add block** in the dock; submit, publish, schedule by permission in the dock's ⋯ | blocks with drag handles; preview beside the editor | D7 vellum fan on Versions and Diff (default List) | press scaffold flag with the editor's name while in draft |
| content.review-queue | Gazette Press `/content` | **summary**; room: queue → review pushed (diff stacked; dock **Request changes** with a note sheet and **Approve**; `content:review`) | queue and review side by side | none | proof sheets on the press table |
| content.list | Gazette Press `/content` | **summary**; room: list (title and status; type · tag · author; views and reactions in the expansion); Search all; Export | table | none | none |

### people (6)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| people.directory | Directory House `/people`; Award Office | **summary**; room: list of people (initials disc with hue, name, title, region and tier pill); Search in the dock; **Filters** sheet (region, department, tier, group); publishes `member.selected` | avatar cards grid or table (switch `aria-pressed`) | none | the Residential quarter |
| people.profile-card | `/people/:handle`, `/profile` | **whole**: identity, avatar, title, region, tier, groups, roles; **Message** and **Award** in the dock when permitted; own profile: **Edit** opens a full sheet | card beside activity | none | the member's house |
| people.activity | `/people/:handle`, `/profile` | **summary**; room: timeline with UTC day separators (awards, postings, content, reviews, orders) | wider timeline | none | lantern flicker at the house |
| people.group | `/groups/:group` | **whole** (description, managers) plus member list as summary; room: members list | members as a table | none | group banner on the lane |
| people.groups | `/people` | **whole** (up to 6) then summary: groups with a "member" marker as links | grid | none | none |
| people.sessions | `/profile`, `/settings` | **summary**; room: sessions (device and last seen; surface, with MCP sessions showing the lamp glyph and "agent"); ⋯ Revoke with a confirm sheet; revoking this tab's session shows "This tab was signed out" | table | none | none |

### segments (3)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| segments.list | Census Office `/segments` | **summary**; room: list (name and live count; used by as links in the expansion); publishes `segment.selected` | table | none | none |
| segments.builder | Census Office `/segments/new`, `/segments/:segment` | **entry**; room: Rule · Preview · History as **‹ value ›** in the dock; condition cards over `people.facts`, each edited in one condition sheet (field, operator, value together) with the live count above the dock; Preview opens on D12 | rule and preview side by side | D12 houses from above (default Diorama on preview) | lit houses |
| segments.members | Census Office | **summary**; room: members list following `segment.selected`; Search all; Export | table | none | lit houses |

### automation (3)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| automation.list | The Works `/automations` | **summary**; room: list (name and enabled switch, `role="switch"`, held for the agent; trigger · last run · failures in 7 days · next fire UTC); publishes `automation.selected` | table | none | one machine each |
| automation.builder | The Works `/automations/new`, `/automations/:automation` | **entry**; room: Trigger · Conditions · Steps · Dry run · History as **‹ value ›** in the dock; Steps opens on the step list (each step an editable card pushed for editing; Move up/down, Delete in ⋯) with D9 as a collapsed band above it; Dry run lists outcomes per step with the token's path in the band; dock "Dry run" and "Save" | the machine beside the step forms | D9 machine (collapsed band on phones; beside the steps wider) | machine under construction |
| automation.runs | The Works `/automations` and per automation | **summary**; room: runs list (automation and status; started · duration · step) → run view pushed (D10 above the per-step timeline, input, output, error, **Retry** and **Cancel** in the dock) | runs and run view side by side | D10 circuit (default Diorama in run view) | circuit pulses through the machine |

### calendar (2)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| calendar.month | Clock Tower `/calendar` | **whole**: a month grid of 7 × 6 day cells of at least 44 px, each with up to three typed dots and a count; tapping a day publishes `date.selected` and shows that day's items as a list below the grid (promotion windows, content schedules, cron fires, expiry, due dates); ‹ › months; Month, Week, Day as a segmented control (week: 7 rows; day: a list); Plat `role="grid"` with full-date cell labels and arrow keys | expanded: item titles in cells, promotion windows as spanning bars, "+3 more" | none | the Clock Tower face |
| calendar.agenda | Clock Tower; Fairground Office; Gazette Press | **whole** (next 3 days) then summary: next N days grouped by day | same | none | none |

### reporting (10)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| reporting.panel | Counting House `/ledger` and any page | as its visual's compact form (below); Chart, Table, Inspector | as its visual | as its visual | none |
| reporting.board | Observatory `/reports`, `/reports/:dashboard`, `/d/:dashboard` | **entry** on Home, **whole** on its floor: the Dashboard's panels as a vertical stack in panel order; the first panel and every panel with a breach are open at their compact chart form, the rest are **collapsed panel rows** (title, headline value or "No breach", Open), with **Expand all** in ⋯, so a ten-panel dashboard is one screen of rows rather than ten charts; incremental per-panel re-query, UTC with `<time datetime>`, breach hatch and text row, trace ribbon ("Change #N"), dek rewriting to the latest change, attribution band, value labels; parameters (region, range) in a **Filters** sheet; the inspector as a sheet keeping focus on refresh | the Dashboard's own grid | none | Observatory beam on watermark |
| reporting.suite-kpis | Observatory `/reports`; Home | **whole**: six KPI tiles in a 2 × 3 grid: tabular numeral, signed delta with word, sparkline; arrow keys between tiles | a strip of six | none | the dome's rim ring |
| reporting.table | placed | **summary**; room: `kit/table` list presentation over the query result; Table, Inspector; Search all; Export | table with sortable headers | none | none |
| reporting.bar | placed | **whole**: horizontal bars (2.8); tap a bar publishes `filter.changed` and shows its plate | vertical bars when labels fit | none | none |
| reporting.line | placed | **whole**: portrait line, value plate, Set range fields → `date.selected` | multi-series, drag-brushing | none | none |
| reporting.area | placed | **whole**: stacked or single area, portrait, series chips | side legend | none | none |
| reporting.heatmap | placed | **summary** (the breach text row and a thumbnail); room: transposed heatmap with tap plates; Flat, Terrain, Table, Inspector; arrow keys walk cells | untransposed; hover plates | D13 terrain (default Flat) | none |
| reporting.scatter | placed | **whole**: square plot, tap selects nearest disc and shows its plate | hover crosshair | none | none |
| reporting.kpi | placed | **whole**: figure, delta with sign glyph and word, sparkline; Inspector | same | none | none |

### audit (3)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| audit.timeline | Record Office `/audit` | **summary**; room: list presentation (summary and seq; actor with agent hatch, person pin or system key · surface · kind · UTC time; subject in line 2); **Filters** sheet (actor, surface, kind, range); Search all over 8,500+ rows with the density strip and fast-scroll rail; entry view pushed (payload, hashes in mono, wrapping, previous hash); undo behind a confirm sheet | table with every column | none | the frieze |
| audit.verify | Record Office `/audit` | **whole**: "Both chains verified · change head #48,211 · domain head #8,544"; **Verify** runs `audit.verify`; a break is announced assertively | same | D5 hash chain (default Diorama) | the verify sweep along the frieze |
| audit.node-history | content edit floors; placeable | **summary**; room: revisions list; choose A and B with checkboxes (Space marks A and B with the keyboard); diff pushed (stacked: removed then added per hunk); undo in ⋯ | revisions and two-column diff side by side | D6 vellum fan (default List) | none |

### admin (5)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| admin.members | Town Hall `/admin` | **entry**; room: list (name and role; email masked "•••• masked" unless `people:view-private` · status) → member pushed (sessions, disable or enable with a reason sheet) → create in a full sheet (role change filed for approval, said in text) | table with masked columns | none | none |
| admin.roles | Town Hall `/admin/roles` | **summary**; room: roles with member counts and scopes → role pushed (members; propose add or remove with a reason; held under R-ROLE) | roles and role side by side | none | sealed scroll on the balcony when held |
| admin.matrix | Town Hall `/admin/roles` | **entry**; room: By role (default), By permission, By person (section 2.7) | adds Grid (default at expanded) | D14 exploded by role in By person (default Flat) | none |
| admin.grants | Town Hall `/admin/grants` | **entry**; room: list (subject and permission; resource · predicate · owner_only) → **Propose** in a full sheet with live `grant.check` counts ("This grant would let 3 principals read 1,204 rows") | table and proposal side panel | none | none |
| admin.program | Town Hall `/admin/program` | **entry**; room: programme form in sections (name; tiers and floors as a repeatable card list; expiry policy; transfer limits; look and density) → history pushed; dock "Save" (held under R-PROGRAM) | two-column form; history side panel | none | engraved name on the Square block's kerb |

### pages (1)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| pages.editor | Planning Office `/pages/:page/edit` | **entry**; room: **Phone layout**, **Desktop layout**, Catalogue and Configure as **‹ value ›** in the dock. **Phone layout** (the default at compact width, the primary editor of `compact` data): the page's items as an ordered list in compact order, each row showing title, card kind and a pin toggle; each row's ⋯: **Move up**, **Move down** (swap `compact.order` with the neighbour's; the grid is untouched), **Card kind** (whole, summary, entry, hidden), **Pin**, **Configure**, **Remove**; long-press then drag reorders as an accelerator; every move announced ("Points balance moved to position 1 of 9"). **Desktop layout:** a miniature 12-column grid (29 px columns at 358 px) of the items; tap an item to select it, then tap a target cell (nearest cell to the tap; cells are marks with ▲ ▼ ‹ › nudge buttons and **Size** as the equivalent controls) or use **Position…** (x, y, w, h steppers); a move that overlaps other items applies the **push-down rule**: every overlapped item moves down by the overlap, in reading order, recursively, keeping its x, w and h; every move announced with `x, y, w, h`. A facade preview strip at the top. **Catalogue:** widgets by domain; **Add** places at the end of the compact order and in the first free grid slot. **Configure:** form from `configSchema` with `validateConfig` errors on fields | medium: Phone layout beside a 12-column preview; expanded: the Desktop layout on drafting paper with drag, keyboard select, arrows move a cell, Shift+arrows resize, and Phone layout as a side list | none | plan table; scaffolding on the edited building |

### search (1)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| search.results | Signal Mast `/search` | **whole**: type chips strip; results grouped by type (people, products, content, promotions, automations, segments, orders, tasks, threads, dashboards, widgets) with counts, three rows each and "Show all"; Plat `<h2>` per group and `<ul>` of links | five rows each, groups in two columns | none | the mast beam points at the focused result |

### settings (1)

| Widget | Home | Compact (the design) | Expansion | Diorama | Street |
|---|---|---|---|---|---|
| settings.appearance | Lamp Studio `/settings` | **whole**: Theme (auto, light, dark), Density, **Motion** (Full, Reduced, Off; mirrors the top-bar control), Travel (fly, cut), Text size (100 to 200 % in 25 % steps), **Rendering** (Auto, Full, Enhanced, Base, Low-power, Plain), **Hand** (Right, Left), **Single-key shortcuts** (off by default), **Experience** (Classic, Town, Follow site default), live look preview; each a radio group or select; changes apply at once and persist in the Preference node (Experience in `localStorage`) | two columns with the look preview beside | none | the lamp rack |

| ID | Requirement | Test |
|---|---|---|
| TWN-R-2.9.1 | All 77 catalogue widgets are registered in `town-widgets/src/manifest.ts`, each with its card kind, compact presentation, expansion, interaction and diorama as in the tables above. | Manifest test: the id set equals `WIDGET_CATALOGUE` ids (77); every id has a module, a `card` value and a `compact` and `expand` declaration, and diorama ids match the table. |
| TWN-R-2.9.2 | Every widget's views, actions, events and bus topics match its catalogue entry. | Contract test per widget against `GET /suite/widgets` metadata. |
| TWN-R-2.9.3 | The UI-MAP section 7 cross-widget behaviours pass in the town app on the seeded data, at 390 × 844 and at 1440 × 900. | The cross-widget table run as interaction tests against `/town` routes in both profiles. |
| TWN-R-2.9.5 | The page editor's Phone layout edits only `compact` data and its Desktop layout only `at` and `size`; a Desktop-layout move that overlaps other items leaves no two items overlapping, by the push-down rule, and is the same commit from the phone and from the desktop editor. | Unit tests of the push-down rule over random layouts; interaction tests in both profiles comparing the committed Page node. |
| TWN-R-2.9.4 | Every widget's compact presentation is operable with touch alone at 360, 390 and 430 px: every view of its catalogue entry is reachable and every action it offers can be invoked by taps, with no horizontal scroll inside the pane except in declared horizontal scrollers (chip strips, featured row) that carry ‹ › buttons. | Phone widget suite: per widget, walk its views and actions by tap at each width; assert reachability and the overflow rule. |

## 2.11 Shell parity

| Shell element (UI-MAP section 5) | compact (the design) | Expansion |
|---|---|---|
| Side nav | the **Directory** in the command sheet (empty query); the district switcher | medium: rail item and side panel; expanded: the Directory column |
| Top bar | **top bar** (read zone): up, title and breadcrumb, balance chip, **Motion** button; **bottom bar** at every altitude: City, Inbox, Approvals (approvers), Search, Alerts, You; the room **dock** above it; the **status layer** (`00` section 0.4) | expanded: the full **HUD**: product mark, breadcrumb, palette trigger, balance chip, inbox, bell, live mark, Motion control, agent status with Follow agent, Classic toggle, avatar menu |
| Balance chip | top bar: coin glyph, tabular numeral; tier pill in the You sheet; digit roll on `points.posted` | adds the tier pill inline |
| Inbox and bell | bottom bar Inbox (route) and Alerts (sheet: latest 8, Mark all read, Open all) | HUD buttons; the bell as a popover |
| Live indicator | a dot on the You button when offline; "Live, change #48,211" in the You sheet | "Live #48,211" in the HUD; 1.5× at wide |
| Command palette | the **command sheet** (bottom bar Search): field at the bottom above the keyboard, results above it in the DOM order of `04` section 4.13.1, Directory when empty | centred dialog, `Ctrl+K` |
| Toasts | one at a time under the top bar, passive text for 6 s, no controls; every toast is also in the Alerts sheet | up to 4, top trailing; leader lines in the city |
| Identity switcher | the You sheet: `dev.principals`, featured six first; navigates with `?as=` | avatar menu |
| Agent log | the You sheet → Agent log sheet; the agent strip's expansion | HUD button and side panel |
| Session revoked | full page "This tab was signed out" with Reload | same |
| Offline banner | the status layer's second priority: "Offline · retrying in 4 s · Retry now" (`00` section 0.4.4) | same |
| Approvals banner | the status layer for approvers while `approvals_pending > 0`, and the Approvals slot's count | same |
| Empty site | "This workspace is empty. Pages appear here as they are built." The city is the bare board with its survey lines | the bare plinth |

| ID | Requirement | Test |
|---|---|---|
| TWN-R-2.10.1 | Every shell element of UI-MAP section 5 exists in the town app with the same data source and behaviour at 390 × 844 and at 1440 × 900, plus the Motion control, Follow agent toggle, Classic toggle and Agent log. | Shell interaction suite (command, bell, identity switch, offline, revoked, empty site) run against `/town` in both profiles. |

### Requirement numbering in this file

Sections were reordered for the mobile-first design; requirement IDs were kept where the requirement survives:
TWN-R-2.4.1 to TWN-R-2.4.5 (dioramas) are in section 2.5; TWN-R-2.5.* (dense tables) in section 2.6; TWN-R-2.6.*
(matrix) in section 2.7; TWN-R-2.7.* (charts) in section 2.8; TWN-R-2.9.* (widgets) in section 2.10; TWN-R-2.10.1
(shell) in section 2.11. New requirements take the next free number under their ID's section number: TWN-R-2.1.3,
2.3.2, 2.3.3, 2.4.6 to 2.4.9, 2.5.6, 2.5.7, 2.6.2, 2.6.3, 2.7.4, 2.8.1 and 2.9.4; the mobile review added
TWN-R-2.1.4, 2.1.5, 2.3.4, 2.4.10, 2.5.8, 2.5.9, 2.6.4 and 2.9.5. No requirement in this file is retired.
