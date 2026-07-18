// BaiLongma Scene Shell renderer with an Agent-scoped BaiRui transport.
// This module never replaces browser networking globals and never calls Hermes.
import { Shell } from "/bailongma-ui/src/ui/scene-shell/shell.js";

function applyOperation(view, operation) {
  if (operation?.path !== "/view") return view;
  if (!["replace", "add"].includes(operation.op)) return view;
  return operation.value && typeof operation.value === "object" ? operation.value : view;
}

function sceneFromSnapshot(snapshot) {
  const scene = snapshot?.data?.scene ?? snapshot?.scene ?? snapshot;
  return {
    revision: Number(scene?.revision ?? snapshot?.revision ?? 0),
    view: scene?.view ?? snapshot?.view ?? { surfaces: [] }
  };
}

export class BairuiSceneTransport extends EventTarget {
  constructor(panelId, hostAdapter) {
    super();
    this.panelId = panelId;
    this.hostAdapter = hostAdapter;
    this.revision = 0;
    this.view = { surfaces: [] };
    this.source = null;
    this.closed = false;
    this.reconnectDelay = 500;
    this.reconnectTimer = null;
    this.shell = null;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    window.dispatchEvent(new CustomEvent(`bairui:panel-${type}`, { detail: { panelId: this.panelId, ...detail } }));
  }

  render(snapshot, source = "snapshot") {
    const next = sceneFromSnapshot(snapshot);
    this.revision = next.revision;
    this.view = next.view;
    const scene = { v: 1, type: "scene", rev: this.revision, surfaces: Array.isArray(this.view.surfaces) ? this.view.surfaces : [] };
    this.shell?.applyScene(scene);
    this.emit("scene", { revision: this.revision, view: this.view, source });
    return scene;
  }

  async load() {
    const snapshot = await this.hostAdapter.panelSnapshot(this.panelId);
    this.render(snapshot, "snapshot");
    return snapshot;
  }

  connect() {
    if (this.closed) return;
    this.source?.close();
    const source = this.hostAdapter.openPanelEvents(this.panelId, this.revision);
    this.source = source;
    source.addEventListener("open", () => {
      this.reconnectDelay = 500;
      this.emit("status", { state: "open", revision: this.revision });
    });
    source.addEventListener("scene", (event) => {
      try { this.render(JSON.parse(event.data), "resync"); }
      catch { void this.resync("invalid_snapshot"); }
    });
    source.addEventListener("scene.patch", (event) => {
      try {
        const patch = JSON.parse(event.data);
        if (Number(patch.base) !== this.revision) {
          void this.resync("revision_gap");
          return;
        }
        for (const operation of patch.operations || []) this.view = applyOperation(this.view, operation);
        this.render({ revision: patch.rev, view: this.view }, "patch");
      } catch {
        void this.resync("invalid_patch");
      }
    });
    source.onerror = () => {
      source.close();
      this.emit("status", { state: "reconnecting", revision: this.revision });
      if (!this.closed && !this.reconnectTimer) {
        const delay = this.reconnectDelay;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15_000);
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, delay);
      }
    };
  }

  async command(command, payload = {}) {
    try {
      const result = await this.hostAdapter.panelCommand(this.panelId, command, payload, { baseRevision: this.revision });
      if (result.scene || result.snapshot) this.render(result.snapshot ?? result.scene, "command");
      else if (Number.isSafeInteger(result.revision)) this.revision = result.revision;
      return result;
    } catch (error) {
      if (error.status === 409 && error.body?.error === "scene_revision_conflict") await this.resync("revision_conflict");
      throw error;
    }
  }

  async resync(reason = "client_request") {
    await this.hostAdapter.panelCommand(this.panelId, "resync", { reason }, { baseRevision: this.revision }).catch(() => undefined);
    const snapshot = await this.load();
    this.source?.close();
    this.connect();
    this.emit("status", { state: "resynced", revision: this.revision, reason });
    return snapshot;
  }

  attachShell(shell) {
    if (!shell) throw new Error("scene_shell_required");
    this.shell = shell;
    this.shell.applyScene({ v: 1, type: "scene", rev: this.revision, surfaces: Array.isArray(this.view.surfaces) ? this.view.surfaces : [] });
    return this.shell;
  }

  mountShell(root) {
    if (!root) throw new Error("scene_shell_root_required");
    return this.attachShell(new Shell(root, { onIntent: (intent) => void this.command("navigate", intent).catch(() => undefined) }));
  }

  close() {
    this.closed = true;
    this.source?.close();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

async function waitForHostAdapter() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (window.BairuiHostAdapter && window.bairuiPlatform) return window.BairuiHostAdapter;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("bairui_host_adapter_unavailable");
}

let panelTransportPromise = null;

export function bootstrapPanelTransport() {
  if (window.BairuiPanelTransport) return Promise.resolve(window.BairuiPanelTransport);
  if (!panelTransportPromise) panelTransportPromise = (async () => {
    const hostAdapter = await waitForHostAdapter();
    const manifest = await hostAdapter.loadPanelManifest();
    const clients = new Map();
    for (const panel of manifest.panels || []) {
      if (panel.priority !== "P0" || panel.snapshot?.status !== "available" || !panel.snapshot.endpoint || panel.events?.status !== "available" || panel.events.transport !== "sse" || !panel.events.endpoint) continue;
      const client = new BairuiSceneTransport(panel.id, hostAdapter);
      await client.load();
      client.connect();
      clients.set(panel.id, client);
    }
    const api = Object.freeze({
      manifest,
      clients,
      client(panelId) { return clients.get(panelId) ?? null; },
      async command(panelId, command, payload = {}) {
        const client = clients.get(panelId);
        return client ? client.command(command, payload) : hostAdapter.panelCommand(panelId, command, payload);
      },
      async resync(panelId, reason) {
        const client = clients.get(panelId);
        if (!client) throw new Error("panel_event_transport_unavailable");
        return client.resync(reason);
      },
      close() { for (const client of clients.values()) client.close(); }
    });
    Object.defineProperty(window, "BairuiPanelTransport", { value: api, writable: false, configurable: false, enumerable: false });
    window.dispatchEvent(new CustomEvent("bairui:panel-transport-ready", { detail: { panelIds: [...clients.keys()] } }));
    return api;
  })();
  return panelTransportPromise;
}

// Preserve BaiLongma's native module contract while replacing only its transport.
export function bootstrapScene() {
  let stage = document.getElementById("stage");
  if (!stage) {
    stage = document.createElement("div");
    stage.id = "stage";
    document.body.appendChild(stage);
  }
  if (!document.getElementById("scene-shell-css")) {
    const link = document.createElement("link");
    link.id = "scene-shell-css";
    link.rel = "stylesheet";
    link.href = "/bailongma-ui/src/ui/scene-shell/styles.css";
    document.head.appendChild(link);
  }
  let client = null;
  const shell = new Shell(stage, { onIntent: (intent) => void client?.command("navigate", intent).catch(() => undefined) });
  void bootstrapPanelTransport().then((transport) => {
    client = transport.client("scene-shell");
    if (!client) throw new Error("scene_shell_transport_unavailable");
    client.attachShell(shell);
  }).catch((error) => {
    window.dispatchEvent(new CustomEvent("bairui:panel-transport-error", { detail: { code: error.message || "scene_shell_bootstrap_failed" } }));
  });
  return { shell, get client() { return client; } };
}

void bootstrapPanelTransport().catch((error) => {
  window.dispatchEvent(new CustomEvent("bairui:panel-transport-error", { detail: { code: error.message || "panel_transport_failed" } }));
});
