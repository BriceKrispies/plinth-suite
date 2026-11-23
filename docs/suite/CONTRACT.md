# Plinth Suite: implementation contract

Plinth Suite turns Plinth into the frontend and backend of an enterprise CMS, automation and engagement suite for
Northwind Fulfilment's staff ("Northwind Rewards"). It runs on the existing kernel: one change log for configuration,
one Authorizer, one query compiler, one realtime channel, one MCP server. This document is the contract that one
backend builder and four frontend builders implement in parallel without talking to each other.

**Precedence.** The type-level contract in `packages/spec/src/suite/*.ts` (exported from `@plinth/spec`) wins over
this document on any shape. This document wins on behaviour. `docs/demo-design/spec/README.md` rulings still apply
(22: purely functional Effect backend; 34: minimal stack, no Kafka or Redis). Where a kernel spec document and this
contract disagree on a Suite matter, this contract wins.

**Generated companions.** `pnpm schema:gen` writes `packages/spec/generated/suite.*.schema.json` (one per node kind
and runtime shape), `suite.actions.json` (every action with method, path, permission, agent policy, refusals, events
and input/output JSON Schema) and `suite.sources.json` (the reporting Sources and the views behind them). The endpoint
lists in this document were generated from the same registry.

## 0. Reading guide

| Reader | Read |
|---|---|
| Backend builder | Everything. Section 15 lists every kernel change and the dependency order. |
| Design-system and runtime builder | 1, 5A (runtime, pages, bus), 6, `UI-MAP.md` sections 1 to 5, `DESIGN-SYSTEM.md` |
| Package A: shell, domains messaging, notifications, people, search | 1, 5A, 6, 12.1, 12.2, 12.3, 12.5 (people, groups), 12.10 (search), Appendix A |
| Package B: domains points, store, badges | 1, 5A, 6, 7, 12.4, Appendix A |
| Package C: domains promotions, automation, content, segments, calendar | 1, 4, 5A, 6, 8, 9, 10, 12.5 (segments), 12.10 (calendar, catalogue), Appendix A |
| Package D: domains reporting, approvals, tasks, audit, admin, settings, pages (page editor) | 1, 3 (matrix), 5A, 6, 12.6 to 12.9, 12.11, 13, Appendix A |

Module numbering used everywhere (code comments, UI-MAP): M0 shell and me, M1 messages, M2 notifications, M3 points
and ledger, M4 store, M5 badges, M6 promotions, M7 automation, M8 content, M9 people, groups and segments, M10 tasks,
M11 approvals, M12 audit, M13 admin, M14 home, M15 search, M16 calendar, M17 builder catalogue, M18 pages and
widgets, plus reporting (section 13) and settings (widgets only, section 12.9).

**The organising model is domains and widgets (section 5A).** Each domain (reporting, messaging, notifications,
people, search, points, store, badges, promotions, automation, content, segments, calendar, approvals, tasks, audit,
admin, settings, pages) exposes a catalogue of widgets. A widget is a self-contained mini-app: its own state, its own
data access through its domain's actions and realtime events, its own internal views, and a typed configuration
schema. Every screen, including home, profile and each module page, is a `Page` node laying out configured `Widget`
nodes; module pages are just the seeded default layouts of a domain's widgets. The agent composes pages over MCP
with the generic node verbs.

Labels: **Guarantee** means enforced by a constraint or a single code path and covered by an acceptance criterion in
section 16. **Target** is a design goal.

## 1. Conventions (all modules)

### 1.1 Transport

- Base path `/suite` on the API process (the browser reaches it as `/api/suite/...` through the Vite proxy, as today).
- Auth: `Authorization: Bearer <token>`. Dev identity: the existing static tokens, plus `dev-user-<handle>` for every
  seeded human member when `PLINTH_DEV_OPEN_TOKENS=true` (default in dev; section 15, K8).
- Session: browsers send `X-Plinth-Session: ses_<22 url-safe chars>` generated once per tab and kept in
  `sessionStorage`. The API upserts a `member_sessions` row on first sight and refuses requests carrying a revoked
  session with `401 UNAUTHENTICATED`, `details.reason = "SESSION_REVOKED"`. Requests without the header are allowed
  (curl, tests) and are not tracked.
- Success: `200 { "ok": true, "data": <output> }`. Failure: `{ "ok": false, "error": ErrorBody }` with the HTTP status
  from the kernel mapping (`httpStatusOf`): 401 UNAUTHENTICATED, 403 FORBIDDEN and RULE_REFUSED, 404 UNKNOWN_REFERENCE,
  409 CONFLICT and IDEMPOTENCY_KEY_REUSED, 422 VALIDATION_FAILED, 428 PREVIEW_REQUIRED, 429, 503, 504.
- Request bodies are decoded with `onExcessProperty: "error"`; a wrong field is `VALIDATION_FAILED` with `path`
  naming it (JSON pointer), `expected`, `allowed` and `did_you_mean` as the kernel already does.

### 1.2 Errors and Suite reasons

The kernel error enum stays closed (ruling 9). A Suite refusal is a kernel code plus `details.reason`, one of
`SUITE_REASONS` (`primitives.ts`). The code for each reason is fixed:

| `details.reason` | Code (HTTP) | Meaning |
|---|---|---|
| `INSUFFICIENT_POINTS` | CONFLICT 409 | The debit would take a member balance below 0. `details`: `balance`, `required`. |
| `OUT_OF_STOCK` | CONFLICT 409 | Not enough `on_hand`. `details`: `product`, `on_hand`, `requested`. |
| `INVALID_TRANSITION` | CONFLICT 409 | The state machine does not allow this from the current state. `details`: `from`, `to`, `allowed`. |
| `BUDGET_EXHAUSTED` | CONFLICT 409 | A promotion the quote relied on has no budget left. `details`: `promotion`. |
| `PRICE_CHANGED` | CONFLICT 409 | The quote hash no longer matches. `details.quote` is the fresh `QuoteOut`. |
| `ALREADY_EXISTS` | CONFLICT 409 | Unique record exists (review, badge award, handle). |
| `STALE_VERSION` | CONFLICT 409 | Optimistic version mismatch (tasks). `details.current_version`. |
| `NOT_ELIGIBLE` | RULE_REFUSED 403 | Business eligibility (tier gate, audience, review without delivered order). |
| `LIMIT_EXCEEDED` | RULE_REFUSED 403 | A Program limit (transfer per day, recipients, qty, broadcast without permission). `details.limit`, `details.value`. |
| `SELF_ACTION` | RULE_REFUSED 403 | Acting on oneself where forbidden (award yourself, approve your own order or content, transfer to yourself, disable yourself). |
| `NOT_PARTICIPANT` | RULE_REFUSED 403 | Not a participant of the thread. |
| `MEMBER_DISABLED` | RULE_REFUSED 403 | Target member is disabled. |
| `SESSION_REVOKED` | UNAUTHENTICATED 401 | The `X-Plinth-Session` was revoked. |
| `CART_EMPTY` | VALIDATION_FAILED 422 | Checkout or quote with no lines. |

Permission failures are the kernel `FORBIDDEN` with `details.permission` and `details.reason` (`no_grant`,
`ceiling_denies`, ...). A row-predicate miss on a member-targeted action (a regional manager acting outside the region)
is `FORBIDDEN` with `details.reason = "row_predicate"` and never reveals whether the target exists outside the scope.

### 1.3 Idempotency

- Every mutating action whose input has `idempotency_key` is idempotent per `(workspace, principal, key)` through
  `action_idempotency`: same key and same canonical request hash returns the stored result with `replayed: true`;
  same key, different hash is `IDEMPOTENCY_KEY_REUSED`. Keys are client-generated (`IdempotencyKey`: 8 to 128 of
  `[A-Za-z0-9:._-]`). The UI generates one per user intent (one per dialog submission), not per retry.
- Ledger transactions additionally carry a workspace-unique `idempotency_key` (section 7.2), so internal callers
  (automation steps, badge rewards, the expiry job) are idempotent even without an action record.
- State toggles (`messages.state`, `wishlist.add/remove`, `notifications.read`) are naturally idempotent and take no key.

### 1.4 Pagination and lists

`cursor` + `limit` (default 50, max 200). Responses are `{ items, next_cursor }` (`next_cursor` null at the end).
Cursors are opaque base64url of the last row's sort key; ordering is fixed per endpoint (newest first unless stated).

### 1.5 Time

- Suite records carry **virtual time** (`PlinthClock.virtualNow`, the 6x demo clock) in their `occurred_at`-style
  columns, so reports, `as_of` and the live order feed agree. Wall time is kept in `recorded_at` columns.
  Sessions use wall time.
- All timestamps on the wire are `Timestamp` (RFC 3339 UTC with `Z`). The UI shows them in UTC with a "UTC" marker,
  as Meridian does today. `me.get` returns `virtual_now` and the clock speed so the shell can tick a local clock.

### 1.6 Identity of things

- Nodes: the kernel URI `plinth://northwind/<Kind>/<uuid>` with `uuid = UUIDv5(PLINTH_NS, "<ws>|<Kind>|<slug>")`.
  References inside documents are `<lowercased kind>:<slug>` (`product:fleece-quarter-zip`, `segment:emea-gold-plus`).
- People: `Subject` (`user:<handle>`, `agent:claude-code`, `service:automation`). The UI routes people by handle.
- Records in transactional tables: UUIDv4 (`order_id`, `thread_id`, ...) except where stated; human-readable numbers:
  `txn_no` (integer), `order_no` (`R-000123`), `task_no` (integer), allocated from `suite_counters`.
- `PersonRef` (`{ subject, handle, display_name, kind, avatar: { initials, hue } }`) names a person in every response.
  `avatar.hue` comes from `members.avatar_hue`; agents use hue 265 and initials "AI"; services hue 210 and the first two
  letters of the service name.

### 1.7 Text

All people-authored text (message bodies, subjects, review text, content blocks, memos, reasons, notes, bios) is plain
text. The only markup is the inline grammar `**bold**`, `_emphasis_` and `@handle` mentions, rendered by the design
system's `inlineText()` into text nodes, never through HTML parsing. Over MCP, data-origin strings are wrapped as
`{ "untrusted": "..." }` (section 14.3).

## 2. Domain model

### 2.1 What is a Node and what is a table

The rule: **an object is a Node when people configure it, when it changes rarely, and when its history, diff, undo or
approval is the point.** It is a **transactional table row** when it is produced by activity at volume, when it must be
written atomically with other rows (money, stock), or when it is private to a person. Every table write appends a
`domain_events` row in the same transaction (the audit record and the realtime feed for that write).

| Object | Placement | Why |
|---|---|---|
| Product, Category | Node `Product`, `Category` | Catalogue is configuration: edits need history, agents create them through node verbs, price changes by agents are held (R-PRODUCT-PRICE). |
| Stock level | Table `product_inventory` | Decremented inside checkout transactions; a change-log row per purchase would serialise checkout on the workspace chain and bloat history. |
| Badge definition | Node `Badge` | Configuration with criteria; history matters. |
| Badge award, badge progress | Tables `badge_awards`, `badge_progress` | Produced by activity, per member, at volume. |
| Promotion | Node `Promotion` | The rule builder edits it; activation needs approval with SoD; undo and diff are required. |
| Redemptions, budget usage, entitlements | Tables `promotion_redemptions`, `promotion_usage`, `promotion_entitlements` | Written inside checkout and award transactions; budget counters are locked rows. |
| Automation | Node `Automation` | Configuration; enabling by agents is held. |
| Automation run and steps | Tables `automation_runs`, `automation_steps` | High volume, produced by the engine. |
| Content page, article, announcement | Node `Content` | Versions and diffs come from the change log; the feed serves `published_revision` via `bodyAt`. |
| Content engagement | Table `content_engagement` | Views and reactions at volume, per member. |
| Segment, Group | Node `Segment`, `Group` | Configuration referenced by promotions, content and automations. Segment membership is computed, never stored. |
| Role | Node `Role` | Membership changes access: it needs approval and audit exactly like a Grant. |
| Preferences | Node `Preference` (one per member, slug `prefs.<handle>`) | Required to be a node (agent-visible, audited); written only by its owner (`owner_only` grant). |
| Program policy | Node `Program` (singleton `rewards`) | Tiers, expiry, limits and thresholds are policy: every change is held (R-PROGRAM). |
| Member profile | Table `members` (1:1 with `principals`) | People data, edited often, private fields. |
| Ledger accounts, transactions, entries, lots | Tables `ledger_*`, `point_lots`, `lot_consumptions` | Double-entry money with constraints and row locks. |
| Store carts, orders, order lines, order events, wishlist, reviews | Tables `carts`, `cart_items`, `store_orders`, `store_order_items`, `store_order_events`, `wishlist_items`, `product_reviews` | Activity. |
| Messages, threads, participants, receipts, attachments | Tables `message_threads`, `messages`, `thread_participants`, `message_receipts`, `message_attachments` | Private, high volume. |
| Notifications, deliveries | Tables `notifications`, `notification_deliveries` | Per person, high volume. |
| Tasks, task comments | Tables `tasks`, `task_comments` | Work items at volume with optimistic concurrency. |
| Held domain actions | Table `action_approvals` | The kernel's `change_approvals` holds node changes; held actions need their own payload. |
| Sessions | Table `member_sessions` | Security records. |
| Domain events | Table `domain_events` + `domain_chain` | Append-only, hash-chained per workspace like the change log, separate so checkout does not take the change-log lock. |
| Widget instance | Node `Widget` | The Panel generalised: a configured widget is configuration, placed on many pages, composed by people and by the agent, with history and undo. |
| Page | Node `Page` | A layout of widget instances serving an app route; module pages are seeded system pages; personal pages (owner-only) let a member rearrange home. |

### 2.2 Node kinds: field reference

Every Suite body is the kernel envelope `{ apiVersion: "plinth/v1", kind, metadata: { slug, title, labels? }, spec }`
and is decoded with `onExcessProperty: "error"`. Full schemas: `packages/spec/src/suite/nodes.ts` and
`packages/spec/generated/suite.<Kind>.schema.json`; one valid example per kind: `SUITE_EXAMPLES` in
`packages/spec/src/suite/examples.ts`. Named types are listed in Appendix A.

##### Product spec

| Field | Type |
|---|---|
| `category` | `category:<slug>` |
| `summary` | `string` |
| `description` | `string` |
| `price_points` | `PositivePoints` |
| `cash_price_cents?` | `Cents` |
| `artwork` | `Artwork` |
| `attributes?` | `Record<string, string>` |
| `tags` | `string[]` |
| `status` | `"draft" \| "active" \| "retired"` |
| `featured` | `boolean` |
| `fulfilment` | `FulfilmentMethod` |
| `min_tier?` | `Tier` |
| `limit_per_member?` | `Int` |
| `low_stock_threshold` | `Int` |

##### Category spec

| Field | Type |
|---|---|
| `description` | `string` |
| `artwork` | `Artwork` |
| `sort` | `Int` |
| `status` | `"active" \| "hidden"` |

##### Badge spec

| Field | Type |
|---|---|
| `description` | `string` |
| `artwork` | `BadgeArtwork` |
| `criteria` | `BadgeCriteria` |
| `points_reward` | `Points` |
| `rarity` | `"common" \| "uncommon" \| "rare" \| "epic" \| "legendary"` |
| `hidden` | `boolean` |
| `sort` | `Int` |
| `status` | `"draft" \| "active" \| "retired"` |

##### Promotion spec

| Field | Type |
|---|---|
| `status` | `PromotionStatus` |
| `description` | `string` |
| `banner?` | `{ headline: string; tone: Tone; icon: IconName }` |
| `eligibility` | `PromotionEligibility` |
| `effects` | `PromotionEffect[]` |
| `budget` | `{ max_cost_points?: PositivePoints; max_redemptions?: Int; max_per_member?: Int }` |
| `schedule` | `{ starts_at: Timestamp; ends_at: Timestamp; days_of_week?: Int[]; hours_utc?: { from: Int; to: Int } }` |
| `priority` | `Int` |
| `stacking` | `"stack" \| "exclusive"` |
| `stack_group?` | `SuiteSlug` |
| `owner` | `Subject` |

##### Automation spec

| Field | Type |
|---|---|
| `enabled` | `boolean` |
| `description` | `string` |
| `trigger` | `AutomationTrigger` |
| `conditions?` | `CondTree` |
| `steps` | `AutomationStep[]` |
| `limits` | `{ max_runs_per_member_per_day?: Int; cooldown_minutes?: Int }` |
| `owner` | `Subject` |

##### Content spec

| Field | Type |
|---|---|
| `type` | `"page" \| "article" \| "announcement"` |
| `status` | `ContentStatus` |
| `summary` | `string` |
| `hero` | `Artwork` |
| `blocks` | `ContentBlock[]` |
| `tags` | `string[]` |
| `audience` | `{ everyone: boolean; segments?: segment:<slug>[]; groups?: group:<slug>[] }` |
| `author` | `Subject` |
| `reviewers` | `Subject[]` |
| `schedule` | `{ publish_at?: Timestamp; unpublish_at?: Timestamp }` |
| `pinned` | `boolean` |
| `allow_reactions` | `boolean` |
| `reactions_enabled?` | `Reaction[]` |
| `published_revision` | `Int \| null` |
| `review_log` | `({ by: Subject; at: Timestamp; decision: "submitted" \| "approved" \| "changes_requested" \| "published" \| "archived" \| "revised"; note?: string; revision: Int })[]` |

##### Segment spec

| Field | Type |
|---|---|
| `description` | `string` |
| `rule` | `CondTree` |
| `owner` | `Subject` |

##### Group spec

| Field | Type |
|---|---|
| `description` | `string` |
| `type` | `"team" \| "region" \| "interest" \| "distribution"` |
| `members` | `Subject[]` |
| `managers` | `Subject[]` |
| `open_posting` | `boolean` |
| `artwork` | `Artwork` |

##### Role spec

| Field | Type |
|---|---|
| `description` | `string` |
| `members` | `RoleMember[]` |
| `system` | `boolean` |

##### Preference spec

| Field | Type |
|---|---|
| `owner` | `Subject` |
| `notifications` | `{ mention: ChannelPrefs; message: ChannelPrefs; approval_request: ChannelPrefs; approval_decision: ChannelPrefs; points_awarded: ChannelPrefs; points_expiring: ChannelPrefs; badge_earned: ChannelPrefs; tier_changed: ChannelPrefs; order_status: ChannelPrefs; automation_alert: ChannelPrefs; content_review: ChannelPrefs; content_published: ChannelPrefs; task_assigned: ChannelPrefs; promotion_started: ChannelPrefs; system: ChannelPrefs }` |
| `digest` | `DigestPrefs` |
| `quiet_hours?` | `{ start_hour: Int; end_hour: Int }` |
| `muted_threads` | `UUID[]` |
| `ui` | `UiPrefs` |

##### Program spec

| Field | Type |
|---|---|
| `name` | `string` |
| `currency_label` | `string` |
| `tiers` | `TierDef[]` |
| `expiry` | `{ months: Int; warn_days: Int[] }` |
| `transfer` | `{ enabled: boolean; min_points: PositivePoints; max_per_transfer: PositivePoints; max_per_day: PositivePoints }` |
| `awards` | `{ manager_max_per_award: PositivePoints; max_recipients: Int }` |
| `store` | `{ high_value_threshold_points: PositivePoints; cancel_window_minutes: Int; max_cart_lines: Int; max_qty_per_line: Int }` |
| `messaging` | `{ broadcast_min_recipients: Int; max_recipients: Int }` |
| `notification_defaults` | `{ mention: ChannelPrefs; message: ChannelPrefs; approval_request: ChannelPrefs; approval_decision: ChannelPrefs; points_awarded: ChannelPrefs; points_expiring: ChannelPrefs; badge_earned: ChannelPrefs; tier_changed: ChannelPrefs; order_status: ChannelPrefs; automation_alert: ChannelPrefs; content_review: ChannelPrefs; content_published: ChannelPrefs; task_assigned: ChannelPrefs; promotion_started: ChannelPrefs; system: ChannelPrefs }` |
| `digest_default` | `DigestPrefs` |

##### Page spec

| Field | Type |
|---|---|
| `kind` | `"module" \| "home" \| "profile" \| "custom" \| "personal"` |
| `description` | `string` |
| `route?` | `string` |
| `owner?` | `Subject` |
| `based_on?` | `string` |
| `system` | `boolean` |
| `nav?` | `PageNav` |
| `layout` | `{ columns: 12; items: PageItem[] }` |

### 2.3 Node semantic validation (after schema decoding)

The change log's `checkSemantics` (kernel `validate.ts`) gains these rules. A failure is `VALIDATION_FAILED` (bad
value), `UNKNOWN_REFERENCE` (missing node) or `RULE_REFUSED` (managed field) with the JSON pointer of the offending
value.

| Kind | Rule |
|---|---|
| Product | `category` resolves to a Category node; `status: active` needs `price_points >= 1`; `min_tier` and `limit_per_member` optional. Creating a Product inserts its `product_inventory` row (`on_hand` 0) in the same transaction. |
| Category | none beyond schema. A Category with active products cannot be deleted (`RULE_REFUSED`, `details.reason = "in_use"`). |
| Badge | `criteria.filter` only addresses fields of the named event's payload (`event.<field>`) or member facts (`member.<fact>`); `points_threshold.lifetime_points` above the platinum floor is allowed. Retiring keeps awards. |
| Promotion | `schedule.ends_at > starts_at`; every `category:`/`product:`/`segment:`/`group:` ref resolves; `free_item.product` is an active Product; at least one effect applies to at least one channel in `eligibility.channels` (or channels omitted); `stack_group` only with `stacking: "stack"`. `/spec/status` is **managed** (only `promotions.transition` and the scheduler may change it). Creating with status other than `draft` is refused. |
| Automation | `steps[*].id` unique; templates only reference `event.*`, `member.*`, `run.id`, `now`; metric `query` type-checks against its source and returns `value_column`; event `filter` addresses the event's payload fields; `cron` parses (five fields, ranges, lists, steps `*/n`); `apply_promotion.promotion` resolves. Creating with `enabled: true` by an agent is refused (R-AUTOMATION-CREATE). |
| Content | `blocks[*]` refs resolve (`panel:`, `product:`, `badge:`); `reviewers` exclude `author`; `/spec/status`, `/spec/published_revision` and `/spec/review_log` are **managed** (only `content.transition` and the scheduler). Any other path may change only while `status = draft` (else `RULE_REFUSED`, `details.reason = "INVALID_TRANSITION"`). Create with `status: draft`, `published_revision: null`, `review_log: []`. |
| Segment | `rule` addresses only `MEMBER_FACTS` paths with operators and values valid for each fact's type (section 4). |
| Group | `members` and `managers` are existing human principals; managers need not be members. |
| Role | `members[*].subject` are existing human principals; no duplicate subjects; a `system: true` Role cannot be deleted or have `system` changed. |
| Preference | slug is `prefs.<handle>` and `spec.owner` is `user:<handle>`; only the owner may write it (grant `owner_only`). |
| Program | slug must be `rewards` (singleton); `tiers` are bronze, silver, gold, platinum in that order with strictly increasing `min_lifetime_points` and bronze at 0. |
| Widget | `spec.config` decodes against the named widget's config schema (the discriminated `WidgetInstanceSpec`); node refs in config (`panel:`, slugs of segments, products, promotions, automations, content, groups, dashboards) resolve unless they are `{ param }` bindings; reporting widgets' `query` type-checks against its source and the visual's channels name output columns (kernel Panel rules). A personal widget sets `owner`. |
| Page | every `item` resolves to a readable Widget or Panel; items do not overlap on the 12-column grid and `x + w <= 12`; `size`, when given, is one of the widget's sizes; `route` is unique among non-personal pages and its `:params` cover every `{ param }` binding used by the page's widgets; `kind: personal` requires `owner` and `based_on`; slug of a personal page is `<based_on slug>.<handle>`; `system: true` pages cannot be deleted. |

Managed-field writes are allowed only when the commit carries the internal context `managed: { by: "<action name>" }`
(K6); the HTTP `POST /changes` and MCP `node.preview` paths never set it.

### 2.4 Transactional tables: DDL

Migration `packages/engine/src/migrations/0003_suite.sql`. Conventions: every table has `workspace_id`; Suite
timestamps named `occurred_at`/`*_at` are **virtual** unless the column is `recorded_at` or the table is
`member_sessions`; money is `bigint` points; foreign keys to principals use `principal_id`. The reset path truncates
every table below (K12).

