import test from "node:test";
import assert from "node:assert/strict";
import { SecretEnvelope } from "../packages/security/secret-envelope.mjs";
import { createObsidianNote, obsidianSlug } from "../packages/memory/obsidian-note.mjs";

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
});
