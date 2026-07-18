(function () {
  const bridge = window.bairuiPlatform;
  if (!bridge) return;

  const entries = new Map();
  const workspaceRegistry = {
    register(definition) {
      if (!definition || !/^[a-z][a-z0-9-]*$/.test(definition.id || "") || typeof definition.render !== "function") {
        throw new Error("invalid_workspace_extension");
      }
      entries.set(definition.id, Object.freeze({
        id: definition.id,
        label: String(definition.label || definition.id),
        order: Number(definition.order) || 100,
        render: definition.render,
        dispose: typeof definition.dispose === "function" ? definition.dispose : null
      }));
      window.dispatchEvent(new CustomEvent("bairui:workspace-registry-changed"));
    },
    get(id) {
      return entries.get(id) || null;
    },
    list() {
      return [...entries.values()].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    }
  };
  Object.defineProperty(window, "BairuiWorkspaceRegistry", {
    value: Object.freeze(workspaceRegistry),
    configurable: false,
    enumerable: false,
    writable: false
  });

  const STATUS_LABELS = Object.freeze({
    ready: "正常", active: "正常", connected: "已连接", applied: "已生效", pending: "待应用",
    provisioning: "初始化中", starting: "启动中", suspended: "已暂停", stopped: "已停止",
    initializing: "初始化中", uninitialized: "未初始化", offline: "Runtime 离线", upgrading: "升级中",
    model_unconfigured: "模型未配置", quota_exhausted: "额度已用尽", deleting: "删除中", deleted: "已删除",
    failed: "失败", degraded: "降级", unavailable: "不可用", unconfigured: "未配置", disabled: "已停用",
    unknown: "未知", started: "已启动", queued: "排队中", running: "运行中",
    waiting_for_approval: "等待审批", stopping: "停止中", completed: "已完成", cancelled: "已取消",
    scheduled: "已计划", paused: "已暂停", ok: "成功", error: "失败", stored: "已安全保存",
    revoked: "已吊销", configured: "已配置", available: "可用", materialized: "已同步", excluded: "未投影",
    conflict: "冲突"
  });
  const ERROR_LABELS = Object.freeze({
    runtime_unavailable: "Agent Runtime 当前不可用",
    runtime_route_unavailable: "Agent 还没有可用的运行环境",
    model_not_allowed: "该模型不在管理员允许范围内",
    model_not_configured: "管理员尚未配置可用模型",
    quota_exhausted: "当前用量额度已耗尽",
    runtime_offline: "Agent Runtime 已离线",
    agent_not_ready: "Agent 当前尚未就绪",
    Forbidden: "当前账户没有执行此操作的权限",
    agent_not_initialized: "Agent 尚未初始化",
    no_agent_capacity: "当前没有可用服务器容量",
    memory_projection_unavailable: "当前 Runtime 版本尚未支持 Hermes 记忆同步",
    memory_projection_conflict: "Hermes 记忆在同步期间发生变化，请重新同步"
  });

  const workspaceState = { view: "conversations", renderRevision: 0 };
  let root;
  let nav;
  let content;
  let title;
  let agentLabel;
  let modal;
  let activeExtension;
  let lastFocused;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function formatTime(value) {
    if (!value) return "--";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "--"
      : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function status(value, label) {
    const key = String(value || "unknown");
    return `<span class="bw-status bw-status-${escapeHtml(key)}">${escapeHtml(label || STATUS_LABELS[key] || key)}</span>`;
  }

  function activeAgent() {
    return bridge.state.activeAgent;
  }

  function agentApi(path = "") {
    return `/api/user/agents/${encodeURIComponent(activeAgent().id)}${path}`;
  }

  function normalizeList(value, keys = []) {
    if (Array.isArray(value)) return value;
    for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
    return Array.isArray(value?.data) ? value.data : [];
  }

  function createElement(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = String(options.text);
    if (options.type) element.type = options.type;
    for (const [name, value] of Object.entries(options.attributes || {})) {
      if (value !== null && value !== undefined) element.setAttribute(name, String(value));
    }
    for (const child of options.children || []) if (child) element.appendChild(child);
    return element;
  }

  function loadingNode() {
    return createElement("div", {
      className: "bw-loading",
      children: [createElement("span", { attributes: { "aria-hidden": "true" } }), document.createTextNode("正在读取真实状态")]
    });
  }

  function fitDialogToVisualViewport(dialog) {
    const zoom = Number.parseFloat(document.documentElement.style.zoom) || Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    dialog.style.maxWidth = `${Math.max(1, (window.innerWidth - 28) / zoom)}px`;
    dialog.style.maxHeight = `${Math.max(1, (window.innerHeight - 32) / zoom)}px`;
  }

  function showError(error) {
    const retry = createElement("button", { className: "settings-save-btn", text: "重试", type: "button" });
    retry.addEventListener("click", () => render(workspaceState.view));
    content.replaceChildren(createElement("div", {
      className: "bw-empty bw-error",
      children: [
        createElement("strong", { text: "无法加载" }),
        createElement("p", { text: ERROR_LABELS[error?.message] || error?.message || "未知错误" }),
        retry
      ]
    }));
  }

  function toast(message, tone = "info") {
    const item = createElement("div", {
      className: `bairui-extension-toast tone-${tone}`,
      text: message,
      attributes: { role: tone === "error" ? "alert" : "status" }
    });
    document.body.appendChild(item);
    requestAnimationFrame(() => item.classList.add("visible"));
    setTimeout(() => {
      item.classList.remove("visible");
      setTimeout(() => item.remove(), 200);
    }, 3200);
  }

  function openForm({ heading, submitLabel = "保存", fields = [], danger = false }) {
    return new Promise((resolve) => {
      const dialog = createElement("dialog", {
        className: "settings-modal bairui-extension-dialog",
        attributes: { "aria-labelledby": "bairui-extension-dialog-title" }
      });
      const form = createElement("form", { className: "bairui-extension-dialog-form" });
      const closeButton = createElement("button", { className: "settings-close", text: "×", type: "button", attributes: { "aria-label": "关闭" } });
      const header = createElement("header", {
        className: "settings-header",
        children: [createElement("strong", { className: "settings-title", text: heading, attributes: { id: "bairui-extension-dialog-title" } }), closeButton]
      });
      const fieldContainer = createElement("div", { className: "settings-content bairui-extension-dialog-content" });
      for (const field of fields) {
        const input = field.type === "textarea"
          ? createElement("textarea", { className: "settings-input" })
          : field.type === "select"
            ? createElement("select", { className: "settings-select" })
            : createElement("input", { className: "settings-input" });
        input.name = field.name;
        if (field.type && !["textarea", "select"].includes(field.type)) input.type = field.type;
        if (field.type === "textarea") input.rows = field.rows || 6;
        input.required = Boolean(field.required);
        if (field.placeholder) input.placeholder = field.placeholder;
        if (field.maxLength) input.maxLength = field.maxLength;
        if (field.type === "select") {
          for (const option of field.options || []) input.add(new Option(option.label, option.value, false, option.value === field.value));
        } else {
          input.value = field.value ?? "";
        }
        fieldContainer.appendChild(createElement("label", {
          className: "settings-row bairui-extension-field",
          children: [createElement("span", { className: "settings-label", text: field.label }), input]
        }));
      }
      const cancelButton = createElement("button", { className: "settings-save-btn", text: "取消", type: "button" });
      const submitButton = createElement("button", {
        className: "settings-save-btn",
        text: submitLabel,
        type: "submit",
        attributes: danger ? { "data-tone": "danger" } : {}
      });
      const footer = createElement("footer", { className: "settings-row-action bairui-extension-dialog-actions", children: [cancelButton, submitButton] });
      form.append(header, fieldContainer, footer);
      dialog.appendChild(form);
      document.body.appendChild(dialog);
      fitDialogToVisualViewport(dialog);
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        dialog.close();
        dialog.remove();
        resolve(value);
      };
      closeButton.addEventListener("click", () => finish(null));
      cancelButton.addEventListener("click", () => finish(null));
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(null); });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        finish(Object.fromEntries(new FormData(form)));
      });
      dialog.showModal();
      form.querySelector("input, textarea, select, button")?.focus();
    });
  }

  function noteBody(note) {
    let text = String(note.markdown || "");
    text = text.replace(/^---\n[\s\S]*?\n---\n+/, "");
    text = text.replace(/^# .+\n+/, "");
    text = text.replace(/\n+## 关联\n[\s\S]*$/, "");
    return text.trim();
  }

  function download(name, data, type = "text/markdown;charset=utf-8") {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([data], { type }));
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function context() {
    return {
      bridge, content, activeAgent, agentApi, escapeHtml, formatTime, status, toast, openForm,
      noteBody, download, normalizeList, statusLabels: STATUS_LABELS, workspaceState, closeWorkspace
    };
  }

  function disposeCurrent() {
    if (!activeExtension?.dispose) return;
    try { activeExtension.dispose(context()); } catch (error) { console.warn("[bairui-workspace]", error.message); }
  }

  function syncNavigation() {
    if (!nav) return;
    nav.replaceChildren(...workspaceRegistry.list().map((extension) => {
      const button = createElement("button", {
        className: `settings-nav-item${extension.id === workspaceState.view ? " active" : ""}`,
        text: extension.label,
        type: "button",
        attributes: { "data-view": extension.id }
      });
      button.addEventListener("click", () => render(extension.id));
      return button;
    }));
  }

  async function render(view) {
    const extension = workspaceRegistry.get(view) || workspaceRegistry.list()[0];
    if (!extension || !content) return;
    if (activeExtension?.id !== extension.id) disposeCurrent();
    activeExtension = extension;
    workspaceState.view = extension.id;
    const revision = ++workspaceState.renderRevision;
    title.textContent = extension.label;
    agentLabel.textContent = activeAgent()?.name || "Agent";
    syncNavigation();
    content.replaceChildren(loadingNode());
    try {
      await extension.render(context());
    } catch (error) {
      if (revision === workspaceState.renderRevision) showError(error);
    }
  }

  function syncWorkspaceGeometry() {
    if (!modal) return;
    const zoom = Number.parseFloat(document.documentElement.style.zoom) || Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const mobile = window.matchMedia("(max-width: 780px)").matches;
    const horizontalGutter = mobile ? 0 : 40;
    const verticalGutter = mobile ? 0 : 64;
    const width = Math.max(1, Math.min(1180, (window.innerWidth - horizontalGutter) / zoom));
    const height = Math.max(1, Math.min(760, (window.innerHeight - verticalGutter) / zoom));
    Object.assign(modal.style, {
      width: `${width}px`,
      height: `${height}px`,
      maxWidth: `${width}px`,
      maxHeight: `${height}px`
    });
  }

  function openWorkspace(view = workspaceState.view) {
    if (!root) return;
    lastFocused = document.activeElement;
    syncWorkspaceGeometry();
    root.hidden = false;
    root.inert = false;
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("bairui-workspace-open");
    render(view);
    root.querySelector("[data-bairui-workspace-close]")?.focus();
  }

  function closeWorkspace() {
    if (!root || root.hidden) return;
    disposeCurrent();
    activeExtension = null;
    workspaceState.renderRevision += 1;
    root.hidden = true;
    root.inert = true;
    root.setAttribute("aria-hidden", "true");
    document.body.classList.remove("bairui-workspace-open");
    window.dispatchEvent(new CustomEvent("bairui:chat-layout"));
    if (lastFocused instanceof HTMLElement && document.contains(lastFocused)) lastFocused.focus();
  }

  function mount() {
    root = document.querySelector("[data-bairui-extension-host]");
    if (!root) {
      console.warn("[bairui-workspace] native extension host is unavailable");
      return;
    }
    nav = root.querySelector("[data-bairui-workspace-nav]");
    content = root.querySelector("[data-bairui-workspace-content]");
    title = root.querySelector("#bairui-workspace-title");
    agentLabel = root.querySelector("[data-bairui-workspace-agent]");
    modal = root.querySelector(".bairui-workspace-modal");
    root.inert = true;
    syncNavigation();
    root.querySelector("[data-bairui-workspace-close]")?.addEventListener("click", closeWorkspace);
    root.addEventListener("click", (event) => { if (event.target === root) closeWorkspace(); });
    window.addEventListener("bairui:workspace-open", (event) => openWorkspace(event.detail?.view));
    window.addEventListener("bairui:workspace-refresh", () => { if (!root.hidden) render(workspaceState.view); });
    window.addEventListener("bairui:workspace-registry-changed", syncNavigation);
    window.addEventListener("resize", () => { if (!root.hidden) syncWorkspaceGeometry(); }, { passive: true });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !root.hidden && !document.querySelector("dialog[open]")) closeWorkspace();
    });
  }

  window.addEventListener("DOMContentLoaded", mount, { once: true });
})();
