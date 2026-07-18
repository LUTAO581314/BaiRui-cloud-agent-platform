const ARRAY_ANCHOR = /^(\s*)createSecondaryPanel\(\),\r?\n\1createConsole\(\),/m;
const CONSOLE_FUNCTION_ANCHOR = "const createConsole = () => `";
const EXTENSION_HOST_FUNCTION = `const createBairuiExtensionHost = () => \`
<section id="bairui-extension-host" data-bairui-extension-host aria-label="BaiRui extensions"></section>
\`;`;

export function transformBailongmaAppShell(source) {
  if (!source.includes("const createPanelTabs") || !source.includes(CONSOLE_FUNCTION_ANCHOR) || !ARRAY_ANCHOR.test(source)) throw new Error("BaiLongma panel tab adapter anchor is missing");
  const withExtensionHost = source.replace(CONSOLE_FUNCTION_ANCHOR, `${EXTENSION_HOST_FUNCTION}\n\n${CONSOLE_FUNCTION_ANCHOR}`);
  return withExtensionHost.replace(ARRAY_ANCHOR, (_, indent) => `${indent}createSecondaryPanel(),\n${indent}createPanelTabs(),\n${indent}createBairuiExtensionHost(),\n${indent}createConsole(),`);
}
