const ARRAY_ANCHOR = /^(\s*)createSecondaryPanel\(\),\r?\n\1createConsole\(\),/m;
const CONSOLE_FUNCTION_ANCHOR = "const createConsole = () => `";
const SETTINGS_CALL_ANCHOR = /^(\s*)createSettingsModal\(\),\r?\n/m;
const THEME_ANCHOR = 'root.dataset.theme = "midnight";';
const THEME_SWITCHER_ANCHOR = "const createThemeSwitcher = () => `";
const EXTENSION_HOST_FUNCTION = `const createBairuiExtensionHost = () => \`
<div id="bairui-workspace" class="settings-overlay" data-bairui-extension-host aria-hidden="true" hidden>
  <section class="settings-modal bairui-workspace-modal" role="dialog" aria-modal="true" aria-labelledby="bairui-workspace-title">
    <header class="settings-header">
      <div class="bairui-workspace-heading">
        <span data-bairui-workspace-agent>Agent</span>
        <strong id="bairui-workspace-title">工作区</strong>
      </div>
      <button class="settings-close" data-bairui-workspace-close type="button" aria-label="关闭工作区">×</button>
    </header>
    <div class="settings-body">
      <nav class="settings-nav" data-bairui-workspace-nav aria-label="Agent 工作区"></nav>
      <main class="settings-content bairui-workspace-content" data-bairui-workspace-content tabindex="-1"></main>
    </div>
  </section>
</div>
\`;`;

export function transformBailongmaAppShell(source) {
  if (!source.includes("const createPanelTabs") || !source.includes(CONSOLE_FUNCTION_ANCHOR) || !source.includes(THEME_SWITCHER_ANCHOR) || !ARRAY_ANCHOR.test(source) || !SETTINGS_CALL_ANCHOR.test(source) || !source.includes(THEME_ANCHOR)) {
    throw new Error("BaiLongma shell adapter anchor is missing");
  }
  const withExtensionHost = source.replace(CONSOLE_FUNCTION_ANCHOR, `${EXTENSION_HOST_FUNCTION}\n\n${CONSOLE_FUNCTION_ANCHOR}`);
  return withExtensionHost
    .replace(ARRAY_ANCHOR, (_, indent) => `${indent}createSecondaryPanel(),\n${indent}createThemeSwitcher(),\n${indent}createPanelTabs(),\n${indent}createBairuiExtensionHost(),\n${indent}createConsole(),`)
    .replace(SETTINGS_CALL_ANCHOR, "")
    .replace(THEME_ANCHOR, `root.dataset.bairuiShell = "true";\n  ${THEME_ANCHOR}`);
}
