import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceRoot = path.join(root, "upstreams", "bailongma");
const outputRoot = path.join(root, "test-results", "bailongma-design-baseline");
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff" };
const viewports = [
  ["desktop", 1440, 1000],
  ["wide", 1920, 1080],
  ["tablet", 1024, 768],
  ["mobile", 390, 844]
];

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?", 1)[0]);
  const relative = decoded === "/" ? "brain-ui.html" : decoded.replace(/^\/+/, "");
  const candidate = path.resolve(sourceRoot, relative);
  if (candidate !== sourceRoot && !candidate.startsWith(`${sourceRoot}${path.sep}`)) return null;
  return candidate;
}

const server = http.createServer((request, response) => {
  const file = safePath(request.url ?? "/");
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": mime[path.extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(response);
});

fs.mkdirSync(outputRoot, { recursive: true });
server.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: name === "mobile" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${baseUrl}/brain-ui.html`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outputRoot, `${name}-${width}x${height}.png`), fullPage: true });
    const evidence = await page.evaluate(() => ({
      title: document.title,
      graph: Boolean(document.querySelector("#graph")),
      leftPanel: Boolean(document.querySelector("#panel-l1")),
      rightPanel: Boolean(document.querySelector("#panel-l2")),
      chat: Boolean(document.querySelector("#chat-area")),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth
    }));
    assert.equal(evidence.graph, true, `${name}: missing upstream graph`);
    assert.equal(evidence.leftPanel, true, `${name}: missing upstream left panel`);
    assert.equal(evidence.rightPanel, true, `${name}: missing upstream right panel`);
    assert.ok(evidence.documentWidth <= evidence.viewportWidth + 1, `${name}: upstream horizontal overflow`);
    fs.writeFileSync(path.join(outputRoot, `${name}-${width}x${height}.json`), `${JSON.stringify({ name, width, height, evidence, pageErrors: errors }, null, 2)}\n`, "utf8");
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

process.stdout.write(`BaiLongma source design baseline written to ${outputRoot}\n`);
