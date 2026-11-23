# Round 2 review, Reviewer C: implementation and reliability

Scope: the six revised proposals in `C:/dev/showpiece/docs/demo-design/revised/` (01 to 06), read in full against the mission brief `00-mission.md` and against this reviewer's round-1 review. `_superseded/` was not read. Nothing was built or run. Quantities are cited as the proposals state them: labelled targets, scenario parameters, configured limits or derived bounds. Where I computed a figure from a proposal's own numbers, I say so.

Method. For each proposal I checked (a) whether each round-1 item was fixed, partly fixed or left open, (b) whether the revision introduced a new defect, and (c) whether the script's stated timings, call counts and rules are consistent with each other. Where a section contradicts another section of the same document, I cite both. Round-1 items that the proposals restated as "accepted" are marked accepted, not fixed.

Disqualification. None of the six is disqualified. None embeds an LLM. Each has a real-MCP fallback path. None has a local and cloud deployment that is fundamentally incompatible. Two proposals (04, 06) plant the incident's cause in seeded data, and two (05, 06) have AWS-side gaps. These are disclosed or fixable, so they are weaknesses, not disqualifying faults.

---

## Overview

| Proposal | Depth (20) | Composability (20) | Agent (15) | Visual (15) | Credibility (10) | Narrative (10) | Feasibility (5) | Reliability (5) | Weighted |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 01 Fathom | 9 | 9 | 8 | 6 | 8 | 7 | 3 | 6 | 7.65 |
| 02 Tessera (visual) | 6 | 7 | 7 | 8 | 6 | 7 | 3 | 6 | 6.60 |
| 03 Parapet | 7 | 8 | 8 | 6 | 7 | 7 | 4 | 6 | 7.00 |
| 04 Plinth | 6 | 8 | 8 | 6 | 6 | 7 | 5 | 6 | 6.75 |
| 05 Lodestar | 6 | 6 | 7 | 7 | 7 | 6 | 4 | 5 | 6.25 |
| 06 Tessera (agent-native) | 6 | 7 | 8 | 7 | 7 | 8 | 5 | 6 | 6.90 |

Weighted = sum of score times weight, divided by 100, using the brief's weights.

Overall pattern. Round 2 closed most of round 1's implementation defects: commit-order gaps, watermarks in checkpoint hashes, the Cognito token exchange, the `docker pause` symptom mismatch, `revert_to`, the audit-head lock, the replay-privilege defect, and the sim-state checkpoint gap. The remaining problems are narrower but more concrete. Four of six proposals now contain a script beat that contradicts a rule stated elsewhere in the same document (01 kill retry, 02 alert timing, 03 undo set, 04 stale-base outcome, 05 approver rule, 06 clock model). Those are the defects most likely to fail on stage, and they should be fixed before any proposal is scored on its stage behaviour.

---

## 01 Fathom (Systems Complexity)

### Scores

| Criterion (weight) | Score | Justification |
|---|---:|---|
| Depth (20%) | 9 | Seeded byte-identical simulator (D.2, B.1 rows 49, 50), HLC with per-replica sequences, typed IR with unit algebra, Cedar plus RLS rewrite, and a kill-resume chaos test (F claim 5). The depth is real and testable, though much of it is off the stage. |
| Composability (20%) | 9 | Composition map (B.2) where each arrow is a typed reference. The count is internally correct: 51 rows, 39 demonstrated, 12 supporting, with the own/field split matching the rows. |
| Agent / MCP (15%) | 8 | Plan/commit with `base_revs` and `expectedBaseRev`, `did_you_mean` only inside edit distance two (D.3, which the alert beat relies on), structured errors, untrusted-text envelopes. Weakened by the kill beat's dependence on an unowned client retry (weakness 1). |
| Visual / interactive (15%) | 6 | Grid, cross-filter, drill, presence badges, merge chip, locked link, approval card. Impact sits in the data and the audit log more than in the screens. The wall rendering cost is deferred to rehearsal (B-7, accepted). |
| Credibility (10%) | 8 | Named executable claims, a verified count, an honest accepted list (G.5), and a no-cause control workspace for attribution. An expert would still question the MCP-client retry on stage. |
| Narrative (10%) | 7 | Clear arc. The final 30 s still carries three events (kill, retry, verify) plus a status line, which is dense for 30 s. |
| Feasibility (5%) | 3 | Round 1 asked for a cut list and dependency order, and both now exist (H.4, H.6). The base scope is still the largest of the six: Rust core, WASM spec build, a tree CRDT with moves, histogram IVM, Cedar, DuckDB lowering, Redpanda or MSK, MinIO or S3 Object Lock, Keycloak or Cognito, two replicas, Playwright rehearsal. Stage-critical claims (steps 8 to 13) sit late in the sequence. |
| Reliability (5%) | 6 | Round-1 items on checkpoints, the feed, the preloaded history, the fallback refusal rule and the fault point are fixed (see below). Residual: the kill beat's retry is not owned by any component, and the hold duration is unparameterised. |

Weighted: 7.65.

### Round-1 follow-through

- Replay checkpoints differ between runs (C-1, round-1 item 1): **fixed.** Feed gated through `feed.until` (C.3, D.7); watermarks excluded from checkpoints; panels compared only at equal watermarks.
- `why` window moves with agent latency: **fixed.** History preloaded to 14:20 and `watermarkAtLeast` on `query.run` and `attribution.run` (C.0, C.1 120 to 165 s).
- No cut list: **fixed.** H.6 is ordered and names the claims each cut narrows.
- Kill does not force an in-flight commit: **partly fixed.** A fault point `commit.hold_after_wal` now exists (E.4), but the hold duration is "a fixed interval" with no value, and the retry is delegated to the agent client (new defect, weakness 1).
- Fallback has no revert or refusal rule: **fixed.** Per-step precondition checkpoints, replay from the last matching boundary, refusal naming the divergence (C.3).
- Cognito token exchange: **fixed.** Client credentials on both sides (D.6, E.2).
- Four stateful services with no budget: **accepted, not fixed.** The stage profile is listed (six containers and one process, E.4) and its memory is deferred to rehearsal.
- Not addressed: DuckDB extension bundling (cross-proposal requirement 6) and a total slack budget for the script (requirement 5).

