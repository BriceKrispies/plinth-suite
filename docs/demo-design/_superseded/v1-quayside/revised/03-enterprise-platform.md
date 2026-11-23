# Competitor 03: Enterprise Platform (revised)

**Product title: Ledgerwell, multi-tenant spend control with tamper-evident approvals**

**Pitch.** Ledgerwell lets two companies share one deployed platform in which every purchase request, budget reservation and approval is enforced by the database, recorded in a hash-chained ledger, and pushed live to every connected session. In five minutes an audience watches a 48,000 purchase be reserved, routed and approved, watches a concurrent race on the last budget resolve to one reservation and one refusal, and then sees a dual-controlled integrity drill, run on the AWS staging stack, break the chain at an exact sequence number that the verifier reports to every open screen.

Mandate: a design philosophy, not a separate goal. Every choice below serves the mission brief: a real AWS-deployed application that runs locally from the same container images, with five minutes of visible, substantiated system behaviour.

---

## Revision log

Each reviewer finding on the first proposal, and what this revision does with it. "Fixed" names the section where the change is. "Rebutted" gives the reason the original stands. "Accepted" is a known limitation stated in section G or E.

### Reviewer A (Principal Systems Engineer)

Weaknesses:

1. *Filtered per-viewer streams break contiguity.* **Fixed (D, Communication; F4; consistency table).** The stream now replays every ledger sequence number a viewer is cursor-past. Events the viewer may not read are not sent, but the server sends `through` markers that advance the viewer's cursor over them. The marker carries no content and no count. Gaps are covered by markers; an uncovered gap is a fault.
2. *The drill is the application's own designed fault, run from inside the process.* **Fixed (A, C row 111; D, Drill).** The tamper is performed by a separate `drill-runner` task whose database role is the only holder of forensics credentials. The application process never holds them. The drill is labelled as deliberate fault injection by a documented operator path, not as detection of a real attacker.
3. *ops_log sits outside the chain and is writable by the forensics role.* **Fixed (D, Data model).** `ops_log` is removed. Drill evidence is three ledger events: `drill.requested`, `drill.confirmed` and `drill.executed`. The drill's record is in the chain, written by the application role.
4. *Tom, the read-only auditor, starts the break-glass drill.* **Fixed (C, 215–245 s).** Drill initiation is a writing action for a Finance Controller, with a second confirmation by a Budget Owner. The auditor's window has no drill control, and Decide() proves it.
5. *Explain traces are recomputed for actions not attempted; decisions records only mutations and denials.* **Fixed (D, Authorization; F5).** Every explain request writes a `decisions` row with action `explain`. The trace is always a stored evaluation created at explain time. The 403 demonstration moved out of the five-minute path and into rehearsal.
6. *No global lock order; approve reads budget through the guard, a deadlock risk with submit.* **Fixed (D, Lock order).** One global lock order is published (allocation, then request, then approval steps, then chain head last). Approve reads budget without locking. A submit-versus-approve deadlock test is in F2 and in the rehearsal suite.
7. *Verification is a read transaction that publishes a write.* **Fixed (D, Verification; C, 185–215 s).** Verification is a `REPEATABLE READ` read-only transaction that names its head H. A separate short write transaction appends `integrity.checked` or `integrity.broken` with `checked_through = H`.
8. *RLS policy uses `current_setting` without `missing_ok`, which errors while the prose says it matches no row.* **Fixed (D, Persistence model).** The policy uses `current_setting('app.tenant_id', true)` with `nullif(..., '')`. An unset setting yields NULL, which matches no row and fails `WITH CHECK`. Prose and policy now agree; F1 tests both.
9. *Outer hash fields have no defined encoding; timestamptz text depends on session settings.* **Fixed (D, Ledger hash encoding).** The encoding is specified byte for byte. `occurred_at` is stored at millisecond precision and hashed as a fixed UTC string.
10. *Budget effect of approval and rejection is undefined.* **Fixed (D, Budget lifecycle).** Submission reserves; approval leaves the reservation in place; rejection or withdrawal releases it. Conversion to spent is out of scope and stated as such.
11. *Explain at 65–95 s and the stored-evaluation claim.* Covered by item 5.
12. *Verifier's link check semantics and "stops at first failure".* Covered in Revision C item 1 below, which has the same root cause.
13. *Anchor comparison.* Covered in Revision C item 2.
14. *Race labels depend on arrival order.* Covered in Revision C item 3.
15. *CEL guards and browser evaluation.* Covered in Revision B item 4.

Required changes:

- Per-viewer stream cursor and rewritten F4 and consistency table. **Done** (D, Communication; F4; consistency table).
- Drill as explicit fault injection by a documented operator path, with evidence in the chain. **Done** (C; D, Drill; F3).
- Drill initiation given to a writing role. **Done** (C, 215–245 s).
- Stored evaluation for every explain, or explain removed. **Done** (D, Authorization; F5).
- One global lock order and a submit-versus-approve deadlock test. **Done** (D, Lock order; F2).
- Verification split into read transaction naming its head and a separate write. **Done** (D, Verification).
- RLS prose and policy agree. **Done** (D, Persistence model; F1).
- Canonical encoding of outer hash fields. **Done** (D, Ledger hash encoding; F3 test vectors).
- Budget effect of approval and rejection. **Done** (D, Budget lifecycle).

### Reviewer B (Skeptical Technical Audience Member)

Weaknesses:

1. *The drill uses `ledgerwell_forensics`, which exists only in local and staging, so the climax cannot run in production-equivalent AWS.* **Fixed and relabelled (E, Environments; C).** The climax runs on the AWS staging stack, which uses the same image digests, the same CDK stacks and the same configuration schema as production. It contains the drill-runner task and its role, which production does not have. The drill is not claimed for production. Stated on the drill page and in the script.
2. *The dual-control step-up is simulated locally (Dex has no MFA).* **Fixed and labelled (E, Identity; C; G).** On the AWS staging stack, both confirmations use Cognito with TOTP. On the local stack, the step-up is a second Dex connector challenge and the screen displays "step-up simulated (local stack)". The identical-behaviour claim is dropped for the climax.
3. *ops_log is outside the chain and writable by the forensics role.* **Fixed (D, Data model).** Removed. Drill evidence is ledger events (see Reviewer A item 3).
4. *The ERP fallback presents a pre-generated packet.* **Fixed (G, On-stage failure modes).** The fallback is removed from the live path. A late job shows a pending state; no pre-generated artifact is ever shown as a live result.
5. *The race proves barrier release and final results, not arrival order; a failed barrier reruns the race mid-talk.* **Fixed (C, 120–140 s; F2; G).** The race panel shows two columns: server-side arrival order from the API request log, and commit order from the ledger. The race is judged on invariants that hold for every interleaving, so no reset is needed. A failed attempt is skipped on stage, not rerun.
6. *The enterprise surface crowds the visual budget.* **Fixed (B; C; H).** The surface is cut to the screens the five-minute path uses. Vendor screening (S6), dashboards beyond the single budget card (S7) and CSV import (S8) are removed from the product. Workflow authoring (S9) is a rehearsal-only screen.
7. *Two CEL evaluators are the largest correctness surface, and F5 depends on their agreement.* **Fixed (D, Authorization; F5; H).** The browser evaluator is removed. The server decides every action and returns `permitted_actions` for each request it serves; the interface renders controls from that list. There is one evaluator, in Go. F5 tests that rendered controls match the list and that the server rejects anything outside it.

Required changes:

- Run drill and approval on AWS via a documented route, or label the run as staging and drop the identical-behaviour claim. **Done** (E, Environments; C).
- Real second factor, or state on screen that step-up is simulated. **Done** (E, Identity; C, 215–245 s).
- Make ops_log hash-chained or anchored. **Done** by removal; drill evidence is in the chain.
- Remove the pre-generated packet from the live path or present it as a recorded example. **Done** by removal (G).
- Show server-side arrival order in the race panel from the request log. **Done** (C, 120–140 s).
- Cut S6 to S8 from the rehearsal path. **Done** (B; cut from the product entirely).

### Reviewer C (Implementation and Reliability Engineer)

Weaknesses:

1. *Verifier link-check semantics wrong.* **Fixed (D, Verification; C, 245–275 s).** The drill changes the stored payload only. Recomputing the payload hash of seq 1,612 fails; the event hash computed from the stored payload hash still matches the stored hash; the link from 1,613 still matches 1,612's stored hash. The verifier therefore fails on the payload check at 1,612 and stops there. The stage text names that check and does not claim a link failure at 1,613.
2. *Anchor comparison has no mechanism.* **Fixed by removal from the stage (D, Anchors; F3; C, 275–300 s).** A payload-only edit does not change any head hash, so an anchor cannot detect it. Anchors are kept for a different and real case, a full rewrite of the chain tail, and that case has its own supporting test. The stage line about anchors is removed.
3. *Race labels depend on arrival order.* **Fixed (D, Budget reservation; C, 120–140 s).** Request numbers are allocated from a counter on the allocation row under its lock. The first commit gets the lower number, which makes labels follow commit order. Arrival order is shown separately (Reviewer B item 5).
4. *Sequence numbers do not reconcile.* **Fixed (C, sequence reconciliation table; B).** The seed is fixed at 1,830 Halvard events. Every demo event is listed with its index. Asynchronous events are shown at their observed positions in the run sheet, and the rehearsal asserts the formula.
5. *CEL guards promised in B and D2 but restricted in G.6.* **Fixed (A; B; D, Guard language).** The guard language is stated as a restricted subset throughout, and the browser evaluator is removed (Reviewer B item 7).
6. *`occurred_at` in the hash and millisecond JavaScript Dates.* **Fixed (D, Ledger hash encoding).** Stored and hashed at millisecond precision in UTC. Truncation is not needed because nothing finer is stored.
7. *Cognito custom claim is in the ID token by default; the API validates access tokens.* **Fixed (E, Identity; D, Authentication).** A pre-token-generation Lambda trigger writes `tenant_id` and `principal_id` into the access token. It is listed in the `identity` CDK stack.
8. *The AWS web artifact is not the same container image as local.* **Fixed (E, Artifacts).** The AWS deployment uploads the static asset tree extracted from the `ledgerwell-web` image. A manifest digest of that tree is recorded in both environments and asserted equal by CI.
9. *Local Dex step-up simulates MFA.* Covered in Reviewer B item 2.
10. *Drill role exists only in local and staging.* Covered in Reviewer B item 1, and stated on the drill page.

Required changes:

- Correct verifier link-check semantics and make the stage line match the stored result. **Done** (D, Verification; C).
- Specify the anchored sequence used for the anchor comparison, or remove the anchor line. **Done** by removal from the stage; specified for the supporting test (D, Anchors).
- Derive race labels from ledger commit order. **Done** (D, Budget reservation).
- Reconcile every event number in section C with the seed. **Done** (C).
- State that the guard language is the restricted subset in sections A and B. **Done** (A; B).
- Truncation rule for `occurred_at`. **Done** (D, Ledger hash encoding).
- Specify the Cognito pre-token-generation mapping and list the trigger in infrastructure. **Done** (E, Identity; D, Deployment topology).
- State on the drill's page that local step-up is simulated and the staging role is not a production role. **Done** (C, 215–245 s; E).

### Accepted limitations

- Sequence numbers are tenant-wide, so a requester can infer tenant activity volume from the numbers on their own events and from `through` markers. Content is not inferred. Accepted; numbers are not cross-tenant.
- A forensics-role actor with the drill's rights can rewrite the whole chain tail. The chain alone does not stop that; anchors in Object Lock detect it against the sealed head. Accepted; stated in F3.
- Tenants cannot write arbitrary CEL. The guard language is a restricted subset enforced at publish time (G).

---

## A. Product concept

### What it is

Ledgerwell is a spend-approval and budget-control platform for mid-size companies with several legal entities or divisions. Employees raise purchase requests against a cost center. Each request reserves money from that cost center's budget at submission, then moves through an approval workflow whose steps, thresholds and guard rules are authored per tenant. Every state change, denial and integrity check is appended to a tamper-evident ledger that auditors can verify independently.

It is an enterprise product rather than a dashboard. The value lies in invariants that are enforced rather than displayed: money cannot be reserved twice under concurrency, a requester cannot approve their own request, a tenant cannot read another tenant's rows through a buggy query, and recorded history cannot be silently edited without the verifier naming the sequence number.

### Tenants, users, sessions

Two tenants share one Aurora PostgreSQL cluster and one application deployment.

- **Halvard Freight Ltd** (the demo tenant). Cost centers include ENG-INFRA (Engineering Infrastructure), OPS-EU and FIN-SHARED.
- **Corvane Biosciences** (the isolation counterpart). Its own cost centers, workflows and users. Its admin Carla appears only to show that Halvard data does not exist for her.

Stable demo identities, all seeded deterministically:

| Principal | Tenant | Role(s) | Used for |
|---|---|---|---|
| Maya Lindqvist | Halvard | Requester (ENG-INFRA) | Submits the hero request; one side of the race |
| Priya Anand | Halvard | Requester (ENG-INFRA) | The other side of the race (control-panel session) |
| Dev Okafor | Halvard | Budget Owner (ENG-INFRA) | First approval step; confirms the drill |
| Ines Duarte | Halvard | Finance Controller | Second approval step; initiates the drill |
| Tom Reyes | Halvard | Internal Auditor (read-only) | Verifies the chain and reads the ledger |
| Carla Mendes | Corvane | Tenant Admin | Cross-tenant isolation moment |

Five browser windows are used on stage: Maya, Dev, Ines, Tom and Carla. Priya's session runs from the presenter's control panel, which shows her list pane for the race. Sessions are pre-established with OIDC authorization-code flow and PKCE; the presenter never logs in on stage.

### Problems solved

- Spend approved outside policy, or approved by the person who raised it.
- Budgets overspent because two requests were checked against the same balance at the same moment.
- Audit trails that can be edited by whoever has database access, with no way to show that they were.
- Tenants who need different approval rules without forking the product.
- Multi-tenant leakage through a single missing `WHERE` clause.

### Why it suits this demo

Each problem has an observable consequence on screen: a budget card that refuses to overflow, a control that is absent for one user and present for another with a trace explaining why, a second window that updates through the stream, and a verifier result that names a sequence number. The domain has money, so stakes are obvious without explanation. The workflow is a real state machine, so each click is a transition someone can inspect.

### The sophisticated capability

The centrepiece is one mechanism: **every state change is a single database transaction that updates the business projection, appends a hash-chained ledger event with a gap-free per-tenant sequence number, and enqueues asynchronous work through a transactional outbox.** The same ledger is the audit trail, the real-time event stream that feeds every open screen, and the input to integrity verification. The audience sees one commit produce all of those consequences, and sees that they agree.

### Guard language

Workflow guards are written in a **restricted subset of CEL**: comparisons, boolean operators, membership tests, field access and the `has` macro over the declared variables. Functions, comprehensions and any other macro are rejected at publish. Guards are type-checked by the server at publish time. The browser does not evaluate guards. This is a deliberate limitation, stated in sections B and G.

---

## B. Capability inventory

Twelve capabilities are **demonstrated** on stage. Five are **supporting**: real and tested, shown in passing or in rehearsal only. Shallow features have been removed from the product rather than kept as filler.

