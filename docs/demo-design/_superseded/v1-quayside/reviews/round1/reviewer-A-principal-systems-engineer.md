# Round 1 review: Reviewer A, Principal Systems Engineer

Scope: the mission brief (`docs/demo-design/00-mission.md`) and all six proposals, read in full (01 to 06). Design review only; nothing was built or run. Every finding cites a section or a script timestamp in the proposal it concerns. Scores follow the brief's weights. Weighted totals are the sum of weight times score on the 0 to 10 scale.

## Summary

| Id | Product | Depth (25) | Cohesion (20) | Visual (15) | Credibility (15) | Narrative (10) | Feasibility (10) | Reliability (5) | Weighted | Disqualified |
|---|---|---|---|---|---|---|---|---|---|---|
| 01 | Tallyhouse | 9 | 9 | 6 | 6 | 7 | 5 | 5 | 7.30 | No |
| 02 | Tideline Live | 8 | 8 | 9 | 5 | 8 | 5 | 5 | 7.25 | No |
| 03 | Ledgerwell | 8 | 9 | 7 | 6 | 8 | 6 | 6 | 7.45 | No |
| 04 | Quayside | 8 | 8 | 7 | 5 | 8 | 6 | 5 | 7.05 | No |
| 05 | Culvert | 9 | 8 | 7 | 5 | 8 | 6 | 5 | 7.30 | No |
| 06 | Sealroom | 7 | 7 | 6 | 6 | 9 | 6 | 6 | 6.75 | No |

No proposal is disqualified. Each has defects that are specific and fixable, and none rests on functionality that is absent from its design. Several defects would fail a live check by an expert in the audience, and they are listed with the required changes.

---

## 01 Tallyhouse (Systems Complexity)

### Scores

| Criterion | Score | Justification |
|---|---|---|
| Depth (25%) | 9 | Auction-row lock as the sequencing decision, in-transaction NOTIFY with replay by sequence, saga steps keyed in the effect's own transaction and a deferred ledger balance constraint are all specified to implementable depth. |
| Cohesion (20%) | 9 | One lock and one event log feed the bid, the stream, the saga, the ledger and the audit, so every visible moment has a single mechanism behind it. |
| Visual (15%) | 6 | Four role panels, a step plot and terminal-led scenes; strong for engineers, but not spectacle. |
| Credibility (15%) | 6 | Secrecy depends on a settable session variable, the event log is not in the audit chain, the counter-bid arithmetic is wrong and the fault mechanism is misdescribed for ECS. |
| Narrative (10%) | 7 | The arc from proxy war to kill to proof is clear, but the 300 s script packs many numbered panels and its counts contradict each other. |
| Feasibility (10%) | 5 | Go, PostgreSQL semantics, SQS FIFO, a saga, a ledger, a hash chain, RLS, Terraform and a browser rehearsal, all with dependencies that are correctly ordered but very wide. |
| Reliability (5%) | 5 | Several scenes depend on contested outcomes, a 60 s armed transaction and manual deadline overrides in the operator console. |

### Strongest ideas

- The auction row lock as the single sequencing decision, with the rejected alternative (`bigserial` holes under out-of-order commit) explained in D.4.
- Replay from `auction_events` by sequence, combined with NOTIFY inside the transaction, so a notification exists only for committed state (D.3, claim 2).
- The settlement step's idempotency key written in the same transaction as its effect, with the split-transaction bug named in G.1 item 3.
- The deferred balance constraint on ledger transactions, with a property test over balanced and unbalanced sets (claim 4).
- The G.4 table of shallow features, which is the most candid failure analysis in the set and makes the rest of the claims easier to trust.

### Concrete weaknesses, most severe first

