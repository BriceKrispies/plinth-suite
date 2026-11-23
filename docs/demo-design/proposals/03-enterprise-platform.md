# Parapet: a governed, composable operations platform (Competitor 03, Enterprise Platform)

Mandate: a serious, configurable, secure, multi-tenant enterprise platform. SSO, roles and attribute-based policy, row- and column-level security that the agent is also bound by, governance, audit, approvals, lineage, sharing and embedding.

Product title: **Parapet**

Pitch: Parapet is a governed, composable operations platform in which every dashboard, query, metric, alert, workflow and permission is a typed, versioned, audited document that a person or a scoped agent changes through one command layer. On stage, an agent connected over MCP answers "why did checkout latency spike?" by composing the investigation screen live, and is refused a salary column by the same policy that refuses the humans.

---

## A. Product concept

**What it is.** Parapet is a self-hosted (and AWS-hosted) platform for building dashboards, drill-downs, alerts, forms, workflows and reports over operational data. Its unit of work is a *document*: a dashboard, panel, query, metric, alert, workflow, form, share grant or policy binding. Every document has a stable identity, a revision, a schema version and an entry in one append-only change log. The web UI, the HTTP API and the MCP server are three clients of one command layer. None of them has a capability the others lack.

**Who uses it.**

- *SRE and platform engineers* build and share operational views, alerts and runbook workflows.
- *Finance and business analysts* build governed boards over data they may see, with masked columns and filtered rows.
- *Security and compliance* read the audit trail, explain permissions, approve sensitive grants and review agent activity.
- *Engineering leaders* consume embedded, read-only boards in their own portal, issued as signed, scoped tokens.
- *An AI agent* (an external MCP client such as Claude Code or Claude Desktop) acts as a scoped principal on behalf of a named human. It interrogates the system and composes the UI that answers questions. The platform itself contains no LLM.

**What the demo dashboards are about.** The data is the operation of a small, real, reproducible system called *orderflow*: three Node.js services (`checkout`, `payments`, `inventory`) backed by PostgreSQL, running in containers from the same images locally and on AWS. A seeded load generator drives them with real HTTP requests. Each service emits OpenTelemetry traces and metrics through an OpenTelemetry Collector into Parapet's ingest endpoint. Payments writes to a real ledger table, so lock contention is real Postgres lock contention. Database lock waits are read from `pg_locks` and `pg_stat_activity` by a collector, and the platform's own audit log is a second data source. No paid API, no external service and no synthetic time series is involved in the core.

- Load: the default profile is about 200 requests per second across the three services. This is a configured quantity, not a measurement, and it is labelled as such. The seeded generator makes every run's request sequence identical for a given seed.
- Fault: the reset command injects a scripted fault. A maintenance job takes a long-running lock on `payments.ledger` for a configured window, so checkout p99 rises for real. The fault's start time and affected service are written to a scenario manifest that the rehearsal reads. The presenter's prompts refer to the spike in relative terms, so the demo does not depend on the wall clock.
- Reproducibility: `parapet demo reset --seed 2026` truncates the demo schemas, reloads the seeded fixtures (principals, groups, dashboards, sample queries), restarts the load generator with the seed and reschedules the fault. The post-reset state hash is fixed for that seed (section F).

**Why this matters to the audience.** Engineers distrust demos where the AI "does magic". Parapet's claim is narrower and checkable: the agent is not special. It uses the same commands, the same validation, the same policy engine and the same audit stream as a human. When it fails, it fails with the same error a human would see.

---

## B. Capability inventory

The core is deliberately small. Each primitive is a document kind or a command with one schema, one authorization path, one change-log entry and one real-time event type. The inventory therefore lists primitives (D = demonstrated on stage, S = supporting, present but not shown live) and their composition.

### B.1 Core substrate

| # | Primitive | Status | Technical significance | Composes with |
|---|---|---|---|---|
| 1 | Document model with stable ULID node IDs and per-node `rev` | D | Every panel, parameter, link and layout cell is addressable. Patches and merges operate on IDs, not array positions. | All documents, diff, branch, undo |
| 2 | Typed spec language (`Dashboard`, `Panel`, `Query`, `Metric`, `Alert`, `Workflow`, `Form`, `Grant`) | D | One schema, validated by one library, emitted as JSON Schema for MCP and OpenAPI for HTTP. | Every write path, MCP discovery |
| 3 | Command layer: `plan` then `apply`, with `base_rev` and `plan_hash` | D | The single write path. Plans are inspectable and expire. | Authz, audit, undo, real-time, agent preview |
| 4 | Change log: append-only, hash-chained, attributed (`actor`, `on_behalf_of`, `source`, `plan_id`) | D | Source of audit, undo, real-time fan-out and replay. | Everything |
| 5 | Undo as a recorded inverse command | D | Undo is itself a change, so it is audited and can be undone. | Change log, versioning |
| 6 | Versioning and branching of dashboards (immutable `doc_versions`, named branches) | S | Snapshots, diff between any two versions, three-way merge over node IDs. | Diff, templates, embedding (pinned versions) |
| 7 | Diff and three-way merge | S | Structural diff keyed by node ID; conflicts are listed as structured records. | Branching, collaborative edit, agent rebase |

### B.2 Identity, authorization, governance

