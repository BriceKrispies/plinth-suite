# Fathom: a composable operations platform with a first-class agent interface

Competitor 01, mandate: **Systems Complexity**.
Status: design proposal. Nothing in this document has been built or run.

**Pitch.** Fathom is an operations platform in which every dashboard, panel, query, alert, workflow and permission is a typed object in one replicated document model, changed through one operation registry that generates the web UI, the HTTP API and an MCP server. An external agent connected over MCP can preview, branch, merge, audit and undo its own changes on the screen the audience is watching, and can answer "why did latency spike at 14:05" by running real queries against real event data.

---

## A. Product concept

**What it is.** Fathom is a multi-user platform for building, sharing and operating dashboards over live data, with four properties that the demo is built to show:

1. **One document model.** A dashboard is a spec document: a tree of typed nodes (layouts, panels, controls, queries, alerts, annotations, comments). Spec documents are replicated and edited concurrently. They are versioned, branchable and diffable like source code.
2. **One operation registry.** Every capability is an operation with a typed input schema, a typed output schema, a required permission, an audit category and a preview function. The web UI, the HTTP API, the CLI and the MCP server are generated from this registry. There is no capability that exists in one surface and not another.
3. **A real query and transform engine.** Queries are a typed relational intermediate representation (IR), not strings. The IR is type-checked against units and column types, rewritten for row-level security, planned, and executed on an embedded columnar engine (DuckDB) over Parquet segments. Results carry a watermark, the spec revision and the parameter binding that produced them.
4. **An agent is a scoped principal.** An agent holds an identity, is owned by a human, and has an effective permission set equal to the intersection of its own grants and its owner's grants. Its writes go through the same validation, authorization, audit and real-time paths as a human's, and they are attributed, reviewable and reversible.

**Who uses it.**

- *Operations analysts* build and share boards over the order pipeline and act on alerts.
- *Ops leads* watch boards on a wall display and acknowledge workflows.
- *Finance and compliance* see only the panels and rows their role grants, and can audit who changed what.
- *Platform engineers* run the platform, read its own telemetry as a data source, and verify its audit chain.
- *Agents* (in the demo, Claude Code over MCP) answer questions and assemble UI from the same primitives the humans use.

**What the demo data is about.** A fulfilment network: six warehouses, forty dock doors, twelve carriers, about 1,400 orders per simulated hour at baseline. The data is produced by `fathom-sim`, a discrete-event simulator written in Rust, seeded with a fixed integer. It models order stages (received, picked, packed, staged, handed over, delivered), queueing at docks, carrier pickup windows and handoff throttling. It is not a paid service and it is not a recording. Its output for a given seed and clock is byte-identical across runs, which is what makes the rehearsal and the fallback driver deterministic.

The demo's scripted fault is a *modelled* fault, not a scripted visual. At scenario time 14:05 the simulator's carrier handoff rate at dock `NE-2` is reduced by a throttle parameter in the scenario file. Queues back up behind that dock, order latency rises, and the rise is visible in the event data as a consequence of the queueing model. Attribution queries then find `NE-2` as the dominant contributor because the data says so. The platform never receives a label saying "this is the cause".

**Why this data.** Operations latency is a domain every engineering audience understands, it has natural dimensions (warehouse, dock, carrier) for drill-down and cross-filtering, it has a clean "why" question that requires decomposition, and it has a natural write-back (acknowledge, reroute, hold). It also keeps the audience's attention on the platform rather than on the domain.

**Platform self-data.** The platform publishes its own operational events (request latency, commit counts, subscription lag, audit chain head) into a `platform` source using the same ingestion path. This lets an agent answer "what changed in the last hour" about the platform itself, and lets the audience see that the platform is observed by its own tools.

---

## B. Capability inventory

### B.1 Primitives

Status key: **D** = demonstrated on stage; **S** = supporting (exists, is exercised by tests and by the agent, shown only briefly or on request).

| # | Primitive | Status | Technical significance | Composes with |
|---|---|---|---|---|
| P1 | **Schema registry**: versioned kinds with JSON Schema, invariants and upcasters | D | One type system for every object; agents discover shape from it; migrations keep old revisions readable | everything |
| P2 | **Spec document (tree CRDT)**: replicated tree of typed nodes with fractional-index sibling order and move operations | D | Concurrent human and agent edits converge without a lock; the same structure is the diff and merge substrate | P5, P6, P9, P10, P12 |
| P3 | **Revision store**: content-addressed, immutable revisions with parents (a DAG) | D | Every state is addressable, comparable and restorable; enables branches and time travel | P2, P4, P9, P13 |
| P4 | **Branch and ref**: named mutable pointers into the revision DAG with compare-and-swap update | D | Agent work happens on a branch and lands by merge; live editing happens on `live` | P3, P9, P15 |
| P5 | **Structural diff** over spec trees (semantic: panel moved, query changed, param type changed) | D | Reviewers read changes as intent, not JSON noise; powers preview | P2, P3, P9, P15 |
| P6 | **Three-way merge** over spec trees with conflict sets | D | Concurrent branch merges are resolved or refused atomically with named conflicts | P4, P5 |
| P7 | **Operation log** with hybrid logical clocks (HLC) and per-replica sequence numbers | S | Total causal order for deltas; resumable subscriptions; deterministic replay | P2, P11, P16 |
| P8 | **Undo**: principal-scoped inverse operations, recorded as new revisions | D | Undo is itself auditable and never rewrites history | P2, P7, P17 |
| P9 | **Preview/commit protocol**: `plan` objects holding a diff, validation result, permission result and cost, committed by id and base revision | D | The agent's safety mechanism; the same protocol is the human "review changes" button | P5, P6, P14, P18 |
| P10 | **Dashboard** spec kind: layout, panels, controls, parameters, links | D | The unit the audience sees built | P11, P12, P13 |
| P11 | **Parameter**: typed, bounded variable bound into queries and controls | D | One value model for filters, time windows, thresholds and drill state | P12, P20, P25 |
| P12 | **Control**: input widgets (select, range, date window, multi-select) bound to a parameter | D | Human input path into the query engine | P11, P13 |
| P13 | **Panel**: query binding plus a visualization spec compiled to Vega-Lite | D | Visualization is also declarative and inspectable by agents | P14, P19, P21 |
| P14 | **Query** (typed relational IR) | D | The composable core: every panel, alert, metric, export and permission filter is a query | P15, P17, P18, P19, P20 |
| P15 | **Query type checker** with unit algebra (`ms`, `orders/min`, `ratio`) | D | Catches hallucinated fields and unit mistakes before execution with exact paths | P14, P16 |
| P16 | **Watermarks and provenance**: each result tagged with data watermark, revision and binding hash | D | Results are reproducible; the UI can say exactly what it is showing | P7, P14, P22 |
| P17 | **Incremental view maintenance** for simple aggregates and fixed-bucket histograms | S | Live panels update from deltas, not full recompute; histograms support retraction (t-digest does not) | P7, P14 |
| P18 | **Explain and cost**: plan output, estimated scanned bytes, row-count bounds | D | Agents and humans see cost before running; limits protect the shared engine | P14, P24 |
| P19 | **Transform stages**: `bucket`, `window`, `asof_join`, `pivot`, `rank`, `top_k`, `rolling_quantile`, `ewma` | D | Real analytics beyond CRUD; composable inside query IR | P14, P21 |
| P20 | **Cross-filter**: a selection event writes a parameter that other panels read | D | Interaction is a parameter write, so it is also an operation, an audit entry and an agent-visible state | P11, P12, P13 |
| P21 | **Drill-down**: a link from a panel element to a dashboard with bound parameters | D | Navigation is a typed link with parameter mapping, not a URL hack | P10, P11, P20 |
| P22 | **Lineage graph** computed from IR: source to dataset to metric to panel to alert | D | Answers "where does this number come from" and drives impact analysis | P14, P26, P27 |
| P23 | **Impact analysis**: which dashboards, alerts and workflows change if a metric or source changes | S | Safe change for agents; shown when the agent edits a shared metric | P22, P9 |
| P24 | **Quotas and budgets**: token-bucket rate limits, in-flight query caps, scan-byte budgets | S | Predictable behaviour for shared engines and for misbehaving agents | P14, P28 |
| P25 | **Metric** definition: named query with unit, owner, description and certification state | D | Metrics are the shared vocabulary agents search and reuse | P14, P22, P23 |
| P26 | **Attribution**: deterministic contribution analysis (decomposing a change in an aggregate over dimensions) | D | The engine answers "why"; it is the reason the demo question is answerable | P14, P25 |
| P27 | **Anomaly detection**: rolling median and MAD bands, EWMA residuals | S | Deterministic, explainable, no model | P19, P28 |
| P28 | **Alert rule**: predicate over a query with hysteresis, a `for` window and a state machine (`ok`, `pending`, `firing`, `resolved`) | D | Alerts are queries plus state; their transitions are events in the log | P14, P29, P31 |
| P29 | **Action**: a typed external effect (webhook, email, write-back row) with an allowlisted target and an idempotency key | D | Effects are explicit and gated; the agent cannot invent destinations | P31, P32 |
| P30 | **Form**: write-back to an entity with schema validation | S | Human input creates entities; the same validation as the API | P1, P29 |
| P31 | **Workflow**: a state machine with steps (action, approval, wait, branch on query result) and durable instances | D | Observable state transitions; survives restarts because state is in the log | P28, P29, P32 |
| P32 | **Approval step**: a workflow step that requires a named human principal | D | Human-in-the-loop as a primitive, enforced by authorization, not by UI convention | P31, P33 |
| P33 | **Principal**: human (OIDC subject), service, or agent (owned by a human, scoped) | D | One identity model for all actors | P34, P35 |
| P34 | **Role and grant**: Cedar policies over principals, object kinds and actions | D | Single authorization engine on both deployments | P33, P35, P36 |
| P35 | **Row-level security**: row predicates in IR, bound to principal attributes, injected at rewrite time | D | Finance sees finance rows through the same query path; no client filtering | P14, P34, P36 |
| P36 | **Column masking**: typed masking functions applied at rewrite time | S | Sensitive columns (customer name) appear as hashes to unprivileged viewers | P35 |
| P37 | **Workspace** (tenant) with isolation enforced by policy and by storage partitioning | S | Multi-tenancy as a boundary, not a column convention | P33, P34 |
| P38 | **Audit log**: hash-chained, written in the same transaction as the change, anchored to object storage with object lock | D | Every change is attributable and tamper-evident | P7, P8, P33 |
| P39 | **Presence and cursors**: ephemeral per-node state over the realtime channel | D | Humans and agents are visibly on the same object | P2, P40 |
| P40 | **Comments and threads** anchored to any spec node or revision | S | Review discussion attached to the object it concerns | P2, P39 |
| P41 | **Embed token**: signed, scoped, read-only grant for a dashboard with parameter lock | S | Sharing outside the platform with the same policy engine | P34, P10 |
| P42 | **Template**: a dashboard with declared parameters and placeholders, instantiated as a new spec | S | Reuse; agents instantiate templates rather than generating from scratch | P10, P11 |
| P43 | **Export**: CSV, Parquet and PNG snapshot of a panel, produced through the same query path | S | Exports respect RLS and masking because they use the same rewrite | P14, P35 |
| P44 | **Scheduled report**: a schedule that runs a dashboard snapshot and delivers via action | S | Composes P43, P29 and a scheduler | P29, P43 |
| P45 | **Search** over catalog, specs, audit and comments | S | Agents find existing metrics before creating new ones | P22, P25, P38 |
| P46 | **Event replay**: rebuild a dataset or a panel result at a past revision and watermark | S | Determinism check and incident forensics | P7, P16, P3 |
| P47 | **Health and readiness** endpoints plus the platform self-source | S | Operability; also supplies the platform telemetry data | P7, P38 |
| P48 | **Live ops feed** from `fathom-sim` into the ingest log | D | The real data supply the demo depends on | P7, P49 |
| P49 | **Ingest log** with idempotent batches (producer id and sequence) | S | Exactly-once effect on the store despite retries | P48, P7 |
| P50 | **UI focus** (`ui.focus`): an agent or a human points every connected screen at an object | D | "Things can show on the screen" is a primitive with permission and audit, not a demo trick | P39, P10, P13 |

