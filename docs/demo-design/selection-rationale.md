# Selection rationale (tournament v2)

**Winner: Plinth, an emergent-composition operations platform** (competitor 04).
Revised proposal: `revised/04-emergent-composition.md`.

The definitive specification is in `spec/` and supersedes the proposal wherever they differ. The
binding amendments are listed at the end of this file. They fix the round-2 findings against Plinth
and graft in specific ideas from the other five proposals.

## The field

| # | Concept | R2 mean | R2 ranks (A/B/C/D) | Composability | Agent/MCP | Visual | Feasibility |
|---|---|---:|---|---|---|---|---|
| 01 | Fathom: replicated typed document model, tree CRDT, branch/merge | 7.18 | 3 / 2 / 1 / 4 | 9 8 9 8 | 8 8 8 7 | 6 5 6 6 | 3 4 3 3 |
| 02 | Tessera: visual-first investigation wall | 7.06 | 1 / 4 / 5 / 2 | 8 7 7 7 | 8 7 7 7 | 9 6 8 9 | 6 5 3 5 |
| 04 | **Plinth: six primitives, one spec language, fourteen generic MCP verbs** | 7.01 | 4 / 5 / 4 / 1 | 9 8 8 9 | 7 7 8 8 | 7 5 6 7 | 6 5 5 5 |
| 03 | Parapet: governed platform, plan/apply, policy-first | 7.00 | 2 / 3 / 2 / 6 | 8 7 8 7 | 8 8 8 8 | 6 6 6 6 | 5 5 4 5 |
| 06 | Tessera/Harbour: agent-native changesets, closed rule table | 6.89 | 6 / 1 / 3 / 5 | 7 7 7 7 | 7 8 8 8 | 7 7 7 8 | 7 5 5 6 |
| 05 | Lodestar: watches a real containerised system, injected faults | 6.65 | 5 / 6 / 6 / 3 | 7 6 6 7 | 7 7 7 7 | 7 5 7 7 | 7 6 4 5 |

Full tables: `evaluation-matrix.md`. Reviews: `reviews/round1/`, `reviews/round2/`.

## This is not the highest mean, and why that is the right call

Plinth is third by mean, 0.17 behind Fathom. The top four are within 0.18 of each other, and each
reviewer put a different proposal first. The averages therefore do not decide this. The decision
rests on what the user asked for and on what each design can actually deliver.

The user's brief has three priorities:

1. an enterprise-worthy dashboard built on screen, live;
2. an MCP server through which an agent acts, interrogates the system and generates the UI;
3. **as many powerful composable capabilities as possible.**

**Plinth's design thesis is that third priority, stated as architecture.** It has one document
model, one change log, one query compiler, one authorization function and one real-time channel.
Every dashboard, panel, source, rule, workflow, form, grant, export and undo is a node, written in
one specification language and reachable through fourteen generic MCP verbs. The thesis has
consequences that reviewers credited:

- Plinth and Fathom are the only proposals that score 8–9 on composability from every reviewer.
- Reviewer D, the MCP tooling specialist, ranked Plinth first. D called it "the best composition
  argument and the most measurable agent gate".
- Its closing beat is the only finale in the field that shows *emergent* capability. The agent
  answers "what did this incident touch?" by composing three ordinary sources (lineage, orders,
  audit) into a panel that no feature was written to produce. Audit and lineage are queryable
  sources, which is the mechanism behind "the agent can build things nobody programmed".

**Why not Fathom (highest mean)?** Fathom is the deepest design: a move-capable tree CRDT, HLC
change feeds, a typed query IR with unit algebra, and replay that compares checkpoint hashes. Every
reviewer also rated it the least feasible (3–4 out of 10). The skeptical-audience reviewer scored
its visual impact 5 and recorded "the absence of any visible concurrency". The user has just
rejected a design for not being the visual, dashboard-first experience they wanted. Fathom would
repeat that mistake with more machinery. Its best ideas are grafted in below without its CRDT core:
the per-principal result key printed by `query.explain`, and the negative-control run.

