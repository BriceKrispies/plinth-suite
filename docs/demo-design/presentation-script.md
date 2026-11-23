# 20. Five-minute live demonstration script

Section 20 of the Plinth specification (`spec/README.md`, mission section 20). The beat order, names, identities, tool catalogue, images and commands are the canonical facts in `spec/README.md`. Amendments P1–P20 in `selection-rationale.md` are binding. Where this script decides something the README and amendments leave open, the decision is marked **[decision]** and listed in 20.9.

Labels: **Guarantee** = enforced and tested. **Target** = design goal, measured in rehearsal before it is claimed. Acceptance criteria are `AC-SCRIPT-<n>` (20.8).

---

## 20.0 Conventions

- **Times** are wall-clock seconds from **T0**, the moment the presenter starts the script with the presenter console (key `Space`, the virtual clock starts). Times in the beat headings are the canonical windows from the README beat table. **Guarantee:** the presenter console timer shows T0-relative seconds, and the rehearsal driver logs them.
- **Virtual clock.** Starts at 14:30:00 on the fixed virtual demo date `D`, and runs at **6x** from T0 (`clock.speed = 6`, README ruling 7), so the three-minute hold is about 30 s of wall time. Virtual 14:30 is the end of history. At T0+205 s the virtual time is about 14:50. "Last hour" in beat 2 therefore covers about 13:33–14:35 and contains the seeded 14:00–14:20 episode, so the step is visible on the line panel before the presenter asks about it.
- **Step budgets** are configuration inputs to the driver (not promised durations): a query step 12 s, a multi-call agent step 20 s, a stall after 8 s with no call in flight and an unmet predicate. These follow the revised proposal C.3 and the 8 s grace from proposal 02.
- **Trace ribbon tags:** `live` (the live agent made the call), `replay` (the recorded driver made it), `ui` (a human made it from a browser or phone), `system` (a platform evaluator made it, such as a rule firing). (README ruling 12 extends P4.) Session-state gestures (brushing, clicking a cell, switching a tab) appear in the ribbon in a distinct style, with no change sequence number.
- **Agent principal:** `agent:claude-code`, acting `on_behalf_of` `user:ops-lead`, inside the ceiling in D.5. Default target dashboard for writes that name none is `ops-board`, set in the MCP server configuration. **[decision]**
- **Idempotency keys:** `claude-code:s1:<beat>.<n>` for live calls. Replayed commits use `replay:<transcript>:<step>` (C.3).
- **Animation honesty (P2):** a panel materialises, a row leaves, or a tile updates only in response to a sequence-numbered change event or a user gesture. Each commit shows its change sequence in a corner chip.

---

## 20.1 Room layout

| Display | Content | Notes |
|---|---|---|
| **Room display A** (wide, the main screen) | **Ops board** on the left two-thirds, full height. **Exec view** top right, a single pane showing the Ops board as the EMEA lead sees it (README ruling 21). **Finance window** bottom right, small. **Trace ribbon** along the bottom, one row high, full width. | The Ops board is the wide window (README). Target resolution 3840×2160. |
| **Room display B** (terminal) | Claude Code terminal, full screen, large monospaced font, showing the typed prompts and the agent's replies. Plinth MCP server connected as `agent:claude-code`. | The prompts must be legible to the room. |
| **Presenter display 1** | Presenter console: virtual clock, driver mode (`live` / `replay`), step list with budgets, slack pool, F7 fault cue, F9 switch. | Not shown to the room. |
| **Presenter display 2** | Phone window at phone width (390 px frame), signed in as `user:ops-lead`. | **[decision]** The presenter turns display 2 toward the room at T0+235 s, for beats 9 and 10, so the tap is visible. The Ops board shows the same change for anyone who misses it. |

Identities on screen: Ops board = `user:ops-lead` (Maya Ortiz, presenter); Exec view = `user:emea-lead` (Jonas Becker); Finance window = `user:finance-analyst` (Priya Nair, seated at the Finance display, with her own session); Phone = `user:ops-lead`.

---

## 20.2 Pre-show checklist (summary)

1. `make up` finished with all readiness gates (`/readyz`) green on every service.
2. `make demo-reset` finished. The control store is restored from snapshot, the workspace points at the history manifest, and the virtual clock reads 14:30:00 and is paused.
3. `make rehearse` passed on this machine on the day of the show, with its report. The report lists the takeover rate per step (P18) and the pass rates for the 13 agent questions (claim 5).
4. The replay transcript is loaded and its result hashes match the rehearsal run (`replay_reproduces`).
5. `claude mcp list` shows the Plinth server connected as `agent:claude-code`, and `tools/list` returns the 15 tools.
6. The four identities are signed in, in four separate browser profiles. Presence badges show the three humans and the agent.
7. The Ops board has its three seeded panels (KPI tile `orders-delivered-1h`, table `open-workflows`, `audit` panel) and an empty rules strip.
8. F9 switch tested at a step boundary. F7 cue tested: it reaches the rule evaluator and the console shows the tick.
9. The slack pool reads 30 s on the console. The trace ribbon is visible on room display A, and shows `live` tags.
10. The Phone window is at 390 px width, with no horizontal scroll.

