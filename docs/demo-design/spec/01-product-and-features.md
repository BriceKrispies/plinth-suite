# Plinth specification 01: product vision and feature inventory

This document covers mission sections 1 (product vision and core demonstration narrative) and 2 (detailed feature inventory). It is design only. Nothing here is built or run.

**Inputs and precedence.** `README.md` in this directory is binding for names, identities, the tool catalogue, images, commands and beat order. Then the amendments P1–P20 in `../selection-rationale.md`. Then the winning proposal `../revised/04-emergent-composition.md`. Grafted ideas are cited by their source proposal: 01 (`../revised/01-systems-complexity.md`), 02 (`02-visual-spectacle.md`), 03 (`03-enterprise-platform.md`), 05 (`05-operational-resilience.md`), 06 (`06-agent-native-innovation.md`).

**Labels.** Every property is marked **Guarantee** (enforced by code and covered by a named test) or **Target** (a design goal, measured in the rehearsal harness before it is claimed).

---

## 1. Product vision and core demonstration narrative

### 1.1 What Plinth is

Plinth is a self-hosted, multi-tenant operations platform. A workspace holds data sources, one query layer, dashboards built from panels, rules that watch queries, workflows that react to rule firings, forms that write back, grants that control visibility, and a complete history of every change.

It has six kernel primitives and one specification language. Every dashboard, panel, source, rule, workflow, form, grant, metric, template, export, annotation and comment is a **Node** of one of fifteen kinds, written in one document language. Every write is a **Change**. Every read is a **Query** compiled by one compiler. One authorization function decides every request. One real-time channel carries every update. The web UI, the HTTP API, the CLI and the MCP server are four views of this one model. None of them has a capability the others lack.

**Guarantee:** the four surfaces produce identical node state and identical audit rows for the same logical change (AC-01-KER-4).

The product claim has two parts, and the demonstration is built to prove both:

1. **Serious product.** Every change is previewed, authorized, audited, reversible and visible on every connected screen. The system behaves correctly under concurrent edits, under authorization boundaries and under a failing upstream feed.
2. **An agent can build almost anything in it.** An external MCP client, given only the tool descriptions and the resources, composes panels, rules, forms, grants and analyses out of the same primitives a human uses. The claim is bounded. The agent can build any panel the expression grammar and the visual set can express. It cannot build arbitrary UI. The bound is written in the rehearsal notes and is measured by the pre-registered gate in `08-testing-and-observability.md`.

### 1.2 The users and the principals

Three audiences are served by the same primitives:

- **Operations engineers** who watch fulfilment and need drill-down during an incident.
- **Platform and security staff** who must answer "who can see this, and what changed?" without reading code.
- **Engineers and analysts** who ask questions in plain language and expect a live answer as a panel, not as a paragraph.

The demonstration uses four stable human and agent identities and two services, all seeded. They are fixed by the README and are not renamed here.

| Principal | Kind | Role in the demonstration | Window |
|---|---|---|---|
| `user:ops-lead` (Maya Ortiz) | human | Presenter's identity; delegates to the agent | Ops board (room display, wide) |
| `user:emea-lead` (Jonas Becker) | human | EMEA regional lead; holds an EMEA-only read grant on the Ops board | Exec view (room display) |
| `user:finance-analyst` (Priya Nair) | human | Owns the finance board; approves the agent's grant proposal | Finance window (room display, small) |
| `agent:claude-code` | agent | External MCP client acting `on_behalf_of` `user:ops-lead`, within the ceiling in `03-authorization-and-security.md` | Claude Code terminal |
| `service:replay-driver` | service | Fallback driver; replays recorded steps with recorded `on_behalf_of` | none |
| `service:rule-worker`, `service:ingest`, `service:gen` | service | Platform workloads | none |

Two further windows sit on the presenter's second display. The **Phone** window is narrow, at phone width, and signed in as `user:ops-lead`. The **presenter console** shows the virtual clock, the driver mode (live or replay), the step list, the slack pool and the fault cue. The console is not an agent capability (section 2.7, D-INF-2).

**Guarantee:** the principal and window assignments above match the seeded identities in `plinth-gen` and the Keycloak realm export (AC-01-DEM-5).

### 1.3 The data the demonstration is about

Northwind Fulfilment is a fictional online retailer. Its order pipeline is produced by `plinth-gen`, a seeded deterministic generator (xoshiro256** PRNG, seed committed to the repository). It is the only data source in the demonstration. No paid or external service is involved.

- **Regions:** NA, EMEA, APAC, LATAM, ANZ. **Carriers:** Crane, Swift, Harbor, Polar, Meridian.
- **Sources:** `orders`, `carrier_scans`, `warehouse_capacity`, plus the metadata sources `audit.changes`, `lineage.edges`, `workflow.instances`, `workflow.transitions`, `query.runs` and `rule.firings`. Metadata sources are ordinary queryable relations (section 2.3, L7, and section 2.4, G1).
- **History:** 30 days of generated orders, ending at 14:30 on a fixed virtual demo date. The history is generated once at build time and stored as immutable Parquet partitions with a manifest. A design target of about 2.4 million order rows is a measured quantity, not a claim.
- **The 14:05 episode:** the history contains a seeded `FaultProfile` for EMEA and Crane. The handoff stage (packed to handed to carrier) ramps from 14:00 to 14:05, holds until 14:20 and returns to normal by 14:25. The multiplier is a seeded parameter (1.0 to 2.2 in the profile file).
  **Guarantee:** the episode is present in the history and the rule of section 1.4 beat 4 fires once across the 30 days (AC-01-LOG-5).
- **The live fault:** the presenter's cue F7 applies a `FaultProfile` of the same type, for the same region and carrier, at the next generator tick. The tick is recorded. It is the same causal path as the 14:05 episode.
  **Guarantee:** the cue produces the same events on replay at the same recorded tick (AC-01-DEM-3).
- **Virtual clock:** the demonstration clock runs at 6x wall time while the script is live, so a three-minute held breach on the virtual clock takes about 30 seconds of wall time. The clock is paused at 14:30 at the start of the script.

### 1.4 The core demonstration narrative

The script is five minutes, with a hard maximum of 300 s (P19). Times are presenter cues from the README; the exact script with prompts is in `../presentation-script.md`. The beats below are the ones that the capability inventory in section 2 maps to.

