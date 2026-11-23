# Lodestar: Live Operational Resilience

Competitor 05 · Mandate: Live Operational Resilience · Design proposal (design only, nothing built)

**Product title:** Lodestar

**Pitch:** Lodestar is an enterprise operations platform that watches a real containerised checkout system, including its own telemetry, and lets an external agent investigate an incident and build the dashboards, alerts, runbooks and permissions that explain it, live, on every connected screen. Every agent change is planned, authorized, audited, attributed and reversible through the same machinery a human uses, and when the live model stalls, a recorded sequence of the same MCP calls takes over at a checkpoint without the audience seeing a seam.

---

## A. Product concept

### What the platform is

Lodestar is a composable operations platform. Its job is to turn live telemetry and operational state into shared, governed views and actions: dashboards built from typed panels, queries over several sources, alerts with a visible state machine, incidents that group alerts, runbooks that move through approval gates, and permissions that decide who may see or change each of these. Everything is a versioned entity in one schema system, and every write, from the web UI, the HTTP API or the MCP server, passes through one command path.

The demonstration is about resilience. The audience should see a real system misbehave, see the platform notice, see an agent investigate with the platform's own tools, see a human approve a recovery, and see the system heal, all while the screens update in real time. The UI the agent builds is not a mock-up: each panel is a real query against real metrics or logs.

### Who uses it

- **Cass (SRE, on-call).** Watches the fleet, acknowledges alerts, approves runbook steps, drives the incident board.
- **Ada (engineering lead, admin).** Owns the `ops` workspace, grants permissions, reviews the agent's changes in the audit view.
- **Ben (finance analyst).** Holds read access to a `finance` workspace and no write access to `ops`. Exists so that the authorization path has a real, meaningful boundary to show.
- **The agent, `agent:claude-demo`.** A scoped principal. It reads all of `ops`, writes dashboards, panels, queries, annotations and alert drafts in `ops`, proposes runbooks, and is structurally unable to approve actions, grant permissions, inject faults or write to `finance`.

### The data and the system behind it

The demonstration system is **Harbor Checkout**, a small real checkout system. It is not a simulation of metrics. It is a set of real processes:

| Component | What it is | Real signal it produces |
|---|---|---|
| `storefront` | HTTP service, Node 22 | request counts and latency histograms on `/metrics` |
| `cart` | HTTP service, backed by Redis | cart operation latency, Redis call counts |
| `orders` | HTTP service, backed by Postgres | order creation latency, DB pool wait time |
| `inventory` | HTTP service, backed by Postgres | reservation conflicts, stock query latency |
| `payments` | HTTP service behind a Toxiproxy listener | authorization latency, upstream error counts |
| `notify` | worker consuming a Redis list | queue depth, processing lag |
| `postgres`, `redis` | stock images | exporter metrics, slow-query log lines |
| `k6` load generator | official k6 image, fixed arrival schedule | offered load, client-side latency |
| `lodestar-*` | the platform itself | its own request, command and SSE metrics |

Reproducibility is designed in at three levels:

1. **Inputs.** A scenario seed fixes the catalogue, customer identities, the k6 arrival schedule (1,200 requests per minute by default, labelled as the configured offered load), and the fault schedule. Two runs send the same requests at the same offsets.
2. **Latencies.** Latencies are real and vary by run. The narrative never depends on exact numbers. It depends on the shape: payments latency rises, the alert fires, the cause is the paused process.
3. **Replay telemetry.** A rehearsal captures its own telemetry into a VictoriaMetrics snapshot. The deterministic fallback (section C) reads that snapshot in place of the live source, so numbers on screen match the recorded transcript exactly. This is a data-source mode of the platform, not an animation.

The demo needs no paid API and no external service. The only external dependency is the agent client, covered by the fallback.

### Why resilience is the right spine for this brief

Infrastructure failure is the case where a real platform most needs composition: a metric informs an alert, the alert groups into an incident, the incident links to a change that caused it, a runbook step needs an approval from a person with a specific grant, and the recovery must be attributed. Each of those steps is a primitive from section B. A resilience demonstration cannot be faked without being obviously faked, which is the bar the audience sets.

---

## B. Capability inventory

Legend: **D** = demonstrated on stage, **S** = supporting (present, exercised by tests or by another primitive, not spoken to), **C** = core machinery (shared by everything).

### B.1 Core machinery

| Capability | Class | Technical significance | Composes with |
|---|---|---|---|
| Kind registry (typed schema per entity kind) | C | One JSON Schema 2020-12 document per kind, generated from TypeBox definitions; the source of validation in web, API and MCP | every entity; MCP discovery; error messages |
| Entity store (versioned documents) | C | Every object is an `entity` row with `spec` JSON, `version`, `slug`, `branch`; optimistic concurrency by `expected_version` | all kinds; undo; branches; realtime |
| Change log with hash chain | C | Append-only `change` rows with RFC 6902 patch, inverse patch, principal, client, request id, prev-hash chain | audit, undo, realtime fanout, changes view |
| Command engine (plan / apply) | C | Ops are validated and diffed into a plan with an expiry; apply re-validates against `base_seq` | MCP dry runs; web "review changes"; API |
| Idempotency keys | C | Per-principal key with request hash; replay returns stored result; mismatch is an error | MCP retries; fallback driver; API clients |
| Principals (human, service, agent) | C | Identity with kind and workspace membership; agent is a principal, not a special API | authorization; audit; approvals |
| Policy engine | C | Deny-overrides RBAC grants with predicates over principal and resource attributes; default deny | every write; every query (row/column policy) |
| Row and column policy | D | Source-level predicates applied at query compile time; column masking for the agent | queries; panels; exports; MCP results |
| Workspace isolation | C | Tenancy boundary: `ops`, `finance`, `sandbox`; grants are workspace-scoped | policy; sharing; screens |
| Realtime change fanout | D | Postgres LISTEN/NOTIFY carries `seq` only; SSE streams resume from `Last-Event-ID` | every screen; panels; alerts |
| Presence and cursors | D | Heartbeat rows and WebSocket cursor events scoped to a dashboard | collaboration; conflicts; drill |
| Conflict handling | D | Field-level merge for disjoint layout paths; otherwise a conflict result with the current version and a 3-way diff | collaborative editing; agent retries |
| Undo and revert | D | Inverse patch per change; `undo(seq)` and `revert_to(seq)` are themselves changes | audit; branches; fallback checkpoints |
| Branches and diff | S | `branch` column; create from seq, diff, merge; the agent can diff its work against `main` | versioning; review; undo |
| Audit view | D | Joins `change` and `mcp_call` into a timeline per entity, principal or workspace | policy; lineage; changes view |
| Idempotent MCP call log | S | Every MCP call logs tool, args hash, status, latency, plan id | audit; eval harness |
| Rate limits | S | Token buckets per principal for writes and previews, with `retry_after_ms` in errors | agent self-correction; fallback |
| Health and readiness | S | `/healthz` (process), `/readyz` (DB, sources, change log writable), `/v1/platform/health` as a data source | runner; self-telemetry; screens |

### B.2 Data layer

| Capability | Class | Technical significance | Composes with |
|---|---|---|---|
| Source connector: Postgres | D | SQL pushdown for `orders` and `inventory` tables; read-only role | queries; panels; drill |
| Source connector: metrics (PromQL-compatible) | D | VictoriaMetrics locally, AMP on AWS, same compiled query shape | queries; alerts; annotations |
| Source connector: logs (LogQL subset) | D | Loki locally, CloudWatch Logs Insights on AWS, through the `LogSource` interface | drill-down; incidents; evidence panels |
| Source connector: platform self-telemetry | D | Lodestar's own metrics as a source, so the platform shows its own command latency | platform health board; screens |
| Query IR | D | Typed IR (`metric`, `filter`, `by`, `window`, `fn`, `transform`) compiled per source | every panel; agent queries; explain |
| Query preview | D | `query` returns rows, `truncated`, `estimated_series`, compiled dialect and applied policies | plan validation; agent self-correction |
| Transform pipeline | D | Pure column-array transforms: `filter`, `project`, `groupBy`, `bucket`, `ratio`, `topN`, `rollingWindow`, `zscore`, `join` (same source only) | panels; alerts; exports |
| Parameters | D | Typed variables (enum, duration, time range, entity ref) with query-backed options | cross-filter; drill; dashboards |
| Cross-filter | D | Selecting a series or row sets a parameter that re-runs dependent panels | parameters; panels |
| Drill-down | D | Click interaction maps a field to a target dashboard's parameters | parameters; logs; incidents |
| Computed metrics | S | Named derived queries with lineage, reusable as sources | queries; alerts |
| Lineage graph | D | Derived from references: query -> panel -> dashboard -> alert -> incident -> runbook | audit; changes; undo impact |
| Scheduled snapshot export | S | Recurring query snapshot saved as a `snapshot` entity (HTML/CSV) | exports; reports |

