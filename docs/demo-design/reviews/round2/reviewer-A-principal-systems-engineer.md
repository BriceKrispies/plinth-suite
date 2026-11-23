# Round 2 review: Reviewer A (Principal Systems Engineer)

Scope: the mission brief (`00-mission.md`), the six revised proposals (`revised/01` to `revised/06`), each read in full, and my round-1 review (`reviews/round1/reviewer-A-principal-systems-engineer.md`). Originals were not needed. Nothing under `_superseded/` was read. Design review only; nothing was built or run.

Notation. "R1 Wn" is my round-1 weakness n for that proposal. "X1 to X9" are my round-1 cross-cutting findings. "X10 to X16" are new in this round. Section references are the proposal's own (for example "01 C.1 205 to 235" is that proposal's script window). Scores are integers 0 to 10. The weighted total is the mission-weighted mean.

Method. For each round-1 item I checked the revised body, not only the revision log. Where a revision log says something is fixed, I checked whether the body says the same thing. Several entries are real fixes. Several are contradicted by the body, and I list those as findings, not as fixes.

---

## Summary

| Rank | Proposal | Round 1 | Round 2 | Movement | Verdict in one line |
|---|---|---:|---:|---|---|
| 1 | 02 Tessera (Visual Spectacle) | 7.80 | 7.80 | flat | Best spectacle and the cleanest session-state split. Its fixes are real, but the stall grace is not shorter than two row budgets it claims to beat, and a global sequence number is used as a per-workspace gap test. |
| 2 | 03 Parapet | 7.40 | 7.25 | down | Strongest governance design and the best tape preconditions. Two places contradict its own revision log (the `as` preview and the undo set), and the delegator approves its own agent's external notification. |
| 3 | 01 Fathom | 7.20 | 7.15 | down | Deepest composable core and the most thorough repair of round-1 consistency items. Its Cedar fragment denies every human commit to `live`, and it still has two conflict semantics for `live`. |
| 4 | 04 Plinth | 6.85 | 7.15 | up | The largest repair: mask set in the cache key, Postgres preview tokens, `as_of` pinning, a seeded episode, principal-scoped keys, a raised gate. The attribution item was relabelled rather than fixed, and grant checks give a cross-principal row-count oracle. |
| 5 | 05 Lodestar | 6.90 | 6.95 | flat | The honest fault mechanism and a clean undo rule. The restart has no principal holding the restart grant, takeover races an in-flight apply, and the claim 3 bound is asserted rather than derived. |
| 6 | 06 Tessera (Harbour) | 6.70 | 6.60 | down | Best-specified rule table and scope grammar. Replayed writes are indistinguishable from live agent writes in the audit, and the auto-commit rule A6 contradicts the agent's own grant list. |

The spread is 0.95 weighted points. Two of the six (01 and 04) tie at 7.15, and 01 is placed above 04 on the tie-break given in the comparative section. No proposal is disqualified.

Movement is driven by how much each revision changed the mechanism versus the wording. 02, 04 and 06 changed mechanisms. 01 and 03 changed mechanisms and then introduced contradictions elsewhere. 05 changed its fault mechanism, which was the right change, and left its takeover and restart semantics open.

---

## Cross-cutting findings (round 2)

These are claims that the persistence model, the transport or the authorization path cannot uphold as written. Several apply to more than one proposal.

**X10. A global sequence number is used as a per-workspace gap test (02, 04).** 02 D.1 defines `change_event.seq` as "assigned from a sequence while holding the workspace lock". 04 D.2 defines `changes.seq` as `bigserial`. Both 02 D.4 and 04 D.6 tell clients to request a snapshot (02) or refetch (04) on any sequence gap. Two consequences follow. A rolled-back transaction that has already drawn a sequence value leaves a permanent gap. And a subscriber to one workspace sees gaps whenever another workspace commits, because the sequence is global. The lock makes the order within a workspace correct, and the gap rule then misreads that order. The fix is a per-workspace counter (02 already has `chain_index`) for gap detection, with the global value kept only as an opaque key.

**X11. Reads that take a principal argument are not bounded (04, 06).** 03 bounds `permission.explain` to the agent and its delegator, and its revision log says why. The same bound is missing elsewhere. 04 `grant.check` accepts `principal` and `with_counts`, and returns `predicate_text`. An agent with read on a dashboard can therefore obtain another principal's row-predicate text and row counts under that predicate. 06 `access.explain` accepts an optional arbitrary `principal`. Both are authorization holes on the MCP path, and both are the class of problem round 1 raised against 03's `as`.

**X12. Replayed writes must be distinguishable in the audit chain (06, and 04 in part).** 01, 02, 03 and 05 mark replayed writes in the chain: `transport: driver` (02), `source: tape` (03), `client = demo-driver` (01, 05). 06 C.4 ("Invisibility") writes replayed and live commits as the same audit row with principal `agent:claude-code`, and puts `driver=replay` "only in the presenter console". 04 C.3 performs replayed human steps (the title edit and the Acknowledge tap) "as Changes through the HTTP API under the presenter's session", with surface `driver`. Replay is then both invisible to an auditor and executed under a human's session.

**X13. Revision logs that assert fixes the body contradicts (02, 03, 04, 05).** 03 says the agent's `as: group:finance` preview was removed, and its timeline still names it at 160 to 200 s. 03 says the grant to `sre` is in the undo set, and its 245 to 300 s row says it is not. 02 says the 8 s grace is "always shorter than a row's budget", and two rows have budgets of 8 s. 04 says the attribution gap is fixed by a "named capability", and that capability is audit attribution, which answers "who did this", not "why did p95 rise". Each of these is small. Together they show that the revision logs were written from intent, not checked against the text. I recommend that every revision-log entry cite the sentence it changed.

**X14. Who executes an approved action, and separation of duties (03, 05, 06).** 05 gives the `runner` no action grant, yet the runner executes `fleet.restart` (see 05 weakness 1). 03's delegator is an eligible approver of its own agent's external notification, and the Cedar forbid is satisfied by its own membership of `security` (see 03 weakness 2). 06 states the same arrangement openly, with four-eyes off. For an enterprise audience, a gate where the requester is the approver is a demonstration of a gate, not a gate.

**X15. The human commit path is not authorized by the policy as written (01).** Default deny plus the only human permit being `acl.grant` means every human `plan.commit` is refused (see 01 weakness 1). This is an authorization failure on the human path, and it is the path the presenter uses for the live title edit.

