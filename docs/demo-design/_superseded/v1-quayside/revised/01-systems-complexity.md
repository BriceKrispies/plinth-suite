# Competitor 01 — Systems Complexity (revised)

**Product title: Tallyhouse — a live auction house where every bid is a transaction.**

**Pitch.** Tallyhouse is a consignment auction house on AWS (ECS Fargate, RDS PostgreSQL 16, SQS FIFO, S3) that runs from the same container image locally against PostgreSQL 16, ElasticMQ and MinIO. In five minutes a presenter drives four browser sessions through a proxy-bid war, a 180-request concurrent bid burst, a dropped WebSocket that replays its missed events, an anti-sniping close and a settlement saga whose worker is SIGKILLed mid-payout, then proves the ledger balances, the event and audit chains verify and nobody was paid twice.

---

## Revision log

Each finding from the three reviews is listed with the response. "Fixed" names the section where the change lives. "Rebutted" gives the technical reason the finding does not hold as stated. "Accepted" means the limitation remains and is stated in section G.

| # | Finding (reviewer) | Response | Where |
|---|---|---|---|
| 1 | Proxy maxima readable via settable `app.role` GUC (A, B) | Fixed. The application role has no privilege at all on `proxy_bids`, so no GUC can grant a read. Maxima are read only inside the SECURITY DEFINER function `engine.resolve_proxies()`, which returns outcomes, never maxima. The owner's own maximum is read by `engine.own_proxy_max(principal)`. The GUC is no longer used for proxy secrecy. | D.2, D.5 |
| 2 | Maxima tests cover only the public endpoint (A, B) | Fixed. `TestMaximaAbsentFromAllReadPaths` seeds canary maxima and asserts absence on every read path (REST, WebSocket frames, replay, `auction_events`, audit bodies, SQS bodies, rebuild output, Prove-it, operator console). | F claim 4 |
| 3 | `auction_events` is unhashed and outside the audit chain; the tamper scene edits a copy of the audit log, and rebuild check (c) passes if events and projection are both edited (A, C) | Fixed. Events form a per-auction hash chain over exact stored bytes. Every event has an audit row that carries the event's hash, and the verifier cross-checks both. Rebuild first verifies the event chain. A rewriter who recomputes both chains and the audit rows is not detected; this is stated in the closing line and in G.4. | D.2, D.4, F claim 5, C 275–300 |
| 4 | Closing line "cannot be edited without a visible break" overstates G.4 (A, B, C) | Fixed. The closing line is rewritten to say what is detected and what is not. | C 275–300 |
| 5 | Counter-bid arithmetic 2,500 + 50 = 2,550, not 2,600 (A) | Fixed. | C 45–60 |
| 6 | Sequence numbers contradict each other (412, 413, N = 226, 4,611, 4,636) (A, C) | Fixed. One counter: `auction_events.seq` assigned under the auction lock as last + 1. The reset head is 9 (seed events). Every later value is a formula over that head and measured counts (A, P, R, H1, H2, H3). No number in section C is typed as a fact about the run. | C, D.2 |
| 7 | 25-bid burst scripted as accepted while competing bids are refused (A) | Fixed. The burst reports measured accepted, refused and proxy-counter counts. The Burst 25 driver is sequential, and its counts are displayed, not asserted. | C 60–100, 115–135 |
| 8 | Burst size 200 in pitch and claim 1, 180 in section C (B) | Fixed. The pitch, section C and claim 1 all use 180 requests, 60 per bidder across three bidders, of which 14 are idempotent retries. | Pitch, C, F claim 1 |
| 9 | Countdown 00:04 at about 135 s versus `ends_at` six minutes after reset; operator "Force close in 2 s" rewrites the deadline (A, B) | Fixed. The seed sets `ends_at` to reset plus 150 s, the anti-sniping bid is gated on a countdown between 00:10 and 00:05, and the Force-close control is removed. No operator control writes `ends_at`. | A, C 0–150 |
| 10 | Withdrawal race at 160–180 depends on the forced close, so contention is staged (B) | Fixed. Withdrawal is attempted after the organic close, when the console shows `closing`. The outcome is a state guard, not a race. The lock race is covered by test (F claim 1, `TestLockOrderNoDeadlock`) and is not claimed as organic on stage. | C 170–185, F claim 1 |
| 11 | Relay marks whole batch sent, dropping per-entry Failed results (A) | Fixed. Per-entry results are read; only successful ids are marked; a failed entry blocks later entries of the same group in that batch. | D.3 |
| 12 | Singleton advisory-lock relay conflicts with SKIP LOCKED relay (A) | Fixed. Relay: one active leader by session advisory lock, which gives a single ordering model. Scheduler: `SKIP LOCKED`, safe under any worker count. Stated in D.1 and D.3. | D.1, D.3 |
| 13 | ECS StopTask described as SIGKILL with a KILL reason; StopTask takes a free-text reason and sends SIGTERM before SIGKILL (A, B, C) | Fixed. The demo does not use StopTask for the fault. The worker sends SIGKILL to its own process on an armed request, in both environments. The orchestrator only restarts the task. ECS's SIGTERM-then-SIGKILL behaviour applies to ordinary stops and is not part of the demo beat. | C 205–225, D.5, E.2, E.3 |
| 14 | "Identical semantics" for local `docker kill` and AWS (B) | Fixed by the change in 13: both environments deliver the same in-process SIGKILL. The local harness additionally kills by OS signal in its own tests, which is the same signal from a different sender. | E.2, F claim 3 |
| 15 | Duplicate-skipped line not reachable; SES does not dedupe on Message-ID; dedupe row cannot share a transaction with an external send (A, B) | Fixed. The duplicate line is removed. The demo has no external email. Step 4 writes a `notifications` row keyed by `settle:{lot}:notify` in the step transaction. The real at-least-once boundary for any future external send is stated in G.2. | C 240–255, G.2 |
| 16 | Each email appears exactly once is overclaimed (B) | Fixed. The claim is one recorded notification per lot per step key, with the external send out of scope. | F claim 3 |
| 17 | Denied-withdrawal audit in the same transaction as the 409 would roll back (C) | Fixed. One rule everywhere: denial audit rows are committed in their own transaction before the error response is returned. | D.4, D.5 |
| 18 | Audit hash computed over `jsonb`, which does not preserve key order or whitespace (C) | Fixed. Hashed bytes are stored as `bytea`, and a golden re-read test checks that the stored bytes hash to the stored hash. | D.2, F claim 5 |
| 19 | Outbox relay runs `SendMessageBatch` inside a row-locked transaction, contrary to G.1 item 4 (C) | Fixed. The relay reads, sends outside any transaction, then marks sent in a short transaction. No row lock is held across network I/O. | D.3, D.4 |
| 20 | Bid path has no SQS call, so the in-transaction SQS concern is moot | Rebutted in part. The bid transaction contains no network call; it writes the outbox row only. Stated so reviewers can check it. | D.4 |
| 21 | Kill beat depends on SQS visibility redelivery that may differ between ElasticMQ and SQS; fixed 22 s restart window (C, G) | Fixed. The restart wait is event-driven (a new worker heartbeat, then step 3 committing). Redelivery is an outcome assertion only. The fault is one-shot and is consumed by the kill, so the replacement worker does not pause again. | C 225–255, G.2 |
| 22 | Rebuild is a second implementation of the bid rules (A, C, B) | Fixed. Rebuild uses the same event applier as the live path. It does not re-derive bid rules; it checks that the projection is a deterministic function of the event log. Bid rules are tested separately against invariants. The residual gap is stated in G.3 and G.4. | D.4, G.3 |
| 23 | `committed_at` and `server_time` excluded from the rebuild hash, so Prove-it compares a subset (B) | Fixed by naming. The Prove-it panel lists every hashed field. `committed_at` is stored but not hashed; `server_time` is a frame field and is not stored. Both are listed as not covered. | C 255–275, D.2 |
| 24 | Replay-then-live handoff for subscriptions not specified (A) | Fixed. Subscribe to live first, buffer, replay from `auction_events`, then drain the buffer with de-duplication. | D.3 |
| 25 | Restart-then-"one credit" and the duplicate-key claim (A) | Covered by F claim 3 with kill points at four states and an attempt log that is written outside the step transaction, so it survives the kill. | D.2, F claim 3 |
| 26 | Twenty-six scenes with four windows in 300 s; window switches about every 10 s (B) | Fixed. The script has fourteen scenes. Each window switch has a visible result. | C |
| 27 | Scene counts and burst numbers contradict each other across the script (C) | Fixed by 6 and 7. | C |
| 28 | Projection and ledger tests named but hash field lists unclear (B) | Fixed by 23. | F claim 4 |
| 29 | Closing line and G.4 tamper claim (B) | Fixed by 4. | C, G.4 |
| 30 | ElasticMQ FIFO fidelity (C, A) | Accepted as a known limitation. The contract suite pins the subset used; the script asserts outcomes, not redelivery timing. | G.2, H.4 |
| 31 | Price movement reveals a lower bound on a proxy maximum (self-review) | Accepted and disclosed on G.4. Every proxy system leaks this through price; the claim is that the maximum itself is never exposed. | G.4 |
| 32 | Application-role GUC still used for ledger and bid RLS (self-review) | Accepted and scoped. RLS on ledger and bids defends against forgotten filters, not against principal confusion inside the API process. The only DB-enforced secrecy claim is the proxy-maximum grant. | D.5, G.4 |

