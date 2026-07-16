import { createHash } from "node:crypto";

export const MEMORY_KINDS = Object.freeze(["knowledge", "fact", "preference", "constraint", "procedure", "person", "project", "event"]);
export const HERMES_MEMORY_TARGETS = Object.freeze(["auto", "memory", "user", "none"]);
export const HERMES_MEMORY_LIMITS = Object.freeze({ memory: 2200, user: 1375 });

function quoted(value) { return JSON.stringify(String(value)); }

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function importanceOf(value) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(5, parsed)) : 3;
}

function sourceRef(value) {
  const normalized = String(value ?? "bairui-user").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(normalized) ? normalized : "bairui-user";
}

export function obsidianSlug(title) {
  return String(title ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[\\/:*?"<>|#\[\]^]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "note";
}

export function obsidianBody(markdown) {
  return String(markdown ?? "")
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/u, "")
    .replace(/^# .+\r?\n+/u, "")
    .replace(/\r?\n+## 关联\r?\n[\s\S]*$/u, "")
    .trim();
}

export function createObsidianNote(input, now = new Date()) {
  const title = String(input.title ?? "").trim();
  const body = String(input.body ?? "").trim();
  if (!title || !body) throw new TypeError("Note title and body are required");
  const tags = [...new Set((input.tags ?? []).map((item) => String(item).trim()).filter(Boolean))].slice(0, 20);
  const bodyLinks = [...body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/gu)].map((match) => match[1].trim());
  const wikilinks = [...new Set([...(input.wikilinks ?? []), ...bodyLinks].map((item) => String(item).trim()).filter(Boolean))].slice(0, 50);
  const memoryKind = oneOf(input.memoryKind, MEMORY_KINDS, "knowledge");
  const importance = importanceOf(input.importance);
  const hermesTarget = oneOf(input.hermesTarget, HERMES_MEMORY_TARGETS, "auto");
  const createdAt = input.createdAt && Number.isFinite(Date.parse(input.createdAt)) ? new Date(input.createdAt).toISOString() : now.toISOString();
  const updatedAt = now.toISOString();
  const normalizedSource = sourceRef(input.sourceRef);
  const frontmatter = { title, created: createdAt, updated: updatedAt, tags, source: "bairui-agent", memory_kind: memoryKind, importance, hermes_target: hermesTarget, source_ref: normalizedSource };
  const yamlTags = tags.length ? `\ntags:\n${tags.map((tag) => `  - ${quoted(tag)}`).join("\n")}` : "\ntags: []";
  const links = wikilinks.length ? `\n\n## 关联\n\n${wikilinks.map((link) => `- [[${link.replaceAll("[", "").replaceAll("]", "")}]]`).join("\n")}` : "";
  const markdown = `---\ntitle: ${quoted(title)}\ncreated: ${quoted(createdAt)}\nupdated: ${quoted(updatedAt)}\nsource: bairui-agent\nmemory_kind: ${memoryKind}\nimportance: ${importance}\nhermes_target: ${hermesTarget}\nsource_ref: ${normalizedSource}${yamlTags}\n---\n\n# ${title}\n\n${body}${links}\n`;
  return { title, slug: obsidianSlug(title), markdown, frontmatter, wikilinks, memoryKind, importance, hermesTarget, sourceRef: normalizedSource };
}

function targetFor(note) {
  if (note.hermesTarget === "none") return "none";
  if (note.hermesTarget === "memory" || note.hermesTarget === "user") return note.hermesTarget;
  return ["preference", "person"].includes(note.memoryKind) ? "user" : "memory";
}

function compactEntry(note) {
  const body = obsidianBody(note.markdown).replace(/\s+/gu, " ").replaceAll("§", "").trim();
  if (String(note.sourceRef ?? "").startsWith("hermes-native:")) return body.slice(0, HERMES_MEMORY_LIMITS[note.hermesTarget] ?? 2200);
  const prefix = `${note.title}: `;
  return `${prefix}${body.slice(0, Math.max(1, 600 - prefix.length))}`.trim();
}

export function buildHermesMemoryProjection(notes, options = {}) {
  const excluded = new Set(options.excludeNoteIds ?? []);
  const sorted = [...notes].filter((note) => !excluded.has(note.id)).sort((left, right) =>
    (Number(right.importance) || 3) - (Number(left.importance) || 3) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const projection = { memory: [], user: [] };
  const used = { memory: 0, user: 0 };
  const capacityExcluded = [];
  for (const note of sorted) {
    const target = targetFor(note);
    if (target === "none") { capacityExcluded.push(note.id); continue; }
    const content = compactEntry(note);
    if (!content) { capacityExcluded.push(note.id); continue; }
    const next = used[target] + (projection[target].length ? 3 : 0) + content.length;
    if (next > HERMES_MEMORY_LIMITS[target]) { capacityExcluded.push(note.id); continue; }
    projection[target].push({ note_id: note.id, content });
    used[target] = next;
  }
  const stable = JSON.stringify({ memory: projection.memory, user: projection.user });
  return {
    schema_version: "1.0",
    projection_id: `memory-${createHash("sha256").update(stable).digest("hex").slice(0, 24)}`,
    memory: { entries: projection.memory, char_count: used.memory, limit: HERMES_MEMORY_LIMITS.memory },
    user: { entries: projection.user, char_count: used.user, limit: HERMES_MEMORY_LIMITS.user },
    included_note_ids: [...projection.memory, ...projection.user].map((entry) => entry.note_id),
    excluded_note_ids: [...excluded, ...capacityExcluded]
  };
}
