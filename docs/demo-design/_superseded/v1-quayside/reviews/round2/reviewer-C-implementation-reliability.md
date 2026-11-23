# Round 2 review, Reviewer C: implementation and reliability

Scope: the six revised proposals (`revised/01` to `06`), read in full against the mission brief (`00-mission.md`) and against this reviewer's round-1 review (`reviews/round1/reviewer-C-implementation-reliability.md`). The original versions were consulted only where a revision log cited them. Design review only; nothing was built or run.

Method: each revision-log entry was checked against the section it cites. "Fixed" is accepted only where the cited text now says the fixed thing. Scores run 0 to 10. Weights follow the mission: depth 25%, cohesion 20%, visual 15%, credibility 15%, narrative 10%, feasibility 10%, reliability 5%. Script times are the proposal's own second marks. Numbers quoted from a proposal are the proposal's own values and were not verified.

---

## Summary

| Proposal | Depth | Cohesion | Visual | Credibility | Narrative | Feasibility | Reliability | Weighted, round 2 | Weighted, round 1 | Disqualified |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| 01 Systems Complexity (Tallyhouse) | 8.5 | 8.5 | 6.5 | 7.5 | 6.5 | 3.5 | 4.5 | 7.15 | 7.1 | no |
| 02 Visual Spectacle (Tideline Live) | 7.5 | 8.0 | 8.5 | 6.5 | 7.5 | 3.0 | 3.0 | 6.93 | 6.9 | no (round 1: yes) |
| 03 Enterprise Platform (Ledgerwell) | 8.0 | 8.5 | 7.0 | 6.5 | 8.0 | 5.0 | 4.5 | 7.25 | 7.3 | no |
| 04 Emergent Composition (Quayside) | 8.0 | 8.5 | 7.0 | 6.0 | 7.5 | 5.5 | 5.5 | 7.23 | 7.25 | no |
| 05 Operational Resilience (Culvert) | 8.5 | 8.0 | 6.5 | 7.0 | 7.0 | 4.5 | 4.5 | 7.13 | 7.25 | no |
| 06 Unconventional Innovation (Sealroom) | 7.5 | 8.0 | 7.0 | 6.0 | 8.0 | 5.5 | 5.5 | 7.05 | 7.5 | no |

**Disqualification.** No proposal is disqualified in round 2. Proposal 02 was disqualified in round 1 on a condition the revision now meets: the finale runs only on AWS and is labelled, and the local run states "chain-only" (02, run policy; C 256 to 300; G.2). Its scores below reflect what that change costs in reliability, since the primary run now sits on the environment with the most unmeasured parts.

**Ranking by weighted score:** 03, 04, 01, 05, 06, 02. The closing section gives the reasons.

---

## 01 Systems Complexity (Tallyhouse)

### Round-1 items

- **Fixed, checked in text:** one sequence counter with reset head 9 and every later number a formula (C 107 to 109, D.2 `last_seq`); maxima readable only through grants, with a canary test on every read path (D.2, F claim 4); denial audit committed before the error response (D.4); audit bytes stored as `bytea` with a golden re-read test (D.2, F claim 5); relay sends outside any transaction (D.3, D.4); restart wait made event-driven (C 225 to 255); fifteen-second visibility and redelivery language moved to an outcome assertion (G.2).
- **Partly fixed:** the countdown. `ends_at` is now anchored to reset (C 107), but the countdown values printed in the script do not follow from that anchor (weakness 1).
- **New problems:** the self-SIGKILL is now the only fault mechanism and its effect in the container shape is unverified (weakness 2). The script table grew to sixteen rows against a stated fourteen scenes (weakness 4).

### Scores

| Criterion | Score | Justification |
|---|---:|---|
| Depth (25%) | 8.5 | Bid, proxy resolution, event, outbox, NOTIFY and audit under one auction lock (D.4); database-clock close with `SKIP LOCKED`; proxy secrecy by grant with canary tests. The deepest concurrency content in the set. |
| Cohesion (20%) | 8.5 | Every later beat reads an output of the bid transaction (B, interaction summary). |
| Visual (15%) | 6.5 | Four legible windows and a step plot; most beats are counters and text, and 225 to 255 s is an empty wait. |
| Credibility (15%) | 7.5 | The named round-1 defects are fixed; the countdown arithmetic and the unverified self-kill remain. |
| Narrative (10%) | 6.5 | The arc is clear, but the timeline is structurally inconsistent (sixteen rows, two rows overlapping in time, "fourteen" scenes). |
| Feasibility (10%) | 3.5 | Go, React, Terraform, Playwright, ElasticMQ, MinIO, four database roles plus owner functions, saga, ledger, audit chain, verifier, scratch rebuild and a fault hook; ten dependency layers (H.2). |
| Reliability (5%) | 4.5 | Counts are formulas now, but the kill depends on a self-sent SIGKILL not shown to deliver in this container shape, and on a restart the script does not time. |

Weighted: 7.15 (round 1: 7.1).

### Strongest ideas

1. The bid is one transaction under the auction row lock that writes the event, the hash, the outbox row, the NOTIFY and the audit row together (D.4). Proxy resolution runs under the same lock.
2. Anti-sniping and close on database time, with the scheduler claiming through `FOR UPDATE SKIP LOCKED` (D.4, G.1 item 6).
3. Proxy maxima protected by grants, not by a session setting, with a canary test that scans every read path including SQS bodies and audit bodies (F claim 4).
4. The "prove it" scene recomputes the projection from the event log and compares hashes (C 255 to 275).
5. The tamper runs on a scratch copy and the closing line states what is not detected (C 275 to 300, G.4).

### Concrete weaknesses, most severe first

1. **The countdown values do not follow from the seed.** C 107 sets `ends_at` to reset plus 150 s. C 0 to 15 prints `02:15` in all windows, and C 135 to 150 says the countdown "reads 00:10 at about 140 s". Those figures agree only for one fixed gap between reset and script second 0. The reset runs "before the run", so the gap is not fixed. Any other gap moves Mara's five-second gate (00:10 to 00:05, C 135 to 150), or closes the auction before her bid. Fix: anchor `ends_at` to the Open action, as proposal 02 does, and print countdowns as derived values.