```sql
-- ---- kernel adjustments ------------------------------------------------------------------------
ALTER TABLE nodes DROP CONSTRAINT nodes_kind_check;
ALTER TABLE nodes ADD CONSTRAINT nodes_kind_check CHECK (kind IN (
  'Dashboard','Panel','Query','Source','Parameter','Rule','Action','Form','Workflow','Grant','Metric','Template',
  'Export','Annotation','Comment',
  'Product','Category','Badge','Promotion','Automation','Content','Segment','Group','Role','Preference','Program',
  'Widget','Page'));

-- the permission an approver needs besides approval:decide (APPROVER_PERMISSION, section 3.8)
ALTER TABLE change_approvals ADD COLUMN approver_permission text NOT NULL DEFAULT 'grant:write';

CREATE FUNCTION plinth_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END $$;

-- ---- counters (txn_no, order_no, task_no) ---------------------------------------------------------
CREATE TABLE suite_counters (
  workspace_id uuid   NOT NULL REFERENCES workspaces,
  name         text   NOT NULL CHECK (name IN ('txn','order','task')),
  value        bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, name)
);

-- ---- people -----------------------------------------------------------------------------------------
CREATE TABLE members (
  member_id      uuid PRIMARY KEY REFERENCES principals (principal_id),
  workspace_id   uuid NOT NULL REFERENCES workspaces,
  handle         text NOT NULL CHECK (handle ~ '^[a-z][a-z0-9-]{1,39}$'),
  email          text NOT NULL,
  title          text NOT NULL DEFAULT '',
  department     text NOT NULL CHECK (department IN ('operations','fulfilment','finance','marketing','technology','people')),
  region         text NOT NULL CHECK (region IN ('NA','EMEA','APAC','LATAM','ANZ')),
  location       text NOT NULL DEFAULT '',
  bio            text NOT NULL DEFAULT '' CHECK (length(bio) <= 500),
  avatar_hue     int  NOT NULL CHECK (avatar_hue BETWEEN 0 AND 359),
  showcase       text[] NOT NULL DEFAULT '{}' CHECK (cardinality(showcase) <= 3),
  joined_at      timestamptz NOT NULL,
  last_active_at timestamptz,
  UNIQUE (workspace_id, handle),
  UNIQUE (workspace_id, email)
);
-- status is derived: principals.disabled_at IS NULL -> 'active'

CREATE TABLE member_sessions (
  session_id   text PRIMARY KEY CHECK (session_id ~ '^ses_[A-Za-z0-9_-]{16,40}$'),
  workspace_id uuid NOT NULL REFERENCES workspaces,
  principal_id uuid NOT NULL REFERENCES principals,
  surface      text NOT NULL CHECK (surface IN ('ui','mcp','api')),
  label        text NOT NULL,                         -- "Firefox on Windows", "MCP stdio"
  created_at   timestamptz NOT NULL DEFAULT now(),    -- wall time
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  revoked_by   uuid REFERENCES principals,
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE INDEX member_sessions_open ON member_sessions (principal_id) WHERE revoked_at IS NULL;

-- ---- domain events (audit record + realtime feed for every table write) ---------------------------
CREATE TABLE domain_chain (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces,
  head_seq     bigint NOT NULL DEFAULT 0,
  head_hash    bytea  NOT NULL
);

CREATE TABLE domain_events (
  workspace_id uuid   NOT NULL REFERENCES workspaces,
  seq          bigint NOT NULL,
  type         text   NOT NULL,                       -- DOMAIN_EVENT_TYPES
  occurred_at  timestamptz NOT NULL,                  -- virtual
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid NOT NULL REFERENCES principals,
  on_behalf_of uuid REFERENCES principals,
  approved_by  uuid REFERENCES principals,
  surface      text NOT NULL CHECK (surface IN ('ui','api','mcp','driver','system','cli')),
  session_id   text,
  audience     text[] NOT NULL CHECK (cardinality(audience) >= 1),
  subject_kind text,
  subject_id   text,
  member_id    uuid REFERENCES principals,            -- the member the event is about (badge and automation input)
  payload      jsonb NOT NULL,
  cause        jsonb,                                 -- EventCause when produced by an automation step
  cause_depth  int  NOT NULL DEFAULT 0 CHECK (cause_depth BETWEEN 0 AND 8),
  prev_hash    bytea NOT NULL,
  hash         bytea NOT NULL,
  PRIMARY KEY (workspace_id, seq),
  CHECK ((subject_kind IS NULL) = (subject_id IS NULL))
);
CREATE INDEX domain_events_member   ON domain_events (workspace_id, member_id, seq DESC) WHERE member_id IS NOT NULL;
CREATE INDEX domain_events_actor    ON domain_events (workspace_id, actor_id, seq DESC);
CREATE INDEX domain_events_type     ON domain_events (workspace_id, type, seq DESC);
CREATE INDEX domain_events_subject  ON domain_events (workspace_id, subject_kind, subject_id);
CREATE INDEX domain_events_audience ON domain_events USING gin (audience);
CREATE TRIGGER domain_events_append_only BEFORE UPDATE OR DELETE ON domain_events
  FOR EACH ROW EXECUTE FUNCTION plinth_append_only();

-- consumer cursors (automation engine, badge engine) and scheduler ticks
CREATE TABLE engine_cursors (
  workspace_id uuid NOT NULL REFERENCES workspaces,
  consumer     text NOT NULL CHECK (consumer IN ('automation','badges')),
  last_seq     bigint NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, consumer)
);
CREATE TABLE scheduler_ticks (
  workspace_id uuid NOT NULL REFERENCES workspaces,
  job          text NOT NULL,                         -- 'minute', 'expiry', 'digest', 'approvals'
  last_tick    timestamptz NOT NULL,                  -- virtual
  PRIMARY KEY (workspace_id, job)
);

-- ---- actions: idempotency and held actions ----------------------------------------------------------
CREATE TABLE action_idempotency (
  workspace_id    uuid  NOT NULL,
  principal_id    uuid  NOT NULL,
  idempotency_key text  NOT NULL,
  action          text  NOT NULL,
  request_hash    bytea NOT NULL,
  result          jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, principal_id, idempotency_key)
);

CREATE TABLE action_approvals (
  approval_id         uuid PRIMARY KEY,
  workspace_id        uuid NOT NULL REFERENCES workspaces,
  action              text NOT NULL,
  input               jsonb NOT NULL,
  input_hash          bytea NOT NULL,
  requester_id        uuid NOT NULL REFERENCES principals,
  on_behalf_of        uuid REFERENCES principals,
  approver_permission text NOT NULL,
  summary             text NOT NULL,                  -- Plinth-authored sentence
  status              text NOT NULL CHECK (status IN ('pending_approval','approved','rejected','withdrawn','expired','failed')),
  reason              text,
  idempotency_key     text NOT NULL,
  created_at          timestamptz NOT NULL,           -- virtual
  expires_at          timestamptz NOT NULL,           -- virtual, created_at + 7 days
  decided_by          uuid REFERENCES principals,
  decided_at          timestamptz,
  decision_reason     text,
  result              jsonb,
  error               jsonb,
  CHECK ((status IN ('approved','rejected','failed')) = (decided_by IS NOT NULL))
);
CREATE INDEX action_approvals_open ON action_approvals (workspace_id, status);

-- ---- ledger -------------------------------------------------------------------------------------
CREATE TABLE ledger_accounts (
  account_id      uuid PRIMARY KEY,                   -- UUIDv5(PLINTH_NS, 'account|<ws>|<code>')
  workspace_id    uuid NOT NULL REFERENCES workspaces,
  code            text NOT NULL CHECK (code ~ '^(member:[a-z][a-z0-9-]{1,39}|system:(issuance|promotions|redemption|expiry|adjustments))$'),
  kind            text NOT NULL CHECK (kind IN ('member','system')),
  member_id       uuid REFERENCES principals,
  balance         bigint NOT NULL DEFAULT 0,
  lifetime_earned bigint NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  tier            text CHECK (tier IN ('bronze','silver','gold','platinum')),
  created_at      timestamptz NOT NULL,
  UNIQUE (workspace_id, code),
  UNIQUE (workspace_id, member_id),
  CHECK ((kind = 'member') = (member_id IS NOT NULL)),
  CHECK ((kind = 'member') = (tier IS NOT NULL)),
  CHECK (kind = 'system' OR balance >= 0)             -- invariant L2
);

CREATE TABLE ledger_transactions (
  txn_id          uuid PRIMARY KEY,
  workspace_id    uuid   NOT NULL REFERENCES workspaces,
  txn_no          bigint NOT NULL,
  txn_type        text   NOT NULL CHECK (txn_type IN ('award','purchase','refund','transfer','expiry','adjustment','promotion_bonus','badge_reward','reversal')),
  occurred_at     timestamptz NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid NOT NULL REFERENCES principals,
  on_behalf_of    uuid REFERENCES principals,
  surface         text NOT NULL CHECK (surface IN ('ui','api','mcp','driver','system','cli')),
  memo            text NOT NULL CHECK (length(memo) <= 280),
  idempotency_key text  NOT NULL,
  request_hash    bytea NOT NULL,
  ref_kind        text CHECK (ref_kind IN ('order','promotion','badge_award','automation_run','transfer','txn','approval','seed')),
  ref_id          text,
  reverses_txn_id uuid UNIQUE REFERENCES ledger_transactions,
  approval_id     uuid,
  event_seq       bigint NOT NULL,                    -- first domain_events seq it produced
  UNIQUE (workspace_id, txn_no),
  UNIQUE (workspace_id, idempotency_key),
  CHECK ((ref_kind IS NULL) = (ref_id IS NULL))
);
CREATE INDEX ledger_transactions_ref ON ledger_transactions (workspace_id, ref_kind, ref_id);

CREATE TABLE ledger_entries (
  entry_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  uuid   NOT NULL,
  txn_id        uuid   NOT NULL REFERENCES ledger_transactions,
  account_id    uuid   NOT NULL REFERENCES ledger_accounts,
  amount        bigint NOT NULL CHECK (amount <> 0),  -- credit positive
  balance_after bigint NOT NULL,
  tier_after    text CHECK (tier_after IN ('bronze','silver','gold','platinum')),
  UNIQUE (txn_id, account_id)
);
CREATE INDEX ledger_entries_account ON ledger_entries (account_id, entry_id DESC);

-- L3: the account balance moves with every entry, in the same statement
CREATE FUNCTION ledger_apply_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE ledger_accounts SET balance = balance + NEW.amount
   WHERE account_id = NEW.account_id
  RETURNING balance INTO NEW.balance_after;           -- the L2 CHECK fires here for a member going negative
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_entries_apply BEFORE INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_apply_entry();

-- L1: every transaction balances and has at least two entries, checked at COMMIT
CREATE FUNCTION ledger_txn_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s bigint; n int; t uuid := COALESCE(NEW.txn_id, OLD.txn_id);
BEGIN
  SELECT COALESCE(sum(amount), 0), count(*) INTO s, n FROM ledger_entries WHERE txn_id = t;
  IF s <> 0 OR n < 2 THEN
    RAISE EXCEPTION 'ledger transaction % unbalanced (sum %, entries %)', t, s, n USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_txn_balanced();
CREATE CONSTRAINT TRIGGER ledger_transactions_have_entries AFTER INSERT ON ledger_transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_txn_balanced();

-- L6: immutable
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION plinth_append_only();
CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION plinth_append_only();

-- expiry lots (L5: a member's balance equals the sum of its lots' remaining)
CREATE TABLE point_lots (
  lot_id         uuid PRIMARY KEY,
  workspace_id   uuid   NOT NULL,
  account_id     uuid   NOT NULL REFERENCES ledger_accounts,
  source_txn_id  uuid   NOT NULL REFERENCES ledger_transactions,
  original       bigint NOT NULL CHECK (original > 0),
  remaining      bigint NOT NULL CHECK (remaining >= 0 AND remaining <= original),
  earned_at      timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  expired_txn_id uuid REFERENCES ledger_transactions
);
CREATE INDEX point_lots_fifo ON point_lots (account_id, expires_at, earned_at, lot_id) WHERE remaining > 0;
CREATE INDEX point_lots_due  ON point_lots (workspace_id, expires_at) WHERE remaining > 0;

CREATE TABLE lot_consumptions (
  txn_id  uuid   NOT NULL REFERENCES ledger_transactions,
  lot_id  uuid   NOT NULL REFERENCES point_lots,
  amount  bigint NOT NULL,                            -- positive = consumed, negative = restored
  PRIMARY KEY (txn_id, lot_id)
);

-- ---- store ----------------------------------------------------------------------------------------
CREATE TABLE product_inventory (
  product_id   uuid PRIMARY KEY,                      -- the Product node id
  workspace_id uuid NOT NULL REFERENCES workspaces,
  product_slug text NOT NULL,
  on_hand      int  NOT NULL CHECK (on_hand >= 0),
  updated_at   timestamptz NOT NULL,
  UNIQUE (workspace_id, product_slug)
);

CREATE TABLE inventory_movements (
  movement_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  uuid NOT NULL,
  product_id    uuid NOT NULL REFERENCES product_inventory,
  delta         int  NOT NULL CHECK (delta <> 0),
  on_hand_after int  NOT NULL CHECK (on_hand_after >= 0),
  reason        text NOT NULL CHECK (reason IN ('initial','restock','damage','count_correction','return','order','cancel','refund')),
  order_id      uuid,
  actor_id      uuid NOT NULL REFERENCES principals,
  occurred_at   timestamptz NOT NULL,
  note          text
);

CREATE TABLE carts (
  cart_id      uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces,
  member_id    uuid NOT NULL UNIQUE REFERENCES principals,
  updated_at   timestamptz NOT NULL
);
CREATE TABLE cart_items (
  cart_id    uuid NOT NULL REFERENCES carts ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES product_inventory,
  qty        int  NOT NULL CHECK (qty BETWEEN 1 AND 10),
  added_at   timestamptz NOT NULL,
  PRIMARY KEY (cart_id, product_id)
);

CREATE TABLE store_orders (
  order_id          uuid PRIMARY KEY,
  workspace_id      uuid NOT NULL REFERENCES workspaces,
  order_no          text NOT NULL CHECK (order_no ~ '^R-[0-9]{6}$'),
  member_id         uuid NOT NULL REFERENCES principals,
  region            text NOT NULL,                    -- snapshot at placement
  tier              text NOT NULL,                    -- snapshot at placement
  status            text NOT NULL CHECK (status IN ('placed','approved','fulfilled','shipped','delivered','cancelled','refunded')),
  requires_approval boolean NOT NULL,
  subtotal_points   bigint NOT NULL CHECK (subtotal_points >= 0),
  discount_points   bigint NOT NULL CHECK (discount_points >= 0),
  total_points      bigint NOT NULL CHECK (total_points >= 0),
  bonus_points      bigint NOT NULL DEFAULT 0 CHECK (bonus_points >= 0),
  cash_cents        bigint NOT NULL DEFAULT 0 CHECK (cash_cents >= 0),
  promotions        jsonb  NOT NULL,                  -- AppliedPromotion[] as evaluated
  delivery          jsonb  NOT NULL,                  -- Delivery
  notes             text,
  quote_hash        bytea  NOT NULL,
  ledger_txn_id     uuid REFERENCES ledger_transactions,
  refund_txn_id     uuid REFERENCES ledger_transactions,
  bonus_txn_id      uuid REFERENCES ledger_transactions,
  placed_at         timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  version           int NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, order_no),
  CHECK (total_points = subtotal_points - discount_points),
  CHECK ((total_points = 0) = (ledger_txn_id IS NULL))
);
CREATE INDEX store_orders_member ON store_orders (workspace_id, member_id, placed_at DESC);
CREATE INDEX store_orders_status ON store_orders (workspace_id, status, placed_at DESC);

CREATE TABLE store_order_items (
  order_id        uuid NOT NULL REFERENCES store_orders,
  line            int  NOT NULL CHECK (line >= 0),
  product_id      uuid NOT NULL,
  product_slug    text NOT NULL,
  title           text NOT NULL,                      -- snapshot
  category_slug   text NOT NULL,
  qty             int  NOT NULL CHECK (qty BETWEEN 1 AND 10),
  unit_points     bigint NOT NULL CHECK (unit_points >= 0),
  discount_points bigint NOT NULL CHECK (discount_points >= 0),
  line_points     bigint NOT NULL CHECK (line_points >= 0),
  cash_cents      bigint NOT NULL DEFAULT 0,
  free_item       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (order_id, line),
  CHECK (line_points = unit_points * qty - discount_points)
);

CREATE TABLE store_order_events (
  order_id     uuid NOT NULL REFERENCES store_orders,
  seq          int  NOT NULL,
  from_status  text,
  to_status    text NOT NULL,
  actor_id     uuid NOT NULL REFERENCES principals,
  on_behalf_of uuid REFERENCES principals,
  occurred_at  timestamptz NOT NULL,
  note         text,
  PRIMARY KEY (order_id, seq)
);

CREATE TABLE wishlist_items (
  workspace_id uuid NOT NULL,
  member_id    uuid NOT NULL REFERENCES principals,
  product_id   uuid NOT NULL REFERENCES product_inventory,
  added_at     timestamptz NOT NULL,
  PRIMARY KEY (member_id, product_id)
);

CREATE TABLE product_reviews (
  review_id    uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  product_id   uuid NOT NULL REFERENCES product_inventory,
  member_id    uuid NOT NULL REFERENCES principals,
  order_id     uuid NOT NULL REFERENCES store_orders,
  rating       int  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body         text NOT NULL CHECK (length(body) <= 2000),
  status       text NOT NULL CHECK (status IN ('published','hidden')),
  created_at   timestamptz NOT NULL,
  moderated_by uuid REFERENCES principals,
  moderated_at timestamptz,
  UNIQUE (product_id, member_id)
);

-- ---- badges ---------------------------------------------------------------------------------------
CREATE TABLE badge_awards (
  award_id         uuid PRIMARY KEY,
  workspace_id     uuid NOT NULL,
  badge_id         uuid NOT NULL,                     -- the Badge node id
  badge_slug       text NOT NULL,
  member_id        uuid NOT NULL REFERENCES principals,
  awarded_at       timestamptz NOT NULL,
  awarded_by       uuid NOT NULL REFERENCES principals, -- service:badges for criteria awards
  reason           text NOT NULL,
  source_event_seq bigint,
  points_txn_id    uuid REFERENCES ledger_transactions,
  revoked_at       timestamptz,
  revoked_by       uuid REFERENCES principals,
  revoke_reason    text,
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE UNIQUE INDEX badge_awards_one_live ON badge_awards (badge_id, member_id) WHERE revoked_at IS NULL;
CREATE INDEX badge_awards_member ON badge_awards (workspace_id, member_id, awarded_at DESC);

CREATE TABLE badge_progress (
  member_id       uuid   NOT NULL REFERENCES principals,
  badge_id        uuid   NOT NULL,
  workspace_id    uuid   NOT NULL,
  current         bigint NOT NULL DEFAULT 0,
  target          bigint NOT NULL,
  streak_last_day date,                               -- streak criteria: last virtual day counted
  updated_at      timestamptz NOT NULL,
  PRIMARY KEY (member_id, badge_id)
);

-- ---- promotions -----------------------------------------------------------------------------------
CREATE TABLE promotion_usage (
  promotion_id uuid PRIMARY KEY,                      -- Promotion node id; locked FOR UPDATE when charged
  workspace_id uuid   NOT NULL,
  cost_points  bigint NOT NULL DEFAULT 0 CHECK (cost_points >= 0),
  redemptions  int    NOT NULL DEFAULT 0 CHECK (redemptions >= 0),
  alerts_sent  int[]  NOT NULL DEFAULT '{}'           -- budget alert thresholds already emitted (50, 80, 100)
);

CREATE TABLE promotion_redemptions (
  redemption_id      uuid PRIMARY KEY,
  workspace_id       uuid NOT NULL,
  promotion_id       uuid NOT NULL,
  promotion_slug     text NOT NULL,
  promotion_revision bigint NOT NULL,
  member_id          uuid NOT NULL REFERENCES principals,
  context            text NOT NULL CHECK (context IN ('purchase','earn')),
  effect_type        text NOT NULL CHECK (effect_type IN ('points_multiplier','bonus_points','store_discount','free_item')),
  cost_points        bigint NOT NULL CHECK (cost_points >= 0),
  benefit_points     bigint NOT NULL CHECK (benefit_points >= 0),
  ref_kind           text NOT NULL CHECK (ref_kind IN ('order','txn')),
  ref_id             text NOT NULL,
  occurred_at        timestamptz NOT NULL,
  reversed_at        timestamptz
);
CREATE INDEX promotion_redemptions_promo  ON promotion_redemptions (workspace_id, promotion_id, occurred_at);
CREATE INDEX promotion_redemptions_member ON promotion_redemptions (promotion_id, member_id) WHERE reversed_at IS NULL;

CREATE TABLE promotion_entitlements (
  entitlement_id uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL,
  promotion_id   uuid NOT NULL,
  member_id      uuid NOT NULL REFERENCES principals,
  run_id         uuid,                                -- the automation run that granted it
  granted_at     timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  used_ref       text
);
CREATE INDEX promotion_entitlements_open ON promotion_entitlements (promotion_id, member_id) WHERE used_at IS NULL;

-- ---- messages -------------------------------------------------------------------------------------
CREATE TABLE message_threads (
  thread_id       uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces,
  subject         text NOT NULL CHECK (length(subject) BETWEEN 1 AND 140),
  kind            text NOT NULL CHECK (kind IN ('direct','group','broadcast','system')),
  created_by      uuid NOT NULL REFERENCES principals,
  created_at      timestamptz NOT NULL,
  last_message_at timestamptz NOT NULL,
  message_count   int NOT NULL DEFAULT 0
);

CREATE TABLE messages (
  message_id      uuid PRIMARY KEY,
  thread_id       uuid NOT NULL REFERENCES message_threads,
  workspace_id    uuid NOT NULL,
  sender_id       uuid NOT NULL REFERENCES principals,
  on_behalf_of    uuid REFERENCES principals,
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  mentions        uuid[] NOT NULL DEFAULT '{}',
  reply_to        uuid REFERENCES messages,
  sent_at         timestamptz NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  via_automation  uuid,                               -- automation run id
  search          tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED
);
CREATE INDEX messages_thread ON messages (thread_id, sent_at);
CREATE INDEX messages_search ON messages USING gin (search);

CREATE TABLE thread_participants (
  thread_id    uuid NOT NULL REFERENCES message_threads,
  principal_id uuid NOT NULL REFERENCES principals,
  role         text NOT NULL CHECK (role IN ('from','to','cc')),
  via_group    text,                                  -- group slug the person was expanded from
  starred      boolean NOT NULL DEFAULT false,
  archived_at  timestamptz,
  muted        boolean NOT NULL DEFAULT false,
  joined_at    timestamptz NOT NULL,
  PRIMARY KEY (thread_id, principal_id)
);
CREATE INDEX thread_participants_person ON thread_participants (principal_id, thread_id);

CREATE TABLE message_receipts (
  message_id   uuid NOT NULL REFERENCES messages,
  principal_id uuid NOT NULL REFERENCES principals,
  thread_id    uuid NOT NULL,
  read_at      timestamptz,
  PRIMARY KEY (message_id, principal_id)
);
CREATE INDEX message_receipts_unread ON message_receipts (principal_id, thread_id) WHERE read_at IS NULL;

CREATE TABLE message_attachments (
  attachment_id uuid PRIMARY KEY,
  message_id    uuid NOT NULL REFERENCES messages,
  file_name     text NOT NULL,
  media_type    text NOT NULL,
  size_bytes    bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 50000000),
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

-- ---- notifications --------------------------------------------------------------------------------
CREATE TABLE notifications (
  notification_id  uuid PRIMARY KEY,
  workspace_id     uuid NOT NULL,
  recipient_id     uuid NOT NULL REFERENCES principals,
  type             text NOT NULL,                     -- NOTIFICATION_TYPES
  title            text NOT NULL CHECK (length(title) <= 140),
  body             text NOT NULL CHECK (length(body) <= 500),
  link             text,
  actor_id         uuid REFERENCES principals,
  subject_kind     text,
  subject_id       text,
  in_app           boolean NOT NULL,                  -- shown in the feed
  created_at       timestamptz NOT NULL,
  read_at          timestamptz,
  source_event_seq bigint,
  dedupe_key       text NOT NULL,
  UNIQUE (recipient_id, dedupe_key)
);
CREATE INDEX notifications_feed   ON notifications (recipient_id, created_at DESC) WHERE in_app;
CREATE INDEX notifications_unread ON notifications (recipient_id) WHERE in_app AND read_at IS NULL;

CREATE TABLE notification_deliveries (
  delivery_id       uuid PRIMARY KEY,
  workspace_id      uuid NOT NULL,
  recipient_id      uuid NOT NULL REFERENCES principals,
  channel           text NOT NULL CHECK (channel IN ('email','digest')),
  status            text NOT NULL CHECK (status IN ('queued','sent','suppressed')),
  suppressed_reason text CHECK (suppressed_reason IN ('preference_off','quiet_hours','member_disabled')),
  subject           text NOT NULL,
  body              text NOT NULL,
  notification_ids  uuid[] NOT NULL,
  digest_period     text,                             -- '2026-11-20' (daily) or '2026-W47' (weekly)
  created_at        timestamptz NOT NULL,
  sent_at           timestamptz,
  UNIQUE (recipient_id, channel, digest_period)
);

-- ---- automation -----------------------------------------------------------------------------------
CREATE TABLE automation_runs (
  run_id              uuid PRIMARY KEY,
  workspace_id        uuid NOT NULL,
  automation_id       uuid NOT NULL,
  automation_slug     text NOT NULL,
  automation_revision bigint NOT NULL,
  trigger_key         text NOT NULL,                  -- 'event:<seq>', 'cron:<minute>', 'metric:<window>', 'manual:<key>', 'retry:<run>:<n>'
  trigger             jsonb NOT NULL,                 -- RunTrigger
  context             jsonb NOT NULL,                 -- event payload, member facts snapshot, now
  status              text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','skipped','cancelled')),
  member_id           uuid REFERENCES principals,
  cause_depth         int  NOT NULL DEFAULT 0,
  attempt             int  NOT NULL DEFAULT 1,
  error               jsonb,
  created_at          timestamptz NOT NULL,           -- virtual
  started_at          timestamptz,
  finished_at         timestamptz,
  UNIQUE (workspace_id, automation_id, trigger_key)
);
CREATE INDEX automation_runs_recent ON automation_runs (workspace_id, created_at DESC);
CREATE INDEX automation_runs_member ON automation_runs (automation_id, member_id, created_at DESC);

CREATE TABLE automation_steps (
  run_id          uuid NOT NULL REFERENCES automation_runs,
  step_index      int  NOT NULL,
  step_id         text NOT NULL,
  type            text NOT NULL,
  status          text NOT NULL CHECK (status IN ('pending','running','succeeded','failed','skipped')),
  attempts        int  NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL,                      -- 'run:<run_id>:step:<step_id>'
  input           jsonb NOT NULL,
  output          jsonb,
  error           jsonb,
  started_at      timestamptz,
  finished_at     timestamptz,
  next_attempt_at timestamptz,                        -- wall time of the next retry
  PRIMARY KEY (run_id, step_index)
);

CREATE TABLE automation_metric_state (
  automation_id   uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL,
  holding_since   timestamptz,                        -- virtual; null while the condition is false
  last_eval_at    timestamptz,
  last_value      double precision,
  last_fired_key  text
);

CREATE TABLE webhook_deliveries (
  delivery_id  uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  run_id       uuid NOT NULL REFERENCES automation_runs,
  step_index   int  NOT NULL,
  target_label text NOT NULL,
  payload      jsonb NOT NULL,
  status       text NOT NULL CHECK (status = 'recorded'),   -- a stub: never sent anywhere
  recorded_at  timestamptz NOT NULL
);

-- ---- content --------------------------------------------------------------------------------------
CREATE TABLE content_engagement (
  content_id      uuid NOT NULL,                      -- Content node id
  member_id       uuid NOT NULL REFERENCES principals,
  workspace_id    uuid NOT NULL,
  first_viewed_at timestamptz NOT NULL,
  last_viewed_at  timestamptz NOT NULL,
  views           int  NOT NULL DEFAULT 1 CHECK (views >= 1),
  reaction        text CHECK (reaction IN ('like','celebrate','insightful')),
  reacted_at      timestamptz,
  PRIMARY KEY (content_id, member_id)
);

-- ---- tasks ----------------------------------------------------------------------------------------
CREATE TABLE tasks (
  task_id         uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL,
  task_no         int  NOT NULL,
  title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 140),
  description     text NOT NULL DEFAULT '',
  status          text NOT NULL CHECK (status IN ('open','in_progress','blocked','done','cancelled')),
  priority        text NOT NULL CHECK (priority IN ('low','normal','high','urgent')),
  assignee_id     uuid REFERENCES principals,
  created_by      uuid NOT NULL REFERENCES principals,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  due_at          timestamptz,
  completed_at    timestamptz,
  link            jsonb,                              -- TaskLink
  source          text NOT NULL CHECK (source IN ('manual','automation')),
  run_id          uuid,
  version         int  NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, task_no),
  CHECK ((status = 'done') = (completed_at IS NOT NULL))
);
CREATE INDEX tasks_assignee ON tasks (workspace_id, assignee_id, status);

CREATE TABLE task_comments (
  comment_id uuid PRIMARY KEY,
  task_id    uuid NOT NULL REFERENCES tasks,
  author_id  uuid NOT NULL REFERENCES principals,
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL
);

CREATE TABLE task_history (
  task_id    uuid NOT NULL REFERENCES tasks,
  version    int  NOT NULL,
  actor_id   uuid NOT NULL REFERENCES principals,
  at         timestamptz NOT NULL,
  changed    text[] NOT NULL,
  PRIMARY KEY (task_id, version)
);
```

Reporting views (`rpt_*`) are specified in section 13.

