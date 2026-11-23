# Tessera: an agent-native composable operations platform

Proposal 06 (revision 1), mandate: Agent-Native Innovation. Competitor 06, work item WG-5518.
Design only; nothing in this document has been built or run. This revision is self-contained and
replaces the original proposal in full.

**Product title:** Tessera
**Pitch:** Tessera is an enterprise dashboard and operations platform in which every panel, query, alert, workflow and permission is a typed, versioned document, so an external agent over MCP uses exactly the primitives a human uses, and every change it makes is previewed, scoped, approved where policy says so, audited and undoable. In five minutes, on one screen, an agent turns a plain question about a payments latency spike into a live war room, an evidence-backed annotation, an alert with a human approval, a masked finance view and a reversible on-call page, while the platform's own audit chain shows who changed what.

---

## Revision log

Each finding is listed with how it was handled: **fixed** (with the section where the fix sits), **rebutted** (with the technical reason), or **accepted** as a known limitation. Strengths the reviewers named are kept and are not listed.

### Reviewer A (Principal Systems Engineer)

- **Required: replace the takeover rule.** Fixed in C.4. Satisfaction is now a semantic predicate evaluated on current state; transcript keys are used only when the predicate is false. The keys are scoped by `(transcript_id, step_id)` (D.2). Digest comparison for skipping was removed; digests appear only for final-state equality, over a semantic digest that excludes revisions and generated IDs (C.4).
- **Required: auto-commit policy as a table with a test per row.** Fixed in D.5.4: fifteen named rules (A1 to A15), each with a test in F.2 and H.4 step 8. A changeset commits without approval only if every op is auto-class; otherwise the whole changeset waits.
- **Required: scope idempotency keys and propose content to the principal.** Fixed in D.2 (`UNIQUE (principal, idempotency_key)`) and D.5.6 (propose identity is `(principal, base, ops hash)`).
- **Required: drive the stall trigger from the MCP call log.** Fixed in C.4 and D.5.2. The server writes one `mcp_calls` row per tool call, reads and writes and refusals alike. The driver's own clock decides silence.
- **Required: lock the chain head in the commit transaction.** Fixed in D.2 (`audit_head` row, `SELECT ... FOR UPDATE`), with the fork test in F.4. The sequence object is removed.
- **Required: define the scope grammar with a test per rule.** Fixed in D.5.5: closed verbs and kinds, selector matching, deny precedence, delegation containment and intersection. Each rule has a test in F.2.
- **Required: read check on `presence.list` and the presence bar.** Fixed in D.5.7.
- **Required: store parameter state outside the document write path.** Fixed in D.2 (`view_state`), which has no revisions.
- **W1 (takeover keys the live agent never used).** Fixed as above. Predicates do not depend on the keys or IDs the live agent chose.
- **W2 (auto-commit undefined; alert binding and thresholds routed by an unstated rule).** Fixed in D.5.4. Threshold replacement, alert creation and workflow or action binding are approval rules A8 to A10.
- **W3 (cross-principal collisions).** Fixed in D.2 and D.5.6.
- **W4 (stall trigger blind to long read runs).** Fixed by `mcp_calls` (D.5.2).
- **W5 (chain order and head).** Fixed as above.
- **W6 (scope grammar and delegation intersection).** Fixed in D.5.5.
- **W7 (no read check on presence).** Fixed in D.5.7.
- **W8 (preview and changeset rows shared).** Fixed in D.2 by row-level security on `changesets`: visible to the owning principal, its on-behalf-of human, and principals holding `commit` on the target.
- **W9 (parameter state storage).** Fixed in D.2 (`view_state`).
- **W10 (Kinesis tested only in AWS).** Accepted as a limitation, with a gate. The AWS realtime claim is withheld until the Kinesis contract suite passes in a pre-stage environment (E.2). Until then the realtime claim is made for the local NATS path only.

### Reviewer B (Skeptical Technical Audience Member)

- **Weakness: the root cause is an answer key (the labelled `config.change` row).** Partly fixed, partly accepted. The agent's evidence is a correlation of `retry_count` with p95 by minute, plus the audit join, so the answer comes from data rather than from one label (C.2, 80 to 105 s). The simulator is written to exhibit the cause, and this is now stated on screen (a model footer) and in the presenter note (C.1). Accepted as a limitation of a simulator. A control scenario with no config change and a different cause runs in rehearsal, and the rollback does not fix that spike (G.5, C.4).
- **Weakness: tool count inconsistent (14, then 19).** Fixed. The count is 18 everywhere, generated from the tool manifest (D.5.3). `history.list` folded into `resource.get`; `change.discard` kept for approvals; `presence.list` kept with a read check.
- **Weakness: mask-and-grant changeset does not say what Finance shows before approval; "reloads" contradicts realtime.** Fixed in C.2 (160 to 185 s). Finance shows a locked placeholder with the pending changeset ID before approval. On approval the live subscription renders the panel in place. No reload.
- **Weakness: Priya's identical-value conflict is an anticlimax; presenter drives two identities.** Fixed. The beat is now a real two-value conflict (600 against 700, C.2 105 to 135 s). The two-identity point is accepted as a limitation and labelled on screen: "Priya's session, driven by presenter". Rehearsal runs with two sessions.
- **Weakness: the closing beat depends on live model latency.** Fixed in C.2 and C.4. Each agent-dependent step has a checkpoint and an F9 fallback. The closing beat's platform latency (commit to first changed bucket) is defined by construction and is measured in rehearsal.
- **Weakness: trust model shifts (agent proposes, human commits, agent then auto-commits).** Fixed. The commit rule is stated once (D.5.4) and each agent commit in the script shows its rule ID (A2, A3).
- **Weakness: "production config change" overstates the simulator.** Fixed. All approval text says "Harbour simulator config".
- **Weakness: breadth asserted, about 8 tools on stage, no test of "almost anything".** Partly rebutted. The claim "an agent can build almost anything" is withdrawn. The claim is narrowed to "every primitive marked D in B.1 has a conformance test, and every tool has a conformance test" (F, H.1). Accepted that only nine tools appear on stage.
- **Required: control where rollback does not fix p95.** Fixed as control scenario B (A.3, G.5).
- **Required: one tool count from the catalogue.** Fixed (D.5.3).
- **Required: Finance state before approval; remove "reloads".** Fixed (C.2).
- **Required: real two-value conflict.** Fixed (C.2).
- **Required: closing beat with measured latency and transcript fallback at a checkpoint.** Fixed (C.2, C.4).
- **Required: state the agent commit rule once and show it.** Fixed (D.5.4).
- **Required: replace "production".** Fixed.

### Reviewer C (Implementation and Reliability Engineer)

- **Weakness: closing beat has no determined final frame (25 s row, 1-minute metric windows).** Fixed. The bucket transform is changed to per-bucket percentiles over 15 s buckets, so the drop is visible in the first bucket that closes after the simulator reads the new setting. The final frame is defined by that event (C.2, final window).
- **Weakness: the 14:05 spike has no clock.** Fixed in A.3 and C.3. The reset anchors a virtual time T0 (14:20 in the demo timezone). The backfill, including the spike, is generated at reset. The 14:03 change is a seeded commit with a fixed audit sequence (1187). The virtual clock runs at 1x from T0. The simulator reads the setting as of each simulated second through a time-indexed config history. There is no backdated row in the chain: the change is an ordinary seeded commit at its sequence position.
- **Weakness: driver skip logic depends on revisions; live agent supplies its own keys; key collision with a different body.** Fixed in C.4 (predicates, semantic digest, `IDEMPOTENCY_KEY_REUSED` handling).
- **Weakness: audit head not serialised; fork risk.** Fixed in D.2 (locked `audit_head`) and F.4 (concurrent-commit fork test).
- **Weakness: identical-edit rule stated two ways.** Fixed. One rule in D.4: equal values merge as a recorded no-op; different values conflict. The script uses different values, so the rule is exercised by F.4 and not by the stage.
- **Weakness: tool count 14 and 19.** Fixed (18). Names freeze at the end of build step 8, with a manifest hash checked by rehearsal (H.4).
- **Weakness: Kinesis only in AWS; no shard-key rule.** Fixed in E.2 (shard key and pre-stage gate). The residual gap is accepted and stated.
- **Weakness: presenter may act as approver.** Fixed. The approval card and the script label the approver as "brice (presenter; also the agent's delegator)". The four-eyes option exists and is off in the demo (D.5.8).
- **Required items.** Each is addressed above: closing beat re-timed (C.2); spike mechanised (A.3); transcript-bound predicates (C.4); audit head serialised (D.2, F.4); one identical-edit rule (D.4); tool count and freeze (D.5.3, H.4); Kinesis pre-stage and shard key (E.2); presenter-as-approver labelled (C.2, D.5.8).

### Reviewer D (Agent and MCP Tooling Engineer)

- **Weakness: identical-edit rule contradicts conflict rule and F.4.** Fixed (D.4, F.4). Equal values merge as a no-op; this is stated in D.4 and tested in F.4.
- **Weakness: auto-commit classifier undefined.** Fixed. Named policy rules A1 to A15 (D.5.4), one test per row (F.2 and H.4 step 8), and the mixed-changeset rule.
- **Weakness: `dry_run` on propose persists, so there is no non-persisting validation.** Fixed. `dry_run` is removed. A proposal with invalid ops returns `status: "rejected"` and creates no row. A valid proposal creates a `proposed` changeset that expires (D.5.3, D.5.6).
- **Weakness: `query.run` allows 10,000 inline rows with no agent cap.** Fixed. `mode: "summary"` returns aggregates only. Agents default to 200 rows and cannot exceed it. 10,000 is available to human principals only (D.5.3).
- **Weakness: stall trigger has no signal for silence.** Fixed. The driver's clock measures time since the agent's last `mcp_calls` row (C.4).
- **Weakness: tool count inconsistent; tape depends on frozen names.** Fixed (18; freeze after build step 8).
- **Weakness: F.5 measures the server, not self-correction.** Partly rebutted. A scripted client can prove envelope consistency, which is all it claims; a scripted client cannot prove self-correction and this revision does not say it does. Added: a measured model-in-loop run in which an external model, not a scripted client, chooses the fix for the same 50 malformed proposals. It is reported with model ID and date as a measured result, and is outside the platform's claims (F.5).
- **Required: ghost proposal cards on shared screens.** Fixed. `screen.show` defaults to `mode: "queued"`. A proposal is shown only after a human clicks Show on the screen or its console (C.2, D.5.3).

