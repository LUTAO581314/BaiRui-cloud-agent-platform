(function () {
  const registry = window.BairuiWorkspaceRegistry;
  if (!registry) return;

  async function renderHotspots(context) {
    const { bridge, content, agentApi, escapeHtml, formatTime, closeWorkspace } = context;
    const result = await bridge.request(agentApi("/hotspots"));
    content.innerHTML = `<div class="bw-section-head"><div><h3>实时热点</h3><p>${result.run ? `采集于 ${formatTime(result.run.completedAt)}` : "管理员尚未完成热点采集"}</p></div></div><div class="bw-hotspot-grid">${result.items.length ? result.items.map((item) => `<article class="bw-hotspot"><header><span>${escapeHtml(item.sourceName)}</span><strong>${item.rank || "--"}</strong></header><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.heat || item.category || "")}</p><footer><button type="button" data-bookmark="${item.id}" data-value="${item.bookmarked ? "0" : "1"}">${item.bookmarked ? "已收藏" : "收藏"}</button><button type="button" class="primary" data-analyze="${item.id}">交给 Agent</button>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">来源</a>` : ""}</footer></article>`).join("") : '<div class="bw-empty">暂无真实热点数据</div>'}</div>`;
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

  registry.register({ id: "hotspots", label: "热点", order: 6, render: renderHotspots });
})();
