# Parapet: a governed, composable operations platform (Competitor 03, Enterprise Platform, revision 1)

Mandate: a serious, configurable, secure, multi-tenant enterprise platform. SSO, roles and attribute-based policy, row- and column-level security that the agent is also bound by, governance, audit, approvals, lineage, sharing and embedding.

Product title: **Parapet**

Pitch: Parapet is a governed, composable operations platform in which every dashboard, query, metric, alert, workflow and permission is a typed, versioned, audited document that a person or a scoped agent changes through one plan-and-apply command path. On stage, an agent connected over MCP builds a live investigation screen from real Postgres lock data, is refused a salary column by the same policy that would refuse a human, and then reverts its own finance and alert changes while every connected screen reverts with it.

---

## Revision log

Each reviewer finding is listed with how it was addressed: **fixed** (with the section where the change lives), **rebutted** (with the technical reason), or **accepted** as a known limitation (listed again in G.4).

### Reviewer A (Principal Systems Engineer)

| Finding | Disposition |
|---|---|
| W1: `source.describe` returns hidden columns with their sensitivity class; the 255–285 s beat shows `salary_band` before denial | **Fixed.** `source.describe` returns only the columns the effective principal may see (D.8). Hidden and absent columns produce the same `POLICY_DENIED` shape from `query.preview`, so the response does not reveal that a column exists or what class it has (D.8, test `denial.indistinguishable` in F.1). The beat in C is rewritten. |
| W2: `as` lets an agent name another principal; `permission.explain` takes any principal | **Fixed, partly rebutted.** `as` is kept, because the finance-preview claim (F.1) needs it, but it is narrowed. The effective rights of a query are `agent ceiling ∩ rights(as)`, so `as` can never widen; an `as` principal outside the agent ceiling is refused; every use is audited (D.6, D.8). `permission.explain` is bounded to the agent and its delegator; explaining any other principal is a human-UI operation (C, step 2). Removing `as` entirely was rejected because it would remove the finance view the audience sees, and intersection semantics make it safe. |
| W3: commit-mode writes without `plan_id` or idempotency key | **Fixed.** The agent surface has no commit mode. Every write is `<kind>.plan` (preview only) followed by `plan.apply(plan_id, plan_hash, idempotency_key)` (D.8). |
| W4: approval resumption undefined; no approval table | **Fixed.** `approval` table in D.3; resume path, approver recording and expiry in D.8 ("Approvals"). The approved plan is applied by the platform as the agent principal with the approver recorded; a moved base or an expired approval forces a re-plan. |
| W5: RLS guarantee needs a non-owner role and FORCE RLS | **Fixed.** Roles, `FORCE ROW LEVEL SECURITY` and the non-owner application role are specified in D.3. `parapet doctor` checks them (E.1). |
| W6: no serialisation point for `change_log` identity and hash chain | **Fixed.** The identity column is removed. Commits take a per-tenant counter row lock, which is the serialisation point and assigns dense sequence numbers in commit order (D.3, D.5). |
| W7: workflow step types not checked against the agent ceiling at creation | **Fixed.** `workflow.plan` checks each step type against the ceiling; `http_call` is refused for agents outright (B.3 row 28, D.8 table). |
| W8: lock injection is a scripted maintenance job, so the root cause is designed to be found | **Fixed.** The lock is taken by a real long transaction in the `payments` service's reconciliation path. The scripted `ops-maint` job is kept only as a fallback and is disclosed as one (A, C setup, E.4). |
| W9: 5 % timestamp tolerance precondition can pass diverged state | **Fixed.** Preconditions are exact normalised-state hashes over the documents, grants and fixtures the tape touches. Live metric values are not part of the precondition; the script asserts their shape, not their value (C fallback, F.5). |
| W10: visual ambition is low; mostly tables and cards | **Fixed.** Two non-table panel kinds are added: a lock-wait graph by backend and a latency heatmap by service and minute (B.4 row 32, C, D.9). |

### Reviewer B (Skeptical Technical Audience Member)

| Finding | Disposition |
|---|---|
| 170–200 s race between a human retitle and an agent apply, with a model-chosen merge | **Fixed.** The stale base is deterministic: the agent prepares a held plan (C, 95–135 s), the presenter's human edit lands in the SRE window, then the presenter applies the held plan. The platform returns `CONFLICT_REV` and shows a conflict card. A human chooses the title; no model merge is performed (C, 135–160 s). |
| Nine agent prompts in 300 s; the 12 s silence trigger will fire on most turns; no latency budget or takeover rate | **Fixed.** Five agent prompts. Each turn has a stated call budget (at most 7 calls) and a latency budget of 45 s, measured in rehearsal. The silence trigger is 20 s to the first tool call. No takeover rate is claimed in this document; the rehearsal report records it, and the pass target is stated as a target, not a result (C, fallback). |
| Brice listed as admin but lacks an `hr.comp` grant; approval gate depends on `Group::security`, which Brice's membership never establishes | **Fixed.** One principal table (C, setup) gives Brice groups `sre`, `security` and `finance`, and no `hr.comp` grant. The approver is any human in `security`; Brice is the approver in the script (C, setup and 185–200 s). |
| The lock appears as a change-log row, but the platform would not record an outside job's lock | **Fixed.** The lock is an observation from the `db.locks` collector, not a change. The start of the reconciliation job is an `ops.events` row emitted by the `payments` service. Undo does not cover it, and the audit view says so (B.3 row 18, D.7, G.4). |
| The fault is staged but the script does not say so | **Fixed.** A "staged scenario" chip on the wall and a staging note in C (setup). |
| Visual impact limited to timeseries, stat, table and one topology panel | **Fixed.** Lock-wait graph and latency heatmap (see Reviewer A, W10). |
| No SCIM, no tenant administration UI, multi-tenancy only in fixtures | **Accepted as known limitations** (G.4). The 300 s script cannot show tenant administration or provisioning, and any claim about them would rest on fixtures alone. The document says so rather than implying depth. |

### Reviewer C (Implementation and Reliability Engineer)

| Finding | Disposition |
|---|---|
| Lock fault held for a window keyed to neither the script clock nor a release trigger; "14 waiters" can be zero | **Fixed.** The hold is a configured window set at reset, released by the scenario schedule. Reset refuses to report ready if the hold window is shorter than the run plus a margin. Waiters are checked at each step (95, 135, 170 s and so on), not only at reset. The "14 waiters" figure is removed; the count is shown live (C, E.4, F.7). |
| Change feed skips a lower sequence that commits after a higher one | **Fixed.** Dense commit-ordered sequence from the counter row lock, plus a two-transaction out-of-order test (D.3, D.5, F.3). |
| Aurora reader lag can show stale post-apply state on AWS only | **Fixed.** Read-your-writes watermark: a session's reads go to the reader only when the reader's replay position is at or past the session's last write; otherwise the writer serves the read. The reader path is a documented difference with its test (E.2, E.3, F.3). |
| `query.preview` `as` lets the agent see another principal's policy-filtered result | **Fixed.** See Reviewer A, W2. The case is added to F.1. |
| The 170–200 s merged title contradicts D.5's rule that exclusive properties conflict | **Fixed.** Conflict card; no model-chosen merge (C). |
| The 285–300 s closing is a multi-call chain with no timing budget; grant attributed to Brice may not revert | **Fixed.** One batch `change.undo.plan` over named agent changes, applied once. The grant to `sre` is created by the agent, not approved by Brice, so it is in the undo set. The closing has a 30 s latency budget (C, 245–300 s). |
| Tape types recorded agent reply text into the terminal | **Fixed.** The tape types nothing. The terminal shows only tool-call lines and their real responses, labelled as driver-authored. No prose is replayed (C fallback). |
| Forty-five primitives with no cut order | **Fixed.** Ordered cut list with the claims each cut affects (H.6). Headless Chromium PDF is first in that list. |

### Reviewer D (Agent and MCP Tooling Engineer)

| Finding | Disposition |
|---|---|
| Two commit paths contradict B.1 row 41; `dashboard.apply` takes a plan while other writes take a mode | **Fixed.** One write path per kind: `<kind>.plan` then `plan.apply`. B.1 row 41 and D.8 now agree (D.8). |
| `embed.token.create` mints a bearer credential with no preview, approval or agent exclusion | **Fixed.** Removed from the agent catalogue. A probe test asserts that the tool is absent from `tools/list` and that a direct call from an agent token is refused as unknown (F.6). Human embedding is unchanged (B.2 row 15). |
| `as` may only narrow to the caller's rights | **Fixed.** See Reviewer A, W2. |
| Typed terminal narration of agent reply text | **Fixed.** See Reviewer C. |
| Tool names not single-sourced; tape pins can break silently | **Fixed.** One tool registry module generates `tools/list`, descriptions, schemas and the tape's tool bindings. The tape pins each tool's name and schema hash, and a mismatch fails the tape at load, before the show (D.8). |
| The refusal beat draws nothing on the wall | **Fixed.** The denied attempt appears as a visible slot on the investigation page and in the activity rail on all windows (C, 215–245 s; D.9). |
| `schema.describe` and the schema resource have no size budget | **Fixed.** Size budgets in D.8. |
| No agent-path evaluation | **Fixed.** A pre-registered, prompt-untuned agent evaluation with pass criteria (F.6). |

### Self-corrections made while revising

- Removed the claim that a maintenance job's lock appears in the change log.
- Removed the 5 % timestamp tolerance and the fixed "14 waiters" figure.
- Removed the agent's `as:group:finance` preview from the finance-window count; that count is now produced by the finance window's own query as its own principal (C, 185–200 s).
- Removed the "nine prompts" script in favour of five.

---

## A. Product concept

**What it is.** Parapet is a self-hosted (and AWS-hosted) platform for building dashboards, drill-downs, alerts, forms, workflows and reports over operational data. Its unit of work is a *document*: a dashboard, panel, query, metric, alert, workflow, form, grant, approval or policy binding. Every document has a stable identity, a revision, a schema version and an entry in one append-only change log. The web UI, the HTTP API and the MCP server are three clients of one command layer. None of them has a capability the others lack.

**Who uses it.**

- *SRE and platform engineers* build and share operational views, alerts and runbook workflows.
- *Finance and business analysts* build boards over data they may see, with masked columns and filtered rows.
- *Security and compliance* read the audit trail, explain permissions, approve sensitive actions and review agent activity.
- *Engineering leaders* consume embedded, read-only boards issued as signed, scoped tokens.
- *An AI agent* (an external MCP client such as Claude Code or Claude Desktop) acts as a scoped principal on behalf of a named human. It answers questions and composes the UI that answers them. The platform itself contains no LLM.

**What the demo dashboards are about.** The data is the operation of a small, real, reproducible system called *orderflow*: three Node.js services (`checkout`, `payments`, `inventory`) backed by PostgreSQL, running in containers from the same images locally and on AWS. A seeded load generator drives them with real HTTP requests. Each service emits OpenTelemetry traces and metrics through an OpenTelemetry Collector into Parapet's ingest endpoint.

