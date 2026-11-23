# Reviewer D, round 2: Agent and MCP Tooling Engineer

Scope: the six revised proposals in `docs/demo-design/revised/` (01 to 06), read in full against the mission brief `00-mission.md`, and checked against this reviewer's round-1 findings in `reviews/round1/reviewer-D-agent-tooling-engineer.md`. Originals in `proposals/` were consulted only for comparison where noted. Nothing under `_superseded/` was read. Design review only; nothing was built or run.

Lens: the MCP server as a product that a general agent must use correctly from tool descriptions alone. Questions: tool granularity and count, schema quality, discoverability, whether the claimed UI is buildable from descriptions, self-correcting errors, preview, commit, idempotency and undo, context cost, how generated UI is represented and validated, scoped identity and audit, prompt-injection exposure, and whether the fallback is the real MCP path.

Weights follow the brief: depth 20, composability 20, agent 15, visual 15, credibility 10, narrative 10, feasibility 5, reliability 5. Weighted totals are computed from the integer scores below.

Disqualification check (brief's four criteria): no proposal is disqualified. No proposal embeds an LLM in the platform. Each fallback issues real MCP (or MCP-equivalent) calls rather than canned UI, and none depends on the live agent to exist. Each names a local and an AWS path from the same images. The defects below are serious and several sit on the central demo moment, but none is fake functionality or a deployment incompatibility.

Method note: round-1 findings were checked item by item against the revised text. "Fixed" means the change is in the named section and the script now follows it. "Partly" means the change exists but the script or another section still contradicts it. "New" means a defect introduced by the revision. Line numbers refer to the revised files.

---

## Round-1 follow-through at a glance

| Proposal | Round-1 items | Fixed | Partly | Not fixed | New defects from the revision |
|---|---|---|---|---|---|
| 01 Fathom | 11 | 10 | 1 (default `query.run` limit of 1,000 rows) | 0 | approval created inside a preview; script arguments not in the signature |
| 02 Tessera (visual) | 9 | 8 | 1 (write verbs still overlap, 25 tools) | 0 | three script calls with arguments absent from the catalogue; replay of preview tokens unspecified |
| 03 Parapet | 8 | 8 | 0 | 0 | undo set contradicts itself; three shapes for one approval event; tape still refuses on partial progress |
| 04 Plinth | 8 | 7 | 0 | 1 (prompt-injection defence, accepted as a limitation) | stale-base beat contradicts the commit algorithm; approval-held Changes have no MCP path; `lineage.dependents` not in catalogue |
| 05 Lodestar | 8 | 8 | 0 | 0 | takeover refused by any later human edit to the same entity; script denial shape drifts from the catalogue |
| 06 Tessera (agent) | 9 | 8 | 1 (F.5 measured with a scripted client plus a separate model run) | 0 | grant path has three overlapping rules; self-approval by the delegator; answer read from a filtered label |

---

## Proposal 01: Fathom (Systems Complexity)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Depth | 20% | 8 | Tree CRDT, IR with unit algebra, Cedar with owner ceiling, per-request evaluation, HLC log, histogram IVM with retraction (cut 2). Engineering depth is the largest in the set. Most of it is still invisible in the script. |
| Composability | 20% | 8 | Registry generates UI, HTTP, CLI and MCP; the surface is now three plan verbs plus typed operation kinds, so a new kind needs no tool. Composition map (B.2) and the plan-as-only-write rule are real. |
| Agent / MCP | 15% | 7 | Round-1 gaps closed: `change.undo` exists, `plan.preview` covers all mutating kinds, `stale_base` is an error with `mergePreview`, names are camelCase and generated, `query.run` has defaults. Held back by approval-in-preview (weakness 1) and script arguments outside the signatures (weakness 3). |
| Visual | 15% | 6 | Presence badge, focus highlight, locked link, merge chip, approval card and a live wall. Solid, not spectacular. The visual mandate was explicitly rebutted in §Revision log B-8. |
| Credibility | 10% | 7 | Replay now gated on watermarks and checkpoints exclude wall time (C.3). Claims in §F are testable and say what they do not prove. The approval-in-preview contradiction is the kind of error an expert finds in the first read. |
| Narrative | 10% | 7 | Final 30 s is a kill during a committed write, `replayed: true`, and an audit verify. Engineers will value it. It is shown mostly as a status line and terminal text. |
| Feasibility | 5% | 3 | Rust core (CRDT, IR, Cedar, IVM), DuckDB, Redpanda or MSK, MinIO with Object Lock, Keycloak or Cognito, Playwright. Dependency order (H.4) and an ordered cut list (H.6) are good. Breadth is still the largest in the set. |
| Reliability | 5% | 4 | Fallback now has per-step preconditions and named outputs (C.3). Still depends on an admin-only `feed.until` operation to move the clock, and the recovery when the live feed is already past a recorded watermark is not specified. |

Weighted total: 6.9 / 10 (round 1: 6.7).

**Agent-only buildability.** Plausible for the board, the drill-down and the alert. The "why" answer is data-driven (attribution with a dominance verdict and a no-cause control), which is the strongest answer to the brief's "AI magic" objection. The approval path works only if the agent learns that a grant needs `approval.request` from the schema description, which is discoverable.

**Fallback is the real MCP path?** Yes. Calls go through `plan.preview`/`plan.commit`, and `feed.until` is an admin-only operation gated by `FATHOM_DEMO=1` and kept out of the agent catalogue (C.3, §E.4).

### Strongest ideas

- **Per-operation verdicts inside a plan** (D.8 `plan.preview`): `authz.verdicts` with `grantIds` lets an agent repair the exact op that was refused. This is the right unit for multi-op plans.
- **One write protocol with two named exemptions**, enforced at registration. `approval.resolve` is human-only, and `ui.focus` is the only presentation call. This is the cleanest statement of the preview rule in the set.
- **`change.undo` as a plan** (D.7, D.8). Undo returns a dry-run plan and refuses with the blocking revision named. It is a tool the agent can call, not a UI convention.
- **Rehearsal-recorded calls checked against the registry** (C.3, "recording fails if any recorded tool name or argument shape does not validate"). This makes tape drift a build failure rather than a stage surprise.
- **Watermark-gated replay with checkpoints that exclude wall time and revision ids** (C.3, §D.7 audit digest). This answers round-1 weakness 2 directly.
- **Live `alert.test` with a state trace** (C.1 235–270 s). The agent backtests before creating.

### Concrete weaknesses (most severe first)

1. **Approval is created inside a preview.** C.1 235–270 step 4: `plan.preview` with `approval.request {…}` "creates an approval and a workflow instance `grant-review` in state `waiting_approval`." A preview that writes state breaks the rule the proposal states in D.8 principle 2 and the plan lifecycle ("a plan is a server-side object"). The 270–300 beat already commits an `approval.request` through `plan.commit`, so the script contradicts itself. This is on the 235–270 beat the audience sees.
2. **Script arguments that the signatures do not accept.** C.1 245: `query.run {"groupBy":["warehouse","dock"],"window":"14:05–14:20","watermarkAtLeast":"14:20"}`. The D.8 signature is `query.run(query, binding?, limit?, watermarkAtLeast?)`; `groupBy` and `window` are not parameters, and the IR carries them inside `query`. C.3 says recording fails on any argument-shape drift, so as written the recording step would reject the script's own call. The fix is to move the grouping into the IR argument and regenerate the script's calls.
3. **Fallback can start on a feed that is already past the recorded watermark.** C.3 "Feed gating": replay advances the feed to each recorded watermark with `feed.until`. The live feed runs at 10 scenario seconds per real second, so a switch late in a step can find the feed past the recorded watermark. The proposal does not say whether replay refuses, waits, or proceeds, and it does not say what the audience sees. The switch is specified as "one keystroke", so this case is live.
4. **The `schema.describe {kind:"plan"}` budget is the discovery path for every operation kind, and it is 64 KB with explicit truncation** (D.8). Truncation has no paging rule. An agent that needs the `workflow.start` shape after the first 64 KB gets nothing further and must guess. Round-1 asked for budgets; the budget exists but the continuation does not.
5. **`ui.focus` in `bind` mode is callable by the agent without a plan.** D.8 exempts it from plans and rate-limits it to one call per three seconds. In `bind` mode it rebinds every readable session (C.1 165–205 uses the human form). The proposal does not cap the number of sessions a single call may rebind, and the audit entry for a bind by an agent is not described.
6. **Default `query.run` limit is 1,000 rows** (D.8). That is five times the agent defaults in 04, 05 and 06, and about 16 KB of JSON per call in the typical row shape. No measurement or token budget is given. The default should follow the agent's context cost rather than the human UI's.
7. **The no-prompt criterion is outcome-only and does not fix the call budget or model.** H.7 and the closing of §F say "the outcome predicates of §C.1 hold in at least eight runs" in ten resets. There is no stated model version, no maximum number of retries, and no rule for a run that succeeds with a wrong but valid board. Round-1 asked for a pre-registered pass criterion; the criterion exists but leaves the important variables open.
8. **Naming is now consistent, but the tape's dependence on it is unchecked for the one call that matters most.** The script's `planId` and `idempotencyKey` match the catalogue. The `query.run` drift in weakness 2 shows the generation step is not actually run on the script.

### Required changes

- Remove `approval.request` from `plan.preview`. Show the approval as a committed plan in 235–270, as the 270–300 beat already does.
- Regenerate every script call from the catalogue, including `query.run`, and make the drift check fail the build on the 245 call as written.
- Specify the replay rule when the live feed has passed the recorded watermark (refuse, wait, or proceed with a disclosed watermark), and show that outcome on the wall.
- Add paging to `schema.describe` and state the continuation token.
- Cap the sessions a single `ui.focus` bind can reach, and specify the audit entry for an agent bind.
- Lower the agent default for `query.run` to 200 rows, matching the other proposals, and state a token budget.
- Pre-register the model version, the retry allowance and the wrong-but-valid rule for the no-prompt run.

---

## Proposal 02: Tessera (Visual Spectacle)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Depth | 20% | 7 | Persistence model is explicit (revision triggers, `audit_chain` lock per workspace, anchors signed with KMS keys, `call_log` separate from the chain). Honest about what is not built. Depth is spread across many subsystems rather than concentrated on one hard claim. |
| Composability | 20% | 7 | 49 primitives with a composition map and three named compositions (session parameter, preview-commit-revision-event, call-log-replay). The MCP surface is now 25 tools with overlapping write verbs, which weakens "one path". |
| Agent / MCP | 15% | 7 | Round-1 items fixed: `VALIDATION_PREVIEW_REQUIRED` for agents, idempotency defaulted to the preview digest, `screen.present` rate limited, one commit path, E1 pre-registered. Held back by script calls that are not in the catalogue (weakness 1) and by replay of single-use tokens being unspecified (weakness 2). |
| Visual | 15% | 9 | The strongest visual design in the set. Animation is tied to sequence numbers only, the ghost overlay precedes commit, the trace ribbon labels every call, and parameter changes are visibly distinct from revisions. |
| Credibility | 10% | 7 | Claim 5 is narrowed to documents, revisions and simulator fields, and explicitly excludes panel results. The replay re-issue claim still depends on response hashes that include principal- and revision-bearing digests. |
| Narrative | 10% | 8 | Strong arc: propose, commit, investigate, share through approval, refusal, copy, recovery, then the session re-issued into a blank workspace with counters. The R13 close is an engineer's moment. |
| Feasibility | 5% | 5 | TypeScript end to end, one charting library, one database. Scope still includes Cedar WASM in Node, DuckDB Node bindings with Arrow and Postgres attach, KMS signing, a signed global anchor, Redpanda and MSK parity. |
| Reliability | 5% | 6 | Per-step satisfaction replaces the hash guard, the slack pool is explicit, and reconciliation reverts only the agent's own revisions. The 8 s silence trigger on a live model is short enough to fire on normal thinking time (weakness 5). |

Weighted total: 7.25 / 10 (round 1: 6.95).

**Agent-only buildability.** The R1 board is buildable from descriptions if the agent knows the TDS panel and query shapes. The error envelope gives `valid_values` and a suggestion, which is good. The R6 investigation requires RFC 6902 pointer operations into a map-keyed `/panels`, which a general agent gets wrong more often than typed verbs would. E1 measures this, which is the right instinct.

**Fallback is the real MCP path?** Yes, as a `driver` principal with the agent's scopes, issuing recorded calls (M08, D.9). Privilege calls are re-evaluated and held (D.10 step 4). Replay of response hashes is the part not yet specified (weakness 2).

### Strongest ideas

- **Mandatory preview token for agent writes**, with commit as the only commit path (D.8), and idempotency defaulted from the preview digest. An agent cannot skip preview and a retried commit returns the first response.
- **Per-step satisfaction takeover that resumes a partly progressed row** (D.9). This is the right fix for the hash-equality guard, and it is stated as a rule with a slack pool.
- **Replay re-evaluates privileges and holds them** (D.10 step 4, M02). Grant, policy and principal events are excluded from replay, so a replay cannot copy a human approval. The R13 counter reports "privilege step held (not re-granted)".
- **Call log kept off the audit chain** (D.7, W9). Reads are recorded without contending for the workspace lock, and writes, refusals and approvals take it. The separation is the right one.
- **Pure session-state parameters with no revision** (D.12). Brushing and drill-down change a view, not a document, and the ribbon says so.
- **`screen.present` authority requires display scope and read on the target** (D.6), and the call is rate limited per screen and per principal.

### Concrete weaknesses (most severe first)

1. **Several script calls do not match the catalogue.** R5 calls `audit.query {since:"10m", source:"carrier.status"}` (02 line 234); the catalogue signature has no `source` argument (line 621). R11 calls `dashboard.create {workspace, title, from_revision:{object, rev}}` (line 240); the signature is `{workspace, name, tds?, branch?}` (line 627) and has no `from_revision`, which is also the copy primitive P12. R8 merges the investigation with `dashboard.apply` (line 237), while the catalogue has `branch.merge` (line 634) for exactly that. The replay (D.10) pins recorded arguments, so the mismatch reaches the replay claim.
2. **Replay of single-use preview tokens is not specified.** D.10 step 3 re-issues each recorded call with arguments rewritten by the rebinding table. A recorded `commit {preview_token}` carries a 128-bit token that is single-use and expires after 10 minutes (lines 364–375, 605). The replay must obtain a fresh preview to commit, but the document does not say that replay previews first, and it does not say how a preview response hash can match across workspaces when the preview digest covers `principal, workspace, object, base_rev, ops` (line 371). Claim 5 ("each response hash matches") is therefore not supported for write responses.
3. **The catalogue has 25 tools and eleven write verbs** (lines 614–644). `dashboard.create` and `dashboard.apply` overlap, `annotate` is a separate write path for something a dashboard operation can do, and `revision.revert` and `branch.create` overlap undo. Round-1 asked for one verb per kind of change. The revision removed panel verbs and kept the rest, and E1 will measure the surface agents actually face.
4. **RFC 6902 pointer operations are the agent's write language for dashboards** (line 628). The agent must produce `/panels/{id}`, `/panel_order/-` and `/params/{name}` from memory. Round-1 flagged this as the error-prone case. The `valid_values` envelope recovers from a wrong name but not from a wrong structure, and E1 allows two errors per run.
5. **The silence trigger is shorter than normal model thinking time.** D.9 and the failure table: "an unmet predicate with no call in flight for 8 s." A live model composing a 20-field TDS document can exceed 8 s without a call. The proposal states no takeover rate and sets the trigger from the budget, not from measured model latency. On stage this produces avoidable takeovers, which the audience will read as the model failing.
6. **An unapproved agent proposal appears on the shared wall.** R1 puts a "ghost overlay ... proposed, not committed" on `wall-left` with no human click. It is labelled, and it is not a commit, but it is agent content on an audience surface with no gate. Round-1 raised this exact class of issue for 06, which the revision fixed by queueing proposals.
7. **Presenter as the sole approver, without comment.** R9 is the only human commit in the script and it is the presenter's click on screen P. The grant is "human-only" and signed with a fresh session, which is real, but the proposal does not state four-eyes or label the approver as the presenter, which 06 does.
8. **The stall rule and the 15 s row budgets interact with the fallback's slack.** Each takeover is charged 8 s from the 30 s pool (D.9), so three takeovers consume the pool. The script's own budgets sum to 270 s, so the slack pool is the only margin, and the proposal does not say what happens to rows after the pool is empty except that screen P "says so".

### Required changes

- Make every script call match the catalogue: add `source` to `audit.query` or drop it from R5; add `from_revision` to `dashboard.create` (or use `dashboard.create` plus `branch.create`); replace `dashboard.apply` in R8 with `branch.merge`.
- Specify replay's token handling: replay issues a fresh preview for each recorded commit, rebinds the token, and hashes responses after removing principal- and revision-bearing digests. Restate claim 5 accordingly.
- Collapse the write surface: one creation verb, one change verb, one commit, one undo, and one merge. Show the count in the catalogue.
- Offer a typed panel verb for the common case (add a panel of a given visual type) and keep pointer ops as the escape hatch, so E1 measures the typed path.
- Set the silence trigger from measured p95 model latency per turn, not from the budget.
- Queue agent proposals for the wall the same way 06 does.
- Label the approver as the presenter and state the four-eyes option.

---

## Proposal 03: Parapet (Enterprise Platform)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Depth | 20% | 7 | Cedar and Postgres RLS generated from one bundle, `SET LOCAL` principal context, dense commit-ordered sequence from a counter lock, approvals bound to a plan hash, undo as a batch inverse plan. Governance depth is the strongest in the set. |
| Composability | 20% | 7 | One command layer and one change log serve governance, workflows and screens. But 25 tools with ten kind-specific `.plan` verbs (lines 571–582) is the surface round-1 asked to reduce. |
| Agent / MCP | 15% | 8 | Best governance contract: policy-filtered discovery, `as` as a narrowing intersection, denials with no restricted values, `permission.propose` as propose-only, `PLAN_ALREADY_APPLIED`, egress closed, a tool registry that pins names and schema hashes, and a pre-registered held-out agent evaluation (F.6). Held back by three different shapes for one approval event (weakness 2). |
| Visual | 15% | 6 | Wall, lock-wait graph, latency heatmap, denied slot and activity rail. Round-1 "visually empty refusal" is fixed, but the visual is still table-and-card with two panel kinds added. |
| Credibility | 10% | 7 | Undo scope contradicts itself about a grant (weakness 1). Otherwise the claims are precise and the tests named. |
| Narrative | 10% | 7 | Five prompts, a conflict beat, an agent refused by the same policy as Brice, and a closing undo in the agent's own session. The "same policy as humans" arc works. |
| Feasibility | 5% | 5 | One database engine, one language, Cedar in-process. Still wide: RLS generator, query compiler with masks, OIDC with two issuers, CDK, headless Chromium. Ordered cut list with claims affected (H.6) is good. |
| Reliability | 5% | 5 | The tape refuses on any exact-state precondition mismatch, so the most likely partial-progress failure ends the show (weakness 3). Good watchdog thresholds and a visible "driver-authored" label. |

Weighted total: 6.8 / 10 (round 1: 6.8).

**Agent-only buildability.** High for the policy-filtered parts. `parapet.discover` and `source.describe` return only what the agent may use, and the errors give did-you-mean. The agent-side burden is the per-kind `.plan` verbs, which means choosing among ten tools whose names differ only by kind. F.6's held-out tasks are the right test, and they are pre-registered with a pass criterion.

**Fallback is the real MCP path?** Yes. The tape runs as `agent:claude-code` with `on_behalf_of: user:brice`, not as a privileged account (D.8 fallback, C fallback "Execution"). Its weakness is the recovery rule, not the path.

### Strongest ideas

- **Policy-filtered discovery** (`parapet.discover`, `source.describe` shows only visible columns). The agent cannot ask for what would be refused, and hidden columns do not appear in the catalogue.
- **`POLICY_DENIED` returns the policy id and no restricted values**, with a test (`denial.indistinguishable`) asserting that hidden and absent columns get the same response body apart from the echoed name (F.1).
- **`as` as a narrowing operator** (D.6): effective rights are `ceiling(agent) ∩ rights(P)`, and an `as` outside the ceiling is refused and audited with both principals.
- **`permission.propose` creates a request and no tool resolves it** (D.8). The approval boundary is a missing tool rather than a convention.
- **`PLAN_ALREADY_APPLIED`** (D.8): a plan applies at most once even under a second key.
- **Held-out agent evaluation with a hard zero-violation criterion** (F.6): 20 tasks, pass at 16, zero writes outside the ceiling, every refusal reported by policy id.

### Concrete weaknesses (most severe first)

1. **The undo set contradicts itself on the grant.** C 245–300 s says "The grant to `sre` and the drill-down are not in the undo set, and the audit view shows them as still applied." The revision log (line 51) says the grant "is created by the agent, not approved by Brice, so it is in the undo set." The 245–300 s row asks for "the finance board and the alert changes", so the script's behaviour is defensible, but the document's own account of the grant is wrong. An expert who reads both will ask which is the rule.
2. **One approval event, three shapes.** The external alert in 160–200 s returns `POLICY_DENIED` with `approval_required` and an `approval_request_id` (line 241). The error table says `APPROVAL_REQUIRED` means "permitted after approval" (line 649), and the `PlanResult` type carries `approval_request_id` as a normal result when a decision is `approval_required` (line 586). The agent cannot tell from the schema whether to read an error or a plan result, and the reply text in the script depends on it.
3. **The tape refuses on any mismatch of an exact state hash, so partial progress ends the show.** C fallback "Preconditions are exact" (line 255) and "Refusal" (line 259): "If a precondition fails, the tape stops before the step's first call … reset required." A live agent that has written part of a step has changed the normalised state, so the most likely failure of a live model is the one the tape cannot survive. Round-1 raised this for 02 and 06; 02 and 06 now resume by satisfaction, and 03 does not.
4. **Ten kind-specific write verbs plus `permission.propose` and `plan.apply`** (lines 571–582). The proposal says "one write path per kind", which is correct for the commit path, but the agent's choice surface is per kind. The `.plan` verbs differ only in the argument schema. Round-1 weakness 6 asked for this to be consolidated; 01 did, and 03 kept it.
5. **The presenter is both the delegator and the approver, and the approval is shown as a control.** The principal table lists Brice as an eligible approver because he is in `security` (line 219), and the 200–215 s step has Brice approve the agent's external notification (line 242). Brice is the human the agent acts for, so the approval proves that Brice agreed to his own agent's request. The claim "refused by the same policy as humans" survives, but "a person approved" is weaker than the script suggests. Four-eyes is not discussed.
6. **`as: group:finance` uses a group where the principal type is defined.** The 160–200 s query (line 241) passes `as: group:finance`. D.6 defines `as` over a principal `P` and `ceiling(agent) ∩ rights(P)`, and groups are not principals in the table. The behaviour is probably intended, but the argument form is undefined.
7. **Query preview has a maximum but no default row limit.** `query.preview` has `limit?: number /* <=200 */` (line 547) with no default stated, and the resource and schema budgets are given in bytes (lines 518–529). Agents should have a stated default.
8. **The F.6 task set is committed but not described.** The pass criterion is strong and pre-registered, but the 20 tasks themselves are referred to, not listed in the proposal, so the reviewer cannot judge whether they are representative of the demo's surface.

Minor: the title block still says "revision 1" on a revised file (line 1).

### Required changes

- Make the undo set statement consistent: state whether an agent-created grant is in the undo set, and make C 245–300 and the revision log say the same thing.
- Pick one shape for approval-required outcomes. Recommended: `.plan` returns a `PlanResult` with `decision: approval_required` and an `approval_request_id`, and `plan.apply` returns `APPROVAL_REQUIRED` only when applied early.
- Replace the tape's exact-hash precondition with per-step satisfaction, as 02 and 06 do, and state the partial-progress rule.
- Consolidate the `.plan` verbs into one `plan` verb with a typed kind argument, or justify the ten verbs with the E1-style evidence that agents choose them correctly.
- Either add a second approver for the external-notification step or label the approval as delegator self-approval on the card, as 06 does.
- Define `as` over groups explicitly or change the script to a principal.
- Set a default `limit` for `query.preview`, and list the 20 F.6 tasks in an appendix.

---

## Proposal 04: Plinth (Emergent Composition)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Depth | 20% | 7 | One compiler with injected predicates before every operator, workspace head lock, principal-scoped idempotency with request hash, cancellation rule resolved by idempotency lookup, path-level merge. Honest about the absence of IVM and the threads=1 replay condition. |
| Composability | 20% | 9 | Fourteen generic verbs over one grammar; audit and lineage are queryable sources; every write is a Change. The closing composition is built from the lineage, orders and audit sources without a feature written for it. Strongest composition argument in the set. |
| Agent / MCP | 15% | 8 | Round-1 items fixed: `node.undo` and `node.delete` have previews, `grant.check` takes a `proposed` grant with counts, budgets on `source.list` and `schema.describe`, cost-weighted rate units, `require_preview` for agents, a 13-question gate with composition questions. Held back by the stale-base contradiction (weakness 1) and an approval path with no MCP representation (weakness 2). |
| Visual | 15% | 7 | Ops board, Rules strip with backtest sparkline, Exec and Phone windows, heatmap, timeline, conflict banner. Clear and disciplined. Fewer distinct spectacle moments than 02 or 06. |
| Credibility | 10% | 8 | Watermarks excluded from hashes with the trade stated, `as_of` pinning explained, rounding to six significant digits, the RLS differential test, and "not claimed under a live agent" written plainly (§F, G.5). |
| Narrative | 10% | 8 | The closing is the agent's blast-radius answer in the final 30 s, and the human tap moved to 262 s. Round-1 closing complaint is fixed. |
| Feasibility | 5% | 5 | TypeScript end to end, DuckDB Node, Redis, Kafka or Redpanda, Keycloak and Cognito, Playwright, S0 to S12 ordered with named tests. Still broad but dependency-ordered. |
| Reliability | 5% | 6 | Driver resumes from any step boundary by checking change hashes; cancellation before the commit transaction is resolved by idempotency lookup. The stall budgets are short (12 s query, 20 s multi-call) for a live model. |

Weighted total: 7.6 / 10 (round 1: 7.5).

**Agent-only buildability.** Good. The 14-verb grammar is discoverable through `schema.describe` with 8 KB and 16 KB budgets, examples, visual channels and effects. The gate tests exactly the agent-only case. The one gap is that approval-held writes are not visible to the agent (weakness 2).

**Fallback is the real MCP path?** Yes. Replay uses the MCP and HTTP paths, with replay keys namespaced by transcript and step (D.6), and it checks change hashes before re-issuing a commit (C.3). Human steps are issued as Changes with `surface: driver`, which is a provenance issue (weakness 4).

### Strongest ideas

- **Fourteen generic verbs with budgets and a gate** (D.7, claim 5). The gate is written before the surface freezes and the composition questions are a separate threshold.
- **`node.preview` returns effective principal, owner, lineage delta, effects and a backtest** (D.7 tool 7). The agent sees what a rule will do before it exists.
- **Cost-weighted rate units** (D.9): queries 5, previews 2, commits 3, reads 1. A runaway loop is bounded in a way the agent can plan around, and the trace shows the cost.
- **Preview token consumed inside the commit transaction** (D.6 step 3). Concurrent commits with one token yield one winner, and the failure codes are split by cause.
- **`grant.check` with `proposed` and `with_counts`** (tool 13). The before and after row counts for a grant that does not exist yet, computed without writing it. This replaces an undefined tool with a defined one.
- **Audit and lineage as ordinary sources** (B.4 G1, L7). "Who changed the board in the last ten minutes?" and "what depends on this field?" are queries, not features.

### Concrete weaknesses (most severe first)

1. **The stale-base beat contradicts the commit algorithm.** C.2 165–195 s: the agent holds, the presenter edits the title to r+1, and "the agent then submits one Change with base r and two ops … The engine finds the title path touched by both, rejects the Change with `CONFLICT`." Under the commit steps, an agent Change must carry a preview token (D.7 tool 8, "mandatory"). Step 3 of D.6 then fails a token whose base revisions no longer match with `PREVIEW_STALE` (line 458), before the merge rule in step 4 runs. D.8 says a stale base returns `PREVIEW_STALE` (line 541). The merge rule is therefore unreachable for agent principals. The beat the audience sees, with `CONFLICT` and a rebased width, is specified by a path that does not exist. This is the central multi-author moment, so it has to be fixed in the algorithm, not only in the script.
2. **An approval-held Change has no MCP representation.** The grant in 135–165 s is "a Change held for approval (G8)" (line 207, §D.5). `node.commit` returns `{change_seq, result_revision, merged_from?, replayed?}` (line 500), with no approval id or status, and no tool reads approvals. The agent cannot report that it is waiting, cannot fetch the state, and cannot tell a held Change from a failed one. Round-1 asked for an approval representation in the catalogue. The gap is the same as 03's before its revision.
3. **`lineage.dependents` is called but not in the catalogue.** C.2 270–300 (line 213): "`lineage.dependents(source="orders", field="fulfilled_at")`" is named as a call. D.7 defines 14 tools (lines 497–514) and no lineage verb. Lineage is described as "queryable as a source", so the call should be a `query.run` over a lineage source, whose name, fields and budget are not given. This is the closing beat's first call, and the 300 s close is the one the proposal calls strongest.
4. **Driver-issued human steps carry `surface: driver` in the audit row.** C.3 (line 241): "Human steps are performed as Changes through the HTTP API under the presenter's session, with surface `driver` in the audit row." So the presenter's own title edit and Acknowledge tap appear in replayed runs as driver actions. `change_hash` excludes surface (line 471), so the hash does not reveal it either. The audit row is accurate about the transport but inaccurate about the surface a human used, which is a credibility problem for an audit-centred demo.
5. **`ui.present` has no rate limit and changes what an audience screen shows.** D.7 tool 14 (line 512) is "the only call that changes what a screen shows without a Change." The per-tool cost table (D.9, line 545) lists queries, previews, commits and reads, and does not cover `ui.present`. Round-1 asked for this for 02 and the same concern applies here.
6. **The closing needs a lineage schema the agent has not been shown.** The E1-style gate (claim 5) covers ten single-kind questions and three composition questions: rule plus action, form plus source plus workflow, grant plus predicate plus panel. The closing question is lineage plus orders plus audit plus workflow transitions in one panel. None of the gate's questions exercises lineage as a source, so the closing's most important ingredient is not measured by the gate that freezes the surface.
7. **The stall budgets are short for a live model.** D.8 and C.3: a query step over 12 s or a multi-call step over 20 s switches to replay (line 235). A live model composing a 6-call step can exceed 20 s without any fault, so takeovers will occur at normal latency. The rate of takeovers is not stated.
8. **Pass criterion is per model version, and the proposal says so.** G.5 and claim 5 say pass rates vary by model version and report every run. The freeze criterion is therefore a statement about one model. This is honest, but the proposal should state which model version the gate was run against when it freezes the surface.

### Required changes

- Fix the commit algorithm for the stale-base case: either a stale-base token triggers a server-side rebase and returns `CONFLICT` with the head values (so the merge rule is reachable), or the beat is rewritten as `PREVIEW_STALE` followed by a re-preview. Update D.6, D.8 and C.2 together.
- Add an approval status to the catalogue: `node.commit` returns `approval_id` and `status: held`, and a read tool returns approval state. Remove the "wait" from the agent's flow or describe its observable state.
- Replace `lineage.dependents(...)` with a `query.run` over a named lineage source, and add that source to the gate's composition questions.
- Record the surface as the human's client (`ui`) with `driver` in a separate field, so the audit row says what happened.
- Add a rate limit for `ui.present`.
- Set takeover budgets from measured per-step latency, and report the takeover rate in the rehearsal table.
- State the model version the surface freeze was run against.

---

## Proposal 05: Lodestar (Live Operational Resilience)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Depth | 20% | 7 | Real faults through Toxiproxy in both environments, PromQL and LogQL subset compilers with conformance tests, a single `expected_version` conflict mechanism, approvals as rows bound to a definition hash, derived alert bounds (31 s and 47 s). Good depth, mostly applied rather than novel. |
| Composability | 20% | 7 | Incident, alert, annotation, workflow, approval and action compose through typed references. The undo and version rules keep composition honest. The stage exercises about twenty of the primitives, which the proposal states. |
| Agent / MCP | 15% | 7 | Strong surface: 17 tools, `untrusted_text` on every data string, the validator never coerces, `suggestion` as a machine-applicable op, `E_VERSION_CONFLICT` with a three-way diff, `apply` with no rebase, principal from token only, fault console absent from the agent's list. Held back by the takeover interaction (weakness 1) and naming drift in the denial shape (weakness 2). |
| Visual | 15% | 7 | Status grid, incident board with annotations, log stream, a masked table, toasts and an approval card. Clear and grounded in real signals. Not spectacle. |
| Credibility | 10% | 8 | Real processes behind the faults, one fault mechanism in both environments, conformance tests named, honest about Logs Insights latency. The derived bounds are labelled as derived. |
| Narrative | 10% | 8 | Fault, investigation, fail-fast, approval, change review, undo, then a masked customer table built from the outage's own data. Tight and causal. |
| Feasibility | 5% | 5 | Node-only platform, Toxiproxy, VictoriaMetrics, Loki, Dex, k6, a fleet adapter for Docker and ECS, and a conformance suite across two backends. Dependency order is explicit and each step has a done-when. |
| Reliability | 5% | 4 | The fallback refuses takeover whenever a later human edit touched the same entity, which the script makes likely at 135–165 s. A live fault makes every rehearsal depend on the Docker and Toxiproxy path. |

Weighted total: 6.95 / 10 (round 1: 7.0).

**Agent-only buildability.** Good. The primitives guide is generated from the registry, `describe_kind` gives an example and common mistakes, and `plan` returns per-op authz with grant ids. The agent can build the incident board from descriptions. The weakness is that the fallback does not work from the same state a human has changed.

**Fallback is the real MCP path?** Yes, with a documented undo-based takeover that the human cannot disturb (C.4 steps 5 to 7). That property is the problem: a takeover that is refused by ordinary human edits is not a fallback in the situation it is for.

### Strongest ideas

- **`plan` returns authz per op with the grant id** (D.8 `authz.per_op`, verified by the 165–185 s denial). The agent can repair the exact op that was refused.
- **Machine-applicable suggestions and no silent coercion** (D.8 validation). `{op: move, from, to}` is a fix the agent can apply without re-deriving the path, and a wrong field name stays visible.
- **`untrusted_text` on every string from a data store, whatever its field name** (D.8 "Untrusted data"). The structural answer to injection that does not rely on the model.
- **One conflict mechanism, `expected_version`, with a three-way diff** (D.5). Round-1 raised two mechanisms, and the revision removed one.
- **Principal taken only from the token, and the fault console absent from the agent's tool list** (D.8, A.2). The agent cannot choose a principal or see a route to fault injection.
- **Undo restricted to the caller's own changes** (D.7). A takeover cannot invert a human's work by construction.

### Concrete weaknesses (most severe first)

1. **Takeover is refused by a later human edit to the same entity, which the script makes likely.** D.7 and C.4 step 6: the driver undoes the agent's changes after the checkpoint, "each with the `expected_version` of the entity after that change," and "if any undo is refused with `E_VERSION_CONFLICT`, takeover at that checkpoint is refused." In the script the agent creates `incident-0142` at 55–110 s (line 265), and Cass moves a panel on that same board at 135–165 s (line 267). Any takeover after 135 s must undo the agent's earlier creation or panel change on an entity whose version has since advanced, so takeover is refused at every later checkpoint. Claim 4's second case (line 815) states this as the intended behaviour ("the driver waits for the next checkpoint"), but the next checkpoint has the same problem. The fallback is therefore unavailable on the very board the audience watches. This is the most important MCP-path defect in the round-2 set.
2. **Naming drift in the plan result.** Script line 268: "The plan returns `authz.denied[0] = {op_index: 0, code: E_FORBIDDEN_WORKSPACE, grant_id, message}`." The catalogue returns `authz: { allowed, per_op: [{op_index, allowed, grant_id?, code?, message?}] }` (line 650). The script's `denied` array does not exist. The tape pins names, so the recording would fail on this call, and the audience reads a shape the platform does not return.
3. **The rule for scope `run` and `workflow_run` is correct, but the eval's `tools/list` claim conflicts with grant filtering.** §B.5 and C.1 say `tools/list` shows "only tools the principal can use at all", while claim 5 (line 823) asserts the agent's `tools/list` "equals the seventeen-tool catalogue." If the agent holds all seventeen, both hold; if any tool is filtered, the claim fails. The proposal should state which is true for the demo principal.
4. **`branch_diff` is listed under writes** (lines 652–653 under "Writes (4)"). It is a read and should count as one. The count of 17 is still right, but the grouping shows a write surface that is one tool larger than it is.
5. **The `workflow_run` tool has a dry-run mode, but the agent never calls it on stage.** This is fine, but the stated principle that the agent cannot run action-bearing workflows means the only path to an action is a human run. The proposal says so (D.6), and the approval card carries the reset rule, so the design is consistent. It is noted here because the composition claim "the agent composes a reversible control" rests on a path the agent cannot use.
6. **Cancellation of `apply` in flight is not defined.** C.4 step 6 says the driver "cancels the live agent's pending calls." `apply` is transactional and writes the hash-chain segment. The proposal does not say whether MCP cancellation of `apply` after it has begun can leave a partial write or a half-written chain segment. The atomicity claim in D.8 covers apply's transaction, not the cancellation path.
7. **Derived alert bound depends on steady offered load, and the stage's load is a configured quantity.** The 31 s and 47 s worst cases in claim 3 assume "steady offered load to payments during the window" (line 805). The proposal says so. The rehearsal measures the distribution, which is the honest part.

### Required changes

- Change the takeover rule: undo the agent's own changes only when the entity's current version equals the agent's post-change version or when later changes are the agent's own; otherwise, rebase the inverse onto the current entity state as a new change for review, or refuse only the affected entity and continue the other entities. Add a test in which Cass moves a panel on `incident-0142` before a stall and the takeover completes.
- Make the script's denial shape match `authz.per_op`, and regenerate the call text from the catalogue.
- State whether `tools/list` is filtered for the demo principal, and make claim 5 match.
- Move `branch_diff` to the read group.
- State the cancellation semantics of `apply`, including what happens if cancellation arrives after the transaction begins.

---

## Proposal 06: Tessera (Agent-Native Innovation)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Depth | 20% | 6 | Changesets with ops hashes, path-level rebase with an integrity check after merge, undo as an inverse changeset, a locked audit head, a scope grammar with containment and intersection. Good and well-tested in outline; the analytic side is ordinary. |
| Composability | 20% | 7 | 18 generic tools over one changeset pipeline; one path for humans and agents is stated and tested (F.1). The grant path has three overlapping rules (weakness 1), which weakens "one pipeline" for privilege changes. |
| Agent / MCP | 15% | 8 | The most complete agent contract in the set. `change.propose` with no dry-run flag and `rejected` status, `change.commit` idempotent per principal, `next` in every envelope, `untrusted` on every string, a closed A1 to A15 policy table, scope grammar with tests, `LOOP_SUSPECTED`, a model-in-the-loop measurement kept separate from the platform's claims. Held back by overlapping grant rules and the predicate takeover's create collision. |
| Visual | 15% | 8 | Ghost proposal queued until a human click, the war room, conflict card with three choices, split diff, trace ribbon and a one-button on-call page composed by the agent. Strong and well motivated. |
| Credibility | 10% | 7 | Identical-edit rule is now one rule and matches F.4 (round-1 contradiction fixed). The answer key remains in the "why" beat, the approvals are self-approvals, and replay attribution is hidden from the audience. |
| Narrative | 10% | 6 | Clear arc to a rollback. The closing 50 s is approval-driven: the presenter approves the button and the run (250–268 s), and the agent is not acting in the final 30 s. Round-1 praised the closing; the revision moved the agent out of it. |
| Feasibility | 5% | 6 | One language, one database engine, a clear interface list and a dependency-ordered build with the manifest frozen at step 8. The rebase algorithm is original code and is flagged as such. |
| Reliability | 5% | 6 | Predicate-based takeover is the best skip logic in the set, and idempotency keys are recorded per transcript step. The predicate for a created document can collide with the recorded create (weakness 4), and the arming rule depends on when the call-log row is written. |

Weighted total: 6.9 / 10 (round 1: 7.0).

**Agent-only buildability.** Very good for the war room, the threshold and the alert. The agent must know to call `change.propose` and then `change.commit`, and the `next` field steers it there. The grant path is ambiguous across three rules, so an agent working from descriptions could pick either the grant op inside `change.propose` or `access.request`, and the rule table would route both differently (weakness 1).

**Fallback is the real MCP path?** Yes. The driver polls the call log with its own role, issues the same calls, and checks predicates before each step (C.4). The audience cannot see that a replay took place (weakness 5).

### Strongest ideas

- **Propose and commit are one pipeline, with an equality property** (D.4, F.1, G.1). Preview is produced by the same steps and rolled back, so the claim is a property of the code.
- **Closed policy table with one test per row** (D.5.4, F.2). Every agent commit shows its rule ID, and an op matching no row is refused.
- **Scope grammar with containment, intersection and deny precedence, one test per rule** (D.5.5, F.2). The most precise authorisation definition in the set.
- **`propose` idempotent by content and `commit` idempotent per principal, with `IDEMPOTENCY_KEY_REUSED` returning the original changeset** (D.5.6). Retries are safe even when the agent forgets its key.
- **Ghost proposals queued until a human clicks Show** (D.5.3, C.2 30–60 s). Agent content reaches a shared screen only through a human.
- **Predicate-based takeover with a semantic digest used only for final equality** (C.4). Satisfied steps are skipped, and keys are never used to decide what is done.
- **`catalog.describe` filtered by the caller's scopes** (D.5.2). The agent sees only the kinds and verbs it can use.

### Concrete weaknesses (most severe first)

1. **The grant path has three overlapping rules, and the script uses the one the rule table does not route.** D.5.4: A11 routes "`grant` any read, write or show scope on a document" to approval (line 570); A12 refuses "any change to `grants` or delegations" (line 571); D.5.5 gives the agent no `grant` verb; and D.5.2/§D.5.3 provide `tessera.access.request` as the documented route (line 545). The script's 160–185 s step proposes a grant operation inside `change.propose` and reports `awaiting_approval` under A11 (line 245). Under a closed table where "an op matching no row is refused" and rule matching is per op, a `grant` op matches both A11 and A12. One of these must go, and the script must use the surviving path.
2. **The presenter approves every agent route as its own delegator.** The approvals at 135–160 s (line 244), 185–205 s (line 246), 225–250 s (line 248) and the button run at 250–268 s (line 249) are all approved by `brice`, who is the agent's delegator, with four-eyes off (line 244; §D.5.8). The labels say so, and the revision log says so, but a label does not change who approved. The "human in the loop" evidence is one person approving his own agent at every gate. The proposal's own approval rule (§D.5.8: "approver must hold `commit` on its target") does not require a different person.
3. **The "why" beat is answered by a filtered label.** The 80–105 s query is "`query.run ... join audit.events where action=config.change and target=payments.retry.max`" (line 242). The annotation then reads "payments.retry.max 2 to 6 by priya, audit seq 1187" (line 242). The revision log (B, line 39) says "the answer comes from data rather than from one label," and G.5 (line 754) says "the agent's job is to find it by correlation and audit join." The query the script specifies selects the labelled change directly. The control scenario B tests only the absence of a change. The strongest analytical moment therefore reads a label the platform wrote for the demo.
4. **Predicate-based takeover collides with recorded creates.** C.4 issues "the recorded call with its transcript key" for the first unsatisfied step. The war-room step creates `dash_war_payments` with a fixed id (line 240; predicate line 265: `exists(dashboard, {war-room, payments}) and panel_count >= 3`). If the live agent created the dashboard with one or two panels and then stalled, the first unsatisfied step is the recorded `create`, which collides with the existing id. The design gives no rule for a create whose document exists, so the takeover halts at the step where partial progress is most likely.
5. **Replayed actions are attributed to the live agent in the audit trail, and the audience cannot see the difference.** C.4 "Invisibility" (line 275): "Live and replayed paths write the same audit rows, with principal `agent:claude-code` and an attribute `driver=replay` shown only in the presenter console." The proposal sells the audit trail as the honest record. An auditor reading `audit.events` sees `agent:claude-code` in both cases, and the `driver=replay` attribute is in the row but not on the screen. The brief asks that the switch be invisible on screen; it does not ask that the record be ambiguous.
6. **The closing beat has no agent action in its final 30 s.** Line 249–250: "Presenter presses the button … Presenter approves (about 268 s), then types nothing." The final 30 s is an approval, a workflow commit and a simulator response. C.3 claims "final 30 s (strongest moment): the agent's page, with an action button that the presenter approves on screen." The agent composed the page at 225–250 s, but the strongest moment is the presenter's click and the approval. Round-1 praised this closing; the revision moved the agent out of it.
7. **The arming rule depends on when a call-log row is written.** D.5.2 (line 514): "Every tool call writes one `mcp_calls` row (principal, tool, outcome, time)." It does not say whether the row is written at call start or at completion. If at completion, a long read is invisible to the 15 s silence rule until it finishes, which is the case round-1 raised. The proposal should say which.
8. **`change.propose` returns `conflict` for a conflicting edit, but the rule text says valid ops create a `proposed` changeset.** D.5.3 gives the statuses `proposed | conflict | awaiting_approval | rejected`, and "Valid ops create a changeset that expires." Script line 243 shows a `conflict` status from `propose`. Whether a conflicting proposal creates a changeset row that can later be discarded is not stated, and `change.discard` acts on it.
9. **Auto-commit classes and the script disagree on the first dashboard.** Rule A1 is "create dashboard in an agent-delegated team: Auto" (line 560). The 30–60 s proposal is a create dashboard with panels (line 240), and the script then has a human click Commit (line 241). By the rule as written the agent could have auto-committed the create and panels together, or the changeset would have been routed because A3 requires the team to own the dashboard. The rule and the script should say which, because the audience will ask.

### Required changes

- Remove A12's overlap with A11 for grant ops, or remove A11 and route every grant through `access.request`. Use the surviving path in 160–185 s.
- Use a second approver for at least one gate (the security group, as in 03), or label the self-approval on each card and state the four-eyes setting in the script's opening.
- Rewrite the 80–105 s query so it does not select the labelled config change, or add an unlabelled signal (the retry counter's own step change) that the agent must correlate, and make the control scenario require the agent to find or fail to find the cause.
- Define create-when-exists for `change.propose`: convert the recorded create into a per-op comparison and skip ops whose result is already present.
- Put the replay marker in the audit row as a visible field and show it in the audit timeline's replay filter, so an auditor can tell the two apart.
- Move an agent action into the last 30 s, for example the agent proposing the rollback dry-run result and the presenter committing it, so the closing carries the agent thesis.
- State whether `mcp_calls` rows are written at start or completion of each call.
- Reconcile the auto-commit rule with the 30–60 s and 60–80 s script steps.

---

## Comparative section

### Ranking (weighted totals from the tables above)

| Rank | Proposal | Round 2 | Round 1 | Why it sits here |
|---:|---|---:|---:|---|
| 1 | 04 Plinth, Emergent Composition | 7.6 | 7.5 | The best composition argument and the most measurable agent gate. Its stale-base beat contradicts its own commit algorithm and approval-held Changes have no MCP path, both of which are fixable and both sit on the central moments. |
| 2 | 02 Tessera, Visual Spectacle | 7.25 | 6.95 | The best visual design and a mandatory-preview agent path. Its losses are the 25-tool surface, three script calls outside the catalogue, and a replay claim that does not specify single-use token handling. |
| 3 | 05 Lodestar, Live Operational Resilience | 6.95 | 7.0 | The cleanest per-op authz and untrusted-data contract, with real faults. Its fallback refuses takeover after ordinary human edits to the audience's own board, which the script makes likely. |
| 4 | 06 Tessera, Agent-Native Innovation | 6.9 | 7.0 | The strongest agent contract (closed policy table, scope grammar, idempotency, `next`). Its round-2 revisions added a grant-rule overlap, self-approval at every gate, a labelled answer, and a closing with no agent action. Tie with 01 on the total; ranked higher on the agent criterion, which the brief weights at 15%. |
| 5 | 01 Fathom, Systems Complexity | 6.9 | 6.7 | The deepest engineering and the most complete round-1 fixes. Its revisions introduced an approval created inside a preview and script calls that the signatures do not accept. Its feasibility remains the lowest in the set. |
| 6 | 03 Parapet, Enterprise Platform | 6.8 | 6.8 | The best governance contract and the best denial design. Its tape still refuses on any exact-state mismatch, the undo set contradicts itself, and approval outcomes have three shapes. Round 2 is flat because gains on the agent surface were offset by new contradictions. |

No proposal is disqualified. The totals separate within a narrow band (6.8 to 7.6), and most of the band is decided by whether the fallback and the central multi-author moment survive their own rules.

### Cross-cutting findings the brief should act on

1. **Preview and commit are now uniform in five of six proposals.** 01 has one write protocol with two named exemptions. 02 requires `preview_token` for agents. 04 requires a token for agents and covers undo and delete. 05 has plan and apply for every write. 06 has one changeset pipeline. 03 has `.plan` then `plan.apply` but its alert path returns a denial shape for an approval outcome (weakness 2 of 03), so the rule holds on the write path and not on the reply path. The brief should keep the rule "every mutating operation is previewed or refused for agents" and require a test for it.
2. **The takeover contract is still the weakest part of the MCP story, and the failure now sits in different places.** 02 and 06 resume by per-step satisfaction. 01 uses per-step preconditions with named outputs. 04 checks change hashes per step. 03 refuses on any exact-state mismatch. 05 refuses whenever a later human edit touched an entity the agent changed. 06's predicate approach collides with recorded creates. A shared contract should require: satisfaction over current state, no inversion of other principals' work, a rule for creates whose documents exist, and a disclosed data-source substitution if any.
3. **Tool counts have moved toward the brief in some places and away from it in others.** Current counts: 01 has 20, 04 has 14, 05 has 17, 06 has 18, and 02 and 03 each have 25. Round 1 asked for fewer kind-specific write verbs. 01 and 04 went furthest. 02 kept eleven write verbs and 03 kept ten `.plan` verbs, which is the round-1 pattern under new names.
4. **Agent-path evaluation is now pre-registered in all six**, with different strength. 03 (held-out tasks, zero-violation rule), 04 (13 questions with a composition threshold) and 06 (model-in-the-loop, reported separately) are the strongest. 02 (E1, 10 runs, 8 of 10) and 01 (8 of 10 resets) are adequate. 05 (median calls reported only) does not pass or fail the surface, and that is weaker than its claim 5 suggests.
5. **Context-window budgets now exist in all six.** Agent defaults for row returns are 200 in 03, 04, 05 and 06, and 1,000 in 01. Schema and resource budgets are stated in bytes in 01, 03 and 04, and the 01 budget of 64 KB is the largest. The brief should set one agent default for rows and one maximum for schema description.
6. **Untrusted data is structural in 04, 05 and 06, and by envelope in 02 and 03.** 01 wraps by a listed field name. Field-name lists are weaker than a wrapper on every string, which is the 05 and 06 design.
7. **Presenter-as-approver remains in 03 and 06, and the approval gate is therefore not independently demonstrated.** 01, 04 and 05 use a different human for the approval beat or a separate approver role. The brief should require a non-delegator approver for at least one gate in any proposal that claims approvals as a control.
8. **The closing beat is agent-absent in 04 (partly), 06 (fully) and, in part, 05.** The brief asks that the agent be the actor in the final 30 s. 01, 02 and 03 keep the agent in or near the close; 01's close is a kill and retry rather than an agent-composed artifact, which is a different and defensible strongest moment.

### Ideas worth keeping regardless of who wins

- **From 01:** per-operation verdicts with grant ids inside a plan; `change.undo` returning a dry-run plan with the blocking revision named; a single write protocol with exemptions registered and enforced at agent registration; recording that fails on any argument drift from the registry; watermark-gated replay with checkpoints that exclude wall time.
- **From 02:** mandatory preview tokens for agent writes with idempotency defaulted from the preview digest; per-step satisfaction takeover that resumes partial rows; replay that re-evaluates privileges and holds them; a call log kept off the audit chain; session parameters that never create revisions.
- **From 03:** policy-filtered discovery; denials that name the policy and carry no restricted values, with a test that hidden and absent columns look the same; `as` as an intersection rather than a switch; `permission.propose` as propose-only with no resolving tool; plan application at most once; a tool registry that pins names and schema hashes.
- **From 04:** cost-weighted rate units; `node.preview` returning effective principal, owner, effects and a backtest; `grant.check` with a proposed grant and before and after counts; resource subscriptions; a pass-rate gate with composition questions written before the surface freezes.
- **From 05:** `authz` per op with grant ids; suggestions as machine-applicable operations; a validator that never coerces; an untrusted wrapper on every data string regardless of field name; the principal taken only from the token; the fault console absent from the agent's tool list; undo limited to the caller's own changes.
- **From 06:** a single propose-and-commit pipeline with an equality test; a closed policy table with one test per row; a scope grammar with containment and intersection tests; idempotent propose by content and idempotent commit per principal; proposals on shared screens only after a human click; predicate-based takeover with a semantic digest used for final equality only; `next` in every envelope; `LOOP_SUSPECTED` after repeated identical refusals.
