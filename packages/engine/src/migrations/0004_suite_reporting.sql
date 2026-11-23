-- Plinth Suite reporting views (docs/suite/CONTRACT.md section 13). Each view selects workspace_id plus the columns of
-- the matching SUITE_SOURCES entry. The engine reads them through the metadata-source path (K9). Private text
-- (message and review bodies, emails) never appears in a view; every view carries a region column.

-- ledger: one row per entry
CREATE VIEW rpt_ledger AS
SELECT e.workspace_id,
       e.entry_id,
       t.txn_id::text AS txn_id,
       t.txn_no,
       t.occurred_at,
       t.txn_type,
       a.code AS account,
       a.kind AS account_kind,
       m.handle AS member,
       m.region AS region,
       e.tier_after AS tier,
       m.department AS department,
       e.amount,
       greatest(e.amount, 0) AS credit,
       greatest(-e.amount, 0) AS debit,
       e.balance_after,
       t.ref_kind,
       t.ref_id,
       CASE
         WHEN t.ref_kind = 'promotion' THEN t.ref_id
         WHEN t.ref_kind = 'order' THEN (
           SELECT o.promotions -> 0 ->> 'slug' FROM store_orders o WHERE o.order_id::text = t.ref_id)
         ELSE NULL
       END AS promotion,
       p.subject AS actor,
       t.surface
FROM ledger_entries e
JOIN ledger_transactions t ON t.txn_id = e.txn_id
JOIN ledger_accounts a ON a.account_id = e.account_id
JOIN principals p ON p.principal_id = t.actor_id
LEFT JOIN members m ON m.member_id = a.member_id;

CREATE VIEW rpt_store_orders AS
SELECT o.workspace_id,
       o.order_id::text AS order_id,
       o.order_no,
       o.placed_at,
       m.handle AS member,
       m.region AS region,
       o.tier AS tier,
       m.department AS department,
       o.status,
       o.requires_approval,
       (SELECT count(*) FROM store_order_items i WHERE i.order_id = o.order_id)::int AS item_count,
       o.subtotal_points,
       o.discount_points,
       o.total_points,
       o.bonus_points,
       o.cash_cents,
       (SELECT string_agg(x ->> 'slug', ',') FROM jsonb_array_elements(o.promotions) x) AS promotions,
       (SELECT min(ev.occurred_at) FROM store_order_events ev WHERE ev.order_id = o.order_id AND ev.to_status = 'approved') AS approved_at,
       (SELECT min(ev.occurred_at) FROM store_order_events ev WHERE ev.order_id = o.order_id AND ev.to_status = 'delivered') AS delivered_at,
       (SELECT min(ev.occurred_at) FROM store_order_events ev WHERE ev.order_id = o.order_id AND ev.to_status = 'cancelled') AS cancelled_at,
       (SELECT min(ev.occurred_at) FROM store_order_events ev WHERE ev.order_id = o.order_id AND ev.to_status = 'refunded') AS refunded_at,
       (SELECT (extract(epoch FROM (min(ev.occurred_at) - o.placed_at)) * 1000)::bigint
          FROM store_order_events ev WHERE ev.order_id = o.order_id AND ev.to_status = 'delivered') AS fulfil_ms
FROM store_orders o
JOIN members m ON m.member_id = o.member_id;

CREATE VIEW rpt_order_items AS
SELECT o.workspace_id,
       o.order_id::text AS order_id,
       i.line,
       o.placed_at,
       m.handle AS member,
       m.region AS region,
       o.tier AS tier,
       o.status,
       i.product_slug AS product,
       i.title AS product_title,
       i.category_slug AS category,
       i.qty,
       i.unit_points,
       i.discount_points,
       i.line_points,
       i.free_item
FROM store_order_items i
JOIN store_orders o ON o.order_id = i.order_id
JOIN members m ON m.member_id = o.member_id;

