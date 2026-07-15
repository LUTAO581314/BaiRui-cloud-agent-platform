const view = document.body.dataset.view;

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || "request_failed"), { status: response.status, body });
  return body;
}

document.querySelector("#logout-button")?.addEventListener("click", async () => {
  await request("/api/auth/logout", { method: "POST" });
  location.href = "/login";
});

if (view === "login") {
  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const error = document.querySelector("#form-error");
    error.hidden = true;
    try {
      const result = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      location.href = ["org_admin", "platform_admin"].includes(result.user.role) && new URLSearchParams(location.search).get("next") === "/admin" ? "/admin" : "/app";
    } catch (requestError) {
      error.textContent = requestError.status === 429 ? "登录尝试过多，请稍后重试" : "邮箱或密码错误";
      error.hidden = false;
    }
  });
}

if (view === "user") {
  let workspace;
  let activeConversation;
  const conversations = document.querySelector("#conversation-items");
  const messages = document.querySelector("#message-list");
  const status = document.querySelector("#runtime-status");

  function renderConversations() {
    conversations.replaceChildren(...workspace.conversations.map((conversation) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `conversation-item${conversation.id === activeConversation ? " active" : ""}`;
      button.textContent = conversation.title;
      button.addEventListener("click", () => openConversation(conversation.id));
      return button;
    }));
  }

  async function openConversation(id) {
    activeConversation = id;
    renderConversations();
    const result = await request(`/api/user/conversations/${id}/messages`);
    messages.replaceChildren(...result.messages.map((message) => {
      const element = document.createElement("div");
      element.className = `message ${message.role}`;
      element.textContent = message.content;
      return element;
    }));
  }

  async function loadWorkspace() {
    workspace = await request("/api/user/workspace");
    status.textContent = workspace.agents[0]?.status ?? "未配置";
    status.className = `status ${workspace.agents[0]?.status === "ready" ? "healthy" : "degraded"}`;
    renderConversations();
    if (workspace.conversations[0]) await openConversation(workspace.conversations[0].id);
  }

  document.querySelector("#new-conversation").addEventListener("click", async () => {
    const agent = workspace.agents[0];
    if (!agent) return;
    const result = await request("/api/user/conversations", { method: "POST", body: JSON.stringify({ agentId: agent.id, title: "新会话" }) });
    workspace.conversations.unshift(result.conversation);
    await openConversation(result.conversation.id);
  });

  document.querySelector("#message-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activeConversation) return;
    const textarea = event.currentTarget.elements.content;
    const content = textarea.value.trim();
    if (!content) return;
    textarea.value = "";
    try {
      await request(`/api/user/conversations/${activeConversation}/messages`, { method: "POST", body: JSON.stringify({ content }) });
    } catch (error) {
      if (error.status !== 503) throw error;
    }
    await openConversation(activeConversation);
  });

  loadWorkspace().catch(() => { status.textContent = "不可用"; status.className = "status unhealthy"; });
}

if (view === "admin") {
  async function loadOverview() {
    const data = await request("/api/admin/overview");
    document.querySelector("#metric-users").textContent = data.users;
    document.querySelector("#metric-snapshots").textContent = data.snapshots.length;
    document.querySelector("#metric-audit").textContent = data.recentAudit.length;
    const status = document.querySelector("#control-status");
    const latest = data.snapshots.at(-1);
    status.textContent = latest?.status ?? "等待上报";
    status.className = `status ${latest?.status ?? "unknown"}`;
    document.querySelector("#snapshot-rows").innerHTML = data.snapshots.length
      ? data.snapshots.map((item) => `<tr><td>${item.serverId}</td><td>${item.status}</td><td>${new Date(item.receivedAt).toLocaleString()}</td></tr>`).join("")
      : '<tr><td colspan="3" class="empty-row">暂无快照</td></tr>';
    document.querySelector("#audit-rows").innerHTML = data.recentAudit.length
      ? data.recentAudit.map((item) => `<tr><td>${item.action}</td><td>${item.targetType}</td><td>${new Date(item.createdAt).toLocaleString()}</td></tr>`).join("")
      : '<tr><td colspan="3" class="empty-row">暂无记录</td></tr>';
  }
  document.querySelector("#refresh-admin").addEventListener("click", loadOverview);
  loadOverview().catch(() => { document.querySelector("#control-status").textContent = "读取失败"; });
}