| # | Time (s) | Beat | What the audience sees | Strongest capabilities |
|---|---|---|---|---|
| 1 | 0–25 | Three screens, one board | The same board on three windows. Presence badges show the three humans. A KPI tile ticks from the live feed. | S1, V8, P4, V2 (KPI with sparkline) |
| 2 | 25–55 | Show the question | Prompt: "Show p95 fulfilment latency by region for the last hour." A time-series line panel materialises on every screen. The Exec view shows EMEA rows only. | P3, P4, P1, V1, V2, G4, G7, G11 |
| 3 | 55–95 | Diagnose | Prompt: "Why did p95 jump at 14:05? Break it down by carrier, compare with yesterday, and check for config changes." A red carrier-by-region heatmap sits beside a flat control heatmap. The audit panel reads "0 changes in window". The watermark is printed on the heatmap. | P5, V2 (heatmap), C2 (control window), G1 (attribution as source), P3 |
| 4 | 95–125 | Brush and alert | The presenter brushes the line chart and clicks the red cell. This sets session state only. Prompt: "Alert me if any region's p95 stays above 900 ms for three minutes." The rule appears with a 30-day backtest showing exactly one firing. | V4, R2, L1, L2, L3, L7, L8, G11 |
| 5 | 125–160 | Access | Prompt: "Who can see the finance board? Let the EMEA lead see only EMEA rows." The agent reports before and after counts. The proposal is held. The finance analyst approves it in her window. The Exec view loses non-EMEA rows in place. The inspector shows different `policy_hash` values. | P6, G7, G8, G9, G10, G11, S5, R9 |
| 6 | 160–190 | Stale base | The agent reads the EMEA panel and holds at revision r. The presenter edits the title, producing r+1. The agent's two-path change gets `CONFLICT` on the title path. The agent re-reads and commits only the width. | V9, V8, P2, S3, R7, R4 |
| 7 | 190–205 | Undo | The presenter clicks Undo on the grant row in the audit panel. The Exec view regains its rows. | G2, G1, P2 |
| 8 | 205–235 | The live fault | The presenter presses F7. The fault ramps. The rule goes `pending`, then `firing`. A workflow instance opens and toasts appear on all screens. "Nobody asked the agent to watch for this." | L1, L2, L4, L3, S1, V8 |
| 9 | 235–258 | Build a form | Prompt: "Build an acknowledge form on the incident card with a note field, and a timeline of its state changes." The form appears on the Phone and the timeline on the Ops board. | V5, L3, L4, P5, V1, V10 |
| 10 | 258–268 | Acknowledge | The presenter taps Acknowledge on the Phone. The workflow moves to `acknowledged` on every screen. The audit row reads `user:ops-lead`, surface `ui`. | L4, L3, G1, S1, V5 |
| 11 | 268–300 | Finale | Prompt: "What did this incident touch? Build it." An "Incident blast radius" panel composed from `lineage.edges`, `orders`, `audit.changes` and `workflow.transitions`. Every count links to its query. | L7, P3, G1, L4, V1, V2 (bar, table, lineage graph), S3 |

**Narrative arc.** Beats 1–2 establish purpose and show the first answer, inside the first 30 seconds of the brief. Beats 3–7 are the enterprise argument: evidence with a control, an access decision that a person approves, a concurrency rule that is visible, and an undo that is an audited change. Beats 8–10 show that the platform acts without being asked and that its write-back is ordinary. Beat 11 is the finale.

**Why the finale is the strongest moment.** The brief requires the strongest moment in the final 30 seconds. The blast-radius panel answers a question that no feature was written for. It is assembled by the agent from three ordinary sources: lineage, orders and audit. The acknowledge form before it is supporting, and the audience sees it as ordinary write-back. This is the emergent-composition claim made visible.

**Content constraints.** The agent's prose may quote only numbers that are on screen beside their query result and watermark. The agent receives the tool list, the resources and the prompt text, and no description of Plinth internals. Human steps are Changes with surface `ui`, or surface `driver` when replayed (section 2.7).

### 1.5 Fallback and reliability are part of the narrative

The live agent is the default. The recorded fallback issues the same MCP calls against the same platform, so the result on screen is the result of real calls, not a canned animation.

- **Switch.** One keystroke, `F9`, at a step boundary. Nothing on the room display changes except the trace tag (R1).
- **Automatic switch.** Two errors on one step, or a step over its latency budget (12 s for a query step, 20 s for a multi-call step).
- **Trust disclosure.** Every agent call on the trace ribbon is tagged `live` or `replay`; human gestures are tagged `ui` and worker effects `system`. The tag is a deliberate disclosure. It is explained in one sentence in rehearsal.
- **Takeover rule.** Each step has a satisfaction predicate over current state. The driver skips satisfied steps and never inverts another principal's changes (section 2.7, D-INF-3).
- **Measurement.** The rehearsal reports the live takeover rate per step over at least 10 model-in-the-loop runs. Steps above a pre-registered threshold are replay-by-default (D-INF-5).

**Guarantee:** the replay of a recorded session reproduces the result hash of every query step and the change hash of every Change, locally and on staging (AC-01-DEM-2). The platform is not claimed to be deterministic under a live agent. It is claimed to be deterministic under replay, and bounded under any agent by its ceiling, its previews and its audit trail.

The script is one path through the platform. Every capability in section 2 is usable through all four surfaces and is tested without the script, which is why each row carries its own acceptance criteria.

---

## 2. Detailed feature inventory

### 2.0 Counting rule and status

The inventory separates four kinds of entry.

- **Capability.** A product feature, addressable through the UI, the HTTP API and the MCP server. Counted. Each has a status:
  - **Demonstrated:** visible in a beat in section 1.4, or in an MCP call the trace ribbon shows in a beat.
  - **Supporting:** real, tested and not shown on stage.
- **Rule or protocol (R-rows).** A constraint that applies to capabilities. Not counted as a feature, but each has acceptance criteria.
- **Composed behaviour (C-rows).** A demonstrated outcome built from capabilities. It is not a separate feature. It is listed to make the composition explicit (section 2.9).
- **Demonstration infrastructure (D-INF rows).** Machinery that makes the demonstration reliable. It is not a product capability and is not counted.

