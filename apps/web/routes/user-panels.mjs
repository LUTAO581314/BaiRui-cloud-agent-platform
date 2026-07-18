import { randomUUID } from "node:crypto";
import { PERMISSIONS, requirePermission } from "../../../packages/auth/authorization.mjs";
import { toBailongmaHotspots, toBailongmaMemories } from "../../../packages/bailongma-ui/compatibility.mjs";
import { createPanelManifest, panelDefinition, panelUnavailable } from "../../../packages/bailongma-ui/panel-contracts.mjs";
import { defaultSceneView, scenePatch, sceneSnapshot } from "../../../packages/scene/projection.mjs";
import { sceneEventCursor, streamSceneEvents } from "../../../packages/scene/sse-transport.mjs";
import { workspaceIdFromRef } from "../../../packages/server-protocol/runtime-client.mjs";
import { json, readJson } from "../http.mjs";

const PANEL_ID = /^[a-z][a-z0-9-]{0,63}$/;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function ownerScope(principal, agent, runtime) {
  const workspaceRef = runtime?.workspaceRef ?? `hermes:${principal.organizationId}:${principal.userId}:${agent.id}`;
  return {
    organization_id: principal.organizationId,
    user_id: principal.userId,
    agent_id: agent.id,
    workspace_id: runtime?.workspaceId ?? workspaceIdFromRef(workspaceRef)
  };
}

function statusCode(state) {
  if (state === "unsupported") return 501;
  if (state === "needs_configuration") return 409;
  return 503;
}

function sceneIdFor(panelId) {
  return panelId === "scene-shell" ? "main" : `panel:${panelId}`;
}

function hotspotView(agent, latest, visible = true) {
  const count = latest?.items?.length ?? 0;
  return {
    surfaces: [{
      id: "hotspots",
      kind: "metric",
      order: 0,
      intent: visible ? "inform" : "ambient",
      focus: visible,
      data: {
        label: "实时热点",
        value: count,
        detail: latest?.run?.completedAt ?? "等待首次采集",
        status: latest?.run?.status ?? "needs_configuration"
      }
    }],
    panel: {
      id: "hotspots",
      visible,
      run_id: latest?.run?.id ?? null,
      fetched_at: latest?.run?.completedAt ?? null,
      item_count: count
    }
  };
}

async function panelFacts(repository, principal, agent, operational) {
  const [latest, bindings] = await Promise.all([
    repository.listLatestHotspots(principal.organizationId),
    repository.listAgentChannelBindings(principal.organizationId, principal.userId, agent.id)
  ]);
  return {
    latest,
    facts: {
      operationalCode: operational.operational?.code ?? "uninitialized",
      hermesManagementReady: false,
      connectedChannelCount: bindings.filter((binding) => binding.status === "connected").length,
      hotspotRunStatus: latest.run?.status ?? null,
      hotspotItemCount: latest.items.length,
      profileConfigured: Boolean(agent.soulMarkdown?.trim())
    }
  };
}

async function panelContext(options, principal, agentId) {
  const agent = await options.ownedAgent(principal, agentId);
  const [runtime, operational] = await Promise.all([
    options.repository.getAgentRuntimeByAgent(agent.id),
    options.agentOperationalView(principal, agent)
  ]);
  const scoped = ownerScope(principal, agent, runtime);
  const { facts, latest } = await panelFacts(options.repository, principal, agent, operational);
  const manifest = createPanelManifest({ agentId: agent.id, ownerScope: scoped, facts });
  return { agent, runtime, operational, ownerScope: scoped, facts, latest, manifest };
}

function manifestPanel(context, panelId) {
  return context.manifest.panels.find((panel) => panel.id === panelId) ?? null;
}

async function ensurePanelScene(repository, context, panelId, view) {
  const sceneId = sceneIdFor(panelId);
  let scene = await repository.getAgentScene({
    organizationId: context.ownerScope.organization_id,
    userId: context.ownerScope.user_id,
    agentId: context.agent.id,
    sceneId
  });
  if (!scene) {
    scene = await repository.ensureAgentScene({
      organizationId: context.ownerScope.organization_id,
      userId: context.ownerScope.user_id,
      agentId: context.agent.id,
      sceneId,
      view: view ?? defaultSceneView(context.operational)
    });
  }
  return scene;
}

