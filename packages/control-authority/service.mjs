import {
  APPROVAL_ACTIONS,
  VERIFICATION_STATES,
  assertDigest,
  assertIdentifier,
  assertOperationalMetadata,
  assertPositiveInteger,
  assertReference,
  assertSecretReference,
  assertSafeControlPayload,
  assertTimestamp,
  controlError,
  validateAction
} from "./policy.mjs";
import {
  CONTROL_RECEIPT_STATES,
  validateApproval,
  validateControlCommandEnvelope,
  validateDesiredState,
  validateLeaseRequestEnvelope,
  validateObservation,
  validateReceiptEnvelope,
  validateReleaseManifest
} from "@bairui/contracts";

const COMMON_FIELDS = [
  "schema_version", "organization_id", "user_id", "agent_id", "server_id",
  "request_id", "correlation_id", "idempotency_key", "created_at", "revision", "sequence"
];
const CANONICAL_RECEIPT_STATES = new Set(CONTROL_RECEIPT_STATES);

function assertOnlyFields(input, allowed, context) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw controlError("invalid_schema", `${context} must be an object`);
  const accepted = new Set(allowed);
  for (const key of Object.keys(input)) if (!accepted.has(key)) throw controlError("unknown_field", `${context}.${key} is not allowed`);
}

function normalizeEnvelope(input, context) {
  if (input.schema_version !== "1.0") throw controlError("unsupported_schema_version", `${context}.schema_version must be 1.0`);
  const createdAt = assertTimestamp(input.created_at, `${context}.created_at`);
  const signature = input.signature;
  if (!signature || !["ed25519", "hmac-sha256"].includes(signature.algorithm)
    || typeof signature.value !== "string" || signature.value.length < 16
    || assertIdentifier(signature.key_id, `${context}.signature.key_id`) !== signature.key_id
    || Date.parse(assertTimestamp(signature.signed_at, `${context}.signature.signed_at`)) < Date.parse(createdAt)) {
    throw controlError("invalid_signature", `${context}.signature is invalid`);
  }
  return {
    schemaVersion: input.schema_version,
    organizationId: assertIdentifier(input.organization_id, `${context}.organization_id`),
    userId: assertIdentifier(input.user_id, `${context}.user_id`),
    agentId: assertIdentifier(input.agent_id, `${context}.agent_id`),
    serverId: assertIdentifier(input.server_id, `${context}.server_id`),
    requestId: assertIdentifier(input.request_id, `${context}.request_id`),
    correlationId: assertIdentifier(input.correlation_id, `${context}.correlation_id`),
    idempotencyKey: assertIdentifier(input.idempotency_key, `${context}.idempotency_key`),
    createdAt,
    revision: assertPositiveInteger(input.revision, `${context}.revision`),
    sequence: assertPositiveInteger(input.sequence, `${context}.sequence`)
  };
}

function normalizeEvidenceRefs(value, context) {
  if (!Array.isArray(value) || value.length > 100 || new Set(value).size !== value.length) throw controlError("invalid_reference", `${context} is invalid`);
  return value.map((item, index) => String(item).startsWith("sha256:")
    ? assertDigest(item, `${context}[${index}]`)
    : assertReference(item, `${context}[${index}]`));
}

function normalizeModules(modules, context) {
  if (!Array.isArray(modules) || modules.length > 100) throw controlError("invalid_schema", `${context} is invalid`);
  const seen = new Set();
  return modules.map((module, index) => {
    assertOnlyFields(module, ["module_id", "desired_status", "status", "version", "version_ref", "image_digest", "config_ref", "enabled", "readiness", "observed_at", "evidence_refs", "health_code"], `${context}[${index}]`);
    const moduleId = assertIdentifier(module.module_id, `${context}[${index}].module_id`);
    if (seen.has(moduleId)) throw controlError("invalid_schema", `${context} contains duplicate module_id`);
    seen.add(moduleId);
    if (module.image_digest !== undefined) assertDigest(module.image_digest, `${context}[${index}].image_digest`);
    if (module.version_ref !== undefined) assertReference(module.version_ref, `${context}[${index}].version_ref`);
    if (module.config_ref !== undefined) assertReference(module.config_ref, `${context}[${index}].config_ref`);
    if (module.observed_at !== undefined) assertTimestamp(module.observed_at, `${context}[${index}].observed_at`);
    if (module.evidence_refs !== undefined) normalizeEvidenceRefs(module.evidence_refs, `${context}[${index}].evidence_refs`);
    assertSafeControlPayload(module, `${context}[${index}]`);
    return module;
  });
}