| ID | Capability | Status | Technical significance | Interacts with |
|---|---|---|---|---|
| D1 | Tenant isolation by PostgreSQL row-level security: `ENABLE` and `FORCE` on every tenant table, `app.tenant_id` set per transaction with `SET LOCAL`, no `BYPASSRLS` on the application role | demonstrated | Isolation holds even if application code omits a tenant filter | Every capability; the Carla window |
| D2 | Authorization in three layers: role bindings (RBAC), the pinned workflow's restricted-subset CEL guard, and a non-overridable separation-of-duties rule. One `Decide()` function serves the API, the `permitted_actions` list and the stored trace | demonstrated | UI and server cannot disagree because the UI renders the server's decision | D3, D4, D12 |
| D3 | Budget reservation at submission: allocation row locked `FOR UPDATE`, availability checked under the lock, reservation written in the same commit; database `CHECK` as backstop | demonstrated | No oversell under concurrency; the rule holds even if application logic regresses | D5, D9, race moment |
| D4 | Versioned workflow definitions: published versions immutable (trigger-enforced), validated at publish (reachability, every step has an assignee role, guard type-checked against the subset), each request pinned to its version | demonstrated | Configuration changes never re-route in-flight requests; the audit trail states which rules applied | D2, D6 |
| D5 | Optimistic concurrency: mutations carry `If-Match` with the expected `version`; a stale decision returns `412` with current state | demonstrated | Two approvers cannot both succeed | D8 |
| D6 | Transactional outbox to SQS: business change, ledger event and outbox row commit together; a worker sends to SQS; consumers are idempotent | demonstrated | Asynchronous work is never lost, never duplicated, never run for a rolled-back change | D7, D8 |
| D7 | S3 artifacts with SHA-256 checksums, SSE-KMS, presigned download; ERP export batches written to S3 | demonstrated | Real object storage and checks; the artifact hash is in the ledger payload | D6, D9 |
| D8 | Real-time stream: WebSocket per session, `resume_from` cursor, `through` markers for filtered ranges, client-side gap detection, delivery from the ledger table | demonstrated | Every open screen converges to committed state; reconnects replay exactly what the viewer may see and advance over the rest | D2, D9 |
| D9 | Hash-chained ledger: each event's hash covers its payload hash, the previous hash and canonical metadata; appends serialised per tenant by locking the chain-head row last | demonstrated | Tamper evidence and gap-free ordering share one serialisation point | D8, D10 |
| D10 | Integrity verification as a read transaction naming its head, recorded by a separate write event; a failing check is a ledger event every session receives | demonstrated | Detection localises to the exact sequence number, the failing check, and the expected and stored hashes | D9, D8, D12 |
| D11 | Idempotent submissions: `Idempotency-Key` stored with a request fingerprint and the original response | demonstrated | Retries produce one request, one reservation, one event | D3 |
| D12 | Cross-session fan-out with per-viewer visibility, applied per event by `Decide()` | demonstrated | The real-time channel cannot leak what REST withholds | D1, D2, D8 |
| S1 | OIDC with PKCE; token validation against cached JWKS with key rotation; claims normalised to an internal `Principal` | supporting | Identity provider differences sit behind one adapter | D1, D2 |
| S2 | OpenTelemetry tracing across API, database, SQS and worker; trace identifier in the UI footer and in ledger events | supporting | Follow one click across processes | D6, D9 |
| S3 | Liveness and readiness endpoints; readiness checks writer, SQS, S3 and the key cache | supporting | Load balancer and rehearsal depend on it | Reset, rehearsal |
| S4 | One-command reset and seed: deterministic UUIDv5 identifiers, fixed timestamps, one transaction per tenant | supporting | Identical starting state for every rehearsal | All |
| S5 | Automated browser rehearsal (Playwright) driving the windows through section C and asserting each visible result | supporting | The demo is a test suite, run before each showing | All |
| S6 | Anchor writes to an S3 Object Lock bucket at fixed sequence intervals and at drill confirmation | supporting | Detects a full rewrite of the chain tail; not part of the on-stage path | D9, D10 |
| S7 | Workflow authoring screen (edit draft, validate, publish a new version) | supporting, rehearsal only | Demonstrates D4 publish validation; the editor itself is conventional | D4 |

Removed from the product: vendor screening rules, budget dashboards and utilisation charts beyond the budget card on the request page, and CSV import of allocations. Each was shallow and none served an invariant the demo claims.

### How the capabilities compose

A single submission exercises D11 (idempotency record), D1 (transaction scoped to the tenant), D2 (RBAC and guard), D3 (allocation lock and availability check), D4 (version pinned), D9 (event appended with the next sequence number), D6 (outbox row for the packet job), D8 (commit notification, fan-out after per-event visibility) and S2 (trace identifier). Each is a consequence of one commit and is visible to the audience in a different window.

---

## C. Five-minute live script

The script is one continuous session. S4 resets state before the talk. The presenter does not type. Forms are pre-filled from the seeded scenario "Server refresh, Q4". Every step is a click.

The demo runs on the **AWS staging stack** (see E). It uses the production image digests and CDK stacks, and it contains the drill-runner task. Production does not contain that task, and the integrity drill is not claimed for production. The drill page states this, and states that the step-up is a Cognito TOTP challenge on staging and a simulated second connector on the local stack.

Budget seed: ENG-INFRA allocated 400,000, encumbered 240,000, spent 60,000 (minor units, shown as whole euros), so available is 100,000.

### Sequence reconciliation

The Halvard seed is exactly **1,830 events** (seq 1 to 1,830), fixed by S4. Seq 1,612 is the seeded `request.approved` event for REQ-0412, which the drill targets. Demo events are indexed from 1,831. Asynchronous events (packet and ERP artifacts) are appended by the worker at times that depend on scheduling, so they are shown at their observed position. The run sheet records every observed number, and the rehearsal asserts that each number equals the formula below with the observed asynchronous events removed.

| Index | Event | Actor | Formula or observed |
|---|---|---|---|
| 1,831 | `request.submitted` HF-2291 | Maya | Formula: 1,830 + 1 |
| 1,832 | `step.approved` step 1 | Dev | Formula: previous + 1 |
| 1,833 | `request.routed` to step 2 | Dev | Formula: previous + 1 |
| – | `artifact.created` packet (async) | worker | Observed |
| – | `request.submitted` HF-2292 and `request.rejected` HF-2293 | race | Next two commits after the approval, interleaved with any async event; observed |
| – | `step.approved` step 2, `request.approved`, `artifact.created` ERP | Ines, worker | Observed |
| – | `integrity.checked` (first verify) | Tom | Observed; head H is the count read at snapshot |
| – | `drill.requested`, `drill.confirmed` | Ines, Dev | Observed |
| – | `drill.executed` | drill-runner | Observed, after the tamper |
| – | `integrity.broken` (second verify) | Tom | Observed |

Budget arithmetic: Maya's 48,000 leaves 52,000 available (encumbered 288,000). The race pair is 35,000 and 35,000 against 52,000: the first commit reserves (encumbered 323,000, available 17,000); the second is refused because 35,000 exceeds 17,000. Request numbers come from the allocation counter, so HF-2291 precedes HF-2292 and HF-2293 regardless of which session arrived first.

