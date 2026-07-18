import { createHash, randomUUID } from "node:crypto";
import {
  CONTROL_ERROR_CODES,
  CONTROL_RECEIPT_STATES,
  validateControlError,
  validateLeaseEnvelope,
  validateLeaseRequestEnvelope,
  validateReceiptEnvelope,
  validateResourceReport
} from "@bairui/contracts";
import { signMachineRequest } from "../packages/security/machine-request.mjs";
import { signControlMutation, verifyControlMutationSignature } from "../packages/security/control-mutation.mjs";

/** @import { CanonicalLeaseEnvelope, LeaseRequestEnvelope, ReceiptEnvelope } from "@bairui/contracts" */

const TERMINAL_RECEIPTS = new Set(["completion_candidate", "failed", "cancelled", "expired"]);
const OPAQUE_REFERENCE = /^(?:ref|id|hint):[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const EVIDENCE_REFERENCE = /^(?:(?:ref|id|hint):[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}|sha256:[a-f0-9]{64})$/;

function controlError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

function nowMs(options) {
  const value = typeof options.now === "function" ? options.now() : options.now ?? Date.now();
  const milliseconds = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : Number(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError("Control clock must produce a valid timestamp");
  return milliseconds;
}

function nextSequence(options) {
  if (typeof options.nextSequence === "function") {
    const value = Number(options.nextSequence());
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Control sequence must be a positive integer");
    return value;
  }
  const state = options.sequenceState ?? (options.sequenceState = { value: 0 });
  state.value = Math.max(Number(state.value) + 1 || 1, Math.trunc(nowMs(options)));
  return state.value;
}

function requiredScope(options) {
  const fields = {
    organization_id: options.organizationId,
    user_id: options.userId,
    agent_id: options.agentId,
    server_id: options.serverId
  };
  for (const [field, value] of Object.entries(fields)) if (typeof value !== "string" || !value) throw new TypeError(`${field} is required for canonical control delivery`);
  return fields;
}

function mutationFields(options, values = {}) {
  const createdAt = new Date(nowMs(options)).toISOString();
  return {
    schema_version: "1.0",
    ...requiredScope(options),
    request_id: values.requestId ?? `req_${randomUUID()}`,
    correlation_id: values.correlationId ?? `corr_${randomUUID()}`,
    idempotency_key: values.idempotencyKey ?? `idem_${randomUUID()}`,
    created_at: createdAt,
    revision: Number(options.revision) || 1,
    sequence: nextSequence(options)
  };
}

function signMutation(value, options) {
  return signControlMutation(value, {
    token: options.token,
    keyId: options.serverId,
    signedAt: value.created_at,
    now: nowMs(options)
  });
}

function parseControlResponse(body, fallbackCode, statusCode) {
  try {
    const value = validateControlError(body);
    return controlError(value.error_code, `Control Plane rejected the request (${value.error_code})`, statusCode);
  } catch {
    return controlError(fallbackCode, "Control Plane rejected the request", statusCode);
  }
}

function assertLeaseBinding(lease, request, options) {
  for (const [field, expected] of Object.entries({
    organization_id: request.organization_id,
    user_id: request.user_id,
    agent_id: request.agent_id,
    server_id: request.server_id,
    request_id: request.request_id,
    correlation_id: request.correlation_id
  })) {
    if (lease[field] !== expected) throw controlError(field === "server_id" ? "server_mismatch" : "owner_mismatch", `Lease ${field} does not match its request`);
  }
  if (!verifyControlMutationSignature(lease, { token: options.token, expectedKeyId: options.platformKeyId ?? options.serverId, now: nowMs(options) })) {
    throw controlError("invalid_signature", "Lease mutation signature is invalid");
  }
  const now = nowMs(options);
  if (Date.parse(lease.lease_expires_at) <= now) throw controlError("lease_expired", "Control lease has expired");
  const replayCache = options.seenLeaseIds;
  if (replayCache?.has(lease.lease_id)) throw controlError("replay_detected", "Control lease was already processed");
  replayCache?.add(lease.lease_id);
}

function opaqueReference(value) {
  return typeof value === "string" && OPAQUE_REFERENCE.test(value) ? value : undefined;
}

function evidenceReferences(values) {
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string" || !value) continue;
    const reference = EVIDENCE_REFERENCE.test(value)
      ? value
      : `sha256:${createHash("sha256").update(value).digest("hex")}`;
    if (!output.includes(reference)) output.push(reference);
  }
  return output.slice(0, 100);
}

function wireErrorCode(value) {
  return CONTROL_ERROR_CODES.includes(value) ? value : "verification_failed";
}

export async function signedMachinePost(options) {
  const baseUrl = String(options.platformUrl).replace(/\/$/, "");
  const path = options.path;
  const body = JSON.stringify(options.payload ?? {});
  const timestamp = Math.trunc(nowMs(options)).toString();
  const nonce = randomUUID().replaceAll("-", "");
  const signature = signMachineRequest({ method: "POST", path, timestamp, nonce, body, token: options.token });
  return (options.fetch ?? globalThis.fetch)(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bairui-machine-id": options.machineId,
      "x-bairui-timestamp": timestamp,
      "x-bairui-nonce": nonce,
      "x-bairui-signature": signature
    },
    body,
    signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 15_000)
  });
}

