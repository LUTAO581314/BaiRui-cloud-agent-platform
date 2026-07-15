import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function hash(content) { return createHash("sha256").update(content).digest("hex"); }

export function createDeploymentConfig(input) {
  if (!input.organizationId || !input.licenseId || !input.serverId || !input.platformUrl) throw new TypeError("organizationId, licenseId, serverId, and platformUrl are required");
  return {
    schemaVersion: "1.0",
    organizationId: input.organizationId,
    licenseId: input.licenseId,
    serverId: input.serverId,
    platformUrl: String(input.platformUrl).replace(/\/$/, ""),
    agentRef: input.agentRef ?? "main",
    generatedAt: input.generatedAt ?? new Date().toISOString()
  };
}

export function writeDeliveryBundle(directory, input) {
  const resolved = path.resolve(directory);
  fs.mkdirSync(resolved, { recursive: true });
  const config = `${JSON.stringify(createDeploymentConfig(input), null, 2)}\n`;
  const files = { "deployment.json": config };
  if (input.licenseDocument) files["license.json"] = `${JSON.stringify(input.licenseDocument, null, 2)}\n`;
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(resolved, name), content, { encoding: "utf8", mode: 0o600 });
  const manifest = { schemaVersion: "1.0", files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { sha256: hash(content), bytes: Buffer.byteLength(content) }])) };
  fs.writeFileSync(path.join(resolved, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { directory: resolved, manifest };
}

export function verifyDeliveryBundle(directory) {
  const resolved = path.resolve(directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(resolved, "manifest.json"), "utf8"));
  const checks = Object.entries(manifest.files).map(([name, expected]) => {
    const target = path.join(resolved, name);
    const content = fs.existsSync(target) ? fs.readFileSync(target) : null;
    return { name, valid: Boolean(content) && hash(content) === expected.sha256 && content.length === expected.bytes };
  });
  return { valid: checks.every((check) => check.valid), checks };
}
