import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresPlatformRepository } from "../packages/db/postgres-repository.mjs";

test("PostgreSQL reuses an approved configuration when failed provisioning is retried", { skip: process.env.BAIRUI_POSTGRES_INTEGRATION !== "1" }, async () => {
  const repository = new PostgresPlatformRepository({ connectionString: process.env.DATABASE_URL });
  const suffix = randomUUID().slice(0, 8);
  const organizationId = `org_retry_${suffix}`;
  const userId = `user_retry_${suffix}`;
  const agentId = `agent_retry_${suffix}`;
  const serverId = `server_retry_${suffix}`;
  const request = {
    agentId,
    requestedBy: userId,
    provider: { provider: "compatible", baseUrl: "https://models.example.test/v1", model: "example/model" },
    secretEnvelope: { providerApiKey: { encrypted: true }, runtimeSharedSecret: { generation: 1 }, hermesApiServerKey: { generation: 1 }, agentControlToken: { generation: 1 } },
    agentCredentialHash: "d".repeat(64),
    agentCredentialHint: "test"
  };
  try {
    await repository.createOrganization({ id: organizationId, name: "Retry" });
    await repository.createUser({ id: userId, organizationId, email: `${suffix}@retry.test`, displayName: "Retry", passwordHash: "not-used", role: "user" });
    await repository.createAgent({ id: agentId, organizationId, ownerUserId: userId, name: "Retry Agent" });
    await repository.createAgentRuntime({ organizationId, ownerUserId: userId, agentId, workspaceRef: `workspace:${agentId}` });
    await repository.createServer({ id: serverId, organizationId, name: "Retry Host", status: "healthy" });
    const first = await repository.requestAgentProvisioning(request);
    const [leased] = await repository.leaseControlCommands({ serverId, limit: 1, leaseSeconds: 120 });
    await repository.recordCommandReceipt({ commandId: leased.command_id, serverId, attempt: leased.attempt, state: "accepted" });
    await repository.recordCommandReceipt({ commandId: leased.command_id, serverId, attempt: leased.attempt, state: "running" });
    await repository.recordCommandReceipt({ commandId: leased.command_id, serverId, attempt: leased.attempt, state: "failed", errorCode: "docker_unavailable", errorSummary: "Control executor failed (docker_unavailable)" });
    const retry = await repository.requestAgentProvisioning({ ...request, secretEnvelope: { ...request.secretEnvelope, agentControlToken: { generation: 2 } }, agentCredentialHash: "e".repeat(64) });
    assert.notEqual(retry.command.id, first.command.id);
    assert.equal(retry.command.arguments.config_revision_id, first.command.arguments.config_revision_id);
    const deployments = await repository.pool.query("SELECT status,desired_state_version FROM control_deployments WHERE agent_id=$1 ORDER BY created_at", [agentId]);
    assert.deepEqual(deployments.rows, [{ status: "enrolling", desired_state_version: "2" }]);
  } finally {
    await repository.pool.query("DELETE FROM organizations WHERE id=$1", [organizationId]).catch(() => {});
    await repository.close();
  }
});