**Transaction and lock order (Guarantee: no deadlock cycle).** Every Suite write runs in one `sql.withTransaction`
and takes locks in this order, skipping what it does not need: (1) `workspace_chain` FOR UPDATE (only when the action
also commits a node change; the change log's own transaction nests as a savepoint), (2) the `action_idempotency` row
(INSERT ... ON CONFLICT DO NOTHING, then SELECT ... FOR UPDATE), (3) `ledger_accounts` by ascending `account_id`,
(4) `product_inventory` by ascending `product_id`, (5) `promotion_usage` by ascending `promotion_id`, (6) the target
order, cart, thread or task row, (7) `suite_counters`, (8) `domain_chain` FOR UPDATE, appended last. Commit then
`NOTIFY plinth_domain, '<workspace_id>'` (K7).

**Domain event hash (Guarantee).** `hash = sha256(canonicalize({ workspace_id, seq, type, occurred_at, actor,
on_behalf_of, approved_by, surface, audience, subject_kind, subject_id, member, payload, cause, prev_hash }))` with
the kernel `canonicalize`, subjects as text and `prev_hash` hex; genesis is the kernel `GENESIS_HASH`. `domain_chain`
holds the head. `GET /suite/audit/verify` recomputes both chains.

## 3. Authorization

### 3.1 Vocabulary

The kernel permission pattern (`grant.ts`) now accepts the 34 `SUITE_PERMISSIONS` (`permissions.ts`) beside the
kernel ones. Suite permissions are checked on the module resource `plinth://<ws>/suite/<module>` (`SUITE_MODULES`),
so a grant on the prefix `plinth://<ws>/suite/` covers every module. Configuration kinds keep the kernel
`node:read|write|delete` on node URIs and kind prefixes (`plinth://<ws>/Promotion/`).

| Permission | Allows |
|---|---|
| `suite:use` | Read catalogue, badges, feed, directory, profiles, own activity, search, calendar, home. |
| `messages:use` / `messages:broadcast` | Read own threads, send, reply, mark / send to `broadcast_min_recipients` or more. |
| `notifications:use` / `notifications:send` | Own feed and preferences / ad-hoc notifications to others. |
| `points:use` / `points:transfer` | Own balance and statement / transfers. |
| `points:award` | Award points from issuance (held above `manager_max_per_award`). |
| `points:adjust` | Corrections and reversals; approves held awards. |
| `points:view-all` | Any member's points (row predicate applies). |
| `points:ledger` | System accounts, trial balance. |
| `store:shop` | Cart, checkout, wishlist, reviews, own orders, cancel within window. |
| `store:orders` | All orders (row predicate applies); fulfil, ship, deliver, cancel. |
| `store:approve` | Approve high-value orders. |
| `store:refund` | Refund shipped or delivered orders. |
| `store:inventory` / `store:moderate` | Stock / review moderation. |
| `badges:award` / `badges:revoke` | Manual awards / revocation. |
| `promotions:simulate` / `promotions:manage` / `promotions:approve` | List, simulate, analytics / transition / approve activation. |
| `automation:manage` | List, dry-run, toggle, run, retry, cancel. |
| `content:author` / `content:review` / `content:publish` | Draft and submit / approve or request changes / publish, schedule, archive. |
| `people:view-private` | Emails, other members' sessions and delivery logs. |
| `segments:preview` | Evaluate rules and list segment members. |
| `tasks:use` / `tasks:manage` | Own tasks / all tasks, assign others. |
| `audit:view` | Full audit timeline and other people's events. |
| `admin:members` / `admin:roles` / `admin:settings` | Members and sessions / role membership (and approving it) / Program and external automations. |

### 3.2 Row predicates on Suite permissions

A Suite grant's `row_predicate` is evaluated against the **target member's facts** (`{ handle, region, tier,
department }`) with the kernel expression grammar restricted to `=`, `!=`, `in`, `and`, `or`, `not` and literals,
by a new pure function `evalRowPredicate(pred, facts) -> boolean` in `@plinth/query` (K9). Actions that target a
member (award, view another statement, orders of a member, approve an order) apply it; list actions with `scope=all`
filter by it in SQL (`region = 'EMEA'` becomes a `WHERE` on the member's region). Reporting sources apply it through the
compiler as today (every view has `region`).

### 3.3 Roles

Roles are `Role` nodes (`SUITE_ROLES`: member, manager, content-editor, marketing-manager, finance, admin). A Grant may
name `principal: "role:<slug>"`; it then applies to every subject in that Role's `spec.members`. A role member with
`scope: { region }` inherits every grant of that role with ` and region = '<region>'` appended to its row predicate
(`region = '<region>'` when the grant had none). The seeded role grants are `ROLE_GRANTS` in `permissions.ts`; each
template becomes Grant `role-<role>-<suffix>` with `resource = "plinth://<ws>/" + template.resource`. The agent role
is not a Role node: it is the agent ceiling (3.7).

### 3.4 `owner_only` grants

A Grant with `owner_only: true` matches a node only when that node's `spec.owner` equals the effective principal.
The Authorizer request gains `context.owner?: string` (the target node's `spec.owner`, read by the change log before
authorizing). Used for `Preference/` (members write only their own preferences).

### 3.5 Authorizer changes (K2)

- The snapshot also loads every non-deleted Role node: `roleMembers: Map<subject, Array<{ role, scope }>>`.
- `authorize` collects candidate grants whose `principal` is the effective subject **or** `role:<r>` for a role the
  effective subject holds; role grants get the scope predicate ANDed as in 3.3.
- `owner_only` grants match only when `context.owner === effective`.
- `grant_index_version` is bumped by any commit touching a Grant or Role node, so `policy_hash` changes and the
  per-principal query cache keys change.
- `checkApprover` takes the approver permission from `APPROVER_PERMISSION[rule_id]` (stored in
  `change_approvals.approver_permission` and `action_approvals.approver_permission`) instead of the hard-coded
  `grant:write`; checks 1 to 3 (human, not requester, not on_behalf_of) are unchanged.

### 3.6 Roles and permissions matrix

`●` granted on `plinth://<ws>/suite/` (all regions unless the member has a scope). Maya Ortiz holds admin + manager +
member; the agent's column is its ceiling intersected with Maya's grants. "held" means the agent's call is filed for
approval (registry `agent: "approval"`).

| Permission | member | manager | content-editor | marketing-manager | finance | admin | agent (ceiling ∩ Maya) |
|---|---|---|---|---|---|---|---|
| suite:use, messages:use, notifications:use, points:use, store:shop, tasks:use | ● | (via member) | (via member) | (via member) | (via member) | (via member) | ● (checkout held) |
| points:transfer | ● | | | | | | held |
| points:award | | ● | | | | | held |
| points:view-all | | ● | | | ● | | ● |
| points:adjust, points:ledger | | | | | ● | | no |
| store:orders | | ● | | | | ● | ● (refund held) |
| store:approve | | ● | | | ● | | no (approval:decide is human-only) |
| store:refund | | | | | ● | | no |
| store:inventory, store:moderate | | | | | | ● | no |
| badges:award | | ● | | | | ● | held |
| badges:revoke | | | | | | ● | no |
| notifications:send, messages:broadcast | | ● | | ● | | | notifications:send ● |
| promotions:simulate | | | | ● | ● | | ● |
| promotions:manage | | | | ● | | | ● (activation held under R-PROMO-ACTIVATE) |
| promotions:approve | | | | | ● | | no |
| automation:manage | | | | ● | | | ● (enable held) |
| content:author | | | ● | | | | ● |
| content:review | | | | ● | | | no |
| content:publish | | | ● | ● | | | no |
| segments:preview | | ● | ● | ● | | ● | ● |
| tasks:manage | | ● | | | | ● | ● |
| audit:view | | ● | | ● | ● | ● | ● |
| people:view-private | | | | | | ● | no |
| admin:members, admin:roles, admin:settings | | | | | | ● | no |
| approval:decide | | suite/ | | | suite/, Promotion/, Program/ | suite/, Role/, Program/ | never |
| node:write on kinds | Preference, Page, Widget (own, `owner_only`) | | Content | Promotion, Segment, Automation, Group, Content, Page, Widget | | Product, Category, Badge, Role, Program, Group, Page, Widget | Promotion, Automation, Content, Segment, Product, Category, Badge, Group, Page, Widget (system pages held) |
| query:run on Source/, node:read Dashboard/ | | ● | | ● | ● | (Maya: ops-lead-all) | ● |

Seeded people (section 11.2): Maya Ortiz `user:ops-lead` (admin, manager); Jonas Becker `user:emea-lead` (manager,
scope EMEA); Priya Nair `user:finance-analyst` (finance); Tomás Alvarez `user:marketing-lead` (marketing-manager); Leah
Okafor `user:content-editor` (content-editor); Samir Haddad `user:it-admin` (admin). Every human is in `member`.
The existing kernel grants (`ops-lead-all`, the finance-board grants, Jonas's EMEA row grant on the ops board) stay.

### 3.7 The agent

`agent:claude-code` acts for Maya. Its ceiling is the kernel `AGENT_CEILING` plus `AGENT_SUITE_CEILING`. It never
holds `approval:decide`, `admin:*`, `points:adjust`, `points:ledger`, `promotions:approve`, `content:review`,
`content:publish`, `store:refund` or `people:view-private`. For actions, the registry's `agent` field decides:
`direct` (reads), `preview` (dry run then commit with the token), `approval` (dry run, then the commit is filed in
`action_approvals`), `deny` (`FORBIDDEN`, `details.reason = "ceiling_denies"`). `orders.transition` with
`transition: "refund"` is approval-held for agents even though the action is `preview`.

### 3.8 Commit rules and approvers (K4, K5)

The closed commit-rule table gains `SUITE_COMMIT_RULES` (`permissions.ts`). Rules marked `applies: "all"` classify
every non-system principal (as R-GRANT does today); `agent` rows only agents (humans commit those under
`R-HUMAN-DIRECT`, authorised by grants alone); `system` rows only the system surface (scheduler).

| Rule | Class | Applies | Approver needs (besides `approval:decide`) |
|---|---|---|---|
| R-PRODUCT-CREATE, R-PRODUCT-EDIT | auto | agent | |
| R-PRODUCT-PRICE | approval | agent | `store:inventory` |
| R-BADGE-CREATE | auto | agent | |
| R-BADGE-EDIT | approval | agent | `badges:award` |
| R-PROMO-CREATE | auto | agent | |
| R-PROMO-EDIT | auto | all | |
| R-PROMO-ACTIVATE | approval | all | `promotions:approve` |
| R-PROMO-CONTROL | auto | all | |
| R-PROMO-SCHEDULE | auto | system | |
| R-AUTOMATION-CREATE, R-AUTOMATION-EDIT | auto | agent | |
| R-AUTOMATION-ENABLE | approval | agent | `automation:manage` |
| R-AUTOMATION-EXTERNAL | approval | all | `admin:settings` |
| R-CONTENT-CREATE, R-CONTENT-EDIT | auto | agent | |
| R-CONTENT-STATUS | auto | all | |
| R-SEGMENT, R-GROUP | auto | agent | |
| R-ROLE | approval | all | `admin:roles` |
| R-WIDGET | auto | agent | |
| R-PAGE | auto | agent | |
| R-PAGE-SYSTEM | approval | agent | `admin:settings` |
| R-PREFERENCE | auto | all | |
| R-PROGRAM | approval | all | `admin:settings` |
| R-SITE | auto | all | |

R-SITE: the `site.*` actions (5A.5) commit Page, Widget and Program nodes with `managed: { by }`; their `admin:settings` check stands in for the per-node rules (R-PAGE-SYSTEM, R-PROGRAM, R-DELETE-OTHER). `managed` is set only by action handlers, so POST /changes and the MCP node verbs keep every rule above. `site.clear` is also the only path that may delete a system Page (`checkSuiteDelete`), and the site actions may recreate a slug that `site.clear` soft-deleted.

Held Suite node changes use the kernel `change_approvals` table and appear in the approvals inbox as type `change`.

## 4. The condition grammar

### 4.1 Grammar

`CondTree = Condition | { all: CondTree[1..20] } | { any: CondTree[1..20] } | { not: CondTree }` and
`Condition = { field: FactPath, op: CondOp, value? }` (`conditions.ts`). Maximum depth 4 (validation refuses
deeper); the UI builder offers depth 3.

| op | value | true when |
|---|---|---|
| `eq`, `ne` | scalar | equal / not equal (strings case-sensitive) |
| `lt`, `lte`, `gt`, `gte` | number or timestamp | ordered comparison |
| `between` | `[lo, hi]` | `lo <= x <= hi` |
| `in`, `not_in` | array | membership |
| `contains`, `not_contains` | scalar | the fact is an array (`string[]`) containing / not containing the value |
| `exists`, `not_exists` | none | the fact is present and not null / absent or null |

### 4.2 Facts

- Segments and promotion `eligibility.filter`: `MEMBER_FACTS` (14 facts, `conditions.ts`), computed per member:
  `tier` and `lifetime_points` from `ledger_accounts`; `balance`; `points_earned_30d` and `points_redeemed_30d` from
  member entries in the last 30 virtual days (credits of earning types; debits of type purchase); `orders_90d` from
  non-cancelled `store_orders`; `badges_count`/`badges` from live `badge_awards`; `groups` from Group nodes; `roles`
  from Role nodes; `department`, `region`, `joined_days`, `last_active_days` from `members`.
- Automation conditions and badge filters: `event.<payload field>` (the trigger event's payload, `DOMAIN_EVENT_PAYLOADS`),
  `member.<fact>` (facts of the event's `member_id`), `now`.

### 4.3 Evaluator (Guarantee: pure and total)

`evalCond(tree: CondTree, facts: Record<string, unknown>) -> boolean` in `@plinth/core`. A missing fact makes every
comparison false except `not_exists` (and `ne`, `not_in`, `not_contains`, which are true); type mismatches are false,
never errors (validation already refused mistyped rules for known facts). `all` of an empty list is impossible
(schema min 1). No I/O, no clock: `now` is passed in.

## 5. Action registry and the HTTP surface

`ACTIONS` in `packages/spec/src/suite/actions.ts` is the single list of domain operations: 115 actions in 21 modules
(72 reads, 43 mutating). The API mounts one route per entry; the per-module endpoint lists in
sections 7 to 12 are generated from it. Two generic routes complete the surface:

- `GET /suite/actions` (`ActionsListIn` -> `ActionsListOut`): the catalogue, filtered by what the viewer may call.
- `POST /suite/actions/:name` (`ActionInvokeIn` -> `ActionInvokeOut`): invoke any entry by name with the agent
  discipline (`dry_run` returns an `ActionPreview` with a `preview_token`; a commit with the token runs exactly the
  previewed input). The MCP tool `action.invoke` is this route.

Handler contract (backend). One Effect per action: decode input (path + query or body), authenticate, enforce the
session, authorise the permission on the module resource (and row predicate when the action targets a member),
then run the domain transaction in the lock order of 2.4, append domain events, commit, NOTIFY. Agent principals go
through the `agent` policy before the handler: `preview` and `approval` actions without a token return
`PREVIEW_REQUIRED` (428) with `suggestion: { kind: "call", tool: "action.invoke", arguments: { action, input,
dry_run: true } }`. Preview tokens reuse the kernel `preview_tokens` table with `payload = { kind: "action", action,
input }`, `change_hash = sha256(canonical(input))`, single use, `PLINTH_PREVIEW_TTL_S`.

Every action's events are appended with `actor` = the calling principal, `on_behalf_of` = its delegator for agents,
`surface` = `ui` (browser, the default for the web client), `api`, `mcp` or `system` (engines and scheduler).

## 5A. Domains, widgets and pages

### 5A.1 The model

- A **domain** is a slice of the suite with its own actions, events and nodes: reporting, messaging, notifications,
  people, search, points, store, badges, promotions, automation, content, segments, calendar, approvals, tasks, audit,
  admin, settings, pages.
- A **widget** is one of a domain's self-contained mini-apps (`WIDGET_CATALOGUE` in
  `packages/spec/src/suite/widgets.ts`, 77 widgets). Each has an id `<domain>.<name>`, a typed **config schema**,
  **size variants** (`s`, `m`, `l`, `xl`, `full`, with grid footprints in `SIZE_GRID`), **internal views** it switches
  between itself (a `store.catalog` browses, filters, opens a product and adds to cart without leaving the page), the
  **actions** it calls, the **events** it reacts to, the **page-bus topics** it publishes and subscribes, and the
  **permission** without which the host renders it as unavailable.
- A **Widget node** is a configured instance: `{ widget: "store.catalog", config: {...}, title?, owner? }`. It
  generalises the kernel Panel: the reporting visuals (`reporting.bar`, `reporting.line`, `reporting.table`, ...) carry
  exactly a Panel's `query` and `visual`, and existing Panels remain placeable on Pages (rendered by `reporting.panel`).
- A **Page node** lays instances out on the 12-column grid: `items: [{ item: "widget:<slug>" | "panel:<slug>", at:
  {x,y,w,h}, size? }]`, optionally serving an app `route` (with `:params`) and a navigation entry (`nav`). Seeded
  module pages (`/store`, `/messages`, `/promotions/:slug`, ...) are `system: true`; `home` and `profile` are pages
  too. A member may **personalise** a page (`pages.personalize`): the page and its widgets are copied to owner-only
  nodes (`home.maya-ortiz`) that `pages.resolve` then serves to that member; `pages.reset` deletes the copy.
- Existing Dashboards stay valid and render through `reporting.board`; `/d/<slug>` keeps working (UI-MAP 2).

### 5A.2 Config conventions

- **Route binding.** Any config value typed as bindable may be `{ "param": "<name>" }`; the host substitutes the
  route parameter before mounting. `pages.resolve` returns the params it extracted from the path.
- **Member targets.** `"$me"` is the viewing member; a handle names a member; a binding takes it from the route
  (`/people/:handle`).
- **Link groups.** `link_group` (default `"page"`) scopes the page bus: an inbox and a thread widget with the same
  group are linked; two pairs on one page can be kept apart.
- **Validation.** The server validates every Widget node's config against the catalogue schema (section 2.3). The
  client gets the same JSON Schemas from `packages/web/src/core/widget-schemas.js` (generated by `pnpm schema:gen`)
  and from `GET /suite/widgets`; the page editor builds config forms from them.

### 5A.3 How widgets interact

Widgets never import each other. They interact three ways, all specified:

1. **Domain events** (section 6). Checking out in `store.cart` commits one transaction that emits `order.placed`,
   `points.posted`, `stock.changed`, `notification.created` and `cart.updated`; `points.balance`, `store.catalog`,
   `notifications.feed`, the bell and the cart count anywhere on screen update from those events. A widget subscribes
   through `ctx.rt.on(type, handler)` and must re-read through its own actions when an event names something it shows.
2. **The page bus** (`BUS_TOPICS`): `ctx.bus.publish(topic, { id })` / `ctx.bus.subscribe(topic, handler)`, scoped by
   link group. Selecting a thread in `messaging.inbox` publishes `thread.selected`; `messaging.thread` on the same
   page shows it. Brushing a `reporting.line` publishes `date.selected`; other reporting widgets with the same group
   filter to it.
3. **Navigation** (`ctx.nav.go(path)`) for "open in its own page" affordances, governed by each widget's `open_in`
   config where present.

### 5A.4 Server side of pages

- `GET /suite/pages/resolve?path=/store/c/apparel` (`pages.resolve`): match `path` against page routes (exact routes
  before parameterised ones, then longer static prefixes first), prefer the viewer's personal copy, read every item
  (Widget nodes; Panel items become a synthesised `reporting.panel` instance), apply the widget permission and node
  read checks per item (`available: false` with `unavailable_reason` instead of failing the page), and return
  `ResolveOut`. Unknown path: `UNKNOWN_REFERENCE`.
- `GET /suite/pages` (`pages.list`) feeds the side navigation: every readable page with a `nav` entry, filtered by
  `nav.permission`.
- Pages and widgets are written with the kernel `POST /changes` (humans) and `node.preview`/`node.commit` (agent),
  with the rules R-WIDGET, R-PAGE, R-PAGE-SYSTEM. The kernel MCP `node.preview` `place` argument (today: place a
  Panel on a Dashboard) also accepts a Page (`place: { page: "page:home", at? }`) and places a Widget there (K10).

### 5A.5 The agent composes pages

`schema.describe({ kind: "Widget" })` returns the catalogue (ids, descriptions, sizes, config JSON Schemas, an
example per widget); `schema.describe({ kind: "Page" })` returns the Page schema and the example. A typical sequence:
preview a `Widget` `{ widget: "points.balance", config: { member: "$me" } }` with `place: { page: "page:home" }`,
commit; every open home re-renders through the change stream. Editing a system page (a module page) is held for an
admin (R-PAGE-SYSTEM); personal and custom pages are auto.

The site can also be cleared and rebuilt piece by piece through the `site.*` actions (`action.invoke` over MCP, or
`POST /suite/actions/:name`), all under `admin:settings`: `site.clear` (dry run, then commit) deletes every Page and
Widget; `site.restore { pages? }` recreates the default pages from `default-pages.ts` (shared with the seed), skipping
what exists; `site.page.put` upserts a Page with its widgets; `site.widget.add` places a widget in the first free slot
of the 12-column grid; `site.widget.remove` removes one; `site.appearance.set` stores `appearance: { look, density? }` on
the Program node (absent means `calm` and `comfortable`) and `site.appearance.get` reads it. Each is an ordinary
change-log commit, so open browsers fill in live (UI-MAP 2.1). `pnpm tsx scripts/rebuild-live.ts` drives the sequence.

### 5A.6 Widget catalogue

Generated from `WIDGET_CATALOGUE`. Config field types use the names in Appendix A; every config also accepts
`link_group`. "realtime: changes" means the widget re-reads when the change stream names a node of that kind.

#### Domain `reporting` (package D)

- **`reporting.table`** Table report: Sortable, paged table over any source the viewer may query.
  - config: `{ query: QueryAst; visual: TableVisual; dashboard?: string; params?: Record<string, string \| number \| boolean>; link_group?: string }`
  - sizes: s, m, l (default), xl, full · views: chart, table, inspector · permission: `query:run`
  - actions: `query.run`
  - realtime: changes: changes on the Source's partitions (watermark) and on the instance node
  - bus: publishes filter.changed; subscribes filter.changed, date.selected
- **`reporting.bar`** Bar chart: Bar chart over a query; click a bar to publish a filter.
  - config: `{ query: QueryAst; visual: BarVisual; dashboard?: string; params?: Record<string, string \| number \| boolean>; link_group?: string }`
  - sizes: s, m, l (default), xl, full · views: chart, table, inspector · permission: `query:run`
  - actions: `query.run`
  - realtime: changes: changes on the Source's partitions (watermark) and on the instance node
  - bus: publishes filter.changed; subscribes filter.changed, date.selected
- **`reporting.line`** Line chart: Time series with brushing; brushing publishes date.selected.
  - config: `{ query: QueryAst; visual: LineVisual; dashboard?: string; params?: Record<string, string \| number \| boolean>; link_group?: string }`
  - sizes: s, m, l (default), xl, full · views: chart, table, inspector · permission: `query:run`
  - actions: `query.run`
  - realtime: changes: changes on the Source's partitions (watermark) and on the instance node
  - bus: publishes filter.changed; subscribes filter.changed, date.selected
- **`reporting.area`** Area chart: Stacked or single area over time.
  - config: `{ query: QueryAst; visual: AreaVisual; dashboard?: string; params?: Record<string, string \| number \| boolean>; link_group?: string }`
  - sizes: s, m, l (default), xl, full · views: chart, table, inspector · permission: `query:run`
  - actions: `query.run`
  - realtime: changes: changes on the Source's partitions (watermark) and on the instance node
  - bus: publishes filter.changed; subscribes filter.changed, date.selected
- **`reporting.heatmap`** Heatmap: Two-dimensional heatmap with threshold hatching.
  - config: `{ query: QueryAst; visual: HeatmapVisual; dashboard?: string; params?: Record<string, string \| number \| boolean>; link_group?: string }`
  - sizes: s, m, l (default), xl, full · views: chart, table, inspector · permission: `query:run`
  - actions: `query.run`
  - realtime: changes: changes on the Source's partitions (watermark) and on the instance node
  - bus: publishes filter.changed; subscribes filter.changed, date.selected
- **`reporting.scatter`** Scatter plot: Scatter of two measures.
  - config: `{ query: QueryAst; visual: ScatterVisual; dashboard?: string; params?: Record<string, string \| number \| boolean>; link_group?: string }`
  - sizes: s, m, l (default), xl, full · views: chart, table, inspector · permission: `query:run`
  - actions: `query.run`
  - realtime: changes: changes on the Source's partitions (watermark) and on the instance node
  - bus: publishes filter.changed; subscribes filter.changed, date.selected
- **`reporting.kpi`** KPI tile: One figure with delta and sparkline.
  - config: `{ query: QueryAst; visual: KpiVisual; dashboard?: string; params?: Record<string, string \| number \| boolean>; link_group?: string }`
  - sizes: s, m, l (default), xl, full · views: chart, table, inspector · permission: `query:run`
  - actions: `query.run`
  - realtime: changes: changes on the Source's partitions (watermark) and on the instance node
  - bus: publishes filter.changed; subscribes filter.changed, date.selected
- **`reporting.panel`** Saved panel: Embeds an existing kernel Panel node by reference.
  - config: `{ panel: panel:<slug>; dashboard?: string; link_group?: string }`
  - sizes: s, m, l (default), xl, full · views: chart, table, inspector · permission: `query:run`
  - actions: `query.run`
  - realtime: changes: Panel
  - bus: publishes filter.changed; subscribes filter.changed
- **`reporting.board`** Board: A whole existing Dashboard (Meridian board) with its trace ribbon.
  - config: `{ dashboard: string; link_group?: string }`
  - sizes: full (default) · views: board, inspector · permission: `query:run`
  - actions: `query.run`
  - realtime: changes: Dashboard, changes: Panel
- **`reporting.suite-kpis`** Programme KPIs: Strip of programme figures (points issued and redeemed today, orders today, active members, badges) with 14-day sparklines.
  - config: `{ metrics: ("points_issued_today" \| "points_redeemed_today" \| "orders_today" \| "active_members_7d" \| "badges_awarded_7d" \| "members_total")[]; link_group?: string }`
  - sizes: m, l, xl (default), full · views: strip · permission: `suite:use`
  - actions: `home.summary`
  - realtime: `points.posted`, `order.placed`, `badge.awarded`

#### Domain `messaging` (package A)

- **`messaging.inbox`** Inbox: Folders, thread list, search, bulk star/archive/read; selecting a thread publishes thread.selected or opens the thread view inside the widget.
  - config: `{ folder?: "inbox" \| "sent" \| "starred" \| "archived"; unread_only?: boolean; page_size?: Int; open_in?: "widget" \| "bus"; link_group?: string }`
  - sizes: m, l (default), xl, full · views: list, search, thread · permission: `messages:use`
  - actions: `messages.list`, `messages.thread`, `messages.state`, `messages.bulk_state`, `messages.reply`
  - realtime: `message.received`, `message.sent`, `message.state_changed`
  - bus: publishes thread.selected; subscribes thread.selected
- **`messaging.thread`** Conversation: One thread with replies, mentions, attachments metadata, read receipts and a reply box.
  - config: `{ thread?: UUID \| ParamBinding; link_group?: string }`
  - sizes: l, xl (default), full · views: thread, empty · permission: `messages:use`
  - actions: `messages.thread`, `messages.reply`, `messages.state`, `messages.recipients`
  - realtime: `message.received`, `message.state_changed`
  - bus: publishes member.selected; subscribes thread.selected
- **`messaging.compose`** Compose: Recipient picker (people and groups), subject, body with @mentions, attachments metadata, send.
  - config: `{ to?: Recipient[]; subject?: string; collapsed?: boolean; link_group?: string }`
  - sizes: m, l (default), xl · views: form, sent · permission: `messages:use`
  - actions: `messages.recipients`, `messages.send`
  - bus: publishes thread.selected; subscribes member.selected
- **`messaging.unread`** Unread messages: Count plus the latest three unread threads.
  - config: `{ link_group?: string }`
  - sizes: s (default), m · views: summary · permission: `messages:use`
  - actions: `messages.list`
  - realtime: `message.received`, `message.state_changed`
  - bus: publishes thread.selected; subscribes none

#### Domain `notifications` (package A)

- **`notifications.feed`** Notifications: Feed with type filters, mark read, mark all read; rows link to their subject.
  - config: `{ filter?: "all" \| "unread"; types?: NotificationType[]; page_size?: Int; link_group?: string }`
  - sizes: m, l (default), xl, full · views: list · permission: `notifications:use`
  - actions: `notifications.list`, `notifications.read`, `notifications.read_all`
  - realtime: `notification.created`, `notification.read`
- **`notifications.preferences`** Notification preferences: Per type and channel (in-app, email, digest) matrix, digest schedule, quiet hours.
  - config: `{ link_group?: string }`
  - sizes: l, xl (default), full · views: matrix · permission: `notifications:use`
  - actions: `me.preferences.get`, `me.preferences.update`
  - realtime: changes: Preference
- **`notifications.deliveries`** Email and digest log: What the email stub and digests sent, with suppression reasons.
  - config: `{ channel?: "email" \| "digest"; member?: Handle; link_group?: string }`
  - sizes: l (default), xl · views: list, detail · permission: `notifications:use`
  - actions: `notifications.deliveries`
  - realtime: `notification.created`
  - bus: publishes none; subscribes member.selected
- **`notifications.send`** Send a notice: Ad-hoc notification to people and groups.
  - config: `{ link_group?: string }`
  - sizes: m (default), l · views: form · permission: `notifications:send`
  - actions: `messages.recipients`, `notifications.send`

#### Domain `people` (package A)

- **`people.directory`** Directory: Searchable, filterable member directory as grid or table.
  - config: `{ region?: Region; tier?: Tier; group?: string; view?: "grid" \| "table"; page_size?: Int; link_group?: string }`
  - sizes: l, xl (default), full · views: grid, table · permission: `suite:use`
  - actions: `people.directory`
  - realtime: `member.updated`, `tier.changed`
  - bus: publishes member.selected; subscribes filter.changed
- **`people.profile-card`** Profile card: Identity, avatar, title, region, tier, groups, roles, contact actions (message, award).
  - config: `{ member: MemberTarget; link_group?: string }`
  - sizes: s, m (default), l · views: card, edit · permission: `suite:use`
  - actions: `people.profile`, `me.profile.update`
  - realtime: `member.updated`, `tier.changed`
  - bus: publishes member.selected; subscribes member.selected
- **`people.activity`** Activity timeline: A member's activity (own: everything; others: public events).
  - config: `{ member: MemberTarget; types?: DomainEventType[]; page_size?: Int; link_group?: string }`
  - sizes: m, l (default), xl · views: timeline · permission: `suite:use`
  - actions: `people.activity`, `me.activity`
  - realtime: `badge.awarded`, `points.posted`, `content.published`, `review.created`, `order.placed`
  - bus: publishes none; subscribes member.selected
- **`people.group`** Group: A group's description, managers and members.
  - config: `{ group: string \| ParamBinding; link_group?: string }`
  - sizes: m, l (default), xl · views: members · permission: `suite:use`
  - actions: `groups.get`
  - realtime: changes: Group
  - bus: publishes member.selected; subscribes none
- **`people.groups`** Groups: All groups with membership markers.
  - config: `{ link_group?: string }`
  - sizes: m (default), l · views: list · permission: `suite:use`
  - actions: `groups.list`
  - realtime: changes: Group
- **`people.sessions`** Security sessions: Own browser and MCP sessions with revoke.
  - config: `{ link_group?: string }`
  - sizes: m, l (default) · views: list · permission: `authenticated`
  - actions: `me.sessions`, `me.sessions.revoke`
  - realtime: `session.revoked`

#### Domain `search` (package A)

- **`search.results`** Search results: Grouped global search results with type filters.
  - config: `{ q: string \| ParamBinding; types?: string[]; link_group?: string }`
  - sizes: l, xl, full (default) · views: grouped · permission: `suite:use`
  - actions: `search.global`

#### Domain `points` (package B)

- **`points.balance`** Points balance: Balance with live animation, tier and progress to next tier, expiring soon.
  - config: `{ member: MemberTarget; show_tier?: boolean; show_expiring?: boolean; link_group?: string }`
  - sizes: s, m (default), l · views: summary · permission: `points:use`
  - actions: `points.summary`
  - realtime: `points.posted`, `tier.changed`
  - bus: publishes none; subscribes member.selected
- **`points.ledger`** Statement: Statement lines with filters, opening/closing balances, and transaction detail (entries, lots) inside the widget.
  - config: `{ member: MemberTarget; types?: TxnType[]; page_size?: Int; link_group?: string }`
  - sizes: l, xl (default), full · views: lines, transaction · permission: `points:use`
  - actions: `points.statement`, `points.transaction`
  - realtime: `points.posted`
  - bus: publishes order.selected; subscribes member.selected
- **`points.transfer`** Transfer points: Recipient, amount within limits, memo, confirm with balance after.
  - config: `{ to?: Handle \| ParamBinding; link_group?: string }`
  - sizes: m (default), l · views: form, confirm, done · permission: `points:transfer`
  - actions: `people.directory`, `points.summary`, `points.transfer`
  - realtime: `points.posted`
  - bus: publishes none; subscribes member.selected
- **`points.award`** Award points: Manager award to one or many members with category and reason; shows promotion multipliers and approval hold.
  - config: `{ to?: Handle[]; link_group?: string }`
  - sizes: m, l (default) · views: form, confirm, done · permission: `points:award`
  - actions: `people.directory`, `points.award`
  - bus: publishes none; subscribes member.selected
- **`points.expiry`** Expiry schedule: Points expiring by date.
  - config: `{ member: MemberTarget; link_group?: string }`
  - sizes: s, m (default), l · views: list · permission: `points:use`
  - actions: `points.expiry`
  - realtime: `points.posted`, `points.expiring`
- **`points.tiers`** Tiers: Tier ladder with perks, member counts and the viewer's position.
  - config: `{ link_group?: string }`
  - sizes: m, l (default), xl · views: ladder · permission: `suite:use`
  - actions: `points.tiers`, `points.summary`
  - realtime: `tier.changed`
- **`points.trial-balance`** Trial balance: Ledger invariants and system account balances (finance).
  - config: `{ link_group?: string }`
  - sizes: m, l (default) · views: summary · permission: `points:ledger`
  - actions: `ledger.trial_balance`
  - realtime: `points.posted`
- **`points.accounts`** Ledger accounts: All accounts with balances; open one to see its statement inside the widget; reverse a transaction.
  - config: `{ kind?: "member" \| "system"; link_group?: string }`
  - sizes: l, xl (default), full · views: accounts, statement, transaction · permission: `points:ledger`
  - actions: `ledger.accounts`, `points.statement`, `points.transaction`, `ledger.reverse`
  - realtime: `points.posted`
  - bus: publishes member.selected; subscribes none

#### Domain `store` (package B)

- **`store.catalog`** Catalogue: Browse, filter, sort, search; add to cart and wishlist in place; product detail opens inside the widget or publishes product.selected.
  - config: `{ category?: string \| ParamBinding; tag?: string; sort?: "featured" \| "price_asc" \| "price_desc" \| "rating" \| "newest"; affordable_only?: boolean; show_filters?: boolean; page_size?: Int; open_in?: "widget" \| "bus" \| "page"; link_group?: string }`
  - sizes: l, xl, full (default) · views: grid, filters, product · permission: `suite:use`
  - actions: `store.categories`, `store.catalog`, `store.product`, `cart.set_item`, `wishlist.add`, `wishlist.remove`
  - realtime: `stock.changed`, `cart.updated`, `wishlist.changed`, `review.created`, `promotion.state_changed`
  - bus: publishes product.selected; subscribes filter.changed
- **`store.product`** Product: Artwork, price, stock, tier gate, add to cart, wishlist, reviews with histogram, write a review.
  - config: `{ product?: string \| ParamBinding; link_group?: string }`
  - sizes: l, xl, full (default) · views: detail, reviews, write-review · permission: `suite:use`
  - actions: `store.product`, `store.reviews`, `store.review_create`, `cart.set_item`, `wishlist.add`, `wishlist.remove`
  - realtime: `stock.changed`, `review.created`, `cart.updated`, `wishlist.changed`
  - bus: publishes none; subscribes product.selected
- **`store.featured`** Featured rewards: A row of featured or category products.
  - config: `{ category?: string; limit?: Int; link_group?: string }`
  - sizes: m, l, xl (default), full · views: row · permission: `suite:use`
  - actions: `store.catalog`, `cart.set_item`
  - realtime: `stock.changed`
  - bus: publishes product.selected; subscribes none
- **`store.cart`** Cart: Lines with quantity steppers and issues, live quote with promotions, checkout flow (delivery, confirm, placed) inside the widget.
  - config: `{ compact?: boolean; link_group?: string }`
  - sizes: s, m, l (default), xl · views: lines, quote, delivery, confirm, placed · permission: `store:shop`
  - actions: `cart.get`, `cart.set_item`, `cart.clear`, `checkout.quote`, `checkout.place`
  - realtime: `cart.updated`, `stock.changed`, `points.posted`, `promotion.state_changed`
  - bus: publishes order.selected; subscribes none
- **`store.orders`** Orders: Own orders, or all orders for store staff, with status filters and transitions; detail inside the widget.
  - config: `{ scope?: "mine" \| "all"; status?: OrderStatus[]; requires_approval?: boolean; page_size?: Int; link_group?: string }`
  - sizes: m, l, xl (default), full · views: list, order · permission: `store:shop`
  - actions: `orders.list`, `orders.get`, `orders.transition`
  - realtime: `order.placed`, `order.status_changed`
  - bus: publishes order.selected; subscribes member.selected
- **`store.order`** Order: One order: lines, promotions, timeline, allowed transitions.
  - config: `{ order?: UUID \| ParamBinding; link_group?: string }`
  - sizes: l, xl (default), full · views: detail · permission: `store:shop`
  - actions: `orders.get`, `orders.transition`
  - realtime: `order.status_changed`
  - bus: publishes none; subscribes order.selected
- **`store.wishlist`** Wishlist: Saved products with stock and affordability; move to cart.
  - config: `{ link_group?: string }`
  - sizes: m, l (default), xl · views: list · permission: `store:shop`
  - actions: `wishlist.list`, `wishlist.remove`, `cart.set_item`
  - realtime: `wishlist.changed`, `stock.changed`
  - bus: publishes product.selected; subscribes none
- **`store.inventory`** Inventory: Stock levels, low and out filters, restock and corrections.
  - config: `{ status?: "in_stock" \| "low" \| "out"; link_group?: string }`
  - sizes: l, xl (default), full · views: list, adjust · permission: `store:inventory`
  - actions: `inventory.list`, `inventory.adjust`
  - realtime: `stock.changed`
  - bus: publishes product.selected; subscribes none

#### Domain `badges` (package B)

- **`badges.showcase`** Badge showcase: Up to three pinned badges plus the earned count; the owner can re-pick the showcase.
  - config: `{ member: MemberTarget; link_group?: string }`
  - sizes: s, m (default), l · views: showcase, pick · permission: `suite:use`
  - actions: `badges.member`, `me.profile.update`
  - realtime: `badge.awarded`, `badge.revoked`
  - bus: publishes badge.selected; subscribes member.selected
- **`badges.progress`** Next badges: Badges in progress with rings and what is left.
  - config: `{ member: MemberTarget; limit?: Int; link_group?: string }`
  - sizes: s, m (default), l · views: list · permission: `suite:use`
  - actions: `badges.catalog`
  - realtime: `badge.progress`, `badge.awarded`
  - bus: publishes badge.selected; subscribes none
- **`badges.catalog`** All badges: Every badge with earned, in progress and locked filters; badge detail inside the widget; manual award for managers.
  - config: `{ member: MemberTarget; filter?: "all" \| "earned" \| "in_progress" \| "locked"; link_group?: string }`
  - sizes: l, xl, full (default) · views: grid, badge, award · permission: `suite:use`
  - actions: `badges.catalog`, `badges.get`, `badges.award`, `badges.revoke`
  - realtime: `badge.awarded`, `badge.revoked`, `badge.progress`, changes: Badge
  - bus: publishes badge.selected; subscribes badge.selected
- **`badges.recent`** Recent awards: Organisation-wide award ticker.
  - config: `{ limit?: Int; link_group?: string }`
  - sizes: m (default), l · views: ticker · permission: `suite:use`
  - actions: `audit.events`
  - realtime: `badge.awarded`
  - bus: publishes member.selected; subscribes none

#### Domain `promotions` (package C)

- **`promotions.list`** Promotions: All promotions by status with window, usage bar and pending approvals; create new.
  - config: `{ status?: PromotionStatus[]; link_group?: string }`
  - sizes: l, xl, full (default) · views: list · permission: `promotions:simulate`
  - actions: `promotions.list`
  - realtime: `promotion.state_changed`, `promotion.redeemed`, `promotion.budget_alert`, `approval.decided`, changes: Promotion
  - bus: publishes promotion.selected; subscribes none
- **`promotions.builder`** Promotion builder: Rule builder: eligibility (ruleBuilder + pickers), effects, budget, schedule, stacking; save draft, transition, history and diff.
  - config: `{ promotion?: string \| ParamBinding \| null; link_group?: string }`
  - sizes: xl, full (default) · views: eligibility, effects, budget, schedule, review, history · permission: `promotions:manage`
  - actions: `catalog.get`, `segments.preview`, `promotions.transition`, `promotions.simulate`
  - realtime: `promotion.state_changed`, `approval.decided`, changes: Promotion, changes: Segment, changes: Product, changes: Category
  - bus: publishes none; subscribes promotion.selected
- **`promotions.simulator`** Simulator: Pick a member and a sample cart or earn event; see applied, rejected with reasons, totals, baseline.
  - config: `{ promotion?: string \| ParamBinding; link_group?: string }`
  - sizes: l (default), xl · views: inputs, result · permission: `promotions:simulate`
  - actions: `promotions.simulate`, `people.directory`, `store.catalog`
  - bus: publishes none; subscribes promotion.selected, member.selected
- **`promotions.performance`** Promotion performance: Redemptions, cost, budget, by tier and region, uplift; for one promotion or all active.
  - config: `{ promotion?: string \| ParamBinding \| null; bucket?: "hour" \| "day"; link_group?: string }`
  - sizes: m, l (default), xl · views: summary, series · permission: `promotions:simulate`
  - actions: `promotions.analytics`, `promotions.list`
  - realtime: `promotion.redeemed`, `promotion.budget_alert`
  - bus: publishes none; subscribes promotion.selected
- **`promotions.active`** Offers for you: Member-facing banners for promotions the viewer qualifies for.
  - config: `{ limit?: Int; link_group?: string }`
  - sizes: s, m, l, xl (default), full · views: banners · permission: `suite:use`
  - actions: `promotions.active`
  - realtime: `promotion.state_changed`

#### Domain `automation` (package C)

- **`automation.list`** Automations: Automations with trigger, enabled switch, last run, failures, next fire.
  - config: `{ link_group?: string }`
  - sizes: l, xl, full (default) · views: list · permission: `automation:manage`
  - actions: `automation.list`, `automation.set_enabled`
  - realtime: `automation.run_updated`, `approval.decided`, changes: Automation
  - bus: publishes automation.selected; subscribes none
- **`automation.builder`** Automation builder: Trigger picker (event, schedule, metric with query), conditions (ruleBuilder), step list with per-step forms, limits; dry run, run now, enable.
  - config: `{ automation?: string \| ParamBinding \| null; link_group?: string }`
  - sizes: xl, full (default) · views: trigger, conditions, steps, dry-run, history · permission: `automation:manage`
  - actions: `catalog.get`, `automation.dry_run`, `automation.trigger`, `automation.set_enabled`
  - realtime: `automation.run_updated`, changes: Automation
  - bus: publishes run.selected; subscribes automation.selected
- **`automation.runs`** Run history: Runs with status filters; run detail with per-step status, retry and cancel inside the widget.
  - config: `{ automation?: string \| ParamBinding; status?: RunStatus[]; page_size?: Int; link_group?: string }`
  - sizes: m, l, xl (default), full · views: list, run · permission: `automation:manage`
  - actions: `automation.runs`, `automation.run`, `automation.retry`, `automation.cancel`
  - realtime: `automation.run_updated`
  - bus: publishes run.selected; subscribes automation.selected, run.selected

#### Domain `content` (package C)

- **`content.feed`** News feed: Published content targeted to the viewer, pinned first, reactions inline; reading view inside the widget.
  - config: `{ type?: "page" \| "article" \| "announcement"; tag?: string; layout?: "list" \| "cards"; limit?: Int; link_group?: string }`
  - sizes: m, l, xl (default), full · views: feed, reader · permission: `suite:use`
  - actions: `content.feed`, `content.published`, `content.engage`
  - realtime: `content.published`, `content.engaged`
  - bus: publishes content.selected; subscribes none
- **`content.reader`** Article: One published item rendered from its blocks with reactions.
  - config: `{ content?: string \| ParamBinding; link_group?: string }`
  - sizes: l, xl, full (default) · views: reader · permission: `suite:use`
  - actions: `content.published`, `content.engage`
  - realtime: `content.engaged`
  - bus: publishes none; subscribes content.selected
- **`content.editor`** Content editor: Block editor with side preview, metadata, audience, reviewers, schedule; workflow actions; versions and block diff.
  - config: `{ content?: string \| ParamBinding \| null; link_group?: string }`
  - sizes: xl, full (default) · views: blocks, settings, preview, versions, diff · permission: `content:author`
  - actions: `content.preview`, `content.transition`, `content.versions`, `content.diff`, `segments.list`, `groups.list`
  - realtime: `content.state_changed`, changes: Content
  - bus: publishes none; subscribes content.selected
- **`content.review-queue`** Review queue: Items awaiting the viewer's review with diff since last review, approve or request changes.
  - config: `{ link_group?: string }`
  - sizes: m, l (default), xl · views: queue, review · permission: `content:review`
  - actions: `content.list`, `content.diff`, `content.transition`
  - realtime: `content.state_changed`
  - bus: publishes content.selected; subscribes none
- **`content.list`** Content: All content by status, type, tag and author; engagement counts.
  - config: `{ status?: ContentStatus[]; type?: "page" \| "article" \| "announcement"; link_group?: string }`
  - sizes: l, xl, full (default) · views: list · permission: `content:author`
  - actions: `content.list`
  - realtime: `content.state_changed`, `content.engaged`, changes: Content
  - bus: publishes content.selected; subscribes none

#### Domain `segments` (package C)

- **`segments.list`** Segments: Segments with live counts and where they are used.
  - config: `{ link_group?: string }`
  - sizes: m, l (default), xl · views: list · permission: `segments:preview`
  - actions: `segments.list`
  - realtime: changes: Segment
  - bus: publishes segment.selected; subscribes none
- **`segments.builder`** Segment builder: Rule builder over member facts with live count, distribution and sample members.
  - config: `{ segment?: string \| ParamBinding \| null; link_group?: string }`
  - sizes: xl, full (default) · views: rule, preview, history · permission: `segments:preview`
  - actions: `catalog.get`, `segments.preview`, `people.facts`
  - realtime: changes: Segment
  - bus: publishes member.selected; subscribes segment.selected
- **`segments.members`** Segment members: Members matching a segment now.
  - config: `{ segment?: string \| ParamBinding; link_group?: string }`
  - sizes: m, l (default), xl · views: list · permission: `segments:preview`
  - actions: `segments.members`
  - realtime: `tier.changed`
  - bus: publishes member.selected; subscribes segment.selected

#### Domain `calendar` (package C)

- **`calendar.month`** Calendar: Month grid of promotion windows, content schedules, cron fires, expiry and due dates.
  - config: `{ types?: ("promotion" \| "content" \| "automation" \| "expiry" \| "task")[]; link_group?: string }`
  - sizes: l, xl, full (default) · views: month, week, day · permission: `suite:use`
  - actions: `calendar.range`
  - realtime: `promotion.state_changed`, `content.state_changed`, `task.updated`
  - bus: publishes date.selected, promotion.selected, content.selected; subscribes none
- **`calendar.agenda`** Agenda: The next N days as a list.
  - config: `{ days?: Int; types?: ("promotion" \| "content" \| "automation" \| "expiry" \| "task")[]; link_group?: string }`
  - sizes: s, m (default), l · views: agenda · permission: `suite:use`
  - actions: `calendar.range`
  - realtime: `promotion.state_changed`, `content.state_changed`
  - bus: publishes date.selected; subscribes date.selected

#### Domain `approvals` (package D)

- **`approvals.inbox`** Approvals: Unified approvals (changes, actions, high-value orders, content reviews) with SoD reasons, decide inline with diff/detail.
  - config: `{ scope?: "to_decide" \| "requested" \| "all"; types?: ApprovalType[]; page_size?: Int; link_group?: string }`
  - sizes: m, l, xl (default), full · views: list, item · permission: `authenticated`
  - actions: `approvals.list`, `approvals.decide`, `approvals.withdraw`
  - realtime: `approval.requested`, `approval.decided`
  - bus: publishes approval.selected; subscribes none

#### Domain `tasks` (package D)

- **`tasks.list`** Tasks: Tasks with filters, inline status, task detail with comments inside the widget.
  - config: `{ scope?: "mine" \| "created" \| "all"; status?: TaskStatus[]; page_size?: Int; link_group?: string }`
  - sizes: m, l, xl (default), full · views: list, task · permission: `tasks:use`
  - actions: `tasks.list`, `tasks.get`, `tasks.update`, `tasks.comment`
  - realtime: `task.assigned`, `task.updated`, `task.commented`
  - bus: publishes task.selected; subscribes task.selected
- **`tasks.board`** Task board: Kanban by status with keyboard-accessible moves.
  - config: `{ scope?: "mine" \| "created" \| "all"; link_group?: string }`
  - sizes: xl, full (default) · views: board, task · permission: `tasks:use`
  - actions: `tasks.list`, `tasks.update`, `tasks.get`
  - realtime: `task.assigned`, `task.updated`
  - bus: publishes task.selected; subscribes none
- **`tasks.quick-add`** New task: Title, assignee, due, priority, optional link.
  - config: `{ link_group?: string }`
  - sizes: s, m (default) · views: form · permission: `tasks:use`
  - actions: `tasks.create`, `people.directory`
  - bus: publishes task.selected; subscribes none

#### Domain `audit` (package D)

- **`audit.timeline`** Audit log: Change log and domain events merged, filters, undo for undoable changes, hash display.
  - config: `{ sources?: ("change" \| "event")[]; actor?: string; link_group?: string }`
  - sizes: l, xl, full (default) · views: list, entry · permission: `audit:view`
  - actions: `audit.timeline`, `audit.events`
  - realtime: changes: all (change stream)
  - bus: publishes none; subscribes member.selected
- **`audit.verify`** Chain verification: Verifies both hash chains and shows heads.
  - config: `{ link_group?: string }`
  - sizes: s (default), m · views: status · permission: `audit:view`
  - actions: `audit.verify`
- **`audit.node-history`** History: Revision history of one node with diff between any two revisions and undo.
  - config: `{ node: string \| ParamBinding; link_group?: string }`
  - sizes: m, l (default), xl · views: revisions, diff · permission: `suite:use`
  - actions: none (kernel node API)
  - realtime: changes: kernel GET /history, MCP diff mirror GET /suite/... (CONTRACT 12.8)

#### Domain `admin` (package D)

- **`admin.members`** Members: Members with private fields, roles, status; create, disable, sessions inside the widget.
  - config: `{ link_group?: string }`
  - sizes: xl, full (default) · views: list, member, create · permission: `admin:members`
  - actions: `admin.members`, `admin.member_create`, `admin.member_status`, `admin.sessions`, `admin.session_revoke`
  - realtime: `member.updated`, `session.revoked`
  - bus: publishes member.selected; subscribes none
- **`admin.roles`** Roles: Roles with members and scopes; propose membership changes (held for approval).
  - config: `{ link_group?: string }`
  - sizes: l, xl, full (default) · views: roles, role · permission: `admin:roles`
  - actions: `admin.roles`, `admin.role_members`
  - realtime: `approval.decided`, changes: Role
  - bus: publishes member.selected; subscribes none
- **`admin.matrix`** Permission matrix: Role x permission matrix, agent ceiling, and effective permissions of one principal.
  - config: `{ link_group?: string }`
  - sizes: xl, full (default) · views: matrix, principal · permission: `admin:roles`
  - actions: `admin.matrix`, `admin.permissions`
  - realtime: changes: Grant, changes: Role
  - bus: publishes none; subscribes member.selected
- **`admin.grants`** Grants: Grant nodes; propose a grant (held, R-GRANT) with grant.check counts.
  - config: `{ link_group?: string }`
  - sizes: xl, full (default) · views: list, propose · permission: `admin:roles`
  - actions: none (kernel node API)
  - realtime: changes: Grant (kernel /nodes, /changes)
- **`admin.program`** Programme settings: Program node editor (tiers, expiry, limits, thresholds, defaults); every change is held (R-PROGRAM).
  - config: `{ link_group?: string }`
  - sizes: xl, full (default) · views: form, history · permission: `suite:use`
  - actions: none (kernel node API)
  - realtime: `approval.decided`, changes: Program

#### Domain `settings` (package D)

- **`settings.appearance`** Appearance: Theme, density, reduced motion (Preference ui block).
  - config: `{ link_group?: string }`
  - sizes: m (default), l · views: form · permission: `notifications:use`
  - actions: `me.preferences.get`, `me.preferences.update`
  - realtime: changes: Preference

#### Domain `pages` (package D)

- **`pages.editor`** Page editor: Edit a Page: add widgets from the catalogue, configure them with forms generated from their config schema, move and resize on the grid.
  - config: `{ page: string \| ParamBinding; link_group?: string }`
  - sizes: full (default) · views: layout, catalogue, configure · permission: `suite:use`
  - actions: `widgets.catalog`, `pages.resolve`
  - realtime: changes: Page, changes: Widget

#### Endpoints: M18 Pages and widgets


- **`GET /suite/widgets`** — action `widgets.catalog`
  - The widget catalogue with config JSON Schemas, sizes, views, actions, events and availability for the viewer.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ domain?: string; include_schemas?: boolean }`
  - out: `{ items: WidgetCatalogEntry[] }`
- **`GET /suite/pages`** — action `pages.list`
  - Pages the viewer can read, with routes and navigation entries (the shell builds the nav from this).
  - permission: `suite:use` · read · agent: `direct`
  - in: `{}`
  - out: `{ items: {...}[] }`
- **`GET /suite/pages/resolve`** — action `pages.resolve`
  - Resolve an app path (or page slug) to the page to render, the viewer's personal copy first, with every widget instance resolved.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ path?: string; page?: string }`
  - out: `{ page: NodeLink; spec: PageSpec; params: Record<string, string>; items: ResolvedItem[]; personal_of: NodeLink \| null; editable: boolean }`
- **`POST /suite/pages/personalize`** — action `pages.personalize`
  - Copy a shared page and its widgets into a personal page owned by the viewer (slug <page>.<handle>), as one change set.
  - permission: `suite:use` · mutating · agent: `preview`
  - in: `{ page: string }`
  - out: `{ page: NodeLink; widgets: NodeLink[]; change_seq: Int }`
  - refusals (`details.reason`): `ALREADY_EXISTS`
- **`POST /suite/pages/reset`** — action `pages.reset`
  - Delete the viewer's personal copy of a page and its widgets, returning to the shared default.
  - permission: `suite:use` · mutating · agent: `preview`
  - in: `{ page: string }`
  - out: `{ deleted: NodeLink[]; change_seq: Int }`
- **`POST /suite/site/clear`** — action `site.clear`
  - Delete every Page and Widget node, system and personal pages included (the only way to delete a system page). The dry run reports the counts.
  - permission: `admin:settings` · mutating · agent: `preview`
  - in: `{}`
  - out: `{ pages_removed: Int; widgets_removed: Int; change_seq: Int }`
- **`POST /suite/site/restore`** — action `site.restore`
  - Recreate the default pages and widgets, skipping nodes that exist; `pages` limits it to some slugs so the site can come back in stages.
  - permission: `admin:settings` · mutating · agent: `direct`
  - in: `{ pages?: string[] }`
  - out: `{ pages_created: string[]; pages_skipped: string[]; widgets_created: Int; change_seq: Int }`
- **`PUT /suite/site/pages/:slug`** — action `site.page.put`
  - Create or update one Page (title, route, nav entry) and, when `items` is given, its Widget instances; widget ids and configs are validated like any node commit.
  - permission: `admin:settings` · mutating · agent: `direct`
  - in: `{ slug: string; title: string; route: string; description?: string; kind?: "module" \| "home"; nav?: { section; label; icon; count?; permission? }; items?: { widget: string; config?: object; size?: WidgetSize; at?: LayoutAt }[] }`
  - out: `{ page: NodeLink; created: boolean; widgets: string[]; change_seq: Int }`
- **`POST /suite/site/widgets`** — action `site.widget.add`
  - Add one widget instance to a page; without `at` it takes the first free slot of the 12-column grid that fits the widget's footprint.
  - permission: `admin:settings` · mutating · agent: `direct`
  - in: `{ page: string; widget: string; config?: object; size?: WidgetSize; at?: LayoutAt }`
  - out: `{ widget: string; page: string; at: LayoutAt; change_seq: Int }`
- **`POST /suite/site/widgets/remove`** — action `site.widget.remove`
  - Remove one widget instance (by slug) from a page and delete its node.
  - permission: `admin:settings` · mutating · agent: `direct`
  - in: `{ page: string; widget: string }`
  - out: `{ widget: string; page: string; change_seq: Int }`
- **`GET /suite/site/appearance`** — action `site.appearance.get`
  - The site's look and density (calm and comfortable when never set).
  - permission: `suite:use` · read · agent: `direct`
  - in: `{}`
  - out: `{ appearance: { look: "calm" \| "meridian" \| "nocturne" \| "folio" \| "lattice" \| "strata"; density?: "comfortable" \| "compact" } }`
- **`PUT /suite/site/appearance`** — action `site.appearance.set`
  - Set the site's look and density; open browsers switch live.
  - permission: `admin:settings` · mutating · agent: `direct`
  - in: `{ look: ...; density?: "comfortable" \| "compact" }`
  - out: `{ appearance: ... }`


## 6. Realtime

### 6.1 Protocol extension (K7)

One WebSocket, `/rt`, protocol v1 as today, plus a second stream.

- `hello` may carry `client_id` = the tab's session id; the gateway binds the socket to that `member_sessions` row and
  closes it with code `4401` when the session is revoked (it receives `session.revoked`).
- `welcome` adds `domain_head_seq`.
- `subscribe` adds `stream: "changes" | "domain"` (default `changes`, exactly today's behaviour) and, for `domain`,
  optional `types: DomainEventType[]`. `since_seq` on a domain subscription is a `domain_events.seq`; resume and
  snapshot semantics are those of the change stream.
- Server frames: `{ t: "domain", sub, prev_through, through, items: DomainEvent[] }` with only the events whose
  `audience` matches the principal (`*`, the principal's subject, or `role:<r>` for each Role it holds; an agent
  matches its delegator's audience); `{ t: "progress", sub, through }` when a batch had nothing visible; and
  `{ t: "counts", counts: NavCounts }` sent once after a domain subscription starts and again after any delivered
  batch containing a `COUNT_AFFECTING_EVENTS` type for that principal (recomputed by the gateway with one query).
- Wake-up: commits `NOTIFY plinth_domain, '<workspace_id>'`; the gateway LISTENs on it beside `plinth_changes`, with
  the same 1 s poll fallback. Nothing in a notification carries authority.

The web client opens both subscriptions on one socket (`s1` changes, `s2` domain) and resumes each from its own
last seq (UI-MAP section 3.2).

### 6.2 Event catalogue

Payload shapes are `DOMAIN_EVENT_PAYLOADS` (`events.ts`); every event also has `seq, type, occurred_at, actor,
on_behalf_of, surface, subject, cause`. `member_id` is the member the event is about (it drives badges, automations
and activity timelines). Audiences use roles: "store staff" = `role:manager`, `role:admin`; "approvers" = the roles
whose grants hold the approver permission (for `store:approve`: `role:manager`, `role:finance`).

| Type | Payload |
|---|---|
| `message.received` | `{ thread_id: UUID; message_id: UUID; subject: string; preview: string; from: PersonRef; mentioned: boolean }` |
| `message.sent` | `{ thread_id: UUID; message_id: UUID; subject: string; recipient_count: Int }` |
| `message.state_changed` | `{ thread_ids: UUID[]; read?: boolean; starred?: boolean; archived?: boolean; muted?: boolean }` |
| `notification.created` | `{ notification: NotificationView }` |
| `notification.read` | `{ ids: UUID[] \| null; unread_count: Int }` |
| `points.posted` | `{ txn_id: UUID; txn_no: Int; txn_type: TxnType; account: string; member: Handle \| null; delta: SignedPoints; balance: Int; lifetime: Int; memo: string }` |
| `points.expiring` | `{ member: Handle; points: Int; expires_on: string }` |
| `tier.changed` | `{ member: Handle; from: Tier; to: Tier; lifetime: Int }` |
| `order.placed` | `{ order_id: UUID; order_no: string; member: PersonRef; total_points: Int; item_count: Int; requires_approval: boolean }` |
| `order.status_changed` | `{ order_id: UUID; order_no: string; member: Handle; from: OrderStatus; to: OrderStatus; note: string \| null }` |
| `stock.changed` | `{ product: string; on_hand: Int; stock_status: StockStatus }` |
| `cart.updated` | `{ item_count: Int; subtotal_points: Int }` |
| `wishlist.changed` | `{ product: string; in_wishlist: boolean }` |
| `review.created` | `{ review_id: UUID; product: string; rating: Int; average: number; count: Int }` |
| `badge.awarded` | `{ award_id: UUID; badge: string; title: string; member: PersonRef; rarity: string; points_reward: Int }` |
| `badge.revoked` | `{ award_id: UUID; badge: string; member: Handle }` |
| `badge.progress` | `{ badge: string; member: Handle; current: Int; target: Int }` |
| `promotion.state_changed` | `{ promotion: string; title: string; from: PromotionStatus; to: PromotionStatus; revision: Int }` |
| `promotion.redeemed` | `{ promotion: string; member: Handle; context: "purchase" \| "earn"; cost_points: Int; benefit_points: Int }` |
| `promotion.budget_alert` | `{ promotion: string; used_pct: 50 \| 80 \| 100; cost_points: Int; max_cost_points: Int }` |
| `automation.run_updated` | `{ run_id: UUID; automation: string; status: RunStatus; step_index: Int \| null; step_status: StepStatus \| null; error_code: string \| null }` |
| `content.state_changed` | `{ content: string; title: string; from: ContentStatus; to: ContentStatus; by: Subject; note: string \| null }` |
| `content.published` | `{ content: string; title: string; content_type: "page" \| "article" \| "announcement"; summary: string; pinned: boolean }` |
| `content.engaged` | `{ content: string; member: Handle; viewed: boolean; reaction: Reaction \| null; views: Int; reactions: Int }` |
| `task.assigned` | `{ task_id: UUID; task_no: Int; title: string; priority: TaskPriority; due_at: Timestamp \| null; assignee: Subject }` |
| `task.updated` | `{ task_id: UUID; task_no: Int; status: TaskStatus; changed: string[] }` |
| `task.commented` | `{ task_id: UUID; task_no: Int; comment_id: UUID; author: Subject }` |
| `approval.requested` | `{ approval_type: ApprovalType; id: string; title: string; requested_by: Subject }` |
| `approval.decided` | `{ approval_type: ApprovalType; id: string; decision: "approve" \| "reject" \| "withdraw"; by: Subject; status: string }` |
| `member.updated` | `{ member: Handle; fields: string[] }` |
| `session.revoked` | `{ session_id: string; by: Subject }` |

| Type | Emitted by | Audience | `member_id` | UI reaction (UI-MAP) |
|---|---|---|---|---|
| `message.received` | send, reply (one per recipient) | that recipient | recipient | Inbox count (via counts), thread list prepends/updates, open thread appends, toast "New message from X" unless the thread is open or muted |
| `message.sent` | send, reply (one per send) | sender | sender | Sent folder updates in the sender's other tabs |
| `message.state_changed` | messages.state, bulk_state | owner | owner | Thread row state in other tabs; counts |
| `notification.created` | every notifying write (12.3) | recipient | recipient | Bell count (counts), feed prepends, toast for types whose preference has in_app on |
| `notification.read` | notifications.read, read_all | recipient | recipient | Feed rows lose unread mark in other tabs; bell count |
| `points.posted` | every ledger transaction, one per member account touched (and one per system account, audience `role:finance`) | that member + `role:finance` | that member | Balance chip animates to `balance`; points page prepends statement line; toast for credits of type award, badge_reward, promotion_bonus |
| `points.expiring` | scheduler (warn_days) | member | member | Points page banner; notification (12.3) |
| `tier.changed` | ledger posting crossing a floor | member + `*` | member | Tier pill on balance chip and profile; celebratory toast to the member |
| `order.placed` | checkout.place | member + store staff | member | Orders list; store staff order queue; home "orders today" |
| `order.status_changed` | checkout (auto-approve), orders.transition, approvals | member + store staff | member | Order detail timeline, status pill, toast to member |
| `stock.changed` | checkout, cancel/refund with restock, inventory.adjust | `*` | none | Product card and detail stock indicator; cart line issue |
| `cart.updated` | cart.set_item, cart.clear, checkout | member | member | Cart count in other tabs (via counts) |
| `wishlist.changed` | wishlist.add/remove | member | member | Heart toggles in other tabs |
| `review.created` | store.review_create, review_moderate | `*` | reviewer | Product rating summary and reviews list |
| `badge.awarded` | badge engine, badges.award | `*` | awardee | Awardee: toast with artwork, profile showcase, badges grid. Everyone: home activity |
| `badge.revoked` | badges.revoke | awardee + `role:admin` | awardee | Badge grid |
| `badge.progress` | badge engine | member | member | Progress rings on badges page and home "next badges" |
| `promotion.state_changed` | promotions.transition (when committed), scheduler, approval applied | `*` | none | Promotions list, calendar, store banners (members re-fetch `promotions.active`) |
| `promotion.redeemed` | checkout, award | member + `role:marketing-manager` | member | Promotion analytics live counter |
| `promotion.budget_alert` | charge crossing 50, 80, 100 % | `role:marketing-manager`, `role:finance`, owner | none | Toast to marketing and finance; promotions list usage bar |
| `automation.run_updated` | engine (status and step changes) | owner + `role:marketing-manager` | event member | Runs list and run detail live; failures toast to owner |
| `content.state_changed` | content.transition, scheduler | author, reviewers, `role:content-editor`, `role:marketing-manager` | author | Content list status pills; editor banner; reviewers' approvals inbox (via counts) |
| `content.published` | publish (action or scheduler) | `*` if `audience.everyone`, else the audience members expanded at publish | none | Home feed prepends for members in the audience; toast for pinned announcements |
| `content.engaged` | content.engage | author + `role:content-editor` | viewer | Editor engagement counters |
| `task.assigned` | tasks.create/update, automation | assignee + creator | assignee | Tasks list, counts, toast to assignee |
| `task.updated` | tasks.update | assignee + creator | assignee | Task row and detail |
| `task.commented` | tasks.comment | assignee + creator + mentioned | assignee | Task detail comments |
| `approval.requested` | any held change or action, high-value order, content submit | the approvers of that item (subjects or roles) | requester | Approvals inbox prepends; counts; toast to approvers |
| `approval.decided` | decide, withdraw, expiry | requester + approvers | requester | Inbox row status; requester toast |
| `member.updated` | profile update, admin status, member create | `*` | that member | Person chips and profile refresh |
| `session.revoked` | me.sessions.revoke, admin | that session's principal | that member | The revoked tab shows "Signed out" and stops; other tabs refresh the sessions list |

Config node edits (Promotion, Automation, Content, Segment, Product, Badge, Role, Program, Group, Preference) also
appear on the existing `changes` stream; screens that show a node re-fetch it when an event names its URI, as the
board does today.

### 6.3 `present` frame (`ui.present`)

`ui.present` writes no change. After its permission and session checks it sends
`NOTIFY plinth_present, '{ ws, node, target, focus, by, owners }'` (`PresentNotice` in `rt.ts`), where `owners` are the
subjects of the presenter's session: its own and its delegator's. The gateway LISTENs on `plinth_present` and, for each
connected socket, sends

`{ t: "present", node, target, focus, by, at }` (`PresentFrame`)

only when all of these hold:

1. the socket's workspace is `ws`;
2. the socket's principal is one of `owners`, and matches `target`: `all` (the default) addresses every screen of the
   presenter's session, that is every socket of its own principal and of its delegator; `principal:<subject>` addresses
   that one principal's sockets (the tool has already refused a target outside the session with `FORBIDDEN`,
   `details.reason: "not_in_session"`; the gateway re-checks `owners` because a notification carries no authority);
3. the principal can read `node`: the gateway resolves it with the same read authorisation as the change stream
   (`ChangeLog.resolve`). A principal that cannot read the node receives nothing, not even a refusal.

`node` is the node URI, `focus` is `null` or `{ parameter, value }`, `by` the presenting subject, `at` the gateway
clock (ISO 8601). Frames are not sequenced, not stored and not replayed after a reconnect. The web client exposes them
as `rt.onPresent(cb)`; the app opens the Page route of a presented Page node, or outlines (`data-live-change="agent"`)
and scrolls to the presented widget on the current page.

**Delivery count.** The tool cannot observe how many sockets received the frame without waiting for the gateway, so
`ui.present` returns `data: { delivered_to: null, queued: true, skipped: [] }`. `delivered_to` is always `null`.

## 7. M3 Points and M4 Store

### 7.1 Accounts

One member account per human member (`member:<handle>`, created with the member) and five system accounts:
`system:issuance` (source of awards and badge rewards; goes negative), `system:promotions` (source of promotion
bonuses; negative), `system:redemption` (sink of purchases; positive), `system:expiry` (sink of expired points;
positive), `system:adjustments` (both directions). Account ids are `UUIDv5(PLINTH_NS, "account|<ws>|<code>")`.

### 7.2 Postings

Every posting is one `ledger_transactions` row, its `ledger_entries` (signed, credit positive), its lot movements and
one `points.posted` event per account touched, in one transaction. Templates:

| Type | Entries | Lots | `lifetime_earned` | Idempotency key (internal callers) |
|---|---|---|---|---|
| `award` | issuance −base, promotions −bonus (if any), member +(base+bonus) | one new lot of base+bonus, expires `occurred_at + Program.expiry.months` | + (base+bonus) | `award:<action key>:<handle>` |
| `promotion_bonus` | promotions −n, member +n | new lot | + n | `order-bonus:<order_id>` |
| `badge_reward` | issuance −n, member +n | new lot | + n | `badge:<award_id>` |
| `purchase` | member −total, redemption +total | consume FIFO | unchanged | `order:<order_id>` |
| `refund` | redemption −n, member +n | restore the lots the purchase consumed (same `expires_at`; a lot already past expiry is restored with `expires_at = now + 30 days`) | unchanged | `refund:<order_id>` |
| `transfer` | sender −n, recipient +n | consume sender FIFO; create one recipient lot per consumed lot with the same `expires_at` | unchanged | action key |
| `expiry` | member −remaining, expiry +remaining | the expired lot's `remaining` to 0, `expired_txn_id` set | unchanged | `expiry:<lot_id>` |
| `adjustment` (+) | adjustments −n, member +n | new lot | + n | action key |
| `adjustment` (−) | member −n, adjustments +n | consume FIFO | − n (floor 0) | action key |
| `reversal` | mirror of the reversed txn | reversing a credit consumes that txn's own lots first (`INSUFFICIENT_POINTS` if their remaining is short); reversing a debit restores consumed lots | − or + as the original moved it | `reverse:<txn_id>` |

FIFO order is `(expires_at, earned_at, lot_id)`. Debits lock the member account, then select lots `FOR UPDATE` in FIFO
order. A member's tier is recomputed after every posting that changes `lifetime_earned`: the highest Program tier
whose `min_lifetime_points <= lifetime_earned`. A change appends `tier.changed` and a `tier_changed` notification;
`ledger_entries.tier_after` records the tier for member entries.

### 7.3 Invariants

| Id | Invariant | Enforcement |
|---|---|---|
| L1 | Every transaction's entries sum to 0 and number at least 2 | Deferred constraint triggers (Guarantee) |
| L2 | A member balance is never negative | `CHECK` on `ledger_accounts`, plus the pre-check that returns `INSUFFICIENT_POINTS` before any write (Guarantee) |
| L3 | `ledger_accounts.balance` equals the sum of its entries | Trigger `ledger_entries_apply` is the only writer of `balance` (Guarantee); trial balance reports drift |
| L4 | The sum of all balances is 0 | Follows from L1 and L3; trial balance checks it |
| L5 | A member balance equals the sum of its lots' `remaining` | Postings move lots in the same transaction; trial balance checks it (Guarantee by test) |
| L6 | Entries and transactions are immutable; a transaction is reversed at most once | Append-only triggers; `UNIQUE (reverses_txn_id)` (Guarantee) |
| L7 | Same idempotency key and request returns the same transaction; a different request with the key is refused | `UNIQUE (workspace_id, idempotency_key)` plus `request_hash` comparison (Guarantee) |
| L8 | Each transaction emits one `points.posted` per account touched; `event_seq` is the first | Single posting function (Guarantee by test) |
| L9 | `tier` equals the tier function of `lifetime_earned` | Recomputed in the posting function; trial balance checks it |

`ledger.trial_balance` recomputes L1, L3, L4, L5 and L9 over the whole ledger and lists any violation.

Program limits: transfers need `transfer.enabled`, `min_points <= n <= max_per_transfer`, the sender's transfers in
the current virtual UTC day plus `n` at most `max_per_day` (`LIMIT_EXCEEDED` with `details.limit`), recipient active
and not the sender (`SELF_ACTION`). Awards: at most `awards.max_recipients`; the awarder cannot be a recipient; if
`points > manager_max_per_award` the whole award is filed in `action_approvals` with approver permission
`points:adjust` and returns `status: "pending_approval"`.

### 7.4 Store catalogue, cart and wishlist

The catalogue lists Product nodes with `status: active` in active Categories. `stock_status` is `out` at
`on_hand = 0`, `low` at `on_hand <= low_stock_threshold`, else `in_stock`. `affordable` is `price_points <= balance`
and tier gate met. `promo_percent` is the largest `store_discount` percent among active promotions the viewer is
eligible for that cover the product (display only). The cart holds at most `max_cart_lines` lines of at most
`max_qty_per_line`; adding beyond `on_hand` is `OUT_OF_STOCK`; a tier-gated product is `NOT_ELIGIBLE`.

### 7.5 Checkout (atomic)

`checkout.quote` is a read: it loads the cart and runs the steps below up to 4 without locks or writes and returns the
quote with `quote_hash = sha256(canonicalize({ lines: [{ product, qty, unit_points, discount_points, free_item }],
total_points, cash_cents, applied: [{ slug, revision }] }))`. `checkout.place`, in one transaction:

1. Lock the cart row; refuse `CART_EMPTY`; validate line count, quantities, product status, `min_tier`,
   `limit_per_member` (prior non-cancelled order quantity plus this one).
2. Lock the member account, `system:redemption` and `system:promotions` (ascending ids), the products' inventory
   rows (ascending), and the `promotion_usage` rows of every active promotion that could apply (ascending).
3. Evaluate promotions (`mode: "live"`, section 8) against the locked usage.
4. Recompute the quote hash; a mismatch is `PRICE_CHANGED` with the fresh quote in `details.quote`.
5. Stock per line including free items, else `OUT_OF_STOCK`; `total_points <= balance`, else `INSUFFICIENT_POINTS`.
6. Allocate `order_no`; insert the order (`placed`, `requires_approval = total_points >=
   high_value_threshold_points`), its lines and the `placed` order event.
7. Post `purchase` (skipped when the total is 0).
8. Decrement inventory with `order` movements.
9. Insert `promotion_redemptions`, increment usage; emit `promotion.budget_alert` when usage crosses 50, 80 or 100 %
   of `max_cost_points` for the first time (`alerts_sent`).
10. If not `requires_approval`, transition to `approved` as `service:store` (second order event).
11. Clear the cart; write the idempotency record; append the events listed for the action; notifications per 12.3.

Purchase-type bonus points (`bonus_points` effects with `on: "purchase"`) are credited when the order is delivered
(`promotion_bonus`, key `order-bonus:<order_id>`), so a cancelled order never pays a bonus.

### 7.6 Order lifecycle

```
placed --approve--> approved --fulfil--> fulfilled --ship--> shipped --deliver--> delivered
   |                   |                     \--deliver (pickup, digital, donation)--> delivered
   +--cancel-----------+--cancel--> cancelled                 shipped|delivered --refund--> refunded
```

| Transition | From | Who | Effects |
|---|---|---|---|
| approve | placed (requires_approval) | `store:approve` with the member's facts passing the row predicate; never the member (`SELF_ACTION`). Normal orders are approved by `service:store` at checkout. | `approval.decided` for the order item |
| fulfil | approved | `store:orders` | |
| ship | fulfilled, fulfilment `ship` | `store:orders` | |
| deliver | shipped, or fulfilled for pickup/digital/donation | `store:orders` | credits purchase bonuses |
| cancel | placed or approved | the member within `cancel_window_minutes` of `placed_at`; `store:orders` before fulfilled; `store:approve` rejecting from the approvals inbox | `refund` posting of `total_points`, restock (default on), redemptions reversed (`reversed_at`) and usage decremented |
| refund | shipped or delivered | `store:refund`; agents held | `refund` posting; restock only if `restock: true`; a credited bonus is reversed for `min(bonus, balance)` |

Any other request is `INVALID_TRANSITION` with `details.allowed`. Every transition appends a `store_order_events` row,
`order.status_changed`, and an `order_status` notification to the member. Reviews: allowed for a product in one of the
member's delivered orders, once per product (`ALREADY_EXISTS`), else `NOT_ELIGIBLE`. Inventory adjustments may not take
`on_hand` below 0 (`OUT_OF_STOCK`).

#### Endpoints: M3 Points


- **`GET /suite/points/summary`** — action `points.summary`
  - Balance, tier progress, 30-day flows, expiring soon, recent lines. Another member needs points:view-all.
  - permission: `points:use` · read · agent: `direct`
  - in: `{ member?: Handle }`
  - out: `{ member: PersonRef; account: AccountCode; balance: Points; tier: TierProgress; earned_30d: Points; redeemed_30d: Points; expiring_soon: ExpiryBucket[]; recent: StatementLine[]; transfer_remaining_today: Points }`
- **`GET /suite/points/statement`** — action `points.statement`
  - Statement lines with opening and closing balances.
  - permission: `points:use` · read · agent: `direct`
  - in: `{ member?: Handle; from?: Timestamp; to?: Timestamp; types?: TxnType[]; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: StatementLine[]; next_cursor: string \| null; opening_balance: Points; closing_balance: Points; credits: Points; debits: Points }`
- **`GET /suite/points/transactions/:txn_id`** — action `points.transaction`
  - One transaction with entries and lot movements (own, or points:view-all / points:ledger).
  - permission: `points:use` · read · agent: `direct`
  - in: `{ txn_id: UUID }`
  - out: `{ txn_id: UUID; txn_no: Int; txn_type: TxnType; occurred_at: Timestamp; recorded_at: Timestamp; memo: string; actor: PersonRef; on_behalf_of: PersonRef \| null; surface: string; entries: EntryView[]; lots: {...}[]; ref: TxnRef \| null; reverses: UUID \| null; reversed_by: UUID \| null; idempotency_key: string \| null; event_seq: Int }`
- **`POST /suite/points/transfers`** — action `points.transfer`
  - Transfer points to another member within Program transfer limits.
  - permission: `points:transfer` · mutating · agent: `approval`
  - in: `{ to: Handle; points: PositivePoints; memo: string; idempotency_key: IdempotencyKey }`
  - out: `{ txn_id: UUID; txn_no: Int; balance: Points; replayed: boolean }`
  - refusals (`details.reason`): `INSUFFICIENT_POINTS`, `LIMIT_EXCEEDED`, `SELF_ACTION`, `MEMBER_DISABLED`
  - events: `points.posted`
- **`POST /suite/points/awards`** — action `points.award`
  - Award points from issuance (promotion multipliers apply). Above manager_max_per_award it is held for points:adjust.
  - permission: `points:award` · mutating · agent: `approval`
  - in: `{ to: Handle[]; points: PositivePoints; category: "recognition" \| "performance" \| "milestone" \| "service" \| "other"; reason: string; idempotency_key: IdempotencyKey }`
  - out: `{ status: "committed" \| "pending_approval"; approval_id: UUID \| null; results: {...}[]; replayed: boolean }`
  - refusals (`details.reason`): `LIMIT_EXCEEDED`, `SELF_ACTION`, `MEMBER_DISABLED`
  - events: `points.posted`, `tier.changed`, `promotion.redeemed`, `notification.created`, `approval.requested`
- **`POST /suite/points/adjustments`** — action `points.adjust`
  - Finance correction against system:adjustments; a debit cannot exceed the balance.
  - permission: `points:adjust` · mutating · agent: `deny`
  - in: `{ member: Handle; points: SignedPoints; reason: string; idempotency_key: IdempotencyKey }`
  - out: `{ txn_id: UUID; txn_no: Int; balance: Points; replayed: boolean }`
  - refusals (`details.reason`): `INSUFFICIENT_POINTS`
  - events: `points.posted`, `tier.changed`
- **`GET /suite/points/expiry`** — action `points.expiry`
  - Expiry schedule by date from remaining lots.
  - permission: `points:use` · read · agent: `direct`
  - in: `{ member?: Handle }`
  - out: `{ member: PersonRef; buckets: ExpiryBucket[]; next_warning: {...} \| null }`
- **`GET /suite/points/tiers`** — action `points.tiers`
  - Tier definitions with member counts.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{}`
  - out: `{ tiers: {...}[] }`


#### Endpoints: M3 Ledger (finance)


- **`GET /suite/ledger/accounts`** — action `ledger.accounts`
  - All accounts with balances.
  - permission: `points:ledger` · read · agent: `deny`
  - in: `{ kind?: "member" \| "system"; q?: string; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: AccountView[]; next_cursor: string \| null }`
- **`GET /suite/ledger/trial-balance`** — action `ledger.trial_balance`
  - Recompute every ledger invariant (L1-L8) and report drift.
  - permission: `points:ledger` · read · agent: `deny`
  - in: `{}`
  - out: `{ ok: boolean; checked_at: Timestamp; system: {...}[]; member_total: Int; grand_total: Int; lots_total: Int; drift: {...}[]; unbalanced_txns: UUID[]; txn_count: Int }`
- **`POST /suite/ledger/transactions/:txn_id/reverse`** — action `ledger.reverse`
  - Post the mirror transaction of an award, adjustment or bonus (purchases are reversed by order cancel/refund).
  - permission: `points:adjust` · mutating · agent: `deny`
  - in: `{ txn_id: UUID; reason: string; idempotency_key: IdempotencyKey }`
  - out: `{ txn_id: UUID; txn_no: Int; balance: Points; replayed: boolean }`
  - refusals (`details.reason`): `INSUFFICIENT_POINTS`, `INVALID_TRANSITION`
  - events: `points.posted`, `tier.changed`


#### Endpoints: M4 Store


- **`GET /suite/store/categories`** — action `store.categories`
  - Active categories with product counts.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{}`
  - out: `{ items: CategoryView[] }`
- **`GET /suite/store/products`** — action `store.catalog`
  - Active products with stock, rating, wishlist and cart state, facets.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ category?: string; q?: string; tag?: string; min_points?: Points; max_points?: Points; in_stock?: boolean; affordable?: boolean; sort?: "featured" \| "price_asc" \| "price_desc" \| "rating" \| "newest"; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: ProductCard[]; next_cursor: string \| null; total: Int; facets: {...} }`
- **`GET /suite/store/products/:slug`** — action `store.product`
  - Product detail with reviews, histogram, related products and applicable promotions.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ slug: string }`
  - out: `{ card: ProductCard; spec: ProductSpec; revision: Int; category: {...}; rating_histogram: Int[]; reviews: ReviewView[]; can_review: boolean; member_purchased_qty: Int; related: ProductCard[]; promotions: {...}[] }`
- **`GET /suite/store/products/:slug/reviews`** — action `store.reviews`
  - Published reviews (moderators also see hidden).
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ slug: string; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: ReviewView[]; next_cursor: string \| null }`
- **`POST /suite/store/products/:slug/reviews`** — action `store.review_create`
  - Review a product from one of your delivered orders; one review per member and product.
  - permission: `store:shop` · mutating · agent: `deny`
  - in: `{ slug: string; rating: Int; title: string; body: string; idempotency_key: IdempotencyKey }`
  - out: `{ review_id: UUID; product: string; member: PersonRef; rating: Int; title: string; body: string; created_at: Timestamp; status: "published" \| "hidden"; verified_order: boolean }`
  - refusals (`details.reason`): `NOT_ELIGIBLE`, `ALREADY_EXISTS`
  - events: `review.created`
- **`POST /suite/store/reviews/:review_id/moderate`** — action `store.review_moderate`
  - Hide or republish a review.
  - permission: `store:moderate` · mutating · agent: `deny`
  - in: `{ review_id: UUID; status: "published" \| "hidden"; reason: string }`
  - out: `{ review_id: UUID; product: string; member: PersonRef; rating: Int; title: string; body: string; created_at: Timestamp; status: "published" \| "hidden"; verified_order: boolean }`
  - events: `review.created`
- **`GET /suite/store/cart`** — action `cart.get`
  - Own cart with live prices and line issues.
  - permission: `store:shop` · read · agent: `direct`
  - in: `{}`
  - out: `{ lines: CartLine[]; item_count: Int; subtotal_points: Points; balance: Points; updated_at: Timestamp \| null }`
- **`PUT /suite/store/cart/items/:slug`** — action `cart.set_item`
  - Set a line quantity (0 removes).
  - permission: `store:shop` · mutating · agent: `preview`
  - in: `{ slug: string; qty: Int }`
  - out: `{ lines: CartLine[]; item_count: Int; subtotal_points: Points; balance: Points; updated_at: Timestamp \| null }`
  - refusals (`details.reason`): `OUT_OF_STOCK`, `LIMIT_EXCEEDED`, `NOT_ELIGIBLE`
  - events: `cart.updated`
- **`DELETE /suite/store/cart`** — action `cart.clear`
  - Empty the cart.
  - permission: `store:shop` · mutating · agent: `preview`
  - in: `{}`
  - out: `{ lines: CartLine[]; item_count: Int; subtotal_points: Points; balance: Points; updated_at: Timestamp \| null }`
  - events: `cart.updated`
- **`POST /suite/store/checkout/quote`** — action `checkout.quote`
  - Price the cart with live promotions (pure evaluation, no writes) and return a quote_hash.
  - permission: `store:shop` · read · agent: `direct`
  - in: `{}`
  - out: `{ lines: QuoteLine[]; subtotal_points: Points; discount_points: Points; total_points: Points; bonus_points: Points; cash_cents: Cents; balance: Points; balance_after: Int; requires_approval: boolean; evaluation: PromoEvaluation; quote_hash: string; blocking: {...}[] }`
  - refusals (`details.reason`): `CART_EMPTY`
- **`POST /suite/store/checkout`** — action `checkout.place`
  - Atomic checkout: debit ledger, decrement stock, charge promotion budgets, create the order, clear the cart.
  - permission: `store:shop` · mutating · agent: `approval`
  - in: `{ quote_hash: string; delivery: Delivery; notes?: string; idempotency_key: IdempotencyKey }`
  - out: `{ order_id: UUID; order_no: string; member: PersonRef; region: Region; status: OrderStatus; requires_approval: boolean; item_count: Int; total_points: Points; cash_cents: Cents; placed_at: Timestamp; updated_at: Timestamp; first_item: {...}; items: OrderItemView[]; subtotal_points: Points; discount_points: Points; bonus_points: Points; promotions: AppliedPromotion[]; delivery: Delivery; notes: string \| null; events: OrderEventView[]; ledger_txn_id: UUID \| null; refund_txn_id: UUID \| null; bonus_txn_id: UUID \| null; allowed_transitions: OrderTransition[]; cancel_deadline: Timestamp \| null; replayed?: boolean }`
  - refusals (`details.reason`): `CART_EMPTY`, `PRICE_CHANGED`, `INSUFFICIENT_POINTS`, `OUT_OF_STOCK`, `BUDGET_EXHAUSTED`, `NOT_ELIGIBLE`, `LIMIT_EXCEEDED`
  - events: `order.placed`, `order.status_changed`, `points.posted`, `stock.changed`, `promotion.redeemed`, `cart.updated`, `approval.requested`, `notification.created`
- **`GET /suite/store/wishlist`** — action `wishlist.list`
  - Own wishlist.
  - permission: `store:shop` · read · agent: `direct`
  - in: `{}`
  - out: `{ items: {...}[] }`
- **`PUT /suite/store/wishlist/:slug`** — action `wishlist.add`
  - Add to wishlist (idempotent).
  - permission: `store:shop` · mutating · agent: `preview`
  - in: `{ slug: string }`
  - out: `{ product: string; in_wishlist: boolean }`
  - events: `wishlist.changed`
- **`DELETE /suite/store/wishlist/:slug`** — action `wishlist.remove`
  - Remove from wishlist (idempotent).
  - permission: `store:shop` · mutating · agent: `preview`
  - in: `{ slug: string }`
  - out: `{ product: string; in_wishlist: boolean }`
  - events: `wishlist.changed`
- **`GET /suite/store/orders`** — action `orders.list`
  - Own orders; scope=all needs store:orders (a regional predicate applies).
  - permission: `store:shop` · read · agent: `direct`
  - in: `{ scope?: "mine" \| "all"; status?: OrderStatus[]; member?: string; requires_approval?: boolean; q?: string; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: OrderSummary[]; next_cursor: string \| null; status_counts: {...} }`
- **`GET /suite/store/orders/:order_id`** — action `orders.get`
  - Order detail with lines, promotions, timeline and allowed transitions.
  - permission: `store:shop` · read · agent: `direct`
  - in: `{ order_id: UUID }`
  - out: `{ order_id: UUID; order_no: string; member: PersonRef; region: Region; status: OrderStatus; requires_approval: boolean; item_count: Int; total_points: Points; cash_cents: Cents; placed_at: Timestamp; updated_at: Timestamp; first_item: {...}; items: OrderItemView[]; subtotal_points: Points; discount_points: Points; bonus_points: Points; promotions: AppliedPromotion[]; delivery: Delivery; notes: string \| null; events: OrderEventView[]; ledger_txn_id: UUID \| null; refund_txn_id: UUID \| null; bonus_txn_id: UUID \| null; allowed_transitions: OrderTransition[]; cancel_deadline: Timestamp \| null; replayed?: boolean }`
- **`POST /suite/store/orders/:order_id/transitions`** — action `orders.transition`
  - approve, fulfil, ship, deliver, cancel (refunds points), refund (finance). Agents: refund is approval-held.
  - permission: `varies (CONTRACT.md 7.6)` · mutating · agent: `preview`
  - in: `{ order_id: UUID; transition: OrderTransition; note?: string; restock?: boolean; idempotency_key: IdempotencyKey }`
  - out: `{ order_id: UUID; order_no: string; member: PersonRef; region: Region; status: OrderStatus; requires_approval: boolean; item_count: Int; total_points: Points; cash_cents: Cents; placed_at: Timestamp; updated_at: Timestamp; first_item: {...}; items: OrderItemView[]; subtotal_points: Points; discount_points: Points; bonus_points: Points; promotions: AppliedPromotion[]; delivery: Delivery; notes: string \| null; events: OrderEventView[]; ledger_txn_id: UUID \| null; refund_txn_id: UUID \| null; bonus_txn_id: UUID \| null; allowed_transitions: OrderTransition[]; cancel_deadline: Timestamp \| null; replayed?: boolean }`
  - refusals (`details.reason`): `INVALID_TRANSITION`, `SELF_ACTION`
  - events: `order.status_changed`, `points.posted`, `stock.changed`, `approval.decided`, `notification.created`
- **`GET /suite/store/inventory`** — action `inventory.list`
  - Stock levels.
  - permission: `store:inventory` · read · agent: `direct`
  - in: `{ status?: StockStatus; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: InventoryRow[]; next_cursor: string \| null }`
- **`POST /suite/store/inventory/:slug`** — action `inventory.adjust`
  - Restock or correct stock; on_hand may not go below 0.
  - permission: `store:inventory` · mutating · agent: `deny`
  - in: `{ slug: string; delta: Int; reason: "restock" \| "damage" \| "count_correction" \| "return"; note?: string; idempotency_key: IdempotencyKey }`
  - out: `{ product: string; title: string; category: string; on_hand: Int; low_stock_threshold: Int; stock_status: StockStatus; sold_30d: Int; updated_at: Timestamp }`
  - refusals (`details.reason`): `OUT_OF_STOCK`
  - events: `stock.changed`


## 8. M6 Promotions

### 8.1 Lifecycle

| To | From | Rule | Notes |
|---|---|---|---|
| scheduled | draft (`starts_at > now`) | R-PROMO-ACTIVATE (held for `promotions:approve`) | validated per 2.3 and `ends_at > now` |
| active | draft (`starts_at <= now < ends_at`) | R-PROMO-ACTIVATE (held) | |
| active | paused (`now < ends_at`) | R-PROMO-CONTROL (auto) | resume |
| paused | active, scheduled | R-PROMO-CONTROL | |
| ended | active, paused, scheduled | R-PROMO-CONTROL | terminal |
| draft | scheduled | R-PROMO-CONTROL | withdraw before start |
| active | scheduled at `starts_at` | R-PROMO-SCHEDULE (`service:scheduler`) | |
| ended | active or paused at `ends_at` | R-PROMO-SCHEDULE | |

While held, the node keeps its status; approval applies the change as the approver's commit (kernel approvals).
Edits of eligibility, effects, budget or schedule while scheduled, active or paused are also held (R-PROMO-ACTIVATE).
Budget exhaustion never changes status: the promotion is rejected with reason `budget`.

### 8.2 Contexts

`PromoContext` is a purchase (cart lines) or an earn (base points with a channel and earn type). Effects that apply:
purchase — `store_discount`, `free_item`, `bonus_points` with `on: "purchase"`; earn — `points_multiplier`,
`bonus_points` with `on: "earn"`. Awards evaluate earn context with channel `recognition`; automation `award_points`
steps with channel `automation`; badge rewards with `badge_reward`/`recognition`.

### 8.3 Evaluation semantics (`evaluatePromotions`, pure)

1. **Per candidate**, the first failing check in this order is its rejection reason: `status` (live: must be
   `active`; simulate: any non-`ended` status is evaluated and the status is reported in `advisories`), `window`
   (`starts_at <= now < ends_at`, `days_of_week` (ISO, Monday 1) and `hours_utc` contain `now`), `channel`, `context`
   (no effect applies to this context), `tier`, `region`, `segment` (any listed segment matches), `group`,
   `new_member` (`joined_days <= new_members_days`), `filter` (`evalCond` over member facts), `entitlement` (when
   `entitlement_only`), `min_cart` (purchase subtotal before discounts), `scope` (purchase: at least one line in
   `products`/`categories` when given), `per_member` (`member_redemptions < max_per_member`), `budget`
   (`redemptions < max_redemptions`).
2. **Order** eligible candidates by `priority` descending, then `slug` ascending.
3. **Stacking.** If the first is `exclusive`, it alone is selected and the rest are rejected `stacking`. Otherwise
   every `exclusive` candidate is rejected `stacking`, and of stackable candidates sharing a `stack_group` only the
   first is kept.
4. **Effects**, integers only:
   - `store_discount`: each line's discount percent is the maximum percent among selected discounts whose
     `products`/`categories` cover the line (or all lines when neither is set); `discount = floor(qty * unit_points *
     percent / 100)`; a `max_discount_points` cap applies to that effect's allocations in line order.
   - `free_item`: when `subtotal >= min_cart_points` and the product is in stock, add a line of qty 1 at 0 points; its
     cost and benefit are the product's price.
   - `points_multiplier`: the largest selected factor applies once: `bonus = floor(base * (factor - 1))`.
   - `bonus_points`: adds `points` (purchase: credited at delivery; earn: in the award transaction).
   Each effect's `cost_points = benefit_points`; a promotion's cost is the sum of its effects.
5. **Budget.** A selected promotion whose `usage.cost_points + cost > max_cost_points` is dropped (`budget`) and
   steps 3 and 4 rerun without it, until stable (at most one pass per candidate).
6. **Totals.** Purchase: `subtotal`, `discount_points` (sum of line discounts), `total = subtotal - discount`,
   `bonus_points`, `free_items`. Earn: `base`, `bonus`, `final = base + bonus`. `cost_points` is the sum over applied.

Same input, same output (Guarantee by property test). Simulation evaluates an unsaved spec exactly like a saved one;
`baseline` is the same context with no candidates. Uplift (analytics): store orders per eligible member-day during the
promotion against an equal window before `starts_at`, over members eligible now.

#### Endpoints: M6 Promotions


- **`GET /suite/promotions`** — action `promotions.list`
  - Promotions with status, window and live usage.
  - permission: `promotions:simulate` · read · agent: `direct`
  - in: `{ status?: PromotionStatus[] }`
  - out: `{ items: PromotionSummary[]; status_counts: {...} }`
- **`GET /suite/promotions/active`** — action `promotions.active`
  - Active promotions the viewer qualifies for now (store banners, home).
  - permission: `suite:use` · read · agent: `direct`
  - in: `{}`
  - out: `{ items: ActivePromotion[] }`
- **`POST /suite/promotions/simulate`** — action `promotions.simulate`
  - Evaluate a saved or unsaved promotion against a member and a sample purchase or earn context.
  - permission: `promotions:simulate` · read · agent: `direct`
  - in: `{ promotion: promotion:<slug> \| { slug: string; title: string; spec: PromotionSpec }; member: Handle; context: PromoContext; at?: Timestamp; include_live?: boolean }`
  - out: `{ member: {...}; at: Timestamp; evaluation: PromoEvaluation; baseline: PromoEvaluation }`
- **`POST /suite/promotions/:slug/transitions`** — action `promotions.transition`
  - Schedule, activate, pause, resume, end or return to draft. To scheduled/active from draft is held (R-PROMO-ACTIVATE).
  - permission: `promotions:manage` · mutating · agent: `preview`
  - in: `{ slug: string; to: "scheduled" \| "active" \| "paused" \| "ended" \| "draft"; reason?: string; base_revision: Int }`
  - out: `{ status: "committed" \| "pending_approval"; approval_id?: string; change_seq?: Int; revision?: Int; rule_id: string[] }`
  - refusals (`details.reason`): `INVALID_TRANSITION`
  - events: `promotion.state_changed`, `approval.requested`
- **`GET /suite/promotions/:slug/analytics`** — action `promotions.analytics`
  - Redemptions, cost, series, by tier and region, uplift.
  - permission: `promotions:simulate` · read · agent: `direct`
  - in: `{ slug: string; bucket?: "hour" \| "day" }`
  - out: `{ slug: string; status: PromotionStatus; usage: PromotionUsageView; benefit_points: Points; series: {...}[]; by_tier: Record<string, {...}>; by_region: Record<string, {...}>; uplift: {...} \| null }`


## 9. M7 Automation

### 9.1 Engine

The automation engine runs in the worker process (`packages/worker`, one instance per workspace, holding
`pg_try_advisory_lock(727275)`). It consumes `domain_events` in seq order from its cursor (`engine_cursors`,
consumer `automation`), woken by `plinth_domain` NOTIFY with a 1 s poll fallback, and ticks once per virtual minute
for schedule and metric triggers.

### 9.2 Trigger matching

- **Event**: for each enabled Automation whose trigger `event` equals the event type and whose `filter` passes over
  `{ event: payload, member: facts of member_id, now }`, a run is created with `trigger_key = "event:<seq>"`. Events
  with `cause_depth >= 3`, and events caused by the same automation, never trigger (loop guard; the skipped match is
  recorded as a `skipped` run with `error.code = "LOOP_SUSPECTED"`).
- **Schedule**: the minute tick evaluates each cron over virtual UTC; a match creates `trigger_key =
  "cron:<minute ISO>"`. Missed minutes after downtime are caught up from `scheduler_ticks`, at most 60.
- **Metric**: every `every_minutes`, run the query as the owner (QueryEngine, owner's grants) and read `value_column`
  from the last row; while `value op threshold` holds, `holding_since` is kept; when it has held for `for_minutes`
  and `last_fired_key` differs from the current window key (`metric:<holding_since ISO>`), fire. It fires again only
  after the condition has become false and true again (rising edge).
- **Manual**: `automation.trigger` with `trigger_key = "manual:<idempotency key>"`.

`UNIQUE (workspace_id, automation_id, trigger_key)` makes run creation exactly-once per trigger (Guarantee).

### 9.3 Conditions and limits

After creation the run evaluates `conditions` over the context; false gives `skipped`. Limits:
`max_runs_per_member_per_day` counts succeeded and running runs for the same `member_id` in the virtual UTC day;
`cooldown_minutes` since the last succeeded run for that member; exceeding gives `skipped` with `error.code =
"LIMIT"`.

### 9.4 Execution

Steps run in order as `service:automation` **on behalf of the automation's `owner`**: every step is authorised against
the owner's grants (the owner's permission for the equivalent action, e.g. `points:award` for `award_points`,
`notifications:send` for `notify` to others, `messages:use`, `tasks:manage` for assigning others,
`promotions:manage` for `apply_promotion`). A missing permission fails the step with `FORBIDDEN` (not retryable).
Templates substitute `{{path}}` as text. Each step's writes use idempotency key `run:<run_id>:step:<step_id>` (the
ledger key, message idempotency, notification `dedupe_key`, task, entitlement and webhook delivery), so a re-executed
step never duplicates its effect (Guarantee). Events produced carry `cause = { automation, run_id, step_index,
depth: parent depth + 1 }`. A step with `when` false is `skipped`. `on_error: "continue"` lets later steps run after a
failure; the run is `failed` if any step failed.

Step effects: `award_points` posts an `award` (promotions apply, channel `automation`); `notify` creates
notifications (12.3) with the given type; `send_message` sends from `service:automation` on behalf of the owner
(thread kind `system`); `apply_promotion` inserts a `promotion_entitlements` row expiring after `expires_in_days`;
`create_task` creates a task (`source: automation`, `run_id`); `webhook` inserts a `webhook_deliveries` row with the
substituted payload and status `recorded` (never sent: a stub).

### 9.5 Retries

A retryable step error (`StoreError`, `CONFLICT` on a lock timeout, `RATE_LIMITED`) is retried up to 3 attempts with
wall-clock backoff 1 s, 4 s, 16 s (`next_attempt_at`); then the step fails. `automation.retry` creates a run with
`trigger_key = "retry:<run_id>:<n>"` that re-executes the failed and pending steps with the **original** step keys.
`automation.cancel` stops a queued or running run after its current step. Every status change appends
`automation.run_updated`.

### 9.6 Dry run

`automation.dry_run` builds the context from a sample event (or a recorded `event_seq`), evaluates trigger match,
conditions, limits and each step's `when`, substitutes templates, checks the owner's permission per step, and returns
what each step would do (`effect` sentence) with no writes. For schedule triggers it lists the next five fire times.

#### Endpoints: M7 Automation


- **`GET /suite/automations`** — action `automation.list`
  - Automations with last run, 7-day counts and next fire.
  - permission: `automation:manage` · read · agent: `direct`
  - in: `{}`
  - out: `{ items: AutomationSummary[] }`
- **`POST /suite/automations/dry-run`** — action `automation.dry_run`
  - Evaluate trigger, conditions, limits and every step without side effects.
  - permission: `automation:manage` · read · agent: `direct`
  - in: `{ automation: automation:<slug> \| { slug: string; title: string; spec: AutomationSpec }; event?: SampleEvent; event_seq?: Int; at?: Timestamp }`
  - out: `{ trigger_matched: boolean; conditions_passed: boolean; limits_ok: boolean; context: Record<string, unknown>; steps: DryRunStep[]; next_fires: Timestamp[] }`
- **`POST /suite/automations/:slug/enabled`** — action `automation.set_enabled`
  - Enable or disable (a node change; agents' enable is held, webhook steps are held for everyone).
  - permission: `automation:manage` · mutating · agent: `preview`
  - in: `{ slug: string; enabled: boolean; base_revision: Int }`
  - out: `{ status: "committed" \| "pending_approval"; approval_id?: string; change_seq?: Int; revision?: Int; rule_id: string[] }`
  - refusals (`details.reason`): `INVALID_TRANSITION`
  - events: `approval.requested`
- **`POST /suite/automations/:slug/trigger`** — action `automation.trigger`
  - Run now with a sample event (a real run with real effects; works while disabled).
  - permission: `automation:manage` · mutating · agent: `preview`
  - in: `{ slug: string; event?: SampleEvent; idempotency_key: IdempotencyKey }`
  - out: `{ run_id: UUID; automation: string; automation_title: string; automation_revision: Int; status: RunStatus; trigger: RunTrigger; member: PersonRef \| null; started_at: Timestamp \| null; finished_at: Timestamp \| null; steps_total: Int; steps_succeeded: Int; error: StepError \| null }`
  - refusals (`details.reason`): `INVALID_TRANSITION`
  - events: `automation.run_updated`
- **`GET /suite/automations/runs`** — action `automation.runs`
  - Run history.
  - permission: `automation:manage` · read · agent: `direct`
  - in: `{ automation?: string; status?: RunStatus[]; member?: Handle; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: RunSummary[]; next_cursor: string \| null }`
- **`GET /suite/automations/runs/:run_id`** — action `automation.run`
  - One run with per-step status, inputs, outputs and errors.
  - permission: `automation:manage` · read · agent: `direct`
  - in: `{ run_id: UUID }`
  - out: `{ run_id: UUID; automation: string; automation_title: string; automation_revision: Int; status: RunStatus; trigger: RunTrigger; member: PersonRef \| null; started_at: Timestamp \| null; finished_at: Timestamp \| null; steps_total: Int; steps_succeeded: Int; error: StepError \| null; context: Record<string, unknown>; steps: RunStep[]; cause_depth: Int }`
- **`POST /suite/automations/runs/:run_id/retry`** — action `automation.retry`
  - Re-run a failed run's failed and pending steps with the same step idempotency keys.
  - permission: `automation:manage` · mutating · agent: `preview`
  - in: `{ run_id: UUID; idempotency_key: IdempotencyKey }`
  - out: `{ run_id: UUID; automation: string; automation_title: string; automation_revision: Int; status: RunStatus; trigger: RunTrigger; member: PersonRef \| null; started_at: Timestamp \| null; finished_at: Timestamp \| null; steps_total: Int; steps_succeeded: Int; error: StepError \| null }`
  - refusals (`details.reason`): `INVALID_TRANSITION`
  - events: `automation.run_updated`
- **`POST /suite/automations/runs/:run_id/cancel`** — action `automation.cancel`
  - Cancel a queued or running run; steps already done stay done.
  - permission: `automation:manage` · mutating · agent: `preview`
  - in: `{ run_id: UUID }`
  - out: `{ run_id: UUID; automation: string; automation_title: string; automation_revision: Int; status: RunStatus; trigger: RunTrigger; member: PersonRef \| null; started_at: Timestamp \| null; finished_at: Timestamp \| null; steps_total: Int; steps_succeeded: Int; error: StepError \| null }`
  - refusals (`details.reason`): `INVALID_TRANSITION`
  - events: `automation.run_updated`


## 10. M8 Content

### 10.1 Model

A Content node holds the blocks, audience, author, reviewers and schedule. Its versions are its change-log revisions;
`content.versions` and `content.diff` read them. The feed serves the body at `published_revision` through the kernel
`bodyAt`, so a published page can be revised as a draft while the published revision stays live.

### 10.2 Audience

A member is in the audience when `audience.everyone`, or they match any listed segment, or they belong to any listed
group. `content.feed` and `content.published` apply it (`NOT_ELIGIBLE` otherwise). At publish, the audience is
expanded once to set the `content.published` event's audience.

### 10.3 Workflow

| Action | From | To | Who | Effects |
|---|---|---|---|---|
| submit | draft | in_review | `content:author` and actor is the author or holds `content:publish`; at least one reviewer | `approval.requested` (type `content_review`) and `content_review` notifications to reviewers |
| approve | in_review | approved | `content:review`, actor in `reviewers`, not the author (`SELF_ACTION`) | `approval.decided` |
| request_changes | in_review | draft | `content:review`, actor in `reviewers`; `note` required | `approval.decided` (reject) |
| publish | approved | published | `content:publish` | `published_revision` = the result revision of this commit; `content.published`; `content_published` notifications to the audience when `pinned` or type `announcement` |
| schedule | approved | approved | `content:publish`; `publish_at > now` | sets `schedule.publish_at`; the scheduler publishes at that time (as `service:scheduler`) |
| unschedule | approved | approved | `content:publish` | clears `publish_at` |
| revise | published | draft | `content:author` | keeps `published_revision`; the feed keeps serving it |
| archive | published, approved, draft | archived | `content:publish` | leaves the feed |
| restore | archived | draft | `content:author` | |

The scheduler also archives a published item at `schedule.unpublish_at`. Every action appends a `review_log` entry,
commits through the change log with rule R-CONTENT-STATUS and `managed: { by: "content.transition" }`, and appends
`content.state_changed`. Body edits are allowed only in `draft` (2.3). `display_status` in lists derives
`scheduled` (approved with a future `publish_at`) and `revising` (draft with a `published_revision`).

#### Endpoints: M8 Content


- **`GET /suite/content`** — action `content.list`
  - All content for editors and reviewers (content:review also allowed).
  - permission: `content:author` · read · agent: `direct`
  - in: `{ status?: ContentStatus[]; type?: "page" \| "article" \| "announcement"; tag?: string; author?: string; awaiting_my_review?: boolean; q?: string; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: ContentSummary[]; next_cursor: string \| null; status_counts: {...} }`
- **`POST /suite/content/:slug/transitions`** — action `content.transition`
  - Workflow: submit, approve, request_changes, publish, schedule, unschedule, revise, archive, restore.
  - permission: `varies (CONTRACT.md 10.3)` · mutating · agent: `preview`
  - in: `{ slug: string; action: ContentAction; note?: string; publish_at?: Timestamp; base_revision: Int }`
  - out: `{ status: "committed" \| "pending_approval"; approval_id?: string; change_seq?: Int; revision?: Int; rule_id: string[] }`
  - refusals (`details.reason`): `INVALID_TRANSITION`, `SELF_ACTION`, `NOT_ELIGIBLE`
  - events: `content.state_changed`, `content.published`, `approval.requested`, `approval.decided`, `notification.created`
- **`GET /suite/content/feed`** — action `content.feed`
  - Published content targeted to the viewer, pinned first, newest first.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ type?: "page" \| "article" \| "announcement"; tag?: string; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: FeedItem[]; next_cursor: string \| null }`
- **`GET /suite/content/published/:slug`** — action `content.published`
  - The body at published_revision, if the viewer is in the audience.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ slug: string }`
  - out: `{ item: FeedItem; revision: Int; blocks: ContentBlock[] }`
  - refusals (`details.reason`): `NOT_ELIGIBLE`
- **`POST /suite/content/published/:slug/engagement`** — action `content.engage`
  - Record a view and/or set or clear a reaction.
  - permission: `suite:use` · mutating · agent: `deny`
  - in: `{ slug: string; view?: boolean; reaction?: Reaction \| null }`
  - out: `{ views: Int; reactions: {...}; my_reaction: Reaction \| null }`
  - refusals (`details.reason`): `NOT_ELIGIBLE`
  - events: `content.engaged`
- **`GET /suite/content/:slug/versions`** — action `content.versions`
  - Revision list from the change log.
  - permission: `content:author` · read · agent: `direct`
  - in: `{ slug: string }`
  - out: `{ items: VersionView[]; head: Int; published_revision: Int \| null }`
- **`GET /suite/content/:slug/diff`** — action `content.diff`
  - Field and block-level diff between two revisions.
  - permission: `content:author` · read · agent: `direct`
  - in: `{ slug: string; from: Int; to: Int }`
  - out: `{ from: Int; to: Int; changed_paths: string[]; human_summary: string; fields: {...}[]; blocks: BlockDiff[] }`
- **`GET /suite/content/:slug/preview`** — action `content.preview`
  - Any revision's body for the editor preview and reviewers.
  - permission: `content:author` · read · agent: `direct`
  - in: `{ slug: string; revision?: Int }`
  - out: `{ node: NodeLink; spec: ContentSpec; revision: Int }`


## 11. Seed data

### 11.1 Generator

`make demo-reset` runs the kernel reset (orders source, boards, grants) and then the Suite seed,
`packages/gen/src/suite/` (K12): a deterministic script of domain commands generated from `PLINTH_DEMO_SEED` (2026)
with the existing xoshiro256** generator, executed **through the same action handlers** with the clock overridden to
each command's virtual timestamp, over the 90 virtual days ending at the demo time 2026-11-20 14:30 UTC. After each
command the badge and automation engines drain inline (seed mode), so badge awards, automation runs, notifications and
ledger history are consistent by construction. Node configuration (Program, Roles, role Grants, Categories,
Products, Badges, Segments, Groups, Promotions, Automations, Content, Pages, Widgets, Preferences) is committed first on
the system surface as `service:ingest`, then activity. Reset is reproducible: the same seed gives byte-identical
domain payloads and the same ledger (Guarantee: `suite_seed_deterministic`).

### 11.2 People (40 members)

Named (handle, subject, roles, region, department, title):

| Name | Handle | Subject | Roles | Region | Department | Title | Target tier |
|---|---|---|---|---|---|---|---|
| Maya Ortiz | maya-ortiz | user:ops-lead | admin, manager | NA | operations | Operations lead | platinum |
| Jonas Becker | jonas-becker | user:emea-lead | manager (scope EMEA) | EMEA | operations | Regional lead, EMEA | gold |
| Priya Nair | priya-nair | user:finance-analyst | finance | APAC | finance | Finance analyst | silver |
| Tomás Alvarez | tomas-alvarez | user:marketing-lead | marketing-manager | LATAM | marketing | Engagement marketing lead | gold |
| Leah Okafor | leah-okafor | user:content-editor | content-editor | EMEA | people | Internal communications editor | silver |
| Samir Haddad | samir-haddad | user:it-admin | admin | EMEA | technology | Platform administrator | bronze |

Named members keep their existing kernel subjects (`user:ops-lead`, ...) so the kernel demo still works; their member
handle is the name. The 34 generated members have subject `user:<handle>` (dev token `dev-user-<handle>`):

NA: ana-silva (fulfilment), ben-carter (fulfilment), chloe-nguyen (operations), david-kim (technology), emma-brooks
(fulfilment), frank-moore (operations), grace-lee (people), henry-walsh (fulfilment), isla-reed (marketing).
EMEA: jakob-meyer (fulfilment), lena-fischer (operations), marco-rossi (fulfilment), nadia-haddad (finance),
oliver-hughes (fulfilment), paula-novak (operations), quentin-dubois (technology). APAC: rina-tanaka (fulfilment),
sanjay-patel (operations), tara-wong (fulfilment), umar-rahman (fulfilment), vivian-chen (marketing), wei-zhang
(technology), yuki-sato (operations). LATAM: zoe-castillo (fulfilment), andres-mejia (operations), bianca-souza
(fulfilment), carlos-ruiz (people), diana-flores (fulfilment). ANZ: ethan-clarke (fulfilment), fiona-walker
(operations), george-tane (fulfilment), hannah-scott (finance), ivan-petrov (technology), jade-morgan (fulfilment).

Distribution after history: 16 bronze, 12 silver, 8 gold, 4 platinum (the generator sizes award history per member to
hit the target tier from the member's index; named targets above). `joined_at` spreads over the 3 years before the
demo date; `avatar_hue` = `(index * 47) % 360`. Every member gets a Preference node from Program defaults, a member
account, and 1 to 3 seeded `member_sessions` (one current-looking "Chrome on Windows" for the named six).

Groups (Group nodes): `all-staff` (40, distribution, managers: Maya, Leah; closed posting), `na-ops`, `emea-ops`,
`apac-ops`, `latam-ops`, `anz-ops` (region groups, managers the regional leads or Maya), `peak-crew` (interest, 12),
`wellness-club` (interest, 9).

Segments: `emea-gold-plus` (example), `new-joiners` (`joined_days <= 120`), `high-balance` (`balance >= 15000`),
`at-risk` (`last_active_days >= 14`), `fulfilment-floor` (`department eq fulfilment`), `big-spenders`
(`points_redeemed_30d >= 5000`).

### 11.3 Catalogue (6 categories, 60 products)

Categories: `apparel` (shirt, 212), `tech` (laptop, 250), `home` (plant, 140), `experiences` (mountain, 30),
`wellness` (leaf, 160), `giving` (heart, 350). Product slugs are the kebab-case titles; artwork uses the category icon
and hue with pattern cycling `dots, stripes, rings, grid, waves, solid`; initial stock is `5 + (index * 13) % 40`
except as marked (out = 0, low = 2). Prices in points; fulfilment `ship` unless marked.

| Category | Products (price) |
|---|---|
| apparel | Fleece quarter-zip (4 200, featured), Peak crew tee (1 200), Rain shell jacket (7 800), Merino beanie (1 500), Logo cap (900), Canvas tote (800), Thermal socks 3-pack (700), Soft-shell vest (5 600, low), Hi-vis running top (2 400), Embroidered hoodie (3 900) |
| tech | Wireless earbuds (9 500, featured), Power bank 20k (3 200), Smart mug (6 400), Mechanical keyboard (11 000), Desk lamp (4 800), USB-C hub (2 900), Noise-cancelling headphones (22 000, min tier gold), Fitness band (7 200, out), Portable speaker (5 500), E-reader (13 500) |
| home | Herb garden kit (2 200), Pour-over coffee set (3 600, featured), Weighted blanket (8 800), Cast-iron skillet (4 400), Cocktail kit (3 100), Ceramic planter set (1 900), Picnic blanket (2 600), Knife sharpener (1 700), Aroma diffuser (2 800), Board game night box (3 300) |
| experiences | Cooking class for two (14 000, pickup), Hot-air balloon flight (48 000, pickup, min tier platinum, high value), Spa day (18 000, pickup), Concert tickets pair (16 000, digital), Climbing session (6 500, pickup), Wine tasting (12 000, pickup), Kayak tour (9 000, pickup), Stargazing night (7 500, pickup), Museum annual pass (8 500, digital), Weekend cabin (60 000, pickup, min tier platinum, low) |
| wellness | Yoga mat (2 500), Massage gun (12 500, featured), Meditation app year (4 000, digital), Water bottle (900), Resistance bands (1 400), Foam roller (1 600), Sleep mask set (1 100), Running belt (1 300), Bike tune-up voucher (3 500, digital), Nutrition consult (6 000, digital) |
| giving | Plant 10 trees (1 000, donation, featured), Food bank meal pack (1 500, donation), School supplies kit (2 000, donation), Clean water pledge (2 500, donation), Animal shelter day (1 800, donation), Literacy book bundle (1 200, donation), Coral reef restoration (3 000, donation), Community garden plot (2 200, donation), Warm coats drive (1 600, donation), Disaster relief pledge (5 000, donation) |

### 11.4 Badges (15)

| Slug | Title | Criteria | Reward | Rarity |
|---|---|---|---|---|
| first-redemption | First redemption | event `order.placed` | 100 | common |
| silver-standard | Silver standard | points_threshold 5 000 | 250 | common |
| gold-standard | Gold standard | points_threshold 20 000 | 500 | rare |
| platinum-club | Platinum club | points_threshold 50 000 | 1 000 | epic |
| big-heart | Big heart | action_count `order.placed` 3, filter `event.categories contains giving` (derived fact) | 300 | uncommon |
| conversation-starter | Conversation starter | action_count `message.sent` 25 | 150 | common |
| team-player | Team player | action_count `points.posted` 10, filter `all: [event.txn_type eq transfer, event.delta lt 0]` (transfers sent) | 200 | uncommon |
| streak-7 | On a roll | streak `message.sent` 7 days | 200 | uncommon |
| streak-30 | Unstoppable | streak `points.posted` 30 days, filter `event.delta > 0` | 750 | epic |
| critic | Critic | action_count `review.created` 5 | 150 | common |
| early-bird | Early bird | event `content.engaged`, filter `event.viewed eq true` within the first hour of publication (backend fact `event.minutes_since_publish <= 60`) | 50 | common |
| peak-hero | Peak hero | manual | 1 000 | legendary |
| mentor | Mentor | manual | 500 | rare |
| automation-pioneer | Automation pioneer | action_count `automation.run_updated` 10, filter `event.status eq succeeded` (owner) | 300 | rare, hidden |
| collector | Collector | action_count `badge.awarded` 8 | 400 | epic |

Note for the backend: badge filters may address **derived payload facts** the engine adds to the event context
(never stored in the payload): `order.placed` gains `categories: string[]`; `content.engaged` gains
`minutes_since_publish`; `points.posted` filters use the existing `txn_type` and `delta`. The catalogue endpoint lists the derived facts with
the payload fields.

### 11.5 Promotions (8)

| Slug | Status | Summary |
|---|---|---|
| gold-double-points | active | Recognition earns 2x for gold and platinum, budget 250 000, exclusive, priority 500 |
| peak-season-store-15 | active | 15 % off apparel and wellness, stack group `seasonal`, budget 120 000 (at 78 % used) |
| giving-match | active | Bonus 200 on any giving order (on purchase), max 3 per member |
| new-joiner-welcome | scheduled | Starts 2026-11-23: 500 bonus on first order for segment `new-joiners` |
| emea-weekend-boost | paused | 1.5x recognition for region EMEA, Saturdays and Sundays |
| black-friday-tech | draft | 20 % off tech, max discount 3 000 per order; held activation pending Priya's approval (requested by the agent for Maya) |
| free-tote-over-5k | ended | Free canvas tote on carts of 5 000 or more (ended 2026-11-10) |
| reengage-at-risk | draft | Entitlement-only 1 000 bonus granted by automation `win-back` |

Redemption history is consistent with orders and awards in the windows above.

### 11.6 Automations (10)

| Slug | Enabled | Trigger | Steps |
|---|---|---|---|
| welcome-first-order | yes | event `order.placed`, condition `member.orders_90d eq 1` | award 150, send_message |
| tier-up-congrats | yes | event `tier.changed` | notify member (tier_changed), send_message from Maya's team |
| badge-shoutout | yes | event `badge.awarded`, filter rarity in [epic, legendary] | notify `group:all-staff` (system) |
| high-value-review | yes | event `order.placed`, filter `event.requires_approval eq true` | create_task for `$owner` (Maya) linked to the order |
| low-stock-alert | yes | event `stock.changed`, filter `event.stock_status eq low` | create_task (assignee Samir), notify |
| weekly-digest-nudge | yes | schedule `0 9 * * 1` | notify `group:all-staff` promotion_started summary |
| sla-team-bonus | yes | metric: p95 fulfilment latency over the last hour (orders source, region NA) `lt 900` ms held 30 min, evaluated every 15 min | notify `group:na-ops` (system "SLA held"), create_task for `$owner` "Award the NA team" |
| win-back | no | schedule `0 10 * * 3`, condition `member.last_active_days gte 14` | apply_promotion `reengage-at-risk`, send_message |
| review-reminder | yes | event `order.status_changed`, filter `event.to eq delivered` | notify member to review (system) after delivery |
| crm-sync-stub | no | event `order.placed` | webhook `crm` (enabling is held: R-AUTOMATION-EXTERNAL) |

Seeded run history: every enabled event automation ran for the matching seeded events (successes, a few `skipped` by
limits, two failed runs of `low-stock-alert` with a retried success).

### 11.7 Content (25)

Distribution: 12 published (4 announcements, 6 articles, 2 pages including `rewards-faq` and `how-points-work`),
3 approved (1 scheduled for 2026-11-21 09:00), 3 in review (reviewer Tomás; one by Leah awaiting him), 4 drafts
(one is a published page being revised), 3 archived. Authors are Leah (15), Tomás (5), Maya (3), the agent for Maya
(2 drafts). Topics: peak season, safety, regional wins, new rewards, giving campaign, tier perks. Engagement history
gives each published item 10 to 38 views and reactions.

### 11.8 Activity volume

About 60 message threads with 220 messages (direct, group, two broadcasts by Maya to `all-staff`, system messages
from automations), about 600 awards, 150 store orders across every status (8 high-value, 2 awaiting approval now), 80
transfers, monthly expiry postings, 40 reviews, 30 tasks (mixed status, 6 from automations), 2 pending content
reviews, 1 held promotion activation, 1 held role change (Samir proposes adding Ana Silva to `manager` scoped NA,
awaiting Maya), notifications derived from all of the above (about 900, recent ones unread). Pages: every module page
of UI-MAP section 2 as system pages, `home` and `profile`, and a personal `home.maya-ortiz`.

## 12. Remaining modules

### 12.1 M0 Shell and me

`me.get` is the shell bootstrap (one call): identity, member profile, roles with scopes, effective permissions, balance,
tier progress, counts, preferences, Program name, virtual clock, session id and both rt heads. `me.profile.update`
validates that showcase slugs are badges the member holds (`NOT_ELIGIBLE`). Sessions: 1.1; revoking the current
session is allowed (the tab then shows "Signed out"). `dev.principals` lists every principal with its dev token when
the dev identity layer is active (the identity switcher), with the six named people and the agent `featured`.

#### Endpoints: M0 Shell and me


- **`GET /suite/me`** — action `me.get`
  - Shell bootstrap: principal, member, roles, effective permissions, balance, tier, counts, preferences, clock.
  - permission: `authenticated` · read · agent: `direct`
  - in: `{}`
  - out: `{ principal: PersonRef; member: {...} \| null; on_behalf_of: PersonRef \| null; roles: {...}[]; permissions: string[]; balance: Points \| null; tier: TierProgress \| null; counts: NavCounts; preferences: PreferenceSpec \| null; program: {...}; virtual_now: Timestamp; clock: {...}; session_id: string \| null; rt: {...} }`
- **`GET /suite/me/counts`** — action `me.counts`
  - Nav badge counts (also pushed as the rt counts frame).
  - permission: `authenticated` · read · agent: `direct`
  - in: `{}`
  - out: `{ notifications_unread: Int; messages_unread: Int; approvals_pending: Int; tasks_open: Int; cart_items: Int; content_reviews: Int; orders_attention: Int }`
- **`GET /suite/me/activity`** — action `me.activity`
  - Own activity timeline (events where the member is actor or subject).
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ cursor?: Cursor; limit?: Limit; types?: DomainEventType[] }`
  - out: `{ items: ActivityItem[]; next_cursor: string \| null }`
- **`GET /suite/me/sessions`** — action `me.sessions`
  - Own sessions (browser tabs and MCP connections).
  - permission: `authenticated` · read · agent: `direct`
  - in: `{}`
  - out: `{ items: SessionView[] }`
- **`POST /suite/me/sessions/:session_id/revoke`** — action `me.sessions.revoke`
  - Revoke one of your own sessions; its sockets close with 4401 and its requests fail SESSION_REVOKED.
  - permission: `authenticated` · mutating · agent: `deny`
  - in: `{ session_id: string }`
  - out: `{ session_id: string; revoked_at: Timestamp }`
  - events: `session.revoked`
- **`PUT /suite/me/profile`** — action `me.profile.update`
  - Update own display name, title, bio, location, avatar hue and badge showcase (only held badges).
  - permission: `suite:use` · mutating · agent: `deny`
  - in: `{ display_name?: string; title?: string; bio?: string; location?: string; avatar_hue?: Int; showcase?: string[] }`
  - out: `{ principal: PersonRef; member: {...} \| null; on_behalf_of: PersonRef \| null; roles: {...}[]; permissions: string[]; balance: Points \| null; tier: TierProgress \| null; counts: NavCounts; preferences: PreferenceSpec \| null; program: {...}; virtual_now: Timestamp; clock: {...}; session_id: string \| null; rt: {...} }`
  - refusals (`details.reason`): `NOT_ELIGIBLE`
  - events: `member.updated`
- **`GET /suite/me/preferences`** — action `me.preferences.get`
  - Own Preference node merged over Program defaults.
  - permission: `notifications:use` · read · agent: `direct`
  - in: `{}`
  - out: `{ preferences: PreferenceSpec; revision: Int \| null; defaults: {...} }`
- **`PUT /suite/me/preferences`** — action `me.preferences.update`
  - Commit a change to own Preference node (rule R-PREFERENCE); creates it on first write.
  - permission: `notifications:use` · mutating · agent: `deny`
  - in: `{ notifications?: { mention: ChannelPrefs; message: ChannelPrefs; approval_request: ChannelPrefs; approval_decision: ChannelPrefs; points_awarded: ChannelPrefs; points_expiring: ChannelPrefs; badge_earned: ChannelPrefs; tier_changed: ChannelPrefs; order_status: ChannelPrefs; automation_alert: ChannelPrefs; content_review: ChannelPrefs; content_published: ChannelPrefs; task_assigned: ChannelPrefs; promotion_started: ChannelPrefs; system: ChannelPrefs }; digest?: DigestPrefs; quiet_hours?: { start_hour: Int; end_hour: Int } \| null; muted_threads?: UUID[]; ui?: UiPrefs; base_revision?: Int \| null }`
  - out: `{ preferences: PreferenceSpec; revision: Int; change_seq: Int }`
- **`GET /suite/dev/principals`** — action `dev.principals`
  - Dev identity switcher list with tokens. Served only by the dev identity layer; 404 otherwise.
  - permission: `none` · read · agent: `deny`
  - in: `{}`
  - out: `{ items: DevPrincipal[] }`


### 12.2 M1 Messages

Recipients are expanded at send time: groups to their members (only when `open_posting` or the sender is a manager,
else `NOT_ELIGIBLE` on that group), deduplicated, sender removed. Explicitly named disabled members are refused
(`MEMBER_DISABLED`); disabled members inside a group are skipped. If the expanded count reaches
`broadcast_min_recipients` the sender needs `messages:broadcast` (`LIMIT_EXCEEDED`, `details.permission`); above
`max_recipients` is `LIMIT_EXCEEDED`. Thread kind: `direct` (one recipient), `group` (any group recipient),
`broadcast` (count at or above the broadcast minimum), `system` (sent by a service). A receipt row is created per
recipient (`read_at` null) and for the sender (read at send). A new message un-archives the thread for recipients.
Mentions are `@handle` tokens of participants; a mentioned participant gets a `mention` notification instead of
`message`; muted threads notify only on mention. Folders: inbox = threads with a message not sent by the viewer and
not archived; sent = threads where the viewer sent a message; starred; archived. Search matches subject or body
(`to_tsvector('simple')`) within the viewer's threads. `messages.thread` never marks read; the thread widget calls
`messages.state { read: true }` when the thread is shown.

#### Endpoints: M1 Messages


- **`GET /suite/messages`** — action `messages.list`
  - Threads in a folder (inbox, sent, starred, archived), with search over subject and bodies.
  - permission: `messages:use` · read · agent: `direct`
  - in: `{ folder?: Folder; q?: string; unread_only?: boolean; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: ThreadSummary[]; next_cursor: string \| null; folder_counts: {...} }`
- **`GET /suite/messages/threads/:thread_id`** — action `messages.thread`
  - One thread with participants and messages. Does not mark read.
  - permission: `messages:use` · read · agent: `direct`
  - in: `{ thread_id: UUID }`
  - out: `{ thread: ThreadSummary; participants: ThreadParticipant[]; messages: MessageView[] }`
  - refusals (`details.reason`): `NOT_PARTICIPANT`
- **`POST /suite/messages`** — action `messages.send`
  - Start a thread. Groups expand at send time; reaching broadcast_min_recipients needs messages:broadcast.
  - permission: `messages:use` · mutating · agent: `preview`
  - in: `{ to: Recipient[]; cc?: Recipient[]; subject: string; body: string; attachments?: AttachmentMeta[]; idempotency_key: IdempotencyKey }`
  - out: `{ thread_id: UUID; message_id: UUID; recipient_count: Int; replayed: boolean }`
  - refusals (`details.reason`): `LIMIT_EXCEEDED`, `NOT_ELIGIBLE`, `MEMBER_DISABLED`
  - events: `message.sent`, `message.received`, `notification.created`
- **`POST /suite/messages/threads/:thread_id/replies`** — action `messages.reply`
  - Reply in a thread; optionally add recipients.
  - permission: `messages:use` · mutating · agent: `preview`
  - in: `{ thread_id: UUID; body: string; reply_to?: UUID; attachments?: AttachmentMeta[]; add_recipients?: Recipient[]; idempotency_key: IdempotencyKey }`
  - out: `{ thread_id: UUID; message_id: UUID; recipient_count: Int; replayed: boolean }`
  - refusals (`details.reason`): `NOT_PARTICIPANT`, `LIMIT_EXCEEDED`
  - events: `message.sent`, `message.received`, `notification.created`
- **`POST /suite/messages/threads/:thread_id/state`** — action `messages.state`
  - Set read, starred, archived or muted for one thread (read marks every message in it).
  - permission: `messages:use` · mutating · agent: `preview`
  - in: `{ thread_id: UUID; read?: boolean; starred?: boolean; archived?: boolean; muted?: boolean }`
  - out: `{ threads: {...}[] }`
  - refusals (`details.reason`): `NOT_PARTICIPANT`
  - events: `message.state_changed`
- **`POST /suite/messages/state`** — action `messages.bulk_state`
  - Bulk thread state.
  - permission: `messages:use` · mutating · agent: `preview`
  - in: `{ thread_ids: UUID[]; read?: boolean; starred?: boolean; archived?: boolean; muted?: boolean }`
  - out: `{ threads: {...}[] }`
  - refusals (`details.reason`): `NOT_PARTICIPANT`
  - events: `message.state_changed`
- **`GET /suite/messages/recipients`** — action `messages.recipients`
  - Recipient picker: people and groups matching q.
  - permission: `messages:use` · read · agent: `direct`
  - in: `{ q: string; limit?: Int }`
  - out: `{ items: RecipientOption[] }`


### 12.3 M2 Notifications

Notifications are created inside the transaction of the write that causes them, one per recipient, with
`dedupe_key = "<event seq>:<type>"` (automation steps use their step key). For each recipient the effective channel
preferences (their Preference node, falling back to Program defaults) decide: no row if every channel is off; else a
row with `in_app` from the preference; an email-stub delivery (`notification_deliveries`, channel `email`, `queued`,
marked `sent` by the worker within the minute, or `suppressed` with `quiet_hours`) when email is on; digest inclusion
when digest is on (the worker builds one `digest` delivery per member per period at the member's `hour_utc`).

| Cause | Type | Recipients |
|---|---|---|
| message received | `message` / `mention` | each recipient |
| held change, held action, high-value order, content submitted | `approval_request` | each human holding the approver permission (and `approval:decide`), excluding the requester and on_behalf_of |
| approval decided | `approval_decision` | requester (and the human on whose behalf an agent requested) |
| award, badge reward, promotion bonus credit | `points_awarded` | member |
| expiry warning (`warn_days`) | `points_expiring` | member |
| badge awarded | `badge_earned` | member |
| tier changed | `tier_changed` | member |
| order status change | `order_status` | member |
| automation `notify` step | the step's type | the step's targets |
| automation run failed | `automation_alert` | automation owner |
| content state change to in_review / approved / published | `content_review` / `content_published` | reviewers / author; audience for pinned announcements |
| task assigned, mentioned in a task comment | `task_assigned` | assignee / mentioned |
| promotion became active | `promotion_started` | members eligible now, when it has a banner |
| budget alert | `automation_alert` | promotion owner and finance |
| `notifications.send` | its type | expanded recipients |

`notifications.read`/`read_all` set `read_at` and emit `notification.read` with the new unread count.

#### Endpoints: M2 Notifications


- **`GET /suite/notifications`** — action `notifications.list`
  - Own notification feed, newest first.
  - permission: `notifications:use` · read · agent: `direct`
  - in: `{ filter?: "all" \| "unread"; types?: NotificationType[]; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: NotificationView[]; next_cursor: string \| null; unread_count: Int }`
- **`POST /suite/notifications/read`** — action `notifications.read`
  - Mark notifications read.
  - permission: `notifications:use` · mutating · agent: `preview`
  - in: `{ ids: UUID[] }`
  - out: `{ marked: Int; unread_count: Int }`
  - events: `notification.read`
- **`POST /suite/notifications/read-all`** — action `notifications.read_all`
  - Mark all (optionally of some types, before a time) read.
  - permission: `notifications:use` · mutating · agent: `preview`
  - in: `{ before?: Timestamp; types?: NotificationType[] }`
  - out: `{ marked: Int; unread_count: Int }`
  - events: `notification.read`
- **`POST /suite/notifications`** — action `notifications.send`
  - Send an ad-hoc notification to people and groups (respects each recipient's preferences).
  - permission: `notifications:send` · mutating · agent: `preview`
  - in: `{ to: Recipient[]; type: "system" \| "automation_alert" \| "promotion_started"; title: string; body: string; link?: string; idempotency_key: IdempotencyKey }`
  - out: `{ recipients: Int; suppressed: Int; replayed: boolean }`
  - refusals (`details.reason`): `LIMIT_EXCEEDED`
  - events: `notification.created`
- **`GET /suite/notifications/deliveries`** — action `notifications.deliveries`
  - Email-stub and digest delivery log (own; another member with people:view-private).
  - permission: `notifications:use` · read · agent: `direct`
  - in: `{ channel?: "email" \| "digest"; member?: Handle; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: DeliveryView[]; next_cursor: string \| null }`


### 12.4 M5 Badges

The badge engine runs in the worker on its own cursor (consumer `badges`). For each event with a `member_id`, for each
active Badge whose criteria name that event type (or `points.posted` for `points_threshold`): `points_threshold` awards
when the member's `lifetime_earned >= lifetime_points`; `event` awards on the first matching event; `action_count`
increments `badge_progress.current` for matching events (over `window_days` when set, recomputed from
`domain_events` by count) and awards at `count`; `streak` counts consecutive virtual UTC days with at least one
matching event (`streak_last_day`), resetting after a gap, and awards at `days`. Awards insert `badge_awards` (the
partial unique index makes a double award impossible: Guarantee), post the reward (`badge_reward`, key
`badge:<award_id>`), append `badge.awarded` and a `badge_earned` notification. Progress changes append
`badge.progress` (at most one per member, badge and minute). Hidden badges show no criteria until earned. Revoke sets
`revoked_at`, and reverses the reward if the member still holds those points (else the award note records it kept).

#### Endpoints: M5 Badges


- **`GET /suite/badges`** — action `badges.catalog`
  - Active badges with the member's awards and progress.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ member?: Handle; filter?: "all" \| "earned" \| "in_progress" \| "locked" }`
  - out: `{ member: PersonRef; items: BadgeCard[]; earned: Int; total: Int; next_up: BadgeCard[] }`
- **`GET /suite/badges/:slug`** — action `badges.get`
  - Badge detail with recent awards.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ slug: string }`
  - out: `{ card: BadgeCard; criteria: BadgeCriteria \| null; revision: Int; recent_awards: AwardView[]; holders_by_region: Record<string, Int> }`
- **`GET /suite/people/:handle/badges`** — action `badges.member`
  - A member's awards and showcase.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ handle: Handle }`
  - out: `{ member: PersonRef; awards: AwardView[]; showcase: string[] }`
- **`POST /suite/badges/:slug/awards`** — action `badges.award`
  - Manually award a badge (any criteria type).
  - permission: `badges:award` · mutating · agent: `approval`
  - in: `{ slug: string; member: Handle; reason: string; idempotency_key: IdempotencyKey }`
  - out: `{ award_id: UUID; badge: string; badge_title: string; artwork: BadgeArtwork; member: PersonRef; awarded_at: Timestamp; awarded_by: PersonRef; reason: string; points_txn_id: UUID \| null; revoked_at: Timestamp \| null }`
  - refusals (`details.reason`): `ALREADY_EXISTS`, `SELF_ACTION`, `MEMBER_DISABLED`
  - events: `badge.awarded`, `points.posted`, `notification.created`
- **`POST /suite/badges/awards/:award_id/revoke`** — action `badges.revoke`
  - Revoke an award; a points reward is reversed if the member still holds the points, otherwise kept and noted.
  - permission: `badges:revoke` · mutating · agent: `deny`
  - in: `{ award_id: UUID; reason: string }`
  - out: `{ award_id: UUID; badge: string; badge_title: string; artwork: BadgeArtwork; member: PersonRef; awarded_at: Timestamp; awarded_by: PersonRef; reason: string; points_txn_id: UUID \| null; revoked_at: Timestamp \| null }`
  - refusals (`details.reason`): `INVALID_TRANSITION`
  - events: `badge.revoked`


### 12.5 M9 People, groups and segments

Directory and profiles read `members` with tier from `ledger_accounts`. Private fields (email, session counts) are
returned to the member and to `people:view-private` only. Segments are evaluated live with `evalCond` over the member
facts of every active member (40 rows, no cache needed; Target: under 50 ms). `segments.preview` accepts an unsaved
rule from the builder. Group membership is the Group node.

#### Endpoints: M9 People and groups


- **`GET /suite/people`** — action `people.directory`
  - Member directory with filters.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ q?: string; region?: Region; tier?: Tier; department?: string; group?: string; role?: string; sort?: "name" \| "tier" \| "recent" \| "points"; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: MemberCard[]; next_cursor: string \| null; total: Int }`
- **`GET /suite/people/:handle`** — action `people.profile`
  - Public profile; private block for self and people:view-private.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ handle: Handle }`
  - out: `{ member: MemberCore; bio: string; tier: TierProgress; balance: Points \| null; showcase: BadgeCard[]; badges_count: Int; groups: NodeLink[]; roles: string[]; stats: {...}; private: {...} \| null; is_self: boolean }`
- **`GET /suite/people/:handle/activity`** — action `people.activity`
  - Public activity (badges, published content, reviews); everything for self and audit:view.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ handle: Handle; cursor?: Cursor; limit?: Limit; types?: DomainEventType[] }`
  - out: `{ items: ActivityItem[]; next_cursor: string \| null }`
- **`GET /suite/people/:handle/facts`** — action `people.facts`
  - The member facts the condition grammar sees (builder preview).
  - permission: `segments:preview` · read · agent: `direct`
  - in: `{ handle: Handle }`
  - out: `{ facts: MemberFacts }`
- **`GET /suite/groups`** — action `groups.list`
  - Groups.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{}`
  - out: `{ items: GroupSummary[] }`
