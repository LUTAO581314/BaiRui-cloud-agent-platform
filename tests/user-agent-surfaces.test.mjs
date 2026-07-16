import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPlatformServer } from "../apps/web/app.mjs";
import { ROLES } from "../packages/auth/authorization.mjs";
import { hashPassword } from "../packages/auth/password.mjs";
import { MemoryPlatformRepository } from "../packages/db/memory-repository.mjs";
import { SecretEnvelope } from "../packages/security/secret-envelope.mjs";
import { createBailongmaUi } from "../packages/bailongma-ui/index.mjs";

const password = "Correct-Horse-Battery-Staple-2026";
const bailongmaUi = createBailongmaUi({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "upstreams", "bailongma") });

async function setup(options = {}) {
  const repository = new MemoryPlatformRepository();
  await repository.createOrganization({ id: "org_a", name: "Organization A" });
  const passwordHash = await hashPassword(password);
  const owner = await repository.createUser({ id: "user_a", organizationId: "org_a", email: "owner@example.test", displayName: "Owner", passwordHash, role: ROLES.USER });
  await repository.createUser({ id: "user_b", organizationId: "org_a", email: "peer@example.test", displayName: "Peer", passwordHash, role: ROLES.USER });
  await repository.createUser({ id: "root", organizationId: "org_a", email: "root@example.test", displayName: "Root", passwordHash, role: ROLES.PLATFORM_ADMIN });
  const agent = await repository.createAgent({ id: "agent_a", organizationId: "org_a", ownerUserId: owner.id, name: "Agent A" });
  const runtime = await repository.createAgentRuntime({ id: "runtime_a", organizationId: "org_a", ownerUserId: owner.id, agentId: agent.id, workspaceRef: "hermes:org_a:user_a:agent_a" });
  const runtimeClient = options.runtimeClient ?? {
    operation: async ({ operation }) => operation === "discovery.skills" ? { object: "list", data: [{ id: "browser/use", name: "Browser" }] } : { ok: true },
    invokeIntegration: async () => ({ status: "completed", completed_at: "2026-07-15T00:00:01.000Z", output: { sources: [{ source_id: "baidu", status: "ready", count: 1 }], items: [{ external_id: "one", source_id: "baidu", source_name: "Baidu", rank: 1, title: "Test hotspot", url: "https://www.baidu.com/", mobile_url: "", heat: "", category: "", fetched_at: "2026-07-15T00:00:00.000Z" }] } })
  };
  const { privateKey } = generateKeyPairSync("ed25519");
  const providerVault = new SecretEnvelope("user-surfaces-encryption-key-longer-than-32-characters");
  const server = createPlatformServer({
    repository,
    runtimeClient,
    sessionSecret: "user-surfaces-session-secret-longer-than-32-characters",
    secureCookies: false,
    providerVault,
    bailongmaUi,
    licensePrivateKey: privateKey,
    styles: "",
    logo: Buffer.from("logo"),
    icon: Buffer.from("icon"),
    loginScript: "",
    adminScript: "",
    logger: { error() {} }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { repository, agent, runtime, providerVault, server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("Runtime discovery and complete Hermes Jobs operations remain Agent-scoped", async (t) => {
  const calls = [];
  const runtimeClient = {
    operation: async ({ operation, input }) => {
      calls.push({ operation, input });
      if (operation === "health.detailed") return { status: "healthy", version: "hermes-test" };
      if (operation === "discovery.models") return { data: [{ id: "example/model" }] };
      if (operation === "discovery.capabilities") return { features: { session_resources: true } };
      if (operation === "discovery.skills") return { data: [{ id: "browser/use" }] };
      if (operation === "discovery.toolsets") return { data: [{ name: "web", enabled: true, configured: true, tools: ["browser"] }] };
      if (operation === "jobs.get") return { job: { id: input.job_id, name: "Daily" } };
      if (operation === "jobs.update") return { job: { id: input.job_id, ...input.body } };
      return { jobs: [] };
    },
    invokeIntegration: async () => ({ status: "completed", output: { sources: [], items: [] } })
  };
  const context = await setup({ runtimeClient });
  t.after(() => context.server.close());
  const ownerCookie = await login(context.baseUrl, "owner@example.test");
  const peerCookie = await login(context.baseUrl, "peer@example.test");
  const base = `${context.baseUrl}/api/user/agents/${context.agent.id}`;
  const discovery = await fetch(`${base}/runtime/discovery`, { headers: { cookie: ownerCookie } });
  assert.equal(discovery.status, 200);
  assert.equal((await discovery.json()).discovery["discovery.toolsets"].data.data[0].name, "web");
  assert.equal((await fetch(`${base}/runtime/discovery`, { headers: { cookie: peerCookie } })).status, 404);
  assert.equal((await fetch(`${base}/jobs/job_one`, { headers: { cookie: ownerCookie } })).status, 200);
  const updated = await fetch(`${base}/jobs/job_one`, { method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Updated", schedule: "0 9 * * *", prompt: "Research" }) });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).job.name, "Updated");
  assert.equal((await fetch(`${base}/jobs/job_one`, { method: "PATCH", headers: { cookie: peerCookie, "content-type": "application/json" }, body: "{}" })).status, 404);
  assert.ok(["health.detailed", "discovery.models", "discovery.capabilities", "discovery.skills", "discovery.toolsets", "jobs.get", "jobs.update"].every((operation) => calls.some((call) => call.operation === operation)));
});

async function login(baseUrl, email) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

test("Agent workspaces isolate memory, skills, channels, hotspots and usage", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  const ownerCookie = await login(context.baseUrl, "owner@example.test");
  const peerCookie = await login(context.baseUrl, "peer@example.test");
  const rootCookie = await login(context.baseUrl, "root@example.test");
  const base = `${context.baseUrl}/api/user/agents/${context.agent.id}`;

  const noteResponse = await fetch(`${base}/memory-notes`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "Project decision", body: "Use PostgreSQL", wikilinks: ["Architecture"], memoryKind: "project", importance: 5, hermesTarget: "memory" }) });
  assert.equal(noteResponse.status, 201);
  const note = (await noteResponse.json()).note;
  assert.equal(note.agentId, context.agent.id);
  assert.equal(note.memoryKind, "project");
  assert.equal(note.importance, 5);
  assert.equal((await fetch(`${base}/memory-notes`, { headers: { cookie: peerCookie } })).status, 404);
  const search = await (await fetch(`${base}/memory-notes?query=PostgreSQL`, { headers: { cookie: ownerCookie } })).json();
  assert.equal(search.notes.length, 1);
  assert.match(search.notes[0].markdown, /\[\[Architecture\]\]/);
  const graph = await (await fetch(`${context.baseUrl}/memories?agent_id=${context.agent.id}`, { headers: { cookie: ownerCookie } })).json();
  assert.equal(graph[0].event_type, "self");
  assert.equal(graph.find((item) => item.id === note.id).parent_id, `agent:${context.agent.id}`);
  const memoryOverview = await (await fetch(`${context.baseUrl}/api/admin/overview`, { headers: { cookie: rootCookie } })).json();
  assert.equal(memoryOverview.memoryProjections.queued, 1);
  assert.doesNotMatch(JSON.stringify(memoryOverview.memoryProjections), /Project decision|PostgreSQL/);
  const manualSync = await fetch(`${base}/memory-sync`, { method: "POST", headers: { cookie: ownerCookie } });
  assert.equal(manualSync.status, 202);
  assert.equal((await manualSync.json()).sync.status, "pending");
  const update = await fetch(`${base}/memory-notes/${note.id}`, { method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "Project decision", body: "Use PostgreSQL 17", tags: ["database"] }) });
  assert.equal(update.status, 200);
  assert.match((await update.json()).note.markdown, /PostgreSQL 17/);

  const skills = await (await fetch(`${base}/skills`, { headers: { cookie: ownerCookie } })).json();
  assert.equal(skills.discovery.status, "available");
  const skillUpdate = await fetch(`${base}/skills/browser%2Fuse`, { method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) });
  assert.equal(skillUpdate.status, 202);
  assert.equal((await skillUpdate.json()).preference.applyStatus, "pending");

  const channelSecret = "feishu-secret-value";
  const channelUpdate = await fetch(`${base}/channels/feishu`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ displayName: "Work Feishu", credentials: { appId: "app-one", appSecret: channelSecret } }) });
  assert.equal(channelUpdate.status, 202);
  const publicBinding = (await channelUpdate.json()).binding;
  assert.equal(publicBinding.status, "pending");
  assert.equal(publicBinding.credentialEnvelope, undefined);
  assert.doesNotMatch(JSON.stringify(publicBinding), new RegExp(channelSecret));
  const storedBinding = await context.repository.getAgentChannelBinding("org_a", "user_a", context.agent.id, "feishu");
  assert.doesNotMatch(JSON.stringify(storedBinding.credentialEnvelope), new RegExp(channelSecret));

  const personalSecret = "firecrawl-user-secret-value";
  const authorizationResponse = await fetch(`${base}/authorizations`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ service: "firecrawl", label: "My crawler", authType: "api_key", endpointUrl: "https://api.firecrawl.dev/v1", secret: personalSecret, metadata: { projectId: "project-a", ignored: "must-not-store" } }) });
  assert.equal(authorizationResponse.status, 201);
  const authorization = (await authorizationResponse.json()).authorization;
  assert.equal(authorization.status, "stored");
  assert.equal(authorization.credentialEnvelope, undefined);
  assert.equal(authorization.credentialHint, undefined);
  assert.equal(authorization.credentialMasked, "****alue");
  assert.doesNotMatch(JSON.stringify(authorization), new RegExp(personalSecret));
  assert.equal((await fetch(`${base}/authorizations`, { headers: { cookie: peerCookie } })).status, 404);
  const storedAuthorization = await context.repository.getAgentAuthorization("org_a", "user_a", context.agent.id, authorization.id);
  assert.doesNotMatch(JSON.stringify(storedAuthorization.credentialEnvelope), new RegExp(personalSecret));
  assert.deepEqual(JSON.parse(context.providerVault.open(storedAuthorization.credentialEnvelope)), { secret: personalSecret });
  assert.deepEqual(storedAuthorization.metadata, { projectId: "project-a" });
  const adminAuthorizations = (await (await fetch(`${context.baseUrl}/api/admin/integrations`, { headers: { cookie: rootCookie } })).json()).authorizations;
  assert.equal(adminAuthorizations[0].credentialMasked, "****alue");
  assert.doesNotMatch(JSON.stringify(adminAuthorizations), new RegExp(personalSecret));
  const personalModelDenied = await fetch(`${base}/authorizations`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ service: "model-provider", label: "Personal model", authType: "api_key", secret: "personal-model-secret" }) });
  assert.equal(personalModelDenied.status, 403);
  assert.equal((await personalModelDenied.json()).error, "user_custom_keys_disabled");
  await context.repository.upsertModelPolicy({ organizationId: "org_a", allowedModels: ["example/model"], defaultModel: "example/model", userCustomKeysAllowed: true, updatedBy: "root" });
  const personalModelAllowed = await fetch(`${base}/authorizations`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ service: "model-provider", label: "Personal model", authType: "api_key", secret: "personal-model-secret", metadata: { provider: "compatible", model: "example/model" } }) });
  assert.equal(personalModelAllowed.status, 201);
  const revoke = await fetch(`${base}/authorizations/${authorization.id}`, { method: "DELETE", headers: { cookie: ownerCookie } });
  assert.equal(revoke.status, 200);
  assert.equal((await revoke.json()).authorization.status, "revoked");
  assert.equal((await context.repository.getAgentAuthorization("org_a", "user_a", context.agent.id, authorization.id)).credentialEnvelope, null);

  assert.equal((await fetch(`${context.baseUrl}/api/admin/hotspots/refresh`, { method: "POST", headers: { cookie: rootCookie, "content-type": "application/json" }, body: "{}" })).status, 202);
  const hotspots = await (await fetch(`${base}/hotspots`, { headers: { cookie: ownerCookie } })).json();
  assert.equal(hotspots.items[0].title, "Test hotspot");
  const bookmark = await fetch(`${base}/hotspots/${hotspots.items[0].id}/bookmark`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ bookmarked: true }) });
  assert.equal(bookmark.status, 200);
  assert.equal((await bookmark.json()).bookmarked, true);
  assert.equal((await (await fetch(`${base}/hotspots`, { headers: { cookie: ownerCookie } })).json()).items[0].bookmarked, true);

  await context.repository.saveAgentHeartbeat({ organizationId: "org_a", userId: "user_a", agentId: context.agent.id, runtimeId: context.runtime.id, sequence: 1, status: "healthy", observedAt: new Date().toISOString(), components: [], usage: { bucketStart: "2026-07-16T00:00:00.000Z", bucketSeconds: 3600, model: "example/model", inputTokens: 12, outputTokens: 8, estimatedCostUsd: 0.01, runCount: 1, failedRunCount: 0, latencySumMs: 20 } });
  const usage = await (await fetch(`${base}/usage`, { headers: { cookie: ownerCookie } })).json();
  assert.equal(usage.summary.inputTokens, 12);
  assert.equal(usage.summary.outputTokens, 8);
  assert.equal((await fetch(`${base}/usage`, { headers: { cookie: peerCookie } })).status, 404);

  assert.equal((await fetch(`${base}/memory-notes/${note.id}`, { method: "DELETE", headers: { cookie: ownerCookie } })).status, 200);
  assert.equal((await (await fetch(`${base}/memory-notes`, { headers: { cookie: ownerCookie } })).json()).notes.length, 0);
});

