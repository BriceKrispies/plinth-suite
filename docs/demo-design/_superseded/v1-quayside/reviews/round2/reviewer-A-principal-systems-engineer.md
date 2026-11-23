# Round 2 review: Reviewer A, Principal Systems Engineer

Scope: the mission brief (`docs/demo-design/00-mission.md`), the six revised proposals (`revised/01` to `revised/06`), and my round-1 review. Design review only; nothing was built or run. Each finding cites a section of the proposal or a script timestamp. Scores use the brief's weights. Weighted totals are the sum of weight times score on the 0 to 10 scale.

The question for round 2 is whether each revision fixed what I raised, introduced new problems, or added words. Where a revision answered a finding with a sentence and left the mechanism unchanged, I say so.

## Summary

| Id | Product | Depth (25) | Cohesion (20) | Visual (15) | Credibility (15) | Narrative (10) | Feasibility (10) | Reliability (5) | Weighted | Disqualified |
|---|---|---|---|---|---|---|---|---|---|---|
| 05 | Culvert | 9 | 8 | 7 | 7 | 8 | 6 | 6 | 7.65 | No |
| 02 | Tideline Live | 8 | 8 | 9 | 5 | 8 | 5 | 5 | 7.25 | No |
| 04 | Quayside | 8 | 8 | 7 | 5 | 8 | 6 | 5 | 7.05 | No |
| 03 | Ledgerwell | 7 | 9 | 7 | 5 | 8 | 6 | 4 | 6.95 | No |
| 01 | Tallyhouse | 8 | 8 | 6 | 5 | 7 | 5 | 4 | 6.65 | No |
| 06 | Sealroom | 7 | 7 | 6 | 5 | 9 | 6 | 6 | 6.60 | No |

No proposal is disqualified. Each has defects that an expert in the audience would find in the first minutes of questioning, and several defects sit inside the climax. Disqualification requires fake functionality, an unverifiable architectural claim, or incompatible deployments. None of the six depends on absent functionality. Two proposals make claims the mechanism cannot deliver (01 on proxy secrecy, 06 on detection), which I score heavily under credibility and reliability, not as disqualifying.

### Cross-cutting round-1 items, status by proposal

Key: F = fixed in mechanism; P = partly fixed; N = not fixed; A = accepted and stated as a limit; - = not applicable.

| Round-1 item | 01 | 02 | 03 | 04 | 05 | 06 |
|---|---|---|---|---|---|---|
| Session-variable trust is not an access boundary | P | - | N | N | F | N |
| Filtered-stream gaps need markers or cursors | - | - | F | F | - | - |
| External side effects are at-least-once, not exactly-once | F | P | F | - | P | F |
| ECS signal path described accurately | F | - | - | F | F | - |
| Chain has an external anchor | A | F | P | F | F | P |
| Ordering claim matches identity or xid allocation | F | F | F | F | F | F |

---

## 01 Tallyhouse (Systems Complexity)

### Round-1 follow-through

- Fixed: per-entry relay results and blocked groups (D.3 snippet); relay singleton versus `SKIP LOCKED` split (D.1, D.3); counter-bid corrected to 2,550 (C 45 to 60); one sequence counter (C, D.2); the in-process SIGKILL replaces the ECS StopTask description (C 205 to 225, E.2); the duplicate line is removed; `auction_events` is hashed and cross-checked against audit rows (D.2, F claim 5); the maxima canary covers more read paths (F claim 4).
- Not fixed in substance: proxy secrecy. The custom setting is gone, but the grant is defeated by functions that take a principal argument (see weakness 1). Round 1 said that any injected handler could read every maximum. That is still true, through a function instead of a setting.
- New: `set_proxy_max` takes a principal argument, so the same gap allows writes. The engine role is described as `NOLOGIN` and also as backing a second pool. Prove-it's hashed field list includes a transaction id that the stored body does not contain. The settlement and withdraw beats have timing and control problems.

### Scores

| Criterion | Score | Justification |
|---|---|---|
| Depth (25%) | 8 | Auction-row lock with `seq = last + 1` gives gap-free order, and the saga key in the effect's own transaction is concrete; the proxy path is under-specified where it matters. |
| Cohesion (20%) | 8 | One lock and one event log feed bid, stream, saga, ledger and audit, but Prove-it's field list does not match the body. |
| Visual (15%) | 6 | Four role panels and a step plot; accurate for engineers, not spectacle. |
| Credibility (15%) | 5 | The headline secrecy claim is defeated by its own functions, and the engine-role description cannot be built as written. |
| Narrative (10%) | 7 | The proxy war, kill and proof arc is clear, but the withdraw beat is a control that exists to fail. |
| Feasibility (10%) | 5 | Go, PostgreSQL features, SQS FIFO, saga, ledger, hash chain, RLS and a browser rehearsal, all in order, with a wide surface. |
| Reliability (5%) | 4 | A five-second button window, a wall-clock 150 s deadline, and a presenter-timed gate make the middle of the script fragile. |

### Strongest ideas

- The auction row lock as the sequencing decision, with the rejected `bigserial` alternative stated (D.4). The gap-freedom argument is correct because the sequence is assigned under the lock and held to commit.
- The in-process SIGKILL as the fault, with the same signal in both environments (E.2). This is an honest replacement for the StopTask story.
- Per-auction event chain over exact stored bytes, with an audit row per event that carries the event hash and a cross-check (D.2, F claim 5).
- The G.4 list of shallow features, including the price-leak caveat (G.4 "Row-level grants"). It is the candid part of the set.

