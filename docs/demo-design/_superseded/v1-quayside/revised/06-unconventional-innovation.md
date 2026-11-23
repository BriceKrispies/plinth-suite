# Sealroom: blind panel review with a record that cannot be quietly rewritten

Competitor 06, mandate: Unconventional Innovation. Revision 1, self-contained.

## Revision log

Each finding from the three reviews is listed with its response. "Fixed" names the section where the change now lives. "Rebutted" gives the technical reason the finding does not hold as stated. "Accepted" means the limitation remains and is stated in G.4.

| # | Reviewer and finding | Response | Where |
|---|---|---|---|
| A1 | Headline says nobody can read a score before every reviewer reveals; revealed scores were readable by the officer through the score view and by the owner through RLS bypass. | Fixed. The headline now names the exact guarantee. Application roles, including the officer, cannot read a revealed score before its proposal closes. The database operator, who is the adversary this design assumes, can read rows and write them; the demo says so. | Summary, A, D.5, F Claim 1 and 2 |
| A2 | Audit payloads and round events carried scores before close; reveal events were public with values. | Fixed. Before close no event, audit payload or round event contains a score. Reveal events carry the commitment and a verified flag. Rejected reveals log no score. Claim 2 now reads `audit_events` and `round_events` as the application role and asserts no score value. | D.2, D.3 (payload table), D.4, F Claim 2 |
| A3 | `rounds.state` is round-wide with one committing-to-revealing transition, but the script moves P-3 to revealing at four of four while five proposals have no commitments. | Fixed. State is per (round, proposal). The round is open until every proposal is closed. All six proposal states are seeded and shown on the officer board. | A, C, D.2, D.6 |
| A4 | "No window updates before the others" (190 to 215 s) is false, because reveals arrive one at a time. | Fixed. The claim is restated: each reveal appears as its own event; the close is one commit observed at the same event sequence in every window. | C 190 to 215 s |
| A5 | Officer transitions have no sealed-count guard, which can silently exclude reviewers; reveals are allowed in `committing` when a deadline is set. | Fixed. The officer can move a proposal to revealing only when sealed equals expected, or after the commit deadline with missing reviewers written into the audit event. Reveals are allowed only in `revealing`. | D.5, D.6 |
| A6 | No rule for a reviewer who never reveals at the reveal deadline. | Fixed. Unrevealed commitments are recorded in the close payload as `unrevealed`, are excluded from the median, and the proposal closes. Zero valid reveals yields `no_result`. | D.3, D.6 |
| A7 | Anchor integrity check runs "on its next run" with no stated interval, so the climax depends on a schedule the script does not control. | Fixed. Anchors are written at every milestone (seal complete, each reveal, close) and the integrity sweep runs every 30 seconds. `sealroom-admin integrity-check --now` is a visible terminal step in the attack beat. The attack beat is gated on a visible anchor, not on a timer. | D.3, C 255 to 300 s, F Claim 3 |
| A8 | Gap detection runs only on a later frame, so a lost final frame stalls a client silently; no replay endpoint. | Fixed. Replay endpoint `GET /api/rounds/:id/events?after=` is added. Heartbeat every 5 seconds carries `latest_seq`, so a lost final frame is detected within one heartbeat. | D.4, F Claim 5 |
| A9 | Email consumer records `consumed_messages` and sends with no stated order; "one email" needs provider idempotency that SES and Mailpit lack. | Fixed. Consumer order is stated (claim row, send, mark sent). Guarantee is at-least-once, with the duplicate window named. "One email" is removed. | D.4, F Claim 4 |
| A10 | Which transaction claims an idempotency key first for concurrent writes is unstated. | Fixed. The idempotency row is the first statement in every mutating transaction, inserted with `ON CONFLICT DO NOTHING`, and the lock order is fixed. | D.6 |
| A11 | Seed commitments derive from nonces stored in the repository, so demo scores are recomputable by anyone with repository access. | Fixed. Nonces and scores for seeded proposals are generated at reset outside the repository and written only to local runtime storage. The repository holds no score material. | A, E |
| A12 | `round_roles` is referenced by policies but absent from the schema. | Fixed. Table added with role check and primary key. | D.2 |
| B1 | Revealed scores and commitments sit outside the anchored chain, so an owner who edits a revealed score and commitment and leaves the audit payload alone is detected by nothing. | Fixed. Each commitment appears in the chained seal and reveal events. Each stored revealed row must recompute to the chained commitment, which the verifier checks at every run. Changing a score therefore requires rewriting chained events, and those are anchored. The close payload restates all tuples. | D.2, D.3, F Claim 3 |
| B2 | Round state machine undefined per proposal or per round. | Fixed. Same as A3. | A, D.2, D.6 |
| B3 | Claim 1(c) is a tautology from SHA-256 collision resistance. | Fixed. Claim 1(c) now tests the commitment encoding against harness-held inputs (a conformance test). Hiding is stated as an assumption that the test does not establish. | F Claim 1 |
| B4 | Reviewer recovery backup holds nonces under a key of unstated location. | Fixed by removal. There is no nonce backup in any form. Losing the browser store loses the reveal, and that is stated as the designed behaviour and as a product limitation. | D.1, G.2, H.3 |
| B5 | Anchor cadence not stated, so the audience cannot tell whether the anchor covering sequence N predates the edit. | Fixed. Cadence is stated and the Auditor view shows each anchor's sequence, time and object version. | D.3, C 215 to 240 s |
| B6 | Offline bundle checks a segment against its own embedded head; a server that rewrote history could produce a consistent bundle. | Fixed in part. The bundle embeds each anchor object with its S3 version ID, and the terminal fetches the same locked object by version ID during the attack. Offline, the bundle proves consistency with the embedded anchor records; it does not prove those records came from the bucket. That limit is stated. | D.3, C 240 to 300 s, G.4 |
| B7 | The stage is mostly counters and hex strings, which a non-expert may find thin. | Accepted with mitigation. The officer board shows six proposals and their states, and the Auditor view shows a table-against-chain panel with counts. The visual argument remains text-heavy; that is stated. | C, G.4 |
| C1 | Round-state machine does not fit a six-proposal round. | Fixed. Same as A3. | A, C, D.2, D.6 |
| C2 | Owner visibility is stated both ways: FORCE RLS applies to the owner and the owner bypasses RLS. | Fixed. The adversary is a named operator role with BYPASSRLS and write grants. Local: `postgres`. RDS: the master user if the rehearsal verifies it has BYPASSRLS, otherwise a migration-created operator role with the same grants. The view owner is a separate role with BYPASSRLS. The stage claim and Claim 1 use this role. | D.5, C 115 to 140 s, F Claim 1 |
| C3 | Claim 1(c) holds for any hash and does not test hiding. | Fixed. Same as B3. | F Claim 1 |
| C4 | Terminal nonce backup makes reviewer nonces reachable from the demo's terminal. | Fixed by removal. Same as B4. | D.1, G.2 |
| C5 | Attack precondition undefined: no demo anchor cadence or anchored sequence stated. | Fixed. Cadence stated, precondition is a visible gate in the Auditor view, and the attack rewrites from a sequence anchored before the rewrite. | C 255 to 275 s, D.3, H.3 |
| C6 | Claim 4(c) says exactly one email; a kill between send and commit yields a duplicate. | Fixed. Restated as at-least-once with the window named. | D.4, F Claim 4 |
| C7 | MinIO parity for `DeleteObjectVersion` is unverified given the root-bypass caveat. | Accepted as untested. Marked untested in E and H.2. The rehearsal decides it. | E, H.2 |
| C8 | Terminal and file steps span four surfaces and carry less visual weight. | Fixed in part. Reveals and the tamper request are browser-only. Terminal steps are reduced to three pre-pasted commands. The attack is terminal by nature and remains so. | C, G.4 |
| C9 | WebCrypto in `file://` and the Downloads step are not verified per browser. | Accepted as untested. The verifier refuses with a stated message if `crypto.subtle` is missing, and per-browser checks are rehearsal gates. | D.1, E, H.2 |
| C10 | Anchor keys change per reset, so on-screen hash literals are not fixed. | Accepted. Hashes are read back from the screen in the rehearsal; the script never relies on a fixed literal. | C, F |

