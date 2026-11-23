# Competitor 02 — Visual Spectacle (revised)

**Product title: Tessera**
*A composable operations canvas where humans and an MCP-connected agent build live, shared dashboards out of the same primitives.*

**Pitch.** Tessera is an enterprise operations platform whose panels, queries, alerts, workflows, grants and screens are typed, addressable objects that the web UI, the HTTP API and an MCP server all manipulate through one preview-and-commit path. On a shared wall in five minutes, an agent turns a live order stream into an investigation board, shares it through an approval gate, is refused one out-of-scope write, and then re-issues its own recorded session into a blank workspace, where every response is checked against its original.

---

## Revision log

Every finding from the four reviewers is listed. "Fixed" names the section where the change now lives. "Rebutted" gives the technical reason the finding does not change the design. "Accepted" names a known limitation that stays in the design and is stated in section G.

### Reviewer A — Principal Systems Engineer

| ID | Finding (short) | Response | Where |
|---|---|---|---|
| W1 | Fallback guard refuses divergent valid state; 20 s grace exceeds 20–30 s rows | **Fixed.** The driver now evaluates per-step satisfaction predicates, not a hash equality. On divergence it reverts only the live agent's own revisions since the last checkpoint, as new attributed revisions, then resumes. Stall grace is 8 s and is always shorter than a row's budget. | D.9, C (fallback rules), G |
| W2 | Parameters and cross-filter write revisions; history gets polluted | **Fixed.** `param.set` is removed from the MCP surface. Parameters, brushing and cross-filter are session state carried in the URL and the screen's session, and create no revision and no chain row. Drill-down is navigation to a parameterised view of an object that already exists. | D.12, B (V02, V03, D09), C rows R3, R7 |
| W3 | Chain serialisation point and global anchor undefined | **Fixed.** The serialisation point is a `FOR UPDATE` lock on one `audit_chain` row per workspace, held from `nextval` to commit. The global anchor is a signed record over all workspace heads, written every 60 s or every 500 events per workspace, whichever comes first. Verify semantics are stated. | D.7 |
| W4 | Two screen tool names and two preview mechanisms | **Fixed.** One screen tool, `tessera.screen.present`. One preview mechanism: every write returns a `preview_token`, and `tessera.commit` is the only commit path. `dry_run` is removed. | D.8 |
| W5 | Grant written as signed Cedar revision with no storage or signature rules | **Fixed.** `policy`, `grant_request`, `approval` and `signing_key` tables are added. Signature verification and hot-load rules are stated. | D.1, D.6 |
| W6 | `page-oncall-eu` sends a page on `resolved` | **Fixed.** The workflow pages on `firing`. On `resolved` it sends a separate `recovery_notice`, which is named as a notice. | C rows R8, R12; A01 |
| W7 | `screen.present` does not require the screen's principal to read the target | **Fixed.** Authority requires display scope on the screen and read on the target dashboard. | D.6, D.8 |
| W8 | Claim 5 hash includes panel results, which depend on the live feed | **Fixed.** Claim 5 hashes documents, revisions, the grant and approval records, and the simulator control log and PRNG counter. Panel results and alert state are excluded, and the claim says so. | F (claim 5), D.10 |
| W9 | Every read is a chain row; hot-row problem at read volume | **Fixed.** Reads are written to an unchained, append-only `call_log`. Only writes, refusals, approvals and scenario controls take the chain lock. | D.1, D.7 |
| W10 | Degradation is a presenter key; causal chain is a switch; timings are targets | **Partly fixed, partly accepted.** The degradation is a recorded, checkpointed control event. The causal chain from control event to latency is in the simulator's own emitted events, which the audience can see. The response timing is not promised and is removed from the script. The trigger remains a human key, which is accepted as a limitation. | C row R4; G |
| Req. | Rewrite fallback guard; shorten grace | **Fixed.** See W1. | D.9 |
| Req. | Move parameter and cross-filter state to URL and session | **Fixed.** See W2. | D.12 |
| Req. | Define chain serialisation and global anchor | **Fixed.** See W3. | D.7 |
| Req. | One screen tool name; one preview mechanism per family | **Fixed.** See W4. | D.8 |
| Req. | Add policy and grant storage with signatures and hot-load | **Fixed.** See W5. | D.1, D.6 |
| Req. | Page on firing, or rename the action | **Fixed.** Pages on firing; recovery is a notice. | C |
| Req. | Read check on target for `screen.present` | **Fixed.** See W7. | D.8 |
| Req. | Restrict claim 5's hash to documents and revisions | **Fixed.** See W8. | F |

### Reviewer B — Skeptical Technical Audience Member

| ID | Finding (short) | Response | Where |
|---|---|---|---|
| S1 | Script timings are design targets | **Fixed.** Pending "00:42", the 40 s recovery and the 2 s acknowledgement are removed. Row budgets remain only as fallback inputs, are labelled as budgets, and are replaced by rehearsal-measured values before the first stage run. | C |
| S2 | Replay re-applies stored patches, not MCP calls; counter counts refusals as revisions | **Fixed.** The primary replay re-issues the recorded MCP calls and matches response hashes. Stored-patch replay remains as a labelled second view. The counter reports calls, response matches, reproduced refusals and held privilege steps separately. | D.10, C row R13 |
| S3 | Checkpoint count inconsistent with table | **Fixed.** Eight checkpoints (C1–C8) are defined, one per checkpoint row, and the counter reads 8/8. | C |
| S4 | Inventory marks rows demonstrated that the stage does not show | **Fixed.** Demonstrated means shown on stage. Masking is shown in the investigation table at R6. Heatmap, histogram and text panels are supporting. | B |
| S5 | Two agent commit rules | **Fixed.** One rule, stated once: agents commit their own previews within scope; privilege changes are held for a human. | D.6 |
| S6 | WebGL renderer and three charting stacks | **Fixed.** WebGL is removed. ECharts is removed. One charting library (uPlot) plus hand-written SVG for stat, bar, table and text. | D (components) |
| S7 | 250–280 s row is confusing | **Fixed.** R10 names one device (screen P) and one action (the presenter types the prompt). The audience phone is not used in that row. | C row R10 |

### Reviewer C — Implementation and Reliability Engineer

| ID | Finding (short) | Response | Where |
|---|---|---|---|
| C1 | Checkpoint IDs are absolute; name rebinding unspecified | **Fixed.** Every object has a workspace-unique `name` in its document. Checkpoints are keyed by name and each checkpoint carries the rebinding table. | D.9, D.10 |
| C2 | No total fallback budget; read-only rows have no commit to detect a stall | **Fixed.** A 30 s slack pool covers the whole script. Stall detection applies to read rows through expected call names and in-flight calls. Slack remaining is shown after each row. | C, D.9 |
| C3 | Replay re-applies privileges without fresh approval | **Fixed.** Replay re-runs policy evaluation for every call. Privilege-changing calls are held and never executed. | D.10 |
| C4 | Simulator state outside MCP and checkpoint; RNG and Node unpinned | **Fixed.** Presenter controls are recorded as `change_event` rows. Simulator control log and PRNG counter are part of each checkpoint. The RNG is pinned with a golden vector, and the Node 22 release is pinned. | D.11, F |
| C5 | `seq > cursor` skips a lower sequence committing later | **Fixed.** Sequence assignment and commit happen under the workspace lock, so commit order equals sequence order within a workspace. The two-transaction out-of-order test is added. | D.4, D.7, F (claim 4) |
| C6 | Hot audit row mitigation undesigned; no anchor, cadence, verify or refusal-lock rules | **Fixed.** See W3. Refusal rows take the chain lock. | D.7 |
| C7 | No key management for approval signatures | **Fixed.** A platform signing key is held in KMS on AWS and in a file-mounted secret locally. The approver is identified by a fresh OIDC session. The key registry and rotation are stated. | D.6 |

### Reviewer D — Agent and MCP Tooling Engineer

| ID | Finding (short) | Response | Where |
|---|---|---|---|
| M1 | Preview optional for agents | **Fixed.** Every write without a `preview_token` is refused for agent principals with `VALIDATION_PREVIEW_REQUIRED`. Commit always references a token. | D.8 |
| M2 | Replay re-applies grant approval; no exclusion rule | **Fixed.** Grant, policy and principal events are excluded from replay. Privilege calls are re-evaluated and held. A test asserts that replay of an approved session yields an unapproved target. | D.10, F (claim 5) |
| M3 | Hash-equality guard defeats fallback in common stall | **Fixed.** See W1; per-step satisfaction checks replace the hash guard. | D.9 |
| M4 | Panel write verbs; `/panels` storage shape inconsistent | **Fixed.** Panel verbs are removed. Panels are a map keyed by id, with an order array, and changes use `dashboard.apply` generic ops. The example is corrected. | D.2, D.8 |
| M5 | Overlapping write verbs | **Fixed.** One verb per kind of change. The list is reduced in D.8. | D.8 |
| M6 | `idempotency_key` optional | **Fixed.** `commit` takes an idempotency key; its default is derived from the preview digest, so a retried commit of the same plan returns the first response. | D.8 |
| M7 | No rate limit on `screen.present` | **Fixed.** Limits are stated per screen and per principal. | D.8 |
| M8 | No pre-registered evaluation of an unaided agent | **Fixed.** A pre-registered evaluation E1, with a pass criterion, is in F. | F (E1) |

---

## Design mandate and how this proposal reads it

The mandate is visual spectacle: panels materialising as the agent works, live streams, cross-filtering, drill-down, and several screens reacting at once. Spectacle here is a consequence of composition, not decoration. Every animation is driven by a real change event with a sequence number, or by a user gesture on a session. Nothing animates on a timer that is not tied to a commit, a stream sample, a call or a gesture. That rule is what keeps the spectacle honest for an engineering audience, and it is what makes the demonstration replayable with the same pixels.

Quantities in this document are labelled. No prototype exists, so nothing is measured. A figure is one of three things: a **target** the test suite enforces, a **budget** that configures the fallback driver (not a claim about speed), or an **estimate** of scale derived from configured rates.

---

## A. Product concept

### What the platform is

Tessera is a multi-tenant dashboard and operations platform. It has four kinds of user-facing object and one mechanism.

