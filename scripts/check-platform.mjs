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
  "apps/web/public/app.js",
  "packages/auth/authorization.mjs",
  "packages/auth/password.mjs",
  "packages/auth/session.mjs",
  "packages/db/memory-repository.mjs",
  "packages/db/migrations/001_initial.sql",
  "tests/authorization.test.mjs",
  "tests/session.test.mjs",
  "tests/platform-http.test.mjs"
];
const failures = [];
for (const file of required) if (!fs.existsSync(path.join(root, file))) failures.push(`Missing required platform file: ${file}`);
const server = fs.existsSync(path.join(root, "apps/web/app.mjs")) ? fs.readFileSync(path.join(root, "apps/web/app.mjs"), "utf8") : "";
for (const evidence of ["PERMISSIONS.CONTROL_PLANE_READ", "PERMISSIONS.ORG_MEMBERS_MANAGE", "invalid_agent_credential", "statusCode = 401"]) {
  if (!server.includes(evidence)) failures.push(`Missing server authorization evidence: ${evidence}`);
}
if (failures.length) {
  console.error("Platform check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Platform check passed.");