1. **Proxy secrecy relies on a settable session variable (D.2 `proxy_bids`, D.5).** Visibility of `proxy_bids` is decided by `app.role`, and the bid engine sets `app.role = 'engine'` with `SET LOCAL`. A custom GUC can be set by any session that holds the application role, so any handler that is injected or buggy can read every maximum. D.5 concedes the in-process case, but the real failure is wider: the secrecy claim is only as strong as every handler's use of `SET LOCAL`. The engine needs its own database role, with its own connection pool and grants, or a `SECURITY DEFINER` function that returns only the resolution result.
2. **Hidden maxima can leak through paths the test does not cover.** `TestPublicStateOmitsMaxima` checks only the public state endpoint (claim 4). The WebSocket frames, the replay endpoint, `auction_events.payload` and `audit_log.body` are not in the test, and `audit_log` records "every event from (2)", which is where proxy resolution happens. An audit body containing a maximum would be readable by the auditor role, which the brief says must not read maxima. The test has to cover every read path.
3. **The closing claim contradicts the threat model (270 to 300 s, G.4).** The closing line says "The record cannot be edited without a visible break." G.4 says anyone with write access to `audit_head` and `audit_log` can rewrite history, and that the chain detects naive edits only. Both cannot be presented on stage as the same claim.
4. **`auction_events` is outside the audit chain.** It is the source of truth (D.2) and it has no hash column. The tamper scene edits a copy of `audit_log`, not the event log. The "prove it" rebuild (check c) compares a fold of the same stored events with the live projection, so an edit to `auction_events` together with the projection passes it. Check (c) validates the two implementations of the bid rules against each other, not the authenticity of the events.
5. **Counter-bid arithmetic is wrong (45 to 60 s).** Joon bids 2,500 against Mara's proxy at a 50 increment. The counter-bid is 2,550 (2,500 + 50), not 2,600 as written. An expert will check this figure first.
6. **Scene counts contradict each other.** The header reads "committed seq 412" at 0 to 15 s. The invariant check at 100 to 115 s reports "events 1 to N, N = 226". Joon's socket resumes at "last seq 4611" at 115 to 135 s, and a 25-bid burst then commits 4612 to 4636. A 180-request burst with 14 replays cannot produce about 4,200 events. The 25-bid burst is also described as "25 accepted", although competing bids produce refusals, so the count is a measured result and must not be scripted.
7. **The countdown does not match the seed (C 135 to 180 s).** D and the seed set `ends_at` to 6 minutes after reset. The script shows 00:04 at about 135 s into the run and then an operator "Force close in 2 s" that rewrites the deadline. The clock claim ("the database clock says so") holds only when the operator path is not used, and the proposal does not say that.
8. **Relay ordering and partial batch failure (D.3).** The relay snippet runs `UPDATE outbox SET sent_at = now() WHERE id = ANY($1)` after `SendMessageBatch`. `SendMessageBatch` reports per-entry `Failed` results, and the snippet marks failed entries as sent, so they are lost. D.1 makes the relay a singleton behind an advisory lock, while D.3 uses `FOR UPDATE SKIP LOCKED`, which lets two relays send batches for the same message group out of order. The design must pick one and state it.
9. **Fault mechanism misdescribed (235 to 262 s, E.2).** The script says the kill is "a real SIGKILL ... ECS StopTask with the KILL reason". `StopTask` takes a free-text reason and ECS sends SIGTERM, then SIGKILL after the configured stop timeout. E.2 calls the two platforms equivalent, "same resulting SIGKILL". A worker that handles SIGTERM can finish or roll back its held transaction before the kill, so the scene's behaviour is not guaranteed on ECS.
10. **The notifier "duplicate skipped" line is not produced by the scene (240 to 256 s).** Stopping a notifier with two messages queued and restarting it produces no duplicate. The dedupe row is said to be written "in the same transaction as the send record", which cannot cover an external SMTP or SES send. SES does not deduplicate on a `Message-ID` header either. Either a duplicate is injected by a fault hook, or the line is removed.
11. **The visibility timeout and the armed fault window are not reconciled.** The visibility timeout is 15 s and the armed hold is up to 60 s, so the message becomes visible while the first worker is still in step 3. G.1 item 4 covers this, but the script (215 to 240 s) describes redelivery as happening only after the kill.
12. **Subscription handoff is not specified (D.3).** A client subscribes with `after=N`, and the server must replay and then switch to live pushes. The design does not say how live frames committed during replay are ordered against replayed frames.

### Required changes

- Move the engine's read of `proxy_bids` to a separate database role or a `SECURITY DEFINER` function. Remove `app.role` as a trust input for that table, and add a test that the application role cannot read another bidder's rows after issuing `SET app.role`.
- Extend the maxima tests to every read path: REST, WebSocket frames, replay, `auction_events` payloads and `audit_log` bodies.
- Either hash `auction_events` into the chain and tamper it in the scene, or state that the chain covers only `audit_log`, and change the closing line to match G.4.
- Correct the counter-bid to 2,550 and fix the seed so `committed seq`, the invariant count, the resume position and the burst counts agree. Make the accepted count of the 25-bid burst a displayed measurement.
- Recompute the countdown from the seed, or state that the operator deadline override is part of the demo, and remove the claim that the database clock is the only authority in that scene.
- Fix the relay to handle `Failed` entries explicitly, and make the relay a single-leader loop with ordering stated.
- Replace the ECS StopTask description with the actual mechanism (for example, a signal sent in the container, or a fault sidecar), and state what happens to a worker that receives SIGTERM first.
- Remove the duplicate line or add a fault hook that creates a real duplicate, and state the real effectively-once boundary.
- Specify the replay-then-live handoff for subscriptions.

---

## 02 Tideline Live (Visual Spectacle)

### Scores

| Criterion | Score | Justification |
|---|---|---|
| Depth (25%) | 8 | The serialized bid path, stored-response idempotency, Cedar with policy identifiers and the versioned ladder are real; the close path and the proxy ceiling are under-specified. |
| Cohesion (20%) | 8 | One transaction covers authorization, ladder, proxy, events, outbox and notify, and the Floor is a projection of the same event stream. |
| Visual (15%) | 9 | The strongest visual language in the set (ring, ladder, ticks, gavel), with every element tied to a real event. |
| Credibility (15%) | 5 | The ladder arithmetic in 140 to 196 s is internally inconsistent, the ring extension rule does not give the stated extension, and the duplicate-suppression line cannot be reached by the scene. |
| Narrative (10%) | 8 | One clear beat per role and a strong closing sequence in which a superuser's edit is named by sequence number. |
| Feasibility (10%) | 5 | Rust, Cedar, OpenTelemetry tracing, Keycloak and Cognito parity, Object Lock, SES and Framer Motion, with a wide parity surface. |
| Reliability (5%) | 5 | Counts depend on race outcomes, the ring depends on timing, and the flaky-network toggle is a scripted fault in a live path. |

### Strongest ideas

- Per-auction `auction_seq` assigned under the auction lock, with the argument that commit order and sequence order then coincide (D.4). This is the cleanest statement of the replay property in the set.
- Idempotent commands that store the serialized response in the same transaction as the effect, including the proxy counter-bid (G.3). This is the correct answer to the response-loss case.
- Rejection messages that cite the ladder version and the policy identifier that denied a request (C 60 to 80 s, D.5).
- One redaction function applied to both the query path and the realtime path, unit-tested per audience (D.5).
- The G.4 list of shallow features, including the honest statement about the single-account anchor.

