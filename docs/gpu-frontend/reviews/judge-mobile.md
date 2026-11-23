# Adversarial review: is the Township spec mobile-first, or mobile patched on?

Task WG-5536. Reviewer scope: `docs/gpu-frontend/spec/` 00 to 07 and README (4,522 lines), plus the previous
desktop-first commit `7c0cf56` for comparison and `packages/spec/src/suite/widgets.ts` for the catalogue (77 widgets
confirmed: 70 declared directly plus the 7 reporting visuals). Nothing was run; this is a reading review.

## Verdict in brief

**Score: 6 out of 10 for how mobile-first the spec truly is.**

The restructure is real, not cosmetic. Container-query layout, the compact presentation declared per widget, the
list presentation for dense data, the gesture table with a visible alternative for every gesture, the By role /
By permission / By person matrix, portrait-first charts, a phone-profile default test project and the "Plain first"
order are genuine mobile-first decisions. The spec is far better than the usual retrofit.

It still has four places where desktop thinking survives underneath the phone vocabulary:

1. **The page model is desktop-authored.** The phone lobby is a linearisation of a 12-column desktop grid, and the
   page editor edits only the desktop grid (finding 1).
2. **The thumb-zone rule is defined narrowly enough to be satisfied while violated.** It tests the submit button
   only; every view switch, search field, tab strip and role switcher sits at the top (finding 2).
3. **The high street is the right navigation primitive at the wrong granularity.** Its "whole town" view cannot
   physically fit, and a thumb sees about 3 of about 21 bands (findings 4, 5 and the city verdict).
4. **Several phone flows were designed by stacking the desktop side-by-side layout** (a 448 px diorama above the
   list it was beside; finding 6).

There are also several internal contradictions, some requirements that cannot fail or cannot be satisfied, and a
set of mobile-web fundamentals the spec never mentions (viewport model, overscroll, wake lock, offline start).

---

## Findings, ranked by severity

Format: ID, severity, where, requirement, the 390 px scenario, the fix.

### 1. CRITICAL. The page model is desktop-first; the phone lobby is a stacked desktop grid

