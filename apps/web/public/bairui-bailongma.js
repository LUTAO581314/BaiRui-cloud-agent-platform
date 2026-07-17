(function () {
  const nativeFetch = window.fetch.bind(window);
  const state = {
    agents: [],
    activeAgent: null,
    activeSessionId: null,
    agentPromise: null,
    activeAbortController: null,
    activeRunId: null,
    stopRequested: false,
    stopPromise: null,
    approvalDialog: null,
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

  async function submitAgentInitialization(agent, configuration = {}) {
    return requestJson(`/api/user/agents/${encodeURIComponent(agent.id)}/initialize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(configuration)
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
      model_unconfigured: ["模型尚未配置", "请为当前 Agent 配置 Hermes 模型密钥，或使用平台提供的模型。"],
      quota_exhausted: ["当前额度已用尽", "可在工作区查看 Token 和预算用量，等待额度恢复或管理员调整策略。"],
      failed: ["Agent 初始化失败", "可以重新提交初始化，失败原因会保留在 Agent 状态中。"],
      suspended: ["Agent 已暂停", "可在工作区恢复 Agent。"],
      stopped: ["Agent 已停止", "可在工作区重新启动 Agent。"],
      deleting: ["Agent 正在删除", "删除完成前不能创建新的会话或任务。"],
      deleted: ["Agent 已删除", "请选择或创建另一个 Agent。"]
    };
    return copies[code] || [initializationLabel(agent), "当前运行状态不允许创建新的会话或任务。"];
  }

  const HERMES_PROVIDER_PRESETS = Object.freeze({
    custom: { label: "OpenAI 兼容接口", baseUrl: "" },
    openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
    openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" }
  });

  function modelAuthorization(authorizations) {
    return (authorizations || []).find((item) => item.service === "model-provider" && item.status === "stored" && item.configured) || null;
  }

  function hermesProviderFields({ bootstrap, authorization }) {
    const personalEnabled = bootstrap.models?.userCustomKeysAllowed !== false;
    const platformEnabled = bootstrap.models?.configured === true;
    const defaultMode = personalEnabled ? "agent" : "platform";
    const provider = authorization?.metadata?.provider || "custom";
    const baseUrl = authorization?.endpointUrl || HERMES_PROVIDER_PRESETS[provider]?.baseUrl || "";
    const model = authorization?.metadata?.model || bootstrap.models?.defaultModel || "";
    const modeOptions = [
      personalEnabled ? `<label><input type="radio" name="modelMode" value="agent" ${defaultMode === "agent" ? "checked" : ""}>私有密钥</label>` : "",
      platformEnabled ? `<label><input type="radio" name="modelMode" value="platform" ${defaultMode === "platform" ? "checked" : ""}>平台模型</label>` : ""
    ].join("");
    return `<fieldset class="bairui-hermes-provider"><legend>Hermes 模型</legend>
      <div class="bairui-provider-mode">${modeOptions}</div>
      <div data-agent-provider>
        <label>Provider<select name="hermesProvider">${Object.entries(HERMES_PROVIDER_PRESETS).map(([id, item]) => `<option value="${id}" ${provider === id ? "selected" : ""}>${item.label}</option>`).join("")}</select></label>
        <label>Base URL<input name="hermesBaseUrl" type="url" maxlength="2000" value="${escapeHtml(baseUrl)}" placeholder="https://api.example.com/v1"></label>
        <label>模型 ID<input name="hermesModel" maxlength="200" value="${escapeHtml(model)}" placeholder="gpt-5.5"></label>
        <label>认证类型<select name="hermesAuthType"><option value="api_key" ${authorization?.authType !== "bearer_token" ? "selected" : ""}>API Key</option><option value="bearer_token" ${authorization?.authType === "bearer_token" ? "selected" : ""}>Bearer Token</option></select></label>
        <label>API Key / Token<input name="hermesApiKey" type="password" maxlength="64000" autocomplete="new-password" placeholder="${authorization?.credentialMasked ? `已保存 ${escapeHtml(authorization.credentialMasked)}，留空继续使用` : "输入模型接口密钥"}"></label>
      </div>
    </fieldset>`;
  }

  function bindHermesProviderFields(form, authorization) {
    const provider = form.elements.hermesProvider;
    const baseUrl = form.elements.hermesBaseUrl;
    const apiKey = form.elements.hermesApiKey;
    const updateMode = () => {
      const personal = form.elements.modelMode?.value === "agent";
      const fields = form.querySelector("[data-agent-provider]");
      if (fields) fields.hidden = !personal;
      for (const name of ["hermesProvider", "hermesBaseUrl", "hermesModel", "hermesAuthType", "hermesApiKey"]) if (form.elements[name]) form.elements[name].disabled = !personal;
      if (baseUrl) baseUrl.required = personal;
      if (form.elements.hermesModel) form.elements.hermesModel.required = personal;
      if (apiKey) apiKey.required = personal && !authorization?.configured;
    };
    form.querySelectorAll('[name="modelMode"]').forEach((input) => input.addEventListener("change", updateMode));
    provider?.addEventListener("change", () => {
      const previousPreset = baseUrl?.dataset.preset || "";
      const nextPreset = HERMES_PROVIDER_PRESETS[provider.value]?.baseUrl || "";
      if (baseUrl && (!baseUrl.value || baseUrl.value === previousPreset)) baseUrl.value = nextPreset;
      if (baseUrl) baseUrl.dataset.preset = nextPreset;
    });
    if (baseUrl) baseUrl.dataset.preset = HERMES_PROVIDER_PRESETS[provider?.value]?.baseUrl || "";
    updateMode();
  }

  function hermesProviderPayload(form, authorization) {
    const data = new FormData(form);
    if (data.get("modelMode") === "platform") return { mode: "platform" };
    return {
      mode: "agent",
      authorizationId: authorization?.id || undefined,
      provider: data.get("hermesProvider"),
      baseUrl: data.get("hermesBaseUrl"),
      model: data.get("hermesModel"),
      authType: data.get("hermesAuthType"),
      apiKey: data.get("hermesApiKey")
    };
  }

  function initializationError(error) {
    const labels = {
      model_provider_not_configured: "平台尚未配置可用模型，请改用私有密钥",
      provider_api_key_required: "请输入 API Key 或 Token",
      invalid_hermes_provider_configuration: "请完整填写 Provider、HTTPS Base URL 和模型 ID",
      user_custom_keys_disabled: "当前组织没有开放用户私有模型密钥",
      model_not_allowed: "该模型不在当前组织允许范围内",
      model_provider_credential_invalid: "已保存的模型密钥无法解密，请重新输入",
      no_agent_capacity: "暂无可用运行服务器，请稍后重试"
    };
    return labels[error.message] || `初始化失败：${error.message}`;
  }

  async function initializeAgent(agent) {
    await readyDom();
    const [bootstrap, authorizationResult] = await Promise.all([
      requestJson("/api/user/bootstrap"),
      requestJson(`/api/user/agents/${encodeURIComponent(agent.id)}/authorizations`)
    ]);
    const authorization = modelAuthorization(authorizationResult.authorizations);
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "bairui-onboarding";
      overlay.innerHTML = `<form class="bairui-onboarding-form">
        <img src="/assets/bairui-agent-logo.png" alt="">
        <span class="bairui-onboarding-agent">${escapeHtml(agent.name)}</span>
        <h1>初始化 Hermes</h1>
        ${hermesProviderFields({ bootstrap, authorization })}
        <p class="bairui-onboarding-error" role="alert"></p>
        <div class="bairui-onboarding-actions"><button type="button" data-later>稍后</button><button type="submit">保存并初始化</button></div>
      </form>`;
      document.body.appendChild(overlay);
      const form = overlay.querySelector("form");
      const error = overlay.querySelector(".bairui-onboarding-error");
      const later = overlay.querySelector("[data-later]");
      bindHermesProviderFields(form, authorization);
      later.addEventListener("click", () => { overlay.remove(); resolve(null); });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        later.disabled = true;
        error.textContent = "";
        try {
          const result = await submitAgentInitialization(agent, hermesProviderPayload(form, authorization));
          overlay.remove();
          resolve(result);
        } catch (cause) {
          error.textContent = initializationError(cause);
          submit.disabled = false;
          later.disabled = false;
        }
      });
    });
  }

  async function createAgentDialog() {
    await readyDom();
    const bootstrap = await requestJson("/api/user/bootstrap");
    const authorizationOptions = (bootstrap.authorizationServices ?? []).filter((item) => item.enabled && item.id !== "model-provider").map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} - ${escapeHtml(item.purpose)}</option>`).join("");
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
        ${hermesProviderFields({ bootstrap, authorization: null })}
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
      bindHermesProviderFields(form, null);
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
              body: JSON.stringify({ name: data.get("name"), avatarUrl: data.get("avatarUrl"), description: data.get("description"), soulMarkdown: data.get("soulMarkdown") })
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
          }
          progress.hidden = false;
          progress.querySelector("strong").textContent = "提交初始化请求";
          await submitAgentInitialization(createdAgent, hermesProviderPayload(form, null));
          later.hidden = false;
          const ready = await waitForAgentReady(createdAgent.id, (agent) => {
            progress.querySelector("strong").textContent = initializationLabel(agent);
          }, 5 * 60_000, polling.signal);
          overlay.remove();
          resolve(ready);
        } catch (cause) {
          const labels = {
            model_unconfigured: "管理员尚未配置可用模型",
            quota_exhausted: "当前组织额度已用尽",
            offline: "Runtime 已离线，正在等待服务器恢复",
            agent_initialization_timeout: "初始化仍在后台进行，请稍后从 Agent 页面查看"
          };
          if (cause.name === "AbortError") return;
          error.textContent = labels[cause.message] || initializationError(cause);
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
      const stopping = active && state.stopRequested;
      send.textContent = stopping ? "停止中" : active ? "停止" : "发送";
      send.title = stopping ? "正在停止 Hermes 运行" : active ? "停止生成" : "发送消息";
      send.disabled = stopping;
    }
    window.dispatchEvent(new CustomEvent("bairui:stream-state", { detail: { active } }));
  }

  function closeApprovalDialog() {
    const dialog = state.approvalDialog;
    state.approvalDialog = null;
    if (!dialog) return;
    if (dialog.open) dialog.close();
    dialog.remove();
  }

  async function submitApproval(runId, choice) {
    const agent = await loadActiveAgent();
    return requestJson(`/api/user/agents/${encodeURIComponent(agent.id)}/runs/${encodeURIComponent(runId)}/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ choice })
    });
  }

  function showApprovalRequest(data) {
    const runId = String(data.run_id || state.activeRunId || "");
    if (!runId || state.stopRequested) return;
    state.activeRunId = runId;
    closeApprovalDialog();

    const dialog = document.createElement("dialog");
    dialog.className = "bairui-approval-dialog";
    dialog.setAttribute("aria-labelledby", "bairui-approval-title");
    const form = document.createElement("form");
    form.method = "dialog";
    const header = document.createElement("header");
    const title = document.createElement("h2");
    title.id = "bairui-approval-title";
    title.textContent = "Hermes 请求操作授权";
    const description = document.createElement("p");
    description.textContent = String(data.description || data.prompt || "Agent 请求执行受保护操作。").slice(0, 2000);
    header.append(title, description);
    form.appendChild(header);
    if (data.command) {
      const command = document.createElement("pre");
      command.textContent = String(data.command).slice(0, 4000);
      form.appendChild(command);
    }
    const status = document.createElement("p");
    status.className = "bairui-approval-status";
    status.setAttribute("role", "status");
    form.appendChild(status);
    const actions = document.createElement("footer");
    const labels = { once: "仅本次", session: "本次会话", always: "始终允许", deny: "拒绝" };
    const advertised = Array.isArray(data.choices) ? data.choices : Object.keys(labels);
    const choices = advertised.filter((choice) => labels[choice] && (choice !== "always" || data.allow_permanent !== false));
    for (const choice of choices.length ? choices : ["once", "deny"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.choice = choice;
      button.className = choice === "deny" ? "danger" : choice === "once" ? "primary" : "";
      button.textContent = labels[choice];
      button.addEventListener("click", async () => {
        for (const item of actions.querySelectorAll("button")) item.disabled = true;
        status.textContent = "正在提交审批决定";
        try {
          await submitApproval(runId, choice);
          closeApprovalDialog();
          cardNotice(choice === "deny" ? "已拒绝 Hermes 操作" : "审批决定已提交", choice === "deny" ? "info" : "success");
        } catch (error) {
          status.textContent = `提交失败：${error.message}`;
          for (const item of actions.querySelectorAll("button")) item.disabled = false;
        }
      });
      actions.appendChild(button);
    }
    form.appendChild(actions);
    dialog.appendChild(form);
    dialog.addEventListener("cancel", (event) => event.preventDefault());
    document.body.appendChild(dialog);
    state.approvalDialog = dialog;
    dialog.showModal();
  }

  function finishActiveRun(name, data) {
    if (data.run_id && state.activeRunId && data.run_id !== state.activeRunId) return;
    if (name === "run.cancelled") emitCompatibility("stream_end", { mode: "text", interrupted: true });
    if (name === "run.failed") {
      emitCompatibility("stream_end", { mode: "text", interrupted: true });
      emitCompatibility("error", { error: data.error?.message || data.message || "Hermes 运行失败" });
    }
    closeApprovalDialog();
    state.activeRunId = null;
    state.stopRequested = false;
    setStreaming(false);
  }

  function mapHermesEvent(name, data) {
    if (name === "run.started") {
      state.activeRunId = data.run_id || state.activeRunId;
      emitCompatibility("message_received", { input: contentText(data.user_message?.content) });
      if (state.stopRequested) void stopActiveStream().catch((error) => cardNotice(`停止失败：${error.message}`, "error"));
    }
    else if (name === "message.started") emitCompatibility("stream_start", { mode: "text", plainReply: true });
    else if (name === "assistant.delta") emitCompatibility("stream_chunk", { mode: "text", text: data.delta || "" });
    else if (name === "tool.progress") emitCompatibility("stream_chunk", { mode: "reasoning", text: data.delta || "" });
    else if (name === "tool.started") emitCompatibility("tool_executing", { name: data.tool_name, args: data.args });
    else if (name === "tool.completed" || name === "tool.failed") emitCompatibility("tool_call", { name: data.tool_name, args: data.args, result: data.preview, ok: name === "tool.completed" });
    else if (name === "approval.request") showApprovalRequest(data);
    else if (name === "assistant.completed") {
      emitCompatibility("stream_end", { mode: "text" });
      emitCompatibility("message", { from: "consciousness", content: data.content || "", conversation_id: data.message_id, speak: false });
    } else if (name === "run.completed") {
      emitCompatibility("response", { runId: data.run_id, usage: data.usage });
      finishActiveRun(name, data);
    } else if (name === "run.failed" || name === "run.cancelled") finishActiveRun(name, data);
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
    if (!state.activeAbortController && !state.activeRunId) return false;
    state.stopRequested = true;
    setStreaming(true);
    if (!state.activeRunId) return true;
    if (state.stopPromise) return state.stopPromise;
    const runId = state.activeRunId;
    const controller = state.activeAbortController;
    state.stopPromise = (async () => {
      const agent = await loadActiveAgent();
      await requestJson(`/api/user/agents/${encodeURIComponent(agent.id)}/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" });
      controller?.abort();
      if (state.activeAbortController === controller) state.activeAbortController = null;
      closeApprovalDialog();
      state.activeRunId = null;
      state.stopRequested = false;
      emitCompatibility("stream_end", { mode: "text", interrupted: true });
      setStreaming(false);
      return true;
    })();
    try {
      return await state.stopPromise;
    } catch (error) {
      state.stopRequested = false;
      setStreaming(Boolean(state.activeAbortController || state.activeRunId));
      throw error;
    } finally {
      state.stopPromise = null;
    }
  }

  async function sendMessage(options) {
    const body = JSON.parse(options?.body || "{}");
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (!content && !attachments.length) return jsonResponse({ error: "invalid_message" }, 400);
    if (state.activeAbortController || state.activeRunId) return jsonResponse({ error: "run_in_progress" }, 409);
    const agent = await loadActiveAgent();
    const failure = operationalFailure(agent);
    if (failure) return jsonResponse({ error: failure.error, operational: failure.code }, failure.status);
    const session = await ensureSession(agent);
    state.lastMessage = { content, attachments };
    const controller = new AbortController();
    state.activeAbortController = controller;
    state.activeRunId = null;
    state.stopRequested = false;
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
        setStreaming(Boolean(state.activeRunId));
      }
    })();
    return jsonResponse({ accepted: true, sessionId: session.id }, 202);
  }

  async function conversationHistory(limit = 60) {
    try {
      const agent = await loadActiveAgent();
      const session = await ensureSession(agent);
      const result = await requestJson(`/api/user/agents/${encodeURIComponent(agent.id)}/sessions/${encodeURIComponent(session.id)}/messages`);
      return (result.data || []).filter((message) => ["user", "assistant"].includes(message.role)).slice(-Math.max(1, Math.min(Number(limit) || 60, 200))).map((message) => ({
        id: message.id,
        role: message.role === "assistant" ? "jarvis" : "user",
        content: contentText(message.content),
        channel: "API",
        from_id: message.role === "assistant" ? agent.id : "current-user",
        created_at: message.timestamp
      }));
    } catch { return []; }
  }

  class BairuiCompatibilityStream extends EventTarget {
    constructor() {
      super();
      this.url = "bairui://compatibility-events";
      this.readyState = BairuiCompatibilityStream.CONNECTING;
      this.withCredentials = true;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      compatibilityStreams.add(this);
      queueMicrotask(async () => {
        try {
          await loadActiveAgent();
          if (this.readyState === BairuiCompatibilityStream.CLOSED) return;
          this.readyState = BairuiCompatibilityStream.OPEN;
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
      if (this.readyState !== BairuiCompatibilityStream.OPEN) return;
      const event = new MessageEvent("message", { data });
      this.dispatchEvent(event);
      this.onmessage?.(event);
    }
    close() {
      this.readyState = BairuiCompatibilityStream.CLOSED;
      compatibilityStreams.delete(this);
    }
  }
  BairuiCompatibilityStream.CONNECTING = 0;
  BairuiCompatibilityStream.OPEN = 1;
  BairuiCompatibilityStream.CLOSED = 2;

  const hostAdapter = Object.freeze({
    sendMessage,
    async conversations(options = {}) {
      return jsonResponse(await conversationHistory(options.limit));
    },
    async agentProfile() {
      const agent = await loadActiveAgent();
      return jsonResponse({ name: agent.name, agentId: agent.id, runtime: "Hermes", runtimeStatus: agent.runtime?.status || "uninitialized", ui: "BaiLongma Brain UI" });
    },
    async memories(options = {}) {
      const agent = await loadActiveAgent();
      const url = new URL("/memories", location.origin);
      url.searchParams.set("agent_id", agent.id);
      url.searchParams.set("limit", String(Math.max(1, Math.min(Number(options.limit) || 120, 200))));
      return platformRequest(`${url.pathname}${url.search}`);
    },
    openEvents() {
      return new BairuiCompatibilityStream();
    }
  });
  Object.defineProperty(window, "BairuiHostAdapter", { value: hostAdapter, writable: false, configurable: false, enumerable: false });

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
          const accepted = await initializeAgent(agent);
          if (!accepted) {
            initialize.disabled = false;
            initialize.textContent = failure.code === "failed" ? "重试初始化" : "初始化 Agent";
            return;
          }
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
      const promptKey = `bairui.initializationPrompt.${agent.id}`;
      if (failure.code === "uninitialized" && !sessionStorage.getItem(promptKey)) {
        sessionStorage.setItem(promptKey, "shown");
        setTimeout(() => initialize.click(), 0);
      }
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
          const accepted = await initializeAgent(agent);
          if (!accepted) {
            status.disabled = false;
            status.textContent = initializationLabel(agent);
            return;
          }
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
