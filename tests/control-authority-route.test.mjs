import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { validateControlError } from "@bairui/contracts";
import { createPlatformServer } from "../apps/web/app.mjs";
import { MemoryPlatformRepository } from "../packages/db/memory-repository.mjs";
import { deriveMachineKey } from "../packages/security/machine-request.mjs";
import { signControlMutation } from "../packages/security/control-mutation.mjs";
import { leaseControlCommands, sendCommandReceipt, signedMachinePost } from "../server-agent/control-client.mjs";
import { CONTROL_SCOPE, CONTROL_TOKEN, canonicalClientOptions, canonicalLease } from "./helpers/control-envelopes.mjs";

const bailongmaUi = Object.freeze({ version: "test", render: () => "", readAsset: () => null });

async function setup(controlAuthority) {
  const repository = new MemoryPlatformRepository();
  await repository.createOrganization({ id: CONTROL_SCOPE.organizationId, name: "Organization A" });
  await repository.createServer({ id: CONTROL_SCOPE.serverId, organizationId: CONTROL_SCOPE.organizationId, name: "Server A", status: "healthy" });
  await repository.createServerCredential({
    serverId: CONTROL_SCOPE.serverId,
    keyHash: deriveMachineKey(CONTROL_TOKEN),
    keyHint: CONTROL_TOKEN.slice(-4),
    createdBy: "test"
  });
  const server = createPlatformServer({
    repository,
    controlAuthority,
    sessionSecret: "control-route-session-secret-at-least-32-characters",
    secureCookies: false,
    bailongmaUi,
    styles: "",
    logo: Buffer.from("logo"),
    icon: Buffer.from("icon"),
    loginScript: "",
    adminScript: "",
    bailongmaOverlayCss: "",
    bailongmaOverlayScript: "",
    bairuiWorkspaceScript: "",
    bairuiWorkspaceConversationsScript: "",
    bairuiWorkspaceAgentsScript: "",
    bairuiWorkspaceChannelsScript: "",
    bairuiWorkspaceHotspotsScript: "",
    bairuiWorkspaceUsageScript: "",
    bairuiWorkspaceMemoryScript: "",
    bairuiWorkspaceSkillsScript: "",
    bailongmaSceneBootstrap: "export function bootstrapScene() {}",
    logger: { error() {} }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function closeTestServer(server) {
  server.closeAllConnections?.();
  server.closeIdleConnections?.();
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("canonical control routes delegate only validated envelopes to the injected Authority", async (t) => {
  const calls = { leases: [], receipts: [] };
  const context = await setup({
    async leaseCommands(request) { calls.leases.push(request); return canonicalLease(request).commands; },
    async recordReceipt(receipt) { calls.receipts.push(receipt); }
  });
  t.after(() => context.server.close());
  const options = canonicalClientOptions({ platformUrl: context.baseUrl });
  const lease = await leaseControlCommands(options);
  assert.equal(calls.leases.length, 1);
  await sendCommandReceipt({ ...options, lease, command: lease.commands[0], state: "accepted", eventSequence: 1 });
  assert.equal(calls.receipts.length, 1);
  assert.equal(calls.receipts[0].state, "accepted");
  assert.equal(calls.receipts[0].lease_token, lease.commands[0].lease_token);
});

test("canonical control routes fail closed while C00-03 Authority is absent", async (t) => {
  const context = await setup(undefined);
  t.after(() => context.server.close());
  await assert.rejects(() => leaseControlCommands(canonicalClientOptions({ platformUrl: context.baseUrl })), { code: "verification_failed", statusCode: 503 });
});

test("legacy command lease and receipt paths are not duplicate Authority entries", async (t) => {
  const calls = { leases: 0, receipts: 0 };
  const context = await setup({
    async leaseCommands() { calls.leases += 1; return []; },
    async recordReceipt() { calls.receipts += 1; }
  });
  t.after(() => context.server.close());
  for (const path of [
    "/api/internal/control-plane/commands/lease",
    "/api/internal/control-plane/commands/receipts",
    "/api/internal/control-plane/commands/command_a/receipts"
  ]) {
    const response = await signedMachinePost({
      platformUrl: context.baseUrl,
      machineId: CONTROL_SCOPE.serverId,
      token: CONTROL_TOKEN,
      path,
      payload: {}
    });
    assert.equal(response.status, 404, path);
  }
  assert.deepEqual(calls, { leases: 0, receipts: 0 });
});

test("canonical route requires both transport HMAC and the embedded mutation signature", async (t) => {
  const context = await setup({ async leaseCommands(request) { return canonicalLease(request); }, async recordReceipt() {} });
  t.after(() => context.server.close());
  const now = new Date().toISOString();
  const request = signControlMutation({
    schema_version: "1.0",
    organization_id: CONTROL_SCOPE.organizationId,
    user_id: CONTROL_SCOPE.userId,
    agent_id: CONTROL_SCOPE.agentId,
    server_id: CONTROL_SCOPE.serverId,
    request_id: "request_wrong_signature",
    correlation_id: "correlation_wrong_signature",
    idempotency_key: "idempotency_wrong_signature",
    created_at: now,
    revision: 1,
    sequence: 1,
    limit: 1,
    lease_seconds: 60,
    requested_at: now
  }, { token: `${CONTROL_TOKEN}-wrong`, keyId: CONTROL_SCOPE.serverId, signedAt: now });
  const response = await signedMachinePost({
    platformUrl: context.baseUrl,
    machineId: CONTROL_SCOPE.serverId,
    token: CONTROL_TOKEN,
    path: "/api/internal/control-plane/leases",
    payload: request
  });
  assert.equal(response.status, 401);
  assert.equal(validateControlError(await response.json()).error_code, "invalid_signature");
});

test("Platform refuses Authority leases containing raw configuration or quarantined actions", async (t) => {
  for (const leaseOptions of [
    { extraCommand: { config: { document: { model: "secret" } } } },
    { extraCommand: { approval_id: "approval_unexpected" } },
    { action: "config.apply-user", arguments: { config_revision_id: "config_a" } }
  ]) {
    const context = await setup({ async leaseCommands(request) { return canonicalLease(request, leaseOptions); }, async recordReceipt() {} });
    await assert.rejects(() => leaseControlCommands(canonicalClientOptions({ platformUrl: context.baseUrl })), { code: "verification_failed", statusCode: 502 });
    await closeTestServer(context.server);
  }
});
