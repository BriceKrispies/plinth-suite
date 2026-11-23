# 03. Authorization and security

Specification for Plinth, covering mission sections 4 (roles, permissions, authorization rules) and 10 (security requirements and threat considerations). Design only: nothing here is built or run.

**Precedence.** `README.md` in this directory (canonical facts), then the amendments P1–P20 in `../selection-rationale.md`, then this document, then `../revised/04-emergent-composition.md`. Where this document adds a decision the sources do not settle, it is listed in section 16.

**Labels.** Every property is marked **Guarantee** (enforced by code and covered by a named test) or **Target** (a design goal, measured in rehearsal before it is claimed).

**Identifiers.** Acceptance criteria are `AC-AUTH-n` (authorization) and `AC-SEC-n` (security). Rule ids are `R-*`. Config keys are dotted and owned by 07 section 14.2.

---

## 1. Principals

Plinth has three principal kinds: `human`, `service` and `agent`. Every request is made by exactly one principal, identified by the token it presents. No request argument, header or query parameter can select a principal.

| Principal (canonical name) | Kind | Role in the demo | Bound to |
|---|---|---|---|
| `user:ops-lead` (Maya Ortiz) | human | Presenter; delegates to the agent; holds `workflow:acknowledge` | OIDC subject |
| `user:emea-lead` (Jonas Becker) | human | Exec view; EMEA-only read on the Ops board | OIDC subject |
| `user:finance-analyst` (Priya Nair) | human | Owns the finance board; the only approver of the agent's grant proposal in the demo | OIDC subject |
| `agent:claude-code` | agent | External MCP client acting `on_behalf_of` `user:ops-lead` | one delegation row |
| `service:replay-driver` | service | Fallback driver (section 10) | service credential |
| `service:rule-worker`, `service:ingest`, `service:gen` | service | Platform workloads | service credential |

**Rules.**

- **Principal id.** `principal_id` is `UUIDv5(workspace namespace, canonical name)`, so a replay in a fresh workspace produces the same ids as the recording. **Guarantee** (test `principal_ids_stable`).
- **Token binding.** A token is bound to one principal at issue time. Stdio and Streamable HTTP transports use the same binding. **Guarantee** (AC-AUTH-1).
- **Disabled principals.** A principal with `disabled_at` set is denied every action with reason `principal_disabled`, including tokens issued earlier. **Guarantee** (AC-AUTH-2).
- **Authority comes from grants only.** Token claims identify a principal; they never grant a permission. The `plinth/roles` claim is ignored by `authorize()`. **Guarantee** (AC-AUTH-3).
- **Agents are created by an administrator** and bound to exactly one human by a `delegation` row. An agent cannot create principals, delegations or its own `max_scope`. **Guarantee** (section 5).
- **Services** each hold their own credential, stored in Secrets Manager on AWS and in the read-only environment file locally. No service shares a credential with another. **Guarantee** (AC-SEC-8).

## 2. Permission vocabulary

The permission names form a closed set. An unknown permission name in a grant or a token is a validation error at write time.

| Permission | Meaning |
|---|---|
| `node:read` | Read a node of the kinds named in the grant's resource pattern. |
| `node:write` | Create or patch a node (Changes through the commit rules, section 6). |
| `node:delete` | Soft-delete a node (rules `R-DELETE-*`). |
| `query:run` | Execute a query over a source. The only read path for data. |
| `source:write` | Platform-internal: ingest and generator only. Never in an agent ceiling. |
| `action:notify` | Run a notification action bound to a registered channel. |
| `action:<name>` | Run a named action from the server-side registry. Names are fixed by the registry, never by a client. |
| `workflow:read` | Read workflow instances and transitions. |
| `workflow:acknowledge` | Apply the `acknowledge` transition to a workflow instance. |
| `approval:decide` | Approve or reject a held Change on the resource. |
| `grant:propose` | Create a held Grant Change (never applied directly). |
| `grant:write` | Approve a held Grant Change on the resource, and undo an approved Grant change (section 7.4). |
| `grant:inspect` | Call `grant.check` for counts and predicates on any principal, on resources the holder can administer (section 8). Inspection only: never approves, applies or undoes a Grant. |
| `ui:present` | Move a screen to a view. Targets only the principal that owns the session (section 5.6). |
| `principal:admin` | Create, disable or change principals and `max_scope`. Administrator only. Never in an agent ceiling. |
| `delegation:admin` | Create or revoke delegation rows. Administrator only. Never in an agent ceiling. |
| `driver:execute` | Submit replayed Changes as `service:replay-driver`. Never in a human or agent grant. |

Resources are node URIs (`plinth://<workspace>/<kind>/<id>`), source names (`orders`, `audit.changes`, and the other sources in the README), and column references (`source.field`). Wildcards are not permitted in actions. Resource patterns are an exact URI, a URI prefix ending in `/`, or a source name.

## 3. Grant semantics

A Grant is a node (kind `Grant`). Its spec is:

```yaml
apiVersion: plinth/v1
kind: Grant
metadata: { id: <uuid>, slug: emea-finance-rows, title: "EMEA rows on finance board" }
spec:
  principal: user:emea-lead
  effect: allow            # allow | deny
  actions: [node:read]     # closed set from section 2; no wildcards
  resource: plinth://northwind/Dashboard/finance-board
  row_predicate: "region = 'EMEA'"   # typed expression AST; null means all rows
  column_mask: []          # column names hidden from the principal
  expires_at: null
  status: active           # active | pending_approval | expired | revoked
```

A Grant only takes effect when its Change has been committed through the commit rules (section 6). A Grant in `status: pending_approval` (a held Change) has no effect on any decision. **Guarantee** (test `pending_grant_inert`: a held grant that would allow a read changes no decision and no `policy_hash`).

**Combination rules.** These are the rules `authorize()` applies. Where the revised proposal is silent, the rule here is a decision (section 16).

1. **No allow, no access.** If no active allow grant matches the principal, action and resource, the decision is `deny` with reason `no_grant`.
2. **Deny overrides allow.** A matching active deny grant for the same action and an overlapping resource denies the request whatever allow grants match. A deny without a `row_predicate` denies the whole resource. **Guarantee** (test `deny_precedence`).
3. **Allow predicates combine by OR.** When several allow grants match on one source, the visible rows are the union of their predicates. A grant without a predicate makes the union total.
4. **Deny predicates subtract.** A deny grant with a `row_predicate` removes the rows it matches from the result: the effective predicate is `(OR of allows) AND NOT (deny predicate)`.
5. **Column masks only restrict.** The masked set is the union of `column_mask` across all matching allow and deny grants. No grant unmasks a column that another matching grant masks. The mask set and its version feed `policy_hash`. **Guarantee** (test `mask_monotone`).
6. **Expiry.** A grant with `expires_at` in the past does not match. Expiry is evaluated at each call, not cached. **Guarantee** (AC-AUTH-5).

**Row predicate injection.** The row predicate of every matching grant is attached to the source relation before any operator (`where`, `derive`, `group`, `join`, `union`), in the order fixed by the query compiler (revised 04, section D.4). A join or union cannot bypass it, because neither operator has a separate read path. The predicate is a typed expression from the query grammar. It is never SQL text from a grant. **Guarantee** for the compiler path (test `rls_differential`, covering joins and unions, in the stack gate). **Target** for performance of predicate injection on the demo dataset.