### Concrete weaknesses, most severe first

1. **The ladder breaks between 140 and 196 s.** At 140 to 160 s Ben's 4,500 is accepted, and the proxy rule in capability 5 and D.4 says Ana's proxy (max 6,000) must counter inside the same transaction, with a bid at 4,600. The script never shows that counter. At 180 to 196 s Ben bids 4,500 again, which is below the minimum of 4,700 and must be refused with `BID_BELOW_MINIMUM`. The climax depends on a bid that the rules forbid.
2. **The ring extension does not match the rule (180 to 196 s).** The rule is `close_at = greatest(close_at, now() + window)`, applied when the remaining time is under the window. With a 10 s window, a bid at 9.5 s remaining moves the close to 10 s from now, which is 0.5 s of extension. The script says the ring "grows by about 10 seconds". The rule as written does not produce that, so either the rule or the sentence changes.
3. **The "duplicate skipped" line is not reachable (240 to 256 s).** Stop, then restart, with two messages queued does not produce a duplicate delivery. The "idempotent by the `message_id` header in the Mailpit path" statement is false for Mailpit, and SES does not deduplicate on that header either. G.2 names the residual window correctly, but the scene asserts a mechanism that does not exist.
4. **The close path's lock order is not specified.** D.4 requires sequencing under the auction row lock, with the order auction, then lot. D.3 and D.4 describe the clock worker as claiming lots with `SKIP LOCKED` on the lot row. If that worker does not take the auction lock first, it can race `next_seq`. If it takes the lot first, it can deadlock with a bid that takes auction then lot. The clock worker needs the same order rule as the bid path, and a test for it.
5. **Proxy ceilings leak through bidding dynamics.** An observer can infer a proxy's ceiling from where its counter-bids stop, and "Bidder 3" is a pseudonym whose derivation is not defined. The claim that a maximum "never leaves the server" must be stated with that caveat, and pseudonyms must be specified as stable and non-derivable.
6. **Redaction is tested for the projection, not for the audit and event paths.** The "reserve met" flag, the audit bodies and the event payloads for proxy and absentee bids need the same check as the frames.
7. **The network-flap moment is a scripted fault in a live path (80 to 100 s).** The "Flaky network" toggle drops the response after commit, so the script depends on the client implementation. This is acceptable as a demonstration of idempotency, but it must be a labelled fault with an assertion on the stored response.
8. **Rust is unpinned.** The toolchain is "Rust 1.8x stable". The images are pinned by digest, but the build is not pinned to a toolchain version, which weakens the reproducibility claim in E.1.
9. **The feasibility surface is very wide.** Keycloak and Cognito must produce identical authorization decisions (contract test), Object Lock is run on MinIO and S3, SES sandbox identities are required, and the trace goes to Jaeger and X-Ray. Each has a documented difference, but the number of differences is the risk.
10. **The anchor is in the same AWS account (G.4).** The text says so in the first paragraph of the audit section, and the verifier names the account. The on-stage phrasing "could not rewrite in retention" should be scoped to the database owner, which is the threat the demo tests.

### Required changes

- Rewrite 120 to 206 s so that Ana's proxy counters Ben's 4,500 at 4,600 in the same transaction, and remove or change Ben's 4,500 bid in the final-seconds scene so that it satisfies the ladder.
- Fix the extension text or the formula so that the displayed extension is what the rule produces.
- Replace the duplicate line with a real duplicate created by a labelled fault hook, or remove it, and state the at-least-once boundary in the notifier section.
- Specify the clock worker's lock order to match the bid path, and add a test that close and bid run in both interleavings.
- Specify the pseudonym scheme and state the counter-bid ceiling caveat in D.5.
- Extend the redaction tests to audit bodies, event payloads and the reserve-met flag.
- Pin the Rust toolchain version.

---

## 03 Ledgerwell (Enterprise Platform)

### Scores

| Criterion | Score | Justification |
|---|---|---|
| Depth (25%) | 8 | One-commit composition, pinned workflow versions enforced by trigger, a generated RLS catalogue test and a cross-language canonical-vector file are concrete; stream semantics under filtering are not. |
| Cohesion (20%) | 9 | Every visible moment is a consequence of the same ledger commit, which is the strongest composition in the set. |
| Visual (15%) | 7 | Four windows with a budget card, trace panels and a banner; much of it is administrative, as the proposal itself warns (G, risk 4). |
| Credibility (15%) | 6 | The tamper is self-inflicted by the application's drill, the auditor starts it, explain traces are hypothetical, and filtered streams break the gap check. |
| Narrative (10%) | 8 | The budget arithmetic is exact and the race and banner beats land; the drill beat needs honest framing to avoid looking staged. |
| Feasibility (10%) | 6 | Go, a restricted CEL subset with two evaluators, five CDK stacks and Dex and Cognito parity, with ordered and independently testable layers. |
| Reliability (5%) | 6 | A barrier-driven race, cursor checks before each section and rehearsed slow-job fallbacks; the stream-filtering defect would surface on stage. |

### Strongest ideas

- One transaction for submission, which writes the reservation, request, ledger event, outbox row and idempotency record together, with the `CHECK` constraint as a backstop (C 30 to 40 s, D).
- Workflow versions are immutable once published (trigger-enforced) and each request pins the version it started under (D4). This makes "which rules applied" a fact in the record.
- The generated RLS catalogue test (F1) that fails the build when a tenant table has no policy.
- The UI and server matrix (F5) that compares decisions for every role and state combination.
- The explicit out-of-scope list and the shallow-feature list (G).

