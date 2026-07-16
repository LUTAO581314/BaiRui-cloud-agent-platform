import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { createBailongmaUi } from "../packages/bailongma-ui/index.mjs";
import { toBailongmaHotspots, toBailongmaMemories } from "../packages/bailongma-ui/compatibility.mjs";
import { transformBailongmaBrainApp } from "../packages/bailongma-ui/brain-app-transform.mjs";
import { transformBailongmaAppShell } from "../packages/bailongma-ui/app-shell-transform.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "upstreams", "bailongma");

test("serves the upstream BaiLongma Brain UI with a Bairui overlay", () => {
  const ui = createBailongmaUi({ root });
  const html = ui.render();
  assert.match(html, /bairui-agent · Cognitive Surface/);
  assert.match(html, /\/bailongma-ui\/src\/ui\/brain-ui\/app\.js/);
  assert.match(html, /\/assets\/bairui-bailongma\.js/);
  assert.match(html, /\/assets\/bairui-workspace\.js/);
  assert.match(html, /<head>[\s\S]*data-bairui-overlay[\s\S]*<\/head>/);
  assert.doesNotMatch(html, /<body>\s*<link rel="stylesheet"/);
  assert.match(ui.readAsset("/bailongma-ui/LICENSE").body.toString(), /MIT License/);
  assert.match(ui.readAsset("/bailongma-ui/src/ui/brain-ui/app.js").body.toString(), /addProjectedMemoryLinks/);
  assert.match(ui.readAsset("/bailongma-ui/src/ui/brain-ui/app-shell.js").body.toString(), /createSecondaryPanel\(\),\s+createPanelTabs\(\),\s+createConsole\(\)/);
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
  assert.match(adapter, /operationalFailure/);
  assert.match(adapter, /bairui-operational-blocker/);
  assert.match(adapter, /quota_exhausted/);
  assert.match(adapter, /runtime_offline/);
  assert.match(adapter, /\/api\/user\/bootstrap/);
});

test("Bairui workspace exposes complete user views through Agent-scoped APIs", () => {
  const workspace = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "bairui-workspace.js"), "utf8");
  for (const view of ["conversations", "agents", "memory", "skills", "channels", "hotspots", "runs", "jobs", "usage", "settings"]) assert.match(workspace, new RegExp(`render${view[0].toUpperCase()}${view.slice(1)}`));
  for (const route of ["/memory-notes", "/memory-sync", "/skills", "/channels", "/hotspots", "/runs", "/jobs", "/usage"]) assert.match(workspace, new RegExp(route.replace("/", "\\/")));
  assert.match(workspace, /Hermes MEMORY\.md/);
  assert.match(workspace, /Hermes USER\.md/);
  assert.match(workspace, /Obsidian 主记忆库/);
});

test("restores BaiLongma's native independent panel controls", () => {
  const source = fs.readFileSync(path.join(root, "src", "ui", "brain-ui", "app-shell.js"), "utf8");
  const transformed = transformBailongmaAppShell(source);
  assert.match(transformed, /createPanelTabs\(\)/);
  assert.throws(() => transformBailongmaAppShell("export const unrelated = true;"), /anchor/);
});

test("keeps the BaiRui toolbar above the interactive BaiLongma graph", () => {
  const overlay = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "bairui-bailongma.css"), "utf8");
  const adapter = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "bairui-bailongma.js"), "utf8");
  assert.match(overlay, /\.bairui-platform-tools\s*\{[\s\S]*z-index:\s*2147483000\s*!important/);
  assert.match(overlay, /\.bairui-platform-tools\s*>\s*\*[\s\S]*pointer-events:\s*auto/);
  assert.match(adapter, /document\.body\.appendChild\(tools\)/);
  assert.match(adapter, /zIndex:\s*"2147483000"/);
});

test("adapts BaiLongma panels into persistent desktop controls and mobile drawers", () => {
  const overlay = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "bairui-bailongma.css"), "utf8");
  const adapter = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "bairui-bailongma.js"), "utf8");
  for (const evidence of [".panel-tab", ".bairui-panel-scrim", "body:not(.l1-collapsed)", "body:not(.l2-collapsed)"]) assert.match(overlay, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const evidence of ["mountPanelControls", "bailongma-panel-l1-collapsed", "bailongma-panel-l2-collapsed", "aria-expanded"]) assert.match(adapter, new RegExp(evidence));
});

test("imports SillyTavern character cards through a confirmed BaiRui adapter flow", () => {
  const overlay = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "bairui-bailongma.css"), "utf8");
  const adapter = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "bairui-bailongma.js"), "utf8");
  for (const evidence of ["previewOnly", "confirmUntrustedPrompts", "character-card", "import-character-card", "SillyTavern"]) assert.match(adapter, new RegExp(evidence));
  assert.match(overlay, /\.bairui-card-dialog/);
});

test("adapts the BaiLongma console into a persistent Hermes chat column", () => {
  const overlay = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "bairui-bailongma.css"), "utf8");
  const adapter = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "bairui-bailongma.js"), "utf8");
  for (const evidence of [".bairui-chat-header", "#chat-history.open", "#chat-messages .msg", ".bairui-attach-button", ".bairui-streaming #send-btn::before"]) assert.match(overlay, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const evidence of ["mountHermesChatSurface", "applyViewportLayout", "document.documentElement).zoom", "height / zoom", "ClipboardEvent", "DataTransfer", "attach-image", "Hermes ·"]) assert.match(adapter, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(adapter, /bairui:chat-layout/);
  const workspace = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "bairui-workspace.js"), "utf8");
  assert.match(workspace, /dispatchEvent\(new CustomEvent\("bairui:chat-layout"\)\)/);
});

test("maps Obsidian notes to BaiLongma memory shapes", () => {
  const memories = toBailongmaMemories([
    { id: "n1", agentId: "agent_a", title: "Decision", markdown: "# Decision", memoryKind: "project", importance: 5, wikilinks: ["Architecture"], frontmatter: { tags: ["architecture"] }, createdAt: "2026-01-01", updatedAt: "2026-01-02" },
    { id: "n2", agentId: "agent_a", title: "Architecture", markdown: "# Architecture", memoryKind: "knowledge", importance: 4, wikilinks: [], frontmatter: { tags: [] }, createdAt: "2026-01-01", updatedAt: "2026-01-02" }
  ], { id: "agent_a", name: "Agent A" });
  assert.equal(memories[0].event_type, "self");
  assert.ok(memories[0].entities.includes("agent:jarvis"));
  assert.equal(memories[1].event_type, "project");
  assert.deepEqual(memories[1].links, [{ target_id: "n2", relation: "related_to" }]);
  assert.equal(memories[1].parent_id, "agent:agent_a");
});

test("transforms BaiLongma graph code to prefer projected semantic edges", () => {
  const source = fs.readFileSync(path.join(root, "src", "ui", "brain-ui", "app.js"), "utf8");
  const transformed = transformBailongmaBrainApp(source);
  assert.match(transformed, /_kind: "semantic"/);
  assert.ok((transformed.match(/addProjectedMemoryLinks\(linkSet\)/g) || []).length >= 2);
  assert.throws(() => transformBailongmaBrainApp("function unrelated() {}"), /anchor/);
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