### Strongest ideas

1. Preloaded history plus `watermarkAtLeast`, so the "why" answer cannot be produced from partial data (C.0, C.1).
2. Per-step precondition and postcondition checkpoints with replay from the last matching boundary, and refusal when none matches (C.3). This is the most precise fallback rule in the set.
3. Attribution as a query result with a no-cause control workspace that must return `no_dominant_cause` (C.1 120 to 165 s, C.4 rehearsal item 2).
4. The `plan` object carrying base revisions, verdicts, cost and expiry, committed by id (D.8, D.2).

### Concrete weaknesses (most severe first)

1. **The kill beat depends on a retry no component owns (C.1 270 to 300 s, step 3).** The text says "the agent's client retries the same request with the same key." Claude Code does not, as far as this design shows, retry a dropped Streamable HTTP tool call. If it does not, the "replayed: true" moment does not occur on stage. The exactly-once test in claim 5 uses a scripted client, so the stage behaviour is untested. The retry must be issued by the presenter's console or the companion, with the same key, and claim 5 must run through the stage's client.
2. **The in-flight hold is unparameterised and the kill target is unnamed (E.4, C.1 270 to 300 steps 1 and 2).** The hold is "a fixed interval". Nowhere is its length given, nor how the presenter learns which of the two `fathomd` replicas holds the held response. Killing the wrong replica exercises nothing. The stage needs a named replica, a hold length derived from the console's kill latency, and an on-screen replica identity.
3. **The closing beat has no fallback path (C.3, C.1 270 to 300).** The driver replays steps, but the kill is a presenter action and cannot be replayed. If the live agent is slow at P7, the closing has no defined substitute, and the stated claim ("the line holds in either case") depends on the commit completing before the kill, which the proposal does not guarantee.
4. **Scope too large for the stated gating (H.4, H.6).** Fifteen build steps, and the stage-critical claims (kill, attribution, approval, undo) sit in steps 8 to 13. The cut list removes move operations, IVM, redpanda and anchoring, but none of these cuts removes the Cedar or RLS work that the finance beat needs. The shortest rehearsable path is therefore still long.
5. **DuckDB extension loading is not addressed (D.1, D.4).** The engine reads Parquet from S3 in the AWS profile. Extensions for `httpfs` and the S3 path are not stated to be bundled, and there is no private-subnet startup test. Round-1 cross-proposal requirement 6 is not applied.
6. **The local and AWS parity claim understates the Kafka difference (E.2).** The table says MSK and Redpanda share "the same Kafka protocol and client config." MSK in the AWS profile requires IAM SASL; the local broker does not. The parity suite has no row for it.
7. **The live feed runs at 10 scenario seconds per real second (C.0), and this is not disclosed on stage.** "Last hour" windows and "live counters" therefore move about ten times faster than wall time. The audience is not told this, and a sceptical engineer will notice it. This is a credibility issue, not a correctness one.

### Required changes

- Make the retry explicit: the presenter console or companion issues the identical request with `k-fault-hold-1` after the kill, and claim 5 runs through the stage client.
- Name the held replica on the console, give the hold duration as a configured value, and show the replica identity on the status line.
- Define the fallback for the 270 to 300 s beat, or state what the closing shows if P7 fails.
- State that DuckDB extensions are bundled in the image and add a private-subnet startup test.
- Correct the E.2 client-config sentence and add an MSK IAM row to the parity suite.
- Disclose the 10x feed rate on screen or in the presenter note.

---

## 02 Tessera (Visual Spectacle)

### Scores

| Criterion (weight) | Score | Justification |
|---|---:|---|
| Depth (20%) | 6 | Revision store with JSON-Patch deltas, path-level rebase, Cedar, anchored audit chain with verify semantics, per-step predicates and MCP re-issue replay. The engine is thinner than 01 or 04 (no IVM, DuckDB through Node bindings, no Arrow path tested), and the merge is path-level. |
| Composability (20%) | 7 | Two composition chains are real code paths (D.3, D.5). The inventory is over-counted: section B says "49 rows, 38 demonstrated, 11 supporting," but the table has 51 rows, 41 marked Demonstrated and 10 Supporting. Several Demonstrated rows (M07 reset, A01 workflow, D11 lineage) do not appear as a visible row on stage. |
| Agent / MCP (15%) | 7 | Single `commit {preview_token}` path, `screen.present` with queued proposals, scope-filtered tools. Weakened because the preview token is a fresh random value that the replay's response hash would capture (weakness 2). |
| Visual / interactive (15%) | 8 | Strongest visual design of the six: event-only animation, trace ribbon with status, revision and chain sequence on every screen, ghost overlays, phone-width audience session flipping from 403. |
| Credibility (10%) | 6 | Honest framing and labelled targets, but the counts are wrong and the alert timing contradicts itself (weakness 1). |
| Narrative (10%) | 7 | Tight arc. The page beat is undermined by the alert timing, and the closing replay is verifiable but less visceral than a live effect. |
| Feasibility (5%) | 3 | No cut list, which round-1 cross-requirement 7 asked for. Thirteen build steps. Components include Fastify, the MCP SDK, DuckDB with Arrow IPC and Postgres attach, Cedar WASM, a KMS and key registry, an anchor job, uPlot, Dex or Cognito, Redpanda or MSK and Postgres RLS. One language helps; scope is not reduced. |
| Reliability (5%) | 6 | Name-based rebinding (D.9), a 30 s slack pool with remaining slack shown per row (C), per-step satisfaction predicates, privilege re-evaluation on replay (D.10), simulator state in checkpoints (D.11). Residual: replay response hashing, the alert timing, and a 30 s replay budget that is not measured. |

