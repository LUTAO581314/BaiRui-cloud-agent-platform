import { createHash } from "node:crypto";

export const PANEL_CONTRACT_VERSION = "bairui.panel-manifest.v1";
export const PANEL_STATES = Object.freeze([
  "available",
  "needs_configuration",
  "temporarily_unavailable",
  "unsupported"
]);

const OWNER_SCOPE_FIELDS = Object.freeze([
  "organization_id",
  "user_id",
  "agent_id",
  "workspace_id"
]);

const DEFINITIONS = [
  {
    id: "shell-layout",
    priority: "P0",
    treatment: "native-equivalent",
    defaultState: "available",
    snapshot: { status: "available", transport: "build-manifest" },
    command: { status: "available", transport: "browser-local" },
    events: { status: "available", transport: "dom" },
    persistence: { authority: "browser-local", durable: false },
    revision: { strategy: "bailongma-commit-and-build-hash" },
    recovery: { strategy: "rebuild-pinned-source-and-replay-patches" },
    ownership: { scope: [], shared: false }
  },
  {
    id: "memory-graph",
    priority: "P0",
    treatment: "bairui-equivalent",
    defaultState: "available",
    snapshot: { status: "available", transport: "http" },
    command: { status: "available", transport: "http" },
    events: { status: "needs_configuration", transport: "sse" },
    persistence: { authority: "postgresql-obsidian-notes", durable: true },
    revision: { strategy: "note-revision-and-projection-digest" },
    recovery: { strategy: "snapshot-reload-and-projection-outbox-replay" },
    ownership: { scope: OWNER_SCOPE_FIELDS, shared: false }
  },
  {
    id: "chat",
    priority: "P0",
    treatment: "bairui-equivalent",
    defaultState: "available",
    snapshot: { status: "available", transport: "http" },
    command: { status: "available", transport: "http" },
    events: { status: "available", transport: "sse" },
    persistence: { authority: "hermes-session-plus-postgresql-tenant-metadata", durable: true },
    revision: { strategy: "session-message-and-run-identifiers" },
    recovery: { strategy: "reload-session-and-resume-from-run-status" },
    ownership: { scope: OWNER_SCOPE_FIELDS, shared: false }
  },
  {
    id: "scene-shell",
    priority: "P0",
    treatment: "bairui-equivalent",
    defaultState: "available",
    snapshot: { status: "available", transport: "http" },
    command: { status: "available", transport: "http" },
    events: { status: "available", transport: "sse" },
    persistence: { authority: "postgresql-agent-scene", durable: true },
    revision: { strategy: "monotonic-scene-revision" },
    recovery: { strategy: "last-event-id-gap-detection-and-full-resync" },
    ownership: { scope: OWNER_SCOPE_FIELDS, shared: false }
  },
  {
    id: "settings",
    priority: "P0",
    treatment: "bairui-equivalent",
    defaultState: "needs_configuration",
    snapshot: { status: "available", transport: "http" },
    command: { status: "needs_configuration", transport: "http" },
    events: { status: "needs_configuration", transport: "sse" },
    persistence: { authority: "postgresql-encrypted-references-and-revisions", durable: true },
    revision: { strategy: "opaque-configuration-revision" },
    recovery: { strategy: "validated-apply-and-rollback" },
    ownership: { scope: OWNER_SCOPE_FIELDS, shared: false }
  },
  {
    id: "social-channels",
    priority: "P0",
    treatment: "bairui-equivalent",
    defaultState: "needs_configuration",
    snapshot: { status: "available", transport: "http" },
    command: { status: "available", transport: "http" },
    events: { status: "needs_configuration", transport: "sse" },
    persistence: { authority: "postgresql-channel-bindings-and-outbox", durable: true },
    revision: { strategy: "binding-generation-and-delivery-sequence" },
    recovery: { strategy: "worker-reconnect-and-durable-receipt-replay" },
    ownership: { scope: OWNER_SCOPE_FIELDS, shared: false }
  },
  {
    id: "hotspots",
    priority: "P0",
    treatment: "bairui-equivalent",
    defaultState: "needs_configuration",
    snapshot: { status: "available", transport: "http" },
    command: { status: "available", transport: "http" },
    events: { status: "available", transport: "sse" },
    persistence: { authority: "postgresql-integration-runs-and-agent-bookmarks", durable: true },
    revision: { strategy: "scene-revision-plus-integration-run-id" },
    recovery: { strategy: "cached-snapshot-last-event-id-and-full-resync" },
    ownership: { scope: OWNER_SCOPE_FIELDS, shared: true }
  },
  {
    id: "person-card",
    priority: "P0",
    treatment: "bairui-equivalent",
    defaultState: "needs_configuration",
    snapshot: { status: "needs_configuration", transport: "http" },
    command: { status: "available", transport: "http" },
    events: { status: "needs_configuration", transport: "sse" },
    persistence: { authority: "postgresql-agent-profile-revisions", durable: true },
    revision: { strategy: "card-digest-and-profile-revision" },
    recovery: { strategy: "explicit-profile-rollback" },
    ownership: { scope: OWNER_SCOPE_FIELDS, shared: false }
  },
  ...["voice-tts", "docs", "media-video"].map((id) => ({
    id,
    priority: "P1",
    treatment: "bairui-equivalent",
    defaultState: "needs_configuration",
    snapshot: { status: "needs_configuration", transport: "http" },
    command: { status: "needs_configuration", transport: "http" },
    events: { status: "needs_configuration", transport: id === "voice-tts" ? "websocket" : "sse" },
    persistence: { authority: "not-configured", durable: false },
    revision: { strategy: "not-configured" },
    recovery: { strategy: "show-needs-configuration" },
    ownership: { scope: OWNER_SCOPE_FIELDS, shared: false }
  })),
  ...["map-environment", "typhoon", "worldcup"].map((id) => ({
    id,
    priority: "deferred",
    treatment: "unsupported",
    defaultState: "unsupported",
    snapshot: { status: "unsupported", transport: "none" },
    command: { status: "unsupported", transport: "none" },
    events: { status: "unsupported", transport: "none" },
    persistence: { authority: "none", durable: false },
    revision: { strategy: "upstream-inventory-only" },
    recovery: { strategy: "show-unsupported" },
    ownership: { scope: [], shared: false }
  }))
];

