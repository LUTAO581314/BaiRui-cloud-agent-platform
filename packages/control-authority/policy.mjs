import { createHash } from "node:crypto";

export const CONTROL_ACTION_ARGUMENTS = Object.freeze({
  "snapshot.collect": { required: [], optional: [] },
  "deployment.provision": { required: ["agent_id", "workspace_ref", "config_revision_id"], optional: [] },
  "deployment.start": { required: ["agent_id"], optional: [] },
  "deployment.stop": { required: ["agent_id"], optional: [] },
  "deployment.suspend": { required: ["agent_id"], optional: [] },
  "deployment.resume": { required: ["agent_id"], optional: [] },
  "deployment.delete": { required: ["agent_id"], optional: ["backup_id"] },
  "credential.revoke": { required: ["identity_id"], optional: [] },
  "probe.run": { required: ["probe_ids"], optional: ["test_run_id"] },
  "contract.test": { required: ["suite_id"], optional: ["test_run_id"] },
  "smoke.test": { required: ["suite_id"], optional: ["test_run_id"] },
  "upstream.check": { required: ["upstream_id"], optional: ["candidate_id", "test_run_id"] },
  "config.stage": { required: ["config_revision_id"], optional: [] },
  "config.apply": { required: ["config_revision_id"], optional: [] },
  "backup.create": { required: ["backup_policy_id"], optional: ["backup_id"] },
  "backup.verify": { required: ["backup_id"], optional: [] },
  "backup.restore": { required: ["backup_id", "restore_id"], optional: [] },
  "backup.expire": { required: ["backup_id"], optional: [] },
  "release.stage": { required: ["release_id"], optional: ["rollout_id"] },
  "release.apply": { required: ["release_id"], optional: ["rollout_id"] },
  "release.rollback": { required: ["release_id", "rollback_release_id"], optional: ["rollout_id"] },
  "service.restart": { required: ["service_id"], optional: [] }
});

export const APPROVAL_ACTIONS = Object.freeze(new Set([
  "config.apply", "backup.restore", "release.apply", "release.rollback",
  "service.restart", "deployment.delete", "credential.revoke"
]));

export const DESIRED_STATES = Object.freeze(new Set(["provisioned", "running", "stopped", "suspended", "deleted"]));
export const OBSERVATION_STATUSES = Object.freeze(new Set(["healthy", "degraded", "unhealthy", "unknown"]));
export const RECEIPT_STATES = Object.freeze(new Set(["accepted", "running", "succeeded", "failed", "cancelled", "expired"]));
export const VERIFICATION_STATES = Object.freeze(new Set(["verified", "failed", "stale", "blocked"]));

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const REFERENCE = /^(?:ref|id|hint):[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SECRET_REFERENCE = /^sr_[A-Za-z0-9_-]{16,128}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SECRET_TEXT = /(-----BEGIN\s+(?:[A-Z]+\s+)?PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._~+/=-]{16,}|(?:sk|gh[oprsu])[-_][A-Za-z0-9_-]{16,})/i;
const OPERATIONAL_TEXT = /^(?:(?:ref|id|hint):[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}|sha256:[0-9a-f]{64}|[A-Za-z0-9][A-Za-z0-9._:/-]{0,255})$/;
const FORBIDDEN_KEYS = new Set([
  "prompt", "systemprompt", "chat", "conversation", "conversations", "message", "messages",
  "task", "tasks", "model", "models", "provider", "providers", "tool", "tools", "skill",
  "skills", "memory", "memories", "password", "token", "accesstoken", "refreshtoken", "apikey",
  "accesskey", "secret", "secrets", "secretvalue", "secretenvelope", "credential", "credentials",
  "authorization", "shell", "script", "sql"
]);

const normalizeKey = (value) => String(value).replace(/[^A-Za-z0-9]/g, "").toLowerCase();

export function controlError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

export function assertIdentifier(value, name) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw controlError("invalid_identifier", `${name} is invalid`);
  return value;
}

export function assertReference(value, name) {
  if (typeof value !== "string" || !REFERENCE.test(value)) throw controlError("invalid_reference", `${name} must be an opaque reference`);
  return value;
}

export function assertSecretReference(value, name) {
  if (typeof value !== "string" || !SECRET_REFERENCE.test(value)) throw controlError("invalid_reference", `${name} must be an opaque secret reference`);
  return value;
}

