(function () {
  const registry = window.BairuiWorkspaceRegistry;
  if (!registry) return;

  async function renderJobs(context) {
    const { bridge, content, agentApi, escapeHtml, formatTime, status, statusLabels, normalizeList, openForm, toast } = context;
    const result = await bridge.request(agentApi("/jobs?include_disabled=true"));
    const jobs = normalizeList(result, ["jobs"]);
    const jobFields = (job = {}) => {
      const schedule = typeof job.schedule === "string" ? job.schedule : job.schedule?.expr || job.schedule?.display || "";
      return [
        { name: "name", label: "名称", value: job.name || "", required: true, maxLength: 200 },
        { name: "schedule", label: "执行计划", value: schedule, placeholder: "例如 every day at 09:00 或 0 9 * * *", required: true },
        { name: "prompt", label: "任务内容", type: "textarea", value: job.prompt || "", rows: 8, required: true, maxLength: 5000 },
        { name: "repeat", label: "重复次数（留空表示持续执行）", type: "number", value: job.repeat || "" },
        { name: "skills", label: "限定技能（逗号分隔，可选）", value: Array.isArray(job.skills) ? job.skills.join(",") : job.skills || "" }
      ];
    };
    const jobPayload = (values, current = {}) => ({
      name: values.name,
      schedule: values.schedule,
      prompt: values.prompt,
      deliver: current.deliver || "local",
      repeat: values.repeat ? Number(values.repeat) : null,
      skills: values.skills ? values.skills.split(/[,，]/).map((item) => item.trim()).filter(Boolean) : []
    });
    content.innerHTML = `<div class="bw-section-head"><div><h3>Hermes 定时任务</h3><p>显示 Hermes 返回的真实计划、最近结果和下次执行时间</p></div><button type="button" class="settings-save-btn" data-new>新任务</button></div><div class="bw-list">${jobs.length ? jobs.map((job) => `<article class="bw-row"><div><strong>${escapeHtml(job.name || job.id)}</strong><span>${escapeHtml(job.schedule_display || job.schedule?.display || job.schedule?.expr || job.schedule || "")}${job.next_run_at ? ` · 下次 ${formatTime(job.next_run_at)}` : ""}${job.repeat ? ` · 剩余 ${job.repeat}` : ""}</span><p>${escapeHtml(job.prompt || "")}</p>${job.last_run_at ? `<p>上次 ${formatTime(job.last_run_at)} · ${escapeHtml(statusLabels[job.last_status] || job.last_status || "未知")}${job.last_error ? ` · ${escapeHtml(job.last_error)}` : ""}</p>` : ""}</div><div class="bw-actions">${status(job.last_status === "error" ? "failed" : job.enabled === false ? "disabled" : job.state || "ready")}<button type="button" class="settings-save-btn" data-edit-job="${escapeHtml(job.id)}">编辑</button><button type="button" class="settings-save-btn" data-run="${escapeHtml(job.id)}">${job.last_status === "error" ? "重试" : "运行"}</button><button type="button" class="settings-save-btn" data-toggle="${escapeHtml(job.id)}" data-enabled="${job.enabled !== false ? "1" : "0"}">${job.enabled === false ? "恢复" : "暂停"}</button><button type="button" class="settings-save-btn" data-tone="danger" data-delete="${escapeHtml(job.id)}" aria-label="删除 ${escapeHtml(job.name || job.id)}">删除</button></div></article>`).join("") : '<div class="bw-empty">还没有定时任务</div>'}</div>`;
    content.querySelector("[data-new]").addEventListener("click", async () => {
      const values = await openForm({ heading: "新建定时任务", fields: jobFields() });
      if (!values) return;
      await bridge.request(agentApi("/jobs"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(jobPayload(values)) });
      toast("任务已创建", "success");
      await renderJobs(context);
    });
    content.querySelectorAll("[data-edit-job]").forEach((button) => button.addEventListener("click", async () => {
      const detail = await bridge.request(agentApi(`/jobs/${encodeURIComponent(button.dataset.editJob)}`));
      const current = detail.job || detail;
      const values = await openForm({ heading: "编辑定时任务", fields: jobFields(current) });
      if (!values) return;
      await bridge.request(agentApi(`/jobs/${encodeURIComponent(button.dataset.editJob)}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(jobPayload(values, current)) });
      toast("任务已更新", "success");
      await renderJobs(context);
    }));
    content.querySelectorAll("[data-run]").forEach((button) => button.addEventListener("click", async () => {
      await bridge.request(agentApi(`/jobs/${encodeURIComponent(button.dataset.run)}/run`), { method: "POST" });
      toast("任务已触发");
    }));
    content.querySelectorAll("[data-toggle]").forEach((button) => button.addEventListener("click", async () => {
      const action = button.dataset.enabled === "1" ? "pause" : "resume";
      await bridge.request(agentApi(`/jobs/${encodeURIComponent(button.dataset.toggle)}/${action}`), { method: "POST" });
      await renderJobs(context);
    }));
    content.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", async () => {
      if (!await openForm({ heading: "删除定时任务", submitLabel: "确认删除", danger: true, fields: [] })) return;
      await bridge.request(agentApi(`/jobs/${encodeURIComponent(button.dataset.delete)}`), { method: "DELETE" });
      await renderJobs(context);
    }));
  }

  registry.register({ id: "jobs", label: "任务", order: 8, render: renderJobs });
})();