---

## 20.3 Run-time rules

- **Mode.** Each beat starts `live`. A beat becomes `replay`-by-default only if its measured takeover rate in rehearsal is above the pre-registered threshold (P18). **[decision: threshold 0.10 per step over at least 10 runs.]** The ribbon tags the calls accordingly, and the presenter's one-sentence disclosure (20.6) covers the tags.
- **Stall takeover.** The driver takes over at the next step boundary when any of these holds: a call exceeds its step budget; the same step returns an error twice; or the step's predicate is unmet with no call in flight for 8 s.
- **Takeover charge.** Each takeover is charged its 8 s grace to the slack pool, which is **30 s** and is shown on the console after each beat. The pool is not extra time: the beat windows are the canonical windows. When the pool reads 0, the remaining steps run on the driver path only, and the presenter drops optional lines. The finale window never moves.
- **Satisfaction, not state.** Each step has a predicate over current state. The driver skips satisfied steps and never inverts another principal's change (P10).
- **F7 fault cue.** Sent on the presenter control API, on a separate port with a separate credential. Applied at the next generator tick, which is recorded (tick duration 1 virtual second **[decision]**). If no cue acknowledgement arrives within 5 s of the step start, the driver issues the scripted cue at the recorded tick (C-W3). The fault cue is absent from the MCP tool list and from the agent's grants (P15).
- **F9 switch.** Live to replay, or back, at a step boundary. Nothing on the room display changes except the tags.

---

## 20.4 The beats

### Beat 1: 0–25 s. Three screens, one board

- **Screens before.** Room A: Ops board with three panels and presence badges for the three humans. The KPI tile shows its value at the paused clock. Exec view shows the Ops board as the EMEA lead sees it, scoped to EMEA by its existing grant. Finance window shows the finance board (five region rows). Phone shows the incident card placeholder ("no open incidents"). Ribbon: empty.
- **Presenter says.** "One operations board, in three windows. Every panel, rule and permission on it is a node in one document graph. The KPI is live from the order feed. Those badges are the people in the room. The agent I'm about to use is just another client, like this browser." *(Presenter presses Space at the first word.)*
- **Agent prompt typed.** None.
- **Expected MCP calls.** None. The live feed and realtime subscriptions produce ribbon rows tagged `system` only.
- **Visible result.** KPI tile ticks from the feed on room A and on the Exec view. Presence badges are live on all three windows. Ribbon shows no agent call.
- **Budget and satisfaction.** Window 25 s. Predicate: the feed watermark advances after T0 and the KPI value changes at least once.
- **Fallback.** If the feed stalls, the console shows the stall indicator and the presenter says the feed is catching up. The KPI shows its `as of` time, and the beat continues.
- **Transition.** "Let's ask it a question."

### Beat 2: 25–55 s. The first panel

- **Screens before.** Room A as in beat 1. Ribbon empty.
- **Presenter says.** "I'll ask it in plain English." (Then types.)
- **Agent prompt typed.** `Show p95 fulfilment latency by region for the last hour.`
- **Expected MCP calls, in order.**
  1. `schema.describe(kind="Source")`
  2. `source.list(domain="fulfilment", limit=20)`
  3. `query.run(query=<p95 latency by region, orders, last 1h, 1-minute buckets>, dry_run=true)`
  4. `query.run(query=<same>, limit=20)`
  5. `node.preview(kind="Panel", body=<line panel p95-by-region on ops-board>)`, which returns `preview_token`
  6. `node.commit(preview_token, idempotency_key="claude-code:s1:2.1")`
- **Visible result.** Ops board: a time-series line panel, one line per region, materialises at the right of the grid on the commit's sequence event, with a chip showing its change sequence. The EMEA line shows the 14:00–14:20 step from the seeded episode. Exec view: the same panel with only the EMEA series, from its existing grant (the inspector shows `policy_hash`, P17). Finance window: unchanged. Phone: unchanged. Ribbon: six `live` rows; the commit row shows its change sequence.
- **Budget and satisfaction.** Window 30 s. Query steps 12 s; the multi-call step 20 s. Predicate: a Panel on `ops-board` whose query groups orders by region and aggregates p95 latency over `placed_at` in the last hour, with visual `line`, placed in the `ops-board` layout, and a commit with `surface = mcp`, actor `agent:claude-code`, `on_behalf_of` `user:ops-lead`.
- **Fallback.** A stall or a second error on any call switches to replay at the step boundary (`F9` behaviour). The replay issues the same calls with recorded `as_of` values.
- **Transition.** "Is that normal? Let's ask why."

