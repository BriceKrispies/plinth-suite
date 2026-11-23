# 04. The Plat, accessibility and input

Part of the Township canonical spec (`README.md`). Requirement IDs are `TWN-R-4.<section>.<n>`.

Base: `../proposals/township.md` sections R4, R5 and R8.2. The access judge ranked Township first because the DOM is
the layout, the scroller and the focus ring, and the GPU only paints. That stays. This file adds the judge's 14
must-add requirements (section 4.14 maps each to its requirement IDs), Instrument's announcement rate limits,
keyboard walk and reflow tests, Orbit's 12-task screen-reader suite, and the fixes for every Township-specific finding.

Target: WCAG 2.2 AA as a hard gate, and a daily user who is no slower than in Classic (section 4.16).

**Mobile first.** `00-mobile-first.md` binds this file. Every accessibility flow is specified first for a phone: touch
with VoiceOver on iOS Safari and TalkBack on Android Chrome, switch access, text size up to 200 %, one hand. Keyboard,
hover and desktop screen readers (NVDA, VoiceOver on macOS) are expansions that remain complete: every keyboard
requirement here holds at every width, because external keyboards are used on phones and tablets too.

---

## 4.1 The Plat

The **Plat** is a complete semantic DOM application above the canvas: landmarks, headings, tables, grids, dialogs,
forms and live regions. It is the interior layout engine (CSS grid and flex), the scroll container, the focus owner and
the hit-test surface. The canvas is `aria-hidden="true"`, `role="presentation"`, `tabindex="-1"` and never receives
focus. In GPU tiers Plat text is transparent but present; in Plain mode it is visible.

```html
<body>
  <a class="skip" href="#main">Skip to content</a>
  <a class="skip" href="#directory">Skip to Directory</a>
  <canvas id="scene" aria-hidden="true" role="presentation" tabindex="-1"></canvas>
  <div id="plat">
    <!-- compact: #hud is the top bar (up, title, breadcrumb, balance, Motion); expanded: the full HUD.
         The same elements, rearranged by container queries; the Plat order is the same at every width. -->
    <header id="hud" aria-label="Plinth Suite">
      <a id="up" href="/town/city/points">Up to Points district</a>
      <nav aria-label="Breadcrumb">…Rewards › Points · Bank…</nav>
      <button aria-keyshortcuts="Control+K">Search or run a command</button>
      <a href="/town/points">Balance 12,480 points, Gold</a>
      <a href="/town/messages">Inbox <span class="count">3 unread</span></a>
      <button aria-haspopup="dialog">Notifications, 5 unread</button>
      <p role="status" id="live-mark">Live, change #48,211</p>
      <button aria-haspopup="menu" id="motion">Motion: Reduced</button>
      <div id="agent-status" hidden>…Agent claude-code is building Store · <button aria-pressed="false">Follow agent</button>
        · <button>Agent log</button></div>
      <a id="swap" href="/store?as=maya-ortiz">Switch to Classic</a>
      <button aria-haspopup="menu">Maya Ortiz</button>
    </header>
    <!-- the status layer: visually at the bottom (00 section 0.4.4), in the DOM directly after the top bar -->
    <section id="updates" aria-label="Updates">
      <div id="present-plate" role="dialog" aria-label="Agent request" hidden>…Not now · Go…</div>
      <div id="banners">…Offline · Retry now… Open approvals…</div>
      <div id="agent-strip" hidden>…claude-code · building Store · <button aria-pressed="false">Follow</button>
        <button>Show</button> <button>Build board</button></div>
      <button id="updates-more" hidden>2 more updates</button>
    </section>
    <nav id="directory" aria-label="Directory">…sections → pages, counts, aria-current…</nav>
    <main id="main" tabindex="-1" aria-labelledby="page-title">
      <h1 id="page-title">Points</h1>
      <nav aria-label="Floors of Bank">…</nav>
      <section class="pane" aria-labelledby="w-1-title" data-instance="widget:points-balance-1">
        <h2 id="w-1-title">Points balance</h2> …widget Plat…
      </section>
    </main>
    <div id="dock" role="toolbar" aria-label="Statement tools" hidden></div>   <!-- rooms: Back, tools, actions -->
    <nav id="main-nav" aria-label="Main">                <!-- compact: the bottom bar; medium: the rail -->
      <a href="/town/city">City</a> <a href="/town/messages">Inbox, 3 unread</a>
      <a href="/town/approvals">Approvals, 2 pending</a>  <!-- approvers only -->
      <button aria-haspopup="dialog">Search</button> <button aria-haspopup="dialog">Alerts, 5 unread</button>
      <button aria-haspopup="dialog">You</button>
    </nav>
    <section id="toasts" aria-label="Notifications" role="region"></section>
    <aside id="agent-log" aria-label="Agent activity" hidden><ol role="log">…</ol></aside>
    <div id="overlays"></div>
    <div id="announce-polite" class="sr-only" aria-live="polite" aria-atomic="true"></div>
    <div id="announce-assertive" class="sr-only" aria-live="assertive" aria-atomic="true"></div>
  </div>
</body>
```

**Rules carried from the DOM-round judges:** `main` is named by the `h1`; before load the `h1` is "Loading page…",
never a slug; no `null` or `undefined` reaches text (every Plat text setter goes through `text(v, fallback)`); change
numbers read "Change #N"; the trace is a labelled `region`; breach is never colour alone.

### 4.1.1 Data structures

