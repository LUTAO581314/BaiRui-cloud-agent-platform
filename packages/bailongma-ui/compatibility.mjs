const HOTSPOT_SLOTS = ["douyin", "xiaohongshu", "wechat", "weibo"];

export function toBailongmaMemories(notes, agent = {}) {
  const byTitle = new Map(notes.map((note) => [String(note.title).trim().toLocaleLowerCase(), note.id]));
  const rootId = `agent:${agent.id || "bairui"}`;
  const root = {
    id: rootId, mem_id: rootId, event_type: "self", type: "self",
    title: agent.name || "bairui-agent", content: agent.name || "bairui-agent",
    detail: "Hermes Runtime memory projection", salience: 5, importance: 1,
    entities: ["agent:jarvis", "agent:bairui"], concepts: ["hermes", "obsidian"],
    tags: ["runtime:hermes", "memory:obsidian"], links: notes.slice(0, 100).map((note) => ({ target_id: note.id, relation: "parent_of" })),
    source_ref: "bairui-memory-projection", timestamp: agent.updatedAt ?? new Date(0).toISOString(), created_at: agent.createdAt ?? new Date(0).toISOString()
  };
  return [root, ...notes.map((note) => ({
    id: note.id,
    mem_id: note.id,
    event_type: note.memoryKind || "knowledge",
    type: note.memoryKind || "knowledge",
    content: note.title,
    summary: note.title,
    detail: note.markdown,
    salience: Number(note.importance) || 3,
    importance: (Number(note.importance) || 3) / 5,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
    timestamp: note.updatedAt,
    entities: [`agent:${note.agentId || agent.id || "bairui"}`],
    concepts: note.frontmatter?.tags ?? [],
    tags: [...(note.frontmatter?.tags ?? []), `sync:${note.hermesSyncStatus || "pending"}`],
    links: (note.wikilinks ?? []).map((title) => byTitle.get(String(title).trim().toLocaleLowerCase())).filter(Boolean).map((targetId) => ({ target_id: targetId, relation: "related_to" })),
    parent_id: rootId,
    source_ref: note.sourceRef || "bairui-user"
  }))];
}

function preferredSlot(sourceId) {
  const normalized = String(sourceId || "").toLowerCase();
  if (normalized.includes("douyin")) return "douyin";
  if (normalized.includes("xiaohongshu") || normalized === "xhs") return "xiaohongshu";
  if (normalized.includes("wechat") || normalized.includes("weixin")) return "wechat";
  if (normalized.includes("weibo")) return "weibo";
  return null;
}

export function toBailongmaHotspots(latest) {
  const items = Array.isArray(latest?.items) ? latest.items : [];
  const sources = [];
  for (const item of items) {
    if (!sources.some((source) => source.id === item.sourceId)) {
      sources.push({ id: item.sourceId, name: item.sourceName || item.sourceId });
    }
  }

  const assignment = new Map();
  const usedSlots = new Set();
  for (const source of sources) {
    const preferred = preferredSlot(source.id);
    if (preferred && !usedSlots.has(preferred)) {
      assignment.set(source.id, preferred);
      usedSlots.add(preferred);
    }
  }
  for (const source of sources) {
    if (assignment.has(source.id)) continue;
    const available = HOTSPOT_SLOTS.find((slot) => !usedSlots.has(slot));
    if (!available) break;
    assignment.set(source.id, available);
    usedSlots.add(available);
  }

  const platforms = Object.fromEntries(HOTSPOT_SLOTS.map((slot) => [slot, []]));
  const platformLabels = {};
  const status = {};
  for (const source of sources) {
    const slot = assignment.get(source.id);
    if (!slot) continue;
    platformLabels[slot] = source.name;
    status[slot] = { ok: true, source: source.name };
  }
  for (const item of items) {
    const slot = assignment.get(item.sourceId);
    if (!slot || platforms[slot].length >= 10) continue;
    platforms[slot].push({
      rank: Number(item.rank) || platforms[slot].length + 1,
      text: item.title,
      heat: item.heat || item.category || "",
      trend: "same",
      isNew: false,
      url: item.url || ""
    });
  }

  return {
    platforms,
    platformLabels,
    fetchedAt: latest?.run?.completedAt ?? null,
    stale: !latest?.run || latest.run.status !== "completed",
    refreshMinutes: 30,
    status
  };
}
