import { randomUUID } from "node:crypto";
import { signMachineRequest } from "../packages/security/machine-request.mjs";
import { validateControlCommand } from "../packages/server-protocol/control-plane.mjs";

function commandEnvelope(command) {
  const allowed = new Set(["schema_version", "command_id", "idempotency_key", "deployment_id", "action", "target", "arguments", "approval_id", "expected_observation_version", "created_at", "expires_at", "attempt", "lease_expires_at", "placement", "config", "release", "rollback_release"]);
  for (const field of Object.keys(command)) if (!allowed.has(field)) throw new TypeError(`Unknown control command field: ${field}`);
  return {
    schema_version: command.schema_version,
    command_id: command.command_id,
    idempotency_key: command.idempotency_key,
    deployment_id: command.deployment_id,
    action: command.action,
    target: command.target,
    arguments: command.arguments,
    ...(command.approval_id ? { approval_id: command.approval_id } : {}),
    expected_observation_version: command.expected_observation_version,
    created_at: command.created_at,
    expires_at: command.expires_at
  };
}

export async function signedMachinePost(options) {
  const baseUrl = String(options.platformUrl).replace(/\/$/, "");
  const path = options.path;
  const body = JSON.stringify(options.payload ?? {});
  const timestamp = Date.now().toString();
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

export async function leaseControlCommands(options) {
  const response = await signedMachinePost({ ...options, machineId: options.serverId, path: "/api/internal/control-plane/commands/lease", payload: { serverId: options.serverId, limit: options.limit ?? 5, leaseSeconds: options.leaseSeconds ?? 120 } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error("Control command lease failed"), { code: body.error ?? "command_lease_failed", statusCode: response.status });
  return body.commands ?? [];
}

export async function sendCommandReceipt(options) {
  const path = `/api/internal/control-plane/commands/${encodeURIComponent(options.commandId)}/receipts`;
  const response = await signedMachinePost({ ...options, machineId: options.serverId, path, payload: { serverId: options.serverId, attempt: options.attempt, state: options.state, ...(options.errorCode ? { errorCode: options.errorCode } : {}), ...(options.errorSummary ? { errorSummary: options.errorSummary } : {}), ...(options.runtimeEndpointRef ? { runtimeEndpointRef: options.runtimeEndpointRef } : {}), resultSummary: options.resultSummary ?? {}, evidenceRefs: options.evidenceRefs ?? [] } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error("Control command receipt failed"), { code: body.error ?? "command_receipt_failed", statusCode: response.status });
  return body.receipt;
}

export async function executeControlCycle(options) {
  if (!options.executor?.execute) throw new TypeError("A white-listed control executor is required");
  const commands = await leaseControlCommands(options);
  const results = [];
  for (const command of commands) {
    validateControlCommand(commandEnvelope(command));
    const base = { ...options, commandId: command.command_id, attempt: command.attempt };
    await sendCommandReceipt({ ...base, state: "accepted" });
    await sendCommandReceipt({ ...base, state: "running" });
    const renewal = setInterval(() => { void sendCommandReceipt({ ...base, state: "running" }).catch(() => {}); }, Math.max(15_000, (options.leaseSeconds ?? 120) * 500));
    renewal.unref?.();
    try {
      const result = await options.executor.execute(command);
      await sendCommandReceipt({ ...base, state: "succeeded", runtimeEndpointRef: result?.runtimeEndpointRef, resultSummary: result?.summary, evidenceRefs: result?.evidenceRefs });
      results.push({ commandId: command.command_id, state: "succeeded", result });
    } catch (error) {
      const rawErrorCode = typeof error.code === "string" ? error.code : "executor_failed";
      const errorCode = rawErrorCode.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 200) || "executor_failed";
      const errorSummary = `Control executor failed (${errorCode})`;
      await sendCommandReceipt({ ...base, state: "failed", errorCode, errorSummary });
      results.push({ commandId: command.command_id, state: "failed", errorCode });
    } finally {
      clearInterval(renewal);
    }
  }
  return results;
}