### Concrete weaknesses, most severe first

1. **Filtered streams make the gap check wrong (D.3, consistency table, F4).** The stream is filtered per event by `Decide()`, so a viewer receives only some ledger sequence numbers. The consistency table then requires a "client-side contiguity check" and gap detection. A requester would see gaps in almost every event, and the client cannot tell a hidden event from a lost one. F4's claim "every event it is permitted to see, exactly once and in order" needs a defined per-viewer cursor, or skip markers that the server sends for hidden positions.
2. **The tamper is the application's own fault, not an external one (C 215 to 245 s, G item 7).** The drill runs inside the product, under a forensics role, and disables the trigger from inside the application process. The detection therefore shows the application detecting a fault it was asked to create. The audience can see that this is a designed fault, which weakens the claim that the system defends the record against people who have database access.
3. **The "logged" evidence is writable by the same role (D.2 `ops_log`).** The drill's evidence is in `ops_log`, which sits outside the chain, and the forensics role writes it. A role that can change the ledger can also change or delete the log of its own change. "Logged maintenance" therefore has no integrity.
4. **The role contradicts itself (A table, C 215 to 245 s).** Tom is the internal auditor, described as read-only, and he starts the break-glass drill that rewrites a ledger row. The approval is dual control between Ines and Tom, but the initiating role has write authority that the role table denies.
5. **The "Explain" traces are not stored evaluations (C 65 to 95 s, D.5, G).** At 65 to 95 s Dev and Maya ask for explanations of approve actions that were not attempted. `decisions` records only mutations and denials of mutations. The trace is therefore a recomputation, which G (last section) calls shallow, and F5 claims the trace is the stored evaluation. One of the two statements has to change.
6. **Lock order is not stated across submit, approve and verify.** Submission takes the allocation row and then the chain head. Approval reads the budget through the CEL guard and then appends to the chain. Verification runs a long `REPEATABLE READ` read on the writer. The product's own rules require a stated lock order (Tideline does this), and this design has none. A deadlock between submit and approve is a plausible failure.
7. **Verification's transaction semantics are contradictory (D.6, C 185 to 215 s).** Verification is "a single `REPEATABLE READ` read-only transaction", and its completion "publishes an `integrity.checked` event". That event is a write, so it must be a second transaction, and by then the head may have moved. The result has to name the head it checked and the head it appended after.
8. **The RLS text does not match the policy text (D.5, G item 5).** The policy uses `current_setting('app.tenant_id')::uuid` without `missing_ok`, so an unset setting raises an error. The text says a missing setting "matches no row". The result is still fail-closed, but an expert will read the policy and the prose and see the difference.
9. **The hash input uses an undefined canonical form (D.2).** `hash = SHA-256(prev_hash || payload_hash || canonical(type, aggregate_id, actor_id, seq, occurred_at))`. The payload is RFC 8785, but the outer fields have no defined encoding, and `timestamptz` text depends on session time zone and date style unless the application formats it.
10. **Money semantics are not defined on approval (C 140 to 160 s).** The encumbrance is never released or converted to spent when a request is approved, so the budget card after approval is not specified. Experts will ask where the money goes.
11. **The browser evaluator and stale bindings (F5, G item 6).** The UI and server "cannot disagree" only if the browser evaluates against the same role bindings and workflow version. The proposal tests the evaluators against a corpus but does not test the case where bindings change between the page load and the click.
12. **Small numeric inconsistency.** The submission event is 1,838, the seed is "about 1,840 events at the demo start", and the verifier reports "1,840 events verified" after two more events have been appended.

### Required changes

- Define the stream's per-viewer cursor (skip markers or a per-viewer sequence) and rewrite F4 and the consistency table to match.
- Reframe the drill as an explicit fault injection run by a documented operator script outside the application, or make the drill's evidence part of the chain and anchor it.
- Give drill initiation to a role that can write, not to the auditor, or change Tom's role in the table.
- Store an evaluation for every explain request, or state that explain is recomputed and remove it from F5.
- Publish one global lock order for submit, approve, reject, verify and drill, and add a deadlock test for submit against approve.
- Split verification into a read transaction that names its head and a separate write for `integrity.checked`.
- Correct the RLS prose or the policy so they agree.
- Define the canonical encoding of the outer hash fields.
- Define the budget effect of approval and rejection.

---

## 04 Quayside (Emergent Composition)

### Scores

| Criterion | Score | Justification |
|---|---|---|
| Depth (25%) | 8 | Per-stream chains, a deferrable exclusion constraint, a pure solver with input hash and solver version, and rebase by re-solving the affected subset are concrete; ordering and anchoring are not. |
| Cohesion (20%) | 8 | A small set of primitives produces each beat, although authorization coverage is partial. |
| Visual (15%) | 7 | Gantt with ghost proposals and a trace waterfall; the proposal calls the Gantt the least technical part. |
| Credibility (15%) | 5 | The "in `global_pos` order" claim contradicts its own out-of-order analysis, and "detects any change" is claimed with no external anchor. |
| Narrative (10%) | 8 | The contention beat across three windows is clear, and the "every claim is a span" close is strong. |
| Feasibility (10%) | 6 | Ten layers with explicit dependencies, using Cedar, Postgres exclusion constraints and NOTIFY, all of which are standard. |
| Reliability (5%) | 5 | Cross-replica NOTIFY across the load balancer and the managed database is unproven until an early spike; solver and rebase outcomes vary by run. |

### Strongest ideas

