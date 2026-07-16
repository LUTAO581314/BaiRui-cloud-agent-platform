import { createHash } from "node:crypto";
import extractChunks from "png-chunks-extract";
import PNGtext from "png-chunk-text";

const MAX_CARD_BYTES = 8 * 1024 * 1024;
const MAX_SOUL_CHARS = 50_000;

function boundedText(value, maximum) {
  return String(value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/[\0\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, maximum);
}

function stringList(value, maximumItems = 50, maximumChars = 500) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string").map((item) => boundedText(item, maximumChars)).filter(Boolean))].slice(0, maximumItems) : [];
}

function decodePngCard(content) {
  if (typeof content !== "string" || !content) throw Object.assign(new TypeError("Character card PNG content is required"), { code: "invalid_character_card" });
  const buffer = Buffer.from(content.replace(/^data:image\/png;base64,/i, ""), "base64");
  if (!buffer.length || buffer.length > MAX_CARD_BYTES || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Object.assign(new TypeError("Character card PNG is invalid"), { code: "invalid_character_card" });
  const textChunks = extractChunks(new Uint8Array(buffer)).filter((chunk) => chunk.name === "tEXt").map((chunk) => PNGtext.decode(chunk.data));
  const encoded = textChunks.find((chunk) => chunk.keyword.toLowerCase() === "ccv3")?.text ?? textChunks.find((chunk) => chunk.keyword.toLowerCase() === "chara")?.text;
  if (!encoded) throw Object.assign(new TypeError("PNG does not contain character card metadata"), { code: "character_card_metadata_missing" });
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function rawCard(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Object.assign(new TypeError("Character card input is invalid"), { code: "invalid_character_card" });
  if (input.format === "png") return decodePngCard(input.content);
  if (input.format !== "json") throw Object.assign(new TypeError("Character card format is not supported"), { code: "character_card_format_not_supported" });
  if (typeof input.content === "string") {
    if (Buffer.byteLength(input.content, "utf8") > MAX_CARD_BYTES) throw Object.assign(new TypeError("Character card is too large"), { code: "character_card_too_large" });
    return JSON.parse(input.content);
  }
  return input.content;
}

function normalizedData(card) {
  if (!card || typeof card !== "object" || Array.isArray(card)) throw Object.assign(new TypeError("Character card JSON is invalid"), { code: "invalid_character_card" });
  const version = card.spec === "chara_card_v3" ? 3 : card.spec === "chara_card_v2" ? 2 : 1;
  const source = version > 1 ? card.data : card;
  if (!source || typeof source !== "object" || Array.isArray(source)) throw Object.assign(new TypeError("Character card data is missing"), { code: "invalid_character_card" });
  const name = boundedText(source.name, 64);
  if (!name) throw Object.assign(new TypeError("Character card name is required"), { code: "invalid_character_card" });
  const book = source.character_book && typeof source.character_book === "object" && !Array.isArray(source.character_book) ? source.character_book : null;
  return {
    spec: version === 3 ? "chara_card_v3" : version === 2 ? "chara_card_v2" : "tavern_card_v1",
    specVersion: boundedText(card.spec_version ?? version, 20),
    name,
    description: boundedText(source.description, 12_000),
    personality: boundedText(source.personality, 12_000),
    scenario: boundedText(source.scenario, 12_000),
    firstMessage: boundedText(source.first_mes, 20_000),
    messageExample: boundedText(source.mes_example, 30_000),
    creatorNotes: boundedText(source.creator_notes ?? source.creatorcomment, 12_000),
    systemPrompt: boundedText(source.system_prompt, 20_000),
    postHistoryInstructions: boundedText(source.post_history_instructions, 12_000),
    alternateGreetings: stringList(source.alternate_greetings, 20, 20_000),
    tags: stringList(source.tags, 50, 100),
    creator: boundedText(source.creator, 200),
    characterVersion: boundedText(source.character_version, 100),
    characterBook: book ? {
      name: boundedText(book.name, 200),
      description: boundedText(book.description, 2_000),
      entries: Array.isArray(book.entries) ? book.entries.filter((entry) => entry && typeof entry === "object" && entry.enabled !== false).slice(0, 200).map((entry, index) => ({
        id: Number.isSafeInteger(entry.id) ? entry.id : index,
        name: boundedText(entry.name ?? entry.comment, 200),
        keys: stringList(entry.keys, 50, 200),
        secondaryKeys: stringList(entry.secondary_keys, 50, 200),
        content: boundedText(entry.content, 50_000),
        constant: entry.constant === true,
        insertionOrder: Number.isFinite(entry.insertion_order) ? Number(entry.insertion_order) : index
      })).filter((entry) => entry.content) : []
    } : null
  };
}

function replaceMacros(value, name) {
  return String(value || "").replaceAll("{{char}}", name).replaceAll("{{user}}", "the user");
}

function section(title, value, name) {
  const content = replaceMacros(value, name).trim();
  return content ? `## ${title}\n\n${content}` : "";
}

function soulMarkdown(card) {
  const parts = [
    `# Identity\n\n## Name\n\n${card.name}`,
    section("Description", card.description, card.name),
    section("Personality", card.personality, card.name),
    section("Scenario", card.scenario, card.name),
    section("System Guidance", card.systemPrompt, card.name),
    section("Conversation Guidance", card.postHistoryInstructions, card.name)
  ].filter(Boolean);
  return parts.join("\n\n").slice(0, MAX_SOUL_CHARS);
}

function sourceMarkdown(card) {
  const lines = [`# Character Card Source - ${card.name}`, "", `- Spec: ${card.spec} ${card.specVersion}`, `- Creator: ${card.creator || "unknown"}`, `- Character version: ${card.characterVersion || "unknown"}`, `- Tags: ${card.tags.join(", ") || "none"}`];
  for (const [title, value] of [["First Message", card.firstMessage], ["Alternate Greetings", card.alternateGreetings.join("\n\n---\n\n")], ["Example Dialogue", card.messageExample], ["Creator Notes", card.creatorNotes]]) {
    if (value) lines.push("", `## ${title}`, "", value);
  }
  return lines.join("\n").slice(0, 200_000);
}

export function parseTavernCharacterCard(input) {
  let card;
  try { card = normalizedData(rawCard(input)); }
  catch (error) {
    if (error?.code) throw error;
    throw Object.assign(new TypeError("Character card cannot be parsed"), { code: "invalid_character_card", cause: error });
  }
  const digest = createHash("sha256").update(JSON.stringify(card)).digest("hex");
  const sourceRef = `character-card:${digest}`;
  const loreNotes = (card.characterBook?.entries ?? []).map((entry, index) => ({
    title: entry.name || entry.keys[0] || `${card.characterBook?.name || card.name} Lore ${index + 1}`,
    body: entry.content,
    tags: [...new Set(["character-card", "lore", ...entry.keys, ...entry.secondaryKeys])].slice(0, 50),
    importance: entry.constant ? 4 : 3,
    hermesTarget: "none",
    sourceRef
  }));
  return {
    card,
    digest,
    agent: { name: card.name, description: card.description.slice(0, 500), soulMarkdown: soulMarkdown(card) },
    provenance: { spec: card.spec, specVersion: card.specVersion, creator: card.creator, characterVersion: card.characterVersion, tags: card.tags, digest, importedAt: new Date().toISOString() },
    sourceNote: { title: `Character Card Source - ${card.name}`, body: sourceMarkdown(card), tags: ["character-card", "source", ...card.tags].slice(0, 50), importance: 2, hermesTarget: "none", sourceRef },
    loreNotes
  };
}