- **Sources** describe where data comes from: a stream, a Postgres table, Parquet files, or the platform's own telemetry.
- **Queries** are named, typed pipelines over sources, stored as an intermediate representation (IR), not as SQL text.
- **Panels** render a query result as a timeseries, stat, bar, table, heatmap, histogram or text block.
- **Dashboards** arrange panels on a grid, declare parameters, and wire interactions (cross-filter, drill-down) between them.
- **Mechanism.** Every object above, plus alerts, workflows, grants, annotations and screens, is a typed document in one schema registry. Every change to a document is a revision. Every revision, refusal, approval and scenario control is a row in one hash-chained audit log per workspace.

The platform has no built-in intelligence. The "intelligence" a viewer sees is an external MCP client (Claude Code in the demo) calling the same tools a human reaches through the UI.

### Who uses it

- **Operations engineers** watch wall boards and act on alerts through workflows.
- **Analysts and product owners** compose investigations, branch dashboards to test a question, and share read-only views.
- **Platform and security staff** define sources, row-level policies and grants, and review the audit trail.
- **Agents** are external MCP clients acting under a scoped principal. They use the same objects as humans, through the same commit path, with no private API.

### What data the demo is about

The domain is an order-fulfilment network, produced by a running process rather than a file of numbers.

- **Fulfilment simulator (`fulfilment-sim`).** A TypeScript service that generates orders, routes them to fulfilment centres in three regions (eu, us, apac), calls simulated carrier integrations, and emits events to `fulfilment.events` and `carrier.status`. It uses a PCG64 generator with its seed committed in the scenario file (section D.11).
- **Scenario incident.** The scenario declares a carrier degradation in the eu region: a timeout change on the `carrier-dhl` integration raises its latency distribution and retry rate. The presenter fires it with one key, which records a control event. The degradation then appears only in the emitted events. No dashboard is told about it.
- **Platform self-telemetry.** The audit log, query log and job queue are sources, so "what changed in the last hour?" is a query over the platform's own record.
- **Reproduction.** `make demo-reset` truncates the demo workspaces, restores the sample dashboards, resets the consumer offsets and reseeds the simulator. The reset prints the initial checkpoint (C0) and refuses to start a script if C0 does not match.

Volumes (estimates from configured rates): about 180 events per second at default scale. The actual rate is measured during the build and the scenario is retuned to a laptop-class machine.

---

## B. Capability inventory

Each row is a primitive that is addressable through the UI, the HTTP API and MCP, shares the schema registry, the authorisation model, the audit log, the realtime channel and the revision store. **Demonstrated** means the row is visibly shown in the five-minute script (section C). **Supporting** means it is real, tested and reachable, but is not on stage.

| ID | Primitive / capability | Status | Technical significance | Composes with |
|---|---|---|---|---|
| P01 | Typed object registry (JSON Schema per kind, versioned) | Demonstrated | One validation system; generates HTTP schemas, MCP tool schemas and UI forms | Everything |
| P02 | Revision store with JSON-Patch deltas and base-revision checks | Demonstrated | Every document write is a patch against a known revision; enables optimistic concurrency, diff, undo, branching | P03, P07, P11 |
| P03 | Hash-chained change log, one chain per workspace | Demonstrated | Tamper-evident record of writes, refusals, approvals and scenario controls | P02, P05, P19 |
| P04 | Realtime channel (sequence-numbered, per workspace and per object) | Demonstrated | Drives panels, presence and the trace ribbon | P02, P06, P13 |
| P05 | Authorisation engine (Cedar, policies as stored revisions) | Demonstrated | One decision point for UI, API and MCP; returns explanations for `acl.explain` and refusals | P08, P09, P14 |
| P06 | Presence and remote cursors | Demonstrated | Ephemeral awareness; the agent appears as a labelled participant | P04, P18 |
| P07 | Branches of a dashboard, with diff and merge | Demonstrated | Agent works on a branch; a merge is a preview and commit | P02, P12 |
| P08 | Principals: user, group, service, agent (scoped), screen (display scope) | Demonstrated | Agent is a principal with explicit scopes; screens are principals too | P05, P03 |
| P09 | Row-level predicates injected into the query IR | Demonstrated | A policy becomes a predicate, so panels, exports and alerts see the same rows | P05, D05 |
| P10 | Column masking | Demonstrated | Masked columns are typed in the IR; the investigation table shows masked customer values | P09, D05 |
| P11 | Undo and rollback as new revisions | Demonstrated | Revert is a revision built from the stored inverse; history is never rewritten | P02, P03 |
| P12 | Copy from a revision | Demonstrated | Copy-on-write from a named revision; the copy keeps its lineage | P02, P07 |
| P13 | Grants and read-only shares | Demonstrated | A grant is a request, a human approval and a signed policy revision | P05, P08, C02 |
| P14 | Policy hot-load with signature verification | Demonstrated | New policy versions take effect after signature and approval checks | P05, P03 |
| D01 | Stream source (Kafka protocol; Redpanda locally, MSK on AWS) | Demonstrated | Live feed; consumer offsets are part of source state | D05, D08 |
| D02 | Relational source (Postgres) | Supporting | Reference data (carriers, centres) | D05 |
| D03 | Object-store source (Parquet on S3 or MinIO) | Supporting | Compacted history | D05 |
| D04 | Platform telemetry source (audit, call log, job queue) | Demonstrated | "What changed in the last hour?" is a query over the platform's own record | D05, P03 |
| D05 | Query IR (typed pipeline) | Demonstrated | Single query representation, compiled to DuckDB SQL | P09, D06, D10 |
| D06 | Transform steps: filter, project, derive, group, window, join, topN, pivot | Demonstrated | Typed steps with computed output schemas | D05, D07 |
| D07 | Anomaly detection (robust z-score, seasonal baseline) | Demonstrated | Deterministic; output is a boolean column for alerts and annotations | D06, V06 |
| D08 | Computed metrics (named expressions over IR columns) | Demonstrated | "p95_ms" defined once, used by panels, alerts and exports | D05, V01 |
| D09 | Parameters (typed session variables) | Demonstrated | Set by brushing, drill-down and screen presentation; never a revision | V02, V03, D12 |
| D10 | Result cache keyed by IR hash, source watermark and predicate hash | Demonstrated | Identical queries from many panels cost one execution; invalidation is exact | D05, D01 |
| D11 | Lineage graph | Demonstrated | Answers "what breaks if this source changes" | P02, D05, A01 |
| D12 | Explain plan and cost preview | Demonstrated | Row and scan-byte estimates from DuckDB's plan, read by the agent before a heavy query | D05 |
| V01 | Panel types: timeseries, stat, bar, table | Demonstrated | Pure functions of a query result and a spec | D08, V02 |
| V01a | Panel types: heatmap, histogram, text | Supporting | Same mechanism; not on stage | D08 |
| V02 | Cross-filter brushing (session state) | Demonstrated | A selection sets a session parameter; bound panels re-query | D09 |
| V03 | Drill-down (navigation to a parameterised view) | Demonstrated | Links are typed: target object plus parameter mapping; no revision is created | D09, P02 |
| V04 | Grid layout with breakpoints | Supporting | Layout is part of the dashboard document; moves are ops | P02 |
| V05 | Annotations on time ranges or points | Demonstrated | Objects with their own revisions and audit | P02, V01 |
| V06 | Thresholds and alert rules | Demonstrated | Query plus condition plus target; fires into a workflow | D05, A01 |
| V07 | Live animation tied to sequence numbers | Demonstrated | No timer-driven updates | P04 |
| A01 | Workflows as state machines | Demonstrated | Guards on alert states; actions are HTTP calls; history is observable | P03, V06 |
| A02 | Alert-to-workflow triggers | Demonstrated | `firing` starts a page; `resolved` sends a recovery notice | V06, A01 |
| A03 | Forms that write back | Supporting | Form submit is a preview and commit | P01, A01 |
| A04 | Scheduled reports | Supporting | Scheduled queries under the owner's scope, recording the watermark used | D05, P05 |
| A05 | Export (CSV, Parquet, PNG) | Supporting | Same IR and row filters as the panel | D05, P09 |
| C01 | Comment threads | Supporting | Threads are objects; agent replies are attributed | P04, V05 |
| C02 | Sharing and read-only grants | Demonstrated | See P13 | P05, P08 |
| C03 | Embedding | Supporting | Same authorisation path | P05 |
| M01 | Multi-tenancy by workspace | Demonstrated | Workspace is the partition key; cross-workspace reads are impossible by construction | P09, P05 |
| M02 | Generated HTTP API | Supporting | Cannot drift from the object model | P01 |
| M03 | MCP server (Streamable HTTP and stdio bridge) | Demonstrated | The agent's entire surface | P01, P05, P03 |
| M04 | Preview and commit protocol | Demonstrated | Every write is previewed; the only commit path is `commit` | P02, M03 |
| M05 | Screen presentation (`tessera.screen.present`) | Demonstrated | Moves a named screen pane to a dashboard | P04, P08 |
| M06 | Replay of an audited session by MCP re-issue | Demonstrated | Re-issues recorded calls into a blank workspace and matches responses | P03, M03 |
| M07 | Reset and readiness (`make demo-reset`) | Demonstrated | Prints the initial checkpoint; script refuses to start on mismatch | P03, D01 |
| M08 | Fallback driver with per-step satisfaction checks | Demonstrated | Issues the recorded MCP calls as the `driver` principal | M03, M06 |
| M09 | Stored-patch replay (second view) | Demonstrated | Applies stored revision patches in order; labelled as a different thing from M06 | P02, P03 |

Count: 49 rows. Demonstrated: 38. Supporting: 11. Every supporting row is an export of a demonstrated primitive or a consumer of one.

### Composition map

