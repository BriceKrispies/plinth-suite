# 01. Concept and the city

Part of the Township canonical spec (`README.md`). This file covers the concept, the altitudes, the city designed for
a portrait phone (the **landing** of the whole town and each borough's **high street**) and its expansions (side by
side at medium, the **plinth vista** at expanded), district and building
placement for all 19 domains, wayfinding, the art-direction rules and the art-direction gate. Requirement IDs are
`TWN-R-1.<section>.<n>`. Each requirement names its test. `00-mobile-first.md` binds this file.

Base: `../proposals/township.md` sections 1 and 2, redesigned mobile-first (README, "Mobile-first restructure").
Where this file and the proposal differ, this file wins.

---

## 1.1 Concept

Northwind is an architectural model of a town.

- Each domain is a **district** with its own architecture.
- Each Page node is a **building** in its primary domain's district.
- Each Widget instance is a **window** on that building's facade, placed at its grid cell, and a **pane** you work in
  once you step inside.
- Realtime is traffic. A quiet suite is a quiet town; a busy hour is a busy town.
- The agent is a **surveyor lamp**: a brass instrument that carries a real light. You can see where it works, what it
  built and the stamp it left for every call.

**Designed for the hand first.** On a phone the town opens as a **landing**: the whole town as one portrait miniature
on one screen, the Town Square in the middle and the seven boroughs as large tiles carrying their live signals. A tap
on a borough opens its **high street**: its districts as stacked bands, every facade facing you, walked by scrolling
with your thumb. On a desktop the same scene is the **plinth vista**, the boroughs' full blocks standing around the
Town Square, which you can orbit. The buildings, lots, facades and streets inside each block are the same model in
every layout; only how the blocks are arranged, and the camera, expand.

This states the owner's model ("widgets are apps in their own right, each an expression of part of a domain")
physically, and makes the clear-and-rebuild demo literal construction.

The town app is one of two experiences over the same backend. The other, **Classic**, is today's DOM app
(`packages/web`). It is kept: it is the reference that Plain mode is checked against, the fallback for browsers
without a GPU path, and the baseline of the task-time study. Viewers and the site switch between them by the swap
contract (`06-architecture-testing.md` section 6.7).

## 1.2 Principles

These rules bind every other file. Each is enforced by the requirement named after it.

1. **An architect's model, never a game.** Basswood, mount card, cast resin, brushed brass, frosted acrylic. No
   cartoon characters, no bouncing, no score pop-ups. People are turned-wood figures. (TWN-R-1.11.*)
2. **The honesty rule.** Every moving or lit thing that looks like data is data: driven by a real rt frame or a real
   query result the viewer may see. Decoration is limited to sky, water, foliage and sun, is never shaped like data,
   and stops under the Motion control. (TWN-R-1.2.1, TWN-R-5.2.3)
3. **Light means signal** (Instrument graft). Emissive light is reserved for data and events: lit windows (a widget
   exists), the agent lamp, flows, arrival glows, the verify sweep. Nothing else glows. On the Base tier, where there
   is no bloom, the same things are the only ones drawn in the look's lit colours. (TWN-R-1.11.4)
4. **3D for orientation, flow and structure; flat for reading and editing.** Text that must be read is always
   screen-aligned, pixel-snapped and never lit, bloomed, fogged, blurred or tonemapped (`03-rendering.md` section 3.4).
5. **Work never waits for animation.** Data, Plat content and announcements update within one frame of the event.
   Choreography can lag, collapse or skip. (TWN-R-5.8.1)
6. **Power users can skip the city.** Every page is reachable from the command sheet's Directory, the browser URL and
   (at expanded width) the Directory column; Classic is one action away. (TWN-R-1.9.*)
7. **Plain language first.** Every plaque, Directory entry and announcement leads with the domain's plain name
   ("Notifications"), and the architectural name follows ("Bell Tower"). (TWN-R-1.9.3)
8. **The thumb navigates; the camera follows.** On a phone, the town is one screen of large tiles and each borough
   is a native scroller whose buildings are images that the compositor scrolls with their DOM links. There is no
   camera for the user to steer on a phone. (TWN-R-1.4.*)

| ID | Requirement | Test |
|---|---|---|
| TWN-R-1.2.1 | No world effect is spawned except by an entry in the event map (`05` section 5.2) or by a query result the viewer may see. Decorative motion (sky, water, foliage, sun) is drawn from a separate pool flagged `decor` and never uses the flow, parcel, letter or construction pools. | Honesty test: run the city for 60 s of virtual time with the rt socket closed and `gen:live` off; assert every effect pool except `decor` is empty and that `decor` is empty when Motion is Reduced or Off or the tier is Base or Low-power. |

## 1.3 Altitudes

```
 ALTITUDE   ROUTE                    COMPACT (the design)                          EXPANDED (the expansion)
 ────────── ──────────────────────── ───────────────────────────────────────────── ──────────────────────────────────────
 Town       /town/city               the LANDING: the whole town as one portrait   the plinth vista: perspective, fov 28°,
                                     miniature on one screen; the Town Square and  tilt 55°, 8 headings; orbit and zoom
                                     seven borough tiles with live signals
 Borough    /town/city/b/:borough    that borough's HIGH STREET: 1 to 6 district   the vista framed on the borough
                                     bands, axonometric, scrolled natively
 District   /town/city/:district     the borough's street scrolled to the          the vista framed on the district
                                     district's band, its plaque menu open
 Lobby      /town/<route>            the page's panes as cards in the page's       the page's 12-column grid
                                     compact order (02 section 2.1)
 Room       /town/<route>            one pane full height with its dock            the pane maximised in place
            ?focus=<instance>
```

The lobby and the grid are one altitude (**interior**); the room and the maximised pane are one altitude (**pane
focus**); the landing and the vista are one altitude (**town**). Routes and `altitudeStore` values are the same at
every width. `/town/city/b/:borough` is a town-only route; `toClassic` maps every `/town/city*` route to `/`
(`06` section 6.7).

