# Plinth: definitive specification

This directory is the implementation-ready specification of **Plinth**, the winner of the design
tournament. The documents are built from three inputs:

- `../revised/04-emergent-composition.md` (the winning proposal);
- `../selection-rationale.md`, whose amendments P1–P20 are binding;
- the grafted ideas from the losing proposals that those amendments name.

**Precedence:** this README, then the amendments in `../selection-rationale.md`, then the spec
documents, then the revised proposal.

## Document map

| File | Mission sections covered |
|---|---|
| `01-product-and-features.md` | 1 Product vision and core demonstration narrative · 2 Detailed feature inventory |
| `02-domain-model.md` | 3 Domain model and data relationships (spec language, node kinds, schemas) |
| `03-authorization-and-security.md` | 4 Roles, permissions, authorization rules · 10 Security requirements and threat model |
| `04-workflows-and-frontend.md` | 5 Complete user workflows · 6 Frontend information architecture and interaction requirements |
| `05-backend-persistence-realtime.md` | 7 Backend services · 8 Persistence, transactions, consistency · 9 Real-time and async processing |
| `06-mcp-server.md` | The MCP server: tool catalogue, envelope, errors, resources, prompts, the agent gate |
| `07-deployment.md` | 11 Containers · 12 AWS · 13 Local · 14 Configuration and secrets |
| `08-testing-and-observability.md` | 15 Automated tests and acceptance criteria · 16 Observability |
| `09-demo-operations.md` | 17 Deterministic data and reset · 18 Failure recovery and contingencies · the replay driver |
| `../implementation-plan.md` | 19 Dependencies and work breakdown |
| `../presentation-script.md` | 20 Exact five-minute script |
| `../acceptance-matrix.md` | Acceptance and verification matrix |

## Canonical facts (every document must agree with these)

**Product.** Plinth: a self-hosted, multi-tenant operations platform. It has one document model
(Nodes), one write path (Changes), one read path (the Query compiler), one authorization function,
one real-time channel and one specification language. Its surfaces are the web UI, the HTTP API, the
CLI and the MCP server. None of them has a capability the others lack.

**Kernel primitives.** P1 Node · P2 Change · P3 Query · P4 Source · P5 Parameter · P6 Grant.

**Node kinds.** Dashboard, Panel, Query, Source, Parameter, Rule, Action, Form, Workflow, Grant,
Metric, Template, Export, Annotation, Comment.

**Demo data.** Northwind Fulfilment, a fictional retailer. Its order pipeline comes from a seeded
deterministic generator (`plinth-gen`, xoshiro256**, seed committed). 30 days of history end at
14:30 on the fixed virtual demo date. The history contains a seeded `FaultProfile` for EMEA/Crane:
handoff latency ramps 14:00–14:05 and holds to 14:20. The live fault, triggered by presenter cue F7,
is the same profile type. Sources are `orders`, `carrier_scans` and `warehouse_capacity`, plus the
metadata sources `audit.changes`, `lineage.edges`, `workflow.instances`, `workflow.transitions`,
`query.runs` and `rule.firings`. Five regions: NA, EMEA, APAC, LATAM, ANZ. Carriers: Crane, Swift,
Harbor, Polar, Meridian.

**Identities (stable, seeded).**

| Principal | Kind | Role in demo | Window |
|---|---|---|---|
| `user:ops-lead` (Maya Ortiz) | human | Presenter's identity; delegates to the agent | **Ops board** (room display, wide) |
| `user:emea-lead` (Jonas Becker) | human | Regional lead for EMEA; EMEA-only read grant on the Ops board | **Exec view** (room display) |
| `user:finance-analyst` (Priya Nair) | human | Owns the finance board; **approves** the agent's grant proposal | **Finance** window (room display, small) |
| `agent:claude-code` | agent | External MCP client acting `on_behalf_of` `user:ops-lead`, within the ceiling in 03 | Claude Code terminal |
| `service:replay-driver` | service | Fallback driver; replays recorded steps with recorded `on_behalf_of` | none |
| `service:rule-worker`, `service:ingest`, `service:gen` | service | Platform workloads | none |