---

## Summary

Sealroom is a panel-review system for a research foundation. Each reviewer seals a score as a SHA-256 commitment in their browser before any reveal. Until a proposal closes, no application role can read a revealed score, and the stored record holds only commitments and, after reveal, values that the commitments already bind. The database operator, the adversary this design assumes, can read and write every row. Every decision is written to a hash-chained audit log, whose head is anchored to an S3 Object Lock bucket at each milestone. An operator who rewrites the database, recomputing every hash and every commitment, is detected by the anchor, and the record can be checked offline.

The mandate asks for something unconventional. Commit-reveal is known to engineers from sealed-bid auctions and voting research, but almost nothing ships it as a product for ordinary reviewers. Putting it in a grant panel, and making its guarantees visible on stage, is the surprise. The technical content is deliberately conventional where it can be: Postgres, Fastify, React, SQS, ECS, RDS, CloudFront, Cognito. The unusual parts are where the guarantees are enforced and the way the demo makes the audience watch them being enforced, including against the operator.

---

## A. Product concept

**Application.** Sealroom runs one panel round for a fictional foundation, the "Northfield Climate Adaptation Fund". A round has six proposals (P-1 to P-6), four reviewers, one programme officer and one auditor. Applicants see the state of their own proposal. Identities and proposal IDs are fixed. Scores and nonces for the seeded proposals are generated at reset, outside the repository, so the repository contains no score material and each reset is a new round with new commitments.

**Seeded state at the start of the five-minute script.**

| Proposal | State | Sealed / expected | Notes |
|---|---|---|---|
| P-1 | closed | 4 / 4 revealed | Result public from an earlier reset run |
| P-2 | closed | 3 / 3 revealed | Result public |
| P-3 | committing | 1 / 4 | Cora has sealed. This is the live proposal. |
| P-4 | committing | 0 / 3 | Not yet touched |
| P-5 | committing | 2 / 3 | Ben has a declared conflict and is not counted in expected |
| P-6 | committing | 0 / 4 | Not yet touched |

The round is `open`. It is not closed during the demo, because P-4 to P-6 remain open. The officer board shows all six states, so the audience sees that a round completes proposal by proposal.

**Users and roles.**

| Role | Who | What they can do |
|---|---|---|
| Officer | Programme officer (Nadia Solberg) | Opens the round, assigns reviewers and conflicts, forces a proposal from committing to revealing only under the guard in D.5, sees sealed and revealed counts for all proposals. Sees a revealed score only after that proposal closes. Cannot score. |
| Reviewer | Ada Vance, Ben Okoro, Cora Lindqvist, Dev Marr | Seals and reveals on assigned proposals with no declared conflict. Sees own sealed and revealed values at all times. Sees other reviewers' scores only after the proposal closes. |
| Applicant | Northfield Reed Collective | Sees the state of their proposal and public round counts. Never sees scores or reviewer identities. |
| Auditor | Independent audit contact (Tomas Ferreira) | Reads the audit log, the integrity status and the anchors. Sees counts of checks, not stored score values, until a proposal closes. Cannot change anything. |
| Operator (adversary) | Database operator, held by the platform team | Has BYPASSRLS and write grants on every table. This is the role the demo rewrites from. It is not a product role. |

**Problems solved.**

1. Reviewers anchor on each other. Sealed scores remove the ability to adjust to the room.
2. Reveal must be verifiable. Nobody can change a score after seeing others, and the outcome is shown the same way to everyone.
3. Conflicts of interest must be enforced by the system. A reviewer with a declared conflict cannot seal on that proposal through any route, including a direct API call.
4. The record of who decided what must survive the people who operate the system. Funders and auditors need to show that a decision was not edited after the fact, including by the operator.

**Why it suits this demo.**

- The domain is legible without explanation. "Nobody sees the scores until everybody has sealed" needs one sentence.
- Every claim has a visible surface. A sealed score is a 64-character hex string. A conflict is a refused request. A rewrite is a failed anchor in four windows.
- The four browser windows are four identities, so real-time multi-session behaviour is the normal use of the product.
- The strongest moment is an attack that passes the internal check and fails the external one, performed by the operator against the operator's own database.

---

## B. Capability inventory

Capabilities marked **demonstrated** appear in the script and are observable by the audience. **Supporting** capabilities make the demonstrated ones work.

| # | Capability | Kind | Technical significance | Interactions |
|---|---|---|---|---|
| C1 | Commit-reveal blind scoring | demonstrated | Scores exist before reveal only as SHA-256 commitments over a length-prefixed encoding with a 256-bit nonce. The nonce lives in the reviewer's browser store, encrypted with a non-extractable key. | Commitment is written into the chained seal event. Reveal is checked by the browser and by the server, and chained as a reveal event. Feeds C3 and C7. |
| C2 | Database-enforced authorization | demonstrated | `FORCE ROW LEVEL SECURITY` on every panel table. The API sets the actor per transaction. Application roles have no direct read on score storage; reads go through `score_view`. | Policies read `assignments` (COI), `proposal_states` and `round_roles`. Denials are written to C7. |
| C3 | Per-proposal state machine with transactional side effects | demonstrated | Each (round, proposal) moves `committing -> revealing -> closed`. Transitions are guarded and row-locked, and each writes audit, outbox and notify in the same transaction. | Completing a sealed set moves that proposal to revealing automatically. Triggers C4 and C5. |
| C4 | Transactional outbox with at-least-once async consumers | demonstrated | Effects that leave the database (email, anchor jobs) are published from an `outbox` table in the same transaction as the state change. A relay moves rows to SQS. Consumers record send state and tolerate redelivery. | Carries reveal-open emails and anchor jobs for C8. |
| C5 | Real-time fan-out with replay | demonstrated | `LISTEN/NOTIFY` on a non-pooled connection per API task. Notify payloads carry round, sequence and visibility class, never score values. Heartbeats carry the latest sequence. Clients replay missing events. | Notifications are sent at commit. Visibility filtering is per subscriber. |
| C6 | Idempotent writes | demonstrated | `Idempotency-Key` on every mutating call, stored with the response in the effect's transaction. Replay returns the stored response; reuse with a different body returns 422. | Used by C1 and C3. The first-writer rule is in D.6. |
| C7 | Hash-chained audit log with browser verification | demonstrated | Seals, reveals, transitions, denials and closes write chained rows. `hash = SHA-256(prev_hash || payload_bytes || L(action) || L(subject))`. Payloads are stored as the exact hashed text. Payloads hold no scores before close. | Read and verified in the browser by C10. Head anchored by C8. |
| C8 | External anchoring with integrity sweep | demonstrated | At each milestone, and every 30 seconds, the worker writes the chain head at a sequence to S3 Object Lock (compliance). It recomputes the chain, checks every anchor, checks each stored reveal against its chained commitment, and sets `integrity_status`. | Depends on C4 (job) and C7. Result shown in the Auditor view and pushed to all windows through C5. |
| C9 | OIDC identity with signature verification | supporting | RS256 verification against JWKS, with `iss`, `aud`, `exp`, `nbf`. Identity comes from the token. Roles come from per-round tables in the database. | Cognito in AWS, Dex locally. |
| C10 | Offline verifier bundle | demonstrated | A single HTML file with the chain segment, the embedded anchor records with their S3 version IDs, and the verifier code. Its CSP forbids connections. Runs from `file://` with no network. | Shares encoding and test vectors with the API. |
| C11 | Immutable, digest-pinned, signed images | supporting | One set of OCI images (`sealroom-web`, `sealroom-api`, which doubles as worker by command override), referenced by digest. | Digest shown in every window's footer. |
| C12 | Deadline sweeper with `SKIP LOCKED` | supporting | Closes proposals in revealing past the reveal deadline, recording unrevealed reviewers. Several workers coordinate by row lock. | Exercised in the rehearsal's deadline variant only. |