---

## A. Product concept

### A.1 What the platform is

Tessera is a composable dashboard and operations platform for enterprise operations teams. Its unit of work is a **document**: a dashboard, panel, query, metric, threshold, alert rule, workflow, action, screen, grant or source is a typed JSON document with a kind, a schema, a revision and an owner. Documents reference each other by stable IDs. The platform has one type system (one TypeScript definition per kind, from which JSON Schema, validators, MCP schemas and form schemas are generated), one authorization model (the scope grammar, D.5.5), one change pipeline (changesets, D.4), one real-time channel and one revision model. The web UI, the HTTP API and the MCP server are three views over the same document store and the same change pipeline.

The agent-native idea is an inversion. In most dashboard products the UI is the source of truth and automation is a second-class API. In Tessera the document is the source of truth, the UI renders and edits documents, and the MCP server is a third editor with the same guarantees. An agent is therefore not a special case that needs intelligence in the platform. It is a principal that proposes changesets against typed documents, sees the validated result, and commits them under a policy. **The platform contains no language model.** All of its behaviour is deterministic code. The agent is an external MCP client.

The combination the agent offers, which neither a human alone nor a script alone offers, is:

1. **Interrogate** the system by composing queries across business telemetry and the platform's own audit log, which is exposed as an ordinary source.
2. **Compose** a UI that answers the question from primitives, previewed on screen before it is shown to anyone.
3. **Stay accountable**: each agent change carries the agent principal, the human it acts for, the policy rule that let it commit (or the approval that did), and a changeset ID.

### A.2 Who uses it

- **Operations and on-call engineers** use war-room dashboards, alerts and approved rollback actions.
- **Service owners** author dashboards and alert rules, and review agent proposals against them.
- **Finance and business analysts** consume masked, row-filtered boards.
- **Platform administrators** own scopes, delegations, approvals and the audit chain.
- **Engineering agents** (Claude Code, Claude Desktop or any MCP client) act for one human, within a delegated scope.

### A.3 The data, and the demonstration incident

The demo's domain is **Harbour**, a simulated order-fulfilment system: `checkout`, `payments` (which calls an external-provider stub), `inventory` and a `fulfilment` queue. Everything is generated inside the platform's containers, and everything is generated, persisted, queried and changed through the platform.

- **Seeded simulator.** A deterministic simulator (TypeScript, xoshiro256** PRNG with a constant seed in the demo configuration) emits spans, orders, payment attempts, inventory movements and provider responses. The default event rate is 200 events per second, a configuration value to be confirmed in rehearsal.
- **Virtual time and the incident.** Reset anchors a virtual time **T0 = 14:20** in the demo timezone (configuration). Reset generates a **120-minute backfill** ending at T0, as fast as the machine allows, not paced. Since 2 hours at 200 events per second is 1.44 million events, that row count is computed from configuration and will be confirmed by rehearsal count, not promised. From T0 onward the simulator runs at **1x**, so live data is live. The virtual clock is not sped up.
- **The cause, as a seeded commit.** Reset performs a seeded commit at audit sequence **1187** that sets `payments.retry.max` from 2 to 6, attributed to the human principal `priya` with an `effective_at` of 14:03. The simulator reads `payments.retry.max` as of each simulated second through a time-indexed config history (the `revisions` rows, filtered by `effective_at`). Its retry-amplification model raises the provider-stub latency distribution, and the p95 spike appears at 14:05 in the backfill. Because the chain is built by ordinary commits in a fixed order, no row is backdated: the change sits at its sequence position, and its `effective_at` is data.
- **The model card.** The simulator is a model: retry amplification with a documented shape (G.5). The screen footer shows "Harbour simulator model v1: retry amplification", so no one reads it as a provider prediction.
- **Control scenario B (rehearsal only).** A second seed variant has a provider latency event at 14:05 and no config change. The rehearsal requires the agent (or the scripted client) to answer that there is no configuration change in the window, and it requires that the rollback action does not restore p95 in that variant.
- **Audit as a source.** The audit log is exposed as `audit.events`, so "what changed in the last hour" is a query. Annotations, lineage and presence read the same table.
- **Free and self-hosted.** Nothing calls a paid API. The provider stub is part of the simulator. The only LLM is the external agent.

Reproducibility has two parts. `make demo-reset` produces byte-identical seed tables (checked by a table digest), and the incident's position in the backfill is the same on every reset.

### A.4 Why this demonstrates the mandate

The audience sees an external agent do five things with the primitives a human has: query, compose, preview, commit and undo. Each agent write shows the rule that allowed it. The agent is refused where its scope ends. The platform answers questions about its own history. The closing beat (C.2) is a page composed by the agent, with an action button that a human approves on screen, and the simulated system responds in the same chart.

---

## B. Capability inventory

### B.1 Primitive table

Status key: **D** demonstrated in the five-minute script; **S** supporting, implemented and covered by a conformance test, not on the main path. Every row has a conformance test; the test is named in the rehearsal manifest.

| ID | Primitive | Status | Significance | Composes with |
|---|---|---|---|---|
| P01 | Source connector (simulator, Postgres table, HTTP JSON, audit log) | D | One `Source` interface: `schema()`, `scan(predicate, projection)`, `watch()` | Query, Realtime |
| P02 | Audit log as source (`audit.events`) | D | Platform history is queryable like business data | Query, Annotation |
| P03 | Typed kinds and schema registry | S | One TypeScript definition yields JSON Schema, validators, MCP schemas, forms | Every kind |
| P04 | Query (typed relational JSON, `QIR`) | D | No raw SQL from clients; compiled to parameterised SQL; RLS and masks applied at compile time | Source, Transform, Panel, Alert, Export |
| P05 | Transform stages (bucket, percentile, rate, delta, top_k, pivot, sort, limit) | D | Pure functions over row streams | Query, Panel, Metric |
| P06 | Metric (named expression over a query) | D | Metrics are documents, used by alerts, panels and anomaly rules | Query, Threshold, Alert |
| P07 | Visualization (timeseries, table, stat, scatter, text) | D | Each viz declares its accepted data shape; validated before render | Panel, Annotation, Threshold |
| P08 | Panel (query, transforms, visualization, options) | D | Composition unit; carries its lineage digest | Dashboard, Screen, Changeset |
| P09 | Layout (12-column grid) | S | Pure function from layout document to positions, shared by preview and browser | Dashboard |
| P10 | Dashboard document | D | Versioned; target of most changesets | Panel, Branch, Diff, Embed |
| P11 | Parameter (timerange, enum, text) | D | Typed inputs that panels and links bind to; state held in `view_state` | Query, Link |
| P12 | Cross-filter (selection to parameter) | D | Declarative event-to-parameter binding; state in `view_state` | Panel, Parameter |
| P13 | Drill-down link | S | Navigation as a link document | Dashboard, Parameter |
| P14 | Threshold (document: value, unit, bands) | D | Draggable in UI; a document field; edits are changesets | Metric, Alert, Viz |
| P15 | Alert rule (metric, threshold, `for`, severity, workflow) | D | Evaluated by the same engine as panels | Metric, Threshold, Workflow |
| P16 | Alert backtest (`alert.test`) | D | Replays a rule over stored data; reports would-have-fired times | Alert, Query |
| P17 | Annotation (marker from query or audit row) | D | Markers from any query, including audit | Viz, Audit |
| P18 | Workflow (trigger, steps, approval gate, actions) | D | Finite state machine with persisted transitions | Alert, Action, Approval |
| P19 | Action (registered side effect, dry run) | D | Typed side effect; `action.dry_run` returns the plan | Workflow, Button |
| P20 | Form (write-back, validated) | S | Writes go through the changeset path | Action, Source |
| P21 | Changeset (ops, validation, preview, commit) | D | Universal write unit for humans and agents | All kinds |
| P22 | Approval (changeset in `awaiting_approval`) | D | Committed only by a principal holding the scope | Changeset, Delegation |
| P23 | Principal (human, service, agent) | D | Agents have their own identity, never a shared human session | Scope, Audit |
| P24 | Scope grammar (`verb:kind:selector`, D.5.5) | D | One grammar for UI, API and MCP | Principal, RLS, Delegation |
| P25 | Delegation (agent acts for human, time-boxed) | D | Effective scope is the containment-intersection of the agent's grant and the delegator's | Principal, Scope |
| P26 | Row-level security (Postgres RLS) | S | Enforced in the database for API and MCP alike | Query, Scope |
| P27 | Column mask (`hash`, `redact`, `truncate`) | D | Applied at compile time; recorded in lineage | Query, Export |
| P28 | Screen (display target with live subscription) | D | Principal-owned subscription; receives `screen.show` | Dashboard, Realtime |
| P29 | Presence (participants, cursor, selection) | D | Ephemeral; agent appears as a named participant; read-checked | Dashboard, Realtime |
| P30 | Conflict resolution (three-way) | D | Disjoint paths rebase; overlapping differing values conflict | Changeset, Revision |
| P31 | Revision history | D | Every commit writes an immutable revision row | Diff, Undo |
| P32 | Undo as inverse changeset | D | Never rewrites history; proposes and commits the inverse | Revision, Changeset |
| P33 | Semantic diff | D | Diff over typed documents by ID and path | Revision |
| P34 | Branch (revision line and merge) | S | Three-way merge changeset | Revision, Diff |
| P35 | Audit log (hash chain) | D | Append-only; serialised head; `audit.verify` | Every write |
| P36 | Lineage (source refs, query hash, mask set, result digest) | D | Every rendered number carries its digest | Query, Panel, Audit |
| P37 | Labels and tags | S | Metadata on every kind; used by search and selectors | Search, Scope |
| P38 | Template (dashboard with declared holes) | S | Instantiation is a changeset | Dashboard, Layout |
| P39 | Scheduled report | S | Scheduler is a workflow trigger; output is a snapshot with lineage | Workflow, Export |
| P40 | Export (CSV, JSON; Parquet on AWS) | S | Query with a sink; masks and RLS apply | Query |
| P41 | Embed (signed, scoped, expiring URL) | S | Parameterised; verified server-side | Dashboard, Scope |
| P42 | Anomaly detection (robust z-score) | D | Deterministic statistic over a metric; not a learned model | Metric, Alert, Annotation |
| P43 | Realtime subscription | D | One WebSocket protocol; subscriptions by document reference | All reads |
| P44 | MCP tool surface (18 tools, D.5.3) | D | Small verb set over typed kinds | All primitives |
| P45 | MCP resources (`tessera://` URIs) | D | Addressable documents, revisions, changesets, audit rows | Discovery |
| P46 | Idempotency keys | S | Commit replay returns the original result; scoped to principal | Changeset, MCP |
| P47 | Rate limits and query budgets | S | Per-principal buckets; row budget with explicit refusal | MCP, Query |
| P48 | Reset, readiness, rehearsal | S | `demo-reset` and `demo-rehearse` are platform commands | All |

