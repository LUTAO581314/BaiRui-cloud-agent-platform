import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { transformBailongmaBrainApp } from "./brain-app-transform.mjs";
import { transformBailongmaAppShell } from "./app-shell-transform.mjs";
import { transformBailongmaHostApp, transformBailongmaHostChat, transformBailongmaHostVoiceWake } from "./host-adapter-transform.mjs";

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const MANIFEST_RELATIVE_PATH = "patches/bailongma/manifest.yaml";
const HANDLERS = Object.freeze({
  transformBailongmaBrainApp,
  transformBailongmaAppShell,
  transformBailongmaHostApp,
  transformBailongmaHostChat,
  transformBailongmaHostVoiceWake
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readSourceCommit(sourceRoot) {
  try {
    return execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch (error) {
    throw new Error(`Unable to resolve BaiLongma source commit: ${error.message}`);
  }
}

export function readBailongmaPatchManifest(manifestPath = path.join(REPOSITORY_ROOT, MANIFEST_RELATIVE_PATH)) {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const manifest = parseYaml(raw);
  if (manifest?.schemaVersion !== "1.0") throw new Error("BaiLongma patch manifest schema is unsupported");
  if (manifest.upstream?.repository !== "xiaoyuanda666-ship-it/BaiLongma") throw new Error("BaiLongma patch manifest source is invalid");
  if (!/^[a-f0-9]{40}$/.test(manifest.upstream?.pinnedCommit || "")) throw new Error("BaiLongma patch manifest must pin a commit");
  if (!Array.isArray(manifest.patches) || manifest.patches.length === 0) throw new Error("BaiLongma patch queue is empty");

  const ids = new Set();
  for (const patch of manifest.patches) {
    if (!patch?.id || ids.has(patch.id)) throw new Error(`BaiLongma patch id is missing or duplicated: ${patch?.id || "unknown"}`);
    ids.add(patch.id);
    if (!patch.target || !patch.handler || !Array.isArray(patch.anchors) || patch.anchors.length === 0) throw new Error(`BaiLongma patch is incomplete: ${patch.id}`);
    if (!Array.isArray(patch.tests) || patch.tests.length === 0 || !patch.removalCondition) throw new Error(`BaiLongma patch evidence is incomplete: ${patch.id}`);
  }
  return Object.freeze({ raw, manifest, manifestSha256: sha256(raw), manifestPath });
}

function assertAnchors(source, patch) {
  for (const anchor of patch.anchors) {
    if (!source.includes(anchor)) throw new Error(`BaiLongma patch ${patch.id} anchor is missing: ${anchor}`);
  }
}

export function applyBailongmaPatchQueue({ sourceRoot, stagingRoot, entryHtml, sourceCommit = readSourceCommit(sourceRoot), manifestPath }) {
  const { raw, manifest, manifestSha256 } = readBailongmaPatchManifest(manifestPath);
  if (sourceCommit !== manifest.upstream.pinnedCommit) {
    throw new Error(`BaiLongma source commit ${sourceCommit} does not match pinned patch queue ${manifest.upstream.pinnedCommit}`);
  }

  const handlers = { ...HANDLERS, entryHtml };
  const appliedPatches = [];
  for (const patch of manifest.patches) {
    const handler = handlers[patch.handler];
    if (typeof handler !== "function") throw new Error(`BaiLongma patch handler is not registered: ${patch.handler}`);
    const targetPath = path.resolve(stagingRoot, patch.target);
    const relativeTarget = path.relative(stagingRoot, targetPath);
    if (!relativeTarget || relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) throw new Error(`BaiLongma patch target escapes build root: ${patch.id}`);
    if (!fs.existsSync(targetPath)) throw new Error(`BaiLongma patch target is missing: ${patch.target}`);
    const source = fs.readFileSync(targetPath, "utf8");
    assertAnchors(source, patch);
    const output = handler(source);
    if (typeof output !== "string" || output === source) throw new Error(`BaiLongma patch did not change its target: ${patch.id}`);
    fs.writeFileSync(targetPath, output);
    appliedPatches.push(Object.freeze({ id: patch.id, kind: patch.kind, target: patch.target, handler: patch.handler, sourceCommit }));
  }
  return Object.freeze({ sourceCommit, manifestSha256, manifestRaw: raw, appliedPatches });
}

export const BAILONGMA_PATCH_MANIFEST = MANIFEST_RELATIVE_PATH;