### Beat 3: 55–95 s. The negative control

- **Screens before.** Room A with the line panel. Ribbon with six rows.
- **Presenter says.** "Watch the red cell." (Then types.)
- **Agent prompt typed.** `Why did p95 jump at 14:05? Break it down by carrier, compare with yesterday, and check for config changes.`
- **Expected MCP calls, in order.**
  1. `query.run(query=<p95 by carrier and region, orders, 14:00–14:20 on D>)`
  2. `query.run(query=<same grouping, orders, 14:00–14:20 on D-1>)`: the negative control (P12)
  3. `query.run(query=<count of audit.changes filtered on virtual_at, 14:00–14:20 on D>)`, which returns 0
  4. `node.preview(kind="Dashboard", uri="ops-board", body=<adds panels carrier-heatmap (bound to parameter incident_window), control-heatmap (D-1 window), config-changes (KPI tile on audit.changes)>, parameter incident_window = 14:00–14:20 on D)`
  5. `node.commit(preview_token, idempotency_key="claude-code:s1:3.1")`
- **Visible result.** Ops board: `carrier-heatmap` with the EMEA × Crane cell red; `control-heatmap` beside it, flat; `config-changes` reads **0 changes in window**. Each heatmap prints the watermark read from its result (for example "data as of 14:20:59"). All three panels re-query together under the new parameter. Exec view: the same two heatmaps restricted to the EMEA row, so the red cell stays visible to Jonas. Finance window: unchanged. Phone: unchanged. Ribbon: five `live` rows.
- **Agent's sentence.** The agent may quote only numbers that are on screen (B-2).
- **Budget and satisfaction.** Window 40 s. Predicate: `ops-board` contains `carrier-heatmap` grouping orders by carrier and region under `incident_window`, `control-heatmap` on the D-1 window, and `config-changes` whose query on `audit.changes` returns 0 for the window. Each query result hash is recorded.
- **Fallback.** As beat 2. If the heatmap query exceeds 12 s, the driver takes the step, and the heatmap may appear with its watermark still loading.
- **Transition.** "Now let's turn that into an alert."

### Beat 4: 95–125 s. The rule

- **Screens before.** Room A with the heatmaps. Ribbon with eleven rows.
- **Presenter does, with no agent call.** Brushes the line chart across 14:00–14:20 (session state, distinct ribbon style, no revision). Clicks the red EMEA × Crane cell, which sets `region = EMEA` and `carrier = Crane` as session parameters.
- **Presenter says and types.** `Alert me if any region's p95 stays above 900 ms for three minutes.`
- **Expected MCP calls, in order.**
  1. `node.preview(kind="Rule", body=<query: query:p95-by-region; when: p95_latency_ms > 900; hold: 3m; on_fire: [action:notify-ops-channel]>)`, which returns the lineage, the declared effects (a `notify` to the internal `ops-channel` receiver, handler `notify`, `external: false`, permission `action:notify`), the owner `agent:claude-code`, `on_behalf_of` `user:ops-lead`, the effective principal, a backtest over the 30-day history in one-minute windows, and `preview_token`
  2. `node.commit(preview_token, idempotency_key="claude-code:s1:4.1")`
- **Visible result.** Rules strip on room A: a rule card in state `ok` with a backtest sparkline that has one mark, at 14:03 on `D`. Clicking the mark opens the query that produced it. Exec view and Finance window: unchanged.
- **Budget and satisfaction.** Window 30 s. Predicate: a Rule with query `p95-by-region`, `when: p95_latency_ms > 900`, `hold: 3m`, `on_fire: [action:notify-ops-channel]`, owner `agent:claude-code`, `on_behalf_of` `user:ops-lead`, state `ok`, and a stored backtest with exactly one firing.
- **Fallback.** A failing preview returns the typed error. One retry is allowed (`did_you_mean`). After that, the driver replays the step. A backtest that is slow beyond 12 s is shown with its progress from `notifications/progress`, and the step is pre-warmed in rehearsal.
- **Transition.** "Now the access question."

### Beat 5: 125–160 s. Grants, held for a person

