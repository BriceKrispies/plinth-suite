# 08. Automated tests, acceptance criteria, observability and diagnostics

Part of the Plinth definitive specification. This file covers mission sections 15 (automated tests and acceptance criteria) and 16 (observability and operational diagnostics). It binds to `README.md`, to the amendments in `../selection-rationale.md` (P1 to P20), and to the base design in `../revised/04-emergent-composition.md`. Where this file names a canonical fact, it uses the README's wording.

**Labels.** Each property is labelled **Guarantee** (enforced by a named test that can fail the build or the stack) or **Target** (a design goal, measured in the rehearsal report before it is claimed). Configured values are labelled **Budget**. Nothing here estimates how long work takes. Work is ordered by dependency, and each test names what it touches.

**Acceptance-criteria ids.** `AC-<area>-<n>`. Areas: `KER` kernel, `QRY` query and policy, `AUT` authorization, `PRV` preview and commit, `RT` realtime, `MCP` tool surface, `DRV` driver, `UI` web surface, `ADP` adapter contracts, `DEP` deployment, `GATE` agent gate, `REH` rehearsal beats, `CRT` commit-rule table, `OBS` observability, `TRC` trace ribbon, `RUN` runbooks. Where an id collides with an id in another document, it takes this document's number as a prefix (`AC-08-<area>-<n>`, README ruling 20).

---

## 15. Automated tests and acceptance criteria

### 15.1 Test pyramid

The pyramid has seven levels. Lower levels run on every change. Higher levels run once on the stacked integration line, and the top levels also run against AWS staging.

| Level | What it covers | Where it runs | Guarantee or Target |
|---|---|---|---|
| L0 static | Type check, formatting, lint, JSON Schema and OpenAPI regeneration with an empty diff, closed-enum consistency (error codes, rule ids, tool names), static animation lint, static scan that every registered handler calls `authorize` | Every change | Guarantee |
| L1 unit | `plinth-core` (Change application, merge table, hashing, diff), `plinth-spec` (parser, canonical serialisation), `plinth-query` typechecker | Stacked run | Guarantee |
| L2 property | Seeded random generation (fixed seed per suite, recorded in the report): commit equivalence, undo round trip, preview equals commit, merge table, lineage matches AST | Stacked run | Guarantee |
| L3 integration | Real PostgreSQL 16, DuckDB with bundled extensions, Redpanda, MinIO, Redis and Keycloak in containers. The engine, ingest, worker and API run against them | Stacked run | Guarantee |
| L4 contract | One suite per adapter (`ControlStore`, `EventBus`, `BlobStore`, `Ephemeral`, `Identity`, `Secrets`, `Telemetry`), run against the local implementation and the AWS implementation | Stacked run (local); staging (AWS) | Guarantee |
| L5 end to end | Playwright drives the four windows and the replay driver through the script (the rehearsal, `make rehearse`) | Stacked run | Guarantee for the assertions; flake rate is a Target |
| L6 agent evaluation | The 13-question gate (section 15.6) and the takeover-rate measurement | Stacked run, with a pinned model | Measured quantity (Target) |
| L7 deployment parity | Same image digests on both stacks, private-subnet startup, replay on staging | Staging | Guarantee |

**Named tests.** Every test below has one id. A test name is unique across the repository. A test may be run at several levels, but it is listed once.

### 15.2 Per-change checks and the stacked run

**Rule.** An agent working on one change runs only L0 checks on the files it touched, and commits. It does not run L1 to L7 suites, the rehearsal, the agent gate or the replay. The coordinator collects finished changes into a stack, merges them onto the integration line, and runs the stacked suites once on the combined result. This follows the project's stacked-testing rule.

**Per-change (L0 only).**
- `tsc --noEmit` for the touched packages.
- Format and lint on the touched files.
- Regeneration of JSON Schema and OpenAPI, with an empty diff against the committed output. (AC-08-DEP-6 depends on it.)
- Closed-enum consistency: the error-code enum in `plinth-mcp`, the rule ids in the commit-rule table, and the tool manifest must match the names in this file and in `06-mcp-server.md`.

**Stacked run (L1 to L6), in dependency order.** A failure stops the run at its level.
1. L0 on the whole stack.
2. L1 and L2, with property case counts at the routine setting.
3. L3 against the containers, with the heavy suites (`rls_differential`, `replay_reproduces` locally, `chain_linear_under_concurrency`) run with at most two workers. The machine-saturation finding behind the stacked rule applies here too.
4. L4 local contract suites.
5. L5 rehearsal (`make rehearse`).
6. L6 agent gate and takeover measurement, only when the stack changes the MCP tool surface, a description, a schema, an error or the driver. Otherwise the last gate result stands, and its hash is recorded.

**Budgets.** **Budget.** The routine stacked tier (L0 to L2 and the L3 suites without the heavy set) is held to a ceiling of 2 minutes of wall time on the reference machine. A suite that breaks that ceiling is pruned or consolidated before any other suite is added (AC-TEST-2). The full stacked run is not budgeted in minutes. It is budgeted by its suite list above, which is fixed.

**Failure procedure.** When the stack fails, the failing change is found on the stack itself, by bisecting the stack's commits or by reading the failure. The change is sent back with the failing output. Changes are not re-tested one by one in isolation. (AC-TEST-3.)

| Id | Criterion | Guarantee or Target |
|---|---|---|
| AC-TEST-1 | The L0 suite runs on every change and fails on any closed-enum drift between code and this file | Guarantee |
| AC-TEST-2 | The routine stacked tier stays under its wall-time ceiling on the reference machine, measured in each stacked run's report | Budget (measured) |
| AC-TEST-3 | A stack failure is attributed to one commit by bisection on the stack, and the report names it | Guarantee (procedure) |
| AC-TEST-4 | No test in the repository is skipped without an entry in the stacked report naming the reason | Guarantee |
| AC-TEST-5 | Every test id in section 15.3 to 15.5 exists in the repository, and every test in the repository is named in these sections or in `09-demo-operations.md`. A test that is in neither fails the L0 check | Guarantee |

### 15.3 Named tests by area

Each row is one test. "Asserts" states the observable property. Tests marked "property" use seeded generation and print the minimal failing case.

**Kernel (`AC-KER`).**

| Id | Test | Asserts | Level |
|---|---|---|---|
| AC-08-KER-1 | `commit_equivalence` | 1,000 random valid Change sequences, each applied through the HTTP API, MCP `node.commit`, the CLI and UI API calls in fresh workspaces. Every node's `body_hash` is identical across surfaces, and `changes` rows differ only in `surface` | L2, Guarantee |
| AC-08-KER-2 | `chain_linear_under_concurrency` | 200 concurrent commits over 20 nodes in one workspace. The chain links with no fork, and `workspace_chain.head_seq` equals the row count | L3, Guarantee |
| AC-08-KER-3 | `undo_roundtrip` | 300 random Changes by human, agent and driver principals, then undone in reverse. `body_hash` returns to its start value at every step, the chain verifies at every step, and `changes` holds 600 rows, none modified | L2, Guarantee |
| AC-08-KER-4 | `undo_conflict_names_later_change` | Undo of a change whose paths a later change touched returns `CONFLICT` naming that later `seq`, and writes nothing | L3, Guarantee |
| AC-08-KER-5 | `merge_table` | Table-driven. Disjoint paths rebase and set `merged_from`. Intersecting paths return `CONFLICT` with `conflicting_paths`, `head_revision`, `head_values_at_paths`, `your_values_at_paths`. List moves are a remove and an insert with the same stable id | L1, Guarantee |
| AC-08-KER-6 | `idempotency_principal_scoped` | The same key from two principals succeeds for both. The same principal with a different body returns `IDEMPOTENCY_KEY_REUSED`. A repeated identical request returns the stored result with `replayed: true` | L3, Guarantee |
| AC-08-KER-7 | `audit_verify_detects_tamper` | Altering one row in a copy of the chain makes `GET /audit/verify` fail at that `seq` | L3, Guarantee |
| AC-08-KER-8 | `session_state_no_revision` | Setting a parameter, brushing a chart and drilling down produce zero `changes` rows and zero audit rows (amendment P3) | L5, Guarantee |

