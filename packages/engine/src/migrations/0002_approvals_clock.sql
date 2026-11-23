-- L2: held changes (approvals) and the virtual clock.

CREATE TABLE change_approvals (
  approval_id     uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces,
  requester_id    uuid NOT NULL REFERENCES principals,
  on_behalf_of    uuid REFERENCES principals,
  rule_id         text[] NOT NULL,
  change_hash     bytea NOT NULL,
  payload         jsonb NOT NULL,           -- { changes: NodeChange[], undo_of?: number }
  status          text NOT NULL CHECK (status IN ('pending_approval','approved','rejected','withdrawn','expired','stale')),
  reason          text,
  idempotency_key text,
  commit_id       uuid,
  group_id        uuid,                     -- commit group once approved and applied
  decided_by      uuid REFERENCES principals,
  decided_at      timestamptz,
  decision_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);
CREATE INDEX change_approvals_open ON change_approvals (workspace_id, status);

-- One row: the virtual clock the live generator drives. virtual_now = virtual_ref + (now - wall_ref) * speed
-- while running; frozen at virtual_ref while paused. `faults` holds the cued FaultProfiles (applied from their
-- own start minute) so live ticks are deterministic from seed, tick and these profiles.
CREATE TABLE virtual_clock (
  id          int PRIMARY KEY CHECK (id = 1),
  virtual_ref timestamptz NOT NULL,
  wall_ref    timestamptz NOT NULL,
  speed       double precision NOT NULL CHECK (speed > 0),
  paused      boolean NOT NULL DEFAULT false,
  faults      jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
