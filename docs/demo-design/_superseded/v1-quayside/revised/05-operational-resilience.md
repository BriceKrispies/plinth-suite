# Proposal 05 (revised): Live Operational Resilience

Mandate: demonstrate real infrastructure behaviour, observability, concurrent activity, failure handling and recovery, as one coherent application that is shown being broken and repaired in front of the audience.

Product title: **Culvert: live work-order operations for a regional water utility**

Pitch: Culvert is a dispatch and field-work console in which three people act on the same work orders at once while the audience watches the database enforce authorization, a phone queue replay its actions in order, and a worker and an API replica killed mid-operation without a duplicated visible effect, followed by an audit chain that names the exact sequence number a privileged edit changed. The same demo image digests run under Docker Compose on the presenter's laptop and on ECS Fargate with RDS, and the rehearsal script passes on both before the session.

---

## Revision log

Every finding from the three reviews is listed. "Fixed" names the section where the change lives. "Rebutted" gives the technical reason the finding does not apply as written. "Accepted" means the limitation remains and is stated in the document.

### Reviewer A (principal systems engineer)

| # | Finding | Response | Where |
|---|---|---|---|
| A1 | Sam is South-region, yet the North order appears on his board and he reassigns it; the writes match zero rows under the stated policy. | Fixed. Sam is a duty dispatcher with two dispatcher memberships (North and South). Board visibility, close and reassignment are all authorized by rows in the table. | A, D.2, C rows 2, 6, 9 |
| A2 | "Commit-ordered" replay is false; delivery order is `(xid, seq)`, which is transaction-start order among committed transactions. The oracle used the same order and could not detect the difference. | Fixed. The guarantee is renamed to what is delivered: an xid-ordered replay of a finished prefix. The claim 1 oracle reads commit timestamps through `pg_xact_commit_timestamp` and includes a case where delivery order must differ from commit order. | D.4, F claim 1 |
| A3 | An `read.denied` row and a 404 instead of 403 cannot both come from RLS, and "3 of 412 visible" cannot be counted under RLS. | Fixed. A SECURITY DEFINER probe owned by a BYPASSRLS role returns two booleans for one id, and a separate function returns the total count. The handler appends `read.denied` in the same transaction as the probe. The on-screen counts are labelled with which path computed them. | D.2, D.5, C rows 4 to 5 |
| A4 | `memberships` primary key `(user_sub, role, region_id)` cannot hold auditor or operator rows, because `region_id` is null. | Fixed. Surrogate key, a `unique nulls not distinct` constraint over the scope columns, a per-role scope check, and a composite foreign key that ties a technician's crew to the region. | D.2 |
| A5 | `memberships` has no policy. | Fixed. Own-row select policy for the app role; no write policy for it. Writes happen only in migrations and the seed. | D.2 |
| A6 | Conflict response for rows the viewer can no longer see. | Fixed. A `409` with `current: null` and reason `not_visible`, identical to the response for an absent row. Technicians also keep read access to orders they have acted on (`order_participants`), so the common case returns the current state. | D.2, D.6, C row 11 |
| A7 | `app.principal` is a settable GUC; RLS guards against omission, not against code that sets another subject; claim 3 does not test the setter. | Fixed in scope, rebutted in part. Claim 3 is bounded to accidental omission. A static test asserts that the only call site sets the subject from the verified token. Rebuttal: PostgreSQL cannot restrict which role may set a custom GUC, so the document no longer claims the app role cannot set another subject. The threat is stated in D.5, and every write audit row records the principal. | D.5, F claim 3 |
| A8 | Only the `work_orders` policy is written out; events, audit_events, outbox and notifications policies are absent. | Fixed. Every table has a written policy for each role. | D.2 |
| A9 | ECS `StopTask` sends SIGTERM first, so "identical SIGKILL" is false. | Fixed. Both platforms send SIGTERM, then SIGKILL after 2 s if the process is still alive. The worker has no SIGTERM handler; the API closes its streams immediately on SIGTERM. The signal path is in the parity table. | D.7, E |
| A10 | Fence checks the epoch before the send, not during it, so a stalled worker can duplicate; "single effect for the audience" overstates it. | Accepted as a known limitation and reworded. The guarantee is at-least-once delivery with a narrow duplicate window; duplicates carry the same `Message-ID`. | D.6, F claim 5, G.1 |
| A11 | The closing line promises the same verifier result on AWS. | Fixed. The cross-environment claim is now a fixture chain with fixed bytes, whose verifier output is deterministic and is checked in both environments. The live script no longer claims an AWS result. | C row 15, E, F claim 4 |

### Reviewer B (skeptical technical audience member)

| # | Finding | Response | Where |
|---|---|---|---|
| B1 | The RLS scene uses `read.denied` and "3 of 412" that RLS cannot produce. | Fixed as A3. The scene says on screen that the denial check and the total run outside RLS and are audited. | C rows 4 to 5 |
| B2 | SIGKILL through ECS `StopTask` is wrong; the environments differ in signal. | Fixed as A9. | D.7, E, G.3 |
| B3 | The worker kill happens before the SMTP send, so the scene shows lease reclaim and not the duplicate window. | Fixed by stating it. The stage text says the scene shows lease reclaim only. The duplicate window is demonstrated by claim 5's pause-point tests and in the report. Rebuttal: moving the kill after SMTP acceptance would put a second message in the inbox during a 30 second window with no time to explain it, so the script shows the narrower claim and says so. | C row 10, F claim 5 |
| B4 | Claim 1 kills one of two in-process replicas, which does not exercise the process boundary. | Fixed. Replicas are separate OS processes, started by the test harness and by Compose. | F claim 1 |
| B5 | The trace chip is shown but never opened. | Fixed. The presenter opens the trace for the submit on stage, and the waterfall includes the database transaction spans. | C row 3, B row 11 |
| B6 | The final "same result string on AWS" line cannot run in the window and is not shown elsewhere. | Fixed. Removed from the script. The closing line shows the digest from this stack's readiness; the pre-session rehearsal report lists the AWS digest. | C row 15 |
| B7 | The console wrapper that logs owner actions lives in the database the owner edits. | Fixed with a stated limit. Console statements go to a log stream the owner role cannot write, and the apply action is appended to the chain. The console screen states the limit. | D.5, C row 14 |

### Reviewer C (implementation and reliability engineer)

