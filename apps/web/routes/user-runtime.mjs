import { PERMISSIONS, requirePermission } from "../../../packages/auth/authorization.mjs";
import { json, readJson } from "../http.mjs";
import { workspaceIdFromRef } from "../../../packages/server-protocol/runtime-client.mjs";
import { assertSceneId, defaultSceneView, sceneEventMessage, sceneIntent, scenePatch, sceneSnapshot } from "../../../packages/scene/projection.mjs";

const HERMES_MANAGEMENT_OPERATIONS = new Set([
  "provider.catalog", "provider.validate", "provider.oauth.list", "provider.oauth.start", "provider.oauth.submit", "provider.oauth.poll", "provider.oauth.cancel",
  "model.info", "model.options", "model.recommended", "model.auxiliary", "model.set", "model.moa.get", "model.moa.set",
  "toolsets.list", "toolsets.update", "toolsets.config", "toolsets.models", "toolsets.model", "toolsets.provider", "toolsets.post_setup",
  "skills.list", "skills.toggle", "skills.content", "skills.create", "skills.update", "skills.hub.sources", "skills.hub.search", "skills.hub.preview", "skills.hub.scan", "skills.hub.install", "skills.hub.update", "skills.hub.uninstall",
  "memory.status", "memory.provider.config", "memory.provider.setup", "memory.provider.set", "memory.provider.oauth.start", "memory.provider.oauth.status", "memory.reset", "memory.learning.graph", "memory.learning.node.get", "memory.learning.node.update", "memory.learning.node.delete", "memory.curator.get", "memory.curator.pause", "memory.curator.run",
  "mcp.list", "mcp.catalog", "mcp.catalog.install", "mcp.create", "mcp.update", "mcp.delete", "mcp.test", "mcp.auth", "mcp.enabled",
  "profiles.list", "profiles.active.get", "profiles.active.set", "profiles.create", "profiles.get", "profiles.update", "profiles.delete", "profiles.soul.get", "profiles.soul.set", "profiles.description.set", "profiles.model.set", "profiles.setup-command",
  "cron.list", "cron.get", "cron.create", "cron.update", "cron.pause", "cron.resume", "cron.trigger", "cron.delete", "cron.history", "cron.delivery_targets", "cron.blueprints", "cron.blueprint.instantiate",
  "channel.platforms", "channel.platform.test", "channel.pairing.list", "channel.pairing.approve", "channel.pairing.revoke", "channel.pairing.clear",
  "analytics.usage", "analytics.models",
  "diagnostics.status", "diagnostics.system.stats", "diagnostics.doctor", "diagnostics.security_audit", "diagnostics.checkpoints", "diagnostics.backup", "diagnostics.debug_share",
  "files.list", "files.read", "files.read-data-url", "files.download", "files.write", "files.upload", "files.mkdir", "files.delete"
]);

const READ_ONLY_MANAGEMENT_OPERATIONS = new Set([
  "provider.catalog", "provider.oauth.list", "model.info", "model.options", "model.recommended", "model.auxiliary", "model.moa.get",
  "toolsets.list", "toolsets.config", "toolsets.models", "skills.list", "skills.content", "skills.hub.sources", "skills.hub.search", "skills.hub.preview", "skills.hub.scan",
  "memory.status", "memory.provider.config", "memory.provider.oauth.status", "memory.learning.graph", "memory.learning.node.get", "memory.curator.get",
  "mcp.list", "mcp.catalog", "profiles.list", "profiles.active.get", "profiles.get", "profiles.soul.get", "profiles.setup-command",
  "cron.list", "cron.get", "cron.history", "cron.delivery_targets", "cron.blueprints", "analytics.usage", "analytics.models", "diagnostics.status", "diagnostics.system.stats", "diagnostics.checkpoints", "files.list", "files.read", "files.read-data-url", "files.download", "channel.platforms", "channel.pairing.list"
]);

