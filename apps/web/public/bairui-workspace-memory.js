(function () {
  const registry = window.BairuiWorkspaceRegistry;
  if (!registry) return;

  registry.register({
    id: "memory",
    label: "记忆",
    order: 3,
    render: async ({ bridge, agentApi, content, activeAgent, escapeHtml, formatTime, status, openForm, noteBody, download, toast }) => {
      const result = await bridge.request(agentApi("/memory-notes"));
      const notes = result.notes || [];
      const projection = result.projection || { memory: { charCount: 0, limit: 2200, notes: 0 }, user: { charCount: 0, limit: 1375, notes: 0 }, excluded: 0 };
      const sync = result.sync || { status: "idle" };
      const kindLabels = { knowledge: "知识", fact: "事实", preference: "偏好", constraint: "约束", procedure: "流程", person: "人物", project: "项目", event: "事件" };
      const targetLabels = { auto: "自动分配", memory: "MEMORY.md", user: "USER.md", none: "仅 Obsidian" };
      const syncLabels = { pending: "待同步", materialized: "已进入 Hermes", excluded: "容量外", conflict: "有冲突", failed: "同步失败" };
      const jobLabels = { idle: "空闲", pending: "已排队", processing: "同步中", retry: "等待重试", completed: "已完成", dead: "同步失败" };
      const capacity = (target, label) => { const value = projection[target] || {}; const percent = Math.min(100, Math.round((Number(value.charCount) || 0) / Math.max(1, Number(value.limit) || 1) * 100)); return `<section class="bw-memory-meter"><header><div><strong>${label}</strong><span>${value.notes || 0} 条活跃记忆</span></div><b>${value.charCount || 0} / ${value.limit || 0}</b></header><div><i style="width:${percent}%"></i></div></section>`; };
      content.innerHTML = `<div class="bw-memory-summary">${capacity("memory", "Hermes MEMORY.md")}${capacity("user", "Hermes USER.md")}<section class="bw-memory-sync"><strong>Obsidian 主记忆库</strong><span>${notes.length} 篇 · ${projection.excluded || 0} 篇未进入 Hermes 活跃上下文 · ${jobLabels[sync.status] || sync.status}</span><button type="button" data-sync>同步 Hermes</button></section></div><div class="bw-toolbar"><input type="search" placeholder="搜索标题和正文"><div class="bw-actions"><button type="button" data-import>导入 .md</button><button type="button" data-export>导出全部</button><button type="button" class="primary" data-new>＋ 新记忆</button></div></div><input type="file" accept=".md,text/markdown" multiple hidden data-files><div class="bw-list" data-list></div>`;
      const list = content.querySelector("[data-list]");
      const draw = (items) => { list.innerHTML = items.length ? items.map((note) => `<article class="bw-row bw-memory-row"><div><div class="bw-memory-title"><strong>${escapeHtml(note.title)}</strong><span class="bw-memory-kind">${kindLabels[note.memoryKind] || note.memoryKind}</span><span class="bw-memory-importance">重要度 ${note.importance || 3}</span></div><span>${escapeHtml((note.frontmatter?.tags || []).join(" · "))}${note.frontmatter?.tags?.length ? " · " : ""}${targetLabels[note.hermesTarget] || note.hermesTarget} · ${formatTime(note.updatedAt)}</span><p>${escapeHtml(noteBody(note).slice(0, 180))}</p></div><div class="bw-actions">${status(note.hermesSyncStatus || "pending", syncLabels[note.hermesSyncStatus] || note.hermesSyncStatus)}<button type="button" data-edit="${note.id}">编辑</button><button type="button" data-download="${note.id}" title="导出">↓</button><button type="button" data-delete="${note.id}" class="danger-icon" title="删除">×</button></div></article>`).join("") : '<div class="bw-empty">还没有记忆笔记</div>'; };
      draw(notes);
      content.querySelector("input[type=search]").addEventListener("input", async (event) => { const data = await bridge.request(agentApi(`/memory-notes?query=${encodeURIComponent(event.target.value)}`)); draw(data.notes || []); });
      const editNote = async (note) => {
        const values = await openForm({ heading: note ? "编辑记忆" : "新建记忆", fields: [{ name: "title", label: "标题", value: note?.title || "", required: true, maxLength: 200 }, { name: "memoryKind", label: "记忆类型", type: "select", value: note?.memoryKind || "knowledge", options: (result.memoryKinds || Object.keys(kindLabels)).map((value) => ({ value, label: kindLabels[value] || value })) }, { name: "importance", label: "重要度", type: "select", value: String(note?.importance || 3), options: [1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} - ${{ 1: "低", 2: "一般", 3: "常用", 4: "重要", 5: "关键" }[value]}` })) }, { name: "hermesTarget", label: "Hermes 活跃记忆", type: "select", value: note?.hermesTarget || "auto", options: (result.hermesTargets || Object.keys(targetLabels)).map((value) => ({ value, label: targetLabels[value] || value })) }, { name: "tags", label: "标签（逗号分隔）", value: (note?.frontmatter?.tags || []).join(",") }, { name: "body", label: "Markdown 正文", type: "textarea", value: note ? noteBody(note) : "", required: true, rows: 14 }] });
        if (!values) return;
        const payload = { title: values.title, body: values.body, memoryKind: values.memoryKind, importance: Number(values.importance), hermesTarget: values.hermesTarget, tags: values.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean) };
        await bridge.request(agentApi(`/memory-notes${note ? `/${encodeURIComponent(note.id)}` : ""}`), { method: note ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        toast("记忆已保存，后台同步已排队", "success");
        window.dispatchEvent(new CustomEvent("bairui:workspace-refresh"));
      };
      content.querySelector("[data-sync]").addEventListener("click", async (event) => { event.currentTarget.disabled = true; try { await bridge.request(agentApi("/memory-sync"), { method: "POST" }); toast("后台同步任务已排队", "success"); setTimeout(() => window.dispatchEvent(new CustomEvent("bairui:workspace-refresh")), 1200); } catch (error) { toast(error.message, "error"); event.currentTarget.disabled = false; } });
      content.querySelector("[data-new]").addEventListener("click", () => editNote(null));
      list.addEventListener("click", async (event) => { const button = event.target.closest("button"); if (!button) return; const id = button.dataset.edit || button.dataset.download || button.dataset.delete; const note = notes.find((item) => item.id === id); if (button.dataset.edit) return editNote(note); if (button.dataset.download) return download(`${note.slug || "note"}.md`, note.markdown); if (button.dataset.delete && await openForm({ heading: "删除记忆", submitLabel: "确认删除", danger: true, fields: [] })) { await bridge.request(agentApi(`/memory-notes/${encodeURIComponent(id)}`), { method: "DELETE" }); window.dispatchEvent(new CustomEvent("bairui:workspace-refresh")); } });
      const fileInput = content.querySelector("[data-files]");
      content.querySelector("[data-import]").addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", async () => { for (const file of fileInput.files) { const markdown = await file.text(); const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || file.name.replace(/\.md$/i, ""); await bridge.request(agentApi("/memory-notes"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: heading, body: noteBody({ markdown }), memoryKind: "knowledge", importance: 3, hermesTarget: "auto" }) }); } toast("Markdown 已导入", "success"); window.dispatchEvent(new CustomEvent("bairui:workspace-refresh")); });
      content.querySelector("[data-export]").addEventListener("click", () => download(`${activeAgent().name}-obsidian-export.md`, notes.map((note) => note.markdown).join("\n\n---\n\n")));
    }
  });
})();
