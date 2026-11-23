# Competitor 01 — Systems Complexity

**Product title: Tallyhouse — a live auction house where every bid is a transaction.**

**Pitch.** Tallyhouse is a consignment auction house running on AWS (ECS Fargate, RDS PostgreSQL, SQS FIFO, S3) and locally from the same container image against the same PostgreSQL major version, with SQS and S3 served by API-compatible containers. In five minutes a presenter drives four browser sessions through a proxy-bid war, a 200-request concurrent bid burst, a dropped WebSocket that replays its missed events, an anti-sniping close, a settlement saga, and a kill -9 of the settlement worker mid-payout, and then proves the ledger still balances, the audit chain verifies and no one was paid twice.

---

## A. Product concept

**Application.** Tallyhouse is the operating system of a small consignment auction house. One deployment hosts one house with a deterministic sample catalogue: three auctions (one live, one scheduled, one closed), 24 lots, 40 user accounts, and a seed that fixes every UUID and every relative timestamp so that a reset always produces the same starting state.

**Users and roles.**

| Role | Who | What they can do |
|---|---|---|
| Consignor | Sellers, e.g. "Priya" | Create lots, upload photos to S3 through scoped presigned POST, view reserve status and settlement proceeds for their own lots, withdraw a lot while the auction is still open. |
| Bidder | Registered buyers, e.g. "Mara", "Joon" | Register for an auction against a deposit held in the ledger, place direct bids, set a private proxy maximum, see public price and leader status. Never see another bidder's maximum or identity. |
| Auctioneer | The person running the room, e.g. "Ines" | Open, extend and close auctions, see the full bid log, run invariant checks, operate the settlement queue. |
| Auditor | Compliance reader | Read the audit log and verify its hash chain. Cannot read proxy maxima or ledger balances of individual bidders. |
| Operator | The demo operator (a tab in the auctioneer console, gated by role `operator`) | Load bursts, drop a socket, arm and fire a worker kill, reset the demo, tamper with a scratch copy of the audit log. |