| Time | Presenter action | Expected behaviour | Visible result | Capabilities | Transition |
|---|---|---|---|---|---|
| 0–20 s | Shows four Halvard windows (Maya, Dev, Ines, Tom). Says one sentence: "Two tenants, one database, three invariants on this screen." The header lists them: money is reserved once, nobody approves their own request, recorded history cannot change without the verifier naming it. | All four show the ENG-INFRA budget card with identical numbers. Each header shows the stream cursor, which matches across windows. | Four identical cards; matching cursors. | S1, D12, D8 | Clicks the Carla tab |
| 20–30 s | Carla's window: pastes the Halvard request URL copied from Maya's window. | Server returns the same `404` body it returns for a random identifier. | "Request not found." | D1, D12 | Returns to Maya |
| 30–40 s | Maya opens the pre-filled form (48,000, ENG-INFRA, 14 line items) and clicks **Submit**. | One transaction: idempotency record, RBAC and guard, allocation lock, availability check, request row pinned to `capex-standard` v3, event 1,831, outbox row. | HF-2291 **Submitted**; card: encumbered 288,000, available 52,000. | D11, D2, D3, D4, D9, D6 | Stream carries the event |
| 40–55 s | Points at the header: "Workflow v3, pinned at submission." | Header shows the pinned version, the route (above 25,000 needs Budget Owner then Finance Controller) and sequence 1,831 with the trace identifier. | Two-step route; seq 1,831. | D4, D9, S2 | Clicks Dev's window |
| 55–65 s | Dev's inbox already contains HF-2291, pushed. | The `request.submitted` event arrives on Dev's stream after the viewer check. | Row "HF-2291, 48,000, Maya Lindqvist" with a new-item marker. | D8, D12, D2 | Opens the row |
| 65–85 s | Dev reads the line items and clicks **Explain** on the enabled **Approve** control. | Explain calls `Decide()` and writes a `decisions` row (action `explain`, rule results, policy version, input hash). The trace renders that stored row. No ledger event. | Five green rows and one grey row "not applicable: requester is not the approver". | D2, D4, D9 | Clicks Maya's window |
| 85–95 s | Maya's request page. The **Approve** control is absent. Maya clicks **Explain** on the action bar for Approve. | Explain stores a row with outcome denied and rule `sod.requester_approver`, workflow v3. | Red row: "Requester may not decide own request (rule sod.requester_approver, workflow v3)". | D2, D9 | Clicks Dev's window |
| 95–120 s | Dev clicks **Approve** with reason "Within Q4 refresh plan". | `If-Match: version 2` checked under lock; step 1 approved (event 1,832); step 2 opened and `request.routed` appended (1,833); packet job in the outbox, same commit. | Dev's inbox empties. Maya sees "Awaiting Finance Controller". Ines's inbox gains HF-2291 through the stream. | D5, D2, D9, D6, D8 | Opens Ines's window |
| 120–140 s | Presenter arranges Maya's window, Ines's window and the control panel side by side. Clicks **Race** on the control panel. The panel submits two requests of 35,000 against ENG-INFRA, from Maya's session and Priya's control-panel session, released together. | Two `POST`s run in separate HTTP/2 connections. The database serialises on the allocation row. The first to take the lock reserves 35,000 (available 17,000) and gets the lower request number. The second is recorded as rejected with `409 insufficient_budget`, available 17,000 at decision time. Both appear in the ledger. | Panel has two columns. Arrival (server request log): which request arrived first. Commit (ledger): HF-2292 **Submitted** and HF-2293 **Rejected**, in commit order. Card: encumbered 323,000, available 17,000. | D3, D9, D8, D5 | Opens Ines's window |
| 140–160 s | Ines opens HF-2291 at step 2 and clicks **Approve** with reason "Q4 plan, budget owner confirmed". | Step 2 approved; request **Approved**; ERP export job in the same commit. The worker writes the batch to S3 with a SHA-256 checksum and appends `artifact.created` with that hash. | HF-2291 **Approved**. Notice on all four windows: "ERP batch written, sha256 3f9a…c1e0", seq as observed. If the job is late, the notice shows "pending" and the presenter moves on. | D5, D6, D7, D8, D9 | Opens Tom's window |
| 160–185 s | Tom opens the **Ledger** view and points at the live list: sequence, type, actor, first eight characters of the event hash and of its predecessor's. | The ledger list reads from the reader endpoint and shows the new events at the top, with a replica-lag indicator. The type filter "approvals" is one click. | Scrolling list with visibly linked hash prefixes. | D9, D12, D2 | Clicks **Verify chain** |
| 185–215 s | Tom clicks **Verify chain**. | Read transaction, `REPEATABLE READ`, read-only, on the writer, naming head H. It checks every event. Progress streams per 100 events. Then a separate short write appends `integrity.checked` with `checked_through = H`. | Progress completes. Card: "N events verified, chain intact, head H, hash 9c1e…7a2b", N read from the snapshot. The card appears on Maya's, Dev's and Ines's windows because the result is an event. | D10, D9, D8, D12 | Presenter moves to the drill |
| 215–245 s | Ines clicks **Start integrity drill**. A step-up prompt appears; she confirms it. Dev's window shows the confirmation prompt; Dev confirms with his step-up. Tom's window has no drill control. | Two writes: `drill.requested` (Ines), `drill.confirmed` (Dev), each with a step-up. The drill declares its target: seq 1,612, payload field `amount_minor` 960,000 to 480,000. The confirmation enqueues `drill.execute`. The drill-runner, a separate task holding the forensics role, runs one transaction: it disables the immutability trigger for that statement, updates the stored payload of seq 1,612, re-enables the trigger and commits. It writes no ledger event. The worker then appends `drill.executed` with the runner's report. | Ines's and Dev's panels show "Drill completed". The target is not shown. Step-up labels read "Cognito TOTP (staging)" on the staging stack, and "step-up simulated (local stack)" on the local stack. | D10, D2, D9 | Presenter clicks **Verify chain** again |
| 245–275 s | Tom clicks **Verify chain** again. | The snapshot head H covers the drill events. Seq 1,612's payload check fails: recomputed payload hash differs from the stored payload hash. Verification stops at 1,612 and reports that check. Events after 1,612 are listed as recorded but unverified. | Card turns red: "Chain broken at sequence 1,612 (tenant Halvard). Failed check: payload hash. Recomputed 5be0…; stored 91fa…. Event 1,612 is request.approved for REQ-0412." Below it, "Recorded after the break, not verified: drill.requested (seq A), drill.confirmed (seq A+1), drill.executed (seq A+2)." | D10, D9, D12 | Presenter draws attention to other windows |
| 275–300 s | Presenter points at Maya's, Dev's and Ines's windows. | The verifier's `integrity.broken` event is pushed on the stream. Every Halvard session shows a red banner naming sequence 1,612 and the drill's three events. The banner's trace identifier opens the verifier trace, which shows the single SQL statement that found the mismatch. | Banner on four windows. | D10, D12, D8, S2 | End |

Timing notes. The first 30 seconds establish purpose through the header and four windows, with Carla's 404 as the first proof. The final 30 seconds deliver the strongest moment: a dual-controlled act, recorded in the chain before it happens, changes stored history from a separate process, and the verifier reports the exact sequence number to every connected session. The drill's explanation records authorisation; it does not make the break disappear, and the presenter says so.

Latency statements in the script ("the banner appears within the same second") are design targets, to be measured in rehearsal and reported as measured values. They are not claims until measured.

---

## D. Technical architecture

### Components

| Component | Language and framework | Responsibility |
|---|---|---|
| `ledgerwell-app` (one image) | Go 1.23, `chi`, `pgx/v5`, `sqlc`, `oapi-codegen` from OpenAPI 3.1, `cel-go` restricted to the subset | Subcommands: `api` (REST, stream, verification), `worker` (outbox relay, consumers, anchor writes), `migrate` (golang-migrate, owner role), `ctl` (seed, reset, readiness), `drill-runner` (forensics role only) |
| `ledgerwell-web` (one image) | TypeScript, React 18, Vite, TanStack Query, client generated from the OpenAPI document, hand-written WebSocket client with cursor tracking | Single-page application; static asset tree served from nginx locally and copied to S3 and CloudFront on AWS |
| Rehearsal harness | TypeScript, Playwright | Drives the windows through section C and asserts each visible result |

Why Go: one static binary per subcommand, small images, first-class `pgx` support for `LISTEN/NOTIFY` and `COPY`, a mature AWS SDK v2, and simple concurrency for the verifier and the outbox relay. Why React: the design needs a mature component ecosystem. The frontend shares no code with the server except generated types.

No microservices. One application image, one database, one SPA. The API and the worker are two subcommands of one binary, and the drill-runner is a third subcommand whose task role alone holds forensics credentials.

### Persistence model

All tenant tables carry `tenant_id uuid not null`, have RLS enabled and forced, and have one policy:

```sql
USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
```

An unset or empty setting yields NULL, which matches no row and fails `WITH CHECK`. The prose and the policy say the same thing, and F1 tests both cases.

Roles: `ledgerwell_app` (no `BYPASSRLS`, no `SUPERUSER`, no `UPDATE` or `DELETE` on `ledger_events`); `ledgerwell_owner` (migrations only); `ledgerwell_forensics` (granted only to the drill-runner task; `UPDATE` on `ledger_events` and permission to disable the immutability trigger). Migrations add policies first and enable `FORCE` last, in the same deployment as the code that relies on them.

Key tables:

```sql
tenants(id uuid pk, slug text unique, name text, status text, config jsonb)

principals(id uuid pk, tenant_id uuid, subject text, email text, display_name text,
           unique (tenant_id, subject))

role_bindings(tenant_id uuid, principal_id uuid, role text, cost_center_id uuid null,
              primary key (tenant_id, principal_id, role, cost_center_id))

cost_centers(id uuid pk, tenant_id uuid, code text, name text, currency char(3),
             unique (tenant_id, code))

budget_allocations(id uuid pk, tenant_id uuid, cost_center_id uuid, period text,
                   allocated_minor bigint, encumbered_minor bigint, spent_minor bigint,
                   request_counter int, version int,
                   check (encumbered_minor >= 0 and spent_minor >= 0),
                   check (encumbered_minor + spent_minor <= allocated_minor))

workflow_definitions(id uuid pk, tenant_id uuid, key text, version int, status text,
                     body jsonb, checksum bytea, published_at timestamptz,
                     unique (tenant_id, key, version))
-- trigger: UPDATE or DELETE rejected once status = 'published'

purchase_requests(id uuid pk, tenant_id uuid, number text, requester_id uuid,
                  cost_center_id uuid, amount_minor bigint, currency char(3),
                  state text, workflow_key text, workflow_version int,
                  reserved_minor bigint, version int, created_at timestamptz,
                  updated_at timestamptz, unique (tenant_id, number))

approval_steps(id uuid pk, tenant_id uuid, request_id uuid, ordinal int,
               role_required text, status text, decided_by uuid null,
               decided_at timestamptz null, reason text null)

chain_heads(tenant_id uuid pk, next_seq bigint, head_hash bytea)

ledger_events(tenant_id uuid, seq bigint, id uuid, type text, aggregate_id uuid,
              actor_id uuid null, payload jsonb, payload_hash bytea, prev_hash bytea,
              hash bytea, trace_id text, occurred_at timestamptz(3),
              primary key (tenant_id, seq))
-- trigger rejects UPDATE and DELETE for all roles except the drill-runner's
-- statement-scoped trigger disable

outbox(id bigserial pk, tenant_id uuid, kind text, payload jsonb, created_at timestamptz,
       sent_at timestamptz null, attempts int)

idempotency_keys(tenant_id uuid, key text, fingerprint bytea, response jsonb,
                 primary key (tenant_id, key))

decisions(id uuid pk, tenant_id uuid, request_id uuid null, action text, principal_id uuid,
          workflow_version int, rule_results jsonb, input_hash bytea, outcome text,
          created_at timestamptz)

artifacts(id uuid pk, tenant_id uuid, request_id uuid null, s3_key text, sha256 bytea,
          kind text, created_at timestamptz)
```

