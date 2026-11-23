# Tideline Live: every bid is a proven transaction

Competitor 02, mandate: Visual Spectacle. Revision 1 of the proposal.

Pitch: Tideline Live is a live auction house in which four browser sessions bid, outbid, snipe and watch one lot close in real time, while every accepted bid is serialized, authorized, traced, settled through a saga and appended to a hash-chained audit log. The same two container images run on a laptop under Compose and on ECS Fargate behind an ALB; the five-minute script ends with a database owner rewriting a sale, the system naming the exact sequence number where the history changed, and, on the AWS run, pointing at a copy of the history that the owner could not rewrite.

---

## Revision log

Reviewer findings are numbered by reviewer (A, B, C). "Fixed" names the section where the change is made. "Rebutted" gives the technical reason the finding does not change the design. "Accepted" records a known limitation that stays in the proposal and is stated where it applies.

| # | Finding | Response | Where |
|---|---|---|---|
| A1 | Ben's 4,500 at 140–160 s should trigger Ana's proxy counter at 4,600, which the old script never showed | Fixed. The bid sequence is rebuilt from the ladder. Ana's counter at 4,600 is shown at 140–160 s, in the same transaction as Ben's bid | C, event ledger |
| A2 | The 180–196 s bid of 4,500 is below the minimum after 4,600 and must be refused | Fixed. The whole timeline is recomputed. Every bid in the script satisfies the minimum-next-bid rule when placed, and the event ledger in C is checked against the rule | C, event ledger |
| A3 | Extension rule `greatest(close_at, now()+window)` gives about 0.5 s for a bid at 9.5 s remaining, not "about 10 seconds" | Fixed. The rule is stated as "inside the window, reset the remaining time to the window". The displayed extension is the actual change in close time (+2 s, +4 s in the script), not the window length | A, B (D.4, C) |
| A4 | "Duplicate skipped" line at 240–256 s is not reachable by stop-and-restart | Fixed. The duplicate is produced by a labelled fault button that re-enqueues an already-sent message_id. The notifier's at-least-once boundary is stated in D.3 and G.2 | C 240–256, D.3, G.2 |
| A5 | Clock worker locks lots with SKIP LOCKED while sequencing needs the auction lock first; a race or deadlock is possible | Fixed. One global lock order (auction, lot, settlement, ledger) applies to every event-appending transaction, including the clock worker and settlement. The clock worker takes the auction lock, then re-checks the lot's state. Two interleavings are tested | D.3, D.4, F claim 4 |
| A6 | Proxy ceiling is inferable from counter stopping points; "Bidder N" has no derivation; "never leaves the server" needs a caveat | Fixed. The pseudonym derivation is specified. The proxy ceiling caveat is stated in D.5 and G.4. The ceiling is described as a lower bound inferred from counter-bids, which is the standard proxy disclosure | D.5, G.4 |
| A7 | Redaction tests cover projection frames only, not audit bodies, event payloads or the reserve-met flag | Fixed. Redaction is tested per (record type, audience) pair across frames, query responses, audit export bodies, event payloads and the reserve-met flag | D.5, F claim 3 |
| A8 | Flaky-network toggle at 80–100 s is a scripted fault in the live path | Fixed as a labelled fault. The fault is a server-side layer, enabled only in demo configuration, that drops one response after commit. The stage asserts the stored response, as the reviewer required. The same layer is used by the claim 2 test | C 80–100, D.1, F claim 2 |
| A9 | Rust toolchain unpinned | Fixed. The toolchain is pinned to an exact release in `rust-toolchain.toml` and in the image build argument | E.1 |
| A10 | Parity surface (Keycloak and Cognito, MinIO and S3, SES, Jaeger and X-Ray) is wide | Partly fixed. The contract suite is narrowed to claim mapping and to a fixed set of authorization decisions. The Jaeger and X-Ray surface is reduced to one query API per environment. Accepted: two identity providers remain, because no local emulator provides the same hosted OIDC flow as Cognito. This is listed in G.4 and H.3 | E.2, F cross-cutting, H.3 |
| B1 | Ladder (step 200 from 5,000) does not contain 6,100, yet 196–206 accepts it | Fixed. The ladder is defined as a minimum next bid, not a grid. The step is the minimum increment from the current price. Any whole-unit amount at or above the minimum is valid, so 6,100 is valid when the minimum is 5,600. Rejections cite the minimum | A (ladder), D.4, C |
| B2 | 160–180 s is a deliberate ~20 s wait against the brief | Fixed. The pause is removed. The timeline has real bids at every interval, and the ring turns amber from server state at 0:10 | C |
| B3 | Flaky-network toggle is a client-side imitation, while claim 2 tests a fault-injecting proxy | Fixed. Both the stage and the claim 2 test use the same in-process demo fault layer. The layer is enabled by configuration in demo deployments only | D.1, F claim 2 |
| B4 | Trace waterfall shows measured spans, but the backend UI (new tab, "collector unavailable") is unspecified | Fixed. The stage uses an in-app waterfall that reads spans from the trace backend's query API. The native UI is opened once in rehearsal to confirm the span tree. The panel shows a pending state while spans are ingested | C 40–60, E.2, G.2 |
| B5 | Notifier "each exactly once" with dedupe in the send transaction overclaims; SMTP and SES effects are outside the transaction | Fixed. Dedupe is a two-phase claim: the message is claimed in one transaction, sent, and marked sent in a second. The claim is at-least-once with a stated duplicate window | D.3, G.2, F claim 5 |
| B6 | Headline tamper is weaker on the local run, where MinIO root can bypass retention, yet the line claims an uneditable checkpoint | Fixed. The finale's anchor step runs on the AWS run only. The local run's panel says "no trust anchor on this run". The stage text names the local trust gap | C 256–300, E.2 |
| B7 | "Same AWS account" trust limit in G.4 is broader than the closing claim | Fixed. The G.4 text is corrected. In S3 Object Lock compliance mode no principal in the account, including root, can overwrite or delete a locked version before its retention date. The limit that remains is that an account administrator can stop the service or close the account, and the verifier reports that it cannot detect this | D.5, G.4 |
| B8 | Apply the email wording change used for proposal 01 | Fixed in wording. The change is applied to every email claim in this document: "delivered once per message in this run; the notifier is at-least-once, and a crash between send and mark-sent can repeat one message". Accepted: the wording was written independently; the other proposal's text was not consulted | C 240–256, D.3, G.2 |
| C1 | Finale depends on an anchor the local run cannot reproduce; the local run is primary | Fixed. The finale (278–300 s) is AWS-only and labelled. The stage run is the AWS run. The local run is the fallback and runs the whole script with the anchor step replaced by an explicit chain-only label. The local audit evidence is labelled chain-only | A (run policy), C 256–300, E.2, G.2 |
| C2 | Ben's 4,500 at 180–196 s is below the leader's 4,600 | Fixed (see A1, A2) | C, event ledger |
| C3 | Countdown beats inconsistent with a 200 s reset deadline; snipe window given as 10 s in one place and generally in another | Fixed. All beats are derived from `close_at`, set by the Open lot command at script second 0. The single parameter is `snipe_window_s = 10`. The amber beat is at `close_at - snipe_window_s` | C, D.4 |
| C4 | Tamper targets event 419, which is a counter-bid; "verified 421 events" does not reconcile | Fixed. The tamper target is resolved by query (the bid_accepted event with amount 6,100), and the event ledger is recounted. The target is seq 429 | C, event ledger |
| C5 | Tamper scene shows only the naive edit; the recomputed-chain case is not shown live | Fixed. The finale shows the naive edit, then the recomputed chain passing in-chain checks, then the anchor failing at the first divergent sequence number | C 266–300, F claim 5 |
| C6 | SES idempotency on a message_id header is not a fact; claim should be at-least-once | Fixed. The claim is at-least-once with a bounded duplicate window (one message per notifier crash between send and mark-sent) | D.3, G.2 |
| C7 | Compliance-mode checkpoints accumulate with no cleanup plan; retention date fixed on screen | Fixed. Retention is a deploy parameter, and the screen reads the retain-until date from object metadata. Expiry is by lifecycle rule. The bucket is retained by the stack. The residual is stated | D.5, E.4, G.4 |
| C8 | Frame-time gate (>50 ms long tasks) is machine-dependent | Fixed. Replaced by state-based assertions: the rendered state and the ring's data attribute match the projection, and the ring's remaining time matches the server-derived remaining time within a stated tolerance | E.3, H.3 |
| C9 | Trace panel opens X-Ray or Jaeger in a new tab, leaving the application | Fixed (see B4) | C 40–60, E.2 |
| C10 | Two identity stacks add parity surface the demo does not need | Partly fixed; see A10. Rebutted in part: Cognito is the AWS identity provider, and a local identity provider is required to run the same authorization path without AWS | E.2, H.3 |
| C11 | Trace propagation through the outbox | Retained as designed; noted as a strength. No change | D.3, G.1 |

---

## A. Product concept

**Application.** Tideline Live runs a timed, multi-lot live auction. An auctioneer opens a lot, which fixes its close deadline from the database clock. Bidders place live, proxy and absentee bids from their own sessions, a clock worker closes the lot when its deadline passes, and a settlement saga turns the sale into ledger entries, an invoice and notifications. A read-only Floor view is designed to be projected on a big screen. An Auditor view verifies the integrity of the event history for each auction.

**Users and roles.**

