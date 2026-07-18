(function () {
  const registry = window.BairuiWorkspaceRegistry;
  if (!registry) return;

  const CAPABILITY_GROUPS = [
    { title: "模型与认证", description: "读取当前 Agent 的 Hermes Provider、模型和辅助模型状态", operations: ["provider.catalog", "provider.oauth.list", "model.info", "model.options", "model.auxiliary"] },
    { title: "工具与技能", description: "读取工具集、技能来源和可用能力", operations: ["toolsets.list", "skills.list", "skills.hub.sources", "mcp.list", "mcp.catalog"] },
    { title: "身份与自动化", description: "读取 Profile、定时任务和交付目标", operations: ["profiles.list", "profiles.active.get", "cron.delivery_targets", "cron.blueprints"] },
    { title: "诊断与文件", description: "读取 Agent 范围内的健康、检查点和工作区目录", operations: ["diagnostics.status", "diagnostics.checkpoints", "files.list"] }
  ];

  function operationSummary(value) {
    if (Array.isArray(value)) return `${value.length} 项`;
    if (!value || typeof value !== "object") return value == null ? "无数据" : String(value);
    const arrays = Object.entries(value).filter(([, item]) => Array.isArray(item));
    if (arrays.length) return arrays.map(([key, item]) => `${key}: ${item.length}`).join(" · ");
    if (typeof value.status === "string") return value.status;
    return `${Object.keys(value).length} 个字段`;
  }

  async function renderHermes({ bridge, content, agentApi, escapeHtml, statusLabels, toast }) {
    content.innerHTML = `<div class="bw-section-head"><div><h3>Hermes 能力中心</h3><p>请求只经过当前 Agent 的 Runtime Boundary，不读取主机配置、密钥或其他用户数据。</p></div><span class="bw-status bw-status-ready">Agent 范围</span></div><div class="bairui-capability-sections">${CAPABILITY_GROUPS.map((group) => `<section class="settings-section bairui-capability-section"><div class="bw-section-head"><div><h3>${escapeHtml(group.title)}</h3><p>${escapeHtml(group.description)}</p></div><span>${group.operations.length} 项</span></div><div class="bw-list">${group.operations.map((operation) => `<button type="button" class="bairui-capability-row" data-hermes-operation="${escapeHtml(operation)}"><span>${escapeHtml(operation)}</span><strong data-hermes-result="${escapeHtml(operation)}">读取</strong></button>`).join("")}</div></section>`).join("")}</div><section class="settings-section bairui-security-note"><div class="settings-section-label">高级操作</div><p>写入配置、安装技能、修改 Profile、MCP 或文件的动作只在对应工作台显示确认、权限与真实执行结果。</p></section>`;
    content.querySelectorAll("[data-hermes-operation]").forEach((button) => button.addEventListener("click", async () => {
      const operation = button.dataset.hermesOperation;
      const target = content.querySelector(`[data-hermes-result="${CSS.escape(operation)}"]`);
      button.disabled = true;
      if (target) target.textContent = "读取中";
      try {
        const result = await bridge.request(agentApi(`/hermes/operations/${encodeURIComponent(operation)}`));
        if (target) target.textContent = operationSummary(result);
        button.classList.add("loaded");
      } catch (error) {
        if (target) target.textContent = statusLabels[error.message] || "不可用";
        toast(error.message || "Hermes 能力读取失败", "error");
      } finally {
        button.disabled = false;
      }
    }));
  }

  registry.register({ id: "hermes", label: "能力中心", order: 10, render: renderHermes });
})();
