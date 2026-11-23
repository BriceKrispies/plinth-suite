# 05. Realtime, the agent and the demo

Part of the Township canonical spec (`README.md`). Requirement IDs are `TWN-R-5.<section>.<n>`.

Base: `../proposals/township.md` sections R6 and R11. Grafts: Orbit's agent light, follow-the-agent pose and
off-screen indicator (6.5 step 5, 6.6); Atelier's stamp per MCP call and agent log (R6.4); Constellation's timeline
scrubber and automation circuits (1.5, R6.5); Instrument's merged rebuild announcements. The `ui.present` path is
CONTRACT section 6.3 as now implemented, which replaces every proposal's description of it.

**Mobile first.** `00-mobile-first.md` binds this file. The agent's presence, the clear-and-rebuild and `ui.present`
are designed to read on a phone held in one hand: the landing (`01` section 1.4) shows the whole town, so a clear and
rebuild is seen whole on one screen; the agent strip with Follow, Show and the build board sits in the thumb zone; a
presentation request is the status layer's peek plate, answered with your thumb. The desktop vista is the expansion. The five-minute
demo (section 5.12) is written to be presented from a phone first, then on a big screen.

---

## 5.1 One stream, three consumers

```
 /rt WebSocket: s1 changes, s2 domain, counts, present (CONTRACT 6.1, 6.3); resume per stream; backoff 1, 2, 4, 8 s
          │
          ▼
 town-state Dispatcher ─────────────────────────────┬─────────────────────────────┬──────────────────────────
   1. stores updated synchronously (counts, me,     │                             │
      nav, pages, clock, connection, appearance)    ▼                             ▼
   2. widget subscriptions (ctx.rt.on…) re-read     Announcer (04 section 4.5)    Choreographer (5.8)
      through their own actions; Plat updates            │                             │
   3. world model updated (districts, queues,            ▼                             ▼
      parcels, machines, frieze, stamps)            live regions                  world effects queue
   4. present frames → presentStore (5.4)
```

The Dispatcher keeps the DOM-round fixes: `try` only around `JSON.parse`; a `socket !== ws` guard; a `gap` flag with a
full resync on a gap or reconnect and only then; per-event re-fetch of only the node the event names; `through`
advanced only after the handlers ran. Each consumer runs in its own `try`, so a failing effect never stops the Plat
update.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-5.1.1 | A consumer that throws does not prevent the other consumers from handling the same frame, and `through` still advances. | rt replay with a choreography handler forced to throw; assert the Plat and stores updated. |
| TWN-R-5.1.2 | A sequence gap or reconnect triggers exactly one full resync; no other path does. | rt replay with a dropped batch and a reconnect. |

## 5.2 Event to world mapping

`town-world/src/effects/map.ts` is data: one entry per event kind. Every effect is gated by the server's audience
filter, because the browser only ever sees frames addressed to it.

| Event | City and district effect | Interior effect |
|---|---|---|
| `points.posted` (credit to the viewer) | gold flow Bank → viewer's house, `clamp(round(Δ/50), 3, 64)` particles | balance roll, ledger row insert, HUD chip roll, toast for award, badge reward, promotion bonus |
| `points.posted` (debit, purchase) | spend-tone flow house → Emporium | balance roll, ledger row |
| `points.posted` (system accounts, finance) | flow between vaults | trial-balance refresh, accounts flow ribbon head |
| `tier.changed` | house gains or loses a storey, lantern flare | tier pill, toast to the member |
| `order.placed` | parcel leaves the Emporium for the member's lane; staff: to the Depot when `requires_approval` | orders tables insert, KPI tick |
| `order.status_changed` | parcel advances a station; delivered: lands at the house | order rail station fills; toast to the member |
| `stock.changed` | awning lamp; Stockroom shelf | stock indicators; cart line issues |
| `cart.updated` | handcart at the Emporium door fills | cart count |
| `badge.awarded` | medallion rises at the Hall; awardee pin at their house | showcase, catalog, recent; toast with artwork to the awardee |
| `badge.progress` | none | rings advance |
| `promotion.state_changed` | pavilion state | list pill, calendar bars, banners re-fetch |
| `promotion.redeemed` | pennant fill | performance counter roll |
| `promotion.budget_alert` | pavilion bell and "80 %" plate | toast to marketing and finance |
| `automation.run_updated` | circuit pulse through the machine (5.10) | runs table, run view circuit |
| `content.published` | press turns; broadsheet to the square's kiosk | feed prepends; toast if pinned |
| `content.state_changed` | proof sheets on the press table | list pills, editor banner |
| `message.received` | letter Post Office → viewer's house; mailbox flag | inbox row, thread append, toast unless open or muted |
| `notification.created` | bell swing; clock-face count | feed prepend, bell count, toast if `in_app` |
| `task.assigned`, `task.updated` | card pinned or moved on the Guild Hall facade | list and board |
| `approval.requested` | cart arrives at the type's gate (hatched and pushed by the lamp when requested by an agent) | inbox prepend, banner count, toast to approvers; a **tagged stamp** when the requester is an agent (5.6) |
| `approval.decided` | gate lifts and the cart rolls on (approve), turns back (reject), fades (withdraw) | row status, requester toast |
| `member.updated` | lantern flicker | person chips refresh |
| `session.revoked` (this tab) | city goes dark | signed-out notice |
| changes: Page or Widget create, update, delete | construction choreography (5.7) | page host re-layout, pane arrival |
| changes: Program `appearance.look` or `density` | look sweep (`03` section 3.9.9) | tokens swap |
| changes: Program `appearance.experience` | none (the swap of `06` section 6.7) | swap banner or swap |
| changes: any other node | a link on the Record Office frieze | panes showing that URI re-fetch it |
| `present` frame | the lamp flies to the target and a spotlight (5.4) | consent plate, spotlight, Back button |

