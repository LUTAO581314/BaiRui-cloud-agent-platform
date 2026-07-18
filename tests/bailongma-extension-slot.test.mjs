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