- **Screens before.** Room A: Ops board on the left, Exec view top right showing the Ops board as the EMEA lead sees it. Finance window shows the finance board with five region rows, owned by Priya.
- **Presenter says.** Nothing before the prompt.
- **Agent prompt typed.** `Who can see the finance board? Let the EMEA lead see only EMEA rows.`
- **Expected MCP calls, in order.**
  1. `grant.check(resource="plinth://northwind/Dashboard/<finance-board uuid>", action="node:read", with_counts=true)`, returning the grants on the board and the caller's own row count
  2. `grant.check(resource="plinth://northwind/Dashboard/<finance-board uuid>", principal="user:emea-lead", action="node:read", proposed={row_predicate: "region = 'EMEA'"})`, returning the predicate check with no counts, since the agent receives no other-principal counts (03 section 8, P8). The before and after counts (5 and 1) are computed server-side for the approver.
  3. `node.preview(kind="Grant", body={resource: "plinth://northwind/Dashboard/<finance-board uuid>", principal: "user:emea-lead", action: "node:read", row_predicate: "region = 'EMEA'"})`, which returns `preview_token` with `decision: "approval"`, rule `R-GRANT`, and the owner
  4. `node.commit(preview_token, idempotency_key="claude-code:s1:5.1")`, which returns `{status: "pending_approval", approval_id, change_id}`
  5. `change.status(change_id)`, which returns `pending_approval` with no approver
  - *Human step:* Priya approves in the Finance window (**human budget 5 s**).
  6. `change.status(change_id)`, which returns `approved` with approver `user:finance-analyst`
- **Visible result.** Finance window: a grant card, "Proposed by agent:claude-code for user:ops-lead, rule R-GRANT, before 5 regions, after 1 region", with **Approve** and **Reject**. Approve is enabled only for `user:finance-analyst`. On room A the Ops board's copy of the card reads "Awaiting user:finance-analyst. You delegated this change, so you cannot approve it." (P7). After approval, the Exec view's finance panel loses its four non-EMEA rows in place, with no reload, on the approval's sequence event. The grant list gains the predicate. The inspector of the Exec view's finance panel shows `policy_hash` value A, and the Finance window's inspector shows value B (P17). The ribbon shows the approval as a `ui` row.
- **Budget and satisfaction.** Window 35 s. Predicate: a Grant node for `user:emea-lead` on `finance-board` with predicate `region = 'EMEA'`, a change with status `approved` and approver `user:finance-analyst`, the Exec view's finance panel with one row, and two different `policy_hash` values in the two inspectors.
- **Fallback.** If the agent tries to approve or force-apply its own grant, the ceiling returns `FORBIDDEN` naming `grant:write`, and the agent proposes instead. A proposal itself is held as `pending_approval`. If the Finance window is not reachable, the presenter uses the pre-signed `finance-analyst` profile on the Finance display, and the approval is still made by that identity.
- **Transition.** "The agent proposes. A person commits. Now two people edit the same panel."

### Beat 6: 160–190 s. The stale base

- **Screens before.** Room A: Ops board with the line panel, Exec view showing the Ops board, Finance window with the grant applied.
- **Presenter says.** "Read the p95 panel and hold until I say go." (Then types.)
- **Agent prompt typed.** `Read the p95 panel and hold until I say go.` **[decision: the revised prompt says "EMEA panel", but there is no EMEA panel; the line panel is p95-by-region.]**
- **Expected MCP calls, in order.**
  1. `node.get(uri=<p95-by-region panel>)`, which returns revision `r`
  2. `node.preview(kind="Panel", uri=<p95-by-region panel>, patch=[title → "Agent title", width → 8], base_revision=r)`, which returns `preview_token`. The agent reports "holding at revision r" and waits.
  - *Human step:* the presenter edits the title in the Ops board UI to "Fulfilment p95, live". This commits at revision `r+1` with surface `ui`.
  - *Presenter says:* "Go." The agent receives "Go." as its next prompt.
  3. `node.commit(preview_token, idempotency_key="claude-code:s1:6.1")` returns `CONFLICT`, with `conflicting_paths: ["/title"]`, `head_revision: r+1`, `head_values_at_paths: {"/title": "Fulfilment p95, live"}`, and `your_values_at_paths: {"/title": "Agent title"}`. The transaction rolls back and the token stays unconsumed.
  4. `node.get(uri=<same panel>)`, which returns `r+1`
  5. `node.preview(kind="Panel", uri=<same panel>, patch=[width → 8], base_revision=r+1)`, which returns a new token
  6. `node.commit(preview_token, idempotency_key="claude-code:s1:6.2")`, which returns `result_revision: r+2`
