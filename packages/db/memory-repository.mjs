import { createHash, randomUUID } from "node:crypto";

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

const DEFAULT_RETENTION = Object.freeze({ telemetryDays: 30, usageDays: 400, auditDays: 365, sensitiveAccessEventDays: 365, backupDays: 30 });

function retentionCutoffs(policy, now) {
  const day = 24 * 60 * 60_000;
  return {
    telemetry: new Date(now - policy.telemetryDays * day).toISOString(),
    usage: new Date(now - policy.usageDays * day).toISOString(),
    audit: new Date(now - policy.auditDays * day).toISOString(),
    sensitiveAccess: new Date(now - policy.sensitiveAccessEventDays * day).toISOString(),
    backup: new Date(now - policy.backupDays * day).toISOString()
  };
}

export class MemoryPlatformRepository {
  #organizations = new Map();
  #users = new Map();
  #agents = new Map();
  #agentRuntimes = new Map();
  #agentScenes = new Map();
  #agentSceneEvents = [];
  #conversations = new Map();
  #messages = new Map();
  #snapshots = [];
  #audit = [];
  #licenses = [];
  #servers = [];
  #releases = [];
  #providerConfigurations = new Map();
  #integrationRuns = [];
  #hotspots = new Map();
  #obsidianNotes = [];
  #memoryProjectionOutbox = [];
  #agentSkillPreferences = [];
  #agentChannelBindings = [];
  #channelConversations = [];
  #channelInbox = [];
  #channelOutbox = [];
  #channelDeliveryReceipts = [];
  #channelHealthObservations = [];
  #channelDeadLetters = [];
  #agentAuthorizations = [];
  #agentRuns = [];
  #agentHotspotBookmarks = [];
  #providerChannels = [];
  #modelPolicies = new Map();
  #retentionPolicies = new Map();
  #sensitiveGrants = [];
  #sensitiveAccessEvents = [];
  #backupRecords = [];
  #backupRestoreRuns = [];
  #retentionRuns = [];
  #releaseGates = [];
  #upstreamCandidates = [];
  #agentComponents = new Map();
  #heartbeats = [];
  #resourceSamples = [];
  #telemetryEvents = [];
  #usageRollups = [];
  #alerts = [];
  #controlDeployments = [];
  #configRevisions = [];
  #controlCommands = [];
  #controlApprovals = [];
  #releaseManifests = [];
  #testRuns = [];
  #serverCredentials = [];
  #agentRuntimeCredentials = [];
  #channelWorkerCredentials = [];
  #machineNonces = new Set();
  #commandReceipts = [];

  async readiness() {
    return { ready: true, status: "ready", backend: "memory", migration: "in-memory" };
  }