**Column masks in queries.** A masked column is removed from the projection. A reference to a masked column in a query is reported exactly as a reference to an absent column: `UNKNOWN_FIELD` with the same `available` list that omits the masked name (section 9, AC-AUTH-12). This prevents a masked column's existence from being inferred from the error.

**Policy hash.** The cache key for query results is `(query_hash, policy_hash, parameter_values, as_of)`. `policy_hash` is the hash of the workspace predicate, the canonical row-predicate AST for each source the principal reads, the column-mask set, the mask version and the grant-index version (revised 04, section D.4). Two principals with different effective rows or masks therefore have different keys. The Exec view and the Ops board show their different `policy_hash` values in the panel inspector during the grant beat (P17). **Guarantee** (test `cache_isolation`).

## 4. The single authorization function

Every surface calls one function: the web UI, the HTTP API, the MCP server, the replay driver and the workers (rule evaluation, workflow execution, backtests, scheduled exports and form lookups). No other code path decides access. **Guarantee** (AC-AUTH-6, a static check in the build that fails if any module outside `plinth-authz` reads the grant index or emits a row predicate).

```ts
type Permission = string;            // closed set, section 2
type PrincipalKind = 'human' | 'service' | 'agent';
type Surface = 'ui' | 'api' | 'mcp' | 'driver' | 'system' | 'cli';

interface AuthzRequest {
  principal_id: string;              // taken from the verified token, never from input
  action: Permission;
  resource: NodeUri | SourceName | ColumnRef;
  surface: Surface;
  session_id: string | null;
  change?: { change_hash: string; ops_summary: string[] };  // present for writes
  as_of?: string;                    // ISO-8601, present for reads
}

type CommitRule = { rule_id: string; class: 'auto' | 'approval' | 'refused' };

type Decision =
  | { kind: 'allow';
      row_predicate: PredicateAst | null;
      column_mask: string[];
      grant_ids: string[];           // the grants that matched, in evaluation order
      policy_hash: string;
      commit_rule?: CommitRule[];    // present for writes, section 6
      effective_principal: string }
  | { kind: 'deny';
      reason: DenyReason;            // closed enum below
      policy: string;                // grant id, 'ceiling:<principal>', 'rule:<id>', 'sod', 'principal'
      permission?: Permission;       // the missing permission, if one is named
    };

type DenyReason =
  | 'principal_disabled' | 'delegation_revoked' | 'ceiling_denies' | 'token_scope_denies'
  | 'no_grant' | 'explicit_deny' | 'no_commit_rule' | 'approval_required'
  | 'sod_violation' | 'grant_inspect_required' | 'unknown_resource'
  | 'not_permitted' | 'replay_in_control' | 'not_in_session';

function authorize(req: AuthzRequest, snapshot: AuthzSnapshot): Decision;
```

`AuthzSnapshot` holds the principal rows, the grant index at a `grant_index_version`, the ceiling rows and the commit-rule table. `authorize` is a pure function of its inputs. The same request and snapshot always give the same decision. **Guarantee** (test `authorize_deterministic`, a property test over generated snapshots).

**Evaluation order.** The steps run in this order, and the first failing step returns.

1. Principal exists and is not disabled. Otherwise `principal_disabled`.
2. If the principal is an agent: the delegation is active (`delegation_revoked` otherwise), and the effective set of section 5 is computed for this call.
3. If the resource is unknown or the principal has no grant that could ever touch it, return the same response as an absent resource (`unknown_resource`, section 9).
4. Any matching active deny: `explicit_deny`, naming the grant id.
5. No matching active allow: `no_grant`, naming the permission only.
6. For writes: the commit-rule classification (section 6). A row in the table with class `refused` returns `ceiling_denies` or `no_commit_rule`. A class `approval` returns `approval_required` and the decision carries the rule id.
7. Otherwise `allow`, with the row predicate, column mask and `policy_hash`.

## 5. The agent as a scoped principal

The agent authenticates as its own principal, `agent:claude-code`, and every call it makes is also a call on behalf of its delegator, `user:ops-lead`. Its effective permission set for a call is the intersection of three sets:

1. **Delegator grants.** The active grants of the human named in the delegation, evaluated at the time of the call.
2. **Ceiling.** The agent principal's `max_scope`, set by an administrator. It is stored in `principals.max_scope` and cannot be changed through MCP. Any change is audited with surface `system`.
3. **Token scope.** The scope the MCP token was issued with. It can narrow the set but cannot widen it.

A permission is effective only if it is in all three. **Guarantee** (AC-AUTH-7, a property test over generated grants, ceilings and token scopes: the allow set of the agent is a subset of each of the three).

**Per-call revalidation.** The intersection is evaluated on every call, not at token issue. A narrowed grant or a revoked delegation takes effect on the next call. Tokens are short-lived (config `auth.agent_token_ttl_s`, default 900). **Guarantee** (AC-AUTH-8, tests `delegation_revoked_next_call` and `narrowed_grant_next_call`).

**Token issue.** A request for a token scope that the delegation does not contain is refused at the token endpoint with `FORBIDDEN`, reason `token_scope_denies`. **Guarantee** (AC-AUTH-9).

**Scope containment.** A token scope is contained in the delegator's effective set if every permission in it is an allowed permission of the delegator on the same resource pattern. Containment is checked by the same resource-pattern matching as grants (section 3), so an identifier does not contain a prefix and a prefix contains identifiers beneath it.

### 5.1 Rule ownership (D-W7)

A rule created through MCP has `owner = agent:claude-code` and `on_behalf_of = user:ops-lead`. Each firing runs its `on_fire` actions with effective permissions equal to the intersection of:

- the on-behalf-of human's grants at firing time;
- the agent ceiling at firing time;
- the action's declared permission.

The three inputs and the effective principal are recorded on each `rule.firings` row. A firing that the intersection denies is recorded with its deny reason and produces no notification. **Guarantee** (test `agent_rule_notify`: under the demo ceiling a rule with `action:notify` fires and posts; a rule with an `action:<name>` outside the ceiling is refused at preview with `ceiling_denies`).

### 5.2 Actions run as the invoking principal

A form submit or an `on_click` action runs as the principal that invokes it, not as the principal that authored the form. An agent may author a Form that declares `workflow.acknowledge`, which the agent cannot run itself. The Form preview shows the action's required permission and whether the author holds it. When `user:ops-lead` submits the form on the Phone, the Action runs under `user:ops-lead`, who holds `workflow:acknowledge`. **Guarantee** (test `form_runs_as_submitter`). This is a decision (section 16, item 6).

### 5.3 The demo ceiling

The ceiling is the exact `max_scope` of `agent:claude-code` for the demonstration. It is set by the seed, not by the agent.

