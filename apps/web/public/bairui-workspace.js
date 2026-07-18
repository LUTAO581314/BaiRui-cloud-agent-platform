(function () {
  const bridge = window.bairuiPlatform;
  if (!bridge) return;

  const NAV = [
    ["chat", "??"], ["conversations", "??"], ["agents", "Agent"], ["memory", "??"],
    ["skills", "??"], ["channels", "??"], ["hotspots", "??"], ["runs", "??"],
    ["jobs", "??"], ["usage", "??"], ["hermes", "????"], ["settings", "??"]
  ];
  const CHANNEL_LABELS = { web: "??", cli: "CLI", feishu: "??", wechat: "??", qq: "QQ" };
  const STATUS_LABELS = {
    ready: "??", active: "??", connected: "???", applied: "???", pending: "???",
    provisioning: "????", starting: "???", suspended: "???", stopped: "???",
    initializing: "????", uninitialized: "????", offline: "Runtime ??", upgrading: "???",
    model_unconfigured: "?????", quota_exhausted: "?????", deleting: "???", deleted: "???",
    failed: "??", degraded: "??", unavailable: "???", unconfigured: "???", disabled: "???", unknown: "??"
  };
  Object.assign(STATUS_LABELS, {
    started: "???", queued: "???", running: "???", waiting_for_approval: "????",
    stopping: "???", completed: "???", cancelled: "???", scheduled: "???",
    paused: "???", ok: "??", error: "??", stored: "?????", revoked: "???"
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
      runtime_unavailable: "Agent Runtime ?????",
      runtime_route_unavailable: "Agent ??????????",
      model_not_allowed: "?????????????",
      model_not_configured: "???????????",
      quota_exhausted: "?????????",
      runtime_offline: "Agent Runtime ???",
      agent_not_ready: "Agent ??????",
      Forbidden: "??????????????",
      agent_not_initialized: "Agent ?????",
      no_agent_capacity: "???????????",
      memory_projection_unavailable: "?? Runtime ?????? Hermes ????",
      memory_projection_conflict: "Hermes ?????????????????"
    };
    content.innerHTML = `<div class="bw-empty bw-error"><strong>????</strong><p>${escapeHtml(labels[error.message] || error.message || "????")}</p><button type="button" data-retry>??</button></div>`;
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

  function openForm({ heading, submitLabel = "??", fields = [], danger = false }) {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "bw-dialog";
      const form = document.createElement("form");
      form.method = "dialog";
      form.innerHTML = `<header><h2>${escapeHtml(heading)}</h2><button type="button" data-close aria-label="??" title="??">?</button></header><div class="bw-dialog-fields"></div><footer><button type="button" data-cancel>??</button><button type="submit" class="${danger ? "danger" : "primary"}">${escapeHtml(submitLabel)}</button></footer>`;
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
    title.textContent = NAV.find(([key]) => key === view)?.[1] || "???";
    content.innerHTML = '<div class="bw-loading"><span></span>????????</div>';
    try {
      const renderer = { conversations: renderConversations, agents: renderAgents, memory: renderMemory, skills: renderSkills, channels: renderChannels, hotspots: renderHotspots, runs: renderRuns, jobs: renderJobs, usage: renderUsage, hermes: renderHermes, settings: renderSettings }[view];
      if (renderer) await renderer();
    } catch (error) { showError(error); }
  }

  async function renderConversations() {
    const sessions = await bridge.listSessions();
    content.innerHTML = `<div class="bw-toolbar"><input type="search" placeholder="????" aria-label="????"><button type="button" class="primary" data-new>? ???</button></div><div class="bw-list" data-list></div>`;
    const list = content.querySelector("[data-list]");
    const draw = (query = "") => {
      const visible = sessions.filter((item) => String(item.title || "???").toLowerCase().includes(query.toLowerCase()));
      list.innerHTML = visible.length ? visible.map((item) => `<article class="bw-row ${item.id === bridge.state.activeSessionId ? "selected" : ""}"><div><strong>${escapeHtml(item.title || "???")}</strong><span>${formatTime(item.updated_at || item.created_at)}</span></div><div class="bw-actions"><button type="button" data-open="${escapeHtml(item.id)}">??</button><button type="button" data-rename="${escapeHtml(item.id)}" title="???">?</button><button type="button" data-fork="${escapeHtml(item.id)}">??</button><button type="button" data-delete="${escapeHtml(item.id)}" class="danger-icon" title="??">?</button></div></article>`).join("") : '<div class="bw-empty">???????</div>';
    };
    draw();
    content.querySelector("input").addEventListener("input", (event) => draw(event.target.value));
    content.querySelector("[data-new]").addEventListener("click", async () => { await bridge.createSession("???"); location.reload(); });
    list.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.open) return bridge.activateSession(button.dataset.open);
      const id = button.dataset.rename || button.dataset.fork || button.dataset.delete;
      const current = sessions.find((item) => item.id === id);
      if (button.dataset.rename) {
        const values = await openForm({ heading: "?????", fields: [{ name: "title", label: "??", value: current?.title || "", required: true, maxLength: 200 }] });
        if (values) await bridge.request(`${agentApi(`/sessions/${encodeURIComponent(id)}`)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      } else if (button.dataset.fork) {
        await bridge.request(agentApi(`/sessions/${encodeURIComponent(id)}/fork`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: `${current?.title || "??"} ??` }) });
      } else if (button.dataset.delete) {
        const values = await openForm({ heading: "????", submitLabel: "????", danger: true, fields: [] });
        if (values) await bridge.request(agentApi(`/sessions/${encodeURIComponent(id)}`), { method: "DELETE" });
      }
      renderConversations();
    });
  }

  async function renderAgents() {
    const result = await bridge.request("/api/user/agents");
    bridge.state.agents = result.agents || [];
    const agent = bridge.state.agents.find((item) => item.id === activeAgent().id) || activeAgent();
    content.innerHTML = `<div class="bw-split"><section><div class="bw-section-head"><h3>?? Agent</h3><button type="button" class="primary" data-create>? ??</button></div><div class="bw-list">${bridge.state.agents.map((item) => `<article class="bw-row ${item.id === agent.id ? "selected" : ""}"><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.description || "?????")}</span></div><div>${status(item.operational?.code || item.runtime?.effectiveStatus || item.runtime?.status || item.initializationStatus)}<button type="button" data-switch="${escapeHtml(item.id)}">??</button></div></article>`).join("")}</div></section><section><h3>?? Agent</h3><dl class="bw-details"><div><dt>??</dt><dd>${escapeHtml(agent.name)}</dd></div><div><dt>??</dt><dd>${status(agent.operational?.code || "uninitialized")}</dd></div><div><dt>Runtime</dt><dd>${status(agent.runtime?.effectiveStatus || agent.runtime?.status || "uninitialized")}</dd></div><div><dt>Hermes</dt><dd>${escapeHtml(agent.runtime?.hermesVersion || "????")}</dd></div><div><dt>????</dt><dd>${formatTime(agent.runtime?.lastHeartbeatAt)}</dd></div><div><dt>?? Token</dt><dd>${Number(agent.operational?.quota?.dailyTokens || 0).toLocaleString()}</dd></div></dl><div class="bw-actions bw-actions-wide"><button type="button" data-edit>????</button>${["uninitialized", "failed"].includes(agent.operational?.code || agent.initializationStatus) ? '<button type="button" class="primary" data-init>???/??</button>' : ""}${agent.runtime?.status === "suspended" ? '<button type="button" class="primary" data-resume>??</button>' : '<button type="button" data-pause>??</button>'}<button type="button" class="danger" data-remove>?? Agent</button></div></section></div>`;
    content.querySelector("[data-create]").addEventListener("click", async () => { const created = await bridge.createAgentDialog(); bridge.activateAgent(created.id); });
    content.querySelectorAll("[data-switch]").forEach((button) => button.addEventListener("click", () => bridge.activateAgent(button.dataset.switch)));
    content.querySelector("[data-edit]").addEventListener("click", async () => {
      const values = await openForm({ heading: "?? Agent", fields: [{ name: "name", label: "??", value: agent.name, required: true, maxLength: 64 }, { name: "description", label: "??", type: "textarea", value: agent.description, maxLength: 500 }, { name: "soulMarkdown", label: "?????", type: "textarea", value: agent.soulMarkdown, rows: 10, maxLength: 50000 }] });
      if (values) { await bridge.request(agentApi(), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(values) }); toast("Agent ?????", "success"); renderAgents(); }
    });
    content.querySelector("[data-init]")?.addEventListener("click", async () => { if (await bridge.initializeAgent(agent)) { toast("????????"); renderAgents(); } });
    content.querySelector("[data-pause]")?.addEventListener("click", async () => { await bridge.request(agentApi("/lifecycle"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pause" }) }); toast("???????????????"); renderAgents(); });
    content.querySelector("[data-resume]")?.addEventListener("click", async () => { await bridge.request(agentApi("/lifecycle"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resume" }) }); toast("???????????????"); renderAgents(); });
    content.querySelector("[data-remove]").addEventListener("click", async () => {
      const values = await openForm({ heading: "?? Agent", submitLabel: "????", danger: true, fields: [{ name: "confirmName", label: `?? ${agent.name} ??`, required: true }] });
      if (!values) return;
      await bridge.request(agentApi("/lifecycle"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", confirmName: values.confirmName }) });
      toast("????????Agent ????????????", "success");
      setTimeout(() => location.reload(), 900);
    });
  }

  function noteBody(note) {
    let text = String(note.markdown || "");
    text = text.replace(/^---\n[\s\S]*?\n---\n+/, "");
    text = text.replace(/^# .+\n+/, "");
    text = text.replace(/\n+## ??\n[\s\S]*$/, "");
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
    const sync = result.sync || { status: "idle" };
    const kindLabels = { knowledge: "??", fact: "??", preference: "??", constraint: "??", procedure: "??", person: "??", project: "??", event: "??" };
    const targetLabels = { auto: "????", memory: "MEMORY.md", user: "USER.md", none: "? Obsidian" };
    const syncLabels = { pending: "???", materialized: "??? Hermes", excluded: "???", conflict: "???", failed: "????" };
    const jobLabels = { idle: "??", pending: "???", processing: "???", retry: "????", completed: "???", dead: "????" };
    const capacity = (target, label) => { const value = projection[target] || {}; const percent = Math.min(100, Math.round((Number(value.charCount) || 0) / Math.max(1, Number(value.limit) || 1) * 100)); return `<section class="bw-memory-meter"><header><div><strong>${label}</strong><span>${value.notes || 0} ?????</span></div><b>${value.charCount || 0} / ${value.limit || 0}</b></header><div><i style="width:${percent}%"></i></div></section>`; };
    content.innerHTML = `<div class="bw-memory-summary">${capacity("memory", "Hermes MEMORY.md")}${capacity("user", "Hermes USER.md")}<section class="bw-memory-sync"><strong>Obsidian ????</strong><span>${notes.length} ? ? ${projection.excluded || 0} ???? Hermes ????? ? ${jobLabels[sync.status] || sync.status}</span><button type="button" data-sync>?? Hermes</button></section></div><div class="bw-toolbar"><input type="search" placeholder="???????"><div class="bw-actions"><button type="button" data-import>?? .md</button><button type="button" data-export>????</button><button type="button" class="primary" data-new>? ???</button></div></div><input type="file" accept=".md,text/markdown" multiple hidden data-files><div class="bw-list" data-list></div>`;
    const list = content.querySelector("[data-list]");
    const draw = (items) => { list.innerHTML = items.length ? items.map((note) => `<article class="bw-row bw-memory-row"><div><div class="bw-memory-title"><strong>${escapeHtml(note.title)}</strong><span class="bw-memory-kind">${kindLabels[note.memoryKind] || note.memoryKind}</span><span class="bw-memory-importance">??? ${note.importance || 3}</span></div><span>${escapeHtml((note.frontmatter?.tags || []).join(" ? "))}${note.frontmatter?.tags?.length ? " ? " : ""}${targetLabels[note.hermesTarget] || note.hermesTarget} ? ${formatTime(note.updatedAt)}</span><p>${escapeHtml(noteBody(note).slice(0, 180))}</p></div><div class="bw-actions">${status(note.hermesSyncStatus || "pending", syncLabels[note.hermesSyncStatus] || note.hermesSyncStatus)}<button type="button" data-edit="${note.id}">??</button><button type="button" data-download="${note.id}" title="??">?</button><button type="button" data-delete="${note.id}" class="danger-icon" title="??">?</button></div></article>`).join("") : '<div class="bw-empty">???????</div>'; };
    draw(notes);
    content.querySelector("input[type=search]").addEventListener("input", async (event) => { const data = await bridge.request(agentApi(`/memory-notes?query=${encodeURIComponent(event.target.value)}`)); draw(data.notes || []); });
    const editNote = async (note) => {
      const values = await openForm({ heading: note ? "????" : "????", fields: [{ name: "title", label: "??", value: note?.title || "", required: true, maxLength: 200 }, { name: "memoryKind", label: "????", type: "select", value: note?.memoryKind || "knowledge", options: (result.memoryKinds || Object.keys(kindLabels)).map((value) => ({ value, label: kindLabels[value] || value })) }, { name: "importance", label: "???", type: "select", value: String(note?.importance || 3), options: [1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} - ${{ 1: "?", 2: "??", 3: "??", 4: "??", 5: "??" }[value]}` })) }, { name: "hermesTarget", label: "Hermes ????", type: "select", value: note?.hermesTarget || "auto", options: (result.hermesTargets || Object.keys(targetLabels)).map((value) => ({ value, label: targetLabels[value] || value })) }, { name: "tags", label: "????????", value: (note?.frontmatter?.tags || []).join(",") }, { name: "body", label: "Markdown ??", type: "textarea", value: note ? noteBody(note) : "", required: true, rows: 14 }] });
      if (!values) return;
      const payload = { title: values.title, body: values.body, memoryKind: values.memoryKind, importance: Number(values.importance), hermesTarget: values.hermesTarget, tags: values.tags.split(/[,?]/).map((item) => item.trim()).filter(Boolean) };
      const saved = await bridge.request(agentApi(`/memory-notes${note ? `/${encodeURIComponent(note.id)}` : ""}`), { method: note ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      toast("?????????????", "success");
      renderMemory();
    };
    content.querySelector("[data-sync]").addEventListener("click", async (event) => { event.currentTarget.disabled = true; try { await bridge.request(agentApi("/memory-sync"), { method: "POST" }); toast("?????????", "success"); setTimeout(renderMemory, 1200); } catch (error) { toast(error.message, "error"); event.currentTarget.disabled = false; } });
    content.querySelector("[data-new]").addEventListener("click", () => editNote(null));
    list.addEventListener("click", async (event) => {
      const button = event.target.closest("button"); if (!button) return;
      const id = button.dataset.edit || button.dataset.download || button.dataset.delete;
      const note = notes.find((item) => item.id === id);
      if (button.dataset.edit) return editNote(note);
      if (button.dataset.download) return download(`${note.slug || "note"}.md`, note.markdown);
      if (button.dataset.delete && await openForm({ heading: "????", submitLabel: "????", danger: true, fields: [] })) { await bridge.request(agentApi(`/memory-notes/${encodeURIComponent(id)}`), { method: "DELETE" }); renderMemory(); }
    });
    const fileInput = content.querySelector("[data-files]");
    content.querySelector("[data-import]").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      for (const file of fileInput.files) {
        const markdown = await file.text();
        const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || file.name.replace(/\.md$/i, "");
        await bridge.request(agentApi("/memory-notes"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: heading, body: noteBody({ markdown }), memoryKind: "knowledge", importance: 3, hermesTarget: "auto" }) });
      }
      toast("Markdown ???", "success"); renderMemory();
    });
    content.querySelector("[data-export]").addEventListener("click", () => download(`${activeAgent().name}-obsidian-export.md`, notes.map((note) => note.markdown).join("\n\n---\n\n")));
  }

  async function renderSkills() {
    const [result, runtime, authorizationResult] = await Promise.all([
      bridge.request(agentApi("/skills")),
      bridge.request(agentApi("/runtime/discovery")).catch((error) => ({ discovery: {}, error: error.message })),
      bridge.request(agentApi("/authorizations")).catch(() => ({ services: [], authorizations: [] }))
    ]);
    const skills = normalizeList(result.discovery?.data, ["skills"]);
    const preferences = new Map((result.preferences || []).map((item) => [item.skillId, item]));
    const discovery = runtime.discovery || {};
    const healthState = discovery["health.detailed"] || { status: "unavailable" };
    const health = healthState.data || {};
    const capabilityState = discovery["discovery.capabilities"] || { status: "unavailable" };
    const capabilities = capabilityState.data || {};
    const featureEntries = Object.entries(capabilities.features || {}).filter(([, value]) => typeof value === "boolean");
    const toolsetState = discovery["discovery.toolsets"] || { status: "unavailable" };
    const toolsets = normalizeList(toolsetState.data, ["toolsets"]);
    const authorizations = authorizationResult.authorizations || [];
    const serviceLabels = Object.fromEntries((authorizationResult.services || []).map((item) => [item.id, item.name]));
    const runtimeVersion = health.version || activeAgent().runtime?.hermesVersion || "unknown";
    content.innerHTML = `<div class="bw-runtime-summary"><div><span>Hermes</span><strong>${escapeHtml(runtimeVersion)}</strong></div><div><span>??</span>${status(healthState.status === "available" ? health.status || "ready" : "unavailable")}</div><div><span>Gateway</span><strong>${escapeHtml(health.gateway_state || "unknown")}</strong></div><div><span>?? Agent</span><strong>${Number(health.active_agents || 0)}</strong></div></div>
      <section class="bw-capability-section"><div class="bw-section-head"><div><h3>Runtime Capabilities</h3><p>??? Hermes /v1/capabilities ????</p></div>${status(capabilityState.status)}</div><div class="bw-capability-grid">${featureEntries.length ? featureEntries.map(([name, enabled]) => `<div><span>${escapeHtml(name.replaceAll("_", " "))}</span>${status(enabled ? "ready" : "disabled", enabled ? "??" : "???")}</div>`).join("") : '<div class="bw-empty">Runtime ????????</div>'}</div></section>
      <section class="bw-capability-section"><div class="bw-section-head"><div><h3>Hermes Toolsets</h3><p>?????????????????</p></div>${status(toolsetState.status)}</div><div class="bw-list">${toolsets.length ? toolsets.map((toolset) => `<article class="bw-row"><div><strong>${escapeHtml(toolset.label || toolset.name)}</strong><span>${escapeHtml(toolset.description || toolset.name)} ? ${Number(toolset.tools?.length || 0)} ???</span><p>${escapeHtml((toolset.tools || []).join(" ? "))}</p></div><div class="bw-actions">${status(toolset.enabled ? "ready" : "disabled", toolset.enabled ? "???" : "???")}${status(toolset.configured ? "configured" : "unconfigured", toolset.configured ? "???" : "???")}</div></article>`).join("") : '<div class="bw-empty">Runtime ???? Toolsets</div>'}</div></section>
      <section class="bw-capability-section"><div class="bw-section-head"><div><h3>Hermes ??</h3><p>${result.discovery?.status === "available" ? "???? Agent Runtime" : "Runtime ???????????"}</p></div>${status(result.discovery?.status)}</div><div class="bw-list">${skills.length ? skills.map((skill) => { const value = typeof skill === "string" ? { name: skill } : skill; const id = value.id || value.name; const pref = preferences.get(id); const enabled = pref ? pref.enabled : value.enabled !== false; return `<article class="bw-row"><div><strong>${escapeHtml(value.name || id)}</strong><span>${escapeHtml(value.description || id)} ? ${escapeHtml(value.category || "uncategorized")} ? ${escapeHtml(value.version || runtimeVersion)}</span></div><div class="bw-actions"><label class="bw-toggle"><input type="checkbox" data-skill="${escapeHtml(id)}" ${enabled ? "checked" : ""}><span></span></label>${pref ? status(pref.applyStatus) : status("ready", "Runtime ??")}</div></article>`; }).join("") : '<div class="bw-empty">Runtime ????????</div>'}</div></section>
      <section class="bw-capability-section"><div class="bw-section-head"><div><h3>????</h3><p>?? Agent ??????????????</p></div><span>${authorizations.length} ?</span></div><div class="bw-list">${authorizations.length ? authorizations.map((item) => `<article class="bw-row"><div><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(serviceLabels[item.service] || item.service)} ? ${escapeHtml(item.credentialMasked || "?????")}</span></div>${status(item.status)}</article>`).join("") : '<div class="bw-empty">?? Agent ????????</div>'}</div></section>`;
    content.querySelectorAll("[data-skill]").forEach((input) => input.addEventListener("change", async () => { const data = await bridge.request(agentApi(`/skills/${encodeURIComponent(input.dataset.skill)}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: input.checked }) }); toast(data.preference.applyStatus === "pending" ? "???????????????" : "???????"); renderSkills(); }));
  }

  async function renderChannels() {
    const result = await bridge.request(agentApi("/channels"));
    content.innerHTML = `<div class="bw-section-head"><div><h3>????</h3><p>? Web ???????????????????</p></div></div><div class="bw-list">${result.channels.map(({ channel, binding }) => `<article class="bw-row"><div><strong>${escapeHtml(CHANNEL_LABELS[channel] || channel)}</strong><span>${escapeHtml(binding?.displayName || "???")}${binding?.credentialMasked ? ` ? ${escapeHtml(binding.credentialMasked)}` : ""}${binding?.adapterVersion ? ` ? ${escapeHtml(binding.adapterVersion)}` : ""}${binding?.callbackPath ? `<br>${escapeHtml(new URL(binding.callbackPath, window.location.origin).toString())}` : ""}</span></div><div class="bw-actions">${status(binding?.status || "unconfigured")}<button type="button" data-bind="${channel}">${binding ? "??" : "??"}</button>${binding && channel !== "web" ? `<button type="button" data-unbind="${channel}" class="danger-icon" title="??">?</button>` : ""}</div></article>`).join("")}</div>`;
    content.querySelectorAll("[data-bind]").forEach((button) => button.addEventListener("click", async () => {
      const channel = button.dataset.bind;
      const fields = [{ name: "displayName", label: "????", value: CHANNEL_LABELS[channel] }];
      if (channel === "feishu") fields.push({ name: "appId", label: "App ID", required: true }, { name: "appSecret", label: "App Secret", type: "password", required: true }, { name: "verifyToken", label: "Verify Token", type: "password" });
      else if (channel === "wechat") fields.push({ name: "appId", label: "App ID", required: true }, { name: "appSecret", label: "App Secret", type: "password", required: true }, { name: "token", label: "Token", type: "password" });
      else if (channel === "qq") fields.push({ name: "appId", label: "App ID", required: true }, { name: "appSecret", label: "App Secret", type: "password", required: true });
      else if (channel === "cli") fields.push({ name: "label", label: "????", value: "default" });
      const values = await openForm({ heading: `??${CHANNEL_LABELS[channel]}`, fields }); if (!values) return;
      const { displayName, ...credentials } = values;
      const data = await bridge.request(agentApi(`/channels/${channel}`), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName, credentials }) });
      toast(data.binding.status === "connected" ? "?????" : "?????????????????"); renderChannels();
    }));
    content.querySelectorAll("[data-unbind]").forEach((button) => button.addEventListener("click", async () => { await bridge.request(agentApi(`/channels/${button.dataset.unbind}`), { method: "DELETE" }); toast("?????"); renderChannels(); }));
  }

  async function renderHotspots() {
    const result = await bridge.request(agentApi("/hotspots"));
    content.innerHTML = `<div class="bw-section-head"><div><h3>????</h3><p>${result.run ? `??? ${formatTime(result.run.completedAt)}` : "???????????"}</p></div></div><div class="bw-hotspot-grid">${result.items.length ? result.items.map((item) => `<article class="bw-hotspot"><header><span>${escapeHtml(item.sourceName)}</span><strong>${item.rank || "--"}</strong></header><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.heat || item.category || "")}</p><footer><button type="button" data-bookmark="${item.id}" data-value="${item.bookmarked ? "0" : "1"}">${item.bookmarked ? "???" : "??"}</button><button type="button" class="primary" data-analyze="${item.id}">?? Agent</button>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">??</a>` : ""}</footer></article>`).join("") : '<div class="bw-empty">????????</div>'}</div>`;
    content.querySelectorAll("[data-bookmark]").forEach((button) => button.addEventListener("click", async () => { await bridge.request(agentApi(`/hotspots/${button.dataset.bookmark}/bookmark`), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookmarked: button.dataset.value === "1" }) }); renderHotspots(); }));
    content.querySelectorAll("[data-analyze]").forEach((button) => button.addEventListener("click", () => { const item = result.items.find((entry) => entry.id === button.dataset.analyze); bridge.prefillChat(`???????????????????????????${item.title}\n${item.url || ""}`); closeWorkspace(); }));
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
          approval.querySelector("p").textContent = event.command || event.prompt || "Hermes ?????????";
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
    content.innerHTML = `<div class="bw-section-head"><div><h3>?????</h3><p>???? Hermes ??????????????? Agent ??</p></div><button type="button" class="primary" data-start>? ???</button></div><div class="bw-run-console"><div class="bw-run-state">${selected ? `${escapeHtml(selected.id)} ? ${escapeHtml(STATUS_LABELS[selected.status] || selected.status)}` : "??????"}</div><div class="bw-run-log" data-log></div><section class="bw-approval" data-approval hidden><h4>??????</h4><p></p><div>${["once", "session", "always", "deny"].map((choice) => `<button type="button" data-choice="${choice}" class="${choice === "deny" ? "danger" : ""}">${{ once: "???", session: "????", always: "????", deny: "??" }[choice]}</button>`).join("")}</div></section><div class="bw-actions"><button type="button" data-stop ${selected && !terminal ? "" : "disabled"}>????</button><button type="button" data-refresh ${selected ? "" : "disabled"}>????</button></div></div><div class="bw-section-head"><h3>????</h3><span>${runs.length} ?</span></div><div class="bw-list">${runs.length ? runs.map((run) => `<article class="bw-row ${run.id === workspaceState.runId ? "selected" : ""}"><div><strong>${escapeHtml(run.inputPreview || "?????")}</strong><span>${formatTime(run.createdAt)}${run.model ? ` ? ${escapeHtml(run.model)}` : ""}</span>${run.lastError ? `<p>${escapeHtml(run.lastError)}</p>` : ""}</div><div class="bw-actions">${status(run.status)}<button type="button" data-select-run="${escapeHtml(run.id)}">??</button>${["completed", "failed", "cancelled"].includes(run.status) ? `<button type="button" data-retry-run="${escapeHtml(run.id)}">${run.status === "failed" ? "??" : "????"}</button>` : ""}</div></article>`).join("") : '<div class="bw-empty">???????</div>'}</div>`;
    const log = content.querySelector("[data-log]"); const approval = content.querySelector("[data-approval]");
    const followRun = async (runId) => { await renderRuns(); streamRun(runId, content.querySelector("[data-log]"), content.querySelector("[data-approval]")).then(() => renderRuns()).catch((error) => toast(error.message, "error")); };
    content.querySelector("[data-start]").addEventListener("click", async () => { const values = await openForm({ heading: "????", fields: [{ name: "input", label: "????", type: "textarea", rows: 10, required: true }] }); if (!values) return; const run = await bridge.request(agentApi("/runs"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) }); workspaceState.runId = run.run_id; followRun(run.run_id); });
    content.querySelectorAll("[data-choice]").forEach((button) => button.addEventListener("click", async () => { await bridge.request(agentApi(`/runs/${encodeURIComponent(workspaceState.runId)}/approval`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ choice: button.dataset.choice }) }); approval.hidden = true; toast("?????"); }));
    content.querySelector("[data-stop]").addEventListener("click", async () => { await bridge.request(agentApi(`/runs/${encodeURIComponent(workspaceState.runId)}/stop`), { method: "POST" }); workspaceState.runStream?.abort(); toast("???????"); });
    content.querySelector("[data-refresh]").addEventListener("click", async () => { await bridge.request(agentApi(`/runs/${encodeURIComponent(workspaceState.runId)}`)); renderRuns(); });
    content.querySelectorAll("[data-select-run]").forEach((button) => button.addEventListener("click", () => { workspaceState.runId = button.dataset.selectRun; renderRuns(); }));
    content.querySelectorAll("[data-retry-run]").forEach((button) => button.addEventListener("click", async () => { const run = await bridge.request(agentApi(`/runs/${encodeURIComponent(button.dataset.retryRun)}/retry`), { method: "POST" }); workspaceState.runId = run.run_id; followRun(run.run_id); }));
  }

  async function renderJobs() {
    const result = await bridge.request(agentApi("/jobs?include_disabled=true"));
    const jobs = normalizeList(result, ["jobs"]);
    const jobFields = (job = {}) => { const schedule = typeof job.schedule === "string" ? job.schedule : job.schedule?.expr || job.schedule?.display || ""; return [{ name: "name", label: "??", value: job.name || "", required: true, maxLength: 200 }, { name: "schedule", label: "????", value: schedule, placeholder: "?? every day at 09:00 ? 0 9 * * *", required: true }, { name: "prompt", label: "????", type: "textarea", value: job.prompt || "", rows: 8, required: true, maxLength: 5000 }, { name: "repeat", label: "??????????????", type: "number", value: job.repeat || "" }, { name: "skills", label: "?????????????", value: Array.isArray(job.skills) ? job.skills.join(",") : job.skills || "" }]; };
    const jobPayload = (values, current = {}) => ({ name: values.name, schedule: values.schedule, prompt: values.prompt, deliver: current.deliver || "local", repeat: values.repeat ? Number(values.repeat) : null, skills: values.skills ? values.skills.split(/[,?]/).map((item) => item.trim()).filter(Boolean) : [] });
    content.innerHTML = `<div class="bw-section-head"><div><h3>Hermes ????</h3><p>?? Hermes ???????????????????</p></div><button type="button" class="primary" data-new>? ???</button></div><div class="bw-list">${jobs.length ? jobs.map((job) => `<article class="bw-row"><div><strong>${escapeHtml(job.name || job.id)}</strong><span>${escapeHtml(job.schedule_display || job.schedule?.display || job.schedule?.expr || job.schedule || "")}${job.next_run_at ? ` ? ?? ${formatTime(job.next_run_at)}` : ""}${job.repeat ? ` ? ?? ${job.repeat}` : ""}</span><p>${escapeHtml(job.prompt || "")}</p>${job.last_run_at ? `<p>?? ${formatTime(job.last_run_at)} ? ${escapeHtml(STATUS_LABELS[job.last_status] || job.last_status || "??")}${job.last_error ? ` ? ${escapeHtml(job.last_error)}` : ""}</p>` : ""}</div><div class="bw-actions">${status(job.last_status === "error" ? "failed" : job.enabled === false ? "disabled" : job.state || "ready")}<button type="button" data-edit-job="${job.id}">??</button><button type="button" data-run="${job.id}">${job.last_status === "error" ? "??" : "??"}</button><button type="button" data-toggle="${job.id}" data-enabled="${job.enabled !== false ? "1" : "0"}">${job.enabled === false ? "??" : "??"}</button><button type="button" data-delete="${job.id}" class="danger-icon" title="??">?</button></div></article>`).join("") : '<div class="bw-empty">???????</div>'}</div>`;
    content.querySelector("[data-new]").addEventListener("click", async () => { const values = await openForm({ heading: "??????", fields: jobFields() }); if (!values) return; await bridge.request(agentApi("/jobs"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(jobPayload(values)) }); toast("?????", "success"); renderJobs(); });
    content.querySelectorAll("[data-edit-job]").forEach((button) => button.addEventListener("click", async () => { const detail = await bridge.request(agentApi(`/jobs/${encodeURIComponent(button.dataset.editJob)}`)); const current = detail.job || detail; const values = await openForm({ heading: "??????", fields: jobFields(current) }); if (!values) return; await bridge.request(agentApi(`/jobs/${encodeURIComponent(button.dataset.editJob)}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(jobPayload(values, current)) }); toast("?????", "success"); renderJobs(); }));
    content.querySelectorAll("[data-run]").forEach((button) => button.addEventListener("click", async () => { await bridge.request(agentApi(`/jobs/${encodeURIComponent(button.dataset.run)}/run`), { method: "POST" }); toast("?????"); }));
    content.querySelectorAll("[data-toggle]").forEach((button) => button.addEventListener("click", async () => { const action = button.dataset.enabled === "1" ? "pause" : "resume"; await bridge.request(agentApi(`/jobs/${encodeURIComponent(button.dataset.toggle)}/${action}`), { method: "POST" }); renderJobs(); }));
    content.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", async () => { if (!await openForm({ heading: "??????", submitLabel: "????", danger: true, fields: [] })) return; await bridge.request(agentApi(`/jobs/${encodeURIComponent(button.dataset.delete)}`), { method: "DELETE" }); renderJobs(); }));
  }

  async function renderUsage() {
    const result = await bridge.request(agentApi("/usage")); const summary = result.summary;
    const latency = summary.runCount ? Math.round(summary.latencySumMs / summary.runCount) : 0;
    content.innerHTML = `<div class="bw-metrics"><div><span>?? Token</span><strong>${summary.inputTokens.toLocaleString()}</strong></div><div><span>?? Token</span><strong>${summary.outputTokens.toLocaleString()}</strong></div><div><span>????</span><strong>${summary.runCount.toLocaleString()}</strong></div><div><span>????</span><strong>${summary.failedRunCount.toLocaleString()}</strong></div><div><span>????</span><strong>$${summary.estimatedCostUsd.toFixed(4)}</strong></div><div><span>????</span><strong>${latency} ms</strong></div></div><div class="bw-table"><table><thead><tr><th>??</th><th>??</th><th>??</th><th>??</th><th>??</th><th>??</th></tr></thead><tbody>${result.rollups.map((item) => `<tr><td>${formatTime(item.bucketStart)}</td><td>${escapeHtml(item.model)}</td><td>${item.inputTokens}</td><td>${item.outputTokens}</td><td>${item.runCount}</td><td>$${item.estimatedCostUsd.toFixed(4)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  async function renderSettings() {
    const [agentResult, discovery, authorizationResult] = await Promise.all([bridge.request(agentApi()), bridge.request(agentApi("/runtime/discovery")).catch(() => ({ discovery: {} })), bridge.request(agentApi("/authorizations"))]);
    const agent = agentResult.agent;
    const discoveredModels = normalizeList(discovery.discovery?.["discovery.models"]?.data, ["models"]).map((item) => typeof item === "string" ? item : item.id || item.name || item.model).filter(Boolean);
    const modelIds = (discovery.policy?.allowedModels || []).filter((id) => discoveredModels.includes(id));
    const authorizations = authorizationResult.authorizations || [];
    const enabledServices = (authorizationResult.services || []).filter((item) => item.enabled);
    const serviceLabels = Object.fromEntries((authorizationResult.services || []).map((item) => [item.id, item.name]));
    content.innerHTML = `<div class="bw-split"><section><h3>Agent ??</h3><form class="bw-form" data-agent-form><label>??<input name="name" value="${escapeHtml(agent.name)}" required maxlength="64"></label><label>??<textarea name="description" rows="4" maxlength="500">${escapeHtml(agent.description || "")}</textarea></label><label>?????<textarea name="soulMarkdown" rows="12" maxlength="50000">${escapeHtml(agent.soulMarkdown || "")}</textarea></label><button type="submit" class="primary">?? Agent ??</button></form></section><section><h3>?????</h3><form class="bw-form" data-pref-form><label>??<select name="preferredModel"><option value="">???????</option>${modelIds.map((id) => `<option value="${escapeHtml(id)}" ${agent.settings?.preferredModel === id ? "selected" : ""}>${escapeHtml(id)}</option>`).join("")}</select></label><label>??<select name="locale"><option value="zh-CN" ${agent.settings?.locale !== "en-US" ? "selected" : ""}>????</option><option value="en-US" ${agent.settings?.locale === "en-US" ? "selected" : ""}>English</option></select></label><label class="bw-check"><input type="checkbox" name="notifications" ${agent.settings?.notifications !== false ? "checked" : ""}>??????</label><button type="submit" class="primary">????</button></form><div class="bw-security-note"><strong>????</strong><p>Hermes API key?Runtime ??????? Provider key ???????????????????????????? Agent ? Runtime ???????</p></div></section></div><section class="bw-authorizations"><div class="bw-section-head"><div><h3>?????</h3><p>Firecrawl???????????????????? Provider</p></div><button type="button" class="primary" data-auth-new ${enabledServices.length ? "" : "disabled"}>? ????</button></div><div class="bw-list">${authorizations.length ? authorizations.map((item) => `<article class="bw-row"><div><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(serviceLabels[item.service] || item.service)} ? ${escapeHtml(item.authType)}${item.endpointUrl ? ` ? ${escapeHtml(item.endpointUrl)}` : ""}</span></div><div class="bw-actions">${status(item.status)}<span>${escapeHtml(item.credentialMasked || "?????")}</span>${item.status !== "revoked" ? `<button type="button" class="danger-icon" data-auth-revoke="${escapeHtml(item.id)}" title="??">?</button>` : ""}</div></article>`).join("") : '<div class="bw-empty">??????????</div>'}</div></section>`;
    content.querySelector("[data-agent-form]").addEventListener("submit", async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); await bridge.request(agentApi(), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(values) }); toast("Agent ?????", "success"); });
    content.querySelector("[data-pref-form]").addEventListener("submit", async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); values.notifications = event.target.elements.notifications.checked; await bridge.request(agentApi(), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: values }) }); toast("?????", "success"); });
    content.querySelector("[data-auth-new]")?.addEventListener("click", async () => {
      const values = await openForm({ heading: "???????", fields: [{ name: "service", label: "??", type: "select", options: enabledServices.map((item) => ({ value: item.id, label: `${item.name} - ${item.purpose}` })) }, { name: "label", label: "??", required: true, maxLength: 100 }, { name: "authType", label: "????", type: "select", options: [{ value: "api_key", label: "API Key" }, { value: "bearer_token", label: "Bearer Token" }] }, { name: "endpointUrl", label: "HTTPS ????????", type: "url" }, { name: "provider", label: "Provider????", maxLength: 200 }, { name: "model", label: "??????", maxLength: 200 }, { name: "secret", label: "??? Token", type: "password", required: true, maxLength: 64000 }] });
      if (!values) return;
      await bridge.request(agentApi("/authorizations"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ service: values.service, label: values.label, authType: values.authType, endpointUrl: values.endpointUrl, secret: values.secret, metadata: { provider: values.provider, model: values.model } }) });
      toast("???????", "success"); renderSettings();
    });
    content.querySelectorAll("[data-auth-revoke]").forEach((button) => button.addEventListener("click", async () => {
      if (!await openForm({ heading: "???????", submitLabel: "????", danger: true, fields: [] })) return;
      await bridge.request(agentApi(`/authorizations/${encodeURIComponent(button.dataset.authRevoke)}`), { method: "DELETE" });
      toast("?????????????"); renderSettings();
    }));
  }

  const HERMES_CAPABILITY_GROUPS = [
    { title: "?????", description: "???? Agent ? Hermes Provider??????????", operations: ["provider.catalog", "provider.oauth.list", "model.info", "model.options", "model.auxiliary"] },
    { title: "?????", description: "???????????????", operations: ["toolsets.list", "skills.list", "skills.hub.sources", "mcp.list", "mcp.catalog"] },
    { title: "??????", description: "?? Profile??????????", operations: ["profiles.list", "profiles.active.get", "cron.delivery_targets", "cron.blueprints"] },
    { title: "?????", description: "?? Agent ????????????????", operations: ["diagnostics.status", "diagnostics.checkpoints", "files.list"] }
  ];

  function operationSummary(value) {
    if (Array.isArray(value)) return `${value.length} ?`;
    if (!value || typeof value !== "object") return value == null ? "???" : String(value);
    const arrays = Object.entries(value).filter(([, item]) => Array.isArray(item));
    if (arrays.length) return arrays.map(([key, item]) => `${key}: ${item.length}`).join(" ? ");
    if (typeof value.status === "string") return value.status;
    return `${Object.keys(value).length} ???`;
  }

  async function renderHermes() {
    content.innerHTML = `<div class="bw-section-head"><div><h3>Hermes ????</h3><p>???????? Agent ? Runtime Boundary??????????????????????</p></div><span class="bw-status bw-status-ready">Agent ??</span></div><div class="bw-capability-grid">${HERMES_CAPABILITY_GROUPS.map((group, index) => `<section class="bw-capability-card"><header><div><h3>${escapeHtml(group.title)}</h3><p>${escapeHtml(group.description)}</p></div><span>${group.operations.length}</span></header><div class="bw-list">${group.operations.map((operation) => `<button type="button" class="bw-capability-row" data-hermes-operation="${escapeHtml(operation)}"><span>${escapeHtml(operation)}</span><strong data-hermes-result="${escapeHtml(operation)}">??</strong></button>`).join("")}</div></section>`).join("")}</div><section class="bw-security-note"><strong>????</strong><p>?????????????? Profile?MCP ?????????????????????????????</p></section>`;
    content.querySelectorAll("[data-hermes-operation]").forEach((button) => button.addEventListener("click", async () => {
      const operation = button.dataset.hermesOperation;
      const target = content.querySelector(`[data-hermes-result="${CSS.escape(operation)}"]`);
      button.disabled = true;
      if (target) target.textContent = "???";
      try {
        const result = await bridge.request(agentApi(`/hermes/operations/${encodeURIComponent(operation)}`));
        if (target) target.textContent = operationSummary(result);
        button.classList.add("loaded");
      } catch (error) {
        if (target) target.textContent = STATUS_LABELS[error.message] || "???";
        toast(error.message || "Hermes ??????", "error");
      } finally { button.disabled = false; }
    }));
  }

  function mount() {
    root = document.createElement("section"); root.className = "bairui-workspace"; root.hidden = true;
    root.innerHTML = `<aside class="bw-nav"><header><img src="/assets/bairui-agent-icon.png" alt=""><strong>bairui-agent</strong></header><nav>${NAV.map(([key, label]) => `<button type="button" data-view="${key}">${escapeHtml(label)}</button>`).join("")}</nav></aside><main><header class="bw-header"><div><span>${escapeHtml(activeAgent()?.name || "Agent")}</span><h1></h1></div><button type="button" data-close title="?????" aria-label="?????">?</button></header><div class="bw-content"></div></main>`;
    document.body.appendChild(root); content = root.querySelector(".bw-content"); title = root.querySelector("h1");
    root.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => render(button.dataset.view)));
    root.querySelector("[data-close]").addEventListener("click", closeWorkspace);
    window.addEventListener("bairui:workspace-open", () => openWorkspace());
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !root.hidden && !document.querySelector("dialog[open]")) closeWorkspace(); });
  }

  window.addEventListener("DOMContentLoaded", mount, { once: true });
})();