export const PANEL_DEFINITIONS = Object.freeze(DEFINITIONS.map((definition) => Object.freeze(definition)));

function endpoint(agentId, panelId, suffix) {
  return `/api/user/agents/${encodeURIComponent(agentId)}/ui/panels/${encodeURIComponent(panelId)}${suffix}`;
}

const PANEL_GATEWAY_OPERATIONS = Object.freeze({
  "memory-graph": new Set(["snapshot"]),
  hotspots: new Set(["snapshot", "command", "events"]),
  "scene-shell": new Set(["snapshot", "command", "events"])
});

function stateFor(definition, facts) {
  if (definition.id === "chat") {
    if (["uninitialized", "model_unconfigured"].includes(facts.operationalCode)) return "needs_configuration";
    if (!["ready", "degraded"].includes(facts.operationalCode)) return "temporarily_unavailable";
  }
  if (definition.id === "settings" && facts.hermesManagementReady) return "available";
  if (definition.id === "social-channels" && facts.connectedChannelCount > 0) return "available";
  if (definition.id === "hotspots") {
    if (facts.hotspotRunStatus === "completed" && facts.hotspotItemCount > 0) return "available";
    if (facts.hotspotRunStatus && facts.hotspotRunStatus !== "completed") return "temporarily_unavailable";
  }
  if (definition.id === "person-card" && facts.profileConfigured) return "available";
  return definition.defaultState;
}

function operation(definition, name, agentId, state) {
  const configured = definition[name];
  const status = configured.status === "available" && state === "temporarily_unavailable"
    ? "temporarily_unavailable"
    : configured.status;
  const suffix = name === "snapshot" ? "/snapshot" : name === "command" ? "/commands" : "/events";
  return {
    status,
    transport: configured.transport,
    ...(PANEL_GATEWAY_OPERATIONS[definition.id]?.has(name)
      ? { endpoint: endpoint(agentId, definition.id, suffix) }
      : {})
  };
}

function stateReason(panelId, state, facts) {
  if (state === "available") return "ready";
  if (panelId === "chat" && facts.operationalCode === "model_unconfigured") return "model_not_configured";
  if (panelId === "chat" && facts.operationalCode === "uninitialized") return "agent_not_initialized";
  if (panelId === "settings") return "hermes_management_contract_not_ready";
  if (panelId === "social-channels") return "channel_adapter_not_connected";
  if (panelId === "hotspots" && state === "needs_configuration") return "hotspot_source_not_collected";
  if (panelId === "hotspots") return "hotspot_collection_failed";
  if (panelId === "person-card") return "character_card_not_selected";
  if (state === "unsupported") return "product_adapter_not_supported";
  return state;
}

export function panelDefinition(panelId) {
  return PANEL_DEFINITIONS.find((definition) => definition.id === panelId) ?? null;
}

export function createPanelManifest({ agentId, ownerScope, facts = {}, generatedAt = new Date().toISOString() }) {
  const normalizedFacts = {
    operationalCode: facts.operationalCode ?? "uninitialized",
    hermesManagementReady: facts.hermesManagementReady === true,
    connectedChannelCount: Math.max(0, Number(facts.connectedChannelCount) || 0),
    hotspotRunStatus: facts.hotspotRunStatus ?? null,
    hotspotItemCount: Math.max(0, Number(facts.hotspotItemCount) || 0),
    profileConfigured: facts.profileConfigured === true
  };
  const panels = PANEL_DEFINITIONS.map((definition) => {
    const state = stateFor(definition, normalizedFacts);
    return {
      id: definition.id,
      priority: definition.priority,
      treatment: definition.treatment,
      state,
      reason: stateReason(definition.id, state, normalizedFacts),
      snapshot: operation(definition, "snapshot", agentId, state),
      command: operation(definition, "command", agentId, state),
      events: operation(definition, "events", agentId, state),
      persistence: definition.persistence,
      revision: definition.revision,
      recovery: definition.recovery,
      ownership: definition.ownership
    };
  });
  const revision = createHash("sha256").update(JSON.stringify({ ownerScope, panels })).digest("hex");
  return {
    schema_version: PANEL_CONTRACT_VERSION,
    upstream: {
      repository: "xiaoyuanda666-ship-it/BaiLongma",
      version: "2.1.515",
      commit: "34d939eabe226c561550079cb810090015b49817"
    },
    owner_scope: ownerScope,
    revision,
    generated_at: generatedAt,
    panels
  };
}

export function panelUnavailable(panel, state = panel?.state ?? "unsupported") {
  const normalized = PANEL_STATES.includes(state) ? state : "unsupported";
  return {
    error: normalized,
    panel_id: panel?.id ?? null,
    state: normalized,
    reason: panel?.reason ?? normalized
  };
}
