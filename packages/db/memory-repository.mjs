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
  #licenses = [];
  #servers = [];
  #releases = [];
  #providerConfigurations = new Map();
  #integrationRuns = [];
  #hotspots = new Map();
  #obsidianNotes = [];

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
    return this.#integrationRuns.filter((item) => item.organizationId === organizationId).toReversed().slice(0, limit);
  }

  async listLatestHotspots(organizationId) {
    const run = this.#integrationRuns.findLast((item) => item.organizationId === organizationId && item.integrationId === "trendradar") ?? null;
    return { run, items: run ? [...(this.#hotspots.get(run.id) ?? [])] : [] };
  }

  async createObsidianNote(input) {
    const duplicate = this.#obsidianNotes.find((item) => item.organizationId === input.organizationId && item.userId === input.userId && item.slug === input.slug);
    const now = new Date().toISOString();
    if (duplicate) {
      Object.assign(duplicate, input, { updatedAt: now });
      return duplicate;
    }
    const note = { id: input.id ?? randomUUID(), ...input, createdAt: now, updatedAt: now };
    this.#obsidianNotes.push(note);
    return note;
  }

  async listObsidianNotes(organizationId, userId) {
    return this.#obsidianNotes.filter((item) => item.organizationId === organizationId && item.userId === userId).toReversed();
  }
}
