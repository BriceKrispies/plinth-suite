-- L1 control store schema, following spec/05 section 8.2.
-- Departures from the DDL text, recorded here:
--   * changes.rule_id is text[] (README ruling 25), not text.
--   * preview_tokens.payload holds the staged ChangeSet so node.commit can apply exactly what was previewed
--     from the token alone (spec 06 section 4.3: the commit takes no uri, patch or base_revision).
--   * a create is stored with base_revision 0 so the spec CHECK on change rows holds.

CREATE TABLE workspaces (
  workspace_id        uuid PRIMARY KEY,
  slug                text NOT NULL UNIQUE,
  grant_index_version bigint NOT NULL DEFAULT 0,
  mask_version        int    NOT NULL DEFAULT 0,
  manifest_id         text   NOT NULL,
  run_prefix          text   NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE principals (
  principal_id  uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces,
  kind          text NOT NULL CHECK (kind IN ('human','service','agent')),
  subject       text NOT NULL,
  display_name  text NOT NULL,
  delegator_id  uuid REFERENCES principals,
  max_scope     jsonb,
  disabled_at   timestamptz,
  UNIQUE (workspace_id, subject),
  CHECK (kind <> 'agent' OR (delegator_id IS NOT NULL AND max_scope IS NOT NULL))
);

CREATE TABLE nodes (
  workspace_id uuid NOT NULL REFERENCES workspaces,
  node_id      uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('Dashboard','Panel','Query','Source','Parameter','Rule',
                 'Action','Form','Workflow','Grant','Metric','Template','Export','Annotation','Comment')),
  slug         text NOT NULL,
  revision     bigint NOT NULL CHECK (revision >= 1),
  body         jsonb NOT NULL,
  body_hash    bytea NOT NULL,
  deleted_at   timestamptz,
  created_seq  bigint NOT NULL,
  updated_seq  bigint NOT NULL,
  PRIMARY KEY (workspace_id, node_id),
  UNIQUE (workspace_id, kind, slug)
);

CREATE TABLE workspace_chain (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces,
  head_seq     bigint NOT NULL DEFAULT 0,
  head_hash    bytea  NOT NULL
);

CREATE TABLE changes (
  workspace_id    uuid NOT NULL REFERENCES workspaces,
  seq             bigint NOT NULL,
  kind            text NOT NULL DEFAULT 'change' CHECK (kind IN ('change','present','event')),
  commit_id       uuid NOT NULL,
  node_id         uuid NOT NULL,
  base_revision   bigint,
  result_revision bigint,
  actor_id        uuid NOT NULL REFERENCES principals,
  on_behalf_of    uuid REFERENCES principals,
  approved_by     uuid REFERENCES principals,
  approval_id     uuid,
  surface         text NOT NULL CHECK (surface IN ('ui','api','mcp','driver','system','cli')),
  session_id      text,
  branch_id       uuid,
  rule_id         text[] NOT NULL,
  change_hash     bytea NOT NULL,
  ops             jsonb NOT NULL,
  inverse_ops     jsonb NOT NULL,
  paths           text[] NOT NULL,
  payload         jsonb,
  reason          text,
  undo_of         bigint,
  replay_of       text,
  replay_change_hash bytea,
  recorded_actor  text,
  virtual_at      timestamptz,
  merged_from     bigint[],
  contains_untrusted boolean NOT NULL DEFAULT false,
  prev_hash       bytea NOT NULL,
  hash            bytea NOT NULL,
  created_at      timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, seq),
  UNIQUE (node_id, result_revision),
  FOREIGN KEY (workspace_id, undo_of) REFERENCES changes (workspace_id, seq),
  CHECK ((kind = 'change') = (base_revision IS NOT NULL AND result_revision IS NOT NULL)),
  CHECK ((surface = 'driver') = (replay_of IS NOT NULL))
);
CREATE INDEX changes_node ON changes (workspace_id, node_id, result_revision);

CREATE TABLE idempotency_records (
  workspace_id    uuid NOT NULL,
  principal_id    uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_hash    bytea NOT NULL,
  commit_id       uuid NOT NULL,
  result          jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, principal_id, idempotency_key)
);

CREATE TABLE preview_tokens (
  token_hash        bytea PRIMARY KEY,
  workspace_id      uuid NOT NULL,
  principal_id      uuid NOT NULL,
  change_hash       bytea NOT NULL,
  base_revisions    jsonb NOT NULL,
  payload           jsonb NOT NULL,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  consumed_at       timestamptz,
  consumed_by       uuid,
  CHECK ((consumed_at IS NULL) = (consumed_by IS NULL))
);
CREATE INDEX preview_tokens_open ON preview_tokens (workspace_id, principal_id) WHERE consumed_at IS NULL;

CREATE TABLE outbox (
  workspace_id uuid NOT NULL,
  seq          bigint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  relayed_at   timestamptz,
  PRIMARY KEY (workspace_id, seq),
  FOREIGN KEY (workspace_id, seq) REFERENCES changes (workspace_id, seq)
);
CREATE INDEX outbox_unrelayed ON outbox (workspace_id, seq) WHERE relayed_at IS NULL;

CREATE TABLE source_shards (
  source_id   text PRIMARY KEY,
  shard_count int NOT NULL CHECK (shard_count >= 1)
);

CREATE TABLE source_partitions (
  source_id     text NOT NULL REFERENCES source_shards,
  shard         int  NOT NULL,
  shard_seq     bigint NOT NULL,
  partition_key text NOT NULL,
  object_key    text NOT NULL,
  event_min     timestamptz NOT NULL,
  event_max     timestamptz NOT NULL,
  row_count     bigint NOT NULL,
  content_hash  bytea NOT NULL,
  published     boolean NOT NULL DEFAULT false,
  published_at  timestamptz,
  PRIMARY KEY (source_id, partition_key),
  UNIQUE (source_id, shard, shard_seq),
  CHECK (published = (published_at IS NOT NULL))
);
CREATE INDEX source_partitions_published ON source_partitions (source_id, shard, event_max) WHERE published;

CREATE VIEW source_watermark AS
SELECT s.source_id,
       min(COALESCE(m.shard_max, '-infinity'::timestamptz)) AS watermark
FROM source_shards s
CROSS JOIN LATERAL generate_series(0, s.shard_count - 1) AS g(shard)
LEFT JOIN (SELECT source_id, shard, max(event_max) AS shard_max
           FROM source_partitions WHERE published GROUP BY source_id, shard) m
  ON m.source_id = s.source_id AND m.shard = g.shard
GROUP BY s.source_id;