### B.2 Composition map

```
 Source (P01) ──┬── audit.events (P02) ──────────────────┐
                ▼                                        ▼
          Query (P04) ◄── Scope/RLS/Mask (P24,P26,P27)  Annotation (P17)
                │                                        ▲
                ▼                                        │
        Transform (P05) ──► Metric (P06) ──► Anomaly (P42)
                │                 │
                ▼                 ▼
        Visualization (P07) ◄── Threshold (P14)
                │                 │
                ▼                 ▼
          Panel (P08) ──► Alert (P15) ──► Workflow (P18) ──► Action (P19)
                │                                                  │
                ▼                                                  ▼
        Dashboard (P10) ◄── Parameter/Cross-filter (P11,P12)  Approval (P22)
                │                                                  │
   ┌────────────┼──────────────┬──────────────┐                      ▼
   ▼            ▼              ▼              ▼                Changeset (P21)
 Screen (P28)  Embed (P41)  Template (P38)  Branch (P34)            │
   │                                                                ▼
   ▼                                                          Conflict (P30)
 Presence (P29) ◄── Realtime (P43) ◄── Revision (P31) ◄──────────────┤
                                            │                       ▼
                                  Undo (P32) / Diff (P33)      Audit (P35)
                                                                    │
                                                                    ▼
                                                  Lineage (P36) ─► MCP (P44, P45)
```

### B.3 Larger capabilities composed from the primitives

- **Answer with evidence.** A query over telemetry (P04) joined to `audit.events` (P02) yields annotations (P17) and a scatter. Lineage (P36) links each marker to the audit row and the query digest that produced it.
- **Governed agent write.** Changeset (P21), scope (P24), delegation (P25) and the policy table (D.5.4) make "the agent may do this itself, and nothing else" a property of the write path.
- **Alert that cannot disagree with its panel.** Panel, threshold and alert share the metric (P06, P14, P15). The backtest (P16) reports the firings the live engine would produce.
- **Reversible operational control.** An action (P19) bound to a workflow (P18) with an approval (P22) and an undo (P32) is a reversible control that the agent can compose into a page.
- **Multi-screen collaboration.** Presence (P29), realtime (P43), revisions (P31) and conflicts (P30) let a human and an agent edit one dashboard across screens.
- **Permissioned sharing.** Scope, RLS, masks, embeds and exports use one query compiler, so a finance board, its embed and its export show the same masked rows.

---

## C. Five-minute live script

### C.1 Conventions

- The presenter speaks and types into Claude Code, configured with the Tessera MCP server (stdio locally, Streamable HTTP on AWS; D.5.1). The left half of the presenter's display shows Claude Code; the right half shows the **war-room** screen, which is the main audience view.
- Two more browser windows are open: **Priya's session** (a human editor principal, `priya`, on a second device) and **Finance** (`role:finance-viewer`). Priya's session is driven by the presenter. Its header on screen reads "Priya's session, driven by presenter" so the audience can see it. Rehearsal runs both as separate sessions.
- The agent acts as `agent:claude-code` on behalf of `brice`. Its delegated scopes are `write:dashboard:<team-ops dashboards>`, `read:source:telemetry`, `read:source:audit`, `write:alert:<team-ops alerts>`, `show:screen:screen:war-room` and `run:action:rollback-config` (dry run only; actual runs need approval, A13). It holds no `grant` scope, so it cannot grant anything.
- The screen footer reads "Harbour simulator model v1: retry amplification".
- Prompts are short and typed exactly as written below.
- Presenter-console state (driver status, F9) is never shown to the audience.

### C.2 Timeline (300 s)

Agent calls are shown by tool name. Each agent write shows the policy rule that allowed it (D.5.4) or the approval that holds it.

| Time (s) | Presenter action | Expected behaviour, MCP calls | Visible result | Capabilities | Transition |
|---|---|---|---|---|---|
| 0–30 | Speaks: "Tessera. Every panel on this screen is a document, and an agent uses the same documents I do." No agent call yet. | Platform live; simulator running from T0. | Screen shows `dash_overview` (created at reset): payments p95 with the 14:05 spike already in the chart, order rate, inventory. Presence bar: `brice`, `priya` (presenter-driven), `finance-viewer`. | Realtime, sources, panels, presence | Points at Claude Code |
| 30–60 | Types: `Connect to Harbour. Build a war room for payments latency over the last 30 minutes: p95, error rate, retries. Show it on the screen as a proposal.` | `catalog.describe({kind:"dashboard"})`; `resource.search({kind:"source", text:"payments"})`; `query.explain({query: payments p95})`; `change.propose({ops:[create dashboard with 1 parameter, 3 panels, layout]})` returns `proposed`, `cs_0421`; `screen.show({target:"screen:war-room", view:{changeset_id:"cs_0421"}, mode:"queued"})` | Screen shows a badge: "Proposal from agent:claude-code for brice, cs_0421. Show?" The presenter clicks Show. The ghost overlay appears: three panels rendered from the preview. | Catalog discovery (P44), query explain (P04), propose (P21), screen queued preview (P28) | Presenter clicks Show, then Commit |
| 60–80 | Clicks Commit on the card (human commit as `brice`). Types: `Commit it and keep the screen on it.` | Human commit through the UI with a UI idempotency key. Agent: `change.list({principal:"agent:claude-code"})`, then `screen.show({target:"screen:war-room", view:{ref:"dash_war_payments"}, mode:"live"})` | Ghost becomes solid; panels stream live; revision badge `r1`; each panel footer shows its lineage digest. | Commit (P21), revision (P31), lineage (P36), idempotency (P46) | Question about the spike |
| 80–105 | Types: `Why did payments p95 jump at 14:05? Put the evidence on the board.` | `query.run({query: p95 per minute, retry_count per minute, join audit.events where action=config.change and target=payments.retry.max, window -30m, mode:"rows", limit 200})`; `audit.search({since:"-30m", action:["config.change"]})`; `change.propose({ops:[add annotation from audit seq 1187, add scatter retry_count vs p95, add text panel]})`; `change.commit` by the agent | Commit card: "Auto-committed by rule A2 (annotation) and A3 (panels), team-ops dashboard." Annotation at 14:03: "payments.retry.max 2 to 6 by priya, audit seq 1187". Spike at 14:05 aligned under it. Scatter shows the retry band. Text panel: one sentence, row count and lineage digest. | Join across business and audit data (P02, P04, P05), annotation (P17), lineage (P36), policy (D.5.4) | Presenter switches to Priya's session |
| 105–135 | Priya's session: drags the threshold line `thr_payments_p95` from 800 ms to 600 ms (a human edit, rev 2 to 3). Then types in Claude Code: `Set the p95 threshold to 700 ms as we agreed, and tell me if it conflicts with anything.` | `resource.get({ref:"thr_payments_p95"})` returns value 600, rev 3, last edited by `priya`. `change.propose({base:{thr_payments_p95:2}, ops:[replace /value 700]})` returns `conflict` with the three-way view: base 800, theirs 600 (priya), ours 700. The agent reports the conflict and does not commit. | Conflict card: "Priya set 600 ms. Agent proposed 700 ms (both differ from base 800 ms). Keep 600 / Use 700 / Discard." Presence shows `priya`'s cursor on the chart and the agent's dotted cursor on the threshold. The presenter clicks Keep 600; the agent's changeset is discarded by a human resolution. Threshold stays at 600, rev 3. | Presence (P29), realtime (P43), three-way conflict (P30), presence read check (D.5.7) | Presenter asks for an alert |
| 135–160 | Types: `Page on-call if p95 stays above that threshold for two minutes. Test it against the last 30 minutes first.` | `alert.test({rule:{metric:"payments.p95_ms", threshold:"thr_payments_p95", for:"2m"}, window:"-30m"})` returns `fired_at` values from the backfill; `change.propose({ops:[create alert payments_p95_oncall, bind on_fire to workflow page-oncall, add markers]})` returns `awaiting_approval` (rules A9 and A10) | Backtest markers on the chart at the returned times. Approval card: "Create alert and bind to workflow page-oncall (Harbour simulator pager). Requires a human commit." The presenter approves. Card label: "approved by brice (presenter; also the agent's delegator; four-eyes off in this demo)". | Backtest (P16), alert (P15), workflow binding (P18), approval (P22) | Presenter moves to the finance request |
| 160–185 | Types: `Let the finance viewer see the revenue panel but not customer email.` | `access.explain({principal:"role:finance-viewer", ref:"dash_finance_revenue", verb:"read"})` returns `allowed:false`. `change.propose({ops:[add mask customer_email on source orders]})` is auto-class (A6) and committed by the agent. `change.propose({ops:[grant read on dash_finance_revenue to role:finance-viewer]})` returns `awaiting_approval` (A11). | Mask commit shows rule A6. Approval card for the grant. Finance window, before approval: a locked placeholder "Access pending approval, cs_0447"; the revenue panel is not rendered. The presenter approves. Finance's live subscription receives the grant and renders the panel in place, with customer email as `r***@…`. No reload. | Scope and delegation (P24, P25), column mask (P27), approval of a privilege change, realtime | Presenter asks for undo |
| 185–205 | Types: `Undo the last change to the p95 threshold and show me the diff.` | `resource.get({ref:"thr_payments_p95", include:["history"]})` lists revisions with authors. `change.undo({change_id})` returns an inverse changeset (600 to 800) in `awaiting_approval` (A8). | Approval card: "Revert threshold thr_payments_p95 from 600 ms to 800 ms (undo of priya's change, cs_0433)". The presenter commits. Diff: `r3 600 ms` to `r4 800 ms`, author `brice` via undo. Revision badge moves to `r4`. | Revision (P31), undo as inverse changeset (P32), semantic diff (P33) | Presenter asks about the platform |
| 205–225 | Types: `Did anyone else touch the war room in the last hour, and is the audit chain intact?` | `audit.search({since:"-60m", ref:"dash_war_payments"})`; `audit.verify({from_seq:1})` returns `ok: true`, the event count and the head hash. | Timeline: each change with principal and on-behalf-of, human or agent, and the rule or approval that allowed it. Footer: "chain verified", with the event count and the head hash prefix. | Audit (P35), attribution (P23), self-observation (P02) | Presenter asks for the closing page |
| 225–250 | Types: `Build an on-call page: what is burning, what changed, and one button to roll back the retry setting.` | `catalog.describe({kind:"action"})`; `action.dry_run({action:"rollback-config", input:{key:"payments.retry.max", value:2}})` returns the plan, 1 config change, 0 external side effects, `requires_approval:true`. `change.propose({ops:[create dashboard dash_oncall with status tiles, timeline over audit.events, layout copied from dash_war_payments]})` is auto-class (A1) and committed by the agent. `change.propose({ops:[add button bound to action rollback-config]})` is `awaiting_approval` (A10). | The on-call page appears on the screen: status tiles, a change timeline with the 14:03 entry, and a button "Roll back retry setting (needs approval)". The presenter approves the binding. | Composition from primitives (P08 to P11), action with dry run (P19), approval (P22), realtime | Presenter presses the button |
| 250–268 | Presenter presses the button on the screen. Approval card: "Set payments.retry.max from 6 to 2 in the Harbour simulator config. Dry-run plan: 1 config change, 0 external side effects. Plan digest 7c1e…" | Button creates a run request. The action's commit is rule A13 (config writes always need approval). | The approval card names the target and the plan digest. | Action approval (A13), workflow (P18) | Presenter approves |
| 268–300 | Presenter approves (about 268 s), then types nothing. | The workflow commits `config.change` as `brice` (audit row written). The simulator reads the new setting at its next simulated second. | At the next 15 s bucket boundary, the p95 line drops back below the threshold line. The caption appears when the first post-change bucket renders: "Every change on this screen went through MCP or the UI, through the same primitives. Approved by brice (presenter)." The frame holds to 300 s. | Action and workflow end to end (P18, P19), realtime, audit completeness (P35) | End |

