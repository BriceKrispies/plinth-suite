# Round 1 review, Reviewer B: skeptical technical audience

Scope: the six proposals in `docs/demo-design/proposals/` (01 to 06), read against the mission brief in `docs/demo-design/00-mission.md`.

Method. Each proposal is read as a principal engineer who has been shown too many demos. The questions are: what would be believed without narration, what looks staged (pre-recorded, scripted, a fault that is switched on by a button, a number that is typed rather than read), where a buzzword stands in for a mechanism, and which claim on stage is stronger than the mechanism behind it. Scores use the mission weights. A proposal is disqualified only for fake functionality, unverifiable architecture claims, or local and cloud deployments that cannot behave the same. No proposal meets that bar in this review, but several have claims that are penalised heavily (see the weaknesses).

Quantities quoted below are the proposals' own labelled targets or counts from their text. None of them was measured here. Script times (for example "240-262 s") are the proposals' own timeline positions.

Weighted composite = depth x 0.25 + cohesion x 0.20 + visual x 0.15 + credibility x 0.15 + narrative x 0.10 + feasibility x 0.10 + reliability x 0.05.

Two defects recur across several proposals and are listed once here so each proposal can refer back to them:

- **ECS StopTask is not a SIGKILL.** Several proposals describe an AWS kill as "a real SIGKILL through ECS StopTask" (01 section C 215-240 and E.2; 05 section E). ECS StopTask sends SIGTERM to the container and sends SIGKILL only after the task's stop timeout expires. The local `docker kill --signal=KILL` path does deliver SIGKILL directly, so the two environments do not produce the same signal, and the "identical semantics" claim is false as written. Any proposal that wants this claim must set the stop timeout to a documented value and say so, or use a different mechanism.
- **Email "exactly once" is an overclaim.** Where a notifier records `processed_messages` "in the same transaction as the send record" (01, 02), the SMTP or SES side effect is outside the database transaction. The design can give at-least-once sends with one recorded row per message id, not exactly-once email. The proposals' own failure tables admit a residual window, while their script lines say "exactly once".

---

## 01 Tallyhouse: a live auction house where every bid is a transaction (Systems Complexity)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 25% | 9 | Bid transaction with `FOR UPDATE`, proxy resolution re-read under the lock, saga kill points and a deferred balance constraint are concrete mechanisms with named tests (F1 to F4). An expert can ask for the test names and find them in the text. |
| Cohesion and feature composition | 20% | 8 | One bid touches lock, event log, outbox, NOTIFY and audit, and the saga and ledger consume the same events. Section B says which capability feeds which. |
| Visual and interactive impact | 15% | 6 | Four windows of forms and tables. The step-plot and the countdown carry the visual load, and G.4 concedes both are presentation. |
| Credibility to expert engineers | 15% | 8 | Honest scope in G.4 (no payment rails, tamper evidence not non-repudiable). Credibility drops where the script claims more than the mechanism (weaknesses 2, 4, 5). |
| Five-minute narrative quality | 10% | 7 | Clear arc from bid war to kill to proof. The middle section (60-135 s) is operator buttons and fault switches, which dilutes the story. |
| Implementation feasibility | 10% | 5 | Go, sqlc, pgx, React SPA, Terraform with seven modules, ElasticMQ, MinIO, Playwright, two replicas, a settlement saga and a scratch-schema rebuild. Each layer is runnable (H.2), but the total surface is large. |
| Live-demo reliability | 5% | 5 | The kill scene needs an orchestrator restart inside a 22 s window (G.2), the withdrawal race depends on an operator-forced deadline, and FIFO fidelity differs between ElasticMQ and SQS. |

Weighted composite: 7.40.

### Strongest ideas

- Hidden proxy maxima protected by RLS with a single engine role as the only reader (D.5), plus a fail-closed test (a fresh connection with no `SET LOCAL` returns zero rows). This is the kind of claim an expert checks by running `psql`, and the proposal makes it checkable.
- Kill points as a harness (`TestSettlementKillPoints`): SIGKILL at four saga states with recorded attempt numbers. This is the strongest technical moment in the set because it asks for evidence at each boundary, not one happy-path run.
- The projection rebuild as a second implementation of the bid rules, compared by hash on the live auction (G.3). It converts a maintenance cost into a checked invariant, and the proposal says so openly.
- The G.4 list of shallow features is the most credible text in the set. It names the things an expert would otherwise catch.

### Weaknesses (most severe first)