- **Load.** The default profile is about 200 requests per second across the three services. This is a configured quantity, not a measurement. The seed fixes the request sequence for a given run.
- **Lock contention is real and comes from application code.** `payments` runs a reconciliation path that, when the reset command enables it, opens a transaction, takes row locks on `payments.ledger` with `SELECT ... FOR UPDATE`, and holds them while it waits on a deliberately slow settlement stub. Checkout requests that touch the same ledger rows queue behind it. Lock waits are read from `pg_locks` and `pg_stat_activity` by the `db.locks` collector. Nothing in the path is a sleep injected by the test harness.
- **The fault is staged.** Reset schedules the reconciliation job to start at the scenario's offset (about six minutes before the first presenter prompt) and to hold for a configured window that covers the run plus a margin. The wall shows a "staged scenario" chip stating when the fault was staged. A scripted `ops-maint` job that takes `ACCESS EXCLUSIVE` on the same table is kept as a fallback only, and the staging note says which path is in use.
- **Reproducibility.** `parapet demo reset --seed 2026` truncates the demo schemas, reloads the seeded fixtures (principals, groups, grants, dashboards, sample queries), restarts the load generator with the seed, and schedules the reconciliation job. The post-reset state hash is fixed for that seed (F.5).

**Why this matters to the audience.** Engineers distrust demos where the AI "does magic". Parapet's claim is narrower and checkable: the agent is not special. It uses the same commands, the same validation, the same policy engine and the same audit stream as a human. When it fails, it fails with the same error a human would see.

---

## B. Capability inventory

Each primitive is a document kind or a command with one schema, one authorization path, one change-log entry and one real-time event type. Status: D = demonstrated on stage, S = supporting (present and tested, not shown live). Cut candidates are marked in H.6.

### B.1 Core substrate

| # | Primitive | Status | Technical significance | Composes with |
|---|---|---|---|---|
| 1 | Document model with stable ULID node IDs and per-node `rev` | D | Every panel, parameter, link and layout cell is addressable. Patches operate on IDs, not array positions. | All documents, diff, undo |
| 2 | Typed spec language (`Dashboard`, `Panel`, `Query`, `Metric`, `Alert`, `Workflow`, `Form`, `Grant`, `Approval`) | D | One schema, one validator, emitted as JSON Schema for MCP and OpenAPI for HTTP. | Every write path, MCP discovery |
| 3 | Command layer: one write path, `<kind>.plan` then `plan.apply` | D | Plans carry `base_revs`, `plan_hash` and decision IDs. Apply re-checks everything and is the only commit. | Authz, audit, undo, real-time, approvals |
| 4 | Change log: append-only, hash-chained, attributed (`actor`, `on_behalf_of`, `source`, `plan_id`), with a commit-ordered sequence | D | Source of audit, undo, real-time fan-out and replay. | Everything |
| 5 | Undo as a recorded inverse plan (single or batch) | D | Undo is itself a plan and a change, so it is audited and can be undone. | Change log, versioning |
| 6 | Versioning and branching of dashboards (immutable `document_version`, named branches) | S | Snapshots and diffs between any two versions. Branch merge is not used in the script. | Diff, templates, embedding (pinned versions) |
| 7 | Structural diff; conflicts as structured records | S | Diff keyed by node ID. Conflicts are data (`CONFLICT_REV` with the current value), never a model-chosen merge. | Collaborative edit, undo |

### B.2 Identity, authorization, governance

| # | Primitive | Status | Significance | Composes with |
|---|---|---|---|---|
| 8 | OIDC SSO with group and claim mapping | D | Humans log in through the IdP. Groups and claims (department, region, clearance) become principal attributes. | Policy, RLS, sharing |
| 9 | Principals: user, group, service, screen, agent (agent always carries `on_behalf_of`) | D | The agent's ceiling is `min(registration, delegator's effective rights, action policy)`. | Policy, audit, rate limits |
| 10 | Attribute-based policy in Cedar | D | `permit`/`forbid` over principal, resource and context attributes. Each decision names the policy IDs that produced it. | Column masks, row filters, approvals, explanations |
| 11 | Row-level security in PostgreSQL, driven by the same policy, with `FORCE ROW LEVEL SECURITY` and a non-owner application role | D | Rows are filtered in the database by predicates set per transaction. Application code cannot skip them, because the application role does not own the tables and is not forced past RLS. | Query engine, embedding, agent queries |
| 12 | Column-level security and masking (`hash`, `partial_email`, `bucket`) | D | Columns are dropped or masked in the compiled projection, never in the client. | Query, export, embedding, agent |
| 13 | Approvals: `forbid` decisions naming an approval route, resolved by a human in the approver group, recorded in an `approval` table | D | The agent's held plan is applied by the platform after a human approves that exact plan hash (D.8). | Plans, alert routing, grants, workflows |
| 14 | Sharing grants with expiry and resource scope | D | `Grant` documents, which are versioned, audited and policy-checked. Agent grants are capped at the delegator's rights. | Embedding, approvals, undo |
| 15 | Embedding with signed, parameter-locked tokens (human-issued only) | S | Token scopes a dashboard, a pinned version, a fixed parameter set and a TTL. Tokens are minted by humans in the UI or HTTP API; the agent cannot mint them. | Sharing, RLS (the token's principal is a service principal bound by policy) |
| 16 | Audit query and retention | D | `audit.search` over the change log, filtered by actor, source, time, resource and decision, including denials. | Everything |
| 17 | Rate limits and budgets per principal | S | Token buckets for reads and writes, plus a query cost budget. | Agent, embedding, scheduled reports |

### B.3 Data, queries and metrics

| # | Primitive | Status | Significance | Composes with |
|---|---|---|---|---|
| 18 | Data sources: PostgreSQL (own and orderflow), OTLP metrics store, `db.locks` observations, `ops.events`, audit log, CSV upload (S) | D | Each source declares its relations, columns, types and sensitivity classes. Observations are not changes. | Query, lineage, policy |
| 19 | Query IR: source, select, dimensions, predicates, joins on declared relations, transforms, mandatory limit and timeout | D | One IR compiled to parameterized SQL. Raw SQL is not exposed to any agent surface. | Panels, alerts, metrics, workflows, export, agent |
| 20 | Transform pipeline: `filter`, `derive`, `groupBy`, `bucket`, `fill`, `window`, `topK`, `pivot`, `join`, `zscore` | D | Pure functions over result frames, shared by server and client. | Query, anomaly, panels |
| 21 | Named metrics (`Metric` documents with owner, unit and expression) | D | Defined once, referenced by name, so a panel, an alert and an answer use one definition. | Query, alerts, lineage |
| 22 | Parameters (time range, enum, multi-select, validated text) | D | Typed inputs bound into queries as `$name`. | Panels, cross-filter, embedding, forms |
| 23 | Cross-filtering and drill-down links | D | A click sets a parameter or opens a target dashboard with parameters carried. Declared in the spec. | Parameters, panels, workflows |
| 24 | Annotations on time series | S | Persisted, attributed, scoped to a panel. | Changes, incidents, audit |
| 25 | Lineage: upstream and downstream graph derived from query IRs and metric definitions | D | `lineage.trace` answers "which panels and alerts depend on this column". | Metrics, alerts, audit, policy |
| 26 | Deterministic anomaly explanation (rolling robust z-score, penalty-based change-point search, contributor decomposition) | D | Pure statistics. The summary text is templated from computed facts. No model. | Query, panels, alerts, agent |
| 27 | Forms that write back (typed fields, closed write operations on declared relations) | S | Writes go through the command layer and the change log. | Workflows, audit, approvals |
| 28 | Workflows: trigger (alert, schedule, form submit, manual); closed step registry (`notify`, `set_param`, `form_write`, `approval`, `http_call` for humans only) | D | Observable state machine per run (queued, running, waiting, done, failed); each transition is an event. Step types are checked at creation (D.8). | Alerts, forms, approvals, audit |
| 29 | Alerts with threshold, `for` duration and routing | D | Alerts evaluate queries on a schedule; state transitions are events; routes are groups or allowlisted endpoints. | Query, workflow, approvals |
| 30 | Scheduled reports (CSV first; PDF render of a pinned version as a later addition) | S | Scheduled under the schedule's principal's policy. PDF is a cut candidate (H.6). | Sharing, embedding, audit |

### B.4 Presentation, real time, collaboration

| # | Primitive | Status | Significance | Composes with |
|---|---|---|---|---|
| 31 | Layout grid with stable item IDs | D | Positions are data, patched like any other node. | Panels, templates |
| 32 | Visualizations: time series, bar, table, stat, heatmap (service by minute), graph (lock-wait graph by backend), topology (from lineage) | D | Each panel kind is a renderer over a result frame with an option schema. | Query, transforms, cross-filter |
| 33 | Templates (dashboards with parameters and placeholder queries) | S | Instantiation re-keys node IDs and records lineage to the template. | Versioning, sharing |
| 34 | Real-time fan-out from the change log, filtered per subscriber by policy | D | A subscriber receives only events for resources it may read, re-checked at delivery. | Authz, presence, screens |
| 35 | Presence and cursors | D | Who is viewing which dashboard and which panel is focused. Ephemeral, held by the gateway, filtered by read policy. | Collaboration, agent focus |
| 36 | Collaborative editing: node-level `base_rev`, presence, structured conflict cards | D | Two editors (human or agent) cannot silently overwrite each other. Conflicts surface as data and are resolved by a human choice. | Command layer, diff |
| 37 | Screens: named display targets that the agent or a human can push a dashboard or panel to | D | `screen.show` and `screen.focus` push presentation state to connected browsers. Screens are principals with their own rights. | Real-time, presence |
| 38 | Comments on panels and dashboards | S | Threads anchored to node IDs. | Presence, audit |

### B.5 Agent surface

| # | Primitive | Status | Significance | Composes with |
|---|---|---|---|---|
| 39 | MCP server (Streamable HTTP, with stdio for local development) | D | Tools, resources, prompts. Same command layer as HTTP and UI. | Everything |
| 40 | Discovery: policy-filtered capability catalogue and schema describe | D | The agent sees only capabilities its effective principal may use, and only the columns it may see. | Schema, policy |
| 41 | One write path: `<kind>.plan` then `plan.apply` with `plan_id`, `plan_hash` and `idempotency_key` | D | No write tool commits by itself. The agent cannot skip the previewed plan. | Command layer, undo |
| 42 | Self-correcting errors (path, did-you-mean, valid values, retryable flag, doc reference) | D | Designed for an agent to repair its own call. | Schema, validation |
| 43 | Tape driver: recorded MCP call sequences replayed as the same agent principal | D | The fallback. Exact state-hash preconditions are checked before each step. | MCP, rehearsal |
| 44 | Rehearsal runner: headless browsers, multiple sessions, state hash comparison | S | Automated end-to-end validation of the script. | Tape, reset, health |
| 45 | Health and readiness checks, one-command reset, one-command startup | S | Operational primitives the demo depends on. Reset refuses to report ready without the fault staged. | Reset, rehearsal |

### B.6 Composition map

```
Identity (8,9) ──► Policy (10) ──► RLS (11) + Column masks (12) ──► Query engine (19,20)
     │                 │                                                  │
     │                 └──► Approvals (13) ──► Workflow (28) ◄── Alerts (29) ◄── Metrics (21)
     │                                                 │                        │
     └──► Grants (14) ──► Embedding (15, humans only)  ▼                        ▼
                                                  Forms (27)           Lineage (25) ──► Topology (32)
                                                                                 │
