(function () {
  const registry = window.BairuiWorkspaceRegistry;
  if (!registry) return;

  const normalizeList = (value, keys = []) => {
    if (Array.isArray(value)) return value;
    for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
    if (Array.isArray(value?.data)) return value.data;
    return [];
  };

  registry.register({
    id: "skills",
    label: "技能",
    order: 4,
    render: async ({ bridge, agentApi, content, activeAgent, escapeHtml, status, toast }) => {
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
      content.innerHTML = `<div class="bw-runtime-summary"><div><span>Hermes</span><strong>${escapeHtml(runtimeVersion)}</strong></div><div><span>健康</span>${status(healthState.status === "available" ? health.status || "ready" : "unavailable")}</div><div><span>Gateway</span><strong>${escapeHtml(health.gateway_state || "unknown")}</strong></div><div><span>活跃 Agent</span><strong>${Number(health.active_agents || 0)}</strong></div></div>
        <section class="bw-capability-section"><div class="bw-section-head"><div><h3>Runtime Capabilities</h3><p>由当前 Hermes /v1/capabilities 实时返回</p></div>${status(capabilityState.status)}</div><div class="bw-capability-grid">${featureEntries.length ? featureEntries.map(([name, enabled]) => `<div><span>${escapeHtml(name.replaceAll("_", " "))}</span>${status(enabled ? "ready" : "disabled", enabled ? "支持" : "不支持")}</div>`).join("") : '<div class="bw-empty">Runtime 暂未返回能力清单</div>'}</div></section>
        <section class="bw-capability-section"><div class="bw-section-head"><div><h3>Hermes Toolsets</h3><p>展示工具集、配置状态和实际工具组成</p></div>${status(toolsetState.status)}</div><div class="bw-list">${toolsets.length ? toolsets.map((toolset) => `<article class="bw-row"><div><strong>${escapeHtml(toolset.label || toolset.name)}</strong><span>${escapeHtml(toolset.description || toolset.name)} · ${Number(toolset.tools?.length || 0)} 个工具</span><p>${escapeHtml((toolset.tools || []).join(" · "))}</p></div><div class="bw-actions">${status(toolset.enabled ? "ready" : "disabled", toolset.enabled ? "已启用" : "未启用")}${status(toolset.configured ? "configured" : "unconfigured", toolset.configured ? "已授权" : "待配置")}</div></article>`).join("") : '<div class="bw-empty">Runtime 暂未返回 Toolsets</div>'}</div></section>
        <section class="bw-capability-section"><div class="bw-section-head"><div><h3>Hermes 技能</h3><p>${result.discovery?.status === "available" ? "来自当前 Agent Runtime" : "Runtime 不可用，显示已保存偏好"}</p></div>${status(result.discovery?.status)}</div><div class="bw-list">${skills.length ? skills.map((skill) => { const value = typeof skill === "string" ? { name: skill } : skill; const id = value.id || value.name; const pref = preferences.get(id); const enabled = pref ? pref.enabled : value.enabled !== false; return `<article class="bw-row"><div><strong>${escapeHtml(value.name || id)}</strong><span>${escapeHtml(value.description || id)} · ${escapeHtml(value.category || "uncategorized")} · ${escapeHtml(value.version || runtimeVersion)}</span></div><div class="bw-actions"><label class="bw-toggle"><input type="checkbox" data-skill="${escapeHtml(id)}" ${enabled ? "checked" : ""}><span></span></label>${pref ? status(pref.applyStatus) : status("ready", "Runtime 默认")}</div></article>`; }).join("") : '<div class="bw-empty">Runtime 暂未返回可用技能</div>'}</div></section>
        <section class="bw-capability-section"><div class="bw-section-head"><div><h3>能力授权</h3><p>当前 Agent 可供工具和集成使用的个人授权</p></div><span>${authorizations.length} 项</span></div><div class="bw-list">${authorizations.length ? authorizations.map((item) => `<article class="bw-row"><div><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(serviceLabels[item.service] || item.service)} · ${escapeHtml(item.credentialMasked || "无有效凭证")}</span></div>${status(item.status)}</article>`).join("") : '<div class="bw-empty">当前 Agent 没有个人能力授权</div>'}</div></section>`;
      content.querySelectorAll("[data-skill]").forEach((input) => input.addEventListener("change", async () => { const data = await bridge.request(agentApi(`/skills/${encodeURIComponent(input.dataset.skill)}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: input.checked }) }); toast(data.preference.applyStatus === "pending" ? "偏好已保存，等待配置适配器应用" : "技能状态已更新"); window.dispatchEvent(new CustomEvent("bairui:workspace-refresh")); }));
    }
  });
})();
