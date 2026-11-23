# Round 1 review, Reviewer C: implementation and reliability

Scope: the six proposals in `C:/dev/showpiece/docs/demo-design/proposals/` (01 to 06), read in full against the mission brief `00-mission.md`. The `_superseded/` directory was not read. Nothing was built or run. Quantities quoted below are the proposals' own labelled targets, scenario values or configured figures, and are cited as such.

Criteria are the brief's eight, weighted as in the brief. "Reliability" is live-demo reliability (5%). "Feasibility" is implementation (5%). Disqualification is applied only for the four grounds the brief names: fake functionality, an LLM inside the platform, a demo that cannot run without the live agent, or fundamentally incompatible local and cloud deployments.

Recurring defects are described once here and referenced by proposal below, to avoid repeating them.

- **Commit-order gap in a sequence-based change feed (02, 03, 04, 05, 06).** Each of these reads changes as `seq > cursor` from a database sequence (`bigserial` or `GENERATED ALWAYS AS IDENTITY`) and notifies by sequence. A sequence value is allocated at `nextval` time, not at commit time. A transaction holding a lower value can commit after a higher one, and a reader that advances its cursor to the highest visible sequence skips the lower one for good. The concurrent human and agent writes that each proposal stages (the two-writer moments) are exactly where this occurs. 01 avoids it by using a hybrid logical clock with per-replica sequence numbers, and its D.5 gives no equivalent defect.
- **Agent-chosen idempotency keys against transcript-bound keys (04, 06; partly 01).** The live agent supplies the key string. A fallback that reissues the transcript's key for the same step either duplicates the change (live key differs from transcript key) or hits key reuse and halts (same key, different body). The proposals assert idempotent recovery without binding the live agent's keys to the transcript.
- **Watermarks inside replay checkpoints (01, 04).** Both record query result watermarks in checkpoint or result hashes while a live feed keeps advancing. Replays then diverge on normal runs.
- **Extension and bundle fetch at runtime for DuckDB (01, 02, 04).** DuckDB extensions such as `httpfs` (S3 access) and the Postgres scanner are fetched at first use unless bundled. ECS tasks in private subnets, which 02 and 04 both place the query worker in, may fail their first query. None of the three proposals states that the extensions are bundled in the image.
- **Stall tolerance with no cumulative budget (02, 04, 05, 06).** Each proposal sets a per-step window and a takeover delay, but none sets a total slack for the 300 s script. A stall early in the script consumes slack that the closing rows need.

---

## Proposal 01: Fathom (Systems Complexity)

### Scores

| Criterion (weight) | Score | Justification |
|---|---:|---|
| Depth (20%) | 9 | Tree CRDT with move operations and fractional indices, HLC, a typed query IR with unit algebra, a Cedar policy model, histogram-based incremental maintenance with stated error bounds, and five named executable claims (F.1 to F.5). The strongest technical depth of the six. |
| Composability (20%) | 9 | Explicit composition map (B.2) where every arrow is a typed reference; a panel, alert, export and permission filter all reference the same IR; `ui.focus` is the same operation a click triggers. The one-registry generation of UI, HTTP, CLI and MCP is the most credible version of "one definition, every surface". |
| Agent / MCP (15%) | 8 | Two-phase writes with `plan_id` and `expectedBaseRev`, `stale_base` returned with a merge preview, structured error envelope with `did_you_mean`, idempotency keys, untrusted-content envelopes, and an agent-owned token ceiling checked per request. The tool count (about 35 signatures) is high for a model to hold, which D.8 partly acknowledges. |
| Visual / interactive (15%) | 6 | Three windows, a shared grid with cross-filter and drill, presence badges and a merged-edit chip are on the brief. Much of the impact is in the data and the log, not in the screens. The 210 to 255 s merge is the one clearly visual beat. |
| Credibility (10%) | 8 | Claims are testable and named (`convergence.rs`, `differential.rs`, `agent-scope.test.ts`); G.5 lists the shallow features honestly; the fault is modelled as queueing, not a scripted chart. |
| Narrative (10%) | 7 | Clear arc, a strong last 30 s (the replica kill with an unchanged audit chain). The 270 to 300 s beat stacks a kill, a hold, a resume and an audit verify into one window, which is more than an audience can absorb in 30 s. |
| Feasibility (5%) | 2 | Fifteen dependency-ordered steps, of which step 6 (the move CRDT) is named as "the single hardest component" and step 10 (histogram IVM, attribution, lineage, explain) is a large unit on its own. The stack is Rust core, WASM spec in the browser, DuckDB, Cedar, Redpanda or MSK, MinIO or S3 Object Lock, Keycloak or Cognito, Postgres, two replicas, Chromium and Vega-Lite. No cut list is given. |
| Reliability (5%) | 4 | The recording stores panel watermarks and the audit head hash (C.3), but the live feed advances at 10 simulated seconds per real second (C.0), so checkpoints differ between runs. The `why` answer is asked for a window whose end (14:20) is reached roughly 120 s into the live feed, so agent latency changes the data it sees. The kill at 270 to 300 s is not forced to hit an in-flight commit. |

Weighted composite (my arithmetic from the table): **7.5**.

### Strongest ideas

1. **HLC with per-replica sequence numbers for the change feed** (D.2 `op_log`, D.5). This is the one realtime design in the set that does not inherit the commit-order gap, and its gap-free claim is stated and tested (claim 5).
2. **The `plan` object as the single safety primitive** (P9, D.2): a stored diff, validation result, permission result, cost, base revision and expiry, committed by id. It is the same object for the agent and for the human "review changes" button, which is the correct composition.
3. **Attribution from data with no label** (C.1 120 to 165 s, B.1 P26). The platform never receives a cause label, and the agent's answer is a query result, which is the honest version of "why" that an engineering audience will test.
4. **A minimal vertical slice that is named** (H.4 steps 1 to 5), with each later step described as adding a primitive that composes with those already present. It is the clearest dependency order of the six.

### Concrete weaknesses (most severe first)

