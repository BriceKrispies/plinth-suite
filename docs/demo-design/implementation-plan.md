# 19. Implementation dependencies and work breakdown

Owner of this section: the implementation plan for **Plinth**. Precedence follows `spec/README.md`, then `selection-rationale.md` (amendments P1–P20), then the spec documents, then `revised/04-emergent-composition.md`. Where this section names a grafted idea, the source proposal is cited by its number.

The plan is ordered by dependency: each layer names what it unblocks, and no layer begins its acceptance work until the layers it depends on have passed theirs. No durations appear anywhere in this section. Scope is described by what each layer touches.

Labels: every acceptance criterion is a **Guarantee** (enforced by a named test in CI or rehearsal) or a **Target** (a design goal, measured and reported before it is claimed). AC ids use the form `AC-<area>-<n>`. Areas: FND, SP, VS, KER, QRY, AUT, PRV, MCP, LOG, GATE, RT, WEB, DRV, OPS, REH. The areas AUT, KER, QRY, LOG, MCP, GATE, RT, DRV and REH are also used by other documents, so their ids in this section are written `AC-19-<area>-<n>`; `acceptance-matrix.md` maps them.

---

## 19.1 Ordering principles

1. **The architecture is proven before the surface.** The vertical slice (L1) touches every package at minimal depth. Nothing in L2 to L6 may widen a package boundary that L1 has not exercised.
2. **Every layer leaves the app runnable and testable.** Each layer ends with `make up` working, its named tests green on the stack, and a demonstrable subset of the five-minute script.
3. **Writes first, reads second, presentation last.** The Change path (L1–L2) precedes the compiler (L3), which precedes authorization (L4), preview (L5) and logic (L6). The web surface (L8) renders what the earlier layers already guarantee.
4. **The agent gate sits before the MCP surface freezes, and after the kinds it tests exist.** The gate's composition questions need rules, forms and workflows, so the gate follows L6. The surface is frozen only after the gate passes (CP-GATE).
5. **Spikes run early because they can change the design.** The AWS spike and the MCP SDK spike have no dependency on the application layers.

---

## 19.2 Dependency graph

```
L0 Foundations ─────────────┬──────────────┬──────────────┬─────────────┐
                            │              │              │             │
                       SP-AWS spike   SP-MCP spike   plinth-gen      (compose stack)
                            │              │         history build       │
                            │              │              │             │
L1 Vertical slice ◄─────────┴──────────────┼──────────────┴─────────────┘
   │                                       │
L2 Kernel (Change, merge, undo, chain) ◄───┘ (SP-MCP informs L5 schemas)
   │
L3 Query engine, as_of, policy injection, 30-day history + episode, audit/query sources
   │
L4 Authorization, principals, grants, approval, change.status
   │
L5 Preview and commit, tokens, lineage derivation, MCP verbs 1–13 and 15, CLI
   │
L6 Logic: rules, backtest, actions, workflows, forms, annotations, rule/workflow/lineage sources
   │
   ├──► CP-GATE (13-question evaluation, catalogue freeze)
   │
L7 Realtime hardening (resume, presence, outbox recovery, ui.present)  ◄── L1
   │
L8 Web surface (panels, visuals, session state, trace ribbon, windows) ◄── L6, L7
   │
L9 Presenter console, fault cue, replay driver, script ◄── L8, CP-GATE
   │
L10 AWS and local parity ◄── SP-AWS, L9 (staging replay requires L9)
   │
L11 Rehearsal, replay reproduction, measured report ◄── L9, L10
```

The critical chain is L1 → L2 → L3 → L4 → L5 → L6 → CP-GATE → L9 → L11. L7 and L8 run beside L5 and L6 once their interfaces are fixed. SP-AWS and SP-MCP join the chain at L10 and L5 respectively, and neither blocks the chain unless it fails (19.18).

---

## 19.3 Layer L0: foundations

**Adds.** TypeScript monorepo with one package per component in `spec/` and `revised/04` D.1 (`plinth-core`, `plinth-spec`, `plinth-query`, `plinth-engine`, `plinth-api`, `plinth-rt`, `plinth-mcp`, `plinth-web`, `plinth-ingest`, `plinth-worker`, `plinth-gen`, `plinth-driver`). Shared types with JSON Schema generation. Five image definitions on a distroless Node base: `plinth-app`, `plinth-worker`, `plinth-ingest`, `plinth-gen`, `plinth-driver`. Local compose stack: PostgreSQL 16, Redpanda, MinIO, Redis, Keycloak with a dev realm export. Readiness endpoints `/healthz` and `/readyz`. Make targets `make up` and stubs for the others. OpenTelemetry instrumentation points.

**Touches.** Repository layout, `deploy/compose`, `Makefile`, the schema generator.

**Depends on.** Nothing.

**Unblocks.** L1, SP-AWS, SP-MCP, plinth-gen history build.

