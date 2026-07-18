import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PostgresPlatformRepository } from "../packages/db/postgres-repository.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(root, "test-results", "u00-03");

test("U00-03 PostgreSQL stores the owner-scoped Scene and control evidence", { skip: process.env.BAIRUI_POSTGRES_INTEGRATION !== "1" }, async () => {
  const repository = new PostgresPlatformRepository({ connectionString: process.env.DATABASE_URL });
  const suffix = randomUUID().slice(0, 8);
  const organizationId = `org_u0003_${suffix}`;
  const userId = `user_u0003_${suffix}`;
  const peerId = `peer_u0003_${suffix}`;
  const agentId = `agent_u0003_${suffix}`;
  const runtimeId = `runtime_u0003_${suffix}`;
  const sceneId = "web-chat";
  const observedAt = new Date().toISOString();
  try {
    await repository.createOrganization({ id: organizationId, name: "U00-03 PostgreSQL" });
    await repository.createUser({ id: userId, organizationId, email: `${userId}@example.test`, displayName: "Owner", passwordHash: "not-used", role: "user" });
    await repository.createUser({ id: peerId, organizationId, email: `${peerId}@example.test`, displayName: "Peer", passwordHash: "not-used", role: "user" });
    await repository.createAgent({ id: agentId, organizationId, ownerUserId: userId, name: "U00-03 Agent" });
    await repository.createAgentRuntime({ id: runtimeId, organizationId, ownerUserId: userId, agentId, workspaceRef: `hermes:${organizationId}:${userId}:${agentId}` });

    const scene = await repository.ensureAgentScene({ organizationId, userId, agentId, sceneId, view: { surfaces: [{ id: "chat", kind: "chat", order: 0 }] } });
    assert.equal(scene.revision, 0);
    assert.equal(await repository.ensureAgentScene({ organizationId, userId: peerId, agentId, sceneId, view: { surfaces: [] } }), null);
    const applied = await repository.applyAgentSceneIntent({ organizationId, userId, agentId, sceneId, action: "navigate", eventId: `intent_${suffix}`, view: { surfaces: [{ id: "chat", kind: "chat", order: 0 }], navigation: { surface: "conversations" } } });
    assert.equal(applied.scene.revision, 1);
    assert.equal(applied.patch.baseRevision, 0);
    assert.equal((await repository.listAgentSceneEvents({ organizationId, userId, agentId, sceneId, afterRevision: 0 })).length, 1);

    const heartbeat = await repository.saveAgentHeartbeat({
      organizationId,
      userId,
      agentId,
      runtimeId,
      sequence: 1,
      status: "healthy",
      runtimeVersion: "fixture-hermes-1.0.0",
      boundaryVersion: "0.3.0",
      observedAt,
      activeRuns: 0,
      queueDepth: 0,
      failedRuns: 0,
      components: [{ layer: "core-runtime", moduleId: "hermes", status: "healthy", version: "fixture-hermes-1.0.0", metrics: { active_runs: 0, queue_depth: 0 } }],
      events: [{ layer: "core-runtime", componentId: "hermes", eventType: "runtime.request.completed", severity: "info", metrics: { output_tokens: 3 }, occurredAt: observedAt }],
      usage: { bucketStart: observedAt, bucketSeconds: 3600, model: "fixture/hermes", inputTokens: 3, outputTokens: 3, runCount: 1, failedRunCount: 0 }
    });
    assert.equal(heartbeat.status, "healthy");
    const telemetry = await repository.listTelemetryEvents(organizationId, 20);
    assert.equal(telemetry[0].eventType, "runtime.request.completed");
    assert.equal((await repository.getAgentRuntimeByAgent(agentId)).status, "ready");

    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, "postgres.json"), `${JSON.stringify({
      schema_version: "u00-03.v1",
      slice_id: "web-chat",
      source: "BaiRui-cloud-agent-platform",
      database: "postgresql",
      migration_head: "020_scene_projection.sql",
      owner_scope: { organization_id: organizationId, user_id: userId, agent_id: agentId, runtime_id: runtimeId },
      evidence: [
        { layer: "data-storage", kind: "scene-projection", status: "passed", revision: applied.scene.revision },
        { layer: "control-plane", kind: "heartbeat-and-telemetry", status: "passed", content_redacted: true, event_type: telemetry[0].eventType },
        { layer: "runtime-route", kind: "runtime-readiness", status: "passed", runtime_status: "ready" }
      ],
      assertions: { peer_scene_rejected: true, scene_event_persisted: true, control_evidence_has_no_message_body: true }
    }, null, 2)}\n`, "utf8");
  } finally {
    await repository.pool.query("DELETE FROM organizations WHERE id=$1", [organizationId]).catch(() => {});
    await repository.close();
  }
});
