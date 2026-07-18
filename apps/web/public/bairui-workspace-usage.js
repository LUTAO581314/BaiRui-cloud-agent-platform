(function () {
  const registry = window.BairuiWorkspaceRegistry;
  if (!registry) return;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const formatTime = (value) => {
    if (!value) return "--";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "--" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  };

  registry.register({
    id: "usage",
    label: "用量",
    order: 9,
    render: async ({ bridge, agentApi, content }) => {
      const result = await bridge.request(agentApi("/usage"));
      const summary = result.summary;
      const latency = summary.runCount ? Math.round(summary.latencySumMs / summary.runCount) : 0;
      content.innerHTML = `<div class="bw-metrics"><div><span>输入 Token</span><strong>${summary.inputTokens.toLocaleString()}</strong></div><div><span>输出 Token</span><strong>${summary.outputTokens.toLocaleString()}</strong></div><div><span>运行次数</span><strong>${summary.runCount.toLocaleString()}</strong></div><div><span>失败次数</span><strong>${summary.failedRunCount.toLocaleString()}</strong></div><div><span>估算费用</span><strong>$${summary.estimatedCostUsd.toFixed(4)}</strong></div><div><span>平均延迟</span><strong>${latency} ms</strong></div></div><div class="bw-table"><table><thead><tr><th>时间</th><th>模型</th><th>输入</th><th>输出</th><th>运行</th><th>费用</th></tr></thead><tbody>${result.rollups.map((item) => `<tr><td>${formatTime(item.bucketStart)}</td><td>${escapeHtml(item.model)}</td><td>${item.inputTokens}</td><td>${item.outputTokens}</td><td>${item.runCount}</td><td>$${item.estimatedCostUsd.toFixed(4)}</td></tr>`).join("")}</tbody></table></div>`;
    }
  });
})();
