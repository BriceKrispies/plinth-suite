# Competitor 03: Enterprise Platform

**Product title: Ledgerwell, multi-tenant spend control with tamper-evident approvals**

**Pitch.** Ledgerwell lets two companies share one deployed platform while every department request, budget reservation and approval is enforced by the database, audited in a hash chain and pushed live to every connected session. In five minutes an audience watches a $48,000 purchase be reserved, routed, approved, exported to an ERP file and then caught in a deliberate, dual-controlled tampering drill that the system detects and reports to every open screen.

Mandate: a design philosophy, not a separate goal. Every choice below serves the mission brief: a real AWS-deployed application that runs locally from the same container images, with five minutes of visible, substantiated system behaviour.

---

## A. Product concept

### What it is

Ledgerwell is a spend-approval and budget-control platform for mid-size companies with several legal entities or divisions. Employees raise purchase requests against a cost center. Each request reserves money from that cost center's budget the moment it is submitted, then moves through an approval workflow whose steps, thresholds and guard rules are authored per tenant. Every state change, denial and integrity check is appended to a tamper-evident ledger that auditors can verify independently.

It is deliberately an enterprise product rather than a dashboard. The value is in invariants that are enforced rather than displayed: money cannot be spent twice under concurrency, a requester cannot approve their own request, a tenant cannot read another tenant's rows even through a buggy query, and history cannot be silently edited.

### Tenants, users, sessions

Two tenants share one Aurora PostgreSQL cluster and one application deployment.

- **Halvard Freight Ltd** (the demo tenant). Cost centers include ENG-INFRA (Engineering Infrastructure), OPS-EU and FIN-SHARED.
- **Corvane Biosciences** (the isolation counterpart). Has its own cost centers, workflows and users. Its admin Carla is used only to show that Halvard data does not exist for her.

Stable demo identities, all seeded deterministically:

| Principal | Tenant | Role(s) | Used for |
|---|---|---|---|
| Maya Lindqvist | Halvard | Requester (ENG-INFRA) | Submits the hero request |
| Priya Anand | Halvard | Requester (ENG-INFRA) | Races Maya on the last budget |
| Dev Okafor | Halvard | Budget Owner (ENG-INFRA) | First approval step |
| Ines Duarte | Halvard | Finance Controller | Second step above threshold; dual control for the drill |
| Tom Reyes | Halvard | Internal Auditor (read-only) | Verifies and explains the audit chain |
| Carla Mendes | Corvane | Tenant Admin | Cross-tenant isolation moment |

Five browser windows are used in the talk: four on Halvard (Maya, Dev, Ines, Tom) and one on Corvane (Carla). Sessions are pre-established with OIDC authorization-code flow and PKCE; the presenter never logs in on stage.

### Problems solved, stated as the audience will recognise them

- Spend that was approved outside policy, or approved by the person who raised it.
- Budgets overspent because two requests were checked against the same balance at the same moment.
- Audit trails that can be edited by whoever has database access, with no way to prove otherwise.
- Tenants who need different approval rules without forking the product.
- Multi-tenant leakage through a single missing `WHERE` clause.

### Why it suits this demo

Each of these problems has an observable consequence on screen: a budget bar that refuses to overflow, a button that is absent for one user and present for another with a decision trace explaining why, a second window that updates within a second, a hash that breaks at a specific sequence number. The domain has money, so stakes are obvious to a first-time viewer without explanation. The workflow is a real state machine, so every click produces a state transition someone can inspect.

### The sophisticated capability

The technical centrepiece is one coherent mechanism rather than several features: **every state change is a single database transaction that updates the business projection, appends a hash-chained ledger event with a gap-free per-tenant sequence number, and enqueues any asynchronous work through a transactional outbox.** The same ledger is the audit trail, the real-time event stream that feeds every open screen, and the input to integrity verification. The demo makes the audience see that one commit produces all of those consequences, and that they agree.

---

## B. Capability inventory

Twelve capabilities are **demonstrated** on stage. Nine are **supporting**: they are real and tested, but they are shown only in passing or in rehearsal. Two of the supporting items are shallow by design and are called out in section G.