1. **The kill is not the signal the script says it is.** Section C 215-240 says the worker receives "a real SIGKILL ... through the orchestrator (ECS StopTask with the KILL reason in AWS)", and E.2 says the semantics are "identical". ECS StopTask sends SIGTERM first. Because the scene's strongest claim (no double payout after a mid-transaction death) is about SIGKILL, a skeptic will ask which signal the AWS run delivered, and the answer in the text is wrong.
2. **The closing line overclaims against the proposal's own threat model.** Section C 285-300 ends "The record cannot be edited without a visible break." G.4 says "anyone with write access to `audit_head` and `audit_log` can rewrite history", and anchoring is "a backlog item ... not implemented". The stage line promises the property the design says it lacks. The audience will hear the stronger version.
3. **"Each exactly once" in the email scene.** Section C 240-256 says Mailpit shows each email "exactly once" and that the message id is recorded "in the same transaction as the send record" (B.10 and section C). The SMTP send is outside the transaction. G.2 concedes "an email sent but not recorded is the one residual window". The scene asserts the strong property and the failure table admits the weak one.
4. **The withdrawal race is staged by the operator.** Section C 160-180 uses "Force close in 2 s", which moves `ends_at` through the scheduler's code path, then has Priya click Withdraw in the same window. Two human clicks racing for a lock is not contention the audience can see. A skeptic will assume the close was timed to make the withdrawal lose.
5. **The hash check excludes the fields that would expose a rebuild that disagrees.** G.3 removes `committed_at` and `server_time` from the hashed state. That is reasonable for determinism, but the "Prove it" panel then compares a subset of state and is presented as "the projection hash equals the live hash". The panel should name the fields it hashes.
6. **Burst numbers do not agree across the text.** The pitch says a "200-request concurrent bid burst". Section C 60-100 issues 180 requests (three bidders, 60 each), and the claim test uses 200 goroutines with 20% retries. The counters and the test are not the same experiment, so the audience-visible number cannot be cross-checked against the test.
7. **Scene density.** Twenty-six numbered moves, four windows, an operator console, a terminal and a scratch-tamper routine in 300 s. Each scene is individually credible, but the presenter switches windows roughly every 10 s in the middle third, and the proposal's own reliability section depends on every scene being green.

### Required changes

- Replace the "SIGKILL through StopTask" wording with the mechanism actually used (for example a stop timeout set to zero plus a documented SIGKILL path, or a task-level kill that the orchestrator documents as SIGKILL). Make E.2 state the difference if one remains.
- Replace the closing line with the stated threat model, or implement the external head anchor (an object-locked checkpoint) and keep the line only if the anchor is verified on stage.
- Change the email claim to "one recorded send per message id; the mail sink shows one message per id in the rehearsal", and say the residual window is there.
- Remove the operator-forced deadline from the withdrawal scene, or label it on screen as an operator-forced close.
- Name the fields the rebuild hash covers on the "Prove it" panel.
- Reconcile the burst size between the pitch, section C and the claim test.

---

## 02 Tideline Live: every accepted bid is serialized, authorized, traced, settled and chained (Visual Spectacle)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 25% | 7 | Serialized bid with ladder check, idempotent response replay, per-audience redaction and Object Lock checkpoints are real mechanisms with tests. The Floor view is presentation (G.4), and several supporting pieces (OIDC contract, trace waterfall) are not part of the core claims. |
| Cohesion and feature composition | 20% | 7 | The lock order and `auction_seq` tie realtime, audit and projection together. Identity, tracing and email add surfaces that do not feed the headline claims. |
| Visual and interactive impact | 15% | 9 | Ring, ladder, gavel, trace waterfall and a phone-width bidder view are designed for a room. This is the strongest visual proposal, tempered by the self-declared cosmetic animations. |
| Credibility to expert engineers | 15% | 6 | Idempotency analysis and sequence-gap reasoning are strong. The checkpoint argument is weaker than the script's line (same AWS account, and the local run uses MinIO whose root can bypass retention, per E.2). |
| Five-minute narrative quality | 10% | 8 | Clear arc (bid, retry, proxy, snipe, close, settle, notifier kill, verify, tamper). The final 30 s is strong. The deliberate 20 s wait at 160-180 s weakens the middle. |
| Implementation feasibility | 10% | 5 | Rust with axum and sqlx, Cedar, OpenTelemetry, OIDC against Cognito and Keycloak, ElasticMQ, MinIO, Mailpit, CDK, nginx, Playwright. Eleven layers, several parity contracts. |
| Live-demo reliability | 5% | 5 | Ring and gavel depend on client clock offsets, the local tamper relies on a trust gap that the local run cannot demonstrate, and the flaky-network toggle is a client-side imitation. |

Weighted composite: 6.95.

### Strongest ideas

