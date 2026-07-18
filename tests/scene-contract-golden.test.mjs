import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sceneEventMessage, sceneIntent, scenePatch, sceneSnapshot } from "../packages/scene/projection.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "scene-contract-golden.json"), "utf8"));

test("Scene projection produces deterministic snapshot, patch, intent and transport golden responses", () => {
  const snapshot = sceneSnapshot(golden.scene, golden.ownerScope, "trace_scene_golden");
  const patch = scenePatch(golden.event, golden.ownerScope, "trace_scene_golden");
  const intent = sceneIntent({ ...golden.intentInput, ownerScope: golden.ownerScope });

  assert.deepEqual(snapshot, golden.snapshot);
  assert.deepEqual(patch, golden.patch);
  assert.deepEqual(intent, golden.intent);
  assert.deepEqual(sceneEventMessage(snapshot), golden.messages.snapshot);
  assert.deepEqual(sceneEventMessage(patch), golden.messages.patch);
});

test("Scene projection rejects invalid scene identifiers before routing an intent", () => {
  assert.throws(() => sceneIntent({
    sceneId: "../other-agent",
    ownerScope: golden.ownerScope,
    action: "navigate",
    trace: "trace_scene_golden",
    intentId: "intent_scene_golden_0002",
    createdAt: "2026-07-18T00:00:06.000Z"
  }), /invalid_scene_id/);
});