### B.3 Presentation layer

| Capability | Class | Technical significance | Composes with |
|---|---|---|---|
| Panel types: timeseries, stat, table, status grid, log stream, topology, markdown | D | Each reads a query ref and an options block; all render from the same spec | queries; parameters; drill |
| Dashboard with 12-column grid layout | D | Layout as data (`grid` per panel); field-level merge on layout | collaboration; branches |
| Annotations | D | Time-anchored notes linked to entities (changes, alerts, runbook runs) | panels; incidents; audit |
| Comments on panels | S | Threaded comments tied to a panel and a version | presence; review |
| Screens | D | A screen is a principal-owned display target; `screen.show` pushes a dashboard and parameters to all screens in the group | realtime; agent; presenter |
| Embed | S | Signed iframe URL for a dashboard, honoring the viewer's policy | policy; sharing |
| Sharing | S | Grants on dashboards, inherited by panels | policy; embed |
| Topology panel | S | Service graph from a declared dependency list in the `service` entity, not discovered traces | incidents; lineage |

### B.4 Operations layer

| Capability | Class | Technical significance | Composes with |
|---|---|---|---|
| Alert rule (threshold, for-duration, z-score) | D | Evaluated by the runner against a query ref; state machine: `ok -> pending -> firing -> resolved`, plus `acknowledged` | queries; incidents; notifications |
| Alert preview (backtest) | D | Dry run of a rule over a stored window, returning would-have-fired intervals | plan; agent self-correction |
| Notification route | S | In-app inbox and a local webhook sink; the route itself is a grant-checked entity | alerts; workflows; policy |
| Incident | D | Groups firing alerts, has an owner, a timeline built from changes and annotations | alerts; lineage; annotations |
| Workflow (runbook) | D | Typed steps with transitions and state history; steps reference actions | incidents; approvals; actions |
| Approval gate | D | A workflow step that waits for a decision by a human principal holding `approve` | policy; audit; workflows |
| Action | D | Typed side-effecting operation on the fleet adapter (`fleet.restart`, `fleet.fault`) with a required grant | workflows; approvals; audit |
| Form that writes back | S | Form entity whose submit issues a plan-apply through the command engine | policy; annotations |
| Fault console | D | Presenter-facing panel whose buttons run `fleet.fault` actions; not reachable through the agent's grants | actions; approvals; fleet |

### B.5 MCP surface

| Capability | Class | Technical significance | Composes with |
|---|---|---|---|
| Tool catalogue generic over kinds | D | Twenty tools, not one per kind; kinds are arguments validated by the registry | discovery; plan/apply |
| Resources (kinds, primitives guide, workspace inventory) | D | Read-only URIs the agent can fetch before acting | discovery; error recovery |
| Plan and apply | D | Two-step writes with a diff, validation and authz verdict before commit | undo; idempotency; screens |
| Progress notifications | D | MCP progress messages streamed to the screens as "agent is querying 3 sources" | screens; latency management |
| Prompt templates | S | Static investigation prompt (`investigate-incident`) that lists the tools in order | discovery; fallback |

### B.6 Composition map

```
          Sources (postgres, metrics, logs, self-telemetry, fleet)
                 |
              Queries (IR) ---- Parameters <---- Cross-filter / Drill
                 |                    |
        +--------+--------+           |
        |                 |           |
     Panels          Alerts (state machine)
        |                 |
   Dashboards        Incidents ---- Annotations ---- Changes/Audit
        |                 |
     Screens          Workflows ---- Approval gate ---- Actions (fleet)
        |
   Branches / Diff / Undo / Revert

  Web UI, HTTP API, MCP tools, runner  ==>  one Command Engine
  Command Engine  ==>  Validation -> Policy -> Change log (hash chain)
                       -> Fanout (SSE) / Audit / Undo / Lineage
```

Every arrow above is a typed reference in the entity model, so lineage, undo impact and authorization all walk the same graph. A query feeds a panel, an alert, a workflow, an export and a permission rule (a row policy). A workflow step can call an action that writes an annotation that a panel displays.

---

## C. Five-minute live script

### Staging before the audience sits down

- Harbor Checkout fleet running at the configured offered load; the platform's self-telemetry has been flowing for at least the query window used by the first panel.
- Workspaces `ops` and `finance` exist with seeded contents; `ops` has the `Checkout Fleet` dashboard; `finance` has `Monthly Refunds`.
- Presenter console (`/demo/console`) open on the presenter machine, showing only the presenter's own controls and a small status line. Audience screens show the dashboards.
- Claude Code is connected to `lodestar` as `agent:claude-demo` through the HTTP MCP endpoint. Its tool list is the twenty Lodestar tools and the resources.
- Second browser session logged in as Cass shows the same dashboard; a third as Ben shows `finance`.

### Timeline