Command layer (3) ──► Change log (4) ──► Undo (5) ──► Versioning (6,7)           │
     ▲     │               │                                                     │
     │     │               └──► Audit (16)          Anomaly explain (26) ◄────────┘
     │     └──► Real-time fan-out (34) ──► Presence (35) ──► Screens (37)
     │
MCP (39) ──► Discovery (40) ──► plan (41) ──► plan.apply (3)
              │                                    └──► Self-correcting errors (42)
              └──► Tape driver (43) ──► Rehearsal (44)
```

The key compositions for the demo:

1. **Query to panel to alert to workflow.** A saved query feeds a timeseries panel, an alert with `for: 2m`, and a workflow step that notifies a group. Editing the query changes all three through the same reference.
2. **Metric to lineage to topology.** `lineage.trace` returns the graph from the query IR, and the topology panel renders it.
3. **Policy to query to embedding.** A column masked for finance is masked in the finance board, in the agent's answer and in an export, because the mask is compiled into the projection.
4. **Command to change log to undo to real-time.** A human edit, an agent plan, an approval-applied plan and an undo all produce the same event type. Screens update for each, and the audit row shows the source.

---

## C. Five-minute live script

### Setup

**Windows and principals.**

- **Wall** (`screen:wall-1`): the Parapet window in full screen, showing the `Ops overview` page and then the `Checkout p99 investigation` page. It shows a staged-scenario chip and a live indicator. It is a screen principal with read rights on the demo dashboards.
- **SRE window** (`sre-oncall`): placed at the right third of the projection.
- **Finance window** (`finance-analyst`): shown at the 185–200 s mark, and at the 200–215 s mark it is the window that shows the masked board.
- **Presenter console** (`brice`): a small window on the presenter laptop, not projected except for the approval card, which is shown briefly.
- **Agent**: Claude Code on the presenter laptop with the Parapet MCP server registered. The terminal is not projected. If the presenter enables the corner overlay, it shows only tool-call lines and their real responses.

**Principal table.** One table, used by the fixtures, the policy bundle and the rehearsal.

| Principal | Kind | Groups (IdP claim) | Attributes | Role and rights | Notes |
|---|---|---|---|---|---|
| `brice` | user | `sre`, `security`, `finance` | `region=all`, `clearance=confidential` | platform admin (bundles, principals, `http_call` allowlist); data rights from groups | Delegator of the agent. Approver: `security` membership makes him an eligible approver. No `hr.comp` grant. Email masked like everyone outside `support`. |
| `sre-oncall` | user | `sre` | `region=all` | data rights from `sre` | Sees the SRE window and the drill-down. |
| `finance-analyst` | user | `finance` | `region=EU` | data rights from `finance`; row filter `region = 'EU'` | `customer.email` masked to `partial_email`. |
| `agent:claude-code` | agent, `on_behalf_of: user:brice` | none | inherits Brice's data rights | registration excludes `admin`, `approve` and `embed`; ceiling = Brice's effective rights intersected with registration | Held-plan and approval-gated actions are capped by the approval rules. No `hr.comp` access, because Brice has none. |
| `service:payments` | service | none | none | writes `ops.events` and runs reconciliation | The only actor that takes the ledger locks. |
| `screen:wall-1` | screen | none | none | read on demo dashboards | Receives pushed screen state. |

Because the agent's ceiling is Brice's rights, anything Brice cannot read the agent cannot read. This makes the 255–285 s refusal the same refusal Brice would receive from the same query.

**Initial state.** `parapet demo reset --seed 2026`. Reset stages the reconciliation job so that the spike is present when the script starts, and reports ready only if the fault is active and the hold window covers the run plus margin. The hold window is a configured quantity, not a measurement.

### Timeline

Times are script offsets. Agent prompts are five, each a single sentence. The agent's latency is outside the platform; budgets are stated per turn and measured in rehearsal.

| Time | Human action | Agent action (MCP calls) | Visible result | Capabilities | Transition |
|---|---|---|---|---|---|
| 0–25 s | Presenter says: "This is an operations platform. Everything on this screen is a document, and an agent can edit any of them." No keyboard. | None. | The wall shows `orderflow` live: request rate, p99 by service, the fault's effect on checkout. The staged-scenario chip is visible. | Real-time fan-out (34), timeseries and stat panels (32), real data from real services (18) | Presenter types the first prompt. |
| 25–70 s | Types: "Build a page that shows checkout p99 by service, the lock waits behind it, and where the spike starts." | `query.preview` (metric by service and minute), `anomaly.explain` (`latency_p99{service=checkout}`), `lineage.trace` (`metric:latency_p99`, upstream, depth 3), `dashboard.plan`, `plan.apply` (idempotency key derived from plan ID), `screen.show` (`all`). Budget: 7 calls, 45 s. | The page "Checkout p99 investigation" appears on the wall and the SRE window within about a second of apply. It has a timeseries, an anomaly change-point marker, a heatmap by service and minute, and a lock-wait graph by backend, where one backend blocks the rest. | Query (19), metric (21), anomaly (26), lineage (25), graph and heatmap (32), plan and apply (3, 41), screens (37) | Presenter moves to the next beat without explaining the numbers. |
| 70–95 s | Presenter clicks "Why can finance see this board?" in the SRE window. | None. This is the human path through the same engine. | The explanation card lists the policy IDs that permit `group:finance` on `dashboard:finance-board`, and the forbid on `customer.email`. | Policy (10), explanation computed from the same evaluation as the decision | "Same engine for the agent and for you." |
| 95–135 s | Types: "Add a drill-down from the p99 panel to the lock graph, let group sre view this page, and retitle the lock panel to 'Payments lock contention'. Preview the retitle as a plan and hold it until I apply it." | `dashboard.plan` (add_link and set_param_binding), `plan.apply`, `share.grant.plan` (`group:sre`, viewer), `plan.apply`, `dashboard.plan` (retitle; **held, not applied**). Budget: 7 calls, 45 s. | The SRE window receives the link and the grant, and a presence badge "agent:claude-code editing" shows for about 2 s. The wall shows a held plan chip with the diff. | Patch (3), drill-down (23), grants (14), presence (35), cross-filter, plan hold | Presenter moves to the SRE window. |
| 135–160 s | In the SRE window, the on-call engineer retitles the lock panel to "Ledger lock waiters (on-call)". The presenter then clicks "Apply held plan" in the presenter console. | `plan.apply` on the held plan. The platform returns `CONFLICT_REV` with `{node:"panel:locks", field:"title", current_rev, current_value:"Ledger lock waiters (on-call)", retryable:true}`. The agent reports the conflict and makes no further write. | A conflict card on the wall and SRE window shows both titles and three choices: keep the on-call title, use "Payments lock contention", or edit. The presenter clicks "Use Payments lock contention". The choice is a human plan with source `ui`. | Optimistic concurrency (36), structured conflicts (7), no silent overwrite | "Two editors, one document. The platform stopped the write and a person chose." |
| 160–200 s | Presenter switches to the finance window and types: "Make the finance board show revenue by region and hide customer emails, show me what finance will see, and alert sre if checkout p99 stays above 800 ms for two minutes. Also post that alert to the partner webhook." | `dashboard.plan` (filter and `set_column_mask`), `plan.apply`, `query.preview` (`as: group:finance`, limit 5), `alert.plan` (internal), `plan.apply`, `alert.plan` (external), which returns `POLICY_DENIED` with `approval_required` and an `approval_request_id`. Budget: 8 calls, 45 s. | The finance board updates and the email column reads `a***@…`. The finance window shows its own count, "412 of 9,812 rows visible to you", produced by its own query as its own principal. The internal alert appears in `ok`. The external alert produces an approval card on the presenter console. | Column mask (12), row filter (11), `as` narrowing (40), alerts (29), approvals (13) | "The agent asked for something it may not do alone, and the platform asked a human." |
| 200–215 s | Presenter approves the external notification in the presenter console (approver `brice`, in `security`). | None. The platform applies the approved plan as `agent:claude-code` with `approved_by: user:brice`. | The external route appears on the alert and its state is recorded. The approval appears in the audit view. | Approval resume path (D.8), audit (16) | Presenter moves to the security view. |
| 215–245 s | Types: "Pull the salary bands for the Payments team into a panel on this page." | `source.describe` (`hr.compensation`) returns only the columns the agent may see, which does not include `salary_band`. `query.plan` naming `salary_band` returns `POLICY_DENIED` with the column, the policy ID and the principal. The agent replies that it cannot do this. | A denied slot appears on the investigation page, showing "Blocked: agent:claude-code · policy:hr-comp-restricted" and no data. The activity rail on every window shows the denial. The Security board shows the audit row with `source: mcp` and `on_behalf_of: user:brice`. | Least-privilege ceiling (9), policy (10), audit of denials (16), visible refusal (D.9) | Presenter pauses one beat, then types the next prompt. |
| 245–300 s | Types: "Undo the finance board and the alert changes you made this session, then show me the session's audit trail." | `audit.search` (actor `agent:claude-code`, session `current`), then one `change.undo.plan` over the named changes, then one `plan.apply`. Budget: 3 calls, 30 s. | The finance board reverts on the finance window in real time. The alert returns to its pre-session state. The audit table shows the sequence: agent changes, the approval, the denial and the undo rows, each undo linked to the change it reverses. The grant to `sre` and the drill-down are not in the undo set, and the audit view shows them as still applied. | Undo as inverse plan (5), audit (16), real-time revert (34) | Closing line: "Everything the agent did is attributed, reviewable and reversible, and it was stopped by the same rules as everyone else." |

**Why the first 30 s and last 30 s carry the demo.** The first 30 s establish that the wall is live, that the data is real lock contention from application code, and that the platform is not a mock. The final 30 s put the strongest claim in one sequence: the agent is refused by the same policy, the refusal is in the audit trail, and an undo returns the screens to their prior state live.

**Why the conflict is deterministic.** The held plan carries the base revision it was prepared against. The human retitle in the SRE window necessarily moves that revision, because the presenter performs it before the presenter clicks apply. The platform cannot return anything other than `CONFLICT_REV` for that apply. The rehearsal asserts this at each run.

### Fallback: how the tape driver takes over

The live agent is the default. The fallback is the same MCP path, invoked by a recorded tape instead of a model.

- **Tape format.** Each step is a record: `{step, prompt_id, calls:[{tool, schema_hash, args_template, expect}], preconditions}`. `args_template` references values bound from live responses, such as `{{dashboard.checkout-spike.rev}}` and `{{plan.id}}`; recorded IDs are never replayed. Tool names and `schema_hash` values come from the tool registry (D.8). A tape whose pins do not match the registry fails at load.
- **Preconditions are exact.** A precondition is the normalised state hash of the documents, grants, approvals and fixtures that the step touches, computed with revisions, IDs and timestamps replaced by bindings. Live metric values are not in the hash. The script asserts shape instead: the change-point exists on the checkout series, and the lock graph has at least one blocked edge. These are boolean checks, not tolerances.
- **Trigger.** The presenter-companion watchdog fires the tape when any of these occurs: no first tool call within 20 s of a prompt; a turn exceeds its 45 s budget (30 s for the closing); two consecutive validation errors on the same step; a tool call outside the step's allowed set; the presenter presses `F9`.
- **Execution.** The tape driver runs as `agent:claude-code` with `on_behalf_of: user:brice`, not as a privileged replay account. It calls the same MCP endpoint over the same transport. Audit rows carry `source: "tape"` and the tape ID. The wall shows a "driver-authored, step n of 5" label, so the switch is visible on screen to anyone who looks, and the screen receives the same change events.
- **No typed prose.** The tape types nothing into the terminal. The terminal overlay, when enabled, shows tool-call lines and the real responses, labelled as driver-authored. Agent reply text is not replayed, because a replayed reply would present pre-written prose as live output.
- **Refusal.** If a precondition fails, the tape stops before the step's first call and the companion shows `reset required: run parapet demo reset`. A wrong screen is worse than a pause.
- **Staging.** The fault is staged by reset, and the wall says so. If the `payments` path is unavailable, the staging note records that the scripted `ops-maint` fallback is in use, and the lock-graph panel is labelled with the holder's `application_name`, which then reads `ops-maint`.

---

## D. Technical architecture

### D.1 Components

| Component | Responsibility | Implementation |
|---|---|---|
| `web` | React single-page app: wall, dashboard editor, panel renderer, policy and audit views | React 19, TypeScript, Vite, TanStack Query for server state, Zustand for local UI state, react-grid-layout, Apache ECharts for charts, uPlot for dense time series |
| `api` | HTTP API (OpenAPI generated from spec schemas), command layer, query endpoints | Node.js 22, TypeScript, Fastify, Kysely for SQL |
| `mcp` | MCP server, same process as `api` by default, separately deployable | `@modelcontextprotocol/sdk` (Streamable HTTP and stdio), same handlers as `api`, generated from the tool registry |
| `gateway` | WebSocket fan-out from the change log, per-subscriber policy re-check, presence | Node.js, `ws`, reads the change log by sequence with a 100 ms baseline poll and LISTEN wake-ups locally |
| `worker` | Alert evaluation, workflow runs, outbox relay, approval application | Node.js, Postgres-backed queue (`SKIP LOCKED`). PDF rendering is a cut candidate (H.6). |
| `policy` | Cedar evaluation library, bundle loading and versioning | `@cedar-policy/cedar-wasm`, in-process in `api`, `mcp`, `gateway` and `worker` |
| `ingest` | OTLP receiver for metrics, traces and ops events | OpenTelemetry Collector forwards to `api`'s `/otlp` route |
| `orderflow` | Demo estate: `checkout`, `payments` (with the reconciliation path), `inventory`, load generator, fault scheduler | Node.js services, PostgreSQL, seeded generator |
| `db.locks` collector | Samples `pg_locks`, `pg_stat_activity` and `pg_blocking_pids` into an observation source | Small Node process in the estate |
| `companion` | Presenter-only control surface: watchdog, tape driver, reset, approval shortcut | Small Node process with a local UI, not on the audience's screens |
| `db` | System of record and the demo's data sources | PostgreSQL 16 (Aurora PostgreSQL on AWS, container locally) |
| `objects` | Exports, uploaded CSVs, snapshots, report renders | S3 (MinIO locally) |

### D.2 Why these choices

- **TypeScript on Node.js for the core.** One language across the spec validator, the UI, the MCP server and the HTTP API lets one Zod schema drive browser validation, server validation, the MCP `inputSchema` and the OpenAPI document. Duplicated validators are the usual source of disagreement between surfaces.
- **PostgreSQL as the single datastore.** Row-level security, the transactional outbox, `SKIP LOCKED` queues and LISTEN/NOTIFY are all needed, and all are in one engine, so a command commits atomically.
- **Cedar for policy.** Cedar has a formal semantics, a small evaluation core and an analyzer. Its WASM build runs in-process, so there is no policy service on the evaluation path.
- **Postgres RLS driven by the same policy.** Cedar decides; the database enforces. The application derives row predicates from the decision, sets them as transaction-local session variables, and the RLS policies read them. The application role is not the table owner, and the tables are forced under RLS (D.3), so application bugs cannot widen results.
- **Structured spec, no generated code.** Dashboards are data. They are diffable, mergeable, auditable, validatable and safe for an agent to produce.

### D.3 Persistence model (key schemas)

All tables live in the `parapet` schema, with `tenant_id` on every row. Tables are owned by `parapet_owner` (NOLOGIN). The services connect as `parapet_app`, which is not the owner and does not have `BYPASSRLS`. Every tenant-scoped table has `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.

