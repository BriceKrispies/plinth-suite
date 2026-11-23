# Tideline Live: every bid is a proven transaction

Competitor 02, mandate: Visual Spectacle.

Pitch: Tideline Live is a live auction house in which four browser sessions bid, outbid, snipe and watch one lot close in real time, while every accepted bid is serialized, authorized, traced, settled through a saga and appended to a hash-chained audit log. The same container images run on a laptop under Compose and on ECS Fargate behind an ALB, and the five-minute script ends with a superuser rewriting an audit record and the system pointing at the exact sequence number where the history was altered.

---

## A. Product concept

**Application.** Tideline Live runs a timed, multi-lot live auction. An auctioneer opens a lot, bidders place live, proxy and absentee bids from their own sessions, a clock worker closes the lot when its deadline passes, and a settlement saga turns the sale into ledger entries, an invoice and notifications. A read-only Floor view is designed to be projected on a big screen. An Auditor view verifies the integrity of the event history for each auction.

**Users and roles.**

| Role | Who | What they can see and do |
|---|---|---|
| Bidder | Registered buyer with a deposit hold | Place live, proxy and absentee bids on open lots they are registered for. Sees the leader's pseudonymous handle, the public ladder and their own proxy maximum. |
| Consignor | Seller of a lot | Sees reserve status for own lots, never the reserve value to anyone else. Receives settlement statements. |
| Auctioneer | Runs the room | Opens, extends, closes and withdraws lots. Sees the full bid stream with names. Cannot alter bids. |
| Auditor | Compliance reviewer | Read-only. Runs chain verification and sees checkpoint anchors. |
| Floor | Projected display | Anonymous read-only projection of the live state. No credentials beyond a read-only scope. |

**Problems solved.** Live auctions fail in three ways that matter to engineers: duplicate or lost bids under retries and concurrency, unfair or unexplained ordering (who bid first, why this increment was rejected, why the clock extended), and disputed history (who changed what, and can anyone prove it). Tideline addresses each with a mechanism that is visible during the demo rather than described in a slide: serialized bid transactions with explicit lock ordering, idempotent commands with an explained rejection ladder, a deterministic anti-sniping clock, and an audit chain anchored outside the database.

**Why it suits this demonstration.**

1. The domain is inherently real time. Every interesting event is a state transition that another session should see within a fraction of a second, which makes correctness visible rather than asserted.
2. A single bid naturally crosses every layer: the browser, the authorization decision, a serialized database transaction, an event append, a hash computation, a proxy counter-bid, a WebSocket fan-out, a trace span and, later, a settlement entry. One click demonstrates the stack.
3. Roles are the audience's own roles. Engineers recognise a bidder who must not see a reserve, a floor display that must not see names, and an auditor who must be able to prove the history.
4. The domain produces striking visuals without cosmetic fakery: a countdown ring that extends, a ladder that renders the real increment table, a gavel that fires only when the clock worker wins the close race.
5. Nothing in the core flow depends on a third-party service. Payments are an internal double-entry ledger. Email goes through a sending interface that is SES in AWS and a local SMTP sink under Compose.

**Sample data.** A seeded catalogue of 24 lots across two auctions, 8 registered bidders, 2 consignors, 1 auctioneer, 1 auditor and 1 floor principal. Lots are real-world-style antiques (an Augsburg astrolabe, a 1790s Admiralty sextant, a first-edition almanac). Seed data is deterministic: a fixed RNG seed and fixed UUIDv5 identifiers derived from names, so every reset produces byte-identical initial rows. The demo-reset command truncates tables, reloads the seed and re-verifies the initial hash chain, so the initial state is checked, not assumed.

---

## B. Capability inventory

Each capability is either **demonstrated** (the audience sees it happen during the script) or **supporting** (it is real, exercised by the automated rehearsal and the tests, and shows up in the script only as a side effect or an ops panel). Interactions are listed where they matter.

| # | Capability | Mark | Technical significance | Interacts with |
|---|---|---|---|---|
| 1 | Serialized bid transaction with explicit lock order (auction row, then lot row, `SELECT ... FOR UPDATE`) | demonstrated | Linearizable acceptance per lot and a total order per auction. The core of "no lost or reordered bids". | 2, 3, 4, 5, 7, 8 |
| 2 | Idempotent commands keyed by (actor, client key) with stored response replay | demonstrated | Exactly-once effect under client retry and response loss. The Ben network-flap step depends on it. | 1, 12 |
| 3 | Cedar authorization with attribute checks (registration, deposit hold covers amount, own-lot consignor rules) plus audience-specific redaction in the projection module | demonstrated | Authorization decisions use database state inside the same transaction, not stale token claims. Redaction is the same policy applied to outbound frames. | 1, 6, 7, 12 |
| 4 | Versioned increment ladder (bands of price and step, pinned per lot at open) | demonstrated | Domain rule validated on the server with a human-readable citation in the rejection. Ladder version is recorded in each bid event. | 1, 2, 5 |
| 5 | Proxy bidding resolved inside the triggering transaction | demonstrated | One transaction may append two events (the bid and the counter-bid), so the visible result is atomic. Proxy maxima never leave the server. | 1, 3, 4, 6, 7 |
| 6 | Anti-sniping extension state machine on the database clock | demonstrated | Deterministic extension rule (`close_at = max(close_at, now() + window)`, one extension per transaction, cap of 20). Uses `now()` inside the transaction, never client time. | 1, 8, 9 |
| 7 | Per-auction gap-free event sequence (`auction_seq`) assigned under the auction lock | demonstrated | Readers can prove they have every event. Avoids the classic gap problem of sequences that commit out of order. | 1, 8, 10, 11 |
| 8 | Clock workers claiming due lots with `FOR UPDATE SKIP LOCKED` and state-guarded transitions | demonstrated | Exactly one closer per lot with several replicas. The gavel moment depends on it. | 6, 7, 9 |
| 9 | Real-time fan-out over WebSocket with replay from `from_seq` on reconnect | demonstrated | Reconnect fills the gap with the exact missing events. Server pushes projections, not raw rows. | 3, 7, 11 |
| 10 | Transactional outbox to SQS, consumed by an idempotent notifier with deduplication by message id | demonstrated | At-least-once delivery with effectively-once effects. Killing the notifier mid-run is part of the script. | 1, 13, 14 |
| 11 | Settlement saga: durable steps in a `settlement_steps` table, compensations, step-level idempotency keys | demonstrated | Multi-step business workflow that survives process death without an external workflow engine. | 10, 12, 13 |
| 12 | Double-entry deposit and settlement ledger, with a deferred constraint that each transaction balances to zero | demonstrated | Money is not a counter. Invariant enforced by the database, visible in the console as balanced totals. | 2, 11 |
| 13 | Tamper-evident audit log: per-auction SHA-256 hash chain, plus periodic checkpoints in an S3 Object Lock bucket (MinIO locally) | demonstrated | Detects edits made with triggers disabled, and detects chain rewrites after the last checkpoint. The finale. | 7, 14 |
| 14 | Distributed tracing across browser, API, realtime, workers and database calls, with W3C `traceparent` propagated through the outbox | demonstrated | Engineers see one request as a waterfall across processes. Pre-shows the failure diagnosis. | 1, 10, 11 |
| 15 | OIDC login with role groups and JWT validation through JWKS (Cognito in AWS, Keycloak locally) | supporting | Identity is external and standards-based. Four live sessions are four real logins. | 3 |
| 16 | Immutable container images, digest-pinned deployment, one backend image run in several roles | supporting | Same artifacts in both environments; reproducibility claim. Shown in the ops panel. | all |
| 17 | Health and readiness probes that check the database, queue and object-lock bucket | supporting | Recovery and restart behaviour in the reliability section of the script. | 10, 13 |
| 18 | Automated browser rehearsal (Playwright) running the same script against local and AWS | supporting | Reproducible demo; regression harness for the script itself. | all |
| 19 | Floor view with server-projected countdown, ladder and bid ticks | supporting | The visual language of the room. Real data, but its animation is cosmetic (see G). | 3, 6, 9 |