**Query and policy (`AC-QRY`).**

| Id | Test | Asserts | Level |
|---|---|---|---|
| AC-08-QRY-1 | `rls_differential` | 10,000 generated queries over `orders` and 200 generated grants. Each result equals the one from the same query with the grant's predicate written by hand into `where`. The same holds through rule evaluation, backtest, scheduled export and form lookup, including joins and unions. No path returns a row the grant excludes | L2, Guarantee |
| AC-08-QRY-2 | `cache_isolation` | A masked and an unmasked principal with identical row predicates get different `policy_hash` values, separate cache entries and no shared result | L3, Guarantee |
| AC-08-QRY-3 | `cache_invalidation_on_grant_change` | A new grant-index version or mask version changes every affected key. Entries under the old key are unreachable | L3, Guarantee |
| AC-08-QRY-4 | `as_of_pinning` | A query at a recorded `as_of` returns the same rows whether it runs before or after the live feed advances | L3, Guarantee |
| AC-08-QRY-5 | `source_stale_refusal` | A query whose `as_of` is ahead of the watermark waits within its budget, then returns `SOURCE_STALE` with the watermark | L3, Guarantee |
| AC-08-QRY-6 | `lineage_matches_ast` | Property. For every expression form, `lineage.dependents` equals the field set derived from the AST. Adding a form without extending lineage fails | L2, Guarantee |
| AC-08-QRY-7 | `episode_in_history` | Over 14:00 to 14:20 for EMEA and Crane, the seeded profile produces the ramp and the breach of the 900 ms threshold at 14:05. The same query over the comparison window does not | L3, Guarantee |
| AC-08-QRY-8 | `backtest_fires_once` | The demo rule's 30-day backtest in one-minute windows reports exactly one firing, 14:03 to 14:20, and no other window in the history breaches | L3, Guarantee |
| AC-08-QRY-9 | `history_reproduces` | Rebuilding the history from the committed seed in a build job yields a manifest hash equal to the snapshot's | L3, Guarantee |
| AC-08-QRY-10 | `generator_pure_function` | For the committed seed, the output of ticks 0 to 10,000 matches the committed golden vector, and output at a tick depends only on the seed and the profiles applied at or before that tick | L1, Guarantee |
| AC-08-QRY-11 | `closed_visual_channels` | A field mapped to no channel of its visual type is a validation error, not a silent drop | L1, Guarantee |

**Authorization (`AC-AUT`).**

| Id | Test | Asserts | Level |
|---|---|---|---|
| AC-08-AUT-1 | `agent_rule_notify` | Under the demo ceiling, a rule whose action has `action:notify` fires and posts. A rule whose action has `grant:write` is refused at preview, with the reason shown | L3, Guarantee |
| AC-08-AUT-2 | `agent_grant_commit_held` | An agent commit of a Grant returns `status: "pending_approval"` with an `approval_id` (README ruling 2). `FORBIDDEN` naming `grant:write` is returned only for an agent attempt to approve or force-apply a grant | L3, Guarantee |
| AC-08-AUT-3 | `sod_requester_cannot_approve` | Separation of duties (amendment P7). The delegator `user:ops-lead` and the agent principal cannot approve a held grant (`FORBIDDEN`). `user:finance-analyst` can, since she holds `approval:decide` and `grant:write` on the resource (03 section 7.2; README ruling 3). Approving a change whose `actor_id` or `on_behalf_of` is the approver is refused in every case | L3, Guarantee |
| AC-08-AUT-4 | `grant_check_bounded` | Without `grant:inspect`, `grant.check` returns counts only for the caller and its delegator. For another principal it returns `row_counts` null with `reason_code` `not_permitted`, in the 03 section 8 shape (README ruling 1; amendment P8). With `grant:inspect` it returns counts for any principal on resources the delegator can administer | L3, Guarantee |
| AC-08-AUT-5 | `grant_check_uniform_absence` | For a hidden column and an absent column, the `grant.check` responses have identical keys and types, and identical values apart from echoed input (amendment P8) | L3, Guarantee |
| AC-08-AUT-6 | `approval_status_visible` | `change.status` returns the state of the change from the 03 section 7.1 state machine, with the approver where one exists (amendment P11) | L3, Guarantee |
| AC-08-AUT-7 | `authorize_on_every_surface` | Static and runtime. Every route and every MCP tool handler calls `authorize`, and a runtime probe over every route and tool with a denied principal observes a deny | L0 and L3, Guarantee |
| AC-08-AUT-8 | `grant_check_matches_enforcement` | For 1,000 sampled (principal, resource, action) triples, the `decision` and `predicate_text` from `grant.check` equal the decision the query path enforces | L2, Guarantee |

**Preview and commit (`AC-PRV`).**

| Id | Test | Asserts | Level |
|---|---|---|---|
| AC-PRV-1 | `preview_is_commit` | 500 random change sets. The committed `body_hash` equals the previewed result hash, and the committed ops equal the previewed diff | L2, Guarantee |
| AC-PRV-2 | `token_single_use_concurrent` | Two concurrent commits present one token. Exactly one succeeds. The other returns `PREVIEW_REQUIRED` | L3, Guarantee |
| AC-PRV-3 | `preview_stale` | After the head moves, a commit returns `PREVIEW_STALE` with the diff between previewed base and head | L3, Guarantee |
| AC-PRV-4 | `preview_required_for_agent` | A commit by an agent principal without a token returns `PREVIEW_REQUIRED`. A token for a different change, or for another principal, also returns `PREVIEW_REQUIRED`, and the response does not reveal which of the two held | L3, Guarantee |
| AC-PRV-5 | `commit_cancel_resolution` | Cancellation at random points. A cancel before the transaction starts leaves no change, and the token remains usable. A cancel after the transaction starts does not prevent completion. The idempotency lookup used by the driver gives the same outcome as the chain in every case | L3, Guarantee |
| AC-PRV-6 | `commit_rule_recorded` | Every agent commit row carries `policy_rule` (section 15.4), and the commit card in the UI shows the same id | L3 and L5, Guarantee |
| AC-PRV-7 | `untrusted_flag_on_echo` | A change whose ops or reason echo untrusted text is stored with `contains_untrusted = true` | L3, Guarantee |

**Realtime and presence (`AC-RT`).**

| Id | Test | Asserts | Level |
|---|---|---|---|
| AC-RT-1 | `rt_no_out_of_order` | Two transactions in one workspace, with the second's `seq` assigned first in a test harness. A reader never observes the higher `seq` before the lower one | L3, Guarantee |
| AC-RT-2 | `rt_drop_resume` | The socket is dropped for 5 s during 40 commits. The final DOM hash equals the server's canonical hash, and no `seq` is applied twice | L5, Guarantee |
| AC-RT-3 | `rt_gap_refetch` | A sequence gap on the client causes a refetch, and the client ends at the server state | L5, Guarantee |
| AC-RT-4 | `presence_throttle` | Presence updates per node are at most 5 per second | L3, Guarantee |
| AC-RT-5 | `rule_fires_once_per_firing` | Under a worker restart mid-firing, one page and one toast result per firing id | L3 and L5, Guarantee |
| AC-RT-6 | `commit_to_screen_p95` | Commit to client apply, p95 on one host over the rehearsal's commits (section 15.7) | L5, Target |

**MCP tool surface (`AC-MCP`).**