**Counts.** Forty-five capabilities: 31 demonstrated and 14 supporting. Nine rules and protocols. Seven demonstration-infrastructure items. Five composed behaviours.

This supersedes the revised proposal's count (stated as 38 rows, while its tables list 39, 28 demonstrated). Rules that were rows are now R-rows, and the infrastructure that drives the script is listed apart as D-INF rows.

Acceptance-criteria ids use `AC-01-<area>-<n>` (the document-number prefix follows README ruling 20), where the area is `KER`, `PRE`, `LOG`, `GOV`, `SRF`, `RUL`, `CMP` or `DEM`.

### 2.1 Kernel primitives (6 capabilities, all demonstrated)

| ID | Capability | Status | Composes with | Beats |
|---|---|---|---|---|
| P1 | **Node.** Typed document with a stable URI `plinth://<workspace>/<kind>/<id>`; id is UUIDv5 of workspace and slug; carries a revision. | Demonstrated | All | 2, 9, 11 |
| P2 | **Change.** Atomic path operations with base revision, actor, on-behalf-of, surface, idempotency key, inverse ops. The only write path. | Demonstrated | Node, Audit, Undo, Realtime, Grant, Approval | 2, 6, 7, 10 |
| P3 | **Query.** Expression tree over sources with explicit `as_of`. One compiler to parameterised DuckDB SQL. The only read path. | Demonstrated | Source, Panel, Rule, Export, Grant, Form | 2, 3, 11 |
| P4 | **Source.** Typed relation over immutable partitions with schema, watermark and lineage. | Demonstrated | Query, Lineage, Rule, Grant | 1, 2, 3 |
| P5 | **Parameter.** Typed named value with default and bindings. Flows control to query to panel. | Demonstrated | Panel, Query, Dashboard, Form | 3, 9 |
| P6 | **Grant.** Principal, action set, resource pattern, row predicate, column mask. The input to `authorize`. | Demonstrated | Query, Node, Change, Audit | 2, 5 |

### 2.2 Presentation and interaction

| ID | Capability | Status | Composes with | Beats |
|---|---|---|---|---|
| V1 | **Panel.** A node whose data is one query result, a visual and interactions. Data and rendering are separate concerns. | Demonstrated | Query, Parameter, Rule, Export | 2, 3, 9, 11 |
| V2 | **Visual types.** Bar, table, KPI tile with sparkline, heatmap, time-series line with brushing, lineage graph (node-link, ECharts graph series). Each maps result columns to typed channels; none has private data access. | Demonstrated | Panel | 1, 2, 3, 9, 11 |
| V3 | **Dashboard.** A grid of panels referenced by URI, with parameters and interactions. | Demonstrated | Panel, Parameter, Grant | 2, 3, 9 |
| V4 | **Cross-filter, brushing and click-to-set.** A mark sets a parameter. Brushing a time range sets an interval parameter. | Demonstrated | Parameter, Panel | 3, 4 |
| V5 | **Form.** Fields typed from a source schema; submit runs an Action as a Change. | Demonstrated | Action, Source, Workflow | 9, 10 |
| V6 | **Annotation.** Time-anchored note node. Renders on the time axis. | Supporting | Node, Panel, Audit | none |
| V7 | **Comment.** Flat comment on any node. Mentions create notifications. | Supporting | Node, Presence | none |
| V8 | **Presence and cursors.** Non-authoritative state keyed by node URI, held in Redis. The agent principal has presence like a human, shown as a labelled marker. | Demonstrated | Realtime, Grant | 1, 6 |
| V9 | **Collaborative editing.** Path-level three-way merge with conflict payloads. Text fields are last-writer-wins with the conflict surfaced. | Demonstrated | Change, Presence | 6 |
| V10 | **Layout.** Grid layout as data in the Dashboard document, with a phone-width breakpoint. Edited through the same Change. | Demonstrated | Dashboard | 9 |
| V11 | **Embedding.** A signed, scoped iframe of one Dashboard, backed by a grant to an external origin with a fixed row predicate. | Supporting | Grant, Dashboard | none |

**Visual channels.** Visual types are fixed sets of channels. A field that maps to no channel is a validation error, not a silent drop. Area, scatter, sankey and geo map are supported and tested (amendment P1). They are not on stage. Geo map needs a bundled GeoJSON asset; the asset's size is reported in the build output, not assumed here.

### 2.3 Logic and automation

| ID | Capability | Status | Composes with | Beats |
|---|---|---|---|---|
| L1 | **Rule.** A query, a predicate, a hold duration and actions. States `ok`, `pending`, `firing`, `resolved`. Each firing has a `firing_id` and produces one notification. | Demonstrated | Query, Action, Workflow, Audit | 4, 8 |
| L2 | **Threshold predicate.** A typed predicate over query output rows, for example `p95_latency_ms > 900`. | Demonstrated | Rule, Panel | 4, 8 |
| L3 | **Action.** A typed, previewable side effect with a declared input schema, declared effects (Change paths and notification channels) and a declared permission. It cannot write a path it did not declare. | Demonstrated | Form, Rule, Workflow, Grant | 4, 8, 10 |
| L4 | **Workflow.** A state machine over rule firings, action results and human steps. Each instance is a node with a state and a transition history. | Demonstrated | Rule, Action, Form, Audit | 8, 9, 10 |
| L5 | **Scheduled export.** A query serialised to CSV or Parquet, with a schedule and a destination. Subject to the same grants and masks. | Supporting | Query, Action, Grant | none |
| L6 | **Computed metric.** A named expression reused across queries and expanded by the compiler. | Supporting | Query, Lineage | none |
| L7 | **Lineage.** Field-level for queries, path-level for Changes. Derived from query ASTs and Action declarations. Queryable as the `lineage.edges` source. | Demonstrated | Query, Source, Change | 4, 11 |
| L8 | **Backtest.** A rule's query replayed over the trailing 30 days in windows of the hold duration, as the rule's owner principal, with the live compiler. | Demonstrated | Rule, Query | 4 |
| L9 | **Anomaly window.** Trailing z-score window function. A labelled statistical window, not a learned model. | Supporting | Query, Rule | none |
The control-window comparison that beat 3 relies on is not a separate logic feature. It is a composed behaviour, C2 in section 2.9.

### 2.4 Governance and history

