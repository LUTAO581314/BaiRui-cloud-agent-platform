import { execFile as execFileCallback } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IMAGE_DIGEST = /^(?:ghcr\.io|docker\.io)\/[A-Za-z0-9_.\/-]+@sha256:[a-f0-9]{64}$/;
const TEST_SUITES = Object.freeze({
  probe: new Set(["runtime.health", "hermes.health"]),
  contract: new Set(["runtime-boundary-v1", "hermes-api-v1"]),
  smoke: new Set(["agent-runtime-v1"])
});

function identifier(value, name) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw Object.assign(new Error(`${name} is invalid`), { code: "invalid_supervisor_input" });
  return value;
}

function envValue(value, name) {
  const text = String(value ?? "");
  if (!text || /[\r\n\0]/.test(text)) throw Object.assign(new Error(`${name} is invalid`), { code: "invalid_supervisor_config" });
  return text;
}

function machineSecret(value, name) {
  const text = envValue(value, name);
  if (text.length < 32) throw Object.assign(new Error(`${name} must contain at least 32 characters`), { code: "invalid_supervisor_config" });
  return text;
}

function instanceKey(agentId) {
  return createHash("sha256").update(agentId).digest("hex").slice(0, 16);
}

function imageDigest(value, name) {
  if (typeof value !== "string" || !IMAGE_DIGEST.test(value)) throw Object.assign(new Error(`${name} must be an immutable registry digest`), { code: "invalid_release_manifest" });
  return value;
}

function copyFileSecure(source, destination) {
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o600);
}

function envFile(values) {
  return `${Object.entries(values).map(([key, value]) => `${key}=${envValue(value, key)}`).join("\n")}\n`;
}