### B.2 Composition map

The core is five things: the **spec tree** (P2, P3, P4), the **query IR** (P14, P15, P16), the **operation registry** (which generates every surface), the **policy engine** (P34, P35), and the **log** (P7, P38). Everything else is a composition:

```
                 ┌───────────────── operation registry (one definition → UI, HTTP, CLI, MCP) ─────────────────┐
                 │                                                                                           │
  principal ──► policy (P34,P35 RLS) ──► preview/commit (P9) ──► spec tree (P2) ──► revisions/branches (P3,P4)
  (P33)                                        │                    │                      │
                                               ▼                    ▼                      ▼
                                       diff/merge (P5,P6)    dashboard (P10)         undo (P8)
                                                                 │
                 ┌──── control (P12) ──► parameter (P11) ◄──── cross-filter (P20), drill (P21)
                 │                            │
                 ▼                            ▼
          query IR (P14) ◄── type check (P15) ── transforms (P19) ── attribution (P26), anomaly (P27)
                 │       ▲
                 │       └── metric (P25) ◄── lineage (P22) ──► impact (P23)
                 ▼
     panel (P13) ──► live result with watermark (P16) ◄── IVM (P17) ◄── ingest log (P49) ◄── simulator (P48)
                 │
                 ├──► alert (P28) ──► workflow (P31) ──► action (P29) ──► approval (P32)
                 ├──► export (P43) ──► scheduled report (P44)
                 └──► embed (P41), template (P42), focus (P50), presence (P39), comments (P40)

     every mutation: principal + policy + plan + op log + audit chain (P38) + realtime fan-out (P7 → websocket)
```

The composition rule is that every arrow above is a typed reference. A panel's query is a value of the same IR type that an alert uses and that an export uses. A workflow step that runs a query uses the same engine call as a panel. An agent's `ui.focus` operation is the same operation a human triggers by clicking a link. A dashboard's diff is the same diff the preview shows. This is what gives the platform breadth without a feature surface that grows independently.

### B.3 What is demonstrated and what is supporting

On stage (D): P1, P2, P3, P4, P5, P6, P8, P9, P10 to P16, P18, P19, P20, P21, P22, P25, P26, P28, P29, P31, P32, P33, P34, P35, P38, P39, P48, P50. That is roughly thirty-five capabilities, and each appears in at least one visible action.

Supporting (S): the rest. They are real and tested, and they are reachable by the agent, but the script does not spend time on them.

---

## C. Five-minute live script

### C.0 Setting