| ID | Capability | Status | Composes with | Beats |
|---|---|---|---|---|
| G1 | **Audit and attribution.** Append-only, hash-chained change log with actor, on-behalf-of, surface and session. Readable as the `audit.changes` source, so "who changed this?" is a query. | Demonstrated | Change, Source | 3, 7, 10, 11 |
| G2 | **Undo.** Appends the inverse Change; never rewrites history. Works across principals with write access to the same paths. Audited with `undo_of`. | Demonstrated | Change, Audit | 7 |
| G3 | **Branch and merge of one Dashboard.** Named head pointers and a Change-based merge. Tested, not shown. | Supporting | Change, Diff | none |
| G4 | **Diff.** Structural, path-level. The preview diff is the diff stored in the audit row. | Demonstrated | Change, Branch | 2 |
| G5 | **Templates.** A Node with a declared parameter list. Not a marketplace. | Supporting | Node, Parameter | none |
| G6 | **Multi-tenancy.** Workspace is a hard partition added by the compiler to every query. | Supporting | Grant, Query | none |
| G7 | **Row and column security.** A row predicate and a column mask, compiled into the query. A masked column is not referenceable downstream. | Demonstrated | Grant, Query, Export | 2, 5 |
| G8 | **Approval.** A Change held pending until a named human approves. Used for grant proposals from the agent. | Demonstrated | Change, Workflow, Grant | 5 |
| G9 | **Separation of duties.** The requester of a held change, its `on_behalf_of` principal and any principal that delegated to the requester cannot approve it. An approver needs `approval:decide` plus `grant:write` on the resource. In the demonstration the approver is `user:finance-analyst`, shown on screen. | Demonstrated | Approval, Grant, Audit | 5 |
| G10 | **Explainable grant decisions.** `grant.check` returns the grants, predicates and masks from the same evaluation that authorizes the query, with `proposed` and `with_counts` for before and after row counts. Denials name the grant id, never the hidden value. | Demonstrated | Grant, Query, Approval | 2, 5 |
| G11 | **Agent principal with a ceiling.** The agent acts as its own principal, `on_behalf_of` a human. Effective permissions are the intersection of the human's grants, the agent's `max_scope`, and the token scope. Rules created by the agent are owned by the agent with the human as `on_behalf_of`. | Demonstrated | Grant, Rule, Approval, Audit | 2, 4, 5 |

### 2.5 Surfaces and transport

| ID | Capability | Status | Composes with | Beats |
|---|---|---|---|---|
| S1 | **Realtime channel.** One WebSocket endpoint `/rt`. Subscriptions by node URI or query handle with last-seen revision. Resume from the change log or from a snapshot. Change batches ordered by `seq`, and keyed result diffs. | Demonstrated | Change, Query, Presence | all |
| S2 | **HTTP API.** OpenAPI 3.1 generated from the spec schema, not hand-written. | Supporting | Node, Change | none |
| S3 | **MCP server.** Fifteen tools, six resource templates and three prompts, as a thin adapter over the same verbs. Tools: `schema.describe`, `node.get`, `node.search`, `source.list`, `query.run`, `query.explain`, `node.preview`, `node.commit`, `node.delete`, `node.undo`, `change.history`, `diff`, `grant.check`, `ui.present`, `change.status`. Signatures are in `06-mcp-server.md`. | Demonstrated | All | 2–11 |
| S4 | **Command-line client.** `plinth apply` and `plinth diff` apply documents from git through the same commit path. | Supporting | Node, Change, Diff | none |
| S5 | **`change.status`.** Read-only. Returns the state of a held Change from the state machine in `03-authorization-and-security.md` section 7.1 (`proposed`, `pending_approval`, `approved`, `committed`, `rejected`, `withdrawn`, `expired`, `stale`), with the approver's identity. Lets the agent tell the presenter that a change is waiting. | Demonstrated | Approval, Change | 5 |
| S6 | **MCP resources and subscriptions.** Six resource templates (`plinth://schema/{kind}`, `plinth://node/{workspace}/{node_id}`, `plinth://sources/{source_id}`, `plinth://examples/{kind}/{variant}`, `plinth://audit/{workspace}/{seq}`, `plinth://workspace/{workspace}/catalogue`). A change to a subscribed node sends `notifications/resources/updated`. | Supporting | Realtime, Node | none |
| S7 | **MCP prompts.** `build-panel`, `investigate-spike` and `grant-review`. Each is a sequence of tool calls, with no data and no secrets. | Supporting | MCP | none |
| S8 | **Budgets and rate limits.** Default and maximum `limit`, cursors and byte budgets for every list-returning tool. Token buckets per principal and per tool with cost weights. | Supporting | MCP, Query | none |

### 2.6 Rules and protocols (R-rows, not counted)

| ID | Rule | Source | Tested by |
|---|---|---|---|
| R1 | **Trace ribbon on every screen.** A thin strip lists each MCP and API call: tool, one-line argument summary, status, change sequence, principal, and a mode tag: `live` or `replay` for agent calls, `ui` for human gestures, `system` for worker effects. | 02, P4 | AC-01-RUL-1 |
| R2 | **Session state is not history.** Parameters, brushing, cross-filter and drill state live in the URL and the session. They create no revision and no audit row. Saving them is an explicit Change. | 02, P3 | AC-01-RUL-2 |
| R3 | **Animation honesty.** A UI element animates only in response to a sequence-numbered change event or a user gesture. Panels materialise on commit with the change sequence shown in a corner chip. No decorative or timed animations. | 02, P2 | AC-01-RUL-3 |
| R4 | **Response envelope and error codes.** Every MCP response is `{ call_id, trace_id, ok, data | error, next, warnings, budget }`, where `trace_id` equals the root span id (ruling 10). Errors carry a code from the closed 15-code set in `06-mcp-server.md` section 3, the exact JSON path, the expected type or allowed values, and a machine-applicable suggestion. `LOOP_SUSPECTED` is returned on the fourth identical refused call, which is not executed. | 06, 05, P5 | AC-01-RUL-4 |
| R5 | **Preview then commit, with single-use tokens.** Agent writes always go preview then commit. Tokens and idempotency records live in Postgres. A token is consumed inside the commit transaction. Redis is not referenced by any invariant. | revised D.6, A-W3 | AC-01-RUL-5 |
| R6 | **Closed commit-rule table.** Every agent write is classified by a closed table of named rules, for example `R-PANEL-CREATE` (auto-commit after preview), `R-GRANT` (approval required), `R-ACTION-EXTERNAL` (approval required). The rule id appears on the commit card. | 06, P6 | AC-01-RUL-6 |
| R7 | **Merge rule.** A Change whose base equals head applies. Otherwise, disjoint paths rebase with `merged_from`, and intersecting paths return `CONFLICT`. The rule is stated once and the stale-base beat follows it exactly. | P13, revised D.6 | AC-01-RUL-7 |
| R8 | **Untrusted data is structural.** Every string from data (rows, titles, comments, annotations) is returned inside `{ "untrusted": "..." }`, whatever its field name. Data cannot grant a permission, change a scope or produce a preview token. | 05, 06, P14 | AC-01-RUL-8 |
| R9 | **Per-principal result identity.** The result cache key is `(query_hash, policy_hash, parameter_values, as_of)`. `policy_hash` covers the workspace predicate, the row predicate per source, the column-mask set and versions. `query.explain` prints the `policy_hash` and the injected predicates. | 01, P17, revised A-W1 | AC-01-RUL-9 |

