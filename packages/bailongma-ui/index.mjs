import fs from "node:fs";
import path from "node:path";
import { transformBailongmaBrainApp } from "./brain-app-transform.mjs";

const PREFIX = "/bailongma-ui/";
const ALLOWED_UI_ROOTS = ["src/ui/brain-ui/", "src/ui/scene-shell/"];
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

function transformEntryHtml(source) {
  return source
    .replace(/<title>[\s\S]*?<\/title>/i, "<title>bairui-agent · Cognitive Surface</title>")
    .replace(
      "</head>",
      `<link rel="icon" type="image/png" href="/assets/bairui-agent-icon.png">
<link rel="stylesheet" data-bairui-overlay href="/assets/bairui-bailongma.css">
</head>`
    )
    .replace(/\s*<link rel="preconnect"[^>]*>/gi, "")
    .replace(/\s*<link href="https:\/\/fonts\.googleapis\.com[^>]*>/gi, "")
    .replace("./src/ui/brain-ui/styles.css", `${PREFIX}src/ui/brain-ui/styles.css`)
    .replace("/vendor/d3/d3.min.js", `${PREFIX}vendor/d3/d3.min.js`)
    .replace(
      '<script type="module" src="./src/ui/brain-ui/app.js"></script>',
      `<script src="/assets/bairui-bailongma.js" defer></script>
<script src="/assets/bairui-workspace.js" defer></script>
<script type="module" src="${PREFIX}src/ui/brain-ui/app.js"></script>`
    );
}

export function createBailongmaUi(options) {
  const root = path.resolve(options.root);
  const htmlPath = path.join(root, "brain-ui.html");
  const licensePath = path.join(root, "LICENSE");
  const packagePath = path.join(root, "package.json");
  for (const required of [htmlPath, licensePath, packagePath]) {
    if (!fs.existsSync(required)) throw new Error(`BaiLongma UI source is incomplete: ${required}`);
  }

  const sourceHtml = fs.readFileSync(htmlPath, "utf8");
  const packageMetadata = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const entryHtml = transformEntryHtml(sourceHtml);

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
      if (relative === "src/ui/brain-ui/app.js") {
        return { body: Buffer.from(transformBailongmaBrainApp(fs.readFileSync(candidate, "utf8"))), contentType: CONTENT_TYPES[".js"] };
      }
      return {
        body: fs.readFileSync(candidate),
        contentType: CONTENT_TYPES[path.extname(candidate).toLowerCase()] ?? "application/octet-stream"
      };
    }
  });
}
