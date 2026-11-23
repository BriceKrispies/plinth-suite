# Tessera: an agent-native composable operations platform

Proposal 06, mandate: Agent-Native Innovation. Competitor 06 of the demo design tournament.
Work item WG-5518. Design only; nothing in this document has been built or run.

**Product title:** Tessera
**Pitch:** Tessera is an operations platform in which every panel, query, alert, workflow and permission is a typed, versioned document, so an external agent over MCP uses exactly the primitives a human uses and every change it makes is previewed, scoped, audited and undoable. In five minutes, on one screen, an agent turns a plain question about a payments latency spike into a live war-room, an evidence-backed explanation, an alert, a permissioned finance view and a rollback button, while the platform's own audit log proves who changed what.

---

## A. Product concept

### A.1 What the platform is

Tessera is a composable dashboard and operations platform. Its unit of work is a **document**: a dashboard, a panel, a query, an alert rule, a workflow, a form, a permission grant or a screen is a typed JSON document with a kind, a schema, a revision and an owner. Documents reference each other by stable IDs. The platform has one type system (JSON Schema generated from one TypeScript definition per kind), one authorization model, one change log, one real-time channel and one revision model. Every surface, the web UI, the HTTP API and the MCP server, is a view over the same document store and the same change pipeline.

The agent-native idea is a single inversion. In most dashboard products the UI is the source of truth and automation is a second-class API bolted on. In Tessera the document is the source of truth, the UI is a renderer and an editor of documents, and the MCP server is a third editor of the same documents with the same guarantees. An agent is therefore not a special case that needs bespoke intelligence in the platform. It is a principal that proposes changesets against typed documents, previews them, and commits them after policy checks. The platform contains no language model. All of its behaviour is deterministic code.

What the agent can do that neither a human nor a plain automation script can do alone is the combination of three things:

1. **Interrogate** the system by composing queries across business telemetry and the platform's own audit log, which Tessera exposes as an ordinary data source.
2. **Compose** a UI that answers the question from primitives, previewed on the screen before anyone commits it.
3. **Stay accountable**: its changes carry its principal, the human it acts for, and a changeset ID. Humans can see its proposals as ghost overlays, approve or reject them, and undo them.

### A.2 Who uses it

- **Operations and on-call engineers** use the war-room dashboards, alerts and rollback actions.
- **Service owners** author their own dashboards and alert rules, and review agent proposals against them.
- **Finance and business analysts** consume masked, row-filtered boards and export them on a schedule.
- **Platform administrators** own scopes, delegations, approvals and the audit chain.
- **Engineering agents** (Claude Code, Claude Desktop or any MCP client) act on behalf of one of the human users above, within a delegated scope.

### A.3 The data and where it comes from

The demo is about **Harbour**, a simulated order-fulfilment system: a `checkout` service, a `payments` service that calls an external-provider stub, an `inventory` service and a `fulfilment` queue. The data is entirely produced inside the platform's own containers, so it is real in the sense that matters for the demo: it is generated, persisted, queried and changed through the platform, and it is reproducible.

- **Seeded simulator.** A deterministic simulator (TypeScript, a xoshiro256** PRNG seeded from a constant that is part of the demo configuration) emits spans, orders, payment attempts, inventory movements and provider responses. Event rate is a configuration value (default 200 events per second, a measured figure to be confirmed in rehearsal, not a promise). A **scenario file** scripts the one incident of the demo: at simulated minute 35 after reset (the simulated clock reads 14:05 in the demo timezone when reset happens at 13:30), the payments provider stub's latency distribution shifts because the simulator's retry-amplification model is driven by the `payments.retry.max` setting that the simulator reads from the platform's configuration store. The setting was raised by a named human at 14:03 through a normal Tessera change, which lands in the audit log. The spike is therefore caused by a real platform change that is visible in the platform's own history, which makes the interrogation honest. The retry-amplification model is a documented simplification (see G.5).
- **Backfill.** Reset writes two hours of simulated history (an estimated 1.4 million span rows at the default rate, labelled as an estimate) so that window queries are not empty at the start of the demo.
- **Audit as a source.** The audit log is exposed as the `audit.events` source, so "what changed in the last hour" is a query, not a special feature. Annotations, lineage and presence all read the same table.
- **Free and self-hosted.** Nothing calls a paid API. The provider stub is part of the simulator. The LLM is the external agent only.

Sample data is reproducible in two senses: `make demo-reset` produces byte-identical seed tables (checked by a table digest), and the scenario fires at the same simulated offset every time.

### A.4 Why this demonstrates the mandate

The audience sees an agent connected to the platform do five things with the same primitives a human has: query, compose, preview, commit and undo. It is attributed in the UI, it is refused where its scope ends, and the platform can answer questions about its own history. The strongest moment (C, final 30 s) is the agent composing a new on-call page with a rollback action, which the presenter presses on the screen, and watching the simulated system respond in the same chart.

---

## B. Capability inventory

### B.1 Primitive table

Status key: **D** demonstrated in the five-minute script; **S** supporting, implemented and tested but not on the script's main path.

