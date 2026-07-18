import { randomUUID } from "node:crypto";
import {
  CONTROL_ERROR_CODES,
  validateControlError,
  validateLeaseEnvelope,
  validateLeaseRequestEnvelope,
  validateReceiptEnvelope,
  validateResourceReport,
  validateRuntimeHeartbeat
} from "@bairui/contracts";
import { verifyControlMutationSignature } from "../../../packages/security/control-mutation.mjs";
import { constantTokenMatch, json, readJson, readSignedJson } from "../http.mjs";

const CONTROL_LAYERS = new Set(["core-runtime", "service-integration", "data-storage", "channel-bridge", "ui-exposure"]);
const COMPONENT_STATUSES = new Set(["healthy", "degraded", "unhealthy", "unknown"]);
const TELEMETRY_SEVERITIES = new Set(["debug", "info", "warning", "error", "critical"]);
const RESOURCE_STATUSES = new Set(["running", "degraded", "offline", "unknown"]);
const CONTAINER_RESOURCE_ROLES = new Set(["hermes", "hermes-dashboard", "runtime-boundary"]);
const CONTAINER_RESOURCE_STATUSES = new Set(["running", "paused", "restarting", "exited", "dead", "created", "removing", "unknown"]);

function numericMetrics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => /^[a-z][a-z0-9_.-]{0,63}$/.test(key) && Number.isFinite(item)).slice(0, 100));
}

function optionalResourceNumber(value, maximum = Number.MAX_SAFE_INTEGER, integer = false) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > maximum || (integer && !Number.isSafeInteger(number))) return undefined;
  return number;
}

function resourceText(value, maximum) {
  return typeof value === "string" && value.trim() ? value.replace(/[\0\r\n]/g, " ").trim().slice(0, maximum) : null;
}

function resourceSample(value) {
  const identifier = (item) => typeof item === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(item) ? item : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const agentId = identifier(value.agentId);
  const runtimeId = identifier(value.runtimeId);
  const deploymentId = identifier(value.deploymentId);
  if (!agentId || !runtimeId || !deploymentId || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || !RESOURCE_STATUSES.has(value.status) || !Number.isFinite(Date.parse(value.observedAt))) return null;
  const numeric = {
    cpuPercent: optionalResourceNumber(value.cpuPercent, 100_000),
    memoryUsedBytes: optionalResourceNumber(value.memoryUsedBytes, Number.MAX_SAFE_INTEGER, true),
    memoryLimitBytes: optionalResourceNumber(value.memoryLimitBytes, Number.MAX_SAFE_INTEGER, true),
    agentStorageUsedBytes: optionalResourceNumber(value.agentStorageUsedBytes, Number.MAX_SAFE_INTEGER, true),
    hostStorageUsedBytes: optionalResourceNumber(value.hostStorageUsedBytes, Number.MAX_SAFE_INTEGER, true),
    hostStorageLimitBytes: optionalResourceNumber(value.hostStorageLimitBytes, Number.MAX_SAFE_INTEGER, true),
    cpuCount: optionalResourceNumber(value.cpuCount, 1_000_000, true),
    uptimeSeconds: optionalResourceNumber(value.uptimeSeconds, Number.MAX_SAFE_INTEGER, true)
  };
  if (Object.values(numeric).some((item) => item === undefined)) return null;
  const containers = (Array.isArray(value.containers) ? value.containers.slice(0, 16) : []).map((container) => {
    if (!container || !CONTAINER_RESOURCE_ROLES.has(container.role) || !CONTAINER_RESOURCE_STATUSES.has(container.status)) return null;
    const values = {
      cpuPercent: optionalResourceNumber(container.cpuPercent, 100_000),
      memoryUsedBytes: optionalResourceNumber(container.memoryUsedBytes, Number.MAX_SAFE_INTEGER, true),
      memoryLimitBytes: optionalResourceNumber(container.memoryLimitBytes, Number.MAX_SAFE_INTEGER, true),
      writableBytes: optionalResourceNumber(container.writableBytes, Number.MAX_SAFE_INTEGER, true)
    };
    if (Object.values(values).some((item) => item === undefined)) return null;
    return { role: container.role, status: container.status, containerId: resourceText(container.containerId, 128), containerName: resourceText(container.containerName, 128), imageRef: resourceText(container.imageRef, 500), version: resourceText(container.version, 200), ...values, startedAt: Number.isFinite(Date.parse(container.startedAt)) ? new Date(container.startedAt).toISOString() : null };
  });
  if (containers.some((container) => !container) || new Set(containers.map((container) => container.role)).size !== containers.length) return null;
  return { agentId, runtimeId, deploymentId, sequence: value.sequence, status: value.status, ...numeric, osType: resourceText(value.osType, 80), architecture: resourceText(value.architecture, 80), operatingSystem: resourceText(value.operatingSystem, 300), dockerVersion: resourceText(value.dockerVersion, 100), startedAt: Number.isFinite(Date.parse(value.startedAt)) ? new Date(value.startedAt).toISOString() : null, observedAt: new Date(value.observedAt).toISOString(), containers };
}