**Interaction summary.** The core loop is C1 and C6 (seal) -> C2 (visibility) -> C3 (state change in one transaction) -> C5 (windows update) -> C4 (email) -> C7 (record) -> C8 (anchor) -> C10 (verify). Each capability either feeds another or is the surface on which another's guarantee becomes visible.

---

## C. Five-minute live script

**Setup.** The seeded round is in the state of section A. Five browser windows are tiled in a 3x2 grid: Officer, Ada, Ben, Applicant, Auditor, and a terminal. Each window runs in its own Chromium profile directory with a cached token, so no login appears on stage. Every window's footer shows the image digest and the current event sequence. The terminal shows a snippet pane with the three pre-pasted commands used in the script. The environment is AWS; local Compose is the fallback.

| Time (s) | Presenter action | Expected behaviour | Visible result | Capabilities | Transition |
|---|---|---|---|---|---|
| 0 to 30 | Says one sentence: four reviewers, six proposals, nobody sees a score until every reviewer has sealed. Points at the officer board. | Officer and Applicant load the same round snapshot. Counts are public; values are not. | Officer board: six rows with states. P-3 "committing 1 of 4". Applicant: "Under review". Footers show the same event sequence. | C2, C5, C11 | Clicks Ada's window. |
| 30 to 60 | Ada selects 8 on P-3 and presses Seal. | Browser draws a 256-bit nonce, computes the commitment, stores `(score, nonce)` encrypted in IndexedDB, and POSTs the commitment with an `Idempotency-Key`. One transaction writes the row, the audit event, the outbox row and the notify. | Ada: "Sealed. Commitment 3f9c...d21." Officer and Applicant show P-3 at 2 of 4 without refresh. | C1, C3, C6, C7 | Presenter switches to Applicant. |
| 60 to 90 | In the Applicant window, clicks "Scores" (rendered deliberately). | API returns 403 `not_authorized`. Denial is audited with actor, route and proposal. | Applicant sees a refusal. Auditor feed: "denied · applicant · scores P-3". | C2, C7 | Presenter moves to Ben. |
| 90 to 115 | Ben selects P-5 (declared conflict) and presses Seal, which is disabled with reason "Conflict declared". Then in the terminal, the pre-pasted request with Ben's token. | Browser disables the control. The raw request is refused by the INSERT policy. | Browser: disabled control. Terminal: `403 conflict_of_interest`. Auditor feed: "denied · reviewer Ben · seal P-5 · conflict". | C2, C7, C9 | Presenter moves to terminal. |
| 115 to 140 | Terminal, as the operator: `SELECT proposal_id, reviewer_id, commitment, revealed_score FROM score_commitments WHERE proposal_id = 'P-3';` | Two rows, both with 32-byte commitments shown as 64 hex characters. `revealed_score` is NULL in both. | "This is the operator's view. There is no score to read." | C1 (storage), C2 (operator bypasses RLS and sees only what is stored) | Presenter returns to Ben. |
| 140 to 170 | Ben seals P-3 (3 of 4). Dev seals P-3 (4 of 4). | At 4 of 4, one transaction marks P-3 `revealing`, writes the audit, outbox and notify rows, and enqueues a milestone anchor. The officer board changes state; no one presses anything. | All four windows show P-3 "Reveal open · 0 of 4 revealed". Mailpit (split pane) shows reveal-open messages to the four reviewers. | C3, C4, C5, C7, C8 | Presenter takes Ben's window. |
| 170 to 190 | In Ben's window, selects 9 and presses Reveal. | Browser decrypts its nonce, recomputes the commitment for 9, finds a mismatch, and refuses: "Does not match what you sealed. Nothing was sent." Then the presenter presses "Send anyway", a control that exists only when the demo configuration sets `SEALROOM_DEMO_TAMPER_CONTROL`. It sends the pair. The server recomputes, mismatches, rejects. | Browser: refusal. Then Ben's window shows "409 commitment_mismatch. Round unchanged." Auditor feed: "reveal_rejected · reviewer Ben · P-3". The rejected event has no score. | C1 (binding at client and server), C7 | Presenter reveals the correct value. |
| 190 to 215 | Ben reveals 7; Ada reveals 8; Cora reveals 6; Dev reveals 7. Each in turn. | Each reveal checks against its commitment and writes a reveal event with the commitment and `verified: true`, but no score. Each reveal appears as "revealed · verified" with no value. The last reveal closes P-3 in one transaction: values stored, proposal `closed`, close payload with tuples, median 7 and unrevealed list empty, outbox and anchor milestone. | Windows show four "verified" marks appearing one at a time. At close, all windows show P-3 closed with 8, 7, 6, 7 and median 7 at the same event sequence. | C1, C3, C5, C7 | Presenter opens the Auditor window. |
| 215 to 240 | In the Auditor window, opens the verifier. | Verifier fetches the chain and recomputes every hash in WebCrypto. It checks each anchor against the recomputed head at its sequence, and checks each revealed row against its chained commitment. Auditor sees counts and the anchor list. | "Chain intact · N entries · table matches chain (4 of 4) · anchors: 6 of 6 match · latest anchor seq S at HH:MM:SS, object version V." | C7, C8, C10 | Presenter says one line about anchors and downloads the bundle. |
| 240 to 255 | Downloads the offline bundle. Opens `sealroom-verify.html` from Downloads in a new window with networking disabled. | Page loads from `file://`, verifies the embedded segment and anchor records, and shows the same head. | Same result, offline, with "anchor object versions embedded". Presenter: "Anyone with the file can check this. No login, no server." | C10 | Presenter moves to terminal. |
| 255 to 275 | Pre-pasted: `sealroom-admin rewrite --proposal P-3 --set Ada=4 --set Dev=5 --rechain`. The operator uses the stored nonces to recompute the two commitments, rewrites the two seal rows, the two reveal rows, the close payload and the two score rows, and recomputes every hash from the first P-3 seal forward. | Output: "changed 7 rows (2 seal, 2 reveal, 1 close, 2 score); median now 5; rechained 13 entries from seq F." The rewrite refuses to run if the operator flag `--force-no-anchor` is not set and the latest anchor does not cover the chain, so the attack only runs against an anchored chain. | Terminal output as described. | C7 (what the operator can do), C8 (precondition) | Presenter refreshes the Auditor window. |
| 275 to 300 | Pre-pasted: `sealroom-admin integrity-check --now`, then `aws s3api get-object --bucket ... --key anchors/<round>/<S>.json --version-id V` to show the locked object. | Internal chain check passes and the table matches the chain, as the rewrite made both consistent. The anchor check recomputes the head at each anchored sequence and finds the one at seq S (or an earlier one) mismatched. `integrity_status = anchor_mismatch` is pushed to all windows. The locked object still reads head 7a1e...c03. | Auditor: "Internal chain: intact. Table matches chain. Anchor: MISMATCH at seq S. Anchored head 7a1e...c03; current 0c9b...4e1." Every other window: red banner "Integrity: tampering detected at seq S." | C7, C8, C5, C10 | End. The operator's last line: "The operator could rewrite history. The operator could not rewrite the bucket." |

