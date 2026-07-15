import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);

export async function collectControlPlaneSnapshot(options) {
  const agentRoot = path.resolve(options.agentRoot);
  const { stdout } = await (options.execFile ?? execFile)(process.execPath, ["scripts/control-plane-snapshot.mjs"], {
    cwd: agentRoot,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 30_000,
    windowsHide: true,
    maxBuffer: 5 * 1024 * 1024
  });
  const snapshot = JSON.parse(stdout);
  if (snapshot.schemaVersion !== "1.0" || !snapshot.status) throw new Error("Invalid Bairui Control Plane snapshot");
  return snapshot;
}

export async function sendHeartbeat(options) {
  if (!options.platformUrl || !options.ingestToken || !options.organizationId || !options.serverId) throw new TypeError("Platform URL, ingest token, organization id, and server id are required");
  const snapshot = options.snapshot ?? await collectControlPlaneSnapshot(options);
  const response = await (options.fetch ?? globalThis.fetch)(`${String(options.platformUrl).replace(/\/$/, "")}/api/internal/control-plane/snapshots`, {
    method: "POST",
    headers: { authorization: `Bearer ${options.ingestToken}`, "content-type": "application/json" },
    body: JSON.stringify({ organizationId: options.organizationId, serverId: options.serverId, snapshot }),
    signal: AbortSignal.timeout(options.httpTimeoutMs ?? 15_000)
  });
  if (!response.ok) throw new Error(`Platform rejected heartbeat with HTTP ${response.status}`);
  return response.json();
}

export function buildAgentHeartbeat(snapshot, options) {
  const reportByModule = new Map([...(snapshot.health ?? []), ...(snapshot.dependencies ?? [])].map((report) => [report.moduleId, report]));
  return {
    organizationId: options.organizationId,
    userId: options.userId,
    agentId: options.agentId,
    runtimeId: options.runtimeId,
    sequence: options.sequence ?? Date.now(),
    status: snapshot.status ?? "unknown",
    runtimeVersion: snapshot.heartbeat?.hermesVersion,
    boundaryVersion: snapshot.heartbeat?.runtimeBoundaryVersion,
    configRevisionId: options.configRevisionId,
    observedAt: snapshot.timestamp ?? new Date().toISOString(),
    queueDepth: 0,
    activeRuns: 0,
    failedRuns: 0,
    components: (snapshot.modules ?? []).map((module) => ({
      layer: module.layer,
      moduleId: module.moduleId,
      status: reportByModule.get(module.moduleId)?.status ?? snapshot.status ?? "unknown",
      version: module.version,
      capabilities: module.capabilities ?? [],
      metrics: {},
      observedAt: snapshot.timestamp
    }))
  };
}

export async function sendAgentHeartbeat(options) {
  if (!options.platformUrl || !options.ingestToken || !options.organizationId || !options.userId || !options.agentId || !options.runtimeId) throw new TypeError("Platform URL, ingest token, organization, user, Agent, and Runtime ids are required");
  const heartbeat = options.heartbeat ?? buildAgentHeartbeat(options.snapshot ?? await collectControlPlaneSnapshot(options), options);
  const response = await (options.fetch ?? globalThis.fetch)(`${String(options.platformUrl).replace(/\/$/, "")}/api/internal/control-plane/heartbeats`, {
    method: "POST",
    headers: { authorization: `Bearer ${options.ingestToken}`, "content-type": "application/json" },
    body: JSON.stringify(heartbeat),
    signal: AbortSignal.timeout(options.httpTimeoutMs ?? 15_000)
  });
  if (!response.ok) throw new Error(`Platform rejected Agent heartbeat with HTTP ${response.status}`);
  return response.json();
}

export async function main(env = process.env) {
  const options = {
    agentRoot: env.BAIRUI_AGENT_ROOT,
    platformUrl: env.BAIRUI_PLATFORM_URL,
    ingestToken: env.BAIRUI_AGENT_INGEST_TOKEN,
    organizationId: env.BAIRUI_ORGANIZATION_ID,
    serverId: env.BAIRUI_SERVER_ID,
    userId: env.BAIRUI_USER_ID,
    agentId: env.BAIRUI_AGENT_ID,
    runtimeId: env.BAIRUI_RUNTIME_ID,
    configRevisionId: env.BAIRUI_CONFIG_REVISION_ID
  };
  const snapshot = await collectControlPlaneSnapshot(options);
  const server = await sendHeartbeat({ ...options, snapshot });
  const agent = options.userId && options.agentId && options.runtimeId ? await sendAgentHeartbeat({ ...options, snapshot }) : null;
  return { server, agent };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
  console.log("BaiRui heartbeat accepted");
}
