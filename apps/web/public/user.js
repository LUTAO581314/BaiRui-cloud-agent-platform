async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body.message || body.error || "request_failed"), {
      status: response.status
    });
  }
  return body;
}

const conversations = document.querySelector("#conversation-items");
const messages = document.querySelector("#message-list");
const emptyState = document.querySelector("#chat-empty");
const chatScroll = document.querySelector("#chat-scroll");
const status = document.querySelector("#runtime-status");
const statusLabel = document.querySelector("#runtime-status-label");
const agentState = document.querySelector("#agent-state");
const agentName = document.querySelector("#agent-name");
const conversationCount = document.querySelector("#conversation-count");
const runtimeConversationCount = document.querySelector("#runtime-conversation-count");
const currentConversationTitle = document.querySelector("#current-conversation-title");
const messageForm = document.querySelector("#message-form");
const messageInput = messageForm.elements.content;
const sendButton = document.querySelector("#send-message");

let workspace;
let activeConversation;

document.querySelector("#logout-button").addEventListener("click", async () => {
  await request("/api/auth/logout", { method: "POST" });
  location.href = "/login";
});

function setRuntimeStatus(value, label) {
  const healthy = value === "ready";
  status.textContent = healthy ? "实时" : "降级";
  status.className = `brain-pill ${healthy ? "healthy" : "degraded"}`;
  statusLabel.textContent = label;
  agentState.textContent = healthy ? "可用" : "未配置";
  agentState.className = healthy ? "brain-live" : "";
}

function updateConversationMetrics() {
  const count = workspace?.conversations?.length ?? 0;
  conversationCount.textContent = `${count} 个会话`;
  runtimeConversationCount.textContent = String(count);
}

function renderConversations() {
  conversations.replaceChildren(...workspace.conversations.map((conversation) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `brain-conversation-item${conversation.id === activeConversation ? " active" : ""}`;
    button.dataset.conversationId = conversation.id;

    const title = document.createElement("strong");
    title.textContent = conversation.title;
    const meta = document.createElement("span");
    meta.textContent = conversation.id === activeConversation ? "当前会话" : "打开会话";
    button.append(title, meta);
    button.addEventListener("click", () => openConversation(conversation.id));
    return button;
  }));
  updateConversationMetrics();
}

function messageElement(message) {
  const element = document.createElement("article");
  const role = ["user", "assistant", "system", "tool"].includes(message.role) ? message.role : "system";
  element.className = `brain-message ${role}`;

  const label = document.createElement("span");
  label.className = "brain-message-label";
  label.textContent = role === "user" ? "你" : role === "assistant" ? "bairui-agent" : role;

  const content = document.createElement("div");
  content.className = "brain-message-content";
  content.textContent = message.content;
  element.append(label, content);
  return element;
}

function showLocalNotice(content, kind = "system") {
  messages.appendChild(messageElement({ role: kind, content }));
  emptyState.hidden = true;
  chatScroll.scrollTop = chatScroll.scrollHeight;
}

async function openConversation(id) {
  activeConversation = id;
  const conversation = workspace.conversations.find((item) => item.id === id);
  currentConversationTitle.textContent = conversation?.title ?? "会话";
  renderConversations();

  const result = await request(`/api/user/conversations/${id}/messages`);
  messages.replaceChildren(...result.messages.map(messageElement));
  emptyState.hidden = result.messages.length > 0;
  chatScroll.scrollTop = chatScroll.scrollHeight;
}

async function createConversation() {
  const agent = workspace.agents[0];
  if (!agent) {
    showLocalNotice("当前没有可用的 Agent。");
    return;
  }
  const result = await request("/api/user/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: agent.id, title: "新会话" })
  });
  workspace.conversations.unshift(result.conversation);
  await openConversation(result.conversation.id);
  messageInput.focus();
}

async function loadWorkspace() {
  workspace = await request("/api/user/workspace");
  const agent = workspace.agents[0];
  agentName.textContent = agent?.name ?? "bairui-agent";
  setRuntimeStatus(agent?.status, agent?.status === "ready" ? "等待用户消息" : "Agent 尚未就绪");
  renderConversations();

  if (workspace.conversations[0]) {
    await openConversation(workspace.conversations[0].id);
  } else {
    emptyState.hidden = false;
    currentConversationTitle.textContent = "新会话";
  }
}

document.querySelector("#new-conversation").addEventListener("click", () => {
  createConversation().catch((error) => showLocalNotice(error.message));
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    messageForm.requestSubmit();
  }
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = messageInput.value.trim();
  if (!content || sendButton.disabled) return;
  if (!activeConversation) await createConversation();
  if (!activeConversation) return;

  messageInput.value = "";
  sendButton.disabled = true;
  sendButton.textContent = "处理中";
  showLocalNotice(content, "user");

  try {
    await request(`/api/user/conversations/${activeConversation}/messages`, {
      method: "POST",
      body: JSON.stringify({ content })
    });
    await openConversation(activeConversation);
    setRuntimeStatus("ready", "等待用户消息");
  } catch (error) {
    showLocalNotice(error.status >= 500 ? "Runtime 暂不可用，请稍后重试。" : error.message);
    setRuntimeStatus("degraded", "Runtime 请求失败");
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = "发送";
    messageInput.focus();
  }
});

loadWorkspace().catch(() => {
  setRuntimeStatus("degraded", "工作区不可用");
  showLocalNotice("无法读取工作区。");
});