| Permission | Ceiling scope | In ceiling |
|---|---|---|
| `node:read` | all kinds in `northwind` | yes |
| `node:write` | kinds `Dashboard`, `Panel`, `Query`, `Rule`, `Form`, `Parameter` | yes |
| `node:write` | kinds `Source`, `Action`, `Grant`, `Template`, `Export`, `Metric` | no |
| `node:delete` | own session nodes only (`R-DELETE-SESSION`) | yes, rule-bound |
| `query:run` | all sources, including `audit.changes`, `lineage.edges`, `workflow.instances`, `workflow.transitions`, `query.runs`, `rule.firings` | yes |
| `source:write` | any | no |
| `action:notify` | registered notification channels only (`ops-channel`) | yes |
| `action:<name>` | any other action | no |
| `workflow:read` | all workflows in `northwind` | yes |
| `workflow:acknowledge` | any | no |
| `approval:decide` | any | no |
| `grant:propose` | all resources in `northwind` | yes |
| `grant:write` | any | no |
| `grant:inspect` | inspection and count access (section 8) | yes |
| `ui:present` | the session's own principal only | yes |
| `principal:admin`, `delegation:admin`, `driver:execute` | any | no |

Two rows need explanation. `grant:inspect` is in the ceiling so that `grant.check` can return before and after counts for `user:emea-lead` in beat 5. It does not include `grant:write`, so the agent can inspect and propose but cannot approve or apply. `ui:present` lets the agent move the session owner's screens, and only those, which is the mechanism behind "the agent's cursor appears on the Ops board".

**Why each beat is within the ceiling.** Beats 2–4 and 6 use `query:run`, `node:write` on `Panel`, `Dashboard` and `Rule`, and `action:notify`. Beat 5 uses `grant:inspect` (counts) and `grant:propose`. Beat 9 creates a `Form` declaring `workflow.acknowledge`, which is within the rule for forms (section 6, `R-FORM-CREATE`) because the submit runs as the human (section 5.2). Beat 11 uses `query:run` on `lineage.edges`, `orders`, `audit.changes` and `workflow.transitions`. Nothing in the script needs a permission outside this table. **Test** `ceiling_covers_script` asserts that every MCP call in the presenter script is allowed under the ceiling for the state at its beat.

## 6. The closed commit-rule table (P6)

Every write by an agent principal is classified by exactly one row of this table. The table is closed: a Change whose ops match no row is refused. Each row has one named test. The rule id is recorded in `changes.policy_rule` and shown on the commit card in the UI (P6).

**Classification.** A multi-op Change is classified by its most restrictive op. It is `auto` only if every op is `auto`. Otherwise the whole Change is held. The Change records the list of rule ids that applied.

**Scope.** The table applies to Changes whose actor is an agent principal, and to replayed Changes that stand in for agent steps (section 10). Rule `R-GRANT` applies to every principal, including humans (section 16, item 14). The other rules do not restrict human Changes, which are authorized by grants alone.

| Rule | Op and target | Class | Condition | Test |
|---|---|---|---|---|
| `R-DASH-CREATE` | create `Dashboard` | auto after preview | `node:write` on `Dashboard` | `commit_rule.R-DASH-CREATE` |
| `R-PANEL-CREATE` | create `Panel` on a dashboard | auto after preview | `node:write` on `Dashboard` and `Panel`; every referenced source readable by `query:run` | `commit_rule.R-PANEL-CREATE` |
| `R-PANEL-EDIT` | replace a Panel's query, visual or title | auto after preview | as `R-PANEL-CREATE` | `commit_rule.R-PANEL-EDIT` |
| `R-LAYOUT` | move or resize a layout item | auto after preview | `node:write` on `Dashboard` | `commit_rule.R-LAYOUT` |
| `R-PARAM-BIND` | create a `Parameter` node, or add or remove a parameter binding | auto after preview | `node:write` on `Parameter` and `Panel` | `commit_rule.R-PARAM-BIND` |
| `R-QUERY-CREATE` | create a `Query` node | auto after preview | `query:run` on every source it references | `commit_rule.R-QUERY-CREATE` |
| `R-RULE-CREATE` | create a `Rule` whose `on_fire` actions are registered channels with `action:notify` | auto after preview | `node:write` on `Rule`; owner intersection (section 5.1) recorded | `commit_rule.R-RULE-CREATE` |
| `R-RULE-THRESHOLD` | replace the threshold of an existing `Rule` | approval | any existing rule | `commit_rule.R-RULE-THRESHOLD` |
| `R-RULE-ACTION` | a `Rule` whose `on_fire` names an action outside `action:notify` | refused (`ceiling_denies`) | always | `commit_rule.R-RULE-ACTION` |
| `R-FORM-CREATE` | create a `Form` whose submit names an action in the registry | auto after preview | `node:write` on `Form`; the action's required permission is shown in the preview | `commit_rule.R-FORM-CREATE` |
| `R-FORM-REBIND` | change the submit action of an existing `Form` | approval | any existing form | `commit_rule.R-FORM-REBIND` |
| `R-GRANT` | create, change, expire or delete any `Grant` node | approval; for an agent, held as `pending_approval` | `grant:propose` for the agent; approval per section 7 | `commit_rule.R-GRANT` |
| `R-GRANT-UNDO` | undo a committed, approved `Grant` change | auto after preview, for `grant:write` holders, with no second approval | section 7.4 | `commit_rule.R-GRANT-UNDO` |
| `R-DELETE-SESSION` | soft-delete a node created by this agent in this session | auto after preview | `node:delete` in ceiling | `commit_rule.R-DELETE-SESSION` |
| `R-DELETE-OTHER` | soft-delete any other node | approval | `node:delete` | `commit_rule.R-DELETE-OTHER` |
| `R-UNDO-OWN` | undo a change made by this agent | auto after preview; base revision checked | none beyond the change's own check | `commit_rule.R-UNDO-OWN` |
| `R-UNDO-FOREIGN` | undo a change made by another principal | approval | `node:write` on the same paths | `commit_rule.R-UNDO-FOREIGN` |
| `R-ACTION-EXTERNAL` | an agent-initiated action run, or any change to a notification channel | approval, every time | none; never auto | `commit_rule.R-ACTION-EXTERNAL` |
| `R-PRINCIPAL` | any change to principals, `max_scope`, delegations | refused (`ceiling_denies`) | always | `commit_rule.R-PRINCIPAL` |
| `R-SOURCE` | any change to a `Source`, or to the action registry | refused (`ceiling_denies`) | always; humans use administrator tooling | `commit_rule.R-SOURCE` |
| `R-NO-MATCH` | no row above matches | refused (`no_commit_rule`) | the fallback | `commit_rule.R-NO-MATCH` |

**Notes on the table.**

- A rule firing is not an agent Change. When `service:rule-worker` runs `notify` for a firing, it is classified by section 5.1 and by the registered-channel rule, not by `R-ACTION-EXTERNAL`. This is what allows beat 8 to post to `ops-channel` with nobody approving the firing.
- `R-ACTION-EXTERNAL` governs a different act: an agent asking for a run now, or changing where notifications go. Registering a channel is an administrator act.
- Ops channels are registered in the workspace configuration before the demo (`notify.channels`). Their URLs are not visible to any agent-authored node.

**Tests for the table itself.**

- `commit_rule_table_closed` (AC-AUTH-10): for generated Changes, the classifier returns exactly one row or the `R-NO-MATCH` fallback, never two rows and never none. The table has one row id per test.
- `commit_rule_card_shows_rule` (AC-AUTH-11): every agent commit in the rehearsal has a `policy_rule` value that the commit card displays.

## 7. Approval and separation of duties (P7)

### 7.1 Held Change lifecycle

A held Change moves through this state machine. The state is stored on the Change, and the approval is a row in `change_approvals`.