```
          P01 typed registry ─────────┬────────────┬──────────────┐
                 │                    │            │              │
          M02 HTTP API         M03 MCP server   web UI      P02 revisions
                 │                    │            │              │
                 └──── M04 preview ───┴── commit ──┘              │
                                          │                       │
  P05 authZ (Cedar) ── P08 principals ── P13 grants ── P14 hot-load│
        │                                     │                   │
  P03 chain per workspace ◄── every write, refusal, approval ◄── P07 branches
        │                                     │                   │
        ├── M06 MCP-replay (D.10)        P11 undo   P12 copy-from-revision
        └── M09 stored-patch replay

  D01 stream ─┐
  D02 Postgres├─► D05 query IR ─► D06 transforms ─► D07 anomaly
  D03 Parquet ┘        │      └─► D08 metrics ─► D09 session parameters ─► V01 panels
  D04 telemetry ───────┘                              │          │
                                                      │       V02 cross-filter (session)
                                                      │       V03 drill (navigation)
                                                      │       V05 annotations (revisions)
                                                      └────► V06 alert ─► A02 ─► A01 workflow

  M05 screen.present ─► screen panes (wall-left, wall-right) ─► P04 realtime
  P06 presence ◄── agent and humans
```

Three compositions carry the demo.

1. **Query → panel → session parameter → query.** A brush in one panel sets a session parameter. The parameter is part of the IR of every bound panel, and the IR hash decides cache reuse. The brush therefore changes several queries and renders through one mechanism, with no revision.
2. **Agent preview → commit → revision → chain → event → every screen.** The agent's preview and a human's preview go through one commit path. Each commit produces a revision, a chain row and a sequence-numbered event that every subscribed screen applies. The agent's trace ribbon is another subscriber.
3. **Agent call → call log → replay.** Every call is recorded with its arguments and response hash. Replay re-issues the calls and compares responses, so the replay proves composition at the call level, not only at the storage level.

---

## C. Five-minute live script

### Conventions

- **Screens.** Screen **W** is the wall: a 4K Chromium kiosk split into two named panes, `wall-left` and `wall-right`. Each pane is a screen principal with display scope. Screen **P** is the presenter console on a laptop: Claude Code, the Tessera console, and a key bar. Screen **A** is an audience phone-width session signed in as `user:audience-eu-ops`, which has no access to the investigation until R9. Screen **T** is the Composition Trace ribbon. Every session can show it. It lists each call with its status, its response hash and, for writes, its revision and chain sequence.
- **Agent prompts** are typed on screen P exactly as written. There are four.
- **Authority of each action.** Agents commit their own previews within scope (rule in D.6). Human actions on the wall or console are session gestures (no revision) or scenario controls (recorded, not MCP). The only human commit in the script is the approval at R9, which is a privilege change and is therefore human-only.
- **Budgets.** Each row has a budget in seconds. The budget is a configuration input to the fallback driver. It is not a promised duration. The rehearsal replaces each budget with the measured value, and the table is revised once before the first stage run. The sum of budgets is 270 s and the slack pool is 30 s, giving 300 s.
- **Checkpoints.** Rows marked with a checkpoint have a checkpoint C1–C8. C0 is the reset-verified initial state. Read-only rows have satisfaction predicates instead of checkpoints (D.9).

### Timeline

| Row | Budget (s) | Presenter action | Expected MCP calls and platform effects | Visible result | Capabilities | Checkpoint |
|---|---|---|---|---|---|---|
| R0 | 20 | States purpose on screen W: "This is a live order network. Nothing on this wall was built by hand, and an agent is about to build an ops board on it." | None. Stream live since reset (D01). Presence shows the presenter and the audience session (P06). | Live counters move. Two human presence markers. Wall otherwise empty. | D01, P06, V07 | none (C0 from reset) |
| R1 | 20 | Types on screen P: `Build an ops board for the fulfilment stream: throughput, p95 latency and error rate by region, last hour. Flag anomalies.` | `session.whoami` (principal `agent:demo-ops`, scopes); `catalog.search {query:"fulfilment"}`; `source.describe {id:"src_fulfilment_stream"}`; `query.preview` three times with `limit: 20`; `query.explain` on p95; `dashboard.create` with a TDS document, which returns a `preview_token`. | Trace ribbon fills with calls. A ghost overlay of the proposed board appears in `wall-left`, marked "proposed, not committed", with its digest and expiry. | P01, M03, P05, P08, D01, D12, M04 | none (reads plus one preview) |
| R2 | 25 | None. | `commit {preview_token}` writes the dashboard (rev 1), three queries, four panels, one alert rule, in one transaction. `screen.present {screen_id:"wall-left", dashboard_id}`. | Ghost resolves into the live board. Panels appear one at a time, each already holding data. Each appearance follows a sequence-numbered event. Stat tiles tick with the stream. | P02, M04, P03, P04, V01, V07, M05 | **C1** |
| R3 | 8 | Clicks the eu bar in the region breakdown on `wall-left`. | No MCP call and no revision. The `wall-left` session sets `region=eu` (D.12). Panels bound to `region` re-query; the result cache misses only on the changed IR hash. | Every bound panel dims to the eu subset. Trace ribbon shows "view: region=eu (session, presenter)" in a distinct style from commits. | V02, D09, D10, P06 | none |
| R4 | 12 | Presses `I` on screen P. | The console writes a scenario control, recorded as a `change_event` with `transport: console`, `action: scenario_control`. The simulator consumes it and emits degraded carrier events. The alert rule moves to `pending`. | Stat tile turns amber, then red. The timeseries gains an anomaly band (D07). The alert pill on `wall-left` reads "pending". | D01, D07, V06, A01 (pending), V07 | **C2** |
| R5 | 25 | Types: `Why did eu p95 latency spike in the last few minutes? Show me what changed.` | `query.preview` grouped by `carrier`, then by `carrier` and `timeout_config_version`; `lineage.trace {object_id:"panel_p95", direction:"up"}`; `audit.query {since:"10m", source:"carrier.status"}`. All are reads, recorded in `call_log`. | Ribbon shows four reads and no writes. A "p95 by carrier" bar appears as a ghost in `wall-right`. The agent states the finding in two sentences with its queries linked. | D05, D11, D04, V01, P03 | none (satisfaction: four reads returned, finding names carrier dhl and the config version) |
| R6 | 25 | None. | `dashboard.create {name:"investigation", branch:"investigation"}` preview and commit; `annotate` on the config change preview and commit; `dashboard.apply` with RFC 6902 ops adding `/panels/carrier_bar` (with drill link), `/panels/latency_overlay` (with annotation), `/panels/slow_orders` (with masked `customer` column) and `/panel_order/-` entries. `screen.present {screen_id:"wall-right", dashboard_id}` with the branch label. | A second board forms in `wall-right`, labelled "branch: investigation". The config-change annotation appears as a vertical rule on the timeline. Masked column shows `***` and the audit row records the mask. | P07, V05, P10, V03, P02, M05 | **C3** |
| R7 | 8 | Clicks the carrier bar on `wall-right`. | No MCP call and no revision. Drill-down sets the `wall-right` session parameters `carrier=dhl` and `region=eu` (D.12). The `order_trace` panel, already present in the investigation board from R6 and hidden until its parameter is set, runs its query. | An order-trace panel with per-order timing segments appears beside the bar. Its animation is driven by the first result event of its query. | V03, D09, P04 | none |
| R8 | 30 | Types: `Merge the investigation to the wall, share it read-only with group eu-ops, and create a workflow that pages on-call when eu p95 stays above 800 ms for 2 minutes.` | `branch.diff` (read); `dashboard.apply` on the live board to merge (preview, commit, within scope); `acl.propose_grant {object_id, group:"eu-ops", role:"viewer", reason}` (preview, then commit, which creates a `grant_request` in state `pending`); `workflow.define page-oncall-eu` with guard `alert.eu_p95 == firing for 120 s` and action `webhook:pager-sink` on `firing` (preview, commit). The alert reaches `firing` in this row or the previous one, which the pager-sink receives as a page. | The merge animates into the live wall board. A grant card appears on screen P and on `wall-left`: "agent:demo-ops requests viewer for eu-ops on Investigation. Approve?". The alert pill changes to "firing". The pager-sink panel on screen P shows one page. | P07, P05, A01, A02, M04, C02 | **C4** |
| R9 | 12 | Presenter approves the grant on screen P with one click. | Human-only `grant_approve` through the UI transport. The approval record is written, the policy revision is written and verified (D.6), and the share takes effect. Realtime event reaches screen A. | Screen A changes from "403, no access" to the investigation board, live, in its phone layout. Presence shows the audience session as a viewer. | P13, P14, P05, P04, P06, C02 | **C5** |
| R10 | 20 | Types on screen P only: `Also copy the investigation into the finance workspace.` | `dashboard.create {workspace:"finance"}` preview returns `AUTHZ_SCOPE` with the denying policy id `agent-no-cross-workspace` and the suggestion "request a grant via acl.propose_grant, or copy to workspace ops-demo". The refusal is written to the chain. | Trace ribbon shows a red entry naming the policy. The agent says in chat that it cannot write to finance and proposes the copy in ops-demo. | P05, P08, P03, M04 | **C6** (refusal row) |
| R11 | 15 | None. | `dashboard.create {workspace:"ops-demo", title:"Investigation (copy)", from_revision:{object:"investigation", rev:<R6 head>}}` preview and commit; `screen.present {screen_id:"wall-left"}` to the copy. | A second dashboard replaces the live board in `wall-left` as the copy is presented. The live board stays in `wall-right`. | P12, P01, P09, M05 | **C7** |
| R12 | 20 | Presses `R` on screen P. | The console writes the recovery control event (recorded). Latency falls. The alert moves to `resolved`. The workflow moves `firing` to `resolved` to `closed` and sends one `recovery_notice` to pager-sink. | Stat tile returns to green. The workflow history panel shows the transitions and the notice, named as a recovery notice and not a page. | A01, A02, V06, D07 | **C8** |
| R13 | 30 | Clicks "Replay session" in the trace ribbon. | `session.replay {session_id, target_workspace:"blank-2"}` runs as the `driver` principal, re-issuing the recorded calls in order with name rebinding. Responses are hashed and compared. Privilege calls are re-evaluated and held. The stored-patch view runs as a second, labelled view. | Screen W's right half rebuilds the investigation in `blank-2`, call by call. Counter: "calls re-issued, response hashes matched, refusal reproduced, privilege step held (not re-granted), checkpoints 8/8 verified." | M06, M09, P03, P02, P08 | verified C1–C8 |

The row count is 14 (R0–R13). The checkpoint count is 8 (C1–C8), and the replay counter reads 8/8.

### What the audience sees at the close