| Id | Test | Asserts | Level |
|---|---|---|---|
| AC-MCP-1 | `tool_catalogue_frozen` | `tools/list` returns exactly the 15 canonical names in the README order, and the manifest hash equals the hash recorded in the gate report | L3, Guarantee |
| AC-MCP-2 | `envelope_shape` | Every tool response has `ok`, exactly one of `data` or `error`, `next`, `warnings` and `budget`, `call_id` and `trace_id` (section 16.2; README ruling 10). `next` is present on every response and names at most three calls | L3, Guarantee |
| AC-MCP-3 | `error_codes_closed` | Property over malformed inputs. Every error `code` is in the closed set (section 15.3, error set below). Every error carries `code`, `path`, `retryable`, and the expected type or allowed values where they apply | L2, Guarantee |
| AC-MCP-4 | `fix_hints_from_schema` | Property. Seeded row values are used as sentinels. No `fix_hint`, `did_you_mean` or `available` value contains a sentinel | L2, Guarantee |
| AC-MCP-5 | `loop_suspected_after_three` | The fourth identical refused call returns `LOOP_SUSPECTED` and is not executed (README ruling 9) | L3, Guarantee |
| AC-MCP-6 | `list_budgets` | `node.search`, `source.list`, `change.history` and `query.run` respect default and maximum limits, and responses over budget carry `truncated: true` and a `next_cursor` | L3, Guarantee |
| AC-MCP-7 | `untrusted_wrapper_all_fields` | Every string originating in data, in every tool response, resource and prompt, sits inside `{"untrusted": "..."}` whatever its field name (amendment P14). Fuzzed over seeded annotations, titles, comments and rows | L2, Guarantee |
| AC-MCP-8 | `injection_annotation_inert` | The seeded injection annotation in the rehearsal's adversarial set does not cause a grant commit, an action run or a presentation to a principal outside the session | L5, Guarantee |
| AC-MCP-9 | `fault_console_not_in_tools` | The fault cue is absent from `tools/list`. The agent's grants contain no fault action. The presenter control API rejects the agent's token, and the agent's endpoint rejects the presenter credential (amendment P15) | L3, Guarantee |
| AC-MCP-10 | `both_transports_equal` | stdio and Streamable HTTP return identical tool lists, schemas, errors and call rows for a scripted sequence | L5, Guarantee |
| AC-MCP-11 | `rate_limit_units` | Costs follow section D.9 of the proposal. `RATE_LIMITED` carries `retry_after_s`. The trace ribbon shows units per call | L3, Guarantee |
| AC-MCP-12 | `cancel_between_batches` | `notifications/cancelled` for a query stops it between engine batches, and for a commit only before its transaction starts | L3, Guarantee |
| AC-MCP-13 | `presentation_scope` | `ui.present` to a principal that did not start the session is refused, and the refusal is audited | L3, Guarantee |

