# Round 1 review, Reviewer C: implementation and reliability

Scope: the six proposals in `docs/demo-design/proposals/01` to `06`, read in full against the mission brief in `docs/demo-design/00-mission.md`. Each proposal was evaluated on its own. Findings cite section numbers or script timestamps in the proposal being reviewed. This is a design review: nothing was built or run.

Method and conventions:

- Scores are 0 to 10 per criterion. The weighted total uses the mission weights: depth 25%, cohesion 20%, visual 15%, credibility 15%, narrative 10%, feasibility 10%, reliability 5%.
- Disqualification is reserved for fake functionality, unverifiable architectural claims, or local and cloud deployments that are fundamentally incompatible for a headline claim.
- Feasibility is expressed by the components each proposal touches and by dependency order. The proposals' own quantities (latencies, counts, timeouts) are quoted as labelled values. Where a value is derived from configuration, it is marked as derived.

## Summary

| Proposal | Depth (25%) | Cohesion (20%) | Visual (15%) | Credibility (15%) | Narrative (10%) | Feasibility (10%) | Reliability (5%) | Weighted | Disqualified |
|---|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| 01 Systems Complexity (Tallyhouse) | 8.5 | 8.5 | 6.5 | 7.5 | 6.5 | 3.5 | 4.0 | 7.1 | no |
| 02 Visual Spectacle (Tideline Live) | 7.5 | 8.0 | 9.0 | 5.5 | 8.0 | 3.0 | 3.5 | 6.9 | **yes** |
| 03 Enterprise Platform (Ledgerwell) | 8.0 | 9.0 | 7.0 | 6.5 | 8.0 | 4.5 | 5.0 | 7.3 | no |
| 04 Emergent Composition (Quayside) | 8.0 | 8.5 | 7.0 | 6.5 | 7.0 | 5.5 | 5.5 | 7.3 | no |
| 05 Operational Resilience (Culvert) | 8.5 | 8.0 | 6.5 | 7.5 | 7.5 | 4.5 | 4.5 | 7.3 | no |
| 06 Unconventional Innovation (Sealroom) | 8.0 | 8.5 | 7.0 | 6.5 | 8.5 | 6.0 | 6.5 | 7.5 | no |

Weighted values are rounded to one decimal from the unrounded sums. Proposals 03 and 05 are at 7.325 and 7.25 respectively, and 04 and 05 both sit at 7.25. The ranking below breaks the 04/05 tie on reliability.

---

## 01 Systems Complexity (Tallyhouse)

### Scores

| Criterion | Score | Justification |
|---|---:|---|
| Depth (25%) | 8.5 | Transactional bid engine under `FOR UPDATE`, proxy resolution inside the same lock, SKIP LOCKED scheduler on the database clock, saga with idempotency keys, deferred ledger constraint, hash chain, and a projection rebuild. Real concurrency content (sections D.4, F). Docked for the duplicated bid-rule implementation and the hash-over-jsonb defect below. |
| Cohesion (20%) | 8.5 | One bid writes auction, bid, events, outbox, NOTIFY and audit in one transaction, and every later beat reads one of those outputs (section B interaction summary). Strong composition. |
| Visual (15%) | 6.5 | Four tiled windows, countdown jump and step-plot chart are legible. Most beats are text panels and counters, and the price chart is admitted to be presentation (G.4). |
| Credibility (15%) | 7.5 | Claims are named tests with specific assertions (F, claims 1 to 5) and G.4 is candid. Undercut by the hash-over-jsonb problem (D.2 notes), the ECS kill semantics (E.2), and the script's sequence numbers. |
| Narrative (10%) | 6.5 | Clear arc (contest, burst, drop, snipe, kill, prove, tamper). But roughly 30 beats in 300 s, and the timeline's own figures do not reconcile (see weakness 1). |
| Feasibility (10%) | 3.5 | Touches Go, React, Terraform, Playwright, ElasticMQ, MinIO, three database roles with RLS on five tables, a saga, a ledger, an audit chain, a verifier, a second rebuild implementation and a fault hook. Thirteen dependency layers (H.2). Wide surface for one team to keep correct together. |
| Reliability (5%) | 4.0 | Kill-mid-settlement depends on SQS redelivery timing that the proposal itself says may diverge between ElasticMQ and SQS, and on a restart that must finish inside a 22-second window that is not measured. |

### Strongest ideas

1. The bid path is one transaction that serialises on the auction row and writes the event, outbox row, NOTIFY and audit row together (D.4). Proxy resolution runs under the same lock, and the proposal names the classic read-before-lock bug (G.1 item 1).
2. Gap-free replay from `auction_events` with a `after=<seq>` cursor, plus a client-side hash of the price series checked against the server (115–135 s). This is a concrete, observable proof of ordering.
3. Anti-sniping and close on `now()` in the database, with the scheduler claiming with `FOR UPDATE SKIP LOCKED` (D.4, 135–160 s). Clock skew is removed as an input.
4. The "prove it" scene recomputes the projection from events in a scratch schema and compares hashes (262–285 s). The determinism of the log is checked rather than asserted.
5. Tamper on a scratch copy (285–300 s) keeps the live chain intact while showing the verifier naming the first broken sequence.
6. G.4 lists its own shallow features (price chart, countdown, money, tamper evidence limits, RLS as a boundary). This is the most candid list among the six.

### Concrete weaknesses (most severe first)

