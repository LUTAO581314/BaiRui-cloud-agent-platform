import assert from "node:assert/strict";
import test from "node:test";
import { validateLeaseRequestEnvelope, validateReceiptEnvelope } from "@bairui/contracts";
import { runControlDaemon } from "../server-agent/daemon.mjs";
import { CONTROL_TOKEN, canonicalLease } from "./helpers/control-envelopes.mjs";

const env = {
  BAIRUI_PLATFORM_URL: "https://platform.example.test",
  BAIRUI_ORGANIZATION_ID: "org_a",
  BAIRUI_USER_ID: "user_a",
  BAIRUI_AGENT_ID: "agent_a",
  BAIRUI_SERVER_ID: "server_a",
  BAIRUI_SERVER_AGENT_TOKEN: CONTROL_TOKEN
};

test("control daemon runs one signed lease cycle through the injected Supervisor", async () => {
  let executed = 0;
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith("/leases")) return Response.json(canonicalLease(validateLeaseRequestEnvelope(body)));
    validateReceiptEnvelope(body);
    return Response.json({ accepted: true }, { status: 202 });
  };
  await runControlDaemon({ once: true, env, fetch, executor: { execute: async () => { executed += 1; return { observationVersion: 2, evidenceRefs: ["ref:daemon-postcondition"] }; } }, logger: { error() {} } });
  assert.equal(executed, 1);
});

test("control daemon reports fixed resource samples with the server identity", async () => {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body), headers: options.headers });
    if (url.endsWith("/leases")) return Response.json(canonicalLease(validateLeaseRequestEnvelope(JSON.parse(options.body)), { extraLease: { commands: [] } }));
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
    env,
    fetch,
    executor: { execute: async () => ({}), collectResourceSamples: async () => [sample] },
    logger: { error() {} }
  });
  const upload = requests.find((request) => request.url.endsWith("/resources"));
  assert.equal(upload.body.serverId, "server_a");
  assert.equal(upload.body.samples[0].agentId, "agent_a");
  assert.equal(upload.headers["x-bairui-machine-id"], "server_a");
});

test("control daemon reports an empty fleet so the server remains healthy", async () => {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith("/leases")) return Response.json(canonicalLease(validateLeaseRequestEnvelope(JSON.parse(options.body)), { extraLease: { commands: [] } }));
    if (url.endsWith("/resources")) return Response.json({ accepted: 0, sampleIds: [] }, { status: 202 });
    throw new Error(`Unexpected request: ${url}`);
  };
  await runControlDaemon({
    once: true,
    env,
    fetch,
    executor: { execute: async () => ({}), collectResourceSamples: async () => [] },
    logger: { error() {} }
  });
  const upload = requests.find((request) => request.url.endsWith("/resources"));
  assert.deepEqual(upload.body, { serverId: "server_a", samples: [] });
});