2. **The fault is a self-sent SIGKILL whose delivery is not shown for this container shape.** D.5 ("Fault hook") and E.2 say the worker sends SIGKILL to its own process, "in both environments". The text does not say whether that process is PID 1 in its container, and E.1 makes the binary the entrypoint of a distroless image. Within a PID namespace, signals to its init process are dropped unless init has installed a handler; the SIGKILL exception applies to senders in an ancestor namespace. A self-sent SIGKILL from PID 1 may therefore be dropped. Test the production container shape in both environments before F claim 3 and E.2 rely on it.

3. **Dead air in the kill scene.** C 225 to 255: "Ines waits. No timer is shown." The restart interval is unmeasured (G.2), and the brief asks for no waiting. The round-1 request was an event-driven wait, which the revision made; the presenter still has about thirty seconds with nothing to show. Fix: give that window a checkable action that completes while the replacement starts, such as the replay counters for the 25-bid range or Ines's invariant check.

4. **The script does not match its own scene count.** C 132 says "Scene count: fourteen". The table has sixteen rows, and the rows at 135 to 150 and 140 to 150 overlap. A rehearsal that asserts scenes in order will not match the table. Fix: regenerate the table from one timeline and recount.

5. **The price-series hash has no defined encoding.** C 115 to 135 and F claim 2 compare a SHA-256 of Joon's price series computed in the browser with the server's value. The byte encoding of the series is not specified. This is the class of defect the revision fixed for audit rows: two sides hashing bytes the other does not reproduce. Fix: define the series' canonical form once and test it in both languages.

6. **The feasibility surface did not shrink in kind.** The revision removed email (C 240 to 255), but the design keeps four database roles plus the engine role and SECURITY DEFINER owners (D.2), `FORCE` RLS on bids and ledger (D.2), a global audit advisory lock taken on every bid (D.4, H.4 item 2), SQS FIFO on ElasticMQ, MinIO for photos (E.2), seven Terraform modules (D.6), and a four-context browser rehearsal (H.1). Fix: name the subset the 300-second run needs and mark the rest as test-only.

7. **Burst concurrency depends on a pool size the proposal does not state.** C 60 to 100 issues 60 concurrent requests per bidder, 180 in total. D.1 names no pool size, and the counts and hold time depend on how many requests reach PostgreSQL at once. Fix: state the pool size and report the measured lock hold time from rehearsal, labelled as measured.

### Required changes

- Anchor `ends_at` to the Open action; print countdowns as derived values, and state the five-second gate as a live-presenter risk with its fallback.
- Test a self-sent SIGKILL on the production container shape in both environments, or use a kill from outside the process for the stage and keep the self-kill as a test.
- Give the 225 to 255 s window a checkable action, or shorten the beat to the event that happens.
- Regenerate the script table from one timeline and correct the scene count.
- Define the canonical encoding of the price series and test it in both languages.
- Name the minimum component set for the stage run and mark the rest as test-only.
- State pool size and report measured hold time, labelled.

---

## 02 Visual Spectacle (Tideline Live)

### Round-1 items

- **Fixed, checked in text:** the finale is AWS-only and labelled, with the local run stating "chain-only" (run policy; C 256 to 300; G.2; E.2). The ladder is a minimum-next-bid rule, and 6,100 is legal (A, ladder). Event numbers are rebuilt and the tamper target is resolved by query, at seq 429 (C, event ledger). The SES claim is restated as at-least-once with a window (D.3, G.2). Frame-time gates are replaced with state assertions (E.3). The trace panel is in-app (C 40 to 60).
- **Partly fixed:** the countdown is now derived from `close_at` with one `snipe_window_s` (C 117). E.3 requires a "stated tolerance" for the ring but states none.
- **New or unaddressed:** the primary run moved to the least controllable environment; a Mailpit step survives on the AWS run; the realtime kill uses different signals per platform.
- **Disqualification:** round 1 disqualified the proposal for a finale that the primary run could not reproduce. The round-1 condition for eligibility was an AWS-only, labelled finale, and that is now the text. The local run is a reduced demonstration, which the mission allows as a documented difference. It is not disqualified again.

### Scores

| Criterion | Score | Justification |
|---|---:|---|
| Depth (25%) | 7.5 | Serialised bid transaction, `auction_seq` under the lock, Cedar with attribute loading in the transaction, idempotency with stored response, and a clock worker with two tested interleavings (claim 4). Several items are self-described as shallow (G.4). |
| Cohesion (20%) | 8.0 | One click crosses browser, authorisation, lock, event, hash, proxy, fan-out and trace; the per-audience projection is shared by query and realtime paths. |
| Visual (15%) | 8.5 | Floor, phone and desktop windows, a rejection toast citing the rule, a countdown ring and a gavel: the strongest visual argument in the set. |
| Credibility (15%) | 6.5 | Several round-1 false claims are corrected, but the trace beat, the Mailpit step and the finale's environment dependence are unsupported on the stated run. |
| Narrative (10%) | 7.5 | The arc still works; the robustness paragraph contradicts G.2 on late bids, and the AWS run shows a tool the AWS run does not have. |
| Feasibility (10%) | 3.0 | Rust (axum, sqlx, Cedar, OpenTelemetry), React, Keycloak and Cognito with a contract suite, ElasticMQ, Mailpit, MinIO, Jaeger and X-Ray, five CDK ECS services, Aurora; eleven ordered layers (H.1). |
| Reliability (5%) | 3.0 | The primary run is the AWS run over a second link; trace ingestion, SES delivery and a Fargate replacement are all unmeasured on the critical beats. |

Weighted: 6.93 (round 1: 6.9).

### Strongest ideas

1. `auction_seq` is assigned under the auction row lock, so commit order is sequence order (D.4). The simplest correct answer to the gap problem in the set.
2. One projection function per audience, used by query and realtime paths, and tested per audience (D.5).
3. Cedar denials return the policy identifier, which the rejection toast names (C 60 to 80).
4. The fault layer drops a response after commit on a real request, so stored-response replay is shown, and the same layer serves claim 2 (D.1, F claim 2).
5. The verifier refuses to give an anchor verdict unless the object is in compliance retention (G.4), so the stage cannot show a false anchor result.