- **`GET /suite/groups/:slug`** — action `groups.get`
  - Group with members.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ slug: string }`
  - out: `{ summary: GroupSummary; spec: GroupSpec; members: MemberCard[]; managers: PersonRef[] }`


#### Endpoints: M9 Segments


- **`GET /suite/segments`** — action `segments.list`
  - Segments with live counts.
  - permission: `segments:preview` · read · agent: `direct`
  - in: `{}`
  - out: `{ items: SegmentSummary[] }`
- **`POST /suite/segments/preview`** — action `segments.preview`
  - Evaluate a rule or saved segment: count, sample, distribution.
  - permission: `segments:preview` · read · agent: `direct`
  - in: `{ rule?: CondTree; segment?: segment:<slug>; sample?: Int }`
  - out: `{ count: Int; total_members: Int; sample: MemberCard[]; by_tier: {...}; by_region: {...}; used_by: NodeLink[] }`
- **`GET /suite/segments/:slug/members`** — action `segments.members`
  - Members matching a saved segment now.
  - permission: `segments:preview` · read · agent: `direct`
  - in: `{ slug: string; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: MemberCard[]; next_cursor: string \| null; count: Int }`


### 12.6 M10 Tasks

`task_no` from `suite_counters`. Anyone with `tasks:use` creates tasks for themselves; assigning someone else needs
`tasks:manage` (automations use the owner's rights). Updates: the assignee, the creator or `tasks:manage`; optimistic
`version` (`STALE_VERSION`); `done` sets `completed_at`, leaving `done` clears it; `cancelled` and `done` are terminal
except by `tasks:manage`. Each update writes `task_history` and `task.updated`; assignment changes also
`task.assigned` and a notification. `overdue` is `due_at < now` and status not done or cancelled.

#### Endpoints: M10 Tasks


- **`GET /suite/tasks`** — action `tasks.list`
  - Tasks assigned to or created by the viewer; scope=all needs tasks:manage.
  - permission: `tasks:use` · read · agent: `direct`
  - in: `{ scope?: "mine" \| "created" \| "all"; status?: TaskStatus[]; priority?: TaskPriority[]; q?: string; due_before?: Timestamp; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: TaskSummary[]; next_cursor: string \| null; status_counts: {...} }`
- **`GET /suite/tasks/:task_id`** — action `tasks.get`
  - Task with comments and history.
  - permission: `tasks:use` · read · agent: `direct`
  - in: `{ task_id: UUID }`
  - out: `{ task_id: UUID; task_no: Int; title: string; status: TaskStatus; priority: TaskPriority; assignee: PersonRef \| null; created_by: PersonRef; created_at: Timestamp; due_at: Timestamp \| null; overdue: boolean; link: TaskLink \| null; source: "manual" \| "automation"; comment_count: Int; version: Int; description: string; completed_at: Timestamp \| null; run_id: UUID \| null; comments: TaskComment[]; history: {...}[]; replayed?: boolean }`
- **`POST /suite/tasks`** — action `tasks.create`
  - Create a task; assigning someone else needs tasks:manage unless assigning yourself.
  - permission: `tasks:use` · mutating · agent: `preview`
  - in: `{ title: string; description?: string; assignee?: Subject; priority?: TaskPriority; due_at?: Timestamp; link?: TaskLink; idempotency_key: IdempotencyKey }`
  - out: `{ task_id: UUID; task_no: Int; title: string; status: TaskStatus; priority: TaskPriority; assignee: PersonRef \| null; created_by: PersonRef; created_at: Timestamp; due_at: Timestamp \| null; overdue: boolean; link: TaskLink \| null; source: "manual" \| "automation"; comment_count: Int; version: Int; description: string; completed_at: Timestamp \| null; run_id: UUID \| null; comments: TaskComment[]; history: {...}[]; replayed?: boolean }`
  - refusals (`details.reason`): `MEMBER_DISABLED`
  - events: `task.assigned`, `notification.created`
- **`POST /suite/tasks/:task_id`** — action `tasks.update`
  - Update fields with optimistic concurrency (assignee, creator or tasks:manage).
  - permission: `tasks:use` · mutating · agent: `preview`
  - in: `{ task_id: UUID; title?: string; description?: string; status?: TaskStatus; priority?: TaskPriority; assignee?: Subject \| null; due_at?: Timestamp \| null; version: Int }`
  - out: `{ task_id: UUID; task_no: Int; title: string; status: TaskStatus; priority: TaskPriority; assignee: PersonRef \| null; created_by: PersonRef; created_at: Timestamp; due_at: Timestamp \| null; overdue: boolean; link: TaskLink \| null; source: "manual" \| "automation"; comment_count: Int; version: Int; description: string; completed_at: Timestamp \| null; run_id: UUID \| null; comments: TaskComment[]; history: {...}[]; replayed?: boolean }`
  - refusals (`details.reason`): `STALE_VERSION`, `INVALID_TRANSITION`
  - events: `task.updated`, `task.assigned`, `notification.created`
- **`POST /suite/tasks/:task_id/comments`** — action `tasks.comment`
  - Comment on a task; @mentions notify.
  - permission: `tasks:use` · mutating · agent: `preview`
  - in: `{ task_id: UUID; body: string; idempotency_key: IdempotencyKey }`
  - out: `{ comment_id: UUID; author: PersonRef; body: string; created_at: Timestamp }`
  - events: `task.commented`, `notification.created`


### 12.7 M11 Approvals

`approvals.list` merges four sources into `ApprovalItem`: `change` (kernel `change_approvals`, which now also holds
Suite node changes: promotion activation, role membership, Program, agent product price, badge and automation edits,
system page edits), `action` (`action_approvals`: agent-held actions and over-limit awards), `order` (placed orders
with `requires_approval`), `content_review` (content in review where the viewer is a reviewer). `can_decide` applies
SoD (human, not requester, not on_behalf_of) and the approver permission; `blocked_reason` explains a `false`.
Approver permission: for change items, `APPROVER_PERMISSION[rule_id]`; for agent-held actions, the action's own
permission (`points:transfer`, `points:award`, `store:shop` for checkout, `badges:award`, `store:refund` for refunds);
for over-limit human awards, `points:adjust`; for orders, `store:approve`; for content reviews, being a listed
reviewer with `content:review`. Every approver also needs `approval:decide` on the item's resource.
`approvals.decide` dispatches: change to the kernel `decideApproval` (generalised approver permission); action:
approve executes the stored input as the original requester with `approved_by` set, recording `result` or `error`
(`failed`), reject marks it; order: approve or cancel (refunding); content_review: approve or request_changes
(reason required). Held items expire after 7 virtual days (scheduler) to `expired`.

#### Endpoints: M11 Approvals


- **`GET /suite/approvals`** — action `approvals.list`
  - Unified inbox: held changes, held actions, high-value orders, content reviews.
  - permission: `authenticated` · read · agent: `direct`
  - in: `{ scope?: "to_decide" \| "requested" \| "all"; types?: ApprovalType[]; status?: "pending_approval" \| "decided" \| "all"; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: ApprovalItem[]; next_cursor: string \| null; counts: {...} }`
- **`POST /suite/approvals/:type/:id/decision`** — action `approvals.decide`
  - Approve or reject (humans only, never the requester or on_behalf_of; SoD per spec 03 7.2).
  - permission: `approval:decide + approver permission` · mutating · agent: `deny`
  - in: `{ type: ApprovalType; id: string; decision: "approve" \| "reject"; reason?: string }`
  - out: `{ type: ApprovalType; id: string; title: string; summary: string; status: "pending_approval" \| "approved" \| "rejected" \| "withdrawn" \| "expired" \| "stale" \| "failed"; requested_by: PersonRef; on_behalf_of: PersonRef \| null; requested_at: Timestamp; expires_at: Timestamp \| null; rule_id: string[]; approver_permission: string; can_decide: boolean; blocked_reason: string \| null; decided_by: PersonRef \| null; decided_at: Timestamp \| null; decision_reason: string \| null; link: string; detail: Record<string, unknown> }`
  - refusals (`details.reason`): `SELF_ACTION`, `INVALID_TRANSITION`
  - events: `approval.decided`
- **`POST /suite/approvals/:type/:id/withdraw`** — action `approvals.withdraw`
  - The requester withdraws a pending change or action approval.
  - permission: `authenticated` · mutating · agent: `preview`
  - in: `{ type: ApprovalType; id: string; reason?: string }`
  - out: `{ type: ApprovalType; id: string; title: string; summary: string; status: "pending_approval" \| "approved" \| "rejected" \| "withdrawn" \| "expired" \| "stale" \| "failed"; requested_by: PersonRef; on_behalf_of: PersonRef \| null; requested_at: Timestamp; expires_at: Timestamp \| null; rule_id: string[]; approver_permission: string; can_decide: boolean; blocked_reason: string \| null; decided_by: PersonRef \| null; decided_at: Timestamp \| null; decision_reason: string \| null; link: string; detail: Record<string, unknown> }`
  - refusals (`details.reason`): `INVALID_TRANSITION`
  - events: `approval.decided`


### 12.8 M12 Audit

`audit.timeline` merges the change log (`changes`, kind `change`) and `domain_events` by virtual time, newest first,
each entry with actor, on_behalf_of, approved_by, surface, a Plinth-authored summary, rule ids, a link and its hash;
`undoable` marks change entries the viewer could undo (kernel `POST /changes/:seq/undo`). `audit.verify` verifies both
chains. Node history for `audit.node-history` uses the kernel `GET /history?uri=` and a new kernel mirror of the MCP
diff tool, `GET /diff?a=<ref>@<rev>&b=<ref>@<rev>` (K11).

#### Endpoints: M12 Audit


- **`GET /suite/audit`** — action `audit.timeline`
  - Change log and domain events merged by time.
  - permission: `audit:view` · read · agent: `direct`
  - in: `{ sources?: ("change" \| "event")[]; actor?: Subject; q?: string; from?: Timestamp; to?: Timestamp; region?: Region; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: AuditEntry[]; next_cursor: string \| null }`
- **`GET /suite/audit/events`** — action `audit.events`
  - Domain events with filters (own events need no audit:view).
  - permission: `audit:view` · read · agent: `direct`
  - in: `{ types?: DomainEventType[]; actor?: Subject; member?: Handle; subject_kind?: string; subject_id?: string; from?: Timestamp; to?: Timestamp; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: DomainEvent[]; next_cursor: string \| null }`
- **`GET /suite/audit/verify`** — action `audit.verify`
  - Verify both hash chains.
  - permission: `audit:view` · read · agent: `direct`
  - in: `{}`
  - out: `{ changes: ChainVerify; domain: ChainVerify; verified_at: Timestamp }`


### 12.9 M13 Admin and settings

`admin.member_create` creates the principal, member row, member ledger account, Preference node, and files the Role
change adding the new member to `member` (held under R-ROLE: a second admin approves). `admin.member_status` disabling
sets `principals.disabled_at` (the kernel identity refuses disabled principals), revokes all sessions, and appends
`member.updated` and `session.revoked`. Role membership changes are Role node changes held under R-ROLE. Grants are
managed with the kernel node API (R-GRANT). Settings has no endpoints of its own: `settings.appearance` and
`notifications.preferences` use `me.preferences.*`; `admin.program` edits the Program node (R-PROGRAM).

#### Endpoints: M13 Admin


- **`GET /suite/admin/members`** — action `admin.members`
  - Members with private fields, roles, status, sessions.
  - permission: `admin:members` · read · agent: `deny`
  - in: `{ q?: string; status?: "active" \| "disabled"; role?: string; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: AdminMemberRow[]; next_cursor: string \| null; total: Int }`
- **`POST /suite/admin/members`** — action `admin.member_create`
  - Create principal, member, ledger account, Preference; file the Role change adding them to member.
  - permission: `admin:members` · mutating · agent: `deny`
  - in: `{ handle: Handle; display_name: string; email: string; title: string; department: Department; region: Region; location: string }`
  - out: `{ person: PersonRef; account: string; preference_uri: string; role_change: HeldResult }`
  - refusals (`details.reason`): `ALREADY_EXISTS`
  - events: `member.updated`, `approval.requested`
- **`POST /suite/admin/members/:handle/status`** — action `admin.member_status`
  - Disable (sets principals.disabled_at, revokes sessions) or re-enable a member.
  - permission: `admin:members` · mutating · agent: `deny`
  - in: `{ handle: Handle; status: "active" \| "disabled"; reason: string }`
  - out: `{ handle: Handle; status: "active" \| "disabled"; sessions_revoked: Int }`
  - refusals (`details.reason`): `SELF_ACTION`
  - events: `member.updated`, `session.revoked`
- **`GET /suite/admin/sessions`** — action `admin.sessions`
  - All sessions.
  - permission: `admin:members` · read · agent: `deny`
  - in: `{ member?: Handle; active_only?: boolean; cursor?: Cursor; limit?: Limit }`
  - out: `{ items: {...}[]; next_cursor: string \| null }`
- **`POST /suite/admin/sessions/:session_id/revoke`** — action `admin.session_revoke`
  - Revoke any session.
  - permission: `admin:members` · mutating · agent: `deny`
  - in: `{ session_id: string }`
  - out: `{ session_id: string; revoked_at: Timestamp }`
  - events: `session.revoked`
- **`GET /suite/admin/roles`** — action `admin.roles`
  - Roles with members, grants and pending changes.
  - permission: `admin:roles` · read · agent: `deny`
  - in: `{}`
  - out: `{ items: RoleView[] }`
- **`POST /suite/admin/roles/:slug/members`** — action `admin.role_members`
  - Propose role membership changes (a Role node change, held under R-ROLE).
  - permission: `admin:roles` · mutating · agent: `deny`
  - in: `{ slug: string; add?: RoleMember[]; remove?: Subject[]; base_revision: Int; reason: string }`
  - out: `{ status: "committed" \| "pending_approval"; approval_id?: string; change_seq?: Int; revision?: Int; rule_id: string[] }`
  - refusals (`details.reason`): `SELF_ACTION`
  - events: `approval.requested`
- **`GET /suite/admin/permissions`** — action `admin.permissions`
  - Effective permissions of one principal, with where each comes from.
  - permission: `admin:roles` · read · agent: `deny`
  - in: `{ principal?: Subject }`
  - out: `{ principal: PersonRef; ceiling: string[] \| null; delegator: PersonRef \| null; roles: string[]; permissions: EffectivePermission[] }`
- **`GET /suite/admin/matrix`** — action `admin.matrix`
  - Role x permission matrix and the agent ceiling.
  - permission: `admin:roles` · read · agent: `deny`
  - in: `{}`
  - out: `{ roles: string[]; permissions: string[]; cells: Record<string, Record<string, string[]>>; agent_ceiling: string[] }`


### 12.10 M14 Home, M15 Search, M16 Calendar, M17 Catalogue

`home.summary` serves the home page's summary widgets in one read (personal block null for agents). `search.global`
searches people (name, handle, title), groups, products, badges, content (published to the viewer; all for authors),
promotions, automations and segments (by permission), the viewer's orders (all for `store:orders`), tasks, the viewer's
threads (subject) and dashboards; each type ranks prefix matches over substring matches and returns at most `limit`.
`calendar.range` returns promotion windows, content `publish_at`/`unpublish_at`, cron fires of enabled automations
(at most 200), the viewer's expiry dates and task due dates. `catalog.get` returns the static builder catalogue,
including each triggerable event's payload fields and derived facts (11.4).

#### Endpoints: M14 Home


- **`GET /suite/home`** — action `home.summary`
  - Everything the home screen's widgets need in one read.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{}`
  - out: `{ me: {...} \| null; counts: NavCounts; promotions: ActivePromotion[]; feed: FeedItem[]; org: {...}; activity: ActivityItem[]; virtual_now: Timestamp }`