- **Visible result.** Ops board: a conflict banner naming `/title` and both authors (`user:ops-lead` at `r+1`, `agent:claude-code` at `r`). The presenter's title stays. The width change merges. Presence shows an agent cursor marker labelled `agent:claude-code`. Exec view: the title and width update in place. Finance window: unchanged. Phone: unchanged. Ribbon: six rows, with the `CONFLICT` row marked and the commit rows carrying change sequences.
- **Budget and satisfaction.** Window 30 s. Predicate: the panel's title equals the presenter's title, its width is 8, its revision is `r+2`, the ribbon holds a `CONFLICT` row whose `conflicting_paths` is `["/title"]`, and the token from call 2 is unconsumed after call 3.
- **Fallback.** If the agent does not report its revision within 8 s, the presenter repeats "hold", and the driver reads `node.get` at the step start. If the agent commits without re-reading, the rule still holds: the driver replays calls 4 to 6 from the transcript.
- **Transition.** "Now undo the grant."

### Beat 7: 190–205 s. Undo is the audit trail, applied backwards

- **Screens before.** Room A: Ops board with its audit panel showing the grant change and the title change.
- **Presenter does.** Clicks **Undo** on the grant row in the Ops board's audit panel. No prompt, no MCP call.
- **Expected calls.** The UI sends one HTTP change with `undo_of` set to the grant's change sequence and surface `ui`. Under rule `R-GRANT-UNDO` it is auto after preview for holders of `grant:write` on the resource, with no second approval (see 20.9). It is audited as `grant.widened` with `undo_of`, and notified.
- **Visible result.** Exec view's finance panel regains its four rows in place. Finance window's grant card reads "undone by user:ops-lead, linked to change N". The Ops board audit panel shows two linked rows. Ribbon: one `ui` row.
- **Budget and satisfaction.** Window 15 s. Predicate: a change with `undo_of` equal to the grant's sequence exists, and the Exec view's finance panel has five rows.
- **Fallback.** If the undo returns an error, the driver issues the same undo from the transcript as surface `driver`, with the ribbon tag `replay`.
- **Transition.** "Now I'll break something, and watch what happens."

### Beat 8: 205–235 s. A fault nobody asked the agent to watch

- **Screens before.** Room A with the Ops board, the Exec view, the Finance window and the trace ribbon. The rule `p95-regional-breach` is in state `ok`. The agent is idle.
- **Presenter does.** Presses **F7** on presenter display 1. The cue goes to the presenter control API.
- **Presenter says.** "Nobody asked the agent to watch for this."
- **Expected calls.** None from the agent. The rule evaluator (platform code) and the workflow runner produce `system` rows.
- **Visible result.** At the next generator tick (recorded on the console), the EMEA × Crane fault profile begins its ramp. The rule's state chip moves `ok` → `pending`, then `firing` with a `firing_id`, after the 3-minute hold (about 30 s of wall time at 6x). A toast with the workflow link appears on all four windows. A workflow card appears on the Ops board's `open-workflows` table in state `open`, with a one-line transition history. Phone: the incident card appears in state `open`. Ribbon: `system` rows for the cue, the pending and firing transitions, and the workflow instance creation.
- **Budget and satisfaction.** Window 30 s. Predicate: rule `p95-regional-breach` in state `firing` with a `firing_id`; one workflow instance in state `open`; the toast has appeared on all four windows.
- **Fallback.** If no tick is recorded within 5 s, the driver issues the scripted cue at the recorded tick. If the rule is still `pending` 10 s after the firing is expected, the console's stall indicator shows; the presenter says the feed is catching up, and the driver replays the recorded fault tick, which produces the same events (C.3).
- **Transition.** "Let's build the response."

### Beat 9: 235–258 s. The response is composed

- **Screens before.** Presenter display 2 is turned toward the room at 235 s. The Phone shows the incident card in state `open`. Room A shows the workflow card.
- **Presenter says.** Nothing before the prompt.
- **Agent prompt typed.** `Build an acknowledge form on the incident card with a note field, and a timeline of its state changes.`
- **Expected MCP calls, in order.**
  1. `schema.describe(kind="Form")`
  2. `query.run(query={from: source:workflow.instances, limit: 3})`, to learn the fields
  3. `node.preview(kind="Form", body=<source workflow.instances, instance parameter, field note: text, action workflow.acknowledge (effect: a change on the instance; permission workflow:acknowledge), placed on the incident card>)`, which returns `preview_token`
  4. `node.commit(preview_token, idempotency_key="claude-code:s1:9.1")`, under rule `R-FORM-CREATE`
  5. `node.preview(kind="Panel", body=<timeline bound to workflow.transitions, filtered by the instance parameter, on ops-board>)`
  6. `node.commit(preview_token, idempotency_key="claude-code:s1:9.2")`