| Role | Who | What they can see and do |
|---|---|---|
| Bidder | Registered buyer with a deposit hold | Place live, proxy and absentee bids on open lots they are registered for. Sees the current leader's pseudonym, the public ladder state, and their own proxy maximum. |
| Consignor | Seller of a lot | Sees the reserve-met flag for own lots, never the reserve value. Receives settlement statements. |
| Auctioneer | Runs the room | Opens, extends, closes and withdraws lots. Sees the bid stream with pseudonyms and registrations. Cannot alter bids. |
| Auditor | Compliance reviewer | Read-only. Runs chain verification and sees checkpoint anchors. Sees event payloads with proxy maxima redacted. |
| Floor | Projected display | Anonymous read-only projection of the live state. No credentials beyond a read-only scope. |

**Problems solved.** Live auctions fail in three ways that matter to engineers: duplicate or lost bids under retries and concurrency, unfair or unexplained ordering (who bid first, why this increment was rejected, why the clock extended), and disputed history (who changed what, and can anyone prove it). Tideline addresses each with a mechanism that is visible during the demo rather than described in a slide: serialized bid transactions with one global lock order, idempotent commands with an explained rejection ladder, a deterministic anti-sniping clock, and an audit chain anchored outside the database on the AWS run.

**Why it suits this demonstration.**

1. The domain is inherently real time. Every interesting event is a state transition that another session should see within a fraction of a second, which makes correctness visible rather than asserted.
2. A single bid crosses every layer: the browser, the authorization decision, a serialized database transaction, an event append, a hash computation, a proxy counter-bid, a WebSocket fan-out, a trace span and, later, a settlement entry. One click demonstrates the stack.
3. Roles are the audience's own roles. Engineers recognise a bidder who must not see a reserve, a floor display that must not see names, and an auditor who must be able to prove the history.
4. The domain produces striking visuals without cosmetic fakery: a countdown ring that resets when a bid lands in the final window, a ladder that renders the real increment rule, a gavel that fires only when a clock replica wins the close.
5. Nothing in the core flow depends on a third-party service. Payments are an internal double-entry ledger. Email goes through a `MailSender` interface that is SES on the AWS run and a local SMTP sink under Compose.

**The ladder.** Ladder version 3 is pinned to each lot when it opens. It has two bands: below 5,000 the step is 100, from 5,000 upward the step is 200. The rule is a minimum next bid, not a grid:

- The opening bid must be at least the lot's start price (4,000).
- After any accepted bid at price `p`, the minimum next bid is `p + step(p)`, where `step(p)` is the step of the band containing `p`.
- Any whole-unit amount at or above the minimum is valid. The step is a minimum increment, not a set of permitted amounts, so a jump bid such as 6,100 over a minimum of 5,600 is legal.
- A rejection names the ladder version, the band, the step and the minimum next bid.

**Sample data.** A seeded catalogue of 24 lots across two auctions, 8 registered bidders, 2 consignors, 1 auctioneer, 1 auditor and 1 floor principal. Lots are real-world-style antiques (an Augsburg astrolabe, a 1790s Admiralty sextant, a first-edition almanac). Seed data is deterministic: a fixed RNG seed and fixed UUIDv5 identifiers derived from names. Pseudonym numbers are derived from a fixed rule (D.5), so the seeded pseudonyms are the same on every reset: in the script, Ana is "Bidder 3" and Ben is "Bidder 2". The reset command truncates demo tables, reloads the seed, sets lot 14 to `scheduled` and re-verifies the initial hash chain, so the initial state is checked, not assumed.

---

## B. Capability inventory

Each capability is either **demonstrated** (the audience sees it happen during the script) or **supporting** (it is real, exercised by the automated rehearsal and the tests, and shows up in the script only as a side effect or an ops panel).

| # | Capability | Mark | Technical significance | Interacts with |
|---|---|---|---|---|
| 1 | Serialized bid transaction under one global lock order (auction row, then lot row, then settlement and ledger rows) with `SELECT ... FOR UPDATE` | demonstrated | Linearizable acceptance per lot and a total order per auction. The core of "no lost or reordered bids". | 2, 3, 4, 5, 7, 8 |
| 2 | Idempotent commands keyed by (actor, client key) with stored response replay | demonstrated | Exactly-once effect under client retry and response loss. The stored response includes any proxy counter-bid. Depends on capability 20 to produce the lost response on stage. | 1, 12, 20 |
| 3 | Cedar authorization with attribute checks (registration, deposit hold covering the amount, consignor ownership, lot status) plus audience-specific redaction in one projection module | demonstrated | Authorization uses database state inside the same transaction, not stale token claims. Denials cite the policy identifier. Redaction is one function used on both read paths. | 1, 6, 7, 12 |
| 4 | Versioned minimum-next-bid ladder (bands of price and step, pinned per lot at open) | demonstrated | Domain rule validated on the server, with a citation in the rejection. Ladder version is recorded in each bid event. | 1, 2, 5 |
| 5 | Proxy bidding resolved inside the triggering transaction | demonstrated | One transaction may append several events (the bid, any extension, the counter-bid), so the visible result is atomic. Proxy maxima are not sent to any audience except their owner. | 1, 3, 4, 6, 7 |
| 6 | Anti-sniping extension on the database clock | demonstrated | Rule: if `close_at - now() < snipe_window`, set `close_at = now() + snipe_window` and increment the extension count, at most once per transaction, up to a cap of 20. Uses `now()` inside the transaction, never client time. | 1, 8, 9 |
| 7 | Per-auction gap-free event sequence (`auction_seq`) assigned under the auction lock | demonstrated | Readers can prove they have every event. Commit order equals sequence order. | 1, 8, 9, 10, 11 |
| 8 | Clock worker that finds due lots without locking and closes each under the auction lock with a state-guarded transition | demonstrated | Exactly one closer per lot with several replicas. The gavel moment depends on it. | 6, 7, 9 |
| 9 | Real-time fan-out over WebSocket with replay from `from_seq` on reconnect | demonstrated | Reconnect fills the gap with the exact missing events. The server pushes projections, not raw rows. | 3, 7, 17 |
| 10 | Transactional outbox to SQS, consumed by a notifier with two-phase claim by message id | demonstrated | At-least-once delivery with a stated duplicate window and dedupe of redeliveries after a successful send. Killing the notifier and injecting a redelivery are both on stage. | 1, 14, 17 |
| 11 | Settlement saga: durable steps in `settlement_steps`, step-level idempotency keys | demonstrated | Multi-step business workflow that survives process death without an external workflow engine. Compensation is explicit, not exercised on stage. | 10, 12 |
| 12 | Double-entry ledger with a deferred constraint that each transaction balances to zero | demonstrated | Money is not a counter. The invariant is enforced by the database and shown as balanced totals. | 2, 11 |
| 13 | Tamper-evident audit log: per-auction SHA-256 hash chain, plus checkpoints that list every event hash through a sequence number, written to an S3 Object Lock bucket on the AWS run | demonstrated | Detects edits made with triggers disabled (in-chain). On the AWS run, detects a recomputed chain against the anchor and names the first divergent sequence number. The finale. | 7, 14 |
| 14 | Distributed tracing across browser, API, realtime, workers and database calls, with W3C `traceparent` propagated through the outbox; the Console renders the waterfall from the trace backend's query API | demonstrated | Engineers see one request as a waterfall across processes. | 1, 10, 11 |
| 15 | OIDC login with role groups and JWT validation through JWKS (Cognito on AWS, Keycloak locally) | supporting | Identity is external and standards-based. Four live sessions are four real logins. | 3 |
| 16 | Immutable container images, digest-pinned deployment, one backend image run in several roles | supporting | Same artifacts in both environments. Shown in the ops panel. | all |
| 17 | Health and readiness probes that check the database, queue and, on AWS, the object-lock bucket | supporting | Recovery and restart behaviour in the reliability section of the script. | 9, 10, 13 |
| 18 | Automated browser rehearsal (Playwright) running the same script against local and AWS | supporting | Reproducible demo; regression harness for the script. | all |
| 19 | Floor view with server-projected countdown, ladder and bid ticks | supporting | The visual language of the room. Real data; the animation is cosmetic (see G.4). | 3, 6, 9 |
| 20 | Demo fault layer: a server-side middleware, enabled only by demo configuration, that drops one response after commit for a named actor and route | demonstrated | Produces a lost response on a real request, so the stored-response replay can be shown. The same layer is used by the claim 2 test and by the labelled redelivery control. | 2, 10 |

**Interaction summary.** The critical path is 1 → 7 → 9: the serialized transaction assigns the sequence, and the realtime reader can only deliver what the sequence proves is contiguous. Capability 3 is evaluated inside 1 and again at the outbound projection, so the same rule governs the write path and the read path. Capabilities 6 and 8 share the database clock: extension and closing are both decided by `now()` in the database, and both take the auction lock first, which is why clock replicas can run without a coordination service. Capabilities 10, 11 and 12 form the money path. Capability 13 is the only one that depends on something outside the database, which is why it is the last thing the audience sees.

---

## C. Five-minute live script

The presenter drives four browser windows arranged side by side: **Floor** (full-screen projector view), **Ana** (phone-width window, bidder), **Ben** (desktop window, bidder), **Console** (auctioneer and settlement view, with the Auditor pane docked beside it). A split terminal sits under the Console for the ops steps and the owner-role tamper. Before the run the demo-reset command has been executed. Lot 14, "Surveyor's astrolabe, Augsburg 1742", is `scheduled`, with reserve 5,200 (never displayed to bidders), start 4,000, and ladder v3 ready to pin.

