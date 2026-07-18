(function () {
  const registry = window.BairuiWorkspaceRegistry;
  if (!registry) return;

  async function renderSettings(context) {
    const { bridge, content, agentApi, escapeHtml, normalizeList, status, openForm, toast } = context;
    const [agentResult, discovery, authorizationResult] = await Promise.all([
      bridge.request(agentApi()),
      bridge.request(agentApi("/runtime/discovery")).catch(() => ({ discovery: {} })),
      bridge.request(agentApi("/authorizations"))
    ]);
    const agent = agentResult.agent;
    const discoveredModels = normalizeList(discovery.discovery?.["discovery.models"]?.data, ["models"])
      .map((item) => typeof item === "string" ? item : item.id || item.name || item.model)
      .filter(Boolean);
    const modelIds = (discovery.policy?.allowedModels || []).filter((id) => discoveredModels.includes(id));
    const authorizations = authorizationResult.authorizations || [];
    const enabledServices = (authorizationResult.services || []).filter((item) => item.enabled);
    const serviceLabels = Object.fromEntries((authorizationResult.services || []).map((item) => [item.id, item.name]));
    content.innerHTML = `<div class="bairui-settings-columns"><section class="settings-section"><div class="settings-section-label">Agent 设置</div><form data-agent-form><label class="settings-row"><span class="settings-label">名称</span><input class="settings-input" name="name" value="${escapeHtml(agent.name)}" required maxlength="64"></label><label class="settings-row bairui-extension-field"><span class="settings-label">描述</span><textarea class="settings-input bairui-extension-textarea" name="description" rows="4" maxlength="500">${escapeHtml(agent.description || "")}</textarea></label><label class="settings-row bairui-extension-field"><span class="settings-label">身份与原则</span><textarea class="settings-input bairui-extension-textarea" name="soulMarkdown" rows="10" maxlength="50000">${escapeHtml(agent.soulMarkdown || "")}</textarea></label><div class="settings-row-action"><button type="submit" class="settings-save-btn">保存 Agent 设置</button></div></form></section><section class="settings-section"><div class="settings-section-label">模型与偏好</div><form data-pref-form><label class="settings-row"><span class="settings-label">模型</span><select class="settings-select" name="preferredModel"><option value="">管理员默认模型</option>${modelIds.map((id) => `<option value="${escapeHtml(id)}" ${agent.settings?.preferredModel === id ? "selected" : ""}>${escapeHtml(id)}</option>`).join("")}</select></label><label class="settings-row"><span class="settings-label">语言</span><select class="settings-select" name="locale"><option value="zh-CN" ${agent.settings?.locale !== "en-US" ? "selected" : ""}>简体中文</option><option value="en-US" ${agent.settings?.locale === "en-US" ? "selected" : ""}>English</option></select></label><label class="settings-row"><span class="settings-label">运行通知</span><label class="settings-toggle"><input type="checkbox" name="notifications" ${agent.settings?.notifications !== false ? "checked" : ""}><span class="settings-toggle-track"></span></label></label><div class="settings-row-action"><button type="submit" class="settings-save-btn">保存偏好</button></div></form><p class="settings-hint">Hermes API key、Runtime 签名密钥和平台 Provider key 不会进入浏览器。个人连接只保存加密引用。</p></section></div><section class="settings-section"><div class="bw-section-head"><div><div class="settings-section-label">个人连接</div><p>Firecrawl、搜索、语音、文档和管理员允许的个人模型服务</p></div><button type="button" class="settings-save-btn" data-auth-new ${enabledServices.length ? "" : "disabled"}>添加连接</button></div><div class="bw-list">${authorizations.length ? authorizations.map((item) => `<article class="bw-row"><div><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(serviceLabels[item.service] || item.service)} · ${escapeHtml(item.authType)}${item.endpointUrl ? ` · ${escapeHtml(item.endpointUrl)}` : ""}</span></div><div class="bw-actions">${status(item.status)}<span>${escapeHtml(item.credentialMasked || "凭证已清除")}</span>${item.status !== "revoked" ? `<button type="button" class="settings-save-btn" data-tone="danger" data-auth-revoke="${escapeHtml(item.id)}">吊销</button>` : ""}</div></article>`).join("") : '<div class="bw-empty">还没有个人连接</div>'}</div></section>`;
    content.querySelector("[data-agent-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.target));
      await bridge.request(agentApi(), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      toast("Agent 设置已保存", "success");
    });
    content.querySelector("[data-pref-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.target));
      values.notifications = event.target.elements.notifications.checked;
      await bridge.request(agentApi(), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: values }) });
      toast("偏好已保存", "success");
    });
    content.querySelector("[data-auth-new]")?.addEventListener("click", async () => {
      const values = await openForm({
        heading: "添加个人连接",
        fields: [
          { name: "service", label: "服务", type: "select", options: enabledServices.map((item) => ({ value: item.id, label: `${item.name} - ${item.purpose}` })) },
          { name: "label", label: "名称", required: true, maxLength: 100 },
          { name: "authType", label: "认证类型", type: "select", options: [{ value: "api_key", label: "API Key" }, { value: "bearer_token", label: "Bearer Token" }] },
          { name: "endpointUrl", label: "HTTPS 接口地址（可选）", type: "url" },
          { name: "provider", label: "Provider（可选）", maxLength: 200 },
          { name: "model", label: "模型（可选）", maxLength: 200 },
          { name: "secret", label: "密钥或 Token", type: "password", required: true, maxLength: 64000 }
        ]
      });
      if (!values) return;
      await bridge.request(agentApi("/authorizations"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          service: values.service,
          label: values.label,
          authType: values.authType,
          endpointUrl: values.endpointUrl,
          secret: values.secret,
          metadata: { provider: values.provider, model: values.model }
        })
      });
      toast("连接已加密保存", "success");
      await renderSettings(context);
    });
    content.querySelectorAll("[data-auth-revoke]").forEach((button) => button.addEventListener("click", async () => {
      if (!await openForm({ heading: "吊销个人连接", submitLabel: "确认吊销", danger: true, fields: [] })) return;
      await bridge.request(agentApi(`/authorizations/${encodeURIComponent(button.dataset.authRevoke)}`), { method: "DELETE" });
      toast("连接已吊销，凭证密文已清除");
      await renderSettings(context);
    }));
  }

  registry.register({ id: "settings", label: "设置", order: 11, render: renderSettings });
})();