| Time | Presenter action (exact words) | Expected behaviour, including MCP calls | Visible result | Capabilities demonstrated | Transition |
|---|---|---|---|---|---|
| 0–25 s | Presenter speaks: "This is a real checkout system, and the platform watching it, including itself. Every number is from a running process." Nothing typed. | Fleet dashboard streams from SSE. Platform self-telemetry panel shows command latency. | Nine services, live request rates, a green status grid. | Realtime fanout, real metrics, self-telemetry, status grid | Presenter switches to the agent pane. |
| 25–45 s | Types: `Put the checkout fleet on the main screen.` | Agent calls `lodestar.search` (kind `dashboard`, text `checkout`), `lodestar.get`, then `lodestar.screen_show` with the fleet dashboard. | Every screen switches to the fleet dashboard. | MCP discovery, screens, principal-scoped read | Presenter presses **Inject** on the fault console. |
| 45–75 s | Presses **Inject: pause payments** on the console. The console runs the `fleet.fault` action with the presenter's grant. Says: "Payments is now paused. The platform doesn't know that yet." | Container paused via the fleet adapter. Payments authorization p95 climbs in the query window. The `Payments authorization latency` alert goes `pending`, then `firing` after its for-duration (10 s). The runner writes an annotation and an incident entity; the incident's first change is in the change log. | A toast on all screens; the alert card flips red; an incident `INC-0142` appears in the sidebar. | Real fault, metric evaluation, alert state machine, incidents, annotations, realtime | Presenter types the investigation prompt. |
| 75–110 s | Types: `Why is checkout slow right now? Build an incident board on the main screen with evidence, and tell me which service is the cause.` | Agent calls `lodestar.describe_kind` (`dashboard`, `panel`), `lodestar.query` (error rate and p95 by service, 5m window), `lodestar.alerts`, `lodestar.query` on logs (`service=payments`, `level=error`, limit 20), `lodestar.lineage` on the incident, then `lodestar.plan` with one `create` for a dashboard `incident-0142` containing two panels, one annotation, and one drill from the service grid to logs. Then `lodestar.apply` with an idempotency key. Then `lodestar.screen_show`. | Progress lines on the screen ("querying 3 sources", "planning 4 changes"). The incident board appears on all screens with the pause annotation at the correct time and a log stream. | Query IR, transforms, logs, lineage, plan/apply, drill-down, annotations | Presenter opens the second browser as Cass. |
| 110–145 s | Presenter (as Cass) moves the timeseries panel in the incident board. Then types to the agent: `Add a panel for payments error rate by pod and link the service grid to it.` | Agent plans with `expected_version` from its read. Apply returns `E_VERSION_CONFLICT` with the current version and a 3-way diff of the layout field Cass changed. Agent calls `lodestar.get` on the panel, re-plans with the merged layout, applies. | The agent's new panel slots below Cass's moved panel rather than overwriting it. Presence shows Cass's cursor on the board and the agent's presence chip. | Presence, optimistic concurrency, field-level merge, conflict results, parameters | Presenter asks the agent for something the policy will refuse. |
| 145–180 s | Types: `Notify Ben in finance when payments is down, and add a restart runbook for payments that waits for approval.` | Agent plans a `notification route` in `finance`. Plan returns `authz.denied[0] = {code: E_FORBIDDEN_WORKSPACE, policy: grant:agent-ops-writer, message: "agent:claude-demo has no write grant in workspace finance; use ops or ask a workspace admin"}`. Agent re-plans the route in `ops` as an annotation and a routing draft for Ben to accept, creates a `workflow` `runbook-payments-restart` with steps `verify`, `approval`, `fleet.restart`, `verify`, and applies. | The denial appears on the screen as a policy card, then the runbook appears in `ops` with its approval step waiting. | Policy denial with explicit reason, rich error recovery, workflows, approval gate, scoped principal | Presenter switches to Cass for approval. |
| 180–215 s | Cass approves step 2 in the Runbook view. Presenter says: "Approval is a human grant. The agent can't press this." | Workflow transitions `waiting -> running`. Action `fleet.restart` restarts the payments container through the adapter. Runner records the change and the `mcp_call` history. The alert transitions `firing -> resolved` after the first healthy scrape window. The verify steps record their query results. | The runbook shows each state transition with timestamps; the alert resolves; the incident timeline gains "restarted by cass (approved)". | Approval, actions, workflow state history, alert resolution, audit | Presenter asks the question no dashboard was built for. |
| 215–245 s | Types: `What changed in the last 15 minutes, and who changed it? Show it as a table, and show the agent's work as a diff against main.` | Agent calls `lodestar.changes` (window 15m, workspace `ops`), `lodestar.get` with `include: ["history"]`, `lodestar.plan` for a table panel grouped by principal and client, `lodestar.apply`, and a diff call on the agent's board versus its `main` state. | A table grouped by principal (`cass`, `agent:claude-demo`, `runner`) and a diff card with the agent's four changes. | Change log query, audit, branch diff, generated UI | Presenter asks for the undo. |
| 245–270 s | Types: `Undo the drill I asked for on the incident board. Show me the undo first.` | Agent calls `lodestar.undo` with `dry_run: true`, returning the inverse patch and the affected panel, then `lodestar.undo` for real with a fresh idempotency key. | The drill link disappears on all screens; Cass's panel layout is unchanged. The change log shows an `undo` change referencing the original sequence number. | Undo as a first-class change, dry run, inverse patch, realtime removal | Presenter types the closing prompt. |
| 270–300 s | Types: `Which customers saw checkout errors in the last 5 minutes, and where? Build me a table for the main screen.` Then presses **Inject: pause orders** on the console, and says: "Watch the board, not me." | Agent calls `lodestar.query` on Postgres (`orders` joined to `customers` only if on the same source; here the join is within `ops` source) with the email column masked for the agent principal, plans a table, applies, shows it. The pause of orders is real. The incident board's `orders` row turns red before the alert, because the stat panel uses a 10 s window. | A table of customer segments and regions with masked emails, built in under 15 s; the orders health row changes in the same frame as the new table appears. | Row and column policy, Postgres connector, generated UI, live fault propagation | End card: change log and audit visible on the screen. |

### Why the first 30 s and last 30 s carry the weight

The first 25 s set purpose and show that the data is live with no narration beyond one sentence. The last 30 s combine three things the audience cares about: a question nobody pre-built a dashboard for, a live fault, and the same platform showing that the agent cannot see unmasked customer emails. The strongest moment is the masked table appearing on the main screen in the same frame as the orders fault becomes visible on the incident board.

### Deterministic fallback driver

The fallback is the real MCP path, not an animation.

1. **Recording.** A rehearsal run writes `demo/script/v1.jsonl`. Each line is one MCP call: tool, arguments with ids replaced by stable names, the expected result hash with volatile fields (timestamps, request ids, latencies) excluded, and a `checkpoint` marker where the fallback may take over. Checkpoints sit at the start of each timeline row.
2. **Replay client.** `lodestar demo drive --mode replay` is an ordinary MCP client connected as `agent:claude-demo` over the same endpoint. It resolves stable names to the ids it created, issues the same calls, and compares result hashes. Audit rows show the agent principal and `client = demo-driver`; the on-screen attribution says `agent:claude-demo`, which is the same principal.
3. **Replay telemetry.** In replay mode the metrics and log sources point at the rehearsal snapshot, so panel numbers match the recording. The source is named `snapshot:rehearsal-<id>` in the explain output, so the mode is visible to anyone who looks.
4. **Takeover rules.** Takeover happens only at a checkpoint. The driver first calls `lodestar.revert_to(checkpoint_seq)` (a real, audited revert) if the live agent wrote anything since the checkpoint, then continues the recording. Triggers: no MCP call from the live agent for 12 s while a call is expected; two consecutive tool errors on the same step; the presenter presses **F9** on the console.
5. **Invisibility.** Takeover is designed to be a visible continuation, not a cut. The screens show the same progress lines because the replay driver emits the same progress notifications. If the live agent is mid-thought at the checkpoint, the presenter's agent pane shows its last message and the driver's first call supersedes it. The presenter's console shows a single status word, `live` or `replay`, which the audience never sees.

---

## D. Technical architecture

### D.1 Components and languages

| Component | Implementation | Justification |
|---|---|---|
| `lodestar-core` | TypeScript on Node 22, ESM | One language end to end, so the kind registry validates web, API and MCP input from one definition. Node's single-threaded event loop is adequate for the write rate of a demo workspace and keeps the command engine readable. |
| `lodestar-api` | Fastify, OpenAPI generated from TypeBox schemas, SSE for streams, `ws` for presence | Fastify has low overhead and first-class schema validation. SSE is one-directional and resumable with `Last-Event-ID`, which fits change fanout. |
| `lodestar-mcp` | `@modelcontextprotocol/sdk` (TypeScript), Streamable HTTP transport and stdio | The SDK is the reference implementation of the protocol the external agent speaks. |
| `lodestar-query` | Query IR, compilers to SQL, PromQL and LogQL-subset, pure transform runtime over typed column arrays | A small IR keeps the agent's query surface stable across sources; transforms run in-process so they behave identically on every source. |
| `lodestar-runner` | Node process: alert evaluator, workflow executor, snapshot scheduler, single active leader via `pg_try_advisory_lock` | Leader election through Postgres avoids a second coordination system. |
| `lodestar-web` | React 18, TypeScript, Vite, uPlot for time series, TanStack Table, react-grid-layout for the dashboard grid | uPlot is small and fast enough for dense series. The grid is data-driven, so the layout is part of the entity spec. |
| `harbor-*` services | Node 22 services with `prom-client` and structured JSON logs | Same toolchain as the platform, so the fleet is also a reproducible image family. |
| Fleet fault adapter | Docker Engine API locally, ECS API on AWS, behind one `FleetAdapter` interface; Toxiproxy for latency and timeout toxics | Faults are real process or network effects, not flags in the UI. |
| Load generator | k6 official image with a seeded scenario file | Fixed arrival schedule and client-side latency that the platform cannot influence. |

Datastores:

- **Postgres 16** for entities, changes, grants, plans, idempotency keys, workflow state, alert state, sessions, presence heartbeats, the harbor database, and the query-result cache table. One engine keeps transactional guarantees for the command engine and LISTEN/NOTIFY for fanout. The harbor `orders` and `inventory` schemas live in the same instance under separate roles.
- **VictoriaMetrics single-node** for metric series locally. It speaks the Prometheus remote write and query APIs and supports snapshots, which the replay mode needs.
- **Loki** for log lines locally, behind `LogSource`.
- **Redis** only for the harbor `cart` and `notify` services, which are part of the system being observed, not part of the platform.

Each store is listed because the demo needs it. Anything the platform does not need for the demo is absent (no search cluster, no message broker, no separate cache for the platform).

### D.2 Persistence model

