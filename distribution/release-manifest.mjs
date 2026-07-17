import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const COMMIT = /^[a-f0-9]{40}$/;
const IMAGE = /^(?:ghcr\.io|docker\.io)\/[A-Za-z0-9._/-]+(?::[A-Za-z0-9._-]+)?@sha256:[a-f0-9]{64}$/;

function requiredString(value, name, pattern) {
  if (typeof value !== "string" || !value || (pattern && !pattern.test(value))) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

export function currentVersion(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  return fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
}

export function createReleaseManifest(input) {
  const version = requiredString(input.version, "version", VERSION);
  const manifest = {
    schemaVersion: "1.0",
    product: "bairui-agent",
    version,
    channel: version.includes("-") ? "prerelease" : "stable",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    contractsVersion: requiredString(input.contractsVersion, "contractsVersion", VERSION),
    commits: {
      platform: requiredString(input.platformCommit, "platformCommit", COMMIT),
      agent: requiredString(input.agentCommit, "agentCommit", COMMIT),
      hermes: requiredString(input.hermesCommit, "hermesCommit", COMMIT),
      bailongma: requiredString(input.bailongmaCommit, "bailongmaCommit", COMMIT)
    },
    images: {
      platform: requiredString(input.platformImage, "platformImage", IMAGE),
      runtime: requiredString(input.runtimeImage, "runtimeImage", IMAGE),
      hermes: requiredString(input.hermesImage, "hermesImage", IMAGE),
      postgres: requiredString(input.postgresImage, "postgresImage", IMAGE),
      caddy: requiredString(input.caddyImage, "caddyImage", IMAGE)
    },
    database: {
      engine: "postgresql",
      migration: requiredString(input.migration, "migration", /^\d{3}_[A-Za-z0-9_-]+\.sql$/)
    },
    install: {
      composeProject: "bairui-agent",
      minimumDockerMajor: 27,
      supportedArchitectures: ["amd64"]
    }
  };
  validateReleaseManifest(manifest);
  return manifest;
}

export function validateReleaseManifest(manifest, options = {}) {
  if (!manifest || manifest.schemaVersion !== "1.0" || manifest.product !== "bairui-agent") throw new TypeError("Release manifest identity is invalid");
  requiredString(manifest.version, "version", VERSION);
  if (options.expectedVersion && manifest.version !== options.expectedVersion) throw new TypeError("Release manifest version does not match the requested version");
  if (manifest.channel !== (manifest.version.includes("-") ? "prerelease" : "stable")) throw new TypeError("Release channel does not match the version");
  requiredString(manifest.contractsVersion, "contractsVersion", VERSION);
  for (const [name, value] of Object.entries(manifest.commits ?? {})) requiredString(value, `commits.${name}`, COMMIT);
  for (const name of ["platform", "agent", "hermes", "bailongma"]) requiredString(manifest.commits?.[name], `commits.${name}`, COMMIT);
  for (const name of ["platform", "runtime", "hermes", "postgres", "caddy"]) requiredString(manifest.images?.[name], `images.${name}`, IMAGE);
  if (!manifest.images.platform.startsWith("ghcr.io/lutao581314/bairui-platform@")) throw new TypeError("Platform image repository is invalid");
  if (!manifest.images.runtime.startsWith("ghcr.io/lutao581314/bairui-runtime@")) throw new TypeError("Runtime image repository is invalid");
  if (!manifest.images.hermes.startsWith("ghcr.io/lutao581314/bairui-hermes@")) throw new TypeError("Hermes image repository is invalid");
  if (manifest.database?.engine !== "postgresql" || !/^\d{3}_[A-Za-z0-9_-]+\.sql$/.test(manifest.database?.migration ?? "")) throw new TypeError("Database release metadata is invalid");
  if (!Number.isInteger(manifest.install?.minimumDockerMajor) || manifest.install.minimumDockerMajor < 27) throw new TypeError("Docker minimum version is invalid");
  if (!Array.isArray(manifest.install?.supportedArchitectures) || !manifest.install.supportedArchitectures.includes("amd64")) throw new TypeError("Release architecture inventory is invalid");
  return manifest;
}