```
proposed --(classify = approval)--> pending_approval --approve--> approved --commit--> committed
                                         |   \
                                         |    reject --> rejected
                                         |    withdraw (requester) --> withdrawn
                                         +--(ttl elapsed)--> expired
approved --(base revision moved and paths intersect)--> stale   (re-propose required)
```

- `approval.ttl_s` (default 900) bounds how long a Change stays `pending_approval`.
- An approval is bound to `change_hash`. A change to the content of the Change invalidates it.
- A base revision that moved on paths the Change touches sets the Change to `stale`. The approver is shown the conflicting paths and must re-propose. Approval does not rebase silently. **Guarantee** (AC-AUTH-13).
- The agent learns the state from `change.status(change_id)`, read-only, which returns the Change's state from the machine in section 7.1 together with the approver (P11). **Guarantee** (AC-AUTH-14).

### 7.2 Separation of duties

An approver of a held Change must satisfy all of these. Each failed condition returns `FORBIDDEN` with reason `sod_violation` or `approval_required`, and the policy names the condition.

1. The approver is `human`. Agents, services and the replay driver cannot approve.
2. The approver is not the change's actor.
3. The approver is not the change's `on_behalf_of` principal, and is not the delegator of an agent actor.
4. The approver holds `approval:decide` on the target resource.
5. For a Grant change, the approver also holds `grant:write` on the target resource.

In the demo, the agent is the actor, `user:ops-lead` is the delegator, and `user:finance-analyst` is the only human who holds `grant:write` on the finance board. Priya's approval is therefore the only path that succeeds. **Guarantee** (tests `sod_requester_cannot_approve`, `sod_delegator_cannot_approve`, `sod_agent_cannot_approve`, `sod_driver_cannot_approve`, `approver_needs_grant_write`; AC-AUTH-15 and AC-AUTH-16).

### 7.3 Visibility of the decision

On approval the decision records the approver's principal id and display name. The finance board's pending card and the audit row show "approved by Priya Nair" with the approver's principal. The approval card shows the target, the diff, the before and after counts (section 8), and the rule id. **Guarantee** (AC-AUTH-17).

### 7.4 Undo of an approved grant

Beat 7 has the presenter click Undo on the grant change in the audit panel. This is a decision with a security cost, and it is stated here rather than hidden.

- An undo of an approved Grant change is classed `R-GRANT-UNDO`. It is allowed to a principal with `grant:write` on the resource, is auto after preview with no second approval, and is not subject to section 7.2, because it reverses an approved change rather than creating a new grant.
- An undo that **widens** access (restores rows, removes a mask) emits a `grant.widened` audit event, and a notification to every holder of `grant:write` on the resource. The original approver remains recorded on the original change.
- The undo is an ordinary Change with `undo_of` set. **Guarantee** (AC-AUTH-18, test `grant_undo_widens_audited`).
- Residual risk: a holder of `grant:write` can widen access without a second approval. This is accepted for the demo because the widening is attributed, notified and reversible. It is listed in section 16 for the owner to confirm.

## 8. Bounding `grant.check` (P8)

`grant.check` answers "who can see this, and what changes if...". Without bounds it is a row-count oracle over other principals. The bounds are:

| Caller relation to the target principal | Counts (`with_counts`) | Permissions | Response when not permitted |
|---|---|---|---|
| target is the caller | returned | none beyond `node:read` on the resource | not applicable |
| target is the caller's delegator | returned | none beyond `node:read` on the resource | not applicable |
| any other principal | returned only with `grant:inspect` on the resource | `grant:inspect` | identical shape with `row_counts: null` and `reason_code: "not_permitted"` |
| target principal does not exist | not returned | none | identical shape to the not-permitted response |

**Shape constancy.** The response has the same keys whether the target does not exist, the caller may not inspect it, or the counts are withheld: `{ principal, resource, action, decision, reason_code, policy, row_counts }`. Only the values of `reason_code` and `row_counts` vary, and `reason_code` is drawn from the closed `DenyReason` enum. **Guarantee** (AC-AUTH-19, test `grant_check_shape_constant`).

**Hidden columns.** A masked column and an absent column return the same shape: `{ "column": "<name>", "visible": false }`. A column that is visible returns `{ "column": "<name>", "visible": true, ... }`. **Guarantee** (test `masked_absent_same_shape`).

**Proposed grants.** `grant.check` with `proposed` evaluates the proposed grant with the same compiler, without writing it. The bounds above apply to the counts it returns. **Guarantee** (AC-AUTH-19).

**Explanations come from the decision (P16).** `grant.check` returns the grants, predicates and masks from the same `authorize()` evaluation that governs the query. There is no second explanation path that could disagree.

## 9. Denials, error codes and what they may reveal (P16)

**Denials name the policy, never the value.** A denial carries a policy id: a grant id, `ceiling:<principal>`, a rule id, `sod`, `principal` or `delegation`. It never carries a value that a predicate matched, a row count the caller cannot see, a masked value, or the existence of a node the caller cannot read. **Guarantee** (test `denial_no_value_leak`: random predicates and values are generated, and no error or denial text contains a value from a row the principal cannot see).

**Messages are templates.** Denial and error messages come from fixed templates keyed by code. Template slots take only schema facts: field names, permission names, grant ids, rule ids, paths. Data values never enter a message. **Guarantee** (test `messages_from_templates`, a static check on the error module plus the value fuzz above).

**Unreadable is unknown.** A node the principal cannot read returns `UNKNOWN_REFERENCE`, identical to a node that does not exist, unless the principal holds `node:read` on it but a grant denies the specific action. In that case the response is `FORBIDDEN` naming the permission and the policy. **Guarantee** (AC-AUTH-12).

**Closed error codes for authorization.** The closed set is the 15-code enum in 06 section 3 (README ruling 9). The table lists the codes that authorization produces.

| Code | Used for | Details fields |
|---|---|---|
| `FORBIDDEN` | explicit deny, no grant on an existing readable resource, ceiling, token scope, SoD, approval required | `permission`, `policy`, `reason` (a `DenyReason`) |
| `UNKNOWN_REFERENCE` | absent or unreadable node or source | `available` (names the caller can read, paged) |
| `UNKNOWN_FIELD` | absent or masked column | `available` (omits masked names), `did_you_mean` (omits masked names) |
| `PREVIEW_REQUIRED`, `PREVIEW_STALE` | token missing, spent, expired or for another principal; base moved | `fix` |
| `CONFLICT` | intersecting paths on commit | `conflicting_paths`, head values at those paths |
| `IDEMPOTENCY_KEY_REUSED` | same key, different request hash, same principal | `original_change_seq` |
| `RATE_LIMITED` | bucket empty | `retry_after_s` |
| `QUERY_TIMEOUT`, `SOURCE_STALE` | budget or watermark | `watermark` for `SOURCE_STALE` |
| `LOOP_SUSPECTED` | the fourth identical refused call within 30 s; that call is not executed (06 section 2) | `next` suggests `catalog`-style discovery |

Example denial, exact fields:

```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "path": "/approval/decision",
    "message": "Permission grant:write is not held by agent:claude-code on this resource.",
    "details": { "permission": "grant:write", "policy": "ceiling:agent:claude-code", "reason": "ceiling_denies" },
    "retryable": false
  },
  "next": [{ "tool": "change.status", "why": "a Grant change is approved only by a human approver with approval:decide and grant:write; it stays pending_approval" }]
}
```