**Interaction summary.** The critical path is 1 → 7 → 9: the serialized transaction assigns the sequence, and the realtime reader can only deliver what the sequence proves is contiguous. Capability 3 is evaluated inside 1 and again at the outbound projection, so the same rule governs the write path and the read path. Capabilities 6 and 8 share the database clock: extension and closing are both decided by `now()` in the database, which is why the clock workers can be replicated without a coordination service. Capabilities 10, 11 and 12 form the money path: a close produces an event, the event produces an outbox message and a settlement, and the settlement produces balanced ledger entries. Capability 13 is the only one that depends on something outside the database, which is why it is the last thing the audience sees.

---

## C. Five-minute live script

The presenter drives four browser windows arranged side by side: **Floor** (full-screen projector view), **Ana** (phone-width window, bidder), **Ben** (desktop window, bidder), **Console** (auctioneer and settlement view, with the Auditor pane docked beside it). A split terminal sits under the Console for the ops steps. Before the run the demo-reset command has been executed, so lot 14 "Surveyor's astrolabe, Augsburg 1742" is open with a 200-second close deadline from the moment the reset sets it. Reserve is 5,200 and is never displayed to bidders. The ladder is: start 4,000, step 100 up to 5,000, step 200 up to 10,000.

Times are seconds from the start of the run. Latency figures are labelled as targets to be measured in rehearsal, not as results.

