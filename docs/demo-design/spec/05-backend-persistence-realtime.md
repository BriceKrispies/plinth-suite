# Plinth specification 05: backend services, persistence and real-time

This document specifies mission sections 7 (backend services and application boundaries), 8 (persistence,
transactions and consistency) and 9 (real-time communication and asynchronous processing). It implements the
winning proposal (`../revised/04-emergent-composition.md`, section D.2 and D.4 to D.6) under the binding amendments
in `../../selection-rationale.md`, principally P2, P5, P6, P8, P9, P10, P11, P13, P14, P15 and P19, and under the
canonical facts in `README.md`. Where this document narrows or changes the proposal, the change is stated where it
occurs, and the decision is listed in the closing note on ambiguities.

Every property is labelled **Guarantee** (enforced by the code and covered by a named test) or **Target** (a design
goal, measured in the rehearsal harness before it is claimed). Acceptance criteria use the ids `AC-<area>-<n>`. This document owns the `AC-TX`, `AC-RT` and `AC-DATA` prefixes; its other ids carry the document number (`AC-05-SVC-<n>`, `AC-05-QRY-<n>`, `AC-05-RULE-<n>`, `AC-05-WF-<n>`), as README ruling 20 requires where ids collide.
Nothing here is built. Durations below are configuration values or measured quantities, not work estimates.

---

## 7. Backend services and application boundaries

### 7.1 Processes and images

Five images are built from one repository (`README.md`, images). Each image is immutable, digest-pinned, and runs the
same digest locally and on AWS. The entrypoint selects the process.

| Image | Process (entrypoint argument) | Listens on | Owns |
|---|---|---|---|
| `plinth-app` | `api` | HTTP 8782 (behind the edge on 8780); serves the web assets | HTTP API, OIDC verification, the web single-page application |
| `plinth-app` | `rt` | WebSocket 8781 at `/rt` | Realtime gateway, presence, outbox relay |
| `plinth-app` | `mcp` | stdio, or Streamable HTTP 8790 at `/mcp` | MCP server, MCP resource subscriptions |
| `plinth-app` | `presenter-control` | HTTP 8791 (`PLINTH_PRESENTER_PORT`; separate listener, separate credential) | Presenter control API (fault cue, clock, driver mode and driver step); see AC-05-SVC-4 |
| `plinth-worker` | `serve` | none (outbound only) | Rule evaluator, workflow runner, action runner, backtests, scheduled exports |
| `plinth-ingest` | `serve` | none (outbound only) | Kafka consumers, Parquet landing, publication, watermarks |
| `plinth-gen` | `serve` or `build-history` | none | Seeded generator, virtual clock, fault application, history build and manifest |
| `plinth-driver` | `replay` or `record` | none | Replay driver: a client of the MCP and HTTP paths, with its own principal |

`plinth-driver` is a client and holds no authority of its own; it acts as `service:replay-driver` (P9). It is listed
here because it has an image, not because it is a service in the runtime graph.

### 7.2 Module boundaries

These boundaries are structural. Each one has a test, so a change that breaks one fails the build.

1. **One write path (Guarantee).** The function `commitChanges()` in `plinth-core` is the only code that writes
   `workspaces`, `nodes`, `changes`, `workspace_chain`, `idempotency_records`, `preview_tokens`, `approvals`,
   `outbox`, `snapshots`, `rule_state`, `rule_firings`, `action_runs`, `workflow_instances`, `workflow_transitions`,
   `grant_index`, `branches` and `fault_cues`. Every other module requests a commit. The build fails on a SQL write
   to these tables outside the module (AC-05-SVC-1).
2. **One authorization function (Guarantee).** `authorize(principal, action, resource_uri, context)` returns
   `allow`, `deny(reason)` or `allow_with(row_predicate, column_mask)`. The HTTP handlers, MCP tools, realtime
   subscriptions, rule and workflow runners, and the replay driver each call it. No module reads `grant_index`
   directly (AC-05-SVC-2).
3. **One read path (Guarantee).** `plinth-query` compiles and `plinth-engine` executes. Only `plinth-engine` opens a
   DuckDB connection. Node reads (`node.get`, `node.search`) read `nodes` through the same `authorize` read rewrite
   and do not go through the query engine.
4. **MCP and HTTP share service functions (Guarantee).** The MCP server calls the same in-process service functions
   as the HTTP handlers. It never calls HTTP on loopback. AC-05-SVC-3 compares the two surfaces on the same request
   corpus.
5. **No service-to-service RPC (Guarantee).** Processes communicate through four channels only: PostgreSQL (the
   authority), Redis (fan-out hints and presence), Kafka (raw events) and S3 (immutable partitions). The worker and
   the gateways are woken by Postgres `NOTIFY`, and their decisions are re-derived from Postgres rows, never from
   message payloads.
6. **Fault control is outside the agent's reach (Guarantee).** The presenter control API runs on its own listener
   with its own credential (P15). Its routes are absent from the MCP tool list and from every grant. AC-05-SVC-4 asserts
   both.
7. **The web client computes nothing authoritative (Guarantee).** It sends Changes and queries, and renders the
   results and the events it receives. Its only local state is session state (P3): parameters, brushing and drill
   state, held in the URL and the session, never in `changes`.

### 7.3 Service catalogue

**api.** Fastify routes. Each route validates its body against the schema generated from the spec (`plinth-spec`),
calls `authorize`, then calls one service function. It returns the envelope of P5 (the envelope is specified in
`06-mcp-server.md`). It holds no state beyond the connection pool.

**mcp.** The same service functions as `api`, behind the fifteen-tool catalogue in `06-mcp-server.md` (the
tools named in the canonical facts). It keeps one in-process table of resource subscriptions per
session (section 9.6). Its progress notifications come from the engine's batch callbacks. It has no authority of its
own: every call runs as the authenticated agent principal, scoped by the ceiling (`03-authorization-and-security.md`).

**rt.** WebSocket gateway. It keeps, per connection, the subscriptions, the last sequence number delivered per
subscription, and the presence heartbeats. It runs the outbox relay (section 9.1). It reads change rows from
Postgres to build every event it sends.

**presenter-control.** Presenter control API. It accepts the fault cue (F7), clock, driver mode and driver step requests, and serves control and driver status, all on the `/control/...` routes listed in `03-authorization-and-security.md` section 11. A cue is written to
`fault_cues` and applied by the generator at the next tick (section 9.1). It is not reachable from the agent and it
does not appear in `schema.describe`.

**worker.** Four loops in one process, each driven by a Postgres `NOTIFY` and a fallback poll: the rule evaluator
(section 9.2), the action runner (section 9.3), the workflow runner (section 9.4), and backtest and scheduled-export
jobs. The worker writes only through `commitChanges()`, as `service:rule-worker` with `surface = 'system'`.

**ingest.** Kafka consumer group `plinth-ingest` on topic `northwind.orders.v1` (and the carrier and capacity
topics). It lands immutable Parquet partitions and publishes them (section 8.8). It commits Kafka offsets only after
the matching `source_partitions` row is published.

**gen.** The seeded generator (`xoshiro256**`, seed committed). It owns the virtual clock, applies `FaultProfile`s at
ticks, emits one heartbeat per shard per tick so that watermarks advance during quiet periods, and builds the
history manifest once at build time. Its output for a given tick is a pure function of the seed and the profiles
applied at or before that tick (`../revised/04-emergent-composition.md`, section A).

**driver.** Replay driver. It records transcripts from live runs and replays them with `as_of` and tick binding,
using the MCP and HTTP paths. Section 8.6 gives its ambiguous-commit rule.

### 7.4 Startup order and readiness

Dependencies start in this order, and each step waits for the readiness check of the step before it:

1. PostgreSQL 16 (or Aurora), Redis, the Kafka-protocol broker (MSK or Redpanda), S3 (or MinIO), and the identity
   provider (Cognito or Keycloak).
2. `plinth-app migrate`, which applies the DDL in section 8.2 and verifies the schema hash.
3. `plinth-gen` verifies the history manifest hash against the snapshot (test `history_reproduces`, `04` section E.4).
4. `plinth-ingest`, then `plinth-worker`, then the `plinth-app` processes.
5. `plinth-driver`, only when a rehearsal or the demo requests it.

`/healthz` reports liveness. `/readyz` reports readiness with per-dependency results, and a process is ready only
when its own dependencies answer, except Redis, which never blocks readiness: `rt` reports degraded but stays ready (README ruling 15; `07-deployment.md` section 11.5). **Guarantee** for ordering: `make up` does not return success until every
`/readyz` returns `ready` (AC-05-SVC-5).

### 7.5 Acceptance criteria for section 7

- **AC-05-SVC-1.** A static check fails the build if any module other than `plinth-core`'s commit path contains SQL that
  writes a table listed in 7.2 item 1. (Guarantee.)
- **AC-05-SVC-2.** A static check fails the build if any module other than `authorize` queries `grant_index`. A
  differential test drives every HTTP route, every MCP tool and the realtime subscribe frame with a denied principal
  and asserts that each returns `FORBIDDEN` before any data is read. (Guarantee.)