Envelope: P5 (`ok`, `data` or `error`, `next`, `warnings`, `budget`). The envelope itself is specified in `06-mcp-server.md`.

## 10. The replay driver principal (P9)

`service:replay-driver` executes recorded steps. It is a principal in its own right, and it never uses the presenter's session.

**Identity and credential.**

- Its credential is `driver.credential` in Secrets Manager (AWS) or the read-only environment file (local). It is distinct from every human and agent credential. **Guarantee** (AC-AUTH-20).
- Its `max_scope` is fixed by the seed. It never holds `grant:write`, `approval:decide`, `grant:inspect`, `principal:admin`, `delegation:admin` or `ui:present` on any session other than its own. It holds `driver:execute`, and for each step the recorded principal's effective permissions, evaluated as that principal with `on_behalf_of` (README ruling 16).

**Execution.**

- A recorded Change made by a human is submitted with `on_behalf_of` set to the recorded human. A recorded Change made by the agent is submitted with `on_behalf_of` set to `user:ops-lead`, the agent's delegator.
- The effective permission set is the intersection of the recorded human's grants at replay time, the driver's `max_scope`, and a per-step token scope. The per-step token scope is the minimal permission set the step needs, taken from the transcript. **Guarantee** (AC-AUTH-21, test `driver_intersection`).
- If `authorize` denies a replayed Change, the driver halts and reports on the presenter console. It does not retry with broader scope. **Guarantee** (test `driver_halts_on_deny`).

**What the driver never does.**

- It never approves. Priya's approval in beat 5 is a live human action in her window. A replayed step that reaches an approval waits for that action, and the presenter console says so. **Guarantee** (test `driver_never_approves`). This resolves a conflict with revised 04 section C.3, which had human steps performed under the presenter's session (section 16, item 5).
- It never uses `user:ops-lead`'s session token or cookie. The token subject of every driver request is `service:replay-driver`. **Guarantee** (test `driver_never_uses_presenter_session`).

**Audit.**

- Every replayed Change row has `surface = 'driver'`, and a `replay_of` value of the form `<transcript_id>:<step>`, with the recorded `change_hash` of the step in `replay_change_hash` (05 section 8.2). `replay_of` is in the row's `hash` and is not in `change_hash`, so the logical change still has the same hash as the live one (revised 04, section D.6). **Guarantee** (test `replay_row_marked`).
- Replay commit keys are `replay:<transcript>:<step>`, scoped to `service:replay-driver` by the idempotency primary key. They cannot collide with a live agent's keys. **Guarantee** (test `replay_keys_scoped`).

**Takeover.** The driver's skip rule is by satisfaction predicate (P10), not by revision or key. The driver never inverts another principal's change. The authorization rules here apply to every step it issues, including steps it issues after takeover.

## 11. Presenter control and fault console isolation (P15)

The fault cue (F7) and the presenter console's other controls are not agent capabilities. They are reachable only on a separate listener, with a separate credential, and they are absent from the agent's tool list and from every grant.

**Listener and credential.**

- The control API listens on the presenter-control port (`PLINTH_PRESENTER_PORT`; owner 07 section 14.2). It is bound to loopback locally, and to a security group admitting only the presenter console's subnet on AWS. It is never behind the ALB that serves the MCP server or the main API. **Guarantee** (AC-SEC-1).
- Its bearer token is `plinth/presenter-control` in Secrets Manager (AWS) or the environment file (local). OIDC tokens and agent tokens are rejected on this port. **Guarantee** (test `control_port_rejects_mcp_token`, `mcp_port_rejects_control_token`).

**Endpoints.** `POST /control/fault/cue` (F7), `POST /control/driver/mode` (F9), `POST /control/driver/step` (run from step n), `GET /control/driver/status`, `POST /control/clock` (pause, resume, rate), `GET /control/status`. None of these is registered on the MCP router or the main API router.

**Absence.**

- `tools/list` for every principal excludes every control operation. **Guarantee** (test `fault_absent_from_tool_list`).
- The permission registry (section 2) contains no fault or control permission, and no grant in the seed references one. A static check over the seed and the registry enforces this. **Guarantee** (test `fault_absent_from_grants`).

**Recording.** A cue is not a node Change, so it is not written to `changes`. It is written to `fault_cues`, a table with its own hash chain per workspace (`prev_hash`, `hash`), recording the cue id, the requested tick, the applied tick, the profile id and `requested_by = 'presenter-console'`. The audit view joins `fault_cues` with `changes`. **Guarantee** (AC-SEC-2).

**One active cue.** A second cue while a profile is active returns HTTP 409 with the closed code `CONFLICT` and `details.reason` `fault_already_active` (06 section 3). The presenter console shows the active profile. **Guarantee** (test `single_active_fault`).

## 12. Untrusted data and prompt injection (P14)

### 12.1 Structural wrapping

Order notes, carrier messages, comments, annotations, titles, labels, workflow notes and audit `reason` text can be written by anyone. Any model that reads them can be steered by them. The defence is structural, so it does not rely on the model ignoring text.