```ts
// packages/town-plat/src/types.ts
export type PaintSpec =
  | { kind: "surface"; tier: 0 | 1 | 2 | 3; radius: number; tone?: Tone; hatch?: "agent" | "breach" }
  | { kind: "rule"; weight: 1 | 2; tone?: Tone }
  | { kind: "text"; role: TextRole; numeric?: "tabular" | "proportional"; tone?: Tone; roll?: boolean }
  | { kind: "icon"; glyph: IconId; tone?: Tone }
  | { kind: "field"; state: "rest" | "focus" | "invalid" | "disabled" }      // chrome only; field text is DOM
  | { kind: "image"; atlas: "product" | "badge" | "avatar"; key: string }
  | { kind: "chart"; chart: ChartModelRef }
  | { kind: "diorama"; scene: DioramaId; view: string };

export type Tone = "ink" | "ink-2" | "accent" | "agent" | "credit" | "debit" | "positive" | "warning" | "critical";
export type TextRole = "caps" | "body" | "small" | "title" | "hero" | "mono" | "num";
export const paintSpecs = new WeakMap<Element, PaintSpec>();

export interface PlatPane {
  readonly instanceUri: string;
  readonly root: HTMLElement;                    // <section class="pane">
  readonly scrollers: Set<HTMLElement>;          // registered native scroll containers
  epoch: number;                                 // bumped by mutation, resize, font load, DPR change, window growth
  lastRead: PaneSnapshot | null;
  scrolling: Set<HTMLElement>;                   // scrollers in DOM-text hand-off (03 section 3.5.3)
}
export interface PaneSnapshot {
  readonly epoch: number;
  readonly items: ReadonlyArray<PaintItem>;      // document order = paint order within a layer
}
export interface PaintItem {
  readonly el: Element;
  readonly spec: PaintSpec;
  readonly scroller: HTMLElement | null;         // rect is relative to this scroller's content box
  readonly rect: DOMRectReadOnly;                // so scrolling never needs a re-read (03 section 3.6)
  readonly clip: DOMRectReadOnly | null;
  readonly text?: string;                        // normalised textContent for kind "text"
  paint: "gpu" | "dom";                          // "dom": the runtime guard handed this element to visible DOM text
}
export interface CityPlatModel {
  readonly districts: ReadonlyArray<{
    id: DistrictId; label: string; href: `/town/city/${string}`; available: boolean;
    summary: string;                             // rewritten at most every 10 s, never announced
    buildings: ReadonlyArray<{ pageSlug: string; label: string; href: string; counts?: string }>;
  }>;
}
```

| ID | Requirement | Test |
|---|---|---|
| TWN-R-4.1.1 | Every painted run maps to a Plat text node with the same normalised text, and every Plat element with a visible role and a non-empty accessible name has a PaintSpec or is a visible native control (**no ghost text**). | No-ghost-text check on every route × persona in the sweep. |
| TWN-R-4.1.2 | No Plat text reads "null", "undefined" or "NaN". | Text scan of the Plat on every route × persona. |
| TWN-R-4.1.3 | Prose is real paragraphs: one `<p>` per paragraph, never one element per painted line; table cells are `<td>`; the painter follows the browser's wrap (access must-add 4). | Plat lint: no element whose only child is a single painted line inside a paragraph context; NVDA and VoiceOver reading-order script (section 4.15) reads a `content.reader` paragraph as one continuous sentence at 100 % and 200 % text size. |

## 4.2 Plain mode