`ops_log` is removed. Drill evidence is in `ledger_events` (see Drill below).

### Ledger hash encoding

Specified byte for byte, because verification must reproduce hashes across Go, the test-vector suite and deployments:

- **Payload.** Allowed payload values are objects, arrays, strings, booleans, null and integers within int64. Floats and duplicate keys are rejected at append. `payload_hash = SHA-256(JCS(payload))`, where JCS is RFC 8785.
- **Metadata.** `meta = JCS({"actor_id": <uuid string or null>, "aggregate_id": <uuid string>, "occurred_at": <string>, "seq": <integer>, "type": <string>})`. `occurred_at` is the UTC instant formatted as `YYYY-MM-DDTHH:MM:SS.sssZ` (exactly three fractional digits). The column is `timestamptz(3)`, so the stored value and the hashed value are the same instant. No finer precision is stored or hashed.
- **Event hash.** `hash = SHA-256(0x01 || prev_hash || payload_hash || meta)`, where `prev_hash` and `payload_hash` are 32 bytes each. For seq 1, `prev_hash` is 32 zero bytes. The fixed-length fields make the concatenation unambiguous.
- **Vectors.** A shared file of test vectors covers payloads with nested objects, unicode strings, null actor identifiers and the millisecond boundary. The Go and TypeScript implementations both verify it.

### Lock order

One global order for every transaction that takes more than one lock:

1. `budget_allocations` rows, in ascending `id`.
2. `purchase_requests` rows, in ascending `id`.
3. `approval_steps` rows.
4. `chain_heads` row for the tenant, always last and held to commit.

Consequences. Submit takes (1) and inserts new request rows, which take no existing lock, then (4). Reject takes (1) to release encumbrance, then (2), then (4). Approve takes (2), (3), (4) and reads the budget without any lock, under read-committed snapshot. Guard evaluation never acquires a lock. Verification takes no lock during its read transaction; its write takes only (4). The drill-runner takes no chain lock, by design; it is the out-of-protocol act that the verifier detects. A deadlock test runs submit and approve against the same cost center in both orders, and the rehearsal suite runs it.

### Budget lifecycle

- **Submission.** If `amount ≤ available` (allocated minus encumbered minus spent, read under the allocation lock), the request reserves `amount`: `encumbered += amount`, `reserved_minor = amount`. Otherwise the request row is written in state `rejected` with `reserved_minor = 0`, and the decision is recorded. Both outcomes commit.
- **Approval.** Approval does not change budget values. A final approval leaves the reservation in place as a commitment.
- **Rejection or withdrawal.** Releases the reservation: `encumbered -= reserved_minor`, `reserved_minor = 0`, under the allocation lock.
- **Spent.** No conversion to spent occurs in this product; there is no invoicing. This is stated and not demonstrated.
- The database `CHECK` is a backstop. A test runs a direct SQL update that would breach it and asserts the statement fails.

### Budget reservation and request numbers

Request numbers come from `budget_allocations.request_counter`, incremented under the allocation lock. Numbers therefore follow lock acquisition order, which is commit order for submissions against one cost center. The race panel uses this ordering for its commit column.

### Communication

- **Synchronous.** HTTPS JSON REST under `/v1`, contract-first from OpenAPI. Submissions require `Idempotency-Key`. Decisions and edits require `If-Match`. Every request response carries `permitted_actions`, computed by `Decide()` for the caller at the time of the response.
- **Asynchronous.** The worker polls `outbox` with `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 50`, sends to SQS (`ledgerwell-jobs`, standard queue with DLQ), and marks the row sent after a successful `SendMessage`. Consumers record processed job keys in `idempotency_keys` under a job namespace. Jobs: `packet.generate`, `erp.export`, `anchor.write`, `drill.execute`. `drill.execute` is consumed only by the drill-runner task.
- **Real-time.** WebSocket at `/v1/stream`. The client sends an authentication frame with the access token (never in the query string), then `{subscribe: {tenants: current, resume_from: seq}}`, where `resume_from` is the last ledger sequence number the client has processed, whether it was an event it received or a `through` marker. The server reads `ledger_events where tenant_id = $1 and seq > $cursor` in order. For each event it calls `Decide()` with the viewer's principal. Visible events are sent with their sequence numbers. Runs of invisible events are covered by `{"through": N}` frames, sent at the end of each batch and at least every 100 invisible events. A `through` frame carries no content, no type and no count. Notification via `LISTEN ledger_<shard>` is a wakeup only, issued by `NOTIFY` in the same transaction as the insert; a 1-second polling fallback guards against lost notifications.
- **Visibility rules.** `request.*`, `step.*` and `artifact.*` events are visible when `Decide(read, request)` allows. `budget.*` events follow RBAC on the cost center. `integrity.*` and `drill.*` events are visible to all principals of the tenant, so the banner reaches every Halvard session. Visibility is per event and all-or-nothing; no event is partially redacted.

Why `LISTEN/NOTIFY` and not a broker: the ledger table is already the ordered, durable event log. A broker would add a second ordering authority and a dual-write problem.

### Authorization

Authentication: OIDC authorization-code with PKCE. Access tokens are 15-minute JWTs validated for issuer, audience, expiry and signature against JWKS cached by `kid`, with a refresh of the key set on an unknown `kid`, and with `alg: none` and algorithm changes refused. Claims are normalised into a `Principal` (`tenant_id`, `subject`, `principal_id`) by one adapter with two implementations (Cognito and Dex). The tenant is cross-checked against the URL slug and then used to set `app.tenant_id`.

`Decide(principal, action, resource, context)`, a pure function over the pinned workflow version, role bindings and the request state:

1. **RBAC gate.** A role binding in this tenant covers this action on this resource type, scoped to the cost center if the binding is scoped.
2. **Workflow guard.** The current step's guard from the pinned version, in the restricted subset, over `principal`, `request`, `step`, `budget` and `vendor`. Budget is read without a lock.
3. **Separation of duties.** Built in and not overridable: a principal may not decide any step of a request they raised, and may not decide two consecutive steps of one request.
4. **Visibility.** RBAC read grant and, for requesters, `request.requester_id = principal_id`.

Each `Decide()` call that backs a mutation, a denial or an explain request writes a `decisions` row. Mutations and denials also write a ledger event. Explain writes a `decisions` row only. The trace panel renders the stored row, identified by its id. Interface controls are rendered from `permitted_actions`, which is the same function's output at response time, not from a browser evaluation.

Drill authorization: `drill.requested` requires a Finance Controller binding; `drill.confirmed` requires a Budget Owner binding on the same cost center; the two principals must differ; both require a step-up in the session.

Data-layer enforcement: RLS is the last line. A query from tenant B's context cannot read or write tenant A's rows, tested directly (F1).

Secrets and keys: database credentials from Secrets Manager with rotation; KMS customer-managed keys for Aurora, S3 and SQS; no long-lived keys in task definitions. The drill-runner's forensics credential is in a Secrets Manager entry readable only by its task role.

### Consistency requirements