1. **The script's sequence numbers cannot all be true.** `committed seq 412` at 0 to 15 s, `seq 413` at 30 to 45 s, `events 1–N contiguous, N = 226` at 100 to 115 s, `last seq 4611` at 115 s and `seq 4636` after 25 more bids. Section D.2 defines `auction_events` with primary key `(auction_id, seq)`, and D.4 says the sequence is contiguous from 1. A 412-to-4611 jump inside about 100 s with 180 burst requests and 25 extra bids cannot occur in the schema the proposal defines. Any rehearsal assertion keyed to these numbers would fail on the first run. Fix: define one counter, and derive every on-screen number from the seed and the run.
2. **The audit hash is computed over `jsonb`, which the proposal itself treats as unsafe elsewhere.** D.2 stores `audit_log.body` as `jsonb` and says the canonical JSON is "produced by the application, not by the database". PostgreSQL's `jsonb` does not preserve the application's key order or whitespace, so reading the row back does not reproduce the bytes that were hashed. The verifier would then report a break on an untouched chain. Proposals 05 and 06 both avoid this by storing the exact hashed bytes. Fix: store canonical text or bytea, and hash only those bytes.
3. **The denied-withdrawal audit row cannot survive the denial as described.** Lines 160 to 180 say the audit row is written "in the same transaction as the denial". The denial is a 409 returned from a handler. If the handler's transaction is rolled back on error, the audit row goes with it. D.5 offers "its own transaction otherwise", which does not match the script. Fix: commit the denial audit in its own transaction before returning the error, and state the rule once.
4. **The outbox relay holds row locks across the SQS call.** The relay in D.3 is `BEGIN; SELECT ... FOR UPDATE SKIP LOCKED; SendMessageBatch; UPDATE; COMMIT`. The network call happens inside the transaction. G.1 item 4 forbids network I/O inside settlement steps for exactly this reason, but the relay does it. Under SQS latency this extends the lock hold for every batch. Fix: adopt a lease with an epoch fence (as proposal 05 does), or document the hold time as a measured quantity with a bound.
5. **"Kill -9" through ECS is not SIGKILL.** Section E.2 maps the operator kill to ECS `StopTask` and says it produces "the same resulting SIGKILL" as `docker kill`. ECS `StopTask` sends SIGTERM and sends SIGKILL only after the container's stop timeout. The stage beat at 215 to 240 s is labelled "ECS StopTask with the KILL reason", which is not a parameter of that API. If the worker traps SIGTERM, the AWS run can finish or roll back the open step differently from the local run. The "identical core behaviour" requirement in the mission is not met as written. Fix: specify an AWS kill path that is a real SIGKILL (for example, a command executed inside the container on the worker PID) and test the same kill points in both environments.
6. **The kill beat depends on an unmeasured restart and on exact redelivery timing.** G.2 gives a 22-second window for the replacement worker to return, and the proposal does not measure ECS task replacement. The visible result at 240 to 262 s ("resumed on attempt 2") also depends on SQS visibility-timeout redelivery, which E.3 and H.3 concede may differ between ElasticMQ and SQS. The proposal then says the script "avoids depending on" such differences. It cannot avoid it for this beat. Fix: wait on an observable event (for example, "worker heartbeat received") rather than a fixed window, and keep the redelivery claim to an outcome assertion.
7. **The projection rebuild is a second implementation of the bid rules.** G.3 and H.4 item 4 accept this as a deliberate trade-off. For a live demo it doubles the logic that must agree under concurrency, including the anti-sniping extension and the leader tie-break. The proposal's own risk section calls the disagreement "a feature for the demo and a maintenance cost", which understates it for a team that must keep both correct.
8. **The closing line overstates tamper evidence.** The final line (285 to 300 s) says "the record cannot be edited without a visible break". G.4 says the chain detects a naive edit only, and that anyone who can rewrite `audit_head` and `audit_log` can recompute the chain. The stage line should match G.4.
9. **Local and cloud TLS and network paths differ in ways the script can see.** E.3 lists TLS to PostgreSQL absent locally and the ALB absent locally. The mission requires identical core behaviour. These are acknowledged, and the impact is limited, but the parity claim should name them in the rehearsal log.

### Required changes

- Reconcile all sequence numbers in section C against one counter and the seed. Publish the table of expected values as generated output.
- Change `audit_log` to store the exact hashed text or bytes, and add a golden test that re-reads a row and reproduces its hash.
- Move the denial audit write out of the failing transaction and state one rule for denial audit.
- Replace the in-transaction SQS call in the relay with a lease and epoch fence, or report the lock hold as a measured bound.
- Define an AWS kill procedure that delivers SIGKILL, and run the kill-point tests on both environments.
- Replace the 22-second restart window with an event-driven wait, and mark the redelivery beat as an outcome assertion only.
- Decide whether the rebuild path is a second implementation or a replay of the live code. Either way, state the test that keeps them in agreement.
- Align the closing line with G.4.

---

## 02 Visual Spectacle (Tideline Live)

**Disqualified.** The headline finale (steps 256 to 300 s, and claim 5) depends on an S3 Object Lock anchor that the proposal says cannot prove its trust argument locally. Section E.2 states that MinIO's root user can bypass retention in ways S3 does not, and that "the local verifier therefore cannot prove the trust argument". Section G.2 makes the local Compose run the primary run and the AWS run a second, separately rehearsed run. So the central security property of the stage demonstration is different on the primary deployment from the one the audience is told about. That is a fundamental local and cloud incompatibility for a headline claim. The proposal would be eligible again if the finale were run only on AWS and labelled as such, with the local run showing chain-only detection and saying so on screen. The other problems below apply regardless.

### Scores

| Criterion | Score | Justification |
|---|---:|---|
| Depth (25%) | 7.5 | Serialised bid transaction with explicit lock order, `auction_seq` assigned under the auction lock (D.4 explains why), Cedar with attribute loading inside the transaction, versioned ladder, idempotency with stored response, and a clock worker with `SKIP LOCKED`. Real depth, but several items are admitted to be shallow (G.4). |
| Cohesion (20%) | 8.0 | One click crosses browser, authorisation, lock, event, hash, proxy, fan-out and trace (section B). The audience-specific projection function shared by query and realtime paths (D.5) is a clean composition. |
| Visual (15%) | 9.0 | Floor projection, phone and desktop bidder windows, ladder rejection toast, countdown ring and gavel make the strongest visual argument of the six. |
| Credibility (15%) | 5.5 | False or unsupported platform claims: SES "idempotent by the `message_id` header" (G.2), an external email send claimed to be atomic with a database row (D.3), and a finale that the primary local run cannot reproduce. |
| Narrative (10%) | 8.0 | Clear arc: bid, reject, flaky network, proxy, outage, snipe, sale, settlement, notifier kill, audit, tamper. The finale line is strong. Arithmetic in the timeline is wrong (see weakness 2). |
| Feasibility (10%) | 3.0 | Rust backend (axum, sqlx, Cedar, OpenTelemetry), React web, Keycloak and Cognito with a contract suite, ElasticMQ, Mailpit, MinIO, Jaeger and X-Ray, CDK with five ECS services, Aurora, and eleven ordered layers. Very wide surface. |
| Reliability (5%) | 3.5 | Local primary run depends on a finale that is not faithful locally. Frame-time assertions in a rehearsal on a presenter laptop, a late snipe fallback at 0:09 that is hard-coded, and a notifier kill whose result depends on SES behaviour the proposal does not support. |

