# Hermes and Obsidian Memory

PostgreSQL is the canonical memory authority for every user Agent. Each record
is an Obsidian-compatible Markdown note with tenant, user, and Agent ownership.
BaiLongma and Hermes consume projections; neither becomes the system of record.

## Projection flow

```text
PostgreSQL obsidian_notes
  -> BaiLongma Brain nodes and wikilink edges
  -> bounded Hermes MEMORY.md and USER.md entries
```

`MEMORY.md` keeps operational facts, project conventions, constraints, and
procedures. `USER.md` keeps user identity and preferences. Notes marked
`hermes_target=none` remain searchable and visible in the Brain graph without
entering the active Hermes prompt. Automatic targeting maps `preference` and
`person` notes to `USER.md`; other kinds map to `MEMORY.md`.

Hermes native limits are authoritative: 2,200 characters for `MEMORY.md` and
1,375 for `USER.md`. Projection sorts by importance and update time. Notes that
do not fit stay in PostgreSQL with `hermes_sync_status=excluded`.

## Synchronization

Memory content travels through the signed Agent data plane, never through the
BaiRui Control Plane. The Runtime exposes only `memory.snapshot` and
`memory.apply` for the current Agent. The Runtime container sees only that
Agent's mounted Hermes `memories/` subdirectory. Runtime cannot read Hermes
configuration, SOUL, sessions, skills, or other workspace files.

Before applying, the platform reads a digest. A changed digest rejects the
write with `memory_projection_conflict`. Hermes-native entries absent from the
previous projection manifest are imported as Obsidian notes. Missing projected
entries are marked `conflict` and excluded until the user reviews them; they are
not silently restored or deleted.

The BaiLongma upstream remains unmodified. The UI adapter transforms the served
Brain graph module and fails closed when its source anchors change. Obsidian
wikilinks and Agent-root relationships are rendered first; visual fallback
links are used only when no semantic relationship exists.