export function assertDigest(value, name = "digest") {
  if (typeof value !== "string" || !DIGEST.test(value)) throw controlError("invalid_digest", `${name} must be an immutable sha256 digest`);
  return value;
}

export function assertTimestamp(value, name) {
  const timestamp = Date.parse(value);
  if (typeof value !== "string" || !Number.isFinite(timestamp)) throw controlError("invalid_timestamp", `${name} is invalid`);
  return new Date(timestamp).toISOString();
}

export function assertPositiveInteger(value, name, { allowZero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw controlError("invalid_sequence", `${name} is invalid`);
  return value;
}

export function assertSafeControlPayload(value, path = "payload") {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (value.length > 4096) throw controlError("forbidden_field", `${path} exceeds the control-plane text limit`);
    if (SECRET_TEXT.test(value)) throw controlError("raw_secret_not_allowed", `${path} contains secret material`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 1000) throw controlError("forbidden_field", `${path} exceeds the control-plane item limit`);
    value.forEach((item, index) => assertSafeControlPayload(item, `${path}[${index}]`));
    return value;
  }
  if (typeof value !== "object") throw controlError("forbidden_field", `${path} contains an unsupported value`);
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(normalizeKey(key))) throw controlError("forbidden_field", `${path}.${key} is forbidden in the control plane`);
    assertSafeControlPayload(item, `${path}.${key}`);
  }
  return value;
}

export function assertOperationalMetadata(value, path = "metadata", depth = 0) {
  assertSafeControlPayload(value, path);
  if (depth > 8) throw controlError("forbidden_field", `${path} exceeds the metadata depth limit`);
  if (value === null || value === undefined || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw controlError("forbidden_field", `${path} contains a non-finite number`);
    return value;
  }
  if (typeof value === "string") {
    if (!OPERATIONAL_TEXT.test(value)) throw controlError("forbidden_field", `${path} must contain an identifier, digest, timestamp, or opaque reference`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw controlError("forbidden_field", `${path} exceeds the metadata item limit`);
    value.forEach((item, index) => assertOperationalMetadata(item, `${path}[${index}]`, depth + 1));
    return value;
  }
  const entries = Object.entries(value);
  if (entries.length > 100) throw controlError("forbidden_field", `${path} exceeds the metadata field limit`);
  for (const [key, item] of entries) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) throw controlError("forbidden_field", `${path}.${key} is not an operational metadata field`);
    assertOperationalMetadata(item, `${path}.${key}`, depth + 1);
  }
  return value;
}

export function validateAction(action, args = {}) {
  const definition = CONTROL_ACTION_ARGUMENTS[action];
  if (!definition) throw controlError("forbidden_action", `Control action ${action} is not allowed`);
  if (!args || typeof args !== "object" || Array.isArray(args)) throw controlError("invalid_action", "Control arguments must be an object");
  assertSafeControlPayload(args, "arguments");
  const allowed = new Set([...definition.required, ...definition.optional]);
  for (const key of definition.required) if (!(key in args)) throw controlError("missing_field", `Missing control argument ${key}`);
  for (const key of Object.keys(args)) if (!allowed.has(key)) throw controlError("unknown_field", `Unknown control argument ${key}`);
  for (const [key, value] of Object.entries(args)) {
    if (key === "probe_ids") {
      if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw controlError("invalid_action", "probe_ids is invalid");
      value.forEach((item) => assertIdentifier(item, "probe_id"));
    } else {
      assertIdentifier(value, key);
    }
  }
  return args;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function digestControlValue(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function redactControlMetadata(value, depth = 0) {
  if (depth > 8) return { value: "[redacted-depth]", redacted: true };
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return { value, redacted: false };
  if (typeof value === "string") {
    if (SECRET_TEXT.test(value)) return { value: "[redacted]", redacted: true };
    return { value: value.slice(0, 512), redacted: value.length > 512 };
  }
  if (Array.isArray(value)) {
    let redacted = value.length > 100;
    const output = value.slice(0, 100).map((item) => {
      const result = redactControlMetadata(item, depth + 1);
      redacted ||= result.redacted;
      return result.value;
    });
    return { value: output, redacted };
  }
  if (typeof value !== "object") return { value: "[redacted-type]", redacted: true };
  let redacted = false;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(normalizeKey(key))) {
      redacted = true;
      continue;
    }
    const result = redactControlMetadata(item, depth + 1);
    output[key] = result.value;
    redacted ||= result.redacted;
  }
  return { value: output, redacted };
}
