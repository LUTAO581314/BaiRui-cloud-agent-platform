BEGIN;

CREATE TABLE IF NOT EXISTS agent_resource_samples (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  runtime_id text NOT NULL REFERENCES agent_runtimes(id) ON DELETE CASCADE,
  deployment_id text NOT NULL REFERENCES control_deployments(id) ON DELETE CASCADE,
  server_id text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence > 0),
  status text NOT NULL CHECK (status IN ('running', 'degraded', 'offline', 'unknown')),
  cpu_percent numeric(9,3) CHECK (cpu_percent IS NULL OR (cpu_percent >= 0 AND cpu_percent <= 100000)),
  memory_used_bytes bigint CHECK (memory_used_bytes IS NULL OR memory_used_bytes >= 0),
  memory_limit_bytes bigint CHECK (memory_limit_bytes IS NULL OR memory_limit_bytes >= 0),
  agent_storage_used_bytes bigint CHECK (agent_storage_used_bytes IS NULL OR agent_storage_used_bytes >= 0),
  host_storage_used_bytes bigint CHECK (host_storage_used_bytes IS NULL OR host_storage_used_bytes >= 0),
  host_storage_limit_bytes bigint CHECK (host_storage_limit_bytes IS NULL OR host_storage_limit_bytes >= 0),
  os_type text,
  architecture text,
  operating_system text,
  docker_version text,
  cpu_count integer CHECK (cpu_count IS NULL OR cpu_count > 0),
  started_at timestamptz,
  uptime_seconds bigint CHECK (uptime_seconds IS NULL OR uptime_seconds >= 0),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (runtime_id, sequence)
);

CREATE TABLE IF NOT EXISTS agent_container_resource_samples (
  sample_id text NOT NULL REFERENCES agent_resource_samples(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('hermes', 'runtime-boundary')),
  container_id text,
  container_name text,
  status text NOT NULL CHECK (status IN ('running', 'paused', 'restarting', 'exited', 'dead', 'created', 'removing', 'unknown')),
  image_ref text,
  version text,
  cpu_percent numeric(9,3) CHECK (cpu_percent IS NULL OR (cpu_percent >= 0 AND cpu_percent <= 100000)),
  memory_used_bytes bigint CHECK (memory_used_bytes IS NULL OR memory_used_bytes >= 0),
  memory_limit_bytes bigint CHECK (memory_limit_bytes IS NULL OR memory_limit_bytes >= 0),
  writable_bytes bigint CHECK (writable_bytes IS NULL OR writable_bytes >= 0),
  started_at timestamptz,
  PRIMARY KEY (sample_id, role)
);

CREATE INDEX IF NOT EXISTS agent_resource_samples_latest_idx
  ON agent_resource_samples (organization_id, agent_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS agent_resource_samples_runtime_idx
  ON agent_resource_samples (runtime_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS agent_resource_samples_retention_idx
  ON agent_resource_samples (organization_id, received_at);

COMMIT;
