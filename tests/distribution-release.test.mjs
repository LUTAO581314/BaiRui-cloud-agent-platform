import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createReleaseManifest, currentVersion, validateReleaseManifest } from "../distribution/release-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (name) => `ghcr.io/lutao581314/${name}@sha256:${"a".repeat(64)}`;
const input = {
  version: "0.1.0-rc.8",
  generatedAt: "2026-07-17T00:00:00.000Z",
  contractsVersion: "2.3.0-rc.2",
  platformCommit: "1".repeat(40),
  agentCommit: "2".repeat(40),
  hermesCommit: "3".repeat(40),
  bailongmaCommit: "4".repeat(40),
  platformImage: digest("bairui-platform"),
  runtimeImage: digest("bairui-runtime"),
  hermesImage: digest("bairui-hermes"),
  postgresImage: `docker.io/library/postgres:17-alpine@sha256:${"b".repeat(64)}`,
  caddyImage: `docker.io/library/caddy:2-alpine@sha256:${"c".repeat(64)}`,
  migration: "020_scene_projection.sql"
};

test("distribution version is a single explicit prerelease", () => {
  const version = currentVersion(root);
  const packageDocument = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const installer = fs.readFileSync(path.join(root, "distribution/install.sh"), "utf8");
  assert.equal(version, "0.1.0-rc.8");
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
  const externalProxyCompose = fs.readFileSync(path.join(root, "distribution/compose.external-proxy.yaml"), "utf8");
  assert.doesNotMatch(installer + compose + externalProxyCompose, /:latest\b/);
  for (const service of ["postgres:", "platform:", "channel-worker:", "caddy:", "server-agent:"]) assert.match(compose, new RegExp(`^  ${service}`, "m"));
  for (const evidence of ["sha256sum --check --strict", "register_server_agent", "rollback_on_error", "docker pull", "wait_for_platform", "verify_running_images", "Config.Image"]) assert.match(installer, new RegExp(evidence.replace(".", "\\.")));
});