**Anchor.** Script second 0 is the moment the presenter presses "Open lot 14". That command sets `close_at = now() + 200 s` in the database and appends `lot_opened`. Every countdown beat below is derived from `close_at`. The snipe window is `snipe_window_s = 10`. The amber beat is therefore at 190 s, the final-window bids are those placed after 190 s, and the close is at 200 s plus any extensions. Times in the table are targets for the presenter; the server state is what the audience sees.

Latency figures are labelled as targets to be measured in rehearsal, not as results.

| Time (s) | Presenter action | Expected behaviour | Visible result | Capabilities | Transition |
|---|---|---|---|---|---|
| 0–5 | Presses "Open lot 14". | Open command pins ladder v3, sets `close_at`, appends `lot_opened` (413). | Floor ring at 3:20 and counting. Header "Live, seq 413". Ana and Ben show "Open, you may bid". Ladder shows start 4,000. | 3, 6, 7 | Purpose line. |
| 5–20 | Says the purpose in one sentence: a live room, four sessions, every bid a transaction. Points at the windows. | Clocks are offset-measured from four pings made at session start. The ring is rendered from server `close_at` and the measured offset. | Ring counting. | 19, 9 | Ana's window to the front. |
| 20–40 | Ana taps "Bid 4,000" on the phone-width window. | Token validated. Cedar checks Ana is registered and her deposit covers 4,000. Transaction locks the auction row, then the lot row, inserts the bid, appends 414, commits, fans out. | Floor leader "Bidder 3", ring pulses. Ben shows "Leader: Bidder 3". Ana shows "You lead". Ben's window updates within a measured target of under 250 ms after commit. | 1, 3, 4, 7, 9 | Trace panel. |
| 40–60 | Opens the trace panel for 414. | In-app waterfall fetched from the trace backend's query API: browser request, edge, API handler, authorization, lock wait, commit, outbox write, realtime push. Durations are as reported by the backend. If spans are still being ingested, the panel shows "pending" and fills in. | Waterfall across three processes. Trace ID copyable. | 14, 1 | Closes panel, to Ben. |
| 60–80 | Ben types 3,950 in the raw bid field and submits. | Rejected `BID_BELOW_MINIMUM`: ladder v3, band from 4,000, step 100, minimum next bid 4,100. No event. | Red toast with that citation. Event count unchanged. | 4, 3 | Ben's normal bid button. |
| 80–100 | Ben turns on "Drop next response" and bids 4,100. | Commit 415 happens. The demo fault layer drops the response after commit. The client retries with the same key after 2 s; the stored response is replayed. No second event. | Ben leads at 4,100. Floor shows one tick at 4,100 with "1 effect, 2 requests". Console idempotency panel shows the key with 2 hits. | 2, 20, 1, 9 | Ana. |
| 100–120 | Ana sets a proxy maximum of 6,000 in the phone window. | One transaction: `proxy_set` (416), which stores the maximum for Ana only, then counter-bid 417 at minimum 4,200, which is at most 6,000. | Ana: "You lead, proxy max set" (her own maximum, visible to her only). Floor: tick at 4,200 with a proxy marker, no maximum. Ben: "Outbid". | 5, 3, 4, 1 | Ben. |
| 120–140 | Ben bids 4,300. | One transaction: Ben's bid 418, Ana's counter 419 at 4,400. | Floor shows ticks 4,300 then 4,400. Ana leads. Ben: "Outbid by proxy". | 5, 7, 9 | Ben bids again. |
| 140–160 | Ben bids 4,500. | One transaction: Ben's bid 420, Ana's counter 421 at 4,600. | Floor: 4,600 by Bidder 3 with proxy marker. Ana: "You lead, proxy at 4,600 of 6,000". Ben: "Outbid by proxy". | 5, 4, 1 | Ben bids again. |
| 160–172 | Ben bids 4,700. | One transaction: Ben's bid 422, Ana's counter 423 at 4,800. | Floor: 4,800 by Bidder 3. Ben: "Outbid by proxy". Next minimum shown on Ben's button: 4,900. | 5, 7 | Presenter kills the realtime task. |
| 172–186 | Presenter kills one realtime task (`docker kill` locally; stop the ECS task on the AWS run). Ben bids 4,900 while it is down. Presenter restarts the task at about 184. | Commit 424 (Ben, 4,900) and counter 425 (Ana, 5,000) happen with no realtime node running. The reconnecting clients send `from_seq = 423` and receive 424 and 425 in order. | Floor and Ben show "Reconnecting". After restart: chip "Replayed 2 events, no gap". | 9, 7, 17 | Presenter moves the cursor to Ben's button. |
| 186–190 | Nothing typed. Floor shows Ana leading at 5,000, ring counting. | None beyond the read path. The ring is server-derived. | Ring counting. Ben's button reads "Bid 5,200". | 6, 19 | Amber. |
| 190 | Nothing typed. | Ring turns amber at `close_at - snipe_window_s`, computed from server state. | Amber ring at 0:10. | 6, 19 | Ben is at the button. |
| 192 | Ben bids 5,200, the minimum. | Remaining 8 s is inside the 10 s window. One transaction: bid 426, extension 427 (`close_at` 200 s to 202 s, count 1), then counter 428 for Ana at 5,400, which is at most 6,000. The extension is evaluated once, on Ben's bid. | Ring: "Extended 1 of 20: clock reset to 0:10 (+2 s)". Ring returns to neutral. Ana: "You lead, proxy at 5,400 of 6,000". | 6, 5, 1, 3 | Ben's final bid. |
| 196 | Ben bids 6,100, a jump bid over a minimum of 5,600. | Remaining 6 s is inside the window. One transaction: bid 429, extension 430 (`close_at` 202 s to 206 s, count 2). No counter: Ana's next minimum would be 6,300, above her maximum. | Ana: "Outbid. Your maximum of 6,000 was reached." Floor: 6,100 by Bidder 2. Ring: "Extended 2 of 20: clock reset to 0:10 (+4 s)". | 5, 6, 7 | Ring reaches zero. |
| 206–214 | Nothing typed. Ring reaches zero. | Two clock replicas find lot 14 due without locking. Both start a transaction that takes the auction lock first, then the lot lock, and re-checks `status = 'open'` and `close_at <= now()`. One closes it (431 `lot_closed`). The other waits on the auction lock, re-reads `status = 'closed'`, and records nothing. The 6,100 bid meets the 5,200 reserve, so the lot is sold. | Gavel fires once on the Floor. Console: "SOLD 6,100, Bidder 2, closed_by clock-replica-a". Reserve-met flag shown to the Console only. | 8, 6, 7 | Console to settlement view. |
| 214–240 | Points at the settlement timeline for the lot. | Settlement claims the lot under the same lock order and advances: `deposit_hold_captured` (432), `invoice_issued` (433, outbox: buyer), `consignor_statement_issued` (434, outbox: consignor), `settlement_closed` (435). Each step is one transaction with ledger entries. | Steps tick green. Ledger panel shows debits equal to credits, with a green balance check. Outbox counter shows two messages queued. | 11, 12, 10 | Mailpit tab. |
| 240–256 | Stops the notifier while the two messages are queued. Restarts it at about 248. At about 252 presses "Re-enqueue message 1 (fault)". | Notifier claims each message, sends, marks it sent, then deletes it from the queue. The re-enqueued copy of message 1 finds it already marked sent and is skipped, with a log line naming the message id and the word "injected". | Notifier card greys, then returns. Mailpit shows the buyer email and the consignor email, one each. Log line: "duplicate skipped (injected redelivery)". | 10, 17 | Auditor pane. |
| 256–266 | Clicks "Verify chain" in the Auditor pane. | Verifier recomputes every hash for the auction, replays events to check the lot projection, and (AWS run only) compares the stored hash list through checkpoint #2 with the object-locked copy. Local run: the anchor panel states that this run has no trust anchor. | AWS: green. "Verified 435 events. Projection matches. Anchor: checkpoint #2 through seq 431, compliance retention until <date from object metadata>, version ID shown." Local: green for chain and projection, anchor line reads "none on this run: local storage is not a trust anchor". | 13, 7 | Threat-model card. |
| 266–278 | Threat-model card on screen: "The database owner can disable triggers and rewrite rows. Tideline detects that. It does not prevent it." Presenter runs the saved tamper in the terminal as the owner role. | Owner role disables the append-only trigger on `events`, sets the payload of the bid with amount 6,100 (seq 429) to 5,100, and re-enables the trigger. Nothing checks at write time. | Terminal prints `UPDATE 1`. Then "Verify chain": red at 429. | 13 | Recompute step. |
| 266–278 (cont.) | Verifier output on screen. | First divergence found by the chain check. The lot card shows the projection disagreeing with the events. | Red panel: "Hash mismatch at 429. Recomputed <a>, stored <b>." Lot card: "Projection disagrees with events at seq 429". | 13, 7 | Presenter runs the saved rehash. |
| 278–300 | Runs the saved rehash script in the terminal as the owner role: recompute hashes from 429 to the head with the same canonical code, update the projection to match, re-enable the trigger. Then "Verify chain", then "Verify anchor". | Chain check passes, because the owner rewrote every later hash. Projection check passes. The anchor check (AWS run) compares the per-sequence hash list in the object-locked checkpoint #2 with the database and names the first divergence. The object's retention mode and retain-until date are read from S3 and shown. | Green: "Chain valid, 435 events. Projection matches." Then red on the anchor: "First divergence at seq 429. Anchored hash <c>, database hash <d>. Object version 2, compliance retention until <date>." Final frame holds on this panel. Local run: the anchor step is shown as "not run on this run; the rehashed history verifies locally", which is the honest local result. | 13, 7, 14 | Run ends. |

