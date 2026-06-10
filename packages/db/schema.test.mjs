import test from "node:test";
import assert from "node:assert/strict";
import { HEARTBEAT_PROTOCOL_VERSION } from "../server-protocol/index.mjs";
import { acceptanceSqlParams, buildAcceptanceInsertSql, buildHeartbeatUpsertSql, buildMigrationSql, heartbeatSqlParams } from "./schema.mjs";

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
  connector_status_summary: { feishu: "missing_config" },
  error_count_24h: 0,
  brand_key: "bairui",
  created_at: "2026-06-10T00:00:00.000Z"
};

test("migration SQL includes commercial server registry tables", () => {
  const sql = buildMigrationSql();
  assert.match(sql, /create table if not exists organizations/);
  assert.match(sql, /create table if not exists licenses/);
  assert.match(sql, /create table if not exists customer_servers/);
  assert.match(sql, /create table if not exists server_heartbeats/);
  assert.match(sql, /create table if not exists server_acceptance_reports/);
  assert.doesNotMatch(sql, /chat_content|obsidian_note_body|model_api_key|connector_token/);
});

test("heartbeat upsert SQL targets server registry and heartbeat history", () => {
  const sql = buildHeartbeatUpsertSql();
  assert.match(sql, /insert into customer_servers/);
  assert.match(sql, /on conflict \(id\) do update/);
  assert.match(sql, /insert into server_heartbeats/);
});

test("heartbeat SQL params preserve operational metadata only", () => {
  const params = heartbeatSqlParams(heartbeat, "2026-06-10T00:00:01.000Z");
  assert.equal(params[0], "srv_1");
  assert.equal(params[1], "org_1");
  assert.equal(params[2], "lic_1");
  assert.equal(params[4], "bairui");
  assert.equal(params[13], HEARTBEAT_PROTOCOL_VERSION);
  assert.equal(JSON.parse(params[14]).server_id, "srv_1");
});

test("acceptance report SQL stores report summary and payload", () => {
  const report = {
    accepted: false,
    generated_at: "2026-06-10T00:00:02.000Z",
    server_id: "srv_1",
    organization_id: "org_1",
    license_id: "lic_1",
    checks: [
      { name: "hermes_heartbeat", passed: true, details: {} },
      { name: "platform_server_registry", passed: false, error: "missing" }
    ]
  };
  const sql = buildAcceptanceInsertSql();
  const params = acceptanceSqlParams(report, "2026-06-10T00:00:03.000Z");
  assert.match(sql, /insert into server_acceptance_reports/);
  assert.equal(params[0], "srv_1");
  assert.equal(params[4], 2);
  assert.equal(params[5], 1);
  assert.equal(params[6], JSON.stringify(report));
});