**Plain mode** is the Plat made visible with `plain.css`, the design system's component CSS restyled for Plat class
names. It is the town app's first paint, its forced-colours path, its Save-Data path, the "Plain" rendering choice and
the state after two device losses. The city altitude in Plain mode is the **Plan map**: an inline SVG of the plinth
with district outlines and links, generated from the lot plan, plus the city Plat list. (Township called this "Plan
mode"; the name is Plain, matching the spike's `?plain=1` and Orbit.)

Plain mode is built **first**, before any GPU code (Atelier's harness graft, `07` section 7.3): every widget is
written and accepted against Plain mode.

**Classic is Plain mode's reference.** Plain mode is checked against Classic on the same route: same instances, same
accessible names, same landmarks and headings, same tab order.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-4.2.1 | `?render=plain` (alias `?plain=1`) and the Plain setting create no canvas and show the Plat with visible text on every route. | Route sweep with computed `color` alpha = 1 on text and no `canvas` element. |
| TWN-R-4.2.2 | For every route and persona at 1440 × 900, Plain mode's landmark outline, heading outline, accessible-name set of interactive elements and tab order equal Classic's, except for the town-only shell controls (Motion, Follow agent, Agent log, Switch to Classic, Hand) and the town-only routes; at 390 × 844 the set of data values and actions reachable on each route equals Classic's at the same width (the compact presentations of lists, rooms and sheets differ in structure by design). | Plat-versus-Classic diff job (section 4.15) in both profiles. |

## 4.3 Focus model

- **One source of truth: `document.activeElement`.** The GPU never owns focus.
- **The visible focus indicator is always the browser's** (access must-add 5): `outline: 2px solid var(--focus);
  outline-offset: 2px` on the focused Plat element, `Highlight` under forced colours, 3 px under
  `prefers-contrast: more`. The GPU may add a soft halo; the outline is never hidden in favour of it, so device loss,
  a stalled frame or a render-on-demand miss never hides focus.
- **Focus is immediate and never waits for, or triggers, camera or layout motion** (access must-add 7):
  - Navigation (Directory, palette, search result, `ui.present` accepted) moves focus to the new `h1` in the same
    task that swaps the Plat. Any camera motion is decoration after it.
  - Focus on a city link never moves the camera. If the focused building is off-screen, the camera **cuts** in the
    same frame so it is in view.
  - No pane, card or plaque moves in response to focus alone (Constellation's front-slot is rejected).
- **Altitude changes.** Enter focuses the interior `h1`; Exit returns focus to the building's city link; a floor
  change focuses the new `h1`; a route change focuses `#main`'s `h1` and announces "Points, Bank. Page."
- **Roving tabindex** in `kit/table` (row cursor), `kit/grid` (matrix, calendar), `kit/tabs`, `kit/menu`, `kit/board`,
  `kit/radiogroup` (View controls) and the pages editor canvas: one Tab stop per composite, arrows within.
- **Live updates keep focus.** The reconciler keys rows by entity id, so a re-render keeps the focused element. A
  deleted focused entity moves focus to the next row and announces "Approval 77 was decided by Jonas Berg; moved to
  the next approval."
- **Dialogs** use native `<dialog>.showModal()`; focus returns to the opener.
- **Rooms and pane focus** (`02` section 2.3) make the rest of the page `inert` where the breakpoint says so and
  restore focus on exit. Opening a room moves focus to the room's heading; closing returns it to the lobby card's
  header.
- **Sheets** move focus to the sheet's heading (modal) or leave it where it is (non-modal peek sheets, which are
  announced instead), and return it to the opener on close.
- **The city scroller.** Focusing a building link at compact width scrolls it into view with
  `scrollIntoView({ block: "nearest", behavior: "instant" })` in the same task, which is ordinary document scrolling,
  not camera motion; the canvas follows as a translation.
- **Not obscured** (2.4.11): `scroll-padding-top` equals the top bar's height and `scroll-padding-bottom` the bottom
  bar's, plus the dock in rooms and the status layer when shown (plus the on-screen keyboard through `visualViewport`);
  toasts, the status layer and the vista's chevron never overlap the focused element (the status layer collapses to its "+N" button when it would).

| ID | Requirement | Test |
|---|---|---|
| TWN-R-4.3.1 | The focused element always has a browser-drawn outline of at least 2 CSS px with 3:1 contrast against both adjacent colours, including during device loss and while no GPU frame is drawn. | Keyboard walk (section 4.15) checks the outline in rendered pixels at every stop; device-loss test TWN-R-3.15.1. |
| TWN-R-4.3.2 | Every focus stop has a non-empty accessible name. | Keyboard walk. |
| TWN-R-4.3.3 | For every focus stop, its viewport rect in the frame after focus equals its rect in the focus frame (no motion triggered by focus), at every altitude and Motion state. | Keyboard walk records `getBoundingClientRect` at focus and at the next rAF. |
| TWN-R-4.3.4 | After any navigation, focus is on the new `h1` before the next frame, whether or not a transition is still playing. | Interaction test timing `focus` against transition end under Full motion. |
| TWN-R-4.3.5 | Deleting the focused entity by a realtime event moves focus to the next row and announces it. | rt replay with an `approval.decided` for the focused row. |

## 4.4 Keyboard and shortcuts

The access judge found that single-letter shortcuts collide with screen-reader browse-mode keys (`G`, `F`, `T`, `D`,
`H`) and with typeahead, and that `F6` and `Alt+Shift` chords take over browser routes (X2, X4). Ruling:

**On by default** (modifier chords or scoped to a focused composite):

These are expansions for keyboards (desktop, and external keyboards on phones and tablets); every action they reach
also has a visible control at compact width.

| Keys | Action |
|---|---|
| `Ctrl+K` / `⌘K` | command palette, or the command sheet at compact width (go to any page, run any command) |
| `Ctrl+/` / `⌘/` | shortcut sheet (also in the avatar menu) |
| `Escape` | close the topmost sheet or overlay; otherwise step up (room or pane focus → interior → district → city) |
| `Ctrl+Enter` | submit the form whose textarea has focus |
| Arrows, `Home`, `End`, `Space`, `Enter` | within the focused composite (table, grid, tabs, menu, board, View control, city camera group) |
| `Alt+←` / `Alt+→` | resize the focused column header |

**Off by default**, enabled in Settings → "Single-key shortcuts":

| Keys | Action |
|---|---|
| `G` then a letter | go to: `H` home, `I` inbox, `N` notifications, `T` tasks, `A` approvals, `P` points, `S` store, `B` badges, `E` people, `C` content, `R` reports, `U` audit, `M` admin, `Y` city |
| `[` / `]` | previous or next pane (focus to the pane heading) |
| `.` | toggle Plain mode for this tab |
| `?` | shortcut sheet |

Rules:

- `F6` is not bound; the browser keeps it. No `Alt+Shift+letter` chord is bound.
- Single-key shortcuts never fire while focus is in an editable element, during composition, or inside any composite
  with typeahead (lists, menus, grids, comboboxes).
- The shortcut sheet documents the browse-mode conflict and says that Ctrl+F covers only rows on screen in long
  tables, pointing to "Search all N rows".
- The vista's camera keys (`+`, `-`, `Q`, `E`, arrows) work only while focus is in the "City camera" group, which has
  visible buttons for each action. At compact and medium a borough street is an ordinary scroller (arrows and Page keys
  scroll it when it has focus).

| ID | Requirement | Test |
|---|---|---|
| TWN-R-4.4.1 | With default settings, pressing any single printable key outside an editable element or composite triggers no app command. | Keyboard test: press every printable ASCII key on Home, the ledger and the city; assert no navigation, no mode change and no command. |
| TWN-R-4.4.2 | With single-key shortcuts on, no single-key shortcut fires inside a composite that has typeahead or in an editable element. | Keyboard test inside the matrix, a menu, a combobox and a textarea. |
| TWN-R-4.4.3 | `F6` and `Alt+Shift+<letter>` reach the browser unhandled. | Assert `defaultPrevented` is false for those events on every route. |
| TWN-R-4.4.4 | Every default-on shortcut and every opt-in shortcut is listed in the shortcut sheet and in the palette. | Unit test comparing the keymap table with the sheet's content. |

## 4.5 Announcements

Two live regions, polite and assertive, fed by one queue in `town-plat/src/announce.ts`. Announcements come from the
store layer when the event lands, never from the render path, so they fire when the painter or choreography lags.

**Policy** (Instrument's rate limits plus Township's wording):

- Clear, then set on the next frame, so repeats re-announce.
- Bursts within 400 ms merge into one sentence.
- Realtime sources announce at most once per 1.5 s; route changes and confirmations of the viewer's own actions bypass
  the limit.
- **Rebuild summary** (access must-add 11): while a `site.*` sequence is running (a `site.*` commit within the last
  10 s), per-pane announcements are suppressed and replaced by one merged sentence at most every 5 s ("Agent
  claude-code is rebuilding the site: 4 pages, 18 panes so far.") and a final summary 10 s after the last commit
  ("Rebuild finished: 31 pages, 74 panes, changes #48,300 to #48,412."). Panes under construction carry
  `aria-busy="true"` until their first data render or 3 s.
- **"Quiet live updates"** (Settings) turns off realtime announcements and keeps confirmations of the viewer's own
  actions.
- Assertive only for: session revoked, offline, an error on the viewer's own submit, an audit chain break.
- Never announced: city summaries, flows, ambient changes, anything on first load. Events in a pane while a dialog is
  open queue and play as "3 updates while the dialog was open" on close. Reconnect backfill sets `aria-busy` on
  affected panes until the first live batch or 2 s.

| Source | Region | Wording |
|---|---|---|
| Route change | polite | "Points, Bank. Page." |
| Pane added by an event | polite | "Pane added: Points balance, by agent claude-code, change #48,212." |
| Pane updated by an event | polite | "Pane updated: Statement, by Priya Nair, change #48,215." |
| Viewer's credit | polite | "Credit of 500 points, award from Maya Ortiz. Balance 12,480." |
| New message | polite | "New message from Jonas Becker: Peak week rota." |
| Approval requested (approvers) | polite | "Approval requested by agent claude-code: Activate Peak Week promotion." |
| Agent presenting | polite | "Agent claude-code wants to show you Peak Week performance. Press Enter on Go, or Escape." |
| Site cleared | polite | "Site cleared by agent claude-code: 49 pages, 112 widgets removed. Change #48,300." |
| Experience swap pending | polite | "The site switched to Classic. Switch now, or stay." |
| Form error on submit | assertive | "2 errors. Amount: exceeds your daily limit of 5,000." |
| Session revoked or offline | assertive | "This tab was signed out." / "Connection lost. Retrying in 4 seconds." |

The **Agent log** (`<aside aria-label="Agent activity">` with an `<ol role="log">`) lists every stamp as text (`05`
section 5.6). It opens from the You sheet, the agent strip, the HUD button at expanded width and the command sheet
("Open agent log"), and is reachable by keyboard and by swipe navigation.

**Mobile screen readers.** VoiceOver on iOS reads polite live regions late or drops them while the user is swiping,
and TalkBack interrupts speech on focus changes. So: the region nodes exist from first load (never inserted with
content); every announcement in the table also lands somewhere persistent the user can swipe to (the toast, the Agent
log, the pane's arrival tab, the rebuild summary line in the agent strip); and confirmations of the viewer's own
actions move focus to a status heading in the done view rather than relying on the live region alone. The live-region
behaviour of VoiceOver and TalkBack described here is **assumed until G1**, where the screen-reader scripts confirm or
correct it; the persistent copies are the fallback in either case.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-4.5.1 | Every announcement in the table fires within one frame of its event even when the painter is stalled. | Stalled-painter test: block the painter's rAF; inject each event through the test rt server; assert the live-region log. |
| TWN-R-4.5.2 | Realtime announcements never exceed one per 1.5 s, and bursts within 400 ms merge. | Inject 20 `points.posted` frames in 1 s; assert at most one announcement per 1.5 s and the merged count. |
| TWN-R-4.5.3 | During a rebuild, no per-pane announcement plays; summaries play at most every 5 s and a final summary plays. | `rebuild-live` replay against the test stack with the announcement log captured. |
| TWN-R-4.5.4 | Panes under construction carry `aria-busy="true"` until first data or 3 s. | Same replay; assert attribute timeline. |
| TWN-R-4.5.5 | The Agent log lists every stamp with seq, tool or action, target, outcome and UTC time, and opens by keyboard. | Interaction test after a scripted agent sequence. |

## 4.6 Forms, IME, autofill, selection, copy and find

**Input is native DOM and visible.** Every text entry is a real `<input>`, `<textarea>` or `<select>` in the Plat,
with **visible** text, caret, selection, IME composition, spellcheck and autofill drawn by the browser over the
GPU-painted field chrome. This is the one deliberate exception to "the GPU paints every pixel"; without it IME,
autofill and platform editing (iOS handles, Android keyboards) cannot be correct.

- **Position:** the input is where the Plat lays it out; the painter draws chrome from the same rect in the same
  frame. Nothing is positioned by script.
- **Style:** `.kit-input { background: transparent; border: 0; font: <same face, size, weight, spacing>;
  color: var(--ink); caret-color: var(--accent) }`, `::selection { background: var(--selection) }`, autofill keeps the
  painted field colour (`-webkit-text-fill-color: var(--ink)` with a long background transition).
- **During scroll:** field chrome inside a scrolling container switches to CSS backgrounds with the same token until
  the hand-off completes (`03` section 3.5.3).
- **During transitions:** a transition is never started while an editable element has focus or a composition is
  active (`03` section 3.9.1).

| Concern | How |
|---|---|
| Labels and help | `<label for>`; `aria-describedby` to help and error ids; the painted label is the same text |
| Validation | client: the action's JSON Schema on blur and submit; server: `ApiError.details` and `error.path` mapped to fields. On submit failure focus moves to the first invalid field (`aria-invalid="true"`), the error is in `<p role="alert">` under the field with a ✕ glyph, and with more than one error a summary with links to each field leads the form |
| Autofill | correct `autocomplete` tokens (`name`, `email`, `street-address`, `postal-code`, `country-name`, `tel`) |
| IME | native; `compositionstart` and `compositionend` only suspend shortcuts and defer transitions |
| Selection and copy | read-only text is transparent but selectable Plat text; `::selection` paints a visible highlight on transparent text; `kit/table` writes TSV and HTML on copy |
| Find in page | native Ctrl+F finds interior text and the highlight is visible; long tables document the window limit and offer "Search all N rows" (`02` section 2.6) |
| Comboboxes | APG combobox pattern; the popup is a Plat listbox in the overlay layer, painted by the GPU, never clipped by panes |
| Dates and times | native `date`, `time`, `datetime-local` inputs interpreted as UTC with the "UTC" label beside the field |
| Rich editing | one auto-growing `<textarea>` per block in `content.editor`; no `contenteditable` |
| Confirmations | `<dialog>` with `showModal()`; Escape cancels; focus returns to the opener |
| Idempotency | one `idempotencyKey(prefix)` per user intent, created when the form opens, kept across retries |
| Held and dry-run results | the done view says "Committed · change #48,212" or "Held for approval · approval a1b2… · R-PROMO-ACTIVATE" with a link to the Gatehouse |
| Redundant entry (3.3.7) | delivery address prefilled from the last order; recipient from `member.selected` |
| On-screen keyboards | `inputmode` (`numeric` for amounts and quantities, `decimal` for prices, `email`, `tel`, `search`) and `enterkeyhint` (`send` in compose and the thread reply, `search` in Search all and the command sheet, `next` between stacked fields, `done` on the last); `autocapitalize` and `autocorrect` off on handles, codes and SKUs |
| Keyboard and layout | the shell listens to `visualViewport` resize and scroll; the dock sits on the keyboard's top edge; the focused field is scrolled to stay ≥ 16 px above the dock; no fixed element is placed under the keyboard |
| Font size on iOS | every input's computed font size is ≥ 16 CSS px, so iOS Safari never zooms the page on focus |
| Touch selection | read-only Plat text is selectable with the platform's handles because it is real DOM text; Select mode (`02` section 2.6.1) is the multi-row selection on touch |

| ID | Requirement | Test |
|---|---|---|
| TWN-R-4.6.1 | Text typed into every form field lands in the field, the field's text is visible (computed colour alpha 1), and submit reaches the confirm step with the typed values. | Spike criterion C7 generalised to every form widget. |
| TWN-R-4.6.2 | Japanese and Korean IME composition in the palette, the transfer memo, the compose body and a content block commits the composed text and no shortcut or transition fires during composition. | CDP `Input.imeSetComposition` test in Chromium; manual check in Safari at G1. |
| TWN-R-4.6.3 | Chrome autofill populates the store cart delivery form and the transfer recipient field. | Playwright with a saved address profile; manual Safari check at G1. |
| TWN-R-4.6.4 | A failed submit focuses the first invalid field, announces the error count assertively and shows the summary when there is more than one error. | Interaction test on `points.transfer` with an over-limit amount. |
| TWN-R-4.6.5 | Native `<select>` and `type=date` open the platform picker on click, on tap and on keyboard activation. | Playwright activation test in both profiles (asserts the picker opens or the value changes via keyboard). |
| TWN-R-4.6.6 | Every text input has the `inputmode`, `enterkeyhint` and `autocomplete` the table assigns to its kind and a computed font size of at least 16 CSS px. | Plat scan of every form on every route at 390 × 844. |
| TWN-R-4.6.7 | With the on-screen keyboard open (emulated by reducing `visualViewport.height` to 60 % portrait and 50 % landscape), every focused field with its label and error is inside the visual viewport above the dock, the dock's primary button is visible, and at least 40 % of the visual viewport is form content (TWN-R-0.4.6). | Phone form suite at 390 × 844 and 844 × 390: focus each field of every form in turn under keyboard emulation; assert rects. |

## 4.7 The Motion control

A visible, persistent **Motion** control in the HUD (access must-add 3), a menu button with three states. Settings →
Appearance mirrors it.

| Element | Full | Reduced | Off |
|---|---|---|---|
| Enter, Exit, travel | dolly with fov change and unfold (`03` section 3.9.1) | 150 ms crossfade, camera cut | cut |
| Focus-driven camera | none (cut into view only) | none | none |
| Tilt-shift band | follows hover and focus | fixed | fixed |
| Sky, water, foliage, sun (decor) | moving, 30 Hz cap | still | still |
| Flows, parcels, letters | moving | static highlighted path for 1.5 s plus the count on the destination plaque | count on the destination plaque only |
| Construction | sink, scaffold, rise | 150 ms fades | appear and disappear |
| Agent lamp | flies | placed at its target | placed at its target, fixed intensity |
| Digit rolls, arrival tab, morphs, diorama tilts | animated | swap with a static delta chip / 120 ms crossfade / final framing | swap, no fade |
| Bell swing, gears, circuit pulse | animated | static lit state | state plate only |

- **Default:** **Reduced** for every viewer until they choose otherwise, whatever the OS preference reports (the
  judge's "Reduced when the preference is set or unknown"; a browser reports "no preference" when none is set, which
  is indistinguishable from unknown). Choosing Full is one action on the HUD control. This default is an open
  question for the owner (README); the demo profile sets Full explicitly.
- Under `prefers-reduced-motion: reduce`, Full stays selectable; the menu says "Your system asks for reduced motion".
- The choice persists in the Preference node `ui.motion` (with a `localStorage` hint for the first paint) and in
  `?motion=full|reduced|off` for tests.
- **Off satisfies 2.2.2** by stopping all autonomous motion; Reduced also has no autonomous motion. Full has decor
  motion, which the always-visible control stops.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-4.7.1 | The Motion control is a visible button at every altitude and width: in the top bar at compact width (a 44 × 44 target showing the state as a glyph and in its accessible name, "Motion: Reduced"), in the HUD at expanded; it is operable by touch and keyboard and mirrored in Settings. | Shell interaction test at 390 × 844 with touch and at 1440 × 900 with keyboard. |
| TWN-R-4.7.2 | A viewer with no stored choice gets Reduced. | Fresh-profile test with `reducedMotion: "no-preference"` and `"reduce"`. |
| TWN-R-4.7.3 | Under Off, no frame differs from the previous one for 10 s on `/town/city` with `gen:live` running, except for state changes caused by events (end states). | Frame-diff test with event-caused regions masked. |
| TWN-R-4.7.4 | Under Reduced and Off, no camera translation, rotation or fov change happens at any altitude or transition. | Camera rig trace over the interaction suite. |
| TWN-R-4.7.5 | No content flashes more than three times in any one-second period in any Motion state (2.3.1). | Frame-luminance analysis over the demo scenario capture. |

## 4.8 Forced colours, increased contrast and reduced transparency

- **Forced colours** (access must-add 1). Under `forced-colors: active` the town app switches to Plain mode: the
  canvas is not created and system colours win, using the design system's per-component forced-colours rules.
  `forced-color-adjust: none` is never set on Plat text. Text is therefore drawn once.
- **`prefers-contrast: more`** (access must-add 13): the interior uses the look's `-more` tokens (ink at maximum
  contrast, rules and component boundaries at ≥ 4.5:1, a single surface tier, focus outline 3 px); hatches under text
  thin to 1 px stripes; plaques gain a 2 px edge.
- **`prefers-reduced-transparency: reduce`** (access must-add 13): the interior backdrop becomes the opaque
  `surface0` (no blurred city), the vellum fan's sheets become opaque offset cards, the terrain threshold plane becomes
  an opaque hatched band, the exploded matrix planes become opaque with depth shown by offset only, and the palette dim
  becomes opaque.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-4.8.1 | Under `forced-colors: active` no canvas exists and Plat text is visible on every route. | Forced-colours Playwright project over the route sweep (spike C8 method). |
| TWN-R-4.8.2 | Under forced colours, the ledger's text pixels are drawn once: the text-pixel count of a forced-colours screenshot of the ledger is within 2 % of the Plain render's. | Forced-colours project: screenshot both, threshold to text pixels, compare counts. |
| TWN-R-4.8.3 | Under `prefers-contrast: more`, every look uses its `-more` tokens and all rendered-pixel contrast checks pass at the `-more` thresholds. | `prefers-contrast` Playwright project running the contrast checks of section 4.9. |
| TWN-R-4.8.4 | Under `prefers-reduced-transparency: reduce`, no interior surface behind text is translucent. | Media-emulated render test sampling backdrop pixels behind panes and dioramas. |

## 4.9 Contrast in every look

Two checks, both gates.

1. **Token check** (`pnpm --filter @plinth/town-looks check`), over all 6 looks × light, dark, light-more, dark-more:

| Pair | Minimum |
|---|---|
| body, caps and small text on any surface tier | 4.5:1 |
| large text (≥ 24 px, or ≥ 18.66 px bold) | 3:1 |
| UI component boundaries (field box, switch track, focus outline against the surface and the backdrop) | 3:1 |
| chart series against the surface | 3:1 |
| credit and debit tones as text | 4.5:1 |
| plaque ink on plaque plate | 4.5:1 |

2. **Rendered-pixel check** (access must-add 8; Instrument's method). On the reference machine, render each test scene
   with text hidden, then sample the darkest and lightest background pixel under every text run's box and compute
   contrast against the run's ink. Worst cases that must be in the scene set:
   - plaques over bloom (nocturne) and over offline fog;
   - text over the agent hatch: the attribution band, agent table rows, the matrix's agent column, stamp labels;
   - text over the breach hatch;
   - diorama labels over the terrain, the exploded matrix planes and the vellum fan;
   - the HUD, the top bar, the bottom bar, the dock and the status layer over the brightest and darkest city
     framings, at 390 × 844 DPR 3 first;
   - sheet headers, the dock and the status layer over a scrolled list;
   - the palette and dialogs over the dim.

   Hatch under text is limited so that both the stripe and the gap meet the minimum against the ink.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-4.9.1 | The token check passes for every pair in every look variant. | `town-looks check` in CI. |
| TWN-R-4.9.2 | The rendered-pixel check passes for every text run in the worst-case scene set, in every look and theme, on both backends. | Contrast job on the reference machine. |
| TWN-R-4.9.3 | City plaques pass the rendered-pixel check at city and district altitude in every look, including during bloom and fog. | Same job, city scenes. |

## 4.10 Zoom, text scaling, spacing, reflow and magnifiers

- **Zoom to 200 %** (1.4.4) and **reflow at 320 CSS px** (1.4.10): the Plat is the layout, so it reflows by CSS; the
  painter re-reads on the DPR or size change; raster runs re-rasterise at the new DPR. Because the compact design is
  the base design and breakpoints are in rem (`00` section 0.3), zoom and text size move any screen toward the phone
  layout, which already works at 320 px.
- **Pinch zoom on phones** is browser zoom and is never blocked (`00` section 0.5); the painter re-reads on
  `visualViewport` scale changes and text stays DOM text until it has (`03` section 3.5.6 rule 5).
- **Text size preference** 100 to 200 % sets the root `font-size`; everything is in rem.
- **Text spacing** (1.4.12): the engine reads `letter-spacing`, `word-spacing` and `line-height` from computed style
  once per epoch and per overriding element, so user styles reflow the Plat and the painter follows.
- **Magnifiers** (the access judge's X6): focus lands immediately and never triggers motion (section 4.3), so a
  magnifier following focus is never chasing a camera. Pane rects at rest are pure translations, so magnifier tracking
  sees stable geometry.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-4.10.1 | Every route at 320 CSS px width and at 200 % text size has no horizontal page scroll, no overlapping text runs and no clipped non-scrolling content. | Reflow job (Instrument 9.9.7 method) over the route sweep. |
| TWN-R-4.10.2 | With the WCAG text-spacing values applied (line-height 1.5, paragraph spacing 2, letter 0.12, word 0.16), no text is clipped and painted runs still match the browser's line starts or fall back to DOM paint. | Text-spacing job with the bookmarklet stylesheet injected. |
| TWN-R-4.10.3 | At 2×, 3× and 4× CSS zoom every focus stop, when focused, is inside the visual viewport with a 24 px margin. | Magnifier proxy in the keyboard walk. |

## 4.11 Target size, gestures, dragging and pointer

- **Target size.** At least 44 × 44 CSS px under a coarse pointer and at least 24 × 24 CSS px otherwise (above WCAG
  2.5.8's 24 px minimum on touch). Targets are sized by the pointer, not by the width (TWN-R-0.5.3).
- **Gestures.** The vocabulary, and the visible single-pointer, non-path alternative for every gesture, is `00`
  section 0.5. That table is normative for this file (WCAG 2.5.1 and 2.5.7). Gestures never replace a visible
  control; long-press only ever opens what the ⋯ button opens.
- **Town links at compact and medium width** are DOM elements: landing tiles over the landing, and building links in
  a borough street's native scroller over the baked band images, at least 44 × 44 (`01` section 1.4), so they are
  neither projected nor moving relative to what is drawn.
- **City links in the vista** (access must-add 9, expanded width). Each pointer-active link box is the building's
  projected rect padded to at least 24 × 24 CSS px (44 × 44 under a coarse pointer), centred on it. Where two padded
  boxes would overlap, the one with the smaller projected area loses pointer events at that pose; its building stays
  reachable through the district's plaque menu and the city Plat list. Link boxes are rebuilt on the settle frame of
  every camera move.
- **Dragging** (2.5.7): every drag has a single-pointer alternative: board moves (Move to…), page editor (Move up and
  down, Position…), content blocks, column resize (Columns…), chart range (Set range), diorama orbit (⟲ ⟳), the vista's
  orbit and zoom (camera buttons), sheets (Expand, Collapse, Close), the fast-scroll rail and the timeline (tap the
  track, step buttons).
- `Ctrl+wheel` and pinch at compact and medium width are never captured (browser zoom).

| ID | Requirement | Test |
|---|---|---|
| TWN-R-4.11.1 | In the vista, at every settled camera pose in the city test set, every pointer-active city link is at least 24 × 24 CSS px (44 × 44 under a coarse pointer) and no two pointer-active links overlap; at compact and medium width TWN-R-1.4.2 and TWN-R-1.4.8 hold. | City target-size test over 8 headings × 3 zoom levels at 1440 × 900 and 1024 × 1366 with touch, plus the compact geometry tests. |
| TWN-R-4.11.2 | Every building is reachable by a pointer at every pose and scroll position, through its link or its district's plaque menu. | Same tests: union of active links and plaque-menu entries covers all buildings. |
| TWN-R-4.11.3 | Every Plat control is ≥ 24 × 24 CSS px, and ≥ 44 × 44 under a coarse pointer. | Target-size scan on the route sweep in both profiles (the form of TWN-R-0.5.3 for this file). |
| TWN-R-4.11.4 | `Ctrl+wheel` is never `preventDefault`ed, and no pinch is captured outside the vista's canvas. | Event test at every altitude in both profiles. |
| TWN-R-4.11.5 | Every drag listed above has its single-pointer alternative visible on the same screen, and the alternative reaches the same end state. | Covered by the gesture parity suite (TWN-R-0.5.1), with a per-drag assertion list. |

## 4.12 The city for assistive technology

The city Plat is a navigation tree, after Constellation's field navigator. At compact and medium width it is the
document of `01` section 1.4.7: the landing is a list of borough links in **tile order** (Insight, Admin, Engage,
Rewards, Town Square, Personal, Operate, New Town; reading order follows the tiles top to bottom, left to right), each
with its live summary as `aria-describedby`; a borough street has, per district band, an `<h2>` with its summary
("Your balance 12,480. Last activity: credit of 500, 2 minutes ago.") and a list of its buildings as links. A
screen-reader user on a phone moves by headings from band to band, the same walk a sighted user's thumb makes. At
expanded width it is `<nav aria-label="City">` with the same tree as nested lists, boroughs in the same order.
Unavailable districts are absent. Summaries are rewritten at most every 10 s and never announced.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-4.12.1 | The city Plat lists every available borough in tile order on the landing and every available district and building of a borough in band order in its street, with headings for bands, each building a link to a working route, with no link for unavailable districts, at every width. | Outline snapshot per persona at 390 and 1440 px; route check on every link. |

## 4.13 Touch screen readers: VoiceOver and TalkBack

The canvas is `aria-hidden`; touch exploration finds Plat elements because they are real elements (on phones all text
is visible DOM text, `03` section 3.5.7). The flows below are designed for these readers first. **Every statement in
this section about how VoiceOver or TalkBack behaves is assumed until G1**, where the 13-task scripts (TWN-R-4.15.3)
confirm or correct it; each row names the fallback that holds if the assumption fails.

**DOM order for the phone.** The order is: skip links, the top bar (`banner`), the **Updates** landmark (the status
layer: present plate, banners, agent strip; `00` section 0.4.4), the toast region, `main`, the room dock (a
`toolbar`), the Main navigation. So from the top bar's last control, the first swipe reaches the present plate or the
agent strip, and the landmarks rotor reaches Updates in one move; main content follows. The visual order differs (the
status layer and dock are drawn at the bottom); this is deliberate and limited to these two regions, each a named
landmark or toolbar, so a reader knows where they are (WCAG 1.3.2 and 2.4.3 are about meaning and operability, which
this order serves: status first, then content, then tools and navigation).

| Flow | VoiceOver (iOS Safari) | TalkBack (Android Chrome) | What the app guarantees |
|---|---|---|---|
| Move around a page | swipe right and left; rotor to headings, landmarks, links, form controls | swipe; reading controls for headings, links, controls | every pane, band and room has a heading; landmarks `banner`, `main`, `navigation` (Main), `region` (alerts, toasts) |
| Activate | double-tap | double-tap | every control is a native `<button>`, `<a>` or input; no `click` handler on a non-interactive element |
| Long-press equivalent | double-tap and hold is not used | not used | the ⋯ button is always present |
| Close a sheet or room | two-finger scrub ("Z") is assumed to fire the dialog's `cancel` (WebKit) | the back gesture or button pops the history entry | modal sheets and rooms push a history entry and handle `cancel`; a visible Close or Back always exists, which is the fallback |
| Scroll | three-finger swipe | two-finger swipe | borough streets, lists and sheets are native scrollers; virtual lists keep `aria-setsize` and `aria-posinset` so position is spoken |
| Adjust a slider | swipe up or down | volume keys or swipe up and down | the fast-scroll rail, timeline and range use `<input type="range">` with `aria-valuetext`; the rail's step is 5 % of the list, so 20 swipes cross any list; fine moves use Jump to, Back 100 and Forward 100 (fallback if the step is not honoured: those buttons) |
| Tabs and segmented controls | rotor or swipe | swipe | `role="tablist"` and `role="radiogroup"` with selected state spoken |
| Reorder | the item's Move up, Move down and Move to… buttons | same | announced after each move ("Task 42 moved to In progress, position 2 of 5") |
| Live updates | polite announcements; persistent copies to swipe to (section 4.5) | same | rebuild summaries in the agent strip; the Agent log |
| The present plate | announced, focus is not moved | announced | the plate is the first item of the Updates landmark: one swipe after the top bar's last control, or one landmarks-rotor move; Not now then Go |
| The command sheet | the field, then the results | same | DOM order is the field, then the listbox in rank order (best match first); see section 4.13.1 |
| Text entry | the on-screen keyboard and dictation | same | labels, `inputmode`, `enterkeyhint`; errors announced and linked (section 4.6) |

**Switch access and Voice Control** reach every control because every control is native and named; the visible
labels equal the accessible names' first words (2.5.3), so "Tap Review transfer" works.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-4.13.1 | **Retired.** It was the patched-on "Phone input" requirement (every route operable at 390 × 844, tables keeping table semantics as CSS cards, the keyboard not covering fields). Replaced by TWN-R-0.2.1, TWN-R-2.9.4, TWN-R-2.5.6, TWN-R-4.6.7 and TWN-R-4.13.2 to 4.13.4. | — |
| TWN-R-4.13.2 | Every modal sheet and room closes by `history.back()` and by the dialog `cancel` event, returning focus to its opener. | Phone interaction suite: open each sheet kind and a room; close by each path; assert focus. |
| TWN-R-4.13.3 | No element with a click, pointer or touch handler lacks a native interactive role, and every interactive element's accessible name begins with its visible label. | Plat lint plus a runtime scan on every route at 390 × 844. |
| TWN-R-4.13.4 | Every announcement of section 4.5 also leaves a persistent text in the Updates landmark (at most two elements after the top bar's last control in DOM order), in the Alerts sheet, or in the Agent log. | Announcement-persistence test: for each announcement kind, assert the persistent copy and its DOM position relative to the top bar. |
| TWN-R-4.13.5 | The Plat order at compact width is: skip links, top bar, Updates, toasts, main, dock, Main navigation; the Updates landmark is named and present (empty when nothing is active). | DOM order check on every route at 390 × 844. |
| TWN-R-4.13.6 | The command sheet's DOM order is the search field followed by the listbox with options in rank order, and its keyboard order equals its DOM order (section 4.13.1). | Keyboard and DOM-order test of the command sheet with 12 results. |

### 4.13.1 The command sheet's order

The field is at the bottom of the sheet, above the keyboard, and the results list sits above the field. The best match
is drawn **nearest the field** (at the bottom of the list), the next above it, and so on, so the thumb reaches the most
likely result first. In the DOM the field comes first and the listbox follows with options in **rank order** (best
first), so the reading, swipe and Tab order is "field, best match, next match …", the same sequence as the visual
order read outward from the field. The combobox follows the APG pattern with the popup above the input: **ArrowUp**
moves to the next result (away from the field) and **ArrowDown** back toward it, and the shortcut sheet says so. With
an empty query the Directory appears in the same place in section order, nearest the field first.

## 4.14 The access judge's 14 must-adds

| # | Must-add (judge-access.md) | Requirement IDs |
|---|---|---|
| MA-1 | Forced colours shows the DOM, not a doubled canvas; forced-colours Playwright project with text-pixel counts | TWN-R-4.8.1, TWN-R-4.8.2 |
| MA-2 | Single-key shortcuts default off; modifier chords for defaults; document browse-mode conflicts; no single letter in typeahead widgets | TWN-R-4.4.1, TWN-R-4.4.2, TWN-R-4.4.3, TWN-R-4.4.4 |
| MA-3 | Visible persistent Motion control (Full, Reduced, Off), Reduced by default, Off stops all autonomous motion; dolly zoom, parallax, physics and Ctrl+wheel capture out of the default path | TWN-R-4.7.1 to TWN-R-4.7.5, TWN-R-4.11.4 |
| MA-4 | Mirror text is real paragraphs; reading-order test | TWN-R-4.1.3 |
| MA-5 | Browser-rendered focus indicator that survives device loss and stalled frames | TWN-R-4.3.1, TWN-R-3.15.1 |
| MA-6 | Whole-dataset search, count announcement, Copy all, Export CSV and the window hint on tables over 100 rows | TWN-R-2.5.1, TWN-R-2.5.2, TWN-R-4.4.4 |
| MA-7 | Focus never waits for or triggers camera or layout motion; viewport-rect test | TWN-R-4.3.3, TWN-R-4.3.4 |
| MA-8 | Rendered-pixel contrast on hatched, glass and bloomed surfaces with defined worst cases | TWN-R-4.9.2, TWN-R-4.9.3 |
| MA-9 | Target size enforced in projected space, or an equivalent list | TWN-R-1.4.2, TWN-R-4.11.1, TWN-R-4.11.2, TWN-R-0.5.3 |
| MA-10 | Automated regression tests: keyboard walk, reflow, text spacing, parity, stalled painter, no ghost text, magnifier proxy, forced-colours and prefers-contrast projects, NVDA and VoiceOver scripts including following a rebuild | TWN-R-4.15.1 to TWN-R-4.15.4, TWN-R-4.1.1, TWN-R-4.5.1, TWN-R-4.10.1 to TWN-R-4.10.3, TWN-R-3.5.3, TWN-R-3.5.8 |
| MA-11 | Rebuild announced as summaries, `aria-busy` on panes under construction, agent log by keyboard | TWN-R-4.5.3, TWN-R-4.5.4, TWN-R-4.5.5, TWN-R-4.13.4 |
| MA-12 | Camera-driven `ui.present` and agent follow opt-in by an explicit toggle, with a Back chip; no idle heuristic | TWN-R-5.4.3, TWN-R-5.4.4, TWN-R-5.5.2, TWN-R-5.5.3 |
| MA-13 | `prefers-contrast: more` and `prefers-reduced-transparency` for every look | TWN-R-4.8.3, TWN-R-4.8.4 |
| MA-14 | Task-time study as a gate before cutover; Classic stays the working surface if any task is more than 10 % slower | TWN-R-4.16.1, TWN-R-4.16.2 |

## 4.15 Accessibility test obligations

| ID | Requirement | Test |
|---|---|---|
| TWN-R-4.15.1 | axe-core reports zero serious or critical violations on every route × the seven personas (the six named roles and `ana-silva`) × {city, lobby, room, every sheet kind} × {390 × 844 touch, 1440 × 900} × {webgpu, webgl2, plain}. | `check:a11y` extended to `/town` routes, altitudes, profiles and render modes, phone profile first. |
| TWN-R-4.15.2 | The **keyboard walk** passes on every route at 390 × 844 (external keyboard) and at 1440 × 900: every focus stop has an accessible name, a browser outline visible in rendered pixels with ≥ 3:1 contrast, an unchanged rect between focus and the next frame (after any instant `scrollIntoView`), is not obscured by the top bar, bottom bar, dock, status layer or toasts, and Escape leaves every sheet and overlay; the magnifier proxy runs at 2×, 3× and 4×. | `check:keys` extended to `/town` in both profiles. |
| TWN-R-4.15.3 | The **13-task screen-reader suite** passes first on **VoiceOver with iOS Safari** and **TalkBack with Android Chrome** on the G0 phones, then on NVDA with Chrome (Windows) and VoiceOver with Safari (macOS); the keyboard-only version of the same tasks passes in Playwright in both profiles. Tasks: navigate to Points from the city; read the statement's first five lines; transfer points with a validation error and fix it; approve a held promotion; find a member by search; open a thread and reply; move a task on the board; switch theme; read a chart as a table; follow the announcement of an agent-built pane; open the alerts and mark all read; complete checkout; follow an agent rebuild by announcements, the agent strip and the build board alone and state which pages were built. | Keyboard-only: Playwright on every stack. Screen readers: run by the owner's designated tester at G1 (mobile readers), at every domain wave gate and at the demo rehearsal, recorded pass or fail per task and reader on the gate task. |
| TWN-R-4.15.4 | A Plat-versus-Classic diff runs on every route × persona: the full outline diff at 1440 × 900 and the data-and-actions diff at 390 × 844 (TWN-R-4.2.2). | Job comparing `/town/<route>?render=plain` with `/<route>` in both profiles. |

## 4.16 Daily use: the task-time study gate

The access judge (must-add 14) and Township's own kill criterion require that people who live in the Suite are not
slowed down, on the device they use. The study runs on phones first.

- **Tasks** (10 routine tasks): find and approve an approval; reconcile the trial balance; change a permission for a
  role; triage 40 approvals; find a ledger line by memo; place an order; award points to three members; edit a
  promotion's budget; find a member's latest order; read a dashboard's breach.
- **Conditions:** (1) **phone, touch**, on a named mid-range phone; (2) **phone, VoiceOver or TalkBack**; (3)
  **desktop, keyboard only**; (4) **desktop, NVDA with Chrome**. Each in Classic and in the town app at the default
  settings (Motion Reduced, single-key shortcuts off, the tier the device starts at).
- **Design:** within-subject, each participant does every task in both apps with the app order counterbalanced and a
  fixed written task script with fixed seed data; at least **8 participants per condition** (conditions 2 and 4 need
  daily screen-reader users); one practice task per app, not measured.
- **Measure:** per task and condition, task time and errors (a wrong action committed, or a task abandoned).
- **Analysis:** non-inferiority. For time, the ratio of Town to Classic per participant, summarised as the geometric
  mean with a 90 % bootstrap confidence interval (10,000 resamples); Town passes a task if the interval's upper bound is
  at most 1.10. For errors, the difference in the share of participants with any error, with a 90 % confidence
  interval (Newcombe); Town passes if the upper bound is at most 10 percentage points.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-4.16.1 | The study has run in all four conditions and is recorded on its gate task before `appearance.experience` is set to `"town"` on any shared deployment. | Gate checklist on Workgraph (G-STUDY, `07` section 7.4). |
| TWN-R-4.16.2 | If any task in any condition fails the non-inferiority analysis above (time ratio upper bound above 1.10, or error-share difference upper bound above 10 points), the site default stays `"classic"`; the town app may still be chosen per viewer. | Gate rule recorded with the study's per-task intervals and the participant counts. |
