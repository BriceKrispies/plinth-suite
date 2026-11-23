# Round 1 review: Reviewer A (Principal Systems Engineer)

Scope: the mission brief (`00-mission.md`) and all six proposals, read in full: 01 Fathom, 02 Tessera (Visual Spectacle), 03 Parapet, 04 Tessera (Emergent Composition), 05 Lodestar, 06 Tessera (Harbour, Agent-Native). Design review only. Nothing was built or run. Proposals 02, 04 and 06 all use the product name "Tessera", so this review refers to them by proposal number.

Scoring: integers 0 to 10 per criterion, using the mission weights (depth 20, composability 20, agent 15, visual 15, credibility 10, narrative 10, feasibility 5, reliability 5). The weighted total is the weighted mean on a 0 to 10 scale. Reliability and feasibility are scored down where a sophisticated feature is not demonstrable as written.

Notation: "W1", "W2" and so on in a proposal's score justifications and in the comparative section refer to that proposal's numbered weaknesses. "X1" to "X9" refer to the cross-cutting findings. Section letters and numbers (for example "C.3", "D.8") refer to the proposal being discussed. Scenario times such as "120 to 165 s" are the proposal's own script times.

Disqualification: none of the six is disqualified. Each has an element that came close, and those are named in the per-proposal sections. None embeds an LLM. None requires the live agent for the stage path (each has a fallback). None has fundamentally incompatible local and cloud deployments. Proposal 05 is flagged for its replayed-telemetry mode, which must be disclosed on screen (see 05, required change 6).

| Rank | Proposal | Weighted total | Verdict in one line |
|---|---|---|---|
| 1 | 02 Tessera (Visual Spectacle) | 7.8 | Best spectacle and the clearest sequence-driven visual discipline; its fallback guard contradicts its own trigger and its parameters are stored as revisions. |
| 2 | 03 Parapet | 7.4 | Strongest enterprise posture: one command layer, Cedar explanations from the same evaluation, denial audit, and the best fallback preconditions; discovery and commit-mode invariants need fixing. |
| 3 | 01 Fathom | 7.2 | Deepest and most composable design, but its consistency model contradicts itself on `live`, its cache key omits the principal, and its central live beats are timing-sensitive. |
| 4 | 05 Lodestar | 6.9 | Most honest about real faults and the most natural operations story; a paused process cannot produce the metric it alerts on, and takeover can revert human edits. |
| 5 | 04 Tessera (Emergent Composition) | 6.85 | Strongest composition thesis, but the thesis is gated last and tested least; the cache key omits the mask set and the fallback's hash checks cannot pass on a live feed. |
| 6 | 06 Tessera (Harbour, Agent-Native) | 6.7 | Clean single commit path and the best error envelope; the takeover's idempotency premise and the auto-commit policy are both unsound as written. |

The scores are close. The ranking reflects weighting, not a wide gap in quality. Several defects are shared, so the cross-cutting section below matters more than any single ranking.

---

## Cross-cutting findings

These apply to more than one proposal. Each is a claim the persistence model, the transport or the fallback cannot uphold as written.

**X1. Interaction state is modelled as audited revisions.** 01 (B.1, P20) says a cross-filter selection "is also an operation, an audit entry". 02 (D.8) names `tessera.param.set` as "the same write humans make through brushing", and V03 says a drill "creates a parameterised view as a revision". 06 does not say where parameter state lives. Consequences: every click writes history, two windows brushing differently raise base-revision conflicts on the parameter path, and the audit log fills with navigation. 03 handles this correctly: parameters are URL and session state bound into the query, and only documents are revisions. The other proposals should adopt that split.

**X2. Hash-chain serialisation is stated inconsistently or not at all.** 05 (D.2) takes `pg_advisory_xact_lock` per workspace, which is the only explicit primitive. 02 (G.1) names the single hot row and offers a mitigation that is already its own design. 06 (G.1) names "a single sequence per workspace", but a Postgres sequence value is assigned outside commit order, so the chain can be written out of order unless the chain head is locked. 04 (E.2) says "row locks on `nodes`" while D.2 hash-chains the log per workspace; two commits to different nodes read the same head and fork the chain. 01 (D.7) and 03 (D.7) say the chain is written "in the same transaction" with no serialisation primitive. Each proposal must state that the chain head is locked in the commit transaction and that `prev_hash` is computed in commit order. Without that, every "audit verifies" claim is conditional.

**X3. Idempotency keys are scoped inconsistently.** 01, 03 and 05 scope keys to the principal. 04 (D.2, D.6) uses a unique index on `(workspace_id, idempotency_key)`. 06 (D.2) declares `changesets.idempotency_key text UNIQUE` with no principal, and its `propose` is "idempotent by content", which does not say whether a second principal with identical ops receives the first principal's proposal. A cross-principal key collision either returns another principal's result or is rejected in a way that reveals the other principal's activity. Key scope must be `(principal, key)` everywhere.

**X4. Cache and derived-result keys omit authorisation inputs.** 01 (D.4, "Consistency") says every live result is a function of `(watermark, binding_hash, rev_id)`. The principal is not in the key, yet RLS is applied at rewrite time, so a finance viewer and the Ops wall with the same binding would share a result. 04 (D.4) keys the result cache on `(query_hash, principal_row_predicate_hash, parameter_values, watermarks)` and omits the column-mask set, so a masked and an unmasked principal with the same row predicate share rows. 02 (D.3) gets this right: its key includes the principal's effective predicate hash. Rule for all: any cache or incrementally maintained result is keyed by the principal's effective row predicate and mask set, or it is not shared.

**X5. Fallback premises that do not hold on a live system.** Each proposal has a fallback, and several rely on properties a live run does not provide.
- 02: the driver refuses to run when the workspace hash differs from the transcript checkpoint, but it is triggered by a divergent live state ("off-script" or "different hash"). It can only recover from a stalled agent, not from one that produced a different valid state, which is the failure G calls most likely.
- 04: the driver stops on any `query.run` hash mismatch, and the live feed advances the watermark. C.2 (0 to 30 s) streams live events while C.1 says the generator is parked; the first query step will diverge on every run unless the virtual clock is frozen per step and the hash is stated relative to it.
- 05: takeover calls `revert_to(checkpoint_seq)`, which replays inverse patches for all changes after `seq` in the workspace branch (D.7). That includes Cass's live layout and title edits in the 110 to 200 s window.
- 06: takeover skips satisfied steps by digest and executes the next step "with its recorded idempotency key". The live agent generated its own keys, so the recorded key is never seen by the platform, and digests over object IDs the live agent chose will not match.
- 01: the concurrency beat at 210 to 255 depends on the relative timing of a human keystroke and an agent commit. A tape records a sequence, not an interleaving, and no checkpoint exists inside that row.