The **Phone** window (narrow, at phone width, signed in as `user:ops-lead`) and the **presenter
console** (virtual clock, driver mode, step list, slack pool, fault cue) are on the presenter's
second display.

**MCP tool catalogue (15 tools, generic verbs).**

1. `schema.describe`
2. `node.get`
3. `node.search`
4. `source.list`
5. `query.run`
6. `query.explain`
7. `node.preview`
8. `node.commit`
9. `node.delete`
10. `node.undo`
11. `change.history`
12. `diff`
13. `grant.check`
14. `ui.present`
15. `change.status`

Signatures are in the revised proposal D.7. `change.status` comes from amendment P11. Every
response uses the envelope in P5. Agent writes always go preview → commit, using a single-use token
held in Postgres.

**Stack.**

- TypeScript end to end.
- Fastify for the API; `ws` for real-time; the official MCP TypeScript SDK (stdio and Streamable
  HTTP).
- React 19 with Vite, TanStack Query, Zustand, react-grid-layout and Apache ECharts. The lineage
  graph uses ECharts graph series.
- PostgreSQL 16 as the control plane and the only authority.
- DuckDB (`@duckdb/node-api`, extensions bundled) over immutable Parquet partitions.
- Kafka protocol for events: MSK on AWS, Redpanda locally.
- S3 on AWS, MinIO locally.
- Redis for presence and fan-out only: ElastiCache on AWS, Redis locally.
- Identity: Cognito on AWS, Keycloak locally.

**Images (immutable, digest-pinned, same digests locally and on AWS):** `plinth-app` (api, rt, mcp
and the web assets; the entrypoint selects the process), `plinth-worker`, `plinth-ingest`,
`plinth-gen`, `plinth-driver`.

**Commands.**

- `make up`: one-command start with readiness gates.
- `make demo-reset`: control-store snapshot restore, history manifest re-pointed, new run prefix.
- `make rehearse`: Playwright run across four windows plus the replay driver.
- `make demo-replay STEP=n`: driver from step n.
- `plinth apply` / `plinth diff`: the CLI.

**Five-minute script, beat order (times are presenter cues; the exact script is in
`../presentation-script.md`).**

| # | Time (s) | Beat | Strongest capabilities |
|---|---|---|---|
| 1 | 0–25 | Three screens, one board, presence; live KPI tile ticking from the feed | realtime, presence, sources |
| 2 | 25–55 | "Show p95 fulfilment latency by region for the last hour." A time-series line panel materialises on every screen; the Exec view shows EMEA only | discovery, preview/commit, query compiler, row security, animation-on-event |
| 3 | 55–95 | "Why did p95 jump at 14:05? Break it down by carrier, compare with yesterday, and check for config changes." The red heatmap beside a flat control heatmap, plus "0 changes in window" from `audit.changes` | parameters, negative control, metadata as source |
| 4 | 95–125 | Presenter brushes the line chart and clicks the red cell (session state only). "Alert me if any region's p95 stays above 900 ms for three minutes." The rule appears with a 30-day backtest showing exactly one firing | rule, backtest, lineage, actions |
| 5 | 125–160 | "Who can see the finance board? Let the EMEA lead see only EMEA rows." `grant.check` gives before/after counts; the proposal is held (R-GRANT); **the finance analyst approves in her window**; the Exec view loses rows in place; the inspector shows different `policy_hash` values | grants, approval, separation of duties, per-principal cache key |
| 6 | 160–190 | Stale-base conflict: the agent holds r; the presenter edits the title (r+1); the agent's two-path change gets `CONFLICT` on the title path; the agent re-reads and commits only the width | merge rule, presence, agent self-correction |
| 7 | 190–205 | Presenter clicks Undo on the grant in the audit panel; the Exec view regains its rows | undo as an inverse Change, audit linkage |
| 8 | 205–235 | Presenter presses F7. The live fault ramps; the rule goes `pending` → `firing`; a workflow instance opens; toasts appear on all screens. "Nobody asked the agent to watch for this." | rule evaluator, workflow, actions, realtime |
| 9 | 235–258 | "Build an acknowledge form on the incident card with a note field, and a timeline of its state changes." It appears on the Phone and the Ops board | forms, actions, workflow source |
| 10 | 258–268 | Presenter taps Acknowledge on the Phone; all screens update; the audit row reads `user:ops-lead`, surface `ui` | write-back, workflow transition |
| 11 | 268–300 | **Finale:** "What did this incident touch? Build it." A lineage graph and a blast-radius panel composed from `lineage.edges`, `orders`, `audit.changes` and `workflow.transitions`; every count links to its query. No feature was written for this | emergent composition, metadata as source |