```sql
-- Commit counter: the serialisation point for the change log.
CREATE TABLE change_seq (
  tenant_id uuid PRIMARY KEY,
  last_seq  bigint NOT NULL DEFAULT 0
);

-- One row per document, the current head.
CREATE TABLE document (
  tenant_id uuid NOT NULL,
  id        text NOT NULL,                 -- dsh_01J8..., qry_..., alr_..., apr_...
  kind      text NOT NULL CHECK (kind IN ('Dashboard','Panel','Query','Metric','Alert','Workflow','Form','Grant','Template','Approval')),
  rev       bigint NOT NULL,
  spec      jsonb NOT NULL,                -- validated against spec v1 for kind
  spec_hash bytea NOT NULL,                -- BLAKE3 over canonical JSON
  owner     text NOT NULL,
  branch    text NOT NULL DEFAULT 'main',
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- Immutable snapshot, one per commit.
CREATE TABLE document_version (
  tenant_id uuid NOT NULL, doc_id text NOT NULL, rev bigint NOT NULL,
  spec jsonb NOT NULL, spec_hash bytea NOT NULL, change_seq bigint NOT NULL,
  PRIMARY KEY (tenant_id, doc_id, rev)
);

-- Append-only, hash-chained change log. seq is dense and in commit order.
CREATE TABLE change_log (
  tenant_id     uuid NOT NULL,
  seq           bigint NOT NULL,           -- assigned from change_seq under its row lock
  change_id     uuid NOT NULL UNIQUE,
  doc_id        text NOT NULL,
  base_rev      bigint, new_rev bigint,    -- new_rev NULL for denied attempts
  command       text NOT NULL,             -- 'dashboard.plan', 'plan.apply', 'undo', 'denied', ...
  ops           jsonb NOT NULL,
  inverse_ops   jsonb NOT NULL,
  actor         text NOT NULL,             -- 'user:brice', 'agent:claude-code', 'service:payments'
  on_behalf_of  text,
  source        text NOT NULL CHECK (source IN ('ui','http','mcp','tape','worker','ingest')),
  plan_id       uuid,
  approval_id   text,
  decision_ids  text[] NOT NULL,
  policy_bundle_version text NOT NULL,
  prev_hash     bytea NOT NULL,
  entry_hash    bytea NOT NULL,            -- hash of (prev_hash || canonical entry)
  created_at    timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, seq)
);

-- Plans are inspectable, expire, and apply at most once.
CREATE TABLE plan (
  tenant_id uuid NOT NULL, id uuid PRIMARY KEY,
  doc_ids text[] NOT NULL,
  base_revs jsonb NOT NULL,                -- per document
  command text NOT NULL, ops jsonb NOT NULL,
  diff jsonb NOT NULL, validation jsonb NOT NULL, decisions jsonb NOT NULL,
  after_hash bytea NOT NULL, plan_hash bytea NOT NULL,
  policy_bundle_version text NOT NULL,
  principal text NOT NULL, on_behalf_of text,
  status text NOT NULL CHECK (status IN ('previewed','held','awaiting_approval','applied','expired','superseded')),
  expires_at timestamptz NOT NULL,         -- 5 min ordinary, approval TTL when gated
  applied_change_id uuid
);

-- Approval requests bind a human decision to one plan hash.
CREATE TABLE approval (
  tenant_id uuid NOT NULL, id text NOT NULL,   -- apr_...
  plan_id uuid NOT NULL REFERENCES plan(id),
  plan_hash bytea NOT NULL,                    -- the exact plan approved
  route text NOT NULL,                         -- 'approval:security'
  requested_by text NOT NULL,                  -- 'agent:claude-code'
  on_behalf_of text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','approved','denied','expired','stale','applied')),
  decided_by text, decided_at timestamptz,
  expires_at timestamptz NOT NULL,             -- approval TTL, 30 min
  applied_change_id uuid,
  PRIMARY KEY (tenant_id, id)
);

-- Idempotency for applies.
CREATE TABLE idempotency (
  tenant_id uuid NOT NULL, key text NOT NULL, principal text NOT NULL,
  change_id uuid NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, principal, key)
);

-- Observations (not changes): lock waits and ops events.
CREATE TABLE lock_observation (
  tenant_id uuid NOT NULL, ts timestamptz NOT NULL, pid int NOT NULL, blocked_by int[] NOT NULL,
  relation text, application_name text, granted boolean NOT NULL, query_hash bytea
) PARTITION BY RANGE (ts);

CREATE TABLE ops_event (
  tenant_id uuid NOT NULL, ts timestamptz NOT NULL, emitter text NOT NULL,   -- 'service:payments'
  kind text NOT NULL, attributes jsonb NOT NULL
);

-- Policy-filtered metric storage used by the demo sources.
CREATE TABLE metric_point (
  tenant_id uuid NOT NULL, metric text NOT NULL, ts timestamptz NOT NULL,
  labels jsonb NOT NULL, value double precision NOT NULL
) PARTITION BY RANGE (ts);
CREATE INDEX ON metric_point (tenant_id, metric, ts);

-- Relations exposed as sources are declared, not discovered.
CREATE TABLE source_column (
  source_id text NOT NULL, relation text NOT NULL, column_name text NOT NULL,
  pg_type text NOT NULL, sensitivity text NOT NULL,   -- 'public','internal','pii','restricted'
  PRIMARY KEY (source_id, relation, column_name)
);
```

Policy bindings are stored as Cedar policy text in a `policy_bundle` table, versioned like documents. A row predicate is generated per tenant-scoped table from the bundle and installed as an RLS policy that reads `current_setting('parapet.principal')`, `current_setting('parapet.groups')` and `current_setting('parapet.row_scope')`, set with `SET LOCAL` inside each request's transaction.

### D.4 Query and transform engine

The query spec is the single representation of a data read.

