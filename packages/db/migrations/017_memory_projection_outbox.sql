BEGIN;

CREATE TABLE IF NOT EXISTS memory_projection_outbox (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason ~ '^[a-z][a-z0-9._-]{0,63}$'),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','processing','retry','completed','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token text,
  lease_expires_at timestamptz,
  last_error_code text,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_projection_outbox_pending_agent_idx
  ON memory_projection_outbox (agent_id)
  WHERE state IN ('pending','retry');

CREATE UNIQUE INDEX IF NOT EXISTS memory_projection_outbox_processing_agent_idx
  ON memory_projection_outbox (agent_id)
  WHERE state = 'processing';

CREATE INDEX IF NOT EXISTS memory_projection_outbox_ready_idx
  ON memory_projection_outbox (available_at, created_at)
  WHERE state IN ('pending','retry');

CREATE INDEX IF NOT EXISTS memory_projection_outbox_history_idx
  ON memory_projection_outbox (agent_id, created_at DESC);

COMMIT;