**Event ledger for the run.** The table gives the expected sequence of events. The rehearsal asserts it, so a regression in any step fails the rehearsal.

| seq | Kind | Actor | Detail |
|---|---|---|---|
| 412 | (reset head) | | Checkpoint #1 through 412 |
| 413 | lot_opened | auctioneer | close_at = open + 200 s, ladder v3 |
| 414 | bid_accepted | Ana | 4,000 |
| 415 | bid_accepted | Ben | 4,100 (response replayed on retry, no extra event) |
| 416 | proxy_set | Ana | maximum stored, not shown to others |
| 417 | proxy_countered | Ana | 4,200 |
| 418 | bid_accepted | Ben | 4,300 |
| 419 | proxy_countered | Ana | 4,400 |
| 420 | bid_accepted | Ben | 4,500 |
| 421 | proxy_countered | Ana | 4,600 |
| 422 | bid_accepted | Ben | 4,700 |
| 423 | proxy_countered | Ana | 4,800 |
| 424 | bid_accepted | Ben | 4,900 (realtime node down) |
| 425 | proxy_countered | Ana | 5,000 (realtime node down) |
| 426 | bid_accepted | Ben | 5,200 (remaining 8 s) |
| 427 | extended | system | close_at 200 s to 202 s, count 1 |
| 428 | proxy_countered | Ana | 5,400 |
| 429 | bid_accepted | Ben | 6,100 (remaining 6 s) |
| 430 | extended | system | close_at 202 s to 206 s, count 2 |
| 431 | lot_closed | clock-replica-a | sold 6,100, reserve met |
| 432 | settlement_step | system | deposit_hold_captured |
| 433 | settlement_step | system | invoice_issued (outbox) |
| 434 | settlement_step | system | consignor_statement_issued (outbox) |
| 435 | settlement_step | system | settlement_closed |

The tamper target is resolved by query: `kind = 'bid_accepted' and amount = 6100` returns 429. No constant event number appears in the script. The count "435 events" at the verify step is the auction's head.

**The strongest moment.** The final 30 seconds: the audience has just watched a sale close, a settlement run and a notifier recover without a duplicate email in the run. Then the owner rewrites a sale and the system first reports the in-chain break, then shows that the owner's careful rewrite also passes the chain check, and then names the first sequence number where the history diverges from a copy the owner could not rewrite. The last sentence is the one the rehearsal is built around: the AWS run shows it, and the local run labels what it cannot show.

**Run policy.** The stage run is the AWS run, reached over a prepared second network link. The local Compose run is the fallback and the development run. It executes the same script, and the anchor steps show "not run on this run". A failure of the AWS link before the run starts moves the presenter to the local run, which begins from reset. Switching runs mid-script is not attempted.

**Robustness of the script.** Every step is driven by a real action in a real session. The only steps the presenter could get wrong are the ones that cost time rather than correctness: a late final bid (the close is simply later), a missed proxy click (the Floor shows the state anyway), or an unopened trace panel (the trace is still recorded). The rehearsal replays the script from reset and checks each expected behaviour and each row of the event ledger as an assertion.

---

## D. Technical architecture

### D.1 Components

| Component | Language and framework | Role | Replicas on AWS |
|---|---|---|---|
| `web` | TypeScript, React 18, Vite, TanStack Query for REST, a typed WebSocket client, CSS modules, Framer Motion for the ring and tick animations | Static single-page app for Floor, Bidder, Console and Auditor. Routes by role. | Served from the same nginx image as the local edge. 2 tasks. |
| `edge` | nginx | Locally, serves `web` and routes `/api/*` and `/ws`. On AWS, the ALB takes this role and serves the static bundle. | Local only. ALB on AWS. |
| `server api` | Rust (pinned toolchain), axum, sqlx (Postgres, compile-time checked queries), cedar-policy, serde, tower-http, opentelemetry with tracing-opentelemetry | Commands and queries: bids, proxies, absentee bids, lot opening, registration reads, settlement reads, trace queries for the Console. Writes outbox rows. Includes the demo fault layer (capability 20), which is inert unless demo configuration is set. | 2 |
| `server realtime` | Rust, axum WebSocket, sqlx | Per-auction projection streamer. Reads `events` by `auction_seq`, projects per audience, pushes frames. Never writes. | 2 |
| `server worker --role clock` | Rust, sqlx | Finds due lots, then closes each under the auction lock with a state re-check. Emits `lot_closed`. | 2 |
| `server worker --role settlement` | Rust, sqlx | Finds pending lots, then advances settlement steps under the lock order. Each step is one transaction with ledger entries. Runs the outbox relay loop. | 2 |
| `server worker --role notifier` | Rust, aws-sdk-sqs, aws-sdk-sesv2 or SMTP via lettre | Consumes the notification queue. Two-phase claim per message id. Sends through the `MailSender` trait. | 1 |
| `server worker --role checkpointer` | Rust, aws-sdk-s3 | At each lot close and every 100 events per auction, writes a checkpoint object with per-sequence hashes and Object Lock compliance retention. | 1 |
| `tideline-owner-tools` | SQL files and a small Rust binary using the same canonicalization crate | The demo owner's saved tamper and rehash scripts. Not part of any service. Runs only from the terminal under the owner role. | Not deployed as a service. |

All backend roles run from one image, `tideline-server`, selected by subcommand. The artifact count is two (`tideline-web` and `tideline-server`), and the code path a bid takes locally is the code path it takes on AWS. The owner tools are a separate tiny binary so the product image contains no tamper capability.

Why Rust for the backend: lock ordering, transaction boundaries and the hash chain are the parts an expert audience will read. Why not a managed workflow service, a broker cluster or a graph database: each adds a second source of truth or a second emulator whose behaviour can diverge from production. PostgreSQL is the only stateful engine in the core path.

Why React and TypeScript for the front end: the Floor and bidder views are animated, and a single state store fed by realtime frames keeps the rendered state a pure function of the event stream.

### D.2 Persistence model

Engine: PostgreSQL 16 (Aurora PostgreSQL on AWS, the `postgres:16` image locally). All times are `timestamptz` set by the database. Money is `bigint` minor units; no floating point anywhere.

```sql
create table auctions (
  id uuid primary key,
  title text not null,
  status text not null check (status in ('draft','live','closed')),
  next_seq bigint not null default 413,            -- advanced under the auction row lock
  event_head bytea not null default '\x00',        -- hash of the latest event, same lock
  ladder_version int not null
);

create table lots (
  id uuid primary key,
  auction_id uuid not null references auctions(id),
  lot_number int not null,
  title text not null,
  consignor_id uuid not null,
  start_cents bigint not null,
  reserve_cents bigint not null,                   -- never sent to bidders or floor
  status text not null check (status in ('scheduled','open','closed','sold','passed','settled')),
  close_at timestamptz,                            -- set by the open command: now() + lot duration
  extension_count int not null default 0 check (extension_count <= 20),
  ladder_version int not null,                     -- pinned at open
  current_cents bigint,
  leader_id uuid,
  version bigint not null default 0,               -- incremented per accepted bid
  closed_by text,
  unique (auction_id, lot_number)
);

create table bids (
  id uuid primary key,
  lot_id uuid not null references lots(id),
  bidder_id uuid not null,
  amount_cents bigint not null,
  kind text not null check (kind in ('live','absentee','proxy_counter')),
  lot_version bigint not null,
  auction_seq bigint not null,
  idempotency_key text,
  placed_at timestamptz not null default now(),
  unique (lot_id, lot_version)
);

create table proxy_bids (
  lot_id uuid not null references lots(id),
  bidder_id uuid not null,
  max_cents bigint not null,
  created_seq bigint not null,
  active boolean not null default true,
  primary key (lot_id, bidder_id)
);

create table ladder_steps (
  auction_id uuid not null references auctions(id),
  ladder_version int not null,
  band_from_cents bigint not null,                 -- 4000 -> step 100; 5000 -> step 200 in v3
  step_cents bigint not null,
  primary key (auction_id, ladder_version, band_from_cents)
);

create table registrations (
  auction_id uuid not null references auctions(id),
  bidder_id uuid not null,
  pseudonym_no int not null,                       -- "Bidder N", derived at seed (D.5)
  deposit_cents bigint not null,
  primary key (auction_id, bidder_id),
  unique (auction_id, pseudonym_no)
);

create table idempotency_keys (
  actor_id uuid not null,
  key text not null,
  route text not null,
  request_hash bytea not null,
  response jsonb not null,                         -- the full response, including any counter-bid
  status int not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, key)
);

create table events (
  auction_id uuid not null references auctions(id),
  auction_seq bigint not null,
  lot_id uuid,
  kind text not null,                              -- lot_opened, bid_accepted, proxy_set, proxy_countered, extended, lot_closed, settlement_step
  actor_id uuid,
  payload jsonb not null,                          -- canonical JSON, integers only
  prev_hash bytea not null,
  hash bytea not null,                             -- sha256(prev_hash || auction_seq || kind || canonical payload)
  traceparent text,
  recorded_at timestamptz not null default now(),
  primary key (auction_id, auction_seq)
);

create table outbox (
  id uuid primary key,
  auction_seq bigint not null,
  topic text not null,
  message_id uuid not null unique,
  payload jsonb not null,
  traceparent text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table ledger_entries (
  txn_id uuid not null,
  entry_id bigserial primary key,
  account text not null,                           -- 'bidder:<id>:deposit', 'consignor:<id>:payable', 'house:commission'
  amount_cents bigint not null                     -- signed; debits positive, credits negative
);

create table settlements (
  lot_id uuid primary key references lots(id),
  state text not null,
  updated_at timestamptz not null default now()
);

create table settlement_steps (
  lot_id uuid not null references settlements(lot_id),
  step text not null,
  status text not null check (status in ('pending','running','done','compensated')),
  attempt int not null default 0,
  idempotency_key text not null unique,
  primary key (lot_id, step)
);

create table processed_messages (
  consumer text not null,
  message_id uuid not null,
  state text not null check (state in ('claimed','sent')),
  updated_at timestamptz not null default now(),
  primary key (consumer, message_id)
);

create table checkpoints (
  auction_id uuid not null references auctions(id),
  through_seq bigint not null,
  head_hash bytea not null,
  s3_key text not null,
  s3_version_id text not null,
  retain_until timestamptz not null,
  primary key (auction_id, through_seq)
);
```

