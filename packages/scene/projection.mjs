import { randomUUID } from "node:crypto";
import { validateSceneIntent, validateScenePatch, validateSceneSnapshot } from "@bairui/contracts";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

export function assertSceneId(value) {
  const sceneId = String(value ?? "");
  if (!IDENTIFIER.test(sceneId)) throw Object.assign(new Error("invalid_scene_id"), { statusCode: 400, code: "invalid_scene_id" });
  return sceneId;
}

export function defaultSceneView(agent) {
  const status = agent?.operational?.code ?? agent?.initializationStatus ?? "uninitialized";
  return {
    surfaces: [{
      id: "bairui-agent-status",
      kind: "metric",
      order: 0,
      intent: "inform",
      focus: true,
      data: {
        label: agent?.name ?? "bairui-agent",
        value: status,
        detail: "Hermes Runtime",
        status
      }
    }]
  };
}

export function sceneSnapshot(scene, ownerScope, trace = randomUUID()) {
  return validateSceneSnapshot({
    schema_version: "2.0",
    scene_id: scene.sceneId,
    owner_scope: ownerScope,
    revision: scene.revision,
    view: scene.view ?? { surfaces: [] },
    generated_at: scene.updatedAt ?? new Date().toISOString(),
    trace: { correlation_id: trace }
  });
}

export function scenePatch(event, ownerScope, trace = randomUUID()) {
  return validateScenePatch({
    schema_version: "2.0",
    scene_id: event.sceneId,
    owner_scope: ownerScope,
    base_revision: event.baseRevision,
    revision: event.revision,
    operations: event.operations,
    generated_at: event.createdAt ?? new Date().toISOString(),
    trace: { correlation_id: trace }
  });
}

export function sceneIntent({ sceneId, ownerScope, action, payload = {}, trace = randomUUID(), intentId = `intent_${randomUUID()}`, createdAt = new Date().toISOString() }) {
  return validateSceneIntent({
    schema_version: "2.0",
    scene_id: assertSceneId(sceneId),
    owner_scope: ownerScope,
    intent_id: intentId,
    action,
    payload,
    created_at: createdAt,
    trace: { correlation_id: trace }
  });
}

export function sceneEventMessage(value) {
  const type = value?.schema_version && Object.hasOwn(value, "base_revision") ? "scene.patch" : "scene";
  return { v: 1, type, ...(type === "scene" ? { rev: value.revision, view: value.view } : { base: value.base_revision, rev: value.revision, operations: value.operations }) };
}
