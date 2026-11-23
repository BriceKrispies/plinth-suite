# Lodestar: Live Operational Resilience (revision 2)

Competitor 05 · Mandate: Live Operational Resilience · Revised design proposal after four independent reviews (design only, nothing built)

**Product title:** Lodestar

**Pitch:** Lodestar is an enterprise operations platform that watches a real containerised checkout system, including its own telemetry, and lets an external agent investigate a live incident and build the dashboards, alerts, runbooks and permissions that explain it, on every connected screen. Every agent change is planned, authorized, audited and reversible through the same command path a human uses, and when the live model stalls a recorded sequence of the same MCP calls takes over at a checkpoint, with the screen labelling which client is acting.

---

## Revision log

Each row gives the finding and what changed. "Fixed" names the section where the change lives. "Rebutted" gives the technical reason. "Accepted" states the limitation that remains. W = weakness, R = required change. Reviewer A is the systems engineer, B the skeptical audience member, C the implementation engineer, D the agent tooling engineer.

### Reviewer A (Principal Systems Engineer)

| Finding | Response |
|---|---|
| A-W1, A-R1: a docker-paused container cannot answer its scrape, so the alert's p95 goes absent, not high; absent-series semantics undefined | **Fixed.** The fault is no longer a process freeze. It is a Toxiproxy `timeout` toxic (blackhole) on the storefront-to-payments path, in both environments (B.2, C, E). The alert reads storefront's caller-side upstream metric, which survives the fault, not payments' own metrics. Absent-series behaviour is defined as state `nodata` (D.4). Claim 3 is restated with a derived bound (F). |
| A-W2, A-R2: `revert_to` replays inverse patches for every change after a sequence number, reverting human edits during takeover | **Fixed.** `revert_to` is removed. Takeover undoes only the live agent's own changes after the checkpoint, each guarded by `expected_version`. A refused undo refuses takeover at that checkpoint and the driver waits for the next one (C.4, D.7). Tested in claim 4. |
| A-W3, A-R3: the agent creates a runbook containing `fleet.restart` with no ceiling check and no approval of the definition | **Fixed.** A workflow definition that references an action is a draft until a principal other than its author, holding every referenced action grant, approves that definition's hash. The agent's grants cannot run an action-bearing workflow (D.6). |
| A-W4, A-R4: two conflict mechanisms (`expected_version` and `base_seq`/`E_PLAN_STALE`); `rebase: true` lets the agent apply over a conflict it never saw | **Fixed.** One mechanism: `expected_version` per entity, returned with a three-way diff. `base_seq`, `E_PLAN_STALE` and `rebase` are removed from the agent surface and from `apply` (D.2, D.5, D.8). The conflict beat is made deterministic by a plan-hold gate (C, 135–165 s). |
| A-W5, W5 in C: `fleet.fault` runs under the presenter's grant with no named human holder | **Fixed.** The presenter is the named human `ada`, who alone holds `action:fleet.fault` and `action:fleet.fault.clear` (A.2, D.6). |
| A-W6, A-R6: replay swaps metrics to a snapshot without a label | **Fixed.** Replay does not swap sources. Live panels always read live data (C.4). The agent's chip on every screen shows `live` or `replay`, and the change log records `client = demo-driver`. The switch is disclosed rather than hidden. The cost is that the switch is visible; the switch itself stays one keystroke. |
| A-W7: the latency budget rests on a scrape that does not run on a paused target | **Fixed** with A-W1. The budget is rebuilt from the scrape of storefront, which is not paused, and from the stated alert window (F, claim 3). |
| A-W8, A-R7: approval request and resolution are not in the D.2 schema | **Fixed.** An `approval` table is added with its subject, card, state, resolver and resolution change row. Resolution path is defined in D.6 and is a human-only HTTP action, not an MCP tool (D.2, D.6, D.8). |

### Reviewer B (Skeptical Technical Audience Member)

| Finding | Response |
|---|---|
| B-W1, B-R1: about eight agent calls in about 35 s against a 12 s silence trigger, so the live path becomes replay | **Fixed.** Every turn is capped at six MCP calls, and the script states a per-turn window (C, budget table). `describe_kind` and `lineage` leave the live turns; the primitives guide is read at staging and the incident is read with `get`. The rule for reshaping a turn is tied to the rehearsal takeover rate (C.5). No takeover rate is asserted here because none has been measured. |
| B-W2, B-R2: seventeen local containers and a Docker socket on the laptop | **Fixed.** The core profile is eleven containers. Inventory, cart, notify, Redis and Caddy move to a `full` profile (E). The earlier list had sixteen containers, not seventeen. The Docker socket is mounted only into `app-runner`, and the stall guard is in G.2. |
| B-W3, B-R3: the alert timeline is written as certain (pending, then firing after 10 s) while the 20 s target is unmeasured | **Fixed.** The script does not wait for a fixed time. Board panels show whatever state the alert reaches, with timestamps (C). The bound is derived from parameters and labelled as derived (F). Pending and firing times come from the rehearsal report; this proposal states no measured value. |
| B-W4, B-R4: docker pause and an AWS Toxiproxy timeout toxic are called observably similar without showing the alert holds on both | **Fixed.** One mechanism in both environments: the Toxiproxy blackhole (B.2, E). The remaining difference is stated on stage: the payments process keeps running during the fault. Conformance tests check that the same alert fires in both environments (E). |
| B-W5, B-R5: the 270–300 s moment needs two independent events to align in one frame | **Fixed.** The orders fault is removed from the stage. The final table is built from data the first fault already produced, and nothing has to align (C, 275–300 s). |
| B-W6, B-R6: the agent never causes a fault or a reversible system change | **Fixed.** At 110–135 s the agent sets the flag `checkout.payments_fail_fast` through `plan` and `apply`. Storefront reads the flag and changes its payments deadline. The change is undone on stage at 255–275 s (C, D.2, D.6). |
| B-W7: composition on stage is narrower than the composability claim | **Accepted as a limitation.** B.7 lists which primitives the stage exercises and which are supporting. The mandate's composability requirement concerns the platform surface, which B.1–B.5 covers; the stage shows a subset of it, and the document says which subset. |

### Reviewer C (Implementation and Reliability Engineer)

| Finding | Response |
|---|---|
| C-W1, C-R1: `revert_to(seq)` inverse-patches approvals, workflow transitions and runner records, and can silently revert human work | **Fixed.** Same as A-W2. Takeover can only undo changes whose principal is the agent. Approvals, workflow transitions and runner records are not the agent's changes and are never inverted (D.7). |
| C-W2, C-R2: docker pause freezes `/metrics`, so the table's "same symptom" claim is false; the 45–75 s alert was written for a climb | **Fixed.** One mechanism (A-W1). The alert is written for the caller-side symptom, a rising timeout ratio on storefront's upstream calls, and not for a climb in payments' own latency. Symptom equivalence between environments is conformance-tested (E). |
| C-W3, C-R3: AWS restart may not clear a Toxiproxy toxic held by a sidecar; restart semantics for pause are unstated | **Fixed.** Each fault has a reset rule in the action contract (D.6). `fleet.restart` on payments clears the payments listener's toxics and verifies an empty toxic list and a ready service before reporting success. A conformance test runs the restart on both environments and checks that the toxic is gone and the alert resolves within the derived recovery bound (E, F). |
| C-W4, C-R4: replay swaps live panels to recorded numbers while the live fleet keeps running | **Fixed.** Same as A-W6. There is no snapshot source. Replay runs against live data and compares structure, not values (C.4, F claim 4). |
| C-W5, C-R5: three conflict and race beats depend on model latency with no mechanism that makes the conflict occur | **Fixed.** Two of the three beats are removed (170–200 s and 270–300 s as conflicts). The remaining conflict is produced by a gate: the agent holds its plan until the presenter says "go", and the presenter's committed layout move lands between plan and apply (C, 135–165 s). The conflict is then deterministic. |
| C-W6, C-R6: the alert's query window is not stated; a 5-minute window dilutes the fault | **Fixed.** The window is stated as 30 s with the threshold and `for` duration (B.4, D.4). The claim supports only the derived bound, which follows from those parameters (F, claim 3). |
| C-W7, C-R7: the rule for workflows referencing actions their author cannot run, and what the approver sees | **Fixed.** Rule and approval-card contents are in D.6. A workflow may be drafted by anyone with `write` on workflows; it cannot run until a different principal who holds every referenced action approves its hash. |
| C-W8, C-R8: Logs Insights latency is not budgeted and the 15 s log step is not in the conformance budget | **Fixed by removal from timed windows, and accepted as a limitation.** No log query sits inside a timed claim. The log query in the investigation turn counts against that turn's window, and its latency is reported as measured. The design does not bound Logs Insights latency and does not claim to (G.1). |

### Reviewer D (Agent and MCP Tooling Engineer)

| Finding | Response |
|---|---|
| D-W1, D-R1: the fallback's takeover can revert human work through `revert_to(seq)`; the agent holds `revert_to` with no scope rule | **Fixed.** `revert_to` is not in the catalogue. `undo` refuses any change whose principal is not the caller unless the caller holds `admin`, which the agent does not. Test: a human change survives takeover (F, claim 4). |
| D-W2, D-R2: replay snapshot is not disclosed on the audience screen | **Fixed.** Same as A-W6 and C-W4. No snapshot sources exist. The agent chip is labelled. |
| D-W3, D-R3: `annotate` is a direct write and `export` writes a snapshot entity, both bypassing plan/apply | **Fixed.** Annotation is a plan op (`create`, kind `annotation`), so it has authz, validation, diff and audit. `export` leaves the MCP surface and is a human web/API action that writes a download, not an entity. Both are listed as explicit exceptions in D.8. |
| D-W4, D-R4: untrusted-data marker depends on a field-name convention; `query` returns positional rows, so log lines and annotation bodies cannot carry the marker | **Fixed.** Rows are named-field objects. Every string that originates in a data store, whatever its field name, is returned as an `untrusted_text` envelope (D.8). |
| D-W5, D-R5: `query` preview returns up to 5,000 points into the agent context | **Fixed.** Agent default is 200 points with a hard maximum of 2,000, and a `summary` mode returns per-series statistics and a bounded sample. The human default is unchanged and labelled (D.4, D.8). |
| D-W6, D-R6: `apply` has no `rebase` flag, but D.8 says `rebase: true` re-plans automatically | **Fixed.** The sentence is removed, along with the flag's intent (D.5, D.8). See A-W4. |
| D-W7, D-R7: `workflow_run` is in the catalogue but the grant grammar has only `workflow create` | **Fixed.** A `run` verb is added to the grant grammar. The agent holds `run` on workflows only where a predicate `workflow.actions_empty` is true (D.6). |
| D-W8, D-R8: tool count is stated as twenty but the catalogue lists twenty-one | **Fixed.** The catalogue lists seventeen tools after `revert_to`, `annotate` and `export` are removed. D.8 lists each once, and a test asserts that `tools/list` for the agent token equals the catalogue. |