#### Endpoints: M15 Search


- **`GET /suite/search`** — action `search.global`
  - Grouped search over people, groups, products, badges, content, promotions, automations, segments, orders, tasks, threads, dashboards (each filtered by the viewer's rights).
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ q: string; types?: SearchType[]; limit?: Int }`
  - out: `{ q: string; groups: {...}[] }`


#### Endpoints: M16 Calendar


- **`GET /suite/calendar`** — action `calendar.range`
  - Promotion windows, content schedules, cron fires, own expiry dates and task due dates in a range.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{ from: Timestamp; to: Timestamp; types?: ("promotion" \| "content" \| "automation" \| "expiry" \| "task")[] }`
  - out: `{ items: CalendarEntry[]; virtual_now: Timestamp }`


#### Endpoints: M17 Builder catalogue


- **`GET /suite/catalog`** — action `catalog.get`
  - Builder catalogue: member facts, event types and payload fields, step types, notification types, icons, sources.
  - permission: `suite:use` · read · agent: `direct`
  - in: `{}`
  - out: `{ member_facts: FactDef[]; events: {...}[]; step_types: {...}[]; notification_types: {...}[]; icons: IconName[]; sources: {...}[] }`


### 12.11 Page editing

The `pages.editor` widget (package D) edits a Page through `POST /changes`: add an item (create a Widget node with
the catalogue default config, then patch the Page layout in the same change set), move and resize (layout patch),
configure (patch the Widget's `/spec/config`, form generated from the config JSON Schema), remove (layout patch; the
Widget node is deleted when no other page references it). On a system page the editor first offers
`pages.personalize` (members) or edits in place (admins, `node:write` on `Page/`).

