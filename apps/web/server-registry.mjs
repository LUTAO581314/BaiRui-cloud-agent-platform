import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { validateHeartbeat } from "../../packages/server-protocol/index.mjs";

const DEFAULT_REGISTRY_PATH = "./data/platform/server-registry.json";

export function loadRegistryConfig(env = process.env) {
  return {
    databaseUrl: env.BAIRUI_PLATFORM_DATABASE_URL ?? "",
    registryPath: env.BAIRUI_SERVER_REGISTRY_PATH ?? DEFAULT_REGISTRY_PATH,
    agentToken: env.BAIRUI_SERVER_AGENT_TOKEN ?? ""
  };
}

function emptyRegistry() {
  return {
    servers: {},
    heartbeats: [],
    acceptance_reports: []
  };
}

async function readRegistry(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return emptyRegistry();
    }
    throw error;
  }
}

async function writeRegistry(path, registry) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

export function summarizeServer(heartbeat, receivedAt) {
  return {
    server_id: heartbeat.server_id,
    organization_id: heartbeat.organization_id,
    license_id: heartbeat.license_id,
    license_status: heartbeat.license_status,
    hermes_version: heartbeat.hermes_version,
    health_status: heartbeat.health_status,
    database_status: heartbeat.database_status,
    backup_status: heartbeat.backup_status,
    connector_status_summary: heartbeat.connector_status_summary,
    error_count_24h: heartbeat.error_count_24h,
    brand_key: heartbeat.brand_key,
    last_seen_at: receivedAt,
    last_heartbeat_at: heartbeat.created_at
  };
}

export async function recordHeartbeat(heartbeat, options = {}) {
  const validation = validateHeartbeat(heartbeat);
  if (!validation.valid) {
    return { accepted: false, status: 400, errors: validation.errors };
  }

  const registryPath = options.registryPath ?? DEFAULT_REGISTRY_PATH;
  const receivedAt = options.receivedAt ?? new Date().toISOString();
  const registry = await readRegistry(registryPath);
  const summary = summarizeServer(heartbeat, receivedAt);

  registry.servers[heartbeat.server_id] = summary;
  registry.heartbeats.push({
    received_at: receivedAt,
    heartbeat
  });
  registry.heartbeats = registry.heartbeats.slice(-1000);

  await writeRegistry(registryPath, registry);
  return { accepted: true, status: 202, server: summary };
}

export async function listServers(options = {}) {
  const registryPath = options.registryPath ?? DEFAULT_REGISTRY_PATH;
  const registry = await readRegistry(registryPath);
  return Object.values(registry.servers).sort((left, right) => right.last_seen_at.localeCompare(left.last_seen_at));
}

function normalizeAcceptanceCheck(check) {
  if (!check || typeof check !== "object" || Array.isArray(check)) {
    return null;
  }
  return {
    name: typeof check.name === "string" ? check.name : "",
    passed: Boolean(check.passed),
    details: check.details && typeof check.details === "object" && !Array.isArray(check.details) ? check.details : {},
    error: typeof check.error === "string" ? check.error : ""
  };
}

export function validateAcceptanceReport(report) {
  const errors = [];
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return { valid: false, errors: ["acceptance report must be an object"] };
  }
  for (const field of ["server_id", "organization_id", "license_id", "generated_at"]) {
    if (typeof report[field] !== "string" || report[field].trim() === "") {
      errors.push(`${field} is required`);
    }
  }
  if (typeof report.accepted !== "boolean") {
    errors.push("accepted must be a boolean");
  }
  if (!Array.isArray(report.checks) || report.checks.length === 0) {
    errors.push("checks must be a non-empty array");
  } else {
    for (const [index, check] of report.checks.entries()) {
      const normalized = normalizeAcceptanceCheck(check);
      if (!normalized || !normalized.name) {
        errors.push(`checks[${index}].name is required`);
      }
      if (!check || typeof check.passed !== "boolean") {
        errors.push(`checks[${index}].passed must be a boolean`);
      }
    }
  }
  if (Number.isNaN(Date.parse(report.generated_at))) {
    errors.push("generated_at must be an ISO timestamp");
  }
  return { valid: errors.length === 0, errors };
}

export function summarizeAcceptanceReport(report, receivedAt) {
  return {
    server_id: report.server_id,
    organization_id: report.organization_id,
    license_id: report.license_id,
    accepted: report.accepted,
    check_count: report.checks.length,
    failed_check_count: report.checks.filter((check) => !check.passed).length,
    generated_at: report.generated_at,
    received_at: receivedAt
  };
}

export async function recordAcceptanceReport(report, options = {}) {
  const validation = validateAcceptanceReport(report);
  if (!validation.valid) {
    return { accepted: false, status: 400, errors: validation.errors };
  }

  const registryPath = options.registryPath ?? DEFAULT_REGISTRY_PATH;
  const receivedAt = options.receivedAt ?? new Date().toISOString();
  const registry = await readRegistry(registryPath);
  registry.acceptance_reports = Array.isArray(registry.acceptance_reports) ? registry.acceptance_reports : [];
  const summary = summarizeAcceptanceReport(report, receivedAt);
  registry.acceptance_reports.push({
    ...summary,
    report
  });
  registry.acceptance_reports = registry.acceptance_reports.slice(-1000);

  await writeRegistry(registryPath, registry);
  return { accepted: true, status: 202, report: summary };
}

export async function listAcceptanceReports(options = {}) {
  const registryPath = options.registryPath ?? DEFAULT_REGISTRY_PATH;
  const registry = await readRegistry(registryPath);
  const reports = Array.isArray(registry.acceptance_reports) ? registry.acceptance_reports : [];
  return reports
    .filter((report) => !options.serverId || report.server_id === options.serverId)
    .sort((left, right) => right.received_at.localeCompare(left.received_at));
}

export function isAuthorized(headers, config) {
  if (!config.agentToken) {
    return true;
  }
  return headers.authorization === `Bearer ${config.agentToken}`;
}

export function createJsonRegistryStorage(options = {}) {
  return {
    kind: "json",
    async recordHeartbeat(heartbeat, recordOptions = {}) {
      return recordHeartbeat(heartbeat, {
        registryPath: options.registryPath,
        ...recordOptions
      });
    },
    async listServers() {
      return listServers({ registryPath: options.registryPath });
    },
    async recordAcceptanceReport(report, recordOptions = {}) {
      return recordAcceptanceReport(report, {
        registryPath: options.registryPath,
        ...recordOptions
      });
    },
    async listAcceptanceReports(listOptions = {}) {
      return listAcceptanceReports({
        registryPath: options.registryPath,
        ...listOptions
      });
    }
  };
}
