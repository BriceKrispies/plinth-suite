# Proposal 05: Live Operational Resilience

Mandate: demonstrate real infrastructure behaviour, observability, concurrent activity, failure handling and recovery, as one coherent application that is shown being broken and repaired in front of the audience.

Product title: **Culvert: live work-order operations for a regional water utility**

Pitch: Culvert is a dispatch and field-work console in which three people act on the same work orders at once while the audience watches the system keep its promises: authorization enforced inside Postgres, concurrent writes resolved to exactly one winner, a phone that works offline and replays its queue in order, a worker and an API replica killed mid-operation with no lost or duplicated effects, and an audit chain that visibly detects a database owner's edit. The same container images run on a laptop under Docker Compose and on ECS Fargate with RDS, and the presenter switches between them only to show that the digests and the verifier are identical.

---

## A. Product concept

**Application.** Culvert is the work-order system a regional water utility uses when a main breaks. Dispatchers open emergency and routine work orders, assign crews, watch progress on a live board, and close orders with evidence. Field technicians use a phone-width web app (installable PWA) to acknowledge, progress and annotate orders, including when the mobile signal drops. Auditors and regulators read the immutable record and verify it. Operations staff inspect platform health and inject faults.

**Users and roles.**

| Principal | Role | Scope | Typical action in the demo |
|---|---|---|---|
| Maya | dispatcher | North region | creates the emergency order, races assignments |
| Sam | dispatcher | South region | sees the board change live, reassigns the order during Rafi's offline window |
| Rafi | technician | Crew 7 (North) | drives the phone-width window, goes offline, resolves conflicts |
| Priya | auditor | all regions, read-only | runs chain verification |
| Ops | operator | platform | opens the Resilience panel, kills tasks, holds deliveries, runs the database console |

Roles and regional scope live in a Postgres table (`memberships`), not in token claims. The identity provider only proves who the principal is (`sub`). This is a deliberate design point: the same authorization facts drive both deployments even though the two identity providers differ in how they shape claims (section D).

**Problems solved.** Utilities need a single authoritative answer to "who is doing what on this main right now", a record that survives disputes, and field work that does not stop when coverage does. The problems the product is built around are exactly the ones that make distributed systems hard: concurrent writes to one entity, real-time propagation that must not lose events, background work that must happen once, offline clients that diverge, and audit records that must stay trustworthy when parts of the system fail.

**Why it suits this demo.** Every capability the audience cares about is triggered by an action a non-expert understands: "assign this order", "go offline", "kill the server". Each action builds on the previous one, because the state, the audit chain and the event stream accumulate across the five minutes. Nothing is a simulation: the failures are process kills and network conditions applied to real containers and real tasks, and the recovery is performed by the same code paths production would use.

**What the audience should walk away believing.** That the team can say precisely which guarantee holds, where it is enforced (in the database, in the queue protocol, in the client), and show a test that would fail if it stopped holding.

---

## B. Capability inventory

Twelve capabilities are demonstrated live. Three to five more are supporting: they make the demonstrated ones possible or credible but are not the focus of a moment in the script.

| # | Capability | Status | Technical significance | Interaction with others |
|---|---|---|---|---|
| 1 | Server-enforced work-order state machine (transition table + trigger) | demonstrated | Invalid transitions are impossible regardless of client; the client renders allowed next states from the same table the server enforces. | Used by 2 (assignment is a transition guard), 8 (queued transitions are re-validated), 7 (every transition is audited). |
| 2 | Optimistic concurrency on assignment (compare-and-set on `version`) | demonstrated | Concurrent dispatchers cannot both win; losers receive the winning state. | Race button in the script; each losing response is the conflict card; the winning write is the only audit event. |
| 3 | Idempotent mutations (`Idempotency-Key`, stored response) | demonstrated | Retries after lost responses and offline replays return the original result instead of repeating the effect. | The same table and mechanism is used by 4 (worker deliveries) and 8 (offline queue). |
| 4 | Transactional outbox with leased, fenced worker claims (`FOR UPDATE SKIP LOCKED`, lease epoch) | demonstrated | State change, audit record, event and outbox row commit atomically; background delivery is at-least-once with a single effect for the audience. | Outbox rows created by 1 and 2; the worker kill in the script reclaims a lease; delivery is observed in 15 (email). |
| 5 | Real-time fan-out through `LISTEN/NOTIFY` with gap-free SSE replay | demonstrated | Each API replica receives commit notifications and replays from a commit-ordered cursor, so a reconnecting stream loses nothing even when commits interleave. | Transport for every live update; the replay path is exercised by the API-replica kill; visibility filtering uses 6. |
| 6 | Row-level security authorization driven by a membership table | demonstrated | Authorization is enforced by the database for every query, including ones the API did not anticipate; denied rows are invisible rather than forbidden. | Every read in every capability passes through it; the South-region order check in the script; SSE replay also runs under the subscriber's principal. |
| 7 | Hash-chained, tamper-evident audit log with live verification | demonstrated | Each event commits to its predecessor; a single-row edit by a privileged role is detected at the exact sequence number. | Written by 1, 2, 3, 4, 6 (denied reads), 8 and 9; verification is the closing moment. |
| 8 | Offline-first PWA with an ordered, precondition-checked replay queue | demonstrated | Client actions survive loss of connectivity; on replay, each action is accepted only if its preconditions still hold, and the rest are presented as conflicts. | Uses 3 for idempotency, 1 for transition validity, 5 to refresh state after replay. |
| 9 | Fault injection and recovery controls (task kill, delivery hold, optional latency on the database path locally) | demonstrated | The recovery claims are tested by the same faults an operator would produce, not by simulated errors inside the code. | Kills the replica serving 5; kills the worker holding 4's lease; the effects are read back through 5, 4 and 7. |
| 10 | Dependency-aware health and readiness with degraded mode | demonstrated (health strip) and supporting (degraded mode) | Readiness reflects real dependencies (database ping, JWKS cache, outbox lag, worker heartbeats); when writes are refused the client switches to the queue from 8. | Health strip reads worker heartbeats written by 4; degraded mode reuses 8. |
| 11 | Distributed trace propagation (W3C `traceparent` from the browser through API, DB span and worker) | demonstrated (trace chip) and supporting (deep links) | Each action carries one trace identifier from the browser through the request, the transaction and the asynchronous delivery. | The same identifier is stored on the event row (5) and the outbox row (4), so the trace chip on the board can be followed into the worker. |
| 12 | Deterministic seed and reset, Playwright browser rehearsal | supporting | Predictable starting state; the entire five-minute script is an automated test on both deployments. | Drives 1 through 9 with three browser contexts, including Playwright's offline emulation. |
| 13 | OIDC sign-in (Amazon Cognito; Dex locally) with PKCE and short-lived SSE tickets | supporting | Real identity provider in both environments; the application treats `sub` as the only trusted identity. | Feeds 6; SSE uses a single-use ticket because `EventSource` cannot send an Authorization header. |
| 14 | Immutable, signed, digest-pinned images built once and promoted unchanged | supporting | The same bytes run locally and in AWS; deployment verifies the signature. | Makes the parity claim in section E checkable. |
| 15 | Email delivery through SMTP (Amazon SES; Mailpit locally) | supporting | Real protocol, real queue semantics; the inbox is the visible result of 4. | Only observable endpoint of the worker in the script. |

