# Visual design and information architecture review (judge: visual)

Scope: the 25 screenshots in `docs/frontend-competition/shots/` (desktop 1280, phone 390, wall 1920, live about 2 s after an agent commit, live-full). Lens: enterprise credibility, typographic hierarchy, colour discipline, density, legibility on a wall and a phone, and how well the "agent just built this panel" moment reads. Design intent was read from each `DESIGN.md`. No files were edited other than this one.

## Ranking

| Rank | Prototype | Score (0-10) | One-line verdict |
|---|---|---|---|
| 1 | Meridian | 8.5 | Most credible and disciplined. Numbers are the hero, the accent is used as a signal, and the trace reads like an instrument. |
| 2 | Nocturne | 7.5 | Calm, legible dark console that works on a wall. Hampered by a stray "null", a clipped new panel and an inert trace. |
| 3 | Lattice | 7.0 | Clearest attribution banner of the five ("ADDED by agent"), but the generic design-system look is what the brief warns against. |
| 4 | Folio | 6.5 | Distinctive editorial identity and a strong dateline, but the core bar chart draws no bars and the new panel is clipped. |
| 5 | Strata | 5.5 | Good "rise and tab" motion idea, but soft SaaS-template surfaces, duplicated "nullnull", empty phone charts and a muddy floating trace. |

## Prototype notes

### 1. Meridian (8.5)

Strengths
- Typographic hierarchy is the strongest of the five. The "Ops board" title, small tracked capitals for labels, and tabular KPI numerals (`4,637`, `612`) read immediately on the 1280 desktop shot (`meridian-desktop.png`).
- Colour discipline is exact. The page is near-monochrome and the vermilion accent appears only on the live dot, the trace rule and the attribution. Black bars on paper look like a bank report.
- The trace is a real instrument in `meridian-live-full.png`. The newest card is large (`#14` at display size, a solid `LIVE` tag, actor, DASHBOARD line, rule chip), and the older card drops to dimmer grey. Newest-first hierarchy is clear from across a room.
- Attribution is legible: a full-width solid red strip reading "#13 Added by agent claude-code" sits on the new panel's top rule in `meridian-live-full.png`.
- Phone (`meridian-phone.png`) is well handled: panels stack in reading order, KPI numerals stay huge, and the trace collapses to a single bottom bar with a "Show recent" control.
- Wall (`meridian-wall.png`) scales cleanly; the root-size approach holds up.

Weaknesses
- In the live-full capture the new "Orders by carrier" panel is too short for its bar chart. Category labels collide ("Meridian" over "Crane", "Swift", "Harbor") and the value labels (960, 956, 923, 905) overlap each other and the axis. Compare Strata's new bar panel, which has no collisions.
- Times are local, without a zone label: panels say "As of 08:30:00" while the data is 14:30 UTC. This matters for an audience that reads the trace clock against source data. Nocturne and Folio label UTC explicitly.
- Heatmap in grey tones (`meridian-desktop.png`) carries the breach only through hatch and a single red text line. That meets the brief, but it is the weakest part of the page visually; the 406.5 cell and the 759.9 cell are not easy to tell apart at a glance.
- The masthead "Live · seq 12" is a small red dot and text; on the wall it is the only live indicator and is undersized relative to the title.

Screenshot facts used: `meridian-live-full.png` shows the new panel with "#13 Added by agent claude-code", revision 7, 6 panels. `meridian-live.png` (about 2 s) still shows revision 6 and 5 panels with trace head #14, so the board lags the trace.

### 2. Nocturne (7.5)

Strengths
- The dark console is calm and deliberately restrained. Surfaces are separated by luminance steps, and colour is rationed to cyan for live and a red outline plus hatch for the breach (`nocturne-desktop.png`, heatmap cell `759.9`).
- The breach has an explicit text row under the heatmap: "Above the limit of 600: EMEA / Crane" (`nocturne-live-full.png`). Text, glyph, hatch and outline together satisfy the no-colour-alone rule.
- The trace is the most legible across a room of the five at 1280. Sequence numbers are large mono (12, 11, 10, 9) and the tags are clear. "Times are UTC" is stated in the footer.
- The new-panel attribution is a small pill "Added · seq 13 agent:claude-code" on a cyan-ringed card (`nocturne-live-full.png`). The ring and pill are proportionate and the accent is not shouted.
- Wall (`nocturne-wall.png`) is the best of the five for a dim room: large KPI numerals, large bar labels, high contrast.