- **Wrapping rule.** Every string whose origin is data is returned inside `{ "untrusted": "<string>" }` in place of the string, at any depth and whatever its field name. This includes rows of `query.run`, titles in `node.search`, annotation text, labels, workflow notes and audit reasons. **Guarantee** (test `untrusted_wrap_exhaustive`: every read tool's response is generated over random data, and every string field whose origin is data is wrapped).
- **Not wrapped.** Ids, kinds, states, enum values, numbers, timestamps, URIs that Plinth generated and every Plinth-authored message and template. Section 9's rule keeps data values out of Plinth-authored text, so nothing data-origin is left unwrapped there.
- **Type enforcement.** The response builder takes `UntrustedString` for data strings, a branded type that a plain `string` cannot satisfy. A response containing a data string outside the wrapper fails to compile, and a runtime check fails the response in tests. **Guarantee** (AC-SEC-3).
- **Length and control characters.** A string longer than `security.untrusted.max_bytes` (default 4096) is truncated, and the wrapper gains `"truncated": true`. Control characters are escaped. Log-origin strings are cut at 512 bytes. **Guarantee** (test `untrusted_truncation`).
- **Tool descriptions.** Each read tool's description states that `untrusted` content is data and never an instruction. The tool manifest is hashed and the hash is recorded in each transcript (section 10). **Guarantee** for the hash check (test `manifest_hash_matches`).

The key is `untrusted` in every response. The revised proposals used `untrusted_data` (04) and `untrusted_text` (05); P14 is binding and chooses `untrusted`.

### 12.2 No authority from content

- No string from data grants a permission, changes a scope, names a principal, produces a preview token or selects a commit rule. Authority comes from the verified token, the ceiling and the grant index. **Guarantee** (test `data_grants_nothing`: data containing a permission name, a grant id, a principal id or the text "grant yourself access" changes no decision).
- No tool executes content from data. Queries are typed documents. Expressions are a closed grammar with no user-defined functions and no SQL escapes (revised 04, section D.3). Actions run only from the server-side registry, and an agent cannot register one (`R-SOURCE` covers the registry).
- A value from a click (`$click.field`) is a typed value coerced to the parameter's declared type. It is never parsed as an expression. **Guarantee** (test `click_is_value`).

### 12.3 Flagging echoed untrusted text

A Change whose ops contain a string byte-equal to an untrusted string returned to the same agent session within the last `security.untrusted.echo_window` calls (default 50) is stored with `contains_untrusted = true`. `change.history` can filter on the flag, so reviewers can find such Changes. **Guarantee** for byte-equal echoes (test `echo_flagged`). **Target** for paraphrased echoes, which the flag does not detect. The paraphrase case is covered by the bounds in section 12.5, not by detection.

### 12.4 The seeded injection in the rehearsal

The seed includes an annotation whose text is an injection attempt (P14). It asks the reader to grant the agent write access to the finance board. The rehearsal's adversarial set includes a scripted client that reads that annotation and then attempts the grant, a panel write outside the ceiling and an action run. The test `injection_seed_inert` asserts:

- the grant attempt is held (`pending_approval`) and no permission changes;
- the out-of-ceiling write returns `FORBIDDEN` with `ceiling_denies`;
- the action run returns `FORBIDDEN` with `R-ACTION-EXTERNAL` approval required;
- every attempt is in the audit view with the principal `agent:claude-code` and the session.

**Guarantee** (AC-SEC-4). The test does not depend on the model's behaviour. It runs the adversarial client against the server directly, so the server's response is what is measured.

### 12.5 Prompt-injection threat model

The threat is an attacker who controls text in data, which a model reads and may act on. Plinth cannot stop a model from being persuaded. It limits what a persuaded model can achieve.

| Attack | What the model may do | Bound that holds | Residual risk |
|---|---|---|---|
| Instruction in data causes an in-ceiling write (a panel retitled, a layout moved) | Propose a commit under `R-PANEL-*` or `R-LAYOUT` (auto after preview) | Attribution on the commit card, audit row, undo (`R-UNDO-OWN`), realtime visibility on every screen | Accepted. The write is visible and reversible. |
| Instruction in data causes a threshold change, a new rule or a form rebind | Propose; `R-RULE-THRESHOLD`, `R-FORM-REBIND`, `R-RULE-CREATE` are approval or auto with channel limits | Approval for threshold and rebind; channels are pre-registered, so a new destination cannot be created | Accepted for `R-RULE-CREATE` with a registered channel: the agent can alert the channel more often. Bounded by the channel's own rate limit. |
| Instruction in data asks for a grant | Propose a Grant | `R-GRANT` held; approver must be a human who is not the delegator (section 7.2) | None for access: nothing is applied. |
| Instruction in data asks for an action run or a new channel | Request a run | `R-ACTION-EXTERNAL` approval every time; channels are administrator-registered | None for effects: nothing runs. |
| Instruction in data asks the agent to reveal rows | Read rows within the ceiling and grants, then state them in its reply | Row predicates and masks apply at source; the agent cannot read a row its grants exclude | Residual: rows the agent is allowed to read can be disclosed in its reply. Measured in rehearsal as the seeded case. |
| Instruction in data asks the agent to call a tool the agent does not have | Attempt the call | Server refusal, independent of the model; `LOOP_SUSPECTED` on the fourth identical refusal | None. |
| Tool poisoning through descriptions | Follow a changed description | Descriptions are Plinth-authored and fixed by the manifest; the hash is recorded in transcripts and checked in rehearsal | Residual only if the build pipeline is compromised. Covered by SR-5 (signed images). |
| Confused deputy through a rule firing | A rule owned by the agent runs on a human's behalf | Owner intersection (section 5.1), recorded on the firing | None beyond the intersection. |

**Known limitation.** A model that reads the envelope and still proposes a harmful in-ceiling change is limited by its ceiling, by the commit rules, by approval and by the audit trail. That is the protection a manipulated human operator would have. The model layer is advisory and this is stated as a limitation, not a claim (revised 04, section G.5).

---

## 13. Security requirements (mission section 10)

Each requirement is a **Guarantee** unless it is marked **Target**.

| ID | Requirement | Label | Verification |
|---|---|---|---|
| SR-1 | Every principal authenticates with OIDC (humans, via authorization code with PKCE), client credentials (agents and services), or the presenter-control token (control port only). | Guarantee | `auth_matrix` (section 14) |
| SR-2 | HTTP and WebSocket endpoints check the `Origin` header against an allowlist. UI sessions use HttpOnly cookies with `SameSite=Strict`, `Secure` on AWS, and a CSRF token on every state-changing request. | Guarantee | `origin_check`, `csrf_required` |
| SR-3 | Secrets never appear in images, transcripts, audit arguments or logs. Token-shaped strings in audit arguments are redacted before storage. | Guarantee | `secret_scan` over images, transcripts and audit rows |
| SR-4 | The audit chain is verified on demand (`GET /audit/verify`) and at startup, and a broken chain is shown on the status page. External anchoring of the head hash is out of demo scope. | Guarantee for verification; Target for external anchoring | `audit_chain_detects_edit` |
| SR-5 | Images are digest-pinned, signed and carry an SBOM, and the same digests run locally and on AWS. | Guarantee | `digest_pinned`, `image_signed` in the deployment gate |
| SR-6 | Token buckets per principal and per tool (revised 04, section D.9). Agent defaults are set in config, and `RATE_LIMITED` returns `retry_after_s`. | Guarantee | `rate_limit_per_principal` |
| SR-7 | Injection hardening as section 12. | Guarantee for the structural controls; Target for detection of paraphrased echoes | section 12 tests |
| SR-8 | Each service principal has its own credential and the least grants it needs. `service:rule-worker` cannot write grants or approve. | Guarantee | `service_least_privilege` |
| SR-9 | Logs escape control characters and cut data-origin strings to the log limit. | Guarantee | `log_escape` |
| SR-10 | Every query carries the workspace predicate, and a principal is bound to one workspace. Cross-workspace queries are not supported. | Guarantee | `workspace_isolation` |
| SR-11 | Local identity uses a Keycloak realm export. The demo passwords in the export are replaced at `make up` and never exposed beyond loopback. | Guarantee for replacement; loopback binding is the default | `local_creds_rotated` |
| SR-12 | Denials and counts are bounded as sections 8 and 9. | Guarantee | `denial_no_value_leak`, `grant_check_shape_constant` |
| SR-13 | Replay cannot impersonate a human or approve (section 10). | Guarantee | `driver_never_approves`, `driver_never_uses_presenter_session` |
| SR-14 | Preview tokens are 256-bit random values, stored hashed in `preview_tokens`, bound to principal, `change_hash` and base revisions, consumed in the commit transaction, and expire after `preview.ttl_s` (default 300). | Guarantee | `token_single_use_concurrent`, `preview_is_commit` (revised 04, claim 3) |
| SR-15 | Commit and idempotency records are keyed by principal, so one principal's key cannot collide with another's. | Guarantee | `idempotency_principal_scoped` |

---

## 14. Threat table (STRIDE)

| # | Category | Threat | Control | Test | Label |
|---|---|---|---|---|---|
| T1 | Spoofing | Agent presents as the presenter to act with the presenter's rights | Token bound to principal; agent ceiling; no principal argument (AC-AUTH-1) | `token_binding` | Guarantee |
| T2 | Spoofing | Replay driver acts as the presenter | Own credential; never uses presenter session (section 10) | `driver_never_uses_presenter_session` | Guarantee |
| T3 | Spoofing | Presenter console cue forged by an MCP client | Separate port and credential; not in tool list (section 11) | `control_port_rejects_mcp_token` | Guarantee |
| T4 | Tampering | Agent writes a grant to widen its own access | `R-GRANT` held; SoD; ceiling excludes `grant:write` | `commit_rule.R-GRANT`, `sod_*` | Guarantee |
| T5 | Tampering | Changed history in the audit chain | Hash chain per workspace; verify on demand and at startup | `audit_chain_detects_edit` | Guarantee (detection); Target (anchoring) |
| T6 | Tampering | Stale base overwrites a human's edit | Base revision checks; `CONFLICT` on intersecting paths | `chain_linear_under_concurrency` (revised 04) | Guarantee |
| T7 | Tampering | Preview token reused or stolen | Principal-bound, single-use, hashed, expiring (SR-14) | `token_single_use_concurrent` | Guarantee |
| T8 | Repudiation | A change without an accountable actor | Actor, on-behalf-of, surface and session on every row; agents cannot write without attribution | `attribution_complete` | Guarantee |
| T9 | Repudiation | Replayed change mistaken for live | `surface = 'driver'` and `replay_of` in the row hash | `replay_row_marked` | Guarantee |
| T10 | Information disclosure | Row-count oracle over another principal | `grant.check` bounds (section 8) | `grant_check_shape_constant` | Guarantee |
| T11 | Information disclosure | Masked value inferred from an error | Masked names omitted from `available` and `did_you_mean`; same shape as absent (section 3) | `masked_absent_same_shape` | Guarantee |
| T12 | Information disclosure | Cross-principal result leak through the cache | `policy_hash` in the key (section 3) | `cache_isolation` | Guarantee |
| T13 | Information disclosure | Secrets in transcripts or logs | Redaction; secret scan (SR-3) | `secret_scan` | Guarantee |
| T14 | Information disclosure | Injected instruction makes the agent reveal rows its grants exclude | Predicates and masks at source; server refusal (section 12.5) | `rls_differential` | Guarantee for the server path; residual for disclosure within grants |
| T15 | Denial of service | Agent loop floods the query engine | Token buckets; `query.run` cost weight; `LOOP_SUSPECTED`; `QUERY_TIMEOUT` | `rate_limit_per_principal`, `loop_suspected` | Guarantee |
| T16 | Denial of service | Expensive query without a time window | Refused with `QUERY_TIMEOUT` and a window hint | `unbounded_query_refused` | Guarantee |
| T17 | Denial of service | Presence storm on reconnect | Presence throttled to 5 updates per second per node (revised 04, section D.6) | `presence_throttle` | Guarantee |
| T18 | Elevation of privilege | Agent calls an action outside the ceiling | Intersection; closed registry; `R-ACTION-EXTERNAL` | `ceiling_covers_script`, `commit_rule.R-ACTION-EXTERNAL` | Guarantee |
| T19 | Elevation of privilege | Rule firing runs with more authority than its owner has | Owner intersection recorded on each firing (section 5.1) | `agent_rule_notify` | Guarantee |
| T20 | Elevation of privilege | Undo widens access without a second approval | Accepted; attributed and notified (section 7.4) | `grant_undo_widens_audited` | Accepted residual risk |
| T21 | Elevation of privilege | Agent registers a notification destination | Channels are administrator-registered; `R-ACTION-EXTERNAL` | `commit_rule.R-ACTION-EXTERNAL` | Guarantee |
| T22 | Elevation of privilege | Agent approves its own proposal through the delegator | SoD condition 3 (section 7.2) | `sod_delegator_cannot_approve` | Guarantee |
| T23 | Elevation of privilege | Cross-workspace access | Workspace predicate on every query; principal bound to one workspace (SR-10) | `workspace_isolation` | Guarantee |

---

## 15. Permission matrix test design

The matrix test checks `authorize()` against expected decisions written by hand. Expected values are not generated from the implementation, so the test cannot agree with a bug by construction.

**Fixture.** `plinth-authz/fixtures/matrix.yaml`, one entry per cell: principal, action, resource, surface, state reference, expected decision (`allow` with predicate and mask, or `deny` with reason). The expected values come from the seed in section 5.3 and the human grants below.

**Principals (8).** `user:ops-lead`, `user:emea-lead`, `user:finance-analyst`, `agent:claude-code`, `service:replay-driver`, `service:rule-worker`, `service:ingest`, `service:gen`.

**Resource classes.** The Ops board, the finance board, the Exec view's panels, `orders`, `audit.changes`, a `Grant` node on the finance board, a workflow instance, a `Rule` on the Ops board, a `Form` on an incident card, and the presenter control endpoints (which are not in the matrix for the agent or the human principals, and whose absence is asserted instead).

**Actions.** The full closed set in section 2, minus the control permissions, which are asserted absent.

**Human grants in the seed (the expected values).**

- `user:ops-lead`: `node:read`, `node:write` on the Ops board; `query:run` on all sources; `action:notify`; `workflow:read`; `workflow:acknowledge`; `ui:present` on own screens; `grant:inspect` workspace-wide (section 16, item 2).
- `user:emea-lead`: `node:read` on the finance board with no predicate; `node:read` on the Ops board with `region = 'EMEA'`; `query:run` on `orders` (inherits the Ops board predicate only through the panel's own grant, see below).
- `user:finance-analyst`: `node:read` and `node:write` on the finance board; `approval:decide` and `grant:write` on the finance board; `query:run` on `orders`, `audit.changes`.
- Services: as section 10 and the platform workloads.

**Matrix size.** The matrix size is computed at build and reported with the test run. It is a measured count, not a target.

**Properties** (property tests over generated states, run in the stack gate, not per change):

- **Deny monotonicity.** Adding a deny grant never converts a deny into an allow. **Guarantee** (`prop_deny_monotone`).
- **Allow monotonicity outside denies.** Adding an allow grant never removes an allow, unless a deny applies. **Guarantee** (`prop_allow_monotone`).
- **Agent containment.** For every generated state, the agent's allow set is a subset of each of ceiling, token scope and delegator effective set. **Guarantee** (`prop_agent_contained`).
- **Mask monotonicity.** Adding a mask never unmasks a column. **Guarantee** (`mask_monotone`).
- **Determinism.** The same request and snapshot give the same decision. **Guarantee** (`authorize_deterministic`).
- **Revocation latency.** A revocation or narrowing takes effect on the next call, for generated delegations. **Guarantee** (`delegation_revoked_next_call`).

**Surface parity.** The same matrix runs through the UI API, the HTTP API, the MCP server and the driver. Each surface must return the same `Decision`, differing only in `surface`. **Guarantee** (AC-AUTH-22, `surface_parity`).

**Negative fixtures.** Every row of the commit-rule table and every SoD condition has at least one fixture in which the rule must fail. A rule with only positive fixtures fails the build. **Guarantee** (AC-AUTH-23, the meta-test `negative_fixture_per_rule`).

**Scope of runs.** Authorization tests run in the stack gate. Agents building the change run only the compile check and lint for the files they touched (section 16, item 19 records the cadence decision as inherited from the team's standing rules).

---

## 16. Decisions and ambiguities

Each item is a point where the sources are silent, conflict, or where this document chooses a side. The owner of the README confirms or overrides each one.

1. **Counts for `user:emea-lead` in beat 5.** P8 requires a permission for counts about another principal. The ceiling includes `grant:inspect` (counts and inspection only), as README ruling 1 settles. Chosen: include it.
2. **`grant:inspect` for `user:ops-lead`.** Beat 5's counts must be permitted by the intersection, so Maya holds `grant:inspect` workspace-wide. Priya remains the only approver.
3. **Beat 7 undo widens access.** Undo of an approved grant needs no second approval (section 7.4). Chosen as stated, with notification and audit. Needs owner confirmation; README resolved decision 4 records the same rule.
4. **Agent grant commit wording.** Revised 04 section G.2 says the agent gets `FORBIDDEN` naming `grant:write` when it commits a grant. This document makes the agent's commit of a Grant return `pending_approval` (held), which is the behaviour the script describes ("the agent cannot commit it"), and reserves `FORBIDDEN` naming `grant:write` for attempts to approve or force-apply. The G.2 row should be reworded to match.
5. **Replay and the approval step.** Revised 04 section C.3 performs human steps under the presenter's session. P9 forbids the driver from using the presenter's session. This document resolves it by making approval a live human action that the driver never performs (section 10). Beat 5 therefore waits for Priya's click even in replay.
6. **Form actions run as the submitter.** A form's action runs as the principal who submits it (section 5.2). Not stated in revised 04.
7. **Row predicate combination.** Allows combine by OR and denies subtract (section 3). Revised 04 is silent.
8. **Column masks and masked references.** Masks are a union and only restrict. A masked reference is `UNKNOWN_FIELD` (section 3), so it has the shape of an absent column.
9. **Error codes.** The closed set is the 15-code enum in 06 section 3 (README ruling 9), which includes `LOOP_SUSPECTED`. Hidden nodes return `UNKNOWN_REFERENCE`. The `E_*` names in revised 05 and 06 are not used.
10. **Untrusted key.** P14 is binding: `untrusted`. Revised 04 used `untrusted_data`, revised 05 `untrusted_text`.
11. **Agent token lifetime.** `auth.agent_token_ttl_s` defaults to 900. Revised 06 used 15 minutes for one design and 3600 seconds for another; the lower value is chosen because revalidation is per call.
12. **Node kinds.** The README lists fifteen kinds. Revised 04 section D.3 lists thirteen. This document uses the README's fifteen, and the ceiling table names only kinds that appear in the README.
13. **Tool count.** The README and P11 give fifteen tools. Revised 04's body text says fourteen in places. This document does not count tools; it names `change.status` and `ui.present` where they are needed.
14. **Scope of `R-GRANT`.** It applies to every principal. A human who proposes a grant to themselves is also held.
15. **Multi-op classification.** A Change is auto only if every op is auto (taken from revised 06, section D.5.4). Rule ids are recorded as a list.
16. **Fault cues.** Cues are recorded in a separate hash-chained `fault_cues` table, because a cue is not a node Change (section 11).
17. **`principal_id`.** UUIDv5 of the canonical name (section 1). Revised 04 used an unspecified uuid.
18. **`replay_of` column.** Added to `changes`: a text value `'<transcript_id>:<step>'` (05 section 8.2), included in `hash` and excluded from `change_hash` (section 10). The recorded `change_hash` is held in `replay_change_hash`.
19. **Test cadence.** Authorization suites run in the stack gate, not per change, following the team's standing rule.
20. **Identity provider.** Local is Keycloak, as in the README. Revised 06's Dex is not used.

---

## 17. Acceptance criteria index

| ID | Criterion | Section |
|---|---|---|
| AC-AUTH-1 | A token is bound to one principal; no request argument selects another, on any transport. | 1 |
| AC-AUTH-2 | A disabled principal is denied every action, including with earlier tokens. | 1 |
| AC-AUTH-3 | Token claims never grant a permission. | 1 |
| AC-AUTH-4 | A held Grant has no effect on any decision or `policy_hash`. | 3 |
| AC-AUTH-5 | An expired grant does not match, evaluated per call. | 3 |
| AC-AUTH-6 | No module outside `plinth-authz` reads the grant index or emits row predicates (static check). | 4 |
| AC-AUTH-7 | The agent's allow set is contained in ceiling, token scope and delegator's effective set (property). | 5 |
| AC-AUTH-8 | A narrowed grant or revoked delegation takes effect on the next call. | 5 |
| AC-AUTH-9 | A token request exceeding the delegation is refused with `token_scope_denies`. | 5 |
| AC-AUTH-10 | The commit-rule classifier returns exactly one row or the fallback. | 6 |
| AC-AUTH-11 | Every agent commit's rule id is shown on its commit card. | 6 |
| AC-AUTH-12 | A node or column the principal cannot read is indistinguishable from an absent one, except for a permission-named `FORBIDDEN`. | 3, 9 |
| AC-AUTH-13 | A held change whose base moved on intersecting paths becomes `stale` and is not rebased on approval. | 7.1 |
| AC-AUTH-14 | `change.status` returns the state and the approver. | 7.1 |
| AC-AUTH-15 | Agents, services and the driver cannot approve. | 7.2 |
| AC-AUTH-16 | The requester, the on-behalf-of principal and the delegator cannot approve. | 7.2 |
| AC-AUTH-17 | An approval records the approver's principal and displays its name. | 7.3 |
| AC-AUTH-18 | An undo of an approved grant is attributed, linked by `undo_of`, and emits `grant.widened` when it widens. | 7.4 |
| AC-AUTH-19 | `grant.check` response shape is constant across not-permitted, absent and withheld-count cases. | 8 |
| AC-AUTH-20 | The driver holds its own credential and no human or agent credential. | 10 |
| AC-AUTH-21 | A replayed Change's permissions are the intersection of the recorded human's grants, the driver's `max_scope` and the step's token scope. | 10 |
| AC-AUTH-22 | The same matrix gives the same decision on UI, API, MCP and driver surfaces. | 15 |
| AC-AUTH-23 | Every commit rule and SoD condition has a negative fixture. | 15 |
| AC-SEC-1 | The control port is a separate listener, not routed through the ALB or the MCP router. | 11 |
| AC-SEC-2 | Fault cues are recorded in a hash-chained `fault_cues` table with applied tick. | 11 |
| AC-SEC-3 | Data strings are returned only inside `untrusted`, enforced by type and by an exhaustive test. | 12.1 |
| AC-SEC-4 | The seeded injection cannot change any permission; each adversarial attempt is refused or held and audited. | 12.4 |
| AC-SEC-5 | Denial and error text never contains a value the principal cannot see. | 9 |
| AC-SEC-6 | Secrets are absent from images, transcripts, audit arguments and logs. | 13 |
| AC-SEC-7 | Preview tokens are single use under concurrency. | 13 |
| AC-SEC-8 | Each service principal has its own credential and cannot write grants or approve. | 13 |
| AC-SEC-9 | Workspace isolation holds for every read path. | 13 |
| AC-SEC-10 | The audit chain detects an edited row. | 13 |

Plinth's authorization is one function, one commit-rule table and one approval path. The agent is bounded by a ceiling that is set by an administrator and checked on every call, and each bound is a test that can fail.
