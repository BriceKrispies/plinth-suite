# Selection rationale

**Winner: Quayside — a berth-plan control room for a container terminal** (competitor 04,
Emergent Composition mandate). Revised proposal: `revised/04-emergent-composition.md`.
The definitive specification is in `spec/`, and it supersedes the proposal wherever they differ.
The amendments are listed below under "What the specification changes".

## The field

| # | Concept | Domain | Final mean (round 2) | Fate |
|---|---|---|---:|---|
| 04 | Quayside | Shared berth plan: planners, harbourmaster, carrier agent, auditor | 7.23 | **Selected** |
| 05 | Culvert | Water-utility work orders with offline field devices and fault injection | 7.09 | Runner-up; ideas grafted |
| 02 | Tideline Live | Live auction, visual-first | 7.08 | Rejected; tamper idea grafted |
| 01 | Tallyhouse | Live auction, systems-first | 6.97 | Rejected; canary idea grafted |
| 03 | Ledgerwell | Multi-tenant spend control | 6.88 | Rejected |
| 06 | Sealroom | Sealed-commitment grant panel | 6.60 | Rejected (one disqualification) |

Full scores: `evaluation-matrix.md`. Reviews: `reviews/round1/`, `reviews/round2/`.

## Why Quayside won

**1. Every beat comes from a mechanism, and one gesture touches most of the mechanisms.** The
mission asks for operations that each demonstrate several capabilities at once. In Quayside one
"Accept" takes a Cedar decision, a version check under a single commit lock, a multi-berth
transaction guarded by a deferrable exclusion constraint, synchronous projections, a transactional
`NOTIFY` to other replicas, a resumable cursor push to three role-scoped sessions, an outbox row and a
hash-chained event. Reviewer B scored its cohesion 9 and called it "the strongest composition in the
set". Reviewer C called its cohesion claim "delivered".

**2. The ordering protocol is the most precise in the field, and it is what makes the live claims
true.** In the field, three proposals delivered ordered real-time updates with a watermark or an
overlap window. Quayside allocates positions only under one plan-commit lock, so a visible position
implies every lower position is decided. Reviewers A, B and C each checked this independently and
each accepted it in round 2 ("I checked this and it holds", A). Resume after a disconnect, gap-free
filtered streams with placeholders, and replay equal to projection all follow from that one rule.
None of them needs a separate argument.

**3. The domain is legible in one sentence and visually native.** Ships, berths, tides and a
timeline make a Gantt, ghost overlays, a refusal that names a tide window, and three windows that
change in the same frame. That is real visual material, not a dashboard. Four of the six proposals
converged on the same skeleton: auction or ledger, plus hash-chained audit, plus tamper finale. In
that field Quayside is the only one whose core interaction (a contested, constraint-checked,
multi-party plan) gives an expert audience something they have not seen at every conference.

**4. Its defects are specification defects, not design defects.** The round-2 findings against
Quayside are an RDS privilege mis-statement, the choice of token type, the anchor key scheme, the
fact that carrier isolation rests on a session setting, figures labelled as fixtures that cannot be
fixtures, and demo-only routing. Each one is fixed below without restructuring anything. Compare the
runners-up, whose defects sit inside their climaxes: Ledgerwell's tamper drill does not work in
PostgreSQL as written, Sealroom's detection reads rows the operator can delete, and Tallyhouse's
proxy secrecy is defeated by two functions that take a principal argument.

**5. Highest mean in both rounds, and the most consistent ranking.** Quayside was first by mean in
round 1 (7.30) and round 2 (7.23). It placed 3rd, 1st and 2nd across the three reviewers in round 2.
No other proposal placed in the top two for two reviewers. The margin is small, and point 4 matters
more than the margin.

## Why the alternatives were rejected

**05 Culvert (runner-up).** It has the best replay design: an xid-ordered watermark with an oracle
that tells transaction-start order from commit order. It also has the best fencing (lease epochs on
the database clock) and the most honest fault story. Reviewer A ranked it first. It lost on the
stage. Reviewer B found the script crowded: offline phone replay, two process kills and a tamper,
all inside 300 s. Its live run was local only. Its fault hooks were compiled into demo images, so the
artifact on stage was not the release artifact, which breaks the "same images" requirement in spirit.
Its domain (work orders) is the least visual in the field. Its strongest idea, a real process kill
followed by a cursor resume, fits Quayside directly, and it is grafted in below. It is used with an
external signal and no in-image hooks.

**02 Tideline Live.** It had the strongest visuals and the cleanest two-step tamper argument: the
internal check passes, then the external anchor fails. But its flagship finale existed only on AWS,
and it was disqualified in round 1 for exactly that. The pseudonym anonymity claim was false, and the
hash was computed over `jsonb`. It is also an auction, the most crowded concept in the field. Its
two-step tamper is grafted in as Quayside's finale.