```sql
create table workspace (
  id          uuid primary key,
  slug        text unique not null,
  name        text not null
);

create table principal (
  id            text primary key,              -- 'cass', 'agent:claude-demo', 'runner'
  kind          text not null check (kind in ('human','service','agent')),
  display_name  text not null,
  attributes    jsonb not null default '{}',   -- regions, teams, used by predicates
  disabled_at   timestamptz
);

create table entity (
  id           uuid primary key,
  workspace_id uuid not null references workspace(id),
  kind         text not null,
  slug         text not null,
  branch       text not null default 'main',
  version      bigint not null,
  spec         jsonb not null,
  status       jsonb not null default '{}',   -- runtime state: alert state, workflow state
  deleted_at   timestamptz,
  unique (workspace_id, kind, slug, branch)
);

create table change (
  seq           bigint generated always as identity primary key,
  workspace_id  uuid not null,
  branch        text not null,
  entity_id     uuid not null,
  op            text not null check (op in ('create','update','delete','undo','revert')),
  principal_id  text not null references principal(id),
  client        text not null check (client in ('web','api','mcp','runner','demo-driver')),
  request_id    text not null,
  plan_id       uuid,
  prior_version bigint,
  new_version   bigint not null,
  patch         jsonb not null,                -- RFC 6902
  inverse_patch jsonb not null,
  prev_hash     bytea not null,
  state_hash    bytea not null,                -- sha256(prev_hash || canonical(patch) || seq)
  created_at    timestamptz not null default now()
);

create table grant_rule (
  id           uuid primary key,
  principal_id text not null references principal(id),
  workspace_id uuid not null references workspace(id),
  kind         text,                           -- null means any kind
  actions      text[] not null,                -- read, write, plan, approve, action:fleet.restart
  effect       text not null check (effect in ('allow','deny')),
  predicate    jsonb not null default '{}',
  created_by   text not null,
  created_at   timestamptz not null default now()
);

create table plan (
  id           uuid primary key,
  principal_id text not null,
  workspace_id uuid not null,
  base_seq     bigint not null,
  ops          jsonb not null,
  diff         jsonb not null,
  validation   jsonb not null,
  authz        jsonb not null,
  expires_at   timestamptz not null,
  applied_seq  bigint
);

create table idempotency (
  principal_id text not null,
  key          text not null,
  request_hash bytea not null,
  result       jsonb not null,
  expires_at   timestamptz not null,
  primary key (principal_id, key)
);

create table mcp_call (
  id           bigserial primary key,
  principal_id text not null,
  tool         text not null,
  args_hash    bytea not null,
  args_redacted jsonb not null,
  status       text not null,
  error_code   text,
  plan_id      uuid,
  latency_ms   integer not null,
  created_at   timestamptz not null default now()
);

create table workflow_run (
  id           uuid primary key,
  workflow_id  uuid not null references entity(id),
  state        text not null,                  -- running, waiting_approval, succeeded, failed
  history      jsonb not null default '[]',    -- append-only transitions with principal and time
  started_by   text not null
);
```

Notes on the model:

- `entity.spec` is the declarative document (section D.3). The `status` column holds runtime state written only by the runner, so a spec change and a state change are never confused. Runtime state is still recorded in `change` rows, so it is auditable and undoable where that makes sense (acknowledgement, workflow transitions) and marked non-undoable where it does not (raw alert evaluation).
- `change.state_hash` is a tamper-evidence chain per workspace. Writes to a workspace serialize through `pg_advisory_xact_lock(hashtext(workspace_id))`. Throughput per workspace is a property to measure, not a claim here.
- Presence heartbeats live in a `presence` table with a 15 s liveness window; a two-instance deployment on AWS needs no shared memory beyond Postgres.

### D.3 Declarative specification language

Dashboards, panels, queries, alerts, workflows and grants are documents in one language. The agent writes documents; the platform renders them. There is no generated code path. The format is `lodestar/1`, JSON, with YAML accepted at the CLI and converted on input.

Example, the incident board the agent creates at 75–110 s (abridged where marked):

```json
{
  "$spec": "lodestar/1",
  "kind": "dashboard",
  "slug": "incident-0142",
  "workspace": "ops",
  "title": "INC-0142 checkout latency",
  "parameters": {
    "service": { "type": "enum", "source": { "query": "q.services" }, "default": "payments" },
    "window":  { "type": "duration", "options": ["5m", "15m", "1h"], "default": "15m" }
  },
  "queries": {
    "q.error_rate": {
      "source": "metrics.harbor",
      "ir": {
        "metric": "http_requests_total",
        "filter": { "status": { "gte": "500" } },
        "by": ["service"],
        "fn": "rate",
        "window": "$window",
        "transform": [ { "op": "ratio", "over": "requests_total", "by": ["service"] } ]
      }
    },
    "q.payments_logs": {
      "source": "logs.harbor",
      "ir": { "stream": { "service": "$service", "level": "error" }, "limit": 20 }
    }
  },
  "layout": { "columns": 12, "rowHeight": 56 },
  "panels": [
    {
      "id": "p_err",
      "type": "timeseries",
      "title": "Error rate by service",
      "query": { "ref": "q.error_rate" },
      "grid": { "x": 0, "y": 0, "w": 8, "h": 4 },
      "annotations": { "from": "changes", "where": { "entity.kind": "alert" } },
      "interactions": {
        "click": { "drill": "dashboard:payments-logs", "map": { "service": "$.series.service" } }
      }
    },
    {
      "id": "p_logs",
      "type": "log-stream",
      "title": "Payments errors",
      "query": { "ref": "q.payments_logs" },
      "grid": { "x": 8, "y": 0, "w": 4, "h": 4 }
    }
  ]
}
```

Rules the validator enforces (these are also the error messages the agent sees, section D.5):

- Every panel `type` has a closed set of allowed keys; unknown keys are errors with a did-you-mean suggestion.
- A `query.ref` must resolve in the same document or be an explicit `dashboard:` or `query:` reference the caller can read.
- `$param` references must name a declared parameter and be used in a position whose type matches.
- `grid` rectangles may not overlap unless the panel declares `layer`.
- `interactions.drill` targets must exist and the mapped parameters must exist on the target.
- `source` must be a registered source whose policy allows the caller's principal.

### D.4 Query and transform engine

- **Compilation.** The IR compiles to one of three dialects per source: SQL for the Postgres source with parameters bound, PromQL for the metrics source, a LogQL subset for logs. The compiler refuses constructs a source cannot express rather than emulating them. For example, `join` is allowed only when both sides share a source.
- **Policy at compile time.** Row predicates and column masks are appended during compilation from the caller's principal, so a masked column never reaches the transform stage. `query.explain` returns the applied predicates; an agent cannot remove them.
- **Transforms.** Pure functions over typed column arrays: `filter`, `project`, `groupBy`, `bucket`, `ratio`, `topN`, `rollingWindow`, `zscore`, `join`. Anomaly detection is a rolling z-score over a window, nothing more; the document says so.
- **Limits.** Preview returns at most 5,000 points by default (configurable per call up to 50,000), with `truncated` set when the limit bites. The compiler estimates series count from the source's label cardinality before running and refuses above a configured threshold with a message that suggests a `by` or `window` change.
- **Caching.** Query results are cached in Postgres keyed by (dialect, params, step, policy hash) with a short TTL. The cache is an optimisation, invisible in the output shape; the explain output reports `cache: hit|miss`.

### D.5 Real-time transport and collaborative editing

- **Change fanout.** The command engine commits a change, then issues `NOTIFY lodestar_changes, '<seq>'`. Payloads carry only the sequence number because LISTEN/NOTIFY caps payloads at 8,000 bytes. Subscribers fetch the change row, apply the RFC 6902 patch to their local copy, and filter by subscription.
- **Subscriptions.** A client opens one SSE stream per workspace and branch with `?kinds=` and `?entities=` filters. Panels subscribe to their query ref; the runner pushes refreshed series on a cadence that is configurable and defaults to the query window's step.
- **Resume.** SSE events carry the change seq as the event id. On reconnect the server replays from `Last-Event-ID`; if the gap exceeds the retained window, it returns `resync` and the client refetches the workspace snapshot.
- **Presence.** WebSocket per dashboard view. Cursor positions and selected panel are ephemeral and never written to the change log. Agent presence appears as a chip with its MCP session name.
- **Collaborative editing.** Writes carry `expected_version`. For layout fields (`grid`), if two writers touched disjoint paths since the base version, the server rebases and applies both. Otherwise it returns `E_VERSION_CONFLICT` with the current version and a three-way diff (base, theirs, mine). The UI shows a conflict card; the agent gets the same structure and re-plans.
- **No CRDT.** Enterprise dashboards are edited as documents with occasional concurrent writes to the same field, not as shared text. A CRDT would add a second merge model to undo, audit and diff. Field-level rebase with explicit conflicts covers the realistic cases and keeps one model.