**X6. "Distributed" features that are one database.** 01 presents two `fathomd` replicas, per-replica op logs and CRDT convergence as distributed behaviour, and the claim-5 test kills a replica. Authoritative order is a single Postgres; the test proves stateless failover, not replication convergence. 05 states the honest version: "a two-instance deployment needs no shared memory beyond Postgres". Every proposal should name its single source of order and say what the replica tests actually prove.

**X7. MCP catalogue hygiene.** The brief makes the tool descriptions a primary design concern, so inconsistencies here count against the agent score.
- 02 names the screen tool `dashboard.present` (B, M05) and `tessera.screen.present` (D.8), and uses two preview mechanisms (`dry_run` on some tools, `preview_token` on `commit`).
- 03's B.5 says "Commit requires the plan ID and an idempotency key", but the D.8 signatures for `query.save`, `metric.define`, `alert.create`, `workflow.create`, `form.create`, `share.grant`, `schedule.report`, `annotate` and `change.undo` take `mode: "commit"` with no `plan_id` and no idempotency key.
- 01 (D.8, principle 2) says every mutating tool has a preview variant, yet `spec.revert` and `branch.create` have none.
- 06 (C.2, 70 to 100 s and G.3) relies on an auto-commit rule for "additive, reversible changes", which D.5 never defines, and the alert binding is classed as approval by the same mechanism without a rule.

**X8. Discovery and existence leaks.** 03's D.8 says fields the principal cannot use "do not appear", but its `source.describe` signature returns columns with `visible: "hidden"`, and the 255 to 285 beat calls `source.describe` on `hr.compensation` before the query is denied. 01's `ui.focus`, `catalog.search`, `lineage.of` and `audit.search` have no stated read filter. 04's `source.sample` returns raw rows, which conflicts with its own claim that the query compiler is "the only way data is read". 06's `presence.list` has no stated read filter.

**X9. Fault realism under the designed clock.** 05's paused container cannot be scraped, so the alert it is meant to fire cannot see the fault as described. 04 shows a 14:05 episode in its backtest but never describes what generates it in the data. 03's lock contention is real Postgres behaviour, but the lock is injected by a scripted maintenance job, so the "root cause" is designed to be found; engineers will discount it unless the injection goes through a real code path. 02 and 04 both depend on the virtual clock matching wall time in ways their documents do not fix.

---

## 01 Fathom (Systems Complexity)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 20% | 8 | Typed IR with unit algebra, a move-capable tree CRDT, Cedar, histogram IVM and a differential RLS test are all real and named (D.2, D.4, D.6, F). Deduction because the CRDT's convergence is not what the stage exercises and the D.4 cache key is unsafe (W2). |
| Composability and breadth | 20% | 9 | One operation registry generating UI, HTTP, CLI and MCP, and a composition map where every panel, alert, export and permission is one IR reference (B.2). The strongest composition argument in the set. |
| Agent / MCP integration | 15% | 8 | Plan with `base_seq`, `stale_base` returning a merge preview, structured errors with `did_you_mean`, and scope intersection evaluated per request (D.6, D.8). Deducted for `ui.focus` without a read check and for mutating tools without a preview variant. |
| Visual and interactive impact | 15% | 6 | Live panels, drill, presence chips and a conflict chip are real, but the most visible beats are a settings table and a permission card; less spectacle than 02. |
| Credibility to expert engineers | 10% | 7 | Claim-to-test mapping is credible, but the `live` consistency contradiction (W1) and the principal-free cache key (W2) are the first questions an expert would ask. |
| Five-minute narrative | 10% | 7 | Clear arc (question, board, why, drill, conflict, boundary, kill). The 210 to 255 and 270 to 300 beats need the most explanation. |
| Feasibility | 5% | 3 | The largest component set in the group (CRDT, IVM, Cedar, DuckDB, Redpanda, MinIO, Keycloak, OpenTofu, Vega-Lite, WASM spec). H.4 is well ordered, but many novel components sit on the critical path. |
| Live-demo reliability | 5% | 3 | Two timing-sensitive live beats (a CRDT race at 210 to 255 and a `kill -9` exactly-once at 270 to 300), and an attribution window that is not complete when the question is asked (W3). |

Weighted total: 7.2.

### Strongest ideas

- A move-capable tree CRDT with fractional-index sibling order, and concurrent property writes kept as a named annotation with the loser retained in the log (D.5). This is the right way to show "two editors, no silent overwrite".
- A typed query IR where units and types are checked before execution, with exact-path errors (D.3, D.4, P15).
- Preview and commit as one plan object with base revision, normalised ops, semantic diff, permission result and cost, expiring and committed by id (D.8).
- The differential test of the RLS rewrite against a naive reference evaluator, including projection, sort and group on the predicate column (F, claim 4).
- A fault that is modelled as queueing behaviour in the simulator, so the cause is in the data rather than labelled (A). The platform never receives a label that says "this is the cause".
- The honest shallow-features list in G.5, which pre-empts the audience's critique.

### Weaknesses (most severe first)