**Acceptance.**
- AC-FND-1 (Guarantee): `make up` starts every local service in dependency order and `/readyz` reports each dependency. Test `up_ready`.
- AC-FND-2 (Guarantee): each image builds from one repository, is digest-pinned, and the same digest runs under compose. Test `image_digests`.
- AC-FND-3 (Guarantee): the JSON Schema for the fifteen node kinds is generated from the TypeScript types, and CI fails on drift. Test `schema_no_drift`.

**Demoable.** Nothing visual. The stack starts and reports ready.

---

## 19.4 Spikes (parallel to L1, no application dependency)

**SP-AWS: the riskiest infrastructure.** Run before L10 is scheduled, using the L0 images. The spike proves, in a throwaway AWS account environment, that: an ECS Fargate task in a private subnet with no NAT route completes a first DuckDB query over S3 through a VPC endpoint, with extensions bundled; the same task attaches to Aurora PostgreSQL; MSK with IAM authentication accepts a produce and a consume; ElastiCache accepts a TLS connection; an ALB forwards Streamable HTTP to the MCP service, which serves `/.well-known/oauth-protected-resource`. The spike's result is recorded as the Workgraph task result, not as a status document in the repository.

**SP-MCP: the protocol spike.** Before the L5 tool schemas are written, the official MCP TypeScript SDK is exercised from Claude Code and Claude Desktop over stdio and Streamable HTTP. It checks progress notifications, `notifications/cancelled`, and resource subscriptions with `notifications/resources/updated`. Its result decides whether any of those features is downgraded before the catalogue is fixed (`revised/04` H.2).

**Acceptance.**
- AC-SP-1 (Guarantee): SP-AWS records pass or fail for each of the five checks above. A failed check becomes a Workgraph task with a named mitigation.
- AC-SP-2 (Guarantee): SP-MCP records, for each protocol feature, whether both clients honour it.

---

## 19.5 Layer L1: vertical slice

This layer proves the architecture end to end, at minimal depth in each package.

**Adds.**
- One source: `orders`, landed by `plinth-ingest` as immutable Parquet partitions from a one-day seeded history (`plinth-gen`), published by rename, with a watermark over published partitions.
- One query: p95 fulfilment latency by region, compiled to parameterised DuckDB SQL by a minimal `plinth-query`.
- One panel kind (bar), one Dashboard kind, and the Source kind.
- One Change path: a commit transaction that locks `workspace_chain` `FOR UPDATE`, writes a `changes` row with `prev_hash`, updates `nodes`, and writes an `outbox` row. The `changes` table includes the `replay_of` column (P9) and the `virtual_at` column in this first migration, so no later migration is needed.
- Realtime: `/rt` WebSocket with `subscribe` and change push, fed from the outbox through Redis.
- MCP: `node.get`, `node.preview` (returns a Postgres-stored preview token) and `node.commit` (requires the token for agent principals).
- A minimal web page that renders one Dashboard and subscribes to it.

**Touches.** Every package, at minimal depth.

**Depends on.** L0.

**Unblocks.** L2 (the kernel is completed on this path), L7 (realtime hardening), L8 (the web page becomes the surface).

**Acceptance.**
- AC-VS-1 (Target): a panel committed through `node.commit` appears on two browser windows; commit-to-screen p95 under 300 ms on one host, measured by the rehearsal harness.
- AC-VS-2 (Guarantee): the commit appears in `changes` with `prev_hash` equal to the previous head, and `GET /audit/verify` passes. Test `chain_smoke`.
- AC-VS-3 (Guarantee): a partition is visible to queries only after its rename, and the watermark never exceeds the highest published partition. Test `partition_publish_atomic`.
- AC-VS-4 (Guarantee): `node.commit` by an agent principal without a valid preview token fails with `PREVIEW_REQUIRED`. Test `preview_required_smoke`.

**Demoable.** Beat 2 in miniature: an agent creates one bar panel by preview and commit, and two browsers show it.

---

## 19.6 Layer L2: kernel

**Adds.** Full Change operations (path operations with base revision, actor, surface, idempotency key, inverse ops). The merge rule (P13; 19.20, decision 9): disjoint paths rebase with `merged_from`; intersecting paths return `CONFLICT` with `conflicting_paths`, `head_revision`, `head_values_at_paths` and `your_values_at_paths`. Principal-scoped idempotency records, with reuse under a different body returning `IDEMPOTENCY_KEY_REUSED`. `undo` as an appended inverse Change (G2). Structural `diff` (G4). Snapshots every 50 changes per node. `GET /audit/verify`. A minimal `plinth apply` and `plinth diff` CLI (S4), which the commit-equivalence test requires as one of its four surfaces. HTTP API routes generated from the spec schema (S2).

**Touches.** `plinth-core`, `plinth-spec`, `plinth-api`, the CLI, `plinth-web` (undo control only, not yet on screen).

**Depends on.** L1.

**Unblocks.** L3 (the compiler reads committed state), L5 (preview extends the commit path).