Weighted: 6.60.

### Round-1 follow-through

- Checkpoint IDs absolute, no rebinding: **fixed** (D.9, D.10: names, rebinding table in each checkpoint).
- Takeover adds 20 s per row, no total budget: **fixed** (30 s pool, 8 s grace, read rows detected by expected call names; C and D.9).
- Replay re-applies approval-backed grants: **fixed** (D.10 step 4, held privilege steps, a test asserting an unapproved target).
- Simulator state outside the checkpoint, RNG and Node unpinned: **fixed** (D.11, `sim_checkpoint`, golden vector, pinned Node 22 patch).
- `seq > cursor` commit-order gap: **fixed** (D.4, D.7: sequence taken under the workspace lock, held to commit). A residual gap from rollback is noted in weakness 4.
- Audit hot row, no anchor or verify rules: **fixed** (D.7: anchor cadence, verify semantics, refusals take the lock, reads to `call_log`).
- Sign-and-approve key management: **fixed** (D.6: KMS on AWS, file-mounted key locally, `key_id`, rotation).
- Not addressed: a cut list (cross-requirement 7) and DuckDB extension bundling (cross-requirement 6).

### Strongest ideas

1. Per-step satisfaction predicates instead of whole-workspace hash equality, with reconciliation that reverts only the live agent's own revisions and stops on any human revision in the span (D.9).
2. Checkpoints bound by name, with a stated 30 s total slack pool and remaining slack printed after each row (C, D.9).
3. Replay that re-runs policy for every call and holds privilege steps rather than re-applying them (D.10).
4. The event-only animation rule, so every visual change traces to a sequence number or a gesture (section C, closing note).

### Concrete weaknesses (most severe first)

1. **The alert timing cannot be met by the script's own budgets (R4 and R8, D.2).** R4 moves the rule to `pending`. The D.2 alert declares `for: "2m"`. Pending at R4 (budget window 73 to 85 s) implies firing no earlier than about 193 s, which is after R8 ends at 173 s. R8 nonetheless states "the alert reaches firing in this row or the previous." R8's workflow guard adds a second hold, `firing for 120 s`, so even a page "on firing" cannot land by R8. This is a stage failure as written and the claim on the page beat is wrong.
2. **The replay's response hashes cannot match as specified (D.2 `call_log`, D.10 step 5).** `response_hash` is "over the canonical response with ids replaced by names." `change.propose` and `commit` responses carry a 128-bit random `preview_token` (D.1), and responses carry timestamps and expiry values. None of these is named as excluded. The first propose in replay therefore fails the hash match, and the R13 counter "response hashes matched" cannot read what it claims. The `commit {preview_token}` in replay also needs token rebinding, which the rebinding table (names only) does not cover.
3. **The closing replay has a 30 s budget that is not measured (C, R13).** R13 replays roughly two dozen recorded calls including writes into a blank workspace, with policy re-evaluation and hashing, in 30 s. Budgets are "configuration inputs" to be replaced by measured values before the first stage run. If the measured value is larger, the closing overruns, and the 30 s pool is already charged to any takeover earlier in the script.
4. **Sequence holes from rollback (D.1, D.4, D.7).** `change_event.seq` is taken from a database sequence while the workspace lock is held. A transaction that rolls back after allocation leaves a permanent hole. D.4 says clients "request a snapshot on any gap," so each rollback causes a resync on every screen. Either allocation must be rollback-proof (a counter row under lock, as in 03) or gaps must be declared harmless.
5. **The inventory is miscounted and inflated (section B).** 51 rows, not 49. 41 Demonstrated, not 38. The round-1 finding S4 ("rows marked demonstrated that the stage does not show") is only partly addressed: M07 (reset) and A01 are not visible rows in the timeline.
6. **Approval signing depends on a fresh OIDC session and on Dex (D.6).** The approval must be signed with a key in a 12 s row (R9), using a session whose "max auth age" is five minutes and is checked from `auth_time`. The proposal does not state that Dex in the local profile emits `auth_time`, nor how the verifier is bootstrapped. This is a plausible failure point on the stage's human approval.
7. **No cut order (H, cross-requirement 7).** The "supporting" rows are not an ordered cut list with claims affected, so a shortfall has no defined removal sequence.

### Required changes

- Fix R4 and R8: state the alert's `for`, remove the second 120 s workflow guard or move the page onto the firing transition, and show the arithmetic from `pending` to `firing` against the row budgets.
- Define the response-hash exclusion list (preview tokens, timestamps, expiry values, revision and sequence numbers) and the rebinding rule for tokens.
- Measure the R13 replay now, or cut it to the writes plus checkpoints, and state what the closing shows if replay exceeds 30 s.
- Make `change_event.seq` allocation rollback-proof, or declare gaps harmless and say how clients distinguish a gap from a loss.
- Recount section B and mark Demonstrated only for rows that appear on the stage.
- Add an ordered cut list naming the claims each cut affects.

---

## 03 Parapet (Enterprise Platform)

### Scores

