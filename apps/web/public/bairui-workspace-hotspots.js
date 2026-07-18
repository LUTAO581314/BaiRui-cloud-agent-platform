(function () {
  const registry = window.BairuiWorkspaceRegistry;
  if (!registry) return;
  let mountedContext = null;

  async function renderHotspots(context) {
    mountedContext = context;
    const { bridge, content, agentApi, escapeHtml, formatTime, closeWorkspace, panelContract } = context;
    const snapshot = await bridge.panelSnapshot("hotspots");
    const result = snapshot.data;
    const contract = panelContract("hotspots") || { state: snapshot.state, reason: snapshot.reason };
    const stateCopy = contract.state === "available"
      ? `采集于 ${formatTime(result.run?.completedAt)}`
      : contract.state === "needs_configuration"
        ? "热点数据源尚未完成首次真实采集"
        : "热点采集暂时不可用";

    content.innerHTML = `<div class="bw-section-head"><div><h3>实时热点</h3><p data-panel-state="${escapeHtml(contract.state)}">${escapeHtml(stateCopy)}</p></div><button type="button" data-refresh-hotspots>刷新</button></div><div class="bw-hotspot-grid">${result.items.length ? result.items.map((item) => `<article class="bw-hotspot"><header><span>${escapeHtml(item.sourceName)}</span><strong>${item.rank || "--"}</strong></header><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.heat || item.category || "")}</p><footer><button type="button" data-bookmark="${item.id}" data-value="${item.bookmarked ? "0" : "1"}">${item.bookmarked ? "已收藏" : "收藏"}</button><button type="button" class="primary" data-analyze="${item.id}">交给 Agent</button>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">来源</a>` : ""}</footer></article>`).join("") : '<div class="bw-empty" data-panel-empty="needs_configuration">需要完成一次真实采集</div>'}</div>`;

    content.querySelector("[data-refresh-hotspots]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "采集中";
      try {
        const transport = window.BairuiPanelTransport;
        if (transport?.client("hotspots")) await transport.command("hotspots", "refresh");
        else await bridge.panelCommand("hotspots", "refresh");
        await renderHotspots(context);
      } catch (error) {
        button.disabled = false;
        button.textContent = "重试";
        context.toast(error.message || "热点采集失败", "error");
      }
    });

    content.querySelectorAll("[data-bookmark]").forEach((button) => button.addEventListener("click", async () => {
      await bridge.request(agentApi(`/hotspots/${button.dataset.bookmark}/bookmark`), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookmarked: button.dataset.value === "1" }) });
      await renderHotspots(context);
    }));
    content.querySelectorAll("[data-analyze]").forEach((button) => button.addEventListener("click", () => {
      const item = result.items.find((entry) => entry.id === button.dataset.analyze);
      bridge.prefillChat(`请分析这个热点，说明事实来源、背景、可信度和可能影响：${item.title}\n${item.url || ""}`);
      closeWorkspace();
    }));
  }

  window.addEventListener("bairui:panel-scene", (event) => {
    if (event.detail?.panelId === "hotspots" && mountedContext?.workspaceState.view === "hotspots") void renderHotspots(mountedContext);
  });

  registry.register({
    id: "hotspots",
    panelId: "hotspots",
    label: "热点",
    order: 6,
    render: renderHotspots,
    dispose() { mountedContext = null; }
  });
})();