### Strongest ideas

1. `auction_seq` is assigned under the auction row lock, so commit order equals sequence order. The proposal explains why a bigserial read by a poller produces holes (D.4). This is the simplest correct answer to the gap problem among the six.
2. A single projection function per audience is used for both the query path and the realtime path, and is unit-tested per audience (D.5, F claim 3). Redaction becomes a property of one function.
3. Cedar denials return the policy identifier, and the rejection toast names the rule (D.5, 60 to 80 s).
4. The threat model is stated on screen before the tamper step (H.3 item 10). This is the right framing for an expert audience.
5. Explicit trace propagation through the outbox, so the notifier span is a child of the bid span (G.1).

### Concrete weaknesses (most severe first)

1. **The finale is not reproducible on the primary run.** See the disqualification note. The proposal names the gap (E.2 "MinIO's root user can bypass retention"), but the script and G.2 still rely on it for the closing claim.
2. **The timeline contains a rejected bid that the script treats as accepted.** Lines 140 to 160 have Ben bid 4,500 during the outage, and Ana's proxy counter-bids to 4,600. Lines 180 to 196 have Ben "bid 4,500 in the final 10 seconds". At that point the leader is at 4,600 (Ana's proxy "at 4,600 of 6,000" on the same line), so a 4,500 bid is below the current price and the ladder rejects it. The beat cannot happen as written.
3. **The countdown numbers do not match the reset.** Lines 75 to 80 show `3:20` at start and a 200-second deadline set by the reset. Under that deadline the ring reaches 0:10 near 190 s, not at the 160 to 180 s beat, and zero is at about 200 s, while the gavel fires at 206 to 214 s. The anti-sniping window is also given as 10 s in the snipe beat and as a general window in D.4. Fix the window value and derive the ring times from the reset anchor.
4. **The tamper target does not match the event numbering.** The script's bids put event 419 at Ana's proxy counter-bid of 4,600, not at the 6,100 bid. The "verified 421 events" count (256 to 266 s) is also inconsistent with about nine events after seq 412. The on-screen edit (6,100 to 5,100 at 419) would therefore alter the wrong row.
5. **The tamper scene shows the weakest case of the claim.** Lines 266 to 282 change a payload without recomputing hashes, so the chain fails at once and the checkpoint is not needed to see the break. Claim 5 says a recomputed chain is caught only by the checkpoint, but that case is not shown live. The stage shows the easy case and the claim describes the hard one.
6. **The notifier's exactly-once effect is not achievable with the design described.** D.3 says the notifier checks `processed_messages` "in a transaction with the send record". The send to SES happens outside the database transaction, so a crash between the send and the commit produces a second email. G.2 says "SES sends are idempotent by the `message_id` header in the Mailpit path". Mailpit is not SES, and the proposal does not show an SES mechanism that dedupes on a custom header. The claim should be stated as at-least-once with a narrow window, as proposal 05 does.
7. **Compliance-mode checkpoints accumulate across runs.** D.2 writes a checkpoint at each lot close and at a fixed count, and C13 puts them in compliance-mode Object Lock. Retained objects cannot be deleted before their retention ends, so each rehearsal and each reset leaves locked objects behind. The reset path (E.3) does not address this, and the on-screen retention date ("until 2027-01-05") is a fixed value that does not match a run started on a different day.
8. **The browser performance gate is unlikely to be stable.** G.2 says the rehearsal "fails on sustained long tasks above 50 ms during the snipe window". Long-task measurements depend on the machine and its load while four sessions run. A gate of this kind will fail for reasons unrelated to the system.
9. **The trace panel leaves the application.** G.2 and E.2 say the trace panel opens the backend-specific UI (X-Ray or Jaeger) in a new tab. The audience sees a context switch on each trace, and the two trace UIs differ.
10. **The identity contract is duplicated work.** Section E.2 and H.2 require a Keycloak and Cognito contract suite with fixed tokens from both issuers, and a claim-mapping pass. Two identity stacks in the local and cloud paths add a parity surface that the demo does not need to show.

### Required changes

- Restrict the finale to the AWS run and label the local run's audit evidence as chain-only. Or remove the local-run requirement for the finale.
- Fix the bid-by-bid timeline so that every bid is valid under the ladder at the time it is placed. Recompute the event numbers from it.
- Derive the countdown beats from the reset anchor and the configured window, and state one anti-sniping window value.
- Make the tamper target the event number produced by the script, and resolve it by a query rather than a constant.
- Show the recomputed-chain case live, since claim 5 depends on it.
- Replace the SES idempotency claim with an at-least-once statement and a bounded duplicate window.
- Define the retention and cleanup plan for compliance-mode checkpoints, and parameterise the retention date.
- Replace the frame-time gate with a server-side or state-based assertion.

---

## 03 Enterprise Platform (Ledgerwell)

### Scores

| Criterion | Score | Justification |
|---|---:|---|
| Depth (25%) | 8.0 | Tenant RLS with `FORCE`, a budget row lock with a database `CHECK`, versioned workflows with trigger-enforced immutability, `If-Match` concurrency, a per-tenant chain-head lock, RFC 8785 hashing with shared test vectors, and a single `Decide()` for UI and server. Real depth in the right places. |
| Cohesion (20%) | 9.0 | One commit writes the reservation, request, ledger event, outbox row and idempotency record (D.6, section B "how the capabilities compose"). The drill and verifier reuse the same stream. This is the strongest composition in the set. |
| Visual (15%) | 7.0 | Five windows, a budget card that refuses to overflow, a decision trace, a live ledger ticker, and a red banner across all Halvard sessions. The proposal acknowledges the risk of a generic admin look (H.3 item 4). |
| Credibility (15%) | 6.5 | Several mechanisms in the script do not produce the stated result: the verifier link-check explanation, the anchor comparison, and the CEL-versus-subset contradiction. Each is specific and fixable. |
| Narrative (10%) | 8.0 | The opening invariant header, the Corvane 404, the race and the drill are well paced. The closing drill is a strong idea, and the timing notes state which numbers are targets. |
| Feasibility (10%) | 4.5 | Go API and worker, a TypeScript browser evaluator for a CEL subset with a shared corpus, five CDK stacks, Cognito with MFA, Dex locally, S3 with Object Lock, KMS, SQS, Playwright. The dual evaluator is the largest correctness surface, as section H says. |
| Reliability (5%) | 5.0 | The race outcome is labelled by name although the winner depends on arrival order. The drill and the verifier output depend on details that do not compute as described. Cognito and Dex differ on MFA, which the proposal handles with a simulation. |

