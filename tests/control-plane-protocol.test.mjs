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

test("rejects content and executable fields", () => {
  assert.throws(() => validateControlCommand({ ...base(), arguments: { release_id: "rel_1", prompt: "hello" } }), /not allowed/);
  assert.throws(() => validateControlCommand({ ...base(), script: "restart everything" }), /Unknown control command field/);
});