**01 Tallyhouse.** It had the deepest concurrency and saga content and the most candid failure
analysis. Its central secrecy claim (hidden proxy maxima) is defeated by functions that accept a
principal argument. Its engine-role design cannot be built as described. Its kill-and-restart beat
contains an unbounded wait. Its maxima-canary testing pattern is grafted in.

**03 Ledgerwell.** It had the best single-commit composition and the best budget arithmetic. The
climax drill relies on owner rights that it does not establish on RDS, and it was staging-only. Its
isolation scene does not exercise RLS. Its screens are the least visual. Its server-computed
`permitted_actions` pattern is already present in Quayside as `/api/me/capabilities`.

**06 Sealroom.** It was the most original concept and had the best narrative: sealed SHA-256
commitments revealed in the browser. Reviewer B disqualified it in round 2 because its score view and
operator role need `BYPASSRLS`, which an RDS master user cannot grant. Reviewer A found that its
climax detection reads anchor rows the adversary can delete. Its practice of starting a new anchor
series for each reset is grafted in.

## What Quayside demonstrates that the others do not

- A **constraint-checked multi-party plan**. A refusal names the rule, the value and the tide window.
  A solver proposal is reproducible from its stored input hash, seed and version. A conflicting
  concurrent edit produces a 409, and a rebase re-solves only the affected subset and reports each
  dropped move with its reason.
- **One total order that the audience can see working**: in three windows updating in the same
  frame, in a replica killed mid-demo with the client resuming from its cursor on another replica,
  and in a filtered stream whose withheld positions arrive as placeholders.
- **The same authorization rule in the UI, the API, the event stream and the database**, tested as a
  matrix.
- A **work item produced outside the request path**. A forecast file goes through the outbox, the
  queue and the worker, comes back as a proposal from a named system principal, and is accepted
  through the same command path.
- A **two-step tamper**. A naive edit is caught at the exact stream and sequence. A careful rewrite
  that recomputes the whole chain passes every internal check and is then caught by an anchor in
  S3 Object Lock. The anchor was written from values captured at commit time.

## What the specification changes (binding amendments)

These amendments resolve the round-2 findings against Quayside and import ideas from the other
proposals where they strengthen it without adding a new subsystem. Every spec document follows them.
Where the revised proposal disagrees, the amendment wins.

