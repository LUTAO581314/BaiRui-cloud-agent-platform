BEGIN;

CREATE TABLE IF NOT EXISTS control_deployments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  server_id text REFERENCES servers(id) ON DELETE SET NULL,
  name text NOT NULL,
  environment text NOT NULL DEFAULT 'production',
  status text NOT NULL DEFAULT 'enrolling' CHECK (status IN ('enrolling', 'active', 'degraded', 'offline', 'revoked')),
  group_name text,
  labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  desired_state_version bigint NOT NULL DEFAULT 0 CHECK (desired_state_version >= 0),
  observed_state_version bigint NOT NULL DEFAULT 0 CHECK (observed_state_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, server_id)
);

CREATE TABLE IF NOT EXISTS module_instances (
  id text PRIMARY KEY,
  deployment_id text NOT NULL REFERENCES control_deployments(id) ON DELETE CASCADE,
  module_id text NOT NULL,
  instance_key text NOT NULL,
  layer text NOT NULL CHECK (layer IN ('core-runtime', 'service-integration', 'data-storage', 'channel-bridge', 'ui-exposure')),
  version text,
  release_digest text,
  status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('healthy', 'degraded', 'unhealthy', 'unknown')),
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  observed_at timestamptz,
  UNIQUE (deployment_id, module_id, instance_key)
);

CREATE TABLE IF NOT EXISTS agent_identities (
  id text PRIMARY KEY,
  deployment_id text NOT NULL REFERENCES control_deployments(id) ON DELETE CASCADE,
  public_key text NOT NULL,
  fingerprint text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'rotating', 'revoked')),
  last_event_sequence bigint NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS config_revisions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision > 0),
  config_document jsonb NOT NULL,
  secret_envelope jsonb,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'staged', 'applying', 'applied', 'failed', 'rolled_back', 'superseded')),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, revision),
  UNIQUE (organization_id, content_hash)
);

CREATE TABLE IF NOT EXISTS release_manifests (
  id text PRIMARY KEY,
  release_id text REFERENCES releases(id) ON DELETE SET NULL,
  version text NOT NULL UNIQUE,
  agent_commit text NOT NULL,
  image_digest text NOT NULL UNIQUE,
  sbom_uri text NOT NULL,
  provenance_uri text NOT NULL,
  signature text NOT NULL,
  migration_version text,
  compatibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'rolling_out', 'released', 'blocked', 'withdrawn')),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS desired_states (
  id text PRIMARY KEY,
  deployment_id text NOT NULL REFERENCES control_deployments(id) ON DELETE CASCADE,
  version bigint NOT NULL CHECK (version > 0),
  config_revision_id text REFERENCES config_revisions(id) ON DELETE RESTRICT,
  release_manifest_id text REFERENCES release_manifests(id) ON DELETE RESTRICT,
  module_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deployment_id, version)
);

CREATE TABLE IF NOT EXISTS observations (
  id text PRIMARY KEY,
  deployment_id text NOT NULL REFERENCES control_deployments(id) ON DELETE CASCADE,
  version bigint NOT NULL CHECK (version > 0),
  desired_state_version bigint CHECK (desired_state_version >= 0),
  status text NOT NULL CHECK (status IN ('healthy', 'degraded', 'unhealthy', 'unknown')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_refs text[] NOT NULL DEFAULT ARRAY[]::text[],
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deployment_id, version)
);

CREATE TABLE IF NOT EXISTS control_commands (
  id text PRIMARY KEY,
  deployment_id text NOT NULL REFERENCES control_deployments(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  action text NOT NULL CHECK (action IN (
    'snapshot.collect', 'probe.run', 'contract.test', 'smoke.test',
    'upstream.check', 'config.stage', 'config.apply', 'backup.create',
    'backup.verify', 'release.stage', 'release.apply', 'release.rollback',
    'service.restart'
  )),
  target_module_id text NOT NULL,
  target_instance_id text,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_id text,
  expected_observation_version bigint NOT NULL CHECK (expected_observation_version >= 0),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'leased', 'accepted', 'running', 'succeeded', 'failed', 'cancelled', 'expired')),
  priority integer NOT NULL DEFAULT 100,
  lease_identity_id text REFERENCES agent_identities(id) ON DELETE SET NULL,
  lease_expires_at timestamptz,
  not_before timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  requested_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deployment_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS command_attempts (
  id text PRIMARY KEY,
  command_id text NOT NULL REFERENCES control_commands(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  identity_id text REFERENCES agent_identities(id) ON DELETE SET NULL,
  state text NOT NULL CHECK (state IN ('leased', 'accepted', 'running', 'succeeded', 'failed', 'cancelled', 'expired')),
  error_code text,
  error_summary text,
  evidence_refs text[] NOT NULL DEFAULT ARRAY[]::text[],
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (command_id, attempt)
);

CREATE TABLE IF NOT EXISTS control_approvals (
  id text PRIMARY KEY,
  command_id text NOT NULL REFERENCES control_commands(id) ON DELETE CASCADE,
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  requested_by text REFERENCES users(id) ON DELETE SET NULL,
  decided_by text REFERENCES users(id) ON DELETE SET NULL,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved', 'rejected', 'expired')),
  reason text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control_events (
  id text PRIMARY KEY,
  deployment_id text NOT NULL REFERENCES control_deployments(id) ON DELETE CASCADE,
  command_id text REFERENCES control_commands(id) ON DELETE SET NULL,
  identity_id text REFERENCES agent_identities(id) ON DELETE SET NULL,
  event_sequence bigint NOT NULL CHECK (event_sequence > 0),
  event_type text NOT NULL,
  state text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_refs text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deployment_id, event_sequence)
);

CREATE TABLE IF NOT EXISTS release_rollouts (
  id text PRIMARY KEY,
  release_manifest_id text NOT NULL REFERENCES release_manifests(id) ON DELETE CASCADE,
  deployment_id text NOT NULL REFERENCES control_deployments(id) ON DELETE CASCADE,
  previous_release_manifest_id text REFERENCES release_manifests(id) ON DELETE SET NULL,
  phase text NOT NULL CHECK (phase IN ('planned', 'staging', 'canary', 'rolling_out', 'verifying', 'succeeded', 'failed', 'rolling_back', 'rolled_back')),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_manifest_id, deployment_id)
);