- **Visible result.** Phone: the incident card gains a note field, an **Acknowledge** button and a timeline. Room A: the timeline panel materialises on the Ops board. Exec view: the timeline panel appears with the EMEA rows. Finance window: unchanged. Ribbon: six `live` rows.
- **Budget and satisfaction.** Window 23 s. Multi-call budget 20 s. Predicate: a Form on `workflow.instances` that declares `workflow.acknowledge` with its effect and permission, a timeline panel on `workflow.transitions` with the instance parameter, both on `ops-board`, and the Phone renders the form.
- **Fallback.** An `UNKNOWN_FIELD` error is retried once from `did_you_mean`. A second error on this step, or a stall, switches to replay from call 3.
- **Transition.** "Acknowledge it from the phone."

### Beat 10: 258–268 s. Write-back

- **Screens before.** Phone with the form and the timeline. Room A with the timeline panel.
- **Presenter does.** Types the note "Crane handoff, EMEA" in the Phone's note field, and taps **Acknowledge**. No agent call.
- **Expected calls.** One HTTP change from the UI with surface `ui`. The workflow transition to `acknowledged` is a `system` row in the ribbon.
- **Visible result.** The workflow state reads `acknowledged` on the Phone, the Ops board, the Exec view and the Finance window, within the realtime target (Target: under 2 s). The timeline shows the transition with the actor name "Maya Ortiz (user:ops-lead)". The audit row reads actor `user:ops-lead`, surface `ui`.
- **Budget and satisfaction.** Window 10 s. Predicate: a transition row with `to_state = acknowledged`, actor `user:ops-lead`, surface `ui`.
- **Fallback.** If the Phone fails, the presenter taps the same Acknowledge on the Ops board's card, which is the same Form in the same browser surface `ui`. The acknowledge is always performed live and is never replayed on takeover, so the audit row stays a human row.
- **Transition.** "Now ask it what this touched."

### Beat 11: 268–300 s. The finale: blast radius

- **Screens before.** Three room screens in their current state. Room A: Ops board with its timeline and workflow card.
- **Presenter says.** Nothing before the prompt.
- **Agent prompt typed.** `What did this incident touch? Build it.`
- **Expected MCP calls, in order.**
  1. `query.run(query={from: source:lineage.edges, where: [{field: from_uri, op: eq, value: "<orders URI>"}, {field: from_field, op: eq, value: "fulfilled_at"}, {field: edge_type, op: in, value: ["reads_field", "filters_on", "aggregates"]}], limit: 50})`, following the edges to dependents, returning three panels, the `ops-board` dashboard and the rule `p95-regional-breach`
  2. `query.run(query={from: source:lineage.edges, where: [{field: from_uri, op: eq, value: "<orders URI>"}, {field: from_field, op: eq, value: "region"}, {field: edge_type, op: in, value: ["reads_field", "filters_on", "aggregates"]}], limit: 50})`, following the edges to dependents, returning two grants that restrict `region`
  3. `query.run(query={from: source:orders, where: [{field: latency_ms, op: gt, value: "900"}, {field: placed_at, op: gte, value: "<cue tick>"}], group: [carrier], aggregate: {delayed: count()}})`
  4. `query.run(query={from: source:workflow.transitions, where: [{field: instance, op: eq, value: "<id>"}]})`, returning the acknowledgement by `user:ops-lead`
  5. `query.run(query={from: source:audit.changes, where: [{field: virtual_at, op: gte, value: "<cue tick>"}], group: [surface, actor], aggregate: {changes: count()}})`
  6. `node.preview(kind="Dashboard", uri="ops-board", body=<adds a lineage graph panel over lineage.edges, a table panel with one row per dependent kind and per count, and a saved Query node behind each count>)`, which returns `preview_token`
  7. `node.commit(preview_token, idempotency_key="claude-code:s1:11.1")`
- **Visible result.** Room A, Ops board: an **Incident blast radius** lineage graph (node-link, ECharts graph series) with `orders.fulfilled_at` fanning out to three panels, one dashboard and one rule, and `orders.region` fanning out to two grants. Beside it, a table: panels 3, dashboards 1, rules 1, grants 2, delayed orders N across M carriers, the acknowledgement by `user:ops-lead`, and K audit changes. Each count opens its query. Exec view: the same graph with the counts limited to EMEA, which the panel says. Finance window: the two grants, one of them its own. Ribbon: seven `live` rows, the commit row with its change sequence.
- **Budget and satisfaction.** Window 32 s. Multi-call budget 20 s. Predicate: `ops-board` contains a panel with visual `lineage_graph` over `lineage.edges`, and a table panel whose queries reference `lineage.edges`, `orders`, `audit.changes` and `workflow.transitions`. Its counts equal the reference counts, computed from the seed by the rehearsal (AC-SCRIPT-13).
- **Fallback.** Queries 1 to 5 are pre-warmed in rehearsal. If the live path has not committed by T0+290 s, the driver replays calls 6 and 7 from the transcript, tagged `replay`. If the predicate is not met at T0+300 s, the presenter goes to the closing line and says the finale ran from the recorded transcript.
- **Closing line.** "Every panel on those screens is a document the agent wrote through one path, and every line of it is in the audit log."