---

## A. Product concept

**Application.** Tallyhouse is the operating system of a small consignment auction house. One deployment hosts one house with a deterministic sample catalogue: three auctions (one live, one scheduled, one closed), 24 lots, 40 user accounts. The seed fixes every UUID and every relative timestamp, so a reset always produces the same starting state.

**Users and roles.**

| Role | Who | What they can do |
|---|---|---|
| Consignor | Sellers, e.g. "Priya" | Create lots, upload photos through scoped presigned POST, see reserve status and proceeds for their own lots, withdraw a lot while the auction is open. |
| Bidder | Registered buyers, e.g. "Mara", "Joon", and burst drivers "Ada", "Ruth", "Tomas" | Register against a deposit held in the ledger, place direct bids, set a private proxy maximum, see public price and leader status. Never see another bidder's maximum. |
| Auctioneer | "Ines", who runs the room | Open, close and inspect auctions, see the full bid log, run invariant checks, operate the settlement queue. |
| Auditor | Compliance reader | Read the audit log and verify its chains. Cannot read proxy maxima or individual balances. |
| Operator | The demo operator, a tab in the auctioneer console, gated by role `operator` and by `TALLYHOUSE_DEMO_FAULTS=1` | Launch bursts, drop a socket, arm and fire the worker fault, reset, tamper with a scratch copy. |