### 2.7 Demonstration infrastructure (D-INF rows, not counted)

| ID | Item | Purpose | Source | Tested by |
|---|---|---|---|---|
| D-INF-1 | Replay driver (`plinth-driver`), a principal of its own | Executes recorded human steps with `on_behalf_of` set to the recorded human, holding `driver:execute` plus the recorded principal's effective permissions for each step (README ruling 16). It never approves; approvals stay live human actions. Every replayed change row has `surface = 'driver'` and `replay_of` set to `'<transcript_id>:<step>'`, which is included in the chain row hash and excluded from `change_hash` (ruling 6). Never uses the presenter's session. | P9 | AC-01-DEM-2 |
| D-INF-2 | Presenter console and fault cue API | The fault cue (F7) goes to a presenter control API on a separate port with a separate credential. It is absent from the MCP tool list and from the agent's grants. Cue applied at the next generator tick, recorded. | P15, C-W3 | AC-01-DEM-1 |
| D-INF-3 | Satisfaction predicates and takeover | Each script step has a predicate over current state, for example "a Panel on ops-board whose query groups orders by region and aggregates p95 latency". The driver skips satisfied steps and handles creates whose node already exists by slug. It refuses with "reset required" only when a predicate is unsatisfiable. | P10 | AC-01-DEM-3 |
| D-INF-4 | Slack pool and step budgets | Each step has a budget. A shared slack pool is shown on the presenter console. When it is exhausted, the driver takes the next step. The script has a hard maximum of 300 s. | P19 | AC-01-DEM-4 |
| D-INF-5 | Takeover-rate measurement | The rehearsal reports the live takeover rate per step over at least 10 model-in-the-loop runs. Steps above a pre-registered threshold are replay-by-default and the trace ribbon says so. | P18 | AC-01-DEM-6 |
| D-INF-6 | Reset | `make demo-reset` restores the control store from a snapshot and points the workspace at the immutable history manifest under a new run prefix. | revised E.4 | AC-01-DEM-7 |
| D-INF-7 | Rehearsal harness | `make rehearse`, a Playwright run across four windows plus the replay driver. It waits on the page's realtime sequence number, not on timeouts. | README, revised E.4 | AC-01-DEM-8 |

### 2.8 Composition map and node-kind coverage

**Composition edges.** These are real dependencies in code. An arrow means the target consumes the source's output or reuses its machinery.

```
                     Grant (P6) + ceiling (G11)
                     row predicate, column mask, grant.check (G10)
                              │
Source (P4) ──► Query (P3) ──► Panel (V1) ──► Dashboard (V3) ◄── Parameter (P5) ◄── Cross-filter (V4)
   │               │   ▲            │                                   
   │               ▼   │            ▼                                   
   │          Rule (L1) ──► Action (L3) ──► Workflow (L4) ──► Form (V5)
   │               │                             │                │
   │               ▼                             ▼                ▼
   │          Backtest (L8)             Approval (G8, G9)     Change (P2)
   │                                                              │
   └── Lineage (L7) ◄─────────────────────────────────────────────┤
                                                                  ▼
                    Audit (G1) ◄── Change log (hash chain) ──► Undo (G2)
                        │                    │                       │
                        ▼                    ▼                       ▼
                 Audit as Source         Diff (G4)            Realtime (S1)
                 (attribution)                                      │
                                                      Presence (V8) / Collaboration (V9)
                                                                    │
                                                      UI · HTTP API · MCP (S3)
```

Three compositions carry most of the surface.

1. **Query feeds everything.** Panels, rules, backtests, exports, form lookups, row predicates and the agent's own questions call one compiler. An export or an alert cannot bypass a row predicate, because there is no second read path.
2. **Change is the only write.** A panel edit, a layout move, a grant, a threshold change, a form submit, an undo and an agent commit are all Changes. One audit table, one undo and one real-time stream cover them all.
3. **Metadata is a source.** Audit and lineage are tables the query layer reads. "Who changed the finance board in the last ten minutes?" and "what depends on `fulfilled_at`?" are ordinary queries.

**Node kinds mapped to capabilities.** The fifteen kinds of the specification language, and where each is implemented:

| Kind | Capability | Kind | Capability |
|---|---|---|---|
| Dashboard | V3 | Workflow | L4 |
| Panel | V1 | Grant | P6, G10, G11 |
| Query | P3 | Metric | L6 |
| Source | P4 | Template | G5 |
| Parameter | P5 | Export | L5 |
| Rule | L1, L2 | Annotation | V6 |
| Action | L3 | Comment | V7 |
| Form | V5 | | |

### 2.9 Composed behaviours demonstrated on stage (C-rows)

Each is an outcome built from capabilities that are listed above. No C-row is a separate feature.

