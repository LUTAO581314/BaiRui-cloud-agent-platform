import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createPlatformServer } from "./app.mjs";
import { MemoryPlatformRepository } from "../../packages/db/memory-repository.mjs";
import { PostgresPlatformRepository } from "../../packages/db/postgres-repository.mjs";
import { hashPassword } from "../../packages/auth/password.mjs";
import { ROLES } from "../../packages/auth/authorization.mjs";
import { BairuiRuntimeClient } from "../../packages/server-protocol/runtime-client.mjs";
import { SecretEnvelope } from "../../packages/security/secret-envelope.mjs";
import { createBailongmaUi } from "../../packages/bailongma-ui/index.mjs";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "..", "..");
const production = process.env.NODE_ENV === "production";
const sessionSecret = process.env.BAIRUI_SESSION_SECRET;
if (production && (!sessionSecret || sessionSecret.length < 32)) throw new Error("BAIRUI_SESSION_SECRET must contain at least 32 characters in production");

const databaseUrl = process.env.DATABASE_URL ?? process.env.BAIRUI_PLATFORM_DATABASE_URL;
if (production && !databaseUrl) throw new Error("DATABASE_URL is required in production");
const repository = databaseUrl
  ? new PostgresPlatformRepository({ connectionString: databaseUrl, ssl: process.env.BAIRUI_DATABASE_SSL === "1" ? { rejectUnauthorized: true } : undefined })
  : new MemoryPlatformRepository();
const providerEncryptionKey = process.env.BAIRUI_PROVIDER_ENCRYPTION_KEY ?? (production ? "" : "development-provider-encryption-key-change-me");
if (!providerEncryptionKey) throw new Error("BAIRUI_PROVIDER_ENCRYPTION_KEY is required in production");
const providerVault = new SecretEnvelope(providerEncryptionKey);
const organization = await repository.createOrganization({ id: "org_bairui", name: "bairui-agent" });
const adminEmail = process.env.BAIRUI_BOOTSTRAP_ADMIN_EMAIL ?? "admin@bairui.local";
const adminPassword = process.env.BAIRUI_BOOTSTRAP_ADMIN_PASSWORD ?? (production ? "" : "Bairui-Admin-Change-Me-2026");
if (!adminPassword) throw new Error("BAIRUI_BOOTSTRAP_ADMIN_PASSWORD is required in production");
const admin = await repository.createUser({
  organizationId: organization.id,
  email: adminEmail,
  displayName: "bairui-agent Administrator",
  passwordHash: await hashPassword(adminPassword),
  role: ROLES.PLATFORM_ADMIN
});
await repository.createAgent({ id: "agent_bairui", organizationId: organization.id, ownerUserId: admin.id, name: "bairui-agent", description: "Hermes runtime boundary" });
await repository.recordAudit({ organizationId: organization.id, actorUserId: admin.id, action: "platform.bootstrap", targetType: "organization", targetId: organization.id });

