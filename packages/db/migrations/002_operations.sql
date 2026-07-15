BEGIN;

CREATE TABLE IF NOT EXISTS licenses (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  document jsonb NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS servers (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  runtime_version text,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS releases (
  id text PRIMARY KEY,
  version text NOT NULL UNIQUE,
  agent_commit text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'candidate', 'released', 'withdrawn')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS licenses_org_idx ON licenses (organization_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS servers_org_idx ON servers (organization_id, created_at DESC);

COMMIT;
