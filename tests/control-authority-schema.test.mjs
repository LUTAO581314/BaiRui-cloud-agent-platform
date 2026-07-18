import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ControlAuthorityService } from "../packages/control-authority/service.mjs";
import {
  assertSafeControlPayload,
  assertOperationalMetadata,
  digestControlValue,
  redactControlMetadata,
  validateAction
} from "../packages/control-authority/policy.mjs";
import { signControlMutation } from "../packages/security/control-mutation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = fs.readFileSync(path.join(root, "packages/db/migrations/021_control_authority_model.sql"), "utf8");
const repositorySource = fs.readFileSync(path.join(root, "packages/db/control-authority-repository.mjs"), "utf8");

const envelope = (overrides = {}) => {
  const value = {
    schema_version: "1.0",
    organization_id: "org_1",
    user_id: "user_1",
    agent_id: "agent_1",
    server_id: "server_1",
    request_id: "request_1",
    correlation_id: "correlation_1",
    idempotency_key: "idempotency_1",
    created_at: "2026-07-18T00:00:00.000Z",
    revision: 1,
    sequence: 1,
    ...overrides
  };
  return signControlMutation(value, {
    token: "control-authority-schema-test-signing-token",
    keyId: "server_1",
    signedAt: value.created_at,
    now: Date.parse(value.created_at)
  });
};

test("C00-03 migration defines durable Authority aggregates and safety guards", () => {
  for (const fragment of [
    "CREATE TABLE IF NOT EXISTS control_secret_references",
    "CREATE TABLE IF NOT EXISTS control_command_leases",
    "CREATE TABLE IF NOT EXISTS command_verifications",
    "CREATE TABLE IF NOT EXISTS control_idempotency_records",
    "CREATE TABLE IF NOT EXISTS control_audit_events",
    "control_outbox_authority_ready_idx",
    "bairui_control_json_is_safe",
    "bairui_secret_refs_are_opaque",
    "bairui_prepare_desired_state_revision",
    "desired_states_prepare_revision",
    "command_receipts_safe_payload",
    "control_audit_events_safe_payload",
    "completion_candidate",
    "freshness text",
    "'verifying'"
  ]) assert.ok(migration.includes(fragment), `migration is missing ${fragment}`);
  assert.match(migration, /token_hash text NOT NULL UNIQUE/);
  assert.doesNotMatch(migration, /token_value|secret_value|api_key_value/i);
});

test("control payload policy rejects business bodies and raw credentials", () => {
  assert.throws(() => assertSafeControlPayload({ prompt: "run this" }), (error) => error.code === "forbidden_field");
  assert.throws(() => assertSafeControlPayload({ nested: { memory: "private" } }), (error) => error.code === "forbidden_field");
  assert.throws(() => assertSafeControlPayload({ summary: "Bearer abcdefghijklmnopqrstuvwxyz" }), (error) => error.code === "raw_secret_not_allowed");
  assert.doesNotThrow(() => assertSafeControlPayload({
    deployment_id: "deployment_1",
    health_code: "healthy",
    queue_depth: 2,
    evidence_refs: ["ref:health:1"],
    secret_refs: ["sr_opaque_1"]
  }));
});

test("control audit redaction removes forbidden keys and credential-like text", () => {
  const result = redactControlMetadata({
    deployment_id: "deployment_1",
    prompt: "private prompt",
    nested: { token: "private token", status: "healthy" },
    summary: "Bearer abcdefghijklmnopqrstuvwxyz"
  });
  assert.equal(result.redacted, true);
  assert.deepEqual(result.value, { deployment_id: "deployment_1", nested: { status: "healthy" }, summary: "[redacted]" });
  assert.doesNotThrow(() => assertSafeControlPayload(result.value));
});

test("external control metadata cannot disguise free-form business text", () => {
  assert.doesNotThrow(() => assertOperationalMetadata({ queue_depth: 2, status: "healthy", evidence_refs: ["ref:health:1"] }));
  assert.throws(() => assertOperationalMetadata({ detail: "this is arbitrary conversation content" }), (error) => error.code === "forbidden_field");
  assert.throws(() => assertOperationalMetadata({ nested: { output: "assistant response body" } }), (error) => error.code === "forbidden_field");
});