## 13. Reporting

### 13.1 Decision: curated Postgres views as metadata Sources

Ledger, orders, messages and the other Suite tables are queryable as Sources through **curated Postgres views**
exposed as `metadata` Sources, read by the same path as `audit.changes`: the engine selects the view's rows with
`workspace_id = <ws>` and `<time column> <= as_of`, writes them as NDJSON with every timestamp formatted UTC
`YYYY-MM-DD HH24:MI:SS.MS`, loads them as the DuckDB relation `plinth_meta`, and the query compiler applies grants, row
predicates and masks exactly as for landed sources. DuckDB's `postgres` extension is **not** used: it would add a
second extension download, put database credentials in the query engine and open a path around the compiler.
Consequences: every view has a `region` column, so regional predicates (`region = 'EMEA'`) compile on every source;
private text (message and review bodies, emails) is never in a view; the 200 000-row ceiling of the metadata path
applies (the seed is far below it).

`SUITE_SOURCES` (`packages/spec/src/suite/sources.ts`, also `generated/suite.sources.json`) holds the 12 Source bodies
and their views; the seed commits them as Source nodes (label `plinth.suite: "true"`); `SUITE_SOURCE_VIEWS` maps slug
to view for the engine (K9). Grants: managers, marketing and finance read `Source/` (role grants); members cannot
query.