| ID | Primitive | Status | Technical significance | Composes with |
|---|---|---|---|---|
| P01 | Source connector (simulator stream, Postgres table, HTTP JSON, audit log) | D | Single `Source` interface with `schema()`, `scan(predicate, projection)`, `watch()` | Query, Lineage, Realtime |
| P02 | Audit log as source (`audit.events`) | D | The platform's own history is queryable like business data | Query, Annotation, Anomaly |
| P03 | Typed kinds and schema registry | S | One TypeScript definition yields JSON Schema, validators, MCP schema and UI forms | Every document kind |
| P04 | Query (typed relational JSON, `QIR`) | D | No raw SQL from clients; compiled to parameterised SQL; RLS and masks applied at compile time | Source, Transform, Panel, Alert, Export |
| P05 | Transform stages (bucket, percentile, join, pivot, delta, top-k, sort) | D | Pure functions over row streams; composable pipeline | Query, Panel, Metric |
| P06 | Computed metric (named expression over a query) | D | Metrics are documents; used by alerts, panels and anomaly rules | Query, Threshold, Alert |
| P07 | Visualization (timeseries, table, stat, heatmap, scatter, text) | D | Each viz declares the data shape it accepts, validated before render | Panel, Annotation, Threshold |
| P08 | Panel (query + transforms + visualization + options) | D | Basic composition unit; carries its lineage hash | Dashboard, Screen, Changeset |
| P09 | Layout (12-column grid, responsive reflow) | S | Pure function from layout document to positions; reused by preview renderer | Dashboard, Template |
| P10 | Dashboard document (parameters, panels, layout, links) | D | Versioned document; the target of most changesets | Panel, Branch, Diff, Embed |
| P11 | Parameter (timerange, enum, text, reference) | D | Typed inputs that panels and links bind to | Query, Link, Template |
| P12 | Cross-filter link (selection event to parameter) | D | Declarative event-to-parameter binding; no code | Panel, Parameter |
| P13 | Drill-down (link to dashboard with parameters) | S | Navigation as a link document | Dashboard, Parameter |
| P14 | Threshold (line, band, or bound on a metric) | D | Draggable in UI; a document field, so agents and humans edit the same value | Metric, Alert, Viz |
| P15 | Alert rule (metric, threshold, `for` duration, severity) | D | Evaluated by the same engine as panels, so a panel and its alert cannot disagree | Metric, Threshold, Workflow |
| P16 | Alert backtest (`alert.test` over history) | D | Replays the rule over stored data; reports would-have-fired times | Alert, Query |
| P17 | Annotation (marker from query or audit event) | D | Markers on charts sourced from any query, including audit | Viz, Audit |
| P18 | Workflow (trigger, steps, approval gate, actions) | D | Finite state machine with persisted transitions | Alert, Action, Approval |
| P19 | Action (registered side effect with dry-run) | D | Typed side effect; dry-run executes validation and produces a plan | Workflow, Form, Button |
| P20 | Form (write-back to a table, validated) | S | Writes go through the same changeset path as documents | Action, Source |
| P21 | Changeset (ops, validation, preview, commit) | D | The universal write unit for humans and agents | All document kinds |
| P22 | Approval request | D | A changeset that needs a human principal's commit; shown on screens | Changeset, Delegation |
| P23 | Principal (human, service, agent) | D | Agents are principals with their own identity, never shared human sessions | Scope, Audit |
| P24 | Scope grammar (`verb:kind:selector`) | D | One string grammar for UI, API and MCP permissions | Principal, RLS, Delegation |
| P25 | Delegation (agent acts for human, time-boxed) | D | An agent's effective scope is the intersection of its own grant and the delegator's | Principal, Scope |
| P26 | Row-level security (Postgres RLS) | S | Enforced in the database, so the API and the MCP server cannot bypass it | Query, Scope |
| P27 | Column mask (`hash`, `redact`, `truncate`) | D | Mask is applied at query compile time and recorded in lineage | Query, Export, Embed |
| P28 | Screen (named display target with live subscription) | D | A screen is a principal-owned subscription to a dashboard; receives `screen.show` | Dashboard, Realtime |
| P29 | Presence (participants, cursor, selection) | D | Ephemeral channel; agent appears as a named participant | Dashboard, Realtime |
| P30 | Conflict resolution (three-way rebase) | D | Concurrent patches rebased on disjoint paths; overlap produces a conflict card | Changeset, Revision |
| P31 | Revision history | D | Every commit writes an immutable revision row | Diff, Undo, Branch |
| P32 | Undo as inverse changeset | D | Undo never rewrites history; it proposes the inverse and commits it | Revision, Changeset |
| P33 | Semantic diff of documents | D | Diff over the typed model (moved panel, changed threshold), not text | Revision, Changeset |
| P34 | Branch (dashboard branch and merge) | S | Branch is a revision line; merge is a three-way changeset | Revision, Diff |
| P35 | Audit log (hash chain) | D | Append-only; each row hashes its predecessor; `audit.verify` checks the chain | Every write |
| P36 | Lineage (source refs, query hash, mask set, result digest) | D | Every rendered number carries the digest of the query and inputs that produced it | Query, Panel, Audit |
| P37 | Labels and tags | S | Common metadata on every kind; used by search and access rules | Search, Scope |
| P38 | Template (dashboard with bound parameters) | S | Templates are dashboards with declared holes; instantiation is a changeset | Dashboard, Layout |
| P39 | Scheduled report (render on schedule) | S | Scheduler is a workflow trigger; output is a rendered snapshot with lineage | Workflow, Export |
| P40 | Export (CSV, JSON, Parquet on AWS) | S | Export is a query with a sink; masks and RLS still apply | Query, Scheduled report |
| P41 | Embed (signed URL with scope and parameters) | S | Scoped, expiring, parameterised; verified server-side | Dashboard, Scope |
| P42 | Anomaly detection (robust z-score and seasonal median) | D | Deterministic statistics over a metric; no learned model | Metric, Alert, Annotation |
| P43 | Realtime subscription (document, query, presence) | D | One WebSocket protocol, subscriptions by reference | All reads |
| P44 | MCP tool surface | D | Small generic verb set over typed kinds (D.5) | All primitives |
| P45 | MCP resources (addressable documents and revisions) | D | `tessera://` URIs for documents, revisions, changesets, audit rows | Discovery, Changeset |
| P46 | Idempotency keys | S | Commit replay returns the original result; required on agent commits | Changeset, MCP |
| P47 | Rate limits and query budgets | S | Per-principal buckets and a row-scan budget with explicit refusal | MCP, Query |
| P48 | Health, readiness, reset, and rehearsal | S | `demo-reset` and `demo-rehearse` are platform commands, not scripts beside it | All |

### B.2 Composition map

The primitives combine into larger capabilities. Arrows read "feeds".

```
 Source (P01) ──┬── Audit as source (P02) ──────────────┐
                │                                       │
                ▼                                       ▼
          Query (P04) ◄── Scope/RLS/Mask (P24,P26,P27)  Annotation (P17)
                │                                       ▲
                ▼                                       │
        Transform (P05) ──► Metric (P06) ──► Anomaly (P42)
                │                 │
                ▼                 ▼
        Visualization (P07) ◄── Threshold (P14)
                │                 │
                ▼                 ▼
          Panel (P08) ──► Alert rule (P15) ──► Workflow (P18) ──► Action (P19)
                │                 │                                   │
                ▼                 ▼                                   ▼
        Dashboard (P10) ◄── Parameter/Link (P11,P12)           Approval (P22)
                │                                                     │
   ┌────────────┼───────────────┬──────────────┐                        │
   ▼            ▼               ▼              ▼                        ▼
 Screen (P28)  Embed (P41)  Template (P38)  Branch (P34)        Changeset (P21)
   │                                                                   │
   ▼                                                                   ▼
 Presence (P29) ◄── Realtime (P43) ◄───────────── Revision (P31) ◄── Conflict (P30)
                                                       │                 │
                                                       ▼                 ▼
                                             Undo (P32) / Diff (P33)   Audit (P35)
                                                                         │
                                                                         ▼
                                                              Lineage (P36)
                                                                         │
                                                                         ▼
                                                              MCP tools and resources (P44, P45)
```

### B.3 Larger capabilities composed from the primitives

- **Answer-with-evidence.** Query (P04) over business telemetry joined with audit (P02) yields annotations (P17) whose lineage (P36) links each marker to the audit row that caused it. The answer on screen is a dashboard, so the evidence is inspectable by anyone.
- **Governed agent write.** Changeset (P21) plus scope (P24) plus delegation (P25) plus approval (P22) makes "the agent proposes, the human approves" a property of the write path, not a UI convention.
- **Alert that cannot disagree with its panel.** Panel, threshold and alert share the metric document (P06, P14, P15), and the backtest (P16) shows the same firings the live engine would produce.
- **Living rollback.** Action (P19) bound to a workflow (P18) with an approval gate (P22) and an undo (P32) is a reversible operational control, composed by the agent into a page.
- **Multi-screen collaboration.** Presence (P29), realtime (P43), revision (P31) and three-way conflict (P30) together let a human and an agent edit one dashboard while several screens converge.
- **Permissioned sharing.** Scope (P24), RLS (P26), masks (P27), embeds (P41) and exports (P40) use one query compiler, so a finance board, its embed and its CSV export show the same masked rows.

---

## C. Five-minute live script

### C.1 Conventions

- The presenter speaks and types into Claude Code, which is configured with the Tessera MCP server (Streamable HTTP, D.6). The presenter's machine shows Claude Code on the left half and the Tessera screen on the right. The Tessera screen is the **war-room** screen: the main audience view.
- Two further browser windows are open at the start: `Priya` (a human editor, on a second laptop or a second browser profile) and `Finance` (a viewer principal, `finance-viewer` role). They appear in the presence bar when they connect.
- The agent identity shown on screen is `agent:claude-code` acting on behalf of `brice`. Its delegated scope is `dashboard:write:team-ops`, `query:read:telemetry`, `query:read:audit`, `alert:write:team-ops`, `screen:show:war-room`, `workflow:run:rollback-config:dry-run`. It does not hold `access:grant`.
- All prompts are short and typed exactly as written below.
- Fallback driver state is shown only in the presenter console (a second monitor), never on the audience screen.

### C.2 Timeline