- **Up one level** (room → lobby → district or borough street → landing): the **Back** button in the room dock, the
  **‹ Town** button in the street's dock, the platform back gesture or Escape. Back follows history; the top bar's up
  button follows altitude.
- **Down one level:** tap a tile, a building or a lobby card's header, or press Enter on a focused link. A tap enters;
  there is no select-then-enter on a phone.
- The camera never rolls and the horizon stays level. The landing and the street bake never change heading, tilt or
  field of view; the vista's field of view changes only inside the Full-motion Enter transition (`03` 3.9.1).

| ID | Requirement | Test |
|---|---|---|
| TWN-R-1.3.1 | Each altitude has a distinct route: `/town/city`, `/town/city/b/:borough`, `/town/city/:district`, the mirrored Classic route for interiors and `?focus=` for pane focus. Reloading any of them restores the same altitude and, at compact width, the same band in view. | Route sweep at 390 × 844 and 1440 × 900: load each altitude URL cold; assert `altitudeStore`, the `h1` and, in a street, the band intersecting the viewport centre. |
| TWN-R-1.3.2 | Camera angular velocity is capped at 90°/s, roll is always 0, and the horizon stays level at every altitude and in every transition; the landing's and the street bake's heading, tilt and projection are constant. | Unit test on the camera rig: sample 1,000 random transitions and 1,000 random scroll positions; assert the caps, roll = 0 and the constants on every frame. |

## 1.4 The town on a phone: the landing and the borough high streets

### 1.4.1 Why a landing and per-borough streets

A portrait phone is tall, narrow and scrolled with one thumb. Three designs were tried against it:

| Design | For | Against | Verdict |
|---|---|---|---|
| The desktop plinth, framed per borough (the original phone section) | one model for every width | tens-of-pixel buildings; projected links that move; pan, pinch and twist as the main navigation | torn out in the first restructure |
| **One high street of about 21 district bands** (the first mobile-first version) | native vertical scroll; every facade faces the viewer; links are DOM rows | a thumb sees about 3 of 21 bands, so the town is never one object; its "Overview" could not fit (21 × 44 px = 924 px against about 607 px of usable height); every flow between districts is a vertical streak; an agent rebuild runs mostly off screen | replaced (mobile review, finding 4 and the city verdict) |
| **A portrait landing of the whole town, opening per-borough high streets** | the whole town is one object on one screen, with every borough a large target carrying its live signals; ripples between boroughs read as streaks between tiles; a borough's street is 1 to 6 bands (at most about two screens), so bands and buildings are comfortable; the street keeps native scroll and DOM links; the vista is the same landing scene with a perspective camera | two levels instead of one; tiles show a borough's landmarks, not every building | **chosen** |

### 1.4.2 The landing (compact)

The town altitude at compact width is the **landing**: the whole town as one portrait miniature on a plinth, one
screen, no scrolling.

```
 390 × 844, landing (agent active)                       geometry (CSS px)
 ┌──────────────────────────────────────────┐   0
 │ Northwind                       ◉ 12,480 ◐│        top bar 56 + inset 47 = 103
 ├──────────────────────────────────────────┤ 103
 │ ┌─────────────────┐ ┌─────────────────┐  │        row 1: 112   tiles 175 × 112
 │ │ ◎ Insight       │ │ ⚑ Admin         │  │
 │ │ [Observatory]   │ │ [Town Hall] ✉1  │  │        each tile: the borough's landmark vignette,
 │ └─────────────────┘ └─────────────────┘  │        name, live signals as glyph + count (DOM text)
 │ ┌─────────────────┐ ┌─────────────────┐  │        row 2: 112
 │ │ ✎ Engage        │ │ $ Rewards       │  │
 │ │ 6 districts  ⚙2 │ │ Bank · 12,480   │  │
 │ └─────────────────┘ └─────────────────┘  │
 │ ┌──────────────────────────────────────┐ │        row 3: 96  the Town Square (Home), full width
 │ │      ▣ Town Square · Home    ⛲       │ │
 │ └──────────────────────────────────────┘ │
 │ ┌─────────────────┐ ┌─────────────────┐  │        row 4: 112  (in the thumb zone)
 │ │ ✉ Personal  3 ♪5│ │ ▦ Operate  ▲2   │  │
 │ └─────────────────┘ └─────────────────┘  │
 │ ┌──────────────────────────────────────┐ │        row 5: 64  New Town, full width
 │ │ ✚ New Town · 2 pages                 │ │
 │ └──────────────────────────────────────┘ │ 623    plinth: 358 × 520 (5 rows + 4 gaps of 6)
 │ Credit +500 · Bank                        │        live caption line 32 (passive text)
 │ ◇ claude-code · building Rewards  Follow │ 699    status layer (agent strip 44)
 │  ⌂ City  ✉ 3   ⛩ 2   ⌕ Search   ♪ 5  ◯ You│        bottom bar 56 + inset 34 = 90
 └──────────────────────────────────────────┘ 844
```

**Arithmetic.** At 390 × 844 the height between the top bar (103) and the bottom bar (90) is 651 px. The status layer
takes 44 when the agent is active and the live caption 32, leaving 575 ≥ 520 for the plinth. On a 360 × 640 phone
(top inset 20, bottom inset 0) the space is 640 − 76 − 56 − 44 − 32 = 432 px, so the plinth scales by 432 / 520 =
0.83: tiles become 158 × 93 and the New Town row 53, all above 44 px. The plinth never scales below 0.75; below that
(text size above 150 %, see `00` section 0.2) the landing becomes a vertical list of the same tiles at full size and
scrolls.

- **Tiles.** Seven tiles (Insight, Admin, Engage, Rewards, Personal, Operate, New Town) and the Town Square. Each tile
  is a DOM link (`/town/city/b/:borough`; the Square links to Home) laid over its painted vignette, so tap targets are
  exact. Personal and Operate sit in row 4, inside the thumb zone; the Square is in the centre.