| ID | Behaviour | Composed from | Beat | Test |
|---|---|---|---|---|
| C1 | **Stale-base merge.** The agent's two-path change is rejected on the path touched by the human, and the agent's width change is committed on the new revision. | P2, R7, V9, V8, R4 | 6 | AC-01-CMP-1 |
| C2 | **Control-window comparison.** A breakdown over the incident window and over a control window (yesterday 14:00–14:20), shown as two heatmaps. A seeded cause shows as a cause in one window and as "no cause" in the other. | P3, P5, V2, G1 | 3 | AC-01-CMP-2 |
| C3 | **Agent-owned rule with an effective principal.** A rule the agent creates runs its action under the intersection of the human's grants, the ceiling and the action's permission, and the firing records that intersection. | L1, L3, G11, G1 | 4 | AC-01-CMP-3 |
| C4 | **Incident card.** A form, an action, a workflow and a timeline panel, added to the Phone and Ops board by the agent, which the human then acts on. | V5, L3, L4, V1, V10 | 9–10 | AC-01-CMP-4 |
| C5 | **Blast-radius analysis.** A table, a bar and a count set built from `lineage.edges`, `orders`, `audit.changes` and `workflow.transitions`. Each count links to its query. | L7, P3, G1, L4, V1, V2 | 11 | AC-01-CMP-5 |

---

## 2.10 Capabilities explicitly out of scope

These are not part of this specification and must not be presented as features. Each is listed so that the composition argument does not overclaim.

- An LLM embedded in the platform. The platform is deterministic code; the agent is external.
- Incremental view maintenance. Large queries are re-executed in full, coalesced to one run per second per query.
- Learned anomaly detection. L9 is a statistical window function only.
- Cross-workspace queries.
- Column-level lineage across external systems. Lineage is internal to the workspace.
- Concurrent text merging. Text fields are last-writer-wins with the conflict surfaced. Two edits to the same text are not merged.
- CRDT replication, tree move operations or branch merge as a stage feature. Path-level merge is the rule.
- A template marketplace, a comment inbox, field-level presence.
- An embedding SDK or a theming API. Embedding is an iframe with a signed token.
- Multi-approver approval. An approval has one named approver.
- Agent-written grants. The agent proposes; a human approves.
- Agent-to-agent delegation beyond the single ceiling per agent principal.
- Sankey and geo map on stage. They are supported, tested and not shown.
- Stdio MCP transport on AWS. It is intended, and it is local-only.
- A real operational system as the data source. The seeded generator is the only source.
- Any claim that the platform is deterministic under a live agent.

---

## 2.11 Acceptance criteria

Each criterion names its test. Test names are the ones carried by the CI and rehearsal suites, or new names defined in `08-testing-and-observability.md`. Labels are at the end of each line.

### Kernel

| ID | Criterion | Test | Label |
|---|---|---|---|
| AC-01-KER-1 | For every node, the URI is `plinth://<workspace>/<kind>/<id>` with id = UUIDv5(workspace, slug). Two replays of the seeded history produce identical URIs for every node. | `uri_stable_replay` | Guarantee |
| AC-01-KER-2 | No code path writes a node head without a change row in the same transaction. | `change_is_only_write` | Guarantee |
| AC-01-KER-3 | 200 concurrent commits across 20 nodes in one workspace produce no fork, and `workspace_chain.head_seq` equals the row count. | `chain_linear_under_concurrency` | Guarantee |
| AC-01-KER-4 | 1,000 random valid Change sequences, applied through HTTP, MCP, CLI and UI API in fresh workspaces, produce identical `body_hash` per node. Only the `surface` column differs. | `commit_equivalence` | Guarantee |
| AC-01-KER-5 | No route returns source rows except through query execution. Every route in the OpenAPI document is checked against the list of read routes. | `single_read_path` | Guarantee |
| AC-01-KER-6 | Changing a parameter re-executes exactly the queries bound to it. The cache key changes if and only if the resolved value changes. | `param_cache_key` | Guarantee |
| AC-01-KER-7 | A panel's result carries the watermarks it read. No query reads a partition before its rename-then-publish. | `partial_partition_invisible` | Guarantee |
| AC-01-KER-8 | Row predicates attach to the source relation before any operator, so joins and unions cannot leak rows. | `rls_differential` | Guarantee |

### Presentation

| ID | Criterion | Test | Label |
|---|---|---|---|
| AC-01-PRE-1 | A panel's rendered data has the same result hash as `query.run` with the same parameters and `as_of`. | `panel_equals_query` | Guarantee |
| AC-01-PRE-2 | A field that maps to no visual channel is rejected with `VALIDATION_FAILED` and its JSON path. It is never dropped silently. | `channel_strict` | Guarantee |
| AC-01-PRE-3 | Each visual type in V2 renders a fixed reference result to the reference snapshot, in light and dark themes. | `visual_snapshots` | Guarantee |
| AC-01-PRE-4 | Clicking a heatmap cell or brushing a line sets parameters, creates zero revisions and zero `changes` rows. | `session_state_no_history` | Guarantee |
| AC-01-PRE-5 | Form field types derive from the source schema. Submit creates one Change through the declared Action and nothing else. | `form_through_action` | Guarantee |
| AC-01-PRE-6 | Presence updates are throttled to at most 5 per second per node. The agent's cursor appears as a labelled marker. | `presence_throttle` | Guarantee |
| AC-01-PRE-7 | A commit at phone width does not produce horizontal scroll in the Phone window at a 390 CSS px viewport. | `phone_layout_no_scroll` | Guarantee |
| AC-01-PRE-8 | A Dashboard references its panels by URI. Removing a reference is a Change. | `dashboard_refs_by_uri` | Guarantee |
| AC-01-PRE-9 | An embedded Dashboard token grants exactly one Dashboard and its fixed predicate. A token for any other node returns `FORBIDDEN`. | `embed_scope` | Guarantee |
| AC-01-PRE-10 | An annotation renders at its time anchor. A comment mention creates one notification. | `annotation_anchor`, `mention_notifies` | Guarantee |
| AC-01-PRE-11 | Commit-to-screen latency on one host, from commit to a second window, is under 300 ms at p95. | `commit_to_screen` | Target |

### Logic