### Strongest ideas

1. One commit produces the business change, ledger event and outbox row, and the proposal shows the audience that the consequences agree (A, "The sophisticated capability").
2. `Decide()` is called by the approve button, the API handler and the decision trace, with stored evaluations rather than re-derivations (D2, D4, F5). The UI cannot promise what the server refuses.
3. The budget is protected by a row lock and a database `CHECK` (D3, F2). The race test has a deterministic seeded case.
4. The drill writes an operations log outside the chain, and the proposal states that the break is still reported (G.1 item 7). This is the honest form of a dual-controlled tamper scene.
5. The projection-versus-ledger disagreement (REQ-0412 still shows 9,600 while the ledger changed) is a useful, concrete illustration of why the chain matters.

### Concrete weaknesses (most severe first)

1. **The verifier's described behaviour is wrong.** Lines 245 to 275 say the link check for the row after 1,612 "fails because it chains to the stored hash of the tampered row", and that verification "stops at the first failing sequence" while also reporting the following link. The drill changes the stored payload and leaves `hash` unchanged. The successor's `prev_hash` still equals that stored hash, so the link check passes. Only the recomputed payload hash for 1,612 fails. Either the script or the verifier semantics must change.
2. **The anchor check cannot fail the way the script says.** Lines 275 to 300 say "the comparison also fails" against the most recent Object Lock anchor. The drill does not change the head hash. D.6 writes anchors at a fixed sequence interval. Unless an anchor covers sequence 1,612 and is compared at its own sequence, the head comparison has nothing to disagree with. Fix: state the anchored sequence and compare it explicitly, or remove the line.
3. **The race labels depend on arrival order.** Lines 120 to 140 name HF-2291A "Submitted" and HF-2292 "Rejected". The browser barrier releases requests together, but G.2 and F2 do not guarantee which request reaches the lock first. The rehearsal asserts one success and one 409, not which one. The on-stage labels must be derived from the ledger's order of commit.
4. **The sequence numbers do not reconcile.** Section C says the submission is event 1,838, and G.2 says the seed holds "about 1,840 events for Halvard at the demo start". The 185 to 215 s verification then reports "1,840 events verified", which is smaller than the count after the race and the approvals. The 160 to 185 s ticker says "about 1,840". Derive the counts from the seed and the run.
5. **The CEL commitment contradicts the subset in G.6.** B and D2 say tenants author CEL guards, and the step 2 guard is "the current approval step's CEL expression". G.6 says the browser evaluator implements a restricted expression subset, and that "tenants cannot write arbitrary CEL in the browser preview". F5 relies on identical outcomes across Go and TypeScript evaluators over several thousand combinations. The claim is sound only if the language is the subset. The proposal should say so in section A and B.
6. **Hashing includes a timestamp that JavaScript cannot round-trip.** The hash definition in D.2 covers `occurred_at`, which is a `timestamptz` with microsecond precision in PostgreSQL. A JavaScript `Date` carries milliseconds. D.2 and G.1 say the TypeScript client verifies the shared test vectors, so the browser must reproduce the same bytes. The proposal needs an explicit truncation rule or must exclude `occurred_at` from the hashed fields.
7. **The Cognito custom claim is probably not in the token the API reads.** D.5 requires the API to validate access tokens and to map a custom `tenant_id` claim. Cognito places custom attributes in the ID token by default. Getting them into access tokens needs a pre-token-generation trigger, which is not in the component list or the five CDK stacks. Dex maps the claim differently. The adapter is said to "tolerate" either token, but the mapping must be specified because a missing claim fails closed for every request.
8. **The browser's web artifact is not the server's container in AWS.** E says the web image reads `/config.json` at runtime, and D says the web bundle is served from S3 and CloudFront in AWS. The AWS web artifact is therefore a file copy of the image's contents, not the image. The "same artifacts" claim should say that.
9. **The local MFA is not MFA.** E.2 and E.3 state that Dex has no MFA and that a second Dex connector challenge simulates the step-up. The dual-control moment is the same sequence of screens, but the security property differs. The stage drill is shown locally as the primary run, so the audience sees a step-up that is not a second factor.
10. **The drill runs in staging, which is not the AWS shape described.** D.1 and E.2 place the forensics role in local and staging only. The AWS run in the proposal is therefore the staging stack with a role that production does not have. This is acceptable if said, and the proposal should say it on the same page as the drill.

### Required changes

- Correct the verifier semantics for the link check, and make the stage line match the stored result.
- Specify the anchored sequence used for the anchor comparison, or remove the anchor line from the script.
- Derive the race labels from the commit order in the ledger.
- Reconcile every event number in section C with the seed.
- State in sections A and B that the guard language is the restricted subset.
- Add a truncation rule for `occurred_at`, or remove it from the hashed fields.
- Specify the Cognito pre-token-generation mapping, and list the trigger in the infrastructure.
- Say on the drill's page that the local step-up is simulated and that the staging role is not a production role.

---

## 04 Emergent Composition (Quayside)

### Scores

| Criterion | Score | Justification |
|---|---:|---|
| Depth (25%) | 8.0 | Deferrable exclusion constraint on `slots`, per-stream hash chains, Cedar single-sourced with a capabilities endpoint, NOTIFY after commit with a dedicated listener, deterministic solver, snapshot-plus-tail replay, and a forecast ingest path through the same command path. The solver is admitted to be greedy with no optimality bound (G, shallow list). |
| Cohesion (20%) | 8.5 | The stated thesis, that one gesture touches the primitives, is delivered by the script: drag, constraint check, proposal, accept with 409, rebase, fan-out, replay, forecast, replay, trace (section B). |
| Visual (15%) | 7.0 | A Gantt with a ghost overlay, three role views, a proposal card with reasons, and an audit diff. The proposal says the Gantt is the least technical part (G). |
| Credibility (15%) | 6.5 | The in-order delivery claim conflicts with the overlap-window design, the solver's wall-clock guard conflicts with its determinism claim, and the trace beat depends on replica routing the presenter cannot control. |
| Narrative (10%) | 7.0 | The arc is clear, but the closing step that the script relies on (an accepted forecast proposal) is not in the script. |
| Feasibility (10%) | 5.5 | Rust API and worker, a pure core crate, a React web app, CDK, Cognito, SQS, S3, Postgres with `btree_gist`. Layers are ordered and each is testable (H). Smaller than 01, 02, 03 and 05 in moving parts, but the solver and the replay are substantial. |
| Reliability (5%) | 5.5 | The 409 and rebase beats are deterministic. The forecast beat depends on worker pickup, and the trace beat depends on which replica serves each request, which is not controlled. |

