import test from "node:test";
import assert from "node:assert/strict";
import { collectControlPlaneSnapshot, sendHeartbeat } from "../server-agent/index.mjs";

test("server agent validates control-plane snapshots", async () => {
  const snapshot = await collectControlPlaneSnapshot({
    agentRoot: ".",
    execFile: async () => ({ stdout: JSON.stringify({ schemaVersion: "1.0", status: "healthy" }) })
  });
  assert.equal(snapshot.status, "healthy");
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