### Concrete weaknesses, most severe first

1. **The primary run now sits on the environment with the most unmeasured parts.** The run policy makes the stage run the AWS run "over a prepared second network link". G.1 says trace ingestion time is "recorded in rehearsal". G.2 lists SES sandbox refusals. C 172 to 186 restarts an ECS task inside a fourteen-second window. A failure before the start moves the presenter to a local run from reset, and mid-script switching is not attempted. No beat in the finale has a measured figure behind it. Fix: choose the stage run by measured rehearsal results, and gate the finale segment on them.

2. **The AWS run has a step that uses a tool it does not have.** C 214 to 240 transitions to a "Mailpit tab", and C 240 to 256 shows "the buyer email and the consignor email, one each" in Mailpit. D.6 and E.2 send through SES. Mailpit does not exist on the AWS run, and real SES delivery to real inboxes is a live third-party dependency inside the core flow, which the brief excludes. Fix: on the AWS run, show the notifier's own `notifications` record, labelled as such; keep a real inbox only as a labelled rehearsal artifact.

3. **The trace beat's visible result depends on backend ingestion the proposal has not measured.** C 40 to 60 promises "waterfall across three processes" within twenty seconds. G.1 says spans reach X-Ray after an export delay and a query path with its own latency, and the panel "shows pending until the trace is queryable". The likely visible result at 60 s is the pending state, which the script does not list. Fix: state "pending, then filled" as the expected result and report the measured ingestion figure, labelled.

4. **The realtime kill is a different fault on each platform.** C 172 to 186: "docker kill locally; stop the ECS task on the AWS run." `docker kill` sends SIGKILL. `StopTask` sends SIGTERM and then SIGKILL after a stop timeout the proposal does not set. Proposals 01 and 05 removed this divergence; the E.2 parity table here does not list it. The fourteen-second window must also contain a stop, a Fargate replacement and a reconnect with replay, and the restart is scripted as "at about 184", not awaited. Fix: use one signal path on both platforms and make the restart wait event-driven.

5. **A late final bid is described in two incompatible ways.** The robustness paragraph (C, last part) says "a late final bid (the close is simply later)". G.2 says "The ring closes before Ben bids … The close is correct." A bid at or after `close_at` is refused (claim 4 names `LOT_NOT_OPEN`), so a late bid cannot postpone the close. The beats at 192 and 196 must land inside a window that the presenter times by script second. Fix: use the server's amber state, which is already derived at 190, as Ben's cue, and state the refusal as the visible result of a missed window.

6. **The fault layer ships in the production binary and is gated by configuration.** E.1 says the layer is "inert unless demo configuration is set" and that a startup check refuses it "unless the environment name is `demo`". The environment name is itself configuration, so the same settings that enable the fault satisfy the check. Proposal 05 compiles its hooks out of the release image; this proposal does not. Fix: a build tag or a separate binary, and a CI assertion that the release image has no route to the layer.

7. **Two values in verification and rehearsal are unspecified.** E.3 requires the ring's remaining time to match the server "within a stated tolerance" and states none. D.2 stores `payload jsonb` and hashes a "canonical payload", but the text does not say whether the verifier re-canonicalises the stored value or hashes stored text. Fix: state the tolerance and the verifier's input.

8. **Checkpoints accumulate under compliance retention, and their keys are not specified.** E.4 sets a default retention of seven days (`CHECKPOINT_RETENTION_DAYS`), says repeated runs "accumulate checkpoints until they expire", and says the stack retains the bucket, so teardown cannot clear locked versions. D.2 has an `s3_key` column with no rule. Reset writes checkpoint #1 "through 412" every time, so keys that omit a run identifier can collide across runs. Fix: include a run or reset identifier in the key, as proposal 06 does with a new anchor series per reset.

9. **Two identity providers remain in the core demo.** E.2 and H.3 keep Keycloak and Cognito, with a contract suite narrowed to claim mapping and a fixed set of decisions. Round 1 accepted this. It still means the claim that "four live sessions are four real logins" (B, row 15) is established on two stacks, and the proposal's own H.4 says it does not establish equivalence of token lifecycles.

### Required changes

- Choose the stage run by measured rehearsal results; gate the finale on them.
- Replace the Mailpit step on the AWS run with a labelled `notifications` view, or label the stand-in.
- Restate the trace result as "pending, then filled", and report measured ingestion.
- Use one signal path for the realtime kill on both platforms; make the restart wait event-driven.
- Make the late-bid behaviour one statement, and cue Ben from the server's amber state.
- Move the fault layer behind a build tag or a separate binary.
- State the ring tolerance and the verifier's input encoding.
- Put a run identifier in checkpoint keys and state the retention and cleanup plan.

---

## 03 Enterprise Platform (Ledgerwell)

### Round-1 items

- **Fixed, checked in text:** the verifier semantics. A payload-only edit fails check (a) at seq 1,612 and passes (b) and (c) at the next sequence, because the stored hashes are unchanged (D, Verification). The anchor line is off the stage (C 275 to 300). Race labels follow the allocation counter, which is the lock order (D, Budget reservation). The seq reconciliation is by formula (C). The browser evaluator and the guard language are stated as a restricted subset (A, B). The Cognito pre-token trigger is in the identity stack (E, Identity). The web artifact is checked by manifest digest (E, Artifacts).
- **Partly fixed:** `occurred_at`. The revision says truncation is "not needed because nothing finer is stored" (revision log, C6). That is not sufficient (weakness 3).
- **New problems:** the drill's database mechanism (weakness 1); the staging step-up is a fixed seed (weakness 2); the verifier trace claim (weakness 4); the reader endpoint is unlisted (weakness 5).

### Scores