test("closed control action dictionary rejects quarantined and arbitrary actions", () => {
  assert.deepEqual(validateAction("deployment.start", { agent_id: "agent_1" }), { agent_id: "agent_1" });
  assert.throws(() => validateAction("config.apply-user", { config_revision_id: "config_1" }), (error) => error.code === "forbidden_action");
  assert.throws(() => validateAction("runtime.shell", { script: "whoami" }), (error) => error.code === "forbidden_action");
  assert.throws(() => validateAction("deployment.start", { agent_id: "agent_1", model: "not-control-data" }), (error) => error.code === "forbidden_field");
});

test("Authority service normalizes a DesiredState without accepting hidden fields", async () => {
  let persisted;
  const service = new ControlAuthorityService({ repository: { createDesiredState: async (value) => (persisted = value) } });
  await service.putDesiredState(envelope({
    deployment_id: "deployment_1",
    version: 1,
    status: "active",
    target_state: "running",
    config_revision_id: "config_1",
    release_id: "release_1",
    module_versions: { "control-supervisor": "1.0.0" },
    modules: [{
      module_id: "control-supervisor",
      desired_status: "running",
      version_ref: "ref:module:1.0.0",
      image_digest: `sha256:${"a".repeat(64)}`,
      config_ref: "ref:config:1",
      enabled: true
    }],
    updated_at: "2026-07-18T00:00:00.000Z"
  }));
  assert.equal(persisted.deploymentId, "deployment_1");
  assert.equal(persisted.lifecycleStatus, "active");
  assert.equal(persisted.state, "running");
  assert.deepEqual(persisted.moduleVersions, { "control-supervisor": "1.0.0" });
  await assert.rejects(() => service.putDesiredState(envelope({
    deployment_id: "deployment_1",
    version: 1,
    status: "active",
    target_state: "running",
    modules: [],
    module_versions: {},
    updated_at: "2026-07-18T00:00:00.000Z",
    prompt: "hidden business payload"
  })), (error) => error.code === "invalid_contract");
});

test("Authority service maps canonical Observation, Command, and Approval fields", async () => {
  let observationInput;
  let commandInput;
  const service = new ControlAuthorityService({
    repository: {
      async recordObservation(value) { observationInput = value; return value; },
      async createCommand(value) { commandInput = value; return value; }
    }
  });
  await service.recordObservation(envelope({
    observation_id: "observation_1",
    deployment_id: "deployment_1",
    observation_version: 2,
    desired_state_version: 1,
    status: "healthy",
    freshness: "fresh",
    components: [{
      module_id: "control-supervisor",
      status: "healthy",
      version: "1.0.0",
      readiness: "ready",
      observed_at: "2026-07-18T00:00:01.000Z"
    }],
    source_identity: "reporter_1",
    redaction_status: "redacted",
    observed_at: "2026-07-18T00:00:01.000Z",
    received_at: "2026-07-18T00:00:02.000Z",
    freshness_seconds: 1
  }));
  assert.equal(observationInput.version, 2);
  assert.equal(observationInput.freshness, "fresh");
  assert.equal(observationInput.modules[0].module_id, "control-supervisor");

  const commandCreatedAt = "2026-07-18T00:00:03.000Z";
  const command = {
    schema_version: "1.0",
    command_id: "command_1",
    idempotency_key: "command_idempotency_1",
    deployment_id: "deployment_1",
    action: "deployment.start",
    target: { module_id: "control-supervisor", instance_id: "instance_1" },
    arguments: { agent_id: "agent_1" },
    secret_refs: ["sr_1234567890abcdef"],
    expected_observation_version: 2,
    created_at: commandCreatedAt,
    expires_at: "2026-07-18T00:10:03.000Z"
  };
  await service.requestCommand(envelope({
    idempotency_key: command.idempotency_key,
    created_at: commandCreatedAt,
    command
  }));
  assert.equal(commandInput.targetModuleId, "control-supervisor");
  assert.equal(commandInput.targetInstanceId, "instance_1");
  assert.deepEqual(commandInput.secretRefs, ["sr_1234567890abcdef"]);

  await assert.rejects(() => service.requestCommand(envelope({
    idempotency_key: command.idempotency_key,
    created_at: commandCreatedAt,
    command: { ...command, approval_id: "approval_unexpected" }
  })), (error) => error.code === "invalid_contract");
  await assert.rejects(() => service.requestCommand(envelope({
    idempotency_key: command.idempotency_key,
    created_at: commandCreatedAt,
    command: { ...command, secret_refs: ["ref:provider-key"] }
  })), (error) => error.code === "invalid_contract");

  const approvalId = "approval_delete_1";
  const deleteCommand = {
    ...command,
    command_id: "command_delete_1",
    idempotency_key: "command_delete_idempotency_1",
    action: "deployment.delete",
    arguments: { agent_id: "agent_1" },
    approval_id: approvalId
  };
  const pendingApproval = envelope({
    idempotency_key: "approval_idempotency_1",
    created_at: commandCreatedAt,
    approval_id: approvalId,
    command_id: deleteCommand.command_id,
    action: deleteCommand.action,
    risk_level: "high",
    requested_by: "user_1",
    decision: "pending",
    reason_code: "policy_required",
    reason_ref: "ref:approval-reason-1",
    expires_at: "2026-07-18T00:10:03.000Z",
    scope: {
      deployment_id: "deployment_1",
      organization_id: "org_1",
      user_id: "user_1",
      agent_id: "agent_1",
      server_id: "server_1"
    }
  });
  await service.requestCommand(envelope({
    idempotency_key: deleteCommand.idempotency_key,
    created_at: commandCreatedAt,
    command: deleteCommand
  }), { approval: pendingApproval });
  assert.equal(commandInput.approval.id, approvalId);
  assert.equal(commandInput.approval.scope.user_id, "user_1");
});

