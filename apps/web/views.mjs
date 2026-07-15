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

export function userPage(principal) {
  const adminLink = ["org_admin", "platform_admin"].includes(principal.role)
    ? '<a class="brain-nav-link" href="/admin">总控后台</a>'
    : "";
  return shell({
    title: "Agent 工作区",
    view: "user",
    script: "/assets/user.js",
    body: `<div class="brain-app">
  <header class="brain-header">
    <a class="brain-brand" href="/app" aria-label="bairui-agent 工作区">
      <img src="/assets/bairui-agent-logo.png" alt="">
      <span><small>认知界面</small><strong>bairui-agent</strong></span>
    </a>
    <nav class="brain-header-actions" aria-label="工作区导航">
      <div class="brain-view-tabs" role="tablist" aria-label="工作视图">
        <button class="brain-view-tab active" type="button" data-view-target="chat-view">对话</button>
        <button class="brain-view-tab" type="button" data-view-target="hotspot-view">热点</button>
        <button class="brain-view-tab" type="button" data-view-target="memory-view">记忆</button>
      </div>
      ${adminLink}
      <span class="brain-account"><strong>${escapeHtml(principal.displayName)}</strong><small>${escapeHtml(principal.email)}</small></span>
      <button id="logout-button" class="brain-quiet-button" type="button">退出</button>
    </nav>
  </header>

  <main id="chat-view" class="brain-layout brain-work-view">
    <aside class="brain-panel brain-primary-panel" aria-label="会话处理器">
      <div class="brain-panel-title">
        <div><span class="brain-kicker">消息通道</span><h1>用户消息处理器</h1></div>
        <span id="runtime-status" class="brain-pill unknown">连接中</span>
      </div>
      <div class="brain-activity">
        <span class="brain-activity-dot"></span>
        <span id="runtime-status-label">正在读取工作区</span>
      </div>
      <section class="brain-conversation-section">
        <div class="brain-section-heading">
          <h2>会话</h2>
          <button id="new-conversation" class="brain-icon-button" type="button" title="新建会话" aria-label="新建会话">+</button>
        </div>
        <div id="conversation-items" class="brain-conversation-list"></div>
      </section>
      <footer class="brain-panel-footer">
        <span id="conversation-count">0 个会话</span>
        <span id="agent-name">bairui-agent</span>
      </footer>
    </aside>

    <section class="brain-stage" aria-label="Agent 对话">
      <header class="brain-stage-header">
        <div><span class="brain-kicker">当前会话</span><h2 id="current-conversation-title">新会话</h2></div>
        <span class="brain-stage-state"><i></i>Hermes Runtime</span>
      </header>
      <div id="chat-scroll" class="brain-chat-scroll">
        <div id="chat-empty" class="brain-empty-state">
          <img src="/assets/bairui-agent-logo.png" alt="">
          <strong>bairui-agent</strong>
          <span>开始一段新会话</span>
        </div>
        <div id="message-list" class="brain-message-list"></div>
      </div>
      <form id="message-form" class="brain-composer">
        <span class="brain-prompt-mark">▸</span>
        <textarea name="content" rows="1" maxlength="20000" placeholder="向 bairui-agent 发送消息..." aria-label="输入消息" required></textarea>
        <button id="send-message" type="submit">发送</button>
      </form>
    </section>

    <aside class="brain-panel brain-secondary-panel" aria-label="运行状态">
      <div class="brain-runtime-stats">
        <div><span>状态</span><strong id="agent-state">读取中</strong></div>
        <div><span>会话</span><strong id="runtime-conversation-count">0</strong></div>
        <div><span>权限</span><strong>${escapeHtml(principal.role)}</strong></div>
      </div>
      <section class="brain-runtime-section">
        <div class="brain-section-heading"><div><span class="brain-kicker">运行通道</span><h2>自主行动机制 · Runtime</h2></div></div>
        <div class="brain-runtime-line"><span>Agent</span><strong>bairui-agent</strong></div>
        <div class="brain-runtime-line"><span>核心</span><strong>Hermes</strong></div>
        <div class="brain-runtime-line"><span>平台会话</span><strong class="brain-live"><i></i>已连接</strong></div>
      </section>
      <section class="brain-runtime-section brain-account-section">
        <span class="brain-kicker">当前身份</span>
        <strong>${escapeHtml(principal.displayName)}</strong>
        <span>${escapeHtml(principal.email)}</span>
      </section>
    </aside>
  </main>

  <main id="hotspot-view" class="feature-workspace brain-work-view" hidden>
    <header class="feature-header">
      <div><span class="brain-kicker">实时数据</span><h1>热点分析</h1></div>
      <div class="feature-meta"><span id="hotspot-updated">尚未采集</span><span id="hotspot-total">0 条</span></div>
    </header>
    <section class="feature-band" aria-labelledby="hotspot-sources-title">
      <div class="section-heading"><h2 id="hotspot-sources-title">数据来源</h2><span id="hotspot-run-status" class="brain-pill unknown">等待数据</span></div>
      <div id="hotspot-source-tabs" class="source-tabs" role="tablist"></div>
    </section>
    <section class="feature-band hotspot-results" aria-labelledby="hotspot-list-title">
      <div class="section-heading"><h2 id="hotspot-list-title">热点榜单</h2><span class="feature-caption">TrendRadar / NewsNow 标准化数据</span></div>
      <div id="hotspot-list" class="hotspot-list"></div>
    </section>
  </main>

  <main id="memory-view" class="feature-workspace memory-workspace brain-work-view" hidden>
    <header class="feature-header">
      <div><span class="brain-kicker">Obsidian Markdown</span><h1>记忆与知识笔记</h1></div>
      <span id="memory-count" class="feature-caption">0 篇</span>
    </header>
    <section class="memory-editor feature-band">
      <form id="memory-form" class="memory-form">
        <label>标题<input name="title" maxlength="160" required></label>
        <label>标签<input name="tags" placeholder="项目, 决策, 客户"></label>
        <label>关联笔记<input name="wikilinks" placeholder="项目总览, 技术框架"></label>
        <label>正文<textarea name="body" rows="8" maxlength="50000" required></textarea></label>
        <button class="primary-button" type="submit">保存笔记</button>
      </form>
      <div id="memory-list" class="memory-list" aria-live="polite"></div>
    </section>
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
    <header class="topbar"><div><p class="eyebrow">${scopeLabel}</p><h1>bairui-agent 总控</h1></div><span id="control-status" class="status unknown">读取中</span></header>
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