CREATE TABLE IF NOT EXISTS release_gates (
  id text PRIMARY KEY,
  release_manifest_id text NOT NULL REFERENCES release_manifests(id) ON DELETE CASCADE,
  deployment_id text REFERENCES control_deployments(id) ON DELETE CASCADE,
  gate_name text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('pass', 'warn', 'block')),
  evidence_refs text[] NOT NULL DEFAULT ARRAY[]::text[],
  evaluated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_runs (
  id text PRIMARY KEY,
  deployment_id text REFERENCES control_deployments(id) ON DELETE CASCADE,
  release_manifest_id text REFERENCES release_manifests(id) ON DELETE SET NULL,
  suite_id text NOT NULL,
  test_type text NOT NULL CHECK (test_type IN ('probe', 'contract', 'smoke', 'integration', 'ui', 'restore')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'passed', 'failed', 'cancelled', 'expired')),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_artifacts (
  id text PRIMARY KEY,
  test_run_id text NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  artifact_type text NOT NULL,
  uri text NOT NULL,
  sha256 text NOT NULL,
  redaction_status text NOT NULL CHECK (redaction_status IN ('not_required', 'redacted', 'blocked')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS upstream_candidates (
  id text PRIMARY KEY,
  upstream_id text NOT NULL,
  current_ref text NOT NULL,
  candidate_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('detected', 'testing', 'compatible', 'incompatible', 'approved', 'rejected', 'released')),
  compatibility_test_run_id text REFERENCES test_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (upstream_id, candidate_ref)
);

CREATE TABLE IF NOT EXISTS backup_records (
  id text PRIMARY KEY,
  deployment_id text NOT NULL REFERENCES control_deployments(id) ON DELETE CASCADE,
  policy_id text NOT NULL,
  backup_type text NOT NULL CHECK (backup_type IN ('postgres', 'runtime-files', 'integration-data')),
  status text NOT NULL CHECK (status IN ('creating', 'created', 'verifying', 'verified', 'failed', 'expired')),
  storage_uri text,
  sha256 text,
  encrypted boolean NOT NULL DEFAULT true,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incidents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deployment_id text REFERENCES control_deployments(id) ON DELETE SET NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL CHECK (status IN ('open', 'acknowledged', 'mitigating', 'monitoring', 'resolved', 'closed')),
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id text PRIMARY KEY,
  organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  metric_name text NOT NULL,
  comparator text NOT NULL CHECK (comparator IN ('gt', 'gte', 'lt', 'lte', 'eq')),
  threshold double precision NOT NULL,
  window_seconds integer NOT NULL CHECK (window_seconds > 0),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control_outbox (
  id text PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  body jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control_dead_letters (
  id text PRIMARY KEY,
  outbox_id text REFERENCES control_outbox(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  body jsonb NOT NULL,
  error_summary text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_hash_chain (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  audit_event_id text REFERENCES audit_events(id) ON DELETE SET NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  previous_hash text,
  event_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sequence),
  UNIQUE (organization_id, event_hash)
);

CREATE INDEX IF NOT EXISTS control_deployments_org_idx ON control_deployments (organization_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS module_instances_deployment_idx ON module_instances (deployment_id, status);
CREATE INDEX IF NOT EXISTS desired_states_deployment_idx ON desired_states (deployment_id, version DESC);
CREATE INDEX IF NOT EXISTS observations_deployment_idx ON observations (deployment_id, version DESC);
CREATE INDEX IF NOT EXISTS control_commands_lease_idx ON control_commands (state, not_before, expires_at, priority, created_at);
CREATE INDEX IF NOT EXISTS control_commands_deployment_idx ON control_commands (deployment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS control_events_replay_idx ON control_events (deployment_id, event_sequence);
CREATE INDEX IF NOT EXISTS test_runs_release_idx ON test_runs (release_manifest_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS backups_deployment_idx ON backup_records (deployment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS incidents_open_idx ON incidents (organization_id, status, severity, opened_at DESC);
CREATE INDEX IF NOT EXISTS control_outbox_ready_idx ON control_outbox (available_at, attempts) WHERE published_at IS NULL;

COMMIT;