```yaml
kind: Query
id: q_p99_by_service
source: metrics
select:
  - metric: latency_p99            # resolves a Metric document or a raw metric name
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

1. **Parse and validate** against spec v1. Unknown keys, wrong types and unknown fields produce structured errors (D.8).
2. **Resolve references.** `metric:` and `$param` references are substituted. Cycles are rejected.
3. **Authorize.** The Cedar decision for `(effective principal, source, read)` yields a row predicate and a column decision list. The effective principal for a query is the caller, or, with `as`, the intersection described in D.6. Forbidden columns are removed from `select` and `dimensions`; masked columns are replaced by their mask expression. A column the principal may not see and a column that does not exist produce the same error (D.8).
4. **Lower to SQL.** The IR becomes a parameterized statement. The row predicate is also bound by database RLS, so the policy applies twice; the second application is the guarantee.
5. **Execute** with `statement_timeout` and a row limit enforced in SQL. Result frames are columnar JSON.
6. **Transforms** that cannot be pushed down run in the engine over the frame, using the same pure functions the browser uses.

Joins are allowed only along relations declared in the source catalogue. Raw SQL is not an input to any surface the agent can reach.

### D.5 Real-time transport and collaborative model

- **Commit order.** A commit first takes the tenant's `change_seq` row with `SELECT ... FOR UPDATE`, assigns `seq = last_seq + 1`, writes the change and its document version, updates the head and commits. The row lock is the serialisation point. A second writer waits for the first to commit, so sequence numbers are dense and in commit order. A rolled-back commit does not advance `last_seq`, so there are no permanent gaps.
- **Change feed.** The gateway reads `change_log` rows with `seq > cursor` in order. Because commit order equals sequence order, a cursor can never skip a row that commits later. The 100 ms poll is the baseline on both environments; LISTEN only reduces latency. Measured target on the demo profile: change-to-screen under 300 ms at p95, labelled as a design target to verify in rehearsal.
- **Per-subscriber filtering.** For each event the gateway re-evaluates the subscriber's read decision on `doc_id`, with the bundle version carried on the event. Payloads carry `ops`, and the client re-fetches a document only if its local `rev` is behind.
- **Presence.** The gateway keeps `(principal, screen, doc, focused_node)` in memory, filtered by the viewer's read decision. Presence is never written to the change log.
- **Collaboration model.** Every write carries `base_rev` per document and per node. A plan whose base has moved returns `CONFLICT_REV` with the current node value. The model is optimistic and explicit. It is not a CRDT, and it never merges conflicting values automatically; a person or an explicit user choice resolves them.
- **Read-your-writes.** A session's reads go to the Aurora reader only when the reader's replay position is at or past the session's last committed write position; otherwise the writer serves the read (E.2).
- **Screens.** A screen is a principal bound to a browser session. `screen.show` writes presentation state, which the gateway delivers only to screens the actor may address. Interaction state (parameters, focused panel, page) lives in the URL and the session, not in documents, unless a person saves it.

### D.6 Authorization model

- **Principals.** `user:<id>` (OIDC subject), `group:<name>` (membership from IdP claims, re-read on each token refresh), `service:<name>`, `screen:<id>`, `agent:<name>` with `on_behalf_of:user:<id>`.
- **Agent ceiling.** The effective rights of an agent for a request are the intersection of (a) the agent's registration, (b) the delegating user's effective rights, and (c) the action's policy. The agent cannot widen (b). It reads its own ceiling only through `who.am_i`.
- **`as` is a narrowing operator.** A query run with `as: P` has effective rights `ceiling(agent) ∩ rights(P)`. If P's rights are not inside the agent's ceiling, the call is refused with `POLICY_DENIED` (`as_principal_outside_ceiling`). Every `as` use is written to the audit log with both principals.
- **Explanations are bounded.** `permission.explain` accepts the agent or its delegator as the principal. Explaining any other principal is an operation of the human UI and the HTTP API, performed as that human. The explanation for the finance board in C (70–95 s) is therefore a human-path call.
- **Actions.** `read`, `write`, `share`, `admin`, `export`, `execute`, `approve`. The agent registration excludes `admin`, `approve` and `embed` by policy. There is no tool that could call them.
- **Agent grants.** Agent-created `Grant` documents are capped at the delegator's rights. `editor` grants and grants to groups the delegator is not in require approval.
- **Attributes.** Principal: `department`, `region`, `clearance`, `groups`. Resource: `classification`, `owner`, `tenant`, `sensitivity` per column. Context: `source` (`ui`, `http`, `mcp`, `tape`, `worker`), `time`, `session`.
- **Policy examples** (Cedar, abbreviated):

```cedar
// Finance can read finance boards, within the row scope of the principal.
permit (principal in Group::"finance", action == Action::"read", resource in Dashboard::"finance")
  when { principal.region == resource.region_scope || resource.region_scope == "all" };

// Emails are never shown raw to principals outside the support group.
forbid (principal, action == Action::"read", resource is Column)
  when { resource.sensitivity == "pii" && !(principal in Group::"support") }
  advice { "column:customer.email masked to partial_email" };

// Agents may not read restricted HR data.
forbid (principal is Agent, action, resource in Source::"hr")
  when { resource.sensitivity == "restricted" }
  advice { "policy:hr-comp-restricted" };

// External notification always needs approval by a human in the security group.
forbid (principal, action == Action::"notify_external", resource)
  unless { context.approved_by in Group::"security" }
  advice { "approval:security" };
```

- **Row-level security.** Cedar produces a scope (a `row_scope` value, or a predicate over `region`, `tenant`, `owner`). The compiled predicate is installed as an RLS policy, so the database enforces it.
- **Explanation.** `permission.explain` returns the decision, every policy ID considered and the attributes that determined each. It is computed from the same evaluation as the decision, so it cannot drift from it.

### D.7 Audit, versioning, undo

- **Audit.** The change log is the audit log. It is append-only, hash-chained (`entry_hash` covers `prev_hash`), and written in the same transaction as the document change. Denied attempts are logged as rows with `new_rev = NULL` and command `denied`, so the audit shows attempts as well as effects. Denials are rolled up in the audit view.
- **Observations and ops events are not changes.** Lock waits from `db.locks` and reconciliation-start events from `ops.events` are separate sources. They can be queried and graphed, and they can be linked from the audit view, but undo does not revert them and the audit view says so.
- **Versioning.** Each commit creates a `document_version` row. Branches are named pointers over versions.
- **Undo as a batch inverse plan.** Each change stores `inverse_ops`, computed at plan time against the pre-state. `change.undo.plan` accepts a list of change IDs and builds one plan whose ops are their inverses, applied in reverse commit order. Each affected document gets its own change row linked to the change it reverses. Undo is subject to the same policy and concurrency checks. If a later change touched the same node, the plan returns `CONFLICT_REV` naming that later change. Undo is never silent and never partial.
- **Verification.** `parapet audit verify` recomputes the hash chain, checks that `seq` is dense, and recomputes `spec_hash` for every head. The rehearsal runs it after each run.

### D.8 MCP server design

#### Transport and identity

- Streamable HTTP at `/mcp` for remote agents; stdio for local development via `parapet mcp --stdio --token-file`.
- Authentication is OAuth 2.1 with the MCP authorization profile. The server is a resource server, publishes protected resource metadata (RFC 9728) and accepts tokens issued to a registered agent client. The registration fixes the ceiling. The token's `act` claim carries `on_behalf_of`.
- Every request is bound to a principal before any tool runs. There is no anonymous tier.

#### One tool registry

The tool registry is a single module. It generates `tools/list`, each tool's description and input schema, the HTTP routes that expose the same operations, and the tape's tool bindings. A rename or schema change is therefore one edit, and the tape pins each tool's name and `schema_hash`. A tape that does not match the registry fails at load.

#### Discovery

- `parapet.discover` lists capabilities (tool names, document kinds, sources, metrics) filtered by the effective principal. Fields the principal cannot use do not appear.
- Tool descriptions are short and server-owned. They do not vary by data, so a data value cannot change how the agent is told to use a tool.

#### Resources

| URI | Content | Size budget |
|---|---|---|
| `parapet://catalogue` | Policy-filtered capability list. | 32 KB |
| `parapet://spec/v1/{kind}` | JSON Schema for one document kind, with `$defs`, at most two examples and invariants written as descriptions. | 16 KB |
| `parapet://source/{id}` | Visible columns, types, masks and row scope for this principal. Hidden columns do not appear. | 16 KB |
| `parapet://metric/{id}` | Expression, unit, owner, upstream lineage. | 4 KB |
| `parapet://dashboard/{id}` | Current spec, `rev`, `spec_hash`, and the node IDs the agent can address. | 64 KB |
| `parapet://change/{id}` | One change: ops, inverse, actor, decisions. | 8 KB |
| `parapet://me/effective` | Effective ceilings, rate budget and approval routes. | 4 KB |
| `parapet://screen/{id}/state` | What the screen shows, as the gateway knows it. | 4 KB |

`schema.describe` returns one kind or one `$defs` entry, at most 8 KB. Responses above a budget are truncated with a pointer to the resource, and the rehearsal records any truncation.

#### Tool catalogue

All signatures are JSON-schema-shaped TypeScript. Read tools have no side effects. Write tools exist only in the `.plan` form, which never commits. The single commit tool is `plan.apply`.

```ts
// ---- Self-description (read) ----
who.am_i(): { principal: string; on_behalf_of?: string; ceilings: Ceiling[]; rate: RateBudget };
parapet.discover(input: { topic?: "panels" | "sources" | "metrics" | "documents" | "actions";
                          detail?: "summary" | "full" }): { capabilities: Capability[]; schema_version: "v1" };
schema.describe(input: { ref: string }): { json_schema: object; examples: object[]; invariants: string[] };
source.describe(input: { source: string; relations?: string[] }): {
  relations: { name: string; columns: { name: string; type: string; visible: "full" | "masked"; mask?: string }[] }[];
  row_scope: string;   // hidden columns are not listed and not described
};

// ---- Reading ----
query.preview(input: { query: QuerySpec | { ref: string }; as?: string; limit?: number /* <=200 */; explain?: boolean }): {
  columns: ColumnMeta[]; rows: unknown[][]; row_count: number; visible_row_estimate?: number;
  masked_columns: string[]; cost: { rows_scanned: number; ms: number }; data_digest: string;
};
query.run(input: { query: QuerySpec | { ref: string }; as?: string }): { result_id: string; row_count: number; truncated: boolean };
audit.search(input: { actor?: string; on_behalf_of?: string; source?: string; resource?: string;
                      decision?: "permit" | "forbid" | "approval_required" | "denied"; session?: "current";
                      since?: string; until?: string; limit?: number }): { entries: ChangeEntry[]; next?: string };
lineage.trace(input: { ref: string; direction: "upstream" | "downstream"; depth?: number /* <=6 */ }): {
  nodes: { id: string; kind: string }[]; edges: { from: string; to: string; via: string }[];
};
permission.explain(input: { principal: "agent" | "delegator"; resource: string; action: string }): {
  decision: "permit" | "forbid" | "approval_required"; policy_ids: string[];
  attributes: Record<string, string>; approval_route?: string;
};
changes.recent(input: { since: string; scope?: string; limit?: number }): { changes: ChangeEntry[] };
anomaly.explain(input: { series: string; window: string }): {
  change_points: { ts: string; magnitude: number }[];
  contributors: { dimension: string; value: string; share: number }[];
  summary: string;   // templated from the fields above, no model
};
approval.status(input: { approval_id: string }): { status: "pending" | "approved" | "denied" | "expired" | "stale" | "applied" };

// ---- Writing: plan only ----
dashboard.plan(input: { dashboard_id?: string; base_revs?: Record<string, number>; spec?: DashboardSpec; ops?: PatchOp[] }): PlanResult;
query.plan(input: { query: QuerySpec; name: string; base_rev?: number }): PlanResult;
metric.plan(input: { metric: MetricSpec; base_rev?: number }): PlanResult;
alert.plan(input: { rule: AlertSpec }): PlanResult;
workflow.plan(input: { workflow: WorkflowSpec }): PlanResult;   // step types checked, see table below
form.plan(input: { form: FormSpec }): PlanResult;
share.grant.plan(input: { resource: string; principal: string; role: "viewer" | "editor"; expires?: string }): PlanResult;
annotate.plan(input: { panel: string; ts: string; text: string }): PlanResult;
change.undo.plan(input: { change_ids: string[] }): PlanResult;
permission.propose(input: { resource: string; change: PolicyDelta; reason: string }): {
  approval_request_id: string; status: "pending";   // creates a request only; no tool resolves it
};
type PlanResult = {
  plan_id: string; plan_hash: string; after_hash: string; base_revs: Record<string, number>;
  expires_at: string; diff: NodeDiff[]; validation: ValidationResult; decisions: Decision[];
  approval_request_id?: string;   // present when a decision is approval_required
};

// ---- The one commit ----
plan.apply(input: { plan_id: string; plan_hash: string; idempotency_key: string }): {
  change_ids: string[]; docs: { doc_id: string; new_rev: number }[]; replayed: boolean;
  approval_id?: string;
};

// ---- Presentation (screens, not documents) ----
screen.show(input: { target: { dashboard?: string; panel?: string; params?: object }; screens: "all" | string[] }): {
  delivered: number; skipped: { screen: string; reason: string }[] };
screen.focus(input: { screen: string; node_id: string; highlight?: boolean }): { delivered: boolean };
```

