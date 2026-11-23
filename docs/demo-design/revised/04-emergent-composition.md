# Plinth: an emergent-composition operations platform

Competitor 04, revision 1. Mandate: **Emergent Composition**. Product title: **Plinth** (renamed from Tessera, see the revision log).

Design thesis: Plinth has one document model, one change log, one query compiler, one authorization function and one real-time channel. Every dashboard, panel, data source, rule, workflow, form, grant, export and undo is a node in that model, written in one specification language. The MCP server exposes the same model through fourteen generic verbs. An agent that has never seen Plinth can therefore compose capabilities that nobody wrote a feature for, and the demo shows three of them: an effective-access view, a stale-base merge, and a blast-radius analysis that the platform never had a feature for.

---

## Revision log

Each finding from the four reviews is listed once, with the response. "Fixed" names the section where the change lives. "Rebutted" gives the technical reason the finding was not acted on. "Accepted" names a known limitation that stays in the design and is stated in section G.5. Reviewer findings are cited as A, B, C, D with the item number (W for weakness, R for required change).

| Ref | Finding (short) | Response | Where |
|---|---|---|---|
| A-W1 | Cache key omits column-mask set; masked and unmasked principals share rows | **Fixed.** The cache key is now `(query_hash, policy_hash, parameters, as_of)`, where `policy_hash` covers the workspace predicate, the row predicate AST per source, the column-mask set, the mask version and the grant-index version. Test `cache_isolation`. | D.4, F claim 2 |
| A-W2 | Per-workspace hash chain with node-only locking forks | **Fixed.** A `workspace_chain` head row is locked `FOR UPDATE` as the first step of every commit transaction, so all commits in a workspace are serialised and the chain is linear by construction. Stated as the trade in G.5. Test `chain_linear_under_concurrency`. | D.2, D.6, F claim 1 |
| A-W3 | Preview tokens in Redis despite single-use invariant | **Fixed.** Preview tokens and idempotency records live in Postgres; the token is consumed inside the commit transaction. Redis is not referenced by any invariant. Test `token_single_use_concurrent`. | D.2, D.6, F claim 3 |
| A-W4 | Live feed streams while generator is "parked"; replay diverges on first query step | **Fixed.** Every query carries an explicit `as_of` (pinned during replay, virtual now live). Results include only events with event time at or before `as_of`, and the engine waits for the watermark to reach `as_of`. The generator is not parked; it does not need to be. | C.3, D.4, F claim 5 |
| A-W5 | 14:05 answer has no documented cause in the data | **Fixed.** The history contains a seeded `FaultProfile` for EMEA/Crane with a ramp from 14:00 to 14:05 and a hold to 14:20. The same profile type drives the live fault. Test `episode_in_history` and `backtest_fires_once`. | A, C.2, F claim 5 |
| A-W6 | `source.sample` returns raw rows outside the query compiler | **Fixed by removal.** `source.sample` is removed from the agent surface. Sampling is `query.run` with `limit`, which goes through the compiler, the workspace predicate, grants and masks. Tool count 15 to 14. | D.7 |
| A-W7 | Idempotency unique on `(workspace, key)`, not principal-scoped | **Fixed.** Unique on `(workspace_id, principal_id, idempotency_key)` plus a request hash; reuse with a different body returns `IDEMPOTENCY_KEY_REUSED`. | D.2, D.6 |
| A-W8 | Central bet gated at two of ten questions and tested last | **Fixed.** The agent-path evaluation moves before the tool surface is frozen (stage S5). The gate covers 13 questions (10 single-kind, 3 composition) with a pre-registered threshold. | C, F claim 5, H.4 |
| A-W9 | Attribution not a named primitive | **Fixed.** Attribution is a named capability row (G1 "Attribution": actor, on-behalf-of, surface, session, filterable as a source). The 60 to 100 s beat shows its query result on screen. | B.4, C.2 |
| A-W10 | Redis carries presence, fan-out, preview tokens and idempotent responses | **Fixed.** Redis carries presence and fan-out only. Fan-out is fed from a transactional `outbox` table in Postgres, so a lost Redis message is recovered by resume. | D.2, D.6 |
| A-R1 to R8 | Required changes | Each is addressed by A-W1 to A-W8 above; R1 (mask in key), R2 (chain head lock), R3 (tokens in Postgres), R4 (frozen generator and watermark binding; watermarks excluded from hashes), R5 (seeded episode), R6 (source.sample removed), R7 (principal-scoped keys), R8 (gate raised; evaluation before freeze). | as above |
| B-1 | Closing beat is an acknowledge form, which is ordinary write-back | **Fixed, partly rebutted.** The closing is now a blast-radius analysis composed from the lineage, orders and audit sources (C 270 to 300 s). The brief requires the strongest moment in the final 30 s, so it stays there; its content changes. The acknowledge form moves to 240 to 262 s, where it is supporting. | C |
| B-2 | 60 to 100 s why beat asserts a cause in prose | **Fixed.** The on-screen evidence is a heatmap query result with its watermark and a zero-row audit query. The agent's sentence may only quote numbers that are on the screen. | C 60 to 100 s |
| B-3 | 170 to 200 s drag-versus-agent race is nondeterministic | **Fixed.** Replaced with a deterministic stale base: the agent reads and holds on an explicit cue, the presenter edits the title, the agent then commits with its old base. | C 165 to 195 s |
| B-4 | Central agent bet measured only in rehearsal, no fallback view | **Fixed.** Pass rates per question, with failing runs shown, are published in the rehearsal report, and the evaluation runs before the surface freeze. | F claim 5, G.2 |
| B-5 | Inventory inflates composability | **Fixed.** 38 rows (down from 47). Visual types are one row. Branch merge is marked supporting because the script does not show it. 28 rows are demonstrated, and each is mapped to a beat. | B |
| B-6 | 6x clock produces silence on stage with no failure row | **Fixed.** The presenter console shows the virtual clock and a stall indicator; a G.2 row covers the stall. The fault cue is quantised to a generator tick. | C.3, G.2 |
| B-7 | Cancelled commit has unknown outcome; resolution rule unspecified | **Fixed.** Cancellation is honoured only before the commit transaction begins. The driver resolves an ambiguous commit by looking up the idempotency record: present means committed, absent means not committed and the token is still usable. | D.6, C.3 |
| B-8 | Name "Tessera" collides with proposals 02 and 06 | **Fixed.** Renamed to Plinth. This competitor did not read the other proposals, so collision checking against them is left to the integrator. | title |
| C-W1 | Replay checkpoint hashes include watermarks while the feed advances | **Fixed.** Watermarks are excluded from checkpoint hashes and recorded as informational. The trade is stated in F claim 5. | C.3, F claim 5 |
| C-W2 | Live idempotency keys vs. driver replay | **Fixed.** Replay commits use keys namespaced by transcript and step (`replay:<transcript>:<step>`). Before issuing a replayed commit the driver checks the change log for the expected change hash and skips the step if it is already present. | D.6, C.3 |
| C-W3 | Fault fires at scripted virtual offset, not on the presenter's cue | **Fixed.** Presenter cue (F7) is the trigger; the cue is applied at the next generator tick, and the tick is recorded. The scripted offset applies only if no cue arrives within 5 s of the step start. | C.2, C.3 |
| C-W4 | 14:05 spike has no defined generator | **Fixed.** Same as A-W5. | A, C.2 |
| C-W5 | Two reset mechanisms (replay seed vs. landing store load) | **Fixed.** One mechanism: reset restores the control store from a snapshot and points the workspace at an immutable history manifest. No 2.4 million row reload occurs. | E.4 |
| C-W6 | DuckDB extensions fetched at runtime; private subnets may fail | **Fixed.** Extensions are bundled in the image. A private-subnet startup test runs the first query with no NAT route. | E.4, H.1 |
| C-W7 | Replay tag shown to the audience conflicts with "invisible or one keystroke" | **Rebutted in part.** The switch stays invisible (F9 at a step boundary). The tag is shown in the trace panel, because it is the trust disclosure reviewer B values; the brief's invisibility requirement is about the switch, not the labelling. The decision is recorded in C.3. | C.3 |
| D-W1 | `node.undo` and `node.delete` are direct writes, breaking two-phase rule | **Fixed.** Both gain a preview variant returning a `preview_token`. For agent principals the token is required. | D.7 (tools 9, 10) |
| D-W2 | `grant.preview` used in script and Claim 2 but absent from catalogue | **Fixed.** `grant.check` takes `proposed` and `with_counts`, and returns the before and after row counts. The catalogue has no `grant.preview`. | D.7 (tool 13) |
| D-W3 | Claim 5 covers single-panel questions only | **Fixed.** Thirteen questions, three of them composition questions across kinds (rule plus action, form plus source, grant plus predicate plus panel). | F claim 5 |
| D-W4 | Generic-verb discoverability untested and not a gate | **Fixed.** Discoverability is the gate: the 13-question evaluation is the test, with a threshold committed before the first scored run. | F claim 5, H.4 |
| D-W5 | Final 30 s is a human tapping a phone | **Fixed.** The final 30 s is the agent's blast-radius answer; the human tap moves to 262 s. | C |
| D-W6 | `source.list` has no limit; `schema.describe` has no budget | **Fixed.** Default and maximum limits, cursors and byte budgets are specified for both. | D.7 (tools 1, 4) |
| D-W7 | Rule ownership for agent-created rules is ambiguous | **Fixed.** A rule's owner is the agent principal with `on_behalf_of` set to the creating human. Effective permissions for each firing are the intersection of that human's grants, the agent ceiling and the action's declared permission. Recorded on each firing. Test `agent_rule_notify`. | D.5 |
| D-W8 | Prompt-injection defence is advisory | **Accepted as a known limitation.** The rules are tightened (no authority from data, narrow tools, flagged rows), but the design still does not prevent a manipulated model from proposing harmful changes. Those are bounded by ceilings, previews and audit. | D.10, G.5 |
| (self) | The original script had the agent commit a Grant, which D.5 forbids | **Fixed in passing.** The agent previews the grant, the change is held for approval (G8), and the presenter approves it on screen. This makes the authorization boundary visible. | C 135 to 165 s |
| (self) | Original 15-tool catalogue had `node.undo` and `node.delete` as unguarded writes | **Fixed.** See D-W1. | D.7 |

---

## A. Product concept

**What it is.** Plinth is a self-hosted, multi-tenant operations platform. A workspace holds data sources, a query layer, dashboards built from panels, rules that watch queries, workflows that react to rules, forms that write back, grants that control who sees what, and a complete history of every change. The web UI, the HTTP API and the MCP server are three views of one document graph. None of them has a capability the others lack.