**Timing and fallback.** Each network-bound step has a rehearsal budget expressed as a measured target, not a promise. Commit-to-window delivery is recorded as a histogram in the rehearsal. If a step exceeds its budget, the rehearsal fails, not the stage. Scores are chosen with buttons. Terminal commands are pasted from the snippet pane. The terminal is used for three commands: the owner-view query, the rewrite and the integrity check with the object fetch.

**Why the last 30 seconds is the strongest moment.** The audience has just seen a verifier pass, and the operator's rewrite is internally consistent, including the table and the commitments. What fails is a fact stored outside the operator's reach, and the failure appears in four windows at once. The claim, "the record cannot be quietly rewritten", is shown to hold against the adversary who controls the database.

---

## D. Technical architecture

### D.1 Components

| Component | Implementation | Why |
|---|---|---|
| `sealroom-web` | React 19, TypeScript, Vite, TanStack Query, WebCrypto (SHA-256, AES-GCM with a non-extractable key), IndexedDB | WebCrypto is the only hash implementation the browser needs. No crypto library is shipped to the client. |
| `sealroom-api` | Node.js 22 LTS, TypeScript, Fastify 5, `@fastify/websocket`, `pg` with hand-written SQL, `zod`, `jose` | Hand-written SQL keeps RLS, advisory locks, `FOR UPDATE` and `LISTEN` visible to the reader. |
| `sealroom-worker` | Same image as the API, command `node dist/worker.js` | One artifact, two roles. Least privilege comes from IAM and database roles. |
| Database | PostgreSQL 16. RDS in AWS; `postgres:16` locally. Numbered SQL migrations run by the same runner in both environments. | RLS, `LISTEN/NOTIFY`, advisory locks and `SKIP LOCKED` are native. |
| Queue | SQS standard queue with DLQ. ElasticMQ locally. | Outbox needs a durable queue. |
| Anchor store | S3 bucket with Object Lock compliance mode and versioning. MinIO with Object Lock locally. | Compliance retention prevents deletion by any principal until retention ends. Local behaviour is untested until the rehearsal (see E). |
| Identity | Cognito (AWS); Dex with static users (local). | Same OIDC discovery and JWKS path. |
| Email | SES SMTP (AWS); Mailpit (local). | Same SMTP client path. No provider-side idempotency is assumed. |
| Edge | CloudFront with two behaviours; nginx with the same two location rules locally. | Path contract is identical. |
| Observability | OpenTelemetry traces; CloudWatch logs; JSON logs locally with Jaeger. | Used to explain failures, not to demonstrate them. |

The browser store for nonces is the only place a nonce exists outside the operator-invisible server path. There is no nonce escrow, backup or recovery path in the product or in the demo. A reviewer who loses the browser store loses the reveal. That is the designed behaviour of commit-reveal and is stated as a product limitation (H.3).

### D.2 Persistence schema

All objects are in schema `sealroom`.

```
rounds(id uuid pk, name text, state text check (state in ('draft','open','closed')),
  commit_deadline timestamptz, reveal_deadline timestamptz, version int)

people(id uuid pk, subject text unique, display_name text)     -- subject = OIDC sub

round_roles(round_id uuid, person_id uuid,
  role text check (role in ('officer','reviewer','applicant','auditor')),
  primary key (round_id, person_id, role))

proposals(round_id uuid, id text, applicant_id uuid, title text,
  primary key (round_id, id))

assignments(round_id, proposal_id, reviewer_id, coi boolean not null default false,
  primary key (round_id, proposal_id, reviewer_id))

proposal_states(round_id, proposal_id,
  state text check (state in ('committing','revealing','closed')),
  expected_count int not null, sealed_count int not null default 0,
  revealed_count int not null default 0, closed_at timestamptz null,
  primary key (round_id, proposal_id))

score_commitments(round_id, proposal_id, reviewer_id,
  commitment bytea check (octet_length(commitment) = 32),
  sealed_at timestamptz, idem_key text,
  revealed_score smallint null check (revealed_score between 0 and 10),
  revealed_nonce bytea null, revealed_at timestamptz null,
  primary key (round_id, proposal_id, reviewer_id),
  check ((revealed_score is null) = (revealed_nonce is null)
     and (revealed_nonce is null) = (revealed_at is null)))

round_events(round_id uuid, seq bigint,
  kind text, visibility text check (visibility in
    ('public_counts','public_state','reveal_status','public_result','officer_only')),
  payload_canonical text, created_at timestamptz,
  primary key (round_id, seq))

audit_events(seq bigint generated always as identity pk, occurred_at timestamptz,
  actor_id uuid null, action text, subject text, payload_canonical text,
  prev_hash bytea, hash bytea)

anchors(id bigserial pk, round_id uuid, audit_seq bigint, head_hash bytea,
  s3_key text, s3_version_id text, anchored_at timestamptz,
  unique (round_id, audit_seq, s3_version_id))

integrity_status(id smallint pk check (id = 1), checked_at timestamptz,
  state text check (state in ('ok','anchor_mismatch','anchor_stale','unknown')),
  detail jsonb)                                                  -- counts and sequences only

outbox(id bigserial pk, topic text, payload_canonical text,
  created_at timestamptz, relayed_at timestamptz null)

consumed_messages(consumer text, message_key text, state text
  check (state in ('pending','sent')), updated_at timestamptz,
  primary key (consumer, message_key))

idempotency_keys(actor_id uuid, key text, route text, request_hash bytea,
  response_status int, response_body text, created_at timestamptz,
  primary key (actor_id, key))
```

**Score view.** `sealroom.score_view` is a `security_barrier` view owned by `sealroom_views`, a non-login role with BYPASSRLS and SELECT on the base table only. Under `FORCE RLS` the view owner would otherwise be filtered by the same policies it is meant to implement, so the view owner is a separate role. The view returns `revealed_score` and `revealed_nonce` only when `proposal_states.state = 'closed'`, or when the actor is the sealing reviewer and the row has been revealed. Commitments are returned to the officer, the sealing reviewer and the applicant of the proposal. `sealroom_app` has no SELECT on the base table.

**Design notes an implementer must respect.**

- **No score exists before reveal.** `revealed_score`, `revealed_nonce` and `revealed_at` are NULL until the reveal transaction, enforced by the check constraint.
- **Commitments are public by design.** They appear in the chained seal and reveal events, and in the `score_view` for the parties above. Their hiding comes from the nonce, not from access control.
- **Scores appear in chained data only at close.** The close payload is the first place a score value enters the chain. Reveal payloads carry the commitment and a flag.
- **Payloads are text, not `jsonb`.** `payload_canonical` is the exact byte sequence the server hashed.
- **Round events and integrity detail carry no score values before close** (D.3, D.4).

### D.3 Cryptographic definitions and event payloads

