const shell = document.querySelector(".control-shell");
const role = shell.dataset.adminRole;
const ownOrganizationId = shell.dataset.organizationId;
const state = { view: "overview", organizationId: role === "platform_admin" ? "" : ownOrganizationId };

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || "request_failed"), { status: response.status, body });
  return body;
}

function scoped(path, required = false) {
  if (state.organizationId) {
    const url = new URL(path, location.origin);
    url.searchParams.set("organization_id", state.organizationId);
    return `${url.pathname}${url.search}`;
  }
  if (required && role === "platform_admin") throw Object.assign(new Error("请选择一个组织"), { code: "organization_scope_required" });
  return path;
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("zh-CN", { hour12: false });
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatMoney(value) {
  return `$${new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(value) || 0)}`;
}

function statusNode(value) {
  const text = String(value ?? "unknown");
  const healthy = ["healthy", "ready", "active", "applied", "completed", "passed", "succeeded", "resolved"];
  const warning = ["degraded", "pending", "queued", "provisioning", "acknowledged", "staged", "draft"];
  const bad = ["unhealthy", "failed", "offline", "open", "critical", "deleted", "revoked"];
  const node = document.createElement("span");
  node.className = `status ${healthy.includes(text) ? "healthy" : warning.includes(text) ? "degraded" : bad.includes(text) ? "unhealthy" : "unknown"}`;
  node.textContent = text;
  return node;
}

function commandButton(label, action, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = danger ? "table-command danger" : "table-command";
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function rows(id, items, columns, emptyLabel = "暂无数据") {
  const body = document.querySelector(`#${id}`);
  if (!body) return;
  body.replaceChildren();
  if (!items.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columns.length;
    cell.className = "empty-row";
    cell.textContent = emptyLabel;
    row.append(cell);
    body.append(row);
    return;
  }
  for (const item of items) {
    const row = document.createElement("tr");
    for (const column of columns) {
      const cell = document.createElement("td");
      const value = column(item);
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value == null || value === "" ? "-" : String(value);
      row.append(cell);
    }
    body.append(row);
  }
}

function publicMetadata(value) {
  const text = JSON.stringify(value ?? {});
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

async function fleetData() {
  return (await request(scoped("/api/admin/agents"))).agents;
}

async function loadOverview() {
  const [overview, fleet, alertData, usageData, control] = await Promise.all([
    request(scoped("/api/admin/overview")), fleetData(), request(scoped("/api/admin/alerts")), request(scoped("/api/admin/usage")), request(scoped("/api/admin/control-plane"))
  ]);
  const rollups = usageData.rollups;
  const cost = rollups.reduce((sum, item) => sum + Number(item.estimatedCostUsd || 0), 0);
  document.querySelector("#metric-users").textContent = formatNumber(overview.users);
  document.querySelector("#metric-agents").textContent = formatNumber(overview.agents);
  document.querySelector("#metric-runtimes").textContent = `${overview.healthyRuntimes}/${overview.runtimes}`;
  document.querySelector("#metric-alerts").textContent = formatNumber(overview.openAlerts);
  document.querySelector("#metric-servers").textContent = formatNumber(overview.servers);
  document.querySelector("#metric-cost").textContent = formatMoney(cost);
  const latest = control.snapshots.at(-1);
  const controlStatus = document.querySelector("#control-status");
  controlStatus.replaceChildren(statusNode(latest?.status ?? "waiting"));
  controlStatus.className = "control-status-wrap";
  rows("overview-agent-rows", fleet.slice(0, 8), [item => item.name, item => item.owner?.displayName ?? item.ownerUserId, item => statusNode(item.runtime?.status), item => item.runtime?.hermesVersion, item => formatTime(item.heartbeat?.receivedAt)]);
  rows("overview-alert-rows", alertData.alerts.filter(item => ["open", "acknowledged"].includes(item.status)).slice(0, 8), [item => statusNode(item.severity), item => item.title, item => item.agentId ?? "平台", item => formatTime(item.lastSeenAt)], "当前没有开放告警");
  rows("snapshot-rows", control.snapshots.slice(-20).toReversed(), [item => item.serverId, item => statusNode(item.status), item => item.payload?.heartbeat?.runtimeBoundaryVersion, item => formatTime(item.receivedAt)]);
}

async function loadUsers() {
  const { users } = await request(scoped("/api/admin/users"));
  rows("user-rows", users, [item => `${item.displayName} (${item.email})`, item => item.organizationId, item => item.role, item => statusNode(item.status), item => formatTime(item.createdAt)]);
}

async function loadAgents() {
  const agents = await fleetData();
  rows("agent-rows", agents, [item => item.name, item => `${item.owner?.displayName ?? item.ownerUserId}\n${item.owner?.email ?? ""}`, item => item.desiredRuntimeState, item => statusNode(item.initializationStatus), item => statusNode(item.runtime?.status), item => item.runtime?.hermesVersion, item => item.components.length ? `${item.components.filter(component => component.status === "healthy").length}/${item.components.length}` : "-", item => formatTime(item.heartbeat?.receivedAt)]);
}

async function loadOperations() {
  const [usage, telemetry] = await Promise.all([request(scoped("/api/admin/usage")), request(scoped("/api/admin/telemetry"))]);
  const totals = usage.rollups.reduce((sum, item) => ({ runs: sum.runs + item.runCount, failures: sum.failures + item.failedRunCount, tokens: sum.tokens + item.inputTokens + item.outputTokens, latency: sum.latency + item.latencySumMs }), { runs: 0, failures: 0, tokens: 0, latency: 0 });
  document.querySelector("#usage-runs").textContent = formatNumber(totals.runs);
  document.querySelector("#usage-failures").textContent = formatNumber(totals.failures);
  document.querySelector("#usage-tokens").textContent = formatNumber(totals.tokens);
  document.querySelector("#usage-latency").textContent = totals.runs ? `${formatNumber(totals.latency / totals.runs)} ms` : "-";
  rows("telemetry-rows", telemetry.events, [item => formatTime(item.occurredAt), item => statusNode(item.severity), item => item.agentId, item => item.layer, item => item.componentId, item => item.eventType, item => item.traceId]);
}

async function loadProviders() {
  const organizationPath = scoped("/api/admin/provider-channels", true);
  const [channelData, policyData] = await Promise.all([request(organizationPath), request(scoped("/api/admin/model-policy", true))]);
  rows("provider-channel-rows", channelData.channels, [item => item.name, item => item.provider, item => item.model, item => statusNode(item.enabled ? item.status : "disabled"), item => item.priority, item => item.weight, item => item.maxConcurrency, item => item.monthlyBudgetUsd == null ? "-" : formatMoney(item.monthlyBudgetUsd), item => item.configured ? item.keyMasked : "未配置"]);
  const form = document.querySelector("#model-policy-form");
  const policy = policyData.policy;
  form.elements.allowedModels.value = (policy?.allowedModels ?? []).join("\n");
  form.elements.defaultModel.value = policy?.defaultModel ?? "";
  form.elements.dailyTokenLimit.value = policy?.dailyTokenLimit ?? "";
  form.elements.monthlyBudgetUsd.value = policy?.monthlyBudgetUsd ?? "";
  form.elements.userCustomKeysAllowed.checked = policy?.userCustomKeysAllowed === true;
}

async function loadIntegrations() {
  const data = await request(scoped("/api/admin/integrations"));
  rows("integration-rows", data.catalog, [item => item.name, item => item.layer, item => item.importType, item => statusNode(item.status)]);
  rows("integration-run-rows", data.runs, [item => `${item.integrationId}.${item.capability}`, item => statusNode(item.status), item => `${item.summary?.count ?? 0} 条`, item => formatTime(item.completedAt ?? item.createdAt)]);
}

async function loadChannels() {
  const { channels } = await request(scoped("/api/admin/channels"));
  rows("channel-rows", channels, [item => item.channel, item => item.displayName, item => item.agentId, item => item.userId, item => statusNode(item.status), item => item.configured ? item.credentialMasked : "未配置", item => formatTime(item.lastSeenAt)]);
}

async function loadConfig() {
  const { revisions } = await request(scoped("/api/admin/config-revisions"));
  rows("config-rows", revisions, [item => `#${item.revision}`, item => item.agentId ?? "平台", item => statusNode(item.status), item => item.contentHash?.slice(0, 16), item => item.createdBy, item => formatTime(item.createdAt)]);
}

async function loadVersions() {
  const [upstreams, releases] = await Promise.all([request("/api/admin/upstreams"), request("/api/admin/releases")]);
  rows("upstream-rows", upstreams.candidates, [item => item.upstreamId, item => item.currentRef, item => item.candidateRef, item => item.compatibilityTestRunId, item => statusNode(item.status), item => formatTime(item.updatedAt)]);
  rows("release-rows", releases.releases, [item => item.version, item => statusNode(item.status), item => item.agentCommit?.slice(0, 12), item => formatTime(item.createdAt)]);
}

async function updateAlert(alert, status) {
  await request(`/api/admin/alerts/${encodeURIComponent(alert.id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
  await loadAlerts();
}

async function loadAlerts() {
  const { alerts } = await request(scoped("/api/admin/alerts"));
  rows("alert-rows", alerts, [item => statusNode(item.severity), item => statusNode(item.status), item => item.code, item => item.agentId ?? "平台", item => `${item.title}\n${item.summary ?? ""}`, item => formatTime(item.lastSeenAt), item => {
    const group = document.createElement("div");
    group.className = "table-actions";
    if (item.status === "open") group.append(commandButton("确认", () => updateAlert(item, "acknowledged")));
    if (["open", "acknowledged"].includes(item.status)) group.append(commandButton("解决", () => updateAlert(item, "resolved")));
    return group;
  }]);
}

async function loadAudit() {
  const { events } = await request(scoped("/api/admin/audit"));
  rows("audit-rows", events, [item => formatTime(item.createdAt), item => item.actorUserId ?? "system", item => item.action, item => item.targetType, item => item.targetId, item => publicMetadata(item.metadata)]);
}

async function loadRelease() {
  const { gates } = await request(scoped("/api/admin/release-gates"));
  rows("release-gate-rows", gates, [item => item.gateName, item => statusNode(item.outcome), item => item.deploymentId, item => publicMetadata(item.evidenceRefs), item => formatTime(item.evaluatedAt)]);
}

async function loadBackups() {
  const { backups } = await request(scoped("/api/admin/backups"));
  rows("backup-rows", backups, [item => item.backupType, item => statusNode(item.status), item => item.deploymentId, item => item.sizeBytes == null ? "-" : `${formatNumber(item.sizeBytes / 1024 / 1024)} MB`, item => item.encrypted ? "是" : "否", item => formatTime(item.verifiedAt), item => formatTime(item.expiresAt)]);
}

async function loadRetention() {
  const { policy } = await request(scoped("/api/admin/data-retention", role === "platform_admin"));
  const form = document.querySelector("#retention-form");
  const defaults = { telemetryDays: 30, usageDays: 400, auditDays: 365, sensitiveAccessEventDays: 365, backupDays: 30 };
  for (const key of Object.keys(defaults)) form.elements[key].value = policy?.[key] ?? defaults[key];
}

async function revokeGrant(grant) {
  await request(scoped(`/api/admin/sensitive-access/grants/${encodeURIComponent(grant.id)}/revoke`, true), { method: "POST", body: "{}" });
  await loadSensitive();
}

async function loadSensitive() {
  const data = await request(scoped("/api/admin/sensitive-access", true));
  const now = Date.now();
  rows("sensitive-grant-rows", data.grants, [item => item.granteeUserId, item => item.scope, item => item.targetId ?? "当前组织", item => item.reason, item => formatTime(item.expiresAt), item => statusNode(item.revokedAt ? "revoked" : Date.parse(item.expiresAt) <= now ? "expired" : "active"), item => !item.revokedAt && Date.parse(item.expiresAt) > now ? commandButton("吊销", () => revokeGrant(item), true) : "-"]);
  rows("sensitive-event-rows", data.events, [item => formatTime(item.createdAt), item => item.actorUserId, item => `${item.targetType}:${item.targetId}`, item => item.reason, item => item.grantId]);
}

const loaders = { overview: loadOverview, users: loadUsers, agents: loadAgents, operations: loadOperations, providers: loadProviders, integrations: loadIntegrations, channels: loadChannels, config: loadConfig, versions: loadVersions, alerts: loadAlerts, audit: loadAudit, release: loadRelease, backups: loadBackups, retention: loadRetention, sensitive: loadSensitive };

async function refresh() {
  const error = document.querySelector("#admin-error");
  const refreshButton = document.querySelector("#refresh-admin");
  error.hidden = true;
  refreshButton.disabled = true;
  try {
    await loaders[state.view]();
  } catch (requestError) {
    error.textContent = requestError.code === "organization_scope_required" ? requestError.message : `读取失败：${requestError.message}`;
    error.hidden = false;
  } finally {
    refreshButton.disabled = false;
  }
}

async function showView(id) {
  const trigger = document.querySelector(`[data-admin-view="${id}"]`);
  if (!trigger) return;
  state.view = id;
  document.querySelectorAll("[data-admin-view]").forEach(item => item.classList.toggle("active", item === trigger));
  document.querySelectorAll("[data-view-panel]").forEach(item => item.classList.toggle("active", item.dataset.viewPanel === id));
  document.querySelector("#admin-title").textContent = trigger.textContent;
  await refresh();
}

document.querySelectorAll("[data-admin-view]").forEach(button => button.addEventListener("click", () => showView(button.dataset.adminView)));
document.querySelectorAll("[data-goto]").forEach(button => button.addEventListener("click", () => showView(button.dataset.goto)));
document.querySelector("#refresh-admin").addEventListener("click", refresh);
document.querySelector("#logout-button").addEventListener("click", async () => { await request("/api/auth/logout", { method: "POST" }); location.href = "/login"; });

document.querySelector("#new-provider-channel")?.addEventListener("click", () => { document.querySelector("#provider-channel-form").hidden = false; });
document.querySelector("#new-sensitive-grant")?.addEventListener("click", () => { document.querySelector("#sensitive-grant-form").hidden = false; });
document.querySelectorAll("[data-close-form]").forEach(button => button.addEventListener("click", () => { document.querySelector(`#${button.dataset.closeForm}`).hidden = true; }));

document.querySelector("#provider-channel-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  values.enabled = form.elements.enabled.checked;
  await request(scoped("/api/admin/provider-channels", true), { method: "POST", body: JSON.stringify(values) });
  form.reset();
  form.elements.enabled.checked = true;
  form.hidden = true;
  await loadProviders();
});

document.querySelector("#model-policy-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  await request(scoped("/api/admin/model-policy", true), { method: "PATCH", body: JSON.stringify({ allowedModels: form.elements.allowedModels.value.split("\n"), defaultModel: form.elements.defaultModel.value, dailyTokenLimit: form.elements.dailyTokenLimit.value, monthlyBudgetUsd: form.elements.monthlyBudgetUsd.value, userCustomKeysAllowed: form.elements.userCustomKeysAllowed.checked }) });
  await loadProviders();
});

document.querySelector("#retention-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  await request(scoped("/api/admin/data-retention", role === "platform_admin"), { method: "PATCH", body: JSON.stringify(values) });
  await loadRetention();
});

document.querySelector("#sensitive-grant-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  values.expiresAt = new Date(values.expiresAt).toISOString();
  await request(scoped("/api/admin/sensitive-access/grants", true), { method: "POST", body: JSON.stringify(values) });
  form.reset();
  form.hidden = true;
  await loadSensitive();
});

document.querySelector("#refresh-hotspots")?.addEventListener("click", async event => {
  event.currentTarget.disabled = true;
  try { await request(scoped("/api/admin/hotspots/refresh", role === "platform_admin"), { method: "POST", body: "{}" }); await loadIntegrations(); }
  finally { event.currentTarget.disabled = false; }
});

async function loadOrganizations() {
  const select = document.querySelector("#organization-scope");
  if (!select) return;
  const { organizations } = await request("/api/admin/organizations");
  for (const organization of organizations) {
    const option = document.createElement("option");
    option.value = organization.id;
    option.textContent = organization.name;
    select.append(option);
  }
  select.addEventListener("change", async () => { state.organizationId = select.value; await refresh(); });
}

async function bootstrap() {
  await loadOrganizations();
  await showView("overview");
}
bootstrap().catch((error) => {
  const message = document.querySelector("#admin-error");
  message.textContent = `总控初始化失败：${error.message}`;
  message.hidden = false;
});