### Concrete weaknesses, most severe first

1. **Secrecy is defeated by its own functions (D.4 "Read own maximum", D.5, G.4).** `engine.own_proxy_max(principal)` takes any principal id, and G.4 concedes that a handler "can call `own_proxy_max` with another principal's id". A compromised handler therefore reads every bidder's maximum with one call per bidder. D.5's sentence that a compromised handler "cannot `SELECT` a maximum" is true only in the narrow sense. The headline in B.8, "secrecy of maxima does not depend on any session setting", still depends on handler code. F claim 4 checks that a direct `SELECT` fails, which is the weakest form of the claim.
2. **Writes have no boundary at all (D.4 "Set proxy maximum", D.5).** `engine.set_proxy_max(principal, auction, max)` upserts a row for the principal it is given. Any application-role handler can set another bidder's maximum. That is an integrity hole that secrecy tests do not touch, and no claim in F covers it.
3. **The engine role cannot back the pool described (D.1 vs D.2).** D.2 says `tallyhouse_engine` is `NOLOGIN` and that the application role is not a member of it. D.1 says the API uses "a second pool with the engine role, used only by the bid package". A `NOLOGIN` role cannot authenticate a pool. If it is given `LOGIN`, the API process holds direct `SELECT` on `proxy_bids`, a path that no test covers. Either way the boundary is which pool a handler chooses.
4. **Prove-it hashes a field the body does not contain (C 255 to 275 vs D.2).** The panel lists per-event "tx id" among hashed fields. D.2 lists the body fields as seq, kind, amount, bidder_id, ends_at, state and lot_id, and stores `tx_id` as a separate column. The proof panel therefore claims coverage the chain does not verify. The same mismatch affects the rebuild hash in F claim 4.
5. **The bid-minimum gate is a five-second window on a wall clock (C 135 to 150, C reliability note).** The button is enabled only while the countdown reads 00:10 to 00:05, and the auction closes at a fixed 150 s from reset. The presenter must click inside that window after watching a countdown, which is the waiting the brief asks to avoid. Overrun closes the auction, and recovery is a full re-reset, which is not available mid-talk.
6. **A control that is guaranteed to fail (C 170 to 185).** "Withdraw lot" is enabled only once the console shows `closing`, which is exactly the state in which it is refused with `lot_in_settlement`. The audience sees a button built to fail. The claim is correct, but the beat costs time without adding a mechanism.
7. **Countdown arithmetic is inconsistent (A "Why it suits", C 135 to 150).** A says the countdown "jumps by 30 seconds" when an anti-sniping bid lands. C shows 00:10 becoming 00:30, a change of 20 seconds of remaining time. The number on the countdown is what the audience reads.
8. **Relay head-of-line blocking has no end state (D.3).** A failed entry blocks later entries in its group in every batch, but nothing defines what happens to a message that never succeeds. A poison message blocks its auction's saga messages indefinitely, with no dead-letter rule at the relay.

### Required changes

- Remove the principal argument from `own_proxy_max` and `set_proxy_max`; derive the principal inside the function from a verified session value the handler cannot choose, or make the function accept a bid intent and return only that caller's row. Add tests that a second principal's id returns nothing and cannot write.
- Choose one engine access path: a `LOGIN` role used by no handler except the bid function, or a `SECURITY DEFINER` function with no table access. Correct D.1 to match.
- Make the Prove-it field list identical to the stored body, or move `tx_id` into the body and re-run the golden tests.
- Replace the five-second gate with a state that stays enabled, and remove the wall-clock deadline from the timing dependency.
- Replace the withdraw beat with a withdrawal attempt that succeeds, or drop it.
- Correct the countdown sentence in A to match C.
- Add a poison-message rule to the relay.

---

## 02 Tideline Live (Visual Spectacle)

### Round-1 follow-through

- Fixed and checked: the ladder timeline is rebuilt, and I walked it against the step rule. Opening 4,000; 4,100; 4,200; 4,300; 4,400; 4,500; 4,600; 4,700; 4,800; 4,900; the counter at 5,000 moves the band to step 200; minimum 5,200; Ana's counter at 5,400; minimum 5,600; Ben's jump to 6,100 is valid as a minimum-next rule. The extensions 200 to 202 and 202 to 206 match `now + 10` on the bids at 192 and 196 s. The duplicate is a labelled fault (C 240 to 256). The lock order names the clock worker's auction lock first (D.4). Rust is pinned (E.1).
- Not fixed: the pseudonym claim (weakness 2) and the notifier boundary (weakness 1) are still false as written.
- New: the auditor's redacted payloads cannot be verified by the auditor (weakness 4). The local run cannot show the climax (weakness 3).

### Scores

| Criterion | Score | Justification |
|---|---|---|
| Depth (25%) | 8 | Per-auction sequence under the lock with commit order equal to sequence order, idempotent stored responses including the counter-bid, and Cedar with policy identifiers are real and specified. |
| Cohesion (20%) | 8 | One transaction covers authorization, ladder, proxy, events, outbox and notify, and the Floor and bidder views are projections of the same stream. |
| Visual (15%) | 9 | The strongest visual language in the set, with every element tied to a real event and a labelled extension. |
| Credibility (15%) | 5 | Two claims are false as written (pseudonyms, notifier window), and the local run substitutes the climax, which the brief forbids. |
| Narrative (10%) | 8 | One beat per role and a strong closing sequence that names a sequence number; the finale is AWS-only. |
| Feasibility (10%) | 5 | Rust, Cedar, OpenTelemetry, Keycloak and Cognito parity, Object Lock on MinIO and S3, SES, X-Ray and Jaeger, with a broad parity surface. |
| Reliability (5%) | 5 | Timing is server-derived, but the flaky-response beat, the scripted fallback bid and two identity providers add variance. |

