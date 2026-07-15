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

export async function main(env = process.env) {
  return sendHeartbeat({
    agentRoot: env.BAIRUI_AGENT_ROOT,
    platformUrl: env.BAIRUI_PLATFORM_URL,
    ingestToken: env.BAIRUI_AGENT_INGEST_TOKEN,
    organizationId: env.BAIRUI_ORGANIZATION_ID,
    serverId: env.BAIRUI_SERVER_ID
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
  console.log("BaiRui heartbeat accepted");
}
