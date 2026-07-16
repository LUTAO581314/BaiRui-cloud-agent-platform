export const CONTROL_PROTOCOL_VERSION = "1.0";

export const CONTROL_ACTIONS = Object.freeze([
  "snapshot.collect",
  "deployment.provision",
  "deployment.start",
  "deployment.stop",
  "deployment.suspend",
  "deployment.resume",
  "deployment.delete",
  "credential.revoke",
  "probe.run",
  "contract.test",
  "smoke.test",
  "upstream.check",
  "config.stage",
  "config.apply",
  "backup.create",
  "backup.verify",
  "backup.restore",
  "backup.expire",
  "release.stage",
  "release.apply",
  "release.rollback",
  "service.restart"
]);

const ARGUMENTS = Object.freeze({
  "snapshot.collect": [[], []],
  "deployment.provision": [["agent_id", "workspace_ref", "config_revision_id"], []],
  "deployment.start": [["agent_id"], []],
  "deployment.stop": [["agent_id"], []],
  "deployment.suspend": [["agent_id"], []],
  "deployment.resume": [["agent_id"], []],
  "deployment.delete": [["agent_id"], ["backup_id"]],
  "credential.revoke": [["identity_id"], []],
  "probe.run": [["probe_ids"], ["test_run_id"]],
  "contract.test": [["suite_id"], ["test_run_id"]],
  "smoke.test": [["suite_id"], ["test_run_id"]],
  "upstream.check": [["upstream_id"], ["candidate_id", "test_run_id"]],
  "config.stage": [["config_revision_id"], []],
  "config.apply": [["config_revision_id"], []],
  "backup.create": [["backup_policy_id"], ["backup_id"]],
  "backup.verify": [["backup_id"], []],
  "backup.restore": [["backup_id", "restore_id"], []],
  "backup.expire": [["backup_id"], []],
  "release.stage": [["release_id"], ["rollout_id"]],
  "release.apply": [["release_id"], ["rollout_id"]],
  "release.rollback": [["release_id", "rollback_release_id"], ["rollout_id"]],
  "service.restart": [["service_id"], []]
});

const APPROVAL_REQUIRED = new Set(["config.apply", "backup.restore", "release.apply", "release.rollback", "service.restart", "deployment.delete", "credential.revoke"]);
const TOP_LEVEL = new Set(["schema_version", "command_id", "idempotency_key", "deployment_id", "action", "target", "arguments", "approval_id", "expected_observation_version", "not_before", "expires_at", "created_at"]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function identifier(value, name) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)) throw new TypeError(`${name} must be a non-empty identifier`);
}

function timestamp(value, name) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new TypeError(`${name} must be an ISO timestamp`);
}

function argument(value, name) {
  if (Array.isArray(value)) {
    if (value.length === 0 || value.length > 100) throw new TypeError(`${name} must contain 1-100 identifiers`);
    for (const item of value) identifier(item, name);
  } else {
    identifier(value, name);
  }
}

export function validateControlCommand(command) {
  if (!isObject(command)) throw new TypeError("Control command must be an object");
  for (const field of Object.keys(command)) if (!TOP_LEVEL.has(field)) throw new TypeError(`Unknown control command field: ${field}`);
  if (command.schema_version !== CONTROL_PROTOCOL_VERSION) throw new TypeError("Unsupported control protocol version");
  for (const field of ["command_id", "idempotency_key", "deployment_id"]) identifier(command[field], field);
  if (!CONTROL_ACTIONS.includes(command.action)) throw new TypeError(`Control action is not allowed: ${command.action}`);
  if (!isObject(command.target)) throw new TypeError("target must be an object");
  for (const field of Object.keys(command.target)) if (!["module_id", "instance_id"].includes(field)) throw new TypeError(`Unknown target field: ${field}`);
  identifier(command.target.module_id, "target.module_id");
  if (command.target.instance_id !== undefined) identifier(command.target.instance_id, "target.instance_id");
  if (!isObject(command.arguments)) throw new TypeError("arguments must be an object");
  const [required, optional] = ARGUMENTS[command.action];
  const allowed = new Set([...required, ...optional]);
  for (const field of Object.keys(command.arguments)) {
    if (!allowed.has(field)) throw new TypeError(`Argument ${field} is not allowed for ${command.action}`);
    argument(command.arguments[field], `arguments.${field}`);
  }
  for (const field of required) if (!(field in command.arguments)) throw new TypeError(`Missing required argument for ${command.action}: ${field}`);
  if (APPROVAL_REQUIRED.has(command.action)) identifier(command.approval_id, "approval_id");
  if (!Number.isSafeInteger(command.expected_observation_version) || command.expected_observation_version < 0) throw new TypeError("expected_observation_version must be a non-negative integer");
  timestamp(command.created_at, "created_at");
  timestamp(command.expires_at, "expires_at");
  if (command.not_before !== undefined) timestamp(command.not_before, "not_before");
  if (Date.parse(command.expires_at) <= Date.parse(command.created_at)) throw new TypeError("expires_at must be after created_at");
  return command;
}