### Strongest ideas

1. The deferrable exclusion constraint on `slots` makes double-booking a database fact, and the proposal explains the half-open interval discipline (D, hidden complexity).
2. Per-stream hash chains allow berths to commit in parallel and let verification run per stream (D, "Each stream has its own hash chain").
3. Rebase re-runs the solver on a smaller input and reports dropped moves with reasons (B6b, 120 to 150 s). It is honest about being a re-solve.
4. The forecast file enters through the ordinary command path, so the worker's proposal is indistinguishable from a planner's proposal apart from its source (183 to 210 s).
5. The reset is produced by replaying a seed file through the normal command path (B16), so seeded state and user state are produced by the same code.
6. F5 proposes two variant runs of the same script that branch differently and must both end in a correct state. This is a good rehearsal design.

### Concrete weaknesses (most severe first)

1. **In-order delivery is claimed and not designed.** F4 claims "every committed event reaches every authorized session exactly once and in `global_pos` order". The design allocates `global_pos` with `GENERATED ALWAYS AS IDENTITY` (D.2), which is assigned before commit. G (implementation difficulties) admits that transactions can commit out of allocation order, and the mitigation chosen is an overlap window with deduplication. No window size or watermark is specified. A slow transaction with a lower position can commit after the client has advanced past it, and the overlap window only helps if it is larger than the transaction's lifetime. The claim should be restated as at-least-once with bounded replay, or the watermark should be built.
2. **Determinism is undermined by the wall-clock guard.** B5 claims "given the same plan snapshot, horizon and seed, produces the same proposal". The solver is bounded by "an iteration cap and a wall-clock guard that reports partial results", and G says the guard "returns the best proposal so far, marked partial". A slower machine stops earlier, so the same seed can produce a different proposal. The reset-state hash that the rehearsal prints depends on it. The demo path should use an iteration bound only.
3. **The literal global position on screen is not reproducible.** Lines 150 to 180 say "Resumed from position 48,217". `global_pos` is an identity column, and the demo reset truncates and reapplies (B16). Identity values are not reset unless the truncate restarts them, and the proposal does not say it does. The number on screen would change between resets, and the rehearsal can only check it if it reads it back.
4. **The forecast acceptance that the trace beat needs is not in the script.** Lines 270 to 300 open the trace of "the forecast-driven proposal acceptance, which Ines performed in the forecast beat, or the rebase acceptance if the forecast beat was skipped". The forecast beat at 180 to 210 s has Ines load the file and see a proposal, and it does not have her accept it. The rebase fallback is a different beat. Add an explicit accept step to the forecast beat.
5. **The trace beat promises two replicas that the presenter does not control.** Line 270 says the waterfall crosses "API replica A" and "API replica B". Which replica serves a given request, and which replica holds the WebSocket, depends on the load balancer. The proposal does not provide a way to route a request to a chosen replica for the demo, so the claim may not appear on a given run. Provide a documented routing header or a sticky test route.
6. **The `sub`-based token check conflicts with the Cognito access-token claim.** D5 says the API "checks `iss`, `aud`, `exp` and `token_use`", and maps `custom:carrier_id` into Cedar principals. Cognito ID tokens have `token_use` equal to `id`, and custom attributes are in the ID token by default. The proposal does not say which token carries the attribute, and a check that rejects the wrong `token_use` would reject every login. Specify the token and the mapping.
7. **The demo accounts' token lifetime is stated inconsistently.** E says local tokens are 8 hours "to match" Cognito, and the Cognito note in G says "demo accounts have long access tokens". The Cognito access-token lifetime is configured per app client and is not the same as the local value. The parity table should give the configured number in both environments.
8. **Identity-based row security and Cedar both gate the carrier view.** D says RLS on `visits` and `slots` is keyed on the session carrier, and Cedar filters the same rows in the application. The consistency of the two rules is claimed in F3 but is a second rule set that must be kept equal. This is defence in depth, but it is also a second authoritative policy that F3 must test on every change.
9. **The forecast ingest path is not described to the file level.** The forecast file is loaded "through the forecast panel" (183 to 210 s), but the presigned-upload path in B14 is for manifests and imports. The proposal does not say how the forecast file reaches S3 or the database.
10. **The solver's "412 ms" shown on screen is a design target.** The proposal says so (C notes). The script line presents it as an observed value, so the presenter would read a number that the rehearsal may not produce. Label it as the measured value from the rehearsal or remove it.

### Required changes

- Replace the in-order claim with a stated watermark or an explicit overlap bound, and test the out-of-order case at that bound.
- Remove the wall-clock guard from the demo path, or make its result part of the proposal's identity.
- Make the global position reproducible by restarting identities in the reset, and state it in the reset description.
- Add an explicit forecast accept to the forecast beat, and make the trace beat refer to it.
- Provide a routing mechanism that places a request on a named replica for the trace beat.
- Specify which Cognito token carries the carrier attribute, and the Cedar mapping for it.
- Give the configured token lifetimes in the parity table.
- Describe the forecast file's upload path.

---

## 05 Operational Resilience (Culvert)

### Scores

| Criterion | Score | Justification |
|---|---:|---|
| Depth (25%) | 8.5 | The `xid` plus snapshot-minimum replay watermark (D.4) is a sound and testable answer to LISTEN/NOTIFY gaps. Lease claims with epoch fencing on database time, an audit chain over canonical bytes, RLS driven by a membership table, and preconditions rather than versions for offline replay. The deepest correctness content of the six, along with 01. |
| Cohesion (20%) | 8.0 | Each action builds on the state, chain and stream left by the previous one (section B interaction graph). The membership table is the single authority for both the API and the database. |
| Visual (15%) | 6.5 | Health strip, board, conflict tray, a PWA with a queue panel, and a chain strip. Dense operational UI, with a visual system left to step 7 of the build order (H.2). |
| Credibility (15%) | 7.5 | Unusually honest scope statements (G.4, "what I would not defend"). Undercut by the SIGKILL parity claim, the SSE reconnect model, and the tamper statement's mismatch with the schema. |
| Narrative (10%) | 7.5 | Clear arc: create, race, deny, offline, kill, fault, tamper. Each beat follows from the last, and the closing beat converts earlier claims into checks. |
| Feasibility (10%) | 4.5 | Go API and worker, React with IndexedDB, Workbox service worker, OIDC with two providers, Traefik, a fault controller with a socket proxy, Terraform with about seven concerns, cosign and SBOM. Thirteen ordered steps (H.2). Offline durability is the subtle part (H.4 item 2). |
| Reliability (5%) | 4.5 | Process kills, a 10-second lease and a 20-second hold are real, and fallbacks are stated. But the SSE reconnect and offline flush depend on browser behaviour, the replacement start time is not measured, and several script numbers are presented as observed values. |

