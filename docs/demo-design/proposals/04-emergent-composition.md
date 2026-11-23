# Tessera: an emergent-composition operations platform

Competitor 04. Mandate: **Emergent Composition**. Product title: **Tessera**.

Design thesis: Tessera has one document model, one change log, one query compiler, one authorization check and one real-time channel. Every dashboard, panel, data source, alert, workflow, form, permission rule, export and undo is a node in that model, expressed in one specification language. The MCP server exposes the same model through a small set of generic verbs, so an agent that has never seen Tessera before can compose capabilities that nobody wrote a feature for.

---

## A. Product concept

**What it is.** Tessera is a self-hosted, multi-tenant operations platform. A workspace holds data sources, a query layer, dashboards built from panels, rules that watch queries, workflows that react to rules, forms that write back, grants that control who sees what, and a complete history of every change. The web UI, the HTTP API and the MCP server are three views of the same document graph. None of them has a capability the others lack.

**Who uses it.** Three audiences, all served by the same primitives.

- Operations engineers who watch fulfilment and platform health and need drill-down during an incident.
- Platform and security staff who need to answer "who can see this, and what changed?" without reading code.
- Engineers and analysts who ask questions in plain language and expect a live answer as a panel, not as a paragraph.

The demo is aimed at the same engineers and architects the brief names. They are shown a system behaving correctly under concurrency, authorization and failure, not a chatbot.

**The data the demo is about.** Northwind Fulfilment is a fictional online retailer whose order pipeline runs in the demo. It is simulated by a deterministic program, not pulled from a paid or external service.

- A seeded generator (fixed PRNG seed, committed in the repository) emits order lifecycle events: placed, picked, packed, handed to carrier, delivered, returned. Each event goes to a Kafka topic (`northwind.orders.v1`). The generator also emits carrier scan events and warehouse capacity samples.
- The generator runs on a virtual clock that can be sped up. At a scripted offset in the demo, it injects a latency fault in one region and one carrier, so p95 fulfilment latency rises. The fault comes from the order events, not from a number written into a chart. Every dashboard figure is computed from those events.
- The initial history is 30 days of generated events, about 2.4 million orders, loaded into the landing store before the demo starts. The generator writes live events on top of that history. These row counts are design targets that the seed will produce and are to be measured, not claims about a running system.
- Platform self-telemetry is a second source. Tessera's own audit log, query log, rule-evaluation log and presence log are ordinary sources. "What changed in the last hour?" is therefore a query over the same engine as "what is p95 by region?" This matters for the composition argument, because the platform is inspectable with its own tools.

**Why this data.** Operations data has every property the demo needs: time series, dimensions, a fault that can be found by drilling down, permissions that matter (regional leads should not see other regions; finance should see revenue, not customer names), and actions that write back (acknowledge an incident, reassign a carrier). The fault is a real causal chain in the events, so an agent that interrogates the data finds it by querying, and the presenter does not have to stage an answer.

**Deployment shape.** The same images run under `docker compose` locally and under ECS Fargate on AWS (section E). The demo workspace has four stable identities (an operations lead, a regional lead for EMEA, a finance analyst, and the agent principal described in section D), so that permission demonstrations are repeatable.

---

## B. Capability inventory

The brief asks for every primitive and whether it is demonstrated or supporting. The core is deliberately small: six primitives and one language. Everything else in the table is a composition of those primitives, not a separate subsystem. The "composes with" column names the real dependencies.

### B.1 Core primitives (the kernel)

| # | Capability | Status | Technical significance | Composes with |
|---|---|---|---|---|
| P1 | **Node** (typed document entity with stable URI and revision) | Demonstrated | The only persistent entity kind. Every object has `tessera://<workspace>/<kind>/<id>`, a revision and a schema reference. | All others |
| P2 | **Change** (atomic set of path operations, with base revision) | Demonstrated | The only write path. Carries actor, surface, idempotency key and inverse operations. | Node, Audit, Undo, Realtime, Grant |
| P3 | **Query** (expression tree over sources: from, where, derive, group, aggregate, window, join, order, limit, union) | Demonstrated | One compiler, to parameterised DuckDB SQL. The only way data is read. | Source, Panel, Rule, Export, Grant (row predicate), Form (lookup) |
| P4 | **Source** (typed stream or table, with schema, watermark and lineage) | Demonstrated | Maps Kafka topics and S3 Parquet into queryable relations. Carries field types and sample rows. | Query, Lineage, Rule, Grant |
| P5 | **Parameter** (typed named value with default and bindings) | Demonstrated | Flows from control to query to panel to URL and back. Click-to-set and cross-filter are the same mechanism. | Panel, Query, Dashboard, Form |
| P6 | **Grant** (principal, action set, resource pattern, row predicate expressed as a Query expression) | Demonstrated | One authorization check for UI, API and MCP. Row-level security is a predicate compiled into the query, not a second filter. | Query, Node, Change, Audit |

### B.2 Presentation and interaction (built on P1 to P6)

| # | Capability | Status | Significance | Composes with |
|---|---|---|---|---|
| V1 | Panel (query + visual + interactions) | Demonstrated | A node whose data is one query result. | Query, Parameter, Rule, Export |
| V2 | Visual types: bar, line, area, table, KPI tile, heatmap, sankey (subset), map by region key | Demonstrated (bar, line, table, KPI, heatmap); supporting (others) | Each visual is a mapping from result columns to channels. No visual has private data access. | Panel |
| V3 | Dashboard (grid of panels, parameters, interactions) | Demonstrated | A node referencing panels by ID. | Panel, Parameter, Grant |
| V4 | Cross-filter and drill-down | Demonstrated | Clicking a mark sets a parameter. Drill-down is a parameter pointing at a more detailed query. | Parameter, Panel |
| V5 | Form (fields bound to a Source, submit = Action) | Demonstrated | A form submits a Change or an Action. Form fields are typed from the source schema. | Action, Source, Workflow |
| V6 | Annotation (time-anchored note on a panel or a Node) | Supporting | A Node with a time anchor. Shows on panels that cover the anchor. | Node, Panel, Audit |
| V7 | Comment (threaded, on any Node or Change) | Supporting | A Node kind. Mention of a principal creates a notification. | Node, Presence |
| V8 | Presence and cursors (who is viewing, where, with what selection) | Demonstrated | Ephemeral Redis state keyed by node URI. The agent principal has presence like a human. | Realtime, Grant |
| V9 | Collaborative editing (concurrent Changes with conflict detection) | Demonstrated | Path-level three-way merge over revisions (section D.6). | Change, Presence |
| V10 | Layout (grid, responsive breakpoints, phone width) | Supporting | Layout is data in the Dashboard document, so agents and humans edit it through the same Change. | Dashboard |
| V11 | Embedding (signed, scoped iframe of one Dashboard) | Supporting | A grant issued to an external origin with a fixed row predicate. | Grant, Dashboard |

### B.3 Logic and automation (built on P1 to P6)

| # | Capability | Status | Significance | Composes with |
|---|---|---|---|---|
| L1 | Rule (query + predicate + hold duration + actions) | Demonstrated | Evaluated by the same compiler. State machine: ok, pending, firing, resolved. | Query, Action, Workflow, Audit |
| L2 | Threshold and anomaly predicate (static threshold; z-score over a trailing window) | Demonstrated (threshold); supporting (z-score) | Predicates are query expressions. Anomaly is a window function. | Rule, Panel |
| L3 | Action (typed, previewable side effect: Change, notification, webhook, export) | Demonstrated | The write-back and notification primitive. Declares its inputs and its effects, so preview is possible. | Form, Rule, Workflow, Grant |
| L4 | Workflow (state machine over Rule firings, Action results and human tasks) | Demonstrated | Each instance is a node with a state and a history of transitions. | Rule, Action, Form, Audit |
| L5 | Scheduled report and export (query + format + schedule + destination) | Supporting | The same query, serialised as CSV, Parquet or PDF, written to S3 or sent to a channel. | Query, Action, Grant |
| L6 | Computed metric (named expression reused across queries) | Supporting | A Node kind, expanded by the query compiler. Changing it changes every panel that uses it. | Query, Lineage |
| L7 | Lineage (which Node reads which Source field, and which Node writes which path) | Demonstrated | Derived from the query ASTs and the Action declarations. Used for impact preview. | Query, Source, Change |

### B.4 Governance and history (built on P2)