| # | Amendment | Resolves / source |
|---|---|---|
| M1 | **Tamper actor is the table owner role `quayside_owner`**, the role migrations run as and the owner of every table. It is an ordinary role that exists on RDS, and the RDS master user creates it. No step requires `SUPERUSER` or `BYPASSRLS`. The `events` table has no row-level security for the owner (no `FORCE ROW LEVEL SECURITY`). The stage credential for the tamper is the owner's, run from `demo/tamper/*.sql` through one CLI command. | A-R2 w3, B-R2 w1, C-R2 w1 |
| M2 | **Two-step tamper finale.** Step 1: the owner edits `payload` and `canonical` of the target event without fixing hashes, and the verifier reports a hash mismatch at `berth:B5` seq N. Step 2: the owner runs the "cover tracks" script, which recomputes `hash` for that event and every later event in the stream and updates `streams.head_hash`. It uses PostgreSQL's built-in `sha256()`, so the script is pure SQL. The internal chain check passes. The anchor comparison fails and names the anchor object key, its version ID and its retain-until date. This is the final 30 seconds. | B-R2 w2; idea from 02 and 06 |
| M3 | **Anchors attest heads captured at commit.** The commit transaction writes a `checkpoint` outbox message whose body contains the new `(stream_id, seq, head_hash)` values taken from that transaction's own writes. Heads are never re-read later from the table. The worker writes `anchors/<run_id>/<global_pos 20-digit zero-padded>.json` to the Object Lock bucket in compliance mode. `run_id` is a fresh UUID generated by each reset, so keys never collide across resets. The verifier finds anchors by **listing the bucket prefix** with a read-only S3 credential, never through a database index. It reports anchor lag (latest committed position minus latest anchored position) and treats events after the latest anchor as *unanchored*, not verified. | A-R2 w4, w5; C-R2 w2; idea from 06 |
| M4 | **Carrier isolation is honest defence in depth.** Membership (user → role, carrier) lives in a `memberships` table. Tokens carry identity only, never role or carrier. Carrier and auditor reads run under dedicated database roles `quayside_carrier_reader` and `quayside_auditor_reader`, taken with `SET LOCAL ROLE` inside the request transaction. These roles hold `SELECT` only on the security-barrier views, never on base tables. The view keys on `current_setting('quayside.username')` joined to `memberships`. The spec states the boundary exactly: RLS protects against a handler that forgets to filter. It does not protect against a compromised API process, because that process can set the setting. A leak canary (M9) tests the omission case. | A-R2 w1, C-R2 w7; idea from 05 |
| M5 | **Access tokens, not ID tokens.** The browser uses Authorization Code + PKCE. The API accepts access tokens only. It validates signature (JWKS), `iss`, `exp`, `token_use = "access"` (Cognito) or the configured audience (local issuer), and the client binding (`client_id` for Cognito). The username claim name is configuration (`username` on Cognito, `preferred_username` locally). No Lambda trigger is needed, because roles come from `memberships`. Local issuer: **Keycloak** with a pinned realm import, which provides real passwords and real OIDC. AWS: Cognito managed login. The difference is documented in the parity table. | A-R2 w2, C-R2 w3, w4 |
| M6 | **Real replica kill replaces the "simulate network loss" button.** The demo runs three API replicas: `api-a`, `api-b`, `api-c`. The Harbourmaster window is pinned to a, the Carrier window to b, the Planner window to c, and the Auditor uses the shared group. At the resilience beat the presenter runs `quayside demo kill api-b`. Locally this is `docker kill --signal SIGKILL` on the container. On AWS it is the ECS `StopTask` API on task b with `stopTimeout = 2`, so SIGTERM then SIGKILL; both behaviours are stated. Priya's client fails over to the shared group after two failed reconnects and resumes from its cursor on a surviving replica. Tomas's edits during the gap commit on replica c. No fault hook exists in any image. | B-R2 skepticism of buttons; idea from 05 |
| M7 | **Replica pinning is configuration, not an environment branch.** The client always copies a `replica` query parameter onto API and WebSocket URLs when it is present. It contains no `if demo` logic. The ALB rules and nginx `map` that honour it come from the infrastructure parameter `pinnedReplicas`, which is on in demo and off in production. With it off, the parameter is ignored and requests go to the shared group. A conformance row records this. | B-R2 w5, C-R2 w8 |
| M8 | **No numbers presented as fixtures unless reset produces them.** Reset prints `run_id`, head position, state hash and anchor position. Resume counts (K positions, V visible) are computed live by the client and shown as measured. The rehearsal asserts the *relations*: V equals the number of Northwind-touching edits made during the gap, and K − V are placeholders carrying no content. The tamper target is not a hard-coded sequence number. The tamper script selects it with a query: the `MoveApplied` event for the visit of MV Corwen on stream `berth:B5` produced by the rebase acceptance. The berth B5 seed fixture is published. | C-R2 w5, w6 |
| M9 | **Leak canary.** The seed gives another carrier's vessel a unique canary name (`CANARY-7f3a`). The rehearsal and F3 record every HTTP response body and every WebSocket frame delivered to the carrier session and assert that the canary never appears, including in replay, resume, notifications and the capabilities response. | Idea from 01 |
| M10 | **Decisions are evidence.** Each event's canonical bytes include `decision_sha256`, the hash of the canonical decision row that authorized it. Decisions that produce no plan event (409s, denials) are appended as `DecisionRecorded` events to the stream `audit:decisions` under the same commit lock. The verifier therefore covers refusals. | A-R2 w7 |
| M11 | **Timestamps.** `occurred_at` is UTC with microsecond precision, formatted RFC 3339 with exactly six fractional digits inside the canonical bytes. The verifier checks that the column equals the canonical value. | C-R2 w9 |
| M12 | **Stage language is exact.** "The system has just reasoned about the weather" is removed. The forecast line is: "a file landed in object storage; a worker in another process found two visits that now break a wind limit and proposed the fix, under its own identity." Throughput and latency appear on stage only as values measured on that run. | B-R2 w3, w4 |
| M13 | **Placeholder cost and side channel stated.** Replay and resume are paged: 500 positions per page, with a session scan limit per request. The spec states that placeholders reveal the count and timing of other activity, and nothing else. | A-R2 w6, B-R2 w7 |
| M14 | **Single-lock cost is measured, not asserted.** The plan-commit lock's hold time is emitted as a histogram metric. The rehearsal records its p50 and p99 for the demo run, and the spec states a target (p99 under 20 ms at demo command rates, local stack), labelled as a target until measured. | B-R2 w6 |
| M15 | **Script re-cut** so that the trace comes before the replay and tamper beats and the tamper becomes the climax. The beat order is in `spec/20-presentation-script.md` and in `presentation-script.md`. | Mission: strongest moment last |

## Ideas from losing proposals deliberately *not* imported

- Culvert's offline-phone queue and precondition replay. It is a strong idea, but it is a second
  synchronization model next to the cursor protocol, so it would dilute the single-order story.
- Tallyhouse's settlement saga. It would add a payments subsystem that the berth domain does not need.
- Ledgerwell's multi-tenancy. Quayside is one terminal with carrier scopes, and it says so. Adding
  tenants would add an axis that the five minutes cannot show.
- Sealroom's in-browser commitments. They are elegant but unrelated to the berth plan.
- Tideline's settlement email. It is a live third-party dependency that the mission forbids.