**House rules for all documents.** No estimates of how long work takes. Every major feature has
verifiable acceptance criteria. Guarantees are separated from aspirations by labelling each property
**Guarantee** (enforced and tested) or **Target** (a design goal, measured before it is claimed).
Design only: nothing is built here.

## Resolved decisions (consistency pass)

The consistency critic found contradictions between documents. These rulings settle them and rank
directly below the canonical facts above.

**Owner documents.** Where a detail is not listed below, the document that owns its topic wins:

| Topic | Owning document |
|---|---|
| Authorization, commit rules, approvals | 03 |
| MCP tools, envelope, error codes | 06 |
| DDL, ports, realtime protocol | 05 |
| Node and Grant schemas, query AST grammar, visual channels | 02 |
| Images, entrypoints, configuration keys, history layout | 07 |
| Stage timings, slack, stall grace, seeded board contents | `../presentation-script.md` |
| Generator and reset | 09 |

Every other document references the owner instead of restating it.

**Rulings.**

1. **Grant inspection.** The permission is named `grant:inspect`. It lets `grant.check` return
   counts and predicates for any principal on resources the delegator can administer. `user:ops-lead`
   holds it, and so does the agent ceiling. The agent ceiling never holds `grant:write` or
   `approval:decide`. Amendment P8 is satisfied by `grant:inspect` in place of `grant:admin`.
2. **Agent commit of a Grant.** `node.preview` returns a `preview_token` with `decision: "approval"`.
   `node.commit` returns `status: "pending_approval"` with `approval_id`. `FORBIDDEN` naming
   `grant:write` is returned only for an attempt to approve or force-apply a grant.
3. **Approver.** The approver needs `approval:decide` plus `grant:write` on the resource. The
   requester, the `on_behalf_of` principal and the delegator are excluded. In the demo the approver
   is `user:finance-analyst`.
4. **Undo of an approved grant.** Commit rule `R-GRANT-UNDO`: auto after preview for holders of
   `grant:write` on the resource, with no second approval. The change is audited as
   `grant.widened` and notified.
5. **Commit-rule table.** The 21-row table in 03 §6 is the single source. Other documents cite rule
   ids from it and do not keep their own tables.
6. **`replay_of`.** Text `'<transcript_id>:<step>'` on `changes`. It is included in the chain row
   hash and excluded from `change_hash`.
7. **Virtual clock.** `clock.speed = 6`, so the three-minute hold is about 30 s of wall time.
   `changes.virtual_at` exists, and audit-window queries filter on it.
8. **Stage timing.** Slack pool 30 s; no-call grace 8 s; multi-call step budget 20 s; query step
   budget 12 s.
9. **Error codes.** The 15-code enum in 06 §3, which includes `RULE_REFUSED`, `UNAUTHENTICATED`
   and `LOOP_SUSPECTED`, is closed and canonical. `LOOP_SUSPECTED` is returned on the fourth
   identical refused call. That call is not executed.
10. **Envelope.** The envelope carries both `call_id` and `trace_id`. `trace_id` equals the root
    span id.
11. **Visual types.** Amendment P1 applies. On stage: line (with brushing), bar, heatmap, KPI tile
    with sparkline, table, lineage graph. Supported and tested but not on stage: area, scatter,
    sankey, geo map.
12. **Trace ribbon tags.** `live` or `replay` on agent calls; `ui` on human gestures; `system` on
    worker effects.