---

## 20.5 Summary table

| # | Window (s) | Mode default | Window budget (s) | Agent calls | Human steps | Predicate |
|---|---|---|---|---|---|---|
| 1 | 0–25 | none | 25 | 0 | Space at T0 | KPI changes after T0 |
| 2 | 25–55 | live | 30 | 6 | none | line panel on `ops-board` |
| 3 | 55–95 | live | 40 | 5 | none | heatmap pair and 0-change KPI |
| 4 | 95–125 | live | 30 | 2 | brush, click | rule `ok`, one backtest firing |
| 5 | 125–160 | live | 35 | 6 | Priya approves (5 s) | grant approved, rows removed |
| 6 | 160–190 | live | 30 | 6 | title edit | revision `r+2`, `CONFLICT` row |
| 7 | 190–205 | none | 15 | 0 | Undo | `undo_of` change, 5 rows |
| 8 | 205–235 | none | 30 | 0 | F7 | rule `firing`, workflow `open` |
| 9 | 235–258 | live | 23 | 6 | none | form and timeline committed |
| 10 | 258–268 | none | 10 | 0 | note and tap | transition `acknowledged` |
| 11 | 268–300 | live | 32 | 7 | none | blast-radius counts match |

The beat windows sum to 300 s, the hard maximum (P19). Beat 7 and beat 8 use no agent call, so their window is not a takeover risk.

---

## 20.6 Disclosure and closing

**Trace ribbon disclosure (one sentence, rehearsed):** "Each line on this ribbon is a real call to the platform, and the tag says whether the live agent or the recorded driver made it, and the audit rows are the same either way."

**Closing line:** "Every panel on those screens is a document the agent wrote through one path, and every line of it is in the audit log."

---

## 20.7 Properties

| Property | Label | Evidence |
|---|---|---|
| Every agent write is preview then commit, with a token | Guarantee | `preview_is_commit`, `token_single_use_concurrent` |
| The agent cannot commit a grant without a person's approval | Guarantee | `agent_rule_notify`, the Grant proposal test, `FORBIDDEN` test |
| The 14:05 episode is in history and the rule fires once | Guarantee | `episode_in_history`, `backtest_fires_once` |
| Row security holds on every path, including the Exec view | Guarantee | `rls_differential`, `cache_isolation` |
| Replay reproduces every beat's result hashes | Guarantee | `replay_reproduces` (local and staging) |
| Commit to every screen within 300 ms p95 on one host | Target | Rehearsal harness |
| The live agent completes each beat inside its window | Target | Takeover rates in the rehearsal report (P18) |
| The 14:05 breach gets a firing on the live run within the beat-8 window | Target | Rehearsal, measured |
| The reset completes within the design target of 20 s | Target | `make demo-reset` timing in rehearsal |

---

## 20.8 Acceptance criteria

- **AC-SCRIPT-01** The beat table in 20.5 matches the README table exactly (names, order, windows). Checked by a script that parses both.
- **AC-SCRIPT-02** Each beat's prompt is typed verbatim from 20.4, and no prompt contains Plinth internals.
- **AC-SCRIPT-03** A beat passes only when its predicate holds before the next beat starts. The rehearsal asserts each predicate and logs its result.
- **AC-SCRIPT-04** The trace ribbon shows each MCP call and API change with its tag, and its row count equals the count of agent calls in the audit log plus the UI changes.
- **AC-SCRIPT-05** Beat 2: the Exec view's line panel shows only the EMEA series (`rls_differential`).
- **AC-SCRIPT-06** Beat 3: the control heatmap has no cell over the threshold, and the `config-changes` KPI equals the row count of the `audit.changes` query.
- **AC-SCRIPT-07** Beat 4: the backtest records exactly one firing (`backtest_fires_once`).
- **AC-SCRIPT-08** Beat 5: the agent's grant commit returns `pending_approval`. `user:ops-lead`'s approve action is refused with `FORBIDDEN`. The grant takes effect only after the approval.
- **AC-SCRIPT-09** Beat 6: the `CONFLICT` names `/title`, the token from call 2 is unconsumed after the conflict, and the final revision is `r+2`.
- **AC-SCRIPT-10** Beat 7: the undo change carries `undo_of`, and the audit log holds both rows linked.
- **AC-SCRIPT-11** Beat 8: the fault cue is refused on the MCP surface and absent from the tool list (P15). The rule reaches `firing` before the beat-8 window ends in 10 of 10 replayed runs.
- **AC-SCRIPT-12** Beats 9 and 10: the audit row for the acknowledgement reads `user:ops-lead`, surface `ui`.
- **AC-SCRIPT-13** Beat 11: the blast-radius counts equal the reference counts from the seed, and every count opens its query.
- **AC-SCRIPT-14** No animation occurs without a sequence-numbered event or a user gesture (P2). A test fails the build otherwise.
- **AC-SCRIPT-15** Every free-text field on screen that comes from data is returned inside `untrusted` to the agent (P14). The seeded injection annotation is in the rehearsal set.
- **AC-SCRIPT-16** The takeover rate is measured per step over at least 10 runs, and any step above the threshold is replay-by-default (P18).
- **AC-SCRIPT-17** An F9 switch at a step boundary changes only the tags in the ribbon (rehearsal diff of the room display).
- **AC-SCRIPT-18** The F7 cue is applied at a recorded tick within 5 s, or the scripted cue is applied at the recorded tick.
- **AC-SCRIPT-19** The full script on replay ends by T0+300 s in 10 of 10 rehearsal runs. The pool never goes below 0 in the rehearsal.
- **AC-SCRIPT-20** `make demo-reset` restores the state, and a rehearsal run after reset reproduces the result hashes of the previous run.