  #enqueueMemoryProjection(input) {
    const reason = String(input.reason ?? "note-write");
    if (!/^[a-z][a-z0-9._-]{0,63}$/.test(reason)) throw new TypeError("Invalid memory projection reason");
    const now = new Date().toISOString();
    const existing = this.#memoryProjectionOutbox.find((item) => item.agentId === input.agentId && ["pending", "retry"].includes(item.state));
    if (existing) {
      Object.assign(existing, { reason, state: "pending", attempts: 0, availableAt: now, lastErrorCode: null, resultSummary: {}, updatedAt: now, completedAt: null });
      return existing;
    }
    const job = { id: randomUUID(), organizationId: input.organizationId, userId: input.userId, agentId: input.agentId, reason, state: "pending", attempts: 0, availableAt: now, leaseToken: null, leaseExpiresAt: null, lastErrorCode: null, resultSummary: {}, createdAt: now, updatedAt: now, completedAt: null };
    this.#memoryProjectionOutbox.push(job);
    return job;
  }

  async createOrganization(input) {
    const organization = { id: input.id ?? randomUUID(), name: input.name, createdAt: new Date().toISOString() };
    this.#organizations.set(organization.id, organization);
    return organization;
  }

  async getOrganization(id) {
    return this.#organizations.get(id) ?? null;
  }

  async listOrganizations() {
    return [...this.#organizations.values()];
  }

  async createUser(input) {
    const duplicate = [...this.#users.values()].find((user) => user.email === input.email.toLowerCase());
    if (duplicate) throw new Error("Email already exists");
    const user = {
      id: input.id ?? randomUUID(),
      organizationId: input.organizationId,
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      role: input.role ?? "user",
      status: input.status ?? "active",
      createdAt: new Date().toISOString()
    };
    this.#users.set(user.id, user);
    return publicUser(user);
  }

  async findUserByEmail(email) {
    return [...this.#users.values()].find((user) => user.email === email.toLowerCase()) ?? null;
  }

  async getUser(id) {
    return publicUser(this.#users.get(id));
  }

  async listUsers(organizationId) {
    return [...this.#users.values()].filter((user) => !organizationId || user.organizationId === organizationId).map(publicUser);
  }

  async updateUserRole(id, role) {
    const user = this.#users.get(id);
    if (!user) return null;
    user.role = role;
    return publicUser(user);
  }

  async createAgent(input) {
    if (!input.ownerUserId) throw new TypeError("ownerUserId is required");
    const now = new Date().toISOString();
    const agent = {
      id: input.id ?? randomUUID(),
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      name: input.name,
      description: input.description ?? "",
      avatarUrl: input.avatarUrl ?? null,
      soulMarkdown: input.soulMarkdown ?? "",
      status: input.status ?? "pending",
      initializationStatus: input.initializationStatus ?? "uninitialized",
      desiredRuntimeState: input.desiredRuntimeState ?? "stopped",
      settings: input.settings ?? {},
      lastErrorCode: null,
      lastErrorDetail: null,
      createdAt: now,
      updatedAt: now
    };
    this.#agents.set(agent.id, agent);
    return agent;
  }

  async getAgent(id) {
    return this.#agents.get(id) ?? null;
  }

  async listAgents(organizationId, ownerUserId) {
    return [...this.#agents.values()].filter((agent) => (!organizationId || agent.organizationId === organizationId) && (!ownerUserId || agent.ownerUserId === ownerUserId));
  }

  async updateAgent(id, patch) {
    const agent = this.#agents.get(id);
    if (!agent) return null;
    for (const field of ["name", "description", "avatarUrl", "soulMarkdown", "status", "initializationStatus", "desiredRuntimeState", "settings", "lastErrorCode", "lastErrorDetail"]) {
      if (field in patch) agent[field] = patch[field];
    }
    agent.updatedAt = new Date().toISOString();
    return agent;
  }

  async createAgentRuntime(input) {
    const existing = [...this.#agentRuntimes.values()].find((runtime) => runtime.agentId === input.agentId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const runtime = {
      id: input.id ?? randomUUID(), organizationId: input.organizationId, ownerUserId: input.ownerUserId,
      agentId: input.agentId, deploymentId: input.deploymentId ?? null, workspaceRef: input.workspaceRef,
      runtimeKind: "hermes", status: input.status ?? "uninitialized", hermesVersion: null,
      boundaryVersion: null, configRevisionId: null, lastHeartbeatAt: null, lastErrorCode: null,
      lastErrorDetail: null, createdAt: now, updatedAt: now
    };
    this.#agentRuntimes.set(runtime.id, runtime);
    return runtime;
  }

  async getAgentRuntimeByAgent(agentId) {
    return [...this.#agentRuntimes.values()].find((runtime) => runtime.agentId === agentId) ?? null;
  }

  async ensureAgentScene(input) {
    const agent = this.#agents.get(input.agentId);
    if (!agent || agent.organizationId !== input.organizationId || agent.ownerUserId !== input.userId) return null;
    const key = `${input.agentId}:${input.sceneId}`;
    const existing = this.#agentScenes.get(key);
    if (existing) return structuredClone(existing);
    const now = new Date().toISOString();
    const scene = { organizationId: input.organizationId, userId: input.userId, agentId: input.agentId, sceneId: input.sceneId, revision: 0, view: structuredClone(input.view ?? { surfaces: [] }), createdAt: now, updatedAt: now };
    this.#agentScenes.set(key, scene);
    return structuredClone(scene);
  }

  async getAgentScene(input) {
    const scene = this.#agentScenes.get(`${input.agentId}:${input.sceneId}`);
    if (!scene || scene.organizationId !== input.organizationId || scene.userId !== input.userId) return null;
    return structuredClone(scene);
  }

  async applyAgentSceneIntent(input) {
    const key = `${input.agentId}:${input.sceneId}`;
    const scene = this.#agentScenes.get(key);
    if (!scene || scene.organizationId !== input.organizationId || scene.userId !== input.userId) return null;
    if (input.action === "resync") return { scene: structuredClone(scene), patch: null };
    const baseRevision = scene.revision;
    scene.revision += 1;
    scene.view = structuredClone(input.view ?? scene.view);
    scene.updatedAt = new Date().toISOString();
    const patch = { id: input.eventId ?? randomUUID(), organizationId: scene.organizationId, userId: scene.userId, agentId: scene.agentId, sceneId: scene.sceneId, baseRevision, revision: scene.revision, operations: [{ op: "replace", path: "/view", value: structuredClone(scene.view) }], createdAt: scene.updatedAt };
    this.#agentSceneEvents.push(patch);
    return { scene: structuredClone(scene), patch: structuredClone(patch) };
  }

  async listAgentSceneEvents(input) {
    const afterRevision = Math.max(0, Number(input.afterRevision) || 0);
    const limit = Math.max(1, Math.min(Number(input.limit) || 100, 500));
    return this.#agentSceneEvents.filter((event) => event.organizationId === input.organizationId && event.userId === input.userId && event.agentId === input.agentId && event.sceneId === input.sceneId && event.revision > afterRevision).slice(0, limit).map((event) => structuredClone(event));
  }

  async listAgentRuntimes(organizationId, ownerUserId) {
    return [...this.#agentRuntimes.values()].filter((runtime) => (!organizationId || runtime.organizationId === organizationId) && (!ownerUserId || runtime.ownerUserId === ownerUserId));
  }

  async saveAgentHeartbeat(input) {
    const runtime = this.#agentRuntimes.get(input.runtimeId);
    const agent = this.#agents.get(input.agentId);
    if (!runtime || !agent || runtime.agentId !== agent.id) return null;
    const receivedAt = new Date().toISOString();
    const heartbeat = { id: input.id ?? randomUUID(), ...input, receivedAt };
    if (!this.#heartbeats.some((item) => item.runtimeId === input.runtimeId && item.sequence === input.sequence)) this.#heartbeats.push(heartbeat);
    const runtimeStatus = input.status === "healthy" ? "ready" : input.status === "unhealthy" ? "failed" : "degraded";
    const initializationStatus = input.status === "healthy" ? "ready" : input.status === "unhealthy" ? "failed" : "degraded";
    Object.assign(runtime, { status: runtimeStatus, hermesVersion: input.runtimeVersion ?? runtime.hermesVersion, boundaryVersion: input.boundaryVersion ?? runtime.boundaryVersion, configRevisionId: input.configRevisionId ?? runtime.configRevisionId, lastHeartbeatAt: input.observedAt, updatedAt: receivedAt });
    Object.assign(agent, { status: input.status === "healthy" ? "active" : initializationStatus, initializationStatus, updatedAt: receivedAt });
    const healthAlert = this.#alerts.find((item) => item.agentId === agent.id && item.code === "runtime.health" && ["open", "acknowledged"].includes(item.status));
    if (["degraded", "unhealthy"].includes(input.status)) {
      const alert = healthAlert ?? { id: randomUUID(), organizationId: input.organizationId, agentId: agent.id, runtimeId: runtime.id, code: "runtime.health", status: "open", firstSeenAt: input.observedAt, createdAt: receivedAt };
      Object.assign(alert, { severity: input.status === "unhealthy" ? "critical" : "medium", title: input.status === "unhealthy" ? "Agent Runtime 不健康" : "Agent Runtime 降级", summary: `Runtime 上报状态：${input.status}`, lastSeenAt: input.observedAt });
      if (!healthAlert) this.#alerts.push(alert);
    } else if (input.status === "healthy") {
      for (const alert of this.#alerts.filter((item) => item.agentId === agent.id && ["runtime.health", "runtime.offline"].includes(item.code) && ["open", "acknowledged"].includes(item.status))) Object.assign(alert, { status: "resolved", resolvedAt: receivedAt });
    }
    for (const component of input.components ?? []) {
      const key = `${runtime.id}:${component.moduleId}`;
      this.#agentComponents.set(key, { id: this.#agentComponents.get(key)?.id ?? randomUUID(), organizationId: input.organizationId, agentId: agent.id, runtimeId: runtime.id, ...component, updatedAt: receivedAt });
    }
    for (const event of input.events ?? []) this.#telemetryEvents.push({ id: randomUUID(), organizationId: input.organizationId, userId: input.userId, agentId: agent.id, runtimeId: runtime.id, ...event, receivedAt });
    if (input.usage) this.#usageRollups.push({
      organizationId: input.organizationId, userId: input.userId, agentId: agent.id, runtimeId: runtime.id,
      ...input.usage,
      inputTokens: Number(input.usage.inputTokens) || 0,
      outputTokens: Number(input.usage.outputTokens) || 0,
      estimatedCostUsd: Number(input.usage.estimatedCostUsd) || 0,
      runCount: Number(input.usage.runCount) || 0,
      failedRunCount: Number(input.usage.failedRunCount) || 0,
      latencySumMs: Number(input.usage.latencySumMs) || 0
    });
    return heartbeat;
  }

  async latestAgentHeartbeats(organizationId) {
    const latest = new Map();
    for (const heartbeat of this.#heartbeats) {
      if (organizationId && heartbeat.organizationId !== organizationId) continue;
      const current = latest.get(heartbeat.runtimeId);
      if (!current || current.receivedAt < heartbeat.receivedAt) latest.set(heartbeat.runtimeId, heartbeat);
    }
    return [...latest.values()];
  }

  async listAgentComponents(organizationId, agentId) {
    return [...this.#agentComponents.values()].filter((item) => (!organizationId || item.organizationId === organizationId) && (!agentId || item.agentId === agentId));
  }

  async saveAgentResourceSamples(input) {
    const saved = [];
    for (const sample of input.samples ?? []) {
      const deployment = this.#controlDeployments.find((item) => item.id === sample.deploymentId && item.serverId === input.serverId && item.agentId === sample.agentId);
      const runtime = this.#agentRuntimes.get(sample.runtimeId);
      const agent = this.#agents.get(sample.agentId);
      const server = this.#servers.find((item) => item.id === input.serverId && item.organizationId === agent?.organizationId);
      if (!deployment || !runtime || !agent || !server || runtime.agentId !== agent.id || runtime.deploymentId !== deployment.id) throw Object.assign(new Error("Resource sample does not belong to this server deployment"), { code: "resource_identity_mismatch", statusCode: 404 });
      const receivedAt = new Date().toISOString();
      const resource = { id: randomUUID(), organizationId: agent.organizationId, userId: agent.ownerUserId, serverId: input.serverId, environment: deployment.environment, ...sample, receivedAt };
      const existing = this.#resourceSamples.findIndex((item) => item.runtimeId === sample.runtimeId && item.sequence === sample.sequence);
      if (existing >= 0) {
        resource.id = this.#resourceSamples[existing].id;
        this.#resourceSamples[existing] = resource;
      } else this.#resourceSamples.push(resource);
      this.#evaluateResourceAlerts(resource);
      saved.push(resource);
    }
    return saved;
  }

  #evaluateResourceAlerts(resource) {
    const checks = [
      ["resource.cpu.high", resource.cpuPercent === null ? null : resource.cpuPercent / Math.max(1, resource.cpuCount ?? 1), 90, "high", "Agent CPU 使用率过高"],
      ["resource.memory.high", resource.memoryLimitBytes > 0 ? resource.memoryUsedBytes / resource.memoryLimitBytes * 100 : null, 90, "high", "Agent 内存使用率过高"],
      ["resource.storage.high", resource.hostStorageLimitBytes > 0 ? resource.hostStorageUsedBytes / resource.hostStorageLimitBytes * 100 : null, 90, "critical", "Agent 主机存储使用率过高"]
    ];
    for (const [code, value, threshold, severity, title] of checks) {
      const active = this.#alerts.find((item) => item.agentId === resource.agentId && item.code === code && ["open", "acknowledged"].includes(item.status));
      if (Number.isFinite(value) && value >= threshold) {
        const alert = active ?? { id: randomUUID(), organizationId: resource.organizationId, agentId: resource.agentId, runtimeId: resource.runtimeId, code, status: "open", firstSeenAt: resource.observedAt, createdAt: resource.receivedAt };
        Object.assign(alert, { severity, title, summary: `当前使用率 ${value.toFixed(1)}%，阈值 ${threshold}%`, lastSeenAt: resource.observedAt });
        if (!active) this.#alerts.push(alert);
      } else if (active) Object.assign(active, { status: "resolved", resolvedAt: resource.receivedAt });
    }
  }

  async latestAgentResourceSamples(organizationId, agentId) {
    const latest = new Map();
    for (const sample of this.#resourceSamples) {
      if ((organizationId && sample.organizationId !== organizationId) || (agentId && sample.agentId !== agentId)) continue;
      const current = latest.get(sample.runtimeId);
      if (!current || current.observedAt < sample.observedAt) latest.set(sample.runtimeId, sample);
    }
    return [...latest.values()].sort((left, right) => right.observedAt.localeCompare(left.observedAt));
  }

  async listAgentResourceSamples(organizationId, agentId, limit = 288) {
    return this.#resourceSamples
      .filter((item) => (!organizationId || item.organizationId === organizationId) && (!agentId || item.agentId === agentId))
      .toSorted((left, right) => right.observedAt.localeCompare(left.observedAt))
      .slice(0, Math.max(1, Math.min(Number(limit) || 288, 2000)));
  }

  async listAlerts(organizationId) {
    return this.#alerts.filter((item) => !organizationId || item.organizationId === organizationId);
  }

  async updateAlertStatus(input) {
    const alert = this.#alerts.find((item) => item.id === input.alertId);
    if (!alert) return null;
    alert.status = input.status;
    if (input.status === "acknowledged") alert.acknowledgedBy = input.actorUserId;
    if (["resolved", "closed"].includes(input.status)) alert.resolvedAt = new Date().toISOString();
    return alert;
  }

  async evaluateOfflineAlerts({ organizationId, staleAfterMs = 120_000 } = {}) {
    const cutoff = Date.now() - staleAfterMs;
    const results = [];
    for (const runtime of this.#agentRuntimes.values()) {
      if (organizationId && runtime.organizationId !== organizationId) continue;
      const agent = this.#agents.get(runtime.agentId);
      const existing = this.#alerts.find((item) => item.agentId === runtime.agentId && item.code === "runtime.offline" && ["open", "acknowledged"].includes(item.status));
      if (!agent || agent.desiredRuntimeState !== "running" || ["uninitialized", "stopped", "suspended", "deleting", "deleted"].includes(runtime.status)) {
        if (existing) Object.assign(existing, { status: "resolved", resolvedAt: new Date().toISOString() });
        continue;
      }
      const stale = !runtime.lastHeartbeatAt || Date.parse(runtime.lastHeartbeatAt) < cutoff;
      if (stale) {
        const alert = existing ?? { id: randomUUID(), organizationId: runtime.organizationId, agentId: runtime.agentId, runtimeId: runtime.id, code: "runtime.offline", severity: "high", status: "open", title: "Agent Runtime 离线", firstSeenAt: new Date().toISOString(), createdAt: new Date().toISOString() };
        Object.assign(alert, { summary: `超过 ${Math.round(staleAfterMs / 1000)} 秒未收到心跳`, lastSeenAt: new Date().toISOString() });
        if (!existing) this.#alerts.push(alert);
        results.push(alert);
      } else if (existing) Object.assign(existing, { status: "resolved", resolvedAt: new Date().toISOString() });
    }
    return results;
  }

  async listUsageRollups(organizationId, userId, agentId, limit = 1000) {
    return this.#usageRollups
      .filter((item) => (!organizationId || item.organizationId === organizationId) && (!userId || item.userId === userId) && (!agentId || item.agentId === agentId))
      .toReversed()
      .slice(0, Math.max(1, Math.min(Number(limit) || 1000, 5000)));
  }

  async requestAgentProvisioning(input) {
    const agent = this.#agents.get(input.agentId);
    const runtime = [...this.#agentRuntimes.values()].find((item) => item.agentId === input.agentId);
    if (!agent || !runtime) return null;
    if (["provisioning", "ready"].includes(agent.initializationStatus)) {
      return { agent, runtime, deployment: this.#controlDeployments.find((item) => item.agentId === agent.id) ?? null, command: this.#controlCommands.findLast((item) => item.agentId === agent.id) ?? null };
    }
    const server = this.#servers.find((item) => item.organizationId === agent.organizationId && ["active", "healthy"].includes(item.status));
    if (!server) throw Object.assign(new Error("No healthy server is available for this Agent"), { code: "no_agent_capacity", statusCode: 409 });
    const revision = this.#configRevisions.filter((item) => item.organizationId === agent.organizationId).length + 1;
    const disabledSkills = (input.skills ?? []).filter((item) => item.enabled === false).map((item) => item.skillId).sort();
    const configDocument = { agent: { id: agent.id, name: agent.name, soul_markdown: agent.soulMarkdown }, runtime: { kind: "hermes", workspace_ref: runtime.workspaceRef }, provider: { provider: input.provider.provider, base_url: input.provider.baseUrl, model: input.provider.model }, skills: { disabled: disabledSkills } };
    const contentHash = createHash("sha256").update(JSON.stringify(configDocument)).digest("hex");
    const config = this.#configRevisions.find((item) => item.organizationId === agent.organizationId && item.contentHash === contentHash)
      ?? { id: randomUUID(), organizationId: agent.organizationId, agentId: agent.id, revision, configDocument, contentHash, createdAt: new Date().toISOString() };
    Object.assign(config, { secretEnvelope: input.secretEnvelope, status: "approved", createdBy: input.requestedBy });
    if (!this.#configRevisions.includes(config)) this.#configRevisions.push(config);
    for (const credential of this.#agentRuntimeCredentials) if (credential.runtimeId === runtime.id && credential.status === "active") credential.status = "revoked";
    this.#agentRuntimeCredentials.push({ id: input.agentCredentialId ?? randomUUID(), organizationId: agent.organizationId, userId: agent.ownerUserId, agentId: agent.id, runtimeId: runtime.id, keyHash: input.agentCredentialHash, keyHint: input.agentCredentialHint, status: "active", createdBy: input.requestedBy, createdAt: new Date().toISOString() });
    const deployment = this.#controlDeployments.find((item) => item.agentId === agent.id)
      ?? { id: randomUUID(), organizationId: agent.organizationId, agentId: agent.id, environment: "production", observedStateVersion: 0, desiredStateVersion: 0, createdAt: new Date().toISOString() };
    Object.assign(deployment, { serverId: server.id, name: agent.name, status: "enrolling", desiredStateVersion: deployment.desiredStateVersion + 1 });
    if (!this.#controlDeployments.includes(deployment)) this.#controlDeployments.push(deployment);
    const command = { id: randomUUID(), deploymentId: deployment.id, agentId: agent.id, action: "deployment.provision", target: { module_id: "bairui.supervisor", instance_id: agent.id }, arguments: { agent_id: agent.id, workspace_ref: runtime.workspaceRef, config_revision_id: config.id }, expectedObservationVersion: 0, state: "queued", priority: 100, attempt: 0, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), createdAt: new Date().toISOString() };
    this.#controlCommands.push(command);
    Object.assign(runtime, { deploymentId: deployment.id, configRevisionId: config.id, status: "provisioning", updatedAt: new Date().toISOString() });
    Object.assign(agent, { initializationStatus: "provisioning", desiredRuntimeState: "running", status: "provisioning", updatedAt: new Date().toISOString() });
    return { agent, runtime, deployment, command };
  }

  async requestAgentSkillConfiguration(input) {
    return this.requestAgentOwnerConfiguration(input, "skills");
  }

  async requestAgentIdentityConfiguration(input) {
    return this.requestAgentOwnerConfiguration(input, "identity");
  }

  async requestAgentOwnerConfiguration(input, scope) {
    if (!["skills", "identity"].includes(scope)) throw new TypeError("Unsupported owner configuration scope");
    const agent = this.#agents.get(input.agentId);
    const runtime = [...this.#agentRuntimes.values()].find((item) => item.agentId === input.agentId);
    if (!agent || !runtime || agent.organizationId !== input.organizationId || agent.ownerUserId !== input.userId) return null;
    if (!runtime.deploymentId || !runtime.configRevisionId) return { revision: null, command: null };
    const current = this.#configRevisions.find((item) => item.id === runtime.configRevisionId && item.agentId === agent.id);
    const deployment = this.#controlDeployments.find((item) => item.id === runtime.deploymentId && item.status !== "revoked");
    if (!current || !deployment) throw Object.assign(new Error("Agent configuration is unavailable"), { code: "agent_configuration_unavailable", statusCode: 409 });
    const revision = this.#configRevisions.filter((item) => item.organizationId === agent.organizationId).length + 1;
    const disabled = this.#agentSkillPreferences.filter((item) => item.agentId === agent.id && item.enabled === false).map((item) => item.skillId).sort();
    const configDocument = { ...current.configDocument, agent: { id: agent.id, name: agent.name, soul_markdown: agent.soulMarkdown }, owner_change: { scope, generation: revision }, skills: { disabled } };
    const config = { id: randomUUID(), organizationId: agent.organizationId, agentId: agent.id, revision, configDocument, secretEnvelope: current.secretEnvelope, contentHash: createHash("sha256").update(JSON.stringify(configDocument)).digest("hex"), status: "approved", createdBy: input.requestedBy, createdAt: new Date().toISOString() };
    this.#configRevisions.push(config);
    for (const command of this.#controlCommands.filter((item) => item.agentId === agent.id && item.action === "config.apply-user" && item.state === "queued" && this.#configRevisions.find((revisionItem) => revisionItem.id === item.arguments.config_revision_id)?.configDocument?.owner_change?.scope === scope)) {
      command.state = "cancelled";
      const previous = this.#configRevisions.find((item) => item.id === command.arguments.config_revision_id);
      if (previous) previous.status = "superseded";
    }
    const command = { id: randomUUID(), organizationId: agent.organizationId, deploymentId: deployment.id, agentId: agent.id, idempotencyKey: `${deployment.id}/config.apply-user/${config.id}`, action: "config.apply-user", target: { module_id: "bairui.supervisor", instance_id: agent.id }, arguments: { config_revision_id: config.id }, approvalId: null, expectedObservationVersion: deployment.observedStateVersion ?? 0, state: "queued", priority: 200, attempt: 0, requestedBy: input.requestedBy, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), createdAt: new Date().toISOString() };
    this.#controlCommands.push(command);
    return { revision: config, command };
  }

  async requestAgentLifecycle(input) {
    const actionByRequest = { pause: "deployment.suspend", resume: "deployment.resume", delete: "deployment.delete" };
    const action = actionByRequest[input.request];
    if (!action) throw new TypeError("Unsupported Agent lifecycle request");
    const agent = this.#agents.get(input.agentId);
    const runtime = [...this.#agentRuntimes.values()].find((item) => item.agentId === input.agentId);
    if (!agent || !runtime) return null;
    if (!runtime.deploymentId) {
      if (input.request !== "delete") throw Object.assign(new Error("Agent has not been initialized"), { code: "agent_not_initialized", statusCode: 409 });
      this.#agents.delete(agent.id);
      this.#agentRuntimes.delete(runtime.id);
      return { agentId: agent.id, action, state: "succeeded", deleted: true, command: null };
    }
    if (input.request === "pause" && runtime.status === "suspended") return { agentId: agent.id, action, state: "succeeded", deleted: false, command: null };
    if (input.request === "resume" && runtime.status !== "suspended") throw Object.assign(new Error("Agent is not suspended"), { code: "invalid_agent_lifecycle_state", statusCode: 409 });
    const lifecycleActions = new Set(["deployment.start", "deployment.stop", "deployment.suspend", "deployment.resume", "deployment.delete"]);
    const existing = this.#controlCommands.findLast((item) => item.deploymentId === runtime.deploymentId && lifecycleActions.has(item.action) && ["queued", "leased", "accepted", "running"].includes(item.state));
    if (existing && existing.action !== action) throw Object.assign(new Error("Another Agent lifecycle command is in progress"), { code: "agent_lifecycle_in_progress", statusCode: 409 });
    if (existing) return { agentId: agent.id, action, state: existing.state, deleted: false, command: { id: existing.id, action, state: existing.state } };
    const approvalId = input.request === "delete" ? randomUUID() : null;
    const command = { id: randomUUID(), deploymentId: runtime.deploymentId, agentId: agent.id, action, target: { module_id: "bairui.supervisor", instance_id: agent.id }, arguments: { agent_id: agent.id }, approvalId, expectedObservationVersion: 0, state: "queued", priority: 100, attempt: 0, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), createdAt: new Date().toISOString() };
    this.#controlCommands.push(command);
    if (approvalId) this.#controlApprovals.push({ id: approvalId, organizationId: agent.organizationId, commandId: command.id, action, riskLevel: "high", requestedBy: input.requestedBy, decidedBy: input.requestedBy, decision: "approved", reason: input.reason ?? "Agent owner confirmed deletion", expiresAt: command.expiresAt, decidedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
    agent.desiredRuntimeState = input.request === "pause" ? "suspended" : input.request === "resume" ? "running" : "deleted";
    if (input.request === "delete") { agent.initializationStatus = "deleting"; runtime.status = "deleting"; }
    agent.updatedAt = new Date().toISOString();
    return { agentId: agent.id, action, state: "queued", deleted: false, command: { id: command.id, action, state: "queued", approvalId } };
  }

  async requestControlOperation(input) {
    const deployment = this.#controlDeployments.findLast((item) => item.agentId === input.agentId && item.organizationId === input.organizationId && item.status !== "revoked");
    if (!deployment) throw Object.assign(new Error("Agent deployment is unavailable"), { code: "agent_deployment_unavailable", statusCode: 409 });
    if (["config.stage", "config.apply", "config.apply-user"].includes(input.action) && !this.#configRevisions.some((item) => item.id === input.arguments.config_revision_id && item.organizationId === input.organizationId && item.agentId === input.agentId)) throw Object.assign(new Error("Configuration revision does not belong to this Agent"), { code: "invalid_control_reference", statusCode: 400 });
    if (input.action === "backup.verify" && !this.#backupRecords.some((item) => item.id === input.arguments.backup_id && item.deploymentId === deployment.id)) throw Object.assign(new Error("Backup does not belong to this Agent"), { code: "invalid_control_reference", statusCode: 400 });
    if (input.action === "backup.restore" && !this.#backupRecords.some((item) => item.id === input.arguments.backup_id && item.deploymentId === deployment.id && item.status === "verified")) throw Object.assign(new Error("Verified backup is unavailable for this Agent"), { code: "invalid_control_reference", statusCode: 400 });
    if (["release.stage", "release.apply"].includes(input.action) && !this.#releaseManifests.some((item) => item.id === input.arguments.release_id && ["candidate", "approved", "released"].includes(item.status))) throw Object.assign(new Error("Release manifest is unavailable"), { code: "invalid_control_reference", statusCode: 400 });
    if (input.action === "release.rollback" && ![input.arguments.release_id, input.arguments.rollback_release_id].every((id) => this.#releaseManifests.some((item) => item.id === id))) throw Object.assign(new Error("Rollback manifests are unavailable"), { code: "invalid_control_reference", statusCode: 400 });
    if (input.action === "upstream.check" && input.arguments.candidate_id && !this.#upstreamCandidates.some((item) => item.id === input.arguments.candidate_id && item.upstreamId === input.arguments.upstream_id)) throw Object.assign(new Error("Upstream candidate is unavailable"), { code: "invalid_control_reference", statusCode: 400 });
    if (input.action === "credential.revoke" && !this.#agentRuntimeCredentials.some((item) => item.id === input.arguments.identity_id && item.agentId === input.agentId && item.status === "active")) throw Object.assign(new Error("Agent credential is unavailable"), { code: "invalid_control_reference", statusCode: 400 });
    const idempotencyKey = input.idempotencyKey ?? `${deployment.id}/${input.action}/${randomUUID()}`;
    const existing = this.#controlCommands.find((item) => item.deploymentId === deployment.id && item.idempotencyKey === idempotencyKey);
    if (existing) return { command: existing, approval: this.#controlApprovals.find((item) => item.commandId === existing.id) ?? null };
    const expiresAt = new Date(Date.now() + Math.max(5 * 60_000, Math.min(input.expiresInMs ?? 30 * 60_000, 24 * 60 * 60_000))).toISOString();
    const approvalId = input.approvalRequired ? input.approvalId ?? randomUUID() : null;
    const command = { id: input.commandId ?? randomUUID(), organizationId: input.organizationId, deploymentId: deployment.id, agentId: input.agentId, idempotencyKey, action: input.action, target: { module_id: "bairui.supervisor", instance_id: input.agentId }, arguments: input.arguments, approvalId, expectedObservationVersion: deployment.observedStateVersion ?? 0, state: "queued", priority: input.priority ?? 100, attempt: 0, requestedBy: input.requestedBy, expiresAt, createdAt: new Date().toISOString() };
    this.#controlCommands.push(command);
    let approval = null;
    if (approvalId) {
      approval = { id: approvalId, organizationId: input.organizationId, commandId: command.id, action: command.action, riskLevel: input.riskLevel ?? "high", requestedBy: input.requestedBy, decidedBy: null, decision: "pending", reason: input.reason ?? "", expiresAt, decidedAt: null, createdAt: new Date().toISOString() };
      this.#controlApprovals.push(approval);
    }
    if (["probe.run", "contract.test", "smoke.test"].includes(input.action) && input.arguments.test_run_id) this.#testRuns.push({ id: input.arguments.test_run_id, deploymentId: deployment.id, suiteId: input.arguments.suite_id ?? input.arguments.probe_ids.join(","), testType: input.action === "probe.run" ? "probe" : input.action === "contract.test" ? "contract" : "smoke", status: "queued", createdAt: new Date().toISOString() });
    if (input.action === "backup.create" && input.arguments.backup_id) {
      const createdAt = new Date().toISOString();
      const backupDays = this.#retentionPolicies.get(input.organizationId)?.backupDays ?? DEFAULT_RETENTION.backupDays;
      this.#backupRecords.push({ id: input.arguments.backup_id, deploymentId: deployment.id, policyId: input.arguments.backup_policy_id, backupType: "runtime-files", status: "creating", encrypted: true, createdAt, expiresAt: new Date(Date.parse(createdAt) + backupDays * 24 * 60 * 60_000).toISOString() });
    }
    if (input.action === "backup.restore") this.#backupRestoreRuns.push({ id: input.arguments.restore_id, backupId: input.arguments.backup_id, deploymentId: deployment.id, commandId: command.id, status: "requested", requestedBy: input.requestedBy, reason: input.reason, evidenceRefs: [], errorCode: null, errorSummary: null, startedAt: null, completedAt: null, createdAt: new Date().toISOString() });
    return { command, approval };
  }

  async listControlCommands(organizationId, limit = 500) {
    return this.#controlCommands.filter((item) => !organizationId || item.organizationId === organizationId).toReversed().slice(0, Math.max(1, Math.min(Number(limit) || 500, 2000)));
  }

  async listControlApprovals(organizationId, limit = 500) {
    return this.#controlApprovals.filter((item) => !organizationId || item.organizationId === organizationId).toReversed().slice(0, Math.max(1, Math.min(Number(limit) || 500, 2000)));
  }

  async decideControlApproval(input) {
    const approval = this.#controlApprovals.find((item) => item.id === input.approvalId && (!input.organizationId || item.organizationId === input.organizationId));
    if (!approval) return null;
    if (approval.decision !== "pending" || Date.parse(approval.expiresAt) <= Date.now()) throw Object.assign(new Error("Approval is no longer pending"), { code: "approval_not_pending", statusCode: 409 });
    Object.assign(approval, { decision: input.decision, decidedBy: input.decidedBy, reason: input.reason, decidedAt: new Date().toISOString() });
    if (input.decision === "rejected") {
      const command = this.#controlCommands.find((item) => item.id === approval.commandId);
      if (command?.state === "queued") command.state = "cancelled";
      if (command?.action === "backup.restore") {
        const restore = this.#backupRestoreRuns.find((item) => item.commandId === command.id);
        if (restore) Object.assign(restore, { status: "cancelled", errorCode: "approval_rejected", errorSummary: "Backup restore approval was rejected", completedAt: new Date().toISOString() });
      }
    }
    return approval;
  }

  async createReleaseManifest(input) {
    const manifest = { id: input.id ?? randomUUID(), releaseId: input.releaseId ?? null, version: input.version, agentCommit: input.agentCommit, imageDigest: input.imageDigest, sbomUri: input.sbomUri, provenanceUri: input.provenanceUri, signature: input.signature, migrationVersion: input.migrationVersion ?? null, compatibility: input.compatibility, status: input.status ?? "candidate", createdBy: input.createdBy, createdAt: new Date().toISOString() };
    this.#releaseManifests.push(manifest);
    return manifest;
  }

  async listReleaseManifests() {
    return this.#releaseManifests.toReversed();
  }

  async createServerCredential(input) {
    for (const credential of this.#serverCredentials) if (credential.serverId === input.serverId && credential.status === "active") credential.status = "revoked";
    const credential = { id: input.id ?? randomUUID(), serverId: input.serverId, keyHash: input.keyHash, keyHint: input.keyHint, status: "active", createdBy: input.createdBy ?? null, createdAt: new Date().toISOString() };
    this.#serverCredentials.push(credential);
    return credential;
  }

  async getActiveServerCredential(serverId) {
    return this.#serverCredentials.findLast((item) => item.serverId === serverId && item.status === "active") ?? null;
  }

  async getActiveAgentRuntimeCredential(agentId) {
    return this.#agentRuntimeCredentials.findLast((item) => item.agentId === agentId && item.status === "active") ?? null;
  }

  async createChannelWorkerCredential(input) {
    const current = this.#channelWorkerCredentials.findLast((item) => item.workerId === input.workerId && item.status === "active");
    if (current?.keyHash === input.keyHash && current.organizationId === (input.organizationId ?? null)) return current;
    if (current) Object.assign(current, { status: "revoked", revokedAt: new Date().toISOString() });
    const credential = { id: input.id ?? randomUUID(), workerId: input.workerId, organizationId: input.organizationId ?? null, allowedChannels: input.allowedChannels ?? ["feishu", "wechat", "qq"], keyHash: input.keyHash, keyHint: input.keyHint, status: "active", createdBy: input.createdBy ?? null, expiresAt: input.expiresAt ?? null, createdAt: new Date().toISOString() };
    this.#channelWorkerCredentials.push(credential);
    return credential;
  }

  async getActiveChannelWorkerCredential(workerId) {
    return this.#channelWorkerCredentials.findLast((item) => item.workerId === workerId && item.status === "active" && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now())) ?? null;
  }

  async listChannelBindingsForWorker(input) {
    const channels = new Set(input.channels.filter((channel) => input.allowedChannels.includes(channel)));
    return this.#agentChannelBindings.filter((item) => channels.has(item.channel) && item.credentialEnvelope && !["disabled", "unconfigured", "unavailable"].includes(item.status) && (!input.organizationId || item.organizationId === input.organizationId));
  }

  async claimMachineNonce(input) {
    const key = `${input.credentialType}:${input.credentialId}:${input.nonce}`;
    if (this.#machineNonces.has(key)) return false;
    this.#machineNonces.add(key);
    return true;
  }

  async leaseControlCommands(input) {
    const now = Date.now();
    const deployments = new Map(this.#controlDeployments.filter((item) => item.serverId === input.serverId).map((item) => [item.id, item]));
    const leased = [];
    for (const command of this.#controlCommands.sort((left, right) => left.priority - right.priority || left.createdAt.localeCompare(right.createdAt))) {
      if (leased.length >= (input.limit ?? 10) || !deployments.has(command.deploymentId)) continue;
      if (["leased", "accepted", "running"].includes(command.state) && Date.parse(command.leaseExpiresAt) <= now) command.state = "queued";
      if (command.state === "queued" && Date.parse(command.expiresAt) <= now) {
        command.state = "expired";
        if (command.action === "backup.restore") {
          const restore = this.#backupRestoreRuns.find((item) => item.commandId === command.id && item.status === "requested");
          if (restore) Object.assign(restore, { status: "cancelled", errorCode: "command_expired", errorSummary: "Backup restore command expired", completedAt: new Date().toISOString() });
        }
        if (command.action === "backup.expire") {
          const backup = this.#backupRecords.find((item) => item.id === command.arguments.backup_id && item.status === "expiring");
          if (backup) backup.status = "failed";
        }
      }
      if (command.state !== "queued") continue;
      if (command.approvalId) {
        const approval = this.#controlApprovals.find((item) => item.id === command.approvalId && item.commandId === command.id);
        if (!approval || approval.decision !== "approved" || Date.parse(approval.expiresAt) <= now) continue;
      }
      command.state = "leased";
      command.leaseServerId = input.serverId;
      command.leaseExpiresAt = new Date(now + (input.leaseSeconds ?? 60) * 1000).toISOString();
      command.attempt += 1;
      const deployment = deployments.get(command.deploymentId);
      const runtime = [...this.#agentRuntimes.values()].find((item) => item.agentId === deployment.agentId);
      const config = this.#configRevisions.find((item) => item.id === command.arguments.config_revision_id);
      const release = this.#releaseManifests.find((item) => item.id === command.arguments.release_id);
      const rollback = this.#releaseManifests.find((item) => item.id === command.arguments.rollback_release_id);
      leased.push({
        schema_version: "1.0", command_id: command.id, idempotency_key: command.idempotencyKey ?? `${command.deploymentId}/${command.action}/${command.arguments.config_revision_id ?? command.id}`,
        deployment_id: command.deploymentId, action: command.action, target: command.target, arguments: command.arguments,
        ...(command.approvalId ? { approval_id: command.approvalId } : {}),
        expected_observation_version: command.expectedObservationVersion, created_at: command.createdAt, expires_at: command.expiresAt,
        attempt: command.attempt, lease_expires_at: command.leaseExpiresAt,
        placement: { server_id: deployment.serverId, agent_id: deployment.agentId, runtime_id: runtime.id, organization_id: deployment.organizationId, user_id: runtime.ownerUserId, workspace_ref: runtime.workspaceRef },
        config: config ? { document: config.configDocument, ...(command.action === "config.apply-user" ? {} : { secret_envelope: config.secretEnvelope }) } : null,
        ...(release ? { release: { id: release.id, version: release.version, hermes_image: release.compatibility?.hermes_image, runtime_image: release.compatibility?.runtime_image } } : {}),
        ...(rollback ? { rollback_release: { id: rollback.id, version: rollback.version, hermes_image: rollback.compatibility?.hermes_image, runtime_image: rollback.compatibility?.runtime_image } } : {})
      });
    }
    return leased;
  }

  async recordCommandReceipt(input) {
    const command = this.#controlCommands.find((item) => item.id === input.commandId);
    if (!command || command.leaseServerId !== input.serverId || command.attempt !== input.attempt) return null;
    const duplicate = this.#commandReceipts.find((item) => item.commandId === input.commandId && item.attempt === input.attempt && item.state === input.state);
    if (duplicate) return duplicate;
    const receipt = { id: randomUUID(), ...input, deploymentId: command.deploymentId, createdAt: new Date().toISOString() };
    this.#commandReceipts.push(receipt);
    command.state = input.state;
    if (input.state === "running") command.leaseExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    if (input.state === "succeeded" && command.action === "deployment.provision") {
      const deployment = this.#controlDeployments.find((item) => item.id === command.deploymentId);
      const runtime = [...this.#agentRuntimes.values()].find((item) => item.agentId === deployment.agentId);
      Object.assign(runtime, { endpointRef: input.runtimeEndpointRef, status: "starting", updatedAt: new Date().toISOString() });
      deployment.status = "active";
      const config = this.#configRevisions.find((item) => item.id === command.arguments.config_revision_id);
      if (config) config.status = "applied";
      const disabled = new Set(config?.configDocument?.skills?.disabled ?? []);
      for (const preference of this.#agentSkillPreferences.filter((item) => item.agentId === deployment.agentId && item.enabled === !disabled.has(item.skillId))) Object.assign(preference, { applyStatus: "applied", lastErrorCode: null, updatedAt: new Date().toISOString() });
    }
    if (input.state === "succeeded" && ["deployment.start", "deployment.resume"].includes(command.action)) {
      const deployment = this.#controlDeployments.find((item) => item.id === command.deploymentId);
      const runtime = [...this.#agentRuntimes.values()].find((item) => item.agentId === deployment.agentId);
      const agent = this.#agents.get(deployment.agentId);
      Object.assign(runtime, { status: "starting", lastErrorCode: null, lastErrorDetail: null, updatedAt: new Date().toISOString() });
      Object.assign(agent, { status: "starting", desiredRuntimeState: "running", lastErrorCode: null, lastErrorDetail: null, updatedAt: new Date().toISOString() });
    }
    if (input.state === "succeeded" && command.action === "deployment.suspend") {
      const deployment = this.#controlDeployments.find((item) => item.id === command.deploymentId);
      const runtime = [...this.#agentRuntimes.values()].find((item) => item.agentId === deployment.agentId);
      const agent = this.#agents.get(deployment.agentId);
      Object.assign(runtime, { status: "suspended", updatedAt: new Date().toISOString() });
      Object.assign(agent, { status: "suspended", desiredRuntimeState: "suspended", updatedAt: new Date().toISOString() });
    }
    if (input.state === "succeeded" && command.action === "deployment.delete") {
      const deployment = this.#controlDeployments.find((item) => item.id === command.deploymentId);
      const runtime = [...this.#agentRuntimes.values()].find((item) => item.agentId === deployment.agentId);
      const agent = this.#agents.get(deployment.agentId);
      Object.assign(runtime, { status: "deleted", endpointRef: null, updatedAt: new Date().toISOString() });
      Object.assign(agent, { status: "deleted", desiredRuntimeState: "deleted", updatedAt: new Date().toISOString() });
      deployment.status = "revoked";
    }
    if (input.state === "failed" && command.action === "deployment.provision") {
      const deployment = this.#controlDeployments.find((item) => item.id === command.deploymentId);
      const runtime = [...this.#agentRuntimes.values()].find((item) => item.agentId === deployment.agentId);
      const agent = this.#agents.get(deployment.agentId);
      Object.assign(runtime, { status: "failed", lastErrorCode: input.errorCode, lastErrorDetail: input.errorSummary });
      Object.assign(agent, { status: "failed", initializationStatus: "failed", lastErrorCode: input.errorCode, lastErrorDetail: input.errorSummary });
      deployment.status = "degraded";
    }
    if (input.state === "failed" && ["deployment.start", "deployment.stop", "deployment.suspend", "deployment.resume", "deployment.delete", "config.apply", "release.apply", "release.rollback", "service.restart", "credential.revoke"].includes(command.action)) {
      const deployment = this.#controlDeployments.find((item) => item.id === command.deploymentId);
      const runtime = [...this.#agentRuntimes.values()].find((item) => item.agentId === deployment.agentId);
      const agent = this.#agents.get(deployment.agentId);
      Object.assign(runtime, { ...(command.action === "deployment.delete" ? { status: "degraded" } : {}), lastErrorCode: input.errorCode, lastErrorDetail: input.errorSummary, updatedAt: new Date().toISOString() });
      Object.assign(agent, { status: "degraded", ...(command.action === "deployment.delete" ? { initializationStatus: "failed" } : {}), lastErrorCode: input.errorCode, lastErrorDetail: input.errorSummary, updatedAt: new Date().toISOString() });
      deployment.status = "degraded";
    }
    if (["config.stage", "config.apply", "config.apply-user"].includes(command.action)) {
      const config = this.#configRevisions.find((item) => item.id === command.arguments.config_revision_id);
      if (config && input.state === "running" && ["config.apply", "config.apply-user"].includes(command.action)) config.status = "applying";
      if (config && input.state === "succeeded") config.status = command.action === "config.stage" ? "staged" : "applied";
      if (config && input.state === "failed") config.status = "failed";
      if (config && input.state === "succeeded" && ["config.apply", "config.apply-user"].includes(command.action)) {
        const deployment = this.#controlDeployments.find((item) => item.id === command.deploymentId);
        const runtime = [...this.#agentRuntimes.values()].find((item) => item.agentId === deployment.agentId);
        runtime.configRevisionId = config.id;
      }
      if (config && command.action === "config.apply-user" && config.configDocument?.owner_change?.scope === "skills" && ["succeeded", "failed"].includes(input.state)) {
        const disabled = new Set(config.configDocument?.skills?.disabled ?? []);
        for (const preference of this.#agentSkillPreferences.filter((item) => item.agentId === config.agentId && item.enabled === !disabled.has(item.skillId))) {
          Object.assign(preference, { applyStatus: input.state === "succeeded" ? "applied" : "failed", lastErrorCode: input.state === "failed" ? input.errorCode ?? "config_apply_failed" : null, updatedAt: new Date().toISOString() });
        }
      }
    }
    if (input.state === "succeeded" && ["deployment.provision", "config.apply"].includes(command.action)) {
      const config = this.#configRevisions.find((item) => item.id === command.arguments.config_revision_id);
      const provider = config?.configDocument?.provider;
      const legacy = config ? this.#providerConfigurations.get(config.organizationId) : null;
      if (legacy && legacy.provider === provider?.provider && legacy.baseUrl === provider?.base_url && legacy.model === provider?.model) legacy.applyStatus = "applied";
      for (const channel of this.#providerChannels.filter((item) => item.organizationId === config?.organizationId && item.provider === provider?.provider && item.baseUrl === provider?.base_url && item.model === provider?.model)) Object.assign(channel, { status: "applied", lastErrorCode: null, updatedAt: new Date().toISOString() });
    }
    if (input.state === "failed" && command.action === "config.apply") {
      const config = this.#configRevisions.find((item) => item.id === command.arguments.config_revision_id);
      const legacy = config ? this.#providerConfigurations.get(config.organizationId) : null;
      if (legacy) legacy.applyStatus = "failed";
    }
    if (["probe.run", "contract.test", "smoke.test"].includes(command.action) && command.arguments.test_run_id) {
      const run = this.#testRuns.find((item) => item.id === command.arguments.test_run_id);
      if (run && input.state === "running") Object.assign(run, { status: "running", startedAt: run.startedAt ?? new Date().toISOString() });
      if (run && input.state === "succeeded") Object.assign(run, { status: "passed", completedAt: new Date().toISOString() });
      if (run && input.state === "failed") Object.assign(run, { status: "failed", completedAt: new Date().toISOString() });
    }
    if (["backup.create", "backup.verify"].includes(command.action)) {
      const backup = this.#backupRecords.find((item) => item.id === command.arguments.backup_id);
      if (backup && input.state === "running" && command.action === "backup.verify") backup.status = "verifying";
      if (backup && input.state === "succeeded" && command.action === "backup.create") Object.assign(backup, { status: "created", storageUri: `bairui-backup://${input.serverId}/${backup.id}`, sha256: input.evidenceRefs?.find((item) => item.startsWith("sha256:"))?.slice(7) ?? null, sizeBytes: input.resultSummary?.bytes ?? null });
      if (backup && input.state === "succeeded" && command.action === "backup.verify") Object.assign(backup, { status: "verified", verifiedAt: new Date().toISOString() });
      if (backup && input.state === "failed") backup.status = "failed";
    }
    if (command.action === "backup.restore") {
      const restore = this.#backupRestoreRuns.find((item) => item.id === command.arguments.restore_id && item.commandId === command.id);
      if (restore && input.state === "running") Object.assign(restore, { status: "running", startedAt: restore.startedAt ?? new Date().toISOString() });
      if (restore && input.state === "succeeded") Object.assign(restore, { status: "succeeded", evidenceRefs: input.evidenceRefs ?? [], completedAt: new Date().toISOString() });
      if (restore && input.state === "failed") Object.assign(restore, { status: "failed", errorCode: input.errorCode ?? "restore_failed", errorSummary: input.errorSummary ?? "Backup restore failed", completedAt: new Date().toISOString() });
      if (restore && input.state === "cancelled") Object.assign(restore, { status: "cancelled", errorCode: input.errorCode ?? "restore_cancelled", errorSummary: input.errorSummary ?? "Backup restore was cancelled", completedAt: new Date().toISOString() });
    }
    if (command.action === "backup.expire") {
      const backup = this.#backupRecords.find((item) => item.id === command.arguments.backup_id);
      if (backup && input.state === "succeeded") Object.assign(backup, { status: "expired", storageUri: null, expiredAt: new Date().toISOString() });
      if (backup && input.state === "failed") backup.status = "failed";
    }
    if (["release.stage", "release.apply", "release.rollback"].includes(command.action)) {
      const current = this.#releaseManifests.find((item) => item.id === command.arguments.release_id);
      const rollback = this.#releaseManifests.find((item) => item.id === command.arguments.rollback_release_id);
      if (current && command.action === "release.stage" && input.state === "succeeded") current.status = "approved";
      if (current && command.action === "release.apply" && input.state === "running") current.status = "rolling_out";
      if (current && command.action === "release.apply" && input.state === "succeeded") current.status = "released";
      if (current && command.action === "release.rollback" && input.state === "succeeded") current.status = "withdrawn";
      if (rollback && command.action === "release.rollback" && input.state === "succeeded") rollback.status = "released";
      if (current && input.state === "failed") current.status = "blocked";
    }
    if (command.action === "upstream.check" && command.arguments.candidate_id && ["succeeded", "failed"].includes(input.state)) {
      const candidate = this.#upstreamCandidates.find((item) => item.id === command.arguments.candidate_id);
      if (candidate) candidate.status = input.state === "succeeded" ? "compatible" : "incompatible";
    }
    return receipt;
  }

  async getAgentRuntimeRoute(agentId) {
    const runtime = [...this.#agentRuntimes.values()].find((item) => item.agentId === agentId);
    const config = runtime?.configRevisionId ? this.#configRevisions.find((item) => item.id === runtime.configRevisionId) : null;
    return runtime && config ? { runtime, configDocument: config.configDocument, secretEnvelope: config.secretEnvelope } : null;
  }

  async createConversation(input) {
    const now = new Date().toISOString();
    const conversation = { id: input.id ?? randomUUID(), organizationId: input.organizationId, userId: input.userId, agentId: input.agentId, title: input.title ?? "New conversation", createdAt: now, updatedAt: now };
    this.#conversations.set(conversation.id, conversation);
    this.#messages.set(conversation.id, []);
    return conversation;
  }

  async listConversations(organizationId, userId) {
    return [...this.#conversations.values()].filter((item) => item.organizationId === organizationId && item.userId === userId);
  }

  async getConversation(id) {
    return this.#conversations.get(id) ?? null;
  }

  async appendMessage(input) {
    const message = { id: input.id ?? randomUUID(), conversationId: input.conversationId, organizationId: input.organizationId, userId: input.userId, role: input.role, content: input.content, createdAt: new Date().toISOString() };
    const messages = this.#messages.get(input.conversationId) ?? [];
    messages.push(message);
    this.#messages.set(input.conversationId, messages);
    return message;
  }

  async listMessages(conversationId) {
    return [...(this.#messages.get(conversationId) ?? [])];
  }

  async saveControlPlaneSnapshot(input) {
    const snapshot = { id: input.id ?? randomUUID(), organizationId: input.organizationId, serverId: input.serverId, status: input.status, payload: input.payload, receivedAt: new Date().toISOString() };
    this.#snapshots.push(snapshot);
    return snapshot;
  }

  async latestControlPlaneSnapshots(organizationId) {
    return this.#snapshots.filter((item) => !organizationId || item.organizationId === organizationId);
  }

  async recordAudit(input) {
    const event = { id: input.id ?? randomUUID(), organizationId: input.organizationId, actorUserId: input.actorUserId ?? null, action: input.action, targetType: input.targetType, targetId: input.targetId ?? null, metadata: input.metadata ?? {}, createdAt: new Date().toISOString() };
    this.#audit.push(event);
    return event;
  }

  async listAudit(organizationId) {
    return this.#audit.filter((event) => !organizationId || event.organizationId === organizationId).toReversed();
  }

  async createLicense(input) {
    const license = { id: input.id, organizationId: input.organizationId, plan: input.plan, status: input.status ?? "active", document: input.document, issuedAt: input.issuedAt, expiresAt: input.expiresAt, createdAt: new Date().toISOString() };
    this.#licenses.push(license);
    return license;
  }

  async listLicenses(organizationId) {
    return this.#licenses.filter((item) => !organizationId || item.organizationId === organizationId);
  }

  async createServer(input) {
    const server = { id: input.id ?? randomUUID(), organizationId: input.organizationId, name: input.name, status: input.status ?? "pending", runtimeVersion: null, lastSeenAt: null, createdAt: new Date().toISOString() };
    this.#servers.push(server);
    return server;
  }

  async listServers(organizationId) {
    return this.#servers.filter((item) => !organizationId || item.organizationId === organizationId);
  }

  async recordServerHeartbeat(input) {
    let server = this.#servers.find((item) => item.id === input.id);
    if (!server) {
      server = { id: input.id, organizationId: input.organizationId, name: input.name ?? input.id, createdAt: new Date().toISOString() };
      this.#servers.push(server);
    }
    Object.assign(server, { status: input.status, runtimeVersion: input.runtimeVersion ?? null, lastSeenAt: new Date().toISOString() });
    return server;
  }

  async createRelease(input) {
    const release = { id: input.id ?? randomUUID(), version: input.version, agentCommit: input.agentCommit, status: input.status ?? "draft", notes: input.notes ?? "", createdAt: new Date().toISOString() };
    this.#releases.push(release);
    return release;
  }

  async listReleases() {
    return [...this.#releases];
  }

  async getProviderConfiguration(organizationId) {
    return this.#providerConfigurations.get(organizationId) ?? null;
  }

  async upsertProviderConfiguration(input) {
    const previous = this.#providerConfigurations.get(input.organizationId);
    const configuration = {
      organizationId: input.organizationId,
      provider: input.provider,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKeyEnvelope: input.apiKeyEnvelope ?? previous?.apiKeyEnvelope ?? null,
      keyHint: input.keyHint ?? previous?.keyHint ?? null,
      applyStatus: "pending",
      updatedBy: input.updatedBy,
      updatedAt: new Date().toISOString()
    };
    this.#providerConfigurations.set(input.organizationId, configuration);
    return configuration;
  }

  async saveIntegrationResult(input) {
    const run = { id: input.id ?? randomUUID(), organizationId: input.organizationId, integrationId: input.integrationId, capability: input.capability, status: input.status, summary: input.summary ?? {}, startedAt: input.startedAt, completedAt: input.completedAt ?? new Date().toISOString(), createdAt: new Date().toISOString() };
    this.#integrationRuns.push(run);
    this.#hotspots.set(run.id, (input.items ?? []).map((item) => ({ id: randomUUID(), runId: run.id, externalId: item.external_id, sourceId: item.source_id, sourceName: item.source_name, rank: Number(item.rank) || 0, title: item.title, url: item.url ?? "", mobileUrl: item.mobile_url ?? "", heat: item.heat ?? "", category: item.category ?? "", fetchedAt: item.fetched_at })));
    return run;
  }

  async listIntegrationRuns(organizationId, limit = 20) {
    return this.#integrationRuns.filter((item) => !organizationId || item.organizationId === organizationId).toReversed().slice(0, limit);
  }

  async listLatestHotspots(organizationId) {
    const run = this.#integrationRuns.findLast((item) => item.organizationId === organizationId && item.integrationId === "trendradar") ?? null;
    return { run, items: run ? [...(this.#hotspots.get(run.id) ?? [])] : [] };
  }

  async createObsidianNote(input) {
    const normalized = { ...input, memoryKind: input.memoryKind ?? "knowledge", importance: input.importance ?? 3, hermesTarget: input.hermesTarget ?? "auto", sourceRef: input.sourceRef ?? "bairui-user" };
    const duplicate = this.#obsidianNotes.find((item) => item.organizationId === input.organizationId && item.userId === input.userId && item.agentId === input.agentId && item.slug === input.slug);
    const now = new Date().toISOString();
    if (duplicate) {
      Object.assign(duplicate, normalized, { revision: (duplicate.revision ?? 1) + 1, hermesSyncStatus: "pending", updatedAt: now });
      if (input.queueProjection !== false) this.#enqueueMemoryProjection({ ...input, reason: input.projectionReason ?? "note-write" });
      return duplicate;
    }
    const note = { id: input.id ?? randomUUID(), revision: 1, hermesSyncStatus: "pending", hermesSyncedRevision: null, hermesSyncedAt: null, ...normalized, createdAt: now, updatedAt: now };
    this.#obsidianNotes.push(note);
    if (input.queueProjection !== false) this.#enqueueMemoryProjection({ ...input, reason: input.projectionReason ?? "note-write" });
    return note;
  }

  async listObsidianNotes(organizationId, userId, agentId, query = "") {
    const search = String(query ?? "").trim().toLocaleLowerCase();
    return this.#obsidianNotes
      .filter((item) => item.organizationId === organizationId && item.userId === userId && item.agentId === agentId && (!search || item.title.toLocaleLowerCase().includes(search) || item.markdown.toLocaleLowerCase().includes(search)))
      .toReversed();
  }

  async getObsidianNote(organizationId, userId, agentId, noteId) {
    return this.#obsidianNotes.find((item) => item.id === noteId && item.organizationId === organizationId && item.userId === userId && item.agentId === agentId) ?? null;
  }

  async updateObsidianNote(input) {
    const note = await this.getObsidianNote(input.organizationId, input.userId, input.agentId, input.id);
    if (!note) return null;
    Object.assign(note, input, { revision: (note.revision ?? 1) + 1, hermesSyncStatus: "pending", updatedAt: new Date().toISOString() });
    if (input.queueProjection !== false) this.#enqueueMemoryProjection({ ...input, reason: input.projectionReason ?? "note-write" });
    return note;
  }

  async markObsidianProjection(input) {
    const included = new Set(input.includedNoteIds ?? []);
    const conflicts = new Set(input.conflictNoteIds ?? []);
    const now = new Date().toISOString();
    for (const note of this.#obsidianNotes.filter((item) => item.organizationId === input.organizationId && item.userId === input.userId && item.agentId === input.agentId)) {
      if (Number(input.noteRevisions?.[note.id]) !== Number(note.revision)) continue;
      if (conflicts.has(note.id)) note.hermesSyncStatus = "conflict";
      else if (included.has(note.id)) { note.hermesSyncStatus = "materialized"; note.hermesSyncedRevision = note.revision; note.hermesSyncedAt = now; }
      else note.hermesSyncStatus = "excluded";
    }
  }

  async deleteObsidianNote(organizationId, userId, agentId, noteId) {
    const index = this.#obsidianNotes.findIndex((item) => item.id === noteId && item.organizationId === organizationId && item.userId === userId && item.agentId === agentId);
    if (index < 0) return false;
    this.#obsidianNotes.splice(index, 1);
    this.#enqueueMemoryProjection({ organizationId, userId, agentId, reason: "note-delete" });
    return true;
  }

  async markObsidianProjectionFailed(input) {
    if (this.#memoryProjectionOutbox.some((item) => item.agentId === input.agentId && ["pending", "processing", "retry"].includes(item.state))) return;
    for (const note of this.#obsidianNotes.filter((item) => item.organizationId === input.organizationId && item.userId === input.userId && item.agentId === input.agentId && item.hermesSyncStatus === "pending")) note.hermesSyncStatus = "failed";
  }

  async enqueueMemoryProjection(input) {
    return this.#enqueueMemoryProjection(input);
  }

  async getMemoryProjectionStatus(organizationId, userId, agentId) {
    return this.#memoryProjectionOutbox
      .filter((item) => item.organizationId === organizationId && item.userId === userId && item.agentId === agentId)
      .sort((left, right) => Number(["pending", "processing", "retry"].includes(right.state)) - Number(["pending", "processing", "retry"].includes(left.state)) || Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ?? null;
  }

  async listMemoryProjectionJobs(organizationId, limit = 1000) {
    return this.#memoryProjectionOutbox.filter((item) => !organizationId || item.organizationId === organizationId).toReversed().slice(0, Math.max(1, Math.min(5000, Number(limit) || 1000)));
  }

  async leaseMemoryProjectionJobs(input = {}) {
    const now = Date.now();
    for (const expired of this.#memoryProjectionOutbox.filter((item) => item.state === "processing" && Date.parse(item.leaseExpiresAt) <= now)) {
      const newer = this.#memoryProjectionOutbox.some((item) => item.agentId === expired.agentId && item.id !== expired.id && ["pending", "retry"].includes(item.state));
      Object.assign(expired, newer
        ? { state: "completed", resultSummary: { status: "superseded" }, completedAt: new Date(now).toISOString() }
        : { state: "retry", availableAt: new Date(now).toISOString(), completedAt: null },
      { leaseToken: null, leaseExpiresAt: null, updatedAt: new Date(now).toISOString() });
    }
    const limit = Math.max(1, Math.min(20, Number(input.limit) || 1));
    const leaseSeconds = Math.max(15, Math.min(600, Number(input.leaseSeconds) || 60));
    const leased = [];
    const candidates = this.#memoryProjectionOutbox
      .filter((item) => ["pending", "retry"].includes(item.state) && Date.parse(item.availableAt) <= now)
      .sort((left, right) => Date.parse(left.availableAt) - Date.parse(right.availableAt) || Date.parse(left.createdAt) - Date.parse(right.createdAt));
    for (const job of candidates) {
      if (leased.length >= limit) break;
      if (this.#memoryProjectionOutbox.some((item) => item.agentId === job.agentId && item.state === "processing")) continue;
      Object.assign(job, { state: "processing", attempts: job.attempts + 1, leaseToken: randomUUID(), leaseExpiresAt: new Date(now + leaseSeconds * 1000).toISOString(), updatedAt: new Date(now).toISOString() });
      leased.push(job);
    }
    return leased;
  }

  async completeMemoryProjectionJob(input) {
    const job = this.#memoryProjectionOutbox.find((item) => item.id === input.id && item.state === "processing" && item.leaseToken === input.leaseToken);
    if (!job) return null;
    Object.assign(job, { state: "completed", leaseToken: null, leaseExpiresAt: null, lastErrorCode: null, resultSummary: input.resultSummary ?? {}, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return job;
  }

  async retryMemoryProjectionJob(input) {
    const job = this.#memoryProjectionOutbox.find((item) => item.id === input.id && item.state === "processing" && item.leaseToken === input.leaseToken);
    if (!job) return null;
    const newer = this.#memoryProjectionOutbox.some((item) => item.agentId === job.agentId && item.id !== job.id && ["pending", "retry"].includes(item.state));
    const dead = job.attempts >= Math.max(1, Number(input.maxAttempts) || 8);
    const state = newer ? "completed" : dead ? "dead" : "retry";
    const now = Date.now();
    Object.assign(job, { state, leaseToken: null, leaseExpiresAt: null, lastErrorCode: input.errorCode, resultSummary: newer ? { status: "superseded" } : {}, availableAt: state === "retry" ? new Date(now + Math.max(0, Number(input.delayMs) || 0)).toISOString() : job.availableAt, completedAt: ["completed", "dead"].includes(state) ? new Date(now).toISOString() : null, updatedAt: new Date(now).toISOString() });
    return job;
  }

  async listAgentSkillPreferences(organizationId, userId, agentId) {
    return this.#agentSkillPreferences.filter((item) => item.organizationId === organizationId && item.userId === userId && item.agentId === agentId);
  }

  async upsertAgentSkillPreference(input) {
    const existing = this.#agentSkillPreferences.find((item) => item.agentId === input.agentId && item.skillId === input.skillId);
    const value = { ...input, enabled: Boolean(input.enabled), applyStatus: input.applyStatus ?? "pending", lastErrorCode: input.lastErrorCode ?? null, updatedAt: new Date().toISOString() };
    if (existing) {
      Object.assign(existing, value);
      return existing;
    }
    this.#agentSkillPreferences.push(value);
    return value;
  }

  async listAgentChannelBindings(organizationId, userId, agentId) {
    return this.#agentChannelBindings.filter((item) => item.organizationId === organizationId && item.userId === userId && item.agentId === agentId);
  }

  async getAgentChannelBinding(organizationId, userId, agentId, channel) {
    return this.#agentChannelBindings.find((item) => item.organizationId === organizationId && item.userId === userId && item.agentId === agentId && item.channel === channel) ?? null;
  }

  async upsertAgentChannelBinding(input) {
    const existing = this.#agentChannelBindings.find((item) => item.agentId === input.agentId && item.channel === input.channel);
    const now = new Date().toISOString();
    const value = {
      id: existing?.id ?? input.id ?? randomUUID(), organizationId: input.organizationId, userId: input.userId, agentId: input.agentId,
      channel: input.channel, displayName: input.displayName, status: input.status ?? "pending",
      credentialEnvelope: input.credentialEnvelope ?? existing?.credentialEnvelope ?? null,
      credentialHint: input.credentialHint ?? existing?.credentialHint ?? null,
      metadata: input.metadata ?? {}, connectionGeneration: (existing?.connectionGeneration ?? 0) + (input.credentialEnvelope ? 1 : 0), capabilities: input.credentialEnvelope ? [] : (existing?.capabilities ?? []), adapterVersion: input.credentialEnvelope ? null : (existing?.adapterVersion ?? null),
      lastErrorCode: input.lastErrorCode ?? null, lastSeenAt: existing?.lastSeenAt ?? null, lastHealthAt: input.credentialEnvelope ? null : (existing?.lastHealthAt ?? null),
      lastInboundAt: existing?.lastInboundAt ?? null, lastOutboundAt: existing?.lastOutboundAt ?? null,
      createdAt: existing?.createdAt ?? now, updatedAt: now
    };
    if (existing) Object.assign(existing, value);
    else this.#agentChannelBindings.push(value);
    return existing ?? value;
  }

  async deleteAgentChannelBinding(organizationId, userId, agentId, channel) {
    const index = this.#agentChannelBindings.findIndex((item) => item.organizationId === organizationId && item.userId === userId && item.agentId === agentId && item.channel === channel);
    if (index < 0) return false;
    this.#agentChannelBindings.splice(index, 1);
    return true;
  }

  async getChannelBindingById(bindingId) {
    return this.#agentChannelBindings.find((item) => item.id === bindingId) ?? null;
  }

  async acceptChannelIngress(input) {
    const binding = this.#agentChannelBindings.find((item) => item.id === input.bindingId && item.agentId === input.agentId && item.channel === input.channel);
    if (!binding || ["disabled", "unconfigured"].includes(binding.status)) return null;
    const duplicate = this.#channelInbox.find((item) => item.bindingId === binding.id && item.externalMessageId === input.externalMessageId);
    if (duplicate) return { status: "duplicate", binding, inbox: duplicate };
    const now = new Date().toISOString();
    const inbox = {
      id: input.id ?? randomUUID(), organizationId: binding.organizationId, userId: binding.userId, agentId: binding.agentId,
      bindingId: binding.id, channel: binding.channel, channelAccountId: input.channelAccountId, externalMessageId: input.externalMessageId,
      sender: input.sender, conversation: input.conversation, content: input.content, attachments: input.attachments ?? [], replyToMessageId: input.replyToMessageId ?? null, trace: input.trace,
      state: "pending", attempts: 0, maxAttempts: input.maxAttempts ?? 8, availableAt: now, leaseToken: null, leaseExpiresAt: null, lastErrorCode: null,
      receivedAt: input.receivedAt, completedAt: null, createdAt: now, updatedAt: now
    };
    this.#channelInbox.push(inbox);
    Object.assign(binding, { lastInboundAt: input.receivedAt, lastSeenAt: input.receivedAt, updatedAt: now });
    return { status: "accepted", binding, inbox };
  }

  async ensureChannelConversation(input) {
    const existing = this.#channelConversations.find((item) => item.bindingId === input.bindingId && item.channelConversationId === input.channelConversationId);
    const now = new Date().toISOString();
    if (existing) {
      Object.assign(existing, { conversationKind: input.conversationKind, lastMessageAt: input.lastMessageAt ?? now, updatedAt: now });
      return existing;
    }
    const conversation = { id: input.id ?? randomUUID(), organizationId: input.organizationId, userId: input.userId, agentId: input.agentId, bindingId: input.bindingId, channel: input.channel, channelConversationId: input.channelConversationId, conversationKind: input.conversationKind, runtimeConversationId: input.runtimeConversationId ?? randomUUID(), lastMessageAt: input.lastMessageAt ?? now, createdAt: now, updatedAt: now };
    this.#channelConversations.push(conversation);
    return conversation;
  }

  async leaseChannelIngress(input = {}) {
    const now = Date.now();
    const leaseSeconds = Math.max(5, Math.min(Number(input.leaseSeconds) || 60, 300));
    const leaseId = input.leaseId ?? randomUUID();
    const jobs = this.#channelInbox
      .filter((item) => item.attempts < item.maxAttempts && ((["pending", "retry"].includes(item.state) && Date.parse(item.availableAt) <= now) || (item.state === "leased" && Date.parse(item.leaseExpiresAt) < now)))
      .sort((left, right) => Date.parse(left.receivedAt) - Date.parse(right.receivedAt))
      .slice(0, Math.max(1, Math.min(Number(input.limit) || 10, 100)));
    for (const item of jobs) Object.assign(item, { state: "leased", attempts: item.attempts + 1, leaseToken: `${leaseId}:${item.id}`, leaseExpiresAt: new Date(now + leaseSeconds * 1000).toISOString(), updatedAt: new Date(now).toISOString() });
    return jobs;
  }

  async completeChannelIngress(input) {
    const inbox = this.#channelInbox.find((item) => item.id === input.id && item.state === "leased" && item.leaseToken === input.leaseToken);
    if (!inbox) return null;
    let outbound = this.#channelOutbox.find((item) => item.inboxId === inbox.id) ?? null;
    const now = new Date().toISOString();
    if (input.outbound && !outbound) {
      outbound = {
        id: input.outbound.id ?? randomUUID(), organizationId: inbox.organizationId, userId: inbox.userId, agentId: inbox.agentId, bindingId: inbox.bindingId, inboxId: inbox.id,
        channel: inbox.channel, channelAccountId: inbox.channelAccountId, conversation: input.outbound.conversation ?? inbox.conversation, content: input.outbound.content,
        attachments: input.outbound.attachments ?? [], replyToMessageId: input.outbound.replyToMessageId ?? inbox.externalMessageId, trace: input.outbound.trace ?? inbox.trace,
        state: "pending", attempts: 0, maxAttempts: input.outbound.maxAttempts ?? 8, availableAt: now, workerId: null, leaseToken: null, leaseExpiresAt: null,
        channelMessageId: null, lastErrorCode: null, deliveredAt: null, createdAt: now, updatedAt: now
      };
      this.#channelOutbox.push(outbound);
    }
    Object.assign(inbox, { state: "completed", leaseToken: null, leaseExpiresAt: null, lastErrorCode: null, completedAt: now, updatedAt: now });
    return { inbox, outbound };
  }

  async failChannelIngress(input) {
    const inbox = this.#channelInbox.find((item) => item.id === input.id && item.state === "leased" && item.leaseToken === input.leaseToken);
    if (!inbox) return null;
    const dead = inbox.attempts >= inbox.maxAttempts;
    const now = new Date().toISOString();
    Object.assign(inbox, { state: dead ? "dead" : "retry", availableAt: input.availableAt ?? now, leaseToken: null, leaseExpiresAt: null, lastErrorCode: input.errorCode, updatedAt: now });
    if (dead && !this.#channelDeadLetters.some((item) => item.direction === "inbound" && item.sourceId === inbox.id)) this.#channelDeadLetters.push({ id: randomUUID(), organizationId: inbox.organizationId, agentId: inbox.agentId, bindingId: inbox.bindingId, direction: "inbound", sourceId: inbox.id, attempts: inbox.attempts, errorCode: input.errorCode, deadAt: now });
    return inbox;
  }

  async leaseChannelDeliveries(input) {
    const now = Date.now();
    const leaseSeconds = Math.max(5, Math.min(Number(input.leaseSeconds) || 60, 300));
    const leaseId = input.leaseId ?? randomUUID();
    const bindings = new Set(input.bindingIds ?? []);
    const deliveries = this.#channelOutbox
      .filter((item) => (!input.agentId || item.agentId === input.agentId) && (!input.organizationId || item.organizationId === input.organizationId) && input.channels.includes(item.channel) && (!bindings.size || bindings.has(item.bindingId)) && item.attempts < item.maxAttempts && ((["pending", "retry"].includes(item.state) && Date.parse(item.availableAt) <= now) || (item.state === "leased" && Date.parse(item.leaseExpiresAt) < now)))
      .sort((left, right) => Date.parse(left.availableAt) - Date.parse(right.availableAt))
      .slice(0, Math.max(1, Math.min(Number(input.limit) || 10, 100)));
    for (const item of deliveries) Object.assign(item, { state: "leased", attempts: item.attempts + 1, workerId: input.workerId, leaseToken: `${leaseId}:${item.id}`, leaseExpiresAt: new Date(now + leaseSeconds * 1000).toISOString(), updatedAt: new Date(now).toISOString() });
    return { leaseId, deliveries };
  }

  async recordChannelDeliveryReceipt(input) {
    const previous = this.#channelDeliveryReceipts.find((item) => item.outboundId === input.outboundId && item.attempt === input.attempt);
    if (previous) {
      if ((input.workerId && previous.workerId !== input.workerId) || previous.status !== input.status) throw Object.assign(new Error("Conflicting channel delivery receipt"), { code: "channel_receipt_conflict", statusCode: 409 });
      return { receipt: previous, outbound: this.#channelOutbox.find((item) => item.id === input.outboundId) ?? null };
    }
    const outbound = this.#channelOutbox.find((item) => item.id === input.outboundId && item.bindingId === input.bindingId && item.agentId === input.agentId && (!input.workerId || item.workerId === input.workerId) && item.state === "leased" && item.leaseToken === input.leaseToken && item.attempts === input.attempt);
    if (!outbound) return null;
    const exhausted = outbound.attempts >= outbound.maxAttempts;
    const nextState = input.status === "delivered" ? "delivered" : input.status === "retryable" && !exhausted ? "retry" : input.status === "retryable" ? "dead" : "failed";
    const receipt = { id: input.receiptId ?? randomUUID(), outboundId: outbound.id, bindingId: outbound.bindingId, workerId: outbound.workerId, attempt: input.attempt, status: input.status, channelMessageId: input.channelMessageId ?? null, errorCode: input.errorCode ?? null, observedAt: input.observedAt };
    this.#channelDeliveryReceipts.push(receipt);
    Object.assign(outbound, { state: nextState, availableAt: nextState === "retry" ? new Date(Date.now() + Math.max(0, Number(input.retryAfterMs) || 0)).toISOString() : outbound.availableAt, workerId: null, leaseToken: null, leaseExpiresAt: null, channelMessageId: input.channelMessageId ?? outbound.channelMessageId, lastErrorCode: input.errorCode ?? null, deliveredAt: nextState === "delivered" ? input.observedAt : outbound.deliveredAt, updatedAt: new Date().toISOString() });
    if (["dead", "failed"].includes(nextState) && !this.#channelDeadLetters.some((item) => item.direction === "outbound" && item.sourceId === outbound.id)) this.#channelDeadLetters.push({ id: randomUUID(), organizationId: outbound.organizationId, agentId: outbound.agentId, bindingId: outbound.bindingId, direction: "outbound", sourceId: outbound.id, attempts: outbound.attempts, errorCode: input.errorCode ?? "delivery_failed", deadAt: new Date().toISOString() });
    if (nextState === "delivered") {
      const binding = await this.getChannelBindingById(outbound.bindingId);
      if (binding) Object.assign(binding, { lastOutboundAt: input.observedAt, lastSeenAt: input.observedAt, updatedAt: new Date().toISOString() });
    }
    return { receipt, outbound };
  }

  async saveChannelHealthReport(input) {
    const binding = this.#agentChannelBindings.find((item) => item.id === input.bindingId && item.agentId === input.agentId && item.channel === input.channel);
    if (!binding) return null;
    let observation = this.#channelHealthObservations.find((item) => item.bindingId === binding.id && item.workerId === input.workerId && item.sequence === input.sequence);
    if (!observation) {
      observation = { id: input.id ?? randomUUID(), organizationId: binding.organizationId, agentId: binding.agentId, bindingId: binding.id, channel: binding.channel, workerId: input.workerId, sequence: input.sequence, status: input.status, capabilities: input.capabilities ?? [], adapterVersion: input.adapterVersion ?? null, latencyMs: input.latencyMs ?? null, lastInboundAt: input.lastInboundAt ?? null, lastOutboundAt: input.lastOutboundAt ?? null, errorCode: input.errorCode ?? null, observedAt: input.observedAt, createdAt: new Date().toISOString() };
      this.#channelHealthObservations.push(observation);
    }
    if (!binding.lastHealthAt || Date.parse(binding.lastHealthAt) <= Date.parse(input.observedAt)) Object.assign(binding, { status: input.status, capabilities: input.capabilities ?? [], adapterVersion: input.adapterVersion ?? null, lastErrorCode: input.errorCode ?? null, lastHealthAt: input.observedAt, lastSeenAt: input.status === "connected" ? input.observedAt : binding.lastSeenAt, lastInboundAt: input.lastInboundAt ?? binding.lastInboundAt, lastOutboundAt: input.lastOutboundAt ?? binding.lastOutboundAt, updatedAt: new Date().toISOString() });
    return { observation, binding };
  }

  async listAgentAuthorizations(organizationId, userId, agentId) {
    return this.#agentAuthorizations
      .filter((item) => (!organizationId || item.organizationId === organizationId) && (!userId || item.userId === userId) && (!agentId || item.agentId === agentId))
      .toSorted((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }

  async getAgentAuthorization(organizationId, userId, agentId, authorizationId) {
    return this.#agentAuthorizations.find((item) => item.id === authorizationId && item.organizationId === organizationId && item.userId === userId && item.agentId === agentId) ?? null;
  }

  async upsertAgentAuthorization(input) {
    const existing = this.#agentAuthorizations.find((item) => item.agentId === input.agentId && item.service === input.service && item.label === input.label);
    const now = new Date().toISOString();
    const value = {
      id: existing?.id ?? input.id ?? randomUUID(), organizationId: input.organizationId, userId: input.userId, agentId: input.agentId,
      service: input.service, label: input.label, authType: input.authType, endpointUrl: input.endpointUrl ?? null,
      credentialEnvelope: input.credentialEnvelope, credentialHint: input.credentialHint, metadata: input.metadata ?? {},
      status: "stored", lastErrorCode: null, lastUsedAt: existing?.lastUsedAt ?? null,
      createdAt: existing?.createdAt ?? now, updatedAt: now
    };
    if (existing) Object.assign(existing, value); else this.#agentAuthorizations.push(value);
    return existing ?? value;
  }

  async revokeAgentAuthorization(organizationId, userId, agentId, authorizationId) {
    const authorization = await this.getAgentAuthorization(organizationId, userId, agentId, authorizationId);
    if (!authorization) return null;
    Object.assign(authorization, { credentialEnvelope: null, credentialHint: null, status: "revoked", updatedAt: new Date().toISOString() });
    return authorization;
  }

  async markAgentAuthorizationUsed(authorizationId) {
    const authorization = this.#agentAuthorizations.find((item) => item.id === authorizationId);
    if (!authorization) return null;
    authorization.lastUsedAt = new Date().toISOString();
    return authorization;
  }

  async createAgentRun(input) {
    if (this.#agentRuns.some((item) => item.id === input.id)) throw new Error("Agent run already exists");
    const now = new Date().toISOString();
    const value = {
      id: input.id, organizationId: input.organizationId, userId: input.userId, agentId: input.agentId,
      parentRunId: input.parentRunId ?? null, inputText: input.inputText, model: input.model ?? null,
      status: input.status ?? "started", lastError: input.lastError ?? null,
      createdAt: now, updatedAt: now, completedAt: input.completedAt ?? null
    };
    this.#agentRuns.push(value);
    return value;
  }

  async getAgentRun(organizationId, userId, agentId, runId) {
    return this.#agentRuns.find((item) => item.id === runId && item.organizationId === organizationId && item.userId === userId && item.agentId === agentId) ?? null;
  }

  async listAgentRuns(organizationId, userId, agentId, limit = 50) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    return this.#agentRuns
      .filter((item) => item.organizationId === organizationId && item.userId === userId && item.agentId === agentId)
      .toSorted((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, safeLimit);
  }

  async updateAgentRun(input) {
    const current = await this.getAgentRun(input.organizationId, input.userId, input.agentId, input.id);
    if (!current) return null;
    Object.assign(current, {
      status: input.status ?? current.status,
      lastError: input.lastError === undefined ? current.lastError : input.lastError,
      completedAt: input.completedAt === undefined ? current.completedAt : input.completedAt,
      updatedAt: new Date().toISOString()
    });
    return current;
  }

  async setAgentHotspotBookmark(input) {
    const index = this.#agentHotspotBookmarks.findIndex((item) => item.agentId === input.agentId && item.hotspotItemId === input.hotspotItemId);
    if (input.bookmarked && index < 0) this.#agentHotspotBookmarks.push({ organizationId: input.organizationId, userId: input.userId, agentId: input.agentId, hotspotItemId: input.hotspotItemId, createdAt: new Date().toISOString() });
    if (!input.bookmarked && index >= 0) this.#agentHotspotBookmarks.splice(index, 1);
    return Boolean(input.bookmarked);
  }

  async listAgentHotspotBookmarkIds(organizationId, userId, agentId) {
    return this.#agentHotspotBookmarks.filter((item) => item.organizationId === organizationId && item.userId === userId && item.agentId === agentId).map((item) => item.hotspotItemId);
  }

  async listChannelBindings(organizationId) {
    return this.#agentChannelBindings.filter((item) => !organizationId || item.organizationId === organizationId);
  }

  async listConfigRevisions(organizationId, agentId) {
    return this.#configRevisions.filter((item) => (!organizationId || item.organizationId === organizationId) && (!agentId || item.agentId === agentId)).toReversed();
  }

  async listTelemetryEvents(organizationId, limit = 500) {
    return this.#telemetryEvents.filter((item) => !organizationId || item.organizationId === organizationId).toReversed().slice(0, Math.max(1, Math.min(Number(limit) || 500, 2000)));
  }

  async listProviderChannels(organizationId) {
    return this.#providerChannels.filter((item) => item.organizationId === organizationId).sort((left, right) => left.priority - right.priority);
  }

  async upsertProviderChannel(input) {
    const previous = this.#providerChannels.find((item) => item.organizationId === input.organizationId && item.name === input.name);
    const now = new Date().toISOString();
    const value = { id: previous?.id ?? input.id ?? randomUUID(), organizationId: input.organizationId, name: input.name, provider: input.provider, baseUrl: input.baseUrl, model: input.model, apiKeyEnvelope: input.apiKeyEnvelope ?? previous?.apiKeyEnvelope ?? null, keyHint: input.keyHint ?? previous?.keyHint ?? null, status: "pending", priority: input.priority ?? 100, weight: input.weight ?? 1, maxConcurrency: input.maxConcurrency ?? null, monthlyBudgetUsd: input.monthlyBudgetUsd ?? null, enabled: input.enabled ?? true, lastErrorCode: null, updatedBy: input.updatedBy, createdAt: previous?.createdAt ?? now, updatedAt: now };
    if (previous) Object.assign(previous, value); else this.#providerChannels.push(value);
    return previous ?? value;
  }

  async getModelPolicy(organizationId) {
    return this.#modelPolicies.get(organizationId) ?? null;
  }

  async upsertModelPolicy(input) {
    const value = { organizationId: input.organizationId, allowedModels: input.allowedModels ?? [], defaultModel: input.defaultModel ?? null, userCustomKeysAllowed: Boolean(input.userCustomKeysAllowed), dailyTokenLimit: input.dailyTokenLimit ?? null, monthlyBudgetUsd: input.monthlyBudgetUsd ?? null, updatedBy: input.updatedBy, updatedAt: new Date().toISOString() };
    this.#modelPolicies.set(input.organizationId, value);
    return value;
  }

  async getRetentionPolicy(organizationId) {
    return this.#retentionPolicies.get(organizationId) ?? null;
  }

  async upsertRetentionPolicy(input) {
    const value = { organizationId: input.organizationId, telemetryDays: input.telemetryDays, usageDays: input.usageDays, auditDays: input.auditDays, sensitiveAccessEventDays: input.sensitiveAccessEventDays, backupDays: input.backupDays, updatedBy: input.updatedBy, updatedAt: new Date().toISOString() };
    this.#retentionPolicies.set(input.organizationId, value);
    return value;
  }

  async enforceRetentionPolicies({ organizationId, now = Date.now(), actorUserId = null, reason = "Scheduled retention enforcement" } = {}) {
    const organizations = [...this.#organizations.keys()].filter((id) => !organizationId || id === organizationId);
    const runs = [];
    const recent = (value, cutoff) => !Number.isFinite(Date.parse(value)) || Date.parse(value) >= Date.parse(cutoff);
    for (const id of organizations) {
      const policy = { ...DEFAULT_RETENTION, ...(this.#retentionPolicies.get(id) ?? {}) };
      const cutoffs = retentionCutoffs(policy, now);
      const run = { id: randomUUID(), organizationId: id, status: "running", cutoffs, deletedCounts: {}, backupExpirationCommands: 0, errorCode: null, startedAt: new Date(now).toISOString(), completedAt: null, createdAt: new Date(now).toISOString() };
      this.#retentionRuns.push(run);
      const purge = (field, source, predicate) => {
        const before = source.length;
        const kept = source.filter((item) => !predicate(item));
        source.splice(0, source.length, ...kept);
        run.deletedCounts[field] = before - kept.length;
      };
      purge("heartbeats", this.#heartbeats, (item) => item.organizationId === id && !recent(item.receivedAt, cutoffs.telemetry));
      purge("resourceSamples", this.#resourceSamples, (item) => item.organizationId === id && !recent(item.receivedAt, cutoffs.telemetry));
      purge("telemetryEvents", this.#telemetryEvents, (item) => item.organizationId === id && !recent(item.occurredAt ?? item.receivedAt, cutoffs.telemetry));
      purge("usageRollups", this.#usageRollups, (item) => item.organizationId === id && !recent(item.bucketStart, cutoffs.usage));
      purge("sensitiveAccessEvents", this.#sensitiveAccessEvents, (item) => item.organizationId === id && !recent(item.createdAt, cutoffs.sensitiveAccess));
      purge("auditEvents", this.#audit, (item) => item.organizationId === id && !recent(item.createdAt, cutoffs.audit));
      for (const backup of this.#backupRecords) {
        const deployment = this.#controlDeployments.find((item) => item.id === backup.deploymentId && item.organizationId === id);
        const restoring = this.#backupRestoreRuns.some((item) => item.backupId === backup.id && ["requested", "running"].includes(item.status));
        if (!deployment || restoring || !["created", "verified", "failed"].includes(backup.status) || recent(backup.createdAt, cutoffs.backup)) continue;
        this.#controlCommands.push({ id: randomUUID(), organizationId: id, deploymentId: deployment.id, agentId: deployment.agentId, idempotencyKey: `${deployment.id}/backup.expire/${backup.id}/${run.id}`, action: "backup.expire", target: { module_id: "bairui.supervisor", instance_id: deployment.agentId }, arguments: { backup_id: backup.id }, approvalId: null, expectedObservationVersion: deployment.observedStateVersion ?? 0, state: "queued", priority: 200, attempt: 0, requestedBy: policy.updatedBy ?? null, expiresAt: new Date(now + 24 * 60 * 60_000).toISOString(), createdAt: new Date(now).toISOString() });
        backup.status = "expiring";
        run.backupExpirationCommands += 1;
      }
      Object.assign(run, { status: "succeeded", completedAt: new Date(now).toISOString() });
      this.#audit.push({ id: randomUUID(), organizationId: id, actorUserId, action: "retention.enforced", targetType: "retention_run", targetId: run.id, metadata: { reason, deletedCounts: run.deletedCounts, backupExpirationCommands: run.backupExpirationCommands, cutoffs }, createdAt: new Date(now).toISOString() });
      runs.push({ ...run });
    }
    return runs;
  }

  async listRetentionRuns(organizationId, limit = 100) {
    return this.#retentionRuns.filter((item) => !organizationId || item.organizationId === organizationId).toReversed().slice(0, Math.max(1, Math.min(Number(limit) || 100, 500)));
  }

  async listSensitiveAccessGrants(organizationId) {
    return this.#sensitiveGrants.filter((item) => item.organizationId === organizationId).toReversed();
  }

  async createSensitiveAccessGrant(input) {
    const grant = { id: input.id ?? randomUUID(), organizationId: input.organizationId, granteeUserId: input.granteeUserId, permission: "conversation_content_read", scope: input.scope, targetId: input.targetId ?? null, reason: input.reason, grantedBy: input.grantedBy, expiresAt: input.expiresAt, revokedAt: null, createdAt: new Date().toISOString() };
    this.#sensitiveGrants.push(grant);
    return grant;
  }

  async revokeSensitiveAccessGrant(organizationId, grantId) {
    const grant = this.#sensitiveGrants.find((item) => item.id === grantId && item.organizationId === organizationId && !item.revokedAt);
    if (!grant) return null;
    grant.revokedAt = new Date().toISOString();
    return grant;
  }

  async listSensitiveAccessEvents(organizationId, limit = 500) {
    return this.#sensitiveAccessEvents.filter((item) => item.organizationId === organizationId).toReversed().slice(0, Math.max(1, Math.min(Number(limit) || 500, 2000)));
  }

  async recordSensitiveAccessEvent(input) {
    const event = { id: input.id ?? randomUUID(), grantId: input.grantId, organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: input.targetType, targetId: input.targetId, reason: input.reason, createdAt: new Date().toISOString() };
    this.#sensitiveAccessEvents.push(event);
    return event;
  }

  async listBackupRecords(organizationId) {
    const deployments = new Set(this.#controlDeployments.filter((item) => !organizationId || item.organizationId === organizationId).map((item) => item.id));
    const agentByDeployment = new Map(this.#controlDeployments.map((item) => [item.id, item.agentId]));
    return this.#backupRecords.filter((item) => deployments.has(item.deploymentId)).toReversed().map((item) => ({ ...item, agentId: agentByDeployment.get(item.deploymentId) }));
  }

  async listBackupRestoreRuns(organizationId) {
    const deployments = new Set(this.#controlDeployments.filter((item) => !organizationId || item.organizationId === organizationId).map((item) => item.id));
    const agentByDeployment = new Map(this.#controlDeployments.map((item) => [item.id, item.agentId]));
    return this.#backupRestoreRuns.filter((item) => deployments.has(item.deploymentId)).toReversed().map((item) => ({ ...item, agentId: agentByDeployment.get(item.deploymentId) }));
  }

  async listReleaseGates(organizationId) {
    const deployments = new Set(this.#controlDeployments.filter((item) => !organizationId || item.organizationId === organizationId).map((item) => item.id));
    return this.#releaseGates.filter((item) => !organizationId || deployments.has(item.deploymentId)).toReversed();
  }

  async listUpstreamCandidates() {
    return this.#upstreamCandidates.toReversed();
  }
}