### Strongest ideas

1. The `xid` and snapshot-minimum replay (D.4). It is correct, it can be tested with deliberately reordered commits (claim 1), and it does not depend on NOTIFY durability.
2. Leases use database time and an epoch fence checked before each send (D.6, G.1). The proposal states that the fence narrows the duplicate window and does not close it, which is accurate.
3. Offline replay compares preconditions, not versions, so an unrelated edit does not create a false conflict (D.6, 175 to 205 s).
4. The audit chain stores the exact hashed bytes, not `jsonb`, and says why (D.2 notes). The verifier then re-reads bytes that cannot change.
5. Authorisation is data in one table (`memberships`), and tokens carry only `sub`. Revocation takes effect on the next query (D.5).
6. The fault controller is narrow, has no database credentials, and is tested to refuse arbitrary container operations (G.1).

### Concrete weaknesses (most severe first)

1. **The process-kill parity claim is wrong for ECS.** E says "Process-kill faults have identical semantics: SIGKILL, no graceful drain". ECS `StopTask` sends SIGTERM and sends SIGKILL only after the stop timeout. A worker that handles SIGTERM can finish or release its lease, and the lease-expiry beat at 230 to 250 s then differs between Compose (SIGKILL) and ECS (SIGTERM first). Fix: either implement an AWS SIGKILL path and test it, or change the claim and rerun the lease beat on both sides with the difference stated.
2. **The SSE reconnect model does not match `EventSource`.** D.3 says the stream URL carries a 60-second single-use ticket, and the script says the client "reconnects with `Last-Event-ID`, receiving a fresh single-use ticket first" (205 to 230 s). An `EventSource` reconnects automatically with the same URL, which contains the consumed ticket, so the automatic retry fails. Reconnection must be a manual loop that fetches a new ticket and creates a new `EventSource`, and the proposal does not describe that loop. "Reconnected in 1.8 s" depends on it.
3. **The tamper step does not match the schema.** D.2 defines `audit_events` with `canonical bytea`, `prev_hash` and `hash`. There is no `payload` column. Lines 270 to 300 say "changes the payload of sequence 1209 from `crew_id: 4` to `crew_id: 7`". That is an edit to length-prefixed binary bytes, and it must keep lengths unchanged to produce a clean one-field change. The proposal must define the tamper procedure. The closing claim that "the same verifier in the AWS environment, its result string identical" is not reproducible, because `recorded_at` and the demo's real-time events differ between runs, so the chain bytes differ.
4. **Several script values are presented as observed results before they are measured.** "Reconnected in 1.8 s", "chain of 1,318 events, head `9c1e…07ab`", "lease expired at +10.0 s" and "verified in under 250 ms (target)" appear as fixed panel text. Only the verification latency is labelled as a target. The head value cannot be fixed across runs (weakness 3). Label each value as derived, measured or target.
5. **Claim 5's trial count is a runtime problem.** The test runs 200 trials, and each trial waits for a 10-second lease to expire. Derived from the configured lease alone, that is 2,000 seconds of serial waiting per run before worker startup and SMTP work. A test of this length cannot run as a routine check. Parameterise the lease for tests, or reduce the trial count and keep the kill points.
6. **A long-running transaction stops every live stream.** G.3 notes that the replay watermark is held back by any open transaction. The Ops drawer's database console is a session the presenter opens on stage, and the claim-1 test has a deliberately slow writer. The proposal says this should be shown "in a later iteration". The console therefore needs a rule (for example, a statement timeout and an automatic rollback) or the stage can freeze the streams by accident.
7. **The offline beat depends on browser storage behaviour.** IndexedDB eviction, service-worker reloads mid-flush, and the difference between DevTools offline emulation and a real network stack are each named in G. The flush-order assertion is run in emulation, and the proposal does not say which browsers were checked. This is the step most likely to vary between a rehearsal laptop and a stage laptop.
8. **The fault controller's "hold next delivery" needs a hook in the production worker.** The fault controller can "hold next delivery" (D.1), which must be implemented in the worker binary that is also the production image. The proposal does not say how the hook is gated, and the claim that the same image digest runs in both environments then includes a fault path. State the gate and test that it is absent in a non-demo stack.
9. **The operator plane differs between local and cloud.** Locally the fault controller reaches containers through a socket proxy that allows one operation. On AWS it uses `StopTask` with a tag condition. The proposal tests both limits, which is good. The authorisation difference should appear in the parity table as a difference of the operator plane, not only in the tests.
10. **The stage depends on replacement start time, which is not measured.** The health strip returns to 2/2 "once the replacement is ready" (230 to 250 s). G.1 says Fargate tasks "can take tens of seconds to start", and the proposal does not give a measured figure. The beat should wait on the observed readiness event, and the rehearsal should record the real interval.

### Required changes

- Replace the SIGKILL parity statement, and implement or label the ECS kill path.
- Specify the reconnection loop for the SSE stream, including ticket renewal.
- Define the tamper procedure against `canonical bytea`, and remove the claim that the AWS verifier string is identical unless the run is made deterministic.
- Label each on-screen value as derived, measured or target.
- Parameterise the lease for the claim-5 test, or reduce its trial count.
- Add a statement-timeout and rollback rule to the database console.
- Name the browsers used for the offline rehearsal, and check the flush order in each.
- State how the delivery-hold hook is gated in the production image.
- Make the replacement wait event-driven.

---

## 06 Unconventional Innovation (Sealroom)

### Scores

