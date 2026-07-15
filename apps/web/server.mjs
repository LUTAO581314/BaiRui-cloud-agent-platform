import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createPlatformServer } from "./app.mjs";
import { MemoryPlatformRepository } from "../../packages/db/memory-repository.mjs";
import { hashPassword } from "../../packages/auth/password.mjs";
import { ROLES } from "../../packages/auth/authorization.mjs";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const production = process.env.NODE_ENV === "production";
const sessionSecret = process.env.BAIRUI_SESSION_SECRET;
if (production && (!sessionSecret || sessionSecret.length < 32)) throw new Error("BAIRUI_SESSION_SECRET must contain at least 32 characters in production");

const repository = new MemoryPlatformRepository();
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
await repository.createAgent({ organizationId: organization.id, name: "BaiRui Agent", description: "Hermes runtime boundary" });
await repository.recordAudit({ organizationId: organization.id, actorUserId: admin.id, action: "platform.bootstrap", targetType: "organization", targetId: organization.id });

const server = createPlatformServer({
  repository,
  sessionSecret: sessionSecret ?? "development-session-secret-change-me-32",
  secureCookies: production,
  configuredOrigin: process.env.BAIRUI_PLATFORM_ORIGIN,
  allowRegistration: process.env.BAIRUI_ALLOW_REGISTRATION === "1",
  agentIngestToken: process.env.BAIRUI_AGENT_INGEST_TOKEN,
  styles: fs.readFileSync(path.join(appDir, "public", "styles.css"), "utf8"),
  clientScript: fs.readFileSync(path.join(appDir, "public", "app.js"), "utf8")
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, process.env.HOST ?? "127.0.0.1", () => {
  console.log(`BaiRui platform listening on port ${port}`);
});