1. **The `live` consistency model contradicts itself.** D.2 keeps a `ref` table with compare-and-swap `version`, D.8 returns `stale_base` on a moved ref, and D.5 says `live` "is always CRDT-merged". D.6 forbids agents from writing `live` (`resource.ref != "live"`), yet C.1 at 210 to 255 has the agent `spec.commit` a change to `query.window` on the node the presenter is editing, and describes it as a CRDT merge where "both apply". Either the agent wrote to `live` (violating the policy) or the beat is not a merge. Separately, D.5 says `query` is an exclusive register, so a concurrent write to a window default that lives inside the query gets one winner, not both.
2. **The live-result key omits the principal.** D.4 says a live result is a function of `(watermark, binding_hash, rev_id)`. RLS is applied at rewrite time, so the finance window (255 to 285 s, and claim 4's observable "fewer rows") and the Ops wall with the same binding would share one result. This is a data leak in the design, and it also breaks the "two windows agree" moment the design depends on.
3. **The attribution window is not complete when it is queried.** C.0 says the 14:05 throttle starts about 30 real seconds into a live feed running at 10 times, so 14:20 is reached about 120 real seconds in. The 120 to 165 s row asks for the 14:05 to 14:20 window at the same moment. Any agent latency before the question means the quoted figures (91%, 88%, 0.82 to 0.31) are computed on an incomplete window. The query has to bind to a watermark at or after 14:20, and the doc must state when the live feed started relative to the first keystroke.
4. **The concurrency beat cannot be replayed.** The 210 to 255 row depends on a human keystroke and an agent commit interleaving in a specific order. C.3 records one checkpoint per recorded step, and the recording captures the sequence of calls, not the interleaving that produced the register state. The fallback therefore cannot reproduce the most advanced moment of the demo.
5. **Chain serialisation is unstated.** D.7 says each audited operation writes an `audit_event` in the same transaction and is hash-chained, but the table has only a bigint primary key and no lock or ordering rule (see X2). The `op_log` assigns per-replica `seq` with no stated rule for replica identity across restarts.
6. **Authorisation holes on the MCP path.** `ui.focus` (D.8) pushes objects to sessions with `mode: navigate` or `bind`, and the doc states a permission but not a check that each receiving session can read the target. `catalog.search`, `lineage.of` and `audit.search` have no stated read filter. `spec.revert` and `branch.create` are mutating without a preview variant, which contradicts the doc's own principle 2.
7. **A Cedar example that cannot be evaluated.** The `acl.grant` policy in D.6 references `resource.ref` on a `Workspace` resource. That attribute does not exist on the entity type it is written against.
8. **Finance hides a panel the grant never named.** At 255 to 270 the finance window shows the board "minus the NE-2 panel, because the grant on the drill-down was never made", but the approved grant was on the board. Panel-level hiding inside a granted board is not in the model (RLS is row-level).
9. **Exactly-once across a process kill is a precondition, not a property.** The 270 to 300 claim (zero missing or duplicated deltas) needs clients to dedupe on `(replica, seq)`, which is not stated, and "gaps are impossible by construction" sits beside an at-least-once transport. The chaos test passing on 20 of 20 random kill points is an engineering gate, not a demo-day guarantee.
10. **Overstated stage count.** B.3 says "roughly thirty-five capabilities, and each appears in at least one visible action". Several D rows (P17 IVM, P26 attribution's sub-steps) are supporting in the table and do not appear on screen as separate beats.

### Required changes

- Resolve `live` in one direction. Either agents never write `live` (remove the 210 to 255 `spec.commit` on the window default, or route it through the agent branch and merge), or `live` is a CRDT target for agents and the D.6 policy changes. Specify how a register-level concurrent write is shown.
- Add the principal's effective row-predicate and mask hashes to every live-result key (X4). Show the key in the explain output.
- Bind the attribution query to a watermark at or after its window end, and state the live-feed start relative to the first keystroke.
- Replace the 210 to 255 row with a deterministic conflict: both writes are issued through the transcript at fixed positions, and the tape records the resulting register state, or the row is removed from the fallback-eligible set and marked live-only.
- Add an explicit chain-head lock (X2) and a rule for replica identity across restarts.
- Give `ui.focus`, `catalog.search`, `lineage.of`, `audit.search` and `presence` an explicit per-session read check, and add preview or a stated exemption for `spec.revert` and `branch.create`.
- Correct the `acl.grant` policy to use a real attribute, and make it type-check in the analyzer the doc mentions.
- Specify panel-level visibility inside a granted board, or change the finance beat to a row-scoped result.
- State the client dedupe key for exactly-once and what the chaos test proves.

---

## 02 Tessera (Visual Spectacle)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 20% | 8 | Typed TDS with unknown keys as errors, output schemas computed at validation, a result cache keyed by IR hash, watermarks and the principal's effective predicate hash (D.3), and path-level merge with conflict cards. It does not overclaim CRDT or IVM. |
| Composability and breadth | 20% | 8 | Query, panel, parameter and query, and agent write, revision, audit, realtime, screen (B.2), with audit as a source. Reduced because the interaction state goes through the document write path (X1). |
| Agent / MCP integration | 15% | 8 | Common envelope with `next` and `rate`, closed error set with `valid_values`, dry run on every write, approval cards, and a stated rate-limit policy. Deducted for naming drift (X7) and the fallback guard (W1). |
| Visual and interactive impact | 15% | 9 | Animation tied to sequence numbers, a composition trace ribbon showing pending calls, ghost overlays of proposals, and an audience phone flipping from 403 to the board on a grant. The strongest spectacle in the set. |
| Credibility to expert engineers | 10% | 7 | Honest about unmeasured targets and the hash-chain hot row. The fallback contradiction and parameters-as-revisions would be found quickly. |
| Five-minute narrative | 10% | 8 | Clear arc with a refusal, a grant, an undo and a rebuilt board from the audit log in the final 15 s. The final 30 s is strong and checkable. |
| Feasibility | 5% | 6 | TypeScript end to end and a dependency-ordered 13-step build (H). Cedar via WASM, DuckDB bindings and custom WebGL are the riskiest additions. |
| Live-demo reliability | 5% | 5 | The fallback guard cannot take over from a divergent live state (W1), and each row's grace window is a full 20 s on top of rows that last 20 to 30 s. |

Weighted total: 7.8.

### Strongest ideas

- The cache key includes the principal's effective predicate hash (D.3). This is the correct construction, and the other proposals should copy it.
- Animation is allowed only on sequence-numbered events, with a stated rule against timer-driven fake updates (design mandate section, V07). This makes the spectacle honest.
- The fallback's state verification idea: the driver checks the canonical hash before it acts (C, "Where the fallback takes over"). The idea is right; the trigger rules need to match it.
- "Preview equals commit" is a property of one code path, tested over 200 previews with 50 interleaved conflicts (F, claim 3).
- The replay of an audited session into a blank workspace with checkpoint hashes, as the closing proof (C, 285 to 300 s).
- The explicit statement that quantities are targets, not measurements (intro to A and F).

### Weaknesses (most severe first)

1. **The fallback guard cannot recover the case its trigger describes.** Under "Where the fallback takes over", F9 fires on "a checkpoint whose hash differs from the transcript's and whose call trace is off-script", but the driver "stops and shows a reset prompt" if the current hash does not match the transcript checkpoint. So the driver proceeds only when the live agent stalled, and refuses precisely when the live agent produced a different valid state. The 20 s grace per row also means a stall costs a visible dead period on a row that lasts 20 to 30 s.
2. **Parameters and drills are revisions.** D.8 names `tessera.param.set` as "the same write humans make through brushing", and V03 creates a parameterised view "as a revision on the investigation branch". Every brush then carries a base revision, so two windows brushing different regions conflict on the parameter path, and history fills with navigation. Parameters belong in URL and session state, as 03 has them.
3. **The chain's stated mitigation is its existing design.** G (implementation difficulties) names the single hot row in `change_event` and mitigates it with "per-workspace chains, with a global anchor written periodically". The table is already keyed by workspace, and the global anchor is not defined anywhere in the document. The serialisation point is not specified (X2).
4. **The screen tool has three names and two preview mechanisms.** B (M05) calls it `dashboard.present`, D.8 calls it `tessera.screen.present`, and the write family uses `dry_run` on some tools and `preview_token` on `commit`. The "tool description as a contract" claim (D.8) needs one name per operation.
5. **Policy storage is missing.** At 225 to 240 the grant "is written as a Cedar policy revision signed by the approving human". D.2 has no policy or grant table, and the document does not say where signatures are verified, how the key is managed, or how a policy change is hot-loaded.
6. **The paging semantics are wrong in the narrative.** At 270 to 285 the workflow `page-oncall-eu` "sends its recorded webhook" on `resolved`, which is a recovery notice, not a page. The workflow guard at 200 to 225 is correct; the action on close is not.
7. **`screen.present` authority is unspecified.** The doc says screens are principals with a display scope, but does not say the screen's principal must also be able to read the target dashboard. A display-scoped screen could be pointed at a restricted board.
8. **Claim 5 hashes the wrong thing if it hashes panel results.** It asserts "the same canonical workspace hash at every checkpoint". If that hash includes query results, it depends on the live feed and cannot match across runs. The hash must cover documents and revisions only, and this needs saying.
9. **Audit writes on every decision.** D.6 writes a `change_event` for "every decision (allow or deny)", which means every read is a row on the hash chain. At 60 reads a minute for an agent, that is the hot-row problem (W3) at read volume, and it is not in the mitigation.
10. **The causal path to the eu incident is a presenter key.** The degradation is triggered by pressing `I` (C, 100 to 120 s). That is honest, but it means the "scenario" is a switch. The expected figures (within 15 s, 40 s recovery) are targets. Engineers will read this as a scripted event, which the proposal should own.

### Required changes

- Rewrite the fallback guard so it reconciles divergence (for example, the driver reverts the live agent's own changes to the checkpoint, scoped to that principal) rather than refusing. Shorten the grace window to a value below the row's duration.
- Move parameter and cross-filter state out of the document write path into URL and session state. Keep drill-down as navigation, not a revision.
- Define the chain serialisation point and the global anchor concretely (X2).
- Use one name for the screen tool and one preview mechanism per family, and regenerate the catalogue from it.
- Add the policy and grant storage to D.2, with signature verification and hot-load rules.
- Correct the 270 to 285 workflow to page on `firing`, or rename the action to a recovery notice.
- Require the screen principal to pass a read check on the target.
- Restrict claim 5's hash to documents and revisions and state it.

---

## 03 Parapet

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 20% | 8 | The plan hash covers the canonical after-state, base revisions and decision IDs (D.8); Cedar explanations come from the same evaluation as the decision (D.6); RLS predicates are derived from the same bundle, and a differential test exists (F.1). |
| Composability and breadth | 20% | 8 | One command layer, one change log, and a composition map that is explicit about how query, alert, workflow, approval, undo and screen connect (B.6). Reduced by `mode: "commit"` variants that bypass the plan invariant (W3). |
| Agent / MCP integration | 15% | 8 | Preview by default, closed error codes with `did_you_mean` and `valid_values`, and an agent-specific approval route. The tape uses `expect` checks against real responses and never fabricates output. Reduced by discovery leaks (W1). |
| Visual and interactive impact | 15% | 6 | Wall, phone and finance windows, presence and a masked column are all on screen, but the visible moments are mostly tables, cards and a permission explanation. |
| Credibility to expert engineers | 10% | 8 | The enterprise model is what expert engineers check: denials audited as rows, explanations that cannot drift from decisions, the agent bound by the same rules, and an honest shallow-features list (G.4). Deducted for missing `FORCE ROW LEVEL SECURITY` and for the scripted lock injection. |
| Five-minute narrative | 10% | 7 | The "same policy refuses the agent and the humans" arc is strong. The approval beat (235 to 255 s) does not say what happens after approval. |
| Feasibility | 5% | 6 | A large stack (TypeScript, Fastify, Kysely, Cedar WASM, Postgres, Cognito and Keycloak parity, OTel, MinIO, Chromium), but each of 45 rows is mapped to a component and the H.4 order is sound. |
| Live-demo reliability | 5% | 6 | The tape's precondition and refusal design is the best in the set. Deductions because approval resumption is undefined (W4) and the 5 % timestamp tolerance can pass with different state. |

Weighted total: 7.4.

### Strongest ideas

- Plans with `plan_hash` covering the canonical after-state, the base revisions and the decision IDs, with an apply that re-checks the policy bundle version recorded in the plan (D.8). A stale or re-decided plan cannot apply.
- Explanations computed from the same evaluation as the decision, so they cannot drift (D.6, `permission.explain`).
- Denied decisions recorded as audit rows with `new_rev = NULL` (D.7). Refusals are evidence, and the design says so.
- Denials that name the column and policy without revealing restricted values (D.8, "the refusal must be explainable without leaking the data it protects").
- The tape: step records with `expect` checked against real responses, preconditions checked before each step, and `reset required` on divergence (C, fallback section). This is the right design for a fallback.
- Interaction as URL state (D.9), so a cross-filter is not a write.
- Real Postgres lock contention as the substrate of the demo, with a fault whose start time is in a manifest the rehearsal reads (A).

### Weaknesses (most severe first)

1. **Discovery contradicts itself, and the 255 to 285 beat depends on the contradiction.** D.8 says `parapet.discover` filters fields "the principal cannot use" so they "do not appear". The `source.describe` signature in the same section returns columns with `visible: "hidden"`, and the 255 to 285 row calls it on `hr.compensation` and shows `salary_band` with its sensitivity class before the query is denied. Either hidden columns are listed by name to the agent, which is a schema leak, or the beat is wrong.
2. **`as` lets an agent name another principal.** `query.preview` and `query.run` take `as?: string` (D.8), and the script runs `as: "group:finance"` at 200 to 235 s. Unless `as` is restricted to principals within the agent's ceiling, it bypasses the ceiling the doc describes. `permission.explain` takes an arbitrary `principal`, so the agent can read other principals' policies. Neither is bounded in the text.
3. **Commit-mode writes bypass the plan invariant.** B.5 (row 41) says writes default to preview and commit "requires the plan ID and an idempotency key". The signatures for `query.save`, `metric.define`, `alert.create`, `workflow.create`, `form.create`, `share.grant`, `schedule.report`, `annotate` and `change.undo` accept `mode: "commit"` and return a committed change, with neither a `plan_id` nor an idempotency key in the input. Either those tools skip the invariant or the signatures are wrong.
4. **Approval resumption is undefined.** At 235 to 255 s the agent's `alert.create` with an external webhook returns `POLICY_DENIED`, and the presenter approves. The doc does not say whether approval applies the agent's plan, who applies it, what happens to a plan whose TTL is five minutes and which applies once, or where the approval request is stored (there is no approval table in D.3). `permission.propose` returns an `approval_request_id` with no table behind it.
5. **RLS can be bypassed by ownership.** The guarantee "no application path can skip them" (B.2, row 11) holds only if the application role does not own the tables, or if `FORCE ROW LEVEL SECURITY` is set. Neither is stated, and `parapet doctor` checks parameters, not role ownership.
6. **Chain serialisation is unstated.** D.3 gives `change_log` an identity column and an `entry_hash` chain, and D.7 says it is written in the same transaction. There is no lock or ordering rule (X2), which is the one place a correctness claim about audit would be tested.
7. **Agent-authored workflows are not checked against the ceiling.** The agent may `workflow.create` with `notify`, `form_write` and `http_call` steps (D.8, step registry in B.3). The text states an allowlist for hosts, but not that the agent's ceiling is checked against each step type at creation.
8. **The fault is found by design.** The injected maintenance lock on `payments.ledger` is named in the change log at 135 to 170 s, so the "why" is answered by reading a row that was written for the purpose. The data is real Postgres behaviour; the cause is scripted. An expert audience will see that unless the injection goes through a real code path, such as a long transaction in the payments service.
9. **The tape's tolerance can pass different state.** The precondition "change-point exists within 5 % of the recorded timestamp" lets a run that diverged within the tolerance proceed, which conflicts with the exact-hash claim in F.5.
10. **Visual ambition is the lowest in the group.** The wall is described as a status surface. The "composition as spectacle" is largely tables and a permission card.

### Required changes

- Make `source.describe` return only columns the principal may see, and handle hidden columns with a generic denial. Update the 255 to 285 beat so the agent learns the denial from `query.preview` without seeing the column list.
- Restrict `as` to principals whose effective rights are within the agent's ceiling, or remove it, and bound `permission.explain` to the agent's own principal and its delegator.
- Make every write tool take `plan_id` and an idempotency key in commit mode, or remove `mode: "commit"` from the agent surface.
- Add an approval table to D.3, and specify the resume path: the human approves a specific plan, the platform applies that plan under the agent's principal with the human recorded as approver, and expiry is re-planned rather than reused.
- State `FORCE ROW LEVEL SECURITY` and the non-owner application role, and add both to `parapet doctor`.
- Specify the chain serialisation point (X2).
- Check each step type against the agent's ceiling at `workflow.create`.
- Route the lock injection through a real long transaction in the payments service, and keep the scripted version as a fallback only.
- Replace the tolerance precondition with an exact hash over the normalised state.

---

## 04 Tessera (Emergent Composition)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 20% | 7 | Query as typed IR with predicates attached before any optimiser, path-level three-way merge with conflict payloads, lineage from ASTs and a backtest that is a query. Reduced because the result cache leaks across mask sets (W1) and the chain's locking is wrong (W2). |
| Composability and breadth | 20% | 9 | The strongest composition thesis: one spec language, one compiler, one `authorize`, generic verbs, and B.6's "query feeds everything" is concrete and checkable. |
| Agent / MCP integration | 15% | 6 | Fifteen generic verbs with rich errors and `schema.describe` is a defensible bet, but the proposal gates its own thesis at "two of ten reference questions" (H.4, stage 5) and says it must be tested with a model (G.6). |
| Visual and interactive impact | 15% | 7 | Keyed result diffs, ghost previews, lineage digests on panels and a clean Exec-view change at 135 s. Visual scope is deliberately small (G.5). |
| Credibility to expert engineers | 10% | 6 | Named tests (`preview_is_commit`, `rls_differential`) are good, but the cache key, the Redis-held preview tokens and the node-level lock contradict the claims they test. |
| Five-minute narrative | 10% | 6 | The first investigation's answer ("one carrier's median handoff time doubled") has no documented cause in the data; the only described fault (225 to 250 s) comes later. |
| Feasibility | 5% | 6 | A compact component list, but Redis holds correctness-relevant state (preview tokens) and the DuckDB Node binding, Kafka, MinIO, Keycloak, Caddy and Jaeger all need integration. |
| Live-demo reliability | 5% | 4 | The fallback's hash check on `query.run` stops on the feed's watermark (C.3, third bullet), while C.2 streams the live feed at 0 to 30 s. The first query step will diverge on every run unless the clock is frozen. |

Weighted total: 6.85.

### Strongest ideas

- The stated rule that `query` is the only way data is read, with the workspace predicate, grant predicate and column mask applied in that order and "without an option to skip it" (D.4). The intent is right.
- `query.explain` returns the compiled SQL and the injected predicates, so an auditor and an agent see exactly what the authorisation layer added (D.7, tool 7).
- Preview tokens are single-use and bound to the change hash, and a stale token returns `PREVIEW_STALE` (D.6, F.1 negative cases).
- Rate-limit costs weighted by operation (`query.run` 5, `node.preview` 2, `node.commit` 3), so runaway loops are visible in the trace (D.9).
- Generic verbs as a deliberate hypothesis, stated as such (D.7 and G.6), with a plan to test it against a model.
- The prompt-injection section is candid that it is "not a complete defence" (D.10).

### Weaknesses (most severe first)

1. **The result cache omits the column-mask set.** D.4 keys the cache on `(query_hash, principal_row_predicate_hash, parameter_values, watermarks)`. Two principals with the same row predicate but different masks (for example, a masked finance viewer and an unmasked analyst) share a cached result, and a masked column is returned unmasked to the lower-privilege principal. This is an authorisation hole in a stated design.
2. **Node-level locks do not protect a per-workspace chain.** D.2 hash-chains `changes` per workspace, and E.2 says the isolation is "read committed with row locks on `nodes`". Two commits to different nodes read the same chain head and compute `prev_hash` from it, which forks the chain. The chain head needs its own lock (X2).
3. **Preview tokens live in Redis.** D.2 says Redis holds "short-lived preview tokens", and D.6 says tokens are single-use and bound to the change. Redis is described as non-authoritative, so a restart or a second instance can reissue or lose a token, and single use then cannot be enforced. The preview-equals-commit claim (F.1) depends on that invariant.
4. **The fallback cannot pass on a live feed.** C.2 (0 to 30 s) streams live events while C.1 says the generator is "parked at the virtual time before the scripted fault". C.3 stops on any `query.run` hash mismatch, with "source watermark differs" as the example. A live run and a recorded run advance the watermark differently, so the first query step fails on every run unless the feed is frozen per step and the hash is stated against a fixed watermark. The doc's own sentence ("the transcript's expected hashes were computed on the same history") is true only if the history is frozen.
5. **The first answer has no documented cause.** The 60 to 100 s answer ("one carrier's median handoff time doubled") needs an event in history at 14:05. A describes the live fault at 225 to 250 s for `EMEA Crane`, and the 30-day backfill is not described as containing any episode. The backtest at 100 to 135 s shows "the 14:05 episode as one firing", so the episode exists, but nothing generates it. Engineers will ask this first.
6. **Source sampling may bypass the compiler.** P3 says the query is "the only way data is read", but D.7 tool 5 `source.sample(source, limit, columns)` returns raw rows. The doc does not say whether masks and the workspace predicate apply to sampling.
7. **Idempotency is workspace-scoped.** D.2 and D.6 use a unique index on `(workspace_id, idempotency_key)`. A key reused by another principal returns that principal's result, or a replay with no principal check. Keys must be principal-scoped (X3).
8. **The central bet is tested last and at the lowest bar.** H.4 stage 5 accepts "two of the ten reference questions" as the gate on the tool surface, and G.6 concedes the decision "should be tested with a model, not argued". A proposal whose thesis is that generic verbs compose better should gate its tool surface on that evidence, not on a low bar set after the surface is built.
9. **Attribution is not in the stage path.** The "why" uses `attribution` and `explain` in the agent's answers, but the design names no attribution primitive in D.4 (only lineage and a backtest). The explanation rests on the agent's own query pattern.
10. **Redis carries too much.** Presence, realtime fan-out, preview tokens and the idempotent response cache all sit on Redis. The "losing it drops presence" framing in D.2 covers only one of them.

### Required changes

- Add the column-mask set (and its version) to the cache key, and add a test that a masked and an unmasked principal with the same predicate never share a result.
- Lock the workspace chain head in the commit transaction, and state it (X2).
- Move preview tokens and idempotency records into Postgres, in the commit transaction, and remove Redis from anything with a single-use invariant.
- Freeze the generator at a virtual time per fallback step and bind query hashes to that watermark; or hash rounded results without the watermark and state the trade.
- Document the seeded 14:05 episode in the backfill, and show how the generator produces it from the same causal path as the live fault.
- Route `source.sample` through the query compiler, or remove it from the agent surface.
- Make idempotency keys principal-scoped.
- Raise the gate on the tool surface to a number that would support the thesis, and run the model evaluation before the surface is frozen.

---

## 05 Lodestar (Live Operational Resilience)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 20% | 7 | Real containers, Toxiproxy timeouts, a `FleetAdapter`, an advisory-locked chain, plan/apply with `base_seq` and idempotency, and an honest parity table. The metric semantics under a paused process are not designed (W1). |
| Composability and breadth | 20% | 7 | The core-machinery table composes (runner, incidents, approvals, actions, screens, undo), but the workspace-wide `revert_to` couples unrelated principals (W2). |
| Agent / MCP integration | 15% | 7 | Grant-filtered tool list so the agent cannot see `fleet.fault`, plan expiry with the command to re-plan, and self-correcting errors. Reduced by two conflict mechanisms and the `rebase: true` bypass. |
| Visual and interactive impact | 15% | 7 | A real fault on a real container with an incident board, a masked table and an orders row turning red in the same frame. Less spectacle than 02. |
| Credibility to expert engineers | 10% | 6 | Real faults and an honest parity table earn trust, but a paused container cannot export the histogram the alert reads, and an agent-authored workflow carries the restart action. SREs will catch both. |
| Five-minute narrative | 10% | 8 | The most natural operations story: fault, alert, question nobody built a dashboard for, approval, recovery, masked data. |
| Feasibility | 5% | 7 | One image family, interface-based cloud adapters, a modest component list. PromQL conformance across VictoriaMetrics and AMP is the largest unknown and is named as such. |
| Live-demo reliability | 5% | 5 | The alert cannot see a paused process as described; takeover can revert a human's live edits (W2). |

Weighted total: 6.9.

### Strongest ideas

- Real faults through real mechanisms (`docker pause` or Toxiproxy timeouts), with the action result recording which mechanism ran (E, parity table). The fault is an observable process effect, not a flag.
- `reset` refuses while a fault is active unless forced, and restores before reseeding (E, local).
- The advisory-locked, workspace-serialised chain (D.2, note on `pg_advisory_xact_lock`). This is the one explicit answer to X2 in the set.
- The agent's tool list is filtered by grant, so the agent cannot see a route to `fleet.fault` (D.8, "Deliberately absent").
- Field-level merge limited to layout (`grid`), with the rest as explicit conflicts (D.5). A narrow, testable rule.
- A recorded-telemetry snapshot for replay, with the source name in explain output so the mode is inspectable (A, reproducibility level 3; C, fallback item 3).
- Claim 1 (a plan's diff is the diff `apply` writes) as a property test over 2,000 batches.

### Weaknesses (most severe first)

1. **A paused process cannot produce the metric the alert reads.** At 45 to 75 s, `docker pause` freezes the payments container, and "payments authorization p95 climbs in the query window", firing an alert in 10 s. A frozen process does not answer its metrics scrape. The series goes absent or stale, not high. The latency rise has to come from a surviving vantage point (the caller's histogram in `orders`, Toxiproxy's own counters, or the k6 client), and the doc must say which. Absent-series semantics also have to be defined. Claim 3's 20 s target (F) rests on the same scrape, so it has the same defect.
2. **Takeover can revert human edits.** C.3 rule 4 calls `lodestar.revert_to(checkpoint_seq)` "if the live agent wrote anything since the checkpoint", and D.7 defines `revert_to` as replaying inverse patches "for all changes after `seq` in the workspace branch". During the 110 to 200 s window, Cass moves a panel and retitles another. A takeover at checkpoint 3 reverts her edits on stage.
3. **The agent authors the restart workflow.** At 145 to 180 s the agent creates `runbook-payments-restart` with a `fleet.restart` step. D.6 gives the agent `workflow (create only)` and no `action:*`, and D.8 says actions run "only from workflow definitions that a human-role principal created or approved". The approval gate at step 2 protects the restart at run time, but the definition was agent-authored, which contradicts the doc's rule. Either the ceiling forbids action-bearing workflow creation and the agent cannot create this one, or a human approves the definition.
4. **Two conflict mechanisms.** Writes carry `expected_version` (D.5, and E_VERSION_CONFLICT at 110 to 145 s), and plans carry `base_seq` with `E_PLAN_STALE` (D.8). The `rebase: true` option on apply re-plans against a moved head automatically, which can apply a plan the human never saw as conflicting. The 170 to 200 s conflict beat should surface the conflict as data, and `rebase` should not be the agent's default.
5. **The fault console's principal is undefined.** C (45 to 75 s) says the console runs `fleet.fault` "with the presenter's grant", but no human in D.6 holds `action:fleet.fault` (Cass has `action:fleet.restart`; Ada is admin). The presenter's identity is not named.
6. **Replayed telemetry is presented as live.** A (reproducibility, level 3) and E (AWS, replay telemetry) say replay mode points the metric and log sources at a snapshot "so numbers on screen match the recording", and the source name in explain output is the only indicator. The audience sees panels that are recordings with no on-screen mode. That is not fake functionality, because the platform still queries its own source, but it is a recording presented as the live system.
7. **The fault latency budget is built from a scrape that does not run.** Claim 3 is 5 s scrape, 10 s for-duration, 2 s evaluation and 1 s SSE. On a paused target the scrape term is undefined (W1), so the budget is unanchored.
8. **Policy and approval are described, not stored.** The approval route and grant gates are described, but the approval request and its resolution are not in the D.2 schema.

### Required changes

- Choose a measurement vantage point that survives the fault, and define absent-series behaviour in the alert rule. Restate claim 3 against that vantage point.
- Scope `revert_to` for takeover to the transcript's own principal and changes, or refuse takeover when a human has changed a node since the checkpoint. Add a test that a takeover never reverts a human change.
- Make action-bearing workflow creation an explicit ceiling check, or require a human to approve the definition before a run can start.
- Use one conflict mechanism for stale writes, and remove `rebase: true` from the agent surface.
- Name the presenter principal and its grants.
- Label replay mode on the audience screen (a small, honest indicator), and state that the recording is the data source for that run.
- Add the approval table and its resolution path to D.2.

---

## 06 Tessera (Harbour, Agent-Native)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 20% | 6 | A sound kernel (one propose and commit path, changeset digest, scope intersection, approvals as changesets), but no policy language, no incremental maintenance and no query-engine depth beyond "QIR". Several claims are about discipline rather than mechanism. |
| Composability and breadth | 20% | 7 | A compact primitive set with an explicit composition map and 48 rows; the composition is real but narrower than 01 to 04. |
| Agent / MCP integration | 15% | 8 | The common envelope, `fix` objects on every error, dry run on every write, approval changesets the agent cannot commit, and F.5 as a scripted-client test of the error surface. The best-specified tool surface in the set. |
| Visual and interactive impact | 15% | 7 | War-room view, ghost overlays, a split diff, conflict and approval cards, and a phone-width screen. Coherent but built from a small set of widgets. |
| Credibility to expert engineers | 10% | 5 | The takeover premise, the auto-commit policy, the global idempotency key and content-idempotent proposals across principals are the first things an expert would test. |
| Five-minute narrative | 10% | 8 | Tight 300 s arc: war room, evidence, conflict, approval, undo, audit, then a composed rollback button. The ending is memorable and checkable. |
| Feasibility | 5% | 7 | Eight components on one language (api, mcp, core, engine, web, sim, worker, driver) and a 17-step order. Kinesis is untestable locally, which the doc records as a risk. |
| Live-demo reliability | 5% | 4 | Duplicate prevention in takeover assumes the live agent used the transcript's keys and identical object IDs; the stall trigger reads the audit log, which records writes and not reads. |

Weighted total: 6.7.

### Strongest ideas

- One code path for propose and commit, with commit re-running the pipeline and checking the digest (D.5). F.1 is a property of the code, not a hope.
- Approval as a changeset in `awaiting_approval` that the agent sees in `change.list` and cannot commit (D.5). Approval is a state, not a UI convention.
- The error envelope with a machine-usable `fix` (D.5, examples). It turns an error into a one-step correction.
- F.2: 40 scope-escalation probes, each required to produce a refusal or `PREVIEW_REQUIRED` and an audit row, with a digest comparison over the workspace.
- F.4: five browser clients and one agent for 60 s with 1,000 random operations, requiring digest equality and no duplicate commits.
- Attribution on every write (`on_behalf_of`) with a visible badge on the screen (D.5, prompt-injection considerations).
- The honest shallow-features list (G.5) and the stated Kinesis gap (E.2).

### Weaknesses (most severe first)

1. **The takeover's duplicate prevention assumes the live agent used the transcript's keys.** C.4 says the next unsatisfied step runs "with its recorded idempotency key, so a commit the agent already made cannot be duplicated". The live agent generated its own key, so the platform never saw the recorded key, and the duplicate check does not fire. Skipping by digest also requires the live agent to have chosen the same object IDs and produced the same revision numbers, which a live agent choosing its own names will not.
2. **Auto-commit is the most consequential rule and it is undefined.** C.2 (70 to 100 s) says "auto-commit allowed: agent scope includes `dashboard:write:team-ops`, and the change is additive and reversible; see D.5". D.5 defines no such rule. G.3 says auto-commit covers "additive, reversible changes in the agent's scope" and that threshold replacement and alert binding are routed to a human. The classification between those is never given, and a policy that depends on it needs a test.
3. **Idempotency and proposals are global.** `changesets.idempotency_key` is `UNIQUE` with no principal (D.2), and `propose` returns "the existing proposal" for "an identical op list on the same base" (D.5). Unless both are principal-scoped, a second principal receives the first principal's proposal and changeset ID (X3).
4. **The stall trigger cannot see reads.** C.4 arms the driver when "the agent makes no call for 15 seconds", observed "through the platform's own audit log". B.1 (P35) and D.2 record writes ("Every write"). A stalled agent doing a long run of reads (`query.run`, `resource.search`, `catalog.describe`) is invisible to the trigger, and the one case the trigger is for is the one where reads dominate.
5. **Audit append order.** G.1 mentions "a single sequence per workspace advanced in the commit transaction". A Postgres sequence value is assigned outside commit order, so chain order and commit order can disagree unless the chain head is row-locked (X2). F.3's per-step `audit.verify` assertion depends on that.
6. **The scope grammar is a string format with no matching rules.** `verb:kind:selector` with examples such as `dashboard:write:team-ops` and `query:read:telemetry` appears in C.1 and the D.5 transport section, but the doc does not define selector matching, precedence, deny rules or wildcards. The delegation intersection (D.2, `delegations` table) is therefore a string operation with no specified semantics, which is the usual location for scope holes. Cedar, which 01 to 03 use, is one answer.
7. **Presence is not filtered by read.** `presence.list` (tool 19) and the presence bar (C.1) show the human and agent participants on a changeset or document, with no stated check that the caller can read it.
8. **Preview is idempotent across principals.** See weakness 3; the preview and changeset objects are shared rows, not principal-owned.
9. **Interaction state is unspecified.** The cross-filter and parameter path (P11, P12) is listed but not stored anywhere. If it is a revision, it inherits X1.
10. **Kinesis is untested locally, and the doc says so.** The AWS event bus is covered by contract tests only in AWS. That is an honest gap, but it means the realtime claim for AWS is untested until the AWS rehearsal.

### Required changes

- Replace the takeover rule with one that does not depend on the live agent's keys: derive keys from `(transcript_id, step_id)` and require the live agent to use them (the MCP client can be configured to), or skip by matching the changeset's canonical ops digest, and state the rule.
- Define the auto-commit policy as a table: which op kinds and which target kinds auto-commit for agent principals, with the approval route for the rest, and add a test per row.
- Scope idempotency keys and `propose` content-idempotency to the principal.
- Drive the stall trigger from the MCP session's own call log (reads and writes), not from the audit log.
- Lock the chain head in the commit transaction (X2).
- Define the scope grammar: selector matching, precedence, deny rules, and the delegation intersection, with a test per rule.
- Add a read check to `presence.list` and to the presence bar.
- Store parameter state outside the document write path (X1).

---

## Comparative assessment and ideas to keep regardless

### Ranking

1. **02 Tessera (Visual Spectacle), 7.8.** The best spectacle and the most disciplined use of sequence numbers. Its lead depends on fixing the fallback guard (W1) and moving parameter state out of revisions (W2). Those fixes are local to the design, not structural.
2. **03 Parapet, 7.4.** The most credible enterprise design and the strongest fallback. Its lead depends on fixing discovery (W1), commit-mode invariants (W3) and approval resumption (W4). The visual score is its real limit.
3. **01 Fathom, 7.2.** The most ambitious and most composable design, with the deepest primitives. It is ranked below 03 because its consistency model contradicts itself on `live`, its cache key omits the principal, and its two central live beats cannot be reliably reproduced. A sophisticated feature that cannot be demonstrated reliably is penalised, and 01 has the most of those.
4. **05 Lodestar, 6.9.** The most natural operations story and the most honest about real faults. Its metric defect under pause and its takeover that reverts human edits would be caught on the first rehearsal by an SRE in the room.
5. **04 Tessera (Emergent Composition), 6.85.** The strongest composition thesis, which it gates last and tests least. Its cache key, chain locking and fallback premises each break a stated claim.
6. **06 Tessera (Harbour, Agent-Native), 6.7.** The cleanest kernel and the best-specified tool surface, with two rules (takeover keys and auto-commit) that are unsound as written.

The gap between 2 and 6 is about 1.1 weighted points. Most of the lower-ranked defects are fixable in the design. None is disqualifying.

### Ideas worth keeping regardless of who wins

From **01 Fathom**:
- The tree CRDT with fractional-index ordering and a named concurrent-write annotation that keeps the loser in the log. This is the right way to show concurrent edits without silent overwrite, if the doc resolves the `live` contradiction.
- The differential RLS test against a naive reference evaluator, including projection, sort and group on the predicate column (claim 4).
- Modelling the fault as queueing behaviour in the simulator so the cause is in the data. The platform never receives a label saying what the cause is.
- One operation registry generating UI, HTTP, CLI and MCP, with a composition map that is checkable.

From **02 Tessera (Visual Spectacle)**:
- The cache key with the principal's effective predicate hash (D.3).
- Animation only on sequence-numbered events, with the rule stated as a rule.
- The `ghost overlay` of a proposal on the wall, which lets an audience see a change before it is committed.
- Replay of an audited session into a blank workspace with checkpoint hashes as the closing proof.
- Visibly labelled targets rather than measurements.

From **03 Parapet**:
- Plan objects whose hash covers the after-state, base revisions and decision IDs, with apply re-checking the policy bundle version.
- Denied decisions recorded as audit rows, and denials that name the rule without revealing the value.
- The tape's `expect` checks against real responses, live preconditions, and a `reset required` refusal instead of a wrong screen.
- Interaction state as URL and session state, not as writes.
- A `FORCE ROW LEVEL SECURITY` standard, once it is added (W5).

From **04 Tessera (Emergent Composition)**:
- The query as the only read path, with the injected predicates shown in `query.explain`.
- Costs per operation in the rate limit, so a runaway agent is visible in the trace.
- Generic verbs as a testable hypothesis, with the test written before the surface is frozen.
- The candid limits in D.10 ("not a complete defence").

From **05 Lodestar**:
- Real faults through real mechanisms, with the action result recording which mechanism ran.
- Reset that refuses while a fault is active.
- A workspace-serialised chain with an advisory lock, stated explicitly.
- A tool list filtered by grant, so the agent cannot see a route to a forbidden action.
- Field-level merge restricted to layout, with everything else an explicit conflict.

From **06 Tessera (Harbour, Agent-Native)**:
- One code path for propose and commit, with the digest check on commit.
- Approval as a changeset state the agent can see and cannot commit.
- The error envelope with a machine-usable `fix` object.
- F.2's scope-escalation probes and F.4's multi-client convergence test.
- The attribution badge on any agent-written panel, so a reviewer can see origin regardless of what the agent's text said.

### Cross-proposal rules the next round should adopt

1. Only documents are revisions. Parameters, drills, presence and cursor state are session or URL state.
2. Every cache, incremental result and export is keyed by the principal's effective row predicate and mask set.
3. Every idempotency key and every proposal is principal-scoped.
4. The audit chain head is locked in the commit transaction, and the lock is named in the document.
5. Every fallback states its clock, its keys and what it does to another principal's changes. A takeover never reverts a human edit.
6. The MCP catalogue has one name per operation, generated from the registry, and every mutating tool has a preview variant or a stated exemption.
7. Metrics that drive an alert are measured at a vantage point that survives the fault the alert is meant to detect.
8. Quantities stay labelled as targets or measurements, as 02 and 05 do.
