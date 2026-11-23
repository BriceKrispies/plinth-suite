# Competitor 02 — Visual Spectacle

**Product title: Tessera**
*A composable operations canvas where humans and an MCP-connected agent build live, shared dashboards out of the same primitives.*

**Pitch.** Tessera is an enterprise operations platform whose every panel, query, alert, workflow and permission is a typed, addressable object that the web UI, the HTTP API and an MCP server all manipulate identically. On a shared wall in five minutes, an agent turns a live order stream into an investigation board, shares it under an approval gate, refuses one out-of-scope write, and replays its own audited session onto a blank workspace, while every change lands on every connected screen as it happens.

---

## Design mandate and how this proposal reads it

The mandate is visual spectacle: panels materialising as the agent works, live streams, cross-filtering, drill-down and several screens reacting at once. I treat spectacle as a consequence of composition, not as decoration. Every animation in this design is driven by a real change event with a sequence number. Nothing animates on a timer that is not tied to a server commit, a stream sample or a user gesture. That constraint is what keeps the spectacle honest for an audience of engineers, and it is also what makes the demo reproducible.

Quantities in this document are labelled. No prototype exists yet, so nothing here is measured. Every figure is either a **target**, a budget the implementation must meet and that the tests in section F enforce, or an **estimate** of scale derived from the scenario's configured rates.

---

## A. Product concept

### What the platform is

Tessera is a multi-tenant dashboard and operations platform. It has four kinds of user-facing object and one kind of mechanism:

- **Sources** describe where data comes from (a stream, a Postgres table, Parquet files, or the platform's own telemetry).
- **Queries** are named, typed pipelines over sources. They are stored as an intermediate representation (IR), not as SQL text.
- **Panels** render a query result as a visualisation, a stat, a table, a heatmap or a text block.
- **Dashboards** arrange panels on a grid, declare parameters, and wire interactions (cross-filter, drill-down) between them.
- **Mechanism:** every object above, plus alerts, workflows, grants, annotations and comments, is a typed document in one schema registry. Every change to any of them is a revision, and every revision is a row in one hash-chained audit log.

The platform has no built-in intelligence. The "intelligence" a viewer sees is an external MCP client (Claude Code in the demo) calling the same tools a human reaches through the UI.

### Who uses it

- **Operations engineers** watch wall boards and act on alerts through workflows.
- **Analysts and product owners** compose investigations, branch dashboards to test a question, and share read-only views.
- **Platform and security staff** define sources, row-level policies and grants, and review the audit trail.
- **Agents** (external MCP clients) act under a scoped principal. They are first-class users of the same objects, with no private API.

### What data the demo is about, and where it comes from

The demo domain is an order-fulfilment network. It is not a paid external service and it is not a file of pre-cooked numbers. It is a real running process:

- **Fulfilment simulator (`fulfilment-sim`).** A TypeScript service that generates orders, routes them to fulfilment centres in three regions (eu, us, apac), calls simulated carrier integrations, and emits events to a Kafka-compatible topic (`fulfilment.events`, `carrier.status`). It uses a seeded PRNG (PCG64, seed committed in the scenario file), so the same seed and the same reset produce the same order stream, the same carrier timings and the same incident timing relative to reset.
- **Scenario incident.** The scenario file declares a carrier degradation in the eu region: a timeout change on one carrier integration raises its latency distribution and its retry rate. The presenter triggers it with one keystroke, which writes a control message to `scenario.control`. The degradation then appears in the emitted events; no dashboard is told about it directly.
- **Platform self-telemetry.** The platform's own audit log, query log and job queue are exposed as sources. This makes "what changed in the last hour?" answerable about the platform itself, using the same query engine.
- **Reproduction.** `make demo-reset` truncates the workspace, reseeds the simulator, restores the sample dashboards and resets the stream offsets. Two resets with the same seed produce byte-identical canonical event streams for the first 600 s of simulated time (this is a test, section F).

Volumes (estimates from the scenario's configured rates, not measured): the simulator is configured for about 180 events per second at its default scale, which is about 15.5 million events per simulated day before compaction. The actual rate is measured in step 3 of the build sequence and the scenario is retuned to hold the target rate on a laptop-class machine.

---

## B. Capability inventory

Capabilities are grouped by layer. "Demonstrated" means it is shown in the five-minute script. "Supporting" means it is real and tested but is shown only as a side effect or in the reference view. Every row composes with the core: it is addressable through UI, HTTP and MCP, it shares the schema registry, the authorisation model, the audit log, the realtime channel and the revision store.

| ID | Primitive / capability | Status | Technical significance | Composes with |
|---|---|---|---|---|
| P01 | Typed object registry (JSON Schema per kind, versioned) | Demonstrated | One validation and type system for every object; generates the HTTP schema, the MCP tool schemas and the UI forms | Everything |
| P02 | Revision store with JSON-Patch deltas and base-revision checks | Demonstrated | Every write is a patch against a known revision; enables optimistic concurrency, diff, undo and branching | P03, P07, P12 |
| P03 | Hash-chained change log (audit) | Demonstrated | Append-only, tamper-evident record of every change by every principal, including refusals | P02, P05, P19 |
| P04 | Realtime subscription channel (per object, per query, per workspace) | Demonstrated | Sequence-numbered fan-out; the same channel drives panels, presence and the agent trace | P02, P06, P13 |
| P05 | Authorisation engine (Cedar policies over principals, groups, objects) | Demonstrated | One decision point for UI, API and MCP; returns explanations usable by `acl.explain` | P08, P09, P14 |
| P06 | Presence and remote cursors | Demonstrated | Ephemeral awareness state (who is on which dashboard, where the cursor is); the agent appears as a participant | P04, P18 |
| P07 | Branches of a dashboard, with diff and merge | Demonstrated | Agent works on a branch; humans review a diff and merge to the live board | P02, P12 |
| P08 | Principals: human, group, service, agent (scoped) | Demonstrated | Agent is a principal with explicit scopes, not a superuser token | P05, P03 |
| P09 | Row-level security predicates injected into queries | Demonstrated | A policy becomes a predicate in the query IR, so the same rule applies to panels, exports and alerts | P05, D05 |
| P10 | Column masking | Supporting | Masked columns are typed in the IR; tables and exports show `***` and the audit records the mask | P09, D05 |
| P11 | Undo and rollback as new revisions | Demonstrated | Revert is itself a revision (dry-run first); history is never rewritten | P02, P03 |
| P12 | Templates instantiated from a revision | Supporting | Copy-on-write from a revision; the template keeps its lineage | P02, P07 |
| D01 | Stream source (Kafka protocol; Redpanda local, MSK on AWS) | Demonstrated | Live feed for panels; consumer offsets are part of the source's state | D05, D08 |
| D02 | Relational source (Postgres) | Supporting | Reference data (carriers, centres, SLAs), with incremental refresh | D05, D10 |
| D03 | Object-store source (Parquet on S3 or MinIO) | Supporting | Historical compacted data read by the analytic worker | D05, D10 |
| D04 | Platform telemetry source (audit, query log, job queue) | Demonstrated | "What changed in the last hour?" is a query over the audit log, not a special feature | D05, P03 |
| D05 | Query IR (typed pipeline: source, where, window, aggregate, join, transform) | Demonstrated | The single query representation; compiled to DuckDB SQL; the basis of every panel, alert and export | P09, D06, D10 |
| D06 | Transform steps: filter, project, derive, group, window, join, topN, pivot | Demonstrated | Composable steps with typed inputs and outputs; each step's output schema is computed at validation time | D05, D07 |
| D07 | Anomaly detection (robust z-score and seasonal baseline) | Demonstrated | Deterministic statistical transforms; output is a boolean column usable by alerts and annotations | D06, V06 |
| D08 | Computed metrics (named expressions over IR columns) | Demonstrated | A semantic layer: "p95 latency" defined once, used in panels, alerts and exports | D05, V01 |
| D09 | Parameters (typed variables, including time ranges and enums) | Demonstrated | Dashboard-scoped inputs; cross-filter and drill-down write parameters | V02, V03 |
| D10 | Result cache keyed by IR hash and source watermark | Supporting | Identical queries from many panels cost one execution; invalidation is exact, not time-based | D05, D01 |
| D11 | Lineage graph (source → query → panel → dashboard → alert → workflow) | Demonstrated | Answers "what breaks if this source changes" and feeds `lineage.trace` | P02, D05, A01 |
| D12 | Explain plan and cost preview for an IR | Supporting | Cost is a row-count and scan-bytes estimate from DuckDB's plan; used by the agent before committing a heavy query | D05, M04 |
| V01 | Panel types: timeseries, stat, table, bar, heatmap, histogram, text | Demonstrated | Each panel is a pure function of a query result and a spec; the renderer is replaceable | D08, V02 |
| V02 | Cross-filter brushing | Demonstrated | A selection in one panel writes a parameter; every panel bound to it re-queries | D09, D05 |
| V03 | Drill-down links (click a bar, open a trace panel or a new dashboard with parameters) | Demonstrated | Links are typed: target object, parameter mapping, and the new object is created as a revision | D09, P02 |
| V04 | Grid layout with responsive breakpoints | Supporting | Layout is part of the dashboard document; drag operations are patches | P02, V01 |
| V05 | Annotations anchored to time ranges or points | Demonstrated | Agent and humans annotate charts; annotations are objects with their own revisions and audit | P02, V01 |
| V06 | Thresholds and alert rules | Demonstrated | A rule is a query plus a condition plus a target; it fires into a workflow | D05, A01, A02 |
| V07 | Live animation tied to revisions and samples | Demonstrated | Panels animate on sequence-numbered events only; there are no timer-driven fake updates | P04 |
| A01 | Workflows as state machines (states, guards, actions, timers) | Demonstrated | Deterministic transitions with observable state and history; actions are HTTP calls or platform commands | P03, V06 |
| A02 | Alert-to-workflow triggers | Demonstrated | Alert state changes are events that start or advance workflows | V06, A01 |
| A03 | Forms that write back (typed fields validated against the target schema) | Supporting | A form is a panel whose submit creates a revision or an event; the same validator the API uses | P01, A01 |
| A04 | Scheduled reports (render-to-snapshot, delivered to a webhook or file) | Supporting | Scheduled jobs run queries under the owner's scope and record the watermark used | D05, P05 |
| A05 | Export (CSV, Parquet, PNG snapshot of a panel) | Supporting | Same IR, same row filters, so an export matches what is on screen | D05, P09 |
| C01 | Comment threads anchored to panels or time ranges | Supporting | Threads are objects; agent replies are attributed | P04, V05 |
| C02 | Sharing links and read-only grants | Supporting | Grants are Cedar policies; links are tokens bound to an object and a scope | P05, P08 |
| C03 | Embedding (signed, scoped iframe tokens) | Supporting | Embedded views use the same authorisation path; no separate embed permission model | P05, V01 |
| M01 | Multi-tenancy by workspace | Supporting | Workspace is a row-level partition key everywhere; cross-workspace queries are impossible by construction | P09, P05 |
| M02 | Schema-generated HTTP API (OpenAPI from P01) | Supporting | The HTTP API cannot drift from the object model | P01 |
| M03 | MCP server (Streamable HTTP and stdio bridge) | Demonstrated | Tools, resources and prompts generated from the same object definitions; the agent's entire surface | P01, P05, P03 |
| M04 | Preview and commit protocol (dry-run, preview tokens, idempotency keys) | Demonstrated | Every mutating call can be previewed; commits reference a preview token | P02, M03 |
| M05 | Presentation control (`dashboard.present`, wall and screen targets) | Demonstrated | The agent can move a named screen to a dashboard; screens are principals with a display scope | P04, P06 |
| M06 | Deterministic replay of an audited session | Demonstrated | Re-applies stored patches to a blank workspace in sequence, with checkpoint hashes | P03, P02 |
| M07 | Health, readiness and reset (`make demo-reset`) | Supporting | Reset is itself an audited, reversible operation on a demo workspace | P03, D01 |
| M08 | Deterministic fallback driver (recorded MCP transcript) | Demonstrated | Replays the same MCP calls as a `driver` principal with the agent's scopes, with checkpoint verification | M03, M06 |

Count: 45 rows. Demonstrated: 31. Supporting: 14. Every supporting row is either an export of a core primitive (A05 is `D05` plus `P09`) or a consumer of one.

### Composition map

Primitives combine into larger capabilities through a small set of edges. The diagram shows the ones used on stage.

```
                 ┌──────────── P01 typed object registry ────────────┐
                 │                 │                    │            │
        M02 HTTP API         M03 MCP server        web UI forms   P02 revisions
                 │                 │                                   │
                 └──── M04 preview / commit ───────────────────────────┤
                                                                        │
  P05 authZ (Cedar) ── P08 principals ── P09 RLS predicates ──┐         │
        │                                                     │         │
  P03 hash-chained audit ◄──────── every write ◄──── P07 branches     P11 undo
        │                                                     │
        └── M06 replay ── M08 fallback driver                 │
                                                              │
  D01 stream ─┐                                               │
  D02 Postgres├─► D05 query IR ─► D06 transforms ─► D07 anomaly│
  D03 Parquet ┘        │     └─► D08 metrics ─► D09 parameters─┴─► V01 panels
  D04 telemetry ───────┘                              │          │
                                                      │       V02 cross-filter
                                                      │       V03 drill-down
                                                      │       V05 annotations
                                                      └──────► V06 alert rules ─► A02 ─► A01 workflows
                                                                                          │
  P04 realtime channel ◄── V07 live animation          P06 presence ◄── agent + humans    │
                                                                                          └─► A03 write-back
```

The two compositions that carry the demo are:

1. **Query → panel → parameter → query.** A panel's selection writes a parameter, the parameter is part of the IR of every other panel bound to it, and the IR's hash determines cache reuse. A brush in one panel therefore changes three queries and three renders through one mechanism.
2. **Agent write → revision → audit → realtime → every screen.** The agent's MCP call and a human's click go through the same commit path. The result is a revision, an audit row and a sequence-numbered event that every subscribed screen applies. The agent's own trace is just another subscriber.

---

## C. Five-minute live script

### Conventions

- **Screens.** Screen W is the wall (projected, 4K, Chromium kiosk). Screen P is the presenter console (laptop: terminal with Claude Code, Tessera console, keystroke bar). Screen A is an audience phone-width session (signed in as a viewer with no access to the investigation workspace). Screen T is the Composition Trace, a ribbon that every subscribed session can show; it lists each MCP call, its status, its revision and its audit sequence number.
- **Agent prompts** are typed on screen P, exactly as written below. They are short by design.
- **Choreography.** Model latency is allowed in the script. The ribbon shows the agent's pending call during the wait, so the wait is part of the visible work, not dead air. Where a step would exceed its window, the fallback rules in the last rows of section G apply.
- **Times** are from the start of the presenter's first keystroke, with an offset of 0 s at the moment the wall shows the seeded workspace.

### Timeline

| Time (s) | Presenter action | Expected behaviour (MCP calls, platform) | Visible result | Capabilities demonstrated | Transition |
|---|---|---|---|---|---|
| 0–25 | Presenter states the purpose on screen W: "This is a live order network. Nothing on this wall was built by hand, and an agent is about to build an ops board on it." Screen W shows the fulfilment stream strip, live at about 180 events/s, plus the presence strip with three participants. | None. Stream is live from reset (D01). Presence reports presenter and audience sessions (P06). | Live counters move. Presence shows two humans. Wall is otherwise empty. | D01, P06, V07 | Presenter switches focus to screen P. |
| 25–45 | Types into Claude Code: `Build an ops board for the fulfilment stream: throughput, p95 latency and error rate by region, last hour. Flag anomalies.` | `tessera.session.whoami` → principal `agent:demo-ops`, scopes listed. `tessera.catalog.search {query:"fulfilment"}` → source `src_fulfilment_stream`. `tessera.source.describe` → columns, watermark. `tessera.query.preview` ×3 (throughput, p95, errors) with `limit: 20`. `tessera.dashboard.create {dry_run:true}`. | Trace ribbon fills with calls. Wall shows the agent's cursor entering from the right edge and a new empty dashboard frame. | P01, M03, P05, P08, D01, D12 | Agent proposes a plan in one line of text; presenter does not intervene. |
| 45–75 | (none) | `tessera.dashboard.apply {dry_run:true}` returns a diff: 1 dashboard, 3 queries, 4 panels, 1 alert rule. Commit with `preview_token`. Each commit produces a revision and an audit row, then a sequence-numbered event. | Panels appear one at a time on the wall, each with live data already in it. Each appearance is the result of an event. The stat tiles tick as the stream does. | P02, M04, P03, P04, V01, V07 | Board is complete. |
| 75–100 | Presenter clicks the eu bar in the region breakdown on the wall. | Browser issues a parameter write `region=eu` through the same path as an agent (`param.set`). Three queries re-run with the new parameter; the result cache misses on the changed IR hash only. | Every panel dims to the eu subset. The throughput and error panels show a visible change of scale. Trace ribbon shows `param.set` attributed to the human presenter. | V02, D09, D10, P06 | Presenter says "Now it's a question, not a dashboard."|
| 100–120 | Presenter presses F-key `I` on screen P to fire the scenario incident in the simulator. | Simulator writes `scenario.control: degrade eu/carrier-dhl`. Carrier latency rises within about 15 s (target), retries rise, p95 for eu rises. The pre-built alert rule (`eu p95 > 800 ms for 2 min`) moves to `pending`. | Stat tile turns amber, then red. Timeseries grows an anomaly band (D07). The alert pill on screen W reads "pending 00:42". | D01, D07, V06, A01 (pending state), V07 | Presenter asks the question. |
| 120–150 | Types: `Why did eu p95 latency spike in the last few minutes? Show me what changed.` | `tessera.query.explain` on the p95 IR. `tessera.query.preview` grouped by `carrier`, then by `carrier` and `timeout_config_version`. `tessera.lineage.trace {object:"panel_p95"}`. `tessera.audit.query {since:"10m", source:"carrier.status"}`. Agent finds a timeout-config change on carrier dhl in the event stream and the latency split by carrier. | Trace ribbon shows four read calls and no writes. A bar chart "p95 by carrier" appears in the agent's investigation branch. | D05, D11, D04, V01, P03 | Agent states the finding in chat in two sentences, with the query it used linked. |
| 150–180 | (none) | Agent calls `tessera.dashboard.create {branch:"investigation", dry_run:false}` and builds: carrier breakdown bar (V03 drill link to order trace), timeseries overlay with the config event as an annotation (`tessera.annotate`), and a top-slow-orders table with masked customer column (P10). Each call is a revision on the branch. | Wall shows a second board forming beside the live board, marked "branch: investigation". Annotation appears on the timeline as a vertical rule at the config change. | P07, V05, P10, V03, P02 | Presenter clicks the carrier bar; order trace opens (drill-down). |
| 180–200 | Presenter clicks the carrier bar on the investigation branch. | Drill link creates a parameterised view `order_trace?carrier=dhl&region=eu` as a revision on the investigation branch (V03). | An order-trace panel with per-order timing segments slides in beside the bar. Animation is driven by the new object's `created` event. | V03, D09, P02, P04 | Presenter says "Let's make this live for the on-call team." |
| 200–225 | Types: `Merge the investigation branch to the wall, and share it read-only with group eu-ops. Create a workflow that pages on-call when eu p95 stays above 800 ms for 2 minutes.` | Agent calls `tessera.branch.diff` (shows the diff on screen), then `tessera.dashboard.apply {dry_run:true}` for merge, then commits. Agent calls `tessera.acl.propose_grant {object, group:"eu-ops", role:"viewer"}` → returns `status: pending_human_approval` and `grant_request_id`. Agent defines workflow `page-oncall-eu` (A01) with guard `alert.eu_p95.state == firing for 120 s` and action `webhook: pager-sink`. | Merge animates into the wall. A grant card appears on screen P and on screen W: "agent:demo-ops requests viewer for eu-ops on Investigation. Approve?" | P07, P05, A01, A02, M04 | Presenter approves on screen P with one click. |
| 225–240 | Presenter approves the grant. | Grant is written as a Cedar policy revision, signed by the approving human (P03). Realtime event reaches screen A. | Screen A flips from "403 — no access" to the investigation board, live, in its phone layout. Presence shows the audience session as a viewer of the board. | P05, P04, P06, C02 | Presenter shows the refusal moment. |
| 240–255 | Types: `Also copy the investigation into the finance workspace.` | Agent calls `tessera.dashboard.create {workspace:"finance", dry_run:true}`. Authorisation denies the write for `agent:demo-ops` (no scope on `finance`). The denial returns a structured error with `code: "AUTHZ_SCOPE"`, the policy id that denied it, and a suggestion: "request a grant via acl.propose_grant or copy to workspace ops-demo". Audit row records the refusal. | Trace ribbon shows a red entry with the policy name. Agent replies in chat and proposes the alternative. | P05, P08, P03, M04 (error design) | Agent takes the alternative without being asked. |
| 255–270 | (none, or one line: "It recovers from its own mistakes.") | Agent calls `tessera.dashboard.create {workspace:"ops-demo", title:"Investigation (copy)", dry_run:false}`, referencing the same revision. | A second dashboard appears on the wall. | P12, P01, P09 | Presenter fires recovery. |
| 270–285 | Presenter presses F-key `R` to recover the simulator. | Carrier latency falls back over about 40 s (target). p95 drops. Alert moves to `resolved`; the workflow `page-oncall-eu` moves from `firing` to `closed`, sends its recorded webhook (real HTTP POST to the pager sink), and writes its history. | Stat tile returns green. Workflow history panel on screen W shows the transitions with timestamps. | A01, A02, V06, D07 | Presenter clicks "Replay session". |
| 285–300 | Presenter clicks "Replay session" in the Trace ribbon. | `tessera.session.replay {session_id, target_workspace:"blank-2"}`. Platform applies the session's audited commits to an empty workspace in sequence, verifying the checkpoint hash after each. Human actions are replayed as their recorded revisions. | Screen W's second half rebuilds the investigation in a fresh workspace, panel by panel, from the audit log. A counter shows "34 calls, 3 commits, 1 refused, 1 approval, checkpoints 3/3 verified." | M06, P03, P02, P08 | End card: the audit trail and the wall, side by side. |

The final 30 s carry the strongest moment: the platform reconstructs an agent-built investigation from its own audit log, in a second workspace, with every checkpoint hash verified. The audience sees the same objects reappear, rather than a recording of them. This is the moment where "composable primitives" stops being a claim, because the replay uses only the stored revisions and the stored principal decisions.

### Where the fallback takes over

The live agent is the default in every row above. The fallback driver (M08) is a second client that calls the same MCP endpoint with the same scopes, using a recorded transcript of the rehearsal. It takes over at **step boundaries**, not mid-call:

- Each row in the table is a checkpoint. A checkpoint is defined by a revision number and a canonical hash of the workspace state after the last commit of that row.
- If the live agent has not produced the row's expected checkpoint within the row's window plus 20 s, or if it produces a checkpoint whose hash differs from the transcript's and whose call trace is off-script, the presenter presses `F9`. The driver then reads the transcript from the next checkpoint and issues its recorded calls.
- Because the driver uses the MCP endpoint, its calls appear in the Trace ribbon identically. The ribbon shows the calls, not the transport. The only visible difference is a small label in the presenter console (not on the wall) that reads `driver`.
- Before the driver runs any call, it verifies that the current workspace hash matches the transcript's checkpoint. If it does not, it stops and shows the presenter a reset prompt, rather than issuing calls into a state they were not recorded against. This is the guard against half-state.

The result is that the presenter can fall back mid-script at a row boundary, and the audience sees a continuation rather than a switch.

---

## D. Technical architecture

### Components

| Component | Language and framework | Responsibility |
|---|---|---|
| `web` | TypeScript, React 18, Vite, TanStack Query, Zustand; uPlot for time series (canvas), ECharts for heatmaps and bars, custom WebGL for stream rendering at high sample counts | Dashboard renderer, editor, console, wall mode, trace ribbon |
| `api` | TypeScript on Node 22, Fastify, Zod-generated JSON Schema from the registry | HTTP API, auth, command handlers, preview store |
| `mcp` | TypeScript, `@modelcontextprotocol/sdk` (Streamable HTTP and stdio) | MCP server; calls the same command handlers as `api` |
| `gateway` | Node 22, `ws`, Postgres `LISTEN/NOTIFY` consumer | Realtime fan-out with sequence numbers and gap recovery |
| `query` | Node 22 worker with DuckDB (node bindings) | Compiles IR to SQL, executes against attached sources, applies RLS predicates, returns Arrow IPC |
| `ingest` | Node 22; Kafka client | Consumes streams into the analytic store and maintains source watermarks |
| `policy` | Cedar (Rust core via WASM binding, called from Node) | Authorisation decisions with explanations |
| `driver` | TypeScript | Deterministic fallback driver and session replay |
| `sim` | TypeScript, seeded PRNG | Fulfilment simulator |

Justification of the main choices:

- **TypeScript end to end** keeps one schema registry in one language, and lets the browser, API and MCP server import the same validators. Rust would give stronger guarantees in the query engine, but the query engine is a thin compiler over DuckDB, so the language benefit is small and the team cost is high.
- **Postgres 16** for metadata, revisions and audit. It gives transactions, row-level security as a second line of defence, `LISTEN/NOTIFY`, and `jsonb` for patches. RDS on AWS and a container locally.
- **DuckDB** for analytic execution. It is embeddable, columnar, reads Parquet and Postgres, and has a stable plan output used by `query.explain`. It runs in the `query` worker both locally and on AWS, so query semantics do not depend on the deployment.
- **Redpanda locally, MSK on AWS** speak the same Kafka protocol. The `ingest` code is identical; only SASL configuration differs.
- **Cedar** because its policies are data, its decisions are explainable, and it runs unchanged in-process. The explanation of a denial (which policy, which entity attribute) is the source of the agent-facing error message.
- **Yjs is not used for dashboards.** Dashboards are structured documents with revisions, not free text. Collaborative conflict handling is patch-based (section D.5). Yjs is used only for comment and annotation text, where character-level merge is actually needed.

### D.1 Persistence model (key schemas)

All tables carry `workspace_id` and are protected by Postgres row-level security keyed on a session setting set from the authenticated principal.

```sql
CREATE TABLE object (
  id            text PRIMARY KEY,           -- 'dash_…', 'qry_…', 'pnl_…', 'src_…'
  workspace_id  text NOT NULL,
  kind          text NOT NULL,              -- 'dashboard' | 'panel' | 'query' | 'source' | 'alert' | 'workflow' | 'grant' | 'annotation' | 'thread'
  branch        text NOT NULL DEFAULT 'main',
  head_rev      bigint NOT NULL,
  doc           jsonb NOT NULL,             -- current materialised document, validated against kind schema
  schema_ver    int NOT NULL,
  deleted_at    timestamptz
);

CREATE TABLE revision (
  id            bigserial PRIMARY KEY,
  object_id     text NOT NULL REFERENCES object(id),
  branch        text NOT NULL,
  base_rev      bigint NOT NULL,            -- revision the patch was computed against
  rev           bigint NOT NULL,            -- resulting head revision
  actor         text NOT NULL,              -- principal id: 'user:…', 'agent:…', 'driver:…', 'system:…'
  transport     text NOT NULL,              -- 'ui' | 'http' | 'mcp' | 'driver' | 'replay' | 'system'
  patch         jsonb NOT NULL,             -- RFC 6902
  inverse_patch jsonb NOT NULL,             -- precomputed, makes undo a new revision
  preview_id    text,                       -- set when committed from a preview
  idem_key      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (object_id, branch, rev)
);

CREATE TABLE change_event (
  seq           bigserial PRIMARY KEY,      -- global ordering within workspace
  workspace_id  text NOT NULL,
  ts            timestamptz NOT NULL,
  actor         text NOT NULL,
  action        text NOT NULL,              -- 'commit' | 'refuse' | 'grant_request' | 'grant_approve' | 'replay_checkpoint' | …
  object_id     text,
  revision_id   bigint,
  outcome       jsonb NOT NULL,             -- includes denial policy id on refusals
  prev_hash     bytea NOT NULL,
  hash          bytea NOT NULL              -- sha-256 over canonical(prev_hash, row)
);

CREATE TABLE preview (
  token         text PRIMARY KEY,           -- opaque, 128-bit
  principal     text NOT NULL,
  object_id     text,
  base_rev      bigint NOT NULL,
  ops           jsonb NOT NULL,             -- the exact operations previewed
  diff          jsonb NOT NULL,
  validation    jsonb NOT NULL,
  expires_at    timestamptz NOT NULL       -- 10 minutes after creation
);

CREATE TABLE idempotency (
  principal     text NOT NULL,
  key           text NOT NULL,
  request_hash  bytea NOT NULL,
  response      jsonb NOT NULL,
  expires_at    timestamptz NOT NULL,       -- 24 hours
  PRIMARY KEY (principal, key)
);

CREATE TABLE source_watermark (
  source_id     text NOT NULL,
  partition     text NOT NULL,
  offset_or_ts  text NOT NULL,
  updated_at    timestamptz NOT NULL,
  PRIMARY KEY (source_id, partition)
);
```

Queries, panels and dashboards are not stored as SQL. They are stored as documents in `object.doc`. The compiled SQL is derived, cached by IR hash and never authoritative.

### D.2 Declarative specification language (TDS)

The agent and the UI both produce **Tessera Document Spec** documents. A dashboard document is self-contained: parameters, query definitions, panels, interactions and layout. Because it is plain JSON validated by the registry, it can be diffed, reviewed, branched, exported and re-applied. Here is a dashboard as an agent would commit it:

```json
{
  "tds": "1.0",
  "kind": "dashboard",
  "id": "dash_ops_latency",
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
  "panels": [
    {
      "id": "p95_trend",
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
    {
      "id": "p95_now",
      "type": "stat",
      "query": "p95",
      "value": "last(p95_ms)",
      "thresholds": [{ "gt": 800, "style": "critical" }],
      "grid": { "x": 8, "y": 0, "w": 4, "h": 5 }
    }
  ],
  "interactions": { "brush": { "emits": "param:window" } },
  "alerts": [
    { "id": "eu_p95_high", "query": "p95", "when": "last(p95_ms) > 800", "for": "2m", "fire": "workflow:page-oncall-eu" }
  ]
}
```

Language rules, enforced by the registry:

- References are typed (`$region` must name a declared parameter whose type is compatible with the position where it is used).
- Every query's output schema is computed at validation time, so a panel's `y` field must exist in its query's output.
- Unknown keys are errors, not warnings. This is the main defence against hallucinated fields (section G).
- Panels cannot contain code. The only expressions are typed IR fragments and the thresholds grammar.

### D.3 Query and transform engine

Pipeline: **TDS → validate → IR → RLS rewrite → cache lookup → compile → DuckDB → Arrow → render**.

- **IR** is a typed tree of steps. Each step has declared input and output columns. The `where` clause is a typed predicate AST, not a string.
- **RLS rewrite** happens on the IR before compilation. A policy from Cedar produces a predicate that is conjoined to the source step. This means a panel, its alert, its export and the agent's `query.preview` see the same restricted rows.
- **Cache key** is `sha256(canonical IR, source watermarks, principal's effective predicate hash)`. Watermark change invalidates exactly the affected keys. There is no TTL-based invalidation.
- **Streaming panels** do not re-run full queries per sample. The `query` worker keeps a windowed aggregate per live query and emits the window's delta as a sequenced event. Gap recovery replays from the last acknowledged sequence number, or re-snapshots the window.
- **Anomaly transforms** are deterministic: robust z-score uses the median and the median absolute deviation over the window; seasonal baseline uses the same statistic over the matching hour-of-week in the compacted store. Given the same data, they produce the same flags.

### D.4 Real-time transport

- The browser holds one WebSocket to `gateway`, authenticated with the same bearer token as the HTTP API. It subscribes to channels: `ws:{workspace}`, `obj:{id}`, `q:{queryHash}`, `presence:{dashboard}`.
- Every event carries `{workspace, seq, kind, object_id, rev, payload}`. The client applies events in `seq` order and requests a snapshot on any gap.
- Commits write a `change_event` row and a `NOTIFY` with the sequence number only. The gateway reads the row and fans out. Payload size on the notify channel is bounded at 8 KB by design, so large patches go through the row, not the notify payload.
- Presence is ephemeral (not persisted). Each session sends cursor and focus state at 10 Hz maximum, throttled, and the server expires it after 5 s without a heartbeat.
- Latency targets: commit to render on a second screen at p95 under 250 ms on localhost, and under 400 ms through the AWS ALB in the same region. These are targets verified by the tests in section F, not measured results.

### D.5 Collaborative editing model

- Each dashboard has a **head revision**. A client's edit is a patch with `base_rev`.
- If `base_rev` equals the head, the patch applies. If not, the server attempts a **three-way merge at path granularity**: the patch is applied to the current document if its paths do not overlap the paths changed since `base_rev`. Overlapping paths are a conflict.
- A conflict returns a structured error with both versions' values and a `rebase` suggestion. The UI shows a conflict card; the agent receives the same error and must re-read the object before retrying. No silent overwrite is possible, because `base_rev` is required on every write.
- Two humans editing different panels never conflict. Two humans dragging the same panel produce one winner and one conflict card. This is the "conflict handling" the brief requires, shown on screen when it happens.
- Comments and annotation text use Yjs for character-level merge. They are objects, but their body is a Yjs document persisted as an update log.

### D.6 Authorisation model (agent as scoped principal)

- Principals: `user:*`, `group:*`, `service:*`, `agent:*`, `driver:*`. Agents are created by a human admin with an explicit scope set. For the demo, `agent:demo-ops` has: read on all `ops-demo` sources and dashboards; write on dashboards and panels in `ops-demo` only; create alerts and workflows in `ops-demo`; **no** grant-approval rights; **no** write on any other workspace.
- Agents can call `acl.propose_grant`. They cannot call `acl.approve` (the tool is not even in their `tools/list`, because the server filters tools by scope). A human approves on the UI, which writes a policy revision signed by that human.
- Example Cedar policy (the one the refusal in minute 4 cites):

```cedar
@id("agent-ops-demo-write")
permit (
  principal in Group::"agents",
  action in [Action::"dashboard.write", Action::"panel.write", Action::"alert.write"],
  resource in Workspace::"ops-demo"
) when { principal.scope_set.contains("ops-demo:write") };

@id("agent-no-cross-workspace")
forbid (
  principal in Group::"agents",
  action,
  resource in Workspace::"finance"
) unless { principal.scope_set.contains("finance:write") };
```

- Row-level policies (P09) are Cedar `permit` rules with a `row` clause; the compiler turns them into IR predicates.
- Every decision (allow or deny) writes a `change_event` row with the policy ids consulted. Denials are first-class audit events.

### D.7 Audit, versioning and undo

- Every write is a revision with a stored inverse patch. **Undo is a new revision** whose patch is the stored inverse, so history is never rewritten.
- Branches are revision chains with a name. `branch.diff` is computed on the JSON documents, presented as a field-level diff with panel-level grouping.
- The change log is hash-chained. `audit.verify` recomputes the chain; a break is a visible alert in the console.
- Replay (M06) walks `revision` rows for a session in `seq` order, applies each patch to the target workspace with a checkpoint hash at each commit, and records `replay_checkpoint` events. A checkpoint mismatch stops the replay and reports the first differing object.

### D.8 MCP server design

The MCP server is a thin adapter over the same command handlers as the HTTP API. Each tool's input schema is generated from the object registry; its description is written as a contract for a model, not as marketing copy. Transport is Streamable HTTP at `/mcp`, and stdio via the `tessera-mcp-stdio` bridge.

#### Tool catalogue (signatures)

Read tools:

- `tessera.session.whoami() → {principal, workspace, scopes[], tool_filter_version}`
- `tessera.catalog.search({query: string, kinds?: Kind[], limit?: int≤50}) → [{id, kind, title, score, why}]`
- `tessera.schema.describe({kind: Kind, version?}) → {schema, examples[], required_scopes, related_kinds[]}`
- `tessera.source.list({}) / tessera.source.describe({id}) → {columns[{name,type,nullable,masked?}], watermark, row_estimate}`
- `tessera.query.explain({ir}) → {plan_summary, scan_bytes_est, rows_est, warnings[]}`
- `tessera.query.preview({ir, limit≤500}) → {columns, rows, truncated, cache: hit|miss, watermark}`
- `tessera.lineage.trace({object_id, direction: up|down}) → {nodes[], edges[]}`
- `tessera.audit.query({since?, until?, actor?, object_id?, action?, limit≤1000}) → {events[], chain_ok}`
- `tessera.acl.explain({object_id, principal}) → {effective: allow|deny, policies[], missing_scopes[]}`
- `tessera.branch.diff({object_id, from, to}) → {changes[{path, before, after}], grouped_by_panel}`

Write tools (all accept `dry_run: bool` and `idempotency_key?: string`; all return either a committed result or a `preview_token` with a diff):

- `tessera.dashboard.create({workspace, title, tds, branch?, dry_run?, idempotency_key?})`
- `tessera.dashboard.apply({object_id, base_rev, ops: [{op, path, value}], branch?, dry_run?, preview_token?})` — RFC 6902 ops, validated against the kind schema after application.
- `tessera.panel.create({dashboard_id, panel: PanelSpec, position?, dry_run?})`
- `tessera.panel.update({panel_id, base_rev, patch, dry_run?})`
- `tessera.panel.delete({panel_id, base_rev, dry_run?})`
- `tessera.query.define({name, ir, source, dry_run?})`
- `tessera.source.create({kind: stream|postgres|parquet|telemetry, config, dry_run?})` (config secrets are references, never values)
- `tessera.param.set({dashboard_id, name, value})` — the same write humans make through brushing
- `tessera.annotate({target: {panel_id}|{dashboard_id, time_range}, text, dry_run?})`
- `tessera.alert.create({query_id, when, for, fire, dry_run?})`
- `tessera.workflow.define({name, states[], transitions[], actions[], dry_run?})`
- `tessera.workflow.trigger({workflow_id, payload?})`
- `tessera.branch.create({object_id, from_rev, name})` and `tessera.branch.merge({object_id, branch, base_rev, dry_run?})`
- `tessera.revision.revert({object_id, rev, dry_run?})` — creates a new revision from the stored inverse
- `tessera.acl.propose_grant({object_id, group|principal, role, reason})` — returns `pending_human_approval`; no approve tool exists for agents
- `tessera.commit({preview_token})` — commits exactly the previewed operations, if base revisions still match
- `tessera.session.replay({session_id, target_workspace, verify: checkpoint})`

Presentation tools:

- `tessera.screen.present({screen_id, dashboard_id, params?})` — moves a named screen; screens are principals with display scope.

#### Resources

- `tessera://schema/{kind}` — JSON Schema plus examples, for clients that prefer resource reads.
- `tessera://dashboards/{id}` — current document and head revision.
- `tessera://dashboards/{id}/revisions/{rev}` — a specific revision.
- `tessera://sources/{id}` — source description.
- `tessera://audit/recent?window=10m` — subscribable; updates as `notifications/resources/updated` on each change event.
- `tessera://health` and `tessera://capabilities` — the machine-readable capability map (every kind, every verb, scopes required).

Prompts: `build-ops-board` and `explain-spike` are published as MCP prompts. They are short recipes that point to tools; they contain no data.

#### Discovery

An agent discovers the platform through three routes: `tools/list` (descriptions written as contracts, filtered by scope), `tessera.schema.describe` (JSON Schema with examples and an `x-tessera-hint` field per property), and `tessera.catalog.search`. The descriptions name the failure modes ("`base_rev` must be the revision you read; a stale value returns `CONFLICT`"). Tool filtering matters: an agent that cannot approve grants is not shown an approve tool, so it cannot hallucinate one into a call and be refused.

#### Preview, commit, idempotency

1. Any write with `dry_run: true` validates, computes the diff, stores a `preview` row and returns `preview_token`, `diff`, `validation` and `expires_at`.
2. `tessera.commit({preview_token})` re-validates against the current head. If the base revisions still match, it commits the stored operations. If not, it returns `CONFLICT` with the changed paths, and the preview is not applied.
3. Idempotency: `(principal, idempotency_key)` maps to the first response for 24 hours. A repeated key with a different request body returns `IDEMPOTENCY_MISMATCH`, not a second commit.

#### Error messages designed for self-correction

Every error has the same shape:

```json
{
  "error": {
    "code": "VALIDATION_UNKNOWN_FIELD",
    "message": "Panel 'p95_trend' has no field 'p95'.",
    "path": "/panels/0/y/0",
    "received": "p95",
    "valid_values": ["p95_ms", "window_start"],
    "suggestion": "Use 'p95_ms'. It is the output column of query 'p95' step 'aggregate'.",
    "retryable": true,
    "docs": "tessera://schema/panel#y"
  }
}
```

Codes are a closed set: `VALIDATION_*`, `REF_NOT_FOUND`, `CONFLICT`, `AUTHZ_SCOPE`, `AUTHZ_POLICY`, `RATE_LIMITED`, `IDEMPOTENCY_MISMATCH`, `PREVIEW_EXPIRED`, `SOURCE_UNAVAILABLE`, `QUERY_TOO_LARGE`. `valid_values` is computed from the registry, so the fix is available without a second call. Close-match suggestions use edit distance on the valid values.

#### Rate limits

Token bucket per principal: 20 writes per second burst 40; 10 concurrent queries; 200 read calls per minute sustained. Agent limits are lower than human UI limits by configuration, not by code. `RATE_LIMITED` returns `retry_after_ms`.

#### Prompt injection and data trust

- Query results and audit rows are returned in a `data` envelope with `"trust": "untrusted_data"`. Dashboard titles and comments are data too. The MCP server never returns instructions as text the agent is meant to follow.
- Write paths are constrained by scope, not by the model's judgement. A convincing instruction embedded in a comment cannot grant a permission, because grants require a human-approved policy revision.
- Tool descriptions are static and versioned. The server does not generate tool text from data.
- Secrets are references (`secret://ops-demo/carrier-token`). The agent can name a secret and cannot read it.
- The MCP server logs the full request and response for every call in `change_event` or the call log, so an injected action is attributable after the fact.

---

## E. AWS and local deployment

### Principle

The same OCI images run in both places. Configuration selects the substrate (Postgres endpoint, Kafka brokers and auth, object store endpoint, OIDC issuer). Application code never branches on the environment; a test suite run against both environments checks that.

### Images

Five images, all built from one repository with a multi-stage Dockerfile on a pinned Node 22 base: `tessera-web` (static assets served by `api`), `tessera-api`, `tessera-mcp`, `tessera-gateway`, `tessera-query`, `tessera-ingest`, `tessera-sim`, `tessera-driver`. Images are immutable and tagged with the git commit and a content digest. There is no runtime package installation. The `sim` and `driver` images are not deployed to production workspaces on AWS; they are deployed to the demo environment only, by the same pipeline.

### Mapping

| Concern | AWS | Local (`docker compose up`) | What differs and why behaviour is unchanged |
|---|---|---|---|
| Compute | ECS on Fargate, one service per image | Compose services, same images | Same images; scaling differs, not semantics |
| Metadata and audit | RDS for PostgreSQL 16, Multi-AZ | Postgres 16 container | Same schema and migrations; RLS identical |
| Streams | MSK Serverless (IAM SASL) | Redpanda (no auth, single node) | Same Kafka protocol; `ingest` config only; parity test checks offsets and ordering |
| Object store | S3 | MinIO (S3 API) | Same SDK and paths; no code change |
| Identity | Cognito user pool (OIDC) with agent client credentials | Dex (OIDC) with static users | Same OIDC flow and JWT claims; the scope claim is mapped by config |
| Secrets | Secrets Manager | Compose secrets, file-mounted | Same `secret://` reference resolution |
| Ingress and TLS | ALB with ACM certificate; WebSocket and Streamable HTTP supported | Caddy with a local CA; same paths | Same routes: `/`, `/api`, `/mcp`, `/ws` |
| Telemetry | CloudWatch via OTel collector | OTel collector to local Grafana Tempo and Loki | Same OTLP export from code |
| Infrastructure as code | AWS CDK in TypeScript | Compose file generated from the same service list | The service list is one source; a test diffs the two |
| Scheduled and reset jobs | EventBridge Scheduler to ECS task | `make demo-reset` | Same reset command; EventBridge is not on the demo path |

### What is intentionally different

- **Auth on Kafka.** MSK requires IAM SASL; Redpanda locally is unauthenticated. The ingest code takes a SASL config from environment, and the parity test asserts the same consumer offsets and event ordering after identical input.
- **Identity provider.** Dex and Cognito produce different issuer URLs and client registrations. Both produce a JWT with the same claim layout, which is the only contract the platform reads.
- **Scale.** Fargate task counts differ. The demo uses one task per service on AWS and one container per service locally.
- **Network placement.** The local stack exposes ports; AWS places services in private subnets behind the ALB.

Differences are recorded in `docs/parity.md` in the repository, and each row names the test that exercises it.

### How the MCP server is exposed

- **Streamable HTTP** at `https://{host}/mcp`. Local: `https://localhost:8443/mcp` through Caddy. AWS: the same path behind the ALB.
- **Auth.** Bearer tokens in the `Authorization` header. The token is an OAuth 2.1 access token issued by the same OIDC issuer as the UI. For the agent, the token comes from the client-credentials grant with the `agent:demo-ops` client; scopes are the token's `scope` claim, mapped to Cedar principal attributes at each request. The server validates signature, issuer, audience (`tessera-mcp`), expiry and revocation (a short-lived token plus a revocation list checked per request for write calls).
- **Stdio.** For Claude Desktop and Claude Code, the `tessera-mcp-stdio` bridge runs on the presenter's machine, reads a token from the OS keychain, and forwards JSON-RPC to the HTTP endpoint. The bridge holds no state and does no authorisation.
- **Transport identity.** Every MCP session has a session id; the audit row records `transport: mcp` and the session id, so the Composition Trace and replay key on it.

---

## F. Five strongest technical claims

Each claim has an executable test or an observable behaviour an evaluator can check. Quantities are targets unless labelled as estimates.

**Claim 1 — The agent path and the human path are the same commit path.**
*Statement:* any mutation made through MCP produces exactly the same `revision`, `change_event` and realtime event shape as the same mutation made through the UI or HTTP API, differing only in `actor` and `transport`.
*Test:* a property-based test generates random valid TDS operations (1000 cases, fixed seed), applies each through `ui`, `http` and `mcp` transports in three fresh workspaces, and asserts that the canonical object documents, patches and event payloads are equal after removing `transport` and `actor`. Failure prints the minimal operation sequence.

**Claim 2 — A scoped agent cannot exceed its scope, and every refusal is explained and audited.**
*Statement:* `agent:demo-ops` cannot write to `finance`, cannot see `acl.approve` in `tools/list`, and cannot approve its own grant; each attempt yields a structured error naming the policy id and a `change_event` refusal row.
*Test:* an integration test authenticates as `agent:demo-ops`, lists tools (asserts absence of approve tools), calls `dashboard.create` on `finance` (asserts `AUTHZ_SCOPE` and policy id), then calls `acl.propose_grant` for itself (asserts `pending_human_approval` and no policy revision). It then queries the audit log and asserts two refusal-or-pending rows with the expected policy ids and a valid hash chain (`audit.verify` returns true).

**Claim 3 — Dry-run is exact: the preview is the commit.**
*Statement:* for any preview that commits, the committed revision's patch equals the preview's stored operations, and a preview whose base revision moved returns `CONFLICT` without modifying the object.
*Test:* create 200 random previews, interleave concurrent writes from a second principal in 50 of them, and assert: committed patches equal previewed ops; the 50 interleaved previews return `CONFLICT` and leave `object.doc` and `head_rev` unchanged (checked by hash). This runs in the integration suite against Postgres.

**Claim 4 — Live state propagates to every screen in bounded time, with gap recovery.**
*Statement:* a commit made through MCP appears in a second authenticated browser session within the target latency, and a session that misses events (network drop injected for 5 s) re-synchronises without a page reload and with no duplicated or reordered panel updates.
*Test:* an end-to-end browser test (Playwright, two contexts, one agent client) makes 300 commits, records the time from `commit` response to DOM update in the second context, and reports p50, p95 and p99. Target locally: p95 under 250 ms. A second test drops the WebSocket for 5 s during 40 commits and asserts the final DOM hash equals the server's canonical hash with no duplicate sequence numbers applied.

**Claim 5 — Deterministic replay reconstructs an agent session from its audit log, checkpoint by checkpoint, on AWS and locally.**
*Statement:* replaying a recorded session into a blank workspace produces the same canonical workspace hash at every checkpoint as the original, and the same result on the local and AWS deployments given the same seed and reset.
*Test:* a rehearsal script runs the full five-minute transcript against a seeded local stack, records checkpoint hashes, runs `make demo-reset`, replays the session with `verify: checkpoint`, and asserts all checkpoints match. The same script runs against the demo environment on AWS. The test fails on the first mismatch and names the object. Additionally, the fallback driver's rehearsal run is required to produce identical checkpoints to the live agent's recorded run for the rows marked "driver-safe" in the script.

Each claim has an observable form for an evaluator as well: the replay counter on screen W (claim 5), the refusal card (claim 2), and the second-screen latency counter on the console (claim 4).

---

## G. Failure analysis

### Implementation difficulties

- **Three-way merge at path granularity** is subtle when patches touch arrays (panel order, grid positions). The design avoids array-index ops for panels: panels are keyed by `id` in a map, and the order is a separate array with its own merge rule. The cost is a second merge path to test.
- **Streaming windows with exact gap recovery** need the window aggregate and the sequence to be checkpointed together. A bug here shows as a panel that is subtly wrong, not as an error. Mitigation: a golden test per aggregate that compares the streamed window with a full recompute at fixed intervals.
- **RLS as predicate injection** must cover every path, including anomaly transforms that read a joined reference table. A missed join is a data leak. Mitigation: the compiler refuses an IR whose source steps are not all wrapped, and a test enumerates every source kind.
- **Cedar in Node** through WASM adds a startup cost and a serialisation boundary on every request. The per-decision cost is unmeasured at this stage and is a step-6 measurement target. Explanation objects must also be re-derived when policies change.
- **Replay across schema versions.** A patch recorded against schema v1 must replay on v2. The design requires upcasters for every kind change, and a rule that schema changes are additive during the demo's lifetime.
- **Hash-chained audit under concurrency** serialises writes to `change_event`. At the target write rate this is a single-writer hot row. Mitigation: per-workspace chains, with a global anchor written periodically.

### On-stage failure modes and mitigations

| Failure | Symptom | Mitigation |
|---|---|---|
| Model slow (planning exceeds window) | Trace ribbon shows a pending call for more than 8 s | Ribbon labels the wait; presenter may narrate; after window + 20 s, `F9` fallback at the next checkpoint |
| Model calls a wrong tool | Refusal or validation error appears | Error is the designed self-correction path; it is in the script (minute 4) and is fine to show |
| Model hallucinates a field | `VALIDATION_UNKNOWN_FIELD` with `valid_values` | The agent retries with the suggested field; the expected recovery is one retry; retries per model are a rehearsal measurement, not claimed here |
| Model issues destructive action | Scope or preview blocks it | No destructive tool exists without a preview; revert is a new revision |
| Model proposes a grant it should not | Grant card waits for human approval | The approval is a deliberate presenter action; the script depends on it being visible |
| Stream stalls (broker issue) | Stat tiles freeze with a "stale" badge | Badge is driven by watermark age; the demo does not hide staleness |
| Gateway drops | Screens show "reconnecting" | Gap recovery re-syncs; rehearsal includes a forced drop |
| Browser on wall crashes | Wall goes blank | Kiosk watchdog reloads to the last dashboard by id; state is server-side so reload restores it |
| Agent rate limit hit | `RATE_LIMITED` in trace | Limits are set well above script need; retry_after is shown |
| Network to AWS | Latency rises | The demo runs locally by default; AWS is a parity run, not the stage path |
| Reset did not complete | Old state visible | `make demo-reset` is idempotent and prints the checkpoint hash it reached; the console refuses to start a script until the hash matches the expected initial state |

### Agent failure modes, in more detail

- **Wrong tool call.** The most likely is querying the wrong source. The tool descriptions name the source-selection rule, and `catalog.search` returns a `why` field. In rehearsal, the rate of a wrong first source is recorded per model; the script's first prompt names the source ("fulfilment stream") to keep it inside the space the agent has to choose from.
- **Hallucinated fields.** Covered by closed validation and `valid_values`. Hallucinations that pass validation are the real risk: a field that exists but has the wrong meaning. The mitigation is that `schema.describe` includes units and descriptions, and the investigation step asks for a named metric (`p95_ms`, defined once as a computed metric D08).
- **Slow responses.** Covered by the window rules above. The design does not depend on any single call being fast; it depends on the ribbon being honest.
- **Plausible but wrong finding.** The agent may attribute the spike to the wrong cause. The investigation step is designed so that the config event is in the stream with its timestamp, and the carrier breakdown is one query. A wrong attribution is visible on the chart; the presenter can correct it in one prompt, which is itself a demonstration of annotations.
- **The fallback itself.** A transcript recorded against one model's phrasing is still a valid transcript: it is a list of MCP calls, and the driver checks state, not wording. The driver cannot "lose" its place because each row is a checkpoint.

### Hidden complexity

- Making the Trace ribbon honest requires every transport to record a session id and a call id. It is a cross-cutting concern that touches the HTTP and MCP paths.
- Presence and cursors for an agent need a notion of "agent cursor" that is not a human pointer. It is a participant with a last-action target, not a mouse position.
- Wall mode requires a screen principal with display scope and no input. Its layout must not depend on the viewport of the presenter's laptop.
- The replay feature depends on every write being a revision with a stored inverse. Any shortcut path (a direct SQL update during migration) would make replay lie. The rule is enforced by a database trigger that refuses writes to `object.doc` without a matching `revision` row in the same transaction.
- Animations have to be driven by events and must still look correct when several events arrive in one frame. The renderer batches by frame and orders by `seq`.

### Own features that look impressive but are shallow

Stated plainly, so that the audience's critique is not the first time I look at them:

- **The "agent cursor" on the wall** is a labelled participant, not a model of the agent's attention. It shows the last target the agent touched. It does not show intent.
- **Cross-filter** is a parameter write plus re-query. It is deep only in that the same write path serves agents. Its visual polish is shallow.
- **Heatmaps and histograms** are standard ECharts widgets over the same query results. They are present because the panel type list needs them, not because they are differentiated.
- **Comments with Yjs** are a small piece of the design. Their character-level merge is correct but rarely exercised on stage.
- **The "session replay" counter** counts calls, commits and checkpoints. It does not explain the agent's reasoning, which is outside the platform.
- **Anomaly detection** is a robust z-score and a seasonal baseline. It is deterministic and honest, but it is not a forecasting model and must not be described as one.
- **Embedding** is shipped as a signed iframe with the same authorisation path. It is supporting, and the demo does not show it.

---

## H. Feasibility

### Scope by component

Feasibility is expressed by what each component touches and by its dependencies, not by duration.

| Component | What it touches | Depends on | Demo-critical |
|---|---|---|---|
| Object registry and TDS validator | JSON Schema generation, kind definitions, reference resolution | none | Yes |
| Revision store, audit chain, preview store | Postgres schema, triggers, hash chain, idempotency table | registry | Yes |
| Cedar policy integration and principals | WASM binding, principal attributes, explain output | registry | Yes |
| Query IR, compiler, DuckDB executor, RLS rewrite | IR types, SQL generation, Arrow results, cache keys | registry, Cedar | Yes |
| Stream ingest and sim | Kafka consumer, watermarks, PRNG scenario, control topic | none (parallel) | Yes |
| Gateway and realtime channel | WebSocket, LISTEN/NOTIFY, sequence and gap recovery | revision store | Yes |
| HTTP API (generated) | Fastify routes from registry | registry, revision store | Supporting for UI |
| MCP server | Tool generation, filtering, error shape, Streamable HTTP, stdio bridge | registry, command handlers | Yes |
| Web renderer and editor | React panels, cross-filter, drill-down, wall mode, trace ribbon | gateway, query preview | Yes |
| Workflows and alert rules | State machine, guards, timers, webhook action | revision store, query, ingest | Yes |
| Branching, diff, merge, undo | Branch chains, diff, inverse patches | revision store | Yes |
| Replay and driver | Session replay, checkpoint verification, transcript recorder | audit, MCP, revision | Yes |
| Deployment (compose, CDK) | Images, service list, parity tests | all services | Yes (local first) |
| Collaboration extras (Yjs comments, embedding) | Yjs, signed tokens | gateway | No |

### Critical dependencies

- **Cedar WASM binding** works in Node 22 and produces explanations; if it does not, the fallback is a small in-house policy evaluator with a reduced policy language. This is a known scope change, not a block.
- **DuckDB node bindings** must support Arrow output and attach Postgres; both must be confirmed against the version pinned at step 1.
- **Redpanda and MSK compatibility** for the consumer groups used. Verified by the parity test, not assumed.
- **MCP SDK Streamable HTTP** and OAuth 2.1 bearer validation in the chosen SDK version. The stdio bridge is independent of this.
- **Model behaviour** is an external dependency, handled by the fallback driver rather than by design assumptions.

### Main risks

1. **Replay fidelity.** If any write path bypasses the revision store, replay lies. Mitigated by the database trigger and a test that scans for writes without revisions.
2. **Agent tool-design quality.** A capable model may still stumble on the query IR. Mitigated by `query.explain`, `valid_values`, and the rehearsal transcripts, which show which descriptions need to change.
3. **Streaming correctness under gaps.** Mitigated by golden recompute tests.
4. **Cross-environment parity.** Mitigated by running the same rehearsal against both.
5. **Visual scope creep.** The wall has many possible animations. Only animations tied to events are built; others are cut.

### Dependency-ordered build sequence

Each step produces something that can be tested and that the next step consumes. Steps 1–3 form the minimal vertical slice; from step 4 on, each step extends the slice rather than replacing it.

1. **Object registry, TDS for a single dashboard with one panel, one source, one query.** Output: validated documents, UI renderer for one timeseries panel reading from a fixed source. No auth, no MCP.
2. **Revision store and commit path, with `ui` and `http` transports.** Output: a dashboard edited in the browser commits a revision, an audit row and an event; a second browser session sees it.
3. **Stream ingest from `fulfilment-sim` into the analytic store, with one query source.** Output: the timeseries panel shows live data. This is the minimal vertical slice a stage would accept.
4. **MCP server with read tools and `session.whoami`, `catalog.search`, `query.preview`.** Output: an agent can inspect the platform. Depends on steps 1–3.
5. **MCP write tools with preview and commit, idempotency, error shape.** Output: an agent builds the board in minute 1 of the script.
6. **Cedar principals and scopes, including refusal audit rows and `acl.propose_grant`.** Output: minute 4 and minute 7 of the script work.
7. **Parameters, cross-filter, drill-down, presence, presenter screen targets.** Output: the human side of the choreography.
8. **Anomaly transform, alert rule, workflow state machine, webhook action.** Output: the incident path and the page.
9. **Branching, diff, merge, undo as inverse-patch revisions.** Output: minute 3 and the revert path.
10. **Replay (M06) and fallback driver (M08) with checkpoints.** Output: the strongest moment and the failure guard.
11. **Multi-workspace (`ops-demo`, `finance`, `blank-2`) and row-level predicates.** Output: the cross-workspace refusal is real.
12. **Compose deployment with the same images, then CDK for AWS, then the parity suite run against both.**
13. **Supporting capabilities** (comments, annotations threads, templates, scheduled reports, exports, embedding): added last, each as a new kind on the same registry, each with its MCP tools generated by the same mechanism. Their absence does not affect the five-minute script.

Steps 1–3 and the simulator in step 3 are the only places where the platform must be correct before anything else can be exercised. Everything after them can be developed in parallel lanes (MCP, realtime and UI, authorisation, workflows) because they share the registry and the revision store and nothing else. The demo's stage path depends on steps 1–12. Step 13 is the breadth the brief asks for, and it is built as data-driven kinds so its marginal cost is the kind definition plus its tools.

---

## Closing note on the brief's bar

What makes this design different on the visual axis is that the spectacle is the platform's own event stream made visible. Panels appear because commits happen. Numbers move because samples arrive. The agent's trace is the same audit log an auditor would read, and the final replay rebuilds the investigation from it. If any of that were faked, the audience would see the seams; the design is built so that there are no seams to hide.

Word count (estimate): about 7,000 words.
