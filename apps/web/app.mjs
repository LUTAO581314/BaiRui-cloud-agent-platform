import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  PERMISSIONS,
  ROLES,
  AuthorizationError,
  can,
  isRole,
  requirePermission
} from "../../packages/auth/authorization.mjs";
import { verifyPassword, hashPassword } from "../../packages/auth/password.mjs";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSessionToken,
  parseCookies,
  sessionCookie,
  verifySessionToken
} from "../../packages/auth/session.mjs";
import { loginPage, userPage, adminPage } from "./views.mjs";
import { issueLicense } from "../../packages/license/license.mjs";

const MAX_BODY_BYTES = 64 * 1024;

function json(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function html(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

function redirect(response, location) {
  response.writeHead(303, { location });
  response.end();
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON");
    error.statusCode = 400;
    throw error;
  }
}

function sameOrigin(request, configuredOrigin) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const expected = configuredOrigin ?? `${request.headers["x-forwarded-proto"] ?? "http"}://${request.headers.host}`;
  return origin === expected;
}

function constantTokenMatch(actual, expected) {
  if (!actual || !expected) return false;
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function securityHeaders(response) {
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("cache-control", "no-store");
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
    licensePrivateKey,
    logger = console
  } = options;
  if (!repository) throw new TypeError("repository is required");
  if (!sessionSecret || sessionSecret.length < 32) throw new TypeError("sessionSecret must contain at least 32 characters");
  const loginAttempts = new Map();

  async function principalFor(request) {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    const session = verifySessionToken(token, sessionSecret);
    if (!session) return null;
    const user = await repository.getUser(session.userId);
    if (!user || user.status !== "active" || user.organizationId !== session.organizationId) return null;
    return { userId: user.id, organizationId: user.organizationId, role: user.role, email: user.email, displayName: user.displayName };
  }

  function requireLogin(principal) {
    if (!principal) {
      const error = new Error("Authentication required");
      error.statusCode = 401;
      throw error;
    }
    return principal;
  }

  return async function handle(request, response) {
    securityHeaders(response);
    const url = new URL(request.url, "http://platform.internal");
    const method = request.method ?? "GET";
    try {
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && !sameOrigin(request, configuredOrigin)) {
        return json(response, 403, { error: "origin_rejected" });
      }

      if (method === "GET" && url.pathname === "/health") return json(response, 200, { status: "ok" });
      if (method === "GET" && url.pathname === "/ready") return json(response, 200, { status: "ready" });
      if (method === "GET" && url.pathname === "/assets/styles.css") {
        response.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=300" });
        return response.end(options.styles);
      }
      if (method === "GET" && url.pathname === "/assets/login.js") {
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" });
        return response.end(options.loginScript);
      }
      if (method === "GET" && url.pathname === "/assets/user.js") {
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" });
        return response.end(options.userScript);
      }

      const principal = await principalFor(request);
      if (method === "GET" && url.pathname === "/admin/assets/admin.js") {
        if (!principal || ![ROLES.ORG_ADMIN, ROLES.PLATFORM_ADMIN].includes(principal.role)) return json(response, 404, { error: "not_found" });
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "private, no-store" });
        return response.end(options.adminScript);
      }
      if (method === "GET" && url.pathname === "/") return redirect(response, principal ? "/app" : "/login");
      if (method === "GET" && url.pathname === "/login") return html(response, 200, loginPage());
      if (method === "GET" && url.pathname === "/app") {
        if (!principal) return redirect(response, "/login");
        return html(response, 200, userPage(principal));
      }
      if (method === "GET" && url.pathname === "/admin") {
        if (!principal) return redirect(response, "/login?next=/admin");
        if (![ROLES.ORG_ADMIN, ROLES.PLATFORM_ADMIN].includes(principal.role)) return html(response, 404, "<!doctype html><title>Not found</title><h1>Not found</h1>");
        return html(response, 200, adminPage(principal));
      }

      if (method === "POST" && url.pathname === "/api/auth/login") {
        const ip = request.socket.remoteAddress ?? "unknown";
        const attempt = loginAttempts.get(ip) ?? { count: 0, resetAt: Date.now() + 60_000 };
        if (attempt.resetAt <= Date.now()) Object.assign(attempt, { count: 0, resetAt: Date.now() + 60_000 });
        if (attempt.count >= 10) return json(response, 429, { error: "too_many_attempts" });
        attempt.count += 1;
        loginAttempts.set(ip, attempt);
        const body = await readJson(request);
        const user = typeof body.email === "string" ? await repository.findUserByEmail(body.email) : null;
        if (!user || user.status !== "active" || !(await verifyPassword(body.password, user.passwordHash))) {
          return json(response, 401, { error: "invalid_credentials" });
        }
        loginAttempts.delete(ip);
        const token = createSessionToken({ userId: user.id, organizationId: user.organizationId, role: user.role }, sessionSecret);
        await repository.recordAudit({ organizationId: user.organizationId, actorUserId: user.id, action: "auth.login", targetType: "user", targetId: user.id });
        return json(response, 200, { user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } }, { "set-cookie": sessionCookie(token, { secure: secureCookies }) });
      }

      if (method === "POST" && url.pathname === "/api/auth/register") {
        if (!allowRegistration) return json(response, 404, { error: "not_found" });
        const body = await readJson(request);
        const organization = await repository.createOrganization({ name: body.organizationName || "Personal workspace" });
        const passwordHash = await hashPassword(body.password);
        const user = await repository.createUser({ organizationId: organization.id, email: body.email, displayName: body.displayName || body.email, passwordHash, role: ROLES.ORG_ADMIN });
        await repository.createAgent({ organizationId: organization.id, name: "BaiRui Agent", description: "Organization runtime agent" });
        await repository.recordAudit({ organizationId: organization.id, actorUserId: user.id, action: "organization.register", targetType: "organization", targetId: organization.id });
        return json(response, 201, { id: user.id });
      }

      if (method === "POST" && url.pathname === "/api/auth/logout") {
        return json(response, 200, { ok: true }, { "set-cookie": clearSessionCookie({ secure: secureCookies }) });
      }
      if (method === "GET" && url.pathname === "/api/me") {
        requirePermission(requireLogin(principal), PERMISSIONS.SELF_READ, { userId: principal.userId, organizationId: principal.organizationId });
        return json(response, 200, { user: principal });
      }
      if (method === "GET" && url.pathname === "/api/user/workspace") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId });
        const [agents, conversations] = await Promise.all([
          repository.listAgents(principal.organizationId),
          repository.listConversations(principal.organizationId, principal.userId)
        ]);
        return json(response, 200, { agents, conversations });
      }
      if (method === "POST" && url.pathname === "/api/user/conversations") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONVERSATION_WRITE, { organizationId: principal.organizationId, userId: principal.userId });
        const body = await readJson(request);
        const agents = await repository.listAgents(principal.organizationId);
        const agent = agents.find((item) => item.id === body.agentId);
        if (!agent) return json(response, 404, { error: "agent_not_found" });
        const conversation = await repository.createConversation({ organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id, title: body.title });
        return json(response, 201, { conversation });
      }
      const messageMatch = url.pathname.match(/^\/api\/user\/conversations\/([^/]+)\/messages$/);
      if (messageMatch && method === "GET") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONVERSATION_READ, { organizationId: principal.organizationId, userId: principal.userId });
        const conversation = await repository.getConversation(messageMatch[1]);
        if (!conversation || conversation.organizationId !== principal.organizationId || conversation.userId !== principal.userId) return json(response, 404, { error: "conversation_not_found" });
        return json(response, 200, { messages: await repository.listMessages(conversation.id) });
      }
      if (messageMatch && method === "POST") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONVERSATION_WRITE, { organizationId: principal.organizationId, userId: principal.userId });
        const conversation = await repository.getConversation(messageMatch[1]);
        if (!conversation || conversation.organizationId !== principal.organizationId || conversation.userId !== principal.userId) return json(response, 404, { error: "conversation_not_found" });
        const body = await readJson(request);
        if (typeof body.content !== "string" || !body.content.trim() || body.content.length > 20_000) return json(response, 400, { error: "invalid_message" });
        const userMessage = await repository.appendMessage({ conversationId: conversation.id, organizationId: principal.organizationId, userId: principal.userId, role: "user", content: body.content.trim() });
        if (!runtimeClient) return json(response, 503, { error: "runtime_unavailable", message: userMessage });
        const runtimeResult = await runtimeClient.invoke({ principal, conversation, content: userMessage.content });
        const assistantMessage = await repository.appendMessage({ conversationId: conversation.id, organizationId: principal.organizationId, userId: principal.userId, role: "assistant", content: runtimeResult.content });
        return json(response, 201, { userMessage, assistantMessage, runtime: runtimeResult.metadata });
      }

      if (method === "GET" && url.pathname === "/api/admin/overview") {
        requireLogin(principal);
        const permitted = can(principal, PERMISSIONS.PLATFORM_OVERVIEW_READ) || can(principal, PERMISSIONS.ORG_AUDIT_READ, { organizationId: principal.organizationId });
        if (!permitted) throw new AuthorizationError();
        const scope = principal.role === ROLES.PLATFORM_ADMIN ? undefined : principal.organizationId;
        const [users, snapshots, audit, licenses, servers, releases] = await Promise.all([repository.listUsers(scope), repository.latestControlPlaneSnapshots(scope), repository.listAudit(scope), repository.listLicenses(scope), repository.listServers(scope), principal.role === ROLES.PLATFORM_ADMIN ? repository.listReleases() : Promise.resolve([])]);
        return json(response, 200, { scope: scope ?? "platform", users: users.length, snapshots, licenses: licenses.length, servers: servers.length, releases: releases.length, recentAudit: audit.slice(0, 20) });
      }
      if (method === "GET" && url.pathname === "/api/admin/users") {
        requireLogin(principal);
        const scope = principal.role === ROLES.PLATFORM_ADMIN ? undefined : principal.organizationId;
        if (principal.role !== ROLES.PLATFORM_ADMIN) requirePermission(principal, PERMISSIONS.ORG_MEMBERS_MANAGE, { organizationId: principal.organizationId });
        else requirePermission(principal, PERMISSIONS.PLATFORM_USERS_MANAGE);
        return json(response, 200, { users: await repository.listUsers(scope) });
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
        const scope = principal.role === ROLES.PLATFORM_ADMIN ? undefined : principal.organizationId;
        return json(response, 200, { snapshots: await repository.latestControlPlaneSnapshots(scope) });
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
        await repository.recordAudit({ organizationId: body.organizationId, actorUserId: principal.userId, action: "server.create", targetType: "server", targetId: server.id });
        return json(response, 201, { server });
      }
      if (method === "GET" && url.pathname === "/api/admin/releases") {
        requirePermission(requireLogin(principal), PERMISSIONS.PLATFORM_RELEASES_MANAGE);
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

      return json(response, 404, { error: "not_found" });
    } catch (error) {
      const statusCode = error.statusCode ?? 500;
      if (statusCode >= 500) logger.error?.("Platform request failed", { method, path: url.pathname, error: error.message });
      return json(response, statusCode, { error: statusCode >= 500 ? "internal_error" : error.message });
    }
  };
}

export function createPlatformServer(options) {
  return createServer(createPlatformApp(options));
}
