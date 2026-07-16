# Hermes and Obsidian Memory

PostgreSQL is the canonical memory authority for every user Agent. Each record
is an Obsidian-compatible Markdown note with tenant, user, and Agent ownership.
BaiLongma and Hermes consume projections; neither becomes the system of record.

## Projection flow

```text
PostgreSQL obsidian_notes
  -> transactional memory_projection_outbox
  -> background Memory Projection Worker
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

Every note create, update, and delete writes or coalesces a
`memory_projection_outbox` record in the same PostgreSQL transaction. The HTTP
request returns after the durable commit. A background worker leases jobs with
`FOR UPDATE SKIP LOCKED`, applies the latest complete Agent projection, and
records only status, counts, projection id, attempts, and a normalized error
code. Outbox rows never contain note Markdown.

Failed jobs use bounded exponential retry and an expiring lease. A newer write
supersedes an older failed lease without losing the new request. Exhausted jobs
move to `dead`, affected pending notes become `failed`, and a later edit or
manual retry creates a fresh job. Note revisions are compared when completion
is recorded so an edit made during projection remains `pending` instead of
being falsely marked synchronized.

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

The browser may display status or request a manual requeue, but it never
performs reliable synchronization. Closing the page, losing a browser network
connection, or refreshing BaiLongma does not affect queued work.

The administrator overview receives only queued and dead job counts within
its authorized organization scope. It does not receive note ids, titles,
Markdown, projection entries, or Hermes memory content.

The BaiLongma upstream remains unmodified and pinned as a Git submodule. A
deterministic build step copies the UI into a separate artifact, applies the
Brain graph and explicit host-adapter patches, and records hashes in
.bairui-build.json. The runtime verifies those hashes and serves only the
artifact; it never rewrites source per request. The build fails closed when an
upstream anchor changes. Obsidian wikilinks and Agent-root relationships are
rendered first; visual fallback links are used only when no semantic
relationship exists.
