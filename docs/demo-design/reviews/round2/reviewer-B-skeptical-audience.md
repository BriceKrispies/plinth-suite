# Round 2 review, Reviewer B: skeptical technical audience

Reviewer: B (skeptical technical audience member). Work item WG-5518, round 2.
Scope: `00-mission.md`, the round-1 review of this reviewer (`reviews/round1/reviewer-B-skeptical-audience.md`), and all six revised proposals in `revised/` read in full. `proposals/` was consulted only for comparison where needed. `_superseded/` was not read.
Method: each proposal is read as an expert who expects superficial complexity and "AI magic". For each, the round-1 items are checked against the revised text: fixed, partly fixed, not fixed, or fixed by adding words. Section and script-window references are to the revised files. Quantities are labelled as the proposal labels them (design target, budget, configured, derived, or measured).

Weights from the brief: depth 20, composability 20, agent 15, visual 15, credibility 10, narrative 10, feasibility 5, reliability 5.

Disqualification standard (brief): fake functionality, an LLM inside the platform, a demo that cannot run without the live agent, or incompatible local and cloud deployments. No proposal is disqualified on this reading. The closest cases are noted under each proposal and in the comparative section.

---

## Cross-cutting observations (apply to all six)

1. **Every proposal still has a planted answer.** The round-1 demand was a negative control for any planted cause. Only 01 adds a control on paper (a no-cause workspace and a noise dock), and it is rehearsal-only, not on stage. 04 seeds an episode in history, 06 seeds a config commit at audit sequence 1187, 05 and 02 inject a fault the presenter triggers, 03 stages a reconciliation hold. The disclosure has improved in most (03's "staged" chip, 06's model footer, 04's live/replay tag), but the on-stage finding is still the seeded one.
2. **Live-agent latency is still the largest reliability risk.** Each proposal now states budgets, triggers, or checkpoints. None states a rehearsal-measured takeover rate, and none has one, so every "live" claim remains conditional. The worst cases are 02 (about eight MCP calls inside a 20 s window, with a 30 s slack pool that the spec says is silently overrun) and 06 (about eight agent turns, each subject to a 15 s silence trigger).
3. **Presenter-as-approver and presenter-as-second-user appear in three proposals.** 03 and 06 have the presenter, who is also the agent's delegator, approve the agent's privileged actions, and 06 drives a second human session ("Priya") by hand. These are labelled, which is honest, but a security-literate audience will read it as separation of duties not being shown.
4. **Visual impact has dropped in the revisions.** The round-1 visual complaints were answered in 02 by removing WebGL and ECharts, which reduces spectacle further. Across the set the stage is mostly timeseries, bar, table, stat, KPI and cards.
5. **Stage stacks are still large.** Counts are: 01 six containers plus one process; 04 not profiled; 05 eleven core containers; 03 and 06 not profiled per stage; 02 eight images. None of the proposals demonstrates the stage stack running from one command under load, so the reliability claims rest on the rehearsal that is still to be built.

---

## Proposal 01: Fathom (Systems Complexity)

File: `revised/01-systems-complexity.md` (revision 2, 1,062 lines)

### Round-1 disposition

| Round-1 item | Status in revision | Reviewer note |
|---|---|---|
| 1. Attribution is the planted throttle read back | **Partly fixed.** Noise dock SW-D07 and a no-cause control workspace are added (§B.1 P34, §C.1 120–165, §C.3 step 2). | The control runs only in rehearsal (§C.3 "Rehearsal" item 2). On stage the agent still returns NE-2 and the script still says "expectation confirmed by rehearsal: the top contributor is the throttled dock NE-2" (§C.1 120–165). The answer key is now guarded, not removed. |
| 2. Concurrency beat cannot be cued | **Fixed by removal.** The 205–235 beat is now a disjoint-property merge with a fixed call order. Human-human concurrency is demoted to a property test (§F claim 1, "does not prove"). | Correct, but the stage no longer shows concurrent editing at all. The live CRDT is now invisible to the audience. |
| 3. 270–300 montage has four claims | **Fixed.** Final 30 s is kill, in-flight retry and audit verify (§C.1 270–300). | Good. |
| 4. Self-correction is pre-shaped | **Partly fixed.** The first `alert.create` uses `for`, which is at edit distance three from `hold`, so no `did_you_mean` is produced (§D.3 rule). | The `unknown_field` response still lists `hold` among `valid_alternatives` (§C.1 235–270 step 1), so the recovery is still shaped by the error. The fix is a naming change, not a removal of the hint. |
| 5. Permission story is hard to state | **Fixed.** One sentence and a row-scope finance view (§C.1 235–270 step 6, §D.6). | Clear. |
| 6. Fallback writes a forged agent transcript | **Fixed.** Replayed calls are labelled `[recorded]` (§C.3 "Switch"). | Clear. |
| 7. Stack heavy | **Partly fixed.** A stage profile of six containers and one process (§E.4). | Keycloak, Redpanda, MinIO and Postgres still sit on the stage path, and the wall-hardware figure is still unmeasured (§H.3). |
| 8. Visual mandate thin | **Rebutted in scope** (§C intro, "Spatial or motion spectacle is not pursued"). | Accepted as a choice. The result is a dashboard with a bar, a line, tables and a status line. |

New problems introduced: the stage no longer shows concurrency at all (above); the `[recorded]` label is honest but will prompt the question "why is the agent's live path replayed for 14 calls" in the room.

### Scores

| Criterion (weight) | Score | Justification |
|---|---|---|
| Depth (20%) | 8 | Typed IR with unit algebra and per-request RLS rewrite (§D.4), Cedar policy with an owner ceiling evaluated per request (§D.6), checkpoint-hash replay (§C.3), and a kill-during-commit test with a named property (§F claim 5). Demonstrable on stage: the approval and the `replayed: true` line. Not demonstrable on stage: the CRDT and the attribution control. |
| Composability (20%) | 8 | One operation registry and a composition map where every arrow is a typed reference (§B.2). The count is inflated: 39 "demonstrated" primitives, of which 16 "appear only as a field or effect" (§B.3). A reader who counts the visible elements gets 23. |
| Agent / MCP (15%) | 8 | Plan/apply with the authorization verdict stored inside the plan, `scope_exceeds_owner` with evidence, `stale_base` with a merge preview, and budgets in `session.describe` (§D.8). Weakened by the pre-shaped error (round-1 item 4) and by the lack of a per-turn latency budget (§C.3 has triggers but no windows). |
| Visual (15%) | 5 | Bar, line, tables and a status line. Nothing spatial or animated. The "visible" moments are a merge chip, a locked link and an alert trace, which are text-sized. |
| Credibility (10%) | 7 | Honest shallow list (§G.5) and a real replay design. Credibility is cut by the answer key still on stage and by a demo-only fault point, `commit.hold_after_wal`, compiled into the production binary behind `FATHOM_DEMO_FAULTS` (§E.4). An expert will accept the flag but will ask why the hold is needed. |
| Narrative (10%) | 7 | Clear arc: question, build, merge, why, drill, conflict-free merge, alert, approval, kill. The 235–270 block carries four ideas (schema error, alert, grant refusal, approval) in 35 s. |
| Feasibility (5%) | 4 | Fifteen dependency-ordered steps (§H.4) with an explicit cut list (§H.6), which is the right discipline. The stack touches a CRDT, a typed IR with a unit algebra, Cedar, DuckDB, Redpanda, MinIO, Keycloak and a web client, all on the critical path. |
| Reliability (5%) | 5 | Replay is watermark-gated and checkpointed (§C.3), and the rehearsal criterion is pre-registered (8 of 10 resets, §E last paragraph). The fallback triggers are "no tool call within the step's expected window", which is not a number. |

### Strongest ideas
- The rehearsal checks outcomes against pre-registered predicates, and the replay compares checkpoints at equal watermarks (§C.3, §D.7). This is the most credible replay design in the set.
- `scope_exceeds_owner` is enforced per request against the owner's current grants, not against the agent token (§D.6). The "can the agent escalate" question has a real answer.
- The `kill -9` beat is a falsifiable property with a named test and 20 random kill points (§F claim 5).
- The explicit cut list with the claims each cut narrows (§H.6). Nothing else in the set is this honest about what gets removed first.
- Presence and focus as governed, read-filtered primitives (§B.1 P41, P42).

### Weaknesses (most severe first)
1. **The on-stage cause is still the planted one.** §C.1 120–165 expects the agent to name NE-2 and the attribution to dominate, and states that the expectation is "confirmed by rehearsal". The negative control that would make the finding meaningful (no-cause workspace, §C.3 step 2) runs only in rehearsal and is not shown to the audience. The audience sees a correct answer to a question whose answer was known in advance.
2. **The stage no longer demonstrates concurrency.** The only collaborative beat is now a disjoint-property merge (§C.1 205–235). Round-1 item 2 was answered by removing the risk, and the removed item was the one that made the CRDT visible. Claim 1 is a property test, and §F says it "does not prove the product usage".
3. **Alert self-correction is still pre-shaped.** The `for`/`hold` mismatch is engineered to produce `unknown_field` with a valid-alternatives list that contains the intended key (§C.1 235–270 step 1, §D.3 rule). The recovery the audience sees is the one the error was designed to permit. Round-1 asked for a miss the agent corrects without the hint, or a miss it does not correct; the revision gives neither.
4. **Live-agent takeover is undefined as a rate.** §C.3 triggers are "no tool call within the step's expected window" and "a response that contradicts a recorded checkpoint". No window is given, and no takeover rate is stated (§G.3 has no row for this). The seven agent prompts (P1–P7, §C.0) have no per-prompt model-time window, so the 300 s total is not budgeted anywhere in the spec.
5. **Fault-point code in the product binary.** `commit.hold_after_wal` (§C.1 270–300, §E.4) holds a response after commit to force the kill. It is gated by environment variable, but it is production code that deliberately delays a commit response. A skeptic who reads §E.4 will ask what else is gated by `FATHOM_DEMO_FAULTS`.
6. **Visual impact is the lowest of the six.** §C has no visual element that is not a chart, table or chip. Round-1 item 8 was rebutted on scope grounds, which is defensible, but the audience will judge the wall.
7. **Stage stack and first-run cost.** Six containers and one process run on the presenter machine, and the wall-hardware render time is "measured in rehearsal" with no figure (§H.3). A failure in any of them is a failure on stage, and the spec does not say how the stage profile is validated before the room is filled.
8. **Breadth counted by its own rule.** §B.3 says 39 primitives are demonstrated, 16 of them only as a field. Counting only visible elements gives 23. The composability score uses the honest count, not the headline one.

### Required changes
- Put the negative control on stage, or state on stage that it exists and show its verdict as one card. Remove "confirmed by rehearsal" from the on-stage narration.
- Restore one visible concurrent-edit beat with a deterministic trigger, for example a scripted API write at a fixed point that makes a stale base, so the CRDT is seen rather than only tested.
- Remove `hold` from the `valid_alternatives` for the alert kind in the stage build, or show one miss the agent corrects without the list, and say which in the script.
- Give each agent prompt a model-time window and a takeover rate target, and state where the slack comes from.
- Move `commit.hold_after_wal` out of the product binary (test harness or a separate demo build) or document its exact footprint in §E.4.
- Add one visual element that is spatial or temporal: the attribution contribution by dock over time would serve.

---

## Proposal 02: Tessera (Visual Spectacle)

File: `revised/02-visual-spectacle.md` (revision 2, 937 lines). Product name "Tessera" is shared with 06 (see comparative section).

### Round-1 disposition

| Round-1 item | Status in revision | Reviewer note |
|---|---|---|
| 1. Choreography built on design targets | **Partly fixed.** "Pending 00:42", the 40 s recovery and the 2 s acknowledge are removed (§C, "Budgets"). | The budget table still gives every row a second value (sums to 270 s plus a 30 s slack pool, §C "Budgets"). Labelled as configuration, which is honest, but the script still reads as timed. |
| 2. Replay is a patch replay with a counter that overstates it | **Fixed.** Primary replay re-issues MCP calls with response hashes (§D.10), stored-patch replay is a labelled second view (M09), and the counter reports four separate numbers (§D.10). | Good. |
| 3. Checkpoint count contradicts table | **Fixed.** Eight checkpoints C1–C8, one per checkpoint row (§C). | Good. |
| 4. Inventory marks rows demonstrated that the stage does not show | **Partly fixed.** Demonstrated now means shown on stage (§B). | Still 38 of 49 rows are "demonstrated" (§B footer). Several rows are the same mechanism counted separately (P01–P04). |
| 5. Two agent commit rules | **Fixed.** One rule, stated once (§D.6). | Good. |
| 6. WebGL and three charting stacks | **Fixed.** WebGL and ECharts removed (§D intro, §D "Justification"). | Correct, and it reduces spectacle. See visual score. |
| 7. R10 confusing | **Fixed.** One device, one action (§C R10). | Good. |
| 8. Closing depends on replay scope | **Partly fixed.** Replay is now MCP re-issue. | The closing still depends on a live agent having made the calls in R1 to R12 that the replay reproduces. If the live agent takes over at R1, the replay re-issues a driver's transcript, which the closing text does not say. |

New problems introduced: the "Tessera" name is now shared with 06 and the proposal does not address it (round-1 naming note). The E1 pre-registration says "no recipe prompt" (§F E1), but §D.8 exposes `build-ops-board` and `explain-spike` as MCP prompts. An agent client that lists prompts can use them, so E1 does not measure the surface the demo ships.

### Scores

| Criterion (weight) | Score | Justification |
|---|---|---|
| Depth (20%) | 7 | Revision store with base-rev checks and path-level rebase, a hash-chained log with refusals, and Cedar policy hot-load with signature verification (§D.1, §D.6, §D.7). The depth is real. On stage the visible depth is a ghost overlay and a refusal row. |
| Composability (20%) | 7 | Session parameters are separated from revisions (§D.12), so brushing does not pollute history: a clear composition rule. Inventory is 49 rows with 38 demonstrated, several of them duplicates of one mechanism. |
| Agent / MCP (15%) | 7 | Preview tokens are single use and digest-keyed, commit is the only commit path, errors carry `valid_values` and a suggestion (§D.8). Hurt by the R1 budget (about eight calls in 20 s, §C R1), by the 8 s stall rule (which will trip on most live turns), and by the recipe prompts that E1 excludes. |
| Visual (15%) | 6 | Ghost overlay with a digest and expiry, a phone-width session flipping from 403 to the board, and a replay counter. Stat, bar, table, timeseries and text otherwise, with WebGL and ECharts removed. |
| Credibility (10%) | 7 | Animation tied to sequence numbers (§A) is the best honesty rule in the set. Credibility is cut by the still-timed budgets, by the seeded incident with no control (R5 finding is "carrier DHL and the config version", §C R5), and by a self-approving closing sequence. |
| Narrative (10%) | 7 | Clear five-minute arc with a named strongest moment. R8 bundles three asks into one prompt (merge, grant, workflow), which weakens the arc. |
| Feasibility (5%) | 5 | Thirteen dependency-ordered steps (§H), with the registry and the revision store on the critical path, eight images, and Cedar in WASM under Node as a critical dependency with a named fallback (§H "Critical dependencies"). |
| Reliability (5%) | 4 | Stall rule is 8 s with nothing in flight, and the slack pool is 30 s for the whole script (§C "Where the fallback takes over"). On the R1 budget, the first live turn is likely to be driven by the transcript, and the spec says that once the pool is exhausted "the driver runs the remaining rows and screen P says so", which means the script runs past 300 s without a stated limit. |

### Strongest ideas
- Animation driven only by sequence-numbered events or user gestures, never by timers (§A). The audience can check it by watching the sequence counter.
- Parameters and brushing as session state in the URL, not revisions, with the ribbon showing the difference (§D.12). A clean answer to "does looking at the data change the record".
- The refusal shown as a red trace entry with the policy id, followed by the agent taking an alternative (R10, §C).
- Replay as MCP re-issue with response hashes and a refusal reproduced because authorization precedes resolution (§D.10).
- E1, a pre-registered unaided-agent evaluation with 10 runs and an 8-of-10 criterion (§F E1).

### Weaknesses (most severe first)
1. **Slack pool overrun is silent.** The 30 s pool is charged 8 s per takeover (§C "Where the fallback takes over"). After the pool is exhausted, "the driver runs the remaining rows and screen P says so" (§D.9). The script has no stated maximum duration after that, so the five-minute claim is conditional on how many takeovers the live model triggers.
2. **R1 requires about eight MCP calls in 20 s.** R1 asks for `whoami`, `catalog.search`, `source.describe`, three `query.preview` calls, `query.explain` and `dashboard.create` (§C R1). The 8 s stall rule (§D.9) will fire during any normal model think time between calls, so the live agent is unlikely to be the one that builds the board.
3. **No control for the R5 finding.** The agent names carrier DHL and the config version by grouping and reading lineage (§C R5). There is no no-cause control, and §G's answer to a plausible wrong finding is that "the presenter can correct it with one prompt, which is an annotation" (§G "Agent failure modes"). That defers the question rather than answering it.
4. **Presenter-triggered incident.** The degradation is a key press (`I`) that writes a recorded scenario control (§C R4, §D.11). The causal chain is the simulator's own stream, which is honest. But the audience sees a "make it break" key, and the spec's own limitation says its timing "is not promised".
5. **Agent creates an alerting workflow that pages on-call.** R8 has the agent define `page-oncall-eu` with an action of `webhook:pager-sink` and commit it, along with a grant request and a merge to the live board, in one prompt (§C R8). The commit rule (§D.6) allows agents to create alerts and workflows in scope. An enterprise audience will ask why an agent may create a paging route at all.
6. **E1 does not measure the shipped surface.** §F E1 says "no hints, no recipe prompt", while §D.8 publishes two recipe prompts over MCP. The pre-registration is therefore weaker than it reads.
7. **Visual spectacle is reduced by design.** The round-1 critique was about stacks, and the fix removed the one renderer able to show streaming volume (WebGL, 180 events per second, §D). The result is a dashboard with good honesty and less to look at.
8. **The phone session is still unexplained.** R9 relies on an audience session `user:audience-eu-ops` whose sign-in is not described, and the approval step requires a "fresh OIDC session (max auth age 5 min)" (§D.6) that is not shown in R9. The approval gate is described as a single click.

### Required changes
- Replace the slack-pool wording with a fixed script maximum and a stated behaviour when it is exceeded (for example, the presenter takes over and says so, or the remaining rows are cut and named).
- Move R1 to a sequence the live model can plausibly finish in its window, or give R1 a larger budget and say so.
- Add a no-cause control, either on stage or as a disclosed rehearsal result, and state the attribution answer's dependence on the seeded incident.
- Remove the recipe prompts from the MCP surface for the demo principal, or change E1 to test the surface with them present.
- Show the fresh-session re-authentication in R9, or describe it as a separate step.
- Mark the agent's alert and workflow creation as a stated commit rule exception or move it to an approval step.

---

## Proposal 03: Parapet (Enterprise Platform)

File: `revised/03-enterprise-platform.md` (revision 2, 957 lines; the header still reads "revision 1").

### Round-1 disposition

| Round-1 item | Status in revision | Reviewer note |
|---|---|---|
| 1. 170–200 s race between human retitle and agent apply | **Fixed.** The stale base is deterministic: the agent holds a plan (§C 95–135), the presenter's edit lands in the SRE window (§C 135–160), and apply returns `CONFLICT_REV` with a conflict card. A human chooses the title (§C 135–160, §F claim 2 `held.plan.conflict`). | Strong. The model is no longer choosing a merge. |
| 2. Nine prompts, no latency budget or takeover rate | **Fixed for prompts and budgets.** Five prompts, 45 s per turn, 20 s to first call (§C, §C fallback). | No takeover rate is claimed, which is correct, but the target is not stated either. |
| 3. Brice's roles inconsistent | **Fixed for roles.** One principal table (§C "Principal table"). | Introduces a new contradiction (weakness 1). |
| 4. Maintenance-job lock appears in the change log | **Fixed.** The lock is from real application code in the `payments` reconciliation path, observed by `db.locks` (§A, §B.3 row 18, §G.4). | Strong: the attribution now comes from `pg_locks`, not from a planted row. |
| 5. Fault staged but not disclosed | **Fixed.** "Staged scenario" chip and a staging note (§A, §C Setup). | Good. |
| 6. Visual impact limited | **Partly fixed.** Lock-wait graph and latency heatmap added (§B.4 row 32, §D.9). | Still mostly timeseries, tables and cards. |
| 7. Density over five minutes | **Partly fixed.** Five prompts with per-turn budgets. | The 25–70 s turn is still seven calls plus a plan/apply pair (§C 25–70). |
| 8. Enterprise checklist gaps | **Accepted as limitations** (§G.4). | Honest. |

New problems introduced: the principal contradiction in weakness 1, and the closing undo gap in weakness 3.

### Scores

| Criterion (weight) | Score | Justification |
|---|---|---|
| Depth (20%) | 8 | Cedar decisions with policy ids, RLS with `FORCE ROW LEVEL SECURITY` and a non-owner role (§D.3), masks compiled into projection, `as` narrowing as an intersection of ceiling and rights (§D.6), and a real Postgres lock contention source (§A). Demonstrable on stage: `pg_locks`, the finance count of 412 rows, and the conflict card. |
| Composability (20%) | 7 | The composition map ties identity, policy, RLS, query, metric, alert, workflow and approval (§B.6). Breadth is narrower than 01 or 06, and the undo does not cover grants or drill links, so composition is not fully reversible (weakness 3). |
| Agent / MCP (15%) | 8 | Discovery filtered by principal, `POLICY_DENIED` with policy id and no values, `plan.apply` with `plan_hash`, the tape pinned to registry `schema_hash` (§D.8), and a per-turn budget. Strong contract. |
| Visual (15%) | 6 | Timeseries, stat, table, topology from lineage, a lock-wait graph by backend, and a latency heatmap. Governance moments are cards. |
| Credibility (10%) | 6 | Real lock contention and a tape that refuses on divergence are credible. The principal contradiction (weakness 1) is the kind of inconsistency an expert checks, and the closing claim ("everything reversible") is contradicted by the same row (weakness 3). |
| Narrative (10%) | 7 | Governance arc (who can see, refusal, approval, undo) reads well. Density is still high in the 25–70 s and 160–200 s turns. |
| Feasibility (5%) | 5 | Cedar, Postgres RLS, Keycloak or Cognito, ECS, Aurora, SES, WAF and headless Chromium. The dependency order and cut list (§H.4, §H.6) are explicit. |
| Reliability (5%) | 6 | The conflict is deterministic, the tape refuses to run on diverged state, and the reset refuses to report ready if the hold window is short (§C fallback, §E.4). The watchdog is per turn and the presenter has `F9`. No global slack pool. |

### Strongest ideas
- A real fault from real Postgres lock contention, produced by application code and observed through `pg_locks` (§A "Lock contention is real").
- `query.preview` as another principal, with `412 of 9,812` rows as a row count rather than an assertion (§C 160–200, §F claim 1).
- Approval as a `forbid` decision that names a route and binds to a `plan_hash` (§D.6, §D.8).
- The tape refuses to start on diverged state and says "reset required" (§C fallback "Refusal"). A wrong screen is treated as worse than a pause.
- The equivalence test: live run, tape run and diverged run must produce equal normalised state hashes, with a metric-value exclusion stated (§F claim 5).

### Weaknesses (most severe first)
1. **The refusal is not the one a human would get.** §C 215–245 says "the same refusal Brice would receive from the same query" (principal table note, §C "Principal table"), and §F claim 1 asserts the denials carry the same policy id. But the Cedar rule that produces `policy:hr-comp-restricted` is `forbid (principal is Agent, …)` (§D.6). A human principal is not covered by that rule. Brice's refusal would be a different policy, or none if he has no `hr` grant. The on-stage claim is false as written.
2. **Self-approval of a delegated agent action.** Brice is the agent's delegator (§C "Principal table", `agent:claude-code` on behalf of `user:brice`) and the approver of the external notification, because he is in `security` (§C 200–215). The spec labels him "eligible", but an enterprise audience will see one person approving what their own agent asked to do. There is no four-eyes option described.
3. **The closing line contradicts the closing row.** §C 245–300 ends with "Everything the agent did is attributed, reviewable and reversible". The same row says the grant to `sre` and the drill-down "are not in the undo set" and "the audit view shows them as still applied". The undo is partial, and the spec's own §G.4 says so. A skeptic will quote the closing line against the table.
4. **Race-free conflict depends on the presenter's order of operations.** The deterministic outcome depends on the presenter performing the SRE retitle before clicking "Apply held plan" (§C 135–160, §C "Why the conflict is deterministic"). That is good, but the sequence is a stage instruction, not a platform property.
5. **Live-agent turn budgets without a global slack.** Each agent turn has a 45 s budget and a 30 s closing budget (§C fallback, §C 245–300). With five turns plus presenter speech, the total is not bounded in the spec, and no slack pool is defined.
6. **Two charting libraries.** The web uses Apache ECharts for charts and uPlot for dense time series (§D.1). Round-1 item 6 criticised multiple stacks in 02; the same objection applies here.
7. **Local reader watermark test is trivially true.** §E.3 says the local database has no reader endpoint, so "the watermark rule still runs and its test passes trivially". The AWS-only read path is therefore not exercised locally, and the claim of identical behaviour is partial for that path.
8. **The lock-wait graph is still a planted fault.** The reconciliation path "holds row locks by design" and waits on "a deliberately slow settlement stub" (§A). The source is real, but the cause is engineered. The staging chip discloses this, which is correct, but the attribution answer is not controlled.

### Required changes
- Correct the "same refusal Brice would receive" claim, or make the policy apply to humans as well, and make F.1's same-policy-id assertion true for the rule as written.
- Put a second approver on the external notification (for example a member of `security` who is not the delegator), or show the four-eyes option as on and say why it is off.
- Change the closing line to match the row (undo covers finance and alert, not grants or drill links), or extend the undo set to include the grant.
- Add a global slack or fallback budget for the script and state the behaviour when it is exceeded.
- Remove one of the two charting libraries.

---

## Proposal 04: Plinth (Emergent Composition)

File: `revised/04-emergent-composition.md` (revision 1 header, 800 lines; renamed from Tessera).

### Round-1 disposition

| Round-1 item | Status in revision | Reviewer note |
|---|---|---|
| 1. Closing beat is ordinary CRUD | **Partly fixed.** Closing is now a blast-radius panel composed from lineage, orders and audit (§C 270–300). The acknowledge form moves to 245–262, marked supporting. | The concept is better. The blast-radius answer is a metadata query over the platform's own sources, which an expert will accept as composition, but it is a count, not a new behaviour. |
| 2. "Why" beat returns an empty audit answer and asserts a cause | **Fixed.** The zero-row audit result is shown with its watermark, and the agent may only quote numbers on screen (§C 60–100, Revision log B-2). | Good. |
| 3. Drag-versus-agent race | **Fixed.** Deterministic stale base on an explicit cue (§C 165–195). | The agent's recovery is a model decision (see weakness 2). |
| 4. Agent-path evidence deferred | **Fixed.** Evaluation runs before the surface freezes, with a 13-question gate and a pre-registered threshold (§F claim 5, §H.4 S5). | Honest and well-designed. Its failure would change the demo, which the spec accepts. |
| 5. Inventory inflated | **Fixed.** 38 rows, 28 demonstrated, one row per visual type (§B "Counting rule"). | Better, still high for the number of visible beats. |
| 6. Virtual clock silence | **Partly fixed.** Virtual clock and stall indicator on the presenter console; a G.2 row (§C.3, §G.2). | The 215–245 beat is still "presses F7, says nothing else" (§C.2), so 30 s of wall time may be silent on stage. |
| 7. Cancelled commit unresolved | **Fixed.** Cancellation honoured only before the transaction; idempotency lookup resolves the outcome (§D.6, §C.3). | Good. |
| 8. Name collision | **Fixed.** Renamed to Plinth. | Good. |

New problems introduced: the closing is now a 30 s window with five MCP calls, a preview and a commit (§C 270–300), which exceeds the 20 s "multi-call step" latency budget the spec sets for live steps (§C.3 "How the switch works"). The human steps in fallback are performed as API changes with `surface=driver` (§C.3 "What the driver does not do").

### Scores

| Criterion (weight) | Score | Justification |
|---|---|---|
| Depth (20%) | 7 | Predicate injection before any operator (§D.4), policy-keyed cache with mask and predicate hash (§D.4, `cache_isolation`), backtest using the same compiler (§D.4 "Backtest"), and a differential test including joins and unions (§F claim 2). Real depth, with no incremental maintenance (§G.5), which the spec states. |
| Composability (20%) | 8 | Fourteen generic verbs over typed kinds, audit and lineage as ordinary sources (§B.6 "Metadata is a source"), and a change hash that excludes surface and actor so the same change has one hash across surfaces (§D.6). The strongest composition argument in the set. |
| Agent / MCP (15%) | 7 | Generic verbs with rich errors and `available` lists, the `IDEMPOTENCY_KEY_REUSED` path, and a pre-registered discoverability gate. The live agent's recovery at 165–195 (drops the title op) is a model choice, not a platform guarantee. The gate can fail and change the surface, which the spec accepts. |
| Visual (15%) | 5 | Bar, table, KPI and heatmap are demonstrated; line and area are "supporting" (§B.2 V2). For a time-series operations demo, the absence of a demonstrated line chart is unusual and visible. |
| Credibility (10%) | 7 | §G.6 "features that look more impressive than they are" is an excellent honesty device, and the live/replay tag is a deliberate trust disclosure (§C.3). Credibility is cut by the seeded episode (§A "The 14:05 episode") and by the statement that the driver performs human steps through the API. |
| Narrative (10%) | 6 | The concept builds well (question, why, rule, access, conflict, undo, incident, acknowledge, blast radius), but seven typed prompts and a 30 s final window with five calls leave little room. |
| Feasibility (5%) | 5 | Thirteen stages with a named test per stage (§H.4), and the surface gate placed before the web surface. Critical dependencies (DuckDB Node binding, MCP SDK, Kafka client, Keycloak and Cognito parity) are named with mitigations (§H.2). |
| Reliability (5%) | 4 | Virtual clock at 6x with a 30 s silent wait on stage, a live agent with 12 s and 20 s step budgets, and a closing 30 s window with five calls and a commit. The `stall` row handles the failure but not the silence. |

### Strongest ideas
- Metadata as a source: "who changed this" and "what depends on this field" are queries (§B.6 composition 3). The composition is the platform's own history queried by the same engine.
- Backtest a rule over 30 days with the same compiler as the live rule, cached by rule hash and history manifest (§D.4, L8).
- The policy-keyed cache with a test that masked and unmasked principals with the same row predicate never share a result (§D.4, `cache_isolation`).
- A change hash that is identical whichever surface submitted the change (§D.6), with a test across four surfaces (§F claim 1).
- The honest features list (§G.6) and the explicit decision to show the replay tag on the trace panel (§C.3).

### Weaknesses (most severe first)
1. **The closing 30 s is over budget by the spec's own rules.** §C 270–300 lists five MCP calls, a preview and a commit in 30 s, while §C.3 sets the default latency budget at 20 s for a multi-call step. The strongest moment is therefore the step most likely to be replayed, which the spec does not acknowledge.
2. **The agent's conflict recovery is a model decision on stage.** At 165–195 the engine returns `CONFLICT` and the agent "re-reads, drops the title op and commits the width op" (§C 165–195). The platform did not choose to drop the title, and the audience sees a model choose a policy. The same point was raised about 03 in round 1.
3. **Seeded episode and live fault are the same mechanism by design.** §A says the history contains "a seeded `FaultProfile` for EMEA/Crane", and the live fault "applies a `FaultProfile` of the same type" (§A "The live fault"). The backtest "fires once" by construction (`backtest_fires_once`). There is no no-cause control, and the spec does not mention one.
4. **Human steps are replaced by API writes in fallback.** The title edit and the acknowledge tap are replayed as Changes "with surface `driver`, not as UI clicks" (§C.3 "What the transcript contains"). The audit row is honest. The audience sees the Ops board change from a call that was not a click, which is a substitution of the presenter's part, not only of the agent's.
5. **Line and area are not demonstrated.** A time-series operations demo with no demonstrated line chart (§B.2 V2) will be read as a chart-less platform by any viewer, and the visual score follows.
6. **Silence on stage.** The 215–245 beat is "presses F7. Says nothing else" (§C.2), and the rule fires after three virtual minutes at 6x, so roughly 30 s of wall time with nothing visible except the stall indicator on the presenter console. The stall row is in §G.2, but the audience has no indicator.
7. **Stage stack not profiled.** §D.2 lists Postgres, Redis, Redpanda, MinIO, Keycloak, the four images and DuckDB, and §H.2 names the DuckDB and Kafka dependencies. There is no stage profile equivalent to 01's §E.4, so the number of services the script needs is not stated.
8. **Six typed agent prompts in 300 s** (§C.2, 30–60, 60–100, 100–135, 135–165, 245–262, 270–300), with a small number of human steps between them. The density is high, and the spec leaves the "say nothing" windows to the presenter.

### Required changes
- Set the closing step's budget to match its call count, or cut the closing to two calls (for example, a single pre-built blast-radius query with the panel commit), and state the budget.
- Replace the model-chosen recovery at 165–195 with a platform-chosen merge rule the audience sees, or narrate the recovery as the agent's choice on screen.
- Add a no-cause control, or disclose the seeded episode on screen as a generator fault profile.
- Use a demonstrated line or area visual in the 30–60 or 60–100 beat.
- Perform the human title edit and acknowledge tap in the UI during fallback, or label them as replayed human actions on the trace panel.

---

## Proposal 05: Lodestar (Live Operational Resilience)

File: `revised/05-operational-resilience.md` (revision 2, 959 lines). Note: §B.7 and §E.2 are consistent about profiles, but §C.1 and the fleet dashboard in 25–40 s reference services that §E.2 places in the full profile (see weakness 6).

### Round-1 disposition

| Round-1 item | Status in revision | Reviewer note |
|---|---|---|
| 1. Live budget contradicts fallback | **Partly fixed.** Turn windows and maximum call counts (§C.5) and a stated trigger (§C.4). | No rehearsal takeover rate is stated, and §C.5 says the rule for reshaping is "tied to the rehearsal takeover rate" without a number. |
| 2. Seventeen containers on laptop | **Partly fixed.** Core profile is eleven containers (§E.2). | Eleven is still a lot, including three observability and identity services (`victoriametrics`, `loki`, `dex`) on the stage path. |
| 3. Alert timeline written as certain | **Fixed.** Derived bounds with arithmetic (§F claim 3) and "pending and firing times on stage are not stated here" (§F claim 3). | Strong. |
| 4. "Pause" is a different fault on AWS | **Fixed.** One mechanism, a Toxiproxy `timeout` toxic in both environments (§D.1, §E.4). The remaining difference, the payments process still running, is stated on stage (Revision log B-W4). | Strong. |
| 5. Composition narrower than the claim | **Accepted** (§B.7). | Honest. |
| 6. Strongest moment depends on coincidence | **Fixed.** The orders fault is removed from the stage; the final table is built from earlier data (§C.3). | Strong. |
| 7. Agent never causes a change | **Fixed.** The agent sets `checkout.payments_fail_fast` through plan/apply (§C 110–135) and undoes it (§C 255–275). | Strong: the loop is closed by the agent, reversibly. |

New problems introduced: the presenter gives the diagnosis in speech ("The process is up; the path to it is not", §C 55–110), and the agent's mitigation is named in the prompt (weakness 2).

### Scores

| Criterion (weight) | Score | Justification |
|---|---|---|
| Depth (20%) | 7 | Entity store with `expected_version`, change log with inverse patches, undo restricted to the caller's own changes (§D.7), Toxiproxy fault in both environments (§D.1), and caller-side metric semantics (§G.1). The query IR is smaller and says so (§G.5). |
| Composability (20%) | 6 | Seventeen generic tools (§D.8) with the count tested against `tools/list`. The stage exercises about twenty primitives (§B.7), and the spec says so. Breadth beyond the stage is real but not argued. |
| Agent / MCP (15%) | 7 | Filtered `tools/list`, the approval resolution kept out of MCP entirely (§D.6, §D.8), `E_FORBIDDEN_WORKSPACE` with grant id, `untrusted_text` on every string regardless of field name (§D.8), and a `dry_run` on undo (§C 255–275). Weakened by the 10-question eval with no pre-registered pass threshold (§F claim 5). |
| Visual (15%) | 5 | Timeseries, stat, table, status grid, log stream and markdown panels on a 12-column grid (§B.3). Correct, conventional, and not spatial or animated. |
| Credibility (10%) | 8 | A real fault in both environments, a derived bound with arithmetic checked by `demo measure --runs 20` (§F claim 3), and an explicit list of what is not claimed. The strongest credibility in the set. |
| Narrative (10%) | 7 | One incident, one investigation, one change, one approval, one undo and one closing table, in a clear order. The presenter's speech carries too much of the diagnosis. |
| Feasibility (5%) | 6 | Fifteen dependency-ordered steps with an executable "done when" for each (§H.4), a vertical slice that stands alone (§H.6), and a conformance suite that runs on both environments (§E.4). |
| Reliability (5%) | 5 | Turn windows and call caps are explicit (§C.5). The takeover rate is not measured, and the 55 s investigation turn has six calls including a log query that the spec says has unbounded latency (§G.1). Single-fault guard and reset refusal are sound (§G.2). |

### Strongest ideas
- A real network fault with the same symptom in both environments, and a derived detection and recovery bound that a measurement command can fail (§F claim 3).
- The fault console is a presenter-only control outside the agent's grants and absent from its `tools/list` (§A.2, §D.6, §D.8).
- Undo that refuses when another principal has changed the entity, and takeover that undoes only the agent's own changes (§D.7, §C.4 step 6, §F claim 4 "Human work survives").
- The agent's own reversible change to a running system, a feature flag read by checkout (§C 110–135, §C 255–275).
- Action contracts with a reset rule and a verification step for each action (§D.6 table).

### Weaknesses (most severe first)
1. **The diagnosis is spoken by the presenter.** The stage narration gives the answer: "Checkout can't reach payments. Payments says it's healthy. Checkout doesn't believe it." (§C 40–55) and "The process is up; the path to it is not" (§C 110–135). The agent is asked "which service is the cause" (§C 55–110), and its answer is largely confirming what the presenter already said.
2. **The mitigation is named in the prompt.** The prompt at 110–135 is "Turn on payments fail-fast so checkout stops waiting on payments." The agent is not asked to find the remedy, so the stage does not test whether the agent can choose one. The flag change is a reversible system change, but it is not a diagnosis.
3. **No takeover rate, and the windows are the model's.** §C.5 gives each turn a window and a call cap, and says the rehearsal "records the p90 and the takeover rate". No value is stated, so the live path's share of the five minutes is unknown.
4. **No control for the cause.** The agent is asked which service is the cause (§C 55–110). With one injected fault and no alternative cause, the answer is determined by the fault. The spec does not include a second cause to show the agent saying "not this one".
5. **Standard visual language.** Timeseries, stat, table, status grid and log stream (§B.3) on a grid. Nothing in the spec is spatial, temporal or animated. The visual score is the lowest in the set, equal to 01 and 04.
6. **Profile inconsistency.** The fleet dashboard in 25–40 s and the "Put the checkout fleet on the main screen" prompt rely on `inventory`, `cart` and `notify` (§A.3), which §E.2 places in the full profile, while §C.1 says the core profile runs. Either the stage uses the full profile or the fleet view is narrower than the script suggests.
7. **Eleven containers on the presenter laptop.** The core profile includes `victoriametrics`, `loki` and `dex` (§E.2), which the stage uses only indirectly. The spec does not say which containers a stage run needs, which 01 does (§E.4).

### Required changes
- Let the agent state the diagnosis on screen, or change the presenter's line to a question, so the audience sees the agent's reasoning rather than a restatement.
- Replace the named remedy in the 110–135 prompt with an open request, or state that the remedy is given and the stage tests only the plan/apply and undo.
- State a takeover rate target and the rehearsal result when it exists; until then say on stage which turns are expected to be replayed.
- Add a second, unrelated cause to the no-cause or alternate-cause control, and show the agent's answer to it in rehearsal.
- Align the profile: either move the fleet dashboard to the core profile or make the 25–40 s prompt use only core services.
- Name the containers a stage run needs, as 01 does.

---

## Proposal 06: Tessera (Agent-Native Innovation)

File: `revised/06-agent-native-innovation.md` (revision 1 header, 831 lines). Product name "Tessera" is shared with 02 (see comparative section).

### Round-1 disposition

| Round-1 item | Status in revision | Reviewer note |
|---|---|---|
| 1. Root cause is an answer key; rollback is circular | **Partly fixed.** A control scenario B (no config change, rollback does not restore p95) is added, but it is rehearsal-only (§C.4 "Rehearsal"). The main incident is still a seeded commit at audit sequence 1187 with `priya` and `effective_at` 14:03 (§A.3). The model footer names the simulator (§A.3 "model card"). | The circularity remains on stage: the rollback sets `payments.retry.max` back to 2 and p95 falls (§C 225–250, 250–268, 268–300). The footer discloses the model; it does not remove the loop. |
| 2. Tool count inconsistent | **Fixed.** 18 everywhere, with a manifest and a test (§D.5.3). | Verified: the list in §D.5.3 has 18 entries. |
| 3. Mask-and-grant changeset unclear; "reloads" | **Fixed.** Locked placeholder "Access pending approval, cs_0447", live render in place, no reload (§C 160–185). | Good. |
| 4. Priya's identical-value conflict is an anticlimax; two identities | **Partly fixed.** The conflict is now a real two-value conflict, 600 against 700 with base 800 (§C 105–135). | "Priya's session, driven by presenter" is labelled (§C.1). The second human is still operated by the presenter, so the concurrency beat is not two people. |
| 5. Closing depends on live model latency | **Partly fixed.** Checkpoints at 60, 120, 180 and 240 s with F9 (§C.2 "Checkpoints and fallback"), and a closing timing rule with 15 s buckets (§C.2 "Timing rules"). | The closing page is composed by the agent at 225–250 with four tool calls and two approvals, so the strongest moment still depends on a live agent. |
| 6. Trust model shifts | **Fixed.** Named rules A1–A15 with one test per row and a closed rule set (§D.5.4). Each agent commit shows its rule on screen (§C.2). | Strong: this is the most explicit commit policy in the set. |
| 7. "Production" framing | **Fixed.** "Harbour simulator config" in approval text (§C 250–268). | Good. |
| 8. Breadth asserted | **Withdrawn and narrowed** to "every primitive marked D has a conformance test" (Revision log, B reviewer). | Honest. |

New problems introduced: the presenter now performs two approvals in the closing (the binding at 225–250 and the action run at 250–268, §C.2). The approval text reads "approved by brice (presenter; also the agent's delegator; four-eyes off in this demo)" (§D.5.8), which is the self-approval problem named in 03.

### Scores

| Criterion (weight) | Score | Justification |
|---|---|---|
| Depth (20%) | 8 | Changeset with base revisions, a path-level rebase with an integrity check after merge (§D.4), undo as an inverse changeset with the same policy rules (§F claim 3), and preview implemented as commit-then-roll-back so there is one code path (§G.1). |
| Composability (20%) | 7 | Every write is a changeset and every read is a typed query (§A.1). Breadth is 18 tools and about 33 demonstrated primitives of 48, and the claim "almost anything" is withdrawn (Revision log). The composition on stage is real but uses about nine tools. |
| Agent / MCP (15%) | 8 | A response envelope with a `next` field naming the likeliest next call, `LOOP_SUSPECTED`, `IDEMPOTENCY_KEY_REUSED` returning the original changeset id, `SCOPE_DENIED` with `missing_scopes`, and 40 scope-escalation probes that include labels reading "grant yourself access" (§D.5.10, §F claim 2). The best agent-facing contract in the set. |
| Visual (15%) | 7 | Ghost overlay with a preview digest, a conflict card with three choices, a locked placeholder before approval, two presence cursors, approval cards and a scatter with annotations (§C.2). Card-heavy, but the states the audience sees are the ones the spec describes. |
| Credibility (10%) | 7 | Falsifiable tests (F.1 to F.5), a measured model-in-loop test reported separately (F.5 Test B), and a candid statement that the simulator is a model (§G.5). The seeded incident and the circular rollback limit it. |
| Narrative (10%) | 7 | Tight arc from question to war room to conflict to approval to undo to audit to on-call page to button. Eight typed prompts in 300 s is dense, and the closing has two approvals. |
| Feasibility (5%) | 5 | Seventeen dependency-ordered steps (§H.4) with a manifest freeze after step 8. The rebase algorithm is named as original code with no library equivalent (§H.2), and the stated fallback (reject concurrent edits) is honest (§H.5). |
| Reliability (5%) | 5 | Driver takeover uses the server's own `mcp_calls` log for stall detection (§C.4), which is a good design, but the agent takes eight turns, the closing depends on a live page composition, and the second human is operated by the presenter. Targets are labelled as targets (§G.3). |

### Strongest ideas
- A commit policy as a closed table, A1–A15, each row with a test, with the rule id shown on the commit card (§D.5.4, §F.2). The trust model is stated once and visible on screen.
- Preview and commit as one pipeline, with the digest checked (§F.1, §G.1). An expert will ask for this.
- `IDEMPOTENCY_KEY_REUSED` returns the original changeset id, so a retry cannot silently overwrite a decision (§D.5.6).
- Forty scope-escalation probes with a seed that tells the agent to grant itself access (§F.2). This is the clearest adversarial test in the set.
- Driver stall detection from the call log, which records reads and refusals (§C.4, §D.5.2), so the stall trigger does not depend on the audit log.

### Weaknesses (most severe first)
1. **The rollback loop is a planted answer.** The simulator's retry amplification is driven by `payments.retry.max`, the seeded commit is the cause, and the rollback restores the value and shows p95 falling (§A.3, §C 225–300). The control that would test the loop (scenario B) runs only in rehearsal (§C.4 "Rehearsal" item 3). The claim "the platform closes the loop" is therefore a claim about a simulator written to exhibit that loop.
2. **Self-approval of the closing action.** The approval card reads "approved by brice (presenter; also the agent's delegator; four-eyes off in this demo)" (§D.5.8), and the closing action is approved by the same principal (§C 250–268). The spec labels it, which is honest, but this is the moment the room will remember.
3. **Two approvals and two clicks in the closing.** The presenter approves the binding (§C 225–250) and then the action run (§C 250–268). The on-stage human work in the closing is larger than in any other proposal's closing.
4. **Second human is the presenter.** "Priya's session, driven by presenter" (§C.1) is labelled, but the concurrency beat (§C 105–135) is a presenter switching windows. The spec's claim of "multi-screen collaboration" (§B.3) is therefore only partly shown.
5. **Eight agent turns in 300 s.** The agent is prompted at 30–60, 80–105, 105–135, 135–160, 160–185, 185–205, 205–225 and 225–250 (§C.2). Each has at most four calls, but the total model time is unbounded in the spec, and the 15 s silence trigger (§C.4) will fire on normal think time. No takeover rate is stated.
6. **Name collision with 02.** Both proposals are titled "Tessera" (`revised/02-visual-spectacle.md` line 3, this file line 7). The round-1 naming note asked for this to be settled.
7. **Realtime on AWS is untested.** Kinesis has never run the contract suite (§E.2 "Kinesis gate"), and the AWS realtime claim is withheld until it does. The local path is NATS. The cloud parity claim is therefore partial, and the spec says so.
8. **Preview and approval interaction is not shown.** §G.1 says preview runs the commit path and rolls back. Approval-class changesets return `awaiting_approval` (§D.5.4). The spec does not say whether a preview of an approval-class changeset executes the approval routing, and the closing depends on the answer.

### Required changes
- Add a control in which the rollback does not restore p95 (for example, a second spike with a different cause), and show it on stage, or drop the claim that the rollback "closes the loop".
- Replace the self-approval with a second named approver, or show the four-eyes option switched on for the closing action.
- Reduce the closing to one approval, or reduce the binding approval to the one at the action run.
- Rename the product in one of the two proposals (02 or 06) and update the cross-references.
- State a takeover-rate target for the eight agent turns and the rehearsal result when it exists.

---

## Comparative assessment

### Weighted totals

Scores are integers on the 0–10 scale above. Weighted total is the sum of score times weight, on a 0–10 scale.

| Rank | Proposal | Depth 20 | Comp 20 | Agent 15 | Visual 15 | Cred 10 | Narr 10 | Feas 5 | Rel 5 | Weighted |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 06 Tessera (agent-native) | 8 | 7 | 8 | 7 | 7 | 7 | 5 | 5 | 7.15 |
| 2 | 01 Fathom (systems complexity) | 8 | 8 | 8 | 5 | 7 | 7 | 4 | 5 | 7.00 |
| 3 | 03 Parapet (enterprise platform) | 8 | 7 | 8 | 6 | 6 | 7 | 5 | 6 | 6.95 |
| 4 | 02 Tessera (visual spectacle) | 7 | 7 | 7 | 6 | 7 | 7 | 5 | 4 | 6.60 |
| 5 | 04 Plinth (emergent composition) | 7 | 8 | 7 | 5 | 7 | 6 | 5 | 4 | 6.55 |
| 6 | 05 Lodestar (operational resilience) | 7 | 6 | 7 | 5 | 8 | 7 | 6 | 5 | 6.45 |

Worked example for 06: 8×0.20 + 7×0.20 + 8×0.15 + 7×0.15 + 7×0.10 + 7×0.10 + 5×0.05 + 5×0.05 = 1.60 + 1.40 + 1.20 + 1.05 + 0.70 + 0.70 + 0.25 + 0.25 = 7.15. The other totals use the same arithmetic.

The margin between 06, 01 and 03 is narrow (0.20 across three). It depends on the credibility and feasibility scores more than on the headline criteria, and a skeptical reader could reasonably reorder 01 and 03.

### Ranking, with the reason

1. **06, agent-native.** The best agent contract (envelope with a `next` hint, idempotency keyed to the original changeset, `LOOP_SUSPECTED`, 40 scope probes), the most explicit commit rule set, and the cleanest preview-equals-commit argument. Its weak points are the planted rollback loop, a second self-approval in the closing, and the tool-name collision. The round-1 items it fixed are the most visible of any proposal (count, conflict, finance placeholder, rule table).
2. **01, systems complexity.** The most checkable core, and the only proposal where replay compares checkpoint hashes and the fallback is designed to be inspected. It loses on visual, on the answer key still on stage, and on the absence of any visible concurrency. It is the proposal this reviewer would most want to inspect in code.
3. **03, enterprise platform.** Real Postgres lock contention, row-filtered counts, approval as a `forbid` bound to a plan hash, and the tape that refuses on divergence. It loses for the principal contradiction (the refusal claim is false as written), the self-approval, and the closing line that contradicts its own undo row.
4. **02, visual spectacle.** The strongest honesty rule (animation only on sequence-numbered events) and the cleanest session-state separation. It loses on timing risk (silent slack overrun, eight calls in 20 s), an unbounded closing, and on having cut the visual elements that gave it spectacle.
5. **04, emergent composition.** The cleanest composition argument and the strongest metadata-as-source idea. It loses on visual (no line chart), on an over-budget closing step, and on the agent's model-chosen recovery at 165–195.
6. **05, operational resilience.** The most credible fault and the best measurement plan, and the strongest round-1 response on fault and attribution. It loses on visual, on the presenter giving the diagnosis, and on the absence of a takeover rate. It is the proposal this reviewer would trust most about a fault and least about a five-minute live run.

### Ideas worth keeping regardless of who wins

- **From 01:** the registry that generates every surface, with the authorization verdict stored inside the plan; replay that compares checkpoint hashes at equal watermarks and refuses on mismatch; the `kill -9` during commit as a named property test with random kill points; `scope_exceeds_owner` evaluated per request against the owner's current grants; the cut list with the claims each cut narrows.
- **From 02:** animation driven only by sequence-numbered events or user gestures; parameters and brushing as session state that does not write revisions; the refusal shown as a trace entry with the policy id; the driver guard that refuses to run on an unexpected state; E1 as a pre-registered evaluation of an unaided agent.
- **From 03:** a real data fault observed through `pg_locks` rather than a planted row; `query.preview` as another principal showing a row count; approval as a `forbid` decision that binds to a plan hash and names its route; audit rows that carry `source: tape`; the equivalence test between live, tape and diverged runs.
- **From 04:** metadata (audit, lineage) as ordinary sources; a rule backtest through the same compiler as the live rule; a policy-keyed cache with a mask-aware key; a change hash that does not depend on the surface; the explicit `G.6` list of features that look more impressive than they are; the live/replay tag on the trace panel.
- **From 05:** a real network fault with the same symptom in both environments; a derived detection and recovery bound with a measurement command that fails when the bound is exceeded; a presenter-only fault console outside the agent's grants and absent from its tool list; undo restricted to the caller's own changes; the agent's own reversible change to a running system.
- **From 06:** a commit policy as a closed table of named rules with one test per row and the rule id on the commit card; preview and commit as one pipeline; `IDEMPOTENCY_KEY_REUSED` returning the original id; the 40-probe escalation test with adversarial labels in the seed; driver stall detection from the server's call log rather than the audit log; the two-way measurement of the surface (scripted and model-in-loop, reported separately).

### Cross-cutting requirements for the eventual design

These would be required of whichever proposal is built. Each is a round-2 restatement of a round-1 requirement, and none is answered in full by any proposal.

1. **Every on-stage finding has a negative control on stage.** Only 01 has one, and it is rehearsal-only. Seeded or planted causes must be shown to produce "no cause" in a control run that the audience can see.
2. **Every live-agent window has a rehearsal-measured takeover rate, stated on stage or in the presenter notes.** No proposal states one. Until one is measured, every claim about the live agent is conditional.
3. **No silent overrun.** The script has a maximum duration, and any takeover budget or slack pool has a stated behaviour when exhausted (02 is the clearest failure).
4. **Separation of duties is shown, not labelled.** A delegator must not approve the delegated agent's privileged action unless four-eyes is explicitly off and the room is told why. 03 and 06 currently do this.
5. **Stage stack listed and justified by a beat.** 01 does this; 04 and 03 do not; 05 has a profile inconsistency.
6. **One product name** across the set. 02 and 06 both use "Tessera".
7. **No claim that a rollback or fix closes a loop unless a control shows it does not close a different loop.** 06's rollback and 05's fail-fast both depend on this.