**Closed error set.** The error codes are the closed 15-code enum in `06-mcp-server.md` section 3, which README ruling 9 makes canonical. `IDEMPOTENT_REPLAY` is not an error. It is the `replayed: true` flag on a successful response (section 15.9, decision D-3). The closed set is `VALIDATION_FAILED`, `UNKNOWN_FIELD`, `UNKNOWN_REFERENCE`, `TYPE_MISMATCH`, `PREVIEW_REQUIRED`, `PREVIEW_STALE`, `CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `FORBIDDEN`, `RATE_LIMITED`, `QUERY_TIMEOUT`, `SOURCE_STALE`, `LOOP_SUSPECTED`, `RULE_REFUSED`, `UNAUTHENTICATED`.

**Driver (`AC-DRV`).** The driver tests are the ones amendment P10 requires, and they run on the stacked integration line against a reference workspace.

| Id | Test | Asserts | Level |
|---|---|---|---|
| AC-08-DRV-1 | `predicates_false_before_step` and `predicates_true_after_step` | For each step in `09-demo-operations.md`, its satisfaction predicate is false on the state before the step and true on the state after it. A predicate that is always true fails the test | L3, Guarantee |
| AC-08-DRV-2 | `driver_skips_satisfied` | Takeover after step 6 skips every step whose predicate already holds, and issues the rest in order | L5, Guarantee |
| AC-08-DRV-3 | `driver_never_inverts_other` | Reconciliation reverts only the live agent's own changes since the last checkpoint. A human change in that span stops the driver with the reset prompt | L5, Guarantee |
| AC-08-DRV-4 | `driver_create_by_slug` | A create whose node already exists by slug is treated as satisfied and produces no duplicate | L3, Guarantee |
| AC-08-DRV-5 | `driver_reset_required` | A predicate that cannot be satisfied from the current state causes "reset required", and nothing else is issued | L3, Guarantee |
| AC-08-DRV-6 | `replay_keys_and_skip` | Replayed commits use `replay:<transcript>:<step>`. A step whose expected change hash is already in the change log for that principal and session is marked done without a second commit | L3, Guarantee |
| AC-08-DRV-7 | `driver_switch_boundary` | A switch happens only at a step boundary. It is automatic on a second error in one step, on a query step over 12 s, or on a multi-call step over 20 s. F9 switches at once | L5, Guarantee |
| AC-08-DRV-8 | `driver_hard_cap` | The total script never exceeds 300 s of wall time, and when the slack pool is exhausted the driver takes the next step (amendment P19) | L5, Guarantee |
| AC-08-DRV-9 | `driver_surface_and_on_behalf` | Every replayed change has `surface = 'driver'`, `replay_of` set, actor `service:replay-driver` and `on_behalf_of` set to the recorded human. No replayed row uses the presenter's session (amendment P9) | L3, Guarantee |
| AC-08-DRV-10 | `replay_reproduces` | Ten runs locally and ten on AWS staging from the same image digests. For every run, every query step's result hash, every change hash, and the final `body_hash` of the Ops board, the finance board, the rule and the workflow instance match the transcript. Watermarks are recorded and not compared. Determinism uses `threads = 1` | L5 and L7, Guarantee |
| AC-08-DRV-11 | `cue_quantised_to_tick` | An F7 cue is applied at the next generator tick, the tick is recorded, and a replay that applies the same profile at the same tick produces the same events | L3 and L5, Guarantee |
| AC-08-DRV-12 | `cue_scripted_fallback` | With no cue within 5 s of its step start, the scripted cue is applied at the recorded tick | L5, Guarantee |
| AC-08-DRV-13 | `presenter_stall_indicator` | With no Rule change for more than 10 s after a cue, the console shows the virtual clock and a stall state | L5, Guarantee |

**Web surface (`AC-UI`).**

| Id | Test | Asserts | Level |
|---|---|---|---|
| AC-UI-1 | `phone_layout` | The incident card and the timeline render at phone width with a 16 px gutter and no horizontal scroll | L5, Guarantee |
| AC-UI-2 | `visual_channels` | Each of the six on-stage visual types (line with brushing, bar, heatmap, KPI tile with sparkline, table, lineage graph) maps its typed channels. Area, scatter, sankey and geo map are supported and tested but not on stage (amendment P1; README ruling 11) | L1 and L5, Guarantee |
| AC-UI-3 | `animation_requires_event_id` | Every animation start recorded in an end-to-end run carries a sequence number or a user gesture id. A build fails otherwise (amendment P2). A static lint at L0 flags any animation call without a sequence source | L0 and L5, Guarantee |
| AC-UI-4 | `no_timed_animation` | No CSS or JS animation runs on a timer with no event. Enforced by the same lint as AC-UI-3 | L0, Guarantee |
| AC-UI-5 | `materialise_chip` | A panel materialising on commit shows the change sequence in its corner chip | L5, Guarantee |
| AC-UI-6 | `four_windows_no_reload` | Across the rehearsal, each window loads the page exactly once. Panels appear through the realtime channel only | L5, Guarantee |

**Adapter contracts (`AC-ADP`).** Each contract runs against the local and AWS implementations of its interface. The Kafka-protocol suite is one example. Its assertions are the ones in the proposal, which are ordering per key and redelivery after a consumer crash.

| Id | Contract | Asserts | Level |
|---|---|---|---|
| AC-ADP-1 | `contract_control_store` | Same migrations apply. Row locks on `workspace_chain` and `nodes` serialise commits. Read-committed behaviour matches | L4, Guarantee |
| AC-ADP-2 | `contract_event_bus` | Ordering per key `(workspace_id, order_id)`. Redelivery after a consumer crash. Topic names and consumer group offsets | L4, Guarantee |
| AC-ADP-3 | `contract_blob_store` | Multipart upload, listing, bucket layout and lifecycle rules | L4, Guarantee |
| AC-ADP-4 | `contract_ephemeral` | Keys, TTLs and pub/sub channel names match. Killing Redis leaves commit results unchanged, because nothing in Redis is authoritative | L4, Guarantee |
| AC-ADP-5 | `contract_identity` | `sub`, `plinth/workspace` and `plinth/roles` are present after mapping. Expiry is handled. Claim differences are confined to the adapter | L4, Guarantee |
| AC-ADP-6 | `contract_secrets` | Lookup by name returns the same shape from both implementations | L4, Guarantee |
| AC-ADP-7 | `contract_telemetry` | Spans and metrics from both stacks reach their collector with the same names and attribute keys (section 16) | L4, Guarantee |

**Deployment (`AC-DEP`).**

| Id | Test | Asserts | Level |
|---|---|---|---|
| AC-08-DEP-1 | `image_digest_parity` | The five images (README) have identical digests on the local and AWS stacks. Each is signed and carries an SBOM | L7, Guarantee |
| AC-08-DEP-2 | `private_subnet_startup` | A task in a private subnet with no NAT route, with VPC endpoints only for S3 and Secrets Manager, runs its first query over S3 and its first Postgres attach successfully | L7, Guarantee |
| AC-08-DEP-3 | `make_up_readiness_order` | `make up` starts services in dependency order and waits on each readiness gate before starting dependents | L3, Guarantee |
| AC-08-DEP-4 | `reset_restores_snapshot` | `make demo-reset` restores the control store from the snapshot, points the workspace at the manifest, and leaves no live partitions from the previous run visible. Running it twice gives the same state | L3, Guarantee |
| AC-08-DEP-5 | `reset_time` | Reset wall time, measured in the rehearsal report | **Target** (20 s) |
| AC-08-DEP-6 | `schema_regeneration_clean` | JSON Schema and OpenAPI regenerate with an empty diff | L0, Guarantee |
| AC-08-DEP-7 | `no_stdio_on_aws` | The AWS task definition has no stdio entrypoint, and the MCP service is in private subnets behind the ALB | L7, Guarantee |

### 15.4 Commit-rule table and its tests

Amendment P6 requires a closed table. The table below restates the closed table in `03-authorization-and-security.md` section 6, which is the single source (README ruling 5). Each agent write is classified by one row. A change that matches no row, which is the unmatched row of 03 section 6, is refused. Human principals are not subject to this table. Each row has exactly one test, and each commit card shows the row id. The rule id is stored in the new column `changes.policy_rule` (section 15.9, decision D-8).

A change auto-commits after preview only if every op in it matches an auto row. If any op matches an approval row, the whole change is held as `pending_approval`, and the agent splits its work into changes that can be classified separately.

| Rule id | Matches | Class | Test id |
|---|---|---|---|
| R-PANEL-CREATE | Create a Panel on a Dashboard the agent may write | Auto-commit after preview | AC-CRT-1 |
| R-PANEL-EDIT | Replace a Panel's query, visual, options or layout on a writable Dashboard | Auto-commit after preview | AC-CRT-2 |
| R-DASH-CREATE | Create a Dashboard | Auto-commit after preview | AC-CRT-3 |
| R-PARAM-CREATE | Create a Parameter, or bind one to a Panel or Query | Auto-commit after preview | AC-CRT-4 |
| R-QUERY-CREATE | Create a Query or a Metric | Auto-commit after preview | AC-CRT-5 |
| R-RULE-CREATE | Create a Rule whose `on_fire` actions are Actions with effect `notify` to a receiver registered by an administrator, and `action:notify` is inside the ceiling | Auto-commit after preview | AC-CRT-6 |
| R-RULE-THRESHOLD | Change the threshold or hold of an existing Rule | Approval | AC-CRT-7 |
| R-ACTION-EXTERNAL | Create or change an Action with any external effect other than `notify` to a registered receiver | Approval | AC-CRT-8 |
| R-FORM-CREATE | Create a Form whose submit runs a declared Action | Auto-commit after preview | AC-CRT-9 |
| R-GRANT | Create, change or delete any Grant | Approval (an agent commit is held as `pending_approval`; the agent cannot approve) | AC-CRT-10 |
| R-DELETE | Soft-delete any node | Approval | AC-CRT-11 |
| R-UNDO-OWN | Undo a change whose actor is the agent principal, on the same `on_behalf_of`, within the ceiling | Auto-commit after preview | AC-CRT-12 |
| R-UNDO-OTHER | Undo a change by another principal | Refused (`FORBIDDEN`) unless the agent holds write on every path | AC-CRT-13 |
| R-ACTION-RUN | Run an Action directly | Refused (`FORBIDDEN`) | AC-CRT-14 |
| R-WORKFLOW-ACK | Run `workflow.acknowledge` | Refused (`FORBIDDEN` naming `workflow:acknowledge`) | AC-CRT-15 |
| R-PRINCIPAL | Change a principal, a ceiling, a delegation or a scope | Refused (not routable) | AC-CRT-16 |
| R-PRESENT | `ui.present` to a principal in the session | Auto (not a Change; audited as a present) | AC-CRT-17 |
| R-GRANT-UNDO | Undo an approved grant change, by a holder of `grant:write` on the resource | Auto-commit after preview, with no second approval; audited as `grant.widened` and notified | AC-CRT-18 |

| Id | Test | Asserts | Level |
|---|---|---|---|
| AC-CRT-1 to AC-CRT-18 | `commit_rule.<id>` | One test per row, named by the row id. Each asserts that a matching change gets that class, the stated outcome, and the `policy_rule` value on the row | L3, Guarantee |
| AC-CRT-19 | `commit_rule_closed` | A change with an op that matches no row is refused, and the table's row count equals the count of `commit_rule.*` tests | L0 and L3, Guarantee |
| AC-CRT-20 | `commit_rule_demo_beats` | Beats 2, 3, 4, 5, 6 and 9 produce the rule ids named in section 15.5 on their commit cards | L5, Guarantee |

**Two rules that need care.** `R-RULE-CREATE` and `R-ACTION-EXTERNAL` are the only rows where the external effect is decided by configuration. A receiver is "registered" when an administrator has created it as a node outside the agent's scope. The agent can reference a registered receiver and cannot create one. The demo's `ops-channel` is registered during reset (decision D-6).

### 15.5 Beat acceptance (Playwright rehearsal)

The rehearsal (`make rehearse`) drives four windows: Ops board, Exec view, Phone and presenter console, plus the agent or replay driver. Each beat in the README's table has an acceptance test. Assertions wait on the realtime sequence number that the page exposes as `data-rt-seq` on its root element. The rehearsal contains no fixed sleeps. A lint at L0 rejects any fixed wait in the rehearsal code (AC-08-REH-14).

| Id | Beat (time, s) | Asserts | Rule ids and capabilities |
|---|---|---|---|
| AC-08-REH-1 | 1 (0 to 25) | Three windows show one board. Presence badges show three humans. The KPI tile advances from the feed | Realtime, presence, sources |
| AC-08-REH-2 | 2 (25 to 55) | A bar panel appears on every window's grid. The Exec view shows EMEA rows only. The commit card shows `R-PANEL-CREATE` | R-PANEL-CREATE |
| AC-08-REH-3 | 3 (55 to 95) | The carrier heatmap and its control heatmap render with the red cell. The audit panel reads "0 changes in window". The watermark is printed on the heatmap. The `incident_window` parameter is bound and all three panels re-query | R-PARAM-CREATE, R-PANEL-CREATE |
| AC-08-REH-4 | 4 (95 to 125) | Clicking the red cell sets `region` and `carrier` with no change row. The rule appears in state `ok` with a backtest sparkline marking one firing. The commit card shows `R-RULE-CREATE` | R-RULE-CREATE, AC-08-KER-8 |
| AC-08-REH-5 | 5 (125 to 160) | The approval card shows before and after counts, computed server-side for the approver. The proposal is `pending_approval`. Priya's window approves it. The Exec view loses non-EMEA rows in place. The inspector shows two different `policy_hash` values. The approver is not the delegator | R-GRANT, AC-08-AUT-3, AC-PRV-6 |
| AC-08-REH-6 | 6 (160 to 190) | The title edit lands at r+1. The agent's two-path change is rejected with `CONFLICT` naming the title path. The width change lands. The conflict banner names both authors | R-PANEL-EDIT, AC-08-KER-5 |
| AC-08-REH-7 | 7 (190 to 205) | Undo on the grant row appends an inverse change. The Exec view regains its rows. The audit panel shows two linked rows | R-GRANT-UNDO, AC-08-KER-3 |
| AC-08-REH-8 | 8 (205 to 235) | After F7, the rule moves to `pending` then `firing`. One toast per screen. A workflow card appears in state `open`. The fault cue appears in no agent-visible list | AC-RT-5, AC-08-DRV-11, AC-MCP-9 |
| AC-08-REH-9 | 9 (235 to 258) | The Phone incident card gains a note field and an Acknowledge button. The timeline panel appears on the Ops board. The commit cards show `R-FORM-CREATE` and `R-PANEL-CREATE` | R-FORM-CREATE, R-PANEL-CREATE |
| AC-08-REH-10 | 10 (258 to 268) | Acknowledge on the Phone moves the workflow to `acknowledged`. The audit row reads `user:ops-lead` with surface `ui`. Every screen shows the new state within 2 s | **Target** (2 s, on stage, including the human tap) |
| AC-08-REH-11 | 11 (268 to 300) | The blast-radius panel shows the counts named in the script. Each count links to its query. The three screens show the same state | Lineage source (`lineage.edges`) and AC-08-QRY-6 |
| AC-08-REH-12 | Whole script | The total of the beat budgets in `09-demo-operations.md` does not exceed 300 s, and the driver stops at 300 s | AC-08-DRV-8 |
| AC-08-REH-13 | Whole script | Each window loads once (AC-UI-6). The trace ribbon shows the mode tag of each call (AC-TRC-5) | AC-UI-6, AC-TRC-5 |
| AC-08-REH-14 | Rehearsal code | No fixed wait exists in the rehearsal code. Waits are on `data-rt-seq` or on a named response | L0, Guarantee |

### 15.6 Agent gate and takeover-rate measurement

**The gate (`AC-GATE`).** The MCP tool surface is frozen only when a general model passes the gate. The gate is a fixed set of 13 questions. The prompt text is written into the repository before the first scored run. Its file hash is recorded in the rehearsal report. A general model is given only the MCP tool list, the resources and the question text. It has no description of Plinth internals.

| Question | Kind |
|---|---|
| Q1 | p95 by region as a bar panel |
| Q2 | Carrier-by-region heatmap |
| Q3 | KPI tile of late orders |
| Q4 | Table of open workflow instances |
| Q5 | Rule with a threshold and a notify action |
| Q6 | Drill-down panel bound to a parameter |
| Q7 | Form over workflow instances with a declared action |
| Q8 | "Who changed this dashboard in the last hour" as a panel |
| Q9 | Phone-width layout of an existing dashboard |
| Q10 | A parameter that filters two panels |
| C1 | Composition: an agent-owned rule whose action runs within the ceiling |
| C2 | Composition: a form, a source and a workflow transition timeline |
| C3 | Composition: a grant, a row predicate and a panel, checked with counts |

Each question runs 20 times. A run passes if the expected panel or node exists, its query result with `as_of` pinned equals the reference result by result hash, and the visual type matches.

| Id | Criterion | Guarantee or Target |
|---|---|---|
| AC-GATE-1 | The gate file, the question text and the expected results are committed, and their hash is recorded in the report before the first scored run. The report's timestamp is after the commit | Guarantee |
| AC-GATE-2 | The tool surface is frozen only if at least 11 of the 13 questions reach a pass rate of at least 0.75, and each of C1, C2 and C3 reaches at least 0.6 | Guarantee (the rule); the rates are measured |
| AC-GATE-3 | The question set is not reduced, reordered or reworded to meet the gate. A change to the set is a new gate registration, and its old results are kept | Guarantee |
| AC-GATE-4 | The report lists every question, its pass rate, every failing run in full, the error codes each run received, and whether the agent recovered. Failed runs are not omitted | Guarantee |
| AC-GATE-5 | A failing gate sends the descriptions, schemas or examples back for revision, and the 13 questions are run again on the revised surface | Guarantee (procedure) |
| AC-GATE-6 | The model identifier and version are recorded with each report. Pass rates are reported per model version | Guarantee |

**Takeover-rate measurement (`AC-GATE-7` to `AC-GATE-10`).** Amendment P18 requires a per-step takeover rate, measured over at least 10 model-in-the-loop runs. This section defines it.

- A **takeover** of a step is any run in which the driver issued at least one replayed call for that step. Triggers are the automatic triggers in AC-08-DRV-7 or F9.
- The **takeover rate** of a step is takeovers divided by runs of that step.
- The **pre-registered threshold** is **0.10** (decision D-5), written into the gate registration file before the first run, with its hash.
- A step whose rate is at or below the threshold may be run live on stage. Any other step is replay-by-default, and the ribbon shows "replay (default for this step)" on it.

| Id | Criterion | Guarantee or Target |
|---|---|---|
| AC-GATE-7 | Each script step has at least 10 model-in-the-loop runs in the rehearsal report, and each run records whether a takeover occurred and its reason. The rate it yields is a Target (AC-GATE-10) | Guarantee |
| AC-GATE-8 | The stage configuration marks each step live or replay-by-default, and the marking follows from the measured rates and the registered threshold | Guarantee |
| AC-GATE-9 | The ribbon tag on each call matches the stage configuration for that step (AC-TRC-5) | Guarantee |
| AC-GATE-10 | The report gives the rate per step with its run count, not a single figure for the whole script | Guarantee |

### 15.7 Performance targets and their measurement

Targets are measured on the seeded history and reported. They are not claims until the report exists (**Target**).

| Id | Quantity | Target | Measured by |
|---|---|---|---|
| AC-PERF-1 | Aggregate of 2.4 million order rows, grouped by region, with a percentile | p95 under 200 ms on a laptop-class machine | Rehearsal harness |
| AC-PERF-2 | Carrier-by-region heatmap over the same rows | p95 under 300 ms | Rehearsal harness |
| AC-PERF-3 | Commit to client apply, one host | p95 under 300 ms | `plinth_commit_to_screen_seconds` and client spans (section 16.3) |
| AC-PERF-4 | Commit transaction duration | Recorded, with no threshold claimed | `plinth_commit_duration_seconds` |
| AC-PERF-5 | Reset | 20 s | AC-08-DEP-5 |
| AC-PERF-6 | Acknowledge to all screens | Under 2 s, on stage | AC-08-REH-10 |

The report states the machine, the commit count, the history manifest hash and the seed. A target that is missed is reported with its measured value and its distribution. It is not removed from the report. (AC-PERF-7: the report exists when the stack is green, whatever its numbers.)

### 15.8 Stacked-run outputs

Each stacked run produces one report with: the stack's commit list; the L0 to L6 results; the seed, the history manifest hash and the gate file hash; the image digests; the performance table of section 15.7; the takeover table of section 15.6; the list of skipped tests with reasons (AC-TEST-4); and the failing runs of any stochastic suite. The report is the status record for the stack. Nothing else in the repository tracks status (Workgraph is the status record).

### 15.9 Decisions made in section 15

- **D-1. Tool count.** The README's count of 15 is used. The proposal's text says 14 in places. The fifteenth tool is `change.status`, from amendment P11.
- **D-2. Commit-to-screen.** Two numbers coexist with different scopes. The platform target is p95 under 300 ms (AC-PERF-3). The on-stage acknowledge bound is 2 s, including the human tap (AC-08-REH-10).
- **D-3. `IDEMPOTENT_REPLAY`.** It is a `replayed: true` flag on a success, not an error. The proposal lists it among errors.
- **D-4. Driver human steps.** Amendment P9 governs: the driver is `service:replay-driver` with `on_behalf_of` set to the recorded human. The proposal's C.3 wording about the presenter's session is superseded.
- **D-5. Takeover threshold.** Amendment P18 gives no number. 0.10 is proposed, with the minimum of 10 runs.
- **D-6. Registered receivers.** `ops-channel` is an administrator-created receiver node registered at reset. Notify to such a receiver is auto-class, so the proposal's beat 4 holds, and this matches the README example of approval for external actions only where the receiver is not registered.
- **D-7. Form authorship.** An agent may create a Form whose submit runs `workflow.acknowledge`, although its ceiling lacks that permission. The permission is checked against the submitting human at submit time, not against the author. Beat 9 depends on this.
- **D-8. Schema additions for section 15.** `changes.policy_rule text` and `changes.replay_of text` in the form `<transcript_id>:<step>`, which is included in the chain row hash and excluded from `change_hash` (README ruling 6; amendment P9). These are additions to the proposal's `changes` table and belong in `05-backend-persistence-realtime.md`.
- **D-9. Per-principal counts in beat 5.** Beat 5 needs before and after counts for `emea-lead`, which is not the delegator. Resolved by README ruling 1: the permission is `grant:inspect`, which the agent ceiling holds, and it lets `grant.check` return counts for another principal. It never grants `grant:write` or `approval:decide`. Amendment P8 is satisfied by `grant:inspect` in place of `grant:admin`, so the ceiling in `03-authorization-and-security.md` gains no `grant:admin`.

---

## 16. Observability and operational diagnostics

### 16.1 Principles

- **One identifier per request.** The `trace_id` of a request appears in its spans, its logs, its MCP envelope and its `call_log` row. A reader can follow one commit from the browser to the client that applied it.
- **Closed label sets.** Metric labels come only from closed sets (surface, outcome, error code, rule id, step id, source id). Principal ids, workspace ids and row values are never metric labels. They appear in traces and logs. This bounds cardinality (AC-OBS-3).
- **No secrets, no raw untrusted text.** Tokens, preview token values and credentials never appear in spans, logs or metrics. A preview token is recorded as the first 8 hex characters of its hash. Untrusted text is escaped and truncated before it is logged (AC-OBS-4, AC-OBS-5).
- **Observability is not history.** Traces, metrics, logs and `call_log` are non-authoritative. The audit chain is the only record of writes. Losing a span, a log line or a `call_log` row does not change any state.
- **Infrastructure telemetry leaves the platform.** OpenTelemetry is the only instrumentation. The collector forwards to a local Grafana in the local stack, and to CloudWatch and X-Ray on AWS (proposal section E.2). Plinth's own dashboards are built from Plinth's sources where the data is a source (section 16.6).

### 16.2 Trace propagation and spans

**Propagation points.** W3C `traceparent` is carried across each hop below. Where a hop is asynchronous, the trace context is stored in the message, and the consumer starts a linked span.

| From | To | Carrier |
|---|---|---|
| Browser | `plinth-api` | HTTP header `traceparent` |
| External agent | `plinth-mcp` | MCP request `_meta.traceparent` |
| `plinth-api` or `plinth-mcp` | Commit transaction | Same process, same context |
| Commit transaction | Outbox relay | `traceparent` column stored with the outbox payload (`payload.traceparent`) |
| Outbox relay | Redis fan-out | Message field `traceparent` |
| Gateway `plinth-rt` | Browser | Subscription message field `traceparent` on each change batch |
| Browser | Collector | OTLP over HTTP, with the same trace id |

**Span tree for one UI commit (AC-OBS-1).**

```
ui.action                       (browser; attrs: gesture, surface=ui, principal kind)
└─ http.request                  (plinth-api; attrs: route, status)
   └─ authz.authorize            (attrs: action, decision; no policy values)
   └─ commit.tx                  (attrs: workspace, change_seq, outcome, lock_wait_ms)
      ├─ commit.lock_wait        (workspace_chain FOR UPDATE)
      └─ outbox.write            (in the same transaction)
