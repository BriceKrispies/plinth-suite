# 3. Domain model and data relationships

Status: design specification for Plinth. Covers mission section 3. Design only: nothing in this document is built or run.

Precedence: `README.md` (canonical facts), then `../selection-rationale.md` (amendments P1–P20), then this document, then `../revised/04-emergent-composition.md`. Where this document resolves an ambiguity, it is listed in section 3.10.

Labels: every property is marked **Guarantee** (enforced by code and covered by a named test) or **Target** (a design goal that is measured before it is claimed).

---

## 3.1 Conventions

**Documents and nodes.** A *node* is the only persistent entity. A node is a document with the envelope in 3.2, a kind from the closed list in 3.3, a stable URI and an integer revision. Every write is a Change (3.9). **Guarantee.**

**Closed kind list.** `Dashboard, Panel, Query, Source, Parameter, Rule, Action, Form, Workflow, Grant, Metric, Template, Export, Annotation, Comment`. A document with any other `kind` is refused with `VALIDATION_FAILED`. **Guarantee.**

**Principals are not nodes.** A principal (`user:`, `agent:`, `service:`) is a row in the `principals` table (04 D.2). Documents refer to principals by principal reference (3.3.12). **Guarantee.**

**URI.** `plinth://<workspace>/<Kind>/<node_id>`, where `<Kind>` is the PascalCase kind and `<node_id>` is the UUID in `metadata.id`. **Guarantee.**

**Reference syntax in documents.** A reference is `<kind>:<slug>` (lowercase kind token, workspace-local slug) or a full URI. Kind tokens: `dashboard, panel, query, source, param, rule, action, form, workflow, grant, metric, template, export, annotation, comment`. `param` is the token for Parameter. The sole exception is `channel:<name>` (a notification receiver, see 3.10). A reference that resolves to nothing, or to a soft-deleted node, is `UNKNOWN_REFERENCE` with the existing slugs of that kind listed in `available`. **Guarantee.**

**Slugs.** `^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$`, 2–63 characters. Dots are allowed so that metadata sources can be named `audit.changes`. Unique per `(workspace, kind)`. **Guarantee.**

**Authoring form.** Documents are authored as YAML. The YAML subset is the YAML 1.2 core schema with no anchors, no aliases, no custom tags and no duplicate keys. Plain scalars such as `no`, `on` or `1.10` are never coerced; they are strings unless the kind schema says otherwise. Canonical form is JSON (3.9). **Guarantee.**

**Unknown keys are errors.** Every object in every kind schema sets `additionalProperties: false`. An unknown key is `UNKNOWN_FIELD` with `did_you_mean` and `available` filled from the schema. This is the main defence against invented fields. **Guarantee.**

---

## 3.2 Node envelope

```yaml
apiVersion: plinth/v1            # required, const
kind: <Kind>                     # required, one of the 15 kinds
metadata:
  id: <uuid>                     # optional on create; server-derived (3.9.5); must equal the derived value if given
  slug: <slug>                   # required, 3.1
  title: <string>                # required, 1..120 characters, no control characters
  labels: { <key>: <value> }     # optional, <= 32 entries; key ^[a-z][a-z0-9_.-]{0,62}$; value <= 253 characters
spec: { ... }                    # required; validated against the kind's schema (3.3)
```

**Server-owned fields.** These never appear in a submitted document: `revision`, `created_at`, `updated_at`, `deleted_at`, `body_hash`, `owner`, `on_behalf_of`, `status` (Grant), `state` (Rule, Workflow instance), `approved_by`, `proposed_by`. A document that carries one is refused with `VALIDATION_FAILED` naming the path. **Guarantee.**

**Identity.** `metadata.id` is derived at creation as `UUIDv5(PLINTH_NS, "<workspace_id>|<Kind>|<slug>")`. It never changes after creation, even when the slug is changed by a Change. A replayed creation therefore produces the same URI. **Guarantee.** The derivation is tested by `replay_reproduces` (3.10, decision D-4).

**Validation order.** `apiVersion`, then `kind`, then the envelope, then `spec` against the kind schema, then references, then type checks of expressions, then lineage cycles. The first failing stage is reported; later stages are not run. **Guarantee.**

**Errors.** Every validation error carries the exact JSON path, the expected type or the allowed values, `did_you_mean` where a near match exists, and a `fix_hint` generated from schema facts. The error codes are the closed set in 06 §3. **Guarantee.**

---

## 3.3 Node kinds

Each subsection gives the required and optional fields of `spec`, and the validation rules. The JSON Schema of each kind is generated from these tables by `plinth-spec`; the tables are authoritative and the generated schema must match them (AC-KIND-1).

### 3.3.1 Dashboard

Grid of panels and forms, parameters and layout. A node that refers to Panels by reference; it does not contain their queries.

| Field | Type | Req | Rule |
|---|---|---|---|
| `parameters` | map<slug, ParameterDecl> | no | Inline parameter declarations (3.3.5 shape). Names are referenced as `$name` in the dashboard's panels. Max 16. |
| `layout.columns` | int | no | 1..24, default 12. |
| `layout.items` | array<LayoutItem> | yes | May be empty. Each item has exactly one of `panel: <ref to Panel>` or `form: <ref to Form>`, plus `at: {x, y, w, h}` (integers, `x+w <= columns`, `w,h >= 1`). No two items overlap. |
| `layout.phone` | object | no | `{ order: [item keys] }`. Phone-width rendering stacks items in this order at full width. Items not listed are appended in `layout.items` order. |
| `rules` | array<ref to Rule> | no | Rules shown on the rules strip. |
| `panels` | map<slug, PanelDecl> | no | Bundle form only (3.10, D-3). Each entry is expanded at apply time into a separate Panel node named `<dashboard-slug>.<key>`. Not stored inline after apply. |

Rules: every `$name` in a referenced Panel must be a declared parameter of the dashboard or a Parameter node referenced by the dashboard (`UNKNOWN_REFERENCE` otherwise). A `layout.items` key that is repeated is `VALIDATION_FAILED`.

**Acceptance.** AC-DASH-1 (overlap refused with the two item keys in the error). AC-DASH-2 (phone order contains every item exactly once after default append).

### 3.3.2 Panel

A visual over exactly one query result. Panels hold no data of their own.

| Field | Type | Req | Rule |
|---|---|---|---|
| `query` | ref to Query, or inline QueryAst | yes | Resolved to a Query node at apply. Inline ASTs are stored as a generated Query node named `<panel-slug>.query`. |
| `visual.type` | enum | yes | One of the ten types in 3.5. |
| `visual.channels` | map<channel, field> | yes | Keys and types must satisfy the channel map for `visual.type` (3.5). A field that maps to no channel is an error. |
| `visual.threshold` | `{value: number, style: string}` | no | Constant reference line, not a column mapping. Allowed for `line`, `bar`, `kpi`. |
| `visual.options` | object | no | Per-type options from 3.5 only. |
| `interactions.on_click` | `{set: {param: "$click.<field>"}}` | no | Sets a session parameter (3.3.5). Creates no revision. |
| `interactions.brush_x` | `{set: param}` | no | Only for `line` and `area`. Sets an `interval` parameter from the brushed x range. Creates no revision. |

Rules: `visual.channels` fields must exist in the query's output schema (computed at validation). A `line` panel must have `x` of type timestamp. A `kpi` panel's query must produce exactly one row at the `as_of`; zero or more than one row is `VALIDATION_FAILED` at run time with the row count.

**Acceptance.** AC-PANEL-1 (a `bar` with a timestamp `x` is `TYPE_MISMATCH`). AC-PANEL-2 (a `channels` key outside the map is `VALIDATION_FAILED`, not dropped).

### 3.3.3 Query

A named query. The only read interface; every consumer (panel, rule, export, form lookup, grant check, agent interrogation) compiles through it.

| Field | Type | Req | Rule |
|---|---|---|---|
| `ast` | QueryAst | yes | Grammar in 3.4. |
| `description` | string | no | 0..500 characters. |
| `limit_default` | int | no | 1..1000, default 200. Applies to panels and exports. |

Parameters of a query are derived from its `$` references; they are not declared. Lineage is derived from `ast` (field-level, 3.6.4). **Guarantee.**

### 3.3.4 Source

A typed relation. Two kinds: `landed` (immutable Parquet partitions written by `plinth-ingest`) and `metadata` (platform tables: audit, lineage, workflow, query and rule logs).

