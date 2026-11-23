# Sealroom: blind panel review with a record that cannot be quietly rewritten

Competitor 06, mandate: Unconventional Innovation.

Sealroom is a panel-review system for a research foundation. Reviewers score each proposal by sealing a commitment in their browser. Nobody, including the database owner, can read a score until every assigned reviewer has sealed one and revealed it. Every decision is written to a hash-chained audit log whose head is anchored to an S3 Object Lock bucket, so the record can be checked by anyone, offline, and a rewrite by the person who runs the database is detected even when that person recomputes the whole chain.

The mandate asks for something unconventional. Commit-reveal is a cryptographic protocol that engineers know from sealed-bid auctions and voting research, but almost nothing ships it as a product for ordinary reviewers. Putting it in a grant panel, and making its guarantees visible on stage, is the surprise. The technical content is deliberately conventional where it can be: Postgres, Fastify, React, SQS, ECS, RDS, CloudFront, Cognito. The unusual parts are the places where the guarantees are enforced, and the way the demo makes the audience watch them being enforced.

---

## A. Product concept

**Application.** Sealroom runs one panel round at a time for a fictional foundation, the "Northfield Climate Adaptation Fund". A round has six proposals, four reviewers, one programme officer and one auditor. Applicants see only the status of their own proposal. The sample data is fixed and reproducible: fixed identities, fixed proposal IDs (P-1 to P-6), fixed commitments derived from fixed nonces in the seed file, so every rehearsal starts from the same bytes.

**Users and roles.**

| Role | Who | What they can do |
|---|---|---|
| Officer | Programme officer (Nadia Solberg) | Creates the round, assigns reviewers and conflicts, moves the round through its states, sees commit counts and, after close, all scores. Cannot score. |
| Reviewer | Ada Vance, Ben Okoro, Cora Lindqvist, Dev Marr | Seals and reveals scores on assigned proposals where no conflict is declared. Sees own sealed state at all times; sees other scores only after close. |
| Applicant | Northfield Reed Collective (applicant contact) | Sees proposal status and the round's public state. Never sees scores or reviewer identities. |
| Auditor | Independent audit contact (Tomas Ferreira) | Reads the audit log, runs the verifier, sees integrity status. Cannot change anything. |

**Problems solved.**

1. Reviewers anchor on each other. Sealed scores remove the ability to adjust to the room.
2. Reveal must be simultaneous and verifiable. Nobody can change a score after seeing others, and the outcome is shown the same way to everyone.
3. Conflicts of interest must be enforced by the system, not by a checkbox the reviewer ignores. A reviewer with a declared conflict cannot seal on that proposal through any route, including a direct API call.
4. The record of who decided what must survive the people who operate the system. Foundations, funders and auditors need to demonstrate that a decision was not edited after the fact.

**Why it suits this demo.**

- The domain is immediately legible to an audience of engineers without explanation. "Nobody sees the answer until everybody commits" needs one sentence.
- Every claim has a visible surface. A score that is sealed shows as a 64-character hex string in a terminal. A conflict shows as a refused request. A rewrite shows as a red verifier.
- The four browser windows the presenter drives are four different identities, so multi-session real-time behaviour is the normal way the product is used, not a feature bolted on for the demo.
- The strongest moment is an attack that passes the internal check and fails the external one. That is the substantiation the brief asks for, performed live.

---

## B. Capability inventory

Capabilities marked **demonstrated** appear in the five-minute script and are observable by the audience. Capabilities marked **supporting** make the demonstrated ones work, or are visible only in passing.

