(function () {
  const registry = window.BairuiWorkspaceRegistry;
  if (!registry) return;

  async function renderAgents(context) {
    const { bridge, content, activeAgent, agentApi, escapeHtml, status, toast, openForm } = context;
    const result = await bridge.request("/api/user/agents");
    bridge.state.agents = result.agents || [];
    const agent = bridge.state.agents.find((item) => item.id === activeAgent().id) || activeAgent();
    content.innerHTML = `<div class="bw-split"><section class="settings-section"><div class="bw-section-head"><div><div class="settings-section-label">我的 Agent</div><p>只显示当前账户拥有的 Agent</p></div><button type="button" class="settings-save-btn" data-create>创建</button></div><div class="bw-list">${bridge.state.agents.map((item) => `<article class="bw-row ${item.id === agent.id ? "selected" : ""}"><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.description || "未填写描述")}</span></div><div class="bw-actions">${status(item.operational?.code || item.runtime?.effectiveStatus || item.runtime?.status || item.initializationStatus)}<button type="button" class="settings-save-btn" data-switch="${escapeHtml(item.id)}">切换</button></div></article>`).join("")}</div></section><section class="settings-section"><div class="settings-section-label">当前 Agent</div><dl class="bw-details"><div><dt>名称</dt><dd>${escapeHtml(agent.name)}</dd></div><div><dt>状态</dt><dd>${status(agent.operational?.code || "uninitialized")}</dd></div><div><dt>描述</dt><dd>${escapeHtml(agent.description || "未填写描述")}</dd></div><div><dt>今日用量</dt><dd>${Number(agent.operational?.quota?.dailyTokens || 0).toLocaleString()} Token</dd></div></dl><div class="bw-actions bw-actions-wide"><button type="button" class="settings-save-btn" data-edit>编辑资料</button><button type="button" class="settings-save-btn" data-import-card>导入角色卡</button>${["uninitialized", "failed"].includes(agent.operational?.code || agent.initializationStatus) ? '<button type="button" class="settings-save-btn" data-init>初始化/重试</button>' : ""}${agent.runtime?.status === "suspended" ? '<button type="button" class="settings-save-btn" data-resume>恢复</button>' : '<button type="button" class="settings-save-btn" data-pause>暂停</button>'}<button type="button" class="settings-save-btn" data-tone="danger" data-remove>删除 Agent</button></div></section></div>`;
    content.querySelector("[data-create]").addEventListener("click", async () => {
      const created = await bridge.createAgentDialog();
      bridge.activateAgent(created.id);
    });
    content.querySelectorAll("[data-switch]").forEach((button) => button.addEventListener("click", () => bridge.activateAgent(button.dataset.switch)));
    content.querySelector("[data-import-card]").addEventListener("click", () => bridge.chooseCharacterCard(agent));
    content.querySelector("[data-edit]").addEventListener("click", async () => {
      const values = await openForm({ heading: "编辑 Agent", fields: [{ name: "name", label: "名称", value: agent.name, required: true, maxLength: 64 }, { name: "description", label: "描述", type: "textarea", value: agent.description, maxLength: 500 }, { name: "soulMarkdown", label: "身份与原则", type: "textarea", value: agent.soulMarkdown, rows: 10, maxLength: 50000 }] });
      if (values) {
        await bridge.request(agentApi(), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
        toast("Agent 资料已保存", "success");
        await renderAgents(context);
      }
    });
    content.querySelector("[data-init]")?.addEventListener("click", async () => {
      if (await bridge.initializeAgent(agent)) {
        toast("初始化请求已提交");
        await renderAgents(context);
      }
    });
    content.querySelector("[data-pause]")?.addEventListener("click", async () => {
      await bridge.request(agentApi("/lifecycle"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pause" }) });
      toast("暂停命令已提交，等待服务器回执");
      await renderAgents(context);
    });
    content.querySelector("[data-resume]")?.addEventListener("click", async () => {
      await bridge.request(agentApi("/lifecycle"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resume" }) });
      toast("恢复命令已提交，等待服务器回执");
      await renderAgents(context);
    });
    content.querySelector("[data-remove]").addEventListener("click", async () => {
      const values = await openForm({ heading: "删除 Agent", submitLabel: "永久删除", danger: true, fields: [{ name: "confirmName", label: `输入 ${agent.name} 确认`, required: true }] });
      if (!values) return;
      await bridge.request(agentApi("/lifecycle"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", confirmName: values.confirmName }) });
      toast("删除命令已提交，Agent 数据暂时保留到服务器确认", "success");
      setTimeout(() => location.reload(), 900);
    });
  }

  registry.register({ id: "agents", label: "Agent", order: 2, render: renderAgents });
})();