test("owners invoke Agent integrations with authorization references while peers remain isolated", async (t) => {
  const calls = [];
  const runtimeClient = {
    operation: async () => ({ ok: true }),
    invokeIntegration: async (options) => {
      calls.push(options);
      return { request_id: "request_1", integration_id: options.integrationId, status: "completed", output: { markdown: "authorized" }, trace: { correlation_id: "trace_1" }, completed_at: new Date().toISOString() };
    }
  };
  const context = await setup({ runtimeClient });
  t.after(() => context.server.close());
  const ownerCookie = await login(context.baseUrl, "owner@example.test");
  const peerCookie = await login(context.baseUrl, "peer@example.test");
  const base = `${context.baseUrl}/api/user/agents/${context.agent.id}`;
  const stored = await fetch(`${base}/authorizations`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ service: "firecrawl", label: "Crawler", authType: "api_key", secret: "private-runtime-secret" }) });
  const authorization = (await stored.json()).authorization;
  const endpoint = `${base}/integrations/firecrawl/scrape`;
  const response = await fetch(endpoint, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ authorizationId: authorization.id, input: { url: "https://example.test" } }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).output.markdown, "authorized");
  assert.equal(calls[0].principal.userId, "user_a");
  assert.equal(calls[0].agent.id, context.agent.id);
  assert.equal(calls[0].authorizationId, authorization.id);
  assert.doesNotMatch(JSON.stringify(calls), /private-runtime-secret/);
  assert.equal((await fetch(endpoint, { method: "POST", headers: { cookie: peerCookie, "content-type": "application/json" }, body: "{}" })).status, 404);
  assert.equal((await fetch(`${base}/integrations/searxng/search`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ authorizationId: authorization.id, input: { query: "bairui" } }) })).status, 400);
});

