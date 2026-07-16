import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentSupervisor } from "../server-agent/supervisor.mjs";

function provisionCommand() {
  return {
    command_id: "cmd_a", idempotency_key: "dep_a/provision/config_a", deployment_id: "dep_a", action: "deployment.provision",
    arguments: { agent_id: "agent_a", workspace_ref: "workspace:agent_a", config_revision_id: "config_a" },
    placement: { agent_id: "agent_a", runtime_id: "runtime_a", organization_id: "org_a", user_id: "user_a" },
    config: { document: { agent: { soul_markdown: "# Agent" }, provider: { base_url: "https://models.example.test/v1", model: "example/model" } }, secrets: { provider_api_key: "provider-secret", hermes_api_server_key: "hermes-secret-that-is-longer-than-thirty-two", runtime_shared_secret: "runtime-secret-that-is-longer-than-thirty-two", agent_control_token: "agent-control-secret-longer-than-thirty-two" } }
  };
}

test("Supervisor provisions fixed local images without executing remote shell or image fields", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bairui-supervisor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const execFile = async (file, args) => {
    calls.push({ file, args });
    if (args[1] === "inspect") throw new Error("missing");
    return { stdout: "", stderr: "" };
  };
  const supervisor = new AgentSupervisor({ instancesRoot: root, platformUrl: "https://platform.example.test", hermesImage: "local/hermes:verified", runtimeImage: "local/runtime:verified", runtimeAdvertiseHost: "host.docker.internal", execFile, portStart: 19100, portEnd: 19110 });
  const command = provisionCommand();
  command.shell = "rm -rf /";
  command.config.document.runtime_image = "attacker/image";
  const result = await supervisor.execute(command);
  assert.match(result.runtimeEndpointRef, /^http:\/\/host\.docker\.internal:1910[0-9]$/);
  assert.ok(calls.every((call) => call.file === "docker"));
  assert.ok(calls.every((call) => !call.args.join(" ").includes("attacker/image")));
  assert.ok(calls.some((call) => call.args.includes("local/hermes:verified")));
  assert.ok(calls.some((call) => call.args.includes("local/runtime:verified")));
  const instanceDir = fs.readdirSync(root)[0];
  assert.equal(fs.statSync(path.join(root, instanceDir, "hermes.env")).mode & 0o777, 0o600);
  assert.doesNotMatch(fs.readFileSync(path.join(root, instanceDir, "instance.json"), "utf8"), /provider-secret|runtime-secret/);
});

test("Supervisor delete removes only known containers and retains the Agent data directory", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bairui-supervisor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const execFile = async (file, args) => { calls.push(args); if (args[1] === "inspect" && !args.includes("bairui-agent")) return { stdout: "" }; return { stdout: "" }; };
  const supervisor = new AgentSupervisor({ instancesRoot: root, platformUrl: "https://platform.example.test", execFile, portStart: 19100, portEnd: 19110 });
  const command = provisionCommand();
  await supervisor.execute(command);
  const result = await supervisor.execute({ action: "deployment.delete", arguments: { agent_id: "agent_a" } });
  assert.equal(result.summary.data_retained, 1);
  assert.equal(fs.existsSync(supervisor.instancePath("agent_a")), true);
  assert.ok(calls.every((args) => !args.includes("--volumes")));
});

test("Supervisor runs only registered control checks from the verified Runtime image", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bairui-supervisor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const execFile = async (file, args) => {
    calls.push({ file, args });
    if (args[1] === "inspect") throw new Error("missing");
    if (args.includes("apps/control-check.mjs")) return { stdout: JSON.stringify({ status: "passed", checks: [{ id: "runtime.health", status: "passed" }] }), stderr: "" };
    return { stdout: "", stderr: "" };
  };
  const supervisor = new AgentSupervisor({ instancesRoot: root, platformUrl: "https://platform.example.test", runtimeImage: "local/runtime:verified", execFile, portStart: 19100, portEnd: 19110 });
  await supervisor.execute(provisionCommand());
  const result = await supervisor.execute({ action: "probe.run", arguments: { probe_ids: ["runtime.health"] }, placement: { agent_id: "agent_a" } });
  assert.equal(result.summary.passed, 1);
  const check = calls.find((call) => call.args.includes("apps/control-check.mjs"));
  assert.ok(check.args.includes("local/runtime:verified"));
  await assert.rejects(() => supervisor.execute({ action: "probe.run", arguments: { probe_ids: ["shell.anything"] }, placement: { agent_id: "agent_a" } }), { code: "unsupported_test_suite" });
});