**Who uses it.** Three audiences, all served by the same primitives.

- Operations engineers who watch fulfilment and platform health, and need drill-down during an incident.
- Platform and security staff who need to answer "who can see this, and what changed?" without reading code.
- Engineers and analysts who ask questions in plain language and expect a live answer as a panel, not as a paragraph.

The demo is aimed at the engineers and architects the brief names. They are shown a system behaving correctly under concurrency, authorization and failure.

**The data the demo is about.** Northwind Fulfilment is a fictional online retailer. Its order pipeline is simulated by a deterministic program, with no external or paid service.

- A seeded generator (xoshiro256** PRNG, seed committed in the repository) produces one row per order in a `orders` source, with event timestamps for placed, picked, packed, handed to carrier, delivered and returned. Raw events go to Kafka topic `northwind.orders.v1` and are landed by `plinth-ingest` into immutable Parquet partitions. The generator also emits carrier scan events and warehouse capacity samples.
- The generator's output for any virtual time is a pure function of the seed, the virtual tick and the fault profiles applied at or before that tick. This is the property the replay design depends on (section C.3).
- **History.** The workspace starts with 30 days of generated orders ending at 14:30 on a fixed virtual demo date, about 2.4 million orders (a design target that the seed will produce and that is to be measured, not a claim about a running system). The history is generated once, at build time, and stored as immutable partitions with a manifest (section E.4).
- **The 14:05 episode.** The history contains a seeded `FaultProfile` for region EMEA and carrier Crane. Between 14:00 and 14:05 the handoff stage (packed to handed to carrier) is multiplied by a factor that ramps from 1.0 to 2.2; the multiplier holds until 14:20 and returns to 1.0 by 14:25. The profile is in the seed file with its parameters, so the 14:05 spike has a documented generator. The rule in section C (p95 above 900 ms for three one-minute windows) is designed to fire once in the 30-day history, and the test `backtest_fires_once` checks that it does and that no other window in the history breaches.
- **The live fault.** The presenter's cue (section C.3) applies a `FaultProfile` of the same type, for the same region and carrier, starting at the next generator tick. It is the same causal path as the 14:05 episode: the handoff stage slows, fulfilment latency rises, and p95 crosses the threshold.
- Platform self-telemetry is a second source. Plinth's audit log, query log, rule-evaluation log and presence log are ordinary sources. "What changed in the last hour?" is a query over the same engine as "what is p95 by region?".

**Deployment shape.** The same images run under `docker compose` locally and under ECS Fargate on AWS (section E). The demo workspace has four stable identities: an operations lead, a regional lead for EMEA, a finance analyst and the agent principal (section D.5).

---

## B. Capability inventory

The core is six primitives and one language. Everything else in the table is a composition of those primitives, not a separate subsystem.

**Counting rule.** A row is one capability. Visual types are one row. A row counts as **demonstrated** only if it is visible on screen or in an MCP call listed in section C. Supporting rows are real, tested and not shown. The count is 38 rows, of which 28 are demonstrated.

### B.1 Kernel (6 primitives)

| # | Capability | Status | Technical significance | Composes with |
|---|---|---|---|---|
| P1 | **Node** (typed document, stable URI, revision) | Demonstrated | The only persistent entity kind. URI is `plinth://<workspace>/<kind>/<id>`, where the id is a UUIDv5 of workspace and slug, so replays produce identical URIs. | All |
| P2 | **Change** (atomic path operations, base revision, actor, surface, idempotency key, inverse ops) | Demonstrated | The only write path. | Node, Audit, Undo, Realtime, Grant, Approval |
| P3 | **Query** (expression tree over sources, with explicit `as_of`) | Demonstrated | One compiler, to parameterised DuckDB SQL. The only read path. | Source, Panel, Rule, Export, Grant, Form |
| P4 | **Source** (typed relation over immutable partitions, watermark, lineage) | Demonstrated | Maps landed Parquet into queryable relations with schema and watermark. | Query, Lineage, Rule, Grant |
| P5 | **Parameter** (typed named value with default and bindings) | Demonstrated | Flows from control to query to panel and back. Click-to-set and cross-filter are the same mechanism. | Panel, Query, Dashboard, Form |
| P6 | **Grant** (principal, action set, resource pattern, row predicate, column mask) | Demonstrated | One authorization function for UI, API and MCP. Row security is a predicate compiled into every query. | Query, Node, Change, Audit |

### B.2 Presentation and interaction

| # | Capability | Status | Significance | Composes with |
|---|---|---|---|---|
| V1 | Panel (a node whose data is one query result, with visual and interactions) | Demonstrated | Data and rendering are separate nodes' concerns. | Query, Parameter, Rule, Export |
| V2 | Visual types (bar, table, KPI tile, heatmap demonstrated; line and area supporting) | Demonstrated (four types) | Each visual maps result columns to channels. No visual has private data access. Sankey and map are not in version 1 of Plinth. | Panel |
| V3 | Dashboard (grid of panels, parameters, interactions) | Demonstrated | A node referencing panels by URI. | Panel, Parameter, Grant |
| V4 | Cross-filter and click-to-set drill-down | Demonstrated | Clicking a mark sets a parameter. | Parameter, Panel |
| V5 | Form (fields bound to a source; submit runs an Action) | Demonstrated | Form fields are typed from the source schema. The submit is a Change through an Action. | Action, Source, Workflow |
| V6 | Annotation (time-anchored note) | Supporting | A node with a time anchor. | Node, Panel, Audit |
| V7 | Comment (flat, on any node) | Supporting | A node kind. Mentions create notifications. | Node, Presence |
| V8 | Presence and cursors (who is viewing and where) | Demonstrated | Non-authoritative state keyed by node URI in Redis. The agent principal has presence like a human. | Realtime, Grant |
| V9 | Collaborative editing (path-level three-way merge with conflict payloads) | Demonstrated | Section D.6. Text fields use last-writer-wins with the conflict surfaced. | Change, Presence |
| V10 | Layout (grid, phone-width breakpoint) | Demonstrated | Layout is data in the Dashboard document, edited through the same Change. The phone window in the demo is this capability. | Dashboard |
| V11 | Embedding (signed, scoped iframe of one Dashboard) | Supporting | A grant issued to an external origin with a fixed row predicate. | Grant, Dashboard |

### B.3 Logic and automation

