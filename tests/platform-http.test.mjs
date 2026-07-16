import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import { createPlatformServer } from "../apps/web/app.mjs";
import { MemoryPlatformRepository } from "../packages/db/memory-repository.mjs";
import { hashPassword } from "../packages/auth/password.mjs";
import { ROLES } from "../packages/auth/authorization.mjs";
import { SecretEnvelope } from "../packages/security/secret-envelope.mjs";
import { signedMachinePost, sendCommandReceipt } from "../server-agent/control-client.mjs";
import { signMachineRequest } from "../packages/security/machine-request.mjs";
import { createBailongmaUi } from "../packages/bailongma-ui/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sessionSecret = "http-test-session-secret-that-is-longer-than-32-characters";
const providerEncryptionKey = "http-test-provider-encryption-key-longer-than-32-characters";
const bailongmaUi = createBailongmaUi({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "upstreams", "bailongma") });

async function setup(options = {}) {
  const repository = new MemoryPlatformRepository();
  await repository.createOrganization({ id: "org_a", name: "Organization A" });
  await repository.createOrganization({ id: "org_b", name: "Organization B" });
  const passwordHash = await hashPassword("Correct-Horse-Battery-Staple-2026");
  const user = await repository.createUser({ id: "user_a", organizationId: "org_a", email: "user@example.test", displayName: "User", passwordHash, role: ROLES.USER });
  const sameOrgUser = await repository.createUser({ id: "user_c", organizationId: "org_a", email: "same-org@example.test", displayName: "Same Org User", passwordHash, role: ROLES.USER });
  const orgAdmin = await repository.createUser({ id: "admin_a", organizationId: "org_a", email: "org-admin@example.test", displayName: "Org Admin", passwordHash, role: ROLES.ORG_ADMIN });
  const otherUser = await repository.createUser({ id: "user_b", organizationId: "org_b", email: "other@example.test", displayName: "Other", passwordHash, role: ROLES.USER });
  const platformAdmin = await repository.createUser({ id: "root", organizationId: "org_a", email: "root@example.test", displayName: "Root", passwordHash, role: ROLES.PLATFORM_ADMIN });
  const agent = await repository.createAgent({ id: "agent_a", organizationId: "org_a", ownerUserId: user.id, name: "Agent" });
  const runtime = await repository.createAgentRuntime({ id: "runtime_a", organizationId: "org_a", ownerUserId: user.id, agentId: agent.id, workspaceRef: "hermes:org_a:user_a:agent_a" });
  const { privateKey } = generateKeyPairSync("ed25519");
  const server = createPlatformServer({ repository, sessionSecret, secureCookies: false, agentIngestToken: "agent-ingest-test-token", licensePrivateKey: privateKey, providerVault: new SecretEnvelope(providerEncryptionKey), styles: "", logo: Buffer.from("logo"), icon: Buffer.from("icon"), loginScript: "login", adminScript: "admin-only", bailongmaUi, bailongmaOverlayCss: "overlay-css", bailongmaOverlayScript: "overlay-script", bairuiWorkspaceScript: "workspace-overlay", bailongmaSceneBootstrap: "export function bootstrapScene() {}", logger: { error() {} }, ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { repository, server, baseUrl, users: { user, sameOrgUser, orgAdmin, otherUser, platformAdmin }, agent, runtime };
}

async function login(baseUrl, email) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Correct-Horse-Battery-Staple-2026" })
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

test("public pages expose the bairui-agent brand assets", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  const loginPage = await fetch(`${context.baseUrl}/login`);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /bairui-agent/);
  const logo = await fetch(`${context.baseUrl}/assets/bairui-agent-logo.png`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get("content-type"), "image/png");
  assert.equal(Buffer.from(await logo.arrayBuffer()).toString(), "logo");
  const icon = await fetch(`${context.baseUrl}/assets/bairui-agent-icon.png`);
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get("content-type"), "image/png");
});