**Problems solved.** Live auctions have four hard problems that generic CRUD applications never face: many concurrent writers racing on the same current price; hidden state (a bidder's maximum) that must stay hidden from every other principal; deadlines that must be enforced by a single clock even when browsers and containers disagree about time; and money-like movements (deposits, buyer charges, consignor credits, commissions) that must balance and must never be applied twice even when a process dies in the middle. Tallyhouse solves all four in one domain, and each one is visible on screen.

**Why it suits this demonstration.** Every property the audience cares about has a user-facing consequence that can be seen in a second browser window:

- A bid that loses a race is refused with the real current price, not silently dropped.
- A proxy maximum that exists is never shown to anyone else, yet the price moves as if it did.
- The countdown jumps by 30 seconds when an anti-sniping bid lands, because the database clock says so, not the browser.
- Settlement steps appear one at a time in the auctioneer and consignor windows, each with its ledger transaction identifier.
- When the worker process is killed, the consignor's "proceeds pending" indicator keeps waiting and then completes, and the ledger shows exactly one credit.

The application is not a showcase of unrelated features. Each screen exists because a distributed-systems property needs an observer, and the observers are the sessions.

**What is deliberately not in the product.** No real payment processor (funds are ledger entries, which is what settlement bookkeeping is; section G is explicit about this), no mobile clients, no multi-house tenancy, no search, no third-party identity provider. Each of those would add surface area without adding a property the audience will watch.

---

## B. Capability inventory

Legend: **demonstrated** means the capability is shown live in the script (section C) and is covered by a claim in section F. **supporting** means it is required for the demonstrated ones to work or to be operated, and is visible only indirectly.

| # | Capability | Status | Technical significance | How it interacts with others |
|---|---|---|---|---|
| 1 | Transactional bid engine: `SELECT ... FOR UPDATE` on the auction row, minimum-increment check, insert bid, bump `auctions.version`, write `auction_events`, write outbox row, `NOTIFY`, all in one transaction, under READ COMMITTED. | demonstrated | The single lock on the auction row is the serialization point and therefore the invariant. Lost updates are impossible by construction; the losing request gets a 409 carrying the committed price. | Feeds (2), (4), (5). Every other write path into an auction uses the same lock, including withdrawal and close. |
| 2 | Proxy (automatic) bidding with hidden maxima: when a direct bid lands, the engine resolves counter-bids against stored maxima inside the same transaction, until one maximum is exceeded or the leader is settled. | demonstrated | Non-trivial domain logic that runs inside a concurrency-critical section. The resolution is deterministic: ties go to the earlier maximum. The engine produces up to N chained events per bid, all with contiguous sequence numbers. | Uses (1)'s lock. Its hidden state is protected by (8). Its output is what (5) replays. |
| 3 | Anti-sniping deadline on the database clock: a bid in the last 30 seconds extends `ends_at` to `now() + 30 s`; the scheduler closes auctions whose `ends_at` has passed, using `now()` on the database, never the application clock. | demonstrated | Eliminates clock skew between containers and browsers as a correctness input. The scheduler claims due auctions with `FOR UPDATE SKIP LOCKED`, so two workers cannot close the same auction. | Shares (1)'s lock for extension. Hands off to (6) on close. Its countdown is rendered from server-sent `ends_at`. |
| 4 | Transactional outbox and relay to SQS FIFO: domain writes insert outbox rows in the same transaction; the worker relay reads them with `SKIP LOCKED`, sends `SendMessageBatch` to a FIFO queue (`MessageGroupId` = auction id, `MessageDeduplicationId` = outbox id), and marks rows sent only after SQS acknowledges. | demonstrated | Dual-write problem solved: a state change and its message are atomic. Ordering is per auction, which is the only ordering the domain needs. Delivery is at least once; the consumer makes effects exactly-once (see 6). | Carries settlement messages to (6). Its rows are part of the audit story: the outbox row id is the dedupe key in SQS and appears in the ops console. |
| 5 | Commit-ordered real-time fan-out and gap-free replay: `NOTIFY` is issued inside the bid transaction so it is delivered only after commit. Each API instance holds one `LISTEN` connection, looks up `auction_events` by sequence, and pushes to its WebSocket subscribers. On reconnect a client sends `after=<seq>` and receives every missed event in order. | demonstrated | Clients never see an uncommitted bid and never see a gap. Replay after a dropped socket or a dropped listener connection is a query, not a state transfer. | Depends on (1) for ordering and on `auction_events` from (1). Its replay path is used in the socket-drop scene. |
| 6 | Settlement saga with compensation and exactly-once effects: a state machine in `saga_instances` and `saga_steps` runs four steps (hold buyer funds, transfer lot ownership, credit consignor net of commission, notify). Each step runs in one transaction with a unique idempotency key (`settle:{lot}:{step}`) and a row in `saga_steps`; a redelivered message finds the step already committed and only acknowledges. | demonstrated | This is the sophisticated failure-recovery core. Exactly-once effects are built from at-least-once delivery plus a uniqueness constraint in the same transaction as the effect. | Consumes (4). Writes to (7). Its state is shown in (9)'s consignor view and in the auctioneer console. Its failure is the worker kill. |
| 7 | Double-entry ledger with a deferred balance constraint: `ledger_transactions` own `ledger_entries` whose amounts must sum to zero. A constraint trigger, deferred to commit, rejects any transaction whose entries do not balance, and a unique key on `(business_key)` makes a settlement credit appear at most once. | demonstrated | The books are a checked invariant, not a report. A transaction that violates the rule cannot commit, even if application code is wrong. | Written by (6) and by (1) when a deposit is held. Read by the "prove it" checks at the end, and by the consignor's proceeds view. |
| 8 | Authorization at two layers: an application policy table (role × action × ownership, default deny) and PostgreSQL row-level security with `FORCE ROW LEVEL SECURITY`, keyed on a per-transaction GUC (`app.principal_id`, `app.role`) that the API sets with `SET LOCAL` from the verified token. The proxy-maximum table is readable only by the owning bidder and by the bid engine's role. | demonstrated | Defence in depth: a forgotten `WHERE` clause in a handler cannot leak a proxy maximum or another bidder's ledger rows. The application connects as a role without `BYPASSRLS`. | Protects (2)'s hidden state and (7)'s balances. Denials feed (10). |
| 9 | Session security: EdDSA-signed access tokens (5 minutes), opaque refresh tokens rotated on every use, refresh families with reuse detection that revokes the whole family on replay, and role claims re-verified against the database for sensitive actions. | supporting, with one scripted moment | Standard, but implemented with the failure cases tested rather than assumed. Shows multi-session identity. | Issues the principal that (8) enforces. The consignor and bidder sessions in the demo are three independent families. |
| 10 | Hash-chained, append-only audit log: each row stores `prev_hash` and `hash` over its canonical JSON; appends take a `pg_advisory_xact_lock` so the chain is linear; denied authorization decisions and every settlement step are audited. A verifier walks the chain and reports the first broken sequence number. | demonstrated (verification and tamper scene) | Tamper evidence, with the failure location reported exactly. The audit row for a denied withdrawal is written in the same transaction as the denial. | Records events from (1), (2), (6), (8). Verified in the final scene on a scratch copy. |
| 11 | S3 lot photos with presigned POST: the API issues a POST policy with a key prefix bound to the lot, a `content-type` condition, and a `content-length-range` condition; the browser uploads directly to S3 (MinIO locally). | supporting | Shows the boundary between the API and object storage without proxying bytes. The policy is the authorization artifact. | Lot creation by the consignor (8) gates who may upload. Photos appear in the auction room. |
| 12 | Projection rebuild and state hashing: `auction_events` is the source of truth; the operator "prove it" action replays every event for the live auction into a scratch schema, recomputes the projection (price, leader, status, sequence), and compares a SHA-256 of the canonical state with the live projection. | demonstrated (final scene) | Determinism of the event log is checked, not asserted. It also validates (5)'s replay semantics. | Reads (1)'s events and (2)'s outputs. Its hash is shown next to (10)'s chain head. |
| 13 | Health, readiness and recoverability: `/healthz` (process), `/readyz` (database, LISTEN connection and SQS reachability), a worker heartbeat row, idempotent `reset` command that restores the seed. | supporting | Makes the demo operable after an interrupted run and makes the kill scene's recovery observable. | Readiness gates the ECS and Compose health checks that restart the worker in (6)'s scene. |
| 14 | Browser rehearsal: a Playwright suite drives the four sessions through the whole script against either deployment and asserts on the visible results. | supporting | Makes the five-minute run repeatable and gives a pass/fail signal before the stage. | Exercises (1)–(10) through the UI, which is the only way to check the sessions agree. |

**Interaction summary.** The core loop is (1) → (4)/(5) → (6) → (7) → (10). A bid is a transaction that updates the auction, the event log, the outbox and the notification channel together. A close is a scheduled transaction that hands a message to the saga. The saga writes the ledger and the audit log. Every step is visible in some session. Proxy bidding (2) sits inside (1)'s critical section, which is what makes it hard to get right and what makes the burst in the script meaningful. Authorization (8) guards the hidden data that (2) produces and the balances that (7) records.

---

## C. Five-minute live script

Layout: four browser windows tiled on one display. **Mara** (bidder, left), **Joon** (bidder, centre-left), **Priya** (consignor, centre-right), **Ines** (auctioneer, right, with the operator console in a second tab). The reset command has already logged all four in, so no time is spent on login. The live auction is "Evening Sale", Lot 14 (a marine chronometer, starting price 2,000). The auction is open with `ends_at` set by the seed to 6 minutes after reset.

Numbers in the table are the expected behaviour under the seed. Latency targets are labelled as targets, to be confirmed by measurement in the rehearsal (section F).

| Time (s) | Presenter action | Expected behaviour | Visible result | Capabilities demonstrated | Transition |
|---|---|---|---|---|---|
| 0–15 | Says: "This is a live auction house. Four people are in it, on one database, and every number on these screens is a committed fact." Points at the status strip in each window. | Four sessions connected. Status strip shows `committed seq 412 · in sync`. | Identical price (2,000), leader (none), and countdown in all four windows. | (5) real-time fan-out; (9) multi-session identity | "Watch what happens when two of them want the same lot." |
| 15–30 | Ines reads out the rule: "Bidders can set a private maximum. The system bids for them, up to that maximum." Says nothing else. | Ines's console shows the auction rules and the increment table from the database. | Rules panel with minimum increment 50 and the anti-sniping window of 30 s. | (1) rule source is the same table the engine reads | "Mara has set a maximum. Joon is about to bid against it." |
| 30–45 | Mara enters a proxy maximum of 4,000 and places a direct bid of 2,100. | Bid accepted. Transaction locks the auction row, writes event seq 413, writes outbox row, notifies. Proxy maximum stored, not published. | All four windows show price 2,100 and seq 413 within the same frame. Mara's window shows "You lead. Your maximum: 4,000 (only you can see this)." Other windows show "Leader: a bidder." | (1), (2) partial, (5), (8) | "Now Joon bids the way a human would." |
| 45–60 | Joon bids 2,500 directly. | Engine locks the row, accepts 2,500, then resolves Mara's proxy: raises the price to 2,600 (2,500 + 50 increment, capped at Mara's maximum). Two events, seq 414 and 415, in one transaction. | Joon sees 2,600 and "You are not leading." Mara sees 2,600 with "You lead." Nobody sees 4,000. Event log in Ines's console shows 414 and 415 with the same transaction identifier. | (2) proxy resolution in one transaction; (5); (8) hidden maximum | "Now the room gets busy." |
| 60–100 | Ines clicks **Launch burst** in the operator console: three bidders, 60 concurrent requests each, every request with an idempotency key, 14 deliberate retries of the same key. | A real HTTP load generator issues 180 requests against the live auction. The lock serializes them. Requests with stale increments return 409 with the committed price. Retries return the stored response and create no event. | Price chart climbs as a step plot, one step per accepted event. Counters update: attempted 180 burst requests, accepted A, refused-stale B, idempotent replays 14 (with A + B = 180 − 14 = 166 unique requests). Counters are read from the database, not the browser. | (1) serialization; (2) proxy under load; (5) streaming; (13) operability | "Did every window see every step?" |
| 100–115 | Ines clicks **Check invariants**. | Server runs five SQL checks on the live auction: sequence contiguous from 1 to head; sum of accepted increments equals price minus start; no duplicate idempotency keys; price strictly non-decreasing across events; leader row equals the last accepted event. | Five green rows with the counts they checked (for example "events 1–N contiguous, N = 226"). | (1), (5), (12) partial | "Now the interesting part: a window loses its connection." |
| 115–135 | Ines clicks **Drop socket: Joon** (the server closes Joon's WebSocket and blocks reconnection for 8 s). Ines then clicks **Burst 25** to add bids while Joon is away. | Joon's window shows "reconnecting, last seq 4611". 25 accepted bids are committed meanwhile (seq 4612–4636). After 8 s the socket is allowed back. Joon's client sends `after=4611`; the server replays 4612–4636 in order from `auction_events`. | Joon's chart catches up with 25 steps appearing in order, without a reload. Joon's status shows "caught up at seq 4636". A short panel shows the client-side price series hash equal to the server's hash for the same range. | (5) gap-free replay; (1) | "Auctions close on the database's clock. Watch the countdown." |
| 135–160 | Mara places a bid of 2,700 when the countdown reads 00:04. | Bid is inside the anti-sniping window. Transaction extends `ends_at` to `now() + 30 s` on the database clock and emits an event carrying the new `ends_at`. | Countdown jumps from 00:04 to 00:30 in all four windows in the same frame. Event row shows "extended". | (3) anti-sniping on the database clock; (1); (5) | "Priya wants her lot out before it sells. The system says no." |
| 160–180 | Priya clicks **Withdraw lot** on Lot 14 at 00:02 remaining (the auction is still open but the seed's `ends_at` is manipulated by the operator to end in 2 s; the operator console does this with one button, **Force close in 2 s**, which sets the database deadline through the same code path as the scheduler). | Withdrawal and close contend for the auction lock. Close wins: the auction moves to `closing` under the lock. Withdrawal sees `closing` and returns 409 `lot_in_settlement`. Denied attempt is written to the audit log in the same transaction as the denial. | Priya's window shows "Lot 14 can no longer be withdrawn: in settlement." Ines's console shows the auction in `closing`, final price 2,700, buyer Mara (identity shown to the auctioneer only). Audit row 1,207 "denied: consignor → withdraw, state closing." | (1) state guard under lock; (3) scheduler; (8) authz; (10) denial audit | "A bidder tries to reach the operator tools." |
| 180–190 | Joon types the operator URL into her window (or clicks the link she was shown in her own console). | 403 with request identifier. Denial is audited. | Joon sees "Not permitted for role bidder." Ines's audit view shows the denial row with principal and role. | (8) application policy; (10) | "Now settlement runs. Watch the steps." |
| 190–215 | Ines switches to the **Settlement** tab. Nothing is clicked. | Close transaction has written a `saga_instances` row and an outbox row. The relay has sent the message to SQS FIFO with group = auction id. The worker has consumed it. Step 1 "hold buyer funds" commits a ledger transaction (deposit of 2,700 moves from Mara's available account to the escrow account). Step 2 "transfer ownership" updates the lot owner. | Settlement panel shows steps 1 and 2 as complete, each with its ledger transaction id and its audit row id. Mara's available balance drops by 2,700 in her window. | (4) outbox and relay; (6) saga; (7) ledger; (10) audit | "Step 3 is the one that pays out money to Priya. It is also the one I am going to break." |
| 215–240 | Ines clicks **Arm fault: worker pauses in step 3**. The worker, when it reaches step 3, opens its transaction, writes the step's effects, and holds before commit for up to 60 s, which is the fault window the operator armed. Ines then clicks **Kill settlement worker**. | Step 3 is prepared in an open transaction. The kill is a real SIGKILL to the worker process, sent through the orchestrator (ECS StopTask with the `KILL` reason in AWS; `docker kill --signal=KILL` locally). The open transaction aborts because the connection drops. The SQS message is not deleted and becomes visible again after its visibility timeout. | Step 3 shows "in progress, worker lost." Priya's window shows "Proceeds pending (retrying)." Worker container or task disappears from the health strip. | (6) failure in the middle of a step; (4) at-least-once redelivery; (13) health | "Watch it come back, and do not expect it to pay twice." |
| 240–262 | Ines waits (no action). | The orchestrator restarts the worker (ECS service keeps desired count 1; Compose uses `restart: always`). The new worker acquires the scheduler and relay advisory locks. The redelivered message reaches step 3; the unique key `settle:{lot}:credit` finds no committed credit (the earlier transaction aborted), so step 3 runs once. Step 4 notifies. | Step 3 shows "resumed on attempt 2, one ledger transaction." Priya's proceeds change from "pending" to 2,376 (hammer 2,700 less the 12% commission of 324) in her window. Health strip shows the worker restored. | (6) recovery; (7) single credit; (4); (13) | "Now prove it." |
| 262–285 | Ines clicks **Prove it**. | Server runs three checks and renders each with its evidence. (a) Ledger: every transaction sums to zero; exactly one settlement credit exists per lot; escrow balance is zero after settlement. (b) Audit chain: verifies over all rows, head hash shown. (c) Rebuild: the event log is replayed into a scratch schema and the projection hash equals the live hash; Joon's client-side series hash equals the server's. | Three green panels: ledger 0 unbalanced transactions, 1 credit for lot 14, escrow 0; audit chain verified over N rows, head `9f3c…`; rebuild hash `9f3c…` equals live hash. | (7); (10); (12); (5) | "The last thing is the one the chain cannot hide." |
| 285–300 | Ines clicks **Tamper with scratch copy**, which flips Mara's 2,700 bid amount in a scratch copy of the audit log only, then clicks **Verify scratch**. | Verifier walks the scratch chain and reports the first broken sequence number, with the expected and recomputed hash. The live chain is untouched and still verifies. | Scratch chain: "Broken at seq 1,190: stored hash does not match row content." Live chain: verified. Closing line on screen: "Killed mid-payout. Books balanced. Nobody paid twice. The record cannot be edited without a visible break." | (10) tamper evidence; (7); (6) | End. |

**Note on the commission figure.** The seed sets a 12% commission, so the consignor's net on a 2,700 hammer is 2,700 − 324 = 2,376. The figure shown on screen is read from the ledger by the rehearsal assertion, not typed into the script.

**First 30 seconds.** The purpose is stated (a live auction, four people, one database, everything committed) and the layout is shown. The interest is created by the four windows being in identical state before anything happens.

**Last 30 seconds.** The strongest moment is the kill at 240–262 followed by the three-way proof at 262–285. The audience has watched the process die mid-transaction in a window where money is moving, and then watches three independent checks (the books, the record, and a deterministic rebuild) agree. The 285–300 tamper on a scratch copy makes the record's integrity concrete without damaging the live demo.

**Reliability of the script.** Every scene has a precondition check in the operator console (for example, "Joon connected", "worker healthy", "auction open") that turns the next button green. The presenter never clicks a control that is not green. The burst and the drop use the same code paths as ordinary traffic; they are not scripted responses.

---

## D. Technical architecture

### D.1 Components

All backend code is one Go module producing one binary, `tallyhouse`, with subcommands. Running the same binary with different subcommands is one artifact with several roles, not a microservice split.

| Component | Technology and why | Responsibility |
|---|---|---|
| `tallyhouse api` | Go 1.23, `net/http` with `chi` for routing, `pgx/v5` pool, `sqlc` for typed queries, `github.com/coder/websocket` for WebSockets, `golang-jwt` with Ed25519. Go because goroutines make many concurrent WebSockets and the lock-heavy bid path cheap to reason about, and because the binary is small enough for a distroless image. | HTTP JSON API, WebSocket stream, static SPA serving, bid engine, authorization, session issuance. |
| `tallyhouse worker` | Same binary. Runs three loops: scheduler (claims due auctions with `SKIP LOCKED`), outbox relay (reads outbox rows, batches to SQS), saga consumer (long-polls SQS, executes steps). Singleton loops hold PostgreSQL advisory locks, so a second worker is standby, not a duplicate. | Closing, settlement, messaging. |
| `tallyhouse migrate`, `seed`, `reset`, `check` | Same binary. `migrate` uses `goose` migrations executed as a one-shot task. `reset` truncates and reloads the deterministic seed. `check` runs the invariant SQL and prints a report. | Operations and demo control. |
| Web SPA | TypeScript, React 18, Vite, TanStack Query for server state, a small hand-written WebSocket client that stores the last applied sequence number and reconnects with `after=`. Built in a Node stage of the same Dockerfile and embedded into the Go binary with `embed`. | Four role views plus the operator console. |
| PostgreSQL 16 | Amazon RDS for PostgreSQL 16 in AWS; `postgres:16` container locally. Same engine major version and the same extensions (`pgcrypto` for UUID generation and hashing). | System of record, event log, outbox, saga state, ledger, audit log, RLS policies, advisory locks, `LISTEN/NOTIFY`. |
| SQS FIFO | Amazon SQS FIFO queue with a DLQ (max receive count 5). Chosen because the relay's ordering requirement is per auction and FIFO message groups provide exactly that. | Carries outbox messages to the saga consumer. |
| S3 | Bucket `tallyhouse-lot-photos`, private, SSE-S3, presigned POST issuance. | Lot photos. |

### D.2 Persistence model

Schema `app`. The application role `tallyhouse_app` has DML only and no `BYPASSRLS`; `tallyhouse_migrator` owns the tables; `tallyhouse_auditor` has `SELECT` on `audit_log` only.

```sql
CREATE TABLE auctions (
  id            uuid PRIMARY KEY,
  title         text NOT NULL,
  state         text NOT NULL CHECK (state IN ('scheduled','open','closing','closed')),
  start_price   bigint NOT NULL CHECK (start_price >= 0),
  increment     bigint NOT NULL CHECK (increment > 0),
  current_price bigint NOT NULL,
  leader_id     uuid,                       -- nullable; the leader's identity is not shown to bidders
  ends_at       timestamptz NOT NULL,       -- set and compared only with now() in the database
  version       bigint NOT NULL DEFAULT 0,  -- incremented under the row lock on every accepted event
  last_seq      bigint NOT NULL DEFAULT 0
);

CREATE TABLE lots (
  id uuid PRIMARY KEY, auction_id uuid NOT NULL REFERENCES auctions,
  consignor_id uuid NOT NULL, title text NOT NULL,
  state text NOT NULL CHECK (state IN ('draft','listed','withdrawn','in_settlement','sold','unsold')),
  owner_id uuid                              -- set by the saga's ownership step
);

CREATE TABLE bids (
  id uuid PRIMARY KEY, auction_id uuid NOT NULL REFERENCES auctions,
  bidder_id uuid NOT NULL, amount bigint NOT NULL, kind text NOT NULL CHECK (kind IN ('direct','proxy')),
  seq bigint NOT NULL, tx_id bigint NOT NULL, idempotency_key text,
  UNIQUE (auction_id, seq),
  UNIQUE (bidder_id, idempotency_key)
);

CREATE TABLE proxy_bids (                    -- hidden state; RLS restricts reads
  auction_id uuid NOT NULL, bidder_id uuid NOT NULL, max_amount bigint NOT NULL,
  set_at timestamptz NOT NULL, PRIMARY KEY (auction_id, bidder_id)
);

CREATE TABLE auction_events (                -- the source of truth for the live stream
  auction_id uuid NOT NULL, seq bigint NOT NULL, kind text NOT NULL,
  payload jsonb NOT NULL, tx_id bigint NOT NULL, committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auction_id, seq)
);

CREATE TABLE outbox (
  id bigserial PRIMARY KEY, topic text NOT NULL, group_key uuid NOT NULL,
  body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);

CREATE TABLE saga_instances (
  id uuid PRIMARY KEY, lot_id uuid NOT NULL UNIQUE, state text NOT NULL,
  hammer bigint NOT NULL, buyer_id uuid NOT NULL, consignor_id uuid NOT NULL
);
CREATE TABLE saga_steps (
  saga_id uuid NOT NULL REFERENCES saga_instances, step text NOT NULL,
  status text NOT NULL CHECK (status IN ('committed','compensated')),
  tx_id bigint, audit_id bigint, attempt int NOT NULL,
  PRIMARY KEY (saga_id, step)
);

CREATE TABLE ledger_transactions (
  id bigserial PRIMARY KEY, business_key text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ledger_entries (
  tx_id bigint NOT NULL REFERENCES ledger_transactions, account text NOT NULL,
  amount bigint NOT NULL CHECK (amount <> 0), id bigserial PRIMARY KEY
);
-- constraint trigger: on commit, SUM(amount) per tx_id must be 0 (see D.4)

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, occurred_at timestamptz NOT NULL DEFAULT now(),
  principal_id uuid, role text, action text NOT NULL, outcome text NOT NULL,
  resource text, body jsonb NOT NULL,
  prev_hash bytea NOT NULL, hash bytea NOT NULL
);
CREATE TABLE audit_head (singleton boolean PRIMARY KEY DEFAULT true, hash bytea NOT NULL);

CREATE TABLE processed_messages (message_id text PRIMARY KEY, handled_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE idempotency_keys (scope text, key text, response jsonb, status int, PRIMARY KEY (scope, key));
CREATE TABLE sessions_refresh (family_id uuid, token_hash bytea PRIMARY KEY, principal_id uuid,
  used boolean NOT NULL DEFAULT false, revoked boolean NOT NULL DEFAULT false, expires_at timestamptz);
```

Notes on the model:

- `auction_events` duplicates information that `bids` already holds. This is intentional: `bids` is the query model; `auction_events` is the ordered, replayable stream including non-bid events (extensions, state changes, denials that concern the auction). Keeping the stream explicit is what makes replay and the rebuild check meaningful.
- `tx_id` on `bids` and `auction_events` is the ledger-independent transaction identifier shown in the UI. It is `txid_current()` as a bigint. The UI displays it so an audience member can see that two events share a transaction.
- `proxy_bids.max_amount` is never serialized to any API response except the bidder's own profile. The public projection is the view `public_auction_state`, which omits it.
- `audit_log` rows hold the canonical JSON that is hashed (`jsonb` with sorted keys, produced by the application, not by the database, so the hash function is fully specified in Go and in the verifier).

### D.3 Communication

**Synchronous.** Browser to API over HTTPS, JSON bodies, `Idempotency-Key` header on every command. API to PostgreSQL on a `pgx` pool sized at 20 connections per task.

**Real-time.** WebSocket at `GET /v1/auctions/{id}/stream?after={seq}`. Frames are `{seq, kind, payload}` and the server heartbeats every 20 seconds so the ALB idle timeout (set to 60 seconds) never closes a live socket. The client stores the highest applied `seq`; on reconnect it sends `after=` and applies frames strictly in order, discarding duplicates. On a sequence gap, the client reconnects rather than guessing.

The fan-out path is:

1. The bid transaction executes `NOTIFY auction_events, '<auction_id>:<seq>'` before it commits. PostgreSQL delivers the notification only if the transaction commits. The payload is an identifier, well under the 8000-byte limit; the event body is read from `auction_events`.
2. Each API task holds one dedicated listener connection (not a pooled connection, because `LISTEN` pins a session). On a notification it reads the new event and pushes it to subscribers of that auction.
3. The listener keeps a high-water mark per auction. If the listener connection drops and is re-established, it first replays every `auction_events` row above its high-water mark for auctions with subscribers, then resumes listening. This closes the window in which a notification could be lost.

**Asynchronous.** Outbox rows are written with the domain change. The relay in the worker runs:

```
BEGIN;
SELECT id, topic, group_key, body FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED;
-- SendMessageBatch to the FIFO queue: MessageGroupId = group_key, MessageDeduplicationId = id
UPDATE outbox SET sent_at = now() WHERE id = ANY($1);
COMMIT;
```

Sending and marking happen under the row locks, so a crash between send and mark produces a duplicate send, which the SQS deduplication window (5 minutes) and the consumer's `processed_messages` check both absorb. The consumer long-polls with `WaitTimeSeconds=10` and a visibility timeout of 15 seconds (configured, not default, so redelivery after a kill is visible within the scene).

**Sagas.** Orchestration, not choreography. The saga consumer loads `saga_instances` by lot, reads the next step not in `saga_steps`, runs that step in a transaction (section D.4), inserts the `saga_steps` row, writes the next outbox message if one is needed, and only then deletes the SQS message. A step is idempotent by construction: its uniqueness key is in the same transaction as its effect.

### D.4 Consistency requirements per operation

| Operation | Isolation and locking | Atomic unit | Idempotency and recovery |
|---|---|---|---|
| Place bid (direct or proxy) | READ COMMITTED. `SELECT ... FROM auctions WHERE id = $1 FOR UPDATE`. Re-read leader and proxies after the lock. | Auction row update, bid row, proxy resolution events, `auction_events`, outbox, `NOTIFY`, audit row. | `UNIQUE (bidder_id, idempotency_key)`; a replay returns the stored response from `idempotency_keys`. A stale increment returns 409 with the committed price and no state change. |
| Set proxy maximum | Same auction lock, because a new maximum can change the outcome. | `proxy_bids` upsert, a proxy-resolution pass if the maximum exceeds the current leader, events. | Upsert on `(auction_id, bidder_id)`; maximums can only increase while open (checked under the lock). |
| Withdraw lot | Auction lock and lot lock (lock order: auction, then lot, everywhere). | Lot state change and audit row. | Denied when the auction is `closing` or `closed`. |
| Close auction (scheduler) | `FOR UPDATE SKIP LOCKED` on due auctions, then the auction lock. | State `open` to `closing`, `saga_instances` row, outbox message, event, audit. | Scheduler is driven by `ends_at <= now()`; re-running it finds no due rows. |
| Settlement step | Saga row locked via `saga_instances` and the step insert. | Step effect (ledger transaction or lot update), `saga_steps` row, audit row, next outbox row if any. | Unique `(saga_id, step)` in `saga_steps` and unique `ledger_transactions.business_key`; a redelivered message acknowledges without effect. |
| Refresh token rotation | READ COMMITTED with a conditional update `WHERE token_hash = $1 AND used = false`. | Token row update and new token insert. | A second use of a used token revokes the family in the same transaction. |
| Audit append | `pg_advisory_xact_lock` on a fixed key, then `SELECT ... FROM audit_head FOR UPDATE`. | Audit row and head update, in the caller's transaction. | Chain is linear because only one transaction holds the advisory lock. The cost is serialization; section G addresses it. |
| Projection rebuild | Read-only snapshot (`REPEATABLE READ`) over `auction_events` into a scratch schema. | None on live data. | Re-runnable; deterministic output. |

**Why READ COMMITTED with explicit row locks and not SERIALIZABLE.** The invariants are local to one auction. A single `FOR UPDATE` on the auction row serializes every writer that matters, and SERIALIZABLE would turn the burst into a retry storm with no additional guarantee. The lock order rule (auction before lot before proxy) is the thing that must be tested, and it is (section F, claim 1).

### D.5 Security boundaries and authorization model

Trust zones, from outside in:

1. **Internet to ALB.** TLS 1.2 or higher, ACM certificate, HTTP redirected to HTTPS. Security groups allow 443 from `0.0.0.0/0` only.
2. **ALB to API tasks.** Private subnets. API security group accepts 8080 from the ALB security group only.
3. **API and worker to PostgreSQL.** RDS security group accepts 5432 from the API and worker security groups only. `rds.force_ssl = 1` in AWS; the local container runs without TLS, which is one of the documented differences in section E.
4. **Worker to SQS and S3.** Task role with the minimum permissions: send, receive, delete on the one queue; presign-related `PutObject` only on the photo prefix. Reached through VPC endpoints so the worker needs no internet route.
5. **Operator tools.** Available only to principals with role `operator`, and the chaos endpoints additionally require the environment flag `TALLYHOUSE_DEMO_FAULTS=1`. The flag is set in the demo stack and absent in any other stack. (Section G discusses the honesty of this boundary.)

**Tokens.** Access token: EdDSA JWT, 5-minute lifetime, claims `sub`, `role`, `iat`, `exp`, `jti`. Signing key from Secrets Manager (AWS) or a file mounted from the secrets directory (local). Refresh token: opaque 32-byte random value, stored as SHA-256 hash, rotated on each use, inside a family. The refresh cookie is `HttpOnly; Secure; SameSite=Strict; Path=/v1/session`. The access token lives in memory in the SPA, never in local storage.

**Policy.** A single Go table maps `(role, action, ownership predicate)` to allow or deny, with default deny. Ownership predicates are functions over loaded rows (for example, `lot.consignor_id == principal.id`). Denials of sensitive actions are written to the audit log in the same transaction as the handler's transaction when there is one, or in their own transaction otherwise.

**Database layer.** RLS is enabled and forced on `bids`, `proxy_bids`, `ledger_entries`, `ledger_transactions` and `saga_steps`. Policies read `current_setting('app.principal_id', true)` and `current_setting('app.role', true)`. The API sets both with `SET LOCAL` as the first statement of every request transaction. The bid engine's role `engine` is set by the bid path only, and the policy for `proxy_bids` allows the `engine` role to read all rows of an auction and allows a bidder to read only their own.

**What RLS does and does not defend against.** It defends against application bugs that forget a filter, and it defends against a bidder's principal reading another bidder's rows through a list handler. It does not defend against code running inside the API process that sets `app.role = 'engine'`, because the bid engine genuinely needs to read all maxima to compute counter-bids. The secrecy claim is therefore "no principal reachable through the API, the auditor role or the operator role can read another bidder's maximum", which is what the audience can test.

### D.6 Deployment topology

AWS, one region, one VPC with two public and two private subnets across two availability zones:

- **Public subnets:** the ALB (HTTPS listener, target group on the API service, health check on `/readyz`).
- **Private subnets:** ECS Fargate cluster with service `api` (desired count 2) and service `worker` (desired count 1, singleton via advisory locks, so raising it is safe); RDS PostgreSQL 16 `db.t4g.medium` (single-AZ for the demo, Multi-AZ as a documented production setting); no NAT gateway, with interface endpoints for SQS, Secrets Manager, ECR API and DKR, CloudWatch Logs, and a gateway endpoint for S3.
- **Managed services outside the VPC:** SQS FIFO queue and DLQ, S3 bucket, ECR repository, Secrets Manager secret, CloudWatch log groups.
- **Migration:** a one-shot ECS task running `tallyhouse migrate` with the migrator role runs before each `api` and `worker` deployment. The application role cannot run DDL.
- **Infrastructure as code:** Terraform with modules `network`, `database`, `queue`, `storage`, `registry`, `secrets`, `service` (ECS, ALB, IAM, security groups). Remote state in S3 with a DynamoDB lock table.

Local, one Compose project:

- `postgres` (16), `elasticmq` (SQS API), `minio` (S3 API), `migrate` (one-shot, `depends_on` the database healthy), `api`, `worker` (both from the same image, `restart: always`, health checks on `/readyz`), `rehearsal` (Playwright, behind a profile so it only runs with `make rehearse`).
- Compose publishes API port 8080 on localhost; the SPA is served by `api` at `/`, so there is one origin locally and in AWS.

---

## E. AWS and local deployment

### E.1 Container-first and immutable artifacts

One Dockerfile with three stages:

1. `node:22-bookworm-slim` builds the SPA.
2. `golang:1.23-bookworm` builds `tallyhouse` with the SPA embedded, `CGO_ENABLED=0`, `-trimpath`, `-ldflags="-buildid="`, and `SOURCE_DATE_EPOCH` set from the commit timestamp.
3. `gcr.io/distroless/static-debian12:nonroot` is the final stage, containing only the binary and CA certificates. Base images are pinned by digest.

The image is tagged with the git SHA and pushed to ECR. The ECS task definitions reference the image by digest, and the local Compose file references the same digest (the local daemon's image ID is checked against the ECR manifest digest by `make verify-artifact`). **The promoted artifact is the exact image bytes that ran locally. Nothing is rebuilt for AWS.** Bit-for-bit reproducibility of the Go build is pursued by the flags above but is not claimed; the claim is identity of the promoted artifact.

Configuration is 12-factor environment variables, with a single `config` package that refuses to start if a required value is missing. Secrets are injected by the platform: ECS `secrets` from Secrets Manager (AWS), or files under `/run/secrets` mounted by Compose (local). The process sees the same environment variable names in both.

### E.2 Service mapping

| Concern | AWS | Local | Why behaviour is unchanged |
|---|---|---|---|
| Relational store | RDS PostgreSQL 16 | `postgres:16` container | Same engine major version and extensions. Same migrations, same RLS, same advisory locks, same `LISTEN/NOTIFY`. |
| Queue | SQS FIFO with DLQ | ElasticMQ container | Both spoken through the AWS SDK for Go v2 with the same request code. The endpoint is the only configuration difference. ElasticMQ implements the SQS query API including FIFO message groups and deduplication; the contract suite covers the subset used (group ordering, dedupe window, visibility timeout, receive count, batch send and delete). Divergences are listed in the rehearsal log. |
| Object storage | S3 with SSE-S3 | MinIO | Same SDK, same presigned POST and policy conditions. The local bucket is created by the `migrate` step with the same policy document. |
| Secrets | Secrets Manager via ECS injection | Files under `/run/secrets` | Process reads environment variables in both cases. |
| Load balancing and TLS | ALB with ACM certificate | Direct port on localhost | Same paths, same WebSocket upgrade, same `/readyz`. ALB idle timeout is set to 60 seconds and heartbeats are 20 seconds in both. TLS is terminated at ALB in AWS and absent locally; the cookie `Secure` flag is set in both and the local browser accepts it on `localhost`. |
| Compute | ECS Fargate, desired counts 2 and 1 | Compose services, one replica each | Same health checks. Scaling is not part of the demo's claims. |
| Restart semantics | ECS service keeps desired count | Compose `restart: always` | Both start a replacement after SIGKILL and both reattach the worker to advisory locks and SQS. |
| Identity | App-issued JWTs in both | App-issued JWTs in both | No cloud identity service in the core path, so the demo has no external dependency. |
| Clock | `now()` on RDS | `now()` on Postgres | Application clocks are never used for deadlines. |
| Operator kill | ECS `StopTask` with the operator task role, scoped by tag to the demo service | Docker Engine API via a socket mounted only into the demo `api` service | Same operator action, same resulting SIGKILL. The authorization for the action differs and is documented in section D.5. |

### E.3 What differs and why it does not change behaviour

- **TLS between the application and PostgreSQL.** Enabled in AWS (`force_ssl`), absent locally. The SQL, transactions and locking are identical; the wire is encrypted in one place only. Production-grade local TLS is a configuration change, which is why it is listed rather than hidden.
- **Queue fidelity.** The main risk is ElasticMQ's FIFO implementation diverging from SQS in edge cases: redelivery timing, deduplication window, and the behaviour of `ReceiveMessage` on an empty group. The contract suite runs against both endpoints in the AWS staging stack before any demo. Anything that differs is recorded and the demo script avoids depending on it.
- **Network path.** ALB in front of tasks in AWS; direct port locally. Latency will differ. The script's assertions are about ordering and content, not about timing, except for the countdown, which is database time.
- **IAM.** Least-privilege task roles in AWS; no IAM locally. The operator kill is authorized differently (section D.5). The behaviour the audience sees (a process dies, the orchestrator restarts it) is the same.
- **Object lock and archival.** Not in the demo. Audit chain anchoring is discussed in section G.

### E.4 Reproducible configuration and commands

`make image` builds the artifact. `make up` starts the Compose project and waits for readiness. `make reset` truncates and reseeds (idempotent, deterministic). `make check` runs the invariant SQL. `make rehearse` runs the browser script against the local stack. `make deploy-staging` pushes the verified image and applies Terraform. `make rehearse TARGET=aws` runs the identical browser script against the AWS stack. The same test binaries and the same Playwright specification run in both; only the base URL changes.

---

## F. Technical credibility — five strongest claims

Each claim has an executable test (named, runnable in CI and in rehearsal) and an observable behaviour in the demo.

**Claim 1 — No lost, duplicated or unordered effects under concurrent bidding.** The bid engine serializes writers per auction, so concurrent bids never lose an update and never produce a non-contiguous event sequence.

- Test `TestBurstInvariants`: 200 goroutines issue bids with random valid and invalid increments, 20% of them retried with the same idempotency key, against a seeded auction on a real PostgreSQL. Afterwards: `auction_events.seq` is exactly `1..N`; `current_price` equals the amount of the last accepted event; the sum of accepted increments equals the price movement; no idempotency key has two stored responses; price never decreases. A second variant with proxies present adds the assertion that every proxy resolution event's amount is at most the owning proxy's maximum.
- Test `TestLockOrderNoDeadlock`: concurrent withdraw, close and bid on the same auction and lot for 10,000 iterations, asserting no deadlock error and a valid final state.
- Observable behaviour: the burst at 60–100 s and the "Check invariants" panel, whose five checks are the same SQL as the test assertions, executed live on the demo auction.

**Claim 2 — Real-time updates are commit-ordered and gap-free across disconnects and listener failures.**

- Test `TestReplayAfterDrop`: a WebSocket client receives events, the server closes the socket, 25 bids commit, and the client reconnects with `after=`. The test asserts the client's applied sequence equals `auction_events` with no gaps and no duplicates, and that its reconstructed price series hashes to the same value as the server's series for the same range.
- Test `TestListenerReconnectReplays`: kills the `LISTEN` connection (`pg_terminate_backend` on its PID) while commits are in flight and asserts every committed event reaches every subscriber exactly once after the listener resumes.
- Test `TestNoUncommittedBroadcast`: a bid transaction that is rolled back by an injected error after `NOTIFY` issues no WebSocket frame. This is the direct test of the claim that `NOTIFY` inside the transaction is delivered only on commit.
- Observable behaviour: the 115–135 s drop and replay, with the hash comparison visible on screen.

**Claim 3 — Settlement effects are exactly-once under worker death at every step boundary.**

- Test `TestSettlementKillPoints`: four runs. In each, the worker is sent SIGKILL when the database shows a specified state (step 1 prepared, step 2 committed, step 3 prepared in an open transaction, step 4 committed but message not deleted). The harness restarts the worker and waits for the saga to complete. Assertions: exactly one `hold` ledger transaction, one `transfer` row, one `credit` ledger transaction for the lot, one `notify` message handled, ledger balanced, escrow zero, and the `saga_steps` attempt number recorded for each step.
- Test `TestRedeliveryIsIdempotent`: delivers the same SQS message 20 times concurrently to the saga consumer and asserts exactly one ledger effect per step.
- Observable behaviour: the 215–262 s kill and the "resumed on attempt 2, one ledger transaction" display.

**Claim 4 — The ledger balances by construction, and hidden balances stay hidden.**

- Test `TestLedgerDeferredBalance`: attempts to commit a `ledger_transactions` row with entries summing to a non-zero value; asserts the commit fails with the constraint's error and no entry is visible afterwards. A property test generates 10,000 random balanced transaction sets and asserts the constraint accepts exactly the balanced ones.
- Test `TestRLSHidesProxyMaxima`: connects as `tallyhouse_app` with `app.principal_id` set to a bidder who is not the owner of a proxy row, runs `SELECT` on `proxy_bids`, and asserts zero rows. Repeats for the auditor role and the operator role. Also asserts that a direct `SELECT` by `tallyhouse_app` without `SET LOCAL` returns zero rows (fail closed).
- Test `TestPublicStateOmitsMaxima`: fetches the public auction state endpoint and asserts that no field, at any depth, equals any proxy maximum in the seed.
- Observable behaviour: "Your maximum: 4,000 (only you can see this)" in Mara's window and its absence everywhere else, and the ledger panel's zero-unbalanced count.

**Claim 5 — The audit record is tamper-evident, and the verifier names the first break.**

- Test `TestAuditChainVerifies`: after the full scripted run in rehearsal, `check audit` walks every row, recomputes each hash from canonical JSON, and asserts `prev_hash` linkage.
- Test `TestAuditTamperLocated`: copies `audit_log` into a scratch schema, modifies one row's `body` in the copy, and asserts the verifier reports that row's `id` as the first mismatch, with expected and recomputed hashes.
- Test `TestAuditAppendLinearUnderConcurrency`: 100 concurrent transactions each append an audit row; asserts the chain verifies with no fork.
- Observable behaviour: the 285–300 s scratch tamper and the verification panel, and the chain head shown in the "prove it" panel.

**Additional behaviour the audience can test.** The rehearsal exercises the sessions, role boundaries and the token reuse detection (`TestRefreshReuseRevokesFamily`), but these are supporting rather than headline claims.

---

## G. Failure analysis

### G.1 Implementation difficulties

1. **Proxy resolution under the lock.** The counter-bid loop must read every proxy row for the auction after taking the auction lock, not before. Reading before the lock is the classic bug and produces an incorrect leader under concurrent proxy updates. The test in Claim 1 with proxies present exists because this is easy to get wrong.
2. **Listener reconnect gaps.** `LISTEN` connections drop. A notification sent while the listener is down is lost. The high-water-mark replay on reconnect (section D.3) is necessary and is the least obvious part of the real-time path. Without it, the replay claim is false in a way that only appears under failure.
3. **At-least-once with effects.** The redelivery path needs the uniqueness constraint and the effect in the same transaction. Developers commonly put the effect in one transaction and the `processed_messages` insert in another, which reintroduces double effects on a crash between them. The design forbids that split and the test in Claim 3 checks it at all four kill points.
4. **Visibility timeout versus step duration.** A step that runs longer than the visibility timeout is redelivered while still running, which produces a concurrent second attempt. The saga consumer holds the `saga_instances` row lock for the step, so the second attempt blocks, then finds the step committed and acknowledges. This is correct, but it means the step must not perform network I/O inside the transaction. Settlement steps perform none; the notify step's external action is an outbox row, not a send.
5. **Advisory lock lifetime.** Singleton loops rely on session-level advisory locks released when the connection dies. A pool that recycles connections silently can strand a lock or release one early. The singleton loops use a dedicated connection, not a pooled one.
6. **Clock discipline.** Deadlines are compared against `now()` in the database. Within one transaction `now()` is fixed, which is what we want for anti-sniping: two bids in the same transaction see the same deadline. Browsers draw countdowns from `ends_at` plus the server's `server_time` field in each frame, not from their local clock; background browser tabs throttle timers, so the countdown is recomputed on focus from server time.
7. **RLS and connection pooling.** `SET LOCAL` only lasts for a transaction. A handler that forgets to open a transaction runs unfiltered queries under the previous request's settings if the pool reuses a connection. The database layer wraps every handler in a transaction and a test asserts that a fresh connection with no `SET LOCAL` returns zero rows.
8. **JWT key rotation.** Verification must accept the previous key during rotation. Not needed for the demo, but a surprise in production; the policy is recorded and the verifier accepts a key set.

### G.2 Demo failure modes and mitigations

| Failure | Effect on the stage | Mitigation |
|---|---|---|
| Venue Wi-Fi drops (and the SPA loses its WebSocket) | Sessions stop updating. | The stage uses a wired network for the presenter machine, and the rehearsal lane runs on the same machine. If the browser must be reloaded, the `after=` replay restores state. The presenter's scripted line never depends on the network being fast. |
| ECS replacement is slow after the kill | The "resumed" step is delayed beyond the script. | The script has a 22-second window for the restart. Rehearsal records the observed interval on the target environment. If the worker has not returned by a fixed point, the operator console shows the replacement's start event and the presenter says so. The fault window (60 s) is longer than the normal restart by design. |
| The worker dies before the fault is armed | The kill scene is empty. | The armed state is a precondition shown in the console; the Kill button stays disabled until the worker reports "paused at step 3". |
| Burst saturates the single auction lock on a laptop | Bids queue, the latency tail grows. | The burst is capped at 60 concurrent connections, which the lock handles with bounded queueing. Latency is a labelled measured quantity, and the script does not claim a figure for it. |
| Rehearsal reveals ElasticMQ FIFO divergence | Redelivery timing differs from SQS. | The script asserts on the outcome (exactly-once effect, saga completion), not on the exact redelivery moment. The contract suite pins the subset used. |
| Anti-sniping bid lands in the same transaction as the scheduler | Close and extension race. | Both take the auction lock; the close checks `ends_at` again under the lock, so the extension wins or the bid is refused, never both. Tested by `TestLockOrderNoDeadlock`. |
| An attendee asks about "the 4,000 maximum" after the proxy scene | Presenter must not reveal it. | The maximum is absent from every API response, and Mara's view is the only place it appears. The rehearsal asserts this. |

### G.3 Hidden complexity

- Canonical JSON for the audit hash must be byte-stable across Go versions and across the verifier. The implementation uses a small, explicit encoder (sorted keys, no whitespace, fixed number formatting) rather than the standard library's map ordering, and a golden-file test pins it.
- The projection rebuild must reproduce the live projection including the `leader_id` tie-break and the anti-sniping extension, which means the rebuild path is a second implementation of the bid rules. It is verified against the live path by running both over every seed auction; a divergence is a bug the demo would expose, which is intentional.
- The event payload carries `server_time` for countdown rendering. Including it makes the payload non-deterministic, so the rebuild hash excludes `committed_at` and `server_time` and includes only the business fields. This exclusion is documented in the hash specification.
- Seeding with fixed UUIDs and relative timestamps must still produce a 6-minute open auction at reset time, so the seed computes `ends_at` from the database clock at reset.

### G.4 Features that look impressive but are shallow

Stated honestly, because the audience will probe for them:

- **The price chart.** It is a step plot of the event stream. Valuable as a view of the replay, but it is presentation.
- **The countdown.** Visual. The depth is in the database deadline, not in the animation.
- **"Money".** The settlement moves ledger entries between accounts. There is no payment processor, no bank, no currency conversion and no reconciliation with an external party. The ledger is real bookkeeping with real invariants; it is not money movement, and the product says so on its settlement page.
- **Tamper evidence.** A hash chain detects modification of rows only if an attacker cannot also recompute the chain. Anyone with write access to `audit_head` and `audit_log` can rewrite history. Real tamper evidence needs the head hash anchored outside the database (an external immutable store or a signed periodic publication). This demo shows detection of a naive edit and says so; it does not claim non-repudiation. Anchoring is listed as a backlog item in the design, not implemented.
- **Row-level security as the secrecy boundary.** It defends against application mistakes, not against code running in the same process. The engine role can read maxima by design. The honest claim is limited to principals reachable through the API.
- **The operator kill.** It is a real SIGKILL through the orchestrator, which is the failure we want. But the operator path is a privileged capability that a production system would not expose from the application. It exists only in the demo stack, gated by a flag and a dedicated role, and the design says so.
- **Real-time at this scale.** Three or four subscribers per auction is not a scaling claim. The claims are about ordering and replay, not throughput.
- **The burst.** A few hundred requests on one row is a serialization demonstration, not a load test. Throughput numbers from it must not be quoted as capacity.
- **Proxy bidding.** The rule is simple (increment above the competitor up to a maximum). The depth is in running it correctly under the lock, which is the reason it is in the design, but the rule itself is not novel.

---

## H. Feasibility

### H.1 Scope by component

| Component | What it touches | Relative size |
|---|---|---|
| Schema, migrations, roles, RLS policies, seed and `reset` | One migration set, three database roles, RLS on five tables, deterministic seed with fixed UUIDs | Medium. Everything else depends on it. |
| Bid engine (direct, proxy, anti-sniping, idempotency, events, outbox, NOTIFY, audit) | One package, one transaction shape, the lock-order rule | Large. The central concurrency component. |
| Real-time stream (WebSocket, listener, high-water replay, heartbeat) | One listener per API task, one WebSocket handler, client reconnect logic | Medium. |
| Authorization and sessions (policy table, JWT, refresh rotation, family revocation) | One policy package, two token endpoints, one cookie | Medium. |
| Worker (scheduler, outbox relay, saga consumer, fault hook) | Three loops, one saga definition with four steps | Medium. The fault hook is small and gated. |
| Audit log (canonical JSON, chain append, verifier, scratch-schema tamper) | One encoder, one verifier, one scratch-schema command | Small to medium. |
| Projection rebuild and state hash | A second, read-only implementation of the bid rules over events | Medium. |
| SPA (four role views, operator console, WebSocket client, status strip) | Four routes, one shared state layer, one console | Large in surface, low in novelty. |
| Local Compose stack, ElasticMQ and MinIO wiring, `make` targets | Five containers plus one-shot migration | Small. |
| Terraform modules (network, database, queue, storage, registry, secrets, service) | Seven modules, endpoints, task roles | Medium. |
| Test suites for Claims 1–5 and the Playwright rehearsal | Real PostgreSQL, real SQS-compatible endpoint, four browser contexts | Medium to large. The rehearsal is the integration test for everything. |

### H.2 Dependency order

The order is set by what unblocks what, not by calendar:

1. Schema, migrations, roles and seed. Nothing runs without them.
2. Bid engine with the lock-order rule and `TestBurstInvariants`. This proves the central claim before any UI exists.
3. Event log, NOTIFY and the listener with replay, then `TestReplayAfterDrop` and `TestListenerReconnectReplays`.
4. Sessions and policy, then RLS on `proxy_bids`, then `TestRLSHidesProxyMaxima`.
5. Outbox relay and ElasticMQ wiring, then the saga with its four steps and the kill-point harness.
6. Ledger with the deferred constraint, then settlement entries and `TestSettlementKillPoints`.
7. Audit chain, verifier and the scratch tamper.
8. SPA views, starting with the bidder view (it exercises claims 1, 2 and 4 together), then the auctioneer and consignor views, then the operator console.
9. Compose stack, then Terraform and ECR promotion, then the contract suite against SQS and S3 in the staging account.
10. Playwright rehearsal of the full script, run locally and against staging.

Each step is runnable and testable on its own. Steps 2 and 3 can be exercised without any UI, which is the main protection against building an interface over an unproven core.

### H.3 Critical dependencies

- PostgreSQL 16 behaviour for `NOTIFY` inside transactions, advisory locks, `SKIP LOCKED`, RLS with `FORCE`, and deferred constraint triggers. All standard and well documented, but the claims depend on them being used exactly.
- ElasticMQ's FIFO fidelity for the subset used. The contract suite is the mitigation.
- The Go SDK for SQS and S3 pointed at local endpoints.
- ECS StopTask semantics for SIGKILL and the restart policy, and the ALB's WebSocket support with a 60-second idle timeout.
- A Chromium build for Playwright in the rehearsal container.

### H.4 Main risks

1. **Lock contention on the burst.** A single auction row is a deliberate hot spot. If the lock hold time includes anything slow, the burst degrades. Mitigation: keep the transaction to indexed reads and writes, measure the hold time in rehearsal, and report it as a measured quantity.
2. **Queue fidelity.** Differences in redelivery and deduplication between ElasticMQ and SQS could change what the audience sees in the kill scene. Mitigation: the script asserts outcomes, and staging runs the contract suite before any demo.
3. **Proxy correctness under concurrency.** This is the most intricate logic. Mitigation: the test with proxies present is in the first claim, and the rebuild path is a second implementation checked against the first.
4. **The projection-rebuild second implementation.** Two implementations of the bid rules can disagree. The disagreement is detected by the rebuild hash, which is a feature for the demo and a maintenance cost for the codebase. This is a deliberate trade-off.
5. **Scope creep toward a general auction platform.** Multi-house tenancy, mobile clients and payments would each add more surface than property. Mitigation: section A's exclusions are binding for this proposal.
6. **Operator tooling leaking into production paths.** The chaos endpoints and the scratch tamper must stay behind the flag and the role. Mitigation: a test asserts that a stack without `TALLYHOUSE_DEMO_FAULTS` does not register those routes.
7. **Rehearsal flakiness from the browser.** Four contexts and real WebSockets can be fragile. Mitigation: the rehearsal waits on server-state assertions (`committed seq`), not on animation frames.

### H.5 Summary of the critical path

Schema and bid engine first, because it carries the central concurrency claim. Real-time replay second, because it is the audience's first visible proof. Saga and ledger third, because the kill scene depends on them and on the outbox. Audit last among the core, because it adds the closing proof without changing the path of the others. The SPA can be built against a running API at any point after step 3, and the deployment work is independent of the business logic until the contract suite runs against the cloud services.
