async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || "request_failed"), { status: response.status });
  return body;
}

document.querySelector("#logout-button").addEventListener("click", async () => {
  await request("/api/auth/logout", { method: "POST" });
  location.href = "/login";
});

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