| Field | Type | Req | Rule |
|---|---|---|---|
| `kind` | enum `landed` \| `metadata` | yes | |
| `domain` | string | no | Filter key for `source.list(domain=)`. 1..32 characters. |
| `time_column` | field name | yes | A timestamp field. It is the event time for `as_of` (3.4.6). |
| `primary_key` | array<field name> | yes | At least one field; all listed fields are non-null. |
| `fields` | array<FieldDecl> | yes | `FieldDecl = {name, type, nullable, description, masked?, x-untrusted?}`. Types: `bool, int, float, string, timestamp, duration, enum(<name>)`. `masked` (default false) marks a field that a Grant may mask (3.3.10). `x-untrusted: true` marks a field whose values are free text from outside the platform (P14). |
| `partition` | object | no | Landed only: `{by: [field], granularity: "hour" \| "day"}`. |
| `enums` | map<name, array<string>> | no | Named enum sets used by fields. |

Watermark, row estimate and partition list are runtime state (`source_partitions`), not body. They are excluded from `body_hash` (3.9.4). **Guarantee.**

Rules: a metadata source may not be written to by a Change; writes to a metadata source are `FORBIDDEN`. Landed sources are not written by Changes at all.

**Acceptance.** AC-SRC-1 (a Change targeting a metadata source is `FORBIDDEN`). AC-SRC-2 (`primary_key` field nullable is `VALIDATION_FAILED`).

### 3.3.5 Parameter

A typed named value. Used by dashboards, panels and queries. A parameter's *default* is part of the document; its *current value* is session state (P3) and is never a Change unless saved explicitly.

| Field | Type | Req | Rule |
|---|---|---|---|
| `type` | enum `string \| number \| bool \| enum \| duration \| interval \| timerange \| timestamp` | yes | |
| `default` | value of `type` | no | Must match `type`. For `interval`, the default is a relative span (`"last 1h"`) or an absolute `[start, end)` pair. |
| `choices` | array | no | Required for `duration`; optional for `enum`. Each choice has the parameter's type. 1..64 entries. |
| `source` | ref to Query | no | Only for `enum`. The query's first column provides the choices at run time. |
| `multi` | bool | no | Only for `enum`. Default false. |
| `required` | bool | no | Default false. A required parameter with no default and no session value stops the dependent panel with a `not_set` state. |

Value types at run time: `interval` resolves to absolute `[start, end)` timestamps against `as_of`; the resolved value is part of the query cache key (3.4.6). A `timerange` is `{start, end}` absolute, timezone UTC.

**Acceptance.** AC-PARAM-1 (a `default` not matching `type` is `TYPE_MISMATCH`). AC-PARAM-2 (setting a parameter through `on_click` or `brush_x` creates no Change row and no revision: query `changes` count before and after equal).

### 3.3.6 Rule

A condition over a query result that moves through states and produces a firing. Each `group_by` value has its own state machine.

| Field | Type | Req | Rule |
|---|---|---|---|
| `query` | ref to Query | yes | Its output must contain every field named in `when`. |
| `when` | predicate string | yes | Comparisons (`<, <=, >, >=, =, !=`), `and`, `or`, `not`, numeric and duration literals, over output fields and constants. No functions, no parameters. |
| `hold` | duration | yes | 0 to 24 h. Must be a whole multiple of the query's window size when the query has one. |
| `group_by` | array<field> | no | Fields of the query output. Default: no grouping (one state machine). |
| `on_fire` | array<ref to Action> | no | Run once per firing. |
| `owner` | principal ref | server | Set at creation (3.3.12). |
| `on_behalf_of` | principal ref | server | Set at creation for agent-created rules. |

**State machine per group key.** `ok → pending` when `when` first holds; `pending → firing` when it has held continuously for `hold`; `pending → ok` when it stops holding before `hold`; `firing → resolved` when it stops holding; `resolved → ok` at the next clean evaluation; `resolved → pending` when a new breach begins. Entering `firing` allocates a `firing_id` (a UUIDv5 of rule id, group key and virtual time of entry). Each `firing_id` produces one notification and one workflow instance. **Guarantee.** Test `rule_firing_once` covers restart.

Evaluation is on the virtual clock. A rule with `hold: 3m` over a 1-minute window query fires after three consecutive windows satisfy `when`.