### D.6 Authorization model

- **Principals.** `human`, `service`, `agent`. An agent principal is created by an admin with a declared scope and a token. It has no special code path.
- **Grants.** A grant names a principal, a workspace, an optional kind, a list of actions and an effect, plus an optional predicate over resource and principal attributes. Actions include `read`, `write`, `plan`, `approve`, `screen`, and `action:<name>` for each fleet action.
- **Evaluation.** Default deny. Explicit deny overrides any allow. Predicates are evaluated against `resource.attributes` and `principal.attributes`. Every decision is recorded in the plan's `authz` document with the matching grant id, so denials name the rule that caused them.
- **Agent scope in the demo.** `agent:claude-demo`: `read` on `ops`; `write` on `dashboard`, `panel`, `query`, `annotation`, `alert` (draft state only), `workflow` (create only) in `ops`; `screen` in `ops`; no `approve`; no `action:*`; no grants on any entity; no access to `finance` beyond a deny rule that makes the denial message name the reason. Row policy on `orders` for the agent: `region in principal.attributes.regions`, with `customers.email` masked.
- **Human scope.** Cass: `approve` and `action:fleet.restart` in `ops`. Ben: `read` on `finance`. Ada: admin.
- **Parity.** Web, API and MCP call the same policy function with the same inputs. The only difference recorded is `client`.

### D.7 Audit, versioning and undo

- Every write produces `change` rows. Every MCP call produces an `mcp_call` row with redacted arguments. The audit view joins the two.
- **Undo** creates a new change whose patch is the stored inverse, guarded by `prior_version` equal to the current version. If the entity has moved, undo returns a conflict with the current state rather than applying blindly.
- **Revert to seq** replays inverse patches in reverse order for all changes after `seq` in the workspace branch, as one plan. It is a dry-run-capable operation and the fallback driver's checkpoint mechanism.
- **Branches** are a column; `branch.create` copies the entity rows at a seq. Diff is computed over `spec` by JSON Pointer. Merge is a plan with the diff as its ops.

### D.8 The MCP server

#### Transport and authentication

- **Streamable HTTP** at `/mcp` for the presenter's agent and for remote clients; **stdio** via `lodestar mcp --stdio --principal <id>` for local development and for the fallback driver's in-process mode.
- **Authentication.** OAuth 2.1 bearer tokens. Humans use authorization-code with PKCE in the browser. The agent principal uses client credentials with a token lifetime of 3600 s, bound to its principal id. The server rejects tokens whose principal is disabled and checks the `Origin` header on HTTP to block DNS rebinding.
- **Principal from token.** Tool calls run as the token's principal. An MCP client cannot choose another principal in arguments.

#### Discovery

Resources (read-only URIs):

- `lodestar://kinds`: list of kinds with one-line purpose and the actions the caller may take on each.
- `lodestar://kinds/{kind}`: JSON Schema, a minimal valid example, common mistakes, and the enum values for each field.
- `lodestar://primitives/guide`: one page generated from the registry, describing how queries feed panels, how alerts feed incidents, how workflows and actions work, and the plan/apply rules. Generated, so it cannot drift from the code.
- `lodestar://workspace/{slug}/inventory`: entity counts by kind, owners, and the source list with label names and metric names the caller can read.
- `lodestar://sources/{name}/schema`: metric names with label sets (sampled from the last window) or table columns, with masked columns marked.

Prompts: `investigate-incident` lists the tools in the order a responder uses them, with no instructions that cannot be verified against tool results.

#### Tool catalogue

Signatures are shown as TypeScript-like types; the MCP input schema is the JSON Schema generated from the same definitions.

```ts
// Discovery and reads
describe_kind(input: { kind: string }): { schema: JSONSchema; example: object; caller_actions: string[]; common_mistakes: string[] }
search(input: { workspace: string; kind?: string; text?: string; limit?: number /* default 25, max 200 */; cursor?: string }): { items: { id: string; kind: string; slug: string; title: string; version: number }[]; next_cursor?: string }
get(input: { ref: string; include?: ("spec" | "status" | "lineage" | "history")[] }): { id: string; kind: string; version: number; branch: string; spec: object; status?: object; lineage?: Graph; history?: Change[] }
changes(input: { workspace: string; since_seq?: number; window?: string; principal?: string; kind?: string; entity?: string; limit?: number }): { changes: Change[]; head_seq: number }
sources(input: { workspace: string }): { sources: { name: string; kind: "metrics" | "logs" | "sql" | "self"; attributes: string[] }[] }
source_schema(input: { source: string }): { fields: { name: string; type: string; masked: boolean; cardinality_hint?: number }[] }

// Queries and previews
query(input: { query: QueryIR | { ref: string }; params?: Record<string, unknown>; limit_points?: number }): { columns: string[]; rows: unknown[][]; truncated: boolean; estimated_series: number; cache: "hit" | "miss" }
query_explain(input: { query: QueryIR; params?: Record<string, unknown> }): { dialect: string; compiled: string; policies_applied: string[]; warnings: string[] }
alerts(input: { workspace: string; state?: ("ok" | "pending" | "firing" | "acknowledged" | "resolved")[] }): { items: { id: string; rule: string; state: string; since: string; value: number }[] }
alert_preview(input: { rule: AlertSpec; window: string }): { would_have_fired: { from: string; to: string; peak: number }[]; evaluated_points: number }
lineage(input: { ref: string; direction: "upstream" | "downstream" | "both"; depth?: number }): { nodes: Node[]; edges: Edge[] }

// Writes: plan, then apply
plan(input: { workspace: string; branch?: string; base_seq?: number; label?: string; ops: Op[] }): { plan_id: string; diff: PatchSummary[]; validation: { errors: ValidationError[]; warnings: ValidationError[] }; authz: { allowed: boolean; denied: { op_index: number; code: string; grant_id?: string; message: string }[] }; expires_at: string }
apply(input: { plan_id: string; idempotency_key: string }): { applied_seq: number; entities: { id: string; version: number }[]; undo_seq: number }
undo(input: { change_seq: number; idempotency_key: string; dry_run?: boolean }): { inverse: PatchSummary; affected: { id: string; kind: string }[]; applied_seq?: number }
revert_to(input: { workspace: string; seq: number; branch?: string; dry_run?: boolean; idempotency_key?: string }): { reverted: number; diff: PatchSummary[]; applied_seq?: number }
branch_diff(input: { workspace: string; from: string; to: string; kind?: string }): { changes: PatchSummary[] }

// Operations
screen_show(input: { screen: string | "all"; dashboard: string; params?: Record<string, unknown> }): { delivered_to: number }
annotate(input: { workspace: string; at: string; text: string; refs?: string[]; idempotency_key: string }): { id: string; applied_seq: number }
workflow_run(input: { ref: string; inputs?: object; dry_run?: boolean; idempotency_key?: string }): { run_id: string; state: string; next_step?: string }
export(input: { ref: string; format: "html" | "csv"; params?: object }): { url: string; expires_at: string }
presence(input: { workspace: string; dashboard?: string }): { viewers: { principal: string; kind: string; panel?: string }[] }
```

Deliberately absent: grant tools (an agent cannot change its own permissions), approval tools (an agent cannot approve), fault injection (`action:fleet.fault` is not granted to the agent and is not offered in `tools/list` for its token; the tool list is filtered by grant, so the agent cannot even see a route to it).

Plan and apply semantics:

- A plan is a snapshot of `base_seq` plus the ops. Apply rejects with `E_PLAN_STALE` if the workspace head has moved beyond the base in any entity the plan touches, and re-plans automatically only if the caller passes `rebase: true`.
- Plans expire (configurable, default 300 s). Applying an expired plan returns `E_PLAN_EXPIRED` with the command to create a new plan.
- Apply is all-or-nothing: one transaction, one hash chain segment.

#### Validation messages designed for self-correction

Every error has the same shape:

```json
{
  "error": {
    "code": "E_UNKNOWN_FIELD",
    "path": "ops[0].spec.panels[1].by",
    "message": "Field 'by' is not valid on panel type 'timeseries'. Grouping belongs on the query: move it to queries.<ref>.ir.by.",
    "valid_fields": ["id", "type", "title", "query", "grid", "annotations", "interactions"],
    "suggestion": { "op": "move", "from": "panels[1].by", "to": "queries.q.error_rate.ir.by" },
    "retryable": true,
    "docs": "lodestar://kinds/dashboard#panels"
  }
}
```

Codes the agent sees often enough to matter: `E_UNKNOWN_FIELD`, `E_TYPE_MISMATCH` (with expected type), `E_UNKNOWN_REF` (with the nearest existing refs), `E_FORBIDDEN_WORKSPACE`, `E_FORBIDDEN_ACTION` (with the grant that is missing, not the full policy), `E_VERSION_CONFLICT`, `E_PLAN_STALE`, `E_RATE_LIMITED` (with `retry_after_ms`), `E_SERIES_LIMIT` (with a suggested `by` or `window`), `E_IDEMPOTENCY_MISMATCH`, `E_UNSAFE_CONSTRUCT` (for example a raw PromQL string where IR is required).

Each message names the field and proposes the smallest correction. The validator never silently coerces a field: coercion would hide hallucinated fields and produce plans whose diff the agent did not expect.

#### Idempotency

`apply`, `undo`, `revert_to`, `annotate`, `workflow_run` require an `idempotency_key`. The key is scoped to the principal. A repeat with the same key and the same request hash returns the stored result with `replayed: true`. A repeat with a different hash returns `E_IDEMPOTENCY_MISMATCH`. Keys expire after 24 h of storage (a retention quantity, not a work estimate).

#### Rate limits

Token buckets per principal: writes 60 per minute with burst 20; previews 20 per second with burst 40; `query` results capped by `limit_points`. Limits are visible in the `lodestar://` discovery resource so a well-behaved agent can read them before hitting them.

#### Prompt injection

The agent reads data written by others: log lines, entity titles, panel descriptions, annotation text. Treatment:

- Tool results put untrusted text in fields whose names end in `_text` and that are typed as `untrusted_string`; the MCP tool description states that such fields are data, not instructions.
- Log lines are truncated to 512 bytes, control characters escaped, and never placed in tool descriptions or resource URIs.
- Markdown panels are sanitised to a fixed allowlist; links are rendered as text with the target shown.
- No tool executes content read from data. Actions run only from workflow definitions that a human-role principal created or approved.
- The agent cannot widen its own grants, and approval is structurally unavailable to it. A prompt injected into a log line can at most make the agent write dashboards in `ops`, which is attributed, audited and undoable.

The design assumes injection will be attempted by accident, not adversarially. It is handled by structure, not by asking the model to ignore text.

---

## E. AWS and local deployment

### One image family, two environments

- Images are immutable: tagged by git SHA and referenced by digest in deployment manifests. No `latest`.
- `lodestar-app` is one image containing `api`, `mcp`, `runner` and the built web assets. The role is a command argument, not a separate image, so the three roles cannot drift.
- `harbor-storefront`, `harbor-cart`, `harbor-orders`, `harbor-inventory`, `harbor-payments`, `harbor-notify` are one Dockerfile with a build argument per service.
- Third-party images (Postgres 16, VictoriaMetrics, Loki, Redis, Dex, Toxiproxy, k6) are pinned by digest in both environments.

### Local

- `lodestar up` runs `docker compose` with the same images as AWS. Services: `app-api`, `app-runner`, `postgres`, `victoriametrics`, `loki`, `redis`, the six harbor services, `toxiproxy`, `k6`, `dex`, `caddy` for local TLS.
- `lodestar demo reset` stops the load, drops and recreates the `ops`, `finance` and `sandbox` workspaces from the seed, restores harbor containers to their images, clears Toxiproxy toxics, and waits for `/readyz`. It refuses while a fault is active unless `--force`, and then restores before resetting.
- `lodestar demo rehearse` runs the fallback driver end to end against a fresh reset and compares result hashes to the recording. This is the automated rehearsal the brief requires.
- Dex issues OIDC tokens for the human users; the agent principal's client-credentials secret is in a local env file excluded from git.

### AWS

- **Compute.** ECS on Fargate for `app-api`, `app-runner` (desired count one, leader election in Postgres), and the harbor services. ALB terminates TLS for `lodestar.<domain>`; `/mcp` and `/v1/*` route to the API target group.
- **State.** RDS for PostgreSQL 16, Multi-AZ off for the demo tier and on for any shared deployment. No RDS-only extensions or features.
- **Metrics.** Amazon Managed Service for Prometheus for the live source, written by an OpenTelemetry collector sidecar that scrapes harbor and the platform. Queried through the AMP API with SigV4 signing inside the metrics adapter.
- **Logs.** CloudWatch Logs with Logs Insights behind the `LogSource` interface. The adapter compiles the same LogQL subset to Logs Insights queries.
- **Identity.** Amazon Cognito user pools as the OIDC issuer, with the same claim names as Dex locally.
- **Secrets.** Secrets Manager for the agent client secret and database credentials, injected as environment variables by the task definition.
- **Fault adapter.** `FleetAdapter` calls ECS StopTask and task restart for kill and restart, and the Toxiproxy sidecar's API for latency and timeout toxics. "Pause" maps to a Toxiproxy `timeout` toxic on the payments listener, which is observably similar and reversible; the document names this difference.
- **Replay telemetry on AWS.** The fallback needs snapshot numbers. A VictoriaMetrics instance inside the VPC, from the same image as local, is seeded from the rehearsal snapshot. The live panels query AMP; the replay panels query the snapshot instance. The source name in explain output tells the two apart.

### What differs and why behaviour is unchanged

| Concern | Local | AWS | Why behaviour is the same |
|---|---|---|---|
| Metrics store | VictoriaMetrics | AMP | Same PromQL subset, compiled by one compiler. A conformance suite runs the same 40 queries against both and compares results within a documented tolerance. |
| Logs | Loki | CloudWatch Logs Insights | `LogSource` contract; the compiler emits per-backend text; the same conformance suite checks filter, limit and ordering semantics. |
| Identity | Dex | Cognito | Same OIDC discovery, audience and claim names; the authorization code only reads `sub`, `groups` and `principal` claims. |
| Database | Postgres 16 container | RDS Postgres 16 | Same major version and extensions. Migrations run identically. |
| Fault "pause" | `docker pause` | Toxiproxy timeout toxic | Both produce the same observable symptom (requests exceed client deadline). The action records which mechanism ran. |
| Fleet restart | Docker API | ECS API | Same action contract; the result includes the task or container id and the healthy-after timestamp. |

The parity document lists each difference and the test that shows its effect is bounded. Nothing in the platform's logic branches on environment.

### MCP exposure

- **Local.** `http://localhost:8080/mcp` through Caddy on `https://lodestar.localhost` for clients that require TLS. Stdio transport available for the fallback driver and for tools that prefer it.
- **AWS.** `https://lodestar.<domain>/mcp` behind ALB. Humans authenticate with OAuth 2.1 authorization code with PKCE; the agent uses client credentials with a 3600 s token lifetime and a per-principal secret rotated before the demo.
- **Both.** `Origin` checks, a host allowlist, a principal-bound token, and the same grant evaluation. The MCP server does not trust `X-Forwarded-*` headers beyond the ALB or Caddy hop it is configured for.

---

## F. Five strongest technical claims

### Claim 1: A plan's diff is the diff that apply writes

For any valid batch of ops, the diff returned by `plan` equals, byte for byte in canonical JSON, the set of `change` patches `apply` writes, and the resulting state hash matches the state hash computed from the plan's base plus the ops.