- **Vignettes.** A tile shows the borough's gate arch and its one to three landmarks (the Base level of detail,
  scaled to the tile), lit windows, and the live signals of section 1.5 as glyphs with counts in DOM text (the Post
  Office flag and "3", the Bell Tower face and "5", the Gatehouse carts and "2").
- **Ripples.** A flow between two districts in different boroughs runs as a streak along the landing's streets from
  one tile to the other; within a tile, a short pulse on the tile's lane. This is where "a quiet suite is a quiet town"
  reads on a phone.
- **The lamp** flies between tiles and hovers over the tile of the borough it works in.
- **Unavailable boroughs** (no readable page for the viewer) are drawn as plain scenery tiles with no link, no name
  and no signals, identically for every principal (TWN-R-1.5.2).
- **The landing is drawn on the main canvas** (it does not scroll, so there is no scroll coupling to solve).

### 1.4.3 The borough high street (compact)

Tapping a tile pushes that borough's **high street**: its districts as stacked **bands**, one district per band, each
a terrace across the board: a lane with up to two rows of lots on the hillside side, the back row stepped up, every
facade facing the viewer. Band counts in the seed: Personal 4, Rewards 3, Engage 6, Operate 1, Insight 2, Admin 4, New
Town 1 or more rows. A band is 160 to 245 CSS px tall, so the longest street (Engage) is about 1,250 px, about two
screens.

```
 390 × 844, borough street: Rewards
 ┌──────────────────────────────────────────┐
 │ ‹  Rewards                      ◉ 12,480 ◐│  top bar (read zone)
 ├──────────────────────────────────────────┤
 │ Points · Bank            12,480           │  band heading and plaque (DOM)
 │ [ ▥ Bank ]   [ ▥ Award Office ]           │  baked band image; facade links over it (DOM)
 │──────────────────────────────────────────│
 │ Store · Emporium          cart 2          │
 │ [ ▥ ▥ ▥ Emporium arcade ]                 │
 │──────────────────────────────────────────│
 │ Badges · Hall of Honours                  │
 │ [ ▥ Hall of Honours ]                     │
 ├──────────────────────────────────────────┤
 │ ‹ Town    ‹ Personal   Rewards ▾  Engage ›│  street dock (48): back to the landing, neighbours, switcher
 │  ⌂ City  ✉ 3   ⛩ 2   ⌕ Search   ♪ 5  ◯ You│  bottom bar
 └──────────────────────────────────────────┘
```