The final 30 s carry the strongest moment: the platform re-issues an agent's recorded session into an empty workspace, and each response matches the original. Two details keep this honest. First, the replay runs the policy engine again, so the grant is not re-granted; the counter says so, and the audience sees the held step. Second, the refusal at R10 is reproduced, because the policy decides before any object lookup. The audience sees the same objects reappear, and sees one step declined for a reason.

### Where the fallback takes over

The live agent is the default in every row. The fallback driver (M08) is a second MCP client, acting as the `driver` principal with the agent's scopes, issuing the recorded calls from a rehearsal transcript. It takes over only at a step boundary, never mid-call. The rules are in D.9. In short:

- A stall is a row step whose satisfaction predicate is unmet, with no MCP call in flight, for 8 s. A pending call that has run longer than 8 s is also a stall. The 8 s grace is shorter than every row budget.
- The driver draws on a 30 s slack pool for the whole script. Each takeover is charged its grace. The pool remaining is shown on screen P after each row.
- The driver reconciles divergence by reverting only the live agent's own revisions since the last checkpoint. It refuses and prompts if a human revision exists in that span. Reconciliation is shown in the ribbon as driver calls.
- The on-screen difference is one label on screen P, `driver`. The wall shows the calls, not the transport.

---

## D. Technical architecture

### Components

| Component | Technology | Responsibility |
|---|---|---|
| `web` | TypeScript, React 18, Vite, TanStack Query, Zustand; uPlot for timeseries (canvas); hand-written SVG for stat, bar, table and text | Renderer, editor, console, wall panes, trace ribbon |
| `api` | TypeScript on Node 22 (pinned release), Fastify, JSON Schema generated from the registry | HTTP API, auth, command handlers, preview store |
| `mcp` | TypeScript, `@modelcontextprotocol/sdk` (Streamable HTTP and stdio) | MCP server; calls the same command handlers as `api` |
| `gateway` | Node 22, `ws`, Postgres `LISTEN/NOTIFY` consumer | Realtime fan-out with sequence numbers and gap recovery |
| `query` | Node 22 worker with DuckDB node bindings | Compiles IR to SQL, applies row predicates, returns Arrow IPC |
| `ingest` | Node 22; Kafka client | Consumes streams, maintains source watermarks and simulator checkpoints |
| `policy` | Cedar (Rust core via WASM, called from Node) | Authorisation decisions with explanations; hot-loads verified policy versions |
| `driver` | TypeScript | Fallback driver and session replay |
| `sim` | TypeScript, PCG64 with BigInt | Fulfilment simulator |

Justification of the main choices:

- **TypeScript end to end** keeps one schema registry in one language, shared by the browser, the API and the MCP server. The query engine is a thin compiler over DuckDB, so a second language would add cost without a matching benefit.
- **Postgres 16** holds metadata, revisions, the audit chain and the call log. It gives transactions, row-level security as a second line of defence, `LISTEN/NOTIFY`, and `jsonb`.
- **DuckDB** executes analytic queries. It reads Parquet and Postgres and has a stable plan output for `query.explain`.
- **One charting library.** uPlot draws timeseries on canvas. Stat, bar, table and text are small SVG components over the same panel spec. ECharts and WebGL are not used. A stream rate that needed WebGL would be a measured result, and none exists.
- **Cedar** keeps policies as data, explains decisions, and runs in-process. Its explanation of a denial (policy id and attribute) is the source of the agent-facing error.
- **Yjs is not on the demo path.** Dashboards are structured documents with revisions. Yjs is reserved for comment bodies (C01, supporting).

### D.1 Persistence model

All tables carry `workspace_id` and are protected by row-level security keyed on a session setting set from the authenticated principal.

```sql
CREATE TABLE object (
  id            text PRIMARY KEY,           -- 'dash_…', 'qry_…', 'src_…', 'alert_…', 'wf_…'
  workspace_id  text NOT NULL,
  kind          text NOT NULL,              -- dashboard | query | source | alert | workflow | grant_request | annotation | thread
  name          text NOT NULL,              -- workspace-unique slug; the stable identity used by checkpoints and replay
  branch        text NOT NULL DEFAULT 'main',
  head_rev      bigint NOT NULL,
  doc           jsonb NOT NULL,             -- materialised document, validated against the kind schema
  schema_ver    int NOT NULL,
  deleted_at    timestamptz,
  UNIQUE (workspace_id, kind, name, branch)
);

CREATE TABLE revision (
  id            bigserial PRIMARY KEY,
  object_id     text NOT NULL REFERENCES object(id),
  branch        text NOT NULL,
  base_rev      bigint NOT NULL,
  rev           bigint NOT NULL,
  actor         text NOT NULL,              -- 'user:…', 'agent:…', 'driver:…', 'screen:…', 'system:…'
  transport     text NOT NULL,              -- 'ui' | 'http' | 'mcp' | 'console' | 'driver' | 'system'
  patch         jsonb NOT NULL,             -- RFC 6902
  inverse_patch jsonb NOT NULL,
  preview_digest bytea,                     -- set on every commit
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (object_id, branch, rev)
);

CREATE TABLE audit_chain (                  -- the serialisation point; one row per workspace
  workspace_id  text PRIMARY KEY,
  head_seq      bigint NOT NULL,
  head_hash     bytea NOT NULL
);

CREATE TABLE change_event (                 -- writes, refusals, approvals, scenario controls only
  seq           bigint PRIMARY KEY,         -- assigned from a sequence while holding the workspace lock
  workspace_id  text NOT NULL,
  chain_index   bigint NOT NULL,            -- position in this workspace's chain
  ts            timestamptz NOT NULL,
  actor         text NOT NULL,
  transport     text NOT NULL,
  action        text NOT NULL,              -- commit | refuse | grant_request | grant_approve | policy_load | scenario_control | …
  object_id     text,
  revision_id   bigint,
  outcome       jsonb NOT NULL,             -- includes denying policy ids on refusals
  prev_hash     bytea NOT NULL,
  hash          bytea NOT NULL,             -- sha-256 over canonical(prev_hash, row)
  UNIQUE (workspace_id, chain_index)
);

CREATE TABLE audit_anchor (                 -- global anchor over all workspace heads
  anchor_id     bigserial PRIMARY KEY,
  created_at    timestamptz NOT NULL,
  heads         jsonb NOT NULL,             -- sorted [{workspace_id, head_seq, head_hash}]
  digest        bytea NOT NULL,             -- sha-256 over canonical(heads)
  key_id        text NOT NULL,
  signature     bytea NOT NULL
);

CREATE TABLE call_log (                     -- reads and all MCP calls; not chained
  id            bigserial PRIMARY KEY,
  session_id    text NOT NULL,
  workspace_id  text,
  principal     text NOT NULL,
  transport     text NOT NULL,
  tool          text NOT NULL,
  args          jsonb NOT NULL,             -- ids as recorded; rebinding applied at replay
  args_digest   bytea NOT NULL,
  status        text NOT NULL,              -- ok | error code | preview | held
  response_hash bytea,                      -- over the canonical response with ids replaced by names
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE preview (
  token         text PRIMARY KEY,           -- opaque, 128-bit
  principal     text NOT NULL,
  workspace_id  text NOT NULL,
  object_id     text,
  base_rev      bigint,
  ops           jsonb NOT NULL,             -- the exact operations previewed
  digest        bytea NOT NULL,             -- sha-256 over canonical(principal, workspace, object, base_rev, ops)
  diff          jsonb NOT NULL,
  validation    jsonb NOT NULL,
  expires_at    timestamptz NOT NULL,       -- 10 minutes after creation
  consumed_at   timestamptz                 -- single use
);

CREATE TABLE idempotency (
  principal     text NOT NULL,
  key           text NOT NULL,              -- default: digest of the preview
  response      jsonb NOT NULL,
  expires_at    timestamptz NOT NULL,       -- 24 hours
  PRIMARY KEY (principal, key)
);

CREATE TABLE policy (
  id            text PRIMARY KEY,           -- e.g. 'agent-ops-demo-write'
  workspace_id  text,                       -- null for platform-wide policies
  version       int NOT NULL,
  cedar_text    text NOT NULL,
  cedar_hash    bytea NOT NULL,
  status        text NOT NULL,              -- pending | active | superseded | rejected
  approval_id   text REFERENCES approval(id),  -- null for seeded policies
  signature     bytea,
  key_id        text,
  created_at    timestamptz NOT NULL,
  UNIQUE (id, version)
);

CREATE TABLE grant_request (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL,
  object_id     text NOT NULL,
  subject       text NOT NULL,              -- group or principal
  role          text NOT NULL,
  requested_by  text NOT NULL,
  reason        text NOT NULL,
  status        text NOT NULL,              -- pending | approved | denied
  created_at    timestamptz NOT NULL
);

CREATE TABLE approval (
  id              text PRIMARY KEY,
  grant_request_id text NOT NULL REFERENCES grant_request(id),
  approver_sub    text NOT NULL,            -- from a fresh OIDC session (max auth age 5 min)
  decision        text NOT NULL,            -- approve | deny
  policy_hash     bytea,
  decided_at      timestamptz NOT NULL,
  key_id          text NOT NULL,
  signature       bytea NOT NULL            -- over canonical(grant_request_id, policy_hash, approver_sub, decided_at)
);

CREATE TABLE signing_key (
  key_id        text PRIMARY KEY,
  public_key    bytea NOT NULL,
  valid_from    timestamptz NOT NULL,
  valid_to      timestamptz                 -- null while current; rotation sets it, old keys still verify old records
);

CREATE TABLE screen (
  id            text PRIMARY KEY,           -- 'wall-left', 'wall-right', 'screen-p'
  display_scope text NOT NULL,
  workspace_id  text NOT NULL
);

CREATE TABLE sim_checkpoint (
  workspace_id  text NOT NULL,
  checkpoint    text NOT NULL,              -- 'C0'…'C8'
  prng_counter  bigint NOT NULL,
  offsets       jsonb NOT NULL,             -- per topic and partition
  control_seq   bigint NOT NULL,            -- last scenario_control change_event in the checkpoint
  PRIMARY KEY (workspace_id, checkpoint)
);

CREATE TABLE source_watermark (
  source_id     text NOT NULL,
  partition     text NOT NULL,
  offset_or_ts  text NOT NULL,
  updated_at    timestamptz NOT NULL,
  PRIMARY KEY (source_id, partition)
);
```