Weaknesses
- A stray "null" sits at the top right of the board header in every desktop, phone and wall shot. On a wall display that reads as a bug.
- The new bar panel is clipped in `nocturne-live-full.png`: the 1,000 and 500 tick labels are cut and the bars run off the bottom edge with the "As of" caption overprinted on them. The "Added" pill also sits over the kicker "BAR".
- The trace did not update in the live-full capture: the cards still read 12, 11, 10, 9 while the head counter reads 14. That contradicts the purpose of the trace, even though the head counter does move.
- The phone trace (`nocturne-phone.png`) crams three cards into a strip and truncates actor and node text ("agent:cla...", "//northwind/Dashboard..."). It reads as a log dump at this width.
- Dark is the default. This suits the brief's wall direction, but it is less "bank in daylight" than Meridian.

### 3. Lattice (7.0)

Strengths
- The clearest attribution moment of the five. In `lattice-live.png` and `lattice-live-full.png` a full-width solid blue band reads "ADDED by agent · claude-code · mcp · seq 13" on a blue-outlined panel. From a distance it is the one thing on screen that says "a robot did this".
- Trace is a horizontal rail of instrument cards, newest first, with a `LIVE` pill and icon, a large mono seq, actor, rule chip and node title. It is legible at 1280 and reasonably structured.
- Layout and density are professional. Panels are on a clean 12-column grid, the heatmap and table sit in a tidy bottom row, and the breach footnote is explicit ("1 above threshold 600: EMEA / Crane (759.9)").
- Light theme is clean and the phone view (`lattice-phone.png`) stacks in reading order with large KPI numerals.