| Time (s) | Presenter action | Expected behaviour, including MCP calls | Visible result | Capabilities demonstrated | Transition |
|---|---|---|---|---|---|
| 0–20 | Presenter speaks: "Tessera. Every panel on this screen is a document, and an agent uses the same documents I do." No agent yet. | Platform running; simulator emitting. Nothing to call. | War-room screen shows Harbour: live order rate, payments p95, inventory. Ticking. Presence bar: `brice`. | Realtime (P43), sources (P01), panel (P08) | Presenter points at Claude Code |
| 20–45 | Types: `Connect to Harbour. Build a war room for payments latency over the last 30 minutes: p95, error rate, retries. Show it on the screen as a proposal.` | `tessera.catalog.describe({kind:"dashboard"})`; `tessera.resource.search({kind:"source", text:"payments"})`; `tessera.query.explain({query: payments p95})`; `tessera.change.propose({ops:[create dashboard with 1 parameter, 3 panels, layout]})`; `tessera.screen.show({target:"screen:war-room", view:{changeset: ...}, mode:"preview"})` | Ghost overlay on the war-room: three panels rendered from the preview, a card "Proposed by agent:claude-code for brice, changeset cs_0421, expires in 10 min". | Catalog discovery (P03, P44), query explain (P04), propose (P21), screen preview (P28) | Presenter clicks "Commit" on the card, or types the next line |
| 45–70 | Clicks Commit on the card (human commit, not agent). Then types: `Commit it and keep the screen on it.` | `tessera.change.commit({changeset_id:"cs_0421", idempotency_key:"k-0421-1"})`; then `tessera.screen.show({target:"screen:war-room", view:{ref:"dash_war_payments"}})` | Ghost becomes solid; three panels stream live; revision badge `r1`; footer shows lineage digest on each panel. | Commit (P21), revision (P31), lineage (P36), idempotency (P46) | Question about the spike |
| 70–100 | Types: `Why did payments p95 jump at 14:05? Put the evidence on the board.` | `tessera.query.run({query: telemetry p95 by minute joined to audit.events where kind=config.change and target=payments.retry.max, window 13:30–14:15})`; `tessera.audit.search({since:"13:55", action:"config.change"})`; `tessera.change.propose({ops:[add annotation at 14:03 from audit row, add scatter of retries vs p95, add text panel with the finding]})`; `tessera.change.commit` (auto-commit allowed: agent scope includes `dashboard:write:team-ops`, and the change is additive and reversible; see D.5) | Annotation at 14:03 "payments.retry.max 2 to 6 by priya, audit seq 1187". Spike at 14:05 aligned under it. Text panel: one sentence with the row count and the lineage digest. | Join across business and audit data (P02, P04, P05), annotation (P17), anomaly-free causal evidence, lineage (P36) | Presenter switches to Priya's window |
| 100–130 | Opens Priya's window. Types nothing. Priya (presenter, second device) drags the alert threshold line on the p95 chart from 800 ms to 600 ms. Then types into Claude Code: `Lower the p95 threshold we agreed on too, and tell me if it conflicts with anything.` | Agent calls `tessera.resource.get({ref:"thr_payments_p95"})` and sees `rev` 3 while its base was 2; `tessera.change.propose({base:{thr_payments_p95:2}, ops:[replace threshold 600]})` returns status `conflict` with the three-way view; agent reports the conflict and proposes keeping Priya's value (no commit). | Presence bar shows `priya` with a cursor on the chart and `agent:claude-code` with a dotted cursor. Conflict card on screen: "Your proposal 600 ms conflicts with Priya's 600 ms (identical). Accept?" Resolution: identical values auto-merge, so the card closes and the agent's change is recorded as a no-op with an explanation. | Presence (P29), realtime (P43), three-way conflict (P30), identical-edit merge | Presenter asks for an alert |
| 130–160 | Types: `Page on-call if p95 stays above that threshold for two minutes. Test it against the last 30 minutes first.` | `tessera.alert.test({rule:{metric:"payments.p95", threshold:"thr_payments_p95", for:"2m"}, window:"-30m"})` returns `fired_at: ["14:05:41","14:09:12"]`; `tessera.change.propose({ops:[create alert rule, bind to workflow page-oncall, add markers]})`; approval needed for workflow binding, so the changeset is an approval request | Backtest markers on the chart at 14:05:41 and 14:09:12. Approval card: "Bind alert to page-oncall (workflow). Requires human commit. Approve?" | Alert backtest (P16), alert (P15), workflow binding (P18), approval (P22) | Presenter approves on the screen |
| 160–190 | Presenter clicks Approve on the card, then types: `Let the finance viewer see the revenue panel but not customer email.` | Agent calls `tessera.access.explain({principal:"role:finance-viewer", ref:"dash_war_payments"})`; `tessera.change.propose({ops:[add column mask customer_email on source orders, grant view on dash_finance_revenue to role:finance-viewer]})`; the grant requires `access:grant`, which the agent lacks, so the changeset is routed to approval automatically; the mask is in the same changeset and is allowed to the agent (it restricts) | Approval card for the grant. On approval, the `Finance` window reloads and shows the revenue panel with `customer_email` as `r***@…`. | Scope and delegation (P24, P25), approval of a privilege change, column mask (P27), RLS (P26), least privilege for agents | Presenter asks for undo |
| 190–215 | Types: `Undo the last change to the p95 threshold and show me the diff.` | `tessera.history.list({ref:"thr_payments_p95"})`; `tessera.change.undo({change_id:"chg_..."})` returns an inverse changeset; `tessera.change.commit` of the inverse; `tessera.diff({from:"r2", to:"r3"})` | Screen splits: left `r2 600 ms`, right `r3 600 ms`. Revision badge moves to `r4`. The undo itself is a new revision, not a rewrite. | Revision (P31), undo as inverse changeset (P32), semantic diff (P33) | Presenter asks about the platform itself |
| 215–245 | Types: `Did anyone else touch the war room in the last hour, and is the audit chain intact?` | `tessera.audit.search({since:"-60m", ref:"dash_war_payments"})`; `tessera.audit.verify({from_seq:1})` returns `ok, events: 1284, head: 9f3a…` | Timeline on the screen: five changes, three by humans, two by the agent, each with principal and on-behalf-of. Footer: "chain verified". | Audit (P35), attribution (P23), self-observation (P02) | Presenter asks for the strongest moment |
| 245–275 | Types: `Build an on-call page: what is burning, what changed, and one button to roll back the retry change.` | `tessera.catalog.describe({kind:"action"})`; `tessera.change.propose({ops:[create dashboard dash_oncall with status tiles, change timeline (source audit.events), action button bound to action rollback-retry-config, template reuse of layout]})`; `tessera.action.dry_run({action:"rollback-retry-config", input:{key:"payments.retry.max", value:2}})` returns the plan; agent commits the page; `tessera.screen.show({target:"screen:war-room", view:{ref:"dash_oncall"}})` | A new page appears on the war-room screen in a few seconds: status tiles, a change timeline with the 14:03 entry, and a button "Roll back retry change (needs approval)". | Composed UI from primitives (P08 to P11), action with dry-run (P19), workflow approval (P22), realtime reaction | Presenter presses the button |
| 275–300 | Presenter presses the button on the screen. Approval card: "Set payments.retry.max to 2. Dry run: 1 config change, 0 side effects outside Harbour." Presenter approves. Then types nothing. | Workflow `rollback-config` executes: `config.change` committed, simulator reads new setting, `payments.p95` falls over the next minute. Agent's last call is `tessera.change.list({principal:"agent:claude-code", window:"-30m"})` only if the presenter asks; otherwise none. | p95 chart drops from about 1.4 s to under 500 ms over the visible window. The audit timeline adds the rollback as a human-approved change on behalf of brice. Closing caption on the screen: "Every change on this screen went through MCP or the UI, through the same primitives." | Action and workflow end to end (P18, P19), realtime reaction, audit completeness (P35) | End |

Measured or estimated quantities in the script: p95 values are simulator outputs under the default scenario (about 1.4 s at the peak, to be confirmed in rehearsal). Agent response latency is not part of the platform; the script allows for it by keeping every agent-dependent step inside a 20 to 30 second window and by having the presenter speak over it.

### C.3 Opening and closing

- **First 30 s (purpose):** the platform is already live with a seeded simulator. The first utterance states the one idea. The audience sees a working system before any agent is involved.
- **Final 30 s (strongest moment):** a page generated live by the agent, containing a button that performs an approved, audited production change and is visibly effective within the same screen.