### Self-review changes not raised by a reviewer

- The stdio transport took `--principal <id>`, which conflicts with principal-from-token. The driver now authenticates with the agent's client-credentials token like any other client (D.8, C.4).
- Claim 4 required identical final state hashes between replay and live runs, which is incompatible with live numbers. It now compares normalised structure (F).
- The fault console's `inject` and the restart action were both described as "pause". They are now separate named actions with separate grants (D.6).

---

## A. Product concept

### A.1 What the platform is

Lodestar is a composable operations platform. It turns live telemetry and operational state into shared, governed views and actions: dashboards built from typed panels, queries over several sources, alerts with a visible state machine, incidents that group alerts, workflows that move through approval gates, feature flags that services read, and permissions that decide who may see or change each of these. Everything is a versioned entity in one schema system, and every write from the web UI, the HTTP API or the MCP server passes through one command path.

The demonstration is about resilience. The audience sees a real system misbehave, sees the platform notice it from the caller's side, sees an agent investigate with the platform's own tools, sees an agent change a system setting that affects checkout, sees a human approve a recovery, and sees the system recover, while every screen updates live. The UI the agent builds is not a mock-up: every panel is a query against live metrics, logs or the database.

The central resilience observation, which the stage makes visible, is that the payments process reports itself healthy while checkout cannot reach it. The platform sees the failure from storefront's vantage point, where the failure actually is, and the agent has to work out that the path, not the process, is the cause.

### A.2 Who uses it

| Principal | Kind | Role in the demo | Grants (summary, full rules in D.6) |
|---|---|---|---|
| `ada` | human | Presenter. Drives the fault console and the presenter's screens. Owns `ops`. | `admin` in `ops`; `action:fleet.fault` and `action:fleet.fault.clear`; `screen` in `ops`. No `approve`, no `action:fleet.restart`. |
| `cass` | human | On-call SRE. Approves workflow definitions and steps, and runs the runbook. | `read`, `write`, `screen` in `ops`; `approve`; `action:fleet.restart`. |
| `ben` | human | Finance analyst. Exists so that the authorization boundary is visible. | `read` in `finance`. No write in `ops`. |
| `agent:claude-demo` | agent | The external MCP client. Reads `ops`, writes dashboards, panels, queries, annotations (through plan), alert drafts, flags with a `checkout.` key, and draft workflows. Runs only action-free workflows. | See D.6. Explicit deny on `finance`. No `approve`, no `action:*`, no `admin`. |
| `runner` | service | Evaluates alerts, advances workflow runs, records their history. | Runner-scoped writes to `status` and workflow runs. |
| `service:harbor-storefront` | service | Reads the checkout flag it honours. | `read` on `flag` keys beginning `checkout.`. |

Ada is the named presenter. Her session drives the fault console at `/demo/console`. Every fault and fault clear is recorded with principal `ada`, client `web`. No other principal holds the fault actions.

### A.3 The system behind it

The demonstration system is **Harbor Checkout**, a small set of real processes. Its metrics are produced by the processes, not by the platform.

| Component | Profile | What it is | Real signal it produces |
|---|---|---|---|
| `storefront` | core | HTTP service, Node 22. Calls `orders` and `payments` on the checkout path. | `checkout_upstream_requests_total{upstream,outcome}` and its duration histogram, recorded by the caller for every upstream call, including timeouts. Checkout latency histogram. Reads its deadline for payments from the flag. |
| `orders` | core | HTTP service, Node 22, backed by Postgres. | Order creation latency; order status counts including `payment_timeout`. |
| `payments` | core | HTTP service, Node 22, reached only through the Toxiproxy listener. | Its own request rate, authorization latency, `/metrics`. |
| `toxiproxy` | core | Network proxy in front of `payments`. Sidecar in the storefront task on AWS. | Toxic state through its admin API. |
| `postgres` | core | Stock image, holds the `harbor` database with `orders`, `customers` and `inventory` schemas. | Via the platform's SQL source. |
| `k6` | core | Official image with a seeded arrival schedule. | Offered load and client-side checkout latency, written to the metrics source. |
| `inventory`, `cart`, `notify`, `redis` | full | Additional services for the fleet dashboard in the full profile. | Their own metrics. Not on stage. |
| `lodestar-*` | core | The platform: `app-api`, `app-runner`. | Command latency, SSE lag, `/readyz`. |

Reproducibility is designed in at three levels:

1. **Inputs.** A scenario seed fixes the catalogue, the customer identities, the k6 arrival schedule (1,200 requests per minute by default, labelled as the configured offered load) and the script's fault and approval points. Two runs send the same requests at the same offsets.
2. **Latencies.** Latencies are real and vary by run. The narrative depends on shape, not values: payments' own request rate falls while checkout's upstream timeouts rise, and the restart clears both.
3. **Recording.** A rehearsal records the MCP calls the agent made, with the structure of each result. The fallback replays those calls against live data (C.4). It compares structure, not values.

The demo needs no paid API and no external service. The only external dependency is the agent client, covered by the fallback.

### A.4 Why resilience is the right spine

A resilience demonstration cannot be faked without being obviously faked. Each step in the story is a primitive from section B: a caller-side metric feeds an alert, the alert groups into an incident, the incident gets an annotation placed at the fault's event time, a runbook needs a human approval from a principal with a specific grant, a flag change by the agent alters checkout behaviour, and the recovery is attributed in the change log.

---

## B. Capability inventory

Legend: **D** = demonstrated on stage, **S** = supporting (present, exercised by tests or by another primitive, not spoken to on stage), **C** = core machinery shared by everything.

### B.1 Core machinery

| Capability | Class | Technical significance | Composes with |
|---|---|---|---|
| Kind registry | C | One JSON Schema 2020-12 document per kind, generated from TypeBox definitions; the validation source for web, API and MCP. | every entity; MCP discovery; error messages |
| Entity store | C | Each object is an `entity` row with `spec`, `version`, `slug`, `branch`. Writes carry `expected_version`. | all kinds; undo; realtime |
| Change log with hash chain | C | Append-only `change` rows with RFC 6902 patch, inverse patch, principal, client, request id, and a per-workspace prev-hash chain. | audit; undo; fanout; changes view |
| Command engine (plan / apply) | C | Ops are validated and diffed into a plan with base versions and an expiry. Apply compares base versions and writes all or nothing. | MCP previews; web review; API |
| Idempotency keys | C | Per-principal key with request hash; replay returns the stored result; mismatch is an error. | MCP retries; fallback driver |
| Principals | C | Human, service and agent principals with workspace membership. An agent is a principal, not a special API. | authorization; audit; approvals |
| Policy engine | C | Default deny, explicit deny overrides allow, predicates over principal and resource attributes. | every write; every query (row and column policy) |
| Row and column policy | D | Predicates and masks applied at query compile time. | queries; panels; MCP results |
| Workspace isolation | C | `ops`, `finance`, `sandbox`. Grants are workspace-scoped. | policy; screens |
| Realtime change fanout | D | Postgres LISTEN/NOTIFY carries `seq` only; SSE resumes from `Last-Event-ID`. | every screen; panels; alerts |
| Presence | D | Heartbeats and WebSocket cursor events scoped to a dashboard, never written to the change log. | collaboration; conflicts |
| Conflict result | D | `E_VERSION_CONFLICT` with the current version and a three-way diff. The only conflict mechanism. | human merge UI; agent retry |
| Undo | D | Inverse patch per change, guarded by `expected_version`, restricted to the caller's own changes unless the caller is admin. Undo is itself a change. | audit; takeover; flags |
| Audit view | D | Joins `change` and `mcp_call` into a timeline per entity, principal or workspace. | policy; changes view |
| MCP call log | S | Each MCP call logs tool, argument hash, status, latency, plan id and replay run id if any. | audit; eval harness |
| Rate limits | S | Token buckets per principal, with `retry_after_ms` in errors. | agent self-correction |
| Health and readiness | S | `/healthz`, `/readyz` (database, sources, change log writable), `/v1/platform/health` as a data source. | runner; self-telemetry |

### B.2 Data and fleet layer

| Capability | Class | Technical significance | Composes with |
|---|---|---|---|
| Source: Postgres | D | SQL pushdown for `orders`, `customers`, `inventory`; read-only role; joins only within one source. | queries; panels; drill |
| Source: metrics (PromQL-compatible subset) | D | VictoriaMetrics locally, AMP on AWS, one compiler. | queries; alerts; annotations |
| Source: logs (LogQL subset) | D | Loki locally, CloudWatch Logs Insights on AWS, behind `LogSource`. | drill; incidents; evidence panels |
| Source: platform self-telemetry | D | The platform's own command and SSE metrics as a source. | fleet dashboard; screens |
| Query IR | D | Typed IR (`metric`, `filter`, `by`, `window`, `fn`, `transform`, `stream`) compiled per source. | every panel; agent queries; explain |
| Query preview | D | Named-field rows, `truncated`, `estimated_series`, dialect, policies applied, summary mode. | plan validation; self-correction |
| Transform pipeline | D | Pure column-array transforms: `filter`, `project`, `groupBy`, `bucket`, `ratio`, `topN`, `rollingWindow`, `zscore`. | panels; alerts |
| Parameters | D | Typed variables with query-backed options. | cross-filter; drill |
| Cross-filter | S | Selecting a series sets a parameter that re-runs dependent panels. | parameters; panels |
| Drill-down | D | A click maps a field to a target dashboard's parameters. | parameters; logs; incidents |
| Computed metrics | S | Named derived queries with lineage. | queries; alerts |
| Lineage graph | D | Derived from references: query, panel, dashboard, alert, incident, workflow. | audit; undo impact |
| Scheduled snapshot export | S | Human-only, from the web UI. Writes a download, not an entity. | reports |

### B.3 Presentation layer

| Capability | Class | Technical significance | Composes with |
|---|---|---|---|
| Panels: timeseries, stat, table, status grid, log stream, markdown | D | Each reads a query ref and an options block. | queries; parameters; drill |
| Dashboard on a 12-column grid | D | Layout is data (`grid` per panel). | presence; branches |
| Annotations | D | Time-anchored notes linked to entities. Written through plan. | panels; incidents; audit |
| Screens | D | A display target; `screen_show` pushes a dashboard and parameters to a group. | realtime; agent; presenter |
| Agent chip | D | Shows the acting principal and its mode, `live` or `replay`. | screens; audit |
| Comments | S | Threaded comments tied to a panel and version. | presence; review |
| Embed | S | Signed iframe URL honouring the viewer's policy. | policy; sharing |
| Sharing | S | Grants on dashboards, inherited by panels. | policy |
| Topology panel | S | Service graph from a declared dependency list. | incidents; lineage |
| Branch diff | D | Diff of an entity's spec between two branch names or two sequence numbers. | versioning; review |

