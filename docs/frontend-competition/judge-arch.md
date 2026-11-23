# Frontend architecture review: five Plinth prototypes

Lens: CSS architecture (layer order, tokens, container queries, `:has()`, logical properties, OKLCH and `color-mix()`, nesting, `!important` placement) and JS quality (module shape, escaping, state, reconnect with `since_seq`, render efficiency, handling of realtime board updates). The observed live-moment failures are weighted heavily.

Scope of evidence: the CSS and JS files of all five prototypes were read in the places listed below, and the five `*-live-full.png` screenshots were viewed. Phone and wall screenshots were not reviewed for this lens. Nothing was run, so every runtime claim below is either the coordinator's observation or an inference from reading the code.

## Cross-cutting findings

1. **Every prototype reloads the whole board on each change.** A realtime event triggers a full refetch: the dashboard node, the panel list, and a query for every panel. Examples: `meridian/js/board.js` `loadBoard` (lines 27-44, `runQuery` for all panels), `nocturne/js/board-view.js` `refresh` (lines 114-125, `hydrate` for all panels), `strata/js/dashboard-view.js` `refresh` (lines 172-191) and `strata/js/board.js` `loadBoard`. Folio `view-board.js` `refresh` does the same, with a busy/queued coalescer. Only `changed` panels need a query. This is the most likely reason the 2-second snapshot shows panels still lagging. Each refresh is O(panels) network work, and the wait grows with panel count, which is the wall-display case.
2. **Panel repaint is decided by fingerprint, which is good.** Meridian `board.js` `signature()`, Strata `board.js` `panelKey()`, Folio `view-board.js` `revision` diff and Nocturne `attributeCauses` all avoid repainting untouched panels. Strata's `panelKey` runs `JSON.stringify(rows)` for every panel on every refresh, which is avoidable work.
3. **Animation honesty is implemented in all five.** A cause is attributed only when the event set explains a visible change, and backfill is flagged separately. Each prototype does this with a different mechanism. The implementations are consistent with the brief.
4. **Escaping.** Every prototype builds DOM through a small `h()` helper that uses `createElement` and text nodes. No prototype interpolates untrusted data into `innerHTML`. Folio, Lattice and Meridian each have one `innerHTML` match, which is a comment in `dom.js`. Nocturne's `dom.js` states the rule explicitly.
5. **Layers.** All five declare `@layer reset, tokens, base, layout, components, utilities, overrides` once. Folio also wraps each file in its own `@layer` block, which is valid. `!important` appears only in the overrides layer (or in `overrides.css` as the sole reduced-motion or hidden rule) in all five.

## Per-prototype review

### Meridian (`packages/web/public/proto/meridian/`)

Strengths
- `styles.css:5` declares the layer order once. `overrides.css` holds the only `!important`s (hidden state, reduced motion).
- `rt.js` puts `try` only around `JSON.parse` (lines 22-29) and sends `since_seq: through` on resume (line 39). Downstream exceptions cannot silently skip an event.
- `dashboard.js` `refresh` uses an `inflight`/`again` loop, which coalesces bursts. `apply()` reconciles panels by slug and reorders only when needed, and it sets position through CSS custom properties (`--x`, `--y`, `--w`, `--h`). That keeps the layout in CSS and off the JS path.
- The announcer (`main.js`) uses a 60 ms clear-then-set beat so repeated messages re-announce.
- Approximately 32 `light-dark()` or `color-mix()` uses and 9 `clamp()` values in CSS. Logical properties are used throughout.

Weaknesses
- Time is rendered in local time via `format.js:20-22` (`getHours`), while the data is UTC. This was observed (08:30 against 14:30). The fix is to format in UTC and label the zone.
- The 2-second snapshot did not show the new panel; the full-page capture does. The cause is the full reload above, not a missing handler.
- Only one container query in the whole stylesheet. Panels are sized mostly by viewport media queries, so the wall and phone layouts depend on breakpoints rather than on panel width.

Score: 7.1

