const ARRAY_ANCHOR = "    createSecondaryPanel(),\n    createConsole(),";

export function transformBailongmaAppShell(source) {
  if (!source.includes("const createPanelTabs") || !source.includes(ARRAY_ANCHOR)) throw new Error("BaiLongma panel tab adapter anchor is missing");
  return source.replace(ARRAY_ANCHOR, "    createSecondaryPanel(),\n    createPanelTabs(),\n    createConsole(),");
}
