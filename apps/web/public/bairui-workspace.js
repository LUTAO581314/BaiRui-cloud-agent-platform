(function () {
  const bridge = window.bairuiPlatform;
  if (!bridge) return;

  const NAV = [
    ["chat", "对话"], ["conversations", "会话"], ["agents", "Agent"], ["memory", "记忆"],
    ["skills", "技能"], ["channels", "渠道"], ["hotspots", "热点"], ["runs", "运行"],
    ["jobs", "任务"], ["usage", "用量"], ["settings", "设置"]
  ];
  const CHANNEL_LABELS = { web: "网页", cli: "CLI", feishu: "飞书", wechat: "微信", qq: "QQ" };
  const STATUS_LABELS = {
    ready: "正常", active: "正常", connected: "已连接", applied: "已生效", pending: "待应用",
    provisioning: "初始化中", starting: "启动中", suspended: "已暂停", stopped: "已停止",
    initializing: "初始化中", uninitialized: "未初始化", offline: "Runtime 离线", upgrading: "升级中",
    model_unconfigured: "模型未配置", quota_exhausted: "额度已用尽", deleting: "删除中", deleted: "已删除",
    failed: "失败", degraded: "降级", unavailable: "不可用", unconfigured: "未配置", disabled: "已停用", unknown: "未知"
  };
  Object.assign(STATUS_LABELS, {
    started: "已启动", queued: "排队中", running: "运行中", waiting_for_approval: "等待审批",
    stopping: "停止中", completed: "已完成", cancelled: "已取消", scheduled: "已计划",
    paused: "已暂停", ok: "成功", error: "失败", stored: "已安全保存", revoked: "已吊销"
  });
  const workspaceState = { view: "conversations", runId: null, runStream: null };
  let root;
  let content;
  let title;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function formatTime(value) {
    if (!value) return "--";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "--" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function status(value, label) {
    const key = String(value || "unknown");
    return `<span class="bw-status bw-status-${escapeHtml(key)}">${escapeHtml(label || STATUS_LABELS[key] || key)}</span>`;
  }

  function activeAgent() {
    return bridge.state.activeAgent;
  }

  function agentApi(path = "") {
    return `/api/user/agents/${encodeURIComponent(activeAgent().id)}${path}`;
  }

  function normalizeList(value, keys = []) {
    if (Array.isArray(value)) return value;
    for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
    if (Array.isArray(value?.data)) return value.data;
    return [];
  }

  function showError(error) {
    const labels = {
      runtime_unavailable: "Agent Runtime 当前不可用",
      runtime_route_unavailable: "Agent 还没有可用的运行环境",
      model_not_allowed: "该模型不在管理员允许范围内",
      model_not_configured: "管理员尚未配置可用模型",
      quota_exhausted: "当前用量额度已耗尽",
      runtime_offline: "Agent Runtime 已离线",
      agent_not_ready: "Agent 当前尚未就绪",
      Forbidden: "当前账户没有执行此操作的权限",
      agent_not_initialized: "Agent 尚未初始化",
      no_agent_capacity: "当前没有可用服务器容量",
      memory_projection_unavailable: "当前 Runtime 版本尚未支持 Hermes 记忆同步",
      memory_projection_conflict: "Hermes 记忆在同步期间发生变化，请重新同步"
    };
    content.innerHTML = `<div class="bw-empty bw-error"><strong>无法加载</strong><p>${escapeHtml(labels[error.message] || error.message || "未知错误")}</p><button type="button" data-retry>重试</button></div>`;
    content.querySelector("[data-retry]")?.addEventListener("click", () => render(workspaceState.view));
  }

  function toast(message, tone = "info") {
    const item = document.createElement("div");
    item.className = `bw-toast bw-toast-${tone}`;
    item.textContent = message;
    document.body.appendChild(item);
    requestAnimationFrame(() => item.classList.add("visible"));
    setTimeout(() => { item.classList.remove("visible"); setTimeout(() => item.remove(), 200); }, 3200);
  }

  function openForm({ heading, submitLabel = "保存", fields = [], danger = false }) {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "bw-dialog";
      const form = document.createElement("form");
      form.method = "dialog";
      form.innerHTML = `<header><h2>${escapeHtml(heading)}</h2><button type="button" data-close aria-label="关闭" title="关闭">×</button></header><div class="bw-dialog-fields"></div><footer><button type="button" data-cancel>取消</button><button type="submit" class="${danger ? "danger" : "primary"}">${escapeHtml(submitLabel)}</button></footer>`;
      const container = form.querySelector(".bw-dialog-fields");
      for (const field of fields) {
        const label = document.createElement("label");
        label.textContent = field.label;
        const input = field.type === "textarea" ? document.createElement("textarea") : field.type === "select" ? document.createElement("select") : document.createElement("input");
        input.name = field.name;
        if (field.type && !["textarea", "select"].includes(field.type)) input.type = field.type;
        if (field.type === "textarea") input.rows = field.rows || 6;
        if (field.required) input.required = true;
        if (field.placeholder) input.placeholder = field.placeholder;
        if (field.maxLength) input.maxLength = field.maxLength;
        if (field.type === "select") for (const option of field.options || []) input.add(new Option(option.label, option.value, false, option.value === field.value));
        else input.value = field.value ?? "";
        label.appendChild(input);
        container.appendChild(label);
      }
      dialog.appendChild(form);
      document.body.appendChild(dialog);
      const close = () => { dialog.close(); dialog.remove(); resolve(null); };
      form.querySelector("[data-close]").addEventListener("click", close);
      form.querySelector("[data-cancel]").addEventListener("click", close);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form));
        dialog.close();
        dialog.remove();
        resolve(values);
      });
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
      dialog.showModal();
      form.querySelector("input, textarea, select")?.focus();
    });
  }

  function openWorkspace(view = workspaceState.view) {
    root.hidden = false;
    document.body.classList.add("bairui-workspace-open");
    render(view);
  }

  function closeWorkspace() {
    root.hidden = true;
    document.body.classList.remove("bairui-workspace-open");
    window.dispatchEvent(new CustomEvent("bairui:chat-layout"));
  }

  async function render(view) {
    if (view === "chat") return closeWorkspace();
    workspaceState.view = view;
    root.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    title.textContent = NAV.find(([key]) => key === view)?.[1] || "工作区";
    content.innerHTML = '<div class="bw-loading"><span></span>正在读取真实状态</div>';
    try {
      const renderer = { conversations: renderConversations, agents: renderAgents, memory: renderMemory, skills: renderSkills, channels: renderChannels, hotspots: renderHotspots, runs: renderRuns, jobs: renderJobs, usage: renderUsage, settings: renderSettings }[view];
      if (renderer) await renderer();
    } catch (error) { showError(error); }
  }

  async function renderConversations() {
    const sessions = await bridge.listSessions();
    content.innerHTML = `<div class="bw-toolbar"><input type="search" placeholder="搜索会话" aria-label="搜索会话"><button type="button" class="primary" data-new>＋ 新会话</button></div><div class="bw-list" data-list></div>`;
    const list = content.querySelector("[data-list]");
    const draw = (query = "") => {
      const visible = sessions.filter((item) => String(item.title || "新会话").toLowerCase().includes(query.toLowerCase()));
      list.innerHTML = visible.length ? visible.map((item) => `<article class="bw-row ${item.id === bridge.state.activeSessionId ? "selected" : ""}"><div><strong>${escapeHtml(item.title || "新会话")}</strong><span>${formatTime(item.updated_at || item.created_at)}</span></div><div class="bw-actions"><button type="button" data-open="${escapeHtml(item.id)}">打开</button><button type="button" data-rename="${escapeHtml(item.id)}" title="重命名">✎</button><button type="button" data-fork="${escapeHtml(item.id)}">分支</button><button type="button" data-delete="${escapeHtml(item.id)}" class="danger-icon" title="删除">×</button></div></article>`).join("") : '<div class="bw-empty">没有匹配的会话</div>';
    };
    draw();
    content.querySelector("input").addEventListener("input", (event) => draw(event.target.value));
    content.querySelector("[data-new]").addEventListener("click", async () => { await bridge.createSession("新会话"); location.reload(); });
    list.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.open) return bridge.activateSession(button.dataset.open);
      const id = button.dataset.rename || button.dataset.fork || button.dataset.delete;
      const current = sessions.find((item) => item.id === id);
      if (button.dataset.rename) {
        const values = await openForm({ heading: "重命名会话", fields: [{ name: "title", label: "标题", value: current?.title || "", required: true, maxLength: 200 }] });
        if (values) await bridge.request(`${agentApi(`/sessions/${encodeURIComponent(id)}`)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      } else if (button.dataset.fork) {
        await bridge.request(agentApi(`/sessions/${encodeURIComponent(id)}/fork`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: `${current?.title || "会话"} 分支` }) });
      } else if (button.dataset.delete) {
        const values = await openForm({ heading: "删除会话", submitLabel: "确认删除", danger: true, fields: [] });
        if (values) await bridge.request(agentApi(`/sessions/${encodeURIComponent(id)}`), { method: "DELETE" });
      }
      renderConversations();
    });
  }

  async function renderAgents() {
    const result = await bridge.request("/api/user/agents");
    bridge.state.agents = result.agents || [];
    const agent = bridge.state.agents.find((item) => item.id === activeAgent().id) || activeAgent();
    content.innerHTML = `<div class="bw-split"><section><div class="bw-section-head"><h3>我的 Agent</h3><button type="button" class="primary" data-create>＋ 创建</button></div><div class="bw-list">${bridge.state.agents.map((item) => `<article class="bw-row ${item.id === agent.id ? "selected" : ""}"><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.description || "未填写描述")}</span></div><div>${status(item.operational?.code || item.runtime?.effectiveStatus || item.runtime?.status || item.initializationStatus)}<button type="button" data-switch="${escapeHtml(item.id)}">切换</button></div></article>`).join("")}</div></section><section><h3>当前 Agent</h3><dl class="bw-details"><div><dt>名称</dt><dd>${escapeHtml(agent.name)}</dd></div><div><dt>状态</dt><dd>${status(agent.operational?.code || "uninitialized")}</dd></div><div><dt>Runtime</dt><dd>${status(agent.runtime?.effectiveStatus || agent.runtime?.status || "uninitialized")}</dd></div><div><dt>Hermes</dt><dd>${escapeHtml(agent.runtime?.hermesVersion || "等待上报")}</dd></div><div><dt>最近心跳</dt><dd>${formatTime(agent.runtime?.lastHeartbeatAt)}</dd></div><div><dt>今日 Token</dt><dd>${Number(agent.operational?.quota?.dailyTokens || 0).toLocaleString()}</dd></div></dl><div class="bw-actions bw-actions-wide"><button type="button" data-edit>编辑资料</button>${["uninitialized", "failed"].includes(agent.operational?.code || agent.initializationStatus) ? '<button type="button" class="primary" data-init>初始化/重试</button>' : ""}${agent.runtime?.status === "suspended" ? '<button type="button" class="primary" data-resume>恢复</button>' : '<button type="button" data-pause>暂停</button>'}<button type="button" class="danger" data-remove>删除 Agent</button></div></section></div>`;
    content.querySelector("[data-create]").addEventListener("click", async () => { const created = await bridge.createAgentDialog(); bridge.activateAgent(created.id); });
    content.querySelectorAll("[data-switch]").forEach((button) => button.addEventListener("click", () => bridge.activateAgent(button.dataset.switch)));
    content.querySelector("[data-edit]").addEventListener("click", async () => {
      const values = await openForm({ heading: "编辑 Agent", fields: [{ name: "name", label: "名称", value: agent.name, required: true, maxLength: 64 }, { name: "description", label: "描述", type: "textarea", value: agent.description, maxLength: 500 }, { name: "soulMarkdown", label: "身份与原则", type: "textarea", value: agent.soulMarkdown, rows: 10, maxLength: 50000 }] });
      if (values) { await bridge.request(agentApi(), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(values) }); toast("Agent 资料已保存", "success"); renderAgents(); }
    });
    content.querySelector("[data-init]")?.addEventListener("click", async () => { await bridge.initializeAgent(agent); toast("初始化请求已提交"); renderAgents(); });
    content.querySelector("[data-pause]")?.addEventListener("click", async () => { await bridge.request(agentApi("/lifecycle"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pause" }) }); toast("暂停命令已提交，等待服务器回执"); renderAgents(); });
    content.querySelector("[data-resume]")?.addEventListener("click", async () => { await bridge.request(agentApi("/lifecycle"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resume" }) }); toast("恢复命令已提交，等待服务器回执"); renderAgents(); });
    content.querySelector("[data-remove]").addEventListener("click", async () => {
      const values = await openForm({ heading: "删除 Agent", submitLabel: "永久删除", danger: true, fields: [{ name: "confirmName", label: `输入 ${agent.name} 确认`, required: true }] });
      if (!values) return;
      await bridge.request(agentApi("/lifecycle"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", confirmName: values.confirmName }) });
      toast("删除命令已提交，Agent 数据暂时保留到服务器确认", "success");
      setTimeout(() => location.reload(), 900);
    });
  }

  function noteBody(note) {
    let text = String(note.markdown || "");
    text = text.replace(/^---\n[\s\S]*?\n---\n+/, "");
    text = text.replace(/^# .+\n+/, "");
    text = text.replace(/\n+## 关联\n[\s\S]*$/, "");
    return text.trim();
  }

  function download(name, data, type = "text/markdown;charset=utf-8") {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([data], { type }));
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function renderMemory() {
    const result = await bridge.request(agentApi("/memory-notes"));
    const notes = result.notes || [];
    const projection = result.projection || { memory: { charCount: 0, limit: 2200, notes: 0 }, user: { charCount: 0, limit: 1375, notes: 0 }, excluded: 0 };
    const kindLabels = { knowledge: "知识", fact: "事实", preference: "偏好", constraint: "约束", procedure: "流程", person: "人物", project: "项目", event: "事件" };
    const targetLabels = { auto: "自动分配", memory: "MEMORY.md", user: "USER.md", none: "仅 Obsidian" };
    const syncLabels = { pending: "待同步", materialized: "已进入 Hermes", excluded: "容量外", conflict: "有冲突", failed: "同步失败" };
    const capacity = (target, label) => { const value = projection[target] || {}; const percent = Math.min(100, Math.round((Number(value.charCount) || 0) / Math.max(1, Number(value.limit) || 1) * 100)); return `<section class="bw-memory-meter"><header><div><strong>${label}</strong><span>${value.notes || 0} 条活跃记忆</span></div><b>${value.charCount || 0} / ${value.limit || 0}</b></header><div><i style="width:${percent}%"></i></div></section>`; };
    content.innerHTML = `<div class="bw-memory-summary">${capacity("memory", "Hermes MEMORY.md")}${capacity("user", "Hermes USER.md")}<section class="bw-memory-sync"><strong>Obsidian 主记忆库</strong><span>${notes.length} 篇 · ${projection.excluded || 0} 篇未进入 Hermes 活跃上下文</span><button type="button" data-sync>同步 Hermes</button></section></div><div class="bw-toolbar"><input type="search" placeholder="搜索标题和正文"><div class="bw-actions"><button type="button" data-import>导入 .md</button><button type="button" data-export>导出全部</button><button type="button" class="primary" data-new>＋ 新记忆</button></div></div><input type="file" accept=".md,text/markdown" multiple hidden data-files><div class="bw-list" data-list></div>`;
    const list = content.querySelector("[data-list]");
    const draw = (items) => { list.innerHTML = items.length ? items.map((note) => `<article class="bw-row bw-memory-row"><div><div class="bw-memory-title"><strong>${escapeHtml(note.title)}</strong><span class="bw-memory-kind">${kindLabels[note.memoryKind] || note.memoryKind}</span><span class="bw-memory-importance">重要度 ${note.importance || 3}</span></div><span>${escapeHtml((note.frontmatter?.tags || []).join(" · "))}${note.frontmatter?.tags?.length ? " · " : ""}${targetLabels[note.hermesTarget] || note.hermesTarget} · ${formatTime(note.updatedAt)}</span><p>${escapeHtml(noteBody(note).slice(0, 180))}</p></div><div class="bw-actions">${status(note.hermesSyncStatus || "pending", syncLabels[note.hermesSyncStatus] || note.hermesSyncStatus)}<button type="button" data-edit="${note.id}">编辑</button><button type="button" data-download="${note.id}" title="导出">↓</button><button type="button" data-delete="${note.id}" class="danger-icon" title="删除">×</button></div></article>`).join("") : '<div class="bw-empty">还没有记忆笔记</div>'; };
    draw(notes);
    content.querySelector("input[type=search]").addEventListener("input", async (event) => { const data = await bridge.request(agentApi(`/memory-notes?query=${encodeURIComponent(event.target.value)}`)); draw(data.notes || []); });
    const editNote = async (note) => {
      const values = await openForm({ heading: note ? "编辑记忆" : "新建记忆", fields: [{ name: "title", label: "标题", value: note?.title || "", required: true, maxLength: 200 }, { name: "memoryKind", label: "记忆类型", type: "select", value: note?.memoryKind || "knowledge", options: (result.memoryKinds || Object.keys(kindLabels)).map((value) => ({ value, label: kindLabels[value] || value })) }, { name: "importance", label: "重要度", type: "select", value: String(note?.importance || 3), options: [1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} - ${{ 1: "低", 2: "一般", 3: "常用", 4: "重要", 5: "关键" }[value]}` })) }, { name: "hermesTarget", label: "Hermes 活跃记忆", type: "select", value: note?.hermesTarget || "auto", options: (result.hermesTargets || Object.keys(targetLabels)).map((value) => ({ value, label: targetLabels[value] || value })) }, { name: "tags", label: "标签（逗号分隔）", value: (note?.frontmatter?.tags || []).join(",") }, { name: "body", label: "Markdown 正文", type: "textarea", value: note ? noteBody(note) : "", required: true, rows: 14 }] });
      if (!values) return;
      const payload = { title: values.title, body: values.body, memoryKind: values.memoryKind, importance: Number(values.importance), hermesTarget: values.hermesTarget, tags: values.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean) };
      const saved = await bridge.request(agentApi(`/memory-notes${note ? `/${encodeURIComponent(note.id)}` : ""}`), { method: note ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      toast(saved.sync?.status === "materialized" ? "记忆已保存并同步到 Hermes" : "记忆已保存，将在 Runtime 可用后同步", saved.sync?.status === "materialized" ? "success" : "info");
      renderMemory();
    };
    content.querySelector("[data-sync]").addEventListener("click", async (event) => { event.currentTarget.disabled = true; try { const synced = await bridge.request(agentApi("/memory-sync"), { method: "POST" }); toast(synced.status === "conflict" ? `同步完成，${synced.conflicts.length} 篇需要确认` : `已同步 ${synced.memory.notes + synced.user.notes} 条活跃记忆`, synced.status === "conflict" ? "info" : "success"); renderMemory(); } catch (error) { toast(error.message, "error"); event.currentTarget.disabled = false; } });
    content.querySelector("[data-new]").addEventListener("click", () => editNote(null));
    list.addEventListener("click", async (event) => {
      const button = event.target.closest("button"); if (!button) return;
      const id = button.dataset.edit || button.dataset.download || button.dataset.delete;
      const note = notes.find((item) => item.id === id);
      if (button.dataset.edit) return editNote(note);
      if (button.dataset.download) return download(`${note.slug || "note"}.md`, note.markdown);
      if (button.dataset.delete && await openForm({ heading: "删除记忆", submitLabel: "确认删除", danger: true, fields: [] })) { await bridge.request(agentApi(`/memory-notes/${encodeURIComponent(id)}`), { method: "DELETE" }); renderMemory(); }
    });
    const fileInput = content.querySelector("[data-files]");
    content.querySelector("[data-import]").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      for (const file of fileInput.files) {
        const markdown = await file.text();
        const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || file.name.replace(/\.md$/i, "");
        await bridge.request(agentApi("/memory-notes"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: heading, body: noteBody({ markdown }), memoryKind: "knowledge", importance: 3, hermesTarget: "auto" }) });
      }
      toast("Markdown 已导入", "success"); renderMemory();
    });
    content.querySelector("[data-export]").addEventListener("click", () => download(`${activeAgent().name}-obsidian-export.md`, notes.map((note) => note.markdown).join("\n\n---\n\n")));
  }

  async function renderSkills() {
    const result = await bridge.request(agentApi("/skills"));
    const skills = normalizeList(result.discovery?.data, ["skills"]);
    const preferences = new Map((result.preferences || []).map((item) => [item.skillId, item]));
    content.innerHTML = `<div class="bw-section-head"><div><h3>Hermes 技能</h3><p>${result.discovery?.status === "available" ? "来自当前 Agent Runtime" : "Runtime 不可用，显示已保存偏好"}</p></div>${status(result.discovery?.status)}</div><div class="bw-list">${skills.length ? skills.map((skill) => { const id = typeof skill === "string" ? skill : skill.id || skill.name; const pref = preferences.get(id); return `<article class="bw-row"><div><strong>${escapeHtml(typeof skill === "string" ? skill : skill.name || id)}</strong><span>${escapeHtml(skill.description || id)}</span></div><label class="bw-toggle"><input type="checkbox" data-skill="${escapeHtml(id)}" ${pref?.enabled ? "checked" : ""}><span></span></label>${pref ? status(pref.applyStatus) : ""}</article>`; }).join("") : '<div class="bw-empty">Runtime 暂未返回可用技能</div>'}</div>`;
    content.querySelectorAll("[data-skill]").forEach((input) => input.addEventListener("change", async () => { const data = await bridge.request(agentApi(`/skills/${encodeURIComponent(input.dataset.skill)}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: input.checked }) }); toast(data.preference.applyStatus === "pending" ? "偏好已保存，等待配置适配器应用" : "技能状态已更新"); renderSkills(); }));
  }

  async function renderChannels() {
    const result = await bridge.request(agentApi("/channels"));
    content.innerHTML = `<div class="bw-section-head"><div><h3>渠道连接</h3><p>非 Web 渠道只有收到适配器回执后才会显示已连接</p></div></div><div class="bw-list">${result.channels.map(({ channel, binding }) => `<article class="bw-row"><div><strong>${escapeHtml(CHANNEL_LABELS[channel] || channel)}</strong><span>${escapeHtml(binding?.displayName || "未绑定")}${binding?.credentialMasked ? ` · ${escapeHtml(binding.credentialMasked)}` : ""}</span></div><div class="bw-actions">${status(binding?.status || "unconfigured")}<button type="button" data-bind="${channel}">${binding ? "更新" : "绑定"}</button>${binding && channel !== "web" ? `<button type="button" data-unbind="${channel}" class="danger-icon" title="解绑">×</button>` : ""}</div></article>`).join("")}</div>`;
    content.querySelectorAll("[data-bind]").forEach((button) => button.addEventListener("click", async () => {
      const channel = button.dataset.bind;
      const fields = [{ name: "displayName", label: "显示名称", value: CHANNEL_LABELS[channel] }];
      if (channel === "feishu") fields.push({ name: "appId", label: "App ID", required: true }, { name: "appSecret", label: "App Secret", type: "password", required: true }, { name: "verifyToken", label: "Verify Token", type: "password" });
      else if (channel === "wechat") fields.push({ name: "appId", label: "App ID", required: true }, { name: "appSecret", label: "App Secret", type: "password", required: true }, { name: "token", label: "Token", type: "password" });
      else if (channel === "qq") fields.push({ name: "appId", label: "App ID", required: true }, { name: "token", label: "Bot Token", type: "password", required: true });
      else if (channel === "cli") fields.push({ name: "label", label: "终端标识", value: "default" });
      const values = await openForm({ heading: `绑定${CHANNEL_LABELS[channel]}`, fields }); if (!values) return;
      const { displayName, ...credentials } = values;
      const data = await bridge.request(agentApi(`/channels/${channel}`), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName, credentials }) });
      toast(data.binding.status === "connected" ? "渠道已连接" : "配置已加密保存，等待渠道适配器确认"); renderChannels();
    }));
    content.querySelectorAll("[data-unbind]").forEach((button) => button.addEventListener("click", async () => { await bridge.request(agentApi(`/channels/${button.dataset.unbind}`), { method: "DELETE" }); toast("渠道已解绑"); renderChannels(); }));
  }

  async function renderHotspots() {
    const result = await bridge.request(agentApi("/hotspots"));
    content.innerHTML = `<div class="bw-section-head"><div><h3>实时热点</h3><p>${result.run ? `采集于 ${formatTime(result.run.completedAt)}` : "管理员尚未完成热点采集"}</p></div></div><div class="bw-hotspot-grid">${result.items.length ? result.items.map((item) => `<article class="bw-hotspot"><header><span>${escapeHtml(item.sourceName)}</span><strong>${item.rank || "--"}</strong></header><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.heat || item.category || "")}</p><footer><button type="button" data-bookmark="${item.id}" data-value="${item.bookmarked ? "0" : "1"}">${item.bookmarked ? "已收藏" : "收藏"}</button><button type="button" class="primary" data-analyze="${item.id}">交给 Agent</button>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">来源</a>` : ""}</footer></article>`).join("") : '<div class="bw-empty">暂无真实热点数据</div>'}</div>`;
    content.querySelectorAll("[data-bookmark]").forEach((button) => button.addEventListener("click", async () => { await bridge.request(agentApi(`/hotspots/${button.dataset.bookmark}/bookmark`), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookmarked: button.dataset.value === "1" }) }); renderHotspots(); }));
    content.querySelectorAll("[data-analyze]").forEach((button) => button.addEventListener("click", () => { const item = result.items.find((entry) => entry.id === button.dataset.analyze); bridge.prefillChat(`请分析这个热点，说明事实来源、背景、可信度和可能影响：${item.title}\n${item.url || ""}`); closeWorkspace(); }));
  }

  async function streamRun(runId, log, approval) {
    workspaceState.runStream?.abort();
    const controller = new AbortController();
    workspaceState.runStream = controller;
    const response = await fetch(agentApi(`/runs/${encodeURIComponent(runId)}/events`), { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error("run_stream_unavailable");
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let terminalEvent = false;
    while (true) {
      const { done, value } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const blocks = buffer.replaceAll("\r\n", "\n").split("\n\n"); buffer = blocks.pop() || "";
      for (const block of blocks) {
        const line = block.split("\n").find((item) => item.startsWith("data:")); if (!line) continue;
        const event = JSON.parse(line.slice(5));
        const row = document.createElement("div"); row.className = "bw-run-event"; row.textContent = `${event.event || "event"} ${event.tool || event.text || event.delta || event.error || event.output || ""}`; log.appendChild(row); log.scrollTop = log.scrollHeight;
        if (event.event === "approval.request") {
          approval.hidden = false;
          approval.querySelector("p").textContent = event.command || event.prompt || "Hermes 请求执行受保护操作";
        }
        if (["run.completed", "run.failed", "run.cancelled"].includes(event.event)) { approval.hidden = true; workspaceState.runStream = null; terminalEvent = true; }
      }
      if (done) break;
    }
    if (terminalEvent) await bridge.request(agentApi(`/runs/${encodeURIComponent(runId)}`)).catch(() => null);
  }

  async function renderRuns() {
    const result = await bridge.request(agentApi("/runs?limit=50"));
    const runs = normalizeList(result, ["runs"]);
    if (!runs.some((item) => item.id === workspaceState.runId)) workspaceState.runId = runs[0]?.id || null;
    const selected = runs.find((item) => item.id === workspaceState.runId) || null;
    const terminal = selected && ["completed", "failed", "cancelled"].includes(selected.status);
    content.innerHTML = `<div class="bw-section-head"><div><h3>结构化运行</h3><p>长任务由 Hermes 执行，历史记录保存在当前用户的 Agent 空间</p></div><button type="button" class="primary" data-start>＋ 新运行</button></div><div class="bw-run-console"><div class="bw-run-state">${selected ? `${escapeHtml(selected.id)} · ${escapeHtml(STATUS_LABELS[selected.status] || selected.status)}` : "尚未启动运行"}</div><div class="bw-run-log" data-log></div><section class="bw-approval" data-approval hidden><h4>等待你的审批</h4><p></p><div>${["once", "session", "always", "deny"].map((choice) => `<button type="button" data-choice="${choice}" class="${choice === "deny" ? "danger" : ""}">${{ once: "仅本次", session: "本次运行", always: "始终允许", deny: "拒绝" }[choice]}</button>`).join("")}</div></section><div class="bw-actions"><button type="button" data-stop ${selected && !terminal ? "" : "disabled"}>停止运行</button><button type="button" data-refresh ${selected ? "" : "disabled"}>刷新状态</button></div></div><div class="bw-section-head"><h3>运行历史</h3><span>${runs.length} 条</span></div><div class="bw-list">${runs.length ? runs.map((run) => `<article class="bw-row ${run.id === workspaceState.runId ? "selected" : ""}"><div><strong>${escapeHtml(run.inputPreview || "未命名任务")}</strong><span>${formatTime(run.createdAt)}${run.model ? ` · ${escapeHtml(run.model)}` : ""}</span>${run.lastError ? `<p>${escapeHtml(run.lastError)}</p>` : ""}</div><div class="bw-actions">${status(run.status)}<button type="button" data-select-run="${escapeHtml(run.id)}">查看</button>${["completed", "failed", "cancelled"].includes(run.status) ? `<button type="button" data-retry-run="${escapeHtml(run.id)}">${run.status === "failed" ? "重试" : "再次运行"}</button>` : ""}</div></article>`).join("") : '<div class="bw-empty">还没有运行记录</div>'}</div>`;
    const log = content.querySelector("[data-log]"); const approval = content.querySelector("[data-approval]");
    const followRun = async (runId) => { await renderRuns(); streamRun(runId, content.querySelector("[data-log]"), content.querySelector("[data-approval]")).then(() => renderRuns()).catch((error) => toast(error.message, "error")); };
    content.querySelector("[data-start]").addEventListener("click", async () => { const values = await openForm({ heading: "创建运行", fields: [{ name: "input", label: "任务内容", type: "textarea", rows: 10, required: true }] }); if (!values) return; const run = await bridge.request(agentApi("/runs"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) }); workspaceState.runId = run.run_id; followRun(run.run_id); });
    content.querySelectorAll("[data-choice]").forEach((button) => button.addEventListener("click", async () => { await bridge.request(agentApi(`/runs/${encodeURIComponent(workspaceState.runId)}/approval`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ choice: button.dataset.choice }) }); approval.hidden = true; toast("审批已提交"); }));
    content.querySelector("[data-stop]").addEventListener("click", async () => { await bridge.request(agentApi(`/runs/${encodeURIComponent(workspaceState.runId)}/stop`), { method: "POST" }); workspaceState.runStream?.abort(); toast("停止请求已提交"); });
    content.querySelector("[data-refresh]").addEventListener("click", async () => { await bridge.request(agentApi(`/runs/${encodeURIComponent(workspaceState.runId)}`)); renderRuns(); });
    content.querySelectorAll("[data-select-run]").forEach((button) => button.addEventListener("click", () => { workspaceState.runId = button.dataset.selectRun; renderRuns(); }));
    content.querySelectorAll("[data-retry-run]").forEach((button) => button.addEventListener("click", async () => { const run = await bridge.request(agentApi(`/runs/${encodeURIComponent(button.dataset.retryRun)}/retry`), { method: "POST" }); workspaceState.runId = run.run_id; followRun(run.run_id); }));
  }

  async function renderJobs() {
    const result = await bridge.request(agentApi("/jobs?include_disabled=true"));
    const jobs = normalizeList(result, ["jobs"]);
    content.innerHTML = `<div class="bw-section-head"><div><h3>Hermes 定时任务</h3><p>显示 Hermes 返回的真实计划、最近结果和下次执行时间</p></div><button type="button" class="primary" data-new>＋ 新任务</button></div><div class="bw-list">${jobs.length ? jobs.map((job) => `<article class="bw-row"><div><strong>${escapeHtml(job.name || job.id)}</strong><span>${escapeHtml(job.schedule_display || job.schedule?.display || job.schedule?.expr || job.schedule || "")}${job.next_run_at ? ` · 下次 ${formatTime(job.next_run_at)}` : ""}</span><p>${escapeHtml(job.prompt || "")}</p>${job.last_run_at ? `<p>上次 ${formatTime(job.last_run_at)} · ${escapeHtml(STATUS_LABELS[job.last_status] || job.last_status || "未知")}${job.last_error ? ` · ${escapeHtml(job.last_error)}` : ""}</p>` : ""}</div><div class="bw-actions">${status(job.last_status === "error" ? "failed" : job.enabled === false ? "disabled" : job.state || "ready")}<button type="button" data-run="${job.id}">${job.last_status === "error" ? "重试" : "运行"}</button><button type="button" data-toggle="${job.id}" data-enabled="${job.enabled !== false ? "1" : "0"}">${job.enabled === false ? "恢复" : "暂停"}</button><button type="button" data-delete="${job.id}" class="danger-icon">×</button></div></article>`).join("") : '<div class="bw-empty">还没有定时任务</div>'}</div>`;
    content.querySelector("[data-new]").addEventListener("click", async () => { const values = await openForm({ heading: "新建定时任务", fields: [{ name: "name", label: "名称", required: true }, { name: "schedule", label: "执行计划", placeholder: "例如 every day at 09:00 或 0 9 * * *", required: true }, { name: "prompt", label: "任务内容", type: "textarea", rows: 8, required: true }] }); if (!values) return; await bridge.request(agentApi("/jobs"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, deliver: "local" }) }); toast("任务已创建", "success"); renderJobs(); });
    content.querySelectorAll("[data-run]").forEach((button) => button.addEventListener("click", async () => { await bridge.request(agentApi(`/jobs/${encodeURIComponent(button.dataset.run)}/run`), { method: "POST" }); toast("任务已触发"); }));
    content.querySelectorAll("[data-toggle]").forEach((button) => button.addEventListener("click", async () => { const action = button.dataset.enabled === "1" ? "pause" : "resume"; await bridge.request(agentApi(`/jobs/${encodeURIComponent(button.dataset.toggle)}/${action}`), { method: "POST" }); renderJobs(); }));
    content.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", async () => { if (!await openForm({ heading: "删除定时任务", submitLabel: "确认删除", danger: true, fields: [] })) return; await bridge.request(agentApi(`/jobs/${encodeURIComponent(button.dataset.delete)}`), { method: "DELETE" }); renderJobs(); }));
  }

  async function renderUsage() {
    const result = await bridge.request(agentApi("/usage")); const summary = result.summary;
    const latency = summary.runCount ? Math.round(summary.latencySumMs / summary.runCount) : 0;
    content.innerHTML = `<div class="bw-metrics"><div><span>输入 Token</span><strong>${summary.inputTokens.toLocaleString()}</strong></div><div><span>输出 Token</span><strong>${summary.outputTokens.toLocaleString()}</strong></div><div><span>运行次数</span><strong>${summary.runCount.toLocaleString()}</strong></div><div><span>失败次数</span><strong>${summary.failedRunCount.toLocaleString()}</strong></div><div><span>估算费用</span><strong>$${summary.estimatedCostUsd.toFixed(4)}</strong></div><div><span>平均延迟</span><strong>${latency} ms</strong></div></div><div class="bw-table"><table><thead><tr><th>时间</th><th>模型</th><th>输入</th><th>输出</th><th>运行</th><th>费用</th></tr></thead><tbody>${result.rollups.map((item) => `<tr><td>${formatTime(item.bucketStart)}</td><td>${escapeHtml(item.model)}</td><td>${item.inputTokens}</td><td>${item.outputTokens}</td><td>${item.runCount}</td><td>$${item.estimatedCostUsd.toFixed(4)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  async function renderSettings() {
    const [agentResult, discovery, authorizationResult] = await Promise.all([bridge.request(agentApi()), bridge.request(agentApi("/runtime/discovery")).catch(() => ({ discovery: {} })), bridge.request(agentApi("/authorizations"))]);
    const agent = agentResult.agent;
    const discoveredModels = normalizeList(discovery.discovery?.["discovery.models"]?.data, ["models"]).map((item) => typeof item === "string" ? item : item.id || item.name || item.model).filter(Boolean);
    const modelIds = (discovery.policy?.allowedModels || []).filter((id) => discoveredModels.includes(id));
    const authorizations = authorizationResult.authorizations || [];
    const enabledServices = (authorizationResult.services || []).filter((item) => item.enabled);
    const serviceLabels = Object.fromEntries((authorizationResult.services || []).map((item) => [item.id, item.name]));
    content.innerHTML = `<div class="bw-split"><section><h3>Agent 设置</h3><form class="bw-form" data-agent-form><label>名称<input name="name" value="${escapeHtml(agent.name)}" required maxlength="64"></label><label>描述<textarea name="description" rows="4" maxlength="500">${escapeHtml(agent.description || "")}</textarea></label><label>身份与原则<textarea name="soulMarkdown" rows="12" maxlength="50000">${escapeHtml(agent.soulMarkdown || "")}</textarea></label><button type="submit" class="primary">保存 Agent 设置</button></form></section><section><h3>模型与偏好</h3><form class="bw-form" data-pref-form><label>模型<select name="preferredModel"><option value="">管理员默认模型</option>${modelIds.map((id) => `<option value="${escapeHtml(id)}" ${agent.settings?.preferredModel === id ? "selected" : ""}>${escapeHtml(id)}</option>`).join("")}</select></label><label>语言<select name="locale"><option value="zh-CN" ${agent.settings?.locale !== "en-US" ? "selected" : ""}>简体中文</option><option value="en-US" ${agent.settings?.locale === "en-US" ? "selected" : ""}>English</option></select></label><label class="bw-check"><input type="checkbox" name="notifications" ${agent.settings?.notifications !== false ? "checked" : ""}>启用运行通知</label><button type="submit" class="primary">保存偏好</button></form><div class="bw-security-note"><strong>凭证边界</strong><p>Hermes API key、Runtime 签名密钥和平台 Provider key 不会进入浏览器。个人第三方凭证只以加密密文保存，并由当前 Agent 的 Runtime 身份按需读取。</p></div></section></div><section class="bw-authorizations"><div class="bw-section-head"><div><h3>第三方授权</h3><p>Firecrawl、搜索、语音、文档和管理员允许的个人模型 Provider</p></div><button type="button" class="primary" data-auth-new ${enabledServices.length ? "" : "disabled"}>＋ 添加授权</button></div><div class="bw-list">${authorizations.length ? authorizations.map((item) => `<article class="bw-row"><div><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(serviceLabels[item.service] || item.service)} · ${escapeHtml(item.authType)}${item.endpointUrl ? ` · ${escapeHtml(item.endpointUrl)}` : ""}</span></div><div class="bw-actions">${status(item.status)}<span>${escapeHtml(item.credentialMasked || "凭证已清除")}</span>${item.status !== "revoked" ? `<button type="button" class="danger-icon" data-auth-revoke="${escapeHtml(item.id)}" title="吊销">×</button>` : ""}</div></article>`).join("") : '<div class="bw-empty">还没有个人第三方授权</div>'}</div></section>`;
    content.querySelector("[data-agent-form]").addEventListener("submit", async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); await bridge.request(agentApi(), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(values) }); toast("Agent 设置已保存", "success"); });
    content.querySelector("[data-pref-form]").addEventListener("submit", async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); values.notifications = event.target.elements.notifications.checked; await bridge.request(agentApi(), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: values }) }); toast("偏好已保存", "success"); });
    content.querySelector("[data-auth-new]")?.addEventListener("click", async () => {
      const values = await openForm({ heading: "添加第三方授权", fields: [{ name: "service", label: "服务", type: "select", options: enabledServices.map((item) => ({ value: item.id, label: `${item.name} - ${item.purpose}` })) }, { name: "label", label: "名称", required: true, maxLength: 100 }, { name: "authType", label: "认证类型", type: "select", options: [{ value: "api_key", label: "API Key" }, { value: "bearer_token", label: "Bearer Token" }] }, { name: "endpointUrl", label: "HTTPS 接口地址（可选）", type: "url" }, { name: "provider", label: "Provider（可选）", maxLength: 200 }, { name: "model", label: "模型（可选）", maxLength: 200 }, { name: "secret", label: "密钥或 Token", type: "password", required: true, maxLength: 64000 }] });
      if (!values) return;
      await bridge.request(agentApi("/authorizations"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ service: values.service, label: values.label, authType: values.authType, endpointUrl: values.endpointUrl, secret: values.secret, metadata: { provider: values.provider, model: values.model } }) });
      toast("授权已加密保存", "success"); renderSettings();
    });
    content.querySelectorAll("[data-auth-revoke]").forEach((button) => button.addEventListener("click", async () => {
      if (!await openForm({ heading: "吊销第三方授权", submitLabel: "确认吊销", danger: true, fields: [] })) return;
      await bridge.request(agentApi(`/authorizations/${encodeURIComponent(button.dataset.authRevoke)}`), { method: "DELETE" });
      toast("授权已吊销，密钥密文已清除"); renderSettings();
    }));
  }

  function mount() {
    root = document.createElement("section"); root.className = "bairui-workspace"; root.hidden = true;
    root.innerHTML = `<aside class="bw-nav"><header><img src="/assets/bairui-agent-icon.png" alt=""><strong>bairui-agent</strong></header><nav>${NAV.map(([key, label]) => `<button type="button" data-view="${key}">${escapeHtml(label)}</button>`).join("")}</nav></aside><main><header class="bw-header"><div><span>${escapeHtml(activeAgent()?.name || "Agent")}</span><h1></h1></div><button type="button" data-close title="关闭工作区" aria-label="关闭工作区">×</button></header><div class="bw-content"></div></main>`;
    document.body.appendChild(root); content = root.querySelector(".bw-content"); title = root.querySelector("h1");
    root.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => render(button.dataset.view)));
    root.querySelector("[data-close]").addEventListener("click", closeWorkspace);
    window.addEventListener("bairui:workspace-open", () => openWorkspace());
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !root.hidden && !document.querySelector("dialog[open]")) closeWorkspace(); });
  }

  window.addEventListener("DOMContentLoaded", mount, { once: true });
})();