**Timing rules that make the closing beat determined.** The p95 panel uses 15 s buckets, and each bucket's percentile covers only that bucket. The simulator reads config every simulated second, so the first post-change bucket is the first bucket that closes after the commit. By construction the drop is visible at most one bucket after the commit, plus the simulator tick (at most 1 s) and render time. That bound is a design fact; the measured commit-to-render latency is recorded in rehearsal, and the script requires the measured 95th percentile to fit inside the final 30 s window.

**Checkpoints and fallback.** At 60, 120, 180 and 240 s the presenter checks whether the agent has made the call the step expects. If it has not, and the agent has not responded within 15 s by the driver's clock, the presenter presses F9 (C.4). Agent slowness inside a step is absorbed by speaking over it.

### C.3 Opening and closing

- **First 30 s (purpose).** The platform already runs with the incident in its history and a live feed. The first utterance states the idea. The audience sees a working system before any agent is involved.
- **Final 30 s (strongest moment).** The agent's page, with an action button that the presenter approves on screen, changes a live simulated system, and the first post-change bucket shows the effect. The closing caption names the approval.

### C.4 Fallback driver

Every step is recorded in a **transcript** (`demo/transcripts/main.jsonl`), one line per step: step number, tool name, arguments, an **expectation predicate** and an expected outcome class. Idempotency keys are recorded as `tr:<transcript_id>:<step_id>`.

**Predicates, not digests, decide what is done.** A predicate is a closed expression over current semantic state: `exists(kind, label set)`, `panel_count(ref) >= n`, `field(ref, path) == value`, `changeset_status(id) == s`, `audit_contains(action, target)`. Predicates never mention revision numbers or the IDs the live agent generated. For example, the war-room step's predicate is `exists(dashboard, {war-room, payments}) and panel_count >= 3`.

**Semantic digest.** Final-state equality uses a semantic digest: canonical JSON of every document keyed by its kind and natural key (title and labels for dashboards; metric and threshold for alerts), with revisions, timestamps and generated IDs excluded. It is used for rehearsal equality and for F.2. It is not used for skipping.

**Takeover.** Once armed, the driver evaluates each remaining step's predicate in order. A satisfied step is skipped. For the first unsatisfied step, the driver issues the recorded call with its transcript key. A duplicate commit cannot occur through this path, because the commit is only issued when the predicate is false; a stale base returns `BASE_REV_STALE`, and the driver then halts and reports. If a key is reused with a different body the server returns `IDEMPOTENCY_KEY_REUSED` with the original changeset ID, the driver re-evaluates the predicate, and if it is still false, halts and reports on the presenter console.