- **Where:** `02` section 2.1.1 ("Order: panes in `(y, x)` order of the page layout, the order Classic's single column
  uses"), section 2.10 (`pages.editor`), `01` section 1.6 rule 5; **requirements** TWN-R-2.1.1, TWN-R-2.1.3.
- **Scenario:** A page author on a phone, or the agent via `site.page.put`, lays out Home. The layout is a
  12-column grid (`x, y, w, h`), authored for 1440 px. The phone gets the same widgets in reading order of that grid:
  whatever the desktop author put top-left comes first. The balance, which a phone user wants first, comes first only
  if it happens to be top-left. A page in which a wide chart at `y=0` sits left of the approvals inbox at `y=0, x=8`
  puts the chart first on the phone. The author has no way to say "on a phone, approvals first, hide the chart".
  Section 2.1.1 itself says this is "the order Classic's single column uses", which is exactly the patched-on
  reflow the owner fears.
- **Why it matters:** this is the one place where the information architecture of the product is decided, and the
  phone has no vote in it. The card kind (whole, summary, entry) is declared per widget, not per placement, so a
  page cannot promote a widget to "whole" on a phone either.
- **Fix:** add a compact placement to the Page node's layout items: `compact: { order, card: "whole" | "summary" |
  "entry" | "hidden", pin?: boolean }`, defaulting to the derived `(y, x)` order so existing pages work. Make the
  `pages.editor` Layout tab the primary editor of this ordered list (it already is a list on a phone), with the
  12-column grid as the expansion's second tab. The facade rule (storeys, windows) can still derive from the desktop
  grid. Add a requirement: `site.page.put` accepts compact placement, and the seeded pages have a hand-authored phone
  order (Home leads with balance, approvals, unread) tested against the persona's first task.

### 2. HIGH. The thumb-zone requirement is narrow enough to pass while the design violates it

- **Where:** `00` section 0.4, TWN-R-0.4.1 and 0.4.2; `02` sections 2.3, 2.6.1, 2.7.1, 2.10 (widgets); `05` section
  5.11.
- **Requirement:** TWN-R-0.4.1 tests only "the primary action (the one that submits, decides or commits)". TWN-R-0.4.2
  bans only "destructive or committing control" in the top bar.
- **Scenario:** The user opens the Statement room and wants to search. The mock in `02` section 2.3 puts "Search all
  912 lines" sticky at the top. They switch Table | Flow: the View control is in the room's header row at the top. In
  the permission matrix the By role / By permission / By person segmented control and the role chip strip are "at the
  top of the room". The promotions builder's step tabs ("Step 2 of 6", ‹ ›) are at the top. The board's column strip
  is at the top. Every one of these is a frequent, one-handed action, and every one is in the read zone. Meanwhile the
  Command sheet puts its search field at the bottom edge with results growing upward, so the spec knows the right
  answer and applies it once. Top-of-screen actions also include the offline banner's "Retry now", the approvals
  banner (a link into the approvals flow), the toast's "×" and the edge pill at the top edge. The demo beat at 0:45
  switches the ledger to Flow with the top-right View control, and the rehearsal fact in `05` section 5.12 exempts
  "the lobby and street content itself" from its bottom-40% rule, so this is never caught.
- **Fix:** widen the rule to "every control used more than once per task is in the bottom 40%". Add a **room tool
  row** that sits directly above the action bar and hosts the room's search field, View control, segmented controls
  and step/column strips; the title strip at the top stays read-only (title, sibling chevrons). Keep sticky search at
  the bottom on phones the way the command sheet already does. Move "Retry now" and the approvals link into the
  agent-strip layer (bottom) and leave only passive status at the top. Remove the 5.12 exemption or list it exactly.

### 3. HIGH. The bottom bar disappears inside rooms, so Command, Inbox, Alerts and You are unreachable there

- **Where:** `00` section 0.4 (action bar "replaces the bottom bar"), TWN-R-0.4.3; `01` TWN-R-1.9.1; `02` section 2.11.
- **Requirement:** TWN-R-1.9.1: "Every page ... reachable in at most two activations from any altitude through the
  command sheet's Directory (Command, then the page)". TWN-R-0.4.3 says the bottom bar is "replaced by the action bar
  inside rooms and full sheets".
- **Scenario:** The user is in the Statement room (the place they spend most of their time). A new message arrives
  (toast, "Inbox 4"). To open the inbox, the Alerts sheet, the You sheet (Classic switch, Hand, Agent log, identity
  switch) or the command sheet they must press Back to the lobby first, then use the bar. From a room, the Directory
  is Back, Command, page: three activations, which contradicts the "any altitude, two activations" requirement, and
  which fails the same test on a form or a pushed detail (Back, Back, Command, page).
- **Fix:** keep the five-destination bar visible in rooms and let the action bar sit directly above it, or fold the
  action bar's two actions into a bar that takes the **Command** slot's place only while a form has focus. Simplest
  is a two-row stack (action bar 56 above bottom bar 56) that collapses the bottom bar when the keyboard opens. Either
  way, fix TWN-R-1.9.1's test to start from a room.

### 4. HIGH. Overview is infeasible as specified, and the "whole town" never reads on a phone

- **Where:** `01` section 1.4.2 (diagram and rules), section 1.4.3 (Overview), TWN-R-1.4.5; `05` demo beats 1:05 and
  1:50.
- **Requirement:** TWN-R-1.4.5: "Overview shows every available band as a >= 44 px tall target in one viewport at
  390 x 844".
- **Scenario:** Count the bands. The rule says "one band per district"; the diagram puts two districts in a band;
  either way the seed has about 19 to 22 bands (Square, 4 Personal, 3 Rewards, 6 Engage, Operate, 2 Insight, 4 Admin,
  New Town). 21 bands at 44 px is 924 px. The usable height at 390 x 844 is 844 minus top bar and inset (about 103),
  minus bottom bar and inset (about 90), minus the agent strip (44) = about 607 px. The requirement cannot be met by
  about 50 %, even before the test's own 300-page case. If Overview shrinks the street to fit, a 160 to 245 px band
  becomes about 25 to 40 px tall and a building about 10 to 20 px wide, so the Overview that the demo uses for
  "a gold streak runs up the high street" (1:05) is a column of slivers with illegible plaques.
  The spec also has no stated place for the Overview button in the thumb-zone map.
- **Fix:** see the city verdict. Short form: make Overview a **borough-level** view (8 targets, each at least 44 px
  and in practice about 70 px), not a band-level one, and drop the 44 px-per-band requirement. Resolve the
  diagram/rule contradiction (one district per band, or a band-sharing rule with a max of two).

### 5. HIGH. The high street's scroll-as-camera claim ignores that the canvas lags the compositor

- **Where:** `01` section 1.4.3 and 1.4.6; `03` section 3.5.3 (the "city exception"), section 3.10; TWN-R-1.4.1,
  1.4.3; `07` C12(a).
- **Scenario:** The user flings the street. The DOM scroller (links, plaque text) is moved by the compositor on a
  separate thread at up to 120 Hz. The canvas draws from a `scroll` event on the main thread at up to 60 Hz and lags by
  one or more frames, more on iOS where scroll events during momentum are coalesced. During the fling the plaque text
  (DOM) and the building (canvas) separate and "swim"; the focus ring on a link floats off its facade. The spec solves
  this for interiors by drawing everything inside the scroller in the DOM during scroll (3.5.3), but explicitly exempts
  the city, where that is impossible. TWN-R-1.4.1 only samples `cameraY()` against `scrollTop` per drawn frame, which
  proves the uniform equals the lagged scroll value, not that it matches the compositor's.
- **Second problem:** TWN-R-1.4.3 and C12(a) test "tap at a fixed point every 16 ms during a fling and assert each
  navigation matches elementFromPoint". On iOS Safari and Android Chrome a tap during momentum scrolling stops the
  scroll and is consumed; no click is dispatched. The test as written describes behaviour that the platform does not
  have, so it cannot pass on device and will be argued about at G0.
- **Fix:** bake each band's static model to a texture (or an image) **inside the scroller** so that the compositor
  scrolls it in lockstep, and keep the canvas only for effects (flows, lamp, construction) drawn in a sticky overlay
  that tolerates a frame of lag. This also removes the 120 Hz problem and most of the street's GPU cost. Re-word the
  tap test: a tap after the scroll settles lands on the link under it, and a tap during a fling only stops it.

### 6. HIGH. Dioramas: a contradiction, and several desktop side-by-side layouts stacked

- **Where:** `00` section 0.5 gesture table and TWN-R-0.5.2; `02` section 2.5 and widget rows D9, D10, D11, D14;
  TWN-R-2.4.9.
- **Contradiction:** the gesture table has "Drag on a diorama: orbit". TWN-R-0.5.2 says "at compact and medium widths
  no element sets `touch-action: none` or pinch-zoom handling". A one-finger drag handler on a 358 x 448 viewport
  inside a vertically scrolling room needs `touch-action: none` (or pan-x only, which then prevents room scroll by
  horizontal drag and still captures vertical orbit).
- **Scenario A (scroll trap):** the user flicks upward on the diorama, which is two thirds of the room's height, to
  scroll the room. The orbit handler wins, or the room scrolls and the diorama never orbits. Either way the user is
  trapped on a large touch surface.
- **Scenario B (editor pushed off screen):** `automation.builder`'s Steps and Dry run tabs "open on D9 above the step
  list" (default Diorama). On a phone that is a 448 px viewport above the thing being edited: the step list is below
  the fold, and with the keyboard open (about 336 px) there is no step form visible at all. This is the desktop
  "machine beside the step forms", stacked.
- **Scenario C (triage slowed):** `approvals.inbox` item view shows "D11 above the decision checklist, which is always
  visible", default Diorama. 448 px of diorama plus the effect text, typed facts, diff and a checklist in about 690
  px of room height cannot all be visible, so "always visible" is false. A user triaging 40 approvals in a row (the
  study task) scrolls past a diorama 40 times.
- **Fix:** on coarse pointers, drag-to-orbit is off and the orbit buttons are the mechanism; drag-orbit is an
  expanded, fine-pointer accelerator. For every dense-work widget the default view on phone is the list, form or
  checklist; the diorama is a one-tap sheet or a collapsed 160 px header band. Cap a diorama in a working room at 35 %
  of the visual viewport height. Retire "always visible" for D11 or make it a sticky bottom block.

### 7. HIGH. Medium and landscape geometry do not fit; landscape and the keyboard leave no content

- **Where:** `00` sections 0.2 (landscape), 0.3.1, 0.4; `01` sections 1.4.3 and 1.4.4; TWN-R-0.2.1, 1.4.4.
- **Scenario A (two columns that do not fit):** medium starts at 37.5 rem (600 px). Two street columns at "the same
  scale as the phone" need 2 x 358 plus gutters, about 764 px, plus the side rail (about 72 px). From 600 to about 840
  px the second column overflows or the scale silently changes, which breaks TWN-R-1.4.6's rigid-block claim and
  TWN-R-0.2.1's no-horizontal-scroll. A landscape iPhone is 844 px wide with 47 px insets each side: 844 - 94 - 72 =
  678 px, which is "medium by width" yet cannot host two columns.
- **Scenario B (landscape height):** a landscape phone is about 390 px tall. The borough index is 8 x 48 = 384 px, which
  alone fills the screen; top bar 56 plus action bar 56 leaves about 278 px of room content; a diorama's portrait
  framing of 448 px does not fit. The spec says landscape "keeps the compact design", but its tests list only portrait
  sizes (360, 390, 430).
- **Scenario C (keyboard):** portrait, form focused, agent active, approvals banner showing: top bar 103 + banner 40 +
  agent strip 44 + action bar 56 + iOS keyboard about 336 = 579 px of 844. The field, its label and its error get
  about 265 px. TWN-R-4.6.7 only asserts the field is above the action bar, not that any usable area remains. In
  landscape the same stack exceeds the viewport.
- **Fix:** medium starts at the width where two columns fit (about 52 rem) or the second column drops to a stack;
  specify the landscape layout explicitly (index becomes a scrubber strip along the thumb edge, diorama framing
  switches to landscape, bars collapse). While a field has focus: hide the top bar, banners and agent strip, and
  require at least 40 % of the visual viewport to be field and label. Add 844 x 390 and 667 x 375 to TWN-R-0.2.1.

### 8. HIGH. Agent choreography reads on at most three bands of a 21-band street

- **Where:** `05` sections 5.5 (following), 5.6, 5.7; `03` sections 3.9.4 and 3.9.6; TWN-R-5.7.1, 5.8.2.
- **Scenario:** Maya's phone shows about 3 bands. A `site.restore` rebuilds 49 pages with building starts staggered
  140 ms apart (about 7 s total) and, at Base, 4 constructions at a time. Follow scrolls to each band the lamp
  reaches "smooth over 300 ms". The lamp traverses about one band per 330 ms. The street never rests, each building's
  phases (survey 220, foundation 300, frame, courses, sign, windows) take more than a second, and 4 concurrent
  constructions are mostly off screen, where Base "applies their end states at once". The viewer sees a blurred pan
  and then a finished town. The demo's centrepiece ("Construction, legible and attributed") does not read on the
  device it is presented from. The survey line "as a horizontal band crossing the screen" crosses the bands in view
  in about a second and is gone.
- **Related:** stamp labels are "visible at district altitude and on hover at city altitude" (`03` 3.9.6). There is no
  hover on a phone and no district altitude on the high street, so stamp labels have no phone visibility rule
  (violates TWN-R-0.1.1's own principle); the Agent log is the only reading path.
- **Related:** the thumb-zone layer can stack agent strip (44), present peek sheet (about 120), "Back to where you
  were" chip (44) and an edge pill above the bottom bar: about 36 % of the viewport before content, with only the
  prose rule "they move aside" to keep them off the focused element.
- **Fix:** while `site.*` commits are arriving, switch compact to a **build board**: Overview-style rows (one per page
  or per district, at least 44 px) with a progress meter, the lamp's current row highlighted, stamps as a scrolling
  list under it, and the building art as a small thumbnail per row. Individual construction art plays only on the band
  the viewer opened. State a z-order and a hard cap on floating layers (for example at most two at once, queued by
  priority). Give stamps a tap-to-reveal plate.

### 9. MEDIUM-HIGH. Screen-reader flows contradict the DOM skeleton

- **Where:** `04` section 4.1 (skeleton), section 4.5, section 4.13; TWN-R-4.13.4; `01` command sheet.
- **Scenario A:** `04` 4.13 says the present plate's Go and Not now are "reachable by one swipe from the top bar",
  and TWN-R-4.13.4 says every announcement leaves persistent text "within two swipes of the top bar or in the Agent
  log". The skeleton puts `#toasts`, `#agent-log` and `#overlays` after `<main>` and the nav. A VoiceOver user
  swiping forward from the top bar passes the whole page (hundreds of items in a ledger room) first. Neither claim can
  hold with that order, and the 4.15.3 task "follow an agent rebuild by announcements and the agent strip alone" is
  therefore a long swim.
