BEGIN;

CREATE TABLE IF NOT EXISTS agent_runs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  parent_run_id text REFERENCES agent_runs(id) ON DELETE SET NULL,
  input_text text NOT NULL,
  model text,
  status text NOT NULL CHECK (status IN (
    'started', 'queued', 'running', 'waiting_for_approval', 'stopping',
    'completed', 'failed', 'cancelled', 'unknown'
  )),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_owner_fkey') THEN
    ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_owner_fkey
      FOREIGN KEY (agent_id, organization_id, user_id)
      REFERENCES agents(id, organization_id, owner_user_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS agent_runs_owner_created_idx
  ON agent_runs (organization_id, user_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_active_idx
  ON agent_runs (agent_id, updated_at DESC)
  WHERE status IN ('started', 'queued', 'running', 'waiting_for_approval', 'stopping');

COMMIT;