Invariants enforced by the database, not the application:

- `events` is append-only. A `BEFORE UPDATE OR DELETE` trigger raises an exception. The trigger is the accident guard, not the security boundary. The hash chain and the checkpoints are the security boundary (D.5).
- Ledger transactions balance. A `DEFERRABLE INITIALLY DEFERRED` constraint trigger checks `sum(amount_cents) = 0` per `txn_id` at commit.
- `bids` and `events` are written in the same transaction; the verifier checks that every bid has its event.
- `unique (lot_id, lot_version)` makes a double-applied bid a constraint violation even if application logic is wrong.

### D.3 Communication

**Synchronous (browser to API).** REST over HTTPS with JSON. Commands are `POST` with an `Idempotency-Key` header. Queries are `GET`. Every request carries a W3C `traceparent`. Command responses return the committed `auction_seq` and the lot version. Trace queries are `GET` requests served by the API to the Console, which keeps the trace backend out of the browser.

**Real-time (API and realtime to browser).** One WebSocket per session at `/ws`. The client sends `subscribe { auction_id, audience, from_seq }`. The server responds with a projection snapshot at the current `auction_seq` and then streams frames in `auction_seq` order, one event per frame. The client treats any gap as a protocol error and reconnects with `from_seq` equal to the last contiguous sequence it applied. A `LISTEN` notification from the bid transaction reduces wake-up latency, but correctness does not depend on it: the realtime reader polls `events` by `auction_seq > cursor` every 100 ms (a configured value). The observed fan-out latency is measured in rehearsal.

**Asynchronous (outbox, queue, workers).** Bid, extension, close and settlement transactions write `outbox` rows in the same transaction as their events. The outbox relay loop in the settlement worker publishes unsent rows to SQS (ElasticMQ locally) with `message_id` as the deduplication key and marks `sent_at`.

**Notifier protocol (two-phase claim).**

1. Receive a message from the queue.
2. In a transaction, insert `processed_messages(notifier, message_id, 'claimed')` on conflict do nothing. If the row exists with state `sent`, log "duplicate skipped", delete the queue message and stop.
3. If the row exists with state `claimed` (a previous attempt crashed), send again. If the row was inserted now, send.
4. Send through `MailSender`. Email carries `message_id` in a header for tracing, not as a dedupe key.
5. In a second transaction, set state `sent`. Delete the queue message only after this commit.

Delivery is at-least-once. The duplicate window is one message per notifier crash between step 4 and step 5. Nothing in this protocol claims that the SMTP or SES effect is exactly once.

**Workers and claims.** Clock and settlement workers find candidate rows without locking, then do all state changes in a transaction that takes the auction lock first (D.4). Each re-checks the state it acts on under the lock. A worker that dies holds no lock after its connection drops.

**Trace propagation.** The outbox row stores the `traceparent` of the transaction that produced it, so the notifier's span is a child of the bid's span even though it runs seconds later.

### D.4 Consistency requirements per operation

**Global lock order.** Every transaction that appends events or changes lot, settlement or ledger state takes locks in this order: `auctions` row, then `lots` row, then `settlements` row, then `ledger_entries` writes. Lots are never locked before their auction. The `SKIP LOCKED` pattern is not used for any lock that precedes the auction lock. The helper `with_auction_lot(auction_id, lot_id, f)` is the only place that opens these transactions, and a test fails if any other module opens one.

| Operation | Requirement | How it is met | What a violation would look like |
|---|---|---|---|
| Open lot | Lot opens once, with a fixed close time and pinned ladder | Under the auction lock: state check `scheduled`, set `close_at = now() + lot_duration`, pin ladder, append `lot_opened` | Two open events; a lot with no close time |
| Place live bid | Linearizable per lot; exactly-once effect per idempotency key; amount satisfies the ladder against the locked current price | Transaction: auction lock, lot lock, check idempotency row, registration and deposit (Cedar), status `open`, ladder minimum against locked current price, lot version, insert bid, evaluate extension, evaluate one proxy counter, insert events, update lot, insert outbox rows, store idempotency response, commit | Two leaders at the same version; a bid below minimum; a retried bid counted twice |
| Proxy resolution | A function of the locked state at the moment of the bid; at most one counter per transaction in the demo | Same transaction; proxy rows read under the lot lock; counter is the minimum next bid if it does not exceed the proxy's maximum and the proxy holder is not already leading | Proxy responds to a stale price; a visible maximum |
| Anti-sniping | Evaluated once per transaction, on the originating bid, on the database clock | If `close_at - now() < snipe_window_s` and `extension_count < 20`: `close_at = now() + snipe_window_s` and increment the count. Counter-bids in the same transaction do not re-evaluate it. The displayed extension is the change in `close_at`, which is between 0 and `snipe_window_s` | Client-clock manipulation; two extensions from one bid; a displayed extension that differs from the stored change |
| Lot close | Exactly one closer; closing is a guarded transition | Clock worker: find `status = 'open' and close_at <= now()` without locking, then in a transaction under the auction lock, re-check `status = 'open' and close_at <= now()`, set `closed`, append `lot_closed` | Two `lot_closed` events for one lot; a bid accepted after close |
| Event sequencing | Contiguous `auction_seq` per auction; commit order equals sequence order | `next_seq` read and advanced under the auction row lock, held until commit | A reader sees 436 before 435; a permanent hole |
| Real-time delivery | Every committed event is delivered once, in order, to each authorized subscriber | Poll by `auction_seq` cursor; projection per audience; gap detection and `from_seq` replay | A silent gap on reconnect; a bidder receives a reserve value |
| Audit | Any change to a stored event is detectable by a verifier that holds the checkpoint | Per-auction hash chain; checkpoint objects in Object Lock compliance retention, listing every event hash through the checkpoint's sequence, written by the checkpointer role only | A rewritten history verifies clean against the anchor |
| Notifications | At-least-once delivery; duplicates bounded to one per notifier crash between send and mark-sent | Outbox, SQS, two-phase claim (D.3) | Duplicate email beyond the stated window; missing email after a crash |
| Settlement | Each step applies once; a crashed step resumes; compensation is explicit | `settlement_steps` with step-level idempotency keys; each step is a transaction under the lock order that writes ledger entries and an outbox row | Money moved twice; a step marked done without its entries |
| Ledger | Balanced per transaction | Deferred constraint trigger | An unbalanced transaction commits |

**Auction lock as the sequencing decision.** Serializing all bids within an auction is a deliberate trade. A live room runs one lot at a time for the audience. The throughput limit that results is measured in rehearsal and is well above what a live room needs. The alternative, a global `bigserial` read by a poller, produces permanent holes when an earlier insert commits after a later one. Assigning `auction_seq` under the auction lock makes commit order and sequence order identical, which the replay claim requires.

### D.5 Security boundaries, authorization and redaction

**Identity.** OIDC authorization-code flow with PKCE in the browser. The API and realtime validate RS256 JWTs against the issuer's JWKS, check `aud`, `iss` and `exp`, and read a configured `groups` claim. Cognito provides `cognito:groups` on AWS; Keycloak provides the same values through a mapper in the imported realm, on the local run.

**Authorization.** Cedar policies in `policies/*.cedar`, evaluated in-process. Attributes that Cedar cannot read from the token (registration, deposit hold, consignor ownership, lot status) are loaded inside the transaction and passed as the entity store for that decision. A denial returns the policy identifier, which the rejection toast can name. Example rules, abbreviated:

```cedar
permission(principal in Role::"bidder", action == Action::"PlaceBid", resource)
  when { resource.status == "open"
         && principal.registered_for(resource.auction)
         && principal.deposit_held_for(resource.auction) >= context.amount };

forbid(principal, action == Action::"ReadReserve", resource)
  unless { principal in resource.consignor || principal in Role::"auctioneer" };
```

