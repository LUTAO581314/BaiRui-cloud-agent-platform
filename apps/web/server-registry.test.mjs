import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HEARTBEAT_PROTOCOL_VERSION } from "../../packages/server-protocol/index.mjs";
import { createJsonRegistryStorage, listAcceptanceReports, listServers, recordAcceptanceReport, recordHeartbeat } from "./server-registry.mjs";

const heartbeat = {
  protocol_version: HEARTBEAT_PROTOCOL_VERSION,
  server_id: "srv_1",
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

async function withRegistry(testFn) {
  const dir = await mkdtemp(join(tmpdir(), "bairui-registry-"));
  try {
    await testFn(join(dir, "server-registry.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("records heartbeat into server registry", async () => {
  await withRegistry(async (registryPath) => {
    const result = await recordHeartbeat(heartbeat, {
      registryPath,
      receivedAt: "2026-06-10T00:00:01.000Z"
    });
    assert.equal(result.accepted, true);
    assert.equal(result.server.server_id, "srv_1");

    const servers = await listServers({ registryPath });
    assert.equal(servers.length, 1);
    assert.equal(servers[0].license_status, "valid");
    assert.equal(servers[0].last_seen_at, "2026-06-10T00:00:01.000Z");
  });
});

test("rejects invalid heartbeat", async () => {
  await withRegistry(async (registryPath) => {
    const result = await recordHeartbeat({ server_id: "" }, { registryPath });
    assert.equal(result.accepted, false);
    assert.equal(result.status, 400);
    assert.ok(result.errors.includes("server_id is required"));
  });
});

test("records customer acceptance report", async () => {
  await withRegistry(async (registryPath) => {
    const result = await recordAcceptanceReport({
      accepted: true,
      generated_at: "2026-06-10T00:00:02.000Z",
      server_id: "srv_1",
      organization_id: "org_1",
      license_id: "lic_1",
      checks: [{ name: "hermes_heartbeat", passed: true, details: {} }]
    }, {
      registryPath,
      receivedAt: "2026-06-10T00:00:03.000Z"
    });

    assert.equal(result.accepted, true);
    assert.equal(result.report.server_id, "srv_1");
    assert.equal(result.report.failed_check_count, 0);

    const reports = await listAcceptanceReports({ registryPath, serverId: "srv_1" });
    assert.equal(reports.length, 1);
    assert.equal(reports[0].received_at, "2026-06-10T00:00:03.000Z");
  });
});

test("rejects invalid customer acceptance report", async () => {
  await withRegistry(async (registryPath) => {
    const result = await recordAcceptanceReport({ server_id: "" }, { registryPath });
    assert.equal(result.accepted, false);
    assert.equal(result.status, 400);
    assert.ok(result.errors.includes("organization_id is required"));
  });
});

test("json storage reports fallback readiness", async () => {
  await withRegistry(async (registryPath) => {
    const readiness = await createJsonRegistryStorage({ registryPath }).getReadiness();
    assert.equal(readiness.ready, true);
    assert.equal(readiness.storage_kind, "json");
    assert.equal(readiness.checks.some((check) => check.name === "server_acceptance_reports" && check.passed), true);
  });
});