**Deliberate omissions from the agent surface.** No commit mode on any tool. No tool creates or resolves approvals, changes policy bundles, creates principals, mints embed tokens, edits the `http_call` allowlist or accepts raw SQL, scripts or URLs for fetching. `permission.propose` creates a request only.

**Workflow step checks at `workflow.plan`.**

| Step type | Agent rule |
|---|---|
| `notify` to a group | Allowed when the group is inside the agent's ceiling. Routes outside the platform require approval. |
| `notify` to an external endpoint | Requires approval (`approval:security`). |
| `set_param` | Allowed on parameters the agent may write on the target dashboard. |
| `form_write` | Allowed only on declared relations for which the agent holds `write` inside its ceiling. |
| `approval` | Allowed. |
| `http_call` | Refused for agents with `POLICY_DENIED`. Humans with `admin` edit the allowlist and create these steps. |

#### Preview, apply and approvals

- A `.plan` call runs validation, policy evaluation and diff without touching storage, and writes only a `plan` row. The plan's `plan_hash` covers the canonical after-state, the base revisions per document and the decision IDs, and the `policy_bundle_version`.
- `plan.apply` re-checks: the plan is unexpired, every document head equals its `base_revs`, and the policy bundle version is unchanged. Any failure returns a structured error and writes nothing.
- **Plan TTL.** Ordinary plans expire after 5 minutes. A plan with an `approval_required` decision is held for the approval TTL of 30 minutes, and the plan's status is `awaiting_approval`.
- **Approvals.** A `forbid` decision with `approval_required` creates an `approval` row bound to the plan's `plan_hash`, the approval route and the requesting principal. A human in the route's group approves the row in the UI or the HTTP API, as that human. Approval is an operation of the human principal only; no agent tool resolves it.
- **Resume path.** On approval the worker applies the held plan through the command layer as the plan's principal (`agent:claude-code`, `on_behalf_of: user:brice`), recording `approved_by` and `approval_id` on the change row. Before applying it re-checks base revisions and the bundle version. If a base has moved, the approval becomes `stale` and the agent receives `APPROVAL_STALE`; it must re-plan, and a new approval is needed. If the approval TTL passes, the status is `expired`, and the agent is told to re-plan.
- **Idempotency.** `plan.apply` requires `idempotency_key`. The pair `(principal, key)` is stored with the resulting change IDs for 24 hours. A repeat returns the same response with `replayed: true`. The agent's default key is derived from `plan_id`, which the agent is told to reuse.
- **Single application.** A plan applies at most once. A second apply of the same plan with a different key returns `PLAN_ALREADY_APPLIED` with the change IDs.

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
    "doc": "parapet://spec/v1/Dashboard#/$defs/TimeseriesOptions"
  }
}
```

| Code | Meaning | Agent behaviour |
|---|---|---|
| `VALIDATION_UNKNOWN_FIELD`, `VALIDATION_TYPE`, `VALIDATION_ENUM`, `VALIDATION_REF` | Spec does not match schema, or a reference does not resolve | Fix at `path` using `did_you_mean` or `valid_values`, then re-plan |
| `NOT_FOUND` | Source, metric, node or document does not exist, or is not visible to the principal | Choose from the `nearest` list |
| `CONFLICT_REV` | A base revision moved | Re-read the resource. Do not merge values; report the current value and ask for a choice |
| `PLAN_EXPIRED`, `PLAN_HASH_MISMATCH`, `PLAN_ALREADY_APPLIED` | Plan no longer applies | Re-plan; do not reuse |
| `APPROVAL_REQUIRED` | Action is permitted after approval | Report `approval_request_id` and wait for `approval.status` |
| `APPROVAL_STALE`, `APPROVAL_EXPIRED` | Approved plan no longer applies | Re-plan; a new approval is needed |
| `POLICY_DENIED` | Policy forbids the action, or a column is not visible | Do not retry. Report `policy_ids` |
| `RATE_LIMITED` | Budget exhausted | Honour `retry_after_ms` |
| `QUERY_BUDGET_EXCEEDED` | Estimated cost over budget | Narrow the window or add a filter |
| `TIMEOUT` | Execution exceeded `timeout_ms` | Narrow the query; retry at most once |

**Denial shape.** `POLICY_DENIED` returns the column name as requested, the policy ID, the principal and `on_behalf_of`. It never returns restricted values, sensitivity classes or column type. For a column the principal may not see, the response is the same whether the column exists or not, so the refusal does not reveal the schema behind it. The policy ID shown is the source-level policy that governs the relation for this principal, which is also visible through `permission.explain` for the delegator.

#### Rate limits and budgets

- Reads: 120 per minute per principal. Writes (`.plan` and `plan.apply`): 30 per minute. Each query consumes cost units from a per-principal budget reset per minute. These are configured limits, not measurements.
- Agent principals carry the lower of their own budget and their delegator's.

#### Prompt-injection considerations

- **Data is untrusted.** Every value returned by a query is inside a `data` envelope with `"trust": "untrusted_data"` and its field source. Titles and Markdown from data sources are sanitized server-side. The MCP server never places data into tool descriptions or resource URIs.
- **No instructions from data.** A title or cell value that reads "ignore previous instructions" is stored and rendered as a string. The only actions it can cause are ones the principal could already take.
- **No privilege from content.** The agent cannot change its own grants, registration, the policy bundle, or the `http_call` allowlist. Those surfaces are not in the catalogue.
- **Egress is closed by default.** `http_call` is human-only. External notification requires approval (D.6).
- **No raw query surface.** A query referencing an undeclared relation fails at validation.

### D.9 Frontend specifics

- The wall is a route with a `screen` identity. It subscribes to a shared dashboard and accepts `screen.show` and `screen.focus`.
- Panels render from result frames. Cross-filter events are local interactions that write parameter values; parameter values are part of the URL and of embed tokens.
- The editor applies patches through the same `.plan` and `plan.apply` path as the agent. A human's edit is a plan with `source: "ui"`, so there is no separate UI write path.
- **Visible refusals.** A `POLICY_DENIED` attempt by an agent appears as a denied slot where its panel would have been, with the policy ID and the principal, and in an activity rail on every window. Denied data is never drawn.
- **Conflict cards.** A `CONFLICT_REV` renders as a card with the current value, the proposed value and the choices the human has. The UI does not offer an automatic merge of exclusive properties.
- **Graph and heatmap.** The lock-wait graph draws backends as nodes and blocked-by edges from `lock_observation`. The heatmap draws the latency frame by service and minute. Both are renderers over result frames.

---

## E. AWS and local deployment

### E.1 Shared principles

- **One set of images.** `parapet-api`, `parapet-gateway`, `parapet-worker`, `parapet-web`, `parapet-orderflow-*`, `parapet-dblocks` and `parapet-companion` are built once in CI, tagged with the git SHA, and referenced by digest. Local and AWS run the same digests.
- **Configuration by environment only.** Endpoints, issuer URLs, bucket names and secrets come from the environment and secret references.
- **Migrations are a one-shot task** from the `parapet-api` image with a `migrate` entrypoint. The same migration files run locally and on AWS.
- **Database roles.** `parapet_owner` owns the tables and is NOLOGIN. `parapet_app` is the services' login role, is not the owner, and lacks `BYPASSRLS`. Both are created by migrations.
- **`parapet doctor` checks** the parameters and roles that the guarantees depend on: the application role is not the table owner and is not a superuser and lacks `BYPASSRLS`; every tenant table has `relrowsecurity` and `relforcerowsecurity` set; `statement_timeout` is set as configured; the change-sequence row exists for each tenant; the demo's hold window covers the run when the demo profile is selected. Doctor fails closed on any of these.
- **Cloud integrations sit behind interfaces**: `ObjectStore`, `IdentityProvider`, `Telemetry`, `Mailer` and `Secrets`. Each has an S3, Cognito, ADOT, SES or Secrets Manager implementation and a local implementation.

### E.2 AWS

| Concern | Service |
|---|---|
| Compute | ECS on Fargate, one service per image |
| Load balancing and TLS | Application Load Balancer, ACM certificate, path routing for `/`, `/api`, `/mcp`, `/ws` |
| Database | Aurora PostgreSQL 16 with RLS enabled. A reader endpoint serves a session's reads only when the reader is at or past that session's last write position (read-your-writes watermark); otherwise the writer serves the read. |
| Identity | IAM Identity Center or the customer's IdP via OIDC, federated into Amazon Cognito for the token issuer, or a direct OIDC issuer |
| Object storage | S3 with SSE-KMS and bucket policies that deny unencrypted transport |
| Secrets | Secrets Manager, referenced by ARN from task definitions |
| Telemetry | ADOT collector sidecar, exporting to CloudWatch and the platform's own OTLP route |
| Email | SES for alert emails and scheduled reports |
| Edge protection | AWS WAF on the ALB; rate limits on `/mcp` enforced by WAF and by the application |
| Scheduling | Worker service with an internal queue; no EventBridge dependency in the core path |

### E.3 Local

| Concern | Local stand-in | Documented difference |
|---|---|---|
| Compute | Docker Compose with the same images | No autoscaling; single host |
| TLS and routing | Caddy with a local CA, same path routes | Certificate chain is local |
| Database | `postgres:16` container with the same migrations and roles | No failover; no reader endpoint, so reads go to the writer. The watermark rule still runs and its test passes trivially. |
| Identity | Keycloak with a demo realm carrying the same groups and attributes as the AWS fixture | Keycloak is a test IdP; the OIDC contract is identical |
| Object storage | MinIO (S3 API) | Same SDK calls; no KMS |
| Telemetry | `otel/opentelemetry-collector-contrib`, same config file | Local exporters |
| Email | Mailpit (SMTP) | Captures mail instead of sending |
| Secrets | Compose secrets files | Same reference syntax, different backing |
| Load generator | Same `orderflow` image | Same seed, same profile |

The reader-lag difference is documented in both tables. It is the only place where the AWS path has behaviour the local path does not exercise, and the test `reader.watermark` (F.3) runs against a forced replica lag on AWS and against an injected lag locally.

### E.4 Why behaviour is unchanged

Behaviour is defined by the contracts the services observe: the HTTP and MCP surface, the change log, the Cedar bundle, the RLS policies and the query semantics. Those live in the images and migrations. The rehearsal runs the same script on both deployments and compares the canonical final state hash. The hold window, the reconciliation path and the staging note are part of the images and the fixture, so the fault is identical on both deployments.

### E.5 How the MCP server is exposed

- **AWS.** `https://<demo-domain>/mcp` behind the ALB. The `api` service validates bearer tokens as an OAuth 2.1 resource server against the issuer's JWKS and publishes protected resource metadata at `/.well-known/oauth-protected-resource`. The agent is registered with a client ID and a ceiling. Claude Code connects with `claude mcp add --transport http parapet https://<demo-domain>/mcp`, then completes the OAuth flow in a browser.
- **Local.** `https://parapet.localhost:8443/mcp` through Caddy, with the same paths, the same resource metadata and Keycloak as the issuer.
- **Stdio (both).** `parapet mcp --stdio --token-file <path>` for development and as a fallback if HTTP is unreachable on stage. The agent token is long-lived, issued to the presenter's agent registration, and stored with restrictive file permissions.