| Operation | Consistency requirement | Mechanism |
|---|---|---|
| Submit | Atomic: idempotency record, reservation or rejection, request row, event, outbox row all commit or none do | One transaction; allocation lock first; chain head last |
| Retry of submit (same key) | Exactly one request and one reservation | Idempotency row checked in the transaction; a concurrent retry blocks on the unique key and then reads the stored response; fingerprint mismatch returns `422` |
| Approve or reject a step | Serialised per request; stale client loses | Request row locked; `If-Match` checked under the lock; loser receives `412` with current state |
| Budget reservation | No oversell under any concurrency | Allocation lock; availability check under lock; `CHECK` backstop; race and deadlock tests (F2) |
| Ledger append | Gap-free, totally ordered per tenant, chain intact | Chain-head row locked last and held to commit; `next_seq` and `prev_hash` read under the lock |
| Stream delivery | Each connected session receives every event it may read, in order, once; `through` markers cover the rest; no unreadable content delivered | Cursor replay from the ledger table; per-event `Decide()`; client-side contiguity check |
| Projection reads | Read-your-writes for the acting session; other sessions update from the stream | Reads from the writer for the acting principal; other sessions update from events |
| Ledger list for auditors | Read-committed, may lag by replica delay; display only | Reader endpoint with a lag indicator |
| Integrity verification | Consistent snapshot named by head H | `REPEATABLE READ`, read-only transaction on the writer; separate write appends the result with `checked_through = H` |
| Outbox to SQS | At-least-once from the relay; effectively-once through consumer idempotency | Mark-sent after SQS acknowledgement; consumer job key check |
| Anchor write | Head at a sealed sequence written to Object Lock | Worker job after commit; key includes tenant and sequence |

Note on sequence allocation. A PostgreSQL `SEQUENCE` would be cheaper, but it allocates numbers at call time and so produces gaps and out-of-order commits for concurrent writers, which breaks cursor replay. The chain-head lock is the deliberate choice; its cost is that writes to one tenant serialise (G).

### Verification

1. **Read.** `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` on the writer. Read H = max `seq` for the tenant, then read rows `seq ≤ H` in order.
2. For each `seq` from 1 to H, check in this order and stop at the first failure:
   - (a) `payload_hash == SHA-256(JCS(payload))`;
   - (b) `hash == SHA-256(0x01 || prev_hash || payload_hash || meta)`, using stored values;
   - (c) `prev_hash` equals the stored `hash` of `seq - 1` (zero bytes for seq 1);
   - (d) `seq` is contiguous.
3. **Write.** A separate transaction locks the chain head, appends `integrity.checked` with `{checked_through: H, result: "intact"}` or `integrity.broken` with `{checked_through: H, seq, failed_check, recomputed, stored}`, and commits.

A payload-only edit fails check (a) at its sequence and passes (b) and (c) at the next sequence, because stored hashes are unchanged. The verifier reports the first failure and does not report the next link as failing.

### Anchors

Anchor writes are supporting, not part of the five-minute path. At every 500th sequence number and at each `drill.confirmed`, the worker writes an object to `ledgerwell-anchors` (Object Lock, compliance mode) with key `tenant/<id>/seq/<n>` and body `{seq, hash}`. The anchor detects a rewrite of the chain tail: if a forensics actor recomputes hashes from sequence 1,612 onward, the stored hash at the sealed sequence no longer matches the anchor. A payload-only edit leaves all hashes unchanged and is detected by check (a), not by anchors. The two mechanisms are stated separately everywhere.

### Drill

Protocol:

1. Ines requests the drill: `drill.requested` is appended with `{drill_id, target_seq: 1612, field: "amount_minor", from: 960000, to: 480000}`.
2. Dev confirms: `drill.confirmed` is appended with the same `drill_id`, and `drill.execute` is enqueued in the same commit.
3. The drill-runner consumes the job. In one transaction it disables the immutability trigger for that statement, runs `UPDATE ledger_events SET payload = jsonb_set(...) WHERE tenant_id = $t AND seq = 1612 AND payload->>'amount_minor' = '960000'`, re-enables the trigger and commits. The `WHERE` makes it idempotent. It returns `{drill_id, rows_changed}` to the worker by SQS.
4. The worker appends `drill.executed` with the runner's report. If the runner fails, its transaction rolls back, no tamper happens, and `drill.executed` records `rows_changed = 0` and the error; the UI shows the drill as failed, not completed.

The runner writes nothing to the ledger during the tamper. The break is still reported by the verifier, and the drill's three events explain its origin. A missing `drill.executed` after an actual tamper would leave the break unexplained; that is the correct failure mode, and it is tested.

Where it runs: staging only. Production has no `drill-runner` task and no forensics role.

---

## E. AWS and local deployment

### Container-first and immutable

Two images are built once in CI: `ledgerwell-app` (all subcommands, process chosen by argument) and `ledgerwell-web` (static asset tree plus nginx configuration). Each is pushed to ECR, tagged with the commit and referenced by digest. The same digests are used in the AWS task definitions and in the local compose file. Nothing is rebuilt for an environment.

Runtime configuration comes only from environment variables and, in AWS, from Secrets Manager and SSM. The web image reads `/config.json` at runtime. The app image contains no environment-specific values.

### Environments

- **Local.** The compose file runs the same two images with Dex, ElasticMQ, MinIO with object lock, PostgreSQL 16 and nginx. The drill-runner is a compose service with its own forensics credential.
- **AWS staging.** The full CDK stack set at the staging configuration. The five-minute demo runs here. It carries the drill-runner task and role.
- **AWS production.** The same stacks and digests, without the drill-runner task or the forensics role. The drill is not run in production.

The conformance suite (F) runs the same assertions against local and staging. An environment that fails it is not eligible to host the demo.

### Artifacts and the web asset path

The AWS deployment copies the static asset tree from the `ledgerwell-web` image into the private S3 bucket behind CloudFront. The deployment records the manifest digest of that tree. CI asserts the local nginx and the S3 deployment serve trees with equal manifest digests. The container differs; the bytes do not.

### Identity

Cognito user pool with Halvard and Corvane app clients and a pre-token-generation Lambda trigger, listed in the `identity` stack. The trigger writes `tenant_id` and `principal_id` into the access token, because the API validates access tokens and the default custom claim appears only in the ID token. TOTP MFA is required for the Finance Controller and Budget Owner roles. Staging uses fixed demo TOTP seeds stored in Secrets Manager; these are demo-only and are not used in production.

Dex locally: the same claim names via connector mapping. Dex has no MFA, so the local step-up is a second connector challenge, and the screen labels it as simulated.

### Service mapping

| Concern | AWS service | Local stand-in | Difference | Why behaviour is unchanged |
|---|---|---|---|---|
| Relational store | Aurora PostgreSQL 16 | PostgreSQL 16 | Failover and storage behaviour not reproduced locally | No Aurora-specific SQL. RLS, `LISTEN/NOTIFY`, row locks and `CHECK` are standard. The conformance suite runs on both. |
| Pooling | RDS Proxy | None | No pooler locally | One pool configuration; the stream path bypasses the proxy on both |
| Identity | Cognito with TOTP and pre-token trigger | Dex with connector claim mapping | No MFA in Dex; step-up simulated | The adapter produces the same `Principal`. Staging is the environment where the dual-control step-up is real. |
| Job queue | SQS standard and DLQ | ElasticMQ | Subset of SQS features used here | The worker uses the AWS SDK v2 client with an endpoint override; visibility and receive-count behaviour are tested on both |
| Object storage | S3 with SSE-KMS and Object Lock | MinIO with object lock | Local volume encryption instead of KMS | Checksums and presigned URLs identical; same code path |
| Static hosting | CloudFront with OAC and WAF | nginx serving the same asset manifest | No WAF or CDN locally | Cache headers match; WAF is outside application behaviour |
| Load balancing | ALB with WebSocket | Direct to API through nginx | Idle timeout and health-check semantics | Client ping below the ALB idle timeout in both |
| Secrets | Secrets Manager, KMS | Git-ignored env file | No rotation locally | One secret-provider interface |
| Tracing | X-Ray through ADOT | OpenTelemetry collector to Jaeger | Exporter | Same OTLP instrumentation |
| Compute | ECS Fargate | Compose services | No scaling locally | Same image, environment contract and health checks |

### What differs and why it is acceptable

Documented in `deploy/PARITY.md`, which the rehearsal and conformance suite reference:

1. **MFA.** Cognito enforces TOTP; Dex does not. Staging performs the real step-up. The local stack labels it simulated, and no claim of identical security is made for the local climax.
2. **Failover.** Aurora failover is not reproduced locally. The application reconnects and resumes from its cursor; failover is exercised in staging, not on stage.
3. **Object Lock and KMS.** Enforced by AWS in staging and production, and by MinIO locally. Retention periods are equal.
4. **Drill role.** Present in local and staging, absent in production. Stated on the drill page.

### One-command operation

- `make up` (or `ledgerwell up`): starts the stack from pinned digests, runs migrations, seeds the demo tenants, waits for readiness.
- `ledgerwell-ctl reset-demo`: truncates tenant data per tenant in one transaction and re-seeds with deterministic UUIDv5 identifiers and fixed timestamps. It prints a post-reset state hash that the rehearsal checks before each run.
- `ledgerwell-ctl rehearse`: runs the Playwright script with the required browser contexts and asserts each visible result in section C.

---

## F. Five strongest technical claims

Each claim has an executable test against a real PostgreSQL instance (not a mock) and an observable behaviour on stage.

**F1. Tenant isolation holds below the application.**
*Claim:* a session bound to tenant B cannot read or write any row of tenant A through any statement the application role can issue.
*Test:* a catalogue test enumerates every table with `tenant_id` and asserts `relrowsecurity` and `relforcerowsecurity`. A second test connects as `ledgerwell_app` with `app.tenant_id` set to B and, for every tenant table, runs a predicate-free `SELECT`, an `UPDATE` and a `DELETE` targeting A's seeded rows, and an `INSERT` carrying A's identifier. Expected: zero rows returned, zero affected, insert rejected by policy. A third case runs with the setting unset and expects zero rows and a failed insert. The cases are generated from the catalogue, so a new table without a policy fails the build.
*Observable:* the Carla window's 404, identical to the body for a non-existent identifier.

**F2. The budget cannot be oversold, and concurrency cannot deadlock the workflow.**
*Claim:* for any interleaving of concurrent submissions against one allocation, the final encumbrance never exceeds the allocation; each rejected submission would have exceeded availability at its lock acquisition; the sum of accepted reservations equals the encumbrance delta.
*Test:* 200 concurrent submissions with random amounts from 64 goroutines against one allocation, on real PostgreSQL. Afterwards: `encumbered + spent <= allocated`; reservation sum equals the delta; one `request.submitted` or `request.rejected` event per attempt; a contiguous sequence; request numbers contiguous and in commit order. A deterministic case runs the seeded race pair (35,000 and 35,000 against 52,000) in both lock orders and asserts exactly one reservation and one rejection in each, with the assertion independent of which session arrives first. A deadlock test runs submit and approve against one cost center under both orders and asserts both complete.
*Observable:* the race in section C, 120–140 s, with the arrival and commit columns.

**F3. The ledger detects tampering at the exact sequence number, and the verifier explains what it found.**
*Claim:* any change to a stored payload, any deletion and any reordering inside a tenant's chain is reported at its first affected sequence number with the failing check; a full rewrite of the chain tail is caught by anchors.
*Test:* build a chain of 2,000 events with the production append path. For 500 random positions, change one byte of the stored payload with the forensics role and assert the verifier reports that sequence, check (a), and both hashes. Separately delete a row and swap two rows, and assert the same. A control run on an untouched chain asserts success. A rewrite test recomputes `payload_hash`, `hash` and every following link from sequence 1,612, and asserts that the verifier passes the chain and the anchor comparison at the sealed sequence fails. Encoding vectors in F3 cover the hash rules in section D.
*Observable:* the red card at 245–275 s, naming 1,612 and check (a).

**F4. Real-time delivery is gap-free and resumable, and each viewer sees exactly what REST shows.**
*Claim:* a session that disconnects at any point and reconnects with `resume_from` receives every event it may read, once, in order; every sequence number it cursor-passes is either an event it received or covered by a `through` marker; it never receives content it could not read through REST.
*Test:* three concurrent writers produce 10,000 events for a tenant. A client is forcibly disconnected at 50 random points and reconnects with its last processed sequence number. The client asserts: each event sequence number strictly increases; each gap is covered by a `through` frame; no duplicates after deduplication. A matrix of principals (roles by cost center, requester, auditor, foreign tenant) against events asserts that `REST visible(principal, event) == stream delivered(principal, event)`, and that `through` frames contain no event fields.
*Observable:* Dev's and Ines's inbox updates at 55–65 s and 95–120 s, and the banner at 275–300 s.

**F5. Interface controls cannot disagree with the server.**
*Claim:* every control the interface shows or hides is rendered from `permitted_actions`, which the server computed with the same `Decide()` that enforces the action; a denial returns `403` with the rule identifier stored in the `decisions` row.
*Test:* a generated matrix of roles, workflow states, step statuses and actions (several thousand combinations from the workflow definition and role catalogue) runs through `Decide()` as a table-driven test; the output is a golden file checked into the repository. A second test, against the running API, sends each combination's action and asserts: permitted actions succeed; non-permitted actions return `403` with the rule identifier that the stored explain row shows for the same inputs. A Playwright test over a sample of the matrix asserts that rendered controls equal `permitted_actions`.
*Observable:* the trace panels at 65–95 s, where Dev's enabled control and Maya's absent control are both explained by stored rows.

Supporting tests, not counted as the five: idempotency replay (retry returns the original response and one request), the outbox crash test (the worker is killed between `SendMessage` and mark-sent; the job is processed once), the drill runner's idempotency and failure-path tests, the lock-order test in F2, and the parity conformance suite in section E.

---

## G. Failure analysis

### Implementation difficulties

1. **Per-tenant chain-head serialisation.** Every write for one tenant takes the same final lock. Correct and simple, and the throughput ceiling for one tenant. Demo load does not approach it. Growth would shard the chain by cost center or period, which changes the verification unit. The `ledger_events` key includes `tenant_id` and `seq` so a `chain_key` column can be added without rewriting history.
2. **Stream visibility and cursors.** Filtering by `Decide()` creates invisible ranges. Covering them with `through` markers keeps the contiguity check honest, but the marker logic is subtle: it must advance only over sequence numbers the server has read contiguously under the chain order. F4 tests this under random disconnects.
3. **Canonical hashing across languages.** Hashes must match between Go and the browser verifier. The encoding in section D is specified, vectors are shared, floats are rejected, and timestamps are millisecond-precise.
4. **Permission cache per stream connection.** `Decide()` per event needs principal and binding lookups. The cache is per connection, invalidated on role-binding change events, and tested.
5. **RLS and pooling.** `SET LOCAL app.tenant_id` runs inside every transaction. Pool return resets it; a test reuses a connection across tenants and asserts no leakage. A missing `SET LOCAL` fails closed.
6. **Guard language.** The restricted subset is enforced at publish. Guards run on the server only. This removes the browser evaluator, but tenants cannot write arbitrary CEL. Accepted limitation.
7. **Drill runner.** Its tamper is one transaction and idempotent. Its failure leaves no tamper and an honest `drill.executed` record. A tamper without a `drill.executed` record is treated as an unexplained break, and the rehearsal tests that case.
8. **WebSocket behind the ALB.** Idle timeouts, connection draining on deployment and frame limits interact. Clients reconnect with their cursor. The rehearsal freeze window prevents deployments during the talk.

### On-stage failure modes and mitigations

| Failure | Effect on stage | Mitigation |
|---|---|---|
| Token expiry during the talk | Session shows login | Silent refresh with PKCE refresh tokens; sessions established before the talk; rehearsal asserts the refresh path |
| Stream disconnect | Windows stop updating | Automatic reconnect with cursor; header shows stream state; reset-and-resume is one click |
| Worker or SQS delay | Packet or ERP notice late | The state change is shown at once; the artifact notice is a separate event. The script says "pending" if late. The rehearsal records the measured 95th percentile and sets the presenter's threshold from it. No pre-generated artifact is shown in place of a live one. |
| Race request fails or arrives in an unexpected order | Panel shows an unexpected column order | The race is judged on invariants, which hold for every order. Arrival and commit columns are shown separately, so a different arrival order is visible and explained. A failed request is skipped; the race is not rerun mid-talk. |
| Writer failover in AWS | Writes fail briefly | Retries on connection errors with the same idempotency key; stream reconnects. Not run during the talk; checked in staging. |
| Verification slow on a long chain | Progress stalls | Seed is fixed at 1,830 Halvard events. Progress streams per 100 events. Long chains need the chain-key design (G1), which the demo does not need. |
| Browser sessions diverge | Windows show different state | Cursor shown in each header; rehearsal compares cursors before each section. |
| Drill fails midway | No tamper, verification green | The drill is one transaction. Failure rolls back and `drill.executed` records zero rows changed and the error. The panel shows "failed"; a failed drill is not shown as successful. |
| Drill tampers, worker crashes before `drill.executed` | Break with no explanation | Tested in rehearsal. The break is still reported. The presenter does not claim an explanation. |
| Step-up fails on staging | Confirmation blocked | Dual control stops the drill. The presenter does not start it; the drill page states the failure. |
| Demo data drift | Numbers differ from script | Deterministic seed; run sheet records observed numbers; rehearsal asserts the formula in section C. |

