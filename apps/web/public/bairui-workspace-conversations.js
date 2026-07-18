(function () {
  const registry = window.BairuiWorkspaceRegistry;
  if (!registry) return;

  async function renderConversations(context) {
    const { bridge, content, agentApi, escapeHtml, formatTime, openForm } = context;
    const sessions = await bridge.listSessions();
    content.innerHTML = `<div class="bw-toolbar"><input type="search" placeholder="搜索会话" aria-label="搜索会话"><button type="button" class="primary" data-new>＋ 新会话</button></div><div class="bw-list" data-list></div>`;
    const list = content.querySelector("[data-list]");
    const draw = (query = "") => {
      const visible = sessions.filter((item) => String(item.title || "新会话").toLowerCase().includes(query.toLowerCase()));
      list.innerHTML = visible.length ? visible.map((item) => `<article class="bw-row ${item.id === bridge.state.activeSessionId ? "selected" : ""}"><div><strong>${escapeHtml(item.title || "新会话")}</strong><span>${formatTime(item.updated_at || item.created_at)}</span></div><div class="bw-actions"><button type="button" data-open="${escapeHtml(item.id)}">打开</button><button type="button" data-rename="${escapeHtml(item.id)}" title="重命名">✎</button><button type="button" data-fork="${escapeHtml(item.id)}">分支</button><button type="button" data-delete="${escapeHtml(item.id)}" class="danger-icon" title="删除">×</button></div></article>`).join("") : '<div class="bw-empty">没有匹配的会话</div>';
    };
    draw();
    content.querySelector("input").addEventListener("input", (event) => draw(event.target.value));
    content.querySelector("[data-new]").addEventListener("click", async () => {
      await bridge.createSession("新会话");
      location.reload();
    });
    list.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.open) return bridge.activateSession(button.dataset.open);
      const id = button.dataset.rename || button.dataset.fork || button.dataset.delete;
      const current = sessions.find((item) => item.id === id);
      if (button.dataset.rename) {
        const values = await openForm({ heading: "重命名会话", fields: [{ name: "title", label: "标题", value: current?.title || "", required: true, maxLength: 200 }] });
        if (values) await bridge.request(agentApi(`/sessions/${encodeURIComponent(id)}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      } else if (button.dataset.fork) {
        await bridge.request(agentApi(`/sessions/${encodeURIComponent(id)}/fork`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: `${current?.title || "会话"} 分支` }) });
      } else if (button.dataset.delete) {
        const values = await openForm({ heading: "删除会话", submitLabel: "确认删除", danger: true, fields: [] });
        if (values) await bridge.request(agentApi(`/sessions/${encodeURIComponent(id)}`), { method: "DELETE" });
      }
      await renderConversations(context);
    });
  }

  registry.register({ id: "conversations", label: "会话", order: 1, render: renderConversations });
})();
