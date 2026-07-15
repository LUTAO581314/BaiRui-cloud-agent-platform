function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function shell({ title, view, body, script }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | bairui-agent</title>
  <link rel="icon" type="image/png" href="/assets/bairui-agent-icon.png">
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
    <img class="brand-mark login-mark" src="/assets/bairui-agent-logo.png" alt="">
    <p class="brand-name">bairui-agent</p>
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
  <div class="sidebar-brand"><img class="brand-mark small" src="/assets/bairui-agent-logo.png" alt=""><span>bairui-agent</span></div>
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

export function adminPage(principal) {
  const scopeLabel = principal.role === "platform_admin" ? "平台全局" : "当前组织";
  return shell({
    title: "总控后台",
    view: "admin",
    script: "/admin/assets/admin.js",
    body: `<div class="app-shell">
  ${navigation(principal, "admin")}
  <main class="workspace admin-workspace">
    <header class="topbar"><div><p class="eyebrow">${scopeLabel}</p><h1>bairui-agent 总控</h1></div><span id="control-status" class="status unknown">读取中</span></header>
    <section class="metric-band" aria-label="总控摘要">
      <div><span>用户</span><strong id="metric-users">-</strong></div>
      <div><span>Agent</span><strong id="metric-agents">-</strong></div>
      <div><span>健康 Runtime</span><strong id="metric-runtimes">-</strong></div>
      <div><span>开放告警</span><strong id="metric-alerts">-</strong></div>
      <div><span>服务器</span><strong id="metric-servers">-</strong></div>
      <div><span>发布</span><strong id="metric-releases">-</strong></div>
    </section>
    <section class="admin-section">
      <div class="section-heading"><h2>Agent 舰队</h2><button id="refresh-admin" class="quiet-button" type="button">刷新</button></div>
      <div class="table-wrap"><table><thead><tr><th>Agent</th><th>用户</th><th>状态</th><th>Runtime</th><th>Hermes</th><th>组件</th><th>最后心跳</th></tr></thead><tbody id="agent-rows"></tbody></table></div>
    </section>
    <section class="admin-section">
      <h2>开放告警</h2>
      <div class="table-wrap"><table><thead><tr><th>级别</th><th>代码</th><th>Agent</th><th>说明</th><th>最后发生</th></tr></thead><tbody id="alert-rows"></tbody></table></div>
    </section>
    <section class="admin-section">
      <div class="section-heading"><h2>服务器快照</h2></div>
      <div class="table-wrap"><table><thead><tr><th>服务器</th><th>状态</th><th>时间</th></tr></thead><tbody id="snapshot-rows"></tbody></table></div>
    </section>
    ${principal.role === "platform_admin" ? `<section class="admin-section provider-settings-section">
      <div class="section-heading"><div><p class="eyebrow">仅平台管理员</p><h2>Hermes 模型供应商</h2></div><span id="provider-apply-status" class="status unknown">未配置</span></div>
      <form id="provider-settings-form" class="admin-form-grid">
        <label>供应商<input name="provider" placeholder="openai-compatible" required></label>
        <label>Base URL<input name="baseUrl" type="url" placeholder="https://api.example.com/v1" required></label>
        <label>模型<input name="model" placeholder="provider/model-name" required></label>
        <label>API Key<input name="apiKey" type="password" autocomplete="new-password" placeholder="留空则保留现有密钥"></label>
        <p id="provider-key-state" class="form-hint">尚未保存供应商密钥</p>
        <button class="primary-button" type="submit">保存配置</button>
      </form>
      <p class="form-hint">配置会加密保存并进入待应用状态。Hermes API Server Key 与 Runtime Shared Secret 不在网页中暴露。</p>
    </section>` : ""}
    <section class="admin-section">
      <div class="section-heading"><h2>集成项目</h2><button id="refresh-hotspots" class="quiet-button" type="button">刷新热点数据</button></div>
      <div class="table-wrap"><table><thead><tr><th>项目</th><th>所在层</th><th>接入方式</th><th>状态</th></tr></thead><tbody id="integration-rows"></tbody></table></div>
    </section>
    <section class="admin-section">
      <h2>最近集成运行</h2>
      <div class="table-wrap"><table><thead><tr><th>能力</th><th>状态</th><th>结果</th><th>时间</th></tr></thead><tbody id="integration-run-rows"></tbody></table></div>
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
