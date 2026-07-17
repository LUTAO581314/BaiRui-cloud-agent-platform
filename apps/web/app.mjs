import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import {
  CONTROL_APPROVAL_ACTIONS,
  validateCredentialResolution,
  validateResourceReport,
  validateRuntimeHeartbeat
} from "@bairui/contracts";
import {
  PERMISSIONS,
  ROLES,
  AuthorizationError,
  can,
  isRole,
  requirePermission
} from "../../packages/auth/authorization.mjs";
import {
  SESSION_COOKIE,
  parseCookies,
  verifySessionToken
} from "../../packages/auth/session.mjs";
import { loginPage, adminPage } from "./views.mjs";
import {
  constantTokenMatch,
  html,
  json,
  readJson,
  readSignedJson,
  redirect,
  sameOrigin,
  securityHeaders
} from "./http.mjs";
import { issueLicense } from "../../packages/license/license.mjs";
import {
  HERMES_MEMORY_TARGETS,
  MEMORY_KINDS,
  buildHermesMemoryProjection,
  createObsidianNote
} from "../../packages/memory/obsidian-note.mjs";
import { secretHint } from "../../packages/security/secret-envelope.mjs";
import { deriveMachineKey, verifyMachineRequest } from "../../packages/security/machine-request.mjs";
import {
  toBailongmaHotspots,
  toBailongmaMemories
} from "../../packages/bailongma-ui/compatibility.mjs";
import { parseTavernCharacterCard } from "../../packages/character-card/tavern-card.mjs";
import { createAuthRoutes } from "./routes/auth.mjs";
import { createAdminControlRoutes } from "./routes/admin-control.mjs";
import { createInternalChannelRoutes } from "./routes/internal-channels.mjs";
import { createUserRuntimeRoutes } from "./routes/user-runtime.mjs";

const MAX_CHAT_BODY_BYTES = 9 * 1024 * 1024;
const MAX_CHARACTER_CARD_BODY_BYTES = 12 * 1024 * 1024;
const CONTROL_LAYERS = new Set(["core-runtime", "service-integration", "data-storage", "channel-bridge", "ui-exposure"]);
const COMPONENT_STATUSES = new Set(["healthy", "degraded", "unhealthy", "unknown"]);
const TELEMETRY_SEVERITIES = new Set(["debug", "info", "warning", "error", "critical"]);
const RESOURCE_STATUSES = new Set(["running", "degraded", "offline", "unknown"]);
const CONTAINER_RESOURCE_ROLES = new Set(["hermes", "runtime-boundary"]);
const CONTAINER_RESOURCE_STATUSES = new Set(["running", "paused", "restarting", "exited", "dead", "created", "removing", "unknown"]);
const USER_CHANNELS = new Set(["web", "cli", "feishu", "wechat", "qq"]);
const CHANNEL_METADATA_KEYS = new Set(["accountId", "botName", "tenantKey", "webhookPath"]);
const USER_AUTHORIZATION_SERVICES = Object.freeze({
  firecrawl: { name: "Firecrawl", purpose: "网页抓取" },
  searxng: { name: "SearXNG", purpose: "网页搜索" },
  funasr: { name: "FunASR", purpose: "语音识别" },
  mineru: { name: "MinerU", purpose: "文档解析" },
  "model-provider": { name: "个人模型 Provider", purpose: "个人模型调用", policy: "userCustomKeysAllowed" }
});
const USER_AUTHORIZATION_TYPES = new Set(["api_key", "bearer_token"]);
const AUTHORIZATION_METADATA_KEYS = new Set(["provider", "model", "region", "projectId"]);
const USER_INTEGRATION_CAPABILITIES = Object.freeze({
  firecrawl: new Set(["scrape"]),
  searxng: new Set(["search"]),
  trendradar: new Set(["list_hotspots"])
});
const ADMIN_CONTROL_ACTIONS = new Set(["snapshot.collect", "probe.run", "contract.test", "smoke.test", "upstream.check", "config.stage", "config.apply", "backup.create", "backup.verify", "backup.restore", "release.stage", "release.apply", "release.rollback", "service.restart", "credential.revoke"]);
const PLATFORM_CONTROL_ACTIONS = new Set(["upstream.check", "config.stage", "config.apply", "backup.restore", "release.stage", "release.apply", "release.rollback", "service.restart", "credential.revoke"]);
const APPROVAL_CONTROL_ACTIONS = new Set(CONTROL_APPROVAL_ACTIONS);
const IMMUTABLE_IMAGE = /^(?:ghcr\.io|docker\.io)\/[A-Za-z0-9_.\/-]+@sha256:[a-f0-9]{64}$/;
const SKILL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const AGENT_RUN_STATUSES = new Set(["started", "queued", "running", "waiting_for_approval", "stopping", "completed", "failed", "cancelled", "unknown"]);
const TERMINAL_AGENT_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

function numericMetrics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => /^[a-z][a-z0-9_.-]{0,63}$/.test(key) && Number.isFinite(item)).slice(0, 100));
}
const INTEGRATION_CATALOG = Object.freeze([
  { id: "hermes", name: "Hermes Agent", layer: "核心运行层", importType: "submodule", status: "runtime-connected" },
  { id: "openclaw", name: "OpenClaw", layer: "服务集成层", importType: "submodule", status: "registered" },
  { id: "bailongma", name: "BaiLongma", layer: "渠道桥接 / UI", importType: "submodule", status: "ui-adapted" },
  { id: "everos", name: "EverOS", layer: "服务集成层", importType: "submodule", status: "registered" },
  { id: "mineru", name: "MinerU", layer: "服务集成层", importType: "submodule", status: "registered" },
  { id: "funasr", name: "FunASR", layer: "服务集成层", importType: "submodule", status: "registered" },
  { id: "trendradar", name: "TrendRadar", layer: "服务集成层", importType: "submodule", status: "adapter-ready" },
  { id: "mirofish", name: "MiroFish", layer: "服务集成层", importType: "submodule", status: "registered" },
  { id: "searxng", name: "SearXNG", layer: "服务集成层", importType: "registry-only", status: "adapter-needs-service" },
  { id: "sonic", name: "Sonic", layer: "服务集成层", importType: "submodule", status: "registered" },
  { id: "firecrawl", name: "Firecrawl", layer: "服务集成层", importType: "submodule", status: "adapter-needs-key" }
]);

function sessionMessage(body) {
  const text = typeof body.message === "string" ? body.message.trim() : "";
  if (text.length > 20_000) return null;
  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 5) : [];
  const images = [];
  let imageBytes = 0;
  for (const attachment of attachments) {
    const dataUrl = typeof attachment?.data_url === "string" ? attachment.data_url.trim() : "";
    const match = dataUrl.match(/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) return null;
    const estimatedBytes = Math.ceil(match[2].length * 0.75);
    if (estimatedBytes > 2 * 1024 * 1024) return null;
    imageBytes += estimatedBytes;
    if (imageBytes > 8 * 1024 * 1024) return null;
    images.push({ type: "image_url", image_url: { url: dataUrl, detail: "auto" } });
  }
  if (!text && !images.length) return null;
  if (!images.length) return text;
  return [...(text ? [{ type: "text", text }] : []), ...images];
}

function publicProviderConfiguration(configuration) {
  if (!configuration) return { configured: false, provider: "", baseUrl: "", model: "", keyMasked: null, applyStatus: "missing", updatedAt: null };
  return {
    configured: Boolean(configuration.apiKeyEnvelope),
    provider: configuration.provider,
    baseUrl: configuration.baseUrl,
    model: configuration.model,
    keyMasked: configuration.keyHint ? `****${configuration.keyHint}` : null,
    applyStatus: configuration.applyStatus,
    updatedAt: configuration.updatedAt
  };
}

function publicProviderChannel(channel) {
  if (!channel) return null;
  const { apiKeyEnvelope, ...safe } = channel;
  return { ...safe, configured: Boolean(apiKeyEnvelope), keyMasked: channel.keyHint ? `****${channel.keyHint}` : null };
}

function boundedInteger(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null;
}

function optionalResourceNumber(value, maximum = Number.MAX_SAFE_INTEGER, integer = false) {
  if (value === null || value === undefined || value === "") return null;
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
  const rawContainers = Array.isArray(value.containers) ? value.containers.slice(0, 16) : [];
  const containers = rawContainers.map((container) => {
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

function resourceFreshness(resource, staleAfterMs) {
  if (!resource) return null;
  const receivedAt = Date.parse(resource.receivedAt);
  const stale = !Number.isFinite(receivedAt) || Date.now() - receivedAt > staleAfterMs;
  return { ...resource, status: stale ? "offline" : resource.status, stale };
}

function controlOperationArguments(action, body) {
  const id = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : null;
  if (action === "snapshot.collect") return {};
  if (action === "probe.run") {
    const probeIds = Array.isArray(body.probeIds) ? [...new Set(body.probeIds)].filter((item) => ["runtime.health", "hermes.health"].includes(item)) : [];
    return probeIds.length ? { probe_ids: probeIds, test_run_id: randomUUID() } : null;
  }
  if (action === "contract.test") return ["runtime-boundary-v1", "hermes-api-v1"].includes(body.suiteId) ? { suite_id: body.suiteId, test_run_id: randomUUID() } : null;
  if (action === "smoke.test") return body.suiteId === "agent-runtime-v1" ? { suite_id: body.suiteId, test_run_id: randomUUID() } : null;
  if (action === "upstream.check") return ["hermes", "bairui-runtime"].includes(body.upstreamId) ? { upstream_id: body.upstreamId, ...(id(body.candidateId) ? { candidate_id: body.candidateId } : {}) } : null;
  if (["config.stage", "config.apply"].includes(action)) return id(body.configRevisionId) ? { config_revision_id: body.configRevisionId } : null;
  if (action === "backup.create") return id(body.backupPolicyId) ? { backup_policy_id: body.backupPolicyId, backup_id: randomUUID() } : null;
  if (action === "backup.verify") return id(body.backupId) ? { backup_id: body.backupId } : null;
  if (action === "backup.restore") return id(body.backupId) ? { backup_id: body.backupId, restore_id: randomUUID() } : null;
  if (["release.stage", "release.apply"].includes(action)) return id(body.releaseId) ? { release_id: body.releaseId } : null;
  if (action === "release.rollback") return id(body.releaseId) && id(body.rollbackReleaseId) ? { release_id: body.releaseId, rollback_release_id: body.rollbackReleaseId } : null;
  if (action === "service.restart") return ["hermes", "runtime-boundary"].includes(body.serviceId) ? { service_id: body.serviceId } : null;
  if (action === "credential.revoke") return id(body.identityId) ? { identity_id: body.identityId } : null;
  return null;
}

function publicChannelBinding(binding) {
  if (!binding) return null;
  const { credentialEnvelope, ...safe } = binding;
  return { ...safe, ...(binding.channel === "wechat" ? { callbackPath: `/callbacks/wechat/${encodeURIComponent(binding.id)}` } : {}), configured: Boolean(credentialEnvelope), credentialMasked: binding.credentialHint ? `****${binding.credentialHint}` : null };
}

function publicAgentAuthorization(authorization) {
  if (!authorization) return null;
  const { credentialEnvelope, credentialHint, ...safe } = authorization;
  return { ...safe, configured: Boolean(credentialEnvelope), credentialMasked: authorization.credentialHint ? `****${authorization.credentialHint}` : null };
}

function publicMemoryProjectionStatus(job) {
  if (!job) return { status: "idle" };
  return { jobId: job.id, status: job.state, attempts: job.attempts, availableAt: job.availableAt, lastErrorCode: job.lastErrorCode, result: job.resultSummary, updatedAt: job.updatedAt, completedAt: job.completedAt };
}

function authorizationMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => AUTHORIZATION_METADATA_KEYS.has(key) && typeof item === "string" && item.trim()).map(([key, item]) => [key, item.trim().slice(0, 200)]));
}

function authorizationEndpoint(value) {
  if (value === undefined || value === null || value === "") return null;
  if (String(value).length > 2_000) return undefined;
  let endpoint;
  try { endpoint = new URL(String(value)); } catch { return undefined; }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) return undefined;
  return endpoint.toString().replace(/\/$/, "");
}

function publicAuthorizationServices(policy) {
  return Object.entries(USER_AUTHORIZATION_SERVICES).map(([id, item]) => ({ id, ...item, enabled: item.policy !== "userCustomKeysAllowed" || policy?.userCustomKeysAllowed === true }));
}

function channelSecretHint(credentials) {
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) return null;
  const entries = Object.entries(credentials).filter(([, item]) => typeof item === "string" && item.trim());
  const value = (entries.find(([key]) => /(secret|token|key|password)/i.test(key)) ?? entries[0])?.[1];
  return value ? secretHint(value.trim()) : null;
}

function channelMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => CHANNEL_METADATA_KEYS.has(key) && typeof item === "string").map(([key, item]) => [key, item.trim().slice(0, 200)]));
}

function usageSummary(rollups) {
  return rollups.reduce((summary, item) => ({
    inputTokens: summary.inputTokens + item.inputTokens,
    outputTokens: summary.outputTokens + item.outputTokens,
    estimatedCostUsd: summary.estimatedCostUsd + item.estimatedCostUsd,
    runCount: summary.runCount + item.runCount,
    failedRunCount: summary.failedRunCount + item.failedRunCount,
    latencySumMs: summary.latencySumMs + item.latencySumMs
  }), { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, runCount: 0, failedRunCount: 0, latencySumMs: 0 });
}

function discoveryItems(value, keys) {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function discoveryIds(value, keys) {
  return new Set(discoveryItems(value, keys).map((item) => typeof item === "string" ? item : item?.id ?? item?.name ?? item?.model).filter((item) => typeof item === "string" && item));
}

function publicAgentRun(record) {
  if (!record) return null;
  const { inputText, ...value } = record;
  return { ...value, inputPreview: String(inputText ?? "").slice(0, 500) };
}

function publicFleetAgent(agent) {
  if (!agent) return null;
  const { description, settings, soulMarkdown, ...metadata } = agent;
  return metadata;
}

function configurationApplication(application) {
  return application?.command
    ? { state: application.command.state, commandId: application.command.id, configRevisionId: application.revision.id }
    : { state: "pending_initialization", commandId: null, configRevisionId: null };
}

function agentRunError(value) {
  const error = value?.error;
  if (typeof error === "string") return error.slice(0, 1000);
  if (typeof error?.message === "string") return error.message.slice(0, 1000);
  return null;
}

export function createPlatformApp(options) {
  const {
    repository,
    sessionSecret,
    secureCookies = true,
    configuredOrigin,
    allowRegistration = false,
    agentIngestToken,
    runtimeClient,
    providerVault,
    licensePrivateKey,
    logger = console
  } = options;
  if (!repository) throw new TypeError("repository is required");
  if (!sessionSecret || sessionSecret.length < 32) throw new TypeError("sessionSecret must contain at least 32 characters");
  if (!options.bailongmaUi) throw new TypeError("bailongmaUi is required; BaiLongma Brain UI is the only user frontend");
  const runtimeRouteHosts = new Set(["host.docker.internal", "127.0.0.1", "localhost", ...(options.runtimeRouteHosts ?? [])]);
  const runtimeStaleAfterMs = Math.max(30_000, Number(options.runtimeStaleAfterMs) || 120_000);
  const resourceStaleAfterMs = Math.max(30_000, Number(options.resourceStaleAfterMs) || 120_000);
  const readiness = options.readiness ?? (() => repository.readiness?.({ requiredMigration: options.requiredMigration }) ?? Promise.resolve({ ready: false, status: "readiness_unavailable" }));
  async function principalFor(request) {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    const session = verifySessionToken(token, sessionSecret);
    if (!session) return null;
    const user = await repository.getUser(session.userId);
    if (!user || user.status !== "active" || user.organizationId !== session.organizationId) return null;
    return { userId: user.id, organizationId: user.organizationId, role: user.role, email: user.email, displayName: user.displayName };
  }

  function managedOrganizationId(principal, url) {
    const requested = url.searchParams.get("organization_id");
    if (principal.role === ROLES.PLATFORM_ADMIN) return requested || principal.organizationId;
    if (requested && requested !== principal.organizationId) throw new AuthorizationError();
    return principal.organizationId;
  }

  function requireLogin(principal) {
    if (!principal) {
      const error = new Error("Authentication required");
      error.statusCode = 401;
      throw error;
    }
    return principal;
  }

  async function ownedAgent(principal, agentId) {
    const agent = await repository.getAgent(agentId);
    if (!agent || agent.organizationId !== principal.organizationId || agent.ownerUserId !== principal.userId) {
      const error = new Error("agent_not_found");
      error.statusCode = 404;
      throw error;
    }
    return agent;
  }

  async function modelAccess(organizationId) {
    const [policy, legacy, channels] = await Promise.all([repository.getModelPolicy(organizationId), repository.getProviderConfiguration(organizationId), repository.listProviderChannels(organizationId)]);
    const configuredChannels = channels.filter((item) => item.enabled && item.apiKeyEnvelope && !["failed", "disabled"].includes(item.status));
    const fallbackModels = [...new Set([legacy?.apiKeyEnvelope ? legacy.model : null, ...configuredChannels.map((item) => item.model)].filter(Boolean))];
    const allowedModels = policy?.allowedModels?.length ? policy.allowedModels : fallbackModels;
    const defaultModel = policy?.defaultModel && allowedModels.includes(policy.defaultModel) ? policy.defaultModel : legacy?.model && allowedModels.includes(legacy.model) ? legacy.model : allowedModels[0] ?? null;
    return { configured: Boolean(legacy?.apiKeyEnvelope || configuredChannels.length), allowedModels, defaultModel, userCustomKeysAllowed: policy?.userCustomKeysAllowed === true, dailyTokenLimit: policy?.dailyTokenLimit ?? null, monthlyBudgetUsd: policy?.monthlyBudgetUsd ?? null };
  }

  async function agentOperationalView(principal, agent, runtimeInput) {
    const runtime = runtimeInput ?? await repository.getAgentRuntimeByAgent(agent.id);
    const [models, rollups, commands] = await Promise.all([modelAccess(agent.organizationId), repository.listUsageRollups(agent.organizationId, agent.ownerUserId, agent.id), repository.listControlCommands(agent.organizationId)]);
    const now = Date.now();
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1).getTime();
    const dailyTokens = rollups.filter((item) => Date.parse(item.bucketStart) >= dayStart.getTime()).reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0);
    const monthlyCostUsd = rollups.filter((item) => Date.parse(item.bucketStart) >= monthStart).reduce((sum, item) => sum + item.estimatedCostUsd, 0);
    const quotaExhausted = (models.dailyTokenLimit !== null && dailyTokens >= models.dailyTokenLimit) || (models.monthlyBudgetUsd !== null && monthlyCostUsd >= models.monthlyBudgetUsd);
    const runtimeOffline = agent.desiredRuntimeState === "running" && ["ready", "degraded", "starting"].includes(runtime?.status) && (!runtime.lastHeartbeatAt || now - Date.parse(runtime.lastHeartbeatAt) > runtimeStaleAfterMs);
    const activeChange = commands.find((item) => item.agentId === agent.id && ["config.apply", "config.apply-user", "backup.restore", "release.stage", "release.apply", "release.rollback"].includes(item.action) && ["queued", "leased", "accepted", "running"].includes(item.state)) ?? null;
    let code = "ready";
    if (["deleted", "deleting"].includes(agent.status) || ["deleted", "deleting"].includes(runtime?.status)) code = runtime?.status ?? agent.status;
    else if (!runtime || runtime.status === "uninitialized" || agent.initializationStatus === "uninitialized") code = "uninitialized";
    else if (["provisioning", "starting"].includes(runtime.status) || agent.initializationStatus === "provisioning") code = "initializing";
    else if (activeChange) code = "upgrading";
    else if (["failed", "suspended", "stopped"].includes(runtime.status)) code = runtime.status;
    else if (runtimeOffline) code = "offline";
    else if (!models.configured || !models.defaultModel) code = "model_unconfigured";
    else if (quotaExhausted) code = "quota_exhausted";
    else if (runtime.status === "degraded") code = "degraded";
    return { ...agent, runtime: runtime ? { ...runtime, effectiveStatus: runtimeOffline ? "offline" : runtime.status } : null, operational: { code, runtimeOffline, activeChange: activeChange ? { action: activeChange.action, state: activeChange.state } : null, model: models, quota: { exhausted: quotaExhausted, dailyTokens, dailyTokenLimit: models.dailyTokenLimit, monthlyCostUsd, monthlyBudgetUsd: models.monthlyBudgetUsd } } };
  }

  async function requireOperationalAgent(principal, agent) {
    const view = await agentOperationalView(principal, agent);
    if (view.operational.code === "quota_exhausted") throw Object.assign(new Error("quota_exhausted"), { statusCode: 429, expose: true });
    if (view.operational.code === "model_unconfigured") throw Object.assign(new Error("model_not_configured"), { statusCode: 409, expose: true });
    if (view.operational.code === "offline") throw Object.assign(new Error("runtime_offline"), { statusCode: 503, expose: true });
    if (!["ready", "degraded"].includes(view.operational.code)) throw Object.assign(new Error("agent_not_ready"), { statusCode: 409, expose: true });
    return view;
  }

  function memoryNoteDocument(body, current = null) {
    if (body.memoryKind !== undefined && !MEMORY_KINDS.includes(body.memoryKind)) throw Object.assign(new TypeError("Invalid memory kind"), { statusCode: 400, code: "invalid_memory_kind" });
    if (body.hermesTarget !== undefined && !HERMES_MEMORY_TARGETS.includes(body.hermesTarget)) throw Object.assign(new TypeError("Invalid Hermes memory target"), { statusCode: 400, code: "invalid_memory_target" });
    if (body.importance !== undefined && (!Number.isInteger(Number(body.importance)) || Number(body.importance) < 1 || Number(body.importance) > 5)) throw Object.assign(new TypeError("Invalid memory importance"), { statusCode: 400, code: "invalid_memory_importance" });
    return createObsidianNote({
      title: body.title.slice(0, 200),
      body: body.body.slice(0, 200_000),
      tags: Array.isArray(body.tags) ? body.tags : [],
      wikilinks: Array.isArray(body.wikilinks) ? body.wikilinks : [],
      memoryKind: body.memoryKind ?? current?.memoryKind,
      importance: body.importance ?? current?.importance,
      hermesTarget: body.hermesTarget ?? current?.hermesTarget,
      sourceRef: current?.sourceRef ?? "bairui-user",
      createdAt: current?.createdAt
    });
  }

  async function startAgentRun(principal, agent, inputText, model, parentRunId = null) {
    const upstream = await runtimeClient.operation({ principal, agent, operation: "runs.create", input: { body: { input: inputText, model: model || undefined } } });
    if (typeof upstream?.run_id !== "string" || !upstream.run_id) throw Object.assign(new Error("runtime_run_id_missing"), { statusCode: 502, expose: true });
    const status = AGENT_RUN_STATUSES.has(upstream.status) ? upstream.status : "started";
    const record = await repository.createAgentRun({ id: upstream.run_id, organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id, parentRunId, inputText, model, status });
    await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: parentRunId ? "agent.run.retry" : "agent.run.create", targetType: "agent_run", targetId: record.id, metadata: { agentId: agent.id, model: model ?? null, parentRunId } });
    return { ...upstream, record: publicAgentRun(record) };
  }

  async function synchronizeAgentRun(principal, agent, runId) {
    const record = await repository.getAgentRun(principal.organizationId, principal.userId, agent.id, runId);
    if (!record) throw Object.assign(new Error("run_not_found"), { statusCode: 404, expose: true });
    const upstream = await runtimeClient.operation({ principal, agent, operation: "runs.get", input: { run_id: runId } });
    const status = AGENT_RUN_STATUSES.has(upstream?.status) ? upstream.status : "unknown";
    const updated = await repository.updateAgentRun({
      id: runId, organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id,
      status, lastError: agentRunError(upstream), completedAt: TERMINAL_AGENT_RUN_STATUSES.has(status) ? record.completedAt ?? new Date().toISOString() : record.completedAt
    });
    return { ...upstream, record: publicAgentRun(updated) };
  }

  async function authenticateMachine(request, url, rawBody, credentialType) {
    const machineId = request.headers["x-bairui-machine-id"];
    const timestamp = request.headers["x-bairui-timestamp"];
    const nonce = request.headers["x-bairui-nonce"];
    const signature = request.headers["x-bairui-signature"];
    if (typeof machineId !== "string") return null;
    const credential = credentialType === "server"
      ? await repository.getActiveServerCredential(machineId)
      : credentialType === "channel-worker"
        ? await repository.getActiveChannelWorkerCredential(machineId)
        : await repository.getActiveAgentRuntimeCredential(machineId);
    if (!credential || !verifyMachineRequest({ method: request.method, path: url.pathname, timestamp, nonce, body: rawBody, signature, keyHash: credential.keyHash })) return null;
    const timestampMs = Number(timestamp);
    const claimed = await repository.claimMachineNonce({ credentialType, credentialId: credential.id, nonce, timestampMs, expiresAt: new Date(timestampMs + 10 * 60_000).toISOString() });
    return claimed ? { machineId, credential } : null;
  }

  function issueMachineToken() {
    const token = randomBytes(32).toString("base64url");
    return { token, keyHash: deriveMachineKey(token), keyHint: token.slice(-4) };
  }

  function runtimeEndpointRef(value) {
    if (typeof value !== "string" || value.length > 2000) return null;
    let parsed;
    try { parsed = new URL(value); } catch { return null; }
    if (parsed.protocol !== "http:" || !runtimeRouteHosts.has(parsed.hostname) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || !parsed.port) return null;
    return parsed.toString().replace(/\/$/, "");
  }

  function revealLease(command) {
    if (command.action === "config.apply-user") return { ...command, config: command.config ? { document: command.config.document } : null };
    if (!command.config?.secret_envelope) return { ...command, config: command.config ? { document: command.config.document } : null };
    if (!providerVault) throw Object.assign(new Error("Secret storage is unavailable"), { statusCode: 503, code: "secret_storage_unavailable" });
    const envelope = command.config.secret_envelope;
    return {
      ...command,
      config: {
        document: command.config.document,
        secrets: {
          provider_api_key: providerVault.open(envelope.providerApiKey),
          hermes_api_server_key: providerVault.open(envelope.hermesApiServerKey),
          runtime_shared_secret: providerVault.open(envelope.runtimeSharedSecret),
          agent_control_token: providerVault.open(envelope.agentControlToken)
        }
      }
    };
  }

  async function pipeRuntimeStream(response, upstream) {
    response.writeHead(200, {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff"
    });
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!response.write(Buffer.from(value))) await new Promise((resolve) => response.once("drain", resolve));
      }
    } finally {
      reader.releaseLock();
      response.end();
    }
  }

  const routeAuth = createAuthRoutes({
    repository,
    sessionSecret,
    secureCookies,
    allowRegistration,
    requireLogin
  });
  const routeUserRuntime = createUserRuntimeRoutes({
    repository,
    runtimeClient,
    requireLogin,
    ownedAgent,
    requireOperationalAgent,
    modelAccess,
    startAgentRun,
    synchronizeAgentRun,
    pipeRuntimeStream,
    maxChatBodyBytes: MAX_CHAT_BODY_BYTES,
    sessionMessage,
    publicAgentRun,
    terminalAgentRunStatuses: TERMINAL_AGENT_RUN_STATUSES
  });
  const routeAdminControl = createAdminControlRoutes({
    repository,
    requireLogin,
    managedOrganizationId,
    adminControlActions: ADMIN_CONTROL_ACTIONS,
    platformControlActions: PLATFORM_CONTROL_ACTIONS,
    approvalControlActions: APPROVAL_CONTROL_ACTIONS,
    controlOperationArguments,
    immutableImage: IMMUTABLE_IMAGE
  });
  const routeInternalChannels = createInternalChannelRoutes({ repository, providerVault, authenticateMachine });

  return async function handle(request, response) {
    securityHeaders(response);
    const url = new URL(request.url, "http://platform.internal");
    const method = request.method ?? "GET";
    try {
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && !sameOrigin(request, configuredOrigin)) {
        return json(response, 403, { error: "origin_rejected" });
      }

      if (method === "GET" && url.pathname === "/health") return json(response, 200, { status: "ok" });
      if (method === "GET" && url.pathname === "/ready") {
        const report = await readiness();
        return json(response, report.ready ? 200 : 503, report);
      }
      if (method === "GET" && url.pathname === "/assets/styles.css") {
        response.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=300" });
        return response.end(options.styles);
      }
      if (method === "GET" && url.pathname === "/assets/bairui-agent-logo.png") {
        if (!options.logo) return json(response, 404, { error: "not_found" });
        response.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
        return response.end(options.logo);
      }
      if (method === "GET" && url.pathname === "/assets/bairui-agent-icon.png") {
        if (!options.icon) return json(response, 404, { error: "not_found" });
        response.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
        return response.end(options.icon);
      }
      if (method === "GET" && url.pathname === "/assets/login.js") {
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" });
        return response.end(options.loginScript);
      }
      if (method === "GET" && url.pathname === "/assets/bairui-bailongma.css") {
        if (!options.bailongmaOverlayCss) return json(response, 404, { error: "not_found" });
        response.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=300" });
        return response.end(options.bailongmaOverlayCss);
      }
      if (method === "GET" && url.pathname === "/assets/bairui-bailongma.js") {
        if (!options.bailongmaOverlayScript) return json(response, 404, { error: "not_found" });
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" });
        return response.end(options.bailongmaOverlayScript);
      }
      if (method === "GET" && url.pathname === "/assets/bairui-workspace.js") {
        if (!options.bairuiWorkspaceScript) return json(response, 404, { error: "not_found" });
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" });
        return response.end(options.bairuiWorkspaceScript);
      }

      if (await routeInternalChannels({ method, url, request, response })) return;

      const principal = await principalFor(request);
      if (method === "GET" && url.pathname === "/bailongma-ui/src/ui/scene-shell/bootstrap.js") {
        if (!principal || !options.bailongmaSceneBootstrap) return json(response, 404, { error: "not_found" });
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "private, no-store" });
        return response.end(options.bailongmaSceneBootstrap);
      }
      if (method === "GET" && options.bailongmaUi && (url.pathname.startsWith("/bailongma-ui/") || url.pathname.startsWith("/src/ui/"))) {
        if (!principal) return json(response, 401, { error: "authentication_required" });
        const assetPath = url.pathname.startsWith("/src/ui/") ? `/bailongma-ui${url.pathname}` : url.pathname;
        const asset = options.bailongmaUi.readAsset(assetPath);
        if (!asset) return json(response, 404, { error: "not_found" });
        response.writeHead(200, { "content-type": asset.contentType, "cache-control": "private, max-age=300", "x-bailongma-version": options.bailongmaUi.version });
        return response.end(asset.body);
      }
      if (method === "GET" && url.pathname === "/admin/assets/admin.js") {
        if (!principal || ![ROLES.ORG_ADMIN, ROLES.PLATFORM_ADMIN].includes(principal.role)) return json(response, 404, { error: "not_found" });
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "private, no-store" });
        return response.end(options.adminScript);
      }
      if (method === "GET" && url.pathname === "/") return redirect(response, principal ? "/app" : "/login");
      if (method === "GET" && url.pathname === "/login") return html(response, 200, loginPage());
      if (method === "GET" && url.pathname === "/app") {
        if (!principal) return redirect(response, "/login");
        return html(response, 200, options.bailongmaUi.render());
      }
      if (method === "GET" && url.pathname === "/admin") {
        if (!principal) return redirect(response, "/login?next=/admin");
        if (![ROLES.ORG_ADMIN, ROLES.PLATFORM_ADMIN].includes(principal.role)) return html(response, 404, "<!doctype html><title>Not found</title><h1>Not found</h1>");
        return html(response, 200, adminPage(principal));
      }

      if (await routeAuth({ method, url, request, response, principal })) return;
      if (method === "GET" && url.pathname === "/api/user/bootstrap") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_READ, { organizationId: principal.organizationId, userId: principal.userId });
        const [models, policy] = await Promise.all([modelAccess(principal.organizationId), repository.getModelPolicy(principal.organizationId)]);
        return json(response, 200, { models, channels: [...USER_CHANNELS], authorizationServices: publicAuthorizationServices(policy), memoryFormat: "obsidian-markdown" });
      }

      if (method === "GET" && url.pathname === "/api/user/agents") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_READ, { organizationId: principal.organizationId, userId: principal.userId });
        const [agents, runtimes] = await Promise.all([
          repository.listAgents(principal.organizationId, principal.userId),
          repository.listAgentRuntimes(principal.organizationId, principal.userId)
        ]);
        const runtimeByAgent = new Map(runtimes.map((runtime) => [runtime.agentId, runtime]));
        return json(response, 200, { agents: await Promise.all(agents.map((agent) => agentOperationalView(principal, agent, runtimeByAgent.get(agent.id) ?? null))) });
      }
      if (method === "POST" && url.pathname === "/api/user/agents") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_CREATE, { organizationId: principal.organizationId, userId: principal.userId });
        const body = await readJson(request);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name || name.length > 64) return json(response, 400, { error: "invalid_agent_name" });
        const models = await modelAccess(principal.organizationId);
        const preferredModel = typeof body.preferredModel === "string" ? body.preferredModel.trim() : "";
        if (preferredModel && !models.allowedModels.includes(preferredModel)) return json(response, 400, { error: "model_not_allowed" });
        const agent = await repository.createAgent({
          organizationId: principal.organizationId,
          ownerUserId: principal.userId,
          name,
          description: typeof body.description === "string" ? body.description.trim().slice(0, 500) : "",
          avatarUrl: typeof body.avatarUrl === "string" ? body.avatarUrl.trim().slice(0, 2000) : null,
          soulMarkdown: typeof body.soulMarkdown === "string" ? body.soulMarkdown.slice(0, 50_000) : "",
          settings: { preferredModel: preferredModel || models.defaultModel || null, locale: "zh-CN", notifications: true }
        });
        const runtime = await repository.createAgentRuntime({
          organizationId: principal.organizationId,
          ownerUserId: principal.userId,
          agentId: agent.id,
          workspaceRef: `hermes:${principal.organizationId}:${principal.userId}:${agent.id}`
        });
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "agent.create", targetType: "agent", targetId: agent.id });
        return json(response, 201, { agent: await agentOperationalView(principal, agent, runtime) });
      }
      const userAgentMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)$/);
      if (userAgentMatch && method === "GET") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_READ, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = await repository.getAgent(userAgentMatch[1]);
        if (!agent || agent.organizationId !== principal.organizationId || agent.ownerUserId !== principal.userId) return json(response, 404, { error: "agent_not_found" });
        return json(response, 200, { agent: await agentOperationalView(principal, agent) });
      }
      if (userAgentMatch && method === "PATCH") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_MANAGE_OWN, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = await repository.getAgent(userAgentMatch[1]);
        if (!agent || agent.organizationId !== principal.organizationId || agent.ownerUserId !== principal.userId) return json(response, 404, { error: "agent_not_found" });
        const body = await readJson(request);
        const patch = {};
        if (body.name !== undefined) {
          if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 64) return json(response, 400, { error: "invalid_agent_name" });
          patch.name = body.name.trim();
        }
        if (body.description !== undefined) patch.description = String(body.description).trim().slice(0, 500);
        if (body.avatarUrl !== undefined) patch.avatarUrl = body.avatarUrl ? String(body.avatarUrl).trim().slice(0, 2000) : null;
        if (body.soulMarkdown !== undefined) patch.soulMarkdown = String(body.soulMarkdown).slice(0, 50_000);
        if (body.settings !== undefined) {
          if (!body.settings || typeof body.settings !== "object" || Array.isArray(body.settings)) return json(response, 400, { error: "invalid_agent_settings" });
          const settings = { ...(agent.settings ?? {}) };
          if (body.settings.preferredModel !== undefined) {
            if (!runtimeClient) return json(response, 503, { error: "runtime_unavailable" });
            const preferredModel = String(body.settings.preferredModel ?? "").trim();
            if (preferredModel) {
              const policy = await modelAccess(principal.organizationId);
              if (!policy.allowedModels.includes(preferredModel)) return json(response, 400, { error: "model_not_allowed" });
              const discovered = await runtimeClient.operation({ principal, agent, operation: "discovery.models" });
              if (!discoveryIds(discovered, ["models"]).has(preferredModel)) return json(response, 400, { error: "model_not_allowed" });
            }
            settings.preferredModel = preferredModel || null;
          }
          if (body.settings.notifications !== undefined) settings.notifications = Boolean(body.settings.notifications);
          if (body.settings.locale !== undefined) settings.locale = String(body.settings.locale).slice(0, 20);
          patch.settings = settings;
        }
        const updated = await repository.updateAgent(agent.id, patch);
        const identityChanged = Object.hasOwn(patch, "name") || Object.hasOwn(patch, "soulMarkdown");
        const application = identityChanged ? configurationApplication(await repository.requestAgentIdentityConfiguration({ organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id, requestedBy: principal.userId })) : null;
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "agent.profile.update", targetType: "agent", targetId: agent.id, metadata: { fields: Object.keys(patch), ...(application ? { application } : {}) } });
        return json(response, 200, { agent: updated, application });
      }
      const characterCardMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/character-card$/);
      if (characterCardMatch && method === "POST") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_MANAGE_OWN, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = await ownedAgent(principal, characterCardMatch[1]);
        const body = await readJson(request, MAX_CHARACTER_CARD_BODY_BYTES);
        let imported;
        try { imported = parseTavernCharacterCard(body.card); }
        catch (error) { return json(response, error.code === "character_card_too_large" ? 413 : 400, { error: error.code ?? "invalid_character_card" }); }
        const cardView = { name: imported.card.name, spec: imported.card.spec, specVersion: imported.card.specVersion, loreNotes: imported.loreNotes.length, soulChars: imported.agent.soulMarkdown.length, digest: imported.digest };
        if (body.previewOnly === true) return json(response, 200, { card: cardView, mapping: { soul: ["description", "personality", "scenario", "system_prompt", "post_history_instructions"], obsidianOnly: ["first_mes", "alternate_greetings", "mes_example", "creator_notes", "character_book"], executableExtensions: "ignored" } });
        if (body.confirmUntrustedPrompts !== true) return json(response, 400, { error: "character_card_confirmation_required" });
        const settings = { ...(agent.settings ?? {}), characterCard: imported.provenance };
        const updated = await repository.updateAgent(agent.id, { ...imported.agent, settings });
        const noteInputs = [imported.sourceNote, ...imported.loreNotes];
        const notes = [];
        for (const noteInput of noteInputs) {
          const note = createObsidianNote({ ...noteInput, memoryKind: "knowledge" });
          notes.push(await repository.createObsidianNote({ ...note, organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id }));
        }
        const application = configurationApplication(await repository.requestAgentIdentityConfiguration({ organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id, requestedBy: principal.userId }));
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "agent.character-card.import", targetType: "agent", targetId: agent.id, metadata: { digest: imported.digest, spec: imported.card.spec, loreNotes: imported.loreNotes.length, application } });
        return json(response, 202, { agent: updated, card: cardView, notes: { stored: notes.length, hermesActive: 0 }, memorySync: publicMemoryProjectionStatus(await repository.getMemoryProjectionStatus(principal.organizationId, principal.userId, agent.id)), application });
      }
      const initializeAgentMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/initialize$/);
      if (initializeAgentMatch && method === "POST") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_MANAGE_OWN, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = await ownedAgent(principal, initializeAgentMatch[1]);
        const provider = await repository.getProviderConfiguration(principal.organizationId);
        if (!provider?.apiKeyEnvelope || !provider.provider || !provider.model) return json(response, 409, { error: "model_provider_not_configured" });
        if (!providerVault) return json(response, 503, { error: "secret_storage_unavailable" });
        const runtimeSecret = randomBytes(32).toString("base64url");
        const hermesSecret = randomBytes(32).toString("base64url");
        const agentCredential = issueMachineToken();
        const result = await repository.requestAgentProvisioning({
          agentId: agent.id,
          requestedBy: principal.userId,
          provider,
          skills: await repository.listAgentSkillPreferences(principal.organizationId, principal.userId, agent.id),
          agentCredentialHash: agentCredential.keyHash,
          agentCredentialHint: agentCredential.keyHint,
          secretEnvelope: {
            providerApiKey: provider.apiKeyEnvelope,
            runtimeSharedSecret: providerVault.seal(runtimeSecret),
            hermesApiServerKey: providerVault.seal(hermesSecret),
            agentControlToken: providerVault.seal(agentCredential.token)
          }
        });
        if (!result) return json(response, 404, { error: "agent_runtime_not_found" });
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "agent.initialization.request", targetType: "agent", targetId: agent.id, metadata: { deploymentId: result.deployment?.id, commandId: result.command?.id } });
        return json(response, 202, result);
      }

      const lifecycleMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/lifecycle$/);
      if (lifecycleMatch && method === "POST") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_MANAGE_OWN, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = await ownedAgent(principal, lifecycleMatch[1]);
        const body = await readJson(request);
        if (!["pause", "resume", "delete"].includes(body.action)) return json(response, 400, { error: "invalid_lifecycle_action" });
        if (body.action === "delete" && body.confirmName !== agent.name) return json(response, 400, { error: "agent_delete_confirmation_required" });
        const result = await repository.requestAgentLifecycle({ agentId: agent.id, request: body.action, requestedBy: principal.userId, reason: body.action === "delete" ? "Agent owner confirmed deletion in the user workspace" : undefined });
        if (!result) return json(response, 404, { error: "agent_runtime_not_found" });
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: `agent.lifecycle.${body.action}`, targetType: "agent", targetId: agent.id, metadata: { commandId: result.command?.id ?? null, commandState: result.state, immediate: result.command === null } });
        return json(response, result.command ? 202 : 200, result);
      }

      if (await routeUserRuntime({ method, url, request, response, principal })) return;

      const memoryNotesMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/memory-notes$/);
      if (memoryNotesMatch && ["GET", "POST"].includes(method)) {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = await ownedAgent(principal, memoryNotesMatch[1]);
        if (method === "GET") {
          const [notes, syncJob] = await Promise.all([
            repository.listObsidianNotes(principal.organizationId, principal.userId, agent.id, url.searchParams.get("query") ?? ""),
            repository.getMemoryProjectionStatus(principal.organizationId, principal.userId, agent.id)
          ]);
          const projection = buildHermesMemoryProjection(notes);
          return json(response, 200, { notes, format: "obsidian-markdown", memoryKinds: MEMORY_KINDS, hermesTargets: HERMES_MEMORY_TARGETS, sync: publicMemoryProjectionStatus(syncJob), projection: { memory: { charCount: projection.memory.char_count, limit: projection.memory.limit, notes: projection.memory.entries.length }, user: { charCount: projection.user.char_count, limit: projection.user.limit, notes: projection.user.entries.length }, excluded: projection.excluded_note_ids.length } });
        }
        const body = await readJson(request);
        if (typeof body.title !== "string" || !body.title.trim() || typeof body.body !== "string" || !body.body.trim()) return json(response, 400, { error: "invalid_note" });
        const note = memoryNoteDocument(body);
        const saved = await repository.createObsidianNote({ ...note, organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id });
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "memory.note.upsert", targetType: "obsidian_note", targetId: saved.id, metadata: { agentId: agent.id } });
        return json(response, 201, { note: saved, sync: publicMemoryProjectionStatus(await repository.getMemoryProjectionStatus(principal.organizationId, principal.userId, agent.id)) });
      }

      const memorySyncMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/memory-sync$/);
      if (memorySyncMatch && method === "POST") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = await ownedAgent(principal, memorySyncMatch[1]);
        const job = await repository.enqueueMemoryProjection({ organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id, reason: "manual" });
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "memory.projection.request", targetType: "agent", targetId: agent.id, metadata: { jobId: job.id } });
        return json(response, 202, { sync: publicMemoryProjectionStatus(job) });
      }

      const memoryNoteMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/memory-notes\/([^/]+)$/);
      if (memoryNoteMatch && ["GET", "PATCH", "DELETE"].includes(method)) {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = await ownedAgent(principal, memoryNoteMatch[1]);
        const noteId = memoryNoteMatch[2];
        const current = await repository.getObsidianNote(principal.organizationId, principal.userId, agent.id, noteId);
        if (!current) return json(response, 404, { error: "memory_note_not_found" });
        if (method === "GET") return json(response, 200, { note: current, format: "obsidian-markdown" });
        if (method === "DELETE") {
          await repository.deleteObsidianNote(principal.organizationId, principal.userId, agent.id, noteId);
          await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "memory.note.delete", targetType: "obsidian_note", targetId: noteId, metadata: { agentId: agent.id } });
          return json(response, 200, { deleted: true, sync: publicMemoryProjectionStatus(await repository.getMemoryProjectionStatus(principal.organizationId, principal.userId, agent.id)) });
        }
        const body = await readJson(request);
        if (typeof body.title !== "string" || !body.title.trim() || typeof body.body !== "string" || !body.body.trim()) return json(response, 400, { error: "invalid_note" });
        const note = memoryNoteDocument(body, current);
        let saved;
        try { saved = await repository.updateObsidianNote({ ...note, id: noteId, organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id }); }
        catch (error) { if (error.code === "23505") return json(response, 409, { error: "memory_note_slug_conflict" }); throw error; }
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "memory.note.update", targetType: "obsidian_note", targetId: noteId, metadata: { agentId: agent.id } });
        return json(response, 200, { note: saved, sync: publicMemoryProjectionStatus(await repository.getMemoryProjectionStatus(principal.organizationId, principal.userId, agent.id)) });
      }

      const skillsMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/skills(?:\/([^/]+))?$/);
      if (skillsMatch && ["GET", "PATCH"].includes(method)) {
        requirePermission(requireLogin(principal), method === "GET" ? PERMISSIONS.AGENT_READ : PERMISSIONS.AGENT_MANAGE_OWN, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = await ownedAgent(principal, skillsMatch[1]);
        const preferences = await repository.listAgentSkillPreferences(principal.organizationId, principal.userId, agent.id);
        if (method === "GET") {
          let discovery = { status: "unavailable", error: "runtime_unavailable" };
          if (runtimeClient) {
            try { discovery = { status: "available", data: await runtimeClient.operation({ principal, agent, operation: "discovery.skills" }) }; }
            catch (error) { discovery = { status: "unavailable", error: error.code ?? "runtime_unavailable" }; }
          }
          return json(response, 200, { discovery, preferences });
        }
        if (!skillsMatch[2]) return json(response, 405, { error: "skill_id_required" });
        const body = await readJson(request);
        if (typeof body.enabled !== "boolean") return json(response, 400, { error: "invalid_skill_preference" });
        const skillId = decodeURIComponent(skillsMatch[2]).slice(0, 200);
        if (!SKILL_ID.test(skillId)) return json(response, 400, { error: "invalid_skill_id" });
        const preference = await repository.upsertAgentSkillPreference({ organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id, skillId, enabled: body.enabled, applyStatus: "pending" });
        const application = await repository.requestAgentSkillConfiguration({ organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id, requestedBy: principal.userId });
        const applicationView = configurationApplication(application);
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "agent.skill.preference.update", targetType: "agent", targetId: agent.id, metadata: { skillId, enabled: body.enabled, applyStatus: "pending", application: applicationView } });
        return json(response, 202, { preference, application: applicationView });
      }

      const channelsMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/channels(?:\/([^/]+))?$/);
      if (channelsMatch && ["GET", "PUT", "DELETE"].includes(method)) {
        requirePermission(requireLogin(principal), method === "GET" ? PERMISSIONS.AGENT_READ : PERMISSIONS.AGENT_MANAGE_OWN, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = await ownedAgent(principal, channelsMatch[1]);
        if (method === "GET") {
          const bindings = await repository.listAgentChannelBindings(principal.organizationId, principal.userId, agent.id);
          return json(response, 200, { channels: [...USER_CHANNELS].map((channel) => ({ channel, binding: publicChannelBinding(bindings.find((item) => item.channel === channel) ?? null) })) });
        }
        const channel = channelsMatch[2] ? decodeURIComponent(channelsMatch[2]) : "";
        if (!USER_CHANNELS.has(channel)) return json(response, 404, { error: "channel_not_supported" });
        if (method === "DELETE") {
          const deleted = await repository.deleteAgentChannelBinding(principal.organizationId, principal.userId, agent.id, channel);
          await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "agent.channel.unbind", targetType: "agent", targetId: agent.id, metadata: { channel, deleted } });
          return json(response, 200, { channel, status: "unconfigured" });
        }
        const body = await readJson(request);
        const credentials = body.credentials && typeof body.credentials === "object" && !Array.isArray(body.credentials) ? body.credentials : null;
        if (credentials && !providerVault) return json(response, 503, { error: "channel_secret_storage_unavailable" });
        const credentialText = credentials ? JSON.stringify(credentials) : "";
        if (credentialText.length > 64_000) return json(response, 413, { error: "channel_credentials_too_large" });
        const binding = await repository.upsertAgentChannelBinding({
          organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id, channel,
          displayName: typeof body.displayName === "string" && body.displayName.trim() ? body.displayName.trim().slice(0, 100) : channel,
          status: channel === "web" ? "connected" : "pending",
          credentialEnvelope: credentialText ? providerVault.seal(credentialText) : null,
          credentialHint: channelSecretHint(credentials),
          metadata: { ...channelMetadata(body.metadata), ...(typeof credentials?.appId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(credentials.appId) ? { accountId: credentials.appId } : {}) }
        });
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "agent.channel.bind", targetType: "agent", targetId: agent.id, metadata: { channel, status: binding.status, credentialChanged: Boolean(credentialText) } });
        return json(response, channel === "web" ? 200 : 202, { binding: publicChannelBinding(binding) });
      }

      const authorizationsMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/authorizations(?:\/([^/]+))?$/);
      if (authorizationsMatch && ["GET", "POST", "DELETE"].includes(method)) {
        requirePermission(requireLogin(principal), method === "GET" ? PERMISSIONS.AGENT_READ : PERMISSIONS.AGENT_MANAGE_OWN, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = await ownedAgent(principal, authorizationsMatch[1]);
        if (method === "GET") {
          const [authorizations, policy] = await Promise.all([
            repository.listAgentAuthorizations(principal.organizationId, principal.userId, agent.id),
            repository.getModelPolicy(principal.organizationId)
          ]);
          const services = publicAuthorizationServices(policy);
          return json(response, 200, { services, authorizations: authorizations.map(publicAgentAuthorization) });
        }
        const authorizationId = authorizationsMatch[2] ? decodeURIComponent(authorizationsMatch[2]) : null;
        if (method === "DELETE") {
          if (!authorizationId) return json(response, 404, { error: "authorization_not_found" });
          const authorization = await repository.revokeAgentAuthorization(principal.organizationId, principal.userId, agent.id, authorizationId);
          if (!authorization) return json(response, 404, { error: "authorization_not_found" });
          await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "agent.authorization.revoke", targetType: "agent_authorization", targetId: authorization.id, metadata: { agentId: agent.id, service: authorization.service, label: authorization.label } });
          return json(response, 200, { authorization: publicAgentAuthorization(authorization) });
        }
        if (authorizationId) return json(response, 405, { error: "method_not_allowed" });
        if (!providerVault) return json(response, 503, { error: "authorization_secret_storage_unavailable" });
        const body = await readJson(request);
        const service = typeof body.service === "string" ? body.service.trim() : "";
        const serviceDefinition = Object.hasOwn(USER_AUTHORIZATION_SERVICES, service) ? USER_AUTHORIZATION_SERVICES[service] : null;
        if (!serviceDefinition) return json(response, 400, { error: "authorization_service_not_supported" });
        if (serviceDefinition.policy === "userCustomKeysAllowed" && (await repository.getModelPolicy(principal.organizationId))?.userCustomKeysAllowed !== true) return json(response, 403, { error: "user_custom_keys_disabled" });
        const label = typeof body.label === "string" ? body.label.trim().slice(0, 100) : "";
        const authType = typeof body.authType === "string" ? body.authType : "api_key";
        const secret = typeof body.secret === "string" ? body.secret.trim() : "";
        const endpointUrl = authorizationEndpoint(body.endpointUrl);
        if (!label || !USER_AUTHORIZATION_TYPES.has(authType) || !secret || secret.length > 64_000 || endpointUrl === undefined) return json(response, 400, { error: "invalid_agent_authorization" });
        const authorization = await repository.upsertAgentAuthorization({
          organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id,
          service, label, authType, endpointUrl, metadata: authorizationMetadata(body.metadata),
          credentialEnvelope: providerVault.seal(JSON.stringify({ secret })), credentialHint: secretHint(secret)
        });
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "agent.authorization.store", targetType: "agent_authorization", targetId: authorization.id, metadata: { agentId: agent.id, service, label, authType, endpointHost: endpointUrl ? new URL(endpointUrl).host : null } });
        return json(response, 201, { authorization: publicAgentAuthorization(authorization) });
      }

      const agentHotspotsMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/hotspots$/);
      if (agentHotspotsMatch && method === "GET") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = await ownedAgent(principal, agentHotspotsMatch[1]);
        const [latest, bookmarkIds] = await Promise.all([repository.listLatestHotspots(principal.organizationId), repository.listAgentHotspotBookmarkIds(principal.organizationId, principal.userId, agent.id)]);
        const bookmarks = new Set(bookmarkIds);
        return json(response, 200, { ...latest, items: latest.items.map((item) => ({ ...item, bookmarked: bookmarks.has(item.id) })) });
      }

      const userIntegrationMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/integrations\/([^/]+)\/([^/]+)$/);
      if (userIntegrationMatch && method === "POST") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId, userId: principal.userId });
        if (!runtimeClient) return json(response, 503, { error: "runtime_unavailable" });
        const agent = await ownedAgent(principal, userIntegrationMatch[1]);
        const integrationId = decodeURIComponent(userIntegrationMatch[2]);
        const capability = decodeURIComponent(userIntegrationMatch[3]);
        const supported = Object.hasOwn(USER_INTEGRATION_CAPABILITIES, integrationId) && USER_INTEGRATION_CAPABILITIES[integrationId].has(capability);
        if (!supported) return json(response, 404, { error: "integration_capability_not_supported" });
        const body = await readJson(request);
        const authorizationId = typeof body.authorizationId === "string" && body.authorizationId ? body.authorizationId : undefined;
        if (authorizationId) {
          const authorization = await repository.getAgentAuthorization(principal.organizationId, principal.userId, agent.id, authorizationId);
          if (!authorization || !["stored", "applied"].includes(authorization.status) || !authorization.credentialEnvelope) return json(response, 404, { error: "authorization_not_available" });
          if (authorization.service !== integrationId) return json(response, 400, { error: "authorization_service_mismatch" });
        }
        const input = body.input && typeof body.input === "object" && !Array.isArray(body.input) ? body.input : {};
        const result = await runtimeClient.invokeIntegration({ principal, agent, integrationId, capability, input, authorizationId });
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "agent.integration.invoke", targetType: "agent", targetId: agent.id, metadata: { integrationId, capability, authorizationId: authorizationId ?? null, status: result.status ?? "unknown" } });
        return json(response, 200, result);
      }

      const hotspotBookmarkMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/hotspots\/([^/]+)\/bookmark$/);
      if (hotspotBookmarkMatch && method === "PUT") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = await ownedAgent(principal, hotspotBookmarkMatch[1]);
        const body = await readJson(request);
        if (typeof body.bookmarked !== "boolean") return json(response, 400, { error: "invalid_bookmark_state" });
        const latest = await repository.listLatestHotspots(principal.organizationId);
        const hotspotItemId = hotspotBookmarkMatch[2];
        if (!latest.items.some((item) => item.id === hotspotItemId)) return json(response, 404, { error: "hotspot_not_found" });
        const bookmarked = await repository.setAgentHotspotBookmark({ organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id, hotspotItemId, bookmarked: body.bookmarked });
        return json(response, 200, { hotspotItemId, bookmarked });
      }

      const usageMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/usage$/);
      if (usageMatch && method === "GET") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_READ, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = await ownedAgent(principal, usageMatch[1]);
        const rollups = await repository.listUsageRollups(principal.organizationId, principal.userId, agent.id, url.searchParams.get("limit") ?? 1000);
        return json(response, 200, { agentId: agent.id, summary: usageSummary(rollups), rollups });
      }

      if (method === "GET" && url.pathname === "/agent-profile") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId });
        return json(response, 200, { name: "bairui-agent", runtime: "Hermes", ui: "BaiLongma Brain UI", uiVersion: options.bailongmaUi?.version ?? "unavailable" });
      }
      if (method === "GET" && url.pathname === "/memories") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId, userId: principal.userId });
        const agents = await repository.listAgents(principal.organizationId, principal.userId);
        const requested = url.searchParams.get("agent_id");
        const agent = agents.find((item) => item.id === requested) ?? agents[0];
        const notes = agent ? await repository.listObsidianNotes(principal.organizationId, principal.userId, agent.id) : [];
        return json(response, 200, toBailongmaMemories(notes, agent).slice(0, Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 120, 200))));
      }
      if (method === "GET" && url.pathname === "/hotspots") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId });
        return json(response, 200, toBailongmaHotspots(await repository.listLatestHotspots(principal.organizationId)));
      }
      if (method === "GET" && url.pathname === "/audit/stats") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId });
        return json(response, 200, { recall: { count: 0, avg: 0 }, extract: { count: 0, avg: 0 } });
      }
      if (method === "POST" && ["/hotspot-state", "/worldcup-state", "/doc-panel-state", "/person-card-state"].includes(url.pathname)) {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId });
        await readJson(request);
        return json(response, 200, { ok: true });
      }
      if (method === "GET" && url.pathname === "/api/user/hotspots") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId });
        return json(response, 200, await repository.listLatestHotspots(principal.organizationId), { deprecation: "true" });
      }
      if (["GET", "POST"].includes(method) && url.pathname === "/api/user/memory-notes") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = (await repository.listAgents(principal.organizationId, principal.userId))[0];
        if (!agent) return json(response, 409, { error: "agent_required" });
        if (method === "GET") return json(response, 200, { notes: await repository.listObsidianNotes(principal.organizationId, principal.userId, agent.id), format: "obsidian-markdown" }, { deprecation: "true" });
        const body = await readJson(request);
        if (typeof body.title !== "string" || !body.title.trim() || typeof body.body !== "string" || !body.body.trim()) return json(response, 400, { error: "invalid_note" });
        const note = createObsidianNote({ title: body.title.slice(0, 200), body: body.body.slice(0, 200_000), tags: Array.isArray(body.tags) ? body.tags : [], wikilinks: Array.isArray(body.wikilinks) ? body.wikilinks : [] });
        const saved = await repository.createObsidianNote({ ...note, organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id });
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "memory.note.upsert", targetType: "obsidian_note", targetId: saved.id, metadata: { agentId: agent.id, compatibilityRoute: true } });
        return json(response, 201, { note: saved }, { deprecation: "true" });
      }
      if (method === "GET" && url.pathname === "/api/admin/overview") {
        requireLogin(principal);
        const permitted = can(principal, PERMISSIONS.PLATFORM_OVERVIEW_READ) || can(principal, PERMISSIONS.ORG_AUDIT_READ, { organizationId: principal.organizationId });
        if (!permitted) throw new AuthorizationError();
        const scope = principal.role === ROLES.PLATFORM_ADMIN && !url.searchParams.get("organization_id") ? undefined : managedOrganizationId(principal, url);
        const [users, agents, runtimes, heartbeats, alerts, snapshots, audit, licenses, servers, releases, memoryJobs] = await Promise.all([repository.listUsers(scope), repository.listAgents(scope), repository.listAgentRuntimes(scope), repository.latestAgentHeartbeats(scope), repository.listAlerts(scope), repository.latestControlPlaneSnapshots(scope), repository.listAudit(scope), repository.listLicenses(scope), repository.listServers(scope), principal.role === ROLES.PLATFORM_ADMIN ? repository.listReleases() : Promise.resolve([]), repository.listMemoryProjectionJobs(scope)]);
        const memoryProjections = { queued: memoryJobs.filter((job) => ["pending", "processing", "retry"].includes(job.state)).length, dead: memoryJobs.filter((job) => job.state === "dead").length };
        return json(response, 200, { scope: scope ?? "platform", users: users.length, agents: agents.length, runtimes: runtimes.length, healthyRuntimes: runtimes.filter((runtime) => runtime.status === "ready").length, openAlerts: alerts.filter((alert) => alert.status === "open").length, memoryProjections, heartbeats, snapshots, licenses: licenses.length, servers: servers.length, releases: releases.length, recentAudit: audit.slice(0, 20) });
      }
      if (method === "GET" && url.pathname === "/api/admin/users") {
        requireLogin(principal);
        const scope = principal.role === ROLES.PLATFORM_ADMIN && !url.searchParams.get("organization_id") ? undefined : managedOrganizationId(principal, url);
        if (principal.role !== ROLES.PLATFORM_ADMIN) requirePermission(principal, PERMISSIONS.ORG_MEMBERS_MANAGE, { organizationId: principal.organizationId });
        else requirePermission(principal, PERMISSIONS.PLATFORM_USERS_MANAGE);
        return json(response, 200, { users: await repository.listUsers(scope) });
      }
      if (method === "GET" && url.pathname === "/api/admin/organizations") {
        requirePermission(requireLogin(principal), PERMISSIONS.PLATFORM_ORGS_MANAGE);
        return json(response, 200, { organizations: await repository.listOrganizations() });
      }
      const roleMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
      if (roleMatch && method === "PATCH") {
        requireLogin(principal);
        const target = await repository.getUser(roleMatch[1]);
        if (!target) return json(response, 404, { error: "user_not_found" });
        const body = await readJson(request);
        if (!isRole(body.role)) return json(response, 400, { error: "invalid_role" });
        if (principal.role === ROLES.PLATFORM_ADMIN) requirePermission(principal, PERMISSIONS.PLATFORM_USERS_MANAGE);
        else {
          requirePermission(principal, PERMISSIONS.ORG_MEMBERS_MANAGE, { organizationId: target.organizationId });
          if (body.role === ROLES.PLATFORM_ADMIN) throw new AuthorizationError();
        }
        const updated = await repository.updateUserRole(target.id, body.role);
        await repository.recordAudit({ organizationId: target.organizationId, actorUserId: principal.userId, action: "user.role.update", targetType: "user", targetId: target.id, metadata: { from: target.role, to: body.role } });
        return json(response, 200, { user: updated });
      }
      if (method === "GET" && url.pathname === "/api/admin/control-plane") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
        const scope = principal.role === ROLES.PLATFORM_ADMIN && !url.searchParams.get("organization_id") ? undefined : managedOrganizationId(principal, url);
        return json(response, 200, { snapshots: await repository.latestControlPlaneSnapshots(scope) });
      }
      if (method === "GET" && url.pathname === "/api/admin/agents") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
        const scope = principal.role === ROLES.PLATFORM_ADMIN && !url.searchParams.get("organization_id") ? undefined : managedOrganizationId(principal, url);
        const [agents, runtimes, heartbeats, components, resources, users] = await Promise.all([repository.listAgents(scope), repository.listAgentRuntimes(scope), repository.latestAgentHeartbeats(scope), repository.listAgentComponents(scope), repository.latestAgentResourceSamples(scope), repository.listUsers(scope)]);
        const runtimeByAgent = new Map(runtimes.map((runtime) => [runtime.agentId, runtime]));
        const heartbeatByRuntime = new Map(heartbeats.map((heartbeat) => [heartbeat.runtimeId, heartbeat]));
        const resourceByRuntime = new Map(resources.map((resource) => [resource.runtimeId, resourceFreshness(resource, resourceStaleAfterMs)]));
        const componentsByRuntime = new Map();
        for (const component of components) componentsByRuntime.set(component.runtimeId, [...(componentsByRuntime.get(component.runtimeId) ?? []), component]);
        const usersById = new Map(users.map((user) => [user.id, user]));
        return json(response, 200, { agents: agents.map((agent) => {
          const runtime = runtimeByAgent.get(agent.id) ?? null;
          return { ...publicFleetAgent(agent), owner: usersById.get(agent.ownerUserId) ?? null, runtime, heartbeat: runtime ? heartbeatByRuntime.get(runtime.id) ?? null : null, resource: runtime ? resourceByRuntime.get(runtime.id) ?? null : null, components: runtime ? componentsByRuntime.get(runtime.id) ?? [] : [] };
        }) });
      }
      const agentResourcesMatch = url.pathname.match(/^\/api\/admin\/agents\/([^/]+)\/resources$/);
      if (agentResourcesMatch && method === "GET") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
        const agent = await repository.getAgent(agentResourcesMatch[1]);
        if (!agent) return json(response, 404, { error: "agent_not_found" });
        const scope = principal.role === ROLES.PLATFORM_ADMIN && !url.searchParams.get("organization_id") ? agent.organizationId : managedOrganizationId(principal, url);
        if (agent.organizationId !== scope) throw new AuthorizationError();
        const samples = await repository.listAgentResourceSamples(scope, agent.id, url.searchParams.get("limit"));
        return json(response, 200, { agentId: agent.id, latest: resourceFreshness(samples[0] ?? null, resourceStaleAfterMs), samples });
      }
      if (method === "GET" && url.pathname === "/api/admin/alerts") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
        const scope = principal.role === ROLES.PLATFORM_ADMIN && !url.searchParams.get("organization_id") ? undefined : managedOrganizationId(principal, url);
        return json(response, 200, { alerts: await repository.listAlerts(scope) });
      }
      if (method === "GET" && url.pathname === "/api/admin/usage") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
        const scope = principal.role === ROLES.PLATFORM_ADMIN && !url.searchParams.get("organization_id") ? undefined : managedOrganizationId(principal, url);
        return json(response, 200, { rollups: await repository.listUsageRollups(scope) });
      }
      if (method === "GET" && url.pathname === "/api/admin/telemetry") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
        const scope = principal.role === ROLES.PLATFORM_ADMIN && !url.searchParams.get("organization_id") ? undefined : managedOrganizationId(principal, url);
        return json(response, 200, { events: await repository.listTelemetryEvents(scope, url.searchParams.get("limit")) });
      }
      if (method === "GET" && url.pathname === "/api/admin/channels") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
        const scope = principal.role === ROLES.PLATFORM_ADMIN && !url.searchParams.get("organization_id") ? undefined : managedOrganizationId(principal, url);
        const bindings = await repository.listChannelBindings(scope);
        return json(response, 200, { channels: bindings.map(publicChannelBinding) });
      }
      if (method === "GET" && url.pathname === "/api/admin/config-revisions") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
        const scope = principal.role === ROLES.PLATFORM_ADMIN && !url.searchParams.get("organization_id") ? undefined : managedOrganizationId(principal, url);
        return json(response, 200, { revisions: await repository.listConfigRevisions(scope, url.searchParams.get("agent_id") || undefined) });
      }
      if (method === "GET" && url.pathname === "/api/admin/audit") {
        requireLogin(principal);
        if (principal.role !== ROLES.PLATFORM_ADMIN) requirePermission(principal, PERMISSIONS.ORG_AUDIT_READ, { organizationId: principal.organizationId });
        const scope = principal.role === ROLES.PLATFORM_ADMIN && !url.searchParams.get("organization_id") ? undefined : managedOrganizationId(principal, url);
        return json(response, 200, { events: (await repository.listAudit(scope)).slice(0, 2000) });
      }
      if (await routeAdminControl({ method, url, request, response, principal })) return;
      const alertStatusMatch = url.pathname.match(/^\/api\/admin\/alerts\/([^/]+)\/status$/);
      if (alertStatusMatch && method === "PATCH") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_MANAGE, { organizationId: principal.organizationId });
        const body = await readJson(request);
        if (!["acknowledged", "resolved"].includes(body.status)) return json(response, 400, { error: "invalid_alert_status" });
        const before = (await repository.listAlerts(principal.role === ROLES.PLATFORM_ADMIN ? undefined : principal.organizationId)).find((item) => item.id === alertStatusMatch[1]);
        if (!before) return json(response, 404, { error: "alert_not_found" });
        if (principal.role !== ROLES.PLATFORM_ADMIN && before.organizationId !== principal.organizationId) throw new AuthorizationError();
        const alert = await repository.updateAlertStatus({ alertId: before.id, status: body.status, actorUserId: principal.userId });
        await repository.recordAudit({ organizationId: before.organizationId, actorUserId: principal.userId, action: `alert.${body.status}`, targetType: "alert", targetId: alert.id, metadata: { code: alert.code, agentId: alert.agentId } });
        return json(response, 200, { alert });
      }
      if (method === "GET" && url.pathname === "/api/admin/provider-channels") {
        requirePermission(requireLogin(principal), PERMISSIONS.PLATFORM_PROVIDER_SETTINGS_MANAGE);
        const organizationId = managedOrganizationId(principal, url);
        return json(response, 200, { channels: (await repository.listProviderChannels(organizationId)).map(publicProviderChannel) });
      }
      if (method === "POST" && url.pathname === "/api/admin/provider-channels") {
        requirePermission(requireLogin(principal), PERMISSIONS.PLATFORM_PROVIDER_SETTINGS_MANAGE);
        if (!providerVault) return json(response, 503, { error: "provider_secret_storage_unavailable" });
        const organizationId = managedOrganizationId(principal, url);
        const body = await readJson(request);
        if (![body.name, body.provider, body.model].every((item) => typeof item === "string" && item.trim())) return json(response, 400, { error: "invalid_provider_channel" });
        let parsedBaseUrl;
        try { parsedBaseUrl = new URL(body.baseUrl); } catch { return json(response, 400, { error: "invalid_provider_base_url" }); }
        if (parsedBaseUrl.protocol !== "https:") return json(response, 400, { error: "provider_base_url_requires_https" });
        const previous = (await repository.listProviderChannels(organizationId)).find((item) => item.name === body.name.trim());
        const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
        if (!previous?.apiKeyEnvelope && !apiKey) return json(response, 400, { error: "provider_api_key_required" });
        const priority = boundedInteger(body.priority, { maximum: 10000 });
        const weight = boundedInteger(body.weight, { minimum: 1, maximum: 10000 });
        const maxConcurrency = body.maxConcurrency === null || body.maxConcurrency === "" || body.maxConcurrency === undefined ? null : boundedInteger(body.maxConcurrency, { minimum: 1, maximum: 100000 });
        const monthlyBudgetUsd = body.monthlyBudgetUsd === null || body.monthlyBudgetUsd === "" || body.monthlyBudgetUsd === undefined ? null : Number(body.monthlyBudgetUsd);
        if (priority === null || weight === null || (body.maxConcurrency != null && body.maxConcurrency !== "" && maxConcurrency === null) || (monthlyBudgetUsd !== null && (!Number.isFinite(monthlyBudgetUsd) || monthlyBudgetUsd < 0))) return json(response, 400, { error: "invalid_provider_limits" });
        const channel = await repository.upsertProviderChannel({ organizationId, name: body.name.trim().slice(0, 120), provider: body.provider.trim().slice(0, 80), baseUrl: parsedBaseUrl.toString().replace(/\/$/, ""), model: body.model.trim().slice(0, 200), apiKeyEnvelope: apiKey ? providerVault.seal(apiKey) : null, keyHint: apiKey ? secretHint(apiKey) : null, priority, weight, maxConcurrency, monthlyBudgetUsd, enabled: body.enabled !== false, updatedBy: principal.userId });
        await repository.recordAudit({ organizationId, actorUserId: principal.userId, action: "provider.channel.upsert", targetType: "provider_channel", targetId: channel.id, metadata: { provider: channel.provider, model: channel.model, keyChanged: Boolean(apiKey) } });
        return json(response, previous ? 200 : 201, { channel: publicProviderChannel(channel) });
      }
      if (["GET", "PATCH"].includes(method) && url.pathname === "/api/admin/model-policy") {
        requirePermission(requireLogin(principal), PERMISSIONS.PLATFORM_PROVIDER_SETTINGS_MANAGE);
        const organizationId = managedOrganizationId(principal, url);
        if (method === "GET") return json(response, 200, { policy: await repository.getModelPolicy(organizationId) });
        const body = await readJson(request);
        const allowedModels = Array.isArray(body.allowedModels) ? [...new Set(body.allowedModels.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim().slice(0, 200)))].slice(0, 200) : null;
        const defaultModel = typeof body.defaultModel === "string" && body.defaultModel.trim() ? body.defaultModel.trim().slice(0, 200) : null;
        if (!allowedModels || (defaultModel && !allowedModels.includes(defaultModel))) return json(response, 400, { error: "invalid_model_policy" });
        const dailyTokenLimit = body.dailyTokenLimit == null || body.dailyTokenLimit === "" ? null : boundedInteger(body.dailyTokenLimit);
        const monthlyBudgetUsd = body.monthlyBudgetUsd == null || body.monthlyBudgetUsd === "" ? null : Number(body.monthlyBudgetUsd);
        if ((body.dailyTokenLimit != null && body.dailyTokenLimit !== "" && dailyTokenLimit === null) || (monthlyBudgetUsd !== null && (!Number.isFinite(monthlyBudgetUsd) || monthlyBudgetUsd < 0))) return json(response, 400, { error: "invalid_model_limits" });
        const policy = await repository.upsertModelPolicy({ organizationId, allowedModels, defaultModel, userCustomKeysAllowed: body.userCustomKeysAllowed === true, dailyTokenLimit, monthlyBudgetUsd, updatedBy: principal.userId });
        await repository.recordAudit({ organizationId, actorUserId: principal.userId, action: "model.policy.update", targetType: "model_policy", targetId: organizationId, metadata: { allowedModelCount: allowedModels.length, defaultModel } });
        return json(response, 200, { policy });
      }
      if (method === "POST" && url.pathname === "/api/admin/data-retention/run") {
        requirePermission(requireLogin(principal), PERMISSIONS.DATA_GOVERNANCE_MANAGE, { organizationId: principal.organizationId });
        const organizationId = managedOrganizationId(principal, url);
        const body = await readJson(request);
        if (typeof body.reason !== "string" || body.reason.trim().length < 10) return json(response, 400, { error: "retention_reason_required" });
        return json(response, 200, { runs: await repository.enforceRetentionPolicies({ organizationId, actorUserId: principal.userId, reason: body.reason.trim().slice(0, 1000) }) });
      }
      if (["GET", "PATCH"].includes(method) && url.pathname === "/api/admin/data-retention") {
        requirePermission(requireLogin(principal), PERMISSIONS.DATA_GOVERNANCE_MANAGE, { organizationId: principal.organizationId });
        const organizationId = managedOrganizationId(principal, url);
        if (method === "GET") return json(response, 200, { policy: await repository.getRetentionPolicy(organizationId), runs: await repository.listRetentionRuns(organizationId) });
        const body = await readJson(request);
        const values = [boundedInteger(body.telemetryDays, { minimum: 1, maximum: 3650 }), boundedInteger(body.usageDays, { minimum: 35, maximum: 3650 }), boundedInteger(body.auditDays, { minimum: 1, maximum: 3650 }), boundedInteger(body.sensitiveAccessEventDays, { minimum: 1, maximum: 3650 }), boundedInteger(body.backupDays, { minimum: 1, maximum: 3650 })];
        if (values.some((item) => item === null)) return json(response, 400, { error: "invalid_retention_policy" });
        const policy = await repository.upsertRetentionPolicy({ organizationId, telemetryDays: values[0], usageDays: values[1], auditDays: values[2], sensitiveAccessEventDays: values[3], backupDays: values[4], updatedBy: principal.userId });
        await repository.recordAudit({ organizationId, actorUserId: principal.userId, action: "retention.policy.update", targetType: "data_retention_policy", targetId: organizationId, metadata: { ...body, updatedBy: undefined } });
        return json(response, 200, { policy });
      }
      if (method === "GET" && url.pathname === "/api/admin/backups") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
        const scope = principal.role === ROLES.PLATFORM_ADMIN && !url.searchParams.get("organization_id") ? undefined : managedOrganizationId(principal, url);
        const [backups, restores] = await Promise.all([repository.listBackupRecords(scope), repository.listBackupRestoreRuns(scope)]);
        return json(response, 200, { backups, restores });
      }
      if (method === "GET" && url.pathname === "/api/admin/release-gates") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
        const scope = principal.role === ROLES.PLATFORM_ADMIN && !url.searchParams.get("organization_id") ? undefined : managedOrganizationId(principal, url);
        return json(response, 200, { gates: await repository.listReleaseGates(scope) });
      }
      if (method === "GET" && url.pathname === "/api/admin/upstreams") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
        return json(response, 200, { candidates: await repository.listUpstreamCandidates() });
      }
      if (method === "GET" && url.pathname === "/api/admin/sensitive-access") {
        requirePermission(requireLogin(principal), PERMISSIONS.SENSITIVE_ACCESS_MANAGE);
        const organizationId = managedOrganizationId(principal, url);
        const [grants, events] = await Promise.all([repository.listSensitiveAccessGrants(organizationId), repository.listSensitiveAccessEvents(organizationId)]);
        return json(response, 200, { grants, events });
      }
      if (method === "POST" && url.pathname === "/api/admin/sensitive-access/grants") {
        requirePermission(requireLogin(principal), PERMISSIONS.SENSITIVE_ACCESS_MANAGE);
        const organizationId = managedOrganizationId(principal, url);
        const body = await readJson(request);
        const expiresAt = Date.parse(body.expiresAt);
        if (!["organization", "user", "agent", "session"].includes(body.scope) || (body.scope !== "organization" && (typeof body.targetId !== "string" || !body.targetId)) || typeof body.reason !== "string" || body.reason.trim().length < 10 || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 24 * 60 * 60_000) return json(response, 400, { error: "invalid_sensitive_access_grant" });
        const grantee = await repository.getUser(body.granteeUserId);
        if (!grantee || ![ROLES.ORG_ADMIN, ROLES.PLATFORM_ADMIN].includes(grantee.role) || (grantee.role !== ROLES.PLATFORM_ADMIN && grantee.organizationId !== organizationId)) return json(response, 400, { error: "invalid_sensitive_access_grantee" });
        const target = body.scope === "user" ? await repository.getUser(body.targetId) : body.scope === "agent" ? await repository.getAgent(body.targetId) : body.scope === "session" ? await repository.getConversation(body.targetId) : { organizationId };
        if (!target || target.organizationId !== organizationId) return json(response, 400, { error: "invalid_sensitive_access_target" });
        const grant = await repository.createSensitiveAccessGrant({ organizationId, granteeUserId: grantee.id, scope: body.scope, targetId: body.targetId || null, reason: body.reason.trim().slice(0, 1000), grantedBy: principal.userId, expiresAt: new Date(expiresAt).toISOString() });
        await repository.recordAudit({ organizationId, actorUserId: principal.userId, action: "sensitive_access.grant", targetType: "sensitive_access_grant", targetId: grant.id, metadata: { granteeUserId: grant.granteeUserId, scope: grant.scope, targetId: grant.targetId, expiresAt: grant.expiresAt, reason: grant.reason } });
        return json(response, 201, { grant });
      }
      const revokeGrantMatch = url.pathname.match(/^\/api\/admin\/sensitive-access\/grants\/([^/]+)\/revoke$/);
      if (revokeGrantMatch && method === "POST") {
        requirePermission(requireLogin(principal), PERMISSIONS.SENSITIVE_ACCESS_MANAGE);
        const organizationId = managedOrganizationId(principal, url);
        const grant = await repository.revokeSensitiveAccessGrant(organizationId, revokeGrantMatch[1]);
        if (!grant) return json(response, 404, { error: "grant_not_found" });
        await repository.recordAudit({ organizationId, actorUserId: principal.userId, action: "sensitive_access.revoke", targetType: "sensitive_access_grant", targetId: grant.id, metadata: { reason: grant.reason } });
        return json(response, 200, { grant });
      }
      if (method === "GET" && url.pathname === "/api/admin/provider-settings") {
        requirePermission(requireLogin(principal), PERMISSIONS.PLATFORM_PROVIDER_SETTINGS_MANAGE);
        return json(response, 200, { configuration: publicProviderConfiguration(await repository.getProviderConfiguration(principal.organizationId)) });
      }
      if (method === "PATCH" && url.pathname === "/api/admin/provider-settings") {
        requirePermission(requireLogin(principal), PERMISSIONS.PLATFORM_PROVIDER_SETTINGS_MANAGE);
        if (!providerVault) return json(response, 503, { error: "provider_secret_storage_unavailable" });
        const body = await readJson(request);
        if (typeof body.provider !== "string" || !body.provider.trim() || typeof body.model !== "string" || !body.model.trim()) return json(response, 400, { error: "invalid_provider_configuration" });
        let parsedBaseUrl;
        try { parsedBaseUrl = new URL(body.baseUrl); } catch { return json(response, 400, { error: "invalid_provider_base_url" }); }
        if (parsedBaseUrl.protocol !== "https:") return json(response, 400, { error: "provider_base_url_requires_https" });
        const previous = await repository.getProviderConfiguration(principal.organizationId);
        if (!previous?.apiKeyEnvelope && (typeof body.apiKey !== "string" || !body.apiKey.trim())) return json(response, 400, { error: "provider_api_key_required" });
        const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
        const saved = await repository.upsertProviderConfiguration({
          organizationId: principal.organizationId,
          provider: body.provider.trim().slice(0, 80),
          baseUrl: parsedBaseUrl.toString().replace(/\/$/, ""),
          model: body.model.trim().slice(0, 200),
          apiKeyEnvelope: apiKey ? providerVault.seal(apiKey) : null,
          keyHint: apiKey ? secretHint(apiKey) : null,
          updatedBy: principal.userId
        });
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "provider.configuration.update", targetType: "provider_configuration", targetId: principal.organizationId, metadata: { provider: saved.provider, model: saved.model, keyChanged: Boolean(apiKey) } });
        return json(response, 200, { configuration: publicProviderConfiguration(saved) });
      }
      if (method === "GET" && url.pathname === "/api/admin/integrations") {
        requireLogin(principal);
        if (principal.role !== ROLES.PLATFORM_ADMIN) requirePermission(principal, PERMISSIONS.ORG_AUDIT_READ, { organizationId: principal.organizationId });
        const scope = principal.role === ROLES.PLATFORM_ADMIN && !url.searchParams.get("organization_id") ? undefined : managedOrganizationId(principal, url);
        const [runs, authorizations] = await Promise.all([repository.listIntegrationRuns(scope), repository.listAgentAuthorizations(scope)]);
        return json(response, 200, { catalog: INTEGRATION_CATALOG, runs, authorizations: authorizations.map(publicAgentAuthorization) });
      }
      if (method === "POST" && url.pathname === "/api/admin/hotspots/refresh") {
        requireLogin(principal);
        if (principal.role !== ROLES.PLATFORM_ADMIN) requirePermission(principal, PERMISSIONS.ORG_AUDIT_READ, { organizationId: principal.organizationId });
        if (!runtimeClient) return json(response, 503, { error: "runtime_unavailable" });
        const organizationId = managedOrganizationId(principal, url);
        const body = await readJson(request);
        const startedAt = new Date().toISOString();
        const result = await runtimeClient.invokeIntegration({ integrationId: "trendradar", capability: "list_hotspots", input: { sources: Array.isArray(body.sources) ? body.sources : undefined } });
        const run = await repository.saveIntegrationResult({ organizationId, integrationId: "trendradar", capability: "list_hotspots", status: result.status, summary: { sources: result.output?.sources ?? [], count: result.output?.items?.length ?? 0 }, items: result.output?.items ?? [], startedAt, completedAt: result.completed_at });
        await repository.recordAudit({ organizationId, actorUserId: principal.userId, action: "integration.hotspots.refresh", targetType: "integration_run", targetId: run.id, metadata: { status: run.status, count: result.output?.items?.length ?? 0 } });
        return json(response, 202, { run, count: result.output?.items?.length ?? 0 });
      }
      if (method === "GET" && url.pathname === "/api/admin/licenses") {
        requireLogin(principal);
        const scope = principal.role === ROLES.PLATFORM_ADMIN ? undefined : principal.organizationId;
        if (principal.role !== ROLES.PLATFORM_ADMIN) requirePermission(principal, PERMISSIONS.ORG_AUDIT_READ, { organizationId: principal.organizationId });
        else requirePermission(principal, PERMISSIONS.PLATFORM_LICENSES_MANAGE);
        return json(response, 200, { licenses: await repository.listLicenses(scope) });
      }
      if (method === "POST" && url.pathname === "/api/admin/licenses") {
        requirePermission(requireLogin(principal), PERMISSIONS.PLATFORM_LICENSES_MANAGE);
        if (!licensePrivateKey) return json(response, 503, { error: "license_signing_unavailable" });
        const body = await readJson(request);
        if (!await repository.getOrganization(body.organizationId)) return json(response, 404, { error: "organization_not_found" });
        const document = issueLicense({ organizationId: body.organizationId, plan: body.plan, features: body.features, limits: body.limits, expiresAt: body.expiresAt }, licensePrivateKey);
        const license = await repository.createLicense({ id: document.payload.licenseId, organizationId: body.organizationId, plan: body.plan, document, issuedAt: document.payload.issuedAt, expiresAt: document.payload.expiresAt });
        await repository.recordAudit({ organizationId: body.organizationId, actorUserId: principal.userId, action: "license.issue", targetType: "license", targetId: license.id, metadata: { plan: license.plan } });
        return json(response, 201, { license });
      }
      if (method === "GET" && url.pathname === "/api/admin/servers") {
        requireLogin(principal);
        const scope = principal.role === ROLES.PLATFORM_ADMIN ? undefined : principal.organizationId;
        if (principal.role !== ROLES.PLATFORM_ADMIN) requirePermission(principal, PERMISSIONS.ORG_AUDIT_READ, { organizationId: principal.organizationId });
        else requirePermission(principal, PERMISSIONS.PLATFORM_SERVERS_MANAGE);
        return json(response, 200, { servers: await repository.listServers(scope) });
      }
      if (method === "POST" && url.pathname === "/api/admin/servers") {
        requirePermission(requireLogin(principal), PERMISSIONS.PLATFORM_SERVERS_MANAGE);
        const body = await readJson(request);
        if (!await repository.getOrganization(body.organizationId)) return json(response, 404, { error: "organization_not_found" });
        if (typeof body.name !== "string" || !body.name.trim()) return json(response, 400, { error: "invalid_server" });
        const server = await repository.createServer({ organizationId: body.organizationId, name: body.name.trim() });
        const issued = issueMachineToken();
        const credential = await repository.createServerCredential({ serverId: server.id, keyHash: issued.keyHash, keyHint: issued.keyHint, createdBy: principal.userId });
        await repository.recordAudit({ organizationId: body.organizationId, actorUserId: principal.userId, action: "server.create", targetType: "server", targetId: server.id });
        return json(response, 201, { server, credential: { id: credential.id, token: issued.token, keyHint: credential.keyHint } });
      }
      const serverCredentialMatch = url.pathname.match(/^\/api\/admin\/servers\/([^/]+)\/credentials$/);
      if (serverCredentialMatch && method === "POST") {
        requirePermission(requireLogin(principal), PERMISSIONS.PLATFORM_SERVERS_MANAGE);
        const server = (await repository.listServers()).find((item) => item.id === serverCredentialMatch[1]);
        if (!server) return json(response, 404, { error: "server_not_found" });
        const issued = issueMachineToken();
        const credential = await repository.createServerCredential({ serverId: server.id, keyHash: issued.keyHash, keyHint: issued.keyHint, createdBy: principal.userId });
        await repository.recordAudit({ organizationId: server.organizationId, actorUserId: principal.userId, action: "server.credential.rotate", targetType: "server", targetId: server.id, metadata: { credentialId: credential.id } });
        return json(response, 201, { credential: { id: credential.id, token: issued.token, keyHint: credential.keyHint } });
      }
      if (method === "GET" && url.pathname === "/api/admin/releases") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
        return json(response, 200, { releases: await repository.listReleases() });
      }
      if (method === "POST" && url.pathname === "/api/admin/releases") {
        requirePermission(requireLogin(principal), PERMISSIONS.PLATFORM_RELEASES_MANAGE);
        const body = await readJson(request);
        if (typeof body.version !== "string" || typeof body.agentCommit !== "string" || !/^[0-9a-f]{40}$/.test(body.agentCommit)) return json(response, 400, { error: "invalid_release" });
        const release = await repository.createRelease({ version: body.version, agentCommit: body.agentCommit, status: body.status, notes: body.notes });
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "release.create", targetType: "release", targetId: release.id, metadata: { version: release.version } });
        return json(response, 201, { release });
      }
      const runtimeAuthorizationMatch = url.pathname.match(/^\/api\/internal\/runtime\/agents\/([^/]+)\/authorizations\/([^/]+)\/resolve$/);
      if (runtimeAuthorizationMatch && method === "POST") {
        if (!providerVault) return json(response, 503, { error: "authorization_secret_storage_unavailable" });
        const signed = await readSignedJson(request);
        const machine = await authenticateMachine(request, url, signed.raw, "agent-runtime");
        const agentId = decodeURIComponent(runtimeAuthorizationMatch[1]);
        const authorizationId = decodeURIComponent(runtimeAuthorizationMatch[2]);
        if (!machine || machine.machineId !== agentId) return json(response, 401, { error: "invalid_agent_credential" });
        const agent = await repository.getAgent(agentId);
        if (!agent) return json(response, 404, { error: "agent_not_found" });
        const authorization = await repository.getAgentAuthorization(agent.organizationId, agent.ownerUserId, agent.id, authorizationId);
        if (!authorization || !["stored", "applied"].includes(authorization.status) || !authorization.credentialEnvelope) return json(response, 404, { error: "authorization_not_available" });
        const credential = JSON.parse(providerVault.open(authorization.credentialEnvelope));
        await repository.markAgentAuthorizationUsed(authorization.id);
        await repository.recordAudit({ organizationId: agent.organizationId, actorUserId: null, action: "agent.authorization.resolve", targetType: "agent_authorization", targetId: authorization.id, metadata: { agentId: agent.id, runtimeCredentialId: machine.credential.id, service: authorization.service } });
        const resolved = validateCredentialResolution({ authorization: { id: authorization.id, service: authorization.service, label: authorization.label, authType: authorization.authType, endpointUrl: authorization.endpointUrl, metadata: authorization.metadata }, credential });
        return json(response, 200, resolved);
      }
      if (method === "POST" && url.pathname === "/api/internal/control-plane/snapshots") {
        const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
        if (!constantTokenMatch(bearer, agentIngestToken)) return json(response, 401, { error: "invalid_agent_credential" });
        const body = await readJson(request);
        if (!body.organizationId || !body.serverId || !body.snapshot?.schemaVersion) return json(response, 400, { error: "invalid_snapshot" });
        if (!await repository.getOrganization(body.organizationId)) return json(response, 404, { error: "organization_not_found" });
        const saved = await repository.saveControlPlaneSnapshot({ organizationId: body.organizationId, serverId: body.serverId, status: body.snapshot.status ?? "unknown", payload: body.snapshot });
        await repository.recordServerHeartbeat({
          id: body.serverId,
          organizationId: body.organizationId,
          status: body.snapshot.status ?? "unknown",
          runtimeVersion: body.snapshot.heartbeat?.runtimeBoundaryVersion ?? null
        });
        return json(response, 202, { id: saved.id });
      }
      if (method === "POST" && url.pathname === "/api/internal/control-plane/heartbeats") {
        const signed = await readSignedJson(request);
        const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
        const machine = await authenticateMachine(request, url, signed.raw, "agent-runtime");
        if ((!machine || machine.machineId !== signed.body.agentId) && !constantTokenMatch(bearer, agentIngestToken)) return json(response, 401, { error: "invalid_agent_credential" });
        let body;
        try { body = validateRuntimeHeartbeat(signed.body); }
        catch { return json(response, 400, { error: "invalid_agent_heartbeat" }); }
        const [agent, runtime] = await Promise.all([repository.getAgent(body.agentId), repository.getAgentRuntimeByAgent(body.agentId)]);
        if (!agent || !runtime || runtime.id !== body.runtimeId || agent.organizationId !== body.organizationId || agent.ownerUserId !== body.userId) return json(response, 404, { error: "agent_runtime_not_found" });
        const components = Array.isArray(body.components) ? body.components.slice(0, 100).map((component) => ({
          layer: component.layer,
          moduleId: typeof component.moduleId === "string" ? component.moduleId.slice(0, 200) : "",
          status: component.status,
          version: typeof component.version === "string" ? component.version.slice(0, 200) : null,
          upstreamRef: typeof component.upstreamRef === "string" ? component.upstreamRef.slice(0, 200) : null,
          capabilities: Array.isArray(component.capabilities) ? component.capabilities.filter((item) => typeof item === "string").slice(0, 100) : [],
          metrics: numericMetrics(component.metrics),
          observedAt: Number.isFinite(Date.parse(component.observedAt)) ? component.observedAt : body.observedAt
        })).filter((component) => CONTROL_LAYERS.has(component.layer) && component.moduleId && COMPONENT_STATUSES.has(component.status)) : [];
        const events = Array.isArray(body.events) ? body.events.slice(0, 100).map((event) => ({
          layer: CONTROL_LAYERS.has(event.layer) ? event.layer : null,
          componentId: typeof event.componentId === "string" ? event.componentId.slice(0, 200) : null,
          eventType: typeof event.eventType === "string" ? event.eventType.slice(0, 200) : "",
          severity: TELEMETRY_SEVERITIES.has(event.severity) ? event.severity : "info",
          traceId: typeof event.traceId === "string" ? event.traceId.slice(0, 200) : null,
          metrics: numericMetrics(event.metrics),
          occurredAt: Number.isFinite(Date.parse(event.occurredAt)) ? event.occurredAt : body.observedAt
        })).filter((event) => event.eventType) : [];
        const usage = body.usage && typeof body.usage === "object" && Number.isFinite(Date.parse(body.usage.bucketStart)) && [60, 300, 3600, 86400].includes(body.usage.bucketSeconds) ? {
          bucketStart: body.usage.bucketStart, bucketSeconds: body.usage.bucketSeconds,
          model: typeof body.usage.model === "string" ? body.usage.model.slice(0, 200) : "unknown",
          inputTokens: Math.max(0, Number(body.usage.inputTokens) || 0), outputTokens: Math.max(0, Number(body.usage.outputTokens) || 0),
          estimatedCostUsd: Math.max(0, Number(body.usage.estimatedCostUsd) || 0), runCount: Math.max(0, Number(body.usage.runCount) || 0),
          failedRunCount: Math.max(0, Number(body.usage.failedRunCount) || 0), latencySumMs: Math.max(0, Number(body.usage.latencySumMs) || 0)
        } : null;
        const saved = await repository.saveAgentHeartbeat({ organizationId: body.organizationId, userId: body.userId, agentId: body.agentId, runtimeId: body.runtimeId, sequence: body.sequence, status: body.status, runtimeVersion: typeof body.runtimeVersion === "string" ? body.runtimeVersion.slice(0, 200) : null, boundaryVersion: typeof body.boundaryVersion === "string" ? body.boundaryVersion.slice(0, 200) : null, configRevisionId: typeof body.configRevisionId === "string" ? body.configRevisionId : null, queueDepth: Math.max(0, Number(body.queueDepth) || 0), activeRuns: Math.max(0, Number(body.activeRuns) || 0), failedRuns: Math.max(0, Number(body.failedRuns) || 0), observedAt: body.observedAt, components, events, usage });
        return json(response, 202, { id: saved.id });
      }

      if (method === "POST" && url.pathname === "/api/internal/control-plane/resources") {
        const signed = await readSignedJson(request);
        const machine = await authenticateMachine(request, url, signed.raw, "server");
        if (!machine || signed.body.serverId !== machine.machineId) return json(response, 401, { error: "invalid_server_credential" });
        let body;
        try { body = validateResourceReport(signed.body); }
        catch { return json(response, 400, { error: "invalid_resource_samples" }); }
        const samples = body.samples.map(resourceSample);
        if (samples.some((sample) => !sample)) return json(response, 400, { error: "invalid_resource_sample" });
        const server = (await repository.listServers()).find((item) => item.id === machine.machineId);
        if (!server) return json(response, 404, { error: "server_not_found" });
        const saved = samples.length ? await repository.saveAgentResourceSamples({ serverId: machine.machineId, samples }) : [];
        await repository.recordServerHeartbeat({ id: machine.machineId, organizationId: server.organizationId, status: "healthy", runtimeVersion: saved[0]?.dockerVersion ?? server.runtimeVersion ?? null });
        return json(response, 202, { accepted: saved.length, sampleIds: saved.map((sample) => sample.id) });
      }

      if (method === "POST" && url.pathname === "/api/internal/control-plane/commands/lease") {
        const signed = await readSignedJson(request);
        const machine = await authenticateMachine(request, url, signed.raw, "server");
        if (!machine || signed.body.serverId !== machine.machineId) return json(response, 401, { error: "invalid_server_credential" });
        const commands = await repository.leaseControlCommands({ serverId: machine.machineId, limit: Number(signed.body.limit) || 10, leaseSeconds: Number(signed.body.leaseSeconds) || 60 });
        return json(response, 200, { commands: commands.map(revealLease) });
      }
      const commandReceiptMatch = url.pathname.match(/^\/api\/internal\/control-plane\/commands\/([^/]+)\/receipts$/);
      if (commandReceiptMatch && method === "POST") {
        const signed = await readSignedJson(request);
        const machine = await authenticateMachine(request, url, signed.raw, "server");
        const body = signed.body;
        if (!machine || body.serverId !== machine.machineId) return json(response, 401, { error: "invalid_server_credential" });
        if (!Number.isSafeInteger(body.attempt) || body.attempt < 1 || !["accepted", "running", "succeeded", "failed", "cancelled", "expired"].includes(body.state)) return json(response, 400, { error: "invalid_command_receipt" });
        const endpointRef = body.runtimeEndpointRef === undefined ? null : runtimeEndpointRef(body.runtimeEndpointRef);
        if (body.runtimeEndpointRef !== undefined && !endpointRef) return json(response, 400, { error: "invalid_runtime_endpoint" });
        const receipt = await repository.recordCommandReceipt({ commandId: commandReceiptMatch[1], serverId: machine.machineId, attempt: body.attempt, state: body.state, errorCode: typeof body.errorCode === "string" ? body.errorCode.slice(0, 200) : null, errorSummary: typeof body.errorSummary === "string" ? body.errorSummary.slice(0, 1000) : null, runtimeEndpointRef: endpointRef, resultSummary: numericMetrics(body.resultSummary), evidenceRefs: Array.isArray(body.evidenceRefs) ? body.evidenceRefs.filter((item) => typeof item === "string").slice(0, 20) : [] });
        if (!receipt) return json(response, 404, { error: "command_lease_not_found" });
        return json(response, 202, { receipt });
      }

      return json(response, 404, { error: "not_found" });
    } catch (error) {
      const statusCode = error.statusCode ?? 500;
      if (statusCode >= 500) logger.error?.("Platform request failed", { method, path: url.pathname, error: error.message });
      return json(response, statusCode, { error: error.expose === true || statusCode < 500 ? error.message : "internal_error" });
    }
  };
}

export function createPlatformServer(options) {
  return createServer(createPlatformApp(options));
}
