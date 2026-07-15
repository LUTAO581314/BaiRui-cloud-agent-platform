import { randomUUID } from "node:crypto";
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
const mapAgentRuntime = (row) => row ? ({ id: row.id, organizationId: row.organization_id, ownerUserId: row.owner_user_id, agentId: row.agent_id, deploymentId: row.deployment_id, workspaceRef: row.workspace_ref, runtimeKind: row.runtime_kind, status: row.status, hermesVersion: row.hermes_version, boundaryVersion: row.boundary_version, configRevisionId: row.config_revision_id, lastHeartbeatAt: row.last_heartbeat_at?.toISOString?.() ?? row.last_heartbeat_at, lastErrorCode: row.last_error_code, lastErrorDetail: row.last_error_detail, createdAt: row.created_at?.toISOString?.() ?? row.created_at, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at }) : null;
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
      : ["SELECT * FROM agents WHERE organization_id = $1 ORDER BY updated_at DESC", [organizationId]];
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
      : ["SELECT * FROM agent_runtimes WHERE organization_id = $1 ORDER BY updated_at DESC", [organizationId]];
    const { rows } = await this.pool.query(...query);
    return rows.map(mapAgentRuntime);
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
