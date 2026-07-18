import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const upstream = path.join(root, "upstreams", "bailongma");
const matrix = JSON.parse(fs.readFileSync(path.join(root, "docs", "BAILONGMA-LIVE-PANEL-MATRIX.json"), "utf8"));
const markdown = fs.readFileSync(path.join(root, "docs", "BAILONGMA-LIVE-PANEL-MATRIX.md"), "utf8");

function sourceFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "vendor" ? [] : sourceFiles(absolute);
    return /\.(?:js|html)$/.test(entry.name) ? [absolute] : [];
  });
}

function scanTransportCalls() {
  const counts = new Map();
  const roots = matrix.upstream.sourceRoots.map((sourceRoot) => path.join(upstream, sourceRoot));
  for (const absolute of roots.flatMap(sourceFiles)) {
    const source = path.relative(upstream, absolute).replaceAll("\\", "/");
    for (const line of fs.readFileSync(absolute, "utf8").split(/\r?\n/)) {
      const kinds = [];
      if (/fetch\s*\(/.test(line)) kinds.push("fetch");
      if (/EventSource/.test(line)) kinds.push("sse");
      if (/new\s+WebSocket/.test(line)) kinds.push("websocket");
      if (/\.postMessage\s*\(/.test(line)) kinds.push("postMessage");
      for (const kind of kinds) {
        const key = `${source}\u0000${kind}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  return [...counts].map(([key, count]) => {
    const [source, kind] = key.split("\u0000");
    return { source, kind, count };
  }).sort((left, right) => `${left.source}:${left.kind}`.localeCompare(`${right.source}:${right.kind}`));
}

test("BaiLongma live-panel matrix is pinned and covers every native transport source", () => {
  assert.equal(matrix.schemaVersion, "1.0");
  assert.equal(matrix.upstream.commit, "34d939eabe226c561550079cb810090015b49817");
  const checkedOutCommit = execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(checkedOutCommit, matrix.upstream.commit);

  const expected = [...matrix.sourceCallBaseline].sort((left, right) => `${left.source}:${left.kind}`.localeCompare(`${right.source}:${right.kind}`));
  assert.deepEqual(scanTransportCalls(), expected);

  const assignedSources = new Set(matrix.panels.flatMap((panel) => panel.sources));
  for (const entry of expected) assert.ok(assignedSources.has(entry.source), `Unassigned BaiLongma transport source: ${entry.source}`);
});

test("every BaiLongma panel records a complete five-layer handling decision", () => {
  const ids = new Set();
  const requiredStrings = ["snapshot", "command", "events", "persistence", "revision", "recovery", "ownership", "truthSource"];
  for (const panel of matrix.panels) {
    assert.ok(panel.id && !ids.has(panel.id), `Duplicate or missing panel id: ${panel.id}`);
    ids.add(panel.id);
    assert.ok(matrix.treatments.includes(panel.treatment), `Unknown treatment for ${panel.id}`);
    assert.ok(matrix.statuses.includes(panel.status), `Unknown status for ${panel.id}`);
    assert.ok(Array.isArray(panel.sources) && panel.sources.length > 0, `Missing sources for ${panel.id}`);
    assert.ok(Array.isArray(panel.nativeInterfaces) && panel.nativeInterfaces.length > 0, `Missing interfaces for ${panel.id}`);
    for (const field of requiredStrings) assert.ok(typeof panel[field] === "string" && panel[field].trim(), `Missing ${field} for ${panel.id}`);
    assert.deepEqual(Object.keys(panel.layers).sort(), ["channel", "integration", "runtime", "storage", "ui"]);
    assert.ok(markdown.includes("| `" + panel.id + "`"), `Missing markdown row for ${panel.id}`);
    for (const source of panel.sources) assert.ok(fs.existsSync(path.join(upstream, source)), `Missing upstream source ${source}`);
  }
  for (const required of ["chat", "scene-shell", "memory-graph", "settings", "voice-tts", "social-channels", "hotspots", "docs", "person-card", "media-video"]) {
    assert.ok(ids.has(required), `Missing required panel ${required}`);
  }
});

test("unsupported panels fail visibly and the matrix does not claim Gate U01", () => {
  for (const panel of matrix.panels.filter((item) => item.treatment === "unsupported")) {
    assert.equal(panel.status, "unsupported");
    assert.match(`${panel.snapshot} ${panel.recovery}`, /unavailable/i);
  }
  assert.match(markdown, /Gate U01 remains\s+pending/);
  assert.match(markdown, /cannot forward arbitrary paths/);
  assert.match(markdown, /control plane never reads chat/);
});
