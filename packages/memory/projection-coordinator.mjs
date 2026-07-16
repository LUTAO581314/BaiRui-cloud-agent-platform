import { buildHermesMemoryProjection, createObsidianNote } from "./obsidian-note.mjs";

function projectionPrincipal(job) {
  return { organizationId: job.organizationId, userId: job.userId, role: "user" };
}

export async function synchronizeAgentMemory(options) {
  const { repository, runtimeClient, job } = options;
  if (!runtimeClient) throw Object.assign(new Error("Runtime is unavailable"), { code: "runtime_unavailable", statusCode: 503 });
  const agent = await repository.getAgent(job.agentId);
  if (!agent || agent.organizationId !== job.organizationId || agent.ownerUserId !== job.userId) throw Object.assign(new Error("Agent ownership changed"), { code: "memory_projection_owner_mismatch", statusCode: 409 });
  const principal = projectionPrincipal(job);
  const snapshot = await runtimeClient.operation({ principal, agent, operation: "memory.snapshot" });
  const manifest = snapshot.projection && typeof snapshot.projection === "object" ? snapshot.projection : { memory: [], user: [] };
  const conflicts = new Set();
  for (const target of ["memory", "user"]) {
    const currentHashes = new Set((snapshot[target]?.entries ?? []).map((entry) => entry.sha256));
    for (const entry of manifest[target] ?? []) if (!currentHashes.has(entry.sha256)) conflicts.add(entry.note_id);
  }

  let notes = await repository.listObsidianNotes(job.organizationId, job.userId, job.agentId);
  const nativeSources = new Set(notes.map((note) => note.sourceRef));
  const projectedHashes = new Set([...(manifest.memory ?? []), ...(manifest.user ?? [])].map((entry) => entry.sha256));
  let imported = 0;
  for (const target of ["memory", "user"]) {
    for (const entry of snapshot[target]?.entries ?? []) {
      if (projectedHashes.has(entry.sha256)) continue;
      const sourceRef = `hermes-native:${target}:${entry.sha256}`;
      if (nativeSources.has(sourceRef)) continue;
      const note = createObsidianNote({
        title: `Hermes ${target} memory ${entry.sha256.slice(0, 8)}`,
        body: entry.content,
        memoryKind: target === "user" ? "preference" : "knowledge",
        importance: 4,
        hermesTarget: target,
        sourceRef
      });
      const importedNote = await repository.createObsidianNote({ ...note, organizationId: job.organizationId, userId: job.userId, agentId: job.agentId, queueProjection: false });
      await repository.recordAudit({ organizationId: job.organizationId, actorUserId: null, action: "memory.hermes.import", targetType: "obsidian_note", targetId: importedNote.id, metadata: { agentId: job.agentId, target, sourceHash: entry.sha256, workerJobId: job.id } });
      nativeSources.add(sourceRef);
      imported += 1;
    }
  }

  notes = await repository.listObsidianNotes(job.organizationId, job.userId, job.agentId);
  const noteRevisions = Object.fromEntries(notes.map((note) => [note.id, note.revision]));
  const projection = buildHermesMemoryProjection(notes, { excludeNoteIds: [...conflicts] });
  const applied = await runtimeClient.operation({ principal, agent, operation: "memory.apply", input: { expected_digest: snapshot.digest, projection } });
  await repository.markObsidianProjection({ organizationId: job.organizationId, userId: job.userId, agentId: job.agentId, includedNoteIds: projection.included_note_ids, conflictNoteIds: [...conflicts], noteRevisions });
  return {
    status: conflicts.size ? "conflict" : "materialized",
    projectionId: projection.projection_id,
    imported,
    conflictCount: conflicts.size,
    memoryNotes: projection.memory.entries.length,
    userNotes: projection.user.entries.length,
    memoryChars: applied.memory?.char_count ?? projection.memory.char_count,
    userChars: applied.user?.char_count ?? projection.user.char_count,
    excluded: projection.excluded_note_ids.length
  };
}