### Hidden complexity the audience will not see

- Reconnect semantics: a reconnecting session reconciles optimistic local state against replayed events.
- Every mutation and denial path writes exactly one ledger event with the right type and actor. Explain writes a decision row only. The rehearsal checks event counts against action counts.
- Migrations that add RLS policies ship with the code that relies on them, policies first, `FORCE` last.
- `occurred_at` is stored but not used for ordering; ordering is by `seq`. Clock skew cannot reorder the ledger.

### Features that look impressive but are technically shallow

- **The decision trace.** It presents stored evaluations. It is deep only because evaluations are stored at explain time and tested against the matrix (F5). A trace re-derived for display would be shallow.
- **The ERP export.** A JSON file in S3 with a SHA-256 checksum recorded in a ledger event. It is a real object and a real hash, not a posting to an ERP system. The script says "export batch", never "posted to ERP".
- **Workflow authoring (S7).** A form around a JSON document with validation. Publish-time validation and version pinning are real; the editor is conventional.
- **The budget card.** Standard arithmetic over one allocation row. Shown for context, not as a claim.

---

## H. Feasibility

Scope is expressed by what each component touches and by dependency order. Nothing here is a duration.

### Scope by component

| Component | What it touches | Scope |
|---|---|---|
| Schema, RLS, grants, triggers, migrations | Every tenant table; ledger immutability trigger; workflow publish trigger | One migration set and one catalogue test |
| Ledger append and verifier | `ledger_events`, `chain_heads`, the hash encoding, shared vectors | The most precision-sensitive code |
| `Decide()` and guard subset | Role bindings, workflow bodies, `decisions`, one Go evaluator, golden matrix | Large; the largest correctness surface, now single-language |
| Budget reservation and lifecycle | `budget_allocations`, request counter, submission and reject transactions | Small in code; heavy in tests (F2) |
| Workflow versioning and publish | `workflow_definitions`, guard type-check, reachability | Medium |
| Outbox relay, SQS consumers, S3 artifacts | `outbox`, SQS, S3, KMS, job idempotency | Medium; AWS SDK surface |
| Stream service and client | WebSocket, `LISTEN`, replay, `through` markers, per-connection cache, client cursor | Medium-large; reconnect logic is the subtle part |
| Drill runner and drill events | Forensics role, runner subcommand, three event types, dual-control checks | Small in code; depends on the ledger and the stream |
| REST API and OpenAPI | Handlers for submit, approve, reject, explain, list, verify, drill, ledger | Medium; generated client |
| Web application | Four primary screens (request with trace, inbox, ledger and verification, drill) plus Carla's isolation view and the race panel | Medium-large; visual polish is the largest share |
| Identity adapter | OIDC client, JWKS cache, pre-token trigger, Cognito and Dex configuration | Small-medium |
| Infrastructure | CDK stacks (`network`, `data`, `messaging-storage`, `identity`, `services-edge`), local compose, one config schema | Medium; repetitive shape |
| Rehearsal and conformance | Playwright script for section C, lock-order and deadlock tests, conformance for local and staging | Medium; this is what makes the demo reliable |

Moving parts: one application image with four subcommands (api, worker, migrate, ctl) plus the drill-runner subcommand, one SPA image, one database, two queues and buckets (jobs; artifacts and anchors), one identity provider, one set of CDK stacks.

### Dependency order

Each layer is runnable and testable before the next.

1. **Foundation.** Schema with RLS, migrations, seed, Principal adapter with Dex, catalogue test (F1). Runnable as a database plus an API with a health endpoint and one tenant-scoped read.
2. **Ledger core.** Append path, chain-head lock, hash encoding with vectors, verifier, immutability trigger (F3 without the drill and anchors). Runnable as a command-line verification of the seeded chain.
3. **Decisions.** `Decide()` with RBAC, guard subset with publish-time validation, separation of duties, stored decisions, `permitted_actions` in responses. Runnable through REST with an explain endpoint.
4. **Budget and submission.** Allocation lock, request counter, reservation or rejection, idempotency (F2, D11). Runnable through the API; the race and deadlock tests pass before any UI exists.
5. **Approvals and versions.** Step transitions, `If-Match`, pinned versions, publish flow. Runnable through the API.
6. **Stream.** Outbox relay, `LISTEN`, replay with `through` markers, per-event filtering (F4). Runnable with two scripted clients.
7. **Async jobs.** SQS consumers, packet generation, ERP export to S3, artifact events, anchors. Runnable with ElasticMQ and MinIO.
8. **Drill.** Drill events, dual-control checks, the drill-runner subcommand and its job. Depends on layers 2, 6 and 7.
9. **Web application.** Screens and trace panel against the stable contract. Each screen is runnable once its endpoints exist.
10. **Rehearsal and reset.** Seed determinism, Playwright script, conformance suite. Depends on everything above; it is the acceptance test.
11. **AWS staging deployment.** CDK stacks, Cognito with TOTP and pre-token trigger, ECS services, Aurora, SQS, S3 with Object Lock, WAF, asset-manifest check, staging conformance. It can begin after layer 1 and proceed alongside layers 2 to 7, since adapters sit behind interfaces. It must complete before the rehearsal runs on AWS.

Layers 2 to 8 are the critical path for the technical claims. Layer 9 is the critical path for visual impact. Layer 11 gates the AWS rehearsal and does not gate the local one.

### Critical dependencies

- PostgreSQL 16 behaviour for forced RLS, `LISTEN/NOTIFY`, row locks and `REPEATABLE READ` snapshots. Standard; the conformance suite covers Aurora specifically.
- Cognito pre-token-generation trigger writing `tenant_id` into the access token. Listed in the identity stack and tested in staging.
- ElasticMQ's coverage of the SQS features used. Verified by conformance against both targets.
- Object Lock behaviour in MinIO matching S3 compliance-mode semantics for the operations used.
- WebSocket support on the ALB with the chosen idle timeout and client ping.

### Main risks, by what they touch

1. **Stream correctness under reconnects (F4).** Touches replay, `through` markers and the client cursor. Control: randomised disconnects in the rehearsal suite, not only unit tests.
2. **Race and lock behaviour (F2).** Touches allocation locking, request counter and the lock order. Control: the deterministic pair in both lock orders and the deadlock test in the rehearsal suite.
3. **Hash canonicalisation across languages.** Control: shared vectors, floats rejected, millisecond timestamps.
4. **Staging-only drill.** Touches the forensics role and the staging configuration. Control: production has no runner; the drill page states it; the conformance suite asserts the absence of the runner in production configuration.
5. **Live visual polish.** Touches every screen. Control: one token system, a restrained palette, and the windows designed as one arrangement.
6. **Parity drift between local and AWS.** Control: the conformance suite gates the demo environment; `deploy/PARITY.md` lists every difference.
7. **Rehearsal flakiness.** Control: every step waits on an observable state (cursor, row count, banner) and never on a fixed delay.
8. **Scope creep.** Control: the shallow features are removed rather than deferred, and layers 1 to 8 are complete before any supporting screen is started.

### What is deliberately out of scope

Real ERP integration, payment rails, invoicing and spend conversion, vendor risk data, multi-region failover, tenant self-service signup, email delivery, browser-side policy evaluation, and any feature requiring a live third-party service in the demo path.

---

## Appendix: why this mandate, and what it sacrifices

The enterprise mandate favours invariants the audience can see the system enforce. It sacrifices breadth: no product catalogue, no customer portal, no mobile client, no reporting suite, and, after this revision, no vendor screening, no dashboards and no CSV import. It commits the team to one serialisation point per tenant and to a restricted guard language, both stated in section G. The bet is that a technically literate audience will forgive a narrow product and will not forgive a claim the demo cannot back up.
