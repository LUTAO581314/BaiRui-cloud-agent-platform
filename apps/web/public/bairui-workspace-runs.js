(function () {
  const registry = window.BairuiWorkspaceRegistry;
  if (!registry) return;

  const state = { runId: null, controller: null };

  async function streamRun(context, runId, log, approval) {
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    const response = await context.bridge.openRunEvents(runId, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error("run_stream_unavailable");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let terminalEvent = false;
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const blocks = buffer.replaceAll("\r\n", "\n").split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const line = block.split("\n").find((item) => item.startsWith("data:"));
        if (!line) continue;
        const event = JSON.parse(line.slice(5));
        const row = document.createElement("div");
        row.className = "bw-run-event";
        row.textContent = `${event.event || "event"} ${event.tool || event.text || event.delta || event.error || event.output || ""}`;
        log.appendChild(row);
        log.scrollTop = log.scrollHeight;
        if (event.event === "approval.request") {
          approval.hidden = false;
          approval.querySelector("p").textContent = event.command || event.prompt || "Hermes 请求执行受保护操作";
        }
        if (["run.completed", "run.failed", "run.cancelled"].includes(event.event)) {
          approval.hidden = true;
          state.controller = null;
          terminalEvent = true;
        }
      }
      if (done) break;
    }
    if (terminalEvent) await context.bridge.request(context.agentApi(`/runs/${encodeURIComponent(runId)}`)).catch(() => null);
  }

  async function renderRuns(context) {
    const { bridge, content, agentApi, escapeHtml, formatTime, status, statusLabels, normalizeList, openForm, toast } = context;
    const result = await bridge.request(agentApi("/runs?limit=50"));
    const runs = normalizeList(result, ["runs"]);
    if (!runs.some((item) => item.id === state.runId)) state.runId = runs[0]?.id || null;
    const selected = runs.find((item) => item.id === state.runId) || null;
    const terminal = selected && ["completed", "failed", "cancelled"].includes(selected.status);
    content.innerHTML = `<div class="bw-section-head"><div><h3>结构化运行</h3><p>长任务由 Hermes 执行，历史记录保存在当前用户的 Agent 空间</p></div><button type="button" class="settings-save-btn" data-start>新运行</button></div><div class="bw-run-console"><div class="bw-run-state">${selected ? `${escapeHtml(selected.id)} · ${escapeHtml(statusLabels[selected.status] || selected.status)}` : "尚未启动运行"}</div><div class="bw-run-log" data-log></div><section class="bw-approval" data-approval hidden><h4>等待你的审批</h4><p></p><div>${["once", "session", "always", "deny"].map((choice) => `<button type="button" data-choice="${choice}" class="settings-save-btn" ${choice === "deny" ? 'data-tone="danger"' : ""}>${{ once: "仅本次", session: "本次运行", always: "始终允许", deny: "拒绝" }[choice]}</button>`).join("")}</div></section><div class="bw-actions"><button type="button" class="settings-save-btn" data-stop ${selected && !terminal ? "" : "disabled"}>停止运行</button><button type="button" class="settings-save-btn" data-refresh ${selected ? "" : "disabled"}>刷新状态</button></div></div><div class="bw-section-head"><h3>运行历史</h3><span>${runs.length} 条</span></div><div class="bw-list">${runs.length ? runs.map((run) => `<article class="bw-row ${run.id === state.runId ? "selected" : ""}"><div><strong>${escapeHtml(run.inputPreview || "未命名任务")}</strong><span>${formatTime(run.createdAt)}${run.model ? ` · ${escapeHtml(run.model)}` : ""}</span>${run.lastError ? `<p>${escapeHtml(run.lastError)}</p>` : ""}</div><div class="bw-actions">${status(run.status)}<button type="button" class="settings-save-btn" data-select-run="${escapeHtml(run.id)}">查看</button>${["completed", "failed", "cancelled"].includes(run.status) ? `<button type="button" class="settings-save-btn" data-retry-run="${escapeHtml(run.id)}">${run.status === "failed" ? "重试" : "再次运行"}</button>` : ""}</div></article>`).join("") : '<div class="bw-empty">还没有运行记录</div>'}</div>`;
    const approval = content.querySelector("[data-approval]");
    const followRun = async (runId) => {
      await renderRuns(context);
      try {
        await streamRun(context, runId, content.querySelector("[data-log]"), content.querySelector("[data-approval]"));
        await renderRuns(context);
      } catch (error) {
        if (error.name !== "AbortError") toast(error.message, "error");
      }
    };
    content.querySelector("[data-start]").addEventListener("click", async () => {
      const values = await openForm({ heading: "创建运行", fields: [{ name: "input", label: "任务内容", type: "textarea", rows: 10, required: true }] });
      if (!values) return;
      const run = await bridge.request(agentApi("/runs"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      state.runId = run.run_id;
      followRun(run.run_id);
    });
    content.querySelectorAll("[data-choice]").forEach((button) => button.addEventListener("click", async () => {
      await bridge.request(agentApi(`/runs/${encodeURIComponent(state.runId)}/approval`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ choice: button.dataset.choice }) });
      approval.hidden = true;
      toast("审批已提交");
    }));
    content.querySelector("[data-stop]").addEventListener("click", async () => {
      await bridge.request(agentApi(`/runs/${encodeURIComponent(state.runId)}/stop`), { method: "POST" });
      state.controller?.abort();
      toast("停止请求已提交");
    });
    content.querySelector("[data-refresh]").addEventListener("click", async () => {
      await bridge.request(agentApi(`/runs/${encodeURIComponent(state.runId)}`));
      await renderRuns(context);
    });
    content.querySelectorAll("[data-select-run]").forEach((button) => button.addEventListener("click", () => {
      state.runId = button.dataset.selectRun;
      renderRuns(context);
    }));
    content.querySelectorAll("[data-retry-run]").forEach((button) => button.addEventListener("click", async () => {
      const run = await bridge.request(agentApi(`/runs/${encodeURIComponent(button.dataset.retryRun)}/retry`), { method: "POST" });
      state.runId = run.run_id;
      followRun(run.run_id);
    }));
  }

  registry.register({
    id: "runs",
    label: "运行",
    order: 7,
    render: renderRuns,
    dispose() {
      state.controller?.abort();
      state.controller = null;
    }
  });
})();