- **Scenario B:** the command sheet's "results growing upward" with the field at the bottom: if the DOM keeps best
  result first, Tab and swipe order runs opposite to the visual order (WCAG 1.3.2, 2.4.3); if the DOM is reversed,
  rotor and reading order are wrong.
- **Scenario C:** the fast-scroll rail is a `role="slider"` over 912 items. A VoiceOver user adjusting by swipe moves
  one item per swipe; there is no coarse step, so the rail is unusable by that user, with Jump to as the only way.
- **Scenario D:** TWN-R-4.13.2 says VoiceOver's two-finger scrub "fires the dialog's `cancel`". That is an assumption
  about WebKit; it appears in no automated test and only in the manual task suite.
- **Fix:** place the status layer (agent strip, present plate, toasts, banners) in the DOM directly after the top bar
  and make it a landmark ("Updates") reachable by the rotor. Give the rail `aria-valuetext` jumps of 10 % with Page
  steps (`aria-keyshortcuts` is no help on touch; use buttons "Back 100", "Forward 100"). Specify the command sheet's
  DOM order explicitly and test it. Mark every VoiceOver/TalkBack behaviour claim as "assumed until G1" and name the
  fallback.

### 10. MEDIUM-HIGH. The demo script does not hold together when presented from a phone

- **Where:** `05` section 5.12 and 5.5; TWN-R-5.12.1, 5.12.2.
- **Scenario A (Follow state contradicts the beats):** setup says presentation mode (Follow on) for Maya. At 2:45
  "Maya taps the pavilion: Home's lobby" while the agent is mid-rebuild; `05` 5.5 says Follow navigates the viewer to
  the lamp's building on each `site.page.put`, and only a touch on the *street* pauses it, so she is pulled out of
  the lobby by the next page. At 3:05 "She taps Show" appears (the Show button only exists with Follow off) while
  Follow is still on until 4:20, when "Maya taps Follow off". The beat table needs an explicit Follow state per beat.