13. **Preview token TTL.** 300 s.
14. **Presence TTL.** 5 s.
15. **Readiness.** Redis is non-blocking for readiness of every process except `rt`, which reports
    degraded but stays ready, because fan-out recovers by resume.
16. **Replay driver grants.** `driver:execute`, plus the recorded principal's effective
    permissions per step, evaluated as that principal with `on_behalf_of`. It never approves:
    approvals stay live human actions.
17. **Workflow instance states.** `open`, `acknowledged`, `resolved`, `closed`.
18. **Rule states.** `ok`, `pending`, `firing`, `resolved`. Transitions: ok→pending, pending→ok,
    pending→firing, firing→resolved, resolved→ok, resolved→pending.
19. **Actions.** The `ops-channel` notification is handler `notify`, internal (`external: false`).
    Handler `http` is for external egress only.
20. **Acceptance-criterion ids.** Each id is prefixed by its document number (`AC-03-…`,
    `AC-06-…`) wherever ids collide. `acceptance-matrix.md` maps old ids to new ones.
21. **Exec view.** A single pane showing the Ops board as the EMEA lead sees it.

## Ruling 22: purely functional backend with Effect (user decision, 2026-11-22)

All backend and shared packages are written in TypeScript in a purely functional style using
**Effect** (`effect`, `@effect/platform`, `@effect/sql`/`@effect/sql-pg`, `@effect/schema` via
`effect/Schema`). This covers `plinth-core`, `plinth-spec`, `plinth-query`, `plinth-engine`,
`plinth-api`, `plinth-rt`, `plinth-mcp`, `plinth-ingest`, `plinth-worker`, `plinth-gen` and
`plinth-driver`.

- **Effects are values.** All I/O, time, randomness, configuration and failure live in `Effect`.
  There are no `throw`s, no unhandled promises and no ambient mutable singletons. Every failure
  is a typed tagged error (`Data.TaggedError`) in the error channel, and the closed MCP/HTTP error
  codes (06 §3) are mapped from these tags at the edge.
- **Every service is a Layer.** Each interface in 07 (`ControlStore`, `EventBus`, `BlobStore`,
  `Ephemeral`, `Identity`, `Secrets`, plus `Clock`/`VirtualClock`, `QueryEngine`, `Authorizer`,
  `ChangeLog`, `Outbox`) is a `Context.Tag` service with live AWS/local Layers and in-memory test
  Layers. Local-versus-AWS parity is a choice of Layer at the entrypoint. The application code
  above it does not change.
- **Schemas are the source of truth.** Node kinds, the query AST, Change ops, the MCP tool inputs
  and outputs and the envelope are `effect/Schema` definitions. Decoding happens at every
  boundary. JSON Schema for the MCP tools and the OpenAPI document are derived from them
  (`JSONSchema.make`, `HttpApi`/OpenApi), so the "generated, cannot drift" guarantee (AC-FND-3) is
  met by construction.
- **The pure core stays pure.** Change application, merge, inverse ops, diff, canonical hashing,
  query typechecking and compilation to SQL, policy injection, the rule state machine and the
  generator step function are total functions over immutable data, with no Effect needed. Effect
  wraps them at the I/O boundary.
- **Concurrency.** Effect fibers, `Queue`, `PubSub`, `Stream` and `Schedule` are used for the
  outbox relay, realtime fan-out, rule evaluation ticks, ingest and the virtual clock. Resources
  are scoped (`Effect.acquireRelease`/`Scope`). Postgres transactions use `@effect/sql`
  `withTransaction`.
- **HTTP and realtime.** `@effect/platform` `HttpApi` (Node server) for the API.
  `@effect/platform` sockets, or `ws` wrapped in a scoped Effect, for `/rt`.
- **MCP.** Use `@effect/ai`'s `McpServer` if it supports stdio and Streamable HTTP with the
  features the SP-MCP spike needs: progress, cancellation and resource subscriptions. Otherwise
  wrap the official `@modelcontextprotocol/sdk` at the edge, with every handler implemented as an
  Effect run on the application runtime. The SP-MCP spike records which option was chosen.