| Criterion (weight) | Score | Justification |
|---|---:|---|
| Depth (20%) | 7 | Cedar decisions with explanations from the same evaluation, RLS generated from the bundle with `FORCE ROW LEVEL SECURITY` and a non-owner application role, a per-tenant counter row as the serialisation point, read-your-writes watermark, and held plans bound to a plan hash. Governance depth exceeds query-engine depth (no IVM, no column-level lineage). |
| Composability (20%) | 8 | 45 primitives with a composition map. The same evaluation decides agent, UI and export, and masks compile into the projection, so one policy change propagates everywhere (B.6 composition 3). |
| Agent / MCP (15%) | 8 | Registry generates `tools/list`, schemas and tape pins (D.8); no commit mode on any tool; `POLICY_DENIED` never returns values and returns the same shape for hidden and absent columns (D.8, F.1); `as` narrowed to the agent's ceiling. |
| Visual / interactive (15%) | 6 | Lock-wait graph and latency heatmap are new and useful. Much of the screen work is still tables, cards and a finance mask. |
| Credibility (10%) | 7 | The "same engine, same rules" claim is checkable. Remaining contradictions (the undo set, fixed counts on screen) would be caught by an expert. The approval card does not label the approver as the agent's delegator. |
| Narrative (10%) | 7 | Five prompts (down from nine) and a refusal-and-undo finale. The finale contradicts itself on what is undone (weakness 1). |
| Feasibility (5%) | 4 | An ordered cut list with claims exists (H.6), which round 1 asked for. The base scope is still wide: Cedar with generated RLS, role and FORCE setup, a three-service orderflow estate with a lock collector, approvals and held plans, a tape driver with a companion, OAuth resource metadata, Aurora with a reader watermark, Keycloak and Cognito. |
| Reliability (5%) | 6 | The lock fault is staged, waiters are asserted at each step, the held plan produces a deterministic `CONFLICT_REV`, the tape refuses diverged state, and the tape types no prose. Residual: the hold is a configured window with no release or extension path during the run, and the script still quotes fixed figures. |

Weighted: 7.00.

### Round-1 follow-through

- Lock fault tied to the script clock: **partly fixed.** The hold is a configured window covering the run plus a margin, reset refuses if it is short, and waiters are checked at each step (C setup, E.4). Nothing can release or extend it during the run (weakness 2).
- Change-feed commit-order gap: **fixed.** Per-tenant `change_seq` counter row under `FOR UPDATE`, dense sequence, two-transaction test (D.3, D.5, F.3).
- Aurora reader lag: **fixed on AWS** (read-your-writes watermark, E.2), with a local description that conflicts with F.3 (weakness 5).
- `as` principal: **fixed** (ceiling intersection, audit of each use, F.1 cases).
- Model-merged title: **fixed** (held plan, deterministic `CONFLICT_REV`, no model merge).
- Closing undo budget and grant attribution: **partly fixed.** A 30 s budget now exists, but the undo set is stated two ways (weakness 1).
- Tape types recorded reply text: **fixed** (no prose replayed; terminal shows driver-labelled tool lines).
- Cut list: **fixed** (H.6, with claims).

### Strongest ideas

1. `permission.explain` computed from the same evaluation as the decision (D.6). It cannot drift.
2. `POLICY_DENIED` that names the policy and principal but never a value, with an identical shape for hidden and absent columns (D.8, F.1).
3. The held plan carries its base revisions, so the platform, not the model, produces the conflict (C 95 to 160 s).
4. The tape refuses on diverged state with "reset required" and labels the driver on screen (C fallback).

### Concrete weaknesses (most severe first)

