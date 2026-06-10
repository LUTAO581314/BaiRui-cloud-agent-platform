import test from "node:test";
import assert from "node:assert/strict";
import { HEARTBEAT_PROTOCOL_VERSION } from "../../packages/server-protocol/index.mjs";
import { createPostgresRegistryStorage } from "./postgres-registry.mjs";

const heartbeat = {
  protocol_version: HEARTBEAT_PROTOCOL_VERSION,
  server_id: "srv_pg",
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

test("postgres storage records heartbeat with upsert SQL", async () => {
  const calls = [];
  const storage = createPostgresRegistryStorage({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    }
  });

  const result = await storage.recordHeartbeat(heartbeat, {
    receivedAt: "2026-06-10T00:00:01.000Z"
  });

  assert.equal(result.accepted, true);
  assert.equal(result.server.server_id, "srv_pg");
  assert.match(calls[0].sql, /insert into customer_servers/);
  assert.equal(calls[0].params[0], "srv_pg");
});

test("postgres storage lists customer servers", async () => {
  const storage = createPostgresRegistryStorage({
    async query(sql) {
      assert.match(sql, /from customer_servers/);
      return { rows: [{ server_id: "srv_pg" }] };
    }
  });

  const servers = await storage.listServers();
  assert.deepEqual(servers, [{ server_id: "srv_pg" }]);
});

test("postgres storage rejects invalid heartbeat before SQL", async () => {
  let called = false;
  const storage = createPostgresRegistryStorage({
    async query() {
      called = true;
      return { rows: [] };
    }
  });

  const result = await storage.recordHeartbeat({ server_id: "" });
  assert.equal(result.accepted, false);
  assert.equal(called, false);
});

test("postgres storage records customer acceptance report", async () => {
  const calls = [];
  const storage = createPostgresRegistryStorage({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    }
  });

  const result = await storage.recordAcceptanceReport({
    accepted: false,
    generated_at: "2026-06-10T00:00:02.000Z",
    server_id: "srv_pg",
    organization_id: "org_1",
    license_id: "lic_1",
    checks: [
      { name: "hermes_heartbeat", passed: true, details: {} },
      { name: "platform_server_registry", passed: false, error: "missing" }
    ]
  }, {
    receivedAt: "2026-06-10T00:00:03.000Z"
  });

  assert.equal(result.accepted, true);
  assert.equal(result.report.failed_check_count, 1);
  assert.match(calls[0].sql, /insert into server_acceptance_reports/);
  assert.equal(calls[0].params[0], "srv_pg");
  assert.equal(calls[0].params[5], 1);
});

test("postgres storage lists customer acceptance reports", async () => {
  const storage = createPostgresRegistryStorage({
    async query(sql, params) {
      assert.match(sql, /from server_acceptance_reports/);
      assert.deepEqual(params, ["srv_pg"]);
      return { rows: [{ server_id: "srv_pg", accepted: true }] };
    }
  });

  const reports = await storage.listAcceptanceReports({ serverId: "srv_pg" });
  assert.deepEqual(reports, [{ server_id: "srv_pg", accepted: true }]);
});