Queries, panels and dashboards are stored as documents in `object.doc`. The compiled SQL is derived, cached by IR hash, and never authoritative.

A trigger refuses any update to `object.doc` that has no matching `revision` row in the same transaction. This is the rule that keeps replay honest. It is tested by a scan for writes without revisions (section F, claim 1).

### D.2 Declarative specification language (TDS)

Agents and the UI produce **Tessera Document Spec** documents. A dashboard document is self-contained: parameters, queries, panels in a map keyed by id, an ordering array, interactions, alerts and layout. It is plain JSON validated by the registry, so it can be diffed, branched, exported and re-applied.

```json
{
  "tds": "1.0",
  "kind": "dashboard",
  "name": "ops_latency",
  "title": "Order latency — eu focus",
  "params": {
    "window": { "type": "timerange", "default": "last_1h" },
    "region": { "type": "enum", "values": ["all", "eu", "us", "apac"], "default": "all" }
  },
  "sources": { "orders": { "ref": "src_fulfilment_stream" } },
  "queries": {
    "p95": {
      "from": "orders",
      "where": [{ "field": "region", "op": "in", "value": "$region" }],
      "window": { "by": "event_time", "size": "1m", "range": "$window" },
      "aggregate": [{ "fn": "p95", "field": "latency_ms", "as": "p95_ms" }],
      "transform": [
        { "op": "anomaly", "field": "p95_ms", "method": "robust_zscore", "threshold": 3.5, "as": "is_anomaly" }
      ]
    }
  },
  "panels": {
    "p95_trend": {
      "type": "timeseries",
      "query": "p95",
      "x": "window_start",
      "y": ["p95_ms"],
      "annotate": ["is_anomaly"],
      "grid": { "x": 0, "y": 0, "w": 8, "h": 5 },
      "links": [
        { "on": "click", "action": "drill", "to": "dash_order_trace", "params": { "at": "$point.window_start" } }
      ]
    },
    "p95_now": {
      "type": "stat",
      "query": "p95",
      "value": "last(p95_ms)",
      "thresholds": [{ "gt": 800, "style": "critical" }],
      "grid": { "x": 8, "y": 0, "w": 4, "h": 5 }
    }
  },
  "panel_order": ["p95_trend", "p95_now"],
  "interactions": { "brush": { "emits": "session_param:window" } },
  "alerts": {
    "eu_p95_high": { "query": "p95", "when": "last(p95_ms) > 800", "for": "2m", "fire": "workflow:page-oncall-eu" }
  }
}
```

Language rules, enforced by the registry:

- References are typed. `$region` must name a declared parameter whose type fits its position.
- Every query's output schema is computed at validation time. A panel's `y` must exist in its query's output.
- Panels are a map keyed by `id`. Order is the separate `panel_order` array, which has its own merge rule (D.5). No panel is addressed by array index.
- Unknown keys are errors, not warnings. This is the main defence against hallucinated fields.
- Panels cannot contain code. Expressions are typed IR fragments and the threshold grammar.
- `name` is workspace-unique for its kind and branch. It is how checkpoints and replay identify objects across workspaces.

### D.3 Query and transform engine

Pipeline: **TDS → validate → IR → row-predicate rewrite → cache lookup → compile → DuckDB → Arrow → render**.

- **IR** is a typed tree of steps with declared input and output columns. `where` is a typed predicate AST, not a string.
- **Row predicates** (P09) are applied to the IR before compilation. A Cedar `row` policy becomes a predicate conjoined to each source step. Panels, alerts, exports and `query.preview` see the same rows.
- **Cache key** is `sha256(canonical IR with resolved session parameters, source watermarks, principal's effective predicate hash)`. A watermark change invalidates exactly the affected keys. There is no TTL.
- **Streaming panels** do not re-run full queries per sample. The `query` worker keeps a windowed aggregate per live query and emits each window's delta as a sequenced event. Gap recovery replays from the last acknowledged sequence number or re-snapshots the window.
- **Anomaly transforms** are deterministic. Robust z-score uses the median and median absolute deviation over the window. The seasonal baseline uses the same statistic over the matching hour-of-week in the compacted store.

### D.4 Real-time transport

- The browser holds one WebSocket to `gateway`, authenticated with the bearer token used by the HTTP API. It subscribes to `ws:{workspace}`, `obj:{id}`, `q:{queryHash}` and `presence:{dashboard}`.
- Every event carries `{workspace, seq, kind, object_id, rev, payload}`. Clients apply events in `seq` order and request a snapshot on any gap.
- **Ordering rule.** `seq` is assigned while the transaction holds the workspace's `audit_chain` row lock (D.7), and the lock is held until commit. Within one workspace, commit order therefore equals `seq` order. The gateway reads `WHERE workspace_id = $1 AND seq > $cursor ORDER BY seq` and never sees a higher sequence before a lower one from the same workspace. The `NOTIFY` carries only `{workspace, seq}`; the payload is read from the row, so the 8 KB notify limit is not a concern.
- Presence is ephemeral. Sessions send cursor and focus at 10 Hz at most, throttled, and the server expires presence after 5 s without a heartbeat. The agent is a participant with a last-target marker, not a pointer.
- **Latency targets** (not measured results): commit to render on a second screen at p95 under 250 ms on localhost; under 400 ms through the AWS load balancer in the same region.

### D.5 Collaborative editing model

- Each dashboard has a head revision. A client's edit is a patch with `base_rev`.
- If `base_rev` equals the head, the patch applies. Otherwise the server runs a three-way merge at path granularity. The patch applies if its paths do not overlap paths changed since `base_rev`. Overlap is a conflict.
- A conflict returns `CONFLICT` with both values and a `rebase` suggestion. The UI shows a conflict card. The agent receives the same error and must re-read the object before retrying.
- The `panel_order` array has its own rule: concurrent inserts are merged by id, and a move of a panel that was deleted concurrently is a conflict.
- Two humans editing different panels never conflict. Two humans dragging the same panel produce one winner and one conflict card.
- Comment bodies (C01, supporting) use Yjs. Nothing on the demo path uses Yjs.

### D.6 Authorisation, grants, approvals and the commit rule

**Principals.** `user:*`, `group:*`, `service:*`, `agent:*`, `driver:*`, `screen:*`. For the demo, `agent:demo-ops` has read on `ops-demo` sources and dashboards, write on `ops-demo` dashboards, panels, queries, alerts and workflows, and no grant or policy rights. It has no write on any other workspace, and no read on `finance`. `screen:wall-left` and `screen:wall-right` have display scope on their panes and read on the dashboards they show.

**The commit rule, stated once.** Agents commit their own previews within their scope. Anything that changes privilege (a grant, a policy, a principal, a write to another workspace) is never committed by an agent. Such a change is either refused for the agent or held as a `grant_request` for a human approval. Humans commit privileges through the UI, with a fresh OIDC session of five minutes or less.

**Policy example** (the refusal at R10 cites the second rule):

```cedar
@id("agent-ops-demo-write")
permit (
  principal in Group::"agents",
  action in [Action::"dashboard.write", Action::"panel.write", Action::"alert.write", Action::"workflow.write"],
  resource in Workspace::"ops-demo"
) when { principal.scope_set.contains("ops-demo:write") };

@id("agent-no-cross-workspace")
forbid (
  principal in Group::"agents",
  action,
  resource in Workspace::"finance"
) unless { principal.scope_set.contains("finance:write") };
```

**Storage and hot-load.**

1. `acl.propose_grant` creates a `grant_request` in state `pending`. No policy changes.
2. A human approves through the UI. The server writes an `approval` row containing the approver's `sub`, the decision, the hash of the policy text that will be written, and a timestamp. It signs the canonical form with the platform key named by `key_id`.
3. The grant is written as a new `policy` version with status `pending`, referencing the approval.
4. The `policy` service verifies the signature against `signing_key`, checks that the referenced approval is `approve` and that the policy text hashes to the recorded `policy_hash`. Only then does it set the policy to `active`, emit `policy_load`, and hot-load the new policy set.
5. Decisions in flight keep the policy snapshot they started with. A failed verification leaves the previous set active and writes a refusal row.

**Keys.** Locally, the platform signing key is a file-mounted secret. On AWS it is an asymmetric signing key in KMS, with the algorithm fixed per deployment. Both are referenced by `key_id`. Rotation adds a new key with `valid_from`; old records still verify against their own `key_id`. The approver is identified by the OIDC `sub` of a fresh session. The signature attests that the platform recorded this approval for this policy text. It does not claim a hardware-held human key, and the design does not claim one.

**Screen authority.** `tessera.screen.present` requires display scope on the screen and read on the target dashboard for the screen principal, and write authority is never implied.

**Agent limits.** Agent principals may create `alert` and `workflow` objects in scope. They may not write `policy`, `grant_request` decisions, or `signing_key`.

### D.7 Audit chain, anchor and verification

- **Serialisation point.** A write, refusal, approval or scenario control runs in a transaction that first executes `SELECT head_seq, head_hash FROM audit_chain WHERE workspace_id = $1 FOR UPDATE`. The lock is held until commit. Inside the transaction, `seq` is taken from the sequence, the row is hashed with `prev_hash = head_hash`, and the head is updated. Refusals take the same lock, so a refusal is ordered like any other write.
- **Why this is not a hot row across workspaces.** Each workspace has its own lock. The demo has three workspaces. Contention exists only within one workspace, and at the demo's write rate that is not the bottleneck. This is a measurable property and it is listed in section G as a test to run when the rate is measured.
- **Reads** never take the lock and never write `change_event`. They are written to `call_log`, which has no chain. Tests assert that a read leaves `audit_chain` unchanged.
- **Global anchor.** An anchor job runs every 60 s or every 500 events in any workspace, whichever comes first. It takes the `audit_chain` locks in sorted `workspace_id` order (no deadlock), reads the heads, writes an `audit_anchor` row with the sorted heads, the digest, and a signature with `key_id`, then releases the locks. A single job holds an advisory lock so that only one anchor runs at a time.
- **Verify semantics.** `audit.verify` (a) walks each workspace chain from genesis, recomputing every hash and checking links and `chain_index` continuity, and (b) for each anchor, checks the signature, recomputes the digest from the stored heads, and checks that each workspace chain contains its anchored `head_hash` at `head_seq`. A break is reported with the first failing row and is shown as a visible alert in the console.
- **Undo** is a new revision whose patch is the stored inverse. History is never rewritten.

