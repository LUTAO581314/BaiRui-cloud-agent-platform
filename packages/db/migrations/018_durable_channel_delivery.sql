BEGIN;

ALTER TABLE agent_channel_bindings
  ADD COLUMN IF NOT EXISTS connection_generation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS capabilities text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS adapter_version text,
  ADD COLUMN IF NOT EXISTS last_health_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz;

ALTER TABLE agent_channel_bindings DROP CONSTRAINT IF EXISTS agent_channel_bindings_status_check;
ALTER TABLE agent_channel_bindings ADD CONSTRAINT agent_channel_bindings_status_check
  CHECK (status IN ('unconfigured', 'pending', 'connected', 'degraded', 'error', 'disconnected', 'disabled', 'unavailable'));

CREATE TABLE IF NOT EXISTS channel_worker_credentials (
  id text PRIMARY KEY,
  worker_id text NOT NULL,
  organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
  allowed_channels text[] NOT NULL DEFAULT ARRAY['feishu','wechat','qq']::text[],
  key_hash text NOT NULL UNIQUE,
  key_hint text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotating', 'revoked', 'expired')),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE machine_request_nonces DROP CONSTRAINT IF EXISTS machine_request_nonces_credential_type_check;
ALTER TABLE machine_request_nonces ADD CONSTRAINT machine_request_nonces_credential_type_check
  CHECK (credential_type IN ('server', 'agent-runtime', 'channel-worker'));

CREATE UNIQUE INDEX IF NOT EXISTS channel_worker_credentials_one_active_idx
  ON channel_worker_credentials (worker_id) WHERE status='active';

CREATE UNIQUE INDEX IF NOT EXISTS channel_bindings_tenant_identity_idx
  ON agent_channel_bindings (id, organization_id, user_id, agent_id, channel);

CREATE TABLE IF NOT EXISTS channel_conversations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  binding_id text NOT NULL REFERENCES agent_channel_bindings(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('web', 'cli', 'feishu', 'wechat', 'qq')),
  channel_conversation_id text NOT NULL,
  conversation_kind text NOT NULL CHECK (conversation_kind IN ('direct', 'group', 'thread')),
  runtime_conversation_id text NOT NULL,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (binding_id, channel_conversation_id)
);

CREATE TABLE IF NOT EXISTS channel_inbox (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  binding_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('web', 'cli', 'feishu', 'wechat', 'qq')),
  channel_account_id text NOT NULL,
  external_message_id text NOT NULL,
  sender jsonb NOT NULL,
  conversation jsonb NOT NULL,
  content jsonb NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  reply_to_message_id text,
  trace jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'leased', 'retry', 'completed', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token text,
  lease_expires_at timestamptz,
  last_error_code text,
  received_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (binding_id, external_message_id),
  FOREIGN KEY (binding_id, organization_id, user_id, agent_id, channel)
    REFERENCES agent_channel_bindings(id, organization_id, user_id, agent_id, channel) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_outbox (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  binding_id text NOT NULL,
  inbox_id text UNIQUE REFERENCES channel_inbox(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('web', 'cli', 'feishu', 'wechat', 'qq')),
  channel_account_id text NOT NULL,
  conversation jsonb NOT NULL,
  content jsonb NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  reply_to_message_id text,
  trace jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'leased', 'retry', 'delivered', 'failed', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  worker_id text,
  lease_token text,
  lease_expires_at timestamptz,
  channel_message_id text,
  last_error_code text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (binding_id, organization_id, user_id, agent_id, channel)
    REFERENCES agent_channel_bindings(id, organization_id, user_id, agent_id, channel) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_delivery_receipts (
  id text PRIMARY KEY,
  outbound_id text NOT NULL REFERENCES channel_outbox(id) ON DELETE CASCADE,
  binding_id text NOT NULL REFERENCES agent_channel_bindings(id) ON DELETE CASCADE,
  worker_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  status text NOT NULL CHECK (status IN ('delivered', 'retryable', 'failed')),
  channel_message_id text,
  error_code text,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outbound_id, attempt)
);

CREATE TABLE IF NOT EXISTS channel_health_observations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  binding_id text NOT NULL REFERENCES agent_channel_bindings(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('web', 'cli', 'feishu', 'wechat', 'qq')),
  worker_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  status text NOT NULL CHECK (status IN ('pending', 'connected', 'degraded', 'error', 'disconnected', 'disabled')),
  capabilities text[] NOT NULL DEFAULT ARRAY[]::text[],
  adapter_version text,
  latency_ms double precision CHECK (latency_ms IS NULL OR latency_ms >= 0),
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  error_code text,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (binding_id, worker_id, sequence)
);

CREATE TABLE IF NOT EXISTS channel_dead_letters (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  binding_id text NOT NULL REFERENCES agent_channel_bindings(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  source_id text NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  error_code text NOT NULL,
  dead_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (direction, source_id)
);

CREATE INDEX IF NOT EXISTS channel_inbox_lease_idx ON channel_inbox (state, available_at, received_at)
  WHERE state IN ('pending', 'retry', 'leased');
CREATE INDEX IF NOT EXISTS channel_inbox_tenant_idx ON channel_inbox (organization_id, agent_id, received_at DESC);
CREATE INDEX IF NOT EXISTS channel_outbox_lease_idx ON channel_outbox (channel, state, available_at, created_at)
  WHERE state IN ('pending', 'retry', 'leased');
CREATE INDEX IF NOT EXISTS channel_outbox_tenant_idx ON channel_outbox (organization_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS channel_receipts_binding_idx ON channel_delivery_receipts (binding_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS channel_health_binding_idx ON channel_health_observations (binding_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS channel_dead_letters_tenant_idx ON channel_dead_letters (organization_id, agent_id, dead_at DESC);

COMMIT;
