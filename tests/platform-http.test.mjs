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
import { deriveMachineKey, signMachineRequest } from "../packages/security/machine-request.mjs";
import { createTestBailongmaUi } from "./helpers/bailongma-ui.mjs";

const sessionSecret = "http-test-session-secret-that-is-longer-than-32-characters";
const providerEncryptionKey = "http-test-provider-encryption-key-longer-than-32-characters";
const bailongmaUi = createTestBailongmaUi();

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

async function makeAgentReady(context, { observedAt = new Date().toISOString(), usage } = {}) {
  await context.repository.upsertProviderConfiguration({ organizationId: "org_a", provider: "compatible", baseUrl: "https://models.example.test/v1", model: "example/model", apiKeyEnvelope: { ciphertext: "encrypted-provider-key" }, keyHint: "test", updatedBy: "root" });
  await context.repository.updateAgent(context.agent.id, { desiredRuntimeState: "running" });
  await context.repository.saveAgentHeartbeat({ organizationId: "org_a", userId: context.users.user.id, agentId: context.agent.id, runtimeId: context.runtime.id, sequence: 1, status: "healthy", observedAt, components: [], ...(usage ? { usage } : {}) });
}

test("public pages expose the bairui-agent brand assets", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  assert.equal((await fetch(`${context.baseUrl}/health`)).status, 200);
  const ready = await fetch(`${context.baseUrl}/ready`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).backend, "memory");
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

test("readiness fails closed while liveness remains available", async (t) => {
  const context = await setup({ readiness: async () => ({ ready: false, status: "database_unavailable", backend: "postgresql" }) });
  t.after(() => context.server.close());
  assert.equal((await fetch(`${context.baseUrl}/health`)).status, 200);
  const ready = await fetch(`${context.baseUrl}/ready`);
  assert.equal(ready.status, 503);
  assert.equal((await ready.json()).status, "database_unavailable");
});

test("anonymous and ordinary users cannot access administrator data", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  assert.equal((await fetch(`${context.baseUrl}/api/admin/overview`)).status, 401);
  const cookie = await login(context.baseUrl, "user@example.test");
  const workspacePage = await fetch(`${context.baseUrl}/app`, { headers: { cookie } });
  assert.equal(workspacePage.status, 200);
  const workspaceHtml = await workspacePage.text();
  assert.match(workspaceHtml, /bairui-agent \| Cognitive Surface/);
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
    observedAt: "2026-07-16T00:00:00.000Z", activeRuns: 2, queueDepth: 1, failedRuns: 0,
    components: [{ layer: "core-runtime", moduleId: "hermes", status: "healthy", version: "hermes-1", capabilities: ["runs"], metrics: { latency_ms: 12 }, observedAt: "2026-07-16T00:00:00.000Z", prompt: "must-not-be-stored" }],
    events: [{ layer: "core-runtime", componentId: "hermes", eventType: "runtime.health", severity: "info", metrics: { active_runs: 2 }, occurredAt: "2026-07-16T00:00:00.000Z", content: "must-not-be-stored" }],
    usage: { bucketStart: "2026-07-16T00:00:00.000Z", bucketSeconds: 3600, model: "hermes", inputTokens: 10, outputTokens: 20, estimatedCostUsd: 0, runCount: 1, failedRunCount: 0, latencySumMs: 12 }
  };
  const rejected = await fetch(`${context.baseUrl}/api/internal/control-plane/heartbeats`, { method: "POST", headers: { authorization: "Bearer agent-ingest-test-token", "content-type": "application/json" }, body: JSON.stringify(heartbeat) });
  assert.equal(rejected.status, 400);
  delete heartbeat.components[0].prompt;
  delete heartbeat.events[0].content;
  heartbeat.components.push({ ...heartbeat.components[0], moduleId: "bairui.runtime-boundary", version: "0.3.0", metrics: {} });
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

