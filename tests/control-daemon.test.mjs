import assert from "node:assert/strict";
import test from "node:test";
import { runControlDaemon } from "../server-agent/daemon.mjs";

test("control daemon runs one signed lease cycle through the injected Supervisor", async () => {
  let executed = 0;
  const command = { schema_version: "1.0", command_id: "cmd_a", idempotency_key: "dep_a/start/agent_a", deployment_id: "dep_a", action: "deployment.start", target: { module_id: "bairui.supervisor" }, arguments: { agent_id: "agent_a" }, expected_observation_version: 0, created_at: "2026-07-16T00:00:00.000Z", expires_at: "2030-07-16T00:10:00.000Z", attempt: 1 };
  const fetch = async (url, options) => url.endsWith("/lease") ? Response.json({ commands: [command] }) : Response.json({ receipt: { state: JSON.parse(options.body).state } }, { status: 202 });
  await runControlDaemon({ once: true, env: { BAIRUI_PLATFORM_URL: "https://platform.example.test", BAIRUI_SERVER_ID: "server_a", BAIRUI_SERVER_AGENT_TOKEN: "server-token-that-is-longer-than-thirty-two-characters" }, fetch, executor: { execute: async () => { executed += 1; return { summary: { containers: 2 } }; } }, logger: { error() {} } });
  assert.equal(executed, 1);
});

test("control daemon reports fixed resource samples with the server identity", async () => {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body), headers: options.headers });
    if (url.endsWith("/lease")) return Response.json({ commands: [] });
    if (url.endsWith("/resources")) return Response.json({ accepted: 1 }, { status: 202 });
    throw new Error(`Unexpected request: ${url}`);
  };
  const sample = {
    agentId: "agent_a", runtimeId: "runtime_a", deploymentId: "deployment_a", sequence: 1, status: "running",
    cpuPercent: 2.5, memoryUsedBytes: 1024, memoryLimitBytes: 4096, agentStorageUsedBytes: 2048,
    hostStorageUsedBytes: 8192, hostStorageLimitBytes: 16384, osType: "linux", architecture: "amd64",
    operatingSystem: "Test Linux", dockerVersion: "27.1.0", cpuCount: 4, uptimeSeconds: 60,
    observedAt: "2026-07-16T07:00:00.000Z",
    containers: [{ role: "hermes", status: "running", containerId: "container_a", containerName: "bairui-hermes-a", imageRef: "hermes:test", cpuPercent: 2.5, memoryUsedBytes: 1024, memoryLimitBytes: 4096, writableBytes: 256 }]
  };
  await runControlDaemon({
    once: true,
    env: { BAIRUI_PLATFORM_URL: "https://platform.example.test", BAIRUI_SERVER_ID: "server_a", BAIRUI_SERVER_AGENT_TOKEN: "server-token-that-is-longer-than-thirty-two-characters" },
    fetch,
    executor: { execute: async () => ({}), collectResourceSamples: async () => [sample] },
    logger: { error() {} }
  });
  const upload = requests.find((request) => request.url.endsWith("/resources"));
  assert.equal(upload.body.serverId, "server_a");
  assert.equal(upload.body.samples[0].agentId, "agent_a");
  assert.equal(upload.headers["x-bairui-machine-id"], "server_a");
});
