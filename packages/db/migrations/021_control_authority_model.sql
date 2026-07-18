BEGIN;

CREATE OR REPLACE FUNCTION bairui_control_json_is_safe(payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  entry_key text;
  entry_value jsonb;
  normalized_key text;
  scalar_value text;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) = 'null' THEN
    RETURN true;
  END IF;

  IF jsonb_typeof(payload) = 'object' THEN
    FOR entry_key, entry_value IN SELECT * FROM jsonb_each(payload)
    LOOP
      normalized_key := lower(regexp_replace(entry_key, '[^A-Za-z0-9]', '', 'g'));
      IF normalized_key = ANY (ARRAY[
        'prompt', 'systemprompt', 'chat', 'conversation', 'conversations',
        'message', 'messages', 'task', 'tasks', 'model', 'models',
        'provider', 'providers', 'tool', 'tools', 'skill', 'skills',
        'memory', 'memories', 'password', 'token', 'accesstoken',
        'refreshtoken', 'apikey', 'accesskey', 'secret', 'secrets',
        'secretvalue', 'secretenvelope', 'credential', 'credentials',
        'authorization', 'shell', 'script', 'sql'
      ]::text[]) THEN
        RETURN false;
      END IF;
      IF NOT bairui_control_json_is_safe(entry_value) THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  END IF;

  IF jsonb_typeof(payload) = 'array' THEN
    FOR entry_value IN SELECT value FROM jsonb_array_elements(payload)
    LOOP
      IF NOT bairui_control_json_is_safe(entry_value) THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  END IF;

  IF jsonb_typeof(payload) = 'string' THEN
    scalar_value := payload #>> '{}';
    IF length(scalar_value) > 4096 THEN
      RETURN false;
    END IF;
    IF scalar_value ~* '(-----BEGIN[[:space:]]+([A-Z]+[[:space:]]+)?PRIVATE KEY-----|Bearer[[:space:]]+[A-Za-z0-9._~+/=-]{16,}|(sk|gh[oprsu])[-_][A-Za-z0-9_-]{16,})' THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION bairui_reject_unsafe_control_json()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  column_name text;
  payload jsonb;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV
  LOOP
    payload := to_jsonb(NEW) -> column_name;
    IF NOT bairui_control_json_is_safe(payload) THEN
      RAISE EXCEPTION 'Unsafe control-plane payload in %.%', TG_TABLE_NAME, column_name
        USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION bairui_secret_refs_are_opaque(refs text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(bool_and(ref ~ '^sr_[A-Za-z0-9_-]{16,128}$'), true)
  FROM unnest(refs) AS item(ref);
$$;

ALTER TABLE desired_states
  ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS agent_id text REFERENCES agents(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS server_id text REFERENCES servers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS sequence bigint,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'running',
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS backup_id text REFERENCES backup_records(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS valid_from timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE desired_states desired
SET organization_id = deployment.organization_id,
    agent_id = deployment.agent_id,
    server_id = deployment.server_id,
    request_id = COALESCE(desired.request_id, 'legacy:' || desired.id),
    correlation_id = COALESCE(desired.correlation_id, 'legacy:' || desired.id),
    idempotency_key = COALESCE(desired.idempotency_key, 'legacy:' || desired.id),
    sequence = COALESCE(desired.sequence, desired.version),
    state = COALESCE(agent.desired_runtime_state, desired.state),
    updated_at = COALESCE(desired.updated_at, desired.created_at)
FROM control_deployments deployment
LEFT JOIN agents agent ON agent.id = deployment.agent_id
WHERE desired.deployment_id = deployment.id;

UPDATE desired_states older
SET lifecycle_status = 'superseded'
WHERE EXISTS (
  SELECT 1 FROM desired_states newer
  WHERE newer.deployment_id = older.deployment_id AND newer.version > older.version
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desired_states_state_check') THEN
    ALTER TABLE desired_states ADD CONSTRAINT desired_states_state_check
      CHECK (state IN ('provisioned', 'running', 'stopped', 'suspended', 'deleted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desired_states_lifecycle_status_check') THEN
    ALTER TABLE desired_states ADD CONSTRAINT desired_states_lifecycle_status_check
      CHECK (lifecycle_status IN ('proposed', 'accepted', 'active', 'superseded', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desired_states_active_reference_check') THEN
    ALTER TABLE desired_states ADD CONSTRAINT desired_states_active_reference_check
      CHECK (lifecycle_status <> 'active' OR config_revision_id IS NOT NULL OR release_manifest_id IS NOT NULL
        OR backup_id IS NOT NULL OR module_versions <> '{}'::jsonb OR modules <> '[]'::jsonb) NOT VALID;
  END IF;
END $$;

ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS agent_id text REFERENCES agents(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS server_id text REFERENCES servers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS sequence bigint,
  ADD COLUMN IF NOT EXISTS source_identity text,
  ADD COLUMN IF NOT EXISTS modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS redaction_status text NOT NULL DEFAULT 'redacted',
  ADD COLUMN IF NOT EXISTS freshness text NOT NULL DEFAULT 'fresh',
  ADD COLUMN IF NOT EXISTS freshness_seconds integer NOT NULL DEFAULT 0;

UPDATE observations observation
SET organization_id = deployment.organization_id,
    agent_id = deployment.agent_id,
    server_id = deployment.server_id,
    request_id = COALESCE(observation.request_id, 'legacy:' || observation.id),
    correlation_id = COALESCE(observation.correlation_id, 'legacy:' || observation.id),
    idempotency_key = COALESCE(observation.idempotency_key, 'legacy:' || observation.id),
    sequence = COALESCE(observation.sequence, observation.version),
    source_identity = COALESCE(observation.source_identity, 'legacy-migration'),
    freshness_seconds = GREATEST(0, EXTRACT(EPOCH FROM (observation.received_at - observation.observed_at))::integer)
FROM control_deployments deployment
WHERE observation.deployment_id = deployment.id;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'observations_redaction_status_check') THEN
    ALTER TABLE observations ADD CONSTRAINT observations_redaction_status_check
      CHECK (redaction_status IN ('redacted', 'blocked'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'observations_freshness_seconds_check') THEN
    ALTER TABLE observations ADD CONSTRAINT observations_freshness_seconds_check
      CHECK (freshness_seconds >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'observations_freshness_check') THEN
    ALTER TABLE observations ADD CONSTRAINT observations_freshness_check
      CHECK (freshness IN ('fresh', 'stale', 'invalid'));
  END IF;
END $$;

ALTER TABLE control_events
  ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS agent_id text REFERENCES agents(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS server_id text REFERENCES servers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS source_identity text,
  ADD COLUMN IF NOT EXISTS attempt integer,
  ADD COLUMN IF NOT EXISTS lease_id text,
  ADD COLUMN IF NOT EXISTS lease_token_ref text,
  ADD COLUMN IF NOT EXISTS observation_version bigint,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz;

UPDATE control_events event
SET organization_id = deployment.organization_id,
    agent_id = deployment.agent_id,
    server_id = deployment.server_id,
    request_id = COALESCE(event.request_id, 'legacy:' || event.id),
    correlation_id = COALESCE(event.correlation_id, 'legacy:' || event.id),
    idempotency_key = COALESCE(event.idempotency_key, 'legacy:' || event.id),
    source_identity = COALESCE(event.source_identity, event.identity_id, 'legacy-migration'),
    occurred_at = COALESCE(event.occurred_at, event.created_at)
FROM control_deployments deployment
WHERE event.deployment_id = deployment.id;

ALTER TABLE control_approvals
  ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS agent_id text REFERENCES agents(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS server_id text REFERENCES servers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS sequence bigint,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS reason_ref text,
  ADD COLUMN IF NOT EXISTS scope jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE control_approvals approval
SET organization_id = deployment.organization_id,
    agent_id = deployment.agent_id,
    server_id = deployment.server_id,
    request_id = COALESCE(approval.request_id, 'legacy:' || approval.id),
    correlation_id = COALESCE(approval.correlation_id, 'legacy:' || approval.id),
    idempotency_key = COALESCE(approval.idempotency_key, 'legacy:' || approval.id),
    sequence = COALESCE(approval.sequence, 1),
    action = COALESCE(approval.action, command.action),
    reason_code = COALESCE(approval.reason_code, 'legacy_reason'),
    reason_ref = COALESCE(approval.reason_ref, 'ref:legacy-approval:' || approval.id),
    scope = CASE WHEN approval.scope = '{}'::jsonb THEN jsonb_strip_nulls(jsonb_build_object(
      'organization_id', deployment.organization_id,
      'agent_id', deployment.agent_id,
      'server_id', deployment.server_id,
      'deployment_id', deployment.id
    )) ELSE approval.scope END
FROM control_commands command
JOIN control_deployments deployment ON deployment.id = command.deployment_id
WHERE approval.command_id = command.id;

ALTER TABLE release_manifests
  ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'prerelease',
  ADD COLUMN IF NOT EXISTS contracts_version text NOT NULL DEFAULT '2.2.1',
  ADD COLUMN IF NOT EXISTS immutable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sbom_ref text,
  ADD COLUMN IF NOT EXISTS provenance_ref text,
  ADD COLUMN IF NOT EXISTS attestation_ref text,
  ADD COLUMN IF NOT EXISTS migration_ref text,
  ADD COLUMN IF NOT EXISTS release_notes_ref text;

UPDATE release_manifests
SET artifacts = CASE WHEN artifacts = '[]'::jsonb THEN jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'component', 'agent',
      'version', version,
      'ref', 'ref:release-artifact:' || id,
      'digest', split_part(image_digest, '@', 2),
      'sbom_ref', 'ref:sbom:' || id,
      'provenance_ref', 'ref:provenance:' || id
    ))) ELSE artifacts END,
    sbom_ref = COALESCE(sbom_ref, 'ref:sbom:' || id),
    provenance_ref = COALESCE(provenance_ref, 'ref:provenance:' || id),
    attestation_ref = COALESCE(attestation_ref, 'ref:attestation:' || id),
    migration_ref = COALESCE(migration_ref, CASE WHEN migration_version IS NULL THEN NULL ELSE 'ref:migration:' || id END);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'release_manifests_channel_check') THEN
    ALTER TABLE release_manifests ADD CONSTRAINT release_manifests_channel_check
      CHECK (channel IN ('stable', 'prerelease', 'canary'));
  END IF;
END $$;

ALTER TABLE control_commands DROP CONSTRAINT IF EXISTS control_commands_state_check;
ALTER TABLE control_commands
  ADD CONSTRAINT control_commands_state_check CHECK (state IN (
    'queued', 'leased', 'accepted', 'running', 'verifying',
    'succeeded', 'failed', 'cancelled', 'expired'
  )),
  ADD COLUMN IF NOT EXISTS secret_refs text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS verification_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS completion_candidate_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'control_commands_verification_state_check') THEN
    ALTER TABLE control_commands ADD CONSTRAINT control_commands_verification_state_check
      CHECK (verification_state IN ('pending', 'checking', 'verified', 'failed', 'stale', 'blocked'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'control_commands_secret_refs_check') THEN
    ALTER TABLE control_commands ADD CONSTRAINT control_commands_secret_refs_check
      CHECK (bairui_secret_refs_are_opaque(secret_refs)) NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS control_secret_references (
  id text PRIMARY KEY CHECK (id ~ '^sr_[A-Za-z0-9_-]{16,128}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deployment_id text REFERENCES control_deployments(id) ON DELETE CASCADE,
  agent_id text REFERENCES agents(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose ~ '^[a-z][a-z0-9._-]{0,63}$'),
  version bigint NOT NULL CHECK (version > 0),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('pending', 'active', 'rotating', 'revoked', 'expired')),
  masked text NOT NULL CHECK (length(masked) BETWEEN 4 AND 64),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  authorized_identity text,
  last_verified_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, agent_id, purpose, version),
  UNIQUE (organization_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS control_command_leases (
  id text PRIMARY KEY,
  command_id text NOT NULL REFERENCES control_commands(id) ON DELETE CASCADE,
  deployment_id text NOT NULL REFERENCES control_deployments(id) ON DELETE CASCADE,
  server_id text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'consumed', 'expired', 'revoked')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > issued_at),
  CHECK ((state = 'consumed') = (consumed_at IS NOT NULL)),
  UNIQUE (command_id, attempt)
);

ALTER TABLE command_receipts DROP CONSTRAINT IF EXISTS command_receipts_state_check;
ALTER TABLE command_receipts
  ADD CONSTRAINT command_receipts_state_check CHECK (state IN (
    'accepted', 'running', 'executing', 'completion_candidate',
    'succeeded', 'failed', 'cancelled', 'expired'
  )),
  ADD COLUMN IF NOT EXISTS lease_id text REFERENCES control_command_leases(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS event_sequence bigint,
  ADD COLUMN IF NOT EXISTS observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS result_ref text,
  ADD COLUMN IF NOT EXISTS endpoint_ref text,
  ADD COLUMN IF NOT EXISTS source_identity text,
  ADD COLUMN IF NOT EXISTS observation_version bigint CHECK (observation_version IS NULL OR observation_version > 0),
  ADD COLUMN IF NOT EXISTS error_ref text,
  ADD COLUMN IF NOT EXISTS completion_candidate boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS command_verifications (
  id text PRIMARY KEY,
  command_id text NOT NULL REFERENCES control_commands(id) ON DELETE CASCADE,
  deployment_id text NOT NULL REFERENCES control_deployments(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  receipt_id text NOT NULL REFERENCES command_receipts(id) ON DELETE RESTRICT,
  observation_id text REFERENCES observations(id) ON DELETE RESTRICT,
  expected_observation_version bigint NOT NULL CHECK (expected_observation_version >= 0),
  observation_version bigint CHECK (observation_version IS NULL OR observation_version > 0),
  status text NOT NULL DEFAULT 'checking' CHECK (status IN ('pending', 'checking', 'verified', 'failed', 'stale', 'blocked')),
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs text[] NOT NULL DEFAULT ARRAY[]::text[],
  verified_by text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (command_id, attempt)
);

ALTER TABLE control_outbox
  ADD COLUMN IF NOT EXISTS organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS deployment_id text REFERENCES control_deployments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS event_id text REFERENCES control_events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS lease_token_hash text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE control_outbox
SET state = CASE WHEN published_at IS NULL THEN 'pending' ELSE 'published' END,
    idempotency_key = COALESCE(idempotency_key, 'legacy:' || id),
    updated_at = COALESCE(updated_at, created_at);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'control_outbox_state_check') THEN
    ALTER TABLE control_outbox ADD CONSTRAINT control_outbox_state_check
      CHECK (state IN ('pending', 'processing', 'retry', 'published', 'dead_letter'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'control_outbox_max_attempts_check') THEN
    ALTER TABLE control_outbox ADD CONSTRAINT control_outbox_max_attempts_check
      CHECK (max_attempts BETWEEN 1 AND 100);
  END IF;
END $$;

ALTER TABLE control_dead_letters
  ADD COLUMN IF NOT EXISTS organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS deployment_id text REFERENCES control_deployments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS evidence_refs text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE TABLE IF NOT EXISTS control_idempotency_records (
  id text PRIMARY KEY,
  namespace text NOT NULL CHECK (namespace ~ '^[a-z][a-z0-9._-]{0,63}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deployment_id text REFERENCES control_deployments(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('processing', 'completed', 'failed')),
  result_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  UNIQUE (namespace, organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS control_audit_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deployment_id text REFERENCES control_deployments(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence > 0),
  actor_identity text,
  action text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  redaction_status text NOT NULL DEFAULT 'redacted' CHECK (redaction_status IN ('redacted', 'blocked')),
  previous_hash text,
  event_hash text NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sequence),
  UNIQUE (organization_id, event_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS desired_states_active_idx
  ON desired_states (deployment_id) WHERE lifecycle_status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS desired_states_idempotency_idx
  ON desired_states (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS observations_idempotency_idx
  ON observations (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS control_events_idempotency_idx
  ON control_events (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS control_approvals_idempotency_idx
  ON control_approvals (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS control_command_leases_one_active_idx
  ON control_command_leases (command_id) WHERE state = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS command_receipts_idempotency_idx
  ON command_receipts (command_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS control_outbox_idempotency_idx
  ON control_outbox (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS control_outbox_authority_ready_idx
  ON control_outbox (state, available_at, attempts, created_at)
  WHERE state IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS control_audit_replay_idx
  ON control_audit_events (organization_id, sequence);
CREATE INDEX IF NOT EXISTS control_observations_freshness_idx
  ON observations (deployment_id, observed_at DESC, version DESC);

CREATE OR REPLACE FUNCTION bairui_prepare_desired_state_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  deployment_scope record;
BEGIN
  SELECT organization_id, agent_id, server_id
  INTO deployment_scope
  FROM control_deployments
  WHERE id = NEW.deployment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DesiredState deployment does not exist'
      USING ERRCODE = '23503';
  END IF;

  NEW.organization_id := COALESCE(NEW.organization_id, deployment_scope.organization_id);
  NEW.agent_id := COALESCE(NEW.agent_id, deployment_scope.agent_id);
  NEW.server_id := COALESCE(NEW.server_id, deployment_scope.server_id);
  NEW.request_id := COALESCE(NEW.request_id, 'legacy:' || NEW.id);
  NEW.correlation_id := COALESCE(NEW.correlation_id, NEW.request_id);
  NEW.idempotency_key := COALESCE(NEW.idempotency_key, 'legacy:' || NEW.id);
  NEW.sequence := COALESCE(NEW.sequence, NEW.version);
  NEW.valid_from := COALESCE(NEW.valid_from, NEW.created_at, now());
  NEW.updated_at := COALESCE(NEW.updated_at, NEW.created_at, now());

  IF NEW.lifecycle_status = 'active' THEN
    UPDATE desired_states
    SET lifecycle_status = 'superseded', updated_at = now()
    WHERE deployment_id = NEW.deployment_id AND lifecycle_status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS desired_states_prepare_revision ON desired_states;
CREATE TRIGGER desired_states_prepare_revision
  BEFORE INSERT ON desired_states
  FOR EACH ROW EXECUTE FUNCTION bairui_prepare_desired_state_revision();

DROP TRIGGER IF EXISTS desired_states_safe_payload ON desired_states;
CREATE TRIGGER desired_states_safe_payload
  BEFORE INSERT OR UPDATE OF module_versions, modules ON desired_states
  FOR EACH ROW EXECUTE FUNCTION bairui_reject_unsafe_control_json('module_versions', 'modules');

DROP TRIGGER IF EXISTS observations_safe_payload ON observations;
CREATE TRIGGER observations_safe_payload
  BEFORE INSERT OR UPDATE OF summary, modules ON observations
  FOR EACH ROW EXECUTE FUNCTION bairui_reject_unsafe_control_json('summary', 'modules');

DROP TRIGGER IF EXISTS control_commands_safe_payload ON control_commands;
CREATE TRIGGER control_commands_safe_payload
  BEFORE INSERT OR UPDATE OF arguments ON control_commands
  FOR EACH ROW EXECUTE FUNCTION bairui_reject_unsafe_control_json('arguments');

DROP TRIGGER IF EXISTS command_receipts_safe_payload ON command_receipts;
CREATE TRIGGER command_receipts_safe_payload
  BEFORE INSERT OR UPDATE OF result_summary ON command_receipts
  FOR EACH ROW EXECUTE FUNCTION bairui_reject_unsafe_control_json('result_summary');

DROP TRIGGER IF EXISTS control_approvals_safe_payload ON control_approvals;
CREATE TRIGGER control_approvals_safe_payload
  BEFORE INSERT OR UPDATE OF scope ON control_approvals
  FOR EACH ROW EXECUTE FUNCTION bairui_reject_unsafe_control_json('scope');

DROP TRIGGER IF EXISTS control_events_safe_payload ON control_events;
CREATE TRIGGER control_events_safe_payload
  BEFORE INSERT OR UPDATE OF summary ON control_events
  FOR EACH ROW EXECUTE FUNCTION bairui_reject_unsafe_control_json('summary');

DROP TRIGGER IF EXISTS release_manifests_safe_payload ON release_manifests;
CREATE TRIGGER release_manifests_safe_payload
  BEFORE INSERT OR UPDATE OF artifacts, compatibility ON release_manifests
  FOR EACH ROW EXECUTE FUNCTION bairui_reject_unsafe_control_json('artifacts', 'compatibility');

DROP TRIGGER IF EXISTS control_outbox_safe_payload ON control_outbox;
CREATE TRIGGER control_outbox_safe_payload
  BEFORE INSERT OR UPDATE OF body ON control_outbox
  FOR EACH ROW EXECUTE FUNCTION bairui_reject_unsafe_control_json('body');

DROP TRIGGER IF EXISTS control_dead_letters_safe_payload ON control_dead_letters;
CREATE TRIGGER control_dead_letters_safe_payload
  BEFORE INSERT OR UPDATE OF body ON control_dead_letters
  FOR EACH ROW EXECUTE FUNCTION bairui_reject_unsafe_control_json('body');

DROP TRIGGER IF EXISTS command_verifications_safe_payload ON command_verifications;
CREATE TRIGGER command_verifications_safe_payload
  BEFORE INSERT OR UPDATE OF checks ON command_verifications
  FOR EACH ROW EXECUTE FUNCTION bairui_reject_unsafe_control_json('checks');

DROP TRIGGER IF EXISTS control_audit_events_safe_payload ON control_audit_events;
CREATE TRIGGER control_audit_events_safe_payload
  BEFORE INSERT OR UPDATE OF metadata ON control_audit_events
  FOR EACH ROW EXECUTE FUNCTION bairui_reject_unsafe_control_json('metadata');

COMMIT;
