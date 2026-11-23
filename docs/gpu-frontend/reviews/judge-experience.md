# Judge review: experience, visual impact and the owner's intent

Task-ID: WG-5532. Lens: does the owner get "an entire website experience" with real 3D, where "widgets are entire
apps in themselves, an expression of part of a domain", and a signature demo of clearing the site and watching an
agent rebuild it over MCP. The owner's complaint was that the DOM app "still just kinda looks like a decent basic
site", and the owner judges by screenshots and video.

Coverage note. I read the brief, all of `orbit.md`, and for the other four the concept, the shell, the per-domain
tables or screens, the rebuild, `ui.present`, phone, looks, demo, plan and risk sections. I skimmed, rather than read
line by line, the shader appendices, text-engine internals, test matrices and performance tables of Township,
Instrument, Atelier and Constellation. Nothing below depends on those parts.

A framing point applies to all five. In every proposal the reading state is a flat, pixel-snapped panel (they all
agree that text must be 1:1 and unlit). So the real question is what surrounds that state, how the user gets in and
out of it, and how much of the working day is spent there. I judge each on that.

---

## 1. Orbit (a ring of stations in a lit room)

### Strongest 3 points

1. The 3D is spatial navigation and causality, not decoration. Routes are camera paths, 26 stations sit on a ring in
   six arcs, and `threads` draw one transaction's causal path across stations (B.1, B.4, 6.2). A checkout visibly
   updating five places is a real "impossible in the DOM" idea.
2. The agent is a physical light, the Lumen, and it is a real light source (B.5). It lights bevels and casts a second
   shadow on the wall as it works. The rebuild (6.5) is a coherent choreography: unweave outward from the agent,
   stations sink, a station rises and the Lumen weaves each panel by edge trace, noise fill and row-by-row reveal.
   Every beat has a text and reduced-motion equivalent. Held changes are hatched ghosts that solidify on approval.
3. The most disciplined legibility contract of the five (B.3): UI content is a separate target that is never
   tonemapped or bloomed, panel faces are token-exact, reading poses are 1:1. It also has the best enterprise
   hygiene: trace ring, attribution bands, Plan and Plain paths from the same widget code (2.6, 7.5).

### Five most serious weaknesses

1. **At rest it is a flat page with soft shadows (B.1, B.3 rule 3, 1.4 tables).** The facet width is clamped to
   `viewportWidth - 48` (B.1), so at the reading pose the wall fills the screen. The ring, the sky and the floor
   are almost invisible. A user opens Points, scrolls the ledger and spends the hour looking at a wall of cards.
   The 3D treatments in the 1.4 tables read "none" for most of the 77 widgets. A screenshot of a working station
   looks like the DOM app with drop shadows, which is the owner's original complaint.
2. **The six looks collapse toward the DOM at the reading pose (10.2).** Meridian is specified as "almost flat",
   "thin card slabs, 2-px radius" and "heading-rule panels drawn as ruled sheets with no slab". An admin switches
   the site look to meridian during the demo and gets something indistinguishable from the old app. "Whole rooms"
   is a claim about the overview, not about the screen people work in.