- **AC-05-SVC-3.** For a corpus of 500 requests, the HTTP and MCP surfaces return the same result hash and write the same
  change hashes. (Guarantee.)
- **AC-05-SVC-4.** The MCP `tools/list` response contains no fault or presenter route, and the agent principal holds no
  grant that covers the control listener. (Guarantee.)
- **AC-05-SVC-5.** `make up` returns success only when every `/readyz` reports ready, and a killed dependency other than
  Redis makes the dependent process report not ready within one check interval. (Guarantee.)

---

## 8. Persistence, transactions and consistency

### 8.1 Authority and stores

PostgreSQL 16 is the only authority for state. The following are authoritative: nodes and their revisions, the change
log and its hash chain, idempotency records, preview tokens, approvals, grants (the index), rule and workflow state,
and the list of published partitions. Object storage holds immutable Parquet partitions, the history manifest and
exports. DuckDB reads these and never writes authority. Redis holds presence and fan-out hints. **Guarantee:** no
invariant in this document references Redis; Redis loss changes latency only (test `redis_loss_no_loss`, AC-RT-6).

### 8.2 Schema

The DDL below is the schema the commit path, the engine and the workers use. Names agree with the canonical facts.
Changes from the revised proposal are marked in the comments and listed in the closing note.

```sql
CREATE TABLE workspaces (
  workspace_id        uuid PRIMARY KEY,
  slug                text NOT NULL UNIQUE,
  grant_index_version bigint NOT NULL DEFAULT 0,   -- bumped in the grant commit (8.4 step 10)
  mask_version        int    NOT NULL DEFAULT 0,
  manifest_id         text   NOT NULL,             -- history manifest (04 E.4)
  run_prefix          text   NOT NULL,             -- per-run object prefix, removed at reset
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE principals (
  principal_id  uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces,
  kind          text NOT NULL CHECK (kind IN ('human','service','agent')),
  subject       text NOT NULL,
  display_name  text NOT NULL,
  delegator_id  uuid REFERENCES principals,        -- agents: the human they act for (on_behalf_of)
  max_scope     jsonb,                              -- agents: the ceiling, set by an administrator only
  disabled_at   timestamptz,
  UNIQUE (workspace_id, subject),
  CHECK (kind <> 'agent' OR (delegator_id IS NOT NULL AND max_scope IS NOT NULL))
);

CREATE TABLE nodes (
  workspace_id uuid NOT NULL REFERENCES workspaces,
  node_id      uuid NOT NULL,                       -- UUIDv5(workspace, kind, slug)
  kind         text NOT NULL CHECK (kind IN ('Dashboard','Panel','Query','Source','Parameter','Rule',
                 'Action','Form','Workflow','Grant','Metric','Template','Export','Annotation','Comment')),
  slug         text NOT NULL,
  revision     bigint NOT NULL CHECK (revision >= 1),
  body         jsonb NOT NULL,
  body_hash    bytea NOT NULL,
  deleted_at   timestamptz,                         -- soft delete; the slug stays reserved
  created_seq  bigint NOT NULL,
  updated_seq  bigint NOT NULL,
  PRIMARY KEY (workspace_id, node_id),
  UNIQUE (workspace_id, kind, slug)
);

-- One head row per workspace. Every commit locks it first, so commits in a workspace are serial.
CREATE TABLE workspace_chain (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces,
  head_seq     bigint NOT NULL DEFAULT 0,           -- equals the number of change rows in the workspace
  head_hash    bytea  NOT NULL
);

-- The only log. Sequence numbers are dense per workspace (changed from the proposal's global bigserial,
-- so that head_seq is the row count per workspace, as AC-TX-3 requires).
CREATE TABLE changes (
  workspace_id    uuid NOT NULL REFERENCES workspaces,
  seq             bigint NOT NULL,
  kind            text NOT NULL DEFAULT 'change' CHECK (kind IN ('change','present','event')),
  commit_id       uuid NOT NULL,                    -- rows of one commit share it
  node_id         uuid NOT NULL,
  base_revision   bigint,
  result_revision bigint,
  actor_id        uuid NOT NULL REFERENCES principals,
  on_behalf_of    uuid REFERENCES principals,
  approved_by     uuid REFERENCES principals,
  approval_id     uuid,
  surface         text NOT NULL CHECK (surface IN ('ui','api','mcp','driver','system','cli')),
  session_id      text,
  branch_id       uuid,
  rule_id         text NOT NULL,                    -- closed commit-rule table (8.4 step 7)
  change_hash     bytea NOT NULL,
  ops             jsonb NOT NULL,
  inverse_ops     jsonb NOT NULL,
  paths           text[] NOT NULL,
  payload         jsonb,                            -- present and event rows only
  reason          text,
  undo_of         bigint,
  replay_of       text,                             -- '<transcript_id>:<step>'; required iff surface = 'driver'; hashed in the chain row, excluded from change_hash
  replay_change_hash bytea,                         -- the recorded change_hash of a replayed row; hashed in the chain row
  recorded_actor  text,                             -- the recorded principal of a replayed row; hashed in the chain row
  virtual_at      timestamptz,                      -- demo virtual time; audit-window queries filter on it
  merged_from     bigint[],
  contains_untrusted boolean NOT NULL DEFAULT false,
  prev_hash       bytea NOT NULL,
  hash            bytea NOT NULL,
  created_at      timestamptz NOT NULL,             -- passed in by the commit transaction, and hashed
  PRIMARY KEY (workspace_id, seq),
  UNIQUE (node_id, result_revision),
  FOREIGN KEY (workspace_id, undo_of) REFERENCES changes (workspace_id, seq),
  CHECK ((kind = 'change') = (base_revision IS NOT NULL AND result_revision IS NOT NULL)),
  CHECK ((surface = 'driver') = (replay_of IS NOT NULL))
);

-- Scoped to the acting principal. The request hash detects reuse with a different body.
CREATE TABLE idempotency_records (
  workspace_id    uuid NOT NULL,
  principal_id    uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_hash    bytea NOT NULL,
  commit_id       uuid NOT NULL,
  result          jsonb NOT NULL,                   -- the response, including pending_approval state
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, principal_id, idempotency_key)
);

-- Preview tokens are authority to commit, so they live where commits are checked.
CREATE TABLE preview_tokens (
  token_hash        bytea PRIMARY KEY,              -- sha256 of the 256-bit token; the token is never stored
  workspace_id      uuid NOT NULL,
  principal_id      uuid NOT NULL,
  change_hash       bytea NOT NULL,
  base_revisions    jsonb NOT NULL,                 -- {node_uri: revision}
  issued_at         timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  consumed_at       timestamptz,
  consumed_by       uuid,                           -- commit_id
  CHECK ((consumed_at IS NULL) = (consumed_by IS NULL))
);
CREATE INDEX preview_tokens_open ON preview_tokens (workspace_id, principal_id) WHERE consumed_at IS NULL;

-- Written in the commit transaction, one row per change row. Relayed after commit (9.1).
CREATE TABLE outbox (
  workspace_id uuid NOT NULL,
  seq          bigint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  relayed_at   timestamptz,
  PRIMARY KEY (workspace_id, seq),
  FOREIGN KEY (workspace_id, seq) REFERENCES changes (workspace_id, seq)
);
CREATE INDEX outbox_unrelayed ON outbox (workspace_id, seq) WHERE relayed_at IS NULL;

-- Changes held for a named approver (G8). The approver may be neither the requester nor the delegator (P7).
CREATE TABLE approvals (
  approval_id     uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces,
  commit_id       uuid NOT NULL UNIQUE,
  node_id         uuid NOT NULL,
  ops             jsonb NOT NULL,
  base_revisions  jsonb NOT NULL,
  change_hash     bytea NOT NULL,
  rule_id         text NOT NULL,
  requested_by    uuid NOT NULL REFERENCES principals,
  on_behalf_of    uuid REFERENCES principals,
  state           text NOT NULL CHECK (state IN ('pending_approval','approved','rejected')),
  decided_by      uuid REFERENCES principals,
  decided_at      timestamptz,
  decision_reason text,                            -- 'conflict' when an approved change no longer merges
  change_seq      bigint,                          -- set when applied
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'pending_approval') = (decided_by IS NULL)),
  CHECK (decided_by IS NULL OR (decided_by IS DISTINCT FROM requested_by
                                AND decided_by IS DISTINCT FROM on_behalf_of))
);

-- Projection of Grant nodes. Rebuilt in the grant's own commit transaction.
CREATE TABLE grant_index (
  workspace_id      uuid NOT NULL REFERENCES workspaces,
  grant_node_id     uuid NOT NULL,
  principal_id      uuid NOT NULL REFERENCES principals,
  action            text NOT NULL,
  resource_prefix   text NOT NULL,
  effect            text NOT NULL CHECK (effect IN ('allow','deny')),
  row_predicate_ast jsonb,
  column_mask       text[],
  mask_version      int NOT NULL,
  expires_at        timestamptz,
  index_version     bigint NOT NULL,
  PRIMARY KEY (workspace_id, grant_node_id, principal_id, action)
);

-- Informational, not hash-chained, not authority. Feeds the query.runs metadata source.
CREATE TABLE query_runs (
  run_id       uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  surface      text NOT NULL,
  query_hash   bytea NOT NULL,
  policy_hash  bytea NOT NULL,
  as_of        timestamptz NOT NULL,
  cache_hit    boolean NOT NULL,
  plan         jsonb NOT NULL,                     -- compiled SQL and injected predicates (query.explain)
  row_count    bigint,
  duration_ms  int,
  result_hash  bytea,
  error_code   text,
  started_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_shards (
  source_id   text PRIMARY KEY,
  shard_count int NOT NULL CHECK (shard_count >= 1)  -- from the Source node (spec.shards)
);

CREATE TABLE source_partitions (
  source_id     text NOT NULL REFERENCES source_shards,
  shard         int  NOT NULL,
  shard_seq     bigint NOT NULL,                   -- position within the shard, dense from 1
  partition_key text NOT NULL,                     -- deterministic: source/shard/window/offset-range
  object_key    text NOT NULL,
  event_min     timestamptz NOT NULL,
  event_max     timestamptz NOT NULL,
  row_count     bigint NOT NULL,
  content_hash  bytea NOT NULL,
  published     boolean NOT NULL DEFAULT false,
  published_at  timestamptz,
  PRIMARY KEY (source_id, partition_key),
  UNIQUE (source_id, shard, shard_seq),
  CHECK (published = (published_at IS NOT NULL))
);
CREATE INDEX source_partitions_published ON source_partitions (source_id, shard, event_max) WHERE published;

-- Watermark per source: the minimum over the declared shards of the newest published event time.
-- A shard with nothing published holds the watermark at -infinity.
CREATE VIEW source_watermark AS
SELECT s.source_id,
       min(COALESCE(m.shard_max, '-infinity'::timestamptz)) AS watermark
FROM source_shards s
CROSS JOIN LATERAL generate_series(0, s.shard_count - 1) AS g(shard)
LEFT JOIN (SELECT source_id, shard, max(event_max) AS shard_max
           FROM source_partitions WHERE published GROUP BY source_id, shard) m
  ON m.source_id = s.source_id AND m.shard = g.shard
GROUP BY s.source_id;

-- Rule state per (rule, group key). A group is one value of the rule query's group column (region in the demo).
CREATE TABLE rule_state (
  workspace_id      uuid NOT NULL REFERENCES workspaces,
  rule_node_id      uuid NOT NULL,
  group_key         text NOT NULL,
  state             text NOT NULL CHECK (state IN ('ok','pending','firing','resolved')),
  firing_id         uuid,                          -- set while firing; one notification per firing
  breach_windows    int NOT NULL DEFAULT 0 CHECK (breach_windows >= 0),
  pending_since     timestamptz,
  last_window_end   timestamptz NOT NULL,          -- compare-and-set guard for window evaluation
  last_value        double precision,
  updated_seq       bigint,
  PRIMARY KEY (workspace_id, rule_node_id, group_key),
  CHECK ((state = 'firing') = (firing_id IS NOT NULL) OR state = 'resolved')
);

CREATE TABLE rule_firings (
  firing_id            uuid PRIMARY KEY,
  workspace_id         uuid NOT NULL REFERENCES workspaces,
  rule_node_id         uuid NOT NULL,
  group_key            text NOT NULL,
  opened_window_end    timestamptz NOT NULL,
  resolved_window_end  timestamptz,
  owner_id             uuid NOT NULL REFERENCES principals,
  on_behalf_of         uuid REFERENCES principals,
  effective_principal  uuid NOT NULL REFERENCES principals,
  authority            jsonb NOT NULL,             -- the three inputs of the intersection (D.5)
  payload              jsonb NOT NULL,             -- value, threshold, group, window
  opened_seq           bigint NOT NULL,
  resolved_seq         bigint,
  UNIQUE (workspace_id, rule_node_id, group_key, opened_window_end)
);

CREATE TABLE action_runs (
  run_id              uuid PRIMARY KEY,
  workspace_id        uuid NOT NULL REFERENCES workspaces,
  action_node_id      uuid NOT NULL,
  firing_id           uuid REFERENCES rule_firings,
  idempotency_key     text NOT NULL UNIQUE,        -- 'firing:<firing_id>:<action_node_id>:<edge>'
  effective_principal uuid NOT NULL REFERENCES principals,
  state               text NOT NULL CHECK (state IN ('queued','running','sent','failed','refused')),
  attempts            int NOT NULL DEFAULT 0,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  external_ref        text,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX action_runs_due ON action_runs (next_attempt_at) WHERE state IN ('queued','failed');

-- Projection of workflow instances. An instance is also a Workflow node whose body carries the same state.
CREATE TABLE workflow_instances (
  workspace_id        uuid NOT NULL REFERENCES workspaces,
  instance_node_id    uuid NOT NULL,
  definition_node_id  uuid NOT NULL,
  firing_id           uuid REFERENCES rule_firings,
  state               text NOT NULL CHECK (state IN ('open','acknowledged','resolved','closed')),
  revision            bigint NOT NULL,
  opened_seq          bigint NOT NULL,
  updated_seq         bigint NOT NULL,
  PRIMARY KEY (workspace_id, instance_node_id)
);

CREATE TABLE workflow_transitions (
  workspace_id     uuid NOT NULL,
  change_seq       bigint NOT NULL,                -- one transition per change row
  instance_node_id uuid NOT NULL,
  from_state       text NOT NULL,
  to_state         text NOT NULL,
  trigger          text NOT NULL CHECK (trigger IN ('rule','action','human','system')),
  actor_id         uuid NOT NULL REFERENCES principals,
  on_behalf_of     uuid REFERENCES principals,
  at               timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, change_seq),
  FOREIGN KEY (workspace_id, change_seq) REFERENCES changes (workspace_id, seq)
);

CREATE TABLE branches (
  branch_id     uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces,
  node_id       uuid NOT NULL,
  name          text NOT NULL,
  base_revision bigint NOT NULL,
  head_revision bigint NOT NULL,
  created_by    uuid NOT NULL REFERENCES principals,
  state         text NOT NULL CHECK (state IN ('open','merged','abandoned')),
  UNIQUE (workspace_id, node_id, name)
);

-- Written in the commit transaction when result_revision % 50 = 0 (D.11). Bounds replay time.
CREATE TABLE snapshots (
  workspace_id uuid NOT NULL,
  node_id      uuid NOT NULL,
  revision     bigint NOT NULL,
  body         jsonb NOT NULL,
  body_hash    bytea NOT NULL,
  created_seq  bigint NOT NULL,
  PRIMARY KEY (workspace_id, node_id, revision)
);

-- Presenter cues. Read by the generator; never read by the agent's tools.
CREATE TABLE fault_cues (
  cue_id       uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces,
  profile_id   text NOT NULL,                      -- 'emea-crane-handoff' in the demo
  source       text NOT NULL CHECK (source IN ('presenter','script')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  applied_tick bigint,
  applied_at   timestamptz,
  CHECK ((applied_tick IS NULL) = (applied_at IS NULL))
);
```