function normalizePendingApproval(value, envelope, command) {
  if (!value) throw controlError("approval_required", `Control action ${command.action} requires a canonical Approval`);
  const approval = validateApproval(value);
  const ownerFields = ["organization_id", "user_id", "agent_id", "server_id"];
  if (ownerFields.some((field) => approval[field] !== envelope[field])
    || approval.scope.deployment_id !== command.deployment_id
    || ownerFields.some((field) => approval.scope[field] !== envelope[field])
    || approval.approval_id !== command.approval_id
    || approval.command_id !== command.command_id
    || approval.action !== command.action
    || approval.requested_by !== envelope.user_id
    || approval.decision !== "pending") {
    throw controlError("approval_not_valid", "Approval is not bound to the canonical command and owner scope");
  }
  return {
    id: approval.approval_id,
    riskLevel: approval.risk_level,
    reasonCode: approval.reason_code ?? "policy_required",
    reasonRef: approval.reason_ref ?? `ref:approval:${approval.approval_id}`,
    expiresAt: approval.expires_at,
    createdAt: approval.created_at,
    sequence: approval.sequence,
    idempotencyKey: approval.idempotency_key,
    requestedBy: approval.requested_by,
    scope: approval.scope
  };
}

export class ControlAuthorityService {
  constructor({ repository }) {
    if (!repository) throw new TypeError("ControlAuthorityService requires a repository");
    this.repository = repository;
  }

  async putDesiredState(input) {
    const desired = validateDesiredState(input);
    const envelope = normalizeEnvelope(desired, "DesiredState");
    const modules = normalizeModules(desired.modules ?? [], "DesiredState.modules");
    assertSafeControlPayload(desired.module_versions, "DesiredState.module_versions");
    return this.repository.createDesiredState({
      ...envelope,
      deploymentId: desired.deployment_id,
      version: desired.version,
      lifecycleStatus: desired.status,
      state: desired.target_state,
      configRevisionId: desired.config_revision_id ?? null,
      releaseManifestId: desired.release_id ?? null,
      backupId: desired.backup_id ?? null,
      moduleVersions: desired.module_versions,
      modules,
      validFrom: desired.valid_from ?? envelope.createdAt,
      expiresAt: desired.expires_at ?? null,
      updatedAt: desired.updated_at,
      createdBy: envelope.userId
    });
  }

  async recordObservation(input) {
    const observation = validateObservation(input);
    const envelope = normalizeEnvelope(observation, "Observation");
    const components = normalizeModules(observation.components, "Observation.components");
    return this.repository.recordObservation({
      ...envelope,
      id: observation.observation_id,
      deploymentId: observation.deployment_id,
      version: observation.observation_version,
      desiredStateVersion: observation.desired_state_version ?? 0,
      status: observation.status,
      freshness: observation.freshness,
      modules: components,
      summary: {},
      evidenceRefs: observation.evidence_refs ?? [],
      redactionStatus: observation.redaction_status,
      observedAt: observation.observed_at,
      receivedAt: observation.received_at,
      freshnessSeconds: observation.freshness_seconds ?? Math.max(0, Math.floor((Date.parse(observation.received_at) - Date.parse(observation.observed_at)) / 1000)),
      sourceIdentity: observation.source_identity
    });
  }

  async requestCommand(input, options = {}) {
    const commandEnvelope = validateControlCommandEnvelope(input);
    const envelope = normalizeEnvelope(commandEnvelope, "ControlCommandEnvelope");
    const command = commandEnvelope.command;
    const args = validateAction(command.action, command.arguments);
    const approvalRequired = APPROVAL_ACTIONS.has(command.action);
    if (!approvalRequired && options.approval) throw controlError("approval_not_valid", `Control action ${command.action} does not accept an Approval`);
    const approval = approvalRequired ? normalizePendingApproval(options.approval, commandEnvelope, command) : null;
    const secretRefs = command.secret_refs ?? [];
    secretRefs.forEach((item, index) => assertSecretReference(item, `ControlCommand.secret_refs[${index}]`));
    return this.repository.createCommand({
      ...envelope,
      id: command.command_id,
      deploymentId: command.deployment_id,
      targetModuleId: command.target.module_id,
      targetInstanceId: command.target.instance_id ?? null,
      action: command.action,
      arguments: args,
      expectedObservationVersion: command.expected_observation_version,
      priority: 100,
      notBefore: command.not_before ?? command.created_at,
      expiresAt: command.expires_at,
      approval,
      secretRefs
    });
  }