| Criterion | Score | Justification |
|---|---:|---|
| Depth (25%) | 8.0 | Tenant RLS with `FORCE`, a budget lock with a database `CHECK` backstop, versioned workflows with trigger-enforced immutability, `If-Match` concurrency, and RFC 8785 hashing with shared vectors. The drill mechanics are wrong (weakness 1). |
| Cohesion (20%) | 8.5 | One commit writes the reservation, the request, the ledger event, the outbox row and the idempotency record (B, "how the capabilities compose"). The stage's removals keep the composition intact. |
| Visual (15%) | 7.0 | Four windows, a budget card that refuses to overflow, and a red banner on every Halvard session; the list and ticker are gone. |
| Credibility (15%) | 6.5 | Round-1 verifier and race defects are fixed, but the drill's privilege model, the "real" step-up, and the trace claim do not survive expert reading. |
| Narrative (10%) | 8.0 | The arc (invariant, race, drill, verifier) is well paced, and the timing notes separate targets from results. |
| Feasibility (10%) | 5.0 | One Go binary with four subcommands, one SPA, one database, two queues and buckets, one identity provider, CDK stacks (D, Components; H). Smaller after the removals; the largest correctness surface, `Decide()`, is now single-language. |
| Reliability (5%) | 4.5 | The race is judged on invariants and the arrival column is shown separately; the stage step-up needs a TOTP code entered live, and the drill's failure paths are honest. |

Weighted: 7.25 (round 1: 7.3).

### Strongest ideas

1. One commit produces the business change, the ledger event, the outbox row and the idempotency record (D, consistency table).
2. `Decide()` drives the control, the server, `permitted_actions` and the stored trace, so the UI cannot promise what the server refuses (B D2; D, Authorization).
3. The verifier is a read transaction that names its head, and a separate short write records the result (D, Verification).
4. A dual-controlled act is recorded in the chain before it happens, and the break it causes is reported with its origin (C 215 to 245; D, Drill).
5. Request numbers come from the allocation counter, so labels follow commit order (D, Budget reservation).

### Concrete weaknesses, most severe first

1. **The drill's database mechanism cannot work as described.** D (Persistence) gives the forensics role "permission to disable the immutability trigger", and the drill says the trigger is disabled "for that statement". PostgreSQL does not allow ALTER TABLE rights to be granted: only the table owner or a superuser can disable a trigger. Disabling is a table-level change that lasts until the transaction ends, not the statement, and it blocks concurrent appends to `ledger_events` until commit. The runner's tenant-scoped `UPDATE` is also subject to `FORCE` RLS unless it sets `app.tenant_id` or has `BYPASSRLS`, and the proposal states neither. Fix: name the role the runner uses, its privileges, the RLS setting, and the lock it holds.

2. **The staging step-up is described as real, but its secret is fixed.** E (Identity) and the service mapping say "staging uses fixed demo TOTP seeds stored in Secrets Manager", and that staging "is the environment where the dual-control step-up is real". Any principal that can read the secret can produce the codes, so the step-up is procedural on staging as well. The stage text (C 215 to 245) does not say who types a six-digit code, or how that is done inside a thirty-second TOTP window. Fix: call the step-up a labelled confirmation, or use a per-run seed that the presenter's path cannot read, and script the code entry or remove it.

3. **The `occurred_at` rule is incomplete.** The writer supplies a timestamp that PostgreSQL rounds to the column's three fractional digits on storage. A writer that passes microseconds and hashes what it passed will not reproduce the stored value. Fix: the writer rounds to milliseconds before hashing, or hashes the value read back, and a test vector covers the boundary.

4. **The verifier trace claim is wrong.** C 275 to 300 says the trace "shows the single SQL statement that found the mismatch." D (Verification) and F3 put the hash checks in Go over fetched rows, so no SQL statement finds the mismatch. The trace will show a read and a computation in the service. The audience is asked to trust this screen, and an expert will check it. Fix: describe what the trace shows.

5. **The replica-lag indicator is backed by no listed component.** C 160 to 185 uses a "reader endpoint" with a "replica-lag indicator". The stack lists in E (`network`, `data`, `messaging-storage`, `identity`, `services-edge`) and the local Compose services do not name a read replica, and the proposal does not say whether one exists locally. Without a replica the indicator reads zero. Fix: name the reader in both stacks or remove the indicator.

6. **The access-token claim depends on a Cognito feature the proposal does not name.** E (Identity) and D (Authentication) rely on a pre-token-generation trigger to write `tenant_id` and `principal_id` into the access token, which the API validates. Whether a trigger can add custom claims to access tokens depends on the user pool's feature plan and trigger version, which the proposal does not state. A missing claim fails closed for every request. Fix: name the trigger version and feature plan, and make the claim a staging conformance row.

7. **The ledger's wall-clock and stream dependencies are not in the rehearsal.** The stream sends `through` markers at least every 100 invisible events and a one-second poll fallback (D, Communication). The F4 test covers random disconnects but not a slow `NOTIFY` path, and the rehearsal's "cursors match before each section" check (G.2) does not test the fallback. Fix: add a rehearsal case that disables `NOTIFY` and asserts convergence through the poll.

### Required changes

- Restate the drill as the table owner or superuser operation it is, with its lock and RLS setting; test it on staging.
- State the step-up as a labelled confirmation or use a per-run seed; script the code entry or drop it.
- Make the `occurred_at` rounding rule explicit, with a vector.
- Correct the verifier trace claim.
- Name the reader endpoint in both stacks or remove the replica-lag indicator.
- Name the Cognito trigger version and feature plan; add a conformance row.
- Add a `NOTIFY`-disabled convergence case to the rehearsal.

---

## 04 Emergent Composition (Quayside)

### Round-1 items

- **Fixed, checked in text, and the strongest correction in round 2:** in-order delivery. Positions are allocated only while a plan-commit advisory lock is held from the first allocation to commit, so allocation order is commit order and a visible position implies every lower position is decided (D.3). The reader rule and the 409 path follow the same lock. F4 tests the bound.
- **Fixed:** the solver's wall-clock guard is gone; reset restarts identity sequences; a forecast accept is explicit at 210 to 225 s with a named cut rule; replica pinning is routed by parameter; forecast upload is described (D.4); lifetimes are in one table (E); `custom:carrier_id` is read from the ID token (D.5); the 412 ms figure is gone from the stage.
- **Partly fixed:** the carrier isolation claim and the token design (weaknesses 3 and 7).
- **New problems:** the tamper depends on a superuser that RDS does not provide (weakness 1); anchors collide across resets (weakness 2).

