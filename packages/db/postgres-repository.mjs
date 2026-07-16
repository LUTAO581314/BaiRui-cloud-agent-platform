import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

const mapUser = (row, includeHash = false) => row ? {
  id: row.id,
  organizationId: row.organization_id,
  email: row.email,
  displayName: row.display_name,
  ...(includeHash ? { passwordHash: row.password_hash } : {}),
  role: row.role,
  status: row.status,
  createdAt: row.created_at?.toISOString?.() ?? row.created_at
} : null;
const mapAgent = (row) => row ? ({ id: row.id, organizationId: row.organization_id, ownerUserId: row.owner_user_id, name: row.name, description: row.description, avatarUrl: row.avatar_url, soulMarkdown: row.soul_markdown, status: row.status, initializationStatus: row.initialization_status, desiredRuntimeState: row.desired_runtime_state, settings: row.settings, lastErrorCode: row.last_error_code, lastErrorDetail: row.last_error_detail, createdAt: row.created_at?.toISOString?.() ?? row.created_at, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at }) : null;
const mapAgentRuntime = (row) => row ? ({ id: row.id, organizationId: row.organization_id, ownerUserId: row.owner_user_id, agentId: row.agent_id, deploymentId: row.deployment_id, workspaceRef: row.workspace_ref, runtimeKind: row.runtime_kind, status: row.status, endpointRef: row.endpoint_ref, routeUpdatedAt: row.route_updated_at?.toISOString?.() ?? row.route_updated_at, hermesVersion: row.hermes_version, boundaryVersion: row.boundary_version, configRevisionId: row.config_revision_id, lastHeartbeatAt: row.last_heartbeat_at?.toISOString?.() ?? row.last_heartbeat_at, lastErrorCode: row.last_error_code, lastErrorDetail: row.last_error_detail, createdAt: row.created_at?.toISOString?.() ?? row.created_at, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at }) : null;
const mapAgentRun = (row) => row ? ({ id: row.id, organizationId: row.organization_id, userId: row.user_id, agentId: row.agent_id, parentRunId: row.parent_run_id, inputText: row.input_text, model: row.model, status: row.status, lastError: row.last_error, createdAt: row.created_at?.toISOString?.() ?? row.created_at, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at, completedAt: row.completed_at?.toISOString?.() ?? row.completed_at }) : null;
const mapHeartbeat = (row) => row ? ({ id: row.id, organizationId: row.organization_id, userId: row.user_id, agentId: row.agent_id, runtimeId: row.runtime_id, sequence: Number(row.sequence), status: row.status, runtimeVersion: row.runtime_version, boundaryVersion: row.boundary_version, configRevisionId: row.config_revision_id, queueDepth: row.queue_depth, activeRuns: row.active_runs, failedRuns: row.failed_runs, observedAt: row.observed_at?.toISOString?.() ?? row.observed_at, receivedAt: row.received_at?.toISOString?.() ?? row.received_at }) : null;
const mapAgentComponent = (row) => ({ id: row.id, organizationId: row.organization_id, agentId: row.agent_id, runtimeId: row.runtime_id, layer: row.layer, moduleId: row.module_id, status: row.status, version: row.version, upstreamRef: row.upstream_ref, capabilities: row.capabilities, metrics: row.metrics, observedAt: row.observed_at?.toISOString?.() ?? row.observed_at, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at });
const nullableNumber = (value) => value === null || value === undefined ? null : Number(value);
const mapContainerResource = (row) => ({ role: row.role, containerId: row.container_id, containerName: row.container_name, status: row.status, imageRef: row.image_ref, version: row.version, cpuPercent: nullableNumber(row.cpu_percent), memoryUsedBytes: nullableNumber(row.memory_used_bytes), memoryLimitBytes: nullableNumber(row.memory_limit_bytes), writableBytes: nullableNumber(row.writable_bytes), startedAt: row.started_at?.toISOString?.() ?? row.started_at });
const mapResourceSample = (row) => ({ id: row.id, organizationId: row.organization_id, userId: row.user_id, agentId: row.agent_id, runtimeId: row.runtime_id, deploymentId: row.deployment_id, serverId: row.server_id, environment: row.environment, sequence: Number(row.sequence), status: row.status, cpuPercent: nullableNumber(row.cpu_percent), memoryUsedBytes: nullableNumber(row.memory_used_bytes), memoryLimitBytes: nullableNumber(row.memory_limit_bytes), agentStorageUsedBytes: nullableNumber(row.agent_storage_used_bytes), hostStorageUsedBytes: nullableNumber(row.host_storage_used_bytes), hostStorageLimitBytes: nullableNumber(row.host_storage_limit_bytes), osType: row.os_type, architecture: row.architecture, operatingSystem: row.operating_system, dockerVersion: row.docker_version, cpuCount: nullableNumber(row.cpu_count), startedAt: row.started_at?.toISOString?.() ?? row.started_at, uptimeSeconds: nullableNumber(row.uptime_seconds), observedAt: row.observed_at?.toISOString?.() ?? row.observed_at, receivedAt: row.received_at?.toISOString?.() ?? row.received_at, containers: [] });
const mapAlert = (row) => row ? ({ id: row.id, organizationId: row.organization_id, agentId: row.agent_id, runtimeId: row.runtime_id, code: row.code, severity: row.severity, status: row.status, title: row.title, summary: row.summary, acknowledgedBy: row.acknowledged_by, firstSeenAt: row.first_seen_at?.toISOString?.() ?? row.first_seen_at, lastSeenAt: row.last_seen_at?.toISOString?.() ?? row.last_seen_at, resolvedAt: row.resolved_at?.toISOString?.() ?? row.resolved_at }) : null;
const mapConversation = (row) => ({ id: row.id, organizationId: row.organization_id, userId: row.user_id, agentId: row.agent_id, title: row.title, createdAt: row.created_at?.toISOString?.() ?? row.created_at, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at });
const mapMessage = (row) => ({ id: row.id, conversationId: row.conversation_id, organizationId: row.organization_id, userId: row.user_id, role: row.role, content: row.content, createdAt: row.created_at?.toISOString?.() ?? row.created_at });
const mapSnapshot = (row) => ({ id: row.id, organizationId: row.organization_id, serverId: row.server_id, status: row.status, payload: row.payload, receivedAt: row.received_at?.toISOString?.() ?? row.received_at });
const mapAudit = (row) => ({ id: row.id, organizationId: row.organization_id, actorUserId: row.actor_user_id, action: row.action, targetType: row.target_type, targetId: row.target_id, metadata: row.metadata, createdAt: row.created_at?.toISOString?.() ?? row.created_at });
const mapLicense = (row) => ({ id: row.id, organizationId: row.organization_id, plan: row.plan, status: row.status, document: row.document, issuedAt: row.issued_at?.toISOString?.() ?? row.issued_at, expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at, createdAt: row.created_at?.toISOString?.() ?? row.created_at });
const mapServer = (row) => ({ id: row.id, organizationId: row.organization_id, name: row.name, status: row.status, runtimeVersion: row.runtime_version, lastSeenAt: row.last_seen_at?.toISOString?.() ?? row.last_seen_at, createdAt: row.created_at?.toISOString?.() ?? row.created_at });
const mapRelease = (row) => ({ id: row.id, version: row.version, agentCommit: row.agent_commit, status: row.status, notes: row.notes, createdAt: row.created_at?.toISOString?.() ?? row.created_at });
const mapControlCommand = (row) => row ? ({ id: row.id, organizationId: row.organization_id, deploymentId: row.deployment_id, agentId: row.agent_id, idempotencyKey: row.idempotency_key, action: row.action, arguments: row.arguments, approvalId: row.approval_id, state: row.state, priority: row.priority, requestedBy: row.requested_by, expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at, createdAt: row.created_at?.toISOString?.() ?? row.created_at, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at }) : null;
const mapControlApproval = (row) => row ? ({ id: row.id, organizationId: row.organization_id, commandId: row.command_id, action: row.action, riskLevel: row.risk_level, requestedBy: row.requested_by, decidedBy: row.decided_by, decision: row.decision, reason: row.reason, expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at, decidedAt: row.decided_at?.toISOString?.() ?? row.decided_at, createdAt: row.created_at?.toISOString?.() ?? row.created_at }) : null;
const mapReleaseManifest = (row) => row ? ({ id: row.id, releaseId: row.release_id, version: row.version, agentCommit: row.agent_commit, imageDigest: row.image_digest, sbomUri: row.sbom_uri, provenanceUri: row.provenance_uri, signature: row.signature, migrationVersion: row.migration_version, compatibility: row.compatibility, status: row.status, createdBy: row.created_by, createdAt: row.created_at?.toISOString?.() ?? row.created_at }) : null;
const mapProviderConfiguration = (row) => row ? ({ organizationId: row.organization_id, provider: row.provider, baseUrl: row.base_url, model: row.model, apiKeyEnvelope: row.api_key_envelope, keyHint: row.key_hint, applyStatus: row.apply_status, updatedBy: row.updated_by, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at }) : null;
const mapProviderChannel = (row) => row ? ({ id: row.id, organizationId: row.organization_id, name: row.name, provider: row.provider, baseUrl: row.base_url, model: row.model, apiKeyEnvelope: row.api_key_envelope, keyHint: row.key_hint, status: row.status, priority: row.priority, weight: row.weight, maxConcurrency: row.max_concurrency, monthlyBudgetUsd: row.monthly_budget_usd === null ? null : Number(row.monthly_budget_usd), enabled: row.enabled, lastErrorCode: row.last_error_code, updatedBy: row.updated_by, createdAt: row.created_at?.toISOString?.() ?? row.created_at, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at }) : null;
const mapModelPolicy = (row) => row ? ({ organizationId: row.organization_id, allowedModels: row.allowed_models, defaultModel: row.default_model, userCustomKeysAllowed: row.user_custom_keys_allowed, dailyTokenLimit: row.daily_token_limit === null ? null : Number(row.daily_token_limit), monthlyBudgetUsd: row.monthly_budget_usd === null ? null : Number(row.monthly_budget_usd), updatedBy: row.updated_by, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at }) : null;
const mapRetentionPolicy = (row) => row ? ({ organizationId: row.organization_id, telemetryDays: row.telemetry_days, usageDays: row.usage_days, auditDays: row.audit_days, sensitiveAccessEventDays: row.sensitive_access_event_days, backupDays: row.backup_days, updatedBy: row.updated_by, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at }) : null;
const mapConfigRevision = (row) => row ? ({ id: row.id, organizationId: row.organization_id, agentId: row.agent_id, revision: Number(row.revision), configDocument: row.config_document, status: row.status, contentHash: row.content_hash, createdBy: row.created_by, createdAt: row.created_at?.toISOString?.() ?? row.created_at }) : null;
const mapSensitiveGrant = (row) => row ? ({ id: row.id, organizationId: row.organization_id, granteeUserId: row.grantee_user_id, permission: row.permission, scope: row.scope, targetId: row.target_id, reason: row.reason, grantedBy: row.granted_by, expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at, revokedAt: row.revoked_at?.toISOString?.() ?? row.revoked_at, createdAt: row.created_at?.toISOString?.() ?? row.created_at }) : null;
const mapIntegrationRun = (row) => ({ id: row.id, organizationId: row.organization_id, integrationId: row.integration_id, capability: row.capability, status: row.status, summary: row.summary, startedAt: row.started_at?.toISOString?.() ?? row.started_at, completedAt: row.completed_at?.toISOString?.() ?? row.completed_at, createdAt: row.created_at?.toISOString?.() ?? row.created_at });
const mapHotspot = (row) => ({ id: row.id, runId: row.run_id, externalId: row.external_id, sourceId: row.source_id, sourceName: row.source_name, rank: row.rank, title: row.title, url: row.url, mobileUrl: row.mobile_url, heat: row.heat, category: row.category, fetchedAt: row.fetched_at?.toISOString?.() ?? row.fetched_at });
const mapObsidianNote = (row) => row ? ({ id: row.id, organizationId: row.organization_id, userId: row.user_id, agentId: row.agent_id, title: row.title, slug: row.slug, markdown: row.markdown, frontmatter: row.frontmatter, wikilinks: row.wikilinks, memoryKind: row.memory_kind, importance: row.importance, hermesTarget: row.hermes_target, sourceRef: row.source_ref, revision: row.revision, hermesSyncStatus: row.hermes_sync_status, hermesSyncedRevision: row.hermes_synced_revision, hermesSyncedAt: row.hermes_synced_at?.toISOString?.() ?? row.hermes_synced_at, createdAt: row.created_at?.toISOString?.() ?? row.created_at, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at }) : null;
const mapSkillPreference = (row) => row ? ({ agentId: row.agent_id, organizationId: row.organization_id, userId: row.user_id, skillId: row.skill_id, enabled: row.enabled, applyStatus: row.apply_status, lastErrorCode: row.last_error_code, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at }) : null;
const mapChannelBinding = (row) => row ? ({ id: row.id, organizationId: row.organization_id, userId: row.user_id, agentId: row.agent_id, channel: row.channel, displayName: row.display_name, status: row.status, credentialEnvelope: row.credential_envelope, credentialHint: row.credential_hint, metadata: row.metadata, lastErrorCode: row.last_error_code, lastSeenAt: row.last_seen_at?.toISOString?.() ?? row.last_seen_at, createdAt: row.created_at?.toISOString?.() ?? row.created_at, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at }) : null;
const mapUsageRollup = (row) => ({ organizationId: row.organization_id, userId: row.user_id, agentId: row.agent_id, runtimeId: row.runtime_id, bucketStart: row.bucket_start?.toISOString?.() ?? row.bucket_start, bucketSeconds: row.bucket_seconds, model: row.model, inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), estimatedCostUsd: Number(row.estimated_cost_usd), runCount: Number(row.run_count), failedRunCount: Number(row.failed_run_count), latencySumMs: Number(row.latency_sum_ms) });

export class PostgresPlatformRepository {
  constructor(options = {}) {
    this.pool = options.pool ?? new pg.Pool({ connectionString: options.connectionString, ssl: options.ssl });
  }

  async close() { await this.pool.end(); }

  async createOrganization(input) {
    const id = input.id ?? randomUUID();
    const { rows } = await this.pool.query("INSERT INTO organizations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name RETURNING *", [id, input.name]);
    const row = rows[0];
    return { id: row.id, name: row.name, createdAt: row.created_at.toISOString() };
  }

  async getOrganization(id) {
    const { rows } = await this.pool.query("SELECT * FROM organizations WHERE id = $1", [id]);
    const row = rows[0];
    return row ? { id: row.id, name: row.name, createdAt: row.created_at.toISOString() } : null;
  }

