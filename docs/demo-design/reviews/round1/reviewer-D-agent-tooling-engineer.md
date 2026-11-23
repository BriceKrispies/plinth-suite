# Reviewer D: Agent and MCP Tooling Engineer, round 1

Scope: the six proposals in `docs/demo-design/proposals/` (01 to 06), read in full against the mission brief `00-mission.md`. Design review only. Nothing was built or run, and nothing under `_superseded/` was read.

Lens: the MCP server as an agent-facing product. The questions are tool granularity and count, schema quality, discoverability, whether a general agent with only the tool descriptions could build the claimed UI, self-correcting errors, preview, commit, idempotency and undo, context-window cost, how generated UI is represented and validated, scoped identity and audit, prompt-injection exposure, and whether the fallback is genuinely the MCP path.

Weights follow the brief: depth 20, composability 20, agent 15, visual 15, credibility 10, narrative 10, feasibility 5, reliability 5. Weighted totals are computed from the integer scores below.

Disqualification check (brief's four criteria): none of the six is disqualified. No proposal embeds an LLM in the platform. Each has a fallback that issues real MCP calls, so none depends on the live agent. Each names a local and an AWS path built from the same images, and the differences are documented. The weaknesses below are serious, but none is fake functionality or a deployment incompatibility.

---

## Proposal 01: Fathom (Systems Complexity)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Depth | 20% | 8 | Spec-tree CRDT with fractional indices and moves, typed query IR with unit algebra, Cedar plus RLS rewrite, histogram IVM with retraction, HLC op log. Deep, but most of it is never visible in the script. |
| Composability | 20% | 8 | The composition map (B.2) and the single operation registry that generates UI, HTTP, CLI and MCP are the strongest argument in the set. The MCP catalogue undercuts it: kind-specific verbs and no undo tool (see weaknesses 1, 4). |
| Agent / MCP | 15% | 6 | Good plan objects with per-op `authz.denied`, `scope_exceeds_owner` with evidence, and did-you-mean errors. Undercut by missing undo, preview not uniform, a prompt given to the agent by name, and naming drift between script and catalogue. |
| Visual | 15% | 6 | `ui.focus` highlight, presence badge, conflict chip and a live Ops wall are sound. Few distinctive visuals; much of the value sits in the terminal text. |
| Credibility | 10% | 7 | Specific and internally detailed. An expert would catch the replay-determinism claim (weakness 2), which is contradicted by the running feed. |
| Narrative | 10% | 7 | Nine beats with a clear arc. The closing "undo" beat depends on a tool the spec does not define. |
| Feasibility | 5% | 3 | Rust core (CRDT, IR, Cedar, IVM), DuckDB, Redpanda/MSK, MinIO/S3 Object Lock, Keycloak/Cognito, Playwright. The document names the CRDT as its largest risk. Feasibility is expressed in dependency order (H.4), which is correct, but the breadth is very large. |
| Reliability | 5% | 3 | The feed runs at 10 simulated seconds per real second (C.0), so the throttle lands about 30 real seconds into the window. A replay started later reads different data, and a mid-script stall has no state-satisfaction path. |

Weighted total: 6.7 / 10.

### Strongest ideas

- **Operation registry as the single source of surfaces (D.8, B.2).** UI, HTTP, CLI and MCP are generated from one definition, so surface parity is structural rather than promised.
- **Plan returns a per-op authorization verdict (D.8, `plan`/`spec.preview`).** `authz.denied[{op_index, code, grant_id}]` lets an agent repair the exact op that was refused, and it is the right unit for a multi-op plan.
- **Owner-ceiling evaluated per request (D.6).** The agent's effective rights are the intersection of its scope and the owner's current grants, so revoking the owner's grant takes effect at the next call rather than at token expiry. The claim is testable (Claim 2 in F).
- **`alert.test` with a state trace (C.1, 255–270 s row).** The agent backtests an alert before creating it, and the result is a replay of the state machine, not a guess.
- **`ui.focus` as a registry operation with audit and rate limit (D.8).** Pointing screens at an object is treated as a permissioned, audited primitive, which is the right framing for "things can show on the screen".
- **Attribution as a deterministic query (`attribution.run`, C.1 120–165 s row).** The "why" answer is a decomposition with a named method, not prose.

### Concrete weaknesses (most severe first)

1. **Undo is absent from the MCP catalogue, but the closing beat depends on it.** D.7 defines undo as a principal-scoped inverse, and the 285–300 s row calls `change.undo({change_id})` once per agent change. The D.8 catalogue lists only `spec.revert`, with no `undo` and no `change.undo`. The strongest moment in the script is a call the spec does not define. The 245–270 s row also uses `undo` where the catalogue has `spec.revert`.
2. **The determinism claim for replay is contradicted by the live feed.** C.0 says the feed advances at 10 simulated seconds per real second. C.3 says replay "reproduces the same spec state and the same panel values" and that latency is "the platform's latency". A `query.run` over 13:50–14:20 returns different values once more data arrives, unless the window is frozen or the clock is paused. Neither is specified. The fallback therefore cannot promise identical panel values at the 14:05 step.
3. **The preview contract is not uniform, and the catalogue shows it.** D.8 principle 2 says "every mutating tool has a preview variant". The signatures contradict that. Only `metric.define` is marked "preview-capable". `alert.create`, `panel.create`, `annotation.create`, `link.create`, `control.bind`, `dashboard.create`, `acl.grant` and `workflow.start` take no plan. An agent can mutate through them without a dry run.
4. **Fallback takeover does not handle partial live progress.** C.3 says the replay "starts at the current step" and that a divergence "stops the replay and reports the step". There is no check of whether a live step already committed some of its calls, so a stall after a partial step ends in a stop with no recovery path, in the middle of the audience's view. Re-binding "plan ids and revision ids by name, not by value" is asserted without a naming scheme. Compare 06, which skips steps already satisfied by digest.
5. **The prompt crutch is given to the agent.** D.8 says `build-board` and `investigate-spike` are "given to the demo's agent by name". The brief forbids bespoke prompting as a crutch. H.6 defers the decisive test to rehearsal and does not pre-register a pass criterion.
6. **Kind-specific verbs contradict the design principle.** D.8 principle 1 says "few verbs, typed kinds", and claims a new kind is usable "without a new tool". The catalogue has about ten kind-specific write verbs (`metric.define`, `alert.create`, `annotation.create`, `link.create`, `control.bind`, `dashboard.create`, `panel.create`, `acl.grant`, `workflow.start`, `workflow.signal`). Either the principle or the catalogue has to change.
7. **`spec.commit` returns `stale_base` as data.** D.8 says "Commit does not fail: it returns `stale_base` with a three-way merge preview", but `stale_base` is listed among the error codes. An agent that treats error codes as failures and a client that treats the response as success will disagree.
8. **Naming drift between the script and the catalogue.** The script uses `plan_id`, `expected_base_rev`, `idempotency_key` and `from_template`. The catalogue uses `planId`, `expectedBaseRev`, `idempotencyKey` and `fromTemplate`, and it uses `object` where the script uses `node`. The fallback tape binds by these names, so a mismatch breaks the replay.
9. **Scripted calls that the catalogue lacks.** `task.hold` (270–300 s) does not appear anywhere in the catalogue. `audit.search` is called with `session:"current"`, which is not in its signature.
10. **Merge approval is a UI convention, not a tool-level gate.** C.1 (70–120 s row) says `branch.merge` runs "after the presenter approves in the UI". The catalogue gives no approval route or refusal code for `branch.merge` when called by an agent.
11. **Context-window cost is unbounded in places.** `query.run` has `limit?` with no default stated. `schema.describe` returns a full JSON Schema, examples and invariants with no size budget. Neither is measured.

### Required changes

- Add `change.undo` (or `undo`) to the catalogue with a dry-run variant, and make the 245–270 s and 285–300 s rows use it. Remove `task.hold` or define it.
- Define a replay clock policy: pause the feed, or pin every script query to a closed window with a watermark, and state which one. Otherwise drop the claim that panel values match.
- Make every mutating tool preview-capable, or list the exemptions and make the agent's registration refuse them. Mark each tool in the catalogue with its preview and approval status.
- Replace the tape's "start at current step" with state-satisfaction checks per step, as 06 does, and specify the name-binding scheme.
- Remove `build-board` and `investigate-spike` from the demo agent. Pre-register a pass criterion for the no-prompt run.
- Choose one naming convention (snake or camel) for the catalogue and the script, and generate the script's calls from the catalogue.
- Define `stale_base` as an error code with a merge-preview payload, and say so in the description.
- Give `branch.merge` an agent refusal or approval code, and say which principal may merge.
- Give `query.run`, `schema.describe` and `source.list` default limits and a size budget.

---

## Proposal 02: Tessera (Visual Spectacle)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Depth | 20% | 7 | Typed TDS documents, path-level three-way rebase, Cedar with explanations, checkpoint-hash replay into a blank workspace. The design is honest about its simplifications (no IVM, no CRDT for dashboards). |
| Composability | 20% | 7 | The 45-row inventory and the two composition edges (query to panel to parameter to query; agent write to revision to audit to realtime) are clear. The MCP surface has overlapping write paths (weakness 5), which weakens the "same primitives everywhere" argument. |
| Agent / MCP | 15% | 6 | The Composition Trace ribbon and the `next` envelope are good. Undermined by optional preview on every write, JSON-Pointer patching, optional idempotency keys, and a replay tool that can re-apply human approvals. |
| Visual | 15% | 9 | The strongest visual design of the six. Animation is tied to sequence numbers, ghost previews, a multi-screen wall, a phone-width session, and a live trace ribbon. |
| Credibility | 10% | 6 | Several claims overreach: the replay re-applies approvals (weakness 2), and the fallback guard is more fragile than described (weakness 3). |
| Narrative | 10% | 8 | Strong five-minute arc: the audit-replay rebuild in the final 30 s is a clear closing moment that uses only stored revisions. |
| Feasibility | 5% | 5 | TypeScript end to end reduces cross-language cost. The scope still includes WebGL stream rendering, Cedar WASM in Node, Kafka, Redis, a Kinesis path that is not exercised locally, and Yjs for comments. |
| Reliability | 5% | 5 | Takeover at row boundaries after a window plus 20 s. A stalled live agent that has already committed part of a row fails the driver's hash guard and stops the demo. |

Weighted total: 6.95 / 10.

### Strongest ideas

- **Composition Trace ribbon (C conventions, C.2 timeline).** Every MCP call, its status, its revision and its audit sequence number are on screen. Transparency about what the agent did is built into the wall, not added as a caption.
- **Animation tied to sequence numbers only (V07, principle in section 1).** Nothing animates on a timer that is not a commit, a sample or a gesture. This makes the spectacle reproducible and is the right rule for an expert audience.
- **Replay into a blank workspace with checkpoint hashes (M06, D.7).** It shows the audit log is sufficient to rebuild state. The strongest moment in the set.
- **`x-tessera-hint` per schema property and the `next` envelope field (D.8).** Both steer a general agent toward the next valid call without a prompt.
- **`layout` as a pure function shared by preview and browser (D.2).** It makes "preview equals commit" testable for the visual layer, which no other proposal states.
- **Explicit refusal of a `driver` principal that shares no authority beyond the agent's scopes (M08).** The fallback is labelled in the presenter console only, which is honest without distracting the audience.

### Concrete weaknesses (most severe first)

1. **Preview is optional for agent writes.** D.8 says write tools "all accept `dry_run`" and "all return either a committed result or a `preview_token`". Commit is the default. Nothing requires a preview for agent principals, unlike 04's `require_preview`. This breaks the "preview is the commit" claim (F.1) on the agent path.
2. **Session replay re-applies human approvals and grants.** M06 and D.7 replay "human actions as their recorded revisions" into `target_workspace`. The 225–240 s approval, which is a grant decision, is part of the session's stored revisions. Nothing excludes `grant_approve` or policy-changing events from replay. An agent holding replay scope could copy a privileged human decision into another workspace under its own session. This needs an explicit rule, and a test.
3. **The fallback's own guard defeats the fallback in the common stall.** C "Where the fallback takes over" says the driver checks that the current workspace hash matches the transcript checkpoint, and stops with a reset prompt if not. A live agent that stalls after issuing one or more real commits of a row has changed the hash. The guard then trips, which is the most likely failure, and the demo stops. There is no satisfied-step logic. The row-boundary rule also adds up to a window plus 20 seconds of silence per row, inside a 300 s choreography.
4. **RFC 6902 patch ops for agent writes contradict the stated design.** `tessera.dashboard.apply` takes JSON-Pointer ops, and the D.4 example uses `/panels/-` (array append) and `/panels/errors` (map key). G "Implementation difficulties" says panels are keyed by `id` in a map to avoid index ops, but the D.2 example stores `panels` as an array. The agent is therefore asked to know the storage shape, which is the error-prone case the typed kinds were meant to remove.
5. **Overlapping write paths.** The catalogue has `dashboard.create`, `dashboard.apply`, `panel.create`, `panel.update`, `panel.delete`, `query.define`, `commit` and `revision.revert`, which overlap in effect. The agent must choose between typed panel verbs and generic patch ops for the same change. The brief asks for a small rigorous core, and this surface is not one.
6. **Idempotency is optional on writes.** D.8 gives every write tool `idempotency_key?`. The claim that idempotency protects retries depends on the caller supplying it. An agent that retries after a dropped response without a key can duplicate the commit. 01 and 04 require the key on commit.
7. **No rate limit on `screen.present`.** An agent can move the wall repeatedly, and the rate table in D.8 does not cover this tool. 01 rate-limits `ui.focus` at one call per three seconds for exactly this reason.
8. **No evaluation of an unaided agent.** Claims 1 to 5 test platform properties. None tests whether a general model, given only tool descriptions, produces the ops-board sequence. The script assumes the calls.
9. **Narrow fallback scope for mid-row stalls.** The 150–180 s row commits several revisions on one branch. The driver's per-row checkpoint is one hash after the last commit of the row, so a partial row cannot be resumed; this is the same root cause as weakness 3.

### Required changes

- Make preview mandatory for agent principals. Commit must reference a preview token, and a commit without one returns an error with a call-to-action, as 04 does.
- Exclude `grant_approve`, policy and principal events from `session.replay`, and add a test that replaying a session with approvals produces an unapproved target.
- Replace the hash-equality guard with per-step satisfaction checks, so a partly progressed row resumes. Reduce the row-boundary wait and state its bound.
- Choose either typed panel verbs or generic ops for layout changes, and remove the other from the agent's surface. Fix the `/panels` storage shape so the example and the design agree.
- Require `idempotency_key` on every write, and default to a key derived from the plan or changeset hash, as 06's propose does.
- Rate-limit `screen.present`.
- Pre-register a no-prompt agent evaluation with a pass criterion, as 04 does.

---

## Proposal 03: Parapet (Enterprise Platform)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Depth | 20% | 7 | Cedar plus Postgres RLS driven from one bundle, `SET LOCAL` principal context, command layer with plan hash, hash-chained change log, approvals as `forbid` with routes. Governance depth is strong; the analytic side is thinner. |
| Composability | 20% | 7 | 48 primitives on one command layer and one change log. The composition claim holds for governance. Two commit paths and an out-of-band token issuer weaken it (weaknesses 1, 2). |
| Agent / MCP | 15% | 7 | Policy-filtered discovery, `POLICY_DENIED` without restricted values, `permission.propose` as propose-only, per-request ceiling min(agent, delegator), plan applied once. Undercut by `mode:"commit"`, the `as` argument, and token minting without a preview. |
| Visual | 15% | 6 | Wall, screens, presence, approval cards and an audit view. Fewer visual moments than 02 or 04; the refusal beat draws nothing (weakness 6). |
| Credibility | 10% | 8 | Governance story is precise and checkable; the double-enforcement drift risk is named and has a test (F.1). |
| Narrative | 10% | 7 | Seven beats, with a clear "agent is refused by the same policy as humans" arc. The refusal beat is visually empty. |
| Feasibility | 5% | 5 | One database engine, one language, Cedar in-process. Still wide: RLS generator, query compiler with masks, OIDC on two issuers, CDK, headless Chromium. |
| Reliability | 5% | 6 | Fault seeded before start, with reset refusing to report ready without it. The tape's preconditions are explicit. The tape text typed into the terminal is a credibility risk (weakness 4). |

Weighted total: 6.8 / 10.

### Strongest ideas

- **Policy-filtered discovery (`parapet.discover`, D.8).** Capabilities the caller cannot use do not appear, so the agent cannot ask for something that will be refused. This is the cleanest answer to "discoverability versus governance" in the set.
- **Per-request ceiling intersection (D.6, B.2 row 9).** Effective rights are min(agent registration, delegator's current rights, action policy), and the agent cannot read its own grants except through `who.am_i`.
- **`POLICY_DENIED` carries no restricted values (D.8).** The refusal can be explained without leaking the data it protects. Few proposals state this rule.
- **`permission.propose` as propose-only, with no tool that resolves approvals (D.8).** The approval boundary is a missing tool, not a convention.
- **Plan applied once (`PLAN_ALREADY_APPLIED`, D.8 Idempotency).** Stronger than key-only idempotency: a plan cannot be replayed under a second key.
- **Egress closed by default, with external notification requiring approval (D.8, D.6).** The agent cannot choose an external destination.

### Concrete weaknesses (most severe first)

1. **Two commit paths, and the contract is contradicted.** B.1 row 41 says "Commit requires the plan ID and an idempotency key". D.8 gives every write tool `mode: "preview" | "commit"` and returns `PlanOrChange`, whose commit branch takes no plan ID. `dashboard.apply` takes `plan_id`. An agent can therefore commit in one call and skip the preview that the table promises.
2. **`embed.token.create` mints an external credential with no preview, approval or agent exclusion.** D.8 returns a bearer token directly. D.6 excludes only `admin` and `approve` for agents, so `share` remains available, and nothing in the spec blocks the agent from minting an embed token for a dashboard.
3. **The `as` argument on `query.preview` and `query.run` needs a rule.** D.8 gives both an optional `as` principal. The script (200–235 s) uses it to show the finance view. The spec does not say that `as` may only narrow to the caller's ceiling, so the argument is an impersonation surface until that rule is stated and tested.
4. **The tape types recorded agent text into the terminal.** C fallback "Invisibility" says that if the presenter's terminal is shared, the companion types "the recorded agent prompt reply ... using the tape's stored text". That text was not produced by the current run. The same section says the tape "never fabricates an output the platform did not produce". If the terminal narrates a finding that the wall does not show, the experts in the room will see the seam.
5. **Two sources of truth for tool names in the fallback.** `dashboard.plan` and `dashboard.apply` both appear in the script, and `query.save`, `metric.define` and `alert.create` each return `PlanOrChange`. The tape pins names, and the spec does not say which path the recording uses, so a rename or a mode change breaks the tape silently.
6. **The strongest governance beat draws nothing.** At 255–285 s the refusal "draws nothing" and the audit row appears on a Security board that the timeline never shows. The proposal calls this the strongest moment and gives it the least visual weight.
7. **Context cost is only partly bounded.** `query.preview` caps rows at 200, which is good. `schema.describe` and `parapet://spec/v1/schema` return full schemas with `$defs`, examples and invariants, and no budget is stated.
8. **Agent-path evaluation is absent.** F.1 to F.5 test platform properties and the tape's equivalence. None tests whether a general model can build the page from `discover` and the schema.

### Required changes

- Remove `mode: "commit"` from the agent surface, or require a plan ID on it. Reconcile B.1 row 41 with D.8.
- Exclude `embed.token.create` from the agent registration, or route it through approval with a preview. Add a probe to the test suite.
- State that `as` may only narrow to the caller's effective rights, and test that an agent cannot widen through `as`.
- Remove the typed-terminal narration from the companion, or type only text produced by the current run.
- Choose one write path per kind and pin its name in the tape.
- Give the refusal beat a visible result on the wall, such as the denied panel slot with its policy ID.
- Pre-register a no-prompt agent evaluation.

---

## Proposal 04: Tessera (Emergent Composition)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Depth | 20% | 7 | One query compiler with predicates injected before lowering, path-level three-way merge over a log, backtest as a query, DuckDB execution, RLS differential test. Honest about the absence of IVM. |
| Composability | 20% | 9 | The clearest statement that one model, one change log, one compiler and one authorization function carry everything. "Audit is a Source" (B.2 point 3) is a concrete proof of composition. The 15-verb surface is generic by design. |
| Agent / MCP | 15% | 8 | Fifteen generic verbs with `schema.describe` and `source.sample`, `query.explain` showing injected predicates, `require_preview` by default for agents, cost-unit rate limits, resource subscriptions, and a measured agent-path claim (Claim 5). Undercut by `node.undo` and `node.delete` lacking previews, and by `grant.preview` appearing in the script but not in the catalogue. |
| Visual | 15% | 7 | Ops board, heatmap, Rules strip with backtest sparkline, Exec and Phone windows, forms and timelines. Clear, but fewer distinct spectacle moments than 02. |
| Credibility | 10% | 8 | Known limits are listed plainly (G.5), the differential RLS test is well specified, and undo is tested across principals. |
| Narrative | 10% | 7 | Nine beats, with a strong "nobody asked the agent to watch for this" moment. The closing beat is a human tapping a phone, so the agent is not in the final 30 s. |
| Feasibility | 5% | 5 | TypeScript end to end, DuckDB Node binding, Redis, NATS locally and Kinesis on AWS (not exercised locally), Keycloak and Cognito, Playwright. Ordered by dependency in H.4. |
| Reliability | 5% | 6 | Driver tags each call `live` or `replay` in the trace panel, checks expected hashes, and stops on divergence. Idempotency keys derived from step ids allow resume. The 6x virtual clock and DuckDB `threads=1` for replay checks are disclosed. |

Weighted total: 7.5 / 10.

### Strongest ideas

- **Audit as a source (B.2 point 3, C.2 60–100 s row).** "What changed in the last 14:00 window?" is an ordinary query over the same engine. This is the best single demonstration in the set that the platform is one system.
- **`query.explain` shows the injected predicates (D.4, catalogue #7).** The agent and the auditor see exactly what authorization added to the query. This is the right transparency for RLS.
- **Cost-weighted rate units (D.9).** Queries cost five units, previews two, commits three, reads one. Runaway loops are bounded in a way the agent can plan around, and the costs are visible in the trace.
- **`notifications/resources/updated` on subscribed resources (D.7).** An agent holding a dashboard resource sees human changes without polling. No other proposal uses resource subscriptions this way.
- **`require_preview: true` as the agent default, with `preview_token` required on commit (D.7, catalogue #9).** The strongest preview rule in the set for the write path it covers.
- **Measured agent-path claim (Claim 5).** Ten fixed questions, twenty runs each, scored on panel existence, result equality with a reference query, and visual type. It is the only proposal that plans to measure whether a general model can build from descriptions.
- **Driver transparency (C.3).** The trace panel labels every call `live` or `replay`, and the proposal argues that an expert trusts the labelled replay more than an unlabelled one.

### Concrete weaknesses (most severe first)

1. **`node.undo` and `node.delete` are writes with no preview.** Catalogue #10 and #12 take no `preview_token` and have no preview variant. The 200–225 s undo in the script is a direct agent write, which breaks the uniform two-phase rule the proposal advertises for `node.commit`.
2. **`grant.preview` is called in the script but absent from the catalogue.** The 135–170 s row calls `grant.preview(principal, add={row_predicate})` to show the before and after row count. The catalogue has only `grant.check`, and Claim 2 names `grant.preview` as the source of the same count. The demo's central access moment depends on an undefined tool.
3. **The agent-path evaluation tests single-panel questions only.** Claim 5 uses ten questions such as "p95 by region as a bar panel". Composition across kinds (a rule with an action and a form, or a grant with a predicate) is what the proposal claims to enable, and it is not in the evaluation. The 15-verb grammar may be easy for single panels and hard for chained objects.
4. **Generic verbs trade discoverability for breadth, and the proposal concedes it.** G.6's last bullet says the 15-tool design "should be tested with a model, not argued". The test is planned for rehearsal, not pre-registered as a gate for the tool design.
5. **The strongest moment is a human action.** The final 30 s (280–300 s) is an acknowledge tap on the phone. The agent is not in the closing beat, which weakens the "agent builds the composition" thesis for the audience.
6. **Context cost of `source.list` and `schema.describe` is unbounded.** `source.list` returns every source with its full field list and watermark and has no limit. `schema.describe` without `kind` returns all kinds, fields, examples and verbs. Neither has a budget.
7. **Rule ownership and action permissions are ambiguous for agent-created rules.** D.6 says `on_fire` runs as the rule's owner with the owner's grants. The 100–135 s row has the agent create the rule and post to the ops channel. The spec does not say whether the owner is the agent, the human, or the ceiling-intersected principal, so the notify may be refused or may run with human rights.
8. **Prompt injection defence is labelled "not complete".** D.10 says so honestly, and the envelope is advisory. The `contains_untrusted` flag is an after-the-fact audit marker rather than a control.

### Required changes

- Give `node.undo` and `node.delete` a preview variant that returns a `preview_token`, and require it for agent principals, as `node.commit` does.
- Add `grant.preview` to the catalogue, or change the script and Claim 2 to use `grant.check` with a predicate-count field.
- Extend Claim 5 with at least three composition questions (rule plus action, form plus source, grant plus predicate) and pre-register the pass criterion.
- Add default limits and a size budget to `source.list` and `schema.describe`.
- State the owner and effective principal for agent-created rules, and test the notify path under the agent's ceiling.
- Consider a closing beat in which the agent builds the acknowledge form, so the final 30 s carries the agent thesis.

---

## Proposal 05: Lodestar (Live Operational Resilience)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Depth | 20% | 7 | Real processes behind the faults, reset-aware rate semantics, PromQL and LogQL subset compilers with conformance tests, plan/apply with hash chain, alert state machine. Honest about no CRDT. |
| Composability | 20% | 7 | Incident, alert, annotation, workflow, approval and action chain composes through typed references. Undercut by direct writes (`annotate`) and by a revert that reaches beyond the agent's changes. |
| Agent / MCP | 15% | 7 | Plan returns an authz verdict per op with grant id, `E_UNKNOWN_FIELD` carries an executable `move` suggestion, the validator never coerces, rate limits are readable in the discovery resource, the principal comes only from the token, and the registry generates the primitives guide. Undercut by `revert_to` scope, untrusted-data convention, and context cost. |
| Visual | 15% | 7 | Status grid, incident board with annotations, log stream, screens, toasts and a masked table appearing in the same frame as the fault. |
| Credibility | 10% | 8 | Real faults via Docker and Toxiproxy, with the pause mapping stated honestly. SREs will trust it more than a simulated chart. The replay snapshot swap is the weak point (weakness 2). |
| Narrative | 10% | 8 | Tight arc from fault to investigation, approval, undo and masked customers. The closing masked-table beat ties the agent's scope to the live fault. |
| Feasibility | 5% | 5 | Node-only platform, which helps. Still VictoriaMetrics, Loki, Dex or Keycloak, Toxiproxy, a fleet adapter for Docker and ECS, k6, and a conformance suite across 40 queries on two backends. |
| Reliability | 5% | 5 | Measured fault-to-alert latency is a design target, not a result. The replay swaps in snapshot data mid-demo, and the takeover can revert human work (weakness 1). |

Weighted total: 7.0 / 10.

### Strongest ideas

- **Plan returns authorization per op with the grant id (D.8 `plan`).** Denials name the rule that caused them, and the agent can repair the exact op. The `E_FORBIDDEN_WORKSPACE` example in the 145–180 s row shows it working.
- **Suggestions are executable and the validator never coerces (D.8 validation messages).** The suggestion `{op: move, from, to}` is a machine-applicable fix, and refusing silent coercion keeps hallucinated fields visible.
- **Primitives guide generated from the registry (D.8 resources).** The agent reads a page that cannot drift from the code, which is a better answer to discoverability than a hand-written prompt.
- **Principal comes from the token only (D.8 Principal from token).** An MCP client cannot choose another principal in arguments. Simple, and testable.
- **The fault console is absent from the agent's tool list (D.8 Deliberately absent).** The agent cannot see a route to fault injection, which is stronger than a refusal.
- **Eval harness with a median call budget (Claim 5, MCP path).** Ten questions, a checker, a median of twelve or fewer calls, and every validation error resolved within one retry. The number is labelled as measured.

### Concrete weaknesses (most severe first)

1. **The fallback takeover can revert human work.** D.7 defines `revert_to(seq)` as replaying inverse patches for "all changes after `seq` in the workspace branch". C fallback point 4 says the driver calls `lodestar.revert_to(checkpoint_seq)` "if the live agent wrote anything since the checkpoint". Any change after the checkpoint is reverted, including Cass's layout moves and approved runbook steps. The takeover is therefore able to undo a human's change on stage, and the agent also holds `revert_to` in its tool list, with no scope rule that stops it from reverting other principals' work.
2. **The replay swaps the data source under the audience.** C fallback point 3 and the AWS section say that in replay mode the metrics and logs point at a snapshot, and that the source is named `snapshot:rehearsal-<id>` only in explain output. The alert firing and the panel numbers after takeover come from a recording. The MCP path is real, but the data is not the live fleet, and the audience is not told.
3. **Direct writes outside the plan/apply path.** `annotate` takes `{workspace, at, text, refs?, idempotency_key}` and writes immediately. `export` writes a snapshot entity. D.2 says every mutation produces a change row through plan/apply, and the catalogue shows exceptions.
4. **Untrusted-data handling depends on a field-name convention.** D.8 says untrusted text is in fields "whose names end in `_text`". `query` returns positional `rows: unknown[][]` with `columns: string[]`. Log lines and annotation bodies that come back as row values have no field name, so they cannot carry the marker. The "handled by structure, not by asking the model" claim does not hold for query results.
5. **Default query size is large for an agent's context.** D.4 says preview "returns at most 5,000 points by default", configurable to 50,000. That is returned to the model unless the agent asks for less. No summary mode or token budget is defined.
6. **`apply` and `rebase` do not match.** D.8 says a stale plan is refused and "re-plans automatically only if the caller passes `rebase: true`". The `apply` signature has only `plan_id` and `idempotency_key`, so the agent cannot rebase as described.
7. **Workflow run is not covered by the agent's scope grammar.** D.6 gives the agent `workflow (create only)`. The catalogue includes `workflow_run`, and the scope grammar has no run verb. Either the tool is unscoped, or the scope is incomplete.
8. **Tool count is inconsistent.** B.5 and C preamble say "twenty tools". The catalogue lists twenty-one.

### Required changes

- Restrict `revert_to` to the caller's own changes, or make it a dry-run-only tool for agents. Add a test in which the takeover runs after a human change and the human change survives.
- Disclose the snapshot mode on the audience screen, or do not use a snapshot for live panels during takeover. Either way, state it in the trace.
- Route `annotate` and `export` through plan/apply, or list them as explicit exceptions with their own refusal rules.
- Make the untrusted marker structural: return each row as an object with named fields, and wrap every string-typed value in an untrusted envelope.
- Lower the default `query` point limit for agents, and add a summary mode.
- Add `rebase` to `apply`, or remove the sentence that describes it.
- Add a workflow run verb to the scope grammar and state which workflows an agent may run.
- Correct the tool count to match the catalogue.

---

## Proposal 06: Tessera (Agent-Native Innovation)

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Depth | 20% | 6 | Changesets with a digest, rebase on disjoint paths, undo as an inverse changeset, a QIR with predicates applied at compile time, alert backtests. Solid, and clear about its limits, but the analytic depth is ordinary. |
| Composability | 20% | 7 | 48-row inventory and the living-rollback composition (Action plus Workflow plus Approval plus Undo) is a good example. One write path for humans and agents is stated and tested (F.1). |
| Agent / MCP | 15% | 8 | The most complete agent contract in the set: `catalog.describe` filtered by scope, `next` naming the single most likely call, `untrusted` wrappers on every string, `IDEMPOTENCY_KEY_REUSED` returning the original changeset, propose idempotent by content, token refresh only while the delegation holds, and a 40-probe escalation test. Undercut by a contradiction in the conflict rule, an undefined auto-commit policy, and a muddled `dry_run`. |
| Visual | 15% | 8 | Ghost overlay of a proposal on the wall, approval cards, a split diff, a trace ribbon, and a one-button rollback page built by the agent. |
| Credibility | 10% | 7 | Preview equals commit by one code path is a checkable claim. The identical-edit conflict in the script contradicts the same proposal's rebase rule (weakness 1). |
| Narrative | 10% | 7 | Clear arc from proposal to approval, undo, audit and rollback. The final 30 s depends on an approval that the presenter must perform first. |
| Feasibility | 5% | 6 | One language, one database engine, a clear interface list. The ghost overlay renderer and the Kinesis-only path are the open items. |
| Reliability | 5% | 6 | The driver skips satisfied steps by digest and reuses recorded idempotency keys, which is the best takeover logic in the set. The stall trigger depends on an audit signal that does not exist for a stalled agent (weakness 5). |

Weighted total: 7.0 / 10.

### Strongest ideas

- **Propose and commit are one pipeline with a digest equality test (D.5, F.1).** Preview and commit share code, so the claim is a property of the code. The strongest preview statement in the set.
- **`catalog.describe` filtered by scope (D.5 Discovery).** The agent sees only the kinds, verbs and scopes it can use, so discovery respects authorization without a separate policy surface.
- **`next` field in every envelope (D.5 Tool catalogue).** The server names the most likely next call, which steers a general agent without a prompt, while staying server-generated from schema facts.
- **`untrusted` wrapper on every string from documents, sources and audit rows (D.5 Tool catalogue).** The structural answer to injection that 05 only partly gives.
- **`IDEMPOTENCY_KEY_REUSED` returns the original changeset ID, and propose is idempotent by content (D.5 Idempotency).** Retries are safe even when the agent forgets its key.
- **Token refresh only while the delegation is unrevoked; scope narrowing tested mid-session (D.5, F.2).** Revocation takes effect for the agent without waiting for expiry.
- **Takeover skips satisfied steps by digest and reuses recorded keys (C.4).** Partial live progress is resumed, not stopped, which the other proposals do not handle.

### Concrete weaknesses (most severe first)

1. **The identical-edit case contradicts the conflict rule and the test.** C.2 (100–130 s) says the agent's 600 ms proposal "conflicts with Priya's 600 ms (identical)" and then that identical values "auto-merge, so the card closes". D.4 says overlapping paths yield `conflict`. F.4 asserts "conflicts are reported as `conflict` and never silently merged on overlapping paths". The script shows the forbidden behaviour, so either the rule or the scripted outcome is wrong.
2. **The auto-commit policy is not defined.** C.2 (70–100 s) says the agent may commit "because the change is additive and reversible; see D.5". D.5 does not define additive or reversible, and G.3 repeats "the policy allows auto-commit only for additive, reversible changes" without a classifier. The agent's autonomy is therefore a rule a reviewer cannot test.
3. **`dry_run` on `change.propose` has no distinct meaning.** The parameter defaults to false, and the description says "but always validates". Propose always stores a changeset with an expiry. No non-persisting dry run exists, so the flag is documentation noise and may confuse an agent.
4. **Context cost of `query.run` is high by default.** The catalogue allows `limit` up to 10,000 rows returned inline, and the 5 million scanned-row budget is configured, not measured. No summary or aggregate-only mode is specified for the model's context.
5. **The stall trigger has no signal for a stalled agent.** C.4 says the driver watches the agent's calls through the audit log, and that it fires when "the agent makes no call for 15 seconds". The audit log records changes and refusals, not reads or absences, so an agent that is silent produces no row to watch. The trigger needs an independent clock on the driver side.
6. **Tool count is inconsistent.** D.5 says `tools/list` "returns the 14 tools below", then lists nineteen and says "That is 19 tools." The tape depends on frozen names, so the count has to be right before the tape is recorded.
7. **F.5 measures the server's own fixes, not the agent's self-correction.** A scripted client applies the `fix` object the server authored and retries once. The 50-of-50 result proves the envelope is consistent, not that a model can recover, and the 280-character check is trivial. The claim is presented as a self-correction measure.
8. **The wall shows unapproved agent content.** The ghost card in the 20–45 s row is visible to every screen, and `screen.show` with `mode: "preview"` has no approval gate. The agent can put proposals on the audience wall, limited only by rate.
9. **Field naming drift.** The script's `screen.show` uses `view: {changeset: ...}`, while the catalogue uses `view: {changeset_id}`. Minor, but the tape binds by name.

### Required changes

- Decide the conflict rule for identical values. If identical edits should merge, say so in D.4 and fix F.4. Otherwise change the script.
- Define the auto-commit classifier as a policy rule with named change kinds, and test it.
- Remove `dry_run` from `change.propose`, or make it a true non-persisting validation call.
- Add a summary or aggregate-only mode to `query.run`, and a default row limit for agents.
- Drive the stall trigger from a driver-side clock, and state which audit or transport signal it uses.
- Correct the tool count and freeze names before recording the tape.
- Replace or supplement F.5 with an agent run in which the model, not the scripted client, chooses the fix.
- Require approval, or a human pin, before an agent proposal appears on a shared screen.

---

## Comparative section

### Ranking (weighted totals from the table above)

| Rank | Proposal | Weighted total | Why it sits here |
|---:|---|---:|---|
| 1 | 04 Emergent Composition | 7.5 | The clearest composition argument, the best measured-agent plan, and the strongest driver transparency. Its MCP has two real preview gaps (`node.undo`, `node.delete`) and a missing `grant.preview`, all of which are fixable. |
| 2 | 06 Agent-Native Innovation | 7.0 | The most complete agent contract and the best takeover logic. Its losses are internal consistency: the conflict case, the undefined auto-commit rule, the tool count and an F.5 that measures the server. |
| 3 | 05 Lodestar | 7.0 | Strong agent plan verdicts and real faults. Its takeover can revert human work, and its replay swaps the data source without telling the audience. Those are fixable, but they sit on the demo's central moment. |
| 4 | 02 Visual Spectacle | 6.95 | The best visual design and the best closing beat. Its agent path is weakened by optional preview, a replay that can re-apply approvals, and a fallback guard that trips on partial progress. |
| 5 | 03 Enterprise Platform | 6.8 | The best governance contract (policy-filtered discovery, no-leak denials, per-request ceiling). Two commit paths and a token minted without preview undercut it, and its visual payoff is thin. |
| 6 | 01 Systems Complexity | 6.7 | The deepest engineering and the cleanest composition map, but the MCP surface contradicts its own principles, the closing undo tool is missing, the replay cannot deliver its determinism claim on a running feed, and the spec leans on a prompt the brief rules out. |

### Ideas worth keeping regardless of who wins

- **From 01:** registry-generated surfaces; per-op authorization verdicts inside a plan; `alert.test` as a backtest with a state trace; `ui.focus` as a rate-limited, audited primitive; the principle that the agent's effective rights are re-evaluated against the owner's current grants on every request.
- **From 02:** the Composition Trace ribbon that labels every call with its status, revision and audit sequence; animation driven only by sequence numbers; `x-tessera-hint` on schema properties; a single pure layout function shared by preview and browser; replay into a blank workspace with checkpoint hashes (with approvals excluded).
- **From 03:** policy-filtered discovery; denials that name a policy without revealing restricted values; `permission.propose` as propose-only; plans applied at most once; egress closed by default; a fault that is seeded before the demo starts and checked by reset.
- **From 04:** "audit as a source"; `query.explain` showing the predicates that authorization added; cost-weighted rate units; resource subscriptions with change notifications; `require_preview` as the default for agents; the live/replay tag on every call; a pre-registered measured-agent evaluation.
- **From 05:** plan verdicts with grant ids; suggestions as machine-applicable operations; no silent coercion in the validator; a primitives guide generated from the registry; the principal taken only from the token; the fault console hidden from the agent's tool list.
- **From 06:** `catalog.describe` filtered by scope; the `next` field; `untrusted` wrappers on every string; idempotency-key reuse returning the original result; propose idempotent by content; token refresh only while the delegation holds; takeover that skips satisfied steps by digest.

### Cross-cutting findings the brief should act on

1. **Preview is not uniform in any proposal.** Each has at least one mutating tool with no preview or with an optional one: 01 (eight-plus tools), 02 (`dry_run` optional on every write), 03 (`mode: commit` path), 04 (`node.undo`, `node.delete`), 05 (`annotate`, `export`), 06 (`dry_run` on propose). The brief calls preview and dry-run a primary design concern. A single rule, "every mutating tool has a preview or is refused for agents", should be written into the brief and checked by a test.
2. **Fallback takeover is the weakest part of the MCP story.** Only 06 skips satisfied steps by digest. 02 stops on partial progress. 01 has no state check. 05 can revert human work. 03 types recorded text into the terminal. 04 is the most transparent but does not describe partial-row recovery. A shared takeover contract is needed: per-step satisfaction, no reverting of other principals' work, and an explicit disclosure of any data-source substitution.
3. **Only two proposals test whether a general agent can build the UI.** 04 and 05 plan measured evaluations. 06's F.5 measures the server. 01 defers the decision to rehearsal and uses a prompt. 02 and 03 test platform properties only. The brief's central claim is that a general agent given only the tool descriptions can build substantial UI. Every proposal should carry a pre-registered no-prompt evaluation with a pass criterion.
4. **Context-window cost is not budgeted anywhere.** Default or maximum row returns range from 200 (03, 04) up to 5,000 (05) and 10,000 (06). Resource sizes are not stated. A shared default, such as 50 rows and a summary mode, would remove the variance.
5. **Untrusted data should be structural.** 06's `untrusted` wrapper on every string is the right pattern. 01 and 04 wrap by field or by envelope with opt-in lists, 03 sanitises by rule, and 05's field-name convention does not reach positional rows.
6. **The tool name contract is not frozen in any proposal.** Each script names calls differently from its catalogue (01, 02, 06 at least). A tape cannot be recorded against a moving name set. The brief should require that the catalogue is generated and the script's calls are validated against it.
7. **The agent is often absent from the closing beat.** 04's final 30 s is a human tap, and 06's final 30 s needs the presenter to approve first. The brief asks for the strongest moment to be the platform's own answer. Each proposal should check that the agent is the actor in its last 30 seconds.
8. **Naming collision.** Proposals 02, 04 and 06 all use the product name Tessera. This is a presentation issue for the tournament, not a design flaw, but it should be resolved before the round-2 comparison.
