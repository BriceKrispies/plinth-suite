# Proposal 04 (revised): Emergent Composition

**Product title: Quayside, a berth-plan control room for a container terminal**

**Pitch.** Quayside is a shared, contested berth plan for a container terminal, where planners, a harbourmaster, a carrier's agent and an auditor act on the same state at the same time. Every behaviour in the five-minute demo comes from a small set of primitives (an append-only event store with per-stream hash chains and external anchors, synchronous projections, a policy engine, a deterministic constraint solver, optimistic concurrency under a single commit order, and a transactional outbox), composed so that one drag of a ship on a timeline triggers authorization, a constraint check, an atomic multi-berth commit, real-time fan-out to other sessions, an audit record and, at the end, a verifiable proof that the record has not been altered.

---

## Revision log

Each finding from the three reviews is listed with how it was handled. "Fixed" names the section where the change is made. "Rebutted" means the finding was answered with reasoning and the design is unchanged on that point. "Accepted limitation" means the finding is correct, the design keeps the behaviour, and the limit is stated where it applies.

### Reviewer A (Principal Systems Engineer)

| # | Finding | Response |
|---|---|---|
| A1 | F4 "in global_pos order" conflicts with identity values allocated before commit; no watermark or window in D.3 | **Fixed.** Commit order is made equal to identity order by a single plan-commit lock held from the first position allocation to commit (D.3, D.4). The reader rule and the single ordering protocol are stated in D.3 and the consistency table. The reducer's order requirement is stated in D.4. F4 tests the bound directly. |
| A2 | "Detects any change" (D.6) has no external anchor; a superuser can recompute each stream | **Fixed, and claim narrowed.** Stream heads are anchored to S3 Object Lock checkpoints (D.5). The claim now reads: any change to a committed event is detected, and any rewrite of anchored stream heads is detected; events after the last anchor are reported as unanchored (F5, G). Accepted limitation for the unanchored window. |
| A3 | RLS stated only for `visits` and `slots`; no policy for events, proposals, snapshots, notifications, outbox, decisions | **Fixed.** Policy inventory covers every table and read path (D.6, table of policies). |
| A4 | `slots` exposes other carriers' berth occupancy, contradicting "not merely greyed out" | **Fixed.** A carrier's view contains only slots of her own visits; other carriers' occupancy and holds are absent from the response, not rendered as blocks. Changed in A, C (0-30 s) and D.6. |
| A5 | Filtered replay makes hidden and missing positions indistinguishable (C 150-180 s) | **Fixed.** Every position is returned; hidden positions are placeholders carrying the position and nothing else (D.3, D.6, view `events_for_carrier`). Residual disclosure (carriers can count positions) is an accepted limitation, stated in G. |
| A6 | Hash over `canonical(event)` while `payload` is `jsonb`, which does not preserve hashed bytes | **Fixed.** Each event stores the exact canonical bytes it hashes in `canonical bytea`; `payload` is derived from them. The verifier checks payload against canonical bytes and the hash chain over canonical bytes (D.2, D.5). |
| A7 | Forecast worker creates proposals with no Cedar principal; decision record names an undefined principal | **Fixed.** `System::"forecast-worker"` is a defined principal with explicit Cedar entries limited to `propose_move` with `source == "forecast"` (D.2 policy). Its decisions are written like any other (C 180-210 s). |
| A8 | Snapshots trusted for time-travel without a hash link | **Fixed.** Snapshots store the hash of the event at their sequence number. Loading checks the link against the event row and falls back to full replay on mismatch (D.2, D.4). |
| A9 | Tamper target (berth 5 draft 13.2 to 12.9) must be an accepted event | **Fixed.** The target is named: the `MoveApplied` event for MV Corwen on stream `berth:5`, sequence 17, produced by the accepted rebase commit at 120-150 s. The edit changes the recorded draft from 11.6 m to 10.9 m (C 240-265 s). |
| A10 | Hold semantics unstated; holds may not be slots | **Fixed.** Holds are rows in `slots` with `kind = 'hold'`, covered by the same deferrable exclusion constraint (D.2). |

Reviewer A required changes: ordering protocol (A1), anchors (A2), policy inventory and carrier slot visibility (A3, A4), canonical bytes (A6), system principal (A7), named accepted tamper target (A9), hold-as-slot (A10). All are made.

### Reviewer B (Skeptical Technical Audience Member)

| # | Finding | Response |
|---|---|---|
| B1 | F4 says exactly-once in `global_pos` order, but the overlap window and dedupe size are unspecified | **Fixed.** There is no overlap window in the revised design. Commits are serialized by the plan-commit lock, so a visible position implies all lower positions are decided (D.3). F4 includes a test at the bound: a commit attempted while a lower-position transaction is open must wait. Dedupe by `global_pos` remains as a guard for replays. |
| B2 | Tamper beat stops at detection; a superuser who recomputes the chain is not addressed; no external head anchor | **Fixed, with stated limit.** Anchors in S3 Object Lock (D.5) catch rewrites of anchored heads. The stage line states the limit in one sentence (G, H risk 6). |
| B3 | "Not a script" (two rehearsed variants) is not shown on stage | **Fixed.** The claim is removed from the script table. The second variant runs in the rehearsal and its recording is an evidence artifact, not a stage moment (F5). |
| B4 | Solver seed chosen to suit the scenario reads as prepared | **Rebutted, with an evidence commitment.** The seed is the product default in `solver.toml` (value 42), applies to every run, and is recorded on every proposal; the demo does not select a seed. The golden proposal and a seed sweep are to be committed as evidence once measured. Until then they are not reported as results (B.4, F5). |
| B5 | Forecast beat depends on an unmeasured pipeline; the fallback removes the "reasoned about the weather" line | **Fixed.** Explicit cut rule at 210 s, read from the pipeline chip; the forecast accept is part of the beat (C 180-225 s). The fallback is named in the script, not improvised. |
| B6 | Cross-replica trace depends on load balancing the presenter cannot control | **Fixed.** Demo-only replica pinning by URL parameter, routed by the load balancer and by nginx locally (D.4, E). |
| B7 | Gantt and time-travel scrubber carry the visual load and are shallow | **Accepted limitation.** Kept, as the carrier for the other claims. The scrubber now addresses `global_pos` and shows the projection hash at that position, so the visual is tied to a checkable value (G). |

Reviewer B required changes: window and dedupe or at-least-once (B1), anchors (B2), second variant or removal (B3), seed published (B4), forecast cut point (B5). All are made.

### Reviewer C (Implementation and Reliability Engineer)

| # | Finding | Response |
|---|---|---|
| C1 | In-order claim in F4 conflicts with overlap-window design; no watermark or window size | **Fixed.** Same as A1 and B1. |
| C2 | Determinism claim (B5) conflicts with the wall-clock guard | **Fixed.** The wall-clock guard is removed. The solver is bounded by an iteration cap only; a result that reaches the cap is recorded as `partial` and cannot be accepted on the demo path (D.2, G). |
| C3 | "Resumed from position 48,217" is a literal that changes between resets | **Fixed.** Reset restarts the identity sequence, so positions are reproducible. The stage line shows the value printed by reset, which the rehearsal checks against the fixture (B16 in the capability table, C 150-180 s). |
| C4 | Trace beat opens a forecast-driven acceptance that the forecast beat does not perform | **Fixed.** Ines accepts the forecast proposal explicitly at 210-225 s. The trace beat names that acceptance, and the fallback is named explicitly (C 270-300 s). |
| C5 | Trace beat requires two named replicas; presenter cannot route | **Fixed.** Documented demo-only routing (D.4, E). |
| C6 | D5 `token_type` check conflicts with Cognito ID-token claims; token location of the carrier attribute unspecified | **Fixed.** The API accepts ID tokens (`token_use = "id"`, `aud` = app client). `custom:carrier_id` and `cognito:groups` are read from the ID token, which is where Cognito places custom attributes by default (D.5). |
| C7 | Token lifetimes stated inconsistently ("8 hours to match") | **Fixed.** Parity table gives the configured values for both environments (E). |
| C8 | Two authoritative policy layers (RLS and Cedar) must be kept equal; F3 must test it | **Fixed.** RLS is applied through views and the matrix test runs through the database role (D.6, F3). |
| C9 | Forecast file upload path not described | **Fixed.** Presigned upload path described (D.4, C 180-210 s). |
| C10 | 412 ms is an observed value but is a design target | **Fixed.** No latency number appears in the stage script. Solver output is shown as moves, reasons and iterations used against the cap. Latency targets are labelled as targets in F4 (C, F). |