| Source | View | Time column | Columns |
|---|---|---|---|
| `suite.ledger` | `rpt_ledger` | `occurred_at` | `entry_id` int, `txn_id` string, `txn_no` int, `occurred_at` timestamp, `txn_type` enum(txn_type), `account` string, `account_kind` enum(account_kind), `member`? string, `region`? enum(region), `tier`? enum(tier), `department`? enum(department), `amount` int, `credit` int, `debit` int, `balance_after` int, `ref_kind`? string, `ref_id`? string, `promotion`? string, `actor` string, `surface` enum(surface) |
| `suite.store_orders` | `rpt_store_orders` | `placed_at` | `order_id` string, `order_no` string, `placed_at` timestamp, `member` string, `region` enum(region), `tier` enum(tier), `department` enum(department), `status` enum(order_status), `requires_approval` bool, `item_count` int, `subtotal_points` int, `discount_points` int, `total_points` int, `bonus_points` int, `cash_cents` int, `promotions`? string, `approved_at`? timestamp, `delivered_at`? timestamp, `cancelled_at`? timestamp, `refunded_at`? timestamp, `fulfil_ms`? int |
| `suite.order_items` | `rpt_order_items` | `placed_at` | `order_id` string, `line` int, `placed_at` timestamp, `member` string, `region` enum(region), `tier` enum(tier), `status` enum(order_status), `product` string, `product_title` string, `category` string, `qty` int, `unit_points` int, `discount_points` int, `line_points` int, `free_item` bool |
| `suite.messages` | `rpt_messages` | `sent_at` | `message_id` string, `thread_id` string, `sent_at` timestamp, `sender` string, `region`? enum(region), `department`? enum(department), `thread_kind` enum(thread_kind), `is_reply` bool, `recipient_count` int, `mention_count` int, `attachment_count` int, `attachment_bytes` int, `via_automation` bool, `read_count` int |
| `suite.notifications` | `rpt_notifications` | `created_at` | `notification_id` string, `created_at` timestamp, `recipient` string, `region`? enum(region), `type` enum(notification_type), `read` bool, `read_ms`? int, `emailed` bool, `in_digest` bool |
| `suite.badge_awards` | `rpt_badge_awards` | `awarded_at` | `award_id` string, `awarded_at` timestamp, `badge` string, `badge_title` string, `rarity` enum(rarity), `member` string, `region` enum(region), `tier` enum(tier), `awarded_by` string, `manual` bool, `points_reward` int, `revoked` bool |
| `suite.promotion_redemptions` | `rpt_promotion_redemptions` | `occurred_at` | `redemption_id` string, `occurred_at` timestamp, `promotion` string, `promotion_revision` int, `member` string, `region` enum(region), `tier` enum(tier), `context` enum(promo_context), `effect_type` enum(effect_type), `cost_points` int, `benefit_points` int, `ref_kind` string, `ref_id` string, `reversed` bool |
| `suite.automation_runs` | `rpt_automation_runs` | `created_at` | `run_id` string, `created_at` timestamp, `automation` string, `automation_revision` int, `trigger_type` enum(trigger_type), `status` enum(run_status), `member`? string, `region`? enum(region), `steps_total` int, `steps_failed` int, `attempts` int, `duration_ms`? int, `error_code`? string |
| `suite.content_engagement` | `rpt_content_engagement` | `first_viewed_at` | `content` string, `title` string, `content_type` enum(content_type), `published_at`? timestamp, `member` string, `region` enum(region), `tier` enum(tier), `first_viewed_at` timestamp, `last_viewed_at` timestamp, `views` int, `reaction`? enum(reaction) |
| `suite.members` | `rpt_members` | `joined_at` | `member` string, `display_name` string, `joined_at` timestamp, `region` enum(region), `tier` enum(tier), `department` enum(department), `status` enum(member_status), `balance` int, `lifetime_points` int, `badges_count` int, `orders_count` int, `last_active_at`? timestamp |
| `suite.tasks` | `rpt_tasks` | `created_at` | `task_id` string, `task_no` int, `created_at` timestamp, `status` enum(task_status), `priority` enum(task_priority), `source` enum(task_source), `assignee`? string, `region`? enum(region), `created_by` string, `due_at`? timestamp, `completed_at`? timestamp, `overdue` bool, `cycle_ms`? int |
| `suite.events` | `rpt_events` | `occurred_at` | `seq` int, `occurred_at` timestamp, `type` enum(event_type), `actor` string, `on_behalf_of`? string, `surface` enum(surface), `subject_kind`? string, `subject_id`? string, `member`? string, `region`? enum(region), `caused_by_automation`? string |

### 13.2 View definitions

Each view selects exactly the listed columns plus `workspace_id`, in that order, with these derivations (the backend
writes them in `0003_suite.sql` after the tables):

- `rpt_ledger`: `ledger_entries` join `ledger_transactions`, `ledger_accounts`, `members` (by account member); `credit
  = greatest(amount, 0)`, `debit = greatest(-amount, 0)`; `tier = tier_after`; `promotion` = `ref_id` when
  `ref_kind = 'promotion'`, else the first applied promotion slug of the referenced order; `actor` subject; region and
  department null for system accounts.
- `rpt_store_orders`: `store_orders` join `members`; `promotions` = comma-joined slugs from the `promotions` jsonb;
  `approved_at`, `delivered_at`, `cancelled_at`, `refunded_at` from `store_order_events`; `fulfil_ms` =
  milliseconds from `placed_at` to `delivered_at`.
- `rpt_order_items`: `store_order_items` join `store_orders`.
- `rpt_messages`: `messages` join `message_threads`; `sender` subject; sender's member region and department;
  `recipient_count` = participants minus 1; counts from `message_attachments` and `message_receipts`;
  `via_automation = via_automation IS NOT NULL`; never the body.
- `rpt_notifications`: `notifications` join `members`; `read_ms`; `emailed` = an email delivery with status `sent`
  lists the id; `in_digest` likewise for digests.
- `rpt_badge_awards`: `badge_awards` join Badge nodes (title, rarity from `body`), `members`, `ledger_accounts` (tier);
  `manual = awarded_by <> service:badges`.
- `rpt_promotion_redemptions`: `promotion_redemptions` join `members`, `ledger_accounts`.
- `rpt_automation_runs`: `automation_runs` with step counts, `duration_ms` from started to finished,
  `error_code = error->>'code'`, trigger type from `trigger->>'type'`.
- `rpt_content_engagement`: `content_engagement` join Content nodes (title, type) and `members`; `published_at` from
  the change that set `published_revision`.
- `rpt_members`: `members` join `principals`, `ledger_accounts`, live badge and order counts.
- `rpt_tasks`: `tasks` join assignee `members`.
- `rpt_events`: `domain_events` with `member` handle and region of `member_id`, `caused_by_automation =
  cause->>'automation'`.

### 13.3 Suite reporting boards

The seed adds three Dashboards with kernel Panels over these sources (rendered in the reporting domain by
`reporting.board`, and placed individually on Suite pages via `reporting.panel`): `programme-overview` (points issued
vs redeemed per day, area, Panel `suite-points-flow`; active members, kpi; tier distribution, bar; badges awarded per week, bar),
`store-performance` (revenue in points per day, line; top products, table; orders by status, bar; fulfilment p95 by
region, bar), `engagement` (promotion cost and redemptions per promotion, bar; automation runs by status, heatmap of
automation x day; message volume per day by thread kind, area; content views by item, table). Jonas sees EMEA rows on
every Suite source through his scoped manager role.

## 14. MCP

### 14.1 Tools: 15 kernel verbs plus 2

The surface stays generic. Configuration is written with the existing verbs on the 13 Suite kinds (`node.preview`,
`node.commit`, `node.delete`, `node.undo`, `diff`, `change.history`, `change.status`, `schema.describe`,
`node.search`, `node.get`); reporting with `query.run`, `query.explain`, `source.list`; access with `grant.check`;
presenting with `ui.present` (which now also accepts a Page). Domain actions, reads and writes alike, go through two
new tools, so adding a domain action never adds a tool:

| Tool | Input schema | Behaviour |
|---|---|---|
| `action.list` | `ActionListInput` (`mcp.ts`) | The registry entries the agent may call (`agent != "deny"`), with summaries, permissions, agent policy, refusals, events; with `name` or `include_schemas`, the input and output JSON Schemas. |
| `action.invoke` | `ActionInvokeInput` | `direct` actions run at once. `preview` and `approval` actions need `{ action, input, dry_run: true }` first, which returns an `ActionPreview` (Plinth-authored `effect`, typed `facts`, `decision`, `preview_token`); then `{ action, preview_token, idempotency_key }` commits exactly the previewed input or files it for approval (`pending_approval` with `approval_id`). `deny` actions return `FORBIDDEN`. |

Every response uses the kernel envelope (P5). `change.status` accepts an `action_approvals` id as `approval_id`.
`schema.describe` lists 28 kinds (tests asserting 15 kinds and 15 tools change to 28 and 17).

### 14.2 Coverage

Every action a person can take is reachable by the agent within its ceiling: node-backed configuration (promotions,
automations, content, segments, groups, products, categories, badges, pages, widgets) through node verbs, held where
the commit rules say; everything else through `action.invoke` with the registry's policy. Not available to the agent
by design: approval decisions, finance corrections, refunds without approval, admin actions, private profile edits
and preferences of a human, engagement on content (views and reactions belong to people).

### 14.3 Untrusted text

`action.invoke` results are wrapped like the kernel read tools: every string value whose schema is a plain string
(no pattern, no literal set, not a timestamp, id, slug, handle, subject, URI or route) is returned as
`{ "untrusted": "<string>" }`, at any depth. That covers message subjects and bodies, previews, names, titles,
memos, reasons, notes, review and content text, and Plinth-authored summaries that embed names. `ActionPreview.effect`
is Plinth-authored from typed facts and stays unwrapped, but never interpolates data strings (it names people by
handle). The `contains_untrusted` echo flag of the kernel applies to node changes and to action inputs (stored in
`action_approvals.input` and ledger memos).

## 15. Kernel changes and dependency order

| Id | Change | Where |
|---|---|---|
| K1 | 13 Suite kinds appended to `NODE_KINDS` (done in spec); `nodes_kind_check` migration; `validate.ts` decodes Suite kinds with `suiteBodySchemaFor` and runs 2.3; `schema.describe` serves `SUITE_EXAMPLES`, `SUITE_KIND_PURPOSE` and the widget catalogue; the MCP `AVAILABLE` list | engine, mcp |
| K2 | `role:` grant principals with scope predicates, `owner_only` grants, Role nodes in the Authorizer snapshot, `grant_index_version` bump on Role changes (3.5) | engine `authz-core.ts`, `authz.ts` |
| K3 | Suite permissions in the vocabulary (done in spec `grant.ts`) | spec |
| K4 | `checkApprover` with `APPROVER_PERMISSION`; `change_approvals.approver_permission` | engine |
| K5 | `SUITE_COMMIT_RULES` in `classify`, including `all` rows for humans | engine `rules.ts` |
| K6 | Managed fields: commit input `managed: { by }`, refused otherwise | engine `change-log.ts`, `validate.ts` |
| K7 | rt: domain stream, `counts` frame, `domain_head_seq`, `plinth_domain` LISTEN, session-bound sockets (done in spec `rt.ts`) | rt |
| K8 | Dev open tokens `dev-user-<handle>`, `X-Plinth-Session`, `member_sessions` | engine `identity.ts`, api |
| K9 | Metadata sources from `SUITE_SOURCE_VIEWS`; `evalRowPredicate` for member-targeted actions | engine `query-engine.ts`, query |
| K10 | MCP tools `action.list`, `action.invoke`; `change.status` for action approvals; `place` accepts a Page; untrusted wrapping of action results | mcp |
| K11 | HTTP: every registry route, `GET/POST /suite/actions`, kernel `GET /diff` | api |
| K12 | Reset truncates Suite tables and runs the Suite seed | engine `seed.ts`, gen |
| K13 | Worker process: automation engine, badge engine, scheduler (minute tick: promotion and content schedules, cron and metric automations; daily expiry and warnings; hourly digests and email-stub sending; approval expiry) | worker |
| K14 | Suite records use `PlinthClock.virtualNow` | all |

Dependency order (what unblocks what): spec contract (done) → K1, K3 → K2, K4, K5, K6 (authorization and rules) →
migration `0003_suite.sql` and the domain-event append + ledger posting function → action registry dispatch with
idempotency and agent policy (K11, K8) → module handlers (points and store first, since checkout, awards and badge
rewards all post to the ledger; then messages and notifications, which many writes call; then the rest) → K7 rt
stream → K13 worker engines → K9 reporting views → K12 seed (needs every handler) → K10 MCP tools. Frontend builders
need only the spec contract, the design-system/runtime package and a running API; until handlers land they can work
against the generated schemas.

## 16. Acceptance criteria

Each is a test or check the backend stack or the frontend runs; ids are referenced in Workgraph tasks.

1. `AC-SUITE-SCHEMA`: `pnpm schema:gen` leaves `packages/spec/generated` and `packages/web/src/core/widget-schemas.js`
   unchanged; `SUITE_EXAMPLES` decode against their schemas; every widget's catalogue example config decodes.
2. `AC-SUITE-KINDS`: committing each `SUITE_EXAMPLES` body through `POST /changes` succeeds for a principal with the
   role grants; a body with an unknown field is `VALIDATION_FAILED` with the field's pointer.
3. `AC-LEDGER-BALANCED`: inserting an unbalanced transaction fails at commit (L1); a debit past zero fails with
   `INSUFFICIENT_POINTS` and leaves no rows (L2).
4. `AC-LEDGER-TRIAL`: after the seed and after a randomized sequence of 500 postings, `ledger.trial_balance` is `ok`
   (L3, L4, L5, L9).
5. `AC-LEDGER-IDEMPOTENT`: replaying a transfer with the same key returns the same `txn_id` with `replayed: true`; a
   different amount with the key is `IDEMPOTENCY_KEY_REUSED` (L7).
6. `AC-CHECKOUT-ATOMIC`: two concurrent checkouts for the last unit: exactly one order, stock 0, one purchase posting;
   the loser gets `OUT_OF_STOCK` or `INSUFFICIENT_POINTS`, and nothing of its transaction persists.
7. `AC-CHECKOUT-QUOTE`: changing a promotion between quote and place yields `PRICE_CHANGED` with the fresh quote.
8. `AC-ORDER-LIFECYCLE`: every row of the 7.6 table, and every other transition is `INVALID_TRANSITION`; cancel refunds
   exactly and restores lots.
9. `AC-PROMO-EVAL`: table-driven tests of 8.3 steps 1 to 6 (each rejection reason, exclusive vs stack, stack groups,
   max discount cap, budget drop and recompute); determinism property test.
10. `AC-PROMO-ACTIVATE`: a marketing manager's activation is held; Priya approves; Tomás cannot approve his own; the
    agent's activation for Maya cannot be approved by Maya.
11. `AC-AUTOMATION-ONCE`: replaying the same event to the engine creates one run; killing the worker mid-run and
    restarting does not duplicate the award or the message (step keys).
12. `AC-AUTOMATION-LOOP`: an automation triggered by its own events stops at depth 3 with a `LOOP_SUSPECTED` record.
13. `AC-CONTENT-FLOW`: every row of the 10.3 table; body edits outside draft refused; the feed serves
    `published_revision` while the page is revised.
14. `AC-AUTHZ-ROLES`: Jonas (manager, scope EMEA) can award an EMEA member and gets `FORBIDDEN` (`row_predicate`) for
    an NA member; his `query.run` on `suite.ledger` returns EMEA rows only; a member can write only their own
    Preference and personal pages.
15. `AC-RT-DOMAIN`: a checkout produces `order.placed`, `points.posted`, `stock.changed` and `counts` frames on the
    buyer's socket within 1 s, and the buyer's private events never reach another member's socket.
16. `AC-SESSION-REVOKE`: revoking a session closes its socket (4401) and its next request is `SESSION_REVOKED`.
17. `AC-AUDIT-CHAINS`: `audit.verify` is ok after the seed; altering one `domain_events` payload in SQL (with the
    trigger disabled) makes it fail at that seq.
18. `AC-MCP-ACTIONS`: the agent transfers points: the dry run returns a preview, the commit files an
    `action_approvals` row; Maya cannot decide it (`sod_on_behalf_of`); Priya or Jonas (approval:decide on `suite/` and
    `points:transfer`) approves; the transfer posts with `approved_by` set and the requester as actor.
19. `AC-MCP-COMPOSE`: the agent creates a `points.balance` Widget placed on `page:home`; every open home shows it
    without reload; on `page:store` (system) the same placement is held.
20. `AC-WIDGET-RUNTIME`: every catalogue widget id resolves in the web widget manifest to a module exporting the
    runtime contract (UI-MAP 4.1); `node scripts/check.mjs` passes.
21. `AC-SEED`: two resets produce identical domain payloads, ledger and node bodies; the counts of 11 hold.
22. `AC-UNTRUSTED`: every string field of every `action.invoke` result built over random data that is data-origin is
    wrapped.

## Appendix A. Shape reference

Every named type used by the endpoints, events and runtime shapes, generated from the Effect schemas (depth 1; nested
named types are listed under their own name). The TypeScript in `packages/spec/src/suite` is authoritative.