**Acceptance.**
- AC-19-KER-1 (Guarantee): 1,000 random valid Change sequences applied through HTTP, MCP `node.commit`, the CLI and the UI API in fresh workspaces produce identical `body_hash` values, and `changes` rows differ only in `surface`. Test `commit_equivalence`.
- AC-19-KER-2 (Guarantee): 200 concurrent commits across 20 nodes in one workspace produce a linear chain, and `workspace_chain.head_seq` equals the row count. Test `chain_linear_under_concurrency`.
- AC-19-KER-3 (Guarantee): 300 random Changes by mixed principals, undone in reverse, return `body_hash` to its start value, the chain verifies at every step, and `changes` holds 600 unmodified rows. Test `undo_roundtrip`.
- AC-19-KER-4 (Guarantee): the merge rule holds for every pair of disjoint and intersecting path sets in a generated table. Test `merge_table`.
- AC-19-KER-5 (Guarantee): an idempotency key is scoped to `(workspace, principal, key)`; the same key from another principal is independent. Test `idempotency_scoped`.

**Demoable.** Commit history and undo through the API and CLI, with two surfaces producing identical audit shape.

---

## 19.7 Layer L3: query engine and history

**Adds.** The full query AST and typechecker (`from`, `where`, `derive`, `group`, `aggregate`, `window`, `join`, `union`, `order`, `limit`, `select`). Workspace predicate, row predicate attached to each source relation before any operator, and column masks (`revised/04` D.4). `as_of` pinning with `SOURCE_STALE` when the watermark is behind. Policy-keyed result cache keyed by `(query_hash, policy_hash, parameter_values, as_of)`, where `policy_hash` covers the column-mask set and versions (A-W1). The full 30-day history with the seeded EMEA/Crane `FaultProfile` (ramp 14:00–14:05, hold to 14:20, return by 14:25), the history manifest, and the snapshot. Metadata sources `audit.changes` and `query.runs`. Grants as Grant nodes, loaded through L2, read by the compiler.

**Touches.** `plinth-query`, `plinth-engine`, `plinth-gen`, `plinth-ingest`.

**Depends on.** L1, L2.

**Unblocks.** L4 (authorization decides what the compiler injects), L5 (preview runs queries), L6 (rules and backtests are queries).

**Acceptance.**
- AC-19-QRY-1 (Guarantee): for 10,000 generated queries and 200 generated grants, running as the restricted principal equals running with the grant's predicate written by hand, across joins and unions. Test `rls_differential`. L6 extends the same test to rule evaluation, backtest and form lookup.
- AC-19-QRY-2 (Guarantee): a masked and an unmasked principal with identical row predicates never share a cache entry. Test `cache_isolation`.
- AC-19-QRY-3 (Guarantee): a query with `as_of` returns no row with event time after `as_of`, and returns `SOURCE_STALE` with the watermark when the watermark is behind. Test `as_of_pinned`.
- AC-19-QRY-4 (Guarantee): `plinth-gen` regenerates the 30-day history from the seed, with `threads=1`, and its manifest hash equals the snapshot. Test `history_reproduces`.
- AC-19-QRY-5 (Guarantee): the seeded episode produces elevated EMEA/Crane handoff latency in 14:00–14:20. Test `episode_in_history`.
- AC-19-QRY-6 (Guarantee): the zero-row answer for `audit.changes` over 14:00–14:20 is returned by the compiler, not by a special case. Test `audit_source_zero_rows`.
- AC-19-QRY-7 (Target): aggregate over 2.4 million order rows grouped by region with a percentile, p95 under 200 ms; carrier-by-region heatmap over the same rows, p95 under 300 ms. Measured on the seeded history.

**Demoable.** Beats 2 and 3 answered through MCP `query.run`: the p95 result, the carrier breakdown and the zero-change answer, with no UI.

---

## 19.8 Layer L4: authorization and the agent principal

**Adds.** One `authorize(principal, action, resource_uri, context)` function (`revised/04` D.5), called by UI, API, MCP, driver and worker. Principal kinds `human`, `service`, `agent`. OIDC verification against the Keycloak dev realm (the Cognito adapter is L10). The agent ceiling (`max_scope`), and the three-way intersection of delegator grants, ceiling and token scope. Grant proposals held as Changes with `R-GRANT` approval (G8). Approval by a named human, with separation of duties (P7): the finance analyst approves, and neither the requester nor the delegator can. `grant.check` bounded (P8) and with the explanation folded in (P16). `change.status` (tool 15, P11).

**Touches.** `plinth-api`, `plinth-mcp` (two tools), the Keycloak realm export, the grant index.

**Depends on.** L2, L3.

**Unblocks.** L5 (preview checks permissions on every path), L6 (rules run as their owners), the Finance window (L8).