  async listOrganizations() {
    const { rows } = await this.pool.query("SELECT * FROM organizations ORDER BY created_at");
    return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at?.toISOString?.() ?? row.created_at }));
  }

  async createUser(input) {
    const existing = await this.findUserByEmail(input.email);
    if (existing) {
      const { passwordHash, ...safe } = existing;
      return safe;
    }
    const { rows } = await this.pool.query(
      "INSERT INTO users (id, organization_id, email, display_name, password_hash, role, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [input.id ?? randomUUID(), input.organizationId, input.email.toLowerCase(), input.displayName, input.passwordHash, input.role ?? "user", input.status ?? "active"]
    );
    return mapUser(rows[0]);
  }

  async findUserByEmail(email) {
    const { rows } = await this.pool.query("SELECT * FROM users WHERE email = $1 ORDER BY created_at LIMIT 1", [email.toLowerCase()]);
    return mapUser(rows[0], true);
  }

  async getUser(id) {
    const { rows } = await this.pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return mapUser(rows[0]);
  }

  async listUsers(organizationId) {
    const query = organizationId ? ["SELECT * FROM users WHERE organization_id = $1 ORDER BY created_at", [organizationId]] : ["SELECT * FROM users ORDER BY created_at", []];
    const { rows } = await this.pool.query(...query);
    return rows.map((row) => mapUser(row));
  }

  async updateUserRole(id, role) {
    const { rows } = await this.pool.query("UPDATE users SET role = $2, updated_at = now() WHERE id = $1 RETURNING *", [id, role]);
    return mapUser(rows[0]);
  }

  async createAgent(input) {
    if (!input.ownerUserId) throw new TypeError("ownerUserId is required");
    const id = input.id ?? randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO agents (id, organization_id, owner_user_id, name, description, avatar_url, soul_markdown, status, initialization_status, desired_runtime_state, settings)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET owner_user_id=EXCLUDED.owner_user_id, name=EXCLUDED.name, description=EXCLUDED.description, avatar_url=EXCLUDED.avatar_url, soul_markdown=EXCLUDED.soul_markdown, updated_at=now()
         RETURNING *`,
        [id, input.organizationId, input.ownerUserId, input.name, input.description ?? "", input.avatarUrl ?? null, input.soulMarkdown ?? "", input.status ?? "pending", input.initializationStatus ?? "uninitialized", input.desiredRuntimeState ?? "stopped", input.settings ?? {}]
      );
      await client.query("INSERT INTO agent_memberships (agent_id, organization_id, user_id, role) VALUES ($1,$2,$3,'owner') ON CONFLICT (agent_id, user_id) DO UPDATE SET role='owner'", [id, input.organizationId, input.ownerUserId]);
      await client.query("COMMIT");
      return mapAgent(rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async getAgent(id) {
    const { rows } = await this.pool.query("SELECT * FROM agents WHERE id = $1", [id]);
    return mapAgent(rows[0]);
  }

  async listAgents(organizationId, ownerUserId) {
    const query = ownerUserId
      ? ["SELECT * FROM agents WHERE organization_id = $1 AND owner_user_id = $2 ORDER BY updated_at DESC", [organizationId, ownerUserId]]
      : organizationId
        ? ["SELECT * FROM agents WHERE organization_id = $1 ORDER BY updated_at DESC", [organizationId]]
        : ["SELECT * FROM agents ORDER BY updated_at DESC", []];
    const { rows } = await this.pool.query(...query);
    return rows.map(mapAgent);
  }

  async updateAgent(id, patch) {
    const current = await this.getAgent(id);
    if (!current) return null;
    const value = (field) => field in patch ? patch[field] : current[field];
    const { rows } = await this.pool.query(
      `UPDATE agents SET name=$2, description=$3, avatar_url=$4, soul_markdown=$5, status=$6,
       initialization_status=$7, desired_runtime_state=$8, settings=$9, last_error_code=$10,
       last_error_detail=$11, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, value("name"), value("description"), value("avatarUrl"), value("soulMarkdown"), value("status"), value("initializationStatus"), value("desiredRuntimeState"), value("settings"), value("lastErrorCode"), value("lastErrorDetail")]
    );
    return mapAgent(rows[0]);
  }

  async createAgentRuntime(input) {
    const { rows } = await this.pool.query(
      `INSERT INTO agent_runtimes (id, organization_id, owner_user_id, agent_id, deployment_id, workspace_ref, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (agent_id) DO UPDATE SET updated_at=now() RETURNING *`,
      [input.id ?? randomUUID(), input.organizationId, input.ownerUserId, input.agentId, input.deploymentId ?? null, input.workspaceRef, input.status ?? "uninitialized"]
    );
    return mapAgentRuntime(rows[0]);
  }

  async getAgentRuntimeByAgent(agentId) {
    const { rows } = await this.pool.query("SELECT * FROM agent_runtimes WHERE agent_id = $1", [agentId]);
    return mapAgentRuntime(rows[0]);
  }

  async listAgentRuntimes(organizationId, ownerUserId) {
    const query = ownerUserId
      ? ["SELECT * FROM agent_runtimes WHERE organization_id = $1 AND owner_user_id = $2 ORDER BY updated_at DESC", [organizationId, ownerUserId]]
      : organizationId
        ? ["SELECT * FROM agent_runtimes WHERE organization_id = $1 ORDER BY updated_at DESC", [organizationId]]
        : ["SELECT * FROM agent_runtimes ORDER BY updated_at DESC", []];
    const { rows } = await this.pool.query(...query);
    return rows.map(mapAgentRuntime);
  }

  async saveAgentHeartbeat(input) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO heartbeats (id, organization_id, user_id, agent_id, runtime_id, sequence, status, runtime_version, boundary_version, config_revision_id, queue_depth, active_runs, failed_runs, observed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (runtime_id, sequence) DO UPDATE SET received_at=heartbeats.received_at RETURNING *`,
        [input.id ?? randomUUID(), input.organizationId, input.userId, input.agentId, input.runtimeId, input.sequence, input.status, input.runtimeVersion ?? null, input.boundaryVersion ?? null, input.configRevisionId ?? null, input.queueDepth ?? 0, input.activeRuns ?? 0, input.failedRuns ?? 0, input.observedAt]
      );
      const runtimeStatus = input.status === "healthy" ? "ready" : input.status === "unhealthy" ? "failed" : "degraded";
      const initializationStatus = input.status === "healthy" ? "ready" : input.status === "unhealthy" ? "failed" : "degraded";
      await client.query("UPDATE agent_runtimes SET status=$2, hermes_version=COALESCE($3,hermes_version), boundary_version=COALESCE($4,boundary_version), config_revision_id=COALESCE($5,config_revision_id), last_heartbeat_at=$6, updated_at=now() WHERE id=$1 AND agent_id=$7", [input.runtimeId, runtimeStatus, input.runtimeVersion ?? null, input.boundaryVersion ?? null, input.configRevisionId ?? null, input.observedAt, input.agentId]);
      await client.query("UPDATE agents SET status=$2, initialization_status=$3, updated_at=now() WHERE id=$1", [input.agentId, input.status === "healthy" ? "active" : initializationStatus, initializationStatus]);
      if (["degraded", "unhealthy"].includes(input.status)) {
        await client.query(
          `INSERT INTO alerts (id, organization_id, agent_id, runtime_id, code, severity, status, title, summary, first_seen_at, last_seen_at)
           VALUES ($1,$2,$3,$4,'runtime.health',$5,'open',$6,$7,$8,$8)
           ON CONFLICT (agent_id, code) WHERE status IN ('open','acknowledged') DO UPDATE SET severity=EXCLUDED.severity, title=EXCLUDED.title, summary=EXCLUDED.summary, last_seen_at=EXCLUDED.last_seen_at`,
          [randomUUID(), input.organizationId, input.agentId, input.runtimeId, input.status === "unhealthy" ? "critical" : "medium", input.status === "unhealthy" ? "Agent Runtime 不健康" : "Agent Runtime 降级", `Runtime 上报状态：${input.status}`, input.observedAt]
        );
      } else if (input.status === "healthy") {
        await client.query("UPDATE alerts SET status='resolved', resolved_at=COALESCE(resolved_at,now()) WHERE agent_id=$1 AND runtime_id=$2 AND code IN ('runtime.health','runtime.offline') AND status IN ('open','acknowledged')", [input.agentId, input.runtimeId]);
      }
      for (const component of input.components ?? []) {
        await client.query(
          `INSERT INTO agent_components (id, organization_id, agent_id, runtime_id, layer, module_id, status, version, upstream_ref, capabilities, metrics, observed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (runtime_id, module_id) DO UPDATE SET layer=EXCLUDED.layer, status=EXCLUDED.status, version=EXCLUDED.version, upstream_ref=EXCLUDED.upstream_ref, capabilities=EXCLUDED.capabilities, metrics=EXCLUDED.metrics, observed_at=EXCLUDED.observed_at, updated_at=now()`,
          [randomUUID(), input.organizationId, input.agentId, input.runtimeId, component.layer, component.moduleId, component.status, component.version ?? null, component.upstreamRef ?? null, component.capabilities ?? [], component.metrics ?? {}, component.observedAt ?? input.observedAt]
        );
      }
      for (const event of input.events ?? []) {
        await client.query(
          "INSERT INTO telemetry_events (id, organization_id, user_id, agent_id, runtime_id, layer, component_id, event_type, severity, trace_id, metrics, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [randomUUID(), input.organizationId, input.userId, input.agentId, input.runtimeId, event.layer ?? null, event.componentId ?? null, event.eventType, event.severity, event.traceId ?? null, event.metrics ?? {}, event.occurredAt ?? input.observedAt]
        );
      }
      if (input.usage) {
        await client.query(
          `INSERT INTO usage_rollups (organization_id, user_id, agent_id, runtime_id, bucket_start, bucket_seconds, model, input_tokens, output_tokens, estimated_cost_usd, run_count, failed_run_count, latency_sum_ms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (agent_id, bucket_start, bucket_seconds, model) DO UPDATE SET
             input_tokens=usage_rollups.input_tokens+EXCLUDED.input_tokens,
             output_tokens=usage_rollups.output_tokens+EXCLUDED.output_tokens,
             estimated_cost_usd=usage_rollups.estimated_cost_usd+EXCLUDED.estimated_cost_usd,
             run_count=usage_rollups.run_count+EXCLUDED.run_count,
             failed_run_count=usage_rollups.failed_run_count+EXCLUDED.failed_run_count,
             latency_sum_ms=usage_rollups.latency_sum_ms+EXCLUDED.latency_sum_ms`,
          [input.organizationId, input.userId, input.agentId, input.runtimeId, input.usage.bucketStart, input.usage.bucketSeconds, input.usage.model ?? "unknown", input.usage.inputTokens ?? 0, input.usage.outputTokens ?? 0, input.usage.estimatedCostUsd ?? 0, input.usage.runCount ?? 0, input.usage.failedRunCount ?? 0, input.usage.latencySumMs ?? 0]
        );
      }
      await client.query("COMMIT");
      return mapHeartbeat(rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async latestAgentHeartbeats(organizationId) {
    const query = organizationId
      ? ["SELECT DISTINCT ON (runtime_id) * FROM heartbeats WHERE organization_id=$1 ORDER BY runtime_id, received_at DESC", [organizationId]]
      : ["SELECT DISTINCT ON (runtime_id) * FROM heartbeats ORDER BY runtime_id, received_at DESC", []];
    const { rows } = await this.pool.query(...query);
    return rows.map(mapHeartbeat);
  }

  async listAgentComponents(organizationId, agentId) {
    const conditions = [];
    const values = [];
    if (organizationId) { values.push(organizationId); conditions.push(`organization_id=$${values.length}`); }
    if (agentId) { values.push(agentId); conditions.push(`agent_id=$${values.length}`); }
    const { rows } = await this.pool.query(`SELECT * FROM agent_components${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY agent_id, layer, module_id`, values);
    return rows.map(mapAgentComponent);
  }

  async saveAgentResourceSamples(input) {
    const client = await this.pool.connect();
    const saved = [];
    try {
      await client.query("BEGIN");
      for (const sample of input.samples ?? []) {
        const { rows: identityRows } = await client.query(
          `SELECT deployment.environment, agent.organization_id, agent.owner_user_id
           FROM control_deployments deployment
           JOIN servers server ON server.id=deployment.server_id
           JOIN agents agent ON agent.id=deployment.agent_id
           JOIN agent_runtimes runtime ON runtime.agent_id=agent.id
           WHERE deployment.id=$1 AND deployment.server_id=$2 AND deployment.agent_id=$3
             AND runtime.id=$4 AND runtime.deployment_id=deployment.id AND server.organization_id=agent.organization_id
           FOR UPDATE OF deployment`,
          [sample.deploymentId, input.serverId, sample.agentId, sample.runtimeId]
        );
        const identity = identityRows[0];
        if (!identity) throw Object.assign(new Error("Resource sample does not belong to this server deployment"), { code: "resource_identity_mismatch", statusCode: 404 });
        const { rows } = await client.query(
          `INSERT INTO agent_resource_samples (
             id, organization_id, user_id, agent_id, runtime_id, deployment_id, server_id, sequence, status,
             cpu_percent, memory_used_bytes, memory_limit_bytes, agent_storage_used_bytes,
             host_storage_used_bytes, host_storage_limit_bytes, os_type, architecture, operating_system,
             docker_version, cpu_count, started_at, uptime_seconds, observed_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
           ON CONFLICT (runtime_id, sequence) DO UPDATE SET
             status=EXCLUDED.status, cpu_percent=EXCLUDED.cpu_percent, memory_used_bytes=EXCLUDED.memory_used_bytes,
             memory_limit_bytes=EXCLUDED.memory_limit_bytes, agent_storage_used_bytes=EXCLUDED.agent_storage_used_bytes,
             host_storage_used_bytes=EXCLUDED.host_storage_used_bytes, host_storage_limit_bytes=EXCLUDED.host_storage_limit_bytes,
             os_type=EXCLUDED.os_type, architecture=EXCLUDED.architecture, operating_system=EXCLUDED.operating_system,
             docker_version=EXCLUDED.docker_version, cpu_count=EXCLUDED.cpu_count, started_at=EXCLUDED.started_at,
             uptime_seconds=EXCLUDED.uptime_seconds, observed_at=EXCLUDED.observed_at, received_at=now()
           RETURNING *`,
          [randomUUID(), identity.organization_id, identity.owner_user_id, sample.agentId, sample.runtimeId, sample.deploymentId, input.serverId, sample.sequence, sample.status, sample.cpuPercent, sample.memoryUsedBytes, sample.memoryLimitBytes, sample.agentStorageUsedBytes, sample.hostStorageUsedBytes, sample.hostStorageLimitBytes, sample.osType, sample.architecture, sample.operatingSystem, sample.dockerVersion, sample.cpuCount, sample.startedAt, sample.uptimeSeconds, sample.observedAt]
        );
        const row = rows[0];
        await client.query("DELETE FROM agent_container_resource_samples WHERE sample_id=$1", [row.id]);
        for (const container of sample.containers ?? []) {
          await client.query(
            `INSERT INTO agent_container_resource_samples (sample_id, role, container_id, container_name, status, image_ref, version, cpu_percent, memory_used_bytes, memory_limit_bytes, writable_bytes, started_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [row.id, container.role, container.containerId, container.containerName, container.status, container.imageRef, container.version, container.cpuPercent, container.memoryUsedBytes, container.memoryLimitBytes, container.writableBytes, container.startedAt]
          );
        }
        const resource = mapResourceSample({ ...row, environment: identity.environment });
        resource.containers = sample.containers ?? [];
        await this.evaluateResourceAlerts(client, resource);
        saved.push(resource);
      }
      await client.query("COMMIT");
      return saved;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async evaluateResourceAlerts(client, resource) {
    const checks = [
      ["resource.cpu.high", resource.cpuPercent === null ? null : resource.cpuPercent / Math.max(1, resource.cpuCount ?? 1), 90, "high", "Agent CPU 使用率过高"],
      ["resource.memory.high", resource.memoryLimitBytes > 0 ? resource.memoryUsedBytes / resource.memoryLimitBytes * 100 : null, 90, "high", "Agent 内存使用率过高"],
      ["resource.storage.high", resource.hostStorageLimitBytes > 0 ? resource.hostStorageUsedBytes / resource.hostStorageLimitBytes * 100 : null, 90, "critical", "Agent 主机存储使用率过高"]
    ];
    for (const [code, value, threshold, severity, title] of checks) {
      if (Number.isFinite(value) && value >= threshold) {
        await client.query(
          `INSERT INTO alerts (id, organization_id, agent_id, runtime_id, code, severity, status, title, summary, first_seen_at, last_seen_at)
           VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$9)
           ON CONFLICT (agent_id, code) WHERE status IN ('open','acknowledged')
           DO UPDATE SET severity=EXCLUDED.severity, title=EXCLUDED.title, summary=EXCLUDED.summary, last_seen_at=EXCLUDED.last_seen_at`,
          [randomUUID(), resource.organizationId, resource.agentId, resource.runtimeId, code, severity, title, `当前使用率 ${value.toFixed(1)}%，阈值 ${threshold}%`, resource.observedAt]
        );
      } else {
        await client.query("UPDATE alerts SET status='resolved', resolved_at=COALESCE(resolved_at,now()) WHERE agent_id=$1 AND runtime_id=$2 AND code=$3 AND status IN ('open','acknowledged')", [resource.agentId, resource.runtimeId, code]);
      }
    }
  }

  async attachContainerResources(rows) {
    if (!rows.length) return [];
    const resources = rows.map(mapResourceSample);
    const byId = new Map(resources.map((item) => [item.id, item]));
    const { rows: containers } = await this.pool.query("SELECT * FROM agent_container_resource_samples WHERE sample_id=ANY($1::text[]) ORDER BY sample_id, role", [resources.map((item) => item.id)]);
    for (const row of containers) byId.get(row.sample_id)?.containers.push(mapContainerResource(row));
    return resources;
  }

  async latestAgentResourceSamples(organizationId, agentId) {
    const conditions = [];
    const values = [];
    if (organizationId) { values.push(organizationId); conditions.push(`organization_id=$${values.length}`); }
    if (agentId) { values.push(agentId); conditions.push(`agent_id=$${values.length}`); }
    const { rows } = await this.pool.query(
      `SELECT latest.*, deployment.environment
       FROM (SELECT DISTINCT ON (runtime_id) * FROM agent_resource_samples${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY runtime_id, observed_at DESC, received_at DESC) latest
       JOIN control_deployments deployment ON deployment.id=latest.deployment_id
       ORDER BY latest.observed_at DESC`,
      values
    );
    return this.attachContainerResources(rows);
  }

  async listAgentResourceSamples(organizationId, agentId, limit = 288) {
    const conditions = [];
    const values = [];
    if (organizationId) { values.push(organizationId); conditions.push(`sample.organization_id=$${values.length}`); }
    if (agentId) { values.push(agentId); conditions.push(`sample.agent_id=$${values.length}`); }
    values.push(Math.max(1, Math.min(Number(limit) || 288, 2000)));
    const { rows } = await this.pool.query(
      `SELECT sample.*, deployment.environment FROM agent_resource_samples sample
       JOIN control_deployments deployment ON deployment.id=sample.deployment_id
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY sample.observed_at DESC LIMIT $${values.length}`,
      values
    );
    return this.attachContainerResources(rows);
  }

  async listAlerts(organizationId) {
    const query = organizationId ? ["SELECT * FROM alerts WHERE organization_id=$1 ORDER BY last_seen_at DESC", [organizationId]] : ["SELECT * FROM alerts ORDER BY last_seen_at DESC", []];
    const { rows } = await this.pool.query(...query);
    return rows.map(mapAlert);
  }

  async updateAlertStatus(input) {
    const status = ["open", "acknowledged", "resolved", "closed"].includes(input.status) ? input.status : null;
    if (!status) throw new TypeError("Invalid alert status");
    const { rows } = await this.pool.query("UPDATE alerts SET status=$2, acknowledged_by=CASE WHEN $2='acknowledged' THEN $3 ELSE acknowledged_by END, resolved_at=CASE WHEN $2 IN ('resolved','closed') THEN now() ELSE NULL END WHERE id=$1 RETURNING *", [input.alertId, status, input.actorUserId]);
    return mapAlert(rows[0]);
  }

  async evaluateOfflineAlerts({ organizationId, staleAfterMs = 120_000 } = {}) {
    await this.pool.query(
      `UPDATE alerts alert
       SET status='resolved', resolved_at=COALESCE(alert.resolved_at,now())
       FROM agents agent
       JOIN agent_runtimes runtime ON runtime.agent_id=agent.id
       WHERE alert.agent_id=agent.id
         AND alert.runtime_id=runtime.id
         AND alert.code='runtime.offline'
         AND alert.status IN ('open','acknowledged')
         AND (agent.desired_runtime_state<>'running' OR runtime.status IN ('uninitialized','stopped','suspended','deleting','deleted'))
         ${organizationId ? "AND alert.organization_id=$1" : ""}`,
      organizationId ? [organizationId] : []
    );
    const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
    const condition = `WHERE agent.desired_runtime_state='running' AND runtime.status NOT IN ('uninitialized','stopped','suspended','deleting','deleted')${organizationId ? " AND agent.organization_id=$1" : ""}`;
    const { rows } = await this.pool.query(`SELECT agent.id AS agent_id, agent.organization_id, runtime.id AS runtime_id, runtime.last_heartbeat_at FROM agents agent JOIN agent_runtimes runtime ON runtime.agent_id=agent.id ${condition}`, organizationId ? [organizationId] : []);
    const results = [];
    for (const row of rows) {
      const stale = !row.last_heartbeat_at || new Date(row.last_heartbeat_at).getTime() < Date.parse(cutoff);
      if (stale) {
        const { rows: alertRows } = await this.pool.query(
          `INSERT INTO alerts (id, organization_id, agent_id, runtime_id, code, severity, status, title, summary, first_seen_at, last_seen_at)
           VALUES ($1,$2,$3,$4,'runtime.offline','high','open','Agent Runtime 离线',$5,now(),now())
           ON CONFLICT (agent_id, code) WHERE status IN ('open','acknowledged') DO UPDATE SET last_seen_at=now(), summary=EXCLUDED.summary
           RETURNING *`,
          [randomUUID(), row.organization_id, row.agent_id, row.runtime_id, `超过 ${Math.round(staleAfterMs / 1000)} 秒未收到心跳`]
        );
        results.push(mapAlert(alertRows[0]));
      } else {
        await this.pool.query("UPDATE alerts SET status='resolved', resolved_at=COALESCE(resolved_at,now()) WHERE agent_id=$1 AND runtime_id=$2 AND code='runtime.offline' AND status IN ('open','acknowledged')", [row.agent_id, row.runtime_id]);
      }
    }
    return results;
  }

  async listUsageRollups(organizationId, userId, agentId, limit = 1000) {
    const conditions = [];
    const values = [];
    if (organizationId) { values.push(organizationId); conditions.push(`organization_id=$${values.length}`); }
    if (userId) { values.push(userId); conditions.push(`user_id=$${values.length}`); }
    if (agentId) { values.push(agentId); conditions.push(`agent_id=$${values.length}`); }
    values.push(Math.max(1, Math.min(Number(limit) || 1000, 5000)));
    const { rows } = await this.pool.query(`SELECT * FROM usage_rollups${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY bucket_start DESC LIMIT $${values.length}`, values);
    return rows.map(mapUsageRollup);
  }

  async requestAgentProvisioning(input) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: agentRows } = await client.query("SELECT * FROM agents WHERE id=$1 FOR UPDATE", [input.agentId]);
      const agent = mapAgent(agentRows[0]);
      if (!agent) { await client.query("ROLLBACK"); return null; }
      await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [agent.organizationId]);
      const { rows: runtimeRows } = await client.query("SELECT * FROM agent_runtimes WHERE agent_id=$1 FOR UPDATE", [agent.id]);
      const runtime = mapAgentRuntime(runtimeRows[0]);
      if (!runtime) { await client.query("ROLLBACK"); return null; }
      if (["provisioning", "ready"].includes(agent.initializationStatus)) {
        const { rows: deploymentRows } = await client.query("SELECT * FROM control_deployments WHERE agent_id=$1 ORDER BY created_at DESC LIMIT 1", [agent.id]);
        const { rows: commandRows } = deploymentRows[0] ? await client.query("SELECT * FROM control_commands WHERE deployment_id=$1 ORDER BY created_at DESC LIMIT 1", [deploymentRows[0].id]) : { rows: [] };
        await client.query("COMMIT");
        return { agent, runtime, deployment: deploymentRows[0] ?? null, command: commandRows[0] ?? null };
      }
      const { rows: serverRows } = await client.query("SELECT * FROM servers WHERE organization_id=$1 AND status IN ('active','healthy') ORDER BY last_seen_at DESC NULLS LAST, created_at LIMIT 1", [agent.organizationId]);
      if (!serverRows[0]) throw Object.assign(new Error("No healthy server is available for this Agent"), { code: "no_agent_capacity", statusCode: 409 });
      const { rows: revisionRows } = await client.query("SELECT COALESCE(MAX(revision),0)+1 AS next_revision FROM config_revisions WHERE organization_id=$1", [agent.organizationId]);
      const configId = randomUUID();
      const disabledSkills = (input.skills ?? []).filter((item) => item.enabled === false).map((item) => item.skillId).sort();
      const configDocument = { agent: { id: agent.id, name: agent.name, soul_markdown: agent.soulMarkdown }, runtime: { kind: "hermes", workspace_ref: runtime.workspaceRef }, provider: { provider: input.provider.provider, base_url: input.provider.baseUrl, model: input.provider.model }, skills: { disabled: disabledSkills } };
      const contentHash = createHash("sha256").update(JSON.stringify(configDocument)).digest("hex");
      await client.query("INSERT INTO config_revisions (id, organization_id, agent_id, revision, config_document, secret_envelope, content_hash, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'approved',$8)", [configId, agent.organizationId, agent.id, Number(revisionRows[0].next_revision), configDocument, input.secretEnvelope, contentHash, input.requestedBy]);
      await client.query("UPDATE agent_runtime_credentials SET status='revoked', revoked_at=now() WHERE runtime_id=$1 AND status='active'", [runtime.id]);
      await client.query("INSERT INTO agent_runtime_credentials (id, organization_id, user_id, agent_id, runtime_id, key_hash, key_hint, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)", [input.agentCredentialId ?? randomUUID(), agent.organizationId, agent.ownerUserId, agent.id, runtime.id, input.agentCredentialHash, input.agentCredentialHint, input.requestedBy]);
      const deploymentId = randomUUID();
      await client.query("INSERT INTO control_deployments (id, organization_id, server_id, agent_id, name, environment, status, desired_state_version) VALUES ($1,$2,$3,$4,$5,'production','enrolling',1)", [deploymentId, agent.organizationId, serverRows[0].id, agent.id, agent.name]);
      await client.query("INSERT INTO desired_states (id, deployment_id, version, config_revision_id, module_versions, created_by) VALUES ($1,$2,1,$3,$4,$5)", [randomUUID(), deploymentId, configId, { "core-runtime": "hermes" }, input.requestedBy]);
      const commandId = randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60_000);
      const args = { agent_id: agent.id, workspace_ref: runtime.workspaceRef, config_revision_id: configId };
      await client.query("INSERT INTO control_commands (id, deployment_id, idempotency_key, action, target_module_id, target_instance_id, arguments, expected_observation_version, state, expires_at, requested_by) VALUES ($1,$2,$3,'deployment.provision','bairui.supervisor',$4,$5,0,'queued',$6,$7)", [commandId, deploymentId, `${deploymentId}/provision/${configId}`, agent.id, args, expiresAt.toISOString(), input.requestedBy]);
      await client.query("UPDATE agent_runtimes SET deployment_id=$2, config_revision_id=$3, status='provisioning', updated_at=now() WHERE id=$1", [runtime.id, deploymentId, configId]);
      const { rows: updatedAgents } = await client.query("UPDATE agents SET initialization_status='provisioning', desired_runtime_state='running', status='provisioning', updated_at=now() WHERE id=$1 RETURNING *", [agent.id]);
      const { rows: updatedRuntimes } = await client.query("SELECT * FROM agent_runtimes WHERE id=$1", [runtime.id]);
      await client.query("COMMIT");
      return { agent: mapAgent(updatedAgents[0]), runtime: mapAgentRuntime(updatedRuntimes[0]), deployment: { id: deploymentId, serverId: serverRows[0].id, status: "enrolling" }, command: { id: commandId, action: "deployment.provision", arguments: args, state: "queued" } };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async requestAgentSkillConfiguration(input) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: identityRows } = await client.query(
        `SELECT agent.*, runtime.id AS runtime_id, runtime.deployment_id, runtime.config_revision_id
         FROM agents agent JOIN agent_runtimes runtime ON runtime.agent_id=agent.id
         WHERE agent.id=$1 AND agent.organization_id=$2 AND agent.owner_user_id=$3
         FOR UPDATE OF agent, runtime`,
        [input.agentId, input.organizationId, input.userId]
      );
      const identity = identityRows[0];
      if (!identity) { await client.query("ROLLBACK"); return null; }
      if (!identity.deployment_id || !identity.config_revision_id) { await client.query("COMMIT"); return { revision: null, command: null }; }
      const { rows: configRows } = await client.query("SELECT * FROM config_revisions WHERE id=$1 AND agent_id=$2 FOR SHARE", [identity.config_revision_id, input.agentId]);
      const current = configRows[0];
      const { rows: deploymentRows } = await client.query("SELECT * FROM control_deployments WHERE id=$1 AND status<>'revoked' FOR UPDATE", [identity.deployment_id]);
      const deployment = deploymentRows[0];
      if (!current || !deployment) throw Object.assign(new Error("Agent configuration is unavailable"), { code: "agent_configuration_unavailable", statusCode: 409 });
      const { rows: revisionRows } = await client.query("SELECT COALESCE(MAX(revision),0)+1 AS next_revision FROM config_revisions WHERE organization_id=$1", [input.organizationId]);
      const revision = Number(revisionRows[0].next_revision);
      const { rows: preferenceRows } = await client.query("SELECT skill_id,enabled FROM agent_skill_preferences WHERE organization_id=$1 AND user_id=$2 AND agent_id=$3 ORDER BY skill_id", [input.organizationId, input.userId, input.agentId]);
      const disabled = preferenceRows.filter((item) => item.enabled === false).map((item) => item.skill_id);
      const configDocument = { ...current.config_document, owner_change: { scope: "skills", generation: revision }, skills: { disabled } };
      const contentHash = createHash("sha256").update(JSON.stringify(configDocument)).digest("hex");
      const configId = randomUUID();
      const { rows: insertedConfigs } = await client.query(
        "INSERT INTO config_revisions (id, organization_id, agent_id, revision, config_document, secret_envelope, content_hash, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'approved',$8) RETURNING *",
        [configId, input.organizationId, input.agentId, revision, configDocument, current.secret_envelope, contentHash, input.requestedBy]
      );
      const { rows: superseded } = await client.query(
        "UPDATE control_commands SET state='cancelled', updated_at=now() WHERE deployment_id=$1 AND action='config.apply-user' AND state='queued' RETURNING arguments->>'config_revision_id' AS config_id",
        [deployment.id]
      );
      if (superseded.length) await client.query("UPDATE config_revisions SET status='superseded' WHERE id=ANY($1::text[]) AND status='approved'", [superseded.map((item) => item.config_id)]);
      const commandId = randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
      const idempotencyKey = `${deployment.id}/config.apply-user/${configId}`;
      await client.query(
        `INSERT INTO control_commands (id, deployment_id, idempotency_key, action, target_module_id, target_instance_id, arguments, expected_observation_version, state, priority, expires_at, requested_by)
         VALUES ($1,$2,$3,'config.apply-user','bairui.supervisor',$4,$5,$6,'queued',200,$7,$8)`,
        [commandId, deployment.id, idempotencyKey, input.agentId, { config_revision_id: configId }, Number(deployment.observed_state_version), expiresAt, input.requestedBy]
      );
      await client.query("COMMIT");
      return { revision: mapConfigRevision(insertedConfigs[0]), command: { id: commandId, organizationId: input.organizationId, deploymentId: deployment.id, agentId: input.agentId, idempotencyKey, action: "config.apply-user", arguments: { config_revision_id: configId }, approvalId: null, state: "queued", priority: 200, requestedBy: input.requestedBy, expiresAt } };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async requestAgentLifecycle(input) {
    const actionByRequest = { pause: "deployment.suspend", resume: "deployment.resume", delete: "deployment.delete" };
    const action = actionByRequest[input.request];
    if (!action) throw new TypeError("Unsupported Agent lifecycle request");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: agentRows } = await client.query("SELECT * FROM agents WHERE id=$1 FOR UPDATE", [input.agentId]);
      const agent = mapAgent(agentRows[0]);
      if (!agent) { await client.query("ROLLBACK"); return null; }
      const { rows: runtimeRows } = await client.query("SELECT * FROM agent_runtimes WHERE agent_id=$1 FOR UPDATE", [agent.id]);
      const runtime = mapAgentRuntime(runtimeRows[0]);
      if (!runtime) { await client.query("ROLLBACK"); return null; }
      if (!runtime.deploymentId) {
        if (input.request !== "delete") throw Object.assign(new Error("Agent has not been initialized"), { code: "agent_not_initialized", statusCode: 409 });
        await client.query("DELETE FROM agents WHERE id=$1", [agent.id]);
        await client.query("COMMIT");
        return { agentId: agent.id, action, state: "succeeded", deleted: true, command: null };
      }
      const { rows: deploymentRows } = await client.query("SELECT * FROM control_deployments WHERE id=$1 FOR UPDATE", [runtime.deploymentId]);
      const deployment = deploymentRows[0];
      if (!deployment) throw Object.assign(new Error("Agent deployment is unavailable"), { code: "agent_deployment_unavailable", statusCode: 409 });
      if (input.request === "pause" && runtime.status === "suspended") { await client.query("COMMIT"); return { agentId: agent.id, action, state: "succeeded", deleted: false, command: null }; }
      if (input.request === "resume" && runtime.status !== "suspended") throw Object.assign(new Error("Agent is not suspended"), { code: "invalid_agent_lifecycle_state", statusCode: 409 });
      const { rows: existingRows } = await client.query("SELECT * FROM control_commands WHERE deployment_id=$1 AND action IN ('deployment.start','deployment.stop','deployment.suspend','deployment.resume','deployment.delete') AND state IN ('queued','leased','accepted','running') ORDER BY created_at DESC LIMIT 1", [deployment.id]);
      if (existingRows[0]) {
        if (existingRows[0].action !== action) throw Object.assign(new Error("Another Agent lifecycle command is in progress"), { code: "agent_lifecycle_in_progress", statusCode: 409 });
        await client.query("COMMIT");
        return { agentId: agent.id, action, state: existingRows[0].state, deleted: false, command: { id: existingRows[0].id, action, state: existingRows[0].state } };
      }
      const commandId = randomUUID();
      const approvalId = input.request === "delete" ? randomUUID() : null;
      const version = Number(deployment.desired_state_version) + 1;
      const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      await client.query(
        `INSERT INTO control_commands (id, deployment_id, idempotency_key, action, target_module_id, target_instance_id, arguments, approval_id, expected_observation_version, state, expires_at, requested_by)
         VALUES ($1,$2,$3,$4,'bairui.supervisor',$5,$6,$7,$8,'queued',$9,$10)`,
        [commandId, deployment.id, `${deployment.id}/${action}/${version}`, action, agent.id, { agent_id: agent.id }, approvalId, Number(deployment.observed_state_version), expiresAt, input.requestedBy]
      );
      if (approvalId) {
        await client.query("INSERT INTO control_approvals (id, command_id, risk_level, requested_by, decided_by, decision, reason, expires_at, decided_at) VALUES ($1,$2,'high',$3,$3,'approved',$4,$5,now())", [approvalId, commandId, input.requestedBy, input.reason ?? "Agent owner confirmed deletion", expiresAt]);
      }
      await client.query("UPDATE control_deployments SET desired_state_version=$2, updated_at=now() WHERE id=$1", [deployment.id, version]);
      const desiredState = input.request === "pause" ? "suspended" : input.request === "resume" ? "running" : "deleted";
      await client.query("UPDATE agents SET desired_runtime_state=$2, initialization_status=CASE WHEN $2='deleted' THEN 'deleting' ELSE initialization_status END, updated_at=now() WHERE id=$1", [agent.id, desiredState]);
      if (input.request === "delete") await client.query("UPDATE agent_runtimes SET status='deleting', updated_at=now() WHERE id=$1", [runtime.id]);
      await client.query("COMMIT");
      return { agentId: agent.id, action, state: "queued", deleted: false, command: { id: commandId, action, state: "queued", approvalId } };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async requestControlOperation(input) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: deploymentRows } = await client.query("SELECT deployment.* FROM control_deployments deployment JOIN agents agent ON agent.id=deployment.agent_id WHERE deployment.agent_id=$1 AND deployment.organization_id=$2 AND deployment.status<>'revoked' ORDER BY deployment.created_at DESC LIMIT 1 FOR UPDATE OF deployment", [input.agentId, input.organizationId]);
      const deployment = deploymentRows[0];
      if (!deployment) throw Object.assign(new Error("Agent deployment is unavailable"), { code: "agent_deployment_unavailable", statusCode: 409 });
      if (["config.stage", "config.apply", "config.apply-user"].includes(input.action)) {
        const { rowCount } = await client.query("SELECT id FROM config_revisions WHERE id=$1 AND organization_id=$2 AND agent_id=$3", [input.arguments.config_revision_id, input.organizationId, input.agentId]);
        if (rowCount !== 1) throw Object.assign(new Error("Configuration revision does not belong to this Agent"), { code: "invalid_control_reference", statusCode: 400 });
      }
      if (input.action === "backup.verify") {
        const { rowCount } = await client.query("SELECT id FROM backup_records WHERE id=$1 AND deployment_id=$2", [input.arguments.backup_id, deployment.id]);
        if (rowCount !== 1) throw Object.assign(new Error("Backup does not belong to this Agent"), { code: "invalid_control_reference", statusCode: 400 });
      }
      if (input.action === "backup.restore") {
        const { rowCount } = await client.query("SELECT id FROM backup_records WHERE id=$1 AND deployment_id=$2 AND status='verified'", [input.arguments.backup_id, deployment.id]);
        if (rowCount !== 1) throw Object.assign(new Error("Verified backup is unavailable for this Agent"), { code: "invalid_control_reference", statusCode: 400 });
      }
      if (["release.stage", "release.apply"].includes(input.action)) {
        const { rowCount } = await client.query("SELECT id FROM release_manifests WHERE id=$1 AND status IN ('candidate','approved','released')", [input.arguments.release_id]);
        if (rowCount !== 1) throw Object.assign(new Error("Release manifest is unavailable"), { code: "invalid_control_reference", statusCode: 400 });
      }
      if (input.action === "release.rollback") {
        const { rows } = await client.query("SELECT id FROM release_manifests WHERE id=ANY($1::text[])", [[input.arguments.release_id, input.arguments.rollback_release_id]]);
        if (new Set(rows.map((row) => row.id)).size !== 2) throw Object.assign(new Error("Rollback manifests are unavailable"), { code: "invalid_control_reference", statusCode: 400 });
      }
      if (input.action === "upstream.check" && input.arguments.candidate_id) {
        const { rowCount } = await client.query("SELECT id FROM upstream_candidates WHERE id=$1 AND upstream_id=$2", [input.arguments.candidate_id, input.arguments.upstream_id]);
        if (rowCount !== 1) throw Object.assign(new Error("Upstream candidate is unavailable"), { code: "invalid_control_reference", statusCode: 400 });
      }
      if (input.action === "credential.revoke") {
        const { rowCount } = await client.query("SELECT id FROM agent_runtime_credentials WHERE id=$1 AND agent_id=$2 AND status='active'", [input.arguments.identity_id, input.agentId]);
        if (rowCount !== 1) throw Object.assign(new Error("Agent credential is unavailable"), { code: "invalid_control_reference", statusCode: 400 });
      }
      const idempotencyKey = input.idempotencyKey ?? `${deployment.id}/${input.action}/${randomUUID()}`;
      const { rows: existingRows } = await client.query("SELECT command.*, $2::text AS organization_id, $3::text AS agent_id FROM control_commands command WHERE command.deployment_id=$1 AND command.idempotency_key=$4", [deployment.id, input.organizationId, input.agentId, idempotencyKey]);
      if (existingRows[0]) {
        let approval = null;
        if (existingRows[0].approval_id) {
          const { rows } = await client.query("SELECT approval.*, $2::text AS organization_id, $3::text AS action FROM control_approvals approval WHERE approval.id=$1", [existingRows[0].approval_id, input.organizationId, input.action]);
          approval = mapControlApproval(rows[0]);
        }
        await client.query("COMMIT");
        return { command: mapControlCommand(existingRows[0]), approval };
      }
      const commandId = input.commandId ?? randomUUID();
      const approvalId = input.approvalRequired ? input.approvalId ?? randomUUID() : null;
      const expiresAt = new Date(Date.now() + Math.max(5 * 60_000, Math.min(input.expiresInMs ?? 30 * 60_000, 24 * 60 * 60_000))).toISOString();
      await client.query(
        `INSERT INTO control_commands (id, deployment_id, idempotency_key, action, target_module_id, target_instance_id, arguments, approval_id, expected_observation_version, state, priority, expires_at, requested_by)
         VALUES ($1,$2,$3,$4,'bairui.supervisor',$5,$6,$7,$8,'queued',$9,$10,$11)`,
        [commandId, deployment.id, idempotencyKey, input.action, input.agentId, input.arguments, approvalId, Number(deployment.observed_state_version), input.priority ?? 100, expiresAt, input.requestedBy]
      );
      let approval = null;
      if (approvalId) {
        const { rows } = await client.query("INSERT INTO control_approvals (id, command_id, risk_level, requested_by, decision, reason, expires_at) VALUES ($1,$2,$3,$4,'pending',$5,$6) RETURNING *", [approvalId, commandId, input.riskLevel ?? "high", input.requestedBy, input.reason ?? "", expiresAt]);
        approval = mapControlApproval({ ...rows[0], organization_id: input.organizationId, action: input.action });
      }
      if (["probe.run", "contract.test", "smoke.test"].includes(input.action) && input.arguments.test_run_id) {
        const testType = input.action === "probe.run" ? "probe" : input.action === "contract.test" ? "contract" : "smoke";
        const suiteId = input.action === "probe.run" ? input.arguments.probe_ids.join(",") : input.arguments.suite_id;
        await client.query("INSERT INTO test_runs (id, deployment_id, suite_id, test_type, status) VALUES ($1,$2,$3,$4,'queued') ON CONFLICT (id) DO NOTHING", [input.arguments.test_run_id, deployment.id, suiteId, testType]);
      }
      if (input.action === "backup.create" && input.arguments.backup_id) await client.query("INSERT INTO backup_records (id, deployment_id, policy_id, backup_type, status, encrypted, expires_at) VALUES ($1,$2,$3,'runtime-files','creating',true,now()+make_interval(days => COALESCE((SELECT backup_days FROM data_retention_policies WHERE organization_id=$4),30))) ON CONFLICT (id) DO NOTHING", [input.arguments.backup_id, deployment.id, input.arguments.backup_policy_id, input.organizationId]);
      if (input.action === "backup.restore") await client.query("INSERT INTO backup_restore_runs (id, backup_id, deployment_id, command_id, status, requested_by, reason) VALUES ($1,$2,$3,$4,'requested',$5,$6)", [input.arguments.restore_id, input.arguments.backup_id, deployment.id, commandId, input.requestedBy, input.reason]);
      await client.query("COMMIT");
      return { command: { id: commandId, organizationId: input.organizationId, deploymentId: deployment.id, agentId: input.agentId, idempotencyKey, action: input.action, arguments: input.arguments, approvalId, state: "queued", priority: input.priority ?? 100, requestedBy: input.requestedBy, expiresAt, createdAt: new Date().toISOString() }, approval };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async listControlCommands(organizationId, limit = 500) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
    const query = organizationId
      ? ["SELECT command.*, deployment.organization_id, deployment.agent_id FROM control_commands command JOIN control_deployments deployment ON deployment.id=command.deployment_id WHERE deployment.organization_id=$1 ORDER BY command.created_at DESC LIMIT $2", [organizationId, safeLimit]]
      : ["SELECT command.*, deployment.organization_id, deployment.agent_id FROM control_commands command JOIN control_deployments deployment ON deployment.id=command.deployment_id ORDER BY command.created_at DESC LIMIT $1", [safeLimit]];
    const { rows } = await this.pool.query(...query);
    return rows.map(mapControlCommand);
  }

  async listControlApprovals(organizationId, limit = 500) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
    const query = organizationId
      ? ["SELECT approval.*, command.action, deployment.organization_id FROM control_approvals approval JOIN control_commands command ON command.id=approval.command_id JOIN control_deployments deployment ON deployment.id=command.deployment_id WHERE deployment.organization_id=$1 ORDER BY approval.created_at DESC LIMIT $2", [organizationId, safeLimit]]
      : ["SELECT approval.*, command.action, deployment.organization_id FROM control_approvals approval JOIN control_commands command ON command.id=approval.command_id JOIN control_deployments deployment ON deployment.id=command.deployment_id ORDER BY approval.created_at DESC LIMIT $1", [safeLimit]];
    const { rows } = await this.pool.query(...query);
    return rows.map(mapControlApproval);
  }

  async decideControlApproval(input) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT approval.*, command.action, deployment.organization_id FROM control_approvals approval JOIN control_commands command ON command.id=approval.command_id JOIN control_deployments deployment ON deployment.id=command.deployment_id WHERE approval.id=$1 FOR UPDATE OF approval", [input.approvalId]);
      const current = rows[0];
      if (!current || (input.organizationId && current.organization_id !== input.organizationId)) { await client.query("ROLLBACK"); return null; }
      if (current.decision !== "pending" || new Date(current.expires_at).getTime() <= Date.now()) throw Object.assign(new Error("Approval is no longer pending"), { code: "approval_not_pending", statusCode: 409 });
      const { rows: updated } = await client.query("UPDATE control_approvals SET decision=$2, decided_by=$3, reason=$4, decided_at=now() WHERE id=$1 RETURNING *", [input.approvalId, input.decision, input.decidedBy, input.reason]);
      if (input.decision === "rejected") await client.query("UPDATE control_commands SET state='cancelled', updated_at=now() WHERE id=$1 AND state='queued'", [current.command_id]);
      if (input.decision === "rejected" && current.action === "backup.restore") await client.query("UPDATE backup_restore_runs SET status='cancelled', error_code='approval_rejected', error_summary='Backup restore approval was rejected', completed_at=now() WHERE command_id=$1 AND status='requested'", [current.command_id]);
      await client.query("COMMIT");
      return mapControlApproval({ ...updated[0], organization_id: current.organization_id, action: current.action });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async createReleaseManifest(input) {
    const { rows } = await this.pool.query(
      `INSERT INTO release_manifests (id, release_id, version, agent_commit, image_digest, sbom_uri, provenance_uri, signature, migration_version, compatibility, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [input.id ?? randomUUID(), input.releaseId ?? null, input.version, input.agentCommit, input.imageDigest, input.sbomUri, input.provenanceUri, input.signature, input.migrationVersion ?? null, input.compatibility, input.status ?? "candidate", input.createdBy]
    );
    return mapReleaseManifest(rows[0]);
  }

  async listReleaseManifests() {
    const { rows } = await this.pool.query("SELECT * FROM release_manifests ORDER BY created_at DESC");
    return rows.map(mapReleaseManifest);
  }

  async createServerCredential(input) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE server_credentials SET status='revoked', revoked_at=now() WHERE server_id=$1 AND status='active'", [input.serverId]);
      const { rows } = await client.query("INSERT INTO server_credentials (id, server_id, key_hash, key_hint, status, created_by, expires_at) VALUES ($1,$2,$3,$4,'active',$5,$6) RETURNING *", [input.id ?? randomUUID(), input.serverId, input.keyHash, input.keyHint, input.createdBy ?? null, input.expiresAt ?? null]);
      await client.query("COMMIT");
      return { id: rows[0].id, serverId: rows[0].server_id, keyHash: rows[0].key_hash, keyHint: rows[0].key_hint, status: rows[0].status };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async getActiveServerCredential(serverId) {
    const { rows } = await this.pool.query("SELECT * FROM server_credentials WHERE server_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 1", [serverId]);
    const row = rows[0];
    return row ? { id: row.id, serverId: row.server_id, keyHash: row.key_hash, keyHint: row.key_hint, status: row.status } : null;
  }

  async getActiveAgentRuntimeCredential(agentId) {
    const { rows } = await this.pool.query("SELECT * FROM agent_runtime_credentials WHERE agent_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 1", [agentId]);
    const row = rows[0];
    return row ? { id: row.id, organizationId: row.organization_id, userId: row.user_id, agentId: row.agent_id, runtimeId: row.runtime_id, keyHash: row.key_hash, keyHint: row.key_hint, status: row.status } : null;
  }

  async claimMachineNonce(input) {
    const { rowCount } = await this.pool.query("INSERT INTO machine_request_nonces (credential_type, credential_id, nonce, timestamp_ms, expires_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [input.credentialType, input.credentialId, input.nonce, input.timestampMs, input.expiresAt]);
    return rowCount === 1;
  }

  async leaseControlCommands(input) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE control_commands SET state='expired', updated_at=now() WHERE state IN ('queued','leased') AND expires_at <= now()");
      await client.query("UPDATE backup_restore_runs restore SET status='cancelled', error_code='command_expired', error_summary='Backup restore command expired', completed_at=now() FROM control_commands command WHERE restore.command_id=command.id AND command.state='expired' AND restore.status='requested'");
      await client.query("UPDATE backup_records backup SET status='failed' FROM control_commands command WHERE command.action='backup.expire' AND command.state='expired' AND backup.id=command.arguments->>'backup_id' AND backup.status='expiring'");
      await client.query("UPDATE control_commands SET state='queued', lease_server_id=NULL, lease_expires_at=NULL, updated_at=now() WHERE state IN ('leased','accepted','running') AND lease_expires_at <= now() AND expires_at > now()");
      const { rows } = await client.query(
        `SELECT command.*, deployment.agent_id, deployment.server_id, deployment.organization_id,
                runtime.id AS runtime_id, runtime.owner_user_id, runtime.workspace_ref,
                config.config_document, config.secret_envelope,
                release.id AS release_manifest_id, release.version AS release_version, release.compatibility AS release_compatibility,
                rollback.id AS rollback_manifest_id, rollback.version AS rollback_version, rollback.compatibility AS rollback_compatibility
         FROM control_commands command
         JOIN control_deployments deployment ON deployment.id=command.deployment_id
         JOIN agent_runtimes runtime ON runtime.agent_id=deployment.agent_id
         LEFT JOIN config_revisions config ON config.id=(command.arguments->>'config_revision_id')
         LEFT JOIN release_manifests release ON release.id=(command.arguments->>'release_id')
         LEFT JOIN release_manifests rollback ON rollback.id=(command.arguments->>'rollback_release_id')
         WHERE deployment.server_id=$1 AND command.state='queued' AND command.not_before <= now() AND command.expires_at > now()
           AND (command.approval_id IS NULL OR EXISTS (SELECT 1 FROM control_approvals approval WHERE approval.id=command.approval_id AND approval.command_id=command.id AND approval.decision='approved' AND approval.expires_at > now()))
         ORDER BY command.priority, command.created_at
         FOR UPDATE OF command SKIP LOCKED LIMIT $2`,
        [input.serverId, Math.max(1, Math.min(input.limit ?? 10, 50))]
      );
      const leased = [];
      for (const row of rows) {
        const { rows: attemptRows } = await client.query("SELECT COALESCE(MAX(attempt),0)+1 AS attempt FROM command_attempts WHERE command_id=$1", [row.id]);
        const attempt = Number(attemptRows[0].attempt);
        const leaseExpiresAt = new Date(Date.now() + Math.max(15, Math.min(input.leaseSeconds ?? 60, 300)) * 1000).toISOString();
        await client.query("UPDATE control_commands SET state='leased', lease_server_id=$2, lease_expires_at=$3, updated_at=now() WHERE id=$1", [row.id, input.serverId, leaseExpiresAt]);
        await client.query("INSERT INTO command_attempts (id, command_id, attempt, state) VALUES ($1,$2,$3,'leased')", [randomUUID(), row.id, attempt]);
        leased.push({
          schema_version: "1.0", command_id: row.id, idempotency_key: row.idempotency_key,
          deployment_id: row.deployment_id, action: row.action,
          target: { module_id: row.target_module_id, ...(row.target_instance_id ? { instance_id: row.target_instance_id } : {}) },
          arguments: row.arguments, ...(row.approval_id ? { approval_id: row.approval_id } : {}),
          expected_observation_version: Number(row.expected_observation_version), created_at: row.created_at.toISOString(), expires_at: row.expires_at.toISOString(),
          attempt, lease_expires_at: leaseExpiresAt,
          placement: { server_id: row.server_id, agent_id: row.agent_id, runtime_id: row.runtime_id, organization_id: row.organization_id, user_id: row.owner_user_id, workspace_ref: row.workspace_ref },
          config: row.config_document ? { document: row.config_document, ...(row.action === "config.apply-user" ? {} : { secret_envelope: row.secret_envelope }) } : null,
          ...(row.release_manifest_id ? { release: { id: row.release_manifest_id, version: row.release_version, hermes_image: row.release_compatibility?.hermes_image, runtime_image: row.release_compatibility?.runtime_image } } : {}),
          ...(row.rollback_manifest_id ? { rollback_release: { id: row.rollback_manifest_id, version: row.rollback_version, hermes_image: row.rollback_compatibility?.hermes_image, runtime_image: row.rollback_compatibility?.runtime_image } } : {})
        });
      }
      await client.query("COMMIT");
      return leased;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async recordCommandReceipt(input) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: commandRows } = await client.query("SELECT * FROM control_commands WHERE id=$1 FOR UPDATE", [input.commandId]);
      const command = commandRows[0];
      if (!command || command.lease_server_id !== input.serverId) { await client.query("ROLLBACK"); return null; }
      const { rows: attemptRows } = await client.query("SELECT * FROM command_attempts WHERE command_id=$1 AND attempt=$2 FOR UPDATE", [command.id, input.attempt]);
      if (!attemptRows[0]) { await client.query("ROLLBACK"); return null; }
      const allowed = { leased: ["accepted"], accepted: ["running"], running: ["succeeded", "failed", "cancelled"] };
      if (command.state !== input.state && !allowed[command.state]?.includes(input.state)) throw Object.assign(new Error(`Invalid command transition: ${command.state} -> ${input.state}`), { statusCode: 409, code: "invalid_command_transition" });
      const receiptId = randomUUID();
      const { rows: inserted } = await client.query(
        `INSERT INTO command_receipts (id, command_id, deployment_id, server_id, attempt, state, error_code, error_summary, runtime_endpoint_ref, result_summary, evidence_refs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (command_id, attempt, state) DO NOTHING RETURNING *`,
        [receiptId, command.id, command.deployment_id, input.serverId, input.attempt, input.state, input.errorCode ?? null, input.errorSummary ?? null, input.runtimeEndpointRef ?? null, input.resultSummary ?? {}, input.evidenceRefs ?? []]
      );
      await client.query("UPDATE control_commands SET state=$2, updated_at=now() WHERE id=$1", [command.id, input.state]);
      if (input.state === "running") await client.query("UPDATE control_commands SET lease_expires_at=now()+interval '5 minutes' WHERE id=$1", [command.id]);
      await client.query("UPDATE command_attempts SET state=$3, error_code=$4, error_summary=$5, started_at=CASE WHEN $3 IN ('accepted','running') THEN COALESCE(started_at,now()) ELSE started_at END, completed_at=CASE WHEN $3 IN ('succeeded','failed','cancelled','expired') THEN now() ELSE completed_at END WHERE command_id=$1 AND attempt=$2", [command.id, input.attempt, input.state, input.errorCode ?? null, input.errorSummary ?? null]);
      if (input.state === "succeeded" && command.action === "deployment.provision") {
        if (!input.runtimeEndpointRef) throw Object.assign(new Error("Provision receipt requires runtimeEndpointRef"), { statusCode: 400, code: "runtime_endpoint_required" });
        await client.query("UPDATE agent_runtimes runtime SET endpoint_ref=$2, route_updated_at=now(), status='starting', updated_at=now() FROM control_deployments deployment WHERE deployment.id=$1 AND runtime.agent_id=deployment.agent_id", [command.deployment_id, input.runtimeEndpointRef]);
        await client.query("UPDATE control_deployments SET status='active', updated_at=now() WHERE id=$1", [command.deployment_id]);
        await client.query("UPDATE config_revisions SET status='applied' WHERE id=$1", [command.arguments.config_revision_id]);
        await client.query(
          `UPDATE agent_skill_preferences preference
           SET apply_status='applied', last_error_code=NULL, updated_at=now()
           FROM config_revisions revision
           WHERE revision.id=$1 AND preference.agent_id=revision.agent_id
             AND preference.enabled = (NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(COALESCE(revision.config_document->'skills'->'disabled','[]'::jsonb)) disabled(skill_id)
               WHERE disabled.skill_id=preference.skill_id
             ))`,
          [command.arguments.config_revision_id]
        );
      }
      if (input.state === "succeeded" && ["deployment.start", "deployment.resume"].includes(command.action)) {
        await client.query("UPDATE agent_runtimes runtime SET status='starting', last_error_code=NULL, last_error_detail=NULL, updated_at=now() FROM control_deployments deployment WHERE deployment.id=$1 AND runtime.agent_id=deployment.agent_id", [command.deployment_id]);
        await client.query("UPDATE agents agent SET status='starting', desired_runtime_state='running', last_error_code=NULL, last_error_detail=NULL, updated_at=now() FROM control_deployments deployment WHERE deployment.id=$1 AND agent.id=deployment.agent_id", [command.deployment_id]);
      }
      if (input.state === "succeeded" && command.action === "deployment.suspend") {
        await client.query("UPDATE agent_runtimes runtime SET status='suspended', updated_at=now() FROM control_deployments deployment WHERE deployment.id=$1 AND runtime.agent_id=deployment.agent_id", [command.deployment_id]);
        await client.query("UPDATE agents agent SET status='suspended', desired_runtime_state='suspended', updated_at=now() FROM control_deployments deployment WHERE deployment.id=$1 AND agent.id=deployment.agent_id", [command.deployment_id]);
      }
      if (input.state === "succeeded" && command.action === "deployment.stop") {
        await client.query("UPDATE agent_runtimes runtime SET status='stopped', updated_at=now() FROM control_deployments deployment WHERE deployment.id=$1 AND runtime.agent_id=deployment.agent_id", [command.deployment_id]);
        await client.query("UPDATE agents agent SET status='stopped', desired_runtime_state='stopped', updated_at=now() FROM control_deployments deployment WHERE deployment.id=$1 AND agent.id=deployment.agent_id", [command.deployment_id]);
      }
      if (input.state === "succeeded" && command.action === "deployment.delete") {
        await client.query("UPDATE agent_runtimes runtime SET status='deleted', endpoint_ref=NULL, route_updated_at=now(), updated_at=now() FROM control_deployments deployment WHERE deployment.id=$1 AND runtime.agent_id=deployment.agent_id", [command.deployment_id]);
        await client.query("UPDATE agents agent SET status='deleted', desired_runtime_state='deleted', updated_at=now() FROM control_deployments deployment WHERE deployment.id=$1 AND agent.id=deployment.agent_id", [command.deployment_id]);
        await client.query("UPDATE control_deployments SET status='revoked', updated_at=now() WHERE id=$1", [command.deployment_id]);
      }
      if (input.state === "failed" && command.action === "deployment.provision") {
        await client.query("UPDATE agent_runtimes runtime SET status='failed', last_error_code=$2, last_error_detail=$3, updated_at=now() FROM control_deployments deployment WHERE deployment.id=$1 AND runtime.agent_id=deployment.agent_id", [command.deployment_id, input.errorCode ?? "command_failed", input.errorSummary ?? "Control command failed"]);
        await client.query("UPDATE agents agent SET status='failed', initialization_status='failed', last_error_code=$2, last_error_detail=$3, updated_at=now() FROM control_deployments deployment WHERE deployment.id=$1 AND agent.id=deployment.agent_id", [command.deployment_id, input.errorCode ?? "command_failed", input.errorSummary ?? "Control command failed"]);
        await client.query("UPDATE control_deployments SET status='degraded', updated_at=now() WHERE id=$1", [command.deployment_id]);
      }
      if (input.state === "failed" && ["deployment.start", "deployment.stop", "deployment.suspend", "deployment.resume", "deployment.delete", "config.apply", "release.apply", "release.rollback", "service.restart", "credential.revoke"].includes(command.action)) {
        await client.query("UPDATE agent_runtimes runtime SET status=CASE WHEN $4='deployment.delete' THEN 'degraded' ELSE runtime.status END, last_error_code=$2, last_error_detail=$3, updated_at=now() FROM control_deployments deployment WHERE deployment.id=$1 AND runtime.agent_id=deployment.agent_id", [command.deployment_id, input.errorCode ?? "command_failed", input.errorSummary ?? "Control command failed", command.action]);
        await client.query("UPDATE agents agent SET status='degraded', initialization_status=CASE WHEN $4='deployment.delete' THEN 'failed' ELSE agent.initialization_status END, last_error_code=$2, last_error_detail=$3, updated_at=now() FROM control_deployments deployment WHERE deployment.id=$1 AND agent.id=deployment.agent_id", [command.deployment_id, input.errorCode ?? "command_failed", input.errorSummary ?? "Control command failed", command.action]);
        await client.query("UPDATE control_deployments SET status='degraded', updated_at=now() WHERE id=$1", [command.deployment_id]);
      }
      if (["config.stage", "config.apply", "config.apply-user"].includes(command.action)) {
        const configId = command.arguments.config_revision_id;
        if (input.state === "running" && ["config.apply", "config.apply-user"].includes(command.action)) await client.query("UPDATE config_revisions SET status='applying' WHERE id=$1", [configId]);
        if (input.state === "succeeded") await client.query("UPDATE config_revisions SET status=$2 WHERE id=$1", [configId, command.action === "config.stage" ? "staged" : "applied"]);
        if (input.state === "failed") await client.query("UPDATE config_revisions SET status='failed' WHERE id=$1", [configId]);
        if (input.state === "succeeded" && ["config.apply", "config.apply-user"].includes(command.action)) await client.query("UPDATE agent_runtimes runtime SET config_revision_id=$2, updated_at=now() FROM control_deployments deployment WHERE deployment.id=$1 AND runtime.agent_id=deployment.agent_id", [command.deployment_id, configId]);
        if (command.action === "config.apply-user" && ["succeeded", "failed"].includes(input.state)) {
          await client.query(
            `UPDATE agent_skill_preferences preference
             SET apply_status=$2, last_error_code=$3, updated_at=now()
             FROM config_revisions revision
             WHERE revision.id=$1 AND preference.agent_id=revision.agent_id
               AND preference.enabled = (NOT EXISTS (
                 SELECT 1 FROM jsonb_array_elements_text(COALESCE(revision.config_document->'skills'->'disabled','[]'::jsonb)) disabled(skill_id)
                 WHERE disabled.skill_id=preference.skill_id
               ))`,
            [configId, input.state === "succeeded" ? "applied" : "failed", input.state === "failed" ? input.errorCode ?? "config_apply_failed" : null]
          );
        }
      }
      if (input.state === "succeeded" && ["deployment.provision", "config.apply"].includes(command.action)) {
        const configId = command.arguments.config_revision_id;
        await client.query(
          `UPDATE provider_configurations provider SET apply_status='applied', updated_at=now()
           FROM config_revisions revision
           WHERE revision.id=$1 AND provider.organization_id=revision.organization_id
             AND provider.provider=revision.config_document->'provider'->>'provider'
             AND provider.base_url=revision.config_document->'provider'->>'base_url'
             AND provider.model=revision.config_document->'provider'->>'model'`,
          [configId]
        );
        await client.query(
          `UPDATE provider_channels channel SET status='applied', last_error_code=NULL, updated_at=now()
           FROM config_revisions revision
           WHERE revision.id=$1 AND channel.organization_id=revision.organization_id
             AND channel.provider=revision.config_document->'provider'->>'provider'
             AND channel.base_url=revision.config_document->'provider'->>'base_url'
             AND channel.model=revision.config_document->'provider'->>'model'`,
          [configId]
        );
      }
      if (input.state === "failed" && command.action === "config.apply") {
        await client.query("UPDATE provider_configurations SET apply_status='failed', updated_at=now() WHERE organization_id=(SELECT organization_id FROM config_revisions WHERE id=$1)", [command.arguments.config_revision_id]);
      }
      if (["probe.run", "contract.test", "smoke.test"].includes(command.action) && command.arguments.test_run_id) {
        const status = input.state === "running" ? "running" : input.state === "succeeded" ? "passed" : input.state === "failed" ? "failed" : null;
        if (status) await client.query("UPDATE test_runs SET status=$2, started_at=CASE WHEN $2='running' THEN COALESCE(started_at,now()) ELSE started_at END, completed_at=CASE WHEN $2 IN ('passed','failed') THEN now() ELSE completed_at END WHERE id=$1", [command.arguments.test_run_id, status]);
      }
      if (["backup.create", "backup.verify"].includes(command.action)) {
        const backupId = command.arguments.backup_id;
        if (backupId && input.state === "running" && command.action === "backup.verify") await client.query("UPDATE backup_records SET status='verifying' WHERE id=$1", [backupId]);
        if (backupId && input.state === "succeeded" && command.action === "backup.create") {
          const sha256 = input.evidenceRefs?.find((item) => item.startsWith("sha256:"))?.slice(7) ?? null;
          await client.query("UPDATE backup_records SET status='created', storage_uri=$2, sha256=$3, size_bytes=$4 WHERE id=$1", [backupId, `bairui-backup://${input.serverId}/${backupId}`, sha256, input.resultSummary?.bytes ?? null]);
        }
        if (backupId && input.state === "succeeded" && command.action === "backup.verify") await client.query("UPDATE backup_records SET status='verified', verified_at=now() WHERE id=$1", [backupId]);
        if (backupId && input.state === "failed") await client.query("UPDATE backup_records SET status='failed' WHERE id=$1", [backupId]);
      }
      if (command.action === "backup.restore") {
        const restoreId = command.arguments.restore_id;
        if (input.state === "running") await client.query("UPDATE backup_restore_runs SET status='running', started_at=COALESCE(started_at,now()) WHERE id=$1 AND command_id=$2", [restoreId, command.id]);
        if (input.state === "succeeded") await client.query("UPDATE backup_restore_runs SET status='succeeded', evidence_refs=$3, completed_at=now() WHERE id=$1 AND command_id=$2", [restoreId, command.id, input.evidenceRefs ?? []]);
        if (input.state === "failed") await client.query("UPDATE backup_restore_runs SET status='failed', error_code=$3, error_summary=$4, completed_at=now() WHERE id=$1 AND command_id=$2", [restoreId, command.id, input.errorCode ?? "restore_failed", input.errorSummary ?? "Backup restore failed"]);
        if (input.state === "cancelled") await client.query("UPDATE backup_restore_runs SET status='cancelled', error_code=$3, error_summary=$4, completed_at=now() WHERE id=$1 AND command_id=$2", [restoreId, command.id, input.errorCode ?? "restore_cancelled", input.errorSummary ?? "Backup restore was cancelled"]);
      }
      if (command.action === "backup.expire") {
        const backupId = command.arguments.backup_id;
        if (input.state === "succeeded") await client.query("UPDATE backup_records SET status='expired', storage_uri=NULL, expired_at=now() WHERE id=$1", [backupId]);
        if (input.state === "failed") await client.query("UPDATE backup_records SET status='failed' WHERE id=$1", [backupId]);
      }
      if (["release.stage", "release.apply", "release.rollback"].includes(command.action)) {
        if (command.action === "release.stage" && input.state === "succeeded") await client.query("UPDATE release_manifests SET status='approved' WHERE id=$1 AND status='candidate'", [command.arguments.release_id]);
        if (command.action === "release.apply" && input.state === "running") await client.query("UPDATE release_manifests SET status='rolling_out' WHERE id=$1", [command.arguments.release_id]);
        if (command.action === "release.apply" && input.state === "succeeded") await client.query("UPDATE release_manifests SET status='released' WHERE id=$1", [command.arguments.release_id]);
        if (command.action === "release.rollback" && input.state === "succeeded") {
          await client.query("UPDATE release_manifests SET status='withdrawn' WHERE id=$1", [command.arguments.release_id]);
          await client.query("UPDATE release_manifests SET status='released' WHERE id=$1", [command.arguments.rollback_release_id]);
        }
        if (input.state === "failed") await client.query("UPDATE release_manifests SET status='blocked' WHERE id=$1", [command.arguments.release_id]);
      }
      if (command.action === "upstream.check" && command.arguments.candidate_id && ["succeeded", "failed"].includes(input.state)) await client.query("UPDATE upstream_candidates SET status=$2, updated_at=now() WHERE id=$1", [command.arguments.candidate_id, input.state === "succeeded" ? "compatible" : "incompatible"]);
      let receipt = inserted[0];
      if (!receipt) ({ rows: [receipt] } = await client.query("SELECT * FROM command_receipts WHERE command_id=$1 AND attempt=$2 AND state=$3", [command.id, input.attempt, input.state]));
      await client.query("COMMIT");
      return { id: receipt.id, commandId: receipt.command_id, deploymentId: receipt.deployment_id, serverId: receipt.server_id, attempt: receipt.attempt, state: receipt.state, createdAt: receipt.created_at.toISOString() };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async getAgentRuntimeRoute(agentId) {
    const { rows } = await this.pool.query("SELECT runtime.*, config.config_document, config.secret_envelope FROM agent_runtimes runtime LEFT JOIN config_revisions config ON config.id=runtime.config_revision_id WHERE runtime.agent_id=$1", [agentId]);
    const row = rows[0];
    return row?.secret_envelope ? { runtime: mapAgentRuntime(row), configDocument: row.config_document, secretEnvelope: row.secret_envelope } : null;
  }

  async createConversation(input) {
    const { rows } = await this.pool.query("INSERT INTO conversations (id, organization_id, user_id, agent_id, title) VALUES ($1,$2,$3,$4,$5) RETURNING *", [input.id ?? randomUUID(), input.organizationId, input.userId, input.agentId, input.title ?? "New conversation"]);
    return mapConversation(rows[0]);
  }

  async listConversations(organizationId, userId) {
    const { rows } = await this.pool.query("SELECT * FROM conversations WHERE organization_id = $1 AND user_id = $2 ORDER BY updated_at DESC", [organizationId, userId]);
    return rows.map(mapConversation);
  }

  async getConversation(id) {
    const { rows } = await this.pool.query("SELECT * FROM conversations WHERE id = $1", [id]);
    return rows[0] ? mapConversation(rows[0]) : null;
  }

  async appendMessage(input) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("INSERT INTO messages (id, conversation_id, organization_id, user_id, role, content) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [input.id ?? randomUUID(), input.conversationId, input.organizationId, input.userId, input.role, input.content]);
      await client.query("UPDATE conversations SET updated_at = now() WHERE id = $1", [input.conversationId]);
      await client.query("COMMIT");
      return mapMessage(rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listMessages(conversationId) {
    const { rows } = await this.pool.query("SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at", [conversationId]);
    return rows.map(mapMessage);
  }

  async saveControlPlaneSnapshot(input) {
    const { rows } = await this.pool.query("INSERT INTO control_plane_snapshots (id, organization_id, server_id, status, payload) VALUES ($1,$2,$3,$4,$5) RETURNING *", [input.id ?? randomUUID(), input.organizationId, input.serverId, input.status, input.payload]);
    return mapSnapshot(rows[0]);
  }

  async latestControlPlaneSnapshots(organizationId) {
    const query = organizationId
      ? ["SELECT DISTINCT ON (server_id) * FROM control_plane_snapshots WHERE organization_id = $1 ORDER BY server_id, received_at DESC", [organizationId]]
      : ["SELECT DISTINCT ON (server_id) * FROM control_plane_snapshots ORDER BY server_id, received_at DESC", []];
    const { rows } = await this.pool.query(...query);
    return rows.map(mapSnapshot);
  }

  async appendAudit(client, input) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`bairui-audit:${input.organizationId}`]);
    const id = input.id ?? randomUUID();
    const createdAt = new Date().toISOString();
    const metadata = input.metadata ?? {};
    const { rows } = await client.query("INSERT INTO audit_events (id, organization_id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [id, input.organizationId, input.actorUserId ?? null, input.action, input.targetType, input.targetId ?? null, metadata, createdAt]);
    const { rows: chainRows } = await client.query("SELECT sequence, event_hash FROM audit_hash_chain WHERE organization_id=$1 ORDER BY sequence DESC LIMIT 1", [input.organizationId]);
    const sequence = Number(chainRows[0]?.sequence ?? 0) + 1;
    const previousHash = chainRows[0]?.event_hash ?? null;
    const eventHash = createHash("sha256").update(JSON.stringify({ id, organizationId: input.organizationId, actorUserId: input.actorUserId ?? null, action: input.action, targetType: input.targetType, targetId: input.targetId ?? null, metadata, createdAt, previousHash })).digest("hex");
    await client.query("INSERT INTO audit_hash_chain (id, organization_id, audit_event_id, sequence, previous_hash, event_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), input.organizationId, id, sequence, previousHash, eventHash, createdAt]);
    return mapAudit(rows[0]);
  }

  async recordAudit(input) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const event = await this.appendAudit(client, input);
      await client.query("COMMIT");
      return event;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async listAudit(organizationId) {
    const query = organizationId ? ["SELECT * FROM audit_events WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100", [organizationId]] : ["SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100", []];
    const { rows } = await this.pool.query(...query);
    return rows.map(mapAudit);
  }

  async createLicense(input) {
    const { rows } = await this.pool.query("INSERT INTO licenses (id, organization_id, plan, status, document, issued_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *", [input.id, input.organizationId, input.plan, input.status ?? "active", input.document, input.issuedAt, input.expiresAt]);
    return mapLicense(rows[0]);
  }

  async listLicenses(organizationId) {
    const query = organizationId ? ["SELECT * FROM licenses WHERE organization_id = $1 ORDER BY expires_at DESC", [organizationId]] : ["SELECT * FROM licenses ORDER BY expires_at DESC", []];
    const { rows } = await this.pool.query(...query);
    return rows.map(mapLicense);
  }

  async createServer(input) {
    const { rows } = await this.pool.query("INSERT INTO servers (id, organization_id, name, status) VALUES ($1,$2,$3,$4) RETURNING *", [input.id ?? randomUUID(), input.organizationId, input.name, input.status ?? "pending"]);
    return mapServer(rows[0]);
  }

  async listServers(organizationId) {
    const query = organizationId ? ["SELECT * FROM servers WHERE organization_id = $1 ORDER BY created_at DESC", [organizationId]] : ["SELECT * FROM servers ORDER BY created_at DESC", []];
    const { rows } = await this.pool.query(...query);
    return rows.map(mapServer);
  }

  async recordServerHeartbeat(input) {
    const { rows } = await this.pool.query("INSERT INTO servers (id, organization_id, name, status, runtime_version, last_seen_at) VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, runtime_version=EXCLUDED.runtime_version, last_seen_at=now() RETURNING *", [input.id, input.organizationId, input.name ?? input.id, input.status, input.runtimeVersion ?? null]);
    return mapServer(rows[0]);
  }

  async createRelease(input) {
    const { rows } = await this.pool.query("INSERT INTO releases (id, version, agent_commit, status, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *", [input.id ?? randomUUID(), input.version, input.agentCommit, input.status ?? "draft", input.notes ?? ""]);
    return mapRelease(rows[0]);
  }

  async listReleases() {
    const { rows } = await this.pool.query("SELECT * FROM releases ORDER BY created_at DESC");
    return rows.map(mapRelease);
  }

  async getProviderConfiguration(organizationId) {
    const { rows } = await this.pool.query("SELECT * FROM provider_configurations WHERE organization_id = $1", [organizationId]);
    return mapProviderConfiguration(rows[0]);
  }

  async upsertProviderConfiguration(input) {
    const { rows } = await this.pool.query(
      `INSERT INTO provider_configurations (organization_id, provider, base_url, model, api_key_envelope, key_hint, apply_status, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)
       ON CONFLICT (organization_id) DO UPDATE SET
         provider=EXCLUDED.provider, base_url=EXCLUDED.base_url, model=EXCLUDED.model,
         api_key_envelope=COALESCE(EXCLUDED.api_key_envelope, provider_configurations.api_key_envelope),
         key_hint=COALESCE(EXCLUDED.key_hint, provider_configurations.key_hint),
         apply_status='pending', updated_by=EXCLUDED.updated_by, updated_at=now()
       RETURNING *`,
      [input.organizationId, input.provider, input.baseUrl, input.model, input.apiKeyEnvelope ?? null, input.keyHint ?? null, input.updatedBy]
    );
    return mapProviderConfiguration(rows[0]);
  }

  async saveIntegrationResult(input) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const runId = input.id ?? randomUUID();
      const { rows } = await client.query("INSERT INTO integration_runs (id, organization_id, integration_id, capability, status, summary, started_at, completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [runId, input.organizationId, input.integrationId, input.capability, input.status, input.summary ?? {}, input.startedAt, input.completedAt ?? new Date().toISOString()]);
      for (const item of input.items ?? []) {
        await client.query(
          "INSERT INTO hotspot_items (id, organization_id, run_id, external_id, source_id, source_name, rank, title, url, mobile_url, heat, category, fetched_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING",
          [randomUUID(), input.organizationId, runId, item.external_id, item.source_id, item.source_name, Number(item.rank) || 0, item.title, item.url ?? "", item.mobile_url ?? "", item.heat ?? "", item.category ?? "", item.fetched_at]
        );
      }
      await client.query("COMMIT");
      return mapIntegrationRun(rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async listIntegrationRuns(organizationId, limit = 20) {
    const query = organizationId
      ? ["SELECT * FROM integration_runs WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2", [organizationId, limit]]
      : ["SELECT * FROM integration_runs ORDER BY created_at DESC LIMIT $1", [limit]];
    const { rows } = await this.pool.query(...query);
    return rows.map(mapIntegrationRun);
  }

  async listLatestHotspots(organizationId) {
    const { rows: runRows } = await this.pool.query("SELECT * FROM integration_runs WHERE organization_id = $1 AND integration_id = 'trendradar' ORDER BY created_at DESC LIMIT 1", [organizationId]);
    if (!runRows[0]) return { run: null, items: [] };
    const { rows } = await this.pool.query("SELECT * FROM hotspot_items WHERE organization_id = $1 AND run_id = $2 ORDER BY source_name, rank, created_at", [organizationId, runRows[0].id]);
    return { run: mapIntegrationRun(runRows[0]), items: rows.map(mapHotspot) };
  }

  async createObsidianNote(input) {
    const id = input.id ?? randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO obsidian_notes (id, organization_id, user_id, agent_id, title, slug, markdown, frontmatter, wikilinks, memory_kind, importance, hermes_target, source_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (organization_id, user_id, agent_id, slug) WHERE agent_id IS NOT NULL
       DO UPDATE SET title=EXCLUDED.title, markdown=EXCLUDED.markdown, frontmatter=EXCLUDED.frontmatter, wikilinks=EXCLUDED.wikilinks, memory_kind=EXCLUDED.memory_kind, importance=EXCLUDED.importance, hermes_target=EXCLUDED.hermes_target, source_ref=EXCLUDED.source_ref, revision=obsidian_notes.revision+1, hermes_sync_status='pending', updated_at=now()
       RETURNING *`,
      [id, input.organizationId, input.userId, input.agentId, input.title, input.slug, input.markdown, input.frontmatter, input.wikilinks, input.memoryKind, input.importance, input.hermesTarget, input.sourceRef]
    );
    return mapObsidianNote(rows[0]);
  }

  async listObsidianNotes(organizationId, userId, agentId, query = "") {
    const search = String(query ?? "").trim();
    const { rows } = await this.pool.query(
      `SELECT * FROM obsidian_notes WHERE organization_id=$1 AND user_id=$2 AND agent_id=$3
       AND ($4='' OR title ILIKE '%' || $4 || '%' OR markdown ILIKE '%' || $4 || '%')
       ORDER BY updated_at DESC`,
      [organizationId, userId, agentId, search]
    );
    return rows.map(mapObsidianNote);
  }

  async getObsidianNote(organizationId, userId, agentId, noteId) {
    const { rows } = await this.pool.query("SELECT * FROM obsidian_notes WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND agent_id=$4", [noteId, organizationId, userId, agentId]);
    return mapObsidianNote(rows[0]);
  }

  async updateObsidianNote(input) {
    const { rows } = await this.pool.query(
      `UPDATE obsidian_notes SET title=$5, slug=$6, markdown=$7, frontmatter=$8, wikilinks=$9, memory_kind=$10, importance=$11, hermes_target=$12, source_ref=$13, revision=revision+1, hermes_sync_status='pending', updated_at=now()
       WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND agent_id=$4 RETURNING *`,
      [input.id, input.organizationId, input.userId, input.agentId, input.title, input.slug, input.markdown, input.frontmatter, input.wikilinks, input.memoryKind, input.importance, input.hermesTarget, input.sourceRef]
    );
    return mapObsidianNote(rows[0]);
  }

  async deleteObsidianNote(organizationId, userId, agentId, noteId) {
    const { rowCount } = await this.pool.query("DELETE FROM obsidian_notes WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND agent_id=$4", [noteId, organizationId, userId, agentId]);
    return rowCount === 1;
  }

  async markObsidianProjection(input) {
    await this.pool.query(
      `UPDATE obsidian_notes SET
         hermes_sync_status = CASE WHEN id=ANY($4::text[]) THEN 'conflict' WHEN id=ANY($5::text[]) THEN 'materialized' ELSE 'excluded' END,
         hermes_synced_revision = CASE WHEN id=ANY($5::text[]) THEN revision ELSE hermes_synced_revision END,
         hermes_synced_at = CASE WHEN id=ANY($5::text[]) THEN now() ELSE hermes_synced_at END
       WHERE organization_id=$1 AND user_id=$2 AND agent_id=$3`,
      [input.organizationId, input.userId, input.agentId, input.conflictNoteIds ?? [], input.includedNoteIds ?? []]
    );
  }

  async listAgentSkillPreferences(organizationId, userId, agentId) {
    const { rows } = await this.pool.query("SELECT * FROM agent_skill_preferences WHERE organization_id=$1 AND user_id=$2 AND agent_id=$3 ORDER BY skill_id", [organizationId, userId, agentId]);
    return rows.map(mapSkillPreference);
  }

  async upsertAgentSkillPreference(input) {
    const { rows } = await this.pool.query(
      `INSERT INTO agent_skill_preferences (agent_id, organization_id, user_id, skill_id, enabled, apply_status, last_error_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (agent_id, skill_id) DO UPDATE SET enabled=EXCLUDED.enabled, apply_status=EXCLUDED.apply_status, last_error_code=EXCLUDED.last_error_code, updated_at=now()
       RETURNING *`,
      [input.agentId, input.organizationId, input.userId, input.skillId, Boolean(input.enabled), input.applyStatus ?? "pending", input.lastErrorCode ?? null]
    );
    return mapSkillPreference(rows[0]);
  }

  async listAgentChannelBindings(organizationId, userId, agentId) {
    const { rows } = await this.pool.query("SELECT * FROM agent_channel_bindings WHERE organization_id=$1 AND user_id=$2 AND agent_id=$3 ORDER BY channel", [organizationId, userId, agentId]);
    return rows.map(mapChannelBinding);
  }

  async getAgentChannelBinding(organizationId, userId, agentId, channel) {
    const { rows } = await this.pool.query("SELECT * FROM agent_channel_bindings WHERE organization_id=$1 AND user_id=$2 AND agent_id=$3 AND channel=$4", [organizationId, userId, agentId, channel]);
    return mapChannelBinding(rows[0]);
  }

  async upsertAgentChannelBinding(input) {
    const { rows } = await this.pool.query(
      `INSERT INTO agent_channel_bindings (id, organization_id, user_id, agent_id, channel, display_name, status, credential_envelope, credential_hint, metadata, last_error_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (agent_id, channel) DO UPDATE SET display_name=EXCLUDED.display_name, status=EXCLUDED.status,
         credential_envelope=COALESCE(EXCLUDED.credential_envelope, agent_channel_bindings.credential_envelope),
         credential_hint=COALESCE(EXCLUDED.credential_hint, agent_channel_bindings.credential_hint), metadata=EXCLUDED.metadata,
         last_error_code=EXCLUDED.last_error_code, updated_at=now()
       RETURNING *`,
      [input.id ?? randomUUID(), input.organizationId, input.userId, input.agentId, input.channel, input.displayName, input.status ?? "pending", input.credentialEnvelope ?? null, input.credentialHint ?? null, input.metadata ?? {}, input.lastErrorCode ?? null]
    );
    return mapChannelBinding(rows[0]);
  }

  async deleteAgentChannelBinding(organizationId, userId, agentId, channel) {
    const { rowCount } = await this.pool.query("DELETE FROM agent_channel_bindings WHERE organization_id=$1 AND user_id=$2 AND agent_id=$3 AND channel=$4", [organizationId, userId, agentId, channel]);
    return rowCount === 1;
  }

  async createAgentRun(input) {
    const { rows } = await this.pool.query(
      `INSERT INTO agent_runs (id, organization_id, user_id, agent_id, parent_run_id, input_text, model, status, last_error, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [input.id, input.organizationId, input.userId, input.agentId, input.parentRunId ?? null, input.inputText, input.model ?? null, input.status ?? "started", input.lastError ?? null, input.completedAt ?? null]
    );
    return mapAgentRun(rows[0]);
  }

  async getAgentRun(organizationId, userId, agentId, runId) {
    const { rows } = await this.pool.query("SELECT * FROM agent_runs WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND agent_id=$4", [runId, organizationId, userId, agentId]);
    return mapAgentRun(rows[0]);
  }

  async listAgentRuns(organizationId, userId, agentId, limit = 50) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    const { rows } = await this.pool.query("SELECT * FROM agent_runs WHERE organization_id=$1 AND user_id=$2 AND agent_id=$3 ORDER BY created_at DESC LIMIT $4", [organizationId, userId, agentId, safeLimit]);
    return rows.map(mapAgentRun);
  }

  async updateAgentRun(input) {
    const { rows } = await this.pool.query(
      `UPDATE agent_runs SET status=COALESCE($5,status), last_error=CASE WHEN $6::boolean THEN $7 ELSE last_error END,
         completed_at=CASE WHEN $8::boolean THEN $9::timestamptz ELSE completed_at END, updated_at=now()
       WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND agent_id=$4 RETURNING *`,
      [input.id, input.organizationId, input.userId, input.agentId, input.status ?? null, input.lastError !== undefined, input.lastError ?? null, input.completedAt !== undefined, input.completedAt ?? null]
    );
    return mapAgentRun(rows[0]);
  }

  async setAgentHotspotBookmark(input) {
    if (input.bookmarked) {
      await this.pool.query(
        `INSERT INTO agent_hotspot_bookmarks (agent_id, organization_id, user_id, hotspot_item_id)
         VALUES ($1,$2,$3,$4) ON CONFLICT (agent_id, hotspot_item_id) DO NOTHING RETURNING hotspot_item_id`,
        [input.agentId, input.organizationId, input.userId, input.hotspotItemId]
      );
      return true;
    }
    await this.pool.query("DELETE FROM agent_hotspot_bookmarks WHERE agent_id=$1 AND organization_id=$2 AND user_id=$3 AND hotspot_item_id=$4", [input.agentId, input.organizationId, input.userId, input.hotspotItemId]);
    return false;
  }

  async listAgentHotspotBookmarkIds(organizationId, userId, agentId) {
    const { rows } = await this.pool.query("SELECT hotspot_item_id FROM agent_hotspot_bookmarks WHERE organization_id=$1 AND user_id=$2 AND agent_id=$3 ORDER BY created_at DESC", [organizationId, userId, agentId]);
    return rows.map((row) => row.hotspot_item_id);
  }

  async listChannelBindings(organizationId) {
    const query = organizationId ? ["SELECT * FROM agent_channel_bindings WHERE organization_id=$1 ORDER BY channel,status,updated_at DESC", [organizationId]] : ["SELECT * FROM agent_channel_bindings ORDER BY organization_id,channel,status,updated_at DESC", []];
    const { rows } = await this.pool.query(...query);
    return rows.map(mapChannelBinding);
  }

  async listConfigRevisions(organizationId, agentId) {
    const conditions = [];
    const values = [];
    if (organizationId) { values.push(organizationId); conditions.push(`organization_id=$${values.length}`); }
    if (agentId) { values.push(agentId); conditions.push(`agent_id=$${values.length}`); }
    const { rows } = await this.pool.query(`SELECT * FROM config_revisions${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT 500`, values);
    return rows.map(mapConfigRevision);
  }

  async listTelemetryEvents(organizationId, limit = 500) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
    const query = organizationId ? ["SELECT * FROM telemetry_events WHERE organization_id=$1 ORDER BY occurred_at DESC LIMIT $2", [organizationId, safeLimit]] : ["SELECT * FROM telemetry_events ORDER BY occurred_at DESC LIMIT $1", [safeLimit]];
    const { rows } = await this.pool.query(...query);
    return rows.map((row) => ({ id: row.id, organizationId: row.organization_id, userId: row.user_id, agentId: row.agent_id, runtimeId: row.runtime_id, layer: row.layer, componentId: row.component_id, eventType: row.event_type, severity: row.severity, traceId: row.trace_id, metrics: row.metrics, occurredAt: row.occurred_at?.toISOString?.() ?? row.occurred_at }));
  }

  async listProviderChannels(organizationId) {
    const { rows } = await this.pool.query("SELECT * FROM provider_channels WHERE organization_id=$1 ORDER BY enabled DESC, priority, name", [organizationId]);
    return rows.map(mapProviderChannel);
  }

  async upsertProviderChannel(input) {
    const { rows } = await this.pool.query(
      `INSERT INTO provider_channels (id, organization_id, name, provider, base_url, model, api_key_envelope, key_hint, status, priority, weight, max_concurrency, monthly_budget_usd, enabled, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12,$13,$14)
       ON CONFLICT (organization_id, name) DO UPDATE SET provider=EXCLUDED.provider, base_url=EXCLUDED.base_url, model=EXCLUDED.model,
         api_key_envelope=COALESCE(EXCLUDED.api_key_envelope,provider_channels.api_key_envelope), key_hint=COALESCE(EXCLUDED.key_hint,provider_channels.key_hint),
         status='pending', priority=EXCLUDED.priority, weight=EXCLUDED.weight, max_concurrency=EXCLUDED.max_concurrency,
         monthly_budget_usd=EXCLUDED.monthly_budget_usd, enabled=EXCLUDED.enabled, updated_by=EXCLUDED.updated_by, updated_at=now()
       RETURNING *`,
      [input.id ?? randomUUID(), input.organizationId, input.name, input.provider, input.baseUrl, input.model, input.apiKeyEnvelope ?? null, input.keyHint ?? null, input.priority ?? 100, input.weight ?? 1, input.maxConcurrency ?? null, input.monthlyBudgetUsd ?? null, input.enabled ?? true, input.updatedBy]
    );
    return mapProviderChannel(rows[0]);
  }

  async getModelPolicy(organizationId) {
    const { rows } = await this.pool.query("SELECT * FROM model_policies WHERE organization_id=$1", [organizationId]);
    return mapModelPolicy(rows[0]);
  }

  async upsertModelPolicy(input) {
    const { rows } = await this.pool.query(
      `INSERT INTO model_policies (organization_id, allowed_models, default_model, user_custom_keys_allowed, daily_token_limit, monthly_budget_usd, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (organization_id) DO UPDATE SET allowed_models=EXCLUDED.allowed_models,
       default_model=EXCLUDED.default_model, user_custom_keys_allowed=EXCLUDED.user_custom_keys_allowed, daily_token_limit=EXCLUDED.daily_token_limit,
       monthly_budget_usd=EXCLUDED.monthly_budget_usd, updated_by=EXCLUDED.updated_by, updated_at=now() RETURNING *`,
      [input.organizationId, JSON.stringify(input.allowedModels ?? []), input.defaultModel ?? null, Boolean(input.userCustomKeysAllowed), input.dailyTokenLimit ?? null, input.monthlyBudgetUsd ?? null, input.updatedBy]
    );
    return mapModelPolicy(rows[0]);
  }

  async getRetentionPolicy(organizationId) {
    const { rows } = await this.pool.query("SELECT * FROM data_retention_policies WHERE organization_id=$1", [organizationId]);
    return mapRetentionPolicy(rows[0]);
  }

  async upsertRetentionPolicy(input) {
    const { rows } = await this.pool.query(
      `INSERT INTO data_retention_policies (organization_id, telemetry_days, usage_days, audit_days, sensitive_access_event_days, backup_days, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (organization_id) DO UPDATE SET telemetry_days=EXCLUDED.telemetry_days,
       usage_days=EXCLUDED.usage_days, audit_days=EXCLUDED.audit_days, sensitive_access_event_days=EXCLUDED.sensitive_access_event_days,
       backup_days=EXCLUDED.backup_days, updated_by=EXCLUDED.updated_by, updated_at=now() RETURNING *`,
      [input.organizationId, input.telemetryDays, input.usageDays, input.auditDays, input.sensitiveAccessEventDays, input.backupDays, input.updatedBy]
    );
    return mapRetentionPolicy(rows[0]);
  }

  async enforceRetentionPolicies({ organizationId, now = Date.now(), actorUserId = null, reason = "Scheduled retention enforcement" } = {}) {
    const nowMs = new Date(now).getTime();
    if (!Number.isFinite(nowMs)) throw new TypeError("Retention time is invalid");
    const client = await this.pool.connect();
    const lockName = organizationId ? `bairui-retention:${organizationId}` : "bairui-retention:all";
    const runs = [];
    try {
      const { rows: lockRows } = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired", [lockName]);
      if (!lockRows[0]?.acquired) return [];
      const { rows: policies } = await client.query(
        `SELECT organization.id AS organization_id,
                COALESCE(policy.telemetry_days,30) AS telemetry_days,
                COALESCE(policy.usage_days,400) AS usage_days,
                COALESCE(policy.audit_days,365) AS audit_days,
                COALESCE(policy.sensitive_access_event_days,365) AS sensitive_access_event_days,
                COALESCE(policy.backup_days,30) AS backup_days,
                policy.updated_by
         FROM organizations organization
         LEFT JOIN data_retention_policies policy ON policy.organization_id=organization.id
         WHERE ($1::text IS NULL OR organization.id=$1)
         ORDER BY organization.id`,
        [organizationId ?? null]
      );
      for (const policy of policies) {
        const runId = randomUUID();
        const day = 24 * 60 * 60_000;
        const cutoffs = {
          telemetry: new Date(nowMs - Number(policy.telemetry_days) * day).toISOString(),
          usage: new Date(nowMs - Number(policy.usage_days) * day).toISOString(),
          audit: new Date(nowMs - Number(policy.audit_days) * day).toISOString(),
          sensitiveAccess: new Date(nowMs - Number(policy.sensitive_access_event_days) * day).toISOString(),
          backup: new Date(nowMs - Number(policy.backup_days) * day).toISOString()
        };
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`bairui-retention-org:${policy.organization_id}`]);
          await client.query("INSERT INTO retention_runs (id, organization_id, status, cutoffs) VALUES ($1,$2,'running',$3)", [runId, policy.organization_id, cutoffs]);
          const deletedCounts = {};
          deletedCounts.heartbeats = (await client.query("DELETE FROM heartbeats WHERE organization_id=$1 AND received_at<$2", [policy.organization_id, cutoffs.telemetry])).rowCount;
          deletedCounts.resourceSamples = (await client.query("DELETE FROM agent_resource_samples WHERE organization_id=$1 AND received_at<$2", [policy.organization_id, cutoffs.telemetry])).rowCount;
          deletedCounts.telemetryEvents = (await client.query("DELETE FROM telemetry_events WHERE organization_id=$1 AND occurred_at<$2", [policy.organization_id, cutoffs.telemetry])).rowCount;
          deletedCounts.usageRollups = (await client.query("DELETE FROM usage_rollups WHERE organization_id=$1 AND bucket_start<$2", [policy.organization_id, cutoffs.usage])).rowCount;
          deletedCounts.sensitiveAccessEvents = (await client.query("DELETE FROM sensitive_access_events WHERE organization_id=$1 AND created_at<$2", [policy.organization_id, cutoffs.sensitiveAccess])).rowCount;
          deletedCounts.auditEvents = (await client.query("DELETE FROM audit_events WHERE organization_id=$1 AND created_at<$2", [policy.organization_id, cutoffs.audit])).rowCount;
          const { rows: backups } = await client.query(
            `SELECT backup.id, backup.deployment_id, deployment.agent_id, deployment.observed_state_version
             FROM backup_records backup
             JOIN control_deployments deployment ON deployment.id=backup.deployment_id
             WHERE deployment.organization_id=$1 AND backup.created_at<$2
               AND backup.status IN ('created','verified','failed')
               AND NOT EXISTS (SELECT 1 FROM backup_restore_runs restore WHERE restore.backup_id=backup.id AND restore.status IN ('requested','running'))
             FOR UPDATE OF backup SKIP LOCKED`,
            [policy.organization_id, cutoffs.backup]
          );
          let backupExpirationCommands = 0;
          for (const backup of backups) {
            const commandId = randomUUID();
            const idempotencyKey = `${backup.deployment_id}/backup.expire/${backup.id}/${runId}`;
            const expiresAt = new Date(nowMs + 24 * 60 * 60_000).toISOString();
            const { rowCount } = await client.query(
              `INSERT INTO control_commands (id, deployment_id, idempotency_key, action, target_module_id, target_instance_id, arguments, expected_observation_version, state, priority, expires_at, requested_by)
               VALUES ($1,$2,$3,'backup.expire','bairui.supervisor',$4,$5,$6,'queued',200,$7,$8)
               ON CONFLICT (deployment_id,idempotency_key) DO NOTHING`,
              [commandId, backup.deployment_id, idempotencyKey, backup.agent_id, { backup_id: backup.id }, Number(backup.observed_state_version), expiresAt, policy.updated_by]
            );
            if (rowCount === 1) {
              await client.query("UPDATE backup_records SET status='expiring' WHERE id=$1", [backup.id]);
              backupExpirationCommands += 1;
            }
          }
          await this.appendAudit(client, { organizationId: policy.organization_id, actorUserId, action: "retention.enforced", targetType: "retention_run", targetId: runId, metadata: { reason, deletedCounts, backupExpirationCommands, cutoffs } });
          await client.query("UPDATE retention_runs SET status='succeeded', deleted_counts=$2, backup_expiration_commands=$3, completed_at=now() WHERE id=$1", [runId, deletedCounts, backupExpirationCommands]);
          await client.query("COMMIT");
          runs.push({ id: runId, organizationId: policy.organization_id, status: "succeeded", cutoffs, deletedCounts, backupExpirationCommands });
        } catch (error) {
          await client.query("ROLLBACK");
          const errorCode = String(error.code ?? "retention_failed").replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 200) || "retention_failed";
          await client.query("INSERT INTO retention_runs (id, organization_id, status, cutoffs, error_code, completed_at) VALUES ($1,$2,'failed',$3,$4,now()) ON CONFLICT (id) DO UPDATE SET status='failed', error_code=EXCLUDED.error_code, completed_at=now()", [runId, policy.organization_id, cutoffs, errorCode]);
          runs.push({ id: runId, organizationId: policy.organization_id, status: "failed", cutoffs, deletedCounts: {}, backupExpirationCommands: 0, errorCode });
        }
      }
      return runs;
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lockName]).catch(() => {});
      client.release();
    }
  }

  async listRetentionRuns(organizationId, limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    const query = organizationId ? ["SELECT * FROM retention_runs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT $2", [organizationId, safeLimit]] : ["SELECT * FROM retention_runs ORDER BY created_at DESC LIMIT $1", [safeLimit]];
    const { rows } = await this.pool.query(...query);
    return rows.map((row) => ({ id: row.id, organizationId: row.organization_id, status: row.status, cutoffs: row.cutoffs, deletedCounts: row.deleted_counts, backupExpirationCommands: row.backup_expiration_commands, errorCode: row.error_code, startedAt: row.started_at?.toISOString?.() ?? row.started_at, completedAt: row.completed_at?.toISOString?.() ?? row.completed_at, createdAt: row.created_at?.toISOString?.() ?? row.created_at }));
  }

  async listSensitiveAccessGrants(organizationId) {
    const { rows } = await this.pool.query("SELECT * FROM sensitive_access_grants WHERE organization_id=$1 ORDER BY created_at DESC", [organizationId]);
    return rows.map(mapSensitiveGrant);
  }

  async createSensitiveAccessGrant(input) {
    const { rows } = await this.pool.query("INSERT INTO sensitive_access_grants (id, organization_id, grantee_user_id, permission, scope, target_id, reason, granted_by, expires_at) VALUES ($1,$2,$3,'conversation_content_read',$4,$5,$6,$7,$8) RETURNING *", [input.id ?? randomUUID(), input.organizationId, input.granteeUserId, input.scope, input.targetId ?? null, input.reason, input.grantedBy, input.expiresAt]);
    return mapSensitiveGrant(rows[0]);
  }

  async revokeSensitiveAccessGrant(organizationId, grantId) {
    const { rows } = await this.pool.query("UPDATE sensitive_access_grants SET revoked_at=now() WHERE id=$1 AND organization_id=$2 AND revoked_at IS NULL RETURNING *", [grantId, organizationId]);
    return mapSensitiveGrant(rows[0]);
  }

  async listSensitiveAccessEvents(organizationId, limit = 500) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
    const { rows } = await this.pool.query("SELECT * FROM sensitive_access_events WHERE organization_id=$1 ORDER BY created_at DESC LIMIT $2", [organizationId, safeLimit]);
    return rows.map((row) => ({ id: row.id, grantId: row.grant_id, organizationId: row.organization_id, actorUserId: row.actor_user_id, targetType: row.target_type, targetId: row.target_id, reason: row.reason, createdAt: row.created_at?.toISOString?.() ?? row.created_at }));
  }

  async recordSensitiveAccessEvent(input) {
    const { rows } = await this.pool.query(
      "INSERT INTO sensitive_access_events (id, grant_id, organization_id, actor_user_id, target_type, target_id, reason) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [input.id ?? randomUUID(), input.grantId, input.organizationId, input.actorUserId, input.targetType, input.targetId, input.reason]
    );
    const row = rows[0];
    return { id: row.id, grantId: row.grant_id, organizationId: row.organization_id, actorUserId: row.actor_user_id, targetType: row.target_type, targetId: row.target_id, reason: row.reason, createdAt: row.created_at?.toISOString?.() ?? row.created_at };
  }

  async listBackupRecords(organizationId) {
    const query = organizationId ? ["SELECT backup.*, deployment.agent_id FROM backup_records backup JOIN control_deployments deployment ON deployment.id=backup.deployment_id WHERE deployment.organization_id=$1 ORDER BY backup.created_at DESC", [organizationId]] : ["SELECT backup.*, deployment.agent_id FROM backup_records backup JOIN control_deployments deployment ON deployment.id=backup.deployment_id ORDER BY backup.created_at DESC", []];
    const { rows } = await this.pool.query(...query);
    return rows.map((row) => ({ id: row.id, deploymentId: row.deployment_id, agentId: row.agent_id, policyId: row.policy_id, backupType: row.backup_type, status: row.status, storageUri: row.storage_uri, sha256: row.sha256, encrypted: row.encrypted, sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes), verifiedAt: row.verified_at?.toISOString?.() ?? row.verified_at, expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at, expiredAt: row.expired_at?.toISOString?.() ?? row.expired_at, createdAt: row.created_at?.toISOString?.() ?? row.created_at }));
  }

  async listBackupRestoreRuns(organizationId) {
    const query = organizationId ? ["SELECT restore.*, deployment.agent_id FROM backup_restore_runs restore JOIN control_deployments deployment ON deployment.id=restore.deployment_id WHERE deployment.organization_id=$1 ORDER BY restore.created_at DESC", [organizationId]] : ["SELECT restore.*, deployment.agent_id FROM backup_restore_runs restore JOIN control_deployments deployment ON deployment.id=restore.deployment_id ORDER BY restore.created_at DESC", []];
    const { rows } = await this.pool.query(...query);
    return rows.map((row) => ({ id: row.id, backupId: row.backup_id, deploymentId: row.deployment_id, agentId: row.agent_id, commandId: row.command_id, status: row.status, requestedBy: row.requested_by, reason: row.reason, evidenceRefs: row.evidence_refs, errorCode: row.error_code, errorSummary: row.error_summary, startedAt: row.started_at?.toISOString?.() ?? row.started_at, completedAt: row.completed_at?.toISOString?.() ?? row.completed_at, createdAt: row.created_at?.toISOString?.() ?? row.created_at }));
  }

  async listReleaseGates(organizationId) {
    const query = organizationId ? ["SELECT gate.* FROM release_gates gate JOIN control_deployments deployment ON deployment.id=gate.deployment_id WHERE deployment.organization_id=$1 ORDER BY gate.evaluated_at DESC", [organizationId]] : ["SELECT * FROM release_gates ORDER BY evaluated_at DESC", []];
    const { rows } = await this.pool.query(...query);
    return rows.map((row) => ({ id: row.id, releaseManifestId: row.release_manifest_id, deploymentId: row.deployment_id, gateName: row.gate_name, outcome: row.outcome, evidenceRefs: row.evidence_refs, evaluatedAt: row.evaluated_at?.toISOString?.() ?? row.evaluated_at }));
  }

  async listUpstreamCandidates() {
    const { rows } = await this.pool.query("SELECT * FROM upstream_candidates ORDER BY updated_at DESC");
    return rows.map((row) => ({ id: row.id, upstreamId: row.upstream_id, currentRef: row.current_ref, candidateRef: row.candidate_ref, status: row.status, compatibilityTestRunId: row.compatibility_test_run_id, createdAt: row.created_at?.toISOString?.() ?? row.created_at, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at }));
  }
}