| ID | Criterion | Test | Label |
|---|---|---|---|
| AC-01-LOG-1 | Rule transitions are only `ok`→`pending`, `pending`→`ok`, `pending`→`firing`, `firing`→`resolved`, `resolved`→`ok` and `resolved`→`pending`. Each firing has one `firing_id` and one notification. | `rule_fires_once_per_firing` | Guarantee |
| AC-01-LOG-2 | A threshold referencing an unknown field is refused at preview with `UNKNOWN_FIELD` and `did_you_mean`. | `threshold_typecheck` | Guarantee |
| AC-01-LOG-3 | An Action that writes a path it did not declare is refused. | `action_declared_paths` | Guarantee |
| AC-01-LOG-4 | A workflow instance has a state and a transition history. `acknowledged` is reachable only from `open`. | `workflow_transitions` | Guarantee |
| AC-01-LOG-5 | The seeded episode is in the history, and the 30-day backtest of the beat 4 rule over one-minute windows reports exactly one firing (EMEA, Crane, 14:03 to 14:20) and no other window. | `episode_in_history`, `backtest_fires_once` | Guarantee |
| AC-01-LOG-6 | Every expression form in the grammar has a lineage extractor. `lineage.edges` lists every node that reads a given field. | `lineage_complete_for_grammar` | Guarantee |
| AC-01-LOG-7 | A scheduled export has the same row set as `query.run` for its query, with masked columns absent. | `export_equals_query` | Guarantee |
| AC-01-LOG-8 | A computed metric expands in the compiled plan and gives the same result as its inline expression. | `metric_expansion` | Guarantee |
| AC-01-LOG-9 | The anomaly window reproduces reference z-scores on a seeded series to six significant digits. | `anomaly_reference` | Guarantee |

### Governance

| ID | Criterion | Test | Label |
|---|---|---|---|
| AC-01-GOV-1 | Every `changes` row has actor, surface and session. `on_behalf_of` is set for agent and driver rows. The chain verifies, and a single altered row is detected by `GET /audit/verify`. | `audit_chain_verify` | Guarantee |
| AC-01-GOV-2 | From a seeded workspace, 300 random Changes by mixed principals are undone in reverse. `body_hash` returns to the start, the chain verifies at each step, and `changes` has 600 unmodified rows. | `undo_roundtrip` | Guarantee |
| AC-01-GOV-3 | A Dashboard branch can be created, edited and merged. The merged result equals the same edits applied to the trunk directly. | `branch_merge_equivalence` | Guarantee |
| AC-01-GOV-4 | Applying the ops from `diff(a, b)` to `a` gives `b`. The preview diff equals the diff stored in the audit row. | `diff_roundtrip` | Guarantee |
| AC-01-GOV-5 | Instantiating a Template with fixed parameters gives a Dashboard whose `body_hash` matches the reference. | `template_instantiate` | Guarantee |
| AC-01-GOV-6 | A query in workspace A never returns a row from workspace B. The workspace predicate is the first predicate in the compiled plan. | `workspace_isolation` | Guarantee |
| AC-01-GOV-7 | A masked column and an absent column produce identical `UNKNOWN_FIELD` responses, so the mask is not revealed. | `mask_indistinguishable` | Guarantee |
| AC-01-GOV-8 | An agent-proposed grant is held as `pending_approval`. It commits only after an approval, and `change.status` reports the approver. | `approval_held_until_approved` | Guarantee |
| AC-01-GOV-9 | The requester, its `on_behalf_of` principal and its delegator cannot approve. The refusal is `FORBIDDEN` with reason `sod_violation`. The finance analyst can approve. | `separation_of_duties` | Guarantee |
| AC-01-GOV-10 | Without `grant:inspect`, `grant.check` answers only for the caller and its delegator; a count for another principal is returned as `row_counts: null` with `reason_code: not_permitted`. `with_counts` before and after values equal a hand-written predicate count on the seeded data. | `grant_check_bounded`, `grant_counts_reference` | Guarantee |
| AC-01-GOV-11 | Effective permissions are the intersection of the human's grants, `max_scope` and token scope. An agent proposal to grant access is held as `pending_approval`; an agent attempt to approve or force-apply a grant returns `FORBIDDEN` naming `grant:write`. A rule with a `grant:write` action is refused at preview. A rule with `action:notify` fires. | `agent_rule_notify`, `agent_grant_forbidden` | Guarantee |

### Surfaces

| ID | Criterion | Test | Label |
|---|---|---|---|
| AC-01-SRF-1 | A client resuming with a last-seen revision receives missed changes or a snapshot. A sequence gap triggers a refetch. Commit-to-screen is under the AC-01-PRE-11 target. | `resume_by_revision` | Guarantee (resume); Target (latency) |
| AC-01-SRF-2 | The OpenAPI 3.1 document is generated from the spec schema, and a diff against the committed document is empty. | `openapi_generated` | Guarantee |
| AC-01-SRF-3 | Exactly fifteen MCP tools exist, with the names and order in the README. Every tool's input schema validates against the registry. | `mcp_tool_registry` | Guarantee |
| AC-01-SRF-4 | `plinth apply` followed by `plinth diff` on the seeded dashboard reports no difference, and the apply appears in the audit with surface `cli`. | `cli_apply_diff` | Guarantee |
| AC-01-SRF-5 | `change.status` is read-only. It returns one state from the set in `03-authorization-and-security.md` section 7.1 (`proposed`, `pending_approval`, `approved`, `committed`, `rejected`, `withdrawn`, `expired`, `stale`), with the approver id or null. | `change_status_readonly` | Guarantee |
| AC-01-SRF-6 | A subscribed node change sends `notifications/resources/updated` in the same batch as the realtime push. | `resource_subscription` | Guarantee |
| AC-01-SRF-7 | The three prompts contain only tool-call sequences, with no data values and no secrets. | `prompts_static` | Guarantee |
| AC-01-SRF-8 | List tools honour default and maximum `limit`. Over-budget responses carry `truncated: true` and `next_cursor`. `schema.describe` without `kind` is at most 8 KB, and with `kind` at most 16 KB. | `budget_limits` | Guarantee |

### Rules and protocols

