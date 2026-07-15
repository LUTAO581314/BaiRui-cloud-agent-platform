import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import { createPlatformServer } from "../apps/web/app.mjs";
import { MemoryPlatformRepository } from "../packages/db/memory-repository.mjs";
import { hashPassword } from "../packages/auth/password.mjs";
import { ROLES } from "../packages/auth/authorization.mjs";

const sessionSecret = "http-test-session-secret-that-is-longer-than-32-characters";

async function setup() {
  const repository = new MemoryPlatformRepository();
  await repository.createOrganization({ id: "org_a", name: "Organization A" });
  await repository.createOrganization({ id: "org_b", name: "Organization B" });
  const passwordHash = await hashPassword("Correct-Horse-Battery-Staple-2026");
  const user = await repository.createUser({ id: "user_a", organizationId: "org_a", email: "user@example.test", displayName: "User", passwordHash, role: ROLES.USER });
  const orgAdmin = await repository.createUser({ id: "admin_a", organizationId: "org_a", email: "org-admin@example.test", displayName: "Org Admin", passwordHash, role: ROLES.ORG_ADMIN });
  const otherUser = await repository.createUser({ id: "user_b", organizationId: "org_b", email: "other@example.test", displayName: "Other", passwordHash, role: ROLES.USER });
  const platformAdmin = await repository.createUser({ id: "root", organizationId: "org_a", email: "root@example.test", displayName: "Root", passwordHash, role: ROLES.PLATFORM_ADMIN });
  const agent = await repository.createAgent({ id: "agent_a", organizationId: "org_a", name: "Agent" });
  const conversation = await repository.createConversation({ id: "conversation_a", organizationId: "org_a", userId: user.id, agentId: agent.id, title: "Private" });
  const { privateKey } = generateKeyPairSync("ed25519");
  const server = createPlatformServer({ repository, sessionSecret, secureCookies: false, agentIngestToken: "agent-ingest-test-token", licensePrivateKey: privateKey, styles: "", logo: Buffer.from("logo"), icon: Buffer.from("icon"), loginScript: "login", userScript: "user", adminScript: "admin-only", logger: { error() {} } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { repository, server, baseUrl, users: { user, orgAdmin, otherUser, platformAdmin }, conversation };
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
  assert.match(await workspacePage.text(), /brain-layout/);
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

test("conversation ownership is enforced and runtime absence is explicit", async (t) => {
  const context = await setup();
  t.after(() => context.server.close());
  const otherCookie = await login(context.baseUrl, "other@example.test");
  assert.equal((await fetch(`${context.baseUrl}/api/user/conversations/${context.conversation.id}/messages`, { headers: { cookie: otherCookie } })).status, 404);
  const userCookie = await login(context.baseUrl, "user@example.test");
  const response = await fetch(`${context.baseUrl}/api/user/conversations/${context.conversation.id}/messages`, {
    method: "POST",
    headers: { cookie: userCookie, "content-type": "application/json" },
    body: JSON.stringify({ content: "Hello" })
  });
  assert.equal(response.status, 503);
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