**Arming (driver's own clock).** The driver polls `mcp_calls` through the API with its `driver` role (the server writes one row per tool call, reads included, refusals included). It is armed when any of these holds: (a) the agent principal has no `mcp_calls` row for 15 s by the driver's clock during a step whose predicate is false and that expects a call; (b) the same tool call is refused twice in a row; (c) a call returns an error the transcript marks as impossible. Silence is detected by absence from the call log, not by reading the audit log, which records only writes and refusals.

**Manual trigger.** F9 on the presenter console, or the "Replay" control in the console. It is one keystroke.

**Invisibility.** The audience screen shows only documents and changesets. Live and replayed paths write the same audit rows, with principal `agent:claude-code` and an attribute `driver=replay` shown only in the presenter console. Replay makes the same platform calls as the live agent.

**Rehearsal.** `demo-rehearse` runs the full script on a headless browser in three configurations: (1) the live agent replaced by a scripted client that makes the agent's typical calls; (2) the transcript only; (3) control scenario B with the transcript. Runs 1 and 2 must reach the same semantic digest. Run 3 must answer "no config change" and must not restore p95. Any mismatch fails the build. Rehearsal also records the commit-to-render latency distribution for C.2.

The live agent is the default. The transcript never animates anything; it only makes the same platform calls.

---

## D. Technical architecture

### D.1 Components

| Component | Responsibility | Technology | Persistence |
|---|---|---|---|
| `api` | HTTP API, WebSocket realtime, sessions, driver read endpoint | TypeScript on Node 22, Fastify, `ws` | Postgres |
| `mcp` | MCP server: tools, resources, discovery, call log | TypeScript, official MCP TypeScript SDK; Streamable HTTP and stdio | Postgres (through `core`) |
| `core` | Document model, validation, changesets, revisions, RLS context, audit, policy engine, scope grammar, query compiler, transforms, layout | TypeScript; Zod as schema source; Kysely as SQL builder | Postgres 16 |
| `engine` | Query compilation, transforms, panel data frames, alert evaluation | TypeScript inside `core`; run in `api`, `mcp` and `worker` | Postgres; in-process cache keyed by lineage digest |
| `web` | Single-page UI: war room, editor, screens, presence, approvals, conflicts | React 18, Vite, uPlot for timeseries, SVG for other viz | Browser memory; realtime subscriptions |
| `sim` | Seeded Harbour simulator, scenario runner, provider stub | TypeScript, separate process | Writes telemetry through `core` `Source` API |
| `worker` | Alert loop, workflow state machine, scheduled reports, exports, audit sealing | TypeScript | Postgres; event bus |
| `driver` | Transcript driver and rehearsal runner | TypeScript, same MCP client library | Transcript files |

One language across server, UI and MCP keeps the schema single-sourced. Postgres is chosen because RLS, row locks for changesets, the locked audit head and the query compiler's SQL need transactions and per-row policy.

### D.2 Persistence model

All tables live in schema `tessera`, with `workspace_id` on every row.

```sql
CREATE TABLE documents (
  id           text PRIMARY KEY,
  workspace_id text NOT NULL,
  kind         text NOT NULL,            -- dashboard | panel | query | metric | threshold | alert | workflow | action | screen | grant | source
  rev          integer NOT NULL,
  body         jsonb NOT NULL,           -- validated against the kind's schema, additionalProperties false
  owner        text NOT NULL,
  labels       text[] NOT NULL DEFAULT '{}',
  deleted_at   timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE revisions (
  document_id  text NOT NULL REFERENCES documents(id),
  rev          integer NOT NULL,
  body         jsonb NOT NULL,
  author       text NOT NULL,
  on_behalf_of text,
  changeset_id text NOT NULL,
  effective_at timestamptz NOT NULL,     -- equals commit time, except seeded config history
  PRIMARY KEY (document_id, rev)
);

CREATE TABLE changesets (
  id               text PRIMARY KEY,     -- cs_0421
  workspace_id     text NOT NULL,
  principal        text NOT NULL,
  on_behalf_of     text,
  status           text NOT NULL CHECK (status IN ('proposed','conflict','awaiting_approval','committed','rejected','discarded','expired')),
  base_revs        jsonb NOT NULL,
  ops              jsonb NOT NULL,       -- normalised ops
  ops_hash         text NOT NULL,        -- canonical hash of normalised ops
  policy_rule      text,                 -- A1..A15 that allowed auto-commit, or the rule that routed to approval
  result_digest    text,
  validation       jsonb NOT NULL,
  idempotency_key  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  UNIQUE (principal, idempotency_key)    -- keys are scoped to the principal
);

CREATE TABLE audit_head (
  workspace_id text PRIMARY KEY,
  seq          bigint NOT NULL,
  hash         text NOT NULL
);

CREATE TABLE audit_events (
  seq          bigint PRIMARY KEY,       -- assigned from audit_head under lock, never from a sequence object
  workspace_id text NOT NULL,
  principal    text NOT NULL,
  on_behalf_of text,
  action       text NOT NULL,
  target       text NOT NULL,
  changeset_id text,
  patch        jsonb NOT NULL,
  outcome      text NOT NULL,
  prev_hash    text NOT NULL,
  hash         text NOT NULL,            -- sha256(prev_hash || canonical(row))
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE grants (
  principal    text NOT NULL,
  effect       text NOT NULL CHECK (effect IN ('allow','deny')),
  scope        text NOT NULL,            -- verb:kind:selector
  delegated_by text,                     -- NULL for direct grants
  expires_at   timestamptz,
  revoked_at   timestamptz,
  PRIMARY KEY (principal, effect, scope, delegated_by)
);

CREATE TABLE mcp_calls (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  principal    text NOT NULL,
  tool         text NOT NULL,
  outcome      text NOT NULL,            -- ok | refused:<code> | error
  at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE view_state (                -- parameters and cross-filter selections; no revisions
  screen_id    text NOT NULL,
  dashboard_id text NOT NULL,
  key          text NOT NULL,
  value        jsonb NOT NULL,
  updated_by   text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (screen_id, dashboard_id, key)
);
```

Commit transaction, in order: `SELECT ... FROM audit_head WHERE workspace_id = $1 FOR UPDATE`; re-run the pipeline for the changeset against the locked state; write revisions; write one `audit_events` row with `seq = head.seq + 1` and `prev_hash = head.hash`; update `audit_head`. Every commit in a workspace is therefore serialised, and the chain order equals the commit order. The cost is measured in rehearsal, and commit rate is bounded by the rate limits anyway (D.5.9).

Row-level security is enabled on `documents`, `revisions`, `changesets`, `view_state` and telemetry tables. Each transaction sets `app.principal`, `app.on_behalf_of` and `app.scopes` with `SET LOCAL`. A missing setting denies. `changesets` rows are visible to the owning principal, its on-behalf-of human, and principals holding `commit` on the target. Telemetry tables are hourly partitions and check `read:source:<name>` scope.

Telemetry tables: `spans(ts, service, operation, duration_ms, status, retry_count, trace_id)`, `orders(ts, order_id, customer_email, amount_cents, status)`, `payment_attempts(ts, order_id, provider_latency_ms, outcome)`, `inventory_moves(ts, sku, delta)`.

### D.3 Declarative dashboard, panel, query and threshold specification

Agent-generated UI is a document, never code. Thresholds and metrics are separate documents that dashboards reference.

```json
{
  "kind": "dashboard",
  "apiVersion": "tessera.dev/v1",
  "id": "dash_war_payments",
  "metadata": { "title": "Payments latency: war room", "owner": "team:payments", "labels": ["war-room", "payments"] },
  "parameters": {
    "window":  { "type": "timerange", "default": { "from": "-30m", "to": "now" } },
    "service": { "type": "enum", "values": ["checkout", "payments", "inventory"], "default": "payments" }
  },
  "panels": [
    {
      "id": "p95",
      "viz": "timeseries",
      "title": "p95 latency",
      "query": {
        "source": "spans",
        "where": [
          { "field": "service", "op": "eq", "param": "service" },
          { "field": "ts", "op": "between", "param": "window" }
        ],
        "transform": [
          { "bucket": { "field": "ts", "every": "15s" } },
          { "percentile": { "field": "duration_ms", "p": 95, "as": "p95_ms" } }
        ]
      },
      "overlays": [
        { "threshold": "thr_payments_p95" },
        { "annotations": { "source": "audit.events", "where": [{ "field": "action", "op": "eq", "value": "config.change" }] } }
      ],
      "events": { "select": { "set": { "window": "$selection.range" } } }
    },
    { "id": "errors", "viz": "stat", "title": "Error rate", "metric": "payments.error_rate" }
  ],
  "layout": {
    "columns": 12,
    "items": [
      { "panel": "p95", "x": 0, "y": 0, "w": 8, "h": 4 },
      { "panel": "errors", "x": 8, "y": 0, "w": 4, "h": 2 }
    ]
  }
}
```

```json
{ "kind": "threshold", "id": "thr_payments_p95", "metric": "payments.p95_ms", "value": 800, "unit": "ms" }
```

```json
{
  "kind": "metric",
  "id": "payments.p95_ms",
  "source": "spans",
  "expr": { "percentile": { "field": "duration_ms", "p": 95 } },
  "group_by": ["service"],
  "bucket": "15s",
  "unit": "ms",
  "anomaly": { "method": "robust_z", "window": "2h", "threshold": 4.0 }
}
```

```json
{ "kind": "alert", "id": "payments_p95_oncall", "metric": "payments.p95_ms", "threshold": "thr_payments_p95", "for": "2m", "severity": "page", "on_fire": { "workflow": "page-oncall" }, "enabled": false }
```

Query documents (`QIR`) support `source`, `where` (typed operators `eq`, `in`, `between`, `gt`, `contains`), `select` with masks applied by the compiler, `join` on equal keys with a required `within` for time joins, transform stages (`bucket`, `percentile`, `rate`, `delta`, `top_k`, `pivot`, `sort`, `limit`), and named `params`. Compilation produces parameterised SQL with bound values only. A query whose estimated scanned rows exceed the principal's budget is refused with `QUERY_TOO_EXPENSIVE`, the estimate, and a narrower window as the fix.

The layout is a pure function from the layout document to positions, used by both the preview renderer and the browser. That is what makes the preview-equals-commit claim (F.1) testable.

### D.4 Changeset and operation model

A changeset is an ordered list of operations on documents, addressed by ID and JSON Pointer:

```json
{
  "ops": [
    { "op": "create", "kind": "dashboard", "id": "dash_oncall", "body": { "...": "validated against the dashboard schema" } },
    { "op": "add", "ref": "dash_war_payments", "path": "/panels/-", "value": { "id": "retry", "viz": "scatter", "query": { "...": "..." } } },
    { "op": "replace", "ref": "thr_payments_p95", "path": "/value", "value": 700 },
    { "op": "remove", "ref": "dash_war_payments", "path": "/panels/errors" }
  ],
  "label": "war room for payments latency",
  "base": { "thr_payments_p95": 2, "dash_war_payments": 1 }
}
```

Semantics:

- **Base.** `base` maps document IDs to the revision the author saw. A commit whose base differs from the current revision is rebased. Disjoint paths rebase. Overlapping paths are compared.
- **Equal-value rule (one rule).** If two sides edit the same path and the resulting values are equal, the edit merges as a recorded no-op (`merged_noop`) and is not a conflict. If the values differ, the result is `conflict` with the base, both values and both principals. There is no other case.
- **Referential integrity.** After any rebase, the integrity check runs on the merged state: a panel referenced by a layout item must exist, an overlay's threshold must exist, and an alert's threshold and metric must exist. A failed check is a `conflict` with the failing path.
- **Normalisation.** Ops are normalised before storage (path canonicalisation, default filling, schema validation). Stored ops are what diff and undo use.
- **Undo** takes a committed `change_id` and produces inverse ops from revision bodies. It is always a new changeset with the same policy rules as any change. History is never rewritten.
- **Semantic diff** compares typed documents by ID and path.

### D.5 MCP server design

#### D.5.1 Transport and identity

- **Streamable HTTP** at `/mcp`. Local: `http://127.0.0.1:8790/mcp`. AWS: `https://mcp.<domain>/mcp` behind the ALB.
- **stdio** for Claude Code and Claude Desktop, launching `tessera-mcp --stdio` with a token file written by `tessera login`. Same server code, same tools.
- **Auth.** OAuth 2.1 authorization code with PKCE. The issuer is the platform's OIDC provider (Cognito on AWS, Dex locally). Agent principals are created by an administrator and bound to one human by a delegation row. Tokens last 15 minutes and refresh only while the delegation is unrevoked. An agent cannot obtain a token whose scopes exceed its delegation.

#### D.5.2 Discovery and the call log

- `catalog.describe` returns, filtered by the caller's scopes, the kinds it can see with JSON Schema, one worked example, allowed verbs and required scopes. Output is paginated and capped. The error enum is published here.
- `tools/list` returns the 18 tools in D.5.3, each with preconditions in its description and an `outputSchema`.
- Resources: `tessera://catalog/kinds`, `tessera://documents/{id}`, `tessera://documents/{id}@{rev}`, `tessera://changesets/{id}`, `tessera://audit/{seq}`, `tessera://screens/{id}`. Reads return the same canonical JSON as the API.
- **Call log.** Every tool call writes one `mcp_calls` row (principal, tool, outcome, time). It is written for reads and for refusals, not only for writes. The driver reads this table for stall detection (C.4).

#### D.5.3 The tool catalogue: 18 tools, frozen after build step 8

The count is 18 everywhere in this document. The tool manifest `catalog/tools.json` is the source, and a test fails if any count or name in the documents differs from it. Tool names freeze at the end of build step 8 (H.4); the manifest hash is recorded in the transcript, and rehearsal fails if it changes.

All tools return the envelope `{ ok, data?, errors?, warnings?, next?, rate: {remaining, reset_ms}, trace_id }`. `next` names the single most likely next call. Strings from documents, sources and audit rows are wrapped as `{ "untrusted": "<text>" }`.

Discovery and reads:

1. `tessera.catalog.describe(input: { kind?: string, verbs?: string[] }) -> { kinds, error_codes }`
2. `tessera.resource.search(input: { kind: string, text?: string, labels?: string[], limit?: number <= 100, cursor?: string }) -> { items: { id, kind, title, rev }[], next_cursor? }`
3. `tessera.resource.get(input: { ref: string, rev?: number, include?: ("history")[] }) -> { body, rev, etag, lineage, history? }`
4. `tessera.query.explain(input: { query: QIR, params?: object }) -> { plan_summary, sources, estimated_rows, budget_ok, scope_ok, masks_applied }`
5. `tessera.query.run(input: { query: QIR, params?: object, mode?: "summary" | "rows" (default "rows"), limit?: number (agents default and maximum 200; humans maximum 10000) }) -> { columns, rows | aggregates, lineage_digest, scanned_rows, truncated }`
6. `tessera.presence.list(input: { ref: string }) -> { participants: { id, kind: "human" | "agent", cursor?, selection? }[] }` (only for refs the caller can read)

Writes:

7. `tessera.change.propose(input: { ops: Op[], base?: Record<string, number>, label?: string, expires_in_s?: number <= 900 }) -> { changeset_id?, status: "proposed" | "conflict" | "awaiting_approval" | "rejected", validation, diff?, preview?: { panel_count, digest, render_ref }, policy_rule? }`. There is no dry-run flag. Invalid ops return `rejected` and create no row. Valid ops create a changeset that expires.
8. `tessera.change.commit(input: { changeset_id: string, idempotency_key: string }) -> { status: "committed" | "merged_noop", revisions: { id, rev }[], result_digest, policy_rule, replayed?: boolean }`
9. `tessera.change.discard(input: { changeset_id: string }) -> { status: "discarded" }`
10. `tessera.change.undo(input: { change_id: string }) -> { changeset_id, status: "proposed" | "awaiting_approval", diff }`
11. `tessera.change.list(input: { principal?: string, ref?: string, since?: string, status?: string[] }) -> { items: ChangeSummary[] }`

Screens, audit and access:

12. `tessera.screen.show(input: { target: string, view: { ref, rev?, params? } | { changeset_id }, mode?: "queued" | "live", note?: string <= 140 }) -> { screen_id, subscribers, state: "shown" | "queued" }`. A proposal shown with `queued` waits for a human Show click on the screen or console. Only `live` views and human-clicked proposals reach shared screens.
13. `tessera.audit.search(input: { since: string, until?: string, principal?: string, action?: string[], ref?: string, limit?: number <= 500 }) -> { items: AuditRow[], head_hash }`
14. `tessera.audit.verify(input: { from_seq?: number, to_seq?: number }) -> { ok, events, head_hash, first_bad_seq?, gaps: number[] }`
15. `tessera.access.explain(input: { principal?: string, ref: string, verb: string }) -> { allowed, via: string[], missing_scopes?: string[] }`
16. `tessera.access.request(input: { scopes: string[], reason: string <= 280, ref?: string }) -> { changeset_id, status: "awaiting_approval" }`. It creates an approval; the agent cannot grant.

Dry runs and tests:

17. `tessera.action.dry_run(input: { action: string, input: object }) -> { plan: Step[], side_effects: string[], plan_digest, requires_approval: boolean }`
18. `tessera.alert.test(input: { rule: string | AlertRule, window: string }) -> { fired_at: string[], resolved_at: string[], evaluated_points: number }`

Not present, by design: `workflow.trigger` (a workflow runs by committing an action or by an alert), `history.list` (folded into `resource.get`), and any tool that executes code or SQL.

#### D.5.4 Commit policy: named rules for agent writes

Human principals commit under their own scopes and are not subject to this table. The table applies to agent principals. A changeset **auto-commits** only if every op in it is auto-class. If any op is not, the whole changeset is `awaiting_approval`, and the agent splits its work into changesets that are separately classifiable.

| Rule | Op and target | Class | Test |
|---|---|---|---|
| A1 | `create dashboard` in an agent-delegated team | Auto | F.2 row A1 |
| A2 | `add annotation` (from a query or audit row) | Auto | F.2 row A2 |
| A3 | `add panel`, visualization or text panel on a dashboard the team owns | Auto | F.2 row A3 |
| A4 | `remove panel` on a dashboard the team owns (reversible by undo) | Auto | F.2 row A4 |
| A5 | `replace` panel options or layout on a dashboard the team owns | Auto | F.2 row A5 |
| A6 | `add column mask` (restricts access) | Auto | F.2 row A6 |
| A7 | `remove column mask` (widens access) | Approval | F.2 row A7 |
| A8 | `replace` a threshold value | Approval | F.2 row A8 |
| A9 | `create` or `replace` an alert rule | Approval | F.2 row A9 |
| A10 | `bind` an alert or button to a workflow or action | Approval | F.2 row A10 |
| A11 | `grant` any read, write or show scope on a document | Approval | F.2 row A11 |
| A12 | any change to `grants` or delegations | Refused (not routed) | F.2 row A12 |
| A13 | any action run or `config.change` write | Approval, every time | F.2 row A13 |
| A14 | any write to a dashboard the agent's team does not own | Refused (`SCOPE_DENIED`) | F.2 row A14 |
| A15 | `delete` any document | Approval | F.2 row A15 |

Each agent commit records its rule in `changesets.policy_rule`, and the screen shows the rule ID on the commit card. The rule set is closed; an op matching no row is refused.

#### D.5.5 Scope grammar

- **Form.** `verb:kind:selector`. Verbs are closed: `read`, `write`, `commit`, `grant`, `show`, `run`. Kinds are closed and follow the `kind` enum in D.2, plus `column` (for `orders.customer_email`-style selectors) and `source`.
- **Selectors.** `*` matches every instance of the kind. An identifier (`dash_finance_revenue`) matches that document or column exactly. `label:<key>=<value>` matches a document whose labels contain that pair. There are no other selector forms, and `*` only stands alone.
- **Matching.** A scope matches a request when the verb and kind are equal and the selector matches the target: `*` matches any target, an identifier matches only that ID, and a label selector matches only if the target carries the label.
- **Precedence.** A matching `deny` grant refuses the request whatever allow grants match. Denies are never overridden by allows. Deny is the only precedence rule.
- **Containment.** Scope `d` contains scope `g` when verb and kind are equal and either `d.selector` is `*`, or `d.selector` equals `g.selector` exactly. Label selectors contain only identical label selectors. Anything not provably contained is dropped.
- **Delegation intersection.** The agent's effective allow set is `{ g in agent_grants : some allow d in delegator_effective contains g, and no deny matches g }`, computed at token issue and again on each call. The delegator's effective set is what the delegator could do now. A delegation that is revoked or expired removes the agent's effective set at once.
- **Tests.** One test per rule: selector match (`*`, id, label present, label absent); deny precedence over allow; containment (wildcard delegator, identical selector, label-identical, label-not-identical dropped, different verb dropped); intersection (narrowed scope mid-session, expired delegation, revoked delegation). All are in F.2.

#### D.5.6 Idempotency and propose identity

- Every `commit` requires an `idempotency_key`, unique per principal (D.2). A repeated commit by the same principal with the same key and the same `ops_hash` returns the original result with `replayed: true`. The same key with a different hash returns `IDEMPOTENCY_KEY_REUSED` with the original changeset ID, so a retry cannot silently overwrite a decision.
- Two principals using the same key value never collide.
- `propose` is idempotent by content within a principal: `(principal, base, ops_hash)` returns the existing live proposal. Another principal's identical ops create their own proposal.
- Changesets expire after 15 minutes by default. Commit after expiry returns `CHANGESET_EXPIRED` and the fix is a new `propose`.

#### D.5.7 Presence and read checks

- `presence.list` and the presence bar return only participants whose ref the caller can read. A participant on an unreadable document is not listed and is not counted.
- Presence entries for agents carry the same fields as human entries. The agent's cursor is the panel or threshold it is editing, not a pixel position.

#### D.5.8 Human approval and the demo's approvers

- The approver of an `awaiting_approval` changeset must hold `commit` on its target. Approval is recorded as the approver principal, with on-behalf-of where relevant.
- The demo's presenter is `brice`, who is also the agent's delegator. The config option `four_eyes` (requiring an approver different from the delegator) exists and is off in this demo. Every approval card that the presenter clicks shows "approved by brice (presenter; also the agent's delegator; four-eyes off in this demo)".

#### D.5.9 Rate limits and budgets

- Token buckets per principal: `propose` 30 per minute, `commit` 10 per minute, `query.run` 120 per minute, `screen.show` 20 per minute. Responses carry `rate.remaining` and `rate.reset_ms`.
- Concurrency: at most 4 in-flight `query.run` per agent principal.
- Query budget: agents may scan at most 5 million estimated rows per query (a configured figure). Above that, `QUERY_TOO_EXPENSIVE` with `fix: {narrow: "window", suggested: "-15m"}`.

#### D.5.10 Error envelope

Every error has `code` (from the closed enum), `path` (JSON Pointer into the op or input), `message` (short and literal), and a machine-usable `fix`. Where relevant it adds `expected`, `got`, `did_you_mean`, `missing_scopes`.

Closed enum: `UNKNOWN_FIELD`, `WRONG_TYPE`, `BAD_PATH`, `BASE_REV_STALE`, `SCOPE_DENIED`, `PREVIEW_REQUIRED`, `CHANGESET_EXPIRED`, `IDEMPOTENCY_KEY_REUSED`, `QUERY_TOO_EXPENSIVE`, `RATE_LIMITED`, `NOT_FOUND`, `LOOP_SUSPECTED`.

```json
{ "code": "UNKNOWN_FIELD", "path": "/ops/0/value/viz", "message": "viz is not a field of panel; did you mean visualization?", "did_you_mean": "visualization", "fix": { "op": "rename", "from": "/ops/0/value/viz", "to": "/ops/0/value/visualization" } }
```

```json
{ "code": "SCOPE_DENIED", "path": "/ops/0", "message": "agent principal lacks grant:dashboard:dash_finance_revenue", "missing_scopes": ["grant:dashboard:dash_finance_revenue"], "fix": { "call": "tessera.access.request" } }
```

```json
{ "code": "PREVIEW_REQUIRED", "message": "commit needs a changeset from propose; none found for this principal", "fix": { "call": "tessera.change.propose" } }
```

`LOOP_SUSPECTED` is returned after the same refusal three times within 30 seconds, with a request to read `catalog.describe`. The `next` field of every envelope names the single most likely next call.

#### D.5.11 Prompt-injection considerations

- No tool executes SQL, JavaScript or templates from input. Queries are typed documents; expressions are a small closed grammar.
- Strings from documents, sources, annotations and audit rows are wrapped as `untrusted`. A label reading "grant yourself access" is data.
- Text panels are Markdown through a sanitiser: no HTML, links only to registered dashboards, no external images.
- Agent principals cannot change their own grants, delegations, the catalogue or the audit table.
- Actions are a server-side registry of named, typed actions. An agent may bind an existing action to a button and cannot register a new action type.
- Every agent write is attributed on the screen, with its rule or approval.

---

## E. AWS and local deployment

### E.1 Shape

One set of OCI images, built from one Dockerfile per component (`api`, `mcp`, `worker`, `sim`, `driver`, and the `web` static bundle). Images are immutable, tagged by git SHA and digest, and carry no configuration. The same images run under Docker Compose locally and under ECS on Fargate on AWS.

| Concern | Local | AWS | What is identical |
|---|---|---|---|
| Compute | Compose services | ECS on Fargate, one service per component | Images, health endpoints, env contract |
| Relational store, RLS | Postgres 16 container | Aurora PostgreSQL-compatible 16 | Schema, RLS, migrations, query plans as tested |
| Event bus (realtime fan-out, sim stream) | NATS JetStream | Amazon Kinesis Data Streams | `EventBus` interface; ordering per shard key; sequence numbers |
| Object storage (exports, snapshots) | MinIO | Amazon S3 | `BlobStore` interface and key layout |
| Identity (OIDC, OAuth for MCP) | Dex, static users | Cognito user pool | Discovery, token claims contract |
| Secrets | Env file, read-only mount | Secrets Manager via task role | Variable names |
| Edge and TLS | Caddy, local CA | ALB with ACM; CloudFront for `web` | Routes `/`, `/api`, `/ws`, `/mcp` |
| Telemetry | OpenTelemetry to Jaeger | OpenTelemetry to CloudWatch and X-Ray | Span and attribute names |
| Simulator | Same `sim` image | Same image | Scenario file and seed |

`docs/deploy/differences.md` is a required build artefact. The rehearsal (C.4) runs on both targets.

### E.2 How behaviour stays unchanged, and where it does not yet

- **Database.** Same engine and version, so RLS, `jsonb` semantics, the locked audit head and the compiler's SQL are identical. Aurora's storage layer is invisible to SQL.
- **Event bus.** Behind an `EventBus` interface with one contract suite. **Shard key:** `workspace_id` and `document_id` hashed together, so a document's events are totally ordered on one shard and each event carries its sequence number. Consumers drop any event at or below their last applied sequence for that document. On NATS the subject is the same key.
- **Kinesis gate.** The contract suite has never run against Kinesis. It runs in a **pre-stage AWS environment** before any claim that depends on AWS realtime is made. Until the suite passes there, the realtime claims in F are stated for the local NATS path. This is a gate in the build order (H.4 step 15), not a note.
- **Identity.** Standard OIDC and OAuth 2.1 with PKCE. The MCP server validates issuer and audience, so switching issuers is configuration.
- **Time.** Audit timestamps and changeset expiry use the database clock in both environments.

### E.3 MCP exposure

- **Local.** stdio for Claude Code on the presenter's machine, reading a token written by `tessera login`; and Streamable HTTP on loopback with Dex-issued PKCE tokens.
- **AWS.** `https://mcp.<demo-domain>/mcp` behind the ALB, ACM TLS, Cognito OAuth 2.1. The ALB rate-limits `/mcp` as a second layer above the application buckets (D.5.9). The demo network admits only the presenter's address.
- The MCP server is stateless between requests except for changesets, the call log and session records in Postgres, so it scales horizontally.

### E.4 Reset, readiness and health

- `make demo-reset` tears down volumes, runs migrations, seeds reference data, writes the deterministic backfill ending at T0, writes the seeded commit at audit sequence 1187, starts the simulator at T0, and prints a semantic digest per seed table. A mismatch against the committed digest fails the reset.
- `/healthz` (process), `/readyz` (database, bus, identity discovery, seed digest), and the MCP `tools/list` probe.

---

## F. Five strongest technical claims

**F.1 (Preview equals commit).** For any changeset, the digest from `change.propose` equals the digest of the state that `change.commit` produces with the same base, and the preview's layout hash equals the committed panel's layout hash.
- *Test:* property test over 500 seeded changesets (panels, parameters, thresholds, layouts, identical-value edits included). Each runs `propose`, records digest and layout hash, runs `commit`, reads the document and renders it. Equality on every case. A failure prints the minimal failing ops.
- *Why it is strong:* preview and commit are one pipeline, so this is a property of the code.

**F.2 (The agent cannot exceed its scope, including through approval).** An agent whose delegation covers `write:dashboard:team-ops`-class grants cannot write outside its team, cannot grant itself scope, cannot commit an approval, and cannot use a stale or forged changeset.
- *Test, probes:* 40 scope-escalation probes from a scripted MCP client: direct calls, each op kind, paths to a grant, attempts to commit an approval, forged or stale changeset IDs, a token narrowed mid-session, and labels in seeded documents that say "grant yourself access". Assertions: each probe returns `SCOPE_DENIED`, `PREVIEW_REQUIRED` or `awaiting_approval`; each writes a `scope.denied` or `policy` audit row with principal and target; the semantic digest changes only in the expected set.
- *Test, policy rows:* one test per row A1 to A15 (D.5.4), each asserting the status and the recorded rule.
- *Test, grammar:* one test per rule in D.5.5 (selector match cases, deny precedence, containment cases, intersection cases including revocation).

**F.3 (Undo is exact for any interleaving).** For any sequence of N committed changesets from interleaved human and agent principals, undoing them in reverse order restores every document to its pre-sequence semantic digest, and the audit chain verifies after each step.
- *Test:* property test with N up to 200, random interleaving of three humans and one agent, ops including panel moves, threshold changes and alert creation. Assertions: digest equality after full undo; `audit.verify` `ok` after each step; each undo adds exactly one revision per affected document.
- *Why it is strong:* undo is itself a changeset with the same rebase and policy rules, so it cannot rewrite history or drop a concurrent edit.

**F.4 (Convergence and chain integrity under concurrency).** Five browser clients and one agent client edit one dashboard for 60 seconds with 1,000 random operations, including overlapping edits to the same threshold with equal and different values. Separately, 50 concurrent commits from 10 principals hit one workspace.
- *Test, convergence:* headless clients run the same `web` store under Node with a WebSocket adapter, plus the MCP driver. Assertions: every client's document equals the server's at the final revision; equal-value overlaps appear as `merged_noop`; different-value overlaps appear as `conflict` and are never silently merged; each committed op appears exactly once in revision history; no duplicate idempotency key per principal.
- *Test, fork:* after the 50 concurrent commits, `audit.verify` returns `ok`, sequence numbers are contiguous, and there is exactly one chain (no two rows share a predecessor). The test is run on the locked-head implementation and fails on a version without the lock.

**F.5 (Error envelopes are self-correcting, measured two ways).** Given 50 malformed proposals drawn from common agent mistakes (unknown field, wrong type, wrong path, stale base revision, missing scope, reused idempotency key), every refusal carries a closed-enum code and a `fix` that, applied, yields a valid proposal on one retry.
- *Test A, envelope consistency (scripted):* a scripted client applies each `fix` mechanically and retries once. Assertion: 50 of 50 valid on the first retry, except `SCOPE_DENIED` cases, which must become `awaiting_approval` after `access.request`. No error message exceeds 280 characters. This proves that the envelope is consistent. It does not prove that any model can follow it, and this proposal does not claim it does.
- *Test B, model in the loop (measured, reported separately):* an external model, not a scripted client, is given the 18 tool descriptions and the same 50 malformed proposals, and chooses its own retries. The result is reported as counts with the model ID and run date. It is a measurement of the MCP surface with that model. It is not a platform claim, and the platform does not change its behaviour based on the result.

---

## G. Failure analysis

### G.1 Implementation difficulties

- **Three-way rebase of JSON documents.** Disjoint JSON Pointer paths can still conflict semantically (two panels with one ID, a panel moved into a removed row). The integrity check after merge (D.4) is where most bugs will live. F.4 runs overlapping edits with the check after every commit.
- **Preview equals commit.** The preview must use the same layout function, query compiler and mask set. The preview is produced by rolling back the commit transaction after computing the same steps, not by a second implementation. F.1 tests it.
- **RLS under pooling.** Settings are transaction-local (`SET LOCAL`), and the only database access path is `withPrincipal(tx)`. A lint rule forbids pool use in route handlers. A test checks that a second request on the same connection sees its own scopes.
- **Audit head contention.** The locked head serialises every commit in a workspace. This is the cost of a single chain, and it is accepted: commit rate is bounded by the rate limits (D.5.9), and the contention is measured in rehearsal. Sharding the chain per document would break the "one chain, verifies end to end" claim, so it is not done.
- **Query compiler with masks and time joins.** Masks apply before aggregation and before join keys are exposed. Time joins without `within` are rejected at compile time.
- **Realtime fan-out.** Subscriptions are by document ID and sequence number. A client that falls behind receives a resync with the current revision.
- **Declarative layout.** v1 renders the 12-column grid and collapses to one column below a fixed width.

### G.2 On-stage failure modes

| Failure | Symptom on screen | Mitigation |
|---|---|---|
| Agent silent for 15 s by the driver's clock | Screen unchanged; Claude Code busy | Driver arms (C.4); presenter speaks over; F9 |
| Commit before propose | `PREVIEW_REQUIRED` in terminal only | `next` names `change.propose`; screen unchanged |
| Hallucinated field | Refusal in terminal | `UNKNOWN_FIELD` with `did_you_mean`; F.5 |
| Stale base revision | Conflict card on screen | Three-way view; agent reports, does not overwrite |
| Wrong metric name | "Unknown metric" in preview | Preview catches it; `catalog.describe` lists metrics |
| Model unreachable | Claude Code error | F9 or automatic arming |
| Browser network drop | Presence disappears; "reconnecting" in corner | Resync on reconnect |
| Simulator stall | Charts flat | Health indicator on source tile; reset restores seed digest |
| Database failover on AWS | Brief write errors | Idempotency keys make client retries safe; outside the demo window |
| Presenter approves the wrong card | Approval committed | Card shows target and plan digest; undo (F.3) |

### G.3 Agent failure modes in depth

- **Wrong tool call.** Most likely: `query.run` on a wrong source or field. The platform does not guess. `query.explain` lists sources and fields, and the preview shows an empty result.
- **Hallucinated fields and kinds.** Schemas are closed. Hallucinations surface as `UNKNOWN_FIELD` with suggestions.
- **Over-eager commits.** The policy table (D.5.4) decides, not the agent. A changeset with one approval-class op waits as a whole.
- **Split-attempt.** An agent that splits an approval-class op into auto-class changesets is still refused for that op: classification is per op, and a split that moves an approval-class op into its own changeset is routed to approval.
- **Latency.** Agent round trips are outside the platform. Platform targets at the 95th percentile on the reference rehearsal host are 300 ms for `propose`, 300 ms for `commit`, and 1 s for `query.run` over the seeded window. These are targets to check in rehearsal, not measured results.
- **Looping.** Repeated identical refusals return `LOOP_SUSPECTED` after three within 30 seconds, with a request to read `catalog.describe`. Rate limits bound the rest.

### G.4 Hidden complexity

- **Semantic diff needs stable identities.** Panels and items have stable IDs, and `create` requires IDs. This is why moves, renames and reorders diff correctly.
- **Lineage digests** must be stable across engine versions. Digests cover canonical query and result bytes plus the mask set; a compiler change bumps a recorded version field.
- **Audit verification** runs against the writer, because reads from replicas can lag the head.
- **Config history as data.** The simulator reads `payments.retry.max` as of a simulated second. That requires the config history to be queryable by `effective_at`, which is a real requirement on `revisions`, not a special case for the simulator.

### G.5 Simplifications the demo depends on, stated honestly

- **The retry-amplification model** is deliberate and deterministic, and driven by a real configuration value. It is not a model of any payment provider. The demo claims that configuration changes flow through the platform and back into data. It does not claim the simulator predicts real provider behaviour. The screen footer says so.
- **The incident is seeded.** The config change that causes the spike is a seeded commit, so the answer exists in the data. The agent's job is to find it by correlation and audit join, and the rehearsal's control scenario B (C.4) tests that the agent says "no change" when there is none. Accepted as a limitation of any demo with a known cause.
- **Anomaly detection** is a robust z-score over a window. It is not a learned model and is not described as one.
- **Kinesis** is not exercised locally, and the AWS realtime claim is withheld until the pre-stage suite passes (E.2).

### G.6 Shallow features: an honest list

- **Embeds (P41)** are a signed scoped URL. No SDK, theming API or cross-origin messaging.
- **Scheduled reports (P39)** render a snapshot with lineage, not a paginated formatted PDF.
- **Branches (P34)** are revision lines with a three-way merge. No branch review UI.
- **Templates (P38)** are dashboards with holes. No template library.
- **Forms (P20)** write one validated row. No multi-step forms or uploads.
- **Anomaly detection (P42)** is one statistic. The platform does not call it AI.
- **Multi-tenancy** is a `workspace_id` with RLS. No provisioning UI.
- **The UI editor** is a form-and-drag editor for panels and layouts. It is adequate for the demo and is not a visual builder.

---

## H. Feasibility

### H.1 Scope by component

- `core`: kinds and schemas, changeset pipeline, policy engine, scope grammar, revisions, audit head and chain, RLS context, query compiler, transforms, layout. It touches every other component and carries F.1, F.2, F.3 and the grammar tests.
- `mcp`: the 18 tools, resources, error enum, rate limits, idempotency, call log, auth middleware. It depends on `core`.
- `api` and realtime: HTTP routes mirroring the tools, WebSocket subscriptions, presence with read checks, screen push, `view_state`. Carries F.4 with the browser store.
- `web`: war room, panel and layout editor, approval, conflict and queued-proposal cards, presence bar, diff view, audit timeline, screens. Depends on `api`.
- `sim`: seeded simulator, scenario files (incident and control B), provider stub, backfill writer, config-as-of reads. Depends on `core`'s `Source`.
- `worker`: alert loop, workflow state machine, scheduled reports, export rendering, audit sealing. Depends on `core` and the bus.
- `driver` and rehearsal: transcript format, predicates, takeover, scripted client, CI rehearsal on both targets. Depends on everything above and comes last.
- Deployment: one Dockerfile per component, Compose file, infrastructure-as-code for the AWS stack (ECS, Aurora, Kinesis, S3, Cognito, ALB, ACM, Secrets Manager), migration runner, reset command.

### H.2 Critical dependencies

- The **MCP TypeScript SDK**'s Streamable HTTP and stdio support, at the version pinned in the lockfile.
- **Postgres RLS under pooling**, which is well understood and unforgiving. Its test is in the first slice.
- **The rebase and integrity algorithm for JSON documents.** This is original code with no library equivalent. It is the most important piece to get right.
- **Kinesis behaviour** for the AWS realtime claim, which is gated (E.2).
- **uPlot** for timeseries, behind the viz interface so it can be replaced.

### H.3 Main risks

- Rebase bugs that F.4 finds late. Mitigation: F.4 is in the first set of tests and runs on each stack.
- Agent latency dominating the choreography. Mitigation: agent calls sit in short windows with checkpoints and F9.
- Two-session demonstration. Mitigation: rehearsal runs two real sessions; the on-stage presenter labels Priya's session on screen (accepted).
- Aurora behaviour under load. Mitigation: the AWS rehearsal is a gate; the local rehearsal does not substitute for it.

### H.4 Dependency-ordered build sequence

Each step depends on the ones before it.

1. **Kinds and schema single source.** One kind (`dashboard`), validation, `documents` and `revisions` with RLS, and `effective_at`.
2. **Changeset pipeline.** Propose and commit for create, add and replace; digest; `ops_hash`; locked audit head; audit row with chain. F.1 and F.3 begin.
3. **Principals, grants and scope grammar.** Agent principal, grants with effect, containment and intersection, `SCOPE_DENIED`, `mcp_calls`. F.2 begins.
4. **Query compiler, one source.** `QIR` over `spans`: `where`, `bucket`, `percentile`, explain, budget, masks, lineage digest.
5. **MCP with the first six read and query tools and the error envelope.** F.5 begins.
6. **Simulator and backfill** with the incident seed, the config-as-of reads and the T0 anchor. Semantic digest check on reset.
7. **Realtime and the browser store.** Live panels on the war room. F.4 begins.
8. **Remaining tools, policy table and approval routing.** The manifest is frozen at the end of this step and its hash is recorded. Rule tests A1 to A15 run here.
9. **Audit as a source and annotations.** The 14:03 join; the scatter.
10. **Presence, conflicts and the conflict card.** Equal-value no-op and different-value conflict tests.
11. **Alerts, backtest, workflows with approval gates** (`worker`).
12. **Actions with dry run**, the rollback action and the on-call page composition.
13. **Column masks in Finance views**, embeds and exports.
14. **Web editor, diff view, audit timeline.**
15. **Deployment: Compose locally, then the AWS stack from the same images.** The Kinesis contract suite runs in pre-stage before any AWS realtime claim.
16. **Driver, transcript, predicates, takeover, scripted rehearsal** on both targets, including control scenario B.
17. **Presentation polish** and the final script rehearsal with measured latency.

Steps 1 to 5 are the minimal vertical slice: a human sees a proposal diff in an API response and an agent produces it through MCP. Steps 6 and 7 make it appear on a screen. Later steps add capabilities that compose with the slice. The driver is last because the transcript depends on the frozen tool surface from step 8.

### H.5 What would change the design

- If rehearsal latency repeatedly exceeds a choreography window, the first response is fewer, larger changesets from the agent. A platform cache of model output is not an option, because the brief forbids a model in the platform.
- If the rebase cannot be made correct within the build sequence, the fallback is to reject concurrent edits to the same document instead of merging them. F.4 stays true, at the cost of collaboration breadth, and this document would say so.
- If the Kinesis suite fails in pre-stage, the AWS realtime claim is dropped and the platform ships with NATS on AWS only until it passes.

---

*End of proposal 06, revision 1. Word count estimate: about 9,000 words including tables and code blocks.*