| # | Capability | Kind | Technical significance | Interactions |
|---|---|---|---|---|
| C1 | Commit-reveal blind scoring | demonstrated | Scores exist in storage only as SHA-256 commitments over a length-prefixed encoding with a 256-bit random nonce. The score is recoverable only with the nonce, which lives in the reviewer's browser. | Sealing is C6-idempotent. Reveal is verified by C1's server check and by the browser before sending. Feeds C3 (round transition) and C7 (audit). |
| C2 | Database-enforced authorization | demonstrated | Row-level security with `FORCE ROW LEVEL SECURITY` on every panel table. The API sets the acting identity per transaction; policies decide visibility and conflict-of-interest blocking. The application role is not the table owner. | Policies read `assignments` (COI flag) and `rounds.state`. The score view (see D) applies the reveal rule. Denials are written to C7. |
| C3 | Round state machine with transactional side effects | demonstrated | `draft -> committing -> revealing -> closed` transitions are guarded by row-locked updates. A commit that completes the set moves the round to `revealing` in the same transaction as the commit row, the audit event and the outbox message. | Triggers C4 messages and C5 notifications. Deadlines are enforced by C12. |
| C4 | Transactional outbox with idempotent async consumers | demonstrated | Side effects that leave the database (email, anchoring) are published from an `outbox` table written in the same transaction as the state change. A relay moves rows to SQS. Consumers record processed message keys, so redelivery produces one effect. | Carries reveal-open emails (visible in Mailpit/SES), anchor jobs for C8. |
| C5 | Real-time fan-out across API instances | demonstrated | Postgres `LISTEN/NOTIFY` on a dedicated, non-pooled connection in every API task. Each notify payload carries round ID, per-round sequence number and visibility class, never score values. Each task fans out to its own WebSocket clients, filtering by visibility. Clients detect gaps by sequence number and resync from a snapshot endpoint. | Notifications are sent at commit, so they never announce uncommitted state. Interacts with C2 (visibility) and C3 (state changes). |
| C6 | Idempotent writes | demonstrated | `Idempotency-Key` on every mutating call. The key, actor, route and request hash are stored with the response in one transaction with the effect. Replay returns the stored response; reuse with a different body returns 422. | Makes the reconnecting-browser and the double-click cases safe. Used by C1 and C3. |
| C7 | Hash-chained append-only audit log, browser-verified | demonstrated | Every authorization decision, state change, commit, reveal and rejected reveal writes an audit row. `hash = SHA-256(prev_hash || canonical_payload_bytes)`. The chain is serialized by a transaction-scoped advisory lock. The payload is stored as the exact text that was hashed, not as `jsonb`, so re-serialization cannot change it. | Written by C1, C2, C3. Read and verified in the browser by C10. Head anchored by C8. |
| C8 | External anchoring with continuous integrity check | demonstrated | On reveal close and on a schedule, the worker writes the chain head (sequence and hash) to an S3 bucket with Object Lock in compliance mode, and records the returned version ID. A worker check recomputes the chain at each anchored sequence and sets `integrity_status`, which is pushed to all sessions through C5. | Depends on C4 (job), C7 (chain). Its result is shown in the Auditor view and in all windows. |
| C9 | OIDC identity with signature verification | supporting | The API verifies RS256 tokens against the issuer's JWKS, checks `iss`, `aud`, `exp`, `nbf`. Identity comes from the token. Roles do not: they come from per-round assignments in the database, so a changed assignment takes effect on the next request. | Cognito in AWS, Dex locally. Feeds C2 as the acting identity. |
| C10 | Offline verifier bundle | demonstrated | The auditor exports a single self-contained HTML file containing the chain segment and the verification code. It runs in any browser from `file://` with no network. The same code verifies the live chain in the Auditor view. | Uses C1's canonical encoding and C7's hash definition. Shares test vectors with the API. |
| C11 | Immutable, digest-pinned, signed images | supporting | One set of OCI images (`sealroom-web`, `sealroom-api`, which doubles as worker by command override) is built once in CI, scanned, signed and referenced by digest in both ECS and Compose. | Makes the "same artifacts" claim checkable. Visible on stage only as the digest shown in the footer of every window. |
| C12 | Deadline sweeper with `SKIP LOCKED` | supporting | The worker selects due rounds with `FOR UPDATE SKIP LOCKED`, applies the guarded transition, and writes audit and outbox rows. Multiple workers can run without coordinating. | Triggers C3 transitions on deadline. Demonstrated only in the rehearsal's deadline variant. |

**Interaction summary.** The core loop is C1 + C6 (seal) -> C2 (who may see what) -> C3 (state change, same transaction) -> C5 (every session updates) -> C4 (email) -> C7 (record) -> C8 (anchor) -> C10 (verify). No capability in the table is decorative: each is either consumed by another or is the surface on which another's guarantee becomes visible.

---

## C. Five-minute live script

**Setup before the audience arrives.** The seeded round is in `committing`. Reviewer Cora has sealed P-3 already, so the counter reads 1 of 4. Five browser windows are tiled on one screen in a 3x2 grid: Officer, Ada, Ben, Applicant, Auditor, and a terminal. Each browser window is signed in as its own identity from a cached token (refresh token stored in that browser profile, so no login UI appears on stage). The footer of every window shows the image digest of the running build. The presenter's terminal has the owner-role `psql` session prepared. The environment is the AWS stack; the local Compose stack is the fallback.