**Acceptance.** AC-RULE-1 (a `hold` shorter than the window is `VALIDATION_FAILED`). AC-RULE-2 (`when` referencing a field not in the query output is `UNKNOWN_FIELD`). AC-RULE-3 (`when` containing a `$` reference is `VALIDATION_FAILED`, because a rule's firing must not depend on session state).

### 3.3.7 Action

A typed, previewable side effect. An Action declares its inputs, its effects and its permission. It cannot write a path it did not declare.

| Field | Type | Req | Rule |
|---|---|---|---|
| `input` | JSON Schema object | yes | Object schema. Its properties type the Form fields that submit to it. |
| `effects.changes` | array<path pattern> | yes (may be empty) | JSON Pointer patterns over the target node body, e.g. `/spec/state`. A Change from the action is refused if any path is outside this list (`FORBIDDEN`). |
| `effects.notify` | array<`channel:<name>`> | yes (may be empty) | Named notification receivers from configuration (3.10, D-10). |
| `permission` | string | yes | Permission name, for example `workflow:acknowledge` or `action:notify`. |
| `external` | bool | yes | `true` when the effect leaves the platform boundary (egress to a third party). Drives rule `R-ACTION-EXTERNAL` (06 and 03). |
| `handler` | enum `change \| notify \| http` | yes | `http` is for `external: true` only. |

Lineage for an Action is `effects.changes` and `effects.notify`. An Action whose declared effects are empty and whose `handler` is `change` is refused at validation (`VALIDATION_FAILED`: a change action must declare at least one path).

**Acceptance.** AC-ACT-1 (a Change from an Action touching an undeclared path is `FORBIDDEN` and names the path). AC-ACT-2 (`external: true` with `handler: notify` is `VALIDATION_FAILED`).

### 3.3.8 Form

Fields typed from a source, submitted through an Action.

| Field | Type | Req | Rule |
|---|---|---|---|
| `source` | ref to Source | yes | Field types come from this source. |
| `fields` | array<FormField> | yes | `FormField = {name, label, required?, max_length?, lookup?}`. `name` must be a source field or an input of the submit action. The widget is derived from the type; a `string` field may set `max_length` (1..4000). |
| `submit` | ref to Action | yes | The action receives the field values as its input, and the base revision from form load. |
| `context` | map<name, `$instance` or `$param`> | no | Values bound at render time, such as the workflow instance URI. |

Rules: a form field whose name is a masked source field is `UNKNOWN_FIELD` (3.10, D-9). Submitting a form is a Change through the Action; the form holds no write path of its own.

**Acceptance.** AC-FORM-1 (a form field naming an unknown input is `UNKNOWN_FIELD` with `did_you_mean` from the action's input properties). AC-FORM-2 (submit produces a Change whose `surface` is `ui` and whose `actor_id` is the submitting human).

### 3.3.9 Workflow

Either a *definition* (a state machine) or an *instance* (one run of a definition). Instances are Workflow nodes, which is decision D-5.

| Field | Type | Req | Rule |
|---|---|---|---|
| `definition.states` | array<{name, terminal?}> | definition only | Names unique. At least one `terminal` state. |
| `definition.initial` | state name | definition only | Must be a declared state. |
| `definition.transitions` | array<Transition> | definition only | `Transition = {from, to, on, permission?, guard?, actions?}`. `on` is `action:<ref>`, `rule:<ref>` or `system`. `guard` is a predicate over the instance's subject query output. |
| `instance_of` | ref to Workflow | instance only | Must be a definition. |
| `state` | state name | instance only | Server-owned. |
| `subject` | URI | instance only | The node the instance is about (for example a rule or an order). |
| `rule_firing_id` | uuid | instance only | Set when the instance is created by a rule firing. |

An instance is exactly one of definition or instance fields; both present is `VALIDATION_FAILED`. Transition history is `workflow.transitions` (3.6.3). **Guarantee.**

Incident definition used by the demo: states `open` (initial), `acknowledged`, `resolved`, `closed` (terminal). Transitions: `open → acknowledged` on `action:acknowledge-incident` with permission `workflow:acknowledge`; `open → resolved` on `rule:p95-regional-breach` when the rule goes `resolved`; `resolved → closed` on `system`.

**Acceptance.** AC-WF-1 (an instance `state` outside `definition.states` is `UNKNOWN_REFERENCE`). AC-WF-2 (a transition whose `permission` the actor lacks is `FORBIDDEN` naming the permission).

### 3.3.10 Grant

A permission over a resource, optionally narrowed by a row predicate and a column mask. The only authorization primitive (P6).

| Field | Type | Req | Rule |
|---|---|---|---|
| `principal` | principal ref | yes | `user:`, `agent:` or `service:`. |
| `effect` | enum `allow \| deny` | yes | Deny overrides allow (03 §3). |
| `actions` | array<permission name> | yes | 1..16 entries, each from the closed permission vocabulary in 03 §2 (for example `node:read`, `query:run`, `action:<name>`). No wildcards. |
| `resource` | URI pattern | yes | `plinth://<ws>/<Kind>/<id-or-*>`, or a node reference resolved to a URI at apply. |
| `row_predicate` | predicate string | no | Predicate grammar (03 §3): comparisons and `in` over fields of the resource's sources, literal values only. No `$` references and no `now()` (so `policy_hash` is stable). Absent or null means all rows. |
| `column_mask` | array<field name> | no | Only `masked: true` fields of the resource's sources. |
| `expires_at` | timestamp | no | Virtual-clock time. |
| `status` | enum `pending_approval \| active \| rejected \| revoked \| expired` | server | Changed only by the approval path (03 §7.1). |
| `proposed_by` | principal ref | server | |
| `approved_by` | principal ref | server | Required before `active`. |

Rules: a Grant Change by an agent principal is held as `pending_approval` (R-GRANT). The approver must be a human holding `approval:decide` and `grant:write` on the resource, and must be neither the requester, the `on_behalf_of` principal nor the delegator (P7; 03 §7.2). A committed agent proposal returns `pending_approval` with an `approval_id`; `FORBIDDEN` naming `grant:write` is returned only for an attempt to approve or force-apply a grant. `grant.check` evaluates a Grant's predicate with the same compiler as a query (P16). **Guarantee.**

**Acceptance.** AC-GRANT-1 (a `row_predicate` containing `$` is `VALIDATION_FAILED`). AC-GRANT-2 (a proposal by `agent:claude-code` on behalf of `user:ops-lead`, approved by `user:ops-lead`, is refused with `FORBIDDEN` naming `grant:write`). AC-GRANT-3 (the approval by `user:finance-analyst` moves the status to `active` and the effective-access counts change).

### 3.3.11 Metric

A named expression reused across queries. Expanded by the compiler; a metric is a macro, not a stored result.

| Field | Type | Req | Rule |
|---|---|---|---|
| `expr` | Expr (3.4.4) | yes | May contain aggregate calls. |
| `source` | ref to Source | yes | The source the expression reads. |
| `description` | string | no | 0..500 characters. |

Metric references are expanded before typechecking. A metric that refers, directly or through other metrics, to itself is `VALIDATION_FAILED` with the cycle in `path`. Expansions are recorded in lineage (3.6.4). **Guarantee.**

**Acceptance.** AC-METRIC-1 (a two-metric cycle is refused with the cycle named). AC-METRIC-2 (a query using a metric and the same expression written out produce equal `query_hash` after expansion).

### 3.3.12 Template

A document with declared parameters, instantiated into one or more nodes.

| Field | Type | Req | Rule |
|---|---|---|---|
| `of_kind` | kind | yes | The kind the template produces. |
| `parameters` | array<{name, type, required?, default?}> | yes | Types from 3.3.5. |
| `body` | object | yes | A document body of `of_kind`. String values may contain `${name}` placeholders, and only in string positions. |

Instantiation produces an ordinary Change set. Templates are not a marketplace in this design (06 G.6). Templates are Supporting (not on stage).

**Acceptance.** AC-TPL-1 (a placeholder in a non-string position is `VALIDATION_FAILED`). AC-TPL-2 (an instantiated body passes the same validation as a hand-written document).

### 3.3.13 Export

A query serialised on a schedule to a destination.

| Field | Type | Req | Rule |
|---|---|---|---|
| `query` | ref to Query | yes | Runs under the owner principal with the same compiler (row predicates and masks apply). |
| `format` | enum `csv \| parquet` | yes | |
| `schedule` | cron string (5 fields, UTC) | no | Absent means on-demand only. |
| `destination` | `{kind: "s3" \| "action", ref}` | yes | `s3` takes a bucket-relative prefix. `action` takes an Action reference. |

**Acceptance.** AC-EXP-1 (an export whose query selects a masked field is refused at validation: `UNKNOWN_FIELD`, as for any masked reference).

### 3.3.14 Annotation

A time-anchored note on a node.

| Field | Type | Req | Rule |
|---|---|---|---|
| `target` | URI or reference | yes | Any node. |
| `at` | timestamp | yes | Virtual-clock time. |
| `until` | timestamp | no | Must be after `at`. |
| `text` | string | yes | 1..2000 characters. `x-untrusted: true` (P14). |

The author is server-set from the actor. **Acceptance.** AC-ANN-1 (an annotation whose text contains an instruction-like string is stored and returned inside the untrusted envelope, never interpreted; the seeded injection annotation in the rehearsal set exercises this).

### 3.3.15 Comment

A flat comment on any node.

| Field | Type | Req | Rule |
|---|---|---|---|
| `target` | URI or reference | yes | |
| `body` | string | yes | 1..4000 characters. `x-untrusted: true`. |
| `mentions` | array<principal ref> | no | Up to 20. Each mention creates a notification. |

No threads: comments are flat in the first cut (06 G.6). **Acceptance.** AC-CMT-1 (a mention of an unknown principal is `UNKNOWN_REFERENCE`).

---

## 3.4 Query AST grammar

The query AST is the only read interface (P3). It is written as JSON in canonical form and as the YAML subset in documents. The grammar below defines the accepted set; anything outside it is `VALIDATION_FAILED`.

### 3.4.1 QueryAst

```
QueryAst  ::= { from: SourceRef
              , join?:   [Join]          (at most 3)
              , where?:  [Pred]          (conjunction)
              , derive?: { name: Expr }  (names unique; may be referenced later)
              , window?: Window
              , group?:  [Field]         (may include window_start, window_end)
              , aggregate?: { name: Agg } (requires group or a single whole-query aggregate)
              , select?: [Field]         (projection after aggregate)
              , order?:  [{field, dir: "asc" | "desc"}]
              , limit?:  int (1..1000) }
union?    ::= [QueryAst]                 (at root only; all members have identical output schemas)
SourceRef ::= "source:" slug | "query:" slug (a query as a subquery; at most 2 levels)
Join      ::= { source: SourceRef, on: [{left: Field, right: Field}], kind: "inner" | "left" }
```

**Evaluation order, fixed.** `from` → `join` → `where` → `derive` → `window` → `group` → `aggregate` → `select` → `order` → `limit`. Union combines finished members. **Guarantee.** The compiler applies the row predicates of 04 D.4 to each source relation before `join` or `union`.

**Pred.** `{field, op, value}` where `op` is one of `eq, ne, lt, lte, gt, gte, in, not_in, is_null, not_null`, and `value` is an Expr string (for example `"now() - $window"`) or a JSON literal. `in` takes an array of literals or a parameter of type enum with `multi: true`.

**No `having`.** Post-aggregate filtering is not an operator. A post-aggregate threshold is expressed as a Rule `when` or a Panel `visual.threshold` (decision D-15).

### 3.4.2 Window

```
Window ::= { kind: "tumbling", by: timestamp Field, size: Duration }
         | { kind: "trailing", by: timestamp Field, size: Duration, step: Duration }
```

A window operator adds `window_start` and `window_end` (timestamp) to every row. Tumbling windows are half-open `[start, end)` and aligned to the Unix epoch. Trailing windows emit one row per `step` covering `[t - size, t)`. `size` and `step` are whole milliseconds, and `step` divides `size`. **Guarantee.**

### 3.4.3 Types

| Type | Canonical value | Notes |
|---|---|---|
| `bool` | `true`, `false` | |
| `int` | 64-bit signed | Overflow is an error (`VALIDATION_FAILED` at run time with the operator named). |
| `float` | IEEE 754 double | `NaN` and infinities are not storable; they produce `null` with a warning. |
| `string` | UTF-8 | |
| `timestamp` | UTC, microsecond precision, RFC 3339 with `Z` | Named `timestamp` in all schemas. |
| `duration` | integer milliseconds | Literals `90s, 15m, 1h, 3d` (integer multiples). |
| `enum(name)` | string from the named set | Comparisons are on the set's spelling. |
| `interval` | `{start, end}` absolute, `[start, end)` | Resolved at `as_of`. |
| `null` | | Typed nulls carry their type. |

### 3.4.4 Expressions

```
Expr     ::= Literal | FieldRef | Param | ClickRef | MetricRef
           | Expr BinOp Expr | UnOp Expr | Call | "(" Expr ")"
Literal  ::= int | float | string | bool | timestamp literal | duration literal | null
FieldRef ::= ident | ident "." ident        (second form after a join: alias.field)
Param    ::= "$" ident
ClickRef ::= "$click." ident
MetricRef::= "metric:" slug
BinOp    ::= "+" | "-" | "*" | "/" | "=" | "!=" | "<" | "<=" | ">" | ">=" | "and" | "or" | "in"
UnOp     ::= "not" | "-"
Call     ::= "now()" | "coalesce(" Expr {"," Expr} ")" | "abs(" Expr ")"
           | "ms(" Expr ")"          (duration to int milliseconds)
           | "round(" Expr "," int ")"
           | "date_trunc(" duration "," Expr ")"
Agg      ::= "count()" | "count_distinct(" Field ")" | "sum(" Expr ")" | "avg(" Expr ")"
           | "min(" Expr ")" | "max(" Expr ")" | "percentile(" Expr "," float ")"
```

**Typing rules.** Arithmetic on `int` and `float` yields the wider type. `timestamp - timestamp` yields `duration`. `timestamp + duration` and `timestamp - duration` yield `timestamp`. `ms(duration)` yields `int`. Comparisons require equal types (or int/float). `in` requires the list's element type to equal the left type. `sum` and `avg` require numeric input. `percentile` requires numeric input and `p` strictly between 0 and 1. Any other combination is `TYPE_MISMATCH` with the expected and actual types. **Guarantee.**

**Nulls.** Comparisons with a null operand yield null, and a null `where` result excludes the row. Aggregates other than `count()` ignore nulls. A `percentile` over an empty group is null. **Guarantee.**

**Parameters and time.** `$name` is replaced by the resolved parameter value, typed by the parameter's `type`. `now()` is the query's `as_of` (3.4.6). A parameter used where its type does not fit is `TYPE_MISMATCH` at validation, not at run time.

**Masked fields.** A reference to a field masked for the principal is `UNKNOWN_FIELD`, with the same shape as a reference to a field that does not exist (P8). **Guarantee.**

**Functions and extension.** There are no user-defined functions and no string-to-SQL escapes (04 D.3). The function list above is closed; adding a function is a platform release.

### 3.4.5 Lineage from the AST

Every `FieldRef` in `from`, `join`, `where`, `derive`, `group`, `aggregate` and `select` produces a lineage edge `(source, field) → (query, output name)`. Every `Metric` expansion produces the same edges. The compiler records these in `lineage.edges` at commit of a Query node. **Guarantee.** Lineage for a new expression form must be added with the form (04 G.4); a form without lineage fails the `lineage_complete` test.

### 3.4.6 The `as_of` rule

1. **One `as_of` per execution.** Every execution has exactly one `as_of`, a UTC timestamp at microsecond precision. An explicit `as_of` on `query.run` is used. Otherwise a live execution uses the workspace's virtual now at execution time. During replay the recorded value is used. **Guarantee.**
2. **`now()` is `as_of`.** Nothing in a query reads the wall clock. **Guarantee.**
3. **Event-time bound.** The engine reads only rows whose `time_column` is at or before `as_of`. The upper bound is implicit; the query does not state it. **Guarantee.**
4. **Watermark wait.** The engine waits, up to the step budget, for the source watermark to reach `as_of`. If it does not, the result is `SOURCE_STALE` with the watermark value. **Guarantee.**
5. **Future `as_of` is refused.** An `as_of` later than the virtual now is `VALIDATION_FAILED`. **Guarantee.**
6. **Bounded scans.** A query over a `landed` source must contain, as a top-level `where` conjunct, a lower bound on that source's `time_column`. Otherwise it is refused with `QUERY_TIMEOUT` and a hint to add a window, as in 04 D.9. **Guarantee.**
7. **Cache key.** The result cache key is `(query_hash, policy_hash, parameter_values, as_of)` (3.9.6). Two executions that differ only in `as_of` never share a result. **Guarantee.**
8. **Result hash excludes watermark.** The result hash does not include watermarks (3.9.7). **Guarantee.**

**Acceptance.** AC-AS-1 (`now()` equals the explicit `as_of` in a test that runs the same query at two `as_of` values with a fixed history). AC-AS-2 (a query with `as_of` later than the virtual now returns `VALIDATION_FAILED`). AC-AS-3 (a query with no lower time bound returns `QUERY_TIMEOUT` with the hint). AC-AS-4 (the `episode_in_history` test: at the 14:05 `as_of` the EMEA/Crane p95 exceeds 900 ms; at 13:00 it does not).

---

## 3.5 Visual types and channel maps

Visual types are a closed set. Each maps result columns to channels. No visual has its own data access: a visual receives a query result and nothing else (P1). Types in the first group are demonstrated on stage. Types in the second group are supported: real, tested, and not in the five-minute script.

| `visual.type` | Status | Demonstrated in beat |
|---|---|---|
| `line` | Demonstrated | 2, 3 (time series with brushing) |
| `bar` | Demonstrated | 2 (bars by region in the Exec view comparison) |
| `heatmap` | Demonstrated | 3 (carrier by region) |
| `kpi` | Demonstrated | 1 (live tile with sparkline) |
| `table` | Demonstrated | 9, 11 (timeline, blast-radius table) |
| `lineage` | Demonstrated | 11 (node-link graph) |
| `area` | Supporting | none |
| `scatter` | Supporting | none |
| `sankey` | Supporting | none |
| `geo` | Supporting | none |

**Channel maps.** Types: `temporal` = timestamp; `quant` = int, float or duration (durations are read as integer milliseconds); `nominal` = string, enum or bool. A channel accepts only its listed types. A channel field of the wrong type is `TYPE_MISMATCH`. A column mapped to no channel is never silently dropped (04 D.3).

| Type | Channel | Type accepted | Required | Notes |
|---|---|---|---|---|
| `line` | `x` | temporal | yes | Usually `window_start`. |
| | `y` | quant | yes | 1 to 4 fields. |
| | `color` | nominal | no | One series per value. At most 12 series; more is `VALIDATION_FAILED` with the count. |
| | threshold (constant) | — | no | `visual.threshold`. |
| | brush (interaction) | — | no | `interactions.brush_x`, sets an `interval` parameter. |
| `area` | `x` | temporal | yes | As `line`. |
| | `y` | quant | yes | |
| | `color` | nominal | no | |
| | `options.stack` | bool | no | Default false. |
| `bar` | `x` | nominal | yes | At most 200 distinct categories. |
| | `y` | quant | yes | |
| | `color` | nominal | no | Grouped or stacked by `options.stack`. |
| | threshold (constant) | — | no | |
| `heatmap` | `x` | nominal | yes | At most 40 distinct values. |
| | `y` | nominal | yes | At most 40 distinct values. |
| | `value` | quant | yes | Maps to the colour ramp. Cell click sets two parameters through `on_click`. |
| `kpi` | `value` | quant | yes | Exactly one row at `as_of`. |
| | `sparkline_x` | temporal | no | Requires `sparkline_y`. |
| | `sparkline_y` | quant | no | |
| | `compare` | quant | no | Shows a delta. |
| | `thresholds` | — | no | Array of `{gt \| lt, value, style}`. |
| `table` | `columns` | any except masked | yes | Ordered list. |
| | `sort` | any | no | Field and direction. |
| `scatter` | `x` | quant | yes | Supporting. |
| | `y` | quant | yes | |
| | `color` | nominal | no | |
| | `size` | quant | no | |
| `sankey` | `source` | nominal | yes | Supporting. Rows are links. |
| | `target` | nominal | yes | |
| | `value` | quant | yes | |
| `geo` | `key` | nominal | yes | Must be one of the five region codes (`NA, EMEA, APAC, LATAM, ANZ`). Supporting. |
| | `value` | quant | yes | |
| `lineage` | `from` | nominal | yes | Edge rows. Nodes are the distinct endpoints. |
| | `to` | nominal | yes | |
| | `edge_type` | nominal | no | Edge label. |
| | `node_kind` | nominal | no | Node colour. |

**Rendering contract.** `line`, `area`, `bar`, `heatmap`, `scatter`, `sankey`, `lineage` are drawn with ECharts (`line`, `bar`, `heatmap`, `scatter`, `sankey` series; `lineage` is an ECharts `graph` series, node-link layout). `kpi` and `table` are React components. `geo` is an ECharts map series with the five region geometries bundled. **Guarantee** that all ten types render from the same channel-mapped rows.

**Animation rule (P2).** A panel animates on mount only when the change sequence that created it is available (commit or realtime event id). No visual animates on a timer. **Guarantee,** enforced by a build test that fails if an animation starts without an event id.

**Acceptance.** AC-VIS-1 (every channel row above has a test that accepts the listed types and refuses one other type). AC-VIS-2 (`line` with a `color` of 13 series is `VALIDATION_FAILED`). AC-VIS-3 (a `kpi` over a two-row result is refused, not truncated). AC-VIS-4 (a `lineage` panel's nodes are exactly the distinct endpoints of its edge rows, checked on the finale query).

---

## 3.6 Data sources

### 3.6.1 Northwind landed sources

Northwind Fulfilment is a fictional retailer. Its data is produced by `plinth-gen` (xoshiro256**, seed committed) and landed by `plinth-ingest` as immutable Parquet partitions. Five regions: `NA, EMEA, APAC, LATAM, ANZ`. Carriers: `Crane, Swift, Harbor, Polar, Meridian`.

**`orders`** (landed; time column `placed_at`; primary key `order_id`; partition by day, then hour).

| Field | Type | Null | Description |
|---|---|---|---|
| `order_id` | string | no | UUID text. |
| `region` | enum(region) | no | One of the five regions. |
| `carrier` | enum(carrier) | yes | Null until handed to carrier. |
| `status` | enum(order_status) | no | `placed, picked, packed, in_transit, delivered, returned`. |
| `placed_at` | timestamp | no | Event time. |
| `picked_at` | timestamp | yes | |
| `packed_at` | timestamp | yes | |
| `handed_to_carrier_at` | timestamp | yes | End of the handoff stage (packed to handed). |
| `fulfilled_at` | timestamp | yes | Equals `delivered_at`; the end of the fulfilment latency. |
| `returned_at` | timestamp | yes | |
| `sku_count` | int | no | |
| `order_value_cents` | int | no | |
| `customer_ref` | string | no | Masked (`masked: true`). |
| `fault_profile` | string | yes | Identifier of the `FaultProfile` that shaped this order's timing, or null. Used by the episode tests. |

Fulfilment latency is `ms(fulfilled_at - placed_at)`. Orders with null `fulfilled_at` are excluded from latency aggregates by the null rules (3.4.4). The handoff stage is multiplied by the active `FaultProfile` factor for its region and carrier.

**`carrier_scans`** (landed; time column `scanned_at`; primary key `scan_id`).

| Field | Type | Null | Description |
|---|---|---|---|
| `scan_id` | string | no | |
| `order_id` | string | no | Joins to `orders.order_id`. |
| `carrier` | enum(carrier) | no | |
| `region` | enum(region) | no | |
| `scan_type` | enum(scan_type) | no | `handoff, transit, delivered, exception`. |
| `scanned_at` | timestamp | no | Event time. |
| `location` | string | yes | Free text from the carrier. `x-untrusted: true`. |
| `delay_ms` | int | yes | Scan-reported delay. |

**`warehouse_capacity`** (landed; time column `sampled_at`; primary key `sample_id`).

| Field | Type | Null | Description |
|---|---|---|---|
| `sample_id` | string | no | |
| `warehouse_id` | string | no | |
| `region` | enum(region) | no | |
| `sampled_at` | timestamp | no | Event time. |
| `capacity_units` | int | no | |
| `used_units` | int | no | |
| `utilisation` | float | no | `used_units / capacity_units`, stored by the generator. |

**Data volume.** The 30-day history ending 14:30 on the fixed virtual demo date contains about 2.4 million order rows. **Target**, to be measured from the seed; it is not a claim about a running system.

### 3.6.2 Seeded episode

The history contains one `FaultProfile` for `region = EMEA`, `carrier = Crane`: the handoff multiplier ramps from 1.0 to 2.2 between 14:00 and 14:05, holds until 14:20, and returns to 1.0 by 14:25. Its parameters are in the seed file. The live fault (cue F7) applies the same profile type at the next generator tick. **Guarantee** of the profile's effect is the test `episode_in_history` (3.6.5).

### 3.6.3 Metadata sources

Metadata sources are platform tables exposed as read-only sources. They are queried through the same compiler, with the same workspace predicate, grants and masks. They are the mechanism behind "metadata is a source" (04 B.6). **Guarantee** that they are read-only (AC-SRC-1).

**`audit.changes`** (time column `virtual_at`; primary key `seq`).

| Field | Type | Null | Description |
|---|---|---|---|
| `seq` | int | no | Workspace chain sequence. |
| `created_at` | timestamp | no | |
| `virtual_at` | timestamp | no | Virtual-clock time of the Change. The demo time column; audit-window queries filter on it (README ruling 7). |
| `node_uri` | string | no | |
| `node_kind` | enum(kind) | no | |
| `node_slug` | string | yes | |
| `actor` | string | no | Principal reference, for example `agent:claude-code`. |
| `on_behalf_of` | string | yes | Principal reference. |
| `surface` | enum(surface) | no | `ui, api, mcp, driver, system, cli`. |
| `session_id` | string | yes | |
| `base_revision` | int | no | |
| `result_revision` | int | no | |
| `change_hash` | string | no | Hex SHA-256. |
| `reason` | string | yes | `x-untrusted: true`. |
| `undo_of` | int | yes | |
| `replay_of` | string | yes | `'<transcript_id>:<step>'`, set on replayed rows (README ruling 6). |
| `contains_untrusted` | bool | no | |

**`lineage.edges`** (time column `created_at`; primary key `edge_id`).

| Field | Type | Null | Description |
|---|---|---|---|
| `edge_id` | string | no | |
| `created_at` | timestamp | no | |
| `edge_type` | enum(edge_type) | no | `reads_field, filters_on, derives_from, aggregates, binds_parameter, writes_path, notifies, grants_on, expands_metric`. |
| `from_kind` | enum(kind) | no | |
| `from_uri` | string | no | |
| `from_field` | string | yes | |
| `to_kind` | enum(kind) | no | |
| `to_uri` | string | no | |
| `to_field` | string | yes | |
| `ast_hash` | string | yes | Hash of the expression that produced the edge. |

The query `lineage.dependents(source="orders", field="fulfilled_at")` in the finale (04 C.2) is this query: `from: source:lineage.edges`, `where` on `from_uri` equal to the orders URI, `from_field` equal to `fulfilled_at`, and `edge_type` in `reads_field`, `filters_on`, `aggregates`, following edges to panels, rules, dashboards and grants. The shorthand is not a grammar construct (decision D-12).

**`workflow.instances`** (time column `created_at`; primary key `instance_uri`).

| Field | Type | Null | Description |
|---|---|---|---|
| `instance_uri` | string | no | |
| `created_at` | timestamp | no | |
| `updated_at` | timestamp | no | |
| `workflow_slug` | string | no | |
| `state` | string | no | Current state name. |
| `subject_uri` | string | yes | |
| `rule_firing_id` | string | yes | |
| `revision` | int | no | |

**`workflow.transitions`** (time column `at`; primary key `transition_seq`).

| Field | Type | Null | Description |
|---|---|---|---|
| `transition_seq` | int | no | |
| `at` | timestamp | no | |
| `instance_uri` | string | no | |
| `from_state` | string | yes | Null for the initial transition. |
| `to_state` | string | no | |
| `trigger` | enum(trigger) | no | `rule, action, human, system`. |
| `actor` | string | no | |
| `on_behalf_of` | string | yes | |
| `surface` | enum(surface) | no | |
| `change_seq` | int | yes | |
| `reason` | string | yes | `x-untrusted: true`. |

**`query.runs`** (backed by table `query_runs`, 05 §8.2; time column `started_at`; primary key `run_id`).

| Field | Type | Null | Description |
|---|---|---|---|
| `run_id` | string | no | |
| `started_at` | timestamp | no | |
| `principal` | string | no | |
| `surface` | enum(surface) | no | |
| `query_hash` | string | no | |
| `policy_hash` | string | no | |
| `as_of` | timestamp | no | |
| `row_count` | int | yes | |
| `duration_ms` | int | yes | |
| `result_hash` | string | yes | |
| `cache_hit` | bool | no | |
| `error_code` | string | yes | Closed error code of a failed run (06 §3). |

**`rule.firings`** (time column `opened_at`; primary key `firing_id`).

| Field | Type | Null | Description |
|---|---|---|---|
| `firing_id` | string | no | |
| `opened_at` | timestamp | no | Entry to `pending`. |
| `fired_at` | timestamp | yes | Entry to `firing`. |
| `resolved_at` | timestamp | yes | |
| `rule_uri` | string | no | |
| `group_key` | string | yes | JSON text of the `group_by` values. |
| `state` | enum(rule_state) | no | `ok, pending, firing, resolved`. |
| `value` | float | yes | The `when` operand at the last evaluation. |
| `owner` | string | no | Principal reference. |
| `effective_principal` | string | yes | Set when an action runs. |
| `observed_query_run_id` | string | yes | Joins to `query.runs`. |

### 3.6.4 Lineage

Lineage is field-level for queries (3.4.5) and path-level for Changes (`writes_path` edges from Action effects and Change ops). It is stored in `lineage.edges` and exposed as the source above. Lineage is not column-level lineage across external systems (06 G.6). **Guarantee** for the derivation rule; **Target** for lineage build time, which is not on the demo's critical path.

---

## 3.7 Entity-relationship diagram

```
                       ┌──────────────┐ grants_on (resource pattern)
                       │    Grant     │─────────────────────────────────┐
                       │ principal    │◄── row_predicate applies to ──┐ │
                       └──────┬───────┘                               │ │
                  proposed_by │ approved_by                           │ │
                              ▼                                       │ ▼
┌───────────┐ revises  ┌───────────┐  subject of   ┌───────────┐     ┌────────┐
│  Change   │─────────►│   Node    │◄──────────────│ Principal │     │ Source │◄──── Query.from / Join.source
│ (chain)   │ undo_of  │ (any kind)│  owner, on_   └───────────┘     └────────┘          │
└─────┬─────┘          └─────▲─────┘  behalf_of                          ▲  ▲             │
      │ ops reach             │                                         │  │ reads       │
      ▼                       │ layout.items.panel                      │  │             │
┌───────────┐  layout  ┌──────┴─────┐  query  ┌───────┐  from/join/  ┌───┴──┴──┐           │
│ Dashboard │─────────►│   Panel    │────────►│ Query │─────────────►│ (sources│           │
│ params ───┼──┐       │ visual     │         │  ast  │◄──── Metric ─┤ & meta) │           │
└───────────┘  │       └──┬─────────┘         └──┬────┘  expands     └─────────┘           │
               ▼          │ on_click/brush_x     │ query               ▲                  │
          ┌──────────┐    ▼ sets                 ▼                     │ lineage.edges     │
          │Parameter │◄── session values   ┌──────────┐  on_fire  ┌────┴─────┐  effects  │
          │ (shared) │  (not a Change)     │   Rule   │──────────►│  Action  │───────────┘
          └──────────┘                     └────┬─────┘           └────▲─────┘
                                                │ firing_id              │ submit
                                                ▼                        │
                                        ┌──────────────┐ instance_of ┌───┴──┐ source
                                        │ Workflow     │◄────────────│ Form │─────────► Source
                                        │ inst. (node) │ (definition)└──────┘
                                        └──────┬───────┘
                                               │ transitions (history table)
                                               ▼
                                        workflow.transitions

Export ──query──► Query                 Metric ──source──► Source
Template ──of_kind──► any kind          Annotation / Comment ──target──► any node
Lineage edges are derived from Query ASTs, Metric expansions and Action effects.
```

**Reading the diagram.** Dashed relations in the prose are not drawn: a Change revises exactly one node; a Panel has exactly one Query; a Query has one `from` source and any number of joins; a Rule has one Query and many Actions; an Action has effects, not reads. Metadata sources are ordinary Sources with the same relations as landed ones.

---

## 3.8 Complete example: the Ops board

The following documents form one `plinth apply` bundle (separated by `---`). The Dashboard is complete. The Query, Panel, Rule and Action documents are complete and back the beat-2 line panel and the beat-4 rule. The dashboard also refers to nodes that are not shown here (`query:regions`, `query:carriers`, `query:late-orders`, `form:acknowledge-incident`, `panel:carrier-heatmap`); they are defined in the same bundle in the full demo workspace and are not repeated, because their shape follows the same rules. The example is an illustrative end state. The nodes that exist when the demo starts are the seed in `../presentation-script.md`; the p95 line panel (beat 2), the carrier heatmap (beat 3) and the acknowledge form (beat 9) are created live by the agent and the presenter.

**Dashboard** (complete):

```yaml
apiVersion: plinth/v1
kind: Dashboard
metadata:
  slug: ops-board
  title: "Fulfilment operations"
  labels: { team: operations, tier: room-display }
spec:
  parameters:
    window:
      type: duration
      default: 1h
      choices: [15m, 1h, 6h, 24h]
    incident_window:
      type: interval
      default: "last 1h"
    region:
      type: enum
      source: query:regions
      multi: true
    carrier:
      type: enum
      source: query:carriers
      multi: true
      required: false
  layout:
    columns: 12
    items:
      - panel: p95-by-region
        at: { x: 0, y: 0, w: 8, h: 5 }
      - panel: carrier-heatmap
        at: { x: 8, y: 0, w: 4, h: 5 }
      - panel: late-orders-kpi
        at: { x: 0, y: 5, w: 3, h: 2 }
      - form: acknowledge-incident
        at: { x: 3, y: 5, w: 5, h: 4 }
    phone:
      order: [acknowledge-incident, p95-by-region]
  rules:
    - rule:p95-regional-breach
  panels:
    late-orders-kpi:
      query: query:late-orders
      visual:
        type: kpi
        channels:
          value: late_orders
          sparkline_x: window_start
          sparkline_y: late_orders
        thresholds:
          - { gt: 0, style: critical }
```

The `panels:` block above is the bundle form (3.10, D-3). It is expanded at apply into the Panel node `ops-board.late-orders-kpi`, and the dashboard's `layout` item refers to that expanded node. Two items use Panel and Form references that are created in the same bundle or already exist.

**Query** (`query:p95-by-region`):

```yaml
apiVersion: plinth/v1
kind: Query
metadata: { slug: p95-by-region, title: "p95 fulfilment latency by region, per minute" }
spec:
  ast:
    from: source:orders
    where:
      - { field: placed_at, op: gte, value: "now() - $window" }
      - { field: region,    op: in,  value: $region }
    derive:
      latency_ms: "ms(fulfilled_at - placed_at)"
    window: { kind: tumbling, by: placed_at, size: 1m }
    group: [window_start, region]
    aggregate:
      p95_latency_ms: { fn: percentile, of: latency_ms, p: 0.95 }
      orders:         { fn: count }
    order: [{ field: window_start, dir: asc }]
```

**Panel** (`ops-board.p95-by-region`, the line panel of beat 2):

```yaml
apiVersion: plinth/v1
kind: Panel
metadata: { slug: p95-by-region, title: "p95 latency by region" }
spec:
  query: query:p95-by-region
  visual:
    type: line
    channels:
      x: window_start
      y: p95_latency_ms
      color: region
    threshold: { value: 900, style: alert }
  interactions:
    on_click: { set: { region: "$click.region" } }
    brush_x:  { set: { incident_window: "$brush" } }
```

**Rule** (`rule:p95-regional-breach`, beat 4):

```yaml
apiVersion: plinth/v1
kind: Rule
metadata: { slug: p95-regional-breach, title: "p95 above 900 ms for 3 minutes, per region" }
spec:
  query: query:p95-by-region
  when: "p95_latency_ms > 900"
  hold: 3m
  group_by: [region]
  on_fire: [action:notify-ops-channel]
```

**Action** (`action:notify-ops-channel`):

```yaml
apiVersion: plinth/v1
kind: Action
metadata: { slug: notify-ops-channel, title: "Post to the ops channel" }
spec:
  input:
    type: object
    properties:
      message: { type: string, maxLength: 500 }
    required: [message]
    additionalProperties: false
  effects:
    changes: []
    notify: [channel:ops-channel]
  permission: action:notify
  external: false
  handler: notify
```

**Notes on the example.** The panel's `x` is `window_start`, which the tumbling window adds; the line therefore has a temporal `x`, as 3.5 requires. The rule's `when` uses the same field name as the panel's `y`, so the rule and the panel read one query (one `query_hash`). The `group_by: [region]` gives one state machine per region, which is what "any region" means in beat 4. The ops-channel action is not external: the receiver is an internal sink configured in the workspace.

**Acceptance.** AC-EX-1 (the bundle applies in one Change set and the dashboard's `layout.items` resolves to four nodes). AC-EX-2 (the bundle's canonical JSON is byte-identical across two applies). AC-EX-3 (removing `group_by` produces the `pending` state for all regions together, and the rehearsal's beat-4 check refuses that variant).

---

## 3.9 Canonical serialisation and hashing

### 3.9.1 Canonical JSON

Canonical bytes are JSON Canonicalization Scheme (RFC 8785) output, UTF-8, with no insignificant whitespace. **Guarantee.** Consequences: object keys sort by UTF-16 code unit; numbers use the ECMAScript shortest round-trip form; `NaN` and infinities are rejected; `-0` is written as `0`.

### 3.9.2 Scalar normalisation before canonicalisation

- Timestamps: UTC, `Z` suffix, microsecond precision, no trailing fractional zeros beyond the precision needed.
- Durations: integer milliseconds. The literal `15m` is stored as `900000`. The type is known from the schema, so the bare integer is unambiguous.
- Intervals: `{"start": ts, "end": ts}`, with `"relative"` values resolved at the `as_of` before hashing.
- Sets (for example `actions`, `column_mask`, `group_by` when declared as sets): sorted and deduplicated. Sequences (for example `order`, `on_fire`, `layout.items`): order preserved.
- Strings: NFC normalised. Identifiers and slugs are already ASCII.

### 3.9.3 Hash function

SHA-256, rendered as lowercase hexadecimal in the API and as `bytea` in Postgres. **Guarantee.**

### 3.9.4 `body_hash` (node)

`body_hash = sha256(JCS(B))` where `B = {apiVersion, kind, metadata: {id, slug, title, labels}, spec}` after 3.9.2 normalisation. The server-owned fields listed in 3.2 (`revision`, timestamps, `deleted_at`, `owner`, `on_behalf_of`, Grant `status`, `approved_by`, `proposed_by`, Rule and Workflow-instance `state`) are not in `B`. A Grant's `body_hash` therefore covers its declared fields only. Source watermarks and partition lists are excluded. **Guarantee.** A node's `body_hash` is the same on every surface that produced the same logical body (test `commit_equivalence`). Workflow instance and Rule state changes are recorded through `workflow.transitions` and `rule.firings`, not through `body_hash`.

### 3.9.5 Node identifiers

`metadata.id = UUIDv5(PLINTH_NS, UTF-8("<workspace_id>|<Kind>|<slug>"))` at creation, then fixed. `PLINTH_NS` is a constant UUID committed in the repository. **Guarantee.**

### 3.9.6 Query hash, policy hash and result cache key

- `query_hash = sha256(JCS(A))` where `A` is the QueryAst after metric expansion and after replacing each `$name` with its placeholder. Parameter values are not in `query_hash`. **Guarantee.**
- `policy_hash = sha256(JCS({workspace_predicate, row_predicates, column_mask_set, mask_version, grant_index_version}))`, where `row_predicates` is the canonical AST of the row predicate for each source the query reads, for this principal. **Guarantee** (test `cache_isolation`).
- Cache key: `(query_hash, policy_hash, parameter_values, as_of)`, where `parameter_values` is the JCS of resolved parameter values.

### 3.9.7 Result hash

`result_hash = sha256(JCS({columns: [{name, type}], rows}))`, where:

1. Each numeric value is rounded to six significant digits (decimal rounding, round-half-to-even) before canonicalisation. Timestamps are canonical timestamp strings; nulls are `null`.
2. If the query has no `order`, rows are sorted by the JCS of each row before hashing. This makes the hash independent of DuckDB's thread-dependent row order. If the query has an `order`, the order is preserved and is part of the hash.
3. Watermarks, timings and plan details are excluded.

**Guarantee** for the rules; **Target** for stability across machines, measured by `replay_reproduces` with `threads = 1`.

### 3.9.8 Change hash

`change_hash = sha256(JCS({target: <uri>, ops: [...], base_revisions: {<uri>: <int>}}))`. It excludes surface, actor, on-behalf-of, session, idempotency key, `replay_of` and all timestamps, so the same logical change has the same hash whichever surface submitted it. **Guarantee.**

Op shapes (JSON Pointer paths, RFC 6901, within one node body):

```
{op: "create", kind, slug, body}
{op: "set",    path, value}
{op: "remove", path}
{op: "insert", path, id, value, after?}     // list item; id is a stable item id
{op: "move",   path, id, after}             // same id, new position
{op: "delete"}                              // soft delete
```

Lists are keyed by stable item ids, so `insert` and `move` are unambiguous under merge.

### 3.9.9 Chain row hash

`hash_n = sha256(prev_hash_n-1 || JCS(R_n))`, where `R_n` contains: `seq, workspace_id, node_id, base_revision, result_revision, actor_id, on_behalf_of, surface, session_id, change_hash, reason, undo_of, replay_of, contains_untrusted, created_at, virtual_at` (microseconds). The genesis `prev_hash` is 32 zero bytes. The chain is linear per workspace because of the `workspace_chain` head lock (04 D.6). **Guarantee.** `GET /audit/verify` recomputes the chain.

Schema note: the `changes` table gains `replay_of text`, holding `'<transcript_id>:<step>'` (P9; README ruling 6), and `virtual_at timestamptz`. The DDL is owned by 05 section 8.2. The replay driver sets `replay_of` on every replayed row. `replay_of` and `virtual_at` are part of `R_n`, so they are in the hash-chained row itself.

### 3.9.10 Undo

`inverse_ops` is computed at commit from the forward ops and the prior values. Undo appends a Change whose `ops` are the inverse, with `undo_of` set. History is never rewritten. **Guarantee** (test `undo_roundtrip`).

---

## 3.10 Decisions made in this document

Each decision resolves an ambiguity or a gap between the canonical sources. Each is stated once here and used throughout.

- **D-1 Beat 2 is a line panel.** README beat 2 says "A time-series line panel materialises". 04 C.2 says "a bar panel", and its example in D.3 is a bar. The canonical README wins. The beat-2 query is therefore windowed by one-minute tumbling windows and grouped by `window_start` and `region`. The bar form remains a legal visual and is used in the Exec view comparison.
- **D-2 Visual set.** Amendment P1 supersedes 04 B and G.5. Line is demonstrated on stage. Area, scatter, sankey and geo are supported and tested. Lineage graph is demonstrated in the finale.
- **D-3 Panels in a Dashboard.** A Dashboard refers to Panels by reference (V3). The inline `panels:` block is a bundle form expanded at apply into separate Panel nodes named `<dashboard-slug>.<key>`. This keeps Panels as separate nodes, as 04's `node.preview(kind="Panel")` calls require.
- **D-4 Node id derivation** includes the kind. 04 B.1 says "UUIDv5 of workspace and slug", but `UNIQUE (workspace_id, kind, slug)` allows the same slug under two kinds, and the derivation must be injective. The id is fixed at creation so a slug change does not change the URI.
- **D-5 Workflow instances are Workflow nodes** with `instance_of`. 04 says "each instance is a node", and the node kind list has no separate Instance kind.
- **D-6 Canonical form is RFC 8785.** The revised proposal names `canonical(...)` without defining it. Durations are integer milliseconds and timestamps are UTC microseconds, so the canonical form is unambiguous.
- **D-7 Result hashes sort rows** when no `order` is given. 04 requires a deterministic result hash across thread counts; this rule makes it true for unordered queries.
- **D-8 `body_hash` scope.** Revision, timestamps, watermarks and server state are excluded. 04 says watermarks are excluded from hashes and does not say the same of revision; excluding revision is needed so that the same body at a different revision has the same `body_hash`.
- **D-9 Masked references are `UNKNOWN_FIELD`.** 04 says a masked column is a type error. P8 requires that a hidden column and an absent column have the same response shape, so a masked reference uses the absent-field error.
- **D-10 Notification channels are configuration**, not nodes. `channel:<name>` is validated against the configured receiver set. The ops-channel receiver is internal (`external: false`), which is why beat 4's rule commits under R-ACTION-EXTERNAL without approval. Channels are declared in deployment configuration (07).
- **D-11 `external` flag.** `external: true` means egress from the platform boundary. Internal notification sinks are not external. This makes P6's `R-ACTION-EXTERNAL` apply to the cases its name describes.
- **D-12 `query.run(source=...)`** appears in 04 C.2 as a shorthand. The signature in 04 D.7 takes a QueryAst or a URI. The agent writes `from: source:<slug>` and the shorthand is not added to the grammar.
- **D-13 `QUERY_TIMEOUT` for unbounded scans.** 04 D.9 uses `QUERY_TIMEOUT` for an unbounded scan. The closed error list has no separate code, so this document uses that code.
- **D-14 Null handling** for aggregates and comparisons, and the fact that `percentile` ignores nulls, are stated in 3.4.4. 04 does not specify them.
- **D-15 No `having` operator.** The 04 operator list has none; post-aggregate filters are Rule `when` or visual thresholds.
- **D-16 `commit_equivalence` compares** `body_hash` and `change_hash`. Rows across surfaces differ in `surface`, `session_id`, `seq`, `created_at` and the chain row hash. 04's sentence "rows differ only in surface" is read as "differ only in fields that identify the surface, the session and the time".
- **D-17 `replay_of`** is a text column on `changes` holding `'<transcript_id>:<step>'` (P9; README ruling 6). It is hashed in the chain row (`R_n`) and excluded from `change_hash`.
- **D-18 Layout item keys** are `panel` and `form`. 04's example uses `panel`; the `form` key is added for the acknowledge form on the Phone window (beat 9).
- **D-19 `fulfilled_at` equals `delivered_at`.** 04 uses `fulfilled_at - placed_at` as latency without defining the field.
- **D-20 Rule group state.** `group_by` gives one state machine per group key. 04's beat 4 says "any region's p95", which requires per-region state.
- **D-21 Authoring subset of YAML** is the core schema with no tags, anchors or duplicate keys. This prevents `no`/`on` coercion and makes the YAML view and the JSON canonical form agree.

---

## 3.11 Acceptance index

| Id | Area | Check | Label |
|---|---|---|---|
| AC-KIND-1 | Schema | The generated JSON Schema of each kind matches section 3.3 field for field. | Guarantee |
| AC-DASH-1 | Dashboard | Overlapping layout items are refused and both keys are named. | Guarantee |
| AC-DASH-2 | Dashboard | Phone order contains every item once. | Guarantee |
| AC-PANEL-1 | Panel | A timestamp `x` on a bar is `TYPE_MISMATCH`. | Guarantee |
| AC-PANEL-2 | Panel | An unmapped channel key is refused, not dropped. | Guarantee |
| AC-PARAM-1 | Parameter | A default of the wrong type is `TYPE_MISMATCH`. | Guarantee |
| AC-PARAM-2 | Parameter | Session parameter setting creates no Change. | Guarantee |
| AC-RULE-1 | Rule | `hold` shorter than the window is refused. | Guarantee |
| AC-RULE-2 | Rule | `when` on an unknown field is `UNKNOWN_FIELD`. | Guarantee |
| AC-RULE-3 | Rule | A `$` reference in `when` is refused. | Guarantee |
| AC-ACT-1 | Action | An undeclared path is `FORBIDDEN` and named. | Guarantee |
| AC-ACT-2 | Action | `external: true` with `handler: notify` is refused. | Guarantee |
| AC-FORM-1 | Form | An unknown field is `UNKNOWN_FIELD` with `did_you_mean`. | Guarantee |
| AC-FORM-2 | Form | Submission is a `ui` Change by the human. | Guarantee |
| AC-WF-1 | Workflow | An unknown instance state is `UNKNOWN_REFERENCE`. | Guarantee |
| AC-WF-2 | Workflow | A transition the actor lacks permission for is `FORBIDDEN`. | Guarantee |
| AC-GRANT-1 | Grant | A `$` reference in a row predicate is refused. | Guarantee |
| AC-GRANT-2 | Grant | An agent's grant is held and cannot be approved by its delegator. | Guarantee |
| AC-GRANT-3 | Grant | Approval by the finance analyst activates the grant and changes effective counts. | Guarantee |
| AC-METRIC-1 | Metric | A metric cycle is refused with the cycle named. | Guarantee |
| AC-METRIC-2 | Metric | Metric and expanded expression give equal `query_hash`. | Guarantee |
| AC-TPL-1 | Template | A placeholder outside a string position is refused. | Guarantee |
| AC-TPL-2 | Template | An instantiated body passes normal validation. | Guarantee |
| AC-EXP-1 | Export | A masked field in an export query is `UNKNOWN_FIELD`. | Guarantee |
| AC-ANN-1 | Annotation | Injection-like text is returned inside the untrusted envelope and never interpreted. | Guarantee |
| AC-CMT-1 | Comment | An unknown mention is `UNKNOWN_REFERENCE`. | Guarantee |
| AC-SRC-1 | Source | A Change targeting a metadata source is `FORBIDDEN`. | Guarantee |
| AC-SRC-2 | Source | A nullable primary-key field is refused. | Guarantee |
| AC-AS-1 | As-of | `now()` equals the explicit `as_of` across two runs. | Guarantee |
| AC-AS-2 | As-of | A future `as_of` is refused. | Guarantee |
| AC-AS-3 | As-of | An unbounded scan is `QUERY_TIMEOUT` with the hint. | Guarantee |
| AC-AS-4 | As-of | `episode_in_history`: the 14:05 breach and the 13:00 non-breach. | Guarantee |
| AC-VIS-1 | Visual | Each channel accepts its listed types and refuses another. | Guarantee |
| AC-VIS-2 | Visual | Thirteen line series are refused. | Guarantee |
| AC-VIS-3 | Visual | A two-row KPI is refused. | Guarantee |
| AC-VIS-4 | Visual | Lineage nodes equal the distinct edge endpoints. | Guarantee |
| AC-EX-1 | Example | The bundle applies in one Change set and resolves to four nodes. | Guarantee |
| AC-EX-2 | Example | Two applies give byte-identical canonical JSON. | Guarantee |
| AC-EX-3 | Example | Removing `group_by` is caught by the beat-4 check. | Guarantee |
| AC-HASH-1 | Hash | `commit_equivalence` over 1,000 Change sequences and four surfaces: equal `body_hash` and `change_hash`. | Guarantee |
| AC-HASH-2 | Hash | `cache_isolation`: equal row predicates, different masks, different `policy_hash`. | Guarantee |
| AC-HASH-3 | Hash | `undo_roundtrip`: 300 mixed Changes undone, `body_hash` returns to start. | Guarantee |
| AC-HASH-4 | Hash | `replay_reproduces`: equal result and change hashes locally and on staging. | Target until staging exists |
| AC-HASH-5 | Hash | Result hash is independent of thread count for unordered queries, with `threads = 1` and `threads = 4`. | Target |
| AC-HASH-6 | Hash | `lineage_complete`: every expression form in 3.4.4 produces lineage edges. | Guarantee |

**Performance targets (Target, measured by the rehearsal harness, not claimed here).** Percentile aggregate over 2.4 million order rows grouped by region: under 200 ms p95 on a laptop-class machine. Carrier-by-region heatmap over the same rows: under 300 ms p95.

---

## 3.12 Summary of what this document fixes

The node envelope and the fifteen kinds are closed and validated by one schema system. The query grammar is closed, typed and carries an explicit `as_of`. Visual types are closed, each maps columns to channels, and none has private data. The Northwind sources and the six metadata sources have column schemas, and the audit, lineage and workflow tables are read through the same compiler as the landed data. Canonical serialisation is RFC 8785, and each hash in the design is defined over a named canonical object.