- A solver that is a pure function over a snapshot, with `input_hash` and `solver_version` stored on the proposal, so a replay on a different build reports a version mismatch instead of a silent difference (G, solver reproducibility).
- A deferrable exclusion constraint on `slots` as the database's own no-double-booking guarantee, with half-open spans and boundary tests (H, hidden complexity).
- Rebase that re-solves only the moves whose berths changed, and reports dropped moves with reasons (6b).
- Per-stream hash chains so that verification is parallel, and so that berths commit independently (D.2).
- Single-sourced authorization through a capabilities endpoint that the server re-checks on submit (3b, F3).

### Concrete weaknesses, most severe first

1. **The ordering claim fails under the concurrency the design exists to handle (D.3, D.6, F4, G item 2).** `global_pos` is an identity value allocated before commit, so two transactions can commit in the opposite order to their positions. G item 2 says that a naive cursor skips a late commit and proposes an overlap window with deduplication. D.3 and the consistency table specify neither, and F4 claims delivery "in `global_pos` order". A client that has already passed position 105 never receives 104 unless it reconnects. The reducer is a fold and is order-sensitive, so applying events out of order can produce a wrong plan.
2. **"Detects any change to an event" needs an external anchor, and there is none (D.6, C 240 to 270 s, G).** Per-stream chains can be recomputed stream by stream by a superuser. The demo's tamper is detected only because it is naive, and the proposal's own section G says the verifier "detects tampering; it does not prevent a superuser." The consistency table says more than that. Tideline, Culvert and Sealroom each anchor their chain externally, so this is a visible gap.
3. **Row-level security covers two tables, and the others carry carrier-scoped data (D.5 item 4).** RLS is specified only for `visits` and `slots`. `events` carries payloads for other carriers' visits, `proposals` holds `moves` that name other carriers' visits, `snapshots` store the whole plan state, and `notifications`, `outbox` and `decisions` have no stated policy. Replay and time-travel filter in application code, using Cedar per row, and the proposal says the RLS layer is "defence in depth" for those paths. The brief's claim "other carriers' visits are not visible to her, not merely greyed out" is therefore not enforced below the application for most tables.
4. **Berth occupancy reveals other carriers' use of the berth (A, C 0 to 30 s).** `slots` holds the berth and the span of every visit. A carrier window that shows the six-berth Gantt for 72 hours displays other carriers' occupancy by time, even with the visit identity removed. The Gantt and the policy must say what a carrier sees for another carrier's slot.
5. **Gap detection cannot tell hidden from missing (C 150 to 180 s, F4).** Replay is filtered per carrier, and the status line reports "applied 7 events (2 visible to Northwind)". The cursor semantics for hidden positions are not defined, so the same defect as in 03 applies.
6. **The canonical hash is computed over `jsonb` (D.2).** `events.payload` is `jsonb`, and the hash is over `canonical(event)`, which is not stored in any column. `jsonb` does not preserve the bytes that were hashed (key order, numeric text, duplicate keys), and the verifier re-derives from `jsonb`. The proposal rightly stores canonical text for other designs, and this one does not.
7. **The forecast worker has no principal (D.5, C 180 to 210 s).** The Cedar principal types are `Planner`, `Harbourmaster`, `CarrierAgent` and `Auditor`. The worker creates proposals "through the same command path as the planner", so the decision record for those proposals names a principal that the policy does not define. A system principal needs its own policy entry and its own `decisions` row.
8. **Snapshots are trusted without a hash link (G item 4).** Snapshots are written asynchronously by the worker and used as the starting point for time-travel. The verifier checks them against replay only when it is run, and the demo's historical view at 14:02 starts from one.
9. **The tamper target may not exist (C 240 to 270 s).** The DBA edit changes a berth 5 event from draft 13.2 to 12.9. The move that would have put a 13.2 m draft on berth 5 was refused at 30 to 60 s, so no accepted berth 5 event with that draft should exist. The script must name the event it edits, and that event must be an accepted one.
10. **Hold semantics are not stated.** A hold is "the same path as a single-move proposal", but the exclusion constraint is on `slots`. If a hold is not a slot, two overlapping holds on one berth are not prevented by the database.

### Required changes

- Choose one of the watermark, overlap-with-deduplication or in-order commit protocols, specify it in D.3 and in the consistency table, and make the reducer's required application order explicit.
- Either anchor stream heads externally, as the other designs do, or narrow the claim to "detects naive edits".
- Publish a policy inventory with a row for every table and every read path (replay, snapshot, time-travel, Gantt, outbox), and state what each carrier role sees for another carrier's slot.
- Store canonical bytes or canonical text for each event and hash those.
- Define a system principal, with Cedar policy entries and decision records, for the worker.
- Name the tamper target event in the script and make it an accepted one.
- State whether holds are slots, and enforce the holds' exclusion in the database if they are.

---

## 05 Culvert (Live Operational Resilience)

### Scores

| Criterion | Score | Justification |
|---|---|---|
| Depth (25%) | 9 | Transaction-identifier watermark replay, lease fencing on the database clock, precondition-based offline replay and canonical bytes stored for the audit chain are specified at implementation depth. |
| Cohesion (20%) | 8 | Authorization, replay, outbox and audit interlock well, but the regional scoping contradicts the script's first act. |
| Visual (15%) | 7 | Health strip, offline queue, chain strip and an ops palette; less spectacle than 02 but well matched to the mandate. |
| Credibility (15%) | 5 | The "commit-ordered" claim is false for transaction-identifier order, a denied-read audit cannot be produced under RLS, a demo actor acts outside its region, and a membership key is defective. |
| Narrative (10%) | 8 | The kill, repair and tamper arc is strong, and the offline replay is a clear middle beat. |
| Feasibility (10%) | 6 | Go, Postgres, Terraform, Traefik, Dex and Cognito, a PWA service worker and offline emulation, in 13 dependency-ordered steps. |
| Reliability (5%) | 5 | The kill timing depends on a 10 s lease and a 20 s hold, the replacement task has a variable start, and the offline emulation has to match the presenter's setup. |

