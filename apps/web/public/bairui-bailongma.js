(function () {
  const nativeFetch = window.fetch.bind(window);
  const NativeEventSource = window.EventSource;
  const state = { agents: [], activeAgent: null, activeSessionId: null, agentPromise: null };
  const compatibilityStreams = new Set();

  async function platformRequest(url, options) {
    const response = await nativeFetch(url, options);
    if (response.status === 401) {
      location.href = "/login";
      throw new Error("authentication_required");
    }
    return response;
  }

  function jsonResponse(value, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "x-bairui-ui-adapter": "1" } });
  }

  function readyDom() {
    if (document.readyState !== "loading") return Promise.resolve();
    return new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }

  async function initializeAgent(agent) {
    const response = await platformRequest(`/api/user/agents/${encodeURIComponent(agent.id)}/initialize`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "agent_initialization_failed");
    return result;
  }

  async function createAgentDialog() {
    await readyDom();
    return new Promise((resolve, reject) => {
      let createdAgent = null;
      const overlay = document.createElement("div");
      overlay.className = "bairui-onboarding";
      overlay.innerHTML = `<form class="bairui-onboarding-form">
        <img src="/assets/bairui-agent-logo.png" alt="">
        <h1>创建你的 Agent</h1>
        <label>名称<input name="name" maxlength="64" value="bairui-agent" required></label>
        <label>描述<textarea name="description" maxlength="500" rows="3"></textarea></label>
        <label>身份与原则<textarea name="soulMarkdown" maxlength="50000" rows="7" placeholder="# Identity"></textarea></label>
        <p class="bairui-onboarding-error" role="alert"></p>
        <button type="submit">创建 Agent</button>
      </form>`;
      document.body.appendChild(overlay);
      const form = overlay.querySelector("form");
      const error = overlay.querySelector(".bairui-onboarding-error");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submit = form.querySelector("button");
        submit.disabled = true;
        error.textContent = "";
        const data = new FormData(form);
        try {
          if (!createdAgent) {
            const response = await platformRequest("/api/user/agents", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name: data.get("name"), description: data.get("description"), soulMarkdown: data.get("soulMarkdown") })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "agent_create_failed");
            createdAgent = result.agent;
            for (const field of form.elements) if (field.name) field.disabled = true;
            submit.disabled = false;
            submit.textContent = "初始化 Agent";
          }
          const initialized = await initializeAgent(createdAgent);
          overlay.remove();
          resolve({ ...initialized.agent, runtime: initialized.runtime });
        } catch (cause) {
          error.textContent = cause.message === "model_provider_not_configured" ? "管理员尚未配置模型供应商" : cause.message === "no_agent_capacity" ? "暂无可用运行服务器，请稍后重试" : createdAgent ? "初始化失败，请稍后重试" : "创建失败，请稍后重试";
          submit.disabled = false;
          if (cause.message === "authentication_required") reject(cause);
        }
      });
    });
  }

  async function loadActiveAgent(force = false) {
    if (!force && state.activeAgent) return state.activeAgent;
    if (!force && state.agentPromise) return state.agentPromise;
    state.agentPromise = (async () => {
      const response = await platformRequest("/api/user/agents");
      if (!response.ok) throw new Error("agents_unavailable");
      state.agents = (await response.json()).agents || [];
      if (!state.agents.length) {
        const created = await createAgentDialog();
        state.agents = [created];
      }
      const saved = localStorage.getItem("bairui.activeAgentId");
      state.activeAgent = state.agents.find((agent) => agent.id === saved) || state.agents[0];
      localStorage.setItem("bairui.activeAgentId", state.activeAgent.id);
      state.activeSessionId = localStorage.getItem(`bairui.activeSessionId.${state.activeAgent.id}`);
      return state.activeAgent;
    })();
    try { return await state.agentPromise; } finally { state.agentPromise = null; }
  }

  async function listSessions(agent) {
    const response = await platformRequest(`/api/user/agents/${encodeURIComponent(agent.id)}/sessions?limit=100&include_children=true`);
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "sessions_unavailable");
    return (await response.json()).data || [];
  }

  async function ensureSession(agent) {
    const sessions = await listSessions(agent);
    let session = sessions.find((item) => item.id === state.activeSessionId) || sessions[0];
    if (!session) {
      const response = await platformRequest(`/api/user/agents/${encodeURIComponent(agent.id)}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "新会话" })
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "session_create_failed");
      session = (await response.json()).session;
    }
    state.activeSessionId = session.id;
    localStorage.setItem(`bairui.activeSessionId.${agent.id}`, session.id);
    return session;
  }

  function emitCompatibility(type, data = {}) {
    const payload = JSON.stringify({ type, data });
    for (const stream of compatibilityStreams) stream.emit(payload);
  }

  function mapHermesEvent(name, data) {
    if (name === "run.started") emitCompatibility("message_received", { input: data.user_message?.content || "" });
    else if (name === "message.started") emitCompatibility("stream_start", { mode: "text", plainReply: true });
    else if (name === "assistant.delta") emitCompatibility("stream_chunk", { mode: "text", text: data.delta || "" });
    else if (name === "tool.progress") emitCompatibility("stream_chunk", { mode: "reasoning", text: data.delta || "" });
    else if (name === "tool.started") emitCompatibility("tool_executing", { name: data.tool_name, args: data.args });
    else if (name === "tool.completed" || name === "tool.failed") emitCompatibility("tool_call", { name: data.tool_name, args: data.args, result: data.preview, ok: name === "tool.completed" });
    else if (name === "assistant.completed") {
      emitCompatibility("stream_end", { mode: "text" });
      emitCompatibility("message", { from: "consciousness", content: data.content || "", conversation_id: data.message_id, speak: false });
    } else if (name === "run.completed") emitCompatibility("response", { runId: data.run_id, usage: data.usage });
    else if (name === "error") emitCompatibility("error", { error: data.message || "Hermes Runtime 请求失败" });
  }

  async function consumeHermesSse(response) {
    if (!response.ok || !response.body) throw new Error((await response.json().catch(() => ({}))).error || "runtime_stream_failed");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replaceAll("\r\n", "\n");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        let name = "message";
        const dataLines = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) name = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        if (!dataLines.length) continue;
        try { mapHermesEvent(name, JSON.parse(dataLines.join("\n"))); } catch {}
      }
      if (done) break;
    }
  }

  async function sendMessage(options) {
    const body = JSON.parse(options?.body || "{}");
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) return jsonResponse({ error: "invalid_message" }, 400);
    const agent = await loadActiveAgent();
    const session = await ensureSession(agent);
    void (async () => {
      try {
        const response = await platformRequest(`/api/user/agents/${encodeURIComponent(agent.id)}/sessions/${encodeURIComponent(session.id)}/chat/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: content })
        });
        await consumeHermesSse(response);
      } catch (error) {
        emitCompatibility("error", { error: error.message || "Hermes Runtime 请求失败" });
      }
    })();
    return jsonResponse({ accepted: true, sessionId: session.id }, 202);
  }

  async function conversationHistory() {
    try {
      const agent = await loadActiveAgent();
      const session = await ensureSession(agent);
      const response = await platformRequest(`/api/user/agents/${encodeURIComponent(agent.id)}/sessions/${encodeURIComponent(session.id)}/messages`);
      if (!response.ok) return [];
      return ((await response.json()).data || []).filter((message) => ["user", "assistant"].includes(message.role)).map((message) => ({
        id: message.id,
        role: message.role === "assistant" ? "jarvis" : "user",
        content: message.content || "",
        channel: "API",
        from_id: message.role === "assistant" ? agent.id : "current-user",
        created_at: message.timestamp
      }));
    } catch { return []; }
  }

  class BairuiEventSource extends EventTarget {
    constructor(url, options) {
      super();
      const parsed = new URL(url, location.href);
      if (parsed.origin !== location.origin || parsed.pathname !== "/events") return new NativeEventSource(url, options);
      this.url = parsed.href;
      this.readyState = BairuiEventSource.CONNECTING;
      this.withCredentials = true;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      compatibilityStreams.add(this);
      queueMicrotask(async () => {
        try {
          await loadActiveAgent();
          if (this.readyState === BairuiEventSource.CLOSED) return;
          this.readyState = BairuiEventSource.OPEN;
          const event = new Event("open");
          this.dispatchEvent(event);
          this.onopen?.(event);
        } catch (error) {
          const event = new Event("error");
          this.dispatchEvent(event);
          this.onerror?.(event);
        }
      });
    }
    emit(data) {
      if (this.readyState !== BairuiEventSource.OPEN) return;
      const event = new MessageEvent("message", { data });
      this.dispatchEvent(event);
      this.onmessage?.(event);
    }
    close() {
      this.readyState = BairuiEventSource.CLOSED;
      compatibilityStreams.delete(this);
    }
  }
  BairuiEventSource.CONNECTING = 0;
  BairuiEventSource.OPEN = 1;
  BairuiEventSource.CLOSED = 2;
  window.EventSource = BairuiEventSource;

  window.fetch = async function bairuiFetch(input, options) {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
    if (url.origin !== location.origin) return nativeFetch(input, options);
    if (url.pathname === "/message" && (options?.method || "GET").toUpperCase() === "POST") return sendMessage(options);
    if (url.pathname === "/conversations") return jsonResponse(await conversationHistory());
    if (url.pathname === "/agent-profile") {
      const agent = await loadActiveAgent();
      return jsonResponse({ name: agent.name, agentId: agent.id, runtime: "Hermes", runtimeStatus: agent.runtime?.status || "uninitialized", ui: "BaiLongma Brain UI" });
    }
    return nativeFetch(input, options);
  };

  function iconButton(label, text) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.textContent = text;
    return button;
  }

  async function mountPlatformTools() {
    const [meResponse, agent] = await Promise.all([platformRequest("/api/me"), loadActiveAgent()]);
    if (!meResponse.ok) return;
    const { user } = await meResponse.json();
    const originalSettings = document.querySelector("#settings-btn");
    if (originalSettings) originalSettings.hidden = true;

    const tools = document.createElement("nav");
    tools.className = "bairui-platform-tools";
    tools.setAttribute("aria-label", "百瑞平台");
    const logo = document.createElement("img");
    logo.src = "/assets/bairui-agent-icon.png";
    logo.alt = "";
    const selector = document.createElement("select");
    selector.title = "切换 Agent";
    selector.setAttribute("aria-label", "切换 Agent");
    for (const item of state.agents) selector.add(new Option(item.name, item.id, false, item.id === agent.id));
    selector.addEventListener("change", () => {
      localStorage.setItem("bairui.activeAgentId", selector.value);
      location.reload();
    });
    const status = agent.initializationStatus === "uninitialized" || agent.initializationStatus === "failed" ? document.createElement("button") : document.createElement("span");
    status.className = `bairui-runtime-status status-${agent.runtime?.status || "uninitialized"}`;
    status.textContent = agent.runtime?.status || "未初始化";
    if (status instanceof HTMLButtonElement) {
      status.type = "button";
      status.title = "初始化 Agent";
      status.addEventListener("click", async () => {
        status.disabled = true;
        status.textContent = "初始化中";
        try { await initializeAgent(agent); location.reload(); }
        catch (error) { status.disabled = false; status.textContent = error.message === "model_provider_not_configured" ? "等待模型配置" : error.message === "no_agent_capacity" ? "等待服务器" : "重试初始化"; }
      });
    }
    const account = document.createElement("span");
    account.className = "bairui-account-label";
    account.textContent = user.displayName || user.email;
    tools.append(logo, selector, status, account);

    const addAgent = iconButton("创建 Agent", "+");
    addAgent.addEventListener("click", async () => {
      const created = await createAgentDialog();
      localStorage.setItem("bairui.activeAgentId", created.id);
      location.reload();
    });
    tools.appendChild(addAgent);
    if (["org_admin", "platform_admin"].includes(user.role)) {
      const admin = document.createElement("a");
      admin.href = "/admin";
      admin.title = "总控后台";
      admin.setAttribute("aria-label", "总控后台");
      admin.textContent = "⚙";
      tools.appendChild(admin);
    }
    const logout = iconButton("退出登录", "↪");
    logout.addEventListener("click", async () => {
      await platformRequest("/api/auth/logout", { method: "POST" });
      location.href = "/login";
    });
    tools.appendChild(logout);
    document.body.appendChild(tools);
  }

  window.addEventListener("DOMContentLoaded", () => mountPlatformTools().catch(() => {}), { once: true });
})();