| # | Capability | Status | Significance | Composes with |
|---|---|---|---|---|
| G1 | Audit (append-only, hash-chained change log with actor, surface, session and on-behalf-of) | Demonstrated | Same table for human, API and agent changes. Read by the audit query source (self-telemetry). | Change, Source |
| G2 | Undo (append inverse Change; never rewrite history) | Demonstrated | Works across principals. Undo of an agent change is an ordinary Change by the principal who asked. | Change, Audit |
| G3 | Versioning and branching (named branches of a Node at a revision) | Demonstrated (branch and merge of one Dashboard); supporting (cross-node branches) | A branch is a head pointer into the change log. | Change, Diff |
| G4 | Diff (structural diff of two Node revisions, path-level) | Demonstrated | Used by preview, by branch review and by the conflict UI. | Change, Branch |
| G5 | Templates (Node exported as a parameterised document with declared inputs) | Supporting | A template is a Node with a parameter list; instantiation is a Change that creates nodes. | Node, Parameter |
| G6 | Multi-tenancy (workspace as a hard partition in every table and every query compile) | Supporting | The compiler adds the workspace predicate; it cannot be removed. | Grant, Query |
| G7 | Row and column security (row predicate in Grant; column mask as projection rule) | Demonstrated | Compiled into the query. A masked column cannot be referenced by any downstream node. | Grant, Query, Export |
| G8 | Approvals (Change requires an approval Action before commit, for configured paths) | Supporting | A Grant rule that holds a Change in a pending state. | Change, Workflow, Grant |

### B.5 Surfaces and transport (built on P1 to P6)

| # | Capability | Status | Significance | Composes with |
|---|---|---|---|---|
| S1 | Realtime channel (ordered change and result-diff stream, resumable by revision) | Demonstrated | One WebSocket endpoint. Subscriptions are nodes and queries. | Change, Query, Presence |
| S2 | HTTP API (generated from the same schema as the spec language) | Supporting | OpenAPI 3.1 is generated, not hand-written. | Node, Change |
| S3 | MCP server (tools, resources, prompts, progress and change notifications) | Demonstrated | Thin adapter over the same verbs (section D.7). | All |
| S4 | Command-line client (`tessera apply`, `tessera diff`, `tessera undo`) | Supporting | Applies documents from git. Same commit path. | Node, Change, Diff |
| S5 | Deterministic replay driver (recorded MCP session replayed against a workspace) | Demonstrated (demo infrastructure) | Uses the MCP path, not a UI animation (section C.3). | MCP, Audit |

**Count.** Six primitives, 47 capabilities in the table above, of which 27 are marked demonstrated on screen or through MCP during the five-minute script. Supporting rows are real and tested but not shown.

### B.6 Composition map

The arrows are real dependencies in the code: the target consumes the source's output or reuses its machinery.

```
                        ┌────────────── Grant (P6) ──────────────┐
                        │ row predicate, column mask, action set │
                        ▼                                         │
Source (P4) ──► Query (P3) ──► Panel (V1) ──► Dashboard (V3) ◄── Parameter (P5)
   │               │  ▲             │               ▲                  ▲
   │               │  │             │               │                  │
   │               ▼  │             ▼               │            cross-filter / drill (V4)
   │          Rule (L1) ──► Action (L3) ──► Workflow (L4) ──► Form (V5)
   │               │                           │                  │
   │               ▼                           ▼                  ▼
   │          Export (L5)                 Human task          Change (P2)
   │                                                              │
   └── Lineage (L7) ◄────────────────────────────────────────────┤
                                                                  ▼
                              Audit (G1) ◄── Change log (hash chain) ──► Undo (G2)
                                  │                    │                   │
                                  ▼                    ▼                   ▼
                          Audit as Source       Branch / Diff (G3, G4)   Realtime (S1)
                          (self-telemetry)                                     │
                                                                    Presence (V8) / Collab (V9)
                                                                               │
                                                                    UI · HTTP API · MCP (S3)
```

Three compositions carry most of the surface:

1. **Query feeds everything.** Panels, rules, exports, row predicates, form lookups, computed metrics and the agent's own interrogation all call the same compiler. A bug fix or an optimisation there improves every capability at once. It also means that a row predicate cannot be bypassed by an export or an alert, because they do not have a separate read path.
2. **Change is the only write.** A panel edit, a dashboard layout move, a grant, a rule threshold, a form submit, an undo and an agent commit are all Changes. That is why one audit table, one undo and one realtime stream cover them all.
3. **Audit is a Source.** The query layer can read the change log. "Who changed the finance board in the last 10 minutes?" is an ordinary query. An agent asked to explain a change can answer it with the same tool it uses for sales data, which is the strongest evidence in the demo that the platform is one system.

---

## C. Five-minute live script

### C.1 Staging

- Three browser windows are open on the presenter's machine, sized to the room display: **Ops board** (wide, operations lead), **Exec view** (regional lead for EMEA, to show filtering), and **Phone** (narrow, the same incident page at phone width). A fourth window is the agent client (Claude Code terminal) with the Tessera MCP server connected as the agent principal.
- Before the demo, `make demo-reset` restores the workspace to the seeded state: the dashboard `ops-board` contains three panels, the finance board is owned by the finance analyst, the generator is parked at the virtual time before the scripted fault, and the replay transcript is loaded.
- The screens are not reloaded between steps. Everything appears through the realtime channel.

### C.2 Timeline

Prompts are typed by the presenter, shown in the terminal, and kept short. The agent's tool calls are listed in the expected-behaviour column; the audience sees them in the agent's trace panel, which shows the tool name, a one-line argument summary and the result status.