### Nocturne (`packages/web/public/proto/nocturne/`)

Strengths
- The most thorough CSS of the five: about 133 nesting uses, 51 `light-dark()`/`color-mix()`/`oklch` uses, 4 container-query uses, and 5 `:has()` uses. `tokens.css` documents the surface-elevation strategy and keeps every pair above 4.5:1.
- `realtime.js` resumes with `since_seq` and sends a `backfill` flag from `seq <= firstHead`.
- `board-view.js` has a reentrancy guard. Events are queued into `pending` and `schedule()` is called again in `finally` (lines 136-138), so a burst is not dropped.
- `resync` runs after reconnect (line 155).
- Transient `UNREACHABLE` keeps the previous panel result rather than flashing an error (line 118).

Weaknesses
- The live moment failed in the 2-second snapshot: neither the trace nor the board updated, while the head counter did. The full-page capture (`nocturne-live-full.png`) shows the panel added with a "Added · seq 13" pill, so this is latency rather than a dropped event, but the code gives no visible signal that a refresh is pending.
- Stray text: `null` in the top right (`nocturne-live-full.png`). `board-view.js` line 36 calls `setHeading("Board not found", null)`, which passes a null dashboard into the heading meta. The heading code does not guard that argument. The fix is to render the meta only when the dashboard object exists.
- `overrides.css:54,66` uses `!important` for forced-colours handling. That is allowed by the rule, but it means the forced-colours path depends on overriding everything earlier.

Score: 6.2

### Folio (`packages/web/public/proto/folio/`)

Strengths
- Best realtime shape of the five. `realtime.js` tracks `through` across reconnects and keeps a `ceiling` for the first welcome. It flags a gap using `prev_through > through` and passes `gap` into `onEvents`, so a missed range triggers a refresh. Backfill events never animate.
- `view-board.js` `reconcile()` attributes changes by `revision` diff, picks the newest event touching the panel's node with `causeFrom`, and records the cause on the panel with a kicker and margin rule. That matches the live-moment screenshot: "ADDED BY AGENT:CLAUDE-CODE #14".
- Announcements are built once per refresh and sent through `announce()`.
- Every CSS file wraps its rules in a named layer (`css/*.css`, first line `@layer X {`), and `styles.css` imports them in layer order. That is the cleanest use of the layer model in the set.
- Roughly 40 colour-function uses, 3 container queries, 4 `:has()` uses, and `forced-colors` handling in 4 places.

Weaknesses
- The bar chart draws axes and no bars (`folio-live-full.png`). The geometry is in `js/charts/bar.js` `rectFor` (lines 79-86) and the `vs` scale (line 72). The CSS only sets `fill` and `stroke` (`charts.css:17-18`), so the bug is in the JS path that computes the bar rectangles. The axis-label overlap on the new panel is the same chart at small height.
- Each event still runs every panel query (see cross-cutting finding 1). The queue only coalesces overlapping refreshes.
- The trace overlay is `position: fixed` and covers the lower board in the full-page capture. This is a layout issue, not a JS one, but it hides board content during a live moment.

Score: 7.6

### Lattice (`packages/web/public/proto/lattice/`)

Strengths
- Uses the most container queries (6) and 86 colour-function uses, and it handles `forced-colors` in 4 places.
- `trace.js` `tagOf()` derives the live/replay/ui tag from transport (`surface`, actor prefix), not from timing, as the brief requires. `insert()` places events by seq, so late arrivals sort correctly.
- `addSession()` marks local, uncommitted actions separately from committed events.
- The live-moment board shows a clear, attributed "ADDED by agent · claude-code · mcp · seq 13" banner with a highlight, which is the best in-panel attribution of the five.
- Declared layer order in `styles.css:5`; `!important` only in `overrides.css`.