test("owners preview and import character cards without exposing prompts or activating Lorebook", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  const ownerCookie = await login(context.baseUrl, "owner@example.test");
  const peerCookie = await login(context.baseUrl, "peer@example.test");
  const rootCookie = await login(context.baseUrl, "root@example.test");
  const endpoint = `${context.baseUrl}/api/user/agents/${context.agent.id}/character-card`;
  const card = { format: "json", content: { spec: "chara_card_v2", spec_version: "2.0", data: { name: "Research Ada", description: "Research partner", personality: "Precise", first_mes: "Private greeting", mes_example: "Private example", character_book: { entries: [{ keys: ["engine"], content: "Private lore", enabled: true }] }, extensions: { javascript: "must-not-run()" } } } };

  assert.equal((await fetch(endpoint, { method: "POST", headers: { cookie: peerCookie, "content-type": "application/json" }, body: JSON.stringify({ card, previewOnly: true }) })).status, 404);
  const preview = await fetch(endpoint, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ card, previewOnly: true }) });
  assert.equal(preview.status, 200);
  const previewBody = await preview.json();
  assert.equal(previewBody.card.name, "Research Ada");
  assert.equal(previewBody.mapping.executableExtensions, "ignored");
  assert.doesNotMatch(JSON.stringify(previewBody), /Private greeting|Private lore|must-not-run/);
  assert.equal((await fetch(endpoint, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ card }) })).status, 400);

  const imported = await fetch(endpoint, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ card, confirmUntrustedPrompts: true }) });
  assert.equal(imported.status, 202);
  const result = await imported.json();
  assert.equal(result.application.state, "pending_initialization");
  assert.deepEqual(result.notes, { stored: 2, hermesActive: 0 });
  const storedAgent = await context.repository.getAgent(context.agent.id);
  assert.equal(storedAgent.name, "Research Ada");
  assert.match(storedAgent.soulMarkdown, /Precise/);
  assert.doesNotMatch(storedAgent.soulMarkdown, /Private greeting|Private example|Private lore|must-not-run/);
  const notes = await context.repository.listObsidianNotes("org_a", "user_a", context.agent.id);
  assert.equal(notes.length, 2);
  assert.ok(notes.every((note) => note.hermesTarget === "none"));
  assert.match(notes.map((note) => note.markdown).join("\n"), /Private greeting/);

  const fleet = await (await fetch(`${context.baseUrl}/api/admin/agents`, { headers: { cookie: rootCookie } })).json();
  const fleetAgent = fleet.agents.find((item) => item.id === context.agent.id);
  assert.equal(fleetAgent.soulMarkdown, undefined);
  assert.equal(fleetAgent.settings, undefined);
  assert.equal(fleetAgent.description, undefined);
  assert.doesNotMatch(JSON.stringify(fleetAgent), /Private greeting|Private lore|Precise/);
});

