import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresPlatformRepository } from "../packages/db/postgres-repository.mjs";

test("PostgreSQL leases and completes an Agent provision transaction", { skip: process.env.BAIRUI_POSTGRES_INTEGRATION !== "1" }, async () => {
  const repository = new PostgresPlatformRepository({ connectionString: process.env.DATABASE_URL });
  const suffix = randomUUID().slice(0, 8);
  const organizationId = `org_pg_${suffix}`;
  const userId = `user_pg_${suffix}`;
  const agentId = `agent_pg_${suffix}`;
  const runtimeId = `runtime_pg_${suffix}`;
  const serverId = `server_pg_${suffix}`;
  try {
    await repository.createOrganization({ id: organizationId, name: "PostgreSQL Control Test" });
    await repository.createUser({ id: userId, organizationId, email: `${suffix}@postgres.test`, displayName: "Postgres User", passwordHash: "not-used", role: "user" });
    await repository.createAgent({ id: agentId, organizationId, ownerUserId: userId, name: "Postgres Agent" });
    await repository.createAgentRuntime({ id: runtimeId, organizationId, ownerUserId: userId, agentId, workspaceRef: `workspace:${agentId}` });
    await repository.createServer({ id: serverId, organizationId, name: "Postgres Host", status: "healthy" });
    await repository.createServerCredential({ id: `server_cred_${suffix}`, serverId, keyHash: "a".repeat(64), keyHint: "test", createdBy: userId });
    assert.equal(await repository.claimMachineNonce({ credentialType: "server", credentialId: `server_cred_${suffix}`, nonce: `nonce_${suffix}_1234567890`, timestampMs: Date.now(), expiresAt: new Date(Date.now() + 600_000).toISOString() }), true);
    assert.equal(await repository.claimMachineNonce({ credentialType: "server", credentialId: `server_cred_${suffix}`, nonce: `nonce_${suffix}_1234567890`, timestampMs: Date.now(), expiresAt: new Date(Date.now() + 600_000).toISOString() }), false);
    const provision = await repository.requestAgentProvisioning({ agentId, requestedBy: userId, provider: { provider: "compatible", baseUrl: "https://models.example.test/v1", model: "example/model" }, secretEnvelope: { providerApiKey: { encrypted: true }, runtimeSharedSecret: { encrypted: true }, hermesApiServerKey: { encrypted: true }, agentControlToken: { encrypted: true } }, agentCredentialHash: "b".repeat(64), agentCredentialHint: "test" });
    assert.equal(provision.command.action, "deployment.provision");
    const commands = await repository.leaseControlCommands({ serverId, limit: 5, leaseSeconds: 120 });
    assert.equal(commands.length, 1);
    assert.equal(commands[0].config.document.agent.id, agentId);
    assert.deepEqual(commands[0].config.secret_envelope.runtimeSharedSecret, { encrypted: true });
    const receipt = { commandId: commands[0].command_id, serverId, attempt: commands[0].attempt };
    await repository.recordCommandReceipt({ ...receipt, state: "accepted" });
    await repository.recordCommandReceipt({ ...receipt, state: "running" });
    await repository.recordCommandReceipt({ ...receipt, state: "succeeded", runtimeEndpointRef: "http://127.0.0.1:19123", resultSummary: { containers: 2 } });
    const route = await repository.getAgentRuntimeRoute(agentId);
    assert.equal(route.runtime.endpointRef, "http://127.0.0.1:19123");
    assert.equal(route.runtime.status, "starting");

    const note = await repository.createObsidianNote({ id: `note_${suffix}`, organizationId, userId, agentId, title: "PostgreSQL note", slug: "postgresql-note", markdown: "# PostgreSQL note", frontmatter: { tags: [] }, wikilinks: [] });
    assert.equal(note.agentId, agentId);
    assert.equal((await repository.listObsidianNotes(organizationId, userId, agentId, "PostgreSQL")).length, 1);
    await repository.updateObsidianNote({ ...note, markdown: "# PostgreSQL note\n\nUpdated" });
    assert.match((await repository.getObsidianNote(organizationId, userId, agentId, note.id)).markdown, /Updated/);

    const skill = await repository.upsertAgentSkillPreference({ organizationId, userId, agentId, skillId: "browser/use", enabled: true, applyStatus: "pending" });
    assert.equal(skill.applyStatus, "pending");
    assert.equal((await repository.listAgentSkillPreferences(organizationId, userId, agentId)).length, 1);

    const channel = await repository.upsertAgentChannelBinding({ organizationId, userId, agentId, channel: "feishu", displayName: "Postgres Feishu", status: "pending", credentialEnvelope: { encrypted: true }, credentialHint: "test" });
    assert.deepEqual(channel.credentialEnvelope, { encrypted: true });
    assert.equal((await repository.listAgentChannelBindings(organizationId, userId, agentId)).length, 1);

    await repository.saveIntegrationResult({ organizationId, integrationId: "trendradar", capability: "list_hotspots", status: "completed", startedAt: new Date().toISOString(), items: [{ external_id: "one", source_id: "test", source_name: "Test", rank: 1, title: "Hotspot", fetched_at: new Date().toISOString() }] });
    const hotspot = (await repository.listLatestHotspots(organizationId)).items[0];
    assert.equal(await repository.setAgentHotspotBookmark({ organizationId, userId, agentId, hotspotItemId: hotspot.id, bookmarked: true }), true);
    assert.deepEqual(await repository.listAgentHotspotBookmarkIds(organizationId, userId, agentId), [hotspot.id]);

    await repository.saveAgentHeartbeat({ organizationId, userId, agentId, runtimeId, sequence: 1, status: "healthy", observedAt: new Date().toISOString(), components: [], usage: { bucketStart: "2026-07-16T00:00:00.000Z", bucketSeconds: 3600, model: "example/model", inputTokens: 3, outputTokens: 4, runCount: 1 } });
    const usage = await repository.listUsageRollups(organizationId, userId, agentId);
    assert.equal(usage[0].inputTokens, 3);
    assert.equal(await repository.deleteObsidianNote(organizationId, userId, agentId, note.id), true);
  } finally {
    await repository.pool.query("DELETE FROM organizations WHERE id=$1", [organizationId]).catch(() => {});
    await repository.close();
  }
});