**X16. A cache keyed without the principal (06).** 06 D.1 keys the engine's in-process cache "by lineage digest". P36 defines the lineage digest as query hash, mask set and result digest. Neither the principal nor the row predicate appears. 02 (D.3) and 04 (D.4) key their caches on the principal's effective predicate, and 01 does too after its revision. 06 has not stated that its cache is safe across principals, so X4 is open for 06.

**Carried over and partly fixed.** X1 (interaction state in the audit): 02 and 06 fixed it (session state, `view_state`) and 03 already had it. 01 did not (cross-filter is "an audited operation", B.1 row 31). 04 is unresolved: its parameter clicks on the Ops board (C.2 100 to 135) are not stated as Changes or session state. X6 (distributed claims): 01 still says "Spec documents are replicated and edited concurrently" (A.1) and its claim 5 is framed as replica tolerance, although its D.2 names the single order. 05 states the honest version. X9 (fault realism): 05 fixed it with a real network mechanism. 03 and 06 are partly fixed (see below).

---

## 01 Fathom (Systems Complexity), revision 2

### Round-1 disposition

| R1 item | Disposition | Evidence in the revised text |
|---|---|---|
| W1 `live` contradiction | Largely fixed; new problem | Agents never write `live`; reaching `live` is a human merge (D.5, D.8). But D.6's Cedar fragment has no human permit on `plan.commit` (weakness 1), and human writes to one register on `live` are last-writer-wins with a `concurrentWrite` annotation, which is a second conflict model beside the refused merge (weakness 2). |
| W2 cache key without principal | Fixed | Key is `(watermark, bindingHash, revId, predicateHash, maskHash)` (D.4). |
| W3 attribution window incomplete | Fixed | History preloaded to 14:20; `watermarkAtLeast` on `query.run` and `attribution.run` (C.0, D.4). |
| W4 concurrency beat not replayable | Fixed | Beat is a merge with a fixed call order (C.1 205 to 235); human-human concurrency moved to claim 1. |
| W5 chain serialisation and replica identity | Fixed | `audit_head` row locked `FOR UPDATE`; fresh replica id per boot (D.2, D.7). |
| W6 read checks and previews | Fixed | Read-side filtering list in D.8; `spec.revert` and `branch.create` are plan operations. |
| W7 Cedar example type-checks | Partly | A schema fragment and two policies were added. The policies still do not permit the human commits the script needs. |
| W8 finance panel hidden without a grant | Fixed by scope change | Row scope via RLS; panel-level visibility stated as not modelled (B.3). |
| W9 exactly-once across kill | Fixed | Commit dedupe on `(principal, idempotencyKey)`; deltas on `(replica, seq)`; claim 5 narrowed to what it tests. |
| W10 overstated capability count | Fixed | Two tiers, exact counts (B.3). |
| X1 interaction state as audit | Not fixed | B.1 row 31 "Interaction is an audited operation"; C.1 205 to 255 "the binding and the click are an audit entry". |
| X6 distributed claims | Partly | D.2 names the order; A.1 still says spec documents are "replicated and edited concurrently". |

### Strongest ideas

- The live-result key with `predicateHash` and `maskHash`, printed by `query.explain`. This is the construction the other proposals should copy, and it is now correct.
- Branch merge as a plan with a merge preview that attributes each property to its author (C.1 205 to 235, D.5). The beat has a fixed call order and is replayable.
- The read-side filtering list in D.8, applied to every read operation, with `ui.focus` delivering only to sessions that can read each target.
- Replica identity per process incarnation, with the sequence allocated under the chain-head lock (D.2, D.7).
- Honest tiering of the capability count (B.3).

### Weaknesses (most severe first)

1. **Human commits to `live` are refused by the policy the document presents.** D.6 has two Cedar permits: an agent `plan.commit` where the target is not `live`, and `acl.grant` for either principal type. The policy is default deny, so a human's `plan.commit` on `live` has no permit. This covers the presenter's title edit (C.1 205 to 235, step 2) and the human merge of `agent/window-2h` into `live` (step 3). D.6's prose says "Human principals with `branch:merge` on `live` may commit it directly", but no permit exists and `branch.merge` is not in the schema. The beat the revision calls deterministic cannot run as written. The fix is one permit per operation kind, with the target and principal conditions stated, and a test that a human commit to `live` succeeds and an agent commit to `live` is refused.

2. **Two conflict semantics for `live`.** D.5 says two human writes to one register on `live` "produce a concurrent-write annotation and keep the loser", which is a silent winner. The same section and B.1 row 15 say a merge with conflicting registers is "refused with a named conflict set… Nothing is auto-won." Both can be true only if they apply to different operations. The document does not say which operation takes which path, and the audience will ask. A human editing a title on `live` while an agent merge touches the same title should give the same outcome whichever order the two arrive in. As written it does not.

3. **Fallback checkpoints and idempotency keys are not deterministic across runs.** C.3 defines a checkpoint as the spec tree hash, "which excludes revision ids and wall time". It does not exclude node identifiers, and the document does not say identifiers are derived deterministically (04 does, with UUIDv5). If identifiers are minted at runtime, `tree_root` cannot match between the recording and a live run. Keys have the same problem. Only P7 specifies a key in the prompt (`k-fault-hold-1`). The commits in P2, P4 and P5 carry keys the agent chooses, so a replayed commit uses a different key, does not return the stored response, and creates a second board or drilldown. "Steps already applied return their stored responses" holds only for prompted keys.

4. **Cross-filter and bind clicks are audit rows.** B.1 row 31 calls the cross-filter "an audited operation (cut 3 removes it)", and C.1 205 to 255 says the bind click "is an audit entry". Every navigation therefore adds a row to the hash chain, and the chain-head lock serialises every click. This is X1, unfixed. The fix is session state, as 02 and 06 have it, with the audit row reserved for the operations that change shared state.

5. **"Replicated" and "exactly-once" language outrun the single-database design.** A.1 says spec documents are "replicated and edited concurrently". Claim 1 proves the CRDT algorithm. Claim 5 tests failover of stateless replicas over one Postgres. The honest sentence is already in D.2 (the `audit_head` row is the order), and the claims should say it. The status line at 270 to 300 reports "zero delta gaps and zero duplicates", which the client's `(replica, seq)` ledger can only verify for subscriptions open during the kill. A subscription that joined after the kill has no ledger, so the status line is a claim about a subset.