test("user bootstrap exposes model policy without Provider secrets", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  const secret = "bootstrap-provider-secret";
  await context.repository.upsertProviderConfiguration({ organizationId: "org_a", provider: "compatible", baseUrl: "https://models.example.test/v1", model: "example/model", apiKeyEnvelope: new SecretEnvelope(providerEncryptionKey).seal(secret), keyHint: "cret", updatedBy: "root" });
  await context.repository.upsertModelPolicy({ organizationId: "org_a", allowedModels: ["example/model"], defaultModel: "example/model", userCustomKeysAllowed: false, dailyTokenLimit: 1000, monthlyBudgetUsd: 10, updatedBy: "root" });
  const ownerCookie = await login(context.baseUrl, "user@example.test");
  const peerCookie = await login(context.baseUrl, "same-org@example.test");
  const bootstrap = await (await fetch(`${context.baseUrl}/api/user/bootstrap`, { headers: { cookie: ownerCookie } })).json();
  assert.deepEqual(bootstrap.models.allowedModels, ["example/model"]);
  assert.equal(bootstrap.models.defaultModel, "example/model");
  assert.equal(bootstrap.memoryFormat, "obsidian-markdown");
  assert.doesNotMatch(JSON.stringify(bootstrap), /apiKey|api_key|Envelope|bootstrap-provider-secret/i);

  const invalid = await fetch(`${context.baseUrl}/api/user/agents`, { method: "POST", headers: { cookie: peerCookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Invalid model", preferredModel: "other/model" }) });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, "model_not_allowed");
  const valid = await fetch(`${context.baseUrl}/api/user/agents`, { method: "POST", headers: { cookie: peerCookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Policy model", preferredModel: "example/model" }) });
  assert.equal(valid.status, 201);
  assert.equal((await valid.json()).agent.settings.preferredModel, "example/model");
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
  await context.repository.upsertProviderChannel({ organizationId: "org_a", name: "primary", provider: "compatible", baseUrl: "https://models.example.test/v1", model: "example/model", apiKeyEnvelope: vault.seal("provider-secret-value"), keyHint: "alue", updatedBy: "root" });

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
  assert.equal((await context.repository.getProviderConfiguration("org_a")).applyStatus, "applied");
  assert.equal((await context.repository.listProviderChannels("org_a"))[0].status, "applied");
  const route = await context.repository.getAgentRuntimeRoute(context.agent.id);
  assert.equal(route.runtime.endpointRef, "http://127.0.0.1:19001");
  assert.equal(route.runtime.status, "starting");
  assert.doesNotMatch(JSON.stringify(route.secretEnvelope), /provider-secret-value/);

  const heartbeatObservedAt = new Date().toISOString();
  const heartbeatComponent = { layer: "core-runtime", moduleId: "hermes", status: "healthy", version: "hermes-1", capabilities: ["runs"], metrics: {}, observedAt: heartbeatObservedAt };
  const heartbeat = { organizationId: "org_a", userId: "user_a", agentId: context.agent.id, runtimeId: context.runtime.id, sequence: 1, status: "healthy", runtimeVersion: "hermes-1", boundaryVersion: "0.3.0", observedAt: heartbeatObservedAt, queueDepth: 0, activeRuns: 0, failedRuns: 0, components: [heartbeatComponent, { ...heartbeatComponent, moduleId: "bairui.runtime-boundary", version: "0.3.0" }], events: [] };
  const heartbeatResponse = await signedMachinePost({ platformUrl: context.baseUrl, machineId: context.agent.id, token: command.config.secrets.agent_control_token, path: "/api/internal/control-plane/heartbeats", payload: heartbeat });
  assert.equal(heartbeatResponse.status, 202);
  assert.equal((await context.repository.getAgent(context.agent.id)).initializationStatus, "ready");

  const personalSecret = "runtime-only-firecrawl-secret";
  const authorizationResponse = await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}/authorizations`, { method: "POST", headers: { cookie: userCookie, "content-type": "application/json" }, body: JSON.stringify({ service: "firecrawl", label: "Runtime crawler", authType: "api_key", secret: personalSecret }) });
  assert.equal(authorizationResponse.status, 201);
  const authorization = (await authorizationResponse.json()).authorization;
  assert.doesNotMatch(JSON.stringify(authorization), new RegExp(personalSecret));
  const resolvePath = `/api/internal/runtime/agents/${context.agent.id}/authorizations/${authorization.id}/resolve`;
  const resolved = await signedMachinePost({ platformUrl: context.baseUrl, machineId: context.agent.id, token: command.config.secrets.agent_control_token, path: resolvePath, payload: {} });
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json()).credential.secret, personalSecret);
  const wrongMachine = await signedMachinePost({ platformUrl: context.baseUrl, machineId: serverRegistration.server.id, token: serverRegistration.credential.token, path: resolvePath, payload: {} });
  assert.equal(wrongMachine.status, 401);

  const channelSecret = "channel-worker-only-secret";
  const channelWorkerId = "channel_worker_http";
  const channelWorkerToken = "channel-worker-http-token-at-least-32-characters";
  await context.repository.createChannelWorkerCredential({ workerId: channelWorkerId, keyHash: deriveMachineKey(channelWorkerToken), keyHint: channelWorkerToken.slice(-4), allowedChannels: ["feishu", "wechat", "qq"], createdBy: "root" });
  const channelBindingResponse = await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}/channels/feishu`, { method: "PUT", headers: { cookie: userCookie, "content-type": "application/json" }, body: JSON.stringify({ displayName: "Production Feishu", credentials: { appId: "app_channel", appSecret: channelSecret }, metadata: { accountId: "app_channel" } }) });
  assert.equal(channelBindingResponse.status, 202);
  const channelBinding = (await channelBindingResponse.json()).binding;
  assert.equal(channelBinding.status, "pending");
  assert.doesNotMatch(JSON.stringify(channelBinding), new RegExp(channelSecret));
  const channelResolvePath = `/api/internal/channels/bindings/${channelBinding.id}/resolve`;
  const channelCredentialResponse = await signedMachinePost({ platformUrl: context.baseUrl, machineId: channelWorkerId, token: channelWorkerToken, path: channelResolvePath, payload: {} });
  assert.equal(channelCredentialResponse.status, 200);
  assert.equal((await channelCredentialResponse.json()).credential.values.appSecret, channelSecret);
  assert.equal((await signedMachinePost({ platformUrl: context.baseUrl, machineId: serverRegistration.server.id, token: serverRegistration.credential.token, path: channelResolvePath, payload: {} })).status, 401);

  const channelInventory = await signedMachinePost({ platformUrl: context.baseUrl, machineId: channelWorkerId, token: channelWorkerToken, path: "/api/internal/channels/bindings", payload: { schema_version: "1.0", worker_id: channelWorkerId, channels: ["feishu", "wechat", "qq"], trace: { correlation_id: "channel_inventory_http" } } });
  assert.equal(channelInventory.status, 200);
  const inventoryBody = await channelInventory.json();
  assert.equal(inventoryBody.bindings[0].id, channelBinding.id);
  assert.doesNotMatch(JSON.stringify(inventoryBody), new RegExp(channelSecret));

  const channelTrace = { correlation_id: "channel_trace_http" };
  const channelIngress = { schema_version: "1.0", ingress_id: "channel_ingress_http", binding_id: channelBinding.id, channel: "feishu", channel_account_id: "app_channel", message_id: "vendor_message_http", sender: { channel_user_id: "ou_http" }, conversation: { channel_conversation_id: "oc_http", kind: "group" }, content: { kind: "text", text: "hello" }, attachments: [], received_at: new Date().toISOString(), trace: channelTrace };
  const ingressResponse = await signedMachinePost({ platformUrl: context.baseUrl, machineId: channelWorkerId, token: channelWorkerToken, path: "/api/internal/channels/ingress", payload: channelIngress });
  assert.equal(ingressResponse.status, 202);
  assert.equal((await ingressResponse.json()).status, "accepted");
  const duplicateIngress = await signedMachinePost({ platformUrl: context.baseUrl, machineId: channelWorkerId, token: channelWorkerToken, path: "/api/internal/channels/ingress", payload: channelIngress });
  assert.equal((await duplicateIngress.json()).status, "duplicate");
  const [channelInbox] = await context.repository.leaseChannelIngress({ limit: 1, leaseSeconds: 30, leaseId: "channel_http_inbox_lease" });
  await context.repository.completeChannelIngress({ id: channelInbox.id, leaseToken: channelInbox.leaseToken, outbound: { id: "channel_outbound_http", content: { kind: "text", text: "world" } } });

  const deliveryLeasePayload = { schema_version: "1.0", worker_id: "channel_worker_http", channels: ["feishu"], binding_ids: [channelBinding.id], limit: 10, lease_seconds: 30, requested_at: new Date().toISOString(), trace: channelTrace };
  const channelLeaseResponse = await signedMachinePost({ platformUrl: context.baseUrl, machineId: channelWorkerId, token: channelWorkerToken, path: "/api/internal/channels/deliveries/lease", payload: deliveryLeasePayload });
  assert.equal(channelLeaseResponse.status, 200);
  const channelDelivery = (await channelLeaseResponse.json()).deliveries[0];
  assert.equal(channelDelivery.outbound_id, "channel_outbound_http");
  const channelHealth = { schema_version: "1.0", binding_id: channelBinding.id, channel: "feishu", worker_id: "channel_worker_http", sequence: 1, status: "connected", capabilities: ["receive", "send", "websocket"], adapter_version: "test", observed_at: new Date().toISOString() };
  assert.equal((await signedMachinePost({ platformUrl: context.baseUrl, machineId: channelWorkerId, token: channelWorkerToken, path: "/api/internal/channels/health", payload: { ...channelHealth, message: "must-not-pass" } })).status, 400);
  assert.equal((await signedMachinePost({ platformUrl: context.baseUrl, machineId: channelWorkerId, token: channelWorkerToken, path: "/api/internal/channels/health", payload: channelHealth })).status, 202);
  const deliveryReceipt = { schema_version: "1.0", outbound_id: channelDelivery.outbound_id, binding_id: channelDelivery.binding_id, lease_token: channelDelivery.lease_token, status: "delivered", attempt: channelDelivery.attempt, channel_message_id: "vendor_reply_http", observed_at: new Date().toISOString(), trace: channelTrace };
  assert.equal((await signedMachinePost({ platformUrl: context.baseUrl, machineId: channelWorkerId, token: channelWorkerToken, path: "/api/internal/channels/delivery-receipts", payload: deliveryReceipt })).status, 202);
  const connectedBinding = await context.repository.getChannelBindingById(channelBinding.id);
  assert.equal(connectedBinding.status, "connected");
  assert.ok(connectedBinding.lastOutboundAt);

  const resource = { agentId: context.agent.id, runtimeId: context.runtime.id, deploymentId: command.deployment_id, sequence: 10, status: "running", cpuPercent: 5.3, memoryUsedBytes: 201326592, memoryLimitBytes: 2147483648, agentStorageUsedBytes: 10485760, hostStorageUsedBytes: 53687091200, hostStorageLimitBytes: 107374182400, osType: "linux", architecture: "amd64", operatingSystem: "Test Linux", dockerVersion: "27.1.0", cpuCount: 8, startedAt: "2026-07-16T06:00:00.000Z", uptimeSeconds: 3600, observedAt: "2026-07-16T07:00:00.000Z", containers: [{ role: "hermes", status: "running", containerId: "a".repeat(64), containerName: "bairui-hermes-a", imageRef: "hermes:test", version: "1.2.3", cpuPercent: 3.1, memoryUsedBytes: 134217728, memoryLimitBytes: 2147483648, writableBytes: 1024, startedAt: "2026-07-16T06:00:00.000Z" }, { role: "runtime-boundary", status: "running", containerId: "b".repeat(64), containerName: "bairui-runtime-a", imageRef: "runtime:test", version: "0.4.0", cpuPercent: 2.2, memoryUsedBytes: 67108864, memoryLimitBytes: 2147483648, writableBytes: 2048, startedAt: "2026-07-16T06:01:00.000Z" }] };
  const taintedResource = { ...resource, prompt: "must-not-be-stored", containers: [{ ...resource.containers[0], secret: "must-not-be-stored" }, resource.containers[1]] };
  assert.equal((await signedMachinePost({ platformUrl: context.baseUrl, machineId: serverRegistration.server.id, token: serverRegistration.credential.token, path: "/api/internal/control-plane/resources", payload: { serverId: serverRegistration.server.id, samples: [taintedResource] } })).status, 400);
  const resourceResponse = await signedMachinePost({ platformUrl: context.baseUrl, machineId: serverRegistration.server.id, token: serverRegistration.credential.token, path: "/api/internal/control-plane/resources", payload: { serverId: serverRegistration.server.id, samples: [resource] } });
  assert.equal(resourceResponse.status, 202);
  const fleet = await (await fetch(`${context.baseUrl}/api/admin/agents`, { headers: { cookie: rootCookie } })).json();
  const fleetAgent = fleet.agents.find((item) => item.id === context.agent.id);
  assert.equal(fleetAgent.resource.cpuPercent, 5.3);
  assert.equal(fleetAgent.resource.containers[0].role, "hermes");
  assert.doesNotMatch(JSON.stringify(fleetAgent.resource), /must-not-be-stored/);
  const resourceDetail = await fetch(`${context.baseUrl}/api/admin/agents/${context.agent.id}/resources`, { headers: { cookie: rootCookie } });
  assert.equal(resourceDetail.status, 200);
  assert.equal((await resourceDetail.json()).samples[0].architecture, "amd64");
  assert.equal((await fetch(`${context.baseUrl}/api/admin/agents/${context.agent.id}/resources`, { headers: { cookie: userCookie } })).status, 403);
  const mismatchedResource = await signedMachinePost({ platformUrl: context.baseUrl, machineId: serverRegistration.server.id, token: serverRegistration.credential.token, path: "/api/internal/control-plane/resources", payload: { serverId: serverRegistration.server.id, samples: [{ ...resource, deploymentId: "deployment_not_owned", sequence: 11 }] } });
  assert.equal(mismatchedResource.status, 404);
  const malformedResource = await signedMachinePost({ platformUrl: context.baseUrl, machineId: serverRegistration.server.id, token: serverRegistration.credential.token, path: "/api/internal/control-plane/resources", payload: { serverId: serverRegistration.server.id, samples: [{ ...resource, sequence: 12, containers: [resource.containers[0], { ...resource.containers[0], containerName: "duplicate-role" }] }] } });
  assert.equal(malformedResource.status, 400);
  const highResource = { ...resource, sequence: 13, cpuPercent: 760, memoryUsedBytes: 2040109465, hostStorageUsedBytes: 102005473280, observedAt: new Date().toISOString() };
  assert.equal((await signedMachinePost({ platformUrl: context.baseUrl, machineId: serverRegistration.server.id, token: serverRegistration.credential.token, path: "/api/internal/control-plane/resources", payload: { serverId: serverRegistration.server.id, samples: [highResource] } })).status, 202);
  const highAlerts = (await (await fetch(`${context.baseUrl}/api/admin/alerts`, { headers: { cookie: rootCookie } })).json()).alerts.filter((item) => item.code.startsWith("resource."));
  assert.deepEqual(new Set(highAlerts.map((item) => item.code)), new Set(["resource.cpu.high", "resource.memory.high", "resource.storage.high"]));
  assert.equal((await signedMachinePost({ platformUrl: context.baseUrl, machineId: serverRegistration.server.id, token: serverRegistration.credential.token, path: "/api/internal/control-plane/resources", payload: { serverId: serverRegistration.server.id, samples: [{ ...resource, sequence: 14, observedAt: new Date().toISOString() }] } })).status, 202);
  assert.ok((await context.repository.listAlerts("org_a")).filter((item) => item.code.startsWith("resource.")).every((item) => item.status === "resolved"));

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
  await makeAgentReady(context);
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

test("user Runs persist across requests and retry only from terminal records", async (t) => {
  let created = 0;
  const operations = [];
  const runtimeClient = {
    operation: async (input) => {
      operations.push(input);
      if (input.operation === "runs.create") return { run_id: `run_${++created}`, status: "started" };
      if (input.operation === "runs.get") return { run_id: input.input.run_id, status: "failed", error: "provider unavailable" };
      return { ok: true };
    }
  };
  const context = await setup({ runtimeClient });
  t.after(() => context.server.close());
  await makeAgentReady(context);
  const ownerCookie = await login(context.baseUrl, "user@example.test");
  const peerCookie = await login(context.baseUrl, "same-org@example.test");
  const base = `${context.baseUrl}/api/user/agents/${context.agent.id}/runs`;

  const started = await fetch(base, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ input: "Prepare the release report" }) });
  assert.equal(started.status, 202);
  assert.equal((await started.json()).run_id, "run_1");
  assert.equal((await fetch(`${base}/run_1/retry`, { method: "POST", headers: { cookie: ownerCookie } })).status, 409);

  const list = await (await fetch(base, { headers: { cookie: ownerCookie } })).json();
  assert.equal(list.runs.length, 1);
  assert.equal(list.runs[0].inputPreview, "Prepare the release report");
  assert.equal(list.runs[0].inputText, undefined);
  assert.equal((await fetch(base, { headers: { cookie: peerCookie } })).status, 404);

  const refreshed = await (await fetch(`${base}/run_1`, { headers: { cookie: ownerCookie } })).json();
  assert.equal(refreshed.record.status, "failed");
  assert.equal(refreshed.record.lastError, "provider unavailable");
  const retried = await fetch(`${base}/run_1/retry`, { method: "POST", headers: { cookie: ownerCookie } });
  assert.equal(retried.status, 202);
  assert.equal((await retried.json()).run_id, "run_2");
  const history = await (await fetch(base, { headers: { cookie: ownerCookie } })).json();
  assert.equal(history.runs.length, 2);
  assert.equal(history.runs[0].parentRunId, "run_1");
  assert.equal(operations.filter((item) => item.operation === "runs.create").length, 2);
});

test("operational state blocks new Runtime work while preserving recovery operations", async (t) => {
  const operations = [];
  const runtimeClient = {
    operation: async (input) => { operations.push(input); return input.operation === "sessions.list" ? { object: "list", data: [] } : { ok: true }; },
    streamOperation: async (input) => { operations.push(input); return new Response("", { headers: { "content-type": "text/event-stream" } }); }
  };
  const context = await setup({ runtimeClient, runtimeStaleAfterMs: 30_000 });
  t.after(() => context.server.close());
  await context.repository.upsertModelPolicy({ organizationId: "org_a", allowedModels: ["example/model"], defaultModel: "example/model", dailyTokenLimit: 10, monthlyBudgetUsd: 100, updatedBy: "root" });
  await makeAgentReady(context, { usage: { bucketStart: new Date().toISOString(), bucketSeconds: 3600, model: "example/model", inputTokens: 8, outputTokens: 4, estimatedCostUsd: 0.01, runCount: 1, failedRunCount: 0, latencySumMs: 10 } });
  const ownerCookie = await login(context.baseUrl, "user@example.test");
  const peerCookie = await login(context.baseUrl, "same-org@example.test");
  const agentView = await (await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}`, { headers: { cookie: ownerCookie } })).json();
  assert.equal(agentView.agent.operational.code, "quota_exhausted");
  assert.equal(agentView.agent.operational.quota.dailyTokens, 12);
  const peerAgents = await (await fetch(`${context.baseUrl}/api/user/agents`, { headers: { cookie: peerCookie } })).json();
  assert.deepEqual(peerAgents.agents, []);

  const requests = [
    ["/sessions", { title: "blocked" }],
    ["/sessions/session_a/chat", { message: "blocked" }],
    ["/runs", { input: "blocked" }],
    ["/jobs", { name: "blocked" }],
    ["/jobs/job_a/run", {}]
  ];
  for (const [path, body] of requests) {
    const response = await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}${path}`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 429, path);
    assert.equal((await response.json()).error, "quota_exhausted", path);
  }
  assert.equal(operations.length, 0);

  const list = await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}/sessions`, { headers: { cookie: ownerCookie } });
  assert.equal(list.status, 200);
  const stop = await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}/runs/run_a/stop`, { method: "POST", headers: { cookie: ownerCookie } });
  assert.equal(stop.status, 202);
  assert.deepEqual(operations.map((item) => item.operation), ["sessions.list", "runs.stop"]);
});