CREATE VIEW rpt_messages AS
SELECT x.workspace_id,
       x.message_id::text AS message_id,
       x.thread_id::text AS thread_id,
       x.sent_at,
       p.subject AS sender,
       m.region AS region,
       m.department AS department,
       th.kind AS thread_kind,
       (x.reply_to IS NOT NULL) AS is_reply,
       greatest((SELECT count(*) FROM thread_participants tp WHERE tp.thread_id = x.thread_id) - 1, 0)::int AS recipient_count,
       cardinality(x.mentions) AS mention_count,
       (SELECT count(*) FROM message_attachments att WHERE att.message_id = x.message_id)::int AS attachment_count,
       (SELECT coalesce(sum(att.size_bytes), 0) FROM message_attachments att WHERE att.message_id = x.message_id)::bigint AS attachment_bytes,
       (x.via_automation IS NOT NULL) AS via_automation,
       (SELECT count(*) FROM message_receipts r WHERE r.message_id = x.message_id AND r.read_at IS NOT NULL)::int AS read_count
FROM messages x
JOIN message_threads th ON th.thread_id = x.thread_id
JOIN principals p ON p.principal_id = x.sender_id
LEFT JOIN members m ON m.member_id = x.sender_id;

CREATE VIEW rpt_notifications AS
SELECT n.workspace_id,
       n.notification_id::text AS notification_id,
       n.created_at,
       p.subject AS recipient,
       m.region AS region,
       n.type,
       (n.read_at IS NOT NULL) AS read,
       CASE WHEN n.read_at IS NULL THEN NULL
            ELSE (extract(epoch FROM (n.read_at - n.created_at)) * 1000)::bigint END AS read_ms,
       EXISTS (SELECT 1 FROM notification_deliveries d
                WHERE d.recipient_id = n.recipient_id AND d.channel = 'email' AND d.status = 'sent'
                  AND n.notification_id = ANY (d.notification_ids)) AS emailed,
       EXISTS (SELECT 1 FROM notification_deliveries d
                WHERE d.recipient_id = n.recipient_id AND d.channel = 'digest' AND d.status = 'sent'
                  AND n.notification_id = ANY (d.notification_ids)) AS in_digest
FROM notifications n
JOIN principals p ON p.principal_id = n.recipient_id
LEFT JOIN members m ON m.member_id = n.recipient_id;

CREATE VIEW rpt_badge_awards AS
SELECT b.workspace_id,
       b.award_id::text AS award_id,
       b.awarded_at,
       b.badge_slug AS badge,
       coalesce(nd.body -> 'metadata' ->> 'title', b.badge_slug) AS badge_title,
       coalesce(nd.body -> 'spec' ->> 'rarity', 'common') AS rarity,
       m.handle AS member,
       m.region AS region,
       coalesce(la.tier, 'bronze') AS tier,
       ap.subject AS awarded_by,
       (ap.subject <> 'service:badges') AS manual,
       coalesce((nd.body -> 'spec' ->> 'points_reward')::bigint, 0) AS points_reward,
       (b.revoked_at IS NOT NULL) AS revoked
FROM badge_awards b
JOIN members m ON m.member_id = b.member_id
JOIN principals ap ON ap.principal_id = b.awarded_by
LEFT JOIN ledger_accounts la ON la.member_id = b.member_id
LEFT JOIN nodes nd ON nd.workspace_id = b.workspace_id AND nd.node_id = b.badge_id;

CREATE VIEW rpt_promotion_redemptions AS
SELECT r.workspace_id,
       r.redemption_id::text AS redemption_id,
       r.occurred_at,
       r.promotion_slug AS promotion,
       r.promotion_revision,
       m.handle AS member,
       m.region AS region,
       coalesce(la.tier, 'bronze') AS tier,
       r.context,
       r.effect_type,
       r.cost_points,
       r.benefit_points,
       r.ref_kind,
       r.ref_id,
       (r.reversed_at IS NOT NULL) AS reversed
FROM promotion_redemptions r
JOIN members m ON m.member_id = r.member_id
LEFT JOIN ledger_accounts la ON la.member_id = r.member_id;

