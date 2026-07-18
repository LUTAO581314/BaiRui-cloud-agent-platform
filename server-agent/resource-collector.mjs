import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const DOCKER_JSON = "{{json .}}";
const BYTE_UNITS = Object.freeze({
  b: 1,
  kb: 1_000,
  kib: 1_024,
  mb: 1_000_000,
  mib: 1_048_576,
  gb: 1_000_000_000,
  gib: 1_073_741_824,
  tb: 1_000_000_000_000,
  tib: 1_099_511_627_776
});

function finite(value, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= maximum ? number : null;
}

export function parseDockerBytes(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([kmgt]?i?b)$/i);
  if (!match) return null;
  const multiplier = BYTE_UNITS[match[2].toLowerCase()];
  const bytes = finite(Number(match[1]) * multiplier);
  return bytes === null ? null : Math.round(bytes);
}

function parsePercent(value) {
  if (typeof value !== "string") return finite(value, 100_000);
  return finite(Number(value.trim().replace(/%$/, "")), 100_000);
}

function parseJsonLines(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  const text = value.trim();
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return text.split(/\r?\n/).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  }
}

function isoDate(value) {
  return Number.isFinite(Date.parse(value)) && Date.parse(value) > 0 ? new Date(value).toISOString() : null;
}

function safeText(value, maximum = 300) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : null;
}

function directoryBytes(root, maximumEntries = 200_000) {
  let entries = 0;
  let total = 0;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    let children;
    try { children = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      entries += 1;
      if (entries > maximumEntries) return null;
      const item = path.join(current, child.name);
      let stat;
      try { stat = fs.lstatSync(item); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) pending.push(item);
      else if (stat.isFile()) total += stat.size;
      if (!Number.isSafeInteger(total)) return null;
    }
  }
  return total;
}

function filesystemUsage(root, statfs = fs.statfsSync) {
  try {
    const result = statfs(root, { bigint: true });
    const total = result.bsize * result.blocks;
    const available = result.bsize * result.bavail;
    const used = total - available;
    if (total > BigInt(Number.MAX_SAFE_INTEGER) || used > BigInt(Number.MAX_SAFE_INTEGER)) return { usedBytes: null, limitBytes: null };
    return { usedBytes: Number(used), limitBytes: Number(total) };
  } catch {
    return { usedBytes: null, limitBytes: null };
  }
}

function readInstances(instancesRoot) {
  let entries;
  try { entries = fs.readdirSync(instancesRoot, { withFileTypes: true }); } catch { return []; }
  const instances = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const directory = path.join(instancesRoot, entry.name);
      const metadata = JSON.parse(fs.readFileSync(path.join(directory, "instance.json"), "utf8"));
      const names = metadata.names ?? {};
      if (![metadata.agentId, metadata.runtimeId, metadata.deploymentId].every((item) => typeof item === "string" && IDENTIFIER.test(item))) continue;
      const dashboardName = names.dashboard ?? `bairui-hermes-dashboard-${String(names.hermes).replace(/^bairui-hermes-/, "")}`;
      if (![names.hermes, dashboardName, names.runtime].every((item) => typeof item === "string" && CONTAINER_NAME.test(item))) continue;
      instances.push({ directory, metadata, roles: [{ role: "hermes", name: names.hermes }, { role: "hermes-dashboard", name: dashboardName }, { role: "runtime-boundary", name: names.runtime }] });
    } catch {}
  }
  return instances;
}

