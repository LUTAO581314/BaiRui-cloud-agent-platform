// BaiLongma scene-shell host adapter. The visual renderer remains upstream;
// transport and ownership stay in the BaiRui BFF.
import { Shell } from "/bailongma-ui/src/ui/scene-shell/shell.js";

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function applyOperation(view, operation) {
  if (operation?.path !== "/view") return view;
  if (operation.op === "replace" || operation.op === "add") return operation.value && typeof operation.value === "object" ? operation.value : view;
  return view;
}

class BairuiSceneClient {
  constructor(agentId, sceneId, shell) {
    this.agentId = agentId;
    this.sceneId = sceneId;
    this.shell = shell;
    this.revision = 0;
    this.source = null;
    this.closed = false;
  }

  endpoint(suffix = "") {
    return `/api/user/agents/${encodeURIComponent(this.agentId)}/scenes/${encodeURIComponent(this.sceneId)}${suffix}`;
  }

  render(snapshot) {
    this.revision = Number(snapshot.revision ?? snapshot.rev ?? 0);
    const view = snapshot.view ?? {};
    this.view = view;
    this.shell.applyScene({ v: 1, type: "scene", rev: this.revision, surfaces: Array.isArray(view.surfaces) ? view.surfaces : [] });
  }

  async load() {
    const response = await fetch(this.endpoint(), { credentials: "same-origin" });
    if (!response.ok) throw new Error("scene_snapshot_unavailable");
    this.render(await response.json());
  }

  connect() {
    if (this.closed) return;
    this.source?.close();
    const source = new EventSource(`${this.endpoint("/events")}?after=${encodeURIComponent(this.revision)}`);
    this.source = source;
    const onScene = (event) => { try { this.render(JSON.parse(event.data)); } catch { void this.load(); } };
    const onPatch = (event) => {
      try {
        const patch = JSON.parse(event.data);
        if (Number(patch.base_revision) !== this.revision) { void this.resync(); return; }
        for (const operation of patch.operations || []) this.view = applyOperation(this.view, operation);
        this.render({ revision: patch.revision, view: this.view });
      } catch { void this.resync(); }
    };
    source.addEventListener("scene", onScene);
    source.addEventListener("scene.patch", onPatch);
    source.onerror = () => {
      source.close();
      if (!this.closed) setTimeout(() => this.connect(), 1500);
    };
  }

  async resync() {
    await fetch(this.endpoint("/intents"), { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resync", payload: {} }) }).catch(() => undefined);
    await this.load().catch(() => undefined);
    this.connect();
  }

  async sendIntent({ surface, name, data }) {
    const payload = { surface: surface ?? null, name, data: data || {} };
    await fetch(this.endpoint("/intents"), { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "command", payload: { operation: "diagnostics.status", input: { scene_intent: payload } } }) }).catch(() => undefined);
  }

  close() { this.closed = true; this.source?.close(); }
}

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
  const shell = new Shell(stage, { onIntent: (intent) => client?.sendIntent(intent) });
  let client;
  void (async () => {
    for (let attempt = 0; attempt < 20 && !client; attempt += 1) {
      const loader = window.BairuiHostAdapter?.loadActiveAgent;
      const agent = loader ? await loader().catch(() => null) : null;
      if (agent?.id) {
        client = new BairuiSceneClient(agent.id, "main", shell);
        await client.load();
        client.connect();
        break;
      }
      await sleep(250);
    }
  })();
  return { shell, get client() { return client; } };
}
