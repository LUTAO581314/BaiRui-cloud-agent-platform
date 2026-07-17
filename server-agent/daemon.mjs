import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { executeControlCycle, sendResourceSamples } from "./control-client.mjs";
import { AgentSupervisor } from "./supervisor.mjs";

const delay = (milliseconds, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, milliseconds);
  signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

export function supervisorFromEnv(env = process.env, options = {}) {
  return new AgentSupervisor({
    instancesRoot: env.BAIRUI_AGENT_INSTANCES_ROOT ?? "/var/lib/bairui/agents",
    platformUrl: env.BAIRUI_PLATFORM_URL,
    hermesImage: env.HERMES_IMAGE ?? "hermes-agent:local",
    runtimeImage: env.BAIRUI_RUNTIME_IMAGE ?? "bairui-runtime:local",
    runtimeAdvertiseHost: env.BAIRUI_RUNTIME_ADVERTISE_HOST ?? "host.docker.internal",
    backupRoot: env.BAIRUI_BACKUP_ROOT ?? "/var/lib/bairui/backups",
    backupEncryptionKey: env.BAIRUI_BACKUP_ENCRYPTION_KEY,
    portStart: Number(env.BAIRUI_RUNTIME_PORT_START ?? 19000),
    portEnd: Number(env.BAIRUI_RUNTIME_PORT_END ?? 19999),
    hermesDataUid: Number(env.BAIRUI_HERMES_DATA_UID ?? 10000),
    execFile: options.execFile
  });
}

export async function runControlDaemon(options = {}) {
  const env = options.env ?? process.env;
  const signal = options.signal;
  const intervalMs = Math.max(1_000, Number(env.BAIRUI_CONTROL_POLL_INTERVAL_MS ?? 5_000));
  const resourceIntervalMs = Math.max(10_000, Number(env.BAIRUI_RESOURCE_INTERVAL_MS) || 30_000);
  const client = {
    platformUrl: env.BAIRUI_PLATFORM_URL,
    serverId: env.BAIRUI_SERVER_ID,
    token: env.BAIRUI_SERVER_AGENT_TOKEN,
    executor: options.executor ?? supervisorFromEnv(env, options),
    fetch: options.fetch,
    limit: Number(env.BAIRUI_CONTROL_LEASE_LIMIT ?? 5),
    leaseSeconds: Number(env.BAIRUI_CONTROL_LEASE_SECONDS ?? 120)
  };
  if (!client.platformUrl || !client.serverId || !client.token) throw new Error("BAIRUI_PLATFORM_URL, BAIRUI_SERVER_ID, and BAIRUI_SERVER_AGENT_TOKEN are required");
  let nextResourceAt = 0;
  while (!signal?.aborted) {
    try {
      const results = await executeControlCycle(client);
      if (results.length) options.logger?.info?.("Control cycle completed", { commands: results.length });
    } catch (error) {
      options.logger?.error?.("Control cycle failed", { code: error.code ?? "control_cycle_failed", message: error.message });
    }
    if (Date.now() >= nextResourceAt && typeof client.executor.collectResourceSamples === "function") {
      nextResourceAt = Date.now() + resourceIntervalMs;
      try {
        const samples = await client.executor.collectResourceSamples();
        await sendResourceSamples({ ...client, samples });
      } catch (error) {
        options.logger?.error?.("Resource telemetry cycle failed", { code: error.code ?? "resource_cycle_failed", message: error.message });
      }
    }
    if (options.once) break;
    await delay(intervalMs, signal);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const controller = new AbortController();
  process.once("SIGTERM", () => controller.abort());
  process.once("SIGINT", () => controller.abort());
  await runControlDaemon({ signal: controller.signal, logger: console });
}