| Time (s) | Presenter action | Expected behaviour (MCP calls and system effects) | Visible result | Capabilities demonstrated | Transition |
|---|---|---|---|---|---|
| 0–30 | Stands at the Ops board. Says: "This is an operations platform. Everything on these screens is a node in one document graph. The agent on the laptop is an external client, and it is the same kind of client as this browser." No prompt. | None. The generator is streaming live events at a steady rate. The Ops board updates a KPI tile from the live Kafka feed, so the screen is visibly alive. | Three panels update. Exec view and Phone show the same dashboard with live presence badges for the three humans. | S1 realtime, V8 presence, P4 source | "Let's ask it a question." |
| 30–60 | Types: `Show p95 fulfilment latency by region for the last hour on the ops board.` | `schema.describe(kind="Source")`; `source.list`; `query.run(dry_run=true, query=…, limit=20)` returns the result sample; `node.preview(kind="Panel", …)` returns the diff, validation result, and lineage; `node.commit(change=…, preview_token=…)`. | A new bar panel appears on the Ops board at the right of the grid. Its bars are ordered by p95, descending. Exec view shows it too, under the same row predicate (EMEA is the highest bar). | P3 query, P4 source, P1 node, P2 change, L7 lineage, S3 MCP, V1 panel | "Is that normal?" |
| 60–100 | Types: `Why did p95 jump at 14:05? Show me the breakdown by carrier.` | `query.run` against the orders source filtered to the window; `query.run` against `audit.changes` (self-telemetry) returns no changes in the window, which the agent reports; `query.run` grouped by carrier and region; `node.preview` and `node.commit` of a Dashboard change that adds a `carrier-breakdown` panel and sets parameter `window` to `14:00–14:20`. The agent explains the cause in one sentence from query output: one carrier's median handoff time doubled. | A second panel appears: a heatmap of carrier by region. The cell for one carrier and EMEA is red. The time parameter on the dashboard changed, so all three panels were re-queried together. | P3 query over the same source, V2 heatmap, P5 parameter, V4 cross-filter, G1 audit as source, S1 realtime | Presenter clicks the red cell. |
| 100–135 | Clicks the red heatmap cell. Then types: `Alert me if p95 for any region stays above 900 ms for three minutes. Post to the ops channel.` | The click sets `region=EMEA` and `carrier=Crane` parameters (V4, no agent call). The agent calls `node.preview(kind="Rule", …)` which returns the query lineage, the expected firing count over the last 30 days of history (computed by running the rule's query in backtest mode), and the action's declared effects. Then `node.commit`. | The Rule appears in the Rules strip with state `ok`. Its backtest sparkline shows the 14:05 episode as one firing. | L1 rule, L2 threshold, L3 action preview (declared effects), L7 lineage, backtest over history | "Now the access question." |
| 135–170 | Types: `Who can see the finance board? Let the EMEA lead see only EMEA rows on it.` | `grant.check(resource="tessera://…/dashboards/finance-board", action="read")` returns the list of principals and their effective predicates; `grant.preview(principal="emea-lead", add={row_predicate: "region = 'EMEA'"})` returns the effective-rows count before and after; `node.commit` of the Grant. | Exec view, logged in as the EMEA lead, reloads only through realtime: the finance panels lose the rows for other regions in place. The grant list on the finance board gains a line with the predicate. | P6 grant, G7 row security, P3 compile of predicate, G1 audit, S1 realtime | "Humans can edit this too."  |
| 170–200 | Presenter drags the EMEA panel on the Ops board to a new position on the Exec view. At the same moment, the agent is instructed (in the terminal) to resize the same panel. | Presenter's Change has base revision r. Agent's Change also has base r. The first to commit wins; the second receives `CONFLICT` with the paths in conflict and the current values (section D.6). The agent re-reads the node and commits a non-overlapping change (a title edit), which merges. | A conflict banner appears on the Ops board with the two authors and the conflicting path. Presence shows the agent's cursor as a labelled marker. The title change merges without a refresh. | V9 collaboration, V8 presence, P2 base revision, D.6 merge rules, S3 error payload | "Undo is the audit trail, applied backwards." |
| 200–225 | Types: `Undo your last change to the finance board.` | `change.history(node, limit=3)` then `node.undo(change_seq=…, reason="presenter request")`. The undo is itself a Change with an inverse op list and an audit row linking it to the original. | The grant added at 135 s is removed. Exec view returns to all-region rows. The audit panel shows two linked rows. | G2 undo, G1 audit, P2 change, G3 history | "Now the strongest moment." |
| 225–250 | Says nothing. The generator, at the scripted offset, begins the latency fault for EMEA Crane. Within one evaluation window (design target: 15 s), the Rule moves to `pending`, then `firing` after three minutes of held breach (the virtual clock is run at 6x, so the hold is about 30 s of wall time). | The Rule's evaluator is Tessera code, not the agent. It creates a Workflow instance (L4) and runs the `notify` Action. The instance appears on the Ops board as a card with state `open` and a history of transitions. | Ops board: the Rule flips to `firing`. A toast appears on all three screens with the Workflow link. Notification shows on the Phone window. | L1 rule firing, L4 workflow, L3 action, S1 realtime, V8 presence | Presenter says: "Nobody asked the agent to watch for this." |
| 250–280 | Types, from the Phone window's incident card, nothing; instead types into the terminal: `Build me an acknowledge form for this incident with a note field, and a timeline of its state changes.` | `schema.describe(kind="Form")`; `source.sample(source="workflow.instances", limit=3)` to learn the fields; `node.preview(kind="Form", …)` with a declared Action `workflow.acknowledge` that writes a Change to the instance; `node.commit`. A `timeline` panel is added bound to `workflow.transitions` filtered by the instance parameter. | On the Phone window the incident card gains a form (note text field, Acknowledge button) and a timeline. The Ops board shows the timeline panel. | V5 form, L3 action with write-back, L4 workflow, P5 parameter bound to the card, V1 panel | Presenter taps Acknowledge on the phone. |
| 280–300 | Taps Acknowledge on the Phone window. | The Action submits a Change against the workflow instance (base revision from the form load). The Workflow moves to `acknowledged`. Audit row shows actor `user:ops-lead`, surface `ui`, on-behalf-of empty. The agent's trace shows that the form it built is in use. | The instance state changes to `acknowledged` on all three screens in under 2 s (design target). The timeline shows the transition with the actor name. The Ops board panel gains the audit line. Presenter ends on the three screens showing the same state from the same history. | L4 workflow transition, L3 action, G1 audit, S1 realtime, V5 form, V8 presence | End. |

### C.3 The fallback driver

The live agent is the default. The demo is designed so that every step above can be satisfied by a recorded transcript, and a switch between the two is a single keystroke (`F9`, shown as "driver: live / replay" in the status bar).

**How it works.**

- The recording is a JSON transcript produced by an earlier live run against the same seed. For each agent step it stores the prompt text, the sequence of MCP tool calls with full arguments, the expected result hash of each call, and the expected change hashes (section F, claim 5).
- The replay driver is a real MCP client. It connects to the same MCP endpoint, under the agent principal, and issues the recorded calls in order. It does not write to the UI, does not animate, and does not fake results. Each `node.commit` returns a real revision, and the screens update from the realtime channel exactly as for a live agent.
- Expected result hashes are checked. If a recorded `query.run` returns a different hash, the driver stops at that step and reports it in the status bar (`replay diverged at step 4: source watermark differs`). This is what prevents a replay from silently drifting from the data.
- The switch can happen at a step boundary. The live agent's current step is allowed to finish or is cancelled through MCP `notifications/cancelled`; the driver then issues the next step from the transcript. The switch is automatic when the live agent returns an error twice on one step, or when a step exceeds its latency budget (default 12 s for a query step, 20 s for a multi-call step).

**What the audience sees.** The terminal prompt is typed by the driver, so it looks the same. The trace panel records each call as `live` or `replay` in a small tag. This is deliberate. An expert in the room who sees a canned flow will discount it. An expert who sees real calls, labelled as replayed, will trust the platform more. The tag is one word, low contrast, and the presenter can state it in one sentence.

**Why the driver does not hide the fault.** The fault is generated by the event generator, not by the transcript. The replay needs the fault to occur at the same virtual time, which the seed guarantees. If the live feed is stalled, the replay still computes the same results from the landing store, because the transcript's expected hashes were computed on the same history.

---

## D. Technical architecture

### D.1 Components

| Component | Responsibility | Implementation |
|---|---|---|
| `tessera-core` | Node model, Change application, validation, hashing, diff, merge | TypeScript library, no I/O |
| `tessera-spec` | Specification language: types, JSON Schema, parser, canonical serialisation, YAML view | TypeScript, generates JSON Schema and OpenAPI |
| `tessera-query` | Query AST, typechecker, Grant predicate injection, DuckDB SQL compiler | TypeScript, produces parameterised SQL |
| `tessera-engine` | DuckDB execution, source views over Parquet, watermarks, result cache, result diffing | Node.js process with `@duckdb/node-api` |
| `tessera-api` | HTTP API, auth, commit endpoint, search | Fastify |
| `tessera-rt` | WebSocket gateway: subscriptions, change fan-out, presence | `ws` on Node, Redis pub/sub |
| `tessera-mcp` | MCP server: tools, resources, prompts, progress, change notifications | `@modelcontextprotocol/sdk`, stdio and Streamable HTTP |
| `tessera-web` | Single-page UI | React 19, Vite, TanStack Query, Zustand, react-grid-layout, Apache ECharts |
| `tessera-ingest` | Kafka consumers writing Parquet partitions to S3, watermark tracking | Node.js |
| `tessera-worker` | Rule evaluator, workflow runner, scheduled exports, backtests | Node.js, same image as api with different entrypoint |
| `tessera-gen` | Seeded Northwind event generator, virtual clock, fault script | Node.js, deterministic PRNG (xoshiro256**) |
| `tessera-driver` | Deterministic replay driver (MCP client) and transcript recorder | Node.js |

**Language choice.** TypeScript end to end. The reasons are concrete. (1) The spec types, the query AST, the Change format and the MCP tool schemas are one set of TypeScript types, validated at runtime by generated JSON Schema, so the UI, the server and the MCP server cannot disagree about a field name. (2) The official MCP SDK is maintained in TypeScript, and the MCP tool schemas are JSON Schema, which generates directly from the same types. (3) DuckDB has a maintained Node binding, so the CPU-heavy work (scans, aggregates, joins) runs in native code and Node is only orchestrating. The trade-off is that the Node process must not run large in-memory transforms; the rule is that all row-level work goes through DuckDB. Rust or Go would be faster for the API layer, but the demo's bottleneck is the query and the rendering, not request handling, and a second language would split the schema.

### D.2 Persistence model

PostgreSQL 16 holds the control plane. DuckDB reads the data plane. Object storage holds Parquet partitions and exports.

```sql
-- Node heads: the current state, derived from changes, rebuilt from snapshots on load
CREATE TABLE nodes (
  workspace_id   uuid        NOT NULL,
  node_id        uuid        NOT NULL,
  kind           text        NOT NULL,          -- Dashboard, Panel, Query, Source, Rule, Action, Form, Workflow, Grant, Metric, Template, Export
  slug           text        NOT NULL,
  revision       bigint      NOT NULL,          -- last applied change seq for this node
  body           jsonb       NOT NULL,          -- canonical spec document
  body_hash      bytea       NOT NULL,          -- sha-256 of canonical body
  deleted_at     timestamptz,
  PRIMARY KEY (workspace_id, node_id),
  UNIQUE (workspace_id, kind, slug)
);

-- The only write path. Append-only; hash-chained per workspace.
CREATE TABLE changes (
  seq              bigserial    PRIMARY KEY,
  workspace_id     uuid         NOT NULL,
  node_id          uuid         NOT NULL,
  base_revision    bigint       NOT NULL,      -- revision the author read
  result_revision  bigint       NOT NULL,      -- revision produced
  actor_id         uuid         NOT NULL REFERENCES principals,
  on_behalf_of     uuid         REFERENCES principals,
  surface          text         NOT NULL CHECK (surface IN ('ui','api','mcp','driver','system','cli')),
  session_id       text,
  idempotency_key  text,
  ops              jsonb        NOT NULL,      -- path operations (set, insert, remove, move)
  inverse_ops      jsonb        NOT NULL,      -- computed at commit; used by undo
  reason           text,
  undo_of          bigint       REFERENCES changes(seq),
  prev_hash        bytea        NOT NULL,
  hash             bytea        NOT NULL,      -- sha-256(prev_hash || canonical row)
  created_at       timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (node_id, result_revision),
  UNIQUE (workspace_id, idempotency_key)
);

-- Materialised snapshots every N changes per node, to bound replay
CREATE TABLE snapshots (
  workspace_id uuid, node_id uuid, revision bigint, body jsonb,
  PRIMARY KEY (workspace_id, node_id, revision)
);

CREATE TABLE branches (
  branch_id uuid PRIMARY KEY, node_id uuid NOT NULL, name text NOT NULL,
  base_revision bigint NOT NULL, head_revision bigint NOT NULL
);

CREATE TABLE principals (
  principal_id uuid PRIMARY KEY, workspace_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('human','service','agent')),
  subject text NOT NULL,                       -- OIDC sub, or agent client id
  display_name text NOT NULL, disabled_at timestamptz,
  max_scope jsonb                              -- for agents: the ceiling (section D.5)
);

-- Grants are nodes too; this table is a materialised index for fast checks
CREATE TABLE grant_index (
  workspace_id uuid, principal_id uuid, action text, resource_prefix text,
  row_predicate_ast jsonb, column_mask text[], grant_node_id uuid, expires_at timestamptz
);

CREATE TABLE query_runs (
  run_id uuid PRIMARY KEY, principal_id uuid, surface text, query_hash bytea,
  plan jsonb, row_count bigint, duration_ms int, source_watermarks jsonb,
  result_hash bytea, started_at timestamptz DEFAULT now()
);

CREATE TABLE rule_state (
  rule_node_id uuid PRIMARY KEY, state text CHECK (state IN ('ok','pending','firing','resolved')),
  since timestamptz, last_value jsonb
);

CREATE TABLE workflow_instances (
  instance_id uuid PRIMARY KEY, workflow_node_id uuid, state text, context jsonb,
  revision bigint
);
CREATE TABLE workflow_transitions (
  instance_id uuid, seq bigserial, from_state text, to_state text, cause jsonb, change_seq bigint,
  PRIMARY KEY (instance_id, seq)
);
```

**Redis** holds presence (key `presence:<node_uri>`, TTL 15 s, refreshed by heartbeat), realtime fan-out channels and short-lived preview tokens. Nothing in Redis is authoritative; losing it drops presence and realtime connections, which clients recover from by resuming at their last revision.

**Data plane.** Kafka topics are consumed by `tessera-ingest`, which writes Parquet files partitioned by `workspace_id`, `event_date` and `hour` to object storage, and records the high watermark per partition in `source_partitions` (a Postgres table). A source's watermark is the minimum over its partitions. Query results carry the watermarks they read, which is how a panel can state "data as of 14:21:07".

### D.3 The specification language

There is one language. Every Node is a document with this envelope:

```yaml
apiVersion: tessera/v1
kind: <Dashboard | Panel | Query | Source | Parameter | Rule | Action | Form | Workflow | Grant | Metric | Template | Export>
metadata: { id: <uuid>, slug: <string>, title: <string>, labels: { k: v } }
spec: { ... }          # kind-specific; validated against the kind's JSON Schema
```

Example document: the Ops board, with its parameters, one panel, one rule and one action. This is what the agent writes and what the UI renders. There is no generated code anywhere in the path.

```yaml
apiVersion: tessera/v1
kind: Dashboard
metadata: { id: 7f1c…, slug: ops-board, title: "Fulfilment operations" }
spec:
  parameters:
    window:  { type: duration, default: 1h, choices: [15m, 1h, 6h, 24h] }
    region:  { type: enum, source: "query:regions", multi: true }
    carrier: { type: enum, source: "query:carriers", multi: true, default: [] }
  layout:
    columns: 12
    items:
      - { panel: p95-by-region, at: { x: 0, y: 0, w: 6, h: 4 } }
      - { panel: carrier-heatmap, at: { x: 6, y: 0, w: 6, h: 4 } }
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

- Every reference is a URI or a slug resolved within the workspace. A reference to a missing node is a validation error at preview time, with the list of nodes of that kind that exist.
- Expressions are a small typed grammar: literals, field references, parameters (`$name`), click payload (`$click.field`), arithmetic, comparisons, `in`, `now()`, duration literals, and the aggregate functions the engine implements. There are no user-defined functions and no string-to-SQL escapes. Expressions compile to bound parameters.
- Visual channels are a fixed set per visual type. A field name that does not map to a channel is an error, not a silent drop.
- `on_click`, `on_fire` and form `submit` reference Actions by URI. An Action declares its input schema and its effects (Change paths it writes, notification channels it uses). Lineage (L7) is computed from these declarations, so an Action cannot write to a path it did not declare.

### D.4 Query and transform engine

The query AST is the only read interface. Its operators are: `from`, `where`, `derive`, `group`, `aggregate`, `window` (tumbling and trailing), `join` (equi-join only), `union`, `order`, `limit`, and `select`. The typechecker resolves every field against the source schema and every parameter against its declared type.

**Compilation.** The compiler emits DuckDB SQL with parameter placeholders only. It then adds, in this order and without an option to skip it:

1. the workspace predicate;
2. for the principal executing the query, the row predicate from every Grant that applies to the source (combined with `AND` across grants of the same principal that restrict, and rejected if a grant would make the result empty for a non-admin, which is reported as a preview warning);
3. the column mask: masked columns are removed from the projection and any downstream reference to them is a type error.

The compiled SQL and the injected predicates are recorded in `query_runs.plan`. An auditor can see exactly what a principal's query looked like after authorization.

**Incremental behaviour.** The engine does not implement incremental view maintenance. It re-executes a query when any source it reads has advanced its watermark, coalesced to at most one execution per query per second, and sends the client a keyed result diff (rows added, removed and changed, keyed by the group columns). The result cache key is `(query_hash, principal_row_predicate_hash, parameter_values, watermarks)`. This is simple and correct; the cost is that very large queries are re-executed in full. Section G lists this as a known limit.

**Performance targets (design, to be measured).** Aggregate over 2.4 million order rows grouped by region with a percentile: p95 under 200 ms on a laptop-class machine. Heatmap of carrier by region over the same rows: p95 under 300 ms. These are the numbers the rehearsal harness will check, and they are the reason for choosing DuckDB over row-by-row evaluation in Node.

**Backtest.** Rule preview runs the rule's query over the trailing 30 days in windows of the rule's hold duration, using the same compiler, and reports the number of firings it would have produced. This is a query, not a special simulator.

### D.5 Authorization model: the agent as a scoped principal

Authorization is one function: `authorize(principal, action, resource_uri, context) → allow | deny(reason) | allow_with(row_predicate, column_mask)`. Every surface calls it: the UI through the API, the HTTP API, the MCP server, the replay driver, and the worker when it runs a rule or workflow on behalf of a principal.

**Principal kinds.** `human` (OIDC subject), `service` (workload identity for workers and the generator), and `agent` (an MCP client acting on behalf of a human).

**The agent principal.** An agent authenticates as its own principal with `on_behalf_of` set to the human who started the session. Its effective permissions are the intersection of three sets:

1. the on-behalf-of human's grants;
2. the agent principal's `max_scope`, which is set by an administrator and cannot be changed through MCP;
3. the scope of the token, issued for the session, which can narrow but not widen.

So in the demo, the agent acts for the operations lead with a scope that allows `node:write` on dashboards, rules, forms and panels, `query:run` on all sources, and `grant:write` denied. The agent therefore cannot widen its own access, and when it tries, the error explains why. A test in section F proves this.

**Changes made by an agent** carry `actor_id = agent`, `on_behalf_of = operations lead`, `surface = mcp`, and the session id. Audit answers "who did this and for whom" in one row.

**Action permissions** are declared per action: an Action has a required permission; a Form's submit inherits it. A Rule's `on_fire` runs as the Rule's owner principal, with that owner's grants, and the owner is recorded on every firing. A rule owned by an agent cannot run an action its ceiling forbids, and the preview shows that before commit.

### D.6 Concurrency, merge and realtime

**Revisions.** Every node has a revision equal to the `seq` of its last change. A Change carries `base_revision`: the revision the author read. The commit path loads the head, and then:

- if `base_revision == head.revision`, the change applies;
- otherwise, the engine computes the set of paths touched by the Change (its `ops` targets) and the set of paths touched by changes between `base_revision` and head (read from the change log). If the sets are disjoint, the Change is rebased and applied, and the result records `merged_from`. If they intersect, the commit is rejected with `CONFLICT` and a payload of `{conflicting_paths, head_revision, head_values_at_paths, your_values_at_paths}`.

This is path-level three-way merge over a log. It is not character-level operational transformation, and it is not CRDT. The reason: Tessera's documents are structured (typed fields, lists keyed by id), and a conflict on a field is a meaningful signal to a human or an agent, whereas silently merging two different thresholds is a bug. Path granularity is the right unit for these documents. Text fields (titles, notes) use last-writer-wins with the conflict surfaced, which is what the demo shows.

**Idempotency.** Each Change may carry an `idempotency_key`. The unique index on `(workspace_id, idempotency_key)` makes a retry return the original result, with `replayed: true`. Preview tokens are single use and bound to the Change's hash.

**Realtime.** One WebSocket endpoint, `/rt`. A client sends `subscribe` with a list of node URIs or query handles and a last-seen revision. The server replies with a snapshot if the revision is older than the snapshot horizon, or with the missed changes if it is within the change log. Thereafter it pushes change batches (ordered by `seq`) and result diffs. On a sequence gap the client refetches. Presence is pushed as `presence` messages from Redis, with throttling of 5 updates per second per node.

Change visibility latency is the path: commit → change row → Redis channel → gateway → client. The design target is under 300 ms p95 for the commit-to-screen path on the same host, and under 2 s p95 from a Kafka event to a KPI tile updating, measured in the rehearsal harness.

### D.7 The MCP server

The MCP server exposes the platform's generic verbs. It does not expose one tool per object type. The reason is that a capable agent given a small grammar with rich schemas will compose it correctly across object kinds, and a large catalogue of specific tools would force it to learn a new interface for each kind, which is the opposite of composability. The server declares 15 tools, 6 resource templates, and 3 prompts.

**Tool catalogue.** Schemas are shown as signatures; each has a JSON Schema generated from the TypeScript type, which is what the server advertises through `tools/list`.

Discovery and reading:

1. `schema.describe(kind?: Kind, include_examples?: bool = true) → { kinds: [...], fields: [...], examples: [...], verbs: [...] }`. Without `kind`, returns the list of kinds with one-line purposes. With `kind`, returns the JSON Schema of the spec, the allowed visual channels or action effects, and one minimal valid example.
2. `node.get(uri: string, at_revision?: int) → { node, revision, body_hash }`.
3. `node.search(kind?: Kind, text?: string, labels?: map, limit?: int = 20, cursor?: string) → { items: [{uri, title, kind, revision}], next_cursor }`.
4. `source.list(filter?: { domain?: string }) → [{uri, title, fields: [{name, type, nullable, description}], watermark, row_estimate}]`.
5. `source.sample(source: uri, limit?: int = 5, columns?: string[]) → { rows, watermark, truncated }`. Values from sources are returned inside an `untrusted_data` envelope (section D.8).

Querying:

6. `query.run(query: QueryAst | uri, params?: map, limit?: int = 200, dry_run?: bool = false, timeout_ms?: int = 5000) → { columns, rows, row_count, watermarks, plan_summary, result_hash, truncated }`. With `dry_run`, returns the typecheck result and the plan without executing.
7. `query.explain(query: QueryAst, params?: map) → { compiled_sql, injected_predicates, lineage: [{source, field}], cost_estimate }`. Shows exactly what the authorization layer added.

Writing:

8. `node.preview(kind: Kind, uri?: string, body?: object, patch?: Op[], base_revision?: int) → { valid, errors: [...], diff, lineage_delta, effects, preview_token, expires_in_s }`. Never writes.
9. `node.commit(preview_token?: string, uri?: string, patch?: Op[], base_revision?: int, idempotency_key: string, reason?: string) → { change_seq, result_revision, merged_from?, replayed? }`. When the principal's scope has `require_preview: true` (the default for agents), `preview_token` is mandatory and must match the Change hash.
10. `node.delete(uri: string, base_revision: int, reason: string) → { change_seq }`. Soft delete; reversible by undo.

History:

11. `change.history(uri?: string, principal?: string, since?: timestamp, surface?: enum, limit?: int = 50) → [{seq, node_uri, actor, on_behalf_of, surface, at, reason, ops_summary}]`.
12. `node.undo(change_seq: int, reason: string, base_revision: int) → { undo_change_seq }`. Refused with `CONFLICT` if a later change touched the same paths; the error names the later change.
13. `diff(a: uri@rev, b: uri@rev) → { ops, human_summary }`.

Access and rendering:

14. `grant.check(resource: uri, action: string, principal?: string) → { decision, predicate_text, column_mask, sources: [...] }`.
15. `ui.present(uri: string, target?: "all"|"principal:<id>", focus?: { parameter: string, value: any }) → { delivered_to: [...] }`. Asks the realtime channel to bring a dashboard to the front on named screens. This is the only tool that changes what a screen shows without a Change, and it is recorded in the audit log as `surface=mcp, kind=present`.

**Resources.** `tessera://schema/{kind}`, `tessera://node/{workspace}/{node_id}`, `tessera://sources/{source_id}`, `tessera://examples/{kind}/{variant}`, `tessera://audit/{workspace}/{seq}`, `tessera://workspace/{workspace}/catalogue`. Resources are read-only and subscribable; when a node changes, the server sends `notifications/resources/updated`, so an agent holding a dashboard resource sees changes made by humans.

**Prompts.** `build-panel` (asks for a question and a target dashboard, returns the step sequence in section C), `investigate-spike` (asks for a metric and a time window, returns the drill-down procedure), `grant-review` (returns the access review procedure). These prompts are instructions about the tool sequence; they hold no data and no secrets.

**Progress and cancellation.** Long calls (`query.run` with a large plan, `node.preview` with a backtest) emit `notifications/progress`. The Tessera trace panel renders progress for the human audience. `notifications/cancelled` is honoured between engine batches.

### D.8 Error design and agent self-correction

Every error is a structured object, not free text, so an agent can recover without guessing:

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
    "docs_uri": "tessera://schema/Query#aggregate"
  }
}
```

Codes are a closed set: `VALIDATION_FAILED`, `UNKNOWN_FIELD`, `UNKNOWN_REFERENCE`, `TYPE_MISMATCH`, `PREVIEW_REQUIRED`, `PREVIEW_STALE`, `CONFLICT`, `FORBIDDEN` (with the scope reason and the missing permission named), `RATE_LIMITED` (with `retry_after_s`), `QUERY_TIMEOUT`, `SOURCE_STALE` (with the watermark), `IDEMPOTENT_REPLAY`. Each error carries a `fix_hint` written for a model reader, and `available` lists the valid alternatives so one retry is usually enough. The conflict payload contains the head values, so the agent can re-read and rebase without another call.

**Validation before writes.** Every Change is validated against the full workspace graph during preview: references exist, the principal has permission on every path, expressions typecheck, lineage does not create a cycle, and the resulting document is valid. A preview that passes is not a promise: the commit re-validates against the head, and if the head moved, returns `PREVIEW_STALE` with the diff between the previewed base and the new head.

### D.9 Rate limits, cost and abuse

Rate limits are token buckets per principal and per tool, with cost weights. `query.run` costs 5 units per execution (or 0 for a cache hit), `node.preview` costs 2, `node.commit` costs 3, reads cost 1. Defaults for an agent principal: 60 units per 10 s burst, 300 units per minute sustained. Exceeding the limit returns `RATE_LIMITED` with `retry_after_s`. The limits are there for runaway loops, which are the realistic agent failure, and they are deliberately visible in the trace panel.

Queries also have a row budget and a time budget. A query that scans more than the source's partition limit without a time predicate is refused with `QUERY_TIMEOUT` and a hint to add a window. This is what stops an agent from reading the whole 2.4 million rows to answer "how many orders are there?" when the answer is in the source's `row_estimate`.

### D.10 Prompt injection and untrusted data

Data in Tessera can contain text written by anyone: order notes, carrier messages, comment bodies, node titles. An agent that reads this text is reading untrusted input.

- **Envelope.** Every field read from a Source, a comment or a free-text node field is returned inside `{"untrusted_data": …}` with a fixed marker in the tool description telling the agent that content inside the envelope is data and never an instruction. The MCP server never returns instructions in its own result text; error `fix_hint`s are generated from schema facts, not from data.
- **No authority from content.** A string in data cannot grant a permission, change a scope or issue a preview token. Authority comes only from the authenticated principal and the server-side grant index.
- **Narrow tools.** The agent cannot write grants by default (`grant:write` denied for the agent ceiling), cannot call `ui.present` on a principal that did not start the session, and cannot run an action whose effects it did not declare in the preview.
- **Logging.** Tool calls that contain data echoed from untrusted fields are flagged in the audit row (`contains_untrusted: true`), so reviewers can find them.

This is not a complete defence against prompt injection in a model that reads the envelope and acts on it anyway. The defence is that a manipulated agent is still bounded by its ceiling, its previews and the audit trail, which is the same protection a manipulated human operator would have.

### D.11 Audit, versioning, undo

- **Audit** is the `changes` table, hash-chained per workspace. `tessera-api` verifies the chain at startup and on demand (`GET /audit/verify`). A broken chain is a visible failure on the status page, which is a demo claim that can be checked.
- **Versioning.** Every Node revision is recoverable from the chain. Snapshots every 50 changes per node bound replay time. A branch is a named head pointer; merging a branch is a Change whose ops are the branch's diff, subject to the same conflict rules.
- **Undo** appends the inverse of a Change (computed at commit, stored in `inverse_ops`). Undo of an undo is redo. Undo never deletes history. Undo across principals is allowed for principals with write access to the same paths, and is audited as a new change with `undo_of` set.

---

## E. AWS and local deployment

### E.1 One set of images

Four application images are built from one repository with a multi-stage Dockerfile on a distroless Node base: `tessera-app` (contains api, rt, web assets and mcp; the entrypoint selects the process), `tessera-worker`, `tessera-ingest` and `tessera-gen`. Each image is immutable, tagged with the git commit and the content digest, and signed. An SBOM is generated for each image. The same digests are deployed locally and on AWS. The configuration differs only by environment variables and by the endpoint interface for each dependency.

### E.2 Cloud integrations behind explicit interfaces

| Interface | AWS implementation | Local implementation | What is preserved |
|---|---|---|---|
| Relational store (`ControlStore`) | Amazon Aurora PostgreSQL | PostgreSQL 16 container | Same SQL, same migrations, same isolation level (read committed with row locks on `nodes`) |
| Event stream (`EventBus`) | Amazon MSK (Kafka protocol, IAM auth) | Redpanda single-node container (Kafka protocol) | Same topic names, partitioning key (`workspace_id`, `order_id`), consumer groups and offsets |
| Object store (`BlobStore`) | Amazon S3 | MinIO container (S3 API) | Same bucket layout, same SDK, same lifecycle rules applied as configuration |
| Cache and presence (`Ephemeral`) | Amazon ElastiCache for Redis | Redis container | Same keys, same TTLs, same pub/sub channel names |
| Identity (`Identity`) | Amazon Cognito user pool (OIDC) | Keycloak container with an exported realm | Same OIDC flows, same claim mapping (`sub`, `tessera/workspace`, `tessera/roles`) |
| Secrets (`Secrets`) | AWS Secrets Manager | Environment file mounted read-only | Same lookup by name |
| Compute | ECS Fargate services (api, rt, mcp, worker, ingest, gen) behind an ALB | docker compose with the same images and the same health checks | Same health endpoints (`/healthz` liveness, `/readyz` readiness with dependency checks) |
| Telemetry | CloudWatch Logs and EMF metrics, X-Ray traces via OpenTelemetry | OpenTelemetry collector to stdout and a local Grafana | Same OpenTelemetry instrumentation |
| Infrastructure as code | AWS CDK (TypeScript) | Compose file rendered from the same service manifest | Same service names, ports and dependency graph |

**What differs and why behaviour is unchanged.** The interfaces are the only difference. Each interface has a contract test suite that runs against both implementations in CI: the Kafka contract test asserts ordering per key and redelivery after a consumer crash; the S3 test asserts multipart upload and listing behaviour; the OIDC test asserts claim presence and token expiry handling. The local implementations are real servers speaking the same protocols, not in-memory fakes. Where a difference is unavoidable (for example, Cognito's token claim names differ from Keycloak's), it is confined to the `Identity` adapter and listed in the operations runbook.

### E.3 Exposure of the MCP server

**Local.** Two transports from the same `tessera-mcp` entrypoint.

- **stdio** for Claude Code and Claude Desktop: the client launches `docker run --rm -i … tessera-app mcp --stdio --principal agent:claude-code`, with the workspace and token supplied through the environment. This is the path the demo uses on the presenter's machine.
- **Streamable HTTP** at `http://localhost:8790/mcp`, authenticated with an OAuth 2.1 bearer token issued by the local Keycloak for the agent client, with PKCE. This is the same path the AWS deployment uses, and the demo can switch to it for a remote agent.

