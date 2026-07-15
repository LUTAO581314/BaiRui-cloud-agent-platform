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
let hotspotData = { run: null, items: [] };
let activeHotspotSource = "all";

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

function switchWorkView(targetId) {
  document.querySelectorAll(".brain-work-view").forEach((view) => { view.hidden = view.id !== targetId; });
  document.querySelectorAll(".brain-view-tab").forEach((button) => { button.classList.toggle("active", button.dataset.viewTarget === targetId); });
}

function renderHotspots() {
  const items = activeHotspotSource === "all" ? hotspotData.items : hotspotData.items.filter((item) => item.sourceId === activeHotspotSource);
  const list = document.querySelector("#hotspot-list");
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "feature-empty";
    empty.textContent = hotspotData.run ? "当前来源没有可展示的数据。" : "管理员尚未执行热点采集。";
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...items.map((item) => {
    const article = document.createElement("article");
    article.className = "hotspot-item";
    const rank = document.createElement("strong");
    rank.className = "hotspot-rank";
    rank.textContent = String(item.rank);
    const content = document.createElement("div");
    const title = item.url ? document.createElement("a") : document.createElement("span");
    title.className = "hotspot-title";
    title.textContent = item.title;
    if (item.url) { title.href = item.url; title.target = "_blank"; title.rel = "noreferrer"; }
    const meta = document.createElement("small");
    meta.textContent = [item.sourceName, item.heat, item.category].filter(Boolean).join(" · ");
    content.append(title, meta);
    article.append(rank, content);
    return article;
  }));
}

async function loadHotspots() {
  hotspotData = await request("/api/user/hotspots");
  const sourceMap = new Map(hotspotData.items.map((item) => [item.sourceId, item.sourceName]));
  const tabs = [{ id: "all", name: "全部" }, ...[...sourceMap].map(([id, name]) => ({ id, name }))];
  document.querySelector("#hotspot-source-tabs").replaceChildren(...tabs.map((source) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `source-tab${source.id === activeHotspotSource ? " active" : ""}`;
    button.textContent = source.name;
    button.addEventListener("click", () => { activeHotspotSource = source.id; loadHotspots().catch(() => {}); });
    return button;
  }));
  document.querySelector("#hotspot-total").textContent = `${hotspotData.items.length} 条`;
  document.querySelector("#hotspot-updated").textContent = hotspotData.run ? new Date(hotspotData.run.completedAt).toLocaleString() : "尚未采集";
  const runStatus = document.querySelector("#hotspot-run-status");
  runStatus.textContent = hotspotData.run?.status ?? "等待数据";
  runStatus.className = `brain-pill ${hotspotData.run?.status === "completed" ? "healthy" : hotspotData.run ? "degraded" : "unknown"}`;
  renderHotspots();
}

function renderMemoryNotes(notes) {
  document.querySelector("#memory-count").textContent = `${notes.length} 篇`;
  const list = document.querySelector("#memory-list");
  if (!notes.length) {
    const empty = document.createElement("p");
    empty.className = "feature-empty";
    empty.textContent = "还没有 Obsidian 笔记。";
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...notes.map((note) => {
    const details = document.createElement("details");
    details.className = "memory-note";
    const summary = document.createElement("summary");
    const title = document.createElement("strong");
    title.textContent = note.title;
    const meta = document.createElement("span");
    meta.textContent = `${note.slug}.md · ${new Date(note.updatedAt).toLocaleString()}`;
    summary.append(title, meta);
    const markdown = document.createElement("pre");
    markdown.textContent = note.markdown;
    details.append(summary, markdown);
    return details;
  }));
}

async function loadMemoryNotes() {
  const data = await request("/api/user/memory-notes");
  renderMemoryNotes(data.notes);
}

document.querySelectorAll(".brain-view-tab").forEach((button) => {
  button.addEventListener("click", () => {
    switchWorkView(button.dataset.viewTarget);
    if (button.dataset.viewTarget === "hotspot-view") loadHotspots().catch(() => renderHotspots());
    if (button.dataset.viewTarget === "memory-view") loadMemoryNotes().catch(() => renderMemoryNotes([]));
  });
});

document.querySelector("#memory-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const split = (value) => String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  await request("/api/user/memory-notes", { method: "POST", body: JSON.stringify({ title: data.get("title"), body: data.get("body"), tags: split(data.get("tags")), wikilinks: split(data.get("wikilinks")) }) });
  form.reset();
  await loadMemoryNotes();
});

loadWorkspace().catch(() => {
  setRuntimeStatus("degraded", "工作区不可用");
  showLocalNotice("无法读取工作区。");
});