test("operational state distinguishes unconfigured models and stale Runtime heartbeats", async (t) => {
  const modelContext = await setup({ runtimeClient: { operation: async () => ({ ok: true }) } });
  t.after(() => modelContext.server.close());
  const modelCookie = await login(modelContext.baseUrl, "user@example.test");
  const uninitialized = await fetch(`${modelContext.baseUrl}/api/user/agents/${modelContext.agent.id}/sessions`, { method: "POST", headers: { cookie: modelCookie, "content-type": "application/json" }, body: "{}" });
  assert.equal(uninitialized.status, 409);
  assert.equal((await uninitialized.json()).error, "agent_not_ready");
  await modelContext.repository.saveAgentHeartbeat({ organizationId: "org_a", userId: modelContext.users.user.id, agentId: modelContext.agent.id, runtimeId: modelContext.runtime.id, sequence: 1, status: "healthy", observedAt: new Date().toISOString(), components: [] });
  const modelBlocked = await fetch(`${modelContext.baseUrl}/api/user/agents/${modelContext.agent.id}/sessions`, { method: "POST", headers: { cookie: modelCookie, "content-type": "application/json" }, body: "{}" });
  assert.equal(modelBlocked.status, 409);
  assert.equal((await modelBlocked.json()).error, "model_not_configured");

  const offlineContext = await setup({ runtimeClient: { operation: async () => ({ ok: true }) }, runtimeStaleAfterMs: 30_000 });
  t.after(() => offlineContext.server.close());
  await makeAgentReady(offlineContext, { observedAt: new Date(Date.now() - 60_000).toISOString() });
  const offlineCookie = await login(offlineContext.baseUrl, "user@example.test");
  const offlineView = await (await fetch(`${offlineContext.baseUrl}/api/user/agents/${offlineContext.agent.id}`, { headers: { cookie: offlineCookie } })).json();
  assert.equal(offlineView.agent.operational.code, "offline");
  assert.equal(offlineView.agent.runtime.effectiveStatus, "offline");
  const offlineBlocked = await fetch(`${offlineContext.baseUrl}/api/user/agents/${offlineContext.agent.id}/runs`, { method: "POST", headers: { cookie: offlineCookie, "content-type": "application/json" }, body: JSON.stringify({ input: "blocked" }) });
  assert.equal(offlineBlocked.status, 503);
  assert.equal((await offlineBlocked.json()).error, "runtime_offline");
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
  const shortUsageRetention = await fetch(`${context.baseUrl}/api/admin/data-retention`, { method: "PATCH", headers: { cookie: orgCookie, "content-type": "application/json" }, body: JSON.stringify({ telemetryDays: 30, usageDays: 30, auditDays: 365, sensitiveAccessEventDays: 365, backupDays: 30 }) });
  assert.equal(shortUsageRetention.status, 400);
  const retentionRunResponse = await fetch(`${context.baseUrl}/api/admin/data-retention/run`, { method: "POST", headers: { cookie: orgCookie, "content-type": "application/json" }, body: JSON.stringify({ reason: "Apply the approved organization retention policy" }) });
  assert.equal(retentionRunResponse.status, 200);
  assert.equal((await retentionRunResponse.json()).runs[0].status, "succeeded");
  assert.equal((await (await fetch(`${context.baseUrl}/api/admin/data-retention`, { headers: { cookie: orgCookie } })).json()).runs[0].status, "succeeded");
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
  const futureRuns = await context.repository.enforceRetentionPolicies({ organizationId: "org_a", now: Date.now() + 500 * 24 * 60 * 60_000 });
  assert.ok(futureRuns[0].deletedCounts.auditEvents > 0);
  assert.ok((await context.repository.listAudit("org_a")).some((item) => item.action === "retention.enforced"));
});