**Problems solved.** Live auctions have four hard problems that generic CRUD does not face: many writers racing on one current price; hidden state (a bidder's maximum) that must stay hidden from every other principal; deadlines that a single clock must enforce; and money-like movements that must balance and must not be applied twice when a process dies mid-way. Tallyhouse handles all four in one domain, and each is visible in a second window.

**Why it suits this demonstration.**

- A bid that loses a race is refused with the committed price, not dropped.
- A proxy maximum exists and is never shown to anyone else, yet the price moves as if it were shown.
- The countdown jumps by 30 seconds when an anti-sniping bid lands, because the database clock says so.
- Settlement steps appear one at a time, each with its ledger transaction identifier.
- When the worker is killed mid-payout, the consignor's "proceeds pending" indicator keeps waiting and then completes, and the ledger shows one credit.

**Deliberately absent.** No payment processor (funds are ledger entries; section G says so), no mobile clients, no multi-house tenancy, no search, no external identity provider, no outbound email. Each would add surface without adding a property the audience can watch.

---

## B. Capability inventory

**demonstrated** means shown live in section C and covered by a claim in section F. **supporting** means required for the demonstrated capabilities to work or to be operated.

| # | Capability | Status | Technical significance | Interactions |
|---|---|---|---|---|
| 1 | Transactional bid engine: `SELECT ... FOR UPDATE` on the auction row, increment check, sequence assignment as last + 1, event append with hash chaining, outbox row, `NOTIFY`, audit rows, all in one transaction. | demonstrated | The auction row lock is the serialization point. Lost updates are impossible by construction. | Feeds 2, 4, 5, 10. |
| 2 | Proxy bidding with hidden maxima, resolved under the same lock by a SECURITY DEFINER function that returns outcomes only. | demonstrated | Domain logic inside the critical section. Ties go to the earlier maximum. | Uses 1's lock; hidden state protected by 8; outputs replayed by 5. |
| 3 | Anti-sniping on the database clock; scheduler closes due auctions with `FOR UPDATE SKIP LOCKED`. | demonstrated | Clock skew between containers and browsers is not a correctness input. | Extension under 1's lock; hands off to 6 on close. |
| 4 | Transactional outbox and single-leader relay to SQS FIFO with per-entry result handling. | demonstrated | Dual-write problem solved. Ordering is per auction. Delivery is at least once. | Carries settlement messages to 6. |
| 5 | Commit-ordered fan-out and gap-free replay: `NOTIFY` in the bid transaction, per-task `LISTEN` with a high-water mark, subscribe-then-replay handoff, `after=<seq>` on reconnect. | demonstrated | Clients never see an uncommitted event and never see a gap. | Depends on 1's event log. Used in the socket-drop scene. |
| 6 | Settlement saga: four steps (hold, transfer, credit, notify), each in one transaction with a unique business key, an attempt log written outside the step transaction, and redelivery acknowledged when the step already committed. | demonstrated | Exactly-once effects from at-least-once delivery plus a uniqueness constraint in the effect's own transaction. | Consumes 4; writes 7 and 10. Its failure is the fault scene. |
| 7 | Double-entry ledger with a deferred constraint trigger that checks each transaction sums to zero at commit, and a unique `business_key`. | demonstrated | Books are a checked invariant, not a report. | Written by 6 and 1 (deposits). Read by Prove-it and the proceeds view. |
| 8 | Authorization at two layers: an application policy table (role × action × ownership, default deny) and database grants. Proxy maxima are reachable only by the engine function. RLS with `FORCE` on ledger and bid tables, keyed on `app.principal_id` set with `SET LOCAL`. | demonstrated | Secrecy of maxima does not depend on any session setting. | Protects 2's state and 7's balances. Denials feed 10. |
| 9 | Session security: EdDSA access tokens (5 minutes), opaque refresh tokens rotated on use, family revocation on reuse. | supporting | Standard, with failure cases tested. | Issues the principal that 8 checks. |
| 10 | Hash-chained audit log over exact stored bytes, with per-auction event chains that every event audit row cross-references. Denials and every settlement step are audited. Verifier names the first broken sequence number in either chain. | demonstrated | Tamper evidence for naive edits, located exactly. Not tamper-proof against a rewriter (G.4). | Covers 1, 2, 6, 8. Verified in the closing scenes on a scratch copy. |
| 11 | S3 lot photos with presigned POST and key-prefix, content-type and content-length conditions. | supporting | API and object storage separated without proxying bytes. | Gated by 8. |
| 12 | Projection rebuild with a shared event applier and a hash over named fields, compared with the live projection. | demonstrated (Prove-it) | Determinism of the event log is checked. | Reads 1's events. Hash shown next to 10's head. |
| 13 | Health, readiness, worker heartbeat, idempotent reset to the seed. | supporting | The kill scene's recovery is observable. | Readiness gates the health checks that restart the worker. |
| 14 | Browser rehearsal: Playwright drives the four sessions through the script against either deployment. | supporting | Repeatable run and a pass/fail signal before the stage. | Exercises 1–10 through the UI. |

**Interaction summary.** The core loop is 1 → 4/5 → 6 → 7 → 10. A bid is one transaction that updates the auction, event chain, outbox, notification channel and audit together. A close is a scheduled transaction that hands a message to the saga. The saga writes the ledger and audit log. Proxy resolution sits inside the bid lock, which is what makes it hard and what makes the burst meaningful. Authorization guards the hidden maxima and balances.

---

## C. Five-minute live script

**Layout.** Four windows tiled on one display: **Mara** (bidder, left), **Joon** (bidder, centre-left), **Priya** (consignor, centre-right), **Ines** (auctioneer, right, with the operator console in a second tab). The reset has logged all four in.

**Seed state.** Auction "Evening Sale" is open, with Lot 14 (a marine chronometer, starting price 2,000, increment 50, anti-sniping window 30 s). The seed writes two events, `auction_opened` and eight `lot_listed`, so the **reset head is H = 9**. `ends_at` is set to reset time plus 150 seconds. Nothing else in the seed is time-dependent.

**Counter.** Every sequence number is one counter, `auction_events.seq`, contiguous from 1, assigned under the auction lock. The symbols below are read from the run and are not typed into the script: **A** = direct bids accepted in the burst, **B** = burst requests refused as stale, **R** = idempotent replays, **P** = proxy counter events during the burst, **H1** = head after the burst, **H2** = head after Burst 25, **H3** = head after the anti-sniping bid. Fixed values are stated as fixed.

**Operator controls** (each enabled only when its precondition shows green): Launch burst, Check invariants, Drop socket: Joon, Burst 25, Arm fault, Kill worker, Prove it, Tamper scratch copy, Verify scratch, Reset. No control writes `ends_at`.

| Time (s) | Presenter action | Expected behaviour | Visible result | Capabilities | Next |
|---|---|---|---|---|---|
| 0–15 | Says: "A live auction house. Four people, one database, every number on these screens is a committed fact." | Four sessions connected. | Strip shows "committed seq 9 · in sync". Identical price 2,000, no leader, countdown 02:15 in all windows. | 5, 9 | "Watch what happens when two of them want the same lot." |
| 15–30 | Ines reads the rules panel aloud. | Rules are read from the auction row and the config table the engine uses. | Increment 50, anti-sniping 30 s. | 1 | "Mara has set a maximum. Joon is about to bid against it." |
| 30–45 | Mara sets a proxy maximum of 4,000, then bids 2,100 directly. | Maximum stored in `proxy_bids` (no event; audit row records that a maximum was set, with no amount). Bid is event seq 10. | All windows: price 2,100, "committed seq 10". Mara: "You lead. Your maximum: 4,000 (only you can see this)." Others: "Leader: a bidder." | 1, 2, 5, 8 | "Now Joon bids the way a person would." |
| 45–60 | Joon bids 2,500. | Joon's bid is seq 11. The engine reads Mara's maximum under the lock and counter-bids at 2,500 + 50 = **2,550** (below 4,000), seq 12, same transaction identifier. | Joon: 2,550, "You are not leading." Mara: 2,550, "You lead." Nobody sees 4,000. Ines's log shows 11 and 12 with the same tx id. | 2, 5, 8 | "Now the room gets busy." |
| 60–100 | Ines clicks **Launch burst**: three seeded bidders (Ada, Ruth, Tomas), 60 concurrent requests each, 180 in total, each with an idempotency key. 14 of the requests reuse an earlier key. | Lock serializes the direct bids. Stale increments return 409 with the committed price. Retries return the stored response and create no event. Proxy counters for Mara are counted separately. | Step plot, one step per committed event. Counters, all read from the database: attempted 180; accepted A; refused B; replays R (asserted equal to 14); A + B = 166; proxy counter events P. Head becomes H1 = 12 + A + P. | 1, 2, 5, 13 | "Did every window see every step?" |
| 100–115 | Ines clicks **Check invariants**. | Five SQL checks on the live auction, the same assertions as the tests. | Five rows with the count checked: events 1 to H1 contiguous; sum of increments (direct and proxy) equals price minus 2,000; no duplicate idempotency key per bidder; price non-decreasing; leader equals the bidder of the last price-setting event. | 1, 5, 12 | "Now a window loses its connection." |
| 115–135 | Ines clicks **Drop socket: Joon**. The server closes Joon's socket and holds reconnection for 8 s (labelled on screen as "fault: reconnect held 8 s"). Then **Burst 25**: Tomas sends 25 direct bids one after another. | Joon's last applied seq is H1. The 25 bids commit, and their accepted and refused counts are measured. Joon sends `after=H1`; the server replays (H1, H2] from `auction_events` in order. | Joon: "reconnecting, last seq H1", then 25 steps appear in order without reload, then "caught up at seq H2". Panel: SHA-256 of Joon's price series over seqs 1 to H2 equals the server's over the same range. | 5, 1 | "Auctions close on the database's clock." |
| 135–150 | Ines watches the countdown; Mara's **Bid minimum** button enables only while the countdown reads between 00:10 and 00:05. | Gate is the console's precondition. | Countdown reads 00:10 at about 140 s. | 3 | (no talk) |
| 140–150 | Mara clicks **Bid minimum** (price + 50) at 00:10. | Bid is seq H2 + 1 (H3). Transaction sets `ends_at = now() + 30 s` on the database clock. No counter-bid, since no other maximum exists. | All four windows: countdown jumps to 00:30 in the same frame; event row shows "extended". | 3, 1, 5 | "Priya wants her lot out before it sells. The system says no." |
| 150–170 | Nothing is clicked. The scheduler closes at `ends_at`. | Scheduler claims the due auction with `SKIP LOCKED`, moves it to `closing` under the lock, writes the saga instance and its outbox row, and writes the close event. | Console: auction `closing`; final price equals Mara's bid; buyer shown to the auctioneer only. | 3, 6, 4 | "Watch the withdrawal, then the settlement." |
| 170–185 | Priya clicks **Withdraw lot** (enabled only once the console shows `closing`). Joon types the operator URL into her window. | Withdrawal is refused: 409 `lot_in_settlement`. The denial audit row is committed in its own transaction before the response. Joon's request gets 403. Both denials are audited. | Priya: "Lot 14 can no longer be withdrawn: in settlement." Joon: "Not permitted for role bidder." Ines's audit view shows both denial rows with principal and role. | 8, 10, 3 | "Now settlement runs." |
| 185–205 | Ines opens the **Settlement** tab. Nothing is clicked. | Relay sends the saga message to SQS FIFO with group = auction id. Step 1 "hold" commits: hammer moves from Mara's available account to escrow. Step 2 "transfer" sets the lot owner. Each step writes an attempt-log row first. | Steps 1 and 2 complete, each with ledger transaction id and audit row id. Mara's available balance drops by the hammer. | 4, 6, 7, 10 | "Step 3 pays Priya. It is also the step I am going to break." |
| 205–225 | Ines clicks **Arm fault**: the worker, on reaching step 3, opens its transaction, writes the credit, and holds before commit for up to 60 s. When the console shows "paused at step 3", Ines clicks **Kill worker**. | The worker process sends SIGKILL to itself on the armed request, in both environments. The open transaction aborts on connection loss. The SQS message is not deleted and reappears after its 15-second visibility timeout. The fault flag is consumed by the kill. | Step 3: "in progress, worker lost." Priya: "Proceeds pending." Health strip: worker gone. | 6, 4, 13 | "Watch it come back." |
| 225–255 | Ines waits. No timer is shown. | The orchestrator starts a replacement (ECS service with desired count 1; Compose `restart: always`). The replacement registers a heartbeat with a new instance id and takes the relay and scheduler locks. The redelivered message reaches step 3: the attempt log shows attempt 2; the unique key `settle:{lot}:credit` has no committed credit, so the credit commits once. Step 4 writes its notification row. | Console: "replacement registered" when the heartbeat appears; "step 3 resumed on attempt 2, one ledger transaction" when it commits. Priya: proceeds change from "pending" to hammer less 12% commission, read from the ledger. Health strip restored. | 6, 7, 4, 13 | "Now prove it." |
| 255–275 | Ines clicks **Prove it**. | Three checks, each with evidence. (a) Ledger: every transaction sums to zero; exactly one credit for lot 14; escrow zero. (b) Event chain for the auction verifies over H3 events; every event audit row references the matching event hash; the audit chain verifies over N rows; head hash shown. (c) Rebuild: events are replayed through the live applier into a scratch schema; the hash of the named projection fields equals the live hash; Joon's series hash equals the server's. | Three green panels. Field list on panel (c): auction id, state, current price, leader id, `ends_at`, last seq, version, and per event: seq, kind, amount, bidder id, `ends_at`, tx id. Shown as not covered: `committed_at` (stored, not hashed) and `server_time` (frame field, not stored). | 7, 10, 12, 5 | "The last thing is the one a naive edit cannot hide." |
| 275–300 | Ines clicks **Tamper scratch copy**, which changes Mara's amount on event seq H3 in scratch copies of `auction_events` and `audit_log` only, then **Verify scratch**. | Verifier walks the scratch event chain and the audit chain and reports the first break. The live chain is untouched. | Scratch: "Broken at event seq H3: stored hash does not match body (expected ..., recomputed ...)". Audit cross-check also fails at its row. Live: verified. Closing line: "Killed mid-payout. Books balanced. Nobody paid twice. A naive edit is caught at its exact row. A rewrite by someone with database write access is not, and the panel says so." | 10, 7, 6 | End. |

**Scene count:** fourteen. **Sequence arithmetic check:** the strip shows 9 at reset, 10 and 11–12 at the first two bid scenes, H1 after the burst, H2 after Burst 25, and H3 = H2 + 1 after the anti-sniping bid. Every value is derived from the counter.

**Amounts that depend on the run.** The hammer, the burst counts and the replay range are measured and shown; the document does not quote them as facts. The commission is 12% of the hammer as read from the ledger.

**First 30 seconds.** Purpose, layout and identical state across four windows.

**Last 30 seconds.** The kill at 205–225 followed by three checks at 255–275, then one edit on a scratch copy. The closing line states what is detected and what is not.

**Reliability.** Each control is enabled only when its precondition is shown green. The anti-sniping bid depends on the countdown gate; if earlier scenes overrun the 150-second deadline, the auction closes organically and the presenter re-resets. Nothing forces the deadline. The burst, the drop and the fault use the same code paths as ordinary traffic.

---

## D. Technical architecture

### D.1 Components

One Go module, one binary, `tallyhouse`, with subcommands. The subcommands are roles of one artifact, not a microservice split.

| Component | Technology and why | Responsibility |
|---|---|---|
| `tallyhouse api` | Go 1.23, `net/http` with `chi`, `pgx/v5`, `sqlc`, `github.com/coder/websocket`, `golang-jwt` with Ed25519. | HTTP JSON API, WebSocket stream, SPA serving, bid engine, proxy resolution calls, authorization, sessions. The API connects with the application role and a second pool with the engine role, used only by the bid package. |
| `tallyhouse worker` | Same binary. Three loops with explicit concurrency rules: scheduler (`SKIP LOCKED`, any number of workers); outbox relay (single active leader by session advisory lock on a dedicated connection); saga consumer (SQS receive, correctness from row locks and unique keys, any number of workers). | Closing, settlement, messaging, heartbeat, demo fault hook (only with `TALLYHOUSE_DEMO_FAULTS=1`). |
| `tallyhouse migrate`, `seed`, `reset`, `check` | Same binary. `goose` migrations as a one-shot task. | Operations and demo control. |
| Web SPA | TypeScript, React 18, Vite, TanStack Query, a hand-written WebSocket client that stores the highest applied seq and reconnects with `after=`. Embedded with `embed`. | Four role views and the operator console. |
| PostgreSQL 16 | RDS for PostgreSQL 16 in AWS, `postgres:16` locally. | System of record, event log, outbox, saga state, ledger, audit log, grants and RLS, advisory locks, `LISTEN/NOTIFY`. |
| SQS FIFO | Queue with DLQ (max receive count 5), visibility timeout 15 s. | Carries saga messages. Group id = auction id; deduplication id = outbox id. |
| S3 | Private bucket, SSE-S3, presigned POST. | Lot photos. |

### D.2 Persistence model

Schema `app`. Roles: `tallyhouse_app` (DML on application tables, no privilege on `proxy_bids`, no `BYPASSRLS`); `tallyhouse_engine` (NOLOGIN owner of the two proxy functions, the only role with read access to `proxy_bids`); `tallyhouse_migrator` (owns objects); `tallyhouse_auditor` (`SELECT` on `audit_log` and `auction_events` only). The application role is not a member of the engine role.

```sql
CREATE TABLE auctions (
  id uuid PRIMARY KEY, title text NOT NULL,
  state text NOT NULL CHECK (state IN ('scheduled','open','closing','closed')),
  start_price bigint NOT NULL, increment bigint NOT NULL CHECK (increment > 0),
  current_price bigint NOT NULL, leader_id uuid,      -- leader_id is never returned to bidders
  ends_at timestamptz NOT NULL,                       -- compared only with now() in the database
  last_seq bigint NOT NULL DEFAULT 0,                 -- the one sequence counter, under the row lock
  event_head bytea NOT NULL DEFAULT '\x00',           -- hash of the last event (32 zero bytes before seq 1)
  version bigint NOT NULL DEFAULT 0
);

CREATE TABLE auction_events (                          -- source of truth for the stream
  auction_id uuid NOT NULL REFERENCES auctions,
  seq bigint NOT NULL CHECK (seq >= 1),               -- last_seq + 1 under the lock; no sequence object, so no holes
  body bytea NOT NULL,                                -- exact canonical JSON bytes that are hashed
  prev_hash bytea NOT NULL, hash bytea NOT NULL,      -- hash = sha256(prev_hash || body)
  tx_id bigint NOT NULL,                              -- txid_current(), shown in the UI
  committed_at timestamptz NOT NULL DEFAULT now(),    -- stored, not hashed
  PRIMARY KEY (auction_id, seq)
);
-- body fields: seq, kind, amount, bidder_id, ends_at, state, lot_id; never a maximum; never committed_at.

CREATE TABLE bids (
  id uuid PRIMARY KEY, auction_id uuid NOT NULL, bidder_id uuid NOT NULL,
  amount bigint NOT NULL, kind text NOT NULL CHECK (kind IN ('direct','proxy')),
  seq bigint NOT NULL, idempotency_key text,
  UNIQUE (auction_id, seq), UNIQUE (bidder_id, idempotency_key)
);

CREATE TABLE proxy_bids (                              -- engine role only; no grant to any other role
  auction_id uuid NOT NULL, bidder_id uuid NOT NULL, max_amount bigint NOT NULL,
  set_at timestamptz NOT NULL, PRIMARY KEY (auction_id, bidder_id)
);

CREATE TABLE outbox (
  id bigserial PRIMARY KEY, topic text NOT NULL, group_key uuid NOT NULL, body bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);

CREATE TABLE saga_instances (
  id uuid PRIMARY KEY, lot_id uuid NOT NULL UNIQUE, state text NOT NULL,
  hammer bigint NOT NULL, buyer_id uuid NOT NULL, consignor_id uuid NOT NULL
);
CREATE TABLE saga_attempts (                           -- written in its own committed transaction before each step
  saga_id uuid NOT NULL, step text NOT NULL, attempt int NOT NULL,
  worker_instance text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (saga_id, step, attempt)
);
CREATE TABLE saga_steps (                              -- committed with the step's effect
  saga_id uuid NOT NULL, step text NOT NULL, tx_id bigint, audit_id bigint, attempt int NOT NULL,
  PRIMARY KEY (saga_id, step)
);

CREATE TABLE ledger_transactions (id bigserial PRIMARY KEY, business_key text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ledger_entries (
  tx_id bigint NOT NULL REFERENCES ledger_transactions, account text NOT NULL,
  amount bigint NOT NULL CHECK (amount <> 0), id bigserial PRIMARY KEY
);
-- constraint trigger, DEFERRABLE INITIALLY DEFERRED: SUM(amount) per tx_id must be 0 at commit.

CREATE TABLE notifications (business_key text PRIMARY KEY, lot_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, occurred_at timestamptz NOT NULL DEFAULT now(),   -- not hashed
  principal_id uuid, role text, action text NOT NULL, outcome text NOT NULL, resource text,
  body bytea NOT NULL,                                -- exact canonical JSON bytes that are hashed
  prev_hash bytea NOT NULL, hash bytea NOT NULL       -- hash = sha256(prev_hash || body)
);
CREATE TABLE audit_head (singleton boolean PRIMARY KEY DEFAULT true, hash bytea NOT NULL);

CREATE TABLE demo_faults (                             -- honoured only with TALLYHOUSE_DEMO_FAULTS=1
  id int PRIMARY KEY DEFAULT 1, armed_step text, kill_requested boolean NOT NULL DEFAULT false, consumed_at timestamptz
);
CREATE TABLE worker_heartbeats (instance text PRIMARY KEY, role text NOT NULL, beat_at timestamptz NOT NULL);
CREATE TABLE idempotency_keys (scope text, key text, response bytea, status int, PRIMARY KEY (scope, key));
CREATE TABLE sessions_refresh (family_id uuid, token_hash bytea PRIMARY KEY, principal_id uuid,
  used boolean NOT NULL DEFAULT false, revoked boolean NOT NULL DEFAULT false, expires_at timestamptz);
```

**Canonical form (hashed bytes).** The Go encoder writes UTF-8 JSON with keys sorted lexicographically, no insignificant whitespace, integers for all amounts, UUIDs in lower case, timestamps as RFC 3339 UTC with fixed microseconds, and `null` for absent values. The bytes are stored in `bytea` and are the only thing hashed. The verifier never re-serializes. A golden test reads each stored row back and checks that `sha256(prev_hash || body)` equals `hash`, and that re-encoding the decoded fields yields the same bytes.

**Notes.**

- `auction_events` duplicates `bids` on purpose: `bids` is the query model; `auction_events` is the ordered, hashed stream including non-bid events.
- The sequence is assigned as `last_seq + 1` under the row lock. A `bigserial` would leave holes on rollback; that is why it is not used for `seq`.
- Proxy secrecy is a grant, not a session setting. `tallyhouse_app` has no privilege on `proxy_bids`, so `SET app.role` or `SET ROLE` cannot read a maximum.
- The invariant SQL reads event bodies with `convert_from(body, 'UTF8')::jsonb`.

### D.3 Communication

**Synchronous.** Browser to API over HTTPS, JSON, `Idempotency-Key` on every command. API to PostgreSQL on `pgx` pools.

**Real-time.** `GET /v1/auctions/{id}/stream?after={seq}` upgrades to WebSocket. Frames are `{seq, kind, payload, server_time}`. The server heartbeats every 20 seconds against a 60-second ALB idle timeout. Frames are projected per viewer: bidder identities other than the viewer's own are replaced with "a bidder" in every frame and replay.

Fan-out path:

1. The bid transaction runs `NOTIFY auction_events, '<auction_id>:<seq>'` before commit. PostgreSQL delivers it only if the transaction commits. The payload is an identifier.
2. Each API task holds one dedicated `LISTEN` connection, outside the pool, and keeps a high-water mark per auction.
3. **Subscribe-then-replay handoff.** A new subscriber is registered first and its live notifications are buffered. The server then reads `auction_events` for (after, head] and sends those frames in order. It then drains the buffer, dropping any seq already sent, and continues live. A subscriber therefore never misses an event between replay and live, and never receives one twice.
4. If the listener connection drops, it reconnects and first replays every row above its high-water mark for auctions with subscribers, then resumes listening.

**Relay (single leader).** One worker at a time holds the relay advisory lock on a dedicated connection. That gives a single ordering model: one process sends, in `id` order. The relay loop is:

```
loop (while leader):
  rows := SELECT id, group_key, body FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 10;   -- no row lock
  results := SendMessageBatch(rows)          -- outside any transaction
  blocked := {}
  for each row in order:
    if group_key in blocked: skip                      -- preserve per-group order after a failure
    if result(row) = Successful: ok_ids += row.id
    else: blocked += group_key                         -- failed entry: stop this group in this batch
  UPDATE outbox SET sent_at = now() WHERE id = ANY(ok_ids) AND sent_at IS NULL;   -- short transaction
```

A crash between send and mark resends the same deduplication id; SQS drops it inside the five-minute window, and the saga consumer's unique keys absorb anything later. The scheduler does not use this lock. It claims due auctions with `SKIP LOCKED`, so both loops are correct under their own rules.

**Saga consumer.** Receives a message, loads the saga by lot, and for the next step not in `saga_steps`:

1. Commits an `saga_attempts` row in its own transaction (survives any later failure in the step).
2. Opens the step transaction, locks `saga_instances` `FOR UPDATE`, re-checks `saga_steps`, performs the effect, inserts the `saga_steps` row with the audit row, and commits.
3. Deletes the SQS message only after step 2 commits.

A redelivered message finds the step committed and deletes itself. No network call happens inside a step transaction. Step 4 writes a `notifications` row, not an email.

### D.4 Consistency requirements per operation

| Operation | Isolation and locking | Atomic unit | Idempotency and recovery |
|---|---|---|---|
| Place bid (direct) | READ COMMITTED. Lock order: auction, then lot. `SELECT ... FROM auctions WHERE id = $1 FOR UPDATE`. | Bid row, event(s), `auction_events` hash chain, `last_seq` and price update, outbox row, `NOTIFY`, audit rows (one per event). | `UNIQUE (bidder_id, idempotency_key)`. A replay returns the stored response from `idempotency_keys` and writes nothing. A stale increment returns 409 with the committed price and no state change. |
| Proxy resolution (inside bid) | Same transaction, after the lock. Calls `engine.resolve_proxies(auction_id)`, which reads maxima after the lock and returns outcomes only. | Counter-bid events appended in the bid's transaction. | Ties go to the earlier maximum. Counter-bid never exceeds the owner's maximum. |
| Set proxy maximum | Auction lock, then `engine.set_proxy_max(principal, auction, max)`. | Upsert, optional resolution pass, event(s), audit row (without amount). | Maximum can only increase while open; checked under the lock. |
| Read own maximum | No lock. `engine.own_proxy_max(principal)`. | None. | Returns only the row whose bidder is the argument. The API passes the verified principal (G.4). |
| Withdraw lot | Auction lock, then lot lock. | Lot state change and audit row. | Refused with 409 when the auction is `closing` or `closed`. Denial audit committed in its own transaction before the response. |
| Close auction (scheduler) | `FOR UPDATE SKIP LOCKED` on due auctions, then the auction lock; `ends_at <= now()` rechecked under the lock. | State to `closing`, saga instance, outbox row, close event, audit. | Re-running finds no due rows. A bid and the close both take the auction lock, so the extension wins or the close wins, never both. |
| Settlement step | Saga row `FOR UPDATE`, then step effect. | Effect, `saga_steps` row, audit row, next outbox row if any. The attempt row is committed earlier, separately. | Unique `(saga_id, step)`; unique `ledger_transactions.business_key`; unique `notifications` key. |
| Denial audit (any sensitive action) | Own transaction. | Audit row only. | Committed before the error response. One rule everywhere. |
| Audit append | `pg_advisory_xact_lock` on a fixed key, then `audit_head FOR UPDATE`. | Audit row and head update in the caller's transaction. | Linear chain. The advisory lock is global, so appends serialize across auctions; the hold time is a measured quantity (H.4). |
| Refresh token rotation | READ COMMITTED, conditional update `WHERE token_hash = $1 AND used = false`. | Token update and insert. | Reuse revokes the family in the same transaction. |
| Projection rebuild | `REPEATABLE READ` read of `auction_events` into a scratch schema. | None on live data. | Deterministic. Uses the live applier (D.4 note). |

**Projection applier.** One function, `applyEvent(state, event)`, is used by the live path after each commit and by the rebuild. The rebuild does not re-derive bid rules. It checks that the projection is a deterministic function of the verified event chain. An agreement test runs the live path and the rebuild over every seed auction and over the burst, and compares hashes after every committed event.

**Why READ COMMITTED with explicit locks.** Invariants are local to one auction. One `FOR UPDATE` serializes the writers that matter; SERIALIZABLE would turn the burst into a retry storm. The lock-order rule (auction before lot) is tested by `TestLockOrderNoDeadlock`.

### D.5 Security boundaries and authorization

Trust zones:

1. **Internet to ALB.** TLS 1.2 or higher, ACM certificate.
2. **ALB to API tasks.** Private subnets; API security group accepts the ALB only.
3. **API and worker to PostgreSQL.** RDS security group accepts the API and worker only; `rds.force_ssl = 1` in AWS, not locally (E.3).
4. **Worker to SQS and S3.** Task role limited to one queue (send, receive, delete) and `PutObject` on the photo prefix. VPC endpoints, no internet route.
5. **Operator tools.** Require role `operator` and `TALLYHOUSE_DEMO_FAULTS=1`. Routes are not registered without the flag; a test asserts it.

**Proxy secrecy (database grants).** Maxima live in `proxy_bids`, to which only `tallyhouse_engine` has privilege. Two SECURITY DEFINER functions owned by that role are the only paths to the table:

- `engine.resolve_proxies(auction)` returns counter-bid outcomes (bidder, amount, sequence).
- `engine.set_proxy_max(principal, auction, max)` upserts the caller's own maximum.
- `engine.own_proxy_max(principal)` returns the single row for the argument.

None returns another bidder's maximum. A canary test confirms it.

**What this defends and what it does not.** A handler that is compromised or buggy but holds the application role cannot `SELECT` a maximum, cannot change its grants and cannot change the role it runs as. It can call `own_proxy_max` with another principal's id; that is the residual path, and the document accepts it (G.4). Ledger and bid RLS use `app.principal_id` and defend against forgotten filters only.

**Tokens.** EdDSA JWT, 5-minute lifetime, claims `sub`, `role`, `iat`, `exp`, `jti`. Refresh token: opaque 32-byte value, stored as SHA-256 hash, rotated per use, in a family. Cookie `HttpOnly; Secure; SameSite=Strict; Path=/v1/session`. The access token lives in SPA memory.

**Policy.** One Go table maps `(role, action, ownership predicate)` to allow or deny, default deny. Denials of sensitive actions are audited in their own transaction before the response (D.4).

**Fault hook.** The worker checks `demo_faults` every 200 ms while armed. At the armed step it holds its step transaction open before commit. On `kill_requested` it marks the request consumed and sends SIGKILL to its own process. The flag is consumed, so the replacement does not pause.

### D.6 Deployment topology

AWS, one region, one VPC, two public and two private subnets across two zones.

- **Public:** ALB (HTTPS, target group on API, health check `/readyz`).
- **Private:** ECS Fargate service `api` (desired count 2); service `worker` (desired count 1; singleton behaviour comes from the relay lock, so the count is safe to raise); RDS PostgreSQL 16 (single-AZ for the demo, Multi-AZ as the documented production setting); no NAT gateway, interface endpoints for SQS, Secrets Manager, ECR and CloudWatch Logs, gateway endpoint for S3.
- **Outside the VPC:** SQS FIFO and DLQ, S3 bucket, ECR repository, Secrets Manager secret, log groups.
- **Migration:** one-shot ECS task running `tallyhouse migrate` with the migrator role before each deployment.
- **Infrastructure as code:** Terraform with modules `network`, `database`, `queue`, `storage`, `registry`, `secrets`, `service`. Remote state in S3 with DynamoDB locking.

Local: one Compose project with `postgres:16`, `elasticmq`, `minio`, `migrate` (one-shot), `api` and `worker` from the same image with `restart: always` and `/readyz` checks, and `rehearsal` behind a profile.

---

## E. AWS and local deployment

### E.1 Container-first, immutable artifacts

One Dockerfile, three stages: `node:22-bookworm-slim` builds the SPA; `golang:1.23-bookworm` builds `tallyhouse` with `CGO_ENABLED=0`, `-trimpath`, `-ldflags="-buildid="` and `SOURCE_DATE_EPOCH` from the commit; `gcr.io/distroless/static-debian12:nonroot` is the final image. Base images are pinned by digest. The image is tagged with the git SHA, pushed to ECR, and referenced by digest in ECS and Compose. `make verify-artifact` checks that the local image ID matches the ECR manifest digest. **The promoted artifact is the exact image that ran locally.** Build reproducibility is not claimed; identity of the artifact is.

Configuration is 12-factor environment variables; a `config` package refuses to start if a required value is missing. Secrets come from ECS `secrets` (Secrets Manager) or `/run/secrets` files (Compose), under the same variable names.

### E.2 Service mapping

| Concern | AWS | Local | Why behaviour is unchanged |
|---|---|---|---|
| Relational store | RDS PostgreSQL 16 | `postgres:16` | Same major version and extensions; same migrations, grants, RLS, advisory locks, `LISTEN/NOTIFY`. |
| Queue | SQS FIFO with DLQ | ElasticMQ | Same SDK and request code; endpoint is the only difference. The contract suite covers group ordering, deduplication, visibility timeout, receive count, batch send with per-entry results. Divergences are recorded in the rehearsal log. |
| Object storage | S3, SSE-S3 | MinIO | Same SDK, presigned POST and policy conditions; the bucket is created by `migrate` with the same policy. |
| Secrets | Secrets Manager via ECS injection | Files under `/run/secrets` | Process reads environment variables in both cases. |
| Load balancing and TLS | ALB with ACM | Direct localhost port | Same paths, WebSocket upgrade, `/readyz`, 60-second idle timeout and 20-second heartbeats. TLS only in AWS; `Secure` cookies accepted on localhost. |
| Compute | ECS Fargate, desired counts 2 and 1 | Compose, one replica each | Same health checks. Scaling is not claimed. |
| Restart | ECS service keeps desired count | Compose `restart: always` | Both start a replacement after SIGKILL; the replacement registers a heartbeat and takes the relay lock. |
| Fault kill | Worker sends SIGKILL to itself on an armed request from `demo_faults` | Same | Same signal from the same process in both environments. No orchestrator stop is used for the fault. |
| Identity | App-issued JWTs in both | App-issued JWTs in both | No cloud identity service in the core path. |
| Clock | `now()` on RDS | `now()` on Postgres | Application clocks are never used for deadlines. |

**Fault-kill tests in both environments.** `TestSettlementKillPoints` runs in the local Compose stack and in the AWS staging stack, using the same self-SIGKILL hook at the four states. The local stack also runs an OS-level `kill -9` from the harness, which tests the same state with a different sender.

### E.3 What differs and why it does not change behaviour

- **TLS to PostgreSQL.** Enforced in AWS, not locally. The SQL, transactions and locking are identical.
- **Queue fidelity.** ElasticMQ's FIFO behaviour may differ from SQS in redelivery timing, deduplication window and empty-group receives. The contract suite runs against both; the script asserts outcomes, not timing.
- **Network path.** ALB in AWS, direct port locally. Latency differs; the script asserts ordering and content, except for the countdown, which is database time.
- **IAM.** Least-privilege roles in AWS, none locally.
- **Orchestrator stop.** ECS stops tasks with SIGTERM followed by SIGKILL after the stop timeout. The worker handles SIGTERM by releasing the relay lock and draining its step. Ordinary deployments use this path. The demo's fault does not.
- **Object lock and archival.** Not in the demo. Anchoring is discussed in G.4.

### E.4 Reproducible commands

`make image` builds the artifact. `make up` starts Compose and waits for readiness. `make reset` truncates and reseeds (idempotent, deterministic). `make check` runs the invariant SQL and the chain verifier. `make rehearse` runs the browser script locally. `make deploy-staging` pushes the verified image and applies Terraform. `make rehearse TARGET=aws` runs the same Playwright specification with a different base URL.

---

## F. Technical credibility — five strongest claims

Each claim has named executable tests and an observable behaviour.

**Claim 1 — No lost, duplicated or unordered effects under concurrent bidding.** The auction row lock serializes writers, so no update is lost and the event sequence is contiguous.

- `TestBurstInvariants`: the same burst parameters as the demo (180 requests, three bidders, 60 each, 14 idempotent retries), against a seeded auction on real PostgreSQL, with and without a proxy maximum present. Afterwards: `seq` is exactly `1..N`; `current_price` equals the amount of the last price-setting event; the sum of increments equals the price movement; no idempotency key has two stored responses; every proxy counter amount is at most the owner's maximum; price never decreases.
- `TestLockOrderNoDeadlock`: concurrent withdraw, close and bid on the same auction and lot, 10,000 iterations, no deadlock error, valid final state.
- Observable: the burst at 60–100 s and the five-row Check invariants panel, which runs the same SQL.

**Claim 2 — Real-time updates are commit-ordered and gap-free across disconnects and listener failures.**

- `TestReplayAfterDrop`: a client receives events, the server closes the socket, 25 bids commit, the client reconnects with `after=`. Asserts applied seqs equal `auction_events` with no gap and no duplicate, and the price series hash matches.
- `TestHandoffNoGapNoDuplicate`: commits run concurrently with a new subscription; asserts the subscriber receives every seq exactly once, in order, across the replay-to-live boundary.
- `TestListenerReconnectReplays`: terminates the `LISTEN` backend while commits are in flight; every committed event reaches every subscriber exactly once.
- `TestNoUncommittedBroadcast`: a transaction rolled back after `NOTIFY` emits no frame.
- Observable: the 115–135 s drop and replay, with the hash comparison on screen.

**Claim 3 — Settlement effects are exactly-once under worker death at every step boundary.**

- `TestSettlementKillPoints`: four runs, each SIGKILLing the worker at a named state (step 1 prepared, step 2 committed, step 3 prepared in an open transaction, step 4 committed but message not deleted). Runs on local and staging with the same hook. Assertions: one `hold`, one `transfer`, one `credit`, one `notify` row; ledger balanced; escrow zero; `saga_attempts` shows the attempt numbers.
- `TestRedeliveryIsIdempotent`: the same message delivered 20 times concurrently produces one effect per step.
- Observable: the 205–255 s kill and "resumed on attempt 2, one ledger transaction".

**Claim 4 — The ledger balances by construction, and hidden maxima stay hidden on every read path.**

- `TestLedgerDeferredBalance`: a commit whose entries do not sum to zero fails with the constraint error; property test over 10,000 generated transaction sets accepts exactly the balanced ones.
- `TestProxyMaximaNotReadable`: as `tallyhouse_app`, `SELECT` on `proxy_bids` fails with permission denied, including after `SET app.role = 'engine'` and with a principal set. The application role is not a member of the engine role.
- `TestMaximaAbsentFromAllReadPaths`: seeds canary maxima, then as each non-owner principal (bidder, auditor, operator) checks that no canary appears in REST responses, WebSocket frames, replay, `auction_events` bodies, audit bodies, SQS message bodies, outbox bodies, rebuild scratch output, the Prove-it panel and the operator console. The owner's own maximum appears only in the owner's `own_proxy_max` response.
- Observable: "Your maximum: 4,000 (only you can see this)" in Mara's window and its absence everywhere else.

**Claim 5 — The record is tamper-evident for naive edits, and the verifier names the first break.**

- `TestAuditChainVerifies`: after the scripted run, the verifier checks every audit row's hash over stored bytes and every `prev_hash` link.
- `TestEventChainVerifies`: per auction, every event's hash over stored bytes, and the per-auction head.
- `TestAuditEventCrossCheck`: every event audit row's referenced hash equals the stored event hash.
- `TestAuditGoldenBytes`: reads rows back and checks that stored bytes re-hash to stored hashes.
- `TestAuditTamperLocated`: edits one event body and one audit body in scratch copies; asserts the first break is reported at the right seq and row, with expected and recomputed hashes.
- `TestAuditAppendLinearUnderConcurrency`: 100 concurrent appends produce a chain that verifies with no fork.
- Observable: the 275–300 s scratch tamper and the Prove-it panel.

**Additional.** Refresh reuse revocation (`TestRefreshReuseRevokesFamily`) and role boundaries are tested but are supporting claims.

---

## G. Failure analysis

### G.1 Implementation difficulties

1. **Proxy resolution under the lock.** Maxima are read after the auction lock, inside the bid transaction, by `resolve_proxies`. Reading before the lock produces a wrong leader under concurrent proxy updates. `TestBurstInvariants` with proxies present checks this.
2. **Listener gaps.** Notifications sent while the listener is down are lost. The high-water replay and the subscribe-then-replay handoff close both gaps; each has its own test.
3. **At-least-once with effects.** Effect and `saga_steps` row commit together. The attempt row is committed separately, so a killed attempt still appears in the record.
4. **Fault window versus visibility timeout.** A step held open past 15 s is redelivered while the first attempt is still open. The second attempt blocks on the saga row lock, then finds the step committed and deletes its message. This is correct and is covered by the 60-second fault window in tests.
5. **Advisory lock lifetime.** The relay lock lives on a dedicated connection. A pooled connection that is recycled silently would strand or release it.
6. **Clock discipline.** Deadlines compare against `now()` in the database. Within one transaction `now()` is fixed, so two bids in one transaction see one deadline. Browsers draw countdowns from `ends_at` and `server_time`, recomputed on focus.
7. **Grants and connection reuse.** Proxy secrecy does not depend on per-request settings, so a reused connection cannot leak a maximum.

### G.2 Demo failure modes and mitigations

| Failure | Effect | Mitigation |
|---|---|---|
| Venue network drops | Sessions stop updating. | Wired network on the presenter machine; `after=` replay restores state on reload. |
| Replacement is slow after the kill | Resume scene runs long. | The wait is event-driven, not timed. The console shows the replacement's heartbeat. The restart interval is measured on the target environment in rehearsal and reported; no figure is claimed in the script. |
| Worker dies before the fault is armed | Kill scene is empty. | Kill button stays disabled until the worker reports "paused at step 3". |
| Burst saturates the auction lock on a laptop | Latency tail grows. | 60 connections per bidder; hold time is measured and reported as a measured quantity, not as capacity. |
| ElasticMQ FIFO diverges from SQS | Redelivery timing differs. | Script asserts outcomes; contract suite pins the subset used. |
| Countdown gate missed | Anti-sniping bid is not possible. | The scene is re-run from reset. Nothing forces the deadline. |
| External email, if added later | At-least-once send with a recorded key. | Not in the demo. Any future send is at least once; the notifications key is the local record, and external deduplication is only as strong as the provider's. |

### G.3 Hidden complexity

- Canonical bytes are produced by a small explicit encoder with a golden test. Standard map ordering is not used.
- The projection rebuild uses the live applier, so it cannot disagree with the live path on how an event changes state. It does not check that the event was the right outcome; that is what the burst invariants test.
- `committed_at` is stored but not hashed. `server_time` is a frame field, not stored. Both are named as not covered on the Prove-it panel.
- Seeding with fixed UUIDs and relative timestamps: the seed computes `ends_at` from the database clock at reset (reset plus 150 s).

### G.4 Features that look impressive but are shallow, and limits

- **The price chart.** A step plot of the event stream. It is presentation over a replay.
- **The countdown.** Visual; the depth is the database deadline.
- **"Money".** Ledger entries between accounts. No processor, bank or currency. The product says so on its settlement page.
- **Tamper evidence.** The chains detect edits that are not recomputed. Anyone with write access to `audit_head`, `audit_log`, `auction_events` and their hashes can rewrite history consistently, and the verifier cannot tell. Real tamper evidence needs the head hash anchored outside the database. Anchoring is not implemented; the closing line and the Prove-it panel say what is and is not detected.
- **Row-level grants as the secrecy boundary.** They defend against application mistakes and against a compromised handler reading maxima directly. They do not defend against a handler calling `own_proxy_max` with another principal's id, or against code that can call `resolve_proxies` and inspect its effect on price. The price movement reveals a lower bound on a maximum, as every proxy system does; the claim is that the maximum itself is never exposed.
- **Ledger RLS.** It uses a per-transaction principal setting. It defends against forgotten filters, not principal confusion inside the API process.
- **The operator fault.** A real SIGKILL, from the worker itself, on a flag and role that exist only in the demo stack. A production system would not expose it.
- **Real-time at this scale.** A few subscribers per auction. The claims are ordering and replay, not throughput.
- **The burst.** A few hundred requests on one row is a serialization demonstration, not a load test.
- **Proxy bidding.** The rule is simple; the depth is running it correctly under the lock.
- **Rebuild.** It proves the projection is a deterministic function of the verified event log. It does not independently re-check bid rules.

---

## H. Feasibility

### H.1 Scope by component

| Component | What it touches |
|---|---|
| Schema, migrations, roles, grants, RLS, seed, reset | One migration set, three database roles plus the engine role, two SECURITY DEFINER proxy functions, deterministic seed that writes ten events. |
| Bid engine (direct, proxy, anti-sniping, idempotency, events, outbox, NOTIFY, audit) | One package, one transaction shape, the lock-order rule, one applier shared with the rebuild. |
| Event chain and canonical encoder | One encoder, per-auction hash chain, golden tests. |
| Real-time stream | One listener per task, subscribe-then-replay handoff, heartbeat, per-viewer projection. |
| Authorization and sessions | One policy package, token endpoints, one cookie. |
| Worker | Scheduler, single-leader relay, saga consumer, heartbeats, the demo fault hook. |
| Audit log | One encoder, one verifier with event cross-check, one scratch-schema command. |
| Projection rebuild and Prove-it | The shared applier run into a scratch schema; a hash over named fields. |
| SPA | Four role views, operator console, WebSocket client with handoff and series hash. |
| Local Compose, ElasticMQ, MinIO, `make` targets | Five containers plus one-shot migration. |
| Terraform | Seven modules, endpoints, task roles. |
| Tests | Claims 1–5 suites on real PostgreSQL and a SQS-compatible endpoint; Playwright rehearsal with four contexts. |

### H.2 Dependency order

1. Schema, roles, grants and seed. Nothing runs without them.
2. Bid engine with the lock-order rule, event chain and `TestBurstInvariants`. This proves the central claim before any UI exists.
3. Notify, listener, handoff and replay; then `TestReplayAfterDrop`, `TestHandoffNoGapNoDuplicate`, `TestListenerReconnectReplays`.
4. Proxy functions and grants; then `TestProxyMaximaNotReadable` and `TestMaximaAbsentFromAllReadPaths`.
5. Outbox, single-leader relay and ElasticMQ wiring; then the saga, attempt log and fault hook; then `TestSettlementKillPoints` locally.
6. Ledger with the deferred constraint, then settlement entries.
7. Audit chain, event cross-check, verifier and scratch tamper.
8. SPA: bidder view first (it exercises claims 1, 2 and 4), then auctioneer and consignor views, then the operator console.
9. Compose stack, then Terraform and ECR promotion, then `TestSettlementKillPoints` and the contract suite in staging.
10. Playwright rehearsal of the full script, locally and in staging.

Steps 2 and 3 run without any UI.

### H.3 Critical dependencies

- PostgreSQL 16 behaviour for `NOTIFY` in transactions, advisory locks, `SKIP LOCKED`, SECURITY DEFINER grants, deferred constraint triggers.
- ElasticMQ's FIFO behaviour for the subset used; the contract suite is the check.
- The Go SDK for SQS and S3 against local endpoints.
- ECS and Compose restart behaviour after a process exits with SIGKILL, and ALB WebSocket support.
- A Chromium build for Playwright in the rehearsal container.

### H.4 Main risks

1. **Lock contention on the burst.** The lock hold includes indexed reads, the proxy function, event hashing and audit appends. Hold time is measured in rehearsal and reported as a quantity.
2. **Audit append serialization.** The global advisory lock serializes appends across auctions. This is a measured bound; it is acceptable at demo scale and is documented as a scaling limit.
3. **Queue fidelity.** Mitigated by outcome assertions and the contract suite.
4. **Proxy correctness under concurrency.** Tested in Claim 1 with proxies present; the rebuild shares the applier and does not double the rules.
5. **Scope creep.** Multi-house, mobile, payments and email are excluded.
6. **Operator tooling leaking into production paths.** Routes are not registered without the flag; a test asserts it.
7. **Browser rehearsal flakiness.** The rehearsal waits on committed-seq and heartbeat assertions, not on animation frames.
8. **Restart time in staging.** Measured and reported; the script does not claim it.
