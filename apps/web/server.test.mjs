import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HEARTBEAT_PROTOCOL_VERSION } from "../../packages/server-protocol/index.mjs";
import { createPlatformServer } from "./server.mjs";

const heartbeat = {
  protocol_version: HEARTBEAT_PROTOCOL_VERSION,
  server_id: "srv_http",
  organization_id: "org_1",
  license_id: "lic_1",
  license_status: "valid",
  hermes_version: "0.1.0",
  health_status: "ok",
  database_status: "ready",
  backup_status: "not_configured",
  connector_status_summary: {},
  error_count_24h: 0,
  brand_key: "bairui",
  created_at: "2026-06-10T00:00:00.000Z"
};

async function withServer(testFn) {
  const dir = await mkdtemp(join(tmpdir(), "bairui-api-"));
  const server = createPlatformServer({
    registryPath: join(dir, "server-registry.json"),
    agentToken: "token"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await testFn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("receives heartbeat and lists server", async () => {
  await withServer(async (baseUrl) => {
    const postResponse = await fetch(`${baseUrl}/api/server-heartbeat`, {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json"
      },
      body: JSON.stringify({ heartbeat })
    });
    assert.equal(postResponse.status, 202);

    const listResponse = await fetch(`${baseUrl}/api/servers`);
    const body = await listResponse.json();
    assert.equal(body.servers.length, 1);
    assert.equal(body.servers[0].server_id, "srv_http");
  });
});

test("receives acceptance report and lists report summaries", async () => {
  await withServer(async (baseUrl) => {
    const report = {
      accepted: true,
      generated_at: "2026-06-10T00:00:02.000Z",
      server_id: "srv_http",
      organization_id: "org_1",
      license_id: "lic_1",
      checks: [{ name: "hermes_heartbeat", passed: true, details: {} }]
    };

    const postResponse = await fetch(`${baseUrl}/api/server-acceptance`, {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json"
      },
      body: JSON.stringify({ report })
    });
    assert.equal(postResponse.status, 202);

    const listResponse = await fetch(`${baseUrl}/api/server-acceptance?server_id=srv_http`);
    const body = await listResponse.json();
    assert.equal(body.reports.length, 1);
    assert.equal(body.reports[0].server_id, "srv_http");
    assert.equal(body.reports[0].accepted, true);
  });
});

test("rejects heartbeat without agent token", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/server-heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ heartbeat })
    });
    assert.equal(response.status, 401);
  });
});

test("rejects acceptance report without agent token", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/server-acceptance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report: { server_id: "srv_http" } })
    });
    assert.equal(response.status, 401);
  });
});