1. **The closing undo contradicts itself (C 245 to 300 s versus the revision log's Reviewer C row for the 285 to 300 s closing).** The timeline says "the grant to `sre` and the drill-down are not in the undo set, and the audit view shows them as still applied." The revision log says "the grant to `sre` is created by the agent, not approved by Brice, so it is in the undo set." The strongest moment depends on the undo set, and the document gives two answers. The agent's call and the audience's reading will differ.
2. **The lock release cannot follow the script (C setup, E.4).** The fault holds "for a configured window that covers the run plus a margin." A presenter pause or a rehearsal overrun ends the waiters silently. The step check then fails at 95 to 135 s, the moment the main answer depends on, and the only recovery is a reset mid-show. A presenter-callable release or extension is needed, with the reset path shown on screen as the stated recovery.
3. **Fixed figures are still scripted as results (C 160 to 200 s).** "412 of 9,812 rows visible to you," "p99 above 800 ms," and "a***@…" appear as expected visible results. F.5 says the script "asserts shape, not value," and the round-1 fix for the "14 waiters" figure was applied in one place only.
4. **The densest turn is on the approval path (C 160 to 200 s, 8 calls, 45 s).** One prompt asks for a dashboard filter and a column mask, a finance preview, an internal alert, and an external alert that needs approval. A watchdog takeover at 45 s would move the approval into the next frame. This turn should be split.
5. **Local reader behaviour is described two ways (E.3 and F.3).** E.3 says the local database has no reader endpoint and the watermark test "passes trivially." F.3's `reader.watermark` test says lag is "locally by an injected delay." Only one of these is true of the local profile.
6. **The approver is the agent's delegator and the card does not say so (C 200 to 215 s, C setup).** Brice is the delegator, a member of `security`, and the approver. Proposals 02 and 06 label this on screen. 03 does not, so an audience will read the approval as an independent human check.
7. **Route to the AWS reader depends on per-session write positions (E.2).** The read-your-writes rule needs each session's last write position carried across requests and across instances. The proposal does not say where that state lives in a multi-task ECS deployment.

### Required changes

- Resolve the undo set in one place, state the rule (all changes made by the agent principal in the session, including the grant and the drill-down), and make the closing line match.
- Add a presenter-callable release or extension of the lock hold, and show the reset path on screen as the stated recovery if a step check fails.
- Replace quoted counts and percentages with shape assertions, or mark them as rehearsal expectations.
- Split the 160 to 200 s prompt into two turns, with the external alert in its own turn.
- Make the reader description consistent and name the local test that exists.
- Label on the approval card that the approver is the agent's delegator and that four-eyes is off.
- Say where the per-session write position is stored on AWS.

---

## 04 Plinth (Emergent Composition)

### Scores

| Criterion (weight) | Score | Justification |
|---|---:|---|
| Depth (20%) | 6 | One compiler that attaches grant predicates to source relations before any operator, a policy-keyed cache, `as_of` pinning, watermarks published by rename, firing identifiers and one commit transaction. No incremental maintenance (G.5), and the typechecker is the largest module (G.4). |
| Composability (20%) | 8 | Thirteen node kinds, generic verbs, audit and lineage as ordinary sources, rules, forms, exports and row predicates through one compiler. The blast-radius finale is a real composition that the platform did not hard-code. |
| Agent / MCP (15%) | 8 | Fourteen tools with a closed error vocabulary, `did_you_mean` and `available` lists, progress and cancellation, and a pre-registered 13-question gate that can fail. Generic verbs raise discoverability risk, which the gate measures. The stdio path takes a principal argument (weakness 6). |
| Visual / interactive (15%) | 6 | Ops board, exec view, phone window, heatmap, bar, toasts, acknowledge form. Dashboards are plain. |
| Credibility (10%) | 6 | Honest limits list and a recorded decision on the replay tag. Design targets such as "p95 under 200 ms over 2.4 million rows" are still unmeasured, and the 6x virtual-clock arithmetic (weakness 2) would be caught by a careful reader. |
| Narrative (10%) | 7 | Strong "nobody asked the agent" beat and a strong finale. The acknowledge tap is supporting. |
| Feasibility (5%) | 5 | Bundled DuckDB extensions, a Postgres control plane, one language, S0 to S12 with done-when tests. Scope is still wide (thirteen kinds, fourteen verbs, a gate whose failure reopens the surface). |
| Reliability (5%) | 6 | Watermark exclusion, namespaced replay keys with a skip rule, presenter-cued fault with a 5 s scripted fallback, one reset mechanism, bundled extensions. Residual: the stale-base outcome is specified two incompatible ways (weakness 1), and the fault's firing window does not fit at 6x (weakness 2). |

Weighted: 6.75.

### Round-1 follow-through

- Watermarks in replay checkpoint hashes: **fixed** (excluded, recorded as informational, C.3).
- Live agent's idempotency keys not bound to transcript: **partly fixed.** Replay keys are namespaced `replay:<transcript>:<step>` and the driver skips a step whose change hash is present (D.6, C.3). The stale-base beat now contradicts D.8 (weakness 1).
- Fault not cued to the presenter: **fixed** (F7 at the next generator tick, scripted fallback after 5 s, C.3).
- The 14:05 episode has no source: **fixed** (seeded `FaultProfile` in history, tests `episode_in_history` and `backtest_fires_once`).
- Reset mechanism for 2.4 million rows: **fixed** (one snapshot-and-manifest mechanism, `history_reproduces`, target labelled).
- DuckDB extensions fetched at runtime: **fixed** (bundled, `private_subnet_startup` test, E.4).
- Audience-visible replay tag: **fixed by decision** (tag kept, reason recorded in C.3).
- Cut order: **partly fixed.** H.5 gives a prose order that names what is kept, without claims per cut.

### Strongest ideas

1. Grant predicates attached to the source relation before any operator, so joins and unions cannot leak rows, with a differential test that covers both (D.4, claim 2).
2. `query.explain` returns the injected predicates and the result-key parts, and the agent cannot remove them (D.4, D.8).
3. Firing identifiers make `firing` a state, so one notification per firing and no duplicate pages (G.2).
4. A pre-registered gate on the agent surface that is allowed to fail and send the surface back for revision (claim 5, S5).

### Concrete weaknesses (most severe first)

1. **The stale-base beat's specified outcome is produced by two incompatible rules (C 165 to 195 s versus D.8).** C.2 says the engine "rejects the Change with `CONFLICT` and the head value" for the overlapping title path and lets the width path commit at the new revision. D.8 says a commit with a preview token "returns `PREVIEW_STALE` ... if the head moved." Under D.8 the width change is also refused, and the script's partial merge does not occur. The script also says the agent "submits one Change with base r", but agents must commit with a preview token (D.8, claim 3). The outcome of this beat is therefore unspecified, and the live path depends on whether the model re-reads before committing. A held preview token, refused by the engine when the head has moved, would make the outcome deterministic.
2. **The fault's firing window does not fit at 6x (C 215 to 245 s, A).** The live fault starts "a `FaultProfile` of the same type," which the history defines as a ramp from 1.0 to 2.2 over five virtual minutes (14:00 to 14:05). At 6x that ramp alone is about 50 s of wall time, before the three-minute hold (about 30 s of wall time). Firing cannot land inside a 30 s window, and the workflow card "open" at 245 s is not reachable on those numbers unless the live ramp is shorter. The proposal does not state a live ramp.
3. **No total slack budget for the script (C, G.2).** Each 30 s window is a target. A stall in one window is absorbed by speaking over it, and there is no pool, so cross-requirement 5 is not met.
4. **Virtual clock couples every alert to generator throughput (C.2, G.2).** The rule evaluator runs on virtual time, so a slow tick costs wall time directly. G.2 names the stall and a recovery, but no budget.
5. **The stdio path passes identity on the command line (E.3).** `plinth-app mcp --stdio --principal agent:claude-code` is an identity argument at the transport layer, while the HTTP path derives identity from the token. Two identity paths for one agent is an avoidable inconsistency with the principle in D.8 that identity is never an argument.
6. **Cold start is on the stage path for stdio (E.3).** Each client launch starts a container with `docker run`. The start cost is not budgeted, and it occurs when the presenter opens the agent session.
7. **The gate can reopen the surface after the web surface is planned (C claim 5, S5).** A failing gate sends the descriptions back for revision, with no bound on iterations. Every later stage waits on it, and the proposal does not say what happens if the gate fails twice.

### Required changes

- Reconcile D.8's `PREVIEW_STALE` rule with C.2's path-level merge: pick one, state the on-stage outcome from that rule, and make the agent commit with a held preview token so the engine produces the refusal.
- Add a timing table for the 215 to 245 s fault: state the live ramp, the threshold crossing, and the wall-clock arithmetic at 6x, or move the acknowledge beat out of the window.
- Add a total slack budget for the script.
- Move stdio identity to the token and drop the `--principal` argument.
- Budget the stdio cold start and move it before the audience sits down.
- Bound the number of gate iterations and state the fallback surface if the gate fails.

---

## 05 Lodestar (Live Operational Resilience)

### Scores

| Criterion (weight) | Score | Justification |
|---|---:|---|
| Depth (20%) | 6 | Entity store, hash-chained change log under an advisory lock, plan/apply with `expected_version`, one fault mechanism behind a `FleetAdapter`, workflow approval by hash. The query layer is per-dialect, which is narrower than 01 or 04. |
| Composability (20%) | 6 | One command engine and kind registry, but three query dialects (SQL, a PromQL subset, a LogQL subset) do not share an engine. Composition is real within a source and narrower across sources, and the document says so (B.5). |
| Agent / MCP (15%) | 7 | Seventeen tools generated from one definition, `tools/list` filtered by grant and checked against the catalogue (D.8), untrusted-text envelope on every store string whatever its field name, principal never an argument, turn windows with maximum call counts (C.5). Weakened by the approval contradiction (weakness 1). |
| Visual / interactive (15%) | 7 | Live fleet on real faults, an incident board with the annotation at the fault's event time, a drill, a masked table. The spectacle is driven by real data. |
| Credibility (10%) | 7 | Real containers, a real Toxiproxy fault, one symptom in both environments with a conformance test, and a measurement harness that reports distributions. The approver contradiction and an unvalidated Dex dependency lower it. |
| Narrative (10%) | 6 | The incident arc is strong. The closing (a masked table) is the weakest of the six closings, and the approval beat breaks the platform's own rule. |
| Feasibility (5%) | 4 | Eleven core containers locally, plus ECS, RDS, AMP, CloudWatch Logs Insights, Cognito, ALB, a Toxiproxy sidecar and Secrets Manager on AWS. Each source needs a conformance suite on two backends. No cut list. |
| Reliability (5%) | 5 | Round-1 defects on `revert_to`, the fault symptom, the restart reset and snapshot replay are closed. Residual: a rule contradiction that fails the approval beat, a 12 s takeover trigger that cancels slow live calls, an unbounded log query in a timed turn, and an unpinned flag poll. |

Weighted: 6.25.

### Round-1 follow-through

- `revert_to` reverts human work at takeover: **fixed.** Removed. Takeover undoes only the agent's own changes, each with `expected_version`, and refuses on conflict (C.4 step 6, D.7).
- Docker pause and Toxiproxy timeout produce different symptoms: **fixed.** One mechanism in both environments (`timeout` toxic, B.2, E.4), with a conformance check on the symptom.
- AWS restart may not clear the fault: **fixed.** Restart clears the sidecar's toxics and verifies an empty list and a ready service (D.6, E.3).
- Replay swaps live panels to snapshot numbers: **fixed.** No snapshot sources; replay compares structure and the final entity set (C.4, claim 4).
- Three race-dependent conflict beats: **fixed, as one gate-based beat.** Two were removed, and the remaining conflict is produced by the presenter's move between plan and apply (C 135 to 165 s).
- Alert query window not stated: **fixed** (30 s, `for` 10 s, derived bound in F claim 3). The bound assumes VictoriaMetrics and AMP evaluate `rate()` identically, which G.1 disputes (weakness 5).
- Workflow referencing unrunnable actions: **fixed in the rule** (draft until a different principal holding every action grant approves its hash, D.6). The script breaks the rule (weakness 1).
- Logs Insights latency: **partly.** Removed from timed claims, but a log query remains inside the 55 s investigation turn (weakness 2).
- Cross-requirements 5 (total slack) and cut list: **not addressed.**

### Strongest ideas

1. The fault console is absent from the agent's tool list, so a missing grant cannot be probed at runtime (D.8, B.4).
2. One fault mechanism with a stated reset rule per action and a verified result record that names the mechanism that ran (D.6, E.4).
3. Undo restricted to the caller's own changes, guarded by `expected_version`, and takeover built on it, with a refusal when a human change intervened (D.7, C.4).
4. Turn windows with maximum call counts stated in the script (C.5).

### Concrete weaknesses (most severe first)

1. **The approval beat breaks D.6's own rule (C.2 185 to 225 s versus D.6 "Runs").** C.2 has cass press "Approve definition, then Run," and "at step 2 presses Approve step." D.6 says "the approver may not be the principal who started the run." The same principal starts the run and approves its step, so the platform refuses the script as written.
2. **A slow live call is cancelled by the takeover rule (C.4 triggers 5 and 6, D.8).** The 12 s silence trigger fires "between calls where one is expected," and takeover "cancels the live agent's pending calls." The investigation turn (55 s, six calls) includes a storefront log query whose latency the proposal refuses to bound (G.1). A legitimately slow log query therefore triggers a takeover that cancels it, replacing evidence with replay mid-call.
3. **Dex and the local agent path (E.1, D.8, E.5).** The local agent uses the client-credentials grant with a 3600 s token on Dex. The proposal does not establish that the pinned Dex release issues client-credentials tokens. The AWS path (Cognito) is stated to do so. Verify against the pinned version, or use an IdP that is verified to support the grant for the local agent.
4. **The flag poll interval is part of the on-stage timing and is unset (G.4).** The fail-fast beat (110 to 135 s) shows checkout's latency panel dropping after storefront "picks up the flag on its next poll." No interval is given, so the window cannot be checked.
5. **The derived alert bound rests on an unverified equivalence (F claim 3, G.1).** The 31 s and 47 s bounds assume VictoriaMetrics and AMP evaluate a 30 s `rate()` the same way. G.1 says step alignment, staleness and empty-series behaviour differ, and the conformance suite compares results only "within a documented tolerance." The bound is asserted for both environments without a per-environment measurement.
6. **No total slack, and the approval beat has no budget at all (C.5).** Turn windows sum to about 220 s, with the approval (185 to 225 s) carrying no agent budget. A takeover in one turn is charged only to that turn.
7. **The closing is the weakest of the six (C 275 to 300 s).** The final table of masked emails depends on the audience knowing that the orders are from the first fault. The mechanism shown on stage (a column mask) is real but not spectacular, and the closing does not show the platform acting on the system.
8. **The runner mounts the Docker socket read-write for one action (E.2).** A crash or a mistaken call in the restart path has host-level reach. The risk is contained by the grant model, but the mount is wider than the single action needs.

### Required changes

- Fix the approval beat: a second principal starts the run, or cass starts and a different principal approves the step. Re-check the script against D.6.
- Exclude slow-but-live calls from takeover cancellation, or raise the silence trigger for calls already in flight.
- Pin the flag poll interval and show its contribution to the 110 to 135 s window.
- Verify the Dex client-credentials grant against the pinned version, or change the local agent IdP.
- Move the log query out of the 55 s investigation turn, or budget it from a measured value.
- Add a total slack pool and an agent budget for the approval turn.
- Scope the Docker socket to the restart action (for example, a dedicated restart helper rather than the runner).

---

## 06 Tessera (Agent-Native Innovation)

### Scores

| Criterion (weight) | Score | Justification |
|---|---:|---|
| Depth (20%) | 6 | Changesets with base revisions, one equal-value rule, integrity check after rebase, undo as an inverse changeset, a scope grammar with containment and delegation intersection and one test per rule (D.5.5). The engine is SQL with a thin compiler and no IVM. |
| Composability (20%) | 7 | One changeset pipeline for every kind, approvals as changesets, audit and telemetry as sources. Composition across kinds is narrower than 04 and several rows are supporting. |
| Agent / MCP (15%) | 8 | Eighteen tools (manifest-generated), an envelope whose `next` names the likely next call, idempotent propose by content, `LOOP_SUSPECTED`, closed error enum, `access.request` that can only create an approval, and a measured model-in-the-loop run kept separate from the platform's claims (F.5). |
| Visual / interactive (15%) | 7 | War room, ghost overlays, conflict and approval cards, diff, audit timeline, screens. Less spectacle than 02, more legible. |
| Credibility (10%) | 7 | Round-1 contradictions (tool count, identical-edit rule, audit head) are fixed. The clock model is undefined (weakness 1), and the planted incident is disclosed as an accepted limitation. |
| Narrative (10%) | 8 | The closing (an agent-built page whose approved button changes the same chart) is the strongest closing idea in the set, and its timing is now bounded by construction. |
| Feasibility (5%) | 5 | One language, one Postgres, NATS locally, a small service set. The Kinesis path is untested locally, the AWS fallback is undefined, the rebase algorithm is original code (H.2), and there is no cut list. |
| Reliability (5%) | 6 | Predicate-based driver with principal-scoped keys and digests used only for equality, a locked audit head with a fork test, the equal-value rule tested, a Kinesis gate that withholds the claim, and labelled presenter approval. Residual: clock ambiguity, unbudgeted reset, and a per-row budget gap in the first rows. |

Weighted: 6.90.

### Round-1 follow-through

- Driver skip logic depends on revisions and agent-chosen keys: **fixed** (C.4 predicates, semantic digest, keys `tr:<transcript>:<step>`).
- Audit head not serialised, fork risk: **fixed** (D.2 locked `audit_head`, F.4 fork test on the locked and unlocked versions).
- Identical-edit rule stated two ways: **fixed** (D.4, one rule, F.4 test).
- Tool count 14 and 19: **fixed** (18, manifest-generated, D.5.3).
- Kinesis only in AWS, no shard-key rule: **partly fixed.** Shard key stated, and the realtime claim is withheld until a pre-stage Kinesis suite passes (E.2, G.5). The AWS fallback is not defined (weakness 3).
- Presenter-as-approver unlabelled: **fixed** (label on the approval card and in the script, D.5.8).
- 14:05 spike has no clock: **fixed in intent** (T0, seeded commit at sequence 1187 with `effective_at`, C.3). The clock model is still undefined (weakness 1).
- Closing beat timing: **fixed in part.** The bucket rule bounds the drop, but the 30 s rows still have no per-row call or model-time budget (weakness 5).
- Cross-requirement 7 (cut list): **not addressed.**

### Strongest ideas

1. The commit-rule table (A1 to A15) with one test per row, a closed rule set, and per-op classification that blocks split attempts (D.5.4, G.3).
2. Driver satisfaction by semantic predicate, digests used only for final equality, keys scoped by principal (C.4).
3. Propose idempotent by content, and a `next` field on every envelope (D.5.3, D.5.6).
4. A scope grammar with containment and delegation intersection, each rule tested (D.5.5).

### Concrete weaknesses (most severe first)

1. **The clock model is undefined across three clocks (A.3, C.2 80 to 105 s, D.2, E.2).** The simulator runs from a virtual T0 of 14:20 at 1x. Audit timestamps use the database clock (E.2). The seeded commit's `effective_at` of 14:03 is stored on `revisions` only, and `audit_events` has `created_at` alone. The agent's `audit.search since: "-30m"` and the 14:03 annotation both need one clock, and the proposal does not state which clock `since` uses or which field the annotation reads.
2. **Reset is unbudgeted (A.3, E.4).** The reset generates a 120 minute backfill of about 1.44 million events (computed from 200 per second and 120 minutes), writes seed tables, runs migrations and checks a digest, but no reset time target or measurement exists. The presenter's pre-show reset is therefore an unmeasured step.
3. **The AWS realtime fallback names a bus that is not hosted anywhere (H.5).** "The platform ships with NATS on AWS only until it passes." E.1 to E.3 list no AWS hosting for NATS. The AWS path that carries the two-screen claims has no defined fallback, so the claim is withheld rather than replaced.
4. **Agent latency sits inside rows with no call or model budget (C.2 30 to 60 s).** The first row requires five tool calls (`catalog.describe`, `resource.search`, `query.explain`, `change.propose`, `screen.show`) and a human click, in 30 s, with a takeover trigger at 15 s of silence. The proposal says agent slowness is "absorbed by speaking over it," but the silence trigger fires inside the same row.
5. **The closing's final frame has no recovery for the config write (C 268 to 300 s).** The workflow commits `config.change` after the presenter's approval. If that commit is refused (for example by a rate or authorisation error), the caption and the drop never appear, and no driver step or pre-staged alternative is named.
6. **The 14:03 answer is planted and the proposal says so only in part (A.3, G.5).** The seeded commit is what the agent is meant to find, and control scenario B is rehearsal-only. The limitation is accepted in G.5, but the closing and the scatter present the platform as finding the cause, and the audience does not see the control.
7. **The rebase algorithm is the highest-risk component, and its named fallback changes the stage (H.2, H.4, H.5).** The proposal calls the algorithm "the most important piece to get right." The fallback in H.5 rejects concurrent edits to the same document. The 105 to 135 s beat depends on a three-way conflict view produced by the merge path, so under that fallback the beat would show a rejection rather than a merge result, and the script would need rewriting.

### Required changes

- State one clock for `since` and `until`, and the field the 14:03 annotation reads. Give `audit_events` the effective time or document the join.
- Measure reset time and state a budget, or split reset into a pre-show step with a completion check.
- Replace "NATS on AWS only" with a defined AWS fallback, or state that the demo's AWS realtime claim is absent and say what the screens do.
- Add per-row call and model-time budgets to C.2, and a total slack pool.
- Name a recovery for the closing config write, with a driver step or a pre-staged alternative.
- Add an ordered cut list with the claims each cut affects.

---

## Comparative section

### Ranking (weighted, from the tables above)

1. **01 Fathom, 7.65.** The most complete implementation design and the only realtime cursor correct by construction (HLC plus per-replica sequence). It is also the least feasible as scoped, and its kill beat relies on a client retry that nothing owns. Its round-1 defects were largely closed.
2. **03 Parapet, 7.00.** The strongest governance design, with a deterministic conflict from the held plan and a tape that refuses on diverged state. Its closing contradicts itself on the undo set, and its lock hold is not under presenter control.
3. **06 Tessera (agent-native), 6.90.** The most disciplined agent contract and the strongest closing idea. Its clock model, reset budget and AWS realtime fallback are open, and its first row has no budget.
4. **04 Plinth, 6.75.** The best composition argument and the best-designed fallback labelling. Its stale-base beat and its fault window are both specified in ways the rest of the document contradicts.
5. **02 Tessera (visual), 6.60.** The best visual design and a strong event-only animation rule. Its alert timing cannot be met by its own budgets, its replay hashes cannot match as written, and its inventory is miscounted.
6. **05 Lodestar, 6.25.** The most credible premise, with real containers and a real fault. Its approval beat breaks its own rule, its takeover can cancel slow live calls, and its feasibility is the widest on AWS.

Reliability alone, from this reviewer's lens, would order these as 03, 06, 01, 04, 02, 05. The difference from the weighted order comes from 01's depth and composability, which the rubric rewards, and from its kill beat, which the rubric scores at 6.

No proposal is disqualified. Each is buildable in principle. The defects that matter most are the script contradictions in 02, 03, 04, 05 and 06, and the unowned retry in 01. All are editable without changing the proposals' core architecture.

### Ideas worth keeping regardless of who wins

- **From 01:** HLC with per-replica sequence numbers for the change feed. The `plan` object carrying base revisions, verdicts, cost and expiry. Attribution as a query with a no-cause control workspace. History preloaded to the question's window with `watermarkAtLeast`. A byte-identical seeded simulator. The per-step precondition checkpoint with replay from the last matching boundary.
- **From 02:** Per-step satisfaction predicates with reconciliation that reverts only the live agent's own revisions and stops on any human revision. Checkpoints bound by name, and a stated total slack pool with remaining slack shown per row. The event-only animation rule. The trace ribbon showing every call's status and sequence on every screen.
- **From 03:** `permission.explain` from the same evaluation as the decision. `POLICY_DENIED` that names the policy and never a value, with an identical shape for hidden and absent columns. A held plan carrying base revisions so the platform produces the conflict. The tape's refusal on diverged state with "reset required." A per-tenant counter row as the serialisation point, with a rollback-safe sequence.
- **From 04:** Grant predicates attached to source relations before any operator, with a differential test covering joins and unions. `query.explain` showing the injected predicates. Firing identifiers so that `firing` is a state and produces one notification. A pre-registered agent-surface gate that is allowed to fail. Bundled DuckDB extensions with a private-subnet startup test.
- **From 05:** A fault console absent from the agent's tool list. One fault mechanism in both environments with a per-action reset rule and a result record naming the mechanism. Undo restricted to the caller's own changes with `expected_version`. Turn windows with maximum call counts. An untrusted-text envelope on every store string whatever its field name.
- **From 06:** The commit-rule table with one test per row and per-op classification. Driver satisfaction by semantic predicate with principal-scoped keys. Idempotent propose by content. The `next` field on every envelope. A scope grammar with containment and delegation intersection, each rule tested. A queued screen proposal that a human must show.