- Explained rejection: the 3,950 bid is refused with `BID_BELOW_MINIMUM`, the ladder version, the band and the next minimum. An expert sees the rule behind a number, and the rule is the one the server enforces.
- `auction_seq` assigned under the auction lock, with the rejected alternative (a `bigserial` read by a poller produces permanent holes) explained in D.4 and G.1. This is the mechanism-level reasoning experts respect.
- One redaction function per audience applied to both the query path and the realtime path, with a grep-able frame capture as evidence (claim 3). The frame capture is a checkable artifact an expert can open.
- The stated threat model on screen before the tamper (H.3 risk 10). An audience told the rules before the attack is harder to fool.

### Weaknesses (most severe first)

1. **The ladder does not describe the bid the script accepts.** The ladder is "start 4,000, step 100 up to 5,000, step 200 up to 10,000". Section C 196-206 has Ben bid 6,100 and the bid is accepted. 6,100 is not on the 200-step grid from 5,000 (5,000, 5,200, 5,400, ...). Either the ladder is a minimum-next-bid rule (then say so, and say bids above the minimum are free) or the scene contradicts the table the proposal calls the rule the server enforces. The proposal's selling point is precisely that the table is the rule.
2. **Dead air in the middle.** Section C 160-180 is an explicit wait for the ring to turn amber, "the only deliberate pause". The brief says to avoid waiting. A skeptic reads the pause as a spot where something is being covered, and the proposal does not say what would fill it.
3. **The "flaky network" is a client toggle, not a network fault.** Section C 80-100 says Ben's window "drops the next response after the server has replied". The claim test (claim 2) uses a fault-injecting proxy in front of the API. The stage shows a different mechanism from the one that is tested, and an expert who sees a toggle in a browser window will assume the response is simulated.
4. **The trace waterfall's source is not on the stage.** Section C 40-60 shows "about nine spans across three processes" with "span durations are measured values". E.2 says the Console "opens the backend-specific UI in a new tab" and G.2 says the panel shows "collector unavailable" if the collector is down. The waterfall shown is therefore either the in-app rendering or a separate backend, and the proposal does not say which. A skeptic will ask to see the backend.
5. **The email dedupe and the "each exactly once" line.** Section C 240-256 says the notifier records the message id "in the same transaction as the send record" and that Mailpit shows each email exactly once. This is the same overclaim as 01: the SMTP or SES effect is outside the transaction. G.2 admits "an email sent but not recorded is the one residual window".
6. **The headline tamper is weaker on the primary run.** H.1 makes the local run the primary, and E.2 says MinIO's root "can bypass retention in ways S3 does not allow". Section C 282-300 shows "checkpoint #2 ... compliance retention until 2027-01-05". On the local run the anchor does not prove what the stage line says, and the proposal does not state that the screen will show the local trust gap.
7. **Trust argument versus the AWS account.** G.4 says the checkpoint is "in a bucket under the same AWS account as the database ... weak against an account administrator". The closing line of the scene ("a copy of the history the superuser could not rewrite") is true only against the database owner, which the proposal scopes. The audience will hear the broader version.

### Required changes