Weaknesses
- It looks like a stock design system: flat blue primary, white cards on grey, standard tables. The brief explicitly says "no stock-template look", and this is the closest of the five to that failure.
- The bar fill is a loud saturated blue (`lattice-desktop.png`, bars about #0069E0). It dominates the page and fights the trace accent, so colour is not disciplined.
- Trace text truncates at 1920 (`lattice-wall.png` shows "agent · cla..." and "agen..."). The actor name, which is the attribution, is the first thing cut off.
- The trace did not update its cards in the live captures: they still show 12 first and the head reads 12 while the board is at revision 7.
- The new bar panel is short, and its axis labels ("600", "800") are clipped under the banner.
- The subtitle "ops-board · revision 6 · 5 panels" is grey and small; the header hierarchy is adequate but generic.

### 4. Folio (6.5)

Strengths
- The most distinctive identity. Serif headings and numerals, "FIG. 1 · INDICATOR" kickers, an italic dek, and a dateline ("Latest change #12 by agent:claude-code: /spec/layout/items/-") read like a printed briefing (`folio-desktop.png`). This is the strongest answer to "a briefing document that updates itself".
- The header dek is the best live narrative device of the five. It rewrites itself to "Latest change #14 by agent:claude-code" when an agent acts (`folio-live-full.png`).
- The change ledger is well designed: newest item large (`#14` at display size), a `LIVE` tag, and older items dimmer. The ledger's backfill of the last eight changes is visible on desktop.
- The new figure gets a vermilion margin rule and a kicker "FIG. 4 · ADDED BY AGENT:CLAUDE-CODE #14" (`folio-live-full.png`). It is editorially correct and restrained.
- Phone (`folio-phone.png`) is clean: the dek and figures stack, and the ledger shows one change with "Show all".

Weaknesses
- The bar chart draws axes and gridlines but no bars (`folio-desktop.png`, `folio-live.png`, `folio-wall.png`, `folio-live-full.png`, Fig. 3). This is the most important chart on the board, and its failure is the most visible defect in the set. It damages the credibility the design is built on.
- The new Fig. 4 panel is clipped by the ledger at 1280 (`folio-live-full.png`); only its title and the top of a short chart show. The attribution kicker is small and grey-red, so at a distance the "added" moment depends on the margin rule alone.
- In `folio-live.png` a ghost of the #13 ledger item is mid-transition and overlaps the #14 item and a vertical rule, which reads as a rendering glitch.
- Heatmap uses olive, cream and blue together (`folio-live-full.png`), which dilutes the colour discipline the rest of the page sets up. The breach cell's blue hatch is less alarming than a red one would be.
- The serif-and-italic style is charming, but for a wall display of operations data the editorial dek and captions take space from the numbers.

### 5. Strata (5.5)

Strengths
- The arrival motion is well conceived: a new panel rises with a blue ring and a tab on its top edge reading "#13 Added by agent · claude-code" (`strata-live-full.png`). The tab is a clear, attributed cue and matches the brief's "rise, halo, label" idea.
- The new bar panel is the most legible of the new panels across all five: value labels above each bar (960, 956, 923, 905, 893) and clear category labels.
- Trace cards in `strata-live.png` and `strata-live-full.png` show `#14` and `#13` with `LIVE` pills and mono rule chips, with a clear newest-first order.
- Phone trace collapses to a single footer line with the audit status, which is tidy.

Weaknesses
- It reads as a generic modern SaaS template: pale blue-grey gradient canvas, rounded white cards with soft shadows, a blue primary. This is the "stock-template look" the brief rejects.
- "nullnull" appears at the top right of the board header in every desktop, phone and wall shot, and it is doubled ("nullnull") rather than just stray. This is the most conspicuous data-leak on screen.
- On the phone (`strata-phone.png`) the bar and heatmap panels show only empty grey tracks with no bars or cells; the charts did not render at 390 px. That is a functional gap as well as a visual one.
- KPI tiles (`strata-desktop.png`) are tall and mostly empty below the numeral, which wastes density on a wall.
- The translucent trace footer sits over scrolling content and in `strata-wall.png` renders as a blurred, muddy band; at 1920 the cards are not visible in the idle state.
- The desktop trace in the first shot reads "Waiting for changes" next to a blurred gradient, which looks unfinished rather than deliberate.

Screenshot facts used: `strata-live.png` shows trace cards #14 and #13 with the board at revision 6 (lag); `strata-live-full.png` shows the board at revision 7 with 6 panels. This differs from the coordinator's note that Strata did not add the panel. The board appears to add it after the trace has already updated.

## Cross-cutting observations

1. Coordinator ground truth versus the live-full captures. The coordinator reported that Meridian, Nocturne and Strata did not add the panel to the board, and that Lattice's trace did not update. The live-full captures show the new panel on the board for Meridian, Nocturne, Strata and Lattice, and the trace cards for Strata and Meridian updated. The two-second `*-live.png` captures show the board one revision behind the trace head. The lag is real, and the screenshots may have been taken at different moments, so this should be re-checked on a fresh run before anything is concluded about whether a panel was added.
2. Stray "null" text. Nocturne prints "null" and Strata prints "nullnull" at the top right of the board header. This is visible at every breakpoint.
3. New bar panels are too short. Meridian, Nocturne, Lattice and Folio all clip or collide labels in the new bar panel. Only Strata's new panel is clean. A minimum height that fits the axis and the category labels would fix all four.
4. Folio's bar chart draws no bars. The chart module is either not drawing rectangles or is mis-measuring its box. This is a rendering bug, not a design choice.
5. Strata's phone charts do not render. The bar and heatmap panels show empty tracks at 390 px.
6. Times. Meridian and Lattice show local time without a zone (08:30) against UTC data. Nocturne and Folio show UTC explicitly. The UTC label is the better practice.
7. Trace truncation at wall width. Lattice truncates the actor at 1920 px, which is the attribution. Keep actor names whole, or truncate the rule chip first.
8. Phone trace. Every prototype collapses the trace on phone; Meridian's "Show recent" bar and Strata's one-line footer are the cleanest. Nocturne's three-card strip is the weakest.

## Ideas to graft into the winner

- From Meridian: the accent-tinted solid tag with "#seq Added by agent <actor>" plus the accent rule drawn across the panel's top edge (the brief's "signal, never decoration" rule). Numbered panels (01, 02, ...) hidden from assistive tech, for presenters. A trace newest block at display size with older cards dimmed. Phone trace collapse to one line with a "Show recent" toggle.
- From Lattice: the full-width solid attribution band inside the panel ("ADDED by agent · actor · mcp · seq N") for the eight-second window. It is the most readable cause label of the five.
- From Nocturne: a text row under a breaching chart that spells out the threshold ("Above the limit of 600: EMEA / Crane"), a "Times are UTC" footer, and the large mono seq numerals in the trace.
- From Folio: the header dek that rewrites itself to the latest change ("Latest change #14 by agent:claude-code: /spec/layout/items/-"), the newest-largest ledger with backfill of the last eight changes, and the "Fig. N" kicker numbering with caption (source, rows, as-of).
- From Strata: the arrival tab on the panel's top edge ("#13 Added by agent"), the value labels on bars (which made its new bar panel the most legible), and the honest rise-and-halo motion limited to realtime events.
- General fixes whatever wins: a minimum height for chart panels that fits axes and category labels; no "null" strings in the header; UTC labelled on every timestamp; actor names kept whole in the trace at wall width; phone charts verified to render at 390 px.