### B.4 Operations layer

| Capability | Class | Technical significance | Composes with |
|---|---|---|---|
| Alert rule | D | Threshold over a query ref with a stated window and `for` duration. State machine: `ok`, `pending`, `firing`, `resolved`, `acknowledged`, `nodata`. | queries; incidents |
| Alert preview | S | Backtest over a stored window. | plan; self-correction |
| Incident | D | Groups firing alerts; owner; timeline built from changes and annotations. | alerts; lineage; annotations |
| Feature flag | D | Typed key-value entity, read by services through the platform's read API. An agent may write `checkout.*` keys. | plan/apply; services; undo |
| Workflow (runbook) | D | Typed steps with transitions and state history. Action steps reference actions. | incidents; approvals; actions |
| Approval | D | An `approval` row for a workflow definition or a workflow step. Resolved only by a human principal holding `approve`, through the human API. | policy; audit; workflows |
| Action: `fleet.fault`, `fleet.fault.clear` | D | Blackhole the payments listener through Toxiproxy; remove its toxics. | fault console; approvals |
| Action: `fleet.restart` | D | Restart payments and clear its listener's toxics, verified before success. | workflows; approvals |
| Notification route | S | An in-app and webhook route, a grant-checked entity, drafted by the agent only in `ops`. | alerts; policy |
| Form that writes back | S | Submit issues a plan and apply. | policy |

### B.5 MCP surface

| Capability | Class | Technical significance | Composes with |
|---|---|---|---|
| Tool catalogue generic over kinds | D | Seventeen tools (D.8), kinds passed as arguments and validated by the registry. | discovery; plan/apply |
| Tool list filtered by grant | D | `tools/list` for a token shows only tools the principal can use at all. | discovery; security |
| Resources | D | Read-only URIs: kinds, primitives guide generated from the registry, workspace inventory, source schemas. | discovery; error recovery |
| Plan and apply | D | Two-step writes with diff, validation and an authz verdict per op. | undo; idempotency; screens |
| Progress notifications | D | Streamed to the screens as progress lines. Emitted from the query stage only. | screens; latency |
| Prompt template | S | `investigate-incident`, listing the tools in responder order. | discovery; fallback |

### B.6 Composition map

```
   Sources (postgres, metrics, logs, self-telemetry)
        |
     Queries (IR) ---- Parameters <---- Drill
        |                    
   +----+------------+
   |                 |
 Panels          Alerts (state machine, window, nodata)
   |                 |
 Dashboards      Incidents ---- Annotations ---- Changes / Audit
   |                 |
 Screens         Workflows ---- Approvals ---- Actions (fleet)
   |                 |
 Branches        Flags (read by storefront) ---- Undo

  Web UI, HTTP API, MCP tools, runner  ==>  one Command Engine
  Command Engine  ==>  Validation -> Policy -> Change log (hash chain)
                       -> Fanout (SSE) / Audit / Undo / Lineage
```

Each arrow is a typed reference in the entity model, so lineage, undo impact and authorization walk the same graph.

### B.7 What the stage exercises

Demonstrated on stage (D, as listed in C): realtime fanout, the fleet and self-telemetry panels, the caller-side metric, queries with IR and an upstream-outcome transform, logs, Postgres with a row and column policy, an alert with its state machine and `nodata` semantics, an incident, annotations, a dashboard built by the agent, a drill, presence and a conflict, screens, a feature flag written by the agent, a denial with its grant id, a workflow definition approval, a workflow step approval, two actions, a change-log query, a branch diff, and an undo.

Supporting only (S, not spoken to): comments, embed, sharing, topology, computed metrics, cross-filter, alert backtest, notification routes beyond the draft, forms, snapshot export, rate limits.

The stage therefore covers about twenty primitives. The composability claim in the mandate is about the platform surface, which B.1 to B.5 describe. The stage does not show all of that surface, and this proposal does not claim that it does.

---

## C. Five-minute live script

### C.1 Staging before the audience sits down

- Harbor Checkout core profile running at the configured offered load. The platform's self-telemetry has flowed for at least the first panel's window.
- Toxiproxy's toxic list on the payments listener is empty. The stage pre-check reads the list and shows the count on the presenter console.
- Workspaces `ops` and `finance` seeded. `ops` has `checkout-fleet` and the flag `checkout.payments_fail_fast` set to `false`. `finance` has `monthly-refunds`.
- Presenter console at `/demo/console`, signed in as `ada`. It shows the fault buttons, the agent chip, the pre-check, and a status line.
- Second browser as `cass` (approval and runbook view). Third browser as `ben` (finance board, showing the denied route is absent).
- Claude Code connected as `agent:claude-demo` over the HTTP MCP endpoint. `tools/list` returns the seventeen tools. The agent has read the `lodestar://primitives/guide` resource at staging.

### C.2 Timeline

The windows sum to 300 s. Times are script windows, not measured values. Gates say what the presenter waits for; a window never extends to wait for an alert.