test("direct TLS remains the default and external proxy mode keeps Caddy routing", () => {
  const installer = fs.readFileSync(path.join(root, "distribution/install.sh"), "utf8");
  const compose = fs.readFileSync(path.join(root, "distribution/compose.yaml"), "utf8");
  const externalProxyCompose = fs.readFileSync(path.join(root, "distribution/compose.external-proxy.yaml"), "utf8");
  const caddyfile = fs.readFileSync(path.join(root, "distribution/Caddyfile"), "utf8");

  assert.match(installer, /^DEPLOYMENT_MODE="direct"$/m);
  for (const binding of ['"80:80"', '"443:443"', '"443:443/udp"']) assert.match(compose, new RegExp(`^      - ${binding.replaceAll("/", "\\/")}$`, "m"));
  assert.match(externalProxyCompose, /^      BAIRUI_SITE_ADDRESS: ":8080"$/m);
  assert.match(externalProxyCompose, /^    ports: !override\r?\n      - "\$\{BAIRUI_EXTERNAL_PROXY_BIND:\?BAIRUI_EXTERNAL_PROXY_BIND is required\}:8080"$/m);
  assert.doesNotMatch(externalProxyCompose, /"(?:80|443):(?:80|443)/);
  assert.match(caddyfile, /^  @wechat path \/callbacks\/wechat\/\*$/m);
  assert.match(caddyfile, /^  reverse_proxy @wechat channel-worker:8790$/m);
  assert.match(caddyfile, /^  reverse_proxy platform:3000$/m);
});

test("external proxy CLI, bundle verification and rollback preserve the deployment mode", () => {
  const installer = fs.readFileSync(path.join(root, "distribution/install.sh"), "utf8");
  const verifyBundle = installer.slice(installer.indexOf("verify_bundle()"), installer.indexOf("install_host_dependencies()"));
  const rollback = installer.slice(installer.indexOf("rollback_on_error()"), installer.indexOf("wait_for_platform()"));

  for (const evidence of ["--external-proxy-bind", "127.0.0.0/8", "[::1]", "1024", "65535", "validate_external_proxy_bind"]) assert.match(installer, new RegExp(evidence.replaceAll("[", "\\[").replaceAll("]", "\\]")));
  for (const evidence of ["compose.external-proxy.yaml", "BAIRUI_DEPLOYMENT_MODE=direct", "BAIRUI_EXTERNAL_PROXY_BIND=127.0.0.1:18080"]) assert.match(verifyBundle, new RegExp(evidence.replaceAll(".", "\\.")));
  assert.match(verifyBundle, /-f "\$BUNDLE_DIR\/compose\.yaml" config[\s\S]*-f "\$BUNDLE_DIR\/compose\.yaml" -f "\$BUNDLE_DIR\/compose\.external-proxy\.yaml" config/);
  for (const assignment of ["BAIRUI_DEPLOYMENT_MODE=$DEPLOYMENT_MODE", "BAIRUI_EXTERNAL_PROXY_BIND=$EXTERNAL_PROXY_BIND"]) assert.match(installer, new RegExp(`^${assignment.replaceAll("$", "\\$")}$`, "m"));
  assert.match(installer, /install -m 0644 "\$BUNDLE_DIR\/compose\.external-proxy\.yaml" "\$INSTALL_DIR\/compose\.external-proxy\.yaml"/);
  assert.match(installer, /cp "\$INSTALL_DIR\/compose\.external-proxy\.yaml" "\$ROLLBACK_DIR\/compose\.external-proxy\.yaml"/);
  assert.match(rollback, /cp "\$ROLLBACK_DIR\/compose\.external-proxy\.yaml" "\$INSTALL_DIR\/compose\.external-proxy\.yaml"/);
  assert.match(rollback, /rm -f "\$INSTALL_DIR\/compose\.external-proxy\.yaml"/);
  assert.match(rollback, /cp "\$ROLLBACK_DIR\/bairui\.env" "\$CONFIG_DIR\/bairui\.env"/);

  const runningImages = installer.slice(installer.indexOf("verify_running_images()"), installer.indexOf("register_server_agent()"));
  assert.match(runningImages, /assert_container_image caddy "\$BAIRUI_CADDY_IMAGE"/);
});

test("external proxy bind rejects non-loopback and privileged endpoints", { skip: process.platform === "win32" }, () => {
  const installerPath = path.join(root, "distribution/install.sh");
  for (const bind of ["0.0.0.0:18080", "192.168.1.10:18080", "localhost:18080", "127.0.0.1:80", "[::]:18080", "[::1]:65536"]) {
    const result = spawnSync("bash", [installerPath, "--version", input.version, "--external-proxy-bind", bind, "--verify-only"], { encoding: "utf8" });
    assert.notEqual(result.status, 0, `${bind} must be rejected`);
    assert.match(`${result.stdout}\n${result.stderr}`, /external-proxy-bind/);
  }
});

test("release bundle contract includes the external proxy override", () => {
  const installer = fs.readFileSync(path.join(root, "distribution/install.sh"), "utf8");
  const override = fs.readFileSync(path.join(root, "distribution/compose.external-proxy.yaml"), "utf8");
  const ciWorkflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  const distributionWorkflow = fs.readFileSync(path.join(root, ".github/workflows/distribution.yml"), "utf8");
  assert.match(installer, /release-manifest\.json compose\.yaml compose\.external-proxy\.yaml Caddyfile/);
  assert.match(override, /ports: !override/);
  for (const workflow of [ciWorkflow, distributionWorkflow]) {
    assert.match(workflow, /cp distribution\/compose\.yaml distribution\/compose\.external-proxy\.yaml distribution\/Caddyfile dist\/bundle\//);
  }
});

test("installer force-recreates services after registration and while rolling back", () => {
  const installer = fs.readFileSync(path.join(root, "distribution/install.sh"), "utf8");
  assert.match(installer, /compose up -d --wait postgres[\s\S]*compose up -d --no-deps --force-recreate --wait platform[\s\S]*compose up -d --no-deps --force-recreate --wait channel-worker caddy[\s\S]*register_server_agent[\s\S]*compose --profile node up -d --no-deps --force-recreate server-agent[\s\S]*verify_running_images/);
  const rollback = installer.slice(installer.indexOf("rollback_on_error()"), installer.indexOf("wait_for_platform()"));
  assert.match(rollback, /--force-recreate platform/);
  assert.match(rollback, /--force-recreate channel-worker caddy/);
  assert.match(rollback, /--force-recreate server-agent/);
});

test("upgrade refreshes Runtime and Hermes from the new release manifest", () => {
  const installer = fs.readFileSync(path.join(root, "distribution/install.sh"), "utf8");
  const refresh = installer.slice(installer.indexOf("refresh_release_environment()"), installer.indexOf("compose()"));
  assert.match(refresh, /RUNTIME:runtime/);
  assert.match(refresh, /HERMES:hermes/);
  assert.match(installer, /docker pull "\$\(jq -r \.images\.runtime "\$INSTALL_DIR\/release-manifest\.json"\)"/);
  assert.match(installer, /docker pull "\$\(jq -r \.images\.hermes "\$INSTALL_DIR\/release-manifest\.json"\)"/);
});

test("health-gate failure reaches ERR rollback and restores external state", { skip: process.platform === "win32" }, () => {
  const installer = fs.readFileSync(path.join(root, "distribution/install.sh"), "utf8");
  const failDefinition = installer.slice(installer.indexOf("fail()"), installer.indexOf("require_command()"));
  assert.match(failDefinition, /return 1/);
  assert.doesNotMatch(failDefinition, /exit 1/);
  assert.match(installer, /trap rollback_on_error ERR[\s\S]*wait_for_platform/);
  const supportStart = installer.indexOf("log()");
  const supportEnd = installer.indexOf("usage()");
  const rollbackStart = installer.indexOf("rollback_on_error()");
  const rollbackEnd = installer.indexOf("wait_for_platform()");
  assert.ok(supportStart >= 0 && supportEnd > supportStart && rollbackStart >= 0 && rollbackEnd > rollbackStart);
  const shellSupport = installer.slice(supportStart, supportEnd) + installer.slice(rollbackStart, rollbackEnd);
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bairui-health-gate-"));
  const script = String.raw`set -Eeuo pipefail
${shellSupport}
INSTALL_DIR="$TEST_ROOT/install"
CONFIG_DIR="$TEST_ROOT/config"
ROLLBACK_DIR="$TEST_ROOT/rollback"
DEPLOYMENT_STARTED=1
mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$ROLLBACK_DIR"
printf 'old compose\n' > "$ROLLBACK_DIR/compose.yaml"
printf 'old caddy\n' > "$ROLLBACK_DIR/Caddyfile"
printf 'old manifest\n' > "$ROLLBACK_DIR/release-manifest.json"
printf 'old override\n' > "$ROLLBACK_DIR/compose.external-proxy.yaml"
printf 'BAIRUI_DEPLOYMENT_MODE=external-proxy\nBAIRUI_EXTERNAL_PROXY_BIND=127.0.0.1:18080\n' > "$ROLLBACK_DIR/bairui.env"
printf 'new compose\n' > "$INSTALL_DIR/compose.yaml"
printf 'new caddy\n' > "$INSTALL_DIR/Caddyfile"
printf 'new manifest\n' > "$INSTALL_DIR/release-manifest.json"
printf 'new override\n' > "$INSTALL_DIR/compose.external-proxy.yaml"
printf 'BAIRUI_DEPLOYMENT_MODE=direct\nBAIRUI_EXTERNAL_PROXY_BIND=\n' > "$CONFIG_DIR/bairui.env"
compose() { printf '%s\n' "$*" >> "$TEST_ROOT/compose.log"; }
wait_for_platform() { fail "simulated health gate failure"; }
trap rollback_on_error ERR
wait_for_platform
`;
  try {
    const result = spawnSync("bash", ["-c", script], {
      cwd: root,
      env: { ...process.env, TEST_ROOT: testRoot },
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.readFileSync(path.join(testRoot, "install", "compose.yaml"), "utf8"), "old compose\n");
    assert.equal(fs.readFileSync(path.join(testRoot, "install", "release-manifest.json"), "utf8"), "old manifest\n");
    assert.equal(fs.readFileSync(path.join(testRoot, "install", "compose.external-proxy.yaml"), "utf8"), "old override\n");
    assert.equal(fs.readFileSync(path.join(testRoot, "config", "bairui.env"), "utf8"), "BAIRUI_DEPLOYMENT_MODE=external-proxy\nBAIRUI_EXTERNAL_PROXY_BIND=127.0.0.1:18080\n");
    assert.match(fs.readFileSync(path.join(testRoot, "compose.log"), "utf8"), /--force-recreate platform/);
  } finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
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