- Define the ladder precisely (minimum next bid with optional grid), and make the 6,100 bid either conform or say explicitly that bids above minimum are allowed.
- Replace the 160-180 pause with a real event (for example, a second lot's close or a settlement step), or cut it.
- Use the fault proxy from claim 2 for Ben's dropped response on stage, and say so.
- Show the trace backend once in the rehearsal and state which UI the stage uses, or drop the "measured span durations" language from the script.
- State on screen that the local run's checkpoint is not a trust anchor against the local root, or make the anchor step AWS-only.
- Apply the email wording change used for 01.

---

## 03 Ledgerwell: multi-tenant spend control with tamper-evident approvals (Enterprise Platform)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 25% | 7 | RLS with `FORCE`, a row-locked budget with a database `CHECK`, a versioned workflow pinned per request and a hash chain are concrete. Much of the depth is standard PostgreSQL, and the climax depends on a drill that runs under a role with `UPDATE` on the ledger. |
| Cohesion and feature composition | 20% | 8 | One submission touches RBAC, CEL guard, budget lock, workflow pin, ledger, outbox, stream and trace in a single commit. The composition argument in section B is concrete. |
| Visual and interactive impact | 15% | 5 | Enterprise admin screens, budget cards, approval inboxes, a ledger list and a trace panel. The proposal names generic admin styling as its own top visual risk (H.4 risk 4). |
| Credibility to expert engineers | 15% | 7 | Budget arithmetic checks out (400,000 minus 240,000 minus 60,000 leaves 100,000; 48,000 leaves 52,000; the 35,000 race leaves 17,000). Isolation test is generated from a catalogue. The drill and the step-up are simulated locally. |
| Five-minute narrative quality | 10% | 7 | Clear money story and a clear invariant header. The drill beat is hard to follow: approvals, a forensics role, an operations table and a second verify all in one scene. |
| Implementation feasibility | 10% | 5 | Go, CEL with a restricted subset compiled to TypeScript as well, Cognito and Dex with a parity adapter, five CDK stacks, SQS, S3 with Object Lock, KMS, a generated OpenAPI client and five Playwright contexts. The CEL-subset duplication is the largest correctness surface (section H). |
| Live-demo reliability | 5% | 5 | The race depends on a browser barrier that the proposal itself says may fail and force a reset mid-talk. The ERP fallback is a pre-generated artifact. The drill environment differs from production. |

Weighted composite: 6.60.

### Strongest ideas

- Budget reservation as both a row lock and a database `CHECK (encumbered + spent <= allocated)`, with the 35,000 and 35,000 race as a deterministic pair whose arithmetic the audience can check on screen. This is the simplest concurrency demo in the set and the most believable.
- One `Decide()` used by the RBAC gate, the UI control and the stream filter, with the decision trace read from stored evaluation rows rather than recomputed (D2, F5). A skeptic can verify that the button and the 403 name the same rule.
- Corvane's 404 with a body identical to a nonexistent identifier (20-30 s). It is short, legible without narration, and it is a real isolation test.
- Immutable published workflow versions enforced by trigger, with each request pinned to a version (D4). It answers the "what rules applied" question that auditors ask.

### Weaknesses (most severe first)

1. **The climax cannot run where the artifacts run.** The drill uses `ledgerwell_forensics`, which "exists only in the local and staging environments and is gated by a break-glass procedure in production" (persistence model). The brief requires identical core behaviour local and AWS, and an AWS demo that needs a non-production role for its tamper is not that. The proposal does not say whether the AWS demo is staging.
2. **The dual-control step-up is simulated locally.** Section C 215-245 has Ines confirm with "a second OIDC authentication challenge". E.2 and E `What differs` say Dex "does not implement MFA", and that the locally rehearsed sequence is "the same sequence of screens and events". The audience sees a challenge that the local stack does not enforce. A skeptic will call it a staged confirmation.
3. **The operations log that explains the drill is not tamper-evident.** D persistence says `ops_log` is "outside the chain" and "written by the drill", and G.3 says the verifier flags the drill "only by reading that log". The same forensics role that edits the ledger can edit the explanation. The explanation of a known tamper is therefore not itself protected.
4. **The ERP fallback is a canned artifact.** Section H on-stage failures: if the job is late, "a pre-generated packet exists as a fallback artifact ... presented only if the job is late ... labelled in the UI as the previously generated packet". The stage claims the file was written and hashed by the worker. If the fallback fires, the scene shows a file that was not produced in the run. Even when labelled, that undermines the S3 and checksum demonstration (D7).
5. **The race proves a barrier, not arrival order.** Section F2 uses "a barrier released in the browser and two independent HTTP/2 connections". Section G.2 says a failed barrier reruns the race from reset mid-talk. The audience sees the result (one success, one refusal) but not the server-side arrival order, which is the thing a skeptic would ask for.
6. **The enterprise surface crowds the visual budget.** Five screens, a workflow editor, CSV import, vendor rules and budget dashboards are all in the build (S6 to S9). G.4 calls the dashboards and CSV import shallow. The brief warns against generic dashboards, and the proposal ships several in the rehearsal path.
7. **Two CEL evaluators.** Section H and G.1 point 6 say a restricted CEL subset is evaluated by a Go and a TypeScript evaluator checked against one corpus, and that tenants "cannot write arbitrary CEL in the browser preview". The F5 claim depends on two implementations agreeing on a grammar that the proposal has chosen to keep small. The claim is credible only if the subset is the only thing shown.

### Required changes

- Run the drill and its approval path on the AWS environment through a documented non-production forensics route, or label the AWS run as staging and drop "identical core behaviour" for the climax.
- Replace the simulated step-up with a real second factor locally (a TOTP authenticator stub) or state on screen that the challenge is simulated.
- Make `ops_log` hash-chained or anchored, so the explanation of the drill is tamper-evident as well.
- Remove the pre-generated packet from the live path, or present it in the script as a recorded example and not as the run's output.
- Show server-side arrival order from the request log in the race panel.
- Cut S6 to S8 from the rehearsal path so the five screens get the visual budget.

---

## 04 Quayside: a berth-plan control room for a container terminal (Emergent Composition)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 25% | 8 | Deferrable exclusion constraint, per-stream hash chains, pure reducer with property tests against projections, multi-stream version-checked commit and a bounded solver are each a mechanism an expert can test. The solver is honestly described as greedy plus repair. |
| Cohesion and feature composition | 20% | 9 | The strongest composition in the set: one gesture (a drag, a proposal, a forecast) touches policy, constraints, commit, fan-out, audit and trace. Section B's interaction notes show how the primitives combine. |
| Visual and interactive impact | 15% | 7 | A Gantt with ghost overlays, a proposal card with reasons and a historical diff. The Gantt is well suited to the domain, and the proposal says it is the least technical part. |
| Credibility to expert engineers | 15% | 7 | Candid G.4 and H.4 sections. The cursor replay is described with an overlap window that is not specified, and the tamper beat stops at detection, which an expert will test. |
| Five-minute narrative quality | 10% | 8 | A clean causal arc: refused drag, proposal, conflict, rebase, network loss, forecast, replay, tamper, trace. Each beat has one visible result. |
| Implementation feasibility | 10% | 6 | Rust API and worker, a pure core crate, Cedar, Postgres with `btree_gist`, SQS, a solver, a React Gantt, Compose and CDK. Ten layers with explicit dependencies (H). The solver and the replay watermark are the two hardest parts. |
| Live-demo reliability | 5% | 6 | Cross-replica NOTIFY, the forecast pipeline's SQS latency and the 409 choreography each have a cut or fallback. The forecast beat can be removed without breaking the chain, which the proposal states. |

Weighted composite: 7.60.

### Strongest ideas

- The 409 and the rebase as two distinct paths: the accept of a multi-berth proposal is refused with the new versions, and the rebase re-solves only the affected moves and reports the dropped move with its reason. The audience sees both optimistic concurrency and a re-plan, and the proposal labels the rebase as a re-solve.
- Explained rejections that cite the rule, the value and the tide window (`TT-2026-11-22`). An expert sees a constraint that can be checked against the table.
- Per-stream hash chains with a stated reason (parallel commits, embarrassingly parallel verification). The alternative is named and rejected.
- The honest rebase and solver descriptions ("it is a re-solve, and it can drop moves"; "not optimal and does not prove optimality"). A skeptic tends to trust a team that tells them where the weak point is.

### Weaknesses (most severe first)

1. **Claim F4 is stronger than the mechanism described.** Section F4 claims "exactly once and in `global_pos` order". Section G.1 says the design "chooses the overlap window with dedup for the demo" and records the watermark as a backlog item. The overlap window's size is not given, so a commit that lands beyond it can be missed, and "exactly once" then rests on an unspecified bound. The 150-180 s scene ("applied 7 events") looks exact but depends on a number the proposal does not define.
2. **The tamper stops at detection.** Section C 240-270 has a superuser edit a berth-5 payload, and the verifier finds `berth:5` at sequence 17. H.4 risk 6 says the presenter states that "a superuser can make the change". The proposal does not address a superuser who recomputes the chain, which the audience will ask about in the first minute. There is no external head anchor in the design.
3. **"Not a script" is claimed but not shown.** Section C notes say "the rehearsal runs two variants" with different rebase, forecast and SQL outcomes. The stage shows one variant. The claim in F5 (different branches produce correct end states) is therefore not demonstrated in the five minutes, and an audience member asking for the other branch cannot be answered on stage.
4. **The solver's wow depends on a chosen seed.** Section G.2 says "demo seeds are chosen so the solver completes well within the guard", and H.4 risk 3 says the result must be "readable". The proposal calls the scenario seeded, and the audience will reasonably treat a chosen-seed solver result as a prepared one, even though the solver is deterministic.
5. **The forecast beat has an unbounded pipeline.** Section C 180-210 chains ingest, outbox, SQS, a worker, the solver and a proposal, and the chip shows "queued" if the worker is slow. The fallback is to skip the beat, which removes the "reasoned about the weather" line that the script's transition depends on. The beat is timed on infrastructure latency the proposal has not measured.
6. **The cross-replica claim is harder to see than to test.** The stage cannot select which replica serves the Northwind socket or which replica commits, so the "one trace across two replicas" waterfall depends on whatever load balancing produced. The proposal does not say how the presenter ensures the traced path crosses replicas.
7. **Time travel and the Gantt carry the visual load.** G.4 calls the scrubber "a slider on `global_pos`" and the Gantt "the least technical part of the demo". The only mid-depth visual is the ghost proposal, which needs the solver output to be legible to a non-expert.

### Required changes

- Specify the overlap window (in positions or in time) and its dedupe key, add a test with a commit beyond the window, or drop "exactly once" and use "at least once, deduplicated by `global_pos`".
- Add a head anchor for each stream in object-locked storage, or state on stage that the verifier does not defend against a recomputed chain.
- Show the second variant in a second rehearsal recording, or remove "not a script" from the table.
- Publish the solver's seed and iteration results alongside the proposal so the audience's "chosen seed" question has a documented answer.
- Make the forecast beat's cut point an explicit rule in the script, with the time at which it is taken.

---

## 05 Culvert: live work-order operations for a regional water utility (Live Operational Resilience)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 25% | 8 | The `xid` plus `pg_snapshot_xmin` replay rule (D.4) is a precise answer to commit-order replay that few teams get right. Lease fencing with the database clock and precondition-based offline replay are real mechanisms. The fencing is honestly described as partial (G.1). |
| Cohesion and feature composition | 20% | 7 | One order created at 25 s is written, streamed, filtered, traced and chained. The offline replay touches queue, idempotency, transition and stream. Some capabilities (email, cognito details) sit outside the core. |
| Visual and interactive impact | 15% | 6 | A dark operations palette, a health strip and a chain-block strip are strong signatures. The stage is three windows, a drawer and a console, which makes it busy rather than striking. |
| Credibility to expert engineers | 15% | 6 | The RLS denial logging contradicts the RLS model (weakness 1). Claim 1 uses in-process replicas. The lease kill shows reclaim, not the duplicate window. |
| Five-minute narrative quality | 10% | 7 | The story is easy to follow: create, hide, race, close, offline, kill, deliver, verify, tamper. The middle has many surfaces, and the cross-environment "same result string" ending is not shown on stage. |
| Implementation feasibility | 10% | 5 | Go API and worker, Postgres with RLS and triggers, Cognito and Dex, Terraform with VPC, NAT, RDS Multi-AZ, CloudFront, WAF, Object Lock, Traefik, Toxiproxy, a docker-socket fault controller, PWA with IndexedDB and Workbox, cosign and SBOMs. |
| Live-demo reliability | 5% | 5 | Replacement task start time is not bounded, SSE reconnect depends on a 3 s rehearsal assertion, the Playwright offline emulation must match the presenter's DevTools, and the 250 ms verifier target is unmeasured. |

Weighted composite: 6.65.

### Strongest ideas

- Commit-ordered replay: events are visible only below `pg_snapshot_xmin`, ordered by `(xid, seq)`, and the proposal explains why a sequence is not commit order. This is the most technically interesting real-time mechanism in the set, and it is checkable with a reordered-commit test.
- Offline replay by preconditions rather than versions (D.6). The argument that an unrelated priority edit should not create a false conflict is one an expert accepts immediately, and the 175-205 s scene shows exactly that distinction.
- Authorization in a table and in RLS, with `FORCE` on every application table and `set_config(..., true)` per transaction. The raw-SQL claim (claim 3) can be run with and without the principal set.
- Honest fencing: "the fence narrows the window; it does not close it" (G.1). The proposal names the residual duplicate and the test that shows it.

### Weaknesses (most severe first)

1. **Row-level security cannot produce the stage's denial log or the "3 of 412" count.** Section C 55-85 says the API returns `404` "because RLS removes the row" and writes `read.denied` to the audit log, and that the list reports "3 of 412 rows visible". Under RLS an invisible row is indistinguishable from a missing one inside the same query, so the application cannot log a denial from the same read, and it cannot count 412 as Rafi. Either a second, privileged query runs (which contradicts "nothing bypasses RLS") or the claim is false.
2. **Termination is described as SIGKILL in both environments.** Section C 205-230 and 230-250 and section E ("process-kill faults have identical semantics: SIGKILL") rely on ECS StopTask in AWS. As with 01, StopTask sends SIGTERM first, so the AWS run does not match the local `kill` semantics the scene claims.
3. **The worker kill does not reach the duplicate window it claims to bound.** Section C 230-250 kills w-1 while it holds a lease during a delivery hold, which is before the SMTP send. The result (one message, reclaimed by w-2) would also happen without fencing, so the scene shows lease reclaim but not the at-most-once argument. The duplicate case from claim 5 (kill between SMTP acceptance and commit) is not in the scene.
4. **Claim 1 runs "in-process replicas".** Section F claim 1 says the test "kills one of two in-process replicas". The stage claims two API replicas. An in-process replica does not exercise the process boundary, a separate listener connection in the same process, or a real SIGKILL, so the test does not carry the claim to the demo.
5. **The trace chip is decoration on stage.** Section C 25-55 shows the same trace chip in three windows. G.4 says the chip "is decoration if the ID is not stored with the event and the outbox row", and the chip is never opened in the script. The trace is part of the claimed capability list (11) and of the stage, but the audience sees only the identifier.
6. **The final "same result string on AWS" line is not shown.** Section C 270-300 says "the same verifier in the AWS environment, its result string identical". The 30 s window cannot run a second environment, and E says the parity evidence is a digest check in CI. The line promises an on-stage cross-environment result that the script does not contain.
7. **The console is audited by the same database it edits.** Section D.5 says the console's use "is itself logged to the audit chain by the console's wrapper". The tamper in 270-300 is run by the owner role through that console, and nothing in the design stops the owner from disabling the wrapper. The audit of the console is therefore not tamper evident against the owner, which is the case the scene demonstrates.

### Required changes

- Remove "`read.denied` audited" and "3 of 412" from the RLS scene, or implement denial logging with an explicit, separately audited check and state that it runs outside RLS.
- Replace "SIGKILL through StopTask" with an accurate description, or set the stop timeout and say what it does.
- Move the worker kill to after the SMTP acceptance and before the commit (using a hold placed at that point) to show the duplicate window, or state on stage that only lease reclaim is shown.
- Run claim 1 with separate replica processes.
- Anchor or move the console's wrapper log out of the owner's reach, or state the limit on screen.
- Either open the trace for one submit in the script or drop the trace chip from the claimed capabilities.

---

## 06 Sealroom: blind panel review with a record that cannot be quietly rewritten (Unconventional Innovation)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 25% | 6 | Commit-reveal is a known protocol. The depth is in where it is enforced (RLS, a COI check that holds for raw SQL, anchored audit). The cryptographic core is one SHA-256 commitment, and the reconciliation between the score table and the chain is missing. |
| Cohesion and feature composition | 20% | 7 | Seal, reveal, RLS visibility, outbox, audit and anchor form one loop, and the proposal states it (B, interaction summary). The round and proposal state machines are not defined consistently (weakness 2). |
| Visual and interactive impact | 15% | 6 | Hex strings, a snapshot counter, four identities in four windows and a red banner are memorable. The design leans on forms and status text, and the proposal says it refuses decoration. |
| Credibility to expert engineers | 15% | 6 | The offline verifier and the anchor argument are credible. The reconciliation gap, the reviewer backup and the non-test in claim 1 would be caught in questioning. |
| Five-minute narrative quality | 10% | 8 | The sentence "nobody sees a score until everybody has sealed one" is the clearest opening in the set. The climax (an attack that passes the internal check and fails the external one) is the strongest narrative move in the set. |
| Implementation feasibility | 10% | 7 | Node, Fastify, `pg` with hand-written SQL, one image with a command override, roughly 30 SQL objects and 25 routes. Smaller than the other systems, with the parity suite as the largest share of work. |
| Live-demo reliability | 5% | 6 | Pre-cached tokens, pre-backed-up identities and anchor freshness are all preconditions the proposal checks, and a failure stops the attack step rather than producing a wrong result. Browser IndexedDB state across identities is the main fragility. |

Weighted composite: 6.50.

### Strongest ideas

- Commit-reveal with the nonce kept in the reviewer's browser. The owner's dump showing 64-hex commitments and NULL reveal columns (115-140 s) is a claim the audience can see for themselves.
- The offline verifier as one HTML file with a Content-Security-Policy that forbids connections and a test that asserts zero network requests under `file://`. An expert can verify the claim by disconnecting the machine, and the proposal designs for it.
- The attack that passes the internal chain check and fails the external anchor (255-300 s). It is the only proposal in the set whose climax shows a stronger adversary than the one the claim was framed for.
- Payloads stored as the exact text that was hashed, not as `jsonb` (D.2). The reason is precise and the failure mode it prevents is real.

### Weaknesses (most severe first)

1. **The score table is outside the anchored record.** Claim 3 and section C 255-300 cover the audit chain and the anchor. Revealed scores live in `score_commitments`, with `revealed_score` and `revealed_nonce` columns that the owner can update. Nothing described reconciles those columns, or the stored commitment, with the chain. An owner who edits `revealed_score` and `commitment` together and leaves the audit payload alone is detected by nothing in the design, and the headline "cannot be quietly rewritten" covers audit rows only.
2. **The round state machine is not defined per proposal.** The round holds six proposals (A), and each proposal is sealed by four reviewers. Section C 140-215 moves "the round" to `revealing` and then `closed` when the four P-3 commitments and reveals complete, while the other five proposals are never shown. The design (D.6) says one transaction sets `rounds.state` when the set completes. The proposal does not say whether state is per proposal or per round, and an expert will ask what happens to P-1, P-2, P-4 and P-6.
3. **Claim 1(c) is not a test.** Claim 1(c) says "for each candidate score 0..10 with any nonce other than the real one, the recomputed digest differs". That follows from collision resistance of SHA-256, is true for every commitment, and says nothing about this system's storage. An expert hears a tautology described as an experiment.
4. **The recovery backup can read the nonce.** G.2 describes a `sealroom-reviewer` backup in the terminal that holds the nonce "encrypted with a key derived from the reviewer's passkey-free local secret". The location of that secret is not stated. If the owner can reach either the backup or the secret, the "no score is recoverable before reveal, including by the database owner" claim (claim 1) is false for demo identities, and the audience can ask the presenter where the key is.
5. **The anchor cadence is not stated.** Section G.4 says "an attacker who rewrites history before the first anchor of a round is not detected". Section C 215-240 says the anchor is "anchored at 14:02:11", and H.3 risk 4 says the attack "depends on anchor freshness". The proposal does not say which anchor covers sequence 44, when it was written, or whether it preceded the tamper. The climax needs that fact on screen.
6. **The offline bundle is only as trustworthy as its head.** The verifier checks a segment against the head it contains. A server that rewrote history could produce a matching bundle, and "anyone with the file can check this" then proves internal consistency only. The external head is in the bucket, which the bundle does not reference.
7. **The sealed-score stage is visually sparse.** Most of the stage is a counter (1 of 4, 2 of 4), a button and a red or green text line. The proposal's visual argument is that the hex strings are the visual, which an audience may find thin for five minutes.

### Required changes

- Include `commitment`, `revealed_score` and `revealed_nonce` in the chained payload (or write a per-round digest of `score_commitments` into the audit chain at each transition), have the verifier check the table against the chain, and show the check in the rewrite beat.
- Define the round state machine per proposal or per round in D.6, and show all six proposals' states on the Officer view during the script.
- Replace claim 1(c) with a test that asserts that no score column holds a value before reveal and that the owner dump contains only commitments, and drop the nonce-search wording.
- State where the reviewer backup key lives, show that the owner role cannot reach it, or remove the backup from the demo.
- State the anchor cadence and show, on the Auditor view, the anchor timestamp preceding the edit.
- Reference the external head in the offline bundle (the bucket object version) so the bundle's claim covers the record and not only its segment.

---

## Comparative ranking

Ranked by weighted composite, with the reason for each position.

| Rank | Proposal | Composite | Position |
|---:|---|---:|---|
| 1 | 04 Quayside | 7.60 | Highest cohesion: one gesture exercises almost every primitive, and the proposal states its weak points (solver, rebase, replay bound) plainly. Its main cost is the unspecified replay window and a tamper beat that stops at detection. |
| 2 | 01 Tallyhouse | 7.40 | The deepest demonstrable mechanisms and the best kill-point harness. Its script is dense, its feasibility is the lowest of the top two, and three of its stage lines overclaim (signal, email, closing line). |
| 3 | 02 Tideline Live | 6.95 | The strongest visual proposal and a clear narrative. Its credibility is held back by the ladder example, the dead air, and a local run that cannot show its trust anchor. |
| 4 | 05 Culvert | 6.65 | The best real-time replay design. Its denial-logging scene contradicts its own RLS model, and it has the same SIGKILL and email issues. |
| 5 | 03 Ledgerwell | 6.60 | Strong budget arithmetic and a single decision function. The climax runs under a role that does not exist in production, and the visual surface is the weakest of the enterprise-style proposals. |
| 6 | 06 Sealroom | 6.50 | The most unconventional idea and the best narrative arc, with the smallest feasibility gap. Its reconciliation gap and undefined round state would be found in the first questioning round. |

Notes on the spread. The composites sit within 1.1 points, so the ranking is sensitive to the reconciliation and kill-signal fixes: a proposal that fixes its stage claims moves up by more than the gap between ranks 2 and 5. Proposals 02 and 05 are closest to each other, and 03 and 06 are closest. None of the six should be disqualified on the evidence in its text.

### Ideas worth keeping whichever proposal wins

- **From 04:** per-stream hash chains for parallel commits; the rebase described as a re-solve that can drop moves, with the reason shown; explained rejections that cite a rule identifier and a source table version.
- **From 01:** the projection rebuild as a second implementation checked against the live path on every seeded auction; the fail-closed RLS test (a fresh connection with no `SET LOCAL` returns zero rows); the kill-point harness across saga states with recorded attempt numbers.
- **From 02:** `auction_seq` assigned under the auction lock so that readers can prove contiguity; one redaction function per audience applied to both the query path and the realtime path; checkpoints in object-locked storage with a threat model stated on screen before the tamper.
- **From 05:** commit-ordered replay bounded by the snapshot minimum, with a reordered-commit test; offline replay by preconditions rather than by version; leases timed by the database clock.
- **From 03:** the decision trace read from stored evaluation rows rather than recomputed; one decision function shared by the RBAC gate, the UI and the stream filter; immutable published workflow versions with each request pinned to the version it started under; the deterministic 35,000 and 35,000 budget race.
- **From 06:** the commitment with the nonce held only in the reviewer's browser; an offline verifier that makes zero network requests under `file://`; the "passes the internal check, fails the anchor" climax, once the anchored state covers the score table as well as the audit rows.
