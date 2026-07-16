(function () {
  const nativeFetch = window.fetch.bind(window);
  const NativeEventSource = window.EventSource;
  const state = {
    agents: [],
    activeAgent: null,
    activeSessionId: null,
    agentPromise: null,
    activeAbortController: null,
    lastMessage: null,
    user: null
  };
  const compatibilityStreams = new Set();

  async function platformRequest(url, options) {
    const response = await nativeFetch(url, options);
    if (response.status === 401) {
      location.href = "/login";
      throw new Error("authentication_required");
    }
    return response;
  }

  async function requestJson(url, options) {
    const response = await platformRequest(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || body.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function jsonResponse(value, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "x-bairui-ui-adapter": "1" } });
  }

  function readyDom() {
    if (document.readyState !== "loading") return Promise.resolve();
    return new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function initializeAgent(agent) {
    return requestJson(`/api/user/agents/${encodeURIComponent(agent.id)}/initialize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
  }

  async function getAgent(agentId) {
    return (await requestJson(`/api/user/agents/${encodeURIComponent(agentId)}`)).agent;
  }

  async function waitForAgentReady(agentId, onUpdate, maxWaitMs = 5 * 60_000, signal) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxWaitMs) {
      if (signal?.aborted) throw new DOMException("Initialization polling stopped", "AbortError");
      const agent = await getAgent(agentId);
      onUpdate?.(agent);
      if (agent.initializationStatus === "ready" && agent.runtime?.status === "ready" && ["ready", "degraded"].includes(agent.operational?.code ?? "ready")) return agent;
      if (agent.initializationStatus === "ready" && ["model_unconfigured", "quota_exhausted", "offline"].includes(agent.operational?.code)) throw new Error(agent.operational.code);
      if (agent.initializationStatus === "failed" || agent.runtime?.status === "failed") {
        const error = new Error(agent.lastErrorCode || agent.runtime?.lastErrorCode || "agent_initialization_failed");
        error.agent = agent;
        throw error;
      }
      await sleep(2000);
    }
    throw new Error("agent_initialization_timeout");
  }

  function initializationLabel(agent) {
    const status = agent?.operational?.code || agent?.runtime?.effectiveStatus || agent?.runtime?.status || agent?.initializationStatus || "uninitialized";
    const labels = {
      uninitialized: "等待初始化",
      initializing: "正在初始化",
      provisioning: "正在创建运行环境",
      starting: "正在启动 Hermes",
      ready: "Agent 已就绪",
      degraded: "运行环境降级",
      offline: "Runtime 离线",
      model_unconfigured: "等待模型配置",
      quota_exhausted: "额度已用尽",
      upgrading: "正在应用更新",
      failed: "初始化失败",
      suspended: "Agent 已暂停",
      stopped: "Agent 已停止",
      deleting: "正在删除",
      deleted: "已删除"
    };
    return labels[status] || status;
  }

  function operationalCode(agent) {
    return agent?.operational?.code || agent?.runtime?.effectiveStatus || agent?.runtime?.status || agent?.initializationStatus || "uninitialized";
  }

  function operationalFailure(agent) {
    const code = operationalCode(agent);
    if (["ready", "degraded"].includes(code)) return null;
    if (code === "quota_exhausted") return { code, error: "quota_exhausted", status: 429 };
    if (code === "offline") return { code, error: "runtime_offline", status: 503 };
    if (code === "model_unconfigured") return { code, error: "model_not_configured", status: 409 };
    return { code, error: "agent_not_ready", status: 409 };
  }

  function operationalCopy(agent) {
    const code = operationalCode(agent);
    const copies = {
      uninitialized: ["Agent 尚未初始化", "完成初始化并等待 Runtime 与 Hermes 健康检查通过后即可开始对话。"],
      initializing: ["Agent 正在初始化", "运行环境正在创建和验证，状态就绪后页面会自动刷新。"],
      upgrading: ["Agent 正在升级", "配置或版本正在应用，完成健康验证前暂时停止新任务。"],
      offline: ["Runtime 当前离线", "最近没有收到运行环境心跳。历史数据仍可在工作区查看。"],
      model_unconfigured: ["模型尚未配置", "管理员需要完成模型渠道配置和应用验证。"],
      quota_exhausted: ["当前额度已用尽", "可在工作区查看 Token 和预算用量，等待额度恢复或管理员调整策略。"],
      failed: ["Agent 初始化失败", "可以重新提交初始化，失败原因会保留在 Agent 状态中。"],
      suspended: ["Agent 已暂停", "可在工作区恢复 Agent。"],
      stopped: ["Agent 已停止", "可在工作区重新启动 Agent。"],
      deleting: ["Agent 正在删除", "删除完成前不能创建新的会话或任务。"],
      deleted: ["Agent 已删除", "请选择或创建另一个 Agent。"]
    };
    return copies[code] || [initializationLabel(agent), "当前运行状态不允许创建新的会话或任务。"];
  }

  async function createAgentDialog() {
    await readyDom();
    const bootstrap = await requestJson("/api/user/bootstrap");
    const modelOptions = (bootstrap.models?.allowedModels ?? []).map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join("");
    const authorizationOptions = (bootstrap.authorizationServices ?? []).filter((item) => item.enabled).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} - ${escapeHtml(item.purpose)}</option>`).join("");
    return new Promise((resolve, reject) => {
      let createdAgent = null;
      let authorizationStored = false;
      const overlay = document.createElement("div");
      overlay.className = "bairui-onboarding";
      overlay.innerHTML = `<form class="bairui-onboarding-form">
        <img src="/assets/bairui-agent-logo.png" alt="">
        <h1>创建你的 Agent</h1>
        <label>名称<input name="name" maxlength="64" value="bairui-agent" required></label>
        <label>头像 URL<input name="avatarUrl" type="url" maxlength="2000" placeholder="https://example.com/avatar.png"></label>
        <label>描述<textarea name="description" maxlength="500" rows="3" placeholder="这个 Agent 主要帮你做什么"></textarea></label>
        <label>身份与原则<textarea name="soulMarkdown" maxlength="50000" rows="7" placeholder="# Identity\n\n说明 Agent 的身份、语气和工作原则"></textarea></label>
        <label>模型<select name="preferredModel"><option value="">管理员默认模型</option>${modelOptions}</select></label>
        ${authorizationOptions ? `<fieldset><legend>第三方授权（可选）</legend><label>服务<select name="authorizationService"><option value="">暂不配置</option>${authorizationOptions}</select></label><label>授权名称<input name="authorizationLabel" maxlength="100" value="首次初始化"></label><label>HTTPS 接口地址<input name="authorizationEndpoint" type="url" maxlength="2000"></label><label>Provider<input name="authorizationProvider" maxlength="200"></label><label>模型<input name="authorizationModel" maxlength="200"></label><label>密钥或 Token<input name="authorizationSecret" type="password" maxlength="64000" autocomplete="new-password"></label></fieldset>` : ""}
        <div class="bairui-onboarding-progress" hidden><span></span><strong></strong></div>
        <p class="bairui-onboarding-error" role="alert"></p>
        <div class="bairui-onboarding-actions"><button type="button" data-later hidden>稍后查看</button><button type="submit">创建并初始化</button></div>
      </form>`;
      document.body.appendChild(overlay);
      const form = overlay.querySelector("form");
      const error = overlay.querySelector(".bairui-onboarding-error");
      const progress = overlay.querySelector(".bairui-onboarding-progress");
      const later = overlay.querySelector("[data-later]");
      const polling = new AbortController();
      later.addEventListener("click", () => {
        polling.abort();
        overlay.remove();
        resolve(createdAgent);
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        error.textContent = "";
        const data = new FormData(form);
        try {
          if (!createdAgent) {
            const result = await requestJson("/api/user/agents", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name: data.get("name"), avatarUrl: data.get("avatarUrl"), description: data.get("description"), soulMarkdown: data.get("soulMarkdown"), preferredModel: data.get("preferredModel") })
            });
            createdAgent = result.agent;
          }
          if (!authorizationStored) {
            const authorizationSecret = String(data.get("authorizationSecret") || "").trim();
            const authorizationService = String(data.get("authorizationService") || "").trim();
            if (authorizationSecret && authorizationService) {
              await requestJson(`/api/user/agents/${encodeURIComponent(createdAgent.id)}/authorizations`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ service: authorizationService, label: data.get("authorizationLabel") || "首次初始化", authType: "api_key", endpointUrl: data.get("authorizationEndpoint"), secret: authorizationSecret, metadata: { provider: data.get("authorizationProvider"), model: data.get("authorizationModel") } })
              });
            }
            authorizationStored = true;
            for (const field of form.elements) if (field.name) field.disabled = true;
          }
          progress.hidden = false;
          progress.querySelector("strong").textContent = "提交初始化请求";
          await initializeAgent(createdAgent);
          later.hidden = false;
          const ready = await waitForAgentReady(createdAgent.id, (agent) => {
            progress.querySelector("strong").textContent = initializationLabel(agent);
          }, 5 * 60_000, polling.signal);
          overlay.remove();
          resolve(ready);
        } catch (cause) {
          const labels = {
            model_provider_not_configured: "管理员尚未配置模型供应商",
            no_agent_capacity: "暂无可用运行服务器，请稍后重试",
            model_unconfigured: "管理员尚未配置可用模型",
            quota_exhausted: "当前组织额度已用尽",
            offline: "Runtime 已离线，正在等待服务器恢复",
            agent_initialization_timeout: "初始化仍在后台进行，请稍后从 Agent 页面查看"
          };
          if (cause.name === "AbortError") return;
          error.textContent = labels[cause.message] || `初始化失败：${cause.message}`;
          submit.disabled = false;
          submit.textContent = createdAgent ? "重试初始化" : "创建并初始化";
          if (cause.message === "authentication_required") reject(cause);
        }
      });
    });
  }

  async function loadActiveAgent(force = false) {
    if (!force && state.activeAgent) return state.activeAgent;
    if (!force && state.agentPromise) return state.agentPromise;
    state.agentPromise = (async () => {
      const result = await requestJson("/api/user/agents");
      state.agents = result.agents || [];
      if (!state.agents.length) state.agents = [await createAgentDialog()];
      const saved = localStorage.getItem("bairui.activeAgentId");
      state.activeAgent = state.agents.find((agent) => agent.id === saved) || state.agents[0];
      localStorage.setItem("bairui.activeAgentId", state.activeAgent.id);
      state.activeSessionId = localStorage.getItem(`bairui.activeSessionId.${state.activeAgent.id}`);
      return state.activeAgent;
    })();
    try { return await state.agentPromise; } finally { state.agentPromise = null; }
  }

  async function listSessions(agent) {
    agent ??= await loadActiveAgent();
    if (operationalFailure(agent)) return [];
    const result = await requestJson(`/api/user/agents/${encodeURIComponent(agent.id)}/sessions?limit=100&include_children=true`);
    return result.data || [];
  }

  async function createSession(title = "新会话", agent) {
    agent ??= await loadActiveAgent();
    const result = await requestJson(`/api/user/agents/${encodeURIComponent(agent.id)}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title })
    });
    const session = result.session;
    state.activeSessionId = session.id;
    localStorage.setItem(`bairui.activeSessionId.${agent.id}`, session.id);
    return session;
  }

  async function ensureSession(agent) {
    agent ??= await loadActiveAgent();
    const failure = operationalFailure(agent);
    if (failure) throw Object.assign(new Error(failure.error), failure);
    const sessions = await listSessions(agent);
    let session = sessions.find((item) => item.id === state.activeSessionId) || sessions[0];
    if (!session) session = await createSession("新会话", agent);
    state.activeSessionId = session.id;
    localStorage.setItem(`bairui.activeSessionId.${agent.id}`, session.id);
    return session;
  }

  function activateSession(sessionId) {
    if (!state.activeAgent) return;
    state.activeSessionId = sessionId;
    localStorage.setItem(`bairui.activeSessionId.${state.activeAgent.id}`, sessionId);
    location.reload();
  }

  function activateAgent(agentId) {
    localStorage.setItem("bairui.activeAgentId", agentId);
    location.reload();
  }

  function emitCompatibility(type, data = {}) {
    const payload = JSON.stringify({ type, data });
    for (const stream of compatibilityStreams) stream.emit(payload);
  }

  function contentText(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((part) => part?.type === "text" ? part.text || "" : part?.type === "image_url" ? `![图片](${part.image_url?.url || ""})` : "").filter(Boolean).join("\n\n");
  }

  function setStreaming(active) {
    document.body.classList.toggle("bairui-streaming", active);
    const send = document.querySelector("#send-btn");
    if (send) {
      send.textContent = active ? "停止" : "发送";
      send.title = active ? "停止生成" : "发送消息";
    }
    window.dispatchEvent(new CustomEvent("bairui:stream-state", { detail: { active } }));
  }

  function mapHermesEvent(name, data) {
    if (name === "run.started") emitCompatibility("message_received", { input: contentText(data.user_message?.content) });
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

  async function stopActiveStream() {
    if (!state.activeAbortController) return false;
    state.activeAbortController.abort();
    state.activeAbortController = null;
    emitCompatibility("stream_end", { mode: "text", interrupted: true });
    setStreaming(false);
    return true;
  }

  async function sendMessage(options) {
    const body = JSON.parse(options?.body || "{}");
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (!content && !attachments.length) return jsonResponse({ error: "invalid_message" }, 400);
    if (state.activeAbortController) return jsonResponse({ error: "run_in_progress" }, 409);
    const agent = await loadActiveAgent();
    const failure = operationalFailure(agent);
    if (failure) return jsonResponse({ error: failure.error, operational: failure.code }, failure.status);
    const session = await ensureSession(agent);
    state.lastMessage = { content, attachments };
    const controller = new AbortController();
    state.activeAbortController = controller;
    setStreaming(true);
    void (async () => {
      try {
        const response = await platformRequest(`/api/user/agents/${encodeURIComponent(agent.id)}/sessions/${encodeURIComponent(session.id)}/chat/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: content, attachments }),
          signal: controller.signal
        });
        await consumeHermesSse(response);
      } catch (error) {
        if (error.name !== "AbortError") emitCompatibility("error", { error: error.message || "Hermes Runtime 请求失败" });
      } finally {
        if (state.activeAbortController === controller) state.activeAbortController = null;
        setStreaming(false);
      }
    })();
    return jsonResponse({ accepted: true, sessionId: session.id }, 202);
  }

  async function conversationHistory() {
    try {
      const agent = await loadActiveAgent();
      const session = await ensureSession(agent);
      const result = await requestJson(`/api/user/agents/${encodeURIComponent(agent.id)}/sessions/${encodeURIComponent(session.id)}/messages`);
      return (result.data || []).filter((message) => ["user", "assistant"].includes(message.role)).map((message) => ({
        id: message.id,
        role: message.role === "assistant" ? "jarvis" : "user",
        content: contentText(message.content),
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
        } catch {
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
    if (url.pathname === "/memories") {
      const agent = await loadActiveAgent();
      url.searchParams.set("agent_id", agent.id);
      return nativeFetch(url, options);
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

  function characterCardPayload(file) {
    if (!file || file.size < 1 || file.size > 8 * 1024 * 1024) throw new Error("角色卡文件必须小于 8 MB");
    const png = file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
    if (!png && file.type !== "application/json" && !file.name.toLowerCase().endsWith(".json")) throw new Error("仅支持 SillyTavern JSON 或 PNG 角色卡");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("error", () => reject(new Error("无法读取角色卡文件")), { once: true });
      reader.addEventListener("load", () => resolve({ format: png ? "png" : "json", content: String(reader.result) }), { once: true });
      if (png) reader.readAsDataURL(file); else reader.readAsText(file, "utf-8");
    });
  }

  function cardNotice(message, tone = "info") {
    const notice = document.createElement("div");
    notice.className = `bairui-card-notice tone-${tone}`;
    notice.setAttribute("role", "status");
    notice.textContent = message;
    document.body.appendChild(notice);
    requestAnimationFrame(() => notice.classList.add("visible"));
    setTimeout(() => { notice.classList.remove("visible"); setTimeout(() => notice.remove(), 180); }, 3600);
  }

  async function showCharacterCardImport(agent, card, filename) {
    const endpoint = `/api/user/agents/${encodeURIComponent(agent.id)}/character-card`;
    const preview = await requestJson(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ card, previewOnly: true }) });
    const dialog = document.createElement("dialog");
    dialog.className = "bairui-card-dialog";
    dialog.innerHTML = `<form method="dialog">
      <header><div><span>角色卡预检</span><strong>${escapeHtml(preview.card.name)}</strong></div><button type="button" data-close title="关闭" aria-label="关闭">×</button></header>
      <div class="bairui-card-body">
        <dl><div><dt>文件</dt><dd>${escapeHtml(filename)}</dd></div><div><dt>规范</dt><dd>${escapeHtml(preview.card.spec)} ${escapeHtml(preview.card.specVersion)}</dd></div><div><dt>Hermes 身份</dt><dd>${preview.card.soulChars.toLocaleString()} 字符</dd></div><div><dt>Obsidian 资料</dt><dd>${preview.card.loreNotes + 1} 条</dd></div></dl>
        <section><strong>导入边界</strong><p>身份、性格、场景和系统指引将更新 Hermes 的 SOUL.md。开场白、示例对话和 Lorebook 仅保存为 Obsidian 来源资料，不会伪装成 Hermes 原生记忆。</p></section>
        <label class="bairui-card-confirm"><input type="checkbox" required><span>我确认该角色卡来自可信来源，并允许其中的提示词改变当前 Agent 身份。扩展脚本和执行配置不会导入。</span></label>
        <p class="bairui-card-error" role="alert"></p>
      </div>
      <footer><button type="button" data-cancel>取消</button><button type="submit" class="primary" disabled>导入角色卡</button></footer>
    </form>`;
    document.body.appendChild(dialog);
    const form = dialog.querySelector("form");
    const confirmation = dialog.querySelector('input[type="checkbox"]');
    const submit = dialog.querySelector('button[type="submit"]');
    const error = dialog.querySelector(".bairui-card-error");
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.querySelector("[data-close]").addEventListener("click", close);
    dialog.querySelector("[data-cancel]").addEventListener("click", close);
    confirmation.addEventListener("change", () => { submit.disabled = !confirmation.checked; });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!confirmation.checked) return;
      submit.disabled = true;
      submit.textContent = "正在导入";
      error.textContent = "";
      try {
        const result = await requestJson(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ card, confirmUntrustedPrompts: true }) });
        const index = state.agents.findIndex((item) => item.id === agent.id);
        if (index >= 0) state.agents[index] = { ...state.agents[index], ...result.agent };
        state.activeAgent = { ...state.activeAgent, ...result.agent };
        close();
        cardNotice(result.application.state === "queued" ? "角色卡已导入，Hermes 正在应用新身份" : "角色卡已导入，将在 Agent 初始化时应用", "success");
        setTimeout(() => location.reload(), 900);
      } catch (cause) {
        const labels = { invalid_character_card: "无法解析该角色卡", character_card_metadata_missing: "PNG 中没有角色卡元数据", character_card_confirmation_required: "请先确认导入风险" };
        error.textContent = labels[cause.message] || cause.message;
        submit.disabled = false;
        submit.textContent = "导入角色卡";
      }
    });
    dialog.showModal();
  }

  function chooseCharacterCard(agent) {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".json,.png,application/json,image/png";
    picker.hidden = true;
    document.body.appendChild(picker);
    picker.addEventListener("change", async () => {
      const file = picker.files?.[0];
      picker.remove();
      if (!file) return;
      try { await showCharacterCardImport(agent, await characterCardPayload(file), file.name); }
      catch (error) { cardNotice(error.message || "角色卡预检失败", "error"); }
    }, { once: true });
    picker.click();
  }

  function mountHermesChatSurface(agent) {
    const chatArea = document.querySelector("#chat-area");
    const inputRow = document.querySelector("#input-row");
    const messageInput = document.querySelector("#msg-input");
    if (!chatArea || !inputRow || !messageInput || chatArea.querySelector(".bairui-chat-header")) return;

    const applyViewportLayout = () => {
      const mobile = window.matchMedia("(max-width: 900px)").matches;
      const top = mobile ? 62 : 72;
      const bottom = mobile ? 10 : 18;
      const zoom = Number.parseFloat(document.documentElement.style.zoom) || Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const height = Math.max(320, window.innerHeight - top - bottom);
      Object.assign(chatArea.style, {
        position: "fixed",
        top: `${top / zoom}px`,
        bottom: "auto",
        height: `${height / zoom}px`,
        maxHeight: `${height / zoom}px`,
        boxSizing: "border-box",
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr) auto auto",
        overflow: "hidden"
      });
    };
    applyViewportLayout();
    window.addEventListener("resize", applyViewportLayout, { passive: true });
    window.addEventListener("bairui:chat-layout", applyViewportLayout);

    const header = document.createElement("header");
    header.className = "bairui-chat-header";
    const identity = document.createElement("div");
    identity.className = "bairui-chat-identity";
    const icon = document.createElement("img");
    icon.src = "/assets/bairui-agent-icon.png";
    icon.alt = "";
    const name = document.createElement("strong");
    name.textContent = agent.name;
    const runtime = document.createElement("span");
    runtime.textContent = `Hermes · ${initializationLabel(agent)}`;
    identity.append(icon, name, runtime);
    const live = document.createElement("span");
    live.className = "bairui-chat-live";
    live.textContent = "Session";
    header.append(identity, live);
    chatArea.prepend(header);

    const history = chatArea.querySelector("#chat-history");
    const messages = chatArea.querySelector("#chat-messages");
    const attachments = chatArea.querySelector("#paste-attachments");
    if (history) Object.assign(history.style, { gridRow: "2", width: "100%", height: "100%", minHeight: "0", maxHeight: "none", overflow: "hidden" });
    if (messages) Object.assign(messages.style, { width: "100%", height: "100%", minHeight: "0", maxHeight: "none", overflowY: "auto" });
    if (attachments) attachments.style.gridRow = "3";
    inputRow.style.gridRow = "4";

    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/png,image/jpeg,image/webp,image/gif";
    picker.multiple = true;
    picker.hidden = true;
    picker.setAttribute("aria-hidden", "true");
    const attach = iconButton("添加图片", "+");
    attach.className = "bairui-attach-button";
    attach.dataset.action = "attach-image";
    attach.addEventListener("click", () => picker.click());
    picker.addEventListener("change", () => {
      if (!picker.files?.length) return;
      const transfer = new DataTransfer();
      for (const file of picker.files) if (file.type.startsWith("image/")) transfer.items.add(file);
      if (transfer.files.length) messageInput.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
      picker.value = "";
      messageInput.focus();
    });
    inputRow.insertBefore(attach, inputRow.firstChild);
    inputRow.appendChild(picker);
  }

  function prefillChat(text) {
    const input = document.querySelector("#msg-input");
    if (!input) return;
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  function mountPanelControls() {
    const left = document.querySelector("#panel-l1-tab");
    const right = document.querySelector("#panel-l2-tab");
    if (!left || !right || document.querySelector(".bairui-panel-scrim")) return;
    const scrim = document.createElement("button");
    scrim.type = "button";
    scrim.className = "bairui-panel-scrim";
    scrim.title = "关闭侧栏";
    scrim.setAttribute("aria-label", "关闭侧栏");
    document.body.appendChild(scrim);

    const mobile = () => window.matchMedia("(max-width: 780px)").matches;
    let mobileMode = mobile();
    let desktopState = { left: document.body.classList.contains("l1-collapsed"), right: document.body.classList.contains("l2-collapsed") };
    const closeMobilePanels = () => {
      if (mobile()) document.body.classList.add("l1-collapsed", "l2-collapsed");
    };
    const sync = () => {
      const leftOpen = !document.body.classList.contains("l1-collapsed");
      const rightOpen = !document.body.classList.contains("l2-collapsed");
      left.setAttribute("aria-expanded", String(leftOpen));
      right.setAttribute("aria-expanded", String(rightOpen));
      left.title = `${leftOpen ? "收起" : "展开"}左侧认知面板`;
      right.title = `${rightOpen ? "收起" : "展开"}右侧运行面板`;
    };
    closeMobilePanels();
    sync();

    left.addEventListener("click", () => {
      if (mobile() && document.body.classList.contains("l1-collapsed")) {
        document.body.classList.add("l2-collapsed");
        try { localStorage.setItem("bailongma-panel-l2-collapsed", "1"); } catch {}
      }
      queueMicrotask(sync);
    }, true);
    right.addEventListener("click", () => {
      if (mobile() && document.body.classList.contains("l2-collapsed")) {
        document.body.classList.add("l1-collapsed");
        try { localStorage.setItem("bailongma-panel-l1-collapsed", "1"); } catch {}
      }
      queueMicrotask(sync);
    }, true);
    scrim.addEventListener("click", () => {
      if (!document.body.classList.contains("l1-collapsed")) left.click();
      if (!document.body.classList.contains("l2-collapsed")) right.click();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && mobile()) scrim.click();
    });
    window.addEventListener("resize", () => {
      const nextMobile = mobile();
      if (nextMobile && !mobileMode) {
        desktopState = { left: document.body.classList.contains("l1-collapsed"), right: document.body.classList.contains("l2-collapsed") };
        closeMobilePanels();
      } else if (!nextMobile && mobileMode) {
        document.body.classList.toggle("l1-collapsed", desktopState.left);
        document.body.classList.toggle("l2-collapsed", desktopState.right);
      }
      mobileMode = nextMobile;
      sync();
    }, { passive: true });
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  function mountOperationalSurface(agent) {
    document.querySelector(".bairui-operational-blocker")?.remove();
    const failure = operationalFailure(agent);
    document.body.classList.toggle("bairui-operational-blocked", Boolean(failure));
    if (!failure) return;
    const [title, detail] = operationalCopy(agent);
    const blocker = document.createElement("div");
    blocker.className = `bairui-operational-blocker status-${failure.code}`;
    blocker.innerHTML = `<section><img src="/assets/bairui-agent-icon.png" alt=""><span>${escapeHtml(agent.name)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p><div class="bairui-operational-actions"></div></section>`;
    const actions = blocker.querySelector(".bairui-operational-actions");
    if (["uninitialized", "failed"].includes(failure.code)) {
      const initialize = document.createElement("button");
      initialize.type = "button";
      initialize.className = "primary";
      initialize.textContent = failure.code === "failed" ? "重试初始化" : "初始化 Agent";
      initialize.addEventListener("click", async () => {
        initialize.disabled = true;
        initialize.textContent = "正在提交";
        try {
          await initializeAgent(agent);
          await waitForAgentReady(agent.id, (current) => {
            blocker.querySelector("h1").textContent = initializationLabel(current);
          });
          location.reload();
        } catch (error) {
          initialize.disabled = false;
          initialize.textContent = error.message === "model_provider_not_configured" ? "等待管理员配置模型" : "重试初始化";
        }
      });
      actions.appendChild(initialize);
    }
    if (failure.code === "deleted") {
      const create = document.createElement("button");
      create.type = "button";
      create.className = "primary";
      create.textContent = "创建 Agent";
      create.addEventListener("click", async () => activateAgent((await createAgentDialog()).id));
      actions.appendChild(create);
    }
    const workspace = document.createElement("button");
    workspace.type = "button";
    workspace.textContent = "打开工作区";
    workspace.addEventListener("click", () => window.dispatchEvent(new CustomEvent("bairui:workspace-open")));
    actions.appendChild(workspace);
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.textContent = "刷新状态";
    refresh.addEventListener("click", () => location.reload());
    actions.appendChild(refresh);
    document.body.appendChild(blocker);
    if (["initializing", "upgrading", "deleting"].includes(failure.code)) {
      const poll = async () => {
        if (!document.body.contains(blocker)) return;
        try {
          if (operationalCode(await getAgent(agent.id)) !== failure.code) return location.reload();
        } catch {}
        setTimeout(poll, 3000);
      };
      setTimeout(poll, 3000);
    }
  }

  async function mountPlatformTools() {
    const [me, agent] = await Promise.all([requestJson("/api/me"), loadActiveAgent()]);
    state.user = me.user;
    const originalSettings = document.querySelector("#settings-btn");
    if (originalSettings) originalSettings.hidden = true;

    const tools = document.createElement("nav");
    tools.className = "bairui-platform-tools";
    tools.setAttribute("aria-label", "百瑞工作区");
    const logo = document.createElement("img");
    logo.src = "/assets/bairui-agent-icon.png";
    logo.alt = "";
    const selector = document.createElement("select");
    selector.title = "切换 Agent";
    selector.setAttribute("aria-label", "切换 Agent");
    for (const item of state.agents) selector.add(new Option(item.name, item.id, false, item.id === agent.id));
    selector.addEventListener("change", () => activateAgent(selector.value));
    const code = operationalCode(agent);
    const status = ["uninitialized", "failed"].includes(code) ? document.createElement("button") : document.createElement("span");
    status.className = `bairui-runtime-status status-${code || "uninitialized"}`;
    status.textContent = initializationLabel(agent);
    if (status instanceof HTMLButtonElement) {
      status.type = "button";
      status.title = "初始化 Agent";
      status.addEventListener("click", async () => {
        status.disabled = true;
        status.textContent = "提交初始化请求";
        try {
          await initializeAgent(agent);
          await waitForAgentReady(agent.id, (current) => { status.textContent = initializationLabel(current); });
          location.reload();
        } catch (error) {
          status.disabled = false;
          status.textContent = error.message === "model_provider_not_configured" ? "等待模型配置" : error.message === "no_agent_capacity" ? "等待服务器" : "重试初始化";
        }
      });
    }
    const account = document.createElement("span");
    account.className = "bairui-account-label";
    account.textContent = state.user.displayName || state.user.email;
    tools.append(logo, selector, status, account);

    const workspace = iconButton("打开工作区", "☰");
    workspace.dataset.action = "workspace";
    workspace.addEventListener("click", () => window.dispatchEvent(new CustomEvent("bairui:workspace-open")));
    tools.appendChild(workspace);
    const addAgent = iconButton("创建 Agent", "+");
    addAgent.addEventListener("click", async () => {
      const created = await createAgentDialog();
      activateAgent(created.id);
    });
    tools.appendChild(addAgent);
    const importCard = iconButton("导入 SillyTavern 角色卡", "⇧");
    importCard.dataset.action = "import-character-card";
    importCard.addEventListener("click", () => chooseCharacterCard(state.activeAgent));
    tools.appendChild(importCard);
    if (["org_admin", "platform_admin"].includes(state.user.role)) {
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
    Object.assign(tools.style, { position: "fixed", zIndex: "2147483000", pointerEvents: "auto" });
    document.body.appendChild(tools);
    mountPanelControls();
    mountHermesChatSurface(agent);
    mountOperationalSurface(agent);

    document.querySelector("#send-btn")?.addEventListener("click", (event) => {
      if (!state.activeAbortController) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      stopActiveStream();
    }, true);
  }

  window.bairuiPlatform = Object.freeze({
    state,
    request: requestJson,
    loadActiveAgent,
    listSessions,
    createSession,
    activateSession,
    activateAgent,
    initializeAgent,
    waitForAgentReady,
    createAgentDialog,
    stopActiveStream,
    prefillChat,
    initializationLabel,
    operationalCode,
    operationalFailure
  });

  window.addEventListener("DOMContentLoaded", () => mountPlatformTools().catch((error) => console.warn("[bairui]", error.message)), { once: true });
})();