3. **Wayfinding is a bottom nav bar plus a memory game (B.1, 1.3).** Inside the ring you can see only the wall in
   front of you. The other 25 stations are not visible. The "Station dial" chip strip is what people will use, and
   it is a nav bar. When the agent adds a page, stations glide to new angles (6.5 step 3), so spatial memory
   shifts under the user's feet. A first-time viewer pressing `G` then `S` flies a spline through overview for up
   to 900 ms to land on a wall that looks like the one they left. Orientation is claimed ("you know where Approvals
   is relative to Store") but nothing at the reading pose shows it.
4. **Phone loses the 3D completely (8.1).** The ring becomes a carousel of single-column bays with `scrollTop`
   driving the crane. On a 390 px phone the user sees stacked cards and a dial. Overview is a pinch away, but the
   phone is the device most likely to be shown in the demo (Ana's phone). Her screen shows none of the room that
   the projector shows.
5. **The distinctive 3D data objects are hidden behind the `D` key and cover about ten widgets (3.6, 1.4).**
   Ledger pillars, hash chain, tier stair, permission layers, step graph and population field are the "meaningful
   3D" in the domains, and none is visible until someone presses `D`. A finance user who never learns the key
   never sees double entry as pillars. Only the permission layers beat (demo 1:25) is staged to surface one.

### Scores (1-10)

| Wow | Meaningful 3D | Enterprise credibility | Wayfinding | Demo strength | Phone | Domain coherence |
|---|---|---|---|---|---|---|
| 7 | 7 | 8 | 6 | 8 | 4 | 8 |

---

## 2. Township (a living miniature city)

### Strongest 3 points

1. It is the only proposal whose first frame cannot be mistaken for a website, and it turns the owner's mental
   model into geometry. A page is a building, a widget is a lit window on its facade at its grid cell (2.3 rule 4),
   and entering a building unfolds the windows into the real panes (S.3, demo 0:20). The Enter transition (dolly
   in, perspective flattens, windows become panes) is the best single video moment of the five.
2. The honesty rule (1.2 rule 2): every moving thing that looks like data is data, and decoration is limited to
   weather, water and sun. Points streams along a real street graph from the Bank to a house, parcels leave the
   Emporium on `order.placed`, carts queue at the Gatehouse for pending approvals, and machines run while runs are
   running (2.2, R6.2). It is the best answer to "gimmick after a day": a quiet suite is a quiet city, and flows
   carry information a table cannot (where, and how many at once).
3. The agent rebuild is the most legible and attributable (R6.4): the surveyor drone, survey line, foundation
   slab, scaffold, courses rising with a weld line in agent colour, windows lighting one per widget, then a crane
   dropping a window module while the pane drops in inside. Held changes become hatched carts at gates and a
   person approves. Wayfinding is also the best: map, district plaques, breadcrumb, Directory list, `G` keys, and
   a "you are here" figure (1.3, 2.4, R1.4).

### Five most serious weaknesses

1. **Inside a building, 3D is gone (3.1, R3.3).** The interior is orthographic and screen-aligned, with "no
   perspective, no parallax, no tilt" on panes, and the city is a blurred cached backdrop visible only in margins.
   The 3D appears in eight small dioramas (3.3). A support analyst who works in Orders and Approvals all day uses a
   Meridian-grade flat app, reached through a flying-camera launcher. The owner's "decent basic site" is the screen
   they actually live in. The city is a beautiful front door to the same house.
2. **It can read as a toy to the buyer (1.2, R13.1 risks 3 and 7).** The spec itself names the risk and writes
   kill criteria for it: median task time above 1.15 times the baseline, or two of three judges scoring enterprise
   credibility below 8.5. A finance controller who asks for the ledger is told to find the Counting House. The
   proposal's own mitigations (default travel set to "cut", Directory open by default, Plan mode) are all ways to
   skip the city, which shows how the power users will behave.
3. **Several domain metaphors are forced and will mislead (2.2, R1.3.6, R1.3.19).** Search is a signal mast,
   settings is the Lamplighter's Studio, calendar a clock tower, pages the Planning Office. Scenario: a member who
   wants notification preferences goes to the Bell Tower (the notifications district), but `notifications.preferences`
   lives on `/settings` in the Lamplighter's Studio. A metaphor that sends you to the wrong building is worse than a
   nav label. Points, store, approvals and automation map well; roughly a third of the 19 do not.
4. **Quality depends on authored art, not engineering (R2.1, 2.2, 2.4).** There are 19 landmark buildings, 40
   houses, six look materials and a model-kit finish ("basswood, brass, frosted acrylic"), all inside a 600 KB glTF
   budget. If the models look low-poly, the first render looks like a mobile game, which is worse than the DOM
   app. Orbit and Instrument are procedural and degrade gracefully; Township does not. The owner will judge it by
   how good a miniature looks in a screenshot, and the spec has no art-direction gate.
5. **The page-derived city has fixed lots and an unspecified overflow I could not find (2.3 rule 3).** Each
   district has 2 to 8 surveyed lots, and custom pages go to a New Town terrace. The agent can create arbitrary
   pages, which is the signature demo. In the sections I read there is no rule for what happens when an agent
   adds a ninth page to a district or fills New Town. In the demo (3:00) the city grows by one building, which
   is safe; in real use the plan could outgrow its plinth.

### Scores (1-10)

| Wow | Meaningful 3D | Enterprise credibility | Wayfinding | Demo strength | Phone | Domain coherence |
|---|---|---|---|---|---|---|
| 9 | 7 | 6 | 9 | 9 | 7 | 7 |

Phone note: portrait city at 62 degrees tilt with a one-line live strip, tab bar, tap to peek and enter, and a
city that draws zero frames while an interior is shown (R8). This is the best phone story because the 3D is a
real navigation affordance and the phone mostly shows interiors anyway.

---

## 3. Instrument (cinematic mission control, 2.5D)

### Strongest 3 points

1. The best enterprise instrument for an operations user. Seven explicit rules (0.1: ink never lit, light means
   signal, keyboard first, motion only on events), GPU table filtering over 8,500 audit rows per keystroke with a
   density strip, million-point charts with M4 decimation, and `V` morphing between bar, line, area, scatter and
   table (1.3, 1.18, 1.19). It would be pleasant to use for hours.
2. The 3D "wells" are the most analytically meaningful in the field: a heatmap raised to terrain so a breach is a
   ridge through a threshold plane; the ledger as a flow ribbon whose widths show conservation; the permission
   matrix exploded into role planes so "why can this person do that" is a line you can follow; hash chain in a well
   (1.5, 1.18, 1.20). Each has a flat equivalent and a mirror.
3. The construct effect is a clean and honest build: outline trace, scan line passing through text, each glyph
   printing as the line crosses its baseline, light falling on neighbours' bevels, agent trails from a beacon,
   wireframe ghosts for held changes (6.5, 6.7). Dry runs show nothing, which is a rule that keeps the UI honest.

### Five most serious weaknesses

1. **It is the proposal most likely to repeat the owner's complaint (0.1 rule 4, 1.4, 0.3).** "The camera moves
   rarely"; the screen anatomy is nav rail, top bar, panels and a trace strip. After two minutes a user sees an
   excellent dark dashboard with glass and bloom, which is a "decent basic site" with better materials. The 3D
   is confined to wells inside panels.
2. **The 3D moments are behind keys and nobody finds them (1.18 `T`, 1.5 `Shift+F`, 1.20 `X`).** Terrain, flow
   and exploded matrix are opt-in. A new analyst never presses `T`. The wow lives in the demo presenter's
   fingers, not in the product.
3. **The "impossible in the DOM" claims are the thinnest (6.5, 13.11).** A scan line revealing text can be
   approximated with a canvas or mask; a million-point line with morphs exists in canvas chart libraries. The
   spec's own comparison concedes "the hybrid gets most of the data spectacle at lower risk". A sceptical viewer
   says "I have seen that in a Grafana-style tool", and the demo has no spatial or causal moment as strong as
   Orbit's threads or Township's checkout.
4. **Wayfinding is a sidebar (1.4).** Nav rail, breadcrumb, `G` keys, command line. That is good navigation and
   it is the DOM app's navigation. There is no overview, map or sense of place. A first-time viewer learns where
   they are only from the h1.
5. **Its own first demo beat is its worst still (demo 0:00, 0.1 rule 2).** "Nothing glows except the live dot"
   is a principled position and produces the least striking resting screenshot of the five. The owner judges by
   screenshots, and an idle Instrument frame looks like a good dark dashboard. The phone (8.1) is a standard
   bottom-bar app with parallax disabled.

### Scores (1-10)

| Wow | Meaningful 3D | Enterprise credibility | Wayfinding | Demo strength | Phone | Domain coherence |
|---|---|---|---|---|---|---|
| 5 | 7 | 9 | 4 | 6 | 5 | 8 |

---

## 4. Atelier (a lit studio desk of physical objects)

### Strongest 3 points

1. The agent identity is the most legible of the five: an invisible hand (a hand-shaped shadow plus a held card
   with a bent corner), a graphite tool trail on the desk, and an inked stamp per MCP call, `site.widget.add · #1432`,
   hollow for dry runs, tagged for held calls, struck through for refusals (R6.4). Every call is a visible,
   timestamped, readable artefact, and it is exactly what a video needs.
2. A real design logic for materials: material encodes kind of work (paper for reading and writing, frosted glass
   for live instruments, anodised aluminium for control and governance, ceramic for commerce, vellum for history
   (1.3)). The vellum revision stack fanned in depth, with two revisions sliding together so unchanged text overlaps
   and changes double, is the one genuinely new spatial comparison idea in the whole round (R1.16, demo 3:30).
3. Flat focus is first-class (R3.7): any dense widget presses flat under an orthographic camera into a matte
   sheet, deep-linkable with `?focus=`. The proposal is honest that work happens there, and it has the most
   complete per-widget "object / views / live / flat focus" table (R1.2 to R1.20). It also has the best fallback:
   Paper mode is the DOM app.

### Five most serious weaknesses

1. **It is nearly orthographic and the working state is "matte, uniform light, no sheen, no fibre" (1.1, R3.7).**
   The camera is 12 degrees looking straight down, and all the dense widgets are marked "Default flat": ledger,
   accounts, orders (staff), inventory, audit timeline, promotions list, members, grants, program, automation list
   and runs, review queue and more. Scenario: an operator opens the ledger book with its page curl, presses
   `Alt+Shift+F` after the first minute, and then lives in a flat table with the desk dimmed to 30 percent. The 3D is
   texture and light on cards; the structure is a page of cards with a sidebar of tabs.
2. **Skeuomorphism will wear (R1.2 to R1.14).** Luggage tags for expiry, a cheque slip with a perforated stub that
   tears, a telegram form for notifications, wax-sealed envelopes, a "Sign and send" stamp, rubber-stamp order
   timelines. Scenario: a manager clears 30 approvals; each decision is a 180 ms stamp strike with ink spread.
   The first is charming and the thirtieth is friction; reduced motion removes the delight but not the vocabulary.
   Enterprise buyers will also read twee, and each widget has its own metaphor, so the objects do not build a
   system a user can learn once.
3. **No spatial wayfinding beyond a card file (R1.1, 1.1).** Nav is an index-card drawer; "Overview" only shows
   the current page's desk at 0.35 scale. A first-time viewer has no map of the site. The only sense of place is
   the title label and a raised card in the drawer.
4. **The signature clear is a physics tumble (R6.5 step 2).** Cards become Rapier dynamic bodies and fall off the
   desk edge. It is memorable and filmable, but it depends on a physics engine for one moment, is not
   deterministic, and may read as destructive or juvenile in front of buyers. Also R13 risk 9 flags that
   procedural products may "look cheap" next to photography, and the owner will look at the store first.
5. **Phone is the DOM site with texture (R8.1, R8.3).** One column of flat cards, a tab bar, render scale 0.67.
   The desk metaphor adds nothing there and the 3D is invisible on the device most likely to be held up next to
   the projector.

### Scores (1-10)

| Wow | Meaningful 3D | Enterprise credibility | Wayfinding | Demo strength | Phone | Domain coherence |
|---|---|---|---|---|---|---|
| 8 | 4 | 5 | 3 | 7 | 4 | 6 |

---

## 5. Constellation (the organisation as an entity graph in space)

### Strongest 3 points

1. The most radical answer to "not a website" and the one with the most real "impossible in the DOM" moments:
   the 90-day timeline scrub replaying events as pulses along real relationships, a checkout travelling the graph
   (Ana to order to product to accounts to promotion), automation runs as circuits you watch, the audit hash
   chain as a double-helix spine you ride up while a verify sweep climbs both strands, and permission as topology,
   where switching to Priya re-forms the field to what she may see (demo 0:25, 1:25, 2:15, 2:40, 4:20).
2. A genuinely different information architecture: domains are lenses, a route has an anchor entity, and the
   page's widgets unfold as orbiting panels around it, with a tether to what each expresses (1.3, R1.1). This is
   the most literal reading of "widgets are apps, each an expression of part of a domain": a widget is an app
   attached to an entity.
3. The best fallback story for its risk: Panel mode (the same panels, orthographic) is first-class and defaults
   on dense routes and phones (1.2), the mirror made visible is the Plain mode, and the accessibility treatment of
   the field is imaginative (a `role=tree` field navigator with "Connections", R5.5).

### Five most serious weaknesses

1. **A 13,600-node, 41,000-edge field is a hairball for a first-time viewer (R13.1 risk 2, K2; 1.1).** The spec
   writes its own kill criterion: fewer than 6 of 8 participants completing "find Ana Silva's most recent order
   starting from the field" without the palette. Scenario: a new store manager opens `/field`, sees a glowing
   cloud with 19 labelled hubs, and reaches for the nav rail. The nav rail and palette are the real wayfinding.
2. **Most widgets get nothing from the 3D, and most of the working surface is flat (R1.2, 1.2).** "3D adds: none"
   is the entry for roughly half of the 77 widgets. Panel mode is the default on `/ledger`, `/admin*`, `/audit`,
   `/reports*`, `/d/*`, inventory, manage, `/tasks/all`, the page editor and every phone. Scenario: finance and
   admins, the people who would use the permission-heavy parts daily, never see the field.
3. **Graph demoware risk and a backend footprint beyond "the backend stays" (R13.1 risk 7, Appendix A).** A
   per-principal graph snapshot, new bus topics (`account.selected`, `txn.selected`) and widget config keys are
   amendments. Scenario: a marketing manager asks "where do I see this month's redemptions?" and the answer is a
   panel. The graph is evocative, but force-directed entity graphs are the classic beautiful-in-the-demo,
   unused-in-the-week visualisation.
4. **Layout persists per viewer, so shared conversation breaks (0, decision 3).** The simulation reheats locally
   and positions persist per viewer. Scenario: in a meeting, the presenter says "look at the cluster right of the
   Points hub" and the two viewers' fields differ. For a product where agents and humans point at things (`ui.present`),
   "the thing is over there" has no stable meaning.
5. **Domain coherence is lopsided and the phone is a degraded field (R1.2, R8.1).** Points, store, segments,
   automation and audit have strong field presence. Calendar, tasks, messaging, notifications, admin and settings
   are "none". The field on a phone renders at 0.67 scale, 30 fps, and the simulation may not run over 20 s. The
   rebuild also happens around the viewer's own member node, so the "site" the audience sees being rebuilt is one
   orbit plate, not a place.

### Scores (1-10)

| Wow | Meaningful 3D | Enterprise credibility | Wayfinding | Demo strength | Phone | Domain coherence |
|---|---|---|---|---|---|---|
| 9 | 7 | 4 | 3 | 8 | 4 | 5 |

---

## Score table

| Proposal | Wow | Meaningful 3D | Enterprise | Wayfinding | Demo | Phone | Domain coherence | Total |
|---|---|---|---|---|---|---|---|---|
| Orbit | 7 | 7 | 8 | 6 | 8 | 4 | 8 | 48 |
| Township | 9 | 7 | 6 | 9 | 9 | 7 | 7 | 54 |
| Instrument | 5 | 7 | 9 | 4 | 6 | 5 | 8 | 44 |
| Atelier | 8 | 4 | 5 | 3 | 7 | 4 | 6 | 37 |
| Constellation | 9 | 7 | 4 | 3 | 8 | 4 | 5 | 40 |

Time spent in flat panel mode, in descending order of 3D presence at the screen where work happens: Constellation
Orbit regime (off by default on dense routes), Orbit (flat wall with shadows plus a room visible only in motion),
Township (flat interior, 3D is the lobby), Atelier (flat focus for all dense work), Instrument (flat except opt-in
wells). Every proposal is flat for the working hour; the differences are what the 3D does the other minutes.

## Grafts onto the winner (Township)

Township already has the strongest first frame, wayfinding, honesty rule and rebuild. What it lacks is a reason for
3D to remain once you are inside, a dense-data story and an agent audit trail. Graft these:

1. **Orbit's legibility contract (B.3).** Put the UI layer in its own target, never tonemapped, bloomed or fogged,
   with panel faces in exact token colours. Township's pass design reaches the same end but never states it as a
   testable contract. Also take Orbit's cause-grouped `threads` and `trace ring` as a Township "ticker road", so
   a checkout also leaves a readable list, and take its Plain and Plan paths (Township already has Plan).
2. **Instrument's wells, as the diorama upgrade (1.5, 1.18, 1.20).** Heatmap-to-terrain with a threshold plane,
   the ledger flow ribbon (width equals points) and the exploded role-plane permission matrix are stronger
   comprehension aids than Township's eight dioramas. Replace the beam balance, tier ladder and heatmap relief
   with these. Take Instrument's GPU table filtering and `V` view morphs for the Observatory and the Record Office
   so the interior has a "this could not be done in a DOM" moment beyond the transition.
3. **Atelier's tool-trail stamp per MCP call and its agent log (R6.4).** Township's drone leaves a physical build
   but no ledger of calls. Add a stamp or street plaque per call (`site.widget.add · #1432`; hollow for dry run,
   tagged for held, struck for refused) and the Atelier vellum revision stack for `audit.node-history` and
   promotion history. Atelier's "Default flat" declaration per widget, deep-linked as `?focus=`, is a clean rule
   for which interiors never show a diorama.
4. **Constellation's timeline scrubber and field navigator (R1.5, R5.5).** The scrubber replays history as flows
   along Township's street graph, which satisfies the honesty rule because it is real events. Its `role=tree`
   field navigator is a ready accessibility model for the city Plat. Its "permission as topology" beat is
   already half in Township (unlit scenery), so stage the identity switch in the demo; and borrow automation runs
   as a watched circuit for The Works.
5. **Orbit's presenter follow pose and off-screen indicator (6.5 step 5, 6.6).** A chevron "Agent building Store"
   at the screen edge that flies you there is a better audience story than Township's consent plate alone, and it
   covers viewers who are not following.
6. **Instrument's "light means signal" rule (0.1).** Adopt it for Township's night look so nothing glows without
   an event, extending the honesty rule to light.
7. **Process graft.** Add an art-direction gate before district work, with a review of one landmark and one
   interior transition in each look, because Township's quality depends on authored art. Add an explicit overflow
   rule for lots when the agent adds pages.

## Ranking and reasons

1. **Township.** It best answers the owner's actual complaint: the first frame is not a website, and the proposal
   renders the owner's own model (a page is a building, a widget is a lit window and an app inside) as the
   navigation. It has the strongest demo (a checkout that ripples through a real street graph, a drone build with
   legible attribution), the best wayfinding, a clear honesty rule that guards against gimmick, and the safest
   degradation (Plan mode is the DOM app, built first). Its weaknesses are real (flat interiors, toy risk, art
   dependence) but are the kind that can be mitigated by gates and grafts. Its risk if executed badly is the
   steepest cliff of the five.
2. **Orbit.** The better engineering and enterprise-credibility story, and its Lumen and threads are the most
   integrated use of light in the field. It loses to Township on first-frame impact, wayfinding and phone, and its
   reading-pose rule means the signature room is mostly out of sight when you work. It is the right fallback if the
   city's art burden or toy risk is judged too high, and it is the safest pick for the owner who values credibility.
3. **Constellation.** The most original concept and the strongest data-causality demo, but it fails first-time
   wayfinding by its own kill criterion, gives about half the widgets no 3D role, and carries a backend footprint.
   It is best used as a source of ideas (scrubber, spine, circuits, permission topology), not as the frame.
4. **Atelier.** Attractive and distinctive, with the best agent-identity idea (stamps and trail) and the vellum
   history idea, but its 12-degree top-down camera, flat focus for all dense work and per-widget skeuomorphs mean
   it is a lovely skin on a page-of-cards site, which is what the owner is trying to leave.
5. **Instrument.** The best for people who use the tool all day, and the best data-comprehension wells, but it is
   the one that most risks hearing "it still looks like a decent site" again. Its wells and morphs are the most
   valuable thing to graft into the winner.