const SECRET_FIELD = /(?:password|passphrase|secret|token|api[-_]?key|private[-_]?key|credential(?:[-_]?envelope)?|authorization|cookie|raw_env|raw_yaml|env_file)$/i;
const RAW_SECRET_INPUT_FIELD = /(?:password|passphrase|secret|token|api[-_]?key|private[-_]?key|credential(?:[-_]?envelope)?|authorization|cookie|raw_env|raw_yaml|env_file)$/i;
const SCENE_RUNTIME_OPERATIONS = new Set(["sessions.get", "sessions.messages", "sessions.chat", "runs.get", "runs.stop", "runs.approve", "memory.snapshot", "memory.apply"]);

function redactManagementValue(value, key = "") {
  if (SECRET_FIELD.test(key)) return undefined;
  if (Array.isArray(value)) return value.map((item) => redactManagementValue(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([name, item]) => {
    const redacted = redactManagementValue(item, name);
    return redacted === undefined ? [] : [[name, redacted]];
  }));
}

function containsRawSecretInput(value, key = "") {
  if (RAW_SECRET_INPUT_FIELD.test(key)) return true;
  if (Array.isArray(value)) return value.some((item) => containsRawSecretInput(item));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([name, item]) => containsRawSecretInput(item, name));
}

function requestedModel(input) {
  if (typeof input?.model === "string") return input.model.trim();
  if (typeof input?.model_id === "string") return input.model_id.trim();
  if (input?.body && typeof input.body === "object" && !Array.isArray(input.body)) return requestedModel(input.body);
  return "";
}

function discoveredModelIds(value) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : Array.isArray(value?.models) ? value.models : [];
  return new Set(list.map((item) => typeof item === "string" ? item : item?.id ?? item?.model ?? item?.name).filter(Boolean));
}

function decodeOperation(value) {
  try { return decodeURIComponent(value); } catch { return ""; }
}

function sceneScope(principal, agent, runtime) {
  const workspaceRef = runtime?.workspaceRef ?? `hermes:${principal.organizationId}:${principal.userId}:${agent.id}`;
  return {
    organization_id: principal.organizationId,
    user_id: principal.userId,
    agent_id: agent.id,
    workspace_id: runtime?.workspaceId ?? workspaceIdFromRef(workspaceRef)
  };
}