6. **The Cedar fragment is not checked against the entities it names.** `acl.grant` is declared `appliesTo { resource: [Object] }`, and the permits use `resource in Workspace::"ws_demo"`. Whether the analyzer accepts that depends on the `Object in [Workspace]` declaration, which the fragment does state, so this is probably valid. But the fragment is not shown to pass the analyzer that the document names. Until it is, "type-checks" in the revision log is an assertion (see weakness 1 for the larger defect).

7. **The approval-gated grant takes effect on the board, not the drill-down.** C.1 235 to 270 grants `dash:ops_board` to the finance group, and says the drill-down "has no grant, so its link is shown locked". That is consistent with grants being per object. But the Finance window also reads the board's queries, and the document does not say whether the board's grant also authorises the source read or whether source reads are granted separately. The finance count (2 of 6 warehouses) depends on that answer.

### Required changes

- Add permits for human `plan.commit` on `live` and for `branch.merge` into `live`, with their conditions, and test both principal types.
- Choose one conflict rule for a register on `live` and state which operations use which path.
- State that node identifiers are derived deterministically (for example UUIDv5 over workspace and slug), and that every key used in the recorded script is prompted or derived from a stable name.
- Move cross-filter and bind state to session state, and keep audit rows for operations that change shared objects.
- Replace "replicated" in A.1 with the single-order statement, and scope the status-line claim to subscriptions open for the whole run.
- Show that the Cedar fragment passes the analyzer it names.

---

## 02 Tessera (Visual Spectacle), revision 2

### Round-1 disposition

| R1 item | Disposition | Evidence in the revised text |
|---|---|---|
| W1 fallback guard refuses divergent state; grace too long | Fixed in design; a new defect at the boundary | Per-step satisfaction predicates; reconciliation reverts only the live agent's revisions since the checkpoint (D.9). Grace is 8 s, but rows R3 and R7 have 8 s budgets (weakness 2). |
| W2 parameters and drills are revisions | Fixed | `param.set` removed; session state in the URL and screen session (D.12). |
| W3 chain serialisation and global anchor | Fixed | `audit_chain` row locked `FOR UPDATE`; anchor every 60 s or 500 events (D.7). |
| W4 screen tool name and preview mechanisms | Fixed | `tessera.screen.present` only; `preview_token` for every write; `dry_run` removed (D.8). |
| W5 policy and grant storage | Fixed | `policy`, `grant_request`, `approval`, `signing_key` tables and hot-load steps (D.1, D.6). Signature issue remains (weakness 4). |
| W6 page on `resolved` | Fixed | Pages on `firing`; recovery is a `recovery_notice` (A02, R12). |
| W7 screen principal authority | Fixed | Display scope plus read on the target (D.6, D.8). |
| W8 claim 5 hash includes live results | Fixed | Claim 5 hashes documents, revisions, grant and approval records, and simulator control fields (F). The simulator fields are unclear in the blank target (weakness 5). |
| W9 every read is a chain row | Fixed | Reads go to `call_log`, unchained (D.7). Refusals still take the chain lock (weakness 3). |
| W10 degradation is a presenter key | Partly; accepted | The degradation is a recorded control event; the key trigger is an accepted limitation (G). |
| X2 chain head | Fixed | As W3. |
| X5 approval premises | Fixed | Approval and grant records are verified by the policy service (D.6). |

### Strongest ideas

- Animation driven only by sequence-numbered events or gestures, with the rule stated (design mandate). This keeps the spectacle honest.
- Parameters, brushing and drill as session state in the URL, with no revision and no chain row (D.12). The cache key changes exactly when the parameter does.
- One preview mechanism: every write returns a single-use `preview_token` stored in Postgres and consumed in the commit transaction (D.2, D.8).
- Replay that re-issues recorded calls, matches response hashes and re-evaluates privilege calls, with a separate stored-patch view labelled as a different claim (D.10).
- Per-step satisfaction predicates, which make the takeover decision a function of current state rather than of the live agent's identifiers.

### Weaknesses (most severe first)

1. **Global sequence numbers are used as a per-workspace gap test (X10).** D.1 defines `change_event.seq` as a sequence value drawn under the workspace lock, and D.4 tells each client to "request a snapshot on any gap". A rolled-back transaction leaves a permanent gap, and a sequence shared by three workspaces leaves gaps in every workspace's stream. The lock keeps order correct inside a workspace; the gap rule then reports false gaps and triggers snapshots on normal traffic. This is a correctness claim about screens ("never sees a higher sequence before a lower one") that the gap rule undermines in practice. The fix is the per-workspace `chain_index` for gap detection.

2. **The stall grace is not shorter than every row budget.** The revision log says the 8 s grace "is always shorter than a row's budget", and C says it is "shorter than every row budget". The budget table gives R3 and R7 budgets of 8 s. At 8 s the stall detector and the row's end coincide, so a row can be taken over at the moment it would have finished. The invariant should be checked by the registry, not asserted in prose: grace strictly less than the minimum budget, with the test in the rehearsal manifest.

3. **Refusals take the chain lock, so a refusal loop serialises writes.** D.7 says "Refusals take the same lock", and D.1 writes refusals to `change_event`. The round-1 hot-row argument (W9) was about reads and was fixed for reads. It applies again to refusals: an agent that repeats a refused call holds the workspace's lock for each refusal, delaying committed writes in that workspace. The document needs a refusal rate bound on the chain (or a per-principal cap), not just a general rate limit.

4. **The approval signature is produced by the server that records the approval.** D.6 step 2 has the server write the approval row, then "sign the canonical form with the platform key". The signature proves the record was not altered by a party without the key. It does not prove a human approved, because the server both receives the approval and signs it. The accepted-limitations paragraph says the signature "does not claim a hardware-held human key", which is correct, but the revision describes the signature as evidence of approval. The claim should be restated as tamper evidence on the platform's own record, and the authorisation should stay with the RLS and policy check.

5. **The claim 5 simulator checkpoint has no counterpart in the replay target.** F claim 5 compares "simulator control and PRNG fields" at each checkpoint. The replay runs into `blank-2`, which has no defined simulator state. Either `blank-2` runs its own simulator from the same seed (and the consumer offsets, which depend on feed timing, must be excluded), or the simulator fields are not part of the replay claim. As written the comparison has nothing to compare against.

