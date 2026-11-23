# Round 2 review, Reviewer B: skeptical technical audience

Scope: the six revised proposals in `docs/demo-design/revised/` (01 to 06), read against the mission brief in `docs/demo-design/00-mission.md` and checked against my round-1 review in `docs/demo-design/reviews/round1/reviewer-B-skeptical-audience.md`. Each proposal was read in full. Original versions were not used for the verdicts below.

Method. The reviewer is a principal engineer who has seen too many demos. The question for each beat is whether it would be believed without narration, whether it looks pre-recorded, pre-pasted or switched on by a button, whether a buzzword stands in for a mechanism, and whether the claim said on stage is stronger than the mechanism behind it. Round-1 items are judged as fixed, partly fixed, not fixed, or fixed by adding words. Quantities quoted are the proposals' own labelled values; none was measured here.

Weighted composite = depth x 0.25 + cohesion x 0.20 + visual x 0.15 + credibility x 0.15 + narrative x 0.10 + feasibility x 0.10 + reliability x 0.05.

Disqualification rule applied: a proposal is disqualified only for fake functionality, an unverifiable architectural claim that the AWS run depends on, or local and cloud deployments that cannot behave the same. One proposal (06) meets the second condition. The rest are penalised, not disqualified.

Cross-cutting findings that apply to more than one proposal:

- **RDS does not grant superuser.** Proposals 04 and 06 rely on a role attribute that only a superuser can set (04: "superuser session" for the tamper beat; 06: BYPASSRLS on the score-view owner and the operator). Proposal 04's tamper can be done by the table owner, so its claim is mis-stated rather than infeasible. Proposal 06's design cannot be built as written on RDS (see 06).
- **ECS StopTask is not SIGKILL.** Resolved in 01 (self-SIGKILL), 05 (SIGTERM then SIGKILL after 2 s on both platforms). Not resolved elsewhere in the set, though no other proposal now claims SIGKILL on AWS.
- **Unmeasured replacement or pipeline waits sit inside the most important beat.** 01 (kill-to-restart wait, unbounded), 04 (forecast pipeline, cut rule at 210 s), 05 (replacement start, stated as "does not wait"), 02 (trace ingestion, shown as "pending").
- **Demo-only infrastructure sits under the strongest moment.** 02 (AWS-only finale), 03 (staging-only drill), 04 (demo-only replica pinning routes), 05 (fault hooks compiled only into demo images).

---

## Proposal 01: Tallyhouse (Systems Complexity), revised

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 25% | 9 | Grant-only `proxy_bids` with outcome-only SECURITY DEFINER functions (D.2, D.5), a per-auction event chain over stored bytes cross-checked to audit rows (D.2, F claim 5), a saga with attempt rows committed outside the step transaction (D.3), and named kill points (F claim 3). The depth is in mechanisms an expert can ask for by test name. |
| Cohesion and feature composition | 20% | 8 | One bid updates lock, proxy resolution, event, outbox, NOTIFY and audit (D.4). The saga and ledger consume the same events, and Prove-it reads the same chain. Two features (the step plot, the countdown) remain presentation, as G.4 says. |
| Visual and interactive impact | 15% | 6 | Four windows of tables and forms, with the price step plot and the countdown carrying the visual load. The revision removed the most artificial control (Force close) but did not add a visual moment. |
| Credibility to expert engineers | 15% | 7 | The closing line now states what is and is not detected (C 275–300), and "each email exactly once" is gone. Credibility is held back by the residual proxy path: `own_proxy_max(principal)` accepts any principal ID from the app role (D.5, G.4), which an expert will read as a hole in the "only you can see this" line on stage (C 30–45). |
| Five-minute narrative quality | 10% | 7 | The arc (bid war, counter-bid, burst, drop, snipe, settlement, kill, prove, tamper) is clear. Fourteen scenes is still dense, and the kill scene (C 225–255) is one long silence. |
| Implementation feasibility | 10% | 4 | Go, SECURITY DEFINER functions, four database roles, RLS, a ledger with deferred constraint, an audit verifier with cross-check, a scratch-schema rebuild, a React SPA, Terraform with seven modules, ElasticMQ, MinIO and Playwright (H.1). Layered in dependency order (H.2), but the surface touches every layer. |
| Live-demo reliability | 5% | 4 | The kill's replacement time is explicitly unmeasured and the script shows no bounded fallback (C 225–255, G.2). Three operator-induced faults run in one session (socket drop, worker kill, scratch tamper). |

### Round-1 items

- SIGKILL through StopTask: **fixed**. The worker kills itself on an armed request in both environments (D.5, E.2). The trade is that the demo no longer shows an orchestrator kill at all.
- Closing line overclaims: **fixed** (C 275–300, G.4).
- "Each email exactly once": **fixed** by removing external email; a `notifications` row is written instead (C 240–255).
- Withdrawal race staged by Force close: **fixed** by removing the operator control and using the organic close. New timing inconsistency (see weakness 3).
- Prove-it compares a subset: **fixed by naming** the hashed fields and listing `committed_at` and `server_time` as not covered (C 255–275).
- Burst 200 versus 180: **fixed**, 180 everywhere.
- Scene density (26 scenes): **partly fixed** (14 scenes). Still heavy.
- New problem introduced: the restart wait is now "Ines waits. No timer is shown" (C 225–255). The round-1 concern was a fixed 22 s window. The replacement is now an unbounded wait on an unmeasured Fargate start, placed directly before the strongest moment.

### Strongest ideas

- `proxy_bids` readable only through SECURITY DEFINER functions that return outcomes, so a maximum is never in a result set (D.2, D.5, F claim 4).
- Event chain over exact stored bytes, with every event's audit row carrying the event hash and the verifier cross-checking both (D.2, F claim 5).
- Settlement attempt rows committed before each step, so a killed attempt still appears in the record, and the redelivered step finds its unique key already committed (D.3, F claim 3).
- Prove-it panel that lists every field it hashes and every field it does not (C 255–275). This is the honest version of a rebuild check.
- A closing line that says what a rewriter defeats (C 275–300).

### Concrete weaknesses (most severe first)

