import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { createBailongmaUi } from "../packages/bailongma-ui/index.mjs";
import { toBailongmaHotspots, toBailongmaMemories } from "../packages/bailongma-ui/compatibility.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "upstreams", "bailongma");

test("serves the upstream BaiLongma Brain UI with a Bairui overlay", () => {
  const ui = createBailongmaUi({ root });
  const html = ui.render();
  assert.match(html, /bairui-agent · Cognitive Surface/);
  assert.match(html, /\/bailongma-ui\/src\/ui\/brain-ui\/app\.js/);
  assert.match(html, /\/assets\/bairui-bailongma\.js/);
  assert.match(html, /\/assets\/bairui-workspace\.js/);
  assert.match(ui.readAsset("/bailongma-ui/LICENSE").body.toString(), /MIT License/);
  assert.equal(ui.readAsset("/bailongma-ui/../../package.json"), null);
});

test("browser adapter consumes native Hermes session SSE and does not use the legacy event hub", () => {
  const adapter = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "bairui-bailongma.js"), "utf8");
  assert.match(adapter, /chat\/stream/);
  assert.match(adapter, /assistant\.delta/);
  assert.match(adapter, /assistant\.completed/);
  assert.doesNotMatch(adapter, /createBailongmaEventHub/);
  assert.match(adapter, /AbortController/);
  assert.match(adapter, /attachments/);
});

test("Bairui workspace exposes complete user views through Agent-scoped APIs", () => {
  const workspace = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "bairui-workspace.js"), "utf8");
  for (const view of ["conversations", "agents", "memory", "skills", "channels", "hotspots", "runs", "jobs", "usage", "settings"]) assert.match(workspace, new RegExp(`render${view[0].toUpperCase()}${view.slice(1)}`));
  for (const route of ["/memory-notes", "/skills", "/channels", "/hotspots", "/runs", "/jobs", "/usage"]) assert.match(workspace, new RegExp(route.replace("/", "\\/")));
});

test("maps Obsidian notes to BaiLongma memory shapes", () => {
  const memories = toBailongmaMemories([{ id: "n1", title: "Decision", markdown: "# Decision", frontmatter: { tags: ["architecture"] }, createdAt: "2026-01-01", updatedAt: "2026-01-02" }]);
  assert.equal(memories[0].event_type, "knowledge");
  assert.equal(memories[0].detail, "# Decision");
});

test("maps real hotspot sources into the four upstream display slots", () => {
  const result = toBailongmaHotspots({ run: { status: "completed", completedAt: "2026-01-01" }, items: [
    { sourceId: "weibo", sourceName: "微博", rank: 1, title: "one" },
    { sourceId: "zhihu", sourceName: "知乎", rank: 1, title: "two" }
  ] });
  assert.equal(result.platforms.weibo[0].text, "one");
  assert.ok(Object.values(result.platforms).flat().some((item) => item.text === "two"));
  assert.equal(result.stale, false);
});