### Scores

| Criterion | Score | Justification |
|---|---:|---|
| Depth (25%) | 8.0 | An honest total order by a single lock, deferrable exclusion for double-booking with half-open spans, per-stream canonical hash chains, snapshots verified by hash link, and a deterministic bounded solver. |
| Cohesion (20%) | 8.5 | The script's thesis, that one gesture touches the primitives, is delivered: drag, constraint, proposal, 409, rebase, fan-out, forecast, replay, trace (B). |
| Visual (15%) | 7.0 | A Gantt with a ghost overlay, three role views, a proposal card with reasons and an audit diff; the proposal calls the Gantt its least technical part. |
| Credibility (15%) | 6.0 | Several claims are now sound, but the tamper superuser, the carrier roles, the token choice and the "fixture" position numbers do not survive expert reading. |
| Narrative (10%) | 7.5 | The forecast beat now ends in an accept, and the trace closes on decision identifiers; the story reads cleanly. |
| Feasibility (10%) | 5.5 | Rust API and worker, a pure core crate, React, CDK, Cognito, SQS, S3 with Object Lock, Postgres with `btree_gist`; eleven ordered layers (H.2). Fewer parts than 01, 02, 03 and 05; the solver and replay are substantial. |
| Reliability (5%) | 5.5 | The cut rule and deterministic pinning help; the position figures and the forecast path still need live measurement. |

Weighted: 7.23 (round 1: 7.25).

### Strongest ideas

1. The plan-commit lock gives one total order over positions, which removes the overlap window and its tuning problem (D.3). It is the cleanest answer to the in-order question in the set.
2. A deferrable exclusion constraint makes double-booking a database fact, and holds are rows under the same constraint (D.2, C 143).
3. Rebase re-solves a smaller input and reports dropped moves with reasons (C 120 to 150).
4. The forecast file enters through the ordinary command path, so the worker's proposal is distinguishable only by its source (C 180 to 210).
5. The reset is a replay of a seed file through the normal command path, so seeded and live state come from the same code (B, row 16).

### Concrete weaknesses, most severe first

1. **The tamper needs a superuser session that RDS does not provide.** E (What differs): the tamper "needs only a superuser session, which the demo account has on both", and C 250 to 265 runs one statement "as a superuser". RDS does not give its master user the PostgreSQL superuser attribute. The stage step and the claim that it "works identically on RDS" are false as written. Fix: perform the edit as the table owner, which exists on RDS, and state the owner's privileges on `events`, including any `FORCE` RLS.

2. **Anchors cannot be unique across resets.** D.5 (6) writes `anchors/<global_pos>.json` to an Object Lock compliance bucket. C 107 and C 3 say reset restarts identity sequences, so positions repeat across resets. Each later run then writes locked objects under keys that an earlier run used, and compliance mode keeps the old versions. The verifier selects "the anchor at or below the latest position", and nothing says whether it reads the latest version of a key or the version the database recorded. Retention and cleanup are not described. Fix: put a run or tenant-epoch identifier in the key, and record version identifiers as proposal 06 does.

3. **The API accepts ID tokens as its bearer credential.** D.5 (2): "The API accepts ID tokens only: `token_use` must be `id`." Resource servers usually validate access tokens, and an expert reviewer will read an ID-token bearer as a token-confusion surface. The stated reason, that Cognito puts custom attributes in ID tokens by default, is solved by the pre-token trigger that proposals 03 and 06 use. Fix: accept access tokens and map claims with the trigger, or justify the ID-token choice with its audience binding and state what a stolen ID token permits.

4. **Demo sign-in is not specified.** D.8 says "Cognito user pool (hosted login disabled; API-based token issuance for demo accounts)." The flow is not named. The options that issue tokens without the hosted UI are password-based or administrative flows with different security properties. The "signed in before the talk" claim and the pitch depend on it. Fix: name the flow and its scope, and keep it out of the claims unless it is tested.

5. **Two stage numbers are described as fixtures and cannot be.** C 150 to 180 says "P, K, V are fixture values printed by reset." K and V count positions created by the presenter's live edits during the disconnection and by the rebase at 120 to 150. Reset runs before the talk and cannot print them. Fix: measure them from the run, labelled as measured, and remove "fixture".

6. **The tamper target is not reconciled.** C 120 to 150 and C 250 to 265 name berth 5, sequence 17 (MV Corwen, `MoveApplied`). No fixture lists berth 5's events before that point, and the writer appends `MoveRejected` events in step 4 (D.3) without saying which stream they join. Whether the rebase commit is sequence 17 cannot be checked from the text. Fix: publish the berth 5 fixture and assert the target by query, as proposal 02 does.

7. **The carrier isolation claim exceeds its roles.** D.5 and D.6 say carrier and auditor reads go "through the carrier and auditor database roles", and F3 tests them. D.5's role list names the API, worker, verifier and migration roles only. The carrier view reads `current_setting('quayside.carrier_id')`, a setting that the API chooses. As in proposal 05, that protects against omission, not against a handler that sets another carrier's identifier. Fix: name the roles, or limit F3 to omission and state what enforces the setting.

8. **The demo and production API topologies differ, and the client branches on environment.** D.8 gives the demo two single-task services with pinned target groups, and production one service with two tasks and no pinned rules. D.4 says the client "omits the parameter when the environment is not demo", which is a branch on environment in code, against E's principle that artifacts are identical. Fix: make pinning configuration with a conformance row, and state what the production trace looks like.

9. **The timestamp appears twice and its check is not stated.** D.2 stores `occurred_at timestamptz` and also includes `occurred_at` in the canonical bytes. The canonical bytes are authoritative, but the text does not require the column to equal the canonical value, nor state how the verifier checks it, nor the precision. Fix: state the precision and check the column against the canonical bytes.

### Required changes

- Perform the tamper as the table owner; remove the superuser claim and the "identical on RDS" claim unless tested.
- Put a run or epoch identifier in anchor keys; record version identifiers; state retention and cleanup.
- Decide the token type for the API; if ID tokens stay, state the audience binding and the residual risk.
- Name the demo sign-in flow and its scope.
- Measure K and V from the run; remove the "fixture" wording.
- Publish the berth 5 fixture and assert the tamper target by query.
- Name the carrier and auditor database roles, or limit the isolation claim to omission.
- Make API pinning configuration with a conformance row; remove the environment branch from the client.
- State the timestamp precision and the column-to-canonical check.