- **Scenario B (the room sees almost nothing):** a portrait iPhone mirrored to a 1920 x 1080 projector fills about
  30 % of the width, pillarboxed, with 17 px text. AirPlay mirroring shows no touch indicators, so the audience cannot
  see "taps Select, taps 12 lines" or the thumb at all (scrcpy has "show touches"; AirPlay does not, short of
  AssistiveTouch). Captions in "a one-line strip under the top bar" are the only reading aid.
- **Scenario C (idle lock):** the terminal beats (clear, rebuild, night) leave the phone untouched for 20 to 40 s. iOS
  and Android auto-lock after 30 to 60 s by default; the mirror drops and the page is backgrounded. No Wake Lock API
  use is specified for presentation mode.
- **Scenario D (page backgrounded):** 0:45 pastes into Notes. Switching apps backgrounds Safari; rt may suspend, the
  WebGPU context may be reclaimed, the Choreographer "applies end states on return". The next beat's live ripples
  can be missed, and the 0:45 beat has no recovery line.
- **Scenario E:** the presenter holds a phone in one hand and "the terminal on the side laptop" is also theirs. A
  second person is needed to drive the agent, a third to hold Ana's phone, a fourth for Priya. The script never says
  so.
- **Fix:** add a per-beat Follow column; require Wake Lock and "show touches" in presentation mode and the rig;
  specify a projector layout (the expanded vista run on the laptop mirrored from the same session, with the phone as
  the controller) as the preferred room view, because pillarboxed phone mirroring wastes the show; name the four
  roles; replace the Notes paste with an in-page "copy confirmation" plate.

