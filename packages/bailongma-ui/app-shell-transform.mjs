const ARRAY_ANCHOR = /^(\s*)createSecondaryPanel\(\),\r?\n\1createConsole\(\),/m;

export function transformBailongmaAppShell(source) {
  if (!source.includes("const createPanelTabs") || !ARRAY_ANCHOR.test(source)) throw new Error("BaiLongma panel tab adapter anchor is missing");
  return source.replace(ARRAY_ANCHOR, (_, indent) => `${indent}createSecondaryPanel(),\n${indent}createPanelTabs(),\n${indent}createConsole(),`);
}
