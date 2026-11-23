-- Plinth Suite (docs/suite/CONTRACT.md section 2.4): transactional tables, domain events, ledger, store, badges,
-- promotions, messages, notifications, automation, content and tasks.

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