| ID | Criterion | Test | Label |
|---|---|---|---|
| AC-01-RUL-1 | Every MCP and API call appears on the trace ribbon with tool, argument summary, status, change sequence, principal and a mode tag (`live` or `replay` for agent calls, `ui` for human gestures, `system` for worker effects). Ribbon appearance is within the realtime target. | `ribbon_complete`; latency Target | Guarantee (content); Target (latency) |
| AC-01-RUL-2 | A session-state change creates zero `revisions` and zero `changes` rows. | `session_state_no_history` | Guarantee |
| AC-01-RUL-3 | A build-time check fails if any animation handler is reachable without an event id or a gesture id. | `animation_requires_event` | Guarantee |
| AC-01-RUL-4 | Every MCP response has `call_id`, `trace_id`, `ok`, `data` or `error`, `next`, `warnings` and `budget`. The fourth identical refused call returns `LOOP_SUSPECTED` and is not executed. | `envelope_shape`, `loop_suspected` | Guarantee |
| AC-01-RUL-5 | 500 random Change sets: the committed `body_hash` equals the previewed result, and the commit ops equal the previewed diff. Two concurrent commits with one token: exactly one succeeds. | `preview_is_commit`, `token_single_use_concurrent` | Guarantee |
| AC-01-RUL-6 | Every agent write is classified by one closed rule. An operation matching no rule is refused. Each rule has one test. The rule id appears on the commit card. | `commit_rule_closed` | Guarantee |
| AC-01-RUL-7 | Disjoint paths rebase with `merged_from`. Intersecting paths return `CONFLICT` with `conflicting_paths`, `head_revision`, `head_values_at_paths` and `your_values_at_paths`. | `merge_table` | Guarantee |
| AC-01-RUL-8 | Every free-text value from data appears inside `{ "untrusted": ... }`. A seeded annotation containing an injection attempt produces no Change and no grant. | `untrusted_envelope`, `injection_fixture` | Guarantee |
| AC-01-RUL-9 | Two principals with the same row predicate and different column masks have different `policy_hash` values and no shared cache entry. `query.explain` prints both values. | `cache_isolation` | Guarantee |

### Composed behaviours

| ID | Criterion | Test | Label |
|---|---|---|---|
| AC-01-CMP-1 | The stale-base beat reproduces: the agent holds revision r, the presenter's title edit produces r+1, the two-path change returns `CONFLICT` naming the title path, and the width-only retry commits at r+1. | `stale_base_playwright` | Guarantee |
| AC-01-CMP-2 | The control-window heatmap for a seeded cause shows no cause, and the incident-window heatmap shows the cell for EMEA and Crane. Both match reference results. | `control_window_reference` | Guarantee |
| AC-01-CMP-3 | A firing of an agent-owned rule records the three inputs of the intersection: the human's grants, the ceiling and the action's permission. | `firing_records_intersection` | Guarantee |
| AC-01-CMP-4 | The incident card, with form, action, workflow and timeline, is produced by agent Changes alone, and the acknowledge produces one Change with surface `ui`. | `incident_card_flow` | Guarantee |
| AC-01-CMP-5 | Each count in the blast-radius panel equals its linked query result at the pinned `as_of`. | `blast_radius_links` | Guarantee |

### Demonstration infrastructure

| ID | Criterion | Test | Label |
|---|---|---|---|
| AC-01-DEM-1 | The fault cue is absent from the MCP tool list and from the agent's grants. | `fault_cue_not_agent_capability` | Guarantee |
| AC-01-DEM-2 | Replay reproduces every query result hash and every change hash on the local stack and on staging. Each replayed row has `surface = 'driver'` and `replay_of` set. | `replay_reproduces` | Guarantee |
| AC-01-DEM-3 | The fault cue, applied at a recorded tick, produces identical generator events on replay. A step whose predicate is already satisfied is skipped without a change. | `fault_tick_determinism`, `takeover_satisfaction` | Guarantee |
| AC-01-DEM-4 | The script's total budget is at most 300 s, and the slack pool never goes below zero. | `script_budget` | Guarantee |
| AC-01-DEM-5 | The seeded principals, grants and window assignments match the README table. | `seed_identities` | Guarantee |
| AC-01-DEM-6 | The rehearsal report states the takeover rate per step over at least 10 runs. | `takeover_report` | Guarantee (report covering at least 10 recorded runs); Target (measured rate) |
| AC-01-DEM-7 | `make demo-reset` completes within 20 s on the rehearsal host. | `reset_time` | Target (measured) |
| AC-01-DEM-8 | The rehearsal drives all windows with no manual step other than the scripted presenter actions. | `rehearse_end_to_end` | Guarantee |

---

## 2.12 How breadth emerges from the kernel

Plinth does not contain a separate feature for most of the rows in section 2. Breadth comes from how a small number of mechanisms are combined.

- **One document, many kinds.** Dashboards, rules, forms and grants share one envelope, revision model and reference scheme. A new kind adds a schema, not a subsystem.
- **One read path, one write path.** Every question is a Query over a Source, including questions about the platform's own audit and lineage. Every change, including undo and approval, is a Change with preview, audit and realtime fan-out.
- **One authorization function.** Every decision goes through `authorize`, and grant explanations come from the same evaluation.
- **Generic verbs.** The agent uses fifteen verbs over one grammar, so a new node kind extends what the agent can do without a new tool.

The composition claim is tested, not asserted. The 13-question evaluation in `08-testing-and-observability.md` includes three cross-kind composition questions, and its gate is pre-registered before the tool surface is frozen.

---

## 2.13 Decisions taken in this document

These resolve conflicts between the canonical inputs. Each is consistent with the precedence rule.

1. **Beat times and prompt wording** follow the README, not the revised proposal's times and variants.
2. **Beat 2 visual** is a time-series line (README, P1). The revised bar panel moves to beat 11, showing counts by carrier.
3. **Room display** shows the Ops board, Exec view and Finance window, with the trace ribbon on every screen (README, P4).
4. **The finance analyst approves** the grant in her window (README, P7), not the presenter as the revised proposal has it.
5. **Counts for another principal** in beat 5 need `grant:inspect`, which satisfies P8 under README ruling 1. The agent ceiling holds `grant:inspect`, and never `grant:write` or `approval:decide`.
6. **`lineage.dependents(...)`** in the revised beat 11 is not a canonical source. It is a query over `lineage.edges` with a field filter.
7. **Sankey and geo map** are supported and tested (P1), not "not in version 1" (revised G.5). Neither is on stage.
8. **Latency** has two Targets: 300 ms commit-to-screen on one host (AC-01-PRE-11) and the 2 s bound for the beat 10 status change.
9. **Tool count** is fifteen, including `change.status` (P11). The revised "fourteen" is superseded.
10. **Virtual clock rate** is 6x (`clock.speed = 6`), as fixed by README ruling 7.