**Pseudonyms.** For each registrant, `score = sha256(auction_id || bidder_id)`. Registrants are sorted by score and numbered 1 to n. The number is stored in `registrations.pseudonym_no` at seed time and shown as "Bidder N". The number is stable within an auction, so observers can correlate one bidder across that auction's lots. It is not derivable from the bidder's identity by anyone outside the server, and it changes between auctions. This is a pseudonym, not anonymity against a bidder who knows the seed.

**Proxy ceiling caveat.** A proxy's maximum is never sent to any audience except its owner. The Auditor's event payloads show it redacted (below). Its ceiling is still inferable as a lower bound: a counter-bid stops at the proxy's last valid minimum, and an observer who sees a proxy stop below a later bid learns that the maximum was below that bid. This is the standard disclosure of proxy bidding, and the Floor and bidder views do not show the proxy as a number. The demo says so in the proxy card.

**Redaction.** One projection module takes an audience and a record and returns the fields that audience may see. Audiences: floor, bidder (self), bidder (other), consignor (own lot), auctioneer, auditor. Record types: realtime frames, query responses, audit export bodies, event payloads, and the reserve-met flag. Reserve values, proxy maxima and bidder identities are removed in the projection, not in the browser. The reserve-met flag is a boolean included only for the consignor of that lot and the auctioneer.

**Redaction tests.** `tests/redaction.rs` holds a table of (record type, audience) pairs with the exact set of permitted fields and the set of forbidden fields. For each pair it builds the record from the seeded auction and asserts both sets. The forbidden set always contains `reserve_cents`, the proxy maximum, and for every audience except the owner or the auctioneer, the bidder's real name. Event payloads for the auditor replace `max_cents` with the literal `"redacted"` and keep the event's canonical hash, so the auditor sees the chain without the maximum.

**Network boundaries.** Public subnets hold the ALB only. ECS tasks run in private subnets. The Aurora cluster accepts connections only from the task security group. Workers have no inbound rules. The checkpointer role can write to the object-lock bucket; the verifier role has read-only access; no role has `s3:BypassGovernanceRetention`, and the bucket is in compliance mode, which no principal can override.

**Threat model, stated plainly.** The application enforces role and attribute authorization on every write. The database owner, which the demo deliberately exposes through the terminal, can disable triggers, rewrite rows and recompute the chain. Tideline does not try to stop that. It makes the rewrite detectable in two steps. The per-auction hash chain fails at the first edited event. The checkpoint, which lists every event hash through its sequence number and sits in an Object Lock compliance bucket, fails for any recomputed history at the first divergent sequence number. The second step needs the AWS run. On the local run the checkpoint is stored in MinIO, whose root user can bypass retention, so the local run shows that step as "no trust anchor on this run". The model does not protect against a compromise of both the database and the checkpointer role, and the documentation says so.

### D.6 Deployment topology (logical)

```
Browser ──HTTPS──▶ ALB (public)
                   ├─ /          ▶ web (static bundle, nginx image)
                   ├─ /api/*     ▶ server-api  (2 tasks)
                   └─ /ws        ▶ server-realtime (2 tasks, idle timeout 3600 s)

server-api, server-realtime, workers ──▶ Aurora PostgreSQL (2 AZ)
settlement worker relay ──▶ SQS notification queue ──▶ notifier ──▶ SES (sandbox identities)
checkpointer ──▶ S3 Object Lock bucket (compliance mode, AWS run)
server-api (trace queries) ──▶ X-Ray (AWS run) or Jaeger query API (local)
all services ──▶ OTLP ──▶ ADOT collector sidecar ──▶ X-Ray   (AWS run)
```

---

## E. AWS and local deployment

### E.1 Container-first and immutability

- Two images: `tideline-web` (nginx, built static bundle) and `tideline-server` (Rust release binary, distroless base, non-root). Built once per commit in CI, pushed to ECR with tag immutability enabled, and identified in deployment by digest.
- The toolchain is pinned to one exact stable Rust release in `rust-toolchain.toml`, and the same version is the image build argument. Changing it is a dedicated change that reruns the full suite. The reproducibility claim depends on this pin.
- The same two images are referenced by digest in `compose.yaml` locally. A local run and an AWS run differ in configuration injected at runtime, never in the bytes that execute.
- Configuration is environment variables plus one policy bundle directory. AWS injects them from task definitions and SSM Parameter Store; locally they come from `compose.env`. The demo fault layer and the owner-tools terminal are controlled by configuration. A startup check refuses to run with the demo fault layer enabled unless the environment name is `demo`.
- Migrations are sqlx migrations shipped inside `tideline-server`, run as a one-shot `migrate` role before API tasks start. They are forward-only, and each is idempotent under its checksum.

### E.2 Service mapping

| Concern | AWS | Local (Compose) | What differs | Why behaviour is unchanged |
|---|---|---|---|---|
| Relational store | Aurora PostgreSQL 16, 2 AZ | `postgres:16` container | Failover mechanics; storage layer | Same engine and SQL. Failover is not in the five-minute script. |
| Identity | Cognito user pool with groups, hosted UI disabled | Keycloak with an imported realm containing the same eight users and four groups | Claim name and token lifetimes; realm JSON replaces console setup | The services validate standard JWTs; the claim name is configuration. The contract suite (F) checks claim mapping and a fixed set of authorization decisions for both issuers. |
| Queue | SQS standard queue with DLQ | ElasticMQ speaking the SQS API | Redrive and metrics are less complete in ElasticMQ | The notifier uses the official SDK with an endpoint override. Dedupe is in Postgres, so it does not depend on SQS's own features. |
| Email | SES v2 with verified sandbox identities | Mailpit (SMTP sink with a web UI) | SES sandbox requires verified recipients; Mailpit has no bounce handling | `MailSender` trait with two implementations behind one contract test. The demo recipients are verified in AWS before the run. |
| Object-lock checkpoints | S3, Object Lock compliance mode, versioning | MinIO with Object Lock enabled at bucket creation | MinIO's root user can bypass retention, which S3 compliance mode does not allow. The local run therefore has no trust anchor. | The checkpointer writes the same key format through the same SDK call. The stage labels the local run's anchor step. |
| Edge and WebSocket | ALB with path rules; idle timeout 3600 s for `/ws` | nginx with `proxy_read_timeout 3600s` for `/ws` | ALB health checks and draining | Same paths. Health checks use the same `/readyz` endpoint. |
| Tracing | ADOT collector sidecar exporting to X-Ray | OpenTelemetry collector exporting to Jaeger | Span storage | Same OTLP export, span names and attributes. The Console reads the trace through the API, so the UI is the same in both runs. |
| Compute | ECS Fargate, 2 AZ, rolling deploy | Compose services, same images, same health checks | Scheduler and placement | Same commands (`tideline-server api`, `… worker --role clock`), same environment keys. |
| Secrets | Secrets Manager (database password by ARN) | `compose.env`, git-ignored | Secret storage | Same environment variable names. |

The owner-role terminal on AWS connects to Aurora through a session that the presenter opens, using the owner credential stored in Secrets Manager. The application roles have no such credential.

### E.3 Reproducible configuration and reset

- `make up` (Compose) and `make deploy` (CDK) run the same migration and seed commands. `make reset` truncates demo tables, reloads the seed, sets lot 14 to `scheduled`, writes checkpoint #1 through 412, and runs the verifier over the initial chain. It fails if the seed does not verify.
- Seeds are deterministic: fixed identifiers, fixed pseudonym numbers, fixed ladder. The open command, not the seed, sets the clock, so the countdown always starts at the moment the presenter opens the lot.
- `make rehearse` runs the Playwright script against a running environment, with the target chosen by a base URL. The same test code runs against `localhost` and the AWS ALB. Rehearsal assertions are state-based: after each step the rendered state and the ring's data attributes must equal the projection of the expected event, and the ring's displayed remaining time must match the server-derived remaining time within a stated tolerance. The rehearsal also asserts each row of the event ledger. Latency targets are reported as measurements and fail the rehearsal only when a target is set as a gate.
- The trace backend's native UI is opened once in rehearsal to confirm that the span tree the Console shows matches it.

### E.4 Infrastructure as code

AWS infrastructure is an AWS CDK application in TypeScript: one VPC, one ALB, one ECS cluster with five services, one Aurora cluster, one SQS queue with DLQ, one SES identity set, one S3 Object Lock bucket, one Cognito user pool, and IAM roles per service with the minimum actions listed in the stack. The bucket is created with a compliance retention period from deploy configuration (`CHECKPOINT_RETENTION_DAYS`, default 7). A lifecycle rule expires versions after their retention date. The stack retains the bucket on destroy; the teardown procedure says that a bucket with locked versions cannot be removed until they expire.

The local stack is a single `compose.yaml` with the same services, names and environment keys. Compose is the only local orchestrator.

---

## F. Five strongest technical claims

Each claim has an executable test and an observable behaviour in the running demo.

**Claim 1. Concurrent bids on one lot produce a single, gap-free, strictly ordered history with no lost updates.**
- Test: `tests/bid_concurrency.rs` runs 200 virtual bidders against one lot with 50 attempted bids each, randomized amounts at or above the minimum, and a fixed random seed. Assertions after the run: every accepted bid has a unique `lot_version`; `lot_version` values are contiguous from 1; `events.auction_seq` is contiguous; the final `current_cents` equals the maximum accepted amount; the ledger balances; a replay of events reproduces `lots` exactly.
- Observable in the demo: the Console's sequence counter climbs without holes, and the Auditor's "Projection matches" line is the same check run on demand.