Weaknesses
- The trace stayed at seq 12 while the board showed seq 13. The code path does not obviously explain that. The strongest candidate is `realtime.js` lines 47-53: `handle()` runs inside a `try` whose only handler is `catch { /* ignore */ }`. Any exception thrown from `onEvents` and `trace.add` is discarded, and `through` has already been advanced, so the event is lost with no resync. This is the same failure shape as the stale trace, and it is also invisible to the console (which is why the run reported zero errors). The `try` should cover only `JSON.parse`, as Folio and Meridian do.
- `main.js` line 119-121 calls `trace.add` and then `view.onEvents` in one callback, so one trace exception would also stop the board update. Separate the two.
- The trace `head` is set from `welcome` and `progress` only (`main.js:118`), not from each `events` frame, so the displayed head can lag behind the newest row.

Score: 6.8

### Strata (`packages/web/public/proto/strata/`)

Strengths
- `realtime.js` line 19 ignores frames from any socket that is no longer current (`if (socket !== ws) return;`), a useful guard against late frames from a dead connection.
- `dashboard-view.js` `render()` keeps controllers in a Map keyed by slug and inserts only the nodes that moved (line 135).
- `attributeCauses` in `board.js` attributes a cause only for panels whose key changed, and labels the cause `added` or `updated`.
- Roughly 64 colour-function uses, 4 `:has()` uses, `forced-colors` in 2 places, and logical properties throughout.

Weaknesses
- The live moment: the 2-second snapshot showed the trace updated but no new panel on the board. The full-page capture shows the panel added. Same latency pattern as the others, aggravated by the full reload (`dashboard-view.js` `refresh`).
- Stray text: "nullnull" at the top right of the board header (`strata-live-full.png`). I did not isolate the exact source. The text is two concatenated null values in the board metadata line, so the header assembly needs a null guard.
- `events` is a Map that grows for the life of the page (`dashboard-view.js` line 211). It should be pruned to the trace window.
- The deep-link path polls with `setInterval` every 100 ms for up to 10 s (`dashboard-view.js`, the `wait` block). Waiting on the board promise would be simpler.
- Six `!important`s in `overrides.css` are fine by the rule, but the layer is large relative to the rest.

Score: 6.4

## Ranking

1. Folio (7.6)
2. Meridian (7.1)
3. Lattice (6.8)
4. Strata (6.4)
5. Nocturne (6.2)

Folio ranks first on the realtime design (gap detection, backfill, cause attribution) and the cleanest layer use. Its broken bar geometry is a serious defect that the winner must not carry over. Meridian is the cleanest JS with the correct error scope. Lattice has the best in-panel attribution, but the swallowing `try` is a real correctness risk. Strata and Nocturne have good CSS and reasonable realtime code, and both had stray text and a visibly lagging board at 2 seconds.

## Ideas to graft into the winner

- Realtime: keep the `try` around `JSON.parse` only (Meridian `rt.js`), and keep Folio's `gap` flag and `ceiling`-based backfill split.
- Realtime: add a `socket !== ws` guard (Strata `realtime.js`), so a late frame cannot update state after a reconnect.
- Board updates: refetch only the nodes named in the event (`event.node`), not the whole board. Keep the full reload for reconnect and `gap` only.
- Board updates: keep the `signature()` or `panelKey()` fingerprint so untouched panels are never repainted, and drop the `JSON.stringify(rows)` in favour of the result hash.
- Attribution: Lattice's in-panel "ADDED by agent" banner, combined with Folio's kicker and margin rule, which is the clearest live cue in the set. Both should stay visible for several seconds and then retire.
- Trace: derive the tag from transport (Lattice `tagOf`), insert by seq (Lattice `insert`), and update the head from every `events` frame.
- Time: format in UTC with an explicit zone label (the observed local-time defect).
- CSS: Folio's per-file `@layer` blocks, Nocturne's token documentation and elevation scale, Meridian's custom-property placement for grid position, and container queries on panels rather than viewport breakpoints (only Folio, Lattice and Nocturne have them).
- Charts: fix the bar geometry path that drew axes without bars in Folio before reuse. Check that axis labels do not collide when the chart is small.
- Guard every header or meta string against null before rendering (Nocturne line 36, Strata header).