The interaction graph is the point. Removing any one demonstrated capability breaks a visible moment in the script, and each moment exercises at least three others. For example, the single order created at 25 s is written by 1 and 4, streamed by 5, filtered by 6, traced by 11 and appended to the chain in 7. The offline replay at 175 s touches 3, 8, 1, 5 and 7.

---

## C. Five-minute live script

Setup before the audience sits down: a deterministic reset (capability 12) has run, three browser windows are signed in (Maya and Sam in two side-by-side desktop windows, Rafi in a phone-width window with a DevTools panel docked, Priya in a third window), and the Ops drawer is open on a separate screen. The region map and board start in the seeded state: 412 work orders across the two regions, Crew 4 and Crew 7 available.

Transition notation: each row ends with the action that starts the next row.

| Time (s) | Presenter action | Expected behaviour | Visible result | Capabilities demonstrated | Transition |
|---|---|---|---|---|---|
| 0–25 | Presenter states the purpose in one sentence: a utility's work orders, three people acting on them at once, a deployment that runs identically on a laptop and in AWS, and a promise to break things live. Points at the health strip. | Board renders from a snapshot, then the live stream attaches. The health strip queries real readiness endpoints and worker heartbeat rows, not cached values. | Health strip: API 2/2 ready, workers 2/2 heartbeating, database ok, outbox lag 0 ms, three live streams open. | 10 (health), 5 (stream attach), 11 (trace chip scheme shown on hover, supporting). | Presenter clicks "New emergency" in Maya's window. |
| 25–55 | Maya enters "Main break, Elm and 4th, 2 blocks dark, priority 1" and submits. | One database transaction writes `work_orders`, `audit_events`, `outbox`, `events` and `idempotency_keys`. The commit fires `NOTIFY`; each API replica re-reads the new event under the subscriber's principal and pushes it. | The order appears on Sam's board and in Rafi's phone list. All three windows show the same trace chip (`t-7f3a…`). Target p95 from submit to appearance in the other two windows: 300 ms, to be measured in rehearsal. | 1, 3 (key generated per submit), 4 (outbox row), 5 (fan-out), 7 (chain head advances), 11. | Presenter says "Rafi's phone has it. Sam's board has it. Now who is allowed to see it?" and points at Sam's South-region list. |
| 55–85 | Presenter opens the API explorer in the Ops drawer and issues `GET /work-orders/{id}` as Rafi for a South-region order created by Sam at seed time. Then it lists Rafi's orders. | Response is `404 not_found`, not `403`, because RLS removes the row from the query result. The request log shows the SQL that ran with `app.principal` set and the policy predicate; the list reports "3 of 412 rows visible". The denied read is written to the audit log as a security event. | `404` with the request ID; `rows visible: 3 of 412`; audit tail shows `read.denied` for Rafi. | 6 (RLS), 7 (denied read audited), 13 (token identity), 11. | Presenter says the API layer is not the only enforcement point and runs the same query in `psql` as `culvert_app` with no principal set: zero rows. |
| 85–120 | Presenter clicks "Race: 20 concurrent assigns" in Maya's window. The button sends 20 assignment requests at once from a barrier (all sockets opened, then released together), each assigning Crew 4 or Crew 7 with the same `expected_version`. Each request carries its own key. | Exactly one request succeeds with `201` and version 2. The other 19 receive `409 version_conflict`, each with the winner's crew, the winning dispatcher and the winning version. Presenter then re-sends the winning request with its original key. | Board shows one assignment. Nineteen conflict cards stack in a tray, each reading "Assigned to Crew 4 by Maya, 14:02:11.412, v2". Re-sent request returns the stored response with `Idempotent-Replayed: true`. Audit tail shows one `assignment.changed` event. | 2 (CAS), 3 (idempotent replay), 7 (single audit event), 5 (one board update, not twenty). | Presenter says "one winner, nineteen losers, one audit row" and clicks "Assign" on the order from Sam's window with a stale version. |
| 120–145 | Sam, online, tries to close the order while it is still `dispatched`. Presenter then taps "En route" on Rafi's phone. | The server rejects the close with `422 invalid_transition` naming the allowed next states from the transition table; the close control in the UI was disabled from the same table. Rafi's "En route" succeeds; the board moves the order to the "En route" lane. | Sam's close button is disabled with the tooltip listing the allowed transitions; a red toast shows the server's rejection reason when forced. Rafi's phone shows the order in "En route". | 1 (state machine), 7 (rejected attempt is not audited as a change, but the attempt is in the request log), 5. | Presenter opens DevTools on Rafi's window and sets the network to Offline. |
| 145–175 | Rafi taps "Add note: break confirmed, 300 mm main" and then "On site" and "Valve isolated". The phone shows all three as queued. At about 160 s Sam, online, reassigns the order to Crew 4. | Each queued action is stored in IndexedDB with its own `Idempotency-Key` and its precondition: for "On site", status `en_route` and assignee Crew 7; for "Valve isolated", status `on_site` and assignee Crew 7; for the note, only that the order is not closed. The reassignment succeeds for Sam and appears on Rafi's cached board with a "stale" marker. | Rafi's header turns amber: "Offline, 3 queued". Sam's board shows the order moved to Crew 4. The queue panel lists the three items with their preconditions. | 8 (queue), 3 (keys stored with actions), 2 (Sam's reassignment as a CAS write), 5 (Sam's update). | Presenter turns Rafi's network back on. |
| 175–205 | Rafi's client detects connectivity and flushes the queue in insertion order. | The note is accepted (`201`), because its precondition still holds. "On site" fails its precondition (`assignee is Crew 4`) and returns `409 precondition_failed` with the current state. The queue halts at the first state-changing rejection; "Valve isolated" moves to the conflicts inbox as blocked rather than being sent. The note's audit event is written; the rejected items are written as `action.rejected` with their keys. | Queue drains: note check mark; "On site" red with its reason; "Valve isolated" grey, labelled "blocked by earlier conflict". Conflicts inbox shows two items. Rafi chooses "Hand back to dispatcher", which creates a dispatcher task on Sam's board. | 8 (ordered replay, precondition checks), 3, 1, 7 (accepted and rejected actions both audited), 5. | Presenter says "Non-conflicting work was accepted; conflicting work was not, and the reason is recorded" and switches to the Resilience panel. |
| 205–230 | Presenter selects "Kill api-a" in the Resilience panel (Ops role). Sam's stream is connected to api-a by chance of load balancing; presenter confirms the stream id shown on the panel. | The api-a process receives SIGKILL. The load balancer deregisters it after its health check fails. Sam's `EventSource` errors and reconnects with `Last-Event-ID`, receiving a fresh single-use ticket first; the request lands on api-b, which replays events after the cursor under Sam's principal. | Health strip shows API 1/2 in red, then Sam's stream reconnect counter ticks to 1. Panel reads: "reconnected in 1.8 s; replayed 4 events; gaps 0; duplicates 0". Board is unchanged except for the events that happened during the gap. | 5 (replay and cursor), 9 (fault), 10 (degraded status), 13 (ticket). | Presenter clicks "Hold next delivery: 20 s" on worker w-1 in the same panel, which holds the next outbox claim after it acquires the lease. |
| 230–250 | Presenter clicks "Kill w-1" once the panel shows w-1 holding the lease for outbox row 1184 (the crew-4 assignment email). | w-1 is killed while holding a lease with epoch 1 and `lease_expires_at` now plus 10 s. No delivery was sent. After expiry, w-2 claims the row with epoch 2 and delivers it once. The notification table records the send under the outbox key. ECS or Compose restarts the killed task in the background. | Panel: "w-1 lease expired at +10.0 s; reclaimed by w-2 (epoch 2)". Mailpit count goes to exactly 1, with `Message-ID: <outbox-1184@culvert>`. Health strip returns API 2/2 once the replacement is ready. | 4 (lease, fencing, SKIP LOCKED), 9, 15 (email), 10. | Presenter opens Priya's window and clicks "Verify chain". |
| 250–270 | Priya clicks "Verify chain" on the audit page. | The verifier reads the chain in sequence order, recomputes each hash from the stored canonical bytes and compares it with the stored hash and the predecessor. | Chain of 1,318 events, head `9c1e…07ab`, verified in under 250 ms (target). A visual strip of hash blocks shows all green. | 7 (verification), 6 (Priya's auditor scope). | Presenter says "Now the part you are not supposed to be able to do" and opens the Ops drawer's database console, which connects as the table owner with the trigger that blocks `UPDATE` on `audit_events` in place. |
| 270–300 | Presenter runs a prepared transaction: disables the append-only trigger, changes the payload of sequence 1209 (the crew-4 reassignment) from `crew_id: 4` to `crew_id: 7`, re-enables the trigger. Priya re-runs "Verify chain". | The verifier recomputes sequence 1209 from the edited payload, gets a different hash, and reports the first broken link. Every later link is marked "cannot be verified: predecessor broken". The result is the same whichever verifier instance runs it. | Strip turns red from block 1209 onward; panel reads: "chain broken at seq 1209: stored hash 4a7d…, recomputed 81f0…; 109 downstream links unverifiable". Final line on screen, the same verifier in the AWS environment, its result string identical. | 7 (tamper detection at the exact sequence), 4 (trigger), 6 (owner role isolated from app role), 14 (same image digest in both environments). | End. Presenter takes questions. |

The first 30 seconds establish purpose and the health evidence. The last 30 seconds are the tamper and detection: the audience watches a privileged edit to a record they have just seen created, reassigned and replayed, and watches a verifier name the exact sequence number that changed. That is the strongest moment because it converts every earlier claim into something that can be checked.

Timing risks in the script are listed in section G. The script has three places where a visible result depends on a background process finishing (the notification send, the replacement task becoming ready, and the chain verifier). Each of them has a fallback that keeps the next step correct: the notification row count is also shown in the panel from the database; the health strip shows partial readiness rather than hiding it; and the verifier result is cached only for the duration of the request, never across runs.

---

## D. Technical architecture

### D.1 Components

| Component | Implementation | Why |
|---|---|---|
| Web client | TypeScript, React 18, Vite. TanStack Query for server state. IndexedDB via `idb`. Service worker via Workbox for the app shell and the offline queue. OpenTelemetry Web SDK for `traceparent`. | React and Query are the most common stack for this UI class; Workbox is mature for offline shells; IndexedDB is the only durable client store that survives tab closure. |
| API | Go 1.22, `net/http` with the standard `ServeMux` patterns, `pgx/v5` with `pgxpool`, `go-oidc` for token verification, OpenTelemetry Go SDK. One binary, subcommands `serve`, `worker`, `migrate`, `seed`, `verify`. | One language and one binary keeps the artifact identical between API and worker; Go's `net/http` flush semantics make SSE straightforward; `pgx` exposes `LISTEN/NOTIFY` and `SKIP LOCKED` directly. |
| Worker | Same binary, `worker` subcommand. Outbox dispatcher, notification sender (SMTP via `net/smtp`), heartbeat writer, head-hash anchor writer. | Background delivery needs no separate queue service because the outbox is in the same database as the state change. |
| Migrator | Same binary, `migrate` subcommand with embedded migrations (goose-compatible files). Runs as a one-shot task before rollout. | Schema changes are applied once and checked against the image digest. |
| Fault controller | Small Go service exposing four operations: kill task, hold next delivery, set database latency (local only), read task status. No database credentials. | Isolated so the operator surface is narrow (section G). |
| Identity | Amazon Cognito user pool (AWS); Dex with static passwords (local). Authorization code with PKCE. | Real OIDC on both sides. Authorization data is not in the token (section D.5). |
| Database | PostgreSQL 16. Amazon RDS for PostgreSQL 16, Multi-AZ, in AWS. `postgres:16` container locally. | Row-level security, advisory locks, `LISTEN/NOTIFY`, `pg_current_xact_id()` and triggers are all used; these are standard in both. |
| Edge/LB | Amazon CloudFront and S3 for the web bundle; Application Load Balancer for API. Traefik locally for both the API and the bundle. | Traefik has active health checks and a Docker provider, which makes its behaviour closer to ALB than nginx would be. |
| Email | Amazon SES over SMTP (AWS); Mailpit (local). | Same SMTP code path; only the host and credentials differ. |
| Telemetry | OpenTelemetry Collector; AWS Distro for OpenTelemetry sidecar exporting to AWS X-Ray (AWS); Jaeger (local). | The application emits OTLP in both places; only the collector's exporter differs. |

### D.2 Persistence model

All tables are in one database, schema `culvert`. The API connects as role `culvert_app`, which owns nothing and does not have `BYPASSRLS`. The worker connects as `culvert_worker`, which can read all rows of the tables it needs and update only `outbox`, `notifications` and `worker_heartbeats`. The owner role `culvert_owner` is used only by migrations and by the Ops database console. Every application table has `FORCE ROW LEVEL SECURITY`, so even the owner must set a principal or receive zero rows.

Key tables:

```sql
create table regions (id text primary key, name text not null);

create table crews (
  id          int primary key,
  region_id   text not null references regions(id),
  name        text not null
);

create type membership_role as enum ('dispatcher', 'technician', 'auditor', 'operator');

create table memberships (
  user_sub    text not null,              -- OIDC subject; the only identity the app trusts
  region_id   text references regions(id),-- null only for auditor/operator (global)
  role        membership_role not null,
  crew_id     int references crews(id),   -- set for technicians
  primary key (user_sub, role, region_id)
);

create table work_orders (
  id            uuid primary key,
  region_id     text not null references regions(id),
  status        text not null check (status in
                  ('open','dispatched','en_route','on_site','isolated','repaired','closed')),
  priority      smallint not null check (priority between 1 and 4),
  crew_id       int references crews(id),
  version       bigint not null default 1,
  title         text not null,
  created_by    text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  trace_id      text not null
);

create table transitions (
  from_status text not null,
  to_status   text not null,
  min_role    membership_role not null,
  primary key (from_status, to_status)
);

create table events (                     -- the replayable stream
  seq         bigint generated always as identity,
  xid         xid8 not null,              -- pg_current_xact_id() at commit
  region_id   text not null,
  order_id    uuid,
  type        text not null,
  payload     jsonb not null,
  trace_id    text not null,
  created_at  timestamptz not null default now(),
  primary key (xid, seq)
);

create table outbox (
  id               bigint generated always as identity primary key,
  order_id         uuid,
  kind             text not null,         -- 'assignment_email', 'status_email'
  payload          jsonb not null,
  trace_id         text not null,
  created_at       timestamptz not null default now(),
  published_at     timestamptz,
  attempts         int not null default 0,
  lease_epoch      int not null default 0,
  lease_owner      text,
  lease_expires_at timestamptz
);

create index outbox_pending on outbox (id) where published_at is null;

create table notifications (
  outbox_id     bigint primary key references outbox(id),
  sent_at       timestamptz not null,
  smtp_message_id text not null,
  epoch         int not null
);

create table idempotency_keys (
  principal     text not null,
  key           text not null,
  request_hash  bytea not null,
  status        int not null,
  response      bytea not null,
  created_at    timestamptz not null default now(),
  primary key (principal, key)
);

create table audit_events (
  seq          bigint generated always as identity primary key,
  canonical    bytea not null,            -- the exact bytes that were hashed
  prev_hash    bytea not null,
  hash         bytea not null,            -- sha256(prev_hash || canonical)
  recorded_at  timestamptz not null default now()
);

create table worker_heartbeats (
  worker_id    text primary key,
  beat_at      timestamptz not null,
  holding_outbox_id bigint
);
```

Notes that matter for implementation:

- `events.xid` is the commit transaction identifier, not a sequence value. Readers see a commit-ordered prefix only (section D.4).
- `audit_events` stores the canonical bytes that were hashed, not `jsonb`. `jsonb` normalises key order and number text, so re-serialising it can change a hash. The Go canonicaliser writes length-prefixed fields in a fixed order; the verifier re-reads those bytes and hashes them.
- `work_orders.version` is incremented by the trigger on every update. Assignment uses it as a compare-and-set guard; offline replay does not (section D.6).
- `transitions` is read by the trigger and also served to the client, so the two cannot disagree.

Row-level security is written against the membership table:

```sql
alter table work_orders enable row level security;
alter table work_orders force row level security;

create policy work_orders_visible on work_orders
  for select to culvert_app
  using (exists (
    select 1 from memberships m
    where m.user_sub = current_setting('app.principal', true)
      and (m.role in ('auditor','operator') or m.region_id = work_orders.region_id)
      and (m.role <> 'technician' or m.crew_id = work_orders.crew_id)
  ));
```

The API sets `app.principal` with `set_config(..., true)` at the start of every transaction, so pooled connections cannot leak a previous principal. The SSE replay runs its query under the same transaction setup for the subscriber.

The audit trigger:

```sql
create function audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit_events is append-only' using errcode = 'insufficient_privilege';
end $$;
create trigger audit_no_update before update or delete on audit_events
  for each row execute function audit_immutable();
```

The trigger is not the integrity mechanism. The owner can drop or disable it. The hash chain is the integrity mechanism, and the trigger only stops accidents and the application (section G describes the external anchor for a privileged full-chain rewrite).

### D.3 Communication

- **Synchronous:** browser to API over HTTPS with JSON. Writes require `Idempotency-Key`. Responses carry `Trace-Id` and, on replays, `Idempotent-Replayed: true`.
- **Asynchronous:** the outbox table, drained by workers. There is no message broker. The reason is atomicity: the outbox row is committed with the state change, which a broker publish cannot offer without a second commit.
- **Real-time:** Server-Sent Events from the API. Each replica holds one dedicated `pgx` connection (not from the pool) that executes `LISTEN culvert_events`. The notification payload is only the event key `xid:seq` (well under the 8000-byte limit). The replica fetches the full event under each subscriber's principal before sending it, so the notification channel never carries data a subscriber is not allowed to see.
- **Stream authentication:** `EventSource` cannot set headers. The web client calls `POST /v1/stream-tickets` with its bearer token and receives a 60-second, single-use ticket, which it puts in the stream URL.
- **Operator plane:** the Ops drawer calls the API, which calls the fault controller over an internal HTTP port with a separate service credential. The fault controller is not reachable from the browser.

### D.4 Event replay without gaps

`LISTEN/NOTIFY` is not durable. If a replica's notify connection drops, it misses notifications, and a stream that reconnects to a different replica could also miss events that committed while it was connecting. The replay algorithm therefore uses the database's commit ordering.

- Every event row records `xid = pg_current_xact_id()`. Transaction identifiers are assigned at first write, not at commit, so two transactions can commit in the order opposite to their identifiers. The `seq` identity alone is therefore not a commit order.
- A reader asks for events where `xid < pg_snapshot_xmin(pg_current_snapshot())` and `(xid, seq) > cursor`, ordered by `(xid, seq)`. The snapshot minimum is the oldest transaction still running; everything below it is committed or aborted, so no later commit can slip in below the cursor.
- A stream replays from its cursor on connect and on every notification. Notifications are a wake-up, not the data path.

This is the technically subtle part of the real-time design, and it is the basis of the first claim in section F.

### D.5 Security boundaries and authorization model

Boundaries, outside to inside:

1. **Browser.** Content-Security-Policy restricts scripts to the bundle origin. Tokens are kept in memory; the refresh token is in an `HttpOnly` cookie scoped to the auth origin.
2. **Edge.** TLS terminated at CloudFront and the ALB; HSTS; WAF rules on the API origin for body size and rate limits. Locally, Traefik provides TLS with a self-signed local certificate and the same headers.
3. **API.** Verifies the JWT signature against JWKS (cached, refreshed on unknown key id), `iss`, `aud` and `exp`. Authorization is not decided here for reads; it is decided in the database by RLS. For writes the API decides which transitions are attempted, but the trigger re-checks the role.
4. **Database.** Roles separate the three trust levels: `culvert_app` (RLS-bound), `culvert_worker` (narrow writes), `culvert_owner` (migrations and the console, not used by the running API). The database console in the Ops drawer is the only path to owner rights in the demo, and its use is itself logged to the audit chain by the console's wrapper.
5. **Operator plane.** Ops role is a separate identity-provider group and, on AWS, a separate Cognito app client that requires MFA. Fault controller has no database role.

Authorization model: principals are identified only by `sub`. Roles and regional or crew scope come from `memberships`, changed only by migrations and by an operator endpoint. Tokens carry no authorization data. This makes the authorization model identical across Cognito and Dex, and it means revoking access takes effect on the next query rather than at token expiry.

### D.6 Consistency requirements per operation

| Operation | Mechanism | Isolation and guarantee |
|---|---|---|
| Create order | Single transaction: `work_orders`, `audit_events`, `outbox`, `events`, `idempotency_keys`. Key checked first in the same transaction. | Read committed suffices; the unique key on `(principal, key)` serialises concurrent retries. Retry returns the stored response. |
| Assign crew (compare-and-set) | `UPDATE work_orders SET ... WHERE id = $1 AND version = $2`, plus audit and outbox in the same transaction. Zero rows means conflict; the API then reads the current row under RLS. | Row lock on the update; exactly one winner per version. |
| Status transition | Trigger validates `(from, to)` against `transitions` and `min_role` against `memberships`, then bumps `version`. | Enforced for every writer, including the owner, because the trigger runs in the transaction. |
| Offline replay action | Each action carries `base_status`, `base_crew_id` (its precondition) and its key. In one transaction: `SELECT ... FOR UPDATE` the order, compare preconditions, apply or return `409 precondition_failed` with the current state. | Serialisable per order by the row lock. Only preconditions are compared, not `version`, so an unrelated edit (for example a priority change) does not create a false conflict. |
| Audit append | `pg_advisory_xact_lock` on a fixed key, read the last hash, compute, insert. | Linear chain. The advisory lock is a serialisation point (section G). |
| Event append and replay | `events` row written with `xid` in the same transaction as the change; replay per D.4. | Commit-ordered prefix; no gaps for any cursor. |
| Outbox claim | `UPDATE outbox SET lease_epoch = lease_epoch + 1, lease_owner = $w, lease_expires_at = now() + interval '10 seconds' WHERE id IN (SELECT id ... WHERE published_at is null AND (lease_expires_at is null OR lease_expires_at < now()) ORDER BY id LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING ...`. Lease time is the database's `now()`. | Only one worker holds a row at a time. Application clocks are not used for lease decisions. |
| Delivery and mark-sent | Before the SMTP send the worker re-checks that its epoch is still current (fence). After a `250` from SMTP, it writes `notifications` and sets `published_at` in one transaction. | At-least-once delivery. A duplicate is possible only between SMTP acceptance and the commit (section G). |
| Reads (board, lists) | Read committed, RLS-filtered. | Eventually consistent with the stream by milliseconds; the client re-fetches on replay. |

### D.7 Deployment topology

**AWS** (Terraform, one state per environment):

- VPC across two Availability Zones. Public subnets hold the ALB and the NAT gateways. Private subnets hold ECS Fargate services: `api` (2 tasks), `worker` (2 tasks), `fault-controller` (1 task, no public route). Isolated subnets hold RDS.
- RDS for PostgreSQL 16, Multi-AZ, storage encrypted with KMS, parameter group with `log_min_duration_statement` set for the console, and `rds.force_ssl` on. Connections go directly to the instance or cluster endpoint, not through RDS Proxy (section G explains why).
- Web bundle in a private S3 bucket behind CloudFront with origin access control. Bucket versioning on. Deployment writes a new immutable prefix and changes only the distribution's default origin path.
- Cognito user pool with two app clients (`culvert-web` with PKCE, `culvert-ops` with MFA required), groups `dispatcher`, `technician`, `auditor`, `operator`, with membership rows as the authority.
- SES verified identities for the demo sender and the demo recipients (sandbox restrictions are handled by verifying them in advance).
- Secrets Manager for the database credentials; IAM task roles per service. The fault controller's task role can call `StopTask` and read task state only for tasks tagged with `culvert-service=api|worker`.
- S3 bucket with Object Lock (compliance mode) for head-hash anchors written by the worker every 100 audit events.
- CloudWatch Logs with structured JSON; ADOT sidecar exporting OTLP to X-Ray.
- ECR repositories for the three images, tag immutability on, digest recorded in the deployment manifest.
- Rollout: the `migrate` task runs to completion first, then `api` and `worker` roll with a minimum healthy percent that keeps one of each serving.

**Local** (Docker Compose, one file, profiles for `demo` and `test`):

- `postgres` (16), `migrate` (one-shot), `seed` (one-shot, deterministic), `api-a` and `api-b` (same image, different `CULVERT_INSTANCE`), `worker-1` and `worker-2`, `fault-controller` behind a socket proxy that allows only `kill` on containers labelled `culvert.service`, `traefik` (routes `/api` to the two API containers, serves the bundle), `web` (static bundle image), `dex`, `mailpit`, `otel-collector`, `jaeger`, `toxiproxy` (in the database path, used only for the optional latency fault).
- Single command: `make up` (build, migrate, seed, start). Single command for reset: `make reset`, which removes volumes and reruns the one-shot services. Health check: `make ready`, which polls the same readiness endpoints the health strip uses.

---

## E. AWS and local deployment

**Container-first and immutable.** Three images: `culvert-app` (the Go binary, distroless static base, non-root user, read-only root filesystem, no shell), `culvert-web` (the built bundle served by a static file server), and `culvert-fault` (the fault controller). Images are built once in CI, labelled with the git commit, scanned, given an SBOM, signed with cosign, and promoted by digest. Nothing is built on the host; nothing is configured by editing a running container. The same `culvert-app` digest runs as the API and as the worker, distinguished only by the subcommand.

**Configuration.** Twelve-factor: environment variables for non-secret settings, Secrets Manager or the local `.env.demo` file for secrets, all listed in one schema file that the binary validates at start. The readiness endpoint reports the schema version and the digest it is running, which the demo console displays.

**Service mapping.**

| Concern | AWS | Local stand-in | What differs | Why behaviour is unchanged |
|---|---|---|---|---|
| Database | RDS PostgreSQL 16 Multi-AZ | `postgres:16` | Failover behaviour (not exercised in the script); storage and backup features | Same engine, same roles, same RLS, same `LISTEN/NOTIFY`. The script does not depend on failover. |
| Load balancer | ALB | Traefik | Deregistration timing is configured per platform (ALB target deregistration delay versus Traefik health check interval); both set to make the kill visible within seconds | Both route to healthy instances; SSE is not buffered by either. |
| Compute | ECS Fargate services | Compose services | Scheduler replaces killed tasks; Compose uses `restart: always` | Both are "process killed, replacement started, identical binary". |
| Identity | Cognito (`cognito:groups` not used for authorization) | Dex (static users) | Token shape, refresh behaviour, MFA support | Authorization comes from `memberships`, so the app sees only `sub` in both. |
| Email | SES SMTP | Mailpit SMTP | Real delivery versus capture | Same SMTP client, same message ID header, same outbox key. |
| Tracing | ADOT to X-Ray | Collector to Jaeger | Deep-link format and retention | Same OTLP from the app; the trace chip shows the same ID in both. |
| Audit anchor | S3 Object Lock | Append-only file in a named volume | Storage guarantees (Object Lock is a stronger guarantee) | Same anchor record format, same verifier flag. |
| Fault injection | ECS `StopTask` on tagged tasks; no latency injection | Socket-proxy `kill`; Toxiproxy latency | Latency fault exists only locally; AWS script does not use it | Process-kill faults have identical semantics: SIGKILL, no graceful drain. |
| Web delivery | CloudFront and S3 | Traefik and static container | Cache invalidation timing | The bundle bytes are identical (digest checked). |

**What is deliberately not identical.** Database failover, managed rotation of credentials, multi-region replication, and autoscaling are not part of the five minutes. The application code does not branch on the environment; the environment differences are in Terraform and Compose only. A test in CI asserts that the `culvert-app` digest in the local stack and in the AWS manifest is the same.

**Parity test.** The Playwright rehearsal (section F, claim 5 and capability 12) runs the full five-minute script against both environments with the same test code. Identical assertions must pass in both. The rehearsal records the image digests and the verifier output string into its report, so the parity claim is a logged fact rather than a statement.

**Reset.** Locally, `make reset` recreates volumes and reseeds. On AWS, a separate demo stack has its own database; a reset task truncates and reseeds it, allowed only when a stack tag `culvert-demo=true` is set. Production-like environments do not have that tag, so the reset path cannot run there. The seed uses fixed UUIDs and a fixed reference time, so the board, crew assignments and first audit sequence numbers are the same on every reset.

---

## F. Five strongest technical claims

Each claim has an executable test and an observable behaviour in the demo. Tests run in the Go test suite or in the Playwright rehearsal, not per change in isolation.

**Claim 1: Real-time streams lose no events and deliver each once, in commit order, across reconnects and replica failures.**
- Test: 40 concurrent writers across two principals generate events while a test proxy randomly resets SSE connections and kills one of two in-process replicas. The subscriber's received sequence is compared with the committed sequence read from `events` ordered by `(xid, seq)`. Assert equality, no duplicates, no gaps. The test includes a deliberately slow writer whose transaction commits after higher-`xid` transactions, to exercise the snapshot-minimum rule.
- Observable: "replayed 4 events; gaps 0; duplicates 0" at 205–230 s.

**Claim 2: Concurrent assignment has exactly one winner, and retries never repeat an effect.**
- Test: 20 goroutines released from a barrier issue assignment requests with the same expected version. Assert one success, nineteen `409` responses carrying the winner, one `assignment.changed` audit row and one `events` row. Then retry the winning request with its key 50 times and assert identical response bodies and no new rows.
- Observable: the race at 85–120 s and the replayed response.

**Claim 3: Authorization holds below the application, for any query.**
- Test: for each principal, run a fixed set of SQL statements (including `SELECT *`, `COUNT(*)`, a join against `events`, and a `DELETE`) directly as `culvert_app` with `app.principal` set and unset, and compare row counts and results with the expected visibility matrix. Include a property test that randomly generates memberships and asserts that for each generated principal the rows returned by a raw query equal the set the policy defines. The test deliberately omits the API layer.
- Observable: `rows visible: 3 of 412` at 55–85 s and the `psql` run that returns zero rows without a principal.

**Claim 4: Any change to an audit record is detected at the exact sequence, including changes made by the owner with the trigger disabled.**
- Test: generate 1,000 random chains of 50–500 events with random payloads. For each chain, choose a random sequence number and a random byte of its `canonical` value, modify it through the owner role with the trigger disabled, and run the verifier. Assert that the first broken sequence reported equals the modified one, and that every later record is reported as unverifiable. Separately assert that the verifier's result is identical when run from the local and the AWS environment on the same chain bytes.
- Observable: the tamper at 270–300 s. The verifier output names sequence 1209.
- Honest scope: a full-chain rewrite by the owner (recomputing every hash) is not detected by the chain alone. The anchor test below covers that case: the verifier compares the head hash with the latest anchor in the external store. The test rewrites the chain and asserts that the anchor mismatch is reported.

**Claim 5: Background delivery produces one visible effect per outbox row across worker kills, with fenced leases and idempotent keys.**
- Test: 200 trials. Each trial enqueues an assignment notification, starts two workers, kills the first worker at a random point (before claim, after claim before send, after send before commit, while the delivery hold is active), and waits for the lease to expire. Assert that the Mailpit (or SMTP test sink) receives at most one message per outbox row, that `notifications` has exactly one row per delivered outbox row, and that every row eventually has `published_at` set. Report the count of trials where a duplicate was delivered: those can occur only in the kill-after-send-before-commit point, and the test must show that every such duplicate carries the same `Message-ID`.
- Observable: the kill during the hold at 230–250 s, with one message in Mailpit and the header `Message-ID: <outbox-1184@culvert>`.
- Honest scope: this is at-least-once delivery with a narrow duplicate window, not exactly-once. The claim is stated that way in the test report.

**Supporting proof for the parity claim (14):** a CI check that the `culvert-app` digest in the local lock file, the ECR repository and the AWS deployment manifest match, and that both running containers report that digest on their readiness endpoint.

---

## G. Failure analysis

### G.1 Implementation difficulties

- **Commit ordering versus sequence numbers.** The naive design uses a sequence for the event stream. Under concurrent transactions this produces silent gaps for any reader that connects between two commits. The `xid` plus snapshot-minimum replay (D.4) fixes it, but it is subtle, depends on the reader's snapshot, and must be tested with deliberately reordered commits. This is the highest-risk correctness item.
- **`LISTEN/NOTIFY` behind a managed proxy.** RDS Proxy pins a client connection to a session when `LISTEN` is used, which defeats pooling and can make the listener hold a pinned connection indefinitely. The design connects the listener straight to the database endpoint. A notification-only listener is also not durable: when it reconnects, the replica must replay from each open stream's cursor, which the replay design handles, but a replica that has no open streams has no cursor and simply resumes listening.
- **SSE across load balancers.** Idle timeouts on the ALB and on Traefik must exceed the heartbeat interval (set to 15 s). Response buffering must be off. Proxies that compress responses can buffer SSE; the API sets `Cache-Control: no-transform` and disables compression on the stream route.
- **EventSource authentication.** Browsers cannot attach an `Authorization` header to `EventSource`. The single-use ticket (D.3) avoids putting the access token in a URL, but tickets must be consumed atomically (a `DELETE ... RETURNING` on a small table) to stop replay within the 60-second window.
- **Offline queue durability.** IndexedDB can be evicted under storage pressure, and a service worker update can reload the page mid-flush. The queue writes an action before updating the UI, flushes one action at a time, and treats `409` as terminal for that action and as a stop for the queue. Client clocks are never used for ordering; the queue order is the insertion sequence local to the device, and the server applies preconditions rather than timestamps.
- **Hash-chain serialisation.** The advisory lock makes every audit append wait for the previous one. That is a deliberate throughput ceiling. At the demo's write rate it is invisible; under sustained load it becomes the bottleneck, and the design would need per-region chains anchored by a global head. This is recorded as a backlog item, not hidden.
- **Canonical encoding.** Hashes must be computed over bytes that cannot change. The canonicaliser is ~150 lines of Go with fixed field order, length prefixes and explicit integer widths. Using `jsonb` text would work until a Postgres upgrade or a key-ordering change alters it; storing the canonical bytes avoids that.
- **Lease time.** Leases must use the database clock. Using application clocks for expiry across Fargate tasks invites skew bugs that look like duplicate deliveries.
- **Fencing is only partial.** A worker that stalls after its lease expires and then resumes will re-check its epoch before sending, but a stall between the check and the SMTP send still produces a duplicate. The fence narrows the window; it does not close it. This is described as such in the code and in the report.
- **Fault controller privilege.** A Docker socket is root-equivalent. Locally the fault controller sees the socket only through a proxy that allows one operation on labelled containers. On AWS its task role is limited by tag condition. Both limits are tested: the test asserts that a request to start an arbitrary container, or to stop an untagged task, is refused.
- **Cognito token details.** Access tokens and ID tokens have different audiences; the API validates `client_id` on access tokens rather than `aud`. JWKS rotation is handled by refetching on unknown `kid`. Refresh in a single-page app needs a backend-for-frontend or the refresh-token cookie; the design uses the cookie on the auth origin.
- **Cold starts.** Fargate tasks can take tens of seconds to start after a kill. The demo keeps the desired count at two and never scales to zero, and the Ops drawer shows the replacement task's state rather than a spinner.

### G.2 On-stage failure modes and mitigations

| Failure mode | Effect on the audience | Mitigation |
|---|---|---|
| Venue network drops during the AWS segment | Health strip red, CloudFront or ALB unreachable | The AWS stack is shown only after the local run; the presenter's cellular connection is the second network; the script's local portion runs without any internet access. The AWS window is a parity display, not the critical path. |
| SSE stream stuck after kill (EventSource does not reconnect promptly) | Sam's board freezes | The client reconnects on error with its own backoff and shows "reconnecting" in the health strip; the rehearsal asserts reconnect within 3 s. |
| Race requests not truly concurrent (client serialises) | Nineteen losers never happen; "one winner" looks trivial | The button uses a barrier in the browser with one connection per request (HTTP/1.1 with separate sockets), and the panel shows the server-side arrival spread from the request log. |
| Notification delivered to Mailpit late | Email count not 1 at 250 s | The panel also shows the `notifications` row; the rehearsal sets the hold to a fixed 20 s, so the kill timing is deterministic. |
| Chain verifier slow on a long chain | Verify takes seconds | Chain length is fixed by the seed and the script; verification is incremental from a stored checkpoint, and the claim in the script is only about the demo's chain length. |
| Presenter types the wrong SQL in the console | Tamper hits the wrong sequence | The tamper is a stored procedure called by name; the console displays the sequence to be changed before it runs and requires confirmation. |
| Playwright offline emulation differs from the real network stack | Queue does not flush as rehearsed | The rehearsal uses the same emulation the presenter uses (DevTools network offline), and the rehearsal asserts that the flush order is the insertion order. |
| Email sender identity rejected by SES | No email on AWS | Identities verified in advance; the rehearsal fails loudly if the send is refused. |
| Port conflicts on the presenter machine | Compose fails | The Compose file uses fixed high ports, and `make ready` runs before the audience arrives. |
| Clock drift on the presenter's laptop | Trace chip times look wrong | Times shown are server times from the event row, not the browser's. |

### G.3 Hidden complexity

- The read path is invisible but carries the authorization burden: every query that the board runs is a policy evaluation. The membership index and the RLS predicate must be checked with `EXPLAIN` in the rehearsal, because a naive predicate can turn a list into a full scan.
- Replay correctness depends on the snapshot-minimum rule. A long-running transaction (for example a slow report) holds back the replay watermark. That is correct, but it means a stuck transaction delays live updates, which the health strip would show as "events behind". This is worth demonstrating deliberately in a later iteration, not in the five minutes.
- The offline queue is a second state machine on the client. Keeping its preconditions in sync with the server's trigger means the transition table is served to the client and the client's precondition shapes are generated from the same schema.
- Trace propagation has many small failure points: CORS must allow the `traceparent` header, the ALB must not strip it, and the worker must read it from the outbox row rather than from the request.

### G.4 Features that look impressive but are shallow

Honest list of what I would not defend under questioning:

- **The Resilience panel as a set of buttons** is shallow unless each button's effect is read back from the system. The design counts only when the panel shows the stream's replay counters and the lease state from the database. A button that just calls an endpoint would be a stage prop.
- **The health strip** could be a fake green light if it read a cache. It must query readiness, heartbeats and outbox lag at each refresh. The design requires that.
- **The audit "viewer"** that lists rows is a table. The impressive part is the verifier and the broken-link strip, and without the verifier the page is CRUD over a log.
- **"Multiple browser sessions"** can be three tabs of one user. The design uses three principals with distinct memberships; if they shared a session the RLS demo would be meaningless.
- **Offline mode** that merely shows a banner is shallow. The part worth showing is the ordered replay and conflict split, which is real in this design but only if the queue is durable.
- **The trace chip** is decoration if the ID is not stored with the event and the outbox row. It is included only because it is stored.
- **Email** is incidental. It is in the demo to make the worker's effect visible, not because email is interesting.
- **Multi-region claims** are absent on purpose. Adding a second region to the demo would add a row to the table, not a new capability.
- **AWS-side verification** only shows that the same digest runs. It does not prove the same behaviour under load, and the document does not claim that.

---

## H. Feasibility

### H.1 Scope by component

| Component | What the work touches | Relative size (by moving parts) |
|---|---|---|
| Database schema, migrations, RLS policies, triggers, transition table, seed | 12 tables, 3 roles, 1 policy set, 3 triggers, 2 functions | Medium: the most correctness-sensitive component; most tests attach here |
| Audit canonicaliser and verifier | One package, one command, one anchor writer | Small in lines, high in test weight |
| API (HTTP handlers, transactions, idempotency, streams, tickets, OIDC middleware) | About 25 endpoints across orders, assignments, transitions, streams, memberships and operator routes | Medium-large |
| Replay and `LISTEN/NOTIFY` fan-out | One notifier per replica, one replay function | Small in code, large in tests |
| Worker (outbox claim, fencing, SMTP, heartbeat, anchor) | One loop, one sender, one heartbeat | Small |
| Web client (board, detail, assignment, conflict tray, Ops drawer, audit page) | About 8 screens or panels, one design system | Medium-large: the visual quality bar is set here |
| Offline queue (IndexedDB, service worker, replay UI, conflicts inbox) | One store, one flush routine, one conflict view | Medium: subtle, but bounded |
| Fault controller | Four operations, two allow-lists | Small |
| Local Compose and Traefik configuration | One file, several small configs | Small |
| Terraform for AWS | VPC, ECS services, ALB, RDS, Cognito, CloudFront, S3, SES identities, IAM, ECR, Secrets Manager, Object Lock bucket | Large in breadth; mostly declarative |
| Playwright rehearsal (three contexts, offline emulation, digest capture) | One script that drives section C | Medium; it is also the acceptance test |

### H.2 Build order (dependency-driven)

Each step is runnable and testable on its own, and each is a precondition for the next.

1. **Schema and roles.** Migrations, RLS, transition table, trigger, seed, and the owner/app split. Testable with raw SQL (claim 3 can run here).
2. **Minimum vertical slice.** One endpoint to create an order and one to read the board, with the event row written, NOTIFY sent, and a single SSE stream replaying from cursor. Local Compose with Postgres and one API replica. This proves the architecture end to end.
3. **Audit chain and verifier.** Every write path appends; verifier command and the tamper test (claim 4).
4. **Assignment and idempotency.** CAS assignment, the race test (claim 2), idempotency table, replay headers.
5. **Replay correctness at scale.** Two replicas, the xid watermark tests and the reordered-commit test (claim 1).
6. **Outbox and worker.** Leases, fencing, SMTP to Mailpit, heartbeats, and the 200-trial kill test (claim 5).
7. **Web client.** Board, detail, assignment, conflict tray, live updates. Visual system applied here.
8. **Offline queue.** IndexedDB store, ordered flush, precondition errors, conflicts inbox. Depends on 4 and 7.
9. **Fault controller and Resilience panel.** Depends on 2 and 6, since it reads their state.
10. **Ops console and audit page.** Verifier UI, tamper procedure, database console wrapper. Depends on 3.
11. **Rehearsal.** Playwright script for section C on local Compose. Depends on 1 through 10.
12. **Terraform and AWS deployment.** Depends on the images from 2 through 10 being stable; the same rehearsal then runs against AWS.
13. **Parity and digest checks in CI.** Last, because it compares artifacts that must already exist in both places.

Dependency edges that matter most: step 5 gates the real-time claim; step 6 gates the worker kill; step 8 gates the offline segment; step 12 cannot start before the image and configuration contract is frozen by step 10.

### H.3 Critical dependencies

- Amazon Cognito quirks (token audiences, refresh behaviour, hosted UI redirects) and a working pre-issued session for the demo accounts.
- RDS PostgreSQL 16 with `rds.force_ssl`, direct connections for `LISTEN`, and a parameter group that allows the owner-console wrapper's logging.
- Traefik's SSE handling and health-check timing against the ALB's, which must both be tuned to the demo's kill window.
- Playwright's offline emulation and its ability to run three contexts with separate storage.
- SES sender and recipient identities verified in advance.
- Dex maturity for the local identity path (static users, PKCE).
- Fargate task start time for replacement tasks.

### H.4 Main risks

1. **Replay correctness under concurrency** (claim 1). Highest risk; it is also the most valuable claim. Mitigated by building the replay tests before the UI at step 5.
2. **Offline queue durability and ordering** on real browsers. Mitigated by testing against the browser's offline emulation and a killed-tab scenario.
3. **Cross-environment parity drift.** Two Terraform and Compose definitions can diverge silently. Mitigated by the digest check and by running the same rehearsal in both.
4. **Visual quality bar.** A dense operational interface can look like an admin template. Mitigated by a deliberate design system (dark ops palette, status colour rules, the chain strip as the signature visual) applied from step 7.
5. **Presenter reliability.** Three windows, an Ops drawer and a console on one machine. Mitigated by the scripted setup, the reset command and a rehearsal checklist.
6. **Scope creep into features that do not add capabilities.** Mitigated by the rule that every new screen must be a read-back of one of the twelve capabilities.

---

## Summary of positions taken

- Authorization lives in Postgres tables and RLS, not in token claims.
- The outbox is in the database, not in a broker, because atomicity with the state change matters more than the broker's fan-out.
- Real-time is `LISTEN/NOTIFY` as a wake-up with a commit-ordered replay as the data path.
- Offline replay compares preconditions, not versions.
- The audit chain uses canonical bytes, an append-only trigger as an accident guard, and an external head anchor for the case the trigger cannot stop.
- The demo uses process kills and delivery holds as its faults. Latency injection is local only and is not in the script.
- Every claim has a test; the rehearsal runs the five-minute script on both deployments.