**AWS.** Streamable HTTP at `https://mcp.<domain>/mcp` behind the ALB, TLS terminated at the ALB, with the MCP server validating the bearer token against Cognito's JWKS as an OAuth protected resource (the authorization server metadata is published at `/.well-known/oauth-protected-resource`, as the MCP authorization specification requires). The agent client is a Cognito app client with the `tessera/agent` scope. Tokens are short-lived (15 minutes) and refreshed by the client. The MCP service runs in private subnets with the ALB as the only ingress.

**Stdio is not available on AWS**, and that is intended: it is a local developer transport. The tool list, the schemas, the errors and the audit rows are identical across the two transports, which is a claim tested in section F.

### E.4 Operations for the demo

- `make up` (or `docker compose up`) starts the whole stack in dependency order with readiness gates; `make demo-reset` restores the seeded workspace in under the reset budget (design target: 20 s) by replaying the seed, not by clearing and reloading.
- `make rehearse` runs the automated browser rehearsal: Playwright drives the three windows through the five-minute script using the driver, and asserts on the visible result of each step (for example, that the Rule row reads `firing` within the target latency). It also runs the replay driver with the transcript and checks the expected hashes.
- Recovery after an interrupted demo: the replay driver can resume from any step, because each step is idempotent (idempotency keys are derived from step id and transcript id). Reset is the fallback when the state is unknown.