- `AccountView` = `{ account: AccountCode; kind: "member" \| "system"; member: PersonRef \| null; balance: Int; lifetime_earned: Points; entries: Int; last_entry_at: Timestamp \| null }`
- `ActionInvokeIn` = `{ input?: Record<string, unknown>; dry_run?: boolean; preview_token?: string; idempotency_key?: IdempotencyKey; reason?: string }`
- `ActionInvokeOut` = `{ kind: "result"; action: string; data: unknown; replayed: boolean } \| { kind: "preview"; preview: ActionPreview } \| { kind: "pending_approval"; action: string; approval_id: UUID; approver_permission: string }`
- `ActionPreview` = `{ action: string; decision: "auto" \| "approval"; effect: string; facts: Record<string, unknown>; input_hash: string; preview_token: string; expires_in_s: Int }`
- `ActivePromotion` = `{ slug: string; title: string; description: string; headline: string \| null; tone: Tone \| null; icon: IconName \| null; ends_at: Timestamp; effect_summary: string; channels: string[] }`
- `ActivityIn` = `{ cursor?: Cursor; limit?: Limit; types?: DomainEventType[] }`
- `ActivityItem` = `{ seq: Int; type: DomainEventType; occurred_at: Timestamp; actor: PersonRef; summary: string; icon: string; link: string \| null }`
- `AdjustIn` = `{ member: Handle; points: SignedPoints; reason: string; idempotency_key: IdempotencyKey }`
- `AdminMemberRow` = `{ person: PersonRef; email: string; title: string; department: string; region: Region; roles: {...}[]; status: "active" \| "disabled"; last_active_at: Timestamp \| null; sessions_active: Int; joined_at: Timestamp }`
- `Agg` = `AggObject \| string`
- `AggObject` = `{ fn: "count" \| "count_distinct" \| "sum" \| "avg" \| "min" \| "max" \| "percentile"; of?: string; p?: number }`
- `AnalyticsOut` = `{ slug: string; status: PromotionStatus; usage: PromotionUsageView; benefit_points: Points; series: {...}[]; by_tier: Record<string, {...}>; by_region: Record<string, {...}>; uplift: {...} \| null }`
- `AppliedEffect` = `{ type: "points_multiplier" \| "bonus_points" \| "store_discount" \| "free_item"; benefit_points: Points; cost_points: Points; lines?: {...}[] }`
- `AppliedPromotion` = `{ slug: string; revision: Int; title: string; effects: AppliedEffect[]; cost_points: Points }`
- `ApprovalItem` = `{ type: ApprovalType; id: string; title: string; summary: string; status: "pending_approval" \| "approved" \| "rejected" \| "withdrawn" \| "expired" \| "stale" \| "failed"; requested_by: PersonRef; on_behalf_of: PersonRef \| null; requested_at: Timestamp; expires_at: Timestamp \| null; rule_id: string[]; approver_permission: string; can_decide: boolean; blocked_reason: string \| null; decided_by: PersonRef \| null; decided_at: Timestamp \| null; decision_reason: string \| null; link: string; detail: Record<string, unknown> }`
- `ApprovalType` = `"change" \| "action" \| "order" \| "content_review"`
- `ApprovalsIn` = `{ scope?: "to_decide" \| "requested" \| "all"; types?: ApprovalType[]; status?: "pending_approval" \| "decided" \| "all"; cursor?: Cursor; limit?: Limit }`
- `Artwork` = `{ icon: IconName; hue: Int; pattern: "solid" \| "stripes" \| "dots" \| "rings" \| "grid" \| "waves"; glyph?: string }`
- `AttachmentMeta` = `{ file_name: string; media_type: string; size_bytes: Int; sha256: string }`
- `AuditEntry` = `{ source: "change" \| "event"; seq: Int; at: Timestamp; actor: PersonRef; on_behalf_of: PersonRef \| null; approved_by: PersonRef \| null; surface: string; what: string; summary: string; rule_id: string[]; link: string \| null; undoable: boolean; hash: string }`
- `AuditEventsIn` = `{ types?: DomainEventType[]; actor?: Subject; member?: Handle; subject_kind?: string; subject_id?: string; from?: Timestamp; to?: Timestamp; cursor?: Cursor; limit?: Limit }`
- `AuditTimelineIn` = `{ sources?: ("change" \| "event")[]; actor?: Subject; q?: string; from?: Timestamp; to?: Timestamp; region?: Region; cursor?: Cursor; limit?: Limit }`
- `AutomationSpec` = `{ enabled: boolean; description: string; trigger: AutomationTrigger; conditions?: CondTree; steps: AutomationStep[]; limits: {...}; owner: Subject }`
- `AutomationStep` = `{ id: string; when?: CondTree; on_error: "stop" \| "continue"; type: "award_points"; to: "$member" \| "$actor" \| Subject; points: PositivePoints; memo: string } \| { id: string; when?: CondTree; on_error: "stop" \| "continue"; type: "notify"; to: AutomationTarget[]; notification_type: NotificationType; title: string; body: string; link?: string } \| { id: string; when?: CondTree; on_error: "stop" \| "continue"; type: "send_message"; to: AutomationTarget[]; subject: string; body: string } \| { id: string; when?: CondTree; on_error: "stop" \| "continue"; type: "apply_promotion"; promotion: promotion:<slug>; to: "$member" \| "$actor"; expires_in_days: Int } \| { id: string; when?: CondTree; on_error: "stop" \| "continue"; type: "create_task"; title: string; description?: string; assignee: Subject \| "$owner" \| "$member"; priority: "low" \| "normal" \| "high" \| "urgent"; due_in_days?: Int } \| { id: string; when?: CondTree; on_error: "stop" \| "continue"; type: "webhook"; target_label: string; payload: Record<string, string> }`
- `AutomationSummary` = `{ node: NodeLink; enabled: boolean; description: string; trigger_summary: string; trigger_type: "event" \| "schedule" \| "metric"; step_count: Int; owner: string; last_run: RunSummary \| null; runs_7d: Int; failures_7d: Int; next_fire_at: Timestamp \| null; pending_approval_id: string \| null }`
- `AutomationTarget` = `Recipient \| "$member" \| "$actor" \| "$owner"`
- `AutomationTrigger` = `{ type: "event"; event: TriggerableEventType; filter?: CondTree } \| { type: "schedule"; cron: Cron } \| { type: "metric"; query: QueryAst; value_column: Field; op: "gt" \| "gte" \| "lt" \| "lte"; threshold: number; for_minutes: Int; every_minutes: Int }`
- `Avatar` = `{ initials: string; hue: Int }`
- `AwardIn` = `{ to: Handle[]; points: PositivePoints; category: "recognition" \| "performance" \| "milestone" \| "service" \| "other"; reason: string; idempotency_key: IdempotencyKey }`
- `AwardOut` = `{ status: "committed" \| "pending_approval"; approval_id: UUID \| null; results: {...}[]; replayed: boolean }`
- `AwardView` = `{ award_id: UUID; badge: string; badge_title: string; artwork: BadgeArtwork; member: PersonRef; awarded_at: Timestamp; awarded_by: PersonRef; reason: string; points_txn_id: UUID \| null; revoked_at: Timestamp \| null }`
- `BadgeArtwork` = `{ shape: "circle" \| "shield" \| "hexagon" \| "star" \| "ribbon"; icon: IconName; hue: Int; ring?: Tier }`
- `BadgeAwardIn` = `{ slug: string; member: Handle; reason: string; idempotency_key: IdempotencyKey }`
- `BadgeCard` = `{ slug: string; title: string; description: string; artwork: BadgeArtwork; rarity: "common" \| "uncommon" \| "rare" \| "epic" \| "legendary"; points_reward: Points; criteria_type: "points_threshold" \| "action_count" \| "streak" \| "event" \| "manual" \| "hidden"; holders: Int; awarded_at: Timestamp \| null; award_id: UUID \| null; progress: BadgeProgress \| null; showcased: boolean }`
- `BadgeCriteria` = `{ type: "points_threshold"; lifetime_points: PositivePoints } \| { type: "action_count"; event: TriggerableEventType; count: Int; window_days?: Int; filter?: CondTree } \| { type: "streak"; event: TriggerableEventType; days: Int; filter?: CondTree } \| { type: "event"; event: TriggerableEventType; filter?: CondTree } \| { type: "manual" }`
- `BadgeDetailOut` = `{ card: BadgeCard; criteria: BadgeCriteria \| null; revision: Int; recent_awards: AwardView[]; holders_by_region: Record<string, Int> }`
- `BadgeProgress` = `{ current: Int; target: Int; ratio: number \| null; label: string }`
- `BadgesCatalogOut` = `{ member: PersonRef; items: BadgeCard[]; earned: Int; total: Int; next_up: BadgeCard[] }`
- `BlockDiff` = `{ index: Int; change: "added" \| "removed" \| "modified" \| "moved" \| "unchanged"; before: ContentBlock \| null; after: ContentBlock \| null; from_index: Int \| null }`
- `BulkStateIn` = `{ thread_ids: UUID[]; read?: boolean; starred?: boolean; archived?: boolean; muted?: boolean }`
- `CalendarEntry` = `{ id: string; type: "promotion" \| "content" \| "automation" \| "expiry" \| "task"; title: string; starts_at: Timestamp; ends_at: Timestamp \| null; status: string; tone: Tone; icon: IconName; href: string }`
- `CalendarIn` = `{ from: Timestamp; to: Timestamp; types?: ("promotion" \| "content" \| "automation" \| "expiry" \| "task")[] }`
- `CartLine` = `{ product: ProductCard; qty: Int; line_points: Points; issue: "out_of_stock" \| "insufficient_stock" \| "retired" \| "tier" \| "limit" \| null }`
- `CartOut` = `{ lines: CartLine[]; item_count: Int; subtotal_points: Points; balance: Points; updated_at: Timestamp \| null }`
- `CartSetIn` = `{ slug: string; qty: Int }`
- `CatalogIn` = `{ category?: string; q?: string; tag?: string; min_points?: Points; max_points?: Points; in_stock?: boolean; affordable?: boolean; sort?: "featured" \| "price_asc" \| "price_desc" \| "rating" \| "newest"; cursor?: Cursor; limit?: Limit }`
- `CatalogOut` = `{ items: ProductCard[]; next_cursor: string \| null; total: Int; facets: {...} }`
- `CategoryView` = `{ slug: string; title: string; description: string; artwork: Artwork; product_count: Int; sort: Int }`
- `ChainVerify` = `{ ok: boolean; checked: Int; head_seq: Int; head_hash: string; error?: {...} }`
- `ChannelPrefs` = `{ in_app: boolean; email: boolean; digest: boolean }`
- `CheckoutIn` = `{ quote_hash: string; delivery: Delivery; notes?: string; idempotency_key: IdempotencyKey }`
- `CondOp` = `"eq" \| "ne" \| "lt" \| "lte" \| "gt" \| "gte" \| "in" \| "not_in" \| "contains" \| "not_contains" \| "exists" \| "not_exists" \| "between"`
- `CondTree` = `Condition \| { all: CondTree[] } \| { any: CondTree[] } \| { not: CondTree }`
- `Condition` = `{ field: FactPath; op: CondOp; value?: string \| number \| boolean \| null \| (string \| number \| boolean \| null)[] }`
- `ContentAction` = `"submit" \| "approve" \| "request_changes" \| "publish" \| "schedule" \| "unschedule" \| "revise" \| "archive" \| "restore"`
- `ContentBlock` = `{ type: "heading"; level: 2 \| 3; text: string } \| { type: "paragraph"; text: string } \| { type: "list"; ordered: boolean; items: string[] } \| { type: "quote"; text: string; cite?: string } \| { type: "callout"; tone: Tone; icon: IconName; text: string } \| { type: "image"; artwork: Artwork; alt: string; caption?: string } \| { type: "divider" } \| { type: "cta"; label: string; href: string } \| ...`
- `ContentDiffOut` = `{ from: Int; to: Int; changed_paths: string[]; human_summary: string; fields: {...}[]; blocks: BlockDiff[] }`
- `ContentSpec` = `{ type: "page" \| "article" \| "announcement"; status: ContentStatus; summary: string; hero: Artwork; blocks: ContentBlock[]; tags: string[]; audience: {...}; author: Subject; reviewers: Subject[]; schedule: {...}; pinned: boolean; allow_reactions: boolean; reactions_enabled?: Reaction[]; published_revision: Int \| null; review_log: {...}[] }`
- `ContentStatus` = `"draft" \| "in_review" \| "approved" \| "published" \| "archived"`
- `ContentSummary` = `{ node: NodeLink; type: "page" \| "article" \| "announcement"; status: ContentStatus; display_status: "draft" \| "in_review" \| "approved" \| "scheduled" \| "published" \| "revising" \| "archived"; summary: string; hero: Artwork; tags: string[]; author: PersonRef; reviewers: PersonRef[]; updated_at: Timestamp; publish_at: Timestamp \| null; published_revision: Int \| null; views: Int; reactions: Int }`
- `ContentTransitionIn` = `{ slug: string; action: ContentAction; note?: string; publish_at?: Timestamp; base_revision: Int }`
- `DecideIn` = `{ type: ApprovalType; id: string; decision: "approve" \| "reject"; reason?: string }`
- `Delivery` = `{ method: FulfilmentMethod; address?: {...}; pickup_site?: string }`
- `DeliveryView` = `{ delivery_id: UUID; channel: "email" \| "digest"; status: "queued" \| "sent" \| "suppressed"; subject: string; body: string; notification_ids: UUID[]; created_at: Timestamp; sent_at: Timestamp \| null; suppressed_reason: "preference_off" \| "quiet_hours" \| "member_disabled" \| null }`
- `Department` = `"operations" \| "fulfilment" \| "finance" \| "marketing" \| "technology" \| "people"`
- `DevPrincipal` = `{ handle: Handle \| null; subject: Subject; display_name: string; avatar: Avatar; roles: string[]; region: Region \| null; token: string; featured: boolean }`
- `DigestPrefs` = `{ frequency: "off" \| "daily" \| "weekly"; hour_utc: Int; weekday?: Int }`
- `DirectoryIn` = `{ q?: string; region?: Region; tier?: Tier; department?: string; group?: string; role?: string; sort?: "name" \| "tier" \| "recent" \| "points"; cursor?: Cursor; limit?: Limit }`
- `DomainEvent` = `DomainEvent.message.received \| DomainEvent.message.sent \| DomainEvent.message.state_changed \| DomainEvent.notification.created \| DomainEvent.notification.read \| DomainEvent.points.posted \| DomainEvent.points.expiring \| DomainEvent.tier.changed \| ...`
- `DomainEventType` = `"message.received" \| "message.sent" \| "message.state_changed" \| "notification.created" \| "notification.read" \| "points.posted" \| "points.expiring" \| "tier.changed" \| ...`
- `DryRunIn` = `{ automation: automation:<slug> \| {...}; event?: SampleEvent; event_seq?: Int; at?: Timestamp }`
- `DryRunResult` = `{ trigger_matched: boolean; conditions_passed: boolean; limits_ok: boolean; context: Record<string, unknown>; steps: DryRunStep[]; next_fires: Timestamp[] }`
- `DryRunStep` = `{ index: Int; id: string; type: string; would_run: boolean; skipped_reason: "when_false" \| "after_stop" \| "forbidden" \| "invalid" \| null; input: unknown; effect: string; error: StepError \| null }`
- `EffectivePermission` = `{ permission: string; resource: string; row_predicate: string \| null; owner_only: boolean; via: {...}; grant: NodeLink }`
- `Empty` = `{}`
- `EntryView` = `{ account: AccountCode; member: PersonRef \| null; amount: SignedPoints; balance_after: Int }`
- `EventCause` = `{ automation: string; run_id: UUID; step_index: Int; depth: Int }`
- `EventSubject` = `{ kind: "member" \| "thread" \| "notification" \| "txn" \| "order" \| "product" \| "review" \| "badge_award" \| ...; id: string }`
- `ExpiryBucket` = `{ expires_on: DateOnly; points: Points; lots: Int }`
- `ExpiryOut` = `{ member: PersonRef; buckets: ExpiryBucket[]; next_warning: {...} \| null }`
- `ExprValue` = `{ expr: string }`
- `FactDef` = `{ path: FactPath; label: string; type: "string" \| "int" \| "float" \| "bool" \| "timestamp" \| "enum" \| "string[]"; values?: string[]; ops: CondOp[]; description?: string }`
- `FeedItem` = `{ slug: string; title: string; type: "page" \| "article" \| "announcement"; summary: string; hero: Artwork; tags: string[]; author: PersonRef; published_at: Timestamp; pinned: boolean; views: Int; reactions: {...}; my_reaction: Reaction \| null; seen: boolean }`
- `Folder` = `"inbox" \| "sent" \| "starred" \| "archived"`
- `FulfilmentMethod` = `"ship" \| "pickup" \| "digital" \| "donation"`
- `GroupSpec` = `{ description: string; type: "team" \| "region" \| "interest" \| "distribution"; members: Subject[]; managers: Subject[]; open_posting: boolean; artwork: Artwork }`
- `GroupSummary` = `{ node: NodeLink; type: "team" \| "region" \| "interest" \| "distribution"; description: string; member_count: Int; artwork: Artwork; is_member: boolean; is_manager: boolean }`
- `HeldResult` = `{ status: "committed" \| "pending_approval"; approval_id?: string; change_seq?: Int; revision?: Int; rule_id: string[] }`
- `HomeOut` = `{ me: {...} \| null; counts: NavCounts; promotions: ActivePromotion[]; feed: FeedItem[]; org: {...}; activity: ActivityItem[]; virtual_now: Timestamp }`
- `IconName` = `"home" \| "inbox" \| "send" \| "archive" \| "star" \| "bell" \| "search" \| "command" \| ...`
- `InventoryAdjustIn` = `{ slug: string; delta: Int; reason: "restock" \| "damage" \| "count_correction" \| "return"; note?: string; idempotency_key: IdempotencyKey }`
- `InventoryRow` = `{ product: string; title: string; category: string; on_hand: Int; low_stock_threshold: Int; stock_status: StockStatus; sold_30d: Int; updated_at: Timestamp }`
- `MarkReadOut` = `{ marked: Int; unread_count: Int }`
- `MatrixOut` = `{ roles: string[]; permissions: string[]; cells: Record<string, Record<string, string[]>>; agent_ceiling: string[] }`
- `MeOut` = `{ principal: PersonRef; member: {...} \| null; on_behalf_of: PersonRef \| null; roles: {...}[]; permissions: string[]; balance: Points \| null; tier: TierProgress \| null; counts: NavCounts; preferences: PreferenceSpec \| null; program: {...}; virtual_now: Timestamp; clock: {...}; session_id: string \| null; rt: {...} }`
- `MemberCard` = `{ person: PersonRef; title: string; department: string; region: Region; tier: Tier; badges_count: Int; last_active_at: Timestamp \| null; status: "active" \| "disabled" }`
- `MemberCore` = `{ handle: Handle; subject: Subject; display_name: string; avatar: Avatar; title: string; department: Department; region: Region; location: string; joined_at: Timestamp; status: "active" \| "disabled" }`
- `MemberCreateIn` = `{ handle: Handle; display_name: string; email: string; title: string; department: Department; region: Region; location: string }`
- `MemberFacts` = `{ handle: Handle; region: Region; tier: Tier; balance: Int; lifetime_points: Int; points_earned_30d: Int; points_redeemed_30d: Int; orders_90d: Int; badges_count: Int; badges: string[]; groups: string[]; roles: string[]; department: string; joined_days: Int; last_active_days: Int; status: "active" \| "disabled" }`
- `MessageView` = `{ message_id: UUID; thread_id: UUID; sender: PersonRef; on_behalf_of: PersonRef \| null; body: string; mentions: PersonRef[]; sent_at: Timestamp; reply_to: UUID \| null; attachments: {...}[]; read_by_me: boolean; read_by: {...}[] }`
- `MessagesListIn` = `{ folder?: Folder; q?: string; unread_only?: boolean; cursor?: Cursor; limit?: Limit }`
- `MessagesListOut` = `{ items: ThreadSummary[]; next_cursor: string \| null; folder_counts: {...} }`
- `NavCounts` = `{ notifications_unread: Int; messages_unread: Int; approvals_pending: Int; tasks_open: Int; cart_items: Int; content_reviews: Int; orders_attention: Int }`
- `NodeLink` = `{ uri: string; kind: string; slug: string; title: string; revision: Int }`
- `NotificationType` = `"mention" \| "message" \| "approval_request" \| "approval_decision" \| "points_awarded" \| "points_expiring" \| "badge_earned" \| "tier_changed" \| ...`
- `NotificationView` = `{ notification_id: UUID; type: NotificationType; title: string; body: string; link: string \| null; actor: PersonRef \| null; created_at: Timestamp; read_at: Timestamp \| null; subject: EventSubject \| null }`
- `NotificationsListIn` = `{ filter?: "all" \| "unread"; types?: NotificationType[]; cursor?: Cursor; limit?: Limit }`
- `NotificationsListOut` = `{ items: NotificationView[]; next_cursor: string \| null; unread_count: Int }`
- `NotifySendIn` = `{ to: Recipient[]; type: "system" \| "automation_alert" \| "promotion_started"; title: string; body: string; link?: string; idempotency_key: IdempotencyKey }`
- `OrderDetailOut` = `{ order_id: UUID; order_no: string; member: PersonRef; region: Region; status: OrderStatus; requires_approval: boolean; item_count: Int; total_points: Points; cash_cents: Cents; placed_at: Timestamp; updated_at: Timestamp; first_item: {...}; items: OrderItemView[]; subtotal_points: Points; discount_points: Points; bonus_points: Points; promotions: AppliedPromotion[]; delivery: Delivery; notes: string \| null; events: OrderEventView[]; ledger_txn_id: UUID \| null; refund_txn_id: UUID \| null; bonus_txn_id: UUID \| null; allowed_transitions: OrderTransition[]; cancel_deadline: Timestamp \| null; replayed?: boolean }`
- `OrderEventView` = `{ seq: Int; from: OrderStatus \| null; to: OrderStatus; actor: PersonRef; at: Timestamp; note: string \| null }`
- `OrderItemView` = `{ line: Int; product: string; title: string; artwork: Artwork; qty: Int; unit_points: Points; discount_points: Points; line_points: Points; cash_cents: Cents; free_item: boolean }`
- `OrderStatus` = `"placed" \| "approved" \| "fulfilled" \| "shipped" \| "delivered" \| "cancelled" \| "refunded"`
- `OrderSummary` = `{ order_id: UUID; order_no: string; member: PersonRef; region: Region; status: OrderStatus; requires_approval: boolean; item_count: Int; total_points: Points; cash_cents: Cents; placed_at: Timestamp; updated_at: Timestamp; first_item: {...} }`
- `OrderTransition` = `"approve" \| "fulfil" \| "ship" \| "deliver" \| "cancel" \| "refund"`
- `OrderTransitionIn` = `{ order_id: UUID; transition: OrderTransition; note?: string; restock?: boolean; idempotency_key: IdempotencyKey }`
- `OrdersListIn` = `{ scope?: "mine" \| "all"; status?: OrderStatus[]; member?: string; requires_approval?: boolean; q?: string; cursor?: Cursor; limit?: Limit }`
- `PageItem` = `{ item: string; at: {...}; size?: WidgetSize }`
- `PageNav` = `{ section: "personal" \| "engage" \| "rewards" \| "operate" \| "insight" \| "admin"; label: string; icon: IconName; order: Int; count?: "notifications_unread" \| "messages_unread" \| "approvals_pending" \| "tasks_open" \| "cart_items" \| "content_reviews" \| "orders_attention"; permission?: string }`
- `PageSpec` = `{ kind: "module" \| "home" \| "profile" \| "custom" \| "personal"; description: string; route?: string; owner?: Subject; based_on?: string; system: boolean; nav?: PageNav; layout: {...} }`
- `PagesListOut` = `{ items: {...}[] }`
- `PagesResolveIn` = `{ path?: string; page?: string }`
- `PagesResolveOut` = `{ page: NodeLink; spec: PageSpec; params: Record<string, string>; items: ResolvedItem[]; personal_of: NodeLink \| null; editable: boolean }`
- `PermissionsOut` = `{ principal: PersonRef; ceiling: string[] \| null; delegator: PersonRef \| null; roles: string[]; permissions: EffectivePermission[] }`
- `PersonRef` = `{ subject: Subject; handle: Handle \| null; display_name: string; kind: "human" \| "agent" \| "service"; avatar: Avatar }`
- `PersonalizeOut` = `{ page: NodeLink; widgets: NodeLink[]; change_seq: Int }`
- `PointsSummaryOut` = `{ member: PersonRef; account: AccountCode; balance: Points; tier: TierProgress; earned_30d: Points; redeemed_30d: Points; expiring_soon: ExpiryBucket[]; recent: StatementLine[]; transfer_remaining_today: Points }`
- `Predicate` = `{ field: Field; op: "eq" \| "ne" \| "lt" \| "lte" \| "gt" \| "gte" \| "in" \| "not_in" \| "is_null" \| "not_null"; value?: string \| number \| boolean \| null \| (string \| number \| boolean \| null)[] \| ExprValue }`
- `PreferenceSpec` = `{ owner: Subject; notifications: {...}; digest: DigestPrefs; quiet_hours?: {...}; muted_threads: UUID[]; ui: UiPrefs }`
- `PreferencesOut` = `{ preferences: PreferenceSpec; revision: Int \| null; defaults: {...} }`
- `PreferencesUpdateIn` = `{ notifications?: {...}; digest?: DigestPrefs; quiet_hours?: {...} \| null; muted_threads?: UUID[]; ui?: UiPrefs; base_revision?: Int \| null }`
- `PreferencesUpdateOut` = `{ preferences: PreferenceSpec; revision: Int; change_seq: Int }`
- `ProductCard` = `{ slug: string; title: string; category: string; summary: string; price_points: Points; cash_price_cents: Cents \| null; artwork: Artwork; tags: string[]; featured: boolean; min_tier: Tier \| null; stock_status: StockStatus; on_hand: Int; rating: {...} \| null; in_wishlist: boolean; in_cart_qty: Int; affordable: boolean; locked_reason: "tier" \| "out_of_stock" \| "limit" \| null; promo_percent: Int \| null }`
- `ProductDetailOut` = `{ card: ProductCard; spec: ProductSpec; revision: Int; category: {...}; rating_histogram: Int[]; reviews: ReviewView[]; can_review: boolean; member_purchased_qty: Int; related: ProductCard[]; promotions: {...}[] }`
- `ProductSpec` = `{ category: category:<slug>; summary: string; description: string; price_points: PositivePoints; cash_price_cents?: Cents; artwork: Artwork; attributes?: Record<string, string>; tags: string[]; status: "draft" \| "active" \| "retired"; featured: boolean; fulfilment: FulfilmentMethod; min_tier?: Tier; limit_per_member?: Int; low_stock_threshold: Int }`
- `ProfileOut` = `{ member: MemberCore; bio: string; tier: TierProgress; balance: Points \| null; showcase: BadgeCard[]; badges_count: Int; groups: NodeLink[]; roles: string[]; stats: {...}; private: {...} \| null; is_self: boolean }`
- `ProfileUpdateIn` = `{ display_name?: string; title?: string; bio?: string; location?: string; avatar_hue?: Int; showcase?: string[] }`
- `PromoCandidate` = `{ slug: string; revision: Int; spec: PromotionSpec; usage: PromoUsage; member_in_segments: Record<string, boolean>; member_in_groups: Record<string, boolean>; entitled: boolean; free_items: Record<string, {...}> }`
- `PromoChannel` = `"store" \| "recognition" \| "automation" \| "content"`
- `PromoContext` = `{ kind: "purchase"; channel: "store"; lines: PurchaseLine[] } \| { kind: "earn"; channel: PromoChannel; base_points: Points; earn_type: "award" \| "badge_reward" \| "automation" \| "content" }`
- `PromoEvalInput` = `{ now: Timestamp; mode: "live" \| "simulate"; member: MemberFacts; context: PromoContext; candidates: PromoCandidate[] }`
- `PromoEvaluation` = `{ applied: AppliedPromotion[]; rejected: {...}[]; advisories: {...}[]; totals: {...}; cost_points: Points; delta_points: SignedPoints }`
- `PromoRejection` = `"status" \| "window" \| "channel" \| "context" \| "tier" \| "region" \| "segment" \| "group" \| ...`
- `PromoUsage` = `{ cost_points: Points; redemptions: Int; member_redemptions: Int }`
- `PromotionEffect` = `{ type: "points_multiplier"; factor: number } \| { type: "bonus_points"; points: PositivePoints; on: "purchase" \| "earn" } \| { type: "store_discount"; percent: Int; categories?: category:<slug>[]; products?: product:<slug>[]; max_discount_points?: PositivePoints } \| { type: "free_item"; product: product:<slug>; min_cart_points: PositivePoints }`
- `PromotionEligibility` = `{ tiers?: Tier[]; regions?: Region[]; segments?: segment:<slug>[]; groups?: group:<slug>[]; channels?: PromoChannel[]; new_members_days?: Int; min_cart_points?: PositivePoints; categories?: category:<slug>[]; products?: product:<slug>[]; entitlement_only?: boolean; filter?: CondTree }`
- `PromotionSpec` = `{ status: PromotionStatus; description: string; banner?: {...}; eligibility: PromotionEligibility; effects: PromotionEffect[]; budget: {...}; schedule: {...}; priority: Int; stacking: "stack" \| "exclusive"; stack_group?: SuiteSlug; owner: Subject }`
- `PromotionStatus` = `"draft" \| "scheduled" \| "active" \| "paused" \| "ended"`
- `PromotionSummary` = `{ node: NodeLink; status: PromotionStatus; description: string; starts_at: Timestamp; ends_at: Timestamp; priority: Int; stacking: "stack" \| "exclusive"; effect_summary: string; eligibility_summary: string; owner: string; usage: PromotionUsageView; pending_approval_id: string \| null }`
- `PromotionTransitionIn` = `{ slug: string; to: "scheduled" \| "active" \| "paused" \| "ended" \| "draft"; reason?: string; base_revision: Int }`
- `PromotionUsageView` = `{ redemptions: Int; cost_points: Points; budget_used_pct: number \| null; members_reached: Int }`
- `PublishedOut` = `{ item: FeedItem; revision: Int; blocks: ContentBlock[] }`
- `PurchaseLine` = `{ product: string; category: string; qty: Int; unit_points: Points }`
- `QueryAst` = `{ from: string; where?: Predicate[]; derive?: Record<Field, string>; group?: Field[]; aggregate?: Record<Field, Agg>; select?: Field[]; order?: {...}[]; limit?: Int }`
- `QuoteLine` = `{ line: Int; product: string; title: string; qty: Int; unit_points: Points; discount_points: Points; line_points: Points; cash_cents: Cents; free_item: boolean }`
- `QuoteOut` = `{ lines: QuoteLine[]; subtotal_points: Points; discount_points: Points; total_points: Points; bonus_points: Points; cash_cents: Cents; balance: Points; balance_after: Int; requires_approval: boolean; evaluation: PromoEvaluation; quote_hash: string; blocking: {...}[] }`
- `Reaction` = `"like" \| "celebrate" \| "insightful"`
- `RecipientOption` = `{ recipient: Recipient; kind: "person" \| "group"; label: string; description: string; avatar: Avatar \| null; artwork: Artwork \| null; member_count: Int \| null; allowed: boolean }`
- `Region` = `"NA" \| "EMEA" \| "APAC" \| "LATAM" \| "ANZ"`
- `ReplyIn` = `{ thread_id: UUID; body: string; reply_to?: UUID; attachments?: AttachmentMeta[]; add_recipients?: Recipient[]; idempotency_key: IdempotencyKey }`
- `ResolvedItem` = `{ item: string; at: {...}; size: WidgetSize; node: NodeLink \| null; widget: string; config: Record<string, unknown>; title: string; available: boolean; unavailable_reason: "forbidden" \| "missing" \| "unknown_widget" \| null }`
- `ReverseIn` = `{ txn_id: UUID; reason: string; idempotency_key: IdempotencyKey }`
- `ReviewCreateIn` = `{ slug: string; rating: Int; title: string; body: string; idempotency_key: IdempotencyKey }`
- `ReviewView` = `{ review_id: UUID; product: string; member: PersonRef; rating: Int; title: string; body: string; created_at: Timestamp; status: "published" \| "hidden"; verified_order: boolean }`
- `RoleMember` = `{ subject: Subject; scope?: {...} }`
- `RoleMembersIn` = `{ slug: string; add?: RoleMember[]; remove?: Subject[]; base_revision: Int; reason: string }`
- `RoleView` = `{ node: NodeLink; description: string; system: boolean; members: {...}[]; grants: {...}[]; pending: {...}[] }`
- `RunDetail` = `{ run_id: UUID; automation: string; automation_title: string; automation_revision: Int; status: RunStatus; trigger: RunTrigger; member: PersonRef \| null; started_at: Timestamp \| null; finished_at: Timestamp \| null; steps_total: Int; steps_succeeded: Int; error: StepError \| null; context: Record<string, unknown>; steps: RunStep[]; cause_depth: Int }`
- `RunStatus` = `"queued" \| "running" \| "succeeded" \| "failed" \| "skipped" \| "cancelled"`
- `RunStep` = `{ index: Int; id: string; type: "award_points" \| "notify" \| "send_message" \| "apply_promotion" \| "create_task" \| "webhook"; status: StepStatus; attempts: Int; started_at: Timestamp \| null; finished_at: Timestamp \| null; input: unknown; output: Record<string, unknown> \| null; error: StepError \| null }`
- `RunSummary` = `{ run_id: UUID; automation: string; automation_title: string; automation_revision: Int; status: RunStatus; trigger: RunTrigger; member: PersonRef \| null; started_at: Timestamp \| null; finished_at: Timestamp \| null; steps_total: Int; steps_succeeded: Int; error: StepError \| null }`
- `RunTrigger` = `{ type: "event"; key: string; event_seq: Int; event_type: TriggerableEventType } \| { type: "schedule"; key: string; minute: Timestamp } \| { type: "metric"; key: string; value: number; window_start: Timestamp } \| { type: "manual"; key: string; by: string } \| { type: "retry"; key: string; of_run: UUID }`
- `SampleEvent` = `{ type: TriggerableEventType; payload: Record<string, unknown>; member?: Handle }`
- `SearchHit` = `{ type: SearchType; id: string; title: string; subtitle: string; href: string; icon: IconName; avatar: Avatar \| null; artwork: Artwork \| null; score: number }`
- `SearchIn` = `{ q: string; types?: SearchType[]; limit?: Int }`
- `SearchOut` = `{ q: string; groups: {...}[] }`
- `SearchType` = `"person" \| "group" \| "product" \| "badge" \| "content" \| "promotion" \| "automation" \| "segment" \| "order" \| "task" \| "thread" \| "dashboard"`
- `SegmentPreviewIn` = `{ rule?: CondTree; segment?: segment:<slug>; sample?: Int }`
- `SegmentPreviewOut` = `{ count: Int; total_members: Int; sample: MemberCard[]; by_tier: {...}; by_region: {...}; used_by: NodeLink[] }`
- `SegmentSummary` = `{ node: NodeLink; description: string; count: Int; owner: string; used_by: Int }`
- `SendIn` = `{ to: Recipient[]; cc?: Recipient[]; subject: string; body: string; attachments?: AttachmentMeta[]; idempotency_key: IdempotencyKey }`
- `SendOut` = `{ thread_id: UUID; message_id: UUID; recipient_count: Int; replayed: boolean }`
- `SessionView` = `{ session_id: string; label: string; created_at: Timestamp; last_seen_at: Timestamp; revoked_at: Timestamp \| null; current: boolean; surface: "ui" \| "mcp" \| "api" }`
- `SimulateIn` = `{ promotion: promotion:<slug> \| {...}; member: Handle; context: PromoContext; at?: Timestamp; include_live?: boolean }`
- `SimulateOut` = `{ member: {...}; at: Timestamp; evaluation: PromoEvaluation; baseline: PromoEvaluation }`
- `StatementIn` = `{ member?: Handle; from?: Timestamp; to?: Timestamp; types?: TxnType[]; cursor?: Cursor; limit?: Limit }`
- `StatementLine` = `{ txn_id: UUID; txn_no: Int; txn_type: TxnType; occurred_at: Timestamp; memo: string; amount: SignedPoints; balance_after: Points; counterparty: PersonRef \| {...} \| null; ref: TxnRef \| null; actor: PersonRef; reversed_by: UUID \| null }`
- `StatementOut` = `{ items: StatementLine[]; next_cursor: string \| null; opening_balance: Points; closing_balance: Points; credits: Points; debits: Points }`
- `StepError` = `{ code: string; message: string; retryable: boolean }`
- `StepStatus` = `"pending" \| "running" \| "succeeded" \| "failed" \| "skipped"`
- `StockStatus` = `"in_stock" \| "low" \| "out"`
- `TaskComment` = `{ comment_id: UUID; author: PersonRef; body: string; created_at: Timestamp }`
- `TaskCreateIn` = `{ title: string; description?: string; assignee?: Subject; priority?: TaskPriority; due_at?: Timestamp; link?: TaskLink; idempotency_key: IdempotencyKey }`
- `TaskDetailOut` = `{ task_id: UUID; task_no: Int; title: string; status: TaskStatus; priority: TaskPriority; assignee: PersonRef \| null; created_by: PersonRef; created_at: Timestamp; due_at: Timestamp \| null; overdue: boolean; link: TaskLink \| null; source: "manual" \| "automation"; comment_count: Int; version: Int; description: string; completed_at: Timestamp \| null; run_id: UUID \| null; comments: TaskComment[]; history: {...}[]; replayed?: boolean }`
- `TaskLink` = `{ kind: "order" \| "content" \| "promotion" \| "automation" \| "automation_run" \| "member" \| "approval" \| "product" \| "thread"; ref: string; label: string; href: string }`
- `TaskPriority` = `"low" \| "normal" \| "high" \| "urgent"`
- `TaskStatus` = `"open" \| "in_progress" \| "blocked" \| "done" \| "cancelled"`
- `TaskSummary` = `{ task_id: UUID; task_no: Int; title: string; status: TaskStatus; priority: TaskPriority; assignee: PersonRef \| null; created_by: PersonRef; created_at: Timestamp; due_at: Timestamp \| null; overdue: boolean; link: TaskLink \| null; source: "manual" \| "automation"; comment_count: Int; version: Int }`
- `TaskUpdateIn` = `{ task_id: UUID; title?: string; description?: string; status?: TaskStatus; priority?: TaskPriority; assignee?: Subject \| null; due_at?: Timestamp \| null; version: Int }`
- `TasksListIn` = `{ scope?: "mine" \| "created" \| "all"; status?: TaskStatus[]; priority?: TaskPriority[]; q?: string; due_before?: Timestamp; cursor?: Cursor; limit?: Limit }`
- `ThreadOut` = `{ thread: ThreadSummary; participants: ThreadParticipant[]; messages: MessageView[] }`
- `ThreadParticipant` = `{ person: PersonRef; role: "from" \| "to" \| "cc"; via_group: string \| null }`
- `ThreadStateIn` = `{ thread_id: UUID; read?: boolean; starred?: boolean; archived?: boolean; muted?: boolean }`
- `ThreadStateOut` = `{ threads: {...}[] }`
- `ThreadSummary` = `{ thread_id: UUID; subject: string; kind: "direct" \| "group" \| "broadcast" \| "system"; last_message_at: Timestamp; last_sender: PersonRef; preview: string; message_count: Int; unread_count: Int; participants: PersonRef[]; participant_count: Int; starred: boolean; archived: boolean; muted: boolean; has_attachments: boolean; mentioned: boolean }`
- `Tier` = `"bronze" \| "silver" \| "gold" \| "platinum"`
- `TierProgress` = `{ tier: Tier; lifetime_points: Points; next_tier: Tier \| null; next_tier_at: Points \| null; progress: number }`
- `TiersOut` = `{ tiers: {...}[] }`
- `Tone` = `"neutral" \| "info" \| "success" \| "warning" \| "danger" \| "signal"`
- `TransferIn` = `{ to: Handle; points: PositivePoints; memo: string; idempotency_key: IdempotencyKey }`
- `TrialBalanceOut` = `{ ok: boolean; checked_at: Timestamp; system: {...}[]; member_total: Int; grand_total: Int; lots_total: Int; drift: {...}[]; unbalanced_txns: UUID[]; txn_count: Int }`
- `TriggerIn` = `{ slug: string; event?: SampleEvent; idempotency_key: IdempotencyKey }`
- `TriggerableEventType` = `"message.received" \| "message.sent" \| "points.posted" \| "tier.changed" \| "order.placed" \| "order.status_changed" \| "stock.changed" \| "review.created" \| ...`
- `TxnDetailOut` = `{ txn_id: UUID; txn_no: Int; txn_type: TxnType; occurred_at: Timestamp; recorded_at: Timestamp; memo: string; actor: PersonRef; on_behalf_of: PersonRef \| null; surface: string; entries: EntryView[]; lots: {...}[]; ref: TxnRef \| null; reverses: UUID \| null; reversed_by: UUID \| null; idempotency_key: string \| null; event_seq: Int }`
- `TxnRef` = `{ kind: "order" \| "promotion" \| "badge_award" \| "automation_run" \| "transfer" \| "txn" \| "approval" \| "seed"; id: string; label: string; link: string \| null }`
- `TxnResult` = `{ txn_id: UUID; txn_no: Int; balance: Points; replayed: boolean }`
- `TxnType` = `"award" \| "purchase" \| "refund" \| "transfer" \| "expiry" \| "adjustment" \| "promotion_bonus" \| "badge_reward" \| "reversal"`
- `UiPrefs` = `{ theme: "auto" \| "light" \| "dark"; density: "comfortable" \| "compact"; reduced_motion: boolean; home_widgets?: string[] }`
- `VersionView` = `{ revision: Int; change_seq: Int; actor: PersonRef; at: Timestamp; status: ContentStatus; paths: string[]; reason: string \| null; published: boolean }`
- `WidgetCatalogEntry` = `{ id: string; domain: string; title: string; description: string; pkg: string; sizes: WidgetSize[]; default_size: WidgetSize; grid: Record<string, {...}>; config_schema: unknown; views: string[]; actions: string[]; events: string[]; publishes: string[]; subscribes: string[]; permission: string; available: boolean }`
- `WidgetSize` = `"s" \| "m" \| "l" \| "xl" \| "full"`
- `WidgetsCatalogOut` = `{ items: WidgetCatalogEntry[] }`