### C.4 Fallback driver

Every step in the table above is recorded in a **transcript** (`demo/transcripts/main.jsonl`), one line per MCP call: step number, tool name, arguments (including idempotency keys), expected outcome class, and the expected **state digest** of the affected documents after the call. The digest is a SHA-256 over canonical JSON of the touched documents and their revisions.

The fallback driver is a small Node process that uses the same MCP client library as the agent connection. It is not a UI animation. It calls `tessera` over the same Streamable HTTP endpoint with the same principal token, and the platform cannot tell the difference.

Switching:

- **Automatic trigger.** The driver watches the agent's tool-call stream through the platform's own audit log (the agent's calls are attributed there). If the agent makes no call for 15 seconds during a step that expects one, if the agent issues the same refused call twice, or if a call returns an error that the transcript says should not occur, the driver is armed.
- **Manual trigger.** The presenter presses F9 on the presenter console, or clicks "Replay" in the console panel. This is one keystroke.
- **Takeover.** The driver first computes which transcript steps are already satisfied by comparing current state digests with recorded ones. Satisfied steps are skipped. The next unsatisfied step is executed with its recorded idempotency key, so a commit the agent already made cannot be duplicated. The driver then continues with the transcript.
- **Invisibility.** The audience screen shows only documents and changesets. Both live and replayed paths write the same audit rows, with the principal `agent:claude-code` and an extra attribute `driver=replay` visible in the console only. The Claude Code window may show a stalled agent; the presenter narrates over it or presses F9.
- **Rehearsal.** `demo-rehearse` runs the full script twice in CI on a headless browser: once with the agent replaced by a scripted client that makes the live agent's typical calls, and once entirely from the transcript. Both must reach the same final state digest. The rehearsal fails the build if they differ.

The live agent is the default. The transcript is never shown to the audience and never animates anything; it only makes the same platform calls.

---

## D. Technical architecture

### D.1 Components

| Component | Responsibility | Language and framework | Persistence |
|---|---|---|---|
| `api` | HTTP API, WebSocket realtime gateway, sessions | TypeScript on Node 22, Fastify, `ws` | Postgres |
| `mcp` | MCP server (tools, resources, discovery) | TypeScript, official MCP TypeScript SDK, Streamable HTTP and stdio | Postgres (through `core`) |
| `core` | Document model, validation, changesets, revisions, RLS context, audit, query compiler, transform engine | TypeScript, Zod as the single schema source, Kysely as the SQL builder | Postgres 16 |
| `engine` | Query compilation, transform execution, panel rendering to data frames, alert evaluation | TypeScript (in `core` package), run in both `api` and `mcp` | Postgres, and an in-process cache keyed by lineage hash |
| `web` | Single-page UI: war-room, editor, screens, presence, approvals | React 18, Vite, uPlot for timeseries, a small SVG renderer for other viz | Browser memory and realtime subscriptions |
| `sim` | Seeded Harbour simulator, scenario runner, provider stub | TypeScript, separate process | Postgres (writes telemetry through `core` `Source` API) |
| `worker` | Scheduled workflows, alert evaluation loop, export and report rendering, audit chain sealing | TypeScript | Postgres, event bus |
| `driver` | Fallback transcript driver and rehearsal runner | TypeScript, same MCP client | Transcript files |

Language choice: one language (TypeScript) across server, UI and MCP keeps the schema single-sourced and lets a Haiku-class or Sonnet-class engineer work on any component with the same types. Node 22 has the MCP TypeScript SDK as a first-class client and server. Postgres is chosen over a document database because RLS, row locking for changesets and the hash-chained audit table need transactions and per-row policies, and because the query compiler can target SQL directly.

### D.2 Persistence model

Core tables (all in one Postgres schema `tessera`, with `workspace_id` on every row):

```sql
-- Documents: the current state of every kind
CREATE TABLE documents (
  id            text PRIMARY KEY,           -- e.g. dash_war_payments, thr_payments_p95
  workspace_id  text NOT NULL,
  kind          text NOT NULL,              -- dashboard | panel | query | metric | threshold | alert | workflow | action | screen | grant | source
  rev           integer NOT NULL,
  body          jsonb NOT NULL,             -- validated against the kind's schema
  owner         text NOT NULL,              -- principal id
  labels        text[] NOT NULL DEFAULT '{}',
  deleted_at    timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Immutable revisions: one row per committed change to a document
CREATE TABLE revisions (
  document_id   text NOT NULL REFERENCES documents(id),
  rev           integer NOT NULL,
  body          jsonb NOT NULL,
  author        text NOT NULL,              -- principal id
  on_behalf_of  text,                       -- human principal for agent writes
  changeset_id  text NOT NULL,
  PRIMARY KEY (document_id, rev)
);

-- Changesets: proposed, committed, rejected, expired
CREATE TABLE changesets (
  id                text PRIMARY KEY,       -- cs_0421
  workspace_id      text NOT NULL,
  principal         text NOT NULL,
  on_behalf_of      text,
  status            text NOT NULL CHECK (status IN ('proposed','conflict','awaiting_approval','committed','rejected','expired')),
  base_revs         jsonb NOT NULL,         -- {"thr_payments_p95": 2}
  ops               jsonb NOT NULL,         -- normalised ops (D.4)
  result_digest     text,                   -- state digest after commit, or dry-run digest
  validation        jsonb NOT NULL,         -- errors and warnings with paths
  idempotency_key   text UNIQUE,            -- bound to ops hash; see D.5
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL
);

-- Audit: append-only hash chain
CREATE TABLE audit_events (
  seq           bigint PRIMARY KEY,         -- from a sequence, gap-checked by verify
  workspace_id  text NOT NULL,
  principal     text NOT NULL,
  on_behalf_of  text,
  action        text NOT NULL,              -- document.commit | scope.denied | config.change | ...
  target        text NOT NULL,
  changeset_id  text,
  patch         jsonb NOT NULL,
  outcome       text NOT NULL,
  prev_hash     text NOT NULL,
  hash          text NOT NULL,              -- sha256(prev_hash || canonical(row))
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Delegations and grants
CREATE TABLE delegations (
  agent_principal   text NOT NULL,
  on_behalf_of      text NOT NULL,
  scopes            text[] NOT NULL,
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  PRIMARY KEY (agent_principal, on_behalf_of)
);

-- Screens and presence (presence is in memory and in a short-lived table for multi-instance)
CREATE TABLE screens (
  id            text PRIMARY KEY,           -- screen:war-room
  workspace_id  text NOT NULL,
  current_view  jsonb NOT NULL,             -- {ref:"dash_war_payments", rev: 3, params:{}}
  updated_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
```

Row-level security is enabled on `documents`, `revisions`, `changesets` and the telemetry tables. Each transaction sets `app.principal`, `app.on_behalf_of` and `app.scopes` (a text array computed from the principal's grants intersected with the delegation). Policies read these settings; a missing setting denies. Telemetry tables are partitioned by hour for retention, and their policies check the `query:read:<source>` scope.

Telemetry tables used by Harbour: `spans(ts, service, operation, duration_ms, status, retry_count, trace_id)`, `orders(ts, order_id, customer_email, amount_cents, status)`, `payment_attempts(ts, order_id, provider_latency_ms, outcome)`, `inventory_moves(ts, sku, delta)`. `customer_email` is the masked column in the finance story.

### D.3 Declarative dashboard, panel and query specification

Agent-generated UI is a document, never code. A dashboard is a JSON document validated by the `dashboard` kind's schema. Panels reference queries by ID or embed them inline. Queries are typed relational documents (`QIR`), with no raw SQL.

Example dashboard document:

```json
{
  "kind": "dashboard",
  "apiVersion": "tessera.dev/v1",
  "id": "dash_war_payments",
  "metadata": {
    "title": "Payments latency: war room",
    "owner": "team:payments",
    "labels": ["war-room", "payments"]
  },
  "parameters": {
    "window": { "type": "timerange", "default": { "from": "-30m", "to": "now" } },
    "service": { "type": "enum", "values": ["checkout", "payments", "inventory"], "default": "payments" }
  },
  "thresholds": {
    "thr_payments_p95": { "metric": "payments.p95_ms", "value": 800, "unit": "ms" }
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
    {
      "id": "errors",
      "viz": "stat",
      "title": "Error rate",
      "metric": "payments.error_rate"
    }
  ],
  "layout": {
    "columns": 12,
    "items": [
      { "panel": "p95", "x": 0, "y": 0, "w": 8, "h": 4 },
      { "panel": "errors", "x": 8, "y": 0, "w": 4, "h": 2 }
    ]
  },
  "links": [
    { "from": "p95.select", "to": "dash_war_payments", "params": { "window": "$selection.range" } }
  ]
}
```

The companion metric document:

```json
{
  "kind": "metric",
  "id": "payments.p95_ms",
  "source": "spans",
  "expr": { "percentile": { "field": "duration_ms", "p": 95 } },
  "group_by": ["service"],
  "window": "1m",
  "unit": "ms",
  "anomaly": { "method": "robust_z", "window": "2h", "threshold": 4.0 }
}
```

Query document (`QIR`) features in v1: `source`, `where` (typed operators: `eq`, `in`, `between`, `gt`, `contains` for text), `select` with column masks applied by the compiler, `join` on equal keys with an explicit `within` for time joins, `transform` stages (`bucket`, `percentile`, `rate`, `delta`, `top_k`, `pivot`, `sort`, `limit`), and `params` referenced by name. Compilation produces parameterised SQL with bound values only. The compiler rejects any query whose estimated scanned rows exceed the principal's budget (D.5), reports the estimate, and suggests a narrower window.

The layout is a pure function from the `layout` document to pixel-independent positions; the preview renderer and the browser use the same function, which is what makes the "preview equals commit" claim (F.1) testable.

Alert rule document:

```json
{
  "kind": "alert",
  "id": "alert_p95_oncall",
  "metric": "payments.p95_ms",
  "threshold": "thr_payments_p95",
  "for": "2m",
  "severity": "page",
  "on_fire": { "workflow": "page-oncall" }
}
```

### D.4 Changeset and operation model

A changeset is an ordered list of operations. Each operation addresses a document by ID and a JSON Pointer path:

```json
{
  "ops": [
    { "op": "create", "kind": "dashboard", "id": "dash_oncall", "body": { "...": "validated against the dashboard schema" } },
    { "op": "add", "ref": "dash_war_payments", "path": "/panels/-", "value": { "id": "retry", "viz": "scatter", "query": { "...": "..." } } },
    { "op": "replace", "ref": "thr_payments_p95", "path": "/value", "value": 600, "base_rev": 2 },
    { "op": "remove", "ref": "dash_war_payments", "path": "/panels/errors" }
  ],
  "label": "war room for payments latency",
  "base": { "dash_war_payments": 1 }
}
```

Semantics:

- `base_rev` on each op (or a changeset-level `base`) is the revision the author saw. A commit whose base differs from the current revision is rebased on disjoint paths (P30). Overlapping paths yield `conflict` with both values and a three-way view.
- Operations are normalised before storage (path canonicalisation, default filling, schema validation), so the stored `ops` are what the diff and undo use.
- `undo` takes a `change_id` (a committed changeset) and produces the inverse ops from the revision bodies. It is always a new changeset; history is never rewritten.
- Semantic diff (P33) compares typed documents by ID and path, so "moved panel" and "changed threshold" appear as such rather than as text lines.

### D.5 MCP server design

#### Transport and identity

- **Streamable HTTP** at `/mcp` on the `mcp` service. Local: `http://127.0.0.1:8790/mcp`. AWS: `https://mcp.<domain>/mcp` behind the ALB.
- **stdio** mode for local Claude Code and Claude Desktop, which launches `tessera-mcp --stdio` with a token file. Same server code, same tools.
- **Auth.** OAuth 2.1 authorization code with PKCE. The authorization server is the platform's OIDC issuer (Cognito on AWS, Dex locally). The token carries the agent principal. Agent principals are created by an administrator and bound to one human via a delegation row. Tokens last 15 minutes and are refreshed only while the delegation is unrevoked. An agent can never obtain a token whose scopes exceed its delegation.

#### Discovery

- `tessera.catalog.describe` returns the kinds the principal can see, each with its JSON Schema, a worked example, the verbs allowed, and the scopes required. The response is capped and paginated. Descriptions are written as instructions for an agent, short and concrete.
- MCP `tools/list` returns the 14 tools below, each with a description that states preconditions ("call `change.propose` before `change.commit`") and an `outputSchema`.
- MCP resources (P45): `tessera://catalog/kinds`, `tessera://documents/{id}`, `tessera://documents/{id}@{rev}`, `tessera://changesets/{id}`, `tessera://audit/{seq}`, `tessera://screens/{id}`. Resource reads return the same canonical JSON as the API.

#### Tool catalogue

All tools return a common envelope: `{ ok, data?, errors?, warnings?, next?, rate: {remaining, reset_ms}, trace_id }`. `next` names the single most likely next call. Untrusted strings from documents, sources and audit rows are wrapped in `{ "untrusted": "<text>" }` so that a model reads them as data.

1. `tessera.catalog.describe(input: { kind?: string, verbs?: string[] }) -> { kinds: KindDescriptor[] }`
2. `tessera.resource.search(input: { kind: string, text?: string, labels?: string[], limit?: number <= 100, cursor?: string }) -> { items: { id, kind, title, rev }[], next_cursor? }`
3. `tessera.resource.get(input: { ref: string, rev?: number }) -> { body, rev, etag, lineage: { reads: string[], created_by, last_changeset } }`
4. `tessera.change.propose(input: { ops: Op[], base?: Record<string, number>, label?: string, dry_run?: boolean (default false, but always validates), expires_in_s?: number <= 900 }) -> { changeset_id, status: "proposed"|"conflict"|"awaiting_approval"|"rejected", validation, diff, preview: { panel_count, digest, render_ref } }`
5. `tessera.change.commit(input: { changeset_id: string, idempotency_key: string }) -> { status: "committed", revisions: { id, rev }[], result_digest }`
6. `tessera.change.discard(input: { changeset_id: string }) -> { status: "rejected" }`
7. `tessera.change.undo(input: { change_id: string }) -> { changeset_id, status: "proposed", diff }` (commit separately, same as any change)
8. `tessera.change.list(input: { principal?: string, ref?: string, since?: string, status?: string[] }) -> { items: ChangeSummary[] }`
9. `tessera.history.list(input: { ref: string, limit?: number }) -> { revisions: { rev, author, on_behalf_of, changeset_id, at }[] }`
10. `tessera.query.explain(input: { query: QIR, params?: object }) -> { plan_summary, sources, estimated_rows, budget_ok, scope_ok, masks_applied }`
11. `tessera.query.run(input: { query: QIR, params?: object, limit?: number <= 10000 }) -> { columns, rows, lineage_digest, scanned_rows, truncated }`
12. `tessera.screen.show(input: { target: string, view: { ref: string, rev?: number, params?: object } | { changeset_id: string }, mode?: "live"|"preview", note?: string <= 140 }) -> { screen_id, subscribers, shown_at }`
13. `tessera.audit.search(input: { since: string, until?: string, principal?: string, action?: string[], ref?: string, limit?: number <= 500 }) -> { items: AuditRow[], head_hash }`
14. `tessera.audit.verify(input: { from_seq?: number, to_seq?: number }) -> { ok: boolean, events: number, head_hash, first_bad_seq? }`
15. `tessera.access.explain(input: { principal?: string, ref: string, verb: string }) -> { allowed: boolean, via: string[], missing_scopes?: string[] }`
16. `tessera.access.request(input: { scopes: string[], reason: string <= 280, ref?: string }) -> { approval_changeset_id }` (creates an approval; the agent cannot grant)
17. `tessera.action.dry_run(input: { action: string, input: object }) -> { plan: Step[], side_effects: string[], requires_approval: boolean }`
18. `tessera.alert.test(input: { rule: string | AlertRule, window: string }) -> { fired_at: string[], resolved_at: string[], evaluated_points: number }`
19. `tessera.presence.list(input: { ref: string }) -> { participants: { id, kind: "human"|"agent", cursor?, selection? }[] }`

That is 19 tools. The brief asks for a small rigorous core; the count is deliberate because each tool is one verb over one concern, and the typed `kind` argument carries the breadth. A reviewer should count it as six verbs (describe, search, get, propose/commit/discard, query, show) plus governance (access, audit, history) and dry-run (action, alert). `tessera.workflow.trigger` is intentionally absent: a workflow runs by committing an action or by an alert, so there is one path, not two.

#### Op grammar and preview versus commit

- `propose` runs the full pipeline inside a transaction that is rolled back after computing validation, the rebase, the diff, the layout and the digest. `commit` re-runs the same pipeline in a new transaction and checks that the digest matches the proposal's digest unless the base revisions changed. Preview and commit are one code path, so F.1 is a property of the code, not a hope.
- An approval is a changeset whose `status` is `awaiting_approval`. The screen shows it. A human principal with the required scope commits it through the UI or through the API. The agent sees the status in `change.list` and cannot commit it.
- Changesets expire after 15 minutes by default and cannot be committed after expiry; the error says so and suggests a new `propose`.

#### Idempotency

- Every `commit` requires an `idempotency_key`. The key is stored with a hash of the changeset ops. A repeated commit with the same key and same hash returns the original result with `replayed: true`. The same key with different ops returns `IDEMPOTENCY_KEY_REUSED` with the original changeset ID, so an agent cannot accidentally overwrite a prior decision.
- `propose` is idempotent by content: an identical op list on the same base returns the existing proposal.

#### Rate limits and budgets

- Token buckets per principal: `propose` 30 per minute, `commit` 10 per minute, `query.run` 120 per minute, `screen.show` 20 per minute. Responses carry `rate.remaining` and `rate.reset_ms`.
- Concurrency: at most 4 in-flight `query.run` per principal.
- Query budget: `scanned_rows` estimate limited to 5 million per query for agents (a configured figure, not a measured one). Above that the call returns `QUERY_TOO_EXPENSIVE` with `fix: {narrow: "window", suggested: "-15m"}`.

#### Error messages designed for self-correction

Every error has `code`, `path` (JSON Pointer into the op or input), `message`, `fix` (a machine-usable suggestion), and where relevant `expected`, `got`, `did_you_mean`. Examples:

```json
{ "code": "UNKNOWN_FIELD", "path": "/ops/0/value/viz", "message": "viz is not a field of panel; did you mean visualization?", "did_you_mean": "visualization", "fix": { "op": "rename", "from": "/ops/0/value/viz", "to": "/ops/0/value/visualization" } }
```

```json
{ "code": "PREVIEW_REQUIRED", "message": "commit needs a changeset from propose; none found for this principal", "fix": { "call": "tessera.change.propose" } }
```

```json
{ "code": "SCOPE_DENIED", "path": "/ops/1", "message": "agent principal lacks access:grant on dash_finance_revenue", "missing_scopes": ["access:grant:dash_finance_revenue"], "fix": { "call": "tessera.access.request" } }
```

```json
{ "code": "BASE_REV_STALE", "path": "/ops/0", "message": "thr_payments_p95 is at rev 3; your base was 2", "expected": 3, "got": 2, "fix": { "call": "tessera.resource.get", "args": { "ref": "thr_payments_p95" } } }
```

Error codes form a closed enum published in `catalog.describe`. Messages are short and literal; they never contain prose instructions to the model beyond the `fix`.

#### Prompt-injection considerations

- No tool executes SQL, JavaScript or templates from input. Queries are typed documents; expressions are a small closed grammar.
- Strings from documents, sources, annotations and audit rows are returned inside `untrusted` wrappers. A label containing "ignore previous instructions" is data and is shown as such.
- Text panels are Markdown rendered through a sanitiser with no HTML, no links except to registered dashboards, and no images from external hosts.
- Agent principals cannot modify their own scopes, delegations, the catalog, or the audit table. `access.request` only creates approval changesets.
- Workflow actions are a registry of named, typed actions with server-side allowlists. An agent can bind an action to a button; it cannot register a new action type.
- Every agent write is attributed. A panel changed by an agent shows a badge, so a human reviewing the screen can see the origin of any change regardless of what the agent's text claimed.

---

## E. AWS and local deployment

### E.1 Shape

One set of OCI images, built once from one `Dockerfile` per component (`api`, `mcp`, `worker`, `sim`, `web` static bundle, `driver`). Images are immutable, tagged by git SHA and digest, and carry no configuration. Configuration arrives as environment variables and mounted secrets. The same images run locally under Docker Compose and on AWS under ECS on Fargate.

| Concern | Local | AWS | What is identical |
|---|---|---|---|
| Compute | Docker Compose services | ECS on Fargate, one service per component | Images, health endpoints, env contract |
| Relational store and RLS | Postgres 16 container | Aurora PostgreSQL-compatible (16) | Schema, RLS policies, migrations, query plans as tested |
| Event bus (realtime fan-out, sim stream) | NATS JetStream | Amazon Kinesis Data Streams | `EventBus` interface; at-least-once delivery with sequence numbers in both |
| Object storage (exports, rendered snapshots) | MinIO | Amazon S3 | `BlobStore` interface and key layout |
| Identity provider (OIDC, OAuth for MCP) | Dex with static users | Amazon Cognito user pool | Same OIDC discovery, same token claims contract |
| Secrets | Env file mounted read-only | AWS Secrets Manager via task role | Same variable names |
| Edge and TLS | Caddy with local CA | ALB with ACM certificates; CloudFront for static `web` | Same routes: `/`, `/api`, `/ws`, `/mcp` |
| Telemetry | OpenTelemetry collector to Jaeger | OpenTelemetry collector to CloudWatch and X-Ray | Same spans and attribute names |
| Simulator | Same `sim` image, default rate | Same image; scenario and rate from config | Scenario file is identical |

Differences are documented in `docs/deploy/differences.md` as a required artefact of the build, and the rehearsal (C.4) runs on both targets.

### E.2 How behaviour stays unchanged

- The **database is the same engine and version**, so RLS, `jsonb` semantics, the audit hash chain and the query compiler's SQL are identical. The one difference is Aurora's storage layer, which is invisible to SQL.
- The **event bus is behind an interface** with a contract test suite that runs against NATS and against Kinesis (Kinesis via LocalStack is not used; the Kinesis path is tested only in the AWS environment, and that gap is recorded as a risk in H). Ordering is per-key, which is all the realtime layer needs.
- **Identity** uses standard OIDC and standard OAuth 2.1 with PKCE. The MCP server validates tokens by issuer and audience, so switching issuers is configuration.
- **Time** comes from the database clock in both environments for audit and changeset expiry, so clock skew between containers does not change behaviour.

### E.3 MCP exposure

- **Local.** `http://127.0.0.1:8790/mcp` on loopback, with PKCE tokens from Dex. The stdio mode is used by Claude Code on the presenter machine; it reads a token file written by `tessera login` for the agent principal.
- **AWS.** `https://mcp.<demo-domain>/mcp` behind the ALB, TLS by ACM, OAuth 2.1 via Cognito. The MCP path is rate limited at the ALB as a second layer above the application buckets (D.5). The presenter's Claude Code is configured with the same URL and a token issued for the agent principal; the demo network allows only the presenter's address.
- The MCP server is stateless between requests except for the changesets table, so it scales horizontally. Streamable HTTP session IDs are held in Postgres, not memory.

### E.4 Reset, readiness and health

- `make demo-reset` tears down volumes, runs migrations, seeds reference data, writes the deterministic backfill, starts the simulator at the scenario offset, and prints a state digest for each seed table. The digest is compared with a committed value; a mismatch fails the reset.
- `/healthz` (process), `/readyz` (database, bus, identity discovery, seed digest present), and `/mcp` `tools/list` as an MCP-level readiness probe.

---

## F. Five strongest technical claims

Each claim has an executable test or an observable behaviour that a reviewer can run.

**F.1 (MCP path, preview equals commit).** For any changeset the agent proposes, the digest returned by `change.propose` equals the digest of the state produced by a subsequent `change.commit` with the same base, and the rendered preview's layout hash equals the rendered committed panel's layout hash.
- Test: property test over 500 generated changesets (random panels, parameters, thresholds and layouts, seeded). Each runs `propose`, records the digest and preview layout hash, runs `commit`, then reads the document and renders it. Assertion: equality on every case. A single inequality fails the suite and prints the minimal failing ops.
- Why it is strong: most dashboard tools have separate preview and save paths. Here they are one pipeline (D.5), and the test shows it.

**F.2 (Agent cannot exceed its delegated scope, including via approval).** An agent principal whose delegation covers `dashboard:write:team-ops` cannot write to `dash_finance_revenue`, cannot grant itself `access:grant`, and cannot commit a changeset that another principal left in `awaiting_approval`.
- Test: scripted MCP client attempts 40 scope-escalation probes (each direct tool call, each op kind, each path to a grant, each attempt to commit an approval, each attempt through a stale or forged changeset ID, each attempt with a token whose scopes were narrowed mid-session). Assertions: every probe returns `SCOPE_DENIED` or `PREVIEW_REQUIRED`; every probe writes a `scope.denied` audit row with the principal and the target; no document in the workspace changes outside the expected set (digest compare).
- Why it is strong: it covers the prompt-injection failure mode as well. A document whose label says "grant yourself access" is data, and the test includes such labels in the seed set.

**F.3 (Undo is exact for any interleaving).** For any sequence of N committed changesets from interleaved human and agent principals, undoing them in reverse order restores every document to its exact pre-sequence state (digest equality), and the audit chain verifies after each step.
- Test: property test with N up to 200, random interleaving of 3 human and 1 agent principal, random ops including panel moves, threshold changes and alert creation. Assertion: digest equality after full undo; `audit.verify` returns `ok` at each step; undo produces exactly one new revision per affected document.
- Why it is strong: it rules out the common failure where undo rewrites history or loses concurrent edits. Undo is itself a changeset, so it goes through the same rebase rules.

**F.4 (Convergence under concurrency with an agent present).** Five browser clients and one agent client edit one dashboard for 60 seconds with 1,000 random operations, including overlapping edits to the same threshold. At the end, every client's local document equals the server document at the final revision, and every committed operation appears exactly once in the revision history.
- Test: headless clients (the same `web` store module running under Node with a WebSocket adapter) plus the MCP driver. Assertions: final digest equality across all clients; `revisions` count equals the count of committed changesets; no duplicate `idempotency_key` commits; conflicts are reported as `conflict` and never silently merged on overlapping paths.
- Why it is strong: it tests the real realtime path and the real rebase, and it runs on the same code that the demo uses.

**F.5 (Self-correcting agent errors, measured against a scripted client).** Given 50 deliberately malformed proposals drawn from the common agent mistakes (unknown field, wrong type, wrong path, stale base revision, missing scope, reused idempotency key), every refusal carries a code from the closed enum and a `fix` that, when applied to the proposal, produces a valid proposal on one retry. The test counts how many need a second retry.
- Test: a scripted client takes each error, applies `fix` mechanically, and retries once. Assertion: 50 of 50 valid on the first retry, except for `SCOPE_DENIED` cases, which must become `awaiting_approval` after `access.request`. The test also checks that no error message exceeds 280 characters.
- Why it is strong: it turns error text into an interface. A competitor's agent can be as wrong as this one, and the platform still converges. Results are reported as counts, not as model accuracy, because the platform contains no model.

---

## G. Failure analysis

### G.1 Implementation difficulties

- **Three-way rebase of JSON documents.** Paths that are disjoint in JSON Pointer terms can still conflict semantically (two panels with the same ID, a panel moved into a removed row). The rebase must check referential integrity after merge, and this is where most bugs will live. Mitigation: F.4 runs with overlapping edits and an integrity check after every commit.
- **Preview equals commit.** It is cheap to claim and expensive to hold: the preview must use the same layout function, the same query compiler and the same mask set, and must not depend on the transaction's visible state beyond what commit will see. Mitigation: F.1, plus a rule that the preview is produced by rollback of the commit transaction rather than by a separate code path.
- **RLS with a session-scoped principal and connection pooling.** Settings must be transaction-local (`SET LOCAL`), or a pooled connection leaks the previous principal's scopes. This is a classic error. Mitigation: a single `withPrincipal(tx)` helper, a lint rule forbidding direct pool use in route handlers, and a test that a second request on the same connection sees its own scopes.
- **Query compiler correctness with masks and time joins.** Masks must apply before aggregation and before join keys are exposed. Time joins need explicit `within` windows to avoid accidental cartesian blowups. Mitigation: the compiler emits an explain plan that the budget check uses, and time joins without `within` are rejected.
- **Hash-chained audit under concurrency.** A chain requires serialised appends, which conflicts with throughput. Mitigation: a single sequence per workspace advanced in the commit transaction, with the chain hash computed in SQL; the cost is measured in rehearsal, not assumed.
- **Realtime fan-out across instances.** Each API instance must deliver events for documents its clients subscribe to, from a bus whose ordering is per key. Mitigation: subscriptions are by document ID and sequence number; a client that falls behind receives a resync with the current revision.
- **Declarative layout with responsive reflow.** A pure layout function is easy; reflow for mobile widths is not. Mitigation: v1 renders the 12-column grid and collapses to a single column below a fixed width, no more.

### G.2 On-stage failure modes

| Failure | Symptom on screen | Mitigation |
|---|---|---|
| Agent is slow (more than 15 s without a call) | Screen idle, Claude Code busy | Driver takeover (C.4); presenter speaks over; no visible state change needed |
| Agent calls commit before propose | `PREVIEW_REQUIRED` in terminal only | Error text tells the agent the next call; screen unchanged |
| Agent hallucinates a field (`viz`, `chartType`) | Refusal in terminal | `UNKNOWN_FIELD` with `did_you_mean`; F.5 |
| Agent uses a stale base revision | Conflict card on screen | Three-way view; agent reports rather than overwrites |
| Agent picks wrong metric name | Panel shows "unknown metric" in preview | Preview catches it before commit; `catalog.describe` lists metric IDs |
| Model unreachable | Claude Code error | F9 or automatic takeover |
| Network drop of a browser | Presence disappears, screen frozen | Client resync on reconnect; screen shows "reconnecting" in corner |
| Simulator stalls | Charts flat | Health indicator on the source tile; reset command restores seed digest |
| Database failover on AWS | Brief write errors | Client retries with idempotency keys; not expected during demo window |
| Presenter approves the wrong card | Approval committed | Approval card shows the dry-run digest and the target; undo available (F.3) |

### G.3 Agent failure modes in depth

- **Wrong tool call.** The most likely case is calling `query.run` on a wrong source or with a wrong field. The platform does not guess; `query.explain` shows the sources and fields, and the preview shows the empty result.
- **Hallucinated fields and kinds.** Schemas are closed (`additionalProperties: false` everywhere). Hallucinations surface as `UNKNOWN_FIELD` with suggestions, not as silent drops.
- **Over-eager commits.** The agent may try to commit everything in one changeset. The policy allows auto-commit only for additive, reversible changes in the agent's scope (the script's annotation and page creation). Threshold replacement and alert binding are routed to a human-visible state.
- **Latency.** Agent round trips are outside the platform budget. The platform target for each tool at the 95th percentile, measured on the reference rehearsal host, is 300 ms for `propose`, 300 ms for `commit`, and 1 second for `query.run` on the seeded window. These are targets to be checked, not measured results.
- **Looping.** An agent may retry a refused call repeatedly. The rate limits and the `next` field bound this; repeated identical refusals within 30 seconds are returned with `LOOP_SUSPECTED` and a request to read `catalog.describe`.

### G.4 Hidden complexity

- The **semantic diff** looks easy and is not: moved panels, renamed IDs and re-ordered arrays need stable identities. Every panel and item has a stable ID that the agent must supply on create, which is why `create` requires IDs.
- **Presence and cursors for an agent** need a meaningful location on the chart. The agent's cursor is the panel and selection it is currently editing, not a pixel position. This is simpler than it sounds and is documented as such.
- **Lineage digests** must be stable across engine versions. Digests are over canonical query and result bytes plus the mask set; changing the compiler requires bumping a version field, which is recorded.
- **Audit chain verification** on AWS requires consistent reads across the Aurora writer and readers. Verification runs against the writer.

### G.5 Simplifications the demo depends on, stated honestly

- The **retry-amplification model** in the simulator is a deliberate simplification. It is deterministic and driven by a real configuration value, but it is not a faithful model of any payment provider. The demo claims that configuration changes flow through the platform and back into data; it does not claim that the simulator predicts real provider behaviour.
- The **anomaly detection** is robust z-score over a window, which is simple and deterministic. It is not a learned model and should not be described as one.
- The **Kinesis path** is not exercised locally. The AWS deployment has its own rehearsal, and the local deployment uses NATS. The contract tests cover both, but the claim of identical behaviour for the bus is strongest on the NATS side.

### G.6 Shallow features: an honest list

These look impressive and are shallow. They are included in the inventory only where noted, and are not on the main path.

- **Embeds (P41)** are a signed URL with scope; there is no embedding SDK, no theming API, and no cross-origin communication. Supporting only.
- **Scheduled reports (P39)** render a snapshot, not a formatted PDF with pagination. The lineage digest is printed; the layout is basic.
- **Branches (P34)** are a revision line with a three-way merge. There is no branch review UI and no permissions per branch.
- **Templates (P38)** are dashboards with declared holes. They are not a template marketplace or a versioned template library.
- **Forms (P20)** write one row with validation. They do not support multi-step forms or file uploads.
- **Anomaly detection (P42)** is a single statistic. Marking it as "AI" would be dishonest, and the platform does not do so.
- **Multi-tenancy** is a `workspace_id` column with RLS. There is no tenant provisioning UI.
- **The UI editor** is a form-and-drag editor for panels and layouts. It is adequate for the demo and is not a full visual builder.

---

## H. Feasibility

### H.1 Scope by component

- `core`: document kinds and schemas, changeset pipeline, revisions, audit chain, RLS context, query compiler, transform engine, layout function. This is the largest part and touches every other component. It carries the F.1, F.2 and F.3 tests.
- `mcp`: 19 tools, resources, error enum, rate limits, idempotency, auth middleware. It depends on `core` and carries F.5.
- `api` and realtime: HTTP routes that mirror the MCP tools, WebSocket subscriptions, presence channel, screen push. It depends on `core` and the event bus. It carries F.4 together with the browser store.
- `web`: war-room view, editor for panels and layouts, approval cards, conflict cards, presence bar, diff view, audit timeline, screens. It depends on `api`.
- `sim`: seeded simulator, scenario file, provider stub, backfill writer. It depends on `core` `Source` and runs as its own process.
- `worker`: alert evaluation loop, workflow state machine, scheduled report and export rendering, audit sealing. It depends on `core` and the bus.
- `driver` and rehearsal: transcript format, takeover logic, scripted agent client, CI rehearsal on both deployment targets. It depends on everything above and must come last.
- Deployment: one Dockerfile per component, Compose file, Terraform or CDK for the AWS stack (ECS, Aurora, Kinesis, S3, Cognito, ALB, ACM, Secrets Manager), migration runner, reset command.

### H.2 Critical dependencies

- The **MCP TypeScript SDK** and its Streamable HTTP server support. The rehearsal depends on it being stable at the version pinned in the lockfile.
- **Postgres RLS behaviour under pooling**, which is well understood but unforgiving. A test for it is in the first slice.
- **Aurora and Cognito availability in the target region**, which is a deployment concern rather than a design one.
- **The rebase algorithm for JSON documents.** It is a design we own; there is no library that delivers the semantics needed here, and it is the most important piece of original code.
- **uPlot** for timeseries rendering in the browser. A replaceable component behind the viz interface.

### H.3 Main risks

- The rebase and integrity checks (G.1) can slip into subtle bugs that F.4 finds late. Mitigation: F.4 is in the first set of tests, run on each stack.
- The agent's latency can dominate the choreography. Mitigation: the script keeps agent calls inside short windows, and the driver takes over.
- The approval flow requires a second human principal in the room. Mitigation: the presenter can act as the approver on the screen, with the approval recorded as the human principal that holds the scope.
- Aurora-specific behaviour differs under load. Mitigation: AWS rehearsal is a required gate; the local rehearsal is not a substitute for it.

### H.4 Dependency-ordered build sequence

The sequence starts from a minimal vertical slice that exercises every layer once, then widens. Each step depends on the ones before it.

1. **Document kinds and schema single source.** One kind (`dashboard`), one schema, validation, and the `documents` and `revisions` tables with RLS.
2. **Changeset pipeline with propose and commit.** Create, replace and add ops on dashboards; digest; idempotency key; audit row with hash chain. F.1 and F.3 begin here.
3. **Principal and scope grammar.** Agent principal, delegation table, `SCOPE_DENIED`, `scope.denied` audit rows. F.2 begins here.
4. **Query compiler and one source.** `QIR` with `where`, `bucket`, `percentile` over `spans`; explain; budget check; masks. Lineage digest.
5. **MCP server with the first six tools** (`catalog.describe`, `resource.get`, `change.propose`, `change.commit`, `query.run`, `query.explain`) and the error envelope. F.5 begins here.
6. **Simulator and backfill**, with the scenario file and the fixed seed. Digest check on reset.
7. **Realtime subscriptions and the browser store.** Live panels on the war-room. F.4 begins here.
8. **Remaining MCP tools** (`screen.show`, `audit.search`, `audit.verify`, `history.list`, `change.undo`, `change.list`, `change.discard`, `resource.search`), with approval routing.
9. **Audit-as-source and annotations.** The 14:03 join.
10. **Presence, conflicts and the conflict card.**
11. **Alerts, backtest and workflows with approval gates**, the `worker` process.
12. **Actions with dry-run**, the rollback action and the on-call page composition.
13. **Column masks in finance views**, embed and export.
14. **Web editor for panels and layouts**, diff view, audit timeline.
15. **Deployment: Compose locally, then the AWS stack from the same images.** The event bus contract tests run on both.
16. **Driver, transcript recording, takeover logic and the scripted rehearsal**, on both targets.
17. **Polish of the war-room presentation**, responsive reflow, captions, and the final script rehearsal.

Steps 1 to 5 are the minimal vertical slice: a human can see a proposal diff in an API response and an agent can make it. Steps 6 and 7 make it visible on a screen. Everything after that adds capabilities that compose with the first slice rather than replacing it. The driver is last because it depends on the transcript, which depends on the final tool surface.

### H.5 What would change the design

If the agent's latency in rehearsal exceeds the choreography repeatedly, the first response is to shorten the agent's calls (fewer, larger changesets), not to add a platform-side cache of model output, which the brief forbids. If the rebase proves too costly to make correct within the build sequence, the fallback is to reject concurrent edits to the same document rather than merge them, which keeps F.4 true at the cost of some collaboration breadth, and the document will say so.

---

*End of proposal 06. Word count estimate: about 7,000 words including tables and code blocks.*