Reviewer C required changes: watermark or bound (C1), guard removed (C2), identity restart (C3), explicit forecast accept (C4), routing (C5), ID-token mapping (C6), lifetimes (C7), forecast upload (C9). All are made.

### Withdrawn claim

The earlier claim of parallel berth commits is withdrawn. It conflicted with the single commit order required by A1, B1 and C1. Per-stream hash chains are kept for their remaining purpose, which is per-stream verification that can run in parallel and per-berth proofs that do not require reading the whole log (D.2).

---

## A. Product concept

### The application

Quayside runs the berth plan for one container terminal. A terminal has a finite set of berths, each with a length, a depth that varies with the tide, a wind limit and a crane capacity. Vessels (identified by IMO number, with length overall, draft and contracted crane moves) arrive on visits. Each visit must be assigned a berth and a time window. The plan is a negotiation between people who own different constraints:

- **Planners** (Tomas, Ana) build and edit the plan, place holds and propose moves.
- **The harbourmaster** (Ines) owns safety. She accepts or rejects plan changes, loads forecast files and accepts solver proposals, including those the forecast worker produces.
- **Carrier agents** (Priya, for the fictional carrier Northwind Lines) see only their own vessels and the berth spans those vessels occupy. They do not see other carriers' visits, other carriers' berth occupancy, holds, or any proposal. They acknowledge notifications.
- **The auditor** (Dana) reads the event record, can replay any position of the plan, and runs verification. She cannot change anything.

The data is a synthetic but internally consistent terminal: six berths, a 72-hour planning horizon, a tide table, a wind forecast, roughly 60 visits across five carriers. The sample set is deterministic and reproducible from a seed file.

### Problems solved

1. **Conflicting edits.** Two planners editing the same berth at the same time must not both succeed, and the loser must learn why and what the current state is.
2. **Explainable rejection.** A move that violates a draft limit at low tide must be refused with the specific constraint, the tide window and the value.
3. **Re-planning under change.** A storm front invalidates wind limits for three berths. Someone has to produce a revised plan promptly and safely, and everyone has to see it.
4. **Accountability.** After an incident, the question is what the plan looked like at a given position, who changed it and which rule let them. The answer must be reconstructible and must be checkable against something outside the database.
5. **Partial visibility.** A carrier agent sees her own vessels and the berth spans they occupy, and nothing else. The boundary holds for direct API calls, for replay, and for the database role.

### Why it suits this demo

A berth plan is a shared, safety-relevant, concurrently edited state with time, geometry, policy and history all mattering at once. Almost every property of a distributed system shows up in it without contrivance, and an engineering audience understands it in one sentence: ships, berths, tides and a timeline.

The primitives are deliberately few. The emergent effect is that one user gesture touches most of them, and the audience can see that happen. Each visible result on stage is the output of one named mechanism, listed in the script.

---

## B. Capability inventory

Each capability is marked **demonstrated** (shown on stage with a visible result) or **supporting** (required, but not a moment in the script).

| # | Capability | Status | Technical significance | Interactions |
|---|---|---|---|---|
| 1 | Append-only event store with canonical bytes and per-stream hash chains (`events`, `streams`) | demonstrated | Each event stores the exact bytes it hashes; `sha256(prev_hash || canonical)` links it to its stream predecessor; no in-place updates by the application role | Source for projections (2), replay (10), verification (11), anchors (11b) |
| 2 | Synchronous projections in the command transaction | demonstrated | `slots` and `visits` are updated in the same transaction as the append, so readers never see an event without its projection | Constrained by the exclusion constraint (6); feeds real-time (7) |
| 3 | Policy engine (Cedar) with decision records | demonstrated | Declarative policy file evaluated on the server for every action; each decision is a row with the policy hash and request hash; decision IDs are stored on events | Drives UI affordances (3b); principal types include the forecast worker (3c) |
| 3b | Policy-driven UI affordances | demonstrated | The client asks `POST /api/me/capabilities` and renders only permitted actions; the server re-checks on submit | Tested as a matrix through the API and the database role (F3) |
| 3c | System principal for the forecast worker | supporting | `System::"forecast-worker"` has explicit Cedar entries limited to forecast-sourced proposals | Makes worker proposals auditable like planner proposals (9) |
| 4 | Constraint engine with explainable rejections | demonstrated | Pure functions over half-open spans `[start, end)` returning rule, value and window | Used by the solver (5) and by move validation (6) |
| 5 | Deterministic bounded constraint solver | demonstrated | Given a snapshot, horizon, seed and iteration cap, produces the same proposal; no wall-clock input; results at the cap are `partial` | Produces proposals (6); runs in the worker for forecast ingest (9) |
| 6 | Proposals and a single commit order | demonstrated | Proposal records base versions; acceptance takes one plan-commit lock, compares versions, and commits all moves or none; mismatch returns HTTP 409 with current versions | Rebase (6b) re-runs the solver on the affected subset |
| 6b | Rebase on conflict | demonstrated | On 409 the UI offers "rebase onto current plan"; the server re-solves only affected moves and reports dropped moves with reasons | Depends on 5 and 6 |
| 6c | Planner holds as slots | demonstrated | A hold is a `slots` row of kind `hold` under the same exclusion constraint, so a hold cannot overlap a visit or another hold | Changes the rebase input (6b) |
| 7 | Post-commit real-time fan-out | demonstrated | `NOTIFY plan_changed` is transactional, so it fires only on commit; each replica re-reads from each socket's cursor | Relies on the cursor protocol (8) |
| 8 | Resumable event stream with cursors and placeholders | demonstrated | Clients send their last `global_pos`; the server returns every position after it, with content only where the principal may see it | Network-loss drill (150-180 s) |
| 9 | Transactional outbox, queue, idempotent worker | demonstrated | Side effects are written to `outbox` in the triggering transaction, relayed to SQS, and consumed by idempotent handlers | Forecast ingest (180-225 s); notifications; checkpoint anchors |
| 10 | Time-travel replay and snapshots | demonstrated | State at a `global_pos` is the fold of the pure reducer from the nearest snapshot whose hash link verifies | Auditor's view (225-250 s); validated by F2 |
| 11 | Hash-chain verifier | demonstrated | Checks canonical-to-payload agreement, every hash link and stream sequence contiguity, read-only | Tamper beat (250-265 s) |
| 11b | External anchors in object-locked storage | demonstrated | Worker writes per-checkpoint stream heads to S3 Object Lock (compliance mode); verifier compares chain heads with anchors | Limits what a superuser can rewrite undetected (G) |
| 12 | Distributed trace across browser, API replicas, Postgres, queue, worker | demonstrated | OpenTelemetry context in event metadata (not hashed) and SQS message attributes | Final moment (275-300 s) |
| 13 | OIDC authentication with ID-token group and carrier claims | supporting | API verifies ID tokens against cached JWKS and maps `cognito:groups` and `custom:carrier_id` to Cedar principals | Input to 3 |
| 14 | Manifest and forecast upload via presigned S3 PUT | supporting | Browser uploads directly to S3; completion enqueues a job through the outbox | Shares the outbox path with 9; forecast upload is demonstrated |
| 15 | Health, readiness and migration job | supporting | `/healthz`, `/readyz` (database, migrations at expected version, NOTIFY listener connected); migrations as a one-off task | Recoverability (G) |
| 16 | Deterministic demo reset | supporting | `quayside demo reset` truncates, restarts identity sequences, reapplies migrations and replays a fixed seed file through the normal command path, then prints the position and state hash | Predictable initial conditions and reproducible positions |
| 17 | Idempotency keys on mutating endpoints | supporting | `Idempotency-Key` stored with request hash and response; retry returns the original result | Protects 6 and 14 |
| 18 | Gantt and inbox UI, role-scoped views | supporting | Timeline showing only what the role may see; inbox fed by `notifications` | Visual carrier for 2, 3b, 7 and 8 |
| 19 | Infrastructure as code and immutable images | supporting | CDK (TypeScript) for AWS; Compose for local; the same image digests in both | Section E |
| 20 | Multi-session end-to-end rehearsal | supporting | Playwright with four browser contexts, each with stored sign-in state for one role | Section F, claim F5 |