| Time (s) | Presenter action | Expected behaviour | Visible result | Capabilities | Transition |
|---|---|---|---|---|---|
| 0–30 | Says one sentence: four reviewers, six proposals, and nobody sees a score until everybody has sealed one. Points at the Officer window's round card. | Officer and Applicant both load the same round snapshot. Counts are public; values are not. | Officer: "Committing · 1 of 4 sealed on P-3". Applicant: "Under review". Same snapshot sequence number in both footers. | C2 (role-scoped views), C5 (snapshot), C11 (digest footer) | Clicks Ada's window. |
| 30–60 | Ada selects 8 on P-3 and presses "Seal". | Browser draws a 256-bit nonce, computes the commitment, stores `(score, nonce)` encrypted in IndexedDB, POSTs the commitment with an `Idempotency-Key`. API returns 201 and writes audit, outbox and notify in one transaction. | Ada's card: "Sealed. Commitment 3f9c…d21. Keep this device for reveal." Officer and Applicant counters move to 2 of 4 within about a second, with no refresh. | C1, C6, C3, C5, C7 | Presenter switches to Applicant window. |
| 60–90 | In the Applicant window, the presenter clicks "Scores" (a link that exists in the UI for the officer and the reviewers; the applicant's client still renders it, as a deliberate test surface). | API responds 403 `not_authorized`. The denial is audited with the acting identity and route. The database would also return zero rows to this identity for the scores view. | Applicant sees a plain refusal. Auditor window's live feed gains a line "denied · applicant · scores P-3". | C2, C7, C5 | Presenter moves to Ben's window. |
| 90–115 | Ben selects P-5 (where Ben has a declared conflict) and presses Seal, then in the terminal repeats the same request with Ben's token using `curl`. | UI disables the control with reason "Conflict declared". The raw request is refused by the database policy, not only by the route handler. | Browser shows the disabled control. Terminal prints `403 conflict_of_interest`. Auditor feed gains "denied · reviewer Ben · seal P-5 · conflict". | C2 (COI policy), C7, C9 | Presenter moves to the terminal. |
| 115–140 | In the terminal, as the database owner: `SELECT * FROM score_commitments;` then `\d score_commitments`, then `SELECT count(*) FROM information_schema.columns WHERE column_name ILIKE '%score%' AND table_name='score_commitments';` | Rows show `commitment bytea` of 32 bytes and `revealed_score` NULL. There is no plaintext score column populated before reveal. | Two-row table of 64-hex commitments and NULL columns on screen. Presenter says: "This is the owner's view. There is no score to read." | C1 (storage design), C2 (owner bypasses RLS and sees only commitments, because nothing else is stored) | Presenter returns to Ben's window. |
| 140–170 | Ben seals P-3 (count reaches 3 of 4). Then Dev seals P-3 (count reaches 4 of 4). | Fourth commitment: one transaction inserts the row, sets `rounds.state = 'revealing'`, writes audit and outbox rows, and notifies. Outbox relay publishes to SQS; worker consumes and sends "Reveal open" to each assigned reviewer. | All four windows flip to a "Reveal open" banner in the same snapshot sequence. Mailpit (shown in the terminal split) shows four emails within about two seconds of the commit. | C3, C4, C5, C4-consumer idempotency, C7 | Presenter asks Ben to reveal with a changed score. |
| 170–190 | In Ben's window, the presenter edits the stored score in the browser's IndexedDB from 7 to 9 (a visible developer-tools edit, done on purpose), then presses "Reveal". | Browser verifies its own commitment locally first: mismatch, so it refuses to send. Presenter forces the request via `curl` with the altered pair. Server recomputes the commitment, mismatch, and rejects. | Ben's window: "Commitment does not match the sealed value. Nothing was sent." Terminal: `409 commitment_mismatch`. Auditor feed: "reveal_rejected · reviewer Ben · P-3". Round state unchanged. | C1 (binding, client and server), C7 | Presenter switches to Ben's window and reveals the correct 7 from the original IndexedDB record. |
| 190–215 | Ada, Cora, Dev and Ben reveal in turn. Each reveal is accepted with "verified against commitment". The last one completes the set. | The final reveal's transaction sets all four revealed values, moves the round to `closed`, writes audit and outbox rows, and notifies once. | All four windows update in the same snapshot: scores 8, 7, 6, 7, median 7, each with a "verified" badge. No window updates before the others. | C1, C3, C5 (single-commit fan-out), C2 (scores visible now that round is closed) | Presenter opens the Auditor window. |
| 215–240 | In the Auditor window, presenter opens the verifier. | Verifier fetches the chain and recomputes every hash in WebCrypto. Worker's last anchor is compared with the recomputed hash at the anchored sequence. | Green: "Chain intact · 47 entries · head 7a1e…c03 · anchored at 14:02:11 to a locked bucket, version matches." | C7, C8, C10 | Presenter explains the anchor in one line and downloads the bundle. |
| 240–255 | Presenter downloads the offline verifier bundle and opens `sealroom-verify.html` from the Downloads folder in a new browser window, with the network interface disabled (or simply with no network route, as the page makes no requests). | Page loads from `file://`, verifies the embedded segment, shows the same head hash. | Same green result, offline. Presenter: "Anyone with the file can check this. No login, no server." | C10, C1/C7 shared encoding | Presenter moves to the terminal for the attack. |
| 255–275 | Presenter, as the database owner, changes the P-3 reveal event's payload from median 7 to median 5 in `audit_events`, then runs `sealroom-admin rechain --from 44` which recomputes every hash from seq 44 forward, the way a careful attacker would. | Database accepts the change; the trigger-free schema has no protection against the owner. The rechain succeeds because the owner can compute SHA-256. | Terminal shows the rewritten row and "rechained 4 entries". | C7 (what the owner can do), C2 (owner bypasses RLS) | Presenter refreshes the Auditor verifier. |
| 275–300 | Presenter refreshes the Auditor window. Then all windows update. | Verifier's internal check passes: the rewritten chain is self-consistent. The worker's continuous integrity check, on its next run, recomputes the chain at the anchored sequence and finds a different head than the one in the locked bucket. It writes `integrity_status = anchor_mismatch` and notifies. | Auditor: "Internal chain: intact. Anchor: MISMATCH at seq 44. Anchored head 7a1e…c03, current 0c9b…4e1." In every other window a red banner: "Integrity: tampering detected at seq 44." Presenter's last line: "The database owner could rewrite history. They could not rewrite the bucket." | C8, C5, C7, C10 | End. Presenter runs `make demo-reset` in the terminal, and the windows return to the seeded state. |

**Timing and fallback.** Every network-bound step has a rehearsal budget (for example, a commit-to-all-windows delivery target of under one second at the 95th percentile in the rehearsal environment, a labelled target to be measured, not a promise). If a step exceeds its budget, the rehearsal fails rather than the stage. The presenter does not type sentences into any field; scores are chosen with buttons; the terminal commands are pre-pasted into a snippet pane.

**Why the last 30 seconds is the strongest moment.** The audience has just seen a verifier pass. The attacker's change is internally consistent. What fails is a fact stored outside the database that the database owner cannot reach, and the failure appears in four windows at once without anyone refreshing. This is substantiation: a claim ("the record cannot be quietly rewritten") is shown to hold against a stronger adversary than the one the claim was framed for.

---

## D. Technical architecture

### D.1 Components

| Component | Implementation | Why |
|---|---|---|
| `sealroom-web` | React 19, TypeScript, Vite, TanStack Query, WebCrypto (SHA-256, AES-GCM for local nonce storage), IndexedDB | WebCrypto is the only hash implementation the browser needs; no crypto library is shipped to the client. |
| `sealroom-api` | Node.js 22 LTS, TypeScript, Fastify 5, `@fastify/websocket`, `pg` with hand-written SQL, `zod` for request schemas, `jose` for JWT and JWKS | Hand-written SQL keeps RLS, advisory locks, `FOR UPDATE` and `LISTEN` visible to the reader. An ORM hides exactly the parts the demo depends on. |
| `sealroom-worker` | Same image as the API, different command (`node dist/worker.js`). | One artifact, two roles. Least privilege is applied by IAM and by database roles, not by building a second image. |
| Database | PostgreSQL 16. RDS for PostgreSQL in AWS; `postgres:16` container locally. Schema by numbered SQL migrations, applied by the same migration runner in both environments. | RLS, `LISTEN/NOTIFY`, advisory locks and `SKIP LOCKED` are all native; nothing needs a second store. |
| Queue | Amazon SQS standard queue with a dead-letter queue. ElasticMQ locally. | The outbox pattern needs a durable queue; SQS is the managed equivalent. |
| Object store (anchors) | S3 bucket with Object Lock in compliance mode, versioning on. MinIO with Object Lock locally. | Compliance-mode retention prevents deletion of the anchor by any principal, including the account root, until retention ends. |
| Identity | Cognito user pool (AWS); Dex with static users (local). Same OIDC discovery and JWKS path. | The API's verification code is identical; only issuer, audience and JWKS URL differ. |
| Email | SES through its SMTP interface (AWS); Mailpit (local). | Same SMTP client code path. |
| Edge | CloudFront with two behaviours (`/` to S3 static origin; `/api/*` and `/ws` to ALB). Local: `nginx` with the same two location rules. | Path contract is identical; the web bundle uses relative URLs only. |
| Observability | OpenTelemetry traces from the API and worker; CloudWatch logs in AWS; stdout JSON locally, with Jaeger for traces. | Supporting; used to explain failures, not to demonstrate them. |

### D.2 Persistence schema

Core tables (abbreviated; all in schema `sealroom`):

```
rounds(id uuid pk, name text, state text check (state in
  ('draft','committing','revealing','closed')), commit_deadline timestamptz,
  reveal_deadline timestamptz, event_seq bigint not null default 0, version int)

people(id uuid pk, subject text unique, display_name text)  -- subject = OIDC sub

proposals(id text pk, round_id uuid fk, applicant_id uuid fk, title text)

assignments(round_id, proposal_id, reviewer_id, coi boolean not null default false,
  primary key (round_id, proposal_id, reviewer_id))
  -- role per round: officer / reviewer / applicant / auditor (round_roles table)

score_commitments(round_id, proposal_id, reviewer_id,
  commitment bytea check (octet_length(commitment)=32),
  sealed_at timestamptz, idem_key text,
  revealed_score smallint null check (revealed_score between 0 and 10),
  revealed_nonce bytea null, revealed_at timestamptz null,
  primary key (round_id, proposal_id, reviewer_id),
  check ((revealed_score is null) = (revealed_at is null)))

round_events(round_id uuid, seq bigint, kind text, visibility text,
  payload_canonical text, created_at timestamptz, primary key (round_id, seq))

audit_events(seq bigint generated always as identity pk, occurred_at timestamptz,
  actor_id uuid null, action text, subject text, payload_canonical text,
  prev_hash bytea, hash bytea)

anchors(id bigserial pk, audit_seq bigint, head_hash bytea,
  s3_key text, s3_version_id text, anchored_at timestamptz)

integrity_status(id smallint pk check (id=1), checked_at timestamptz,
  state text check (state in ('ok','anchor_mismatch','anchor_stale','unknown')),
  detail jsonb)

outbox(id bigserial pk, topic text, payload_canonical text,
  created_at timestamptz, relayed_at timestamptz null)

consumed_messages(consumer text, message_key text, primary key (consumer, message_key))

idempotency_keys(actor_id uuid, key text, route text, request_hash bytea,
  response_status int, response_body text, created_at timestamptz,
  primary key (actor_id, key))
```

Design notes that an implementer must respect:

- **Scores are never stored in plaintext before reveal.** `revealed_score` is NULL until the reveal transaction; the commitment is the only value present. The check constraint enforces that the two reveal columns are set together.
- **Payloads are text, not `jsonb`.** `payload_canonical` is the exact byte sequence the server hashed. `jsonb` normalises key order and whitespace, which would make the stored bytes differ from the hashed bytes.
- **The score view is the only read path for other reviewers.** Application roles have no `SELECT` on `score_commitments`; they read `sealroom.score_view`, a `security_barrier` view that returns `revealed_score` only if the caller is an officer, or the caller is the reviewer who sealed it, or `rounds.state = 'closed'`.
- **Round events carry visibility classes**, `public_counts`, `public_state`, `reveal_public` and `officer_only`. Notifications carry the class and sequence, not the content. The fan-out filters on class per subscriber.

### D.3 Cryptographic definitions

- **Commitment.** `C = SHA-256( "sealroom/commit/v1" || L(round) || L(proposal) || L(reviewer) || L(score_be1) || nonce )`, where `L(x)` is a 2-byte big-endian length prefix, `score_be1` is the score as one byte, and `nonce` is 32 random bytes. Length prefixes remove concatenation ambiguity; the domain tag separates this use from every other hash in the system.
- **Chain.** `H_n = SHA-256( H_{n-1} || payload_canonical_bytes_n || L(action) || L(subject) )`, with `H_0` = 32 zero bytes. Payload text is UTF-8, produced once by the server and stored verbatim.
- **Anchor.** A JSON object `{"v":1,"seq":N,"head":"<hex>","round":"<uuid>"}` written to `anchors/<round>/<N>.json` with compliance retention. The head is the hash at seq N, not the chain root.
- **Test vectors.** A shared file of fixed inputs and expected digests is consumed by the Node test suite and by the browser verifier's test page. Any byte-level drift between the two fails both.

### D.4 Communication

- **Synchronous.** REST over HTTPS/JSON for all commands and queries. Commands require `Idempotency-Key`. Snapshot endpoint `GET /api/rounds/:id/snapshot` returns current state and `event_seq`.
- **Real-time.** WebSocket at `/ws`, authenticated by a token sent as the first message (not in the URL, so it does not appear in access logs). The server pushes `{seq, kind, visibility, payload}` in sequence order per round. Clients track the last `seq`; a gap triggers a snapshot fetch and a resubscribe from the snapshot's sequence. Server ping every 20 seconds, below the ALB idle timeout set to 60 seconds.
- **Cross-instance.** Each API task holds one long-lived `pg` client, not drawn from a pool, that runs `LISTEN sealroom_events`. Notifications are emitted with `pg_notify` inside the transaction that wrote the event, so a notification is delivered only if its transaction committed. Payloads are kept under the 8000-byte limit by carrying identifiers only.
- **Asynchronous.** Outbox rows are relayed to SQS by the worker in batches of ten, marked `relayed_at` after `SendMessageBatch` succeeds. Consumers are idempotent on `(consumer, message_key)`, where the key is the outbox ID.

### D.5 Security boundaries and authorization rules

Boundaries, from outside in:

1. **Edge.** TLS terminates at CloudFront and the ALB. Locally, TLS is out of scope and documented as such. WAF is optional and not in the demo path.
2. **API.** Verifies signatures, issuer, audience and expiry. Maps `sub` to `people.id`. Sets `app.actor_id` with `set_config(..., true)` at the start of every transaction, so the actor is transaction-local and cannot leak through pooled connections.
3. **Database.** Roles: `sealroom_owner` (migrations only, not used by any running process), `sealroom_app` (API, no ownership, `FORCE ROW LEVEL SECURITY` on every panel table), `sealroom_worker` (outbox, consumed messages, integrity status, anchors; no delete on audit). Policies refer to `current_setting('app.actor_id')`.
4. **Worker.** IAM role limited to `sqs:ReceiveMessage`, `sqs:DeleteMessage` on its queue; `s3:PutObject` and `s3:GetObject` on `anchors/*`, no `DeleteObject`. Compliance retention makes delete unavailable regardless.
5. **Anchor bucket.** Object Lock compliance, versioning, bucket policy denies `s3:DeleteObjectVersion` for all principals including root.

Authorization is expressed as data, not code. The rules:

- Officer on a round: sees all assignments, commitments (hashes), counts; transitions state; cannot insert a commitment (no reviewer row exists for officers).
- Reviewer: inserts a commitment only where `assignments.coi = false`, `rounds.state = 'committing'`, and the row's `reviewer_id` equals the actor. Reveals only own row, and only in `revealing` or `committing`-with-deadline (rejected otherwise).
- Applicant: reads `proposals` where `applicant_id` is the actor; reads round public state.
- Auditor: reads `audit_events`, `anchors`, `integrity_status`. No write policy.

Policies are checked in the database. Route handlers perform the same checks to return the right error code, but a route-handler bug cannot grant access the policy would deny.

### D.6 Consistency requirements per operation

| Operation | Consistency requirement | Mechanism |
|---|---|---|
| Seal commitment | Exactly one commitment per (round, proposal, reviewer); commit only in `committing`; the set-completion transition happens exactly once, atomically with the insert. | Single transaction: `SELECT ... FROM rounds WHERE id=$1 FOR UPDATE` (serializes per round), guarded insert, conditional state update, `event_seq` increment, audit append under advisory lock, outbox insert, `pg_notify`. Idempotency row written in the same transaction. |
| Reveal | Revealed score must match the sealed commitment; the round closes exactly once when the last expected reveal lands. | Same row lock; server recomputes C from (round, proposal, reviewer, score, nonce) and compares in constant time. Closing is a conditional update `WHERE state='revealing' AND not exists (unrevealed rows)`. |
| Audit append | Chain has no forks and no gaps in sequence order. | `pg_advisory_xact_lock(hashtext('sealroom-audit'))` held for the duration of the writing transaction. Serialized, so the chain head read and the insert cannot race. |
| Event fan-out | Subscribers never observe a state before it is committed; gaps are detectable. | Notify at commit; per-round `event_seq` assigned under the round row lock; client resync on gap. Delivery to sockets is at-most-once per connection and made at-least-once by resync. |
| Outbox relay | No outbox row lost; duplicates allowed but absorbed. | Relay marks `relayed_at` only after SQS success; consumer dedupes on outbox ID. |
| Deadline sweep | A round transitions at most once per deadline, across any number of workers. | `SELECT ... FOR UPDATE SKIP LOCKED` on due rounds, then guarded update. |
| Anchor | Anchor written at most once per (round, audit_seq). | Anchor key includes audit sequence; retention means a second write with the same key creates a new version that the check reads by the recorded version ID. |

Two operations are deliberately not linearizable across the whole system: the anchor write and the database commit. The anchor is intentionally behind the database by up to one worker interval; the integrity status reports `anchor_stale` (not `ok`) when the anchored head is older than the interval.

### D.7 Deployment topology

**AWS.** One VPC across two availability zones. Public subnets hold the ALB and NAT. Private subnets hold ECS Fargate services `api` (two tasks) and `worker` (one task), and RDS PostgreSQL (single-AZ for the demo, Multi-AZ by a stack parameter). CloudFront fronts an S3 bucket for the web bundle and the ALB for `/api/*` and `/ws`. SQS with DLQ, Cognito user pool, SES identity, Secrets Manager for the database credentials and the signing configuration, ECR with immutable tags and scan-on-push, CloudWatch log groups. Infrastructure is AWS CDK in TypeScript, with one stack per concern (network, data, messaging, identity, anchors, compute, edge).

**Local.** A Compose project with: `web` (nginx serving the same bundle with the same path rules), `api`, `worker`, `postgres`, `elasticmq`, `minio` (with a one-shot init container that creates the Object Lock bucket), `dex`, `mailpit`, and `jaeger`. Every service uses the same image digests as AWS. The migration job runs `sealroom-api migrate` against the same migration files.

---

## E. AWS and local deployment

**Build once.** CI builds `sealroom-web` and `sealroom-api` from digest-pinned base images (`node:22-bookworm-slim`, `nginx:1.27-alpine`), with a frozen lockfile. The build produces an OCI archive per image. Images are pushed to ECR, scanned, signed with a detached signature over the digest, and the digests are written to a manifest. The local stack loads the same archives with `docker load` and runs them by digest. `make up` refuses to start if a running image's digest differs from the manifest.

**Immutability.** Tags are for humans; digests are for machines. ECS task definitions and Compose both reference digests. Nothing is built on a laptop for the demo. The rehearsal records the digests it used in its report.

**Reproducible configuration.** All configuration is environment variables, validated at startup with `zod`. The difference between environments is one file per environment (`env/aws.env`, `env/local.env`) containing issuer URL, JWKS URL, SQS URL, S3 endpoint, SMTP host, and database URL. No code branches on environment name. The only permitted environment-specific code is the adapter selection, which is by configuration key, and each adapter has a contract test.

**Adapter interfaces.**

| Interface | AWS adapter | Local adapter | What must be identical |
|---|---|---|---|
| `IdentityVerifier` | Cognito JWKS | Dex JWKS | Same verification code; same claim checks |
| `Queue` | SQS `SendMessageBatch`, `ReceiveMessage`, `DeleteMessage` | ElasticMQ via same SDK with endpoint override | Same at-least-once semantics; same DLQ redrive rule |
| `AnchorStore` | S3 `PutObject` with `ObjectLockMode=COMPLIANCE` and retain-until | MinIO with Object Lock bucket | Version ID returned; delete refused; retention refused shortening |
| `Mailer` | SES SMTP | Mailpit SMTP | Same SMTP client path |
| `Edge` | CloudFront behaviours | nginx locations | Same path contract, tested by the same HTTP suite |
| `Database` | RDS PostgreSQL 16 | `postgres:16` | Same migrations; same RLS; same extension set |

**What differs, and why behaviour is unchanged.**

- RDS sets up backups, a parameter group and a managed endpoint; local Postgres does not. Behaviour is unchanged because the schema, roles and grants are created by the same migration.
- Cognito's hosted login is replaced in the demo by pre-cached tokens. Token issuance is not in the core path; verification is.
- MinIO's retention is the same S3 API. The rehearsal asserts that a `DeleteObjectVersion` against a locked version fails in both environments with the same error class.
- CloudFront caching is disabled for `/api/*` and `/ws` in both environments by path rules, which are the same rules.
- Mailpit does not deliver mail; SES does. The consumer logic and the recorded message are identical.

**Parity test.** The same HTTP and WebSocket suite, the same Playwright rehearsal and the same adapter contract tests run against both environments. The rehearsal records a diff of the response bodies of a fixed script (status codes, error codes and key names; timestamps and IDs normalised). Differences are accepted only if they are in the documented table above.

**One-command operations.** `make up` starts the local stack and waits for readiness (`/healthz` for liveness, `/readyz` for database, queue, anchor store and identity issuer). `make demo-reset` truncates panel tables, reloads the seed, re-anchors the seeded head and returns windows to the seeded state. `make rehearse ENV=aws|local` runs the 300-second script in a headless browser with five contexts.

---

## F. Five strongest technical claims

Each claim has a stated test. The tests are the artifact a reviewer runs, not a description of what would be run.

**Claim 1. No score is recoverable from storage before reveal, including by the database owner.**
*Test.* Seed four known scores with fixed nonces. Seal them through the API. Run `pg_dump --data-only` as the owner role. Assert: (a) no column in any table contains a `smallint` score for these rows; (b) each stored commitment equals the independently recomputed `C(round, proposal, reviewer, score, nonce)` for the correct score and nonce; (c) for each stored commitment and each candidate score 0..10 with any nonce other than the real one, the recomputed digest differs (a 256-bit nonce makes the search space the nonce space). *Observable.* The dump contains 64-hex strings and NULLs only.

**Claim 2. Authorization is enforced by the database, not by the route handlers.**
*Test.* Connect as `sealroom_app`, set `app.actor_id` to (a) an applicant, (b) a reviewer with `coi=true` on the target proposal, (c) a reviewer with `coi=false`, and run the raw SQL that the handlers would run, bypassing the handlers. Assert: applicant `SELECT` on `score_commitments` is denied by absence of privilege; (b) `INSERT` fails with a policy violation; (c) `INSERT` succeeds. Then run the handler test suite with a mutated handler that skips its own check; the `INSERT` for a conflicted reviewer still fails. *Observable.* On stage, the terminal `403 conflict_of_interest` comes from the policy error mapped to HTTP.

**Claim 3. The audit chain is tamper-evident against an owner who recomputes it, because the anchor is outside the owner's reach.**
*Test.* Build a 100-entry chain with the production code. Run three cases: (a) untouched: internal verify passes, anchor verify passes; (b) change one payload byte at seq 40 without recomputing: internal fails at 40; (c) change the payload at seq 40 and recompute all hashes from 40 forward: internal passes, anchor check fails with `anchor_mismatch` at the anchored sequence, and the bucket object for that sequence is unchanged and version-locked. Separately, 200 concurrent seal requests in one round must produce 200 gapless audit entries with no forks (assert `prev_hash` linkage across the sequence). *Observable.* The sequence in the rehearsal, and the red banner in all windows.

**Claim 4. Retries and redelivery produce exactly one effect.**
*Test.* (a) Send 50 concurrent identical `POST /commitments` requests with one `Idempotency-Key`: exactly one `score_commitments` row, one audit event, one outbox row, 50 responses with identical bodies. (b) Same key with a different body: 422 and no new rows. (c) Kill the worker after `ReceiveMessage` and before `DeleteMessage` for a reveal-open message; the redelivered message produces one email in Mailpit/SES sandbox and one `consumed_messages` row. *Observable.* Double-clicking "Seal" on stage shows one commitment.

**Claim 5. Real-time delivery is consistent across API instances and gap-recoverable.**
*Test.* Run two API tasks behind the local ALB equivalent. Open a WebSocket to task A and a second to task B. Commit through task B. Assert the event reaches both sockets with the same `seq`, and the event is delivered to A within the labelled target of 300 ms at the 95th percentile over 500 commits (a measured quantity, reported with the environment). Then drop A's socket mid-stream during a burst of 20 commits, reconnect, and assert that the snapshot plus the replayed events equal the database state (`event_seq` equals `max(seq)` and round content matches). *Observable.* Four windows changing in the same snapshot on stage, and the rehearsal's notification-latency histogram.

**Supporting claim (not counted in the five).** Parity: the same suite passes on both environments, and the image digests in the footer of each window match the manifest.

---

## G. Failure analysis

### G.1 Implementation difficulties

- **Byte-identical hashing across Node and browsers.** Length-prefixed encoding removes separator ambiguity, but the payload text must be produced once and stored verbatim. The browser verifier must read stored text, never re-serialise JSON. The shared test vectors catch drift; without them this is the most likely silent failure.
- **`LISTEN/NOTIFY` and connection poolers.** A transaction-mode pooler (PgBouncer, RDS Proxy in some configurations) breaks `LISTEN`. The listener must use a direct connection. Writes may go through a pool. This is a deployment rule, enforced by a startup check that issues `LISTEN` and a self-`NOTIFY` and fails readiness if the notification does not arrive.
- **RLS with pooled connections.** `set_config(..., true)` is transaction-local; a missed transaction wrapper would leak the previous actor. Every repository function takes the actor as an argument and opens its own transaction; a lint rule forbids queries outside that wrapper.
- **Advisory-lock serialization of the audit chain.** Simple and correct, and the serialization point is a real throughput ceiling (see G.4).
- **Object Lock setup.** The bucket must be created with Object Lock enabled; it cannot be turned on afterwards for an existing bucket without a support process. CDK creates it with the flag; MinIO's init container does the same.
- **Cognito token refresh and clock skew.** Cached tokens are short-lived; the presenter's browsers refresh them in the background. Clock skew between laptop and API is tolerated by a 60-second leeway on `exp` and `nbf`, and is a documented setting.
- **Object Lock versus the demo reset.** Anchors cannot be deleted during retention. `make demo-reset` therefore starts a new anchor series: each reset writes the anchors under a new round UUID and retention period set to the demo's life. Retention is not shortened by reset. This is a real design consequence and is stated in the README.

### G.2 Demo failure modes and mitigations

| Failure | Effect on stage | Mitigation |
|---|---|---|
| Conference Wi-Fi drops | Windows show disconnected state; commits fail | Local Compose on the presenter's laptop is the fallback and is started before the talk; the AWS environment is the headline. The presenter switches the `env` file, and the same windows reconnect. Both are rehearsed. |
| WebSocket dropped mid-demo | One window lags | Gap detection and snapshot resync; the banner says "resyncing" and clears on resync. Rehearsed by forced socket drops. |
| ALB or NAT idle timeout | Silent socket death | 20-second ping; ALB idle timeout 60 seconds; client reconnect with jitter. |
| Worker down | Reveal email not sent | Outbox retains the message; the relay and consumer catch up on restart. The on-stage email is not on the critical path: the state change is visible without it. The rehearsal kills the worker deliberately and asserts the catch-up. |
| Anchor write fails | Verifier shows stale anchor | `anchor_stale` is shown, never `ok`. The attack step only proceeds if the rehearsal's anchor for the seeded head is fresh; otherwise `make demo-reset` runs first. |
| Browser IndexedDB cleared | Reviewer cannot reveal | The nonce is also stored, encrypted with a key derived from the reviewer's passkey-free local secret, in the terminal's `sealroom-reviewer` backup (demo only). Without it, the reviewer cannot reveal: this is the designed behaviour of commit-reveal and is itself the lesson. The demo uses pre-sealed, pre-backed-up identities. |
| Presenter types the wrong command | Visible mistake | Commands are in a snippet pane; no free typing. |
| Two windows show the same user | Confusing state | Each window has a distinct identity and a footer naming the role. Rehearsal asserts the five identities are distinct. |
| Rehearsal step exceeds budget | Demo would stall | Rehearsal fails in CI-equivalent run before the talk, with the step name. |

### G.3 Hidden complexity

- The "same artifact" claim is cheap to state and expensive to keep true. The parity suite is the largest part of the test effort, not the feature code.
- Revealed scores are only shown after `closed`, which means the score view has to be correct across four states and three roles. Most of the RLS logic is there.
- The offline verifier must not make requests. Its CSP forbids connections, and a test asserts that the page makes zero network requests under a `file://` load.
- Anchoring creates a retention liability: every anchored object is permanent until its retention ends. The design chooses short retention for demo series and documents the production choice as a parameter.

### G.4 Features that look impressive but are shallow, stated honestly

- **The "live counts" are shallow.** A counter that updates over a socket is a common pattern; its depth is entirely in C5's correctness under reconnect, which is why the claim tests it.
- **The median is shallow.** It is four integers and a sort. The reveal transaction is the interesting part, not the arithmetic.
- **The audit table UI is shallow.** A table of rows is a table of rows. The depth is in the chain and the anchor; the UI only displays them.
- **Email is shallow.** Mailpit receives a message. Its value is only as evidence that the outbox and consumer work.
- **RBAC is shallow in isolation.** Four roles and a COI flag are simple. The depth is that the rules live in policies and are tested against raw SQL.
- **Anchoring is weaker than it sounds.** The anchor records one head per sequence, written by the worker, not per transaction. An attacker who rewrites history *before* the first anchor of a round is not detected by this scheme. The demo's rounds anchor at seal close and reveal close; the design states the window explicitly and makes the anchor cadence a parameter.
- **The system does not defend against a reviewer who discloses their own nonce.** Commit-reveal is a binding and hiding protocol; it does not stop collusion or verbal disclosure.
- **The system does not defend against a compromised browser.** A malicious script in the reviewer's browser can read the nonce. The threat scope excludes the endpoint.
- **The database owner can still delete the database.** Object Lock protects the anchor, not the rows. The record is only as complete as the anchors cover. The demo says this on stage if asked.
- **Cognito is a managed service; using it is not an achievement.** The part worth scrutiny is that the API never trusts identity claims for authorization.

---

## H. Feasibility

### H.1 Scope by component

| Component | Scope of change | Dependencies inside the proposal |
|---|---|---|
| Schema and migrations | Core tables, `score_view`, roles, RLS policies, advisory-lock audit function, idempotency table, outbox | None. First in order. |
| Commitment and chain library | Encoding, SHA-256 wrappers in Node and browser, shared vectors, verifier logic | Depends on the schema's encoding decisions only. Second. |
| API: panel commands | Round transitions, assignment, seal, reveal, snapshot, idempotency wrapper | Schema, library. |
| API: real-time | `LISTEN` client, WebSocket route, visibility filter, resync endpoint | Schema (`round_events`), API commands for events. |
| Web: panel screens | Officer, reviewer, applicant, auditor views; IndexedDB nonce store; verifier page | API commands and WebSocket contract. |
| Worker: outbox, consumers, sweeper, anchors, integrity check | Relay, mailer and anchor adapters, integrity status, `SKIP LOCKED` sweep | Schema, queue and anchor adapters, audit library. |
| Offline verifier build | Single-file bundle generation from the same verifier code | Browser verifier. |
| Images and manifest | Two Dockerfiles, digest manifest, signing step | Built after the services they package exist. |
| Compose stack | Eight services, init containers, readiness | Images. |
| CDK stacks | Seven stacks (network, data, messaging, identity, anchors, compute, edge) | Parameters from the same env files as Compose. |
| Test suites | Claims 1 to 5, parity suite, Playwright rehearsal with five contexts | Everything above. Last in order. |

Counts for the scope: about 30 SQL objects in the schema and policies, about 25 HTTP routes and 1 WebSocket route, 4 web screens plus the verifier, 3 worker jobs, 6 adapters with contract tests, and 7 CDK stacks.

### H.2 Critical dependencies

- **PostgreSQL features:** RLS with `FORCE`, `LISTEN/NOTIFY`, `SKIP LOCKED`, `security_barrier` views. All are long-standing and available in RDS PostgreSQL 16.
- **Object Lock in compliance mode** on both S3 and MinIO, with the same retention semantics as exercised by the rehearsal.
- **SQS and ElasticMQ** with the same batch and visibility-timeout behaviour, verified by the queue contract test.
- **WebCrypto** in the target browsers (current Chromium, Firefox, Safari). SHA-256 and AES-GCM are required; both are supported.
- **Cognito and Dex** issuing RS256 tokens with the claims the API reads.
- **Pre-cached tokens for demo identities.** This removes login from the stage path and is a dependency on refresh-token lifetime settings.

### H.3 Main risks

1. **Encoding drift** between Node and browser. Mitigated by shared vectors and by reading stored text only.
2. **Notification path under pooling** in a deployment that later adds a pooler. Mitigated by the readiness check and a written rule.
3. **Parity erosion** as either environment changes. Mitigated by digest manifests and the parity suite in the rehearsal.
4. **Attack step fragility.** The rewrite depends on anchor freshness and on the ordering of the audit entries. Mitigated by the anchor-freshness precondition and a rehearsal assertion.
5. **Reveal UX.** Reviewers who lose a device lose their reveal. The demo handles this with pre-backed-up identities, and the product needs an honest recovery story (a sealed backup exported at seal time) before any real use. This is out of demo scope and stated as such.
6. **Scope pressure toward decoration.** The temptation is to add charts and workflow variants. The mandate is one coherent round, and the claims are the scope boundary.

### H.4 Order of work

The order is set by dependency, not by size:

1. Schema, roles, RLS and the audit function, with claim 2's tests against raw SQL, because every other guarantee rests on them.
2. Commitment and chain library with shared vectors, because the browser and API both depend on it.
3. Seal and reveal commands with idempotency and the round transition, with claims 1 and 4(a) tests.
4. Real-time fan-out, with claim 5's tests, because the stage depends on every window updating from the same events.
5. Web panel screens and the nonce store, driven by the API contract.
6. Outbox, queue, worker consumers, sweeper, with claim 4(c).
7. Anchor store, anchor job, integrity check, offline verifier, with claim 3.
8. Images, digest manifest, Compose, CDK stacks, parity suite.
9. Rehearsal script, five-context Playwright run, demo reset.

Each step produces a runnable system: after step 3 the seal and reveal flow works in the API alone; after step 5 it works in the browser on Compose; after step 7 the attack is demonstrable; after step 8 the same system runs on AWS. The five-minute script is assembled last, from steps already tested, so its failures point at a single layer.
