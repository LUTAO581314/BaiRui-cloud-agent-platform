import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PREFIX = "/bailongma-ui/";
const ALLOWED_UI_ROOTS = ["src/ui/brain-ui/", "src/ui/scene-shell/"];
const BUILD_INTEGRITY_FILES = Object.freeze([
  "brain-ui.html",
  "src/ui/brain-ui/app.js",
  "src/ui/brain-ui/app-shell.js",
  "src/ui/brain-ui/chat.js",
  "src/ui/brain-ui/voice-wake.js"
]);
const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
});

function withinRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createBailongmaUi(options) {
  const root = path.resolve(options.root);
  const htmlPath = path.join(root, "brain-ui.html");
  const licensePath = path.join(root, "LICENSE");
  const packagePath = path.join(root, "package.json");
  const manifestPath = path.join(root, ".bairui-build.json");
  for (const required of [htmlPath, licensePath, packagePath, manifestPath]) {
    if (!fs.existsSync(required)) throw new Error(`BaiLongma UI source is incomplete: ${required}`);
  }

  const packageMetadata = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const buildManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (buildManifest.schemaVersion !== "1.0" || buildManifest.source !== "xiaoyuanda666-ship-it/BaiLongma" || buildManifest.sourceVersion !== packageMetadata.version || !/^[a-f0-9]{40}$/.test(buildManifest.sourceCommit || "") || !/^[a-f0-9]{64}$/.test(buildManifest.patchManifestSha256 || "") || !Array.isArray(buildManifest.appliedPatches) || buildManifest.appliedPatches.length === 0) {
    throw new Error("BaiLongma UI build manifest does not match its source metadata");
  }
  for (const relative of BUILD_INTEGRITY_FILES) {
    const expected = buildManifest.files?.[relative];
    const candidate = path.resolve(root, relative);
    if (!/^[a-f0-9]{64}$/.test(expected || "") || !withinRoot(candidate, root) || !fs.existsSync(candidate) || sha256(fs.readFileSync(candidate)) !== expected) {
      throw new Error(`BaiLongma UI build integrity check failed: ${relative}`);
    }
  }
  const entryHtml = fs.readFileSync(htmlPath, "utf8");

  return Object.freeze({
    name: packageMetadata.name,
    version: packageMetadata.version,
    render() {
      return entryHtml;
    },
    readAsset(pathname) {
      if (pathname === `${PREFIX}LICENSE`) {
        return { body: fs.readFileSync(licensePath), contentType: "text/plain; charset=utf-8" };
      }
      if (pathname === `${PREFIX}vendor/d3/d3.min.js`) {
        const d3Path = path.join(root, "src", "ui", "brain-ui", "vendor", "d3", "d3.v7.min.js");
        return fs.existsSync(d3Path) ? { body: fs.readFileSync(d3Path), contentType: CONTENT_TYPES[".js"] } : null;
      }
      if (!pathname.startsWith(PREFIX)) return null;

      let relative;
      try {
        relative = decodeURIComponent(pathname.slice(PREFIX.length)).replaceAll("\\", "/");
      } catch {
        return null;
      }
      if (!ALLOWED_UI_ROOTS.some((allowed) => relative.startsWith(allowed))) return null;
      const candidate = path.resolve(root, relative);
      if (!withinRoot(candidate, root) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return null;
      return {
        body: fs.readFileSync(candidate),
        contentType: CONTENT_TYPES[path.extname(candidate).toLowerCase()] ?? "application/octet-stream"
      };
    }
  });
}