---

## 05 Operational Resilience (Culvert)

### Round-1 items

- **Fixed, checked in text:** process-kill parity. Both platforms send SIGTERM, then SIGKILL after two seconds, and the worker has no SIGTERM handler, so its lease is not released (D.1, D.7, E). Stream reconnection is a `fetch` loop with `Last-Event-ID` and no tickets (D.3). The tamper is defined on canonical layout v1 with a fixed-width field, and the procedure does not recompute hashes (D.2, F claim 4). Trial counts are parameterised (F claim 5). Console timeouts are set (D.5, F claim 1). Browsers are named (G.2). Hook code is compiled out of the release build (D.1, E). The operator plane is in the parity table (E). The replacement wait is removed (C 145 to 160; G.1).
- **New problems:** the delivery-hold semantics break the kill beat (weakness 1); the anchor cannot show the stage edit (weakness 2); the chain's coverage is narrower than the pitch (weakness 3).

### Scores

| Criterion | Score | Justification |
|---|---:|---|
| Depth (25%) | 8.5 | `xid` plus snapshot-minimum replay watermark with a reordered-commit oracle; leases on database time with an epoch fence; canonical bytes; authorisation as a membership table that tokens do not carry. The deepest replay design in the set. |
| Cohesion (20%) | 8.0 | Each action builds on the previous state, chain and stream (B, interaction graph); the membership table is the single authority. |
| Visual (15%) | 6.5 | Health strip, board, conflict tray, PWA queue and chain strip; the visual system is now named (H.4). |
| Credibility (15%) | 7.0 | The round-1 parity and protocol errors are corrected; the anchor, the coverage statement and the downstream wording overstate in places. |
| Narrative (10%) | 7.0 | The arc is clear and every claim is converted into a check at the end; the stage's own closing anchor line does not show what it says. |
| Feasibility (10%) | 4.5 | Go API and worker, React with IndexedDB and Workbox, OIDC with two providers, Traefik, a fault controller, Terraform across about seven concerns, cosign and SBOM; thirteen ordered steps (H.2). |
| Reliability (5%) | 4.5 | Most waits are event-driven and most limits are stated; the kill beat can fail on the hold semantics, and the offline beat is tested by emulation only. |

Weighted: 7.13 (round 1: 7.25).

### Strongest ideas

1. The replay watermark (`pg_snapshot_xmin`) gives a delivery rule that does not depend on `NOTIFY` durability and is testable with a reordered-commit oracle (D.4, F claim 1).
2. Leases on database time, with an epoch checked before each send and a stated residual duplicate window (D.6, F claim 5).
3. Offline replay compares preconditions, not versions, so unrelated edits do not create conflicts (D.6, C 160 to 175).
4. The fault controller is narrow and tested for refusals (D.1, G.1).
5. The limits are on the page, including the owner's ability to rewrite rows (D.5 (6), G.4).

### Concrete weaknesses, most severe first

1. **The kill beat can fail as written, because the delivery hold is armed on both workers.** C 145 to 160 arms "Hold next delivery, until killed or 120 s" on both workers, and says the next claim by either worker "acquires the lease and then waits." C 175 to 190 kills the holder and says the other worker "claims the row at epoch 2 and sends once." The text does not say the surviving worker's hold is released when the first holder dies. Read literally, the reclaimed row is held again, the lease keeps renewing, and no message is sent, so the Mailpit assertion for this beat fails. Fix: state that the kill consumes the hold, or that the controller releases all holds on a kill, and show the hold state after the kill on the Ops panel.

2. **The anchor cannot show the stage edit.** D.7 writes an anchor every 100 audit rows. The edited row is 1,209 and the last anchor before it is at 1,200. The closing check, "anchored head at seq A matches" (C 268 to 300), passes because the anchor precedes the edit. The chain shows the change; the anchor says nothing about it. D.5 (6) nonetheless says "the chain, the anchors and the log stream show it." Fix: state that this edit is detected by the chain alone, or anchor at the edited row for the stage.

3. **The chain covers audit rows only.** D.2 hashes `audit_events`. `work_orders`, `events` and `order_participants` are not chained. The demo edits an audit row, the one thing the chain covers, so detection is by construction. An owner edit to `work_orders.crew_id` that leaves the audit row alone would be detected by no verifier step. The pitch's "names the exact sequence number a privileged edit changed" holds for audit rows only. Fix: state the coverage boundary on stage, or make state changes part of the chained record.

4. **The downstream count is a verifier policy, not a broken link.** C 268 to 300 says rows after S "are reported unverifiable because their predecessor is broken." The stored hash of S is unchanged, so the link from S+1 still matches it. S+1 is unverifiable only because the verifier stops at the first failure. Proposal 03 corrected the same point in round 1. Fix: say the verifier stops at S by rule, and count the rows it did not check.

5. **The label rule on the fault controller is not enforceable by a stock socket proxy.** D.1 and E put the fault controller behind "a socket proxy that allows `kill` only on containers labelled `culvert.service`." Standard socket proxies filter by API endpoint and verb. The label condition must therefore be in the controller's own code, and the refusal tests in G.1 test that code, not the proxy. Fix: name the component that enforces the label rule locally, and make the parity row say so.

6. **The offline beat is rehearsed by emulation, and the stage uses a different action.** G.2 names two emulations (Playwright offline mode and DevTools offline). C 190 to 210 has Rafi's client detect connectivity after a stage action, and the rehearsal does not test a real network change. The proposal says the flush order is asserted in each browser, which is good, but the stage's "reconnect" is not the emulated path. Fix: rehearse one real network toggle on the presenter's machine and report the result.

7. **The claim 1 oracle depends on a parameter that the local build sets differently.** D.1 says `track_commit_timestamp` is on in both environments, which is correct. The oracle's narrowing of `xid8` to a 32-bit `xid` is said to be "unambiguous in the test database" but is not checked against the test's transaction volume. Fix: assert the narrowing in the test rather than assume it.