### D.8 MCP server design

The MCP server is a thin adapter over the same command handlers as the HTTP API. Tool input schemas are generated from the registry. Descriptions are written as contracts for a model: they name the failure modes and the rule for each argument.

Transport is Streamable HTTP at `/mcp`, and stdio through the `tessera-mcp-stdio` bridge.

#### One preview mechanism, one commit path

Every write verb returns a `preview_token`. No verb commits directly. `tessera.commit({preview_token, idempotency_key?})` is the only commit path, for every principal and every transport. The UI also goes preview-then-commit in one user action. There is no `dry_run` argument anywhere.

- A preview stores the exact operations, the base revisions, the validation result, the diff and a digest, and expires after 10 minutes. A preview is single use.
- `commit` re-validates against the current heads. If the base revisions still match, it commits the stored operations. Otherwise it returns `CONFLICT` with the changed paths, and nothing is written.
- **Agent principals** must commit with a `preview_token`. A write without one is refused with `VALIDATION_PREVIEW_REQUIRED`.
- **Idempotency.** `commit` takes an `idempotency_key`. If omitted, the server uses the preview digest. Retrying the same plan returns the first response. A repeated key with a different digest returns `IDEMPOTENCY_MISMATCH`.

#### Tool catalogue

Read tools (recorded in `call_log`; never chained):

- `tessera.session.whoami() → {principal, workspace, scopes[], tool_filter_version}`
- `tessera.catalog.search({query, kinds?, limit≤50}) → [{id, kind, name, title, score, why}]`
- `tessera.schema.describe({kind, version?}) → {schema, examples[], required_scopes, related_kinds[], units?}`
- `tessera.source.list({}) / tessera.source.describe({id}) → {columns[{name,type,nullable,masked?,unit?,description}], watermark, row_estimate}`
- `tessera.query.explain({ir}) → {plan_summary, scan_bytes_est, rows_est, warnings[]}`
- `tessera.query.preview({ir, limit≤500}) → {columns, rows, truncated, cache: hit|miss, watermark}`
- `tessera.lineage.trace({object_id, direction: up|down}) → {nodes[], edges[]}`
- `tessera.audit.query({since?, until?, actor?, object_id?, action?, limit≤1000}) → {events[], chain_ok}`
- `tessera.acl.explain({object_id, principal}) → {effective, policies[], missing_scopes[]}`
- `tessera.branch.diff({object_id, from, to}) → {changes[{path, before, after}], grouped_by_panel}`

Write verbs (each returns a preview; none commits):

- `tessera.dashboard.create({workspace, name, tds?, branch?})` creates the object from a document, or empty. It is the only creation verb for dashboards.
- `tessera.dashboard.apply({object_id, base_rev, ops:[{op, path, value}], branch?})` applies RFC 6902 operations to a dashboard document. This is the only verb for changing panels, layout, parameters, interactions and alerts inside a dashboard. Paths are `/panels/{id}`, `/panels/{id}/grid`, `/panel_order/-`, `/params/{name}` and so on.
- `tessera.query.define({workspace, name, ir, source})`
- `tessera.source.create({kind: stream|postgres|parquet|telemetry, config})` (config secrets are references)
- `tessera.annotate({target: {object_id, panel}|{object_id, time_range}, text})`
- `tessera.alert.create({workspace, name, query, when, for, fire})`
- `tessera.workflow.define({workspace, name, states[], transitions[], actions[]})`
- `tessera.branch.create({object_id, from_rev, name})` and `tessera.branch.merge({object_id, branch, base_rev})`
- `tessera.revision.revert({object_id, rev, base_rev})` creates a new revision from the stored inverse
- `tessera.acl.propose_grant({object_id, group|principal, role, reason})` creates a `grant_request`. There is no approve verb for agents.

Commit and presentation:

- `tessera.commit({preview_token, idempotency_key?})`
- `tessera.screen.present({screen_id, dashboard_id, params?})` moves a screen pane. It is the only presentation tool. It writes no revision. It sets the screen's session state, which is what `params` means here.
- `tessera.session.replay({session_id, target_workspace})` requires the `replay` scope, which a human grants to a driver principal. It is described in D.10.

Overlaps removed: `panel.create`, `panel.update`, `panel.delete` are gone (use `dashboard.apply`); `param.set` is gone (session state, D.12); `dry_run` is gone (preview); `workflow.trigger` is gone (alerts start workflows); the earlier `dashboard.create` versus `dashboard.apply` split is now create-from-document versus change-document.

#### Resources

- `tessera://schema/{kind}`: JSON Schema, examples and hints.
- `tessera://dashboards/{name}` and `tessera://dashboards/{name}/revisions/{rev}`: current document and a specific revision.
- `tessera://sources/{id}`: source description.
- `tessera://audit/recent?window=10m`: subscribable; updates as `notifications/resources/updated` after each chain row.
- `tessera://health` and `tessera://capabilities`: the machine-readable capability map (every kind, verb, scope and rate limit).

Prompts: `build-ops-board` and `explain-spike` are short recipes that name tools. They contain no data.

#### Discovery

An agent learns the platform through three routes: `tools/list` (contract-style descriptions, filtered by scope), `tessera.schema.describe` (JSON Schema with `x-tessera-hint` per property and units), and `tessera.catalog.search`. Tool filtering matters: an agent without approval rights is not shown an approve tool, so it cannot invent one.

#### Errors designed for self-correction

```json
{
  "error": {
    "code": "VALIDATION_UNKNOWN_FIELD",
    "message": "Panel 'p95_trend' has no field 'p95'.",
    "path": "/panels/p95_trend/y/0",
    "received": "p95",
    "valid_values": ["p95_ms", "window_start"],
    "suggestion": "Use 'p95_ms'. It is the output column of query 'p95'.",
    "retryable": true,
    "docs": "tessera://schema/panel#y"
  }
}
```

Closed set of codes: `VALIDATION_*`, `VALIDATION_PREVIEW_REQUIRED`, `REF_NOT_FOUND`, `CONFLICT`, `AUTHZ_SCOPE`, `AUTHZ_POLICY`, `HELD_FOR_APPROVAL`, `RATE_LIMITED`, `IDEMPOTENCY_MISMATCH`, `PREVIEW_EXPIRED`, `SOURCE_UNAVAILABLE`, `QUERY_TOO_LARGE`. `valid_values` is computed from the registry. Authorisation is evaluated before reference resolution for workspace-level targets, so a denial does not depend on whether the target exists in the current workspace.

#### Rate limits

Token bucket per principal: 20 commits per second, burst 40; 10 concurrent queries; 200 read calls per minute sustained. `screen.present` is limited to one call per screen per 10 s, and six calls per minute per principal. `RATE_LIMITED` returns `retry_after_ms`. Agent limits are lower than human limits by configuration.

#### Prompt injection and data trust

- Query results, audit rows, titles and comments are returned in a `data` envelope with `"trust": "untrusted_data"`.
- Write paths are constrained by scope and by policy, not by the model's judgement. A convincing instruction in a comment cannot grant a permission, because grants need a human approval and a signed policy.
- Tool descriptions are static and versioned.
- Secrets are references. The agent can name a secret and cannot read it.
- Every call is in `call_log` with its arguments digest and response hash, so an injected action is attributable.

### D.9 Fallback driver: per-step satisfaction, reconciliation and budget

The fallback replaces the earlier hash-equality guard. Equality of a whole-workspace hash fails on any valid partial progress, so it is not the right test.

**Row model.** Each row is a list of steps. Each step has a satisfaction predicate over canonical state, or an expected call name with argument shape. Examples: "dashboard `investigation` exists on branch `investigation` with panels `carrier_bar`, `latency_overlay` and `slow_orders`"; "a `read` call to `lineage.trace` with `object_id` `panel_p95` returned"; "`alert.eu_p95` state is `firing` or `pending`". A row is complete when all its predicates hold.

**Take-over.** The driver watches the trace ribbon. A stall is an unmet predicate with no call in flight for 8 s, or a call in flight for longer than 8 s. The take-over happens at the next step boundary. The 8 s grace is shorter than every row budget, so the driver never waits out a whole row.

**Resume, not restart.** At take-over, the driver evaluates the predicates of the current row in order. Satisfied steps are skipped. Unsatisfied steps are issued from the transcript, with name rebinding applied. A partly progressed row resumes where it stopped.

**Reconciliation.** If a checkpointed object has diverged from its checkpoint (for example, the live agent created a panel with another name), the driver reverts only the live agent's own revisions since the last checkpoint. It builds the inverse patches, previews them, and commits them as new revisions with actor `driver:demo` acting under the agent's scope. Human revisions in that span are not reverted. If one exists, the driver stops and shows a reset prompt on screen P, because there is no safe automatic answer.

**Slack pool.** The script has a 30 s slack pool. Each take-over is charged its 8 s grace, and the pool remaining is printed on screen P after every row. When the pool is exhausted, the driver runs the remaining rows and screen P says so.

**Checkpoint binding.** A checkpoint is `{name → {object_id, rev, doc_hash}}` for every named object, plus the simulator fields of D.11 and the rebinding table `{name → object_id}` in effect when it was taken. Comparisons are by name. Identifiers are never compared directly, because a live run and a replay produce different identifiers.

**Read rows.** A read row's satisfaction is that its expected calls returned with the expected argument shape. There is no commit to watch, so the call-name predicate is the stall detector.

### D.10 Replay by MCP re-issue

`tessera.session.replay` replays an audited session into a blank workspace by re-issuing the recorded calls, not the stored patches.

1. Read the session's `call_log` rows in order, with their arguments, statuses and response hashes, and the checkpoints recorded for the session.
2. Create `target_workspace` as empty.
3. For each recorded call, rewrite its arguments through the rebinding table, so that a recorded object id becomes the id created by this replay. Issue the call as `driver:replay`, scoped to the intersection of the original agent's scopes and the target's scopes at replay time.
4. **Policy is re-run for every call.** Calls that change privilege (`acl.propose_grant` followed by its approval, policy writes, principal writes, writes to another workspace) are not executed. The approval step is held (`HELD_FOR_APPROVAL`). The grant is not re-granted. Events of kinds `grant_approve`, `policy_load` and `principal_*` are never replayed.
5. Each response is canonicalised with ids replaced by names and hashed. The hash is compared with the recorded `response_hash`. The first mismatch stops the replay and names the object and field.
6. At each recorded checkpoint, the replay compares named document hashes and revisions, and the simulator fields against the recorded values. It does not compare panel results or alert state.
7. Replay never writes to the source workspace.