6. **Screen parameter and presence events are not checked against the read policy after a grant.** D.6 requires read on the target for `screen.present`, and checks it at presentation. A subscribed screen that loses a grant receives the next event unless "policy changes trigger a re-evaluation of open subscriptions" is implemented. The document states the re-evaluation in G.1 for 03, not for 02. The on-stage case (the grant at R9 is an addition, not a removal) does not exercise it, so the gap is in the claim, not the demo.

7. **Paging and recovery names are right; the composition of the approval beat is not.** The R9 grant request is created by the agent and approved by a human on screen P, a privilege change that D.6 says a human commits "through the UI, with a fresh OIDC session of five minutes or less". The document does not say how the presenter's session freshness is checked on a shared display, and the approval and the screen share a browser session. This is a small defect, but it sits on the one human commit in the script.

### Required changes

- Use the per-workspace `chain_index` for client gap detection, and treat the global sequence as an opaque ordering key.
- Make the stall grace a registry-checked invariant: strictly less than the smallest row budget, with the 8 s rows changed or the grace lowered.
- Bound refusal writes to the chain per principal, and state the bound.
- Restate the approval signature as tamper evidence over the platform's record, not as evidence of human action.
- Either give `blank-2` its own simulator run and exclude feed-timed offsets, or remove simulator fields from claim 5.
- State the subscription re-evaluation rule for screens when a grant is removed.

---

## 03 Parapet, revision 2

### Round-1 disposition

| R1 item | Disposition | Evidence in the revised text |
|---|---|---|
| W1 `source.describe` lists hidden columns | Fixed | Returns only visible and masked columns; `row_scope` says hidden columns are "not listed and not described" (D.8). Denial shape is the same for hidden and absent columns (test `denial.indistinguishable`). |
| W2 `as` names another principal | Fixed in rules; the timeline disagrees | `as` is intersected with the agent's ceiling and audited (D.6). The 160 to 200 s row still names `as: group:finance` (weakness 1). |
| W3 commit-mode writes | Fixed | One write path: `<kind>.plan`, then `plan.apply(plan_id, plan_hash, idempotency_key)`. |
| W4 approval resumption and table | Fixed | `approval` table bound to `plan_hash`; resume path, stale and expiry rules (D.3, D.8). |
| W5 RLS bypass by ownership | Fixed | `parapet_owner` NOLOGIN; `FORCE ROW LEVEL SECURITY`; `parapet doctor` checks (D.3, E). |
| W6 chain serialisation | Fixed | `change_seq` row locked `FOR UPDATE`; `last_seq` updated in the transaction, so a rollback leaves no gap (D.5). The row is correct: an update rolls back with its transaction. |
| W7 workflow step ceiling | Fixed | `workflow.plan` checks each step type; `http_call` refused for agents (D.8). |
| W8 lock injected by a script | Partly | The lock is taken in the payments reconciliation path. Its start is scheduled by reset and announced by an `ops.events` row from the same service (weakness 4). |
| W9 tape tolerance | Fixed | Exact normalised-state preconditions; shape checks are boolean (C, F.5). |
| W10 visual ambition | Partly | Heatmap and lock-wait graph added. Most beats are still cards and tables. |

### Strongest ideas

- The plan hash covers the canonical after-state, the base revisions, the decision ids and the policy bundle version, and apply re-checks each (D.8). This is the strongest write-path construction in the set.
- Explanations computed from the same evaluation as the decision (`permission.explain`), so they cannot drift.
- Refusals as audit rows (`new_rev = NULL`), and refusal text that names the column and policy but not restricted values.
- Tape preconditions that are exact hashes, `expect` checks on real responses, and a refusal that prints `reset required` rather than a wrong screen (C, fallback).
- Interaction as URL state (D.5, D.9), so a cross-filter is not a write.

### Weaknesses (most severe first)

1. **The revision log contradicts the body in two places that change the stage.** (a) The 160 to 200 s row lists the agent call `query.preview (as: group:finance, limit 5)`. The self-correction list says "Removed the agent's `as:group:finance` preview from the finance-window count". The row was not changed. (b) The Reviewer C response says "the grant to `sre` is created by the agent, not approved by Brice, so it is in the undo set". The 245 to 300 s row says "the grant to `sre` and the drill-down are not in the undo set, and the audit view shows them as still applied". These two describe different stage outcomes. The second decides what the audience sees revert. Either is defensible; the document has both.

2. **The delegator approves its own agent's external notification.** The principal table makes `brice` the agent's delegator and an eligible approver through `security` membership. The Cedar forbid on `notify_external` is satisfied by `context.approved_by in Group::"security"`, and `brice` is in `security`. The on-stage approval at 200 to 215 s is therefore given by the person who asked the agent to post the alert. A governance demonstration cannot show a gate whose approver is the requester. Either require a second approver on stage, or add a four-eyes condition (06 has an option for this) and show it off with a stated reason.

3. **Audit reads have no stated bound.** `audit.search` takes `actor` and `on_behalf_of` filters, and the text states a read bound for `permission.explain` only. An agent can therefore search other principals' audit rows, including the finance window's activity and the approver's. This is X11 for the audit surface.

4. **The lock is labelled by the platform's own source.** The transaction path is real, which is good. But reset stages the reconciliation job at a configured offset, the job's start is an `ops.events` row ("reconciliation started" with the table name), and the slow settlement stub is a deliberate delay. An engineer reading the lock graph sees the cause in the event stream the platform itself writes. The fix is to leave the cause unlabelled, with the start visible only as an observation of `pg_stat_activity`, and keep the scheduled version as a fallback.

5. **Denial text is an oracle for the existence of a restricted source relation.** The shape is the same for hidden and absent columns, so the column's existence is not revealed. But the policy id names a source-level policy (`policy:hr-comp-restricted`), and that policy id is shown to the agent. A reader of the agent's responses learns that `hr.compensation` has a restricted policy. The document accepts this in G.1. It should be stated as the one visible fact, and the test should assert that the policy id is returned only when the relation itself is visible to the caller.

6. **The finance count depends on an `as` call the timeline still makes.** The finance window's "412 of 9,812 rows" is produced by the finance window's own query, as the revision says. The 160 to 200 s row still has the agent previewing with `as: group:finance`. Two queries are shown for one number, and the rehearsal check in F.1 compares only one of them with the direct SQL count. The stage needs one source for the figure.

