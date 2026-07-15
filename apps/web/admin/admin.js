async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || "request_failed"), { status: response.status });
  return body;
}

document.querySelector("#logout-button").addEventListener("click", async () => {
  await request("/api/auth/logout", { method: "POST" });
  location.href = "/login";
});

function tableRows(items, columns, emptyLabel) {
  if (!items.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columns.length;
    cell.className = "empty-row";
    cell.textContent = emptyLabel;
    row.append(cell);
    return [row];
  }
  return items.map((item) => {
    const row = document.createElement("tr");
    for (const column of columns) {
      const cell = document.createElement("td");
      cell.textContent = column(item);
      row.append(cell);
    }
    return row;
  });
}

async function loadOverview() {
  const data = await request("/api/admin/overview");
  document.querySelector("#metric-users").textContent = data.users;
  document.querySelector("#metric-snapshots").textContent = data.snapshots.length;
  document.querySelector("#metric-servers").textContent = data.servers;
  document.querySelector("#metric-licenses").textContent = data.licenses;
  document.querySelector("#metric-releases").textContent = data.releases;
  document.querySelector("#metric-audit").textContent = data.recentAudit.length;
  const status = document.querySelector("#control-status");
  const latest = data.snapshots.at(-1);
  status.textContent = latest?.status ?? "等待上报";
  status.className = `status ${latest?.status ?? "unknown"}`;
  document.querySelector("#snapshot-rows").replaceChildren(...tableRows(data.snapshots, [
    (item) => item.serverId,
    (item) => item.status,
    (item) => new Date(item.receivedAt).toLocaleString()
  ], "暂无快照"));
  document.querySelector("#audit-rows").replaceChildren(...tableRows(data.recentAudit, [
    (item) => item.action,
    (item) => item.targetType,
    (item) => new Date(item.createdAt).toLocaleString()
  ], "暂无记录"));
  const [users, servers, licenses, releases, integrations] = await Promise.all([
    request("/api/admin/users"),
    request("/api/admin/servers"),
    request("/api/admin/licenses"),
    request("/api/admin/releases").catch((error) => error.status === 403 ? { releases: [] } : Promise.reject(error)),
    request("/api/admin/integrations")
  ]);
  document.querySelector("#user-rows").replaceChildren(...tableRows(users.users, [
    (item) => `${item.displayName} (${item.email})`, (item) => item.role, (item) => item.status
  ], "暂无成员"));
  document.querySelector("#server-rows").replaceChildren(...tableRows(servers.servers, [
    (item) => item.name, (item) => item.status, (item) => item.runtimeVersion ?? "-"
  ], "暂无服务器"));
  document.querySelector("#license-rows").replaceChildren(...tableRows(licenses.licenses, [
    (item) => item.id, (item) => item.plan, (item) => item.status, (item) => new Date(item.expiresAt).toLocaleDateString()
  ], "暂无许可证"));
  document.querySelector("#release-rows").replaceChildren(...tableRows(releases.releases, [
    (item) => item.version, (item) => item.status, (item) => item.agentCommit.slice(0, 12)
  ], "暂无发布"));
  document.querySelector("#integration-rows").replaceChildren(...tableRows(integrations.catalog, [
    (item) => item.name, (item) => item.layer, (item) => item.importType, (item) => item.status
  ], "暂无集成项目"));
  document.querySelector("#integration-run-rows").replaceChildren(...tableRows(integrations.runs, [
    (item) => `${item.integrationId}.${item.capability}`,
    (item) => item.status,
    (item) => `${item.summary?.count ?? 0} 条`,
    (item) => new Date(item.completedAt ?? item.createdAt).toLocaleString()
  ], "暂无集成运行"));
}

async function loadProviderSettings() {
  const form = document.querySelector("#provider-settings-form");
  if (!form) return;
  const { configuration } = await request("/api/admin/provider-settings");
  form.elements.provider.value = configuration.provider;
  form.elements.baseUrl.value = configuration.baseUrl;
  form.elements.model.value = configuration.model;
  document.querySelector("#provider-key-state").textContent = configuration.configured ? `已保存密钥 ${configuration.keyMasked}` : "尚未保存供应商密钥";
  const status = document.querySelector("#provider-apply-status");
  status.textContent = configuration.applyStatus === "pending" ? "待运行环境应用" : configuration.applyStatus;
  status.className = `status ${configuration.applyStatus === "applied" ? "healthy" : "unknown"}`;
}

document.querySelector("#provider-settings-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await request("/api/admin/provider-settings", { method: "PATCH", body: JSON.stringify({ provider: form.elements.provider.value, baseUrl: form.elements.baseUrl.value, model: form.elements.model.value, apiKey: form.elements.apiKey.value }) });
  form.elements.apiKey.value = "";
  await loadProviderSettings();
});

document.querySelector("#refresh-hotspots").addEventListener("click", async (event) => {
  event.currentTarget.disabled = true;
  event.currentTarget.textContent = "采集中";
  try {
    await request("/api/admin/hotspots/refresh", { method: "POST", body: "{}" });
    await loadOverview();
  } finally {
    event.currentTarget.disabled = false;
    event.currentTarget.textContent = "刷新热点数据";
  }
});

document.querySelector("#refresh-admin").addEventListener("click", loadOverview);
loadOverview().catch(() => { document.querySelector("#control-status").textContent = "读取失败"; });
loadProviderSettings().catch(() => {});
