import fs from "node:fs";
import { createHash, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPlatformServer } from "../../apps/web/app.mjs";
import { ROLES } from "../../packages/auth/authorization.mjs";
import { hashPassword } from "../../packages/auth/password.mjs";
import { createTestBailongmaUi } from "../helpers/bailongma-ui.mjs";
import { MemoryPlatformRepository } from "../../packages/db/memory-repository.mjs";
import { createObsidianNote } from "../../packages/memory/obsidian-note.mjs";
import { SecretEnvelope } from "../../packages/security/secret-envelope.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const publicRoot = path.join(root, "apps", "web", "public");
const adminRoot = path.join(root, "apps", "web", "admin");

export const fixtureCredentials = Object.freeze({
  user: { email: "owner@example.test", password: "Remote-Owner-Password-2026" },
  admin: { email: "admin@example.test", password: "Remote-Admin-Password-2026" }
});

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function projectedEntries(entries = []) {
  return entries.map((entry) => ({ ...entry, sha256: sha256(entry.content) }));
}

function createRuntimeFixture() {
  const now = "2026-07-16T08:00:00.000Z";
  const sessions = [{ id: "session_remote", title: "Remote acceptance", model: "fixture/hermes", created_at: now, updated_at: now }];
  const messages = new Map([["session_remote", [
    { id: "message_welcome", role: "assistant", content: "Hermes Runtime is ready.", timestamp: now }
  ]]]);
  const jobs = [{ id: "job_remote", name: "Daily research", schedule: "0 9 * * *", prompt: "Summarize project updates", deliver: "local", enabled: true, repeat: null, skills: ["browser/use"], next_run_at: now }];
  let projection = { memory: [], user: [] };
  let digest = sha256(JSON.stringify(projection));
  const operations = [];
  const pendingRuns = new Map();
  const encoder = new TextEncoder();

  const emitRunEvent = (runId, event, data) => {
    const pending = pendingRuns.get(runId);
    if (!pending) return false;
    try {
      const frame = ["event: ", event, "\ndata: ", JSON.stringify(data), "\n\n"].join("");
      pending.controller.enqueue(encoder.encode(frame));
      return true;
    } catch {
      pendingRuns.delete(runId);
      return false;
    }
  };

  const closeRun = (runId) => {
    const pending = pendingRuns.get(runId);
    pendingRuns.delete(runId);
    try { pending?.controller.close(); } catch {}
  };

  const operation = async ({ operation: name, input = {} }) => {
    operations.push({ operation: name, input: structuredClone(input) });
    if (name === "runs.approve") {
      const runId = input.run_id;
      if (input.choice === "deny") {
        emitRunEvent(runId, "run.cancelled", { run_id: runId, reason: "approval_denied" });
      } else {
        emitRunEvent(runId, "assistant.delta", { delta: "Approved fixture reply" });
        emitRunEvent(runId, "assistant.completed", { message_id: "message_approval_remote", content: "Approved fixture reply" });
        emitRunEvent(runId, "run.completed", { run_id: runId, usage: { input_tokens: 4, output_tokens: 4 } });
      }
      closeRun(runId);
      return { run_id: runId, status: input.choice === "deny" ? "cancelled" : "running", choice: input.choice };
    }
    if (name === "runs.stop") {
      const runId = input.run_id;
      emitRunEvent(runId, "run.cancelled", { run_id: runId, reason: "user_requested" });
      closeRun(runId);
      return { run_id: runId, status: "stopping" };
    }
    if (name === "health.detailed") return { status: "healthy", runtime: "hermes", version: "fixture-hermes-1.0.0", gateway_state: "running", active_agents: 1 };
    if (name === "discovery.models") return { object: "list", data: [{ id: "fixture/hermes", name: "Hermes Fixture" }] };
    if (name === "discovery.capabilities") return { object: "hermes.api_server.capabilities", features: { session_resources: true, run_events_sse: true, approval_events: true, skills_api: true, audio_api: false } };
    if (name === "discovery.skills") return { object: "list", data: [{ id: "browser/use", name: "Browser", description: "Use the browser", category: "tools", version: "1.0.0" }, { id: "memory/search", name: "Memory search", description: "Search memory", category: "memory", version: "1.0.0" }] };
    if (name === "discovery.toolsets") return { object: "list", platform: "api_server", data: [{ name: "web", label: "Web tools", description: "Browser and search", enabled: true, configured: true, tools: ["browser", "web_search"] }] };
    if (name === "sessions.list") return { object: "list", data: sessions };
    if (name === "sessions.messages") return { object: "list", data: messages.get(input.session_id) ?? [] };
    if (name === "sessions.create") {
      const session = { id: `session_${sessions.length + 1}`, title: input.body?.title || "New session", model: input.body?.model || "fixture/hermes", created_at: now, updated_at: now };
      sessions.unshift(session);
      messages.set(session.id, []);
      return { session };
    }
    if (name === "sessions.update") {
      const session = sessions.find((item) => item.id === input.session_id);
      if (session && input.body?.title) session.title = input.body.title;
      return { session };
    }
    if (name === "sessions.fork") {
      const session = { id: `session_${sessions.length + 1}`, title: input.body?.title || "Forked session", model: "fixture/hermes", created_at: now, updated_at: now };
      sessions.unshift(session);
      messages.set(session.id, [...(messages.get(input.session_id) ?? [])]);
      return { session };
    }
    if (name === "sessions.get") return { session: sessions.find((item) => item.id === input.session_id) ?? null };
    if (name === "sessions.delete") {
      const index = sessions.findIndex((item) => item.id === input.session_id);
      if (index >= 0) sessions.splice(index, 1);
      messages.delete(input.session_id);
      return { deleted: true };
    }
    if (name === "jobs.list") return { jobs };
    if (name === "jobs.get") return { job: jobs.find((item) => item.id === input.job_id) ?? null };
    if (name === "jobs.update") {
      const job = jobs.find((item) => item.id === input.job_id);
      if (job) Object.assign(job, input.body);
      return { job };
    }
    if (name === "jobs.create") {
      const job = { id: `job_${jobs.length + 1}`, enabled: true, ...input.body };
      jobs.push(job);
      return { job };
    }
    if (name === "jobs.pause" || name === "jobs.resume") {
      const job = jobs.find((item) => item.id === input.job_id);
      if (job) job.enabled = name === "jobs.resume";
      return { job };
    }
    if (name === "jobs.delete") {
      const index = jobs.findIndex((item) => item.id === input.job_id);
      if (index >= 0) jobs.splice(index, 1);
      return { ok: true };
    }
    if (name === "jobs.run") return { status: "started" };
    if (name === "memory.snapshot") {
      return {
        schema_version: "2.0",
        digest,
        projection,
        memory: { entries: projectedEntries(projection.memory) },
        user: { entries: projectedEntries(projection.user) }
      };
    }
    if (name === "memory.apply") {
      if (input.expected_digest !== digest) throw Object.assign(new Error("Memory changed"), { code: "memory_projection_conflict", statusCode: 409 });
      projection = {
        memory: projectedEntries(input.projection?.memory?.entries),
        user: projectedEntries(input.projection?.user?.entries)
      };
      digest = sha256(JSON.stringify(projection));
      return {
        digest,
        memory: { char_count: input.projection?.memory?.char_count ?? 0 },
        user: { char_count: input.projection?.user?.char_count ?? 0 }
      };
    }
    return { ok: true, object: "list", data: [] };
  };

  return {
    operations,
    operation,
    async invokeIntegration({ integrationId, capability, input = {} }) {
      operations.push({ operation: `integration:${integrationId}.${capability}`, input: structuredClone(input) });
      if (integrationId !== "trendradar" || capability !== "list_hotspots") {
        return { status: "unsupported", output: { items: [], sources: [] }, completed_at: new Date().toISOString() };
      }
      return {
        status: "completed",
        output: {
          sources: input.sources?.length ? input.sources : ["weibo"],
          items: [{
            external_id: "fixture-hotspot-1",
            source_id: "weibo",
            source_name: "微博",
            rank: 1,
            title: "U01-05 真实链路热点",
            url: "https://example.test/hotspots/u01-05",
            heat: "1000",
            category: "technology",
            fetched_at: "2026-07-18T12:00:00.000Z"
          }]
        },
        completed_at: "2026-07-18T12:00:00.000Z"
      };
    },
    async streamOperation({ operation: name, input = {} }) {
      operations.push({ operation: name, input: structuredClone(input) });
      if (name !== "sessions.chat.stream") return new Response("", { headers: { "content-type": "text/event-stream" } });
      const messageText = typeof input.body?.message === "string" ? input.body.message : JSON.stringify(input.body?.message ?? "");
      if (messageText.includes("Approval fixture request")) {
        const runId = "run_approval_remote";
        const body = new ReadableStream({
          start(controller) {
            pendingRuns.set(runId, { controller });
            emitRunEvent(runId, "run.started", { run_id: runId, user_message: { content: input.body?.message } });
            emitRunEvent(runId, "message.started", { message_id: "message_approval_remote" });
            emitRunEvent(runId, "approval.request", {
              run_id: runId,
              command: "echo approval-fixture",
              description: "The browser fixture requests a protected operation.",
              allow_permanent: false,
              choices: ["once", "session", "always", "deny"]
            });
          },
          cancel() { pendingRuns.delete(runId); }
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
      }
      if (messageText.includes("Stop fixture request")) {
        const runId = "run_stop_remote";
        const body = new ReadableStream({
          start(controller) {
            pendingRuns.set(runId, { controller });
            setTimeout(() => {
              if (!pendingRuns.has(runId)) return;
              emitRunEvent(runId, "run.started", { run_id: runId, user_message: { content: input.body?.message } });
              emitRunEvent(runId, "message.started", { message_id: "message_stop_remote" });
              emitRunEvent(runId, "assistant.delta", { delta: "Long running fixture" });
            }, 250);
          },
          cancel() { pendingRuns.delete(runId); }
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
      }
      const sessionMessages = messages.get(input.session_id) ?? [];
      sessionMessages.push({ id: "message_user_remote", role: "user", content: input.body?.message, timestamp: now });
      sessionMessages.push({ id: "message_assistant_remote", role: "assistant", content: "Remote acceptance reply", timestamp: now });
      messages.set(input.session_id, sessionMessages);
      const events = [
        ["run.started", { run_id: "run_remote", user_message: { content: input.body?.message } }],
        ["message.started", { message_id: "message_assistant_remote" }],
        ["assistant.delta", { delta: "Remote acceptance reply" }],
        ["assistant.completed", { message_id: "message_assistant_remote", content: "Remote acceptance reply" }],
        ["run.completed", { run_id: "run_remote", usage: { input_tokens: 3, output_tokens: 3 } }]
      ];
      const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
    }
  };
}

export async function startBrowserFixture() {
  const repository = new MemoryPlatformRepository();
  const organization = await repository.createOrganization({ id: "org_remote", name: "Remote Acceptance" });
  const ownerHash = await hashPassword(fixtureCredentials.user.password);
  const adminHash = await hashPassword(fixtureCredentials.admin.password);
  const owner = await repository.createUser({ id: "user_remote", organizationId: organization.id, email: fixtureCredentials.user.email, displayName: "Remote Owner", passwordHash: ownerHash, role: ROLES.USER });
  await repository.createUser({ id: "peer_remote", organizationId: organization.id, email: "peer@example.test", displayName: "Remote Peer", passwordHash: ownerHash, role: ROLES.USER });
  const admin = await repository.createUser({ id: "admin_remote", organizationId: organization.id, email: fixtureCredentials.admin.email, displayName: "Remote Administrator", passwordHash: adminHash, role: ROLES.PLATFORM_ADMIN });
  const ownerAgent = await repository.createAgent({ id: "agent_remote", organizationId: organization.id, ownerUserId: owner.id, name: "Hermes Memory Agent", description: "BaiLongma remote acceptance Agent", settings: { preferredModel: "fixture/hermes", locale: "zh-CN", notifications: true } });
  const adminAgent = await repository.createAgent({ id: "agent_admin", organizationId: organization.id, ownerUserId: admin.id, name: "Administrator Agent", settings: { preferredModel: "fixture/hermes" } });
  const ownerRuntime = await repository.createAgentRuntime({ id: "runtime_remote", organizationId: organization.id, ownerUserId: owner.id, agentId: ownerAgent.id, workspaceRef: "hermes:org_remote:user_remote:agent_remote" });
  const adminRuntime = await repository.createAgentRuntime({ id: "runtime_admin", organizationId: organization.id, ownerUserId: admin.id, agentId: adminAgent.id, workspaceRef: "hermes:org_remote:admin_remote:agent_admin" });
  const observedAt = new Date().toISOString();
  for (const [agent, runtime, userId] of [[ownerAgent, ownerRuntime, owner.id], [adminAgent, adminRuntime, admin.id]]) {
    await repository.saveAgentHeartbeat({ organizationId: organization.id, userId, agentId: agent.id, runtimeId: runtime.id, sequence: 1, status: "healthy", runtimeVersion: "fixture-hermes-1.0.0", boundaryVersion: "fixture-boundary-1.0.0", observedAt, components: [{ moduleId: "hermes", layer: "core-runtime", status: "healthy", version: "fixture-hermes-1.0.0", metrics: { latency_ms: 12 } }], usage: { bucketStart: observedAt, bucketSeconds: 3600, model: "fixture/hermes", inputTokens: 120, outputTokens: 80, estimatedCostUsd: 0.02, runCount: 3, failedRunCount: 0, latencySumMs: 36 } });
  }

  const providerVault = new SecretEnvelope("remote-browser-provider-key-at-least-32-characters");
  await repository.upsertProviderConfiguration({ organizationId: organization.id, provider: "compatible", baseUrl: "https://models.example.test/v1", model: "fixture/hermes", apiKeyEnvelope: providerVault.seal("fixture-provider-key"), keyHint: "test", updatedBy: admin.id });
  await repository.upsertModelPolicy({ organizationId: organization.id, allowedModels: ["fixture/hermes"], defaultModel: "fixture/hermes", userCustomKeysAllowed: true, updatedBy: admin.id });
  const note = createObsidianNote({ title: "Hermes memory mapping", body: "PostgreSQL stores the canonical Obsidian note. See [[Runtime Boundary]].", tags: ["architecture", "memory"], wikilinks: ["Runtime Boundary"], memoryKind: "project", importance: 5, hermesTarget: "memory" });
  await repository.createObsidianNote({ id: "note_remote", ...note, organizationId: organization.id, userId: owner.id, agentId: ownerAgent.id });
  const linked = createObsidianNote({ title: "Runtime Boundary", body: "Hermes receives a bounded projection through signed memory operations.", tags: ["hermes"], memoryKind: "knowledge", importance: 4, hermesTarget: "memory" });
  await repository.createObsidianNote({ id: "note_boundary", ...linked, organizationId: organization.id, userId: owner.id, agentId: ownerAgent.id });

  const { privateKey } = generateKeyPairSync("ed25519");
  const runtimeFixture = createRuntimeFixture();
  const server = createPlatformServer({
    repository,
    runtimeClient: runtimeFixture,
    sessionSecret: "remote-browser-session-secret-at-least-32-characters",
    secureCookies: false,
    providerVault,
    licensePrivateKey: privateKey,
    styles: fs.readFileSync(path.join(publicRoot, "styles.css"), "utf8"),
    logo: fs.readFileSync(path.join(publicRoot, "bairui-agent-logo.png")),
    icon: fs.readFileSync(path.join(publicRoot, "bairui-agent-icon.png")),
    loginScript: fs.readFileSync(path.join(publicRoot, "login.js"), "utf8"),
    adminScript: fs.readFileSync(path.join(adminRoot, "admin.js"), "utf8"),
    bailongmaUi: createTestBailongmaUi(),
    bailongmaOverlayCss: fs.readFileSync(path.join(publicRoot, "bairui-bailongma.css"), "utf8"),
    bailongmaOverlayScript: fs.readFileSync(path.join(publicRoot, "bairui-bailongma.js"), "utf8"),
    bairuiWorkspaceScript: fs.readFileSync(path.join(publicRoot, "bairui-workspace.js"), "utf8"),
    bairuiWorkspaceConversationsScript: fs.readFileSync(path.join(publicRoot, "bairui-workspace-conversations.js"), "utf8"),
    bairuiWorkspaceAgentsScript: fs.readFileSync(path.join(publicRoot, "bairui-workspace-agents.js"), "utf8"),
    bairuiWorkspaceChannelsScript: fs.readFileSync(path.join(publicRoot, "bairui-workspace-channels.js"), "utf8"),
    bairuiWorkspaceHotspotsScript: fs.readFileSync(path.join(publicRoot, "bairui-workspace-hotspots.js"), "utf8"),
    bairuiWorkspaceUsageScript: fs.readFileSync(path.join(publicRoot, "bairui-workspace-usage.js"), "utf8"),
    bairuiWorkspaceMemoryScript: fs.readFileSync(path.join(publicRoot, "bairui-workspace-memory.js"), "utf8"),
    bairuiWorkspaceSkillsScript: fs.readFileSync(path.join(publicRoot, "bairui-workspace-skills.js"), "utf8"),
    bairuiWorkspaceRunsScript: fs.readFileSync(path.join(publicRoot, "bairui-workspace-runs.js"), "utf8"),
    bairuiWorkspaceJobsScript: fs.readFileSync(path.join(publicRoot, "bairui-workspace-jobs.js"), "utf8"),
    bairuiWorkspaceHermesScript: fs.readFileSync(path.join(publicRoot, "bairui-workspace-hermes.js"), "utf8"),
    bairuiWorkspaceSettingsScript: fs.readFileSync(path.join(publicRoot, "bairui-workspace-settings.js"), "utf8"),
    bailongmaSceneBootstrap: fs.readFileSync(path.join(publicRoot, "bairui-scene-bootstrap.js"), "utf8"),
    logger: { error(error) { process.stderr.write(`[fixture] ${error?.stack || error}\n`); } }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    repository,
    runtimeOperations: runtimeFixture.operations,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}