### Strongest ideas

- Per-auction `auction_seq` assigned under the auction lock and held to commit, so commit order and sequence order coincide (D.4). This is the cleanest replay statement in the set.
- Idempotent commands that store the serialized response in the same transaction as the effect, including the proxy counter-bid (G.3).
- Rejection messages that name the ladder version, band, step and minimum (C 60 to 80).
- One redaction function applied to query and realtime paths, with a test per (record type, audience) pair (D.5).

### Concrete weaknesses, most severe first

1. **The notifier's duplicate window is wider than stated (D.3, steps 2 and 3; G.2; F claim 5).** A row in state `claimed` is re-sent in step 3. The protocol cannot distinguish "a previous attempt crashed" from "another notifier is sending right now", and there is no lease, epoch or timestamp rule. SQS standard queues redeliver when a send outlives the visibility timeout, so two notifiers can both send without any crash. The stated bound, "one message per notifier crash", does not hold. The repair is a lease with an epoch, as in 05, and a test that a slow send and a redelivery produce at most the stated duplicates.
2. **The pseudonyms are derivable (D.5 "Pseudonyms"; A "Sample data").** `score = sha256(auction_id || bidder_id)` is unkeyed, and the seed fixes every UUID from names by UUIDv5. Anyone with the repository computes "Bidder N" for every seeded registrant, and for any auction the rank needs only the registrant list. The text says the pseudonym is "not derivable from the bidder's identity by anyone outside the server", which is false for this design. A keyed hash with a server secret, or a random assignment stored server-side, fixes it.
3. **The local run cannot show the climax (C 256 to 300; "Run policy"; E.2).** The local run labels both anchor steps "not run on this run", and MinIO's root user can bypass retention. The brief says local substitutes must keep externally observable behaviour identical. Here the strongest moment's output differs by design, so the local deployment is a diminished simulation of the finale. That is a violation of the mission text, not a rounding issue.
4. **Auditor verification cannot run on the redacted payloads (D.5 "Redaction", C 256 to 266).** Proxy events carry the maximum (C 100 to 120, `proxy_set`), and the auditor's event payloads replace it with the literal `"redacted"` "and keep the event's canonical hash". The hash covers the unredacted payload, so an auditor working from the redacted copy cannot recompute it. Verification must therefore run server-side on unredacted bodies. Neither D.5 nor C says which copy "Verifier recomputes every hash" uses.
5. **Checkpoint storage grows quadratically (D.1 checkpointer; D.5; G.4 "Checkpoint retention").** Each checkpoint lists every event hash through its sequence, and a checkpoint is written every 100 events per auction. Stored hash entries across checkpoints therefore grow as about N squared over 200 for N events (computed from the stated cadence), and retention keeps all of them until expiry. The design needs incremental checkpoints or a Merkle summary.
6. **Pseudonym stability is claimed but not tested (D.5, F).** The rule is stated as stable within an auction, but no claim in F covers it, and the proxy-ceiling caveat depends on it.
7. **The Floor's authorization is undefined (A "Users and roles").** The Floor is "anonymous read-only ... no credentials beyond a read-only scope". Which route, token or scope serves the Floor on the public ALB, and how the redaction table applies to it, is not stated.
8. **The parity surface is still wide (A10, H.3).** Two identity providers, X-Ray and Jaeger, MinIO and S3 Object Lock, SES sandbox identities and Framer Motion. The narrowing is real but the count of differences is the feasibility risk.

### Required changes

- Replace the notifier claim with a lease-and-epoch protocol, or state the duplicate window as "any redelivery during a send", and test it.
- Key the pseudonym with a server secret, or assign numbers at seed and store them server-side. Remove "not derivable" unless the test supports it.
- Give the local run a verifiable anchor substitute that refuses the same things S3 Object Lock refuses, or move the finale to the AWS run and say so in the mission-level summary.
- State which copy the verifier reads, and that the auditor sees verification results rather than recomputing from redacted payloads.
- Make checkpoints incremental, and state the storage bound.
- Define the Floor's credential and redaction path.

---

## 03 Ledgerwell (Enterprise Platform)

### Round-1 follow-through

- Fixed: `through` markers and per-viewer cursor (D.3, F4); `ops_log` removed (D.2); Tom no longer initiates the drill (C 215 to 245); explain writes a stored `decisions` row (D.Authorization); one global lock order (D.Lock order); verification split into read and write (D.Verification); RLS prose and policy agree; the hash encoding is byte-specified (D.Ledger hash encoding); budget lifecycle defined; request numbers follow the counter.
- Not fixed: round-1 cross-cutting item 1 asked each design to state the session-variable boundary and test the setter. The revision changes the prose around the policy and does not address the boundary. F1 still says isolation holds "through any statement the application role can issue".
- New: the drill mechanism does not work as described in PostgreSQL (weakness 1); the drill target is visible to every session while the script says it is not shown (weakness 2); the integer range in the hash encoding conflicts with JCS (weakness 4).

### Scores