**Acceptance.**
- AC-19-AUT-1 (Guarantee): no route, tool or worker reads or writes through a path that bypasses `authorize`. Test `authorize_single_entry`, which enumerates every entry point.
- AC-19-AUT-2 (Guarantee): an agent's commit of a Grant returns `status: pending_approval` with an `approval_id` and is never applied directly; an agent attempt to approve or force-apply a grant fails with `FORBIDDEN` naming `grant:write`. Test `agent_grant_forbidden`.
- AC-19-AUT-3 (Guarantee): only a principal holding `approval:decide` and `grant:write` on the resource can approve a grant proposal; the requester, the `on_behalf_of` principal and the delegator cannot. The finance analyst can. Test `separation_of_duties`.
- AC-19-AUT-4 (Guarantee): without `grant:inspect`, `grant.check` answers only for the caller and its delegator, and a hidden column has the same response shape as an absent column. Test `grant_check_bounded`.
- AC-19-AUT-5 (Guarantee): the explanation returned by `grant.check` comes from the same evaluation that authorizes the query, and a denial names the grant id, never the hidden value. Test `explain_same_evaluation`.
- AC-19-AUT-6 (Guarantee): an agent's effective permissions equal the intersection of its three sets. Test `scope_intersection`.

**Demoable.** Beat 5 through MCP and CLI: `grant.check` before and after counts, an agent proposal held, and approval by the finance analyst's identity.

---

## 19.9 Layer L5: preview, commit and the MCP verbs

**Adds.** `node.preview` for every Change kind, with validation, diff, lineage delta, effects, owner and effective principal, and a token stored in Postgres (A-W3). `node.commit` with the commit transaction of `revised/04` D.6, including `PREVIEW_STALE` and `PREVIEW_REQUIRED` distinguished by a follow-up read. Cancellation honoured only before the transaction (B-7). Lineage derived from query ASTs and Action declarations, and the `lineage_delta` on preview (G.4). Preview variants of `node.delete` and `node.undo`. MCP verbs 1–13 and 15 (`schema.describe`, `node.get`, `node.search`, `source.list`, `query.run` with `dry_run`, `query.explain` with `policy_hash` and injected predicates (P17), `node.preview`, `node.commit`, `node.delete`, `node.undo`, `change.history`, `diff`, `grant.check`, `change.status`). The envelope of P5 on every response. The closed commit-rule table (P6). Untrusted-data structure (P14). Budgets, cursors and rate-limit weights (D.9). The MCP call log table that feeds the trace ribbon (19.20, decision 18). Both transports, from the SP-MCP outcome. The CLI `plinth apply` path now goes through preview.

**Touches.** `plinth-core`, `plinth-query` (lineage), `plinth-api`, `plinth-mcp`.

**Depends on.** L2, L3, L4, SP-MCP.

**Unblocks.** L6 (logic kinds are written through this path), CP-GATE (the catalogue exists in full).

**Acceptance.**
- AC-PRV-1 (Guarantee): for 500 random Change sets, the committed `body_hash` equals the previewed result and the committed ops equal the previewed diff. Test `preview_is_commit`.
- AC-PRV-2 (Guarantee): of two concurrent commits presenting one token, exactly one succeeds and the other returns `PREVIEW_REQUIRED`. Test `token_single_use_concurrent`.
- AC-PRV-3 (Guarantee): commits cancelled at random points resolve, by idempotency lookup, to the outcome the chain records. Test `cancel_outcome_matches_chain`.
- AC-19-MCP-1 (Guarantee): every response has the P5 shape, and every error carries `code`, the exact JSON `path`, the expected type or allowed values, and a machine-applicable suggestion. Test `envelope_contract`.
- AC-19-MCP-2 (Guarantee): the fourth identical refused call returns `LOOP_SUSPECTED` and is not executed. Test `loop_suspected`.
- AC-19-MCP-3 (Guarantee): every agent commit is classified by one closed table row, each row has one test, a Change matching no row is refused, and the rule id is stored on the change. Test `rule_table_closed`.
- AC-19-MCP-4 (Guarantee): every string from data is returned inside `{ "untrusted": "..." }`, whatever its field name. Test `untrusted_structural`.
- AC-19-MCP-5 (Guarantee): list tools honour default and maximum limits, and `schema.describe` stays within 8 KB without `kind` and 16 KB with it. Test `budgets_hold`.
- AC-19-MCP-6 (Guarantee): `lineage_delta` on a preview matches the lineage recomputed from the resulting document. Test `lineage_from_ast`.

**Demoable.** Beat 2 in full through MCP: preview diff, p95 panel and commit. Beat 6 through two MCP clients: the stale-base `CONFLICT`. Beat 7 through the undo preview.

---

## 19.10 Layer L6: logic

**Adds.** Rule state machine (ok, pending, firing, resolved) with `firing_id` so each firing produces one notification. Threshold predicate. Backtest as a query over 30 days in hold-sized windows, run as the rule's owner. Actions with declared effects, which cannot write an undeclared path. Workflow instances with transition history. Forms bound to a source whose submit runs an Action. Annotation kind (minimal, needed for the P14 adversarial set). Metadata sources `workflow.instances`, `workflow.transitions`, `rule.firings` and `lineage.edges`. Rule ownership: `owner = agent:claude-code` with `on_behalf_of` the creating human, and firing-time effective permissions as the intersection (D.5, D-W7). The full set of commit rules that agents can trigger, including the rule ids for rule creation, binding and grants.

**Touches.** `plinth-worker`, `plinth-query`, `plinth-spec`, `plinth-api`, `plinth-mcp`.