CREATE VIEW rpt_automation_runs AS
SELECT r.workspace_id,
       r.run_id::text AS run_id,
       r.created_at,
       r.automation_slug AS automation,
       r.automation_revision,
       coalesce(r.trigger ->> 'type', 'event') AS trigger_type,
       r.status,
       m.handle AS member,
       m.region AS region,
       (SELECT count(*) FROM automation_steps s WHERE s.run_id = r.run_id)::int AS steps_total,
       (SELECT count(*) FROM automation_steps s WHERE s.run_id = r.run_id AND s.status = 'failed')::int AS steps_failed,
       r.attempt AS attempts,
       CASE WHEN r.started_at IS NULL OR r.finished_at IS NULL THEN NULL
            ELSE (extract(epoch FROM (r.finished_at - r.started_at)) * 1000)::bigint END AS duration_ms,
       r.error ->> 'code' AS error_code
FROM automation_runs r
LEFT JOIN members m ON m.member_id = r.member_id;

CREATE VIEW rpt_content_engagement AS
SELECT ce.workspace_id,
       nd.slug AS content,
       coalesce(nd.body -> 'metadata' ->> 'title', nd.slug) AS title,
       coalesce(nd.body -> 'spec' ->> 'type', 'article') AS content_type,
       (SELECT min(c.created_at) FROM changes c
         WHERE c.workspace_id = nd.workspace_id AND c.node_id = nd.node_id AND c.kind = 'change'
           AND c.ops::text LIKE '%published_revision%') AS published_at,
       m.handle AS member,
       m.region AS region,
       coalesce(la.tier, 'bronze') AS tier,
       ce.first_viewed_at,
       ce.last_viewed_at,
       ce.views,
       ce.reaction
FROM content_engagement ce
JOIN nodes nd ON nd.workspace_id = ce.workspace_id AND nd.node_id = ce.content_id
JOIN members m ON m.member_id = ce.member_id
LEFT JOIN ledger_accounts la ON la.member_id = ce.member_id;

CREATE VIEW rpt_members AS
SELECT m.workspace_id,
       m.handle AS member,
       p.display_name,
       m.joined_at,
       m.region AS region,
       coalesce(la.tier, 'bronze') AS tier,
       m.department AS department,
       CASE WHEN p.disabled_at IS NULL THEN 'active' ELSE 'disabled' END AS status,
       coalesce(la.balance, 0) AS balance,
       coalesce(la.lifetime_earned, 0) AS lifetime_points,
       (SELECT count(*) FROM badge_awards b WHERE b.member_id = m.member_id AND b.revoked_at IS NULL)::int AS badges_count,
       (SELECT count(*) FROM store_orders o WHERE o.member_id = m.member_id AND o.status <> 'cancelled')::int AS orders_count,
       m.last_active_at
FROM members m
JOIN principals p ON p.principal_id = m.member_id
LEFT JOIN ledger_accounts la ON la.member_id = m.member_id;

CREATE VIEW rpt_tasks AS
SELECT t.workspace_id,
       t.task_id::text AS task_id,
       t.task_no,
       t.created_at,
       t.status,
       t.priority,
       t.source,
       ap.subject AS assignee,
       am.region AS region,
       cp.subject AS created_by,
       t.due_at,
       t.completed_at,
       (t.due_at IS NOT NULL AND t.status NOT IN ('done', 'cancelled')
          AND t.due_at < coalesce((SELECT max(e.occurred_at) FROM domain_events e WHERE e.workspace_id = t.workspace_id), t.created_at)) AS overdue,
       CASE WHEN t.completed_at IS NULL THEN NULL
            ELSE (extract(epoch FROM (t.completed_at - t.created_at)) * 1000)::bigint END AS cycle_ms
FROM tasks t
JOIN principals cp ON cp.principal_id = t.created_by
LEFT JOIN principals ap ON ap.principal_id = t.assignee_id
LEFT JOIN members am ON am.member_id = t.assignee_id;

CREATE VIEW rpt_events AS
SELECT e.workspace_id,
       e.seq,
       e.occurred_at,
       e.type,
       a.subject AS actor,
       o.subject AS on_behalf_of,
       e.surface,
       e.subject_kind,
       e.subject_id,
       m.handle AS member,
       m.region AS region,
       e.cause ->> 'automation' AS caused_by_automation
FROM domain_events e
JOIN principals a ON a.principal_id = e.actor_id
LEFT JOIN principals o ON o.principal_id = e.on_behalf_of
LEFT JOIN members m ON m.member_id = e.member_id;