test("Authority service adapts canonical lease and completion-candidate envelopes", async () => {
  let leaseInput;
  let receiptInput;
  const service = new ControlAuthorityService({
    repository: {
      async leaseCommands(value) { leaseInput = value; return []; },
      async recordReceipt(value) { receiptInput = value; return value; }
    }
  });
  await service.leaseCommands(envelope({
    limit: 5,
    lease_seconds: 120,
    requested_at: "2026-07-18T00:00:00.000Z",
    capability_refs: ["ref:contracts-v2.3.0-rc.2"]
  }));
  assert.equal(leaseInput.agentId, "agent_1");
  assert.equal(leaseInput.userId, "user_1");
  assert.equal(leaseInput.serverId, "server_1");
  assert.equal(leaseInput.limit, 1);

  await service.recordReceipt(envelope({
    receipt_id: "receipt_1",
    deployment_id: "deployment_1",
    lease_id: "lease_1",
    lease_token: "ref:lease-token:1",
    command_id: "command_1",
    attempt: 1,
    state: "completion_candidate",
    event_sequence: 3,
    source_identity: "server_1",
    observation_version: 2,
    observed_at: "2026-07-18T00:00:01.000Z",
    completed_at: "2026-07-18T00:00:02.000Z",
    evidence_refs: [`sha256:${"b".repeat(64)}`]
  }));
  assert.equal(receiptInput.state, "completion_candidate");
  assert.equal(receiptInput.observationVersion, 2);
  await assert.rejects(() => service.recordReceipt(envelope({
    receipt_id: "receipt_legacy",
    deployment_id: "deployment_1",
    lease_id: "lease_legacy",
    lease_token: "ref:lease-token:legacy",
    command_id: "command_legacy",
    attempt: 1,
    state: "succeeded",
    event_sequence: 1,
    source_identity: "server_1",
    observed_at: "2026-07-18T00:00:01.000Z",
    completed_at: "2026-07-18T00:00:02.000Z"
  })), (error) => error.code === "invalid_contract");
});

test("repository persists lease hashes and gates final success on verification", () => {
  for (const fragment of [
    "hashToken(leaseToken)",
    "state='consumed'",
    "authorityState = input.state === \"completion_candidate\" ? \"verifying\"",
    "verification_state=$3",
    "A verified command requires a fresh healthy observation",
    "UPDATE control_commands SET state=$2, verification_state=$3, finalized_at=$4",
    "INSERT INTO control_outbox",
    "INSERT INTO control_audit_events"
  ]) assert.ok(repositorySource.includes(fragment), `repository is missing ${fragment}`);
  assert.equal(digestControlValue({ b: 2, a: 1 }), digestControlValue({ a: 1, b: 2 }));
});
