BEGIN;

CREATE TABLE IF NOT EXISTS agent_authorizations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  service text NOT NULL,
  label text NOT NULL,
  auth_type text NOT NULL CHECK (auth_type IN ('api_key', 'bearer_token')),
  endpoint_url text,
  credential_envelope jsonb,
  credential_hint text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'stored' CHECK (status IN ('stored', 'applied', 'failed', 'revoked')),
  last_error_code text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, service, label)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_authorizations_owner_fkey') THEN
    ALTER TABLE agent_authorizations ADD CONSTRAINT agent_authorizations_owner_fkey
      FOREIGN KEY (agent_id, organization_id, user_id)
      REFERENCES agents(id, organization_id, owner_user_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS agent_authorizations_owner_idx
  ON agent_authorizations (organization_id, user_id, agent_id, status, updated_at DESC);

COMMIT;