| # | Finding | Response | Where |
|---|---|---|---|
| C1 | Process-kill parity is wrong for ECS; lease beat timing differs between Compose and ECS. | Fixed as A9. Both environments use the same two-phase signal path, and the lease is reclaimed on the same database clock. | D.7, E |
| C2 | SSE reconnect model conflicts with `EventSource`: automatic retry reuses a consumed ticket; "reconnected in 1.8 s" is unsupported. | Fixed. Tickets are removed. Streams use `fetch` with a bearer header and an explicit reconnect loop that sends `Last-Event-ID`. The reconnect time is measured on the client, not asserted. | D.3, G.1, C row 12 |
| C3 | The tamper step does not match the schema: `audit_events` stores canonical bytes with no payload column, and `crew_id` is inside length-prefixed bytes; the identical AWS string is not reproducible. | Fixed. Canonical layout v1 stores `crew_id` as a fixed-width int32 at a computed offset. The tamper procedure decodes the layout, overwrites four bytes, and does not recompute hashes. The cross-environment string claim is replaced as in A11. | D.2, F claim 4, C row 14 |
| C4 | Several on-screen values are fixed observed results (1.8 s, 1,318 events, head hash, lease expiry at +10.0 s). | Fixed. Every on-screen value carries one label: derived (D), measured (M), target (T) or configured (C). Counts, sequence numbers, hashes and outbox keys are run values. | C legend |
| C5 | Claim 5 waits on a 10 s lease over 200 trials, which is serial waiting of 2,000 s from configuration. | Fixed. The lease TTL is a parameter; the test profile sets 1 s. The routine tier runs 20 trials; the stack tier runs 200. | F claim 5, H.2 |
| C6 | A long-running transaction stalls every live stream; no statement timeout or rollback rule is given for the console. | Fixed. Statement timeout 5 s and idle-in-transaction timeout 10 s for the app and console roles; the console is two-step (read-only preview, then apply) and rolls back unless apply completes. The slow writer in claim 1 runs only in the test database. | D.5, D.7, F claim 1 |
| C7 | The offline beat depends on IndexedDB eviction, service worker reload and emulation versus real network; browsers are not named. | Fixed. Browsers are named (Chromium through Playwright at a pinned version in CI; Google Chrome stable at a pinned version on the presenter's machine). The flush order is asserted in each. A `persist()` check is shown on the queue panel, and killed-tab and mid-flush reload tests run in the rehearsal. Eviction under storage pressure is accepted as a limitation. | E, G.1, G.2, H.4 |
| C8 | The delivery-hold hook lives in the production worker binary; its gating is not stated. | Fixed. The hook is compiled only with build tag `faultinject`. Demo and test images carry the tag; the release image is built without it, and CI asserts that its routes are absent. This is a stated deviation from production; the parity claim covers demo digests. | D.1, E |
| C9 | Operator-plane authorisation differs between the socket proxy and tag-scoped `StopTask` and is not in the parity table. | Fixed. Added to the parity table with the allow-list in both environments. | E |
| C10 | Replacement readiness is an unmeasured Fargate start referenced by "tens of seconds". | Fixed. The script's next step does not wait on the replacement; the health strip shows the state; the rehearsal measures the start and reports the figure. No time figure appears in the script. | C rows 12 to 15, E, G.1 |

### Self-review corrections found while revising

| # | Problem found | Correction | Where |
|---|---|---|---|
| S1 | Technicians could not see unassigned orders, so the emergency order would not reach Rafi's phone. | North technicians see unassigned North orders. | D.2 |
| S2 | Reassignment at about 160 s removes Rafi's crew visibility before his queued note replays, so the note would be refused. | Participation keeps read access to orders a principal has acted on. The note is then accepted, and "On site" returns the current state. | D.2, C row 11 |
| S3 | A lease that is not renewed expires while a held worker is still alive, so the kill would be reclaimed before it happened. | Workers renew their lease every 3 s while alive. Reclaim happens 7 to 10 s after the kill, and the panel measures it. | D.6, C row 10 |
| S4 | Browser race requests over HTTP/1.1 are limited to a few sockets per host. | One HTTP/2 connection, and an API pool of 25 connections so the 20 requests reach Postgres together. | C row 6, D.1 |
| S5 | A replay held back by an open transaction produces no notification when that transaction commits. | Each stream also replays on a 250 ms timer. | D.4 |
| S6 | "Hold next delivery on w-1" cannot target the worker that claims next. | The hold is armed on all workers; whichever claims next holds; the kill targets the holder shown on the panel. | C rows 8 to 10 |
| S7 | Outbox keys (1184) and sequence numbers (1209) were fixed in the script. | They are run values, shown as they occur. | C legend |
| S8 | The race assigned Crew 4 or Crew 7 at random, so the later steps depended on the winner. | Every race request assigns Crew 7. | C row 6 |
| S9 | The stale-version assignment by Sam was not needed for any claim. | Removed to keep the window. | C row 6 |

---

## A. Product concept

**Application.** Culvert is the work-order system a regional water utility uses when a main breaks. Dispatchers open emergency and routine work orders, assign crews, watch progress on a live board, and close orders with evidence. Field technicians use a phone-width web app (an installable PWA) to acknowledge, progress and annotate orders, including when mobile signal drops. Auditors read the immutable record and verify it. Operations staff inspect platform health and inject faults.

**Users and roles.**

| Principal | Memberships (rows in `memberships`) | Typical action in the demo |
|---|---|---|
| Maya | dispatcher, North | opens the emergency order, races assignments |
| Sam | dispatcher, North; dispatcher, South (duty dispatcher across both regions) | sees the order on the board, tries to close it, reassigns it while Rafi is offline |
| Rafi | technician, North, Crew 7 | drives the phone-width window, goes offline, replays a queue, handles conflicts |
| Priya | auditor (global) | runs chain verification |
| Ops | operator (platform) | opens the Resilience panel, arms holds, kills tasks, uses the database console |

Roles and scope live in a Postgres table (`memberships`), not in token claims. The identity provider proves only the subject (`sub`). The same authorization facts drive both deployments even though the two identity providers shape their tokens differently (D.5).

Operator memberships carry no business-data access. The operator endpoint that would change memberships at run time is cut: memberships are changed by migrations and by the seed only.

**Problems solved.** Utilities need one authoritative answer to "who is doing what on this main right now", a record that survives disputes, and field work that does not stop when coverage does. The product is built around the problems that make distributed systems hard: concurrent writes to one entity, real-time propagation that must not lose events, background work that must happen once, offline clients that diverge, and audit records that must stay trustworthy when parts of the system fail.

**Why it suits this demo.** Each capability the audience cares about is triggered by an action a non-expert understands: "assign this order", "go offline", "kill that worker". The state, the audit chain and the event stream accumulate across the five minutes. The failures are process signals and network conditions applied to real containers and real tasks, and the recovery runs through the same code paths production uses.

**What the audience should walk away believing.** That the team can say which guarantee holds, where it is enforced (in the database, in the queue protocol, in the client), and show a test that would fail if it stopped holding. The demo also states its limits on screen where a limit applies.

---

## B. Capability inventory

Twelve capabilities are demonstrated live. Four more are supporting: they make the demonstrated ones possible or credible without having a moment of their own.

| # | Capability | Status | Technical significance | Interaction with others |
|---|---|---|---|---|
| 1 | Server-enforced work-order state machine (transition table plus trigger) | demonstrated | Invalid transitions are refused for every writer, including the owner, because the trigger runs in the transaction. The client disables controls from the same table. | Assignment is a guard for 2; queued transitions are re-validated in 8; every change is audited in 7. |
| 2 | Compare-and-set assignment on `version` | demonstrated | Concurrent dispatchers cannot both win; losers receive the winning event. | Race at 100 to 125 s; the winner's event row supplies the conflict text. |
| 3 | Idempotent mutations (`Idempotency-Key`, stored response including `409`) | demonstrated | Retries after lost responses and offline replays return the original result. | Used by 2 (re-sent winner), 8 (queued actions). |
| 4 | Transactional outbox with leased, fenced claims (`FOR UPDATE SKIP LOCKED`, lease epoch, renewal) | demonstrated | State, audit, event and outbox rows commit together. Delivery is at-least-once; duplicates are narrow and carry the same `Message-ID`. | The worker kill at 175 to 190 s reclaims a lease; delivery is observed in 15. |
| 5 | Real-time fan-out through `LISTEN/NOTIFY` with xid-ordered replay of a finished prefix | demonstrated | Each stream replays visible events from its cursor; notifications wake streams and do not carry data. No event below a delivered cursor can commit later. | Transport for every live update; the replica kill at 210 to 230 s exercises the replay path; visibility is 6. |
| 6 | Row-level security driven by a membership table, with participation | demonstrated | Denied rows are invisible, not forbidden. Enforced for every query, including ones the API did not anticipate. | Every read passes through it; the South-region check and psql run in the script. |
| 7 | Hash-chained audit log with live verification and an external anchor | demonstrated | Each row commits to its predecessor; an in-place edit by the owner is detected at the exact sequence number. | Written by 1 to 6, 8 and 9; verified at 230 to 250 s and again after the tamper. |
| 8 | Offline-first PWA with an ordered, precondition-checked replay queue | demonstrated | Actions survive loss of connectivity; each is accepted only if its preconditions still hold; the rest are presented as conflicts. | Uses 3 for idempotency, 1 for transition validity, 6 for visibility, 5 to refresh. |
| 9 | Fault injection through an allow-listed controller (task signal, delivery hold; latency locally only) | demonstrated | The recovery claims are tested with the faults an operator produces, not with simulated errors in code. | Kills a worker holding a lease (4) and a replica serving a stream (5); effects are read back through 4, 5 and 7. |
| 10 | Dependency-aware health and readiness | demonstrated (health strip) | The strip reads readiness probes, heartbeat rows, outbox age and stream counts at each refresh. Nothing is cached. | Heartbeats are written by 4; degraded status appears after 9. |
| 11 | Distributed trace propagation (W3C `traceparent` from browser through API, transaction and worker) | demonstrated (opened on stage for one submit) | The same trace id is stored on the event row and on the outbox row, and the trace reader shows the transaction spans. | Linked to 5 and 4 through stored ids, not through the trace backend alone. |
| 12 | Deterministic seed and reset; Playwright browser rehearsal | supporting | Predictable starting state; the script is an automated test on both deployments. | Drives 1 to 11 with three browser contexts, including offline emulation. |
| 13 | OIDC sign-in (Amazon Cognito; Dex locally) with PKCE and bearer-authenticated streams | supporting | Real identity provider in both environments; only `sub` is trusted. | Feeds 6. |
| 14 | Immutable, signed, digest-pinned demo images built once and promoted unchanged | supporting | The same demo bytes run locally and in AWS. | Makes the parity claim in E checkable. |
| 15 | Email delivery through SMTP (Amazon SES; Mailpit locally) | supporting | Real protocol; the inbox is the visible result of 4. | The only observable endpoint of the worker in the script. |

The interaction graph is the point. Removing one demonstrated capability breaks a visible moment in the script, and each moment exercises at least three others. The order created at 25 s is written by 1, 3 and 7, streamed by 5, filtered by 6 and traced by 11. The offline replay at 160 to 210 s touches 3, 8, 1, 6, 5, 4 and 7.

---

## C. Five-minute live script

**Setup before the audience sits down.** A deterministic reset (capability 12) has run. Three browser windows are signed in: Maya and Sam in two side-by-side desktop windows, Rafi in a phone-width window with DevTools docked, and Priya in a third window. The Ops drawer is open on a separate screen. The board starts in the seeded state: 412 work orders across two regions, Crews 4 and 7 defined, no order assigned in the North region.

**Value labels.** Every value on screen has one of these labels in the table, and the screen shows the label as a short tag next to the value.

- **D**: derived at display time from database or server state.
- **M**: measured by a panel timer or by the rehearsal.
- **T**: a target budget, checked in rehearsal and never asserted on stage.
- **C**: a configured constant.

Run values (sequence numbers, outbox keys, hashes, counts) vary between runs and are not fixed in this script.

**Transition notation.** Each row ends with the action that starts the next row. Times are the window in which the row's actions occur.

| Time (s) | Presenter action | Expected behaviour | Visible result | Capabilities | Transition |
|---|---|---|---|---|---|
| 0–25 | States the purpose in one sentence: a utility's work orders, three people acting on them at once, a deployment that runs the same images on a laptop and in AWS, and a promise to break things live. Points at the health strip. | Board renders from a snapshot; the stream attaches over `fetch`. The strip refreshes every 2 s [C] from readiness probes, heartbeat rows and outbox age. | API 2/2 ready [D]; workers 2/2, last beat under 5 s [D]; database ok [D]; outbox lag 0 ms [D]; three streams open [D]. | 10, 5, 13 | Clicks "New emergency" in Maya's window. |
| 25–55 | Maya enters "Main break, Elm and 4th, 2 blocks dark, priority 1" (North) and submits. | One transaction writes `work_orders`, `audit_events` (through `append_audit`), `events` and `idempotency_keys`. Commit sends `NOTIFY` with the event key `xid:seq`. Each replica wakes its streams, and each stream replays under its own subject. | The order appears on Sam's board (duty dispatcher, both regions) and on Rafi's phone list (unassigned North orders are visible to North technicians). Trace chip `t-7f3a…` on all three windows [D]. Submit-to-appearance p95 target 300 ms [T], measured in rehearsal only. | 1, 3, 5, 6, 7, 11 | "Rafi's phone has it, and so does Sam's board, which covers both regions. Now who is allowed to see what?" Clicks the trace chip. |
| 55–75 | Opens the trace chip for this submit. | The trace panel reads the trace from the backend through one reader interface (Jaeger locally, X-Ray on AWS). Spans export with a 1 s batch delay [C]. The panel also reads the events row to confirm the stored trace id. | Waterfall: browser `POST`, API handler, transaction with children `INSERT work_orders`, `INSERT audit_events`, `INSERT events`, `INSERT idempotency_keys`, `COMMIT`, `pg_notify`. Line: "event row carries this trace id: yes" [D]. | 11, 5, 7 | Closes the panel; opens the request explorer in Rafi's window. |
| 75–90 | Issues `GET /v1/work-orders/{id}` from Rafi's window for a South-region order created by Sam at seed, then lists Rafi's orders. | RLS returns no row. The handler calls `culvert.probe_order`, which returns two booleans and runs outside RLS: found, not visible. In the same transaction it appends `read.denied` for Rafi's subject, then returns `404 not_found` with a request id, identical to the response for a missing id. The list count is N under RLS; M comes from `culvert.total_orders()`, which also runs outside RLS. | `404` with request id. "Visible to you: N of M", with M labelled as counted outside RLS [D]. Audit tail shows `read.denied` for Rafi. Caption on screen: "The denial check runs outside RLS, and every denial is audited." | 6, 7, 13, 11 | "The list, the probe and the audit row are separate code paths. Now the database." |
| 90–100 | Runs `psql` as `culvert_app` with no principal set, then with Rafi's subject set. | No principal: zero rows from `work_orders`, `events` and `audit_events`, and `count(*)` returns 0. Rafi's subject: N rows, the same set as the list. | Two results on screen [D]. | 6 | "The API is not the only enforcement point, and the rule is in the schema." Clicks "Race" in Maya's window. |
| 100–125 | Clicks "Race: 20 assigns to Crew 7" in Maya's window. | The browser writes 20 requests on one HTTP/2 connection in one event-loop turn, each with its own key and `expected_version` 1. The API pool has 25 connections, so the requests reach Postgres together. One request takes the row lock and wins; the rest wait, then fail the compare-and-set. | One `201`, version 2. Nineteen `409 version_conflict` cards, each reading "Assigned to Crew 7 by Maya, 14:02:11.412, v2" [D, from the winning event row]. Arrival spread from the API log [M]. Re-sent winning request with its original key returns the stored response with `Idempotent-Replayed: true`. Audit tail shows one `assignment.changed` row. | 2, 3, 7, 5, 4 | "One winner, nineteen losers, one audit row." Clicks "Close" in Sam's window. |
| 125–145 | Sam, online, tries to close the order while it is `dispatched`. Then taps "En route" on Rafi's phone. | Close was disabled from the transition table served to the client. The forced request returns `422 invalid_transition` naming `en_route` as the only allowed next state. Rafi's transition passes the trigger: technician, crew 7 matches the assignee. | Sam's close disabled, tooltip "allowed next: en_route"; forced attempt shows a red toast with the server's reason. Rafi's phone shows "En route". The board moves the order to the En route lane. | 1, 5, 7 (refused attempt is in the request log, not audited as a change) | Presenter moves to the Ops screen for the next step. |
| 145–160 | On the Ops screen, arms "Hold next delivery, until killed or 120 s". Then sets Rafi's network to Offline in DevTools. | The fault controller calls the internal hold endpoint on both workers, which exist only in `faultinject` builds (D.1). The next claim by either worker acquires the lease and then waits. Lease renewal continues every 3 s [C] while held. | Ops panel: "hold armed: w-1, w-2". Rafi's header: "Offline". | 9, 4 | Taps three actions on Rafi's phone. |
| 160–175 | Rafi taps "Add note: break confirmed, 300 mm main", then "On site", then "Valve isolated". At about 160 s Sam, online, reassigns the order to Crew 4. | Each action is stored in IndexedDB with its key, its precondition and a device-local insertion sequence before the UI updates. Preconditions: note, order not closed and visible; "On site", status `en_route` and crew 7; "Valve isolated", status `on_site` and crew 7. Sam's reassignment is a compare-and-set on version and writes an outbox row, which the armed hold catches. | Rafi's header: "Offline, 3 queued". Sam's board: order in Crew 4. Ops panel: "w-N holds lease for outbox row K (epoch 1, renewals 2)" [D]. Rafi's board: order marked stale. | 8, 3, 2, 5, 4 | Presenter switches to the Ops screen. |
| 175–190 | Kills the task holding the lease, by the panel's kill target. | SIGTERM goes to that task. The worker has no SIGTERM handler, so it exits without releasing the lease. Renewals stop. The lease expires 7 to 10 s after the last renewal [C, M]. The other worker claims the row at epoch 2 and sends once. The send records a `notifications` row under the outbox key. The scheduler restarts the killed task in the background. | Panel: "w-N killed; lease reclaimed by w-M at epoch 2, M s after kill [M]". Mailpit: one message for the outbox key, `Message-ID: <outbox-K@culvert>` [D]. Health strip shows workers 1/2 with the replacement starting [D]. | 4, 9, 15, 10 | "That was lease reclaim. The duplicate window is covered in the tests and the report, not here." Turns Rafi's network online. |
| 190–210 | Rafi's client detects connectivity and flushes its queue one action at a time in insertion order. | Note: `201`, because its precondition holds; Rafi can still see the order as a participant. "On site": `409 precondition_failed` with the current state (status `en_route`, crew 4, version). The queue halts; "Valve isolated" is marked blocked and is not sent. Each refused action is audited as `action.rejected` with its key. | Queue: note with a check mark; "On site" red with its reason; "Valve isolated" grey, "blocked by earlier conflict". Conflicts inbox: two items. Rafi chooses "Hand back to dispatcher"; Sam's board shows a handback flag. | 8, 3, 1, 6, 7, 5 | "Non-conflicting work was accepted, conflicting work was not, and both are in the audit chain." |
| 210–230 | Opens the stream panel, which shows the replica each stream is attached to. Kills the replica serving Sam's stream. | The replica receives SIGTERM and closes its streams at once; the balancer stops routing to it after its health check fails. Sam's client backs off, reopens with `Last-Event-ID` and a fresh access token, and the other replica replays visible events after the cursor under Sam's subject. | Health strip 1/2 with the replacement starting [D]. Panel: "reconnected in M ms [M]; replayed N events after cursor [D]; client duplicates suppressed 0 [M]". Sam's board changes only for events in the gap. | 5, 9, 10 | "Sam's stream lost a replica and received every visible event after its cursor." Opens Priya's window. |
| 230–250 | Priya clicks "Verify chain". | The verifier runs as the auditor principal, reads `audit_events` in sequence order, and for each row recomputes `sha256(prev_hash || canonical)` and compares it with the stored hash and the predecessor. | Chain of L rows [D]; head hash of this run [D]; green strip. Verification time [M]; target under 250 ms [T]. | 7, 6 | "Now the part you are not supposed to be able to do." Opens the database console. |
| 250–268 | Opens the database console as the table owner. Preview shows the target sequence, the field and the old and new values. Confirms apply. | Console statements are written to a log stream outside the database. Preview runs read-only. Apply runs with statement timeout 5 s and rolls back unless it completes. The procedure disables the append-only trigger, overwrites the four bytes of `crew_id` in the canonical bytes of the reassignment row, re-enables the trigger, and does not recompute any hash. The apply is itself appended to the chain. | Console: "seq S, crew_id 4 to 7, canonical bytes changed, stored hash unchanged". The console states the limit: "The owner can alter rows. The chain shows the change, and the anchors and the log stream are outside the owner's write path." | 7, 4, 6 | "Priya verifies again." |
| 268–300 | Priya re-runs "Verify chain". | The verifier recomputes row S from the edited canonical bytes and finds a mismatch. It reports the first broken link. Rows after S are reported unverifiable because their predecessor is broken. The anchor check compares the anchored head at the last anchor before S. | Strip red from S onward. Panel: "chain broken at seq S: stored hash X, recomputed Y; U downstream links unverifiable [D: rows after S]; anchored head at seq A matches [D]". Closing line: "The digest on this stack is the digest the AWS demo stack runs. The rehearsal report, produced before this session, lists both." | 7, 14 | End. Questions. |

**Why the last thirty seconds work.** The audience watches a privileged edit to a record they have just seen created, reassigned and replayed, and then watches the verifier name the exact sequence number that changed and count what it can no longer vouch for. That converts earlier claims into something checkable.

**Where the script depends on background work.** Three steps depend on a background process finishing: the notification send (the Mailpit count is also shown from the `notifications` table), the replacement task (the strip shows partial readiness rather than hiding it, and no step waits for it), and the verifier (its result is computed for each request and never cached across runs). A step that cannot complete in its window is shown as partial with its label; the next step does not depend on it.

---

## D. Technical architecture

### D.1 Components

| Component | Implementation | Why |
|---|---|---|
| Web client | TypeScript, React 18, Vite. TanStack Query for server state. IndexedDB through `idb`. Workbox service worker for the app shell. OpenTelemetry Web SDK for `traceparent`. Event streams use `fetch` with a streaming body and a small SSE parser, not `EventSource`. | `EventSource` cannot send an `Authorization` header and retries with the URL it was given. A `fetch` reader sends the bearer token and `Last-Event-ID`, and it controls reconnection. |
| API | Go 1.22, `net/http` `ServeMux`, `pgx/v5` with `pgxpool` (25 connections), `go-oidc`, OpenTelemetry Go SDK. One binary; subcommands `serve`, `worker`, `migrate`, `seed`, `verify`, `anchor`. | One language and one binary keep the artifact identical between API and worker. `pgx` exposes `LISTEN/NOTIFY` and `SKIP LOCKED` directly. |
| Worker | Same binary, `worker` subcommand. Outbox claimer with lease renewal, SMTP sender (`net/smtp`), heartbeat writer, head-anchor writer. No SIGTERM handler: the default disposition terminates the process. | Background delivery needs no broker: the outbox is in the same database as the state change. |
| Migrator | Same binary, `migrate` subcommand with embedded migration files. Runs to completion before rollout. | Schema changes run once. |
| Fault controller | Go service with four operations: signal a task (SIGTERM; SIGKILL after 2 s if alive), arm and release the delivery hold, set database latency (local only), read task status. Holds no database credentials. | The operator surface is narrow and tested for refusals (G.1). |
| Fault hooks | The hold endpoint and the named pause points used by claim 5 exist only in builds with build tag `faultinject`. | Production code has no hook path (C8, E). |
| Identity | Amazon Cognito user pool (AWS); Dex with static users (local). Authorization code with PKCE. | Real OIDC on both sides. Authorization data is not in the token. |
| Database | PostgreSQL 16. Amazon RDS for PostgreSQL 16 in AWS; `postgres:16` locally. `track_commit_timestamp` on in both (used only by the claim 1 oracle). | Row-level security, advisory locks, `LISTEN/NOTIFY`, `xid8` and triggers are standard in both. |
| Edge | CloudFront and S3 for the bundle; ALB for the API. Traefik locally for both. | Traefik has active health checks, and its behaviour is closer to the ALB than nginx would be. |
| Email | Amazon SES over SMTP (AWS); Mailpit (local). | Same SMTP code path; only host and credentials differ. |
| Telemetry | OpenTelemetry Collector; ADOT sidecar exporting to X-Ray (AWS); Jaeger (local). | The application emits OTLP in both places. |

### D.2 Persistence model

All tables live in schema `culvert`. There are four database roles.

- `culvert_app`: used by the API. Owns nothing, not `BYPASSRLS`.
- `culvert_worker`: used by the worker. Reads and updates only `outbox`, reads `transitions`, and writes `notifications` and `worker_heartbeats`.
- `culvert_owner`: owns the tables. Used by migrations and by the Ops database console. Not used by any running service.
- `culvert_probe`: `NOLOGIN`, `BYPASSRLS`. Owns the three SECURITY DEFINER functions that read across RLS (`probe_order`, `total_orders`, `health_snapshot`), each of which returns only the fields listed below.

Every application table has `FORCE ROW LEVEL SECURITY`. Each table has one permissive policy `owner_all` for `culvert_owner`, so the owner can read and change rows only through its own console and migrations; the trigger in D.2 still applies to it.

```sql
create schema culvert;

create table regions (id text primary key, name text not null);

create table crews (
  id        int primary key,
  region_id text not null references regions(id),
  name      text not null,
  unique (id, region_id)
);

create type membership_role as enum ('dispatcher','technician','auditor','operator');

create table memberships (
  id        bigint generated always as identity primary key,
  user_sub  text not null,
  role      membership_role not null,
  region_id text references regions(id),
  crew_id   int,
  foreign key (crew_id, region_id) references crews (id, region_id),
  check (
       (role = 'dispatcher' and region_id is not null and crew_id is null)
    or (role = 'technician' and region_id is not null and crew_id is not null)
    or (role in ('auditor','operator') and region_id is null and crew_id is null)
  ),
  unique nulls not distinct (user_sub, role, region_id, crew_id)
);

create table work_orders (
  id          uuid primary key,
  region_id   text not null references regions(id),
  status      text not null check (status in
                ('open','dispatched','en_route','on_site','isolated','repaired','closed')),
  priority    smallint not null check (priority between 1 and 4),
  crew_id     int,
  version     bigint not null default 1,
  title       text not null,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  trace_id    text not null,
  foreign key (crew_id, region_id) references crews (id, region_id)
);

create table order_participants (          -- a principal who has acted on an order
  order_id  uuid not null references work_orders(id),
  principal text not null,
  primary key (order_id, principal)
);

create table transitions (
  from_status text not null,
  to_status   text not null,
  min_role    membership_role not null,
  primary key (from_status, to_status)
);

create table events (                       -- the replayable stream
  seq        bigint generated always as identity,
  xid        xid8 not null default pg_current_xact_id(),
  region_id  text not null,
  order_id   uuid not null references work_orders(id),
  actor      text not null,
  type       text not null,
  payload    jsonb not null,
  trace_id   text not null,
  created_at timestamptz not null default now(),
  primary key (xid, seq)
);

create table outbox (
  id               bigint generated always as identity primary key,
  order_id         uuid,
  kind             text not null,           -- 'assignment_email'
  payload          jsonb not null,
  trace_id         text not null,
  created_at       timestamptz not null default now(),
  published_at     timestamptz,
  lease_epoch      int not null default 0,
  lease_owner      text,
  lease_expires_at timestamptz
);
create index outbox_pending on outbox (id) where published_at is null;

create table notifications (
  outbox_id       bigint primary key references outbox(id),
  sent_at         timestamptz not null,
  smtp_message_id text not null,
  epoch           int not null
);

create table idempotency_keys (
  principal    text not null,
  key          text not null,
  request_hash bytea not null,
  status       int not null,
  response     bytea not null,              -- includes stored 409 responses
  created_at   timestamptz not null default now(),
  primary key (principal, key)
);

create table audit_events (
  seq         bigint generated always as identity primary key,
  canonical   bytea not null,               -- the exact bytes that were hashed (layout v1)
  prev_hash   bytea not null,
  hash        bytea not null,               -- sha256(prev_hash || canonical)
  recorded_at timestamptz not null default now()
);

create table worker_heartbeats (
  worker_id         text primary key,
  beat_at           timestamptz not null,
  holding_outbox_id bigint
);
```

**Visibility is one function, used by every policy that concerns orders.**

```sql
create function culvert.visible_order(p_id uuid, p_region text, p_crew int)
returns boolean language sql stable as $$
  select exists (
      select 1 from culvert.memberships m
      where m.user_sub = current_setting('app.principal', true)
        and (   m.role = 'auditor'
             or (m.role = 'dispatcher'  and m.region_id = p_region)
             or (m.role = 'technician'  and m.region_id = p_region
                 and (p_crew is null or m.crew_id = p_crew)))
    )
    or exists (
      select 1 from culvert.order_participants p
      where p.order_id = p_id
        and p.principal = current_setting('app.principal', true)
    );
$$;
```

Technicians therefore see unassigned orders in their region and orders assigned to their crew. A principal who has acted on an order keeps read access to it after it is reassigned. Operators have no order visibility.

**Policies by table.** Each row names the role that the policy applies to.

- `memberships`: `culvert_app` select where `user_sub = current_setting('app.principal', true)`. No insert, update or delete policy for the app role.
- `work_orders`: `culvert_app` select using `culvert.visible_order(id, region_id, crew_id)`; update using and with check the same predicate; insert with check that the principal holds a dispatcher membership whose `region_id` equals `work_orders.region_id`; no delete policy, so a delete affects zero rows.
- `order_participants`: `culvert_app` all commands, using and with check `principal = current_setting('app.principal', true)`. It does not reference `work_orders`, so the two policies cannot recurse.
- `events`: `culvert_app` select using `exists (select 1 from culvert.work_orders w where w.id = events.order_id)`, so an event is visible exactly when its order is. Insert with check `actor = current_setting('app.principal', true)`.
- `audit_events`: `culvert_app` select where the principal holds an auditor membership. The app role has no insert, update or delete privilege; appends go through `culvert.append_audit`. `culvert_owner` has `owner_all` only.
- `outbox`: `culvert_app` insert with check true, and no select or update. `culvert_worker` select and update with using true.
- `notifications`: `culvert_worker` insert and select with check true. No app access. It is not part of any stream.
- `worker_heartbeats`: `culvert_worker` insert and update with check true.
- `idempotency_keys`: `culvert_app` all commands where `principal = current_setting('app.principal', true)`.
- `transitions`, `regions`, `crews`: select with using true for `culvert_app` and `culvert_worker`. Reference data, not sensitive.

Unset `app.principal` yields `NULL` in every comparison, so every table returns zero rows to the app role without a principal.

**Append path.** The chain is written only by one function, which runs as the owner.

```sql
create function culvert.append_audit(p_canonical bytea) returns bigint
language plpgsql security definer set search_path = culvert, pg_temp as $$
declare v_prev bytea; v_seq bigint;
begin
  perform pg_advisory_xact_lock(7305);
  select hash into v_prev from culvert.audit_events order by seq desc limit 1;
  v_prev := coalesce(v_prev, decode(repeat('00', 32), 'hex'));
  insert into culvert.audit_events (canonical, prev_hash, hash)
  values (p_canonical, v_prev, sha256(v_prev || p_canonical))
  returning seq into v_seq;
  return v_seq;
end $$;
alter function culvert.append_audit(bytea) owner to culvert_owner;
grant execute on function culvert.append_audit(bytea) to culvert_app, culvert_worker;
```

The function trusts the canonical bytes the caller supplies. The chain shows later edits; it does not show who wrote a row, which is what the `actor` and principal fields in the canonical layout record.

**Canonical layout v1.** A one-byte layout version. Text and uuid fields are length-prefixed UTF-8. Integers are fixed-width big-endian: `crew_id` is int32, `seq` is int64. The Go canonicaliser writes the fields in a fixed order; the layout document lists the offset of every fixed-width field. `jsonb` is not hashed, because `jsonb` normalises key order and number text, so re-serialising it can change a hash.

**Read probes.** Three SECURITY DEFINER functions owned by `culvert_probe` return the only cross-RLS data the demo uses.

```sql
create function culvert.probe_order(p_id uuid)
returns table (found boolean, visible boolean)
language sql stable security definer set search_path = culvert, pg_temp as $$
  select true, culvert.visible_order(w.id, w.region_id, w.crew_id)
  from culvert.work_orders w where w.id = p_id;
$$;

create function culvert.total_orders() returns bigint
language sql stable security definer set search_path = culvert, pg_temp as $$
  select count(*) from culvert.work_orders;
$$;
```

`probe_order` returns no row when the id is absent, and one row with two booleans when it exists. It returns no order data. `total_orders` returns one number. `health_snapshot` returns the age of the oldest unpublished outbox row and the count of live workers, and nothing else. Each is owned by `culvert_probe` and granted only to `culvert_app`.

The probe is an existence oracle for code holding the app role. The API exposes it only as a uniform `404`, plus an audit row for a denied existing order. The total count is disclosed to every principal; the demo treats the count of orders as non-sensitive, and says so.

**Triggers.**

- `wo_guard` (before update on `work_orders`): if `status` changes, requires a row in `transitions` and a membership whose role ranks at or above `min_role`; for a technician, requires `crew_id` to equal the order's assignee. Always increments `version`. The trigger runs as the invoking role, so the membership's own-row policy is enough for it to read the principal's rows.
- `audit_no_update` (before update or delete on `audit_events`): raises `insufficient_privilege`. This stops accidents and the app role. It is not the integrity mechanism; the owner can disable it, and the chain is what shows that.

### D.3 Communication

- **Browser to API.** HTTPS with JSON. Writes require `Idempotency-Key`. Responses carry `Trace-Id` and, on replay, `Idempotent-Replayed: true`. Race requests use HTTP/2 over TLS.
- **Asynchronous.** The outbox, drained by workers. No message broker: a broker publish cannot commit atomically with the state change without a second commit.
- **Real-time.** Each API replica holds one dedicated `pgx` connection (outside the pool) that runs `LISTEN culvert_events`. The notification payload is only the event key `xid:seq`. The stream reads events under its subscriber's subject, so the notification channel never carries data a subscriber may not see.
- **Stream protocol.** `GET /v1/streams/orders` with `Authorization: Bearer <access token>`, read by `fetch`. Each SSE `id:` is the event key `xid:seq`. A comment heartbeat goes out every 15 s [C]. There are no stream tickets. The access token stays in memory.
- **Client reconnect loop.** On error or end of body, wait `min(4 s, 250 ms × 2^k)` with ±20% jitter [C], where `k` counts consecutive failures and resets on the first event. Refresh the access token first if it expires within 60 s. Reopen with `Last-Event-ID` set to the last delivered key. The client drops any event whose key is not greater than its cursor and counts those drops as duplicates suppressed. The reconnect time shown on stage is measured from the error to the first event on the new stream.
- **Operator plane.** The Ops drawer calls the API, which calls the fault controller over an internal port with a separate service credential. The fault controller is not reachable from the browser.

### D.4 Event replay: xid-ordered delivery of a finished prefix

`LISTEN/NOTIFY` is not durable and is not ordered by commit. Two facts shape the design.

- A transaction's `xid` is assigned at its first write, not at commit. Two transactions can commit in the reverse of their `xid` order.
- Within one transaction, `seq` values are increasing, and across transactions `seq` follows insertion time, not commit time.

So the replay does not claim commit order. What it delivers is this: **a stream delivers visible events in `(xid, seq)` order, and it delivers an event only when every transaction with a smaller `xid` has finished.** Given that, no later commit can produce an event that sorts below a cursor the stream has already passed.

The replay query runs as the subscriber, in one statement, so the snapshot is fixed for the statement:

```sql
select xid::text, seq, type, payload, trace_id, order_id
from culvert.events
where xid < pg_snapshot_xmin(pg_current_snapshot())
  and (xid, seq) > ($1::xid8, $2::bigint)
order by xid, seq
limit 500;
```

`pg_snapshot_xmin` is the oldest transaction still running in that snapshot. Every `xid` below it has committed or aborted, so an event below the watermark cannot appear later. Events at or above the watermark wait.

Each stream replays on connect, on every notification, and on a 250 ms timer [C]. The timer matters: when a long transaction that holds the watermark commits, it may write no event, so it sends no notification, and the timer is what lets the stream advance.

What this gives the claim:

- Every visible event at or below the watermark is delivered exactly once per stream, in `(xid, seq)` order.
- An event is never delivered before a visible event with a smaller key that commits later, because such an event cannot exist once the watermark passes it.
- Invisible events are skipped for that subscriber, and the claim is stated for visible events only.
- The delivered order differs from commit order when transactions interleave. The claim 1 oracle depends on that difference.

The cost is stated in G.3: a long transaction holds the watermark back, and live updates wait with it.

### D.5 Security boundaries and authorization model

Boundaries, outside to inside:

1. **Browser.** Content-Security-Policy restricts scripts to the bundle origin. Access tokens are kept in memory. The refresh token is in an `HttpOnly` cookie scoped to the auth origin.
2. **Edge.** TLS at CloudFront and the ALB, HSTS, and WAF rules on the API origin for body size and rate. Locally, Traefik with a self-signed certificate and the same headers.
3. **API.** Verifies the JWT signature against cached JWKS (refetched on an unknown `kid`), along with `iss`, `aud` and `exp`. Reads are decided by RLS. Writes are decided by the API for which transitions it attempts, and by the trigger for whether the role may make them. Every API transaction sets `app.principal` with `set_config(..., true)` before its first statement and runs under `statement_timeout` 5 s and `idle_in_transaction_session_timeout` 10 s [C].
4. **Database.** Four roles as in D.2. The running API has no owner rights. The Ops console is the only path to owner rights in the demo.
5. **Operator plane.** Ops is a separate identity group. On AWS it is a separate Cognito app client that requires MFA. The fault controller has no database role.
6. **Database console.** Connects as the owner with the same statement timeout and idle timeout. It is two-step: a read-only preview that shows the target and the old and new values, then an apply that runs once and rolls back unless it completes. Its statements are written to a log stream the owner role cannot write (CloudWatch Logs with a separate task role on AWS; the console's own log volume locally). Its apply action is appended to the chain. The console screen states the limit: the owner can change rows, and the chain, the anchors and the log stream show it.

**What RLS does and does not bound.** RLS bounds accidental omission: any query the app role issues under a principal returns only what policy allows, whether or not the API author remembered a filter. It does not bound code that holds the app role and sets a different subject; PostgreSQL does not let a role be restricted from setting a custom GUC. The mitigations are structural: `app.principal` is set in one place from the verified token (a static test checks that this is the only call site), the app role cannot write `memberships` or `audit_events`, and every write row in the chain records the principal. The document does not claim more than that.

Authorization model: principals are identified by `sub` only. Roles and scope come from `memberships`, which migrations and the seed write. Tokens carry no authorization data. Revoking a membership takes effect on the next query, not at token expiry.

### D.6 Consistency requirements per operation

| Operation | Mechanism | Isolation and guarantee |
|---|---|---|
| Create order | One transaction: `work_orders`, `audit_events` (append), `events`, `order_participants` (creator), `idempotency_keys`. The key is checked first in the same transaction. No outbox row: the demo's creation does not send mail. | Read committed suffices; the unique `(principal, key)` serialises concurrent retries. A retry returns the stored response. |
| Assign crew (compare-and-set) | `UPDATE work_orders SET crew_id = $c, status = 'dispatched' WHERE id = $1 AND version = $2`, with audit, event and outbox rows in the same transaction. Zero rows means conflict. The conflict response reads the current row under RLS and the winning event row for the actor and time. | Row lock on the update; exactly one winner per version. |
| Status transition | Trigger `wo_guard` validates `(from, to)` against `transitions`, `min_role` against `memberships`, and the technician's crew against the assignee; then bumps `version`. | Enforced for every writer, including the owner. |
| Offline replay action | Each queued action carries its key and its precondition: `base_status`, `base_crew_id`, or for notes only "not closed". In one transaction: `SELECT ... FOR UPDATE` on the order under RLS. No row: `409 precondition_failed` with `current: null`, `reason: not_visible`. A row whose precondition fails: `409 precondition_failed` with the current status, crew and version. A passing precondition applies the change. The response, including a 409, is stored under the key. | Serialisable per order by the row lock. Preconditions are compared, not `version`, so an unrelated edit (a priority change) does not create a conflict. |
| Audit append | `culvert.append_audit`, which takes an advisory transaction lock, reads the last hash, and inserts. | Linear chain. The lock is a deliberate serialisation point (G.1). |
| Event append and replay | `events` row in the same transaction as the change; replay per D.4. | Visible events below the watermark, once each, `(xid, seq)` order. |
| Outbox claim | `UPDATE outbox SET lease_epoch = lease_epoch + 1, lease_owner = $w, lease_expires_at = now() + $ttl WHERE id IN (SELECT id FROM outbox WHERE published_at IS NULL AND (lease_expires_at IS NULL OR lease_expires_at < now()) ORDER BY id LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING ...`. Times are database `now()` [C: TTL 10 s on stage, 1 s in the test profile]. | One holder per row at a time. Application clocks are not used for lease decisions. |
| Lease renewal | `UPDATE outbox SET lease_expires_at = now() + $ttl WHERE id = $1 AND lease_epoch = $e AND lease_owner = $w AND published_at IS NULL`, every 3 s while held [C]. Zero rows: the worker has lost the lease and stops. | A renewing holder keeps its lease; a killed holder's lease expires at its last renewal plus the TTL. |
| Delivery and mark-sent | Before the SMTP send the worker checks that its epoch is current (fence). After SMTP returns `250`, one transaction inserts `notifications` and sets `published_at` where the epoch still matches. | At-least-once. A duplicate is possible if the worker is killed after SMTP acceptance and before commit, or stalls between the fence check and the send. Duplicates carry the same `Message-ID`. |
| Reads (board, lists) | Read committed, RLS-filtered. | The client re-fetches on replay, so the board converges within the stream's latency. |

### D.7 Deployment topology

**AWS** (Terraform, one state per environment):

- VPC across two Availability Zones. Public subnets hold the ALB and NAT gateways. Private subnets hold ECS Fargate services: `api` (2 tasks), `worker` (2 tasks), `fault-controller` (1 task, no public route). Isolated subnets hold RDS.
- RDS for PostgreSQL 16, Multi-AZ, encrypted with KMS. Parameter group sets `track_commit_timestamp = on` and `rds.force_ssl = on`. Connections go to the instance or cluster endpoint directly, not through RDS Proxy (G.1).
- Container settings: `stopTimeout` 2 s on `api` and `worker` (the platform minimum; confirmed in rehearsal). The signal path is `StopTask` → SIGTERM → SIGKILL after 2 s.
- Web bundle in a private S3 bucket behind CloudFront with origin access control. Deployment writes a new immutable prefix and changes only the default origin path.
- Cognito user pool with two app clients (`culvert-web` with PKCE, `culvert-ops` with MFA required).
- SES verified identities for the demo sender and recipients.
- Secrets Manager for database credentials. IAM task roles per service. The fault controller's task role can call `StopTask` and read task state only for tasks tagged `culvert-service=api` or `culvert-service=worker`, in the demo cluster.
- S3 bucket with Object Lock (compliance mode) for head anchors. The worker writes an anchor every 100 audit rows [C].
- CloudWatch Logs with structured JSON, including the console log stream. ADOT sidecar exporting to X-Ray.
- ECR repositories for the images with tag immutability on; the digest is recorded in the deployment manifest.
- Rollout: the `migrate` task runs to completion first; then `api` and `worker` roll with a minimum healthy percent that keeps one of each serving.

**Local** (Docker Compose, one file, profiles `demo` and `test`):

- `postgres` (16, `track_commit_timestamp` on), `migrate` and `seed` (one-shot), `api-a` and `api-b` (same image, different `CULVERT_INSTANCE`), `worker-1` and `worker-2`, `fault-controller` behind a socket proxy that allows `kill` only on containers labelled `culvert.service=api` or `culvert.service=worker`, `traefik`, `web`, `dex`, `mailpit`, `otel-collector`, `jaeger`, and `toxiproxy` (in the database path, used only for the optional latency fault, which the stage script does not use).
- Signal path: the fault controller sends SIGTERM through the proxy, then SIGKILL after 2 s if the container is still running. `stop_grace_period: 2s` on `api` and `worker`.
- `make up` builds, migrates, seeds and starts. `make reset` removes volumes and reruns the one-shot services. `make ready` polls the readiness endpoints the health strip uses.

---

## E. AWS and local deployment

**Container-first and immutable.** Three images: `culvert-app` (the Go binary on a distroless static base, non-root, read-only root filesystem, no shell), `culvert-web` (the built bundle behind a static file server) and `culvert-fault`. Images are built once in CI, labelled with the commit, scanned, given an SBOM, signed with cosign, and promoted by digest. The same `culvert-app` digest runs as API and worker, distinguished only by subcommand.

**Demo build and release build.** The demo images carry build tag `faultinject`, which compiles in the delivery hold and the named pause points. The release image is built without the tag, and CI asserts that its hook routes are absent. The rehearsal and the parity check use demo digests, and the deviation is stated here so that the demo does not claim to be the release.

**Configuration.** Twelve-factor: environment variables for non-secret settings, Secrets Manager or the local `.env.demo` for secrets, all listed in one schema file the binary validates at start. The readiness endpoint reports the schema version and the image digest, which the Ops drawer displays.

**Service mapping.**

| Concern | AWS | Local stand-in | What differs | Why behaviour is the same |
|---|---|---|---|---|
| Database | RDS PostgreSQL 16, Multi-AZ | `postgres:16` | Failover (not exercised); storage and backup features | Same engine, roles, RLS, `LISTEN/NOTIFY`, commit timestamps. |
| Load balancer | ALB | Traefik | Deregistration timing set per platform so the kill is visible within seconds on both | Both route to healthy instances; neither buffers SSE. |
| Compute | ECS Fargate services | Compose services | Scheduler replaces tasks; Compose uses `restart: always` | Both: the process is signalled, the lease is not released by the worker, the replacement starts from the same binary. |
| Signal path (fault) | `StopTask`: SIGTERM, then SIGKILL after `stopTimeout` 2 s | Socket-proxy `kill` of SIGTERM, then SIGKILL after 2 s | Transport of the signal only | Identical two-phase semantics, with the same worker and API handlers. The parity claim covers this path. |
| Operator-plane authorisation | IAM task role with tag condition `culvert-service in (api, worker)` and cluster condition | Socket proxy allowing only `kill` on containers labelled `culvert.service` in (`api`, `worker`) | Mechanism | Both refuse start, create, exec and stop for untagged targets; both are tested (G.1). The fault controller also checks its own allow-list before each call. |
| Delivery hold and pause points | Demo image only (`faultinject`) | Same | Not in the release image | Same demo digest runs in both environments. |
| Identity | Cognito; `cognito:groups` not used for authorization | Dex (static users) | Token shape, refresh, MFA | Authorization comes from `memberships`, so the app sees only `sub`. |
| Streams | `fetch` with bearer token; ALB | `fetch` with bearer token; Traefik | Idle timeouts set above the 15 s heartbeat on both | Same client loop and cursor protocol. |
| Email | SES SMTP | Mailpit SMTP | Real delivery versus capture | Same SMTP client, `Message-ID` header and outbox key. |
| Tracing | ADOT to X-Ray | Collector to Jaeger | Deep-link format and retention | Same OTLP from the app; the reader interface hides the backend. |
| Audit anchor | S3 Object Lock | Append-only file in a named volume | Object Lock is the stronger guarantee | Same anchor record format and the same verifier flag. |
| Web delivery | CloudFront and S3 | Traefik and static container | Cache invalidation | Bundle bytes identical (digest checked). |
| Replacement readiness | Fargate task start, measured in rehearsal | Container start, measured in rehearsal | Start latency | The step does not wait; the strip shows the state. |

**What is deliberately not identical.** Database failover, managed credential rotation, multi-region replication and autoscaling are not part of the five minutes. The application code does not branch on environment; differences are in Terraform and Compose only. CI asserts that the demo `culvert-app` digest in the local lock file, the ECR repository and the AWS manifest match, and that both running stacks report it on readiness.

**Parity tests.** The Playwright rehearsal runs the five-minute script against both stacks with the same test code. Identical assertions must pass in both. The rehearsal report records image digests and the outcome of each assertion. Separately, the claim 4 verifier test runs a fixture chain with fixed bytes; its output string is fixed by the test and must match in both environments. Live chains are not compared across environments: their hashes differ between runs because timestamps differ.

**Reset.** Locally, `make reset` recreates volumes and reseeds. On AWS, a separate demo stack has its own database; a reset task truncates and reseeds it, allowed only when the stack carries tag `culvert-demo=true`. The seed uses fixed UUIDs and a fixed reference time, so the board, the crew assignments and the first audit rows are the same on every reset. Later rows carry run timestamps.

---

## F. Five strongest technical claims

Each claim has an executable test and a behaviour that the script shows. Tests run in the Go test suite or in the Playwright rehearsal. Routine checks run a reduced tier; the full tier runs once on a stacked change set.

### Claim 1: Streams deliver every visible event once, in `(xid, seq)` order, across reconnects and replica failures, and the test can tell that order from commit order.

- **Setup.** Two `culvert serve` processes, started as separate OS processes by the harness (and by Compose in the rehearsal). A test proxy resets client connections at random. Forty concurrent writers across two subjects create events.
- **Slow writer.** One transaction writes an event, waits, and commits after transactions that started later have committed. Its event therefore has the smallest `xid` and the last commit time.
- **Oracle.** After the run, the expected sequence for each subject is the visible events ordered by `(xid, seq)`, read from `events`. The test asserts that each subscriber's received sequence equals that expected sequence: no gaps among visible events, no duplicates, same order.
- **Distinguishing check.** For the slow-writer case, the test also reads commit times with `pg_xact_commit_timestamp` on each event's transaction (narrowing `xid8` to the 32-bit `xid`, which is unambiguous in the test database). It asserts that the delivered order differs from commit-time order in that case. A replay that delivered commit order would fail the equality assertion.
- **Kill.** One replica is killed by SIGTERM during the run. The client loop reconnects and the test asserts the sequence still matches.
- **Observable.** The reconnect and replay line at 210 to 230 s, with a measured reconnect time and a replayed count. Gap-free is what this test proves; the stage panel does not print "gaps 0" because that figure would be a constant, not a measurement.
- **Where it runs.** The slow writer holds the watermark for the length of its transaction; it runs in the test database only.

### Claim 2: Concurrent assignment has exactly one winner, and retries do not repeat an effect.

- **Test.** Twenty goroutines, released from a barrier, send assignment requests with the same `expected_version` over one HTTP/2 connection. The API pool has 25 connections. The test asserts one success at version 2, nineteen `409` responses that carry the winning event's actor, crew and version, one `assignment.changed` audit row and one `events` row.
- **Retries.** The winning request is retried with its key 50 times. The test asserts identical response bodies, `Idempotent-Replayed: true` and no new rows.
- **Observable.** The race at 100 to 125 s and the replayed response.

### Claim 3: Authorization holds below the application for accidental omission.

- **Scope.** This claim is about queries that omit an application-level filter. It does not claim to stop code that sets another subject (D.5).
- **Test.** For each principal in a fixed set (Maya, Sam, Rafi, Priya, an unknown subject, and no principal), run a fixed list of statements as `culvert_app`: `SELECT *` on each table, `count(*)`, a join from `events` to `work_orders`, an update of an invisible order, and a `DELETE`. Compare row counts and results with the expected matrix, with and without `app.principal` set.
- **Property test.** Randomly generate memberships (including dual-region dispatchers, technicians with crews, participants) and orders. For each generated subject, the rows a raw query returns must equal the set a reference model computes from the policy definition.
- **Setter test.** A static test asserts that `set_config('app.principal', ...)` appears in one place in the Go source and that its argument comes from the verified token. A database test asserts that `culvert_app` cannot insert into or update `audit_events` or `memberships`, and that `culvert.probe_order` returns no order columns.
- **Observable.** The 75 to 100 s scene: a `404` with a request id, a `read.denied` row, and the zero-row `psql` results.

### Claim 4: A change to an audit row is detected at its sequence number, including a change made by the owner with the trigger disabled.

- **Canonical layout.** Layout v1 (D.2) stores `crew_id` as a fixed-width int32 at an offset the layout document gives. The tamper procedure reads the layout, checks that the field is present and fixed-width, overwrites those four bytes, and leaves the stored hash unchanged.
- **Random chains.** Stack tier: 1,000 random chains of 50 to 500 events with random payloads. Routine tier: 50. For each chain, pick a random sequence number and a random field, modify it through the owner role with the trigger disabled, and run the verifier. Assert that the first broken sequence equals the modified one and that every later row is reported unverifiable.
- **Full-chain rewrite.** A rewrite that recomputes every hash is not detected by the chain alone. The test rewrites the chain, leaves the anchors alone, and asserts that the verifier's anchor comparison reports a mismatch at the last anchor that precedes the change.
- **Cross-environment fixture.** A fixture chain with fixed bytes has a fixed verifier output string, asserted in both environments. This is the only cross-environment output comparison the demo makes.
- **Observable.** The change at 250 to 268 s and the verifier's first broken link at 268 to 300 s, with the count of rows after it, derived.

### Claim 5: Background delivery produces at most one message per outbox row across worker kills, except in named windows, and every duplicate is recognisable.

- **Pause points.** The `faultinject` build provides named pause points: after claim, after the fence check, after SMTP `250` and before commit, and while the hold is active. Kills happen at those points, so the trial exercises each window deterministically rather than by random timing.
- **Lease parameters.** Test profile: lease TTL 1 s and renewal every 300 ms [C]. Stage profile: 10 s and 3 s. Routine tier: 20 trials. Stack tier: 200 trials.
- **Assertions.** At most one message per outbox row, except where the kill was after SMTP acceptance and before commit, where there are at most two messages and both carry the same `Message-ID`. Exactly one `notifications` row per delivered outbox row. Every row ends with `published_at` set. The test reports the count of trials per pause point.
- **Stalls.** A worker that stalls between the fence check and the send, and is reclaimed meanwhile, can send after the new holder has sent. The test models this with a pause after the fence check and a deliberate stall, and it asserts the duplicate carries the same `Message-ID`. It is listed as a known duplicate window in G.1.
- **Observable.** The kill at 175 to 190 s shows lease reclaim and one message for the key. The stage does not show the after-send duplicate window; the report does.

### Claim 14 (supporting): The demo image digest is the same locally and on AWS.

- **Check.** CI asserts that the demo `culvert-app` digest in the lock file, in the ECR repository and in the AWS demo manifest match, and that both running stacks report it on readiness. The rehearsal report records the digests.

---

## G. Failure analysis

### G.1 Implementation difficulties

- **Ordering versus commit order.** A sequence-based stream loses events under concurrency. Delivering an xid-ordered prefix (D.4) avoids silent gaps for visible events, but it delivers transaction-start order among committed transactions, not commit order. The claim is stated that way. This is the highest-risk correctness item, and claim 1 is built around it.
- **`LISTEN/NOTIFY` behind a managed proxy.** RDS Proxy pins a client to a session when it uses `LISTEN`, which defeats pooling. The listener connects directly to the database endpoint. A notification-only listener is not durable, which is why streams replay from their cursor and why the 250 ms timer exists.
- **SSE across load balancers.** Idle timeouts on the ALB and Traefik exceed the 15 s heartbeat. Response buffering is off. The stream route disables compression and sets `Cache-Control: no-transform`.
- **Client reconnect.** `EventSource` cannot send headers and would reuse a spent URL, so streams use `fetch` with an explicit reconnect loop (D.3). The reconnect time is measured on the client. Tickets are not used.
- **Offline queue durability.** IndexedDB can be evicted under storage pressure, and a service worker update can reload the page mid-flush. The queue writes each action before the UI updates and sends one action at a time. An action in the `sending` state when the page reloads is resent with the same key, and the stored response returns, so the effect is not repeated. The queue order is the device-local insertion sequence; the server applies preconditions, not client timestamps. Eviction is accepted as a limitation; the queue panel shows whether `navigator.storage.persist()` was granted.
- **Hash-chain serialisation.** The advisory lock makes every audit append wait for the previous one, a deliberate throughput ceiling. The demo's write rate does not reach it. A sustained-load design would need per-region chains anchored by a global head. This is recorded as backlog work.
- **Canonical encoding.** The canonicaliser is a fixed-order, length-prefixed writer with fixed-width integers and a layout version. Storing the bytes avoids dependence on `jsonb` text, which changes across upgrades.
- **Leases and renewal.** Leases use the database clock. Renewal runs while the worker is alive, so a kill is reclaimed after the last renewal plus the TTL, and a long send does not lose its lease to a live worker.
- **Fencing is partial.** The worker checks its epoch before the send. A stall between the check and the send, followed by reclaim, produces a duplicate with the same `Message-ID`. The fence narrows the window; it does not close it.
- **Fault controller privilege.** A Docker socket is root-equivalent. Locally the controller sees the socket only through a proxy that allows `kill` on labelled containers. On AWS the task role is limited by tag and cluster conditions. Both limits are tested: a request to start or create a container, to exec, or to stop an untagged task is refused.
- **Two-phase signals.** A worker without a SIGTERM handler terminates at once on SIGTERM. An API with a SIGTERM handler closes its streams at once and exits within its drain budget. Both platforms send SIGKILL after 2 s if the process is still alive, so the same handler code runs in both places.
- **Database console.** A console session that is idle inside a transaction, or runs a long statement, holds locks and stalls the watermark. Both timeouts (5 s statement, 10 s idle in transaction) and the two-step apply bound that. A statement the timeout cancels rolls back the apply.
- **Cognito token details.** Access tokens and ID tokens differ in audience; the API validates `client_id` on access tokens. JWKS rotation is handled by refetching on an unknown `kid`. Refresh uses the cookie on the auth origin.
- **Replacement readiness.** Fargate tasks start in an unmeasured time after a kill. Nothing in the script waits for them. The strip shows the state, and the rehearsal records the measured start.
- **Known duplicate windows.** Kill after SMTP acceptance and before commit, and a stall between fence check and send. Both produce duplicates with the same `Message-ID`, and both are tested in claim 5 and reported.

### G.2 On-stage failure modes and mitigations

| Failure mode | Effect on the audience | Mitigation |
|---|---|---|
| Venue network drops during the AWS segment | Health strip red | The AWS stack is shown only as a rehearsal report; the live script runs on the local stack with no internet access. |
| Stream does not reconnect after a replica kill | Sam's board freezes | The reconnect loop backs off and shows "reconnecting" in the strip; the rehearsal asserts reconnect within a fixed budget [T]. |
| Race requests not truly concurrent | Nineteen losers never happen | One HTTP/2 connection, a pool of 25, and a server-side arrival spread from the API log shown on the card. |
| Notification late | Count is not 1 at 190 s | The count is also shown from the `notifications` row. The rehearsal sets the hold so the kill point is deterministic. |
| Browser offline emulation differs from the real network | Queue does not flush as rehearsed | Both emulations are used in the rehearsal (below). |
| Chain verifier slow | Verify takes seconds | Chain length is what the script produces; verification is incremental from a stored checkpoint, and the target is shown as T. |
| Presenter runs the wrong statement in the console | Tamper hits the wrong row | The tamper is a stored procedure called by name. Preview shows the target sequence, field and values; apply runs only after a second confirmation. |
| Email sender rejected by SES | No email on AWS | Identities verified in advance; the rehearsal fails loudly if a send is refused. |
| Port conflicts on the presenter machine | Compose fails | Fixed high ports; `make ready` before the audience arrives. |
| Clock drift on the laptop | Trace times look wrong | Times shown are server times from the event row. |

**Offline browsers.** The rehearsal runs the offline beat in two browsers and asserts the flush order in each.

- Chromium, through Playwright, at a pinned version, using `context.setOffline(true)`.
- Google Chrome stable, at a version pinned on the presenter's machine, using DevTools network Offline, with the installed PWA window used on stage.

Firefox and Safari are not part of the demo and are not claimed. In each browser the rehearsal also asserts that a reload during a flush resumes with the same keys, and that `navigator.storage.persist()` returns true. If it returns false, the stage uses the installed window, which requests persistence differently; the queue panel shows the state either way.

### G.3 Hidden complexity

- **Reads are a policy evaluation.** Every board query runs the `visible_order` predicate, which reads memberships and participants. The rehearsal checks the query plans with `EXPLAIN`, because a naive predicate can turn a list into a full scan.
- **The watermark is a shared dependency.** A long-running transaction holds back the watermark for every stream. That is correct, and the health strip would show "events behind" if the lag were visible, but the demo does not stage it. It is a deliberate later demonstration.
- **Participation is a second authorization fact.** Participants keep read access after reassignment. That is the rule regulators would want for handover, and it has to be tested for revocation: a participant whose membership is removed loses the participant rows only if they are removed too. The demo does not remove memberships at run time, so this is covered by the test suite only.
- **The offline queue is a second state machine.** Its precondition shapes come from the same schema as the server's checks, so the client and the trigger do not drift.
- **Trace propagation has many small failure points.** CORS must allow `traceparent`; the ALB must not strip it; the worker reads the trace id from the outbox row, not from the request.

### G.4 Features that look impressive but are shallow

- **The Resilience panel as buttons.** Each button's effect is read back from the system: stream replica, replay counters, lease holder, renewal count, reclaim time. A button that only calls an endpoint would be a prop.
- **The health strip.** It queries readiness, heartbeats and outbox age at each refresh. It does not read a cache.
- **The audit viewer.** The table is CRUD over a log. The value is the verifier and the broken-link strip.
- **Multiple browser sessions.** Three subjects with distinct memberships; if they shared a session, the RLS demo would mean nothing.
- **Offline mode with a banner.** The part worth showing is the ordered replay and the conflict split, which is real only because the queue is durable.
- **The trace chip.** It is decoration unless the id is stored with the event and the outbox row, and the trace opens on stage for one submit.
- **Email.** Incidental. It makes the worker's effect visible.
- **Tamper detection as a stunt.** The owner can change rows. What the demo shows is which guarantee still holds after the change (the sequence is named and downstream rows are counted), and which does not (the owner can rewrite the whole chain, which only the anchors reveal).

---

## H. Feasibility

### H.1 Scope by component

| Component | What the work touches |
|---|---|
| Schema, migrations, roles, policies, triggers, transition table, seed | Thirteen tables, four roles, the policy set in D.2, two triggers, one visibility function, three probe functions, one append function. Most correctness tests attach here. |
| Audit canonicaliser and verifier | One package, one command, one anchor writer, one fixed layout document. |
| API | About 25 endpoints across orders, assignments, transitions, streams, the explorer and operator routes. Pool configuration and timeouts. |
| Replay and notification fan-out | One notifier per replica, one replay query, one reconnect-aware cursor type. |
| Worker | One claim loop with renewal, one sender, one heartbeat, one anchor writer, the `faultinject` hooks. |
| Web client | About eight screens or panels: board, detail, assignment and conflict tray, phone list, queue and conflicts, Ops drawer, trace panel, audit page. One design system. |
| Offline queue | One IndexedDB store, one sequential flush routine, one conflicts view, one service worker. |
| Fault controller | Four operations, two allow-lists, and refusal tests. |
| Compose and Traefik | One file, a socket proxy configuration, a handful of small configs. |
| Terraform | VPC, ECS services, ALB, RDS, Cognito, CloudFront, S3, SES identities, IAM, ECR, Secrets Manager, the Object Lock bucket. Broad, mostly declarative. |
| Rehearsal | One script that drives section C in two browsers and two deployments, and records digests. |

### H.2 Build order (dependency-driven)

Each step is runnable and testable alone, and each is a precondition for the next.

1. **Schema and roles.** Migrations, policies, visibility function, participants, append function, probes, transitions, triggers, seed. Testable with raw SQL: claim 3 runs here, including the setter and privilege tests.
2. **Minimum vertical slice.** Create an order and read the board with RLS. An event row, `NOTIFY`, one stream with replay and the timer. Local Compose with Postgres and one API. This proves the architecture end to end.
3. **Replay correctness.** Two replica processes, the xid-ordered oracle, the commit-timestamp check, the proxy reset harness (claim 1). This gates the real-time claim, so it precedes the UI.
4. **Audit chain and verifier.** Every write path appends; verifier; layout v1; the tamper procedure; the random-chain test and the anchor test (claim 4).
5. **Assignment and idempotency.** Compare-and-set, the stored-response mechanism including 409s, the race test (claim 2), the HTTP/2 client path.
6. **Outbox and worker.** Claims, renewal, fence, SMTP to Mailpit, heartbeats, pause points, lease parameters for the test profile (claim 5).
7. **Web client.** Board, detail, assignment, conflicts, trace panel, fetch-based stream with the reconnect loop. The visual system is applied here.
8. **Offline queue.** IndexedDB store, sequential flush, precondition errors, conflicts inbox, `persist()` check. Depends on 5 and 7.
9. **Fault controller and Resilience panel.** Depends on 2 and 6, because it reads their state.
10. **Ops drawer and audit page.** Verifier UI, the two-step console with timeouts, log sink. Depends on 4.
11. **Rehearsal.** The script for section C in both browsers on local Compose. Depends on 1 through 10.
12. **Terraform and AWS.** Depends on images from 2 through 10 being stable. The same rehearsal then runs against AWS.
13. **Parity checks in CI.** Last, because it compares artifacts that must exist in both places.

Dependency edges that matter most: step 3 gates the real-time claim; step 6 gates the worker kill; step 8 gates the offline segment; step 12 waits for the contract frozen by step 10.

### H.3 Critical dependencies

- Cognito token details, the hosted UI redirect, and a pre-issued session for each demo subject.
- RDS PostgreSQL 16 with `rds.force_ssl`, `track_commit_timestamp`, direct connections for `LISTEN`, and the console's log sink.
- Traefik and ALB SSE handling and health-check timing, both tuned to the kill window.
- Browser `fetch` streaming and Playwright's ability to run three contexts with separate storage.
- SES identities verified in advance.
- Dex for the local identity path.
- Fargate task start time, measured in the rehearsal and reported.

### H.4 Main risks

1. **Replay correctness under concurrency** (claim 1). Highest risk, and the most valuable claim. Built and tested before the UI at step 3.
2. **Offline queue on real browsers.** Tested in two browsers with both emulations, a mid-flush reload and a killed tab. Eviction is accepted as a limitation.
3. **Parity drift.** Two Terraform and Compose definitions can diverge. Mitigated by the digest check and by running the same rehearsal in both.
4. **Visual quality.** A dense operational interface can look like an admin template. Mitigated by a deliberate design system (dark operations palette, status colour rules, the chain strip as the signature visual) applied at step 7.
5. **Presenter reliability.** Three windows, an Ops drawer and a console on one machine. Mitigated by the scripted reset, the rehearsal checklist, and the partial-state rules in section C.
6. **Scope creep.** Mitigated by the rule that every new screen must read back one of the capabilities in section B.

---

## Summary of positions taken

- Authorization lives in Postgres tables and RLS, not in token claims. RLS bounds accidental omission; it does not bound code that sets another subject, and the document says so.
- Replay delivers an xid-ordered prefix of finished transactions. It is not commit-ordered, and the test is built to tell the two apart.
- Streams use `fetch` with bearer authentication and an explicit reconnect loop; there are no single-use tickets.
- Offline replay compares preconditions rather than versions, and refused actions get a uniform not-visible response or the current state, depending on visibility.
- Leases use the database clock, renew while alive, and are fenced before the send. Delivery is at-least-once, and the duplicate windows are named.
- The audit chain uses fixed-layout canonical bytes, an owner-only append function, an append-only trigger as an accident guard, and external anchors for the case the owner rewrites the whole chain.
- Faults are two-phase signals, identical on both platforms. Latency injection is local only and is not in the script.
- Every on-screen value is labelled derived, measured, target or configured.