### Required changes

- Specify the hold release on the first holder's kill, and show it on the Ops panel.
- Anchor at the stage edit, or say the chain alone detects it.
- State the chain's coverage boundary on stage and in D.5.
- Replace "unverifiable because their predecessor is broken" with the verifier's stop rule.
- Name the component that enforces the label rule locally.
- Rehearse one real network toggle and report it.
- Assert the `xid8` narrowing in claim 1.

---

## 06 Unconventional Innovation (Sealroom)

### Round-1 items

- **Fixed, checked in text:** per-proposal state (A; D.2; D.6); the operator is a named BYPASSRLS role with write grants (D.5, C2 in the log); claim 1(c) is a conformance test and hiding is stated as an assumption (F claim 1); the terminal nonce backup is removed (D.1, G.2); anchor cadence is stated (D.3); at-least-once is restated with the window (D.4, F claim 4); untested items are marked untested (E, H.2); the reset starts a new anchor series (E).
- **Partly fixed:** the reveal and the rewrite. The reveal path is sound; the rewrite cannot be performed as scripted (weakness 1), and the stage windows do not show every actor (weakness 2).
- **New problems:** the rewrite's nonce source (weakness 1); BYPASSRLS on RDS for the score view (weakness 3); the rewrite and tamper tools may sit in the production image (weakness 4).

### Scores

| Criterion | Score | Justification |
|---|---:|---|
| Depth (25%) | 7.5 | Commit-reveal with a length-prefixed, domain-tagged commitment checked in browser and server; a `security_barrier` score view; a per-proposal guarded transition; milestone anchors. The climax's feasibility is weaker than the protocol (weakness 1). |
| Cohesion (20%) | 8.0 | One thesis, that no score is visible before every seal and the record cannot be rewritten unseen; the hidden-actor gap breaks it on stage. |
| Visual (15%) | 7.0 | Four identity windows, an officer board of six states, a reveal banner, a verifier and an offline file; text-heavy, as the proposal says. |
| Credibility (15%) | 6.0 | Round-1 contradictions are fixed, but the climax needs reviewer nonces the design says are unreachable, and the score view needs a role the proposal does not show RDS can create. |
| Narrative (10%) | 8.0 | The strongest story in the set when it runs; the "passes the internal check, fails the external one" arc is clear. |
| Feasibility (10%) | 5.5 | Node and Fastify, a browser verifier, one migration set, three worker jobs, six adapters with contract tests, seven CDK stacks, eight Compose services (H.1); parity suite is the largest test effort (G.3). |
| Reliability (5%) | 5.5 | The rehearsal gates and the anchor gate are good; the climax depends on untested platform behaviour, a file-URL verifier and terminal steps that cannot be rehearsed as stage actions. |

Weighted: 7.05 (round 1: 7.5).

### Strongest ideas

1. Scores exist only as commitments until reveal, and the browser refuses a mismatched reveal before anything is sent (C 170 to 190; D.3).
2. The score view is the only read path for other reviewers, and it reveals values only under stated conditions (D.2).
3. Anchors at milestones with an explicit `anchor_stale` state, never a false `ok` (D.3, D.6).
4. An offline verifier with a content-security policy that forbids connections, and shared test vectors with the server (C10, G.3).
5. The reset starts a new anchor series, which is the right answer to compliance retention (E; compare proposal 02).

### Concrete weaknesses, most severe first

1. **The rewrite cannot run as scripted.** C 255 to 275 says the operator "uses the stored nonces to recompute the two commitments" for Ada's and Dev's P-3 seals. Those nonces exist only in the reviewers' browser stores. D.1, G.2 and H.3 say nothing outside the browser holds them, no backup or escrow exists, and "the nonces land in the stage profiles, not in the terminal." Without the nonces the rewritten commitments cannot match, and the internal reveal-to-commitment check (D.3, integrity step 3) fails before the anchor step, so the stage shows the wrong failure. The climax as written is therefore not performable. Fix: state what the operator holds and how, with its threat note, or change the attack so it needs no reviewer nonce.

2. **Two of the four reviewers are not in any window.** C 140 to 170 has Dev seal P-3 (4 of 4). C 190 to 215 has Cora and Dev reveal. The stage has five windows: Officer, Ada, Ben, Applicant and Auditor. Dev and Cora have no window and no driver is named. The visible result, "four windows show four verified marks," therefore cannot be produced as described. Fix: add the windows, or name the headless driver and state the visible result on the stage.

3. **The score view requires a BYPASSRLS role that RDS may not let the proposal create.** D.5 (3) makes `sealroom_views` a non-login role with `BYPASSRLS`, and it owns the view the stage relies on for every read. PostgreSQL allows only a superuser to grant `BYPASSRLS`, and RDS does not give its master user the superuser attribute. E marks only the operator's BYPASSRLS as untested. The view's owner is the more central dependency, and G.1 already names the alternative (a policy that admits the view owner). Fix: test the owner's creation on RDS first, or move to the policy-based design and remove the BYPASSRLS dependency from the security claim.

4. **The rewrite and tamper tools may sit in the production image.** C11 defines two images, `sealroom-web` and `sealroom-api`, and says the API "doubles as worker by command override." D.1 places `sealroom-admin rewrite`, `integrity-check` and `rechain` under "operator tooling" with no image named. The "Send anyway" control is compiled into the same web image and enabled by configuration (E). The claim that the tamper is demo-only depends on an image split the proposal does not describe. Fix: build demo tooling in a separate image or behind a build tag, and assert in CI that the production images lack it.

5. **The script still uses literal hashes it says it does not use.** C10 says "the script never relies on a fixed literal." C 275 to 300 prints "7a1e…c03" and "0c9b…4e1" as script text. The rehearsal cannot assert them, because anchor keys change per reset (C10). Fix: have the rehearsal read the values from the screen and make the presenter's line refer to what is on screen.

6. **The 422 path is not in the idempotency mechanism.** C6 and F claim 4(b) require `422` for the same key with a different body. D.6 says the second transaction "reads the stored response." The schema has `request_hash`, but the mechanism never compares it. Fix: state the fingerprint comparison and the response for a mismatch.

