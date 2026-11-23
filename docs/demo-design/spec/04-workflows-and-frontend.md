# Plinth specification 04: workflows and frontend

Covers mission sections 5 (complete user workflows) and 6 (frontend information architecture and interaction requirements). Design only; nothing here is built.

**Inputs, in precedence order.** `README.md` (canonical facts), `../selection-rationale.md` (amendments P1–P20), `../revised/04-emergent-composition.md` (base design, sections B, C, D.3–D.8, D.10, G.5), and `../revised/02-visual-spectacle.md` (grafted visual and interaction design: sections B rows P02, P06, V07, D09, D10, D12; C conventions and fallback; D.4, D.5, D.9, D.12).

**Labels.** **Guarantee** means enforced in code and covered by a named test. **Target** means a design goal that is measured in rehearsal before anyone claims it. Acceptance criteria are `AC-<area>-<n>`.

**Timing.** Beat times below are the README beat table. Revised 04 section C.2 uses a different 0–300 s grid; the README governs and the presentation script must follow it (decision list, item 1).

---

## 0. Conventions

### 0.1 Principals and windows

| Principal | Window or surface in the demo |
|---|---|
| `user:ops-lead` (Maya Ortiz) | Ops board (room, wide); Phone (presenter's second display, phone width) |
| `user:emea-lead` (Jonas Becker) | Exec view (room display) |
| `user:finance-analyst` (Priya Nair) | Finance window (room display, small); owner of the finance board |
| `agent:claude-code` | Claude Code terminal, acting `on_behalf_of` `user:ops-lead` |
| `service:replay-driver` | Fallback driver; no window |
| `service:rule-worker`, `service:ingest`, `service:gen` | Platform workloads; no window |

The presenter console is a separate origin with its own credential (P15). It is not a principal in the change log.

### 0.2 Commit rules (closed table, P6)

Every write is classified by exactly one row of the closed commit-rule table in `03-authorization-and-security.md` section 6, which is the only copy of that table (ruling 5). The rule id is shown on each commit card (section 6.10). The rule ids this document uses are:

- `R-PANEL-CREATE`, `R-PANEL-EDIT`, `R-RULE-CREATE` and `R-FORM-CREATE`: auto-commit after preview for an agent;
- `R-LAYOUT`: layout moves (`layout.items` paths);
- `R-GRANT`: approval required, held as `pending_approval` for an agent (section 5.4); approval needs `approval:decide` plus `grant:write` on the resource;
- `R-GRANT-UNDO`: undo of an approved Grant change, auto after preview for holders of `grant:write` on the resource, with no second approval, audited as `grant.widened` and notified (ruling 4; section 5.6);
- `R-ACTION-EXTERNAL`: approval, for a receiver that is not on the allowlist (decision 9);
- `R-UNDO-OWN`: undo of an agent's own Change;
- `R-DELETE-SESSION` and `R-DELETE-OTHER`: `node.delete`.

Human Changes that no row names (title edits, the workflow acknowledgement) are authorized by grants alone (03 section 6, scope) and carry no rule id.

### 0.3 Two kinds of state

**Documents** are nodes. Every write to a document is a Change with a base revision, a chain row and a sequence-numbered event (P2 and D.6). **Session state** is parameters, brushing, drill and open inspector tabs. It lives in the URL and the session record. It creates no revision, no chain row and no audit row (P3). Saving session state as a default is an explicit Change. Section 6.12 specifies the mechanism.

---

## 5. Complete user workflows

Each workflow lists its trigger, actors, steps, resulting state, errors and acceptance criteria. Steps name the real MCP tool from the README catalogue, the HTTP call or the UI action.

### 5.1 Human-only workflows

**WF-H1. Ops lead edits the Ops board in the UI.**
- Trigger: `user:ops-lead` opens `/b/ops-board` on the Ops board window.
- Steps:
  1. Drags a panel to a new grid position. The grid sends a Change with base revision `r`, ops on `/layout/items/<n>` and rule id `R-LAYOUT`. No preview is required for humans.
  2. Edits a panel title inline. The Change touches `/panels/<slug>/title` and, as a human title edit, carries no rule id (section 0.2).
  3. Brushes the time-series line panel or clicks a heatmap cell. The change is session state only: the URL changes, no request writes a document, and the ribbon shows the view change in the session style.
  4. Chooses "Save view as default". This is the only way session state becomes a document: an explicit Change to the Dashboard's parameter defaults.
- Result: each commit increments the node revision, appends one `changes` row with `surface = 'ui'`, and fans out to subscribed screens by sequence number.
- Errors: a stale base returns `CONFLICT` and the conflict card (WF-M2). Humans never see `PREVIEW_REQUIRED`.
- AC-WF-1 **Guarantee**: a human layout move produces exactly one Change row with `surface = 'ui'` and the rule id `R-LAYOUT` on its commit card.
- AC-WF-2 **Guarantee**: a brush or click that is not "Save view as default" produces zero rows in `changes`, `query_runs` excluded, and zero revision increments.

**WF-H2. Regional lead reads an EMEA-restricted view.**
- Trigger: `user:emea-lead` opens `/exec`.
- Steps: `authorize(user:emea-lead, read, ops-board, ctx)` returns `allow_with(row_predicate = region = 'EMEA', column_mask = ∅)`. The compiler attaches the predicate to the `orders` relation before any operator (D.4). The Exec view renders the panels with write affordances absent; the UI renders no edit controls for a principal without `node:write`.
- AC-WF-3 **Guarantee**: for the same panel, the Exec view row count equals the EMEA subset of the Ops board row count, and no non-EMEA row appears in the Exec view's result payload.
- AC-WF-4 **Guarantee**: with no `node:write` grant, no edit control is present in the DOM for an emea-lead session on any dashboard.

**WF-H3. Finance analyst reviews and approves.** Covered as the approval workflow in 5.4, because its approval step is the human half of a mixed flow.

### 5.2 Agent-only workflows

**WF-A1. Agent builds a panel from a question (beat 2).**
- Trigger: the presenter types a prompt in the Claude Code terminal. The prompt is the only human input.
- Steps:
  1. `schema.describe(kind="Source")` (budgeted, paged).
  2. `source.list(domain="fulfilment", limit=20)`.
  3. `query.run(query=…, dry_run=true)`: typecheck and plan, no execution.
  4. `query.run(query=…, limit=20)`: real result with `as_of`, watermark and `result_hash`.
  5. `node.preview(kind="Panel", …)`: returns `diff`, `lineage_delta`, `effects`, `owner`, `effective_principal` and `preview_token`.
  6. `node.commit(preview_token, idempotency_key="claude-code:<session>:<n>")`.
- Result: a line panel materialises on the Ops board. The Exec view shows the same panel restricted to EMEA. Each commit card reads `R-PANEL-CREATE`.
- Errors the agent can receive and recover from in one retry: `UNKNOWN_FIELD` (with `did_you_mean`), `UNKNOWN_REFERENCE` (with the list of sources), `PREVIEW_STALE`.
- AC-WF-5 **Guarantee**: `node.commit` without a `preview_token` returns `PREVIEW_REQUIRED` for `agent:claude-code` and writes no row.
- AC-WF-6 **Guarantee**: the change hash of the committed Change equals the hash in the preview (test `preview_is_commit`, revised 04 F claim 3).

**WF-A2. Agent answers an interrogation with a composed panel (beat 3).**
- Steps: `query.run` on `orders` for `incident_window` grouped by carrier and region; the same query for the control window (P12, yesterday 14:00–14:20); `query.run` on `audit.changes` for the incident window, which returns zero rows and is reported as `row_count: 0`; `node.preview(kind="Dashboard", …)` adding a heatmap panel bound to parameter `incident_window`; `node.commit`.
- The agent's prose may quote only numbers that are on screen in the same window (revised 04 B-2).
- AC-WF-7 **Guarantee**: the audit panel shows the text "0 changes in window" when and only when the `audit.changes` count query returns zero rows for that window.

**WF-A3. Agent is refused and loops are cut.**
- A `node.commit` on a Grant by the agent is not refused by the commit path. It is held as `pending_approval` (WF-A4 and 5.4). A direct Grant write without preview returns `PREVIEW_REQUIRED`. `FORBIDDEN` naming `permission: "grant:write"` is returned only for an agent attempt to approve or force-apply a Grant (ruling 2).
- The fourth identical refused call returns `LOOP_SUSPECTED` and is not executed (ruling 9). The fallback driver takes over after two errors on one step (section 5.8).
- AC-WF-8 **Guarantee**: the agent principal's ceiling excludes `grant:write` and `workflow:acknowledge`; a test asserts that each `FORBIDDEN` response names its permission.
- AC-WF-9 **Guarantee**: the fourth identical refused call returns `LOOP_SUSPECTED`, is not executed, and its `next` hint points to `schema.describe`.

**WF-A4. Agent proposes a grant (held, not written).** Covered in 5.4.

### 5.3 Mixed workflows: human and agent on one dashboard

**WF-M1. Co-presence on the Ops board.**
- Both `user:ops-lead` (Ops board session) and `agent:claude-code` subscribe to the Ops board node. The agent appears as a labelled participant (section 6.11). Presence is non-authoritative: a lost Redis message removes a badge and changes no data.
- AC-WF-10 **Guarantee**: the agent's presence entry appears within the presence throttle window after its first `node.get` on the Ops board.

**WF-M2. Stale-base conflict (beat 6).** The presenter edits a title while the agent holds an older revision. This is the sequence the stage shows.
1. The agent calls `node.get(uri=ops-board)` and reports revision `r`. It then waits for the presenter's word.
2. The presenter edits the EMEA panel title in the Ops board UI. The Change has base `r`, is applied, and the head becomes `r+1` with surface `ui`.
3. On the presenter's word, the agent submits one Change with base `r`, ops `/panels/<emea>/title` and `/layout/items/<emea>/w`, after `node.preview`.
4. The engine computes the paths touched by the Change (`{title, width}`) and the paths touched by changes between `r` and `r+1` (`{title}`). The intersection is `{title}`, so the whole Change is rejected. Nothing is applied: the Change is all-or-nothing.
5. The response is `CONFLICT` with `{conflicting_paths: ["/panels/<emea>/title"], head_revision: r+1, head_values_at_paths: {…}, your_values_at_paths: {…}}`.
6. The agent calls `node.get` at `r+1`, drops the title op and previews the width op with base `r+1`. Base equals head, so the commit applies with no merge and produces revision `r+2`.
7. The Ops board shows a conflict banner naming both authors and the path. The presenter's title is kept.
- AC-WF-11 **Guarantee**: a Change whose paths intersect a later change's paths is rejected whole, with no partial application; the test `conflict_all_or_nothing` checks that the head revision and every node body are unchanged after `CONFLICT`.
- AC-WF-12 **Guarantee**: the `CONFLICT` payload names the exact conflicting JSON Pointer paths and carries head values at those paths.
- AC-WF-13 **Target**: the stage sequence reproduces in the Playwright rehearsal with the window waiting on the realtime sequence number (revised 04 S6 stale-base test).

**WF-M3. Two humans on one panel.** Two humans dragging the same panel produce one winner and one conflict card for the loser (revised 02 D.5). Two humans editing different panels never conflict.
- AC-WF-14 **Guarantee**: two concurrent layout Changes on disjoint `layout/items/<id>` paths both commit with no conflict card.

### 5.4 Approval workflow: the agent proposes a grant (beat 5)

- Trigger: the presenter asks who can see the finance board and asks to restrict emea-lead to EMEA rows.
- Actors: `agent:claude-code` (requester, on behalf of `user:ops-lead`), `user:finance-analyst` (approver, owner of the finance board), `user:ops-lead` (delegator, may not approve).

Steps:
1. `grant.check(resource=plinth://northwind/Dashboard/finance-board, action=node:read, with_counts=true)`: returns decision, predicate text, column mask, sources and `row_counts` for the caller's own view.
2. `grant.check(resource=plinth://northwind/Dashboard/finance-board, principal=emea-lead, proposed={row_predicate: "region = 'EMEA'"})`: returns `decision`, `predicate_text` and `sources`. Row counts for another principal require `grant:inspect` on a resource the delegator can administer (ruling 1); where that does not hold, they are withheld (decision 6). The before and after counts on the approval card are computed server-side for the approver, who owns the resource.
3. `node.preview(kind="Grant", …)` returns a `preview_token`. `node.commit` creates a Change that is **held** under `R-GRANT`. The status is `pending_approval`. The agent cannot make the commit take effect.
4. `change.status(change_id)` returns `pending_approval` with `approver: null`. The agent tells the presenter it is waiting (P11).
5. The Finance window shows the approval card (section 6.10): the diff, before and after counts, requester `agent:claude-code`, `on_behalf_of user:ops-lead`, rule id `R-GRANT`, and Approve and Reject buttons.
6. On the Ops board session, no Approve button is rendered. A direct call to approve from that session returns `FORBIDDEN` with `reason: "sod_violation"` (P7).
7. Priya approves. The approval record is written and the held Change commits in the same transaction (approval record, grant node, `grant_index` rows, change row, outbox row). The Exec view re-queries and loses non-EMEA rows in place, with the sequence chip showing the grant's seq.
8. The Inspector on the Exec view shows its own `policy_hash`. The Ops board inspector shows a different `policy_hash` (P17). The two values differ because the predicate and the principal differ.
- Reject path: `change.status` returns `rejected` with the reason; the Change is closed and no grant is written.
- AC-WF-15 **Guarantee**: `user:ops-lead` and `agent:claude-code` cannot approve their own or each other's grant proposal; the test asserts `FORBIDDEN` with `sod_violation` for both.
- AC-WF-16 **Guarantee**: until approval, `grant_index` has no row for the proposed grant, and `query.run` for emea-lead returns the same `policy_hash` as before the proposal.
- AC-WF-17 **Guarantee**: after approval, the Exec view's `policy_hash` changes and its finance board row count equals the EMEA row count in the fixture.
- AC-WF-18 **Target**: the approval card renders with before and after counts in the same window as the approval button on the Finance window, no reload.

### 5.5 Incident workflow: rule to workflow to acknowledge (beats 4, 8, 9, 10)

**Phase A. Rule creation (beat 4).**
1. The presenter clicks the red heatmap cell, which sets `region=EMEA` and `carrier=Crane` as session state (no agent call, no Change).
2. The presenter asks for an alert for any region above 900 ms for three minutes.
3. `node.preview(kind="Rule", …)` returns the query lineage, effects (a `notify` action to receiver `ops-channel` (handler `notify`, internal, `external: false`, under `action:notify`)), `owner: agent:claude-code`, `on_behalf_of: user:ops-lead`, `effective_principal` and a backtest over 30 days in one-minute windows that reports exactly one firing.
4. `node.commit` writes the Rule under `R-RULE-CREATE` (the receiver is allowlisted, decision 9). The Rules strip shows the rule in state `ok`; the backtest sparkline marks the single firing; clicking the mark opens the query that produced it.

**Phase B. Fault and firing (beat 8).**
1. The presenter presses F7 on the presenter console. The console sends the cue to the presenter control API on its own port with its own credential. The cue is absent from the MCP tool list (P15).
2. The cue is applied at the next generator tick, and the tick is recorded. The `FaultProfile` for EMEA and Crane ramps from that tick.
3. `service:rule-worker` evaluates the rule. The state machine is in section 5.5.1.
4. On `firing`, the worker writes one firing row with a `firing_id`, creates a Workflow instance in state `open` and runs `on_fire` actions. The notification is posted once for that `firing_id`.
5. Every screen shows a toast with the workflow link. The workflow card appears on the Ops board in state `open` with its transition history.

**Phase C. Acknowledge (beats 9 and 10).**
1. The agent builds a Form with an Action `workflow.acknowledge` (declared effect: a Change on the instance; permission `workflow:acknowledge`) under `R-FORM-CREATE`. It builds a timeline panel bound to `workflow.transitions` filtered by the instance parameter under `R-PANEL-CREATE`.
2. The Phone window gains a note field and an Acknowledge button on the incident card. The Ops board gains the timeline.
3. `user:ops-lead` taps Acknowledge on the Phone. The Change carries the base revision from form load. It applies directly; a human acknowledgement carries no rule id (section 0.2).
4. The workflow moves `open` to `acknowledged`. The audit row reads `actor = user:ops-lead`, `surface = 'ui'`. All screens update by sequence number.

#### 5.5.1 Rule state machine

| From | Event | To | Effect |
|---|---|---|---|
| `ok` | breach begins | `pending` | `pending_since` set on virtual clock |
| `pending` | breach ends before hold | `ok` | none |
| `pending` | breach held for `hold` | `firing` | new `firing_id`; one notification; one workflow instance |
| `firing` | breach ends | `resolved` | one recovery notice for this `firing_id` |
| `resolved` | next evaluation clean | `ok` | none |
| `resolved` | new breach begins | `pending` | `pending_since` set on virtual clock |

- AC-WF-19 **Guarantee**: a rule with `hold: 3m` on the virtual clock reaches `firing` only after three minutes of continuous breach, and exactly one notification is sent per `firing_id` (test `rule_fires_once`; revised 04 G.2 "Rule fires twice").
- AC-WF-20 **Guarantee**: the 30-day backtest of the seeded rule reports exactly one firing and no other breach window (test `backtest_fires_once`).

#### 5.5.2 Workflow state machine

| From | To | Who | Permission |
|---|---|---|---|
| (created) | `open` | Platform, on rule `firing` | system |
| `open` | `acknowledged` | Human | `workflow:acknowledge` |
| `acknowledged` | `resolved` | Rule worker when the linked firing resolves, or a human | system or `workflow:acknowledge` |
| `resolved` | `closed` | Human | `workflow:acknowledge` |

- The agent principal is refused every transition with `FORBIDDEN`, naming `workflow:acknowledge`.
- AC-WF-21 **Guarantee**: each transition writes one `workflow.transitions` row with actor, surface, from-state and to-state, and the audit row for the transition exists.
- AC-WF-22 **Guarantee**: an Acknowledge submitted with a stale base revision returns `CONFLICT` naming `/state`, and the card shows the current state rather than applying the tap.

### 5.6 Undo workflow (beat 7)

- Trigger: the presenter clicks Undo on the grant row in the audit panel.
- Steps:
  1. The UI shows the inverse diff in a confirm popover, computed by `node.preview(undo_of=<grant seq>)` for display only.
  2. The grant change removes an access restriction, so it is classed `R-GRANT-UNDO` (decision 7). It is auto after preview for a principal with `grant:write` on the finance board, with no second approval (03 section 7.4). The widening emits a `grant.widened` audit event and a notification to every `grant:write` holder on the finance board.
  3. The undo commits as a new Change with the stored `inverse_ops`, with `undo_of` set to the grant's seq. Nothing is deleted: the chain has both rows, linked.
  4. The Exec view regains its rows in place. The audit panel shows two linked rows.
- Undo across principals is allowed for any principal with write access to the same paths (D.11). It is audited with `undo_of`.
- Errors: if a later Change touched the same paths, undo returns `CONFLICT` naming the later Change's seq.
- AC-WF-23 **Guarantee**: `undo_roundtrip` (revised 04 claim 4): 300 random mixed-principal Changes followed by their undo in reverse return `body_hash` to the start, with 600 chain rows and none modified.
- AC-WF-24 **Guarantee**: an undo of a Change never removes a row from `changes` and always writes `undo_of`.
- AC-WF-25 **Guarantee**: an undo of an approved grant is classed `R-GRANT-UNDO`; it commits after preview only for a principal with `grant:write` on the resource, and an undo that widens access emits `grant.widened` and notifies every `grant:write` holder (test `grant_undo_widens_audited`).

### 5.7 Conflict workflow: the merge rule, stated once

The rule from P13 governs every conflict in the demo. It is stated here so that the stage beat follows it exactly.

| Condition | Outcome | Response |
|---|---|---|
| `base_revision` equals head | Applies | Revision increments |
| Paths disjoint from every change between base and head | Rebased and applied | `merged_from` lists the change seqs |
| Paths intersect any such change | Rejected whole | `CONFLICT` with the payload in WF-M2 |
| Deleted node touched by a concurrent change | Rejected whole | `CONFLICT` naming the node |

- Lists are keyed by stable ids. A move is remove plus insert with the same id. A concurrent insert and move of one id is a conflict.
- Text fields are never silently overwritten. An intersecting text path is a conflict and the head value is kept (decision 11).
- The human conflict card shows both authors (the presence name of the head author and the local author), the conflicting path and two buttons: keep head, or re-apply mine after review. Re-applying runs a fresh preview.
- AC-WF-26 **Guarantee**: the merge table has one test per row.
- AC-WF-27 **Guarantee**: a conflicting human edit never overwrites the head silently; the audit shows only the applied Change.

### 5.8 Replay workflow: the fallback (presenter only)

- Trigger: the presenter presses F9, or the driver switches automatically after two errors on one step or a step over its budget (12 s query step, 20 s multi-call step, revised 04 C.3).
- The switch happens at a step boundary. An in-flight step is cancelled with `notifications/cancelled` and honoured only before its commit transaction begins (D.6). An ambiguous commit is resolved by looking up the idempotency record.
- The driver is `service:replay-driver`. It executes recorded human steps with `on_behalf_of` set to the recorded human (P9). Every replayed row has `surface = 'driver'` and `replay_of` set.
- The driver takes over only where a satisfaction predicate (P10) is unmet. It skips satisfied steps and never inverts another principal's changes.
- The trace ribbon tags each call `live` or `replay` (section 6.3). The room display does not otherwise change.
- Takeover rate: the rehearsal report states the live takeover rate per step over at least 10 model-in-the-loop runs. Steps above the pre-registered threshold are replay by default and their ribbon says so (P18).
- AC-WF-28 **Guarantee**: `replay_reproduces`: every query step's result hash and every Change's change hash match the transcript, locally and on staging.
- AC-WF-29 **Guarantee**: a replayed step whose expected change hash is already in the log is marked done and not reissued.
- AC-WF-30 **Target**: the driver switch is one keystroke and produces no visible change except the tag.

### 5.9 Beat-to-workflow map

| Beat (README) | Workflows |
|---|---|
| 1, 0–25 s | WF-M1 (presence); KPI tile updates by event |
| 2, 25–55 s | WF-A1, WF-H2 |
| 3, 55–95 s | WF-A2 |
| 4, 95–125 s | Phase A of 5.5, WF-H1 (session click) |
| 5, 125–160 s | 5.4 |
| 6, 160–190 s | WF-M2 |
| 7, 190–205 s | 5.6 |
| 8, 205–235 s | Phase B of 5.5 |
| 9, 235–258 s | Phase C of 5.5, step 1 |
| 10, 258–268 s | Phase C of 5.5, steps 3–4 |
| 11, 268–300 s | WF-A5 below |

**WF-A5. Blast-radius panel (beat 11).** The agent composes a lineage query over `lineage.edges` (dependents of `orders.fulfilled_at`), a count over `orders` for the fault window grouped by carrier, a query over `workflow.transitions` and `audit.changes` for the instance, and a table panel with one row per dependent kind. Each count links to its query in the panel inspector. Commit under `R-PANEL-CREATE`.
- AC-WF-31 **Guarantee**: every count on the blast-radius panel links to a query whose re-run returns the same number.
- AC-WF-32 **Guarantee**: the blast-radius panel is created by the composition of existing sources with no feature added to the platform for it (revised 04 claim 5, composition question C2 and the finale).

---

## 6. Frontend information architecture and interaction requirements

### 6.1 Principles

- **One document.** The UI renders the same Dashboard document the agent writes. No UI-only document state exists. What the audit diff shows is what the grid rendered.
- **Two kinds of state.** Documents are revisions. Session state is the URL. Nothing is stored in browser storage that another viewer or Claude must read back.
- **Only events move.** Elements animate only in response to a sequenced event or a user gesture (P2, section 6.13).
- **The trace is always visible.** Every screen carries the trace ribbon (P4).

### 6.2 Routes and screens

| Route | Screen | Principal in demo | Notes |
|---|---|---|---|
| `/login`, `/callback` | OIDC sign-in | Any | Keycloak locally, Cognito on AWS (same flow) |
| `/b/:dashboard` | Dashboard grid | Session principal | `ops-board`, `finance-board` |
| `/b/:dashboard/p/:panel?tab=` | Dashboard with panel inspector open | Session principal | Tab values in 6.5 |
| `/b/:dashboard/edit` | Layout edit mode | Principal with `node:write` | Toggling edit mode is a UI state, not a Change |
| `/exec` | Exec view | `user:emea-lead` | A single pane: the Ops board as the EMEA lead sees it (decision 8, ruling 21) |
| `/phone` | Phone incident list | `user:ops-lead` | Phone layout, 6.14 |
| `/phone/incidents/:workflow` | Phone incident card | `user:ops-lead` | Same Workflow card component, phone variant |
| `/approvals` | Approval tray | Approver | Lists held Changes the session may approve |
| `/audit` | Audit panel, full page | Any with `audit:read` | `?seq=` focuses a row |
| `/rules` | Rules, full page | Any with `workflow:read` | Strip view is the same component |
| `/workflows/:slug` | Workflow card, full page | Any with `workflow:read` | |
| `/lineage/:uri` | Lineage graph | Any | ECharts graph series |
| `/sources` | Source browser | Any with `query:run` | Field lists paged after 40 fields |
| `/trace` | Trace ribbon, expanded | Any | Room display's trace panel |
| `/settings` | Theme, density, reduced motion | Any | Per-viewer preferences |
| Presenter origin `/console` | Presenter console | Presenter credential | Separate port (decision 14); not in MCP |

A route resolves to a Dashboard node by slug and the URL query string supplies session state (6.12). Routes never embed a revision: revisions are shown as a chip, not as a route.

### 6.3 Shell and the trace ribbon (P4)

The shell is a thin header (session identity, presence avatars, connection state) and a trace ribbon along the bottom edge. The ribbon lists one row per call or session event, newest at the right:

- tool name (`query.run`, `node.commit`, `view`, `ui.present`, and so on);
- a one-line argument summary, truncated, with the full arguments one click away;
- status: `ok`, or the error code from the closed set (D.8, P5), with `LOOP_SUSPECTED` where it applies;
- change seq, for writes (`—` for reads);
- principal, shown as the principal's display name and kind (`agent` label for `agent:claude-code`);
- the tag: `live` or `replay` for agent calls (`replay` for driver calls), `ui` for human gestures and `system` for worker effects (ruling 12).

Session events (brush, drill, parameter change) appear in a distinct style marked `session`, so the audience can tell them from commits (revised 02 D.12). Each row can be expanded to show the response envelope: `{ok, data | error, next, warnings, budget, call_id, trace_id}` (P5). `trace_id` equals the root span id (ruling 10).

- AC-FE-TRACE-1 **Guarantee**: every MCP call from the agent session appears in the ribbon on every subscribed screen within one event cycle, with the same status and change seq.
- AC-FE-TRACE-2 **Guarantee**: a brush or drill appears as a `session` row and produces no row in `changes`.
- AC-FE-TRACE-3 **Guarantee**: a replayed call is tagged `replay`; a live agent call is tagged `live`; human gestures are tagged `ui` and worker effects `system`; the tag is set from the call's transport and never inferred from timing.
- AC-FE-TRACE-4 **Target**: the ribbon is screen-reader navigable, with rows as a list and a live region for new rows that announces at most one row per second.

### 6.4 Dashboard grid

- Grid: react-grid-layout, 12 columns on the desktop breakpoint (1280 CSS px and up), 8 columns on the tablet breakpoint (768–1279 px), a single column on the phone breakpoint (below 640 px). Layout is stored in the Dashboard document as `layout.items` with `{panel, at: {x, y, w, h}}`, and the phone order is `layout.phone` (decision 10).
- Moves and resizes are Changes on `layout` paths (`R-LAYOUT`). A drag in progress is a gesture, local only. On drop it sends one Change with base revision.
- A committed panel appears with a materialise event: the panel's corner chip shows `rev <n> · seq <s>`, and the appearance is driven by the event with that seq (6.13).
- Keyboard: a focused panel moves with the arrow keys and resizes with Shift plus arrow keys. Each keyboard move ends in one Change when the key is released, the same Change a drop would send.
- Edit mode is a UI state. Entering or leaving it writes nothing.

- AC-FE-GRID-1 **Guarantee**: dragging a panel and dropping it writes exactly one Change with base revision equal to the revision displayed at gesture start.
- AC-FE-GRID-2 **Guarantee**: a grid move and a panel's title edit on the same panel produce one conflict card when both are concurrent (WF-M2).
- AC-FE-GRID-3 **Target**: the 12-column grid is usable at 1280 CSS px with no panel below the fold for the three-panel Ops board.

### 6.5 Panel inspector and policy hash (P17)

The inspector opens on the right of the grid as a sheet. Its tabs are:

| Tab | Content | Source |
|---|---|---|
| `result` | First rows, `row_count`, `as_of`, watermark ("data as of 14:20:59") | `query.run` result envelope |
| `query` | The Query AST as the node stores it, and the compiled SQL | `query.explain` |
| `access` | This session's `policy_hash`, injected row predicate text, masked columns, grant ids that applied, and the rule for denials | `grant.check` (P16, folded from the same evaluation) |
| `lineage` | Upstream sources and fields; dependent panels, rules, dashboards, grants | `lineage.edges` |
| `history` | Change history for the node | `change.history` |
| `preview` | The pending diff for any held or previewed Change on this node | `diff` |

The `access` tab is the one the audience reads during beat 5. It shows the session principal's `policy_hash` in full, a copy button, and the predicate text. Denials name the grant id and never a hidden value (P16). The inspector never shows another principal's `policy_hash`: each screen shows its own, so comparing the Exec view with the Ops board is a comparison of two screens, and no call reveals another principal's policy (P8).

- AC-FE-INSP-1 **Guarantee**: the `access` tab's `policy_hash` equals the `policy_hash` in `query.explain` for the same query run by the same principal.
- AC-FE-INSP-2 **Guarantee**: for ops-lead and emea-lead on the same panel after the grant (AC-WF-17), the two displayed `policy_hash` values differ.
- AC-FE-INSP-3 **Guarantee**: a denied column shows the grant id and the same placeholder shape as an absent column (P8).

### 6.6 Visuals and channels (P1)

Every visual maps result columns to typed channels. A column mapped to no channel is a validation error at preview, not a silent drop (D.3). Visuals receive only the query result payload; no visual has data access of its own.

Channel names are owned by 02 section 3.5 and are not restated here.

| Visual | On stage | Notes |
|---|---|---|
| Time-series line | Yes (beat 2 and beat 4) | Brushing sets `incident_window` as session state |
| Bar | Yes (P1; finance board) | Threshold draws a reference line |
| Heatmap | Yes (beat 3, two panels side by side) | See below |
| KPI tile | Yes (beat 1) | Sparkline redraws per event |
| Table | Yes (blast radius, timeline) | Masked columns render the typed mask placeholder |
| Lineage graph | Yes (beat 11) | ECharts graph series; node click opens the query |
| Area, scatter | Supporting | Real and tested, not on stage |
| Sankey | Supporting | Real and tested, not on stage |
| Geo map | Supporting | Boundaries bundled as static data; no tile service |

Heatmap rules. The incident heatmap and the control heatmap sit side by side with identical scales. Each cell prints its value. Cells above the threshold carry a diagonal hatch in addition to colour. The colour scale is a sequential palette from the theme's chart tokens (6.16). The red cell is therefore identifiable without colour.

- AC-FE-VIS-1 **Guarantee**: a result column not mapped to any channel makes preview fail with `VALIDATION_FAILED` naming the column and the allowed channels.
- AC-FE-VIS-2 **Guarantee**: each visual's rendered values equal the query result's values for the same `result_hash`.
- AC-FE-VIS-3 **Guarantee**: the heatmap pair share one value domain, asserted in the component's props.

### 6.7 Audit panel

The audit panel is a standard panel over `audit.changes` (metadata as a source, the mechanism behind beats 3, 7 and 11). It is also the page the presenter uses in beat 7.

- Columns: `seq`, `at` (the demo time, `virtual_at`), `actor`, `on_behalf_of`, `surface`, rule id, `change_hash` (first 12 characters), `undo_of` (linked), `contains_untrusted` flag.
- A chain badge reads the result of `GET /audit/verify`: "chain verified to seq N", or a visible failure.
- Undo: per row, a confirm popover shows the inverse diff, then commits (6.5 and 5.6).
- A count of zero is printed as `0 changes in window`, not as an empty table.
- Filters by actor, surface and time write session state (6.12).

- AC-FE-AUD-1 **Guarantee**: each row's `change_hash` equals the hash computed from its stored ops under `plinth-core`.
- AC-FE-AUD-2 **Guarantee**: a row with `contains_untrusted = true` shows the flag and the untrusted-data marker on every text field it echoes (P14).

### 6.8 Rules strip

A horizontal strip above the grid lists the rules that watch the current dashboard's panels. Each rule shows its name, rule id, state chip (`ok`, `pending`, `firing`, `resolved`), owner and `on_behalf_of`, a hold progress bar on the virtual clock, and a backtest sparkline with firing marks. Clicking a firing mark opens the query run for that window. A `firing` chip links to its workflow card.

- A state chip changes only on the rule's state event (6.13).
- AC-FE-RULES-1 **Guarantee**: the strip shows the state from the latest rule event; it never shows a state with no event behind it.
- AC-FE-RULES-2 **Guarantee**: a backtest mark click opens a query whose `result_hash` equals the backtest's result for that window.

### 6.9 Workflow card

The workflow card shows the instance title, state, linked `firing_id`, fields from `workflow.instances`, the transition timeline from `workflow.transitions`, and the Form-defined actions. The acknowledge form has a note field and an Acknowledge button. The recovery notice, when one exists, is labelled as a recovery notice, never as a page.

- The card has a phone variant (6.14) that is the same component with a single-column layout and a bottom action bar.
- AC-FE-WF-1 **Guarantee**: the Acknowledge button submits a Change whose base revision is the revision the form loaded with.
- AC-FE-WF-2 **Guarantee**: after a successful Acknowledge, the card shows `acknowledged` on every subscribed screen with the actor name in the timeline.

### 6.10 Approvals tray and commit cards (P6, P7, P11)

Every write the agent makes produces a commit card. A commit card carries the rule id, the actor, `on_behalf_of`, the surface, the change seq (or `pending`), the status (the state machine in 03 section 7.1), and the approver when there is one. The card is the same component on every screen and in the audit panel.

The approval card in the Finance window shows: the diff, the before and after counts (computed server-side for the approver), the requester and delegator, the rule id, the expiry of the preview, and two buttons. The Approve button is absent on sessions that are the requester or the delegator; if one is invoked directly the response is `FORBIDDEN` with `reason: "sod_violation"`.

- AC-FE-APP-1 **Guarantee**: Approve is not rendered for `user:ops-lead` or `agent:claude-code` sessions on a grant proposal.
- AC-FE-APP-2 **Guarantee**: the commit card status matches `change.status` for the same change at every render.

### 6.11 Presence and cursors

Presence is ephemeral and non-authoritative (V8, P06 in revised 02). It is pushed from Redis.

- **Who is here.** The header shows one avatar per principal, with a session count when a principal has more than one session. `user:ops-lead` shows two sessions while both the Ops board and the Phone are open.
- **Where.** Each node shows small avatars of principals focused on it in the panel corner.
- **Cursors.** A human session sends its pointer position at most 10 times per second. The gateway fans out at most 5 presence updates per second per node (D.6). Presence expires after 5 seconds without a heartbeat.
- **The agent.** The agent is a participant, not a pointer. It is drawn as a dashed outline on its last-target node, labelled with its derived state: `reading`, `previewing`, `holding for go`, `committed r+1`. The state comes from the agent's MCP call names on the realtime channel. The label is the audience's evidence of concurrency in beat 6.
- **Degradation.** If Redis is down, badges disappear and data continues to update through the outbox on resume (G.2).

- AC-FE-PRES-1 **Guarantee**: presence fan-out for one node never exceeds 5 updates per second per subscriber.
- AC-FE-PRES-2 **Guarantee**: the agent marker never draws a pointer, and its label changes within one event cycle of each MCP call it names.
- AC-FE-PRES-3 **Guarantee**: presence entries are absent after 5 seconds without heartbeat.
- AC-FE-PRES-4 **Target**: presence and cursor updates add no more than a stated budget to the commit-to-screen path (measured in rehearsal).

### 6.12 Session state in the URL (P3)

Session state is encoded in the query string of the route. The mapping is:

| Parameter | Type | Set by | Example |
|---|---|---|---|
| `region` | enum, multi | Click on heatmap or bar, filter | `region=EMEA` |
| `carrier` | enum, multi | Click on heatmap | `carrier=Crane` |
| `window` | duration | Header control | `window=1h` |
| `incident_window` | interval | Brush on the line panel | `incident_window=2026-…T14:00..2026-…T14:20` |
| `tab` | enum | Inspector | `tab=access` |
| `seq` | int | Audit focus | `seq=412` |

Rules:
- Values are validated against the parameter type from the Dashboard document. An invalid value is ignored and a `session` row shows a warning.
- Brushing, clicking and filtering use `history.replaceState` for in-place changes and `pushState` for navigation (drill-down), so Back moves through session views.
- Reloading a route restores the session state exactly.
- A shared URL reproduces a view for a principal who can read the dashboard. It shares no Change, grants no access and does not carry a preview token.
- Saving the current parameters as the dashboard default is an explicit Change (`R-PANEL-EDIT` for agents, `R-LAYOUT`-class direct for humans, decision 13).
- The session record holds the same map for screen principals targeted by `ui.present` (revised 02 D.12).

- AC-FE-URL-1 **Guarantee**: reloading `/b/ops-board?region=EMEA&carrier=Crane` restores the same panels, filters and inspector tab, with zero Change rows created.
- AC-FE-URL-2 **Guarantee**: a brush, click or filter writes zero rows to `changes` and zero to `query_runs` beyond the queries those views need.
- AC-FE-URL-3 **Guarantee**: an invalid parameter value is ignored and the view renders with the default for that parameter.

### 6.13 The animation honesty rule (P2)

**Rule.** A UI element animates only in response to (a) a sequence-numbered change or result event, or (b) a user gesture (drag, press, focus, keyboard move). There are no timer-driven animations, no idle pulses, no looping effects and no decorative transitions on data-bound elements. Panels materialise on commit and carry their change sequence in a corner chip.

**What counts as an event.** The commit event (materialise, state change, title or layout change), a result event (KPI tick, sparkline point, panel data arrival), a presence event (agent state change), a rule event (state change), and a workflow event (transition, toast). Each carries the workspace `seq`.

**Loading.** A loading state is static text with the phase name, and progress comes from `notifications/progress` events. No spinner is used, because a spinner is a timed animation.

**Enforcement.** Four mechanisms, each tested.

1. A single `Motion` primitive is the only component allowed to animate a data-bound element. Its props require either `seq` or `gesture`. A missing value is a type error.
2. A lint rule forbids CSS `animation`, CSS `transition` on data components, and motion library imports outside the primitive.
3. A runtime check, active in development and in the rehearsal harness, enumerates `document.getAnimations()` at each frame and requires that every running animation's element has a `data-seq` attribute equal to an event id the page has received. Any animation without one is logged with the element path and fails the run.
4. Under `prefers-reduced-motion`, events still apply but transitions become instant. The rule remains true.

- AC-FE-ANIM-1 **Guarantee**: the `animation_honesty` test fails the build if any animation fires without an event id, across the full rehearsal script.
- AC-FE-ANIM-2 **Guarantee**: no element on any screen animates on a timer after the page has been idle for 30 seconds, asserted in a test that makes no interaction.
- AC-FE-ANIM-3 **Guarantee**: with reduced motion enabled, the same rehearsal script produces the same final DOM state as without it.

### 6.14 Phone-width layout

The Phone window is 390 CSS px wide in the demo and is the phone layout of the same dashboard (V10). The phone layout is:

- single column in `layout.phone` order;
- the incident card as the primary view, with the note field, the Acknowledge button in a bottom action bar, and the timeline below;
- charts reflow to the column width, with their table alternative available beneath;
- tables render as a stacked list of row cards for widths under 640 px;
- touch targets at least 44 by 44 CSS px;
- no horizontal page scroll at any width from 320 px up.

- AC-FE-PHONE-1 **Guarantee**: at 390 px and 320 px viewport widths, `document.documentElement.scrollWidth` equals the viewport width on every phone route.
- AC-FE-PHONE-2 **Target**: every interactive element on the phone routes measures at least 44 by 44 CSS px.
- AC-FE-PHONE-3 **Guarantee**: the Phone incident card and the Ops board workflow card render the same workflow state from the same event.

### 6.15 Accessibility

- **Target**: WCAG 2.2 AA on every route, measured with an automated audit in the rehearsal harness and a manual pass on each screen.
- **Keyboard**: the grid, inspector tabs, rules strip, approval card and audit table are fully operable by keyboard. Focus is visible. Focus is not moved by incoming events, except on an explicit user action such as opening a sheet.
- **Live regions.** Materialisations and commits are announced politely, one per second at most. A firing alert is announced assertively, once per `firing_id`.
- **Colour.** Colour is never the only channel. Heatmap cells print values and hatch above threshold. Status chips carry text. The agent marker carries its label.
- **Text alternatives.** Each chart has a table view toggle that shows the same result rows.
- **Motion.** Reduced motion is honoured (6.13).

- AC-FE-A11Y-1 **Target**: zero serious or critical automated accessibility findings on each route in the rehearsal.
- AC-FE-A11Y-2 **Guarantee**: every interactive control on each route is reachable and operable by keyboard alone, asserted by a scripted tab order test.

### 6.16 Theming

- Colours, spacing and type are defined as tokens on `:root`. Light is the default; dark applies by `prefers-color-scheme` and by an explicit `data-theme` attribute; a high-contrast variant exists for the room displays.
- Chart palettes are tokens too: a sequential palette for heatmaps and a categorical palette for series, both colour-blind safe, and both checked by the palette validator in the dataviz guidance before use.
- The theme choice is a per-viewer preference, kept in local storage, and it is not state that anyone else or any agent reads back.
- The presenter console uses the dark variant only.

- AC-FE-THEME-1 **Guarantee**: every token used by a component exists in light, dark and high-contrast variants; a build test fails on a missing variant.
- AC-FE-THEME-2 **Target**: the heatmap palette passes the colour-blind simulation check for the red cell against its neighbour.

### 6.17 Presenter console

The presenter console is served by `plinth-web` on the presenter control port, with its own credential. It is not reachable from MCP (P15).

Panels on the console:
- **Virtual clock**: the current virtual time, the tick rate (6x), and a stall indicator when no rule has changed for 10 seconds after the F7 cue.
- **Driver mode**: `live` or `replay`, with F9 to switch at the next step boundary (5.8).
- **Step list**: each step's name, its satisfaction state, its takeover count, and the takeover rate per step from the rehearsal report (P18).
- **Slack pool**: the remaining slack in seconds, shown after each step (P19). The hard maximum is shown beside it; the pool size and the maximum are owned by `../presentation-script.md` (ruling 8).
- **Fault cue**: F7 applies the EMEA/Crane `FaultProfile` at the next generator tick, and the console shows the applied tick.

- AC-FE-CONSOLE-1 **Guarantee**: the presenter control API is absent from the MCP tool list and from every grant the agent holds; a test asserts both.
- AC-FE-CONSOLE-2 **Guarantee**: F7 applies at the next generator tick, and the console shows that tick.
- AC-FE-CONSOLE-3 **Guarantee**: when the slack pool is exhausted, the console says so and the driver runs the remaining steps without further takeover charges.

### 6.18 Acceptance criteria per screen

**Ops board** (room, wide; `ops-lead`, route `/b/ops-board`)
- AC-FE-OPS-1 **Guarantee**: three panels and the rules strip render from the Dashboard document with no client-side data.
- AC-FE-OPS-2 **Guarantee**: the agent's panel materialises on commit with its seq chip; the materialise is driven by that event.
- AC-FE-OPS-3 **Guarantee**: the conflict banner names both authors and the path (WF-M2).
- AC-FE-OPS-4 **Target**: a committed change from the agent is visible on this screen within the commit-to-screen target (300 ms p95 on localhost, measured).

**Exec view** (room; `emea-lead`, route `/exec`)
- AC-FE-EXEC-1 **Guarantee**: the Exec view pane shows only EMEA rows and no write affordance (WF-H2).
- AC-FE-EXEC-2 **Guarantee**: after the grant is approved, the Exec view loses the rows the grant excludes, in place, with no reload.
- AC-FE-EXEC-3 **Guarantee**: after the undo commits, the Exec view regains its rows in place.

**Finance window** (room, small; `finance-analyst`, route `/b/finance-board` and `/approvals`)
- AC-FE-FIN-1 **Guarantee**: the approval card shows the held diff, before and after counts and both identities, and the Approve button works for this session only.
- AC-FE-FIN-2 **Guarantee**: a rejected proposal shows `rejected` on the commit card on every screen.

**Phone** (`ops-lead`, `/phone/incidents/:workflow`)
- AC-FE-PHONE-4 **Guarantee**: the note field and Acknowledge submit one Change, and the card reaches `acknowledged` with the timeline row shown on the Ops board.

**Presenter console** (presenter origin, `/console`)
- AC-FE-CONSOLE-4 **Guarantee**: the step list and the slack pool update from events, not from timers.

**Trace ribbon** (every screen)
- AC-FE-TRACE-5 **Guarantee**: `replay` and `live` tags appear as specified in 6.3 for every row in the rehearsal run.

**Audit panel** (any route with `audit:read`)
- AC-FE-AUD-3 **Guarantee**: undo from the panel commits only after confirmation and writes `undo_of`.

**Lineage graph** (`/lineage/:uri`)
- AC-FE-LIN-1 **Guarantee**: every node in the graph corresponds to a row of `lineage.edges` or a node of the workspace, and clicking it opens the query or node it represents.

---

## 7. Decisions and ambiguities

Each line records a canonical fact that was ambiguous, or a choice this document had to make.

1. **Beat timings.** README beat times are used. Revised 04 C.2 uses 30-second rows (0–30, 30–60 and so on) that differ from the README; the README governs and the presentation script must follow it.
2. **Beat 2 visual.** README says a time-series line panel; revised 04 says a bar panel. The line panel is used; P1 lists the line type as on stage.
3. **Sankey and map.** P1 lists them as supported and tested, not on stage. Revised 04 G.5 says they are not in version 1. P1 is binding and is followed.
4. **Negative control.** P12 defines the control window as yesterday 14:00–14:20. Revised 04 C.2 adds a 13:00–14:00 baseline column. The control window from P12 is used and the baseline column is dropped from beat 3.
5. **Untrusted envelope key.** P14 specifies `untrusted`. Revised 04 D.10 specifies `untrusted_data`. The key `untrusted` is used.
6. **Grant counts for another principal.** Ruling 1 replaces `grant:admin` with `grant:inspect` in P8. The agent ceiling holds `grant:inspect`, so `grant.check` may return another principal's counts only on resources the delegator can administer; otherwise they are withheld. Beat 5's before and after counts are computed server-side on the approval card for the approver.
7. **Undo of a grant (highest impact).** README beat 7 has the undo take effect with no approval step. This document follows 03 section 7.4: the undo of an approved grant is classed `R-GRANT-UNDO`, auto after preview for a principal with `grant:write` on the resource, with no second approval (ruling 4). The undo is attributed with `undo_of`, audited as `grant.widened` and notified to `grant:write` holders. README ruling 4 settles this, which answers 03 section 16, item 3.
8. **Exec view layout.** The Exec view is a single pane showing the Ops board as the EMEA lead sees it (ruling 21). Beat 5's row loss happens in that pane, in place (5.4, step 7). Revised 04's opening on the finance board is not used.
9. **Ops channel classification.** P6 names `R-ACTION-EXTERNAL` as approval-required, but beat 4 commits a rule that posts to `ops-channel` without approval. The receiver is treated as allowlisted and admin-registered, so `R-RULE-CREATE` applies. A non-allowlisted receiver is held under `R-ACTION-EXTERNAL`.
10. **Phone order.** A separate `layout.phone` order is used for the single-column phone layout. Revised 02 and 04 do not define one.
11. **Text conflicts.** Revised 04 D.6 says text fields use last-writer-wins, but beat 6 requires a conflict on the title. Intersecting text paths are conflicts and the head value is kept. LWW is not used for intersecting paths.
12. **Workflow states.** Revised 04 names `open` and `acknowledged`; revised 02 adds `resolved` and `closed`. All four are used, with the transitions in 5.5.2.
13. **Session-to-default saves.** Saving the parameter defaults is classed `R-PANEL-EDIT` for agents and direct for humans. Neither rule id appears in the README; both must be added to the closed table in `03`.
14. **Presenter control port.** The README does not give a port. The presenter console is configured by the key `PLINTH_PRESENTER_PORT`, owned by `07-deployment.md` section 14.2, and this document uses no literal port.
15. **Presence rates.** Revised 02 sends cursors at 10 Hz from the client and revised 04 fans out at 5 updates per second per node. Both are used: client send at most 10 Hz, server fan-out at most 5 per second per node.
16. **Ribbon scope.** P4 says the ribbon is on every screen, and revised 04 says the room display shows a trace panel. Both hold: every screen has the ribbon, and the room display's ribbon is expanded.
17. **IDEMPOTENT_REPLAY.** Revised 04 D.8 lists it as an error code, but D.6 returns `replayed: true` on success. It is treated as a `warnings` entry, not an error, and is removed from the error code set.
18. **Acknowledge latency.** Revised 04 says under 2 seconds; D.6 says 300 ms p95 on one host. The 300 ms figure is the Target and the 2-second figure is the outer bound, both labelled Target.
19. **Operator presence grouping.** `user:ops-lead` appears as one avatar with two sessions, not two avatars, because the README names one human.
20. **Rule ids.** Only the rule ids listed in section 0.2 are used. Any other id in other documents must be added to the closed table, not invented.
21. **Frontend stack.** The README stack (React 19, Vite, TanStack Query, Zustand, react-grid-layout, Apache ECharts) is used. Revised 02's uPlot is not used.
22. **Animation for the time-series.** The line panel's brush and KPI sparkline use the event rule (6.13); no panel uses a timer.

**Word count:** approximately 6,000 words.