---

## F. Six technical claims

Each claim has an executable test or an observable behaviour. Test names are the ones the suite will use.

### F.1 The agent is bound by the same authorization as the humans, on every surface

**Claim.** For any principal and any query, the rows and columns returned by the UI, the HTTP API and `query.run` over MCP are identical. An agent's result is a subset of its delegator's result. An `as` query returns at most the intersection of the agent's ceiling and the named principal's rights.

**Test.** `authz.parity.property`: generate 200 random `(principal, query)` pairs over a fixed fixture (3 groups, 2 regions, 10,000 orders, 1,000 customers with email). For each pair run the query through the HTTP route, through the MCP tool with the principal's token, and as a direct SQL session with the RLS settings the policy derives. Assert equal row sets and column lists. For agent principals, assert `mcp_rows ⊆ delegator_rows`. Add `as.narrowing`: for 100 random `as` principals inside the ceiling, assert the result equals the intersection; for 100 principals outside the ceiling, assert `POLICY_DENIED` and an audit row with both principals. Add `denial.indistinguishable`: for hidden and absent columns, assert the response bodies are equal except for the echoed column name. Two failing seeds are kept as fixtures.

**Observable.** At 215–245 s the denial is produced for the agent and would be produced for Brice in the UI, with the same policy ID. The rehearsal checks that both denials carry the same policy ID. At 160–200 s the finance window's own count of 412 rows comes from its own query, and the rehearsal checks it against the direct SQL count for `finance-analyst`.

### F.2 A plan is exactly what is applied, and a stale plan cannot be applied

**Claim.** The document that `plan.apply` writes has the `after_hash` the plan reported. A plan whose base revision has moved is refused, and a held plan is refused for the same reason.

**Test.** `plan.apply.exactness`: 1,000 random patch sequences over generated dashboards. For each, `.plan` → record `after_hash`; `plan.apply` → recompute the canonical hash of the stored head; assert equality. For 200 of them, apply a second change to the same document between plan and apply and assert `CONFLICT_REV`, no change row and no head modification. Zero mismatches is the pass condition. Add `held.plan.conflict`: a plan held across a human edit to the same node returns `CONFLICT_REV` with the human's value.

**Observable.** At 135–160 s the conflict card shows both titles, and the presenter's choice is the only change that lands. The audit shows the agent's plan, the conflict and the human choice, with no lost write.

### F.3 Undo is an exact inverse, and the change feed is commit-ordered

**Claim.** Any sequence of human and agent changes to a document can be undone back to its baseline canonical hash. The change log's hash chain and sequence verify after every operation. The change feed never skips a committed change.

**Test.** `undo.inverse.roundtrip`: from a baseline dashboard, apply 50 interleaved changes from two principals (random ops, random sources), then undo them all in one batch and in reverse order in a second run. Assert the head `spec_hash` equals the baseline's in both runs. Run `parapet audit verify` after each step and assert no break in `entry_hash` continuity and no gap in `seq`. Undo of a change that conflicts with a later change returns `CONFLICT_REV`; the test injects 20 such cases and asserts all 20 are refused.

`changefeed.commit_order.two_tx`: open two transactions that each write one change to the same tenant. Commit the second first, then the first. Assert that the second's `seq` is greater than the first's, that the second cannot be observed by a gateway cursor before the first commits, and that a cursor at the first's `seq - 1` receives both in order. Repeat with a rollback of the first and assert `seq` has no gap afterwards.

`reader.watermark`: force replica lag above the session's write position (on AWS by pausing the replica's replay, locally by an injected delay) and assert the session's next read is served by the writer and includes its own write.

**Observable.** At 245–300 s the finance board and the alert revert live on the finance window, and the audit trail shows the undo rows linked to the changes they reverse.

### F.4 Hallucinated fields are refused before any write, with a correction the agent can use

**Claim.** The agent-facing schema rejects every malformed spec before any write, and for single-character typos the correction is the intended field.

**Test.** `mcp.errors.selfcorrect`: a corpus of 300 specs derived from valid ones with injected faults: unknown keys (150), wrong enum values (50), wrong types (50), unresolved metric references (30), and undeclared relations (20). Assert that all 300 are rejected at `.plan` with no change row and no applied plan. For the 150 unknown-key cases where the intended key is one edit away from the injected key, assert `did_you_mean` equals the intended key in at least 90 % of cases. The rehearsal records the number of retries the live model needed per step as a measured quantity.

**Observable.** If the model misnames a field during the 25–70 s prompt, the terminal shows the error and the corrected plan, and the presenter does not intervene. A step that exceeds two retries triggers the tape.

### F.5 The deterministic fallback reproduces the same platform state through the real MCP path

**Claim.** The tape driver, running as the agent principal through the MCP endpoint, produces the same exact normalised final state as the live agent's recorded run, on the local and the AWS deployment. It refuses to run on diverged state, before any call in the diverged step.

**Test.** `demo.rehearse.equivalence`: run the full script three times: once with the live agent recorded (calls saved), once with the tape, and once with the tape against a deliberately diverged state (an extra panel moved in the fixture). Assert that the first two produce equal normalised state hashes over dashboards, alerts, grants, approvals and change-log content, with timestamps, revisions and IDs replaced by tape bindings. Assert that the third run stops before the first call of the first diverged step with `reset required`, and writes nothing after that. Run the first two on the local and AWS deployments and assert equal hashes. Metric values are excluded from the hash; the shape assertions in C are checked separately in each run.

**Observable.** The presenter presses `F9` during rehearsal; the wall shows the same sequence of changes, the driver-authored label is visible, and audit rows read `source: tape`. The equality check is in the rehearsal report.

### F.6 An agent with no prompt tuning reaches the intended state within the platform's rules, and the surface is what the registry says

**Claim.** A general agent given only the server's tool descriptions and resources, without the demo's prompts or the tape, completes a held-out set of tasks inside the platform's rules, and the agent-visible surface contains no operations that the registry excludes.

**Pre-registration.** Before any run, the task set (20 tasks, each a single request over the orderflow estate with a stated end state), the pass criteria and the model version are committed to the repository. The criteria are not changed after the first run. The tasks are not the demo prompts.

**Pass criteria.**

- Zero writes outside the agent's ceiling. This is a hard criterion: one violation fails the evaluation.
- At least 16 of 20 tasks reach the stated end state within two retries per step, judged by the normalised state hash.
- Every refusal is reported with its policy ID, not paraphrased.

**Test.** `agent.surface.probe`: assert that `embed.token.create`, any commit-mode argument, any approval tool and any `http_call` creation are absent from `tools/list`, and that a direct call to each from an agent token returns an unknown-tool error. Assert that the registry's tool names match the tape's pins.

**Observable.** The evaluation report is published with the rehearsal report. It includes the measured number of retries, the number of refusals and the number of out-of-ceiling attempts. Those are measured quantities.

---

## G. Failure analysis

### G.1 Implementation difficulties

- **Double enforcement drift.** Cedar and RLS must agree. The RLS predicate is generated from the same bundle version, and F.1 runs on every bundle change. The Cedar analyzer checks for shadowed `forbid` rules on sensitive columns.
- **Column masking inside the projection.** Masks must not leak through aggregates or dimension values. A masked column cannot appear as a dimension or inside an aggregate unless the mask is `bucket` or `hash`; the compiler rejects other combinations with `VALIDATION_MASK`.
- **Denial as an oracle.** A denial that names a column can reveal that the column exists. The denial shape (D.8) and `denial.indistinguishable` (F.1) address this for columns; the source-level policy ID is the one thing that remains visible, and it is also visible to the delegator.
- **Commit serialisation.** The per-tenant counter row is a throughput limit. At the demo's configured load this is well inside the write rate, and the limit is labelled as a configured quantity, not a measurement. Multi-tenant deployments would need a per-tenant counter, which is the case already in the design.
- **Stable node IDs under templating.** Templates instantiate new dashboards, and IDs must not collide. Instantiation re-keys nodes and records the template lineage.
- **Real-time under concurrency.** Gateways must not deliver events for documents whose read policy changed after the event. Policy re-check at delivery, with the bundle version carried on each event, addresses this. Policy changes trigger a re-evaluation of open subscriptions.
- **Lock contention in the demo estate.** The reconciliation path holds ledger row locks by design. The investigation page's own queries use short `statement_timeout` values and read from the metrics and observation sources, not from the contended ledger rows. The lock panel is a separate query with its own timeout.
- **Aurora versus local Postgres.** Extension availability and parameter defaults can differ. The migrations use only core PostgreSQL 16 features, and `parapet doctor` checks the parameters that affect RLS and statement timeouts.

### G.2 On-stage failure modes and mitigations

| Failure | Consequence on screen | Mitigation |
|---|---|---|
| Model calls the wrong tool (for example `query.run` where `query.preview` was asked) | A result appears that the script did not plan | Read-only wrong calls do not change state. A call outside the step's allowed set triggers the tape. |
| Model hallucinates a field | Validation error; the agent corrects it | Self-correcting errors (F.4). Two consecutive failures trigger the tape. |
| Model invents a metric name | `NOT_FOUND` with `nearest` | Metric list is discoverable. |
| Model is slow to make its first call | No first call within 20 s | Watchdog triggers the tape. The presenter also has `F9`. |
| Model turn exceeds its budget | Turn over 45 s | Watchdog triggers the tape for the remainder of the step. The rehearsal records each turn's time. |
| Model sends a write the presenter did not intend | A change appears on the wall | No agent write commits without `plan.apply`. The presenter reads the plan line in the terminal before the apply step, which is also where the conflict is shown. |
| Network failure between laptop and platform | No tool responses | Stdio transport fallback (E.5), and the tape can target a local endpoint. |
| SSO token expiry during the demo | Login prompt on a window | Demo principals have token lifetimes longer than the demo; the rehearsal checks this. |
| Gateway reconnect | A screen shows stale data | Screens resume from their last `seq`; the gateway replays missed events from the change log. A "live" indicator turns to "reconnecting". |
| Fault not present or hold window too short | Spike or waiters absent | Reset refuses to report ready. Waiters are asserted at each step, so a window that ends mid-script fails the rehearsal rather than the audience. |
| Browser sessions desynchronize | Windows show different states | The rehearsal compares each window's `rev` with the head at the end of each step. |
| Approval applied to a moved base | Wrong state | Re-check at apply; `APPROVAL_STALE` (D.8). |