### Strongest ideas

- Replay on a transaction-identifier watermark with `pg_snapshot_xmin`, so no later commit can slip below a delivered cursor (D.4). The gap-freedom argument is correct, and it is the piece to keep after the wording is fixed.
- Lease claims with an epoch, the database `now()` as the only clock, and a fence check before send (D.6). The partial-fence limit is stated honestly.
- Offline replay that compares preconditions (`base_status`, `base_crew_id`) instead of the version, so an unrelated edit does not cause a false conflict (D.6).
- A fault controller with a narrow allow-list, and tests that assert refusal for untagged containers and arbitrary starts (G item 9).
- Canonical audit bytes stored as bytes, with the reason given (D.2 notes).

### Concrete weaknesses, most severe first

1. **Sam acts outside his region in the opening scenes (A table, C 25 to 175 s).** Sam is the South-region dispatcher. The policy in D.2 lets a dispatcher see and write only orders in the dispatcher's region. Yet at 25 to 55 s the North order "appears on Sam's board", at 120 to 145 s Sam closes a North order, and at 145 to 175 s Sam reassigns it. Under the policy each of those writes updates zero rows. The demo either changes Sam's role to global, or shows the denial. As written it contradicts the claim in Claim 3 that the demo runs on the policy.
2. **"Commit-ordered" is not what the design delivers (D.4, claim 1).** Events are ordered by `(xid, seq)`, and `xid` is assigned at the transaction's first write, not at commit. A slow writer whose transaction started first and commits last precedes later-started transactions in the stream, so the order is transaction-start order among committed transactions. The claim "in commit order" is false, and the test oracle in claim 1 uses the same `(xid, seq)` order, so the test cannot detect the difference. The gap-freedom argument survives; the ordering wording and the oracle must change.
3. **A denied read cannot be audited as `read.denied` under RLS (C 55 to 85 s, D.5, claim 3).** Under RLS the row is absent from the result, so the API returns `404` because it cannot see the row. Writing a `read.denied` audit row needs an existence check that bypasses RLS, and the application role cannot run one. The same applies to "rows visible: 3 of 412", which needs an unfiltered count. The design needs a `SECURITY DEFINER` existence check that returns only a boolean, or the claim has to go.
4. **The membership key is defective (D.2).** `memberships` has `primary key (user_sub, role, region_id)` with `region_id` nullable, and the text says `region_id` is null for auditors and operators. PostgreSQL does not allow nulls in a primary key, so auditor and operator rows cannot be inserted. The `memberships` table also has no stated policy, while the `work_orders` policy reads it under the application role.
5. **The conflict response cannot carry the current state the technician needs (C 175 to 205 s, D.6).** After Sam reassigns the order to Crew 4, Rafi's row-level view does not include the order. The `409 precondition_failed` response is supposed to return the current state, and the conflicts inbox offers "hand back to dispatcher", which needs order data Rafi cannot see. The response has to say "reassigned, not visible to you" and return only what the viewer may see.
6. **The principal is a settable session variable (D.2, claim 3).** `app.principal` is set with `set_config` and is readable and settable by the application role. RLS therefore guards against accidental omissions, not against a handler or injected query that sets another subject. Claim 3's test sets and unsets the value but does not test that the application role cannot set someone else's subject. The claim should be bounded to accidental omission, and the test should cover the setter.
7. **Only one RLS policy is written out (D.2).** `events`, `audit_events`, `outbox` and `notifications` have no stated policy. The SSE replay "runs under the subscriber's principal", and `events` carries order payloads, so the replay's correctness depends on policies that are not in the document.
8. **The kill semantics are described as identical on both platforms (E table, C 205 to 250 s).** ECS `StopTask` sends SIGTERM and then SIGKILL after the stop timeout. Compose's `docker kill` sends the signal named. The table says "SIGKILL, no graceful drain" on both. A worker that drains on SIGTERM behaves differently on ECS.
9. **One visible effect per outbox row is not guaranteed by the fence (C 230 to 250 s, claim 5).** The fence checks the epoch before the send, not during it. A worker that stalls between the check and the send produces a second message. The text acknowledges this, but the capability table's "single effect for the audience" and claim 5's "duplicates only at kill-after-send-before-commit" are stronger than the design.
10. **The closing line promises a check that is not in the script (C 270 to 300 s).** "The same verifier in the AWS environment, its result string identical" is not shown: no AWS tamper step appears in the script. On stage it is a claim with no evidence.

### Required changes

- Make Sam's role and region consistent with the script. Either make him a global dispatcher, or show his write to a North order being denied, with the audit row that records it.
- Replace "commit-ordered" with the actual ordering the design delivers, and change the test oracle so that it can detect a difference between transaction-start order and commit order if the design claims commit order. Alternatively, implement a commit-order watermark and keep the claim.
- Add a `SECURITY DEFINER` existence check for the denied-read audit and for the visible count, and state that these are the only privileged reads.
- Fix the `memberships` key (a surrogate key with a unique constraint over the nullable scope), and give `memberships` a stated policy.
- Specify the conflict response for rows the viewer can no longer see.
- Bound Claim 3 to accidental omission, and test that the application role cannot set another subject.
- Write out the policies for `events`, `audit_events`, `outbox` and `notifications`.
- Describe the ECS signal path accurately, and state what a SIGTERM-draining worker does in the fault scene.
- Remove the AWS closing line or add the AWS step to the script.