async function docker(exec, args) {
  return exec("docker", args, { encoding: "utf8", timeout: 30_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
}

function containerResource(role, name, inspect, stats, listed) {
  const memoryParts = typeof stats?.MemUsage === "string" ? stats.MemUsage.split("/").map((item) => item.trim()) : [];
  const labels = inspect?.Config?.Labels && typeof inspect.Config.Labels === "object" ? inspect.Config.Labels : {};
  const version = safeText(labels["org.opencontainers.image.version"], 200);
  const startedAt = isoDate(inspect?.State?.StartedAt);
  return {
    role,
    containerId: safeText(inspect?.Id ?? stats?.ID ?? stats?.Container, 128),
    containerName: name,
    status: safeText(inspect?.State?.Status ?? listed?.State, 30) ?? "unknown",
    imageRef: safeText(inspect?.Config?.Image ?? stats?.Image ?? listed?.Image, 500),
    cpuPercent: parsePercent(stats?.CPUPerc),
    memoryUsedBytes: parseDockerBytes(memoryParts[0]),
    memoryLimitBytes: parseDockerBytes(memoryParts[1]),
    writableBytes: finite(inspect?.SizeRw),
    ...(version ? { version } : {}),
    ...(startedAt ? { startedAt } : {})
  };
}

function aggregateStatus(containers, listingAvailable) {
  if (!listingAvailable) return "unknown";
  const running = containers.filter((item) => item.status === "running").length;
  if (running === containers.length) return "running";
  if (running > 0 || containers.some((item) => ["paused", "restarting"].includes(item.status))) return "degraded";
  return "offline";
}

export async function collectAgentResourceSamples(options = {}) {
  const instancesRoot = path.resolve(options.instancesRoot ?? "/var/lib/bairui/agents");
  const instances = readInstances(instancesRoot);
  if (!instances.length) return [];
  const run = options.execFile ?? execFile;
  const observedAt = new Date(options.now ?? Date.now()).toISOString();
  const sequence = Math.max(1, Math.floor(Date.parse(observedAt)));
  const expectedNames = new Set(instances.flatMap((instance) => instance.roles.map((item) => item.name)));
  const [infoResult, listResult] = await Promise.allSettled([
    docker(run, ["info", "--format", DOCKER_JSON]),
    docker(run, ["container", "ls", "--all", "--no-trunc", "--format", DOCKER_JSON])
  ]);
  const hostInfo = infoResult.status === "fulfilled" ? parseJsonLines(infoResult.value.stdout)[0] ?? {} : {};
  const listed = listResult.status === "fulfilled" ? parseJsonLines(listResult.value.stdout) : [];
  const listedByName = new Map(listed.filter((item) => expectedNames.has(item.Names)).map((item) => [item.Names, item]));
  const existingNames = [...listedByName.keys()];
  const runningNames = existingNames.filter((name) => String(listedByName.get(name)?.State ?? "").toLowerCase() === "running");
  const [inspectResult, statsResult] = await Promise.allSettled([
    existingNames.length ? docker(run, ["container", "inspect", "--size", ...existingNames]) : Promise.resolve({ stdout: "[]" }),
    runningNames.length ? docker(run, ["stats", "--no-stream", "--no-trunc", "--format", DOCKER_JSON, ...runningNames]) : Promise.resolve({ stdout: "" })
  ]);
  const inspected = inspectResult.status === "fulfilled" ? parseJsonLines(inspectResult.value.stdout) : [];
  const stats = statsResult.status === "fulfilled" ? parseJsonLines(statsResult.value.stdout) : [];
  const inspectByName = new Map(inspected.map((item) => [String(item.Name ?? "").replace(/^\//, ""), item]));
  const statsByName = new Map(stats.map((item) => [item.Name ?? item.Container, item]));
  const hostStorage = filesystemUsage(instancesRoot, options.statfs);

  return instances.map(({ directory, metadata, roles }) => {
    const containers = roles.map(({ role, name }) => containerResource(role, name, inspectByName.get(name), statsByName.get(name), listedByName.get(name)));
    const cpuValues = containers.map((item) => item.cpuPercent).filter((item) => item !== null);
    const memoryValues = containers.map((item) => item.memoryUsedBytes).filter((item) => item !== null);
    const memoryLimits = containers.map((item) => item.memoryLimitBytes).filter((item) => item !== null);
    const writableValues = containers.map((item) => item.writableBytes).filter((item) => item !== null);
    const workspaceBytes = directoryBytes(directory, options.maximumWorkspaceEntries);
    const started = containers.map((item) => item.startedAt).filter(Boolean).sort()[0] ?? null;
    return {
      agentId: metadata.agentId,
      runtimeId: metadata.runtimeId,
      deploymentId: metadata.deploymentId,
      sequence,
      status: aggregateStatus(containers, listResult.status === "fulfilled"),
      cpuPercent: cpuValues.length ? Math.round(cpuValues.reduce((sum, item) => sum + item, 0) * 1000) / 1000 : null,
      memoryUsedBytes: memoryValues.length ? memoryValues.reduce((sum, item) => sum + item, 0) : null,
      memoryLimitBytes: memoryLimits.length ? Math.max(...memoryLimits) : null,
      agentStorageUsedBytes: workspaceBytes === null ? null : workspaceBytes + writableValues.reduce((sum, item) => sum + item, 0),
      hostStorageUsedBytes: hostStorage.usedBytes,
      hostStorageLimitBytes: hostStorage.limitBytes,
      osType: safeText(hostInfo.OSType ?? process.platform, 80),
      architecture: safeText(hostInfo.Architecture ?? process.arch, 80),
      operatingSystem: safeText(hostInfo.OperatingSystem, 300),
      dockerVersion: safeText(hostInfo.ServerVersion, 100),
      cpuCount: Number.isSafeInteger(Number(hostInfo.NCPU)) && Number(hostInfo.NCPU) > 0 ? Number(hostInfo.NCPU) : null,
      uptimeSeconds: started ? Math.max(0, Math.floor((Date.parse(observedAt) - Date.parse(started)) / 1000)) : null,
      observedAt,
      containers,
      ...(started ? { startedAt: started } : {})
    };
  });
}