function controlIdentifier(value, prefix) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)
    ? value
    : `${prefix}_${randomUUID()}`;
}

function controlErrorSurface(body, errorCode, options = {}) {
  return validateControlError({
    schema_version: "1.0",
    error_code: errorCode,
    retryable: options.retryable === true,
    request_id: controlIdentifier(body?.request_id, "request"),
    correlation_id: controlIdentifier(body?.correlation_id, "correlation"),
    ...(options.field ? { field: options.field } : {}),
    ...(options.ref ? { ref: options.ref } : {}),
    occurred_at: new Date().toISOString()
  });
}

function matchingControlScope(left, right) {
  return ["organization_id", "user_id", "agent_id", "server_id", "request_id", "correlation_id"].every((field) => left[field] === right[field]);
}

export function createInternalControlRoutes(options) {
  const { repository, controlAuthority, authenticateMachine, agentIngestToken, publicSnapshot } = options;
  return async function routeInternalControl({ method, url, request, response }) {
    const receiptMatch = url.pathname.match(/^\/api\/internal\/control-plane\/commands\/([^/]+)\/receipts$/);
    const leaseRequest = method === "POST" && url.pathname === "/api/internal/control-plane/commands/lease";
    const snapshotRequest = method === "POST" && url.pathname === "/api/internal/control-plane/snapshots";
    const heartbeatRequest = method === "POST" && url.pathname === "/api/internal/control-plane/heartbeats";
    const resourceRequest = method === "POST" && url.pathname === "/api/internal/control-plane/resources";
    if (!leaseRequest && !(method === "POST" && receiptMatch) && !snapshotRequest && !heartbeatRequest && !resourceRequest) return false;

    if (snapshotRequest) {
      const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!constantTokenMatch(bearer, agentIngestToken)) { json(response, 401, { error: "invalid_agent_credential" }); return true; }
      const body = await readJson(request);
      if (!body.organizationId || !body.serverId || !body.snapshot?.schemaVersion) { json(response, 400, { error: "invalid_snapshot" }); return true; }
      if (!await repository.getOrganization(body.organizationId)) { json(response, 404, { error: "organization_not_found" }); return true; }
      const snapshot = publicSnapshot(body.snapshot);
      const saved = await repository.saveControlPlaneSnapshot({ organizationId: body.organizationId, serverId: body.serverId, status: snapshot.status ?? "unknown", payload: snapshot });
      await repository.recordServerHeartbeat({ id: body.serverId, organizationId: body.organizationId, status: snapshot.status ?? "unknown", runtimeVersion: snapshot.heartbeat?.runtimeBoundaryVersion ?? null });
      json(response, 202, { id: saved.id });
      return true;
    }

    if (heartbeatRequest) {
      const signed = await readSignedJson(request);
      const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      const machine = await authenticateMachine(request, url, signed.raw, "agent-runtime");
      if ((!machine || machine.machineId !== signed.body.agentId) && !constantTokenMatch(bearer, agentIngestToken)) { json(response, 401, { error: "invalid_agent_credential" }); return true; }
      let body;
      try { body = validateRuntimeHeartbeat(signed.body); }
      catch { json(response, 400, { error: "invalid_agent_heartbeat" }); return true; }
      const [agent, runtime] = await Promise.all([repository.getAgent(body.agentId), repository.getAgentRuntimeByAgent(body.agentId)]);
      if (!agent || !runtime || runtime.id !== body.runtimeId || agent.organizationId !== body.organizationId || agent.ownerUserId !== body.userId) { json(response, 404, { error: "agent_runtime_not_found" }); return true; }
      const components = (Array.isArray(body.components) ? body.components : []).slice(0, 100).map((component) => ({
        layer: component.layer, moduleId: typeof component.moduleId === "string" ? component.moduleId.slice(0, 200) : "", status: component.status,
        version: typeof component.version === "string" ? component.version.slice(0, 200) : null,
        upstreamRef: typeof component.upstreamRef === "string" ? component.upstreamRef.slice(0, 200) : null,
        capabilities: Array.isArray(component.capabilities) ? component.capabilities.filter((item) => typeof item === "string").slice(0, 100) : [],
        metrics: numericMetrics(component.metrics), observedAt: Number.isFinite(Date.parse(component.observedAt)) ? component.observedAt : body.observedAt
      })).filter((component) => CONTROL_LAYERS.has(component.layer) && component.moduleId && COMPONENT_STATUSES.has(component.status));
      const events = (Array.isArray(body.events) ? body.events : []).slice(0, 100).map((event) => ({
        layer: CONTROL_LAYERS.has(event.layer) ? event.layer : null,
        componentId: typeof event.componentId === "string" ? event.componentId.slice(0, 200) : null,
        eventType: typeof event.eventType === "string" ? event.eventType.slice(0, 200) : "",
        severity: TELEMETRY_SEVERITIES.has(event.severity) ? event.severity : "info",
        traceId: typeof event.traceId === "string" ? event.traceId.slice(0, 200) : null,
        metrics: numericMetrics(event.metrics), occurredAt: Number.isFinite(Date.parse(event.occurredAt)) ? event.occurredAt : body.observedAt
      })).filter((event) => event.eventType);
      const usage = body.usage && Number.isFinite(Date.parse(body.usage.bucketStart)) && [60, 300, 3600, 86400].includes(body.usage.bucketSeconds) ? {
        bucketStart: body.usage.bucketStart, bucketSeconds: body.usage.bucketSeconds,
        model: typeof body.usage.model === "string" ? body.usage.model.slice(0, 200) : "unknown",
        inputTokens: Math.max(0, Number(body.usage.inputTokens) || 0), outputTokens: Math.max(0, Number(body.usage.outputTokens) || 0),
        estimatedCostUsd: Math.max(0, Number(body.usage.estimatedCostUsd) || 0), runCount: Math.max(0, Number(body.usage.runCount) || 0),
        failedRunCount: Math.max(0, Number(body.usage.failedRunCount) || 0), latencySumMs: Math.max(0, Number(body.usage.latencySumMs) || 0)
      } : null;
      const saved = await repository.saveAgentHeartbeat({ organizationId: body.organizationId, userId: body.userId, agentId: body.agentId, runtimeId: body.runtimeId, sequence: body.sequence, status: body.status, runtimeVersion: typeof body.runtimeVersion === "string" ? body.runtimeVersion.slice(0, 200) : null, boundaryVersion: typeof body.boundaryVersion === "string" ? body.boundaryVersion.slice(0, 200) : null, configRevisionId: typeof body.configRevisionId === "string" ? body.configRevisionId : null, queueDepth: Math.max(0, Number(body.queueDepth) || 0), activeRuns: Math.max(0, Number(body.activeRuns) || 0), failedRuns: Math.max(0, Number(body.failedRuns) || 0), observedAt: body.observedAt, components, events, usage });
      json(response, 202, { id: saved.id });
      return true;
    }

    if (resourceRequest) {
      const signed = await readSignedJson(request);
      const machine = await authenticateMachine(request, url, signed.raw, "server");
      if (!machine || signed.body.serverId !== machine.machineId) { json(response, 401, { error: "invalid_server_credential" }); return true; }
      let body;
      try { body = validateResourceReport(signed.body); }
      catch { json(response, 400, { error: "invalid_resource_samples" }); return true; }
      const samples = body.samples.map(resourceSample);
      if (samples.some((sample) => !sample)) { json(response, 400, { error: "invalid_resource_sample" }); return true; }
      const server = (await repository.listServers()).find((item) => item.id === machine.machineId);
      if (!server) { json(response, 404, { error: "server_not_found" }); return true; }
      const saved = samples.length ? await repository.saveAgentResourceSamples({ serverId: machine.machineId, samples }) : [];
      await repository.recordServerHeartbeat({ id: machine.machineId, organizationId: server.organizationId, status: "healthy", runtimeVersion: saved[0]?.dockerVersion ?? server.runtimeVersion ?? null });
      json(response, 202, { accepted: saved.length, sampleIds: saved.map((sample) => sample.id) });
      return true;
    }

    const signed = await readSignedJson(request);
    const machine = await authenticateMachine(request, url, signed.raw, "server");
    if (!machine) {
      json(response, 401, { error: "invalid_server_credential" });
      return true;
    }

    if (leaseRequest) {
      let requestEnvelope;
      try { requestEnvelope = validateLeaseRequestEnvelope(signed.body); }
      catch { json(response, 400, controlErrorSurface(signed.body, "unknown_field")); return true; }
      if (requestEnvelope.server_id !== machine.machineId) { json(response, 403, controlErrorSurface(requestEnvelope, "server_mismatch", { field: "/server_id" })); return true; }
      if (!verifyControlMutationSignature(requestEnvelope, { keyHash: machine.credential.keyHash, expectedKeyId: machine.machineId })) {
        json(response, 401, controlErrorSurface(requestEnvelope, "invalid_signature", { field: "/signature" }));
        return true;
      }
      const server = (await repository.listServers()).find((item) => item.id === machine.machineId);
      if (!server || server.organizationId !== requestEnvelope.organization_id) { json(response, 403, controlErrorSurface(requestEnvelope, "owner_mismatch", { field: "/organization_id" })); return true; }
      if (typeof controlAuthority?.leaseCommands !== "function") {
        json(response, 503, controlErrorSurface(requestEnvelope, "verification_failed", { retryable: true, ref: "hint:control-authority-migration-required" }));
        return true;
      }
      let lease;
      try { lease = validateLeaseEnvelope(await controlAuthority.leaseCommands(requestEnvelope)); }
      catch { json(response, 502, controlErrorSurface(requestEnvelope, "verification_failed", { retryable: true, ref: "hint:invalid-authority-lease" })); return true; }
      if (!matchingControlScope(lease, requestEnvelope)) { json(response, 502, controlErrorSurface(requestEnvelope, "owner_mismatch", { ref: "hint:authority-lease-scope" })); return true; }
      if (!verifyControlMutationSignature(lease, { keyHash: machine.credential.keyHash, expectedKeyId: machine.machineId })) {
        json(response, 502, controlErrorSurface(requestEnvelope, "invalid_signature", { field: "/signature", ref: "hint:authority-lease-signature" }));
        return true;
      }
      json(response, 200, lease);
      return true;
    }

    let receipt;
    try { receipt = validateReceiptEnvelope(signed.body); }
    catch { json(response, 400, controlErrorSurface(signed.body, "unknown_field")); return true; }
    if (receipt.server_id !== machine.machineId) { json(response, 403, controlErrorSurface(receipt, "server_mismatch", { field: "/server_id" })); return true; }
    if (receipt.command_id !== receiptMatch[1]) { json(response, 409, controlErrorSurface(receipt, "receipt_conflict", { field: "/command_id" })); return true; }
    if (!verifyControlMutationSignature(receipt, { keyHash: machine.credential.keyHash, expectedKeyId: machine.machineId })) {
      json(response, 401, controlErrorSurface(receipt, "invalid_signature", { field: "/signature" }));
      return true;
    }
    const server = (await repository.listServers()).find((item) => item.id === machine.machineId);
    if (!server || server.organizationId !== receipt.organization_id) { json(response, 403, controlErrorSurface(receipt, "owner_mismatch", { field: "/organization_id" })); return true; }
    if (typeof controlAuthority?.recordReceipt !== "function") {
      json(response, 503, controlErrorSurface(receipt, "verification_failed", { retryable: true, ref: "hint:control-authority-migration-required" }));
      return true;
    }
    try { await controlAuthority.recordReceipt(receipt); }
    catch (error) {
      const errorCode = CONTROL_ERROR_CODES.includes(error?.code) ? error.code : "verification_failed";
      json(response, Number(error?.statusCode) || 409, controlErrorSurface(receipt, errorCode, { retryable: error?.retryable === true, ref: "hint:control-authority-receipt-rejected" }));
      return true;
    }
    json(response, 202, { accepted: true, receipt_id: receipt.receipt_id, state: receipt.state });
    return true;
  };
}