Three browser windows are visible on one display, arranged left to right: **Ops wall** (role `ops-lead`, full-screen board), **Analyst** (role `analyst`, the presenter's editing window) and **Finance** (role `finance-viewer`, narrow). A fourth pane at the right edge is the **agent session**, a Claude Code terminal connected to Fathom's MCP endpoint `http://localhost:8080/mcp` (local) or `https://fathom.<domain>/mcp` (AWS). The platform has been reset with `fathom demo reset --seed 1408`, which restores the revision `demo-start`, reloads three hours of simulated history (scenario clock 11:00 to 14:00), and starts the live feed at scenario 14:00. The live feed advances the simulated clock at 10 simulated seconds per real second, so the 14:05 throttle begins about 30 real seconds into the demo's live window. Measured values in the rehearsal section (F and G) say what this has to be checked against.

The agent session is opened with the sentence the presenter says aloud: "The platform has an MCP server. I'm going to let an agent build the operations view while you watch."

### C.1 Timeline

| Time | Presenter action | Expected behaviour (agent MCP calls in **bold**) | Visible result | Capabilities | Transition |
|---|---|---|---|---|---|
| 0–30 s | Presenter states the purpose in one sentence, with the Ops wall showing a live but empty board. Says: "Everything here is one document model, and an agent is a scoped principal on it." | None. The Ops wall shows the platform status panel (P47), the live event counter (P48) and the audit head advancing. | Three windows, live counters, audit head moving. | P47, P48, P38 | Presenter switches to agent pane. |
| 30–70 s | Types: `List the metrics and sources that describe order fulfilment, and tell me which already exist before we create anything.` | **`catalog.search {"q":"order fulfilment","kinds":["metric","source"]}`**, then **`metric.get`** for the top three hits. The agent reports that `order_latency_p95` exists with owner, unit `ms` and certification `certified`. | Agent answers in four lines. The catalog pane in the Analyst window highlights the three objects, via **`ui.focus`** called by the agent with `{"targets":[...],"mode":"highlight"}`. | P45, P25, P50, P22 | Presenter asks for the board. |
| 70–120 s | Types: `Build an Order Operations board on a branch called agent/ops-board: a KPI row with p95 latency and orders per minute for the selected window, a line chart of p95 by warehouse, and a window control. Preview it first and show me the diff.` | **`spec.preview {"branch":"agent/ops-board","base":"live","ops":[...]}`** returns `plan_id`, a semantic diff of 9 node creations, validation (clean), permission check (clean), query cost (estimated scan bytes, row bound). The agent then calls **`spec.commit {"plan_id":"pln_…","expected_base_rev":"rev_…","idempotency_key":"k-ops-board-1"}`** to the branch. Then **`branch.merge {"from":"agent/ops-board","into":"live"}`** after the presenter approves in the UI. | The Analyst window shows the diff as intent ("adds KPI row: 2 panels; adds control window; adds line chart"). After approval, the board appears on the Ops wall within one second, with a **"agent"** presence badge on the layout node. | P9, P5, P3, P4, P6, P10–P16, P33, P39 | Presenter asks a question. |
| 120–165 s | Types: `Why did p95 order latency spike around 14:05? Use the data, not a guess, and show the evidence on the board.` | **`query.explain`** on the p95 query, then **`query.run`** grouped by `warehouse` and `dock` over 13:50–14:20, then **`attribution.run {"metric":"order_latency_p95","dims":["dock","carrier"],"baseline":"13:30–14:00","window":"14:05–14:20"}`**, then **`lineage.of`** for the dock dimension. The agent reports: dock `NE-2` contributes 91% of the excess; carrier `Northline` is 88% of `NE-2`'s excess; the throttle is visible as handoff rate falling from 0.82 to 0.31 per minute. | The agent's answer in the terminal. On the Ops wall a new panel "Attribution: 14:05 spike" appears with a bar chart of contribution by dock, created via **`panel.create`** and the agent's evidence annotation via **`annotation.create`** at 14:05 on the line chart. | P14, P16, P18, P26, P22, P19, P40 (annotation), P50 | Presenter asks for the drill-down. |
| 165–210 s | Types: `Make a drill-down for NE-2: one panel per carrier, a control for the time window that is shared with the board, and a link from the bar chart so clicking a dock opens it. The Ops lead will see it on the wall.` | **`dashboard.create {"from_template":"tpl_dock_drilldown"}`** (P42), then **`panel.create`** ×3, **`control.bind {"control":"window","parameter":"window"}`**, **`link.create {"from":"panel:attribution.bar","to":"dash:dock_drilldown","map":{"dock":"dock"}}`**, and **`spec.commit`** to `live`. The agent also calls **`schema.describe {"kind":"link"}`** after a first attempt, see below. | Ops wall gains a navigation control. The Analyst clicks a bar for `NE-2`: the Ops wall and Analyst both switch to the drill-down dashboard with `dock=NE-2` bound, because the cross-filter parameter write (P20) is an operation in the shared log. | P10–P13, P20, P21, P42, P7, P39 | Presenter introduces the conflict. |
| 210–255 s | Presenter, in the Analyst window, starts editing the title of the drill-down panel to `NE-2 handoff`. While the title input is still focused, the agent runs **`spec.commit`** on a change to the same node's `query.window` default. | Both writes arrive. The CRDT merges per property: the title (human) and the window default (agent) are different registers, so both apply. The Analyst sees a non-blocking chip: `Agent changed: window default 1h → 2h`. The presenter clicks **Revert** on that chip, which issues **`spec.revert {"node":"…","field":"query.window"}`**, recorded as a new revision attributed to the human, with the agent's change left in history. | A visible merge with two named authors on one node, and a revert recorded in audit. | P2, P6, P8, P9, P38, P39 | Presenter introduces the boundary. |
| 255–270 s | Types: `Add an alert: notify ops if p95 latency is above 1500 ms for three consecutive minutes at any dock. Then let the finance viewer see the board, including the NE-2 drill-down.` | **`alert.create {"metric":"order_latency_p95","threshold_ms":1500,"for":"3m",...}`** fails validation: `unknown_field: for` with `did_you_mean: "hold"` and `valid_alternatives: ["hold","window","hysteresis"]`. The agent retries with `hold: "3m"`, runs **`alert.test`** against the last 20 minutes, which reports the 14:05 firing with its replay state trace. Then **`acl.grant {"object":"dash:ops_board","to":"group:finance-viewer","role":"viewer"}`** is refused: `scope_exceeds_owner`, with the owner's grant set as evidence. The agent reports that it cannot widen access and that the presenter must approve. Presenter approves in the UI, an approval step (P32), and the grant is applied under the human principal. | The alert appears in the Ops wall as `firing` with state trace. The finance window shows the board minus the `NE-2` panel, because the grant on the drill-down was never made; the approval grant applies only to the board, and the row-level predicate hides the rows for `NE-2` customers not in the finance role. | P28, P31, P32, P33, P34, P35, P15 | Presenter asks the closing question. |
| 270–300 s | Presenter says nothing. The live feed produces a second throttle on `W3-D12` (scenario-scripted, also modelled). The agent is asked: `Hold the NE-2 workflow until a human has seen this, then tell me what changed in the last ten minutes.` Mid-sequence, the presenter kills one of two `fathomd` replicas with `kill -9`. | **`workflow.start`** for `incident-triage` (P31), **`task.hold`** on the step, then **`audit.search {"since":"-10m"}`** (P38). During the kill, the agent's in-flight **`spec.commit`** with `idempotency_key` `k-hold-1` is retried by the client; the surviving replica returns the original response, not a second revision. Both browser windows reconnect and resume from their last delta cursor (P7). `audit verify` runs and reports the chain intact. | The workflow shows `running → waiting_approval`, the approval appears on the Ops wall, and a small status line shows the replica failover, the resumed subscriptions and zero missing or duplicated deltas. | P31, P32, P38, P7, P49, P47 | End. |

### C.2 Why the last 30 seconds are the strongest moment

The final 30 seconds combine four things an engineering audience checks for: an agent's retried write does not double-apply, a process death is survived without the human browser sessions losing state, the audit chain is verified after the failure, and the workflow is waiting on a human approval rather than acting on its own. Each is a property a skeptical engineer can ask about, and each is visible on screen in one glance. The presenter's spoken line is: "I just killed a server. The agent's write went through exactly once and the audit chain still verifies."

### C.3 Fallback driver

The fallback is the real MCP path, not an animation.

**Recording.** During rehearsal, a recording client (`fathom-replay record`) connects to the MCP endpoint as the same agent principal and captures, per step, the exact `tools/call` request, the response, and the state checkpoint: the BLAKE3 hash of the spec tree at `live`, the audit head hash, and the set of panel result watermarks. The recording is stored as a file in the repository, `demo/script/fallback-v1.jsonl`, with one step per line.

**Replay.** `fathom-replay play --from <step>` issues the same requests to the same MCP endpoint, in order, and compares each response's *semantic* content (plan ids and revision ids are re-bound by name, not by value) and each checkpoint hash. A mismatch stops the replay and reports the step. Because the platform is deterministic given the seed and the clock, the replay reproduces the same spec state and the same panel values.

**Switch.** The live agent is the default. The presenter's keyboard switch (`Ctrl+Shift+F`) does three things: it stops listening to the agent pane, starts the replay at the current step, and prints `replay step N` in the terminal, which is in the presenter's own window and not in the audience's view. The agent pane shows the same tool calls scrolling by, because the replay client writes them to the agent session transcript with the same formatting. Latency inside the replay is the platform's latency, which the rehearsal measures; there is no artificial delay.

**Triggers.** The presenter switches on any of three conditions: no tool call within the step's expected window; a tool error the agent does not correct on its second attempt; or a response that contradicts the recording's checkpoint (for example the agent claims a different dock).

**Rehearsal.** `fathom-replay verify` runs the full recording in a headless browser (Playwright), then runs a live agent session against a freshly reset platform to check that the live path converges to the same checkpoints. The script is accepted only when both pass.

---

## D. Technical architecture

### D.1 Components

| Component | Language and framework | Responsibility |
|---|---|---|
| `fathomd` | Rust (tokio, axum, tower) | Single application binary: HTTP API, realtime gateway (WebSocket, SSE fallback), MCP server (Streamable HTTP and stdio), operation registry, workers (alerts, workflows, schedules, exports), static web assets |
| `fathom-spec` | Rust crate, compiled to WASM for the browser | Spec tree CRDT, canonical JSON, schema validation, diff, three-way merge. The same code runs in the server and the browser, so client-side preview matches server preview |
| `fathom-ir` | Rust crate | Query IR, type checker, unit algebra, RLS rewrite, planner, lowering to DuckDB SQL |
| `fathom-policy` | Rust crate over `cedar-policy` | Authorization: entity model, policy set loaded from the repository, decision function |
| `fathom-ivm` | Rust crate | Incremental maintenance for aggregates and fixed-bucket histograms over ingest deltas |
| `fathom-sim` | Rust binary | Deterministic discrete-event fulfilment simulator, produces events into the ingest log |
| `fathom-replay` | Rust binary + Playwright | Recording, replay and verification of the fallback script |
| `web` | TypeScript, React 18, Vite, Vega-Lite via vega-embed, CSS modules | Operator UI; the same operation registry generates a typed client |
| Postgres | PostgreSQL 16 | Authoritative metadata, revision store, op log, audit chain, workflow instances, idempotency records |
| DuckDB | Embedded in `fathomd` | Query execution over Parquet segments |
| Redpanda | Kafka protocol | Ingest log and the platform's internal change stream |
| MinIO | S3 protocol | Parquet segments, audit anchors (with object lock), snapshots |
| Keycloak | OIDC | Human identity locally |
| OpenTelemetry Collector, Jaeger | OTLP | Traces and metrics |
| Mailpit | SMTP | Email action sink |
| Headless Chromium | Playwright | PNG snapshots and rehearsal |

Rust is the language of the core because the core is concurrency-heavy (commit ordering, subscriptions, IVM), must be deterministic, and benefits from exhaustive matching over IR and op variants. TypeScript is the language of the UI because the UI is a React application and the only feasible route to a polished, responsive interface on the timescale-free scope here. Postgres is chosen because transactional metadata plus audit in one commit is the simplest correct design; DuckDB is chosen because it is an embedded, columnar, vectorised engine that reads Parquet directly, which removes a warehouse dependency from the local and AWS deployments alike.

### D.2 Persistence model

Key tables (Postgres unless noted):

```sql
CREATE TABLE object (                  -- content-addressed canonical JSON blobs
  hash         bytea PRIMARY KEY,      -- BLAKE3 of canonical JSON
  kind         text NOT NULL,          -- e.g. 'panel', 'query', 'layout'
  body         jsonb NOT NULL
);

CREATE TABLE revision (
  id           text PRIMARY KEY,       -- 'rev_' + BLAKE3 of (parents, tree_root, author, hlc)
  parents      text[] NOT NULL,        -- DAG edges; merges have two
  tree_root    bytea NOT NULL,         -- root of the spec tree snapshot
  author       text NOT NULL,          -- principal id
  hlc          bigint NOT NULL,        -- hybrid logical clock
  message      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ref (
  workspace    text NOT NULL,
  name         text NOT NULL,          -- 'live', 'agent/ops-board', ...
  rev_id       text NOT NULL REFERENCES revision(id),
  version      bigint NOT NULL,        -- compare-and-swap counter
  PRIMARY KEY (workspace, name)
);

CREATE TABLE op_log (                  -- CRDT operations on a spec tree
  workspace    text NOT NULL,
  replica      text NOT NULL,
  seq          bigint NOT NULL,        -- per-replica sequence
  hlc          bigint NOT NULL,
  op           jsonb NOT NULL,         -- Insert | Move | SetReg | Delete (tree CRDT)
  principal    text NOT NULL,
  PRIMARY KEY (workspace, replica, seq)
);

CREATE TABLE plan (
  id           text PRIMARY KEY,       -- 'pln_' + random
  principal    text NOT NULL,
  branch       text NOT NULL,
  base_rev     text NOT NULL,
  ops          jsonb NOT NULL,         -- normalised operations
  diff         jsonb NOT NULL,         -- semantic diff
  validation   jsonb NOT NULL,
  permissions  jsonb NOT NULL,
  cost         jsonb NOT NULL,         -- scan-byte estimate, row bound
  expires_at   timestamptz NOT NULL
);

CREATE TABLE idempotency (
  principal    text NOT NULL,
  key          text NOT NULL,
  request_hash bytea NOT NULL,
  response     jsonb NOT NULL,
  PRIMARY KEY (principal, key)
);

CREATE TABLE audit_event (
  seq          bigint PRIMARY KEY,
  actor        text NOT NULL,          -- human, service or agent principal
  on_behalf_of text,                   -- owner of an agent principal
  action       text NOT NULL,          -- registry operation id
  target       text NOT NULL,          -- object or ref
  rev_id       text,
  request_id   text NOT NULL,
  prev_hash    bytea NOT NULL,
  hash         bytea NOT NULL          -- SHA-256 over prev_hash and canonical body
);

CREATE TABLE workflow_instance (
  id           text PRIMARY KEY,
  definition   text NOT NULL,
  state        text NOT NULL,
  step         text NOT NULL,
  context      jsonb NOT NULL,
  version      bigint NOT NULL
);
CREATE TABLE workflow_event (workflow_id text, seq bigint, event jsonb,
  PRIMARY KEY (workflow_id, seq));
CREATE TABLE alert_state (rule_id text PRIMARY KEY, state text NOT NULL,
  since timestamptz NOT NULL, trace jsonb NOT NULL);
```

Analytic data (object storage, Parquet): `events/<source>/dt=YYYY-MM-DD/hh=HH/<producer>-<seq>.parquet`. Each file's footer carries min and max `ts`, a producer id and a sequence range, which the planner uses for pruning and the ingest worker uses for idempotent replay.

### D.3 The spec language

A spec document is canonical JSON (RFC 8785 canonicalisation), validated against its kind's schema. Kinds: `dashboard`, `panel`, `query`, `metric`, `control`, `parameter`, `link`, `alert`, `workflow`, `template`, `annotation`, `comment`, `layout`.

Example dashboard document (abridged to the parts the demo uses):

```json
{
  "schema": "fathom.dashboard/v1",
  "id": "dash_ops_board",
  "title": "Order operations",
  "params": {
    "window": { "type": "duration", "default": "1h",
                "allowed": ["15m", "1h", "6h", "24h"] },
    "dock":   { "type": "string", "default": null, "nullable": true }
  },
  "layout": { "grid": 12, "rows": [
    { "cols": [ { "span": 3, "panel": "p_kpi_p95" },
                { "span": 3, "panel": "p_kpi_rate" },
                { "span": 6, "control": "c_window" } ] },
    { "cols": [ { "span": 12, "panel": "p_latency_by_wh" } ] }
  ]},
  "panels": {
    "p_latency_by_wh": {
      "kind": "panel",
      "query": {
        "from": "events.order_stage",
        "where": [
          { "op": "eq",  "col": "stage", "val": "delivered" },
          { "op": "gte", "col": "ts",    "val": { "param": "window_start" } }
        ],
        "transform": [
          { "bucket": "ts", "by": "1m", "as": "minute" }
        ],
        "group": ["minute", "warehouse"],
        "aggs": [ { "fn": "quantile", "q": 0.95, "col": "latency_ms",
                    "as": "p95", "unit": "ms" } ],
        "order": [ { "col": "minute", "dir": "asc" } ]
      },
      "viz": { "mark": "line", "x": "minute", "y": "p95", "color": "warehouse" },
      "links": [ { "event": "select", "to": "dash:dock_drilldown",
                   "map": { "warehouse": "warehouse" } } ]
    }
  },
  "controls": {
    "c_window": { "kind": "control", "widget": "segmented", "bind": "window" }
  }
}
```

Three design decisions in this language matter for composability:

1. **The query is data.** `where`, `transform`, `group` and `aggs` are IR nodes. A panel, an alert (`"predicate": {"query": ..., "over": "p95", "gt": 1500}`), a metric and an export all reference the same IR. Lineage is computed by walking these references.
2. **Parameters are typed.** `{ "param": "window_start" }` is type-checked against `window` (a duration converted to a timestamp by an IR expression). Passing a string where a duration is expected is a type error with a path.
3. **Visualization is a declarative mark**, compiled to Vega-Lite by the renderer. Agents write marks, not JavaScript.

Errors are structured and designed for self-correction:

```json
{
  "code": "unknown_field",
  "path": "/panels/p_latency_by_wh/query/aggs/0/fn",
  "message": "unknown aggregate function 'p95'",
  "got": "p95",
  "valid_alternatives": ["count", "sum", "avg", "min", "max", "quantile", "distinct"],
  "did_you_mean": "quantile",
  "hint": "use {\"fn\":\"quantile\",\"q\":0.95}"
}
```

### D.4 Query and transform engine

Pipeline: **parse → resolve → type-check → authorise → rewrite → plan → execute → tag**.

- **Parse.** JSON IR or the text form (`from events.order_stage | where stage = "delivered" | ...`), which compiles to the same IR. The text form exists for humans and agents writing ad hoc queries; both are accepted by `query.run`.
- **Resolve.** Names resolve against the catalog. Unknown names produce `unknown_field` with near-match suggestions (Levenshtein over the catalog, bounded to distance 2).
- **Type-check.** Every expression has a type (`int`, `float`, `string`, `timestamp`, `duration`, `ratio`, `quantity<unit>`). Unit algebra rejects `ms + orders/min`, and `quantile` over a non-numeric column is refused.
- **Authorise.** The principal's effective grants are checked against each source and column. Denials name the grant that would allow the query.
- **Rewrite.** Row-level predicates bound to the principal's attributes are conjoined into `where` at the IR level, before planning. Masking functions replace masked columns in projections. This happens before any optimiser pass, so no optimiser can push a query past a predicate it should not see.
- **Plan.** Partition pruning on `ts`, predicate pushdown into Parquet row-group statistics, and a bound on rows (`group` cardinality from catalog statistics). The plan is what `query.explain` returns, with an estimated scan-byte figure that is compared against the principal's budget before execution.
- **Execute.** Lowered to DuckDB SQL for batch results. For live panels, `fathom-ivm` maintains the result from ingest deltas.
- **Tag.** The result carries `{watermark, rev_id, binding_hash, row_count, scanned_bytes}`.

**Incremental maintenance.** `count`, `sum`, `avg` and `min`/`max` over a window are maintained with deltas. `quantile` is maintained with **fixed-bucket histograms** (log-linear bucket boundaries, 1,024 buckets over 1 ms to 1 h) rather than t-digest, because histograms support retraction when a late event corrects an earlier one, and t-digest does not. The cost is bounded error (bucket width, about 1.6% relative at the buckets used) that is printed in the panel's tooltip. `attribution.run` is a batch query, not maintained.

**Consistency.** Every live result is a function of `(watermark, binding_hash, rev_id)`. Two windows showing the same dashboard at the same parameter binding receive the same watermark and identical values, which is what the "two windows agree" moment depends on.

### D.5 Real-time transport and collaborative editing

**Transport.** One WebSocket per client, multiplexing subscriptions. A subscription is `{object, binding, from_cursor}`. The server pushes `delta` messages with `(replica, seq, hlc)` and a `watermark` for query results. Clients persist their last cursor per subscription in memory and resend it on reconnect; the server replays from the op log (Redpanda topic for live, Postgres for older). Gaps are impossible by construction: if the replay range has been compacted, the server sends `resync` with a full snapshot and the new cursor. SSE is the fallback where WebSockets are blocked, using the same message types.

**Collaborative editing model.** Spec trees are a move-capable tree CRDT (Kleppmann et al., move operations with cycle detection), with:

- **Sibling order** by fractional indices, so concurrent inserts between the same neighbours do not conflict.
- **Properties** as last-writer-wins registers ordered by HLC with replica id as tie-breaker. Properties that are exclusive (the `query` of a panel, a `layout` slot) are registers, so two concurrent writes produce one winner and a named *concurrent-write* annotation that the UI displays as a chip. The loser's value is kept in the op log and can be restored.
- **Deletes** as tombstones with a grace period longer than the maximum offline interval of any client.

The live branch (`live`) is always CRDT-merged. Agent work is different. An agent that writes directly to `live` would bypass review, so agent writes go to an **agent branch** by default and reach `live` through a merge, which is a three-way merge over the revision DAG with a named conflict set. The two modes are deliberate: humans on the Analyst window edit live and see each other converge; the agent proposes and reviews. When an agent is granted `live` write (which the demo does not do), its ops enter the CRDT directly and carry an `agent` attribution.

**Presence.** Presence is an ephemeral CRDT (last-writer-wins per principal and node, with a 10-second expiry), published on the same socket. Agent presence is shown as a badge with the owner's name in brackets.

### D.6 Authorization model

**Entities.** `Principal` (human, service, agent), `Group`, `Workspace`, `Object` (any spec node or a catalog object), `Source`, `Column`, `Action` (the operation registry id).

**Policies.** Cedar policy files in `policies/`, loaded at startup and hot-reloaded on signature check. Example:

```cedar
// Agents can read and write branches, never the live ref.
permit (principal is Agent, action in [Action::"spec.preview", Action::"spec.commit"],
        resource in Workspace::"ws_demo")
when { resource.ref != "live" && principal.scope.contains("spec:branch") };

// An agent's effective grant is capped by its owner.
forbid (principal is Agent, action == Action::"acl.grant", resource)
unless { principal.owner.can_grant(resource, context.role) };
```

**Agent as scoped principal.** An agent principal has `owner` (a human), `scope` (a set of capability strings) and `ceiling` (the owner's grants at token issue time). Its effective grant is the intersection of `scope` and the owner's *current* grants, evaluated per request. Consequences the demo relies on:

- The agent cannot grant access the owner does not have (`scope_exceeds_owner`).
- If the owner loses a permission, the agent loses it at the next request, not at token expiry.
- Every agent request is audited with `actor = agent:<id>` and `on_behalf_of = human:<id>`.

**Tokens.** Locally, the agent obtains an OAuth 2.1 access token from Keycloak using the authorization-code flow with PKCE for the human, then a token-exchange to an agent-scoped token. On AWS the same flow is Cognito. Tokens are five minutes long for agents (short-lived, refreshed by the MCP client), and agent tokens cannot be used on the HTTP UI routes.

**Row-level security.** Row predicates are stored as IR expressions in `rls/<table>.json` and bound to attributes (for example `region in principal.attrs.regions`). Cedar governs who may *attach* a predicate to a role; the engine applies it. This keeps the authorization engine out of the SQL path, and makes the RLS predicate a value that appears in the lineage and in explain output.

### D.7 Audit, versioning and undo

- **Audit.** Each mutating operation appends an `audit_event` in the same Postgres transaction as its effect. Rows are hash-chained (`hash = SHA-256(prev_hash || canonical(body))`). Every hour, the chain head is written to MinIO with object lock (S3 Object Lock on AWS) so truncation or rewriting is detectable. `fathom audit verify` recomputes the chain and the anchors.
- **Versioning.** Every committed change is a revision. Revisions are immutable and content-addressed. `spec.history`, `spec.diff` and `spec.revert` address any two revisions.
- **Branches and merges.** `branch.create`, `branch.merge` (three-way, conflict set returned atomically, no partial application), `branch.delete` (only when merged).
- **Undo.** `undo` is a principal-scoped inverse: the server computes the inverse of the principal's most recent operations that are still applicable (not overwritten by a later concurrent write to the same register), applies them as a new revision, and audits them as `undo`. Undo never rewrites history, and it cannot undo another principal's change unless that principal is the agent's owner and the change was made on the agent's behalf.

### D.8 The MCP server

#### Design principles

1. **Few verbs, typed kinds.** The tool surface has verbs that apply to any object kind (`spec.*`, `query.*`), and kind-specific schemas are discoverable through `schema.describe`. This keeps the tool count small enough for an agent to hold in context, and it means a kind added to the registry is usable without a new tool.
2. **Two-phase writes.** Every mutating tool has a preview variant, and commits require a `plan_id` produced by a preview with the same operations. A commit with no preview is refused with `preview_required`.
3. **Errors are instructions.** Every error has a machine-readable code, a JSON pointer path, the offending value, valid alternatives, and a hint.
4. **Idempotency everywhere it matters.** Commits, sends and external actions require an idempotency key.
5. **Tool results are data.** Free-text fields are returned in an explicitly marked envelope so that agents do not treat them as instructions.

#### Tool catalogue

Signatures are shown as TypeScript-style input types for compactness; the authoritative definitions are JSON Schema generated from the operation registry.

```ts
// Discovery
catalog.search(input: { q: string; kinds?: Kind[]; limit?: number })
  -> { hits: { id: ObjectRef; kind: Kind; title: string; score: number }[]; untrusted: ["title"] }
schema.describe(input: { kind: Kind })
  -> { jsonSchema: object; invariants: string[]; examples: object[]; commonErrors: ErrorCode[] }
workspace.describe(input: {})
  -> { principal: PrincipalInfo; effectiveGrants: Grant[]; budgets: Budget; refs: Ref[] }

// Reads
spec.get(input: { ref: string; object: ObjectRef; depth?: number })
  -> { node: SpecNode; rev: RevId }
spec.history(input: { ref: string; limit?: number; before?: RevId })
  -> { revisions: { id: RevId; author: PrincipalId; message?: string; at: string }[] }
spec.diff(input: { from: RevId | string; to: RevId | string })
  -> { changes: SemanticChange[]; conflicts?: Conflict[] }
query.explain(input: { query: IR | string; binding?: Record<string, unknown> })
  -> { plan: PlanNode; estimatedScanBytes: number; rowBound: number; budgetOk: boolean }
query.run(input: { query: IR | string; binding?: Record<string, unknown>; limit?: number })
  -> { rows: Record<string, unknown>[]; watermark: string; revId: RevId; bindingHash: string;
       untrusted: string[] }
attribution.run(input: { metric: MetricRef; dims: string[]; baseline: TimeRange; window: TimeRange })
  -> { contributions: { dims: Record<string,string>; share: number; delta: number }[]; method: "shift-share"; watermark: string }
lineage.of(input: { object: ObjectRef; direction: "up" | "down" | "both"; depth?: number })
  -> { nodes: ObjectRef[]; edges: { from: ObjectRef; to: ObjectRef; via: string }[] }
alert.test(input: { rule: AlertRule | ObjectRef; from: string; to: string })
  -> { transitions: { at: string; from: AlertState; to: AlertState; value: number }[] }
audit.search(input: { since?: string; actor?: PrincipalId; action?: string; target?: ObjectRef; limit?: number })
  -> { events: AuditEvent[]; chainHead: string }
access.explain(input: { principal: PrincipalId; object: ObjectRef; action: string })
  -> { allowed: boolean; reasons: PolicyReason[]; rlsPredicates: IR[] }

// Writes (two-phase)
spec.preview(input: { branch: string; base: string; ops: SpecOp[] })
  -> { planId: string; diff: SemanticChange[]; validation: "clean" | ValidationError[];
       permissions: "clean" | PermissionError[]; cost: { estimatedScanBytes: number; rowBound: number }; expiresInSeconds: number }
spec.commit(input: { planId: string; expectedBaseRev: RevId; idempotencyKey: string; message?: string })
  -> { rev: RevId; ref: string; refVersion: number; replayed: boolean }
spec.revert(input: { object: ObjectRef; field?: string; toRev: RevId; idempotencyKey: string })
  -> { rev: RevId }
branch.create(input: { name: string; from: string; idempotencyKey: string })
  -> { ref: string; rev: RevId }
branch.merge(input: { from: string; into: string; idempotencyKey: string; planId?: string })
  -> { status: "merged" | "conflicts"; rev?: RevId; conflicts?: Conflict[] }

// Domain writes
metric.define(input: { id: string; query: IR; unit: Unit; owner: PrincipalId; description: string }) // preview-capable
alert.create(input: { metric: MetricRef; threshold: number; op: ">" | "<" | ...; hold: Duration; hysteresis?: number; notify: ActionRef[] })
annotation.create(input: { on: ObjectRef; at: string; text: string })
link.create(input: { from: ObjectRef; to: ObjectRef; map: Record<string,string> })
control.bind(input: { control: ObjectRef; parameter: string })
dashboard.create(input: { title: string; fromTemplate?: TemplateRef; idempotencyKey: string })
panel.create(input: { dashboard: ObjectRef; query: IR | string; viz: VizMark; position: GridSlot })
acl.grant(input: { object: ObjectRef; to: PrincipalOrGroup; role: string; idempotencyKey: string })
  // refused for agents when the owner lacks the grant: scope_exceeds_owner
workflow.start(input: { definition: string; context: object; idempotencyKey: string })
workflow.signal(input: { workflowId: string; signal: string; payload?: object; idempotencyKey: string })

// Presentation
ui.focus(input: { targets: ObjectRef[]; mode: "highlight" | "navigate" | "bind"; binding?: Record<string,unknown> })
  -> { delivered: number; sessions: string[] }
```

`ui.focus` is in the catalogue because the demo's most important property is that an agent's work appears on the screen. It is a registry operation like any other, with an audit entry and a permission (`presentation:focus`), and it is rate-limited so that an agent cannot take over a wall display.

#### Resources

| URI | Content | Notes |
|---|---|---|
| `fathom://catalog` | catalog tree, paged | Read-only, cached by watermark |
| `fathom://schema/{kind}` | JSON Schema, invariants, examples | Same as `schema.describe` for clients that read resources only |
| `fathom://spec/{ref}/{rev}/{object}` | spec subtree at revision | Immutable for a given `rev` |
| `fathom://metric/{id}` | metric definition with lineage summary | |
| `fathom://audit/{cursor}` | audit page | Read-only |
| `fathom://session/current` | the agent's own grants, budgets, outstanding plans | Lets an agent check its state after a failure |

Prompts: `build-board` and `investigate-spike` are MCP prompts that give a client the recommended call sequence. They are advisory. The agent is not required to use them, and the demo's agent is given them only by name.

#### Discovery

An agent discovers capabilities in three layers: `tools/list` (verbs, short descriptions), `schema.describe` (kind shapes, invariants, examples, common errors) and `catalog.search` (what exists). Tool descriptions state the preconditions in one sentence each (for example `spec.commit: requires a planId from spec.preview with the same ops; expectedBaseRev from that preview`). Validation errors name alternatives from the registry, so an agent that guesses a field name is told the valid names in the same response.

#### Preview, commit and the plan object

A plan is a server-side object with a 300-second expiry. It records the normalised ops, the semantic diff, the validation result, the permission result and the cost. Commit verifies that the plan is unexpired, that `expectedBaseRev` equals the plan's base, and that the ref's version still equals the version at preview. If the ref has moved, commit does not fail: it returns `stale_base` with a three-way merge preview against the new head. Commit applies the ops atomically, writes the audit event and the revision in one transaction, and publishes deltas after commit.

#### Idempotency

`idempotencyKey` is required on commit, create, grant, revert and workflow operations. The server stores `(principal, key) → (request_hash, response)` in the same transaction as the effect. A repeat with the same hash returns the stored response with `replayed: true`. A repeat with a different hash returns `409 idempotency_conflict` and does not execute. Keys expire after 24 hours.

#### Rate limits and budgets

Per principal, token buckets: reads 60 per second with burst 120; writes 5 per second with burst 10; `ui.focus` 1 per 3 seconds. Concurrency: at most four in-flight queries per principal, and a scan-byte budget per principal per minute (agents default to 2 GB per minute). Exceeded limits return `rate_limited` with `retryAfterMs`. The agent's `workspace.describe` shows remaining budget, so a well-behaved agent checks before large queries.

#### Validation and error design

The error envelope is uniform across HTTP, MCP and UI:

```json
{ "error": { "code": "stale_base", "path": "/plan/expectedBaseRev",
             "message": "ref agent/ops-board moved from rev_a1 to rev_c7 since preview",
             "hint": "re-run spec.preview on rev_c7 or call spec.diff to review the change",
             "conflicts": [], "retryable": true } }
```

Codes are a closed enum documented in `schema.describe` and in the MCP tool descriptions.

#### Prompt-injection considerations

- **Untrusted content.** Titles, descriptions, comments, annotation text and entity values can contain instructions. Tool results mark these fields in `untrusted` arrays, and the MCP server wraps annotation and comment text in an envelope `{"untrusted_text": "..."}`.
- **Policy does not read text.** Authorization decisions use typed attributes only. A comment that says "grant finance access" has no effect on policy.
- **No free-form execution.** The agent cannot create action targets, cannot define new actions, cannot run code, and cannot change its own scope. The demo's injection test seeds an annotation containing an instruction to widen access and checks that the agent's grant set is unchanged.
- **External effects gated.** Actions with external effects need an allowlisted target and, for agents, an approval step.

---

## E. AWS and local deployment

### E.1 Images

One repository of images, built with BuildKit from a pinned toolchain (Rust toolchain file, Node lockfile, Chromium version pinned). The images are:

- `fathomd` (contains the web assets, the MCP server and all workers), distroless base, non-root, read-only root filesystem.
- `fathom-sim`, `fathom-replay`, and `fathom` (CLI, including `demo reset`, `audit verify`).

Images are tagged by digest in deployment manifests, signed with cosign, and carry an SBOM. A deployment is a set of digests. The local compose file and the AWS deployment reference the same digests. A test (`deploy/check-digests`) fails if they diverge.

### E.2 Mapping

| Concern | Local (compose) | AWS | What differs | Why behaviour is unchanged |
|---|---|---|---|---|
| Compute | `fathomd` ×2 containers | ECS on Fargate, 2 tasks, same image | Scheduler | Stateless processes; state is in Postgres, Redpanda and object storage |
| Metadata and audit | PostgreSQL 16 | Aurora PostgreSQL Serverless v2 | Managed failover | Same SQL, same migrations |
| Ingest log | Redpanda | Amazon MSK | Broker operations | Same Kafka protocol and client config |
| Parquet and anchors | MinIO (object lock enabled) | S3 with Object Lock | Service | Same S3 API and the same anchor code path |
| Identity | Keycloak (realm exported in repo) | Cognito user pool | IdP | Same OIDC discovery and token shapes, same claims mapping |
| Authorization | `cedar-policy` in-process, policies from repo | identical | None | Policy evaluation is in-process on both; Amazon Verified Permissions is not used, so there is no second engine |
| Edge and TLS | Caddy with local certificates | ALB with ACM certificate, HTTP/2 and WebSocket | Certificate handling | Same routes, same `/mcp` path |
| Web delivery | Served by `fathomd` | CloudFront in front of the same `fathomd` origin for static assets | Caching | Same asset hashes |
| Email | Mailpit | Amazon SES | Sender reputation | Same SMTP interface |
| Snapshots | Headless Chromium container | Same container on ECS | None | Same image |
| Telemetry | OTel collector to Jaeger | OTel collector sidecar to CloudWatch and X-Ray | Backend | Same OTLP export |
| Secrets | `.env` for local development only, not committed | Secrets Manager | Source | Same env-var names |
| Infrastructure as code | Compose file | OpenTofu modules | Tooling | Same service names |

The local deployment is not a diminished simulation: it runs two replicas, the same migrations, the same object-lock anchoring and the same identity flow. The differences are operational (who runs Postgres, how TLS is terminated), and each is listed in `docs/deployment-differences.md` with the test that covers its behaviour.

### E.3 MCP exposure

- **Local.** `http://localhost:8080/mcp` using Streamable HTTP with bearer tokens from Keycloak, and an stdio mode (`fathom mcp --stdio`) for clients that prefer it. Claude Code is registered with the HTTP endpoint and an OAuth configuration.
- **AWS.** `https://fathom.<domain>/mcp` behind the ALB, with the same bearer token shape issued by Cognito. The ALB does not terminate authentication; `fathomd` validates tokens against the issuer's JWKS so behaviour is identical.
- **Both.** Agent tokens are five minutes long, scoped to the agent principal, rejected on UI routes, and every MCP session has a session id logged in audit.

### E.4 Which failures change between environments

Network partitions between `fathomd` and Redpanda behave identically (the outbox holds, the subscription resumes). Object-store latency differs: S3 has a higher first-byte latency than MinIO, so the query engine caches Parquet footers and row-group metadata in process, and the rehearsal measures the cold-path difference. Cognito token validation adds JWKS fetches; these are cached with a 10-minute TTL on both deployments.

---

## F. Five strongest technical claims

Each claim has an executable test or an observable behaviour. Claim 2 is the MCP and agent-path claim, and claim 3 also exercises MCP.

**Claim 1. The spec tree converges under arbitrary concurrent edits, including moves.**
*Test.* `fathom-spec/tests/convergence.rs`: a property test with three replicas, 10,000 randomly generated operations (insert, move, property write, delete) distributed with random delivery order, duplication and delay, asserts that after full exchange all replicas have identical tree hashes and identical materialised spec documents, and that no move has created a cycle. *Observable.* `cargo test -p fathom-spec convergence` (run at the stack gate, not per change).

**Claim 2. An agent cannot exceed its owner's authority, enforced on the MCP path.**
*Test.* `e2e/mcp/agent-scope.test.ts`: an agent principal owned by `analyst` (who lacks `acl:manage` on `finance`) calls `acl.grant` over MCP. The test asserts `error.code == "scope_exceeds_owner"`, that no grant row was written, that the audit event exists with `actor = agent:*` and `on_behalf_of = human:analyst`, and that a second test removes a grant from the owner and asserts that the agent's next `spec.preview` is refused without re-issuing its token. *Observable.* Scripted in the demo at 255 to 270 s.

**Claim 3. A commit is exactly-once under retry and CAS-safe under concurrency, through MCP.**
*Test.* `e2e/mcp/commit-idempotency.test.ts`: two agent sessions preview against the same base and commit concurrently with different `idempotencyKey`s. Exactly one commit succeeds; the other returns `stale_base` with a merge preview. A third call repeats the winner's request and asserts `replayed: true`, the same `rev`, and a single `audit_event` for that revision. A fourth call with the same key and a different body asserts `409 idempotency_conflict`. Process death between commit and response is covered by claim 5. *Observable.* The `replayed` flag and the single audit row, shown in the audit pane when the agent retries.

**Claim 4. Query results equal a reference evaluator, and row-level security is enforced by rewrite rather than by the client.**
*Test.* `fathom-ir/tests/differential.rs`: 5,000 generated IR queries over a fixed dataset of 2 million rows, evaluated by DuckDB lowering and by a naive in-memory reference evaluator, compared row-for-row (floating-point aggregates within the stated histogram error bound). A second property asserts that for principal `finance-viewer`, no row returned by any generated query violates the RLS predicate, including queries that try to project the predicate column away, sort by it, or group by it. *Observable.* The tooltip's error bound on the p95 panel and the finance window showing fewer rows than the Ops wall for the same panel.

**Claim 5. Killing a replica loses no deltas and breaks no audit chain.**
*Test.* `e2e/chaos/kill-resume.spec.ts`: during a live `fathom-sim` run, the test sends `SIGKILL` to the leader replica at a random point, then asserts that (a) each open browser subscription receives every delta exactly once in replica-sequence order after reconnect, verified by a sequence check on the client; (b) the agent's in-flight commit appears exactly once; (c) `fathom audit verify` passes, and the object-lock anchor written before the kill matches the chain. The test is repeated 20 times with different kill points. *Observable.* The status line in the final 30 seconds of the demo.

---

## G. Failure analysis

### G.1 Implementation difficulties

1. **Tree CRDT with moves.** Concurrent moves can create cycles, and a naive implementation silently drops subtrees. The mitigation is the published move algorithm with an undo-redo log and a cycle check on apply; the convergence test (claim 1) is the gate. This is the single hardest component and the largest risk to the schedule-free feasibility argument in section H.
2. **Quantiles under incremental maintenance.** t-digest is accurate but cannot retract. Histograms retract but have bounded error and a fixed range. The design accepts the error and prints it. A panel showing a value outside the histogram range (above 1 h) must clamp and say so.
3. **Clock skew.** HLCs bound skew at the cost of a monotonic counter. Two replicas with skew larger than the configured maximum (500 ms by default) refuse writes with `clock_skew`, which is a detectable failure rather than silent reordering.
4. **Cedar evaluation cost.** Per-request evaluation over large entity sets is not free. Entities are loaded per request from the owner's grants (small), and a decision cache keyed by `(principal, action, resource, grantsVersion)` is invalidated by grant writes.
5. **Parquet cold reads.** S3 first-byte latency is higher than MinIO. The mitigation is footer and row-group caching and a pre-warm on demo start.
6. **Realtime fan-out with ALB.** WebSockets through an ALB need idle-timeout tuning, and reconnection storms after a replica dies need jittered backoff. Cursors make reconnection correct; jitter makes it cheap.
7. **Headless snapshots.** Chromium rendering is slow and occasionally flaky under load. Snapshots are off the critical path of the demo (used only in exports) and are not on screen.
8. **Vega-Lite rendering with many panels.** Rendering cost grows with panel count and data points. The demo caps panels per dashboard at 12 and series points at 1,500 per panel, both enforced by validation and reported in the plan's cost field.

### G.2 Hidden complexity

- **Semantic diff.** Diffing trees by path is easy; diffing by intent (a panel moved between rows is not a delete plus insert) requires stable node identity, which the CRDT provides, and a rule set for presenting changes. This is more work than it looks.
- **Undo under concurrency.** An inverse operation is well defined only if the register it touches has not been overwritten. The undo algorithm refuses rather than guessing, which is correct but surprising to users.
- **Preview fidelity.** The preview must predict the commit exactly, including validation that depends on catalog state. Any catalog change between preview and commit invalidates the plan, which is why `stale_base` covers catalog changes as well as spec changes.
- **Workflow durability.** Workflow steps that call external actions must be idempotent. Every action carries a key derived from `(workflow, step, attempt)`.

### G.3 On-stage failure modes and mitigations

| Failure | Detection | Mitigation |
|---|---|---|
| Agent calls a tool with a hallucinated field (for example `for` instead of `hold`) | Validation error with `did_you_mean` | Demonstrated as a feature at 255 to 270 s; the second call succeeds |
| Agent calls `spec.commit` without a preview | `preview_required` | Recovers by calling preview; the script includes this recovery deliberately only in rehearsal |
| Agent gets a `stale_base` after the live feed changed the catalog | Commit returns `stale_base` with merge preview | Agent re-previews; the flow is in the script |
| Agent answers the "why" question with a guess rather than a query | The presenter's rehearsal checks that the answer cites `attribution.run` output; if not, the presenter switches | Fallback driver |
| Model latency spikes (a turn takes much longer than normal) | The presenter's watch on the terminal | Fallback driver after the trigger in C.3 |
| Agent loops calling `query.run` | Budget counter in `workspace.describe`, rate limit | Rate limit returns `rate_limited`; the agent stops; fallback |
| Agent proposes to grant access it does not have | `scope_exceeds_owner` | Demonstrated as a feature |
| Feed produces an unexpected throttle at a different dock | Attribution will still find the dominant dock | Script refers to the dock by the attribution result, not by a name written in advance; the scenario file fixes the throttle, so this cannot happen unless the seed changed |
| Replica dies during the final 30 seconds | Health check, ALB removes the target | The kill is the demo; resume and idempotency are the proof |
| Browser sleeps or loses network | Cursor resume | Automatic |
| Projector or network failure | Presenter's local display | Pre-recorded screen capture of the same run is kept on disk; it is not played as a substitute for the live run but is available if the display fails |

### G.4 Failure modes that are not handled

- An agent that is wrong *and* persuasive about a cause the data does not contain. Attribution returns what the data says; an agent can still mis-narrate it. The mitigation is that every claim the agent makes is accompanied by the query ids it used, and the presenter's script asks for them.
- Clock skew beyond the configured maximum on AWS (for example a badly synchronised instance) causes refusals. This is detectable and documented but not automatically repaired.

### G.5 Shallow features in this proposal

Honest list. These look more impressive in the document than they are in the system.

- **Anomaly detection (P27)** is a rolling median and MAD band. It is deterministic and correct, and it is not a model.
- **Embedding (P41)** is a signed iframe with a parameter lock. Its security is the token; there is no embedded-SDK surface.
- **Scheduled reports (P44)** produce CSV and PNG and send through the action layer. There is no PDF layout engine.
- **Multi-tenancy (P37)** is a workspace key enforced by policy and a storage prefix. It is isolation for the demo's purposes, not a tested hostile-tenant boundary.
- **Templates (P42)** are dashboards with declared parameters. There is no template marketplace.
- **Column masking (P36)** replaces values with a salted hash. It is not format-preserving and is not a substitute for a data-classification program.
- **Comments (P40)** have no notifications and no mentions.
- **Search (P45)** is trigram search over catalog titles and descriptions, with no ranking model.
- **Undo (P8)** covers only the principal's own recent operations that are still applicable. It is not a general undo across a team.
- **The activity rail** showing agent calls to the audience is a view over the audit log. It is useful but it is not a separate feature.

---

## H. Feasibility

Feasibility is expressed by what each component touches and by dependency order. No duration is given.

### H.1 Scope by component

| Component | What it touches | Relative breadth |
|---|---|---|
| `fathom-spec` (tree CRDT, canonical JSON, diff, merge) | Pure Rust, property tests, WASM build | Large; the highest-risk algorithm |
| `fathom-ir` (IR, type checker, unit algebra, RLS rewrite, DuckDB lowering) | Pure Rust plus DuckDB bindings, differential test harness | Large |
| `fathom-ivm` (aggregates, histograms) | Depends on `fathom-ir` plan nodes and the ingest delta format | Medium |
| `fathom-policy` (Cedar entity model, policy files, decision cache) | `cedar-policy` crate, policy tests | Small to medium |
| `fathomd` operation registry and generated surfaces (HTTP, MCP, CLI, TS client) | One macro/codegen step over registry entries | Medium; the leverage point for the whole design |
| Ingest and `fathom-sim` | Deterministic simulator, Redpanda/MSK producer, Parquet writer, ingest worker | Medium |
| Realtime gateway (WebSocket, cursors, resync) | Depends on op log and registry | Medium |
| MCP server (tools, resources, plans, idempotency, budgets, error envelope) | Depends on registry, plans, policy, audit | Medium; large surface but mostly generated |
| Workflow and alert engine | Depends on IR, IVM and actions | Medium |
| Audit chain and object-lock anchoring | Postgres transaction hook and S3 Object Lock | Small |
| Web UI (grid, controls, presence, diff review, agent activity rail, focus) | React, WASM spec, Vega-Lite | Large in breadth, straightforward in technology |
| Replay and rehearsal tooling | Recording client, Playwright | Small to medium |
| Deployment (compose, OpenTofu modules, cosign, digest check) | Two targets from one image set | Medium |

### H.2 Critical dependencies

1. The tree CRDT (`fathom-spec`) gates every collaborative and branch feature. If its convergence test fails and cannot be fixed, the fallback is a single-writer spec model with pessimistic locks per dashboard. The demo would lose "two humans editing at once without a lock" but keep everything else.
2. The operation registry gates the MCP server, the UI client and the HTTP API. It must exist before any surface is written, or the surfaces diverge.
3. The IR and its type checker gate every panel, alert and attribution run.
4. Redpanda or MSK and the simulator gate live data. Without live data the "why" question cannot be answered.
5. The Cedar policy model gates the agent scope claim, which is the MCP claim the audience is meant to take away.

### H.3 Main risks

- The tree CRDT is novel to this codebase and has the most subtle invariants.
- Agent behaviour under a live model is not measurable until the MCP surface is complete, so rehearsal measurements (latency, tool-call counts, success rate over N runs) arrive only after the vertical slice runs end-to-end.
- Vega-Lite and React rendering budgets on a wall display need measurement on the target display hardware.
- Two-replica failover on AWS depends on ALB and ECS behaviour that is well documented but not locally reproducible in full.

### H.4 Dependency-ordered build sequence

Each step names what it unlocks. Steps on the same line can proceed in parallel.

1. **Canonical JSON, schema registry for two kinds (`panel`, `query`), operation registry skeleton that generates an HTTP route and an MCP tool from one definition.** Unlocks every later step. Minimal vertical slice starts here.
2. **Simulator producing NDJSON to a local file, Postgres ingest worker, one Parquet dataset, one IR query (`count` by `stage`) lowered to DuckDB.** Unlocks live data.
3. **Panel render in the browser from `query.run` with a watermark, one KPI, polling.** First visible result; unlocks the UI shell.
4. **Revision store and `live` ref with a single writer; `spec.preview` and `spec.commit` on the single-writer path with idempotency keys.** Unlocks the agent write path.
5. **MCP server exposing registry operations with the error envelope; one agent session creates one panel end to end.** First agent result; unlocks the scripted agent path.
6. **Tree CRDT in `fathom-spec` with the convergence property test; replace the single-writer path with CRDT ops; WebSocket deltas with cursors.** Unlocks two windows editing and presence. Gated by claim 1.
7. **Branches, semantic diff, three-way merge, preview review UI.** Unlocks the agent-branch flow.
8. **Cedar policies, principals, agent scope and owner ceiling, `acl.grant` refusal.** Unlocks claim 2 and the finance window.
9. **RLS rewrite in the IR, the differential test against the reference evaluator (claim 4).**
10. **Histogram IVM for live panels, attribution, lineage, `query.explain` with budgets.** Unlocks the "why" answer on stage.
11. **Alerts (state machine), workflows, approvals, actions with allowlisted targets.** Unlocks the final 60 seconds.
12. **Audit hash chain, object-lock anchoring, `audit verify`, undo.**
13. **Replica failover tests, chaos test (claim 5), platform self-source.**
14. **Compose deployment, then OpenTofu modules and the AWS deployment from the same digests; digest-equality test.**
15. **Fallback recording and replay, rehearsal automation, the agent-eval harness with recorded success rates.**

Steps 1 to 5 form the minimal vertical slice: one dataset, one panel, one HTTP operation and its MCP tool, rendered live, changed by an agent. Every later step adds a primitive that composes with the ones already present.

### H.5 Verification gating

Per the house rules, each change runs cheap checks only (`cargo check`, formatting, lint on the touched files). The test suites in section F and the chaos test run once on each stacked integration, with the coordinator collecting finished changes into the stack. Claim tests are the stack's acceptance criteria. A failing stack is bisected by commit, and the failing change goes back with its output.

### H.6 What would make this proposal fail

- If the tree CRDT cannot be made to converge under the property test, the collaboration story reduces to pessimistic locking, which is weaker but still real.
- If the query IR cannot be kept small enough to type-check fully, the composability argument weakens, because panels and alerts would diverge into separate query dialects. The IR is therefore frozen early (step 2) and extended only through new registry entries.
- If the MCP tool descriptions are not sufficient for a general agent to build a board without bespoke prompting, the design relies on the `build-board` prompt, which the brief forbids as a crutch. Rehearsal success without the prompt is the measurement that decides this.

---

## Word count and notes

Length: `wc -w` reports about 11,600 whitespace-separated tokens, which counts table pipes, code blocks and identifiers. The prose alone is estimated at roughly 8,000 words. Quantities in this document (scan-byte budgets, rate limits, histogram bucket counts, error bounds, row counts, token and plan lifetimes, and the 91% and 0.82 to 0.31 figures in the script) are design parameters or scenario-file values, not measurements. The rehearsal and the agent-eval harness are what produce measured values, and they are named in sections C.3, F and H.3 as the points where those measurements arrive.