7. **The approval resume is correct on paper and untested in the stage path.** D.8 says an approved plan is applied "as the agent principal with the approver recorded", and a moved base returns `APPROVAL_STALE`. The stage's approval (200 to 215 s) happens with no concurrent change, so the stale path is not exercised on stage and no claim covers it. The rehearsal should assert the stale path once, so the approval card's "stale" state is known to work.

### Required changes

- Make the 160 to 200 s row and the self-correction list agree, and use one query for the finance count.
- Make the 245 to 300 s row and the Reviewer C response agree on the `sre` grant, and say which rule decides it.
- Remove the requester as the only security approver for the external notification, or state the four-eyes condition on stage.
- Bound `audit.search` reads to the caller and its delegator, consistent with `permission.explain`.
- Make the lock cause unlabelled in `ops.events`; keep the scripted version as a labelled fallback.
- Add a rehearsal assertion for the stale approval path.

---

## 04 Plinth (Emergent Composition), revision 2

### Round-1 disposition

| R1 item | Disposition | Evidence in the revised text |
|---|---|---|
| W1 cache key omits mask set | Fixed | `policy_hash` covers workspace predicate, row predicate AST, mask set and mask version; `cache_isolation` (D.4). |
| W2 node locks do not protect the chain | Fixed | `workspace_chain` row locked first in every commit (D.6). |
| W3 preview tokens in Redis | Fixed | `preview_tokens` in Postgres, consumed in the commit transaction (D.2, D.6 step 3). |
| W4 generator parked, replay diverges | Fixed | Every query carries `as_of`; results use events at or before it; watermarks excluded from hashes (C.3, D.4). A residual late-data gap remains (weakness 6). |
| W5 14:05 answer has no documented cause | Fixed | Seeded `FaultProfile` in history; `episode_in_history`, `backtest_fires_once` (A, F claim 5). |
| W6 `source.sample` bypasses the compiler | Fixed by removal | Sampling is `query.run` with `limit` (D.7). |
| W7 idempotency keys workspace-scoped | Fixed | Keys are `(workspace, principal, key)` with a request hash (D.2, D.6). |
| W8 central bet gated at two of ten | Fixed | 13 questions, composition questions included, pass rates pre-registered, evaluation before surface freeze (F claim 5, H.4 S5). |
| W9 attribution not a named primitive | Not fixed; relabelled | G1 "Audit and attribution" is who-did-what. The 60 to 100 s answer is a breakdown query (weakness 3). |
| W10 Redis carries too much | Fixed | Redis carries presence and fan-out only; the outbox is in Postgres (D.2, D.6). |
| X1 parameters as revisions | Unresolved | Clicks that set `region` and `carrier` (C.2 100 to 135) are not stated as Changes or session state. |

### Strongest ideas

- The cache key with the mask set and the grant-index version, and the `cache_isolation` test (D.4).
- Preview tokens and idempotency records in the commit transaction, with `PREVIEW_STALE` and `PREVIEW_REQUIRED` distinguished by a follow-up read (D.6).
- `as_of` pinning and the watermark wait, which make replayed query results a function of the recorded virtual time (C.3).
- A seeded fault profile that is the same type as the live fault, so the 14:05 history and the live incident share one causal path.
- A closing query that composes lineage, orders and audit into a blast-radius panel, with each count linked to its query (C.2 270 to 300). It is the most checkable closing in the set.

### Weaknesses (most severe first)

1. **`grant.check` is a cross-principal row-count oracle.** D.7 tool 13 takes `principal?` and `with_counts`, and returns `predicate_text`, `column_mask` and `row_counts`. An agent with read on a dashboard can ask for another principal's predicate text and the row counts under it. This is an authorization hole on the MCP path, not a documentation gap. The fix is to bound `principal` to the caller and its delegator, withhold `predicate_text` from the agent, and return counts only for the caller's own scope.

2. **The replay driver performs human steps under the presenter's session.** C.3 says the title edit and the Acknowledge tap are "replayed as Changes with surface `driver`, not as UI clicks", and the "what the driver does not do" paragraph says "Human steps are performed as Changes through the HTTP API under the presenter's session". The fallback therefore holds a human's session, writes as that human, and labels the write `driver`. The brief requires the fallback to be the real MCP path for agent calls. Human steps are not MCP calls, and 01 keeps them out of replay. The fix is to treat human steps as presenter actions, or to give the driver a principal with no human grant and a visible label.

3. **Attribution is not a named causal primitive.** The round-1 item asked for a primitive that answers "why did p95 rise". G1 in the revision is "Audit and attribution (append-only, hash-chained change log with actor, on-behalf-of, surface, session)", which answers "who did this". The 60 to 100 s answer is a breakdown by carrier and region against a baseline, plus an audit query that returns zero rows, and the agent may only quote on-screen numbers. That is an honest query-based answer, and it is not what the revision log says it fixed.

4. **Sequence gaps trigger refetches (X10).** D.6 realtime says "On a sequence gap the client refetches", and `changes.seq` is a `bigserial` drawn at insert inside the commit transaction. A rolled-back commit leaves a gap, and a single-workspace subscriber sees gaps when another workspace commits. The refetch rule makes both into refetch traffic, and the presenter's wall would show it under load.

5. **Text fields are last-writer-wins with no conflict record.** B.2 V9 says "Text fields use last-writer-wins with the conflict surfaced". D.6 says "Text fields use last-writer-wins, and the demo shows that path". G.5 says "Two edits to the same text are not merged." A last-writer-wins write with no conflict record is a silent overwrite of the first writer's text. The B table promises a surfaced conflict that the merge rule does not produce.

6. **The `as_of` guarantee has a late-data gap.** C.3 says the rows at `as_of` are a function of the seed, the fault ticks and `as_of`, and that the engine "waits until the source watermark reaches `as_of`". A partition whose events are earlier than `as_of` but which is published after the watermark has passed `as_of` would change the rows at `as_of` after a step has recorded its hash. The document does not state the late-data rule (for example, a rejection of late partitions, or a bound on lateness). The hash guarantee holds only if no such partition exists, and the document should say that the generator guarantees it.

