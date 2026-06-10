import { fetchHermesHeartbeat, loadAgentConfig, postHeartbeat } from "./index.mjs";

function deriveServersUrl(platformHeartbeatUrl) {
  if (!platformHeartbeatUrl) {
    return "";
  }
  return platformHeartbeatUrl.replace(/\/api\/server-heartbeat\/?$/, "/api/servers");
}

function deriveAcceptanceUrl(platformHeartbeatUrl) {
  if (!platformHeartbeatUrl) {
    return "";
  }
  return platformHeartbeatUrl.replace(/\/api\/server-heartbeat\/?$/, "/api/server-acceptance");
}

function withCheck(report, name, fn) {
  return fn()
    .then((details) => {
      report.checks.push({ name, passed: true, details });
      return details;
    })
    .catch((error) => {
      report.checks.push({ name, passed: false, error: error.message });
      report.accepted = false;
      return null;
    });
}

async function fetchPlatformServer(config, serverId, fetchImpl) {
  const serversUrl = config.platformServersUrl || deriveServersUrl(config.platformHeartbeatUrl);
  if (!serversUrl) {
    throw new Error("BAIRUI_PLATFORM_SERVERS_URL or BAIRUI_PLATFORM_HEARTBEAT_URL is required.");
  }

  const headers = { accept: "application/json" };
  if (config.agentToken) {
    headers.authorization = `Bearer ${config.agentToken}`;
  }

  const response = await fetchImpl(serversUrl, { method: "GET", headers });
  if (!response.ok) {
    throw new Error(`Platform server registry request failed with HTTP ${response.status}`);
  }

  const body = await response.json();
  const servers = Array.isArray(body.servers) ? body.servers : [];
  const server = servers.find((item) => item.server_id === serverId);
  if (!server) {
    throw new Error(`Platform server registry does not include ${serverId}`);
  }
  return server;
}

export function loadAcceptanceConfig(env = process.env) {
  return {
    ...loadAgentConfig(env),
    platformServersUrl: env.BAIRUI_PLATFORM_SERVERS_URL ?? "",
    platformAcceptanceUrl: env.BAIRUI_PLATFORM_ACCEPTANCE_URL ?? ""
  };
}

export async function postAcceptanceReport(config, report, fetchImpl = fetch) {
  const acceptanceUrl = config.platformAcceptanceUrl || deriveAcceptanceUrl(config.platformHeartbeatUrl);
  if (!acceptanceUrl) {
    throw new Error("BAIRUI_PLATFORM_ACCEPTANCE_URL or BAIRUI_PLATFORM_HEARTBEAT_URL is required.");
  }

  const headers = {
    accept: "application/json",
    "content-type": "application/json"
  };
  if (config.agentToken) {
    headers.authorization = `Bearer ${config.agentToken}`;
  }

  const response = await fetchImpl(acceptanceUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ report })
  });
  if (!response.ok) {
    throw new Error(`Platform acceptance report failed with HTTP ${response.status}`);
  }
  return response.json();
}

export async function runAcceptance(config = loadAcceptanceConfig(), fetchImpl = fetch) {
  const report = {
    accepted: true,
    generated_at: new Date().toISOString(),
    server_id: "",
    organization_id: "",
    license_id: "",
    checks: []
  };

  const heartbeat = await withCheck(report, "hermes_heartbeat", async () => {
    const result = await fetchHermesHeartbeat(config, fetchImpl);
    report.server_id = result.server_id;
    report.organization_id = result.organization_id;
    report.license_id = result.license_id;
    return {
      server_id: result.server_id,
      health_status: result.health_status,
      database_status: result.database_status,
      license_status: result.license_status,
      hermes_version: result.hermes_version
    };
  });

  if (!heartbeat) {
    return report;
  }

  await withCheck(report, "platform_heartbeat_report", async () => {
    const result = await postHeartbeat(config, heartbeat, fetchImpl);
    return { accepted: Boolean(result.accepted ?? true) };
  });

  await withCheck(report, "platform_server_registry", async () => {
    const server = await fetchPlatformServer(config, heartbeat.server_id, fetchImpl);
    return {
      server_id: server.server_id,
      health_status: server.health_status,
      license_status: server.license_status,
      last_heartbeat_at: server.last_heartbeat_at
    };
  });

  const reportForUpload = { ...report, checks: [...report.checks] };
  await withCheck(report, "platform_acceptance_record", async () => {
    const result = await postAcceptanceReport(config, reportForUpload, fetchImpl);
    return { accepted: Boolean(result.accepted ?? true) };
  });

  return report;
}