| # | Capability | Status | Significance | Composes with |
|---|---|---|---|---|
| L1 | Rule (query, predicate, hold duration, actions) | Demonstrated | State machine: ok, pending, firing, resolved. Each firing has an id; a firing produces one page. | Query, Action, Workflow, Audit |
| L2 | Threshold predicate | Demonstrated | A predicate over query output. | Rule, Panel |
| L3 | Action (typed, previewable side effect with declared inputs and effects) | Demonstrated | Write-back and notification. An Action cannot write a path it did not declare. | Form, Rule, Workflow, Grant |
| L4 | Workflow (state machine over rule firings, action results and human steps) | Demonstrated | Each instance is a node with a state and a transition history. | Rule, Action, Form, Audit |
| L5 | Scheduled export (query, format, schedule, destination) | Supporting | The same query serialised to CSV or Parquet. | Query, Action, Grant |
| L6 | Computed metric (named expression reused across queries) | Supporting | Expanded by the compiler. | Query, Lineage |
| L7 | Lineage (field-level for queries, path-level for Changes), queryable as a source | Demonstrated | Derived from query ASTs and Action declarations. Used for impact preview and for the closing analysis. | Query, Source, Change |
| L8 | Backtest (a rule's query replayed over 30 days in hold-sized windows) | Demonstrated | The same compiler as the live rule, run as the rule's owner. | Rule, Query |
| L9 | Anomaly window (trailing z-score) | Supporting | A window function. Not a learned model. | Query, Rule |

### B.4 Governance and history

| # | Capability | Status | Significance | Composes with |
|---|---|---|---|---|
| G1 | Audit and attribution (append-only, hash-chained change log with actor, on-behalf-of, surface, session) | Demonstrated | Attribution is a named capability: who did this, for whom, through which surface. The log is readable as a source, so "who changed this?" is a query. | Change, Source |
| G2 | Undo (append inverse Change, never rewrite history) | Demonstrated | Works across principals. Undo is audited with `undo_of`. | Change, Audit |
| G3 | Branch and merge of one Dashboard | Supporting | Tested, not shown in version 1 of the script. | Change, Diff |
| G4 | Diff (structural, path-level) | Demonstrated | Used by preview. The preview diff is the diff in the audit row. | Change, Branch |
| G5 | Templates | Supporting | A Node with a parameter list. | Node, Parameter |
| G6 | Multi-tenancy (workspace as a hard partition in every query) | Supporting | The compiler adds the predicate. | Grant, Query |
| G7 | Row and column security (row predicate and column mask) | Demonstrated | Compiled into the query. A masked column cannot be referenced downstream. | Grant, Query, Export |
| G8 | Approval (a Change held pending until a named human approves) | Demonstrated | Used for grants proposed by the agent. | Change, Workflow, Grant |

### B.5 Surfaces and transport

| # | Capability | Status | Significance | Composes with |
|---|---|---|---|---|
| S1 | Realtime channel (ordered change and result-diff stream, resumable by revision) | Demonstrated | One WebSocket endpoint. | Change, Query, Presence |
| S2 | HTTP API (OpenAPI 3.1 generated from the spec schema) | Supporting | Generated, not hand-written. | Node, Change |
| S3 | MCP server (14 tools, 6 resource templates, 3 prompts) | Demonstrated | A thin adapter over the same verbs. | All |
| S4 | Command-line client (`plinth apply`, `plinth diff`) | Supporting | Applies documents from git through the same commit path. | Node, Change, Diff |
| S5 | Deterministic replay driver (recorded MCP session replayed against a workspace) | Demonstrated (demo infrastructure) | Uses the MCP and HTTP paths, not a UI animation. | MCP, Audit |

**Count.** 38 rows: 6 kernel, 11 presentation, 9 logic, 8 governance, 5 surfaces (the original had 47 rows, with visual types and branch merge counted separately). 28 demonstrated. Each demonstrated row is visible in a beat of section C.

### B.6 Composition map

The arrows are real dependencies in the code. The target consumes the source's output or reuses its machinery.

```
                        ┌──────────── Grant (P6) ─────────────┐
                        │ row predicate, column mask, actions  │
                        ▼                                       │
Source (P4) ──► Query (P3) ──► Panel (V1) ──► Dashboard (V3) ◄── Parameter (P5)
   │               │  ▲             │               ▲                 ▲
   │               │  │             │               │           cross-filter (V4)
   │               ▼  │             ▼               │
   │          Rule (L1) ──► Action (L3) ──► Workflow (L4) ──► Form (V5)
   │               │                           │                  │
   │               ▼                           ▼                  ▼
   │          Backtest (L8)              Approval (G8)        Change (P2)
   │                                                              │
   └── Lineage (L7) ◄─────────────────────────────────────────────┤
                                                                  ▼
                       Audit (G1) ◄── Change log (hash chain) ──► Undo (G2)
                           │                    │                    │
                           ▼                    ▼                    ▼
                   Audit as Source        Diff (G4)           Realtime (S1)
                   (attribution)                                     │
                                                       Presence (V8) / Collab (V9)
                                                                      │
                                                       UI · HTTP API · MCP (S3)
```

Three compositions carry most of the surface.

1. **Query feeds everything.** Panels, rules, backtests, exports, form lookups, row predicates and the agent's own interrogation all call one compiler. A row predicate cannot be bypassed by an export or an alert, because they have no separate read path.
2. **Change is the only write.** A panel edit, a layout move, a grant, a rule threshold, a form submit, an undo and an agent commit are all Changes. That is why one audit table, one undo and one realtime stream cover them all.
3. **Metadata is a source.** Audit (who changed what) and lineage (what reads what) are tables the query layer reads. "Who changed the finance board in the last ten minutes?" and "what depends on the `fulfilled_at` field?" are ordinary queries. The closing beat of the demo is a query over these sources, and no feature in Plinth was written to answer the question it answers.

---

## C. Five-minute live script

### C.1 Staging

- Four windows on the presenter's machine: **Ops board** (wide, operations lead), **Exec view** (regional lead for EMEA, open on the finance board, with an existing EMEA-only read grant on the Ops board), **Phone** (narrow, the incident card at phone width), and the **presenter console** (a control window that shows the virtual clock, the driver mode, the step list and the fault cue key). A fifth window is the agent client (Claude Code terminal) with the Plinth MCP server connected as the agent principal.
- The room display shows the Ops board, the Exec view and the trace panel. The presenter console and the Phone window are on the presenter's second display.
- `make demo-reset` restores the seeded state (section E.4). The Ops board has three panels, the finance board is owned by the finance analyst, the virtual clock is at 14:30 and paused at the start of the script, and the replay transcript is loaded.
- Screens are not reloaded between steps. Everything appears through the realtime channel.

### C.2 Timeline

Prompts are typed by the presenter, shown in the terminal, and kept short. The trace panel on the room display shows each tool name, a one-line argument summary, the result status and a `live` or `replay` tag (section C.3).

| Time (s) | Presenter action | Expected behaviour (MCP calls and system effects) | Visible result | Capabilities | Transition |
|---|---|---|---|---|---|
| 0–30 | Stands at the Ops board. Says: "This is an operations platform. Everything on these screens is a node in one document graph. The agent is an external client, the same kind of client as this browser." No prompt. | None. The generator streams live events. The KPI tile updates from the feed. | Three windows show the same board. Presence badges show the three humans. | S1, V8, P4 | "Let's ask it a question." |
| 30–60 | Types: `Show p95 fulfilment latency by region for the last hour on the ops board.` | `schema.describe(kind="Source")`; `source.list(domain="fulfilment", limit=20)`; `query.run(dry_run=true, …)`; `query.run(…, limit=20)`; `node.preview(kind="Panel", …)` returns diff, validation, lineage delta and preview token; `node.commit(preview_token, idempotency_key="claude-code:s1:4")`. | A bar panel appears on the Ops board at the right of the grid, bars ordered by p95, descending. The Exec view shows the same panel restricted to EMEA rows, because of its existing grant. | P3, P4, P1, P2, L7, S3, V1, V2, G7 | "Is that normal?" |
| 60–100 | Types: `Why did p95 jump at 14:05? Show the breakdown by carrier, and whether any configuration changed in that window.` | `query.run` on `orders` for 14:00–14:20, grouped by carrier and region, with the 13:00–14:00 baseline as a second column; `query.run` on `audit.changes` for 14:00–14:20, which returns zero rows and is reported as such; `node.preview(kind="Dashboard", …)` adds a `carrier-heatmap` panel and binds the panel to parameter `incident_window` set to 14:00–14:20; `node.commit`. | A heatmap of carrier by region appears. The Crane and EMEA cell is red. The audit panel reads "0 changes in window" beside its query. All three panels re-query together under the new parameter. The watermark (14:20:59) is printed on the heatmap. | P3, V2, P5, V4, G1 (attribution as source), S1 | Presenter clicks the red cell. |
| 100–135 | Clicks the red cell (sets `region=EMEA`, `carrier=Crane`, no agent call). Types: `Alert me if p95 for any region stays above 900 ms for three minutes. Post to the ops channel.` | `node.preview(kind="Rule", …)` returns the query lineage, the declared effects (an HTTP post to the `ops-channel` receiver, permission `action:notify`), the owner and effective principal (section D.5) and the backtest result: the rule's query run over 30 days in one-minute windows, reporting one firing at 14:03 to 14:20 and no others. `node.commit`. | The Rule appears in the Rules strip in state `ok`. The backtest sparkline marks the single firing. Clicking the mark opens the query that produced it. | L1, L2, L3, L7, L8, G1 | "Now the access question." |
| 135–165 | Types: `Who can see the finance board? Let the EMEA lead see only EMEA rows on it.` | `grant.check(resource=finance-board, action=read, with_counts=true)` returns principals, predicates and row counts. `grant.check(resource=finance-board, principal=emea-lead, proposed={row_predicate: "region = 'EMEA'"}, with_counts=true)` returns row counts before and after. `node.preview(kind="Grant", …)` creates a Change held for approval (G8); the agent cannot commit it (section D.5). The presenter approves in the UI; the commit runs. | The finance board shows the proposed grant as pending, with before and after counts (for example 5 regions to 1). After approval, the Exec view loses the non-EMEA rows in place. The grant list gains the predicate. | P6, G7, G8, P3, S1 | "The agent proposes; a person commits." |
| 165–195 | Says: "Read the EMEA panel and hold until I say go." Edits the panel title in the Ops board UI when the agent reports its revision. Says: "Go." | The agent calls `node.get` and reports revision r, then waits. The presenter's title edit commits at revision r+1 (surface `ui`). On "go", the agent submits one Change with base r and two ops: title and width. The engine finds the title path touched by both, rejects the Change with `CONFLICT` and the head value, and the agent re-reads, drops the title op and commits the width op at revision r+1. | A conflict banner on the Ops board shows the two authors and the conflicting path. The presenter's title stays. The width change merges. Presence shows the agent's cursor as a labelled marker. | V9, V8, P2, S3 (error payload), V10 | "Undo is the audit trail, applied backwards." |
| 195–215 | Clicks Undo on the grant row in the audit panel. | The UI calls the Change path with `undo_of` set to the grant change. The undo is a Change with inverse ops and an audit row linking the two. | The EMEA lead's finance board regains all rows in place. The audit panel shows two linked rows. | G2, G1, P2 | Presenter presses F7. |
| 215–245 | Presses F7 (fault cue, presenter console). Says nothing else. | The presenter console sends the cue to the presenter control API. It is applied at the next generator tick, which is recorded. The `FaultProfile` for EMEA and Crane ramps from that tick. The Rule evaluator (Plinth code, not the agent) moves the Rule to `pending`, then `firing` after three minutes of held breach on the virtual clock (6x, so about 30 s of wall time). It creates a Workflow instance (L4) and runs the `ops-channel` action (L3). | The Rule flips to `pending`, then `firing`. A toast with the Workflow link appears on all screens. The workflow card appears on the Ops board in state `open`, with its transition history. | L1, L4, L3, S1, V8 | "Nobody asked the agent to watch for this." |
| 245–262 | Types: `Build an acknowledge form on the incident card with a note field, and a timeline of its state changes.` | `schema.describe(kind="Form")`; `query.run(source="workflow.instances", limit=3)` to learn the fields; `node.preview(kind="Form", …)` declaring the Action `workflow.acknowledge` (declared effect: a Change on the instance; permission `workflow:acknowledge`); `node.commit`; `node.preview(kind="Panel", …)` for a timeline bound to `workflow.transitions` filtered by the instance parameter; `node.commit`. | The Phone window's incident card gains a note field and an Acknowledge button, and a timeline. The Ops board gains the timeline panel. | V5, L3, L4, P5, V1, V10 | Presenter taps Acknowledge. |
| 262–270 | Taps Acknowledge on the Phone window. | The Action submits a Change against the instance with the base revision from form load. The Workflow moves to `acknowledged`. The audit row shows actor `user:ops-lead`, surface `ui`. | State changes to `acknowledged` on all screens within the realtime target (design target under 2 s). The timeline shows the transition with the actor name. | L4, L3, G1, S1, V5 | "Now ask it what this touched." |
| 270–300 | Types: `What did this incident touch? Build a panel for it.` | `query.run` on the lineage source: `lineage.dependents(source="orders", field="fulfilled_at")` returns panels, rules, dashboards and grants that read the field; `query.run` on `orders` for the fault window, counting orders over 900 ms by carrier; `query.run` on `workflow.transitions` and `audit.changes` for the instance; `node.preview(kind="Panel", …)` for a table with one row per dependent kind and counts; `node.commit`. | An "Incident blast radius" panel: 3 panels and 1 dashboard read `fulfilled_at`; 1 rule watches it; 2 grants restrict `region`; N orders delayed across M carriers; 1 workflow acknowledged by `user:ops-lead`. Each count links to its query. Presenter ends on the three screens showing the same state. | L7 (lineage as source), P3, G1, L4, V1, S3 | End. |

**Why the strongest moment is last.** The brief requires the final 30 s to carry the strongest moment. The strongest moment here is the blast-radius panel. No feature in Plinth lists "what does this incident touch". It is composed from the lineage source, the orders source and the audit source, by an agent, live. The acknowledge write-back before it is ordinary and is shown as supporting.

**Prompts in the script.** The prompts are the presenter's words. The agent does not receive any prompt that explains Plinth internals; it receives only the MCP tool list, the resources and the prompt text. The agent is expected to call `schema.describe` and `source.list` first, and the evaluation in section F claim 5 measures whether it does.

### C.3 The fallback driver

The live agent is the default. Every step in C.2 can be satisfied by a recorded transcript, and the switch between the two is one keystroke (`F9`, shown as "driver: live / replay" in the status bar of the presenter console only).

**What the transcript contains.** A JSON transcript recorded from an earlier live run against the same seed and history manifest. For each step it stores: the prompt text; the ordered MCP calls with full arguments; the expected result hash of each query; the expected change hash of each Change; the virtual time `as_of` at which the step ran; any presenter control events (the F7 fault cue with its applied tick, and the human title edit and Acknowledge tap, which are replayed as Changes with surface `driver`, not as UI clicks).

**Result hashes.** A query's result hash is computed over its columns and its rows, with numeric values rounded to six significant digits, at the query's `as_of`. The hash excludes source watermarks, timings and plan details; those are recorded but informational.

- **Why `as_of` is pinned.** A live query such as "last hour" depends on when it runs. During replay the driver issues the same query with `as_of` set to the recorded virtual time. The engine reads only partitions with event time at or before `as_of`, and it waits until the source watermark reaches `as_of` (or returns `SOURCE_STALE` after the step budget). The rows that enter a result are therefore a function of the seed, the fault ticks and `as_of`, not of how far the live feed has advanced.
- **Why watermarks are excluded.** The live feed keeps advancing after `as_of`. A watermark-based hash would fail on every run for a reason that has no effect on the rows. The trade: the hash proves the rows at `as_of`, not the arrival state of the partitions. The engine's guarantee that a partition is visible only after its rename (section G.1) covers the arrival state.
- **Fault determinism.** A fault cue takes effect at the next generator tick, and the tick is recorded. Per tick, the generator's output is a pure function of the seed and the profiles applied up to that tick, so a replay that applies the same profile at the same tick produces the same events.
- **Change determinism.** Replayed Changes carry the recorded base revisions. Node ids are UUIDv5 values, so the replay produces the same URIs. Idempotency keys for replayed commits are namespaced (`replay:<transcript>:<step>`), and before issuing a replayed commit the driver looks in the change log for the expected change hash (section D.6). A step that is already present is marked done.

**How the switch works.**

- The switch happens at a step boundary. If the live agent is in the middle of a step, the step is cancelled with `notifications/cancelled`. Cancellation is honoured only before the commit transaction starts (section D.6). The driver then resolves any ambiguous commit by looking up the idempotency record, and issues the next step from the transcript.
- The switch is automatic when the live agent returns an error twice on one step, or when a step exceeds its latency budget (default 12 s for a query step, 20 s for a multi-call step).
- If the presenter's cue (F7) does not arrive within 5 s of the start of its step, the driver issues the scripted cue at the recorded tick. The scripted offset is therefore a fallback, not the trigger.
- The driver resumes from any step boundary: it verifies that the change hashes of earlier steps are present in the chain, then continues. Reset is the fallback when the state is unknown.

**What the audience sees.** The terminal prompt is typed by the driver, so it looks the same. The trace panel on the room display tags each call `live` or `replay`. This is a decision, recorded here with its reason. The brief asks that the switch be invisible or one keystroke, and it is: F9 does it and nothing on the room display changes except the tag. The tag stays visible because it is a trust disclosure. An expert who sees real calls labelled as replayed trusts the platform more than one who sees an unlabelled canned flow, and the presenter can explain the tag in one sentence. Reviewer C's concern about the fallback being in front of the audience is accepted as a presentation risk, and the mitigation is the one-sentence explanation rehearsed in advance.

**What the driver does not do.** It does not animate, fake results or write to the UI. Each commit returns a real revision. Human steps are performed as Changes through the HTTP API under the presenter's session, with surface `driver` in the audit row, so the audit log says what happened.

**Why the 14:05 episode is not in the transcript.** The episode is history, produced by the generator from the seed. The transcript contains only the questions and calls. The replay recomputes the answer from the same history, and the test `episode_in_history` checks that it does.

---

## D. Technical architecture

### D.1 Components

| Component | Responsibility | Implementation |
|---|---|---|
| `plinth-core` | Node model, Change application, validation, hashing, diff, merge, undo | TypeScript library, no I/O |
| `plinth-spec` | Specification language: kinds, JSON Schema, parser, canonical serialisation, YAML view | TypeScript; generates JSON Schema and OpenAPI |
| `plinth-query` | Query AST, typechecker, policy injection, DuckDB SQL compiler | TypeScript; produces parameterised SQL |
| `plinth-engine` | DuckDB execution, partition views, watermarks, `as_of` pinning, result cache, result diffing | Node.js with `@duckdb/node-api`; extensions bundled in the image |
| `plinth-api` | HTTP API, OIDC verification, commit endpoint, search | Fastify |
| `plinth-rt` | WebSocket gateway: subscriptions, change fan-out from the outbox, presence | `ws` on Node; Redis pub/sub for fan-out and presence only |
| `plinth-mcp` | MCP server: tools, resources, prompts, progress, cancellation, change notifications | `@modelcontextprotocol/sdk`; stdio and Streamable HTTP |
| `plinth-web` | Single-page UI | React 19, Vite, TanStack Query, Zustand, react-grid-layout, Apache ECharts |
| `plinth-ingest` | Kafka consumers writing immutable Parquet partitions; watermark publication | Node.js |
| `plinth-worker` | Rule evaluator, workflow runner, backtests, scheduled exports | Node.js; same image as api, different entrypoint |
| `plinth-gen` | Seeded Northwind generator, virtual clock, fault profiles, history build | Node.js; xoshiro256** |
| `plinth-driver` | Replay driver (MCP and HTTP client) and transcript recorder | Node.js |

**Language.** TypeScript end to end. The spec types, the query AST, the Change format and the MCP tool schemas are one set of types, validated at runtime by JSON Schema generated from them, so the UI, server and MCP server cannot disagree about a field. The official MCP SDK is in TypeScript. DuckDB's Node binding runs scans and aggregates natively. The rule is that row-level work goes through DuckDB and never through in-memory Node transforms.

### D.2 Persistence model

PostgreSQL 16 is the control plane and the only authority for state, including previews and idempotency. DuckDB reads the data plane. Object storage holds immutable Parquet partitions, the history manifest and exports. Redis holds presence and fan-out. Nothing in Redis is authoritative.

```sql
-- Node heads, derived from changes; rebuilt from snapshots on load
CREATE TABLE nodes (
  workspace_id uuid NOT NULL, node_id uuid NOT NULL, kind text NOT NULL,
  slug text NOT NULL, revision bigint NOT NULL, body jsonb NOT NULL,
  body_hash bytea NOT NULL, deleted_at timestamptz,
  PRIMARY KEY (workspace_id, node_id), UNIQUE (workspace_id, kind, slug)
);

-- One head row per workspace. Every commit locks it first, so commits in a workspace are serial.
CREATE TABLE workspace_chain (
  workspace_id uuid PRIMARY KEY, head_seq bigint NOT NULL, head_hash bytea NOT NULL
);

-- The only write path. Append-only; linear per workspace because of workspace_chain.
CREATE TABLE changes (
  seq bigserial PRIMARY KEY, workspace_id uuid NOT NULL, node_id uuid NOT NULL,
  base_revision bigint NOT NULL, result_revision bigint NOT NULL,
  actor_id uuid NOT NULL REFERENCES principals, on_behalf_of uuid REFERENCES principals,
  surface text NOT NULL CHECK (surface IN ('ui','api','mcp','driver','system','cli')),
  session_id text, change_hash bytea NOT NULL, ops jsonb NOT NULL,
  inverse_ops jsonb NOT NULL, reason text, undo_of bigint REFERENCES changes(seq),
  contains_untrusted boolean NOT NULL DEFAULT false,
  prev_hash bytea NOT NULL, hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, result_revision)
);

-- Scoped to the acting principal, not the workspace. The request hash detects reuse with a different body.
CREATE TABLE idempotency_records (
  workspace_id uuid NOT NULL, principal_id uuid NOT NULL, idempotency_key text NOT NULL,
  request_hash bytea NOT NULL, result jsonb NOT NULL, change_seq bigint,
  PRIMARY KEY (workspace_id, principal_id, idempotency_key)
);

-- Previews are authority to commit, so they live where commits are checked.
CREATE TABLE preview_tokens (
  token_hash bytea PRIMARY KEY, workspace_id uuid NOT NULL, principal_id uuid NOT NULL,
  change_hash bytea NOT NULL, base_revisions jsonb NOT NULL,
  expires_at timestamptz NOT NULL, consumed_at timestamptz
);

-- Written in the commit transaction; relayed to Redis after commit.
CREATE TABLE outbox (
  seq bigint PRIMARY KEY, workspace_id uuid NOT NULL, payload jsonb NOT NULL,
  relayed_at timestamptz
);

CREATE TABLE principals (
  principal_id uuid PRIMARY KEY, workspace_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('human','service','agent')),
  subject text NOT NULL, display_name text NOT NULL, disabled_at timestamptz,
  max_scope jsonb                                   -- agents: the ceiling (D.5)
);

CREATE TABLE grant_index (                          -- materialised from Grant nodes
  workspace_id uuid, principal_id uuid, action text, resource_prefix text,
  row_predicate_ast jsonb, column_mask text[], mask_version int,
  grant_node_id uuid, expires_at timestamptz, index_version bigint
);

CREATE TABLE query_runs (
  run_id uuid PRIMARY KEY, principal_id uuid, surface text, query_hash bytea,
  policy_hash bytea, as_of timestamptz, plan jsonb, row_count bigint,
  duration_ms int, result_hash bytea, started_at timestamptz DEFAULT now()
);

CREATE TABLE source_partitions (                    -- watermark is the minimum over a source's partitions
  source_id text, partition_key text, object_key text, event_max timestamptz,
  published boolean NOT NULL DEFAULT false,
  PRIMARY KEY (source_id, partition_key)
);
```

Rule state, workflow instances, workflow transitions, branches and snapshots keep the shapes of the previous revision of this proposal, with one addition: `rule_state` holds a `firing_id` so that a firing is a state and produces one notification.

**Data plane.** `plinth-ingest` writes a Parquet file to a temporary key, renames it to its final key, and only then sets `published = true` in `source_partitions`. Watermarks advance only over published partitions. A query result carries the watermarks it read; a panel can show "data as of 14:20:59".

### D.3 The specification language

Every node is a document with this envelope:

```yaml
apiVersion: plinth/v1
kind: <Dashboard | Panel | Query | Source | Parameter | Rule | Action | Form | Workflow | Grant | Metric | Template | Export>
metadata: { id: <uuid>, slug: <string>, title: <string>, labels: { k: v } }
spec: { ... }          # kind-specific; validated against the kind's JSON Schema
```

Example: the Ops board with its parameters, one panel, one rule and one action. The agent writes this document, and the UI renders it. There is no generated code in the path.

```yaml
apiVersion: plinth/v1
kind: Dashboard
metadata: { id: 7f1c…, slug: ops-board, title: "Fulfilment operations" }
spec:
  parameters:
    window:          { type: duration, default: 1h, choices: [15m, 1h, 6h, 24h] }
    incident_window: { type: interval, default: "last 1h" }
    region:          { type: enum, source: "query:regions", multi: true }
    carrier:         { type: enum, source: "query:carriers", multi: true, default: [] }
  layout:
    columns: 12
    items:
      - { panel: p95-by-region, at: { x: 0, y: 0, w: 6, h: 4 } }
  panels:
    p95-by-region:
      query:
        from: source:orders
        where:
          - { field: region,    op: in,  value: $region }
          - { field: placed_at, op: gte, value: "now() - $window" }
        derive:
          latency_ms: "fulfilled_at - placed_at"
        group: [region]
        aggregate:
          p95_latency_ms: { fn: percentile, of: latency_ms, p: 0.95 }
          orders:         { fn: count }
        order: [{ field: p95_latency_ms, dir: desc }]
      visual:
        type: bar
        x: region
        y: p95_latency_ms
        threshold: { value: 900, channel: alert }
      on_click: { set: { region: "$click.region" } }
  rules:
    p95-regional-breach:
      query: "query:p95-by-region"
      when: "p95_latency_ms > 900"
      hold: 3m
      on_fire: [ "action:notify-ops-channel" ]
```

**Rules of the language.**

- Every reference is a URI or a slug resolved in the workspace. A missing reference is a validation error at preview time, with the existing nodes of that kind listed.
- Expressions are a small typed grammar: literals, field references, parameters (`$name`), click payload (`$click.field`), arithmetic, comparisons, `in`, `now()`, duration literals and the engine's aggregate functions. There are no user-defined functions and no string-to-SQL escapes.
- Visual channels are a fixed set per visual type. A field that maps to no channel is an error, not a silent drop.
- `on_click`, `on_fire` and form submit reference Actions by URI. An Action declares its input schema, its effects (Change paths and notification channels) and its required permission. Lineage is computed from these declarations, so an Action cannot write a path it did not declare.

### D.4 Query engine

The query AST is the only read interface. Operators: `from`, `where`, `derive`, `group`, `aggregate`, `window` (tumbling and trailing), `join` (equi-join), `union`, `order`, `limit`, `select`. The typechecker resolves each field against the source schema and each parameter against its declared type.

**Compilation.** The compiler emits DuckDB SQL with placeholders only. It then adds, in this fixed order, with no option to skip:

1. the workspace predicate;
2. the row predicate from every grant that applies to the principal and the source, attached to the source relation before any operator, so that a join or union cannot leak rows past it;
3. the column mask: masked columns are removed from the projection, and a downstream reference to one is a type error.

The compiled SQL and the injected predicates are recorded in `query_runs.plan`. `query.explain` returns them to the caller.

**Time.** Every query has an `as_of`. Live queries default to the platform's virtual now. The engine reads only partitions whose event time is at or before `as_of`, and it waits, up to the step budget, for the source watermark to reach `as_of`; otherwise it returns `SOURCE_STALE` with the watermark.

**Result cache.** The cache key is `(query_hash, policy_hash, parameter_values, as_of)`. `policy_hash` is the hash of the workspace predicate, the canonical row-predicate AST for each source, the column-mask set, the mask version and the grant-index version. Any change to any of these changes the key. Two principals with the same row predicate but different column masks have different keys and never share a result (test `cache_isolation`).

**Incremental behaviour.** The engine has no incremental view maintenance. It re-executes a query when a source it reads has advanced past `as_of`, coalesced to at most one execution per query per second, and it sends the client a keyed result diff. Large queries are re-executed in full. This is a known limit (G.5).

**Performance targets (design, to be measured).** Aggregate over 2.4 million order rows, grouped by region, with a percentile: p95 under 200 ms on a laptop-class machine. Heatmap of carrier by region over the same rows: p95 under 300 ms. The rehearsal harness measures both.

**Backtest.** A rule's preview runs its query over the trailing 30 days in windows of the hold duration, as the rule's owner principal, with the same compiler, and reports each window that would have fired. It is a query, not a simulator. Its cost is bounded by the hold window, and it is cached by rule hash and history manifest version.

### D.5 Authorization: the agent as a scoped principal

Authorization is one function: `authorize(principal, action, resource_uri, context) → allow | deny(reason) | allow_with(row_predicate, column_mask)`. Every surface calls it: the UI and HTTP API, the MCP server, the replay driver, and the worker when it runs a rule or workflow.

**Principal kinds.** `human` (OIDC subject), `service` (workload identity for workers and the generator) and `agent` (an MCP client acting for a human).

**The agent principal.** The agent authenticates as its own principal, with `on_behalf_of` set to the human who started the session. Its effective permissions are the intersection of three sets:

1. the on-behalf-of human's grants;
2. the agent principal's `max_scope`, set by an administrator and not changeable through MCP;
3. the token's scope, which can narrow but not widen.

In the demo, the agent acts for the operations lead with a ceiling that allows `node:write` on dashboards, panels, rules and forms; `query:run` on all sources; `action:notify`; `workflow:read`; and `grant:propose`. It does not allow `grant:write` or `workflow:acknowledge`. Grant proposals are Changes held for approval (G8), and a human approves them. The agent therefore cannot widen its own access, and an attempt to commit a grant returns `FORBIDDEN` with the missing permission named.

**Rule ownership.** A rule created through MCP has `owner = agent:claude-code` with `on_behalf_of = ops-lead`. Each firing runs its `on_fire` actions with effective permissions equal to the intersection of the on-behalf-of human's grants at firing time, the agent ceiling and the action's declared permission. The effective principal and the three inputs of the intersection are recorded on the firing. A rule whose action the ceiling forbids is refused at preview, with the reason shown. Test `agent_rule_notify`: under the demo ceiling a rule with `action:notify` fires and posts, and a rule with a `grant:write` action is refused at preview.

**Attribution.** Changes made by the agent carry `actor_id = agent`, `on_behalf_of = ops-lead`, `surface = mcp` and the session id. A single audit row answers "who did this, and for whom".

### D.6 Concurrency, merge, idempotency and realtime

**Commit transaction.** A commit runs in one Postgres transaction, in this order:

1. `SELECT head_seq, head_hash FROM workspace_chain WHERE workspace_id = $1 FOR UPDATE`. This serialises all commits in the workspace and fixes the lock order.
2. Look up `(workspace_id, principal_id, idempotency_key)`. If a record exists with the same request hash, return its stored result with `replayed: true`. If the request hash differs, return `IDEMPOTENCY_KEY_REUSED`.
3. If a preview token is presented: `UPDATE preview_tokens SET consumed_at = now() WHERE token_hash = $h AND consumed_at IS NULL AND expires_at > now() AND change_hash = $c AND principal_id = $p RETURNING base_revisions`. Zero rows means the token is spent, expired, for another Change or for another principal. The error code is chosen by a follow-up read: `PREVIEW_STALE` if the token exists but its base revisions no longer match, otherwise `PREVIEW_REQUIRED`.
4. Lock the touched node rows and apply the merge rule (below). Validate against the head.
5. Insert the change row (with `prev_hash = head_hash`), update the nodes, update `workspace_chain`, insert the idempotency record and insert the outbox row.
6. Commit.

After commit, the relay publishes the outbox row to Redis, and the gateways push it to subscribers. A lost Redis message is recovered by resume.

**Merge rule.** A Change carries `base_revision`. If it equals the head revision, it applies. Otherwise the engine compares the paths the Change touches with the paths touched by changes between the base and the head, read from the log. Disjoint sets: the Change is rebased and applied with `merged_from`. Intersecting sets: `CONFLICT` with `{conflicting_paths, head_revision, head_values_at_paths, your_values_at_paths}`. Lists are keyed by stable ids. Text fields use last-writer-wins, and the demo shows that path. The unit is the path because a conflict on a typed field is a meaningful signal, whereas silently merging two thresholds is a bug.

**Cancellation.** `notifications/cancelled` for a commit is honoured only before step 1 of the transaction. Once the transaction begins, it runs to completion. A caller that cancels and is unsure of the outcome resolves it by looking up its idempotency record: present means committed, with the stored result; absent means not committed, and a preview token that was not consumed remains usable. The replay driver uses this rule.

**Replay keys.** Replayed commits use `replay:<transcript>:<step>`. Live agents choose their own keys, which are scoped to their principal and cannot collide with replay keys. Before a replayed commit, the driver looks for the expected change hash in the change log for that principal and session, and skips the step if it is found.

**Change hash.** `change_hash = sha256(canonical(target uri, ops, base_revisions))`. It excludes surface, actor, session, idempotency key and timestamps, so the same logical change has the same hash whichever surface submitted it.

**Realtime.** One WebSocket endpoint, `/rt`. A client sends `subscribe` with node URIs or query handles and a last-seen revision. The server replies with missed changes if the revision is within the change log, otherwise with a snapshot. It then pushes change batches ordered by `seq` and result diffs. On a sequence gap the client refetches. Presence is pushed from Redis, throttled to 5 updates per second per node. Subscribed MCP resources receive `notifications/resources/updated`.

The commit-to-screen path is commit, outbox, Redis, gateway, client. The design target is under 300 ms p95 on one host, measured in the rehearsal harness.

### D.7 The MCP server

The server exposes generic verbs, not one tool per kind. A capable agent given a small grammar with rich schemas composes it across kinds, and a catalogue of per-kind tools would make it learn a new interface for each kind. The server declares **14 tools**, **6 resource templates** and **3 prompts**. The number of tools is an output of the design, not a target: the catalogue is frozen only after the gate in section F claim 5 passes.

**Budgets.** Every list-returning tool has a default and a maximum `limit`, a `cursor`, and a response byte budget. Responses over budget are truncated with `truncated: true` and a `next_cursor`. The byte budgets are part of the schema the agent reads.

**Discovery and reading.**

1. `schema.describe(kind?: Kind, include_examples?: bool = true) → …`. Without `kind`: the list of kinds with one-line purposes, at most 8 KB. With `kind`: the JSON Schema of the spec, the allowed visual channels or action effects, the verbs that apply to the kind, and one minimal valid example, at most 16 KB. Fields beyond the budget are paged.
2. `node.get(uri: string, at_revision?: int) → { node, revision, body_hash }`.
3. `node.search(kind?: Kind, text?: string, labels?: map, limit?: int = 20 (max 100), cursor?: string) → { items: [{uri, title, kind, revision}], next_cursor }`.
4. `source.list(domain?: string, limit?: int = 50 (max 200), cursor?: string) → [{uri, title, fields: [{name, type, nullable, description}], watermark, row_estimate}]`. Field lists are paged after 40 fields.

Raw sampling is not a separate tool. To look at rows, the agent calls `query.run` with `limit`, and the query goes through the compiler, the workspace predicate, grants and masks.

**Querying.**

5. `query.run(query: QueryAst | uri, params?: map, as_of?: timestamp, limit?: int = 200 (max 1000), dry_run?: bool = false, timeout_ms?: int = 5000) → { columns, rows, row_count, as_of, watermarks, plan_summary, result_hash, truncated }`. With `dry_run`, it returns the typecheck result and the plan without executing.
6. `query.explain(query: QueryAst, params?: map) → { compiled_sql, injected_predicates, masked_columns, lineage: [{source, field}], cost_estimate }`.

**Writing.** Previews and commits apply to every Change, including undo and delete.

7. `node.preview(kind: Kind, uri?: string, body?: object, patch?: Op[], base_revision?: int, undo_of?: int, delete?: bool) → { valid, errors, diff, lineage_delta, effects, owner, effective_principal, backtest?, preview_token, expires_in_s }`. Never writes. Creates a token row in Postgres.
8. `node.commit(preview_token?: string, uri?: string, patch?: Op[], base_revision?: int, idempotency_key: string, reason?: string) → { change_seq, result_revision, merged_from?, replayed? }`. For agent principals `preview_token` is mandatory, and the token's change hash must match.
9. `node.delete(uri: string, base_revision: int, reason: string, preview_token?: string) → { change_seq }`. Soft delete. For agent principals, `preview_token` is mandatory: the agent must first call `node.preview(…, delete=true)`.
10. `node.undo(change_seq: int, reason: string, base_revision: int, preview_token?: string) → { undo_change_seq }`. For agent principals, `preview_token` is mandatory, from `node.preview(…, undo_of=change_seq)`. Refused with `CONFLICT`, naming the later change, if a later change touched the same paths.

**History.**

11. `change.history(uri?: string, principal?: string, since?: timestamp, surface?: enum, idempotency_key?: string, limit?: int = 50 (max 200)) → [{seq, node_uri, actor, on_behalf_of, surface, at, reason, change_hash, ops_summary}]`.
12. `diff(a: uri@rev, b: uri@rev) → { ops, human_summary }`.

**Access and rendering.**

13. `grant.check(resource: uri, action: string, principal?: string, with_counts?: bool = false, proposed?: GrantSpec) → { decision, predicate_text, column_mask, sources, row_counts?: {before, after} }`. `proposed` evaluates a grant that does not exist yet, using the compiler, without writing it. This tool replaces the `grant.preview` that earlier drafts named.
14. `ui.present(uri: string, target?: "all" | "principal:<id>", focus?: {parameter, value}) → { delivered_to }`. The only call that changes what a screen shows without a Change. It is audited as `surface = mcp, kind = present`. It cannot target a principal that did not start the session.

**Resources.** `plinth://schema/{kind}`, `plinth://node/{workspace}/{node_id}`, `plinth://sources/{source_id}`, `plinth://examples/{kind}/{variant}`, `plinth://audit/{workspace}/{seq}`, `plinth://workspace/{workspace}/catalogue`. Subscribable. A change to a subscribed node sends `notifications/resources/updated`.

**Prompts.** `build-panel`, `investigate-spike` and `grant-review`. Each is a sequence of tool calls, with no data and no secrets.

**Progress and cancellation.** Long calls emit `notifications/progress`, which the trace panel renders. `notifications/cancelled` is honoured between engine batches, and for commits only before the transaction begins (D.6).

### D.8 Errors and agent self-correction

Every error is structured:

```json
{
  "error": {
    "code": "UNKNOWN_FIELD",
    "path": "/panels/p95-by-region/query/aggregate/p95_latency/of",
    "message": "Field 'latency' is not in source orders.",
    "did_you_mean": ["latency_ms"],
    "available": ["order_id", "region", "carrier", "placed_at", "fulfilled_at", "status"],
    "fix_hint": "Use derive to define latency_ms, or reference fulfilled_at - placed_at.",
    "retryable": true,
    "docs_uri": "plinth://schema/Query#aggregate"
  }
}
```

The closed set of codes is `VALIDATION_FAILED`, `UNKNOWN_FIELD`, `UNKNOWN_REFERENCE`, `TYPE_MISMATCH`, `PREVIEW_REQUIRED`, `PREVIEW_STALE`, `CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `FORBIDDEN` (with the scope reason and the missing permission), `RATE_LIMITED` (with `retry_after_s`), `QUERY_TIMEOUT`, `SOURCE_STALE` (with the watermark) and `IDEMPOTENT_REPLAY`. Each `fix_hint` is generated from schema facts, never from data. `available` lists valid alternatives, so one retry is usually enough.

**Validation before writes.** Preview validates the Change against the workspace graph: references, permissions on every path, typechecking, lineage cycles and the resulting document. A passing preview is not a promise. The commit re-validates against the head, and returns `PREVIEW_STALE` with the diff between the previewed base and the head if the head moved.

### D.9 Rate limits, cost and abuse

Token buckets per principal and per tool, with cost weights: `query.run` 5 units per execution (0 for a cache hit), `node.preview` 2, `node.commit` 3, reads 1. Agent defaults: 60 units per 10 s burst and 300 units per minute sustained. `RATE_LIMITED` returns `retry_after_s`. These limits are for runaway loops, and the trace panel shows the units spent by each step.

Queries have a time budget and a row budget. A query over a source without a time predicate, over more than the source's partition limit, is refused with `QUERY_TIMEOUT` and a hint to add a window.

### D.10 Prompt injection and untrusted data

Order notes, carrier messages, comments and titles can contain text written by anyone.

- **Envelope.** Every free-text field from a source, comment or node is returned inside `{"untrusted_data": …}`, and the tool description says that content inside the envelope is data and never an instruction. Plinth's own result text never contains instructions.
- **No authority from content.** A string in data cannot grant a permission, change a scope, or produce a preview token. Authority comes from the authenticated principal, the ceiling and the grant index.
- **Narrow tools.** The agent cannot write grants (section D.5), cannot present to a principal who did not start the session, and cannot commit an action whose effects it did not declare in its preview.
- **Flagging.** A Change whose ops or reason echo untrusted text is stored with `contains_untrusted = true`, so reviewers can find it.

This is not a complete defence. A model that reads the envelope and still proposes a harmful change is limited by its ceiling, by the preview that a human or a policy must accept, and by the audit trail. That is the same protection a manipulated human operator would have, and it is stated as a known limitation (G.5).

### D.11 Audit, versioning, undo

- **Audit** is the `changes` table, hash-chained per workspace. `GET /audit/verify` checks the chain on demand and at startup. A broken chain is a visible failure on the status page.
- **Versioning.** Every node revision is recoverable from the chain. Snapshots every 50 changes per node bound replay time. Branches are named head pointers (supporting, G3).
- **Undo** appends the inverse of a Change, computed at commit and stored in `inverse_ops`. Undo never deletes history. Undo across principals is allowed for principals with write access to the same paths, and is audited with `undo_of`.

---

## E. AWS and local deployment

### E.1 One set of images

Four images are built from one repository on a distroless Node base: `plinth-app` (api, rt, web assets and mcp, with the entrypoint selecting the process), `plinth-worker`, `plinth-ingest` and `plinth-gen`. Each image is immutable, tagged with the commit and the content digest, signed, and carries an SBOM. DuckDB extensions are bundled in every image that runs queries. The same digests run locally and on AWS. Configuration differs only by environment variables and by the endpoint behind each interface.

### E.2 Cloud integrations behind explicit interfaces

| Interface | AWS implementation | Local implementation | What is preserved |
|---|---|---|---|
| Relational store (`ControlStore`) | Aurora PostgreSQL | PostgreSQL 16 container | Same SQL, migrations and isolation level (read committed; row locks on `workspace_chain` and `nodes`) |
| Event stream (`EventBus`) | Amazon MSK (IAM auth) | Redpanda single node | Topic names, partition key (`workspace_id`, `order_id`), consumer groups and offsets |
| Object store (`BlobStore`) | Amazon S3 | MinIO | Bucket layout, SDK, lifecycle rules |
| Cache and presence (`Ephemeral`) | ElastiCache for Redis | Redis container | Keys, TTLs and pub/sub channel names. Non-authoritative on both |
| Identity (`Identity`) | Cognito user pool (OIDC) | Keycloak with an exported realm | OIDC flows and claim mapping (`sub`, `plinth/workspace`, `plinth/roles`) |
| Secrets (`Secrets`) | Secrets Manager | Read-only environment file | Lookup by name |
| Compute | ECS Fargate services behind an ALB | docker compose with the same images and health checks | `/healthz` liveness and `/readyz` readiness with dependency checks |
| Telemetry | CloudWatch and X-Ray via OpenTelemetry | OpenTelemetry collector to a local Grafana | Same instrumentation |
| Infrastructure as code | AWS CDK (TypeScript) | Compose file rendered from the same service manifest | Service names, ports and dependency graph |

**What differs and why behaviour is unchanged.** Each interface has a contract suite that runs against both implementations in CI. The Kafka suite asserts ordering per key and redelivery after a consumer crash. The S3 suite asserts multipart upload and listing. The OIDC suite asserts claim presence and expiry handling. The local implementations are real servers speaking the same protocols. Differences that cannot be removed (Cognito and Keycloak claim names, for example) are confined to the `Identity` adapter and listed in the runbook.

### E.3 Exposure of the MCP server

**Local.** Two transports from one entrypoint.

- **stdio** for Claude Code and Claude Desktop: the client launches `docker run --rm -i … plinth-app mcp --stdio --principal agent:claude-code`, with the workspace and token in the environment. The demo uses this path.
- **Streamable HTTP** at `http://localhost:8790/mcp`, with an OAuth 2.1 bearer token from the local Keycloak, using PKCE.

**AWS.** Streamable HTTP at `https://mcp.<domain>/mcp` behind the ALB. The MCP service validates Cognito-issued tokens against JWKS as an OAuth protected resource, and publishes its metadata at `/.well-known/oauth-protected-resource`. Tokens are short-lived and refreshed by the client. The MCP service runs in private subnets, with the ALB as the only ingress.

Stdio is not offered on AWS, and that is intended. The tool list, schemas, errors and audit rows are the same on both transports (claim tested in section F).

### E.4 Operations for the demo

**One reset mechanism.** `make demo-reset` does one thing. It restores the control store from a snapshot taken after the build, and points the demo workspace at the immutable history manifest. The 30-day history is not regenerated and not reloaded at reset: its partitions are immutable and referenced by the manifest. Live partitions from the previous run are written under a per-run prefix and removed at reset. The design target is 20 s, measured in the rehearsal. Test `history_reproduces` regenerates the history from the seed in a build job and checks its manifest hash against the snapshot, so the snapshot is provably the seed's output.

**DuckDB extensions.** Bundled in the images, with a pinned version. The `httpfs` and `postgres` extensions are loaded from the local filesystem, never fetched at runtime. Test `private_subnet_startup` runs a task in a private subnet with no NAT route, with VPC endpoints for S3 and Secrets Manager only, and checks that the first query over S3 and the first attach to Postgres succeed.

**Startup.** `make up` (or `docker compose up`) starts the stack in dependency order with readiness gates. `make rehearse` runs the browser rehearsal: Playwright drives the windows through the script, waits on the realtime sequence number exposed by the page rather than on timeouts, asserts on each visible result, and runs the replay driver against the transcript.

**Recovery.** The driver resumes from any step boundary (C.3). Reset is the fallback when the state is unknown.

---

## F. Five strongest technical claims

Each claim has an executable test or an observable behaviour. Test names are those the CI and rehearsal suites carry.

**Claim 1: Every write is one path, so every surface produces identical state and audit.**
Test `commit_equivalence`: generate 1,000 random valid Change sequences over a seeded workspace. Apply each through the HTTP API, the MCP `node.commit`, the CLI and the UI's API calls, each in a fresh workspace. Assert that every node's `body_hash` is identical across surfaces, and that `changes` rows differ only in `surface`. Test `chain_linear_under_concurrency`: 200 concurrent commits across 20 nodes in one workspace; verify the chain links with no fork and that `workspace_chain.head_seq` equals the number of rows. Observable on stage: the audit panel shows one row shape for the agent's panel and for a human's drag.

**Claim 2: Row-level security cannot be bypassed by any downstream feature, and cached results do not leak across policies.**
Test `rls_differential`: for 10,000 generated queries over `orders` and 200 generated grants, compare running each query as the restricted principal with the grant's predicate written by hand into the `where` clause. Also run the same query through rule evaluation, backtest, scheduled export and form lookup. Assert row-set equality on all paths, and that no path returns a row the grant excludes, including through joins and unions. Test `cache_isolation`: a masked and an unmasked principal, with identical row predicates, issue the same query; assert different `policy_hash`, different cache entries and no shared result. Observable at 135 to 165 s: `grant.check` with counts shows the before and after counts, and the Exec view loses rows after approval.

**Claim 3: The agent's preview is exact, and a token commits once.**
Test `preview_is_commit`: for 500 random Change sets, call `node.preview`, then `node.commit` with the token. Assert the committed `body_hash` equals the previewed result hash and the commit's ops equal the previewed diff. Negative cases: a stale token returns `PREVIEW_STALE`; a token for a different change returns `PREVIEW_REQUIRED`. Test `token_single_use_concurrent`: two concurrent commits present the same token; exactly one succeeds, and the other returns `PREVIEW_REQUIRED`. Observable: the preview diff at 30 to 60 s is the diff in the audit row.

**Claim 4: Undo is exact across principals and never rewrites history.**
Test `undo_roundtrip`: from a seeded workspace, apply 300 random Changes by mixed principals (human, agent, driver), then undo them in reverse. Assert that `body_hash` returns to the starting value, that the chain verifies at every step, and that `changes` has 600 rows, none modified. Observable at 195 to 215 s: the grant disappears, and the audit panel shows two linked rows.

**Claim 5: The agent path is measured against a pre-registered gate, and the deterministic fallback reproduces it exactly.**

*Agent path (test `agent_builds_ui_from_descriptions`).* A general model is given only the MCP tool list and the resources, with no description of Plinth internals. It is asked 13 fixed questions over the seeded data, with the prompt text fixed in advance:

- ten single-kind questions: Q1 p95 by region as a bar panel; Q2 carrier-by-region heatmap; Q3 KPI tile of late orders; Q4 table of open workflow instances; Q5 rule with a threshold and a notify action; Q6 drill-down panel bound to a parameter; Q7 form over workflow instances with a declared action; Q8 "who changed this dashboard in the last hour" as a panel; Q9 a phone-width layout of an existing dashboard; Q10 a parameter that filters two panels;
- three composition questions across kinds: C1 an agent-owned rule whose action runs within the ceiling; C2 a form plus a source plus a workflow transition timeline; C3 a grant plus a row predicate plus a panel, checked with counts.

Each question has a reference query. A run passes if the expected panel or node exists, its query result (with `as_of` pinned) equals the reference result on the result hash, and the visual type is as expected. Each question is run 20 times.

**Pre-registered gate.** The gate is written into the repository, with its hash recorded in the rehearsal report, before the first scored run. The tool surface is frozen only if **at least 11 of the 13 questions reach a pass rate of at least 0.75** over 20 runs, and **each composition question reaches at least 0.6**. The thresholds are pre-registered criteria, not predictions. If the gate fails, the descriptions, schemas and examples are revised and the evaluation is run again on the new surface. The question set is not reduced to meet the gate.

**Published results.** The rehearsal report lists every question with its pass rate and the failing runs in full, including the errors each run received and whether the agent recovered. Failed runs are not omitted. The number is a measured quantity and it varies by model version.

*Fallback (test `replay_reproduces`).* Record one live session, then replay it 10 times on a freshly reset workspace, locally, and 10 times on a staging AWS stack built from the same image digests. Assert that every query step's result hash matches the transcript, every Change's change hash matches, and the final `body_hash` of the Ops board, the finance board, the rule and the workflow instance match across all 20 runs. Watermarks are recorded and not compared. The replay runs at the recorded `as_of` values, and the fault applies at the recorded tick.

**What the claims deliberately exclude.** The platform is not claimed to be deterministic under a live agent. It is claimed to be deterministic under replay, and bounded under any agent: by its ceiling, its previews and its audit trail.

---

## G. Failure analysis

### G.1 Implementation difficulties

1. **Predicate injection correctness.** Row security is only as good as the compiler's handling of joins and unions. Mitigation: predicates attach to the source relation before any operator, and the differential test in claim 2 covers joins and unions. This is the hardest correctness problem, isolated in one module.
2. **Path-level merge semantics.** Deciding conflicts among parent and child paths, list insertions and moves takes careful rules. Mitigation: lists are keyed by stable ids, moves are remove plus insert with the same id, and the merge rules are a table with tests.
3. **Watermark correctness.** A panel stating "as of 14:20" must not read partially written partitions. Mitigation: a partition is published only after its rename, and watermarks advance only over published partitions.
4. **Deterministic replay across machines.** Floating-point aggregation order varies with thread count. Mitigation: replay hash checks run with `threads=1`, percentiles are exact rather than sketched, and result hashes are over values rounded to six significant digits.
5. **Commit serialisation.** The workspace head lock serialises commits in a workspace. Under demo load (one human commit every few seconds and the agent's bursts) this is not a bottleneck. Contention is measured in rehearsal. Under heavy multi-tenant load the path is sharding by workspace, which the design already requires.
6. **Re-execution cost.** Without incremental maintenance, a large panel is recomputed on every advance past its `as_of`. Mitigation: coalescing at one run per second and the policy-keyed cache (G.5).
7. **Identity claim drift.** The `Identity` adapter normalises claims, and the contract suite catches drift.
8. **Ambiguous commit outcomes.** Mitigation: the cancellation rule and idempotency lookup in D.6, covered by a test that cancels commits at random points and checks that the resolved outcome matches the chain.

### G.2 On-stage failure modes

| Failure | Symptom on stage | Mitigation | Recovery |
|---|---|---|---|
| Agent commits without a preview | `PREVIEW_REQUIRED` in the trace | Enforced by scope. The error tells the agent to preview. | Agent previews and commits again. Visible, normal recovery. |
| Agent asks to commit a grant | `FORBIDDEN` naming `grant:write` | Ceiling. Proposal path is the documented route. | Agent proposes; presenter approves. |
| Agent invents a field (`latency` for `latency_ms`) | `UNKNOWN_FIELD` with `did_you_mean` | Closed error codes; `available` lists. | One retry. |
| Agent names a source that does not exist | `UNKNOWN_REFERENCE` listing sources | `source.list` is in the prompt pattern. | One retry. |
| Agent is slow | No tool call beyond the step budget | Driver switch (C.3). | Driver replays the step; the live step is cancelled before its transaction. |
| Agent loops on errors | Repeated `VALIDATION_FAILED` | Rate limit; switch after two failures on one step. | Driver. |
| Query is slow | Loading state beyond 2 s | Budget; coalescing; cache; progress from `notifications/progress`. | The step is pre-warmed in rehearsal. |
| Feed stalls | Watermark stops; KPI "as of" time stops | Staleness is shown, not hidden. | Generator restart from its last tick; the demo continues from the landing store. |
| Virtual clock stalls after the fault cue | No Rule change for more than 10 s on the console | Console shows the virtual clock and a stall indicator; the cue is recorded at its tick. | Presenter says the feed is catching up and waits; or the driver switch. |
| Fault cue lost | Rule stays `ok` after 5 s | Cue is acknowledged by the console; scripted cue after 5 s of silence. | Scripted cue, recorded at its tick. |
| Redis down | Presence badges disappear | Outbox recovers fan-out on resume; commits do not depend on Redis. | Redis restart. |
| Browser loses its socket | Screen freezes | Resume by revision; "reconnecting" status. | Automatic. |
| Rule fires twice | Two toasts | Firing id; one notification per firing. | Tested. |
| Undo leaves Exec view stale | Exec view inconsistent | Undo is a Change, so the stream carries it. | Rehearsal asserts the Exec view after undo. |

### G.3 Agent failure modes

- **Wrong tool call.** Scope enforcement and the error model cover it. The agent can still pick a poor query. Mitigation: `query.explain`, and a preview that shows the result before commit.
- **Hallucinated fields and sources.** Typed errors cover them. The agent can still state a plausible explanation the data does not support. Mitigation: the panel shows the query, the watermark and the row count beside the prose, and the 60 to 100 s beat limits the prose to numbers on screen.
- **Confident wrong explanation.** The agent names a carrier the data does not support. This is visible to the audience beside the evidence, and the design does not hide it.
- **Excess authority.** Ceiling, scope and grants cover it.
- **Prompt injection through data.** Covered as far as D.10 can cover it, which is stated as a limitation.

### G.4 Hidden complexity

- Expression typing across joins and derived fields is larger than it looks. The typechecker is the most involved module.
- Policy-keyed caching means every new grant or mask version invalidates affected entries. The invalidation is tested, not assumed.
- Backtests cost real time per preview. They are bounded by the hold window and cached.
- Snapshot and replay of nodes with long histories needs the snapshot policy tested.
- Lineage is derived from ASTs and Action declarations, so every new expression form must extend lineage. That is the price of impact preview and of the closing beat.
- Presence under reconnection storms needs throttling and deduplication.

### G.5 Known limits, stated plainly

- No incremental view maintenance. A large query is recomputed in full on each advance past its `as_of`, coalesced to one run per second.
- The commit path serialises all commits within a workspace, through one head row. Sharding is by workspace.
- Collaborative editing is path-level, with last-writer-wins on text fields. Two edits to the same text are not merged.
- Replay determinism holds with `threads=1`, fixed seeds and a pinned history manifest. Under a live agent the run is not deterministic.
- Replay checkpoints prove rows at `as_of`, not the arrival state of partitions beyond it.
- Prompt-injection defence is advisory at the model layer. Ceilings, previews and audit bound its effects; they do not stop a model from proposing a bad change.
- Cross-workspace queries are not supported.
- The agent-path pass rate is a measured quantity that varies by model version.
- Visual types are bar, table, KPI and heatmap in the demo; line and area are supporting; sankey and maps are not in version 1.

### G.6 Features that look more impressive than they are

- **Anomaly detection** is a trailing z-score window function. It is correct and labelled, not a learned model.
- **Embedding** is an iframe with a signed token and a fixed predicate. It has no SDK and no theming API.
- **Templates** are documents with declared parameters. They are not a marketplace.
- **Comments** are flat in the first cut. Mentions create notifications, and there is no inbox.
- **Presence** shows avatars and cursor positions on panels. It does not show who is editing a specific field.
- **Approvals** hold a Change pending a single approver.
- **Lineage** is field-level for queries and path-level for Changes. It is not column-level lineage across external systems.
- **"The agent can build almost anything"** is bounded by the expression grammar and the visual set. It can build any panel the grammar expresses, not any UI.
- **Fourteen tools** look few. Each is a generic verb, so the surface the agent sees is the grammar. Whether that is discoverable is the question the gate in claim 5 measures, not an assumption.

---

## H. Feasibility

Feasibility is expressed by what each component touches and by the order in which components unblock one another.

### H.1 Scope by component

| Component | What it touches | What makes it hard |
|---|---|---|
| `plinth-core`, `plinth-spec` | Node model, Change application, canonical JSON, hashing, JSON Schema generation, diff, undo | The workspace head lock, idempotency scoping, the merge table; claims 1 and 4 |
| `plinth-query`, `plinth-engine` | AST, typechecker, policy injection, column masks, DuckDB compile, `as_of` pinning, policy-keyed cache, watermarks | Predicate injection through joins and unions; claim 2 |
| `plinth-api` and auth | Fastify routes, OIDC verification, grant index, rate limits | One `authorize` function on every surface |
| `plinth-rt` | WebSocket, outbox relay, Redis fan-out, presence, resume | Reconnection storms and deduplication |
| `plinth-mcp` | Fourteen tools, resources, prompts, budgets, progress and cancellation, error model, both transports | Schemas a model reads correctly without prompting; the gate in claim 5 |
| `plinth-web` | Grid, panels, visuals, forms, phone layout, presenter console, trace panel | Breadth of interaction states, each of which appears on screen |
| `plinth-ingest`, `plinth-gen` | Partitions, publication by rename, watermarks, seeded generator, virtual clock, fault profiles, history manifest | Watermarks that never expose half-written partitions; the 14:05 episode |
| `plinth-worker` | Rule state machine, firing ids, workflow runner, backtest, owner principal intersection | Exactly-once firing under restart |
| `plinth-driver` and rehearsal | Transcript recorder, replay, `as_of` and tick binding, Playwright scripts | Depends on every other component being stable |
| Deployment | Images, compose, CDK stacks, contract suites, private-subnet startup test | Parity of behaviour across the two stacks |

### H.2 Critical dependencies

- **DuckDB Node binding.** Risk: behaviour on Windows and Linux containers, and extension loading. Mitigation: extensions bundled; engine tests run in the container on both hosts; private-subnet startup test.
- **MCP TypeScript SDK.** Risk: protocol features (progress, cancellation, resource subscriptions) differ across clients. Mitigation: a spike with Claude Code and Claude Desktop before the tool schemas are frozen.
- **Kafka client library.** Risk: consumer group behaviour under restart. Mitigation: the contract suite in E.2.
- **Keycloak and Cognito.** Risk: claim differences. Mitigation: the `Identity` adapter and its contract suite.
- **Playwright.** Risk: flakiness on realtime screens. Mitigation: rehearsal waits on the page's realtime sequence number.
- **Live model availability.** Risk: latency and errors on stage. Mitigation: the fallback driver, which is a required deliverable.

### H.3 Main risks, ranked by what they block

1. Predicate injection correctness (blocks claims 2 and 3, and the agent's safe use of queries). Resolved by the differential test before any UI depends on it.
2. Commit, merge, idempotency and undo semantics (blocks claims 1, 3 and 4, and collaboration). Resolved by the property tests and the concurrency tests.
3. The MCP tool schemas and error model (blocks claim 5). Resolved by the gate, which runs before the surface is frozen.
4. Deterministic replay (blocks the fallback and therefore the reliability criterion). Resolved by the replay test on local and staging.
5. Query latency on the demo dataset (blocks the timing of the choreography). Resolved by measuring the targets on the seeded history early.
6. Episode calibration (blocks the 14:05 answer and the rule backtest). Resolved by `episode_in_history` and `backtest_fires_once`.

### H.4 Dependency-ordered build sequence

Each stage unblocks the next. A stage is complete when its named test passes.

**S0: vertical slice.** One source (orders, landed as partitions with a watermark, from the seeded history manifest), one query (p95 by region), one Panel, one Dashboard, one `node.commit`, one realtime push to a second window, one `node.get` through MCP. Done when the panel appears on the second window within the commit-to-screen target and the commit is in the chain. This touches every package at minimal depth.

**S1: kernel.** `plinth-core` with Change, revision, workspace head lock, principal-scoped idempotency, diff and undo. Done when `commit_equivalence`, `chain_linear_under_concurrency` and `undo_roundtrip` pass.

**S2: query compiler and policy.** Full AST, typechecker, DuckDB compile, workspace predicate, row predicates attached to source relations, column masks, `as_of` pinning and policy-keyed cache. Done when `rls_differential` and `cache_isolation` pass, including joins and unions.

**S3: authorization and the agent principal.** `authorize`, grant index, principal kinds, the agent ceiling, scope intersection, rule owner semantics, approval for grant proposals. Done when the agent cannot commit a grant, the error names the permission, and `agent_rule_notify` passes.

**S4: preview and commit.** `node.preview` with Postgres tokens, stale detection, lineage delta, backtest for rules, cancellation rule. Done when `preview_is_commit` and `token_single_use_concurrent` pass.

**S5: MCP surface and the gate.** The fourteen tools with budgets, six resources, three prompts, both transports, progress, cancellation and the error model; then the 13-question evaluation against the pre-registered gate. Done when the gate result is recorded in the repository, whether it passes or not. The surface is frozen only when it passes; if it does not, the surface is revised and evaluated again. This stage sits before the web surface because the composition argument depends on it, and because the gate can fail and change the design.

**S6: realtime and collaboration.** Subscriptions, resume by revision, outbox relay, presence, path-level merge with conflict payloads. Done when the 165 to 195 s stale-base scenario reproduces in a Playwright test.

**S7: generator, history and episode.** Seeded generator, virtual clock, the 14:05 `FaultProfile`, the history manifest, the snapshot, the presenter's fault cue at ticks. Done when `episode_in_history`, `backtest_fires_once` and `history_reproduces` pass, and the cue produces the same events on a replay.

**S8: web surface.** Grid, panels, visuals, parameters, cross-filter, forms, phone layout, presenter console, trace panel with live and replay tags. Done when the windows can be driven by the rehearsal with no manual steps except the scripted presenter actions.

**S9: rules, workflows and actions.** Rule state machine with firing ids, workflow instances, action effects, form write-back, notifications with one page per firing. Done when the 215 to 262 s steps reproduce, including the acknowledge write-back and its audit row.

**S10: replay driver and rehearsal.** Transcript recorder, replay with `as_of` and tick binding, replay keys, switch rules, `make rehearse`. Done when `replay_reproduces` passes locally.

**S11: deployment.** Images, compose rendering, CDK stacks, Cognito and Keycloak adapters, contract suites, private-subnet startup test. Done when the same digests pass the contract suites on both stacks, and `replay_reproduces` passes on staging.

**S12: measured report.** Pass rates per question with failing runs shown, performance targets measured on the seeded history, reset time measured, and the results recorded in the rehearsal report. Done when the report exists, whatever its numbers.

### H.5 What is cut first if scope must be reduced

The cut order follows the evaluation weights. Cut first: embedding, scheduled export, templates, branching (keep the single-dashboard branch as supporting), anomaly window, annotations. Keep: the kernel, the query compiler with policy injection, the fourteen verbs, preview and commit, undo, approval, realtime, presence, the rule-to-workflow-to-form chain, the lineage source and the fallback driver. The cut list removes breadth. It does not remove the composition the audience is meant to see.

---

## Closing note

Plinth's bet is that a demonstration of composition is convincing only if the composition is real. The kernel is six primitives, one specification language, one change log, one authorization function and one query compiler. The agent sees the same grammar the humans use. Everything it builds on screen is a document that could have been written by hand, reviewed as a diff, undone, explained by querying the platform's own audit and lineage sources, and checked against a gate it had to pass before its tools were frozen.

**Pitch (two sentences).** Plinth is an enterprise operations platform built from six primitives and one specification language, so that every dashboard, rule, workflow, form and permission is the same kind of composable object, whether a person, an API or an AI agent writes it. In five minutes, an agent connected through MCP answers a live question about a seeded fulfilment fault, builds the panel, alert, approved grant and acknowledge form that answer it, and then composes a blast-radius panel that no one programmed, with every step previewed, authorized, audited and reproducible.
