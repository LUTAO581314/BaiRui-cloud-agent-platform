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

const appDir = path.dirname(fileURLToPath(import.meta.url));
const production = process.env.NODE_ENV === "production";
const sessionSecret = process.env.BAIRUI_SESSION_SECRET;
if (production && (!sessionSecret || sessionSecret.length < 32)) throw new Error("BAIRUI_SESSION_SECRET must contain at least 32 characters in production");

const databaseUrl = process.env.DATABASE_URL ?? process.env.BAIRUI_PLATFORM_DATABASE_URL;
if (production && !databaseUrl) throw new Error("DATABASE_URL is required in production");
const repository = databaseUrl
  ? new PostgresPlatformRepository({ connectionString: databaseUrl, ssl: process.env.BAIRUI_DATABASE_SSL === "1" ? { rejectUnauthorized: true } : undefined })
  : new MemoryPlatformRepository();
const organization = await repository.createOrganization({ id: "org_bairui", name: "BaiRui" });
const adminEmail = process.env.BAIRUI_BOOTSTRAP_ADMIN_EMAIL ?? "admin@bairui.local";
const adminPassword = process.env.BAIRUI_BOOTSTRAP_ADMIN_PASSWORD ?? (production ? "" : "Bairui-Admin-Change-Me-2026");
if (!adminPassword) throw new Error("BAIRUI_BOOTSTRAP_ADMIN_PASSWORD is required in production");
const admin = await repository.createUser({
  organizationId: organization.id,
  email: adminEmail,
  displayName: "BaiRui Administrator",
  passwordHash: await hashPassword(adminPassword),
  role: ROLES.PLATFORM_ADMIN
});
await repository.createAgent({ id: "agent_bairui", organizationId: organization.id, name: "BaiRui Agent", description: "Hermes runtime boundary" });
await repository.recordAudit({ organizationId: organization.id, actorUserId: admin.id, action: "platform.bootstrap", targetType: "organization", targetId: organization.id });

const server = createPlatformServer({
  repository,
  sessionSecret: sessionSecret ?? "development-session-secret-change-me-32",
  secureCookies: production,
  configuredOrigin: process.env.BAIRUI_PLATFORM_ORIGIN,
  allowRegistration: process.env.BAIRUI_ALLOW_REGISTRATION === "1",
  agentIngestToken: process.env.BAIRUI_AGENT_INGEST_TOKEN,
  runtimeClient: process.env.BAIRUI_RUNTIME_SHARED_SECRET ? new BairuiRuntimeClient({
    baseUrl: process.env.BAIRUI_RUNTIME_URL ?? "http://127.0.0.1:8787",
    sharedSecret: process.env.BAIRUI_RUNTIME_SHARED_SECRET
  }) : undefined,
  licensePrivateKey: process.env.BAIRUI_LICENSE_PRIVATE_KEY?.replaceAll("\\n", "\n"),
  styles: fs.readFileSync(path.join(appDir, "public", "styles.css"), "utf8"),
  loginScript: fs.readFileSync(path.join(appDir, "public", "login.js"), "utf8"),
  userScript: fs.readFileSync(path.join(appDir, "public", "user.js"), "utf8"),
  adminScript: fs.readFileSync(path.join(appDir, "admin", "admin.js"), "utf8")
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, process.env.HOST ?? "127.0.0.1", () => {
  console.log(`BaiRui platform listening on port ${port}`);
});
