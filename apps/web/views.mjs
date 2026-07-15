function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function shell({ title, view, body, script }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | BaiRui</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body data-view="${escapeHtml(view)}">
${body}
<script src="${escapeHtml(script)}" defer></script>
</body>
</html>`;
}

export function loginPage() {
  return shell({
    title: "登录",
    view: "login",
    script: "/assets/login.js",
    body: `<main class="auth-shell">
  <section class="auth-panel" aria-labelledby="login-title">
    <div class="brand-mark">BR</div>
    <p class="brand-name">BaiRui Agent</p>
    <h1 id="login-title">登录工作区</h1>
    <form id="login-form" class="form-stack">
      <label>邮箱<input name="email" type="email" autocomplete="username" required></label>
      <label>密码<input name="password" type="password" autocomplete="current-password" required minlength="12"></label>
      <p id="form-error" class="form-error" role="alert" hidden></p>
      <button type="submit" class="primary-button">登录</button>
    </form>
  </section>
</main>`
  });
}

function navigation(principal, active) {
  const admin = ["org_admin", "platform_admin"].includes(principal.role)
    ? `<a class="nav-link ${active === "admin" ? "active" : ""}" href="/admin">总控后台</a>`
    : "";
  return `<aside class="sidebar">
  <div class="sidebar-brand"><span class="brand-mark small">BR</span><span>BaiRui</span></div>
  <nav aria-label="主导航">
    <a class="nav-link ${active === "app" ? "active" : ""}" href="/app">Agent 工作区</a>
    ${admin}
  </nav>
  <div class="account-block">
    <strong>${escapeHtml(principal.displayName)}</strong>
    <span>${escapeHtml(principal.email)}</span>
    <button id="logout-button" class="quiet-button" type="button">退出</button>
  </div>
</aside>`;
}

export function userPage(principal) {
  return shell({
    title: "Agent 工作区",
    view: "user",
    script: "/assets/user.js",
    body: `<div class="app-shell">
  ${navigation(principal, "app")}
  <main class="workspace">
    <header class="topbar"><div><p class="eyebrow">工作区</p><h1>Agent 对话</h1></div><span id="runtime-status" class="status unknown">连接中</span></header>
    <div class="workspace-grid">
      <section class="conversation-list" aria-label="会话列表">
        <div class="section-heading"><h2>会话</h2><button id="new-conversation" class="icon-button" type="button" title="新建会话" aria-label="新建会话">+</button></div>
        <div id="conversation-items" class="list-stack"></div>
      </section>
      <section class="chat-surface" aria-label="对话">
        <div id="message-list" class="message-list"></div>
        <form id="message-form" class="composer">
          <textarea name="content" rows="2" maxlength="20000" placeholder="输入消息" required></textarea>
          <button type="submit" class="primary-button">发送</button>
        </form>
      </section>
    </div>
  </main>
</div>`
  });
}

export function adminPage(principal) {
  const scopeLabel = principal.role === "platform_admin" ? "平台全局" : "当前组织";
  return shell({
    title: "总控后台",
    view: "admin",
    script: "/admin/assets/admin.js",
    body: `<div class="app-shell">
  ${navigation(principal, "admin")}
  <main class="workspace admin-workspace">
    <header class="topbar"><div><p class="eyebrow">${scopeLabel}</p><h1>百瑞总控</h1></div><span id="control-status" class="status unknown">读取中</span></header>
    <section class="metric-band" aria-label="总控摘要">
      <div><span>用户</span><strong id="metric-users">-</strong></div>
      <div><span>部署快照</span><strong id="metric-snapshots">-</strong></div>
      <div><span>服务器</span><strong id="metric-servers">-</strong></div>
      <div><span>许可证</span><strong id="metric-licenses">-</strong></div>
      <div><span>发布</span><strong id="metric-releases">-</strong></div>
      <div><span>最近事件</span><strong id="metric-audit">-</strong></div>
    </section>
    <section class="admin-section">
      <div class="section-heading"><h2>模块与服务器状态</h2><button id="refresh-admin" class="quiet-button" type="button">刷新</button></div>
      <div class="table-wrap"><table><thead><tr><th>服务器</th><th>状态</th><th>时间</th></tr></thead><tbody id="snapshot-rows"></tbody></table></div>
    </section>
    <section class="admin-section">
      <h2>成员</h2>
      <div class="table-wrap"><table><thead><tr><th>用户</th><th>角色</th><th>状态</th></tr></thead><tbody id="user-rows"></tbody></table></div>
    </section>
    <section class="admin-section">
      <h2>服务器</h2>
      <div class="table-wrap"><table><thead><tr><th>名称</th><th>状态</th><th>运行版本</th></tr></thead><tbody id="server-rows"></tbody></table></div>
    </section>
    <section class="admin-section">
      <h2>许可证</h2>
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>套餐</th><th>状态</th><th>到期</th></tr></thead><tbody id="license-rows"></tbody></table></div>
    </section>
    <section class="admin-section" id="release-section">
      <h2>发布</h2>
      <div class="table-wrap"><table><thead><tr><th>版本</th><th>状态</th><th>Agent Commit</th></tr></thead><tbody id="release-rows"></tbody></table></div>
    </section>
    <section class="admin-section">
      <h2>审计记录</h2>
      <div class="table-wrap"><table><thead><tr><th>操作</th><th>对象</th><th>时间</th></tr></thead><tbody id="audit-rows"></tbody></table></div>
    </section>
  </main>
</div>`
  });
}