| Window | Presenter action (exact words) | Expected behaviour, including MCP calls | Visible result | Capabilities | Transition |
|---|---|---|---|---|---|
| 0–25 s | Speaks: "This is a real checkout system, and the platform watching it, including itself. Every number is from a running process." Nothing typed. | Fleet dashboard streams over SSE. Platform command latency panel is live. No agent calls. | Three harbor services, k6 load, a platform health row. | Realtime fanout, real metrics, self-telemetry | Switches to the agent pane. |
| 25–40 s | Types: `Put the checkout fleet on the main screen.` | Agent calls `search` (dashboard, text `checkout`), `get` on the result, `screen_show` (all, `checkout-fleet`). Three calls. | Every screen switches to the fleet dashboard. | Discovery, screens, principal-scoped read | Presenter moves to the console. |
| 40–55 s | On the console as `ada`, presses **Inject: blackhole payments**. Says: "Checkout can't reach payments. Payments says it's healthy. Checkout doesn't believe it." | Runs `fleet.fault` under Ada's grant. Adds a Toxiproxy `timeout` toxic with timeout 0 on the payments listener. The result records mechanism `toxiproxy:timeout(0) listener=payments`, environment, toxic id and event time. Storefront's calls begin to fail at its 2 s deadline. | On the fleet board, payments' request rate falls and checkout's upstream timeouts rise. Alert card goes `pending`, then `firing`, whenever the rule's parameters are met. | Real fault, real network effect, caller-side metric, alert state machine | Presenter types the investigation prompt. |
| 55–110 s | Types: `Why is checkout slow right now? Build an incident board on the main screen with evidence, and tell me which service is the cause.` | Agent calls at most six tools: `query` (storefront upstream outcomes by upstream, 5 m); `query` (storefront logs, `upstream=payments`, `level=error`, limit 20); `alerts` (`ops`); `plan` (create dashboard `incident-0142`: a stat of upstream timeouts, a timeseries comparing checkout and payments-own request rates, a log stream; one annotation at the fault's event time; one drill from the service grid to the logs); `apply` with an idempotency key; `screen_show` (all, `incident-0142`). Progress lines name each source. | Board appears on all screens. The alert card on the board updates live. The annotation sits at the fault's event time. | Query IR, transforms, logs, alerts, plan/apply, drill, annotations, progress | Presenter speaks: "Payments' requests have dropped to zero. Checkout's calls to payments are timing out. The process is up; the path to it is not." |
| 110–135 s | Types: `Turn on payments fail-fast so checkout stops waiting on payments.` | Agent calls `plan` (update flag `checkout.payments_fail_fast` from `false` to `true`; create an annotation saying who changed it and why), `apply` with an idempotency key, `screen_show` (all, `incident-0142`). Three calls. Storefront picks up the flag on its next poll and lowers its payments deadline. | The flag shows `true` with its change seq. Checkout's latency panel drops and the degraded-response counter rises. The annotation appears on the timeline. | Feature flags, plan/apply, annotations, a reversible system change caused by the agent | Presenter types the next prompt. |
| 135–165 s | Types: `Add a panel for payments timeouts by pod below the incident board, and link the service grid to it. Show me the plan and wait for my go.` Presenter then switches to `cass` and moves the timeseries panel on the incident board, and returns to the console. Says: "Go." | Agent calls `plan` (add panel and interaction), reads `base_versions` (dashboard at version v), says the plan is ready and waits. After the presenter's move the dashboard is at v+1, and Cass's cursor is visible on the board. On "Go", agent calls `apply`, which returns `E_VERSION_CONFLICT` with the current version and a three-way diff of the grid paths. Agent calls `get`, re-plans from v+1, calls `apply` and `screen_show`. Six calls. | Conflict card, then the new panel placed below Cass's moved panel. Presence chips for Cass and for the agent. | Presence, `expected_version`, a single conflict mechanism, deterministic conflict through a plan-hold gate | Presenter types the next prompt. |
| 165–185 s | Types: `Notify Ben in finance when payments is down, and add a restart runbook for payments that waits for approval.` | Agent calls `plan` containing a notification route in `finance`. The plan returns `authz.denied[0] = {op_index: 0, code: E_FORBIDDEN_WORKSPACE, grant_id: grant:deny-agent-finance, message: "agent:claude-demo has an explicit deny in workspace finance; ops is the only workspace this principal can write"}`. Agent re-plans: a route draft in `ops` for an admin to activate in `finance`, and the workflow `runbook-payments-restart` (steps `verify`, `approval`, `fleet.restart` on payments, `verify`). The plan reports `requires_approval` for the workflow hash. `apply`, `screen_show` (all, runbook). Four calls. | A denial card with the grant id on the screen. The runbook appears in `ops` as a draft awaiting definition approval. | Policy denial with an explicit reason, error recovery, workflows, approvals | Presenter switches to `cass`. |
| 185–225 s | On `cass`: opens the approval card. Presses **Approve definition**, then **Run**. At step 2 presses **Approve step**. Says: "Approval is a human grant. The agent can't press this." | Approval card shows the author, client, definition hash, every step, every action with its required grant and target, the restart's reset rule, and the diff. Cass's approval writes a change. `runner` runs `verify` (records its query result in run history), waits at `approval`, then runs `fleet.restart` on payments: restarts the payments task and clears its listener's toxics, verifies an empty toxic list and a ready service, then runs the final `verify`. | Each state transition appears in the runbook with principal and time. The incident timeline gains "restarted by cass (approved)". Whether the alert has resolved yet is shown as it is; the derived recovery bound is in F. | Approvals, actions, workflow state history, reset rule, audit | Presenter returns to the agent pane. |
| 225–255 s | Types: `What changed in the last 15 minutes, and who changed it? Show it as a table grouped by principal and client, and show the agent's work as a diff since its first apply.` | Agent calls `changes` (window 15 m, `ops`), `get` with `include: ["history"]` on the incident board, `plan` (table panel grouped by principal and client), `apply`, and `branch_diff` (`from: seq:<agent's first change>`, `to: head`, kind `dashboard`). Five calls. | A table grouped by `ada`, `cass`, `agent:claude-demo` and `runner`, and a diff card with the agent's changes. | Change log query, audit, branch diff, generated UI | Presenter types the undo prompt. |
| 255–275 s | Types: `Undo the fail-fast flag you turned on. Show me the undo first.` | Agent calls `undo` with `dry_run: true` on the flag change, reads the current version and inverse patch, then `undo` with that `expected_version` and a fresh idempotency key. Two calls, plus `screen_show` if needed. | Flag back to `false`. Checkout's deadline returns to the unmodified behaviour; latency rises again. The change log shows an undo referencing the original seq. | Undo as a change, dry run, version guard, reversible system change | Presenter types the closing prompt. |
| 275–300 s | Types: `Which customers saw checkout errors in the last 5 minutes, and where? Build me a table for the main screen.` | Agent calls `query` on Postgres (`orders` joined to `customers` within the `harbor` source, `status = payment_timeout`, last 5 m, grouped by region and segment) with the email column masked by the agent's row and column policy, `plan` (table panel), `apply`, `screen_show`. Four calls. | A table of regions and segments with masked emails appears on the main screen. The orders the outage actually failed are the rows. | Row and column policy, Postgres connector, generated UI, data from the earlier fault | End card: change log and `audit verify` on the presenter console. |

### C.3 Why the strongest moment works

The last 25 s rest on data the first fault already produced. The orders table shows the failures that happened during the outage, the masking shows what the agent is not allowed to see, and the change log shows who did what. No two events have to align. The moment depends on the outage having happened, which the audience watched.

### C.4 Deterministic fallback driver

The fallback is the real MCP path, not an animation.

1. **Recording.** A rehearsal writes `demo/script/v2.jsonl`. Each line is one agent MCP call: tool, arguments with ids replaced by stable names, the expected result **structure** (keys, types, enum states, error codes; numeric values, timestamps and request ids excluded), and a checkpoint marker. Checkpoints sit at the start of each window in C.2 where the agent is expected to begin a turn.
2. **Replay client.** `lodestar demo drive --mode replay` is an ordinary MCP client. It authenticates with the agent's client-credentials token exactly like any HTTP client; it takes no principal argument. It resolves stable names to the ids it created, reads before it plans (the recording includes those reads), and re-reads `base_versions` before every plan, as a real client does. Audit rows show `agent:claude-demo` and `client = demo-driver`.
3. **Human steps are never replayed.** Faults, moves by Cass, approvals and runs are presenter actions performed at the same points in the window. The driver holds no human grant and cannot issue them. A missed or refused human step is a presenter decision, shown on screen as the state it is.
4. **Live data.** Replay runs against live metrics, logs and the database. Panel values differ between runs, and this is intended. Replay compares the structure of results, the order of calls, and the final normalised entity set (F, claim 4).
5. **Takeover rules.** Takeover happens only at a checkpoint. Triggers are: no MCP call from the live agent for 12 s between calls where one is expected, or 20 s from prompt submission to the turn's first call; two consecutive errors on a step that the recording does not expect to fail; and the presenter pressing **F9** on the console. Errors the recording expects, such as the conflict in 135–165 s, are not triggers.
6. **Takeover procedure.** The driver cancels the live agent's pending calls. It undoes the live agent's own changes made after the checkpoint, in reverse order, each with the `expected_version` of the entity after that change. If any undo is refused with `E_VERSION_CONFLICT`, takeover at that checkpoint is refused, the driver stays on the live path and waits for the next checkpoint, and the presenter console shows the refusal. Human and runner changes are never inverted. The driver then resumes the recording and sets the agent chip to `replay`.
7. **Disclosure.** The agent chip on every screen reads `agent:claude-demo · live` or `agent:claude-demo · replay`, and the audit view shows `client = demo-driver` for each replayed change. The audience can see the mode. The presenter console shows the same word.

### C.5 Turn budget and latency

Each turn has a window and a maximum call count. Model time is not controlled by the platform. The rule is:

| Turn | Window | Max MCP calls | Gate |
|---|---|---|---|
| Fleet on screen | 15 s | 3 | screens switch |
| Investigation | 55 s | 6 | board visible |
| Fail-fast | 25 s | 3 | flag `true` observed |
| Conflict | 30 s | 6 | new panel placed |
| Denial and runbook | 20 s | 4 | runbook visible |
| Change review | 30 s | 5 | table visible |
| Undo | 20 s | 2 | flag `false` observed |
| Closing table | 25 s | 4 | table visible |

- Each turn's window is the budget for model time plus MCP call time. Tool latency is measured in rehearsal and reported per tool.
- The rehearsal records, per turn, the p90 of end-to-end turn time and the takeover rate. If a turn's takeover rate in rehearsal exceeds the threshold written in the rehearsal configuration before the first run, the turn is reshaped before the demo, either by reducing its calls or by moving its non-essential calls out of the turn. No takeover rate is asserted in this proposal.
- Presenter speech fills the gap when a turn is slower than its window. The script does not wait for an alert to fire or resolve.

### C.6 Presenter principal and grants

The presenter is `ada`. Her console uses her session. Ada's grants are named in A.2 and D.6. Ada cannot approve or restart, so the presenter cannot resolve a runbook. Cass's session performs the approvals. A separate person may be the presenter; the grants stay with `ada`'s role, and the presenter is whoever holds that session.

---

## D. Technical architecture

### D.1 Components and languages

| Component | Implementation | Justification |
|---|---|---|
| `lodestar-core` | TypeScript on Node 22, ESM | One language end to end, so the kind registry validates web, API and MCP input from one definition. |
| `lodestar-api` | Fastify, OpenAPI generated from TypeBox schemas, SSE for streams, `ws` for presence | SSE is one-directional and resumable with `Last-Event-ID`. |
| `lodestar-mcp` | `@modelcontextprotocol/sdk` (TypeScript), Streamable HTTP transport and stdio | The SDK is the reference implementation of the protocol the external agent speaks. |
| `lodestar-query` | Query IR, compilers to SQL, PromQL subset and LogQL subset, pure transform runtime | Transforms run in-process so they behave identically on every source. |
| `lodestar-runner` | Node process: alert evaluator, workflow executor, snapshot scheduler, single active leader via `pg_try_advisory_lock` | Leader election through Postgres avoids a second coordination system. |
| `lodestar-web` | React 18, TypeScript, Vite, uPlot, TanStack Table, react-grid-layout | The grid is data-driven, so layout is part of the entity spec. |
| `harbor-*` services | Node 22 with `prom-client` and structured JSON logs | Same toolchain as the platform. |
| Fault adapter | Toxiproxy admin API (both environments), Docker Engine API locally and ECS API on AWS for restart, behind `FleetAdapter` | One fault mechanism everywhere. Only restart differs by environment. |
| Load generator | k6 official image with a seeded scenario file | Fixed arrival schedule. |

Datastores:

- **Postgres 16** for entities, changes, grants, plans, approvals, idempotency keys, workflow state, alert state, sessions, presence heartbeats, the `harbor` database and the query cache. LISTEN/NOTIFY carries fanout.
- **VictoriaMetrics single-node** locally for metric series. There is no snapshot instance; replay runs against live data.
- **Loki** locally for logs, behind `LogSource`.
- **Redis** only for the full profile's `cart` and `notify`.

Each store is listed because the demo needs it. Nothing the demo does not need is present.

### D.2 Persistence model

```sql
create table workspace (
  id          uuid primary key,
  slug        text unique not null,
  name        text not null
);

create table principal (
  id            text primary key,              -- 'ada', 'cass', 'ben', 'agent:claude-demo', 'runner', 'service:harbor-storefront'
  kind          text not null check (kind in ('human','service','agent')),
  display_name  text not null,
  attributes    jsonb not null default '{}',   -- regions, teams; used by predicates
  disabled_at   timestamptz
);

create table entity (
  id           uuid primary key,
  workspace_id uuid not null references workspace(id),
  kind         text not null,                  -- dashboard, panel, query, annotation, alert, flag, workflow, route, incident
  slug         text not null,
  branch       text not null default 'main',
  version      bigint not null,
  spec         jsonb not null,
  status       jsonb not null default '{}',    -- runtime state, written only by the runner
  deleted_at   timestamptz,
  unique (workspace_id, kind, slug, branch)
);

create table change (
  seq           bigint generated always as identity primary key,
  workspace_id  uuid not null,
  branch        text not null,
  entity_id     uuid not null,                 -- may name an approval row
  op            text not null check (op in ('create','update','delete','undo')),
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
  actions      text[] not null,                -- read, write, plan, approve, screen, run, admin, action:<name>
  effect       text not null check (effect in ('allow','deny')),
  predicate    jsonb not null default '{}',    -- e.g. {"flag.key_prefix":"checkout."}, {"workflow.actions_empty":true}
  created_by   text not null,
  created_at   timestamptz not null default now()
);

create table plan (
  id            uuid primary key,
  principal_id  text not null,
  workspace_id  uuid not null,
  base_versions jsonb not null,                -- { "<entity id>": version } for every entity the ops touch; 0 for creates
  ops           jsonb not null,
  diff          jsonb not null,
  validation    jsonb not null,
  authz         jsonb not null,                -- per op: allowed, grant id, code
  requires_approval jsonb not null default '[]',
  expires_at    timestamptz not null,
  applied_seq   bigint
);

create table approval (
  id              uuid primary key,            -- also the entity id in change rows
  workspace_id    uuid not null references workspace(id),
  subject_kind    text not null check (subject_kind in ('workflow_definition','workflow_step')),
  subject_ref     text not null,               -- 'workflow:runbook-payments-restart' or 'workflow_run:<id>#step:2'
  subject_hash    bytea not null,              -- hash of the definition or of the step's inputs
  required_grants text[] not null,             -- 'approve' plus 'action:<name>' for each referenced action
  requested_by    text not null references principal(id),
  card            jsonb not null,              -- contents defined in D.6
  state           text not null check (state in ('pending','approved','rejected','expired')),
  resolved_by     text references principal(id),
  resolved_at     timestamptz,
  resolution_seq  bigint,                      -- the change row that recorded the resolution
  expires_at      timestamptz not null,
  check (resolved_by is null or resolved_by <> requested_by)
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
  id            bigserial primary key,
  principal_id  text not null,
  tool          text not null,
  args_hash     bytea not null,
  args_redacted jsonb not null,
  status        text not null,
  error_code    text,
  plan_id       uuid,
  replay_run_id text,                          -- set when the driver issued the call
  latency_ms    integer not null,
  created_at    timestamptz not null default now()
);

create table workflow_run (
  id              uuid primary key,
  workflow_id     uuid not null references entity(id),
  definition_hash bytea not null,              -- the approved hash the run executes
  approval_id     uuid references approval(id),
  state           text not null,               -- running, waiting_approval, succeeded, failed
  history         jsonb not null default '[]', -- append-only transitions with principal, time, result structure
  started_by      text not null
);
```

Notes:

- `change.state_hash` is a per-workspace chain. Writes to a workspace serialise through `pg_advisory_xact_lock(hashtext(workspace_id))`. Previews do not take the lock.
- `status` holds runtime state written only by the runner. Runtime transitions that matter (acknowledgement, workflow transitions, approval resolution) are changes, so they are auditable. Raw alert evaluation is not a change.
- Presence heartbeats live in `presence` with a 15 s liveness window.
- `approval` rows are written through the change log; `change.entity_id` names the approval row when it is resolved.

### D.3 Declarative specification language

Dashboards, panels, queries, alerts, flags, workflows and grants are documents in one language, `lodestar/1`: JSON, with YAML accepted at the CLI. The agent writes documents; the platform renders them. There is no generated code path.

Abridged example of the incident board the agent creates at 55–110 s. The metric is the caller-side metric, not payments' own.

```json
{
  "$spec": "lodestar/1",
  "kind": "dashboard",
  "slug": "incident-0142",
  "workspace": "ops",
  "title": "INC-0142 checkout latency",
  "parameters": {
    "window": { "type": "duration", "options": ["5m", "15m", "1h"], "default": "5m" }
  },
  "queries": {
    "q.upstream": {
      "source": "metrics.harbor",
      "ir": {
        "metric": "checkout_upstream_requests_total",
        "filter": { "upstream": "payments" },
        "by": ["outcome"],
        "fn": "rate",
        "window": "$window"
      }
    },
    "q.payments_own": {
      "source": "metrics.harbor",
      "ir": { "metric": "http_requests_total", "filter": { "service": "payments" }, "fn": "rate", "window": "$window" }
    },
    "q.payments_logs": {
      "source": "logs.harbor",
      "ir": { "stream": { "service": "storefront", "upstream": "payments", "level": "error" }, "limit": 20 }
    }
  },
  "layout": { "columns": 12, "rowHeight": 56 },
  "panels": [
    {
      "id": "p_upstream",
      "type": "timeseries",
      "title": "Checkout to payments, by outcome",
      "query": { "ref": "q.upstream" },
      "grid": { "x": 0, "y": 0, "w": 8, "h": 4 },
      "annotations": { "from": "changes", "where": { "entity.kind": "alert" } },
      "interactions": { "click": { "drill": "dashboard:payments-logs", "map": { "upstream": "$.series.outcome" } } }
    },
    {
      "id": "p_logs",
      "type": "log-stream",
      "title": "Storefront errors to payments",
      "query": { "ref": "q.payments_logs" },
      "grid": { "x": 8, "y": 0, "w": 4, "h": 4 }
    }
  ]
}
```

Validator rules (the same messages the agent sees, D.8):

- Each panel type has a closed set of keys. Unknown keys are errors with a did-you-mean suggestion.
- A `query.ref` resolves in the same document, or is an explicit `dashboard:` or `query:` reference the caller can read.
- `$param` references name a declared parameter used in a matching position.
- `grid` rectangles may not overlap unless the panel declares `layer`.
- Drill targets exist and the mapped parameters exist on the target.
- `source` is registered and its policy allows the caller.
- A flag write must name a key matching the caller's grant predicate.
- A workflow definition's actions must exist in the registry; the approval requirement is computed from them (D.6).

### D.4 Query, transform and alert engine

- **Compilation.** The IR compiles per source: SQL for Postgres with parameters bound, PromQL subset for metrics, LogQL subset for logs. The compiler refuses constructs a source cannot express. `join` is allowed only when both sides share a source.
- **Policy at compile time.** Row predicates and column masks are appended during compilation from the caller's principal. A masked column never reaches the transform stage. `query_explain` returns the applied predicates; the agent cannot remove them.
- **Transforms.** Pure functions over typed column arrays: `filter`, `project`, `groupBy`, `bucket`, `ratio`, `topN`, `rollingWindow`, `zscore`. Anomaly detection is a rolling z-score over a window and nothing more; the panel says so.
- **Limits.** Agent default `limit_points` is 200, maximum 2,000. Human web default is 5,000, maximum 50,000. `summary: true` returns, per series, labels, sample count, min, max, last value and first and last timestamps, plus at most 20 raw rows. The compiler estimates series count before running and refuses above a threshold with a suggested `by` or `window` change.
- **Values in results.** Every string that originates in a data store, including label values, log lines, entity titles, annotation text and customer fields, is returned as an `untrusted_text` envelope (D.8). Ids, kinds, states and enum values are plain.
- **Caching.** Keyed by (dialect, params, step, policy hash) with a short TTL. `query_explain` reports `cache: hit|miss`.
- **The stage alert.** Rule `payments-upstream-failing`:
  - Query: ratio of `checkout_upstream_requests_total{upstream="payments",outcome="timeout"}` to `checkout_upstream_requests_total{upstream="payments"}`, each as `rate(...[30s])`, summed across storefront instances.
  - Threshold: ratio greater than 0.2.
  - `for`: 10 s. Evaluation interval: 5 s. Scrape of storefront: 5 s.
  - Resolution: `resolve_for` 10 s. Ratio at or below 0.2.
  - Absent series: if the numerator or denominator is absent or stale (no sample within two scrape intervals), the state is `nodata`. `nodata` is not firing and is shown grey with "no data since <time>". A `nodata` alert does not close an incident.
  - The window is 30 s. The rule supports the claim in F, claim 3, and no claim about payments' own metrics.

### D.5 Real-time transport and conflicts

- **Fanout.** A committed change issues `NOTIFY lodestar_changes, '<seq>'`. Payloads carry only the sequence number. Subscribers fetch the change row, apply the patch, and filter by subscription.
- **Subscriptions.** One SSE stream per workspace and branch, with `?kinds=` and `?entities=`. Panels subscribe to their query ref; the runner pushes refreshed series at the query step.
- **Resume.** SSE events carry the change seq as the event id. On reconnect the server replays from `Last-Event-ID`. If the gap exceeds the retained window it returns `resync` and the client refetches the workspace snapshot.
- **Presence.** WebSocket per dashboard view. Cursor positions and panel focus are ephemeral and never change-logged. Agent presence appears as a chip with its MCP session name.
- **One conflict mechanism.** Every write carries `base_versions` from its plan (or `expected_version` for undo). `apply` compares each base version with the current version of its entity. Any mismatch fails the whole apply with `E_VERSION_CONFLICT`, listing each mismatched entity, its current version and a three-way diff: base, theirs, mine. Nothing is written.
- **No automatic rebase on any surface.** The agent re-reads, re-plans and applies, as the conflict beat shows. The web UI shows the same three-way diff as a conflict card, and the human chooses to re-apply, merge by hand, or discard. The earlier disjoint-path layout merge is removed: it was a second merge model that the agent could trigger without seeing the conflict.
- **No CRDT.** Dashboards are edited as documents with occasional concurrent writes. One conflict model keeps undo, audit and diff simple.

### D.6 Authorization model

- **Principals.** `human`, `service`, `agent`. Tokens are bound to a principal; no request argument can select another.
- **Grants.** A grant names a principal, a workspace, an optional kind, actions and an effect, plus an optional predicate. Actions: `read`, `write`, `plan`, `approve`, `screen`, `run`, `admin`, `action:<name>`.
- **Evaluation.** Default deny. Explicit deny overrides allow. Each decision's grant id is recorded in the plan's `authz` document, so a denial names its rule.
- **Agent grants.**
  - `read` on `ops`.
  - `write` on `dashboard`, `panel`, `query`, `annotation`, `alert` (draft status only), `route` (draft only) and `workflow` (definition status draft only), in `ops`.
  - `write` on `flag` in `ops` with predicate `flag.key_prefix = "checkout."`.
  - `screen` on `ops`.
  - `run` on workflows in `ops` with predicate `workflow.actions_empty = true`.
  - Explicit deny on all actions in `finance` (`grant:deny-agent-finance`).
  - Row policy on `orders` and `customers`: `customers.region in principal.attributes.regions`, with `customers.email` masked.
  - No `approve`, no `admin`, no `action:*`, no grant on any grant table, no fault tool.
- **Human grants.**
  - `ada`: `admin` in `ops`; `action:fleet.fault` and `action:fleet.fault.clear`; `screen`.
  - `cass`: `read`, `write`, `screen` in `ops`; `approve`; `action:fleet.restart`.
  - `ben`: `read` on `finance`.
- **Action contracts.** Each action has a grant, a target, an effect, a reset rule and a result record.

| Action | Grant | Target | Effect | Reset rule | Result records |
|---|---|---|---|---|---|
| `fleet.fault` (kind `blackhole`) | `action:fleet.fault` | payments listener on Toxiproxy | adds a `timeout` toxic with timeout 0 | `fleet.fault.clear` removes it | mechanism, environment, toxic id, event time |
| `fleet.fault.clear` | `action:fleet.fault` | payments listener | removes all toxics on that listener | none | count cleared, time |
| `fleet.restart` | `action:fleet.restart` | payments service | replaces the payments task or container; clears the listener's toxics; verifies an empty toxic list and `/readyz` before reporting success | this action is the restart reset | task or container id, toxics cleared, healthy-after time, mechanism |

- **Action-bearing workflows.** A workflow definition with an action step is saved as `draft`. A run of a definition requires an `approval` row with `subject_kind = workflow_definition`, `subject_hash` equal to the definition's current hash, `state = approved`, and a resolver holding every grant in `required_grants`. The resolver may not be the requester (enforced by the table check). Any change to the definition changes its hash and invalidates the approval.
- **Rule for references the author cannot run.** A workflow may reference an action its author cannot run. It is drafted and the author sees the requirement in the plan's `requires_approval`. It cannot run until a different principal holding that action's grant approves it. The agent's `run` grant excludes every workflow with an action step.
- **Approval card contents.** Workspace; workflow name; author principal and client; definition hash; each step with type, action, target and inputs; each action's required grant and whether the approver holds it; each action's reset rule; the diff from the previous approved version; expiry.
- **Approval resolution path.** `POST /v1/approvals/{id}/resolve` on the human API, requiring an approving human session. It is not an MCP tool and is absent from `tools/list` for every token. Resolution writes a change row whose `entity_id` is the approval id.
- **Runs.** A run of a workflow with a step of type `approval` waits in `waiting_approval`. The step approval is an `approval` row with `subject_kind = workflow_step`, and the approver may not be the principal who started the run.
- **Parity.** Web, API and MCP call the same policy function with the same inputs. The only recorded difference is `client`.

### D.7 Audit, versioning and undo

- Every write produces `change` rows. Every MCP call produces an `mcp_call` row with redacted arguments. The audit view joins them.
- **Undo** creates a new change whose patch is the stored inverse. It requires `expected_version` equal to the entity's current version, and it refuses with `E_VERSION_CONFLICT` otherwise. It is restricted to changes whose principal is the caller, unless the caller holds `admin`. The agent has no `admin`, so it can undo only its own changes.
- **Takeover uses undo.** The driver undoes only changes whose principal is the agent and whose seq is after the checkpoint, in reverse, each with the entity's version after that change. Human and runner changes are never inverted. A refused undo refuses takeover at that checkpoint (C.4).
- **No revert.** `revert_to(seq)` is removed. Its effect, reverting everything after a sequence number, was the source of the human-work reversion the reviewers identified.
- **Branches** are a column. `branch.create` copies entity rows at a seq. Branch diff is computed over `spec` by JSON Pointer, and its `from` and `to` accept a branch name or `seq:<n>`.

### D.8 The MCP server

#### Transport and authentication

- **Streamable HTTP** at `/mcp` for the presenter's agent and remote clients. **stdio** through `lodestar mcp --stdio` with the client-credentials token from the environment, for local development and for the driver in in-process mode. There is no principal argument on any transport.
- **Authentication.** OAuth 2.1 bearer tokens. Humans use authorization code with PKCE. The agent principal uses client credentials with a 3600 s token lifetime, bound to `agent:claude-demo`. Disabled principals are rejected. `Origin` is checked on HTTP.

#### Discovery

Resources (read-only):

- `lodestar://kinds`: kinds with one-line purpose and the caller's actions on each.
- `lodestar://kinds/{kind}`: JSON Schema, a minimal valid example, common mistakes and enum values.
- `lodestar://primitives/guide`: generated from the registry; describes how queries feed panels, alerts feed incidents, flags are read by services, workflows and actions work, and plan/apply rules apply.
- `lodestar://workspace/{slug}/inventory`: counts by kind, owners, sources the caller can read.
- `lodestar://sources/{name}/schema`: metric names and label sets, or table columns, with masked columns marked.
- `lodestar://limits`: rate limits and the agent's point limits, so a well-behaved client reads them before hitting them.

Prompt: `investigate-incident` lists the tools in responder order, with no instruction that cannot be checked against a tool result.

#### Tool catalogue

Seventeen tools. Signatures are TypeScript-like; the MCP input schema is generated from the same definitions. `tools/list` for the agent token returns exactly these.

```ts
// Reads (6)
describe_kind(input: { kind: string }): { schema: JSONSchema; example: object; caller_actions: string[]; common_mistakes: string[] }
search(input: { workspace: string; kind?: string; text?: string; limit?: number /* 25 default, 200 max */; cursor?: string }): { items: { id: string; kind: string; slug: string; title: Untrusted; version: number }[]; next_cursor?: string }
get(input: { ref: string; include?: ("spec" | "status" | "lineage" | "history" | "approval")[] }): { id: string; kind: string; version: number; branch: string; spec: object; status?: object; lineage?: Graph; history?: Change[]; approval?: Approval }
changes(input: { workspace: string; since_seq?: number; window?: string; principal?: string; kind?: string; entity?: string; limit?: number }): { changes: Change[]; head_seq: number }
sources(input: { workspace: string; source?: string }): { sources: { name: string; kind: "metrics" | "logs" | "sql" | "self"; attributes: string[] }[]; fields?: { name: string; type: string; masked: boolean; cardinality_hint?: number }[] }
presence(input: { workspace: string; dashboard?: string }): { viewers: { principal: string; kind: string; panel?: string }[] }

// Queries and analysis (5)
query(input: { query: QueryIR | { ref: string }; params?: Record<string, unknown>; limit_points?: number /* 200 default, 2000 max for agents */; summary?: boolean }): { columns: string[]; rows: Record<string, Scalar | Untrusted>[]; truncated: boolean; estimated_series: number; cache: "hit" | "miss"; summary?: Summary[] }
query_explain(input: { query: QueryIR; params?: Record<string, unknown> }): { dialect: string; compiled: string; policies_applied: string[]; warnings: string[] }
alerts(input: { workspace: string; state?: ("ok" | "pending" | "firing" | "nodata" | "acknowledged" | "resolved")[] }): { items: { id: string; rule: string; state: string; since: string; value: number | null }[] }
alert_preview(input: { rule: AlertSpec; window: string }): { would_have_fired: { from: string; to: string; peak: number }[]; evaluated_points: number }
lineage(input: { ref: string; direction: "upstream" | "downstream" | "both"; depth?: number }): { nodes: Node[]; edges: Edge[] }

// Writes (4)
plan(input: { workspace: string; branch?: string; label?: string; ops: Op[] }): { plan_id: string; base_versions: Record<string, number>; diff: PatchSummary[]; validation: { errors: ValidationError[]; warnings: ValidationError[] }; authz: { allowed: boolean; per_op: { op_index: number; allowed: boolean; grant_id?: string; code?: string; message?: string }[] }; requires_approval: { subject_kind: string; subject_ref: string }[]; expires_at: string }
apply(input: { plan_id: string; idempotency_key: string }): { applied_seq: number; entities: { id: string; version: number }[] }
undo(input: { change_seq: number; expected_version: number; idempotency_key: string; dry_run?: boolean }): { inverse: PatchSummary; affected: { id: string; kind: string }[]; current_version: number; applied_seq?: number }
branch_diff(input: { workspace: string; from: string; to: string; kind?: string }): { changes: PatchSummary[] }

// Operations (2)
screen_show(input: { screen: string | "all"; dashboard: string; params?: Record<string, unknown> }): { delivered_to: number }
workflow_run(input: { ref: string; inputs?: object; dry_run?: boolean; idempotency_key?: string }): { run_id: string; state: string; next_step?: string }
```

Count: 6 reads, 5 queries and analysis, 4 writes, 2 operations, total 17.

**Explicit exceptions to plan/apply.** None of the writes above bypass it. Annotations are plan ops. Flags are plan ops. The three things that are not MCP writes are human-only: approval resolution, grants, and export of a snapshot download. None is offered to any agent token.

**Not offered to the agent, and not in `tools/list` for its token:** approval resolution, grant changes, fault and fault-clear actions, restart actions, export, revert, rebase, and any tool that writes a principal.

#### Plan and apply semantics

- A plan records `base_versions` for every entity its ops touch: the version at plan time, or 0 for a create. It expires after 300 s by default.
- `apply` compares each base version with the current version. Any mismatch fails the whole apply with `E_VERSION_CONFLICT` and writes nothing.
- An expired plan returns `E_PLAN_EXPIRED` with the command to create a new plan.
- `apply` is all-or-nothing in one transaction and one hash-chain segment. There is no `rebase` parameter.
- A plan that requires approval can be applied, but the entities it creates are drafts until the approval resolves. A run cannot start from a draft.

#### Validation messages designed for self-correction

Every error has one shape:

```json
{
  "error": {
    "code": "E_UNKNOWN_FIELD",
    "path": "ops[0].spec.panels[1].by",
    "message": "Field 'by' is not valid on panel type 'timeseries'. Grouping belongs on the query: move it to queries.<ref>.ir.by.",
    "valid_fields": ["id", "type", "title", "query", "grid", "annotations", "interactions"],
    "suggestion": { "op": "move", "from": "panels[1].by", "to": "queries.q.upstream.ir.by" },
    "retryable": true,
    "docs": "lodestar://kinds/dashboard#panels"
  }
}
```

Codes the agent sees: `E_UNKNOWN_FIELD`, `E_TYPE_MISMATCH`, `E_UNKNOWN_REF`, `E_FORBIDDEN_WORKSPACE` (with grant id), `E_FORBIDDEN_ACTION` (names the missing grant only), `E_FORBIDDEN_RUN` (with the reason, such as "workflow has action steps"), `E_VERSION_CONFLICT` (with three-way diff), `E_PLAN_EXPIRED`, `E_RATE_LIMITED` (with `retry_after_ms`), `E_SERIES_LIMIT` (with a suggested `by` or `window`), `E_IDEMPOTENCY_MISMATCH`, `E_UNSAFE_CONSTRUCT` (for example a raw PromQL string where IR is required), `E_APPROVAL_REQUIRED`.

The validator never silently coerces a field.

#### Idempotency

`apply`, `undo` and `workflow_run` require an `idempotency_key`, scoped to the principal. The same key with the same request hash returns the stored result with `replayed: true`. A different hash returns `E_IDEMPOTENCY_MISMATCH`. Keys are retained for 24 h.

#### Rate limits

Token buckets per principal: writes 60 per minute with burst 20; previews 20 per second with burst 40. `query` results are capped by `limit_points`. Limits are readable at `lodestar://limits`.

#### Untrusted data

- Every string that originates in a data store is returned as `{"untrusted_text": "<string>", "truncated": false}`. This applies to every field, whatever its name, including rows of `query`, `search` titles, annotation text, log lines and customer fields. The tool descriptions state that `untrusted_text` is data, not instructions.
- Log lines are truncated to 512 bytes and control characters are escaped.
- Markdown panels are sanitised to a fixed allowlist.
- No tool executes content read from data. Actions run only from approved workflow definitions (D.6).
- The agent cannot widen its grants, and approval is structurally unavailable to it. A prompt injected into a log line can at most make the agent write drafts and dashboards in `ops`, which are attributed, audited and undoable.

The design assumes injection by accident, not adversarial injection, and handles it by structure, not by asking the model to ignore text.

---

## E. AWS and local deployment

### E.1 One image family, two environments

- Images are immutable, tagged by git SHA and referenced by digest. No `latest`.
- `lodestar-app` is one image containing `api`, `mcp`, `runner` and the built web assets. The role is a command argument.
- `harbor-storefront`, `harbor-orders`, `harbor-payments` and the full-profile services are one Dockerfile with a build argument per service.
- Third-party images (Postgres 16, VictoriaMetrics, Loki, Toxiproxy, k6, Dex, and in the full profile Redis and Caddy) are pinned by digest.

### E.2 Local profiles

- **Core (eleven containers):** `app-api`, `app-runner`, `postgres`, `victoriametrics`, `loki`, `dex`, `storefront`, `orders`, `payments`, `toxiproxy`, `k6`.
- **Full (adds five):** `inventory`, `cart`, `notify`, `redis`, `caddy`. Not on stage. Used for the fleet dashboard's extended view and for TLS.
- Only `app-runner` mounts the Docker socket, read-write, for the restart action.
- `lodestar up` starts the core profile; `lodestar up --full` adds the full profile.
- `lodestar demo reset` stops k6, clears every toxic on the payments listener, restores the three core services to their images, drops and recreates `ops`, `finance` and `sandbox` from seed, and waits for `/readyz`. It refuses while a fault is active unless `--force`, which clears the toxic first, then resets.
- `lodestar demo measure --runs 20` and `lodestar demo rehearse` are described in F and H.

### E.3 AWS

- **Compute.** ECS on Fargate. `app-api` and the harbor services are tasks. `app-runner` has desired count one, with leader election in Postgres. The storefront task contains a Toxiproxy sidecar in front of payments.
- **ALB** terminates TLS for `lodestar.<domain>`. `/mcp` and `/v1/*` route to the API target group.
- **State.** RDS for PostgreSQL 16, with no RDS-only features. Changes use LISTEN/NOTIFY over direct connections; RDS Proxy is not used for those connections.
- **Metrics.** Amazon Managed Service for Prometheus, written by an OpenTelemetry collector that scrapes harbor services and the platform, including storefront's caller-side metric. Queried with SigV4 signing in the metrics adapter.
- **Logs.** CloudWatch Logs Insights behind `LogSource`.
- **Identity.** Cognito user pools, with the same claim names as Dex.
- **Secrets.** Secrets Manager for the agent client secret and database credentials.
- **Fault adapter.** `fleet.fault` and `fleet.fault.clear` call the sidecar's Toxiproxy admin API. `fleet.restart` calls ECS to stop the payments task so that the service replaces it, then calls the sidecar API to clear the listener's toxics, then verifies an empty toxic list and a ready payments service before reporting success.

### E.4 What differs and why behaviour is the same

| Concern | Local | AWS | Why behaviour is the same |
|---|---|---|---|
| Fault mechanism | Toxiproxy `timeout` toxic (timeout 0) on the payments listener | the same, through the sidecar | One mechanism. Symptom equivalence is conformance-tested (below). |
| Metrics store | VictoriaMetrics | AMP | One PromQL-subset compiler. A conformance suite runs the same 40 queries on both and compares results within a documented tolerance. |
| Logs | Loki | CloudWatch Logs Insights | `LogSource` contract; the compiler emits per-backend text. The conformance suite checks filter, limit and ordering. Latency is not bounded by this design (G.1). |
| Identity | Dex | Cognito | Same OIDC discovery, audience and claim names. |
| Database | Postgres 16 container | RDS Postgres 16 | Same major version. Migrations run identically. |
| Restart | Docker restart of the payments container, then toxic clear | ECS task stop, then toxic clear in the sidecar | Same action contract and verification: empty toxic list and a ready service before success. |

Conformance checks run on both environments in the stack's verification stage:

- Fault symptom: the same blackhole produces the same caller-side metric shape and the same alert transition, `pending` then `firing`, within the derived bound in F.
- Restart reset: after `fleet.restart`, the toxic list is empty, and the `payments-upstream-failing` alert returns to `resolved` within the derived recovery bound in F.
- Replay: the fallback driver's structural checks pass on both.

The parity document lists each difference and the test that shows its effect is bounded. Nothing in the platform's logic branches on environment.

### E.5 MCP exposure

- **Local.** `http://localhost:8080/mcp`. Caddy in the full profile adds `https://lodestar.localhost`.
- **AWS.** `https://lodestar.<domain>/mcp` behind ALB. Humans use OAuth 2.1 authorization code with PKCE. The agent uses client credentials with a 3600 s token lifetime and a per-principal secret rotated before the demo.
- **Both.** `Origin` checks, a host allowlist, principal-bound tokens and the same grant evaluation.

---

## F. Five strongest technical claims

### Claim 1: A plan's diff is the diff that apply writes, and stale writes fail whole

For any valid batch of ops, the diff returned by `plan` equals, in canonical JSON, the patches `apply` writes, and the resulting state hash matches the hash computed from the base plus the ops. For any batch whose `base_versions` no longer match, `apply` writes nothing and returns a conflict whose three-way diff equals the diff of the mismatched entities.

- **Test.** A property-based test (fast-check) over 2,000 generated op batches on `dashboard`, `panel`, `query`, `annotation` and `flag` kinds, including invalid batches that must fail validation identically in plan and apply. Assertions: `canonical(plan.diff) == canonical(changes.map(c => c.patch))`; `stateHash(base, ops) == change.state_hash(head)`; for injected stale bases, zero change rows are written and the conflict's diff matches the recomputed one.
- **Observable.** `lodestar plan --verify` on the presenter machine runs the same comparison on a live plan.

### Claim 2: Undo is exact, and it reverts only the caller's own changes

After any random sequence of up to 200 changes across three principals, `undo` of a principal's changes in reverse order restores each affected entity's spec to its state before that principal's change, provided no other principal changed that entity afterwards. If another principal did, `undo` returns `E_VERSION_CONFLICT` and writes nothing. No undo ever changes a change row made by another principal.

- **Test.** A property-based test over random sequences including deletes, layout moves and flag changes. Assertions: state equality after each undo; zero writes on refusal; `lodestar audit verify` passes end to end; no change row authored by a non-caller principal is altered.
- **Observable.** The 255–275 s undo of the agent's flag change. The change log shows the original seq and the undo seq.

### Claim 3: A fault becomes a firing alert on the screens within a derived bound, and recovery follows the same path

The alert reads storefront's caller-side metric, which keeps reporting while the payments path is blackholed. The bound from fault to `firing` is the sum of its parts:

| Term | Value | Source |
|---|---|---|
| Storefront's failed call returns at its deadline | 2 s | configured deadline |
| Ratio reaches the threshold | 6 s | threshold 0.2 × window 30 s, under steady offered load to payments |
| Scrape interval | 5 s | worst case |
| Evaluation interval | 5 s | worst case |
| `for` duration | 10 s | rule parameter |
| Query evaluation | 2 s | design bound |
| SSE delivery to a screen | 1 s | design bound |
| **Derived worst case** | **31 s** | sum |

Recovery, after the toxic is cleared: the ratio falls to threshold when the 30 s window contains less than 6 s of failed calls, a worst case of 24 s; then scrape 5 s, evaluation 5 s, `resolve_for` 10 s, query 2 s and SSE 1 s, giving a **derived worst case of 47 s**.

- **Status.** These are derived bounds, not measurements. The derivation assumes steady offered load to payments during the window.
- **Test and measurement.** `lodestar demo measure --runs 20` injects and clears the fault through the fleet adapter, and records the event time of the toxic, the scrape that shows the effect, the `change` seq of the alert state, and the SSE receipt on three clients. It reports the distribution of fault-to-firing, fault-to-screen and restart-to-resolved. A run whose time exceeds a derived bound fails the measurement, so the bound is a checked invariant.
- **What is not claimed.** Pending and firing times on stage are not stated here. The rehearsal report records them. The claim covers the derived bound and the measured distribution, both on both environments.

### Claim 4: The fallback is the real MCP path, reproduces the structure of the live run, and preserves human work at takeover

- **Structure.** Replaying the recording against a reset workspace produces the same ordered list of agent tool calls, the same structural result for every call, the same alert transition sequence (`ok`, `pending`, `firing`, `resolved`), and the same final normalised entity set. Values differ, since the data is live.
- **Takeover.** A run that stops after checkpoint 3 and takes over reaches the same final normalised entity set as an uninterrupted replay.
- **Human work survives.** Two scripted cases:
  - A human change to an unrelated entity between a live agent change and takeover: takeover succeeds, and the human change is present afterwards.
  - A human change to an entity the agent changed after the checkpoint: the undo is refused, takeover is refused at that checkpoint, the human change is present, and the driver waits for the next checkpoint.
- **Test.** `lodestar demo rehearse` runs in the stack's verification stage: reset, replay, compare structure; reset, run the live prefix to checkpoint 3 with a simulated stall, take over, compare final sets; and the two takeover cases above.
- **Observable.** The audit view shows `client = demo-driver` for each replayed change, with the agent principal as actor, and the agent chip reads `replay`.

### Claim 5: A general agent with only the server's descriptions builds the answer

Given the resources and tool descriptions, with no bespoke prompt beyond the question, a pinned general-purpose model answers a fixed set of ten investigation questions by building a panel or dashboard that a checker verifies, with a median MCP call count that is reported as measured, and resolves every validation error within one retry.

- **Test.** `lodestar eval mcp`, ten questions against the rehearsal's seeded state. Per run it checks: the created entity exists and validates; the panel's query returns the expected series structure; all writes are in `ops`; no `E_UNKNOWN_FIELD` remains after a retry; no tool call targets a tool absent from `tools/list`, and the agent's `tools/list` equals the seventeen-tool catalogue.
- **Observable.** The eval report lists each call and its error code. The median call count is reported only as measured, per model version.

---

## G. Failure analysis

### G.1 Implementation difficulties

- **Fanout under restarts.** A subscriber that disconnects can miss notifications. Resume replays from the change log and returns `resync` when the gap exceeds the retained window, rather than guessing.
- **Caller-side metric semantics.** The alert depends on storefront's per-upstream outcome counters being correct across storefront restarts. Counter resets are handled by `rate()` in the transform runtime.
- **PromQL and LogQL edge semantics.** Step alignment, staleness and empty-series behaviour differ between VictoriaMetrics and AMP. The compiler restricts the subset and the conformance suite pins behaviour. Outside the subset, `E_UNSAFE_CONSTRUCT`.
- **Logs Insights latency.** Logs Insights has a different query model and latency from Loki. This design does not bound it, does not place a log query in any timed claim, and reports its latency as measured.
- **Hash chain under concurrency.** Writes serialise per workspace; previews do not take the lock.
- **Undo across version history.** Undo's guard is a version comparison. Two changes in a row by the caller on one entity undo in reverse; the test covers that order.
- **Schema generation.** TypeBox to JSON Schema to MCP input schema to OpenAPI must agree.
- **Toxic leakage.** A toxic left on the listener would keep the fault active after the presenter believes it cleared. Reset clears it, the stage pre-check reads the count, and `fleet.restart` verifies it.

### G.2 On-stage failure modes and mitigations

| Failure | What the audience sees | Mitigation |
|---|---|---|
| Agent writes to the wrong place | A change appears where the presenter did not intend | `plan` names the workspace in its summary. The grants cannot write to `finance`. Undo is one call, and it is in the script at 255–275 s. |
| Agent hallucinates a field | A validation error, then a correction | Errors include `valid_fields` and a suggestion. One retry per step. Two unexpected errors in a row trigger takeover at the next checkpoint. |
| Agent is slow | Pause on screen | Progress notifications keep the screen alive. Silence trigger and turn windows (C.4, C.5). |
| Agent asks a clarifying question | The agent asks what to do | Every prompt names its workspace and target. The driver never asks. |
| Agent unreachable | Connection error in the agent pane | The driver runs the same recording against the same platform. The platform's behaviour is unaffected. |
| Laptop stall | Charts lag, SSE lags | The console shows SSE lag and the platform's own command p95 from self-telemetry. A stall past the threshold in the rehearsal configuration triggers takeover at the next checkpoint. Only one fault may be active at a time, so a second injection is refused while the first is active. |
| Fault collides with reset | A half-reset stage | Reset clears toxics first, then restores services, then waits for `/readyz`. `--force` is the only way to reset during a fault. |
| Toxic left active before the audience sits down | Checkout is broken at the start | The pre-check reads the toxic count and blocks the start until it is zero. |
| Presenter approves on the wrong card | A definition approved unread | The card lists the steps, actions, reset rules and diff; the approver cannot approve their own requests. The presenter reads the card aloud. |
| Projector or screen disconnect | One screen stale | Each screen reconnects with `Last-Event-ID` and shows its sequence number in the corner for the presenter. |
| Clock skew | Annotations at the wrong time | The server stores UTC. The fault annotation is written from the fault adapter's event time, not the client's clock. |

### G.3 Agent failure modes

- **Wrong tool, right intent.** Querying metrics with a raw PromQL string gets `E_UNSAFE_CONSTRUCT` and an IR suggestion. This is the intended path to correctness.
- **Over-building.** The agent creates more panels than asked. The plan diff makes it visible.
- **Stale reads.** A plan based on a version a human has since changed gets `E_VERSION_CONFLICT`. This is the designed outcome and is in the script.
- **Wrong attribution in narration.** The agent names a principal or change incorrectly. The change log is authoritative and is on screen.
- **Wrong flag value.** The agent sets the flag to a value that does not help. The flag's effect is visible on the checkout panel, the change is attributed, and undo is one call.

### G.4 Hidden complexity

- Series-count estimation before running a query, which needs label cardinality the sources do not all provide.
- Workflow resumption after a runner restart mid-approval. The runner re-reads `waiting_approval` runs on start and does not re-run completed actions; idempotent action records make this safe.
- Presence cleanup when a browser closes without disconnecting.
- Progress notifications must not block apply; they are emitted from the query stage only.
- The flag poll in storefront: a flag change must take effect within one poll interval, and that interval is part of the on-stage timing.

### G.5 Features that look impressive but are shallow

- **Anomaly detection** is a rolling z-score. It is not seasonal, not multivariate and not trained.
- **Embedding** is a signed iframe URL with no cross-origin messaging.
- **Multi-tenancy** is workspace isolation inside one deployment. There is no tenant billing or per-tenant keys.
- **Lineage** is derived from references between entities and from query-to-source edges. It is not column-level.
- **Topology** comes from a declared dependency list, not traces.
- **Notifications** go to the in-app inbox and a webhook sink. There is no paging.
- **Approval** is single-approver. Quorum is not implemented.
- **Branches** are a column with copy-on-create. Merges are plans, not three-way merges of arbitrary specs.

---

## H. Feasibility

### H.1 Scope by component

| Component | What the work touches | Depends on |
|---|---|---|
| Kind registry and validator | TypeBox definitions per kind, generated JSON Schema, error model | nothing |
| Entity store, change log, hash chain | Two tables, command engine, advisory lock, NOTIFY fanout | kind registry |
| Plan/apply, base versions, idempotency | Plan table, expiry, conflict result, idempotency table | command engine |
| Policy, grants, approvals | Grant table, predicates, approval table, resolution endpoint, parity tests | command engine |
| Query IR and Postgres compiler | IR types, SQL compiler, parameter binding, row and column policy | entity store, grants |
| Metrics compiler and VictoriaMetrics source | PromQL subset compiler, storefront's caller-side metric, query adapter | IR |
| Transform runtime | Pure functions, reset-aware rate, z-score | IR |
| Log source | LogQL subset compiler, Loki adapter | IR |
| Flags | Flag entity, storefront poll and deadline change, agent write predicate | entity store, grants |
| Runner | Alert evaluator with `nodata`, incidents, workflow executor with approval steps, snapshot scheduler | query engine, command engine |
| Fault and restart actions | Toxiproxy admin client, `FleetAdapter` for Docker and ECS, reset verification | harbor images |
| Web UI | Dashboard grid, panels, parameters, cross-filter, drill, conflict card, approval card, changes and audit views, presenter console | SSE, query preview |
| MCP server | Tool definitions, resources, progress notifications, token binding, tool filtering by grant | command engine, grants, query |
| Fallback driver and recording | Recording format, stable names, checkpoints, takeover procedure, chip labels | MCP server |
| Conformance and property tests | Plan=apply, undo, authz parity, query conformance, fault symptom and restart reset on both environments | everything above |
| AWS target | ECS tasks, sidecar, RDS, AMP, CloudWatch adapter, Cognito, ALB, Secrets Manager, collector | every component's image |

### H.2 Critical dependencies

- **MCP SDK behaviour** for Streamable HTTP, progress notifications and tool-list filtering by principal. Verify against the pinned SDK version before the MCP server is built.
- **Postgres LISTEN/NOTIFY** over direct connections. RDS Proxy does not support LISTEN, so the API tasks connect directly.
- **Toxiproxy** timeout toxic behaviour, and its admin API, on the pinned version in both environments.
- **VictoriaMetrics and AMP** parity for the chosen PromQL subset.
- **Cognito and Dex** claim parity.
- **External agent connectivity** for the live path. The fallback removes this as a hard dependency for the platform, not for the live moment.

### H.3 Main risks and what reduces them

| Risk | Reduction |
|---|---|
| Agent tool design is weaker than the eval target | Build the eval harness against the vertical slice early, so descriptions are tuned on evidence. |
| Turn windows are longer than the model allows | Rehearsal reports per-turn p90 and takeover rate; a turn over the threshold is reshaped (C.5). |
| Presenter approves or moves at the wrong moment | The script names the gate for each human step, and the approval card carries its own contents. |
| Query compiler subset grows | The refusal list is part of the spec. New constructs need conformance on both backends. |
| Local laptop resources | Core profile is eleven containers; stall guard and single-fault rule (G.2). |
| Fault semantics differ between environments | One mechanism. The restart's reset rule is conformance-tested on both. |
| Caller-side metric is wrong for a reason the stage does not show | The metric is tested against a known blackhole in the rehearsal before the stage uses it. |

### H.4 Build sequence, dependency-ordered

Each step produces something runnable and testable and unblocks the next. This is an order, not a schedule.

1. **Vertical slice.** Kind registry for `dashboard` with one text panel; entity store; change log with hash chain; command engine with `plan` and `apply` and base versions; one principal; SSE fanout; a page that updates. Done when an MCP `apply` changes a page open in another browser and `audit verify` passes.
2. **Conflict result.** `E_VERSION_CONFLICT` with three-way diff, and no write on conflict. Done when the claim 1 stale-base test passes.
3. **Query IR and metrics source.** Harbor `storefront` with the caller-side metric, `orders` and `payments`; VictoriaMetrics; the metrics compiler; `timeseries` and `stat` panels; `query` and `query_explain`. Done when a panel renders live series and `query_explain` shows the compiled PromQL.
4. **Grants and the agent principal.** Grant table, evaluation, tool filtering by grant, `E_FORBIDDEN_*` with grant ids, token binding, the `run` verb with its predicate. Done when the finance denial appears with its grant id in a plan and `tools/list` matches the catalogue.
5. **Validation and error model.** Did-you-mean suggestions, `valid_fields`, `E_UNKNOWN_REF`, `E_TYPE_MISMATCH`, `untrusted_text` envelopes, and the agent limits. Done when the eval harness's first five questions run with recovery.
6. **Toxiproxy fault, alerts and incidents.** Toxiproxy in front of payments; `fleet.fault` and `fleet.fault.clear`; runner with the alert state machine and `nodata`; incident grouping; annotations through plan. Done when a blackhole produces the `pending` then `firing` sequence and an annotation on the panel, and the derived bound is checked by `measure`.
7. **Flags.** Flag entity, storefront poll and deadline change, agent write predicate, undo of a flag change. Done when the agent's flag change alters storefront's deadline and the undo reverts it.
8. **Approvals, actions and workflows.** `approval` table and resolution endpoint, definition hash and approval gate, step approval, `fleet.restart` with reset rule and verification, `workflow_run`. Done when a definition approved by a second principal runs, pauses at its step, restarts payments, and the conformance test shows the toxic is gone.
9. **Presence, conflict beat and screens.** WebSocket presence, the plan-hold gate in the agent flow, `screen_show`, agent chip with live or replay label. Done when two browser sessions and the agent work one board and the 135–165 s beat produces its conflict deterministically.
10. **Undo and branch diff.** `undo` with `expected_version` and own-change restriction, `branch_diff` with seq references, audit view. Done when the 225–275 s changes, diff and undo work from the agent.
11. **Full fleet and self-telemetry.** Harbor `inventory`, `cart`, `notify` and `redis` in the full profile; platform command metrics as a source; fleet dashboard. Done when the fleet dashboard runs for the whole scenario at the configured load.
12. **Row and column policy and Postgres source.** Orders and customers in `harbor`, predicate injection, masked emails for the agent. Done when the 275–300 s query returns masked emails for the agent and clear emails for Ada.
13. **Recording, driver and takeover.** Recording format, stable names, checkpoints, takeover procedure with undo and refusal, F9. Done when `demo rehearse` passes the structure check and both human-work takeover cases.
14. **Claims suite.** Plan=apply property test, undo property test, measurement harness with derived-bound checks, MCP eval harness. Done when each runs in the verification stage and reports.
15. **AWS target.** ECS task definitions from the same digests, the storefront sidecar, RDS, AMP, CloudWatch adapter, Cognito, ALB. Done when the conformance suite passes on both environments and the rehearsal passes on AWS.

### H.5 How the work is verified

- Cheap checks (type check, formatting, lint) run per change. Test suites run once per stack on the integration line.
- Each step's "done when" is an executable check, so progress is observable without anyone reporting it.
- The conformance suite, the property tests and the rehearsal are the three gates: the platform's semantics, the agent path's behaviour, and the on-stage script.

### H.6 What is deliberately not in the first slice

- The Postgres source, logs, presence, flags, approvals, branches, the AWS target and the fault console depend on the command engine and the grant model. None is needed to prove the core path.
- The fallback is built after the MCP server's tool surface is stable, so that the recording is not re-recorded at every description change.