---

## 20.9 Decisions and open points

1. Clock rate 6x (`clock.speed = 6`, README ruling 7). The three-minute hold is about 30 s of wall time and lands in beat 8.
2. Fifteen tools, with `change.status` (README and P11). The revised proposal's fourteen is superseded.
3. Beat 2's panel is a time-series line (README, P1), not a bar.
4. Beat 3's control window is yesterday 14:00–14:20 (README, P12), not the revised 13:00–14:00 baseline.
5. The Exec view is a single pane showing the Ops board as the EMEA lead sees it (README ruling 21). The grant beat's row loss is shown in that pane's finance panel, the finance board as the EMEA lead sees it.
6. Priya approves at the Finance display with her own session. Separation of duties is enforced by identity, not by who clicks.
7. P8 and beat 5 are reconciled by `grant:inspect` (README ruling 1). The agent ceiling holds `grant:inspect`, which allows checks and counts on other principals, and never holds `grant:write` or `approval:decide` (03 section 5.3). The agent receives no other-principal counts (beat 5 call 2). The before and after counts go to the approver.
8. An agent's grant commit is a proposal held under `R-GRANT`, and it returns `pending_approval` with `approval_id` (README ruling 2). `FORBIDDEN` naming `grant:write` is returned only for an attempt to approve or force-apply a grant.
9. A human's undo of an approved grant commits under `R-GRANT-UNDO` (03 sections 6 and 7.4; README ruling 4): auto after preview for holders of `grant:write` on the resource, with no second approval, audited as `grant.widened` and notified. The alternative needs Priya's approval and adds a beat of human time.
10. The `ops-channel` receiver is an internal `notify` action (`external: false`, README ruling 19), so `R-ACTION-EXTERNAL` does not apply to the rule (`R-RULE-CREATE` applies).
11. Commit order: the merge rule (`CONFLICT`) is evaluated before the token base check. `PREVIEW_STALE` applies when a rebase would change the change hash. A `CONFLICT` rolls back and leaves the token unconsumed. D.6 and D.8 read differently on this point.
12. Beat 6's prompt says "p95 panel", not "EMEA panel", because no EMEA panel exists.
13. Beat 6 previews during the hold, so the token's base is `r`.
14. The form declares `workflow.acknowledge`, but the submitting human executes it. The agent's ceiling excludes `workflow:acknowledge`.
15. The ribbon tags are `live`, `replay`, `ui` and `system`, which extends P4.
16. Beat 11 needs a lineage graph (README, P1). Revised B-proposal finale was a table only.
17. The finale uses `query.run` over `lineage.edges`. No separate `lineage.dependents` tool exists in the catalogue.
18. The takeover threshold is 0.10 per step over at least 10 runs. P18 leaves the number open.
19. The slack pool is 30 s, from proposal 02. It is not extra time, and when it is exhausted the remaining steps run on the driver path.
20. The stall rule combines the 8 s no-call grace (proposal 02), the step budgets of 12 s and 20 s (revised C.3), and the two-error rule.
21. The virtual "yesterday" is `D-1`, where `D` is a seed configuration constant.
22. Turning presenter display 2 toward the room at 235 s is a physical step.
23. The live fault's ramp and threshold parameters are not fixed. The seeded episode parameters in the history are the reference, and `09-demo-operations.md` and `05-backend-persistence-realtime.md` must set the live profile to the same values.
24. The Ops board's seeded panels are the KPI tile, the open-workflows table and the audit panel.

---

## 20.10 Word count

About 5,700 words by `wc -w`, which counts table markup. The prose alone is nearer 5,000.