1. **The proxy secrecy claim has a live residual path.** D.5 says `engine.own_proxy_max(principal)` is callable by the application role with any principal ID, and the document accepts that path (G.4). The on-stage line "Your maximum: 4,000 (only you can see this)" (C 30–45) and the canary test (F claim 4) cover read paths, not the parameterised function. Any handler bug or injected principal reads another bidder's ceiling through a function the grant model explicitly allows. Fix before the stage line can be said.
2. **The kill scene's wait is unbounded and unfilled.** C 225–255: "Ines waits. No timer is shown." The restart is an ECS Fargate task start, which G.2 says is unmeasured. The script gives the presenter nothing to say or click for that interval. The revision removed the number and kept the silence, which is the thing round 1 asked it to avoid.
3. **The timeline has a gap at the close.** The bid at 140–150 s sets `ends_at = now() + 30 s` (C 140–150, D.4). The scheduler then closes near 175–180 s, but the table says the close happens in 150–170 s (C 150–170). The withdrawal row (170–185 s) is gated on the console showing `closing`, which therefore lands at the end of its window. The presenter's cues do not agree with the database clock the proposal says it obeys.
4. **Three operator-induced faults in one 300 s run.** Drop socket with "reconnect held 8 s" (C 115–135), Arm fault and Kill worker (C 205–225), and a scratch tamper (C 275–300). Each is labelled, and each is real code, but the audience sees a harness that has been set up to fail in order. The claim "same code paths as ordinary traffic" (C, Reliability) is asserted, not shown.
5. **The audit append is a global lock on every auction.** D.4 and H.4 item 2 state that `pg_advisory_xact_lock` on a fixed key serialises every audit append across all auctions, and the burst (C 60–100) runs through that lock. The hold time is "measured in rehearsal" but no value is given, so the burst's throughput has no supporting number.
6. **The closing tamper is a pre-designed edit with a guaranteed result.** The scratch copy edits H3 and the verifier reports H3 (C 275–300). The check is correct and the result is known in advance, which an expert recognises. The proposal does say a rewriter is not detected (G.4), so the closing claim does not hide its limit, but the strongest moment still rests on a chosen target.
7. **Feasibility is broad for a five-minute proof.** Terraform with seven modules, Playwright with four contexts, ElasticMQ, MinIO, a scratch-schema rebuild, two replicas and a settlement saga with a ledger. The phrase "Favour reuse and composability" in the brief is not met by a stack this size for the claims shown.

### Required changes