| Criterion | Score | Justification |
|---|---:|---|
| Depth (25%) | 8.0 | Commit-reveal with a length-prefixed, domain-tagged commitment, verified on both client and server, a `security_barrier` score view, a per-round row lock, a guarded round transition, and an anchored chain with an external head. A real protocol, with the depth located where the claim is made. |
| Cohesion (20%) | 8.5 | The thesis is one: nobody sees a score until everyone seals, and nobody can rewrite the record without the bucket noticing. Every beat tests one part of that thesis (section B interaction summary). |
| Visual (15%) | 7.0 | Four identity windows and a terminal, with a reveal banner, a verifier, and an offline verifier file. Fewer big visual moments than 02, and the terminal beats are a visible cost. |
| Credibility (15%) | 6.5 | The owner-visibility claim contradicts the stated FORCE RLS, Claim 1's test is not a test of hiding, the round-level state machine does not fit a six-proposal round, and the MinIO parity claim is unverified. |
| Narrative (10%) | 8.5 | The strongest narrative of the six. The climax is a rewrite that passes the internal check and fails the external one, shown in four windows at once (section C 275 to 300 s, and "why the last 30 seconds"). |
| Feasibility (10%) | 6.0 | Node and Fastify, a browser verifier with WebCrypto, one migration set, a worker with three jobs, six adapters with contract tests, seven CDK stacks, Compose with eight services. Narrower surface than 01 to 05, with an ordered build (H.4). |
| Reliability (5%) | 6.5 | Reset starts a new anchor series so the bucket does not block the demo (G.1). Pre-sealed identities and a stated freshness precondition for the attack. The rehearsal fails loudly on budget breaches. Weakened by the round-level and exactly-once issues below. |

### Strongest ideas

1. Scores exist only as commitments before reveal, and the reveal is verified in the browser and on the server (D.3, F claim 1). The protocol's binding is tested on both sides, and the stage shows the browser refusing a mismatch before anything is sent (170 to 190 s).
2. The score view is the only read path for other reviewers, and it is a `security_barrier` view that reveals scores only under stated conditions (D.2).
3. Anchoring in an Object Lock bucket keyed by round and sequence, with the anchor job after commit and an explicit `anchor_stale` state rather than a false `ok` (D.6, G.2).
4. An offline verifier bundle that makes zero network requests and shares its encoding with the server through test vectors (C10, G.3).
5. Demo reset starts a new anchor series so retention does not block repeated runs (G.1). This is the right resolution of the compliance-mode problem that 02 leaves open.
6. The honest scope list (G.4): binding and hiding do not stop collusion, a compromised browser can read nonces, and the owner can still delete rows.

### Concrete weaknesses (most severe first)

1. **The round-state machine does not fit a six-proposal round.** A places six proposals in one round (A). Section C treats P-3's four commitments as the whole round: "Committing · 1 of 4 sealed on P-3", the fourth commitment moves "the round" to `revealing` (140 to 170 s), and the last reveal moves "the round" to `closed` (190 to 215 s). Ben has a conflict on P-5 (90 to 115 s), which implies the other proposals exist. Under the stated rules, the round would close with five proposals unsealed and unrevealed. The state must be per proposal, or the round's completion rule must be the conjunction over proposals.
2. **The owner's visibility is stated both ways.** C2 and D.2 say FORCE RLS applies to every panel table, and that the owner "bypasses RLS". The script (115 to 140 s) shows the owner reading `score_commitments` and calling it "the owner's view". With FORCE RLS a table owner that is not a superuser and lacks BYPASSRLS sees zero rows unless a policy admits them. A superuser bypasses RLS regardless. The stage claim, and Claim 1's `pg_dump` as owner, depend on which, so the role must be specified.
3. **Claim 1's test does not test hiding.** Part (c) asserts that for each candidate score 0 to 10 and each nonce other than the real one, the recomputed digest differs. That holds for any collision-resistant hash and says nothing about whether the stored data reveals a score. A meaningful test dumps every table as the owner, asserts that no score column is populated before reveal, asserts the NULL reveal columns, and checks the binding against fixed vectors. Replace (c).
4. **The demo keeps a nonce backup in the terminal.** G.2 says the reveal nonce is "also stored ... in the terminal's `sealroom-reviewer` backup (demo only)". The blind-scoring claim is then false for the demo's own data path. If the backup is reachable from the database owner, the owner can read the score before reveal, which the stage claims is impossible. Keep the backup out of the demo, or show it as a labelled escrow with its own threat note.
5. **The attack's precondition is not defined.** G.2 says the attack proceeds only if "the rehearsal's anchor for the seeded head is fresh". G.4 says the demo's rounds anchor at seal close and reveal close only. The proposal does not state the demo's anchor cadence, nor the sequence at which the anchor is written, so the precondition cannot be checked. Also, the rewrite from sequence 44 must cover the anchored sequence, or the anchor compare has nothing to disagree with. Specify both.
6. **The "exactly one email" claim has the same flaw as in 02 and 05.** Claim 4(c) kills the worker after `ReceiveMessage` and before `DeleteMessage`, and says the redelivered message produces one email and one `consumed_messages` row. If the worker sends and is killed before the consumed row commits, the redelivery sends a second email. The duplicate window is narrow but real, and the claim should say at-least-once.
7. **The MinIO parity claim is unverified.** E says "The rehearsal asserts that a `DeleteObjectVersion` against a locked version fails in both environments with the same error class". Proposal 02 documents that MinIO's root can bypass retention. The same caveat applies here, and the local fallback cannot be assumed to refuse the delete. Because AWS is the headline environment for this proposal (C, setup), the local claim should be labelled as untested until the rehearsal shows it.
8. **Terminal and file steps cost stage time and visual impact.** The beats at 115 to 140 s (catalogue queries), 170 to 190 s (curl), 240 to 255 s (opening a downloaded file from the Downloads folder), and 255 to 275 s (rechain) move the presenter across four surfaces. The proposal pre-pastes the commands, which reduces the typing risk, but the beats carry less visual weight than the browser beats.
9. **The offline verifier's `file://` behaviour is assumed.** The verifier runs from `file://` and depends on WebCrypto. Whether WebCrypto is available in that origin depends on the browser, and the proposal lists Chromium, Firefox and Safari without saying that `file://` was checked. The Downloads-folder step also depends on the operating system's download prompts. Verify both before depending on them.
10. **Anchor keys change across resets, so the on-screen hashes are not fixed.** Each reset writes a new round UUID and a new anchor series (G.1). The script's head values (for example `7a1e…c03`) are therefore set by the run, not the seed. The rehearsal must read them back rather than the script carrying them as literals, which the proposal does not state.

