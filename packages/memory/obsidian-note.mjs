function quoted(value) { return JSON.stringify(String(value)); }

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

export function createObsidianNote(input, now = new Date()) {
  const title = String(input.title ?? "").trim();
  const body = String(input.body ?? "").trim();
  if (!title || !body) throw new TypeError("Note title and body are required");
  const tags = [...new Set((input.tags ?? []).map((item) => String(item).trim()).filter(Boolean))].slice(0, 20);
  const wikilinks = [...new Set((input.wikilinks ?? []).map((item) => String(item).trim()).filter(Boolean))].slice(0, 30);
  const createdAt = now.toISOString();
  const frontmatter = { title, created: createdAt, updated: createdAt, tags, source: "bairui-agent" };
  const yamlTags = tags.length ? `\ntags:\n${tags.map((tag) => `  - ${quoted(tag)}`).join("\n")}` : "\ntags: []";
  const links = wikilinks.length ? `\n\n## 关联\n\n${wikilinks.map((link) => `- [[${link.replaceAll("[", "").replaceAll("]", "")}]]`).join("\n")}` : "";
  const markdown = `---\ntitle: ${quoted(title)}\ncreated: ${quoted(createdAt)}\nupdated: ${quoted(createdAt)}\nsource: bairui-agent${yamlTags}\n---\n\n# ${title}\n\n${body}${links}\n`;
  return { title, slug: obsidianSlug(title), markdown, frontmatter, wikilinks };
}