The refusal at R10 is reproduced because authorisation precedes reference resolution, and the policy denies the call in the target workspace in the same way.

The stored-patch view (M09) is a separate screen: it applies the stored revision patches of the same session in order and reports the same checkpoints. It is labelled "stored patches" on screen, and it is explained as a different claim: it shows what the platform stored, not what the agent called.

The counter on screen W reports four separate numbers: calls re-issued, response hashes matched, refusals reproduced, and privilege steps held. It also reports checkpoints verified against the eight recorded checkpoints.

### D.11 Simulator determinism

- The generator is PCG64 (XSL-RR 128/64) implemented in TypeScript with BigInt. The seed is in the scenario file.
- The Node release is pinned to one 22.x patch version in `.nvmrc` and in the image's base tag. The same pin is used by every service.
- A golden vector test asserts the first 10,000 outputs for the committed seed. Local and AWS images run the same test.
- The simulator's state for a checkpoint is its PRNG counter, its consumer offsets per partition, and the last scenario control event in the checkpoint. These are written to `sim_checkpoint`.
- Scenario controls (`I`, `R`) are not MCP calls. They are a console transport: the console writes a `scenario_control` row through the chain (D.7), with actor `user:presenter`, and the simulator consumes it from `scenario.control`. A control is therefore visible in the audit log and in every checkpoint that follows it.

### D.12 Session state: parameters, brushing, drill and screens

Parameters are session state. They are not documents and not revisions.

- A session holds a map of parameter values for each dashboard it displays. The map is serialised into the URL (for example `?region=eu&carrier=dhl`) and into the screen's session record for screen principals.
- Brushing, drill-down and `screen.present` `params` all write to that map. None creates a revision, a chain row or a call-log row. The trace ribbon shows them in a distinct style, marked as session state.
- Queries bound to a parameter include its resolved value in the IR, so the cache key changes exactly when the value does (D.3).
- Drill-down is a typed link: a target object and a parameter mapping. It navigates to a view of an object that already exists. An order-trace panel is therefore part of the investigation dashboard from R6, hidden until its parameter is set.
- Only changes to shared documents are revisions. The distinction is stated on the wall and in the ribbon so the audience can see it.

---

## E. AWS and local deployment

### Principle

The same OCI images run in both places. Configuration selects the substrate (Postgres endpoint, Kafka brokers and auth, object-store endpoint, OIDC issuer, signing key reference). Application code does not branch on environment. A suite run against both checks that.

### Images

Eight images from one repository, multi-stage Dockerfiles on one pinned Node 22 base: `tessera-web` (static assets served by `api`), `tessera-api`, `tessera-mcp`, `tessera-gateway`, `tessera-query`, `tessera-ingest`, `tessera-sim` and `tessera-driver`. Images are immutable and tagged with the commit and a content digest. There is no runtime package installation. `tessera-sim` and `tessera-driver` are deployed to the demo environment only.

### Mapping

| Concern | AWS | Local (`docker compose up`) | What differs; why behaviour is unchanged |
|---|---|---|---|
| Compute | ECS on Fargate, one service per image | Compose services, same images | Scaling differs, not semantics |
| Metadata, revisions, audit | RDS for PostgreSQL 16, Multi-AZ | Postgres 16 container | Same schema, triggers and RLS |
| Streams | MSK with IAM SASL | Redpanda, unauthenticated, single node | Same Kafka protocol; parity test checks offsets and ordering |
| Object store | S3 | MinIO | Same SDK and paths |
| Identity | Cognito user pool (OIDC) with agent client credentials | Dex (OIDC) with static users | Same JWT claim layout; scope claim mapped by config |
| Signing key | KMS asymmetric signing key | File-mounted secret | Same `key_id` reference; same verification code |
| Secrets | Secrets Manager | Compose secrets | Same `secret://` resolution |
| Ingress and TLS | ALB with ACM; WebSocket and Streamable HTTP | Caddy with a local CA | Same routes: `/`, `/api`, `/mcp`, `/ws` |
| Telemetry | CloudWatch via OTel collector | OTel collector to Grafana Tempo and Loki | Same OTLP export |
| Infrastructure as code | AWS CDK in TypeScript | Compose file generated from the same service list | A test diffs the two |
| Reset | EventBridge Scheduler to an ECS task (not on the demo path) | `make demo-reset` | Same reset command |

### What is intentionally different

- **Kafka auth.** MSK requires IAM SASL; Redpanda does not. The ingest SASL configuration comes from environment. The parity test asserts identical offsets and ordering.
- **Identity provider.** Dex and Cognito produce different issuers and registrations. Both produce a JWT with the same claim layout, which is the only contract the platform reads. Approval freshness (five minutes) is checked from the token's `auth_time`.
- **Signing key.** KMS and a file-mounted key differ in custody. Verification code and records are identical.
- **Scale.** Task counts differ. The demo runs one task per service on AWS and one container per service locally.

Differences are recorded in `docs/parity.md`, and each row names the test that exercises it.

### How the MCP server is exposed

- Streamable HTTP at `https://{host}/mcp`. Locally through Caddy. On AWS behind the ALB, same path.
- Bearer tokens in the `Authorization` header: OAuth 2.1 access tokens issued by the same OIDC issuer as the UI. The agent uses the client-credentials grant with the `agent:demo-ops` client. Scopes come from the token's `scope` claim. The server validates signature, issuer, audience (`tessera-mcp`), expiry and revocation. Write calls check the revocation list per request.
- Stdio via `tessera-mcp-stdio` on the presenter's machine. It reads the token from the OS keychain, holds no state and does no authorisation.
- Every MCP session has an id. `call_log` and `change_event` rows record the transport and session id, so the ribbon and replay key on it.

---

## F. Five technical claims and one pre-registered evaluation

Each claim has an executable test or an observable behaviour. Quantities are targets unless labelled.

**Claim 1 — The agent path and the human path are the same commit path.**
*Statement:* any mutation made through MCP produces the same `revision`, `change_event` and realtime event shape as the same mutation made through the UI or HTTP API, differing only in `actor` and `transport`. No document write exists without a revision row in its transaction.
*Test:* a property-based test generates random valid dashboard operations (1000 cases, fixed seed), previews and commits each through `ui`, `http` and `mcp` transports in three fresh workspaces, and asserts that canonical documents, patches and event payloads are equal after removing `transport` and `actor`. A separate scan asserts that no `object.doc` update lacks a same-transaction revision. Failure prints the minimal operation sequence.

**Claim 2 — A scoped agent cannot exceed its scope; every refusal is explained and chained.**
*Statement:* `agent:demo-ops` cannot write to `finance`, cannot see an approve verb in `tools/list`, cannot commit a write without a preview token, and cannot approve its own grant. Each attempt yields a structured error naming the policy id, and a refusal row in the workspace chain. `screen.present` to a dashboard the screen cannot read is refused.
*Test:* an integration test authenticates as `agent:demo-ops` and asserts: absence of approve verbs in `tools/list`; `AUTHZ_SCOPE` with policy id on a `finance` write; `VALIDATION_PREVIEW_REQUIRED` on a commit-less write; `HELD_FOR_APPROVAL` on a self-grant; `AUTHZ_POLICY` on a screen presentation without read. It then asserts two refusal rows and a passing `audit.verify`.

**Claim 3 — Preview is exact: the commit is the preview.**
*Statement:* for any preview that commits, the committed revision's patch equals the preview's stored operations, and a preview whose base revision moved returns `CONFLICT` without modifying the object.
*Test:* 200 previews, with concurrent writes from a second principal interleaved in 50 of them. Assert that committed patches equal previewed operations, and that the 50 interleaved previews return `CONFLICT` and leave `object.doc` and `head_rev` unchanged, checked by hash. Runs in the integration suite against Postgres.

**Claim 4 — Live state reaches every screen in bounded time, in order, with gap recovery.**
*Statement:* a commit made through MCP appears in a second authenticated browser session within the target latency. Within a workspace, events reach a client in `seq` order, with no duplicates and no skips after recovery.
*Test (a):* a browser test with two contexts and one agent client makes 300 commits and records the time from the commit response to the DOM update in the second context. It reports p50, p95 and p99. Target locally: p95 under 250 ms.
*Test (b):* two transactions in one workspace are run with the second's `seq` assigned first, as a concurrency test; the reader asserts it never observes the higher sequence before the lower one. The lock in D.7 makes the second transaction block until the first commits, and the test asserts that blocking.
*Test (c):* the WebSocket is dropped for 5 s during 40 commits. The final DOM hash equals the server's canonical hash, and no sequence number is applied twice.

**Claim 5 — Replay re-issues an agent session, checks every response, and cannot reconstitute a privilege.**
*Statement:* replaying a recorded session into a blank workspace re-issues each recorded call and matches each response hash after name rebinding. At each of the eight checkpoints, named document hashes, revisions, and simulator fields match the recorded values. Replay of a session containing an approved grant yields a target in which the grant is not applied. The claim hashes documents, revisions, grant and approval records, and simulator control and PRNG fields. It does not hash panel results or alert state, which depend on the live feed.
*Test:* a rehearsal runs the full transcript against a seeded local stack, records responses and checkpoints, runs `make demo-reset`, replays with checkpoint verification, and asserts all matches. It fails on the first mismatch and names the object and field. A second test replays an approved session and asserts that the target has no approved policy and that the privilege step is reported as held. The same script runs against the demo environment on AWS.