test("Supervisor stages and applies a trusted configuration with rollback files", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bairui-supervisor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const execFile = async (file, args) => { if (args[1] === "inspect") throw new Error("missing"); return { stdout: "", stderr: "" }; };
  const supervisor = new AgentSupervisor({ instancesRoot: root, platformUrl: "https://platform.example.test", execFile, portStart: 19100, portEnd: 19110 });
  await supervisor.execute(provisionCommand());
  const update = provisionCommand();
  update.command_id = "cmd_config";
  update.idempotency_key = "dep_a/config/config_b";
  update.action = "config.apply";
  update.approval_id = "approval_a";
  update.arguments = { config_revision_id: "config_b" };
  update.config.document.provider.model = "example/model-v2";
  const result = await supervisor.execute(update);
  assert.equal(result.summary.applied, 1);
  assert.match(fs.readFileSync(path.join(supervisor.instancePath("agent_a"), "hermes.env"), "utf8"), /MODEL=example\/model-v2/);
  assert.equal(fs.existsSync(path.join(supervisor.instancePath("agent_a"), "config-history", "config_a", "hermes.env")), true);
});

test("Supervisor encrypts and verifies Agent backups without exposing plaintext", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bairui-supervisor-"));
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bairui-backups-"));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(backupRoot, { recursive: true, force: true }); });
  const execFile = async (file, args) => {
    if (file === "tar") { fs.writeFileSync(args[args.indexOf("-czf") + 1], "archive-contains-provider-secret"); return { stdout: "", stderr: "" }; }
    if (args[1] === "inspect") throw new Error("missing");
    return { stdout: "", stderr: "" };
  };
  const supervisor = new AgentSupervisor({ instancesRoot: root, backupRoot, backupEncryptionKey: "backup-encryption-key-longer-than-thirty-two", platformUrl: "https://platform.example.test", execFile, portStart: 19100, portEnd: 19110 });
  await supervisor.execute(provisionCommand());
  const created = await supervisor.execute({ command_id: "backup_a", action: "backup.create", arguments: { backup_policy_id: "daily", backup_id: "backup_a" }, placement: { agent_id: "agent_a" } });
  assert.equal(created.summary.encrypted, 1);
  assert.doesNotMatch(fs.readFileSync(path.join(backupRoot, "backup_a.brb")).toString("utf8"), /provider-secret/);
  const verified = await supervisor.execute({ action: "backup.verify", arguments: { backup_id: "backup_a" }, placement: { agent_id: "agent_a" } });
  assert.equal(verified.summary.verified, 1);
});

test("Supervisor accepts release images only from trusted immutable manifests", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bairui-supervisor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const execFile = async (file, args) => { if (args[1] === "inspect") throw new Error("missing"); return { stdout: "", stderr: "" }; };
  const supervisor = new AgentSupervisor({ instancesRoot: root, platformUrl: "https://platform.example.test", execFile, portStart: 19100, portEnd: 19110 });
  await supervisor.execute(provisionCommand());
  const release = { action: "release.stage", arguments: { release_id: "release_a" }, placement: { agent_id: "agent_a" }, release: { id: "release_a", version: "1.2.3", hermes_image: "ghcr.io/nous/hermes:latest", runtime_image: `ghcr.io/bairui/runtime@sha256:${"b".repeat(64)}` } };
  await assert.rejects(() => supervisor.execute(release), { code: "invalid_release_manifest" });
  release.release.hermes_image = `ghcr.io/nous/hermes@sha256:${"a".repeat(64)}`;
  const staged = await supervisor.execute(release);
  assert.equal(staged.summary.images, 2);
});
