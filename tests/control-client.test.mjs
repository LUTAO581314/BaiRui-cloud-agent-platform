import assert from "node:assert/strict";
import test from "node:test";
import { executeControlCycle } from "../server-agent/control-client.mjs";

test("control client validates, executes, and acknowledges an allowlisted command", async () => {
  const requests = [];
  const command = { schema_version: "1.0", command_id: "cmd_a", idempotency_key: "dep_a/provision/config_a", deployment_id: "dep_a", action: "deployment.provision", target: { module_id: "bairui.supervisor", instance_id: "agent_a" }, arguments: { agent_id: "agent_a", workspace_ref: "workspace:agent_a", config_revision_id: "config_a" }, expected_observation_version: 0, created_at: "2026-07-16T00:00:00.000Z", expires_at: "2030-07-16T00:10:00.000Z", attempt: 1, placement: {}, config: {} };
  const fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body), headers: options.headers });
    if (url.endsWith("/lease")) return Response.json({ commands: [command] });
    return Response.json({ receipt: { state: JSON.parse(options.body).state } }, { status: 202 });
  };
  const result = await executeControlCycle({ platformUrl: "https://platform.example.test", serverId: "server_a", token: "server-token-that-is-longer-than-thirty-two-characters", fetch, executor: { execute: async () => ({ runtimeEndpointRef: "http://127.0.0.1:19001", summary: { containers: 2 } }) } });
  assert.equal(result[0].state, "succeeded");
  assert.deepEqual(requests.slice(1).map((request) => request.body.state), ["accepted", "running", "succeeded"]);
  assert.ok(requests.every((request) => request.headers["x-bairui-signature"]));
});

test("control client reports executor failures without accepting remote shell fields", async () => {
  const receipts = [];
  const command = { schema_version: "1.0", command_id: "cmd_a", idempotency_key: "dep_a/provision/config_a", deployment_id: "dep_a", action: "deployment.provision", target: { module_id: "bairui.supervisor" }, arguments: { agent_id: "agent_a", workspace_ref: "workspace:agent_a", config_revision_id: "config_a" }, expected_observation_version: 0, created_at: "2026-07-16T00:00:00.000Z", expires_at: "2030-07-16T00:10:00.000Z", attempt: 1, shell: "rm -rf /" };
  const fetch = async (url, options) => url.endsWith("/lease") ? Response.json({ commands: [command] }) : (receipts.push(JSON.parse(options.body)), Response.json({ receipt: {} }, { status: 202 }));
  await assert.rejects(() => executeControlCycle({ platformUrl: "https://platform.example.test", serverId: "server_a", token: "server-token-that-is-longer-than-thirty-two-characters", fetch, executor: { execute: async () => ({}) } }), /Unknown control command field/);
  assert.equal(receipts.length, 0);
});

test("control client redacts local paths and secrets from executor failure receipts", async () => {
  const receipts = [];
  const command = { schema_version: "1.0", command_id: "cmd_restore", idempotency_key: "dep_a/backup.restore/restore_a", deployment_id: "dep_a", action: "backup.restore", target: { module_id: "bairui.supervisor" }, arguments: { backup_id: "backup_a", restore_id: "restore_a" }, approval_id: "approval_a", expected_observation_version: 0, created_at: "2026-07-16T00:00:00.000Z", expires_at: "2030-07-16T00:10:00.000Z", attempt: 1 };
  const fetch = async (url, options) => url.endsWith("/lease") ? Response.json({ commands: [command] }) : (receipts.push(JSON.parse(options.body)), Response.json({ receipt: {} }, { status: 202 }));
  const error = Object.assign(new Error("Failed reading /var/lib/bairui/backups/secret-file"), { code: "backup_read_failed" });
  const result = await executeControlCycle({ platformUrl: "https://platform.example.test", serverId: "server_a", token: "server-token-that-is-longer-than-thirty-two-characters", fetch, executor: { execute: async () => { throw error; } } });
  assert.equal(result[0].state, "failed");
  const failure = receipts.find((item) => item.state === "failed");
  assert.equal(failure.errorCode, "backup_read_failed");
  assert.doesNotMatch(failure.errorSummary, /var\/lib|secret-file/);
});