---

## F. Five strongest technical claims

Each claim has an executable test or an observable behaviour. Test names are the ones the rehearsal and CI suites will carry.

**Claim 1: Every write is one path, so every surface produces identical state and audit.**
Test: `commit_equivalence` property test. Generate 1,000 random valid Change sequences over a seeded workspace. Apply each sequence through UI-simulated calls (API `PATCH`), HTTP API, MCP `node.commit` and the CLI, each in a fresh workspace. Assert that the final `body_hash` of every node is identical across surfaces, and that the `changes` rows differ only in the `surface` column. Observable on stage: the audit panel shows one row shape for the agent's panel and for a human's drag.

**Claim 2: Row-level security cannot be bypassed by any downstream feature.**
Test: `rls_differential`. For 10,000 generated queries over the orders source and 200 generated grants, compare the result of running each query as the restricted principal against the result of running the same query with the grant's predicate written by hand into the `where` clause, as the restricted principal's own query. Also run the query through Rule evaluation, scheduled export and form lookup. Assert row-set equality in all four paths, and that no path returns a row the grant excludes. Observable: the EMEA lead's Exec view changes in place at 135 s, and the same count appears in `grant.preview`.

**Claim 3: The agent's preview is exact, so an agent can be trusted with commits.**
Test: `preview_is_commit`. For 500 random Change sets, call `node.preview`, then `node.commit` with its token, and assert that the committed `body_hash` equals the previewed `result_hash`, and that the commit's `ops` equal the preview's `diff`. Add the negative cases: a commit with a stale token returns `PREVIEW_STALE`; a commit with a token for a different Change hash returns `PREVIEW_REQUIRED`. Observable: the preview diff shown to the presenter at 60 s is the same diff that appears in the audit row.