test("skill preferences flow through provision and owner-scoped config receipts", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  const ownerCookie = await login(context.baseUrl, "owner@example.test");
  const base = `${context.baseUrl}/api/user/agents/${context.agent.id}`;
  await context.repository.createServer({ id: "server_skill", organizationId: "org_a", name: "Skill Host", status: "healthy" });

  const disabledResponse = await fetch(`${base}/skills/browser%2Fuse`, { method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) });
  assert.equal(disabledResponse.status, 202);
  assert.equal((await disabledResponse.json()).application.state, "pending_initialization");
  const preferences = await context.repository.listAgentSkillPreferences("org_a", "user_a", context.agent.id);
  const provision = await context.repository.requestAgentProvisioning({ agentId: context.agent.id, requestedBy: "user_a", provider: { provider: "compatible", baseUrl: "https://models.example.test/v1", model: "example/model" }, skills: preferences, secretEnvelope: { providerApiKey: { encrypted: true }, runtimeSharedSecret: { encrypted: true }, hermesApiServerKey: { encrypted: true }, agentControlToken: { encrypted: true } }, agentCredentialHash: "a".repeat(64), agentCredentialHint: "test" });
  const [provisionCommand] = await context.repository.leaseControlCommands({ serverId: "server_skill", limit: 5, leaseSeconds: 120 });
  assert.deepEqual(provisionCommand.config.document.skills.disabled, ["browser/use"]);
  const provisionReceipt = { commandId: provision.command.id, serverId: "server_skill", attempt: provisionCommand.attempt };
  await context.repository.recordCommandReceipt({ ...provisionReceipt, state: "accepted" });
  await context.repository.recordCommandReceipt({ ...provisionReceipt, state: "running" });
  await context.repository.recordCommandReceipt({ ...provisionReceipt, state: "succeeded", runtimeEndpointRef: "http://127.0.0.1:19100" });
  assert.equal((await context.repository.listAgentSkillPreferences("org_a", "user_a", context.agent.id))[0].applyStatus, "applied");

  const enabledResponse = await fetch(`${base}/skills/browser%2Fuse`, { method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) });
  const enabled = await enabledResponse.json();
  assert.equal(enabled.application.state, "queued");
  const [applyCommand] = await context.repository.leaseControlCommands({ serverId: "server_skill", limit: 5, leaseSeconds: 120 });
  assert.equal(applyCommand.action, "config.apply-user");
  assert.equal(applyCommand.approval_id, undefined);
  assert.equal(applyCommand.config.secret_envelope, undefined);
  assert.deepEqual(applyCommand.arguments, { config_revision_id: enabled.application.configRevisionId });
  assert.deepEqual(applyCommand.config.document.skills.disabled, []);
  const applyReceipt = { commandId: applyCommand.command_id, serverId: "server_skill", attempt: applyCommand.attempt };
  await context.repository.recordCommandReceipt({ ...applyReceipt, state: "accepted" });
  await context.repository.recordCommandReceipt({ ...applyReceipt, state: "running" });
  await context.repository.recordCommandReceipt({ ...applyReceipt, state: "succeeded" });
  assert.equal((await context.repository.listAgentSkillPreferences("org_a", "user_a", context.agent.id))[0].applyStatus, "applied");

  const identityResponse = await fetch(base, { method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Hermes Ada", soulMarkdown: "# Identity\n\nEvidence first." }) });
  assert.equal(identityResponse.status, 200);
  assert.equal((await identityResponse.json()).application.state, "queued");
  const [identityCommand] = await context.repository.leaseControlCommands({ serverId: "server_skill", limit: 5, leaseSeconds: 120 });
  assert.equal(identityCommand.config.document.owner_change.scope, "identity");
  assert.deepEqual(identityCommand.config.document.agent, { id: context.agent.id, name: "Hermes Ada", soul_markdown: "# Identity\n\nEvidence first." });
  const identityReceipt = { commandId: identityCommand.command_id, serverId: "server_skill", attempt: identityCommand.attempt };
  await context.repository.recordCommandReceipt({ ...identityReceipt, state: "accepted" });
  await context.repository.recordCommandReceipt({ ...identityReceipt, state: "running" });
  await context.repository.recordCommandReceipt({ ...identityReceipt, state: "succeeded" });
  assert.equal((await context.repository.listAgentSkillPreferences("org_a", "user_a", context.agent.id))[0].applyStatus, "applied");
});