test("anonymous and ordinary users cannot access administrator data", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  assert.equal((await fetch(`${context.baseUrl}/api/admin/overview`)).status, 401);
  const cookie = await login(context.baseUrl, "user@example.test");
  const workspacePage = await fetch(`${context.baseUrl}/app`, { headers: { cookie } });
  assert.equal(workspacePage.status, 200);
  const workspaceHtml = await workspacePage.text();
  assert.match(workspaceHtml, /bairui-agent · Cognitive Surface/);
  assert.match(workspaceHtml, /\/bailongma-ui\/src\/ui\/brain-ui\/app\.js/);
  assert.match(workspaceHtml, /\/assets\/bairui-workspace\.js/);
  assert.doesNotMatch(workspaceHtml, /\/assets\/user\.js/);
  assert.equal((await fetch(`${context.baseUrl}/assets/user.js`, { headers: { cookie } })).status, 404);
  assert.equal(await (await fetch(`${context.baseUrl}/assets/bairui-workspace.js`, { headers: { cookie } })).text(), "workspace-overlay");
  assert.equal((await fetch(`${context.baseUrl}/bailongma-ui/src/ui/brain-ui/app.js`)).status, 401);
  assert.equal((await fetch(`${context.baseUrl}/bailongma-ui/src/ui/brain-ui/app.js`, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${context.baseUrl}/admin`, { headers: { cookie } })).status, 404);
  assert.equal((await fetch(`${context.baseUrl}/admin/assets/admin.js`, { headers: { cookie } })).status, 404);
  assert.equal((await fetch(`${context.baseUrl}/api/admin/overview`, { headers: { cookie } })).status, 403);
});

test("platform and organization administrators receive scoped administration", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  const rootCookie = await login(context.baseUrl, "root@example.test");
  assert.equal((await fetch(`${context.baseUrl}/admin`, { headers: { cookie: rootCookie } })).status, 200);
  assert.equal((await fetch(`${context.baseUrl}/admin/assets/admin.js`, { headers: { cookie: rootCookie } })).status, 200);
  assert.equal((await fetch(`${context.baseUrl}/api/admin/overview`, { headers: { cookie: rootCookie } })).status, 200);

  const orgCookie = await login(context.baseUrl, "org-admin@example.test");
  const crossTenant = await fetch(`${context.baseUrl}/api/admin/users/${context.users.otherUser.id}/role`, {
    method: "PATCH",
    headers: { cookie: orgCookie, "content-type": "application/json" },
    body: JSON.stringify({ role: ROLES.ORG_ADMIN })
  });
  assert.equal(crossTenant.status, 403);
  const escalate = await fetch(`${context.baseUrl}/api/admin/users/${context.users.user.id}/role`, {
    method: "PATCH",
    headers: { cookie: orgCookie, "content-type": "application/json" },
    body: JSON.stringify({ role: ROLES.PLATFORM_ADMIN })
  });
  assert.equal(escalate.status, 403);
});

test("control-plane ingestion requires a separate agent credential", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  const body = JSON.stringify({ organizationId: "org_a", serverId: "server_a", snapshot: { schemaVersion: "1.0", status: "healthy" } });
  assert.equal((await fetch(`${context.baseUrl}/api/internal/control-plane/snapshots`, { method: "POST", headers: { "content-type": "application/json" }, body })).status, 401);
  assert.equal((await fetch(`${context.baseUrl}/api/internal/control-plane/snapshots`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer agent-ingest-test-token" }, body })).status, 202);
});

test("only platform administrators can issue licenses and create releases", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  const orgCookie = await login(context.baseUrl, "org-admin@example.test");
  const licenseBody = JSON.stringify({ organizationId: "org_a", plan: "business", features: ["runtime"], expiresAt: "2030-01-01T00:00:00.000Z" });
  assert.equal((await fetch(`${context.baseUrl}/api/admin/licenses`, { method: "POST", headers: { cookie: orgCookie, "content-type": "application/json" }, body: licenseBody })).status, 403);
  const rootCookie = await login(context.baseUrl, "root@example.test");
  assert.equal((await fetch(`${context.baseUrl}/api/admin/licenses`, { method: "POST", headers: { cookie: rootCookie, "content-type": "application/json" }, body: licenseBody })).status, 201);
  const releaseBody = JSON.stringify({ version: "0.1.0", agentCommit: "a".repeat(40), status: "candidate" });
  assert.equal((await fetch(`${context.baseUrl}/api/admin/releases`, { method: "POST", headers: { cookie: rootCookie, "content-type": "application/json" }, body: releaseBody })).status, 201);
});

test("Agent heartbeat updates the administrator fleet without accepting conversation content", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  const heartbeat = {
    organizationId: "org_a", userId: "user_a", agentId: context.agent.id, runtimeId: context.runtime.id,
    sequence: 1, status: "healthy", runtimeVersion: "hermes-1", boundaryVersion: "0.3.0",
    observedAt: "2026-07-16T00:00:00.000Z", activeRuns: 2, queueDepth: 1,
    components: [{ layer: "core-runtime", moduleId: "hermes", status: "healthy", version: "hermes-1", metrics: { latency_ms: 12 }, prompt: "must-not-be-stored" }],
    events: [{ layer: "core-runtime", componentId: "hermes", eventType: "runtime.health", severity: "info", metrics: { active_runs: 2 }, content: "must-not-be-stored" }],
    usage: { bucketStart: "2026-07-16T00:00:00.000Z", bucketSeconds: 3600, model: "hermes", inputTokens: 10, outputTokens: 20, runCount: 1, failedRunCount: 0, latencySumMs: 12 }
  };
  const accepted = await fetch(`${context.baseUrl}/api/internal/control-plane/heartbeats`, { method: "POST", headers: { authorization: "Bearer agent-ingest-test-token", "content-type": "application/json" }, body: JSON.stringify(heartbeat) });
  assert.equal(accepted.status, 202);
  const rootCookie = await login(context.baseUrl, "root@example.test");
  const fleet = await (await fetch(`${context.baseUrl}/api/admin/agents`, { headers: { cookie: rootCookie } })).json();
  const item = fleet.agents.find((agent) => agent.id === context.agent.id);
  assert.equal(item.runtime.status, "ready");
  assert.equal(item.heartbeat.activeRuns, 2);
  assert.deepEqual(item.components[0].metrics, { latency_ms: 12 });
  assert.doesNotMatch(JSON.stringify(item), /must-not-be-stored/);
  const overview = await (await fetch(`${context.baseUrl}/api/admin/overview`, { headers: { cookie: rootCookie } })).json();
  assert.equal(overview.healthyRuntimes, 1);
});

test("users can create and manage only their own isolated Agents", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  const userCookie = await login(context.baseUrl, "user@example.test");
  const sameOrgCookie = await login(context.baseUrl, "same-org@example.test");

  const before = await (await fetch(`${context.baseUrl}/api/user/agents`, { headers: { cookie: userCookie } })).json();
  assert.deepEqual(before.agents.map((agent) => agent.id), ["agent_a"]);

  const createdResponse = await fetch(`${context.baseUrl}/api/user/agents`, {
    method: "POST",
    headers: { cookie: sameOrgCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "Research Agent", description: "Private workspace", soulMarkdown: "# Identity" })
  });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).agent;
  assert.equal(created.ownerUserId, context.users.sameOrgUser.id);
  assert.equal(created.initializationStatus, "uninitialized");
  assert.equal(created.runtime.status, "uninitialized");
  assert.match(created.runtime.workspaceRef, new RegExp(`${context.users.sameOrgUser.id}:${created.id}$`));

  assert.equal((await fetch(`${context.baseUrl}/api/user/agents/${created.id}`, { headers: { cookie: userCookie } })).status, 404);
  const update = await fetch(`${context.baseUrl}/api/user/agents/${created.id}`, {
    method: "PATCH",
    headers: { cookie: sameOrgCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "Updated Agent" })
  });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).agent.name, "Updated Agent");
});

test("Agent initialization queues a deployment provision command and never reports false readiness", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  await context.repository.upsertProviderConfiguration({ organizationId: "org_a", provider: "compatible", baseUrl: "https://models.example.test/v1", model: "example/model", apiKeyEnvelope: { ciphertext: "encrypted" }, keyHint: "1234", updatedBy: "root" });
  const cookie = await login(context.baseUrl, "user@example.test");
  const noCapacity = await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}/initialize`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
  assert.equal(noCapacity.status, 409);
  assert.equal((await context.repository.getAgent(context.agent.id)).initializationStatus, "uninitialized");

  await context.repository.createServer({ id: "server_capacity", organizationId: "org_a", name: "Runtime host", status: "healthy" });
  const accepted = await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}/initialize`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
  assert.equal(accepted.status, 202);
  const result = await accepted.json();
  assert.equal(result.agent.initializationStatus, "provisioning");
  assert.equal(result.runtime.status, "provisioning");
  assert.equal(result.command.action, "deployment.provision");
  assert.equal(result.command.arguments.agent_id, context.agent.id);
});

test("signed command lease provisions an Agent route and independent heartbeat identity", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  const rootCookie = await login(context.baseUrl, "root@example.test");
  const userCookie = await login(context.baseUrl, "user@example.test");
  const serverResponse = await fetch(`${context.baseUrl}/api/admin/servers`, { method: "POST", headers: { cookie: rootCookie, "content-type": "application/json" }, body: JSON.stringify({ organizationId: "org_a", name: "Agent host" }) });
  assert.equal(serverResponse.status, 201);
  const serverRegistration = await serverResponse.json();
  assert.ok(serverRegistration.credential.token.length >= 32);
  assert.doesNotMatch(JSON.stringify(await context.repository.getActiveServerCredential(serverRegistration.server.id)), new RegExp(serverRegistration.credential.token));
  assert.equal((await fetch(`${context.baseUrl}/api/admin/servers/${serverRegistration.server.id}/credentials`, { method: "POST", headers: { cookie: userCookie, "content-type": "application/json" }, body: "{}" })).status, 403);
  await context.repository.recordServerHeartbeat({ id: serverRegistration.server.id, organizationId: "org_a", status: "healthy", runtimeVersion: "0.3.0" });
  const replayPath = "/api/internal/control-plane/commands/lease";
  const replayBody = JSON.stringify({ serverId: serverRegistration.server.id, limit: 1 });
  const replayTimestamp = Date.now().toString();
  const replayNonce = "fixed_nonce_value_1234567890";
  const replayHeaders = { "content-type": "application/json", "x-bairui-machine-id": serverRegistration.server.id, "x-bairui-timestamp": replayTimestamp, "x-bairui-nonce": replayNonce, "x-bairui-signature": signMachineRequest({ method: "POST", path: replayPath, timestamp: replayTimestamp, nonce: replayNonce, body: replayBody, token: serverRegistration.credential.token }) };
  assert.equal((await fetch(`${context.baseUrl}${replayPath}`, { method: "POST", headers: replayHeaders, body: replayBody })).status, 200);
  assert.equal((await fetch(`${context.baseUrl}${replayPath}`, { method: "POST", headers: replayHeaders, body: replayBody })).status, 401);
  const vault = new SecretEnvelope(providerEncryptionKey);
  await context.repository.upsertProviderConfiguration({ organizationId: "org_a", provider: "compatible", baseUrl: "https://models.example.test/v1", model: "example/model", apiKeyEnvelope: vault.seal("provider-secret-value"), keyHint: "alue", updatedBy: "root" });

  const initialize = await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}/initialize`, { method: "POST", headers: { cookie: userCookie, "content-type": "application/json" }, body: "{}" });
  assert.equal(initialize.status, 202);
  assert.doesNotMatch(await initialize.clone().text(), /provider-secret-value/);

  const leaseResponse = await signedMachinePost({ platformUrl: context.baseUrl, machineId: serverRegistration.server.id, token: serverRegistration.credential.token, path: "/api/internal/control-plane/commands/lease", payload: { serverId: serverRegistration.server.id, limit: 5, leaseSeconds: 120 } });
  assert.equal(leaseResponse.status, 200);
  const leased = (await leaseResponse.json()).commands;
  assert.equal(leased.length, 1);
  const command = leased[0];
  assert.equal(command.action, "deployment.provision");
  assert.equal(command.config.secrets.provider_api_key, "provider-secret-value");
  assert.ok(command.config.secrets.runtime_shared_secret.length >= 32);
  assert.ok(command.config.secrets.agent_control_token.length >= 32);

  const receiptOptions = { platformUrl: context.baseUrl, serverId: serverRegistration.server.id, token: serverRegistration.credential.token, commandId: command.command_id, attempt: command.attempt };
  await sendCommandReceipt({ ...receiptOptions, state: "accepted" });
  await sendCommandReceipt({ ...receiptOptions, state: "running" });
  await assert.rejects(() => sendCommandReceipt({ ...receiptOptions, state: "succeeded", runtimeEndpointRef: "http://169.254.169.254/latest/meta-data" }), { code: "invalid_runtime_endpoint", statusCode: 400 });
  await sendCommandReceipt({ ...receiptOptions, state: "succeeded", runtimeEndpointRef: "http://127.0.0.1:19001", resultSummary: { containers: 2 } });
  const route = await context.repository.getAgentRuntimeRoute(context.agent.id);
  assert.equal(route.runtime.endpointRef, "http://127.0.0.1:19001");
  assert.equal(route.runtime.status, "starting");
  assert.doesNotMatch(JSON.stringify(route.secretEnvelope), /provider-secret-value/);

  const heartbeat = { organizationId: "org_a", userId: "user_a", agentId: context.agent.id, runtimeId: context.runtime.id, sequence: 1, status: "healthy", runtimeVersion: "hermes-1", boundaryVersion: "0.3.0", observedAt: new Date().toISOString(), components: [] };
  const heartbeatResponse = await signedMachinePost({ platformUrl: context.baseUrl, machineId: context.agent.id, token: command.config.secrets.agent_control_token, path: "/api/internal/control-plane/heartbeats", payload: heartbeat });
  assert.equal(heartbeatResponse.status, 202);
  assert.equal((await context.repository.getAgent(context.agent.id)).initializationStatus, "ready");

  const pause = await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}/lifecycle`, { method: "POST", headers: { cookie: userCookie, "content-type": "application/json" }, body: JSON.stringify({ action: "pause" }) });
  assert.equal(pause.status, 202);
  assert.equal((await pause.json()).action, "deployment.suspend");
  const lifecycleLease = await signedMachinePost({ platformUrl: context.baseUrl, machineId: serverRegistration.server.id, token: serverRegistration.credential.token, path: "/api/internal/control-plane/commands/lease", payload: { serverId: serverRegistration.server.id, limit: 5, leaseSeconds: 120 } });
  const lifecycleCommand = (await lifecycleLease.json()).commands[0];
  assert.equal(lifecycleCommand.action, "deployment.suspend");
  const lifecycleReceipt = { platformUrl: context.baseUrl, serverId: serverRegistration.server.id, token: serverRegistration.credential.token, commandId: lifecycleCommand.command_id, attempt: lifecycleCommand.attempt };
  await sendCommandReceipt({ ...lifecycleReceipt, state: "accepted" });
  await sendCommandReceipt({ ...lifecycleReceipt, state: "running" });
  await sendCommandReceipt({ ...lifecycleReceipt, state: "succeeded" });
  assert.equal((await context.repository.getAgentRuntimeByAgent(context.agent.id)).status, "suspended");
  const resume = await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}/lifecycle`, { method: "POST", headers: { cookie: userCookie, "content-type": "application/json" }, body: JSON.stringify({ action: "resume" }) });
  assert.equal(resume.status, 202);
  const resumeLease = await signedMachinePost({ platformUrl: context.baseUrl, machineId: serverRegistration.server.id, token: serverRegistration.credential.token, path: "/api/internal/control-plane/commands/lease", payload: { serverId: serverRegistration.server.id, limit: 5, leaseSeconds: 120 } });
  const resumeCommand = (await resumeLease.json()).commands[0];
  assert.equal(resumeCommand.action, "deployment.resume");
  const resumeReceipt = { platformUrl: context.baseUrl, serverId: serverRegistration.server.id, token: serverRegistration.credential.token, commandId: resumeCommand.command_id, attempt: resumeCommand.attempt };
  await sendCommandReceipt({ ...resumeReceipt, state: "accepted" });
  await sendCommandReceipt({ ...resumeReceipt, state: "running" });
  await sendCommandReceipt({ ...resumeReceipt, state: "succeeded" });
  assert.equal((await context.repository.getAgentRuntimeByAgent(context.agent.id)).status, "starting");
  assert.equal((await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}/lifecycle`, { method: "POST", headers: { cookie: userCookie, "content-type": "application/json" }, body: JSON.stringify({ action: "delete", confirmName: "wrong" }) })).status, 400);
});

test("user Runtime routes enforce Agent ownership and preserve native Hermes SSE", async (t) => {
  const operations = [];
  const runtimeClient = {
    operation: async (input) => { operations.push(input); return input.operation === "sessions.list" ? { object: "list", data: [] } : { ok: true }; },
    streamOperation: async (input) => {
      operations.push(input);
      return new Response('data: {"event":"message.delta","text":"hello"}\n\n', { headers: { "content-type": "text/event-stream" } });
    }
  };
  const context = await setup({ runtimeClient });
  t.after(() => context.server.close());
  const ownerCookie = await login(context.baseUrl, "user@example.test");
  const sameOrgCookie = await login(context.baseUrl, "same-org@example.test");

  const list = await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}/sessions`, { headers: { cookie: ownerCookie } });
  assert.equal(list.status, 200);
  assert.equal(operations[0].operation, "sessions.list");
  assert.equal(operations[0].agent.id, context.agent.id);

  const stream = await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}/sessions/session_a/chat/stream`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ message: "Hello" })
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type"), /text\/event-stream/);
  assert.equal(await stream.text(), 'data: {"event":"message.delta","text":"hello"}\n\n');
  assert.equal(operations[1].operation, "sessions.chat.stream");

  const multimodal = await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}/sessions/session_a/chat`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ message: "Describe this", attachments: [{ data_url: "data:image/png;base64,aGVsbG8=" }] })
  });
  assert.equal(multimodal.status, 200);
  assert.deepEqual(operations[2].input.body.message, [
    { type: "text", text: "Describe this" },
    { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=", detail: "auto" } }
  ]);
  const invalidAttachment = await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}/sessions/session_a/chat`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ message: "Inspect", attachments: [{ data_url: "data:image/svg+xml;base64,PHN2Zz4=" }] })
  });
  assert.equal(invalidAttachment.status, 400);

  const denied = await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}/sessions`, { headers: { cookie: sameOrgCookie } });
  assert.equal(denied.status, 404);
  assert.equal(operations.length, 3);
});