**Why not Tessera (02, best visuals)?** It has the strongest visual design, and its
"animate only on sequence-numbered events" rule is the most honest visual idea in the field. But its
composability is 7–8, it keeps 25 tools with eleven kind-specific write verbs (the pattern Reviewer D
asked everyone to move away from), and Reviewer C found that its replay hashes cannot match as
written. Visuals are a layer that can be added to Plinth. A composition core cannot be retrofitted
under Tessera. Its visual layer is grafted in wholesale.

**Why not Parapet (03)?** It has the best governance contract: plan hashes and denials that name
the policy but never the value. However, D ranked it last, because its tape refuses on any
exact-state mismatch, it has 25 tools, and approval outcomes come back in three shapes. Its
governance ideas are grafted in.

**Why not Tessera/Harbour (06)?** It has the best agent contract: a closed rule table, a scope
grammar, a `next` hint in every response and `LOOP_SUSPECTED`. Reviewer B ranked it first. A ranked
it last on new defects: replayed writes are misattributed in the audit chain, and an auto-commit
rule contradicts its own grant list. Its closing beat has no agent action in it. Its contract
elements are grafted in.

**Why not Lodestar (05)?** It has the most credible fault (a real network blackhole) and the most
honest measurement plan. It is the least composable, and every reviewer placed it in the bottom two
on narrative, partly because the presenter gives the diagnosis rather than the system. Its rule that
the fault console never appears in the agent's tool list, and its untrusted-data wrapper on every
string, are grafted in.

## What Plinth demonstrates that the others do not

- **Capabilities nobody programmed.** Metadata (audit, lineage, workflow transitions) is ordinary
  queryable data. The agent composes answers that no feature was written for, and it does so on
  stage.
- **Fourteen generic verbs over one spec language** instead of a tool per feature. Each new node
  kind gives the agent new capability without new tools.
- **The pass-rate gate is built into the plan.** Thirteen pre-registered questions, three of them
  cross-kind compositions, decide whether the tool surface is good enough before it is frozen. The
  claim "a general agent can build this" is therefore tested, not asserted.
- **The same document drives every surface.** The agent's YAML is what the UI renders, what the
  audit diff shows and what `plinth apply` reads from git. No generated code sits in the path.

## Binding amendments for the specification

The spec writers implement these. Where the revised proposal disagrees, the amendment wins.