const server = createPlatformServer({
  repository,
  sessionSecret: sessionSecret ?? "development-session-secret-change-me-32",
  secureCookies: production,
  configuredOrigin: process.env.BAIRUI_PLATFORM_ORIGIN,
  runtimeRouteHosts: (process.env.BAIRUI_RUNTIME_ROUTE_HOSTS ?? "").split(",").map((item) => item.trim()).filter(Boolean),
  runtimeStaleAfterMs: Math.max(30_000, Number(process.env.BAIRUI_RUNTIME_STALE_AFTER_MS) || 120_000),
  resourceStaleAfterMs: Math.max(30_000, Number(process.env.BAIRUI_RESOURCE_STALE_AFTER_MS) || 120_000),
  allowRegistration: process.env.BAIRUI_ALLOW_REGISTRATION === "1",
  agentIngestToken: process.env.BAIRUI_AGENT_INGEST_TOKEN,
  runtimeClient: process.env.BAIRUI_RUNTIME_SHARED_SECRET ? new BairuiRuntimeClient({
    baseUrl: process.env.BAIRUI_RUNTIME_URL ?? "http://127.0.0.1:8787",
    sharedSecret: process.env.BAIRUI_RUNTIME_SHARED_SECRET,
    resolveRuntime: async (agent) => {
      const route = await repository.getAgentRuntimeRoute(agent.id);
      if (route?.runtime.endpointRef && route.secretEnvelope?.runtimeSharedSecret) {
        return { baseUrl: route.runtime.endpointRef, sharedSecret: providerVault.open(route.secretEnvelope.runtimeSharedSecret) };
      }
      if (agent.id === "agent_bairui") return { baseUrl: process.env.BAIRUI_RUNTIME_URL ?? "http://127.0.0.1:8787", sharedSecret: process.env.BAIRUI_RUNTIME_SHARED_SECRET };
      throw Object.assign(new Error("Agent Runtime route is unavailable"), { code: "runtime_route_unavailable", statusCode: 503 });
    }
  }) : undefined,
  providerVault,
  licensePrivateKey: process.env.BAIRUI_LICENSE_PRIVATE_KEY?.replaceAll("\\n", "\n"),
  styles: fs.readFileSync(path.join(appDir, "public", "styles.css"), "utf8"),
  logo: fs.readFileSync(path.join(appDir, "public", "bairui-agent-logo.png")),
  icon: fs.readFileSync(path.join(appDir, "public", "bairui-agent-icon.png")),
  loginScript: fs.readFileSync(path.join(appDir, "public", "login.js"), "utf8"),
  adminScript: fs.readFileSync(path.join(appDir, "admin", "admin.js"), "utf8"),
  bailongmaUi: createBailongmaUi({ root: path.join(repoRoot, "upstreams", "bailongma") }),
  bailongmaOverlayCss: fs.readFileSync(path.join(appDir, "public", "bairui-bailongma.css"), "utf8"),
  bailongmaOverlayScript: fs.readFileSync(path.join(appDir, "public", "bairui-bailongma.js"), "utf8"),
  bairuiWorkspaceScript: fs.readFileSync(path.join(appDir, "public", "bairui-workspace.js"), "utf8"),
  bailongmaSceneBootstrap: fs.readFileSync(path.join(appDir, "public", "bairui-scene-bootstrap.js"), "utf8")
});

const healthEvaluationIntervalMs = Math.max(15_000, Number(process.env.BAIRUI_HEALTH_EVALUATION_INTERVAL_MS) || 30_000);
const runtimeStaleAfterMs = Math.max(30_000, Number(process.env.BAIRUI_RUNTIME_STALE_AFTER_MS) || 120_000);
async function evaluateControlPlaneHealth() {
  try {
    await repository.evaluateOfflineAlerts({ staleAfterMs: runtimeStaleAfterMs });
  } catch (error) {
    console.error("Control-plane health evaluation failed", error);
  }
}
await evaluateControlPlaneHealth();
const healthEvaluationTimer = setInterval(evaluateControlPlaneHealth, healthEvaluationIntervalMs);
healthEvaluationTimer.unref();

const retentionIntervalMs = Math.max(15 * 60_000, Number(process.env.BAIRUI_RETENTION_INTERVAL_MS) || 6 * 60 * 60_000);
let retentionRunning = false;
async function enforceRetention() {
  if (retentionRunning) return;
  retentionRunning = true;
  try {
    await repository.enforceRetentionPolicies();
  } catch (error) {
    console.error("Control-plane retention enforcement failed", error);
  } finally {
    retentionRunning = false;
  }
}
await enforceRetention();
const retentionTimer = setInterval(enforceRetention, retentionIntervalMs);
retentionTimer.unref();

const port = Number(process.env.PORT ?? 3000);
server.listen(port, process.env.HOST ?? "127.0.0.1", () => {
  console.log(`bairui-agent platform listening on port ${port}`);
});