7. **The Downloads beat depends on an untested browser behaviour.** C 240 to 255 opens `sealroom-verify.html` from Downloads over `file://`. C9 and H.2 say WebCrypto under `file://` is untested in each browser, and the verifier shows a refusal if `crypto.subtle` is missing. The stage has no fallback; a refusal removes the offline step from the climax. Fix: rehearse the file URL per browser and name the online verifier as the stage fallback.

8. **The relay does not handle partial batch failure.** D.4 marks rows relayed "after `SendMessageBatch` succeeds." Batch sends report per-entry results, and a partially failed batch is not addressed. Proposal 01 handles this (its revision log, item 11). Fix: mark only successful entries, and block later entries of the same group after a failure.

### Required changes

- State the source of the operator's reviewer nonces and its threat note, or change the attack.
- Add windows for Dev and Cora, or name the headless driver and the visible result.
- Test the owner role's creation on RDS, or move to a policy-based score view.
- Move the rewrite and tamper tooling out of the production image; assert absence in CI.
- Replace the literal hashes in the script with on-screen reads.
- State the fingerprint comparison and the mismatch response.
- Rehearse the offline verifier per browser and name a stage fallback.
- Handle partial batch failure in the relay.

---

## Comparative section

### Ranking

| Rank | Proposal | Weighted, round 2 (round 1) | Movement | Reason |
|---:|---|---:|---|---|
| 1 | 03 Enterprise Platform | 7.25 (7.3) | level | The strongest composition, with a verifier explanation that is now correct at its core. Its largest faults are in the drill's privilege model, the step-up's secret and the trace claim, all repairable without changing the design. |
| 2 | 04 Emergent Composition | 7.23 (7.25) | level | The plan-commit lock is a real total order and the cut rule keeps the stage honest. The tamper's superuser assumption, the anchor keys and the token choice must be repaired before it is credible on RDS. |
| 3 | 01 Systems Complexity | 7.15 (7.1) | up slightly | The deepest concurrency content and the most realistic tests. The countdown, the self-kill and the script's structure cost reliability. |
| 4 | 05 Operational Resilience | 7.13 (7.25) | down slightly | The best-stated fencing and replay design. The kill beat's hold semantics and the anchor placement are the open items, and both are specification fixes. |
| 5 | 06 Unconventional Innovation | 7.05 (7.5) | down most | The strongest narrative and protocol story. The climax cannot be performed as written (reviewer nonces), and the score view depends on a role that RDS may not allow. |
| 6 | 02 Visual Spectacle | 6.93 (6.9) | level | The best visuals, and the round-1 disqualification condition is met. The primary run moved to the least measured environment, and the AWS run still shows a Mailpit step. |

### Ideas worth keeping regardless of who wins

- **From 01:** one transaction under the auction row lock that writes the event, the hash, the outbox row, the NOTIFY and the audit row; database-clock close with `SKIP LOCKED`; proxy maxima held by grant with a canary test on every read path; prove-it by replaying the event log through the live applier; the scratch-copy tamper with the verifier naming the first break.
- **From 02:** `auction_seq` assigned under the auction lock; one projection function per audience shared by query and realtime; Cedar denials that name the policy; the in-process fault layer that drops a response after commit for a real replay test; a verifier that refuses an anchor verdict unless the object is locked.
- **From 03:** one commit for every consequence of an action; one `Decide()` for control, server and stored trace; request numbers from the allocation counter; a verifier split into a read that names its head and a write that records the result; drill evidence written as ledger events rather than a side log.
- **From 04:** a single lock that makes allocation order equal commit order; deferrable exclusion for double-booking with holds as rows; placeholders for withheld positions; a named cut rule with a named fallback; demo routing by parameter, as configuration; reset as replay of a seed file through the normal command path.
- **From 05:** the `xid` and snapshot-minimum replay watermark tested with a reordered-commit oracle; leases on database time with an epoch fence; a fixed-layout canonical encoding with a documented tamper procedure; authorisation as a membership table that tokens do not carry; a fault hook compiled out of the release image; statement and idle-transaction timeouts on consoles.
- **From 06:** commitments checked in the browser before sending and on the server after receipt; a score view as the only read path for sensitive values; anchors at milestones with an explicit `anchor_stale` state; a new anchor series per reset, which is the best answer to compliance retention; an offline verifier that makes no network requests.

### Cross-cutting items for the coordinator

- **Self-sent and PID 1 signals.** 01 relies on a self-sent SIGKILL. Test it in the production container shape before anything else depends on it. 05 avoids self-kill by using an external signal.
- **Stop-signal parity.** 02's realtime kill differs by platform (`docker kill` against `StopTask`). 01 and 05 have fixed this in their own text; 02 has not.
- **RDS role attributes.** 06 needs BYPASSRLS on the view owner; 04 needs a superuser for the tamper; 03's drill needs owner rights. None of these is a PostgreSQL role an RDS master user can be assumed to hold. Run a short role-attribute spike on RDS before the designs are compared on AWS.
- **Settable session settings as isolation.** 04's carrier view depends on `quayside.carrier_id`; 05 states the limit in the text; 03 uses `app.tenant_id` with a stated omission-only scope. Each should say the same thing about what RLS does and does not bound.
- **Anchor and checkpoint keys across resets.** 04 keys anchors by `global_pos`, which repeats after reset. 02 keys checkpoints without a run identifier. 06 avoids the problem with a new series per reset.
- **Verifier semantics at the first failure.** 03 now says the verifier stops at the first failure. 05 still says rows after the break "are unverifiable because their predecessor is broken", which is not what the stored hashes show.
- **Timestamp precision before hashing.** 03 needs a rounding rule for `occurred_at`; 04 stores the timestamp twice and does not state the check.
- **Live third-party dependencies in the core demo.** 02's AWS run uses SES delivery to real inboxes inside the settlement beat; the brief excludes that dependency from the core demo.
- **Numbers not yet measured.** 02's trace ingestion, 05's verification target, 04's lock hold and 06's commit-to-window histogram are each labelled as targets or measurements. None has a value yet, and none should appear on stage before one exists.