---

## 06 Sealroom (Unconventional Innovation)

### Scores

| Criterion | Score | Justification |
|---|---|---|
| Depth (25%) | 7 | The commitment encoding, server re-check, conflict-of-interest enforcement in the insert policy and external anchoring are sound and specified, but the reveal and audit paths leak. |
| Cohesion (20%) | 7 | Sealing, anchoring and verification interlock, but a round-level state machine does not fit a per-proposal script. |
| Visual (15%) | 6 | Four windows and a single-file verifier; the synchronized-window beat is good but the surface is thin. |
| Credibility (15%) | 6 | The headline "nobody can read a score" is contradicted by plaintext reveal storage and by audit payloads, and the anchor timing is undefined. |
| Narrative (10%) | 9 | The best narrative in the set: a verifier passes, the attack is internally consistent, and an external anchor fails in four windows at once. |
| Feasibility (10%) | 6 | Node, WebCrypto, Fastify, CDK, six adapters with contract tests; the parity suite is named as the largest part of the effort. |
| Reliability (5%) | 6 | The reveal sequence is deterministic, but the climax depends on the worker's schedule and on anchor freshness. |

### Strongest ideas

- Length-prefixed, domain-tagged commitments with a 256-bit nonce, re-checked on the server with a constant-time compare, and pre-checked in the browser (D.3, claim 1). The binding and hiding roles are explained correctly.
- Conflict of interest enforced as a row-level insert predicate, tested with raw SQL that bypasses the handlers, plus a mutated-handler test (claim 2). This is the right test for "a direct API call cannot bypass it".
- Audit payloads stored as the exact text that was hashed (C7, D.2). This is the same correct answer as in 01 and 05.
- The external anchor as the climax, with the owner's rewrite passing the internal check and failing the external one (C 255 to 300 s). This is the best use of a stronger adversary in the set.
- An offline verifier that makes zero requests, tested under `file://` (G.3).

### Concrete weaknesses, most severe first

1. **Scores are readable before the round closes, by the officer and by the owner (D.2, C 170 to 215 s, claim 1).** `revealed_score` is plaintext in `score_commitments` from the moment each reviewer reveals. `score_view` returns it to the officer at any time. The database owner bypasses RLS and reads it directly. The headline "nobody, including the database owner, can read a score until every assigned reviewer has sealed one and revealed it" is therefore false for the first revealer, and for the officer at any point after a reveal.
2. **The audit log and the round events carry scores (C 255 to 275 s, C7, D.2).** The script edits "the P-3 reveal event's payload from median 7 to median 5", so reveal events contain scores. The auditor reads `audit_events` in full, and `round_events` stores `reveal_public` payloads. Both are readable before closure, and neither is covered by the claim tests, which cover the score table and the write path only.
3. **The round state cannot express per-proposal completion (D.2, D.6, C 140 to 170 s).** `rounds.state` is round-wide, with one transition from `committing` to `revealing`. The script moves P-3 to "Reveal open" when four reviewers have sealed it, but the other five proposals have no commitments in that scene. The schema cannot represent the script, and a round-level rule would not fire at that point.
4. **"No window updates before the others" does not hold for reveals (C 190 to 215 s, D.4).** Reveals arrive one at a time, and each reveal writes its own event with a visibility class. Only the final close is a single snapshot. The claim should be about the close, or the reveals should be hidden until close.
5. **The officer can move the round without a rule (A table, D.5, D.6).** The officer "moves the round through its states". The design does not say that a move to `revealing` requires every assigned reviewer to have sealed. An officer who moves early excludes reviewers' commitments without any record of a rule that allowed it. The same gap applies to reveals in `committing` when a deadline is set, which D.5 permits: an early reveal exposes a score before the other commitments are in.
6. **There is no rule for a reviewer who never reveals.** The round closes "when the last expected reveal lands". `reveal_deadline` exists, and C12 says the sweeper applies "the guarded transition", but nothing says what happens to unrevealed commitments at the deadline. A grant panel needs that rule to be stated, and it decides whether a single absent reviewer can block closure.
7. **The anchor timing decides the climax, and the interval is not stated (C 275 to 300 s, D.6).** The integrity check that finds the mismatch runs "on its next run". The interval is not given, so the stage moment depends on a schedule the script does not control. The `anchor_stale` precondition is described in G.2 but not in the script.
8. **Gap recovery can stall silently (D.4).** A gap is detected only when a later frame arrives. If the lost frame is the last one in a burst, such as the round close, the client has no later frame to trigger the check and stays stale. The design also has no event-replay endpoint: "a gap triggers a snapshot fetch and a resubscribe from the snapshot's sequence" leaves a window between the snapshot read and the subscription in which events can be lost.
9. **The email consumer's exactly-once statement needs an ordering that is not given (claim 4c).** The consumer records `consumed_messages` and sends an email. If it records first and then sends, a crash loses the email. If it sends first and then records, a crash after the send duplicates it. The claim "redelivery produces one email" holds only if the send is idempotent at the provider, which SES and Mailpit are not.
10. **Concurrent first writes of the same idempotency key are not described (claim 4a).** Fifty identical requests with one key will race on the insert. The design says the key is written in the same transaction as the effect, but not which transaction claims the key first, or how the other 49 wait for the first to commit and then return its stored response.
11. **The demo seed contains the nonces (C, G.2).** Commitments are "derived from fixed nonces in the seed file", so anyone who has the repository can recompute every demo commitment and score. The blindness claim is then a property of the demo only if the repository is not shared, and the proposal does not say so.
12. **`round_roles` is referenced but not defined (D.2).** Application policies depend on it, and it is absent from the schema.

