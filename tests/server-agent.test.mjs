import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentHeartbeat, collectControlPlaneSnapshot, sendAgentHeartbeat, sendHeartbeat } from "../server-agent/index.mjs";

test("server agent validates control-plane snapshots", async () => {
  const snapshot = await collectControlPlaneSnapshot({
    agentRoot: ".",
    execFile: async () => ({ stdout: JSON.stringify({ schemaVersion: "1.0", status: "healthy" }) })
  });
  assert.equal(snapshot.status, "healthy");
});

test("server agent emits Agent-scoped five-layer telemetry without business content", async () => {
  const snapshot = { schemaVersion: "1.0", timestamp: "2026-07-16T00:00:00.000Z", status: "healthy", heartbeat: { hermesVersion: "hermes-1", runtimeBoundaryVersion: "0.3.0" }, modules: [{ moduleId: "bairui.core", layer: "core-runtime", version: "1", capabilities: ["runtime"] }], health: [{ moduleId: "bairui.core", status: "healthy" }] };
  const heartbeat = buildAgentHeartbeat(snapshot, { organizationId: "org_a", userId: "user_a", agentId: "agent_a", runtimeId: "runtime_a", sequence: 7 });
  assert.equal(heartbeat.agentId, "agent_a");
  assert.equal(heartbeat.components[0].layer, "core-runtime");
  assert.equal("prompt" in heartbeat, false);
  let request;
  await sendAgentHeartbeat({ platformUrl: "https://platform.example.test", ingestToken: "machine-token", organizationId: "org_a", userId: "user_a", agentId: "agent_a", runtimeId: "runtime_a", heartbeat, fetch: async (url, options) => { request = { url, options }; return Response.json({ id: "heartbeat_a" }, { status: 202 }); } });
  assert.match(request.url, /\/api\/internal\/control-plane\/heartbeats$/);
  assert.equal(JSON.parse(request.options.body).runtimeId, "runtime_a");
});

test("server agent sends only the explicit snapshot envelope", async () => {
  let request;
  const response = await sendHeartbeat({
    platformUrl: "https://platform.example.test",
    ingestToken: "machine-token",
    organizationId: "org_a",
    serverId: "server_a",
    snapshot: { schemaVersion: "1.0", status: "healthy", modules: [] },
    fetch: async (url, options) => { request = { url, options }; return Response.json({ id: "snapshot_a" }, { status: 202 }); }
  });
  assert.equal(response.id, "snapshot_a");
  assert.equal(request.options.headers.authorization, "Bearer machine-token");
  const body = JSON.parse(request.options.body);
  assert.equal(body.organizationId, "org_a");
  assert.equal(body.snapshot.status, "healthy");
  assert.equal("apiKey" in body, false);
});
