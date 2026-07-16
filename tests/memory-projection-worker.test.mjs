import test from "node:test";
import assert from "node:assert/strict";
import { MemoryPlatformRepository } from "../packages/db/memory-repository.mjs";
import { createObsidianNote } from "../packages/memory/obsidian-note.mjs";
import { MemoryProjectionWorker } from "../packages/memory/projection-worker.mjs";

async function setup() {
  const repository = new MemoryPlatformRepository();
  await repository.createOrganization({ id: "org_memory", name: "Memory" });
  await repository.createUser({ id: "user_memory", organizationId: "org_memory", email: "memory@example.test", displayName: "Memory", passwordHash: "unused", role: "user" });
  const agent = await repository.createAgent({ id: "agent_memory", organizationId: "org_memory", ownerUserId: "user_memory", name: "Memory Agent" });
  const document = createObsidianNote({ title: "Architecture", body: "PostgreSQL is authoritative.", memoryKind: "project", importance: 5, hermesTarget: "memory" });
  const note = await repository.createObsidianNote({ id: "note_memory", ...document, organizationId: "org_memory", userId: "user_memory", agentId: agent.id });
  return { repository, agent, note };
}

test("memory worker projects queued PostgreSQL notes without a browser request", async () => {
  const { repository, note } = await setup();
  const operations = [];
  const runtimeClient = { operation: async ({ operation, input }) => {
    operations.push({ operation, input });
    if (operation === "memory.snapshot") return { digest: "snapshot_1", projection: { memory: [], user: [] }, memory: { entries: [] }, user: { entries: [] } };
    assert.equal(input.expected_digest, "snapshot_1");
    assert.equal(input.projection.memory.entries[0].note_id, note.id);
    return { memory: { char_count: input.projection.memory.char_count }, user: { char_count: 0 } };
  } };
  const worker = new MemoryProjectionWorker({ repository, runtimeClient, baseRetryMs: 0, logger: { error() {} } });
  const [completed] = await worker.runOnce();
  assert.equal(completed.state, "completed");
  assert.equal(completed.resultSummary.status, "materialized");
  assert.deepEqual(operations.map((item) => item.operation), ["memory.snapshot", "memory.apply"]);
  assert.equal((await repository.getObsidianNote("org_memory", "user_memory", "agent_memory", note.id)).hermesSyncStatus, "materialized");
});

test("memory worker retries bounded failures, records only an error code, and marks dead jobs", async () => {
  const { repository, note } = await setup();
  const logs = [];
  const worker = new MemoryProjectionWorker({
    repository,
    runtimeClient: {},
    project: async () => { throw Object.assign(new Error("secret-memory-body-must-not-leak"), { code: "runtime_offline" }); },
    maxAttempts: 2,
    baseRetryMs: 0,
    logger: { error(message, metadata) { logs.push({ message, metadata }); } }
  });
  assert.equal((await worker.runOnce())[0].state, "retry");
  assert.equal((await worker.runOnce())[0].state, "dead");
  const status = await repository.getMemoryProjectionStatus("org_memory", "user_memory", "agent_memory");
  assert.equal(status.lastErrorCode, "runtime_offline");
  assert.equal((await repository.getObsidianNote("org_memory", "user_memory", "agent_memory", note.id)).hermesSyncStatus, "failed");
  assert.doesNotMatch(JSON.stringify(logs), /secret-memory-body-must-not-leak/);
});

test("outbox coalesces pending writes and preserves a newer write during an active lease", async () => {
  const { repository, note } = await setup();
  const initial = await repository.getMemoryProjectionStatus("org_memory", "user_memory", "agent_memory");
  await repository.updateObsidianNote({ ...note, markdown: `${note.markdown}\nUpdated once` });
  const coalesced = await repository.getMemoryProjectionStatus("org_memory", "user_memory", "agent_memory");
  assert.equal(coalesced.id, initial.id);
  const [leased] = await repository.leaseMemoryProjectionJobs({ limit: 1, leaseSeconds: 30 });
  const current = await repository.getObsidianNote("org_memory", "user_memory", "agent_memory", note.id);
  await repository.updateObsidianNote({ ...current, markdown: `${current.markdown}\nUpdated twice` });
  const superseded = await repository.retryMemoryProjectionJob({ id: leased.id, leaseToken: leased.leaseToken, errorCode: "runtime_offline", maxAttempts: 8, delayMs: 0 });
  assert.equal(superseded.state, "completed");
  assert.equal(superseded.resultSummary.status, "superseded");
  const latest = await repository.getMemoryProjectionStatus("org_memory", "user_memory", "agent_memory");
  assert.notEqual(latest.id, leased.id);
  assert.equal(latest.state, "pending");
});

test("projection completion does not mark a concurrently edited revision as synchronized", async () => {
  const { repository, note } = await setup();
  const originalRevision = note.revision;
  await repository.updateObsidianNote({ ...note, markdown: `${note.markdown}\nConcurrent edit` });
  await repository.markObsidianProjection({ organizationId: "org_memory", userId: "user_memory", agentId: "agent_memory", includedNoteIds: [note.id], conflictNoteIds: [], noteRevisions: { [note.id]: originalRevision } });
  const current = await repository.getObsidianNote("org_memory", "user_memory", "agent_memory", note.id);
  assert.equal(current.revision, originalRevision + 1);
  assert.equal(current.hermesSyncStatus, "pending");
});

test("a fresh queued revision is not marked failed by an older dead job", async () => {
  const { repository, note } = await setup();
  const [leased] = await repository.leaseMemoryProjectionJobs({ limit: 1, leaseSeconds: 30 });
  const dead = await repository.retryMemoryProjectionJob({ id: leased.id, leaseToken: leased.leaseToken, errorCode: "runtime_offline", maxAttempts: 1, delayMs: 0 });
  assert.equal(dead.state, "dead");
  await repository.updateObsidianNote({ ...note, markdown: `${note.markdown}\nFresh revision` });
  await repository.markObsidianProjectionFailed(dead);
  assert.equal((await repository.getObsidianNote("org_memory", "user_memory", "agent_memory", note.id)).hermesSyncStatus, "pending");
});

test("worker cycles contain repository failures without logging exception text", async () => {
  const logs = [];
  const worker = new MemoryProjectionWorker({
    repository: { async leaseMemoryProjectionJobs() { throw Object.assign(new Error("private-database-detail"), { code: "database_unavailable" }); } },
    runtimeClient: {},
    logger: { error(message, metadata) { logs.push({ message, metadata }); } }
  });
  assert.deepEqual(await worker.tick(), []);
  assert.equal(logs[0].metadata.code, "database_unavailable");
  assert.doesNotMatch(JSON.stringify(logs), /private-database-detail/);
});