- **Bands scroll with the page, as images.** Each band's static model is rendered once by the engine into a texture,
  copied out as an `ImageBitmap` and shown in a `<canvas>` element **inside the scroller**, one per band (sized to the
  band's CSS box at min(DPR, 2)). The compositor therefore scrolls the buildings in lockstep with the DOM plaques and
  links, at any refresh rate, with no main-thread work during a fling. A band is re-baked only when its static state
  changes (a building added or removed, a window lit or darkened, a look change, a tier change); at most one band is
  re-baked per frame.
- **Live effects in an overlay.** Flows, the lamp, constructions in progress, lantern glows and stamps are drawn on one
  `position: sticky` overlay canvas covering the street's viewport. A building under construction is left out of its
  band's bake and drawn live in the overlay until it completes. The overlay reads the scroll offset each frame and may
  lag the compositor by a frame; **while the street is scrolling, the overlay's effects fade out (100 ms) and resume
  after the scroll settles**, so nothing visibly swims. Effects are therefore seen at rest, which is when they are
  watched.
- **Axonometric:** the bake uses an orthographic camera at a fixed heading (north), elevation 35° and no roll, which is
  part of the model-making look and makes a band's image independent of scroll position.
- **Snap:** `scroll-snap-type: y proximity`, a snap point at the top of each band.
- **The street dock** (48 px, above the bottom bar): **‹ Town** (back to the landing), the previous and next borough
  (by tile order), and a borough switcher sheet. Its buttons are ≥ 48 × 44.
- **Unavailable districts** are omitted from the street (not shown as scenery): the street is shorter for members, and
  omission, like scenery, reveals nothing.
- **Links.** Each building is a DOM link over its facade rect in the band image, at least 44 × 44 (a full lot is about
  78 CSS px wide at 390 px); a tap after the scroll settles lands on it. A tap during a fling stops the fling, as the
  platform does, and does not navigate.

### 1.4.4 Medium

The landing and a borough street side by side need 72 (rail) + 16 + 358 + 16 + 358 + 16 = 836 px. From 52.5 rem
(840 px at 100 % text) the medium city shows the landing on the left and the chosen borough's street on the right; the
street opens on the right without a history push. From 50 rem (the start of medium, `00` section 0.3) to 52.5 rem the
city behaves as compact (landing, then street) inside the medium shell.

### 1.4.5 Landscape phones (short)

A landscape phone (height below 30 rem) uses the **short** layout of `00` section 0.3: a 40 px title row and the
navigation rail on the thumb side. At 844 × 390 with 47 px side insets and a 21 px bottom inset, the content area is
844 − 94 − 64 (rail) = 686 px wide by 390 − 21 − 40 = 329 px tall. The landing re-flows into three parts: on the
left a 2 × 2 block (Insight, Admin / Engage, Rewards), tiles 161 × 161; the Town Square in a centre column 120 × 329;
on the right Personal, Operate and New Town stacked, tiles 161 × 105. Total width 2 × 161 + 6 + 6 + 120 + 6 + 161 =
621 px ≤ 686. A borough street in landscape shows one band per screen width, with the band image scaled so its
height is at most 329 px.

### 1.4.6 Expanded and wide: the plinth vista

At expanded width the town is the **plinth vista**: the same landing scene seen with a perspective camera at fov
28°, tilt 55°, in 8 compass headings, with orbit and zoom (to a borough or district framing at fov 32°, tilt 48°). In
the vista each borough is its full **block** (all its bands), and the blocks stand around the Town Square **rotated to
face it** (Personal south, Rewards east, Engage west, Insight north, Operate south-east, Admin south-west, New Town
north-east). Rotation is by multiples of 90° about the vertical axis; within a block lots, facades and streets are
identical to its high street. Because the vista's headings show blocks from every side, every kit module and landmark
has **back and side elevations** (`01` section 1.7), which the high street never shows; G-ART reviews them.

- **Links:** Plat links over each building's projected rect, padded and de-overlapped, rebuilt on the settle frame
  (`04` section 4.11).
- **Gestures:** drag to pan, pinch to zoom, twist to orbit, each with the camera buttons (`00` section 0.5).
- **Wide:** the vista and the current interior side by side; the vista is the live backdrop of the interior column.

A **layout change** (resize across 64 rem, or rotating a tablet) moves blocks rigidly to their new places: under Full
motion they slide over 400 ms; under Reduced and Off it is a cut.

### 1.4.7 The city Plat at compact width

```html
<!-- landing -->
<main id="main" aria-labelledby="page-title">
  <h1 id="page-title">Town</h1>
  <ul class="landing" aria-label="Boroughs">
    <li><a href="/town/city/b/insight" aria-describedby="t-insight">Insight</a>
        <p id="t-insight">2 districts. Reports, Audit. Verify passed.</p></li> …
    <li><a href="/town/">Town Square, Home</a></li> …
  </ul>
</main>
<!-- borough street -->
<main id="main" aria-labelledby="page-title">
  <h1 id="page-title">Rewards</h1>
  <section class="band" aria-labelledby="d-points" aria-describedby="d-points-sum">
    <h2 id="d-points">Points · Bank</h2> <p id="d-points-sum">Your balance 12,480. Last: credit of 500.</p>
    <canvas class="band-image" aria-hidden="true"></canvas>
    <ul><li><a href="/town/points" class="lot" style="--lot-x:…;--lot-y:…">Points, Bank</a></li> …</ul>
    <button aria-haspopup="dialog">More about Points</button>
  </section> …
</main>
```

The plaque text is the link's own text, visible DOM text (on phones all text is DOM text, `03` section 3.5.7).

| ID | Requirement | Test |
|---|---|---|
| TWN-R-1.4.1 | **Retired.** It required one vertical street of every block at compact width; replaced by the landing and per-borough streets (TWN-R-1.4.8 to 1.4.12). | — |
| TWN-R-1.4.2 | In a borough street at compact width, every building link is a DOM element inside the scroller whose rect equals its facade's rect in the band image within 1 CSS px at rest, is at least 44 × 44 CSS px, and no two links overlap. | Geometry test over every band of every borough at 360, 390 and 430 px. |
| TWN-R-1.4.3 | After a fling settles, a tap on a building activates the building whose link is under the finger; a tap during a fling stops the scroll and activates nothing. | Touch test in the phone profile with CDP touch events: fling, tap after `scrollend`, assert navigation; fling, tap before `scrollend`, assert no navigation and that scrolling stopped. On the G0 phones by the same script (C12). |
| TWN-R-1.4.4 | **Retired.** The borough index is replaced by the landing and the street dock. | — |
| TWN-R-1.4.5 | **Retired.** Overview could not fit (21 bands × 44 px against about 607 px); the landing replaces it (TWN-R-1.4.8). | — |
| TWN-R-1.4.6 | Blocks are rigid up to rotation: every lot's position relative to its block origin, and every facade and window rect relative to its lot, is identical in the street, the medium and the vista layouts after undoing the block's rotation (a multiple of 90°). | Unit test over `plan/layout.ts` for all layouts. |
| TWN-R-1.4.7 | A borough street keeps at most its bands in view plus one above and below as baked images, re-bakes at most one band per frame, and draws its overlay with at most 20,000 triangles and 20 draw calls. | Scene statistics and bake counters in the street render test at five scroll positions with `gen:live` running. |
| TWN-R-1.4.8 | At 390 × 844 the landing shows the Town Square and every tile in one viewport without scrolling, each tile a DOM link at least 44 × 44 CSS px with its live signals as text; at 360 × 640 it scales by at most 0.75 and still fits; above 150 % text it becomes a scrolling list of the same tiles. | Landing layout test at 360 × 640, 390 × 844, 430 × 932 and at 200 % text. |
| TWN-R-1.4.9 | During a street fling the band images move with the compositor (no band image is drawn by the main canvas), and the overlay shows no effect between the first scroll event and 100 ms after `scrollend`. | Instrumented street test: assert band canvases are inside the scroller and untouched during the fling; overlay effect count is 0 while `data-scrolling` is set. |
| TWN-R-1.4.10 | A cross-borough flow is drawn on the landing as a streak from the source tile to the destination tile along the landing's street paths. | rt replay of `order.placed` for `ana-silva` with the viewer on the landing; assert the effect's path endpoints. |
| TWN-R-1.4.11 | The street dock offers ‹ Town, the previous and next borough and the borough switcher, each ≥ 48 × 44, and reaches every available borough by taps. | City interaction test. |
| TWN-R-1.4.12 | In landscape at 844 × 390 and 667 × 375 the landing fits its content area without scrolling with every tile ≥ 44 px, and a street band's image is at most the content height. | Short-layout test at both sizes. |

## 1.5 Districts: one per domain (all 19)

Plaque text is "plain name · landmark". "Living signals" are only real data (principle 2). At compact width a
district's signals are drawn on its band; at expanded, on the vista.

| # | Domain | Plaque | Borough | Architecture (procedural kit, section 1.7) | Living signals |
|---|---|---|---|---|---|
| 1 | points | Points · Bank; Points award · Award Office; Ledger · Counting House | Rewards (Ledger in Operate) | neoclassical hall, brass dome, three vault doors (member, system, expiry) | flows to and from houses (`points.posted`); vault door glows while the trial balance verifies (finance only) |
| 2 | store | Store · Emporium; Store manage · Depot yard; Inventory · Stockroom | Rewards (manage and inventory in Operate) | glass-roofed arcade, one awning per category | parcel leaves on `order.placed`; awning lamp on `stock.changed`; Stockroom shelf fill = real `on_hand` of the top 12 products |
| 3 | promotions | Promotions · Fairground | Engage | tension-fabric pavilions, one per promotion, in a row by start date | pavilion state (draft scaffold, pending scroll, scheduled furled flag, active raised flag, paused half mast, ended folded); pennant fill = budget used |
| 4 | badges | Badges · Hall of Honours | Rewards | colonnade of 15 plinths | medallion rises on `badge.awarded`; solid if anyone holds the badge, wire if not; rim rings = rarity |
| 5 | messaging | Messages · Post Office | Personal | brick hall with pillar box | mailbox flag = `messages_unread`; a letter flies to the viewer's house on `message.received` (viewer's own mail only) |
| 6 | notifications | Notifications · Bell Tower | Personal | slim campanile with clock face | clock face numeral = `notifications_unread`; bell swings once per `notification.created` for the viewer |
| 7 | tasks | Tasks · Guild Hall | Personal | timber-framed hall with pin-board facade | up to 12 card glyphs for the viewer's open tasks; blocked tasks carry a red pin and "!" |
| 8 | approvals | Approvals · Gatehouse | Personal | twin towers, one portcullis per approval type | queued carts = pending approvals the viewer can decide (12, then a numeral); gate lifts on approve |
| 9 | content | Content · Gazette Press | Engage | print works with rotary press | press turns on `content.published`; proof sheets = `content_reviews` |
| 10 | people | People · Residential quarter | Engage | 40 terraced houses on five regional lanes | a house lantern glows on its member's events within the viewer's audience |
| 11 | segments | Segments · Census Office | Engage | rotunda with a map table | matching houses light while a segment is previewed |
| 12 | automation | Automation · The Works | Engage | machine hall, one machine per automation | circuits: a pulse runs through the machine's stations per run (`05` section 5.10) |
| 13 | calendar | Calendar · Clock Tower | Engage | tower with a perpetual-calendar face | face shows `clockStore.virtual_now`; "Paused" plate when the virtual clock is paused |
| 14 | reporting | Reports · Observatory | Insight | domed instrument hall | dome rim ring shows the four suite KPIs; a beam sweeps on a source watermark advance |
| 15 | audit | Audit · Record Office | Insight | stone archive with a hash-chain frieze | a frieze link per change (last 64; last 16 at Base); verify sweep runs along it |
| 16 | admin | Admin · Town Hall | Admin | civic hall with a balcony | held role, grant and programme changes park sealed scrolls on the balcony |
| 17 | pages | Pages · Planning Office | Admin | drafting studio | plan table shows the lot plan; a page under edit shows scaffolding on its building |
| 18 | search | Search · Signal Mast | Admin | tall mast; at compact its beam lies along the street | beam points at the place of the focused search result |
| 19 | settings | Settings · Lamp Studio | Admin | small workshop with lamp racks | lamp rack shows the active look; a look change starts the look sweep here |