### Required changes

- Hold revealed scores in a form that the officer, the owner and the auditor cannot read before close, or restate the headline and the claim tests. The restatement must name the officer and the owner.
- Remove score values from audit payloads and round events until close, and add those reads to claim 2's raw-SQL tests.
- Move state to the (round, proposal) pair, or define the round-level transition rule so that the script's scene is representable.
- Guard the officer's transitions by the sealed count, and forbid reveals in `committing`, or state the exposure.
- State the rule for unrevealed commitments at the reveal deadline.
- Fix the anchor interval and make the forced-run step a visible terminal command.
- Add an event-replay endpoint and a heartbeat that carries the latest sequence, so that a silent stall is detected.
- Specify the consumer ordering and remove "one email" unless the provider's idempotency is used.
- Specify which transaction claims an idempotency key first.
- Generate the seed nonces at reset, outside the repository, or label the seed as public.

---

## Cross-cutting defects (present in more than one proposal)

These are worth fixing in the stack regardless of which proposal wins.

1. **Session-variable trust for row-level security (01, 03, 05, 06).** `SET LOCAL` on a custom GUC is correct against forgotten filters, and it is not an access boundary against code that sets the variable. Each design should state that boundary and test the setter.
2. **Gap detection on filtered streams (03, 04).** A per-viewer filter removes positions. The client's gap check must be told what is hidden, or the server must send skip markers.
3. **External side effects are not transactional (01, 02, 05, 06).** No design can make an SMTP or SES send part of a database transaction. Each should name the boundary it actually provides (at-least-once with a stated duplicate window, or at-most-once) and avoid words like "exactly-once" or "dedupe in the same transaction as the send".
4. **Fault signals on ECS (01, 05).** `StopTask` does not deliver SIGKILL by reason. The fault path must be described accurately, and its SIGTERM behaviour stated.
5. **No external anchor (04).** Three designs anchor the chain outside the database; 04 does not, and its verification claim is broader than the mechanism.
6. **Ordering claims versus identity or transaction-identifier allocation (04, 05).** Values allocated before commit do not give commit order. Each design should say which order it delivers and test that order with the oracle that the test uses.

---

## Comparative ranking

Weighted totals from the table above. The ranking is by weighted total. Two pairs are tied or nearly tied, and the tie-breaks are given.

1. **03 Ledgerwell, 7.45.** The strongest composition: one commit produces the projection, the ledger event, the outbox row and the notification, and every visible moment follows from that. Its defects (filtered-stream gap semantics, a self-inflicted drill, the auditor starting the drill, hypothetical explain traces) are structural but fixable without changing the product.
2. **01 Tallyhouse, 7.30.** The deepest concurrency, saga and ledger content, with the most honest failure analysis. It is ranked above 05 because its defects are numerical and mechanical, and its core stage claims hold when corrected. Its secrecy boundary is the weakest technical point in the set.
3. **05 Culvert, 7.30.** The best replay design and the best fencing design, tied with 01 on weighted total. It is ranked third because its opening act contradicts its own authorization model, and because its commit-order claim is false as written.
4. **02 Tideline Live, 7.25.** The best visuals and a strong narrative, with an honest threat model. Its ladder arithmetic and the extension rule would be caught by an expert in the first two minutes of the proxy scene, and the duplicate line is not reachable.
5. **04 Quayside, 7.05.** A coherent set of primitives, with a good solver and a good exclusion constraint. Its ordering claim, its missing anchor and its narrow authorization coverage are the reasons it is ranked fifth.
6. **06 Sealroom, 6.75.** The best narrative and the best external-anchor climax. Its headline claim, blind scoring, is contradicted by its own storage and audit design, and its round-level state does not fit its per-proposal script. These are real, and they go to the centre of the product.

### Ideas worth keeping regardless of who wins

- **01:** the auction-row lock as the sequencing decision with the rejected alternative stated; in-transaction NOTIFY with replay by sequence; the saga step's idempotency key in the effect's transaction; the deferred ledger balance constraint with a property test; the G.4 table of shallow features.
- **02:** the ladder citation in rejections, which names the rule that refused a bid; one redaction function used by both the query and the realtime path; stored-response idempotency that includes the proxy counter-bid.
- **03:** one-commit composition across projection, ledger, outbox and notification; workflow versions pinned by the request and made immutable by trigger; the generated RLS catalogue test that fails when a tenant table has no policy; the UI and server decision matrix; the explicit out-of-scope list.
- **04:** the pure solver with stored input hash and solver version, so a version mismatch is reported rather than hidden; the exclusion constraint for no double booking; rebase that re-solves only the affected subset; per-stream chains for parallel verification.
- **05:** the transaction-identifier watermark replay, once its ordering is stated correctly; lease epochs on the database clock with a fence check before send; offline replay that compares preconditions rather than versions; the fault controller's narrow allow-list with refusal tests; canonical audit bytes stored as bytes.
- **06:** length-prefixed, domain-tagged commitments checked on reveal; conflict of interest as an insert predicate tested with raw SQL; audit payloads stored as the exact hashed text; the external anchor as the stronger-adversary climax; the zero-request offline verifier.