| ID | Requirement | Test |
|---|---|---|
| TWN-R-5.2.1 | Every row of the table is implemented by an entry in `effects/map.ts`, and no effect is spawned from widget code. | Unit test comparing the map's keys with the table; dependency lint: `town-widgets` cannot import `town-world`. |
| TWN-R-5.2.2 | Data, Plat and announcements for an event are applied before, and independently of, its world effect. | rt replay with the Choreographer paused; assert stores, Plat and announcements updated. |
| TWN-R-5.2.3 | The honesty rule: with no rt frames and no query results arriving, no data-shaped effect exists (TWN-R-1.2.1). | Honesty test. |

## 5.3 Person, agent and system

The actor comes from `actor`, `on_behalf_of` and `surface` on every change and domain event, never from timing.

| Actor | Shape (not colour) | Colour | Text |
|---|---|---|---|
| A person (surface `web`) | turned-wood figure pin at their house; in panes a round avatar disc with initials | their `avatar_hue` | "Maya Ortiz" |
| The agent (actor `agent:*`, surface `mcp`) | the **surveyor lamp**: brass tripod and lens on an acrylic rotor ring, carrying a light; in panes a ◇ diamond badge; agent geometry carries the 45° hatch | the look's agent tone, used for nothing else | "agent claude-code · mcp · #48,212 · for Maya Ortiz" |
| The system (scheduler, worker; surface `system`) | a clockwork key glyph; in the city effects start from The Works | `ink-2` | "system · scheduler" |

Agent attribution persists: the arrival tab and band for 8 s; the hatch on an agent-built building's foundation course
until the next human edit of that page; the frieze link for good; the stamp per 5.6.

The feasibility judge noted that the rebuild depends on every `site.*` commit arriving with `surface: "mcp"` and an
`agent:*` actor, which nobody had checked. `scripts/rebuild-live.ts` drives the rebuild through the MCP server with the
dev agent token, so its commits should carry both.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-5.3.1 | Every change produced by `rebuild-live.ts --clear` arrives on the change stream with `surface: "mcp"`, an `agent:*` actor and `on_behalf_of` set to the delegator. | Integration test on the test stack: run the script; read the change stream; assert every item. |
| TWN-R-5.3.2 | Actor class is never inferred from timing or from the client; only from the frame's `actor`, `on_behalf_of` and `surface`. | Unit test of `tagOf` over a fixture of frames, including an agent frame arriving during a human's typing. |

## 5.4 `ui.present`: the agent shows you something

**What arrives** (CONTRACT 6.3, implemented on the integration line): `ui.present` writes no change. The gateway sends
`{ t: "present", node, target, focus, by, at }` only to sockets in the presenter's workspace whose principal is one of
the session's `owners` (the agent and its delegator) and matches `target`, and only when that principal can read
`node`. `target: "all"` therefore means **every screen of the presenter's own session**, not every viewer. Frames are
not sequenced, stored or replayed after a reconnect. The tool returns `delivered_to: null, queued: true`. The town
app receives frames through `rt.onPresent(cb)`.

This replaces Township's claim of a change-stream item of kind `present`, which does not exist (ruling JF-1). There is
no other delivery path.

**Handling in the town app.**

1. **Resolve** the node to a place: a Page → its building and route; a Widget instance → its page and pane; a node
   with a home → its route (Promotion → `/promotions/:slug` and its pavilion; Member → `/people/:handle` and their
   house; Dashboard → `/d/:slug` and the Observatory; Product → `/store/p/:slug`; Content → `/read/:slug`; Thread →
   `/messages/t/:id`; Order → `/store/orders/:id`; Automation → `/automations/:slug`; Segment → `/segments/:slug`);
   otherwise a temporary **Presented** pane over the current page showing `audit.node-history` for the node. `focus`
   (`parameter`, `value`) sets the bound parameter on arrival.
2. **The lamp flies** to the target's place in the city (decoration, under Full) and the target is ringed in the
   city. This never moves the viewer's camera, scroll position or route.
3. **Ask unless the viewer opted in.** The viewer's route and camera change only if:
   - **Follow agent** is on (a visible HUD toggle, off by default, `aria-pressed`), or
   - the viewer activates **Go** on the presenter plate: "agent claude-code wants to show you: Peak Week performance
     · Not now · Go". At compact width the plate is the status layer's first item (`00` section 0.4.4), a
     non-modal peek above the dock or bottom bar, Go on the thumb side's trailing edge; it does not take focus (it is announced) and stays until answered or replaced; at expanded
     width it is a plate under the HUD.
   There is no idle heuristic: a screen-reader user's silent listening is never treated as consent (access must-add
   12). **Presentation mode** (a viewer setting for demo and wall screens) is Follow agent turned on plus Motion Full;
   it is never on by default.
4. **Never while editing.** With focus in an editable field that has unsaved input, a dialog open, or a composition
   active, the plate is a toast and nothing moves, even with Follow agent on; the request can be accepted from the
   toast.
