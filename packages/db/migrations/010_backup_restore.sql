BEGIN;

ALTER TABLE control_commands
  DROP CONSTRAINT IF EXISTS control_commands_action_check;

ALTER TABLE control_commands
  ADD CONSTRAINT control_commands_action_check CHECK (action IN (
    'snapshot.collect', 'deployment.provision', 'deployment.start',
    'deployment.stop', 'deployment.suspend', 'deployment.resume',
    'deployment.delete', 'credential.revoke', 'probe.run', 'contract.test',
    'smoke.test', 'upstream.check', 'config.stage', 'config.apply',
    'backup.create', 'backup.verify', 'backup.restore', 'release.stage',
    'release.apply', 'release.rollback', 'service.restart'
  ));

CREATE TABLE IF NOT EXISTS backup_restore_runs (
  id text PRIMARY KEY,
  backup_id text NOT NULL REFERENCES backup_records(id) ON DELETE CASCADE,
  deployment_id text NOT NULL REFERENCES control_deployments(id) ON DELETE CASCADE,
  command_id text NOT NULL UNIQUE REFERENCES control_commands(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('requested', 'running', 'succeeded', 'failed', 'cancelled')),
  requested_by text REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  evidence_refs text[] NOT NULL DEFAULT ARRAY[]::text[],
  error_code text,
  error_summary text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS backup_restore_runs_deployment_idx
  ON backup_restore_runs (deployment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS backup_restore_runs_backup_idx
  ON backup_restore_runs (backup_id, created_at DESC);

COMMIT;
