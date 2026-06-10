import test from "node:test";
import assert from "node:assert/strict";
import { HEARTBEAT_PROTOCOL_VERSION } from "../packages/server-protocol/index.mjs";
import { loadAcceptanceConfig, postAcceptanceReport, runAcceptance } from "./acceptance.mjs";

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

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

test("loads acceptance config from environment", () => {
  const config = loadAcceptanceConfig({
    BAIRUI_HERMES_HEARTBEAT_URL: "http://hermes.local/platform/heartbeat",
    BAIRUI_PLATFORM_HEARTBEAT_URL: "https://platform.local/api/server-heartbeat",
    BAIRUI_PLATFORM_SERVERS_URL: "https://platform.local/api/servers",
    BAIRUI_PLATFORM_ACCEPTANCE_URL: "https://platform.local/api/server-acceptance",
    BAIRUI_SERVER_AGENT_TOKEN: "token"
  });
  assert.equal(config.hermesHeartbeatUrl, "http://hermes.local/platform/heartbeat");
  assert.equal(config.platformHeartbeatUrl, "https://platform.local/api/server-heartbeat");
  assert.equal(config.platformServersUrl, "https://platform.local/api/servers");
  assert.equal(config.platformAcceptanceUrl, "https://platform.local/api/server-acceptance");
  assert.equal(config.agentToken, "token");
});

test("runs customer acceptance check across Hermes and platform", async () => {
  const config = loadAcceptanceConfig({
    BAIRUI_PLATFORM_HEARTBEAT_URL: "https://platform.local/api/server-heartbeat",
    BAIRUI_PLATFORM_SERVERS_URL: "https://platform.local/api/servers"
  });
  const calls = [];
  const report = await runAcceptance(config, async (url, options) => {
    calls.push({ url, method: options.method });
    if (url === config.hermesHeartbeatUrl) {
      return jsonResponse({ heartbeat });
    }
    if (url === config.platformHeartbeatUrl) {
      return jsonResponse({ accepted: true });
    }
    if (url === config.platformServersUrl) {
      return jsonResponse({
      servers: [
        {
          server_id: "srv_1",
          health_status: "ok",
          license_status: "valid",
          last_heartbeat_at: "2026-06-10T00:00:01.000Z"
        }
      ]
    });
    }
    return jsonResponse({ accepted: true });
  });

  assert.equal(report.accepted, true);
  assert.equal(report.server_id, "srv_1");
  assert.equal(report.checks.length, 4);
  assert.deepEqual(calls.map((call) => call.method), ["GET", "POST", "GET", "POST"]);
});

test("fails acceptance when platform registry does not contain server", async () => {
  const config = loadAcceptanceConfig({
    BAIRUI_PLATFORM_HEARTBEAT_URL: "https://platform.local/api/server-heartbeat"
  });
  const report = await runAcceptance(config, async (url) => {
    if (url === config.hermesHeartbeatUrl) {
      return jsonResponse({ heartbeat });
    }
    if (url === config.platformHeartbeatUrl) {
      return jsonResponse({ accepted: true });
    }
    return jsonResponse({ servers: [] });
  });

  assert.equal(report.accepted, false);
  const registryCheck = report.checks.find((check) => check.name === "platform_server_registry");
  assert.equal(registryCheck.passed, false);
  assert.match(registryCheck.error, /does not include srv_1/);
});

test("posts acceptance report with bearer token", async () => {
  const config = loadAcceptanceConfig({
    BAIRUI_PLATFORM_HEARTBEAT_URL: "https://platform.local/api/server-heartbeat",
    BAIRUI_SERVER_AGENT_TOKEN: "token"
  });
  let request;
  const report = {
    accepted: true,
    generated_at: "2026-06-10T00:00:02.000Z",
    server_id: "srv_1",
    organization_id: "org_1",
    license_id: "lic_1",
    checks: [{ name: "hermes_heartbeat", passed: true, details: {} }]
  };

  await postAcceptanceReport(config, report, async (url, options) => {
    request = { url, options };
    return jsonResponse({ accepted: true });
  });

  assert.equal(request.url, "https://platform.local/api/server-acceptance");
  assert.equal(request.options.headers.authorization, "Bearer token");
  assert.deepEqual(JSON.parse(request.options.body), { report });
});
