import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createReleaseManifest } from "../release-manifest.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const output = path.resolve(process.argv[2] ?? "dist/release-manifest.json");
const manifest = createReleaseManifest({
  version: required("BAIRUI_RELEASE_VERSION"),
  generatedAt: process.env.BAIRUI_RELEASE_GENERATED_AT,
  contractsVersion: required("BAIRUI_CONTRACTS_VERSION"),
  platformCommit: required("BAIRUI_PLATFORM_COMMIT"),
  agentCommit: required("BAIRUI_AGENT_COMMIT"),
  hermesCommit: required("BAIRUI_HERMES_COMMIT"),
  bailongmaCommit: required("BAIRUI_BAILONGMA_COMMIT"),
  platformImage: required("BAIRUI_PLATFORM_IMAGE"),
  runtimeImage: required("BAIRUI_RUNTIME_IMAGE"),
  hermesImage: required("BAIRUI_HERMES_IMAGE"),
  postgresImage: required("BAIRUI_POSTGRES_IMAGE"),
  caddyImage: required("BAIRUI_CADDY_IMAGE"),
  migration: required("BAIRUI_DATABASE_MIGRATION")
});
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(output);
