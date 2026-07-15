BEGIN;

ALTER TABLE obsidian_notes
  ADD COLUMN IF NOT EXISTS agent_id text REFERENCES agents(id) ON DELETE CASCADE;

UPDATE obsidian_notes note
SET agent_id = (
  SELECT id FROM agents
  WHERE agents.organization_id=note.organization_id AND agents.owner_user_id=note.user_id
  ORDER BY agents.created_at
  LIMIT 1
)
WHERE note.agent_id IS NULL;

ALTER TABLE obsidian_notes
  DROP CONSTRAINT IF EXISTS obsidian_notes_organization_id_user_id_slug_key;

CREATE UNIQUE INDEX IF NOT EXISTS obsidian_notes_agent_slug_idx ON obsidian_notes (organization_id, user_id, agent_id, slug) WHERE agent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agents_tenant_owner_idx ON agents (id, organization_id, owner_user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'obsidian_notes_agent_owner_fkey') THEN
    ALTER TABLE obsidian_notes ADD CONSTRAINT obsidian_notes_agent_owner_fkey
      FOREIGN KEY (agent_id, organization_id, user_id)
      REFERENCES agents(id, organization_id, owner_user_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agent_skill_preferences (
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  apply_status text NOT NULL DEFAULT 'pending' CHECK (apply_status IN ('pending', 'applied', 'failed', 'unavailable')),
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, skill_id)
);

CREATE TABLE IF NOT EXISTS agent_channel_bindings (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('web', 'cli', 'feishu', 'wechat', 'qq')),
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('unconfigured', 'pending', 'connected', 'degraded', 'error', 'disabled', 'unavailable')),
  credential_envelope jsonb,
  credential_hint text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error_code text,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, channel)
);

CREATE TABLE IF NOT EXISTS agent_hotspot_bookmarks (
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hotspot_item_id text NOT NULL REFERENCES hotspot_items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, hotspot_item_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_skill_preferences_owner_fkey') THEN
    ALTER TABLE agent_skill_preferences ADD CONSTRAINT agent_skill_preferences_owner_fkey
      FOREIGN KEY (agent_id, organization_id, user_id)
      REFERENCES agents(id, organization_id, owner_user_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_channel_bindings_owner_fkey') THEN
    ALTER TABLE agent_channel_bindings ADD CONSTRAINT agent_channel_bindings_owner_fkey
      FOREIGN KEY (agent_id, organization_id, user_id)
      REFERENCES agents(id, organization_id, owner_user_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_hotspot_bookmarks_owner_fkey') THEN
    ALTER TABLE agent_hotspot_bookmarks ADD CONSTRAINT agent_hotspot_bookmarks_owner_fkey
      FOREIGN KEY (agent_id, organization_id, user_id)
      REFERENCES agents(id, organization_id, owner_user_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS obsidian_notes_agent_idx ON obsidian_notes (agent_id, updated_at DESC) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS skill_preferences_user_idx ON agent_skill_preferences (organization_id, user_id, agent_id);
CREATE INDEX IF NOT EXISTS channel_bindings_status_idx ON agent_channel_bindings (organization_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS hotspot_bookmarks_user_idx ON agent_hotspot_bookmarks (organization_id, user_id, created_at DESC);

COMMIT;