Several capabilities are only interesting in combination. The solver (5) is a pure function, which is unremarkable on its own. It becomes a demonstration when its output is a proposal (6) that is checked against the same berth versions the planner's view was built on, when rebase (6b) reuses the solver on a smaller input with a planner hold (6c) as a fixed constraint, and when the forecast worker (9, 3c) produces a proposal in another process that is accepted through the same command path (6) and appears in three sessions through the same fan-out (7). Authorization (3) is convincing when the rule that hides a carrier's vessel from the API is the same rule that hides it in the UI, from replay, and from the database role.

---

## C. Five-minute live script

Stage setup, before the audience arrives: three browser windows side by side, labelled **Planner (Tomas)**, **Harbourmaster (Ines)** and **Carrier agent (Priya)**; a fourth panel on a second display for the **Auditor (Dana)**; and a terminal pane for the database. All four are signed in, and the plan is in its reset state. Reset is one command, and its output (position, state hash, anchor position) is shown before the talk begins. The horizon is pinned to the demo epoch, so the timeline is identical on every run. The Harbourmaster window is opened with `?replica=a` and the Carrier window with `?replica=b` (section D.4); the other windows use the shared endpoint.

Stage positions and counts in the script are fixture values. The reset prints them, and the rehearsal checks them against the fixture file. The script refers to them by name, not by a number typed into the script.

