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
import { loginPage, adminPage } from "./views.mjs";
import { issueLicense } from "../../packages/license/license.mjs";
import { createObsidianNote } from "../../packages/memory/obsidian-note.mjs";
import { secretHint } from "../../packages/security/secret-envelope.mjs";
import {
  toBailongmaHotspots,
  toBailongmaMemories
} from "../../packages/bailongma-ui/compatibility.mjs";

const MAX_BODY_BYTES = 256 * 1024;
const CONTROL_LAYERS = new Set(["core-runtime", "service-integration", "data-storage", "channel-bridge", "ui-exposure"]);
const COMPONENT_STATUSES = new Set(["healthy", "degraded", "unhealthy", "unknown"]);
const TELEMETRY_SEVERITIES = new Set(["debug", "info", "warning", "error", "critical"]);

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

  async function ownedAgent(principal, agentId) {
    const agent = await repository.getAgent(agentId);
    if (!agent || agent.organizationId !== principal.organizationId || agent.ownerUserId !== principal.userId) {
      const error = new Error("agent_not_found");
      error.statusCode = 404;
      throw error;
    }
    return agent;
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
        await repository.createAgent({ organizationId: organization.id, ownerUserId: user.id, name: "bairui-agent", description: "User-owned Hermes agent" });
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

      if (method === "GET" && url.pathname === "/api/user/agents") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_READ, { organizationId: principal.organizationId, userId: principal.userId });
        const [agents, runtimes] = await Promise.all([
          repository.listAgents(principal.organizationId, principal.userId),
          repository.listAgentRuntimes(principal.organizationId, principal.userId)
        ]);
        const runtimeByAgent = new Map(runtimes.map((runtime) => [runtime.agentId, runtime]));
        return json(response, 200, { agents: agents.map((agent) => ({ ...agent, runtime: runtimeByAgent.get(agent.id) ?? null })) });
      }
      if (method === "POST" && url.pathname === "/api/user/agents") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_CREATE, { organizationId: principal.organizationId, userId: principal.userId });
        const body = await readJson(request);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name || name.length > 64) return json(response, 400, { error: "invalid_agent_name" });
        const agent = await repository.createAgent({
          organizationId: principal.organizationId,
          ownerUserId: principal.userId,
          name,
          description: typeof body.description === "string" ? body.description.trim().slice(0, 500) : "",
          avatarUrl: typeof body.avatarUrl === "string" ? body.avatarUrl.trim().slice(0, 2000) : null,
          soulMarkdown: typeof body.soulMarkdown === "string" ? body.soulMarkdown.slice(0, 50_000) : "",
          settings: {}
        });
        const runtime = await repository.createAgentRuntime({
          organizationId: principal.organizationId,
          ownerUserId: principal.userId,
          agentId: agent.id,
          workspaceRef: `hermes:${principal.organizationId}:${principal.userId}:${agent.id}`
        });
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "agent.create", targetType: "agent", targetId: agent.id });
        return json(response, 201, { agent: { ...agent, runtime } });
      }
      const userAgentMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)$/);
      if (userAgentMatch && method === "GET") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_READ, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = await repository.getAgent(userAgentMatch[1]);
        if (!agent || agent.organizationId !== principal.organizationId || agent.ownerUserId !== principal.userId) return json(response, 404, { error: "agent_not_found" });
        return json(response, 200, { agent: { ...agent, runtime: await repository.getAgentRuntimeByAgent(agent.id) } });
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
        const updated = await repository.updateAgent(agent.id, patch);
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "agent.profile.update", targetType: "agent", targetId: agent.id, metadata: { fields: Object.keys(patch) } });
        return json(response, 200, { agent: updated });
      }
      const initializeAgentMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/initialize$/);
      if (initializeAgentMatch && method === "POST") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_MANAGE_OWN, { organizationId: principal.organizationId, userId: principal.userId });
        const agent = await ownedAgent(principal, initializeAgentMatch[1]);
        const provider = await repository.getProviderConfiguration(principal.organizationId);
        if (!provider?.apiKeyEnvelope || !provider.provider || !provider.model) return json(response, 409, { error: "model_provider_not_configured" });
        const result = await repository.requestAgentProvisioning({ agentId: agent.id, requestedBy: principal.userId, provider });
        if (!result) return json(response, 404, { error: "agent_runtime_not_found" });
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "agent.initialization.request", targetType: "agent", targetId: agent.id, metadata: { deploymentId: result.deployment?.id, commandId: result.command?.id } });
        return json(response, 202, result);
      }

      const discoveryMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/runtime\/discovery$/);
      if (discoveryMatch && method === "GET") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_READ, { organizationId: principal.organizationId, userId: principal.userId });
        if (!runtimeClient) return json(response, 503, { error: "runtime_unavailable" });
        const agent = await ownedAgent(principal, discoveryMatch[1]);
        const names = ["health.detailed", "discovery.models", "discovery.capabilities", "discovery.skills", "discovery.toolsets"];
        const settled = await Promise.allSettled(names.map((operation) => runtimeClient.operation({ principal, agent, operation })));
        return json(response, 200, { agentId: agent.id, discovery: Object.fromEntries(names.map((name, index) => [name, settled[index].status === "fulfilled" ? { status: "available", data: settled[index].value } : { status: "unavailable", error: settled[index].reason.code ?? "runtime_unavailable" }])) });
      }

      const sessionsMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/sessions$/);
      if (sessionsMatch && ["GET", "POST"].includes(method)) {
        requirePermission(requireLogin(principal), method === "GET" ? PERMISSIONS.CONVERSATION_READ : PERMISSIONS.CONVERSATION_WRITE, { organizationId: principal.organizationId, userId: principal.userId });
        if (!runtimeClient) return json(response, 503, { error: "runtime_unavailable" });
        const agent = await ownedAgent(principal, sessionsMatch[1]);
        if (method === "GET") {
          return json(response, 200, await runtimeClient.operation({ principal, agent, operation: "sessions.list", input: { limit: url.searchParams.get("limit") ?? 50, offset: url.searchParams.get("offset") ?? 0, include_children: url.searchParams.get("include_children") ?? false } }));
        }
        const body = await readJson(request);
        const provider = await repository.getProviderConfiguration(principal.organizationId);
        const result = await runtimeClient.operation({ principal, agent, operation: "sessions.create", input: { body: { title: typeof body.title === "string" ? body.title.trim().slice(0, 200) : undefined, model: provider?.applyStatus === "applied" ? provider.model : undefined } } });
        return json(response, 201, result);
      }

      const sessionActionMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/sessions\/([^/]+)\/(messages|fork|chat|chat\/stream)$/);
      if (sessionActionMatch) {
        requirePermission(requireLogin(principal), method === "GET" ? PERMISSIONS.CONVERSATION_READ : PERMISSIONS.CONVERSATION_WRITE, { organizationId: principal.organizationId, userId: principal.userId });
        if (!runtimeClient) return json(response, 503, { error: "runtime_unavailable" });
        const agent = await ownedAgent(principal, sessionActionMatch[1]);
        const sessionId = sessionActionMatch[2];
        const action = sessionActionMatch[3];
        if (action === "messages" && method === "GET") return json(response, 200, await runtimeClient.operation({ principal, agent, operation: "sessions.messages", input: { session_id: sessionId } }));
        if (action === "fork" && method === "POST") {
          const body = await readJson(request);
          return json(response, 201, await runtimeClient.operation({ principal, agent, operation: "sessions.fork", input: { session_id: sessionId, body: { title: typeof body.title === "string" ? body.title.trim().slice(0, 200) : undefined } } }));
        }
        if (action === "chat" && method === "POST") {
          const body = await readJson(request);
          if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 20_000) return json(response, 400, { error: "invalid_message" });
          return json(response, 200, await runtimeClient.operation({ principal, agent, operation: "sessions.chat", input: { session_id: sessionId, body: { message: body.message.trim() } } }));
        }
        if (action === "chat/stream" && method === "POST") {
          const body = await readJson(request);
          if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 20_000) return json(response, 400, { error: "invalid_message" });
          const controller = new AbortController();
          response.on("close", () => controller.abort());
          const upstream = await runtimeClient.streamOperation({ principal, agent, operation: "sessions.chat.stream", input: { session_id: sessionId, body: { message: body.message.trim() } }, signal: controller.signal });
          return pipeRuntimeStream(response, upstream);
        }
      }

      const sessionMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/sessions\/([^/]+)$/);
      if (sessionMatch && ["GET", "PATCH", "DELETE"].includes(method)) {
        requirePermission(requireLogin(principal), method === "GET" ? PERMISSIONS.CONVERSATION_READ : PERMISSIONS.CONVERSATION_WRITE, { organizationId: principal.organizationId, userId: principal.userId });
        if (!runtimeClient) return json(response, 503, { error: "runtime_unavailable" });
        const agent = await ownedAgent(principal, sessionMatch[1]);
        const input = { session_id: sessionMatch[2] };
        if (method === "PATCH") {
          const body = await readJson(request);
          input.body = { title: typeof body.title === "string" ? body.title.trim().slice(0, 200) : undefined };
        }
        const operation = method === "GET" ? "sessions.get" : method === "PATCH" ? "sessions.update" : "sessions.delete";
        return json(response, 200, await runtimeClient.operation({ principal, agent, operation, input }));
      }

      const runsMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/runs$/);
      if (runsMatch && method === "POST") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONVERSATION_WRITE, { organizationId: principal.organizationId, userId: principal.userId });
        if (!runtimeClient) return json(response, 503, { error: "runtime_unavailable" });
        const agent = await ownedAgent(principal, runsMatch[1]);
        const body = await readJson(request);
        if (typeof body.input !== "string" || !body.input.trim() || body.input.length > 20_000) return json(response, 400, { error: "invalid_run_input" });
        const provider = await repository.getProviderConfiguration(principal.organizationId);
        return json(response, 202, await runtimeClient.operation({ principal, agent, operation: "runs.create", input: { body: { input: body.input.trim(), model: provider?.applyStatus === "applied" ? provider.model : undefined } } }));
      }

      const runActionMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/runs\/([^/]+)\/(events|approval|stop)$/);
      if (runActionMatch) {
        requirePermission(requireLogin(principal), PERMISSIONS.CONVERSATION_WRITE, { organizationId: principal.organizationId, userId: principal.userId });
        if (!runtimeClient) return json(response, 503, { error: "runtime_unavailable" });
        const agent = await ownedAgent(principal, runActionMatch[1]);
        const runId = runActionMatch[2];
        const action = runActionMatch[3];
        if (action === "events" && method === "GET") {
          const controller = new AbortController();
          response.on("close", () => controller.abort());
          const upstream = await runtimeClient.streamOperation({ principal, agent, operation: "runs.events", input: { run_id: runId }, signal: controller.signal });
          return pipeRuntimeStream(response, upstream);
        }
        if (action === "approval" && method === "POST") {
          const body = await readJson(request);
          if (!["once", "session", "always", "deny"].includes(body.choice)) return json(response, 400, { error: "invalid_approval_choice" });
          return json(response, 200, await runtimeClient.operation({ principal, agent, operation: "runs.approve", input: { run_id: runId, choice: body.choice, resolve_all: Boolean(body.resolveAll) } }));
        }
        if (action === "stop" && method === "POST") return json(response, 202, await runtimeClient.operation({ principal, agent, operation: "runs.stop", input: { run_id: runId } }));
      }

      const runMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/runs\/([^/]+)$/);
      if (runMatch && method === "GET") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONVERSATION_READ, { organizationId: principal.organizationId, userId: principal.userId });
        if (!runtimeClient) return json(response, 503, { error: "runtime_unavailable" });
        const agent = await ownedAgent(principal, runMatch[1]);
        return json(response, 200, await runtimeClient.operation({ principal, agent, operation: "runs.get", input: { run_id: runMatch[2] } }));
      }

      const jobsMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/jobs(?:\/([^/]+))?(?:\/(pause|resume|run))?$/);
      if (jobsMatch) {
        requirePermission(requireLogin(principal), method === "GET" ? PERMISSIONS.AGENT_READ : PERMISSIONS.AGENT_MANAGE_OWN, { organizationId: principal.organizationId, userId: principal.userId });
        if (!runtimeClient) return json(response, 503, { error: "runtime_unavailable" });
        const agent = await ownedAgent(principal, jobsMatch[1]);
        const jobId = jobsMatch[2];
        const action = jobsMatch[3];
        let operation;
        let input = {};
        if (!jobId && method === "GET") operation = "jobs.list";
        else if (!jobId && method === "POST") { operation = "jobs.create"; input.body = await readJson(request); }
        else if (action && method === "POST") { operation = `jobs.${action}`; input.job_id = jobId; }
        else if (jobId && method === "GET") { operation = "jobs.get"; input.job_id = jobId; }
        else if (jobId && method === "PATCH") { operation = "jobs.update"; input = { job_id: jobId, body: await readJson(request) }; }
        else if (jobId && method === "DELETE") { operation = "jobs.delete"; input.job_id = jobId; }
        if (operation) return json(response, method === "POST" ? 202 : 200, await runtimeClient.operation({ principal, agent, operation, input }));
      }

      if (method === "GET" && url.pathname === "/agent-profile") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId });
        return json(response, 200, { name: "bairui-agent", runtime: "Hermes", ui: "BaiLongma Brain UI", uiVersion: options.bailongmaUi?.version ?? "unavailable" });
      }
      if (method === "GET" && url.pathname === "/memories") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId, userId: principal.userId });
        const notes = await repository.listObsidianNotes(principal.organizationId, principal.userId);
        return json(response, 200, toBailongmaMemories(notes).slice(0, Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 120, 200))));
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
        return json(response, 200, await repository.listLatestHotspots(principal.organizationId));
      }
      if (method === "GET" && url.pathname === "/api/user/memory-notes") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId, userId: principal.userId });
        return json(response, 200, { notes: await repository.listObsidianNotes(principal.organizationId, principal.userId), format: "obsidian-markdown" });
      }
      if (method === "POST" && url.pathname === "/api/user/memory-notes") {
        requirePermission(requireLogin(principal), PERMISSIONS.AGENT_USE, { organizationId: principal.organizationId, userId: principal.userId });
        const body = await readJson(request);
        if (typeof body.title !== "string" || !body.title.trim() || typeof body.body !== "string" || !body.body.trim()) return json(response, 400, { error: "invalid_note" });
        const note = createObsidianNote({ title: body.title, body: body.body, tags: Array.isArray(body.tags) ? body.tags : [], wikilinks: Array.isArray(body.wikilinks) ? body.wikilinks : [] });
        const saved = await repository.createObsidianNote({ ...note, organizationId: principal.organizationId, userId: principal.userId });
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "memory.note.upsert", targetType: "obsidian_note", targetId: saved.id });
        return json(response, 201, { note: saved });
      }

      if (method === "GET" && url.pathname === "/api/admin/overview") {
        requireLogin(principal);
        const permitted = can(principal, PERMISSIONS.PLATFORM_OVERVIEW_READ) || can(principal, PERMISSIONS.ORG_AUDIT_READ, { organizationId: principal.organizationId });
        if (!permitted) throw new AuthorizationError();
        const scope = principal.role === ROLES.PLATFORM_ADMIN ? undefined : principal.organizationId;
        const [users, agents, runtimes, heartbeats, alerts, snapshots, audit, licenses, servers, releases] = await Promise.all([repository.listUsers(scope), repository.listAgents(scope), repository.listAgentRuntimes(scope), repository.latestAgentHeartbeats(scope), repository.listAlerts(scope), repository.latestControlPlaneSnapshots(scope), repository.listAudit(scope), repository.listLicenses(scope), repository.listServers(scope), principal.role === ROLES.PLATFORM_ADMIN ? repository.listReleases() : Promise.resolve([])]);
        return json(response, 200, { scope: scope ?? "platform", users: users.length, agents: agents.length, runtimes: runtimes.length, healthyRuntimes: runtimes.filter((runtime) => runtime.status === "ready").length, openAlerts: alerts.filter((alert) => alert.status === "open").length, heartbeats, snapshots, licenses: licenses.length, servers: servers.length, releases: releases.length, recentAudit: audit.slice(0, 20) });
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
      if (method === "GET" && url.pathname === "/api/admin/agents") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
        const scope = principal.role === ROLES.PLATFORM_ADMIN ? undefined : principal.organizationId;
        const [agents, runtimes, heartbeats, components, users] = await Promise.all([repository.listAgents(scope), repository.listAgentRuntimes(scope), repository.latestAgentHeartbeats(scope), repository.listAgentComponents(scope), repository.listUsers(scope)]);
        const runtimeByAgent = new Map(runtimes.map((runtime) => [runtime.agentId, runtime]));
        const heartbeatByRuntime = new Map(heartbeats.map((heartbeat) => [heartbeat.runtimeId, heartbeat]));
        const componentsByRuntime = new Map();
        for (const component of components) componentsByRuntime.set(component.runtimeId, [...(componentsByRuntime.get(component.runtimeId) ?? []), component]);
        const usersById = new Map(users.map((user) => [user.id, user]));
        return json(response, 200, { agents: agents.map((agent) => {
          const runtime = runtimeByAgent.get(agent.id) ?? null;
          return { ...agent, owner: usersById.get(agent.ownerUserId) ?? null, runtime, heartbeat: runtime ? heartbeatByRuntime.get(runtime.id) ?? null : null, components: runtime ? componentsByRuntime.get(runtime.id) ?? [] : [] };
        }) });
      }
      if (method === "GET" && url.pathname === "/api/admin/alerts") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
        const scope = principal.role === ROLES.PLATFORM_ADMIN ? undefined : principal.organizationId;
        return json(response, 200, { alerts: await repository.listAlerts(scope) });
      }
      if (method === "GET" && url.pathname === "/api/admin/usage") {
        requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
        const scope = principal.role === ROLES.PLATFORM_ADMIN ? undefined : principal.organizationId;
        return json(response, 200, { rollups: await repository.listUsageRollups(scope) });
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
        return json(response, 200, { catalog: INTEGRATION_CATALOG, runs: await repository.listIntegrationRuns(principal.organizationId) });
      }
      if (method === "POST" && url.pathname === "/api/admin/hotspots/refresh") {
        requireLogin(principal);
        if (principal.role !== ROLES.PLATFORM_ADMIN) requirePermission(principal, PERMISSIONS.ORG_AUDIT_READ, { organizationId: principal.organizationId });
        if (!runtimeClient) return json(response, 503, { error: "runtime_unavailable" });
        const body = await readJson(request);
        const startedAt = new Date().toISOString();
        const result = await runtimeClient.invokeIntegration({ integrationId: "trendradar", capability: "list_hotspots", input: { sources: Array.isArray(body.sources) ? body.sources : undefined } });
        const run = await repository.saveIntegrationResult({ organizationId: principal.organizationId, integrationId: "trendradar", capability: "list_hotspots", status: result.status, summary: { sources: result.output?.sources ?? [], count: result.output?.items?.length ?? 0 }, items: result.output?.items ?? [], startedAt, completedAt: result.completed_at });
        await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "integration.hotspots.refresh", targetType: "integration_run", targetId: run.id, metadata: { status: run.status, count: result.output?.items?.length ?? 0 } });
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
      if (method === "POST" && url.pathname === "/api/internal/control-plane/heartbeats") {
        const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
        if (!constantTokenMatch(bearer, agentIngestToken)) return json(response, 401, { error: "invalid_agent_credential" });
        const body = await readJson(request);
        if (!body.organizationId || !body.userId || !body.agentId || !body.runtimeId || !Number.isSafeInteger(body.sequence) || body.sequence < 1 || !COMPONENT_STATUSES.has(body.status) || !Number.isFinite(Date.parse(body.observedAt))) return json(response, 400, { error: "invalid_agent_heartbeat" });
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
