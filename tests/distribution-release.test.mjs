import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createReleaseManifest, currentVersion, validateReleaseManifest } from "../distribution/release-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (name) => `ghcr.io/lutao581314/${name}@sha256:${"a".repeat(64)}`;
const input = {
  version: "0.1.0-rc.4",
  generatedAt: "2026-07-17T00:00:00.000Z",
  contractsVersion: "1.2.1",
  platformCommit: "1".repeat(40),
  agentCommit: "2".repeat(40),
  hermesCommit: "3".repeat(40),
  bailongmaCommit: "4".repeat(40),
  platformImage: digest("bairui-platform"),
  runtimeImage: digest("bairui-runtime"),
  hermesImage: digest("bairui-hermes"),
  postgresImage: `docker.io/library/postgres:17-alpine@sha256:${"b".repeat(64)}`,
  caddyImage: `docker.io/library/caddy:2-alpine@sha256:${"c".repeat(64)}`,
  migration: "018_durable_channel_delivery.sql"
};

test("distribution version is a single explicit prerelease", () => {
  const version = currentVersion(root);
  const packageDocument = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const installer = fs.readFileSync(path.join(root, "distribution/install.sh"), "utf8");
  assert.equal(version, "0.1.0-rc.4");
  assert.equal(packageDocument.version, version);
  assert.match(installer, new RegExp(`^readonly INSTALLER_VERSION="${version.replaceAll(".", "\\.")}"$`, "m"));
});

test("release manifest binds all deployable images by digest", () => {
  const manifest = createReleaseManifest(input);
  assert.equal(validateReleaseManifest(manifest, { expectedVersion: input.version }), manifest);
  assert.equal(manifest.channel, "prerelease");
  assert.deepEqual(Object.keys(manifest.images), ["platform", "runtime", "hermes", "postgres", "caddy"]);
});

test("release manifest rejects mutable images and inconsistent channels", () => {
  assert.throws(() => createReleaseManifest({ ...input, runtimeImage: "ghcr.io/lutao581314/bairui-runtime:latest" }), /runtimeImage is invalid/);
  const manifest = createReleaseManifest(input);
  assert.throws(() => validateReleaseManifest({ ...manifest, channel: "stable" }), /channel/);
});

test("installer and Compose prohibit latest tags and include the complete deployment", () => {
  const installer = fs.readFileSync(path.join(root, "distribution/install.sh"), "utf8");
  const compose = fs.readFileSync(path.join(root, "distribution/compose.yaml"), "utf8");
  assert.doesNotMatch(installer + compose, /:latest\b/);
  for (const service of ["postgres:", "platform:", "channel-worker:", "caddy:", "server-agent:"]) assert.match(compose, new RegExp(`^  ${service}`, "m"));
  for (const evidence of ["sha256sum --check --strict", "register_server_agent", "rollback_on_error", "docker pull", "wait_for_platform", "verify_running_images", "Config.Image"]) assert.match(installer, new RegExp(evidence.replace(".", "\\.")));
});

test("installer force-recreates services after registration and while rolling back", () => {
  const installer = fs.readFileSync(path.join(root, "distribution/install.sh"), "utf8");
  assert.match(installer, /compose up -d --wait postgres[\s\S]*compose up -d --no-deps --force-recreate --wait platform[\s\S]*compose up -d --no-deps --force-recreate --wait channel-worker caddy[\s\S]*register_server_agent[\s\S]*compose --profile node up -d --no-deps --force-recreate server-agent[\s\S]*verify_running_images/);
  const rollback = installer.slice(installer.indexOf("rollback_on_error()"), installer.indexOf("wait_for_platform()"));
  assert.match(rollback, /--force-recreate platform/);
  assert.match(rollback, /--force-recreate channel-worker caddy/);
  assert.match(rollback, /--force-recreate server-agent/);
});

test("generated license PEM survives the sourceable Compose environment", { skip: process.platform === "win32" }, () => {
  const installer = fs.readFileSync(path.join(root, "distribution/install.sh"), "utf8");
  const assignment = installer.match(/^BAIRUI_LICENSE_PRIVATE_KEY=.*$/gm)?.find((line) => line.includes("$license_key"));
  assert.equal(assignment, "BAIRUI_LICENSE_PRIVATE_KEY='$license_key'");

  const script = String.raw`set -euo pipefail
env_file="$(mktemp)"
trap 'rm -f "$env_file"' EXIT
license_key="$(openssl genpkey -algorithm ED25519 2>/dev/null | awk '{printf "%s\\n",$0}')"
cat > "$env_file" <<EOF
${assignment}
EOF
source "$env_file"
node -e 'require("node:crypto").createPrivateKey(process.argv[1].replaceAll("\\n", "\n"))' -- "$BAIRUI_LICENSE_PRIVATE_KEY"`;
  const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