1. **Replay checkpoints cannot match between runs (C.3, against C.0).** The recording captures "the set of panel result watermarks" and the audit head hash at each step. C.0 runs the live feed at 10 simulated seconds per real second, so a watermark taken at step 4 of a rehearsal differs from the same step in a replay. The doc says determinism follows from "the seed and the clock", but the clock here is wall time. Until the feed is gated to step boundaries, every replay stops at its first checkpoint. This directly defeats the fallback, which the brief names as a requirement.
2. **The `why` window moves with agent latency (C.1 120 to 165 s, C.0).** The query asks for 13:50 to 14:20 and the attribution window 14:05 to 14:20. At 10x, scenario 14:20 is reached about 120 s after the feed starts (20 simulated minutes at 10 simulated seconds per real second), so the end of the window is only just being produced when the 120 s row begins, and any slower row before it pushes the question's window further into data that does not yet exist. Any slowness in earlier rows changes the data the agent sees, and the stated numbers (dock `NE-2` at 91%, carrier `Northline` at 88% of that, handoff rate 0.82 to 0.31) are scenario parameters that G.5 concedes are "design parameters, not measurements". The script cannot promise those figures on stage.
3. **Scope that no small team can finish (H.4, H.1).** The vertical slice is steps 1 to 5, which include a simulator and one IR query but not policy, RLS, attribution or workflows. The question the brief asks (the `why` answer with evidence) depends on steps 8 to 10, so the first stage that can be rehearsed is well into the sequence. The move CRDT (step 6) is gated by its convergence test, and H.6 names the fallback (pessimistic locks) without a decision rule. There is no cut list, so a shortfall in any one lane delays the whole stage.
4. **The kill is not forced onto an in-flight commit (C.1 270 to 300 s, claim 5).** The script says the agent's in-flight `spec.commit` with key `k-hold-1` is retried and returns the original response. The claim test varies kill points across 20 runs, but the stage has one run and no mechanism to make the commit in flight at the instant of the kill. If the commit has already completed, the retry is a plain success and the "exactly once under retry" moment is not shown. A deterministic in-flight hook (for example a proxy that holds the commit response) is needed.
5. **The fallback switch has no revert-to-checkpoint step (C.3 Switch).** The switch "starts the replay at the current step". If the live agent committed part of a step, the replay runs its remaining requests against half-applied state it was not recorded against. 02 refuses to run on a hash mismatch and 05 reverts to a checkpoint; 01 has neither guard.
6. **Cognito does not offer the grant the auth flow needs (D.6).** The doc uses a token exchange to an agent-scoped token and says "On AWS the same flow is Cognito". As I understand Cognito's documented grant types (authorization code, client credentials, refresh token), it does not offer RFC 8693 token exchange; this should be checked against current AWS documentation. If so, the local and AWS auth flows differ in kind, not only in issuer configuration.
7. **Four stateful services in the write path on a presenter laptop (D.1, E).** Two `fathomd` replicas, Postgres, Redpanda, MinIO, Keycloak, Caddy, OTel, Jaeger, Mailpit and headless Chromium, with DuckDB in-process. No resource budget or footprint is stated, and the stage depends on all of them staying up.

### Required changes

- Gate the feed to step boundaries for the rehearsal and the stage, or drop watermarks from the checkpoint hash and compare them only as a tolerance check. State which.
- Re-time the `why` window so its end is produced before the question is asked, or make the question's window explicitly relative to the feed position. Label the attribution figures as scenario expectations that the rehearsal must confirm.
- Add a cut list with an ordered set of removals (for example, drop the move CRDT for a single-writer spec with locks, which H.6 already allows) and state which claims survive each cut.
- Add a deterministic in-flight hook for the kill beat, and a fallback line if the commit has already completed.
- Add a checkpoint revert or refusal rule to the fallback switch.
- Replace the Cognito token exchange with a flow both environments support, or state the AWS path as a documented difference with its test.

---

## Proposal 02: Tessera (Visual Spectacle)

### Scores

| Criterion (weight) | Score | Justification |
|---|---:|---|
| Depth (20%) | 6 | Revision store with JSON patches, path-level three-way rebase, Cedar, a DuckDB query worker with result cache keyed by IR hash and watermark, and a seeded simulator with a stated RNG. Solid, but the engine is a thin compiler over DuckDB and the merge is path-level rather than deeper. |
| Composability (20%) | 8 | Forty-five rows, each with "composes with" entries; the two named compositions (query to panel to parameter to query; agent write to revision to audit to realtime to every screen) are real code paths in D.3 and D.5. Several rows are supporting only, which dilutes the claim slightly. |
| Agent / MCP (15%) | 7 | Closed error codes with `valid_values` computed from the registry, a `preview_token` bound to base revisions, `tools/list` filtered by scope so that approve tools are absent, and tool descriptions written as contracts. The tool list is about 25 names, and the preview token is a 10-minute object, which is a reasonable bound. |
| Visual / interactive (15%) | 8 | The strongest visual design of the six: the wall, the trace ribbon listing every call with its revision and audit sequence, ghost overlays for proposals, a phone-width audience session flipping from 403 to live, and a rule that every animation is driven by a sequence-numbered event. |
| Credibility (10%) | 6 | Honest framing ("nothing is measured yet"), labelled targets and estimates, and a visible failure table. Some targets (commit to screen under 250 ms p95 locally; carrier latency rising within about 15 s) are presented as design targets in a script that depends on them. |
| Narrative (10%) | 8 | The five-minute arc is tight: question, evidence, branch, drill, approval, refusal, recovery, then replay. The final beat (replay rebuilds the investigation in a second workspace with checkpoints 3 of 3) is a verifiable claim shown on screen. |
| Feasibility (5%) | 4 | One language (TypeScript) is an advantage, and the scope is described by layer. Still, it includes DuckDB Node bindings with Arrow IPC and a Postgres attach, Cedar via WASM from Node, Yjs, uPlot, ECharts, custom WebGL stream rendering, Redpanda or MSK, Dex or Cognito, and a 45-row capability list with no cut order. |
| Reliability (5%) | 5 | The checkpoint guard that refuses to run on a hash mismatch is the right instinct. But the guard compares absolute IDs and revision numbers that a live run will not reproduce, the takeover rule allows 20 s beyond each row's window with no total budget, and the replay re-applies approval-backed grants without re-approval. |

