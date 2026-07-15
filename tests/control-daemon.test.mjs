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
