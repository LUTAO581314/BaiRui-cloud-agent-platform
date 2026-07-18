import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { applyBailongmaPatchQueue } from "./patch-queue.mjs";

const PREFIX = "/bailongma-ui/";
const BUILD_INTEGRITY_FILES = Object.freeze([
  "brain-ui.html",
  "src/ui/brain-ui/app.js",
  "src/ui/brain-ui/app-shell.js",
  "src/ui/brain-ui/chat.js",
  "src/ui/brain-ui/voice-wake.js"
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function entryHtml(source) {
  return source
    .replace(/<title>[\s\S]*?<\/title>/i, "<title>bairui-agent | Cognitive Surface</title>")
    .replace("</head>", `<link rel="icon" type="image/png" href="/assets/bairui-agent-icon.png">
<link rel="stylesheet" data-bairui-overlay href="/assets/bairui-bailongma.css">
</head>`)
    .replace(/\s*<link rel="preconnect"[^>]*>/gi, "")
    .replace(/\s*<link href="https:\/\/fonts\.googleapis\.com[^>]*>/gi, "")
    .replace("./src/ui/brain-ui/styles.css", `${PREFIX}src/ui/brain-ui/styles.css`)
    .replace("/vendor/d3/d3.min.js", `${PREFIX}vendor/d3/d3.min.js`)
    .replace('<script type="module" src="./src/ui/brain-ui/app.js"></script>', `<script src="/assets/bairui-bailongma.js" defer></script>
<script src="/assets/bairui-workspace.js" defer></script>
<script src="/assets/bairui-workspace-conversations.js" defer></script>
<script src="/assets/bairui-workspace-agents.js" defer></script>
<script src="/assets/bairui-workspace-channels.js" defer></script>
<script src="/assets/bairui-workspace-hotspots.js" defer></script>
<script src="/assets/bairui-workspace-usage.js" defer></script>
<script src="/assets/bairui-workspace-memory.js" defer></script>
<script src="/assets/bairui-workspace-skills.js" defer></script>
<script src="/assets/bairui-workspace-runs.js" defer></script>
<script src="/assets/bairui-workspace-jobs.js" defer></script>
<script src="/assets/bairui-workspace-hermes.js" defer></script>
<script src="/assets/bairui-workspace-settings.js" defer></script>
<script type="module" src="${PREFIX}src/ui/brain-ui/app.js"></script>`);
}

function validateRoots(sourceRoot, outputRoot) {
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) throw new Error(`BaiLongma source root is unavailable: ${sourceRoot}`);
  if (!["bailongma-ui", "bailongma-ui-build"].some((name) => path.basename(outputRoot).startsWith(name))) throw new Error("BaiLongma build output must use a dedicated bailongma-ui directory");
  const relative = path.relative(sourceRoot, outputRoot);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) throw new Error("BaiLongma build output must be outside the upstream source");
  if (path.parse(outputRoot).root === outputRoot) throw new Error("BaiLongma build output cannot be a filesystem root");
}

export function buildBailongmaUi(options) {
  const sourceRoot = path.resolve(options.sourceRoot);
  const outputRoot = path.resolve(options.outputRoot);
  validateRoots(sourceRoot, outputRoot);
  const packageMetadata = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
  const staging = `${outputRoot}.tmp-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    for (const file of ["LICENSE", "package.json"]) fs.copyFileSync(path.join(sourceRoot, file), path.join(staging, file));
    fs.cpSync(path.join(sourceRoot, "src", "ui"), path.join(staging, "src", "ui"), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, "brain-ui.html"), path.join(staging, "brain-ui.html"));
    const patchQueue = applyBailongmaPatchQueue({
      sourceRoot,
      stagingRoot: staging,
      entryHtml
    });

    const files = Object.fromEntries(BUILD_INTEGRITY_FILES.map((file) => [file, sha256(fs.readFileSync(path.join(staging, file)))]));
    fs.writeFileSync(path.join(staging, ".bairui-build.json"), `${JSON.stringify({
      schemaVersion: "1.0",
      source: "xiaoyuanda666-ship-it/BaiLongma",
      sourceVersion: packageMetadata.version,
      sourceCommit: patchQueue.sourceCommit,
      patchManifestSha256: patchQueue.manifestSha256,
      appliedPatches: patchQueue.appliedPatches,
      files
    }, null, 2)}\n`);
    fs.rmSync(outputRoot, { recursive: true, force: true });
    fs.renameSync(staging, outputRoot);
    return { outputRoot, sourceVersion: packageMetadata.version, files };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