- Bind `own_proxy_max` to the verified session inside the database (for example by reading `app.principal` in the function and dropping the principal parameter), and add a test that a different principal ID returns nothing.
- Replace "Ines waits" with a stated on-screen state and a bounded presenter action, or move the kill earlier so the replacement wait happens while another scene is on screen.
- Reconcile the close time with `ends_at` (state the scheduler's close instant after the anti-sniping extension) and correct the 150–170 s row.
- Record the audit lock hold time from the rehearsal and print it in the burst panel, or remove the claim that the burst is throughput-representative.

---

## Proposal 02: Tideline Live (Visual Spectacle), revised

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 25% | 8 | Global lock order enforced by one helper and tested for deadlock (D.4, F claim 4), a two-phase notifier claim (D.3), per-audience redaction tests over (record type, audience) pairs (D.5, F claim 3), and a checkpoint chain that a recomputing owner passes in-chain and fails against Object Lock (C 266–300). The last one is the strongest tamper argument in the set. |
| Cohesion and feature composition | 20% | 7 | The bid path ties realtime, audit, projection and trace together (B interaction summary). Identity (two providers), mail, tracing and the Floor view add surface that does not feed the headline claims, as round 1 noted. |
| Visual and interactive impact | 15% | 9 | Countdown ring with amber state, a phone-width bidder, the Floor view for a projector, a trace waterfall and a gavel. The strongest visual proposal in the set, tempered by the proposal's own admission that animations are cosmetic (G.4). |
| Credibility to expert engineers | 15% | 6 | The Object Lock limit is now stated correctly (D.5, G.4), and the duplicate-email wording is honest. Credibility drops on the pseudonym claim (D.5 says the number is "not derivable from the bidder's identity by anyone outside the server", which is false for a hash of two identifiers) and on a flagship moment that exists only on AWS. |
| Five-minute narrative quality | 10% | 8 | Clear arc from first bid to counter-bid, retry, snipe, close, settlement, notifier, tamper and recompute. The dead air at 160–180 s is gone (B2 fixed). The final 30 s is the strongest in the set, but only on the AWS run. |
| Implementation feasibility | 10% | 4 | Rust with axum, sqlx, Cedar, OpenTelemetry, a React SPA with Framer Motion, Cognito and Keycloak with a parity contract, Aurora, ECS, ALB, SQS, SES sandbox, S3 Object Lock, X-Ray and Jaeger, Mailpit, a CDK application and Playwright (H.1, E.2). Eleven layers with explicit dependencies. |
| Live-demo reliability | 5% | 4 | The finale needs a prepared second network link and a live AWS run (G.2). The trace panel shows "pending" until X-Ray ingests the spans (C 40–60), so the waterfall may be empty when the audience looks. The "Drop next response" control is a labelled fault (C 80–100). |

### Round-1 items

- Ladder grid rejects the accepted 6,100 bid: **fixed**. The rule is now a minimum next bid with the rejection citing it (A, D.4, C 60–80).
- Deliberate 20 s wait at 160–180 s: **fixed**. Real bids at every interval (C 160–186).
- Flaky-network toggle is client-side, while the test is a proxy: **partly fixed**. Both now use a server-side fault layer (D.1, F claim 2), but the audience still sees a "Drop next response" switch.
- Trace waterfall source unspecified: **partly fixed**. The panel reads from the trace backend's query API. The "pending" state is a new visible failure mode on stage.
- "Each email exactly once": **fixed** (D.3, F claim 5 wording).
- Local tamper weaker than the claim: **fixed by labelling**. The finale is AWS-only, which moves the problem rather than solving it (weakness 1).
- Trust argument versus the AWS account: **fixed**. D.5 and G.4 state what Object Lock blocks and what an account administrator can still do.
- New problems introduced: the AWS-only finale; the pseudonym sentence in D.5; the event payload is stored as `jsonb` while the hash is over "canonical payload" (D.2), which is the defect round 1 raised for proposal 01 and that 01 fixed by storing bytes.

### Strongest ideas

- Minimum-next-bid ladder whose rejections cite the band, step and minimum (A, C 60–80). It makes the rule visible rather than decorative.
- Two-step tamper: the owner's rewrite passes the in-chain check and fails against the Object Lock checkpoint at the first divergent sequence (C 266–300, D.3). It demonstrates the difference between internal and external evidence.
- Idempotent replay with a real dropped response from a server-side layer, and a stored response that includes the proxy counter-bid (C 80–100, D.2).
- A redaction table per (record type, audience) pair, with forbidden-field sets asserted against seeded data (D.5, F claim 3).
- The trace waterfall is produced from the stored trace of the same request, not a separate demo (D.3, G.1).

### Concrete weaknesses (most severe first)

1. **The flagship moment does not run on the local fallback.** The anchor finale (C 256–300) and the anchor check are AWS-only; the local run shows "none on this run" (C 256–266, E.2). The mission asks for identical core behaviour. The run policy (E, G.2) says a failed AWS link before the start moves the presenter to the local run, which then lacks the strongest moment. Round 1 asked for the local run to carry the story; the revision made the story depend on the AWS run instead.
2. **The pseudonym derivation is a false security claim.** D.5: `score = sha256(auction_id || bidder_id)`, numbered in score order, and "not derivable from the bidder's identity by anyone outside the server". Anyone holding both identifiers, and the registrant set, computes the same ordering. The script's "Bidder 2" and "Bidder 3" labels (A, C 115–135) present a pseudonymity property the design does not have. An expert reads this sentence and stops trusting the rest of D.5.
3. **The event hash is over bytes the database does not keep.** D.2 stores `payload jsonb`, and the event hash is "sha256(prev_hash || auction_seq || kind || canonical payload)". `jsonb` normalises key order and number text, so the verifier must re-canonicalise from parsed values. The revision does not say this, and the golden test of F claim 5 is described for the encoder, not for re-reading stored rows. Proposal 01 needed a `bytea` fix for the same defect.
4. **The trace panel can be empty on stage.** C 40–60: "If spans are still being ingested, the panel shows 'pending' and fills in." G.1 says X-Ray ingestion latency is recorded in rehearsal, not bounded. The presenter's trace step then depends on an external query path the proposal has not measured.
5. **Proxy resolution is a single counter, so the "proxy war" never escalates.** D.4 and G.4 limit proxies to "one counter-bid per transaction". Every proxy scene in C (100–160 s) is a two-party exchange. An expert who asks for three proxies will see the demo's rule is not the general case the Floor visual implies.
6. **Two identity providers add a parity surface whose result is narrower than its name.** E.2 and H.3 accept that Keycloak and Cognito differ in token lifecycle. F's cross-cutting suite checks claim mapping and a fixed decision set. The phrase "same images, same authorization path" (A, E) reads stronger than a fixed-token contract.
7. **The ladder visual shows a table, and the proposal says so.** A and G.4: the ladder "does not show jump bids as a special case". The strongest visual promise (a ladder that "renders the real increment rule", A 'Why it suits') is shallow by the proposal's own account.
8. **The "Drop next response" control is visible as a fault switch.** The button exists because a demo configuration exposes the fault layer (D.1, C 80–100). Round 1 flagged the toggle as a client imitation; the revision made the mechanism real but kept the switch on screen, so the audience still sees a fault being turned on.

### Required changes

- Restate D.5 pseudonyms: either make the number an unlinkable random value stored by the server, or drop the anonymity claim and say that numbers are labels only.
- Store the hashed bytes as `bytea` (or state the canonicalise-from-parsed-values rule and add a golden test that re-reads rows), as proposal 01 does.
- Move the anchor check onto the local run in a form the audience can see (for example, a local checkpoint in MinIO with the trust gap labelled on the same panel), or state on stage that the finale is AWS-only before the trace beat and plan the run order around it.
- Put a bounded fallback on the trace panel (show the trace identifier and the query result time) so an empty waterfall is a stated state, not a blank.
- Either support more than one proxy counter per transaction and test a three-bidder proxy war, or state the limit on the proxy card.

---

## Proposal 03: Ledgerwell (Enterprise Platform), revised

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 25% | 7 | Budget reservation under an allocation row lock with a `CHECK` backstop (D.3, F2), a golden decision matrix of several thousand cases (F5), `through` markers for filtered streams (D.4, F4) and stored decision rows for every explain. Much of the core is standard PostgreSQL with RLS, and the strongest tamper is a payload-only edit that the verifier catches at check (a). |
| Cohesion and feature composition | 20% | 8 | One submission touches RBAC, guard, reservation, pinned version, ledger, outbox, stream and trace in one commit (B composition paragraph). The server computes `permitted_actions` for every response, so the interface cannot disagree with the decision. |
| Visual and interactive impact | 15% | 5 | Budget card, approval inboxes, a ledger list, forms and a trace panel. The proposal names generic admin styling as its top visual risk (H.3 item 5). The race panel's two columns are the only visual argument. |
| Credibility to expert engineers | 15% | 6 | Budget arithmetic checks out (400,000 minus 240,000 minus 60,000 is 100,000; the 48,000 submission leaves 52,000; the 35,000 race leaves 17,000). Credibility drops because the Carla 404 (C 20–30) is produced by the URL-slug cross-check in D.5 before any row query, so it does not demonstrate RLS, and the anchor that would catch a recomputed chain is off the stage (S6). |
| Five-minute narrative quality | 10% | 7 | Clear money story and a clear invariant header. The drill scene (C 215–275) carries a dual approval, a forensics role, a tamper, a verify and a second verify in one beat, which round 1 flagged and the revision did not simplify. |
| Implementation feasibility | 10% | 5 | Go with sqlc, oapi-codegen, cel-go restricted to a subset, a single Go evaluator, Cognito with TOTP and a pre-token-generation Lambda, Dex locally, five CDK stacks, WAF, CloudFront, KMS, RDS Proxy, SQS, S3 with Object Lock, and Playwright with five contexts (H.1, E). |
| Live-demo reliability | 5% | 5 | The race no longer reruns mid-talk (C 120–140 fixed), and the step-up is real on staging. The drill depends on a live TOTP challenge on staging, a staging-only task and a dual-control path (C 215–245). A failed step-up stops the drill, which is stated. |

### Round-1 items

- Climax runs under a role absent from production: **partly fixed**. The step-up is real on staging, the drill is labelled staging-only (E, C 215–245), and a conformance check asserts its absence in production (H.4 item 4). The climax still cannot run in the production artifact set the mission describes.
- Simulated step-up on local: **fixed**. Staging uses Cognito TOTP; the local screen is labelled "step-up simulated" (C 215–245, E).
- ops_log outside the chain: **fixed** by removal; drill evidence is three ledger events (D, Drill).
- ERP fallback presenting a pre-generated packet: **fixed** by removal (G).
- Race proves a barrier, not arrival order: **fixed**. Arrival from the request log and commit from the ledger are separate columns (C 120–140).
- Enterprise surface crowds the visual budget: **fixed**. Vendor screening, dashboards and CSV import are cut (B, Removed from the product).
- Two CEL evaluators: **fixed**. One Go evaluator and server-computed `permitted_actions` (D.5, F5).
- New problems introduced: the isolation scene does not test RLS (see weakness 1); the payload-only tamper is the weakest detectable case, and the stronger case was moved off the stage.

### Strongest ideas

- Budget reservation under the allocation row lock, with a database `CHECK` on encumbrance as a backstop, and a test that runs a direct update that would breach it (D.3, F2).
- Single decision function (`Decide()`) whose output is the interface's `permitted_actions` and the stored trace (D.5, F5).
- Arrival order and commit order shown side by side, with the invariant holding for every order (C 120–140, F2).
- `through` markers that advance a viewer's cursor over invisible ranges without carrying content or a count (D.4, F4).
- Stored decision rows written at explain time, so the trace is a record rather than a recomputation (C 65–95, D.5).

### Concrete weaknesses (most severe first)

1. **The isolation scene does not exercise row-level security.** C 20–30: Carla pastes Maya's request URL and receives "Request not found", the same body as a random identifier. D.5 says the tenant is "cross-checked against the URL slug" before the tenant is used to set `app.tenant_id`. A mismatch can return the 404 before any query runs. The audience is told the 404 proves RLS (B, F1 observable), but F1 is off-stage and the scene does not distinguish the two layers.
2. **The climax tamper is the weakest detectable edit.** C 245–275: the drill changes `amount_minor` in the stored payload, the verifier fails check (a) at 1,612, and the stage line names that check. The stronger case, a recomputed tail caught by anchors, is S6 "not part of the on-stage path" (B row S6, D Anchors). The stage therefore shows a hash mismatch, not the property the headline claims.
3. **The climax exists only on staging.** D (Drill), E (Environments), C header: the drill-runner and forensics role are "staging only; production has no drill-runner". The production configuration is said to be the same images and stacks. The beat that the audience will remember is not reproducible in the environment the brief calls the deployed application. The proposal says so, which is honest, but it is a direct conflict with the mission's identical-core-behaviour requirement.
4. **The explain trace is a rendered row.** C 65–95: "Five green rows and one grey row". The stored row is the trace, and the row is written by the same request that displays it. Its depth is the discipline of storing it (F5), which the audience cannot see on a screen of green ticks.
5. **The race is a barrier around a lock.** Two 35,000 requests against 52,000 available, released together from a control panel that acts as Priya (C 120–140). The outcome follows from any row lock, and the arrival column comes from the same service's request log. The race demonstrates serialisation, which a unit test already proves (F2).
6. **The screens are the least visual in the set.** Budget cards, forms, inbox rows, a ledger list and a trace panel. There is no spatial or temporal visual that carries the argument; the proposal's own H.3 item 5 says the same.
7. **Stream `through` markers reveal activity volume.** D.4: a `through` frame is sent "at least every 100 invisible events". A viewer can count positions and infer the tenant's activity rate. The proposal accepts this (Accepted limitations) but then shows the marker mechanism as a feature.
8. **Feasibility spans several vendors' behaviours.** Cognito with pre-token Lambda and TOTP, Dex with connector mapping, RDS Proxy, WAF, KMS, Object Lock, five CDK stacks and two Playwright configurations. Each is standard. Together they widen the set of things that can differ between the staging and local stacks, and the conformance suite is the only control (H.3 item 6).

### Required changes

- Make the isolation scene exercise the database: call the endpoint with a valid token and a foreign tenant's row ID in the path after the slug check passes, or show the RLS denial in `psql` with the same role the API uses, and say which layer answered.
- Put the anchored tail rewrite on the stage, or drop the sentence that the verifier "reports the exact sequence number" where the stage has only a payload mismatch.
- Either run the climax in a production-equivalent stack (the drill-runner in staging with production images and a separately labelled role), or label the headline as a staging result on the stage slide.
- Replace the explain trace's green rows with the rule identifier and the policy version on screen, so the stored record is what the audience reads.

---

## Proposal 04: Quayside (Emergent Composition), revised

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 25% | 8 | One plan-commit lock with a stated reader rule and no overlap window (D.3), exclusion constraint covering holds and visits (D.2), property tests of the reducer against projections (F2), canonical bytes stored as `bytea` (D.2), and a bounded solver whose result states its iteration count and whether it reached the cap. The ordering protocol is the most precise in the set. |
| Cohesion and feature composition | 20% | 9 | One drag or one proposal touches policy, constraint, commit, fan-out, audit and trace (B interaction paragraph). The same policy file drives the UI affordances, the API and the database views (D.5, D.6). The strongest composition in the set. |
| Visual and interactive impact | 15% | 7 | Gantt with ghost overlays, proposal cards with reasons, a time-travel scrubber tied to a projection hash, and three windows with a status line showing each session's position. Well suited to the domain, though the proposal calls the Gantt its least technical part. |
| Credibility to expert engineers | 15% | 6 | The protocol is candid and the limits are stated (G, Known limitations). Credibility drops on two statements. The "superuser session, which the demo account has on both" (E) is wrong for RDS. "The system has just reasoned about the weather" (C 180–210) describes a bounded greedy solver with repair (G.4). |
| Five-minute narrative quality | 10% | 8 | A clean causal arc: refused drag, proposal, conflict, rebase, network loss, forecast, replay, tamper, trace. The closing line ties the trace to every earlier claim. The cut rule at 210 s keeps the arc intact if the forecast stalls. |
| Implementation feasibility | 10% | 6 | Rust API, worker and core crate, Cedar, Postgres with `btree_gist`, transactional NOTIFY, RLS with security-barrier views, SQS, S3 with Object Lock, a React Gantt, CDK, Cognito and mock OIDC, three images and a cargo-chef build (D, E). Ten layers with explicit dependencies (H). |
| Live-demo reliability | 5% | 5 | The forecast beat depends on an unmeasured chain (SQS, worker, solver) with a presenter cut at 210 s. Cross-replica NOTIFY and pinned routes must behave on the ALB as they do locally (H.3 risk 2, not yet proven). Replica pinning is demo-only routing. |

### Round-1 items

- Overlap window unspecified (F4 in-order claim): **fixed**. The single plan-commit lock makes allocation order equal commit order, and the reader rule needs no window (D.3, F4).
- Tamper stops at detection; a superuser who recomputes the chain is not addressed: **partly fixed**. Anchors and their limit are now stated (D.5 item 6, C 250–265). The rewrite case is not demonstrated on stage or in the variants; the stage only performs a naive payload edit.
- "Not a script" variant not shown: **fixed** by moving the second variant to the rehearsal and stating it is evidence, not a stage moment (F5).
- Solver seed suits the scenario: **fixed**. Seed 42 is the product default and is not chosen per run (B4 revision, C 60–90).
- Forecast beat depends on an unbounded pipeline: **partly fixed**. A cut rule at 210 s and a named fallback. The fallback still removes the line the transition depends on.
- Cross-replica trace depends on load balancing: **fixed with demo-only routing**. The mechanism is explicit (D.4, D.8), but the production build omits the rules (weakness 5).
- New problems introduced: the RDS superuser statement; the "reasoned" overclaim; the replica routes that exist only in demo.

### Strongest ideas

- Single commit order from one lock, with positions allocated only under the lock, so a visible position implies every lower position is decided (D.3). It replaces the overlap windows round 1 criticised.
- Placeholder positions for invisible events, so a carrier's replay shows position gaps as withheld content rather than missing data (D.3, F4, C 150–180).
- Holds as `slots` rows under the same deferrable exclusion constraint as visits (D.2, B 6c). The constraint is the single source of truth for overlap.
- Solver output that reports its iteration count against the cap and refuses to accept a `partial` proposal on the demo path (D.2, G).
- A cut rule that is read from a visible chip and a named fallback, so the presenter's branch is itself observable (C 210–225).

### Concrete weaknesses (most severe first)

1. **The tamper's platform claim is wrong for RDS.** E ("Local and AWS"): "The tamper demonstration works identically on RDS, because it needs only a superuser session, which the demo account has on both." RDS does not give the master user superuser. The tamper can be done by the table owner, since `events` has no triggers in D.2 and the application role's grants are the only write limit. The sentence should be corrected to the owner role; as written, the AWS climax rests on a privilege that does not exist there.
2. **The rewrite case, which the closing line concedes, is not shown.** C 250–265 demonstrates a naive payload edit; the stage sentence says anchors "detect a rewrite of anchored heads", but no stage step or variant performs one (F5 variants A and B do not include it). The round-1 critique was that the tamper stops at detection. The revision added the sentence, not the demonstration.
3. **"The system has just reasoned about the weather" overclaims.** C 180–210 presents a worker solve of a bounded greedy construction with min-conflicts repair (G Known limitations: "not optimal"). The line is an interpretation the audience will reject, and a precise expert will hear the marketing.
4. **The forecast beat is a chain of unmeasured waits.** C 180–225: file upload by presigned PUT, `POST /forecasts/complete`, outbox, relay, SQS, worker, solver, proposal and fan-out. The chip shows "queued" until the worker picks the job up. The cut is read at 210 s; the fallback removes the beat. The proposal does not state a measured value for any link (C 180–210, G).
5. **Replica pinning exists only in demo.** D.4 and D.8: `?replica=a` and `?replica=b` routes "exist in the demo environment"; production builds omit them. The strongest moment (the closing trace across two replicas, C 265–300) therefore depends on a routing configuration that the production deployment does not carry. The local stack maps the same parameter in nginx. The mission's identical-behaviour requirement is met for the code path but not for the topology the trace depends on.
6. **One global lock serialises every event in the terminal, and its hold time is unmeasured.** D.3 and G: the lock is held for the whole commit including projections and outbox writes, and "the claim is made only after measurement". Every Cedar decision, constraint check and proposal acceptance in the demo waits on it. The proposal's reasoning about throughput is correct in form and empty in number.
7. **Carrier replay shows counts.** C 150–180: "K minus V withheld" and a network panel with K frames. The audience sees how many positions a carrier cannot read. The proposal accepts this (Known limitations), but the stage uses the count as proof of filtering.
8. **The Gantt carries most of the visual load, by the proposal's own account.** B and G: "the least technical part of the demo". The ghost overlay depends on solver output that a non-expert must read as a reason, and the reason strings are the only explanation on screen.

### Required changes

- Replace "superuser session" in E with the table-owner role, and state the privilege the demo account has on RDS. Re-run the tamper rehearsal on RDS with that role.
- Either demonstrate the rewrite case with the anchor catching it (one extra step at 265–300 s, with the anchored head shown), or remove the sentence that claims it from the stage line.
- Replace "reasoned about the weather" with the measured solver result: the moves proposed, the reason codes and the iteration count against the cap.
- Publish the measured lock hold time and the measured forecast chain latency from rehearsal, labelled as measured, before the forecast beat is scheduled.
- Carry the pinned-routing rules in the production topology (or prove the trace does not depend on them) so the closing trace runs on the same topology in both environments.

---

## Proposal 05: Culvert (Live Operational Resilience), revised

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 25% | 8 | The xid-and-watermark replay rule (`pg_snapshot_xmin`, D.4) is a precise, testable answer to replay order, and claim 1 includes a case that distinguishes delivery order from commit order. Leases on the database clock with renewal and fence (D.6), precondition-based offline replay (D.6), and a fixed-offset canonical layout for the tamper (D.2, F claim 4) are real mechanisms. |
| Cohesion and feature composition | 20% | 7 | One order at 25 s is written, streamed, filtered, traced and chained (B interaction paragraph). The surface is wide: a PWA with an IndexedDB queue, a fault controller, Traefik, Toxiproxy, Mailpit, Jaeger and two identity providers. Several capabilities feed no claim. |
| Visual and interactive impact | 15% | 6 | Dark operations palette, a health strip and a chain-block strip (H.4 item 4). Three windows, a drawer and a console on one machine make the stage busy rather than striking, a point round 1 made and the revision did not change. |
| Credibility to expert engineers | 15% | 6 | Round-1 contradictions are fixed (RLS denial, SIGKILL, in-process replicas, the unopened trace). Credibility is held back by the live script running only on the local stack, which the proposal states, and by a demo-only fault build that the release image does not carry (E). |
| Five-minute narrative quality | 10% | 7 | The story is easy to follow: create, hide, race, close, offline, kill, deliver, verify, tamper. The middle has many surfaces, and the AWS promise is a digest in the closing line, not an observed run. |
| Implementation feasibility | 10% | 4 | Go API and worker, Postgres with forced RLS, SECURITY DEFINER probes, triggers, Cognito and Dex, Terraform with VPC, NAT, RDS Multi-AZ, CloudFront, WAF, ALB, Object Lock, Traefik, Toxiproxy, a Docker socket proxy, a PWA with IndexedDB and Workbox, and two browsers with two offline emulations (H.1, E). |
| Live-demo reliability | 5% | 4 | Offline flush order differs by browser emulation and is tested in two browsers, with eviction accepted as a limitation (G.2). The replacement start is unmeasured and the script does not wait (C 175–190). The stream reconnect budget is a rehearsal assertion, not a stage fact (G.2). |

### Round-1 items

- RLS denial logging contradicts the RLS model: **fixed** by a SECURITY DEFINER probe that returns two booleans and an audited 404 (D.2, C 75–90). The fix introduces a cross-tenant-capable existence oracle callable from the app role (weakness 8).
- SIGKILL through StopTask: **fixed**. Both platforms send SIGTERM, then SIGKILL after 2 s (D.7, E).
- Worker kill shows lease reclaim, not the duplicate window: **fixed by stating it** (C 175–190, F claim 5).
- In-process replicas: **fixed**. Separate OS processes in the harness and in Compose (F claim 1).
- Trace chip never opened: **fixed**. The waterfall is opened for one submit (C 55–75).
- "Same result string on AWS" in the closing line: **fixed by removal**. The closing line shows a digest (C 268–300).
- Console audited by the database it edits: **partly fixed**. Console statements go to a log sink the owner role cannot write, and the apply is appended to the chain (D.5 item 6). The owner still runs the tool that writes the apply record.
- New problems introduced: the live script is local-only; the demo build differs from the release build; the probe oracle.

### Strongest ideas

- Replay delivers an xid-ordered prefix of finished transactions, bounded by `pg_snapshot_xmin`, with a 250 ms timer so a silent watermark advance still delivers (D.4). It is the most precise statement of replay in the set.
- Claim 1's distinguishing check: a slow writer whose delivery order must differ from commit order, so a commit-ordered replay fails the test (F claim 1).
- Leases on the database clock with renewal while alive and a fence before send (D.6), with the duplicate window named (G.1).
- Offline queue whose actions carry preconditions, not versions, so an unrelated edit does not create a conflict, and refused actions are audited (C 190–210, D.6).
- A canonical layout with fixed-width fields at documented offsets, so the tamper can be done and described byte-for-byte (D.2, F claim 4).

### Concrete weaknesses (most severe first)

1. **The live five-minute script does not run on AWS.** G.2: "the live script runs on the local stack with no internet access"; the AWS stack "is shown only as a rehearsal report". The mission asks for a five-minute demonstration of a real deployed application on AWS. This proposal demonstrates a local stack and asserts the AWS match from a report, which is the gap the mission was written to close.
2. **The "same artifact" claim covers the demo build, not the release build.** E, "Demo build and release build": `faultinject` compiles the delivery hold and the pause points into the demo images only; the release image is built without them. Every fault on stage (the hold at 145–160 s, the kill at 175–190 s, the offline replay's conflict path) runs in code that production does not contain. The deviation is stated, but the parity claim is therefore about a different binary.
3. **Live updates wait on the watermark.** D.4 and G.3: a long transaction holds the watermark for every stream, and "live updates wait with it". The proposal says the stage does not show this ("a deliberate later demonstration", G.3). The live update latency the audience sees is therefore a property the proposal has not measured or demonstrated.
4. **The stage is busy by design.** C 143–158 has 12 rows and typically 3–7 actions per row, across three browser windows, the Ops drawer, a database console, `psql`, the trace panel, a Mailpit inbox and the health strip. Round 1 flagged the busyness; the revision kept it and added the console and probe scenes.
5. **The tamper's record is written by the tamper's tool.** C 250–268: "The apply is itself appended to the chain." The console that the owner runs appends the apply record, so a chain row describing the edit exists only if the owner's own tool wrote it. The audience is told the chain shows the change; the detection at S comes from the owner-controlled procedure's effect, which the proposal does not separate from the record it leaves behind.
6. **Two of the five-minute waits are unmeasured by the proposal's own labels.** The replacement start ("unmeasured Fargate start", G.1; "the step does not wait", E) and the verifier time (C 230–250, "target under 250 ms" [T]) both appear on stage. The verifier time is a target, not a result, and the stage shows it as a figure the audience will read as fact.
7. **Feasibility rests on many moving parts outside the claims.** Traefik and Toxiproxy, a Docker socket proxy, WAF, CloudFront, a PWA with a service worker, IndexedDB and two identity providers. The claims in F need the Go service, Postgres and the fetch stream; the rest is delivery surface.
8. **The read probe is an existence oracle callable with any UUID.** D.2: `culvert.probe_order` returns `found` and `visible` for any ID, under `culvert_probe` with BYPASSRLS, granted to the app role. The proposal discloses this (D.2) and the API hides it behind a uniform 404. It is still a cross-tenant-capable path in the app role, created to make one scene work, and an expert will ask why RLS was not enough.

### Required changes

- Run the five-minute script against the AWS stack, or state on the slide that the live run is local and the AWS result is a rehearsal report, and remove any sentence that implies the audience sees AWS behaviour.
- Ship the release image's hook-free build in the rehearsal's fault path, or move the faults to a mechanism that does not need compiled hooks (for example, a stop signal to the process plus a database-level hold that the release build also honours).
- Measure and print the live-update latency under a long watermark-holding transaction, or remove the implication that streams are live during it.
- Remove the probe's `visible` boolean from the app role's reach; return the uniform 404 and log the denial from the request path, with a test that the probe is callable only by the handler that owns the audit row.
- Cut the stage to one browser window for the offline beat and the Ops drawer for the fault beat, so the audience follows one thread per scene.

---

## Proposal 06: Sealroom (Unconventional Innovation), revised

### Scores

| Criterion | Weight | Score | Justification |
|---|---:|---:|---|
| Demonstrable technical depth | 25% | 7 | Commitments are written into the chained seal and reveal events, so the stored table cannot change without rewriting chained rows (D.3, B1 revision). The verifier recomputes the table against the chained commitments (D.3 integrity check, step 3). The depth is real but rests on a single SHA-256 commitment, and the AWS-run confidentiality path is unverified (see weakness 1). |
| Cohesion and feature composition | 20% | 7 | Seal, reveal, RLS visibility, outbox, audit and anchor form one loop (B interaction paragraph). Browser crypto, IndexedDB profiles, a file:// verifier, a terminal and Mailpit add surfaces, and the terminal is the attack. |
| Visual and interactive impact | 15% | 5 | Hex strings, counters, a six-row officer board and four identities. The revision accepts that the visual argument is text-heavy (B7, G.4) and does not add a visual. |
| Credibility to expert engineers | 15% | 5 | The per-proposal state machine, the removed recovery backup and the commitment-binding fix all answer round 1. Credibility falls on the AWS precondition for the score view and operator (weakness 1) and on a seed file holding every score (weakness 2). |
| Five-minute narrative quality | 10% | 8 | The opening sentence ("nobody sees a score until everybody has sealed") is the clearest in the set. The climax (a rewrite that passes internal checks and fails the external anchor, C 255–300) is the strongest narrative moment in the set. |
| Implementation feasibility | 10% | 5 | Node with Fastify, hand-written SQL, React, WebCrypto, IndexedDB, SQS, S3 Object Lock, Cognito, seven CDK stacks and eight Compose services (H.1). Smaller in code than the others, but three of its critical-path prerequisites are untested (MinIO parity, RDS BYPASSRLS, WebCrypto under file://, H.2). |
| Live-demo reliability | 5% | 4 | Reveals depend on a specific browser profile's IndexedDB and pre-cached tokens, with no escrow (G.2, H.3). The Downloads step and the file:// verifier are untested per browser (C9). The attack gate depends on anchor freshness from a 30-second sweep. |

### Disqualification

**Disqualified.** The AWS run depends on two database capabilities the proposal itself marks untested and does not have a buildable fallback for:

- The score view's owner role `sealroom_views` must be `BYPASSRLS` (D.2 score view; D.5 item 3). The operator role must be `BYPASSRLS` for the rewrite (D.5 item 3, C2 revision).
- PostgreSQL permits only a superuser to set the `BYPASSRLS` attribute, and RDS does not give the master user superuser. The stated fallback, "the migration creates `sealroom_operator` with the same grants" (D.5), requires the same privilege and so cannot be created as written.

The score-view confidentiality and the rewrite climax on the AWS run therefore depend on an unverified architectural claim, and the fallback does not exist. Reinstatement requires a score view and an operator role that do not depend on BYPASSRLS on RDS, with a rehearsal result that shows them working on the RDS instance that the stage uses. The scores below are given for completeness and are not the basis for ranking.

### Round-1 items

- Score table outside the anchored record: **fixed** (commitments in chained seal and reveal events; verifier checks stored rows against them; D.3, B1).
- Round state not defined per proposal: **fixed** (per-(round, proposal) state and six seeded states; D.2, D.6, A3).
- Claim 1(c) a tautology: **fixed** by reframing it as a conformance test and stating hiding as an assumption (F Claim 1).
- Recovery backup holds nonces: **fixed by removal** (D.1, G.2, H.3).
- Anchor cadence unstated: **fixed** (D.3 "Anchor"; C 215–240 shows sequence, time and object version).
- Offline bundle proves consistency, not provenance: **partly fixed**. The bundle embeds version IDs and the terminal fetches the object by version ID during the attack (C 275–300). The offline limit is stated (G.4).
- Visual sparse: **accepted, not fixed** (B7, G.4).
- New problems introduced: the BYPASSRLS dependency on RDS; the seed file (weakness 2); the pre-pasted rewrite with a bypass flag (weakness 3).

### Strongest ideas

- Commitments inside the chained seal and reveal events, with the verifier recomputing the table against the chain, so the table cannot be changed without changing chained rows (D.3).
- The operator's two-step attack: the rewrite passes internal checks and fails against the anchored head at the first anchored sequence after the change, with the locked object fetched by version ID on screen (C 255–300).
- Per-(round, proposal) state machine with a guarded transition, a sealed-count precondition for reveal, and a fixed rule for unrevealed reviewers (D.5, D.6).
- The framing that a score is not stored in plaintext before the close, with a dump-based test that searches for nonce bytes and score keys (F Claim 1).
- An offline verifier that makes no network requests, with a test asserting zero requests where the browser allows the check (G.3).

### Concrete weaknesses (most severe first)

1. **The AWS confidentiality and climax depend on BYPASSRLS, which RDS cannot grant.** D.2 score view, D.5 item 3, E ("Untested: whether the RDS master user has BYPASSRLS"). The proposal's fallback creates a BYPASSRLS role by migration, which a non-superuser RDS master cannot do. Without it, the score view returns no revealed values to the view owner, and the operator cannot read the base table as the adversary. This is the mechanism behind the headline on the AWS run.
2. **Every seeded score and nonce sits in a file on the demo machine.** D, Demo reset and seed, step 2: the reset "writes them to `%LOCALAPPDATA%\sealroom\demo\seed.json`". The headline "nobody can read a score before close" is a claim about the database operator, but the same person runs the stage and the terminal on the same laptop. An expert who asks where scores exist before reveal is told the demo file has all of them.
3. **The rewrite is a pre-pasted command with a bypass flag.** C 255–275: `sealroom-admin rewrite --proposal P-3 --set Ada=4 --set Dev=5 --rechain`. The tool refuses to run without an anchored chain, but `--force-no-anchor` exists in the same tool (C 255–275, G.2). The audience sees a scripted tool whose gate is a flag, and the attack's result is fixed by the input.
4. **The climax's surfaces include an untested file-system step.** C 240–255: the bundle is downloaded and opened from `file://` with networking disabled. WebCrypto under `file://` is untested per browser (C9, E, H.2), and the proposal's own rule is that the verifier "refuses" without `crypto.subtle`. The stage then shows a refusal in the middle of the offline step.
5. **Reveal depends on a browser profile.** G.2 and H.3: clearing IndexedDB loses the reveal, "the demo never exercises this path". Five identities depend on pre-cached tokens and profile directories (H.2). A profile reset during rehearsal would change the stage's state without any visible sign.
6. **Anchor freshness gates the climax on a 30-second sweep and a milestone job.** D.6: the anchor "lags the database by one job"; C 255–275: the rewrite refuses unless the latest anchor covers the chain; G.2: if the gate is not met the presenter waits for the Auditor view. The wait is unmeasured and sits on the strongest moment.
7. **The visual is text.** G.4: "The visual argument is text-heavy." B7 accepts it. A four-window stage of hex strings and a six-row board gives the audience no visual change to follow except the red banner.
8. **Three untested prerequisites sit in the core demonstration path.** MinIO parity for `DeleteObjectVersion` and retention refusal (E, C7), RDS BYPASSRLS (E), and WebCrypto under `file://` (C9). H.2 lists them as critical dependencies. The proposal says the parity claim is "untested" until they pass; the climax needs them to pass.

### Required changes

- Redesign the score view to avoid BYPASSRLS on RDS (for example, a `SECURITY DEFINER` function owned by a role the policies permit, with the policy written for the view owner), and rehearse it on RDS.
- Replace the operator role's BYPASSRLS with the owner role's own grants, which PostgreSQL allows without superuser for the table owner, and state the consequence: the owner is subject to FORCE RLS, so the operator can read only what the owner's policies allow. Re-check the headline against that.
- Keep nonces and scores out of the demo host's readable storage, or state that the presenter's machine holds the seed and the operator claim does not apply to the demo host.
- Remove `--force-no-anchor` from the demo build of the operator tool, or show the gate failing on stage.
- Move the verifier download to a path that does not depend on `file://` in the browsers the stage uses, or make the offline step a recorded result with the online check as the stage step.

---

## Comparative section

### Ranking

Composite scores use the weights above. Proposal 06 is disqualified and is listed last regardless of composite.

| Rank | Proposal | Composite | Disqualified | Summary |
|---:|---|---:|---|---|
| 1 | 04 Quayside | 7.40 | no | The most precise ordering protocol and the highest cohesion. Its main defects are a wrong RDS privilege claim, a rewrite case the stage does not show, and an overclaimed solver line. All three are fixable without restructuring. |
| 2 | 01 Tallyhouse | 7.10 | no | The deepest mechanisms: grant-only proxy secrecy, a chain over stored bytes, and saga kill points with attempt records. It loses ground on a live proxy residual path, an unbounded restart wait and a timing gap at the close. |
| 3 | 02 Tideline Live | 7.05 | no | The strongest visual and narrative, and the best two-step tamper argument. Its flagship moment exists only on AWS, its pseudonym claim is false, and its hash is over `jsonb`. |
| 4 | 05 Culvert | 6.50 | no | The best replay design, with the xid watermark and a precise claim 1. The live run is local only, the demo build is not the release build, and the stage is crowded. |
| 5 | 03 Ledgerwell | 6.45 | no | Strong budget and decision discipline, and most round-1 items fixed. The isolation scene does not test RLS, the climax is staging-only, and the screens are the least visual. |
| 6 | 06 Sealroom | 6.15 | **yes** | The best narrative and the most unconventional idea. Disqualified because its AWS confidentiality and climax depend on BYPASSRLS, which RDS cannot grant as the proposal describes. |

Tie note: 03 and 06 would be close on composite without the disqualification; 03 ranks above 06 because its defects are demonstrable on AWS and fixable in the same design, while 06's are in the AWS mechanism itself.

### Ideas worth keeping whichever proposal wins

- **Commit order from one lock, with a reader rule and placeholders** (04, D.3, F4). Replay with withheld positions answers the question "how does a filtered stream stay gap-free" without a window.
- **Watermark-bounded replay from `pg_snapshot_xmin` with a timer** (05, D.4, claim 1). It is the cleanest statement of what a notification-based stream may deliver.
- **Grant-only secret tables with outcome-only functions, and an explicit residual list** (01, D.2, D.5). The function-parameter hole in 01 must be closed, but the pattern is the right one.
- **Chain over stored bytes, cross-checked to a second chain** (01 D.2 and F claim 5; 05 D.2 canonical layout v1). Store the hashed bytes, not a re-serialised value.
- **Two-step tamper: internal pass, external fail, with the anchored object read by version ID** (02, C 266–300; 06, C 255–300). It is the strongest demonstration of what a database operator cannot do, and it is teachable in one screen.
- **Budget reservation under a row lock with a database `CHECK` backstop** (03, D.3, F2). Small, testable, and the audience can follow the arithmetic.
- **Server-computed `permitted_actions` from one decision function** (03 D.5, F5; 04 D.5, F3). It removes the class of bug where the interface and the server disagree.
- **Commitments inside chained events, and a verifier that recomputes the table against the chain** (06, D.3). It closes the gap round 1 found between a side table and the audit chain.
- **Stored decision rows at explain time** (03, C 65–95; F5). The trace is a record, and it can be tested against a matrix.
- **Visible cut rules and named fallbacks** (04, C 210–225). A branch the presenter takes in view of the audience is more credible than one hidden in the script.
- **Preconditions instead of versions for offline replay** (05, D.6). An unrelated edit does not create a conflict, and the conflict is shown as a conflict.
- **Pseudonyms that are labels, not anonymity** (01 and 02 both use stable labels). Keep the label; do not keep the anonymity sentence unless the number is random and server-held.