### Required changes

- Make round state per proposal, or define the round's completion as the conjunction over all proposals, and rewrite the setup and beats to match.
- Specify the owner's role (superuser or BYPASSRLS) and make the stage claim and Claim 1 consistent with it.
- Replace Claim 1 part (c) with a test that dumps stored data as the owner and asserts absence of score material.
- Remove the terminal nonce backup from the demo path, or label it as escrow with its own threat note.
- State the demo's anchor cadence and the precondition check, and tie the rewrite point to an anchored sequence.
- Restate Claim 4(c) as at-least-once with the duplicate window named.
- Mark the local retention claim as untested until the rehearsal shows it.
- Verify WebCrypto in `file://` and the download path in each target browser.

---

## Cross-cutting findings

These affect more than one proposal and should be settled in one place by the coordinator.

1. **Exactly-once email is claimed from a non-transactional external send.** Proposals 02 (D.3, G.2), 05 (Claim 5 is correctly stated as at-least-once) and 06 (Claim 4(c)) differ in how they state it. Proposal 01 states at-least-once. The rule should be: an external send is at-least-once, and the visible effect is once per message ID only if the recipient or the sender dedupes on that ID.
2. **ECS `StopTask` is not SIGKILL.** Proposals 01 (E.2, script 215 to 240 s) and 05 (E, Section E fault injection) assume it is. The kill semantics on AWS must be specified, implemented or labelled.
3. **Cognito custom attributes are issued in ID tokens by default.** Proposals 03 (D5, `tenant_id`), 04 (D5, `custom:carrier_id`) and 06 (D.5 and C9) depend on custom claims. The pre-token-generation trigger, or the choice of token, must be in the infrastructure list.
4. **MinIO's retention is not equivalent to S3's for a root user.** Proposals 02 (acknowledged) and 06 (asserted equal) rely on it. Any finale that depends on object-lock immutability must run on AWS, or the local claim must be labelled.
5. **Compliance-mode objects accumulate across resets.** Proposals 02 (D.2 checkpoints) and 06 (new anchor series per reset) address this differently. Proposal 06's approach is the one to keep.
6. **Hashes over timestamps and `jsonb` break cross-language and cross-restart verification.** Proposal 01 (`jsonb`), 03 (`occurred_at` in hash, JavaScript precision), 05 (canonical bytes, correctly avoided) and 06 (text stored verbatim, correctly avoided). Store exact bytes and exclude or truncate timestamps explicitly.
7. **Several on-screen numbers are not derived from the run.** Proposals 01, 02, 03, 04 and 05 each show values (sequence numbers, latencies, heads, positions) as script text. Each should be generated by the rehearsal from the seed and the run.
8. **Global or per-stream sequence numbers are not reset by reset commands unless asked.** Proposals 01 (`auction_events`), 04 (`global_pos` identity) and 05 (identity columns) must restart identities in the reset.

---

## Comparative ranking

Ranked by weighted score, with the stated tie-break.

1. **06 Unconventional Innovation (7.5).** The strongest narrative and the cleanest protocol story. Its reliability is the best of the six because the reset design and the freshness precondition are specified. Its weaknesses are concentrated and fixable: the round state, the owner-visibility statement, and Claim 1's test. Feasibility is the most tractable of the six.
2. **03 Enterprise Platform (7.3).** The strongest composition: one commit produces every consequence, and the same decision function governs the button and the server. Its weaknesses are numerous but local: a verifier explanation, an anchor line, a label rule, and a CEL contradiction. The dual evaluator in the browser is the largest technical risk to keep under control.
3. **04 Emergent Composition (7.25, reliability 5.5).** A well-composed set of primitives. Its main problems are claims that are not designed (in-order delivery, determinism under the wall-clock guard) and a script with a missing acceptance step. The tie with 05 is broken on reliability.
4. **05 Operational Resilience (7.25, reliability 4.5).** The deepest replay design and the best-stated fencing. Its reliability is weaker because the kill semantics, the SSE reconnection and the offline flush each depend on platform behaviour that is misdescribed or unmeasured, and because the claim-5 trial count is impractical as written.
5. **01 Systems Complexity (7.1).** Technically very deep, with the most realistic concurrency tests of the six. The sequence numbers, the `jsonb` hash, the transaction-held SQS call and the ECS kill path each need correction, and the surface is the widest of the six for a small team.
6. **02 Visual Spectacle (6.9, disqualified).** The best stage visuals, and its composition is sound. Its finale is not faithful on the primary local run, its script contains an invalid ladder bid and a rejected event numbering, and its external-send claim is unsupported. Eligible again if the finale is AWS-only and labelled.

## Ideas worth keeping regardless of who wins

- **From 01:** the single transaction that serialises bids on the auction row and writes the event, outbox row, NOTIFY and audit row together. The database-clock anti-sniping close with `SKIP LOCKED`. The "prove it" scene that rebuilds the projection from the log and compares hashes. The non-destructive scratch-copy tamper.
- **From 02:** `auction_seq` assigned under the auction lock, so commit order equals sequence order. A single projection function per audience shared by queries and realtime frames. Cedar denials that return the policy identifier. The threat model stated on screen before the tamper.
- **From 03:** one commit produces the business change, ledger event, outbox row and idempotency record. A single `Decide()` shared by the control, the server and the decision trace. An operations log held outside the chain for dual-controlled drills. Showing the projection disagreeing with the ledger after a privileged edit.
- **From 04:** a deferrable exclusion constraint for double-booking. Per-stream hash chains so writes to different streams do not serialise. Rebase as a re-solve on a smaller input that reports dropped items. An ordinary ingest path for external data that goes through the same command path as user input. Two rehearsal variants that branch and must both end correctly.
- **From 05:** the `xid` and snapshot-minimum replay watermark, with a reordered-commit test. Lease claims on database time with an epoch fence checked before each send. Offline replay that compares preconditions rather than versions. Canonical bytes stored instead of `jsonb`. Authorisation held in a membership table that tokens do not carry.
- **From 06:** commitments that are checked in the browser before sending and on the server after receipt. A `security_barrier` view as the only read path for sensitive values. An offline verifier that makes no network requests. A demo reset that starts a new anchor series so compliance-mode retention does not block repeated runs. The climax in which a rewrite passes the internal check and fails the external anchor.
