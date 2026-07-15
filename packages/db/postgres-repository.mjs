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
const mapAgent = (row) => ({ id: row.id, organizationId: row.organization_id, name: row.name, description: row.description, status: row.status, createdAt: row.created_at?.toISOString?.() ?? row.created_at });
const mapConversation = (row) => ({ id: row.id, organizationId: row.organization_id, userId: row.user_id, agentId: row.agent_id, title: row.title, createdAt: row.created_at?.toISOString?.() ?? row.created_at, updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at });
const mapMessage = (row) => ({ id: row.id, conversationId: row.conversation_id, organizationId: row.organization_id, userId: row.user_id, role: row.role, content: row.content, createdAt: row.created_at?.toISOString?.() ?? row.created_at });
const mapSnapshot = (row) => ({ id: row.id, organizationId: row.organization_id, serverId: row.server_id, status: row.status, payload: row.payload, receivedAt: row.received_at?.toISOString?.() ?? row.received_at });
const mapAudit = (row) => ({ id: row.id, organizationId: row.organization_id, actorUserId: row.actor_user_id, action: row.action, targetType: row.target_type, targetId: row.target_id, metadata: row.metadata, createdAt: row.created_at?.toISOString?.() ?? row.created_at });

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
    const id = input.id ?? randomUUID();
    const { rows } = await this.pool.query("INSERT INTO agents (id, organization_id, name, description, status) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, status=EXCLUDED.status RETURNING *", [id, input.organizationId, input.name, input.description ?? "", input.status ?? "ready"]);
    return mapAgent(rows[0]);
  }

  async listAgents(organizationId) {
    const { rows } = await this.pool.query("SELECT * FROM agents WHERE organization_id = $1 ORDER BY created_at", [organizationId]);
    return rows.map(mapAgent);
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
}
