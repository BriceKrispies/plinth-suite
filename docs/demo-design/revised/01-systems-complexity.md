# Fathom: a composable operations platform with a first-class agent interface

Competitor 01, mandate: **Systems Complexity**. Revision 2, written after four independent reviews of revision 1.
Status: design proposal. Nothing in this document has been built or run. Every number is either a design parameter, a scenario parameter, or a value the rehearsal must measure; each is labelled where it appears.

**Pitch.** Fathom is an enterprise operations platform in which every dashboard, panel, query, alert, workflow, approval and grant is a typed object in one versioned document model, written through one plan/commit protocol and one operation registry that generates the web UI, the HTTP API, the CLI and an MCP server. An agent connected over MCP can preview, branch, merge, audit and undo its own changes on the screen the audience is watching, and can answer "why did p95 latency spike at 14:05" by running real queries and an attribution over event data, then build the drill-down that answers it.

---

## Revision log

Each finding from the four reviews is listed once. Disposition is **Fixed** (the change is in the named section), **Rebutted** (the reasoning is given), or **Accepted** (a known limitation, stated in section G or H).

### Reviewer A (Principal Systems Engineer)

| Ref | Finding | Disposition | Where |
|---|---|---|---|
| A-W1 | Live branch contradicts itself: D.6 forbids agent writes to live, yet 210–255 has the agent commit to the node being edited on live; query is an exclusive register so one writer wins | **Fixed.** Agents never write `live`. Every agent write is a plan on an agent branch. A three-way merge into `live` is a human action. Two human writes to one register on `live` produce a concurrent-write annotation and keep the loser; a merge whose sides both change one register is refused with a named conflict set, never auto-resolved. The 205–235 beat is now a merge of disjoint properties. | §D.5, §C.1 (205–235) |
| A-W2 | Live-result key `(watermark, binding_hash, rev_id)` has no principal, so finance and the Ops wall share results under RLS rewrite | **Fixed.** Key is `(watermark, bindingHash, revId, predicateHash, maskHash)`, where the last two hash the effective RLS predicates and masks after rewrite for the caller. `query.explain` prints all five parts. | §D.4 |
| A-W3 | 14:05–14:20 window completes about 120 real seconds after live start, the same moment the question is asked | **Fixed.** Reset loads history to scenario 14:20. The attribution window is complete before the presenter starts. `attribution.run` and `query.run` take `watermarkAtLeast`, and return `watermark_not_reached` instead of partial data. The live feed produces only events after 14:20. | §C.0, §D.4 |
| A-W4 | 210–255 concurrency beat depends on interleaving; recording captures calls, not interleavings | **Fixed.** The beat is a branch merge with a fixed order of calls and clicks. Human-human concurrency is kept for claim 1 (a property test), not for the stage. | §C.1 (205–235), §F |
| A-W5 | Audit chain serialisation unstated; `audit_event` has only a bigint key; replica identity across restarts undefined | **Fixed.** Each writing transaction locks the workspace's `audit_head` row (`SELECT … FOR UPDATE`), so appends serialise per workspace. Replica identity is a fresh id per process incarnation, recorded in a `replica` table. Sequence numbers are allocated by an update of that row inside the transaction, so a rollback leaves no gap. | §D.2, §D.7 |
| A-W6 | Read checks missing on `ui.focus`, `catalog.search`, `lineage.of`, `audit.search`, presence; no preview for `spec.revert` and `branch.create` | **Fixed.** Every read-side operation applies the caller's read rewrite before returning, and `ui.focus` delivers only to sessions that can read each target. Revert, branch creation and merge are plan operations and have previews. | §D.8 |
| A-W7 | `acl.grant` Cedar example uses `resource.ref`, not an attribute of `Workspace` | **Fixed.** Replaced by a schema fragment and two policies that type-check. The owner ceiling is a server-computed context boolean (`ownerCanGrant`), never supplied by the caller. | §D.6 |
| A-W8 | Finance window hides a panel that the approved grant never named; panel-level visibility not modelled | **Fixed by change.** The finance beat is now row scope: finance sees the board the grant names, with rows restricted by RLS. Panel-level visibility inside a board is stated as not modelled. | §C.1 (235–270), §B.3 |
| A-W9 | Exactly-once across `kill -9` needs a client dedupe key; "gaps impossible" beside at-least-once transport | **Fixed.** Commits dedupe on `(principal, idempotencyKey)`. Deltas dedupe on `(replica, seq)`. Gap-freedom is stated per replica and explained by transactional sequence allocation. Claim 5 says exactly what it proves. | §D.5, §D.8, §F |
| A-W10 | "Roughly thirty-five capabilities each appear in a visible action" overstates | **Fixed.** Counts are exact and split into two tiers: capabilities with their own on-screen element, and capabilities that appear only as a field of another element. | §B.3 |
| A-R1 to R9 | Required changes (live resolution, predicate and mask hashes, watermark bind, deterministic beat, chain-head lock and replica rule, read checks and previews, Cedar correction, panel visibility, dedupe key) | **Fixed** as listed in W1 to W9 above. | As above |

### Reviewer B (Skeptical Technical Audience Member)

| Ref | Finding | Disposition | Where |
|---|---|---|---|
| B-1 | Attribution is the planted throttle read back; no negative control and no no-cause run | **Partly rebutted, partly fixed.** The throttle is a parameter of the simulator, and the platform never receives a cause label; the answer is what the attribution query returns from the event data. That is the claim, and it is not a scripted answer. But the reviewer is right that a control is needed. Added: a non-causal noise dock `SW-D07` that must not rank above the threshold, a no-cause control workspace whose attribution must return `no_dominant_cause`, and removal of all scenario percentages from on-screen claims. | §B.1 P34, §C.1 (120–165), §C.0 |
| B-2 | Concurrent edit beat has no deterministic trigger; named-author chip depends on wall clock | **Fixed.** The beat is a merge; the chip is computed from the merge preview's per-property authorship. | §C.1 (205–235) |
| B-3 | 270–300 s montage stacks workflow hold, replica kill, idempotent retry, reconnect and audit verify | **Fixed.** The final 30 s carries kill, in-flight retry and audit verify. Reconnect is a status line, not narrated. The workflow hold moves to the 235–270 approval beat. | §C.1 (235–270, 270–300) |
| B-4 | Alert self-correction matches the D.3 example and the valid alternatives include the intended key | **Fixed.** The first `alert.create` uses `for`, a name at edit distance greater than two from `hold`, so no `did_you_mean` is produced. Recovery is `schema.describe` on the alert kind, then the corrected call. The recovery is a discovery step, not a hint. | §C.1 (235–270), §D.3 |
| B-5 | Finance story contradictory (grant on board; panel hidden for lack of drill grant) | **Fixed.** One sentence: finance may see the ops board that the approved grant names, with rows restricted by RLS to the finance regions; the drill-down has no grant, so its link is shown locked with the `access.explain` reason. | §C.1 (235–270), §D.6 |
| B-6 | Replayed calls written into the agent transcript with the same formatting, forging a live transcript | **Fixed.** Replayed calls are labelled as recorded fallback in the agent pane, with the recording's name and step numbers. The transcript is not forged. | §C.3 |
| B-7 | Stage stack too heavy; H.3 leaves wall rendering unmeasured | **Fixed** for the stack: a stage profile names the services the script touches and the optional profiles. **Accepted** for wall rendering: it is a measurement that the rehearsal records on the target display; no figure is claimed here. | §E.4, §H.3 |
| B-8 | Visual mandate thin (bar and line charts, tables) | **Rebutted in scope.** This mandate ranks platform depth and correctness. The visual elements are the ones that show behaviour: the diff, the merge chip, the locked link, the alert trace, the approval card. Spatial or motion spectacle is not pursued here and is not claimed. | §C |

### Reviewer C (Implementation and Reliability Engineer)

| Ref | Finding | Disposition | Where |
|---|---|---|---|
| C-1 | Feed at 10x makes checkpoints differ between runs; replay stops at the first checkpoint unless the feed is gated | **Fixed.** Replay is watermark-gated through a demo-only, admin-only operation `feed.until`, which is not in the agent's catalogue. Checkpoints exclude wall time and revision ids. Panel values are compared only at equal watermarks. | §C.3, §D.7 |
| C-2 | Why window ends about 120 s after feed start; scripted figures are scenario parameters | **Fixed** for timing (history preloaded, see A-W3). **Accepted** for figures: the script states no figures. It states expectations (dominant dock is the throttled dock, the noise dock does not rank) that the rehearsal confirms or records as a failure. | §C.0, §C.1 |
| C-3 | Scope with no cut list; move CRDT is the hardest component | **Fixed.** An ordered cut list names what each cut removes and which claim it narrows. Layout uses grid-slot registers, so the demo does not depend on move operations; moves are the first cut. | §H.6 |
| C-4 | Kill beat does not force an in-flight commit | **Fixed.** A demo-only fault point (`commit.hold_after_wal`, enabled only under `FATHOM_DEMO_FAULTS=1`) holds the response for a fixed interval after the transaction commits. The kill lands on a committed, unacknowledged write. If the commit completes before the kill, the retry still returns `replayed: true`, and the line still holds. | §C.1 (270–300), §E.4 |
| C-5 | Fallback starts at current step with no revert or refusal rule | **Fixed.** Each recorded step has a precondition checkpoint. Replay starts at the most recent step boundary whose precondition holds, and re-issues the steps after it with their recorded idempotency keys, which return stored responses for steps already applied. If no boundary matches, replay refuses and names the divergence. | §C.3 |
| C-6 | Cognito does not offer RFC 8693 token exchange; local and AWS flows would differ in kind | **Fixed.** No token exchange. Humans use authorization code with PKCE. Each agent is its own OAuth client using client credentials, and the server maps the client to the agent principal and its owner. Both grants are offered by Keycloak and by Cognito user pools; the parity test asserts the claims the server reads. | §D.6, §E.2 |
| C-7 | Four to ten stateful services on a presenter laptop with no resource budget | **Fixed** for the set. **Accepted** for the budget: the stage profile lists six containers and one process, and the rehearsal records their resident memory. No figure is claimed. | §E.4 |

### Reviewer D (Agent and MCP Tooling Engineer)