| # | Amendment | Resolves / source |
|---|---|---|
| P1 | **Visual layer upgrade.** Visual types demonstrated on stage: time-series line with brushing, bar, heatmap, KPI tile with sparkline, table, and a lineage graph (node-link) used in the finale. Area, scatter, sankey and geo map are supported (real, tested, not on stage). Every visual maps result columns to typed channels; none has private data access. | B-R2 "no line chart"; idea from 02 |
| P2 | **Animation honesty rule.** A UI element animates only in response to a sequence-numbered change event or a user gesture. Panels "materialise" on commit with the change sequence shown in a corner chip. There are no decorative or timed animations. A test fails the build if any animation fires without an event id. | 02 |
| P3 | **Session state is not history.** Parameters, brushing, cross-filter and drill state live in the URL and the session. They create no revision and no audit row. Saving them is an explicit Change. | 02 |
| P4 | **Trace ribbon on every screen.** A thin strip shows each MCP/API call: tool, one-line argument summary, status, change seq, principal, and a `live` or `replay` tag. It is the audience's evidence that the calls are real. | 02 + 04 |
| P5 | **Envelope contract for every MCP response:** `{ ok, data \| error, next: [suggested tool calls], warnings, budget: {bytes, truncated, next_cursor} }`. Errors carry a code, the exact JSON path, the expected type or allowed values, and a machine-applicable suggestion. `LOOP_SUSPECTED` is returned after three identical refused calls. | 06, 05 |
| P6 | **Closed commit-rule table.** Every agent write is classified by a closed table of named rules (for example `R-PANEL-CREATE: auto-commit after preview`, `R-GRANT: approval required`, `R-ACTION-EXTERNAL: approval required`). Each rule has one test, and the rule id appears on each commit card in the UI. | 06 |
| P7 | **Separation of duties shown, not labelled.** The agent's grant proposal is approved by the **finance analyst** (owner of the finance board, a separate window and identity), not by the presenter who delegated to the agent. A test enforces that the requester and the delegator cannot approve. | A-R2 rule 4, B-R2 req 4 |
| P8 | **`grant.check` is bounded.** Without `grant:admin`, it only answers for the caller and its delegator. Counts for other principals require `grant:admin`, which closes the cross-principal row-count oracle. The response for a hidden column has the same shape as for an absent column. | A-R2 (04), 03 |
| P9 | **The replay driver is its own principal.** `service:replay-driver` executes recorded human steps with `on_behalf_of` set to the recorded human. Every replayed change row has `surface = 'driver'` and a `replay_of` reference in the hash-chained row itself. The driver never uses the presenter's session. | A-R2 rule 3 and (04) |
| P10 | **Takeover by satisfaction, not exact state.** Each script step has a satisfaction predicate over current state (for example "a Panel on ops-board whose query groups orders by region and aggregates p95 latency"). On takeover the driver skips satisfied steps. It never inverts another principal's changes. It handles creates whose node already exists by slug. It refuses with "reset required" only if a predicate is unsatisfiable. | D-R2 cross-cutting 2; 02, 06 |
| P11 | **Approval-held changes are visible to the agent.** `change.status(change_id)` (read-only) returns `pending_approval`, `approved` or `rejected`, together with the approver. The agent can tell the presenter that the change is waiting. This is the fifteenth tool, added because the gate demands it. | D-R2 (04) |
| P12 | **Negative control on stage.** In the "why did p95 jump" beat, the agent also runs the same breakdown over a control window (yesterday 14:00–14:20), and it shows a flat heatmap beside the red one. A seeded cause is shown to produce "no cause" where there is none. | B-R2 cross-cutting 1; 01 |
| P13 | **Visible human/agent concurrency.** The stale-base beat is kept and made legible. The agent holds revision r. The presenter edits the title in the UI (r+1). The agent's two-path change is rejected with `CONFLICT` naming the title path. The agent re-reads and commits only the width. The merge rule (paths disjoint → rebase; intersecting → conflict) is stated once and the beat follows it exactly. | B-R2 (01), C-R2 (04) |
| P14 | **Untrusted data is structural.** Every string value that comes from data (rows, titles, comments, annotations) is returned to the agent inside `{ "untrusted": "..." }`, whatever its field name. A seeded annotation containing an injection attempt is part of the rehearsal's adversarial set. | 05, 06; D-R2 cross-cutting 6 |
| P15 | **Fault console is not an agent capability.** The fault cue (F7) goes to a presenter control API on a separate port with a separate credential. It is absent from the MCP tool list and from the agent's grants, and a test asserts both. | 05 |
| P16 | **Explanations come from the decision.** `permission.explain` is folded into `grant.check`. It returns the grants, predicates and masks from the same evaluation that authorizes the query. Denials name the policy (grant id), never the hidden value. | 03 |
| P17 | **Per-principal result keys are visible.** `query.explain` prints `policy_hash` and the injected predicates. The Exec view and the Ops board show their different `policy_hash` values in the panel inspector during the grant beat. | 01 |
| P18 | **A takeover rate measured in rehearsal.** The rehearsal report states the live-agent takeover rate per step over at least 10 model-in-the-loop runs. The live agent is used on stage only for steps whose measured takeover rate is at or below a pre-registered threshold. Other steps are replay-by-default, and the trace ribbon says so. | B-R2 cross-cutting 2 |
| P19 | **No silent overrun.** The script has a hard maximum of 300 s. Each step has a budget, and a shared slack pool is shown on the presenter console. When the slack is exhausted, the driver takes the next step. | B-R2 cross-cutting 3 |
| P20 | **One name.** The product is **Plinth**. "Tessera" refers only to the losing proposals. | B-R2 cross-cutting 6 |

## Ideas deliberately not imported

- Fathom's tree CRDT. Path-level three-way merge with explicit conflict payloads is enough for
  dashboard documents, and it makes conflicts *visible*, which is the point on stage. A CRDT would
  make conflicts disappear.
- Lodestar's real containerised checkout system as the data source. Plinth's seeded generator gives
  byte-identical replay. A real system adds a second fault model, and the demo has no time for it.
- Parapet's ten `.plan` verbs. Plinth keeps generic verbs.
- Tessera-visual's 25-tool catalogue.