Two places are not domains: **Town Square** (the `home` page) and **New Town** (custom pages and overflow).

| ID | Requirement | Test |
|---|---|---|
| TWN-R-1.5.1 | Every one of the 19 domains has exactly one district with a landmark, a plaque in the "plain name · landmark" form and at least one living signal from the table above. | Unit test over `town-world/src/districts/*`: 19 entries, each with a landmark id, plaque text matching `/^[A-Z][a-z ]+ · /` and a non-empty signal list whose every trigger is an event type in `DOMAIN_EVENT_PAYLOADS` or a named query. |
| TWN-R-1.5.2 | A district the viewer has no readable page in renders as **unlit scenery**: the same massing in plain card for every role, with no plaque, no link, no counts and no living signal, in the vista and on the landing (a borough with no available district is a scenery tile); in a compact borough street an unavailable district's band is omitted. | Render the city as `ana-silva` and as `admin` at 390 and 1440 px; for each district with `available: false`, assert the scenery tone in the vista and on scenery tiles, no Plat link or heading, byte-identical scenery instance buffers across the two principals, and no band in the compact street. |

## 1.6 Pages become buildings: placement rules

The city is derived from `pages.list`, filtered by the viewer's permissions. It is never authored per deployment.

1. **Primary domain.** The domain of the widget with the largest grid area in the page's layout; ties go to the
   smallest `(y, x)`. `home` is Town Square. A page with no widgets takes the first district of its nav section, or
   New Town when it has no nav entry.
2. **Buildings and floors.**
   - A page with a nav entry is a **building** in its primary domain's district.
   - A page without a nav entry whose route extends a nav page's route (`/store/p/:product` under `/store`) is a
     **floor** of that building.
   - Anything else (a custom `/p/:page`) is a building in New Town.
3. **Lot assignment is stable.** Each district band has 2 to 8 surveyed lots (`town-world/src/plan/lots.ts`, up to 4
   per row, two rows) plus one **annex strip** of 4 half-frontage lots on its lane's far side. Buildings take lots in
   ascending order of the Page node's creation `seq`. An existing building therefore never moves when another page is
   added. `site.clear` followed by `site.restore` recreates pages in `default-pages.ts` order, so the seed's lots come
   back where they were.
4. **Overflow.**
   1. When a district's lots and annex strip are full, the next building goes to **New Town**, carrying a roof band in
      its home district's tone and that district's emblem on its plaque. The home district's plaque adds "+N in New
      Town" as text and its plaque menu links to them.
   2. New Town grows in **rows** of 4 lots downward from its square (in the vista: in rings around its square, ring 1
      of 8 lots, ring 2 of 12, ring 3 of 16, ring 4 of 20; the order of lots is the same creation-`seq` order in both
      layouts, so lot ids are the same).
   3. Past 56 New Town lots, pages become floors of a **terrace block**: one building per 12 overflow pages, each page
      a floor reachable through the building's floor strip. There is no upper limit; a block's storey count is capped
      at 12 and a new block starts beside it.
   4. Overflow placement uses the same creation-`seq` order, so it is stable.
5. **Facade = page layout.** Storeys = `ceil(max(y + h) / 6)` over the layout. Each widget instance is a window at its
   grid cell: columns `x..x+w` map across the facade and rows `y..y+h` down the storeys. The facade is a legible
   miniature of the page, which is what makes the Enter transition exact at every width (at compact the windows
   unfold into the lobby's stacked cards in the page's compact order).