- **Frontend.** The web UI is not required to use Effect. React stays as specified. It shares the
  `effect/Schema` definitions to decode API and realtime payloads.
- **Tests.** `@effect/vitest`, with test Layers. Property tests use `fast-check` through Effect's
  `Arbitrary` derivation from schemas.

## Residual rulings (after the fix pass)

These settle the contradictions the verifier still found. They rank with rulings 1–21.

23. **Backtest windows** are one-minute evaluation steps over 30 days, applying the rule's `hold`
    (three consecutive breaching minutes). The figure "windows of the hold duration" elsewhere is
    superseded.
24. **Approval timeout.** `approval.ttl_s = 900`.
25. **Rule id column.** `changes.rule_id` (text array of commit-rule ids). The name `policy_rule` is
    superseded. The chain row hash formula is the one in 05 §8; 02 references it.
26. **`trace_id`** is the 32-hex W3C trace id of the call's root span.
27. **`COMMIT_BUSY`** is not a separate code. Lock-wait timeout returns `CONFLICT` with
    `details.reason = "commit_busy"` and `retry_after_ms`. The enum stays at 15 codes.
28. **Workflow transitions** (owned by 05):
    - open → acknowledged (human, `workflow:acknowledge`);
    - open → resolved (rule resolved);
    - acknowledged → resolved (rule resolved, or human);
    - resolved → closed (human with `workflow:acknowledge`, or `system` after `workflow.auto_close_s`);
    - closed is terminal.
29. **Beat 4's rule** commits under `R-RULE-CREATE`. Its notify action is internal.
30. **A second grant preview by the agent** is held as `pending_approval` like the first one.
    Nothing refuses it.
31. **Agent-grant test name.** `agent_grant_commit_held`.
32. **Trace ribbon tags** are exactly `live`, `replay`, `ui` and `system`. Session-state gestures
    are not shown.
33. **Code is the tie-breaker.** From the build onward, if documents still disagree on a detail
    not covered here, the builder picks the owner document's version and records the choice in the
    commit message.

## Ruling 34: re-scope to the critical path first (user decision, 2026-11-22)

This ruling overrides the stack and the layer order wherever they conflict.

- **Minimal stack.** The stack is PostgreSQL, DuckDB over Parquet in object storage (MinIO locally,
  S3 on AWS), and Node processes. **No Kafka/Redpanda/MSK. No Redis/ElastiCache.**
- **Fan-out.** Postgres `LISTEN/NOTIFY` replaces Redis pub/sub. Each `rt` process holds one
  dedicated `LISTEN` connection and re-reads `changes` from each socket's cursor on notify. The
  outbox table remains for recovery.
- **Presence.** In memory behind the `Ephemeral` service. A shared-store Layer is added only if
  multi-replica becomes necessary.
- **Live feed.** `plinth-gen` writes Parquet partitions directly to object storage on each tick,
  publishing by rename and recording them in `source_partitions`. Determinism comes from seed,
  tick and fault profiles, as before.
- **Identity.** Keycloak/Cognito come late. Until then, a dev `Identity` Layer issues static
  per-principal tokens. The interface does not change.
- **New order.** The demo's critical path runs end to end first, then the agent loop, then
  breadth:
  1. L1 slice.
  2. Kernel, query, grants and preview/commit, enough for beats 2, 3, 5 and 6.
  3. The MCP surface, tested by the coordinator driving it as a real agent early and tuning tool
     descriptions and errors from that use.
  4. Rules, workflows and forms (beats 4, 8, 9 and 10).
  5. The finale (lineage source).
  6. Web polish and visuals.
  7. Replay driver and presenter console.
  8. Real identity providers, then the AWS mirror.
- **AWS.** Aurora PostgreSQL (or RDS PostgreSQL), S3, ECS Fargate, ALB and Cognito. Nothing needs
  MSK or ElastiCache. Deployment still requires the user's explicit approval.
- **Spec references** to Kafka, Redpanda, MSK, Redis and ElastiCache are superseded by this ruling.