### 8.3 Invariants

Each invariant is a **Guarantee** and has a test.

- **I1 Dense chain.** For every workspace, the `changes` rows have `seq` 1..`head_seq` with no gap and no fork, and
  `head_hash` equals the `hash` of row `head_seq`. Test `chain_linear_under_concurrency` (AC-TX-3).
- **I2 Chain links.** `prev_hash` of row n equals `hash` of row n-1, and row 1 has `prev_hash` of 32 zero bytes.
  Verified by `GET /audit/verify` on demand and at startup; a failure is a visible status-page error.
- **I3 Revision lines.** For each node, `result_revision` values are consecutive from 1, and the node's `revision`
  equals the maximum of its `result_revision`. Enforced by `UNIQUE (node_id, result_revision)` and by the commit.
- **I4 Outbox completeness.** Every `changes` row has exactly one `outbox` row in the same transaction.
- **I5 Single consumption.** A preview token is consumed at most once, and every consumed token has an
  `idempotency_records` row with the same `commit_id` (8.6 depends on this).
- **I6 No unpublished visibility.** A `source_partitions` row with `published = false` is never read by a query, and
  a partition's object is never named in a query plan before its row is published.
- **I7 Firing uniqueness.** At most one `rule_firings` row exists per (workspace, rule, group, opened_window_end), and
  at most one open firing exists per (rule, group).
- **I8 Approval separation.** `approvals.decided_by` is neither `requested_by` nor `on_behalf_of` (CHECK, and P7 test).

### 8.4 The commit transaction, step by step