Weighted composite (my arithmetic from the table): **6.9**.

### Strongest ideas

1. **Event-driven animation only** (A, C conventions). Every visual change is tied to a sequence-numbered event or a user gesture. This is the right rule for a demo that must be reproducible, and it makes the replay visually identical to the live run.
2. **Per-row checkpoints with a pre-takeover hash guard** (C, "Where the fallback takes over"). The driver refuses to issue calls into a state it was not recorded against and shows a reset prompt. This is the failure mode a presenter most needs protected from.
3. **The trace ribbon as the single honest surface** (Screen T). Every call with status, revision and audit sequence is visible to every session, so live and replayed work is indistinguishable by construction, which is the point of the design.
4. **The on-stage failure table** (G). It names the failure, the symptom and the recovery for model slowness, wrong tool calls, hallucinated fields, stream stalls, browser crashes and reset failures. It is the most complete failure table of the six.

### Concrete weaknesses (most severe first)

1. **Checkpoint hashes cannot match a live run (C, "Where the fallback takes over"; D.3).** The guard compares a canonical hash of the workspace after each row with the transcript's hash. The live agent chooses panel IDs, layout positions, parameter names and the number of revisions it spends, so a rehearsal and a stage run diverge on the first row unless identifiers are bound by name. The proposal does not state name-to-ID rebinding, which 01 and 05 both do. The result is either a guard that refuses on most live runs or one that is weakened to pass.
2. **Takeover adds up to 20 s per row with no cumulative budget (C).** Rows run 15 to 30 s, and the rule is "window plus 20 s". A stall in the first row pushes every later row, including the approval, the rollback and the replay, past the 300 s the brief requires. There is no total slack and no earlier trigger for read-only rows, which carry no commit to detect a stall from.
3. **The replay re-applies a privilege without re-approval (C, 285 to 300 s; D.7).** `tessera.session.replay` applies the session's audited commits to a blank workspace, and the session includes the grant approved on screen at 225 to 240 s. The doc says human actions are replayed as their recorded revisions. An enterprise audience will ask whether a replay can reconstitute an approved grant without a fresh human approval. The proposal should say that replay re-checks policy and refuses privilege revisions unless re-approved.
4. **Simulator state sits outside the checkpoint (C, 100 to 120 s and 270 to 285 s).** The fault keys (`I` and `R`) write `scenario.control`, which is not an MCP call and is not in the transcript. The workspace hash does not cover simulator state, so after a takeover nothing verifies whether the carrier is degraded. The PCG64 generator also needs BigInt arithmetic in TypeScript; byte-identical streams "across runs" (F, claim) need a pinned Node version and a stated implementation.
5. **The change feed inherits the commit-order gap (D.1 `change_event`; D.4 NOTIFY).** `change_event.seq` is a `bigserial` and the NOTIFY carries only the sequence. A gateway reading `seq > cursor` can skip a lower sequence that commits later. This is the defect the 170 to 200 s two-writer moment and claim 4 (no missed or reordered deltas) are exposed to. Needs visibility-ordered reads or a serialized commit counter.
6. **The audit chain is a single hot row, with its mitigation undesigned (G.1).** The doc says the chain "serialises writes to `change_event`" and proposes per-workspace chains with a periodic global anchor, without defining anchor cadence, what `verify` checks across anchors, or whether refusal rows (which the agent generates) take the same lock.
7. **Sign-and-approve depends on key management the doc leaves open (C, 225 to 240 s).** "Grant is written as a Cedar policy revision, signed by the approving human" does not say what signs it, where the key lives locally (Dex) or on AWS (Cognito), or how a verifier checks it.

### Required changes

- Bind checkpoint identifiers by name, and compare the rebinding table as part of the checkpoint.
- Add a total fallback budget for the script, an earlier trigger for read-only rows, and state the remaining slack after each row.
- Make replay re-run policy evaluation and refuse privilege revisions without a fresh approval.
- Add simulator state (scenario phase and seed position) to the checkpoint, and pin the RNG implementation and the Node version.
- Replace `seq > cursor` with a visibility-ordered read or a serialized counter, and add a test that commits two transactions out of sequence order and checks delivery.
- Define the audit anchor, its cadence and the `verify` semantics, and state whether refusal rows take the chain lock.

---

## Proposal 03: Parapet (Enterprise Platform)

### Scores

| Criterion (weight) | Score | Justification |
|---|---:|---|
| Depth (20%) | 7 | Cedar decisions with explanations computed from the same evaluation as the decision, RLS as a second enforcement in Postgres, column masks compiled into the projection, approvals as a human-only command, a closed workflow step registry, and deterministic anomaly explanations. Depth is in governance more than in the query or data engine. |
| Composability (20%) | 8 | Forty-five primitives with a composition map; the composition of query, alert, workflow and metric through one reference is credible; policy shapes queries, exports, embeds and agent answers through the same compile step. |
| Agent / MCP (15%) | 8 | Discovery filtered by the effective principal (so denied capabilities are not listed), `POLICY_DENIED` that names the policy and never a value, a plan with `plan_hash` and a 5-minute expiry, and a tape driver with preconditions and a "reset required" refusal. One design flaw (the `as` parameter, weakness 4) lowers the score. |
| Visual / interactive (15%) | 6 | Live wall, a sre-oncall window with a drill-down, a finance window with a masked email, approval cards and an alert list. Strong on governance states, lighter on the dashboards themselves. |
| Credibility (10%) | 7 | The "same engine, same rules" argument is sound; G.4 is an honest shallow-features list. The reader-endpoint design and the `as` parameter would be caught by an expert in the room. |
| Narrative (10%) | 7 | Nine prompts in 300 s, each with several calls; the refusal and undo finale is strong. The number of beats makes the timing risk in the next section worse. |
| Feasibility (5%) | 4 | The core is described as small, but the inventory includes headless-Chromium PDF rendering, embeds, a closed workflow step registry with `http_call`, Cedar with RLS generation, column masks, an orderflow estate with three services and a lock collector, and two identity stacks. |
| Reliability (5%) | 4 | The lock fault is timed to an unstated window, the feed cursor has the commit-order gap, the reader endpoint lags writes on AWS but not locally, and the 170 to 200 s conflict depends on a model choosing a merged title. |

