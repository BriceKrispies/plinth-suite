# Proposal 04: Emergent Composition

**Product title: Quayside, a berth-plan control room for a container terminal**

**Pitch.** Quayside is a shared, contested berth plan for a container terminal, where planners, a harbourmaster, a carrier's agent and an auditor act on the same state at the same time. Every behaviour in the five-minute demo comes from a small set of primitives (an append-only event store with per-stream hash chains, synchronous projections, a policy engine, a deterministic constraint solver, optimistic concurrency and a transactional outbox), composed so that a single drag of a ship on a timeline triggers authorization, a constraint check, an atomic multi-berth commit, real-time fan-out to other sessions, an audit record and, at the end, a cryptographic proof that the record has not been altered.

---

## A. Product concept

### The application

Quayside runs the berth plan for one container terminal. A terminal has a finite set of berths, each with a length, a depth that varies with the tide, a wind limit and a crane capacity. Vessels (identified by IMO number, with length overall, draft and contracted crane moves) arrive on visits. Each visit must be assigned a berth and a time window. The plan is a constantly revised negotiation between the people who own different constraints:

- **Planners** (Tomas, Ana) build and edit the plan, place holds and propose moves.
- **The harbourmaster** (Ines) owns safety. She accepts or rejects plan changes, loads forecast files and approves solver proposals.
- **Carrier agents** (Priya, for the fictional carrier Northwind Lines) see only their own vessels, see berth and ETA changes that affect them, and acknowledge notifications. Other carriers' visits are not visible to her, not merely greyed out.
- **The auditor** (Dana) reads everything, can replay any historical plan and verifies the integrity of the record. She cannot change anything.

The data is a synthetic but internally consistent terminal: six berths, a 72-hour planning horizon, a tide table, a wind forecast, roughly 60 visits across five carriers. The sample set is deterministic and reproducible from a seed.

### Problems solved

1. **Conflicting edits.** Two planners editing the same berth at the same time must not both succeed, and the loser must learn why and what the current state is.
2. **Explainable rejection.** A move that violates a draft limit at low tide must be refused with the specific constraint, the tide window and the value, not a generic error.
3. **Re-planning under change.** A storm front arriving at 15:00 invalidates wind limits for three berths. Someone has to produce a revised plan promptly and safely, and everyone has to see it.
4. **Accountability.** After an incident, the question is "what did the plan look like at 14:02, who changed it and which rule let them." That answer must be reconstructible and must be provably unaltered.
5. **Partial visibility.** A carrier agent may see her own vessels and the berths they use, but nothing else, and the boundary must hold for direct API calls as well as for the UI.

### Why it suits this demo

A berth plan is a shared, safety-relevant, concurrently edited state with time, geometry, policy and history all mattering at once. Almost every interesting property of a distributed system shows up in it without contrivance. It is also a domain an engineering audience understands in one sentence: ships, berths, tides and a timeline. That lets the audience spend its attention on what the system does rather than on what the domain is.

The primitives are deliberately few. The emergent effect is that one user gesture touches most of them, and the audience can see that happen.

---

## B. Capability inventory

Each capability is marked **demonstrated** (shown on stage with a visible result) or **supporting** (required for the system to work, but not a moment in the script).

| # | Capability | Status | Technical significance | Interactions |
|---|---|---|---|---|
| 1 | Append-only event store, per-stream hash chains (`events`, `streams`) | demonstrated | Every state change is a fact with a stream sequence number and a SHA-256 link to its predecessor; no updates in place | Source for projections (2), replay (10), verification (11), outbox (9) |
| 2 | Synchronous projections in the same transaction | demonstrated | The berth plan read model (`slots`, `visits`) is updated in the same Postgres transaction as the event append, so readers never see an event without its projection | Constrained by the exclusion constraint (6); feeds real-time (7) |
| 3 | Policy engine (Cedar) with decision records | demonstrated | Authorization is a declarative policy file, evaluated on the server for every action; each decision is written as a record referencing the policy version and the request hash | Same policy evaluation drives UI affordances (3b); decision IDs are stored on events (1) |
| 3b | Policy-driven UI affordances | demonstrated | The client asks `POST /api/me/capabilities` for a resource and renders only the actions Cedar permits; the server still re-checks on submit | Depends on 3; tested as a matrix (claim F3) |
| 4 | Constraint engine with explainable rejections | demonstrated | Hard constraints (length, draft against tide window, wind limit, crane capacity) are pure functions returning the violated rule, the value and the window | Used by the solver (5) and by move validation (6) |
| 5 | Deterministic bounded constraint solver | demonstrated | Given the same plan snapshot, horizon and seed, produces the same proposal; bounded by an iteration cap and a wall-clock guard that reports partial results | Produces proposals (6); triggered by forecast ingest (9) |
| 6 | Proposals and optimistic concurrency per berth | demonstrated | A proposal records the berth versions it was computed against; acceptance commits all moves in one transaction, locking berth streams in ascending ID order and rejecting if any base version moved (HTTP 409 with the new versions) | Rebase (6b) re-runs the solver on the affected moves only |
| 6b | Rebase on conflict | demonstrated | On 409 the UI offers "rebase onto current plan"; the server re-solves only moves whose berths changed and reports dropped moves with reasons | Depends on 5 and 6 |
| 7 | Post-commit real-time fan-out | demonstrated | Each commit issues `NOTIFY plan_changed` carrying only identifiers, so notifications fire only on commit; each API replica listens and pushes to its WebSocket clients | Relies on the cursor protocol (8) |
| 8 | Resumable event stream with cursors | demonstrated | Clients send their last `global_pos`; the server replays missed events from the log, then continues live. Gaps and duplicates are handled by the client reducer keyed on `global_pos` | Makes the network-loss drill (script 150–180 s) possible |
| 9 | Transactional outbox, queue, idempotent worker | demonstrated | Side effects (forecast re-plan jobs, notifications, verification runs) are written to `outbox` in the same transaction as the triggering event, relayed to SQS, and consumed by a worker whose handlers are idempotent on message ID | Forecast ingest (script 180–210 s); notifications (4 and 8) |
| 10 | Time-travel replay and snapshots | demonstrated | The plan at any `global_pos` or timestamp is rebuilt by folding the pure reducer over events, starting from the nearest snapshot | Feeds the auditor's diff view (script 210–240 s); validated by claim F2 |
| 11 | Hash-chain verifier and tamper detection | demonstrated | Walks every stream, recomputes each hash, and reports the first divergent stream and sequence number | Relies on 1; the tamper demonstration uses direct SQL that bypasses the application |
| 12 | Distributed trace across browser, API, Postgres, queue, worker | demonstrated | OpenTelemetry context carried in event metadata and across SQS message attributes, so one trace covers the request, the commit, the NOTIFY hop on another replica, and the worker job | Final moment (script 270–300 s) |
| 13 | OIDC authentication with group claims | supporting | Login issues tokens; the API validates signatures against JWKS and maps `cognito:groups` and `custom:carrier_id` into Cedar principals | Input to 3 |
| 14 | Manifest import via presigned S3 upload | supporting | Browser uploads CSV directly to S3; `POST /imports/complete` enqueues a job through the outbox; the worker validates rows and emits `VisitImported` events | Shares the outbox path with 9; exercised in the reset and rehearsal |
| 15 | Health, readiness and migration job | supporting | `/healthz` (process), `/readyz` (database, migrations at expected version, NOTIFY listener connected); migrations run as a one-off task using the API image | Required for recoverability (script failure modes, G) |
| 16 | Deterministic demo reset and seeding | supporting | `quayside demo reset` truncates, reapplies migrations and replays a fixed seed file through the normal command path, so seeded state is produced by the same events that users produce | Predictable initial conditions |
| 17 | Idempotency keys on mutating endpoints | supporting | `Idempotency-Key` header stored with request hash and response; a retry after a dropped connection returns the original result | Protects 6 and 14 from double application |
| 18 | Gantt and inbox UI, role-scoped views | supporting | Canvas/SVG timeline with virtualised rows; inbox fed by `notifications` table | Visual carrier for 2, 3b, 7 and 8 |
| 19 | Infrastructure as code and immutable images | supporting | CDK (TypeScript) for AWS; Docker Compose for local; the same image digests in both | Section E |
| 20 | Multi-session end-to-end rehearsal | supporting | Playwright with four browser contexts, each with stored sign-in state for one role; the rehearsal is the demo script run as a test | Section F, claim 5 |