| Time (s) | Presenter action | Expected behaviour | Visible result | Capabilities demonstrated | Transition |
|---|---|---|---|---|---|
| 0-30 | Shows the plan in all three windows. Says: "A berth plan is a shared, contested, safety-critical state. Three people are looking at the same thing right now." Points at the status line showing the current `global_pos`. | Plan loads from projections; sessions connected over WebSocket with cursors. Carrier window loads only Northwind's visits and their berth spans. | Gantt for six berths over 72 hours. Each window offers a different action set: planner has edit controls; agent has none on the plan and acknowledges her own notifications. | 2 projections, 3b affordances, 8 cursors | "Let's make one change and watch what the system does with it." |
| 30-60 | In Planner window, drags MV Halden from berth 3 at 14:00 to berth 5 at 16:00. | Client sends `propose_move` with base versions for berths 3 and 5 and an `Idempotency-Key`. Cedar permits planner `propose_move`. Constraint engine checks draft 13.2 m against the berth 5 tide window 15:40-17:10 (limit 12.0 m). Move refused; rejection and decision are recorded as events. | Ship snaps back to berth 3. Red banner: "Refused: draft 13.2 m exceeds berth 5 limit 12.0 m (tide window 15:40-17:10, table TT-2026-11-22)." Audit line `MoveRejected` with decision id. | 3 decision, 4 explainable constraint, 1 append (rejection recorded) | "The rule is in the data, and every refusal says which rule. Now the harbourmaster asks what the afternoon should look like." |
| 60-90 | In Harbourmaster window, selects the 14:00-18:00 window and presses "Resolve". | Solver runs on the snapshot at current base versions, with the product seed (42) and iteration cap 2,000. Output is a proposal of four moves with reason codes, persisted as `ProposalCreated` with base versions, `input_hash`, `solver_version` and seed. | Ghost overlay shows the four moves. Each proposal card line gives the reason (e.g. "draft fits berth 6 at 16:00 after tide gate"). Solver status: "complete: 4 moves, iterations used of 2,000 cap." | 5 solver, 6 proposal, 2 ghost computed from the proposal | "A proposal is only useful if it can be accepted in a shared system. Watch what happens when someone moves first." |
| 90-120 | Tomas places a hold on berth 2, 15:00-17:00, in his window. Ines presses "Accept". | Hold is a `slots` row of kind `hold` and changes berth 2's version. Accept takes the plan-commit lock, compares versions, finds berth 2 moved, and rolls back with HTTP 409 and current versions. Nothing partially commits. | Conflict banner in Ines's window: "Berth 2 changed since this proposal (v41 to v42). Plan unchanged." Hold appears in her view by push. Button: "Rebase onto current plan." | 6 commit order and optimistic check, 6c holds, 8 real-time from another session | Ines presses "Rebase." |
| 120-150 | Ines presses "Rebase." | Solver reruns only the moves on berth 2 and moves whose spans overlap the hold, with the hold as a fixed constraint. One move is dropped with reason "berth 2 held 15:00-17:00 by planner hold". Three moves commit in one transaction, including MV Corwen to berth 5 at 16:00 (the tamper target, sequence 17). | Proposal card shows three moves and one dropped move with reason. Gantt animates the three moves. Tomas's window and Priya's window update in the same frame: one committed move is a Northwind visit. | 6b rebase, 5 solver on subset, 6 atomic commit, 7 fan-out to three sessions | "Priya's window has just changed. Let's see what she can and cannot see." |
| 150-180 | Presses "Simulate network loss" on Priya's window, which closes her socket. Tomas makes two edits to berth 3 while she is offline, one touching a Northwind visit and one touching another carrier's visit. Priya presses "Reconnect." | Her client reconnects with her last `global_pos`. The server returns every position after it. Positions with content visible to Northwind are applied; the others arrive as placeholders with no content. The reducer applies each position once. | Status line: "Resumed after position P; advanced through K positions, V with Northwind content, K minus V withheld." (P, K, V are fixture values printed by reset.) Her Gantt shows only the Northwind change. The network panel shows K frames, and the withheld frames carry only position numbers. | 8 resumable stream and placeholders, 3 policy at row level, idempotent reducer | "Her view is correct because of the log and the policy together. Now a change that originates outside the terminal." |
| 180-210 | Ines drags the forecast file `forecast_2026-11-22T1200_NE.json` into the forecast panel. The browser uploads it by presigned PUT; the page then calls `POST /forecasts/complete`. The file contains a wind limit of 25 kn for berths 1-3, 15:00-19:00. | Completion writes `ForecastApplied` (stream `forecast`, content hash as idempotency key) and an outbox row in one transaction. Relay publishes to SQS. Worker consumes, finds the visits in violation, runs the solver and writes a proposal through the command path as `System::"forecast-worker"`. | Pipeline chip: "queued, worker picked up, solving, proposal ready (2 visits)." The proposal appears in all three sessions. Ines's card is marked "from forecast." | 9 outbox, queue and idempotent worker, 3c system principal, 5 solver in worker, 6 proposal, 7 fan-out | "The system has just reasoned about the weather." |
| 210-225 | **Cut rule:** at 210 s the presenter reads the chip. If it shows "proposal ready" in all three sessions, Ines presses "Accept" on the forecast proposal. If not, the forecast beat is cut: Ines does not accept, the script jumps to 225 s, and the trace beat uses the rebase acceptance. | Harbourmaster accept takes the plan-commit lock and commits the forecast moves in one transaction, with the same 409 rules as planner proposals. | Two visits move; all three sessions update in one frame; the accepted proposal is listed in the audit panel. | 6 commit, 7 fan-out, 3 harbourmaster authority | "Dana can now ask what the plan knew, and when." |
| 225-250 | Dana, on the second display, scrubs the audit timeline to the position of the rebase acceptance (120-150 s) and opens the diff against the current plan. Then she opens the record of one forecast-sourced move. | Plan at that position is the fold of the reducer from the nearest snapshot that passes its hash link. Diff is computed against the current projection. Record shows actor, base versions, decision id and policy file hash. | Historical Gantt with the rebase moves as they were, and a diff highlighting the forecast changes. Record panel: "Allowed by policy `planner-propose-v3` (sha256 9f2c...); decision D-20417" for planner moves, and "System forecast-worker, source forecast" for worker moves. | 10 replay and snapshots, 3 decision records, 1 event provenance | "Replay tells you what happened. The next question is whether anyone could have changed the record." |
| 250-265 | Dana presses "Verify chain." Presenter then runs one SQL statement from the terminal pane, as a superuser, that edits the `payload` of the berth 5 event at sequence 17 (MV Corwen, `MoveApplied`), changing the recorded draft from 11.6 m to 10.9 m. Dana presses "Verify chain" again. | First run: all streams valid, with count, duration and the anchored position shown. Second run: verifier finds payload disagreeing with canonical bytes at `berth:5` seq 17, and reports stored and recomputed hashes. The application never runs the edit. | Green, then red, with the exact stream and sequence. The affected plan view is marked "record integrity failed" rather than showing altered data. | 11 verification, 11b anchors, tamper detection of direct writes | "One sentence on the limit: the verifier detects a change, and anchors detect a rewrite of anchored heads. Now, one trace." |
| 265-300 | Presenter opens the trace of the acceptance Ines performed in the forecast beat (210-225 s). If that beat was cut, the trace of the rebase acceptance (120-150 s). Shows the waterfall. | One trace covers: browser click; API replica A (policy, constraints, lock, append, projections, commit); Postgres `NOTIFY`; API replica B (receipt, WebSocket push to Priya's session); outbox relay; SQS; worker (idempotency check, notification row). | Waterfall with spans across three processes and two replicas. Span labels show the decision ID and the `global_pos` range committed. Presenter closes on: "This is one click, and every claim you have seen today is a span in this picture." | 12 distributed trace, 7 cross-replica fan-out, 9 worker, 1 commit provenance | End. |

### Notes on the script

- The first 30 seconds establish purpose by showing three people looking at one contested state. The status line is the first hint of the event log.
- The final 30 seconds deliver the strongest moment: the trace crosses the browser, two API replicas, Postgres notification, queue and worker, with decision identifiers on the spans. The replicas are placed by the pinned routing (D.4), not by chance.
- The script has one fixed cut rule (210 s) and one fallback, both named. No other branch depends on a pipeline the presenter cannot see.
- Typing is limited to one SQL statement at 250-265 s, stored in a file and run by one command.
- No latency figure appears on stage. The solver result is shown as moves, reasons and iterations against the cap. Latency is a measured quantity and is reported only after measurement (F4).
- Timing in the script is the presenter's cue sequence, not a measurement. Measured timings from rehearsal are labelled as such when reported.

---

## D. Technical architecture

### D.1 Components

| Component | Language and framework | Responsibility |
|---|---|---|
| `quayside-api` | Rust, axum, tokio, sqlx (Postgres), cedar-policy crate, tracing with opentelemetry-otlp | HTTP API, WebSocket fan-out, command handlers, projections, policy checks |
| `quayside-worker` | Rust, same crate, `worker` subcommand | SQS consumer; forecast application; solver jobs; imports; notifications; snapshot writer; anchor writer |
| `quayside-core` | Rust library crate, no I/O | Event types, canonical encoding, hash chain, pure reducer, constraint engine, solver, Cedar entity construction |
| `quayside-web` | TypeScript, React 18, Vite, generated OpenAPI client | Gantt, inbox, proposal panel, audit panel, trace link |
| Static and reverse proxy | nginx (unprivileged image, pinned digest) | Serves web assets; proxies `/api` and `/ws`; demo replica pinning |
| Infrastructure | TypeScript, AWS CDK | VPC, ECS services, RDS, SQS, S3 (with Object Lock), Cognito, ALB, IAM, Secrets Manager |
| Local orchestration | Docker Compose | The same images, with stand-ins for managed services (E) |
| Tests | Rust test harness, proptest, Playwright (TypeScript) | Unit, property, integration against Postgres, cross-replica and multi-session end-to-end tests |

Rust is chosen for the API and worker because the correctness-sensitive parts (commit ordering, transactions, the reducer, canonical encoding and the solver) benefit from exhaustive matching and from one statically linked binary. TypeScript is chosen for the UI because the React ecosystem meets the interaction expectations most directly. Postgres is chosen because the design relies on four of its features: deferrable exclusion constraints with `btree_gist`, `LISTEN`/`NOTIFY` (transactional), row-level security with security-barrier views, and transaction-scoped advisory locks for the commit order.

### D.2 Persistence model

The source of truth is the event log. Read models are tables updated in the same transaction. Sequence positions and identifiers used in the seed file are fixed, and the reset restarts identity sequences so positions are reproducible.

```sql
CREATE TABLE streams (
  stream_id   uuid PRIMARY KEY,
  stream_kind text NOT NULL,              -- 'berth' | 'visit' | 'proposal' | 'import' | 'forecast' | 'system'
  head_seq    bigint NOT NULL DEFAULT 0,
  head_hash   bytea  NOT NULL DEFAULT '\x00',
  version     bigint NOT NULL DEFAULT 0   -- optimistic concurrency token returned to clients
);

CREATE TABLE events (
  global_pos        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stream_id         uuid   NOT NULL REFERENCES streams,
  seq               bigint NOT NULL,
  event_type        text   NOT NULL,
  payload           jsonb  NOT NULL,      -- derived from canonical; for queries only
  canonical         bytea  NOT NULL,      -- exact bytes that are hashed; authoritative
  actor             text   NOT NULL,
  subject_carrier_id text,                -- carrier whose visit the event concerns; null for terminal-wide events
  decision_id       uuid,                 -- Cedar decision that authorized the command
  causation_id      uuid,                 -- command or job that produced it
  trace_id          text,                 -- observability metadata, deliberately not hashed
  occurred_at       timestamptz NOT NULL, -- supplied by the injected clock, not the database default
  prev_hash         bytea  NOT NULL,
  hash              bytea  NOT NULL,      -- sha256(prev_hash || canonical)
  UNIQUE (stream_id, seq)
);

CREATE TABLE decisions (
  decision_id   uuid PRIMARY KEY,
  principal     text NOT NULL,            -- 'Planner::"..."', 'System::"forecast-worker"', etc.
  action        text NOT NULL,
  resource      text NOT NULL,
  result        text NOT NULL,            -- 'allow' | 'deny'
  policy_sha256 bytea NOT NULL,
  request_hash  bytea NOT NULL,
  at            timestamptz NOT NULL
);

CREATE TABLE visits (
  visit_id uuid PRIMARY KEY, carrier_id text NOT NULL, vessel_imo text NOT NULL,
  loa_m numeric NOT NULL, draft_m numeric NOT NULL, crane_moves int NOT NULL,
  eta timestamptz NOT NULL, status text NOT NULL, version bigint NOT NULL
);

-- Visits and holds share one table, so the exclusion constraint covers both.
CREATE TABLE slots (
  slot_id      uuid PRIMARY KEY,
  berth_id     uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('visit', 'hold')),
  visit_id     uuid REFERENCES visits,
  hold_id      uuid,
  carrier_id   text,                      -- denormalised from the visit for row-level security; null for holds
  span         tstzrange NOT NULL CHECK (lower_inc(span) AND NOT upper_inc(span)),  -- [start, end)
  berth_version bigint NOT NULL,
  CHECK ((kind = 'visit') = (visit_id IS NOT NULL)),
  EXCLUDE USING gist (berth_id WITH =, span WITH &&) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE proposals (
  proposal_id uuid PRIMARY KEY, base_versions jsonb NOT NULL, moves jsonb NOT NULL,
  input_hash bytea NOT NULL, solver_version text NOT NULL, seed int NOT NULL,
  iterations_used int NOT NULL, iteration_cap int NOT NULL,
  status text NOT NULL,                   -- 'open' | 'partial' | 'accepted' | 'superseded' | 'dropped'
  source text NOT NULL                    -- 'planner' | 'forecast' | 'rebase'
);

CREATE TABLE snapshots (
  stream_id uuid, seq bigint, state jsonb,
  last_hash bytea NOT NULL,               -- hash of the event at (stream_id, seq); checked on load
  PRIMARY KEY (stream_id, seq)
);

CREATE TABLE outbox (
  msg_id uuid PRIMARY KEY, topic text NOT NULL, body jsonb NOT NULL,
  trace_context jsonb, created_at timestamptz NOT NULL, published_at timestamptz
);

CREATE TABLE idempotency (
  principal text NOT NULL, key text NOT NULL, request_hash bytea NOT NULL,
  response jsonb, created_at timestamptz NOT NULL,
  PRIMARY KEY (principal, key)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY, recipient text NOT NULL, visit_id uuid, body text NOT NULL,
  created_at timestamptz NOT NULL, read_at timestamptz
);

CREATE TABLE import_failures (...);       -- quarantined messages after five receives
CREATE TABLE tide_windows (berth_id uuid, span tstzrange, max_draft_m numeric);
CREATE TABLE wind_limits  (berth_id uuid, span tstzrange, max_wind_kn numeric);
```

**Canonical encoding.** `canonical` is the JSON Canonicalization Scheme (RFC 8785) of the object `{stream, seq, type, payload, actor, subject_carrier_id, decision_id, causation_id, occurred_at}`. The application builds the bytes before insert, so the hashed value is fully known to the application and does not depend on `jsonb` normalisation. `trace_id` is excluded deliberately: trace context is observability metadata, not evidence, and the stage makes no claim about it. The hash of each event is `sha256(prev_hash || canonical)`, where `prev_hash` is the stream head at the time of the append, and genesis is 32 zero bytes.

**Deferrable exclusion.** `slots` makes double-booking a database fact. Spans are half-open `[start, end)` everywhere, and the constraint, the constraint engine and the rebase solver all use that convention. Boundary tests cover a move ending at 16:00 and another starting at 16:00 (permitted) and a one-second overlap (refused).

**Hash-chain scope.** Chains are per stream. The reason is per-stream verification and per-berth proofs that do not require reading the whole log. It is not parallel commit, which is withdrawn (Revision log).

**Snapshots.** A snapshot stores the state of a stream at a sequence number and the hash of the event at that sequence. The loader compares that hash with the event row. A mismatch discards the snapshot, logs `snapshot_invalid`, and falls back to full replay. Snapshots are written asynchronously by the worker, so they may lag; they are never trusted without the link.

**Decision principal names.** Every decision row names a principal in Cedar entity syntax. Human principals are `Planner::"tomas"` and similar. The forecast worker is `System::"forecast-worker"`. The policy has explicit entries for it (D.5).

### D.3 Commit order and the reader rule

This section fixes the single ordering protocol. It answers A1, B1 and C1.

**Writer.** Every transaction that appends events performs these steps in order:

1. Authenticate the request and evaluate Cedar. Write the decision row in this transaction.
2. Begin the transaction and take the plan-commit lock: `SELECT pg_advisory_xact_lock(<fixed key>)`. The lock is held until the transaction commits or rolls back.
3. Read the stream heads named by the command and compare the client's base versions. On mismatch, roll back the event work, and commit a short transaction that records the decision, the 409 response and the idempotency record. That short transaction also takes the lock, so the 409 response is ordered like everything else.
4. Run the constraint engine on the locked snapshot. Violations append `MoveRejected` events and commit.
5. Append events. Each insert allocates `global_pos` from the identity sequence. Because the lock is held, allocation order equals commit order. Update projections, write outbox rows, call `NOTIFY plan_changed, '<from>:<to>'` and commit.

**Consequence.** Positions are allocated only while the lock is held. If position N is visible to any reader, every position below N was allocated by a transaction that has since committed or rolled back. A transaction that starts after N was allocated cannot obtain a position below N, because it waits on the lock. Holes in `global_pos` are rolled-back transactions and are permanent.

**Reader rule.** A cursor is the highest `global_pos` a session has applied. A read returns every visible or placeholder position above the cursor in ascending order. The cursor advances to the highest position returned. Positions absent from the result are rolled-back holes and are never delivered. No overlap window is needed, and no dedupe window is needed. Dedupe by `global_pos` is still applied at the client as a guard against replayed messages.

**Reducer requirement.** The reducer consumes events in ascending `global_pos`, and it requires that each stream's `seq` values are contiguous in that order. A violation is a reducer error that stops the session and triggers a full resync from position zero. The verifier checks the same two properties.

**Cost of the protocol.** All event-appending transactions are serialised by one lock. This removes parallel commit. The lock is held for the duration of a commit, so its hold time is a measured quantity that is reported after measurement (F4). For a terminal of roughly 60 visits and the command rates in the script, the design does not expect the lock to be a limit, but the claim is made only after measurement.

### D.4 Communication, routing and the forecast path

- **Synchronous (browser to API).** JSON over HTTPS with generated OpenAPI types. Mutating endpoints require `Idempotency-Key` and the base versions.
- **Real-time (API to browser).** One WebSocket per session at `/ws`. The client sends `{resume_from: global_pos, filter}`. The server returns positions from the `events_for_principal` view (D.6) in order, then pushes live commits in the same order. A ping every 25 seconds keeps both the ALB idle timeout and the nginx timeout from firing.
- **Intra-cluster fan-out.** `NOTIFY` is issued inside the commit transaction and delivered at commit. Each API replica holds one dedicated, non-pooled connection that `LISTEN`s. On notification it re-reads from each connected socket's cursor. RDS Proxy is not used for this connection, because it does not support `LISTEN`.
- **Asynchronous (API to worker).** Transactional outbox. A relay task polls `outbox` with `FOR UPDATE SKIP LOCKED`, sends each row to SQS with the trace context as message attributes, and marks it published after the send succeeds. Delivery is at-least-once; consumers are idempotent on `msg_id`.
- **Uploads.** Browser to S3 directly by presigned `PUT`, for manifests and forecast files alike. Completion is an API call (`POST /imports/complete` or `POST /forecasts/complete`) that verifies the object exists and enqueues the job through the outbox. The forecast file is stored under a content-hash key; its hash is the idempotency key for `ForecastApplied`.
- **Demo replica pinning.** For the trace beat only, the demo environment routes by query parameter. A request or WebSocket upgrade with `?replica=a` is forwarded to the single-task target group for replica A; `?replica=b` to replica B; no parameter goes to the shared target group. The browser client copies the parameter onto every request and onto the WebSocket URL for that window. The API ignores the parameter. Production builds omit the routing rules, and the client omits the parameter when the environment is not demo. Locally, nginx maps the same parameter to two upstreams. This is the mechanism by which the Harbourmaster commit lands on replica A and Priya's socket is served by replica B.

### D.5 Security boundaries, identity and anchors

Boundaries, outside in:

1. **Edge.** TLS 1.2+ at the ALB (ACM certificate) or nginx locally. No public access to other ports. Security headers and a strict Content-Security-Policy on web assets.
2. **Identity.** Cognito user pool (AWS) or mock OIDC issuer (local) issues tokens. The API accepts ID tokens only: `token_use` must be `id` and `aud` must equal the app client ID. Signatures are checked against cached JWKS, and `iss` and `exp` are checked. `cognito:groups` and `custom:carrier_id` are read from the ID token, because Cognito places custom attributes in ID tokens by default. Access tokens are not accepted by the demo API. The API rejects tokens without a known group. The mock issuer is configured to emit ID tokens with the same claim names.
3. **Authorization.** Cedar policies in one file, hashed into every decision row. Principal types: `Planner`, `Harbourmaster`, `CarrierAgent` (with `carrier_id`), `Auditor`, `System`. Resource types: `Berth`, `Visit`, `Slot`, `Proposal`, `Forecast`, `Import`, `AuditView`. Actions: `view`, `propose_move`, `accept_proposal`, `hold`, `load_forecast`, `import`, `verify`, `replay`, `acknowledge`.

   Abbreviated policy (the authoritative file is in the repository):

   ```cedar
   // Carriers see their own visits and the slots of their own visits only.
   permit (principal is CarrierAgent, action == Action::"view", resource is Visit)
     when { resource.carrier_id == principal.carrier_id };
   permit (principal is CarrierAgent, action == Action::"view", resource is Slot)
     when { resource.kind == "visit" && resource.carrier_id == principal.carrier_id };

   // Planners propose and hold; only the harbourmaster accepts.
   permit (principal is Planner, action == Action::"propose_move", resource is Berth);
   permit (principal is Planner, action == Action::"hold", resource is Berth);
   permit (principal is Harbourmaster, action == Action::"accept_proposal", resource is Proposal);
   forbid (principal is Planner, action == Action::"accept_proposal", resource is Proposal);

   // The forecast worker is a defined principal with one narrow entry.
   permit (principal == System::"forecast-worker", action == Action::"propose_move", resource is Berth)
     when { context.source == "forecast" };

   permit (principal is Harbourmaster, action == Action::"load_forecast", resource is Forecast);
   permit (principal is Auditor, action == Action::"replay", resource is AuditView);
   permit (principal is Auditor, action == Action::"verify", resource is AuditView);
   ```

4. **Data.** Row-level filtering is applied in two layers. The application filters each candidate row by a Cedar decision and bounds page size. Postgres row-level security applies to the carrier and auditor roles, which read through views (D.6), so a missed application filter cannot return another carrier's rows. Claim F3 tests that the two layers agree.
5. **Database.** The API role can `INSERT` into `events`, `decisions`, `outbox` and `idempotency`, and cannot `UPDATE` or `DELETE` them. The worker role can update `outbox.published_at` and insert `snapshots`. Migrations use a separate role. The verifier role is read-only on `events`, `streams` and `snapshots`, and can read the anchor bucket. The tamper beat uses a superuser session, which is the point: the verifier detects the change.
6. **Anchors.** Every commit enqueues a `checkpoint` outbox message carrying its `global_pos`. The worker computes the head of every stream as of that position from the event rows, and writes an object `anchors/<global_pos>.json` to a bucket with S3 Object Lock in compliance mode. Locally, MinIO with object lock provides the same semantics. Several queued checkpoints coalesce: the worker writes the highest one it has read. The verifier compares each stream's stored head with the anchor at or below the latest position and reports the anchored position. Events after the latest anchor are reported as unanchored, not as verified.
7. **Network.** Private subnets for API, worker and RDS. Security groups allow Postgres only from the API and worker groups. VPC endpoints for ECR, S3, SQS and Secrets Manager.
8. **Secrets and IAM.** Database credentials in Secrets Manager, injected at task start. Task roles grant only the SQS queue and S3 prefixes each service needs. No long-lived keys.

Authorization is single-sourced in the sense that the client never decides permissions. It asks `POST /api/me/capabilities`, the server calls the same Cedar evaluation on submit, and the database role applies the same rule through views.

### D.6 Policy inventory

Every table and view that a client, worker or verifier can read or write, and the rule that governs it.

| Table or view | Written by | Read by (role) | Row rule | Notes |
|---|---|---|---|---|
| `events` | API command transaction (`INSERT` only) | Auditor: all rows. Planner, Harbourmaster: via `events_for_principal`. Carrier: via `events_for_carrier` | Planner and Harbourmaster: full content. Carrier: content only where `subject_carrier_id` equals her carrier, otherwise the view returns `global_pos` with null payload and null event type | Carriers have no grant on the base table; the view is a security-barrier view that reads `current_setting('quayside.carrier_id')` |
| `streams` | API command transaction | Auditor, verifier | none | Carrier and Planner read heads only through API responses |
| `decisions` | API, including denials | Auditor, Harbourmaster (own actions) | Auditor: all. Harbourmaster: rows where principal is herself | Carrier: none |
| `visits` | API projections | Planner, Harbourmaster, Auditor: all. Carrier: RLS on `carrier_id` | Carrier rows only for her carrier | Planner's view is terminal-wide, as the plan requires |
| `slots` | API projections | Planner, Harbourmaster, Auditor: all rows. Carrier: RLS `kind = 'visit' AND carrier_id = current carrier` | Holds are invisible to carriers. Other carriers' slots are absent from the carrier's responses, not drawn | Exclusion constraint is independent of reads |
| `proposals` | API, worker | Planner, Harbourmaster, Auditor | none beyond role | Carriers have no grant. A proposal naming other carriers' visits is never visible to a carrier |
| `snapshots` | Worker (`INSERT`) | API replay path (Auditor, Planner, Harbourmaster) | Read only through the replay endpoint | Carrier: none. Snapshots carry the same content as events, so carrier replay uses the filtered view and never snapshots |
| `outbox` | API (`INSERT`), relay (`UPDATE published_at`) | Worker, relay | none | No human read path. Auditor sees outbox state through the trace |
| `idempotency` | API | API only | keyed by principal | Responses stored for replay are scrubbed of other carriers' data before storage |
| `notifications` | Worker | Recipient only (RLS `recipient = principal id`) | recipient | Carrier sees Northwind notifications only |
| `tide_windows`, `wind_limits` | Import, forecast worker | All authenticated roles | none | Terminal-wide reference data |
| `import_failures` | Worker | Harbourmaster, Auditor | none | |
| Anchor bucket | Worker | Verifier (read-only), Auditor through the API | none | Object Lock prevents deletion within retention |

The carrier view is the only path by which a carrier reads events, which means replay, live push and reconnect all use one rule.

### D.7 Consistency requirements per operation

| Operation | Consistency requirement | Mechanism |
|---|---|---|
| Propose move | Planner's base versions are the versions the proposal is built on | Client sends base versions; server stores them in the proposal |
| Accept proposal (multi-berth) | All moves or none; no double booking; no lost update | Plan-commit lock; version comparison under the lock; deferred exclusion at commit (D.3) |
| Hold | Single-berth; same path as a single move | Hold as a `slots` row of kind `hold` (D.2) |
| Forecast ingest | Exactly-once effect from one forecast file | Content hash is the idempotency key for `ForecastApplied`; outbox row in the same transaction |
| Worker solver run | At-least-once delivery may run twice | Job keyed by `(forecast_hash, input_hash)`; a second run produces the same proposal and is de-duplicated by the unique key; a second acceptance is refused as already applied |
| Notification | At-least-once, shown once per recipient | `notifications` row keyed by `(msg_id, recipient)` |
| Real-time push | Each authorised session applies every position once, in ascending `global_pos` | Commit lock and reader rule (D.3); client dedupe by `global_pos`; cursor resume |
| Read after write (same session) | Read-your-writes | Projection committed in the command transaction; response includes the new `global_pos` |
| Replay | Deterministic result for a position | Pure reducer; snapshot used only when its hash link verifies |
| Verification | Detects a change to a committed event; detects a rewrite of anchored heads; reports unanchored events | Canonical bytes, per-stream hash chain, external anchors, read-only verifier |

Strict serialisability is not required for the whole terminal, and the design does not provide it beyond the commit order above. Reads may observe the plan at different positions across sessions. The status line shows each session's applied position rather than hiding the difference.

### D.8 Deployment topology

AWS (one region, two availability zones for the ALB and subnets; RDS single-AZ for the demo, with the Multi-AZ option documented):

```
Internet -> ALB (HTTPS, ACM) -> target group "web" (ECS Fargate, nginx)
              |  /api/*, /ws -> target group "api" (shared, both tasks)
              |  /api/*, /ws?replica=a -> target group "api-a" (task A, demo only)
              |  /api/*, /ws?replica=b -> target group "api-b" (task B, demo only)
                                 |-> RDS PostgreSQL 16 (private)
                                 |-> SQS (outbox queue, DLQ)
                                 |-> S3 (imports, forecasts, anchors with Object Lock)
ECS Fargate "worker" (1-2 tasks) <- SQS
Cognito user pool (hosted login disabled; API-based token issuance for demo accounts)
ADOT collector sidecar -> X-Ray; CloudWatch Logs for stdout
```

The API runs as two single-task ECS services in the demo environment, so each task has its own pinned target group, and each is also listed in the shared group. Production uses one service with two tasks and omits the pinned rules.

---

## E. AWS and local deployment

### Principle

There is one set of application artifacts: three container images, built once per commit, pushed to ECR and to a local registry under the same digest. Nothing is baked per environment. Configuration arrives as environment variables and mounted files whose names are identical in both environments. The local stack is the production topology with managed services replaced by protocol-compatible local servers that the same SDK code uses.

### Images

| Image | Base | Contents |
|---|---|---|
| `quayside-api` | `gcr.io/distroless/cc-debian12`, pinned by digest | Static Rust binary with subcommands `serve`, `migrate`, `verify`, `demo-reset` (refused unless `QUAYSIDE_ENV=demo`) |
| `quayside-worker` | same base | Same binary, subcommand `worker`; shares all layers with the API except the entrypoint |
| `quayside-web` | `nginxinc/nginx-unprivileged`, pinned by digest | Built assets from the Node build stage, and nginx configuration routing `/api` and `/ws` with demo pinning |

Build rules: a multi-stage Dockerfile with `cargo-chef` for dependency caching; `Cargo.lock` and `package-lock.json` committed; base images pinned by digest; `SOURCE_DATE_EPOCH` set so layers are reproducible; each image tagged with the git SHA and content digest; ECR tag immutability enabled; deployment references only digests. An SBOM is generated per image and stored with the image metadata.

### Service mapping

| Concern | AWS | Local (Compose) | Behaviour difference | Why observable behaviour is unchanged |
|---|---|---|---|---|
| Relational store | RDS PostgreSQL 16 | `postgres:16` | RDS manages backups and failover | Same engine, extensions (`btree_gist`), SQL, advisory locks and RLS |
| Queue | SQS standard queue with DLQ | ElasticMQ | Visibility and redrive details differ | Same SDK calls and attributes; both 30 s visibility and max receive 5 |
| Object storage | S3 with presigned PUT and Object Lock | MinIO with object lock | Bucket policy and encryption defaults differ | Same presigned flow; path-style addressing locally |
| Identity | Cognito user pool, JWKS | `navikt/mock-oauth2-server`, pinned | No hosted UI; claim names mapped by config | Same verification code; the mock emits ID tokens with the same claim names |
| Load balancer | ALB with path and query rules, WebSocket support | nginx with `map` on `$arg_replica` | ALB idle timeout default 60 s | Both set to 120 s; server pings every 25 s |
| Secrets | Secrets Manager at task start | `.env` read by Compose, same variable names | No rotation locally | Application reads env vars only |
| Tracing | ADOT collector to X-Ray | OTel collector to Jaeger | Different UI | Same OTLP export |
| Logs | CloudWatch Logs | stdout to Compose logs | None observable | JSON logs with the same fields |
| Scheduling | EventBridge rule for verifier | Not run in the demo | Schedule source differs | Same `verify` subcommand |
| Email, SMS | Not used | Not used | In-app notifications only; SES behind an interface, disabled | Avoids a live third-party dependency |

### Token lifetimes

Configured values, identical in both environments and held in one configuration file that the mock issuer and the Cognito deployment both read.

| Token | AWS (Cognito app client) | Local (mock-oauth2) |
|---|---|---|
| ID token (used by the API) | 8 hours | 8 hours |
| Access token (not accepted by the demo API) | 8 hours | 8 hours |
| Refresh token | 12 hours | 12 hours |

The client refreshes the ID token in the background before expiry. The rehearsal exercises a refresh before the talk.

### Topology locally

`docker compose up` starts: `postgres`, `elasticmq`, `minio` (object lock enabled), `mock-oauth2`, `otel-collector`, `jaeger`, `migrate` (run once), `api` (two replicas, `api-a` and `api-b` services for pinning), `worker`, `web` (nginx). `quayside up` waits on the readiness endpoints of every service before printing URLs. `quayside demo reset` produces the same initial state on every run.

### What differs and why behaviour is unchanged

The differences that matter are the ones an audience could notice, and none changes a demonstrated behaviour. The cross-replica path is exercised locally with two API replicas, because NOTIFY delivery across processes is the claim being demonstrated. The tamper demonstration works identically on RDS, because it needs only a superuser session, which the demo account has on both; the verifier reads only the event tables and the anchor bucket.

Two behaviours are intentionally different and documented: RDS failover (not exercised in the demo; reconnection logic is tested by killing the local Postgres connection) and Cognito-specific behaviour such as hosted UI and revocation (tested only in the AWS deployment).

---

## F. Five strongest technical claims

Each claim has an executable test or an observable behaviour. Tests run in the stack gate, not per change.

**F1. Single commit order: no double booking and no partial multi-berth commit, under concurrency.**
Claim: an accept of a multi-berth proposal commits all moves or none; two concurrent accepts whose spans overlap on one berth can never both succeed; and no position is visible above an uncommitted lower position.
Test: an integration test runs 50 concurrent accept requests with randomly overlapping move sets against real Postgres. It asserts (a) every successful accept's events are present with contiguous `seq` per stream, (b) no `slots` pair violates the exclusion constraint, (c) every failed accept has no events, (d) the number of applied moves equals the number of `MoveApplied` events, and (e) no reader observes a `global_pos` whose lower neighbour is uncommitted. A second variant kills the API process between the event inserts and the commit; the test asserts no trace of the transaction remains.
Observable on stage: the 409 banner at 90-120 s.

**F2. The read model is exactly a replay of the event log, and snapshots are checked.**
Claim: for any `global_pos`, the projection state equals the fold of the pure reducer over events up to that position; a snapshot is used only when its hash link verifies, and snapshot-plus-tail equals full replay.
Test: proptest generates random valid command sequences over the reducer and compares the projection read from Postgres with the reducer output at every position. A second property compares snapshot-plus-tail with full replay at random snapshot points, and a third corrupts a snapshot's `last_hash` and asserts fallback. The demo data is verified the same way, and the state hash is printed at the end of reset.
Observable on stage: the auditor's historical plan at 225-250 s matches the projection hash recorded for that position, which the rehearsal checks.

**F3. Authorization is single-sourced: what the UI offers equals what the server accepts, and the database agrees.**
Claim: for every principal type, resource and action in the demo data, the set of actions returned by `POST /api/me/capabilities` equals the set the server accepts, and the server rejects every other action. Through the carrier and auditor database roles, the views return exactly the rows the application would return, and placeholders in replay match the application's visibility.
Test: a generated matrix (demo accounts plus synthetic principals with every carrier ID, times resources, times actions) runs in one test. For each cell the test calls the capabilities endpoint, attempts the action, and asserts equality. The same cells are run through the database role's views and compared with the application's filtered replay.
Observable on stage: Priya's window at 0-30 s and 150-180 s, and the absence of other carriers' content in the network panel.

**F4. Post-commit, cross-replica, resumable delivery with a single commit order.**
Claim: every committed event reaches every authorised session once and in `global_pos` order, even when the session's socket is severed, the delivering replica differs from the committing replica, and a rolled-back transaction is never delivered.
Test: a harness with two pinned API replicas and four WebSocket clients. It commits on replica A and asserts delivery through replica B; the latency is recorded as a measured quantity against a target (p95 under 300 ms on the local stack, to be measured and reported with the measurement). A second test forces a rollback after `NOTIFY` is queued and asserts no client receives the event. A third closes a client's socket after position N, produces M further positions, reconnects with cursor N, and asserts the client's reducer state equals the server projection with no duplicate application. A fourth attempts a commit while a lower-position transaction holds the plan-commit lock and asserts that the second commit waits and receives a higher position only after the first finishes.
Observable on stage: the status line at 150-180 s, the withheld placeholders, and the three-window update at 120-150 s.

**F5. The rehearsal is the demo, and its invariants hold in two variants.**
Claim: the five-minute sequence runs as an automated multi-session end-to-end test on both the local stack and the AWS deployment, from the same reset state, and asserts the table in Section C. Two variants run off-stage: variant A is the script as written; variant B changes the planner's hold span and the forecast's wind limit so that the rebase drops a different move and the forecast cut is taken. Both variants must end with every invariant green: F1's assertions, the verifier green before the SQL and red after it at the named target, and the trace containing the accepted commit.
Test: Playwright with four browser contexts, each with stored sign-in state for one demo account. Variant runs are parameterised by the hold, the proposal selection and the forecast file. The recording of variant B is stored as evidence, not shown on stage.
Observable on stage: the presenter runs variant A once before the talk. The reset prints the position, the state hash and the anchored position, and the rehearsal checks each against the fixture.

Each claim is backed by a test that can fail. Claims that are observable on stage let an expert in the audience check the claim against what they are seeing.

---

## G. Failure analysis

### Implementation difficulties

- **Commit lock throughput.** Serialising event appends is the price of the commit order (D.3). The lock is held for a whole commit, including projections and outbox writes, so lock hold time is the quantity to watch. It is measured on the local stack and on AWS before any throughput claim is made. If it proves to be a limit, the remedy is to shorten the critical section (move the decision write and the response write outside it), not to weaken the order.
- **`NOTIFY` and connection poolers.** `LISTEN` needs a session-level connection. Pooling in transaction mode breaks it silently. The listener is a dedicated connection with a health check that re-subscribes and triggers a catch-up read from each socket's cursor. This is the most likely source of "real-time works locally but not on AWS" faults, and it is under test (F4).
- **Rolled-back holes.** Rolled-back transactions leave holes in `global_pos`. The reader rule (D.3) ignores holes by design. Metrics count holes so that a sudden rise is visible.
- **Deferrable exclusion errors.** A violation at commit surfaces as a generic error. The commit path re-checks the conflicting span with the constraint engine before commit, so the explanation (4) is produced for the cases that matter most.
- **Cedar list filtering.** Per-row evaluation costs one evaluation per candidate. Replay for a carrier scans events, so page size and scan limit are bounded and the cost is measured.
- **Snapshot lag.** Snapshots are written asynchronously and may lag. Replay starts from the newest snapshot whose link verifies, and the verifier checks snapshots against replay.
- **Solver reproducibility across builds.** The solver uses integer minutes, integer costs, a fixed iteration order and no wall-clock input. The proposal records `solver_version`, seed and `input_hash`. Replaying an old proposal on a newer build reports a version mismatch rather than a silent difference.
- **Cross-service trace propagation.** Trace context must survive the outbox row, the SQS message attributes and the worker span. A break produces a broken waterfall on stage, so trace continuity is part of the stack gate.

### On-stage failure modes and mitigations

| Failure | Effect on stage | Mitigation |
|---|---|---|
| WebSocket drops mid-script | Views stop updating | Reconnect with cursor; status line shows the resumed state. The drill at 150-180 s is rehearsed deliberately |
| Solver reaches its iteration cap | Proposal is `partial` | `partial` proposals cannot be accepted on the demo path. The rehearsal asserts that the demo proposals are complete |
| Worker slow to pick up forecast | Pipeline chip sits at "queued" | Cut rule at 210 s (script). Beat 210-225 is then skipped and the trace uses the rebase acceptance |
| Local Docker or network failure | Stack down | AWS is the primary target; local stack is the fallback with identical images. Reset is one command; the second display is ready |
| AWS task replaced during demo | Brief connection loss | Two tasks; the reconnect path (F4) handles it; rehearsed by stopping a task |
| Pinned replica unhealthy | Trace beat cannot place a request | The pinned target group is checked by the rehearsal before the talk; if a pinned replica is unavailable, the trace beat uses the shared group and the presenter says so in one sentence |
| Cognito token issue | Login fails | Sessions signed in before the talk; refresh exercised in rehearsal |
| Browser or window layout | Clutter | Windows created by the reset script at fixed positions; presentation mode |
| SQL statement typo in tamper beat | Breaks the climax | Statement stored in a file, executed by one command; rehearsed |
| Audience asks for a non-seeded scenario | Unrehearsed path | The application is general; the presenter can create a visit through the import panel. The import path is core, not a demo shortcut |

### Known limitations, stated

- **Carriers can count positions.** Placeholders reveal that activity happened at a position, and the carrier can count positions. They do not reveal content. This is accepted, and the stage line says "withheld", not "none".
- **Unanchored window.** Events after the latest anchor are reported as unanchored. A superuser who rewrites the chain and every head after the latest anchor is not detected until the next anchor. The stage sentence at 250-265 s states this.
- **Object Lock retention.** Retention is a configured value. The demo value and the production value are separate configuration entries and are not the same policy decision.
- **Solver is not optimal.** It is a bounded greedy construction followed by min-conflicts repair, and it does not prove optimality.

### Hidden complexity

- Half-open spans, the exclusion constraint, the constraint engine and the rebase solver must agree on overlap. Boundary tests cover them together.
- Time zones and tide tables. Times are `timestamptz` and rendered in terminal local time. Tide windows come from a fixed table, not astronomy, and the UI says so.
- The worker is a second process with its own failure modes. A poison forecast file must not block the queue; the worker quarantines a message after five receives into `import_failures`, visible to the Harbourmaster and auditor.
- Clock injection. Every time-dependent computation, including `occurred_at`, takes the clock as input. The demo uses the fixed scenario clock; production uses the system clock.
- Canonical encoding. Changing the canonical encoding changes every hash, so the encoding is versioned in the event type namespace, and the verifier refuses an unknown version.

### Features that look impressive but are technically shallow

- **The Gantt.** A well-made timeline and the least technical part of the demo. Its value is that it makes the other claims visible.
- **Time-travel scrubber.** The scrubber addresses `global_pos` and shows the projection hash at that position. The non-trivial part is the fold, which is tested in F2.
- **"Verify chain".** Hash chains are standard. The credibility depends on the tamper beat being real and on the anchors being outside the database.
- **The solver.** Greedy construction with repair. The proposal reports moves, reasons and iterations, which is honest about what it does.
- **Rebase.** A re-solve on a smaller input with fixed moves. It can drop moves, and the UI says which and why.
- **"Multi-tenant".** Not present. One terminal; carriers are scopes within it.
- **OIDC.** The local issuer produces ID tokens and the verification code is the same. Cognito-specific behaviour is tested only in AWS.
- **Notifications.** An inbox table and a list. No email or SMS, deliberately.
- **Observability.** The trace waterfall is a real trace. A dashboard of graphs would add nothing to the argument and is not built.

---

## H. Feasibility

Feasibility is expressed by what each layer touches and by dependency order. Each layer is runnable and testable on its own.

### Scope by layer

| Layer | Components touched | Depends on | Unblocks |
|---|---|---|---|
| 1. Core vertical slice | `quayside-core` event types, canonical encoding, hash chain, reducer; `events`, `streams`, `visits`, `slots` schema with holds; one command (`move_visit`); the commit lock; one projection; one read endpoint; one berth page | none | everything |
| 2. Authorization | Cedar policy file, entity construction from ID-token claims, `decisions` table, `System` principal, `capabilities` endpoint, UI affordances, RLS views (D.6) | 1 | 3, carrier view |
| 3. Constraints and commit | Constraint engine, deferrable exclusion, version checks under the lock, proposals table, multi-berth accept, 409 path, holds | 1, 2 | 4, 5 |
| 4. Real-time | `NOTIFY` on commit, dedicated listener, WebSocket endpoint, cursor reader rule with placeholders, client reducer, status line, demo replica pinning | 1, 2 | three-window choreography |
| 5. Solver and rebase | Pure solver in core (iteration cap only), proposal generation, ghost overlay, rebase on subset with holds as constraints, `input_hash` | 3 | forecast worker |
| 6. Outbox, queue, worker, forecast and import | Outbox table and relay, SQS and ElasticMQ, worker subcommand, presigned uploads and completion endpoints, forecast ingest, idempotent consumers, poison quarantine | 1, 3, 5 | forecast beat, notifications |
| 7. Replay, snapshots, verifier, anchors | Snapshot writer with hash link, replay API, verifier subcommand, checkpoint messages, Object Lock anchor writer, auditor view and diff | 1 | tamper beat |
| 8. Tracing and health | OTel instrumentation across API, worker and SQS attributes; Jaeger and X-Ray; `/healthz` and `/readyz` | 1, 6 | trace beat |
| 9. Images and infrastructure | Dockerfiles, digests, Compose, CDK stacks (VPC, RDS, SQS, S3 with Object Lock, Cognito, ECS, ALB with pinned rules, IAM, Secrets), migrate task | 1 onward, progressively | AWS rehearsal |
| 10. Demo tooling and rehearsal | Seed file, `demo-reset` with identity restart, Playwright multi-session script, variants A and B, fixture checks, evidence capture | all | talk |

Layers 2 and 4 can proceed in parallel after layer 1. Layers 5, 6 and 7 are independent of each other after layer 3. Layer 9 starts with the images in layer 1 and expands with each layer, so the AWS deployment is exercised continuously.

### Critical dependencies

- **Cedar Rust crate.** Policy language stability and validation tooling. The validator is a hard dependency for F3.
- **Postgres features.** `btree_gist`, deferrable exclusion, advisory locks, transactional `NOTIFY`, RLS with security-barrier views. Each has a configuration that must match on RDS.
- **ALB behaviour.** Path and query-string rules for pinning, WebSocket upgrades, idle timeouts, stickiness off. Verified in AWS early, because a failure changes the real-time design.
- **S3 Object Lock and MinIO compatibility.** Compliance-mode retention must behave the same locally and in AWS. Verified with the pinned SDK versions.
- **Cognito ID-token claims.** Confirmed in a test pool that `custom:carrier_id` and `cognito:groups` appear in the ID token for the demo app client.
- **ElasticMQ, MinIO, mock-oauth2 versions.** Pinned and tested with the SDK versions used.
- **Playwright multi-context support** for four sessions with distinct storage state.

### Main risks

1. **The commit lock limits throughput more than expected.** The mitigation is measurement of lock hold time on both environments, and the shorter critical section described in G, before any throughput claim is made.
2. **Cross-replica NOTIFY and pinned routing behave differently on RDS and ALB than locally.** The mitigation is an early AWS spike of layers 4 and 9 with two pinned services, before demo content depends on them.
3. **The solver's output is not impressive enough visually.** Each move has a reason on the proposal card. The seed is the product default and is not chosen for the demo; the golden proposal and the seed sweep are published as evidence once measured.
4. **Browser choreography is brittle.** Four sessions, WebSocket timing and animations can break a scripted presentation. Mitigations are rehearsal in F5, deterministic completion events, and a presentation mode without transitions.
5. **The forecast beat is cut.** The cut rule is explicit and the trace has a named fallback. The beat is independent of the rest, so the cut does not affect the replay, the tamper or the trace.
6. **The tamper beat triggers a security question.** The presenter states the limit in one sentence: the verifier detects a change to a committed event, anchors detect a rewrite of anchored heads, and events after the last anchor are not yet anchored.

The design's central bet is that a small number of well-understood primitives, each tested in isolation, produce a demonstration whose every visible moment traces to a specific mechanism. Where a mechanism has a limit, the limit is stated on stage or in the failure analysis rather than left for an expert to find.