### 11. MEDIUM-HIGH. Base tier realism and measurement gaps for a mid-range phone

- **Where:** `00` section 0.6; `03` sections 3.11 to 3.14; `07` C11 to C14, K5, K12, K14.
- **Download:** "Download before the first painted frame, <= 450 KB compressed in total" includes the 170 KB Plain
  payload plus the three WebGPU build (both backends), TSL node materials, engine, text and a tabular font. A
  tree-shaken three r187 WebGPU renderer with the WebGL2 backend is routinely several hundred KB compressed on its
  own. The spec says "re-measure for 0.187", which means the figure is currently a guess promoted to a requirement.
  At 1.6 Mbit/s, 450 KB is about 2.3 s of transfer before 150 ms round trips and 4x CPU parse; t3 <= 4.0 s is tight
  at best.
- **Warm-up:** "interior pipelines ready <= 600 ms after renderer.init()" on an Adreno 6xx: WGSL-to-driver or GLSL
  link of TSL-generated uber shaders is commonly several hundred milliseconds each on that class, and `compileAsync`
  parallelism is limited. The readiness fallback (keep Plain text) is good; the number is not credible.
- **Thermals:** TWN-R-3.12.3 and C12(c) pass when the *guard does not fire*. The guard is a drift detector on frame
  time, so a device that throttles gently and never trips it passes. On Android `dumpsys thermalservice` is a real
  measurement; **iOS has no equivalent, no Battery Status API and no Low Power Mode signal**, so the iPhone half of the
  soak and the "battery below 20 %" Low-power trigger cannot be measured or can only be inferred. No battery drain
  budget (percent per 10 minutes) exists although the row is titled "Battery and thermals".
- **DPR contradiction:** `00` section 0.6 gives the Base city DPR as min(DPR, 2); `03` section 3.13 sizes the render
  targets "at 1170 x 2532 device px" (DPR 3) at 12 MiB each. Both cannot be Base.
- **Structural observation:** `03` section 3.5.3 hands everything inside a scroller to the DOM while it scrolls and
  swaps back 120 ms after it stops. On a phone, most of an interior session is scrolling or within 120 ms of it. GPU
  text is therefore on screen only when the page is still, and every stop is a DOM-to-GPU swap whose antialiasing
  differs subtly (DOM text uses the platform rasteriser; raster runs are the same but pixel snapped at fractional
  DPR). The spec's own evidence (the "double vision" prototype failures, 70.6 % of runs within 1 px after reflow) is
  that this is where it breaks.
- **Fix:** make **hybrid text the Base default on coarse pointers** (visible DOM text, GPU paints surfaces, rules,
  charts, city and transitions), keep GPU text for Enhanced and Full, and keep the per-element guard as the fallback.
  That removes the largest phone risk (text integrity), shrinks the bundle (no SDF and run-atlas code on the first
  paint path), removes the scroll hand-off and drops K1 to a non-event on phones. Re-state the size and warm-up
  figures as "targets, unmeasured, decided at G0" instead of requirements, and add a battery-drain figure for Android
  and an explicit "iOS: guard only, no ground truth" note.