| # | Primitive | Status | Significance | Composes with |
|---|---|---|---|---|
| 8 | OIDC SSO with group and claim mapping | D | Humans log in through the IdP. Groups and claims (department, region, clearance) become principal attributes. | Policy, RLS, sharing |
| 9 | Principals: user, group, service, agent (agent always carries `on_behalf_of`) | D | The agent is a first-class principal with a ceiling of min(agent grant, delegator's effective rights). | Policy, audit, rate limits |
| 10 | Attribute-based policy in Cedar | D | Decisions are `permit`/`forbid` over principal attributes, resource attributes and action. Each decision names the policy IDs that produced it. | Column masks, row filters, approvals, `permission.explain` |
| 11 | Row-level security in PostgreSQL, driven by the same policy | D | Rows are filtered in the database by policy-derived predicates set per transaction, so no application path can skip them. | Query engine, embedding, agent queries |
| 12 | Column-level security and masking | D | Columns are dropped or masked (`hash`, `partial_email`, `bucket`) in the compiled projection, never in the client. | Query, export, embedding, agent |
| 13 | Approvals: `forbid` decisions that name an approval route, resolved by a human principal only | D | A denied agent action produces an approval request; resolution is a human-only command. | Permission propose, alert routing, share |
| 14 | Sharing grants with expiry and resource scope | S | `Grant` documents, which are themselves versioned, audited and policy-checked. | Embedding, approvals, schedule reports |
| 15 | Embedding with signed, parameter-locked tokens | S | Token scopes a dashboard, a pinned version, a fixed parameter set and a TTL. | Sharing, RLS (the token's principal is a service principal bound by policy) |
| 16 | Audit query and retention | D | `audit.search` over the same change log, filtered by actor, source, time, resource, decision. | Everything |
| 17 | Rate limits and cost budgets per principal | S | Token buckets for reads and writes, plus a query cost budget. | Agent, embedding, scheduled reports |

### B.3 Data, queries and metrics

| # | Primitive | Status | Significance | Composes with |
|---|---|---|---|---|
| 18 | Data sources: PostgreSQL (own and orderflow), OTLP metrics store, `db.locks` collector, audit log, CSV upload (S) | D | Each source declares its tables, columns, types and sensitivity classes. | Query, lineage, policy |
| 19 | Query IR: source, select, dimensions, predicates, joins on declared relations, transforms, mandatory limit and timeout | D | One intermediate representation compiled to parameterized SQL. Raw SQL is not exposed to the agent surface. | Panels, alerts, metrics, workflows, export, agent |
| 20 | Transform pipeline: `filter`, `derive`, `groupBy`, `bucket`, `fill`, `window` (rolling, lag), `topK`, `pivot`, `join`, `zscore` | D | Transforms are pure functions over result frames, shared by server (for alerts and exports) and client (for interaction). | Query, anomaly, panels |
| 21 | Named metrics (first-class `Metric` documents with owner, unit and expression) | D | Metrics are defined once and referenced by name, so a panel, an alert and an agent answer use the same definition. | Query, alerts, lineage |
| 22 | Parameters (time range, enum, multi-select, free text with validation) | D | Typed inputs that bind into queries as `$name`. | Panels, cross-filter, embedding, forms |
| 23 | Cross-filtering and drill-down links | D | A click on a panel element sets a parameter or opens a target dashboard with parameters carried. Declared in the spec, not hard-coded. | Parameters, panels, workflows |
| 24 | Annotations on time series | S | Persisted, attributed, scoped to a panel or a dashboard. | Changes, incidents, audit |
| 25 | Lineage: upstream and downstream graph derived from query IRs and metric definitions | D | `lineage.trace` answers "which panels and alerts depend on this column" from the IR graph. | Metrics, alerts, audit, policy |
| 26 | Deterministic anomaly explanation (rolling robust z-score, change-point by PELT-style penalty, contributor decomposition by dimension) | D | Pure statistics. The text is templated from computed facts. There is no model. | Query, panels, alerts, agent |
| 27 | Forms that write back (typed fields, validation, writes to a declared table through a closed set of write operations) | S | Writes go through the policy engine and the change log. | Workflows, audit, approvals |
| 28 | Workflows: trigger (alert, schedule, form submit, manual), closed step registry (`notify`, `set_param`, `form_write`, `http_call` with allowlisted host, `approval`) | D | Observable state machine per run (queued, running, waiting, done, failed), each transition an event. | Alerts, forms, approvals, audit |
| 29 | Alerts with threshold, `for` duration and routing | D | Alerts evaluate queries on a schedule; state transitions are events; routing targets are groups or allowlisted endpoints. | Query, workflow, approvals |
| 30 | Scheduled reports (PDF and CSV render of a pinned dashboard version) | S | Render through headless Chromium in the worker, with the schedule's principal's policy applied. | Sharing, embedding, audit |

### B.4 Presentation, real time, collaboration

| # | Primitive | Status | Significance | Composes with |
|---|---|---|---|---|
| 31 | Layout grid with stable item IDs | D | Positions are data, patched like any other node. | Panels, templates |
| 32 | Visualizations: time series, bar, table, stat, heatmap, topology (from lineage) | D | Each panel kind is a renderer over a result frame, with option schemas. | Query, transforms, cross-filter |
| 33 | Templates (dashboard documents with parameters and placeholder queries) | S | Instantiated with a parameter map, yielding a new dashboard with lineage to the template. | Versioning, sharing |
| 34 | Real-time fan-out from the change log, filtered per subscriber by policy | D | A subscriber receives only events for resources it may read, re-checked at delivery. | Authz, presence, screens |
| 35 | Presence and cursors | D | Who is viewing which dashboard and which panel is focused. Ephemeral, held by the gateway. | Collaboration, agent focus |
| 36 | Collaborative editing: field-level optimistic concurrency (`base_rev`), presence, and structured conflict records | D | Two editors (human or agent) cannot silently overwrite each other. Conflicts surface as data, not as last-writer-wins. | Command layer, diff, merge |
| 37 | Screens: named display targets that the agent or a human can push a dashboard or panel to | D | `screen.show` and `screen.focus` push state to connected browsers; screens are principals with their own rights. | Real-time, presence |
| 38 | Comments on panels and dashboards | S | Threads anchored to node IDs, with mentions that create notifications. | Presence, audit |

### B.5 Agent surface

| # | Primitive | Status | Significance | Composes with |
|---|---|---|---|---|
| 39 | MCP server (Streamable HTTP, with stdio for local development) | D | Tools, resources, prompts. Same command layer as HTTP and UI. | Everything |
| 40 | Discovery: policy-filtered capability catalogue and schema describe | D | The agent sees only what its effective principal may use, so discovery itself respects policy. | Schema, policy |
| 41 | Preview and commit on every write tool | D | Writes default to preview. Commit requires the plan ID and an idempotency key. | Command layer, undo |
| 42 | Self-correcting errors (path, did-you-mean, valid values, retryable flag, doc reference) | D | Designed for an agent to repair its own call without a human. | Schema, validation |
| 43 | Tape driver: recorded MCP call sequences replayed as the same principal | D | The fallback. Preconditions are checked against live state before each step. | MCP, rehearsal |
| 44 | Rehearsal runner: headless browsers, multiple sessions, state hash comparison | S | Automated end-to-end validation of the whole script. | Tape, reset, health |
| 45 | Health and readiness checks, one-command reset, one-command startup | S | Operational primitives that the demo depends on. | Reset, rehearsal |

### B.6 Composition map

The map shows how the smaller primitives combine into the larger capabilities the audience sees.

```
Identity (8,9) ──► Policy (10) ──► RLS (11) + Column masks (12) ──► Query engine (19,20)
     │                 │                                                  │
     │                 └──► Approvals (13) ──► Workflow (28) ◄── Alerts (29) ◄── Metrics (21)
     │                                                 │                        │
     └──► Grants (14) ──► Embedding (15)               ▼                        ▼
                                                  Forms (27)           Lineage (25) ──► Topology viz (32)
                                                                                 │
Command layer (3) ──► Change log (4) ──► Undo (5) ──► Versioning/Branching (6,7) │
     ▲     │               │                                                     │
     │     │               └──► Audit (16)          Anomaly explain (26) ◄────────┘
     │     └──► Real-time fan-out (34) ──► Presence (35) ──► Screens (37)
     │
MCP (39) ──► Discovery (40) ──► Preview/commit (41) ──► Command layer (3)
              │                                    └──► Self-correcting errors (42)
              └──► Tape driver (43) ──► Rehearsal (44)
```

The key compositions for the demo:

1. **Query to panel to alert to workflow.** A query saved once (`q_p99_by_service`) feeds a timeseries panel, an alert with `for: 2m`, and a workflow step that notifies a group. Editing the query changes all three through the same reference.
2. **Metric to lineage to topology.** A metric's dependencies are derived from its IR. `lineage.trace` returns the graph, and the topology panel renders it. The agent can compose a topology panel without hand-authoring nodes.
3. **Policy to query to embedding.** The embed token's principal is bound by the same policy. A column masked for finance is masked in the embedded board, in the export and in the agent's answer, because the mask is compiled into the projection.
4. **Command to change log to undo to real-time.** A human edit, an agent patch and an undo all produce the same event type. Screens update for all three, and the audit row shows the source.

---

## C. Five-minute live script

### Setup

- **Projected screen:** the Parapet window in full screen, showing the `Ops overview` wall. A second browser window, on the same projected display but placed at the right third, is signed in as `sre-oncall` (a human principal, group `sre`). A third window is signed in as `finance-analyst` (group `finance`) and shown only at the 200–240 s mark.
- **Presenter laptop:** Claude Code with the Parapet MCP server registered (`claude mcp add --transport http parapet https://parapet.demo.local/mcp`, or the AWS equivalent). The terminal is not projected. The audience sees the agent's effect on screen, and the terminal text is shown in a corner overlay on the projection only if the presenter enables it.
- **Initial state:** `parapet demo reset --seed 2026`. The fault has been injected about six minutes before the start (the scenario manifest sets the offset), so the spike is already in the data.
- **Principals:** `brice` (admin, delegator), `agent:claude-code` (ceiling: `brice` rights, minus approval-gated actions), `sre-oncall` (group `sre`), `finance-analyst` (group `finance`, row filter `region = 'EU'`, column mask on `customer.email`).

### Timeline

| Time | Presenter action | Expected behaviour (MCP calls the agent makes) | Visible result | Capabilities demonstrated | Transition |
|---|---|---|---|---|---|
| 0–20 s | Presenter states the purpose over the wall: "This is an operations platform. Everything on this screen is a document, and an agent can edit any of them." No keyboard. | None. The wall shows `orderflow` live: 200 req/s, p99 by service, the fault's effect on checkout. | Live numbers update roughly every second, pushed over the change-log gateway. | Real-time fan-out (34), stat and timeseries panels (32), real data from real services (18) | Presenter clicks into the SRE window to show the second principal. |
| 20–45 s | Types in Claude Code: `Using parapet, who can see the finance board and why? Show me the rule.` | `parapet.discover({topic:"panels"})`, `permission.explain({principal:"group:finance", resource:"dashboard:finance-board", action:"read"})`, `audit.search({resource:"dashboard:finance-board", since:"-24h", limit:20})`. | The finance board is highlighted on screen. The policy ID that permits `group:finance` and the forbid on `customer.email` appear as a small explanation card. The terminal reply quotes the policy IDs. | Policy (10), discovery (40), audit (16), explanation with policy IDs | Presenter says "the agent asks the same question a human would ask." |
| 45–95 s | Types: `Checkout p99 spiked in the last fifteen minutes. Build me a page that shows it by service, with the lock waits behind it.` | `schema.describe({ref:"source:metrics"})`, `query.preview({query:{source:"metrics", select:[{metric:"latency_p99"}], dimensions:[service, bucket(ts,"1m")], where:[{field:ts, op:"last", value:"-2h"}]}})`, `anomaly.explain({series:"latency_p99{service=checkout}", window:"-2h"})`, `lineage.trace({ref:"metric:latency_p99", direction:"upstream", depth:3})`, `dashboard.plan({spec:{kind:"Dashboard", ...}})`, `dashboard.apply({plan_id, idempotency_key})`, `screen.show({target:"dashboard:checkout-spike", screens:"all"})`. | A new dashboard "Checkout p99 investigation" appears on all three windows within about a second of apply. Panels: p99 by service (timeseries with the spike), anomaly change-point marker, a topology panel from lineage (checkout to payments to `db.ledger`). | Composition of query (19), metric (21), anomaly (26), lineage (25), topology (32), plan/apply (3), screens (37) | The agent's terminal reply says which change-point it found and which service contributes most. The presenter does not explain the numbers. |
| 95–135 s | Types: `Which payments queries are waiting on locks right now, and what changed on the ledger in the last hour?` | `source.describe({source:"db.locks"})`, `query.run({query:{source:"db.locks", select:[{expr:"count(*)", as:"waiters"}], dimensions:[relation, query_text_hash], where:[{field:"granted", op:"eq", value:false}]}})`, `changes.recent({since:"-1h", scope:"source:db.locks"})`. | A table panel on the investigation dashboard: `payments.ledger`, 14 waiters, all blocked by one backend PID. Change log row: a maintenance job `ops-maint` took `ACCESS EXCLUSIVE` on `payments.ledger` at the start of the fault. | Real Postgres lock data (18), change log (4), attribution by `source` | Presenter opens the change row and clicks the actor, which opens the audit page for `ops-maint`. |
| 135–170 s | Presenter switches to the SRE window (already viewing the page). Types in Claude Code: `Add a drill-down from the p99 panel to the lock table, and let the sre group view this page.` | `dashboard.plan({base_rev, ops:[{op:"add_link", target:"panel:p99", to:"panel:locks", param:"service"}, {op:"set_param_binding", ...}]})`, `dashboard.apply(...)`, `share.grant({resource:"dashboard:checkout-spike", principal:"group:sre", role:"viewer"})`. | The SRE window receives the new link and the grant. A presence badge "agent:claude-code editing" appears on the SRE window for about 2 s, then the drill-down link appears. Clicking a p99 point in the SRE window opens the locks panel filtered to checkout. | Patch (3), drill-down (23), grants (14), presence (35), cross-filter | Presenter clicks the drill-down in the SRE window, so the audience sees a human use the agent's output. |
| 170–200 s | The SRE, in their window, retitles the locks panel to "Ledger lock waiters (on-call)". At the same moment, the presenter types: `Retitle the lock panel to "Payments lock contention".` | The agent's `dashboard.apply` carries a stale `base_rev`. Result: `CONFLICT_REV` with `{panel:"panel:locks", field:"title", current_rev, current_value:"Ledger lock waiters (on-call)", retryable:true, hint:"rebase onto current rev and re-plan"}`. The agent re-reads `parapet://dashboard/checkout-spike`, re-plans, and applies with the current rev, asking for no confirmation. | The terminal shows the conflict and the retry. The panel title shows both intents: the agent keeps the human's title and adds its own suffix, as the plan's diff shows. The change log has two attributed entries. | Optimistic concurrency (36), structured conflicts (7), self-correction (42) | "Two editors, one document, no silent overwrite." |
| 200–235 s | Presenter switches to the `finance-analyst` window. Types: `Make the finance board show revenue by region, hide customer emails, and show me what finance will see.` | `dashboard.plan({spec:{...}, ops:[{op:"set_column_mask", ...}]})`, `dashboard.apply(...)`, `query.preview({as:"group:finance", query:{source:"orders", ...}, limit:5})`. | The finance board updates. The email column reads `a***@…`. The preview reports `rows: 412 of 9,812 visible to finance`, which shows the row filter at work. The agent's reply states the masked columns and the row filter, both read from the compiled plan. | Column masking (12), row filter (11), `query.preview` as a principal (40), the same query engine for humans | "Same engine, same rules. Finance does not get a separate code path." |
| 235–255 s | Types: `Alert the sre group if checkout p99 stays above 800 ms for two minutes, and also post it to the external partner webhook.` | `alert.create({rule:{on:"query:q_p99_by_service", condition:"> 800", for:"2m", notify:[{group:"sre"}]}})` (committed), then `alert.create({... notify:[{http:"https://partner.example/hook"}]})` returns `POLICY_DENIED` with `{reason:"external_notification_requires_approval", policy_id:"policy:external-notify", approval_route:"approval:security", retryable:false}`. | The first alert appears in the alert list with state `ok`. The second produces an approval card on the `sre-oncall` window. The presenter clicks Approve as the human principal `brice`. The alert state transitions and the approval appears in the audit log. | Alerts (29), approvals (13), workflows (28), policy with an approval route | "The agent asked for something it may not do on its own, and the platform asked a human." |
| 255–285 s | Types: `Pull the salary bands for the Payments team into a panel on this page.` | `source.describe({source:"hr.compensation"})` returns the columns with sensitivity classes. `query.preview({query:{source:"hr.compensation", ...}})` returns `POLICY_DENIED` with `{column:"salary_band", reason:"column_forbidden_for_principal", policy_id:"policy:hr-comp-restricted", principal:"agent:claude-code", on_behalf_of:"user:brice", note:"agent effective rights are capped by delegator rights; brice has no hr.comp read grant"}`. The agent replies that it cannot do this and states the policy ID. | Nothing is drawn. The audit log row for the denied query appears on the `Security` board with `source: mcp`, the same denial a human would receive. | Least-privilege ceiling for agents (9), policy explanation (10), audit of denials (16) | This is the strongest governance moment, so the presenter pauses one beat before the next prompt. |
| 285–300 s | Types: `Undo every change you made to the finance board and this page's alert, then show me the audit trail for this session.` | `audit.search({actor:"agent:claude-code", session:"current", since:"-30m"})`, then `change.undo({change_id})` once per agent change in reverse order, each returning a new change ID. `audit.search` returns the agent's changes, the undo changes and the denied query, with `source:"mcp"` and `on_behalf_of:"user:brice"` on each row. | The finance board reverts on the finance window in real time. The alert returns to its pre-session state. The audit table shows the sequence, with undo rows linked to the changes they reverse. | Undo as inverse command (5), audit (16), real-time revert (34) | Closing line: "Everything the agent did is attributed, reviewable and reversible, and it was stopped by the same rules as everyone else." |

### Why the first 30 s and last 30 s carry the demo

The first 30 s establish that the wall is live, that the data is real Postgres lock contention, and that the platform is not a mock: the audience sees the numbers move before any agent is involved. The final 30 s put the strongest claim in one sequence: the agent is refused by the same policy, the refusal is in the audit trail, and an undo returns the screens to their prior state live.

### Fallback: how the tape driver takes over

The live agent is the default. The fallback is the same MCP path, invoked by a recorded tape instead of a model.

- **Tape format.** Each step of the script is a record: `{step, prompt_id, calls:[{tool, args_template, expect}], preconditions}`. `args_template` contains references such as `{{dashboard.checkout-spike.rev}}` and `{{plan.id}}` that are bound from live responses, not from recorded IDs. `preconditions` are checks that the live state matches the recording (for example, that the p99 change-point exists within 5 % of the recorded timestamp and that `dashboard:finance-board` has the recorded rev or a rebased rev that the tape can reach).
- **Trigger.** A watchdog in the presenter companion fires the tape when any of these occurs: no tool call within 12 s of a prompt being sent; two consecutive validation errors on the same step; a tool call outside the step's allowed set; the presenter presses the fallback key (`F9`).
- **Execution.** The tape driver runs as the principal `agent:claude-code`, not as a privileged replay account. It calls the same MCP endpoint over the same transport. Audit rows carry `source: "tape"` and the tape ID, so the difference is visible to anyone who looks, and it is not hidden. The screen receives the same change events.
- **Invisibility.** On the projected display the change sequence is identical. The terminal is not projected, so a switch costs the audience nothing. If the presenter's terminal is shared, the companion types the recorded agent prompt reply into the terminal using the tape's stored text. The tape never fabricates an output the platform did not produce, because each `expect` is checked against the real response before the next step.
- **Refusal.** If a precondition fails (live state diverged from the recording), the tape stops and the companion shows `reset required: run parapet demo reset`. A wrong screen is worse than a pause.

---

## D. Technical architecture

### D.1 Components

| Component | Responsibility | Implementation |
|---|---|---|
| `web` | React single-page app: wall, dashboard editor, panel renderer, policy and audit views | React 19, TypeScript, Vite, TanStack Query for server state, Zustand for local UI state, react-grid-layout for the grid, Apache ECharts for charts, uPlot for dense time series |
| `api` | HTTP API (OpenAPI generated from the spec schemas), command layer, query endpoints | Node.js 22, TypeScript, Fastify, Kysely for SQL |
| `mcp` | MCP server, same process as `api` by default, separately deployable | `@modelcontextprotocol/sdk` (Streamable HTTP and stdio), same handlers as `api` |
| `gateway` | WebSocket fan-out from the change log, per-subscriber policy re-check, presence | Node.js, `ws`, polling the change log by sequence number with LISTEN wake-ups locally |
| `worker` | Alert evaluation, scheduled reports, workflow runs, outbox relay | Node.js, a Postgres-backed job queue (graphile-worker-style `SKIP LOCKED` queue), headless Chromium for PDF |
| `policy` | Cedar evaluation library, policy bundle loading and versioning | `@cedar-policy/cedar-wasm`, in-process in `api`, `mcp`, `gateway` and `worker` |
| `ingest` | OTLP receiver for metrics and traces, writes to the metrics store | OpenTelemetry Collector (external container) forwards to `api`'s `/otlp` route |
| `orderflow` | Demo estate: `checkout`, `payments`, `inventory`, load generator, fault injector | Node.js services, PostgreSQL, seeded generator |
| `companion` | Presenter-only control surface: fallback watchdog, tape driver, reset button | Small Node process with a local UI, not deployed to the audience's screens |
| `db` | System of record and the demo's data sources | PostgreSQL 16 (Aurora PostgreSQL on AWS, container locally) |
| `objects` | Report renders, exports, uploaded CSVs, snapshots | S3 (MinIO locally) |

### D.2 Why these choices

- **TypeScript on Node.js for the core.** One language across the spec validator, the UI, the MCP server and the HTTP API lets one Zod schema drive the browser's form validation, the server's validation, the MCP `inputSchema` and the OpenAPI document. Duplicated validators are the most common source of disagreement between surfaces, and this removes that source. The MCP TypeScript SDK is the most mature reference implementation, which matters for an interface that other agents will read.
- **PostgreSQL as the single datastore.** Row-level security, transactional outbox, `SKIP LOCKED` queues and LISTEN/NOTIFY are all needed, and all are in one engine. Two stores would require a distributed transaction for every command, which would break the claim that a commit is atomic.
- **Cedar for policy.** Cedar is an open policy language with a formal semantics, a small evaluation core and an analyzer. Its WASM build runs in-process, so there is no paid policy service and no network call on the evaluation path. AWS's own managed policy service uses the same language, so the policy bundle is portable.
- **Postgres RLS driven by the same policy.** Cedar decides; the database enforces. The application derives a set of row predicates from the Cedar decision for the table, sets them as transaction-local session variables, and the RLS policies read them. Application bugs cannot widen results, because the database is the last check.
- **Structured spec, no generated code.** Dashboards are data. This makes them diffable, mergeable, auditable, validatable and safe for an agent to produce.

### D.3 Persistence model (key schemas)

All tables live in the `parapet` schema, with `tenant_id` on every row. RLS is enabled on every tenant-scoped table.

```sql
-- One row per document, the current head.
CREATE TABLE document (
  tenant_id     uuid NOT NULL,
  id            text NOT NULL,            -- e.g. dsh_01J8..., qry_..., alr_...
  kind          text NOT NULL CHECK (kind IN ('Dashboard','Panel','Query','Metric','Alert','Workflow','Form','Grant','Template')),
  rev           bigint NOT NULL,          -- increments on every commit to this document
  spec          jsonb NOT NULL,           -- validated against spec v1 for `kind`
  spec_hash     bytea NOT NULL,           -- BLAKE3 over canonical JSON
  owner         text NOT NULL,            -- principal ID
  branch        text NOT NULL DEFAULT 'main',
  updated_at    timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- Immutable snapshots, one per commit.
CREATE TABLE document_version (
  tenant_id uuid NOT NULL, doc_id text NOT NULL, rev bigint NOT NULL,
  spec jsonb NOT NULL, spec_hash bytea NOT NULL, change_seq bigint NOT NULL,
  PRIMARY KEY (tenant_id, doc_id, rev)
);

-- Append-only, hash-chained change log. The only write path to history.
CREATE TABLE change_log (
  tenant_id     uuid NOT NULL,
  seq           bigint GENERATED ALWAYS AS IDENTITY,
  change_id     uuid NOT NULL UNIQUE,
  doc_id        text NOT NULL,
  base_rev      bigint, new_rev bigint NOT NULL,
  command       text NOT NULL,            -- 'dashboard.patch', 'alert.create', 'undo', ...
  ops           jsonb NOT NULL,           -- canonical operations, stable IDs
  inverse_ops   jsonb NOT NULL,           -- precomputed for undo
  actor         text NOT NULL,            -- 'user:brice', 'agent:claude-code', 'service:ops-maint'
  on_behalf_of  text,                     -- set when actor is an agent
  source        text NOT NULL CHECK (source IN ('ui','http','mcp','tape','worker','ingest')),
  plan_id       uuid,
  decision_ids  text[] NOT NULL,          -- policy decision records
  prev_hash     bytea NOT NULL,
  entry_hash    bytea NOT NULL,           -- hash of (prev_hash || canonical entry)
  created_at    timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, seq)
);

-- Plans are inspectable and expire.
CREATE TABLE plan (
  tenant_id uuid NOT NULL, id uuid PRIMARY KEY,
  doc_id text NOT NULL, base_rev bigint NOT NULL,
  command text NOT NULL, ops jsonb NOT NULL,
  diff jsonb NOT NULL, validation jsonb NOT NULL, decisions jsonb NOT NULL,
  after_hash bytea NOT NULL, plan_hash bytea NOT NULL,
  principal text NOT NULL, expires_at timestamptz NOT NULL,
  applied_change_id uuid
);

-- Idempotency for commits.
CREATE TABLE idempotency (
  tenant_id uuid NOT NULL, key text NOT NULL, principal text NOT NULL,
  change_id uuid NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, principal, key)
);

-- Policy-filtered metric and log storage used by the demo sources.
CREATE TABLE metric_point (
  tenant_id uuid NOT NULL, metric text NOT NULL, ts timestamptz NOT NULL,
  labels jsonb NOT NULL, value double precision NOT NULL
) PARTITION BY RANGE (ts);
CREATE INDEX ON metric_point (tenant_id, metric, ts);

-- Relations exposed as sources are declared, not discovered implicitly.
CREATE TABLE source_column (
  source_id text NOT NULL, relation text NOT NULL, column_name text NOT NULL,
  pg_type text NOT NULL, sensitivity text NOT NULL, -- 'public','internal','pii','restricted'
  PRIMARY KEY (source_id, relation, column_name)
);
```

Policy bindings are stored as Cedar policy text in a `policy_bundle` table, versioned like documents. A row-level predicate is generated per tenant-scoped table from the policy bundle and installed as a `SECURITY DEFINER`-free RLS policy that reads `current_setting('parapet.principal')`, `current_setting('parapet.groups')` and `current_setting('parapet.row_scope')`. These are set with `SET LOCAL` inside each request's transaction.

### D.4 Query and transform engine

The query spec is the single representation of a data read:

```yaml
kind: Query
id: q_p99_by_service
source: metrics
select:
  - metric: latency_p99          # resolves a Metric document, or a raw metric name
    as: p99_ms
dimensions:
  - service
  - bucket: { field: ts, width: 1m }
where:
  - { field: service, op: in, value: $service }
  - { field: ts, op: between, value: $window }
transforms:
  - { op: fill, value: null }
  - { op: zscore, field: p99_ms, window: 60, as: z }
limit: 5000
timeout_ms: 3000
```

Compilation steps, each with its own test:

1. **Parse and validate** against spec v1. Unknown keys, wrong types and unknown fields produce structured errors (section D.7).
2. **Resolve references:** `metric:` and `$param` references are substituted. Cycles are rejected.
3. **Authorize:** the Cedar decision for `(principal, source, action=read)` yields a row predicate and a column decision list. Columns with `forbid` are removed from `select` and `dimensions`; masked columns are replaced by their mask expression.
4. **Lower to SQL:** the IR becomes a parameterized statement. Predicates on the RLS-controlled table are also bound, so the policy appears twice in the plan (once as predicate, once as database RLS). The second is the guarantee.
5. **Execute** with `statement_timeout` and a row limit enforced in SQL. The result frame is columnar JSON.
6. **Transforms** that cannot be pushed down (`zscore`, `pivot`, `join` across sources) run in the engine over the frame, using the same pure functions the browser uses for cross-filter interactions.

Joins are allowed only along relations declared in the source catalogue. Raw SQL is not an input to any surface the agent can reach.

### D.5 Real-time transport and collaborative model

- **Change feed.** Every commit inserts a `change_log` row. The gateway reads rows with `seq > cursor`, using `LISTEN` as a wake-up signal locally and a 100 ms poll as the baseline on both environments. The baseline makes behaviour identical; LISTEN only reduces latency. Measured target on the demo profile: change-to-screen under 300 ms at p95, labelled as a design target to verify in the rehearsal.
- **Per-subscriber filtering.** For each event the gateway re-evaluates the subscriber's read decision on `doc_id`. Events for documents the subscriber cannot read are dropped server-side. Event payloads carry the change's `ops`, not the full document, and the client re-fetches the document only if its local `rev` is behind.
- **Presence.** The gateway keeps `(principal, screen, doc, focused_node)` in memory and fans it out. Presence is never written to the change log.
- **Collaboration model.** Every write carries `base_rev` at the document level and optionally at node level. A command whose base has moved returns `CONFLICT_REV` with the current node value. The model is optimistic and explicit. It is not a CRDT. Two concurrent edits to different nodes of one document merge without conflict, because the command is rebased onto the head at plan time when the node-level revs do not overlap.
- **Screens.** A screen is a principal of kind `screen` bound to a browser session. `screen.show` writes a `screen_state` change, which the gateway delivers only to screens the actor may address.

### D.6 Authorization model

- **Principals.** `user:<id>` (from OIDC subject), `group:<name>` (membership from IdP claims, cached and re-read on each token refresh), `service:<name>`, `screen:<id>`, `agent:<name>` with `on_behalf_of:user:<id>`.
- **Agent ceiling.** The effective rights of an agent for a request are the intersection of (a) the agent's registration grant, (b) the delegating user's effective rights, and (c) the action's policy. The agent cannot widen (b) and cannot read its own grants except through `who.am_i`. Agent-issued `Grant` documents are capped at the delegator's rights and require approval if they name a group the delegator is not in.
- **Actions.** `read`, `write`, `share`, `admin`, `export`, `execute`, `approve`. The agent registration excludes `admin` and `approve` by policy; there is no tool that could call them.
- **Attributes.** Principal: `department`, `region`, `clearance`, `groups`. Resource: `classification`, `owner`, `tenant`, `sensitivity` per column. Context: `source` (`ui`, `http`, `mcp`, `tape`), `time` and `session`.
- **Policy examples** (Cedar, abbreviated):

```cedar
// Finance can read finance boards.
permit (principal in Group::"finance", action == Action::"read", resource in Dashboard::"finance")
  when { principal.region == resource.region_scope || resource.region_scope == "all" };

// Emails are never shown raw to non-owners of the customer record.
forbid (principal, action == Action::"read", resource is Column)
  when { resource.sensitivity == "pii" && !(principal in Group::"support") }
  advice { "column:customer.email masked to partial_email" };

// Agents may not exceed their delegator and may not touch restricted HR data.
forbid (principal is Agent, action, resource in Source::"hr")
  when { resource.sensitivity == "restricted" };

// External notification always needs approval.
forbid (principal, action == Action::"notify_external", resource)
  unless { context.approved_by in Group::"security" }
  advice { "approval:security" };
```

- **Row-level security.** Cedar produces a scope (`row_scope` value, or a predicate over `region`, `tenant`, `owner`). The compiled predicate is installed as an RLS policy so that the database enforces it.
- **Explanation.** `permission.explain` returns the decision, every policy ID considered, and the attributes that determined each. It is computed from the same evaluation, not from a separate description, so the explanation cannot drift from the decision.

### D.7 Audit, versioning, undo

- **Audit.** The change log is the audit log. It is append-only, hash-chained (`entry_hash` covers `prev_hash`), and written in the same transaction as the document change. Denied decisions are also logged, as rows with `new_rev = NULL` and a `denied` command, so the audit shows attempts as well as effects.
- **Versioning.** Each commit creates a `document_version` row. Branches are named pointers over versions. Diffs are structural over node IDs.
- **Undo.** Each change stores `inverse_ops`, computed at plan time against the pre-state. `change.undo` produces a new plan whose ops are the stored inverse, subject to the same policy and concurrency checks. If the inverse no longer applies (a later change touched the same node), the undo returns `CONFLICT_REV` with the later change ID. Undo is never silent.
- **Verification.** A `parapet audit verify` command recomputes the hash chain and the `spec_hash` of every head. The rehearsal runs it after each run.

### D.8 MCP server design

#### Transport and identity

- Streamable HTTP at `/mcp` for remote agents; stdio for local development via `parapet mcp --stdio --token-file`.
- Authentication is OAuth 2.1 with the MCP authorization profile: the server is an OAuth resource server, publishes protected resource metadata (RFC 9728), and accepts tokens issued to a registered agent client. The agent's registration fixes its ceiling. The token's `act` claim carries `on_behalf_of`.
- Every request is bound to a principal before any tool runs. There is no anonymous tier.

#### Discovery

- `parapet.discover` lists capabilities (tool names, document kinds, sources, metrics) filtered by the effective principal. Fields the principal cannot use do not appear, so the agent cannot ask for something that will be refused and then be refused.
- Resources (below) carry the schema and the examples. Tools carry short, server-owned descriptions. The descriptions do not vary by data, so a data value cannot change how the agent is told to use a tool.

#### Resources

| URI | Content |
|---|---|
| `parapet://catalogue` | The policy-filtered capability list (same as discover, as a resource). |
| `parapet://spec/v1/schema` | JSON Schema for every document kind, with `$defs`, examples and invariants written as descriptions. |
| `parapet://source/{id}` | Columns, types, sensitivity, the masks and row scope that apply to this principal. |
| `parapet://metric/{id}` | Metric expression, unit, owner, upstream lineage. |
| `parapet://dashboard/{id}` | Current spec, `rev`, `spec_hash`, and the node IDs an agent can address. |
| `parapet://change/{id}` | One change: ops, inverse, actor, decisions. |
| `parapet://me/effective` | The principal's effective ceilings, rate budget and approval routes. |
| `parapet://screen/{id}/state` | What the screen currently shows, as the gateway knows it. |

#### Tool catalogue

All signatures are given as JSON-schema-shaped TypeScript. Every write tool takes `mode: "preview" | "commit"`, with `preview` as the default. Each write tool is documented with its invariants in its own description.

```ts
// ---- Discovery and self-description (read) ----
parapet.discover(input: { topic?: "panels" | "sources" | "metrics" | "documents" | "actions";
                          detail?: "summary" | "full" }): {
  principal: string; on_behalf_of?: string; capabilities: Capability[]; schema_version: "v1";
};
who.am_i(): { principal: string; on_behalf_of?: string; ceilings: Ceiling[]; rate: RateBudget };
schema.describe(input: { ref: string }): { json_schema: object; examples: object[]; invariants: string[] };
source.describe(input: { source: string; relations?: string[] }): {
  relations: { name: string; columns: { name: string; type: string; sensitivity: string; visible: "full" | "masked" | "hidden"; mask?: string }[] }[];
  row_scope: string;
};

// ---- Reading ----
query.preview(input: { query: QuerySpec | { ref: string }; as?: string; limit?: number /* <=200 */; explain?: boolean }): {
  columns: ColumnMeta[]; rows: unknown[][]; row_count: number; visible_row_estimate?: number;
  masked_columns: string[]; plan?: string; cost: { rows_scanned: number; ms: number }; data_digest: string;
};
query.run(input: { query: QuerySpec | { ref: string }; as?: string; into?: { result_id: string } }): {
  result_id: string; row_count: number; truncated: boolean;
};
audit.search(input: { actor?: string; on_behalf_of?: string; source?: string; resource?: string;
                      decision?: "permit" | "forbid" | "approval_required"; session?: "current";
                      since?: string; until?: string; limit?: number }): { entries: ChangeEntry[]; next?: string };
lineage.trace(input: { ref: string; direction: "upstream" | "downstream"; depth?: number /* <=6 */ }): {
  nodes: { id: string; kind: string }[]; edges: { from: string; to: string; via: string }[];
};
permission.explain(input: { principal: string; resource: string; action: string }): {
  decision: "permit" | "forbid" | "approval_required"; policy_ids: string[];
  attributes: Record<string, string>; approval_route?: string;
};
changes.recent(input: { since: string; scope?: string; limit?: number }): { changes: ChangeEntry[] };
anomaly.explain(input: { series: string; window: string }): {
  change_points: { ts: string; magnitude: number }[];
  contributors: { dimension: string; value: string; share: number }[];
  summary: string; // templated from the fields above, no model
};

// ---- Writing (preview by default) ----
dashboard.plan(input: { mode?: "preview" | "commit"; dashboard_id?: string; base_rev?: number;
                        spec?: DashboardSpec; ops?: PatchOp[] }): {
  plan_id: string; plan_hash: string; after_hash: string; expires_at: string;
  diff: NodeDiff[]; validation: ValidationResult; decisions: Decision[];
};
dashboard.apply(input: { plan_id: string; plan_hash: string; idempotency_key: string }): {
  change_id: string; doc_id: string; new_rev: number; replayed: boolean;
};
// PatchOp is one of: add_panel, update_panel, remove_node, add_link, set_param_binding,
// set_column_mask, set_layout, rename, move_to_branch; each with stable node IDs.
query.save(input: { mode?: ...; query: QuerySpec; name: string; base_rev?: number }): PlanOrChange;
metric.define(input: { mode?: ...; metric: MetricSpec; base_rev?: number }): PlanOrChange;
alert.create(input: { mode?: ...; rule: AlertSpec }): PlanOrChange;
workflow.create(input: { mode?: ...; workflow: WorkflowSpec }): PlanOrChange;
form.create(input: { mode?: ...; form: FormSpec }): PlanOrChange;
share.grant(input: { mode?: ...; resource: string; principal: string;
                     role: "viewer" | "editor"; expires?: string }): PlanOrChange;
permission.propose(input: { resource: string; change: PolicyDelta; reason: string }): {
  approval_request_id: string; status: "pending";  // propose-only; no tool resolves approvals
};
embed.token.create(input: { dashboard_id: string; pinned_rev?: number; params?: Record<string, unknown>;
                            ttl_seconds: number /* <=86400 */ }): { token: string; expires_at: string };
schedule.report(input: { mode?: ...; dashboard_id: string; cron: string; format: "pdf" | "csv";
                         to: string[] }): PlanOrChange;

// ---- Undo and history ----
change.undo(input: { mode?: ...; change_id: string; base_rev?: number }): PlanOrChange;

// ---- Presentation (affects screens, not documents) ----
screen.show(input: { target: { dashboard?: string; panel?: string; result_id?: string; params?: object };
                     screens: "all" | string[] }): { delivered: number; skipped: { screen: string; reason: string }[] };
screen.focus(input: { screen: string; node_id: string; highlight?: boolean }): { delivered: boolean };
annotate(input: { panel: string; ts: string; text: string }): PlanOrChange;

type PlanOrChange =
  | { mode: "preview"; plan_id: string; plan_hash: string; expires_at: string; diff: NodeDiff[]; decisions: Decision[] }
  | { mode: "commit"; change_id: string; doc_id: string; new_rev: number; replayed: boolean };
```

Deliberate omissions: no tool creates or resolves approvals, changes policy bundles, creates principals, or accepts raw SQL, scripts, or URLs for fetching. `permission.propose` creates a request only.

#### Preview and commit

- `preview` runs validation, policy evaluation and diff without touching storage, and returns `plan_hash`. The hash covers the canonical after-state, the base revs and the decision IDs.
- `apply` re-checks: the plan is unexpired (TTL 5 min), the document head still equals `base_rev`, and the policy bundle version is the one recorded in the plan. If any check fails, the apply returns a structured error and writes nothing.
- A preview that is never applied leaves no trace except its `plan` row, which expires.

#### Idempotency

- `apply` requires `idempotency_key`. The pair `(principal, key)` is stored with the resulting `change_id` for 24 h. Repeats return the same response with `replayed: true`.
- A `plan_id` can be applied once. A second apply with a different key returns `PLAN_ALREADY_APPLIED` with the `change_id`.

#### Error design for self-correction

Every error has the same shape:

```json
{
  "error": {
    "code": "VALIDATION_UNKNOWN_FIELD",
    "path": "/panels/2/options/unt",
    "message": "Unknown field 'unt' in options of a timeseries panel.",
    "did_you_mean": "unit",
    "valid_values": null,
    "retryable": true,
    "retry_hint": "Replace the field name at this path and call dashboard.plan again.",
    "doc": "parapet://spec/v1/schema#/$defs/TimeseriesOptions"
  }
}
```

Error codes:

| Code | Meaning | Agent behaviour |
|---|---|---|
| `VALIDATION_UNKNOWN_FIELD`, `VALIDATION_TYPE`, `VALIDATION_ENUM`, `VALIDATION_REF` | Spec does not match schema, or a reference does not resolve | Fix at `path` using `did_you_mean` or `valid_values`, re-plan |
| `NOT_FOUND` | Source, metric, node or document does not exist | `nearest` list is returned; choose from it |
| `CONFLICT_REV` | Base revision moved | Re-read the resource, rebase, re-plan |
| `PLAN_EXPIRED`, `PLAN_HASH_MISMATCH`, `PLAN_ALREADY_APPLIED` | Plan no longer applies | Re-plan; do not reuse |
| `POLICY_DENIED` | Policy forbids the action | Do not retry. Report `policy_ids` and `approval_route` to the user |
| `APPROVAL_REQUIRED` | Action is permitted after approval | Call `permission.propose` or present the approval request |
| `RATE_LIMITED` | Budget exhausted | Honour `retry_after_ms` |
| `QUERY_BUDGET_EXCEEDED` | Query estimated cost over budget | Narrow the window or add a dimension filter |
| `TIMEOUT` | Execution exceeded `timeout_ms` | Narrow the query; retry at most once |

`POLICY_DENIED` never reveals restricted values, only the column name, the policy ID and the principal. This is deliberate: the refusal must be explainable without leaking the data it protects.

#### Rate limits and budgets

- Reads: 120 per minute per principal. Writes (`apply`, and `preview` for write tools): 30 per minute. Each query consumes cost units from a per-principal budget, reset per minute. These are configured limits, not measurements.
- Agent principals carry the lower of their own budget and their delegator's.

#### Prompt-injection considerations

- **Data is untrusted.** Every value returned by a query is inside a `data` envelope with `"trust": "untrusted_data"` and the field's source. Markdown and titles from data sources are sanitized server-side. The MCP server never places data into tool descriptions or resource URIs.
- **No instructions from data.** A dashboard title, alert name or cell value that reads "ignore previous instructions" is stored and rendered as a string. The only actions it can cause are the ones the principal could already take.
- **No privilege from content.** The agent cannot change its own grants, its registration, the policy bundle or the allowlist for `http_call`. Those surfaces are not in the catalogue.
- **Egress is closed by default.** `http_call` workflow steps and external notifications require a host on an allowlist that only humans with `admin` can edit, and external notification requires approval (policy above).
- **No raw query surface.** The agent cannot submit SQL. A query spec that references a non-declared relation fails at validation.

### D.9 Frontend specifics

- The wall is a route with a `screen` identity; it subscribes to a shared dashboard and accepts `screen.show`.
- Panels render from result frames. Cross-filter events are local interactions that write parameter values, and parameter values are part of the URL and of embed tokens.
- The editor applies patches through the same `dashboard.plan` and `apply` as the agent. A human's edit is a plan with `source: "ui"`, so there is no separate UI write path.

---

## E. AWS and local deployment

### E.1 Shared principles

- **One set of images.** `parapet-api`, `parapet-gateway`, `parapet-worker`, `parapet-web`, `parapet-orderflow-*` and `parapet-companion` are built once in CI, tagged with the git SHA, and referenced by digest in the deployment manifest. Local and AWS run the same digests.
- **Configuration by environment only.** Images contain no environment-specific values. Endpoints, issuer URLs, bucket names and secrets come from environment and secret references.
- **Migrations are a one-shot task** that runs before the services start, from the `parapet-api` image with a `migrate` entrypoint. The same migration files run locally and on AWS.
- **Cloud integrations sit behind interfaces.** The interfaces are `ObjectStore`, `IdentityProvider`, `Telemetry`, `Mailer` and `Secrets`. Each has an S3, Cognito, ADOT, SES or Secrets Manager implementation and a local implementation.

### E.2 AWS

| Concern | Service |
|---|---|
| Compute | ECS on Fargate, one service per image, desired counts set by the deployment manifest |
| Load balancing and TLS | Application Load Balancer, ACM certificate, path routing for `/`, `/api`, `/mcp`, `/ws` |
| Database | Aurora PostgreSQL 16, with RLS enabled and a reader endpoint used only by read-only query paths |
| Identity | IAM Identity Center or the customer's IdP via OIDC, federated into Amazon Cognito user pool for the token issuer, or a direct OIDC issuer where Cognito is not wanted |
| Object storage | S3 with SSE-KMS, bucket policies that deny unencrypted transport |
| Secrets | Secrets Manager, referenced by ARN from the task definitions |
| Telemetry | ADOT collector sidecar, exporting to CloudWatch and the platform's own OTLP route |
| Email | SES for scheduled reports and alert emails |
| Edge protection | AWS WAF on the ALB; rate limits on `/mcp` enforced by WAF and by the application |
| Scheduling | Worker service with an internal queue, no EventBridge dependency in the core path |

The worker's PDF render uses headless Chromium in the container image, so the scheduled report does not depend on an external rendering service.

### E.3 Local

| Concern | Local stand-in | Documented difference |
|---|---|---|
| Compute | Docker Compose with the same images | No autoscaling; single host |
| TLS and routing | Caddy with a local CA, same path routes | Certificate chain is local |
| Database | `postgres:16` container with the same migrations and RLS | No failover; no read replica (the reader path falls back to the writer, with an identical query) |
| Identity | Keycloak with a demo realm that carries the same groups and attributes as the AWS fixture | Keycloak realm is a test IdP; the OIDC contract is identical |
| Object storage | MinIO (S3 API) | Same SDK calls; no KMS |
| Telemetry | `otel/opentelemetry-collector-contrib` container, same config | Collector config is the same file, with local exporters |
| Email | Mailpit (SMTP) | Captures mail instead of sending |
| Secrets | Compose secrets files | Same reference syntax, different backing |
| Load generator | Same `orderflow` image | Same seed, same profile |

### E.4 Why behaviour is unchanged

Behaviour is defined by the contracts the services observe: the HTTP and MCP surface, the change log, the Cedar bundle, the RLS policies and the query semantics. Those are in the images and the migrations, not in the environment. The rehearsal runs the same script on both deployments and compares the canonical final state hash. Differences that are not behavioural (no KMS locally, Mailpit instead of SES) are listed in the table above and are not exercised by the script.

### E.5 How the MCP server is exposed

- **AWS.** `https://<demo-domain>/mcp` behind the ALB. The ALB does not authenticate MCP traffic itself; the `api` service validates bearer tokens as an OAuth 2.1 resource server against the issuer's JWKS, and publishes protected resource metadata at `/.well-known/oauth-protected-resource`. The agent is registered with a client ID and a ceiling. Claude Code connects with `claude mcp add --transport http parapet https://<demo-domain>/mcp`, then completes the OAuth flow in a browser.
- **Local.** `https://parapet.localhost:8443/mcp` through Caddy, the same paths, the same resource metadata, Keycloak as the issuer. The same `claude mcp add` command with the local URL.
- **Stdio (both).** `parapet mcp --stdio --token-file <path>` for development and as a fallback if HTTP is unreachable on stage. The token is a long-lived agent token issued to the presenter's agent registration, stored with restrictive file permissions.

---

## F. Five strongest technical claims

Each claim has an executable test or an observable behaviour that proves it. Test names are the ones the repository's test suite will use.

### F.1 The agent is bound by the same authorization as the humans, on every surface

**Claim.** For any principal and any query, the rows and columns returned by the UI, by the HTTP API and by `query.run` over MCP are identical, and an agent's result is a subset of its delegator's result.

**Test.** `authz.parity.property`: generate 200 random `(principal, query)` pairs over a fixed fixture (3 groups, 2 regions, 10,000 orders, 1,000 customers with email). For each pair run the query through the HTTP route, through the MCP tool with the principal's token, and as a direct SQL session with the RLS settings the policy derives. Assert that the three row sets and column lists are equal. For agent principals, assert `mcp_rows ⊆ delegator_rows`. Two failing seeds are kept as fixtures.

**Observable.** On stage at 255–285 s, the same denial is produced for the agent and would be produced for `brice` in the UI, with the same `policy_id`. The rehearsal checks that both denials appear with the same policy ID.

### F.2 A plan is exactly what is applied, and a stale plan cannot be applied

**Claim.** The document that `apply` writes has the `after_hash` the plan reported. A plan whose base revision has moved is refused.

**Test.** `plan.apply.exactness`: 1,000 random patch sequences over generated dashboards. For each: `preview` → record `after_hash`; `apply` → recompute the canonical hash of the stored head; assert equality. Then for 200 of them, apply a second change to the same document between preview and apply and assert `CONFLICT_REV` with no change row written and no head modification. Zero mismatches is the pass condition.

**Observable.** At 170–200 s the stale-rev conflict is shown in the terminal and the panel title on screen carries both edits. The audit shows two attributed entries and no lost write.

### F.3 Undo is an exact inverse, and the audit chain stays intact

**Claim.** Any sequence of human and agent changes to a document can be undone back to its baseline canonical hash, and the change log's hash chain verifies after every operation.

**Test.** `undo.inverse.roundtrip`: from a baseline dashboard, apply 50 interleaved changes from two principals (random ops, random sources), then undo all 50 in reverse. Assert the head `spec_hash` equals the baseline's. Run `parapet audit verify` after each step and assert no break in `entry_hash` continuity. Undo of an interleaved change that conflicts with a later one must return `CONFLICT_REV`, never a silent partial revert; the test injects 20 such cases and asserts all 20 are refused.

**Observable.** At 285–300 s, the finance board and the alert revert live on the finance window, and the audit trail shows undo rows linked to the changes they reverse.

### F.4 Hallucinated fields are refused before any write, with a correction the agent can use

**Claim.** The agent-facing schema rejects every malformed spec before writing, and for single-character typos the correction is the intended field.

**Test.** `mcp.errors.selfcorrect`: a corpus of 300 specs derived from valid ones with injected faults: unknown keys (150), wrong enum values (50), wrong types (50), unresolved metric references (30), and undeclared relations (20). Assert that 300 of 300 are rejected at `dashboard.plan` with no change row and no `plan` row except the refused preview. For the 150 unknown-key cases where the intended key is one edit away from the injected key, assert `did_you_mean` equals the intended key in at least 90 %. The rehearsal records the number of retries the live model needed per step as a measured quantity.

**Observable.** In the 45–95 s step, if the model misnames a field, the terminal shows the error and the corrected plan, and the presenter does not intervene. The retry count is logged in the rehearsal report, and a step that exceeds two retries triggers the tape.

### F.5 The deterministic fallback reproduces the same platform state through the real MCP path

**Claim.** The tape driver, running as the agent principal through the MCP endpoint, produces the same canonical final state as the live agent's recorded run, on the local and the AWS deployment, and refuses to run on diverged state.

**Test.** `demo.rehearse.equivalence`: run the full script three times: once with the live agent recorded (transcript and calls saved), once with the tape, and once with the tape against a deliberately diverged state (an extra panel moved in the fixture). Assert that the first two produce equal canonical state hashes (dashboards, alerts, grants, change-log content excluding timestamps and IDs, which are normalized by the tape's bindings). Assert the third run stops at the first precondition with `reset required`, and writes nothing after that step. Run the first two against the local and AWS deployments and assert equal hashes.

**Observable.** The presenter presses `F9` during the rehearsal; the wall shows the same sequence of changes, and the audit rows read `source: tape`. The equality check is in the rehearsal report.

---

## G. Failure analysis

### G.1 Implementation difficulties

- **Double enforcement drift.** Cedar and RLS must agree. The risk is a policy that Cedar permits but RLS filters, or the reverse. Mitigation: the RLS predicate is generated from the same bundle version, and claim F.1 runs on every bundle change. The analyzer in Cedar checks for shadowed `forbid` rules on sensitive columns.
- **Column masking inside the projection.** Masks must not leak through aggregates or dimension values (a `count(distinct email)` leaks cardinality). Mitigation: masked columns cannot appear as dimensions or in aggregates unless the mask is `bucket` or `hash`, and the compiler rejects other combinations with a `VALIDATION_MASK` error.
- **Stable node IDs under templating.** Templates instantiate new dashboards, and IDs must not collide or drift. Mitigation: instantiation re-keys all nodes and records the template lineage.
- **Three-way merge.** Merge of branches is harder than the demo needs. Mitigation: the demo uses only node-level optimistic concurrency; branch merge is listed as supporting and is not in the script.
- **Real-time under concurrency.** Gateways must not deliver events for documents whose read policy changed after the event. Mitigation: policy re-check at delivery, with the policy bundle version carried on each event, and a rule that policy changes trigger a re-evaluation of open subscriptions.
- **Headless Chromium in the worker** is large and slow to start. Mitigation: a warm pool of render processes, and reports are not on the demo's critical path.
- **Cross-environment parity.** Aurora and local Postgres can differ in extension availability and parameter defaults. Mitigation: the migrations use only core PostgreSQL 16 features, and `parapet doctor` checks the parameters that affect RLS and statement timeout.

### G.2 On-stage failure modes and mitigations

| Failure | Consequence on screen | Mitigation |
|---|---|---|
| Model calls the wrong tool (for example `query.run` where `query.preview` was asked) | A result appears that the script did not plan | The tool's description and the step's allowed set are checked by the watchdog; an out-of-set call triggers the tape. Read-only wrong calls are harmless to the state. |
| Model hallucinates a field | Validation error; the agent corrects it | Self-correcting errors (F.4). Two consecutive failures trigger the tape. |
| Model invents a metric name | `NOT_FOUND` with `nearest` | Metric list is discoverable; the nearest list is returned in the error. |
| Model's output is slow | Pause of more than 12 s | Watchdog triggers the tape after 12 s with no tool call. The presenter also has `F9`. |
| Model sends a write the presenter did not intend | A change appears on the wall | Writes are previewed first; the presenter's prompts name the actions, and the agent's preview is visible in the terminal before apply. The stage rule is that the presenter reads the preview line before the apply step. For the scripted run, the tape carries only the previews that were recorded. |
| Network failure between presenter laptop and the platform | No tool responses | Stdio transport fallback (E.5), and the tape can target a local endpoint. |
| SSO token expiry during the demo | Login prompt on a window | Tokens for demo principals have a lifetime longer than the demo; the rehearsal checks this. |
| Gateway reconnect | A screen shows stale data | Screens resume from their last `seq`; a reconnect fetches missed events from the change log. The wall shows a small "live" indicator that turns to "reconnecting". |
| Database lock contention from the fault | Slow queries on the investigation page | This is part of the demo, but the investigation's own queries use short `statement_timeout` and read from the metrics store, not from the contended table. The lock panel is a separate query with its own timeout. |
| Fault not present at start | Spike not visible | Reset checks the manifest and refuses to report ready without the fault active. |
| Browser sessions desynchronize | Windows show different states | The rehearsal compares each window's `rev` with the head at the end of each step. |

### G.3 Hidden complexity

- **Idempotency across retries of an agent that loses its connection after apply.** The idempotency key is per principal, and the agent must reuse the key on retry. Agents often generate a new key, which yields a duplicate change. The mitigation is to derive the default key from `hash(plan_id)`, which the agent is told to reuse.
- **Presence versus permission.** A presence badge is shown to others who can read the document, and presence for the agent must not reveal that the agent is looking at a restricted node. The gateway filters presence by the viewer's read decision.
- **Time.** The demo reads "last fifteen minutes" relative to now. The tape binds timestamps from live responses. A rehearsal across midnight or a timezone change will differ in relative terms and must be run in a fixed timezone.
- **Reproducible randomness.** The load generator, the fault scheduler and the fixture generator share one seed; the RNG streams are separated per component so that adding a component does not change another's sequence.
- **Audit volume.** Denied attempts and presence events are not logged in the change log, but denials are. An agent in a loop can create many denial rows. Rate limits bound this, and denial rows are rolled up in the audit view.

### G.4 Honest list of shallow features

These look impressive but are shallow, and the proposal says so rather than letting the audience infer depth.

- **Collaborative editing.** It is field-level optimistic concurrency with presence and structured conflicts, not a CRDT. Two editors on one text field lose one edit, and the conflict says so. The on-stage moment is about explicit conflicts, not convergence.
- **Anomaly detection.** It is a rolling robust z-score, a penalty-based change-point search and a contributor decomposition. It is useful and deterministic, but it is not a learned model and should not be described as ML.
- **Anomaly explanations.** The `summary` text is a template filled with computed facts. It is not natural-language generation and does not claim causation.
- **Lineage.** It is derived from query IRs and metric definitions inside Parapet. It does not parse SQL in external databases, and it cannot see lineage that is not declared.
- **Embedding.** Signed, parameter-locked iframe tokens with a pinned version. There is no embedding SDK, no theming API and no cross-origin event bridge beyond parameter reads.
- **Forms that write back.** Limited to the closed write operations (insert, update by key) on declared relations. There is no arbitrary write or transaction builder.
- **Workflow engine.** A closed step registry with a state machine. It has no branching DSL, no loops and no retries policy beyond fixed backoff.
- **Scheduled reports.** A PDF render of a dashboard, not a pixel-exact export. Fonts and layout differ slightly between the wall and the PDF.
- **Multi-tenancy.** Enforced by `tenant_id` and RLS. The demo runs one tenant with a second tenant present in fixtures to exercise the isolation tests. The demo does not show tenant administration.
- **SSO.** The local realm is a test IdP. The OIDC contract is the real one, but the demo has no SAML and no SCIM provisioning.
- **Undo.** Undo is inverse-command based. It cannot revert changes made outside Parapet (for example, the `ops-maint` lock), and the platform says so in the audit view.
- **Screens.** A screen is a browser session with a principal. It is not a hardware-managed display fleet.

---

## H. Feasibility

Feasibility is expressed by what each component touches and by the order in which each unblocks the next. No durations are given.

### H.1 Scope by component

| Component | What the work touches | Depends on |
|---|---|---|
| Spec schemas and validator (Zod, JSON Schema export) | Document kinds, error shape, `did_you_mean` logic | none |
| Database schema, migrations, RLS generator | `document`, `document_version`, `change_log`, `plan`, `idempotency`, `metric_point`, `source_column` | spec schemas (for JSON shape) |
| Command layer (plan, apply, idempotency, hash chain) | Single write path, canonical hashing, outbox | database schema |
| Policy engine (Cedar bundle, decisions, explanations) | Bundle loader, evaluator, `permission.explain` | command layer (decisions are recorded there) |
| Query engine (IR, compiler, transforms, column masks) | Parser, reference resolver, SQL lowering, pure transform functions | policy engine, database schema |
| `orderflow` demo estate | Three services, load generator, fault injector, `db.locks` collector, seeded fixtures | database schema (its own schemas) |
| HTTP API | Routes generated from command and query layers | command layer, query engine |
| MCP server | Discovery, resources, tools, error mapping, OAuth resource metadata | HTTP API handlers (same command layer), policy engine |
| Change feed and gateway | Cursor reads, per-subscriber filter, presence | change log, policy engine |
| Web UI: wall, panel renderers, editor | React app, grid, panels, cross-filter | HTTP API, gateway |
| Alerts, workflows, forms, grants | Worker, queue, closed step registry | command layer, policy engine, query engine |
| Undo and audit verification | Inverse ops, verify command | command layer, change log |
| Tape driver and companion | Tape format, watchdog, preconditions | MCP server, rehearsal runner |
| Rehearsal runner | Headless browsers, state-hash comparison, scripted prompts | everything above, plus the tape |
| Local compose and AWS deployment | Compose files, CDK or CloudFormation for ECS, ALB, Aurora, Cognito | images, migrations, interfaces |
| Supporting (embedding, scheduled reports, templates, branching) | Token issuer, PDF worker, template instantiation, branch pointers | command layer, versioning |

### H.2 Critical dependencies

- **Cedar and RLS agreement** gates every read path. It is the first integration test that must pass, before the query engine is trusted.
- **The command layer** gates every write path, including the agent's. Building the MCP server before the command layer would create a second write path, which the architecture forbids.
- **The fault injector and the lock collector** gate the demo's central moment. They are built and validated before the agent is involved, so the wall has real data from the first rehearsal.
- **Keycloak realm and the OIDC issuer contract** gate every authenticated test. The MCP OAuth flow depends on the same issuer, so it is built alongside the HTTP login, not after.
- **The tape depends on stable MCP tool names and argument shapes.** Names are frozen before the script is recorded. A tool rename after recording invalidates the tape.

### H.3 Main risks

1. **Scope breadth.** The inventory has 45 rows. Each row must be reachable from the spec, the MCP tools and the UI, or it is cut. The composition rule is the cut criterion.
2. **Agent latency inside the choreography.** The model's latency is outside the platform. The mitigation is the watchdog and the tape, plus keeping prompts short and previews visible.
3. **Cedar and RLS drift.** Mitigated by F.1 and the analyzer. Highest-impact technical risk.
4. **Column masks leaking through aggregates.** Mitigated by the compiler rule (G.1). Requires adversarial tests.
5. **Real-time delivery under policy change.** Mitigated by per-event bundle version and re-evaluation. Requires a test that changes policy mid-stream.
6. **Visual polish across many panel kinds.** Breadth multiplies UI work. The mitigation is one renderer contract, with panel kinds that are thin adapters over frames.
7. **Identical behaviour across AWS and local.** The interface boundaries and the rehearsal comparison are the mitigation. Aurora-specific behaviour is not used.

### H.4 Build sequence (dependency order, minimal vertical slice first)

The minimal vertical slice is one document kind, one source, one principal, one panel, one screen and one MCP tool. It is built first and expanded only after it passes F.2 and F.4.

1. **Spec v1 for `Dashboard` and `Query` only**, with the validator and JSON Schema export. Touches the schema package only.
2. **Database schema for `document`, `document_version`, `change_log`, `plan`, `idempotency`, with the hash chain.** Touches migrations and the command layer's storage functions.
3. **Command layer: `dashboard.plan` and `dashboard.apply` with `base_rev`, `plan_hash` and idempotency.** Test F.2 is the gate.
4. **Cedar bundle with three rules, RLS generator, and `permission.explain`.** Test F.1 for two principals is the gate.
5. **Query engine for one source (`metrics`), with IR, compiler, masks, and the pure transforms.** Test F.1 extends to three surfaces (HTTP and direct SQL, MCP later).
6. **`orderflow` estate, load generator, fault injector and reset command.** Gate: the reset reports the fault active and the metric shows the spike.
7. **HTTP API and the gateway, with per-subscriber filtering.** Gate: two browser windows show the same change within the latency target.
8. **Web UI: wall, timeseries and stat panels, the dashboard editor on the plan/apply path.** Gate: a human edit and an API edit produce identical change rows.
9. **MCP server over the same handlers, with discovery, resources, preview/commit tools and the error shape.** Gate: F.4 corpus passes.
10. **Undo and the audit verify command.** Gate: F.3 round-trip passes.
11. **Second source (`db.locks`), drill-down links, cross-filter, presence, screen tools.** Gate: the 95–170 s steps run by hand, with the agent replaced by a recorded set of calls.
12. **Alerts and approvals, workflow registry, `external_notify` policy.** Gate: the 235–255 s step runs with the approval round trip.
13. **Column masks in the finance view, row scope, `query.preview` as a principal.** Gate: F.1 full.
14. **Tape driver, watchdog, companion, rehearsal runner.** Gate: F.5 passes locally.
15. **AWS deployment of the same images, OAuth resource metadata on the MCP endpoint, the rehearsal on AWS.** Gate: F.5 hash equality across deployments.
16. **Supporting capabilities (embedding, scheduled reports, templates, branching, comments).** Added only after the script is stable, and each one must pass the composition rule before inclusion.

The live agent is first exercised at step 9. The script's tape is recorded only after step 13, when every tool name and every expected result is stable. Until then the rehearsal uses hand-written calls, which keeps the tape from being recorded against a moving interface.

### H.5 What is deliberately not in the build

- No LLM inside the platform, in any form, including for the anomaly summaries.
- No raw SQL surface for agents or for embedding.
- No CRDT text editing.
- No second write path that bypasses the command layer.
- No canned UI animation in place of a real change.

These exclusions are what keep the architecture small enough that the surface can grow by composition rather than by special cases.

---

*Word count: approximately 7,000 words, estimated from the section lengths above.*