| Criterion | Score | Justification |
|---|---|---|
| Depth (25%) | 7 | One-commit composition, the chain-head lock and the stored decisions are real; the drill's mechanics and the isolation boundary are not specified correctly. |
| Cohesion (20%) | 9 | Every visible moment is a consequence of the same ledger commit, which is the strongest composition in the set. |
| Visual (15%) | 7 | Four windows with a budget card and a banner; much of it is administrative, as the proposal itself concedes. |
| Credibility (15%) | 5 | The climax's mechanism is wrong for PostgreSQL, the isolation claim rests on a settable setting, and the drill's target contradicts the script. |
| Narrative (10%) | 8 | The budget arithmetic is exact (400,000 minus 240,000 minus 60,000 leaves 100,000; 48,000 leaves 52,000; 35,000 leaves 17,000), and the race lands. |
| Feasibility (10%) | 6 | Go, a restricted CEL subset, five CDK stacks, Dex and Cognito parity, with ordered layers and separate tests. |
| Reliability (5%) | 4 | The drill's table-level lock would block every Halvard write during the climax, and step-up depends on staging TOTP. |

### Strongest ideas

- One transaction for submission: reservation, request, ledger event, outbox row and idempotency record together, backed by a `CHECK` (C 30 to 40, D).
- Workflow versions immutable once published, and each request pinned to its version (D4). "Which rules applied" becomes a fact in the record.
- The generated RLS catalogue test that fails the build when a tenant table lacks a policy (F1).
- Server-computed `permitted_actions` with one evaluator in the server language, which removes the browser-side disagreement (B, D2).

### Concrete weaknesses, most severe first

1. **The drill's trigger mechanics are not PostgreSQL behaviour (C 215 to 245; D.Drill step 3; D.2 roles).** The text says the runner "disables the immutability trigger for that statement" and that the forensics role has "permission to disable the immutability trigger". In PostgreSQL, `ALTER TABLE ... DISABLE TRIGGER` is DDL that requires ownership of the table or superuser; it is not a grantable privilege. It is also not scoped to one statement: it applies to the table until the transaction ends and takes a table-level lock that conflicts with appends. While the drill runs, every append to the tenant's ledger waits, including the stream's own writes. Session-scoped alternatives such as `session_replication_role` need superuser. The climax as specified needs the forensics role to own `ledger_events`, which the design reserves for the migration role.
2. **The drill target is public (C 215 to 245 "The target is not shown"; D.Visibility).** `drill.requested` carries `target_seq 1612`, the field and the values 960,000 and 480,000, and `drill.*` events are visible to every principal in the tenant. Maya's and Dev's streams therefore receive the target before the break. Either the payload must be restricted, which changes the visibility rule, or the script's sentence is false.
3. **Tenant isolation rests on a setting the application role can change (F1; A "Problems solved"; D.Persistence).** The policy reads `app.tenant_id`, which the application sets with `SET LOCAL`. The application role can issue `SET LOCAL app.tenant_id` to any tenant, so "any statement the application role can issue" includes reading tenant A from a tenant-B session. The claim holds against code that does not set the variable. Round-1 asked for the boundary to be stated and the setter tested. Neither was done.
4. **The integer range breaks the hash specification (D.Ledger hash encoding).** Payload integers are allowed "within int64", but RFC 8785 serializes numbers as ECMAScript doubles. Integers above 2^53 do not round-trip in the browser verifier. The shared vectors would pass in Go and could diverge in TypeScript. Restrict integers to the safe range or encode large values as strings.
5. **A removed feature is still a guard input (D.Authorization step 2).** `Decide()` evaluates guards over `vendor`, but vendor screening was removed (B, "Removed from the product"). The publish-time type check validates an input that no longer exists.
6. **Reads may write denial events (D.Authorization; "Every request response carries `permitted_actions`").** Mutations and denials write ledger events, and every response computes `permitted_actions`, which includes actions that are not permitted for that caller. If a denied control on a page view counts as a denial, every page load appends an event that the stream delivers to every session. The text must exclude capability computation from denial events.
7. **Stream cost grows with tenant volume (D.Communication; G.1 item 2).** Each subscriber reads every tenant event above its cursor and calls `Decide()` per event. `through` markers shorten the frames, not the reads, so per-subscriber work grows with total tenant events, not with visible ones.

### Required changes

- Replace the drill mechanism with one PostgreSQL can perform. Either the forensics role owns `ledger_events` in a staging-only schema, or the drill edits the payload through the same owner path the console uses, with the trigger disabled for the whole transaction and the lock cost stated.
- Restrict the drill payload to the principals who should see the target, or change the script line to say the target is visible to all tenant sessions.
- State the setter boundary for `app.tenant_id`, and either test it or move the isolation claim to "against accidental omission". Consider a per-tenant database role.
- Restrict integers in payloads to the safe range or encode them as strings, and add vectors at the boundary.
- Remove `vendor` from `Decide()` and the publish checks.
- State that capability computation writes no events.
- Add a per-subscriber watermark so that invisible events are not rescanned.

---

## 04 Quayside (Emergent Composition)

### Round-1 follow-through

- Fixed: the commit order is now a real protocol. Positions are allocated under the plan-commit lock and held to commit (D.3), so a visible position implies every lower position is decided. I checked this and it holds. Holes from rollbacks are permanent and are not waited on. This resolves round-1 A1, B1 and C1.
- Fixed: canonical bytes are stored and hashed (D.2, D.5); the policy inventory covers every table (D.6); carriers see only their own visit slots (D.6); the forecast worker is a defined principal (D.5); snapshots carry a hash link (D.2); the tamper target is named (C 250 to 265); holds are slots under the exclusion (D.2); the parallel-commit claim is withdrawn honestly.
- Partly: anchors now attest stream heads (D.5 item 6), but they are computed from the same event rows (weakness 4), and the verifier's discovery of anchor objects is not stated (weakness 5).
- Not fixed: carrier isolation is still a setting plus undefined roles (weakness 1).
- New: ID tokens as API credentials (weakness 2); an RDS superuser assumption (weakness 3).