| Ref | Finding | Disposition | Where |
|---|---|---|---|
| D-1 | `undo` missing from the catalogue though the closing beats use it | **Fixed.** `change.undo` is in the catalogue. It returns a plan, so its dry run is the plan itself. It is used in the 205–235 beat (the presenter reverts the agent's window change). | §D.8, §C.1 |
| D-2 | Replay determinism contradicted by the running feed | **Fixed** (same as C-1). | §C.3 |
| D-3 | Preview contract not uniform (only `metric.define` preview-capable) | **Fixed.** Every write is an operation inside a plan. `plan.preview` accepts every mutating operation kind, so previews are uniform. Two exemptions exist, `ui.focus` (no state change) and `approval.resolve` (human-only). The registry marks them, and the agent registration refuses any exemption. | §D.8 |
| D-4 | Start-at-current-step with no per-step state check; no name-binding scheme | **Fixed.** Per-step preconditions and postconditions (C-5). Name binding is stated: each step declares named outputs (`planId as $board`), and replay rebinds names from the responses. | §C.3 |
| D-5 | `build-board` and `investigate-spike` prompts given to the demo agent by name; no pre-registered pass criterion | **Fixed.** The server exposes no MCP prompts. The demo agent receives the short user prompts in §C.0 and nothing else. A no-prompt pass criterion is pre-registered in §F. | §C.0, §C.3, §F |
| D-6 | About ten kind-specific write verbs contradict "few verbs, typed kinds" | **Fixed.** Writes are `plan.preview`, `plan.commit` and `plan.discard`, with typed operation kinds described by `schema.describe`. A new kind needs no new tool. | §D.8 |
| D-7 | `spec.commit` returns `stale_base` as data, while the error list includes it | **Fixed.** `stale_base` is an error code with a `mergePreview` payload, inside the standard error envelope. | §D.8 |
| D-8 | Naming drift between script and catalogue (snake_case versus camelCase, `task.hold` absent) | **Fixed.** camelCase throughout. The script's calls are generated from the catalogue at recording time, and `fathom-replay verify` fails on any drift. `task.hold` is removed; the hold is a workflow signal. | §D.8, §C.3 |
| D-9 | `branch.merge` gives an agent no refusal or approval code; UI approval is a convention | **Fixed.** Merging into `live` returns `approval_required` to an agent. The agent may call `approval.request`, which creates an approval a human resolves with `approval.resolve`. Only human principals can resolve. | §D.6, §D.8 |
| D-10 | `query.run` has no default limit; `schema.describe` has no size budget | **Fixed.** `query.run` defaults to 1,000 rows and caps at 10,000. `schema.describe` is budgeted at 64 KB with explicit truncation. List operations page at 200. | §D.8 |

### Accepted limitations (summary)

- Wall-display rendering time is measured in rehearsal on the target display; no value is claimed (B-7).
- Attribution figures are expectations confirmed by rehearsal, not quoted values (C-2).
- Resident memory of the stage profile is measured in rehearsal, not claimed (C-7).
- The move operation of the tree CRDT is the highest technical risk. It is first in the cut list, and the demo does not depend on it (C-3).
- Agent wording and the number of tool calls a live agent makes vary between runs. The pre-registered criterion in §F is outcome-based for live runs, and exact for replay (D-5).

---

## A. Product concept

**What it is.** Fathom is a multi-user platform for building, sharing, operating and governing dashboards over live data. The demo shows four properties built to be checked by engineers:

1. **One document model.** A dashboard is a spec document: a tree of typed nodes (dashboards, panels, controls, parameters, links, layouts, alerts, workflows, annotations, comments). Spec documents are replicated and edited concurrently, and they are versioned, branchable and diffable like source code. Catalog and policy objects (metrics, grants, approvals) live in the same revision graph, so one history covers the whole system.
2. **One operation registry, one write protocol.** Every capability is an operation with a typed input schema, a typed output schema, a required permission, an audit category and a verdict function. The web UI, HTTP API, CLI and MCP server are generated from the registry. Every write, from any surface and by any principal, is a **plan**: previewed (diff, per-operation verdicts, cost), then committed by id against a base revision.
3. **A real query and transform engine.** Queries are a typed relational intermediate representation (IR), not strings. The IR is type-checked against units and column types, rewritten for row-level security and masking, planned, and executed on an embedded columnar engine (DuckDB) over Parquet. Every result carries its provenance: watermark, revision, binding hash and the hashes of the policy predicates that shaped it.
4. **An agent is a scoped principal.** An agent has its own identity, a human owner, a scope, and an effective authority equal to its scope intersected with its owner's current grants, evaluated per request. An agent's writes go through the same validation, authorization, audit and real-time paths as a human's. They land on agent branches and reach shared state only through a merge that a human approves.

**Who uses it.** Operations analysts build and share boards and act on alerts. Ops leads watch a wall display and approve workflows. Finance and compliance see the boards they are granted, restricted to the rows their role allows, and can audit who changed what. Platform engineers read the platform's own telemetry as a data source and verify the audit chain. Agents (in the demo, Claude Code over MCP) answer questions and assemble UI from the same primitives the humans use.

**What the demo data is about.** A fulfilment network: six warehouses (NE, SE, SW, NW, MW, CT), forty docks, twelve carriers, about 1,400 orders per simulated hour at baseline (a scenario parameter). The data is produced by `fathom-sim`, a deterministic discrete-event simulator written in Rust, seeded with a fixed integer. It models order stages (received, picked, packed, staged, handed over, delivered), queueing at docks and carrier pickup windows. It is not a paid service and it is not a recording. Given a seed, its output is byte-identical.

The scenario has one modelled fault: at scenario time 14:05 the carrier handoff rate at dock `NE-2` is throttled. Queues back up behind that dock and order latency rises. The platform never receives a label saying where the cause is. Attribution finds the contributor because the event data says so. The scenario also contains a **noise dock**, `SW-D07`, whose throughput varies randomly with no throttle, so that a contribution analysis has something to reject.

**Preloaded history.** A reset loads the simulated history up to scenario 14:20. The 14:05 spike is therefore already in the data when the presenter starts, and the live feed produces only events after 14:20. This removes the dependence of the demo's "why" answer on wall-clock progress.

**Platform self-data.** The platform publishes its own operational events (request latency, commit counts, feed lag, audit head) into a `platform` source through the same ingest path. An agent can therefore answer "what changed in the last hour" about the platform itself.

---

## B. Capability inventory

### B.1 Primitives

Status: **D** = demonstrated on stage. **S** = supporting: real, tested, reachable by the agent, shown only on request. Column "On-stage form" says whether the primitive has its own visible element (**own**) or appears only as a field or effect of another element (**field**).

| # | Primitive | Status | On-stage form | Technical significance | Composes with |
|---|---|---|---|---|---|
| 1 | Schema registry: versioned kinds, JSON Schema, invariants, upcasters | D | field | One type system; agents discover shapes from it; old revisions stay readable | all |
| 2 | Spec tree CRDT: insert, delete, property registers, fractional sibling order; move (cut 1) | D | field | Concurrent edits converge without locks; the same structure is the diff and merge substrate | 13, 14, 15, 26–28 |
| 3 | Revision store: content-addressed, immutable, DAG | D | field | Every state is addressable, comparable and restorable | 4, 14, 15, 16 |
| 4 | Refs and branches: named pointers with compare-and-swap | D | field | Agents work on branches; `live` is human-merged | 3, 13, 15 |
| 5 | Operation registry: one definition generates UI, HTTP, CLI, MCP | D | field | No capability exists on one surface only; checkable composition map | all |
| 6 | Principal: human, service, agent with owner ceiling | D | own | One identity model; agent authority is capped per request | 7, 8, 12 |
| 7 | Policy engine and grants (Cedar, default deny) | D | own | Single authorization engine; refusals name the policy that refused | 6, 8, 46 |
| 8 | Row-level security via IR rewrite, with masking hook | D | own | Finance sees finance rows through the same query path | 19, 20, 21 |
| 9 | Column masking | S | field | Sensitive columns return salted hashes to unprivileged viewers | 8 |
| 10 | Workspace isolation (policy plus storage prefix) | S | field | Tenant boundary for isolation, not a tested hostile-tenant boundary | 6, 7 |
| 11 | Operation log and realtime feed: HLC plus per-replica sequence | D | field | Resumable subscriptions; deltas with replica-scoped sequence numbers | 2, 41, 42 |
| 12 | Audit chain: hash-chained, same transaction as the change, anchored | D | field | Every change is attributable; chain verifies after failure | 11, 16, 17 |
| 13 | Plan: preview, commit, discard | D | own | The single write protocol for humans and agents | 14–18, 39 |
| 14 | Semantic diff over spec trees | D | own | Reviewers read intent ("panel moved"), not JSON | 2, 13, 15 |
| 15 | Three-way merge with atomic conflict sets | D | own | Disjoint changes merge; conflicting changes are refused, never auto-resolved | 4, 14 |
| 16 | Change undo: principal-scoped inverse, recorded as a new revision | D | own | Undo is itself audited; refuses rather than guesses | 12, 13 |
| 17 | Revert to revision (spec operation) | S | field | Restores a field or object from history | 3, 13 |
| 18 | Idempotency records with request hash | D | own | `replayed: true` on retry; 409 on key reuse with a different body | 13, 39 |
| 19 | Query IR and type checker with unit algebra | D | field | Hallucinated fields and unit errors fail before execution, with exact paths | 20, 22, 26 |
| 20 | Query explain and cost budget | D | field | Estimated scan bytes and row bound before execution | 19, 21 |
| 21 | Result provenance: watermark, revision, binding, predicate and mask hashes | D | own | Two windows agree only when they should; the UI states what it shows | 8, 19, 42 |
| 22 | Transform stages: bucket, window, rank, top_k, pivot, asof_join, ewma | D | field | Analytics composed inside the IR | 19, 24 |
| 23 | Incremental maintenance for aggregates and histograms (cut 2) | S | field | Live panels update from deltas; histograms retract late events | 11, 19 |
| 24 | Parameter: typed, bounded, bound into queries | D | field | One value model for filters, windows and thresholds | 25, 26, 31 |
| 25 | Control: select, segmented, range, bound to a parameter | D | own | The human input path into the engine | 24, 27 |
| 26 | Dashboard kind | D | own | The unit the audience sees built | 27–30 |
| 27 | Panel kind: query plus visualization mark | D | own | Visualization is declarative; agents write marks, not code | 19, 24, 25, 28 |
| 28 | Layout: grid-slot registers per panel | D | field | Arrangement without tree moves; concurrent slot edits are register conflicts | 27 |
| 29 | Template: a dashboard with declared parameters, instantiated as a plan | D | field | Reuse; agents instantiate rather than generate from nothing | 26, 24 |
| 30 | Link: typed navigation with parameter map and grant check | D | own | Navigation is an object; a link to an ungranted target shows as locked | 24, 26, 42 |
| 31 | Cross-filter: a selection writes a binding through focus | D | field | Interaction is an audited operation (cut 3 removes it) | 24, 42 |
| 32 | Metric: named query with unit, owner and certification | D | field | The shared vocabulary agents search and reuse | 19, 33, 35 |
| 33 | Lineage computed from IR references | D | field | Where a number comes from; read-filtered | 19, 32, 34 |
| 34 | Attribution: shift-share contribution with dominance verdict | D | own | The engine answers "why" from data; a no-cause verdict is a valid answer | 19, 32 |
| 35 | Impact analysis over lineage | S | field | Which dashboards and alerts a metric change touches | 33, 13 |
| 36 | Anomaly bands: rolling median and MAD | S | field | Deterministic, explainable, not a model | 22 |
| 37 | Alert rule: predicate over a query, `hold`, hysteresis, state machine, trace | D | own | Alerts are queries plus state; `alert.test` replays the state | 19, 38, 40 |
| 38 | Workflow: state machine with steps, signals, durable instances | D | own | Observable state transitions; state lives in the log | 37, 39, 40 |
| 39 | Approval: human-only resolution, applied under the approver | D | own | Human-in-the-loop enforced by policy, not by convention | 13, 38 |
| 40 | Action: typed external effect with allowlisted target and idempotency key | S | field | Effects are explicit; agents cannot invent destinations | 37, 38 |
| 41 | Presence: last-writer-wins per principal and object, 10 s expiry | D | own | Humans and agents visibly on the same object, read-filtered | 2, 11 |
| 42 | UI focus: permissioned, audited, rate-limited, per-session read check | D | own | "Things show on the screen" is a governed primitive | 21, 30, 41 |
| 43 | Annotation on a panel or time point | D | own | Evidence attached to the object it concerns | 27, 34 |
| 44 | Comments and threads | S | field | Review discussion; untrusted text envelope | 2, 43 |
| 45 | Catalog search over titles, descriptions and metric names | D | own | Agents find existing metrics before creating new ones | 32, 33 |
| 46 | Access explain: why a principal can or cannot do an action | S | field | Denials name the grant that would allow it | 7 |
| 47 | Export and scheduled report through the same query path | S | field | Exports respect RLS and masking because they use the same rewrite | 8, 40 |
| 48 | Embed token: signed, read-only, parameter-locked | S | field | Sharing outside the platform with the same policy | 7, 29 |
| 49 | Simulator feed: deterministic events from `fathom-sim` | D | own | The real data supply; live counters on the wall | 11, 50 |
| 50 | Ingest log: idempotent batches keyed by producer and sequence | S | field | Exactly-once effect despite producer retry | 49 |
| 51 | Platform self-source and health endpoints | D | own | The platform is observed by its own tools; status panel | 11, 12 |

### B.2 Composition map

The core is five things: the **spec tree and revision graph** (2–4), the **query IR and its checker** (19–21), the **operation registry** (5), the **policy engine with row-level rewrite** (6–8), and the **log with audit** (11, 12). Every other primitive is a composition of these.

```
                   operation registry (5): one definition -> UI, HTTP, CLI, MCP
                                  |
 principal (6) --> policy (7) --> rewrite (8) --> plan (13) --> spec tree (2) --> revisions, refs (3, 4)
                                     |               |                |               |
                                     v               v                v               v
                              verdicts per op   diff (14)     merge (15)      change undo (16)
                                                                   |
                 parameter (24) <-- control (25)           dashboard (26) / layout (28)
                      |                                           |
                      v                                           v
   query IR (19) <-- checker, explain (20) --> provenance (21)   panel (27) --> link (30), focus (42)
      ^      ^                                                     |
      |      +-- transforms (22) -- attribution (34) -- anomaly (36)
      |
   metric (32) --> lineage (33) --> impact (35)
      |
   alert (37) --> workflow (38) --> approval (39) --> action (40)
      |
   simulator (49) --> ingest (50) --> log (11) --> incremental maintenance (23)

   every write: principal + policy + plan + op log + audit (12) + realtime fan-out (11 -> websocket)
```

The composition rule: every arrow is a typed reference, and the same value serves several consumers. A panel's query is the IR value an alert, a metric, an export and a permission filter also use. A dashboard's diff is the diff a plan preview shows. An agent's `ui.focus` is the operation a human triggers by clicking a link. An approval applies the same operation the approver would have made.

### B.3 Demonstrated and supporting

On stage (D): 39 primitives. Of these, 23 have their own on-screen element (6, 7, 8, 13, 14, 15, 16, 18, 21, 25, 26, 27, 30, 34, 37, 38, 39, 41, 42, 43, 45, 49, 51) and 16 appear only as a field or effect of those elements (1, 2, 3, 4, 5, 11, 12, 19, 20, 22, 24, 28, 29, 31, 32, 33). The script shows no primitive it does not record a call for.

Supporting (S): 12 primitives (9, 10, 17, 23, 35, 36, 40, 44, 46, 47, 48, 50). They are real, tested and reachable by the agent, and the script does not show them.

Not modelled, stated plainly: panel-level visibility inside a granted board (grants are per object; rows are restricted by RLS), and multi-region replication.

---

## C. Five-minute live script

### C.0 Setting

Three browser windows are visible on one display, left to right: **Ops wall** (principal `human:ops-lead`, full-screen board), **Analyst** (principal `human:analyst`, the presenter's editing window) and **Finance** (principal `human:finance-viewer`, narrow). A fourth pane on the right is the **agent session**: a Claude Code terminal connected to the MCP endpoint `http://localhost:8080/mcp` (local) or `https://fathom.<domain>/mcp` (AWS), authenticated as the agent principal `agent:claude-code-demo`, owned by `human:analyst`.

Reset: `fathom demo reset --seed 1408` restores revision `demo-start`. That revision holds the dashboards, the metric `order_latency_p95` (unit `ms`, certification `certified`), the template `tpl_dock_drilldown`, the three roles, and simulated history through scenario 14:20. The feed is paused. `fathom demo start` at the beginning of the 0–30 s segment starts the feed at scenario 14:20, at 10 scenario seconds per real second.

Prompts the presenter types (no others are given to the agent; the server exposes no MCP prompts):

- P1 (30–70 s): `Find the order fulfilment metrics and sources that already exist before we create anything.`
- P2 (70–120 s): `Build an Order Operations board on branch agent/ops-board: p95 latency and orders per minute KPIs for the selected window, p95 by warehouse as a line chart, and a window control. Preview it, commit it, and show me the diff.`
- P3 (120–165 s): `Why did p95 order latency spike around 14:05? Use the data, not a guess, and put the evidence on the board.`
- P4 (165–205 s): `Make a drill-down for the dock that drives the spike: one panel per carrier, sharing the window control. Link the attribution bar chart to it. Commit on agent/drilldown.`
- P5 (205–235 s): `On agent/window-2h, set the carrier panel's default window to 2h. Commit it.`
- P6 (235–270 s): `Alert me if p95 latency is above 1500 ms for three minutes at any dock. Then give the finance viewer the ops board, through the ops lead's approval.`
- P7 (270–300 s): `Record the dock hold recommendation for approval, using idempotency key k-fault-hold-1.`

The agent is not told which dock is the cause. P4 names no dock. The agent must take it from the attribution result.

The presenter's own actions are the UI clicks named in §C.1. The agent never clicks.

### C.1 Timeline

Each beat lists the presenter's action, the MCP calls the agent is expected to make (in **bold**), the visible result, the primitives it demonstrates, and the transition. "Expected" means the rehearsal checks the outcome predicate given in §F, not a value quoted here.

**0–30 s. Purpose.** The presenter says: "Everything here is one document model, and an agent is a scoped principal on it." The Ops wall shows the platform status panel (51), the live counters (49) and the audit head advancing. The agent pane is idle.
- Capabilities: 49, 51, 12.
- Transition: the presenter types P1.

**30–70 s. Discovery.** P1 is typed.
- Expected calls: **`catalog.search {"q":"order fulfilment","kinds":["metric","source"]}`**, then **`object.get`** for the top three hits.
- Visible: the agent reports `order_latency_p95` with owner, unit `ms` and certification. Its three hits are highlighted in the Analyst window by **`ui.focus {"targets":[…],"mode":"highlight"}`**.
- Capabilities: 45, 32, 42.
- Transition: P2.

**70–120 s. Build and merge a board.** P2 is typed.
- Expected calls: **`schema.describe {"kind":"dashboard"}`**, then **`plan.preview {"branch":"agent/ops-board","base":"live","ops":[…]}`**, which returns a plan with nine creations, a clean validation, per-operation verdicts, and a cost (estimated scan bytes and row bound). Then **`plan.commit {"planId":"pln_…","expectedBaseRev":"rev_…","idempotencyKey":"k-ops-board-1"}`**.
- Human step: the Analyst window shows the diff as intent ("adds KPI row: two panels; adds control window; adds line chart"). The presenter clicks **Merge into live**. That is a human `plan.commit` on `live` by `human:analyst`, which the analyst is permitted to make.
- Visible: the board appears on the Ops wall. Its layout node carries a presence badge reading `agent (for analyst)`.
- Capabilities: 13, 14, 15, 26, 27, 28, 6, 41.
- Transition: P3.

**120–165 s. Why.** P3 is typed.
- Expected calls: **`query.explain`** on the p95 query; **`query.run {"groupBy":["warehouse","dock"],"window":"14:05–14:20","watermarkAtLeast":"14:20"}`**; **`attribution.run {"metric":"order_latency_p95","dims":["dock","carrier"],"baseline":"13:30–14:00","window":"14:05–14:20","watermarkAtLeast":"14:20"}`**; **`lineage.of {"object":"metric:order_latency_p95","direction":"down"}`**; then a plan on `agent/attribution` that creates an attribution panel (bar chart by dock) and an annotation at 14:05 on the board's line chart, committed as **`plan.commit`**.
- Human step: the presenter merges `agent/attribution`.
- Visible: the agent's answer names the top contributing dock, the top contributing carrier within it, and the attribution `id` and watermark it used. The answer is whatever the attribution returns. The noise dock `SW-D07` does not rank above the dominance threshold. The attribution panel and annotation appear on the Ops wall.
- Expectation confirmed by rehearsal: the top contributor is the throttled dock `NE-2`. The figures are recorded, not quoted.
- Negative control (not on stage, see §F): the same attribution run against the no-cause control workspace returns `verdict: "no_dominant_cause"`.
- Capabilities: 19, 20, 21, 34, 33, 43, 27, 13, 15.
- Transition: P4.

**165–205 s. Drill-down.** P4 is typed.
- Expected calls: **`object.get {"id":"tpl_dock_drilldown"}`**; **`plan.preview`** with a `create` of a dashboard from the template on `agent/drilldown`, three `create` panels (one per carrier), a `bind` of the window control to the shared parameter `window`, and a `create` of a link from the attribution bar chart to the drill-down with map `{"dock":"dock"}`; then **`plan.commit`**.
- Human step: the presenter merges `agent/drilldown` and clicks the top bar on the Ops wall. That click is a human `ui.focus {"mode":"bind","binding":{"dock":"<top dock>"}}`, delivered to every session that can read the drill-down. Both windows navigate with the dock bound.
- Visible: the navigation link on the board, and both windows on the drill-down with the same binding. The binding and the click are an audit entry.
- Capabilities: 29, 24, 25, 30, 42, 26, 27, 13, 15, 12.
- Transition: the presenter says "Now a second person edits the same board", then opens P5 and leaves the agent window.

**205–235 s. Disjoint edits and a merge.** The sequence has a fixed order and no race.
1. Before any human edit, the agent runs P5: **`plan.preview`** with an `update` of the carrier panel's `window` default from `1h` to `2h`, on branch `agent/window-2h`, based on the current `live` revision R1. **`plan.commit`** to that branch.
2. The presenter edits the drill-down panel's title on `live` to `NE-2 handoff`. This is a human write to a property register on `live`, revision R2.
3. The presenter clicks **Merge agent/window-2h into live**. The three-way merge has base R1, changes one property on each side (title on `live`, window default on the branch), and applies cleanly. The merge preview attributes each property to its author.
4. The Analyst window shows a chip, computed from that preview: `Agent proposed: window default 1h → 2h (agent for analyst)`. The presenter clicks **Undo**, which issues **`change.undo`** for the agent's change. Its dry run is a plan, shown as a diff. The presenter commits it. The inverse is recorded as a new revision, and the agent's original change stays in history.
- Visible: the title and the window default both applied in the merge, with named authors; the undo recorded in the audit pane.
- Capabilities: 16, 15, 14, 13, 12, 3, 4.
- Transition: the presenter opens the alert beat.

**235–270 s. Alert, schema self-correction, approval, row-scoped finance view.**
1. **`plan.preview`** with a `create` of kind `alert` on branch `agent/alerts`, carrying `for: "3m"`, is refused. The response is `unknown_field` at the path of `for`, with `valid_alternatives` listing the alert kind's fields. It has no `did_you_mean`, because the closest field is more than two edits away.
2. **`schema.describe {"kind":"alert"}`**, then the corrected plan with `hold: "3m"`, which validates. **`alert.test {"rule":…,"from":"13:30","to":"14:20"}`** returns the state transitions, including the firing at 14:05 if the data crosses the threshold (an expectation the rehearsal confirms). The presenter merges `agent/alerts`.
3. The agent previews a direct grant: **`plan.preview`** with `grant {"object":"dash:ops_board","to":"group:finance-viewer","role":"viewer"}` returns the verdict `scope_exceeds_owner`, with the owner's grant set as evidence. The owner, the analyst, lacks `acl:grant`.
4. The agent calls **`plan.preview`** with **`approval.request {"requestOp":{…the grant…},"reason":"finance review of ops board"}`**, which is permitted. It creates an approval and a workflow instance `grant-review` in state `waiting_approval`.
5. The ops lead clicks **Approve** on the Ops wall. That is a human `approval.resolve`. The grant is applied under `human:ops-lead`. The audit entry records `requestedBy: agent:claude-code-demo` and `onBehalfOf: human:analyst`.
6. The Finance window shows the ops board. Rows are restricted by RLS to the finance regions (SW and SE). The NE panel shows zero rows in scope, with the scope stated as "2 of 6 warehouses". The drill-down link is shown locked, with the `access.explain` reason `no_grant`.

- Visible: the schema error and the recovery; the alert with its trace; the refusal with its evidence; the approval card; the workflow moving from `waiting_approval` to `completed`; the finance view with its row scope.
- Capabilities: 37, 38, 39, 7, 8, 46, 6, 1, 13, 42.
- Transition: the presenter says "I'm going to take a server down while the agent writes."

**270–300 s. In-flight commit, kill, exactly-once.** The final 30 s carries three things only: a kill during an in-flight write, the agent's retry, and the audit verify.
1. P7 is typed. The agent calls **`plan.commit`** with `planId` for the `approval.request` that records the dock hold for approval, and `idempotencyKey: "k-fault-hold-1"`. The key prefix enables the demo fault point: the replica holds its response for a fixed interval after the transaction commits.
2. During that interval the presenter runs `kill -9` on one of the two `fathomd` replicas. The write is committed in Postgres, and the response is lost.
3. The agent's client retries the same request with the same key. The surviving replica answers with the stored response: the same revision, `replayed: true`, and one audit row for that revision.
4. The presenter runs `fathom audit verify`, which recomputes the chain and the anchors and reports them intact.
- Visible: the approval appears on the Ops wall as waiting for a human; the terminal shows `replayed: true` and the verify result; a status line shows the replica lost, the subscriptions resumed, zero delta gaps and zero duplicates (checked by the client's `(replica, seq)` ledger). The reconnect is shown only in that status line.
- Capabilities: 18, 11, 12, 39, 38, 51, 50.
- Transition: end.

If the commit has already completed before the kill (for example because the fault point was not reached), the kill still lands on a running system, and the retry still returns `replayed: true`. The line the presenter says holds in either case.

### C.2 Why the last 30 seconds are the strongest

The final 30 seconds show one property an engineer can ask about and check: an agent's retried write applies once, while the server it was sent to has died. The presenter says: "I just killed a server during the agent's write. It applied once, and the audit chain still verifies." Each part is visible: the `replayed` flag, the single audit row, the verify output and the status line.

### C.3 Fallback driver

The fallback is the real MCP path. It is not an animation, and its calls are not forged into the live transcript.

**Recording.** During rehearsal, `fathom-replay record` connects to the MCP endpoint as the agent principal and writes `demo/script/fallback-v1.jsonl`, one step per line. Each step records:
- the step name and its named outputs (for example `planId as $board`);
- the `tools/call` request, with arguments written as `$name` references where a value came from an earlier response;
- the response;
- a **precondition checkpoint** and a **postcondition checkpoint**. A checkpoint is the spec tree content hash of each ref the step reads or writes (`tree_root`, which excludes revision ids and wall time), the audit digest (a hash over the logical audit body: actor, on-behalf-of, action, target and resulting tree root, excluding timestamps and request ids), and, for panels read, the pair (watermark, value digest).

Recording fails if any recorded tool name or argument shape does not validate against the registry's current schema. This is the drift check of D-8.

**Feed gating.** The live feed runs at 10 scenario seconds per real second. Replay does not depend on wall time. `fathom-replay` advances the feed to each recorded watermark with `feed.until`, a demo-only admin operation that exists only under `FATHOM_DEMO=1`, that is absent from the agent's scope, and that is not in the agent's catalogue. Panel values are compared at equal watermarks only.

**Replay.** `fathom-replay play` runs the steps in order. Before each step it checks the precondition checkpoint against the current state. A mismatch is not an error at once. The replay steps back to the most recent step boundary whose precondition holds, and re-issues the steps after it with their recorded idempotency keys. Steps already applied return their stored responses with `replayed: true`. Steps not yet applied execute. If no boundary matches, replay refuses and prints the first divergent checkpoint. The presenter's recovery is then `fathom demo reset`, which returns the stage to `demo-start`.

**Switch.** The live agent is the default. The presenter presses `Ctrl+Shift+F`. The replay client stops reading the agent pane, starts at the current step by the rule above, and prints a labelled block in the agent pane:

`[RECORDED FALLBACK fallback-v1, steps 14–19]`

Each replayed call is prefixed with `[recorded]`. The label is visible to the audience. This is the honest form. The platform's screens update by the same operations and the same watermarks, so the label changes what the agent pane says and nothing else. The switch takes one keystroke. Replay latency is the platform's latency, measured in rehearsal, with no added delay.

**Triggers.** The presenter switches on any of three conditions: no tool call within the step's expected window; a tool error the agent does not correct on its second attempt; or a response that contradicts a recorded checkpoint (for example, the agent names a different dock as the top contributor).

**Rehearsal.** `fathom-replay verify` runs three checks:
1. The full recording replays in a headless browser (Playwright) with the feed gated. Every checkpoint must match exactly.
2. The control check: the attribution call from step 120–165 runs against the no-cause control workspace, and must return `no_dominant_cause`.
3. A live agent session runs against a freshly reset platform with the prompts in §C.0 and no other guidance. The pass criterion is in §F.

The script is accepted when all three pass.

---

## D. Technical architecture

### D.1 Components

| Component | Language and framework | Responsibility |
|---|---|---|
| `fathomd` | Rust (tokio, axum, tower) | One application binary: HTTP API, realtime gateway (WebSocket, SSE fallback), MCP server (Streamable HTTP and stdio), operation registry, plan engine, workers (alerts, workflows, schedules, exports), static web assets |
| `fathom-spec` | Rust crate, compiled to WASM for the browser | Spec tree CRDT, canonical JSON (RFC 8785), schema validation, semantic diff, three-way merge. The browser runs the same code, so client previews match server previews |
| `fathom-ir` | Rust crate | Query IR, parser for the text form, type checker, unit algebra, RLS rewrite, planner, lowering to DuckDB SQL |
| `fathom-policy` | Rust crate over `cedar-policy` | Entity model, policy set from the repository, decision function with reasons, owner-ceiling context |
| `fathom-ivm` | Rust crate | Incremental maintenance over ingest deltas (cut 2 removes it) |
| `fathom-sim` | Rust binary | Deterministic discrete-event simulator; produces ingest batches |
| `fathom-replay` | Rust binary, Playwright | Recording, gated replay, verification |
| `web` | TypeScript, React 18, Vite, Vega-Lite via vega-embed | Operator UI, generated from the registry's typed client |
| PostgreSQL 16 | Postgres | Metadata, revision store, op log, audit chain, plans, idempotency records, workflow instances, replica registry |
| DuckDB | Embedded in `fathomd` | Query execution over Parquet |
| Redpanda | Kafka protocol | Ingest log and the platform's change stream (cut 5 replaces it with a Postgres-backed feed) |
| MinIO | S3 protocol | Parquet segments, audit anchors with object lock |
| Keycloak | OIDC, OAuth clients | Human and agent identity locally |
| OpenTelemetry Collector, Jaeger | OTLP | Optional profile: traces |
| Mailpit | SMTP | Optional profile: the email action sink (not in the script) |
| Headless Chromium | Playwright | Rehearsal, and PNG exports |

Rust is the language of the core because the core is concurrency-heavy (commit ordering, subscriptions, IVM), must be deterministic, and benefits from exhaustive matching over IR and operation variants. TypeScript is the language of the UI. Postgres is chosen because transactional metadata, plans, idempotency and audit in one commit is the simplest correct design. DuckDB is an embedded, columnar, vectorised engine that reads Parquet directly, which removes a warehouse dependency from both deployments.

### D.2 Persistence model

```sql
CREATE TABLE object (                 -- content-addressed canonical JSON
  hash        bytea PRIMARY KEY,      -- BLAKE3 of canonical JSON
  kind        text NOT NULL,
  body        jsonb NOT NULL
);

CREATE TABLE revision (
  id          text PRIMARY KEY,       -- 'rev_' || BLAKE3(parents, tree_root, author, hlc)
  parents     text[] NOT NULL,        -- merges have two
  tree_root   bytea NOT NULL,         -- content hash of the spec tree snapshot
  author      text NOT NULL,
  hlc         bigint NOT NULL,
  message     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ref (
  workspace   text NOT NULL,
  name        text NOT NULL,          -- 'live', 'agent/ops-board', ...
  rev_id      text NOT NULL REFERENCES revision(id),
  version     bigint NOT NULL,        -- compare-and-swap counter
  PRIMARY KEY (workspace, name)
);

CREATE TABLE replica (                -- one row per process incarnation
  workspace   text NOT NULL,
  replica_id  text NOT NULL,          -- 'r-' || uuid, fresh at every boot
  started_at  timestamptz NOT NULL,
  last_seq    bigint NOT NULL DEFAULT 0,  -- allocated inside each writing transaction
  last_hlc    bigint NOT NULL DEFAULT 0,  -- monotonic across this replica's writes
  PRIMARY KEY (workspace, replica_id)
);

CREATE TABLE op_log (
  workspace   text NOT NULL,
  replica_id  text NOT NULL,
  seq         bigint NOT NULL,        -- contiguous per replica, no gaps (see D.5)
  hlc         bigint NOT NULL,
  op          jsonb NOT NULL,         -- Insert | Move | SetReg | Delete
  principal   text NOT NULL,
  PRIMARY KEY (workspace, replica_id, seq)
);

CREATE TABLE audit_head (             -- one row per workspace; the chain lock
  workspace   text PRIMARY KEY,
  seq         bigint NOT NULL,
  hash        bytea NOT NULL
);

CREATE TABLE audit_event (
  workspace    text NOT NULL,
  seq          bigint NOT NULL,       -- assigned under the audit_head lock
  actor        text NOT NULL,         -- human, service or agent principal
  on_behalf_of text,
  requested_by text,                  -- for approvals applied on an agent's request
  action       text NOT NULL,         -- registry operation id
  target       text NOT NULL,
  tree_root    bytea,                 -- spec tree content hash after the change
  request_id   text NOT NULL,
  at           timestamptz NOT NULL,
  prev_hash    bytea NOT NULL,
  hash         bytea NOT NULL,        -- SHA-256(prev_hash || canonical body incl. at)
  PRIMARY KEY (workspace, seq)
);

CREATE TABLE plan (
  id           text PRIMARY KEY,      -- 'pln_' || random
  principal    text NOT NULL,
  branch       text,                  -- null for plans without spec operations
  base_rev     text,
  base_version bigint,                -- ref version at preview
  ops          jsonb NOT NULL,        -- normalised operations
  diff         jsonb NOT NULL,
  verdicts     jsonb NOT NULL,        -- per operation: allowed | refused | approval_required, grant ids
  validation   jsonb NOT NULL,
  cost         jsonb NOT NULL,
  status       text NOT NULL,         -- previewed | committed | discarded | expired
  expires_at   timestamptz NOT NULL
);

CREATE TABLE idempotency (
  principal    text NOT NULL,
  key          text NOT NULL,
  request_hash bytea NOT NULL,
  response     jsonb NOT NULL,
  PRIMARY KEY (principal, key)
);

CREATE TABLE approval (
  id           text PRIMARY KEY,
  request_op   jsonb NOT NULL,        -- the operation to apply on approval
  requested_by text NOT NULL,         -- agent principal
  on_behalf_of text NOT NULL,         -- its owner
  state        text NOT NULL,         -- pending | approved | rejected
  workflow_id  text NOT NULL
);

CREATE TABLE workflow_instance (
  id          text PRIMARY KEY,
  definition  text NOT NULL,
  state       text NOT NULL,
  step        text NOT NULL,
  context     jsonb NOT NULL,
  version     bigint NOT NULL
);
CREATE TABLE workflow_event (workflow_id text, seq bigint, event jsonb,
  PRIMARY KEY (workflow_id, seq));
CREATE TABLE alert_state (rule_id text PRIMARY KEY, state text NOT NULL,
  since timestamptz NOT NULL, trace jsonb NOT NULL);
```

**Chain-head lock.** Every transaction that writes an audit event first runs `SELECT seq, hash FROM audit_head WHERE workspace = $1 FOR UPDATE`. It then writes the event with `seq + 1` and `prev_hash = hash`, and updates the head, all in the same transaction as the effect. Appends to one workspace's chain therefore serialise, and a rollback leaves neither a sequence gap nor a broken link. The cost is that writes to one workspace serialise on one row. That throughput is not measured here. The rehearsal records it.

**Replica identity.** A process has no identity until boot. At boot it inserts a new `replica` row with a fresh `r-<uuid>`. Its sequence numbers start at 1 under that id. A restart is a new replica, so no `(replica_id, seq)` pair is ever reused. The initial HLC is the maximum `hlc` in `op_log` for the workspace, so a new replica never orders before data that already exists.

Analytic data (object storage, Parquet): `events/<source>/dt=YYYY-MM-DD/hh=HH/<producer>-<seq>.parquet`. Each file's footer carries min and max `ts`, a producer id and a sequence range, which the planner uses for pruning and the ingest worker uses for idempotent replay.

### D.3 The spec language

A spec document is canonical JSON (RFC 8785) validated against its kind's schema. Kinds: `dashboard`, `panel`, `query`, `metric`, `control`, `parameter`, `link`, `layout`, `alert`, `workflow`, `template`, `annotation`, `comment`, `approval`.

Example dashboard, abridged. Fields are camelCase, matching the registry.

```json
{
  "schema": "fathom.dashboard/v1",
  "id": "dash_ops_board",
  "title": "Order operations",
  "params": {
    "window": { "type": "duration", "default": "1h", "allowed": ["15m", "1h", "6h", "24h"] },
    "dock":   { "type": "string", "default": null, "nullable": true }
  },
  "layout": {
    "grid": 12,
    "slots": {
      "p_kpi_p95":  { "row": 0, "col": 0, "span": 3 },
      "p_kpi_rate": { "row": 0, "col": 3, "span": 3 },
      "c_window":   { "row": 0, "col": 6, "span": 6 },
      "p_latency_by_wh": { "row": 1, "col": 0, "span": 12 }
    }
  },
  "panels": {
    "p_latency_by_wh": {
      "kind": "panel",
      "query": {
        "from": "events.order_stage",
        "where": [
          { "op": "eq",  "col": "stage", "val": "delivered" },
          { "op": "gte", "col": "ts",    "val": { "param": "windowStart" } }
        ],
        "transform": [ { "bucket": "ts", "by": "1m", "as": "minute" } ],
        "groupBy": ["minute", "warehouse"],
        "aggs": [ { "fn": "quantile", "q": 0.95, "col": "latencyMs", "as": "p95", "unit": "ms" } ],
        "order": [ { "col": "minute", "dir": "asc" } ]
      },
      "viz": { "mark": "line", "x": "minute", "y": "p95", "color": "warehouse" },
      "links": [ { "event": "select", "to": "dash:dock_drilldown", "map": { "warehouse": "warehouse" } } ]
    }
  },
  "controls": {
    "c_window": { "kind": "control", "widget": "segmented", "bind": "window" }
  }
}
```

Three decisions matter for composability:

1. **The query is data.** `where`, `transform`, `groupBy` and `aggs` are IR nodes. A panel, an alert predicate (`{"query": …, "over": "p95", "gt": 1500}`), a metric and an export all reference the same IR. Lineage is computed by walking these references.
2. **Parameters are typed.** `{"param": "windowStart"}` is checked against `window`, a duration converted to a timestamp by an IR expression. A string where a duration is expected is a type error with a path.
3. **Layout is slots.** Each panel has a grid-slot register. Moving a panel is a register write, not a tree move. The tree never has to reparent a node to rearrange a dashboard.

Errors are structured and designed for self-correction:

```json
{
  "error": {
    "code": "unknown_field",
    "path": "/ops/0/body/aggs/0/fn",
    "message": "unknown aggregate function 'p95'",
    "got": "p95",
    "valid_alternatives": ["count", "sum", "avg", "min", "max", "quantile", "distinct"],
    "did_you_mean": "quantile",
    "hint": "use {\"fn\":\"quantile\",\"q\":0.95}",
    "retryable": false
  }
}
```

`did_you_mean` is produced only when the closest valid name is within edit distance two. Otherwise the error carries `valid_alternatives` and no suggestion. The alert case in §C.1 relies on this rule.

### D.4 Query and transform engine

Pipeline: **parse, resolve, type-check, authorise, rewrite, plan, execute, tag.**

- **Parse.** JSON IR or the text form (`from events.order_stage | where stage = "delivered" | …`). Both compile to the same IR.
- **Resolve.** Names resolve against the catalog. Unknown names produce `unknown_field` with a suggestion only under the rule in D.3.
- **Type-check.** Every expression has a type (`int`, `float`, `string`, `timestamp`, `duration`, `ratio`, `quantity<unit>`). The unit algebra rejects `ms + orders/min`, and `quantile` over a non-numeric column is refused.
- **Authorise.** The caller's effective grants are checked against each source and column. A denial names the grant that would allow the query.
- **Rewrite.** Row predicates bound to the caller's attributes are conjoined into `where` before planning. Masking replaces masked columns in projections. The rewrite runs before any optimiser pass, so no pass can push a query past a predicate it should not see.
- **Plan.** Partition pruning on `ts`, pushdown into Parquet row-group statistics, and a row bound from catalog cardinality. `query.explain` returns the plan, the estimated scan bytes, and whether the caller's budget admits it.
- **Execute.** Lowered to DuckDB SQL. Live panels are maintained by `fathom-ivm` where cut 2 has not removed it, and recomputed at most once per watermark tick otherwise.
- **Tag.** The result carries `{watermark, revId, bindingHash, predicateHash, maskHash, rowCount, scannedBytes, truncated}`.

**Result key.** A result is a function of `(watermark, bindingHash, revId, predicateHash, maskHash)`. Two windows with the same principal, binding and revision get identical results. Two principals with different RLS predicates get different keys, even on the same dashboard. This is what makes the claim "two windows agree" precise: they agree when their keys agree, and `query.explain` prints the key.

**Watermarks.** `watermarkAtLeast` on `query.run` and `attribution.run` makes the call fail with `watermark_not_reached` and a `retryAfterMs` until the data watermark has passed the given time. A question about a window is therefore never answered from partial data.

**Limits.** `query.run` defaults to 1,000 rows and caps at 10,000 (design parameters). A panel is capped at 1,500 series points. The plan's cost field reports the cap that applied.

**Incremental maintenance.** `count`, `sum`, `avg`, `min` and `max` over a window are maintained by deltas. `quantile` uses fixed-bucket histograms (log-linear boundaries, 1,024 buckets over 1 ms to 1 h, a design parameter). Histograms retract late events, which t-digest cannot. The bucket width sets a bounded relative error, which the panel tooltip prints. A value above the histogram range is clamped and marked. Attribution is a batch query and is not maintained.

### D.5 Real-time transport and collaborative editing

**Transport.** One WebSocket per client, multiplexing subscriptions. A subscription is `{object, binding, fromCursor}`. A cursor is a map from replica id to the last sequence delivered from that replica. The server pushes `delta` messages carrying `(replicaId, seq, hlc)`, and `result` messages carrying the result key of §D.4.

**Delivery rules.** The delivery guarantee is at-least-once. The client deduplicates by `(replicaId, seq)` and applies each delta once. Gap-freedom is a property of the log, not of the transport. A sequence number is allocated by an update of the `replica` row inside the transaction that writes the op. A rolled-back transaction therefore leaves no hole. The op is published only after its commit. A replica that dies leaves each of its sequence numbers either committed and published or never allocated. If a client's cursor lags past compaction, the server sends `resync` with a snapshot and the new cursor. Reconnect resends the cursor, and the server replays from the log. Redpanda carries the live stream, and Postgres serves older replay. SSE carries the same message types where WebSockets are blocked.

**Collaborative editing.** The spec tree is a tree CRDT (move-capable, with cycle detection, cut 1 removes moves). Its structure is:

- **Sibling order** by fractional indices, so concurrent inserts between the same neighbours do not conflict.
- **Properties** as last-writer-wins registers ordered by HLC, with replica id as tie-breaker.
- **Concurrent writes to one register** produce a `concurrentWrite` annotation. The UI shows it as a chip naming both authors. The loser's value stays in the op log and can be restored with `change.undo`.
- **Deletes** as tombstones, kept for longer than the maximum offline interval of any client.

**Live and branches.** `live` accepts writes from human principals through the CRDT. Agents never write `live`. Every agent write is a plan on an agent branch. Reaching `live` is a merge, and a merge is a three-way merge over the revision graph with an atomic conflict set:

- Disjoint changes merge cleanly, and the merge preview attributes each property to the principal that changed it.
- Changes to the same register on both sides are a conflict. The merge is refused with the conflict set, and nothing is applied. Nothing is auto-won.

The rule that the agent never writes `live` is enforced by policy (§D.6), not by the UI.

**Presence.** Presence is an ephemeral last-writer-wins state per principal and object, expiring after 10 seconds, on the same socket. An agent's presence reads `agent (for <owner>)`. Presence entries are filtered by the caller's read check, as §D.8 requires for every read-side operation.

### D.6 Authorization model

**Entities.** `Human`, `Agent` (with `owner: Human` and `scope: Set<String>`), `Group`, `Workspace`, `Object` (any spec node or catalog object, in the hierarchy of its workspace), `Source`, `Column`, and the registry operation as `Action`.

**Schema fragment and policies.** These are the corrected examples. Schema:

```cedar
entity Human;
entity Agent { owner: Human, scope: Set<String> };
entity Workspace;
entity Object in [Workspace];

action "plan.commit" appliesTo {
  principal: [Human, Agent],
  resource: [Workspace],
  context: { targetRef: String }
};
action "acl.grant" appliesTo {
  principal: [Human, Agent],
  resource: [Object],
  context: { role: String, ownerCanGrant: Bool }
};
```

Policies. Default deny, so no forbid is needed:

```cedar
// Agents commit to agent branches only. Writes to live are human-only.
permit (
  principal is Agent,
  action == Action::"plan.commit",
  resource in Workspace::"ws_demo"
)
when { principal.scope.contains("spec:branch") && context.targetRef != "live" };

// An agent may grant only what its owner may grant right now.
// ownerCanGrant is computed by the server from the owner's current grants,
// per request. The caller cannot supply it.
permit (
  principal is Agent,
  action == Action::"acl.grant",
  resource in Workspace::"ws_demo"
)
when { principal.scope.contains("acl:grant") && context.ownerCanGrant };

// Humans with the grant permission may grant.
permit (
  principal is Human,
  action == Action::"acl.grant",
  resource in Workspace::"ws_demo"
)
when { context.ownerCanGrant };
```

For a human, `ownerCanGrant` is the human's own grant check; for an agent, it is the owner's. The agent's direct `acl.grant` in §C.1 is refused because its owner lacks the grant, which is what `scope_exceeds_owner` reports.

**Agent as scoped principal.** An agent principal is an OAuth client with a registered owner and a scope. Its effective authority is `scope ∩ owner's current grants`, evaluated on every request. Consequences the demo relies on:

- An agent cannot grant access its owner does not have (`scope_exceeds_owner`).
- If the owner loses a grant, the agent loses it at the next request, not at token expiry.
- Every agent request is audited with `actor = agent:<id>` and `onBehalfOf = human:<id>`.
- Approvals applied on an agent's request are audited with `actor` = the approver and `requestedBy` = the agent.

**Merge authority.** `branch.merge` into `live` is a plan operation. For an agent it returns `approval_required` (§D.8). Human principals with `branch:merge` on `live` may commit it directly.

**Authentication flows.** Humans sign in with OIDC authorization code and PKCE. Each agent is its own OAuth client using the client credentials grant, with a short access-token lifetime of five minutes, refreshed by the MCP client. The server maps the client identifier to the agent principal and its owner from the registry. The token does not need to carry the owner, because ownership is checked per request. There is no token exchange, so the flow does not depend on an exchange grant that one identity provider lacks. Agent tokens are rejected on UI routes.

**Row-level security.** Row predicates are IR expressions stored in `rls/<table>.json`, bound to attributes (for example `warehouse in principal.attrs.regions`). Cedar governs who may attach a predicate to a role. The engine applies it, and the predicate's hash appears in every result key (§D.4) and in `access.explain`.

### D.7 Audit, versioning and undo

- **Audit.** Each mutating transaction appends one audit event under the chain-head lock (§D.2). The chain hash includes the event timestamp, so the stored chain is the chain of record. Each hour and on each `fathom audit verify`, the head is written to object storage with object lock. Verify recomputes the chain and checks the anchors.
- **Audit digest.** Replay compares a different value: the audit digest, a hash over the logical bodies (actor, on-behalf-of, requested-by, action, target and resulting tree root) with timestamps and request ids excluded. Two runs that perform the same operations in the same order produce the same audit digest. This is the value a checkpoint records.
- **Versioning.** Every committed change is a revision. Revisions are immutable and content-addressed. `history.list` and `diff.semantic` address any two revisions.
- **Branches and merges.** `branch.create`, `branch.merge` and `branch.delete` are plan operations with previews. A merge applies all of its changes or none of them.
- **Undo.** `change.undo` builds the inverse of a principal's change, as a plan. It refuses when a later concurrent write has overwritten the register, and it names the blocking revision. A principal may undo its own changes. An agent's owner may undo changes made on the agent's behalf. Undo never rewrites history, and it is audited as `change.undo`.

### D.8 The MCP server

#### Design principles

1. **Few verbs, typed kinds.** Writes go through three verbs (`plan.preview`, `plan.commit`, `plan.discard`) whose operations are typed by kind. Reads go through a small set of verbs over any kind. A new kind is usable without a new tool.
2. **One write protocol.** Every mutating operation is an operation inside a plan. A commit must cite a plan. A commit without a preview is refused with `preview_required`. The two registry exemptions are `ui.focus` (no state change) and `approval.resolve` (human-only). Agent registration refuses any exemption.
3. **Errors are instructions.** Every error has a closed-enum code, a JSON pointer path, the offending value, valid alternatives where they exist, a hint, and `retryable`.
4. **Idempotency where effects happen.** `plan.commit` and every operation that creates an approval require an idempotency key.
5. **Tool results are data.** Free-text fields are returned in an explicit envelope marked untrusted.
6. **Names are camelCase** throughout the catalogue, the schemas and the recorded script.

#### Tool catalogue

Twenty tools. Signatures are TypeScript-style for compactness. The authoritative definitions are JSON Schema generated from the registry.

```ts
// Discovery (read-filtered)
catalog.search(input: { q: string; kinds?: Kind[]; limit?: number /* default 20, max 50 */ })
  -> { hits: { ref: ObjectRef; kind: Kind; title: string; score: number }[]; untrusted: ["title"] }
schema.describe(input: { kind: Kind; op?: OpKind })
  -> { jsonSchema: object; invariants: string[]; examples: object[]; commonErrors: ErrorCode[];
       truncated: boolean /* budget 64 KB */ }
session.describe(input: {})
  -> { principal: PrincipalInfo; owner?: PrincipalInfo; scope: string[]; effectiveGrants: Grant[];
       budgets: Budget; refs: Ref[]; outstandingPlans: PlanSummary[] }
presence.list(input: { object: ObjectRef })
  -> { entries: { principal: string; onBehalfOf?: string; node?: string; since: string }[] }

// Objects and history (read-filtered)
object.get(input: { ref?: string /* default live */; id: ObjectRef; depth?: number /* default 1 */ })
  -> { node: SpecNode; revId: RevId }
object.list(input: { kind: Kind; parent?: ObjectRef; ref?: string; limit?: number /* default 50, max 200 */; cursor?: string })
  -> { items: ObjectSummary[]; next?: string }
history.list(input: { ref: string; limit?: number /* default 20, max 100 */; before?: RevId })
  -> { revisions: { id: RevId; author: PrincipalId; onBehalfOf?: string; message?: string; at: string }[] }
diff.semantic(input: { from: RevId | string; to: RevId | string })
  -> { changes: SemanticChange[]; conflicts?: Conflict[] }

// Analysis (read-only, read-filtered, budgeted)
query.explain(input: { query: IR | string; binding?: Record<string, unknown> })
  -> { plan: PlanNode; estimatedScanBytes: number; rowBound: number; budgetOk: boolean;
       resultKey: { predicateHash: string; maskHash: string; bindingHash: string } }
query.run(input: { query: IR | string; binding?: Record<string, unknown>;
                   limit?: number /* default 1000, max 10000 */; watermarkAtLeast?: string })
  -> { rows: Record<string, unknown>[]; rowCount: number; truncated: boolean;
       watermark: string; revId: RevId; bindingHash: string; predicateHash: string; maskHash: string;
       untrusted: string[] }
attribution.run(input: { metric: MetricRef; dims: string[] /* max 3 */; baseline: TimeRange;
                         window: TimeRange; threshold?: number /* default 0.5 */; watermarkAtLeast?: string })
  -> { id: string; method: "shift-share"; verdict: "dominant" | "no_dominant_cause";
       contributions: { dims: Record<string, string>; share: number; delta: number }[];
       watermark: string }
lineage.of(input: { object: ObjectRef; direction: "up" | "down" | "both"; depth?: number /* max 6 */ })
  -> { nodes: ObjectRef[]; edges: { from: ObjectRef; to: ObjectRef; via: string }[] }
alert.test(input: { rule: AlertRule | ObjectRef; from: string; to: string })
  -> { transitions: { at: string; from: AlertState; to: AlertState; value: number }[] }
audit.search(input: { since?: string; actor?: PrincipalId; action?: string; target?: ObjectRef;
                      limit?: number /* default 50, max 200 */ })
  -> { events: AuditEvent[]; chainHead: string; untrusted: string[] }
access.explain(input: { principal: PrincipalId; object: ObjectRef; action: string })
  -> { allowed: boolean; reasons: PolicyReason[]; rlsPredicates: IR[]; predicateHash: string }

// Writes (every write is a plan)
plan.preview(input: { branch?: string; base?: string; ops: Op[] })
  -> { planId: string; expiresInSeconds: 300; baseRev?: RevId; diff: SemanticChange[];
       verdicts: { index: number; verdict: "allowed" | "refused" | "approval_required";
                   code?: ErrorCode; grantIds: string[] }[];
       validation: "clean" | ValidationError[]; cost: { estimatedScanBytes: number; rowBound: number } }
plan.commit(input: { planId: string; expectedBaseRev?: RevId; idempotencyKey: string; message?: string })
  -> { revId: RevId; ref: string; refVersion: number; replayed: boolean }
plan.discard(input: { planId: string })
  -> { status: "discarded" }
change.undo(input: { change: RevId | string /* semantic change id */; idempotencyKey?: string })
  -> { planId: string; diff: SemanticChange[]; refused?: { code: ErrorCode; blockingRev?: RevId } }

// Presentation (exempt from plans; no state change)
ui.focus(input: { targets: ObjectRef[]; mode: "highlight" | "navigate" | "bind"; binding?: Record<string, unknown> })
  -> { delivered: number; sessions: string[]; skipped: { target: string; reason: "no_read" | "rate_limited" }[] }
```

**Operation kinds** (the `ops` vocabulary of `plan.preview`) are described by `schema.describe {"kind": "plan"}`. They are:

- `create {kind, parent?, body}` for any kind: dashboard, panel, control, parameter, link, metric, alert, template instance, annotation, workflow definition;
- `update {ref, patch}`, `delete {ref}`, `reorder {ref, after}` (fractional index), `bind {control, parameter}`;
- `move {ref, parent}` (cut 1 removes it);
- `revert {object, field?, toRev}`;
- `branch.create {name, from}`, `branch.merge {from, into}`, `branch.delete {name}`;
- `grant {object, to, role}`, `revoke {object, to, role}`;
- `approval.request {requestOp, reason}`;
- `workflow.start {definition, context}`, `workflow.signal {workflowId, signal, payload?}`.

An example `create` operation, from the board in §C.1:

```json
{ "op": "create", "kind": "panel", "parent": "dash:ops_board/layout",
  "body": { "query": { "...": "IR, as in D.3" },
            "viz": { "mark": "line", "x": "minute", "y": "p95", "color": "warehouse" } } }
```

**Approval operations.** `approval.request` creates an `approval` object in state `pending` and a `grant-review` (or other) workflow instance in `waiting_approval`. `approval.resolve {approvalId, decision: "approve" | "reject"}` is human-only and is not in the agent's registration. On approval, the `requestOp` is applied under the approver's principal, with `requestedBy` and `onBehalfOf` recorded in the audit event.

**Resources.** Read-only, with the same read filtering:

| URI | Content | Notes |
|---|---|---|
| `fathom://catalog` | catalog tree, paged | cached by watermark |
| `fathom://schema/{kind}` | JSON Schema, invariants, examples | same as `schema.describe` |
| `fathom://object/{ref}/{rev}/{id}` | object at a revision | immutable for a given revision |
| `fathom://audit/{cursor}` | audit page | read-only |
| `fathom://session/current` | the principal's grants, budgets, outstanding plans | for checking state after a failure |

**Discovery.** An agent discovers capabilities in three layers: `tools/list` (twenty verbs, one-line descriptions each stating its precondition), `schema.describe` (kind and operation shapes, invariants, examples, common errors, within budget), and `catalog.search` (what exists). Validation errors name valid alternatives from the registry, so a wrong field name comes back with the valid names in the same response.

**Plan lifecycle.** A plan is a server-side object with a 300-second expiry, holding normalised operations, diff, verdicts, validation and cost. Commit checks that the plan is unexpired, that every spec operation's base is the plan's base, and that each target ref's version equals the version at preview. Then it applies all operations in one transaction, writing the audit events and the revision together, and publishes deltas after commit.

Failure is an error, never data:
- `plan_expired`, with the expiry time;
- `stale_base`, with `mergePreview`: the three-way merge of the plan against the new head, and the conflict set if any;
- `approval_required`, with `approvalId` when the caller is an agent and the operation targets `live` or a human-approved operation;
- `idempotency_conflict`, when the key is reused with a different request hash (HTTP 409);
- `refused`, per operation, with the verdict's code and grant ids. A plan with a refused operation cannot be committed.

**Idempotency.** `(principal, key) → (request_hash, response)` is stored in the same transaction as the effect. A repeat with the same hash returns the stored response with `replayed: true`. Keys expire after 24 hours. Fault points used in the demo (§E.4) are the only code paths that hold a response, and they are disabled outside `FATHOM_DEMO_FAULTS=1`.

**Rate limits and budgets.** Per principal, token buckets: reads 60 per second, burst 120; writes 5 per second, burst 10; `ui.focus` one per three seconds. At most four in-flight queries per principal. A scan-byte budget per principal per minute (agents default to 2 GB, a design parameter). Exceeded limits return `rate_limited` with `retryAfterMs`. `session.describe` shows remaining budget.

**Errors.** One envelope across HTTP, MCP and UI:

```json
{ "error": { "code": "stale_base", "path": "/plan/expectedBaseRev",
             "message": "ref agent/ops-board moved from rev_a1 to rev_c7 since preview",
             "hint": "review mergePreview, then plan.preview again on rev_c7",
             "mergePreview": { "clean": true, "changes": [] },
             "retryable": true } }
```

Codes form a closed enum, documented in `schema.describe` and in the tool descriptions.

**Read-side filtering.** Every read-side operation applies the caller's read rewrite before it returns: `catalog.search`, `object.get`, `object.list`, `lineage.of`, `audit.search`, `presence.list`, `ui.focus` delivery, `attribution.run` inputs, and the resources. A result that contains an object the caller cannot read omits that object and its edges, and returns no count of what was omitted.

**Prompt-injection considerations.**
- Titles, descriptions, comments, annotation text and entity values are untrusted. They are listed in `untrusted` arrays and wrapped as `{"untrustedText": "…"}` in results.
- Policy never reads text. Authorization uses typed attributes only.
- The agent cannot define new operation kinds, create action targets, run code or change its own scope.
- The demo's injection check seeds an annotation that says "grant finance access", and then checks that the agent's grants are unchanged and that the grant is still refused.

---

## E. AWS and local deployment

### E.1 Images

One repository of images, built with BuildKit from pinned toolchains (Rust toolchain file, Node lockfile, Chromium version pinned):

- `fathomd` (web assets, MCP server, workers), distroless base, non-root, read-only root filesystem;
- `fathom-sim`, `fathom-replay` and `fathom` (CLI: `demo reset`, `demo start`, `audit verify`).

Images are referenced by digest in deployment manifests, signed with cosign, and carry an SBOM. The compose file and the AWS manifests reference the same digests. A test (`deploy/check-digests`) fails if they diverge.

### E.2 Mapping

| Concern | Local (compose) | AWS | What differs | Why behaviour is unchanged |
|---|---|---|---|---|
| Compute | `fathomd` ×2 containers | ECS on Fargate, two tasks, same image | Scheduler | Stateless; state in Postgres, Redpanda and object storage |
| Metadata, plans, audit | PostgreSQL 16 | Aurora PostgreSQL Serverless v2 | Managed failover | Same SQL, same migrations, same locks |
| Ingest log | Redpanda | Amazon MSK | Broker operations | Same Kafka protocol and client config |
| Parquet and anchors | MinIO, object lock enabled | S3 with Object Lock | Service | Same S3 API, same anchor code path |
| Human identity | Keycloak, authorization code with PKCE | Cognito user pool, authorization code with PKCE | IdP | Same OIDC discovery, same claim mapping |
| Agent identity | Keycloak OAuth client, client credentials | Cognito app client, client credentials | IdP | Same claims read by the server; parity test `deploy/auth-parity` checks them |
| Authorization | `cedar-policy` in-process, policies from repo | identical | None | No second engine; no managed policy service |
| Edge and TLS | Local TLS not used on stage; optional Caddy profile | ALB with ACM certificate, HTTP/2 and WebSocket | Certificate handling | Same routes, same `/mcp` path |
| Web delivery | Served by `fathomd` | CloudFront in front of the same origin | Caching | Same asset hashes |
| Email | Mailpit (optional profile) | Amazon SES | Sender reputation | Same SMTP interface |
| Snapshots | Headless Chromium container | Same container on ECS | None | Same image |
| Telemetry | OTel collector to Jaeger (optional profile) | OTel sidecar to CloudWatch and X-Ray | Backend | Same OTLP export |
| Secrets | `.env` for local development only, not committed | Secrets Manager | Source | Same environment variable names |
| Infrastructure as code | Compose file | OpenTofu modules | Tooling | Same service names |

The local deployment runs two replicas, the same migrations, the same audit locks, the same anchoring, and the same identity flows. The differences are operational. Each is listed in `docs/deployment-differences.md` with the test that covers its behaviour.

### E.3 MCP exposure

- **Local.** `http://localhost:8080/mcp`, Streamable HTTP, bearer tokens from Keycloak. stdio mode (`fathom mcp --stdio`) for clients that prefer it.
- **AWS.** `https://fathom.<domain>/mcp` behind the ALB. The ALB does not authenticate. `fathomd` validates tokens against the issuer's JWKS, so behaviour is the same.
- **Both.** Agent tokens are five minutes long, scoped to the agent client, rejected on UI routes. Every MCP session has an id, which is written into the audit event's `requestId`.

### E.4 Stage profile and what the script touches

A stage run needs these services, and nothing else:

| Service | Used by the script for |
|---|---|
| `fathomd` ×2 | serving the UI and the MCP endpoint; the replica killed at 270–300 s |
| PostgreSQL | every write, plan, idempotency record and audit event |
| Redpanda | the live feed and the change stream to the browsers |
| MinIO | Parquet segments read by the queries; anchors written by `audit verify` |
| Keycloak | the three human logins and the agent client |
| `fathom-sim` (one process) | the live feed from scenario 14:20 |

Not used by the script, and therefore not in the stage profile: Caddy, Jaeger and the OTel collector (telemetry profile), Mailpit (no email in the script), Chromium (rehearsal and exports only). The stage profile is six containers and one process. Its resident memory is recorded in rehearsal and is not claimed here.

Fault points: `commit.hold_after_wal` (holds the response for a fixed interval after commit, for keys with the prefix `k-fault-`) and `feed.until` (replay only). Both exist only under `FATHOM_DEMO=1` or `FATHOM_DEMO_FAULTS=1`, which the stage profile sets and the AWS profile does not.

---

## F. Five strongest technical claims

Each claim has an executable test or an observable behaviour, and the stack gate runs the test. Each claim states what it proves and what it does not.

**Claim 1. The spec tree converges under concurrent insert, delete and register edits.**
*Test.* `fathom-spec/tests/convergence.rs`: a property test with three replicas and 10,000 generated operations (insert, delete, property write, slot write), delivered in random order with duplication and delay. It asserts that after full exchange all replicas have identical `tree_root`s and identical materialised documents. With moves enabled (not cut), it also asserts that no move creates a cycle.
*Observable.* The merge preview's per-property authorship on the window-default merge (§C.1, 205–235).
*Does not prove.* Convergence under human-human concurrency on a live dashboard for a population of users. It proves the algorithm, not the product usage.

**Claim 2. An agent cannot exceed its owner's authority, enforced on the MCP path, and owner revocation takes effect at the next request.**
*Test.* `e2e/mcp/agent-scope.test.ts`: an agent owned by `analyst`, who lacks `acl:grant`, calls `plan.preview` with a `grant`. The test asserts verdict `scope_exceeds_owner`, no grant row, an audit event with `actor = agent:*` and `onBehalfOf = human:analyst`, and that after revoking one of the owner's grants, the agent's next `plan.preview` is refused without a new token.
*Observable.* The refusal and the evidence at 235–270 s.
*Does not prove.* Protection against a compromised owner account.

**Claim 3. A commit applies once under retry, and concurrent commits to one branch are compare-and-swap safe, through MCP.**
*Test.* `e2e/mcp/commit-idempotency.test.ts`: two agent sessions preview against the same base and commit concurrently with different keys. Exactly one commit succeeds and the other returns `stale_base` with a merge preview. A repeat of the winner's request returns `replayed: true`, the same revision, and one audit event for that revision. A request with the same key and a different body returns `409 idempotency_conflict` and applies nothing.
*Observable.* `replayed: true` and the single audit row in the final 30 s.
*Does not prove.* Exactly-once across process death. Claim 5 covers that.

**Claim 4. Query results equal a reference evaluator, and row-level security is enforced by rewrite, with the predicate in the result key.**
*Test.* `fathom-ir/tests/differential.rs`: 5,000 generated IR queries over a fixed dataset of two million rows, evaluated by DuckDB lowering and by a naive in-memory reference evaluator, compared row for row (floating-point aggregates within the stated histogram error bound). A second property, for principal `finance-viewer`, asserts that no returned row violates the RLS predicate, including queries that project away, sort by, or group by the predicate column. A third asserts that changing the predicate changes `predicateHash`, and that results with different keys are never served from one cache entry.
*Observable.* The finance view's scope line (2 of 6 warehouses) and the locked link's reason at 235–270 s.
*Does not prove.* Correctness of the policy author's intent. It proves that the rewrite applies the stored predicate on every path.

**Claim 5. A killed replica loses no committed delta, applies no commit twice, and leaves the audit chain verifiable.**
*Test.* `e2e/chaos/kill-resume.spec.ts`: during a live `fathom-sim` run, an agent commit with a fault-point key is in flight. The test sends `SIGKILL` to one replica while the response is held, and the client retries against the other replica. It then asserts:
- (a) the commit is applied exactly once: one revision, one audit event, `replayed: true` on the retry;
- (b) every open browser subscription receives each `(replicaId, seq)` exactly once, and each replica's sequence is contiguous within the delivered stream (checked by the client's ledger);
- (c) `fathom audit verify` passes, and the anchor written before the kill matches the chain;
- (d) the audit digest after the run equals the digest recorded for the same operations in rehearsal.
The test runs against kill points chosen at random within the hold, repeated 20 times.
*Observable.* The status line and the verify output at 270–300 s.
*Does not prove.* Survival of a loss of the database, or of every replica at once.

---

## G. Failure analysis

### G.1 Implementation difficulties

1. **Tree CRDT with moves (cut 1).** Concurrent moves can create cycles, and a naive implementation drops subtrees silently. The mitigation is the published move algorithm with cycle checks on apply. The demo does not need moves, because layout is slot registers, so moves are the first thing cut if the convergence test fails on them.
2. **Quantiles under maintenance (cut 2).** t-digest is accurate but cannot retract. Histograms retract but have a bounded error and a fixed range. The design accepts and prints the error. A value above the range is clamped and marked.
3. **Clock skew.** HLCs bound skew at the cost of a monotonic counter. A replica whose clock is skewed beyond the configured maximum (500 ms by default, a design parameter) refuses writes with `clock_skew`. The failure is detectable and is not a silent reordering.
4. **Cedar evaluation cost.** Per-request evaluation loads the owner's grants, which are small. A decision cache keyed by `(principal, action, resource, grantsVersion)` is invalidated by grant writes.
5. **Parquet cold reads.** Object storage first-byte latency is higher than MinIO's. Footers and row-group metadata are cached in process, and the stage run warms them before the presenter starts.
6. **Realtime fan-out behind a load balancer.** WebSockets need idle-timeout tuning, and reconnection after a replica dies needs jittered backoff. Cursors make reconnection correct. Jitter makes it cheap.
7. **Headless snapshots.** Snapshots are off the critical path, used only for exports.
8. **Rendering many panels.** The demo caps panels per dashboard at 12 and series points at 1,500 per panel, both design parameters, both enforced by validation and reported in the plan's cost.

### G.2 Hidden complexity

- **Semantic diff.** Diffing by path is easy. Diffing by intent (a panel moved between rows is not a delete and an insert) needs stable node identity, which the CRDT provides, and a rule set for presenting changes. Slot-based layout makes "moved" a register change, which the diff reports as such.
- **Undo under concurrency.** An inverse is well defined only if the register it touches has not been overwritten. `change.undo` refuses and names the blocking revision. That is correct and surprising to users, and the UI shows it as a refusal, not an error.
- **Preview fidelity.** The preview must predict the commit exactly, including validation that depends on the catalog. A catalog change invalidates a plan, which is why `stale_base` covers catalog changes too.
- **Approval application.** An approved operation is applied later, under a different principal, against the base at approval time. The approval records the base, and an approval whose base has moved returns `stale_base` to the approver, not to the agent.
- **Workflow durability.** Steps that call external actions are idempotent. Each action carries a key derived from `(workflow, step, attempt)`.

### G.3 On-stage failure modes and mitigations

| Failure | Detection | Mitigation |
|---|---|---|
| Agent sends a field the schema does not have (`for` for `hold`) | `unknown_field` with valid alternatives and no suggestion | Shown at 235–270 s; the agent reads `schema.describe` and retries |
| Agent commits without a preview | `preview_required` | Recovers by previewing; rehearsal only |
| Agent gets `stale_base` after a change to the branch | `stale_base` with `mergePreview` | Agent reviews the merge preview and previews again |
| Agent answers "why" with a guess | Rehearsal checks the answer cites an attribution `id` and watermark | Presenter switches to the fallback |
| Model latency spikes | The presenter watches the terminal | Fallback after the trigger in §C.3 |
| Agent loops on `query.run` | Budget in `session.describe`; rate limit | `rate_limited` with `retryAfterMs`; fallback |
| Agent asks for access it does not have | `scope_exceeds_owner` | Shown as a feature at 235–270 s |
| A different dock is the top contributor on a re-run | Attribution returns the data's answer | The script refers to the dock by the attribution result, never by a name written in advance |
| Replica dies during the final 30 s | Health check; the load balancer removes the target | The kill is the demo; the retry and the verify are the proof |
| Fallback starts at a step whose precondition fails | Checkpoint mismatch | Step back to the last matching boundary; if none, refuse and reset (§C.3) |
| Browser sleeps or loses network | Cursor resume | Automatic; shown only in the status line |
| Projector or network failure | Presenter's local display | A recorded screen capture of a rehearsal run is kept on disk, shown only if the display fails, and labelled as a recording |

### G.4 Failure modes not handled

- An agent that is wrong and persuasive about a cause the data does not contain. Attribution returns what the data says. The agent can still mis-narrate it, so the agent's answer is required to cite its attribution id, and the presenter's rehearsal checks the citation.
- Clock skew beyond the configured maximum on AWS. Refusals are detectable and documented, not automatically repaired.
- Loss of the database. Claim 5 does not cover it.

### G.5 Shallow features

Honest list.

- **Anomaly bands (36)** are a rolling median and MAD band. They are deterministic and correct, and they are not a model.
- **Embedding (48)** is a signed iframe with a parameter lock. Its security is the token.
- **Scheduled reports (47)** produce CSV and PNG and send through the action layer. There is no PDF layout engine.
- **Workspace isolation (10)** is a workspace key enforced by policy and a storage prefix. It is isolation for the demo, not a tested hostile-tenant boundary.
- **Templates (29)** are dashboards with declared parameters. There is no template marketplace.
- **Column masking (9)** replaces values with a salted hash. It is not format-preserving and is not a data-classification program.
- **Comments (44)** have no notifications and no mentions.
- **Catalog search (45)** is trigram search over titles and descriptions, with no ranking model.
- **Undo (16)** covers only the principal's own recent changes that are still applicable.
- **Attribution (34)** is shift-share over at most three dimensions, with a dominance threshold. It answers questions about one metric's aggregate. It does not establish causation, and its output says so.
- **Preloaded history** means the "live" feed is live only from 14:20. The 14:05 spike is in recorded simulated history.

---

## H. Feasibility

Feasibility is expressed by what each component touches and by dependency order. No duration is given.

### H.1 Scope by component

| Component | What it touches | Relative breadth |
|---|---|---|
| `fathom-spec` (tree CRDT, canonical JSON, diff, merge) | Pure Rust, property tests, WASM build | Large; the highest-risk algorithm |
| `fathom-ir` (IR, checker, unit algebra, RLS rewrite, DuckDB lowering) | Pure Rust, DuckDB bindings, differential harness | Large |
| `fathom-policy` (Cedar entity model, schema, policies, decision cache) | `cedar-policy`, policy tests | Small to medium |
| Operation registry and generated surfaces (HTTP, MCP, CLI, TS client) | One codegen step over registry entries | Medium; the leverage point |
| Plan engine (preview, commit, discard, verdicts, idempotency) | Registry, policy, audit, merge | Medium |
| Revision graph, refs, branches, merge | `fathom-spec`, Postgres | Medium |
| Ingest and `fathom-sim` | Deterministic simulator, producer, Parquet writer, ingest worker | Medium |
| Realtime gateway (WebSocket, cursors, resync) | Op log, registry | Medium |
| MCP server (twenty tools, resources, error envelope, budgets) | Registry, plans, policy, audit | Medium; mostly generated |
| Alert, workflow and approval engine | IR, IVM where present, actions | Medium |
| Audit chain, head lock, anchoring | Postgres transaction, object lock | Small |
| Web UI (grid, controls, presence, diff review, merge chips, approval cards, focus) | React, WASM spec, Vega-Lite | Large in breadth, conventional in technology |
| Replay and rehearsal tooling | Recording client, gated feed, Playwright | Small to medium |
| Deployment (compose stage profile, OpenTofu, cosign, digest check, auth parity test) | Two targets, one image set | Medium |

### H.2 Critical dependencies

1. The tree CRDT gates collaborative editing. If its convergence test fails and cannot be fixed, the fallback is single-writer dashboards with pessimistic locks. The §C.1 205–235 beat still works under locks, because it has no concurrent human edits.
2. The operation registry gates the MCP server, the UI and the HTTP API. It must exist before any surface is written.
3. The plan engine gates every write and therefore every beat.
4. The IR and its checker gate every panel, alert and attribution run.
5. Live data (the simulator and the ingest path) gates the "why" question, which needs data through 14:20.
6. Cedar and the owner ceiling gate the agent-authority claim.

### H.3 Main risks

- The tree CRDT is novel to this codebase and has the most subtle invariants.
- Agent behaviour under a live model cannot be measured until the registry-generated surface is complete. Outcome-based rehearsal results arrive only after the vertical slice runs end to end.
- Wall-display rendering and the stage profile's resident memory are measured on the target hardware in rehearsal. No figure is claimed.
- Two-replica failover on AWS depends on load balancer and container behaviour that is documented but not locally reproducible in full.

### H.4 Dependency-ordered build sequence

Each step names what it unlocks. Steps on the same line are independent.

1. **Canonical JSON, schema registry for `panel` and `query`, operation registry generating one HTTP route and one MCP tool from one definition.** Unlocks everything. The minimal vertical slice starts here.
2. **Simulator to NDJSON, Postgres-backed ingest, one Parquet dataset, one IR query (`count` by stage) lowered to DuckDB.** Unlocks live data.
3. **Panel render from `query.run` with the result key, one KPI, polling.** First visible result.
4. **Revision graph, `live` ref, plans on the single-writer path with idempotency keys and the audit head lock.** Unlocks the write path.
5. **MCP surface generated from the registry; an agent previews and commits one panel to an agent branch.** First agent result.
6. **Tree CRDT (insert, delete, registers, slot layout) with the convergence property test; WebSocket deltas with cursors and replica identity.** Unlocks two windows editing and presence. Gated by claim 1.
7. **Branches, semantic diff, three-way merge, merge review UI with per-property authorship.** Unlocks the agent-branch flow.
8. **Principals, Cedar schema and policies, owner ceiling, `approval.request` and `approval.resolve`, `approval_required`.** Unlocks claim 2 and the approval beat.
9. **RLS rewrite, masking, result keys with predicate hashes, the differential test.** Unlocks claim 4 and the finance view.
10. **Transforms, attribution with dominance and the noise dock, lineage, metric, explain with budgets, `watermarkAtLeast`.** Unlocks the "why" answer.
11. **Alerts with `hold` and trace, workflows, approval cards, allowlisted actions.**
12. **Undo (`change.undo`), audit digest, anchoring, `audit verify`.**
13. **Replica incarnation identity, fault points, kill-resume test (claim 5), platform self-source.**
14. **Compose stage profile, then the OpenTofu modules and the AWS deployment from the same digests; digest and auth-parity tests.**
15. **Recording, gated replay, the rehearsal harness with the three checks of §C.3, and the pre-registered outcome criteria.**

Steps 1 to 5 form the minimal vertical slice: one dataset, one panel, one operation rendered live and changed by an agent through a plan. Each later step adds a primitive that composes with those already present.

### H.5 Verification gating

Per the house rules, each change runs cheap checks only: `cargo check`, formatting and lint on the touched files. Subagents do not run test suites. The claim tests in §F, the differential test and the chaos test run once on each stacked integration, collected by the coordinator. Claim tests are the stack's acceptance criteria. A failing stack is bisected by commit, and the failing change goes back with its output.

### H.6 Cut list

Cuts are ordered. Each cut is taken only when the step it removes fails its gate. The claims it narrows are stated.

1. **Move operations in the tree CRDT.** Gate: claim 1 with moves. Effect: the convergence claim narrows to insert, delete and registers, which is what the demo uses. Layout does not change, because it is slot registers.
2. **Histogram incremental maintenance.** Effect: live panels recompute from batch queries at most once per watermark tick. No claim is narrowed. Latency of live panels rises.
3. **Cross-filter via focus bind.** Effect: the drill-down opens by link navigation only, and the bar click is a plain link. The 165–205 beat loses the shared binding. No claim is narrowed.
4. **Redpanda as the live stream.** Effect: the stream runs from a Postgres-backed feed. The stage profile loses one container. The claim 5 test runs against the Postgres feed, and the deployment differences document records the change.
5. **MinIO object-lock anchoring.** Effect: anchors go to a local hash file on the same volume. Claim 5(c) narrows to chain verification without an external anchor, and the stage profile loses one container.
6. **Single-writer dashboards with locks** (the critical-dependency fallback). Effect: the two-human-editing claim is removed, which the stage does not use. Claims 1 and 3 narrow to single-writer behaviour.

Cuts 1 to 3 remove stage-visible behaviour least. Cuts 4 to 6 remove infrastructure.

### H.7 What would make this proposal fail

- If the tree CRDT cannot converge under its property test, collaborative editing reduces to locks (cut 6). The demo still runs.
- If the IR cannot stay small enough to type-check fully, panels, alerts and attribution would diverge into separate dialects. The IR is therefore frozen at step 2 and extended only through new registry entries.
- If the tool descriptions are not sufficient for a general agent to build the board from the user prompts alone, the design fails the no-prompt criterion of §F. The server then needs better descriptions, not prompts. The criterion decides this, and it is pre-registered.

---

## Word count and notes

Length: 15,845 whitespace-separated tokens by `wc -w`, which counts table pipes, code blocks and identifiers. The revision log, the tables and the code blocks account for well over half of that.

Measured or designed quantities in this document, all labelled as design parameters, scenario parameters or values for rehearsal to measure: 1,400 orders per simulated hour, 40 docks, 12 carriers, 2 million rows in the differential dataset, 10,000 generated operations, 5,000 generated queries, 20 kill repetitions, 300-second plan expiry, the rate limits, the 1,000 and 10,000 row limits, the 1,500 series points, the 12 panels per dashboard, the 1,024 histogram buckets, the 500 ms clock skew bound, the 2 GB scan budget, the 64 KB and 200-row budgets, the 10-second presence expiry, the 24-hour idempotency retention, and the 10 scenario seconds per real second feed rate. None is a measured result. The rehearsal produces the measured values, and the outcome criteria in §F and §C.3 say what is checked.

Pre-registered criterion for the live rehearsal (no prompts beyond §C.0): in ten fresh resets, the outcome predicates of §C.1 hold in at least eight runs. Each failing run is recorded with its first failing beat. The criterion is set before any run.