### G.3 Hidden complexity

- **Idempotency across retries.** An agent that loses its connection after apply may generate a new key and create a duplicate. The default key is derived from `plan_id`, and the agent is told to reuse it.
- **Presence versus permission.** Presence is filtered by the viewer's read decision, so the agent's focus on a restricted node is not shown to viewers who cannot read it.
- **Time.** The demo reads "last fifteen minutes" relative to now. The tape binds timestamps from live responses. The rehearsal runs in a fixed timezone.
- **Reproducible randomness.** The load generator, the fault scheduler and the fixture generator share one seed, with RNG streams separated per component.
- **Audit volume.** Denied attempts are logged and can accumulate in an agent loop. Rate limits bound this, and the audit view rolls them up.

### G.4 Honest list of shallow features and known limitations

- **Collaborative editing.** Node-level optimistic concurrency with presence and structured conflicts, not a CRDT. Two editors on one text field lose one edit, and the conflict says so. The on-stage moment is about explicit conflicts resolved by a person.
- **Anomaly detection.** A rolling robust z-score, a penalty-based change-point search and a contributor decomposition. Deterministic and useful, not a learned model; it is not described as ML.
- **Anomaly explanations.** The `summary` is a template filled with computed facts. It does not claim causation.
- **Lineage.** Derived from query IRs and metric definitions inside Parapet. It does not parse SQL in external databases and cannot see undeclared lineage.
- **Lock observations and ops events are not changes.** Undo cannot revert them, and the audit view labels them as observations.
- **Embedding.** Signed, parameter-locked tokens with a pinned version, minted by humans. No embedding SDK, theming API or cross-origin bridge beyond parameter reads.
- **Forms that write back.** Limited to closed write operations on declared relations.
- **Workflow engine.** A closed step registry with a state machine. No branching DSL, no loops and fixed backoff only.
- **Scheduled reports.** CSV first. The PDF render is a cut candidate, and where it exists it is a render of a dashboard, not a pixel-exact export.
- **Multi-tenancy.** Enforced by `tenant_id` and RLS. The demo runs one tenant, and a second tenant appears only in fixtures that exercise isolation tests. Accepted as a known limitation. Tenant administration is not shown.
- **SSO and provisioning.** The local realm is a test IdP. The OIDC contract is real. There is no SAML and no SCIM provisioning. Accepted as a known limitation.
- **Tenant administration UI.** Not built for the demo. Accepted as a known limitation.
- **Undo scope.** Undo reverts changes made through Parapet. It cannot revert the reconciliation job's locks, the `ops.events` rows or anything outside the platform, and the audit view says so.
- **Screens.** A screen is a browser session with a principal, not a managed display fleet.
- **Read-your-writes on AWS.** Served by the watermark rule. A replica that has not caught up is bypassed, which costs read latency on the reader path during lag.

---

## H. Feasibility

Feasibility is expressed by what each component touches and by dependency order. No durations are given.

### H.1 Scope by component

| Component | What the work touches | Depends on |
|---|---|---|
| Spec schemas and validator (Zod, JSON Schema export), tool registry | Document kinds, error shape, `did_you_mean`, tool names and schema hashes | none |
| Database schema, roles, migrations, RLS generator | `document`, `document_version`, `change_seq`, `change_log`, `plan`, `approval`, `idempotency`, observations, `metric_point`, `source_column` | spec schemas |
| Command layer (plan, plan.apply, idempotency, hash chain, counter lock) | Single write path, canonical hashing, outbox, approvals | database schema |
| Policy engine (Cedar bundle, decisions, explanations, `as` intersection) | Bundle loader, evaluator, `permission.explain` bounds | command layer |
| Query engine (IR, compiler, transforms, column masks, denial shape) | Parser, reference resolver, SQL lowering, pure transform functions | policy engine, database schema |
| `orderflow` estate and `db.locks` collector | Three services, load generator, reconciliation path, observation sampler, fixtures | database schema |
| HTTP API | Routes generated from the command and query layers | command layer, query engine |
| MCP server | Registry-generated tools, discovery, resources, error mapping, OAuth resource metadata | HTTP handlers, policy engine |
| Change feed and gateway | Commit-ordered cursor reads, per-subscriber filter, presence | change log, policy engine |
| Web UI: wall, panels (including graph and heatmap), editor, conflict and denial cards | React app, grid, renderers | HTTP API, gateway |
| Workflows, alerts, approvals application | Worker, queue, closed step registry, held-plan application | command layer, policy engine, query engine |
| Undo and audit verification | Batch inverse plans, verify command | command layer, change log |
| Tape driver and companion | Tape format, watchdog, exact preconditions, registry pins | MCP server, rehearsal runner |
| Rehearsal runner and agent evaluation | Headless browsers, state-hash comparison, pre-registered task set | everything above, plus the tape |
| Local compose and AWS deployment | Compose files, ECS, ALB, Aurora, Cognito | images, migrations, interfaces |
| Supporting (embedding, scheduled reports, templates, branching, comments) | Token issuer, CSV export, template instantiation, branch pointers | command layer, versioning |

### H.2 Critical dependencies

- **Cedar and RLS agreement** gates every read path. It is the first integration test that must pass, before the query engine is trusted.
- **The commit counter and the command layer** gate every write path, including the agent's. A second write path would violate the architecture.
- **The reconciliation path and the observation collector** gate the central moment. They are validated before the agent is involved, so the wall has real data from the first rehearsal.
- **The tool registry** gates the MCP server and the tape. Names and schema hashes are frozen before the tape is recorded.
- **The approval table and resume path** gate the 185–200 s step.
- **Keycloak realm and OIDC issuer contract** gate every authenticated test, and the MCP OAuth flow depends on the same issuer.

### H.3 Main risks

1. **Scope breadth.** The inventory has 45 rows. Each row must be reachable from the spec, the MCP tools and the UI, or it is cut. The composition rule is the cut criterion, and H.6 orders the cuts.
2. **Agent latency inside the choreography.** The model's latency is outside the platform. Mitigated by the watchdog, the per-turn budgets, five prompts, held plans and the tape.
3. **Cedar and RLS drift.** Mitigated by F.1 and the analyzer. Highest-impact technical risk.
4. **Column masks leaking through aggregates.** Mitigated by the compiler rule (G.1). Requires adversarial tests.
5. **Real-time delivery under policy change.** Mitigated by per-event bundle version and re-evaluation.
6. **Visual polish across panel kinds.** Mitigated by one renderer contract; kinds are thin adapters over frames.
7. **Identical behaviour across AWS and local.** Mitigated by interface boundaries and the rehearsal comparison.

### H.4 Build sequence (dependency order, minimal vertical slice first)

The minimal vertical slice is one document kind, one source, one principal, one panel, one screen and one MCP tool. It is expanded only after it passes F.2 and F.4.

1. Spec v1 for `Dashboard` and `Query`, the validator, JSON Schema export and the tool registry skeleton.
2. Database schema, roles and migrations, including `change_seq`, `change_log` and `plan`. Gate: `doctor` passes on the roles and RLS flags.
3. Command layer: `dashboard.plan` and `plan.apply` with `base_revs`, `plan_hash` and idempotency. Gate: F.2 `plan.apply.exactness`.
4. Cedar bundle with the core rules, RLS generator, `permission.explain` and the `as` intersection. Gate: F.1 for two principals.
5. Query engine for the `metrics` source, with IR, compiler, masks, transforms and the denial shape. Gate: F.1 extended to HTTP and direct SQL.
6. `orderflow` estate with the reconciliation path, observation collector and reset command. Gate: reset reports the fault active and the waiters are visible.
7. HTTP API and gateway with the commit-ordered cursor. Gate: F.3 `changefeed.commit_order.two_tx`.
8. Web UI: wall, timeseries and stat panels, the editor on the plan path. Gate: a human edit and an API edit produce identical change rows.
9. MCP server over the same handlers, with discovery, resources, `.plan` and `plan.apply`, and the error shape. Gate: F.4 corpus passes. The live agent is first exercised here.
10. Undo batch plans and audit verification. Gate: F.3 round-trip passes.
11. Second source (`db.locks`, `ops.events`), graph and heatmap panels, drill-down links, cross-filter, presence, screen tools. Gate: the 25–135 s steps run with hand-written calls.
12. Approvals table, held plans, the resume path, workflow step checks and the external-notification policy. Gate: the 160–215 s steps run with the approval round trip.
13. Column masks in the finance view, row scope, and `as` narrowing. Gate: F.1 in full.
14. Conflict and denial cards, activity rail. Gate: the 135–160 s and 215–245 s steps render with their visible results.
15. Tape driver, watchdog, companion and the rehearsal runner. Tool registry pins recorded only after step 14 is stable. Gate: F.5 passes locally.
16. Agent evaluation (F.6) against the pre-registered task set.
17. AWS deployment of the same images, OAuth resource metadata, reader watermark, rehearsal on AWS. Gate: F.5 hash equality across deployments.
18. Supporting capabilities, each added only after the script is stable and each passing the composition rule.

### H.5 What is deliberately not in the build

- No LLM inside the platform, in any form, including for anomaly summaries.
- No raw SQL surface for agents or for embedding.
- No CRDT text editing and no automatic merge of conflicting values.
- No commit mode on any agent-facing tool, and no second write path.
- No canned UI animation in place of a real change, and no replayed agent prose.

### H.6 Ordered cut list

If the build runs short, cuts are taken in this order. Each cut names the claims it affects, so the cost of each cut is known before it is made.

| Order | Cut | Effect on the demo | Claims affected |
|---|---|---|---|
| 1 | PDF scheduled reports (CSV stays) | None on stage | none |
| 2 | Template instantiation and branching | None on stage | none |
| 3 | Comments and annotations | None on stage | none |
| 4 | Topology panel (keep graph and heatmap) | Lineage shown as text | F.3 unaffected; the lineage claim is weakened |
| 5 | `zscore` and `pivot` transforms (keep the anomaly tool with its server-side functions) | Anomaly marker simpler | none |
| 6 | Screen focus (`screen.focus`) | Presence still shown | none |
| 7 | Second data source `ops.events` (the reconciliation start event is shown in the audit view only) | Less context on the wall | F.5 hash shape reduced |
| 8 | Drill-down links from the p99 panel (replaced by a parameter set in the URL) | Drill-down step becomes a parameter change | none on the claims |
| 9 | Embedding | Not shown on stage | none on stage |
| 10 | Multi-tenant fixtures beyond the isolation test | None on stage | none on stage |
| 11 | Stdio fallback | Fallback path reduced | none |

Cuts that remove a claim are not in the list. Removing F.1, F.2, F.3, F.4 or F.5 is a change of product, not a cut, and it would require a new proposal.

---

*Word count: 15,688 whitespace-separated tokens, measured with `wc -w` on this file (tables, code blocks and markup included).*