Several capabilities are only interesting in combination. The solver (5) is a pure function, which is unremarkable on its own. It becomes a demonstration when its output is a proposal (6) that is optimistically checked against the same berth versions the planner's view was built on, when rebase (6b) reuses the same solver on a smaller input, and when the forecast worker (9) produces a proposal in another process that appears in three sessions through the same fan-out path (7). The same chain of reasoning applies to authorization (3), which is only convincing when the rule that hides a carrier's vessel from the API is the same rule that hides the button in the UI.

---

## C. Five-minute live script

Stage setup, before the audience arrives: three browser windows side by side on one display, labelled **Planner (Tomas)**, **Harbourmaster (Ines)** and **Carrier agent (Priya)**; a fourth panel on a second display for the **Auditor (Dana)** and a terminal pane for the database. All four are signed in, and the plan is in its reset state. The reset is a single command and its output is shown in the terminal before the talk begins. The horizon is pinned to the demo epoch, so the timeline is identical on every run.

| Time (s) | Presenter action | Expected behaviour | Visible result | Capabilities demonstrated | Transition |
|---|---|---|---|---|---|
| 0–30 | Shows the plan in all three windows. Says: "A berth plan is a shared, contested, safety-critical state. Three people are looking at the same thing right now." Points at the live status line showing the last `global_pos`. | Plan loads from projections; sessions connected over WebSocket with cursors. | Gantt for six berths over 72 hours; each window shows a different permitted action set (planner has edit controls; agent has none on other carriers). | 2 projections, 3b affordances, 8 cursors (status line) | "Let's make one change and watch what the system does with it." |
| 30–60 | In Planner window, drags MV Halden from berth 3 at 14:00 to berth 5 at 16:00. | Client sends `propose_move` with base versions for berths 3 and 5. Cedar permits planner `propose_move`. Constraint engine checks draft 13.2 m against berth 5 tide window 15:40–17:10 (limit 12.0 m). Move refused with reason. Decision and rejection are audited. | Ship snaps back to berth 3. Red banner: "Refused: draft 13.2 m exceeds berth 5 limit 12.0 m (tide window 15:40–17:10, table TT-2026-11-22)." Audit line appears in the panel: `MoveRejected`, decision id. | 3 policy decision, 4 explainable constraint, 1 event append (rejection recorded), 2 projection untouched | "The rule is in the data, and every refusal says which rule. Now the harbourmaster has a different question: what should the afternoon look like." |
| 60–90 | In Harbourmaster window, selects the 14:00–18:00 window and presses "Resolve". | Solver runs on snapshot at base versions with seed 42 and iteration cap 2,000. Output is a proposal of four moves with reason codes. Proposal is persisted as `ProposalCreated` referencing berth versions. | Ghost overlay on Gantt shows the four moves. Proposal card lists each move with its reason (e.g. "draft fits berth 6 at 16:00 after tide gate"). Solver status: "complete, 412 ms, 4 moves." | 5 solver, 6 proposal persistence, 2 ghost computed from proposal against projection | "A proposal is only useful if it can be safely accepted in a shared system. Watch what happens when someone else moves first." |
| 90–120 | While the proposal is open, Tomas places a hold on berth 2 at 15:00 in his own window, committed just before. Ines presses "Accept". | Accept locks berth streams 2, 3, 5 and 6 in ascending ID order. Berth 2 version has moved, so the transaction rejects with HTTP 409 and returns current versions. Nothing partially commits. | Conflict banner in Ines's window: "Berth 2 changed since this proposal (v41 → v42). Plan unchanged." Hold appears on Tomas's view. Button: "Rebase onto current plan." | 6 optimistic concurrency, atomic multi-stream rejection, 8 real-time from another session | Ines presses "Rebase." |
| 120–150 | Presses "Rebase." Then Tomas's hold is shown as an input to the solver. | Solver reruns only the moves on berth 2 and any moves whose window overlaps the hold. One move is dropped with reason "berth 2 held 15:00–17:00 by planner hold H-7". Accept commits three moves in one transaction. | Proposal card updates to three moves and one dropped move with reason. Acceptance completes. Gantt animates the three moves; Tomas's and Priya's windows update within the same frame. | 6b rebase, 5 solver on subset, 6 atomic commit, 7 fan-out to three sessions | "Priya's window has just changed. Let's see what she can and cannot see." |
| 150–180 | Presses "Simulate network loss" on Priya's window (a visible toggle that closes her socket). Then, from Tomas's window, makes two further edits to berth 3 while she is offline. Then Priya presses "Reconnect." | Her client reconnects with last `global_pos`. Server replays the missed events from the log, filtered by her authorization, then streams live. Client reducer applies them once. | Status line: "Resumed from position 48,217; applied 7 events (2 visible to Northwind)." Her Gantt shows exactly the two changes that affect her vessels. Nothing from other carriers appears, and the network panel shows no such payloads. | 8 resumable stream, 3 row-level authorization applied to replay, idempotent reducer | "Her view is correct because of the log. Now a change that originates outside the terminal." |
| 180–210 | Ines loads "forecast_2026-11-22T1200_NE.json" through the forecast panel. The file contains a wind limit of 25 kn for berths 1–3 from 15:00 to 19:00. | Forecast ingest writes `ForecastApplied` and an outbox row in one transaction. Relay publishes to SQS. Worker consumes, detects two visits in violation, runs the solver and writes a proposal through the same command path as the planner. The job trace ID is shown. | Pipeline chip: "queued → worker picked up → solving → proposal ready (2 visits)." The new proposal appears in all three sessions at once. Ines's proposal card is marked "from forecast." | 9 outbox and queue, 9 idempotent worker, 5 solver in worker, 6 proposal, 7 fan-out | "The system has just reasoned about the weather. The auditor can now ask what it knew, and when." |
| 210–240 | Dana, on the second display, scrubs the plan back to 14:02. Then she selects one of the day's moves and opens its record. | Plan at 14:02 is reconstructed by folding the reducer from the nearest snapshot. Diff against current plan computed. Record shows actor, base versions, decision ID and the policy file hash that allowed it. | Historical Gantt with the four original moves shown as they were, and a diff highlighting what has changed since. Record panel: "Allowed by policy `planner-propose-v3` (sha256 9f2c…); decision D-20417." | 10 replay and snapshots, 3 decision records, 1 event provenance | "Replay tells you what happened. The next question is whether anyone could have changed the record." |
| 240–270 | Dana presses "Verify chain" on the auditor panel; it reports green across all streams. Presenter then switches to the database pane and runs one SQL statement as a DBA that edits the `payload` of a berth 5 event (changing the recorded draft from 13.2 to 12.9). Dana presses "Verify chain" again. | First run: all streams valid, with the count and duration shown. Second run: verifier recomputes the chain, finds the first divergent stream `berth:5` at sequence 17, and reports stored versus recomputed hash. The application itself never runs the edit. | Green, then red, with the exact stream and sequence. The affected plan view is marked "record integrity failed" rather than silently showing altered data. | 11 hash-chain verification, tamper detection of direct database writes | "Now the question is how a single gesture produced all of this. Let's look at one trace." |
| 270–300 | Presenter opens the trace for the forecast-driven proposal acceptance, which Ines performed in the forecast beat, or the rebase acceptance if the forecast beat was skipped. Shows the waterfall. | One trace covers: browser click, API replica A (policy, constraints, transaction with locks, commit), Postgres `NOTIFY`, API replica B (NOTIFY receipt, WebSocket push to the agent's session), outbox relay, SQS, worker (idempotency check, notification row). | Waterfall with nine hops across three processes and two replicas. Span labels show each policy decision ID and the `global_pos` range committed. Presenter closes on the sentence: "This is one click, and every claim you have seen today is a span in this picture." | 12 distributed trace, 7 cross-replica fan-out, 9 worker, 1 commit provenance | End. |

### Notes on the script

- The first 30 seconds establish purpose by showing three people looking at one contested state, not a dashboard of numbers. The status line showing `global_pos` is the first hint of the event log.
- The final 30 seconds deliver the strongest moment: the trace waterfall crossing browser, two API replicas, Postgres notification, queue and worker, with the decision identifiers visible on the spans. It is the moment where the audience sees the system substantiate what it has been claiming.
- Typing is limited to one SQL statement at 240–270 s, which is the tamper demonstration and is intentionally short. Navigation is limited to the three windows and one trace view.
- Nothing in the script is a fixed sequence in the application. The solver, the rebase, the replay and the verifier are general operations. The forecast file is an ordinary ingest input, and the tamper statement is an ordinary SQL statement. A different drag, a different forecast or a different edit produces a different but equally valid run. The rehearsal (claim F5) runs two variants to prove this.
- Timing targets in the table (for example, 412 ms solver) are design targets to be measured on the AWS deployment and the local stack, not measurements yet taken.

---

## D. Technical architecture

### Components

| Component | Language and framework | Responsibility |
|---|---|---|
| `quayside-api` | Rust, axum, tokio, sqlx (Postgres), cedar-policy crate, tracing with opentelemetry-otlp | HTTP API, WebSocket fan-out, command handlers, projections, policy checks |
| `quayside-worker` | Rust, same crate, `worker` subcommand | SQS consumer, forecast application, solver jobs, imports, notifications, verifier runs |
| `quayside-core` | Rust library crate, no I/O | Event types, pure reducer, constraint engine, solver, hash chain, Cedar entity construction |
| `quayside-web` | TypeScript, React 18, Vite, generated OpenAPI client | Gantt, inbox, proposal panel, audit panel, trace link |
| Static and reverse proxy | nginx (unprivileged image, pinned digest) | Serves built web assets; proxies `/api` and `/ws` to the API target group |
| Infrastructure | TypeScript, AWS CDK | VPC, ECS services, RDS, SQS, S3, Cognito, ALB, IAM, Secrets Manager |
| Local orchestration | Docker Compose | The same images, with stand-ins for managed services (Section E) |
| Tests | Rust test harness, proptest, Playwright (TypeScript) | Unit, property, integration against Postgres, cross-replica and multi-session end-to-end tests |

Rust is chosen for the API and worker because the correctness-sensitive parts (locking, transactions, the reducer and the solver) benefit from exhaustive matching and from a single statically linked binary. It produces small, immutable runtime images. TypeScript is chosen for the UI because the audience's expectations for interaction quality are met most directly by the React ecosystem, and for CDK because it lets the infrastructure share types with the API's configuration schema. Postgres is chosen because the design relies on four of its features, each of which is central to a claim: deferrable exclusion constraints (no double booking, enforced by the database), `LISTEN`/`NOTIFY` (post-commit notification), `jsonb` with `bytea` hashing (event payloads and chains) and row locks taken in a defined order (multi-berth commit).

### Persistence model

The source of truth is the event log. Read models are tables updated in the same transaction.

```sql
-- One row per stream (a berth, a visit, a proposal, an import, a forecast source).
CREATE TABLE streams (
  stream_id     uuid PRIMARY KEY,
  stream_kind   text NOT NULL,            -- 'berth' | 'visit' | 'proposal' | 'import' | 'forecast'
  head_seq      bigint NOT NULL DEFAULT 0,
  head_hash     bytea  NOT NULL DEFAULT '\x00',
  version       bigint NOT NULL DEFAULT 0 -- optimistic concurrency token used by clients
);

CREATE TABLE events (
  global_pos        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stream_id         uuid   NOT NULL REFERENCES streams,
  seq               bigint NOT NULL,
  event_type        text   NOT NULL,
  payload           jsonb  NOT NULL,
  actor             text   NOT NULL,
  decision_id       uuid,                  -- Cedar decision that authorized the command
  causation_id      uuid,                  -- command or job that produced it
  trace_id          text,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  prev_hash         bytea  NOT NULL,
  hash              bytea  NOT NULL,       -- sha256(prev_hash || canonical(event))
  UNIQUE (stream_id, seq)
);

CREATE TABLE decisions (
  decision_id   uuid PRIMARY KEY,
  principal     text NOT NULL,
  action        text NOT NULL,
  resource      text NOT NULL,
  result        text NOT NULL,           -- 'allow' | 'deny'
  policy_sha256 bytea NOT NULL,
  request_hash  bytea NOT NULL,
  at            timestamptz NOT NULL DEFAULT now()
);

-- Read models (projections), updated in the command transaction.
CREATE TABLE visits (
  visit_id uuid PRIMARY KEY, carrier_id text NOT NULL, vessel_imo text NOT NULL,
  loa_m numeric NOT NULL, draft_m numeric NOT NULL, crane_moves int NOT NULL,
  eta timestamptz NOT NULL, status text NOT NULL, version bigint NOT NULL
);

CREATE TABLE slots (
  berth_id uuid NOT NULL, visit_id uuid NOT NULL REFERENCES visits,
  span tstzrange NOT NULL, berth_version bigint NOT NULL,
  PRIMARY KEY (berth_id, visit_id),
  EXCLUDE USING gist (berth_id WITH =, span WITH &&) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE proposals (
  proposal_id uuid PRIMARY KEY, base_versions jsonb NOT NULL, moves jsonb NOT NULL,
  input_hash bytea NOT NULL, solver_version text NOT NULL, seed int NOT NULL,
  status text NOT NULL, source text NOT NULL          -- 'planner' | 'forecast' | 'rebase'
);

CREATE TABLE outbox (
  msg_id uuid PRIMARY KEY, topic text NOT NULL, body jsonb NOT NULL,
  trace_context jsonb, created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);

CREATE TABLE idempotency (
  principal text NOT NULL, key text NOT NULL, request_hash bytea NOT NULL,
  response jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal, key)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY, recipient text NOT NULL, visit_id uuid, body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz
);

CREATE TABLE snapshots (stream_id uuid, seq bigint, state jsonb, PRIMARY KEY (stream_id, seq));
CREATE TABLE tide_windows (berth_id uuid, span tstzrange, max_draft_m numeric);
CREATE TABLE wind_limits  (berth_id uuid, span tstzrange, max_wind_kn numeric);
```

The `slots` exclusion constraint is the database's own guarantee that no berth is double-booked, independent of application logic. It is deferrable so that a swap of two visits inside one transaction can be checked at commit rather than per statement.

Each stream has its own hash chain. A single global chain would serialise every write in the terminal through one row. Per-stream chains let berths commit in parallel and keep verification embarrassingly parallel. The global order is `global_pos`, which the verifier also checks for monotonicity within each stream.

### Communication

- **Synchronous (browser to API):** JSON over HTTPS, generated OpenAPI types on the client. Mutating endpoints require `Idempotency-Key` and the current berth versions.
- **Real-time (API to browser):** one WebSocket per session at `/ws`. Client sends `{resume_from: global_pos, filter}`. Server replays from `events` (filtered by Cedar for the principal), then pushes committed events in `global_pos` order. The server sends a ping every 25 seconds so that both the ALB idle timeout and the local nginx timeout are never reached.
- **Intra-cluster fan-out:** `NOTIFY plan_changed, '<global_pos_from>:<global_pos_to>'`. The payload carries identifiers only, well under the 8000-byte limit. Each API replica holds one dedicated, non-pooled connection that `LISTEN`s and re-reads the range. RDS Proxy is not used for this connection because it does not support `LISTEN`.
- **Asynchronous (API to worker):** transactional outbox. A relay task (a Tokio task in the API) polls `outbox` for unpublished rows with `FOR UPDATE SKIP LOCKED`, sends them to SQS with the trace context as message attributes, and marks them published after the send succeeds. Delivery is at-least-once; consumers are idempotent on `msg_id`.
- **Uploads:** browser to S3 directly via a presigned `PUT`. Completion is an API call that enqueues an import job through the outbox, so the import path is the same locally (MinIO) and on AWS (S3).

### Security boundaries and authorization model

Boundaries, outside in:

1. **Edge.** TLS 1.2+ at the ALB (ACM certificate) or at nginx locally. No public access to any other port. Security headers and a strict Content-Security-Policy on the web assets.
2. **Identity.** Cognito user pool (AWS) or mock OIDC issuer (local) issues tokens. The API verifies the signature against cached JWKS, checks `iss`, `aud`, `exp` and `token_use`. Group claims and the `custom:carrier_id` attribute map to Cedar principals. The API rejects tokens without a known group.
3. **Authorization.** Cedar policies, one file, versioned and hashed into every decision record. Principal types: `Planner`, `Harbourmaster`, `CarrierAgent` (with `carrier_id` attribute), `Auditor`. Resource types: `Berth`, `Visit`, `Proposal`, `Forecast`, `Import`, `AuditView`. Actions: `view`, `propose_move`, `accept_proposal`, `hold`, `load_forecast`, `import`, `verify`, `replay`, `acknowledge`.

   Example policy (abbreviated, the authoritative file is in the repository):

   ```cedar
   // Carrier agents see only visits of their own carrier.
   permit (principal is CarrierAgent, action == Action::"view", resource is Visit)
     when { resource.carrier_id == principal.carrier_id };

   // Only the harbourmaster accepts proposals; planners may propose.
   permit (principal is Harbourmaster, action == Action::"accept_proposal", resource is Proposal);
   permit (principal is Planner, action == Action::"propose_move", resource is Berth);
   forbid (principal, action == Action::"accept_proposal", resource is Proposal)
     when { principal is Planner };
   ```

4. **Data.** Row-level filtering in the replay and list queries is performed by the application using Cedar decisions on each candidate row, with page size bounded. As defence in depth, the `visits` and `slots` tables have Postgres row-level security policies keyed on a session variable set from the principal's `carrier_id`, so a bug that omits the application filter still cannot return another carrier's rows to a carrier role.
5. **Database.** The API and worker use distinct Postgres roles. The API role can `INSERT` into `events` and `outbox` but cannot `UPDATE` or `DELETE` them. Migrations run as a separate role. The verifier runs read-only. The DBA path in the tamper demonstration uses a superuser, which is the point: the verifier detects it.
6. **Network.** Private subnets for API, worker and RDS. Security groups allow Postgres only from the API and worker security groups, and nothing else reaches RDS. VPC endpoints for ECR, S3, SQS and Secrets Manager remove the need for a NAT gateway on the request path.
7. **Secrets and IAM.** Database credentials in Secrets Manager, injected as environment variables at task start. Task roles grant only the SQS queue and S3 prefix each service needs. No long-lived keys.

Authorization is single-sourced. The client does not decide permissions; it asks `POST /api/me/capabilities` and renders the result. The server calls the same Cedar evaluation on submit. A matrix test (claim F3) compares the two for every role, action and resource in the demo data.

### Consistency requirements per operation

| Operation | Consistency requirement | Mechanism |
|---|---|---|
| Propose move | Read of berth versions must be the version the solver or planner saw | Client sends base versions; server validates before recording the proposal |
| Accept proposal (multi-berth) | All moves or none; no double booking; no lost update | Lock berth `streams` rows in ascending `stream_id`; compare versions; append events; update `slots`; deferred exclusion check at commit |
| Hold | Single-berth, same as accept | Same path as a single-move proposal |
| Forecast ingest | Exactly-once effect on the plan from one forecast file | Forecast stream with content hash as idempotency key; outbox row in the same transaction |
| Worker solver run | At-least-once delivery may run twice | Job keyed by `(forecast_id, input_hash)`; second run produces the same proposal and is de-duplicated by the unique key |
| Notification | At-least-once, shown once per recipient | `notifications` row keyed by `(msg_id, recipient)` |
| Real-time push | Each client sees every committed event once, in `global_pos` order, after commit | `NOTIFY` after commit; client reducer keyed on `global_pos`; resume from cursor |
| Read after write (same session) | Read-your-writes | Projection committed in the command transaction; response includes new `global_pos` |
| Replay | Deterministic result for a given position | Pure reducer; snapshots are an optimisation validated against full replay (claim F2) |
| Verification | Detects any change to an event after commit | Per-stream hash chain; verifier runs on a read-only role |

Strict serialisability is not required for the whole terminal, and the design does not provide it. Each berth is serialised by its row lock. Cross-berth reads may observe the plan at slightly different `global_pos` values, which the UI reports on the status line rather than hiding.

### Deployment topology

AWS (one region, two availability zones for the ALB and subnets; RDS single-AZ for the demo, with the Multi-AZ option documented):

```
Internet -> ALB (HTTPS, ACM) -> target group "web" (ECS Fargate, nginx)
                                  |  /api/*, /ws -> target group "api" (ECS Fargate, 2 tasks)
                                                    |-> RDS PostgreSQL 16 (private)
                                                    |-> SQS (outbox queue, DLQ)
                                                    |-> S3 (manifests, presigned)
ECS Fargate "worker" (1-2 tasks) <- SQS
Cognito user pool (hosted login disabled; API-based token issuance for demo accounts)
ADOT collector sidecar -> X-Ray; CloudWatch Logs for stdout
```

The ALB sends WebSocket upgrades to the API target group through path-based rules, and the target group is configured for stickiness off, since each replica independently replays from the log on reconnect. The API service is scaled to two tasks so that the cross-replica claim is exercised in the demo account.

---

## E. AWS and local deployment

### Principle

There is one set of application artifacts: three container images, built once per commit, pushed to ECR and to a local registry under the same digest. Nothing is baked per environment. Configuration arrives as environment variables and mounted secret files whose names are identical in both environments. The local stack is the production topology with managed services replaced by protocol-compatible local servers that the same SDK code talks to.

### Images

| Image | Base | Contents |
|---|---|---|
| `quayside-api` | `gcr.io/distroless/cc-debian12` pinned by digest | Static Rust binary with subcommands `serve`, `migrate`, `verify`, `demo-reset` (demo-reset is refused unless `QUAYSIDE_ENV=demo`) |
| `quayside-worker` | same base | Same binary, subcommand `worker`. Built from the same layer as the API, so the two images share all layers except the entrypoint |
| `quayside-web` | `nginxinc/nginx-unprivileged` pinned by digest | Built assets from the Node build stage, and the nginx configuration that routes `/api` and `/ws` |

Build rules: a multi-stage Dockerfile with `cargo-chef` for dependency caching; `Cargo.lock` and `package-lock.json` committed; base images pinned by digest; `SOURCE_DATE_EPOCH` set so layers are reproducible; each image tagged with the git SHA and the content digest; ECR image tag immutability enabled; deployment references only digests. An SBOM is generated per image at build time and stored with the image metadata.

### Service mapping

| Concern | AWS | Local (Compose) | Behaviour difference | Why it does not change observable behaviour |
|---|---|---|---|---|
| Relational store | RDS PostgreSQL 16 | `postgres:16` container | RDS manages backups and failover; local does not | Same engine, same extensions (`btree_gist` for the exclusion constraint), same SQL |
| Queue | SQS standard queue with DLQ | ElasticMQ (SQS-compatible server) | Visibility timeout defaults and DLQ redrive mechanics differ in detail | Same SDK calls, same message attributes; both configured with 30 s visibility and max receive 5 |
| Object storage | S3 bucket with presigned PUT | MinIO | Bucket policies and encryption defaults differ | Same presigned URL flow using the S3 SDK with path-style addressing enabled locally |
| Identity | Cognito user pool, JWKS | Mock OIDC server (`navikt/mock-oauth2-server`, pinned) | No Cognito hosted UI; claim names differ and are mapped in configuration | Same verification code: signature via JWKS, issuer, audience, expiry. Claim mapping is a config file per environment |
| Load balancer | ALB with path rules and WebSocket support | nginx container | ALB idle timeout is 60 s by default; nginx default differs | Both set to 120 s; server pings at 25 s, so neither timeout fires |
| Secrets | Secrets Manager injected at task start | `.env` file read by Compose, same variable names | No rotation locally | Application reads env vars only; rotation is a deployment concern tested in staging only |
| Tracing | ADOT collector to X-Ray | OTel collector to Jaeger | Different UI | Same OTLP export from the application |
| Logs | CloudWatch Logs | stdout to Compose logs | None observable to the app | JSON logs with the same fields |
| Scheduling | EventBridge rule for nightly verifier | Not run in the demo; the verifier is invoked by command | Schedule source differs | Same `verify` subcommand |
| Email and SMS | Not used in the core demo | Not used | Notifications are in-app only; SES integration exists behind an interface and is disabled | Avoids a live third-party dependency in the demo |

### Topology locally

`docker compose up` starts: `postgres`, `elasticmq`, `minio`, `mock-oauth2`, `otel-collector`, `jaeger`, `migrate` (run once), `api` (with `deploy.replicas: 2`), `worker`, `web` (nginx). `quayside up` wraps it and waits on the readiness endpoints of every service before printing the URLs. `quayside demo reset` produces the same initial state on every run.

### What differs and why behaviour is unchanged

The differences that matter are the ones an audience could notice: none of them change a demonstrated behaviour, and the rehearsal runs on both. The cross-replica fan-out is exercised locally with two API replicas, because `NOTIFY` delivery across processes is the claim being demonstrated and it must not depend on a managed service. The tamper demonstration works identically on RDS because it needs only a superuser session, which the demo account has on both; the verifier reads only the event tables.

Two behaviours are intentionally left different and documented: RDS failover (not exercised in the demo; the reconnection logic is tested by killing the local Postgres connection) and Cognito's token lifetimes (demo accounts are configured with 8-hour access tokens locally to match).

---

## F. Five strongest technical claims

Each claim has an executable test or an observable behaviour that proves it. The tests run in the stack gate, not per change.

**F1. No double booking and no partial multi-berth commit, under concurrency.**
Claim: an accept of a multi-berth proposal either commits all moves or none, and two concurrent accepts that overlap in time on one berth can never both succeed.
Test: an integration test starts 50 concurrent accept requests with randomly overlapping move sets against a real Postgres. After completion it asserts (a) every successful accept's events are present with contiguous `seq` per stream, (b) no `slots` pair violates the exclusion constraint, (c) every failed accept has no events, and (d) the sum of applied moves equals the number of `MoveApplied` events. A second variant kills the API process between the event inserts and the commit to show that the transaction leaves no trace.
Observable on stage: the 409 banner at 90–120 s.

**F2. The read model is exactly a replay of the event log.**
Claim: for any `global_pos`, the projection state equals the fold of the pure reducer over events up to that position, and snapshots are indistinguishable from full replay.
Test: property tests (proptest) generate random valid command sequences over the reducer and compare the projection (read from Postgres) with the reducer output at every position. A second property compares snapshot-plus-tail replay with full replay at random snapshot points. The demo data is verified the same way in the rehearsal, and the state hash is printed in the terminal at the end of reset.
Observable on stage: the historical plan at 14:02 in the auditor's view matches the state the planners saw at that moment, which the rehearsal confirms by comparing it with the recorded projection hash at that position.

**F3. Authorization is single-sourced: what the UI offers equals what the server accepts.**
Claim: for every principal type, resource and action in the demo data, the set of actions returned by `POST /api/me/capabilities` equals the set of actions the server accepts, and the server rejects every other action.
Test: a generated matrix (principals drawn from the demo accounts and synthetic principals with all carrier IDs, times resources, times actions) is run in a single test. For each cell the test calls the capabilities endpoint, then attempts the action with a real request and asserts equality. It also runs the same matrix through the Postgres RLS role to show that the database layer refuses rows the application layer would refuse.
Observable on stage: Priya's window at 0–30 s and 150–180 s, and the absence of other carriers' payloads in the network panel.

**F4. Post-commit, cross-replica real-time delivery with resumable streams.**
Claim: every committed event reaches every authorized session exactly once and in `global_pos` order, even when the session's socket is severed, the delivering replica is different from the committing replica, and a transaction that rolls back is never delivered.
Test: a harness with two API replicas and four WebSocket clients. It performs a commit on replica A and asserts delivery through replica B within the target latency (measured quantity, target p95 under 300 ms on the local stack, to be measured). A second test forces a rollback after `NOTIFY` is queued within the transaction and asserts no client receives the event. A third test closes a client's socket after position N, produces M further events, reconnects with cursor N, and asserts that the client's reducer state equals the server projection with no duplicate application.
Observable on stage: the "Resumed from position 48,217; applied 7 events" message at 150–180 s, and the three-window update at 120–150 s.

**F5. The rehearsal is the demo, and the demo is not a script.**
Claim: the five-minute sequence runs as an automated multi-session end-to-end test on both the local stack and the AWS deployment, from the same reset state, and it runs unchanged in two variants that take different branches (different rebase outcome, different forecast, different SQL target), each of which produces a correct end state.
Test: Playwright with four browser contexts, each with stored sign-in state for one demo account. The test drives the script through the UI, asserting on the visible results in the table in Section C, and it asserts the final integrity check. Variant runs are parameterised by the proposal selection and the forecast file. The test is run on a freshly reset stack and records the terminal output that the presenter shows.
Observable on stage: the presenter runs the rehearsal once before the talk, and the reset command prints the state hash.

Each claim is backed by a test that can fail. The claims are chosen so that they are also observable on stage, which lets an expert in the audience check the claim against what they are seeing.

---

## G. Failure analysis

### Implementation difficulties

- **`NOTIFY` and connection poolers.** `LISTEN` needs a session-level connection. Connection pooling or RDS Proxy in transaction mode breaks it silently. The listener must be a dedicated connection with a health check that re-subscribes and triggers a catch-up read from the last delivered position. This is the most likely source of "real-time works locally but not on AWS" faults, and the design places it under test (F4).
- **Gaps in `global_pos`.** `GENERATED ALWAYS AS IDENTITY` values are allocated before commit, so rolled-back transactions leave holes, and two transactions can commit out of allocation order. A naïve cursor that resumes at `max(global_pos)` can skip an event committed later with a smaller value. The mitigation is a commit watermark: readers only advance past position N when no transaction holding a position below N is still open, tracked with `pg_snapshot_xmin`-style reasoning, or a simpler and cruder variant that replays a bounded overlap window and deduplicates. The design chooses the overlap window with dedup for the demo and records the watermark approach as a backlog item. The F4 test includes an out-of-order commit case.
- **Deferrable exclusion constraints and error reporting.** A violation at commit is reported as a generic error. The application must map it back to a move, which requires the commit path to re-check the conflicting span itself and produce the same explanation as the constraint engine. Otherwise the explainable rejection (4) is lost in the cases that matter most.
- **Cedar list filtering.** Authorization per row is straightforward for single resources. For lists, per-row evaluation costs one evaluation per candidate row. The replay endpoint for a carrier can scan many events, so the page size and the scan limit are bounded and the cost is measured. Partial evaluation to push the filter into SQL is possible but not a dependency of the demo.
- **Snapshot consistency.** Snapshots are written asynchronously by the worker, so a snapshot may lag. Replay must start from a snapshot that is consistent with the event hash at its sequence number. The verifier checks snapshots against replay.
- **Solver reproducibility across builds.** Floating-point differences between builds can change tie-breaks. The solver uses integer minutes and integer costs and a fixed iteration order, and the proposal records `solver_version` and `input_hash`. Replaying an old proposal on a newer build reports a version mismatch rather than a silent difference.
- **Cross-service trace propagation.** The trace context must survive the outbox row, the SQS message attributes and the worker's span. A missing link in any of these produces a broken waterfall on stage. The trace continuity test is part of the stack gate.

### On-stage failure modes and mitigations

| Failure | Effect on stage | Mitigation |
|---|---|---|
| WebSocket drops mid-script | Views stop updating | Client reconnects with cursor; status line shows resumed state. The drill at 150–180 s is rehearsed deliberately |
| Solver exceeds its budget | Proposal arrives late or partial | Iteration cap and wall-clock guard return the best proposal so far, marked "partial", with the reason. Demo seeds are chosen so the solver completes well within the guard on the demo hardware, and the rehearsal asserts it |
| Worker is slow to pick up the forecast job | Pipeline chip sits at "queued" | The chip shows the SQS approximate message age; the rehearsal measures the pickup and the cue is timed on it. If the job is delayed, the presenter moves to the next beat, which is independent |
| Local Docker or network failure | Stack down | AWS deployment is the primary target; local stack is the fallback with the identical images. The reset command takes seconds and the presenter has the second display ready |
| AWS task replaced during demo | Brief connection loss | Desired count of two tasks; the reconnect path (F4) handles it, and it is rehearsed by killing a task |
| Cognito token issue | Login fails | Sessions are signed in before the talk and tokens are refreshed in the background. Demo accounts have long access tokens. The rehearsal refreshes tokens |
| Browser extension or window layout | Clutter | Windows are created by the reset script with fixed positions, and the UI has a presentation mode |
| SQL statement typo in the tamper beat | Breaks the climax | The statement is stored in a file and executed from the terminal pane by one command; the rehearsal runs it |
| Audience asks for a non-seeded scenario | Unrehearsed path | The application is general; the presenter can create a visit through the import panel. This is the reason the import path is part of the core and not a demo-only shortcut |

### Hidden complexity

- The exclusion constraint, the application's conflict check and the rebase solver must agree exactly on what counts as overlapping. An off-by-one on half-open intervals would produce a rebase that the database then refuses. The span type is `[start, end)` everywhere and the test suite includes boundary cases.
- Time zones and tide tables. All times are stored as `timestamptz` and rendered in terminal local time. Tide windows are generated from a fixed tide table and not from astronomy, which is stated in the UI to avoid implying oceanographic accuracy.
- The worker is a second process with its own failure modes. Idempotency keys, DLQ handling and poison messages are real work, and a poison forecast file must not block the queue. The worker quarantines a message after five receives into an `import_failures` table visible in the auditor view.
- Clock injection. The demo uses a fixed scenario clock for the horizon. Every time-dependent computation takes the clock as an input, so the same code produces the same proposal, and the production build uses the system clock.

### Features that look impressive but are technically shallow

These are the candid list. Each is included in the build, but it is worth knowing where it is thin.

- **The Gantt.** It is a well-made timeline, and it is the least technical part of the demo. Its value is that it makes the other claims visible. The virtualisation is necessary only at this scale.
- **Time-travel scrubber.** The reducer does the hard work, but the scrubber itself is a slider on `global_pos`. The non-trivial part is correctness of the fold, which is tested in F2, not the UI.
- **"Verify chain".** Per-stream hash chains are standard. The verifier is a loop with a hash function. Its credibility depends on the tamper demonstration being real, not on the algorithm.
- **The solver.** It is a bounded greedy construction followed by min-conflicts repair. It is not optimal and does not prove optimality. The proposal reports the number of moves and the reasons, which is honest about what it does. An expert may ask for a lower bound, and the design does not provide one.
- **Rebase.** It is a re-run of the solver on a smaller input with a set of fixed moves. It looks like conflict resolution, but it is a re-solve, and it can drop moves. The UI states that a move was dropped and why.
- **"Multi-tenant".** Not present. The demo has one terminal and carriers as scopes within it.
- **OIDC.** The local mock issues real OIDC tokens and the verification code is the same, but Cognito-specific behaviour (token revocation, custom attribute quirks, hosted UI flows) is not exercised locally and is tested only in the AWS deployment.
- **Notifications.** An inbox table and a list. There is no delivery to email or SMS in the demo, which is deliberate.
- **Observability.** The trace waterfall is a real trace, but a dashboard with graphs would add nothing to the argument and is not built.

---

## H. Feasibility

Feasibility is expressed by what each component touches and by the order in which the work unblocks other work. The ordering below is a dependency chain. Each layer is runnable and testable on its own, which is the requirement in the brief.

### Scope by component

| Layer | Components touched | Depends on | Unblocks |
|---|---|---|---|
| 1. Core vertical slice | `quayside-core` event types, reducer, hash chain; `events`, `streams`, `visits`, `slots` schema; one command (`move_visit`); one projection; one read endpoint; minimal page showing one berth | none | everything |
| 2. Authorization | Cedar policy file, entity construction from OIDC claims, `decisions` table, `capabilities` endpoint, UI affordance rendering, RLS policies | 1 | 3, the carrier view |
| 3. Constraints and concurrency | Constraint engine, deferrable exclusion constraint, versioned berth writes, proposals table, atomic multi-berth accept, 409 path | 1, 2 | 4, 5 |
| 4. Real-time | `NOTIFY` on commit, dedicated listener, WebSocket endpoint, cursor resume, client reducer keyed on `global_pos`, status line | 1, 2 | the three-window choreography |
| 5. Solver and rebase | Pure solver in core, proposal generation, ghost overlay, rebase on subset, solver seeds and `input_hash` | 3 | forecast worker |
| 6. Outbox, queue, worker, import | outbox table and relay, SQS and ElasticMQ, worker subcommand, forecast ingest, idempotent consumers, S3 presign and import completion, poison quarantine | 1, 3, 5 | forecast beat, notifications |
| 7. Replay, snapshots, verifier | snapshot writer in worker, replay API, verifier subcommand, auditor view, diff view | 1 | tamper beat |
| 8. Tracing and health | OTel instrumentation across API, worker, SQS attributes, Jaeger and X-Ray, `/healthz` and `/readyz` | 1, 6 | trace beat |
| 9. Images and infrastructure | Dockerfiles, digests, Compose, CDK stacks (VPC, RDS, SQS, S3, Cognito, ECS, ALB, IAM, Secrets), migrate task | 1 onward, progressively | AWS rehearsal |
| 10. Demo tooling and rehearsal | seed file, `demo-reset`, Playwright multi-session script, two variants, state hash | all | talk |

Layers 2 and 4 can proceed in parallel once layer 1 is in place. Layers 5, 6 and 7 are independent of each other after layer 3. Layer 9 starts with the images in layer 1 and expands with each subsequent layer, so the AWS deployment is exercised continuously rather than at the end.

### Critical dependencies

- **Cedar Rust crate.** Policy language stability and the availability of validation tooling. The design depends on the validator in the test suite, which is a hard dependency for claim F3.
- **Postgres features.** `btree_gist`, deferrable exclusion constraints, `LISTEN`/`NOTIFY` under the chosen network path, and row-level security. All are mature, but each has a configuration that must be matched on RDS.
- **ALB WebSocket behaviour.** Path routing, idle timeouts and sticky-off target groups. Verified in the AWS environment early, because a failure there changes the real-time architecture.
- **ElasticMQ and MinIO compatibility** with the exact SDK versions used. Pinned and tested.
- **mock-oauth2-server** as an OIDC issuer for the local stack. Pinned version, tested with the same verification path.
- **Playwright multi-context support** for four simultaneous sessions with distinct storage state, on the demo hardware.

### Main risks

1. **The cross-replica NOTIFY path behaves differently on RDS than locally.** The mitigation is an early AWS spike of layer 4 with two tasks, before any demo content is built on it.
2. **The gap-and-ordering problem in `global_pos` causes a missed event under a rare interleaving.** The mitigation is the overlap-window replay with deduplication, plus a property test that injects out-of-order commits. The residual risk is a bounded delay in delivery, not loss, because the resume path reads from the log.
3. **The solver's output is not impressive enough visually.** The solver's result must be readable: each move has a reason, and the forecast beat has a clear before and after. If the plan looks arbitrary to an expert, the composition argument weakens. The mitigation is to choose the seeded scenario so the solver's moves are individually explainable, and to show the reasons on the proposal card.
4. **Browser choreography is brittle.** Four sessions, websocket timing and animations can break a scripted presentation. The mitigation is the rehearsal in Section F5, deterministic animation completion events, and a presentation mode with no transitions.
5. **Demo narrative compresses too much into five minutes.** Each beat in Section C has one visible result, and the script has a fixed transition sentence. Cutting a beat is possible without breaking the chain: the forecast beat and the replay beat are independent, and either can be removed.
6. **The tamper beat triggers a real security question.** Showing that a superuser can change a record is accurate, and it is the point, but the presenter should state the threat model in one sentence (the verifier detects tampering; it does not prevent a superuser from making it) to avoid a distracting exchange.

The design's central bet is that a small number of well-understood primitives, each tested in isolation, produce a demonstration whose every visible moment is traceable to a specific mechanism. If that bet holds, the five-minute script is a presentation of the architecture rather than an illustration of it.