### Scores

| Criterion | Score | Justification |
|---|---|---|
| Depth (25%) | 8 | The plan-commit lock, the reader rule, the exclusion constraint for visits and holds, and the pure solver with input hash and version are specified to implementable depth. |
| Cohesion (20%) | 8 | A small set of primitives produces each beat, and the rebase reuses the solver on the same snapshot. |
| Visual (15%) | 7 | A Gantt with ghost proposals and a trace waterfall; the proposal itself calls the Gantt the least technical part. |
| Credibility (15%) | 5 | The ordering is now honest, but carrier isolation depends on undefined roles and a setting, and the tamper's superuser is not an RDS grant. |
| Narrative (10%) | 8 | Three windows contend for one berth, and the closing trace across two replicas is a strong moment. |
| Feasibility (10%) | 6 | Ten dependency-ordered layers using standard Postgres features; the forecast path adds a worker and presigned uploads. |
| Reliability (5%) | 5 | Cross-replica `NOTIFY` through the load balancer is unproven until the spike; the 210 s cut rule is a real fallback. |

### Strongest ideas

- The pure solver with stored `input_hash` and `solver_version`, so a replay on another build reports a mismatch (D.2, G).
- Half-open spans with a deferrable exclusion constraint that also covers holds (D.2, H).
- Rebase that re-solves only the affected subset and reports dropped moves with reasons (6b).
- The policy inventory table (D.6): one row per table and read path, with the rule that governs it.

### Concrete weaknesses, most severe first

1. **Carrier isolation depends on undefined roles and a setting (D.2 `events_for_carrier`; D.5 items 4 and 5; D.6).** Carriers read through a view that reads `current_setting('quayside.carrier_id')`. D.5 item 4 says "RLS applies to the carrier and auditor roles", but item 5 lists only the API, worker, migration and verifier roles. The API role sets the setting on its own connection. A handler that sets another carrier's id reads that carrier's content. F3 says the matrix runs "through the database role", but no carrier role exists in the document. The round-1 cross-cutting item is therefore not fixed.
2. **ID tokens are used as API credentials (D.5 item 2; D.7).** The API accepts `token_use = id` and reads `custom:carrier_id` and `cognito:groups` from ID tokens. ID tokens are issued to the client, and accepting them as bearer credentials for the API conflates audiences: any token from that app client is valid API input, and the authorization identity is a client-facing claim. Access tokens with an API audience are the standard shape. Round 1 asked for the access-token path to be consistent; this revision changed the token type without fixing the audience model.
3. **The tamper beat relies on a superuser RDS does not provide (C 250 to 265; E "Two behaviours").** The document says the tamper "needs only a superuser session, which the demo account has on both". RDS master users do not hold the `SUPERUSER` attribute; they hold `rds_superuser`. The grant that actually permits editing a `FORCE`-RLS table is table ownership or `BYPASSRLS`, and it is not named. Proposals 05 and 06 name their grants. This one claims "identical on RDS" without naming how.
4. **Anchors are computed from the rows they attest (D.5 item 6).** The worker "computes the head of every stream as of that position from the event rows". An anchor written after a tamper but before the next worker run records tampered heads. The window between commit and anchor is not bounded, and the design does not say whether heads are taken at commit time. Each anchor also re-reads events up to its position, so work grows with the log; coalescing limits the number of writes, not the reads.
5. **The verifier's discovery of anchors is unstated (D.5 item 6; F "Verify chain").** The verifier "compares each stream's stored head with the anchor at or below the latest position". It does not say how it lists anchor objects. If it uses a database index, a superuser can delete index rows. The same design should list the bucket prefix.
6. **Placeholders leak timing and cost (D.4 "Real-time"; G.4).** Each reconnect returns every position after the cursor, so a carrier's bandwidth and reconnect cost grow with terminal-wide traffic, and the timing of placeholders reveals when other carriers acted. The accepted limitation names counting only.
7. **The decisions trail is not tamper-evident (D.2 `decisions`).** The decision IDs stored on events and the rows that justify refusals sit outside the hash chain. The verifier cannot show that a recorded refusal or a forecast decision was not altered after the fact, which matters for the Auditor's replay at 225 to 250 s.

### Required changes