### 12. MEDIUM. Mobile-web fundamentals the spec never mentions

- **Where:** `00` section 0.2 ("the browser's own bars may take 100 px or more"), `03` sections 3.5.6 rule 5 and
  3.6 (epochs), TWN-R-0.2.1, 0.3.3.
- **Viewport model:** nothing says whether the shell is a fixed-height app with internal scrollers (`100dvh`; Safari's
  toolbars never collapse, so about 100 px is permanently lost) or document scroll (the toolbars collapse and
  re-expand while scrolling, firing `visualViewport` resizes). In the second case section 3.6's rule that a
  `visualViewport` resize bumps every pane's epoch and shows DOM text until re-read, plus the canvas backing-size
  rule `round(css x dpr)`, means a render-target reallocation and a re-read on every toolbar collapse during a street
  scroll. This is a probable jank and text-flicker generator the tests (keyboard and rotation only) will not see.
- **Overscroll:** the spec bans pull-to-refresh as a feature but never requires `overscroll-behavior: none` on the
  street, rooms and sheets. On Android Chrome, pulling down at the top of the street reloads the app (mid-demo, with
  Follow on); a scrolling sheet chains into the street underneath.
- **Standalone and offline:** no web app manifest or `display: standalone` (full height, no URL bar, better for the
  mirrored demo), no service worker, so "drops to offline" means an offline cold start is a blank page, and every
  visit re-downloads the 450 KB path.
- **Text size:** "Text size 100 to 200 %" is an in-app preference. iOS Dynamic Type is not honoured and Android font
  scale is honoured only through root `rem` if the preference is not overridden; a user who has already set a large
  system font gets nothing, and the bottom bar (five labels in about 78 px each, "Command") and the top bar (up,
  title, breadcrumb, balance, Motion) have no specified behaviour at 200 % on 360 px. TWN-R-0.3.3 tests only which
  breakpoint is selected.
- **Hand:** the one setting that decides edge placement is buried in Settings. A first-run prompt or inference from
  the first two thumb taps is not specified.
- **Fix:** specify `dvh` plus `visualViewport` rules (ignore toolbar-only resizes below N px for epoch bumps),
  `overscroll-behavior: none`, a manifest and a service worker for shell and city chunk, and a Text size rule that
  reads `font: -apple-system-body` and the Android font scale as the default. Add a 200 % text test at 360 px for both
  bars.

### 13. MEDIUM. Desktop capabilities with no phone control, and a test that cannot find them

- **Where:** `02` sections 2.6.1 and 2.8, widget rows; `00` TWN-R-0.1.1.
- **Sorting:** the list presentation (2.6.1) offers Search all, Select, Jump to, Copy all and Export. Sort appears
  only in the table presentation (`aria-sort` header buttons). A phone user cannot sort the ledger by amount or
  orders by total. TWN-R-0.1.1's inventory counts invokable (action name, target node kind) pairs and Plat data cells;
  client-side sorting calls no action, so the inventory test cannot see the gap.
- **Heatmap cells at 28 px:** `02` 2.8 sets "cells at least 28 px" and "tapping a cell shows its plate", while
  TWN-R-0.5.3 requires 44 px for every target under a coarse pointer. One of them is wrong. A 12 x 12 grid at 44 px
  does not fit 358 px either, which is the real constraint; the spec should say the heatmap pans, or that cell tap is
  nearest-cell with a step-button alternative.
- **Matrix editing:** By role gives one row, one grant sheet, one "Propose change" at a time. Reviewing a role (12
  permissions to change) is 12 round trips with no multi-select. The grid's strength (scan and compare) exists only at
  expanded; "two roles side by side" at medium is not available on a phone for comparing roles (TWN-R-2.6.2 only
  checks state parity).
- **Page editor semantics:** Move up/down "swap its cell with its neighbour's in reading order" is undefined when the
  widgets have different widths and heights (the swap can overlap or not fit). It needs a defined collision rule and
  a test. It is also the only editor with numeric x, y, w, h steppers, which is a form, not a layout tool, on a
  phone; a tap-to-select, tap-a-target-cell nudge on a miniature grid is the mobile-native gesture.
- **Card kind:** `pages.editor` is declared **whole** although section 2.1.1 defines **entry** as the kind "for
  widgets that only make sense full height (builders, editors ...)". A tabbed three-view editor shown whole in a lobby
  card cannot satisfy TWN-R-2.1.3's 50 % cap.