- **Commitment.** `C = SHA-256("sealroom/commit/v1" || L(round) || L(proposal) || L(reviewer) || L(score_be1) || nonce)`, where `L(x)` is a 2-byte big-endian length prefix, `score_be1` is the score as one byte, and `nonce` is 32 random bytes. The domain tag separates this use from every other hash in the system.
- **Chain.** `H_n = SHA-256(H_{n-1} || payload_canonical_bytes_n || L(action) || L(subject))`, `H_0` = 32 zero bytes. Payload text is UTF-8, produced once by the server and stored verbatim.
- **Median.** Sort the valid revealed scores ascending. With an odd count, take the middle value. With an even count, take the floor of the mean of the two middle values. With zero valid scores, the result is `no_result`.

Chained event payloads and what each contains. No payload before close contains a score value.

| Action | Payload fields | Score value present? |
|---|---|---|
| `seal` | round, proposal, reviewer, commitment | No |
| `denied` | actor, route, action, proposal, reason | No |
| `reveal` | round, proposal, reviewer, commitment, verified = true | No |
| `reveal_rejected` | round, proposal, reviewer, reason = `commitment_mismatch` | No. The submitted value is not logged. |
| `proposal_revealing` | proposal, sealed, expected, missing (from `force` only) | No |
| `proposal_closed` | proposal, tuples (reviewer, score, nonce, commitment) sorted by reviewer, median, unrevealed list | Yes. Closed proposals are public. |