test("provider credentials are platform-admin only and responses are masked", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  const userCookie = await login(context.baseUrl, "user@example.test");
  const orgCookie = await login(context.baseUrl, "org-admin@example.test");
  const rootCookie = await login(context.baseUrl, "root@example.test");
  assert.equal((await fetch(`${context.baseUrl}/api/admin/provider-settings`, { headers: { cookie: userCookie } })).status, 403);
  assert.equal((await fetch(`${context.baseUrl}/api/admin/provider-settings`, { headers: { cookie: orgCookie } })).status, 403);
  const update = await fetch(`${context.baseUrl}/api/admin/provider-settings`, { method: "PATCH", headers: { cookie: rootCookie, "content-type": "application/json" }, body: JSON.stringify({ provider: "compatible", baseUrl: "https://models.example.test/v1", model: "example/model", apiKey: "provider-secret-1234" }) });
  assert.equal(update.status, 200);
  const body = await update.json();
  assert.equal(body.configuration.keyMasked, "****1234");
  assert.equal(body.configuration.apiKey, undefined);
  const stored = await context.repository.getProviderConfiguration("org_a");
  assert.doesNotMatch(JSON.stringify(stored.apiKeyEnvelope), /provider-secret-1234/);
});

test("control-plane administration is scoped, masked and audited", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  const userCookie = await login(context.baseUrl, "user@example.test");
  const orgCookie = await login(context.baseUrl, "org-admin@example.test");
  const rootCookie = await login(context.baseUrl, "root@example.test");

  assert.equal((await fetch(`${context.baseUrl}/api/admin/provider-channels`, { headers: { cookie: orgCookie } })).status, 403);
  const channelResponse = await fetch(`${context.baseUrl}/api/admin/provider-channels`, {
    method: "POST",
    headers: { cookie: rootCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "primary", provider: "compatible", baseUrl: "https://models.example.test/v1", model: "example/model", apiKey: "pool-secret-9876", priority: 10, weight: 2, maxConcurrency: 20, monthlyBudgetUsd: 100 })
  });
  assert.equal(channelResponse.status, 201);
  const providerChannel = (await channelResponse.json()).channel;
  assert.equal(providerChannel.keyMasked, "****9876");
  assert.equal(providerChannel.apiKey, undefined);
  assert.equal(providerChannel.apiKeyEnvelope, undefined);

  const policyResponse = await fetch(`${context.baseUrl}/api/admin/model-policy`, {
    method: "PATCH",
    headers: { cookie: rootCookie, "content-type": "application/json" },
    body: JSON.stringify({ allowedModels: ["example/model"], defaultModel: "example/model", userCustomKeysAllowed: false, dailyTokenLimit: 100000, monthlyBudgetUsd: 500 })
  });
  assert.equal(policyResponse.status, 200);

  const retentionResponse = await fetch(`${context.baseUrl}/api/admin/data-retention`, {
    method: "PATCH",
    headers: { cookie: orgCookie, "content-type": "application/json" },
    body: JSON.stringify({ telemetryDays: 30, usageDays: 400, auditDays: 365, sensitiveAccessEventDays: 365, backupDays: 30 })
  });
  assert.equal(retentionResponse.status, 200);
  assert.equal((await fetch(`${context.baseUrl}/api/admin/data-retention?organization_id=org_b`, { headers: { cookie: orgCookie } })).status, 403);
  assert.equal((await fetch(`${context.baseUrl}/api/admin/sensitive-access`, { headers: { cookie: orgCookie } })).status, 403);

  const grantResponse = await fetch(`${context.baseUrl}/api/admin/sensitive-access/grants`, {
    method: "POST",
    headers: { cookie: rootCookie, "content-type": "application/json" },
    body: JSON.stringify({ granteeUserId: context.users.orgAdmin.id, scope: "agent", targetId: context.agent.id, reason: "Investigate a declared production incident", expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() })
  });
  assert.equal(grantResponse.status, 201);
  const grant = (await grantResponse.json()).grant;
  assert.equal((await fetch(`${context.baseUrl}/api/admin/sensitive-access`, { headers: { cookie: userCookie } })).status, 403);
  const revoke = await fetch(`${context.baseUrl}/api/admin/sensitive-access/grants/${grant.id}/revoke`, { method: "POST", headers: { cookie: rootCookie, "content-type": "application/json" }, body: "{}" });
  assert.equal(revoke.status, 200);

  await context.repository.saveAgentHeartbeat({ organizationId: "org_a", userId: context.users.user.id, agentId: context.agent.id, runtimeId: context.runtime.id, sequence: 1, status: "unhealthy", observedAt: new Date().toISOString(), components: [] });
  const alert = (await (await fetch(`${context.baseUrl}/api/admin/alerts`, { headers: { cookie: orgCookie } })).json()).alerts.find((item) => item.code === "runtime.health");
  const acknowledge = await fetch(`${context.baseUrl}/api/admin/alerts/${alert.id}/status`, { method: "PATCH", headers: { cookie: orgCookie, "content-type": "application/json" }, body: JSON.stringify({ status: "acknowledged" }) });
  assert.equal(acknowledge.status, 200);
  assert.equal((await acknowledge.json()).alert.status, "acknowledged");

  const audit = await (await fetch(`${context.baseUrl}/api/admin/audit`, { headers: { cookie: rootCookie } })).json();
  assert.ok(audit.events.some((item) => item.action === "sensitive_access.grant"));
  assert.ok(audit.events.some((item) => item.action === "alert.acknowledged"));
});