test("administrators issue governed control commands through approval-gated workflows", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  const userCookie = await login(context.baseUrl, "user@example.test");
  const orgCookie = await login(context.baseUrl, "org-admin@example.test");
  const rootCookie = await login(context.baseUrl, "root@example.test");
  const server = await context.repository.createServer({ id: "server_control", organizationId: "org_a", name: "Control host", status: "healthy" });
  const provision = await context.repository.requestAgentProvisioning({ agentId: context.agent.id, requestedBy: context.users.platformAdmin.id, provider: { provider: "compatible", baseUrl: "https://models.example.test/v1", model: "example/model" }, secretEnvelope: { providerApiKey: { encrypted: true }, runtimeSharedSecret: { encrypted: true }, hermesApiServerKey: { encrypted: true }, agentControlToken: { encrypted: true } }, agentCredentialHash: "c".repeat(64), agentCredentialHint: "test" });
  const [provisionCommand] = await context.repository.leaseControlCommands({ serverId: server.id, limit: 5, leaseSeconds: 120 });
  for (const state of ["accepted", "running"]) await context.repository.recordCommandReceipt({ commandId: provisionCommand.command_id, serverId: server.id, attempt: provisionCommand.attempt, state });
  await context.repository.recordCommandReceipt({ commandId: provisionCommand.command_id, serverId: server.id, attempt: provisionCommand.attempt, state: "succeeded", runtimeEndpointRef: "http://127.0.0.1:19123" });

  assert.equal((await fetch(`${context.baseUrl}/api/admin/control-commands`, { method: "POST", headers: { cookie: userCookie, "content-type": "application/json" }, body: JSON.stringify({ agentId: context.agent.id, action: "probe.run", probeIds: ["runtime.health"] }) })).status, 403);
  const probeResponse = await fetch(`${context.baseUrl}/api/admin/control-commands`, { method: "POST", headers: { cookie: orgCookie, "content-type": "application/json" }, body: JSON.stringify({ agentId: context.agent.id, action: "probe.run", probeIds: ["runtime.health"] }) });
  assert.equal(probeResponse.status, 202);
  assert.equal((await probeResponse.json()).approval, null);
  assert.equal((await fetch(`${context.baseUrl}/api/admin/control-commands`, { method: "POST", headers: { cookie: orgCookie, "content-type": "application/json" }, body: JSON.stringify({ agentId: context.agent.id, action: "config.apply", configRevisionId: provision.runtime.configRevisionId, reason: "Apply an approved configuration revision" }) })).status, 403);

  const applyResponse = await fetch(`${context.baseUrl}/api/admin/control-commands`, { method: "POST", headers: { cookie: rootCookie, "content-type": "application/json" }, body: JSON.stringify({ agentId: context.agent.id, action: "config.apply", configRevisionId: provision.runtime.configRevisionId, reason: "Apply an approved configuration revision" }) });
  assert.equal(applyResponse.status, 202);
  const apply = await applyResponse.json();
  assert.equal(apply.approval.decision, "pending");
  const leasedBeforeApproval = await context.repository.leaseControlCommands({ serverId: server.id, limit: 10, leaseSeconds: 120 });
  assert.ok(leasedBeforeApproval.some((item) => item.action === "probe.run"));
  assert.ok(!leasedBeforeApproval.some((item) => item.command_id === apply.command.id));
  const decision = await fetch(`${context.baseUrl}/api/admin/control-approvals/${apply.approval.id}`, { method: "PATCH", headers: { cookie: rootCookie, "content-type": "application/json" }, body: JSON.stringify({ decision: "approved", reason: "Reviewed configuration scope and rollback evidence" }) });
  assert.equal(decision.status, 200);
  const leasedAfterApproval = await context.repository.leaseControlCommands({ serverId: server.id, limit: 10, leaseSeconds: 120 });
  assert.ok(leasedAfterApproval.some((item) => item.command_id === apply.command.id));

  const backupResponse = await fetch(`${context.baseUrl}/api/admin/control-commands`, { method: "POST", headers: { cookie: rootCookie, "content-type": "application/json" }, body: JSON.stringify({ agentId: context.agent.id, action: "backup.create", backupPolicyId: "manual" }) });
  assert.equal(backupResponse.status, 202);
  const backupLease = (await context.repository.leaseControlCommands({ serverId: server.id, limit: 10, leaseSeconds: 120 })).find((item) => item.action === "backup.create");
  for (const state of ["accepted", "running"]) await context.repository.recordCommandReceipt({ commandId: backupLease.command_id, serverId: server.id, attempt: backupLease.attempt, state });
  await context.repository.recordCommandReceipt({ commandId: backupLease.command_id, serverId: server.id, attempt: backupLease.attempt, state: "succeeded", resultSummary: { bytes: 1024 }, evidenceRefs: [`sha256:${"d".repeat(64)}`] });
  const backupId = backupLease.arguments.backup_id;
  const prematureRestore = await fetch(`${context.baseUrl}/api/admin/control-commands`, { method: "POST", headers: { cookie: rootCookie, "content-type": "application/json" }, body: JSON.stringify({ agentId: context.agent.id, action: "backup.restore", backupId, reason: "Attempt restore before backup verification completes" }) });
  assert.equal(prematureRestore.status, 400);
  const verifyResponse = await fetch(`${context.baseUrl}/api/admin/control-commands`, { method: "POST", headers: { cookie: rootCookie, "content-type": "application/json" }, body: JSON.stringify({ agentId: context.agent.id, action: "backup.verify", backupId }) });
  assert.equal(verifyResponse.status, 202);
  const verifyLease = (await context.repository.leaseControlCommands({ serverId: server.id, limit: 10, leaseSeconds: 120 })).find((item) => item.action === "backup.verify");
  for (const state of ["accepted", "running", "succeeded"]) await context.repository.recordCommandReceipt({ commandId: verifyLease.command_id, serverId: server.id, attempt: verifyLease.attempt, state });
  assert.equal((await context.repository.listBackupRecords("org_a"))[0].status, "verified");

  const restoreBody = JSON.stringify({ agentId: context.agent.id, action: "backup.restore", backupId, reason: "Restore a verified backup after declared data loss" });
  assert.equal((await fetch(`${context.baseUrl}/api/admin/control-commands`, { method: "POST", headers: { cookie: orgCookie, "content-type": "application/json" }, body: restoreBody })).status, 403);
  const restoreResponse = await fetch(`${context.baseUrl}/api/admin/control-commands`, { method: "POST", headers: { cookie: rootCookie, "content-type": "application/json" }, body: restoreBody });
  assert.equal(restoreResponse.status, 202);
  const restore = await restoreResponse.json();
  assert.equal(restore.approval.riskLevel, "critical");
  assert.ok(!(await context.repository.leaseControlCommands({ serverId: server.id, limit: 10, leaseSeconds: 120 })).some((item) => item.command_id === restore.command.id));
  const restoreDecision = await fetch(`${context.baseUrl}/api/admin/control-approvals/${restore.approval.id}`, { method: "PATCH", headers: { cookie: rootCookie, "content-type": "application/json" }, body: JSON.stringify({ decision: "approved", reason: "Verified backup identity and rollback recovery plan" }) });
  assert.equal(restoreDecision.status, 200);
  const restoreLease = (await context.repository.leaseControlCommands({ serverId: server.id, limit: 10, leaseSeconds: 120 })).find((item) => item.command_id === restore.command.id);
  assert.equal(restoreLease.action, "backup.restore");
  assert.equal(restoreLease.arguments.backup_id, backupId);
  const backupAdmin = await (await fetch(`${context.baseUrl}/api/admin/backups`, { headers: { cookie: rootCookie } })).json();
  assert.equal(backupAdmin.restores[0].status, "requested");
  assert.equal(backupAdmin.backups[0].agentId, context.agent.id);

  const digest = (letter) => `ghcr.io/bairui/image@sha256:${letter.repeat(64)}`;
  const manifestResponse = await fetch(`${context.baseUrl}/api/admin/release-manifests`, { method: "POST", headers: { cookie: rootCookie, "content-type": "application/json" }, body: JSON.stringify({ version: "1.0.0", agentCommit: "a".repeat(40), imageDigest: digest("a"), hermesImage: digest("b"), runtimeImage: digest("c"), sbomUri: "https://evidence.example.test/sbom.json", provenanceUri: "https://evidence.example.test/provenance.json", signature: "s".repeat(64) }) });
  assert.equal(manifestResponse.status, 201);
  const manifest = (await manifestResponse.json()).manifest;
  assert.equal(manifest.compatibility.runtime_image, digest("c"));
  const releaseStage = await fetch(`${context.baseUrl}/api/admin/control-commands`, { method: "POST", headers: { cookie: rootCookie, "content-type": "application/json" }, body: JSON.stringify({ agentId: context.agent.id, action: "release.stage", releaseId: manifest.id }) });
  assert.equal(releaseStage.status, 202);
  const releaseLease = (await context.repository.leaseControlCommands({ serverId: server.id, limit: 10, leaseSeconds: 120 })).find((item) => item.action === "release.stage");
  assert.equal(releaseLease.release.runtime_image, digest("c"));
  assert.equal(releaseLease.arguments.runtime_image, undefined);
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