test("PostgreSQL leases and completes an Agent provision transaction", { skip: process.env.BAIRUI_POSTGRES_INTEGRATION !== "1" }, async () => {
  const repository = new PostgresPlatformRepository({ connectionString: process.env.DATABASE_URL });
  const suffix = randomUUID().slice(0, 8);
  const organizationId = `org_pg_${suffix}`;
  const userId = `user_pg_${suffix}`;
  const agentId = `agent_pg_${suffix}`;
  const runtimeId = `runtime_pg_${suffix}`;
  const serverId = `server_pg_${suffix}`;
  try {
    await repository.createOrganization({ id: organizationId, name: "PostgreSQL Control Test" });
    await repository.createUser({ id: userId, organizationId, email: `${suffix}@postgres.test`, displayName: "Postgres User", passwordHash: "not-used", role: "user" });
    await repository.createAgent({ id: agentId, organizationId, ownerUserId: userId, name: "Postgres Agent" });
    await repository.createAgentRuntime({ id: runtimeId, organizationId, ownerUserId: userId, agentId, workspaceRef: `workspace:${agentId}` });
    await repository.createServer({ id: serverId, organizationId, name: "Postgres Host", status: "healthy" });
    await repository.createServerCredential({ id: `server_cred_${suffix}`, serverId, keyHash: "a".repeat(64), keyHint: "test", createdBy: userId });
    assert.equal(await repository.claimMachineNonce({ credentialType: "server", credentialId: `server_cred_${suffix}`, nonce: `nonce_${suffix}_1234567890`, timestampMs: Date.now(), expiresAt: new Date(Date.now() + 600_000).toISOString() }), true);
    assert.equal(await repository.claimMachineNonce({ credentialType: "server", credentialId: `server_cred_${suffix}`, nonce: `nonce_${suffix}_1234567890`, timestampMs: Date.now(), expiresAt: new Date(Date.now() + 600_000).toISOString() }), false);
    const provision = await repository.requestAgentProvisioning({ agentId, requestedBy: userId, provider: { provider: "compatible", baseUrl: "https://models.example.test/v1", model: "example/model" }, secretEnvelope: { providerApiKey: { encrypted: true }, runtimeSharedSecret: { encrypted: true }, hermesApiServerKey: { encrypted: true }, agentControlToken: { encrypted: true } }, agentCredentialHash: "b".repeat(64), agentCredentialHint: "test" });
    assert.equal(provision.command.action, "deployment.provision");
    const commands = await repository.leaseControlCommands({ serverId, limit: 5, leaseSeconds: 120 });
    assert.equal(commands.length, 1);
    assert.equal(commands[0].config.document.agent.id, agentId);
    assert.deepEqual(commands[0].config.secret_envelope.runtimeSharedSecret, { encrypted: true });
    const receipt = { commandId: commands[0].command_id, serverId, attempt: commands[0].attempt };
    await repository.recordCommandReceipt({ ...receipt, state: "accepted" });
    await repository.recordCommandReceipt({ ...receipt, state: "running" });
    await repository.recordCommandReceipt({ ...receipt, state: "succeeded", runtimeEndpointRef: "http://127.0.0.1:19123", resultSummary: { containers: 2 } });
    const route = await repository.getAgentRuntimeRoute(agentId);
    assert.equal(route.runtime.endpointRef, "http://127.0.0.1:19123");
    assert.equal(route.runtime.status, "starting");

    const lifecycle = await repository.requestAgentLifecycle({ agentId, request: "pause", requestedBy: userId });
    assert.equal(lifecycle.action, "deployment.suspend");
    const [lifecycleCommand] = await repository.leaseControlCommands({ serverId, limit: 5, leaseSeconds: 120 });
    assert.equal(lifecycleCommand.action, "deployment.suspend");
    const lifecycleReceipt = { commandId: lifecycleCommand.command_id, serverId, attempt: lifecycleCommand.attempt };
    await repository.recordCommandReceipt({ ...lifecycleReceipt, state: "accepted" });
    await repository.recordCommandReceipt({ ...lifecycleReceipt, state: "running" });
    await repository.recordCommandReceipt({ ...lifecycleReceipt, state: "succeeded" });
    assert.equal((await repository.getAgentRuntimeByAgent(agentId)).status, "suspended");

    const note = await repository.createObsidianNote({ id: `note_${suffix}`, organizationId, userId, agentId, title: "PostgreSQL note", slug: "postgresql-note", markdown: "# PostgreSQL note", frontmatter: { tags: [] }, wikilinks: [] });
    assert.equal(note.agentId, agentId);
    const queuedProjection = await repository.getMemoryProjectionStatus(organizationId, userId, agentId);
    assert.equal(queuedProjection.state, "pending");
    assert.equal((await repository.listObsidianNotes(organizationId, userId, agentId, "PostgreSQL")).length, 1);
    await repository.updateObsidianNote({ ...note, markdown: "# PostgreSQL note\n\nUpdated" });
    assert.match((await repository.getObsidianNote(organizationId, userId, agentId, note.id)).markdown, /Updated/);
    assert.equal((await repository.getMemoryProjectionStatus(organizationId, userId, agentId)).id, queuedProjection.id);
    const [projectionLease] = await repository.leaseMemoryProjectionJobs({ limit: 1, leaseSeconds: 30 });
    assert.equal(projectionLease.agentId, agentId);
    assert.equal((await repository.completeMemoryProjectionJob({ id: projectionLease.id, leaseToken: projectionLease.leaseToken, resultSummary: { status: "materialized" } })).state, "completed");

    const skill = await repository.upsertAgentSkillPreference({ organizationId, userId, agentId, skillId: "browser/use", enabled: true, applyStatus: "pending" });
    assert.equal(skill.applyStatus, "pending");
    assert.equal((await repository.listAgentSkillPreferences(organizationId, userId, agentId)).length, 1);
    const skillApplication = await repository.requestAgentSkillConfiguration({ organizationId, userId, agentId, requestedBy: userId });
    assert.equal(skillApplication.command.action, "config.apply-user");
    const [skillCommand] = await repository.leaseControlCommands({ serverId, limit: 5, leaseSeconds: 120 });
    assert.equal(skillCommand.approval_id, undefined);
    assert.equal(skillCommand.config.secret_envelope, undefined);
    assert.equal(skillCommand.config.document.owner_change.scope, "skills");
    const skillReceipt = { commandId: skillCommand.command_id, serverId, attempt: skillCommand.attempt };
    await repository.recordCommandReceipt({ ...skillReceipt, state: "accepted" });
    await repository.recordCommandReceipt({ ...skillReceipt, state: "running" });
    await repository.recordCommandReceipt({ ...skillReceipt, state: "succeeded" });
    assert.equal((await repository.listAgentSkillPreferences(organizationId, userId, agentId))[0].applyStatus, "applied");

    const channel = await repository.upsertAgentChannelBinding({ organizationId, userId, agentId, channel: "feishu", displayName: "Postgres Feishu", status: "pending", credentialEnvelope: { encrypted: true }, credentialHint: "test" });
    assert.deepEqual(channel.credentialEnvelope, { encrypted: true });
    assert.equal(channel.connectionGeneration, 1);
    assert.equal((await repository.listAgentChannelBindings(organizationId, userId, agentId)).length, 1);
    const channelWorker = await repository.createChannelWorkerCredential({ id: `channel_worker_cred_${suffix}`, workerId: `channel_worker_${suffix}`, organizationId, allowedChannels: ["feishu"], keyHash: "c".repeat(64), keyHint: "test", createdBy: userId });
    assert.equal((await repository.getActiveChannelWorkerCredential(channelWorker.workerId)).organizationId, organizationId);
    assert.equal(await repository.claimMachineNonce({ credentialType: "channel-worker", credentialId: channelWorker.id, nonce: `channel_nonce_${suffix}_1234567890`, timestampMs: Date.now(), expiresAt: new Date(Date.now() + 600_000).toISOString() }), true);
    assert.deepEqual((await repository.listChannelBindingsForWorker({ organizationId, allowedChannels: ["feishu"], channels: ["feishu", "qq"] })).map((item) => item.id), [channel.id]);
    const channelReceivedAt = new Date().toISOString();
    const ingressInput = { id: `channel_in_${suffix}`, bindingId: channel.id, agentId, channel: "feishu", channelAccountId: `app_${suffix}`, externalMessageId: `message_${suffix}`, sender: { channel_user_id: `sender_${suffix}` }, conversation: { channel_conversation_id: `conversation_${suffix}`, kind: "group" }, content: { kind: "text", text: "PostgreSQL channel ingress" }, attachments: [], trace: { correlation_id: `channel_trace_${suffix}` }, receivedAt: channelReceivedAt };
    assert.equal((await repository.acceptChannelIngress(ingressInput)).status, "accepted");
    assert.equal((await repository.acceptChannelIngress(ingressInput)).status, "duplicate");
    const [channelJob] = await repository.leaseChannelIngress({ limit: 1, leaseSeconds: 30, leaseId: `channel_in_lease_${suffix}` });
    assert.equal(channelJob.id, ingressInput.id);
    const channelConversation = await repository.ensureChannelConversation({ organizationId, userId, agentId, bindingId: channel.id, channel: "feishu", channelConversationId: ingressInput.conversation.channel_conversation_id, conversationKind: "group", runtimeConversationId: `runtime_conversation_${suffix}` });
    assert.equal(channelConversation.runtimeConversationId, `runtime_conversation_${suffix}`);
    const channelCompletion = await repository.completeChannelIngress({ id: channelJob.id, leaseToken: channelJob.leaseToken, outbound: { id: `channel_out_${suffix}`, content: { kind: "text", text: "PostgreSQL channel reply" } } });
    assert.equal(channelCompletion.outbound.state, "pending");
    const channelDelivery = (await repository.leaseChannelDeliveries({ agentId, workerId: `worker_${suffix}`, channels: ["feishu"], limit: 1, leaseSeconds: 30, leaseId: `channel_out_lease_${suffix}` })).deliveries[0];
    assert.equal(channelDelivery.id, channelCompletion.outbound.id);
    const channelReceipt = await repository.recordChannelDeliveryReceipt({ outboundId: channelDelivery.id, bindingId: channel.id, agentId, workerId: `worker_${suffix}`, leaseToken: channelDelivery.leaseToken, attempt: channelDelivery.attempts, status: "delivered", channelMessageId: `vendor_message_${suffix}`, observedAt: new Date().toISOString() });
    assert.equal(channelReceipt.outbound.state, "delivered");
    const channelHealth = await repository.saveChannelHealthReport({ bindingId: channel.id, agentId, channel: "feishu", workerId: `worker_${suffix}`, sequence: 1, status: "connected", capabilities: ["receive", "send", "websocket"], adapterVersion: "test", observedAt: new Date().toISOString() });
    assert.equal(channelHealth.binding.status, "connected");

    const agentRun = await repository.createAgentRun({ id: `run_${suffix}`, organizationId, userId, agentId, inputText: "PostgreSQL runtime history", model: "example/model", status: "started" });
    assert.equal(agentRun.status, "started");
    await repository.updateAgentRun({ id: agentRun.id, organizationId, userId, agentId, status: "failed", lastError: "test failure", completedAt: new Date().toISOString() });
    assert.equal((await repository.getAgentRun(organizationId, userId, agentId, agentRun.id)).lastError, "test failure");
    assert.equal((await repository.listAgentRuns(organizationId, userId, agentId)).length, 1);

    await repository.saveIntegrationResult({ organizationId, integrationId: "trendradar", capability: "list_hotspots", status: "completed", startedAt: new Date().toISOString(), items: [{ external_id: "one", source_id: "test", source_name: "Test", rank: 1, title: "Hotspot", fetched_at: new Date().toISOString() }] });
    const hotspot = (await repository.listLatestHotspots(organizationId)).items[0];
    assert.equal(await repository.setAgentHotspotBookmark({ organizationId, userId, agentId, hotspotItemId: hotspot.id, bookmarked: true }), true);
    assert.deepEqual(await repository.listAgentHotspotBookmarkIds(organizationId, userId, agentId), [hotspot.id]);

    await repository.saveAgentHeartbeat({ organizationId, userId, agentId, runtimeId, sequence: 1, status: "healthy", observedAt: new Date().toISOString(), components: [{ layer: "core-runtime", moduleId: "hermes", status: "healthy", capabilities: ["sessions", "runs"], metrics: { active_runs: 0 } }], usage: { bucketStart: "2026-07-16T00:00:00.000Z", bucketSeconds: 3600, model: "example/model", inputTokens: 3, outputTokens: 4, runCount: 1 } });
    const usage = await repository.listUsageRollups(organizationId, userId, agentId);
    assert.equal(usage[0].inputTokens, 3);
    assert.deepEqual((await repository.listAgentComponents(organizationId, agentId))[0].capabilities, ["sessions", "runs"]);
    await repository.saveAgentResourceSamples({ serverId, samples: [{ agentId, runtimeId, deploymentId: provision.deployment.id, sequence: 1, status: "running", cpuPercent: 4.2, memoryUsedBytes: 1024, memoryLimitBytes: 4096, agentStorageUsedBytes: 2048, hostStorageUsedBytes: 8192, hostStorageLimitBytes: 16384, osType: "linux", architecture: "amd64", operatingSystem: "PostgreSQL Test Linux", dockerVersion: "27.1.0", cpuCount: 4, startedAt: "2026-07-16T00:00:00.000Z", uptimeSeconds: 3600, observedAt: new Date().toISOString(), containers: [{ role: "hermes", status: "running", containerId: "container_pg", containerName: "bairui-hermes-pg", imageRef: "hermes:test", version: "1.0.0", cpuPercent: 4.2, memoryUsedBytes: 1024, memoryLimitBytes: 4096, writableBytes: 512, startedAt: "2026-07-16T00:00:00.000Z" }] }] });
    const latestResource = (await repository.latestAgentResourceSamples(organizationId, agentId))[0];
    assert.equal(latestResource.cpuPercent, 4.2);
    assert.equal(latestResource.containers[0].role, "hermes");
    const highResource = { ...latestResource, sequence: 2, cpuPercent: 390, memoryUsedBytes: 3900, hostStorageUsedBytes: 16000, observedAt: new Date().toISOString(), containers: [] };
    await repository.saveAgentResourceSamples({ serverId, samples: [highResource] });
    assert.equal((await repository.listAlerts(organizationId)).filter((item) => item.code.startsWith("resource.") && item.status === "open").length, 3);
    await repository.saveAgentResourceSamples({ serverId, samples: [{ ...highResource, sequence: 3, cpuPercent: 4.2, memoryUsedBytes: 1024, hostStorageUsedBytes: 8192, observedAt: new Date().toISOString() }] });
    assert.ok((await repository.listAlerts(organizationId)).filter((item) => item.code.startsWith("resource.")).every((item) => item.status === "resolved"));

    const providerChannel = await repository.upsertProviderChannel({ organizationId, name: "primary", provider: "compatible", baseUrl: "https://models.example.test/v1", model: "example/model", apiKeyEnvelope: { encrypted: true }, keyHint: "test", priority: 10, weight: 2, maxConcurrency: 20, monthlyBudgetUsd: 100, enabled: true, updatedBy: userId });
    assert.equal((await repository.listProviderChannels(organizationId))[0].id, providerChannel.id);
    const modelPolicy = await repository.upsertModelPolicy({ organizationId, allowedModels: ["example/model"], defaultModel: "example/model", userCustomKeysAllowed: false, dailyTokenLimit: 100000, monthlyBudgetUsd: 500, updatedBy: userId });
    assert.deepEqual(modelPolicy.allowedModels, ["example/model"]);
    const retentionPolicy = await repository.upsertRetentionPolicy({ organizationId, telemetryDays: 30, usageDays: 400, auditDays: 365, sensitiveAccessEventDays: 365, backupDays: 30, updatedBy: userId });
    assert.equal(retentionPolicy.telemetryDays, 30);
    const grant = await repository.createSensitiveAccessGrant({ organizationId, granteeUserId: userId, scope: "agent", targetId: agentId, reason: "PostgreSQL sensitive access test", grantedBy: userId, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await repository.recordSensitiveAccessEvent({ grantId: grant.id, organizationId, actorUserId: userId, targetType: "conversation", targetId: "session_test", reason: grant.reason });
    assert.equal((await repository.listSensitiveAccessEvents(organizationId))[0].grantId, grant.id);
    assert.ok((await repository.revokeSensitiveAccessGrant(organizationId, grant.id)).revokedAt);

    await repository.updateAgent(agentId, { desiredRuntimeState: "running" });
    await repository.pool.query("UPDATE agent_runtimes SET status='ready', last_heartbeat_at=now() - interval '10 minutes' WHERE id=$1", [runtimeId]);
    assert.ok((await repository.evaluateOfflineAlerts({ organizationId, staleAfterMs: 60_000 })).some((item) => item.code === "runtime.offline"));
    await repository.updateAgent(agentId, { desiredRuntimeState: "stopped" });
    await repository.evaluateOfflineAlerts({ organizationId, staleAfterMs: 60_000 });
    assert.equal((await repository.listAlerts(organizationId)).find((item) => item.code === "runtime.offline").status, "resolved");

    const testRunId = `test_${suffix}`;
    const probeOperation = await repository.requestControlOperation({ organizationId, agentId, action: "probe.run", arguments: { probe_ids: ["runtime.health"], test_run_id: testRunId }, requestedBy: userId });
    const [probeCommand] = await repository.leaseControlCommands({ serverId, limit: 5, leaseSeconds: 120 });
    assert.equal(probeCommand.command_id, probeOperation.command.id);
    for (const state of ["accepted", "running", "succeeded"]) await repository.recordCommandReceipt({ commandId: probeCommand.command_id, serverId, attempt: probeCommand.attempt, state, resultSummary: state === "succeeded" ? { checks: 1, passed: 1 } : {} });
    assert.equal((await repository.pool.query("SELECT status FROM test_runs WHERE id=$1", [testRunId])).rows[0].status, "passed");

    const applyOperation = await repository.requestControlOperation({ organizationId, agentId, action: "config.apply", arguments: { config_revision_id: provision.runtime.configRevisionId }, requestedBy: userId, approvalRequired: true, reason: "PostgreSQL configuration approval test" });
    assert.equal((await repository.leaseControlCommands({ serverId, limit: 5, leaseSeconds: 120 })).length, 0);
    await repository.decideControlApproval({ approvalId: applyOperation.approval.id, decision: "approved", reason: "Approved by PostgreSQL integration test", decidedBy: userId });
    const [applyCommand] = await repository.leaseControlCommands({ serverId, limit: 5, leaseSeconds: 120 });
    assert.equal(applyCommand.command_id, applyOperation.command.id);
    assert.deepEqual(applyCommand.config.secret_envelope.providerApiKey, { encrypted: true });

    const backupId = `backup_${suffix}`;
    const backupOperation = await repository.requestControlOperation({ organizationId, agentId, action: "backup.create", arguments: { backup_policy_id: "manual", backup_id: backupId }, requestedBy: userId });
    const backupCommand = (await repository.leaseControlCommands({ serverId, limit: 5, leaseSeconds: 120 })).find((item) => item.command_id === backupOperation.command.id);
    for (const state of ["accepted", "running", "succeeded"]) await repository.recordCommandReceipt({ commandId: backupCommand.command_id, serverId, attempt: backupCommand.attempt, state, resultSummary: state === "succeeded" ? { bytes: 2048 } : {}, evidenceRefs: state === "succeeded" ? [`sha256:${"d".repeat(64)}`] : [] });
    const verifyOperation = await repository.requestControlOperation({ organizationId, agentId, action: "backup.verify", arguments: { backup_id: backupId }, requestedBy: userId });
    const verifyCommand = (await repository.leaseControlCommands({ serverId, limit: 5, leaseSeconds: 120 })).find((item) => item.command_id === verifyOperation.command.id);
    for (const state of ["accepted", "running", "succeeded"]) await repository.recordCommandReceipt({ commandId: verifyCommand.command_id, serverId, attempt: verifyCommand.attempt, state });
    assert.equal((await repository.listBackupRecords(organizationId))[0].status, "verified");
    const restoreId = `restore_${suffix}`;
    const restoreOperation = await repository.requestControlOperation({ organizationId, agentId, action: "backup.restore", arguments: { backup_id: backupId, restore_id: restoreId }, requestedBy: userId, approvalRequired: true, riskLevel: "critical", reason: "PostgreSQL verified backup restore test" });
    assert.ok(!(await repository.leaseControlCommands({ serverId, limit: 5, leaseSeconds: 120 })).some((item) => item.command_id === restoreOperation.command.id));
    await repository.decideControlApproval({ approvalId: restoreOperation.approval.id, decision: "approved", reason: "Approved PostgreSQL restore transaction", decidedBy: userId });
    const restoreCommand = (await repository.leaseControlCommands({ serverId, limit: 5, leaseSeconds: 120 })).find((item) => item.command_id === restoreOperation.command.id);
    for (const state of ["accepted", "running", "succeeded"]) await repository.recordCommandReceipt({ commandId: restoreCommand.command_id, serverId, attempt: restoreCommand.attempt, state, evidenceRefs: state === "succeeded" ? [`restore:${restoreId}:succeeded`] : [] });
    assert.equal((await repository.listBackupRestoreRuns(organizationId))[0].status, "succeeded");

    await repository.recordAudit({ organizationId, actorUserId: userId, action: "retention.test.seed", targetType: "organization", targetId: organizationId });
    const retentionRuns = await repository.enforceRetentionPolicies({ organizationId, now: Date.now() + 500 * 24 * 60 * 60_000 });
    assert.equal(retentionRuns[0].status, "succeeded");
    assert.ok(retentionRuns[0].deletedCounts.heartbeats > 0);
    assert.ok(retentionRuns[0].deletedCounts.resourceSamples > 0);
    assert.ok(retentionRuns[0].deletedCounts.usageRollups > 0);
    assert.ok(retentionRuns[0].deletedCounts.sensitiveAccessEvents > 0);
    assert.ok(retentionRuns[0].deletedCounts.auditEvents > 0);
    assert.equal((await repository.listUsageRollups(organizationId, userId, agentId)).length, 0);
    assert.equal((await repository.listSensitiveAccessEvents(organizationId)).length, 0);
    assert.equal((await repository.listAudit(organizationId))[0].action, "retention.enforced");
    const expirationCommand = (await repository.leaseControlCommands({ serverId, limit: 5, leaseSeconds: 120 })).find((item) => item.action === "backup.expire");
    assert.equal(expirationCommand.arguments.backup_id, backupId);
    for (const state of ["accepted", "running", "succeeded"]) await repository.recordCommandReceipt({ commandId: expirationCommand.command_id, serverId, attempt: expirationCommand.attempt, state });
    assert.equal((await repository.listBackupRecords(organizationId))[0].status, "expired");
    const chain = await repository.pool.query("SELECT audit_event_id FROM audit_hash_chain WHERE organization_id=$1 ORDER BY sequence", [organizationId]);
    assert.ok(chain.rows.some((row) => row.audit_event_id === null));
    assert.ok(chain.rows.some((row) => row.audit_event_id !== null));

    const manifest = await repository.createReleaseManifest({ id: `manifest_${suffix}`, version: `1.0.${suffix}`, agentCommit: "a".repeat(40), imageDigest: `ghcr.io/bairui/bundle@sha256:${"a".repeat(64)}`, sbomUri: "https://evidence.example.test/sbom.json", provenanceUri: "https://evidence.example.test/provenance.json", signature: "s".repeat(64), compatibility: { hermes_image: `ghcr.io/bairui/hermes@sha256:${"b".repeat(64)}`, runtime_image: `ghcr.io/bairui/runtime@sha256:${"c".repeat(64)}` }, createdBy: userId });
    assert.equal((await repository.listReleaseManifests())[0].id, manifest.id);

    assert.equal(await repository.deleteObsidianNote(organizationId, userId, agentId, note.id), true);
    assert.equal((await repository.getMemoryProjectionStatus(organizationId, userId, agentId)).state, "pending");
    const deletion = await repository.requestAgentLifecycle({ agentId, request: "delete", requestedBy: userId, reason: "PostgreSQL integration test" });
    assert.ok(deletion.command.approvalId);
    const [deleteCommand] = await repository.leaseControlCommands({ serverId, limit: 5, leaseSeconds: 120 });
    assert.equal(deleteCommand.action, "deployment.delete");
    assert.equal(deleteCommand.approval_id, deletion.command.approvalId);
  } finally {
    await repository.pool.query("DELETE FROM organizations WHERE id=$1", [organizationId]).catch(() => {});
    await repository.close();
  }
});
