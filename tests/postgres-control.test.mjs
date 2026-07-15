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
  } finally {
    await repository.pool.query("DELETE FROM organizations WHERE id=$1", [organizationId]).catch(() => {});
    await repository.close();
  }
});
