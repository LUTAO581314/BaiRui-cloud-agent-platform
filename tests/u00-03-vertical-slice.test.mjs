import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fixtureCredentials, startBrowserFixture } from "./browser/fixture-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(root, "test-results", "u00-03");

async function login(baseUrl, credentials) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials)
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";", 1)[0];
}

function sseEvents(text) {
  return [...text.matchAll(/^event: ([^\n]+)\ndata: ([^\n]+)$/gm)].map((match) => ({
    type: match[1],
    data: JSON.parse(match[2])
  }));
}

async function readSseUntil(response, marker) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.includes(marker)) {
        await reader.cancel();
        return text;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return text;
}

function writeEvidence(report) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "web-chat.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

test("U00-03 web chat crosses UI command, BFF, Runtime, storage, events and control evidence", async (t) => {
  const fixture = await startBrowserFixture();
  t.after(() => fixture.close());
  const ownerCookie = await login(fixture.baseUrl, { email: fixtureCredentials.user.email, password: fixtureCredentials.user.password });
  const peerCookie = await login(fixture.baseUrl, { email: "peer@example.test", password: fixtureCredentials.user.password });
  const adminCookie = await login(fixture.baseUrl, { email: fixtureCredentials.admin.email, password: fixtureCredentials.admin.password });
  const agentBase = `${fixture.baseUrl}/api/user/agents/agent_remote`;
  const scope = {
    organization_id: "org_remote",
    user_id: "user_remote",
    agent_id: "agent_remote",
    runtime_id: "runtime_remote"
  };

  const scene = await fetch(`${agentBase}/scenes/brain`, { headers: { cookie: ownerCookie } });
  assert.equal(scene.status, 200);
  const sceneBody = await scene.json();
  assert.deepEqual(sceneBody.owner_scope, {
    organization_id: scope.organization_id,
    user_id: scope.user_id,
    agent_id: scope.agent_id,
    workspace_id: sceneBody.owner_scope.workspace_id
  });

  const peerScene = await fetch(`${agentBase}/scenes/brain`, { headers: { cookie: peerCookie } });
  assert.equal(peerScene.status, 404, "a peer must not read the owner's scene");

  const intent = await fetch(`${agentBase}/scenes/brain/intents`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "navigate", payload: { surface: "conversations" } })
  });
  assert.equal(intent.status, 200);
  const intentBody = await intent.json();
  assert.equal(intentBody.scene.view.navigation.surface, "conversations");
  assert.equal(intentBody.patch.base_revision, 0);
  assert.equal(intentBody.patch.revision, 1);

  const chat = await fetch(`${agentBase}/sessions/session_remote/chat/stream`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ message: "U00-03 web chat fixture" })
  });
  assert.equal(chat.status, 200);
  const events = sseEvents(await chat.text());
  assert.deepEqual(events.map((event) => event.type), ["run.started", "message.started", "assistant.delta", "assistant.completed", "run.completed"]);
  assert.equal(events.find((event) => event.type === "assistant.completed").data.content, "Remote acceptance reply");

  const messages = await fetch(`${agentBase}/sessions/session_remote/messages`, { headers: { cookie: ownerCookie } });
  assert.equal(messages.status, 200);
  const messageBody = await messages.json();
  assert.ok(messageBody.data.some((message) => message.content === "Remote acceptance reply"), "the Runtime session store must persist the completed reply");

  const sceneEvents = await fetch(`${agentBase}/scenes/brain/events?after=0`, { headers: { cookie: ownerCookie } });
  assert.equal(sceneEvents.status, 200);
  assert.match(await readSseUntil(sceneEvents, "event: scene\n"), /event: scene\n/);

  const heartbeat = await fixture.repository.saveAgentHeartbeat({
    organizationId: scope.organization_id,
    userId: scope.user_id,
    agentId: scope.agent_id,
    runtimeId: scope.runtime_id,
    sequence: 2,
    status: "healthy",
    runtimeVersion: "fixture-hermes-1.0.0",
    boundaryVersion: "0.3.0",
    observedAt: new Date().toISOString(),
    activeRuns: 0,
    queueDepth: 0,
    failedRuns: 0,
    components: [{ layer: "core-runtime", moduleId: "hermes", status: "healthy", version: "fixture-hermes-1.0.0", metrics: { active_runs: 0, queue_depth: 0 } }],
    events: [{ layer: "core-runtime", componentId: "hermes", eventType: "runtime.request.completed", severity: "info", metrics: { output_tokens: 3 }, occurredAt: new Date().toISOString() }],
    usage: { bucketStart: new Date().toISOString(), bucketSeconds: 3600, model: "fixture/hermes", inputTokens: 3, outputTokens: 3, runCount: 1, failedRunCount: 0 }
  });
  assert.equal(heartbeat.status, "healthy");

  const adminAgents = await fetch(`${fixture.baseUrl}/api/admin/agents`, { headers: { cookie: adminCookie } });
  assert.equal(adminAgents.status, 200);
  const fleet = await adminAgents.json();
  const fleetAgent = fleet.agents.find((agent) => agent.id === scope.agent_id);
  assert.equal(fleetAgent.runtime.status, "ready");
  assert.equal(fleetAgent.heartbeat.activeRuns, 0);
  assert.doesNotMatch(JSON.stringify(fleet), /U00-03 web chat fixture|Remote acceptance reply/, "control evidence must not contain conversation content");

  const operation = fixture.runtimeOperations.find((item) => item.operation === "sessions.chat.stream");
  assert.ok(operation, "BFF must call the Runtime stream operation");
  assert.equal(operation.input.session_id, "session_remote");

  writeEvidence({
    schema_version: "u00-03.v1",
    slice_id: "web-chat",
    source: "BaiRui-cloud-agent-platform",
    commit: process.env.GITHUB_SHA ?? "ci-fixture",
    owner_scope: scope,
    evidence: [
      { layer: "ui-exposure", kind: "scene-intent", status: "passed", reference: "POST /api/user/agents/:agent/scenes/:scene/intents" },
      { layer: "channel-bridge", kind: "bff-session-stream", status: "passed", reference: "POST /api/user/agents/:agent/sessions/:session/chat/stream" },
      { layer: "core-runtime", kind: "hermes-operation", status: "passed", operation: "sessions.chat.stream", events: events.map((event) => event.type) },
      { layer: "data-storage", kind: "session-and-scene-projection", status: "passed", scene_revision: intentBody.scene.revision, message_count: messageBody.data.length },
      { layer: "control-plane", kind: "heartbeat", status: "passed", content_redacted: true, fields: ["status", "active_runs", "queue_depth", "failed_runs", "component_status", "usage"] }
    ],
    assertions: {
      owner_scope_enforced: true,
      peer_access_denied: true,
      native_sse_preserved: true,
      control_evidence_has_no_conversation_body: true
    }
  });
});
