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

const ADMIN_VIEWS = [
  ["overview", "总览"], ["users", "用户"], ["agents", "Agent 舰队"], ["operations", "运行监控"],
  ["providers", "Provider 池"], ["integrations", "服务集成"], ["channels", "渠道舰队"], ["config", "配置中心"],
  ["versions", "版本中心"], ["alerts", "告警中心"], ["audit", "审计"], ["release", "发布门禁"],
  ["backups", "备份恢复"], ["retention", "数据保留"], ["sensitive", "敏感访问"]
];

function table(id, headings) {
  return `<div class="table-wrap"><table><thead><tr>${headings.map((item) => `<th>${item}</th>`).join("")}</tr></thead><tbody id="${id}"></tbody></table></div>`;
}

export function adminPage(principal) {
  const platformAdmin = principal.role === "platform_admin";
  const visibleViews = ADMIN_VIEWS.filter(([id]) => platformAdmin || !["providers", "sensitive"].includes(id));
  const nav = visibleViews.map(([id, label], index) => `<button class="admin-nav-item${index === 0 ? " active" : ""}" type="button" data-admin-view="${id}">${label}</button>`).join("");
  return shell({
    title: "百瑞总控",
    view: "admin",
    script: "/admin/assets/admin.js",
    body: `<div class="control-shell" data-admin-role="${escapeHtml(principal.role)}" data-organization-id="${escapeHtml(principal.organizationId)}">
  <aside class="control-sidebar">
    <a class="control-brand" href="/admin"><img src="/assets/bairui-agent-logo.png" alt=""><span><strong>bairui-agent</strong><small>CONTROL PLANE</small></span></a>
    <nav class="admin-nav" aria-label="总控导航">${nav}</nav>
    <div class="control-account"><strong>${escapeHtml(principal.displayName)}</strong><span>${escapeHtml(principal.email)}</span><a href="/app">用户工作区</a><button id="logout-button" type="button">退出</button></div>
  </aside>
  <main class="control-main">
    <header class="control-topbar">
      <div><p id="admin-eyebrow">${platformAdmin ? "平台全局" : "当前组织"}</p><h1 id="admin-title">总览</h1></div>
      <div class="control-top-actions">${platformAdmin ? `<label class="scope-select">组织<select id="organization-scope"><option value="">全部组织</option></select></label>` : ""}<label class="scope-select">Agent<select id="control-agent-scope"><option value="">选择 Agent</option></select></label><span id="control-status" class="status unknown">正在读取</span><button id="refresh-admin" class="quiet-button" type="button">刷新</button></div>
    </header>
    <p id="admin-error" class="control-error" role="alert" hidden></p>

    <section class="admin-view active" data-view-panel="overview">
      <div class="metric-band control-metrics">
        <div><span>用户</span><strong id="metric-users">-</strong></div><div><span>Agent</span><strong id="metric-agents">-</strong></div>
        <div><span>健康 Runtime</span><strong id="metric-runtimes">-</strong></div><div><span>开放告警</span><strong id="metric-alerts">-</strong></div>
        <div><span>服务器</span><strong id="metric-servers">-</strong></div><div><span>本月成本</span><strong id="metric-cost">-</strong></div>
      </div>
      <div class="control-grid two"><section class="control-section"><div class="section-heading"><h2>最近 Agent 状态</h2><button class="text-command" data-goto="agents" type="button">查看全部</button></div>${table("overview-agent-rows", ["Agent", "所有者", "Runtime", "版本", "最后心跳"])}</section>
      <section class="control-section"><div class="section-heading"><h2>需要处理</h2><button class="text-command" data-goto="alerts" type="button">进入告警</button></div>${table("overview-alert-rows", ["级别", "告警", "Agent", "时间"])}</section></div>
      <section class="control-section"><h2>服务器快照</h2>${table("snapshot-rows", ["服务器", "状态", "版本", "接收时间"])}</section>
    </section>

    <section class="admin-view" data-view-panel="users"><div class="section-toolbar"><div><h2>用户与权限</h2><p>账户状态、角色和 Agent 归属</p></div></div>${table("user-rows", ["用户", "组织", "角色", "状态", "创建时间"])}</section>
    <section class="admin-view" data-view-panel="agents"><div class="section-toolbar"><div><h2>Agent 舰队</h2><p>每位用户的独立 Hermes Runtime</p></div></div>${table("agent-rows", ["Agent", "所有者", "期望状态", "初始化", "Runtime", "Hermes", "组件", "最后心跳"])}</section>
    <section class="admin-view" data-view-panel="operations"><div class="section-toolbar"><div><h2>运行检查</h2><p>固定探针、契约测试和 Agent 冒烟测试</p></div><div class="toolbar-actions"><button class="quiet-button" data-control-action="probe.run" type="button">运行探针</button><button class="quiet-button" data-control-action="contract.test" type="button">契约测试</button><button class="quiet-button" data-control-action="smoke.test" type="button">冒烟测试</button></div></div><div class="metric-band four"><div><span>运行次数</span><strong id="usage-runs">-</strong></div><div><span>失败</span><strong id="usage-failures">-</strong></div><div><span>Token</span><strong id="usage-tokens">-</strong></div><div><span>平均延迟</span><strong id="usage-latency">-</strong></div></div><section class="control-section"><h2>控制命令</h2>${table("control-command-rows", ["创建时间", "Agent", "动作", "状态", "审批", "请求人"])}</section><section class="control-section"><h2>遥测事件</h2>${table("telemetry-rows", ["时间", "级别", "Agent", "层", "组件", "事件", "追踪 ID"])}</section></section>

    <section class="admin-view" data-view-panel="providers">
      <div class="section-toolbar"><div><h2>Provider 池与模型政策</h2><p>平台密钥只加密保存，浏览器不会读取密文</p></div></div>
      <section class="control-section"><div class="section-heading"><h2>模型渠道</h2><button id="new-provider-channel" class="primary-button compact" type="button">新增渠道</button></div>${table("provider-channel-rows", ["名称", "Provider", "模型", "状态", "优先级", "权重", "并发", "月预算", "密钥"])}</section>
      <form id="provider-channel-form" class="control-form" hidden><input name="name" placeholder="渠道名称" required><input name="provider" placeholder="Provider" required><input name="baseUrl" type="url" placeholder="https://api.example.com/v1" required><input name="model" placeholder="模型 ID" required><input name="apiKey" type="password" autocomplete="new-password" placeholder="API Key"><input name="priority" type="number" min="0" value="100" required><input name="weight" type="number" min="1" value="1" required><input name="maxConcurrency" type="number" min="1" placeholder="最大并发"><input name="monthlyBudgetUsd" type="number" min="0" step="0.01" placeholder="月预算 USD"><label class="check-field"><input name="enabled" type="checkbox" checked>启用</label><div class="form-actions"><button class="primary-button" type="submit">保存渠道</button><button class="quiet-button" data-close-form="provider-channel-form" type="button">取消</button></div></form>
      <form id="model-policy-form" class="control-section policy-form"><h2>模型政策</h2><label>允许模型（每行一个）<textarea name="allowedModels" rows="5"></textarea></label><label>默认模型<input name="defaultModel"></label><label>每日 Token 上限<input name="dailyTokenLimit" type="number" min="0"></label><label>每月预算 USD<input name="monthlyBudgetUsd" type="number" min="0" step="0.01"></label><label class="check-field"><input name="userCustomKeysAllowed" type="checkbox">允许用户自定义模型密钥</label><button class="primary-button compact" type="submit">保存政策</button></form>
    </section>

    <section class="admin-view" data-view-panel="integrations"><div class="section-toolbar"><div><h2>服务集成</h2><p>五层架构中的外部能力与最近执行结果</p></div><button id="refresh-hotspots" class="quiet-button" type="button">刷新热点</button></div>${table("integration-rows", ["项目", "所在层", "接入方式", "状态"])}<section class="control-section"><h2>最近运行</h2>${table("integration-run-rows", ["能力", "状态", "结果", "时间"])}</section></section>
    <section class="admin-view" data-view-panel="channels"><div class="section-toolbar"><div><h2>渠道舰队</h2><p>渠道绑定和 Adapter 回执</p></div></div>${table("channel-rows", ["渠道", "名称", "Agent", "用户", "状态", "凭证", "最后在线"])}</section>
    <section class="admin-view" data-view-panel="config"><div class="section-toolbar"><div><h2>配置中心</h2><p>配置修订只记录声明状态，应用结果以 Supervisor 回执为准</p></div></div>${table("config-rows", ["修订", "Agent", "状态", "内容哈希", "创建者", "创建时间", "操作"])}</section>
    <section class="admin-view" data-view-panel="versions"><div class="section-toolbar"><div><h2>版本中心</h2><p>Hermes 和全部 upstream 的候选更新</p></div>${platformAdmin ? `<button id="new-release-manifest" class="primary-button compact" type="button">登记发布</button>` : ""}</div>${table("upstream-rows", ["项目", "当前版本", "候选版本", "兼容测试", "状态", "更新时间"])}${platformAdmin ? `<form id="release-manifest-form" class="control-form" hidden><input name="version" placeholder="版本" required><input name="agentCommit" placeholder="Agent Commit SHA" required><input name="imageDigest" placeholder="平台镜像摘要" required><input name="hermesImage" placeholder="Hermes 镜像摘要" required><input name="runtimeImage" placeholder="Runtime 镜像摘要" required><input name="sbomUri" type="url" placeholder="SBOM URL" required><input name="provenanceUri" type="url" placeholder="Provenance URL" required><input name="signature" placeholder="签名" required><div class="form-actions"><button class="primary-button" type="submit">保存发布清单</button><button class="quiet-button" data-close-form="release-manifest-form" type="button">取消</button></div></form>` : ""}<section class="control-section"><h2>可信发布清单</h2>${table("release-manifest-rows", ["版本", "状态", "Agent Commit", "平台镜像", "创建时间", "操作"])}</section><section class="control-section"><h2>平台发布</h2>${table("release-rows", ["版本", "状态", "Agent Commit", "创建时间"])}</section></section>
    <section class="admin-view" data-view-panel="alerts"><div class="section-toolbar"><div><h2>告警中心</h2><p>离线、健康、成本、安全、配额、版本和备份异常</p></div></div>${table("alert-rows", ["级别", "状态", "代码", "Agent", "说明", "最后发生", "操作"])}</section>
    <section class="admin-view" data-view-panel="audit"><div class="section-toolbar"><div><h2>审计</h2><p>管理、权限、配置和敏感访问操作</p></div></div>${table("audit-rows", ["时间", "操作人", "操作", "对象类型", "对象", "详情"])}</section>
    <section class="admin-view" data-view-panel="release"><div class="section-toolbar"><div><h2>发布与审批</h2><p>GitHub CI、契约测试、发布门禁和高风险操作审批</p></div><span class="executor-state">执行结果由 Server Agent 回执</span></div><section class="control-section"><h2>待审批操作</h2>${table("approval-rows", ["创建时间", "动作", "风险", "请求人", "原因", "到期", "状态", "操作"])}</section><section class="control-section"><h2>发布门禁</h2>${table("release-gate-rows", ["门禁", "结果", "部署", "证据", "评估时间"])}</section></section>
    <section class="admin-view" data-view-panel="backups"><div class="section-toolbar"><div><h2>备份恢复</h2><p>PostgreSQL、Agent Workspace、记忆和配置备份记录</p></div><button id="create-agent-backup" class="primary-button compact" type="button">创建 Agent 备份</button></div>${table("backup-rows", ["类型", "状态", "Agent", "部署", "大小", "加密", "验证时间", "最近恢复", "到期时间", "操作"])}</section>

    <section class="admin-view" data-view-panel="retention"><form id="retention-form" class="control-form retention-form"><h2>数据保留政策</h2><label>遥测（天）<input name="telemetryDays" type="number" min="1" max="3650" required></label><label>用量（天）<input name="usageDays" type="number" min="1" max="3650" required></label><label>审计（天）<input name="auditDays" type="number" min="1" max="3650" required></label><label>敏感访问事件（天）<input name="sensitiveAccessEventDays" type="number" min="1" max="3650" required></label><label>备份（天）<input name="backupDays" type="number" min="1" max="3650" required></label><button class="primary-button compact" type="submit">保存政策</button></form></section>
    <section class="admin-view" data-view-panel="sensitive"><div class="section-toolbar"><div><h2>敏感访问授权</h2><p>管理员默认只能查看运行元数据</p></div><button id="new-sensitive-grant" class="primary-button compact" type="button">临时授权</button></div><form id="sensitive-grant-form" class="control-form" hidden><input name="granteeUserId" placeholder="管理员用户 ID" required><select name="scope"><option value="agent">Agent</option><option value="user">用户</option><option value="session">会话</option><option value="organization">组织</option></select><input name="targetId" placeholder="目标 ID"><input name="reason" minlength="10" placeholder="访问原因" required><label>到期时间<input name="expiresAt" type="datetime-local" required></label><div class="form-actions"><button class="primary-button" type="submit">创建授权</button><button class="quiet-button" data-close-form="sensitive-grant-form" type="button">取消</button></div></form>${table("sensitive-grant-rows", ["管理员", "范围", "目标", "原因", "到期", "状态", "操作"])}<section class="control-section"><h2>访问事件</h2>${table("sensitive-event-rows", ["时间", "管理员", "目标", "原因", "授权"])}</section></section>
    <dialog id="operation-reason-dialog" class="control-dialog"><form method="dialog"><h2 id="operation-reason-title">确认操作</h2><label>原因<textarea id="operation-reason" minlength="10" rows="4" required></textarea></label><div class="form-actions"><button value="cancel" class="quiet-button">取消</button><button value="confirm" class="primary-button">确认</button></div></form></dialog>
  </main>
</div>`
  });
}