  async decideApproval(input) {
    const approval = validateApproval(input);
    const envelope = normalizeEnvelope(approval, "Approval");
    if (!["approved", "rejected"].includes(approval.decision)) throw controlError("approval_not_valid", "Approval decision must be approved or rejected");
    return this.repository.decideApproval({
      ...envelope,
      approvalId: approval.approval_id,
      commandId: approval.command_id,
      action: approval.action,
      decision: approval.decision,
      reasonCode: approval.reason_code ?? "operator_requested",
      reasonRef: approval.reason_ref ?? null,
      requestedBy: approval.requested_by,
      decidedAt: approval.decided_at,
      decidedBy: approval.decided_by,
      scope: approval.scope
    });
  }

  async registerReleaseManifest(input) {
    const manifest = validateReleaseManifest(input);
    const envelope = normalizeEnvelope(manifest, "ReleaseManifest");
    assertSafeControlPayload(manifest.artifacts, "ReleaseManifest.artifacts");
    assertOperationalMetadata(manifest.compatibility, "ReleaseManifest.compatibility");
    return this.repository.createReleaseManifest({
      ...envelope,
      id: manifest.release_id,
      version: manifest.version,
      channel: manifest.channel,
      status: manifest.status,
      contractsVersion: manifest.contracts_version,
      immutable: true,
      agentCommit: manifest.agent_commit,
      artifacts: manifest.artifacts,
      sbomRef: manifest.sbom_ref ?? null,
      provenanceRef: manifest.provenance_ref ?? null,
      attestationRef: manifest.attestation_ref ?? null,
      migrationRef: manifest.migration_ref ?? null,
      compatibility: manifest.compatibility,
      releaseNotesRef: manifest.release_notes_ref ?? null,
      createdBy: envelope.userId
    });
  }

  async registerSecretReference(input) {
    assertOnlyFields(input, [...COMMON_FIELDS, "signature", "secret_ref", "deployment_id", "purpose", "version", "state", "masked", "fingerprint", "authorized_identity", "last_verified_at", "expires_at"], "SecretReference");
    const envelope = normalizeEnvelope(input, "SecretReference");
    if (!/^[a-z][a-z0-9._-]{0,63}$/.test(input.purpose ?? "")) throw controlError("invalid_schema", "SecretReference.purpose is invalid");
    if (!["pending", "active", "rotating", "revoked", "expired"].includes(input.state)) throw controlError("invalid_schema", "SecretReference.state is invalid");
    if (typeof input.masked !== "string" || input.masked.length < 4 || input.masked.length > 64) throw controlError("invalid_schema", "SecretReference.masked is invalid");
    assertDigest(input.fingerprint, "SecretReference.fingerprint");
    return this.repository.registerSecretReference({
      ...envelope,
      id: assertSecretReference(input.secret_ref, "SecretReference.secret_ref"),
      deploymentId: input.deployment_id ? assertIdentifier(input.deployment_id, "SecretReference.deployment_id") : null,
      purpose: input.purpose,
      version: assertPositiveInteger(input.version, "SecretReference.version"),
      state: input.state,
      masked: input.masked,
      fingerprint: input.fingerprint,
      authorizedIdentity: input.authorized_identity ? assertIdentifier(input.authorized_identity, "SecretReference.authorized_identity") : null,
      lastVerifiedAt: input.last_verified_at ? assertTimestamp(input.last_verified_at, "SecretReference.last_verified_at") : null,
      expiresAt: input.expires_at ? assertTimestamp(input.expires_at, "SecretReference.expires_at") : null
    });
  }

  async leaseCommands(input) {
    const request = validateLeaseRequestEnvelope(input);
    const envelope = normalizeEnvelope(request, "LeaseRequest");
    return this.repository.leaseCommands({
      organizationId: envelope.organizationId,
      userId: envelope.userId,
      agentId: envelope.agentId,
      serverId: envelope.serverId,
      limit: 1,
      leaseSeconds: request.lease_seconds
    });
  }