**Depends on.** L3 (backtest and the episode), L4 (owners and ceilings), L5 (preview and commit).

**Unblocks.** CP-GATE (composition questions C1 and C2 need these kinds), L8 (forms, workflows and rule strips to render).

**Acceptance.**
- AC-19-LOG-1 (Guarantee): a rule's state moves ok → pending → firing → resolved, and each firing produces exactly one notification. Test `rule_fires_once`.
- AC-19-LOG-2 (Guarantee): the backtest of the p95 rule over the 30-day history reports exactly one firing, on the EMEA/Crane episode. Test `backtest_fires_once`.
- AC-19-LOG-3 (Guarantee): under the demo ceiling, an agent-owned rule with `action:notify` fires and posts; a rule with a `grant:write` action is refused at preview. Test `agent_rule_notify`.
- AC-19-LOG-4 (Guarantee): an Action's write to a path it did not declare is refused. Test `action_declared_paths`.
- AC-19-LOG-5 (Guarantee): the acknowledge Form submit creates a Change against the instance with actor `user:ops-lead`, and the workflow moves to `acknowledged`. Test `acknowledge_audit_row`.
- AC-19-LOG-6 (Guarantee): `lineage.edges` is queryable and lists every dependent of `orders.fulfilled_at` computed from the ASTs. Test `lineage_source_complete`.
- AC-19-LOG-7 (Guarantee): a seeded annotation containing an instruction is returned as untrusted data and grants nothing. Test `annotation_untrusted`.
- AC-19-LOG-8 (Guarantee): `rls_differential` passes for rule evaluation, backtest and form lookup. Test `rls_differential_paths`.

**Demoable.** Beat 4 (rule and backtest), beat 8 (rule to firing to workflow, driven by an API fault for now), beat 9 (form and timeline), beat 10 (acknowledge through the API), beat 11 (lineage query through MCP).

---

## 19.11 Checkpoint CP-GATE: agent path and surface freeze

**Adds.** The 13-question evaluation of `revised/04` C.5: ten single-kind questions (Q1–Q10) and three composition questions (C1 agent-owned rule within the ceiling, C2 form plus source plus workflow timeline, C3 grant plus row predicate plus panel checked with counts). Each question is run 20 times with a general model given only the tool list and resources. The gate file and its hash are committed before the first scored run. The rehearsal report later publishes every failing run in full.

**Pass rule (pre-registered).** At least 11 of 13 questions reach a pass rate of at least 0.75, and each composition question reaches at least 0.6. If the gate fails, descriptions, schemas and examples are revised and the evaluation runs again. The question set is not reduced.

**Freeze.** The catalogue hash (tool names, schemas, descriptions, resource templates, prompts) is recorded at pass. Any later change to those reruns the affected questions.

**Depends on.** L6 (for C1 and C2), L5 (for the catalogue).

