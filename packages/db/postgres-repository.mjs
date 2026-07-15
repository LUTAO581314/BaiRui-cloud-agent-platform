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
const mapHeartbeat = (row) => row ? ({ id: row.id, organizationId: row.organization_id, userId: row.user_id, agentId: row.agent_id, runtimeId: row.runtime_id, sequence: Number(row.sequence), status: row.status, runtimeVersion: row.runtime_version, boundaryVersion: row.boundary_version, configRevisionId: row.config_revision_id, queueDepth: row.queue_depth, activeRuns: row.active_runs, failedRuns: row.failed_runs, observedAt: row.observed_at?.toISOString?.() ?? row.observed_at, receivedAt: row.received_at?.toISOString?.() ?? row.received_at }) : null;
const mapAgentComponent = (row) => ({ id: row.id, organizationId: row.organization_id, agentId: row.agent_id, runtimeId: row.runtime_id, layer: row.layer, moduleId: row.module_id, status: row.status, version: row.version, upstreamRef: row.upstream_ref, capabilities: row.capabilities, metrics: row.metrics, observedAt: row.observed_at?.toISOString?.() ?? row.observed_at, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at });
const mapAlert = (row) => ({ id: row.id, organizationId: row.organization_id, agentId: row.agent_id, runtimeId: row.runtime_id, code: row.code, severity: row.severity, status: row.status, title: row.title, summary: row.summary, firstSeenAt: row.first_seen_at?.toISOString?.() ?? row.first_seen_at, lastSeenAt: row.last_seen_at?.toISOString?.() ?? row.last_seen_at, resolvedAt: row.resolved_at?.toISOString?.() ?? row.resolved_at });
const mapConversation = (row) => ({ id: row.id, organizationId: row.organization_id, userId: row.user_id, agentId: row.agent_id, title: row.title, createdAt: row.created_at?.toISOString?.() ?? row.created_at, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at });
const mapMessage = (row) => ({ id: row.id, conversationId: row.conversation_id, organizationId: row.organization_id, userId: row.user_id, role: row.role, content: row.content, createdAt: row.created_at?.toISOString?.() ?? row.created_at });
const mapSnapshot = (row) => ({ id: row.id, organizationId: row.organization_id, serverId: row.server_id, status: row.status, payload: row.payload, receivedAt: row.received_at?.toISOString?.() ?? row.received_at });
const mapAudit = (row) => ({ id: row.id, organizationId: row.organization_id, actorUserId: row.actor_user_id, action: row.action, targetType: row.target_type, targetId: row.target_id, metadata: row.metadata, createdAt: row.created_at?.toISOString?.() ?? row.created_at });
const mapLicense = (row) => ({ id: row.id, organizationId: row.organization_id, plan: row.plan, status: row.status, document: row.document, issuedAt: row.issued_at?.toISOString?.() ?? row.issued_at, expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at, createdAt: row.created_at?.toISOString?.() ?? row.created_at });
const mapServer = (row) => ({ id: row.id, organizationId: row.organization_id, name: row.name, status: row.status, runtimeVersion: row.runtime_version, lastSeenAt: row.last_seen_at?.toISOString?.() ?? row.last_seen_at, createdAt: row.created_at?.toISOString?.() ?? row.created_at });
const mapRelease = (row) => ({ id: row.id, version: row.version, agentCommit: row.agent_commit, status: row.status, notes: row.notes, createdAt: row.created_at?.toISOString?.() ?? row.created_at });
const mapProviderConfiguration = (row) => row ? ({ organizationId: row.organization_id, provider: row.provider, baseUrl: row.base_url, model: row.model, apiKeyEnvelope: row.api_key_envelope, keyHint: row.key_hint, applyStatus: row.apply_status, updatedBy: row.updated_by, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at }) : null;
const mapIntegrationRun = (row) => ({ id: row.id, organizationId: row.organization_id, integrationId: row.integration_id, capability: row.capability, status: row.status, summary: row.summary, startedAt: row.started_at?.toISOString?.() ?? row.started_at, completedAt: row.completed_at?.toISOString?.() ?? row.completed_at, createdAt: row.created_at?.toISOString?.() ?? row.created_at });
const mapHotspot = (row) => ({ id: row.id, runId: row.run_id, externalId: row.external_id, sourceId: row.source_id, sourceName: row.source_name, rank: row.rank, title: row.title, url: row.url, mobileUrl: row.mobile_url, heat: row.heat, category: row.category, fetchedAt: row.fetched_at?.toISOString?.() ?? row.fetched_at });
const mapObsidianNote = (row) => ({ id: row.id, organizationId: row.organization_id, userId: row.user_id, title: row.title, slug: row.slug, markdown: row.markdown, frontmatter: row.frontmatter, wikilinks: row.wikilinks, createdAt: row.created_at?.toISOString?.() ?? row.created_at, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at });

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

  async listAlerts(organizationId) {
    const query = organizationId ? ["SELECT * FROM alerts WHERE organization_id=$1 ORDER BY last_seen_at DESC", [organizationId]] : ["SELECT * FROM alerts ORDER BY last_seen_at DESC", []];
    const { rows } = await this.pool.query(...query);
    return rows.map(mapAlert);
  }

  async listUsageRollups(organizationId) {
    const query = organizationId ? ["SELECT * FROM usage_rollups WHERE organization_id=$1 ORDER BY bucket_start DESC LIMIT 1000", [organizationId]] : ["SELECT * FROM usage_rollups ORDER BY bucket_start DESC LIMIT 1000", []];
    const { rows } = await this.pool.query(...query);
    return rows.map((row) => ({ organizationId: row.organization_id, userId: row.user_id, agentId: row.agent_id, runtimeId: row.runtime_id, bucketStart: row.bucket_start?.toISOString?.() ?? row.bucket_start, bucketSeconds: row.bucket_seconds, model: row.model, inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), estimatedCostUsd: Number(row.estimated_cost_usd), runCount: Number(row.run_count), failedRunCount: Number(row.failed_run_count), latencySumMs: Number(row.latency_sum_ms) }));
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
      const configDocument = { agent: { id: agent.id, name: agent.name, soul_markdown: agent.soulMarkdown }, runtime: { kind: "hermes", workspace_ref: runtime.workspaceRef }, provider: { provider: input.provider.provider, base_url: input.provider.baseUrl, model: input.provider.model } };
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
      await client.query("UPDATE control_commands SET state='queued', lease_server_id=NULL, lease_expires_at=NULL, updated_at=now() WHERE state IN ('leased','accepted','running') AND lease_expires_at <= now() AND expires_at > now()");
      const { rows } = await client.query(
        `SELECT command.*, deployment.agent_id, deployment.server_id, deployment.organization_id,
                runtime.id AS runtime_id, runtime.owner_user_id, runtime.workspace_ref,
                config.config_document, config.secret_envelope
         FROM control_commands command
         JOIN control_deployments deployment ON deployment.id=command.deployment_id
         JOIN agent_runtimes runtime ON runtime.agent_id=deployment.agent_id
         LEFT JOIN config_revisions config ON config.id=(command.arguments->>'config_revision_id')
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
          config: row.config_document ? { document: row.config_document, secret_envelope: row.secret_envelope } : null
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
      }
      if (input.state === "failed") {
        await client.query("UPDATE agent_runtimes runtime SET status='failed', last_error_code=$2, last_error_detail=$3, updated_at=now() FROM control_deployments deployment WHERE deployment.id=$1 AND runtime.agent_id=deployment.agent_id", [command.deployment_id, input.errorCode ?? "command_failed", input.errorSummary ?? "Control command failed"]);
        await client.query("UPDATE agents agent SET status='failed', initialization_status='failed', last_error_code=$2, last_error_detail=$3, updated_at=now() FROM control_deployments deployment WHERE deployment.id=$1 AND agent.id=deployment.agent_id", [command.deployment_id, input.errorCode ?? "command_failed", input.errorSummary ?? "Control command failed"]);
        await client.query("UPDATE control_deployments SET status='degraded', updated_at=now() WHERE id=$1", [command.deployment_id]);
      }
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

  async recordAudit(input) {
    const { rows } = await this.pool.query("INSERT INTO audit_events (id, organization_id, actor_user_id, action, target_type, target_id, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *", [input.id ?? randomUUID(), input.organizationId, input.actorUserId ?? null, input.action, input.targetType, input.targetId ?? null, input.metadata ?? {}]);
    return mapAudit(rows[0]);
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
    const { rows } = await this.pool.query("SELECT * FROM integration_runs WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2", [organizationId, limit]);
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
      `INSERT INTO obsidian_notes (id, organization_id, user_id, title, slug, markdown, frontmatter, wikilinks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (organization_id, user_id, slug) DO UPDATE SET title=EXCLUDED.title, markdown=EXCLUDED.markdown, frontmatter=EXCLUDED.frontmatter, wikilinks=EXCLUDED.wikilinks, updated_at=now()
       RETURNING *`,
      [id, input.organizationId, input.userId, input.title, input.slug, input.markdown, input.frontmatter, input.wikilinks]
    );
    return mapObsidianNote(rows[0]);
  }

  async listObsidianNotes(organizationId, userId) {
    const { rows } = await this.pool.query("SELECT * FROM obsidian_notes WHERE organization_id = $1 AND user_id = $2 ORDER BY updated_at DESC", [organizationId, userId]);
    return rows.map(mapObsidianNote);
  }
}