7. **Parameter clicks are not classified (X1).** The Ops board's `region` and `carrier` clicks (C.2 100 to 135) are written as "sets `region=EMEA`, `carrier=Crane`, no agent call". The document does not say whether a click is a `Change` (which would make it a revision and a chain row) or session state (which would not). The composition claim "click-to-set and cross-filter are the same mechanism" (P5) depends on the answer.

8. **Redis presence can be lost without a stated consequence to the audit.** The stage note says "Redis down: presence badges disappear; commits do not depend on Redis". That is correct. But the outbox recovers fan-out "on resume", and resume is a client action. A screen that is not reconnected never receives the missed events, and the document does not say the screen will show "stale" in that state. The G.2 mitigation names a recovery, not a visible state.

### Required changes

- Bound `grant.check` to the caller and its delegator; remove `predicate_text` from the agent surface; return row counts only for the caller's scope.
- Remove human steps from the replay driver, or give the driver a label and a principal with no human grant.
- Rename G1 to what it is, and either add a causal decomposition primitive or describe the 60 to 100 s answer as a breakdown query without the attribution claim.
- Use a per-workspace counter for gap detection.
- Make the text-field rule say "silent last-writer-wins" or add a conflict record for text.
- State the late-data rule that makes the `as_of` hash sound.
- Classify parameter clicks as Changes or session state, and say which.

---

## 05 Lodestar (Live Operational Resilience), revision 2

### Round-1 disposition

| R1 item | Disposition | Evidence in the revised text |
|---|---|---|
| W1 paused process cannot produce its metric | Fixed | Toxiproxy `timeout` toxic (blackhole) on the storefront-to-payments path in both environments; the alert reads storefront's caller-side metric; `nodata` state (A.1, B.2, D.4). |
| W2 `revert_to` reverts human edits | Fixed | `revert_to` removed; undo is restricted to the caller's own changes, guarded by `expected_version`; refused undo refuses takeover at that checkpoint (C.4, D.7). |
| W3 agent-authored restart runbook | Fixed | A workflow with an action step is a draft until a different principal holding each action grant approves its hash (D.6). |
| W4 two conflict mechanisms | Mostly fixed | One mechanism; plans carry `base_versions` and undo carries `expected_version`. Two names for one mechanism (weakness 5). `rebase` removed. |
| W5 fault console principal | Fixed | `ada` holds `action:fleet.fault` and `action:fleet.fault.clear` (A.2). |
| W6 replay swaps metrics silently | Fixed | No snapshot sources; live data; the agent chip shows `live` or `replay` (C.4). |
| W7 latency budget on a scrape that does not run | Fixed with W1 | The budget is rebuilt on storefront's scrape (F claim 3). The derivation is weak (weakness 4). |
| W8 approval table | Fixed | `approval` table with subject, card, state, resolver and resolution change (D.2). |

### Strongest ideas

- A real network fault through a real mechanism (Toxiproxy blackhole), identical in both environments, with the caller-side metric that survives it. This is the right answer to the paused-container problem.
- Undo restricted to the caller's own changes, guarded by version, with takeover built on undo rather than on revert. Human work is never inverted.
- Action-bearing workflows as drafts that need a second principal's approval of the definition hash.
- A tool list filtered by grant, so the agent cannot see `fleet.fault` (D.8).
- `nodata` as a named alert state that does not close an incident.

### Weaknesses (most severe first)

1. **The restart has no principal that holds the restart grant.** A.2 gives `runner` only "runner-scoped writes to `status` and workflow runs". D.6 gives `action:fleet.restart` only to `cass`. C 185 to 225 says the runner "runs `fleet.restart` on payments". The document does not say whether the executing principal is the runner (which then needs the action grant, and so every approved workflow can run any action the runner holds), or the approver's grant is carried into the run (which the approval table does not record). This is the one action in the demo that changes production state, and its authorization is not specified.

2. **Takeover races an in-flight apply.** C.4 step 6 says the driver "cancels the live agent's pending calls" and then undoes "the live agent's own changes made after the checkpoint". Cancellation of an `apply` that is already inside its transaction is not defined here (04 and 06 define it; 05 does not). If the driver reads the change log while an apply is mid-transaction, the apply commits after the scan and survives takeover. The driver then resumes the recording on a state it believes was reverted. The fix is a fence: take the workspace's chain lock, or read the chain head until it is stable, before the undo scan.

3. **The Docker socket in `app-runner` is host-level authority outside the platform's policy.** E.2 says `app-runner` mounts the Docker socket read-write "for the restart action". A process with that socket can create containers and mount host paths. Every code path in `app-runner` (the alert evaluator, the workflow executor, the snapshot scheduler) inherits that capability, and the platform's grant model does not bound it. For an enterprise audience this is the first question a security reviewer would ask. The fix is a constrained restart adapter that accepts only the payments service, or a separate process with the socket and no other responsibilities.

4. **The claim 3 bound is asserted, not derived.** The table gives "Ratio reaches the threshold: 6 s, threshold 0.2 × window 30 s, under steady offered load to payments". The ratio is dimensionless; `0.2 × 30 s` is a duration of failed calls, not a time to threshold. The counter increments when a call completes, so the first timeouts appear only after the 2 s deadline, and the 6 s term depends on the offered rate, which is not stated. Either show the arithmetic from the counter and the rate, or measure the term and label it as measured. The rest of the sum (5, 5, 10, 2, 1) is a worst-case sum and is correctly labelled.

5. **Two names for one mechanism.** D.5 says "every write carries `base_versions` from its plan (or `expected_version` for undo)". The revision log says "one mechanism: `expected_version` per entity". The semantics are the same, but a reader checking the one-mechanism claim finds two field names and two error codes (`E_VERSION_CONFLICT` for both, but the plan path also has `E_PLAN_EXPIRED`). Name one.

6. **Replay is structural, but the alert sequence it checks is timing-dependent.** Claim 4 requires the same alert transition sequence (`ok`, `pending`, `firing`, `resolved`) on a live replay. The fault is applied at the presenter's cue, and the single-fault rule refuses a second injection. If the cue arrives while the alert is in `pending` from an earlier fault, the sequence differs. The structure check should state its precondition (a clean alert state at the step start).

7. **The approved restart is not in the undo set, but the rollback of the flag is.** C.2 255 to 275 undoes the flag by its own change and says the checkout deadline "returns to unmodified behaviour". The restart at 185 to 225 is a runner action and has no inverse. The document does not say so on stage. The G.5 list says undo covers the principal's own changes. It should also say that actions are not reversible by undo, so a reviewer does not assume the restart is reversed by the flag undo.