- **Test.** A property-based test (fast-check, 2,000 generated op batches over the `dashboard`, `panel`, `query` and `annotation` kinds, including invalid batches that must fail validation identically in plan and apply). Assert `canonical(plan.diff) == canonical(changes.map(c => c.patch))` and `stateHash(base, ops) == change.state_hash(head)`.
- **Observable.** `lodestar plan --verify` on the presenter machine runs the same comparison against a live plan. The audience sees the agent's plan panel and the change list agree.

### Claim 2: Undo and revert are exact

After any random sequence of up to 200 changes across three principals, `revert_to(seq)` restores the workspace to a state whose hash equals the hash recorded for `seq` in the chain, and a subsequent `apply` of the reverted changes reproduces the later state hash.

- **Test.** A property-based test over random sequences including deletes, layout changes and concurrent-looking writes (rebased). Assert hash equality at each checkpoint, and that the chain verifies end to end with `lodestar audit verify`.
- **Observable.** At 240–270 s the drill is removed from every screen within the realtime budget, and `audit verify` runs on the presenter console during the reset.

### Claim 3: A fault becomes an alert on every screen within a bounded time, and recovery is visible on the same path

From a real container or network fault to the alert state change appearing on N connected screens, the latency is bounded by the scrape interval, the for-duration, and one SSE hop.

- **Design target (not yet measured).** p95 at or below 20 s from fault injection to `firing` on three screens, for a 5 s scrape interval and a 10 s for-duration. The breakdown is 5 s worst-case scrape wait, 10 s for-duration, at most 2 s query evaluation, and at most 1 s SSE delivery, with the remainder as margin.
- **Test and measurement.** `lodestar demo measure --runs 20` injects the fault through the fleet adapter, records the container event time, the first scrape that shows the effect, the `change` seq for the alert state, and the SSE receipt time on three clients. It reports the distribution. The brief allows measured quantities; this figure is reported only from a run.
- **Recovery.** The same harness measures `resolved` after restart. The claim covers both edges.

### Claim 4: The fallback is the real MCP path and produces the same state

Replaying the recorded script against a reset workspace produces the same ordered change patch hashes as the recorded live run, the same MCP result hashes for all calls whose results exclude volatile fields, and the same final state hash. Takeover at a checkpoint after a partial live run reaches the same final state hash as an uninterrupted replay.

- **Test.** `lodestar demo rehearse` in the stack's verification stage: reset, replay, compare patch hashes and result hashes, then reset, run the live-prefix up to checkpoint 3 with a simulated stall, take over, and compare final state hashes.
- **Observable.** The audit view for the fallback run shows `client = demo-driver` for every change and the agent principal as the actor. An auditor who looks cannot tell it from a live run except by `client`.

### Claim 5 (MCP path): A general agent with only the server's descriptions builds the answer

Given only the resources and tool descriptions, with no bespoke prompt beyond the question, a pinned general-purpose model answers a fixed set of ten investigation questions by building a panel or dashboard that a checker can verify, using a median of 12 or fewer MCP calls, and resolves every validation error within one retry.

- **Test.** An evaluation harness (`lodestar eval mcp`) with ten questions against the rehearsal snapshot. For each run it checks: the created entity exists with a valid spec; the panel's query returns the expected series; the agent's writes are all in `ops`; no `E_UNKNOWN_FIELD` remains unresolved after a retry; no tool call targets a tool absent from `tools/list`.
- **Observable.** The eval report lists each call and its error code. The number is measured per model version and reported only as measured.

---

## G. Failure analysis

### G.1 Implementation difficulties

- **Fanout correctness under restarts.** Subscribers can miss notifications while disconnected. Resume depends on `change` replay, and the retained window must be long enough to cover a reconnect after an ALB target change. The design returns `resync` rather than guessing.
- **Counter resets.** Restarting a harbor container resets its counters. `rate()` handles resets, but a naive `ratio` panel shows a dip. The transform runtime must use reset-aware rates, and the recovery moment at 180–215 s depends on that being right.
- **PromQL and LogQL edge semantics.** Step alignment, staleness markers and empty-series behaviour differ between VictoriaMetrics and AMP. The compiler restricts the accepted subset and the conformance suite pins the behaviour. Anything outside the subset is refused with `E_UNSAFE_CONSTRUCT`.
- **Hash chain under concurrency.** Per-workspace advisory locks serialize writes. Long previews must not hold the lock; only apply does.
- **Field-level rebase.** Deciding that two writers touched disjoint layout paths is easy; deciding that a `grid` rectangle overlap is a conflict requires the layout solver to run inside the validator. This is more code than it looks.
- **Undo of deletes that are referenced.** Undoing a delete must check that referenced entities still exist and that inverse patches do not resurrect dangling references. The plan validator owns this check.
- **Schema generation.** TypeBox to JSON Schema to MCP input schema to OpenAPI must agree. Drift here shows up as the agent receiving a schema that the API then rejects.

### G.2 On-stage failure modes and mitigations

| Failure | What the audience sees | Mitigation in the design |
|---|---|---|
| Agent makes a wrong tool call (writes a panel to the wrong workspace) | A change appears in a place the presenter did not intend | `plan` names the target workspace in the first line of its summary; the agent's grants cannot write to `finance`; undo is one call and is in the script at 245 s anyway |
| Agent hallucinates a field name | A validation error appears in the agent pane, followed by a correction | Errors include `valid_fields` and a suggestion. The script allows one retry per step. A repeated error is a checkpoint-takeover trigger |
| Agent is slow (silence over 12 s while a call is expected) | Pause on screen; progress lines stop | Progress notifications keep the screen alive during long queries. Silence past 12 s triggers takeover at the next checkpoint |
| Agent refuses or asks a clarifying question | The agent asks what workspace to use | Every prompt in section C names the workspace and the target. The fallback driver never asks |
| Agent is unreachable (network at the venue) | Agent pane shows a connection error | The fallback driver runs fully offline against the local stack, so the platform's behaviour is unaffected |
| Laptop resource exhaustion | Charts stall, SSE lags | Fleet and load are fixed-size; the self-telemetry panel shows the platform's own latency so the presenter can see pressure before the audience does. Reset refuses to run during a fault |
| Fault collides with reset | Services in a half-state | Reset restores the fleet before reseeding and waits for `/readyz` on each service |
| Clock skew or timezone confusion on charts | Annotations appear at the wrong time | Server stores UTC; the browser renders local time; the annotation for the pause is written from the fault adapter's event timestamp, not the client's clock |
| Projector or screen disconnect | One screen stale | Each screen reconnects with `Last-Event-ID` and shows the sequence it has reached in the corner for the presenter |

### G.3 Agent failure modes, specifically

- **Wrong tool, right intent.** The agent calls `query` on the metrics source with a PromQL string. The validator returns `E_UNSAFE_CONSTRUCT` and suggests the IR form. This is an intended path to correctness, not a failure.
- **Over-building.** The agent creates six panels where two are asked for. The plan diff makes this visible; the presenter can say so. The design does not forbid it.
- **Stale reads.** The agent plans against a version that Cass just changed. `E_VERSION_CONFLICT` with the three-way diff is the designed outcome.
- **Attribution confusion.** The agent names a principal or a change incorrectly in its narration. The audience sees the change log, which is authoritative.

### G.4 Hidden complexity

- Query preview cost control, specifically series-count estimation before running a query, which requires label cardinality statistics the sources do not all provide. The metrics source estimates from a sampled label set; the SQL source uses a bounded `EXPLAIN`.
- Workflow engine resumption after a process restart mid-approval. The runner must re-read `waiting_approval` runs on start, and must not re-run completed actions. Idempotent action records make this safe; the design depends on them.
- Drill mapping from a series label to a parameter type, including escaping of label values that contain spaces or quotes.
- Presence cleanup when a browser closes without a clean disconnect.
- The MCP progress notification path must not block the apply transaction; progress is emitted from the query stage only.

### G.5 Features that look impressive but are shallow

The list is deliberate. Each of these is real code, but a serious engineer will see its limits quickly:

- **Anomaly detection** is a rolling z-score over a window. It is not seasonal, not multivariate, and not trained. The document says so on the panel.
- **Embedding** is a signed iframe URL for a dashboard. It has no cross-origin messaging API.
- **Multi-tenancy** is workspace isolation inside one deployment. There is no tenant billing, no tenant-level quotas and no per-tenant encryption keys.
- **Lineage** is derived from references between entities and from query-to-source edges. It is not column-level data lineage.
- **Topology** is drawn from a declared service dependency list, not from traces or service discovery.
- **Scheduled reports** produce snapshots stored in the platform and downloadable via an expiring URL. There is no email delivery.
- **Notifications** go to the in-app inbox and a local webhook sink. There is no paging integration.
- **Presence** shows names, a panel focus and a cursor. It is not a document-level lock.
- **Approval** is a single-approver gate. Multi-party quorum is not implemented.
- **Branches** are a column with copy-on-create. They are not a git-like object model and merges are plans, not three-way merges of arbitrary specs.

---

## H. Feasibility

### H.1 Scope by component

| Component | What the work touches | Depends on |
|---|---|---|
| Kind registry and validator | TypeBox definitions for each kind, generated JSON Schema, the error model | nothing |
| Entity store, change log, hash chain | Two tables, the command engine, the advisory lock, the NOTIFY fanout | kind registry |
| Plan/apply and idempotency | Plan table, expiry, stale checks, idempotency table | command engine |
| Policy engine and grants | Grant table, evaluation function, authz record in plans, parity tests across web, API and MCP | command engine |
| Query IR and Postgres compiler | IR types, SQL compiler, parameter binding, row and column policy injection | entity store, grants |
| Metrics compiler and VictoriaMetrics source | PromQL subset compiler, remote write from harbor, query adapter | IR |
| Transform runtime | Pure column-array functions, reset-aware rate, z-score | IR |
| Log source | LogQL subset compiler, Loki adapter | IR |
| Web UI | Dashboard grid, panels, parameters, cross-filter, drill, plan review, changes view, audit view, presenter console | SSE fanout, query preview |
| Runner | Alert evaluator and state machine, incident grouping, workflow executor with approval, snapshot scheduler | query engine, command engine |
| Fleet and faults | Harbor services, Toxiproxy wiring, `FleetAdapter` for Docker, the fault console actions | harbor images |
| MCP server | Tool definitions, resources, progress notifications, token-to-principal binding, tool filtering by grant | command engine, grants, query |
| Fallback driver and recording | Recording format, stable-name resolution, checkpoints, replay telemetry snapshot, takeover rules | MCP server, snapshot source |
| Conformance and property tests | Plan=apply, undo/revert, authz parity, query conformance across backends | everything above |
| AWS target | ECS, RDS, AMP, CloudWatch adapter, Cognito, ALB, Secrets Manager, OpenTelemetry collector | every component's container image |

### H.2 Critical dependencies

- **MCP SDK behaviour for Streamable HTTP, progress notifications and tool-list filtering by principal.** The design assumes the SDK exposes these cleanly. Verify against the pinned SDK version before the MCP server is built.
- **Postgres LISTEN/NOTIFY under connection pooling.** The notifier needs a dedicated connection outside the pool. A pooler in front of Postgres on AWS (RDS Proxy) does not support LISTEN, so the API tasks connect to RDS directly.
- **VictoriaMetrics and AMP query parity** for the chosen PromQL subset.
- **Cognito and Dex claim parity** for the authorization code.
- **Toxiproxy and Docker behaviour** on the presenter machine, including resource limits.
- **External agent connectivity** for the live path. The fallback removes this as a hard dependency for the platform, not for the live moment.

### H.3 Main risks and what reduces them

| Risk | Reduction |
|---|---|
| Agent tool design is weaker than the eval target | Build the eval harness early against the vertical slice, so the descriptions are tuned on evidence |
| Field-level rebase is more complex than the design shows | Ship whole-entity conflicts first; add field rebase for `grid` only after the conflict path is proven |
| Query compiler subset grows | The refusal list is part of the spec; new constructs require a conformance test on both backends |
| Replay drift between recording and live numbers | Replay telemetry is a snapshot, and the rehearsal stage compares hashes; a drift is a failing stage, not a surprise on stage |
| Fault semantics differ between Docker and ECS | The action result records the mechanism; the audience sees the same symptom; the difference is documented |
| Screens lag under the self-telemetry load | Self-telemetry panels are capped in cardinality; the platform's own metrics use a fixed label set |

### H.4 Build sequence, dependency-ordered

Each step produces something runnable and testable and unblocks the next. There are no calendar commitments in this sequence; it is an order.

1. **Minimal vertical slice.** Kind registry for `dashboard` with a single text panel; entity store; change log with hash chain; command engine with `plan` and `apply`; one principal; SSE fanout; a web page that updates. Done when an MCP `apply` changes a page open in another browser and `audit verify` passes.
2. **Query IR and metrics source.** Harbor `storefront` and `payments` only, with metrics; VictoriaMetrics; the metrics compiler; the `timeseries` and `stat` panels; `query` and `query_explain` tools. Done when a panel renders live series and `query_explain` shows the compiled PromQL.
3. **Grants and the agent principal.** Grant table, evaluation, tool filtering by grant, `E_FORBIDDEN_*` errors with grant ids, token binding. Done when the finance denial appears with its grant id in the plan.
4. **Validation and error model.** Did-you-mean suggestions, `valid_fields`, `E_UNKNOWN_REF`, `E_TYPE_MISMATCH`. Done when the eval harness's first five questions run with error recovery.
5. **Alerts, annotations and incidents.** Runner, state machine, for-duration, incident grouping, annotations linked to changes. Done when a real `pause` produces an incident and the annotation shows on the panel.
6. **Fault actions and workflows with approval.** `FleetAdapter`, `fleet.fault` and `fleet.restart`, workflow executor, waiting-approval state, idempotent action records. Done when a human approval resumes a run after a runner restart.
7. **Presence, conflicts and field rebase.** WebSocket presence, `E_VERSION_CONFLICT`, grid rebase. Done when two browser sessions and the agent edit one board without losing either change.
8. **Undo, revert, branches and diff.** Inverse patches, `undo` and `revert_to` with dry runs, branch column, `branch_diff`, audit view. Done when the 245–270 s undo and the 215–245 s diff both work from the agent.
9. **Full fleet and self-telemetry.** Remaining harbor services, Redis and Postgres exporters, platform metrics as a source, `screen_show`. Done when the fleet dashboard runs at the configured load for the whole scenario.
10. **Row and column policy and Postgres source.** Orders and customers in the harbor database, predicate injection, masked columns for the agent. Done when the 270–300 s query returns masked emails for the agent and clear emails for Ada.
11. **Recording, replay telemetry and fallback driver.** Recording format, stable names, checkpoints, snapshot source, takeover rules, F9. Done when `demo rehearse` passes the replay-equivalence check.
12. **Claims suite.** Plan=apply property test, undo property test, fault-to-screen measurement harness, MCP eval harness. Done when each runs in the stack's verification stage and reports its result.
13. **AWS target.** ECS task definitions from the same digests, RDS, AMP and the CloudWatch adapter behind the same interfaces, Cognito, ALB, the conformance suite run against both backends. Done when the conformance suite passes on both and the rehearsal passes on AWS.

### H.5 How the work is verified

- Cheap checks (type check, formatting, lint) run per change. Test suites run once per stack on the integration line, as the workflow rules require.
- Each step's "done when" is an executable check, so progress is observable without anyone reporting it.
- The conformance suite, the property tests and the rehearsal are the three gates that protect the demonstration: the platform's semantics, the agent path's behaviour, and the on-stage script.

### H.6 What is deliberately not in the first slice

- The Postgres source, the log source, presence, branches, the AWS target and the fault console are all after the vertical slice because each depends on the command engine and the grant model, and none is needed to prove the core path.
- The fallback is built after the MCP server is stable, because a recording of an unstable tool surface would need re-recording at every change to a tool description.

---

## Closing note on the bar

The mandate is resilience, so the platform's credibility depends on three things being visibly true: the faults are real processes, the alerts come from real metrics, and the agent's changes are attributable and reversible. The design spends its complexity on those points (the plan/apply path, the hash-chained change log, the reset-aware metric semantics and the fallback's checkpoint takeover) and keeps the surface around them deliberately modest where a feature would otherwise be shallow.