**Evaluation E1 — Unaided agent produces the ops-board sequence (pre-registered).**
*Why:* the five claims test the platform. This one tests the MCP surface a general model is given. Without it, the script assumes the calls.
*Registration.* Before the first run, the harness, prompts, tool list snapshot, pass criterion and run count are written to a file in the repository and committed. Changes after registration are logged as a new registration.
*Setup.* A fresh `ops-demo` workspace seeded by reset. The agent receives only the MCP server's tool list and the first prompt of R1. No hints, no recipe prompt, no additional context. Sampling settings are the client's defaults.
*Runs.* Ten runs, each from a fresh reset.
*Pass criterion.* At least 8 of 10 runs end with a committed dashboard containing at least three panels bound to queries over `src_fulfilment_stream`, with zero commits that lacked a preview token, and with at most two validation or authorisation errors per run, each followed by a correct retry. Runs that fail record the first wrong call and its error code. The result is reported with its raw counts.

---

## G. Failure analysis

### Implementation difficulties

- **Chain serialisation.** The lock in D.7 is the single point of contention per workspace. It is a known cost, and the demo does not measure it until the rate is measured. The mitigation is one lock per workspace, the global anchor, and reads kept off the chain.
- **Three-way merge of panel order.** Panels are a map keyed by id, and order is a separate array with its own rule. Two merge paths must be tested, and the second is the one that breaks on concurrent moves.
- **Streaming windows with gap recovery.** A window aggregate and its sequence must be checkpointed together. A bug shows as a subtly wrong panel, not as an error. Mitigation: a golden test per aggregate that compares the streamed window with a full recompute at fixed intervals.
- **Row-predicate injection** must cover every path, including anomaly transforms that read a joined reference table. The compiler refuses an IR whose source steps are not all wrapped, and a test enumerates every source kind.
- **Cedar in Node** through WASM adds a startup cost and a serialisation boundary per decision. The per-decision cost is unmeasured and is a measurement target for the build.
- **Policy hot-load** must not change decisions in flight. The snapshot rule in D.6 is tested by a load test that swaps a policy during a burst of previews.
- **Replay across schema versions.** Patches recorded on schema v1 must replay on v2. Upcasters are required for each kind change, and schema changes are additive during the demo's lifetime.

### Agent failure modes

- **Wrong tool call.** The likeliest is querying the wrong source. Tool descriptions name the source-selection rule, `catalog.search` returns `why`, and the first prompt names the source. The rate of a wrong first source is recorded in rehearsal, not claimed here.
- **Hallucinated fields.** Closed validation rejects unknown keys and returns `valid_values`. The expected recovery is one retry. The retry count is recorded per model in rehearsal.
- **Hallucinations that pass validation.** A real field with the wrong meaning is the more serious case. `schema.describe` carries units and descriptions, and the investigation names a computed metric (`p95_ms`, D08).
- **Preview-skipping.** Refused by the platform (`VALIDATION_PREVIEW_REQUIRED`), so an agent cannot skip preview for writes. It can still choose a wrong preview, which is visible in the diff before commit.
- **Retries after a dropped response.** Commits are keyed by the preview digest by default. A retried commit returns the first response.
- **Plausible but wrong finding.** The agent may attribute the spike to the wrong cause. The config event is in the stream with its timestamp, and the carrier breakdown is one query. A wrong attribution is visible on the chart, and the presenter can correct it with one prompt, which is an annotation.
- **Fallback.** The transcript is a list of calls with per-step predicates. It is valid for any wording. The driver checks state, so it does not lose its place.

### Demo-level failure modes

| Failure | Symptom | Mitigation |
|---|---|---|
| Model slow | Ribbon shows a pending call | After 8 s with nothing in flight, or a call in flight past 8 s, the driver takes over at the next step boundary, charged to the 30 s slack pool |
| Model calls a wrong tool | Refusal or validation error | The error is the designed self-correction path; it is shown |
| Model issues a privilege change | `HELD_FOR_APPROVAL` | The approval is a deliberate human action at R9 |
| Stream stalls | Stat tiles show a "stale" badge | Badge is driven by watermark age; staleness is not hidden |
| Gateway drops | Screens show "reconnecting" | Gap recovery re-syncs (claim 4c) |
| Wall browser crashes | Pane goes blank | Kiosk watchdog reloads the pane's dashboard by name; state is server-side, and the pane's session parameters are in the URL |
| Rate limit hit | `RATE_LIMITED` in the ribbon | Limits are set above script need; `retry_after_ms` is shown |
| Reset incomplete | Old state visible | `make demo-reset` is idempotent and prints C0; the console refuses to start until C0 matches |
| Presenter key presses are misfired | Unwanted degradation | Keys I and R are confirmed by a second key within the row, and both are recorded as controls |
| Driver reconciliation hits a human revision | Reset prompt | The driver stops; the presenter resets with `make demo-reset` |

### Known limitations accepted

- The degradation trigger is a human key. The causal chain after it is the simulator's own event stream, but its timing is not promised, and the script does not claim it.
- Replay does not reproduce the agent's reasoning. It reproduces the calls and their responses.
- The approval signature attests that the platform recorded a human's approval in a fresh session. It is not a hardware-bound human key.
- Stored-patch replay (M09) is a second view with a different claim. It is not the proof of composition.

---

## H. Feasibility

### Scope by component

Feasibility is expressed by what each component touches and by its dependencies.

| Component | What it touches | Depends on | Demo-critical |
|---|---|---|---|
| Object registry and TDS validator | JSON Schema generation, kind definitions, name and reference resolution | none | Yes |
| Revision store, chain, preview and idempotency | Postgres schema, triggers, workspace locks, anchor job | registry | Yes |
| Cedar policy, grants, approvals, signing keys | WASM binding, policy table, hot-load snapshot, key registry | registry, revision store | Yes |
| Query IR, compiler, DuckDB, row predicates | IR types, SQL generation, Arrow results, cache keys | registry, policy | Yes |
| Stream ingest and simulator | Kafka consumer, watermarks, PCG64 with golden vector, control events | none (parallel) | Yes |
| Gateway and realtime | WebSocket, LISTEN/NOTIFY, ordering rule, gap recovery | revision store | Yes |
| HTTP API | Fastify routes from the registry | registry, revision store | Supporting for UI |
| MCP server | Tool generation, scope filtering, error shape, preview tokens, call log | registry, command handlers | Yes |
| Web panes and editor | React, uPlot, SVG components, cross-filter, drill, ribbon, ghost overlay | gateway, query preview | Yes |
| Workflows and alerts | State machine, guards, webhook actions, recovery notices | revision store, query, ingest | Yes |
| Branching, diff, merge, revert | Branch chains, diff, inverse patches | revision store | Yes |
| Replay and driver | MCP re-issue, rebinding, reconciliation, slack pool, stored-patch view | call log, MCP, revision store | Yes |
| Deployment | Images, service list, parity tests | all services | Yes (local first) |
| Comments (Yjs), embedding | Yjs, signed tokens | gateway | No |

### Critical dependencies

- **Cedar WASM in Node 22.** If it does not perform as needed, the fallback is a small in-house evaluator with a reduced policy language. That is a scope change, not a block.
- **DuckDB node bindings** must support Arrow output and Postgres attachment in the pinned version.
- **KMS signing algorithm** must be chosen to match the verifier on the platform. It is fixed per deployment and tested in the parity suite.
- **MCP SDK Streamable HTTP and OAuth 2.1 bearer validation** in the chosen SDK version. The stdio bridge is independent.
- **Model behaviour** is external. E1 measures it before the script relies on it, and the driver covers the rest.

### Main risks

1. **Replay fidelity.** A write path that bypasses the revision store would make replay lie. Mitigated by the trigger and by the scan in claim 1.
2. **Tool-design quality.** A capable model may stumble on the IR. Mitigated by `query.explain`, `valid_values`, `schema.describe` units, and E1.
3. **Ordering under concurrency.** Mitigated by the workspace lock and the out-of-order test in claim 4b.
4. **Cross-environment parity.** Mitigated by running the same rehearsal against both.
5. **Visual scope creep.** Animations exist only where an event or gesture drives them. Others are cut.

### Dependency-ordered build sequence

Each step produces something testable that the next step uses. Steps 1–3 are the minimal vertical slice.

1. Object registry and TDS for one dashboard, one source, one query, one timeseries panel. Output: validated documents rendered from a fixed source.
2. Revision store, chain, preview and commit with `ui` and `http` transports. Output: an edit commits a revision, a chain row and an event, and a second session sees it.
3. Stream ingest from `fulfilment-sim` into the analytic store, with the PCG64 golden vector. Output: the timeseries shows live data. This is the slice a stage would accept.
4. MCP read tools and `session.whoami`, `catalog.search`, `query.preview`, with `call_log`. Output: an agent can inspect the platform.
5. MCP write verbs with preview, commit, idempotency and the error shape. Output: an agent builds the board in R1–R2.
6. Cedar principals, scopes, grants, approvals, signing and hot-load. Output: R8–R10 work.
7. Session parameters, cross-filter, drill, presence and screen panes. Output: the human side of R3, R6 and R7.
8. Anomaly transform, alert rule, workflow state machine, webhook and recovery notices. Output: the incident path and the page.
9. Branching, diff, merge and revert. Output: R6 and R8.
10. Replay by re-issue, the fallback driver, satisfaction predicates and reconciliation. Output: R13 and the failure guard.
11. Multiple workspaces (`ops-demo`, `finance`, `blank-2`) and row predicates. Output: the cross-workspace refusal is real.
12. Compose deployment with the same images; CDK for AWS; the parity suite against both.
13. Supporting capabilities (comments, exports, scheduled reports, embedding), each as a kind on the same registry with generated tools. Their absence does not affect the script.

Steps 1–3 are the only places where the platform must be correct before anything else can be exercised. Steps 4–9 share the registry and the revision store and can proceed in parallel lanes (MCP, realtime and UI, authorisation, workflows). The stage path depends on steps 1–12. Step 13 is the breadth the brief asks for, added as data-driven kinds, so its marginal work is the kind definition plus its tools.

---

## Closing note

The spectacle here is the platform's own event stream made visible. Panels appear because commits happen, numbers move because samples arrive, and the agent's trace is the same log an auditor would read. The revised design removes what could not be shown honestly: the parameter writes that polluted history, the timers that stood in for measurements, the WebGL and third charting stack, the hash guard that refused valid progress, and the replay that copied privileges. What remains is smaller and can be checked: one preview path, one commit path, one chain per workspace, and a replay that matches every response it re-issues.

Word count (estimate): about 9,500 words.
