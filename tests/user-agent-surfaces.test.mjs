import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { createPlatformServer } from "../apps/web/app.mjs";
import { ROLES } from "../packages/auth/authorization.mjs";
import { hashPassword } from "../packages/auth/password.mjs";
import { MemoryPlatformRepository } from "../packages/db/memory-repository.mjs";
import { SecretEnvelope } from "../packages/security/secret-envelope.mjs";

const password = "Correct-Horse-Battery-Staple-2026";

async function setup() {
  const repository = new MemoryPlatformRepository();
  await repository.createOrganization({ id: "org_a", name: "Organization A" });
  const passwordHash = await hashPassword(password);
  const owner = await repository.createUser({ id: "user_a", organizationId: "org_a", email: "owner@example.test", displayName: "Owner", passwordHash, role: ROLES.USER });
  await repository.createUser({ id: "user_b", organizationId: "org_a", email: "peer@example.test", displayName: "Peer", passwordHash, role: ROLES.USER });
  await repository.createUser({ id: "root", organizationId: "org_a", email: "root@example.test", displayName: "Root", passwordHash, role: ROLES.PLATFORM_ADMIN });
  const agent = await repository.createAgent({ id: "agent_a", organizationId: "org_a", ownerUserId: owner.id, name: "Agent A" });
  const runtime = await repository.createAgentRuntime({ id: "runtime_a", organizationId: "org_a", ownerUserId: owner.id, agentId: agent.id, workspaceRef: "hermes:org_a:user_a:agent_a" });
  const runtimeClient = {
    operation: async ({ operation }) => operation === "discovery.skills" ? { object: "list", data: [{ id: "browser/use", name: "Browser" }] } : { ok: true },
    invokeIntegration: async () => ({ status: "completed", completed_at: "2026-07-15T00:00:01.000Z", output: { sources: [{ source_id: "baidu", status: "ready", count: 1 }], items: [{ external_id: "one", source_id: "baidu", source_name: "Baidu", rank: 1, title: "Test hotspot", url: "https://www.baidu.com/", mobile_url: "", heat: "", category: "", fetched_at: "2026-07-15T00:00:00.000Z" }] } })
  };
  const { privateKey } = generateKeyPairSync("ed25519");
  const server = createPlatformServer({
    repository,
    runtimeClient,
    sessionSecret: "user-surfaces-session-secret-longer-than-32-characters",
    secureCookies: false,
    providerVault: new SecretEnvelope("user-surfaces-encryption-key-longer-than-32-characters"),
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
  return { repository, agent, runtime, server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

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

  const noteResponse = await fetch(`${base}/memory-notes`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "Project decision", body: "Use PostgreSQL", wikilinks: ["Architecture"] }) });
  assert.equal(noteResponse.status, 201);
  const note = (await noteResponse.json()).note;
  assert.equal(note.agentId, context.agent.id);
  assert.equal((await fetch(`${base}/memory-notes`, { headers: { cookie: peerCookie } })).status, 404);
  const search = await (await fetch(`${base}/memory-notes?query=PostgreSQL`, { headers: { cookie: ownerCookie } })).json();
  assert.equal(search.notes.length, 1);
  assert.match(search.notes[0].markdown, /\[\[Architecture\]\]/);
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