6. **Cross-domain widgets** carry their domain's emblem on the window sill (`points.balance` on Home shows the Bank's
   coin glyph).
7. **The People district at compact width.** Its 40 houses stand in five lane rows of 8. A house is about 40 CSS px
   wide at 390 px, below the touch target, so at compact width each **lane** is one link ("NA lane · 9 members") that
   opens the lane sheet listing its members as links to `/town/people/:handle`; individual house links exist at
   medium and wider, where houses are at least 44 px.

Route to building (the seed's default pages, UI-MAP section 2; interiors are served under `/town` with the same
paths, section 6.7):

| Building (district) | Floors = routes |
|---|---|
| Town Square pavilion | `/` |
| Post Office (messaging) | `/messages`, `/messages/t/:thread`, `/messages/new` |
| Bell Tower (notifications) | `/notifications` |
| Guild Hall (tasks) | `/tasks`, `/tasks/all` |
| Gatehouse (approvals) | `/approvals` |
| Bank (points) | `/points` |
| Award Office (points) | `/points/award` |
| Counting House (points, Operate) | `/ledger` |
| Emporium (store) | `/store`, `/store/c/:category`, `/store/p/:product`, `/store/cart`, `/store/orders`, `/store/orders/:order`, `/store/wishlist` |
| Depot yard (store, Operate) | `/store/manage` |
| Stockroom (store, Operate) | `/store/inventory` |
| Hall of Honours (badges) | `/badges` |
| Directory House (people) | `/people`, `/people/:handle`, `/profile`, `/groups/:group`; each member's house (or lane sheet entry) also opens `/people/:handle` |
| Signal Mast (search) | `/search` |
| Gazette Press (content) | `/news`, `/read/:content`, `/content`, `/content/new`, `/content/:content` |
| Fairground Office (promotions) | `/promotions`, `/promotions/new`, `/promotions/:promotion`; each pavilion opens its promotion |
| The Works (automation) | `/automations`, `/automations/new`, `/automations/:automation`; each machine opens its automation |
| Census Office (segments) | `/segments`, `/segments/new`, `/segments/:segment` |
| Clock Tower (calendar) | `/calendar` |
| Observatory (reporting) | `/reports`, `/reports/:dashboard` (including `/reports/store-performance`, `/reports/engagement`), `/d/:dashboard` |
| Record Office (audit) | `/audit` |
| Town Hall (admin) | `/admin`, `/admin/roles`, `/admin/grants`, `/admin/program` |
| Lamp Studio (settings) | `/settings` |
| Planning Office (pages) | `/pages/:page/edit` |
| New Town | `/p/:page` and overflow |

| ID | Requirement | Test |
|---|---|---|
| TWN-R-1.6.1 | The derive step (`town-world/src/plan/derive.ts`) is a pure function from `pages.list` plus the viewer's availability to buildings, floors, lots and windows, implementing rules 1 to 7, and is independent of the layout. | Unit tests: the seed yields the route table above for `maya-ortiz`; property test with 500 random page sets checks each rule; the output is identical whatever layout is requested. |
| TWN-R-1.6.2 | Adding a page never moves an existing building. Deleting one frees its lot without moving others. | Property test: random sequences of add and delete; assert each surviving page's lot id is unchanged across every step. |
| TWN-R-1.6.3 | `site.clear` then `site.restore` (in one call or in stages) puts every default page back on the lot it had in the seed. | Rebuild scenario test (`06` section 6.9): record lot ids, clear, restore in two stages, compare. |
| TWN-R-1.6.4 | Overflow follows rule 4 with no upper limit on pages: 300 custom pages place without error, every page is reachable, and no lot holds two buildings, in every layout. | Unit test with 300 generated pages in one district; assert placement, reachability through the city Plat at 390 and 1440 px, and uniqueness. |
| TWN-R-1.6.5 | Each window's facade rect is derived from its widget's grid cell; the facade's storey count is `ceil(max(y + h) / 6)`. | Unit test on derive output for every seeded page. |
| TWN-R-1.6.6 | At compact width each People lane is one link opening a lane sheet whose entries link every member of the lane the viewer may see; at medium and wider every house is its own link of at least 44 × 44 CSS px under a coarse pointer. | City interaction test at 390 and 800 px with touch. |

## 1.7 The building kit: procedural, not hand-modelled

**The kit is procedural code**, not an authored glTF set.

- `town-assets/src/kit/` generates every module from parameters at build time and caches the result as typed arrays:
  wall bay, corner, plinth course, cornice, pitched roof, flat roof, dome, drum, colonnade column, awning, tension
  pavilion, tower shaft, spire, mast, gear, vault door, portcullis, crane, scaffold pole, borough gate arch, terrace
  retaining wall and the turned-wood figure.
- A landmark is a recipe: a list of module instances with parameters (`bank.ts`: drum radius 6, dome segments 24,
  three vault doors). Landmarks are code, reviewable in a diff and regenerated by a build. **Recipes are sized for a
  14-unit lot first**: a landmark must read at 78 CSS px wide on the phone, and the vista shows the same recipe.
- Every module and landmark has **front, back and side elevations**: the high street shows only fronts, but the vista
  rotates blocks to face the Town Square and orbits in 8 headings, so backs and sides are seen there (G-ART reviews
  them, section 1.12).
