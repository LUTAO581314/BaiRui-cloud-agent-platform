BEGIN;

ALTER TABLE control_commands
  DROP CONSTRAINT IF EXISTS control_commands_action_check;

ALTER TABLE control_commands
  ADD CONSTRAINT control_commands_action_check CHECK (action IN (
    'snapshot.collect', 'deployment.provision', 'deployment.start',
    'deployment.stop', 'deployment.suspend', 'deployment.resume',
    'deployment.delete', 'credential.revoke', 'probe.run', 'contract.test',
    'smoke.test', 'upstream.check', 'config.stage', 'config.apply',
    'backup.create', 'backup.verify', 'backup.restore', 'backup.expire',
    'release.stage', 'release.apply', 'release.rollback', 'service.restart'
  ));

ALTER TABLE backup_records
  DROP CONSTRAINT IF EXISTS backup_records_status_check;

ALTER TABLE backup_records
  ADD CONSTRAINT backup_records_status_check CHECK (status IN (
    'creating', 'created', 'verifying', 'verified', 'failed', 'expiring', 'expired'
  ));

ALTER TABLE backup_records
  ADD COLUMN IF NOT EXISTS expired_at timestamptz;

CREATE TABLE IF NOT EXISTS retention_runs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  cutoffs jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  backup_expiration_commands integer NOT NULL DEFAULT 0 CHECK (backup_expiration_commands >= 0),
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retention_runs_org_idx
  ON retention_runs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS heartbeats_retention_idx
  ON heartbeats (organization_id, received_at);
CREATE INDEX IF NOT EXISTS telemetry_events_retention_idx
  ON telemetry_events (organization_id, occurred_at);
CREATE INDEX IF NOT EXISTS usage_rollups_retention_idx
  ON usage_rollups (organization_id, bucket_start);
CREATE INDEX IF NOT EXISTS sensitive_access_events_retention_idx
  ON sensitive_access_events (organization_id, created_at);

COMMIT;