/** @returns {Promise<CanonicalLeaseEnvelope>} */
export async function leaseControlCommands(options) {
  const fields = mutationFields(options, { correlationId: options.correlationId });
  const request = validateLeaseRequestEnvelope(signMutation({
    ...fields,
    limit: options.limit ?? 5,
    lease_seconds: options.leaseSeconds ?? 120,
    requested_at: fields.created_at,
    capability_refs: ["ref:control-lease-v1", "ref:contracts-v2.3.0-rc.1"]
  }, options));
  const response = await signedMachinePost({
    ...options,
    machineId: options.serverId,
    path: "/api/internal/control-plane/commands/lease",
    payload: request
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw parseControlResponse(body, "command_lease_failed", response.status);
  let lease;
  try { lease = validateLeaseEnvelope(body); }
  catch { throw controlError("invalid_lease_envelope", "Control Plane returned an invalid lease envelope", 502); }
  assertLeaseBinding(lease, request, options);
  return lease;
}

/** @returns {Promise<ReceiptEnvelope>} */
export async function sendCommandReceipt(options) {
  const { command: suppliedCommand, lease: suppliedLease, state } = options;
  if (!suppliedLease || !suppliedCommand) throw new TypeError("Canonical lease and command are required for a receipt");
  if (!CONTROL_RECEIPT_STATES.includes(state)) throw new TypeError(`Unsupported receipt state: ${state}`);
  let lease;
  try { lease = validateLeaseEnvelope(suppliedLease); }
  catch { throw controlError("lease_not_found", "Receipt lease envelope is invalid"); }
  const command = lease.commands.find((item) => item.command_id === suppliedCommand.command_id);
  if (!command || command.attempt !== suppliedCommand.attempt || command.lease_id !== suppliedCommand.lease_id || command.lease_token !== suppliedCommand.lease_token || (options.leaseToken !== undefined && command.lease_token !== options.leaseToken)) {
    throw controlError("lease_not_found", "Receipt lease binding is invalid");
  }
  for (const [field, expected] of Object.entries({ organization_id: options.organizationId, user_id: options.userId, agent_id: options.agentId, server_id: options.serverId })) {
    if (lease[field] !== expected) throw controlError(field === "server_id" ? "server_mismatch" : "owner_mismatch", `Receipt ${field} does not match its lease`);
  }
  const fields = mutationFields(options, {
    correlationId: lease.correlation_id,
    idempotencyKey: `receipt:${command.command_id}:${command.attempt}:${state}:${options.eventSequence}`
  });
  const evidenceRefs = evidenceReferences(options.evidenceRefs);
  if (state === "completion_candidate" && (!Number.isSafeInteger(options.observationVersion) || options.observationVersion < 1 || evidenceRefs.length === 0)) {
    throw Object.assign(controlError("verification_failed", "Completion candidate requires a newer observation and evidence"), { localReceiptValidation: true });
  }
  const errorCode = state === "failed" ? wireErrorCode(options.errorCode) : undefined;
  const errorRef = state === "failed" && options.errorCode && errorCode !== options.errorCode
    ? `hint:executor-error-${createHash("sha256").update(String(options.errorCode)).digest("hex").slice(0, 24)}`
    : opaqueReference(options.errorRef);
  const receipt = validateReceiptEnvelope(signMutation({
    ...fields,
    receipt_id: `receipt_${randomUUID()}`,
    deployment_id: command.deployment_id,
    lease_id: command.lease_id,
    lease_token: command.lease_token,
    command_id: command.command_id,
    attempt: command.attempt,
    state,
    event_sequence: options.eventSequence,
    source_identity: options.serverId,
    ...(Number.isSafeInteger(options.observationVersion) ? { observation_version: options.observationVersion } : {}),
    observed_at: fields.created_at,
    ...(TERMINAL_RECEIPTS.has(state) ? { completed_at: fields.created_at } : {}),
    ...(errorCode ? { error_code: errorCode } : {}),
    ...(errorRef ? { error_ref: errorRef } : {}),
    ...(evidenceRefs.length ? { evidence_refs: evidenceRefs } : {}),
    ...(opaqueReference(options.resultRef) ? { result_ref: options.resultRef } : {}),
    ...(opaqueReference(options.endpointRef) ? { endpoint_ref: options.endpointRef } : {})
  }, options));
  const path = `/api/internal/control-plane/commands/${encodeURIComponent(command.command_id)}/receipts`;
  const response = await signedMachinePost({ ...options, machineId: options.serverId, path, payload: receipt });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw parseControlResponse(body, "command_receipt_failed", response.status);
  return receipt;
}

export async function sendResourceSamples(options) {
  const payload = validateResourceReport({ serverId: options.serverId, samples: options.samples ?? [] });
  const response = await signedMachinePost({
    ...options,
    machineId: options.serverId,
    path: "/api/internal/control-plane/resources",
    payload
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error("Resource telemetry upload failed"), { code: body.error ?? "resource_upload_failed", statusCode: response.status });
  return body;
}

export async function executeControlCycle(options) {
  if (!options.executor?.execute) throw new TypeError("A white-listed control executor is required");
  const cycle = {
    ...options,
    sequenceState: options.sequenceState ?? { value: Math.trunc(nowMs(options)) },
    seenLeaseIds: options.seenLeaseIds ?? new Set()
  };
  const lease = await leaseControlCommands(cycle);
  const results = [];
  for (const command of lease.commands) {
    let eventSequence = 1;
    const base = { ...cycle, lease, command };
    if (Date.parse(command.lease_expires_at) <= nowMs(cycle) || Date.parse(command.expires_at) <= nowMs(cycle)) {
      await sendCommandReceipt({ ...base, state: "expired", eventSequence });
      results.push({ commandId: command.command_id, state: "expired" });
      continue;
    }
    await sendCommandReceipt({ ...base, state: "accepted", eventSequence: eventSequence++ });
    await sendCommandReceipt({ ...base, state: "running", eventSequence: eventSequence++ });
    let result;
    let observation;
    try {
      let executable = command;
      if (command.secret_refs?.length) {
        if (typeof cycle.resolveSecretRefs !== "function") throw controlError("raw_secret_not_allowed", "A local opaque secret resolver is required");
        executable = await cycle.resolveSecretRefs({ command, secretRefs: [...command.secret_refs], lease });
      }
      result = await cycle.executor.execute(executable);
      if (Date.parse(command.lease_expires_at) <= nowMs(cycle) || Date.parse(command.expires_at) <= nowMs(cycle)) {
        await sendCommandReceipt({ ...base, state: "expired", eventSequence });
        results.push({ commandId: command.command_id, state: "expired" });
        continue;
      }
      observation = typeof cycle.observe === "function" ? await cycle.observe({ command, lease, result }) : result;
    } catch (error) {
      await sendCommandReceipt({ ...base, state: "failed", eventSequence, errorCode: error.code ?? "verification_failed" });
      results.push({ commandId: command.command_id, state: "failed", errorCode: wireErrorCode(error.code) });
      continue;
    }
    try {
      await sendCommandReceipt({
        ...base,
        state: "completion_candidate",
        eventSequence,
        observationVersion: observation?.observationVersion,
        evidenceRefs: result?.evidenceRefs,
        resultRef: result?.resultRef,
        endpointRef: result?.endpointRef
      });
      results.push({ commandId: command.command_id, state: "completion_candidate" });
    } catch (error) {
      if (!error.localReceiptValidation) throw error;
      await sendCommandReceipt({ ...base, state: "failed", eventSequence, errorCode: error.code ?? "verification_failed" });
      results.push({ commandId: command.command_id, state: "failed", errorCode: wireErrorCode(error.code) });
    }
  }
  return results;
}