| ID | Capability | Status | Technical significance | Interacts with |
|---|---|---|---|---|
| D1 | Tenant isolation enforced by PostgreSQL row-level security (`FORCE` on every tenant table, `app.tenant_id` set per transaction with `SET LOCAL`) | demonstrated | Isolation holds even if application code omits a tenant filter. The application role has no `BYPASSRLS`. | Every other capability; the Corvane window and the isolation drill use it directly |
| D2 | Authorization in three layers: role bindings (RBAC), tenant-authored CEL guards (ABAC), and a non-overridable separation-of-duties rule | demonstrated | The approve button, the API handler and the decision trace all call one `Decide()` function with the same inputs, so UI and server cannot disagree | D3 (guards read budget state), D4 (guards come from the pinned workflow version), D12 (visibility filter reuses `Decide`) |
| D3 | Budget reservation at submission: `SELECT ... FOR UPDATE` on the cost-center allocation row, plus a database `CHECK (encumbered + spent <= allocated)` | demonstrated | Money cannot be oversold even under concurrent submissions; the database enforces the invariant independently of the code | D5 (idempotent retries), D9 (reservation is an audit event), race moment |
| D4 | Versioned workflow definitions: published versions are immutable (trigger-enforced), validated at publish (reachability, every step has an assignee role, CEL type-checked), and each request pins the version it started under | demonstrated | In-flight requests are never re-routed by a configuration change; the audit trail can state which rules applied | D2, D6 |
| D5 | Optimistic concurrency on requests: every mutation carries the expected `version` (HTTP `If-Match`), and a stale decision returns `412` with the current state | demonstrated | Two approvers acting on the same request cannot both succeed; the loser sees the winning decision | D8 (the loser's screen updates from the stream) |
| D6 | Transactional outbox to SQS: the business change, the ledger event and the outbox row commit together; a worker sends to SQS and processes with idempotency keys | demonstrated | Asynchronous work (approval packet, ERP export) is never lost and never duplicated, and never happens for a rolled-back change | D7, D8 |
| D7 | S3 artifacts with SHA-256 checksums, KMS encryption, and presigned download; ERP export batches written to S3 | demonstrated | Real object storage and real integrity checks on exported files | D6, D9 (artifact hash is in the ledger payload) |
| D8 | Real-time stream: WebSocket per session, `resume_from` sequence cursor, gap detection on the client, delivery from the same ledger table that is the audit trail | demonstrated | Every open screen converges to the committed state; reconnects replay exactly what was missed | D2 (visibility filter), D9 (same rows) |
| D9 | Hash-chained ledger: each event's hash covers its canonical payload and the previous event's hash; appends are serialised per tenant by locking a chain-head row | demonstrated | Tamper evidence and gap-free ordering come from the same serialisation point | D8, D10 |
| D10 | Integrity verification and a break-glass drill with dual control; a failing verification is itself a ledger event that every session receives | demonstrated | Detection is observable and localised to the exact sequence number, expected hash and stored hash | D9, D8, D12 |
| D11 | Idempotent submissions: `Idempotency-Key` header stored with a request fingerprint and the original response | demonstrated | Retries after a dropped connection produce one request, one reservation, one event | D3, D5 |
| D12 | Cross-session fan-out with per-viewer visibility filtering: a requester sees only their requests, an auditor sees the ledger, a Corvane session sees nothing from Halvard | demonstrated | The real-time channel cannot leak data that the REST API would withhold | D1, D2, D8 |
| S1 | OIDC login with PKCE, token validation against cached JWKS with key rotation, normalisation of claims into an internal `Principal` | supporting | Identity provider differences are isolated behind one adapter; the rest of the system sees one shape | D2, D1 |
| S2 | OpenTelemetry tracing across API, database, SQS and worker; the trace identifier appears in the UI footer and in ledger events | supporting | Lets an engineer follow one click across processes | D6, D9 |
| S3 | Liveness and readiness endpoints; readiness checks database writer, SQS, S3 and the signing-key cache | supporting | Load balancer and rehearsal both depend on it | Reset, rehearsal |
| S4 | One-command reset and seed: deterministic UUIDs and timestamps, single transaction per tenant | supporting | Identical starting state for every rehearsal | All |
| S5 | Automated browser rehearsal (Playwright) driving the five windows through the script and asserting every visible result | supporting | The demo is a test suite, run before each showing | All |
| S6 | Vendor-screening rules: deterministic, rule-based checks against a tenant-owned vendor list | supporting, shallow | Makes the workflow guard richer; no external service involved | D2, D4 |
| S7 | Budget dashboards and utilisation charts | supporting, shallow | Presentation only; shown for context, not as a claim | D3 |
| S8 | CSV import of cost-center allocations | supporting, shallow | Standard data entry; included for completeness | D3, D9 |
| S9 | Workflow authoring screen (edit a draft, validate, publish a new version) | supporting | Shown in rehearsal to demonstrate D4; not in the five-minute path | D4 |

### How the capabilities compose

The composition is the point. A single submission in the demo exercises D11 (idempotency key recorded), D1 (transaction scoped to the tenant), D2 (RBAC gate and CEL guard for submission), D3 (row lock and budget check), D4 (workflow version pinned), D9 (ledger event appended with the next sequence number and chained hash), D6 (outbox row for the packet job), D8 (commit notification via `LISTEN`, fan-out to Dev's and Ines's sessions after visibility checks) and S2 (trace id). Every one of these is a consequence of one commit and is visible to the audience in a different window.

---

## C. Five-minute live script

The script is a single continuous session. State is reset by S4 before the talk; the presenter does not type; forms are pre-filled from the seeded scenario "Server refresh, Q4"; every step is a click. The seeded budget for ENG-INFRA starts with allocated 400,000, encumbered 240,000 and spent 60,000 (currency minor units, shown as whole euros in the UI), so available is 100,000.

Budget arithmetic used throughout: Maya's request 48,000 leaves 52,000. The race pair is 35,000 and 35,000: the first reservation succeeds (available 17,000); the second is refused because 35,000 exceeds 17,000.

| Time | Presenter action | Expected behaviour | Visible result | Capabilities demonstrated | Transition |
|---|---|---|---|---|---|
| 0–20 s | Shows four tiled windows on Halvard (Maya, Dev, Ines, Tom). Says one sentence: "Two tenants, one database, three invariants on this screen." The header lists the invariants: money is reserved once, nobody approves their own request, history cannot be silently edited. | All four sessions show the ENG-INFRA budget page with identical numbers. Connection indicators are green and show the current stream cursor. | Four identical budget cards; cursor values match across windows. | S1 (sessions already authenticated), D12 (stream connected), D8 (cursor) | Presenter clicks the Corvane tab |
| 20–30 s | Switches to Carla's Corvane window. Pastes the Halvard request URL, copied in advance from Maya's window. | Server returns the same `404` body as for a random, non-existent identifier. No tenant name, no count, no timing difference beyond noise. | Corvane page reads "Request not found". | D1, D12 | Presenter returns to Maya |
| 30–40 s | Maya opens the pre-filled form for "Server refresh, Q4" (48,000, ENG-INFRA, 14 line items) and clicks **Submit**. | Submission carries an `Idempotency-Key`. Server runs one transaction: RBAC and CEL guard pass, `FOR UPDATE` on the allocation, `CHECK` satisfied, request row inserted pinned to workflow `capex-standard` v3, ledger event appended, outbox row created. | Request number `HF-2291` appears with state **Submitted**; budget card moves: encumbered 288,000, available 52,000. | D11, D2, D3, D4, D9, D6 | Click feeds into the stream |
| 40–55 s | Presenter stays on Maya's screen and points at the request header: "Workflow v3, pinned at submission." | The header shows the pinned version, the routing computed from thresholds (above 25,000 needs Budget Owner then Finance Controller), and the ledger sequence number of the submission. | Two-step route visible; sequence number 1,838 visible in the footer with a trace identifier. | D4, D9, S2 | Presenter clicks Dev's window |
| 55–65 s | Switches to Dev. The approval inbox already contains HF-2291 (pushed, not refreshed). | Dev's session receives the `request.submitted` event from the stream after visibility filtering. The row animates in. | Inbox row "HF-2291, 48,000, Maya Lindqvist" with a new-item marker. | D8, D12, D2 | Presenter opens the row |
| 65–85 s | Dev opens HF-2291, reads the line items, clicks **Explain** on the **Approve** button (which is enabled for Dev). | Decision trace renders each evaluated rule: role binding present, cost center ownership matches, CEL guard `amount <= budget.available + reserved` evaluated, separation-of-duties rule evaluated for requester versus approver. Each row shows the rule version and the policy's input hash. | Trace panel with five green rows and one grey row labelled "not applicable: requester is not the approver". | D2, D4, D9 | Presenter switches to Maya |
| 85–95 s | Switches to Maya. The **Approve** control is not present on her request page. Presenter clicks **Explain** on the request's action bar. | Trace shows the separation-of-duties denial she would hit if the control were shown, and that the server would return `403` with the same rule identifier. Presenter clicks the API call inspector to show the `403` body. | Trace row in red: "Requester may not decide own request (rule sod.requester_approver, workflow v3)". | D2, D9 | Presenter returns to Dev |
| 95–120 s | Dev clicks **Approve** with reason "Within Q4 refresh plan". | Server checks `If-Match: version 2`, decides, moves step 1 to **Approved**, opens step 2 for Finance Controller, appends `step.approved` and `request.routed` events, enqueues packet-generation job. Commit happens once. | Dev's inbox empties. Maya's request shows "Awaiting Finance Controller". Ines's inbox gains HF-2291 within about a second. Sequence advances from 1,838 to 1,840. | D5, D2, D9, D6, D8 | Presenter opens Ines's window |
| 120–140 s | Presenter moves to Priya's window. Maya's window, Priya's window and the presenter's control panel are arranged side by side. Presenter clicks **Race** on the control panel: it submits two requests of 35,000 against ENG-INFRA from two independent sessions, released at the same instant. | Both requests arrive. The database serialises on the allocation row. The first reserves 35,000 (available 17,000). The second waits on the lock and then fails the `CHECK`/guard with `409 insufficient_budget`, reporting available 17,000 at the time of its lock. Neither request is lost; both appear in the ledger. | Priya's window shows HF-2291A **Submitted** and HF-2292 **Rejected: insufficient budget (available 17,000 at decision time)**. Budget card shows encumbered 323,000, available 17,000. Both events are in the ledger with sequence numbers. | D3, D9, D8, D5 | Presenter switches to Ines |
| 140–160 s | In Ines's window, HF-2291 is open at step 2. Ines clicks **Approve** with reason "Q4 plan, budget owner confirmed". | Step 2 approved; request state **Approved**; ERP export job enqueued in the same commit as the state change. Worker picks up the job from SQS, writes the export batch to S3 with a SHA-256 checksum, and records the artifact hash in a `artifact.created` ledger event. | HF-2291 shows **Approved**. Within a few seconds a notice appears on all four windows: "ERP batch 2291-A written, sha256 3f9a…c1e0". | D5, D6, D7, D8, D9 | Presenter switches to Tom |
| 160–185 s | Tom (Auditor) opens the **Ledger** view. Presenter points at the live list: each event shows its sequence number, type, actor, and the first eight characters of its hash and of its predecessor's hash. | The ledger list renders from the reader endpoint. New events from steps 140–160 are already at the top. Tom's visibility is tenant-wide; the list is filtered by type with one click on "approvals". | Scrolling ticker of about 1,840 events for Halvard (seeded history plus the demo), with hash chain prefixes that visibly link. | D9, D12, D2 | Presenter clicks **Verify chain** |
| 185–215 s | Tom clicks **Verify chain**. | Verification runs on the writer endpoint (not the reader, to avoid replica lag). It recomputes each canonical payload hash and checks each `prev_hash` link, streaming progress back over the socket. Completion publishes an `integrity.checked` event. | Progress bar reaches 100% in the Tom window. Result card: "1,840 events verified, chain intact, head 9c1e…7a2b". The same card appears in Dev's and Ines's windows because the result is an event. | D10, D9, D8, D12 | Presenter moves to the drill |
| 215–245 s | Tom clicks **Run integrity drill** (break-glass). The drill requires dual control: a confirmation prompt appears on Ines's screen. Ines clicks **Confirm** with her step-up factor (a second OIDC authentication challenge, served by the local identity provider in rehearsal and by Cognito with MFA in AWS). | Both approvals are recorded as events. The drill runs under the forensics database role: it updates the stored payload of a seeded, already-approved historical request (REQ-0412), changing its amount from 9,600 to 4,800. The trigger that protects the ledger is disabled for that one statement inside a logged maintenance transaction, and the change is recorded in an operations log table outside the chain. | Ines's window shows "Confirmed by Tom Reyes and Ines Duarte, drill scheduled". After a short pause the drill completes; the operations log shows one row with both approver identifiers. The UI shows REQ-0412 still at 9,600 because it is reading the projection, which the drill did not touch. | D10, D2, D9 | Presenter clicks **Verify chain** again |
| 245–275 s | Tom clicks **Verify chain**. | Verification recomputes the payload hash of event 1,612 (the drill's target row in the ledger) and finds it differs from the stored hash. It reports the first mismatch and the link check for the following row, which fails because it chains to the stored hash of the tampered row. Verification stops at the first failing sequence and reports it. | Result card turns red: "Chain broken at sequence 1,612 (tenant Halvard). Recomputed hash 5be0…; stored hash 91fa…. Event 1,612 is request.approved for REQ-0412." | D10, D9, D12 | Presenter draws attention to other windows |
| 275–300 s | Presenter points at Maya's, Dev's and Ines's windows. | The `integrity.broken` event generated by the failed verification is pushed on the same stream. Every Halvard session shows a red banner naming the sequence number and the operations-log row, within the same second. Trace identifier in the banner links to the verification trace in the tracing UI. The last line of the presenter's control panel reads the anchor check: the chain head is compared with the most recent head anchor in an S3 Object Lock bucket, and the comparison also fails. | Banner visible on four screens. Trace opens showing the verifier's spans and the single SQL statement that found the mismatch. | D10, D12, D8, S2, D7 | End |

Timing notes. The first 30 seconds establish purpose through the invariant header and four live windows, with Corvane's 404 as the first proof. The final 30 seconds deliver the strongest moment: the database is changed behind the application's back by a dual-controlled, logged, deliberate act, and the system reports the exact sequence number to every connected session at once. Latency figures quoted in the script (the "about a second" stream propagation and the "within the same second" banner) are design targets, to be measured in the rehearsal harness; they are not measured results.

---

## D. Technical architecture

### Components

| Component | Language and framework | Responsibility |
|---|---|---|
| `ledgerwell-api` | Go 1.23, `chi` router, `pgx/v5`, `sqlc` for typed queries, `oapi-codegen` from an OpenAPI 3.1 contract, `cel-go` for guards | REST API, WebSocket stream endpoint, verification endpoints, workflow publish |
| `ledgerwell-worker` | Same Go module, separate `main` package, same image (subcommand `worker`) | Outbox relay to SQS, job consumers (packet generation, ERP export, anchor writing), integrity sentinel jobs |
| `ledgerwell-web` | TypeScript, React 18, Vite, TanStack Query, generated client from the same OpenAPI document, hand-written WebSocket client with cursor tracking | Single-page application; static build served from S3 and CloudFront in AWS, and from nginx locally |
| `ledgerwell-migrate` | Same Go module, `golang-migrate` SQL migrations, run as a one-shot task with the owner role | Schema, RLS policies, grants, triggers |
| `ledgerwell-ctl` | Go, same module | Seed, reset, drill tooling, readiness checks used by the rehearsal |
| Rehearsal harness | TypeScript, Playwright | Drives the five windows through section C and asserts each visible result |

Why Go: a single static binary per service, small distroless images, first-class `pgx` support for `LISTEN/NOTIFY` and COPY, a mature AWS SDK v2, and a straightforward concurrency model for the verifier and the outbox relay. Why TypeScript and React: the mandated polish needs a mature component ecosystem and the team's default for enterprise UIs; the frontend shares no code with the server except the generated API types.

No microservices. One API binary, one worker binary, one database. The only split is read and write endpoints, which is a connection-routing concern, not a service boundary.

### Persistence model

All tenant tables carry `tenant_id uuid not null`, have RLS enabled and forced, and have a single policy: `USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (same)`. The application role `ledgerwell_app` has no `BYPASSRLS`, no `SUPERUSER`, and no `DELETE` or `UPDATE` grant on `ledger_events`. Migrations run as `ledgerwell_owner`; the drill runs as `ledgerwell_forensics`, a role with `UPDATE` on `ledger_events` that exists only in the local and staging environments and is gated by a break-glass procedure in production.

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
                   version int, check (encumbered_minor >= 0 and spent_minor >= 0),
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
              hash bytea, trace_id text, occurred_at timestamptz,
              primary key (tenant_id, seq))
-- hash = SHA-256(prev_hash || payload_hash || canonical(type, aggregate_id, actor_id, seq, occurred_at))
-- UPDATE and DELETE revoked from ledgerwell_app; trigger rejects them for all roles except
-- through the drill's logged maintenance path

outbox(id bigserial pk, tenant_id uuid, kind text, payload jsonb, created_at timestamptz,
       sent_at timestamptz null, attempts int)

idempotency_keys(tenant_id uuid, key text, fingerprint bytea, response jsonb,
                 primary key (tenant_id, key))

decisions(id uuid pk, tenant_id uuid, request_id uuid, action text, principal_id uuid,
          workflow_version int, rule_results jsonb, input_hash bytea, outcome text,
          created_at timestamptz)

artifacts(id uuid pk, tenant_id uuid, request_id uuid null, s3_key text, sha256 bytea,
          kind text, created_at timestamptz)

ops_log(id bigserial pk, at timestamptz, actor_ids uuid[], action text, detail jsonb)
-- outside the chain; written by the drill, readable by the auditor
```

Canonical payload hashing uses RFC 8785 (JSON Canonicalization Scheme) on the payload, implemented in the Go module and covered by a cross-language test vector file that the TypeScript client also verifies. This matters because verification must reproduce hashes byte for byte across processes and deployments.

Money is stored as `bigint` minor units with a currency code; no floating-point arithmetic anywhere in the path.

Indexes that matter: `(tenant_id, state)` and `(tenant_id, requester_id)` on `purchase_requests`; `(tenant_id, status, role_required)` on `approval_steps` for inboxes; `(tenant_id, seq)` is the primary key on `ledger_events` and serves both the stream tail and the verifier.

### Communication

- **Synchronous:** HTTPS JSON REST under `/v1`, contract-first from OpenAPI. Mutations require `Idempotency-Key` (submissions) or `If-Match` (decisions, edits).
- **Asynchronous:** the transactional outbox. The worker polls `outbox` with `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 50`, sends to SQS (`ledgerwell-jobs`, standard queue with DLQ), and marks the row sent after a successful `SendMessage`. Consumers record processed job keys in `idempotency_keys` under a job namespace so redelivery is harmless. Jobs: `packet.generate`, `erp.export`, `anchor.write`, `integrity.sentinel`.
- **Real-time:** WebSocket at `/v1/stream` on the API service. The client sends an authentication frame containing the access token (never in the query string, so it does not appear in access logs), then `{subscribe: {tenants: current, resume_from: seq}}`. The server replays from `resume_from`, then waits. Commit notification uses PostgreSQL `LISTEN ledger_<shard>` issued by `NOTIFY` in the same transaction as the ledger insert; a wakeup is a hint, and the server always re-reads `ledger_events where tenant_id = $1 and seq > $cursor` so a lost notification costs latency, not correctness. A 1-second polling fallback guards against lost notifications. Visibility filtering runs per event by calling the same `Decide()` used by the REST layer, with the viewer's principal.

Why `LISTEN/NOTIFY` and not a separate broker: the ledger table is already the ordered, durable event log. Adding a broker would introduce a second ordering authority and a dual-write problem that the outbox exists to avoid. Notification is only a wakeup.

### Security boundaries and authorization

Trust boundaries: browser to CloudFront and WAF; ALB to API tasks; API and worker to Aurora, SQS, S3 and KMS through task IAM roles; API to the identity provider's JWKS endpoint.

Authentication. OIDC authorization-code with PKCE. Access tokens are 15-minute JWTs, validated for issuer, audience, expiry and signature against cached JWKS keyed by `kid`, with a refresh of the key set on unknown `kid` and a hard refusal of `alg: none` and of algorithm changes. Claims are normalised into a `Principal` (`tenant_id`, `subject`, `principal_id`) by a single adapter with two implementations: Cognito (AWS) and Dex (local). The tenant comes from the token's custom claim, is cross-checked against the URL's tenant slug, and is then used to set `app.tenant_id`.

Authorization decision (`Decide(principal, action, resource, context)`):

1. **RBAC gate.** Is there a role binding for this principal in this tenant covering this action on this resource type, scoped to the resource's cost center if the binding is scoped?
2. **Workflow guard.** The current approval step's CEL expression, from the pinned workflow version, evaluated with variables `principal`, `request`, `step`, `budget` and `vendor`. Expressions are type-checked at publish time against the declared variables; a guard that fails to compile cannot be published.
3. **Separation of duties.** Built in and not overridable by tenant configuration: a principal may not decide any step of a request they raised, and may not decide two consecutive steps of the same request.
4. **Visibility** (reads and stream filtering): RBAC read grant plus, for requesters, `request.requester_id = principal_id`.

Every evaluation that leads to a mutation, and every denial of a mutation, writes a `decisions` row and a ledger event. `rule_results` holds each rule's outcome and the policy version, so the trace shown in the UI is the stored evaluation, not a re-derivation.

Data-layer enforcement. RLS is the last line: even if all application checks were removed, a query from tenant B's context cannot read or write tenant A's rows. This is tested directly (section F, claim 1).

Secrets and keys: database credentials from Secrets Manager with rotation; encryption at rest with KMS customer-managed keys for Aurora, S3 and SQS; no long-lived keys in task definitions.

### Consistency requirements per operation

| Operation | Consistency requirement | Mechanism |
|---|---|---|
| Submit request | Atomic: reservation, request row, ledger event, outbox row, idempotency record all commit or none do | Single `pgx` transaction, `FOR UPDATE` on allocation, `CHECK` constraint as backstop |
| Retry of submit (same key) | Exactly one request, one reservation | Idempotency record checked first in the same transaction; fingerprint mismatch returns `422` |
| Approve or reject step | Serialisable with respect to the request; stale client loses | `If-Match` version check inside the transaction, `UPDATE ... WHERE version = $expected` |
| Budget reservation | No oversell under any concurrency | Row lock on allocation; `CHECK` constraint; race test (F2) |
| Ledger append | Gap-free, totally ordered per tenant, hash chain intact | Chain-head row locked for the duration of the transaction; `next_seq` and `prev_hash` read under the lock |
| Stream delivery | At-least-once to each connected session, in sequence order, with gap detection; no event delivered to a viewer who cannot read it | Cursor replay from the ledger table; client-side contiguity check; `Decide()` filter per event |
| Projection reads (lists, budget cards) | Read-your-writes for the acting session; eventual (sub-second) for others | Reads from the writer for the acting principal's own requests; other sessions update from the stream |
| Ledger list for auditors | Read-committed, may lag by replica delay | Reader endpoint, used only for display; verification always uses the writer |
| Integrity verification | Consistent snapshot of the tenant's chain | Single `REPEATABLE READ` read-only transaction on the writer, streaming progress |
| Outbox to SQS | At-least-once from the relay; effectively-once through consumer idempotency | Relay marks sent after SQS acknowledgement; consumer key check |
| Anchor write | Head hash written to Object Lock bucket at a fixed sequence interval | Worker job after commit; object key includes tenant and sequence |

Note on the sequence gap risk: a PostgreSQL `SEQUENCE` would be cheaper, but it allocates numbers at call time and so produces gaps and out-of-order commits for concurrent writers, which breaks cursor replay. The per-tenant chain-head lock is the deliberate choice, and its cost is that writes to one tenant are serialised (section G).

### Deployment topology

AWS (single region, three availability zones):

- **Edge:** CloudFront serving the static SPA from a private S3 bucket (origin access control), AWS WAF managed rule groups on CloudFront and the ALB, `/v1` routed to the ALB origin.
- **Network:** one VPC, public subnets for the ALB, private subnets for ECS tasks, Aurora and RDS Proxy; VPC endpoints for S3, SQS, KMS, Secrets Manager and CloudWatch so tasks do not need a NAT gateway for AWS traffic.
- **Compute:** ECS on Fargate. Service `api` (desired count 2, minimum 2, scaling on CPU and ALB request count) behind an ALB with WebSocket support and an idle timeout of 120 seconds; the client sends a ping every 30 seconds. Service `worker` (desired 1, scaling on SQS queue depth).
- **Data:** Aurora PostgreSQL 16, one writer and one reader. RDS Proxy in front of the API's REST and worker connections. The WebSocket and `LISTEN` connections go directly to the cluster writer endpoint, because RDS Proxy does not preserve `LISTEN` state across pooled connections in the way the stream needs.
- **Messaging and storage:** SQS standard queue `ledgerwell-jobs` with DLQ; S3 buckets `ledgerwell-artifacts` (SSE-KMS, versioned) and `ledgerwell-anchors` (Object Lock, compliance mode, short retention in the demo).
- **Identity:** Cognito user pool with a Halvard and a Corvane app client and a custom `tenant_id` claim; MFA required for the Finance Controller role.
- **Observability:** ADOT collector sidecar exporting traces to X-Ray; structured JSON logs to CloudWatch Logs with trace identifiers; metrics for stream lag, outbox age, verification duration and budget-conflict rate.
- **Infrastructure as code:** AWS CDK in TypeScript, five stacks: `network`, `data`, `messaging-storage`, `identity`, `services-edge`. Each service image is referenced by digest.

---

## E. AWS and local deployment

### Container-first and immutable

Two images are built, once, in CI: `ledgerwell-app` (contains both the API and worker binaries; the process is chosen by argument) and `ledgerwell-web` (static assets plus nginx configuration). Each is pushed to ECR, tagged with the commit and referenced by digest. The same digests are used in the AWS task definitions and in the local compose file. Nothing is rebuilt for an environment.

Runtime configuration comes only from environment variables and, in AWS, from Secrets Manager and SSM parameters. The web image reads `/config.json` at runtime, so one build serves local, staging and production. The app image contains no environment-specific values.

The compose file and the CDK app both consume one `deploy/config/*.yaml` schema for endpoints, issuer URLs, queue names and bucket names. Switching between local and AWS changes only these values and the choice of adapters, selected by configuration (`LEDGER_SQS_ENDPOINT`, `LEDGER_S3_ENDPOINT`, `LEDGER_OIDC_ISSUER`). When an endpoint override is empty, the AWS SDK's default endpoint resolution applies.

### Service mapping

| Concern | AWS service | Local stand-in | Difference | Why behaviour is unchanged |
|---|---|---|---|---|
| Relational store | Aurora PostgreSQL 16 | PostgreSQL 16 container (same image major version) | Aurora failover and storage behaviour not reproduced locally; replica lag only in AWS | No Aurora-specific SQL is used. RLS, `LISTEN/NOTIFY`, `FOR UPDATE` and `CHECK` are standard PostgreSQL. The conformance suite runs against both. |
| Connection pooling | RDS Proxy | None; direct connection | Local has no pooler | Application code uses one pool configuration; pool limits are set so the same code runs without the proxy. Proxy is excluded from the stream path. |
| Identity | Cognito user pool | Dex OIDC provider with the same custom claim | Claim names and token lifetimes configured to match; Dex does not implement MFA | Normalisation adapter (S1) produces the same `Principal`. MFA step-up is simulated locally by a second Dex connector challenge, and the rehearsal asserts the same visible sequence. |
| Job queue | SQS standard queue and DLQ | ElasticMQ (SQS-compatible server) | ElasticMQ implements the SQS subset used here; visibility timeout and receive count behaviour are tested against both | The worker uses the AWS SDK v2 SQS client with only an endpoint override. |
| Object storage | S3 with SSE-KMS and Object Lock | MinIO with object lock enabled | Local KMS is not used; encryption is at rest on the local volume | Checksums and presigned URL behaviour are identical; the artifact code path is the same. |
| Static hosting and edge | CloudFront with OAC, WAF | nginx container serving the same build | No WAF locally; no CDN cache locally | nginx sets the same cache headers CloudFront is configured with; WAF rules are tested in staging, not part of application behaviour. |
| Load balancing | ALB with WebSocket | Direct connection to the API container through nginx | ALB idle timeout and health-check semantics not reproduced locally | Client ping interval is set below the ALB idle timeout in both; readiness endpoint is the same. |
| Secrets and keys | Secrets Manager, KMS | Environment file (git-ignored) with a local key | No rotation locally | Application reads through one secret-provider interface; rotation is exercised in staging. |
| Tracing | X-Ray through ADOT | OpenTelemetry collector to Jaeger | Exporter differs | Same OTLP instrumentation in the code; only the exporter config changes. |
| Compute | ECS Fargate tasks | Docker compose services | Scaling not reproduced locally | Same image, same environment contract, same health checks. |

### What differs and why it is acceptable

Three differences are real and are documented in the repository's `deploy/PARITY.md`, which the rehearsal and the conformance suite reference:

1. Cognito's MFA and Dex's lack of it. The application's observable behaviour is identical because step-up is a separate challenge served by the identity adapter; the demo's dual-control moment is the same sequence of screens and events in both.
2. Aurora failover is not reproduced locally. The application behaves correctly across a writer change because it reconnects and re-reads from the cursor; the failover itself is exercised in staging, not in the five-minute demo.
3. KMS and Object Lock retention are enforced by AWS in staging and production and by MinIO's object lock locally. Retention periods are equal in both.

The conformance suite (section F) runs the same assertions against a local stack and against the staging stack in CI. An environment that fails the suite is not eligible to host the demo.

### One-command operation

- `make up` (or the equivalent `ledgerwell up` wrapper): starts the stack from the pinned digests, runs migrations, seeds the demo tenants, and waits for readiness.
- `ledgerwell-ctl reset-demo`: truncates tenant data in a transaction per tenant and re-seeds with deterministic UUIDv5 identifiers and fixed base timestamps. The post-reset state hash is printed and checked by the rehearsal before each run.
- `ledgerwell-ctl rehearse`: runs the Playwright script with five browser contexts and asserts every visible result in section C.

---

## F. Five strongest technical claims

Each claim has an executable test that runs against a real PostgreSQL instance (not a mock), and an observable behaviour the audience sees.

**F1. Tenant isolation holds below the application.**
*Claim:* a session bound to tenant B cannot read or write any row of tenant A through any statement the application role can issue.
*Test:* the catalogue test enumerates every table with a `tenant_id` column and asserts `relrowsecurity` and `relforcerowsecurity` are true. A second test connects as `ledgerwell_app` with `app.tenant_id` set to tenant B and runs, for every tenant table, a `SELECT` without a predicate, an `UPDATE` and a `DELETE` targeting tenant A's seeded rows, and an `INSERT` with tenant A's identifier. Expected: zero rows returned, zero rows affected, and the insert fails with a policy violation. The test is generated from the catalogue, so a new table without a policy fails the build.
*Observable:* the Corvane window's 404 (section C, 20–30 s) and the response bodies, which are identical for a non-existent identifier and a foreign one.

**F2. The budget cannot be oversold under concurrency.**
*Claim:* for any interleaving of concurrent submissions against one allocation, the final encumbrance never exceeds the allocation, and every rejected submission is one that would have exceeded it at its serialisation point.
*Test:* 200 concurrent submissions, with random amounts, from 64 goroutines against one allocation with a fixed available balance, using a real PostgreSQL. Afterwards the test asserts `encumbered + spent <= allocated`, asserts that the sum of accepted reservations equals the encumbrance delta, and asserts that the ledger contains exactly one `request.submitted` or `request.rejected` event per attempt with a contiguous sequence. Repeated with the seeded race pair (35,000 and 35,000 against 52,000 plus a 17,000 margin) as a deterministic case.
*Observable:* the race in section C, 120–140 s, where the second request is refused with the amount remaining at decision time.

**F3. The ledger detects tampering at the exact sequence number, and cannot be silently repaired by the application.**
*Claim:* any change to a stored payload, any deletion, and any reordering inside a tenant's chain is reported at the first affected sequence number.
*Test:* build a chain of 2,000 events with the production append path. For 500 random positions, change one byte in the stored payload through the forensics role and assert the verifier reports exactly that sequence with the expected and stored hashes. Separately, delete a row and reorder two rows and assert the same. A control test runs the verifier on an untouched chain and asserts success. The application role test asserts that `UPDATE` and `DELETE` on `ledger_events` fail for `ledgerwell_app`.
*Observable:* the red banner in section C, 245–300 s, naming sequence 1,612 and both hashes.

**F4. Real-time delivery is gap-free and resumable, and filtered by the same policy as the REST API.**
*Claim:* a session that disconnects at any point and reconnects with `resume_from` receives every event it is permitted to see, exactly once and in order, and never receives an event it could not read through REST.
*Test:* three concurrent writers produce 10,000 events for a tenant. A client connects, is forcibly disconnected at 50 random points, and reconnects with its last sequence number. The test asserts the client's received sequence is contiguous and duplicate-free. A second part generates a matrix of principals (roles by cost center, requester, auditor, foreign tenant) and events, and asserts that for every pair, `REST visible(principal, event) == stream delivered(principal, event)`.
*Observable:* Dev's and Ines's inbox updates in section C, 55–65 s and 95–120 s, and the banner arriving on every window in 275–300 s.

**F5. UI and server authorization cannot disagree.**
*Claim:* every control the interface shows or hides is derived from the same decision the server enforces, and the decision trace is the stored evaluation.
*Test:* a generated matrix of roles, workflow states, step statuses and actions (several thousand combinations, produced from the workflow definition and the role catalogue) is run through `Decide()` in Go and through the same evaluation in the web bundle's policy module, which is compiled from the same rule specification. The test asserts identical outcomes for every combination. A second test, against the running API, asserts that every combination the UI hides returns `403` with the same rule identifier that the trace displays, and that every combination the UI shows and the server allows succeeds.
*Observable:* the trace panels in section C, 65–95 s, where the disabled approve control and the server's `403` name the same rule.

Supporting tests, not counted as the five claims: the idempotency replay test (retry returns the original response and creates one request), the outbox crash test (the worker is killed between `SendMessage` and the mark-sent update, and the job is processed once), and the parity conformance suite described in section E.

---

## G. Failure analysis

### Implementation difficulties

1. **Per-tenant chain-head serialisation.** Every write for one tenant takes the same row lock. This is correct and simple, but it is the throughput ceiling for one tenant. Mitigation for the demo: none needed at demo load. The design for growth is to shard the chain by cost center or by period, which changes the verification unit and must be designed now even though it is not built now: the `ledger_events` key includes `tenant_id` and `seq` so that a `chain_key` column can be added without rewriting history.
2. **Gap-free sequence and `LISTEN` ordering.** A commit notification can arrive before an earlier-sequence transaction commits if sequences were allocated outside the lock. The lock makes allocation and commit ordered per tenant, so notifications are in order. The polling fallback and the client-side contiguity check cover any remaining edge.
3. **Canonical JSON hashing across languages.** Hashes must match between Go and the web bundle and between deployments. RFC 8785 is specified, a test-vector file is shared, and a payload containing floats is rejected at append time because float canonicalisation is the most common source of divergence. Money is integers throughout, which avoids this for the demo data.
4. **Visibility filtering on the stream.** Filtering each event with `Decide()` costs a principal lookup per event unless principals and role bindings are cached per connection. The cache is per connection, invalidated on role-binding change events, and tested.
5. **RLS and connection pooling.** `SET LOCAL app.tenant_id` must be executed inside every transaction and never leak through a pooled connection. Pool return resets the setting, and a test asserts that a connection reused by another tenant cannot see the previous tenant's setting. A missing `SET LOCAL` fails closed because the policy compares against a null setting, which matches no row.
6. **CEL guards and the browser.** Evaluating the same CEL semantics in the browser for F5 is the hardest technical item in the whole design. The web bundle does not run cel-go. Instead the rule specification is a restricted expression subset (comparisons, boolean operators, membership, field access) for which both a Go evaluator and a TypeScript evaluator are written and tested against one shared corpus. Anything outside the subset is rejected at publish. This is a real limitation: tenants cannot write arbitrary CEL in the browser preview.
7. **Dual-controlled drill.** The drill temporarily disables a trigger and must leave evidence. The maintenance transaction runs under the forensics role, records the operator identifiers in `ops_log` outside the chain, and the verifier flags the drill as a known tamper rather than as an unexplained break only by reading that log. The break itself is still reported, because the chain has been changed; the ops log explains it. This must not be presented as a feature that hides tampering.
8. **WebSocket behind the ALB.** Idle timeouts, connection draining on deployment, and the 4 KB frame limit all interact. Deployments drain connections; clients reconnect with their cursor. A deployment during the talk is prevented by the rehearsal's freeze window, not by the code.

### On-stage failure modes and mitigations

| Failure | Effect on stage | Mitigation |
|---|---|---|
| Identity token expiry during the talk | Session shows login | Access tokens are refreshed silently with refresh tokens held by the PKCE client; sessions were established 30 minutes before the talk, and the rehearsal asserts the refresh path |
| Stream disconnect | Windows stop updating | Automatic reconnect with cursor; header shows stream state; reset-and-resume is one click |
| Worker or SQS delay | Packet or ERP notice late | The state change is shown immediately; the artifact notice is a separate event. Script text says "within a few seconds" only because the rehearsal measures the 95th percentile. A pre-generated packet exists as a fallback artifact for the seed scenario, presented only if the job is late by more than the rehearsal threshold, and labelled in the UI as the previously generated packet. |
| Writer failover in AWS | Writes fail briefly | Application retries on connection errors with the same idempotency key; the stream reconnects. Not run during the talk; checked in staging. |
| Race timing | Both requests succeed or the race is not simultaneous | The race uses a barrier released in the browser and two independent HTTP/2 connections; the rehearsal asserts exactly one success and one `409`. If the barrier fails to release, the race button reruns from reset state, not from mid-state. |
| Verification slow on a long chain | Progress bar stalls | Seed size is fixed (about 1,840 events for Halvard at the demo start, measured by the seed script). Verification streams progress per 100 events. A longer chain would need the checkpoint design in section G1; it is not needed for the demo. |
| Browser sessions diverge | Windows show different state | Cursor shown in each header; the rehearsal compares cursors before each section. |
| Demo data drift | Ids or numbers differ from the script | Deterministic seed; the script's numbers are generated from the seed, not written by hand. |
| Drill fails midway | No tamper, verification green | The drill runs in one transaction; failure rolls back and shows the error. A failed drill is not shown as a successful one. |
| Replica lag shows stale ledger | Tom's list lags a few events | Verification uses the writer; the list shows a "replica lag" indicator and refreshes. |

### Hidden complexity the audience will not see

- Reconnect semantics: when a session reconnects, it must reconcile optimistic local state against the replayed events, not only append them.
- Every mutation path must write exactly one ledger event with the right type and actor, including denials. A missing event is itself a test failure, and the rehearsal checks the event count against the action count.
- Schema migrations that add RLS policies must be applied in the same deployment as the code that relies on them; otherwise a rolling deployment has a window where the policy is missing. The migration sequence adds policies first and enables `FORCE` last.
- Time: `occurred_at` is stored but not used for ordering; ordering is by `seq`. Clock skew between tasks therefore cannot reorder the ledger.

### Features that look impressive but are technically shallow

These are included in the product but must not be presented as technical depth:

- **Budget dashboards and utilisation charts (S7).** Standard aggregations over `budget_allocations`. Present them for context only.
- **CSV import of allocations (S8).** Ordinary validation and bulk insert. Useful, not impressive.
- **Vendor screening (S6).** Deterministic rules against a tenant-owned list. It is not a risk model, it calls no external service, and it should be described as a rule set. Its only technical role is to give the CEL guard a realistic input.
- **The ERP export.** A JSON file in S3 with a checksum. It is a real object and a real hash, but it is not a posting to an ERP system, and the script says "export batch", not "posted to ERP".
- **The decision trace.** It is a presentation of stored evaluations. It is deep only because the evaluations are stored and verified (F5); a trace rendered from a re-computation would be shallow.
- **Workflow authoring (S9).** A form around a JSON document with validation. It is valuable because publish-time validation and version pinning are real, but the editor itself is conventional.

---

## H. Feasibility

Scope is expressed by what each component touches and by dependency order. Nothing in this section is a duration.

### Scope by component

| Component | What it touches | Relative size |
|---|---|---|
| Schema, RLS policies, grants, triggers, migrations | Every tenant table; the ledger immutability trigger; the workflow publish trigger | Medium: one migration set, one catalogue test |
| Ledger append and verifier | `ledger_events`, `chain_heads`, canonical JSON, hash test vectors shared with the browser | Medium; the most precision-sensitive code |
| `Decide()` and CEL subset | Role bindings, workflow bodies, `decisions` table, both Go and TypeScript evaluators, shared corpus | Large; the single largest correctness surface |
| Budget reservation | `budget_allocations`, submission transaction, idempotency | Small in code; heavy in tests (F2) |
| Workflow versioning and publish validation | `workflow_definitions`, CEL type-check, reachability check | Medium |
| Outbox relay, SQS consumers, S3 artifacts | `outbox`, SQS, S3, KMS, idempotency for jobs | Medium; AWS SDK configuration surface |
| Stream service and client | WebSocket endpoint, `LISTEN`, replay, per-connection principal cache, client cursor logic | Medium-large; reconnect logic is the subtle part |
| REST API and OpenAPI contract | Handlers for submit, decide, list, verify, drill, ledger, workflow | Medium; generated client reduces hand-written surface |
| Web application | Five screens (budget, request, inbox, ledger, drill and verification), trace panel, stream-driven updates | Medium-large; visual polish is the largest share |
| Identity adapter | OIDC client, JWKS cache, claim normalisation, Cognito and Dex configuration | Small-medium |
| Infrastructure as code | Five CDK stacks, one local compose file, one config schema | Medium; many resources but a repetitive shape |
| Rehearsal and conformance suites | Playwright script for section C; conformance tests for local and staging | Medium; this is what makes the demo reliable |

Total moving parts: three executables from one module (api, worker, ctl), one SPA, one database, five queues and buckets, one identity provider, and one set of CDK stacks. Two of the services are the same binary. There are no additional runtime dependencies in the demo path beyond those listed in section E.

### Dependency order

The build proceeds as a sequence of layers, each runnable and testable:

1. **Foundation.** Schema with RLS, migrations, the seed, the Principal adapter with Dex, and the catalogue test (F1). Runnable as a database plus an API with two endpoints: health and a tenant-scoped read.
2. **Ledger core.** Append path, chain head lock, canonical hashing with test vectors, verifier, and the immutability trigger (F3 without the drill). Runnable as a command-line verification of a seeded chain.
3. **Decisions.** `Decide()` with RBAC, CEL subset with publish-time validation, separation of duties, decision storage (F5 server half). Runnable through the REST API with a trace endpoint.
4. **Budget and submission.** Allocation locking, submission transaction, idempotency (F2, D11). Runnable through the API; the race test passes before any UI exists.
5. **Approvals and workflow versions.** Step transitions, `If-Match` concurrency, pinned versions, publish flow. Runnable through the API.
6. **Stream.** Outbox relay, `LISTEN`, WebSocket replay and filtering (F4). Runnable with two scripted clients.
7. **Async jobs.** SQS consumers, packet generation, ERP export to S3, artifact ledger events, anchor writes. Runnable with ElasticMQ and MinIO locally.
8. **Web application.** Screens and trace panel against the stable API contract. Each screen is runnable as soon as its endpoints exist.
9. **Drill and drill approval.** Dual control, forensics role, ops log, integrity banner. Depends on layers 2, 6 and 8.
10. **Rehearsal and reset.** Seed determinism, Playwright script, conformance suite. Depends on everything above; the rehearsal is the acceptance test for the demo.
11. **AWS deployment.** CDK stacks, Cognito adapter, ECS services, Aurora, SQS, S3 with Object Lock, WAF, staging conformance. Can start after layer 1 in parallel with layers 2 to 7, since the adapters are already behind interfaces, and must complete before the rehearsal runs against AWS.

Layers 2 to 7 are the critical path for the technical claims. Layer 8 is the critical path for visual impact. Layer 11 is independent of layer 8 but gates the AWS rehearsal.

### Critical dependencies

- PostgreSQL 16 behaviour for RLS with `FORCE`, `LISTEN/NOTIFY` and row locks. Standard, but the conformance suite must cover them on Aurora specifically.
- The Cognito custom-claim mechanism for `tenant_id`. Confirmed in configuration; the adapter tolerates the claim being in an ID token or an access token.
- ElasticMQ's coverage of the SQS features used (visibility timeout, receive count, DLQ redrive). Verified by the conformance suite against both targets.
- Object Lock behaviour in MinIO matching S3 compliance-mode semantics for the operations used (put with retention, get with retention metadata).
- WebSocket support on the ALB with the chosen idle timeout and client ping.

### Main risks, by what they touch

1. **The browser policy evaluator (F5).** It touches the CEL subset, both evaluators and the shared corpus. Risk: the subset grows beyond what both evaluators support. Control: the subset is fixed in the specification and enforced at publish time.
2. **Stream correctness under reconnects (F4).** It touches the replay path, client cursor logic and visibility filtering. Risk: subtle duplicate or gap bugs that appear only under specific disconnect timing. Control: the randomised disconnect test runs in the rehearsal suite, not only in unit tests.
3. **Hash canonicalisation across languages.** Risk: divergence on an edge value. Control: shared test vectors, floats rejected at append time.
4. **Live visual polish.** It touches every screen. Risk: the screens look like a generic admin console. Control: the design is held to one token system with a restrained palette, and the four-window layout is designed as a unit, not as four pages.
5. **Parity drift between local and AWS.** It touches adapters and infrastructure. Risk: the local environment passes while staging diverges. Control: the conformance suite gates the demo environment, and `deploy/PARITY.md` lists every known difference.
6. **Rehearsal flakiness.** Risk: the Playwright script becomes timing-dependent. Control: every step waits on an observable state (cursor, row count, banner), never on a fixed delay, and the barrier for the race is explicit.
7. **Scope creep into shallow features.** Risk: time spent on S6 to S8 reduces time for the core invariants. Control: section G lists them as shallow, and layers 1 to 7 are complete before any supporting screen beyond the five is started.

### What is deliberately out of scope

Real ERP integration, real payment rails, real vendor risk data, multi-region failover, tenant self-service signup, email delivery, and any feature that requires a live third-party service in the demo path. Each would add an external dependency that the mission brief forbids in the core demo.

---

## Appendix: why this mandate, and what it sacrifices

The enterprise mandate favours invariants that the audience can see the system enforce. It sacrifices breadth: there is no product catalogue, no customer portal, no mobile client, no reporting suite beyond the minimum to set context. It also commits the team to a single serialisation point per tenant and to a restricted rule language, both of which are visible limitations that section G states plainly. The bet is that a technically literate audience will forgive a narrow product and will not forgive a claim that the demo cannot back up.
