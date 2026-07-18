(function () {
  const registry = window.BairuiWorkspaceRegistry;
  if (!registry) return;

  const CHANNEL_LABELS = { web: "网页", cli: "CLI", feishu: "飞书", wechat: "微信", qq: "QQ" };

  async function renderChannels(context) {
    const { bridge, content, agentApi, escapeHtml, status, toast, openForm } = context;
    const result = await bridge.request(agentApi("/channels"));
    content.innerHTML = `<div class="bw-section-head"><div><h3>渠道连接</h3><p>非 Web 渠道只有收到适配器回执后才会显示已连接</p></div></div><div class="bw-list">${result.channels.map(({ channel, binding }) => `<article class="bw-row"><div><strong>${escapeHtml(CHANNEL_LABELS[channel] || channel)}</strong><span>${escapeHtml(binding?.displayName || "未绑定")}${binding?.credentialMasked ? ` · ${escapeHtml(binding.credentialMasked)}` : ""}${binding?.adapterVersion ? ` · ${escapeHtml(binding.adapterVersion)}` : ""}${binding?.callbackPath ? `<br>${escapeHtml(new URL(binding.callbackPath, window.location.origin).toString())}` : ""}</span></div><div class="bw-actions">${status(binding?.status || "unconfigured")}<button type="button" data-bind="${channel}">${binding ? "更新" : "绑定"}</button>${binding && channel !== "web" ? `<button type="button" data-unbind="${channel}" class="danger-icon" title="解绑">×</button>` : ""}</div></article>`).join("")}</div>`;
    content.querySelectorAll("[data-bind]").forEach((button) => button.addEventListener("click", async () => {
      const channel = button.dataset.bind;
      const fields = [{ name: "displayName", label: "显示名称", value: CHANNEL_LABELS[channel] }];
      if (channel === "feishu") fields.push({ name: "appId", label: "App ID", required: true }, { name: "appSecret", label: "App Secret", type: "password", required: true }, { name: "verifyToken", label: "Verify Token", type: "password" });
      else if (channel === "wechat") fields.push({ name: "appId", label: "App ID", required: true }, { name: "appSecret", label: "App Secret", type: "password", required: true }, { name: "token", label: "Token", type: "password" });
      else if (channel === "qq") fields.push({ name: "appId", label: "App ID", required: true }, { name: "appSecret", label: "App Secret", type: "password", required: true });
      else if (channel === "cli") fields.push({ name: "label", label: "终端标识", value: "default" });
      const values = await openForm({ heading: `绑定${CHANNEL_LABELS[channel]}`, fields });
      if (!values) return;
      const { displayName, ...credentials } = values;
      const data = await bridge.request(agentApi(`/channels/${channel}`), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName, credentials }) });
      toast(data.binding.status === "connected" ? "渠道已连接" : "配置已加密保存，等待渠道适配器确认");
      await renderChannels(context);
    }));
    content.querySelectorAll("[data-unbind]").forEach((button) => button.addEventListener("click", async () => {
      await bridge.request(agentApi(`/channels/${button.dataset.unbind}`), { method: "DELETE" });
      toast("渠道已解绑");
      await renderChannels(context);
    }));
  }

  registry.register({ id: "channels", label: "渠道", order: 5, render: renderChannels });
})();