### Required changes

- Name the executing principal for an approved action, record it in the approval, and give the runner no action grant (or document why it has one).
- Define cancellation for an in-flight apply, and fence the takeover undo scan on the chain head.
- Replace the Docker socket on `app-runner` with a restart adapter scoped to the payments service, or isolate it in a separate process.
- Show the claim 3 threshold term from the counter arithmetic and an offered rate, or measure it.
- Use one name for the stale-write mechanism.
- State the precondition for the claim 4 alert-sequence check.
- Say on stage, or in the stage note, that actions are not reversed by undo.

---

## 06 Tessera (Harbour, Agent-Native), revision 2

### Round-1 disposition

| R1 item | Disposition | Evidence in the revised text |
|---|---|---|
| W1 takeover keys the live agent never used | Largely fixed; a new gap | Predicates decide what runs; keys used only when a predicate is false (C.4). A recorded create can collide with a partly created object, and the document does not say what happens (weakness 5). |
| W2 auto-commit undefined | Fixed with a table | Rules A1 to A15, one test each (D.5.4, F.2). But A6 contradicts the agent's grants (weakness 2). |
| W3 idempotency and propose not principal-scoped | Fixed | `UNIQUE (principal, idempotency_key)`; propose identity `(principal, base, ops_hash)` (D.2, D.5.6). |
| W4 stall trigger blind to reads | Fixed | `mcp_calls` row for every tool call, reads and refusals included (D.5.2, C.4). |
| W5 chain head not serialised | Fixed | `audit_head` row locked `FOR UPDATE`; no sequence object (D.2). |
| W6 scope grammar | Fixed for matching; open for creation and delegation | Closed verbs and kinds; selector matching; deny precedence; containment (D.5.5). Creation and label delegation are undefined (weakness 3). |
| W7 presence without read check | Fixed | `presence.list` and the presence bar filter by read (D.5.7). |
| W8 preview and changeset rows shared | Fixed | RLS on `changesets` (D.2). |
| W9 parameter state in the write path | Fixed | `view_state`, no revisions (D.2). |
| W10 Kinesis untested locally | Accepted with a gate | AWS realtime claim withheld until the Kinesis suite passes (E.2). |
| X4 cache keys omit principal | Not addressed | Engine cache keyed by lineage digest (D.1; weakness 7). |

### Strongest ideas

- A closed rule table for agent writes, each rule with a test and each commit card showing its rule id (D.5.4). This makes "what the agent may do alone" a property of the write path.
- A closed scope grammar with deny precedence and containment, and the delegation intersection recomputed on each call (D.5.5).
- Approval as a changeset state the agent can see and cannot commit (P22, D.5.8).
- An error envelope with a machine-usable `fix`, and a `LOOP_SUSPECTED` response after repeated refusals (D.5.10).
- `screen.show` defaulting to `queued`, so a proposal reaches a shared screen only after a human clicks Show (D.5.3). This is the correct default for a shared display.
- Stall detection from the server's own call log, so reads count (C.4).

### Weaknesses (most severe first)

1. **Replayed writes are indistinguishable from live agent writes in the audit chain (X12).** C.4 "Invisibility" says live and replayed paths "write the same audit rows, with principal `agent:claude-code` and an attribute `driver=replay` shown only in the presenter console". The audit chain is the record an enterprise reviewer reads, and it would show a replayed commit as an agent decision with no marker. The other five proposals mark replay in the chain. This is an attribution integrity defect, and it contradicts the brief's requirement that agent changes be "attributed, reviewable and reversible". The fix is a `driver` transport or replay flag in the chain row, not in the console.

2. **Rule A6 auto-commits a change the agent is not granted to make (C.2 160 to 185 s and C.1).** C.1 lists the agent's delegated scopes: `write:dashboard`, `read:source:telemetry`, `read:source:audit`, `write:alert`, `show:screen` and `run:action` (dry run). C.2 says the agent commits "add column mask `customer_email` on source `orders`" as auto-class rule A6. Source writes are in no granted scope. A source-wide mask also changes what every principal sees, including the finance board in the same beat. Either grant `write:source` (and treat it as an approval-class operation) or move A6 to approval. As written the rule table and the scope list cannot both hold.

3. **Scope selectors do not cover creation, and label delegation drops grants.** D.5.5 defines three selectors: `*`, an identifier, and `label:<key>=<value>`. An agent creating `dash_oncall` has no identifier or label to match before the create, and the labels are set by the operation itself. Containment is "provably contained" only when the delegator has `*` or an identical selector, and "anything not provably contained is dropped". Brice's delegation is not stated. If it is a label selector, the agent's identifier-scoped grants (for example `write:dashboard:dash_war_payments`) are dropped in the intersection even when the dashboard carries the label. The F.2 grammar tests cannot be written without these rules.

4. **`access.explain` accepts an arbitrary principal (X11).** D.5.3 tool 15 is `access.explain(input: { principal?: string, ref, verb })`. C.2 uses it on `role:finance-viewer`. Nothing bounds the principal to the caller or its delegator, so the agent can ask what another principal may read. 03 bounds the equivalent call; 06 should copy the bound.