**Claim 2. A retried command has exactly one effect, and the retry receives the original response.**
- Test: `tests/idempotency.rs` runs the real router with the demo fault layer enabled, which drops the response after commit for the first request. The client retries with the same key. Assertions: one row in `bids`, one `bid_accepted` event, identical response bodies (including any counter-bid), `idempotency_keys.response` equal to the original, and a second request with the same key and a different body returns `409`.
- Observable in the demo: steps 80–100. The stage uses the same layer and the same assertion on the stored response. The stage's dropped response is a real server-side loss, not a client-side imitation.

**Claim 3. A reconnecting client receives every missing event exactly once, in order, and never a field its audience may not see.**
- Test: `tests/replay.rs` kills the realtime process mid-stream during a scripted run of 300 events, reconnects with `from_seq`, and records every frame. Assertions: received sequence numbers form the set 1..300 with no duplicates. `tests/redaction.rs` asserts the forbidden-field sets for every (record type, audience) pair (D.5), including audit bodies, event payloads and the reserve-met flag.
- Observable in the demo: steps 172–186. The Floor fills the gap with the two missed events and shows the chip. The frame capture can be opened from the Console's network panel and searched for the reserve value, which is absent.

**Claim 4. Anti-sniping and lot closure are deterministic, use only the database clock, and close each lot exactly once across replicas, under both interleavings.**
- Test: `tests/snipe.rs` drives bids at fixed database times and asserts the extension rule: at most one extension per transaction, the cap of 20, and `close_at` never decreasing; the displayed change equals the stored change. `tests/close_race.rs` has two interleavings, each made deterministic by a test hook placed immediately after the auction lock is acquired. In interleaving A the bid commits first, the clock finds `close_at` moved and does nothing. In interleaving B the clock commits first, and the bid waits, then is refused with `LOT_NOT_OPEN` and writes no event. A third test starts four clock workers against 500 lots with passed deadlines and asserts exactly one `lot_closed` per lot.
- Observable in the demo: the ring extending twice at steps 192 and 196, and the gavel firing once at steps 206–214.

**Claim 5. A rewritten audit record is detected in-chain at its exact sequence number; a recomputed history is detected against the anchor, which names the first divergent sequence number.**
- Test: `tests/tamper.rs` builds a chain of 500 events, writes a checkpoint at 250 with its per-sequence hash list, and then, as the owner role, disables the trigger, modifies event 180, and recomputes hashes from 180 onward. Assertions: the in-chain verifier reports `hash_mismatch` at 180 when the chain is naive-edited; after the recompute, the in-chain verifier reports no mismatch, and the anchor verifier reports `anchor_divergence` at 180 against the checkpoint. A second test modifies only `lots.current_cents` and asserts `projection_mismatch` at the last event for that lot. A third test asserts that the anchor verifier refuses to produce a verdict when the object is not in compliance retention, and that the local run reports "no trust anchor".
- Observable in the demo: steps 266–300 in the Auditor pane, with the terminal session that performs both edits. Both the naive edit and the recomputed history are shown live, as in the script.

**Cross-cutting claim.** The local and AWS deployments run the same contract suite against the same images. The suite covers claim mapping for both identity providers and a fixed set of authorization decisions for fixed tokens. Its result is published as a table with one row per test and one column per environment. The known differences in E.2 are the only permitted failure rows, each an explicit allow-list entry with a reason. The anchor test is an AWS-only row by design.

---

## G. Failure analysis

### G.1 Implementation difficulties

**The sequence gap problem.** A `bigserial` assigned at insert and read by a poller exposes a hole whenever a later insert commits first. Waiting a fixed interval or using snapshot horizons either adds latency or still allows a gap when a long transaction stalls. The chosen fix serializes sequence assignment per auction under the auction row lock. The bid path therefore holds the auction lock for the full transaction, including proxy evaluation and the outbox insert. The transaction must stay short, and any remote call in it would be a defect.

**Lock ordering.** Every event-appending transaction takes the auction lock first, then the lot, then the settlement row, then ledger writes. The clock worker's discovery is unlocked, and its state change takes the auction lock, so it cannot deadlock with the bid path: both take the same first lock. The rehearsal treats a Postgres deadlock error as a test failure, and a single helper enforces the order (D.4).

**Hash chain cost and canonical JSON.** The chain is verifiable only if the bytes hashed are reproducible. Payloads are canonicalized (sorted keys, no insignificant whitespace, integers only) before hashing, and a test fixes the expected hash for every event kind. A change to any payload shape therefore fails a golden test, which is intended.

**Realtime replay correctness.** The reader must never deliver `auction_seq` n+1 before n, must not skip a sequence after a restart, and must bound its replay for a long disconnection. The reader keeps a cursor per subscription and returns a `resync_required` frame if `from_seq` is older than the retained window. The retained window is the full auction history for the demo; the snapshot-plus-tail design is documented, not built.

**Anti-sniping on a clock.** The database clock is authoritative, but the client renders countdowns from a measured offset. Offset drift on a long-running tab can make the ring disagree with the server by a fraction of a second. The client re-syncs the offset every 15 seconds and treats the ring as a display only. The amber state and the displayed remaining time come from the server projection, not from the client's own arithmetic.

**Outbox and trace propagation.** The notifier's span is a child of the bid's span through the stored `traceparent`. The cost is one text column.

**Cedar and attribute loading.** Authorization needs attributes not in the token. Loading them inside the transaction adds queries to every bid. This is acceptable at demo volumes and is the reason the decision is made in the same transaction as the write.

**Keycloak versus Cognito claim differences.** Cognito places groups under `cognito:groups`; Keycloak places them under a configured claim. The services read a configured claim name, and the attributes Cedar uses must be mapped identically. The contract suite with fixed tokens from both issuers catches drift.

**Aurora and local Postgres parity.** Aurora's default parameter group, statement timeout and connection limits differ from the `postgres:16` container. The application sets its own statement and lock timeouts explicitly from one shared configuration file.

**Trace backend ingestion.** Spans reach the trace backend after an export delay, and X-Ray's query path has its own ingestion latency. The Console's trace panel shows "pending" until the trace is queryable and then fills in. The measured ingestion time is recorded in rehearsal. The presenter's trace step does not depend on the trace being ready in time: the panel is designed to fill in after the step.

### G.2 On-stage failure modes and mitigations

| Failure | Effect on the demo | Mitigation |
|---|---|---|
| Venue network fails | AWS run impossible; Floor and bidders stop receiving frames | The presenter uses a prepared second network link, tested in rehearsal. If the AWS run is unreachable before the start, the presenter runs the local fallback from reset. Mid-script switching is not attempted. |
| Projector resolution differs | Floor layout breaks | Floor view is designed at a 16:9 reference with viewport units. Rehearsal includes 1280x720 and 1920x1080 checks. |
| SES sandbox rejects an unverified recipient | Buyer or consignor email missing at 240–256 s | All demo recipients verified before the run. The notifier logs send failures to the Console, and the Console shows the state from the notifier's own record. |
| Realtime task restart is slow | Reconnect gap longer than planned | Replay is by sequence, so a longer gap means more events to replay; the chip shows the count. The Floor shows "Reconnecting" meanwhile. Rehearsal times a restart from a cold container. |
| Proxy click missed | Ana's proxy not set; steps 100–120 empty | Floor still shows state, and the script continues: Ben's bids remain valid under the ladder. The rehearsal asserts the proxy path separately. |
| Final bid late | The ring closes before Ben bids | The close is correct and the Console says so. The presenter continues to settlement. The rehearsal includes a scripted fallback bid. |
| Clock replicas disagree on time | Lot closes early or late | Clocks are database-side only. Replicas do not read local time for decisions. |
| Tracing collector down | Trace panel empty | The panel shows the trace ID and "collector unavailable". The waterfall is not on the critical path. Spans are buffered and dropped without blocking. |
| Notifier crash during send | Duplicate email (bounded to one per crash) | The two-phase claim (D.3) and the stated window. The Console shows the send attempt count so the duplicate is visible, not hidden. |
| Checkpointer fails before 256 s | No checkpoint #2 | The verifier reports "no anchor newer than checkpoint #1". The in-chain steps still run. The anchor step is shown as unavailable and the finale's second half cannot run, which the presenter says on stage. |
| Owner-role terminal session fails | No tamper | The owner role is provisioned explicitly with trigger rights; the rehearsal runs the saved tamper and rehash scripts before the demo. |
| Browser animation jank | Ring stutters | The ring uses CSS transforms on a composited layer. The rehearsal checks state, not frame times (E.3). |

### G.3 Hidden complexity

- **Idempotency is harder than it looks.** The stored response must be exactly the one the first request would have produced, including `auction_seq` and any proxy counter-bid. The response is stored in the same transaction as the bid, so a crash cannot leave a stored response without its effect or the reverse.
- **Redaction is a correctness property.** A bidder's frames must not contain the reserve, and reserve data can leak through aggregates, such as a reserve-met flag, or through event payloads that a later export includes. The projection module computes the flag only as a boolean, only for the lot's consignor and the auctioneer, and tests cover every record type.
- **The extension rule is stated in terms of what changed.** A rule that moves a deadline to "now plus window" changes it by a different amount for each bid. The display shows the change, so the number on screen always equals the stored change.
- **Ledger balance is a deferred constraint.** A bug surfaces at commit, not in the code that caused it. The settlement tests exercise each step's failure path.
- **Event canonicalization** is the single most fragile piece. Only one crate serializes events; the others depend on it.
- **Clock sync on the client** is not trivial. The ping-based offset ignores outliers and is re-measured after tab sleep.

