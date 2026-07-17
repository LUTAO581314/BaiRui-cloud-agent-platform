import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { currentVersion, validateReleaseManifest } from "../release-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const target = path.resolve(process.argv[2] ?? "dist/release-manifest.json");
const manifest = JSON.parse(fs.readFileSync(target, "utf8"));
validateReleaseManifest(manifest, { expectedVersion: currentVersion(root) });
console.log(JSON.stringify({ valid: true, version: manifest.version, manifest: target }));
