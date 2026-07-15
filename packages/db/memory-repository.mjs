import { randomUUID } from "node:crypto";

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

export class MemoryPlatformRepository {
  #organizations = new Map();
  #users = new Map();
  #agents = new Map();
  #conversations = new Map();
  #messages = new Map();
  #snapshots = [];
  #audit = [];

  async createOrganization(input) {
    const organization = { id: input.id ?? randomUUID(), name: input.name, createdAt: new Date().toISOString() };
    this.#organizations.set(organization.id, organization);
    return organization;
  }

  async getOrganization(id) {
    return this.#organizations.get(id) ?? null;
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
    const agent = { id: input.id ?? randomUUID(), organizationId: input.organizationId, name: input.name, description: input.description ?? "", status: input.status ?? "ready", createdAt: new Date().toISOString() };
    this.#agents.set(agent.id, agent);
    return agent;
  }

  async listAgents(organizationId) {
    return [...this.#agents.values()].filter((agent) => agent.organizationId === organizationId);
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
    return this.#audit.filter((event) => !organizationId || event.organizationId === organizationId);
  }
}
