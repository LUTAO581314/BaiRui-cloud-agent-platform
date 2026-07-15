import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

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

function envFile(values) {
  return `${Object.entries(values).map(([key, value]) => `${key}=${envValue(value, key)}`).join("\n")}\n`;
}

export class AgentSupervisor {
  constructor(options = {}) {
    this.instancesRoot = path.resolve(options.instancesRoot ?? "/var/lib/bairui/agents");
    this.hermesImage = options.hermesImage ?? "hermes-agent:local";
    this.runtimeImage = options.runtimeImage ?? "bairui-runtime:local";
    this.runtimeAdvertiseHost = options.runtimeAdvertiseHost ?? "127.0.0.1";
    this.platformUrl = options.platformUrl;
    this.portStart = Number(options.portStart ?? 19000);
    this.portEnd = Number(options.portEnd ?? 19999);
    this.execFile = options.execFile ?? execFile;
    if (!path.isAbsolute(this.instancesRoot) || !this.platformUrl || !/^https:\/\//.test(this.platformUrl) || this.portStart < 1024 || this.portEnd <= this.portStart || this.portEnd > 65535) throw new TypeError("Invalid Supervisor configuration");
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
    const metadata = { schemaVersion: "1.0", agentId, runtimeId: command.placement.runtime_id, deploymentId: command.deployment_id, runtimePort, names, configRevisionId: command.arguments.config_revision_id, idempotencyKey: command.idempotency_key, updatedAt: new Date().toISOString() };
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

  async execute(command) {
    if (command.action === "deployment.provision") return this.provision(command);
    if (["deployment.start", "deployment.stop", "deployment.suspend", "deployment.resume", "deployment.delete"].includes(command.action)) return this.lifecycle(command);
    throw Object.assign(new Error(`Supervisor action is not allowed: ${command.action}`), { code: "unsupported_supervisor_action" });
  }
}
