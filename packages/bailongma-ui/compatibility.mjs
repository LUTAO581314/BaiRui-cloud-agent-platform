const HOTSPOT_SLOTS = ["douyin", "xiaohongshu", "wechat", "weibo"];

export function toBailongmaMemories(notes) {
  return notes.map((note) => ({
    id: note.id,
    mem_id: note.id,
    event_type: "knowledge",
    type: "knowledge",
    content: note.title,
    summary: note.title,
    detail: note.markdown,
    importance: 0.8,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
    tags: note.frontmatter?.tags ?? []
  }));
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
