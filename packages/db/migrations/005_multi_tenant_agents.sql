BEGIN;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS owner_user_id text REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS soul_markdown text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS initialization_status text NOT NULL DEFAULT 'uninitialized',
  ADD COLUMN IF NOT EXISTS desired_runtime_state text NOT NULL DEFAULT 'stopped',
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS last_error_detail text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE agents AS agent
SET owner_user_id = (
  SELECT id
  FROM users
  WHERE users.organization_id = agent.organization_id
  ORDER BY CASE WHEN role = 'platform_admin' THEN 0 WHEN role = 'org_admin' THEN 1 ELSE 2 END, created_at
  LIMIT 1
)
WHERE agent.owner_user_id IS NULL;

ALTER TABLE agents
  ALTER COLUMN owner_user_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_initialization_status_check') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_initialization_status_check
      CHECK (initialization_status IN ('uninitialized', 'provisioning', 'ready', 'degraded', 'failed', 'deleting'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_desired_runtime_state_check') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_desired_runtime_state_check
      CHECK (desired_runtime_state IN ('running', 'stopped', 'suspended', 'deleted'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agent_memberships (
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'operator', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, user_id)
);

INSERT INTO agent_memberships (agent_id, organization_id, user_id, role)
SELECT id, organization_id, owner_user_id, 'owner'
FROM agents
ON CONFLICT (agent_id, user_id) DO UPDATE SET role = 'owner';

CREATE TABLE IF NOT EXISTS agent_runtimes (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  deployment_id text REFERENCES control_deployments(id) ON DELETE SET NULL,
  workspace_ref text NOT NULL,
  runtime_kind text NOT NULL DEFAULT 'hermes' CHECK (runtime_kind IN ('hermes')),
  status text NOT NULL DEFAULT 'uninitialized' CHECK (status IN ('uninitialized', 'provisioning', 'starting', 'ready', 'degraded', 'stopped', 'suspended', 'failed', 'deleting', 'deleted')),
  hermes_version text,
  boundary_version text,
  config_revision_id text REFERENCES config_revisions(id) ON DELETE SET NULL,
  last_heartbeat_at timestamptz,
  last_error_code text,
  last_error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id),
  UNIQUE (organization_id, workspace_ref)
);

ALTER TABLE control_deployments
  ADD COLUMN IF NOT EXISTS agent_id text REFERENCES agents(id) ON DELETE CASCADE;

ALTER TABLE config_revisions
  ADD COLUMN IF NOT EXISTS agent_id text REFERENCES agents(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS agents_owner_idx ON agents (organization_id, owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS agent_memberships_user_idx ON agent_memberships (organization_id, user_id, role);
CREATE INDEX IF NOT EXISTS agent_runtimes_status_idx ON agent_runtimes (organization_id, status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS control_deployments_agent_idx ON control_deployments (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS config_revisions_agent_idx ON config_revisions (agent_id, revision DESC) WHERE agent_id IS NOT NULL;

COMMIT;