5. **Arrival.** Navigation (with the Enter or travel transition under Full, a crossfade or cut otherwise), focus on the
   presented pane's heading, a spotlight in the grade pass for 6 s, and the plate "Shown by agent claude-code". The
   URL is updated with `pushState` so the presented view is shareable.
6. **Return.** "Back to where you were" stays for 60 s (a status-layer item at compact width, `00` section 0.4.4; in
   the HUD at expanded) and restores route, city scroll position or camera, and focus.
7. **Announcement** on arrival of the frame: "Agent claude-code wants to show you Peak Week performance. Press Enter on
   Go, or Escape." After acceptance focus lands on the pane heading and the route announcement plays.

**Difference from Classic.** Classic opens a presented Page route directly and outlines a presented widget on the
current page (CONTRACT 6.3). The town app asks first unless Follow agent is on. The swap contract only requires route
parity, so this stricter behaviour is allowed; it follows WCAG 3.2.5 (change of context on request).

| ID | Requirement | Test |
|---|---|---|
| TWN-R-5.4.1 | The town app consumes present frames only through `rt.onPresent` and has no code path reading a `present` change-stream kind. | Static check; rt test injecting a present frame through the test gateway. |
| TWN-R-5.4.2 | Every node kind in the resolver table maps to its route; an unknown kind opens the Presented pane. | Unit test over the resolver with one node per kind. |
| TWN-R-5.4.3 | With Follow agent off, a present frame never changes the route, the camera pose, the city scroll position or focus until the viewer activates Go. | Interaction test at 390 × 844 and 1440 × 900: inject a frame, wait 10 s with no input, assert route, camera, `scrollTop` and `activeElement` unchanged. |
| TWN-R-5.4.4 | With Follow agent on, a present frame navigates, except while an editable field has unsaved input, a dialog is open or a composition is active, in which case it shows a toast and nothing moves. | Interaction tests for each blocking condition. |
| TWN-R-5.4.5 | "Back to where you were" restores the previous route, camera pose or city scroll position, and focused element within 60 s of the present. | Interaction test in both profiles. |
| TWN-R-5.4.7 | At compact width the present plate is a non-modal peek sheet within the bottom 40 % of the viewport whose Go and Not now buttons are ≥ 44 × 44 CSS px, and it does not move focus. | Phone interaction test with an injected present frame. |
| TWN-R-5.4.6 | `focus` on a present frame sets the bound parameter on the target page. | Present a Dashboard with `focus: { parameter: "region", value: "EMEA" }`; assert the filter. |

## 5.5 The agent lamp, the agent strip, Follow and the build board

- **Presence.** The lamp appears when the first `surface: "mcp"` change of a session reaches the viewer: it rises at
  Town Hall (on the landing, over the Admin tile), brightens over 400 ms (Full) and the **agent strip** appears. It
  goes idle 10 s after the agent's last change (dims, drifts to Town Hall) and leaves after 10 minutes idle.
- **The agent strip** (compact, the design) is an item of the status layer (`00` section 0.4.4, priority 3): 44 px,
  "◇ claude-code · building Store · 3 pages, 14 panes" with **Follow** (`aria-pressed`), **Show** (go to where the
  agent works now) and **Build board**. Tapping its text opens the agent sheet: the rebuild summary, the latest stamps
  with their labels, and **Agent log**. At expanded width it is the HUD's agent status.
- **Light.** A real light in the town (`03` section 3.9.5): facades brighten near it; at Enhanced and Full a building it
  raises casts its spot shadow. Inside a building, the pane it adds or changes gets the rim glow.

### 5.5.1 What Follow does (one rule at every width)

**Follow agent moves the town's view, never the viewer's place.**

| Where the viewer is | Follow on | Follow off |
|---|---|---|
| The landing | stays on the landing (the whole town is in view, so nothing needs to move); the lamp's tile is ringed | the same; the lamp's tile is ringed |
| A borough street | during a `site.*` sequence (any `site.*` commit in the last 10 s): returns to the **landing**, where the whole rebuild is visible; otherwise switches to the lamp's borough street and scrolls its band into view (300 ms smooth under Full, instant otherwise) | nothing moves; the strip says where the agent is, and **Show** goes there |
| An interior (lobby, room, pushed detail) | **nothing moves**; the strip names the place, and **Show** goes there | the same |
| The vista (expanded) | the camera follows the lamp in the follow pose (tilt 48°, framing the target lot plus its neighbours), cutting under Reduced and Off | nothing moves; the edge chevron points at the lamp |

- A touch on the landing or a street, or a scroll by the viewer, **pauses** Follow for 10 s ("Follow paused · Resume"
  on the strip).
- Follow never takes a viewer out of an interior. `ui.present` is separate: with Follow on, an accepted present (or a
  present in presentation mode) navigates (section 5.4).
- **Show** exists whether Follow is on or off.

### 5.5.2 The build board

While a `site.*` sequence runs, **Build board** on the strip opens a sheet (a side panel at medium and wider) that
lists the whole rebuild at once:

- one row per page being built (≥ 48 px): the plain page name, its borough, a progress meter (survey, foundation,
  courses, windows: a 4-segment meter with the step in words), the number of panes placed, and the stamp seq;
- the lamp's current row highlighted and kept in view; rows in creation order;
- under the rows, the stamps as a list (seq, action, target, outcome, UTC time), newest first;
- a small thumbnail of each building's band image when it completes.

