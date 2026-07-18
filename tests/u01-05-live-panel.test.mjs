import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fixtureCredentials, startBrowserFixture } from "./browser/fixture-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function login(baseUrl, credentials) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials)
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";", 1)[0];
}

async function firstSseFrame(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (!text.includes("\n\n")) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    while (text.startsWith("retry:")) text = text.slice(text.indexOf("\n\n") + 2);
    while (!text.includes("\n\n")) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    return text.slice(0, text.indexOf("\n\n") + 2);
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

test("U01-05 hotspot panel closes the five-layer loop and rejects cross-owner access", async (t) => {
  const fixture = await startBrowserFixture();
  t.after(() => fixture.close());
  const ownerCookie = await login(fixture.baseUrl, fixtureCredentials.user);
  const peerCookie = await login(fixture.baseUrl, { email: "peer@example.test", password: fixtureCredentials.user.password });
  const base = `${fixture.baseUrl}/api/user/agents/agent_remote/ui/panels`;

  const manifestResponse = await fetch(base, { headers: { cookie: ownerCookie } });
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.schema_version, "bairui.panel-manifest.v1");
  assert.equal(manifest.upstream.commit, "34d939eabe226c561550079cb810090015b49817");
  assert.deepEqual(manifest.panels.filter((panel) => panel.priority === "P0").map((panel) => panel.id), ["shell-layout", "memory-graph", "chat", "scene-shell", "settings", "social-channels", "hotspots", "person-card"]);
  const initialContract = manifest.panels.find((panel) => panel.id === "hotspots");
  assert.equal(initialContract.state, "needs_configuration");
  assert.match(initialContract.events.endpoint, /\/ui\/panels\/hotspots\/events$/);

  const peerManifest = await fetch(base, { headers: { cookie: peerCookie } });
  assert.equal(peerManifest.status, 404);
  assert.doesNotMatch(await peerManifest.text(), /owner@example|user_remote|agent_remote.*name/i);

  const initialResponse = await fetch(`${base}/hotspots/snapshot`, { headers: { cookie: ownerCookie } });
  assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json();
  assert.equal(initial.state, "needs_configuration");
  assert.equal(initial.revision, 0);
  assert.deepEqual(initial.data.items, []);

  const refreshResponse = await fetch(`${base}/hotspots/commands`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ command: "refresh", command_id: "u01-05-refresh-1", base_revision: 0, payload: { sources: ["weibo"] } })
  });
  assert.equal(refreshResponse.status, 200);
  const refresh = await refreshResponse.json();
  assert.equal(refresh.status, "completed");
  assert.equal(refresh.revision, 1);
  assert.equal(refresh.patch.base_revision, 0);
  assert.equal(refresh.patch.revision, 1);
  assert.equal(refresh.snapshot.state, "available");
  assert.equal(refresh.snapshot.data.items[0].title, "U01-05 真实链路热点");
  assert.equal(refresh.snapshot.owner_scope.user_id, "user_remote");

  const integration = fixture.runtimeOperations.find((operation) => operation.operation === "integration:trendradar.list_hotspots");
  assert.ok(integration, "the panel command must cross Runtime Boundary into the TrendRadar adapter");
  assert.deepEqual(integration.input.sources, ["weibo"]);

  const persisted = await (await fetch(`${base}/hotspots/snapshot`, { headers: { cookie: ownerCookie } })).json();
  assert.equal(persisted.revision, 1);
  assert.equal(persisted.data.run.status, "completed");
  assert.equal(persisted.data.native.platforms.weibo[0].text, "U01-05 真实链路热点");

  const stale = await fetch(`${base}/hotspots/commands`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ command: "visibility", command_id: "u01-05-stale-1", base_revision: 0, payload: { visible: false } })
  });
  assert.equal(stale.status, 409);
  const staleBody = await stale.json();
  assert.equal(staleBody.error, "scene_revision_conflict");
  assert.equal(staleBody.current.revision, 1);

  const resync = await fetch(`${base}/hotspots/commands`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ command: "resync", command_id: "u01-05-resync-1", base_revision: 1, payload: { reason: "acceptance" } })
  });
  assert.equal(resync.status, 200);
  assert.equal((await resync.json()).revision, 1);

  const events = await fetch(`${base}/hotspots/events?after=0`, { headers: { cookie: ownerCookie, accept: "text/event-stream" } });
  assert.equal(events.status, 200);
  const frame = await firstSseFrame(events);
  assert.match(frame, /id: 1\n/);
  assert.match(frame, /event: scene\n/);
  assert.match(frame, /"rev":1/);

  const peerSnapshot = await fetch(`${base}/hotspots/snapshot`, { headers: { cookie: peerCookie } });
  assert.equal(peerSnapshot.status, 404);
  assert.equal((await fetch(`${fixture.baseUrl}/audit/stats?hours=1`, { headers: { cookie: ownerCookie } })).status, 501);
  assert.equal((await fetch(`${fixture.baseUrl}/hotspot-state`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: "{}" })).status, 410);

  const evidence = {
    schema_version: "u01-05.evidence.v1",
    upstream_commit: manifest.upstream.commit,
    panel_id: "hotspots",
    owner_scope: refresh.snapshot.owner_scope,
    layers: {
      ui: "BaiLongma hotspot panel extension",
      channel: "Agent-scoped Panel BFF and Scene SSE",
      runtime: "RuntimeClient.invokeIntegration",
      integration: "trendradar.list_hotspots",
      storage: "PostgreSQL-compatible integration run, items, bookmarks and Agent Scene"
    },
    revision: refresh.revision,
    assertions: { snapshot: true, command: true, events: true, persistence: true, revision_conflict: true, resync: true, cross_owner_404: true, fake_compatibility_removed: true }
  };
  const evidenceDir = path.join(root, "test-results", "u01-05");
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "live-panel.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
});