| Time (s) | Presenter action | Expected behaviour | Visible result | Capabilities demonstrated | Transition |
|---|---|---|---|---|---|
| 0–20 | Says the purpose in one sentence: a live room, four sessions, every bid a transaction. Points at the windows. | Floor shows lot 14 open. The client has measured its clock offset to the server with four ping exchanges. The countdown is rendered from server `close_at` and the measured offset. | Floor ring at 3:20. Ladder shows the start at 4,000. Header reads "Live, seq 412". Ana and Ben windows show "Open, you may bid". | 19, 9 (projection and clock sync) | Ana's window is brought to the front. |
| 20–40 | Ana taps "Bid 4,000" on the phone-width window. | Token is validated. Cedar checks Ana is registered and her deposit hold covers 4,000. The transaction locks the auction row, then the lot row, inserts the bid, appends event 413 with its hash, and commits. The realtime node fans out a projection. | Floor leader changes to "Bidder 3" (pseudonym, not Ana's name). Floor ring pulses. Ben's window shows "Leader: Bidder 3". Ana's button reads "You lead". Ben's window updates within a measured target of under 250 ms after commit. | 1, 3, 4, 7, 9 | Presenter opens the trace panel. |
| 40–60 | Opens the trace panel for Ana's bid. | The waterfall shows the browser request, the edge, the API handler, the authorization span, the lock wait, the commit, the outbox write and the realtime push. Span durations are measured values. | Waterfall with about nine spans across three processes. Lock wait is visibly the smallest span. The trace ID is copyable. | 14, 1 | Presenter closes the panel and switches to Ben. |
| 60–80 | Ben types 3,950 into the raw bid field (the field exists in the desktop window for this purpose) and submits. | The API rejects with `BID_BELOW_MINIMUM`, citing the ladder version and the rule that applied. No event is appended. | Red toast: "Below minimum. Ladder v3, band 4,000 to 5,000, step 100, minimum next bid 4,100." The audit counter does not change. | 4, 3 | Presenter returns to Ben's normal bid button. |
| 80–100 | Ben turns on "Flaky network" in his window, which drops the next response after the server has replied. Clicks "Bid 4,100". | The server commits the bid and the event. The client receives no response and retries with the same idempotency key after 2 s. The second request returns the stored response. | Ben's window shows 4,100 leading. The Floor shows exactly one bid tick at 4,100 with the note "1 effect, 2 requests". The Console idempotency panel shows the key with 2 hits. | 2, 1, 9 | Presenter moves to Ana.
| 100–120 | Ana sets a proxy maximum of 6,000 in the phone window. | Proxy stored with the maximum hidden from everyone else. The server places a counter-bid for Ana at 4,200 inside the same transaction that stores the proxy. | Ana's window reads "You lead, proxy max set". Floor shows a bid tick at 4,200 with a distinct proxy marker (no maximum shown). Ben's window shows "Outbid", not the maximum. | 5, 3, 4, 1 | Presenter returns to Ben.
| 120–140 | Ben bids 4,300. | One transaction appends two events: Ben's bid at 4,300 and Ana's proxy counter-bid at 4,400. | Floor shows two ticks in one visual step: 4,300 then 4,400. Ana leads. Ben's window reads "Outbid by proxy". | 5, 7, 9 | Presenter kills a realtime container while the bids are running.
| 140–160 | Kills one realtime task in the terminal (`docker kill` locally; ECS stop task in the AWS run). Ben places a bid of 4,500 during the outage. Then the presenter restarts the task. | Floor and Ben's windows show "Reconnecting". Ben's bid is committed to the event log while no realtime node is running. On reconnect each client sends `from_seq` and receives the missing events in order. | After restart, the floor fills the gap with the missed tick and a chip reading "Replayed 2 events, no gap". The Console shows the missing sequence numbers were delivered exactly once. | 9, 7, 17 | Presenter sets the scene for the snipe.
| 160–180 | Waits for the ring to amber. This is the only deliberate pause and the ring is visible throughout. | The clock worker has nothing to do. The database clock advances. The countdown is client-rendered from the measured offset. | Ring turns amber at 0:10 remaining. | 6, 19 | Ben is ready at the bid button.
| 180–196 | Ben bids 4,500 in the final 10 seconds. | The bid transaction sees `close_at - now() < 10 s` and sets `close_at = now() + 10 s`, increments the extension counter, and counts the bid as one extension. Ana's proxy counter-bid at 4,600 is inside the same transaction and does not extend again. | Ring grows by about 10 seconds, shows "Extended 1 of 20", and the ring colour returns from amber to neutral. Ana's window shows "You lead, proxy at 4,600 of 6,000". | 6, 5, 1, 3 | Ben places the final bid.
| 196–206 | Ben bids 6,100, beyond Ana's proxy maximum. | Ben's bid is accepted and Ana's proxy is exhausted, so the transaction appends one event and no counter-bid. The close time is extended once more because the bid falls inside the window. | Ana's window shows "Outbid. Your maximum of 6,000 was reached." Floor shows 6,100 with the leader as "Bidder 2". Ring shows "Extended 2 of 20", closing at the new deadline. | 5, 6, 7 | The ring reaches zero.
| 206–214 | Nothing typed. The ring reaches zero. | Two clock-worker replicas race to close lot 14. One wins the `SKIP LOCKED` claim and performs the state-guarded transition to `closed`. The other finds no due lot and records nothing. The reserve of 5,200 is met, so the lot is sold. | Gavel animation on Floor fires once. Console shows "SOLD 6,100, Bidder 2, closed_by clock-replica-a". The lot_closed event has the next sequence number. | 8, 6, 7 | Presenter moves the Console to the settlement view.
| 214–240 | Points at the settlement timeline for the lot. | The settlement worker claims the settlement row and advances steps: `deposit_hold_captured`, `invoice_issued`, `consignor_statement_issued`, `buyer_notified`. Each step writes ledger entries in its own transaction and an outbox row for notifications. | Steps tick green one by one. The ledger panel shows debit and credit totals equal, with a green balance check. Two messages appear in the outbox queue counter. | 11, 12, 10 | Presenter moves to the Mailpit tab.
| 240–256 | Presenter stops the notifier task while the two messages are in the queue, then restarts it. | The notifier receives a message, and the message id is recorded in `processed_messages` in the same transaction as the send record. Any message delivered twice is skipped by the dedupe check. | The notifier card on the ops board goes grey, then returns. Mailpit shows the buyer email and the consignor email, each exactly once. A "duplicate skipped" line appears in the notifier log. | 10, 17 | Presenter moves to the Auditor pane.
| 256–266 | Clicks "Verify chain" in the Auditor pane. | The verifier recomputes every hash for the auction, checks that the lot projection (`lots.current_bid`, `leader`) matches a replay of the events, and compares the head to checkpoint #2 fetched from the object-locked bucket. | Green panel: "Verified 421 events. Projection matches. Head matches checkpoint #2, version ID shown." | 13, 7 | Presenter moves to the split terminal.
| 266–282 | Types the tamper command in the terminal as the database owner role, which can disable triggers. The command disables the append-only trigger on `events`, changes the payload of event 419 from 6,100 to 5,100, and re-enables the trigger. Presenter says the words "this is the DBA, and the DBA is the threat". | The change succeeds, because the threat model says a superuser can do this. No row-level check runs. | Terminal prints `UPDATE 1`. Nothing else in the UI has changed yet, which is the point. | 13 (threat model made explicit) | Presenter returns to the Auditor pane.
| 282–300 | Clicks "Verify chain" again. | The recomputed hash at event 419 differs from the stored hash, and every subsequent link is invalid. The verifier also finds the projection disagrees with the event history at lot 14. The head differs from checkpoint #2 in the object-locked bucket, which holds the original hash that a superuser cannot rewrite in retention. | Chain panel turns red at seq 419: "Hash mismatch at 419. Recomputed 7c1a…, stored 9e04…, checkpoint #2 head 3f8b… (object version 2 of 3, compliance retention until 2027-01-05)." The lot card shows "Projection disagrees with events at seq 419". The final frame holds on the red panel. | 13, 7, 14 (trace of verification) | Run ends.

The strongest moment is the final 30 seconds: the audience has just watched a sale close, a settlement run, a notifier die and recover without duplicate email, and then the system names the exact sequence number of a superuser's edit and anchors that finding to a copy of the history the superuser could not rewrite.

**Robustness of the script.** Every step is driven by a real action in a real session. The only steps the presenter could get wrong are the ones that cost time rather than correctness: a late snipe bid (the close is simply later), a missed proxy click (the Floor shows the state anyway), or an unopened trace panel (the trace is still recorded and can be opened afterwards). The rehearsal harness can replay the script from the reset state, and it checks each expected behaviour as an assertion, so a regression in any step fails the rehearsal rather than surfacing on stage.

---

## D. Technical architecture

### D.1 Components

| Component | Language and framework | Role | Replicas in AWS |
|---|---|---|---|
| `web` | TypeScript, React 18, Vite, TanStack Query for REST, a small typed WebSocket client, CSS modules, Framer Motion for the ring and tick animations | Static single-page app for Floor, Bidder, Console and Auditor. Routes by role. | Served from the same nginx image as the local edge. Task count 2. |
| `edge` | nginx (static and reverse proxy) | Locally, serves `web` and routes `/api/*` and `/ws` to the backend. In AWS, the ALB takes this role and serves only the static bundle from the same image. | Local only. ALB in AWS. |
| `server api` | Rust 1.8x stable, axum, sqlx (Postgres, compile-time checked queries), cedar-policy crate, serde, tower-http, opentelemetry with tracing-opentelemetry | Commands and queries. Bid, proxy, absentee, close-request, registration, deposit and settlement reads. Writes outbox rows. Holds Cedar policies compiled into the binary and loaded from a policy bundle at startup. | 2 |
| `server realtime` | Rust, axum WebSocket, sqlx | Per-auction projection streamer. Reads `events` by `auction_seq`, projects per audience, pushes frames. Never writes. | 2 |
| `server worker --role clock` | Rust, sqlx | Claims due lots with `FOR UPDATE SKIP LOCKED`, applies the close transition, emits `lot_closed`. | 2 |
| `server worker --role settlement` | Rust, sqlx | Claims settlement rows and steps them. Each step is one transaction plus an outbox row. | 2 |
| `server worker --role notifier` | Rust, aws-sdk-sqs, aws-sdk-sesv2 or SMTP via lettre | Consumes the notification queue, deduplicates by message id, sends through the `MailSender` trait. | 1 |
| `server worker --role checkpointer` | Rust, aws-sdk-s3 | Every N events per auction, and at lot close, writes a checkpoint object with Object Lock retention. | 1 |

All backend roles run from one image, `tideline-server`, selected by subcommand. This keeps the artifact count at two (`tideline-web` and `tideline-server`) and guarantees that the code path a bid takes locally is the code path it takes in AWS.

Why Rust for the backend: lock ordering, transaction boundaries and the hash chain are the parts an expert audience will read, and their correctness is easier to argue in a language whose type system makes the transaction scope explicit. Why not a managed workflow service, a message broker cluster, or a graph database: each would add a second source of truth or a second emulator whose behaviour can diverge from production. Postgres is the only stateful engine in the core path.

Why React and TypeScript for the front end: the Floor and bidder views are highly animated, and React with a single state store fed by the realtime frames keeps the rendered state a pure function of the event stream. This makes the "the screen is the projection" claim testable.

### D.2 Persistence model

Engine: PostgreSQL 16 (Aurora PostgreSQL in AWS, the `postgres:16` image locally). All times are `timestamptz` set by the database. Money is `bigint` minor units; no floating point anywhere.

Key tables:

```sql
create table auctions (
  id uuid primary key,
  title text not null,
  status text not null check (status in ('draft','live','closed')),
  next_seq bigint not null default 1,              -- per-auction sequence, advanced under the auction row lock
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
  close_at timestamptz not null,
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
  band_from_cents bigint not null,
  step_cents bigint not null,
  primary key (auction_id, ladder_version, band_from_cents)
);

create table registrations (
  auction_id uuid not null references auctions(id),
  bidder_id uuid not null,
  deposit_cents bigint not null,
  primary key (auction_id, bidder_id)
);

create table idempotency_keys (
  actor_id uuid not null,
  key text not null,
  route text not null,
  request_hash bytea not null,
  response jsonb not null,
  status int not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, key)
);

create table events (
  auction_id uuid not null references auctions(id),
  auction_seq bigint not null,
  lot_id uuid,
  kind text not null,                              -- bid_accepted, proxy_countered, extended, lot_closed, ...
  actor_id uuid,
  payload jsonb not null,                          -- canonical JSON (RFC 8785 style key ordering)
  prev_hash bytea not null,
  hash bytea not null,                             -- sha256(prev_hash || auction_seq || kind || payload)
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
  account text not null,                           -- 'bidder:<id>:deposit', 'consignor:<id>:payable', 'house:commission', ...
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
  primary key (consumer, message_id)
);

create table checkpoints (
  auction_id uuid not null references auctions(id),
  through_seq bigint not null,
  head_hash bytea not null,
  s3_key text not null,
  s3_version_id text not null,
  primary key (auction_id, through_seq)
);
```

Invariants enforced by the database, not the application:

- `events` is append-only. A `BEFORE UPDATE OR DELETE` trigger raises an exception. The trigger is the accident guard, not the security boundary; the hash chain and the checkpoints are the security boundary (see D.5).
- Ledger transactions balance. A `DEFERRABLE INITIALLY DEFERRED` constraint trigger checks `sum(amount_cents) = 0` per `txn_id` at commit.
- `bids` cannot diverge from `events` in the same transaction because both are written in the bid transaction; the verifier additionally checks this after the fact.
- `unique (lot_id, lot_version)` makes a double-applied bid a constraint violation even if application logic is wrong.

### D.3 Communication

**Synchronous (browser to API).** REST over HTTPS with JSON. Commands are `POST` with an `Idempotency-Key` header. Queries are `GET`. Every request carries a W3C `traceparent`. Responses for commands return the committed `auction_seq` and the lot version.

**Real-time (API and realtime to browser).** One WebSocket per session at `/ws`. The client sends `subscribe { auction_id, audience, from_seq }`. The server responds with a projection snapshot at the current `auction_seq` and then streams frames in `auction_seq` order. Frames are JSON, one event per frame, each containing `auction_seq`. The client treats any gap as a protocol error and reconnects with `from_seq` equal to the last contiguous sequence it applied. Wake-up latency is reduced with `LISTEN auction_<id>` notifications from the bid transaction, but correctness never depends on the notification: the realtime reader polls `events` by `(auction_id, auction_seq) > cursor` every 100 ms as the authoritative mechanism. The 100 ms poll interval is a configured value, and the observed fan-out latency is measured in rehearsal.

**Asynchronous (outbox, queue, workers).** The bid, close and settlement transactions write `outbox` rows in the same transaction as their events. A relay inside the settlement worker publishes unsent rows to SQS (`ElasticMQ` locally) with `message_id` as the deduplication key and marks `sent_at`. The notifier consumes, checks `processed_messages` in a transaction with the send record, and deletes the SQS message only after commit. Delivery is at-least-once; effect is once per `message_id`.

**Workers and claims.** The clock and settlement workers claim rows with `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction that also performs the state transition. A worker that dies holds no lock after its connection drops, and its claimed row returns to the pool.

### D.4 Consistency requirements per operation

| Operation | Requirement | How it is met | What a violation would look like |
|---|---|---|---|
| Place live bid | Linearizable per lot; exactly-once effect per idempotency key; amount must satisfy ladder against the locked current price | Transaction: lock auction row, lock lot row, check idempotency row, check registration and deposit, check ladder, check lot version, insert bid, evaluate proxies, insert events, update lot, insert outbox, store idempotency response, commit | Two leaders at the same version; a bid below the ladder; a retried bid counted twice |
| Proxy resolution | Resolution is a function of the locked state at the moment of the bid; ties go to the earlier proxy by `created_seq` | Same transaction as the bid; proxy rows are read under the lot lock | Proxy responds to a stale price; a visible proxy maximum |
| Anti-sniping extension | At most one extension per transaction; extension decided on the database clock | `close_at = greatest(close_at, now() + window)` evaluated in the bid transaction when `close_at - now() < window`; `extension_count` checked against the cap | Client-clock manipulation extends a lot; two extensions from one bid |
| Lot close | Exactly one closer; closing is a guarded transition | Clock worker: `select ... where status='open' and close_at <= now() for update skip locked`, then `update ... where status='open'` and check the row count | Two `lot_closed` events for one lot |
| Event sequencing | Contiguous `auction_seq` per auction; committed order equals sequence order | `next_seq` read and advanced under the auction row lock, which is held until commit | A reader sees seq 420 before 419; a permanent hole |
| Real-time delivery | Every committed event is delivered once, in order, to each subscribed session that is authorized to see it | Poll by `auction_seq` cursor; projection per audience; client gap detection and `from_seq` replay | A silent gap on reconnect; a bidder receives a reserve value |
| Audit | Any change to a stored event is detectable by a verifier that holds only the checkpoint | Per-auction hash chain; checkpoint objects in Object Lock compliance retention, written by a separate role | A rewritten history verifies clean |
| Notifications | At-least-once delivery, effect once per message id | Outbox, SQS, `processed_messages` dedupe in the consumer transaction | Duplicate email; missing email after a crash |
| Settlement | Each step applies once; a crashed step resumes; compensation is explicit | `settlement_steps` with step-level idempotency keys; each step is a transaction that writes ledger entries and an outbox row | Money moved twice; a step marked done without its entries |
| Ledger | Balanced per transaction | Deferred constraint trigger | An unbalanced transaction commits |

**Auction lock as the sequencing decision.** Serializing all bids within an auction is a deliberate trade. A live room runs one lot at a time for the audience, and the throughput limit that results (measured in rehearsal) is far above what a live room needs. The alternative, a global sequence with a horizon, was rejected: a `bigserial` assigned at insert and read by a poller produces permanent holes when an earlier insert commits after a later one. Assigning `auction_seq` under the auction lock makes commit order and sequence order identical, which is what the replay claim requires.

### D.5 Security boundaries and authorization model

**Identity.** OIDC authorization-code flow with PKCE in the browser. The API and realtime validate RS256 JWTs against the issuer's JWKS, check `aud`, `iss` and `exp`, and read a `groups` claim. Cognito provides `cognito:groups`; Keycloak provides the same values through a mapper in the imported realm. The services read one claim name configured per environment.

**Authorization.** Cedar policies in `policies/*.cedar`, evaluated in-process. Principals are the user and their role groups. Attributes that Cedar cannot read from the token (registration, deposit hold, consignor ownership, lot status) are loaded inside the transaction and passed as the entity store for that decision. Example rules, abbreviated:

```cedar
permission(principal in Role::"bidder", action == Action::"PlaceBid", resource)
  when { resource.status == "open"
         && principal.registered_for(resource.auction)
         && principal.deposit_held_for(resource.auction) >= context.amount };

forbid(principal, action == Action::"ReadReserve", resource)
  unless { principal in resource.consignor || principal in Role::"auctioneer" };
```

Denied decisions are returned with the policy identifier that denied them. This is what allows the rejection toast in the script to name a rule.

**Redaction.** The projection module takes an audience (floor, bidder with user id, consignor with user id, auctioneer, auditor) and an event, and returns the fields that audience may see. It is one function, unit-tested per audience, used by both the query path and the realtime path. Reserve values, proxy maxima and bidder identities are removed in the projection, not in the browser.

**Network boundaries.** Public subnets hold the ALB only. ECS tasks run in private subnets. The Aurora cluster accepts connections only from the task security group. Workers have no inbound rules. The object-lock bucket is writable only by the checkpointer role; the verifier role has read-only access, and no role has `s3:BypassGovernanceRetention`.

**Threat model, stated plainly.** The application enforces role and attribute authorization on every write. The database owner, which the demo deliberately exposes, can disable triggers and rewrite rows. Tideline does not try to stop that. It makes such a rewrite detectable: the per-auction hash chain makes any edit to a stored event fail verification, and the checkpoint in Object Lock compliance retention makes a re-computed chain fail against an anchor the database owner cannot change. The model does not protect against a compromise of both the database and the checkpointer role, and the documentation says so.

### D.6 Deployment topology (logical)

```
Browser ──HTTPS──▶ ALB (public)
                   ├─ /          ▶ web (static bundle, nginx image)
                   ├─ /api/*     ▶ server-api  (2 tasks)
                   └─ /ws        ▶ server-realtime (2 tasks, sticky off, idle timeout 3600 s)

server-api, server-realtime, workers ──▶ Aurora PostgreSQL (2 AZ)
server-api ──▶ outbox (rows in Postgres)
settlement worker relay ──▶ SQS notification queue ──▶ notifier ──▶ SES (sandbox identities)
checkpointer ──▶ S3 Object Lock bucket (compliance mode)
all services ──▶ OTLP ──▶ ADOT collector sidecar ──▶ X-Ray
```

---

## E. AWS and local deployment

### E.1 Container-first and immutability

- Two images: `tideline-web` (nginx, built static bundle) and `tideline-server` (Rust release binary, distroless base, non-root). Built once per commit in CI, pushed to ECR with tag immutability enabled, tagged with the git SHA and identified in deployment by digest.
- The same two images are referenced by digest in `compose.yaml` locally. A local run and an AWS run therefore differ in the configuration injected at runtime, never in the bytes that execute.
- Configuration is environment variables plus one policy bundle directory. AWS injects them from task definitions and SSM Parameter Store; locally they come from `compose.env`. No environment-specific code path exists in the binaries.
- Database migrations are sqlx migrations shipped inside `tideline-server`, run as a one-shot `migrate` role before API tasks start. Migrations are forward-only and each is idempotent under its checksum.

### E.2 Service mapping

| Concern | AWS | Local (Compose) | What differs | Why behaviour is unchanged |
|---|---|---|---|---|
| Relational store | Aurora PostgreSQL 16, 2 AZ | `postgres:16` container | Failover mechanics; Aurora's storage layer | Same engine and same SQL. The failover window is not in the five-minute script. |
| Identity | Cognito user pool with groups, hosted UI disabled (custom login page calls the authorization endpoint) | Keycloak with an imported realm containing the same eight users and four groups | Claim name and token lifetimes; Keycloak's realm JSON replaces Cognito's console setup | The services validate standard JWTs; the claim name is configuration. A contract test asserts both issuers produce identical authorization decisions for a fixed set of requests. |
| Queue | SQS standard queue with DLQ | ElasticMQ container speaking the SQS API | Redrive and metrics are less complete in ElasticMQ; no real throughput limits | The notifier uses the official SDK with an endpoint override (`AWS_ENDPOINT_URL_SQS`). Dedupe is in Postgres, so it does not depend on SQS's own dedupe window. |
| Email | SES v2 with verified sandbox identities | Mailpit (SMTP sink with a web UI) | SES sandbox requires verified recipients; Mailpit has no bounce handling | `MailSender` trait with two implementations behind one contract test. The demo recipients are verified in AWS before the run. |
| Object-lock checkpoints | S3 bucket, Object Lock compliance mode, versioning | MinIO with Object Lock enabled on bucket creation | MinIO's root user can bypass retention in ways S3 does not allow. The local verifier therefore cannot prove the trust argument; the AWS run can. | The checkpointer writes the same key format and uses the same SDK call. The "tamper" step is the same in both. The documentation labels the local trust gap explicitly. |
| Edge and WebSocket | ALB with path rules; idle timeout raised to 3600 s for `/ws` | nginx with `proxy_read_timeout 3600s` for `/ws` | ALB has its own health checks and draining behaviour | Both route the same paths. Health checks are the same `/readyz` endpoint. |
| Tracing | ADOT collector sidecar exporting to X-Ray | OpenTelemetry collector exporting to Jaeger | Span storage and UI | Same OTLP export and the same span names and attributes. The trace panel in the Console reads the trace ID and opens the backend-specific UI in a new tab. |
| Compute | ECS Fargate, 2 AZ, rolling deploy | Compose services, same images, same health checks | Scheduler and placement | Same commands (`tideline-server api`, `… worker --role clock`), same environment keys. |
| Secrets | Secrets Manager for the database password, referenced by ARN | `compose.env` file, git-ignored | Secret storage | Same environment variable names. |

### E.3 Reproducible configuration and reset

- `make up` (Compose) and `make deploy` (CDK) run the same migration and seed commands. `make reset` truncates demo tables, reloads the seed, and runs the verifier over the initial chain; it fails if the seed does not verify.
- Seeds are deterministic (fixed identifiers, fixed timestamps relative to a reset anchor), so each reset produces the same initial rows.
- `make rehearse` runs the Playwright script from C against a running environment, with the target chosen by a base URL. The same test code runs against `localhost` and the AWS ALB. The rehearsal fails on any assertion, including the latency targets.

### E.4 Infrastructure as code

AWS infrastructure is an AWS CDK application in TypeScript: one VPC, one ALB, one ECS cluster with five services, one Aurora cluster, one SQS queue with DLQ, one SES identity set, one S3 Object Lock bucket, one Cognito user pool, and IAM roles per service with the minimum actions listed in the stack. CDK was chosen over raw CloudFormation for readability and over Terraform because the same team writes the TypeScript front end and the infrastructure, which keeps one language review surface outside Rust.

The local stack is a single `compose.yaml` with the same services, names and environment keys. Compose is the only local orchestrator; no Kubernetes.

---

## F. Five strongest technical claims

Each claim has an executable test and an observable behaviour in the running demo.

**Claim 1. Concurrent bids on one lot produce a single, gap-free, strictly ordered history with no lost updates.**
- Test: `tests/bid_concurrency.rs` runs 200 virtual bidders against lot 14 with 50 attempted bids each, using randomized amounts within the ladder and a fixed random seed. Assertions after the run: every accepted bid has a unique `lot_version`; `lot_version` values are contiguous from 1; `events.auction_seq` is contiguous; the final `current_cents` equals the maximum accepted amount; the ledger balances; the replay of events reproduces `lots` exactly.
- Observable in the demo: the Console's sequence counter climbs without holes, and the Auditor's "Projection matches" line is the same check run on demand.

**Claim 2. A retried command has exactly one effect, and the retry receives the original response.**
- Test: `tests/idempotency.rs` uses a fault-injecting proxy in front of the API that drops the response after the commit for the first request. The client retries with the same key. Assertions: one row in `bids`, one `bid_accepted` event, identical response bodies, `idempotency_keys.status` equal to the original status, and a second retry with a different body for the same key returns `409`.
- Observable in the demo: steps 80–100, where Ben's window and the Floor disagree for two seconds and then agree on one bid.

**Claim 3. A reconnecting client receives every missing event exactly once, in order, and never a reserve or proxy maximum it was not authorized to see.**
- Test: `tests/replay.rs` kills the realtime process mid-stream during a scripted run of 300 events, reconnects with `from_seq`, and records every frame. Assertions: received sequence numbers form the set 1..300 with no duplicates, and frames for the bidder audience contain no `reserve_cents` and no `max_cents` field. A second test runs the same frames through the projection module for each audience and asserts the field sets.
- Observable in the demo: step 140–160, where the Floor fills the gap and displays the replay chip. The frame capture can be opened from the Console's network panel and grepped for the reserve value, which is absent.

**Claim 4. Anti-sniping and lot closure are deterministic, use only the database clock, and close each lot exactly once across replicas.**
- Test: `tests/snipe.rs` drives bids at fixed database times using `pg_sleep` in separate transactions and asserts the extension rule (one extension per transaction, the cap of 20, and `close_at` never decreasing). `tests/close_race.rs` starts four clock workers against 500 lots with deadlines already passed and asserts exactly one `lot_closed` event per lot and zero duplicates.
- Observable in the demo: the ring extending twice at steps 180–206 and the gavel firing once at step 206–214 with two clock replicas running.

**Claim 5. A rewritten audit record is detected, located to the exact sequence number, and cannot be hidden by recomputing the chain after the checkpoint.**
- Test: `tests/tamper.rs` builds a chain of 500 events, checkpoints at 250, then as a superuser disables the trigger, modifies event 180, recomputes hashes from 180 onward, and re-enables the trigger. Assertions: the verifier reports `hash_mismatch` at 180 when checked against the in-database chain alone, and reports `checkpoint_mismatch` at 250 when checked against the stored Object Lock head. A second test modifies only the projection `lots.current_cents` and asserts `projection_mismatch` at the last event for that lot.
- Observable in the demo: steps 256–300 in the Auditor pane, and the terminal session that performs the tamper.

**Cross-cutting claim.** The local and AWS deployments run the same `tests/contract/*` suite against the same images. The suite result is published as a table with one row per test and one column per environment. The known differences in E.2 are the only permitted failure rows, and each is an explicit allow-list entry with a reason.

---

## G. Failure analysis

### G.1 Implementation difficulties

**The sequence gap problem.** A `bigserial` assigned at insert, read by a poller, will eventually expose a hole, because transaction B can take a later sequence value and commit before transaction A with the earlier value. Naive fixes (waiting a fixed interval, or using `pg_snapshot_xmin` horizons) either add latency or still allow a gap when a long transaction stalls. The chosen fix serializes sequence assignment per auction under the auction row lock. This is correct, but it means the bid path holds the auction lock for the full transaction, including proxy evaluation and the outbox insert. The transaction must therefore stay short, and any remote call (there are none in the bid path) would be a defect.

**Lock ordering.** Bid, close and settlement all touch `auctions`, `lots`, `events` and `ledger_entries`. The rule is fixed: auction, then lot, then ledger. Deadlocks are still possible from application mistakes, so the rehearsal treats a Postgres deadlock error as a test failure and the code wraps every transaction with a single helper that enforces the order.

**Hash chain cost and canonical JSON.** The chain is only verifiable if the bytes hashed are reproducible. The payload is canonicalised (sorted keys, no insignificant whitespace, integers only, RFC 8785 rules for the subset used) before hashing, and a test fixes the expected hash for every event kind. A change to any payload shape therefore fails a golden test, which is intended.

**Realtime replay correctness.** The realtime reader must never deliver `auction_seq` n+1 before n, must not skip a sequence after a restart, and must bound its replay for a long disconnection. The reader keeps a cursor per subscription, reads in ascending order, and returns a `resync_required` frame if `from_seq` is older than the retained window. The retained window is the full auction history for the demo; the production answer (snapshot plus tail) is documented but not implemented, and this is listed under shallow features.

**Anti-sniping on a clock.** The database clock is authoritative, but the client renders countdowns from a measured offset. Offset drift on a long-running browser tab can make the ring disagree with the server by a fraction of a second. The mitigation is to re-sync the offset every 15 seconds and to treat the ring as a display only; the server's decision is the only one that matters.

**Outbox and trace propagation.** The outbox row stores the `traceparent` of the transaction that produced it, so the notifier's span is a child of the bid's span even though it runs seconds later. Engineers find this surprising, and it is a real difference from naive propagation. The cost is one text column.

**Cedar and attribute loading.** Authorization needs attributes that are not in the token. Loading them inside the transaction adds two queries to every bid. This is acceptable at demo volumes and is the reason the decision is made in the same transaction as the write.

**Keycloak versus Cognito claim differences.** Cognito places groups under `cognito:groups`; Keycloak places them under a configurable claim. The services read a configured claim name, but the custom attributes used by Cedar must be mapped identically. A contract test with fixed tokens from both issuers catches drift.

**Aurora and local Postgres parity.** Aurora's default parameter group, statement timeout and connection limits differ from the `postgres:16` container. The application sets its own statement and lock timeouts explicitly so behaviour is the same, and the config file that sets them is shared.

### G.2 On-stage failure modes and mitigations

| Failure | Effect on the demo | Mitigation |
|---|---|---|
| Venue Wi-Fi fails | AWS run impossible; Floor and bidders stop receiving frames | Primary run is local on the presenter's laptop with the same images. The AWS run is a second, separately rehearsed run. The rehearsal records the last green AWS run for reference, but no recorded video is substituted into the live run. |
| Projector resolution differs | Floor layout breaks | Floor view is designed at a 16:9 reference and scales with viewport units. Rehearsal includes 1280x720 and 1920x1080 checks. |
| SES sandbox rejects an unverified recipient | Buyer email missing at step 240–256 | All demo recipients verified before the run; the notifier logs send failures to the Console, and the step still shows the message as `processed`. |
| Realtime task restart takes longer than expected | Reconnect gap larger than planned | Replay is by sequence, so a longer gap only means more events to replay; the chip shows the count. Rehearsal times a restart from a cold container. |
| Proxy click missed | Ana's proxy not set; step 100–120 empty | Floor still shows the state; the script continues with Ben's bid, which is still valid. The rehearsal asserts the proxy path separately. |
| Late snipe | The ring has already closed before Ben bids | The close is correct and the Console says so. The presenter continues with the settlement step. The rehearsal times the snipe with a scripted fallback that bids at 0:09. |
| Clock worker replicas disagree on time | Lot closes early or late | Clocks are database-side only. Replicas do not read local time for decisions. |
| Tracing collector down | Trace panel empty | The trace panel shows the trace ID and a "collector unavailable" line. The waterfall is not on the critical path. Spans are buffered in the process and dropped without blocking. |
| Notifier crash during send | Duplicate or missing email | Dedupe in the consumer transaction with the send record. An email sent but not recorded is the one residual window; the mitigation is that SES sends are idempotent by the `message_id` header in the Mailpit path and recorded in the Console. |
| Checkpointer fails before step 256 | No checkpoint #2 | Checkpoint is written at each lot close and at a fixed count. The verifier reports "no anchor newer than checkpoint #1" and the step still demonstrates the in-chain detection. |
| Presenter types the wrong event number in the tamper step | Detection points elsewhere | The tamper command is a saved script with the event number resolved from the auction's current head minus a fixed offset. |
| Tamper command fails on a locked-down role | No tamper | The demo owner role is provisioned explicitly with `ALTER TABLE ... DISABLE TRIGGER` rights; the rehearsal runs the command before the demo. |
| Browser animation jank | Ring stutters | Ring uses CSS transform on a composited layer; the rehearsal measures frame times with the Performance API and fails on sustained long tasks above 50 ms during the snipe window. |

### G.3 Hidden complexity

- **Idempotency is harder than it looks**, because the stored response must be exactly the one the first request would have produced, including the `auction_seq` and the proxy counter-bid of the first attempt. The implementation stores the serialized response in the same transaction as the bid, so a crash cannot leave a stored response without its effect or the reverse.
- **Redaction is a correctness property, not a display property.** A bidder's WebSocket frames must not contain the reserve, and a reserve sometimes appears in aggregate fields (for example, a "reserve met" flag). The projection module therefore computes the flag only as a boolean and only for consignors and the auctioneer.
- **Ledger balance is a deferred constraint**, which means a bug surfaces at commit, not in the code that caused it. The settlement tests exercise each step's failure path to make the constraint's errors meaningful.
- **Event canonicalisation** is the single most fragile piece. Two services that serialise the same payload differently would produce different hashes. Only one crate serialises events; the others depend on it.
- **Clock sync on the client** looks trivial and is not. The ping-based offset must ignore outliers and must be re-measured after tab sleep.

### G.4 Features that look impressive but are shallow

These are listed so that an expert audience cannot find them before we do.

- **Floor animations.** The ring pulse, the tick flight and the gavel are CSS and Framer Motion effects over real state. They are real in that they fire on real events, but they do no work that a plain counter would not. They are there for the audience.
- **The ladder visual.** It renders the real increment table, and the rule it shows is the one the server enforces. It is still a single table of steps with one band per row.
- **Settlement.** Four steps and two ledger accounts per party. It is a sound saga for this scope and is not a payments system. There are no chargebacks, no currency conversion, no tax, and the "deposit hold" is an internal ledger movement with no bank.
- **Proxy bidding.** One proxy per bidder per lot, with a single counter-bid rule. Real and correct, but not a general auto-bidding strategy engine.
- **Authorization.** Roughly a dozen Cedar rules across five roles. Cedar is used properly, but the policy set is small enough to read in full during a review, and that is a feature for the demo and a limit in production.
- **Audit anchoring.** The checkpoint is in a bucket under the same AWS account as the database. The trust argument is strong against the database owner and weak against an account administrator. The documentation says this in the first paragraph of the audit section, and the verifier's output names the anchor's account.
- **Realtime replay window.** The full auction history is retained, which is trivially correct for a demo and wrong for a production auction with millions of events. The snapshot-plus-tail design is documented, not built.
- **Multi-auction.** The seed has two auctions, but the script uses one. Cross-auction behaviour is tested, not shown.
- **Observability dashboards.** The ops board is a list of health checks and counters. It is honest but not a monitoring product.

---

## H. Feasibility

The work is organised by dependency order. Each layer is runnable and testable on its own, and each later layer depends only on earlier ones. No durations are given.

### H.1 Layers and what each touches

1. **Schema, events and the bid transaction.** Migrations for D.2, the canonical event serializer, the hash chain, the auction and lot lock order, the ladder check and the bid function. Touches one crate, the database and the migration runner. Testable by the concurrency and chain tests (Claims 1 and 5) with no HTTP at all.
2. **API commands with idempotency and Cedar.** REST command handlers, the `idempotency_keys` path, Cedar policies and the entity loader, the redaction module with per-audience tests. Touches the API crate and the policy directory. Testable by the idempotency test (Claim 2) through a fault-injecting proxy.
3. **Realtime projection and replay.** WebSocket server, the poll reader, the `from_seq` protocol and the resync frame. Touches the realtime binary and the projection module. Testable by the replay test (Claim 3).
4. **Web: Floor, Bidder, Console.** React application over the realtime client, the REST client, the ladder component and the countdown. Touches the front-end project only. Testable by component tests and by the first half of the script in Playwright (steps 0–100).
5. **Clock worker and anti-sniping.** Due-lot claim, guarded close, extension rule. Touches the worker binary. Testable by Claim 4.
6. **Outbox, notifier, settlement saga and ledger.** Outbox relay, SQS and SMTP adapters, `processed_messages`, settlement steps, deferred ledger constraint. Touches the worker binary, the notifier, the ElasticMQ and Mailpit containers. Testable by the settlement failure-path tests and by steps 206–256 of the script.
7. **Checkpointer, verifier and the Auditor pane.** Checkpoint writer, Object Lock adapter (MinIO first, then S3), verifier with three checks, and the Auditor UI. Touches the checkpointer and the verifier. Testable by Claim 5 and by steps 256–300.
8. **Tracing.** OpenTelemetry instrumentation across API, realtime, workers and the front end, `traceparent` through the outbox, the trace panel. Touches every binary and the front end. Testable by a span-tree assertion in the rehearsal.
9. **Compose stack and reset.** `compose.yaml`, seeds, reset command, health and readiness endpoints, edge routing. Touches configuration and the seed data. Testable by `make reset && make rehearse` locally.
10. **CDK stack and AWS run.** VPC, ALB, ECS services, Aurora, SQS, SES identities, S3 Object Lock bucket, Cognito pool, IAM roles, secrets, image pipeline with digest pinning. Touches the infrastructure project only, and the application code not at all. Testable by the same contract suite and rehearsal run against the ALB.
11. **Rehearsal harness.** Playwright script for the full five minutes with assertions at each step, latency targets and frame-time checks. Touches the end-to-end project only. Testable by running it.

Layers 1 to 3 form the minimum vertical slice. It proves the architecture before any presentation layer exists: it is a serialized, authorized, idempotent, replayable bid path. Layers 4 to 9 are successive capability layers, and layer 10 changes only the deployment target.

### H.2 Critical dependencies

- **PostgreSQL 16** for the transaction, lock, trigger and deferred constraint semantics. Everything correct about the core depends on it.
- **sqlx** for compile-time query checking. A query change that breaks the schema fails the build, which is valued here but makes migrations order-sensitive.
- **Cedar (cedar-policy crate)** for in-process authorization. Its entity loading is the integration point with the transaction.
- **OpenTelemetry Rust crates** for tracing, whose APIs have changed across releases. Pinned versions are required.
- **Keycloak** and **ElasticMQ** and **MinIO** as local stand-ins. Each has behaviour gaps listed in E.2; each is replaceable by its AWS counterpart through configuration.
- **AWS services** used in the AWS run: Aurora, ECS Fargate, ALB, SQS, SES (sandbox), S3 with Object Lock, Cognito, X-Ray, Secrets Manager, ECR, CDK.
- **Playwright** for the rehearsal, which is the only test runner that drives four sessions in one scripted run.

### H.3 Main risks

1. **Per-auction lock throughput under the rehearsal's worst case.** The auction lock is intentional, but it is the single serialization point. Risk: the bid transaction holds the lock longer than the animation budget allows under load. Mitigation: measure in layer 1; keep the transaction free of remote calls; the demo's realistic load is a few bids per second.
2. **Realtime replay correctness.** Risk: a subtle ordering bug in the reader. Mitigation: Claim 3 is a test before the web layer exists; the reader is built as a pure function over an in-memory event list first, then connected to the database.
3. **Canonical JSON and hash stability.** Risk: a payload change silently invalidates the chain. Mitigation: golden hashes per event kind, and a rule that payload shapes are changed only by adding a new event kind.
4. **Keycloak and Cognito parity.** Risk: different claim shapes lead to different authorization decisions locally and in AWS. Mitigation: the contract suite with fixed tokens from both issuers, run in CI before the AWS layer is considered done.
5. **SES sandbox and email delivery in the live run.** Risk: a sandbox limit or a bounce blocks step 240–256. Mitigation: pre-verified recipients, and the Console shows the send state from the notifier's own record rather than from SES's delivery status.
6. **WebSocket behaviour through the ALB.** Risk: idle timeouts, connection draining during deploys, or sticky-session misconfiguration. Mitigation: explicit idle timeout, deregistration delay set low for the realtime target group, and a rehearsal that restarts a realtime task behind the ALB.
7. **Trace propagation through the outbox.** Risk: spans that appear detached in the waterfall. Mitigation: the trace assertion in layer 8 checks that the notifier span has the bid's trace ID.
8. **Animation performance on the projector.** Risk: a frame drop during the snipe, the most visible moment. Mitigation: composited CSS transforms, the frame-time check in the rehearsal, and a reduced-motion setting that keeps the state change but removes the flight animation.
9. **Scope creep in the Floor view.** Risk: the visual layer grows faster than the architecture it depicts. Mitigation: the Floor is layer 4, and no new visual is added to the script unless a capability it shows is already in the inventory.
10. **The tamper step's credibility.** Risk: an expert audience decides the tamper is contrived. Mitigation: the threat model is stated on screen before the tamper, the trigger is real and disabled through the same role the database owner would use, and the verifier reports only what it can prove.

### H.4 What the proposal does not claim

- It does not claim throughput beyond what a live room needs. Serialization per auction is the stated design, and the rehearsal reports measured figures.
- It does not claim that the audit anchor is independent of the cloud provider's account administration.
- It does not claim a production-grade ledger, payments processing, or tax handling.
- It does not depend on any live third-party service in the core demonstration. Cognito, SES and X-Ray are AWS services in the AWS run, and each has a local stand-in with the documented differences.
