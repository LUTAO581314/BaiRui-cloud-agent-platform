BEGIN;

ALTER TABLE obsidian_notes
  ADD COLUMN IF NOT EXISTS memory_kind text NOT NULL DEFAULT 'knowledge',
  ADD COLUMN IF NOT EXISTS importance smallint NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS hermes_target text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS source_ref text NOT NULL DEFAULT 'bairui-user',
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS hermes_sync_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS hermes_synced_revision integer,
  ADD COLUMN IF NOT EXISTS hermes_synced_at timestamptz;

ALTER TABLE obsidian_notes DROP CONSTRAINT IF EXISTS obsidian_notes_memory_kind_check;
ALTER TABLE obsidian_notes ADD CONSTRAINT obsidian_notes_memory_kind_check
  CHECK (memory_kind IN ('knowledge','fact','preference','constraint','procedure','person','project','event'));
ALTER TABLE obsidian_notes DROP CONSTRAINT IF EXISTS obsidian_notes_importance_check;
ALTER TABLE obsidian_notes ADD CONSTRAINT obsidian_notes_importance_check CHECK (importance BETWEEN 1 AND 5);
ALTER TABLE obsidian_notes DROP CONSTRAINT IF EXISTS obsidian_notes_hermes_target_check;
ALTER TABLE obsidian_notes ADD CONSTRAINT obsidian_notes_hermes_target_check CHECK (hermes_target IN ('auto','memory','user','none'));
ALTER TABLE obsidian_notes DROP CONSTRAINT IF EXISTS obsidian_notes_hermes_sync_status_check;
ALTER TABLE obsidian_notes ADD CONSTRAINT obsidian_notes_hermes_sync_status_check
  CHECK (hermes_sync_status IN ('pending','materialized','excluded','conflict','failed'));

CREATE INDEX IF NOT EXISTS obsidian_notes_projection_idx
  ON obsidian_notes (agent_id, hermes_sync_status, importance DESC, updated_at DESC)
  WHERE agent_id IS NOT NULL;

COMMIT;
