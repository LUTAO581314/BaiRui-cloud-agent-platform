BEGIN;

ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_agent_id_code_status_key;
WITH ranked_active_alerts AS (
  SELECT id, row_number() OVER (PARTITION BY agent_id, code ORDER BY last_seen_at DESC, first_seen_at DESC, id) AS position
  FROM alerts
  WHERE status IN ('open', 'acknowledged')
)
UPDATE alerts
SET status = 'resolved', resolved_at = COALESCE(resolved_at, now())
FROM ranked_active_alerts
WHERE alerts.id = ranked_active_alerts.id AND ranked_active_alerts.position > 1;
CREATE UNIQUE INDEX IF NOT EXISTS alerts_active_agent_code_idx ON alerts (agent_id, code) WHERE status IN ('open', 'acknowledged');

CREATE TABLE IF NOT EXISTS provider_channels (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  provider text NOT NULL,
  base_url text NOT NULL,
  model text NOT NULL,
  api_key_envelope jsonb,
  key_hint text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'degraded', 'failed', 'disabled')),
  priority integer NOT NULL DEFAULT 100 CHECK (priority >= 0),
  weight integer NOT NULL DEFAULT 1 CHECK (weight > 0),
  max_concurrency integer CHECK (max_concurrency IS NULL OR max_concurrency > 0),
  monthly_budget_usd numeric(20,8) CHECK (monthly_budget_usd IS NULL OR monthly_budget_usd >= 0),
  enabled boolean NOT NULL DEFAULT true,
  last_error_code text,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS model_policies (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  allowed_models jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_model text,
  user_custom_keys_allowed boolean NOT NULL DEFAULT false,
  daily_token_limit bigint CHECK (daily_token_limit IS NULL OR daily_token_limit >= 0),
  monthly_budget_usd numeric(20,8) CHECK (monthly_budget_usd IS NULL OR monthly_budget_usd >= 0),
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS data_retention_policies (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  telemetry_days integer NOT NULL DEFAULT 30 CHECK (telemetry_days > 0),
  usage_days integer NOT NULL DEFAULT 400 CHECK (usage_days > 0),
  audit_days integer NOT NULL DEFAULT 365 CHECK (audit_days > 0),
  sensitive_access_event_days integer NOT NULL DEFAULT 365 CHECK (sensitive_access_event_days > 0),
  backup_days integer NOT NULL DEFAULT 30 CHECK (backup_days > 0),
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sensitive_access_grants (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grantee_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission = 'conversation_content_read'),
  scope text NOT NULL CHECK (scope IN ('organization', 'user', 'agent', 'session')),
  target_id text,
  reason text NOT NULL,
  granted_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sensitive_access_events (
  id text PRIMARY KEY,
  grant_id text NOT NULL REFERENCES sensitive_access_grants(id) ON DELETE RESTRICT,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_type text NOT NULL,
  target_id text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_channels_status_idx ON provider_channels (organization_id, enabled, status, priority);
CREATE INDEX IF NOT EXISTS sensitive_grants_active_idx ON sensitive_access_grants (organization_id, grantee_user_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS sensitive_access_events_org_idx ON sensitive_access_events (organization_id, created_at DESC);

COMMIT;
