import assert from "node:assert/strict";
import test from "node:test";
import { CONTROL_ACTIONS, validateControlCommand } from "../packages/server-protocol/control-plane.mjs";

const base = () => ({
  schema_version: "1.0",
  command_id: "cmd_1",
  idempotency_key: "dep_1/release/rel_1",
  deployment_id: "dep_1",
  action: "release.apply",
  target: { module_id: "runtime", instance_id: "runtime-1" },
  arguments: { release_id: "rel_1" },
  approval_id: "approval_1",
  expected_observation_version: 2,
  created_at: "2026-07-15T00:00:00.000Z",
  expires_at: "2026-07-15T00:10:00.000Z"
});

test("validates an approved operational command", () => {
  assert.equal(validateControlCommand(base()).action, "release.apply");
});

test("does not expose Hermes data-plane actions", () => {
  for (const action of CONTROL_ACTIONS) assert.doesNotMatch(action, /^(prompt|conversation|task|model|tool|skill|memory|runtime|shell)\./);
  for (const action of ["prompt.execute", "task.run", "tool.invoke", "memory.write", "shell.execute"]) {
    assert.throws(() => validateControlCommand({ ...base(), action }), /not allowed/);
  }
});

test("allows deployment lifecycle but no Agent business operation", () => {
  const value = base();
  value.action = "deployment.provision";
  value.arguments = { agent_id: "agent_a", workspace_ref: "workspace:agent_a", config_revision_id: "config_a" };
  delete value.approval_id;
  assert.equal(validateControlCommand(value).action, "deployment.provision");
});

test("rejects content and executable fields", () => {
  assert.throws(() => validateControlCommand({ ...base(), arguments: { release_id: "rel_1", prompt: "hello" } }), /not allowed/);
  assert.throws(() => validateControlCommand({ ...base(), script: "restart everything" }), /Unknown control command field/);
});

test("backup restore is a fixed approval-gated operation", () => {
  const value = base();
  value.action = "backup.restore";
  value.arguments = { backup_id: "backup_a", restore_id: "restore_a" };
  assert.equal(validateControlCommand(value).action, "backup.restore");
  delete value.approval_id;
  assert.throws(() => validateControlCommand(value), /approval_id/);
  assert.throws(() => validateControlCommand({ ...base(), action: "backup.restore", arguments: { backup_id: "backup_a", restore_id: "restore_a", path: "/tmp/archive" } }), /not allowed/);
});

test("backup expiration accepts an identifier but no host path", () => {
  const value = base();
  value.action = "backup.expire";
  value.arguments = { backup_id: "backup_a" };
  delete value.approval_id;
  assert.equal(validateControlCommand(value).action, "backup.expire");
  assert.throws(() => validateControlCommand({ ...value, arguments: { backup_id: "backup_a", path: "/var/lib/bairui/backups/backup_a.brb" } }), /not allowed/);
});