**Claim 4: Undo is exact across principals and never rewrites history.**
Test: `undo_roundtrip`. Starting from a seeded workspace, apply 300 random Changes by mixed principals (humans, the agent, the driver), then undo them in reverse order. Assert that after the undos, `body_hash` equals the hash at the start, that the hash chain verifies at every step, and that `changes` has 600 rows (300 originals and 300 undos), none modified. Observable at 200–225 s: the grant disappears, and the audit panel shows two linked rows.

**Claim 5: The agent path is real, and the deterministic fallback reproduces it exactly.**
This claim has two parts, and both are needed for the demo's credibility.

- *Agent path.* Test `agent_builds_ui_from_descriptions`. Give a general model only the MCP tool list and the resources (no prompt about Tessera internals), and ask it for ten fixed business questions over the seeded data (for example, "p95 by region for the last hour as a bar panel"). Score each run for: the panel exists, the query's result equals the reference query's result, and the panel renders with the expected visual type. Report the pass rate across 20 runs per question as a measured quantity. The target is that the first commit is correct on most runs, and that every failed run ends with a structured error the agent recovered from or a clear refusal. The result is a number in the rehearsal report, not a claim about the model.
- *Fallback.* Test `replay_reproduces`. Record one live session, then replay it 10 times on a freshly reset workspace, on the local stack and on a staging AWS stack from the same image digests. Assert that every step's result hash matches the transcript and that the final `body_hash` of the Ops board, the finance board, the rule and the workflow instance match across all 20 runs. Observable: the trace panel reads `replay` on every step, and the screens match the live run.

