import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  ".github/workflows/ci.yml",
  "apps/web/app.mjs",
  "apps/web/server.mjs",
  "apps/web/views.mjs",
  "apps/web/public/styles.css",
  "apps/web/public/login.js",
  "apps/web/admin/admin.js",
  "packages/auth/authorization.mjs",
  "packages/auth/password.mjs",
  "packages/auth/session.mjs",
  "packages/db/memory-repository.mjs",
  "packages/db/postgres-repository.mjs",
  "packages/db/migrations/001_initial.sql",
  "packages/db/migrations/002_operations.sql",
  "packages/db/migrations/003_integrations_and_memory.sql",
  "packages/db/migrations/004_control_plane.sql",
  "packages/db/migrations/005_multi_tenant_agents.sql",
  "packages/db/migrations/006_agent_fleet_telemetry.sql",
  "packages/db/migrations/007_control_command_delivery.sql",
  "packages/db/migrations/008_user_agent_surfaces.sql",
  "packages/db/migrations/009_control_plane_admin_domains.sql",
  "scripts/check-postgres-schema.mjs",
  "packages/server-protocol/runtime-client.mjs",
  "packages/server-protocol/control-plane.mjs",
  "packages/bailongma-ui/index.mjs",
  "packages/bailongma-ui/compatibility.mjs",
  "packages/security/secret-envelope.mjs",
  "packages/memory/obsidian-note.mjs",
  "packages/license/license.mjs",
  "packages/deployment/bundle.mjs",
  "tests/authorization.test.mjs",
  "tests/session.test.mjs",
  "tests/platform-http.test.mjs",
  "tests/control-plane-protocol.test.mjs",
  "tests/bailongma-ui.test.mjs",
  "server-agent/index.mjs",
  "server-agent/control-client.mjs",
  "server-agent/daemon.mjs",
  "server-agent/supervisor.mjs",
  "infra/systemd/bairui-server-agent.service",
  "infra/server-agent.env.example",
  "server-agent/bin/acceptance-check.mjs",
  "Dockerfile",
  "infra/docker-compose.yml",
  "infra/nginx/bairui.conf",
  ".gitmodules",
  "upstreams/bailongma/brain-ui.html",
  "upstreams/bailongma/src/ui/brain-ui/app.js",
  "upstreams/bailongma/LICENSE",
  "apps/web/public/bairui-bailongma.css",
  "apps/web/public/bairui-bailongma.js",
  "apps/web/public/bairui-workspace.js",
  "apps/web/public/bairui-scene-bootstrap.js",
  "docs/10-control-plane-architecture.md",
  "docs/11-control-plane-protocol.md",
  "docs/12-control-plane-security.md",
  "docs/13-control-plane-operations.md",
  "docs/14-multi-tenant-agent-runtime.md",
  "docs/15-agent-fleet-control.md",
  "docs/16-control-command-delivery.md"
];
const failures = [];
for (const file of required) if (!fs.existsSync(path.join(root, file))) failures.push(`Missing required platform file: ${file}`);
if (fs.existsSync(path.join(root, "docs/06-server-agent-p0.md"))) failures.push("Obsolete P0 server-agent document must be removed");
if (fs.existsSync(path.join(root, "apps/web/public/user.js"))) failures.push("Legacy handcrafted user frontend must be removed");
const server = fs.existsSync(path.join(root, "apps/web/app.mjs")) ? fs.readFileSync(path.join(root, "apps/web/app.mjs"), "utf8") : "";
for (const evidence of ["PERMISSIONS.CONTROL_PLANE_READ", "PERMISSIONS.ORG_MEMBERS_MANAGE", "PERMISSIONS.PLATFORM_PROVIDER_SETTINGS_MANAGE", "invalid_agent_credential", "statusCode = 401"]) {
  if (!server.includes(evidence)) failures.push(`Missing server authorization evidence: ${evidence}`);
}
for (const legacy of ['url.pathname === "/message"', 'url.pathname === "/events"', "createBailongmaEventHub", "toBailongmaConversations"]) {
  if (server.includes(legacy)) failures.push(`Legacy or synthesized BaiLongma transport is forbidden: ${legacy}`);
}
for (const evidence of ["sessions.chat.stream", "runs.events", "runtimeClient.streamOperation", "ownerUserId !== principal.userId"]) {
  if (!server.includes(evidence)) failures.push(`Missing multi-tenant Runtime evidence: ${evidence}`);
}
const overlayPath = path.join(root, "apps/web/public/bairui-bailongma.js");
const overlay = fs.existsSync(overlayPath) ? fs.readFileSync(overlayPath, "utf8") : "";
for (const evidence of ["assistant.delta", "assistant.completed", "sessions/${encodeURIComponent", "chat/stream", "AbortController", "attachments"]) {
  if (!overlay.includes(evidence)) failures.push(`Missing BaiLongma native Hermes adapter evidence: ${evidence}`);
}
const workspacePath = path.join(root, "apps/web/public/bairui-workspace.js");
const workspace = fs.existsSync(workspacePath) ? fs.readFileSync(workspacePath, "utf8") : "";
for (const view of ["renderConversations", "renderAgents", "renderMemory", "renderSkills", "renderChannels", "renderHotspots", "renderRuns", "renderJobs", "renderUsage", "renderSettings"]) {
  if (!workspace.includes(view)) failures.push(`Missing BaiRui user workspace view: ${view}`);
}
const controlProtocolPath = path.join(root, "packages/server-protocol/control-plane.mjs");
const controlProtocol = fs.existsSync(controlProtocolPath) ? fs.readFileSync(controlProtocolPath, "utf8") : "";
for (const action of ["snapshot.collect", "deployment.provision", "deployment.start", "deployment.stop", "deployment.suspend", "deployment.resume", "deployment.delete", "credential.revoke", "probe.run", "contract.test", "smoke.test", "upstream.check", "config.stage", "config.apply", "backup.create", "backup.verify", "release.stage", "release.apply", "release.rollback", "service.restart"]) {
  if (!controlProtocol.includes(`"${action}"`)) failures.push(`Missing allowed control action: ${action}`);
}
for (const prefix of ["prompt.", "conversation.", "task.", "model.", "tool.", "skill.", "memory.", "runtime.", "shell.", "script.", "sql."]) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`["']${escaped}[A-Za-z]`).test(controlProtocol)) failures.push(`Hermes/business action must not enter control protocol: ${prefix}*`);
}
if (/RuntimeRequest|runtime-client/.test(controlProtocol)) failures.push("Control protocol must not call the Hermes Runtime API");
const controlMigrationPath = path.join(root, "packages/db/migrations/004_control_plane.sql");
const controlMigration = fs.existsSync(controlMigrationPath) ? fs.readFileSync(controlMigrationPath, "utf8") : "";
for (const table of ["control_deployments", "module_instances", "desired_states", "observations", "control_commands", "command_attempts", "control_approvals", "config_revisions", "release_manifests", "release_rollouts", "release_gates", "test_runs", "test_artifacts", "upstream_candidates", "backup_records", "incidents", "control_events", "alert_rules", "agent_identities", "audit_hash_chain", "control_outbox", "control_dead_letters"]) {
  if (!controlMigration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) failures.push(`Missing control-plane table: ${table}`);
}
const tenantMigrationPath = path.join(root, "packages/db/migrations/005_multi_tenant_agents.sql");
const tenantMigration = fs.existsSync(tenantMigrationPath) ? fs.readFileSync(tenantMigrationPath, "utf8") : "";
for (const table of ["agent_memberships", "agent_runtimes"]) {
  if (!tenantMigration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) failures.push(`Missing multi-tenant Agent table: ${table}`);
}
for (const field of ["owner_user_id", "initialization_status", "desired_runtime_state", "workspace_ref"]) {
  if (!tenantMigration.includes(field)) failures.push(`Missing multi-tenant Agent field: ${field}`);
}
const fleetMigrationPath = path.join(root, "packages/db/migrations/006_agent_fleet_telemetry.sql");
const fleetMigration = fs.existsSync(fleetMigrationPath) ? fs.readFileSync(fleetMigrationPath, "utf8") : "";
for (const table of ["agent_components", "heartbeats", "telemetry_events", "usage_rollups", "alerts", "secret_references"]) {
  if (!fleetMigration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) failures.push(`Missing Agent fleet table: ${table}`);
}
for (const evidence of ["/api/internal/control-plane/heartbeats", "/api/admin/agents", "requestAgentProvisioning"]) {
  if (!server.includes(evidence)) failures.push(`Missing Agent fleet server evidence: ${evidence}`);
}
const deliveryMigrationPath = path.join(root, "packages/db/migrations/007_control_command_delivery.sql");
const deliveryMigration = fs.existsSync(deliveryMigrationPath) ? fs.readFileSync(deliveryMigrationPath, "utf8") : "";
for (const table of ["server_credentials", "agent_runtime_credentials", "machine_request_nonces", "command_receipts"]) {
  if (!deliveryMigration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) failures.push(`Missing command delivery table: ${table}`);
}
for (const evidence of ["/api/internal/control-plane/commands/lease", "recordCommandReceipt", "verifyMachineRequest", "revealLease"]) {
  if (!server.includes(evidence)) failures.push(`Missing command delivery server evidence: ${evidence}`);
}
const userSurfaceMigrationPath = path.join(root, "packages/db/migrations/008_user_agent_surfaces.sql");
const userSurfaceMigration = fs.existsSync(userSurfaceMigrationPath) ? fs.readFileSync(userSurfaceMigrationPath, "utf8") : "";
for (const table of ["agent_skill_preferences", "agent_channel_bindings", "agent_hotspot_bookmarks"]) {
  if (!userSurfaceMigration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) failures.push(`Missing Agent user-surface table: ${table}`);
}
for (const evidence of ["/memory-notes", "/skills", "/channels", "/hotspots", "/usage"]) {
  if (!server.includes(evidence)) failures.push(`Missing Agent-scoped user API evidence: ${evidence}`);
}
const adminDomainsMigrationPath = path.join(root, "packages/db/migrations/009_control_plane_admin_domains.sql");
const adminDomainsMigration = fs.existsSync(adminDomainsMigrationPath) ? fs.readFileSync(adminDomainsMigrationPath, "utf8") : "";
for (const table of ["provider_channels", "model_policies", "data_retention_policies", "sensitive_access_grants", "sensitive_access_events"]) {
  if (!adminDomainsMigration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) failures.push(`Missing control-plane admin table: ${table}`);
}
for (const evidence of ["/api/admin/provider-channels", "/api/admin/model-policy", "/api/admin/data-retention", "/api/admin/sensitive-access", "/api/admin/release-gates", "/api/admin/backups", "/api/admin/upstreams", "/api/admin/control-commands", "/api/admin/control-approvals", "/api/admin/release-manifests"]) {
  if (!server.includes(evidence)) failures.push(`Missing control-plane administration API: ${evidence}`);
}
const adminViewPath = path.join(root, "apps/web/views.mjs");
const adminView = fs.existsSync(adminViewPath) ? fs.readFileSync(adminViewPath, "utf8") : "";
for (const panel of ["overview", "users", "agents", "operations", "providers", "integrations", "channels", "config", "versions", "alerts", "audit", "release", "backups", "retention", "sensitive"]) {
  if (!adminView.includes(`data-view-panel="${panel}"`)) failures.push(`Missing administrator panel: ${panel}`);
}
const supervisorPath = path.join(root, "server-agent/supervisor.mjs");
const supervisor = fs.existsSync(supervisorPath) ? fs.readFileSync(supervisorPath, "utf8") : "";
if (!supervisor.includes('this.execFile("docker", args')) failures.push("Supervisor must use fixed docker execFile arguments");
for (const forbidden of ["exec(", "shell: true", "rm -rf", "child_process.exec("]) if (supervisor.includes(forbidden)) failures.push(`Forbidden Supervisor execution pattern: ${forbidden}`);
if (failures.length) {
  console.error("Platform check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Platform check passed.");
