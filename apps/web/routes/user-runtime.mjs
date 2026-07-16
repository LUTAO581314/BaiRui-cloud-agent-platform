import { PERMISSIONS, requirePermission } from "../../../packages/auth/authorization.mjs";
import { json, readJson } from "../http.mjs";

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

    const discoveryMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/runtime\/discovery$/);
    if (discoveryMatch && method === "GET") {
      requirePermission(requireLogin(principal), PERMISSIONS.AGENT_READ, { organizationId: principal.organizationId, userId: principal.userId });
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      const agent = await ownedAgent(principal, discoveryMatch[1]);
      const names = ["health.detailed", "discovery.models", "discovery.capabilities", "discovery.skills", "discovery.toolsets"];
      const [settled, policy] = await Promise.all([
        Promise.allSettled(names.map((operation) => runtimeClient.operation({ principal, agent, operation }))),
        modelAccess(principal.organizationId)
      ]);
      return send(200, {
        agentId: agent.id,
        discovery: Object.fromEntries(names.map((name, index) => [name, settled[index].status === "fulfilled" ? { status: "available", data: settled[index].value } : { status: "unavailable", error: settled[index].reason.code ?? "runtime_unavailable" }])),
        policy
      });
    }

    const sessionsMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/sessions$/);
    if (sessionsMatch && ["GET", "POST"].includes(method)) {
      requirePermission(requireLogin(principal), method === "GET" ? PERMISSIONS.CONVERSATION_READ : PERMISSIONS.CONVERSATION_WRITE, { organizationId: principal.organizationId, userId: principal.userId });
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      const agent = await ownedAgent(principal, sessionsMatch[1]);
      if (method === "POST") await requireOperationalAgent(principal, agent);
      if (method === "GET") {
        return send(200, await runtimeClient.operation({ principal, agent, operation: "sessions.list", input: { limit: url.searchParams.get("limit") ?? 50, offset: url.searchParams.get("offset") ?? 0, include_children: url.searchParams.get("include_children") ?? false } }));
      }
      const body = await readJson(request);
      const policy = await modelAccess(principal.organizationId);
      const preferredModel = policy.allowedModels.includes(agent.settings?.preferredModel) ? agent.settings.preferredModel : undefined;
      const result = await runtimeClient.operation({ principal, agent, operation: "sessions.create", input: { body: { title: typeof body.title === "string" ? body.title.trim().slice(0, 200) : undefined, model: preferredModel || policy.defaultModel || undefined } } });
      return send(201, result);
    }

    const sessionActionMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/sessions\/([^/]+)\/(messages|fork|chat|chat\/stream)$/);
    if (sessionActionMatch) {
      requirePermission(requireLogin(principal), method === "GET" ? PERMISSIONS.CONVERSATION_READ : PERMISSIONS.CONVERSATION_WRITE, { organizationId: principal.organizationId, userId: principal.userId });
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      const agent = await ownedAgent(principal, sessionActionMatch[1]);
      const sessionId = sessionActionMatch[2];
      const action = sessionActionMatch[3];
      if (method === "POST" && ["fork", "chat", "chat/stream"].includes(action)) await requireOperationalAgent(principal, agent);
      if (action === "messages" && method === "GET") return send(200, await runtimeClient.operation({ principal, agent, operation: "sessions.messages", input: { session_id: sessionId } }));
      if (action === "fork" && method === "POST") {
        const body = await readJson(request);
        return send(201, await runtimeClient.operation({ principal, agent, operation: "sessions.fork", input: { session_id: sessionId, body: { title: typeof body.title === "string" ? body.title.trim().slice(0, 200) : undefined } } }));
      }
      if (action === "chat" && method === "POST") {
        const body = await readJson(request, maxChatBodyBytes);
        const message = sessionMessage(body);
        if (!message) return send(400, { error: "invalid_message" });
        return send(200, await runtimeClient.operation({ principal, agent, operation: "sessions.chat", input: { session_id: sessionId, body: { message } } }));
      }
      if (action === "chat/stream" && method === "POST") {
        const body = await readJson(request, maxChatBodyBytes);
        const message = sessionMessage(body);
        if (!message) return send(400, { error: "invalid_message" });
        const controller = new AbortController();
        response.on("close", () => controller.abort());
        const upstream = await runtimeClient.streamOperation({ principal, agent, operation: "sessions.chat.stream", input: { session_id: sessionId, body: { message } }, signal: controller.signal });
        await pipeRuntimeStream(response, upstream);
        return true;
      }
      return false;
    }

    const sessionMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/sessions\/([^/]+)$/);
    if (sessionMatch && ["GET", "PATCH", "DELETE"].includes(method)) {
      requirePermission(requireLogin(principal), method === "GET" ? PERMISSIONS.CONVERSATION_READ : PERMISSIONS.CONVERSATION_WRITE, { organizationId: principal.organizationId, userId: principal.userId });
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      const agent = await ownedAgent(principal, sessionMatch[1]);
      const input = { session_id: sessionMatch[2] };
      if (method === "PATCH") {
        const body = await readJson(request);
        input.body = { title: typeof body.title === "string" ? body.title.trim().slice(0, 200) : undefined };
      }
      const operation = method === "GET" ? "sessions.get" : method === "PATCH" ? "sessions.update" : "sessions.delete";
      return send(200, await runtimeClient.operation({ principal, agent, operation, input }));
    }

    const runsMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/runs$/);
    if (runsMatch && ["GET", "POST"].includes(method)) {
      requirePermission(requireLogin(principal), method === "GET" ? PERMISSIONS.CONVERSATION_READ : PERMISSIONS.CONVERSATION_WRITE, { organizationId: principal.organizationId, userId: principal.userId });
      const agent = await ownedAgent(principal, runsMatch[1]);
      if (method === "GET") {
        const runs = await repository.listAgentRuns(principal.organizationId, principal.userId, agent.id, url.searchParams.get("limit") ?? 50);
        return send(200, { runs: runs.map(publicAgentRun) });
      }
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      await requireOperationalAgent(principal, agent);
      const body = await readJson(request);
      if (typeof body.input !== "string" || !body.input.trim() || body.input.length > 20_000) return send(400, { error: "invalid_run_input" });
      const policy = await modelAccess(principal.organizationId);
      const model = policy.allowedModels.includes(agent.settings?.preferredModel) ? agent.settings.preferredModel : policy.defaultModel;
      return send(202, await startAgentRun(principal, agent, body.input.trim(), model));
    }

    const runActionMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/runs\/([^/]+)\/(events|approval|stop|retry)$/);
    if (runActionMatch) {
      requirePermission(requireLogin(principal), PERMISSIONS.CONVERSATION_WRITE, { organizationId: principal.organizationId, userId: principal.userId });
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      const agent = await ownedAgent(principal, runActionMatch[1]);
      const runId = runActionMatch[2];
      const action = runActionMatch[3];
      if (action === "retry" && method === "POST") {
        await requireOperationalAgent(principal, agent);
        const previous = await repository.getAgentRun(principal.organizationId, principal.userId, agent.id, runId);
        if (!previous) return send(404, { error: "run_not_found" });
        if (!terminalAgentRunStatuses.has(previous.status)) return send(409, { error: "run_not_terminal" });
        return send(202, await startAgentRun(principal, agent, previous.inputText, previous.model, previous.id));
      }
      if (action === "events" && method === "GET") {
        const controller = new AbortController();
        response.on("close", () => controller.abort());
        const upstream = await runtimeClient.streamOperation({ principal, agent, operation: "runs.events", input: { run_id: runId }, signal: controller.signal });
        await pipeRuntimeStream(response, upstream);
        return true;
      }
      if (action === "approval" && method === "POST") {
        const body = await readJson(request);
        if (!["once", "session", "always", "deny"].includes(body.choice)) return send(400, { error: "invalid_approval_choice" });
        const result = await runtimeClient.operation({ principal, agent, operation: "runs.approve", input: { run_id: runId, choice: body.choice, resolve_all: Boolean(body.resolveAll) } });
        await repository.updateAgentRun({ id: runId, organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id, status: "running" });
        return send(200, result);
      }
      if (action === "stop" && method === "POST") {
        const result = await runtimeClient.operation({ principal, agent, operation: "runs.stop", input: { run_id: runId } });
        await repository.updateAgentRun({ id: runId, organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id, status: "stopping" });
        return send(202, result);
      }
      return false;
    }

    const runMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/runs\/([^/]+)$/);
    if (runMatch && method === "GET") {
      requirePermission(requireLogin(principal), PERMISSIONS.CONVERSATION_READ, { organizationId: principal.organizationId, userId: principal.userId });
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      const agent = await ownedAgent(principal, runMatch[1]);
      return send(200, await synchronizeAgentRun(principal, agent, runMatch[2]));
    }

    const jobsMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/jobs(?:\/([^/]+))?(?:\/(pause|resume|run))?$/);
    if (jobsMatch) {
      requirePermission(requireLogin(principal), method === "GET" ? PERMISSIONS.AGENT_READ : PERMISSIONS.AGENT_MANAGE_OWN, { organizationId: principal.organizationId, userId: principal.userId });
      if (!runtimeClient) return send(503, { error: "runtime_unavailable" });
      const agent = await ownedAgent(principal, jobsMatch[1]);
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
      if (["jobs.create", "jobs.run"].includes(operation)) await requireOperationalAgent(principal, agent);
      if (operation) return send(method === "POST" ? 202 : 200, await runtimeClient.operation({ principal, agent, operation, input }));
      return false;
    }
    return false;
  };
}
