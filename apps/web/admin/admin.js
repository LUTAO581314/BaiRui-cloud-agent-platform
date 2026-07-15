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
}

document.querySelector("#refresh-admin").addEventListener("click", loadOverview);
loadOverview().catch(() => { document.querySelector("#control-status").textContent = "读取失败"; });