**Anchor.** A JSON object `{"v":1,"round":"<uuid>","seq":N,"head":"<hex>"}` is written to `anchors/<round>/<N>.json` with compliance retention. The head is the chain hash at sequence N. An anchor is written at each milestone (`seal` completing a proposal's set, each `reveal`, and `proposal_closed`), and by the integrity sweep whenever the chain has grown since the last anchor, at least every 30 seconds.

**Integrity check.** One integrity run, executed by the worker every 30 seconds or on demand with `sealroom-admin integrity-check --now`:

1. Recompute every chained hash from the first entry. Report the first broken sequence.
2. For every anchor row, read the recorded object version from S3 and compare its head with the recomputed head at that sequence.
3. For every revealed row, recompute the commitment from the stored score and nonce and compare it with the commitment in the chained `reveal` event for that reviewer. Report counts only, for example "4 of 4".
4. Write `integrity_status` with counts and sequences, and push the change through C5.

**Stale anchor.** If the latest successful anchor is older than two sweep intervals while the chain has grown, the state is `anchor_stale`, which is never shown as `ok`.

**Test vectors.** A shared file of fixed inputs and digests is consumed by the Node test suite and by the browser verifier's test page.

### D.4 Communication

- **Commands.** REST over HTTPS/JSON. Mutating calls require `Idempotency-Key`.
- **Snapshot.** `GET /api/rounds/:id/snapshot` returns proposal states, counts, public results and `event_seq`. Score values appear only for closed proposals and for the caller's own revealed rows.
- **Replay.** `GET /api/rounds/:id/events?after=<seq>&limit=500` returns visibility-filtered events in sequence order.
- **Real-time.** WebSocket at `/ws`. The first message carries the token, not the URL. The server pushes `{seq, kind, visibility, payload}`. Every 5 seconds the server sends a heartbeat with `latest_seq` for each subscribed round. A client whose last `seq` is below `latest_seq` after a heartbeat, or that sees a seq gap, calls replay. Heartbeats also keep the ALB idle timeout (60 seconds) from closing the socket.
- **Cross-instance.** Each API task holds one long-lived `pg` connection, not from a pool, running `LISTEN sealroom_events`. Notifications are emitted with `pg_notify` inside the transaction that wrote the event, so a notification exists only if its transaction committed. Payloads carry identifiers only, under the 8000-byte limit.
- **Asynchronous.** Outbox rows are relayed to SQS in batches of ten and marked `relayed_at` after `SendMessageBatch` succeeds. Consumers process a message in this order:
  1. Insert `consumed_messages` with `state = 'pending'` if absent. If the row is already `sent`, acknowledge and stop.
  2. Send the email over SMTP.
  3. Update the row to `sent`, then delete the SQS message.

  The guarantee is **at-least-once**. A crash between step 2 and step 3 causes a redelivery that sends the email again. The duplicate window is the interval between the SMTP acceptance and the state update, which is named and tested (F Claim 4). SES and Mailpit provide no idempotency key, so the design does not claim one message per reviewer.

### D.5 Security boundaries and authorization rules

Boundaries, from outside in:

1. **Edge.** TLS terminates at CloudFront and the ALB. Locally, TLS is out of scope and documented as such.
2. **API.** Verifies signatures, issuer, audience and expiry. Maps `sub` to `people.id`. Sets the actor with `set_config('app.actor_id', ..., true)` at the start of every transaction.
3. **Database roles.**
   - `sealroom_owner`: owns the schema, non-login, not a superuser, subject to FORCE RLS. Used by migrations only.
   - `sealroom_views`: non-login, BYPASSRLS, owns `score_view` and nothing else.
   - `sealroom_app`: the API. No ownership, no SELECT on base tables holding scores, INSERT and UPDATE only as the policies allow.
   - `sealroom_worker`: outbox, consumed messages, integrity status, anchors. No delete on audit.
   - `sealroom_operator`: the adversary. BYPASSRLS and write grants on every table. On local Postgres this is the `postgres` superuser. On RDS it is the master user if the rehearsal confirms BYPASSRLS through `pg_roles.rolbypassrls`; otherwise the migration creates `sealroom_operator` with the same grants and the operator beat uses it. The role is used only in the terminal beat and in the rehearsal's attack test.
4. **Worker.** IAM limited to `sqs:ReceiveMessage` and `sqs:DeleteMessage` on its queue; `s3:PutObject` and `s3:GetObject` on `anchors/*`; no `DeleteObject`.
5. **Anchor bucket.** Object Lock compliance, versioning, and a bucket policy that denies `s3:DeleteObjectVersion` to all principals.

**Authorization rules, in the database.**

- **Officer.** Reads `proposal_states`, counts, commitments and `round_events`. Score values only where `proposal_states.state = 'closed'`. Transitions a proposal from `committing` to `revealing` only if `sealed_count = expected_count`, or if `now() > commit_deadline` and the transition writes the missing reviewers into the `proposal_revealing` payload with `force` set. Cannot insert commitments.
- **Reviewer.** Inserts a commitment only where `assignments.coi = false`, the proposal is `committing`, and `reviewer_id` equals the actor. Updates only its own row, and only where the proposal is `revealing` and the row is unrevealed. Reveals are never accepted in `committing`.
- **Applicant.** Reads its own proposal's state and public counts.
- **Auditor.** Reads `audit_events`, `anchors`, `integrity_status` and `round_events` with `public_*` classes. Cannot read score storage before close. No write policy.

Route handlers perform the same checks to return the right error code, but a handler bug cannot grant access the policy would deny. The rule is tested with the handler bypassed (F Claim 2).

### D.6 Consistency requirements per operation

**Lock order.** Every mutating transaction takes locks in this order, which is the rule that prevents deadlock: (1) idempotency key, (2) round row `FOR UPDATE`, (3) proposal state row `FOR UPDATE`, (4) audit advisory lock, (5) outbox and notify.

| Operation | Consistency requirement | Mechanism |
|---|---|---|
| Idempotency claim | Exactly one transaction runs the effect for a (actor, key). | First statement of every mutating transaction: `INSERT INTO idempotency_keys ... ON CONFLICT DO NOTHING`. The transaction whose insert succeeds owns the key and runs the effect. Concurrent transactions block on the unique index until the owner commits or rolls back. If the owner commits, the others get zero rows and read the stored response. If the owner rolls back, the next waiter inserts and runs the effect. |
| Seal | One commitment per (round, proposal, reviewer). The completion transition happens exactly once, atomically with the insert. | After the idempotency claim: lock round, lock proposal state, guarded insert, `sealed_count` increment, conditional transition to `revealing` when `sealed_count = expected_count`, `event_seq` increment, audit append, outbox insert, notify. |
| Reveal | The revealed score matches the sealed commitment. The proposal closes exactly once when the last expected reveal lands or the deadline passes. | Same lock order. The server recomputes C from (round, proposal, reviewer, score, nonce) and compares in constant time. The reveal row is updated and `revealed_count` increments. Closing is a conditional update: `WHERE state = 'revealing' AND NOT EXISTS (sealed rows with revealed_at IS NULL)`, or `now() > reveal_deadline`. |
| Unrevealed at deadline | Rule is fixed in advance. | At `reveal_deadline`, the sweeper (C12) closes the proposal. Each sealed, unrevealed reviewer is written into the `unrevealed` list of `proposal_closed`. Their commitments are not counted. Median is over the valid reveals. Zero valid reveals is `no_result`. |
| Audit append | No forks, no gaps. | `pg_advisory_xact_lock(hashtext('sealroom-audit'))` for the writing transaction, which serialises the head read and the insert. |
| Event fan-out | Subscribers never see uncommitted state. Gaps are detectable and recoverable. | Notify at commit. Per-round `event_seq` assigned under the round row lock. Heartbeat carries `latest_seq`. Replay fills gaps. |
| Outbox relay | No row lost. Duplicates absorbed by consumers. | `relayed_at` set only after SQS success. Consumers follow D.4. |
| Deadline sweep | A proposal transitions at most once per deadline. | `SELECT ... FOR UPDATE SKIP LOCKED` on due proposals, then the guarded update. |
| Anchor | At most one recorded anchor per (round, audit_seq) is used by the check. | The anchor job first checks `anchors` for (round, seq). If absent, it writes the object and inserts the row with the returned version ID. If a write succeeds and the insert fails, a second object version may exist; the check reads the version recorded in `anchors` and reports any other version as an unrecorded object. |

**Deliberately not linearizable.** The anchor write and the database commit are not one atomic operation. The anchor lags the database by one job. Until the anchor for a milestone exists, the Auditor view shows the last anchored sequence and the current sequence, and `integrity_status` shows `anchor_stale` if the lag exceeds two sweep intervals. A rewrite before the first anchor of a round is not detected (G.4).

### D.7 Deployment topology

**AWS.** One VPC across two availability zones. Public subnets hold the ALB and NAT. Private subnets hold ECS Fargate services `api` (two tasks) and `worker` (one task), and RDS PostgreSQL. CloudFront fronts an S3 bucket for the web bundle and the ALB for `/api/*` and `/ws`. SQS with DLQ, Cognito, SES identity, Secrets Manager, ECR with immutable tags and scan-on-push, CloudWatch log groups. AWS CDK in TypeScript, one stack per concern.

**Local.** A Compose project with `web` (nginx), `api`, `worker`, `postgres`, `elasticmq`, `minio` with a one-shot init container that creates the Object Lock bucket, `dex`, `mailpit`, and `jaeger`. Every service uses the same image digests as AWS.

---

## E. AWS and local deployment

**Build once.** CI builds `sealroom-web` and `sealroom-api` from digest-pinned base images (`node:22-bookworm-slim`, `nginx:1.27-alpine`) with a frozen lockfile. Each image is pushed to ECR, scanned, signed over its digest, and recorded in a manifest. The local stack loads the same archives with `docker load` and runs them by digest. `make up` refuses to start if a running digest differs from the manifest.

**Reproducible configuration.** All configuration is environment variables validated at startup with `zod`. One file per environment (`env/aws.env`, `env/local.env`) holds issuer, JWKS URL, SQS URL, S3 endpoint, SMTP host and database URL. The demo configuration sets `SEALROOM_DEMO_TAMPER_CONTROL=1`, which enables the labelled "Send anyway" control in the browser. The flag defaults to off. No code branches on environment name; the flag is configuration that the build reads, and it is present in the same image in both environments.

**Demo reset and seed.** `make demo-reset` does the following:

1. Stops the demo windows and deletes their Chromium profile directories, which removes the stored nonces of the previous round.
2. Generates new scores and nonces for the seeded proposals from the operating system CSPRNG. It writes them to `%LOCALAPPDATA%\sealroom\demo\seed.json`, outside the repository, and the file is never committed.
3. Truncates panel tables and creates a new round with a new UUID. Anchor objects from the previous round remain locked under their retention and are not reused.
4. Runs the rehearsal driver in headless profiles of the four reviewer and applicant identities to seal and reveal P-1 and P-2, and to seal Cora's P-3 commitment, through the same web client. The nonces therefore land in the stage profiles, not in the terminal.
5. Reopens the five windows from the snapshot and asserts the seeded states of section A.

The reset writes the anchor for the seeded head. The reset is not on the stage path.

**Adapter interfaces.**

| Interface | AWS adapter | Local adapter | What must be identical |
|---|---|---|---|
| `IdentityVerifier` | Cognito JWKS | Dex JWKS | Verification code and claim checks |
| `Queue` | SQS batch send, receive, delete | ElasticMQ, same SDK, endpoint override | At-least-once semantics; DLQ redrive |
| `AnchorStore` | S3 `PutObject` with compliance retention; `GetObject` by version ID | MinIO with Object Lock bucket | Version ID returned; version reads return the locked content |
| `Mailer` | SES SMTP | Mailpit SMTP | Same SMTP client path |
| `Edge` | CloudFront behaviours | nginx locations | Same path contract |
| `Database` | RDS PostgreSQL 16 | `postgres:16` | Same migrations, RLS, extensions and roles |

**What differs, and what is untested.**

- RDS adds backups, parameter groups and a managed endpoint. Schema, roles and grants come from the same migration.
- Cognito's hosted login is replaced by pre-cached tokens in the demo. Verification is the same code.
- Object Lock refusal on delete is the same S3 API in both. **Untested:** whether MinIO returns the same error class for `DeleteObjectVersion` against a locked version, and whether it refuses retention shortening. The rehearsal asserts both and this claim stays untested until it passes in both environments.
- **Untested:** whether the RDS master user has BYPASSRLS. The rehearsal checks `rolbypassrls` and selects the operator role accordingly (D.5).
- Mailpit does not deliver mail; SES does. The consumer logic and the recorded state are identical.

**Parity test.** The same HTTP and WebSocket suite, the same browser rehearsal and the same adapter contract tests run in both environments. The rehearsal records a diff of response bodies for a fixed script (status codes, error codes, key names; timestamps and IDs normalised). Differences must be in the table above.

**One-command operations.** `make up` starts the local stack and waits for readiness (`/healthz` for liveness, `/readyz` for database, queue, anchor store and identity issuer). `make demo-reset` is described above. `make rehearse ENV=aws|local` runs the 300-second script in a headless browser with five contexts and the operator beat through the same terminal snippets.

---

## F. Five strongest technical claims

Each claim has a stated test that is an artifact a reviewer can run.

**Claim 1. The stored record contains no score before reveal, and the commitment encoding is the one specified.**

*Test.* The harness generates four scores and nonces, seals them through the API, and dumps the database as the operator with `pg_dump --data-only` before any reveal. Assert:

- (a) For every `score_commitments` row, `revealed_score`, `revealed_nonce` and `revealed_at` are NULL.
- (b) The dump contains no nonce bytes and no score field in any `audit_events` or `round_events` payload. Search for the nonce hex and for the `"score"` key.
- (c) Each stored commitment equals `C(round, proposal, reviewer, score, nonce)` recomputed from the harness's own inputs. This is a conformance test of the encoding, not a test of hiding.

*Stated assumption.* Hiding is not established by this test. It rests on SHA-256 and the 256-bit nonce. Stated as such, the guarantee is: no score is stored before reveal, and the commitment is the only value present.

*Observable.* The dump holds 64-hex strings and NULLs.

**Claim 2. Authorization is enforced by the database for the application role, including its raw SQL.**

*Test.* Connect as `sealroom_app` and set `app.actor_id` to (a) an applicant, (b) a reviewer with `coi = true` on the target proposal, (c) a reviewer with `coi = false`, and (d) a reviewer on a proposal in `revealing`. Run the raw SQL that the handlers would run, bypassing the handlers. Assert:

- (a) An applicant's SELECT on the base table is denied by privilege. SELECT on `score_view` returns no revealed values.
- (b) INSERT fails with a policy violation.
- (c) INSERT succeeds.
- (d) UPDATE of another reviewer's row fails, and a reveal in `committing` fails.
- (e) As `sealroom_app`, read `audit_events` and `round_events` for a proposal before close. Assert no score value appears.

Then run the handler suite with a mutated handler that skips its own COI check. The INSERT for the conflicted reviewer still fails.

*Observable.* On stage, `403 conflict_of_interest` comes from the policy error mapped to HTTP.

**Claim 3. A rewrite by the operator is detected by the external anchor even when the internal chain, the table and the commitments are all made consistent.**

*Test.* Build a chain with the production code, with milestone anchors and the sweep. Run four cases.

- (a) Untouched. Internal verify passes, table matches chain, anchors match.
- (b) One payload byte changed at seq N without recomputation. Internal verify fails at N.
- (c) Full operator rewrite as in the script: change two scores, recompute both commitments with the stored nonces, rewrite the seal rows, reveal rows, close payload and table rows, and recompute every hash from the first affected seal. Internal verify passes. Table-against-chain passes. The anchor check fails at the first anchored sequence at or after the rewrite point. The locked object for that sequence is unchanged when read by version ID.
- (d) The same rewrite performed before any anchor for the round is written. Internal verify and anchor checks pass. The test asserts this outcome, so the limit is recorded as tested behaviour, not hidden.

Separately, 200 concurrent seal requests across 200 test reviewers in one test round produce 200 chained seal entries with no gaps and `prev_hash` linkage intact.

*Observable.* The rehearsal's sequence and the red banner in every window.

**Claim 4. Retries produce one effect; redelivery is at-least-once with a named window.**

*Test.*

- (a) 50 concurrent identical `POST /commitments` requests with one `Idempotency-Key`: exactly one `score_commitments` row, one `seal` audit entry, one outbox row, and 50 identical response bodies. A second test runs the 50 requests against a key whose first transaction is held open by the harness, and asserts that the waiters read the owner's stored response.
- (b) Same key, different body: 422 and no new rows.
- (c) The worker is killed between SMTP acceptance and the `sent` update for a reveal-open message. The test asserts the redelivered message sends again, the `consumed_messages` row ends in `sent`, and the number of sends is 1 or 2. Duplicates appear only in the window named in D.4.

*Observable.* Double-clicking "Seal" shows one commitment.

**Claim 5. Real-time delivery is consistent across API instances, and a lost frame is recovered.**

*Test.* Two API tasks behind the local ALB equivalent. Open one WebSocket to each. Commit through task B. Assert the event reaches both sockets with the same `seq`, and report delivery latency to A as a measured quantity over 500 commits, against a labelled target of 300 ms at the 95th percentile. Then:

- (a) Drop A's socket during a burst of 20 commits, reconnect, and assert replay plus snapshot equals database state.
- (b) Drop the final frame of the proposal close on socket A, leaving the socket open. Assert A's next heartbeat, within 5 seconds, shows `latest_seq` above its last seq, A calls replay, and A's view matches the database.

*Observable.* Windows changing at the same event sequence on stage, and the rehearsal's latency histogram.

**Supporting (not counted in the five).** Parity: the same suite passes on both environments, and footer digests match the manifest. The MinIO error-class and RDS BYPASSRLS checks are gates of this suite, and until they pass the parity claim is marked untested.

---

## G. Failure analysis

### G.1 Implementation difficulties

- **Byte-identical hashing across Node and browsers.** Payload text is produced once and stored verbatim. The browser verifier reads stored text and never re-serialises JSON. Shared test vectors catch drift.
- **Lock order.** The order in D.6 must hold in every transaction. A lint rule rejects queries outside the repository wrapper that owns the order.
- **`LISTEN/NOTIFY` and connection poolers.** A transaction-mode pooler breaks `LISTEN`. The listener uses a direct connection. A startup check issues `LISTEN` and a self-`NOTIFY` and fails readiness if the notification does not arrive.
- **RLS with pooled connections.** `set_config(..., true)` is transaction-local. Every repository function takes the actor and opens its own transaction.
- **Score view ownership.** The view must be owned by the BYPASSRLS role or policies must permit the view owner. The owner is a separate role, and the rehearsal checks that `sealroom_app` cannot read base tables directly.
- **Advisory-lock serialization.** Simple and correct. It is a throughput ceiling by design.
- **Object Lock setup.** The bucket must be created with Object Lock enabled, and cannot be enabled later without a support process. CDK and the MinIO init container both create it with the flag.
- **Cognito token refresh and clock skew.** A 60-second leeway on `exp` and `nbf` is a documented setting.
- **Object Lock versus demo reset.** Anchors cannot be deleted during retention, so each reset creates a new round UUID. Retention is never shortened.
- **WebCrypto in `file://`.** The verifier needs `crypto.subtle`. Whether each target browser provides it under `file://` is untested. If it is missing, the verifier shows "This browser cannot run the check; use the online verifier" and does not show a pass.

### G.2 Demo failure modes and mitigations

| Failure | Effect on stage | Mitigation |
|---|---|---|
| Conference Wi-Fi drops | Windows disconnect; commits fail. | Local Compose on the presenter's laptop is started before the talk. The presenter switches the env file. Both are rehearsed. |
| WebSocket dropped mid-demo | One window lags. | Heartbeat with `latest_seq` and replay. The banner says "resyncing" and clears on resync. Rehearsed by forced drops. |
| Lost final frame | One window shows an old state. | Heartbeat within 5 seconds reveals the gap; replay fills it. Rehearsed (Claim 5b). |
| Worker down | Reveal email not sent. | Outbox retains the message. The state change is visible without the email. The rehearsal kills the worker and asserts catch-up. |
| Anchor write fails or is late | Auditor shows `anchor_stale`. | The attack beat is gated: `sealroom-admin rewrite` refuses to run unless the latest anchor covers the chain. If the gate is not met, the presenter runs `integrity-check --now` and waits for the Auditor view to show the anchor. The rehearsal asserts the gate passes before the talk. |
| Browser IndexedDB cleared during the talk | Reviewer cannot reveal. | Not mitigated by escrow, by design. The reveal is lost, and the demo does not use this path. Rehearsal asserts that each reviewer's reveal works from the stage profile. |
| Presenter types the wrong command | Visible mistake. | Commands come from the snippet pane. |
| Two windows show the same user | Confusing state. | Each window has a distinct identity and a footer naming the role. The rehearsal asserts five distinct identities. |
| Rehearsal step exceeds its target | Demo would stall. | Rehearsal fails with the step name before the talk. |

### G.3 Hidden complexity

- The "same artifact" claim is cheap to state and expensive to keep true. The parity suite is the largest part of the test effort.
- The score view must be right across three proposal states and three roles. The RLS logic is most of the security work.
- The offline verifier must make no requests. Its CSP forbids connections, and a test asserts zero network requests under `file://` where the browser allows the check to run.
- Anchoring creates a retention liability. Anchored objects are permanent until retention ends. The demo uses a short retention parameter; production retention is a documented parameter.
- The operator beat requires the rewrite tool to be correct. Its correctness is tested in Claim 3, because a broken rewrite would make the climax fail for the wrong reason.

### G.4 Features that look impressive but are shallow, and limits, stated honestly

- **Live counts are shallow.** A counter over a socket is common. Its depth is C5's correctness under reconnect, which Claim 5 tests.
- **The median is shallow.** It is a sort of at most ten integers. The depth is the close transaction.
- **The audit table UI is shallow.** It displays rows. The depth is in the chain and the anchors.
- **Email is shallow.** Mailpit receives a message. Its value is as evidence that the outbox and consumer work, and the duplicate window is stated.
- **RBAC is shallow in isolation.** The depth is that the rules live in policies and are tested against raw SQL.
- **The operator can read revealed scores before close.** After a reveal and before a close, a score is stored in plaintext in `score_commitments`, and the operator can read it. The headline says so. What the operator cannot do is change it without changing a chained commitment.
- **Anchoring is weaker than it sounds.** A rewrite before the first anchor of a round is not detected. A deletion after the last anchor is not detected. The design states both windows, and Claim 3(d) tests the first.
- **Offline verification proves consistency, not provenance.** The bundle proves that the chain segment matches the anchor records it embeds, with their version IDs. It does not prove the records came from the bucket. The stage shows the bucket answer by fetching the same object version from a terminal. Offline provenance requires the online step.
- **Collusion and disclosure are out of scope.** Commit-reveal does not stop a reviewer from disclosing a nonce.
- **A compromised browser is out of scope.** A script in a reviewer's browser can read the nonce.
- **The operator can delete rows.** Object Lock protects anchors, not rows. Deletion after the last anchor is undetected.
- **The visual argument is text-heavy.** The stage is counters, a board of six states, and hex strings. This is accepted. The officer board and the table-against-chain count are the only visual additions.
- **Untested claims.** MinIO error-class parity, MinIO retention refusal, RDS BYPASSRLS, WebCrypto under `file://` in each browser, and the Downloads step are marked untested until the rehearsal passes them.

---

## H. Feasibility

### H.1 Scope by component

| Component | Scope of change | Dependencies inside the proposal |
|---|---|---|
| Schema, roles, RLS, score view, audit function, idempotency and outbox tables | Core tables, roles, policies, the `score_view` owner role, advisory-lock append function | None. First in order. |
| Commitment and chain library | Encoding, SHA-256 wrappers in Node and browser, median, shared vectors, verifier logic | Schema encoding decisions. Second. |
| API: panel commands | Seal, reveal, transitions, close, snapshot, replay, idempotency wrapper | Schema, library. |
| API: real-time | `LISTEN` client, WebSocket route, heartbeat with `latest_seq`, visibility filter | Schema (`round_events`), commands. |
| Web: panel screens | Officer board, reviewer, applicant, auditor views; IndexedDB nonce store; verifier page | API commands and WebSocket contract. |
| Worker: outbox, consumers, sweeper, anchors, integrity sweep | Relay, mailer and anchor adapters, consumer state machine, `SKIP LOCKED` sweep | Schema, adapters, audit library. |
| Operator tooling | `sealroom-admin rewrite`, `integrity-check`, `rechain` | Audit library, schema. Used only by the demo and the test suite. |
| Offline verifier build | Single-file bundle with embedded anchors and CSP | Browser verifier. |
| Images, manifest, Compose, CDK stacks | Two Dockerfiles, digest manifest, signing, eight Compose services, seven CDK stacks | Services they package. |
| Reset and seed | Profile reset, seed generation outside the repository, rehearsal-driven seal and reveal | API, web client. |
| Test suites | Claims 1 to 5, parity suite, browser rehearsal with five contexts | Everything above. Last. |

Counts: about 30 SQL objects in schema and policies, about 25 HTTP routes and 1 WebSocket route, four web screens plus the verifier, three worker jobs, six adapters with contract tests, and seven CDK stacks.

### H.2 Critical dependencies

- **PostgreSQL features:** RLS with `FORCE`, BYPASSRLS on the view owner, `LISTEN/NOTIFY`, `SKIP LOCKED`, `security_barrier` views. Available in RDS PostgreSQL 16.
- **Object Lock in compliance mode** on S3. **MinIO parity is untested** (E).
- **SQS and ElasticMQ** batch and visibility-timeout behaviour, verified by the queue contract test.
- **WebCrypto** with SHA-256 and AES-GCM, and non-extractable keys stored in IndexedDB, in current Chromium, Firefox and Safari. **Untested under `file://` per browser.**
- **Cognito and Dex** issuing RS256 tokens with the claims the API reads.
- **Pre-cached tokens and profile directories** for demo identities. This depends on refresh-token lifetime.

### H.3 Main risks

1. **Encoding drift** between Node and browser. Mitigated by shared vectors and reading stored text only.
2. **Lock-order violation** in a later change. Mitigated by the repository wrapper and a lint rule.
3. **Notification path under pooling.** Mitigated by the readiness check and a written rule.
4. **Parity erosion** and untested MinIO and RDS behaviours. Mitigated by digest manifests and the parity suite.
5. **Attack-step fragility.** The rewrite depends on the anchor gate and on the order of entries. Mitigated by the gate and by Claim 3.
6. **Reveal loss by a reviewer.** A reviewer who loses the browser store loses the reveal. There is no escrow. The demo never exercises this path. A real deployment needs an explicit recovery design (for example, a sealed export at seal time) which is out of demo scope and not built here.
7. **Scope pressure toward decoration.** The mandate is one coherent round; the claims are the scope boundary.

### H.4 Order of work

The order is set by dependency.

1. Schema, roles, RLS, score view, audit function and idempotency. Claim 2's raw-SQL tests run here, because every other guarantee rests on them.
2. Commitment and chain library with shared vectors, because browser and API both depend on it.
3. Seal and reveal commands with idempotency, the per-proposal transitions and the median. Claims 1 and 4(a) and (b) run here.
4. Real-time fan-out, heartbeat and replay. Claim 5 runs here, because every window must update from the same events.
5. Web panel screens and the nonce store, driven by the API contract.
6. Outbox, queue, consumers with the state machine in D.4, and the sweeper. Claim 4(c) runs here.
7. Anchor store, milestone anchors, integrity sweep, operator tooling, offline verifier. Claim 3 runs here.
8. Images, digest manifest, Compose, CDK stacks, parity suite, including the untested checks in E.
9. Reset and seed, rehearsal script, five-context browser run, operator beat.

Each step produces a runnable system. After step 3 the seal and reveal flow works in the API alone. After step 5 it works in the browser on Compose. After step 7 the operator's attack is demonstrable. After step 8 the same system runs on AWS. The five-minute script is assembled last, from steps already tested, so its failures point to one layer.
