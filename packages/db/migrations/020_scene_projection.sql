BEGIN;

CREATE TABLE IF NOT EXISTS agent_scenes (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  scene_id text NOT NULL CHECK (scene_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  view jsonb NOT NULL DEFAULT '{"surfaces":[]}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, scene_id),
  FOREIGN KEY (agent_id, organization_id, user_id)
    REFERENCES agents(id, organization_id, owner_user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_scene_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  scene_id text NOT NULL,
  base_revision bigint NOT NULL CHECK (base_revision >= 0),
  revision bigint NOT NULL CHECK (revision > base_revision),
  operations jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, scene_id, revision),
  FOREIGN KEY (agent_id, scene_id)
    REFERENCES agent_scenes(agent_id, scene_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS agent_scene_events_replay_idx
  ON agent_scene_events (agent_id, scene_id, revision);

COMMIT;
