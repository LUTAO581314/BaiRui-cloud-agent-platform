BEGIN;

ALTER TABLE control_deployments
  DROP CONSTRAINT IF EXISTS control_deployments_organization_id_server_id_key;

ALTER TABLE control_commands
  DROP CONSTRAINT IF EXISTS control_commands_action_check;

ALTER TABLE control_commands
  ADD CONSTRAINT control_commands_action_check CHECK (action IN (
    'snapshot.collect', 'deployment.provision', 'deployment.start',
    'deployment.stop', 'deployment.suspend', 'deployment.resume',
    'deployment.delete', 'credential.revoke', 'probe.run', 'contract.test',
    'smoke.test', 'upstream.check', 'config.stage', 'config.apply',
    'backup.create', 'backup.verify', 'release.stage', 'release.apply',
    'release.rollback', 'service.restart'
  ));

CREATE TABLE IF NOT EXISTS agent_components (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  runtime_id text NOT NULL REFERENCES agent_runtimes(id) ON DELETE CASCADE,
  layer text NOT NULL CHECK (layer IN ('core-runtime', 'service-integration', 'data-storage', 'channel-bridge', 'ui-exposure')),
  module_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('healthy', 'degraded', 'unhealthy', 'unknown')),
  version text,
  upstream_ref text,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (runtime_id, module_id)
);

CREATE TABLE IF NOT EXISTS heartbeats (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  runtime_id text NOT NULL REFERENCES agent_runtimes(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence > 0),
  status text NOT NULL CHECK (status IN ('healthy', 'degraded', 'unhealthy', 'unknown')),
  runtime_version text,
  boundary_version text,
  config_revision_id text REFERENCES config_revisions(id) ON DELETE SET NULL,
  queue_depth integer NOT NULL DEFAULT 0 CHECK (queue_depth >= 0),
  active_runs integer NOT NULL DEFAULT 0 CHECK (active_runs >= 0),
  failed_runs integer NOT NULL DEFAULT 0 CHECK (failed_runs >= 0),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (runtime_id, sequence)
);

CREATE TABLE IF NOT EXISTS telemetry_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  runtime_id text REFERENCES agent_runtimes(id) ON DELETE SET NULL,
  layer text CHECK (layer IS NULL OR layer IN ('core-runtime', 'service-integration', 'data-storage', 'channel-bridge', 'ui-exposure')),
  component_id text,
  event_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
  trace_id text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  redacted_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_rollups (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  runtime_id text REFERENCES agent_runtimes(id) ON DELETE SET NULL,
  bucket_start timestamptz NOT NULL,
  bucket_seconds integer NOT NULL CHECK (bucket_seconds IN (60, 300, 3600, 86400)),
  model text NOT NULL DEFAULT 'unknown',
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  estimated_cost_usd numeric(20, 8) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  run_count bigint NOT NULL DEFAULT 0 CHECK (run_count >= 0),
  failed_run_count bigint NOT NULL DEFAULT 0 CHECK (failed_run_count >= 0),
  latency_sum_ms bigint NOT NULL DEFAULT 0 CHECK (latency_sum_ms >= 0),
  PRIMARY KEY (agent_id, bucket_start, bucket_seconds, model)
);

CREATE TABLE IF NOT EXISTS alerts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text REFERENCES agents(id) ON DELETE CASCADE,
  runtime_id text REFERENCES agent_runtimes(id) ON DELETE SET NULL,
  rule_id text REFERENCES alert_rules(id) ON DELETE SET NULL,
  code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'closed')),
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  acknowledged_by text REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, code, status)
);

CREATE TABLE IF NOT EXISTS secret_references (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  agent_id text REFERENCES agents(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('platform', 'organization', 'user', 'agent')),
  purpose text NOT NULL,
  provider text NOT NULL,
  vault_ref text NOT NULL,
  key_hint text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'rotating', 'revoked', 'expired')),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  rotated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, scope, agent_id, purpose)
);

CREATE INDEX IF NOT EXISTS agent_components_status_idx ON agent_components (organization_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS heartbeats_latest_idx ON heartbeats (agent_id, received_at DESC);
CREATE INDEX IF NOT EXISTS telemetry_events_agent_idx ON telemetry_events (agent_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS telemetry_events_severity_idx ON telemetry_events (organization_id, severity, occurred_at DESC);
CREATE INDEX IF NOT EXISTS usage_rollups_org_idx ON usage_rollups (organization_id, bucket_start DESC);
CREATE INDEX IF NOT EXISTS alerts_open_idx ON alerts (organization_id, status, severity, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS secret_references_agent_idx ON secret_references (agent_id, status);

COMMIT;