export function createUserRuntimeRoutes(options) {
  const {
    repository,
    runtimeClient,
    requireLogin,
    ownedAgent,
    requireOperationalAgent,
    modelAccess,
    startAgentRun,
    synchronizeAgentRun,
    pipeRuntimeStream,
    maxChatBodyBytes,
    sessionMessage,
    publicAgentRun,
    terminalAgentRunStatuses
  } = options;

  return async function routeUserRuntime(context) {
    const { method, url, request, response, principal } = context;
    const send = (statusCode, body) => {
      json(response, statusCode, body);
      return true;
    };

    const managementMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/hermes\/operations\/([^/]+)$/);
    if (managementMatch && ["GET", "POST"].includes(method)) {
      const operation = decodeOperation(managementMatch[2]);
      if (!HERMES_MANAGEMENT_OPERATIONS.has(operation)) return send(404, { error: "unsupported_hermes_operation" });
      const loggedIn = requireLogin(principal);
      requirePermission(loggedIn, READ_ONLY_MANAGEMENT_OPERATIONS.has(operation) ? PERMISSIONS.AGENT_READ : PERMISSIONS.AGENT_MANAGE_OWN, { organizationId: loggedIn.organizationId, userId: loggedIn.userId });
      const agent = await ownedAgent(loggedIn, managementMatch[1]);
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      if (!READ_ONLY_MANAGEMENT_OPERATIONS.has(operation)) await requireOperationalAgent(loggedIn, agent);
      const input = method === "GET" ? Object.fromEntries(url.searchParams.entries()) : await readJson(request, maxChatBodyBytes);
      if (!input || typeof input !== "object" || Array.isArray(input)) return send(400, { error: "invalid_hermes_operation_input" });
      if (containsRawSecretInput(input)) return send(400, { error: "opaque_credentials_required" });
      let result;
      if (operation === "model.set") {
        const model = requestedModel(input);
        if (!model || model.length > 200 || /[\0\r\n]/.test(model)) return send(400, { error: "invalid_model" });
        const policy = await modelAccess(loggedIn.organizationId);
        if (!policy.allowedModels.includes(model)) return send(400, { error: "model_not_allowed" });
        const discovered = await runtimeClient.operation({ principal: loggedIn, agent, operation: "discovery.models", input: {} });
        if (!discoveredModelIds(discovered).has(model)) return send(400, { error: "model_not_available" });
        result = await runtimeClient.operation({ principal: loggedIn, agent, operation, input });
        const settings = { ...(agent.settings ?? {}), preferredModel: model };
        await repository.updateAgent(agent.id, { settings });
      } else {
        result = await runtimeClient.operation({ principal: loggedIn, agent, operation, input });
      }
      await repository.recordAudit({ organizationId: loggedIn.organizationId, actorUserId: loggedIn.userId, action: `hermes.${operation}`, targetType: "agent", targetId: agent.id, metadata: { operation, method } });
      return send(200, redactManagementValue(result));
    }

    const sceneMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/scenes\/([^/]+)$/);
    const sceneEventsMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/scenes\/([^/]+)\/events$/);
    const sceneIntentMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/scenes\/([^/]+)\/intents$/);
    if ((sceneMatch && method === "GET") || (sceneEventsMatch && method === "GET") || (sceneIntentMatch && method === "POST")) {
      const loggedIn = requireLogin(principal);
      requirePermission(loggedIn, sceneIntentMatch ? PERMISSIONS.AGENT_USE : PERMISSIONS.AGENT_READ, { organizationId: loggedIn.organizationId, userId: loggedIn.userId });
      const agentId = sceneMatch?.[1] ?? sceneEventsMatch?.[1] ?? sceneIntentMatch?.[1];
      const sceneId = assertSceneId(sceneMatch?.[2] ?? sceneEventsMatch?.[2] ?? sceneIntentMatch?.[2]);
      const agent = await ownedAgent(loggedIn, agentId);
      const runtime = await repository.getAgentRuntimeByAgent(agent.id);
      const ownerScope = sceneScope(loggedIn, agent, runtime);
      let scene = await repository.getAgentScene({ organizationId: loggedIn.organizationId, userId: loggedIn.userId, agentId: agent.id, sceneId });
      if (!scene) scene = await repository.ensureAgentScene({ organizationId: loggedIn.organizationId, userId: loggedIn.userId, agentId: agent.id, sceneId, view: defaultSceneView(agent) });
      if (!scene) return send(404, { error: "scene_not_found" });

      if (sceneMatch) return send(200, sceneSnapshot(scene, ownerScope));
      if (sceneEventsMatch) {
        const after = Math.max(0, Number(url.searchParams.get("after") ?? 0) || 0);
        response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
        response.write(`retry: 3000\n\n`);
        let cursor = after;
        let open = true;
        response.on("close", () => { open = false; });
        const emit = (event, data) => { if (open && !response.writableEnded) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
        if (cursor === 0) {
          emit("scene", sceneEventMessage(sceneSnapshot(scene, ownerScope)));
          cursor = scene.revision;
        }
        while (open && !response.writableEnded) {
          const events = await repository.listAgentSceneEvents({ organizationId: loggedIn.organizationId, userId: loggedIn.userId, agentId: agent.id, sceneId, afterRevision: cursor, limit: 100 });
          if (events.length) {
            for (const event of events) {
              if (event.baseRevision !== cursor) {
                const latest = await repository.getAgentScene({ organizationId: loggedIn.organizationId, userId: loggedIn.userId, agentId: agent.id, sceneId });
                if (latest) emit("scene", sceneEventMessage(sceneSnapshot(latest, ownerScope)));
                cursor = latest?.revision ?? cursor;
                break;
              }
              emit("scene.patch", sceneEventMessage(scenePatch(event, ownerScope)));
              cursor = event.revision;
            }
          }
          if (open && !response.writableEnded) await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (!response.writableEnded) response.end();
        return true;
      }

      const body = await readJson(request, maxChatBodyBytes);
      if (!body || typeof body !== "object" || Array.isArray(body) || !["navigate", "command", "refresh", "resync"].includes(body.action)) return send(400, { error: "invalid_scene_intent" });
      const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {};
      const intent = sceneIntent({ sceneId, ownerScope, action: body.action, payload });
      let result = null;
      if (body.action === "command") {
        const operation = String(payload.operation ?? "");
        if (![...HERMES_MANAGEMENT_OPERATIONS, ...SCENE_RUNTIME_OPERATIONS].includes(operation)) return send(400, { error: "unsupported_scene_command" });
        if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
        await requireOperationalAgent(loggedIn, agent);
        const operationInput = payload.input && typeof payload.input === "object" && !Array.isArray(payload.input) ? payload.input : {};
        if (containsRawSecretInput(operationInput)) return send(400, { error: "opaque_credentials_required" });
        result = await runtimeClient.operation({ principal: loggedIn, agent, operation, input: operationInput });
      }
      const view = body.action === "navigate"
        ? { ...scene.view, navigation: { surface: String(payload.surface ?? ""), updatedAt: new Date().toISOString() } }
        : scene.view;
      const applied = await repository.applyAgentSceneIntent({ organizationId: loggedIn.organizationId, userId: loggedIn.userId, agentId: agent.id, sceneId, action: intent.action, view, eventId: intent.intent_id });
      await repository.recordAudit({ organizationId: loggedIn.organizationId, actorUserId: loggedIn.userId, action: `scene.${intent.action}`, targetType: "scene", targetId: `${agent.id}:${sceneId}`, metadata: { sceneId, revision: applied?.scene?.revision ?? scene.revision, operation: body.action === "command" ? payload.operation : null } });
      return send(200, { intent_id: intent.intent_id, scene: sceneSnapshot(applied?.scene ?? scene, ownerScope), ...(applied?.patch ? { patch: scenePatch(applied.patch, ownerScope) } : {}), ...(result ? { result: redactManagementValue(result) } : {}) });
    }

    const discoveryMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/runtime\/discovery$/);
    if (discoveryMatch && method === "GET") {
      const loggedIn = requireLogin(principal);
      requirePermission(loggedIn, PERMISSIONS.AGENT_READ, { organizationId: loggedIn.organizationId, userId: loggedIn.userId });
      const agent = await ownedAgent(loggedIn, discoveryMatch[1]);
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      const names = ["health.detailed", "discovery.models", "discovery.capabilities", "discovery.skills", "discovery.toolsets"];
      const [settled, policy] = await Promise.all([
        Promise.allSettled(names.map((operation) => runtimeClient.operation({ principal: loggedIn, agent, operation }))),
        modelAccess(loggedIn.organizationId)
      ]);
      return send(200, {
        agentId: agent.id,
        discovery: Object.fromEntries(names.map((name, index) => [name, settled[index].status === "fulfilled" ? { status: "available", data: redactManagementValue(settled[index].value) } : { status: "unavailable", error: settled[index].reason.code ?? "runtime_unavailable" }])),
        policy
      });
    }

    const sessionsMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/sessions$/);
    if (sessionsMatch && ["GET", "POST"].includes(method)) {
      const loggedIn = requireLogin(principal);
      requirePermission(loggedIn, method === "GET" ? PERMISSIONS.CONVERSATION_READ : PERMISSIONS.CONVERSATION_WRITE, { organizationId: loggedIn.organizationId, userId: loggedIn.userId });
      const agent = await ownedAgent(loggedIn, sessionsMatch[1]);
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      if (method === "POST") await requireOperationalAgent(loggedIn, agent);
      if (method === "GET") {
        return send(200, await runtimeClient.operation({ principal: loggedIn, agent, operation: "sessions.list", input: { limit: url.searchParams.get("limit") ?? 50, offset: url.searchParams.get("offset") ?? 0, include_children: url.searchParams.get("include_children") ?? false } }));
      }
      const body = await readJson(request);
      const policy = await modelAccess(loggedIn.organizationId);
      const preferredModel = policy.allowedModels.includes(agent.settings?.preferredModel) ? agent.settings.preferredModel : undefined;
      const result = await runtimeClient.operation({ principal: loggedIn, agent, operation: "sessions.create", input: { body: { title: typeof body.title === "string" ? body.title.trim().slice(0, 200) : undefined, model: preferredModel || policy.defaultModel || undefined } } });
      return send(201, result);
    }

    const sessionActionMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/sessions\/([^/]+)\/(messages|fork|chat|chat\/stream)$/);
    if (sessionActionMatch) {
      const loggedIn = requireLogin(principal);
      requirePermission(loggedIn, method === "GET" ? PERMISSIONS.CONVERSATION_READ : PERMISSIONS.CONVERSATION_WRITE, { organizationId: loggedIn.organizationId, userId: loggedIn.userId });
      const agent = await ownedAgent(loggedIn, sessionActionMatch[1]);
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      const sessionId = sessionActionMatch[2];
      const action = sessionActionMatch[3];
      if (method === "POST" && ["fork", "chat", "chat/stream"].includes(action)) await requireOperationalAgent(loggedIn, agent);
      if (action === "messages" && method === "GET") return send(200, await runtimeClient.operation({ principal: loggedIn, agent, operation: "sessions.messages", input: { session_id: sessionId } }));
      if (action === "fork" && method === "POST") {
        const body = await readJson(request);
        return send(201, await runtimeClient.operation({ principal: loggedIn, agent, operation: "sessions.fork", input: { session_id: sessionId, body: { title: typeof body.title === "string" ? body.title.trim().slice(0, 200) : undefined } } }));
      }
      if (action === "chat" && method === "POST") {
        const body = await readJson(request, maxChatBodyBytes);
        const message = sessionMessage(body);
        if (!message) return send(400, { error: "invalid_message" });
        return send(200, await runtimeClient.operation({ principal: loggedIn, agent, operation: "sessions.chat", input: { session_id: sessionId, body: { message } } }));
      }
      if (action === "chat/stream" && method === "POST") {
        const body = await readJson(request, maxChatBodyBytes);
        const message = sessionMessage(body);
        if (!message) return send(400, { error: "invalid_message" });
        const controller = new AbortController();
        response.on("close", () => controller.abort());
        const upstream = await runtimeClient.streamOperation({ principal: loggedIn, agent, operation: "sessions.chat.stream", input: { session_id: sessionId, body: { message } }, signal: controller.signal });
        await pipeRuntimeStream(response, upstream);
        return true;
      }
      return false;
    }

    const sessionMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/sessions\/([^/]+)$/);
    if (sessionMatch && ["GET", "PATCH", "DELETE"].includes(method)) {
      const loggedIn = requireLogin(principal);
      requirePermission(loggedIn, method === "GET" ? PERMISSIONS.CONVERSATION_READ : PERMISSIONS.CONVERSATION_WRITE, { organizationId: loggedIn.organizationId, userId: loggedIn.userId });
      const agent = await ownedAgent(loggedIn, sessionMatch[1]);
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      const input = { session_id: sessionMatch[2] };
      if (method === "PATCH") {
        const body = await readJson(request);
        input.body = { title: typeof body.title === "string" ? body.title.trim().slice(0, 200) : undefined };
      }
      const operation = method === "GET" ? "sessions.get" : method === "PATCH" ? "sessions.update" : "sessions.delete";
      return send(200, await runtimeClient.operation({ principal: loggedIn, agent, operation, input }));
    }

    const runsMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/runs$/);
    if (runsMatch && ["GET", "POST"].includes(method)) {
      const loggedIn = requireLogin(principal);
      requirePermission(loggedIn, method === "GET" ? PERMISSIONS.CONVERSATION_READ : PERMISSIONS.CONVERSATION_WRITE, { organizationId: loggedIn.organizationId, userId: loggedIn.userId });
      const agent = await ownedAgent(loggedIn, runsMatch[1]);
      if (method === "GET") {
        const runs = await repository.listAgentRuns(loggedIn.organizationId, loggedIn.userId, agent.id, url.searchParams.get("limit") ?? 50);
        return send(200, { runs: runs.map(publicAgentRun) });
      }
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      await requireOperationalAgent(loggedIn, agent);
      const body = await readJson(request);
      if (typeof body.input !== "string" || !body.input.trim() || body.input.length > 20_000) return send(400, { error: "invalid_run_input" });
      const policy = await modelAccess(loggedIn.organizationId);
      const model = policy.allowedModels.includes(agent.settings?.preferredModel) ? agent.settings.preferredModel : policy.defaultModel;
      return send(202, await startAgentRun(loggedIn, agent, body.input.trim(), model));
    }

    const runActionMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/runs\/([^/]+)\/(events|approval|stop|retry)$/);
    if (runActionMatch) {
      const loggedIn = requireLogin(principal);
      requirePermission(loggedIn, PERMISSIONS.CONVERSATION_WRITE, { organizationId: loggedIn.organizationId, userId: loggedIn.userId });
      const agent = await ownedAgent(loggedIn, runActionMatch[1]);
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      const runId = runActionMatch[2];
      const action = runActionMatch[3];
      if (action === "retry" && method === "POST") {
        await requireOperationalAgent(loggedIn, agent);
        const previous = await repository.getAgentRun(loggedIn.organizationId, loggedIn.userId, agent.id, runId);
        if (!previous) return send(404, { error: "run_not_found" });
        if (!terminalAgentRunStatuses.has(previous.status)) return send(409, { error: "run_not_terminal" });
        return send(202, await startAgentRun(loggedIn, agent, previous.inputText, previous.model, previous.id));
      }
      if (action === "events" && method === "GET") {
        const controller = new AbortController();
        response.on("close", () => controller.abort());
        const upstream = await runtimeClient.streamOperation({ principal: loggedIn, agent, operation: "runs.events", input: { run_id: runId }, signal: controller.signal });
        await pipeRuntimeStream(response, upstream);
        return true;
      }
      if (action === "approval" && method === "POST") {
        const body = await readJson(request);
        if (!["once", "session", "always", "deny"].includes(body.choice)) return send(400, { error: "invalid_approval_choice" });
        const result = await runtimeClient.operation({ principal: loggedIn, agent, operation: "runs.approve", input: { run_id: runId, choice: body.choice, resolve_all: Boolean(body.resolveAll) } });
        await repository.updateAgentRun({ id: runId, organizationId: loggedIn.organizationId, userId: loggedIn.userId, agentId: agent.id, status: "running" });
        return send(200, result);
      }
      if (action === "stop" && method === "POST") {
        const result = await runtimeClient.operation({ principal: loggedIn, agent, operation: "runs.stop", input: { run_id: runId } });
        await repository.updateAgentRun({ id: runId, organizationId: loggedIn.organizationId, userId: loggedIn.userId, agentId: agent.id, status: "stopping" });
        return send(202, result);
      }
      return false;
    }

    const runMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/runs\/([^/]+)$/);
    if (runMatch && method === "GET") {
      const loggedIn = requireLogin(principal);
      requirePermission(loggedIn, PERMISSIONS.CONVERSATION_READ, { organizationId: loggedIn.organizationId, userId: loggedIn.userId });
      const agent = await ownedAgent(loggedIn, runMatch[1]);
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      return send(200, await synchronizeAgentRun(loggedIn, agent, runMatch[2]));
    }

    const jobsMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/jobs(?:\/([^/]+))?(?:\/(pause|resume|run))?$/);
    if (jobsMatch) {
      const loggedIn = requireLogin(principal);
      requirePermission(loggedIn, method === "GET" ? PERMISSIONS.AGENT_READ : PERMISSIONS.AGENT_MANAGE_OWN, { organizationId: loggedIn.organizationId, userId: loggedIn.userId });
      const agent = await ownedAgent(loggedIn, jobsMatch[1]);
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      const jobId = jobsMatch[2];
      const action = jobsMatch[3];
      let operation;
      let input = {};
      if (!jobId && method === "GET") operation = "jobs.list";
      else if (!jobId && method === "POST") { operation = "jobs.create"; input.body = await readJson(request); }
      else if (action && method === "POST") { operation = "jobs." + action; input.job_id = jobId; }
      else if (jobId && method === "GET") { operation = "jobs.get"; input.job_id = jobId; }
      else if (jobId && method === "PATCH") { operation = "jobs.update"; input = { job_id: jobId, body: await readJson(request) }; }
      else if (jobId && method === "DELETE") { operation = "jobs.delete"; input.job_id = jobId; }
      if (["jobs.create", "jobs.run"].includes(operation)) await requireOperationalAgent(loggedIn, agent);
      if (operation) return send(method === "POST" ? 202 : 200, await runtimeClient.operation({ principal: loggedIn, agent, operation, input }));
      return false;
    }
    return false;
  };
}