- Each module has a **Base level of detail** (the phone's) and may add a **detail level** used at Enhanced and Full
  (extra cornice courses, column fluting, window mullions). The detail level adds geometry only; silhouette and
  massing are the Base level's.
- Surface variation comes from per-vertex baked ambient occlusion computed by the generator and one tileable
  fibre/grain texture per material class, not from per-building textures. The generator also bakes a contact-shadow
  decal per module footprint, which is the Base tier's only shadow.
- An authored glTF landmark is allowed only if the art-direction gate (section 1.12) rules a procedural landmark
  insufficient. It then enters with a pinned packer version and the asset budget (`03` section 3.13).

| ID | Requirement | Test |
|---|---|---|
| TWN-R-1.7.1 | The building kit and all 19 landmarks are produced by `pnpm --filter @plinth/town-assets build:kit` from source with no binary inputs other than fibre textures. The output is deterministic. | Build twice on clean checkouts; assert byte-identical output and a manifest listing every module and its levels of detail. |
| TWN-R-1.7.2 | The whole static city at its busiest (seed pages, all houses, all landmarks) at the detail level is at most 140,000 triangles and 90 draw calls in the vista; the Base level of the whole city is at most 70,000 triangles. | Scene statistics assertion in the vista and compact render tests, from `renderer.info` (verify field names in 0.187 source). |
| TWN-R-1.7.3 | Every landmark's Base level has the same silhouette as its detail level at 128 px tall (no more than 1 % of silhouette pixels differ). | Silhouette render of both levels at the art gate; pixel comparison. |

## 1.8 Homes, streets and figures

- **Houses.** 40 houses on five regional lanes (NA, EMEA, APAC, LATAM, ANZ) ordered by `joined_at`. The roof tint is
  the member's `avatar_hue` at low chroma (OKLCH L 0.72, C 0.06 in calm). Storeys show the tier: bronze 1, silver 2,
  gold 3, platinum 3 plus a belvedere. Its plaque shows the name only, never a balance; at compact width a house has
  no plaque and its lane does (rule 7).
- **Streets.** A graph per layout (street, medium, vista; the landing's tile graph is separate) of about 220 nodes and 300 edges; every door is a node. Within a block the graph is
  identical in every layout; only the connector edges between blocks differ. Paths for every layout are precomputed
  with A* when the plan is built and stored arc-length resampled (`03` section 3.9.3), so a flow never path-finds at
  runtime. The landing has its own small graph of tile-to-tile paths along its streets, which is what makes a flow
  between boroughs read as one streak on the landing.
- **Figures.** The viewer is the only persistent figure, at the door of the building they are in: "you are here".
  Other people appear only as event effects: a pin with their hue and name rises at their house for 3 s.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-1.8.1 | A house or lane plaque never shows a balance, tier number or any field outside the member's public profile; balances appear only to the member themself on their own house and in the balance chip. | Render the city as `jonas-becker` at 390 and 1440 px; read the city Plat and the plaque instance texts; assert no number matching another member's balance appears. |
| TWN-R-1.8.2 | Every door-to-door path used by a flow is precomputed at plan build for every layout; no path-finding call happens after the city is built, including after a layout change. | Instrument the street module in the rt replay test with a resize across 64 rem mid-run; assert zero A* calls after `cityBuilt`. |

## 1.9 Wayfinding

| Aid | compact (the design) | Expansion |
|---|---|---|
| Directory | the command sheet with an empty query: sections and pages from `navStore`, with counts and `aria-current` | medium: a rail item opening it as a side panel; expanded: the Directory column |
| District switcher | the City tab, tapped while in the city, and the street dock's switcher: boroughs and districts with counts; choosing opens the borough's street at the band | the vista: choosing frames the district |
| Landing | the whole town on one screen, a tile per borough (section 1.4.2) | the vista's whole-plinth view |
| Breadcrumb | the top bar's second line: `Rewards › Points · Bank › Statement` | full HUD breadcrumb |
| Command | the bottom bar's **Search**: commands, pages, widget titles, `search.global`; the focused result swings the Signal Mast's beam on the landing | `Ctrl+K` palette dialog |
| Plaques | on bands: plain name first, then landmark, then live counts | on the vista, with hover previews |
| "You are here" | the viewer's figure at the current building's door; the band is scrolled into view when returning to the city | the mini-map dot in the Directory foot |
| "Also elsewhere" | each district's plaque menu sheet lists the domain's widgets living in another building, as links ("Notification preferences, in Settings · Lamp Studio") | same, as a popover |
| Search index of widgets | command sheet and `search.results` | same |
| Agent | on the landing the lamp is always in view; in a street or interior the agent strip in the bottom status layer says where it works ("building Store · Show") (`05` section 5.5) | the edge chevron at the lamp's bearing |
| Classic toggle | the You sheet | HUD |

| ID | Requirement | Test |
|---|---|---|
| TWN-R-1.9.1 | Every page the viewer can read is reachable in at most two activations from any altitude, **including a room, a pushed detail and the landing**, through the bottom bar's Search (Search, then the page in the Directory) at compact width and through the Directory column at expanded width, and in one activation after typing its title. While a modal sheet is open the bottom bar is under its scrim by design (a sheet is one pending choice); forms are never modal sheets (`02` section 2.4). | Touch walk at 390 × 844 and keyboard walk at 1440 × 900: for each persona and page, reach it from `/town/city`, from a lobby, from the Statement room and from a pushed transaction view; count activations. |
| TWN-R-1.9.2 | For every widget placed on a page outside its own domain's district, that domain's district plaque menu lists it under "Also elsewhere" with a working link. | Unit test over the derive output for the seed: the set of cross-district widgets equals the union of "Also elsewhere" entries. |
| TWN-R-1.9.3 | Every plaque, Directory entry, breadcrumb segment and route announcement starts with the plain domain or page name; landmark names never appear alone. | Lint over `town-world` plaque builders and the Plat outline snapshot of every route at both widths. |
| TWN-R-1.9.4 | The command sheet and the palette index every widget title in the catalogue and return the page or pages that contain it for the viewer. | Interaction test: type each of the 77 titles; assert at least one result when the widget is placed on a readable page. |

## 1.10 Availability, roles and privacy in the city

- The city shows only what the viewer's pages and audience-filtered events contain. Unlit scenery (TWN-R-1.5.2) hides
  existence and content alike.
- Flows touching another member's house appear only when the event reached the viewer through its audience. A
  parcel's detail (on tap or hover) shows "Order N-1042 · Shipped · to Ana Silva" only when the viewer may see that
  member, otherwise "Order · Shipped".
- Switching identity (`?as=`) rebuilds the derived city from that principal's `pages.list`.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-1.10.1 | No world effect, plaque or detail text contains data from an event that the server did not deliver to the viewer's socket. | rt replay with two principals on two sockets; assert each world's effect log contains only causes from its own delivered frames. |

## 1.11 Art-direction rules

These rules are what the gate (section 1.12) reviews against, written as checks where a check is possible. They are
judged on the phone first.

1. **Materials.** Exactly five material classes in the city: basswood, mount card, stone, brushed brass, frosted
   acrylic, plus the roof tint. Each look sets their colours (`03` section 3.16); no other material is introduced.
2. **Palette.** City surfaces stay at OKLCH chroma ≤ 0.08, except the look's accent, the agent tone and event tones,
   which may reach 0.16. Plaques are opaque plates.
3. **Form.** Massing reads from silhouette alone at the phone's scale: every landmark has a unique silhouette at
   78 CSS px wide and at 128 px tall (checked at the gate by a silhouette-only render).
4. **Light means signal.** Emissive output (or, on Base, the lit colour) is non-zero only for windows (a widget
   exists), the agent lamp, flows, arrival glows, the verify sweep and street lamps in night looks. Street lamps never
   pulse.
5. **No toy cues.** No squash and stretch, no overshoot springs, no idle bobbing of figures, no confetti. Springs are
   critically damped.
6. **Figures.** Turned-wood figures 1.6 units tall with a sphere head and no face.
7. **Text.** No text is placed on a 3D surface except engraved decoration (the programme name on the Square block's
   kerb), which always repeats text already present in the Plat.
8. **Camera.** The landing's and the street bake's fixed heading, 35° elevation and orthographic projection at
   compact and medium; in the vista, fixed tilt bands per altitude, eight orbit headings, no roll, level horizon.
9. **Look discipline.** Every look must pass the contrast checks of `04` section 4.9 on rendered pixels, not only on
   tokens, at the phone's DPR first.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-1.11.1 | The city uses only the five material classes plus roof tint; each kit module declares its class. | Unit test over the kit manifest. |
| TWN-R-1.11.2 | City surface colours stay within the chroma limits of rule 2 in every look and theme. | Look checker (`town-looks check`) over scene presets. |
| TWN-R-1.11.3 | All springs in `town-engine/src/camera` and `town-world/src/effects` are critically damped (damping ratio 1) and no animation curve overshoots its end value. | Unit test sampling every spring and easing used. |
| TWN-R-1.11.4 | With the rt socket closed and Motion Off, the emissive render target (Enhanced and Full) or the lit-colour mask (Base) is zero except for lit windows and, in night looks, street lamps. | Render test at Base and at Full: read the target or mask back in the harness; mask windows and lamps; assert the remainder is zero. |

## 1.12 The art-direction gate (G-ART)

**Position in the plan.** After the spike (G0) and the interior painter, before any district beyond the Bank is built
(`07-plan-and-gates.md`).

**What is produced for review**, all from the real engine, **phone captures first**:

1. The **Square block** and the **Rewards block's Points band** (Bank and Award Office) plus one People lane
   (8 houses), procedurally generated at the Base level and the detail level.
2. Each of the 6 looks in light and dark (12 variants): first at **390 × 844, DPR 3, Base tier**: the landing (with
   the Square, Rewards and Personal tiles built and the others as placeholders) and the Rewards street at two scroll
   positions (the Points band, the lane); then at 1440 × 900 in the vista at four poses (overview, district framing, a
   3/4 close view of the Bank facade, and the Bank's **back and side elevations** from the opposite headings) at Full.
3. One **Enter** from the Bank facade into `/town/points`: at 390 × 844 (compact Enter into the lobby) and at
   1440 × 900 (vista dolly into the grid), each recorded at 60 fps in each look at Full motion, plus the Reduced and
   Off variants in calm.
4. A **silhouette sheet**: every landmark that exists at that point, flat black at 78 CSS px wide and at 128 px tall,
   at both levels of detail.
5. A real-phone capture of item 2's phone frames in calm, light and dark, from one of the G0 phones.
6. The measured statistics: triangles, draw calls, generator output size, frame time on the reference machine and in
   phone emulation.

**Who decides.** The owner. Each look is marked pass, revise or drop on the Workgraph gate task with the capture
attached.

**Pass criteria.**

- The owner rules every look either pass or drop, **judged on the phone captures**; the vista captures can only
  demote a look, never rescue a look that fails on the phone. A dropped look is removed from `SITE_LOOKS` in the town
  app only (Classic keeps it) after an owner decision, or redesigned.
- `calm` and `meridian` must pass. If `calm` fails twice, the default look becomes `meridian` (white-card model, no
  bloom), which is kill criterion K7's fallback (`07` section 7.5).
- The rules of section 1.11 hold in every capture (automated where the rule has a test).
- Rendered-pixel plaque contrast passes (TWN-R-4.9.3).

| ID | Requirement | Test |
|---|---|---|
| TWN-R-1.12.1 | No district other than points and Town Square is built until G-ART is recorded as passed on its Workgraph task. | Plan dependency: the district step's task depends on the G-ART task; checked by Workgraph. |
| TWN-R-1.12.2 | `scripts/town-art-sheet.ts` produces the full review set (items 1 to 4 and 6) from one command, phone frames first, and item 5 has a documented capture procedure. | Run in CI on the reference machine; assert the expected file set and statistics JSON. |

## 1.13 Retired: the phone section

The previous section 1.13, "The city on a phone", described the phone as a framing of the desktop plinth. It is torn
out; the city is designed for the phone in section 1.4.

| ID | Status | Reason and replacement |
|---|---|---|
| TWN-R-1.13.1 | **Retired** | The peek-sheet phone framing of the plinth no longer exists. Reachability of every building at compact width is TWN-R-1.4.2 to TWN-R-1.4.5 and TWN-R-1.6.6. |
| TWN-R-1.13.2 | **Retired** | "The city draws zero frames while an interior is shown on a phone" is generalised to every width and tier by TWN-R-3.11.2. |