function panelSnapshotBody(context, panel, scene, data) {
  return {
    schema_version: "bairui.panel-snapshot.v1",
    panel_id: panel.id,
    owner_scope: context.ownerScope,
    state: panel.state,
    reason: panel.reason,
    revision: scene?.revision ?? 0,
    generated_at: new Date().toISOString(),
    data
  };
}

function validExpectedRevision(value) {
  if (value === undefined) return undefined;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

async function applyPanelView({ repository, context, panelId, scene, view, commandId, expectedRevision }) {
  const applied = await repository.applyAgentSceneIntent({
    organizationId: context.ownerScope.organization_id,
    userId: context.ownerScope.user_id,
    agentId: context.agent.id,
    sceneId: sceneIdFor(panelId),
    action: "command",
    view,
    eventId: commandId,
    expectedRevision
  });
  if (applied?.conflict) return { conflict: true, scene: applied.scene };
  return applied;
}

export function createUserPanelRoutes(options) {
  const { repository, runtimeClient, requireLogin, ownedAgent, requireOperationalAgent } = options;

  return async function routeUserPanels({ method, url, request, response, principal }) {
    const manifestMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/ui\/panels$/);
    const panelMatch = url.pathname.match(/^\/api\/user\/agents\/([^/]+)\/ui\/panels\/([^/]+)\/(snapshot|commands|events)$/);
    if (!(manifestMatch && method === "GET") && !panelMatch) return false;

    const loggedIn = requireLogin(principal);
    const action = panelMatch?.[3] ?? "manifest";
    requirePermission(loggedIn, action === "commands" ? PERMISSIONS.AGENT_USE : PERMISSIONS.AGENT_READ, {
      organizationId: loggedIn.organizationId,
      userId: loggedIn.userId
    });
    const agentId = decodeURIComponent(manifestMatch?.[1] ?? panelMatch[1]);
    const context = await panelContext(options, loggedIn, agentId);
    if (manifestMatch) {
      json(response, 200, context.manifest, { etag: `"${context.manifest.revision}"` });
      return true;
    }

    const panelId = decodeURIComponent(panelMatch[2]);
    if (!PANEL_ID.test(panelId) || !panelDefinition(panelId)) {
      json(response, 404, { error: "panel_not_found" });
      return true;
    }
    const panel = manifestPanel(context, panelId);
    if (!panel) {
      json(response, 404, { error: "panel_not_found" });
      return true;
    }

    if (action === "snapshot" && method === "GET") {
      if (panelId === "memory-graph") {
        const notes = await repository.listObsidianNotes(loggedIn.organizationId, loggedIn.userId, context.agent.id);
        const scene = await ensurePanelScene(repository, context, panelId, { surfaces: [] });
        json(response, 200, panelSnapshotBody(context, panel, scene, { native: toBailongmaMemories(notes, context.agent), format: "obsidian-markdown" }));
        return true;
      }
      if (panelId === "hotspots") {
        const scene = await ensurePanelScene(repository, context, panelId, hotspotView(context.agent, context.latest));
        json(response, 200, panelSnapshotBody(context, panel, scene, { ...context.latest, native: toBailongmaHotspots(context.latest), scene: sceneSnapshot(scene, context.ownerScope) }));
        return true;
      }
      if (panelId === "scene-shell") {
        const scene = await ensurePanelScene(repository, context, panelId, defaultSceneView(context.operational));
        json(response, 200, panelSnapshotBody(context, panel, scene, { scene: sceneSnapshot(scene, context.ownerScope) }));
        return true;
      }
      json(response, statusCode(panel.state), panelUnavailable(panel));
      return true;
    }

    if (action === "events" && method === "GET") {
      if (!panel.events.endpoint || panel.events.status !== "available" || !["scene-shell", "hotspots"].includes(panelId)) {
        const state = panel.events.status === "available" ? "unsupported" : panel.events.status;
        json(response, statusCode(state), panelUnavailable(panel, state));
        return true;
      }
      const view = panelId === "hotspots" ? hotspotView(context.agent, context.latest) : defaultSceneView(context.operational);
      const scene = await ensurePanelScene(repository, context, panelId, view);
      await streamSceneEvents({ response, repository, ownerScope: context.ownerScope, scene, afterRevision: sceneEventCursor(url, request) });
      return true;
    }

    if (action !== "commands" || method !== "POST") return false;
    const body = await readJson(request);
    const command = typeof body?.command === "string" ? body.command : "";
    const commandId = typeof body?.command_id === "string" && COMMAND_ID.test(body.command_id) ? body.command_id : `panel_${randomUUID()}`;
    const expectedRevision = validExpectedRevision(body?.base_revision);
    if (expectedRevision === null) {
      json(response, 400, { error: "invalid_panel_revision" });
      return true;
    }

    if (panelId === "hotspots" && command === "refresh") {
      await requireOperationalAgent(loggedIn, context.agent);
      if (!runtimeClient?.invokeIntegration) {
        json(response, 503, panelUnavailable({ ...panel, reason: "runtime_integration_unavailable" }, "temporarily_unavailable"));
        return true;
      }
      const sources = Array.isArray(body.payload?.sources)
        ? body.payload.sources.filter((source) => typeof source === "string" && source.length <= 80).slice(0, 32)
        : undefined;
      const startedAt = new Date().toISOString();
      const result = await runtimeClient.invokeIntegration({
        principal: loggedIn,
        agent: context.agent,
        integrationId: "trendradar",
        capability: "list_hotspots",
        input: { sources }
      });
      const run = await repository.saveIntegrationResult({
        organizationId: loggedIn.organizationId,
        integrationId: "trendradar",
        capability: "list_hotspots",
        status: result.status,
        summary: { sources: result.output?.sources ?? [], count: result.output?.items?.length ?? 0 },
        items: result.output?.items ?? [],
        startedAt,
        completedAt: result.completed_at
      });
      const latest = await repository.listLatestHotspots(loggedIn.organizationId);
      const scene = await ensurePanelScene(repository, context, panelId, hotspotView(context.agent, context.latest));
      const applied = await applyPanelView({ repository, context, panelId, scene, view: hotspotView(context.agent, latest), commandId, expectedRevision });
      if (applied?.conflict) {
        json(response, 409, { error: "scene_revision_conflict", current: sceneSnapshot(applied.scene, context.ownerScope) });
        return true;
      }
      await repository.recordAudit({
        organizationId: loggedIn.organizationId,
        actorUserId: loggedIn.userId,
        action: "panel.hotspots.refresh",
        targetType: "agent",
        targetId: context.agent.id,
        metadata: { integrationId: "trendradar", runId: run.id, status: run.status, count: latest.items.length, sceneRevision: applied.scene.revision }
      });
      const refreshed = await panelContext(options, loggedIn, context.agent.id);
      const refreshedPanel = manifestPanel(refreshed, panelId);
      json(response, 200, {
        schema_version: "bairui.panel-command-result.v1",
        command_id: commandId,
        panel_id: panelId,
        owner_scope: context.ownerScope,
        status: run.status,
        revision: applied.scene.revision,
        scene: sceneSnapshot(applied.scene, context.ownerScope),
        snapshot: panelSnapshotBody(refreshed, refreshedPanel, applied.scene, { ...latest, native: toBailongmaHotspots(latest), scene: sceneSnapshot(applied.scene, context.ownerScope) }),
        patch: scenePatch(applied.patch, context.ownerScope)
      });
      return true;
    }

    if (["hotspots", "scene-shell"].includes(panelId) && ["visibility", "navigate", "resync"].includes(command)) {
      const scene = await ensurePanelScene(repository, context, panelId, panelId === "hotspots" ? hotspotView(context.agent, context.latest) : defaultSceneView(context.operational));
      if (command === "resync") {
        json(response, 200, { schema_version: "bairui.panel-command-result.v1", command_id: commandId, panel_id: panelId, owner_scope: context.ownerScope, status: "resynced", revision: scene.revision, scene: sceneSnapshot(scene, context.ownerScope) });
        return true;
      }
      const view = panelId === "hotspots"
        ? hotspotView(context.agent, context.latest, body.payload?.visible !== false)
        : { ...scene.view, navigation: { surface: String(body.payload?.surface ?? "").slice(0, 80), updated_at: new Date().toISOString() } };
      const applied = await applyPanelView({ repository, context, panelId, scene, view, commandId, expectedRevision });
      if (applied?.conflict) {
        json(response, 409, { error: "scene_revision_conflict", current: sceneSnapshot(applied.scene, context.ownerScope) });
        return true;
      }
      json(response, 200, { schema_version: "bairui.panel-command-result.v1", command_id: commandId, panel_id: panelId, owner_scope: context.ownerScope, status: "applied", revision: applied.scene.revision, scene: sceneSnapshot(applied.scene, context.ownerScope), patch: scenePatch(applied.patch, context.ownerScope) });
      return true;
    }

    json(response, statusCode(panel.command.status), panelUnavailable(panel, panel.command.status));
    return true;
  };
}