outbox.relay                     (linked to commit.tx; attrs: outbox_seq, lag_ms)
└─ rt.fanout                     (plinth-rt; attrs: subscribers, batch size)
client.apply                     (browser; attrs: change_seq, lag_ms)
```

**Span tree for one agent commit (AC-OBS-2).** `mcp.request` contains `mcp.tool.node.preview` or `mcp.tool.node.commit`, with `authz.authorize`, `query.compile`, `query.execute` and `commit.tx` as children. The envelope's `trace_id` equals the root span's trace id.

**Other spans.**

| Span | Process | Attributes (closed or ids only) |
|---|---|---|
| `query.compile` | api, mcp | `source`, `query_hash`, `cache` |
| `query.wait_watermark` | engine | `source`, `as_of`, `watermark`, `waited_ms` |
| `query.execute` | engine | `source`, `rows`, `duration_ms`, `cache_hit`, `policy_hash_prefix` |
| `preview.create` | api, mcp | `change_hash_prefix`, `token_expires_s` |
| `rule.evaluate` | worker | `rule_id`, `firing_id`, `state`, `lag_ms` |
| `workflow.transition` | worker | `instance_id`, `from`, `to` |
| `generator.tick` | gen | `tick`, `cue_applied`, `profiles` |
| `driver.step` | driver | `step`, `mode` (live or replay), `takeover_reason`, `calls` |

### 16.3 Metrics

All names are prefixed `plinth_`. Histograms use the bucket sets defined in the telemetry configuration. Labels are from closed sets only.

| Metric | Type | Labels | Measures | Guarantee or Target |
|---|---|---|---|---|
| `plinth_commit_duration_seconds` | histogram | `surface`, `outcome` | Commit handler start to transaction end | Recorded (AC-PERF-4) |
| `plinth_commit_lock_wait_seconds` | histogram | none | Wait on `workspace_chain` | Recorded |
| `plinth_commit_to_screen_seconds` | histogram | `surface` | Commit response to client apply, from client spans | Target (AC-PERF-3) |
| `plinth_query_duration_seconds` | histogram | `source`, `cache_hit`, `surface` | Engine execution | Target (AC-PERF-1, AC-PERF-2) |
| `plinth_query_wait_watermark_seconds` | histogram | `source` | Time waited for `as_of` | Recorded |
| `plinth_watermark_lag_seconds` | gauge | `source` | Virtual now minus minimum published watermark | Alarm at the configured value (section 16.8) |
| `plinth_rule_eval_lag_seconds` | histogram | `rule_id` | Scheduled evaluation instant to completion | Recorded; alarm on sustained growth |
| `plinth_driver_takeover_total` | counter | `step`, `reason` | Takeovers (AC-GATE-7) | Guarantee (counted) |
| `plinth_outbox_relay_lag_seconds` | gauge | none | Now minus oldest unrelayed outbox row | Recorded |
| `plinth_chain_verify_ok` | gauge | none | 1 when the last verification passed, 0 otherwise | Guarantee (set by the verifier) |
| `plinth_mcp_errors_total` | counter | `code` (closed set, section 15.3) | Errors by code | Guarantee (counted) |
| `plinth_preview_tokens_total` | counter | `outcome` (issued, consumed, spent, expired) | Token lifecycle | Guarantee (counted) |
| `plinth_idempotent_replays_total` | counter | `surface` | Replayed responses | Guarantee (counted) |
| `plinth_ratelimit_units_total` | counter | `principal_kind`, `tool` | Units charged | Guarantee (counted) |
| `plinth_cache_requests_total` | counter | `result` (hit, miss) | Result cache | Guarantee (counted) |
| `plinth_presence_updates_total` | counter | `outcome` (sent, throttled) | Presence fan-out | Guarantee (counted) |

### 16.4 Logs

Logs are one JSON object per line, written to stdout, collected by the collector.

**Required fields.** `ts`, `level`, `service`, `event`, `trace_id`, `span_id`, `surface`, `principal_id` (an id, never a name), `workspace_id`, and `code` where an error applies.

**Rules.**
- Log lines carry an event name from a closed list, not free text. Free text is limited to the error `message` field, which is built from schema facts (AC-MCP-4).
- Strings from data are escaped, control characters are removed and the value is truncated to 512 bytes before logging (AC-OBS-5).
- Tokens, credentials, preview token values and presenter credentials are never logged (AC-OBS-4). A scan of the rehearsal's logs for token patterns runs at L5.
- Audit rows are not duplicated into logs. The log says that a commit happened, with its `change_seq`. The change itself is read from the chain.

### 16.5 The trace ribbon: data source and contract

The trace ribbon is the strip on every screen that shows each MCP and API call (amendment P4). It is the audience's evidence that the calls are real. It has a single data source, which is a table, and a single transport.

**Data source: `call_log` (Postgres).** The table is written by `plinth-api` and `plinth-mcp` for every call, including reads, refusals, held changes and cancelled calls.

| Column | Type | Notes |
|---|---|---|
| `call_seq` | bigserial primary key | Ordering of the ribbon |
| `workspace_id` | uuid | |
| `principal_id` | uuid | |
| `on_behalf_of` | uuid, nullable | |
| `surface` | text | `ui`, `api`, `mcp`, `driver`, `cli` |
| `session_id` | text | |
| `mode` | text | `live` or `replay` for agent calls, `ui` for human gestures, `system` for worker effects. `replay` for every call by `service:replay-driver` |
| `tool` | text | Tool name, or the HTTP route name |
| `args_summary` | text, at most 120 characters | Built only from schema-typed fields (ids, field names, enum values, counts). Never raw strings from data |
| `status` | text | `ok`, `error`, `refused`, `held`, `cancelled` |
| `error_code` | text, nullable | From the closed set |
| `change_seq` | bigint, nullable | Set on commits and undo |
| `units_charged` | int | Rate-limit cost |
| `trace_id` | text | |
| `started_at` | timestamptz | |
| `duration_ms` | int | |

`call_log` is **not** an entry in the README's metadata source list, so it cannot be queried by `query.run` (section 16.9, decision D-10). It is a Postgres table read by the trace channel and by the exporter.

**Transport.** Each insert is followed by a publish to the Redis channel `trace:<workspace_id>`. A subscribed client receives the row. On reconnect, the client asks for `call_log` rows since its last `call_seq`. The ribbon therefore recovers the same way the realtime channel does.

**Session state.** Parameters, brushing and drill state (amendment P3) appear in the ribbon in a distinct style. They come from client events and are not stored. They create no `call_log` row, no change and no audit row (AC-08-KER-8).

**Mode tag.** The ribbon tags each row from `mode`: `live` or `replay` for agent calls, `ui` for human gestures and `system` for worker effects (README ruling 12). Under a replay step, it also shows "replay (default for this step)" where section 15.6 requires it.

| Id | Criterion | Guarantee or Target |
|---|---|---|
| AC-TRC-1 | Every call made in a session appears in the ribbon, including reads, refusals and holds. The ribbon's row count for a session equals the `call_log` row count for that session | Guarantee |
| AC-TRC-2 | A call's ribbon row is visible within the realtime target after the call returns (section 15.7 measures it) | Target |
| AC-TRC-3 | `args_summary` never contains a string from data. A fuzzed test with sentinel strings in every data field finds none in any `args_summary` | Guarantee |
| AC-TRC-4 | Session-state entries create no `call_log`, change or audit row | Guarantee |
| AC-TRC-5 | `mode` is `replay` for every call by `service:replay-driver`, and `live` for every other agent call. Human gestures are tagged `ui` and worker effects `system` (README ruling 12) | Guarantee |
| AC-TRC-6 | After a client reconnects, the ribbon reaches the same rows as an uninterrupted client, with no duplicate `call_seq` | Guarantee |

### 16.6 Dashboards

**Plinth-native dashboard: `plinth-ops`.** It is a Dashboard node in the demo workspace, in a separate workspace `plinth-internal` that the operations lead can read. It is built from Plinth's own sources, so it exercises the same query path as every other dashboard. It has these panels.

| Panel | Source | Query shape |
|---|---|---|
| Query p95 by source | `query.runs` | Percentile of `duration_ms` grouped by the source named in `plan` |
| Changes by surface, last hour | `audit.changes` | Count grouped by `surface` and minute |
| Rule firings | `rule.firings` | Timeline of `firing_id` with rule and state |
| Workflow transitions | `workflow.transitions` | Count by target state |
| Approvals held and decided | `audit.changes` | Count by status of the held change |

Two notes. The dashboard's own queries are recorded in `query.runs`, so the panels filter out rows whose `surface` is `system`. The dashboard's queries are issued with `surface = 'system'`.

**External dashboards.** Infrastructure metrics have no source in the README's metadata list, so they are not built in Plinth. They are built in Grafana (provisioned from `ops/grafana/` in the repository) locally, and in CloudWatch on AWS (defined in the CDK stack). Their panels are: commit duration and lock wait, commit-to-screen, watermark lag by source, rule evaluation lag, outbox relay lag, takeover counts, chain verification gauge, error counts by code, and rate-limit units.

| Id | Criterion | Guarantee or Target |
|---|---|---|
| AC-OBS-6 | Every panel in `plinth-ops` resolves and returns rows from its source in the seeded workspace after the rehearsal | Guarantee |
| AC-OBS-7 | The Grafana and CloudWatch dashboards are generated from the repository files and their panel queries reference only metric names in section 16.3 | Guarantee |

### 16.7 Health and readiness

| Endpoint | Meaning | Checks |
|---|---|---|
| `/healthz` | Process is alive | None beyond the event loop |
| `/readyz` | Ready to serve | PostgreSQL connection and migration version; DuckDB extensions loaded from the image (no network); object store listing; Identity metadata reachable |
| `/readyz` (degraded) | Serving, with a reduced feature | Redis ping. A failing Redis marks `degraded` and does not fail readiness, because commits do not depend on Redis |
| Generator readiness | `plinth-gen` is ready when its tick advances within the configured interval | Tick counter and last tick time |

| Id | Criterion | Guarantee or Target |
|---|---|---|
| AC-OBS-8 | `/readyz` returns not-ready when PostgreSQL is down, and returns `degraded` with HTTP success when only Redis is down | Guarantee |
| AC-OBS-9 | `make up` does not report success until every readiness gate in AC-08-DEP-3 has passed | Guarantee |
| AC-OBS-10 | A readiness failure names the failing check in its response body | Guarantee |

### 16.8 Alarms and their thresholds

Alarms are configured values (**Budget**). They are evaluated on the stack and shown in the presenter console's status line and in `plinth-ops`.

| Config key | Default | Trigger |
|---|---|---|
| `observability.watermark_lag_alarm_s` | 10 | `plinth_watermark_lag_seconds` above the value for a source |
| `observability.outbox_lag_alarm_s` | 2 | `plinth_outbox_relay_lag_seconds` above the value |
| `observability.chain_verify_interval_s` | 300 | Interval of the background chain verification |
| `observability.stall_indicator_s` | 10 | No Rule change after a cue (AC-08-DRV-13) |
| `agent.takeover_threshold` | 0.10 | Decision D-5 |
| `telemetry.otlp_endpoint` | per deployment | Collector address (07 owns the value) |
| `telemetry.sample_ratio` | 1.0 | Head sampling for the demo. Lower values are not used on stage |

**Guarantee (AC-OBS-11).** An alarm that fires is recorded as a `call_log`-style event in `plinth-ops` and as a log line with `event = alarm`. A test forces each alarm and asserts both records.

### 16.9 Decisions made in section 16

- **D-10. `call_log` is not a source.** The README's metadata list is unchanged. The ribbon reads `call_log` through the trace channel. If the integrator wants `call_log` to be queryable, that is a README-level change, and it must come with the same authorization rules as `query.runs`.
- **D-11. Envelope gains `trace_id`.** Amendment P5 defines the envelope without it. The field is added as a top-level sibling of `budget`. It is additive, so existing amendment behaviour is unchanged. README ruling 10 fixes the envelope: it carries both `call_id` and `trace_id`, and `trace_id` equals the root span id. The change belongs in `06-mcp-server.md`.
- **D-12. Infrastructure dashboards are external.** Plinth's dashboards cover only the data that is a Plinth source. Commit lock wait, outbox lag and similar metrics are external. This keeps the in-platform dashboard honest about what a source is.
- **D-13. Commit-to-screen measurement.** The client span's timestamp is compared with the server's `commit.tx` end. On one host the clocks are the same. On AWS staging the measurement uses the driver's browser and the same host clock source, and the report states the clock source.

### 16.10 Diagnostic runbooks

Each runbook has a symptom, a first look, checks and a recovery. Each first look names a panel or a metric in section 16.3, so a reader can start from the dashboard and not from the code (AC-OBS-12).

**RB-1. Commit is slow or stuck.**
- Symptom: the Acknowledge or a panel commit does not return.
- First look: `plinth_commit_lock_wait_seconds` and `plinth_commit_duration_seconds` by `surface`.
- Checks: the trace for the commit's `commit.tx`; its `lock_wait_ms`; whether one long transaction holds `workspace_chain`.
- Recovery: a transaction that holds the lock beyond its budget is cancelled by the database. The commit returns `CONFLICT` or fails, and the client retries under its idempotency key. Under demo load the lock is not expected to be contended (G.1 of the proposal). If it is, the stage moves to replay.

**RB-2. Screens are stale after a commit.**
- Symptom: the commit is in the chain, and a screen does not show it.
- First look: `plinth_outbox_relay_lag_seconds`, `plinth_presence_updates_total{outcome="throttled"}`, and the ribbon for the affected client.
- Checks: the outbox row for the commit's `seq` and whether `relayed_at` is set; Redis ping; the client's last `seq` and whether a gap was detected (AC-RT-3).
- Recovery: the client resumes by revision. If the outbox relay is behind, the relay is restarted. Its messages are re-sent from the outbox, and no commit is repeated.

**RB-3. Watermark stalled.**
- Symptom: a panel shows "as of" time that stops, or `SOURCE_STALE` appears.
- First look: `plinth_watermark_lag_seconds` by source; the generator readiness.
- Checks: `plinth-gen` tick counter; `plinth-ingest` consumer lag; `source_partitions` for the newest `published = true` row.
- Recovery: restart the generator from its last recorded tick. The demo continues from the landing store. The stall is shown on the screen, not hidden.

**RB-4. The fault did not move the rule.**
- Symptom: F7 was pressed and the rule stayed `ok` for more than 10 s.
- First look: the console's stall indicator; `generator.tick` spans with `cue_applied`; `plinth_rule_eval_lag_seconds{rule_id}`.
- Checks: the cue's acknowledgement on the console; whether the cue was applied at a recorded tick; whether `rule.evaluate` spans run after that tick.
- Recovery: after 5 s of silence the scripted cue is applied at its recorded tick (AC-08-DRV-12). If the evaluator is behind, the presenter says the feed is catching up, or the driver switches to replay.

**RB-5. Audit chain fails verification.**
- Symptom: `plinth_chain_verify_ok` is 0, or `GET /audit/verify` names a `seq`.
- First look: the status page's chain row.
- Checks: the first broken `seq` and its neighbours; whether any row was written outside the commit path (the chain check on `changes` is the test of this).
- Recovery: stop the demo. Do not repair rows in place. Keep the database for analysis, and rebuild the workspace with `make demo-reset`. A verification failure is a finding to be recorded, not a condition to hide.

**RB-6. The agent repeats errors.**
- Symptom: the same call is refused repeatedly, and the trace ribbon shows the same error.
- First look: `plinth_mcp_errors_total{code}`; the ribbon's error rows.
- Checks: `LOOP_SUSPECTED` on the fourth identical refusal (AC-MCP-5). The `next` field of the last envelope. Whether the refused call is one the agent's ceiling forbids.
- Recovery: the agent reads `schema.describe` as its `next` suggests. After two failures on one step, the driver takes the step over (AC-08-DRV-7).

**RB-7. The driver took over unexpectedly, or a replay does not match.**
- Symptom: a step is shown as `replay`, or the replay report shows a hash mismatch.
- First look: `plinth_driver_takeover_total{step,reason}`; the `driver.step` span.
- Checks: the reason; for a mismatch, the first step whose query result hash or change hash differs, and the `as_of` and tick recorded for it. Confirm `threads = 1` in the replay process.
- Recovery: resume from the last step boundary whose change hashes are present in the chain. Reset is the fallback when the state is unknown.

**RB-8. Startup fails in the private subnet.**
- Symptom: a task does not become ready on AWS.
- First look: the readiness response, which names the failing check (AC-OBS-10).
- Checks: whether a DuckDB extension load was attempted from the network (it must not be; extensions come from the image). Whether the VPC endpoints for S3 and Secrets Manager are present. Whether Identity claims match the contract suite (AC-ADP-5).
- Recovery: correct the endpoint or the claim mapping in the adapter. The change is not made in the engine.

**RB-9. Presence badges disappear.**
- Symptom: avatars and cursors vanish, while panels still update.
- First look: Redis readiness (`degraded`); `plinth_presence_updates_total`.
- Checks: the Redis container; the pub/sub channel names against the contract (AC-ADP-4).
- Recovery: restart Redis. Presence is rebuilt from new updates. Nothing authoritative depends on Redis.

**RB-10. Demo state is unknown.**
- Symptom: the screens show data the script does not expect.
- First look: the presenter console's virtual clock and step list; `plinth-ops` change counts for the demo workspace since reset.
- Recovery: `make demo-reset` (AC-08-DEP-4), then `make demo-replay STEP=n` to the step the presenter is on. The driver verifies earlier change hashes before it continues (AC-08-DRV-6).

**RB-11. A browser freezes.**
- Symptom: a window stops updating and shows "reconnecting" or nothing.
- First look: the window's client span for `client.apply`; the subscription's last `seq`.
- Checks: whether the socket dropped; whether the client asked for missed changes since its revision.
- Recovery: automatic by resume (AC-RT-2). If the window stays stuck, the presenter reloads that one window. The ribbon shows the resume, so the audience sees the recovery.

| Id | Criterion | Guarantee or Target |
|---|---|---|
| AC-RUN-1 | Each runbook's first-look metric or panel exists in section 16.3 or in `plinth-ops` | Guarantee (checked at L0 by name) |
| AC-RUN-2 | Each runbook's checks are reproducible on the stack by a scripted fault, where the runbook names one. RB-1, RB-2, RB-3, RB-5, RB-6 and RB-11 are each exercised once in the rehearsal's failure set | Guarantee for the set; Target for the timing |
| AC-RUN-3 | Each runbook's recovery step is an existing command, or a named API call, and does not require a code change | Guarantee |

### 16.11 Alarm and runbook tests

| Id | Test | Asserts | Level |
|---|---|---|---|
| AC-OBS-1 | `trace_ui_commit` | One UI commit produces spans with one trace id across the browser, api, commit, outbox, rt and client, per the tree in section 16.2 | L5, Guarantee |
| AC-OBS-2 | `trace_mcp_commit` | One agent commit produces the MCP tree, and the envelope `trace_id` equals the root span's id | L3 and L5, Guarantee |
| AC-OBS-3 | `metric_cardinality` | Every metric in section 16.3 is emitted with labels from its closed set. A run with 50 principals and 20 workspaces produces the same series count as one with one principal | L3, Guarantee |
| AC-OBS-4 | `logs_no_secrets` | A scan of the rehearsal logs for token patterns, preview token values and credentials finds none | L5, Guarantee |
| AC-OBS-5 | `logs_untrusted_escaped` | Fuzzed data with control characters and 10 KB strings produces log lines with escaped controls and at most 512 bytes of data | L3, Guarantee |
| AC-OBS-11 | `alarms_fire_and_record` | Each alarm in section 16.8 is forced in a test and produces a record in `plinth-ops` and a log line | L3, Guarantee |
| AC-OBS-12 | `runbook_first_look_exists` | Each runbook names a metric or panel that AC-RUN-1 resolves | L0, Guarantee |

---

## 16.12 What this file does not cover

Ports, service names, the configuration file layout and the deployment manifests are owned by `07-deployment.md`. The seed, the history manifest, the script's step budgets and the transcript format are owned by `09-demo-operations.md`. The table definitions in sections 16.5 and 15.9 belong to `05-backend-persistence-realtime.md` and `06-mcp-server.md`, which must add them before this file's tests can be implemented.