- Define the carrier and auditor database roles in D.5 item 5, grant them only the views, and make the setter boundary explicit (the API role can set `quayside.carrier_id`, so the claim is "against accidental omission").
- Use access tokens with an API audience, and validate `aud` for the API resource.
- Name the superuser grant the tamper uses on RDS, or replace the tamper's actor with a role that has ownership, and remove the "identical on RDS" claim until it is tested.
- State when heads are computed (at commit, from the transaction's own writes) and bound the anchor lag.
- Specify that the verifier lists the anchor bucket prefix.
- Bound the placeholder cost and state the timing side channel.
- Hash the decision rows into the chain, or state that refusal evidence is not covered by the verifier.

---

## 05 Culvert (Live Operational Resilience)

### Round-1 follow-through

- Fixed: Sam's dual dispatcher memberships (A, D.2), so the opening scenes are authorized by table rows; "commit-ordered" is replaced with an xid-ordered prefix and an oracle that can detect the difference (D.4, F claim 1); the SECURITY DEFINER probes return booleans and state that they are an existence oracle (D.2, D.5); the membership key uses `unique nulls not distinct` (D.2); every table has a written policy (D.2); the principal boundary is bounded to accidental omission (D.5); the signal path is described per platform (E); lease epochs use the database clock with a fence (D.6); canonical audit bytes use a fixed layout with offsets (D.2, F claim 4); the closing line no longer promises an AWS result.
- Partly: the fence is still partial (G.1), but this is stated and bounded.
- New: the verifier's downstream count contradicts its own hash rule (weakness 1); audit sequence identity gaps (weakness 2).

I checked the replay query's watermark argument. `xid < pg_snapshot_xmin(pg_current_snapshot())` delivers a prefix that no later commit can precede, because any transaction holding an xid below the watermark would appear as running. That argument is sound.

### Scores

| Criterion | Score | Justification |
|---|---|---|
| Depth (25%) | 9 | Watermark replay with a stated oracle, lease epochs on the database clock, precondition-based offline replay, and fixed-layout canonical bytes are specified at implementation depth. |
| Cohesion (20%) | 8 | Authorization, replay, outbox, audit and conflicts interlock; the opening scene now matches the policy. |
| Visual (15%) | 7 | Health strip, offline queue, chain strip and a fault panel; less spectacle, well matched to the mandate. |
| Credibility (15%) | 7 | Most round-1 defects are fixed with stated bounds; the remaining problems are wording and verifier semantics rather than invented mechanisms. |
| Narrative (10%) | 8 | Kill, reclaim, offline replay, replica loss and a privileged edit form one arc that the verifier closes. |
| Feasibility (10%) | 6 | Go, Postgres, Terraform, Traefik, Dex and Cognito, a PWA service worker, emulation and 13 ordered steps. |
| Reliability (5%) | 6 | Timing is configured and measured, the replacement task is not waited on, and offline emulation is run in two browsers; the reclaim window is a range, not a point. |

### Strongest ideas

- Replay on a transaction-identifier watermark, with the oracle that distinguishes transaction-start order from commit order (D.4, F claim 1).
- Lease claims with an epoch on the database clock, renewal while alive, and a fence before the send (D.6). The partial-fence limit is stated.
- Offline replay that compares preconditions (`base_status`, `base_crew_id`) instead of versions, so unrelated edits do not conflict (D.6).
- The fault controller with an allow-list, refusal tests for untagged targets, and a parity table row for the operator plane (E, G.1).
- The two-step owner console with statement and idle timeouts and an apply that is itself appended to the chain (D.5 item 6, C 250 to 268).

### Concrete weaknesses, most severe first

1. **The verifier's "unverifiable downstream" count contradicts its hash rule (C 268 to 300; C 230 to 250).** The script says rows after the break are "unverifiable because their predecessor is broken". For an edit that does not recompute hashes, the stored hashes of later rows are unchanged and each later row recomputes from its stored predecessor hash. Those rows are not unverifiable. The verifier either stops at the first failure, which is what 03 does explicitly, or it skips them. The on-screen count is then a count of rows not checked. The sentence must say so, and the number must be labelled as a stop artifact.
2. **Audit sequence values have holes on rollback (D.2 `audit_events`; C 250 to 268).** `seq` is `generated always as identity`. Rolled-back transactions consume identity values, so a rejected write leaves a gap that looks like a deleted row. The script names "the exact sequence number", and the verifier's rule for gaps is not defined. Use a chain-head row for the sequence, or state that gaps are expected and the verifier ignores them.
3. **Authorship in the chain is supplied by the caller (D.2 "Append path").** `append_audit` "trusts the canonical bytes the caller supplies". Any application-role code path can append a row naming any actor, subject or crew. The chain proves that later edits happened, not who wrote a row. D.2 says this, but the audit fields are still presented as recorded facts in the Prove panel and in Claim 3.
4. **The replay cursor advances only on visible events (D.3 "Client reconnect"; D.4).** The reconnect key is "the last delivered key", and visibility is enforced by RLS. A subscriber whose visible events are old rescans every invisible event above its cursor on each 250 ms tick and each notification. Per-subscriber work grows with terminal-wide activity. A per-subscriber watermark cursor over all events removes this.
5. **`culvert_app` can enumerate orders through the probe (D.2 "Read probes").** `probe_order` is granted to the application role, so any handler, injected statement or future endpoint can test existence and visibility for arbitrary order ids. The document accepts this, but the claim "denied rows are invisible, not forbidden" (B row 6) and the uniform 404 depend on the probe being called from one handler.
6. **The operator plane differs in MFA and is missing from the parity table (D.5 item 5; E).** On AWS the Ops client requires MFA through a separate Cognito client. Locally, Dex has no MFA and the parity table has no row for it, although C9 added an allow-list row. The difference should be labelled where the demo shows the Ops drawer.
7. **The stated stop timing is correct but its effect on fault scenes needs one sentence (E; G.1 "Two-phase signals").** Both platforms send SIGKILL after 2 s, and workers without a SIGTERM handler exit at once. That is consistent, but the replacement's start time is unmeasured, and the scene does not wait for it. The text handles this.

### Required changes

- Restate the downstream count as rows not checked after the first failure, and align the wording with 03's stop rule or with a chained recomputation.
- Replace `identity` for `audit_events.seq` with a chain-head row, or define the verifier's gap rule.
- State that audit actor fields are supplied by the caller and are attestations of the application, not of the database. Keep the chain claim to later edits.
- Add a per-subscriber watermark cursor for invisible events.
- Bound the probe to one handler by a static test, and state the existence oracle on the demo's security slide.
- Add the local-versus-AWS MFA difference to the parity table.

---

## 06 Sealroom (Unconventional Innovation)

### Round-1 follow-through

- Fixed: the headline is restated, the operator is named as the adversary and as holding BYPASSRLS and write grants, and the claim is stated against the application roles (Summary, A, D.5); audit payloads and round events carry no score before close (D.2, D.3); state moves per (round, proposal) (D.2, D.6); the officer's transitions require the sealed count or a recorded deadline override (D.5); unrevealed commitments are excluded with `no_result` as the zero-reveal rule (D.3, D.6); anchors are written at milestones with a 30-second sweep and a visible terminal command (D.3, C 275 to 300); the replay endpoint and the heartbeat with `latest_seq` exist (D.4); the consumer order is stated (D.4); the idempotency row is the first statement of every mutating transaction (D.6); `round_roles` is in the schema (D.2); the reveal is bound into the chain (D.3).
- Partly: the attack gate is a visible precondition now, but the detection path reads rows the operator controls (weakness 1).
- New: nonces are said to stay off the terminal and are then used from the terminal (weakness 2); the COI policy wording may admit unassigned reviewers (weakness 4).

I verified the median arithmetic on the rewrite: 8, 7, 6, 7 has median 7; changing Ada to 4 and Dev to 5 gives 4, 5, 6, 7 and floor of the mean of the middle two, which is 5. The rewrite output in C 255 to 275 is correct.

### Scores

| Criterion | Score | Justification |
|---|---|---|
| Depth (25%) | 7 | Length-prefixed, domain-tagged commitments, the sealed-count guard and the per-proposal state are real, but the anchor check is driven by rows the adversary can edit. |
| Cohesion (20%) | 7 | Sealing, anchoring and verification interlock, and the per-proposal states now fit the six-proposal script. |
| Visual (15%) | 6 | Four windows and a single-file verifier; the synchronized close is good, but the surface is thin, as the proposal concedes. |
| Credibility (15%) | 5 | The headline climax can be defeated by deleting anchor rows, and the nonce location contradicts the terminal claim. |
| Narrative (10%) | 9 | The best arc in the set: a verifier passes, the attack is internally consistent, and an external anchor fails in four windows at once. |
| Feasibility (10%) | 6 | Node, WebCrypto, Fastify, CDK, six adapters and a parity suite; the parity suite is named as the largest effort. |
| Reliability (5%) | 6 | The reveal path is deterministic, and the anchor gate is visible; the climax still depends on the sweep and on the browser's `file://` crypto. |

### Strongest ideas

- Length-prefixed, domain-tagged commitments with a 256-bit nonce, checked on the server with a constant-time compare (D.3, F claim 1). The binding and hiding roles are explained correctly.
- Conflict of interest enforced as an insert predicate, tested with raw SQL that bypasses the handlers, plus a mutated-handler test (F claim 2).
- Audit payloads stored as the exact text that was hashed (D.2 `payload_canonical`).
- The external anchor as the climax, with the rewrite passing the internal check and failing the external one (C 255 to 300).
- The zero-request offline verifier, tested under `file://` (C10, G.3), with the proof-versus-provenance limit stated (G.4).

### Concrete weaknesses, most severe first

1. **The anchor check reads anchor rows from the database the operator can edit (D.3 "Integrity check" step 2; D.5; C 275 to 300).** Step 2 reads "for every anchor row" the recorded object version from S3. The operator has BYPASSRLS and write grants on every table (D.5). `DELETE FROM anchors` leaves zero rows to check, and the check reports "0 of 0 match" while the locked objects remain unread. `integrity_status` is also a row the operator can write. The claim "the operator could not rewrite the bucket" is true and does not cover this path. The verifier must list the bucket prefix for the round, and fail when an expected milestone object is absent. Without that, the climax can be defeated by one statement.
2. **Nonces are on the terminal the audience can see (A11; E step 2; E step 4; C 255 to 275).** E step 2 writes the seeded scores and nonces to a file on the presenter's machine. E step 4 says the nonces "land in the stage profiles, not in the terminal". C 255 to 275 has the operator use "the stored nonces" to recompute commitments. The operator in the demo therefore holds openings for the seeded reviewers. That is a stronger adversary than the product's, and the script does not say so. The statements must be reconciled.
3. **The anchor's lag window is not bounded (D.6 "Deliberately not linearizable"; G.4).** The anchor is written by a job after the commit and computed from database rows. A rewrite between a milestone commit and its anchor is recorded as the rewritten head. The document bounds this only as "lags by one job" and excludes only the first anchor of a round. The window should be stated as the time between commit and anchor write, and the anchor should be computed from the commit path where it is possible.
4. **The COI rule may admit unassigned reviewers (D.5 "Reviewer"; F claim 2).** The rule says a commitment is inserted "only where `assignments.coi = false`". If the policy checks the flag and not the existence of an assignment row, a reviewer with no assignment can seal. Claim 2(c) tests only an assigned reviewer with `coi = false`. The policy must require an assignment row with `coi = false`, and the claim must test an unassigned reviewer.
5. **The subscription has no cursor, so the replay window is only closed by the heartbeat (D.4 "Real-time").** The first WebSocket message carries the token, and the server pushes events from the moment of subscription. Events committed between a replay response and the subscription are missed until the next heartbeat triggers another replay. The loop converges, but the claim that a lost frame is detected "within one heartbeat" needs the subscription to carry `after` so the window does not exist.
6. **Audit sequence identity has holes on rollback (D.2 `audit_events`).** The same issue as 05: rolled-back transactions consume identity values, and the verifier's rule for gaps is not stated. The 200-seal claim in Claim 3 holds only because no seal rolls back in that test, which should be stated.
7. **The operator's BYPASSRLS on RDS is unverified (D.5; E "What differs").** The design acknowledges this and selects a migration-created operator role if the master lacks `rolbypassrls`. That is an honest fallback. The stage claim names the operator role, so the fallback must be the one rehearsed, and the script should say which.

### Required changes

- Make the verifier enumerate the round's anchor objects in the bucket, compare them with the expected milestone sequence derived from the chain, and fail on any missing or extra object. Stop reading the anchor list from the database for the verdict.
- Reconcile the nonce statements: either the terminal never holds nonces and the rewrite tool reads them from the stage profiles, or the script says the operator holds the seeded openings.
- State the anchor-lag bound and compute the anchor head at commit time where possible.
- Require an assignment row with `coi = false` in the insert policy, and test an unassigned reviewer.
- Give the subscription an `after` cursor so the replay window is closed by construction.
- State the verifier's gap rule for audit sequence values, or replace identity with a chain-head row.

---

## Comparative ranking

Weighted totals from the table above. Ranking by weighted total.

1. **05 Culvert, 7.65.** The best replay and fencing design in the set. Round-1 defects were corrected with stated bounds rather than sentences, and the opening scene now matches the policy. Its remaining issues are wording and verifier semantics: the downstream count, identity gaps and caller-supplied authorship. Its mechanisms are the most consistent with the claims it makes.
2. **02 Tideline Live, 7.25.** The strongest visuals and the cleanest sequence argument, and the ladder timeline is now arithmetically correct. It is held back by two false claims (pseudonyms and the notifier window), by the local run's omission of the climax, and by the auditor-verification ambiguity.
3. **04 Quayside, 7.05.** The ordering protocol is now correct and honest, and the solver and exclusion design are the strongest primitives. Carrier isolation still depends on undefined roles and a setting, the tamper's superuser is not an RDS grant, and ID tokens are the wrong credential for an API.
4. **03 Ledgerwell, 6.95.** Still the strongest single composition, one commit producing every visible moment. It drops because its climax's drill mechanism does not work in PostgreSQL as written, its isolation claim is unchanged from round 1, and the drill target is visible to every session while the script says it is not.
5. **01 Tallyhouse, 6.65.** The deepest concurrency and saga content, with the most honest failure analysis, and its stage claims hold when corrected. Its core secrecy claim is defeated by two functions that take a principal argument, and its engine-role design cannot be built as described. This is the weakest technical point in the set for an expert audience.
6. **06 Sealroom, 6.60.** The best narrative and a strong external-anchor climax. The round-1 corrections are careful and mostly real, but the climax's detection reads rows the operator can delete, and the nonce location contradicts the terminal claim. The climax is the proposal's central promise, so this defect goes to its centre.

The gap between 01 and 06 is within the rounding of the weights. Both are heavily penalized under credibility for a central claim the mechanism cannot deliver.

### Ideas worth keeping regardless of who wins

- **01:** the auction-row lock with `seq = last + 1` and the rejected `bigserial` alternative stated; the in-process SIGKILL as the fault; the per-auction event chain cross-checked against audit rows; the maxima canary across read paths; the relay's per-entry result handling.
- **02:** the ladder citation in every rejection; the stored-response idempotency that includes the counter-bid; one redaction function for query and realtime paths with per-audience tests; the displayed extension equal to the stored change; the clock worker that takes the auction lock first.
- **03:** one-commit composition across projection, ledger, outbox and notification; immutable workflow versions pinned by each request; the generated RLS catalogue test; server-computed `permitted_actions`; `through` markers for hidden positions.
- **04:** the pure solver with stored input hash and solver version; the deferrable exclusion covering both visits and holds; rebase on the affected subset with dropped-move reasons; the policy inventory table; positions allocated under the commit lock.
- **05:** the xid-ordered watermark replay with an oracle that distinguishes transaction-start order from commit order; lease epochs on the database clock with a fence before the send; offline replay that compares preconditions rather than versions; the fault controller's allow-list and refusal tests; canonical audit bytes with fixed offsets; the two-step owner console with timeouts.
- **06:** domain-tagged, length-prefixed commitments checked on reveal; conflict of interest as an insert predicate tested with raw SQL and a mutated handler; audit payloads stored as the exact hashed text; the sealed-count guard on the officer's transitions; the zero-request offline verifier with its provenance limit stated.

## Cross-cutting observations for whichever design is chosen

- Every design that relies on a database role boundary must name the roles, the grants and the setter, and test the setter. Five of six proposals still describe a boundary the application role can cross.
- Every design that claims a superuser or owner tamper must name the grant it uses. Two proposals (03 and 04) name a mechanism that does not match the platform.
- Verifiers must define their gap rule for identity-allocated sequences, and must enumerate external anchors rather than read anchor rows the adversary can edit.
- Anchors and checkpoints need a stated lag and a stated storage bound.
- Ordering claims are now correct across the set. The remaining risk is the wording of "commit order" versus "transaction-start order" in the stage text, which 05 handles and others should copy.