export class AgentSupervisor {
  constructor(options = {}) {
    this.instancesRoot = path.resolve(options.instancesRoot ?? "/var/lib/bairui/agents");
    this.hermesImage = options.hermesImage ?? "hermes-agent:local";
    this.runtimeImage = options.runtimeImage ?? "bairui-runtime:local";
    this.runtimeAdvertiseHost = options.runtimeAdvertiseHost ?? "127.0.0.1";
    this.backupRoot = path.resolve(options.backupRoot ?? "/var/lib/bairui/backups");
    this.backupKey = options.backupEncryptionKey ? createHash("sha256").update(String(options.backupEncryptionKey)).digest() : null;
    this.platformUrl = options.platformUrl;
    this.portStart = Number(options.portStart ?? 19000);
    this.portEnd = Number(options.portEnd ?? 19999);
    this.execFile = options.execFile ?? execFile;
    if (!path.isAbsolute(this.instancesRoot) || !path.isAbsolute(this.backupRoot) || !this.platformUrl || !/^https:\/\//.test(this.platformUrl) || this.portStart < 1024 || this.portEnd <= this.portStart || this.portEnd > 65535) throw new TypeError("Invalid Supervisor configuration");
  }

  names(agentId) {
    const key = instanceKey(agentId);
    return { key, network: `bairui-agent-${key}`, hermes: `bairui-hermes-${key}`, runtime: `bairui-runtime-${key}` };
  }

  instancePath(agentId) {
    const candidate = path.resolve(this.instancesRoot, instanceKey(agentId));
    if (path.dirname(candidate) !== this.instancesRoot) throw Object.assign(new Error("Agent instance path escaped the Supervisor root"), { code: "invalid_instance_path" });
    return candidate;
  }

  async docker(args, options = {}) {
    return this.execFile("docker", args, { encoding: "utf8", timeout: options.timeoutMs ?? 120_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  }

  async exists(kind, name) {
    try { await this.docker([kind, "inspect", name], { timeoutMs: 15_000 }); return true; } catch { return false; }
  }

  allocatePort(agentId) {
    fs.mkdirSync(this.instancesRoot, { recursive: true, mode: 0o700 });
    const occupied = new Map();
    for (const entry of fs.readdirSync(this.instancesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const metadata = JSON.parse(fs.readFileSync(path.join(this.instancesRoot, entry.name, "instance.json"), "utf8"));
        if (Number.isInteger(metadata.runtimePort)) occupied.set(metadata.runtimePort, metadata.agentId);
      } catch {}
    }
    const size = this.portEnd - this.portStart + 1;
    const first = this.portStart + (Number.parseInt(instanceKey(agentId).slice(0, 8), 16) % size);
    for (let offset = 0; offset < size; offset += 1) {
      const port = this.portStart + ((first - this.portStart + offset) % size);
      if (!occupied.has(port) || occupied.get(port) === agentId) return port;
    }
    throw Object.assign(new Error("No Runtime port is available"), { code: "runtime_port_exhausted" });
  }

  async replaceContainer(name, args) {
    if (await this.exists("container", name)) await this.docker(["container", "rm", "--force", name]);
    await this.docker(["run", "--detach", "--name", name, "--restart", "unless-stopped", ...args]);
  }

  commandAgentId(command) {
    return identifier(command.arguments?.agent_id ?? command.placement?.agent_id, "agent_id");
  }

  configurationValues(command, names) {
    if (!command.config?.document || !command.config?.secrets || command.placement?.agent_id !== this.commandAgentId(command)) throw Object.assign(new Error("Configuration command bundle is incomplete"), { code: "invalid_config_bundle" });
    const provider = command.config.document.provider ?? {};
    const secrets = command.config.secrets;
    const hermesApiKey = machineSecret(secrets.hermes_api_server_key, "hermes_api_server_key");
    const runtimeSecret = machineSecret(secrets.runtime_shared_secret, "runtime_shared_secret");
    const agentControlToken = machineSecret(secrets.agent_control_token, "agent_control_token");
    return {
      hermes: { API_SERVER_ENABLED: "true", API_SERVER_HOST: "0.0.0.0", API_SERVER_KEY: hermesApiKey, OPENAI_API_KEY: secrets.provider_api_key, OPENAI_BASE_URL: provider.base_url, MODEL: provider.model },
      runtime: { HERMES_API_URL: `http://${names.hermes}:8642`, HERMES_API_SERVER_KEY: hermesApiKey, BAIRUI_RUNTIME_SHARED_SECRET: runtimeSecret, BAIRUI_PLATFORM_URL: this.platformUrl, BAIRUI_ORGANIZATION_ID: command.placement.organization_id, BAIRUI_USER_ID: command.placement.user_id, BAIRUI_AGENT_ID: command.placement.agent_id, BAIRUI_RUNTIME_ID: command.placement.runtime_id, BAIRUI_CONFIG_REVISION_ID: command.arguments.config_revision_id, BAIRUI_AGENT_CONTROL_TOKEN: agentControlToken, BAIRUI_RUNTIME_HOST: "0.0.0.0", BAIRUI_RUNTIME_PORT: "8787" },
      soul: String(command.config.document.agent?.soul_markdown ?? ""),
      agentControlToken
    };
  }

  writeConfiguration(command, directory, names) {
    const values = this.configurationValues(command, names);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const files = { hermesEnv: path.join(directory, "hermes.env"), runtimeEnv: path.join(directory, "runtime.env"), soul: path.join(directory, "SOUL.md"), controlToken: path.join(directory, "agent-control.token") };
    fs.writeFileSync(files.hermesEnv, envFile(values.hermes), { mode: 0o600 });
    fs.writeFileSync(files.runtimeEnv, envFile(values.runtime), { mode: 0o600 });
    fs.writeFileSync(files.soul, values.soul, { mode: 0o600 });
    fs.writeFileSync(files.controlToken, values.agentControlToken, { mode: 0o600 });
    return files;
  }

  async runContainers(metadata, files, images = metadata.images) {
    const dataPath = path.join(this.instancePath(metadata.agentId), "hermes-data");
    if (!await this.exists("network", metadata.names.network)) await this.docker(["network", "create", metadata.names.network]);
    await this.replaceContainer(metadata.names.hermes, ["--network", metadata.names.network, "--env-file", files.hermesEnv, "--volume", `${dataPath}:/opt/data`, images.hermes, "gateway", "run"]);
    await this.replaceContainer(metadata.names.runtime, ["--network", metadata.names.network, "--env-file", files.runtimeEnv, "--publish", `127.0.0.1:${metadata.runtimePort}:8787`, images.runtime]);
  }

  writeMetadata(agentId, metadata) {
    const file = path.join(this.instancePath(agentId), "instance.json");
    fs.writeFileSync(file, JSON.stringify({ ...metadata, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  }

  async provision(command) {
    const agentId = identifier(command.arguments?.agent_id, "agent_id");
    if (command.placement?.agent_id !== agentId || !command.config?.document || !command.config?.secrets) throw Object.assign(new Error("Provision command placement or config is incomplete"), { code: "invalid_provision_bundle" });
    const names = this.names(agentId);
    const instancePath = this.instancePath(agentId);
    const dataPath = path.join(instancePath, "hermes-data");
    fs.mkdirSync(dataPath, { recursive: true, mode: 0o700 });
    const runtimePort = this.allocatePort(agentId);
    const secrets = command.config.secrets;
    const provider = command.config.document.provider ?? {};
    const hermesEnvPath = path.join(instancePath, "hermes.env");
    const runtimeEnvPath = path.join(instancePath, "runtime.env");
    try {
      const previous = this.readMetadata(agentId);
      if (previous.idempotencyKey === command.idempotency_key && await this.exists("container", previous.names.hermes) && await this.exists("container", previous.names.runtime)) {
        return { runtimeEndpointRef: `http://${this.runtimeAdvertiseHost}:${previous.runtimePort}`, summary: { containers: 2, runtime_port: previous.runtimePort, idempotent_replay: 1 }, evidenceRefs: [`docker:${previous.names.hermes}`, `docker:${previous.names.runtime}`] };
      }
    } catch {}
    const hermesApiKey = machineSecret(secrets.hermes_api_server_key, "hermes_api_server_key");
    const runtimeSecret = machineSecret(secrets.runtime_shared_secret, "runtime_shared_secret");
    const agentControlToken = machineSecret(secrets.agent_control_token, "agent_control_token");
    fs.writeFileSync(hermesEnvPath, envFile({ API_SERVER_ENABLED: "true", API_SERVER_HOST: "0.0.0.0", API_SERVER_KEY: hermesApiKey, OPENAI_API_KEY: secrets.provider_api_key, OPENAI_BASE_URL: provider.base_url, MODEL: provider.model }), { mode: 0o600 });
    fs.writeFileSync(runtimeEnvPath, envFile({ HERMES_API_URL: `http://${names.hermes}:8642`, HERMES_API_SERVER_KEY: hermesApiKey, BAIRUI_RUNTIME_SHARED_SECRET: runtimeSecret, BAIRUI_PLATFORM_URL: this.platformUrl, BAIRUI_ORGANIZATION_ID: command.placement.organization_id, BAIRUI_USER_ID: command.placement.user_id, BAIRUI_AGENT_ID: agentId, BAIRUI_RUNTIME_ID: command.placement.runtime_id, BAIRUI_CONFIG_REVISION_ID: command.arguments.config_revision_id, BAIRUI_AGENT_CONTROL_TOKEN: agentControlToken, BAIRUI_RUNTIME_HOST: "0.0.0.0", BAIRUI_RUNTIME_PORT: "8787" }), { mode: 0o600 });
    fs.writeFileSync(path.join(dataPath, "SOUL.md"), String(command.config.document.agent?.soul_markdown ?? ""), { mode: 0o600 });
    fs.writeFileSync(path.join(instancePath, "agent-control.token"), agentControlToken, { mode: 0o600 });

    if (!await this.exists("network", names.network)) await this.docker(["network", "create", names.network]);
    await this.replaceContainer(names.hermes, ["--network", names.network, "--env-file", hermesEnvPath, "--volume", `${dataPath}:/opt/data`, this.hermesImage, "gateway", "run"]);
    await this.replaceContainer(names.runtime, ["--network", names.network, "--env-file", runtimeEnvPath, "--publish", `127.0.0.1:${runtimePort}:8787`, this.runtimeImage]);
    const metadata = { schemaVersion: "1.0", agentId, runtimeId: command.placement.runtime_id, deploymentId: command.deployment_id, runtimePort, names, images: { hermes: this.hermesImage, runtime: this.runtimeImage }, configRevisionId: command.arguments.config_revision_id, idempotencyKey: command.idempotency_key, updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(instancePath, "instance.json"), JSON.stringify(metadata, null, 2), { mode: 0o600 });
    return { runtimeEndpointRef: `http://${this.runtimeAdvertiseHost}:${runtimePort}`, summary: { containers: 2, runtime_port: runtimePort }, evidenceRefs: [`docker:${names.hermes}`, `docker:${names.runtime}`] };
  }

  readMetadata(agentId) {
    try { return JSON.parse(fs.readFileSync(path.join(this.instancePath(agentId), "instance.json"), "utf8")); }
    catch { throw Object.assign(new Error("Agent instance metadata is missing"), { code: "instance_not_found" }); }
  }

  async lifecycle(command) {
    const agentId = identifier(command.arguments?.agent_id, "agent_id");
    const metadata = this.readMetadata(agentId);
    const names = metadata.names;
    const action = command.action;
    if (action === "deployment.start" || action === "deployment.resume") {
      const verb = action === "deployment.resume" ? "unpause" : "start";
      await this.docker(["container", verb, names.hermes, names.runtime]);
    } else if (action === "deployment.stop") {
      await this.docker(["container", "stop", names.runtime, names.hermes]);
    } else if (action === "deployment.suspend") {
      await this.docker(["container", "pause", names.hermes, names.runtime]);
    } else if (action === "deployment.delete") {
      for (const name of [names.runtime, names.hermes]) if (await this.exists("container", name)) await this.docker(["container", "rm", "--force", name]);
      if (await this.exists("network", names.network)) await this.docker(["network", "rm", names.network]);
      return { summary: { containers: 0, data_retained: 1 }, evidenceRefs: [`retained:${this.instancePath(agentId)}`] };
    } else {
      throw Object.assign(new Error(`Unsupported deployment lifecycle action: ${action}`), { code: "unsupported_supervisor_action" });
    }
    return { summary: { containers: 2 }, evidenceRefs: [`docker:${names.hermes}`, `docker:${names.runtime}`] };
  }

  async collectSnapshot(command) {
    const agentId = this.commandAgentId(command);
    const metadata = this.readMetadata(agentId);
    const states = await Promise.all([metadata.names.hermes, metadata.names.runtime].map((name) => this.exists("container", name)));
    return { summary: { containers: states.filter(Boolean).length, expected_containers: 2 }, evidenceRefs: [states[0] ? `docker:${metadata.names.hermes}` : `missing:${metadata.names.hermes}`, states[1] ? `docker:${metadata.names.runtime}` : `missing:${metadata.names.runtime}`] };
  }

  async runControlCheck(command, type) {
    const agentId = this.commandAgentId(command);
    const metadata = this.readMetadata(agentId);
    const suites = type === "probe" ? command.arguments?.probe_ids : [command.arguments?.suite_id];
    if (!Array.isArray(suites) || !suites.length || suites.some((suite) => typeof suite !== "string" || !TEST_SUITES[type].has(suite))) throw Object.assign(new Error(`Unsupported ${type} suite`), { code: "unsupported_test_suite" });
    const runtimeEnv = path.join(this.instancePath(agentId), "runtime.env");
    const { stdout } = await this.docker(["run", "--rm", "--network", metadata.names.network, "--env-file", runtimeEnv, "--env", `BAIRUI_RUNTIME_PROBE_URL=http://${metadata.names.runtime}:8787`, metadata.images?.runtime ?? this.runtimeImage, "node", "apps/control-check.mjs", type, ...suites], { timeoutMs: 300_000 });
    let report;
    try { report = JSON.parse(stdout); } catch { throw Object.assign(new Error("Control check returned invalid evidence"), { code: "invalid_test_evidence" }); }
    if (report.status !== "passed" || !Array.isArray(report.checks)) throw Object.assign(new Error(report.summary || `${type} check failed`), { code: `${type}_failed` });
    return { summary: { checks: report.checks.length, passed: report.checks.filter((item) => item.status === "passed").length }, evidenceRefs: report.checks.map((item) => `check:${type}:${identifier(item.id, "check_id")}:passed`) };
  }

  async stageConfiguration(command) {
    const agentId = this.commandAgentId(command);
    const metadata = this.readMetadata(agentId);
    const revisionId = identifier(command.arguments?.config_revision_id, "config_revision_id");
    const stagePath = path.join(this.instancePath(agentId), "staged-config", revisionId);
    this.writeConfiguration(command, stagePath, metadata.names);
    fs.writeFileSync(path.join(stagePath, "stage.json"), JSON.stringify({ schemaVersion: "1.0", agentId, revisionId, commandId: command.command_id, stagedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    return { summary: { files: 5, staged: 1 }, evidenceRefs: [`config:${revisionId}:staged`] };
  }

  async applyConfiguration(command) {
    if (!command.approval_id) throw Object.assign(new Error("Configuration apply requires approval"), { code: "approval_required" });
    const agentId = this.commandAgentId(command);
    const metadata = this.readMetadata(agentId);
    const revisionId = identifier(command.arguments?.config_revision_id, "config_revision_id");
    await this.stageConfiguration(command);
    const instancePath = this.instancePath(agentId);
    const stagePath = path.join(instancePath, "staged-config", revisionId);
    const rollbackPath = path.join(instancePath, "config-history", metadata.configRevisionId ?? `before-${revisionId}`);
    fs.mkdirSync(rollbackPath, { recursive: true, mode: 0o700 });
    const active = { hermesEnv: path.join(instancePath, "hermes.env"), runtimeEnv: path.join(instancePath, "runtime.env"), soul: path.join(instancePath, "hermes-data", "SOUL.md"), controlToken: path.join(instancePath, "agent-control.token") };
    const staged = { hermesEnv: path.join(stagePath, "hermes.env"), runtimeEnv: path.join(stagePath, "runtime.env"), soul: path.join(stagePath, "SOUL.md"), controlToken: path.join(stagePath, "agent-control.token") };
    for (const [key, source] of Object.entries(active)) if (fs.existsSync(source)) copyFileSecure(source, path.join(rollbackPath, path.basename(source)));
    try {
      for (const key of Object.keys(active)) copyFileSecure(staged[key], active[key]);
      await this.runContainers(metadata, active, metadata.images ?? { hermes: this.hermesImage, runtime: this.runtimeImage });
      this.writeMetadata(agentId, { ...metadata, configRevisionId: revisionId, idempotencyKey: command.idempotency_key });
    } catch (error) {
      const rollback = { hermesEnv: path.join(rollbackPath, "hermes.env"), runtimeEnv: path.join(rollbackPath, "runtime.env"), soul: path.join(rollbackPath, "SOUL.md"), controlToken: path.join(rollbackPath, "agent-control.token") };
      if (Object.values(rollback).every((file) => fs.existsSync(file))) {
        for (const key of Object.keys(active)) copyFileSecure(rollback[key], active[key]);
        await this.runContainers(metadata, active, metadata.images ?? { hermes: this.hermesImage, runtime: this.runtimeImage }).catch(() => {});
      }
      throw error;
    }
    return { runtimeEndpointRef: `http://${this.runtimeAdvertiseHost}:${metadata.runtimePort}`, summary: { files: 4, containers: 2, applied: 1 }, evidenceRefs: [`config:${revisionId}:applied`, `config:${metadata.configRevisionId ?? "initial"}:rollback-ready`] };
  }

  backupPath(backupId) {
    const candidate = path.resolve(this.backupRoot, `${identifier(backupId, "backup_id")}.brb`);
    if (path.dirname(candidate) !== this.backupRoot) throw Object.assign(new Error("Backup path escaped the backup root"), { code: "invalid_backup_path" });
    return candidate;
  }

  async createBackup(command) {
    if (!this.backupKey) throw Object.assign(new Error("Backup encryption key is unavailable"), { code: "backup_key_unavailable" });
    const agentId = this.commandAgentId(command);
    this.readMetadata(agentId);
    const backupId = identifier(command.arguments?.backup_id ?? command.command_id, "backup_id");
    const instancePath = this.instancePath(agentId);
    fs.mkdirSync(this.backupRoot, { recursive: true, mode: 0o700 });
    const plainPath = path.join(this.backupRoot, `.${backupId}.tar.gz`);
    try {
      await this.execFile("tar", ["-czf", plainPath, "-C", instancePath, "hermes-data", "instance.json", "hermes.env", "runtime.env"], { encoding: "utf8", timeout: 300_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
      const plain = fs.readFileSync(plainPath);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.backupKey, iv);
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
      const header = Buffer.from(JSON.stringify({ schemaVersion: "1.0", backupId, agentId, algorithm: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), plaintextSha256: createHash("sha256").update(plain).digest("hex"), createdAt: new Date().toISOString() }), "utf8");
      const size = Buffer.allocUnsafe(4);
      size.writeUInt32BE(header.length);
      const output = Buffer.concat([size, header, encrypted]);
      fs.writeFileSync(this.backupPath(backupId), output, { mode: 0o600 });
      return { summary: { bytes: output.length, encrypted: 1, files: 4 }, evidenceRefs: [`backup:${backupId}`, `sha256:${createHash("sha256").update(output).digest("hex")}`] };
    } finally {
      fs.rmSync(plainPath, { force: true });
    }
  }

  async verifyBackup(command) {
    if (!this.backupKey) throw Object.assign(new Error("Backup encryption key is unavailable"), { code: "backup_key_unavailable" });
    const backupId = identifier(command.arguments?.backup_id, "backup_id");
    const input = fs.readFileSync(this.backupPath(backupId));
    const headerLength = input.readUInt32BE(0);
    if (headerLength < 2 || headerLength > 16_384 || input.length <= 4 + headerLength) throw Object.assign(new Error("Backup envelope is invalid"), { code: "invalid_backup" });
    const header = JSON.parse(input.subarray(4, 4 + headerLength).toString("utf8"));
    const decipher = createDecipheriv("aes-256-gcm", this.backupKey, Buffer.from(header.iv, "base64"));
    decipher.setAuthTag(Buffer.from(header.tag, "base64"));
    const plain = Buffer.concat([decipher.update(input.subarray(4 + headerLength)), decipher.final()]);
    const digest = createHash("sha256").update(plain).digest("hex");
    if (digest !== header.plaintextSha256 || header.backupId !== backupId) throw Object.assign(new Error("Backup integrity verification failed"), { code: "backup_integrity_failed" });
    return { summary: { bytes: input.length, verified: 1 }, evidenceRefs: [`backup:${backupId}:verified`, `plaintext-sha256:${digest}`] };
  }

  releaseDescriptor(command, idField = "release_id") {
    const releaseId = identifier(command.arguments?.[idField], idField);
    const release = command.release;
    if (!release || release.id !== releaseId) throw Object.assign(new Error("Trusted release manifest is missing"), { code: "release_manifest_missing" });
    return { id: releaseId, version: identifier(release.version, "release_version"), images: { hermes: imageDigest(release.hermes_image, "hermes_image"), runtime: imageDigest(release.runtime_image, "runtime_image") } };
  }

  async stageRelease(command, idField = "release_id") {
    const agentId = this.commandAgentId(command);
    const descriptor = this.releaseDescriptor(command, idField);
    const directory = path.join(this.instancePath(agentId), "staged-releases");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    await this.docker(["image", "pull", descriptor.images.hermes], { timeoutMs: 600_000 });
    await this.docker(["image", "pull", descriptor.images.runtime], { timeoutMs: 600_000 });
    fs.writeFileSync(path.join(directory, `${descriptor.id}.json`), JSON.stringify({ ...descriptor, stagedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    return { summary: { images: 2, staged: 1 }, evidenceRefs: [`release:${descriptor.id}:staged`, `image:${descriptor.images.hermes}`, `image:${descriptor.images.runtime}`] };
  }

  async applyRelease(command, idField = "release_id") {
    if (!command.approval_id) throw Object.assign(new Error("Release apply requires approval"), { code: "approval_required" });
    const agentId = this.commandAgentId(command);
    const metadata = this.readMetadata(agentId);
    const descriptor = this.releaseDescriptor(command, idField);
    await this.stageRelease(command, idField);
    const history = path.join(this.instancePath(agentId), "release-history");
    fs.mkdirSync(history, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(history, `${metadata.releaseId ?? "initial"}.json`), JSON.stringify({ id: metadata.releaseId ?? "initial", version: metadata.releaseVersion ?? "initial", images: metadata.images ?? { hermes: this.hermesImage, runtime: this.runtimeImage }, recordedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    const files = { hermesEnv: path.join(this.instancePath(agentId), "hermes.env"), runtimeEnv: path.join(this.instancePath(agentId), "runtime.env") };
    await this.runContainers(metadata, files, descriptor.images);
    this.writeMetadata(agentId, { ...metadata, images: descriptor.images, releaseId: descriptor.id, releaseVersion: descriptor.version, idempotencyKey: command.idempotency_key });
    return { runtimeEndpointRef: `http://${this.runtimeAdvertiseHost}:${metadata.runtimePort}`, summary: { images: 2, containers: 2, applied: 1 }, evidenceRefs: [`release:${descriptor.id}:applied`, `release:${metadata.releaseId ?? "initial"}:rollback-ready`] };
  }

  async checkUpstream(command) {
    const agentId = this.commandAgentId(command);
    const metadata = this.readMetadata(agentId);
    const upstreamId = identifier(command.arguments?.upstream_id, "upstream_id");
    const image = upstreamId === "hermes" ? metadata.images?.hermes : upstreamId === "bairui-runtime" ? metadata.images?.runtime : null;
    if (!image) throw Object.assign(new Error("Upstream is not managed by this Supervisor"), { code: "unsupported_upstream" });
    const { stdout } = await this.docker(["image", "inspect", "--format", "{{.Id}}", image], { timeoutMs: 30_000 });
    const digest = stdout.trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw Object.assign(new Error("Upstream image digest evidence is invalid"), { code: "invalid_upstream_evidence" });
    return { summary: { images: 1, verified: 1 }, evidenceRefs: [`upstream:${upstreamId}`, `image-id:${digest}`] };
  }

  async restartService(command) {
    if (!command.approval_id) throw Object.assign(new Error("Service restart requires approval"), { code: "approval_required" });
    const agentId = this.commandAgentId(command);
    const metadata = this.readMetadata(agentId);
    const serviceId = identifier(command.arguments?.service_id, "service_id");
    const container = serviceId === "hermes" ? metadata.names.hermes : serviceId === "runtime-boundary" ? metadata.names.runtime : null;
    if (!container) throw Object.assign(new Error("Service is not restartable"), { code: "unsupported_service" });
    await this.docker(["container", "restart", container]);
    return { summary: { containers: 1, restarted: 1 }, evidenceRefs: [`docker:${container}:restarted`] };
  }

  async revokeCredential(command) {
    if (!command.approval_id) throw Object.assign(new Error("Credential revocation requires approval"), { code: "approval_required" });
    const agentId = this.commandAgentId(command);
    const metadata = this.readMetadata(agentId);
    const identityId = identifier(command.arguments?.identity_id, "identity_id");
    fs.rmSync(path.join(this.instancePath(agentId), "agent-control.token"), { force: true });
    if (await this.exists("container", metadata.names.runtime)) await this.docker(["container", "stop", metadata.names.runtime]);
    return { summary: { credentials: 1, containers_stopped: 1 }, evidenceRefs: [`identity:${identityId}:revoked`, `docker:${metadata.names.runtime}:stopped`] };
  }

  async execute(command) {
    if (command.action === "deployment.provision") return this.provision(command);
    if (["deployment.start", "deployment.stop", "deployment.suspend", "deployment.resume", "deployment.delete"].includes(command.action)) return this.lifecycle(command);
    if (command.action === "snapshot.collect") return this.collectSnapshot(command);
    if (command.action === "probe.run") return this.runControlCheck(command, "probe");
    if (command.action === "contract.test") return this.runControlCheck(command, "contract");
    if (command.action === "smoke.test") return this.runControlCheck(command, "smoke");
    if (command.action === "config.stage") return this.stageConfiguration(command);
    if (command.action === "config.apply") return this.applyConfiguration(command);
    if (command.action === "backup.create") return this.createBackup(command);
    if (command.action === "backup.verify") return this.verifyBackup(command);
    if (command.action === "release.stage") return this.stageRelease(command);
    if (command.action === "release.apply") return this.applyRelease(command);
    if (command.action === "release.rollback") return this.applyRelease({ ...command, release: command.rollback_release }, "rollback_release_id");
    if (command.action === "upstream.check") return this.checkUpstream(command);
    if (command.action === "service.restart") return this.restartService(command);
    if (command.action === "credential.revoke") return this.revokeCredential(command);
    throw Object.assign(new Error(`Supervisor action is not allowed: ${command.action}`), { code: "unsupported_supervisor_action" });
  }
}