**What the claims deliberately exclude.** Claim 5's agent-path number depends on a non-deterministic model and is labelled as measured. The platform's behaviour is not claimed to be deterministic under a live agent. It is claimed to be deterministic under replay and to be bounded under any agent.

---

## G. Failure analysis

### G.1 Implementation difficulties

1. **Predicate injection correctness.** Row-level security is only as good as the compiler's handling of subqueries, joins and `union`. A join can leak rows through the other side if the predicate is applied after the join. Mitigation: predicates are attached to the source relation before any operator, and the differential test in claim 2 includes joins and unions. This is the hardest correctness problem in the design and it is isolated in one module.
2. **Path-level merge semantics.** Deciding when two paths conflict (a parent and a child path both changed, list insertions at the same index, moves) takes careful rules. Mitigation: lists are keyed by stable ids, never indexed; moves are expressed as remove plus insert with the same id; the merge rules are a table with tests.
3. **Watermark correctness on the data plane.** A panel that reports "as of 14:21" must not read partially written partitions. Mitigation: ingest publishes a partition only after the Parquet file's rename, and watermarks advance only on published partitions.
4. **Deterministic replay across machines.** Floating-point aggregation order in DuckDB can vary with thread count. Mitigation: the rehearsal pins `threads=1` for replay hash checks, and percentiles are computed with the exact method rather than an approximate sketch; the result hash is over rounded values to 6 significant digits. This is a real constraint and it is listed in the runbook.
5. **Hash-chain concurrency.** A per-workspace chain serialises commits. Mitigation: the chain is per workspace, not global, and commit contention is measured in rehearsal. Under the demo load (one human commit every few seconds and the agent's bursts) this is not a bottleneck. It would become one under heavy multi-tenant load, and sharding by workspace is the path.
6. **Re-execution cost of queries.** Without incremental maintenance, a large panel is recomputed on every watermark advance. Mitigation: coalescing at one run per second, and the result cache. This is a known limit (G.4).
7. **Keycloak and Cognito claim drift.** Mitigation: the `Identity` adapter normalises claims; the contract test catches drift.

### G.2 On-stage failure modes

| Failure | Symptom on stage | Mitigation | Recovery |
|---|---|---|---|
| Agent calls `node.commit` without a preview | `PREVIEW_REQUIRED` in the trace | Enforced by scope; the error text tells the agent to preview. This is a feature to show, not hide. | Agent previews and commits again (a visible, normal recovery). |
| Agent invents a field (`latency` instead of `latency_ms`) | `UNKNOWN_FIELD` with `did_you_mean` | Closed error codes, `available` lists, `schema.describe` earlier in the flow. | One retry. |
| Agent names a source that does not exist | `UNKNOWN_REFERENCE` listing sources | `source.list` is the first call in the agent's prompt pattern. | One retry. |
| Agent is slow (model latency over budget) | No tool call for more than the step budget | Driver switch rule (section C.3). | Driver replays the step; the live agent's partial output is cancelled. |
| Agent loops on errors | Repeated `VALIDATION_FAILED` | Rate limiter; driver switch after two failures on one step. | Driver. |
| Query is slow | Panel shows the loading state longer than 2 s | Query budget; coalescing; cache; the panel shows the watermark and a progress bar from `notifications/progress`. | The presenter continues; the step is pre-warmed in rehearsal. |
| Kafka feed stalls | KPI tile stops updating, watermark timestamp stops advancing | Panel shows "as of" time, so staleness is visible, not hidden. | Generator restart (idempotent); the demo continues from the landing store. |
| Redis down | Presence badges disappear; realtime reconnects | Clients resume from revision; commits still work (Postgres is authoritative). | Redis restart. |
| Browser window loses its socket | Screen freezes | Clients resume by revision; the status bar shows "reconnecting". | Automatic; the presenter does not reload. |
| Fault does not fire at the scripted time | Rule stays `ok` at 225 s | The generator's fault is at a virtual time; the presenter sees the virtual clock in the status bar. The rehearsal checks it. | Presenter says the virtual clock is behind and waits for the next tick; or driver switch. |
| Rule fires twice | Two toasts | Rule state machine (`firing` is a state, not an event); notifications are deduplicated by firing id. | None needed; it is tested. |
| Wrong region shown after undo | Exec view inconsistent | Undo is a Change, so the realtime stream carries it; rehearsal asserts the Exec view after undo. | Refresh of the exec window only. |

### G.3 Agent failure modes in the design

- **Wrong tool call.** Covered by scope enforcement and the error model. The agent can still choose a poor query. The mitigation is the `query.explain` call and the preview, which shows the result before it is committed.
- **Hallucinated fields and sources.** Covered by typed errors. The agent can still hallucinate a plausible answer in prose that the data does not support. The mitigation is that the panel shows the query, the watermark and the row count, and the presenter's question is answered by the panel, not only by the prose.
- **Confident wrong explanation.** The agent says the cause is a carrier when the data says otherwise. Mitigation: the demo's prompt asks for the breakdown, and the result is on screen beside the explanation. This is a risk the audience will see, and the design does not hide it.
- **Excess authority.** Covered by ceiling, scope and grants.
- **Prompt injection through data.** Covered as far as the design can cover it (D.10).

### G.4 Hidden complexity

- Expression typing across joins and derived fields is larger than it looks. The typechecker is the most involved module.
- Presence and cursors under reconnection storms need throttling and deduplication; this is more code than the feature suggests.
- Backtest over 30 days for each preview is a real cost; it is bounded by the hold window and cached by rule hash.
- Snapshot and replay of nodes with long histories needs the snapshot policy to be tested, not assumed.
- Lineage is derived from ASTs and Action declarations, which means every new expression form must also extend lineage. That coupling is the price of impact preview.

### G.5 Known limits, stated plainly

- No incremental view maintenance: a large query is recomputed in full on each watermark advance, coalesced to one per second.
- Collaborative editing is path-level with last-writer-wins on text fields. It is not character-level and it does not merge two edits to the same text.
- Cross-workspace queries are not supported. Multi-tenancy is by hard partition.
- The hash chain is per workspace and serialises commits within a workspace.
- The visual set is small (bar, line, area, table, KPI, heatmap, and map by region key). Sankey and others are supporting and may be cut.
- Replay determinism holds on `threads=1` and fixed seeds. Under a live agent, the run is not deterministic.
- The agent-path pass rate is a measured quantity and will vary by model version.

### G.6 Features in this proposal that look more impressive than they are

Stated honestly, so the reviewers do not have to find them:

- **Anomaly detection** is a trailing z-score window function. It is correct and labelled, but it is not a learned model and should not be sold as one.
- **Embedding** is an iframe with a signed token and a fixed predicate. It works, but it has no embedding SDK and no theming API.
- **Templates** are documents with declared parameters. They are not a marketplace and not versioned across workspaces.
- **Comments** are flat, not threaded, in the first cut. Mentions create notifications; there is no inbox.
- **Presence** shows avatars and cursor positions on panels; it does not show who is editing a specific field.
- **Approvals** hold a Change pending a single approver; there is no multi-step approval chain.
- **Lineage** is field-level for queries and path-level for Changes. It is not column-level lineage across external systems.
- **The "agent can build almost anything" claim** is bounded by the expression grammar and the visual set. The agent can build any panel the grammar can express, not any UI.
- **The MCP server's 15 tools** look like few; each is a generic verb, so the surface the agent sees is the grammar. That is the design intent, but a reviewer may prefer per-kind tools for discoverability. The response is the `schema.describe` call and the examples resource, and that trade-off should be tested with a model, not argued.

---

## H. Feasibility

Feasibility is expressed by what each component touches and by the order in which the components unblock one another. No durations are given.

### H.1 Scope by component

| Component | What it touches | What makes it hard |
|---|---|---|
| `tessera-core` and `tessera-spec` | Node model, Change application, canonical JSON, hashing, JSON Schema generation, diff | Typed Change model, hash chain, diff; the property tests of claims 1 and 4 live here | Correctness of merge and undo across principals |
| `tessera-query` and `tessera-engine` | AST, typechecker, predicate injection, DuckDB SQL, watermarks, result diff | AST, typechecker, predicate injection, DuckDB compile, watermarks; the differential test of claim 2 lives here | Predicate injection through joins and unions |
| `tessera-api` and auth | Fastify routes, OIDC verification, Grant index, rate limits | Keeping one `authorize` function on every surface |
| `tessera-rt` | WebSocket, Redis fan-out, resume by revision, presence | Reconnection storms and deduplication |
| `tessera-mcp` | Tool schemas, resources, progress and cancellation, error model, both transports | Schema shape that a model reads correctly without prompting |
| `tessera-web` | Grid layout, panels, visuals, forms, phone layout, status bar, trace panel | Breadth of interaction states, all of which appear on screen |
| `tessera-ingest`, `tessera-gen` | Kafka, Parquet, watermarks, seeded generator, virtual clock, fault script | Watermarks that never expose half-written partitions |
| `tessera-worker` | Rule state machine, workflow runner, backtest, scheduled export | Exactly-once firing semantics under restart |
| `tessera-driver` and rehearsal | Transcript recorder, replay, Playwright scripts | Depends on every other component being stable |
| Deployment | Images, compose, CDK stacks, contract tests for each adapter | Parity of behaviour across the two stacks |

### H.2 Critical dependencies

- **DuckDB Node binding** for the query engine. Risk: binding behaviour on Windows and Linux containers. Mitigation: the query engine's tests run in the container image on both hosts.
- **MCP TypeScript SDK** for the server. Risk: protocol features (progress, cancellation, resource subscriptions) differ in maturity across client implementations. Mitigation: the demo uses the features Claude Code and Claude Desktop support, verified in a spike before the tool design is frozen.
- **Kafka client library** for Node. Risk: consumer group behaviour under restart. Mitigation: the contract test in E.2.
- **Keycloak and Cognito** for identity. Risk: claim differences. Mitigation: the `Identity` adapter and its contract test.
- **Playwright** for rehearsal. Risk: flakiness on realtime-heavy screens. Mitigation: rehearsal waits on the realtime sequence number exposed by the page, not on timeouts.
- **Live model availability.** Risk: latency and errors on stage. Mitigation: the fallback driver, which is a required deliverable, not an extra.

### H.3 Main risks, ranked by what they block

1. Predicate injection correctness (blocks claims 2, 3 and the agent's safe use of queries). Resolved by the differential test before any UI work that depends on it.
2. Change commit, merge and undo semantics (blocks claims 1, 3, 4, all collaboration and the audit story). Resolved by the property tests.
3. The MCP tool schema and error model (blocks the agent path and claim 5). Resolved by a spike with a model reading only `tools/list`, before the verbs are finalised.
4. Deterministic replay (blocks the fallback, which blocks the live-demo reliability criterion). Resolved by the replay test on two stacks.
5. Query latency on the demo dataset (blocks the choreography's timing). Resolved by measuring the performance targets on the seeded data early.

### H.4 Dependency-ordered build sequence

Starting from a minimal vertical slice, each stage unblocks the next. A stage is complete when its named test passes.

**Stage 0: the vertical slice.** One source (the simulated orders topic, landing as Parquet, with a watermark), one query (`p95 by region`), one Panel node, one Dashboard node, one `node.commit` path through the core, one realtime push to one browser window, and one `node.get` through MCP. Done when: the panel appears on a second window within the commit-to-screen target, and the commit is in the audit chain. This slice touches every package at minimal depth, so its failure exposes integration errors early.

**Stage 1: the kernel.** `tessera-core` complete with Change, revision, hash chain, diff and undo. Done when: `undo_roundtrip` and `commit_equivalence` pass.

**Stage 2: the query compiler and predicate injection.** Full AST, typechecker, DuckDB compile, workspace predicate, Grant predicate injection, column mask. Done when: `rls_differential` passes, including joins and unions.

**Stage 3: authorization and the agent principal.** `authorize`, Grant index, principal kinds, the agent ceiling and scope intersection, `require_preview`. Done when: a test shows the agent cannot write a grant, and the error names the missing permission.

**Stage 4: preview and commit.** `node.preview`, preview tokens, stale-preview detection, lineage delta, backtest for Rules. Done when: `preview_is_commit` passes.

**Stage 5: the MCP server.** The fifteen tools, six resources, three prompts, both transports, progress and cancellation, the error model. Done when: a model given only `tools/list` and resources completes two of the ten reference questions correctly, as a spike, and the schema shape is frozen.

**Stage 6: realtime and collaboration.** Subscriptions, resume by revision, presence, path-level merge with conflict payloads. Done when: the 170–200 s conflict scenario reproduces in a Playwright test.

**Stage 7: the web surface.** Grid, panels, visuals, parameters, cross-filter, forms, phone layout, status bar, trace panel with live and replay tags. Done when: the three windows of the script can be driven by the rehearsal with no manual steps.

**Stage 8: rules, workflows and actions.** Rule state machine, workflow instances, action effects, form write-back, notifications with deduplication. Done when: the 225–280 s steps reproduce, including the acknowledge write-back and its audit row.

**Stage 9: the generator and the fault.** Seeded generator with the virtual clock and the scripted fault; landing of 30 days of history. Done when: the fault appears at the scripted virtual time on every run with the seed, and the watermark-based "as of" time is correct.

**Stage 10: the replay driver and rehearsal.** Transcript recorder, replay with hash checks, automatic switch rule, `make rehearse`. Done when: `replay_reproduces` passes on local and on staging AWS.

**Stage 11: deployment.** Images, compose rendering, CDK stacks, Cognito and Keycloak adapters, contract suites for each interface. Done when: the same digests pass the contract suites on both stacks.

**Stage 12: the measured claims.** `agent_builds_ui_from_descriptions` run across 20 runs per question; performance targets measured on the seeded dataset; the results recorded in the rehearsal report. Done when the report exists, whatever its numbers.

### H.5 What is cut first if scope must be reduced

The order of cuts follows the evaluation weights. Cut first: sankey, map visual, embedding, scheduled export, templates, branching across nodes (keep single-dashboard branch). Keep: the kernel, the query compiler and predicate injection, the MCP verbs, preview and commit, undo, realtime, presence, the rule-to-workflow-to-form chain, the fallback driver. Those are the composition the audience is meant to see; the cut list removes breadth, not the composition.

---

## Closing note

Tessera's bet is that a demo of composition is only convincing if the composition is real. The kernel is six primitives, one specification language, one change log and one authorization function. The agent sees the same grammar the humans use, and every thing it builds on screen is a document that could have been written by hand, reviewed as a diff, undone, and explained by querying the platform's own audit log.

**Pitch (two sentences).** Tessera is an enterprise operations platform built from six primitives and one specification language, so that every dashboard, rule, workflow, form and permission is the same kind of composable object, whether a person, an API or an AI agent writes it. In five minutes, an agent connected through MCP answers a live question about a seeded fulfilment fault, builds the panel, alert, grant and acknowledge form that answer it, and is undone, with every step previewed, authorized, audited and reproducible.
