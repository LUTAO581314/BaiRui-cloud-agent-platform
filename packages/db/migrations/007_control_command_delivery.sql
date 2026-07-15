BEGIN;

ALTER TABLE agent_runtimes
  ADD COLUMN IF NOT EXISTS endpoint_ref text,
  ADD COLUMN IF NOT EXISTS route_updated_at timestamptz;

ALTER TABLE control_commands
  ADD COLUMN IF NOT EXISTS lease_server_id text REFERENCES servers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS server_credentials (
  id text PRIMARY KEY,
  server_id text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  key_hint text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotating', 'revoked', 'expired')),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_runtime_credentials (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  runtime_id text NOT NULL REFERENCES agent_runtimes(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  key_hint text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotating', 'revoked', 'expired')),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS machine_request_nonces (
  credential_type text NOT NULL CHECK (credential_type IN ('server', 'agent-runtime')),
  credential_id text NOT NULL,
  nonce text NOT NULL,
  timestamp_ms bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (credential_type, credential_id, nonce)
);

CREATE TABLE IF NOT EXISTS command_receipts (
  id text PRIMARY KEY,
  command_id text NOT NULL REFERENCES control_commands(id) ON DELETE CASCADE,
  deployment_id text NOT NULL REFERENCES control_deployments(id) ON DELETE CASCADE,
  server_id text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  state text NOT NULL CHECK (state IN ('accepted', 'running', 'succeeded', 'failed', 'cancelled', 'expired')),
  error_code text,
  error_summary text,
  runtime_endpoint_ref text,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_refs text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (command_id, attempt, state)
);

CREATE INDEX IF NOT EXISTS server_credentials_active_idx ON server_credentials (server_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runtime_credentials_active_idx ON agent_runtime_credentials (agent_id, runtime_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS agent_runtime_credentials_one_active_idx ON agent_runtime_credentials (runtime_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS machine_request_nonces_expiry_idx ON machine_request_nonces (expires_at);
CREATE INDEX IF NOT EXISTS command_receipts_command_idx ON command_receipts (command_id, attempt, created_at);
CREATE INDEX IF NOT EXISTS control_commands_server_lease_idx ON control_commands (lease_server_id, state, lease_expires_at);

COMMIT;
