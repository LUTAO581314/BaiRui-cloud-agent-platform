import test from "node:test";
import assert from "node:assert/strict";
import { SecretEnvelope } from "../packages/security/secret-envelope.mjs";
import { buildHermesMemoryProjection, createObsidianNote, obsidianSlug } from "../packages/memory/obsidian-note.mjs";

test("provider secrets are authenticated and never stored as plaintext", () => {
  const vault = new SecretEnvelope("test-provider-encryption-key-longer-than-32-characters");
  const envelope = vault.seal("provider-secret-value");
  assert.equal(vault.open(envelope), "provider-secret-value");
  assert.doesNotMatch(JSON.stringify(envelope), /provider-secret-value/);
  const tamperedTag = `${envelope.tag[0] === "A" ? "B" : "A"}${envelope.tag.slice(1)}`;
  assert.throws(() => vault.open({ ...envelope, tag: tamperedTag }));
});

test("Obsidian notes use frontmatter and wikilinks", () => {
  const note = createObsidianNote({ title: "项目 决策", body: "使用 PostgreSQL。", tags: ["架构"], wikilinks: ["技术框架"] }, new Date("2026-07-15T00:00:00.000Z"));
  assert.equal(note.slug, obsidianSlug("项目 决策"));
  assert.match(note.markdown, /^---/);
  assert.match(note.markdown, /\[\[技术框架\]\]/);
  assert.equal(note.frontmatter.source, "bairui-agent");
  assert.equal(note.memoryKind, "knowledge");
});

test("projects important Obsidian notes into bounded Hermes stores", () => {
  const notes = [
    { id: "memory_a", title: "Architecture", markdown: "# Architecture\n\nUse PostgreSQL.", memoryKind: "knowledge", importance: 5, hermesTarget: "auto", updatedAt: "2026-07-16T00:00:00.000Z" },
    { id: "user_a", title: "Response style", markdown: "# Response style\n\nBe concise.", memoryKind: "preference", importance: 4, hermesTarget: "auto", updatedAt: "2026-07-16T00:00:00.000Z" },
    { id: "archive_a", title: "Archive", markdown: "# Archive\n\nKeep only in Obsidian.", memoryKind: "knowledge", importance: 3, hermesTarget: "none", updatedAt: "2026-07-16T00:00:00.000Z" }
  ];
  const projection = buildHermesMemoryProjection(notes);
  assert.deepEqual(projection.memory.entries.map((entry) => entry.note_id), ["memory_a"]);
  assert.deepEqual(projection.user.entries.map((entry) => entry.note_id), ["user_a"]);
  assert.ok(projection.excluded_note_ids.includes("archive_a"));
  assert.ok(projection.memory.char_count <= projection.memory.limit);
  assert.match(projection.projection_id, /^memory-[a-f0-9]{24}$/);
});
