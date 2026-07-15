BEGIN;

CREATE TABLE IF NOT EXISTS provider_configurations (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  base_url text NOT NULL,
  model text NOT NULL,
  api_key_envelope jsonb,
  key_hint text,
  apply_status text NOT NULL DEFAULT 'pending' CHECK (apply_status IN ('pending', 'applied', 'failed')),
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_runs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  capability text NOT NULL,
  status text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hotspot_items (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES integration_runs(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  source_id text NOT NULL,
  source_name text NOT NULL,
  rank integer NOT NULL,
  title text NOT NULL,
  url text NOT NULL DEFAULT '',
  mobile_url text NOT NULL DEFAULT '',
  heat text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  fetched_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, run_id, source_id, external_id)
);

CREATE TABLE IF NOT EXISTS obsidian_notes (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  slug text NOT NULL,
  markdown text NOT NULL,
  frontmatter jsonb NOT NULL DEFAULT '{}'::jsonb,
  wikilinks text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, slug)
);

CREATE INDEX IF NOT EXISTS integration_runs_org_idx ON integration_runs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hotspot_items_latest_idx ON hotspot_items (organization_id, fetched_at DESC, source_id, rank);
CREATE INDEX IF NOT EXISTS obsidian_notes_owner_idx ON obsidian_notes (organization_id, user_id, updated_at DESC);

COMMIT;
