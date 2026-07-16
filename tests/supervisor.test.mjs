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
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(root, instanceDir, "hermes.env")).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(path.join(root, instanceDir, "runtime.env"), "utf8"), /BAIRUI_HERMES_DATA_PATH=\/opt\/hermes-data/);
  const runtimeRun = calls.find((call) => call.args.includes("local/runtime:verified"));
  assert.ok(runtimeRun.args.includes("--volume"));
  assert.ok(runtimeRun.args.some((value) => value.endsWith(":/opt/hermes-data/memories")));
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

test("Supervisor applies only owner-scoped skill YAML and rolls back invalid input", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bairui-supervisor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const execFile = async (file, args) => { calls.push(args); if (args[1] === "inspect") throw new Error("missing"); return { stdout: "", stderr: "" }; };
  const supervisor = new AgentSupervisor({ instancesRoot: root, platformUrl: "https://platform.example.test", execFile, portStart: 19100, portEnd: 19110 });
  await supervisor.execute(provisionCommand());
  const instancePath = supervisor.instancePath("agent_a");
  const hermesConfig = path.join(instancePath, "hermes-data", "config.yaml");
  fs.writeFileSync(hermesConfig, "display:\n  tool_progress: verbose\nskills:\n  disabled: []\n");
  const beforeCalls = calls.length;
  const command = { action: "config.apply-user", command_id: "cmd_skills", idempotency_key: "dep_a/config.apply-user/config_skills", arguments: { config_revision_id: "config_skills" }, placement: { agent_id: "agent_a" }, config: { document: { owner_change: { scope: "skills", generation: 2 }, skills: { disabled: ["browser/use"] } } } };
  const result = await supervisor.execute(command);
  assert.equal(result.summary.applied, 1);
  const applied = fs.readFileSync(hermesConfig, "utf8");
  assert.match(applied, /tool_progress: verbose/);
  assert.match(applied, /browser\/use/);
  assert.ok(calls.slice(beforeCalls).some((args) => args.includes("bairui-hermes-" + supervisor.names("agent_a").key)));
  assert.ok(calls.slice(beforeCalls).every((args) => !args.includes(supervisor.names("agent_a").runtime)));

  const unchanged = fs.readFileSync(hermesConfig, "utf8");
  await assert.rejects(() => supervisor.execute({ ...command, arguments: { config_revision_id: "config_bad_scope" }, config: { document: { owner_change: { scope: "provider", generation: 3 }, skills: { disabled: [] } } } }), { code: "invalid_user_config_scope" });
  assert.equal(fs.readFileSync(hermesConfig, "utf8"), unchanged);
  fs.writeFileSync(hermesConfig, "skills: [\n");
  await assert.rejects(() => supervisor.execute({ ...command, arguments: { config_revision_id: "config_bad_yaml" }, config: { document: { owner_change: { scope: "skills", generation: 4 }, skills: { disabled: [] } } } }), { code: "invalid_hermes_config" });
  assert.equal(fs.readFileSync(hermesConfig, "utf8"), "skills: [\n");
});

test("Supervisor atomically applies owner-scoped SOUL identity and restores it after restart failure", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bairui-supervisor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let failNextHermesStart = false;
  const execFile = async (file, args) => {
    if (args[1] === "inspect") throw new Error("missing");
    const nameIndex = args.indexOf("--name");
    if (failNextHermesStart && args[0] === "run" && nameIndex >= 0 && String(args[nameIndex + 1]).startsWith("bairui-hermes-")) {
      failNextHermesStart = false;
      throw new Error("simulated Hermes restart failure");
    }
    return { stdout: "", stderr: "" };
  };
  const supervisor = new AgentSupervisor({ instancesRoot: root, platformUrl: "https://platform.example.test", execFile, portStart: 19100, portEnd: 19110 });
  await supervisor.execute(provisionCommand());
  const soulPath = path.join(supervisor.instancePath("agent_a"), "hermes-data", "SOUL.md");
  const identity = (revision, soul) => ({ action: "config.apply-user", command_id: `cmd_${revision}`, idempotency_key: `dep_a/config.apply-user/${revision}`, arguments: { config_revision_id: revision }, placement: { agent_id: "agent_a" }, config: { document: { owner_change: { scope: "identity", generation: 2 }, agent: { id: "agent_a", name: "Agent A", soul_markdown: soul } } } });
  const applied = await supervisor.execute(identity("config_identity", "# Identity\n\nPrecise and calm."));
  assert.equal(applied.summary.identity, 1);
  assert.equal(fs.readFileSync(soulPath, "utf8"), "# Identity\n\nPrecise and calm.");
  assert.ok(applied.evidenceRefs.some((item) => item.startsWith("soul-sha256:")));

  failNextHermesStart = true;
  await assert.rejects(() => supervisor.execute(identity("config_identity_failed", "# Identity\n\nMust roll back.")), /restart failure/);
  assert.equal(fs.readFileSync(soulPath, "utf8"), "# Identity\n\nPrecise and calm.");
  await assert.rejects(() => supervisor.execute({ ...identity("config_identity_bad", "valid"), config: { document: { owner_change: { scope: "identity", generation: 3 }, agent: { id: "other_agent", name: "Agent A", soul_markdown: "valid" } } } }), { code: "invalid_user_config_scope" });
});

