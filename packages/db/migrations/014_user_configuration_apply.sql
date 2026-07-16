BEGIN;

ALTER TABLE control_commands
  DROP CONSTRAINT IF EXISTS control_commands_action_check;

ALTER TABLE control_commands
  ADD CONSTRAINT control_commands_action_check CHECK (action IN (
    'snapshot.collect', 'deployment.provision', 'deployment.start',
    'deployment.stop', 'deployment.suspend', 'deployment.resume',
    'deployment.delete', 'credential.revoke', 'probe.run', 'contract.test',
    'smoke.test', 'upstream.check', 'config.stage', 'config.apply',
    'config.apply-user', 'backup.create', 'backup.verify', 'backup.restore',
    'backup.expire', 'release.stage', 'release.apply', 'release.rollback',
    'service.restart'
  ));

COMMIT;
