const RANDOM_LINK_CALL = "  addRandomVisualLinks(linkSet);";
const FUNCTION_ANCHOR = "function addRandomVisualLinks(linkSet) {";

const semanticLinkFunction = `function addProjectedMemoryLinks(linkSet) {
  const nodeById = new Map(nodeData.map(node => [String(node._nid), node]));
  const childCounts = new Map(nodeData.map(node => [String(node._nid), 0]));
  let semanticCount = 0;
  const add = (sourceId, targetId, relation) => {
    sourceId = String(sourceId || "");
    targetId = String(targetId || "");
    if (!sourceId || !targetId || sourceId === targetId || !nodeById.has(sourceId) || !nodeById.has(targetId)) return;
    const pair = [sourceId, targetId].sort().join("<=>");
    const lid = \`semantic:\${pair}\`;
    if (linkSet.has(lid)) return;
    linkSet.add(lid);
    linkData.push({ source: sourceId, target: targetId, _lid: lid, _kind: "semantic", _relation: relation || "related_to" });
    childCounts.set(targetId, (childCounts.get(targetId) || 0) + 1);
    semanticCount += 1;
  };
  nodeData.forEach(node => {
    if (node.parent_id != null) add(node._nid, node.parent_id, "child_of");
    parseLinks(node.links).forEach(link => add(node._nid, link?.target_id || link?.targetId, link?.relation));
  });
  if (!semanticCount) addRandomVisualLinks(linkSet);
  else addSupplementalVisualLinks(linkSet, childCounts);
}`;

export function transformBailongmaBrainApp(source) {
  if (!source.includes(FUNCTION_ANCHOR)) throw new Error("BaiLongma graph adapter anchor is missing");
  const calls = source.split(RANDOM_LINK_CALL).length - 1;
  if (calls < 2) throw new Error("BaiLongma graph load anchors are incomplete");
  return source
    .replaceAll(RANDOM_LINK_CALL, "  addProjectedMemoryLinks(linkSet);")
    .replace(FUNCTION_ANCHOR, `${semanticLinkFunction}\n\n${FUNCTION_ANCHOR}`);
}