- **Fix:** add Sort to the list presentation's ⋯ menu (and an inventory test that includes client-only capabilities
  by scanning Plat controls, not server actions); resolve the 28 versus 44 contradiction; add a multi-row selection
  mode to By role; define the swap rule.

### 14. MEDIUM. Requirements that cannot fail, cannot pass, or are too weak to mean anything

- **TWN-R-1.4.3 and C12(a):** see finding 5; platform-incompatible.
- **TWN-R-3.12.3, C12(c):** measures the guard, not the heat; no iOS signal (finding 11).
- **TWN-R-4.16.2 (study gate):** "any task median more than 10 % slower, or the error rate is higher" with no sample
  size, no variance rule and no minimum number of participants per condition. With a handful of participants the
  median varies by more than 10 % between identical runs, so the gate either never passes or passes by chance, and
  "error rate is higher" is true for any non-identical numbers. Needs n, a confidence interval or a non-inferiority
  margin, and a fixed task script.
- **TWN-R-5.12 rehearsal fact "every tap is inside the bottom 40 % except Motion and the lobby and street content":**
  the exemption covers nearly every tap in the script (finding 2).
- **TWN-R-2.4.9 "every tappable element at least 44 x 44 in projection":** diorama elements (cells, ribbons, links,
  planes) at 358 x 448 with 40 houses or 600 matrix cells cannot all be 44 px; the test has no stated count limit and
  no fallback to the Plat list.
- **TWN-R-0.6.2 / 3.3 "meaning is carried at every tier":** untestable as a blanket until an effects manifest names
  what "meaning" is; the spec relies on a manifest that does not exist.
- **TWN-R-1.4.5 :** infeasible (finding 4).

### 15. MEDIUM. The vista expansion is under-specified against the "rigid blocks" rule

- **Where:** `01` sections 1.4.2 ("every facade facing the viewer (south)"), 1.4.5, TWN-R-1.4.6.
- **Scenario:** the high-street blocks are rigid, every band's facades face south. At expanded width, blocks sit
  around the Town Square on a plinth "whose facades face its own lane", and the camera has 8 headings that "bring
  every block's facades into view". If blocks are not rotated, three quarters of the headings show backs and sides
  (the hillside rows, stepped retaining walls). If blocks are rotated to face the Square, the claim in 1.4.5 that
  "the buildings, lots, facades and streets inside each block are the same" still holds, but TWN-R-1.4.6 and the
  street graph ("within a block identical in every layout") need to say rotation is allowed, and the district kit
  needs back and side elevations the high street never shows. That is a cost the expansion hides, and it makes the
  vista less of a free expansion than the spec claims.
- **Fix:** state that blocks rotate, add the elevations to the kit scope, and make G-ART review the vista's back and
  side elevations.

### 16. LOW. Smaller items worth fixing

- Borough index labels "Sq Pe Rw" are cryptic abbreviations; the visible label should be an initial plus the count or
  an icon with the full name on press (voice control, 2.5.3).
- The index is on the thumb edge and overlays the rightmost 48 px of a 358 px board whose lots are 78 px wide;
  TWN-R-1.4.2 says no two links overlap, but the index overlaps the rightmost lot's link. With Hand: left it moves to
  the leading edge, where the platform back gesture owns the first 24 px (the spec's own exclusion zone). The rail has
  the same left-hand conflict.
- `03` section 3.12 says the Low-power tier leaves "interiors unchanged", while `00` section 0.6 gives flat twins for
  dioramas at Low-power.
- Approvers' primary work is triage, yet Approvals is not in the bottom bar (README open question 7) and the only
  entry is a banner at the top and a count on You. Treat it as a defect, not a question.
- Open questions 8 and 12 (street shortening and certificates) both change the phone experience materially and should
  be defaults, not questions: hide unlit Operate/Insight/Admin scenery from members' streets (about a third of the
  scroll), and prefer the click-through certificate only after C11 shows WebGPU is exposed.

---

## Screens and widgets that are still desktop-first

