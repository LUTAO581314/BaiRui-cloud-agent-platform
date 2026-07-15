import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import { createPlatformServer } from "../apps/web/app.mjs";
import { MemoryPlatformRepository } from "../packages/db/memory-repository.mjs";
import { hashPassword } from "../packages/auth/password.mjs";
import { ROLES } from "../packages/auth/authorization.mjs";
import { SecretEnvelope } from "../packages/security/secret-envelope.mjs";
import { createBailongmaUi } from "../packages/bailongma-ui/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sessionSecret = "http-test-session-secret-that-is-longer-than-32-characters";
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
  const { privateKey } = generateKeyPairSync("ed25519");
  const server = createPlatformServer({ repository, sessionSecret, secureCookies: false, agentIngestToken: "agent-ingest-test-token", licensePrivateKey: privateKey, providerVault: new SecretEnvelope("http-test-provider-encryption-key-longer-than-32-characters"), styles: "", logo: Buffer.from("logo"), icon: Buffer.from("icon"), loginScript: "login", adminScript: "admin-only", bailongmaUi, bailongmaOverlayCss: "overlay-css", bailongmaOverlayScript: "overlay-script", bailongmaSceneBootstrap: "export function bootstrapScene() {}", logger: { error() {} }, ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { repository, server, baseUrl, users: { user, sameOrgUser, orgAdmin, otherUser, platformAdmin }, agent };
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
  assert.doesNotMatch(workspaceHtml, /\/assets\/user\.js/);
  assert.equal((await fetch(`${context.baseUrl}/assets/user.js`, { headers: { cookie } })).status, 404);
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

  const denied = await fetch(`${context.baseUrl}/api/user/agents/${context.agent.id}/sessions`, { headers: { cookie: sameOrgCookie } });
  assert.equal(denied.status, 404);
  assert.equal(operations.length, 2);
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