It is the list a screen-reader user follows during a rebuild (`04` TWN-R-4.15.3's 13th task).

### 5.5.3 Off-screen in the vista

With Follow off in the vista, when the lamp is outside the viewport or the viewer is in another building, a chevron sits
on the viewport edge at the lamp's bearing with the label "Agent building Store", a Plat button that travels there. It
never covers the focused element. (On a phone the landing has the whole town in view, and in a street or interior the
strip's text and **Show** replace the chevron; there is no edge pill.)

| ID | Requirement | Test |
|---|---|---|
| TWN-R-5.5.1 | While the agent is active, the agent strip names what it is doing and where, and **Show** brings that place into view or navigates there; in the vista with the lamp off-screen and Follow off, the chevron does the same. | Interaction test during a scripted rebuild at 390 × 844 (viewer on the landing, in another street, inside another building) and at 1440 × 900. |
| TWN-R-5.5.2 | Follow agent is off by default, is a visible `aria-pressed` toggle (on the agent strip at compact width, in the HUD at expanded) while an agent is active, and persists per viewer. | Shell test with a fresh profile in both profiles. |
| TWN-R-5.5.3 | With Follow off, no agent activity moves the viewer's camera, city scroll position or route; with Follow on, no agent activity moves a viewer who is in an interior. | Rebuild replay with the viewer idle in the city and in a lobby, at both widths, Follow off and on; camera trace, `scrollTop` and route as the table of 5.5.1 says. |
| TWN-R-5.5.4 | With Follow on at compact width, a touch or scroll on the landing or a street pauses following for 10 s and the strip shows "Follow paused" with Resume. | Touch test during a scripted rebuild. |
| TWN-R-5.5.5 | The agent strip is in the bottom 40 % of the viewport at compact width with ≥ 44 × 44 Follow, Show and Build board buttons, and never covers the dock's buttons or the focused element. | Phone shell test during a rebuild, in a room with a form focused. |
| TWN-R-5.5.6 | During a `site.restore` of the seed, the build board lists every page being built with a progress meter that reaches complete for each, highlights the lamp's current row, and lists every stamp; with Follow on and the viewer in a street, the view returns to the landing for the sequence. | Rebuild scenario at 390 × 844 with the build board open; Follow-on case from the Rewards street. |

## 5.6 Stamps along the trail and the agent log (Atelier graft)

A **stamp** marks each agent call the browser can observe, where the lamp was when it landed (`03` section 3.9.6 for
the rendering), and an entry in the Agent log with seq, tool or action, target, outcome and UTC time.

**What a browser can observe today**, and therefore which stamps exist:

| Outcome | Observed through | Stamp |
|---|---|---|
| Commit (`site.*`, `node.commit`, any direct agent action that writes) | the change stream (actor `agent:*`, surface `mcp`) and its domain events | **solid** ring, label `site.widget.add · #48,231` |
| Held for approval | `approval.requested` with `requested_by` the agent | **tagged** ring, label `Held · approval a1b2` |
| Dry run | not observable: a dry run writes nothing | none |
| Refused | not observable: a refusal writes nothing | none |

Township's "agent claude-code is previewing site.clear" echo and Atelier's hollow and struck stamps would need the
browser to see calls that write nothing. That needs a backend addition (an `agent.activity` notice forwarded to the
session's owners, the same way as `present`); it is recorded as an open question for the owner (README) and is not
required by this spec. The stamp renderer supports hollow and struck shapes so that the addition needs no rendering
work.

Stamps fade to 25 % over 20 s and stay until the agent has been idle for 10 minutes or the viewer clears them; "Show
trail" in the Agent log restores them for the session.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-5.6.1 | Every agent commit and every agent-requested approval that reaches the viewer produces exactly one stamp and one Agent log entry with matching seq or approval id. | rebuild-live replay plus a held promotion activation; compare stamps, log entries and the change stream. |
| TWN-R-5.6.2 | No stamp is produced for anything that did not arrive as a frame. | Honesty test variant with a dry-run-only script: zero stamps. |
| TWN-R-5.6.3 | Stamp outcome is told by ring shape and label text, never colour alone. | Forced-colours and greyscale render check of the four shapes. |

## 5.7 Clear and rebuild: the construction choreography

The `site.*` actions arrive as ordinary change-log commits (CONTRACT 5A.5). Everything below is decoration over data
that is already applied (principle 5).

**`site.clear` dry run.** Nothing happens in browsers (5.6). The terminal shows the preview.

**`site.clear` commit** (one change set deleting every Page and Widget):

1. The lamp descends over Town Hall; a solid stamp `site.clear · #48,300` is laid.
2. A survey line sweeps the town in the agent tone with the hatch: on the **landing** (compact), top to bottom across
   the tiles over 1.5 s, so the whole sweep is on one screen; in a street, across the bands in view; in the vista,
   north to south across the plinth.
3. As it passes, each building's windows go dark, then the building sinks into the plinth (construction shader in
   reverse, 700 ms per building); on the landing each tile's vignette sinks and its counts go to zero. Lot outlines stay
   as faint survey lines.
4. Street lights go out; nav signs fold; the Directory empties (it already has, since data leads).
5. The end state is the bare plinth with the engraved name and the survey lines; on the landing every tile is an empty
   surveyed plot with its borough name. An interior shows "This workspace is empty. Pages appear here as they are
   built." Follow never moves a viewer out of an interior (5.5.1); the empty-state page offers **See the town**.
6. Announcement: "Site cleared by agent claude-code: 49 pages, 112 widgets removed. Change #48,300."

**`site.page.put`, `site.restore` (a Page created):**

1. The lamp flies from Town Hall to the target lot (on the landing, from tile to tile); the strip and the build board
   name the page; with Follow on in a street, the view returns to the landing for the sequence (5.5.1); in the vista
   the camera follows or the chevron shows where.
2. **Survey:** the lot outline is drawn dashed and hatched (220 ms).
3. **Foundation:** a slab extrudes (300 ms), hatched on its edge course.
4. **Frame:** scaffold poles rise to the storey count.
5. **Courses:** the building rises course by course with a weld line in the agent tone and a dust puff per course
   (Enhanced and Full); at Enhanced and Full the lamp's spot shadow sharpens the rising mass, at Base its light pool
   does.
6. **Sign:** the street sign is posted; the street from Town Square lights along its path.
7. **Windows:** each widget's window lights (`site.widget.add` below).
8. The scaffold lowers; a stamp is laid; the lamp moves on.

**On the landing** the phases above play at the tile's scale: the tile's progress meter (pages built of pages planned
in that borough) fills, the vignette's landmark rises when that borough's first page completes, windows light as panes
are added, and every stamp increments the tile's stamp count. The full construction art (survey, foundation, courses)
plays building by building only in a street the viewer has open; with Base's limit of 4 concurrent constructions,
constructions not in view apply their end states at once, which the landing and the build board make visible as
progress, not as a jump.

**`site.widget.add`:** in the city, a crane swings a lit window module into the facade cell; the window glows in the
agent tone and settles. Inside that page, the pane drops in from above the grid (280 ms, Full), with the arrival tab,
the attribution band, the agent rim glow and `aria-busy` until its first data.

**`site.widget.remove`:** the window goes dark and is bricked over; inside, the pane folds up and away (220 ms, Full).

**`site.appearance.set`:** the look sweep from the Lamp Studio (`03` section 3.9.9); a change of `experience` triggers
the swap instead (`06` section 6.7).

**Batches.** `site.restore` without `pages` recreates every default page in one burst: building starts are staggered
by 140 ms in creation order with at most 8 concurrent constructions (4 at Base and Low-power, where constructions off
screen apply their end states at once). Data is never held back.

**Held steps.** A held agent change (for example a system page edit under R-PAGE-SYSTEM without the rule) shows as a
hatched ghost outline on the lot or window with the tagged stamp, and a cart at the Gatehouse; it solidifies only
when an `approval.decided` approve leads to the commit.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-5.7.1 | After `rebuild-live.ts --clear` the Directory, Plat pages and lots equal the seed's, and every announcement of the rebuild summary policy played. | Rebuild scenario test on the test stack. |
| TWN-R-5.7.2 | A window never lights before its building has risen, and a building never rises before its survey, for any interleaving of commits. | Choreographer property test over random commit orders. |
| TWN-R-5.7.3 | The rebuild under Motion Off produces the same end state, Plat and announcements as under Full. | Scenario test run in both Motion states; compare end-state snapshots. |
| TWN-R-5.7.4 | During a clear and a full restore viewed on the landing at 390 × 844, the survey line crosses every tile, and every tile's progress meter and stamp count reach their end values, without the view scrolling. | Rebuild scenario in the phone profile with the landing's Plat and effect log captured. |

## 5.8 The Choreographer: decoration that never blocks

```ts
// packages/town-world/src/choreo/types.ts
export interface Beat {
  readonly id: string;                         // "build:page:points"
  readonly cause: { seq: number; actor: string; surface: "web" | "mcp" | "system" };
  readonly kind: "flow" | "parcel" | "letter" | "build" | "demolish" | "window" | "gate" | "machine" | "look"
               | "present" | "stamp" | "replay";
  readonly target: NodeRef | HouseRef | LotRef;
  readonly durationMs: number;                 // nominal; scaled by queue pressure
  readonly after?: string;                     // ordering within one target's timeline
}
export interface ChoreoState {
  queue: Beat[];                               // FIFO per target, parallel across targets
  running: Map<string, { beat: Beat; t0: number; speed: number }>;
  pressure: number;
}
```

- **Ordering** is per target node by `seq`.
- **Pressure.** Above 40 queued beats, speed scales by `1 + (queue − 40) / 20` (up to 4×). Above 160, unstarted beats of
  one kind in one district merge ("12 windows light at once"), and flows merge into one stream whose particle count is
  the sum, capped at 64.
- **Staleness.** A beat older than 10 s at start is dropped and its end state applied.
- **Hidden tabs** suspend the Choreographer; end states apply on return.
- **Motion Off** applies end states immediately.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-5.8.1 | No Plat update, store update or announcement waits for a beat. | rt replay with the Choreographer stalled. |
| TWN-R-5.8.2 | Under `gen:live` at its default rate plus a full rebuild, the collapse path is used in at most 5 % of frames and no beat is dropped while its data was still pending. | Load scenario in the perf runner (feeds K8). |

## 5.9 The timeline scrubber (Constellation graft)

**Compact (the design):** **History** in the city's district switcher sheet (and the command sheet, "Replay history")
opens the **History sheet** at half height, so the street stays visible above it. The sheet holds a density strip of
the events the viewer may read over the seed's 90 virtual days and, under it in the thumb zone, a full-width slider
(`<input type="range">`, `aria-valuetext` "14 October, 312 events so far") with **−1 day** and **+1 day** buttons, Play
and **Back to live**. **Expansion:** at expanded width a collapsible **timeline strip** sits above the Directory foot.

- **Source.** Viewers with `audit:view` scrub `audit.events` (every domain event they may read); other viewers scrub
  their own `people.activity`. The data is fetched page by page when the sheet or strip is first opened and cached for
  the session. Nothing is shown that the viewer could not read in a table.
- **Scrubbing** replays the events as their usual city effects (flows, parcels, medallions, frieze links) at up to
  500 events per second of scrub (100 at Base), in virtual time, through the same effect map with the `replay` beat
  kind. At compact width the city shows the landing while the sheet is open, so replayed effects across the whole town
  are visible. Replay effects carry a "Replay · 14 Oct" plate and never touch the Plat, stores, counts or
  announcements.
- **Operation.** Tap the track, drag the thumb, or use the step buttons; with a keyboard, arrows (one day), Page Up and
  Down (one week), Home and End; Play replays at a fixed rate; Back to live returns. Under Reduced, replay shows each
  day's events as static highlights; under Off, the sheet shows counts only.
- Closing the sheet or Back to live returns the city to live after a 600 ms crossfade (cut under Off).

| ID | Requirement | Test |
|---|---|---|
| TWN-R-5.9.1 | The scrubber shows only events from `audit.events` for `audit:view` holders and from the viewer's own `people.activity` otherwise. | Run as `admin` and as `ana-silva`; compare the event sets with the actions' responses. |
| TWN-R-5.9.2 | Replay never changes stores, the Plat, counts or announcements. | Scrub across 90 days; assert no store mutation and an empty announcement log. |
| TWN-R-5.9.3 | The scrubber is fully operable by keyboard with the slider pattern and by taps alone with the step buttons and track taps. | Keyboard test at 1440; touch test at 390 × 844. |

## 5.10 Automation circuits (Constellation graft)

Each automation is a machine in The Works (`01` section 1.5) and in the `automation.builder` and `automation.runs`
dioramas (`02` section 2.5, D9 and D10). `automation.run_updated` frames (`run_id`, `status`, `step_index`,
`step_status`, `error_code`) drive one pulse per run through the machine's stations (`03` section 3.9.15): queued at
the hopper, running to station `step_index`, skipped as a hollow pulse, failed stopping with ✕ and the error code as
text, succeeded into the tray. Out-of-order frames reorder by `step_index`. Scheduler-driven runs show the clockwork
key on the hopper.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-5.10.1 | For any order of arrival of one run's frames, the pulse ends at the station of the highest `step_index` with the final status. | Property test over shuffled frame sequences. |
| TWN-R-5.10.2 | A failed run shows the error code as text on the machine and in the runs table, and toasts the owner. | rt replay with a failing run. |

## 5.11 Counts, toasts, banners and connection

- **Counts** from the counts frame drive the bottom bar's badges (Inbox, Alerts, You), the balance chip, the Directory
  counts, the Post Office flag, the Bell Tower face, the Gatehouse carts and the Guild Hall facade.
- **Toasts:** at compact width one at a time under the top bar (the read zone), passive text with no controls, shown for
  6 s, newest replacing the current after it has shown for 2 s, with a "+2" count when more are waiting; they never
  cover the focused element. At medium two, at expanded up to 4, top trailing; in the vista each draws a hairline leader line to where
  the event happened (decoration; the toast text is complete without it). Every toast is also in the Alerts sheet or
  the Agent log, so nothing is lost when one is missed.
- **Approvals banner** in the status layer for approvers while `approvals_pending > 0`, with **Open approvals**.
- **Offline:** "Offline · retrying in 4 s · Retry now" in the status layer (priority 2); fog rolls over the city at
  Enhanced and Full (decoration only); at Base the street dims.
- **Session revoked:** full-page "This tab was signed out" with Reload; the scene goes dark; the socket stops.

## 5.12 The five-minute demo

The demo is designed to be **presented from a phone held in one hand**, because the phone is the design target and the
device the audience carries. The same script also runs **on a big screen** as the expansion. Each beat says what the
presenter's thumb does on the phone, what the big-screen run shows, and the presenter's Follow state.

### Roles and rig

| Role | Person | Device |
|---|---|---|
| **Presenter** (Maya Ortiz, ops lead, admin, `?as=maya-ortiz`) | the presenter | an A15 class iPhone in Safari over HTTPS on the LAN (`https://<host>:5443/town/`, WebGPU where exposed), starting at Base, in **presentation mode** |
| **Agent operator** | a second person | the side laptop's terminal, visible to the room: claude-code over MCP for Maya, `scripts/rebuild-live.ts` steps and ad-hoc `action.invoke` calls |
| **Ana Silva** (member, `?as=ana-silva`, default settings) | a third person at the front | a mid-range Android phone in Chrome over HTTPS on the LAN |
| **Priya Nair** (finance, default settings) | the agent operator may double as Priya | the side laptop's browser at 1440 × 900, for one approval |

**Presentation mode** (a You-sheet setting, never on by default) turns on Follow agent and Motion Full, requests a
**Screen Wake Lock** (`navigator.wakeLock.request("screen")`, re-requested on `visibilitychange`; where the API is
missing, the rehearsal checklist sets the phone's auto-lock to Never), draws **touch indicators** (a 44 px ring at
each touch point for 400 ms, a DOM overlay with `pointer-events: none` and `aria-hidden`, so the audience sees taps
whatever the mirroring method shows), and shows **captions** (the live-region text in the status layer's area as a
one-line strip).

**Room view.** The preferred projector layout is composed on the presenter laptop: the phone's screen captured over
USB (QuickTime movie recording for the iPhone; `scrcpy` for Android) at full projector height on the left (about
500 × 1080 px), Ana's phone capture small beneath it if wanted, and on the right a second browser window signed in as
Maya at 1400 × 1080 showing the **expanded design** (the vista, presentation mode on, following the agent). The phone
tells the hand-held story; the right side shows the same town at desktop scale. A pillarboxed phone mirror alone is the
fallback.

**No app switching** during the demo: copying is shown with the in-page copy plate, so Safari is never backgrounded.

### The beats

| Time | Beat | Follow | From the phone (the design) | On a big screen (the expansion) | Why it matters |
|---|---|---|---|---|---|
| 0:00 | **Today** | (Classic) | All screens show Classic: Maya's phone on Home, Ana's on the store, Priya on Approvals. "This is the Suite today." | Maya's laptop window on Classic Home. | The baseline the owner wants to leave. |
| 0:10 | **The swap** | on | Operator: `site.appearance.set { look: "calm", experience: "town" }`. Every screen swaps live to the same route under `/town/`: Maya's phone shows Home's lobby in its phone order (balance, approvals, unread first); Ana's store; Priya's approvals. The agent strip rises in the status layer: "◇ claude-code · active". | Home's 12-column grid, painted; the lamp over Town Hall in the backdrop. | One action switches the whole site, live. |
| 0:20 | **The town** | on | Maya taps **City** in the bottom bar: the **landing**, the whole of Northwind on one screen in morning light: the Square in the middle, seven borough tiles, the Post Office flag and "3" on Personal, lanterns pulsing on Engage as `gen:live` posts real events. She taps **Rewards**: its street, three bands, the Bank, the Emporium arcade, the Hall of Honours. | The vista; she hovers the Bank: "Points · Bank · your balance 48,210". | The organisation as one living object, opened with a thumb. |
| 0:30 | **Enter** | on | She taps the Bank's facade. It grows to fill the screen and its lit windows unfold into the stacked lobby cards of `/points`. Caption: "Points, Bank. Page." | She clicks the Bank: the camera dollies into the facade and the windows unfold into the grid. | The city is the navigation, at every size. |
| 0:45 | **Dense work** | on | She opens the Statement room. In the dock: **Search**, types "Peak" in the field at the bottom: "23 lines match Peak", ticks on the rail under her thumb. **Select**, taps 12 lines, ⋯ **Copy 12**: the plate "Copied 12 lines as TSV" shows the first two lines. **View** in the dock: **Flow**: the ledger becomes a ribbon running down the screen. | The table: Search, a 12-row selection pasted into a spreadsheet; the ribbon left to right. | A real enterprise tool on a phone, then a view the DOM cannot draw. |
| 1:05 | **One checkout, the whole town reacts** | on | Maya taps **City** in the bottom bar (still there in the room): the landing. Ana checks out a hoodie on her phone (cart, quote, delivery with autofill, confirm, all in the dock). On Maya's landing at once: a gold streak runs from the Engage tile (Ana's lane) to the Rewards tile (the Emporium); a parcel streak runs back; the Operate tile's stock count drops by one; the Insight tile's ring ticks; a toast under the top bar: "Order N-1042 placed by Ana Silva". | The vista: the streams on the real streets, the parcel leaving, the toast's leader line to it. | One action ripples across the whole town, visibly, on a phone. |
| 1:30 | **Ninety days** | on | **City** again (the district switcher) → **History**: a half-height sheet with the slider in the thumb zone, the landing above it. She drags from day 1 to today while the quarter replays as streaks between tiles; **Back to live**. | The timeline strip over the vista. | History as movement through real places. |
| 1:50 | **The agent clears the site** | on | Operator: `site.clear` dry run (preview in the terminal; the phones show nothing, honestly), then the commit. On the landing: a solid stamp on the Admin tile; the hatched survey line sweeps down across every tile in 1.5 s; each vignette sinks and its counts go to zero. Ana's phone: "This workspace is empty". Caption: "Site cleared by agent claude-code: 49 pages, 112 widgets removed." | The survey line sweeps the plinth; every building sinks. | The whole site is data, and on a phone you see all of it go. |
| 2:15 | **The rebuild** | on | `rebuild-live.ts`: the lamp leaves the Admin tile for the Square; the Square's pavilion rises; tile by tile the progress meters fill and the landmarks rise; the strip counts "3 pages, 14 panes so far". She taps **Build board**: the pages being built, the lamp's row highlighted, stamps listed; she closes it. Priya's laptop, not following, shows the chevron "Agent building Home". | The camera follows the lamp in the vista; the lamp's spot shadow sharpens each rising building. | The whole rebuild, legible and attributed, on one phone screen. |
| 2:45 | **Inside while it builds** | on | She taps the Town Square tile: Home's lobby. Follow does not pull her out (it never moves a viewer in an interior). Cards drop in as the agent adds `reporting.suite-kpis` and `approvals.inbox`: the arrival tab "#48,331 Added by agent claude-code", the hatched band and the rim glow on each card. | The panes drop into the grid. | Live, attributed and announced, even mid-build. |
| 3:05 | **New Town** | on | `site.page.put` "Peak Week war room" with `reporting.heatmap`, `promotions.performance` and `tasks.board`. The strip: "building Peak Week war room · Show". She taps **Show**: the New Town street opens at its first lot as the building rises; she taps it when its windows light. | New Town's first lot in the vista. | The town is derived from data. |
| 3:20 | **A breach becomes a ridge** | on | In the war room she opens the heatmap's room; **View** in the dock → **Terrain**: in portrait, one cell rises through the hatched threshold plane. Caption: "Terrain view. 1 cell above the threshold of 600: Crane, EMEA, 759.9." | The same in a landscape framing. | 3D that helps comprehension, with its table one tap away. |
| 3:35 | **Night falls** | on | **City** → the landing. Operator: `site.appearance.set { look: "nocturne" }`. The look sweeps across the tiles from the Lamp Studio on the Admin tile: windows glow in their lit colour and nothing else is bright (Base, no bloom). Ana's phone switches live. | The sweep crosses the plinth; flows bloom (Full). | Looks are scenes; light means signal on every tier. |
| 3:50 | **Held, then decided by a person** | on | The agent requests activation of the Peak Week promotion (held, R-PROMO-ACTIVATE): a tagged stamp on the strip; on the landing the Personal tile's cart count goes up by one. Priya opens the item on the laptop: two keys, "Requested by agent claude-code for Maya Ortiz · You are not the requester · You hold approval:decide"; she approves. On the landing the cart count drops and a streak runs from Personal to Engage, where the Fairground's flag rises on the tile. Ana's phone shows "Offers for you". | The gate lifts, the cart rolls to the Fairground, the pavilion flag rises. | The agent's discipline is visible as physical gates. |
| 4:20 | **`ui.present`** | **off** (she taps Follow off on the strip) | The agent presents the promotion's performance widget. The plate rises in the status layer under her thumb: "claude-code wants to show you: Peak Week performance · Not now · Go". She taps **Go**: the Fairground Office's room opens on the widget with the spotlight; "Back to where you were" waits in the status layer. Priya's and Ana's screens do not change. | The laptop window, still in presentation mode, travels to the Fairground Office directly and rings the pane. | The agent can show, asks first, and never takes anyone else's screen. |
| 4:35 | **Where points go** | off | In the You sheet Maya switches to Jonas (`?as=jonas-becker`), opens the Award Office room, adds five EMEA fulfilment members from the recipients sheet, and taps **Review award** then **Award** in the dock. **City**: on the landing five streaks run from Rewards into the Engage tile; she taps Engage and the People band's EMEA lane lights five houses; the trial-balance beam on the Rewards tile stays level. | Five streams down the EMEA lane in the vista. | Volume and destination at a glance. |
| 4:50 | **Access** | off | Maya taps **Motion** in the top bar → Off: the town stills at once. You → Rendering → Plain: the same page as the design system's DOM. You → **Switch to Classic**: only her phone changes. Caption: "Points, Bank. Page." | Motion Off in the HUD, Plain, Switch to Classic. | The GPU experience never locks anyone out, and Classic is one action away. |
| 5:00 | **End** | off | Back to Town: Ana's phone and Maya's phone both on the night landing. | The night vista. | |

### Rehearsal facts (checked by `town-test` scenario `demo.spec.ts` on every stack)

- The swap beat moves every following screen to the mirrored route with `?as=` preserved.
- `site.restore` in stages leaves every default page present on its seed lot.
- Both phones render every page the presenter's screen does.
- Every caption line in the table appears in the announcement log.
- The present beat changes only the presenter's session's screens, and with Follow off it waits for Go.
- Follow is on from 0:10 to 4:20 and off after, and no beat relies on Follow moving the presenter out of an interior.
- Every tap the presenter makes on the phone is on a control in the bottom 40 % of the screen, except exactly these:
  the content targets (landing tiles, building facades, lobby cards, list items and the Statement's 12 Select
  checkboxes) and the top bar's **Motion** button at 4:50.
- No beat's choreography breaks its tier's budget: Base in the phone profile, Full on the reference machine.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-5.12.1 | `demo.spec.ts` drives every beat against the test stack with four browser contexts (Maya and Ana in the phone profile, Priya at 1440 × 900, and Maya's room-view window at 1400 × 1080) and asserts the rehearsal facts. | Runs on every stack after G-DEMO's dependencies land. |
| TWN-R-5.12.2 | The phone-led rehearsal at G-DEMO runs on the two G0 phones over HTTPS on the LAN with the WebGPU backend on the presenter phone where exposed, the room view composed as above, and the presenter phone's thermal guard does not fire during the five minutes. | G-DEMO rehearsal record on the gate task: backend, tier trace and guard log from both phones. |
| TWN-R-5.12.3 | Presentation mode requests a screen wake lock and re-requests it on return to visibility, draws touch indicators that are `aria-hidden` and pass pointer events through, and turns on Follow and Motion Full; turning it off releases the lock and restores the previous Follow and Motion. | Interaction test with a stubbed `navigator.wakeLock`; DOM and pointer-event checks of the indicator layer. |