| Screen or widget | Why it is still desktop-first | Where |
|---|---|---|
| Page composition and the page editor | The phone order is derived from the desktop grid; the editor's primary model is x, y, w, h | `02` 2.1.1, `pages.editor` |
| Home and every lobby | Hierarchy decided by a desktop author; no per-placement card kind or phone priority | `02` 2.1.1 |
| `automation.builder` (Steps, Dry run) | Desktop side-by-side (machine beside forms) stacked: 448 px diorama above the step list | `02` D9 row |
| `approvals.inbox` item view | D11 diorama above the checklist, "always visible" is false at 390 x 844; default Diorama slows triage | `02` D11 row |
| `reporting.heatmap` | 28 px cells versus 44; tapping a cell of a dense grid | `02` 2.8, D13 row |
| `admin.matrix` | Whole-role review is one row at a time; no multi-select; grid comparison only at expanded | `02` 2.7.1 |
| `reporting.board` | Vertical stack of every panel of a desktop dashboard (up to 10 charts), no per-panel priority or collapse | `02` widget row |
| `promotions.builder`, `segments.builder` conditions | Condition builder is three nested sheets per condition (field, operator, value); a desktop row of three selects reshaped | `02` widget rows |
| Every dense list | No Sort control at compact | `02` 2.6.1 |
| The ledger, matrix, board, builders | View, search, step and column controls at the top of rooms | `02` 2.3, 2.7.1, 2.10 |
| The city at Overview | Cannot show the town at readable size; band-level targets | `01` 1.4.3 |
| Stamps | Labels visible "on hover"; no touch rule | `03` 3.9.6 |
| Landscape phone | "Compact plus a rail" with no layout work; index overflows 390 px | `00` 0.2 |
| Command sheet | Results growing upward with undefined DOM order | `00` 0.4, `04` 4.13 |

---

## Verdict on the high-street city

**The decision to abandon a pinch-and-orbit plinth on a phone is correct. The high street as specified is the right
navigation primitive and the wrong whole-city concept. It is a genuine mobile navigation design and a partial loss of
magic.**

What it gets right: native vertical scroll is the only gesture every user already has; building links are real DOM
elements that scroll with the model, which fixes the moving-link accessibility class at its root; every facade faces
the viewer; the order is indexable; a screen reader gets a heading tree. This is strictly better than shrinking the
plinth.

What it loses:

- **The town stops being one object.** On a phone you see about 3 of about 21 bands. The plinth's claim ("a quiet suite
  is a quiet town; a busy hour is a busy town", ripples across districts) needs the whole town visible. Here the only
  whole-town view is Overview, which cannot fit (finding 4), is built from slivers if it did, and is in a
  button rather than the arrival experience.
- **Spatial relationships collapse to a single vertical axis.** Every flow between districts is a vertical streak down
  one street, so "Ana's order goes to the Emporium and the Stockroom" becomes distance in scroll, not geometry.
- **The agent rebuild is mostly off screen** (finding 8).
- **The first impression is a list of rows.** The first screen of the product is the Town Square at the top of a long
  scroller, which looks like a scroll of illustrated sections.

### Alternatives, in order of preference

1. **Portrait plinth landing, borough high streets for detail (recommended).** The City altitude opens on the whole
   town as a **portrait miniature** (358 x about 520 px, one screen): the Square in the middle, eight borough lots as
   tiles at least 44 px, each with its live signal (unread flag, bell face, pending carts) and the lamp visible.
   Ripples between boroughs read here as streaks between large tiles. Tapping a tile pushes that borough's **high
   street** (3 to 6 bands, one and a half screens, so the 44 px band targets and the building art are comfortable),
   with a zoom-out button back to the landing. This keeps the "one living object" the owner bought, removes the
   infeasible Overview and the 21-band scroll, keeps DOM links, and the vista at expanded becomes the same landing
   scene with a perspective camera. The borough index becomes unnecessary.
2. **Semantic zoom with scroll-linked scale.** Keep one street but add a three-position zoom (street, district group,
   town) driven by buttons in the thumb zone, with band content simplified (silhouettes, then counts) at each step.
   Cheaper to build than option 1, but Overview's 44 px target rule still has to be retargeted to boroughs.
3. **Keep the single street but invert the emphasis.** Treat the city as a living header (about 35 % of the screen: a
   pinned landing strip with ripples) above the Directory-like scroller of bands. Weaker, since it is a dashboard with a
   picture.

Whichever is chosen: bake bands into compositor-scrolled textures (finding 5), hide unlit scenery from members'
streets (open question 8), and give the rebuild its own build board (finding 8).

---

## Things the spec gets right (so they are not lost in the fixes)

- Container queries as the only layout mechanism, with pane breakpoints, so a 3-column desktop pane equals the phone
  (TWN-R-0.3.2). Strong and testable.
- A gesture table where every custom gesture has a visible single-pointer alternative, no gesture within 24 px of the
  leading edge, and no swipe-to-act on list items. Better than most apps (WCAG 2.5.1, 2.5.7 are met on paper).
- The list presentation with an expansion that must contain every table column, Select mode for copy, and whole-dataset
  search with an announced count.
- The People lane link solving the 40 px house problem.
- The consent peek sheet for `ui.present` with Go on the thumb side and a 44 px target rule.
- Explicit mobile-AT notes (VoiceOver drops live regions; persistent copies for every announcement).
- Phone-first test profiles, the real-device gates, and the honest "emulation does not measure a phone GPU" statement.
- Plain mode first, which is what makes a hybrid-text default (finding 11) cheap to adopt.