**Unblocks.** L9 (the script's agent steps are measured against the frozen surface).

**Acceptance.**
- AC-19-GATE-1 (Guarantee): the gate file hash is recorded before the first scored run. Test `gate_hash_precedes_run`.
- AC-19-GATE-2 (Guarantee): the pass rule above is computed by code from the recorded runs, not by hand. Test `gate_rule_computed`.
- AC-19-GATE-3 (Guarantee): the catalogue hash in the freeze record equals the hash of the served catalogue. Test `catalogue_hash_matches`.
- AC-19-GATE-4 (Target): each of the 13 pass rates is measured and published; the threshold is a pass criterion, not a prediction.

**Demoable.** Nothing on the room display. The gate result is part of the rehearsal report.

---

## 19.12 Layer L7: realtime hardening

**Adds.** Subscriptions with last-seen revision: missed changes from the log when in range, a snapshot otherwise. Sequence-gap refetch. Presence from Redis, throttled to 5 updates per second per node. Outbox relay recovery after Redis loss (A-W10). MCP resource subscriptions. `ui.present` (tool 14), which delivers to `all` or `principal:<id>` only for principals that started the session, and is audited as `surface = mcp, kind = present`.

**Touches.** `plinth-rt`, `plinth-mcp`, `plinth-api`.

**Depends on.** L1 (realtime path), L5 (tool 14 joins the catalogue before CP-GATE).

**Unblocks.** L8 (the screens depend on resume and presence), L9 (the presenter console depends on `ui.present`).

**Acceptance.**
- AC-19-RT-1 (Guarantee): a reconnecting client with a valid last-seen revision receives exactly the missed changes in order; an out-of-range revision receives a snapshot. Test `resume_by_revision`.
- AC-19-RT-2 (Guarantee): a sequence gap causes a refetch, and the client converges to the head. Test `gap_refetch`.
- AC-19-RT-3 (Guarantee): with Redis stopped, commits succeed; after Redis returns, the outbox relay delivers every pending change. Test `redis_loss_recovers`.
- AC-19-RT-4 (Guarantee): presence updates per node never exceed 5 per second. Test `presence_throttle`.
- AC-19-RT-5 (Guarantee): `ui.present` cannot target a principal that did not start the session. Test `ui_present_scope`.

**Demoable.** Reconnect and resume without screen reload, shown on a second browser.

---

## 19.13 Layer L8: web surface

**Adds.** The grid (react-grid-layout) and the phone breakpoint (V10). Visuals on stage: line with brushing, bar, heatmap, KPI tile with sparkline, table and lineage graph. Area, scatter, sankey and geo map are supported and tested but not on stage (P1). Each visual maps result columns to typed channels, and an unmapped field is an error. Session state for parameters, brushing and cross-filter in the URL and the session, creating no revision and no audit row (P3). Animation tied only to sequence numbers or user gestures (P2). The trace ribbon on every screen (P4). Inspector showing `policy_hash` per principal (P17). Conflict banner for the stale-base case (P13). Commit card showing its rule id (P6). The lineage graph as an ECharts graph series. Undo control in the audit panel (G2). Approval controls on the Finance window. Windows: Ops board, Exec view, Finance window and Phone, with the Exec view a single pane showing the Ops board as the EMEA lead sees it (19.20, decision 5). The `plinth.seq` value exposed to Playwright.

**Touches.** `plinth-web`, `plinth-rt`, `plinth-api`.

**Depends on.** L6 (forms, workflows, rule strips), L7 (resume and presence). The L1 web page is the starting point.

**Unblocks.** L9 (presenter console and driver drive these windows), L11 (rehearsal).

**Acceptance.**
- AC-WEB-1 (Guarantee): an animation without an originating event id fails the build. Test `animation_requires_event`.
- AC-WEB-2 (Guarantee): brushing, cross-filter and parameter changes create zero changes and zero audit rows. Test `brush_no_revision`.
- AC-WEB-3 (Guarantee): the trace ribbon shows tool, argument summary, status, change sequence, principal and a `live`, `replay`, `ui` or `system` tag on every window. Test `trace_ribbon_fields`.
- AC-WEB-4 (Guarantee): a field mapped to no channel is an error in the panel editor and in the API. Test `visual_channel_strict`.
- AC-WEB-5 (Guarantee): the stale-base scenario reproduces in Playwright: the banner names both authors and the conflicting path, the title is preserved and the width merges. Test `stale_base_scenario`.
- AC-WEB-6 (Guarantee): the Phone window renders at phone width with no horizontal scroll. Test `phone_layout`.
- AC-WEB-7 (Target): commit-to-screen p95 under 300 ms across four windows on one host.

**Demoable.** Beats 1 to 11 on the windows, with the trace ribbon visible.

---

## 19.14 Layer L9: presenter console, fault cue and replay driver

**Adds.** The presenter console (virtual clock, stall indicator, driver mode, step list, slack pool, fault cue key). A presenter control API on a separate port, set by config key `PLINTH_PRESENTER_PORT` (value 8791, 07 section 14.2), with a separate credential, carrying the F7 fault cue (P15). The cue is applied at the next generator tick, which is recorded. The Rule evaluator moves the rule through `pending` to `firing` on the virtual clock. The transcript recorder. The replay driver as `service:replay-driver` with `on_behalf_of` the recorded human and `surface = driver` (P9). Satisfaction predicates per step, takeover at the next step boundary with an 8 s stall grace, and resume rather than restart (P10). The F9 switch at a step boundary. Per-step budgets (12 s query, 20 s multi-call) and a hard maximum of 300 s (P19). `make demo-replay STEP=n` and `make demo-reset`. The `plinth-driver` image.

**Touches.** `plinth-driver`, `plinth-gen` (tick recording), `plinth-worker` (rule evaluator), `plinth-api` (presenter API, separate listener), `plinth-web` (console).

**Depends on.** L8, CP-GATE, L6.

**Unblocks.** L10 staging replay, L11 rehearsal.

**Acceptance.**
- AC-19-DRV-1 (Guarantee): the fault cue is absent from the MCP tool list and from every agent grant. Test `fault_console_absent`.
- AC-19-DRV-2 (Guarantee): the cue is applied at a recorded generator tick; a scripted cue is issued only after 5 s of presenter silence. Test `cue_at_tick`.
- AC-19-DRV-3 (Guarantee): every replayed change row has `surface = driver` and a `replay_of` reference, and the driver never uses the presenter's session. Test `driver_principal`.
- AC-19-DRV-4 (Guarantee): takeover skips satisfied steps, never inverts another principal's change, handles creates by slug, and refuses with "reset required" only when a predicate is unsatisfiable. Test `takeover_predicates`.
- AC-19-DRV-5 (Guarantee): the switch takes effect only at a step boundary, and a cancelled commit is resolved by idempotency lookup. Test `switch_boundary`.
- AC-19-DRV-6 (Guarantee): the script's summed step budgets never exceed 300 s, and the slack pool is shown on the console after each step. Test `script_budget`.

**Demoable.** The full five minutes on the local stack, live or replayed, with one keystroke between them.

---

## 19.15 Layer L10: AWS and local parity

**Adds.** AWS CDK stacks (TypeScript) for ECS Fargate behind an ALB, Aurora PostgreSQL, MSK with IAM, S3, ElastiCache, Cognito, Secrets Manager and the OpenTelemetry path. The Cognito `Identity` adapter and the Keycloak adapter, each passing the OIDC contract suite. Contract suites for Kafka (ordering per key, redelivery after crash), S3 (multipart, listing), OIDC (claims, expiry), Redis (keys, TTLs, channels) and Postgres (isolation). The private-subnet startup test from SP-AWS, now in CI. MCP over Streamable HTTP on AWS with OAuth protected-resource metadata, and no stdio on AWS.

**Touches.** `deploy/aws`, `deploy/compose`, the adapters, `plinth-mcp` transport configuration.

**Depends on.** SP-AWS, L0, L9 (staging replay).

**Unblocks.** L11.

**Acceptance.**
- AC-OPS-1 (Guarantee): every contract suite passes against the local and AWS implementations. Test `contract_suites`.
- AC-OPS-2 (Guarantee): `private_subnet_startup` passes with no NAT route and only S3 and Secrets Manager endpoints. Test `private_subnet_startup`.
- AC-OPS-3 (Guarantee): the same five image digests run both stacks. Test `digest_parity`.
- AC-OPS-4 (Guarantee): the MCP tool list, schemas, errors and audit rows are identical on stdio (local) and Streamable HTTP (local and AWS). Test `mcp_transport_parity`.
- AC-OPS-5 (Guarantee): `replay_reproduces` passes on staging with the same digests. Test `replay_reproduces_staging`.

**Demoable.** The same script on AWS staging.

---

## 19.16 Layer L11: rehearsal and measured report

**Adds.** The Playwright rehearsal across four windows (Ops board, Exec view, Finance window, Phone), with the presenter console driven through its API, plus the replay driver. `make rehearse`. `replay_reproduces` locally (10 runs) and on staging (10 runs). Takeover rate measured per step over at least 10 model-in-the-loop runs (P18). Steps above the pre-registered threshold are replay-by-default and tagged on the ribbon. Each G.2 failure row is exercised once: lost cue, feed stall, Redis down, browser socket loss, slow agent. Targets measured: query latency, commit-to-screen, demo reset time.

**Touches.** `tests/rehearsal`, the report generator, `plinth-driver`.

**Depends on.** L9, L10.

**Unblocks.** The demonstration.

**Acceptance.**
- AC-19-REH-1 (Guarantee): `make rehearse` completes the script with no manual step other than the scripted presenter actions. Test `rehearse_full`.
- AC-19-REH-2 (Guarantee): every query result hash and change hash in the transcript matches on all 20 replays. Test `replay_reproduces`.
- AC-19-REH-3 (Guarantee): the takeover-rate table lists each step with its measured rate (a Target) over at least 10 runs and the steps replayed by default. Test `takeover_report_complete`.
- AC-19-REH-4 (Target): `make demo-reset` completes within the target measured in rehearsal.
- AC-19-REH-5 (Target): all performance Targets from AC-19-QRY-7, AC-VS-1 and AC-WEB-7 are reported with measured values.
- AC-19-REH-6 (Guarantee): the report lists every gate question with its pass rate and every failing run in full.

**Demoable.** The finished demonstration, with its rehearsal report.

---

## 19.17 Parallel streams

| Stream | Layers | Can start after |
|---|---|---|
| Kernel and data | L1 → L2 → L3 → L4 → L5 → L6 | L0 |
| MCP | SP-MCP → L5 verbs → L7 `ui.present` → CP-GATE | L1 (SP-MCP can start with L0) |
| Generator | plinth-gen history and episode (pure library, no database) | L0 |
| Realtime and web | L1 web page → L7 → L8 | L1 |
| Deployment | compose (L0) → SP-AWS → L10 | L0 |
| Driver and script | L9 transcript and predicates → L9 driver → L11 | L6 and L8 interfaces |

Work in each stream touches disjoint packages except at the interfaces named in each layer. Those interfaces are the Change path (L1), the query AST (L3), the envelope and error model (L5) and the realtime message format (L7).

---

## 19.18 Cut list if scope must shrink

The cut order follows `revised/04` H.5, adjusted for the amendments.

**Cut first (no amendment protects them):**
1. Embedding (V11) and its signed-token issuance.
2. Scheduled export (L5). Its path is removed from the differential test list in AC-19-QRY-1 and AC-19-LOG-8.
3. Templates (G5) beyond the declared-parameter document form.
4. Anomaly window (L9). Trailing z-score tests are removed.
5. Comments (V7) and mention notifications.
6. Branch and merge (G3). The single-dashboard branch stays as supporting.

**Cut next (cost recorded, amendment reference noted):**
7. Area, scatter, sankey and geo map. P1 makes them supported with tests, so this cut removes their tests and their on-screen support together, and the change is recorded in the acceptance matrix.
8. The Cognito adapter's full contract suite. It may be reduced to claim presence and expiry, with the rest recorded as a limitation in the runbook (E.2).
9. Rehearsal runs above the minimum: staging replay drops from 10 to 3 runs, and the local count stays at 10.

**Not cut.** The kernel (L1–L2), the query compiler with policy injection (L3, AC-19-QRY-1 and AC-19-QRY-2), the fifteen tools, preview and commit (L5), undo (L2), approval and separation of duties (L4), realtime and presence (L7), the rule, workflow and form chain (L6), the lineage source (AC-19-LOG-6), the trace ribbon (AC-WEB-3), the fault-cue separation (AC-19-DRV-1) and the fallback driver (L9). Annotations are kept with the minimal node kind (AC-19-LOG-7), even though annotation UI is cut, because P14 requires the seeded injection case.

**If SP-AWS fails.** L10 is the only layer blocked. The local stack remains the complete demonstration, and the AWS parity criteria are reported as not met with the failing check named.

---

## 19.19 Demo beat coverage

| README beat (s) | First layer that can show it | Final layer |
|---|---|---|
| 1 (0–25) three windows, presence, KPI tile | L1 (two windows) | L8 |
| 2 (25–55) p95 panel, Exec EMEA restriction | L5 | L8 |
| 3 (55–95) carrier breakdown, control window, zero changes | L3 (queries) | L8 |
| 4 (95–125) rule and 30-day backtest | L6 | L8 |
| 5 (125–160) grant proposal, approval, before and after counts | L4 | L8 |
| 6 (160–190) stale-base conflict | L5 | L8 |
| 7 (190–205) undo of the grant | L2 (undo) | L8 |
| 8 (205–235) F7 fault, rule firing, workflow | L6 (API cue) | L9 (console cue) |
| 9 (235–258) acknowledge form and timeline | L6 | L8 |
| 10 (258–268) acknowledge tap on Phone | L6 (API) | L8 |
| 11 (268–300) blast-radius panel | L6 (lineage source) | L8 |

Beat 11 is the finale. Its content is composed by the agent at the time of the demonstration, and its lineage source and metadata sources are complete at L6, so the closing answer does not depend on any feature written for it.

---

## 19.20 Decisions taken in this plan

1. The MCP catalogue has 15 tools, following the README and P11. `revised/04` D.7 says 14 in several places.
2. Five images, following the README. `revised/04` E.1 lists four and omits `plinth-driver`.
3. Beat times are the README's table. The per-step times in `revised/04` C.2 differ and are superseded. The exact script belongs to `presentation-script.md`.
4. The room display and rehearsal windows are Ops board, Exec view, Finance window and Phone, following the README. `revised/04` C.1 lists no Finance window. The presenter console is driven through its API and is not counted among the four.
5. The Exec view is one pane showing the Ops board as the EMEA lead sees it (README ruling 21). It does not show the finance board. `revised/04` C.1 shows only the finance board.
6. Beat 3's comparison is the control window of yesterday 14:00–14:20 (P12). The 13:00–14:00 baseline column in `revised/04` C.2 is dropped.
7. The grant approver is the finance analyst (P7). `revised/04` C.2 says the presenter approves; that is superseded.
8. The driver writes as `service:replay-driver` (P9). `revised/04` C.3 says human steps use the presenter's session; that is superseded.
9. Takeover uses satisfaction predicates (P10). Change hashes are kept only for the `replay_reproduces` verification, and the merge rule is the one in P13.
10. The untrusted envelope key is `untrusted` (P14). `revised/04` D.10 names `untrusted_data`.
11. `IDEMPOTENT_REPLAY` is not an error code. A replayed commit is a success with `replayed: true`. `LOOP_SUSPECTED` (P5) is added to the closed set.
12. P1 governs visual types. Line is on stage, not supporting. Sankey and geo map are supported with tests. `revised/04` D lists them as out of version 1.
13. The lineage question "what depends on this field" is a `query.run` over `lineage.edges`. `revised/04` C.2 names `lineage.dependents`, which is not a tool in the catalogue.
14. Gate placement: the gate follows L6, not the web surface, because C1 and C2 need rules, forms and workflows. `revised/04` H.4 places it before the web surface and before those kinds.
15. The presenter port and credential are config keys (`PLINTH_PRESENTER_PORT` and its credential). The port value is 8791 (07 section 14.2).
16. The slack pool is 30 s (README ruling 8). The takeover threshold is not fixed here, and the presentation script and rehearsal config must pin it before the first scored run.
17. The `changes` table gets `replay_of` in the first migration (P9).
18. The `call_log` table (05 section 8.2) holds one row per MCP call, and the trace ribbon reads it through realtime. `revised/04` D.2 has no such table.
19. The commit-rule table is the closed table in `03-authorization-and-security.md` section 6 (README ruling 5). This plan requires one test per row, and it names only the three examples P6 gives explicitly.
20. The visual channel `line` is on stage, following P1.
21. The `FaultProfile` ramps handoff latency from 1.0 to 2.2 between 14:00 and 14:05, holds to 14:20 and returns to 1.0 by 14:25 (`revised/04` A). This matches the README's ramp and hold.

Each AC id above is intended for the acceptance matrix (`acceptance-matrix.md`), and each named test is a CI or rehearsal test.