  async recordReceipt(input) {
    const receipt = validateReceiptEnvelope(input);
    const envelope = normalizeEnvelope(receipt, "Receipt");
    if (!CANONICAL_RECEIPT_STATES.has(receipt.state)) throw controlError("verification_failed", "Receipt.state is invalid");
    return this.repository.recordReceipt({
      ...envelope,
      id: receipt.receipt_id,
      deploymentId: receipt.deployment_id,
      leaseId: receipt.lease_id,
      leaseToken: receipt.lease_token,
      commandId: receipt.command_id,
      attempt: receipt.attempt,
      state: receipt.state,
      eventSequence: receipt.event_sequence,
      sourceIdentity: receipt.source_identity,
      observationVersion: receipt.observation_version ?? null,
      observedAt: receipt.observed_at,
      completedAt: receipt.completed_at ?? null,
      evidenceRefs: receipt.evidence_refs ?? [],
      resultRef: receipt.result_ref ?? null,
      endpointRef: receipt.endpoint_ref ?? null,
      errorCode: receipt.error_code ?? null,
      errorRef: receipt.error_ref ?? null,
      errorSummary: null,
      resultSummary: {}
    });
  }

  async verifyCommand(input) {
    assertOnlyFields(input, [...COMMON_FIELDS, "signature", "verification_id", "command_id", "attempt", "observation_id", "status", "checks", "evidence_refs", "verified_by", "completed_at", "max_freshness_seconds"], "Verification");
    const envelope = normalizeEnvelope(input, "Verification");
    if (!VERIFICATION_STATES.has(input.status)) throw controlError("invalid_schema", "Verification.status is invalid");
    assertOperationalMetadata(input.checks ?? [], "Verification.checks");
    return this.repository.verifyCommand({
      ...envelope,
      id: assertIdentifier(input.verification_id, "Verification.verification_id"),
      commandId: assertIdentifier(input.command_id, "Verification.command_id"),
      attempt: assertPositiveInteger(input.attempt, "Verification.attempt"),
      observationId: assertIdentifier(input.observation_id, "Verification.observation_id"),
      status: input.status,
      checks: input.checks ?? [],
      evidenceRefs: normalizeEvidenceRefs(input.evidence_refs ?? [], "Verification.evidence_refs"),
      verifiedBy: assertIdentifier(input.verified_by, "Verification.verified_by"),
      completedAt: input.completed_at ? assertTimestamp(input.completed_at, "Verification.completed_at") : new Date().toISOString(),
      maxFreshnessSeconds: assertPositiveInteger(input.max_freshness_seconds ?? 120, "Verification.max_freshness_seconds")
    });
  }

  async leaseOutbox(input = {}) {
    assertOnlyFields(input, ["limit", "lease_seconds"], "OutboxLease");
    return this.repository.leaseOutbox({
      limit: assertPositiveInteger(input.limit ?? 100, "OutboxLease.limit"),
      leaseSeconds: assertPositiveInteger(input.lease_seconds ?? 60, "OutboxLease.lease_seconds")
    });
  }

  async settleOutbox(input) {
    assertOnlyFields(input, ["outbox_id", "lease_token", "outcome", "error_code", "error_summary", "retry_delay_seconds"], "OutboxSettlement");
    if (!["published", "retry"].includes(input.outcome)) throw controlError("invalid_schema", "OutboxSettlement.outcome is invalid");
    return this.repository.settleOutbox({
      id: assertIdentifier(input.outbox_id, "OutboxSettlement.outbox_id"),
      leaseToken: assertReference(input.lease_token, "OutboxSettlement.lease_token"),
      outcome: input.outcome,
      errorCode: input.error_code ? assertIdentifier(input.error_code, "OutboxSettlement.error_code") : null,
      errorSummary: typeof input.error_summary === "string" ? input.error_summary.slice(0, 512) : null,
      retryDelaySeconds: assertPositiveInteger(input.retry_delay_seconds ?? 30, "OutboxSettlement.retry_delay_seconds")
    });
  }

  async listDeploymentAggregates(input) {
    assertOnlyFields(input, ["organization_id", "limit", "cursor"], "DeploymentQuery");
    return this.repository.listDeploymentAggregates({
      organizationId: assertIdentifier(input.organization_id, "DeploymentQuery.organization_id"),
      limit: assertPositiveInteger(input.limit ?? 50, "DeploymentQuery.limit"),
      cursor: input.cursor ?? null
    });
  }
}