test("Supervisor encrypts, verifies, and restores Agent backups with rollback history", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bairui-supervisor-"));
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bairui-backups-"));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(backupRoot, { recursive: true, force: true }); });
  let unsafeArchive = false;
  const execFile = async (file, args) => {
    if (file === "tar" && args.includes("-czf")) { fs.writeFileSync(args[args.indexOf("-czf") + 1], "archive-contains-provider-secret"); return { stdout: "", stderr: "" }; }
    if (file === "tar" && args.includes("-tzf")) return { stdout: unsafeArchive ? "../escape\n" : "hermes-data/\nhermes-data/MEMORY.md\ninstance.json\nhermes.env\nruntime.env\n", stderr: "" };
    if (file === "tar" && args.includes("-xzf")) {
      const destination = args[args.indexOf("-C") + 1];
      fs.mkdirSync(path.join(destination, "hermes-data"), { recursive: true });
      fs.writeFileSync(path.join(destination, "hermes-data", "MEMORY.md"), "memory-before-backup");
      fs.writeFileSync(path.join(destination, "instance.json"), JSON.stringify({ agentId: "agent_a" }));
      fs.writeFileSync(path.join(destination, "hermes.env"), "RESTORED_HERMES=1\n");
      fs.writeFileSync(path.join(destination, "runtime.env"), "RESTORED_RUNTIME=1\n");
      return { stdout: "", stderr: "" };
    }
    if (args[1] === "inspect") throw new Error("missing");
    return { stdout: "", stderr: "" };
  };
  const supervisor = new AgentSupervisor({ instancesRoot: root, backupRoot, backupEncryptionKey: "backup-encryption-key-longer-than-thirty-two", platformUrl: "https://platform.example.test", execFile, portStart: 19100, portEnd: 19110 });
  await supervisor.execute(provisionCommand());
  fs.writeFileSync(path.join(supervisor.instancePath("agent_a"), "hermes-data", "MEMORY.md"), "memory-before-backup");
  const created = await supervisor.execute({ command_id: "backup_a", action: "backup.create", arguments: { backup_policy_id: "daily", backup_id: "backup_a" }, placement: { agent_id: "agent_a" } });
  assert.equal(created.summary.encrypted, 1);
  assert.doesNotMatch(fs.readFileSync(path.join(backupRoot, "backup_a.brb")).toString("utf8"), /provider-secret/);
  const verified = await supervisor.execute({ action: "backup.verify", arguments: { backup_id: "backup_a" }, placement: { agent_id: "agent_a" } });
  assert.equal(verified.summary.verified, 1);
  fs.writeFileSync(path.join(supervisor.instancePath("agent_a"), "hermes-data", "MEMORY.md"), "memory-after-backup");
  const restore = { action: "backup.restore", approval_id: "approval_restore", arguments: { backup_id: "backup_a", restore_id: "restore_a" }, placement: { agent_id: "agent_a" } };
  const restored = await supervisor.execute(restore);
  assert.equal(restored.summary.restored, 1);
  assert.equal(fs.readFileSync(path.join(supervisor.instancePath("agent_a"), "hermes-data", "MEMORY.md"), "utf8"), "memory-before-backup");
  assert.equal(fs.readFileSync(path.join(supervisor.instancePath("agent_a"), "restore-history", "restore_a", "hermes-data", "MEMORY.md"), "utf8"), "memory-after-backup");
  await assert.rejects(() => supervisor.execute({ ...restore, approval_id: undefined, arguments: { backup_id: "backup_a", restore_id: "restore_without_approval" } }), { code: "approval_required" });
  unsafeArchive = true;
  await assert.rejects(() => supervisor.execute({ ...restore, arguments: { backup_id: "backup_a", restore_id: "restore_unsafe" } }), { code: "unsafe_backup_content" });
  unsafeArchive = false;
  const expired = await supervisor.execute({ action: "backup.expire", arguments: { backup_id: "backup_a" }, placement: { agent_id: "agent_a" } });
  assert.equal(expired.summary.files_deleted, 1);
  assert.equal(fs.existsSync(path.join(backupRoot, "backup_a.brb")), false);
  assert.equal((await supervisor.execute({ action: "backup.expire", arguments: { backup_id: "backup_a" }, placement: { agent_id: "agent_a" } })).summary.already_absent, 1);
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