A commit request carries an ordered list of operations on one or more nodes (`node.commit` with `patch`, or a UI
Change, or an Action's effects). Each node touched receives one `changes` row, and all rows of one request share
`commit_id`. The request is one transaction.

**Before the transaction (no locks; cancellable).**

- P0a. Parse and schema-validate the request against the spec. Errors: `VALIDATION_FAILED`, `UNKNOWN_FIELD`,
  `UNKNOWN_REFERENCE`, `TYPE_MISMATCH`, with paths and suggestions (06, D.8).
- P0b. For each path, call `authorize` with the write action for that kind, and, for agent principals, intersect with
  the ceiling. Denial: `FORBIDDEN` with the missing permission named.
- P0c. Compute `change_hash = sha256(canonical({targets, ops, base_revisions}))`. The hash excludes surface, actor,
  session, idempotency key and timestamps (so one logical change has one hash on every surface).
- P0d. If the principal is an agent and no `preview_token` is present, return `PREVIEW_REQUIRED`.

Cancellation is honoured up to the end of P0d and not after (8.6).

**The transaction.**

1. `BEGIN; SET LOCAL lock_timeout = '<commit.lock_timeout>'` (config, Target 2 s). Then
   `SELECT head_seq, head_hash FROM workspace_chain WHERE workspace_id = $1 FOR UPDATE`. This fixes the first lock.
2. **Idempotency.** Look up `(workspace_id, principal_id, idempotency_key)`. If a record exists with the same
   `request_hash`, return its stored `result` with `replayed: true` and roll back (no writes). If the hash differs,
   return `IDEMPOTENCY_KEY_REUSED`. A replayed result is reported as the warning `IDEMPOTENT_REPLAY` in the envelope
   `warnings`, not as `ok: false`.
3. **Preview token.** For a presented token:
   `UPDATE preview_tokens SET consumed_at = now(), consumed_by = $commit WHERE token_hash = $h AND consumed_at IS NULL
   AND expires_at > now() AND change_hash = $c AND principal_id = $p AND workspace_id = $w RETURNING base_revisions`.
   Zero rows: a follow-up read chooses the code. If the token exists and its `base_revisions` no longer match the
   head, `PREVIEW_STALE` (with the diff from the previewed base to the head). Otherwise `PREVIEW_REQUIRED`. Because
   consumption happens inside this transaction, a rollback restores the token.
4. **Lock nodes.** `SELECT ... FROM nodes WHERE workspace_id = $1 AND node_id = ANY($ids) ORDER BY node_id FOR UPDATE`.
   The lock order is fixed: chain first, then nodes ascending by `node_id`. Every writer in the system follows it.
5. **Merge.** For each node whose `base_revision` differs from its head revision, apply the merge rule (8.5). A
   conflict rolls back the transaction and returns `CONFLICT` with the payload in 8.5. A rolled-back conflict writes no
   idempotency record, so the agent may retry with the same key after re-reading.
6. **Validate against the head.** Re-run reference, type, lineage-cycle and per-path permission checks against the
   locked head, not the preview's snapshot. Failure returns the error with `PREVIEW_STALE` if the head moved, else the
   specific code.
7. **Classify.** Assign `rule_id` from the closed commit-rule table in `03-authorization-and-security.md` section 6, the
   single source of rule ids (README ruling 5). This step restates only the ids that decide the branch:
   - `R-ACTION-EXTERNAL`: an agent-declared Action with any effect outside `action:notify`, or a Change to a node
     other than its own declaring node. Approval required.
   - `R-GRANT`: any Grant write by an agent. Approval required. The agent's commit is held as `pending_approval`; the
     agent can never approve or force-apply a grant (`FORBIDDEN` naming `grant:write` applies only to those attempts).
   - `R-DELETE`: any delete by an agent. Approval required.

   Every other id applies automatically at step 8. The rule id is stored on the row and shown on the commit card in the
   UI (P6). If the rule requires approval, go to step 7a; otherwise step 8.
   - 7a. Insert `approvals` (`state = 'pending_approval'`, `ops`, `base_revisions`, `change_hash`, `rule_id`,
     `requested_by`, `on_behalf_of`). Insert one `event` row for the request (so the UI and `change.status` see it).
     Insert `idempotency_records` with `result = {status: 'pending_approval', approval_id, commit_id}`. Insert the
     `outbox` row. Consume the token (step 3 stays in effect). Go to step 12. For a Grant change the approver must hold `approval:decide`
     and `grant:write` on the resource; the requester, the `on_behalf_of` principal and the delegator are excluded (I8;
     `03-authorization-and-security.md` section 7.2). In the demo the approver is `user:finance-analyst`.
8. **Apply.** Compute each node's new body from the locked head plus the ops, and its `body_hash`. The new revision is
   `head + 1`. Compute `inverse_ops` from the pre-image. Compute `paths`, the set of JSON paths touched, with list items
   addressed by stable id (`/panels[id=p95-by-region]/width`).
9. **Append to the chain.** For each change row in order, assign `seq = head_seq + 1`, then increment the local head.
   `prev_hash` is the running head hash. `hash = sha256(prev_hash || change_hash || canonical({surface, actor_id,
   on_behalf_of, approved_by, approval_id, session_id, rule_id, replay_of, replay_change_hash, recorded_actor, reason,
   created_at, virtual_at, kind}))`. The
   `created_at` value is passed in by the transaction (`now()` read once) so that it is hashed and stored identically.
10. **Write projections.** Update `nodes` (body, body_hash, revision, updated_seq). Write a `snapshots` row if
    `revision % 50 = 0`. If the node is a Grant, rebuild its `grant_index` rows and increment
    `workspaces.grant_index_version` and, if the mask set changed, `mask_version`. If the commit is a workflow or rule
    transition, write its projection row (`workflow_instances`, `workflow_transitions`, `rule_state`, `rule_firings`).
11. **Head, idempotency, outbox.** Update `workspace_chain` (`head_seq`, `head_hash`). Insert `idempotency_records`
    with `result = {status: 'committed', commit_id, change_seqs, result_revisions}`. Insert one `outbox` row per
    change row.
12. `COMMIT`.

After commit, the response is built from the stored result, never from in-memory state, so a crash between commit
and response leaves a retry able to return the same result. The relay (9.1) publishes the outbox rows.

**Guarantees of the transaction.** G-TX-1: all of steps 1 to 11 are visible or none are (PostgreSQL atomicity).
G-TX-2: no two commits in one workspace interleave (step 1). G-TX-3: `replayed: true` results are byte-identical to the
first response. G-TX-4: a token is spent by the commit that records its `consumed_by`.

**Commit-rule notes.** `R-HUMAN-DIRECT` writes skip step 3 unless a token is presented. Humans may also be required by
a Grant to supply an approval; `R-GRANT` applies to humans only when the human lacks `grant:write` on the resource.

### 8.5 The merge rule

The merge rule is stated once here and nowhere else in this specification.

> Let `B` be a Change's `base_revision` and `H` the node's head revision. If `B = H`, the Change applies. If `B < H`,
> let `Pc` be the set of paths the Change touches and `Ph` the union of paths touched by the changes to the same node
> with `result_revision` in `(B, H]`, read from `changes`. Two paths conflict when one equals the other or one is a
> prefix of the other. If no path in `Pc` conflicts with a path in `Ph`, the Change is **rebased** onto the head, applied,
> and recorded with `merged_from` listing the sequence numbers it was rebased over. If any pair conflicts, the commit is
> rejected with `CONFLICT`.

The `CONFLICT` payload is:

```json
{
  "error": {
    "code": "CONFLICT",
    "node": "plinth://northwind/Dashboard/ops-board",
    "conflicting_paths": ["/title"],
    "head_revision": 7,
    "head_values_at_paths": { "/title": "Fulfilment operations" },
    "your_values_at_paths": { "/title": "Fulfilment ops (agent)" },
    "conflicting_changes": [1842],
    "retryable": true
  }
}
```

Three consequences follow from the rule. Text fields are paths like any other: two edits to the same title conflict,
and the rule does not merge them last-writer-wins. Lists are keyed by stable ids, so an insert and a delete of
different items rebase. A `width` change and a `title` change on one node rebase, which is the stale-base beat at 160 to 190 s (README beat 6).
The rule has a test per case (AC-TX-5 to AC-TX-8).

### 8.6 Cancellation and ambiguous-commit resolution

- **Cancellation (Guarantee).** A `notifications/cancelled` for a commit, or a client disconnect, is honoured only
  before step 1 of 8.4 begins. After `BEGIN`, the transaction runs to completion, and the cancellation is ignored.
- **Ambiguous outcome (Guarantee).** A caller whose commit response was lost or cancelled resolves the outcome by
  retrying with the same `idempotency_key` and the same body:
  - a stored record with the same request hash means the commit happened. The stored result is returned;
  - no record means the commit did not happen. A preview token whose `consumed_at` is null and whose expiry has not
    passed is still usable; retrying the commit is then safe;
  - a token with `consumed_at` set and no idempotency record is impossible, because consumption and the record are
    written in one transaction (invariant I5). If observed, it is a defect and the test fails.
- **Replay driver (Guarantee).** Before a replayed commit, the driver searches `changes` for the expected `change_hash`
  with `actor_id = service:replay-driver`, `replay_of` matching the transcript step, and the driver's `session_id`. If
  found, the step is marked done. Otherwise the commit is issued with the key `replay:<transcript>:<step>`. This is
  the rule in `../revised/04-emergent-composition.md` section C.3, unchanged.
- **Lock timeout.** A commit that waits longer than `commit.lock_timeout` returns `COMMIT_BUSY` with
  `retry_after_s`. This code is part of the closed error set in section 3 of `06-mcp-server.md` (closing note 13); it
  is retryable and nothing was written.

### 8.7 Undo, branches and snapshots

- **Undo.** `inverse_ops` are stored at commit. `node.undo(change_seq, base_revision, ...)` builds a Change with
  `ops = inverse_ops` of the target row, `undo_of = change_seq`, and `base_revision` equal to the head (or the caller's
  base). It then goes through 8.4 and 8.5 like any Change. If a later change touched the same paths, the merge rule
  yields `CONFLICT` with `conflicting_changes` naming it. Undo never deletes or rewrites a row (Guarantee; test
  `undo_roundtrip`).
- **Branches.** A branch is a named head pointer over one Dashboard's revisions, with its own `branch_id` on the
  changes it receives. Merging a branch is a Change set through 8.4 and 8.5. Branches are supporting (G3), not on
  the demo path.
- **Snapshots.** A snapshot is written every 50 revisions of a node, in the commit transaction, so replay of a node
  reads at most 50 change rows from its last snapshot. Snapshot rows are verified against `body_hash` on read.

### 8.8 Data plane: ingest, publication, watermarks

**Landing.** For each `(source, shard, window, offset range)` the ingest process:

1. writes the Parquet file to `s3://<bucket>/<run_prefix>/_tmp/<partition_key>` and computes `content_hash`;
2. copies it to its final key `<run_prefix>/<source>/<shard>/<partition_key>.parquet` and deletes the temporary object;
3. in one Postgres transaction, inserts `source_partitions` with `published = true`, `published_at = now()` and
   `shard_seq` equal to the previous shard maximum plus one, and issues `NOTIFY plinth_watermark, '<source_id>'`;
4. commits the Kafka offsets for the window.

`partition_key` is deterministic from the source, shard, window and offset range, so a crashed and re-landed window
writes the same key, and `INSERT ... ON CONFLICT (source_id, partition_key) DO NOTHING` makes the re-landing a no-op.

**Publish-by-rename (Guarantee; AC-DATA-1).** A partition is visible to queries only through its `source_partitions`
row, and the row is written after the final object exists. Temporary objects are never named in a plan. The row
insert and the `NOTIFY` are one transaction.

**Watermarks (Guarantee; AC-DATA-2).** A shard's watermark is the maximum `event_max` of its published partitions.
Ingest publishes a shard's partitions in `shard_seq` order, so the published set of a shard is always a prefix. The
source watermark is the minimum over the declared shards (`source_watermark` view in 8.2). The generator emits one
heartbeat per shard per tick, so a quiet shard still advances. The watermark never exceeds the `event_min` of any
unpublished partition of the same shard.

**As-of waits (Guarantee; AC-DATA-3).** Every query has an `as_of` (the virtual now for live queries). The engine:

1. reads the source watermark `W`;
2. if `W >= as_of`, proceeds;
3. otherwise waits, woken by `LISTEN plinth_watermark` with a 200 ms fallback poll, until `W >= as_of` or the query's
   `timeout_ms` budget is spent;
4. if the budget is spent, returns `SOURCE_STALE` with `{source, watermark, as_of}`.

When the query runs, the partition list is read once, at the start, from `source_partitions WHERE published`, and rows
with event time after `as_of` are excluded by an injected predicate (step Q5a below). A result therefore depends only
on the seed, the applied fault ticks and `as_of`.

`QUERY_TIMEOUT` is a different code. It means execution exceeded `timeout_ms` after the watermark was reached.

### 8.9 Query engine: compile order, cache key, re-execution, diffs

**Compile order (Guarantee; the order is fixed and cannot be skipped).**

- Q1. Resolve each source to its schema and resolve `as_of` (8.8 waits).
- Q2. Apply the column mask to each source schema. Masked fields are removed from the schema the typechecker sees, so
  a reference to a masked field returns `UNKNOWN_FIELD` with the same shape as a reference to an absent field (P8).
- Q3. Typecheck the AST: fields, parameters (typed and bounded), expression types, visual channels.
- Q4. Expand computed metrics (L6) and `derive` expressions.
- Q5. Attach predicates to each source relation, before any operator, in this order:
  - Q5a. the time predicate `event_time <= as_of`;
  - Q5b. the workspace predicate;
  - Q5c. the row predicate from every applicable allow grant for the principal and source, combined with `AND`, with
    deny grants combined as `NOT (...)`. A deny always removes rows. If no allow grant applies, `authorize` has
    already refused the source.
- Q6. Project the unmasked columns.
- Q7. Lower operators (`from`, `where`, `derive`, `group`, `aggregate`, `window`, `join`, `union`, `order`, `limit`,
  `select`) to DuckDB SQL with bound parameters only. There is no string-to-SQL path.
- Q8. Compute `query_hash` (canonical AST with parameter placeholders) and `policy_hash` (below), and record the plan.

Because predicates are attached to the source relation (Q5) before any operator, a join or union cannot return a row
the grant excludes. Test `rls_differential` covers that (AC-05-QRY-1).

**Result cache key (Guarantee; AC-05-QRY-2).**

```
key = (query_hash, policy_hash, canonical(parameter_values), as_of)
policy_hash = sha256(canonical({workspace_predicate,
                                row_predicate_ast per source,
                                column_mask_set,
                                workspaces.mask_version,
                                workspaces.grant_index_version}))
```

Two principals with the same row predicate and different column masks have different `policy_hash` values and never
share an entry. A grant change changes `grant_index_version`, which changes every affected key, so stale entries are
not reachable. The cache is in-process and bounded (Target: `query.cache.max_bytes`). Live queries change key on every
advance of `as_of`, so they never serve a stale result as current.

**Re-execution and diffs (Guarantee for ordering; Target for cost).** A live query handle is re-executed when a source it
reads advances its watermark past the handle's current `as_of`. Re-execution is coalesced to at most one execution per
handle per second (`query.coalesce_ms`, default 1000). Each completed run produces a diff against the previous result,
keyed by the group columns of an aggregate, or by a declared `key` for a row query:

```json
{ "t": "diff", "handle": "q:p95-by-region", "q_rev": 42, "as_of": "2026-…T14:20:59Z",
  "key": ["region"], "added": [], "changed": [{"key": {"region": "EMEA"},
  "old": {"p95_latency_ms": 612.0}, "new": {"p95_latency_ms": 1184.0}}], "removed": [] }
```

`q_rev` is monotone per handle. If a diff is larger than half the full result, the engine sends the full result with
`replace: true` instead. Each run writes a `query_runs` row (informational). The reconstruction rule is: applying the
diffs in `q_rev` order to the last full result yields the result hash recorded in `query_runs` for that `q_rev`
(AC-05-QRY-3).

**Authorization changes re-run queries.** When a principal's grants change, the gateway re-executes every handle that
principal holds, because `policy_hash` changed. The new result is delivered as a diff, so the Exec view loses rows in
place (grant beat, 125 to 160 s).

---

## 9. Real-time communication and asynchronous processing

### 9.1 Asynchronous plumbing

Three asynchronous paths exist. Each is recoverable from Postgres, and none carries authority in its payload.

- **Outbox relay (Guarantee; AC-RT-1).** The relay runs inside the `rt` process. It wakes on `NOTIFY plinth_outbox`
  (payload: workspace id) and on a 500 ms poll. It reads `outbox WHERE relayed_at IS NULL ORDER BY seq LIMIT 500`,
  publishes `{seq_from, seq_to}` to Redis channel `plinth:ws:<workspace_id>`, and then sets `relayed_at`. Publication
  is at-least-once. A relay that dies after publishing and before marking is repeated, and gateways tolerate the
  duplicate because they dedupe by `seq`.
- **Gateway catch-up (Guarantee; AC-RT-6).** A gateway never trusts a Redis payload's content. On any wake-up it reads
  `changes WHERE workspace_id = $w AND seq > $cursor ORDER BY seq`. Each gateway also polls `workspace_chain.head_seq`
  once per second per active workspace (Target), so a lost Redis message is recovered from Postgres. Redis loss
  therefore changes latency only.
- **Rule and workflow processing.** The worker wakes on `NOTIFY plinth_watermark` and on a 1 s poll. It processes
  closed windows (9.2) and due action runs (9.3). Each of its effects is a commit through 8.4.

**Commit-to-screen path.** commit (8.4 step 12), outbox row, relay publish, gateway read, client render. Target: p95
under 300 ms on one host (`../revised/04-emergent-composition.md` D.6), measured in the rehearsal harness. The
choreography budget for the acknowledge step (258 to 268 s) is a separate, larger stage budget of 2 s. The two
figures are different and both are stated (closing note).

### 9.2 Rule evaluator state machine

Rules are evaluated per closed virtual-clock window of one minute, `[t - 1m, t)`, as the owner principal with the
effective authority of D.5 in `04`, and against the rule's query at `as_of = t`.

**Windows.** A window `w` is closed when `source_watermark(source) >= w.end` for every source the rule reads. The
evaluator processes closed windows in order, from `rule_state.last_window_end + 1m`, and never skips one.

**Groups.** The rule's query is grouped by the group column. Each group value has its own state machine instance.
A group absent from a window is treated as not breaching in that window.

**Hold.** `hold = 3m` and `window = 1m` give `N = 3` consecutive breaching windows. `N = ceil(hold / window)`.

**States and transitions.** `breach(w, g)` is true when the rule's `when` predicate holds for group `g` in window `w`.

| From | Condition | To | Effects in the same transaction |
|---|---|---|---|
| `ok` | breach | `pending` | `breach_windows = 1`, `pending_since = w.start` |
| `pending` | breach, `breach_windows + 1 < N` | `pending` | `breach_windows += 1` |
| `pending` | breach, `breach_windows + 1 >= N` | `firing` | new `firing_id`; insert `rule_firings`; event row; queue actions |
| `pending` | no breach | `ok` | `breach_windows = 0`, `pending_since = null` |
| `firing` | breach | `firing` | none (no new notification) |
| `firing` | no breach | `resolved` | `rule_firings.resolved_window_end = w.end`; event row; queue resolve actions; `firing_id = null` |
| `resolved` | breach | `pending` | `breach_windows = 1` |
| `resolved` | no breach | `ok` | none |

**Exactly-once (Guarantee; AC-05-RULE-1).** Each window's transitions run in one transaction that first performs
`UPDATE rule_state SET last_window_end = w.end ... WHERE last_window_end = <previous end>` (compare-and-set). A second
evaluator, or a restarted one, that tries the same window finds zero rows updated and does nothing. The firing row's
unique key (I7) is a second guard. The transitions go through `commitChanges()` as `service:rule-worker`, with
`on_behalf_of` set to the rule's owner human.

**Effective authority at firing (Guarantee; AC-05-RULE-2).** At firing, the three inputs of the intersection (the
on-behalf-of human's grants at that time, the agent ceiling, and the action's declared permission) are evaluated and
stored in `rule_firings.authority`. The action run is queued only if the intersection allows it. Otherwise the firing
is recorded, and its action run is created with `state = 'refused'` and the missing permission in `last_error`.

**Backtest.** A backtest runs the same transition function in memory over a history range: one grouped query over the
range in one-minute buckets (`GROUP BY group, minute`), then the state machine over the ordered buckets. It writes no
rows. Its output is the list of `{group, opened_window_end, resolved_window_end}`. Results are cached by
`(rule_hash, manifest_id)`. The demo backtest over 30 days must report exactly one firing, for EMEA, at 14:03 to
14:20 (AC-05-RULE-3, test `backtest_fires_once`).

### 9.3 Action runner

Actions with external effects (handler `http`, which is for external egress only; README ruling 19) never run inside a transaction. The runner works as
follows.

- An action run is created in the firing transaction with `idempotency_key = 'firing:<firing_id>:<action_node_id>:<edge>'`
  where `edge` is `open` or `resolve`. `state = 'queued'`.
- The runner selects due rows with `FOR UPDATE SKIP LOCKED`, sets `state = 'running'` and `attempts += 1`, and
  performs the effect with the key as the receiver's idempotency header.
- A 2xx response sets `state = 'sent'` and `external_ref`, in a commit as `R-SYSTEM`. A 5xx or timeout sets
  `state = 'failed'` with backoff (Target: `action.max_attempts = 5`, exponential from 500 ms). A permanent 4xx sets
  `state = 'refused'`.
- Each state change is a commit, so the audit chain holds the effect's history.

**Guarantee.** At most one run per key is created (unique key). **Target.** Exactly one external effect per key, which
depends on the receiver honouring the key. The demo receiver does.

### 9.4 Workflow runner

**Definitions and instances.** A Workflow definition is a `Workflow` node with `spec.states` and `spec.transitions`. An
instance is a `Workflow` node with `body.instance = true`, `body.firing_id`, and `body.state`. An instance is created in
the firing transaction, with slug `incident-<firing_id first 8 hex>`. Its `workflow_instances` row mirrors its state.
The node-kind list is canonical and has no separate instance kind, so an instance is a node of kind `Workflow`.

**Transition table (closed).**

| From | To | Trigger | Permission | Principal kinds allowed |
|---|---|---|---|---|
| `open` | `acknowledged` | `human` | `workflow:acknowledge` | human |
| `open` | `resolved` | `rule` | system | service |
| `acknowledged` | `resolved` | `rule` | system | service |
| `open` | `resolved` | `human` | `workflow:acknowledge` | human |
| `acknowledged` | `resolved` | `human` | `workflow:acknowledge` | human |

Any other pair returns `VALIDATION_FAILED` with the allowed values for the current state. The agent principal holds no
`workflow:acknowledge` (`03-authorization-and-security.md`), so it cannot take the acknowledge transition. The
transition procedure is a commit (8.4) whose ops set `/state` and `/acknowledgement`, and which writes
`workflow_transitions` in the same transaction.

**Acknowledge form write-back.** The Action `workflow.acknowledge` declares its input `{note: string}` and its effects:
Change paths `/acknowledgement/note` and `/state` on the instance node. The form loads with the instance's
`base_revision`, which the submit carries. If the rule has resolved the instance in between, the merge rule (8.5)
finds `/state` touched and returns `CONFLICT`, and the UI shows the conflict card. Otherwise the commit applies, and
`workflow_transitions` records the actor (`user:ops-lead`), `surface = 'ui'`, and the change seq.

**Guarantee.** A transition is applied at most once per change row, because `workflow_transitions` is keyed by
`(workspace_id, change_seq)`, and the transition check reads the locked head (AC-05-WF-1, AC-05-WF-2).

### 9.5 Realtime protocol (`/rt`)

**Transport.** WebSocket at `/rt`. The first client frame must be `hello` within 5 s, or the server closes the socket.
Frames are JSON with a type field `t`. Protocol version 1.

**Client to server.**

```json
{ "t": "hello", "protocol": 1, "token": "<bearer>", "client_id": "<uuid>" }
{ "t": "subscribe", "sub": "s1", "nodes": ["plinth://northwind/Dashboard/ops-board"],
  "queries": ["q:p95-by-region"], "since_seq": 1841 }
{ "t": "unsubscribe", "sub": "s1" }
{ "t": "presence", "node": "plinth://northwind/Dashboard/ops-board", "focus": "panel:p95-by-region" }
```

**Server to client.**

```json
{ "t": "welcome", "session_id": "…", "principal": "user:ops-lead", "head_seq": 1907 }
{ "t": "subscribed", "sub": "s1", "mode": "resume", "from_seq": 1841, "through_seq": 1907 }
{ "t": "events", "sub": "s1", "prev_through": 1841, "through": 1852, "items": [
    {"seq": 1842, "kind": "change", "node": "…", "rev": 7, "surface": "mcp",
     "actor": "agent:claude-code", "on_behalf_of": "user:ops-lead", "rule_id": "R-LAYOUT",
     "ops_summary": "…", "contains_untrusted": false} ] }
{ "t": "progress", "sub": "s1", "through": 1907 }
{ "t": "snapshot", "sub": "s1", "at_seq": 1907, "nodes": [], "queries": [] }
{ "t": "present", "seq": 1909, "node": "…", "focus": "panel:…", "target": "user:ops-lead" }
{ "t": "presence", "node": "…", "entries": [ {"principal": "agent:claude-code",
    "kind": "agent", "on_behalf_of": "user:ops-lead", "focus": "…", "last_seen_ms": 0} ] }
{ "t": "error", "code": "FORBIDDEN", "message": "…", "sub": "s1" }
```

**Ordering (Guarantee; AC-RT-2).** Within one workspace, a subscription receives items in ascending `seq`, and an item
is never delivered before every lower matching `seq` for that subscription. Each `events` frame carries `prev_through`
and `through`: the sequence number up to which the subscription has been informed. A client accepts a frame only if
`prev_through` equals the `through` of its previous frame for that subscription. The gateway sends `progress` frames
every 2 s when there is nothing to report, which advances `through` past filtered-out changes.

**Gap refetch (Guarantee; AC-RT-3).** If a client sees a frame whose `prev_through` does not match, it discards its
state for that subscription and sends `subscribe` again with no `since_seq`. The server then sends `snapshot`. The
client does not attempt to splice the gap.

**Resume and snapshot fallback (Guarantee; AC-RT-4).** On `subscribe` with `since_seq = n`:

- If `floor <= n <= head_seq`, where `floor` is the oldest retained sequence number (`rt.resume_floor`; the demo
  retains the full log), the server sends `mode: "resume"`. It streams the changes with `seq > n` that match the
  subscription, in pages of 500, then `through` catches up to `head_seq`.
- Otherwise, including `n > head_seq`, the server sends `mode: "snapshot"`. The snapshot is read in a
  `REPEATABLE READ` transaction, so every node body and query result in it corresponds to `at_seq`. The subscription
  then continues from `at_seq`.

**Per-subscriber filtering (Guarantee; AC-RT-5).** Every item is re-authorized against the subscriber at delivery. A
node the subscriber cannot read is not delivered, and the item is not even summarized. When a grant changes, the
gateway re-authorizes each live subscription, and sends a `snapshot` to any subscription whose visible set shrank.

**Animation honesty (Guarantee; AC-RT-7).** Every client animation is triggered by an `events` item (which has a
`seq`), a `diff` (which has a `q_rev`), or a `present` frame (which has a `seq`), or by a user gesture. A test build
instruments the animation primitive and fails if an animation begins without one of these identifiers (P2).

**Presence (Target for convergence; Guarantee for throttle).**

- Presence is stored in Redis, in a hash `plinth:presence:<workspace_id>:<node_id>` whose fields are session ids and
  whose values are `{principal, kind, on_behalf_of, focus, cursor, last_seen_ms}`. The key has a 10 s TTL.
- A client sends a heartbeat every 2 s. The gateway removes entries whose `last_seen_ms` is older than 5 s, on read.
- A re-`hello` from the same client replaces that client's entries, so reconnection storms do not duplicate people.
- The gateway pushes at most five `presence` frames per second per node per connection (`04` D.6). Each frame is the
  full current set, filtered by the viewer's read decision. Intermediate states are coalesced.
- Presence is never written to `changes` or `outbox` (Guarantee; AC-RT-8).

**Errors.** Realtime uses the closed code set (06, D.8). `FORBIDDEN` for an unreadable subscription, and
`VALIDATION_FAILED` for a malformed frame. A frame that fails validation closes nothing: the error is sent and the
connection stays open.

### 9.6 MCP resource notifications

- An MCP session subscribes to a resource URI (`plinth://node/<workspace>/<node_id>`, `plinth://schema/...`, and so
  on). The MCP process keeps that table in memory per session.
- When the MCP process observes new change rows for a workspace (by the same wake-up path as 9.1), it notifies each
  session subscribed to a changed node that the session can read, with `notifications/resources/updated`. The
  notification carries only the URI. The client calls `node.get` for the body.
- **Guarantee (AC-RT-9).** A notification is sent for every committed change to a subscribed, readable node, after
  the change is readable in Postgres. Duplicates may occur. Notifications for one URI may be coalesced within 200 ms
  (Target).
- Progress notifications for long calls come from the engine's batch callbacks. Cancellation of a query is honoured
  between engine batches. Cancellation of a commit follows 8.6.

### 9.7 Consistency table

Labels: **G** is Guarantee (tested), **T** is Target (measured before it is claimed). The acceptance criterion id is
the test that enforces the row.

| Operation | Property | Label | Mechanism | Test |
|---|---|---|---|---|
| `node.commit` | Atomic: all rows, outbox and projections, or none | G | single transaction (8.4) | AC-TX-1 |
| `node.commit` | Serial per workspace; chain linear | G | `workspace_chain FOR UPDATE` first | `chain_linear_under_concurrency` (AC-TX-3) |
| `node.commit` | Commit-to-screen p95 | T | outbox, relay, gateway | rehearsal, AC-RT-10 |
| `node.commit` retry | Same key and body returns the stored result | G | idempotency record in the same transaction | AC-TX-2 |
| `node.commit` retry | Different body under same key is refused | G | request hash | AC-TX-2 |
| `node.preview` | Never writes a Change; token row only | G | no `changes` write | AC-TX-9 |
| `node.preview` | Preview equals commit result | G | `change_hash` and `body_hash` check | `preview_is_commit` |
| preview token | Spent at most once | G | conditional `UPDATE` | `token_single_use_concurrent` (AC-TX-4) |
| preview token | Commit of agent Change without token | G | step P0d | AC-TX-10 |
| merge | Disjoint paths rebase; intersecting paths conflict | G | 8.5 | AC-TX-5 to AC-TX-8 |
| commit cancellation | Honoured only before `BEGIN` | G | 8.6 | AC-TX-11 |
| ambiguous outcome | Resolved by idempotency lookup | G | 8.6 | AC-TX-12 |
| `node.undo` | Inverse Change; history not rewritten; chain verifies | G | 8.7 | `undo_roundtrip` (AC-TX-13) |
| `grant` commit | Index rebuilt in the same transaction | G | 8.4 step 10 | AC-TX-14 |
| approval | Approver is neither requester nor delegator | G | CHECK (I8) and P7 test | AC-TX-15 |
| approval | Approved change that no longer merges is `rejected` with `conflict` | G | 8.4 step 5 in the decision transaction | AC-TX-16 |
| `change.status` | Reports the state of `03` section 7.1, with the approver for decided approvals | G | `approvals` row | AC-TX-17 |
| ingest | Partition visible only after its rename and row | G | I6, 8.8 | AC-DATA-1 |
| watermark | Never exceeds an unpublished partition's start | G | shard prefix publication | AC-DATA-2 |
| `query.run` | Rows are a function of seed, ticks and `as_of` | G | Q5a and pinned partition list | `replay_reproduces` (AC-05-QRY-4) |
| `query.run` | Waits for watermark, else `SOURCE_STALE` | G | 8.8 | AC-DATA-3 |
| `query.run` | Latency of 2.4 M-row aggregate, p95 | T | engine | rehearsal, AC-05-QRY-5 |
| result cache | No cross-policy sharing | G | `policy_hash` in key | `cache_isolation` (AC-05-QRY-2) |
| row security | Equal to hand-written predicate on every path | G | Q5c | `rls_differential` (AC-05-QRY-1) |
| result diffs | Ordered by `q_rev`; reconstruct the recorded result | G | 9-diff rule | AC-05-QRY-3 |
| rule firing | At most one firing per window and group, across restarts | G | CAS and I7 | AC-05-RULE-1 |
| rule firing | Effective authority recorded and intersected | G | `authority` | AC-05-RULE-2, `agent_rule_notify` |
| backtest | Deterministic; one firing in demo history | G | same transition function | AC-05-RULE-3, `backtest_fires_once` |
| action run | At most one run per key | G | unique key | AC-05-RULE-4 |
| action effect | Exactly one external effect per key | T | receiver honours key | rehearsal |
| workflow transition | Applied at most once; checked against locked head | G | `workflow_transitions` key | AC-05-WF-1, AC-05-WF-2 |
| acknowledge form | Conflict with a concurrent resolve is shown, not overwritten | G | 8.5 | AC-05-WF-3 |
| realtime order | No delivery before a lower matching seq | G | `prev_through` check | AC-RT-2 |
| realtime gap | Mismatched `prev_through` triggers snapshot refetch | G | client rule, server snapshot | AC-RT-3 |
| realtime resume | Resume or snapshot, as specified | G | 9.5 | AC-RT-4 |
| realtime filtering | Unreadable nodes never delivered | G | per-delivery `authorize` | AC-RT-5 |
| fan-out loss | Redis loss does not lose a committed change | G | gateway catch-up from Postgres | AC-RT-6 |
| animation | No animation without an event id | G | instrumented build | AC-RT-7 |
| presence | Throttle at most five frames per second per node | G | gateway | AC-RT-8 |
| presence | Not in the change log | G | no write path | AC-RT-8 |
| presence | Convergence after reconnect | T | heartbeat and TTL | rehearsal |
| MCP resources | Notification after each readable committed change | G | 9.6 | AC-RT-9 |
| replay | Query, change and final body hashes match on local and staging | G (under replay only) | transcript and manifest | `replay_reproduces` |
| audit chain | Verifiable on demand and at startup | G | I1, I2 | AC-TX-3 |
| reset | Restore control store and repoint manifest | T | 04 E.4 | rehearsal (20 s target) |
| startup | Readiness gates before `make up` returns | G | 7.4 | AC-05-SVC-5 |

### 9.8 Acceptance criteria for sections 8 and 9

Transaction and chain:

- **AC-TX-1.** Injecting a failure at each of the twelve steps of 8.4 leaves no `changes`, `outbox`,
  `idempotency_records` or projection row, and leaves the token unconsumed. (G)
- **AC-TX-2.** Retrying a commit with the same key and body returns the stored result with `replayed: true` and writes
  nothing. The same key with a different body returns `IDEMPOTENCY_KEY_REUSED`. (G)
- **AC-TX-3.** `chain_linear_under_concurrency`: 200 concurrent commits across 20 nodes in one workspace produce dense
  `seq`, no fork, `head_seq` equal to the row count, and a verifying chain. (G)
- **AC-TX-4.** `token_single_use_concurrent`: two concurrent commits presenting one token yield exactly one success and
  one `PREVIEW_REQUIRED`. (G)
- **AC-TX-5.** Disjoint paths (`/title` and `/width`) on a stale base rebase, with `merged_from` set. (G)
- **AC-TX-6.** Intersecting paths (`/title` on both sides) return `CONFLICT` with the payload of 8.5, and write nothing. (G)
- **AC-TX-7.** A parent path and a child path (`/layout` and `/layout/items/3/w`) conflict. (G)
- **AC-TX-8.** List inserts and deletes keyed by stable id on a stale base rebase. (G)
- **AC-TX-9.** `node.preview` for any Change leaves `changes` and `nodes` unchanged. (G)
- **AC-TX-10.** An agent commit without a token returns `PREVIEW_REQUIRED` before `BEGIN`. (G)
- **AC-TX-11.** A cancellation delivered before step 1 prevents the commit. One delivered during the transaction does
  not abort it. (G)
- **AC-TX-12.** Commits cancelled at random points, followed by the 8.6 resolution, match the chain in every case. (G)
- **AC-TX-13.** `undo_roundtrip`: 300 random Changes by human, agent and driver principals, undone in reverse, return
  `body_hash` to its start, leave 600 unmodified rows, and verify at every step. (G)
- **AC-TX-14.** After a Grant commit, `grant_index` and `grant_index_version` reflect it in the same transaction. (G)
- **AC-TX-15.** The requester and the delegator cannot approve their own held change, through the API, the UI or MCP. (G)
- **AC-TX-16.** An approved change whose base conflicts at decision time is recorded `rejected` with
  `decision_reason = 'conflict'`, and the agent is told so. (G)
- **AC-TX-17.** `change.status` returns the state, and for `approved` the `change_seq`, and for decided approvals the approver. (G)

Data plane and query:

- **AC-DATA-1.** A partition whose row is absent is not read by any query, even when its object exists. (G)
- **AC-DATA-2.** Killing ingest between object write and row insert leaves the watermark unchanged, and the re-landed
  partition has the same key. (G)
- **AC-DATA-3.** A query with `as_of` ahead of the watermark waits, and returns `SOURCE_STALE` with the watermark when
  its budget is spent. (G)
- **AC-05-QRY-1.** `rls_differential` over 10,000 generated queries and 200 generated grants, including joins and unions,
  and including the rule, backtest, export and form-lookup paths. (G)
- **AC-05-QRY-2.** `cache_isolation`: a masked and an unmasked principal with identical row predicates have different
  `policy_hash` values and never share an entry. A grant change makes the old key unreachable. (G)
- **AC-05-QRY-3.** For 1,000 generated live handles, applying the diffs in `q_rev` order reproduces the recorded result
  hash at each `q_rev`. (G)
- **AC-05-QRY-4.** `replay_reproduces`: every query step hash in a transcript matches on 10 local and 10 staging runs. (G)
- **AC-05-QRY-5.** Aggregate over the 2.4 M-row history, grouped by region with a percentile, has p95 under 200 ms, and the
  heatmap has p95 under 300 ms, on the reference machine. (T; measured)

Rules and workflows:

- **AC-05-RULE-1.** Two evaluators, or one evaluator restarted at each of the transaction's steps, produce exactly one
  firing per window and group. (G)
- **AC-05-RULE-2.** The `authority` record of each firing contains the three intersection inputs, and a firing whose action
  the ceiling forbids is recorded with a `refused` action run. (G)
- **AC-05-RULE-3.** `backtest_fires_once`: the 30-day backtest of the demo rule reports one firing, for EMEA, opened at the
  14:03 window and resolved after 14:20, and no other firing in the history. (G)
- **AC-05-RULE-4.** Creating an action run twice with one key yields one row. (G)
- **AC-05-WF-1.** A transition is applied once when the same acknowledge submit is delivered twice. (G)
- **AC-05-WF-2.** An acknowledge against an instance already `resolved` returns `VALIDATION_FAILED` listing the allowed
  values, and no transition is written. (G)
- **AC-05-WF-3.** A `CONFLICT` on `/state` during acknowledge is shown as a conflict card, and the instance keeps the
  resolving transition. (G)

Real-time:

- **AC-RT-1.** Killing the relay after publish and before marking `relayed_at` causes a duplicate publish and no
  duplicate delivery to a client (deduplication by `seq`). (G)
- **AC-RT-2.** A randomized test of 10,000 commits and subscriptions with filters delivers items in `seq` order and
  satisfies `prev_through` continuity for every subscription. (G)
- **AC-RT-3.** A client whose `prev_through` is forced to mismatch refetches a snapshot and converges to the server's
  state. (G)
- **AC-RT-4.** `since_seq` inside the retained range resumes; outside it, or above `head_seq`, yields `snapshot` with
  `at_seq` consistent with the body and query results. (G)
- **AC-RT-5.** A subscriber whose grant is removed receives a snapshot without the nodes it can no longer read, and
  receives no further item for them. (G)
- **AC-RT-6.** With Redis stopped during 100 commits, every gateway delivers all 100 changes in order after Redis
  returns. (G)
- **AC-RT-7.** The instrumented animation build fails on any animation without an event id. (G)
- **AC-RT-8.** More than five presence frames per second per node is never sent to one connection, and no presence row
  appears in `changes` or `outbox`. (G)
- **AC-RT-9.** For a subscribed MCP resource, every committed change to its node produces at least one
  `notifications/resources/updated`. (G)
- **AC-RT-10.** The commit-to-screen p95 on one host is under 300 ms in the rehearsal harness. (T; measured)

---

## Closing note: decisions and ambiguities

Each line records a canonical fact or a source that was ambiguous, and the decision taken in this document.

1. **MCP tool count.** `README.md` names fifteen tools (with `change.status`, P11); `04` section D.7 says fourteen in its
   text. Decision: fifteen, as the canonical list states. The catalogue itself is in `06-mcp-server.md`.
2. **Image count.** `README.md` lists five images, including `plinth-driver`; `04` section E.1 lists four. Decision: five.
3. **Untrusted envelope key.** P14 says `{ "untrusted": "..." }`; `04` D.10 says `untrusted_data`. Decision: P14 wins, and
   this document only stores the boolean `contains_untrusted`.
4. **Merge rule versus text last-writer-wins.** `04` D.6 says text fields are last-writer-wins; P13 requires a conflict on
   the title path. Decision: P13 exactly. Text is an ordinary path, and LWW is not used. `02` and `05` forbid automatic
   rebase; P13 requires it for disjoint paths. Decision: P13.
5. **Change sequence scope.** `04` DDL uses a global `bigserial` for `changes.seq`, but AC-TX-3 requires `head_seq` to equal the
   per-workspace row count. Decision: `seq` is dense per workspace, with primary key `(workspace_id, seq)`.
6. **Multi-node commits.** `04` DDL has one `node_id` per change row, but a commit can touch several nodes (a Panel and
   its Dashboard). Decision: one row per node, sharing `commit_id`, in one transaction.
7. **Presentation and event rows.** `ui.present` (audited as `surface = mcp, kind = present` in `04` D.7) and rule and approval events need
   sequence numbers in the realtime stream. Decision: `changes.kind` gains `present` and `event`, with no revision.
8. **Rule state granularity.** Beat 4 asks about "any region" and beat 8 expects one firing. Decision: state is per (rule,
   group), with the group column the rule query's group key.
9. **Hold window.** `04` section A says three one-minute windows, and the canonical script says "three minutes". Decision:
   `hold = 3m`, `window = 1m`, `N = 3` consecutive breaching windows.
10. **Resume cursor.** `04` resumes by revision; the realtime design needs a cursor for filtered streams. Decision: the
    subscription cursor is the per-workspace `seq`, and `revision` is used only for conflicts.
11. **Commit-to-screen latency.** `04` D.6 gives a Target of 300 ms p95; beat 258 to 268 s allows 2 s. Decision: both,
    named separately. 300 ms is the Target. 2 s is the stage budget.
12. **Presence rate.** `02` D.4 says 10 Hz; `04` D.6 says five updates per second per node. Decision: five per node.
13. **Error codes.** No new codes are added except `COMMIT_BUSY` (8.6), which is part of the closed set in `06-mcp-server.md` section 3.
    Watermark-wait timeouts return `SOURCE_STALE`, and execution timeouts return `QUERY_TIMEOUT`.
14. **Workflow instances.** The canonical node kinds have no instance kind. Decision: an instance is a `Workflow` node
    with `body.instance = true`, mirrored by a projection row.
15. **Commit rule classes.** P6 names `R-ACTION-EXTERNAL` as approval-required, but beat 4 commits a rule that posts to
    the ops channel with no approval. Decision: `action:notify` inside the ceiling is `R-RULE-CREATE` (auto after
    preview). `R-ACTION-EXTERNAL` covers effects outside notify, or Changes to other nodes.
16. **Watermark definition.** `04` says "minimum over a source's partitions". Decision: minimum over declared shards of
    each shard's maximum published event time, with ingest publishing each shard in order.
17. **Replay-driver authority.** P9 says the driver is its own principal. Decision: `service:replay-driver`, with
    `on_behalf_of` the recorded human, and `replay_of` required on driver rows.
18. **Approval-held change accounting.** The proposal does not say when a token is consumed for a held change. Decision:
    consumed at request time (the commit was accepted), with the approval as the later write.
19. **Retention and floors.** Resume after a retention floor is specified, but the demo retains everything. Decision:
    `rt.resume_floor` is configuration, and the demo sets it to the first seq.
20. **Dependence on the history manifest.** `04` E.4 gives `history_reproduces` as a build test. It appears here only as a
    startup check, as section 7.4 step 3.
</content>