### G.4 Features that look impressive but are shallow

These are listed so that an expert audience cannot find them before we do.

- **Floor animations.** The ring pulse, the tick flight and the gavel are CSS and Framer Motion effects over real state. They fire on real events but do no work that a plain counter would not.
- **The ladder visual.** It renders the real rule. It is still a table of bands and steps, and it does not show jump bids as a special case.
- **Settlement.** Four steps and two ledger accounts per party. It is a sound saga for this scope and is not a payments system: no chargebacks, currency conversion, tax, or bank. The deposit hold is an internal ledger movement.
- **Proxy bidding.** One proxy per bidder per lot, with a single counter-bid per transaction in the demo. It is real and correct, but not a general auto-bidding strategy engine. The maximum's ceiling is inferable as a lower bound (D.5), which is standard for proxy bidding and is stated on the proxy card.
- **Authorization.** A dozen Cedar rules across five roles. The policy set is small enough to read in full, which is a feature for the demo and a limit in production.
- **Audit anchoring.** On the AWS run, the checkpoint sits in a bucket in the same account as the database. In S3 Object Lock compliance mode, no principal in that account, including its root user, can overwrite or delete a locked version before its retention date, so the account's administrators cannot rewrite the anchored copy. They can stop the service, empty nothing that is locked, or close the account, and the verifier cannot detect those actions. The verifier checks the object's retention mode and date on each run and refuses to produce an anchor verdict if they are not compliance and in the future. The local run has no anchor and says so.
- **Checkpoint retention.** Compliance-mode objects cannot be removed before their retention date. The demo keeps them for the configured period and a lifecycle rule removes them afterwards. The bucket is retained by the stack. Repeated demo runs accumulate checkpoints until they expire; the on-screen date is read from the object, not fixed.
- **Realtime replay window.** The full auction history is retained, which is correct for a demo and wrong for a production auction with millions of events. The snapshot-plus-tail design is documented, not built.
- **Multi-auction.** The seed has two auctions, but the script uses one. Cross-auction behaviour is tested, not shown.
- **Identity parity.** Two identity providers are kept, and the contract suite covers claim mapping and a fixed set of decisions. It does not prove full behavioural equivalence of the two providers' token lifecycles.
- **Observability dashboards.** The ops board is a list of health checks and counters. It is honest but not a monitoring product.

---

## H. Feasibility

The work is organised by dependency order. Each layer is runnable and testable on its own, and each later layer depends only on earlier ones. No durations are given.

### H.1 Layers and what each touches

1. **Schema, events and the bid transaction.** Migrations for D.2, the canonical event serializer, the hash chain, the global lock helper, the ladder check, the extension rule and the bid function. Touches one crate, the database and the migration runner. Testable by the concurrency and chain tests (claims 1 and 5) with no HTTP.
2. **API commands with idempotency, Cedar and the demo fault layer.** REST command handlers, the `idempotency_keys` path, Cedar policies and the entity loader, the projection module with the redaction table. Touches the API crate and the policy directory. Testable by the idempotency test (claim 2).
3. **Realtime projection and replay.** WebSocket server, the poll reader, the `from_seq` protocol and the resync frame. Touches the realtime binary and the projection module. Testable by the replay test (claim 3).
4. **Web: Floor, Bidder, Console.** React application over the realtime client, the REST client, the ladder component and the countdown. Touches the front-end project only. Testable by component tests and by the first part of the Playwright script.
5. **Clock worker and anti-sniping.** Due-lot discovery, the guarded close under the lock helper, the extension rule. Touches the worker binary. Testable by claim 4, including both interleavings.
6. **Outbox, notifier, settlement saga and ledger.** Outbox relay, SQS and SMTP adapters, the two-phase notifier claim, settlement steps, deferred ledger constraint. Touches the worker binary and the notifier, with ElasticMQ and Mailpit containers. Testable by the settlement failure-path tests and the notifier's duplicate test.
7. **Checkpointer, verifier and the Auditor pane.** Checkpoint writer with per-sequence hash lists, Object Lock adapter (MinIO first, then S3), the verifier's three checks, and the Auditor UI. Touches the checkpointer, the verifier and the owner tools. Testable by claim 5.
8. **Tracing.** OpenTelemetry instrumentation across API, realtime, workers and the front end, `traceparent` through the outbox, the trace query API and the Console panel. Touches every binary and the front end. Testable by a span-tree assertion in rehearsal.
9. **Compose stack and reset.** `compose.yaml`, seeds, reset and open commands, health and readiness endpoints, edge routing. Testable by `make reset && make rehearse` locally.
10. **CDK stack and AWS run.** VPC, ALB, ECS services, Aurora, SQS, SES identities, S3 Object Lock bucket, Cognito pool, IAM roles, secrets, image pipeline with digest pinning, the trace query role. Touches the infrastructure project only. Testable by the contract suite and the rehearsal against the ALB.
11. **Rehearsal harness.** Playwright script for the full run with state-based assertions and the event ledger. Touches the end-to-end project only.

Layers 1 to 3 form the minimum vertical slice: a serialized, authorized, idempotent, replayable bid path. Layers 4 to 9 are successive capability layers, and layer 10 changes only the deployment target.

### H.2 Critical dependencies

- **PostgreSQL 16** for the transaction, lock, trigger and deferred constraint semantics.
- **sqlx** for compile-time query checking. A query change that breaks the schema fails the build, which makes migrations order-sensitive.
- **Cedar (cedar-policy crate)** for in-process authorization. Its entity loading is the integration point with the transaction.
- **OpenTelemetry Rust crates**, whose APIs change across releases. Pinned versions are required.
- **Keycloak, ElasticMQ and MinIO** as local stand-ins, each with the gaps listed in E.2. Each is replaceable by its AWS counterpart through configuration.
- **AWS services** on the AWS run: Aurora, ECS Fargate, ALB, SQS, SES (sandbox), S3 with Object Lock, Cognito, X-Ray, Secrets Manager, ECR, CDK.
- **Playwright** for the rehearsal, the one runner that drives four sessions in one scripted run.

### H.3 Main risks

1. **Per-auction lock throughput.** The auction lock is the single serialization point. Risk: the bid transaction holds the lock longer than the animation budget allows under load. Mitigation: measure in layer 1; keep the transaction free of remote calls; the realistic demo load is a few bids per second.
2. **Realtime replay correctness.** Risk: a subtle ordering bug in the reader. Mitigation: claim 3 is a test before the web layer exists; the reader is built as a pure function over an in-memory event list first.
3. **Canonical JSON and hash stability.** Risk: a payload change silently invalidates the chain. Mitigation: golden hashes per event kind, and a rule that payload shapes change only by adding a new event kind.
4. **Identity parity.** Risk: claim shapes differ and lead to different authorization decisions locally and on AWS. Mitigation: the narrowed contract suite with fixed tokens from both issuers, run before the AWS layer is considered done. Accepted residual: token lifecycle behaviour is not proven equivalent.
5. **SES sandbox and email delivery in the live run.** Risk: a sandbox limit or bounce blocks steps 240–256. Mitigation: pre-verified recipients, and the Console shows the state from the notifier's own record rather than SES's delivery status.
6. **WebSocket behaviour through the ALB.** Risk: idle timeouts, draining during deploys, or sticky-session misconfiguration. Mitigation: explicit idle timeout, low deregistration delay for the realtime target group, and a rehearsal that restarts a realtime task behind the ALB.
7. **Trace propagation and trace readiness.** Risk: spans that appear detached, or a trace not yet queryable when the panel opens. Mitigation: the span-tree assertion in layer 8; the pending state in the panel; the measured ingestion time recorded in rehearsal.
8. **Animation performance on the projector.** Risk: a frame drop during the final window, the most visible moment. Mitigation: composited CSS transforms and a reduced-motion setting that keeps the state change and removes the flight animation. The rehearsal asserts state, not frame times.
9. **Scope creep in the Floor view.** Risk: the visual layer grows faster than the architecture it depicts. Mitigation: no new visual is added to the script unless a capability it shows is already in the inventory.
10. **The tamper step's credibility.** Risk: an expert audience decides the tamper is contrived. Mitigation: the threat model is on screen before the edit; the edit uses the same owner role a real owner would have; the verifier reports only what it can prove, and the local run labels what it cannot.
11. **Owner-role and stage-network risk.** Risk: the owner session or the second network link fails on the day. Mitigation: both are exercised in rehearsal, and the local fallback (G.2) is a complete script.

### H.4 What the proposal does not claim

- It does not claim throughput beyond what a live room needs. Serialization per auction is the stated design, and the rehearsal reports measured figures.
- It does not claim that the audit anchor is independent of the cloud account's administrators. It claims that no principal in the account can rewrite a locked copy, and that the account can still be stopped or closed, which the verifier does not detect.
- It does not claim exactly-once email delivery. It claims at-least-once delivery with a bounded, stated duplicate window.
- It does not claim a production-grade ledger, payments processing, or tax handling.
- It does not depend on any live third-party service in the core demonstration. Cognito, SES and X-Ray are AWS services on the AWS run, and each has a local stand-in with the documented differences.
- It does not claim that the local run can show the anchored finale. The local run shows the in-chain detection and labels the anchor step.