5. **The predicate-first takeover has an unspecified collision case.** C.4 says "a duplicate commit cannot occur through this path, because the commit is only issued when the predicate is false". Predicates such as `exists(dashboard, {war-room, payments}) and panel_count >= 3` can be false while an object with the same natural key already exists (the live agent created it, and it is not yet in the predicate's shape). The `documents` table in D.2 has no uniqueness on a name or natural key. The document does not say whether a recorded `create` with an existing natural key is refused, merged or duplicated. `BASE_REV_STALE` halts the driver, but a name collision is not a base mismatch. The predicate design is the right idea and is incomplete in this case.

6. **The seeded commit is an attributed human change with a virtual effective time.** A.3 and C.3 say the reset writes "a seeded commit at audit sequence 1187 … attributed to the human principal `priya` with an `effective_at` of 14:03". The chain's `created_at` is the reset's wall time, and `effective_at` is virtual. An auditor reads a change by `priya` that happened at reset and claims an effective time in a timeline that did not occur. The document says "no row is backdated", which is literally true and still misleading. The seeded commit should be marked as seeded in the chain (a `seed` source), so that a reader does not take it for a human action.

7. **The engine cache is keyed by lineage digest without the principal (X16).** D.1 says `engine` uses "in-process cache keyed by lineage digest". P36 defines the lineage digest over source refs, query hash, mask set and result digest. The principal and the row predicate are not in it. Two principals with different row predicates and the same query could share a cached frame. 02 and 04 key their caches on the principal's predicate. 06 needs the same, and a test like 04's `cache_isolation`.

8. **Predicate-first takeover is not tested against a partly completed step.** The F claims test equality of final semantic digests, and F.5's test runs the full script. No test runs a takeover at a step where the live agent has created the object but not yet the panels. That is the realistic stall (a long model turn between two calls), and it is the case in weakness 5. The test should exist before the claim is made.

### Required changes

- Mark replayed commits in the audit chain (a `driver` transport or replay flag in the row), not only in the console. Remove the "invisibility" paragraph.
- Either grant `write:source` and make A6 approval-class, or remove A6's auto-commit and state that source masks are always approval-class.
- Define selector matching for creation (for example, the create's labels must include the delegator's selected label), state Brice's delegation, and specify containment when the delegator has label selectors.
- Bound `access.explain` to the caller and its delegator.
- Specify what a recorded `create` does when its natural key already exists, and add a test for the partly completed step.
- Mark the seeded commit as seeded in the chain.
- Key the engine cache on the principal's effective row predicate and mask set, and add a `cache_isolation` test.

---

## Comparative assessment

### Ranking

1. **02 Tessera (Visual Spectacle), 7.80.** The most disciplined session-state split, the best spectacle, and a fallback that is now a function of current state. Its lead rests on three local fixes: the gap rule (X10), the stall grace, and the refusal lock. None of these is structural, so the lead is real but not large.

2. **03 Parapet, 7.25.** The strongest governance design: one write path with plan hash and policy version, exact preconditions on the tape, and FORCE RLS with a doctor check. It fell in this round because its revision log now contradicts its body twice (the `as` preview and the undo set) and because its approval gate has the requester as approver. Those are wording and rule fixes, and they matter because the stage depends on them.

3. **01 Fathom, 7.15.** The deepest core and the most complete repair of round-1 consistency items: the live-result key, the watermark wait, the chain-head lock, the read-side filter and the deterministic merge beat. It is ranked third because its Cedar fragment as written refuses every human commit to `live`, and because it keeps two conflict semantics for `live`. Both defects sit on the presenter's live path.

4. **04 Plinth (Emergent Composition), 7.15.** The largest repair in the set. Ties with 01 on total. It is ranked fourth on the tie-break because two of its defects touch the trust model: `grant.check` gives a cross-principal row-count oracle, and the replay driver executes human steps under the presenter's session. The attribution item was relabelled rather than fixed. The composition thesis and the closing blast-radius query are the strongest composition evidence in the set.

5. **05 Lodestar, 6.95.** The most natural operations story and the most honest fault mechanism. Its open items are authorization ones: no principal holds the restart grant, a Docker socket is held by the runner, and takeover races an in-flight apply. Each is fixable without changing the story.

6. **06 Tessera (Harbour), 6.60.** The best-specified rule table and scope grammar, and a clean commit path. It ranks last because the audit chain misattributes replayed writes, its auto-commit rule for source masks contradicts its own grant list, and its takeover has an unspecified collision case. Its fixes to round-1 items (the rule table, the grammar, the state tables) are real, so the drop is about the new defects, not the old ones.

### Ideas worth keeping regardless of who wins

From **01 Fathom**:
- The live-result key with `predicateHash` and `maskHash`, printed by `query.explain`.
- Branch merge as a plan with a per-property authorship preview, and a deterministic call order for the beat.
- The read-side filter list in D.8, applied to every read operation.
- Replica identity per process incarnation, with sequence allocation under the chain-head lock.
- Honest tiering of the capability count.

From **02 Tessera (Visual Spectacle)**:
- Animation only on sequence-numbered events or gestures, with the rule stated.
- Parameters, brushing and drill as session state in the URL, with no revision and no chain row.
- One preview mechanism with a single-use token stored in Postgres and consumed in the commit transaction.
- Replay that re-issues calls, matches response hashes and re-evaluates privilege calls, and labels its stored-patch view as a different claim.

From **03 Parapet**:
- The plan hash over the after-state, base revisions, decision ids and policy version, re-checked at apply.
- Explanations computed from the same evaluation as the decision.
- Refusals recorded as audit rows, with refusal text that names the rule and not the value.
- Exact tape preconditions with `expect` checks on real responses, and `reset required` instead of a wrong screen.
- `FORCE ROW LEVEL SECURITY` with a non-owner application role and a `doctor` check.

From **04 Plinth (Emergent Composition)**:
- The policy hash covering the row predicate, mask set and grant-index version.
- Preview tokens and idempotency records inside the commit transaction.
- `as_of` pinning on every query, so replay is a function of recorded virtual time.
- A seeded fault profile of the same type as the live fault.
- A closing query that composes lineage, business data and audit into one panel, with each count linked to its query.

From **05 Lodestar**:
- The real network fault (Toxiproxy blackhole) in both environments, with a caller-side metric that survives it.
- `nodata` as a named alert state that does not close an incident.
- Undo restricted to the caller's own changes and guarded by version, with takeover built on undo.
- Action-bearing workflows drafted until a different principal approves the definition hash.

From **06 Tessera (Harbour)**:
- The closed rule table for agent writes, with a test per rule and the rule id shown on each commit card.
- The closed scope grammar with deny precedence, containment and per-call intersection.
- Approval as a changeset state the agent can see and cannot commit.
- `screen.show` defaulting to `queued`, so a shared screen shows a proposal only after a human clicks.
- Stall detection from the server's own call log, which counts reads.

### Rules the next round should carry

1. Gap detection uses a per-workspace counter. The global sequence is an opaque key.
2. Every read that takes a principal argument is bounded to the caller and its delegator.
3. Every replayed write is marked in the chain row, not only on a console.
4. Every approval names the approver, and the approver is not the requester on any gate shown on stage.
5. Every action names the principal that executes it, and that principal holds the action's grant.
6. Every cache and every derived result is keyed by the principal's effective row predicate and mask set.
7. Every revision-log entry cites the sentence it changed, and the body is checked against the log before the round closes.
