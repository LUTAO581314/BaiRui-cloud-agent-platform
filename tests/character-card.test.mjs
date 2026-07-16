import assert from "node:assert/strict";
import test from "node:test";
import { parseTavernCharacterCard } from "../packages/character-card/tavern-card.mjs";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name, data) {
  const type = Buffer.from(name, "ascii");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([size, type, data, checksum]);
}

function cardPng(keyword, card) {
  const text = Buffer.from(`${keyword}\0${Buffer.from(JSON.stringify(card)).toString("base64")}`, "latin1");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("tEXt", text), pngChunk("IEND", Buffer.alloc(0))]).toString("base64");
}

const v2 = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Ada",
    description: "A precise research partner.",
    personality: "Curious and direct.",
    scenario: "Working with {{user}}.",
    first_mes: "Hello {{user}}",
    mes_example: "{{char}}: Evidence first.",
    system_prompt: "Cite uncertainty.",
    post_history_instructions: "Keep answers concise.",
    alternate_greetings: ["Welcome back"],
    creator_notes: "Imported source note",
    character_book: { name: "Ada lore", entries: [{ id: 1, keys: ["Babbage"], content: "The engine is analytical.", enabled: true }] }
  }
};

test("maps Tavern V1, V2, and V3 identity fields without activating greetings or Lorebook", () => {
  const cards = [
    { name: "V1", description: "Old card", first_mes: "Do not activate" },
    v2,
    { spec: "chara_card_v3", spec_version: "3.0", data: { ...v2.data, name: "V3" } }
  ];
  for (const card of cards) {
    const parsed = parseTavernCharacterCard({ format: "json", content: card });
    assert.match(parsed.agent.soulMarkdown, /# Identity/);
    assert.doesNotMatch(parsed.agent.soulMarkdown, /Do not activate|Hello the user|Evidence first/);
    assert.equal(parsed.sourceNote.hermesTarget, "none");
    assert.ok(parsed.loreNotes.every((note) => note.hermesTarget === "none"));
  }
  const parsed = parseTavernCharacterCard({ format: "json", content: v2 });
  assert.match(parsed.agent.soulMarkdown, /Working with the user/);
  assert.equal(parsed.loreNotes.length, 1);
  assert.match(parsed.sourceNote.body, /Hello \{\{user\}\}/);
});

test("reads both SillyTavern chara and CCv3 PNG metadata", () => {
  const fromV2 = parseTavernCharacterCard({ format: "png", content: cardPng("chara", v2) });
  const v3 = { spec: "chara_card_v3", spec_version: "3.0", data: { ...v2.data, name: "CCv3" } };
  const fromV3 = parseTavernCharacterCard({ format: "png", content: `data:image/png;base64,${cardPng("ccv3", v3)}` });
  assert.equal(fromV2.card.name, "Ada");
  assert.equal(fromV3.card.name, "CCv3");
  assert.equal(fromV3.card.spec, "chara_card_v3");
});

test("rejects malformed, unsupported, and oversized cards", () => {
  assert.throws(() => parseTavernCharacterCard({ format: "json", content: "{" }), { code: "invalid_character_card" });
  assert.throws(() => parseTavernCharacterCard({ format: "yaml", content: "name: bad" }), { code: "character_card_format_not_supported" });
  assert.throws(() => parseTavernCharacterCard({ format: "json", content: "x".repeat(8 * 1024 * 1024 + 1) }), { code: "character_card_too_large" });
  assert.throws(() => parseTavernCharacterCard({ format: "png", content: Buffer.from("not-png").toString("base64") }), { code: "invalid_character_card" });
});
