import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { transformBailongmaAppShell } from "../packages/bailongma-ui/app-shell-transform.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("BaiRui workspace is exposed through a native BaiLongma extension slot", () => {
  const source = fs.readFileSync(path.join(root, "upstreams", "bailongma", "src", "ui", "brain-ui", "app-shell.js"), "utf8");
  const transformed = transformBailongmaAppShell(source);
  assert.match(transformed, /createBairuiExtensionHost\(\)/);
  assert.match(transformed, /data-bairui-extension-host/);
  assert.match(transformed, /createPanelTabs\(\),\s+createBairuiExtensionHost\(\),\s+createConsole\(\)/);
});

test("BaiRui workspace consumes the native slot and keeps a compatibility fallback", () => {
  const workspace = fs.readFileSync(path.join(root, "apps", "web", "public", "bairui-workspace.js"), "utf8");
  assert.match(workspace, /document\.querySelector\("\[data-bairui-extension-host\]"\)/);
  assert.match(workspace, /extensionHost\.appendChild\(root\)/);
  assert.doesNotMatch(workspace, /document\.body\.appendChild\(root\)/);
});

test("BaiRui workspace views are registered through an extension registry", () => {
  const workspace = fs.readFileSync(path.join(root, "apps", "web", "public", "bairui-workspace.js"), "utf8");
  for (const evidence of ["BairuiWorkspaceRegistry", "workspaceRegistry.register", "workspaceRegistry.get(view)", "bairui:workspace-registry-changed", "registerBuiltInViews"]) {
    assert.match(workspace, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("the usage view is a separately served workspace extension", () => {
  const usage = fs.readFileSync(path.join(root, "apps", "web", "public", "bairui-workspace-usage.js"), "utf8");
  assert.match(usage, /window\.BairuiWorkspaceRegistry/);
  assert.match(usage, /id: "usage"/);
  assert.match(usage, /agentApi\("\/usage"\)/);
  assert.doesNotMatch(usage, /window\.fetch\s*=|window\.EventSource\s*=/);
});

test("the conversations view is a separately served workspace extension", () => {
  const conversations = fs.readFileSync(path.join(root, "apps", "web", "public", "bairui-workspace-conversations.js"), "utf8");
  assert.match(conversations, /window\.BairuiWorkspaceRegistry/);
  assert.match(conversations, /id: "conversations"/);
  assert.match(conversations, /bridge\.listSessions\(\)/);
  assert.match(conversations, /bridge\.createSession/);
  assert.match(conversations, /agentApi\(`\/sessions\//);
  assert.doesNotMatch(conversations, /window\.fetch\s*=|window\.EventSource\s*=/);
  const workspace = fs.readFileSync(path.join(root, "apps", "web", "public", "bairui-workspace.js"), "utf8");
  assert.doesNotMatch(workspace, /function renderConversations|conversations:\s*\[1,/);
});

test("the Agent management view is a separately served owner-scoped workspace extension", () => {
  const agents = fs.readFileSync(path.join(root, "apps", "web", "public", "bairui-workspace-agents.js"), "utf8");
  for (const evidence of ["window.BairuiWorkspaceRegistry", "id: \"agents\"", "bridge.request(\"/api/user/agents\")", "bridge.createAgentDialog", "bridge.initializeAgent", "agentApi(\"/lifecycle\")"]) {
    assert.match(agents, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(agents, /window\.fetch\s*=|window\.EventSource\s*=/);
  const workspace = fs.readFileSync(path.join(root, "apps", "web", "public", "bairui-workspace.js"), "utf8");
  assert.doesNotMatch(workspace, /function renderAgents|agents:\s*\[2,/);
});

test("channel and hotspot views are separate Agent-scoped workspace extensions", () => {
  const channels = fs.readFileSync(path.join(root, "apps", "web", "public", "bairui-workspace-channels.js"), "utf8");
  for (const evidence of ["window.BairuiWorkspaceRegistry", "id: \"channels\"", "agentApi(\"/channels\")", "credentialMasked", "data-unbind"]) {
    assert.match(channels, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(channels, /window\.fetch\s*=|window\.EventSource\s*=/);
  const hotspots = fs.readFileSync(path.join(root, "apps", "web", "public", "bairui-workspace-hotspots.js"), "utf8");
  for (const evidence of ["window.BairuiWorkspaceRegistry", "id: \"hotspots\"", "agentApi(\"/hotspots\")", "bridge.prefillChat", "closeWorkspace"]) {
    assert.match(hotspots, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(hotspots, /window\.fetch\s*=|window\.EventSource\s*=/);
  const workspace = fs.readFileSync(path.join(root, "apps", "web", "public", "bairui-workspace.js"), "utf8");
  assert.doesNotMatch(workspace, /function renderChannels|channels:\s*\[5,|function renderHotspots|hotspots:\s*\[6,/);
});

test("the memory view keeps Obsidian and Hermes synchronization in a separate extension", () => {
  const memory = fs.readFileSync(path.join(root, "apps", "web", "public", "bairui-workspace-memory.js"), "utf8");
  for (const evidence of ["window.BairuiWorkspaceRegistry", "id: \"memory\"", "agentApi(\"/memory-notes\")", "agentApi(\"/memory-sync\")", "Obsidian 主记忆库", "hermesTarget"]) {
    assert.match(memory, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(memory, /window\.fetch\s*=|window\.EventSource\s*=/);
  const workspace = fs.readFileSync(path.join(root, "apps", "web", "public", "bairui-workspace.js"), "utf8");
  assert.match(workspace, /bairui:workspace-refresh/);
});

test("the skills view stays Agent-scoped while using Hermes discovery and preferences", () => {
  const skills = fs.readFileSync(path.join(root, "apps", "web", "public", "bairui-workspace-skills.js"), "utf8");
  for (const evidence of ["window.BairuiWorkspaceRegistry", "id: \"skills\"", "agentApi(\"/skills\")", "agentApi(\"/runtime/discovery\")", "agentApi(\"/authorizations\")", "data-skill"]) {
    assert.match(skills, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(skills, /window\.fetch\s*=|window\.EventSource\s*=/);
});