Weighted composite (my arithmetic from the table): **6.9**.

### Strongest ideas

1. **`permission.explain` computed from the same evaluation as the decision** (D.6). The explanation cannot drift from the decision, and the audience's question "show me the rule" gets a rule.
2. **`POLICY_DENIED` that never reveals restricted values** (D.8). It names the column, the policy and the principal, and the refusal is explainable without leaking the data it protects. This is the right error design for governance.
3. **Database-level RLS as the second line behind Cedar** (D.2, D.3). Application bugs cannot widen results, which is the claim an enterprise reviewer will probe first.
4. **The tape's "reset required" refusal** (C, fallback). A diverged state stops the replay rather than producing a wrong screen, and the proposal states that a wrong screen is worse than a pause.

### Concrete weaknesses (most severe first)

1. **The central fault's duration is not tied to the script (C.0; C.1 95 to 135 s).** The maintenance job holds `ACCESS EXCLUSIVE` on `payments.ledger` "for a configured window". The fault is injected about six minutes before the start. The 95 to 135 s beat asks "which payments queries are waiting on locks right now" and expects 14 waiters blocked by one PID. If the configured window ends before 95 s the answer is zero waiters. The readiness check also refuses to report ready "without the fault active", which cannot be true on a fixed schedule. The lock window must be released by the script clock, not by a configured duration.
2. **The change feed has the commit-order gap (D.5).** The gateway reads `change_log` rows with `seq > cursor`, and `seq` is `GENERATED ALWAYS AS IDENTITY`. The 170 to 200 s moment has a human and an agent writing close together, which is the case where a lower sequence commits after a higher one. A screen can permanently skip a change, and the "no silent overwrite" claim concerns exactly that path.
3. **Aurora reader lag is a behaviour difference the doc does not list (E.2, E.3).** On AWS, "a reader endpoint used only by read-only query paths" serves `query.preview` and panels; locally the reader "falls back to the writer". A `query.preview` run immediately after `dashboard.apply` can show the previous state on AWS only. The parity claim ("same behaviour") and the difference list do not mention it. Post-write reads need a writer route or a watermark check.
4. **`query.preview` takes an `as` principal (C, 200 to 235 s; D.8 signature).** The agent previews "as group:finance", so an agent can request results under another principal's row and column policy. The demo uses this to show the finance view, and the agent's own ceiling (`brice`'s rights) does not include finance. The proposal's own claim (F.1, "an agent's result is a subset of its delegator's") is not enforced by the signature as written. `as` must be restricted to principals within the agent's ceiling, and each use audited.
5. **The conflict moment depends on a model's merge and on a race (C, 170 to 200 s).** The conflict needs the presenter's retitle to land between the agent's read and its apply. The outcome, in which the agent "keeps the human's title and adds its own suffix", is a model's choice. D.5 says concurrent exclusive properties return a conflict for the human to resolve, not an automatic merge, so the scripted outcome contradicts the platform's own rule. The tape cannot reproduce a model-chosen merge.
6. **The closing 30 s is a multi-call chain with no timing budget (C, 285 to 300 s).** The agent must run `audit.search`, then one `change.undo` per agent change in reverse order, each returning a new change ID, then narrate the audit rows. The approved grant is attributed to `brice`, so it is unclear whether "every change you made" reverts the finance board as the closing line says.
7. **The tape types a recorded reply into the terminal (C, fallback "Invisibility").** "The companion types the recorded agent prompt reply into the terminal using the tape's stored text." That is a pre-written model output presented as live text. The proposal's rule that the tape "never fabricates an output the platform did not produce" covers platform output, not the agent's words; a presenter with a shared terminal would be showing pre-written prose as the model's live answer.
8. **Scope without a cut order (H.1, H.3).** The 45-row inventory and the "every row must be reachable from spec, MCP and UI or it is cut" rule are the right cut criterion, but no cut list is given, and the H.4 sequence places the supporting capabilities last with no gate that would remove them if the core slips.

### Required changes

- Make the lock release follow the script clock (a presenter-triggered release, or a release scheduled from the scenario clock), and make the readiness check test the fault at the step rather than at reset.
- Use a commit-order-safe cursor for the change feed and add a two-transaction out-of-order delivery test.
- Route post-write reads to the writer or gate reads on a watermark, and list the reader lag as a documented difference with its test.
- Restrict `as` to principals inside the agent's ceiling, audit each use, and add the case to F.1.
- Replace the model-merged title with a conflict card in the demo, or label the merge as a model choice that the tape does not reproduce.
- Remove the typed reply text from the tape, or label it as a driver-authored line.
- Add a cut list with ordered removals and the claim each removal affects.

---

## Proposal 04: Tessera (Emergent Composition)

### Scores

| Criterion (weight) | Score | Justification |
|---|---:|---|
| Depth (20%) | 6 | One query compiler with predicate injection in a fixed order, a Grant predicate that is itself a query expression, rules backtested through the same compiler, and a path-level three-way merge over a change log. Clean, but no incremental maintenance (acknowledged) and a narrower engine than 01. |
| Composability (20%) | 8 | Thirteen node kinds and generic verbs; audit is a source (the 60 to 100 s "no changes in the window" beat is a query over the platform's own history); rules, forms, exports and row predicates all compile through one compiler. Directly targets the "emergent" requirement. |
| Agent / MCP (15%) | 8 | Fifteen generic tools with a closed error vocabulary, `query.explain` showing the authorization layer's injected predicates, a preview token single-use and bound to the change hash, progress and cancellation notifications, and `ui.present` as the only presentation call. The idempotency key is supplied by the caller, which weakens the fallback (weakness 2). |
| Visual / interactive (15%) | 6 | Ops board, exec view, phone window, a heatmap and a bar panel, toasts and an acknowledge form. Good on the phone beat, plain on the dashboard surfaces. The replay label on the audience trace panel (weakness 7) affects this as well. |
| Credibility (10%) | 6 | The composition argument is sound and the honest limits list (G.5) is good. Some claims are unhedged: "p95 under 200 ms over 2.4 million rows" is a design target with no measured basis yet, and the 14:05 episode's source is undefined (weakness 4). |
| Narrative (10%) | 7 | The "nobody asked the agent to watch for this" beat (225 to 250 s) is a strong moment, and the acknowledge tap on the phone closes the loop. The 225 to 250 s fault timing is not tied to the presenter's cue (weakness 3). |
| Feasibility (5%) | 5 | A single TypeScript language, DuckDB Node bindings and a Postgres control plane are a credible set; the 2.4 million row history, the 13 node kinds and the reset budget make the data plane the risk. |
| Reliability (5%) | 3 | The replay's own example of divergence ("source watermark differs") is produced by normal operation, the live agent's keys are not bound to the transcript, the fault is not cued to the presenter, and the reset mechanism for 2.4 million rows is not stated. |

Weighted composite (my arithmetic from the table): **6.6**.

### Strongest ideas

1. **Audit as a queryable source** (A, B.2 composition 3, P02-equivalent). The "who changed it" answer is an ordinary query against the same engine as sales data, which is the strongest evidence for a single-system claim.
2. **`query.explain` shows the injected predicates** (D.4 steps 1 to 3, D.8 item 7). A reviewer can see what the authorization layer added, and an agent cannot remove it.
3. **Rule firing deduplicated by firing ID** (G.2 "Rule fires twice"). The state machine treats `firing` as a state, not an event, which is the correct model for a page-once alert.
4. **`ui.present` as the only call that changes a screen without a change** (D.7 item 15), recorded in the audit log. Presentation is then accountable, which is the mission's requirement.

### Concrete weaknesses (most severe first)

1. **Replay divergence is designed in (C.3, D.2).** The expected result hashes of recorded `query.run` calls include source watermarks, and the example divergence message is "replay diverged at step 4: source watermark differs". The Kafka feed keeps advancing during any run, so this message fires on ordinary runs. The doc has to choose between stopping the feed for replay and excluding watermarks from the hash. Neither is stated, and the fallback is the mission's explicit requirement.
2. **Idempotency keys are the live agent's, not the transcript's (D.7 item 9, E.4).** `node.commit` takes `idempotency_key` from the caller. The recovery story says "idempotency keys are derived from step id and transcript id". A live commit under the agent's key followed by a driver commit under the transcript key duplicates the change. A driver commit that reuses a transcript key with a different body fails the key check and halts the replay. Recovery needs server-side step binding or a rule that the live agent receives transcript keys.
3. **The 225 to 250 s fault is on the virtual clock, not on the presenter's cue (section A, C.2).** The fault begins "at the scripted offset" of a clock that the presenter's pace does not control. If it lands during the 200 to 225 s undo or the grant, the narration "Nobody asked the agent to watch for this" is wrong. A presenter-cued injection is needed, with the scripted offset as a fallback.
4. **The 14:05 spike has no defined source (C.2 60 to 100 s; section A).** The agent explains a spike at 14:05 in the reset history, but the history is described as generated traffic with no embedded episode. The only scripted fault is the live EMEA "Crane" fault at 225 to 250 s. The causal sentence ("one carrier's median handoff time doubled") therefore has no defined generator behind it.
5. **The reset budget has no mechanism (E.4).** "Restores the seeded workspace in under the reset budget (design target: 20 s) by replaying the seed, not by clearing and reloading" must regenerate about 2.4 million orders, 30 days of events and their Parquet landing. Section A says the same history is "loaded into the landing store before the demo starts". The two mechanisms differ, and only the second could meet the target, so reset time is a claim without a path.
6. **DuckDB reads S3 and attaches Postgres at runtime (D.1, E.2).** Extensions for `httpfs` and the Postgres scanner are fetched on first use unless bundled. Private-subnet ECS tasks may fail their first query. The doc should say the extensions are part of the image.
7. **The replay tag is shown to the audience (C.3).** "The trace panel records each call as `live` or `replay` in a small tag." This puts the fallback in front of the audience, against the brief's requirement that a switch be invisible or one keystroke. The doc's own rationale, that an expert discounts canned flows, argues for the opposite choice. The decision should be made and stated, and the tag removed from the audience view if the switch is to be invisible.

### Required changes

- Exclude watermarks from replay checkpoint hashes, or stop the feed for replay, and record which.
- Bind the live agent's idempotency keys to transcript step IDs, or bind steps server-side so a replayed step returns the live result.
- Add a presenter-cued fault injection and keep the scripted offset only as a fallback.
- Specify how the 14:05 episode enters the history, or change the agent's question to the scripted fault.
- Describe the reset mechanism for the history and state which of the two reset paths is used.
- Bundle DuckDB extensions in the images and add a private-subnet startup test.
- Decide on the audience-visible replay tag.

---

## Proposal 05: Lodestar (Live Operational Resilience)

### Scores

| Criterion (weight) | Score | Justification |
|---|---:|---|
| Depth (20%) | 6 | Entity store with versioned documents, hash-chained change log, plan and apply with expiry, a Postgres advisory-lock leader, reset-aware counter semantics called out, and a real fleet of services under real faults. The engine is a per-dialect compiler, which is less deep than 01 or 04. |
| Composability (20%) | 6 | Several source connectors compiled per dialect (SQL, PromQL, a LogQL subset) and one command engine, but the compiled dialects do not share a single engine, and the doc says so ("the compiler refuses constructs a source cannot express"). Composition is real within sources and narrower across them. |
| Agent / MCP (15%) | 7 | Twenty generic tools, `plan` and `apply` with `E_PLAN_STALE`, a fault console whose actions are absent from the agent's `tools/list`, progress notifications that stream to screens, and a closed error vocabulary. The `rebase: true` option lets an agent re-plan silently, which the conflict beats then rely on. |
| Visual / interactive (15%) | 7 | A real fleet on the wall, a status grid, an incident board with an annotation at the pause, a drill, a diff card and a masked table. The visible state is driven by real faults, which is the most visceral option in the set. |
| Credibility (10%) | 8 | Real processes, a real fault mechanism, and a measurement harness that reports distributions and not targets. The most credible premise for an engineering audience. The docker-pause claim (weakness 2) lowers the score for this criterion. |
| Narrative (10%) | 7 | The incident arc (fault, investigation, approval, restart, resolution, masked question) is strong. Seven typed prompts and four conflict or approval beats in 300 s is dense, and two beats rely on sub-second race timing. |
| Feasibility (5%) | 4 | Harbor services (six), k6, Toxiproxy, Dex, VictoriaMetrics, Loki, Redis, Caddy, Postgres and the platform roles run locally; AWS adds ECS, RDS, AMP, a CloudWatch Logs Insights adapter, Cognito, ALB and an OTel sidecar. Each source needs a conformance suite across two backends. |
| Reliability (5%) | 3 | Takeover can revert human changes (`revert_to` covers all changes after a sequence), the local and AWS fault symptoms differ, the AWS restart does not obviously clear the AWS fault, and the replay switches live panels to a snapshot in front of the audience. |

Weighted composite (my arithmetic from the table): **6.35**.

### Strongest ideas

1. **The fault console is not in the agent's tool list** (B.4, D.8). The agent cannot see a route to fault injection, which is a stronger guarantee than a permission check that fails at runtime.
2. **The `FleetAdapter` records the mechanism that ran** (B.4, E.5). An action result that says whether it used a container pause or a toxic lets a reviewer check what happened, and it is the right instinct for cross-environment honesty.
3. **Reset-aware counter semantics called out as a risk** (G.1 "Counter resets"). Restarting a container resets counters, and a naive ratio shows a false dip. The proposal names this, which few do.
4. **The self-telemetry panel as a pressure gauge** (G.2 "Laptop resource exhaustion"). The presenter sees platform pressure before the audience does.
5. **A fault-to-screen measurement harness that reports distributions** (F, claim 3). It reports a distribution from runs, which is the right way to speak about a live fault.

### Concrete weaknesses (most severe first)

1. **Takeover can revert human work (C.3 Takeover rule 4; D.7 "Revert to seq").** `revert_to(checkpoint_seq)` "replays inverse patches in reverse order for all changes after `seq` in the workspace branch". Changes after the checkpoint include Cass's approval, the workflow transitions and the runner's records. A takeover could silently undo a human approval and the incident timeline. The doc's own rule that runtime state is "marked non-undoable where it does not [make sense]" is not applied to `revert_to`. Takeover must revert only the live agent's changes and refuse when a human change intervened.
2. **The local and AWS fault symptoms differ, and the central alert depends on which (B.4, section E difference table, C.1 45 to 75 s).** `docker pause` suspends every process in the container, including the `/metrics` endpoint. Scrapes then time out and the series stop; they do not climb. A Toxiproxy timeout toxic on the listener leaves the metrics endpoint running. The section E difference table says both "produce the same observable symptom". The alert the script shows as "pending, then firing after 10 s" was authored for a climb. On the local stack it would show staleness. The fault should use one mechanism in both environments, or the difference should be conformance-tested as a symptom.
3. **The AWS restart may not clear the AWS fault (C.1 180 to 215 s; section E difference table).** Restart is "ECS API" on AWS. A Toxiproxy toxic lives on the sidecar, and a task StopTask does not obviously remove it. The alert "resolves after the first healthy scrape window" would then not happen on AWS. The doc does not say whether `docker restart` clears a pause either. Each fault mechanism needs an explicit reset rule and a test.
4. **The replay switches live panels to a snapshot in front of the audience (section A, reproducibility item 3; C.3 fallback item 3).** The metrics and log sources are repointed to a rehearsal snapshot, so the fleet panels switch from live numbers to recorded numbers at the takeover, while the live fleet and any live fault keep running. The takeover is described as "a visible continuation, not a cut"; a change in numbers is a cut. The same section says narrative "never depends on exact numbers", but replay needs exact snapshot numbers.
5. **Three conflict or race beats depend on model latency (C.1 110 to 145 s, 170 to 200 s, 270 to 300 s).** Each needs a human edit to land between the agent's read and its apply, or two actions to land in one frame. Nothing in the design makes the conflict occur, and the fallback for each conflict beat is not defined beyond "the agent re-plans".
6. **The alert window is not stated (C.1 45 to 75 s; claim 3).** The for-duration is 10 s and the scrape interval 5 s, which would meet the 20 s design target only if the alert's query window is short. The incident board uses a 5-minute window. A rate or quantile over 5 minutes dilutes a fault, so the threshold crossing would take far longer than the 20 s target. The alert's window must be stated and tied to the claim.
7. **An agent can author a runbook that restarts a service it may not run (C.1 145 to 180 s; D.6).** The agent's grants exclude `action:*`, but the script has it create a workflow containing `fleet.restart`. The doc does not say whether creating a workflow that references an action the author cannot run is allowed, and it does not specify what the approving human sees.
8. **Logs compile to a different backend with a different query model (D.4, E).** A LogQL subset is compiled to CloudWatch Logs Insights. The conformance suite covers "filter, limit and ordering", not latency, and Logs Insights query latency is not budgeted in the 15 s log step the script depends on.

### Required changes

- Scope `revert_to` to the live agent's changes, and refuse with a conflict whenever a human or runner change intervened.
- Use one fault mechanism in both environments, or add a conformance test that the symptom (climb, staleness, timeout) matches, and change the alert and the script to the symptom that is actually produced.
- Define each fault's reset rule, and test that the AWS restart clears the AWS fault.
- Make the replay source switch per panel with a visible source label, or keep the live source and replay only the actions.
- State the alert's query window and the claim it supports.
- Define the rule for workflows that reference actions the author cannot run, and specify the approval card's content.
- Budget the Logs Insights latency in the script or remove the log step from the 15 s window.

---

## Proposal 06: Tessera (Agent-Native Innovation)

### Scores

| Criterion (weight) | Score | Justification |
|---|---:|---|
| Depth (20%) | 6 | Changesets with base revisions and rebase, a propose and commit path that shares one pipeline (F.1), undo as an inverse changeset, a path-level semantic diff and an RLS-backed audit chain. Sound, with less engine depth than 01 or 04. |
| Composability (20%) | 7 | One document model with kinds and a single changeset path; approvals are changesets; screens and presence are primitives. The composition map (B.2) is clear. Composition is narrower than 04, because lineage and audit-as-source are present but less central. |
| Agent / MCP (15%) | 8 | The most carefully designed agent contract of the six: a common envelope with `next` naming the single most likely next call, `propose` idempotent by content, `access.request` that can only create an approval, a `LOOP_SUSPECTED` guard, and `fix` objects in errors. The tool count is stated inconsistently (weakness 6). |
| Visual / interactive (15%) | 7 | A single war-room screen, ghost overlays for proposals, an approval card on screen, a diff split and a button on an agent-built page. Less spectacle than 02, more legible for an executive audience. |
| Credibility (10%) | 6 | The "one code path for preview and commit" claim is credible and testable, and the design says so. Several internal contradictions (the 14:05 mechanism, the identical-edit outcome, the tool count) would be found by an expert reader. |
| Narrative (10%) | 8 | The closing beat (a generated page with a button that performs an approved production change, visibly effective on the same screen) is the strongest closing idea in the set. It is also the beat with the worst timing (weakness 1). |
| Feasibility (5%) | 5 | One language, one Postgres, one MCP server and a small number of services. The Kinesis path is untested locally, and the 19-tool surface is fully specified. The two-environment bus is the main feasibility risk. |
| Reliability (5%) | 3 | The closing 25 s window cannot hold the metric recovery the text describes, the driver's skip logic conflicts with agent-chosen keys, the audit chain's concurrency is undefined, and the 14:05 spike's mechanism is not clocked. |

Weighted composite (my arithmetic from the table): **6.65**.

### Strongest ideas

1. **Approval as a pending changeset that a human commits** (C.2 160 to 190 s; D.5). The agent cannot commit it because it is not the human, and the screen shows the approval as data. This makes "the agent proposes, the human approves" a property of the write path, which the brief asks for.
2. **Propose is idempotent by content** (D.5, idempotency). The same ops on the same base return the existing proposal, which removes a whole class of duplicate-retry errors that a model produces.
3. **The envelope's `next` field** (D.5 tool catalogue). It names the single most likely next call, which steers the agent without a bespoke prompt, and it matches the brief's requirement that a general agent can build without prompting.
4. **`LOOP_SUSPECTED` after repeated identical refusals** (G.3). It turns a common agent failure into a named state with a defined response.

### Concrete weaknesses (most severe first)

1. **The closing beat is timed inside 25 s but its effect needs a minute (C.2 275 to 300 s).** The presenter presses the button, the approval is given, the workflow runs `config.change`, the simulator reads the new setting, and "`payments.p95` falls over the next minute". The same row then says the chart "drops from about 1.4 s to under 500 ms over the visible window", inside the 25 s row. The metric windows (1-minute buckets, 15-second bucket transform in D.3) and the simulator's reaction cannot all complete inside 25 s. The strongest moment has no determined final frame. The recovery should be pre-staged, or the beat re-timed to what is measured.
2. **The 14:05 spike has no clock (C.2 70 to 100 s; A.3; E.4).** A.3 places the spike at "simulated minute 35 after reset" with reset at 13:30. E.4 says the simulator starts "at the scenario offset", and the speed of the virtual clock is not stated. The agent is asked at 70 to 100 s why p95 "jumped at 14:05" in a demo that begins at reset. Either the spike is in the reset history (then the 14:03 change must be backdated in the audit chain, and the doc does not say how that chain stays ordered) or the spike happens live (then it cannot be ready at 70 to 100 s). The "retry-amplification" link from `payments.retry.max` to the simulator is also one sentence: it does not say whether the simulator reads the config live or at history generation.
3. **Driver skip logic conflicts with idempotency (C.4 takeover; D.5 idempotency).** The driver decides which steps are "satisfied" by comparing state digests that include revision numbers. Revisions depend on what the live agent did: a discarded proposal does not bump them, a committed-then-undone change does. The live agent supplies its own keys ("every commit requires an `idempotency_key`"). A live commit under agent key A followed by a replay under transcript key B duplicates the change. A replay that reuses transcript key B with a different body returns `IDEMPOTENCY_KEY_REUSED`, and the replay halts mid-script. The doc's claim that "a commit the agent already made cannot be duplicated" holds only if the live agent is forced onto transcript keys.
4. **The audit chain's concurrency is undefined (D.2 `audit_events`; F.1 and 215 to 245 s "chain verified").** `audit_events` has `prev_hash` and `hash`, and `seq` "from a sequence, gap-checked by verify". The doc does not say how the head is serialized. Two concurrent commits can read the same head and fork the chain, and sequence gaps are expected by the doc's own `verify`. The 170 to 200 s two-writer beat and the closing "chain verified" both depend on this.
5. **The identical-edit outcome is stated two ways (C.2 100 to 130 s; D.5 `change.propose`).** The tool contract returns `status: conflict` for a stale base. The screen text says "Your proposal 600 ms conflicts with Priya's 600 ms (identical). Accept?" and then "identical values auto-merge, so the card closes and the agent's change is recorded as a no-op". Those are two rules. The response a model reads and the card an audience sees must come from one rule.
6. **The tool count contradicts itself (D.5 "Tool catalogue").** The text says `tools/list` returns "the 14 tools below", then lists 19 and says "That is 19 tools." The tool list is what the agent reads for discovery, and the tape depends on frozen names. H.4 places the driver last because the transcript depends on the final tool surface, but no step names the point at which the names freeze. A surface whose count is wrong in the design document will not be frozen cleanly.
7. **The AWS realtime path is the least tested (E.2, G.5).** The event-bus contract suite runs "against NATS and against Kinesis", but "the Kinesis path is tested only in the AWS environment". The realtime fan-out on AWS, which carries the two-screen claims, therefore has no pre-stage test. Kinesis ordering is per shard and changes across resharding, so "per-key ordering" needs a shard-key rule the doc does not give.
8. **Presenter-as-approver weakens the stage's human-in-the-loop claim (H.3).** The doc allows the presenter to act as the approver. The approval is then the presenter's own principal approving an agent's proposal on the presenter's own screen. That is honest if labelled, but the closing line ("every change went through MCP or the UI") does not say it, and an audience will read the approval as a second person.

### Required changes

- Re-time the closing beat to what can be measured, or pre-stage the metric recovery and show the approved change's effect on the next data point the platform actually produces.
- Mechanise the 14:05 spike: state the virtual clock's speed, whether the spike is generated at reset or live, how the backdated change is ordered in the audit chain, and whether the simulator reads the config live.
- Force the live agent onto transcript-bound keys, or bind keys to steps server-side, and define the driver's satisfied-step test without revision numbers.
- Serialize the audit head in the commit transaction, and add a concurrent-commit fork test.
- Pick one rule for the identical edit and state the tool response for it.
- Correct the tool count and freeze the names before the tape is recorded.
- Run the Kinesis path in a pre-stage environment before any claim depends on it, and state the shard-key rule.
- Label the presenter-as-approver case on the screen or in the script.

---

## Comparative section

### Ranking (implementation and live-demo reliability lens)

Weighted composites from the tables above, with my ranking considering reliability and feasibility as the discriminators the brief asks me to press on:

1. **01 Fathom, 7.5.** The most substantive design and the only one whose realtime cursor is correct by construction (HLC plus per-replica sequence). It ranks first on composite but is the least feasible as scoped, and its replay checkpoints conflict with its own feed. Its problems are fixable by a step-gated feed and a cut list. Its scope is the largest risk to finishing.
2. **02 Tessera (visual), 6.9.** The most reliable operational design on paper: the event-only animation rule, the pre-takeover guard, the trace ribbon and the failure table. Its guard needs name-based rebinding, its takeover has no total budget, and its replay re-applies approvals.
3. **03 Parapet, 6.9.** The best governance story and the strongest explanation and refusal design. Its reliability depends on a lock release that is not tied to the script, a feed that skips changes, and a reader that lags writes on AWS only. Those three are each a single fix.
4. **06 Tessera (agent-native), 6.65.** The strongest agent contract and the cleanest closing idea. Its closing beat cannot be timed as written, and its driver's skip logic and audit concurrency are not yet sound.
5. **04 Tessera (emergent), 6.6.** The best composition argument (audit as a source, predicates visible in explain). Its replay is designed to diverge on normal runs, its idempotency is not bound to the transcript, and its reset path is not stated.
6. **05 Lodestar, 6.35.** The most credible premise, with real containers and real faults. Its takeover can revert human work, its two fault mechanisms produce different symptoms, and its replay swaps the data under the audience. The premise is worth keeping; the reliability design needs the most change.

No proposal is disqualified. None embeds an LLM. Each has a fallback design, and each fallback can be made to run against the real MCP path, but for 04 and 05 the fallback as written would be visible to the audience or would revert or diverge state. No proposal has a fundamentally incompatible local and cloud deployment, though 05's fault symptoms and 03's reader lag are differences that the parity claims understate.

### Ideas worth keeping regardless of who wins

- **From 01:** HLC with per-replica sequence numbers for the change feed. The `plan` object that holds diff, validation, permission result, cost, base revision and expiry, committed by id. Attribution as a query result with no cause label. The named executable claims with their tests.
- **From 02:** The event-only animation rule, so every visual change traces to a sequence number or a gesture. The per-row checkpoint with a refusal on hash mismatch and a reset prompt. The trace ribbon that shows every call's status, revision and audit sequence on every screen.
- **From 03:** `permission.explain` computed from the same evaluation as the decision. `POLICY_DENIED` that names the policy and never reveals a value. Database-level RLS behind the policy engine. The tape's refusal on diverged state, with "reset required".
- **From 04:** Audit as a queryable source, so "who changed this" is an ordinary query. `query.explain` that shows the predicates the authorization layer injected. Rule firings keyed by firing ID so that `firing` is a state and a page happens once. `ui.present` as an audited presentation call.
- **From 05:** A fault console whose actions are absent from the agent's tool list. A `FleetAdapter` result that names the mechanism that ran. Reset-aware counter semantics. A fault-to-screen harness that reports distributions from runs and not single targets.
- **From 06:** Approval as a pending changeset that only a human principal can commit. Propose idempotent by content. The `next` field in the response envelope. `access.request` that can only create an approval. `LOOP_SUSPECTED` after repeated identical refusals.

### Cross-proposal requirements for whichever design proceeds

1. A single stage clock for the feed, the fault schedule and the fallback. Every checkpoint, watermark and fault start is expressed against it, and the feed is gated at step boundaries in rehearsal.
2. A commit-order-safe change feed (HLC or visibility-ordered reads), with an out-of-order delivery test.
3. Transcript-bound idempotency: the live agent receives step keys, or steps bind server-side.
4. Name-based rebinding of identifiers in every checkpoint comparison.
5. A total slack budget for the 300 s script, with the per-row windows summing to it and the takeover delay counted against it.
6. A bundled-extension and private-subnet startup test for DuckDB and any other runtime fetch.
7. A cut list for each proposal that names the claims each cut affects, so that the decision to cut is made before the stage does it.