test("users own Obsidian notes and can read normalized hotspot data", async (t) => {
  const runtimeClient = { invokeIntegration: async () => ({ status: "completed", completed_at: "2026-07-15T00:00:01.000Z", output: { sources: [{ source_id: "baidu", status: "ready", count: 1 }], items: [{ external_id: "one", source_id: "baidu", source_name: "百度热搜", rank: 1, title: "测试热点", url: "https://www.baidu.com/", mobile_url: "", heat: "", category: "", fetched_at: "2026-07-15T00:00:00.000Z" }] } }) };
  const context = await setup({ runtimeClient });
  t.after(() => context.server.close());
  const userCookie = await login(context.baseUrl, "user@example.test");
  const rootCookie = await login(context.baseUrl, "root@example.test");
  const note = await fetch(`${context.baseUrl}/api/user/memory-notes`, { method: "POST", headers: { cookie: userCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "测试记忆", body: "正文", wikilinks: ["项目"] }) });
  assert.equal(note.status, 201);
  const notes = await (await fetch(`${context.baseUrl}/api/user/memory-notes`, { headers: { cookie: userCookie } })).json();
  assert.equal(notes.notes.length, 1);
  assert.match(notes.notes[0].markdown, /\[\[项目\]\]/);
  assert.equal((await fetch(`${context.baseUrl}/api/admin/hotspots/refresh`, { method: "POST", headers: { cookie: rootCookie, "content-type": "application/json" }, body: "{}" })).status, 202);
  const hotspots = await (await fetch(`${context.baseUrl}/api/user/hotspots`, { headers: { cookie: userCookie } })).json();
  assert.equal(hotspots.items[0].title, "测试热点");
});
