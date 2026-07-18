import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ControlAuthorityService } from "../packages/control-authority/service.mjs";
import { ControlAuthorityRepository } from "../packages/db/control-authority-repository.mjs";
import { PostgresPlatformRepository } from "../packages/db/postgres-repository.mjs";
import { signControlMutation } from "../packages/security/control-mutation.mjs";

test("PostgreSQL persists the C00-03 Authority state machine", { skip: process.env.BAIRUI_POSTGRES_INTEGRATION !== "1" }, async () => {
  const platform = new PostgresPlatformRepository({ connectionString: process.env.DATABASE_URL });
  const authorityRepository = new ControlAuthorityRepository({ pool: platform.pool });
  const authority = new ControlAuthorityService({ repository: authorityRepository });
  const suffix = randomUUID().slice(0, 8);
  const organizationId = `org_authority_${suffix}`;
  const userId = `user_authority_${suffix}`;
  const approverId = `approver_authority_${suffix}`;
  const agentId = `agent_authority_${suffix}`;
  const runtimeId = `runtime_authority_${suffix}`;
  const serverId = `server_authority_${suffix}`;
  const deploymentId = `deployment_authority_${suffix}`;
  const releaseId = `release_authority_${suffix}`;
  const signingToken = "c00-03-postgres-integration-signing-token";
  let mutationSequence = 0;
  const nextEnvelope = (name, overrides = {}) => {
    const sequence = ++mutationSequence;
    const createdAt = overrides.created_at ?? overrides.observed_at ?? overrides.requested_at ?? overrides.updated_at ?? new Date().toISOString();
    const value = {
      schema_version: "1.0",
      organization_id: organizationId,
      user_id: userId,
      agent_id: agentId,
      server_id: serverId,
      request_id: `request_${name}_${suffix}`,
      correlation_id: `correlation_${name}_${suffix}`,
      idempotency_key: `idempotency_${name}_${suffix}`,
      created_at: createdAt,
      revision: sequence,
      sequence,
      ...overrides
    };
    return signControlMutation(value, { token: signingToken, keyId: serverId, signedAt: value.created_at });
  };

  try {
    await platform.createOrganization({ id: organizationId, name: "Authority integration" });
    await platform.createUser({ id: userId, organizationId, email: `${suffix}@authority.test`, displayName: "Authority requester", passwordHash: "not-used", role: "org_admin" });
    await platform.createUser({ id: approverId, organizationId, email: `${suffix}-approver@authority.test`, displayName: "Authority approver", passwordHash: "not-used", role: "org_admin" });
    await platform.createAgent({ id: agentId, organizationId, ownerUserId: userId, name: "Authority Agent" });
    await platform.createAgentRuntime({ id: runtimeId, organizationId, ownerUserId: userId, agentId, workspaceRef: `workspace:${agentId}` });
    await platform.createServer({ id: serverId, organizationId, name: "Authority Host", status: "healthy" });
    await platform.pool.query(
      "INSERT INTO control_deployments (id,organization_id,server_id,agent_id,name,environment,status) VALUES ($1,$2,$3,$4,$5,'production','active')",
      [deploymentId, organizationId, serverId, agentId, "Authority deployment"]
    );
    await platform.pool.query("UPDATE agent_runtimes SET deployment_id=$2 WHERE id=$1", [runtimeId, deploymentId]);

    const secretReference = await authority.registerSecretReference(nextEnvelope("secret", {
      secret_ref: `sr_${suffix}_provider`,
      deployment_id: deploymentId,
      purpose: "provider-credential",
      version: 1,
      state: "active",
      masked: "****TEST",
      fingerprint: `sha256:${"a".repeat(64)}`,
      authorized_identity: serverId,
      last_verified_at: new Date().toISOString()
    }));
    assert.equal(secretReference.id, `sr_${suffix}_provider`);
    assert.equal(Object.hasOwn(secretReference, "secret_value"), false);

    const desiredInput = nextEnvelope("desired", {
      deployment_id: deploymentId,
      version: 1,
      sequence: 1,
      status: "active",
      target_state: "running",
      module_versions: { "control-supervisor": "1.0.0" },
      modules: [{
        module_id: "control-supervisor",
        desired_status: "running",
        version_ref: "ref:module:control-supervisor-1",
        image_digest: `sha256:${"b".repeat(64)}`,
        enabled: true
      }],
      updated_at: new Date().toISOString()
    });
    const desired = await authority.putDesiredState(desiredInput);
    assert.equal(desired.status, "active");
    assert.equal(desired.targetState, "running");
    assert.equal((await authority.putDesiredState(desiredInput)).id, desired.id);
    await assert.rejects(() => authority.putDesiredState({ ...desiredInput, target_state: "stopped" }), (error) => error.code === "idempotency_conflict");

    const initialObservedAt = new Date().toISOString();
    const initialObservation = await authority.recordObservation(nextEnvelope("observation-initial", {
      observation_id: `observation_${suffix}_1`,
      deployment_id: deploymentId,
      observation_version: 1,
      sequence: 1,
      desired_state_version: 1,
      status: "healthy",
      freshness: "fresh",
      components: [{ module_id: "control-supervisor", status: "healthy", version: "1.0.0", readiness: "ready", observed_at: initialObservedAt, evidence_refs: ["ref:health:initial"], health_code: "healthy" }],
      evidence_refs: ["ref:observation:initial"],
      redaction_status: "redacted",
      observed_at: initialObservedAt,
      received_at: initialObservedAt,
      freshness_seconds: 0,
      source_identity: `reporter_${suffix}`
    }));
    assert.equal(initialObservation.observationVersion, 1);
    assert.equal(initialObservation.freshness, "fresh");

    const startCommandId = `command_${suffix}_start`;
    const startCommandCreatedAt = new Date().toISOString();
    const startCommandIdempotency = `idempotency_command_start_${suffix}`;
    const command = await authority.requestCommand(nextEnvelope("command-start", {
      idempotency_key: startCommandIdempotency,
      command: {
        schema_version: "1.0",
        command_id: startCommandId,
        idempotency_key: startCommandIdempotency,
        deployment_id: deploymentId,
        action: "deployment.start",
        target: { module_id: "control-supervisor", instance_id: agentId },
        arguments: { agent_id: agentId },
        secret_refs: [secretReference.id],
        expected_observation_version: 1,
        created_at: startCommandCreatedAt,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString()
      }
    }));
    assert.equal(command.command.state, "queued");
    const [lease] = await authority.leaseCommands(nextEnvelope("lease-start", {
      limit: 10,
      lease_seconds: 120,
      requested_at: new Date().toISOString(),
      capability_refs: ["ref:contracts-v2.3.0-rc.2"]
    }));
    assert.equal(lease.command_id, command.command.id);
    assert.deepEqual(lease.secret_refs, [secretReference.id]);
    const persistedLease = (await platform.pool.query("SELECT token_hash FROM control_command_leases WHERE id=$1", [lease.lease_id])).rows[0];
    assert.notEqual(persistedLease.token_hash, lease.lease_token);
    assert.equal(JSON.stringify(persistedLease).includes(lease.lease_token), false);

    const receiptBase = {
      deployment_id: deploymentId,
      lease_id: lease.lease_id,
      lease_token: lease.lease_token,
      command_id: lease.command_id,
      attempt: lease.attempt,
      source_identity: serverId,
      observed_at: new Date().toISOString(),
      evidence_refs: []
    };
    await authority.recordReceipt(nextEnvelope("receipt-accepted", { ...receiptBase, receipt_id: `receipt_${suffix}_accepted`, state: "accepted", event_sequence: 1 }));
    await authority.recordReceipt(nextEnvelope("receipt-running", { ...receiptBase, receipt_id: `receipt_${suffix}_running`, state: "running", event_sequence: 2 }));
    const completionTime = new Date().toISOString();
    const completedInput = nextEnvelope("receipt-completed", {
      ...receiptBase,
      receipt_id: `receipt_${suffix}_completed`,
      state: "completion_candidate",
      event_sequence: 3,
      observation_version: 2,
      observed_at: completionTime,
      completed_at: completionTime,
      evidence_refs: ["ref:executor:completed"],
      result_ref: "ref:command-result:start",
      endpoint_ref: "ref:runtime-endpoint:agent"
    });
    const completion = await authority.recordReceipt(completedInput);
    assert.equal(completion.command.state, "verifying");
    assert.equal(completion.command.verificationState, "checking");
    assert.equal((await authority.recordReceipt(completedInput)).verificationId, completion.verificationId);
    assert.equal((await platform.pool.query("SELECT state FROM control_command_leases WHERE id=$1", [lease.lease_id])).rows[0].state, "consumed");
    await assert.rejects(() => authority.recordReceipt(nextEnvelope("receipt-reuse", { ...receiptBase, receipt_id: `receipt_${suffix}_reuse`, state: "failed", event_sequence: 4, completed_at: new Date().toISOString(), error_code: "verification_failed" })), (error) => error.code === "lease_expired");

    const postObservedAt = new Date(Date.parse(completionTime) + 1000).toISOString();
    const postObservation = await authority.recordObservation(nextEnvelope("observation-post", {
      observation_id: `observation_${suffix}_2`,
      deployment_id: deploymentId,
      observation_version: 2,
      sequence: 2,
      desired_state_version: 1,
      status: "healthy",
      freshness: "fresh",
      components: [{ module_id: "control-supervisor", status: "healthy", version: "1.0.0", readiness: "ready", observed_at: postObservedAt, evidence_refs: ["ref:health:post"], health_code: "healthy" }],
      evidence_refs: ["ref:observation:post"],
      redaction_status: "redacted",
      observed_at: postObservedAt,
      received_at: postObservedAt,
      freshness_seconds: 0,
      source_identity: `reporter_${suffix}`
    }));
    const verificationTime = new Date(Date.parse(postObservedAt) + 1000).toISOString();
    const verification = await authority.verifyCommand(nextEnvelope("verification", {
      verification_id: completion.verificationId,
      command_id: lease.command_id,
      attempt: lease.attempt,
      observation_id: postObservation.id,
      status: "verified",
      checks: [{ check_id: "runtime-ready", outcome: "pass" }],
      evidence_refs: ["ref:verification:runtime-ready"],
      verified_by: `authority_${suffix}`,
      completed_at: verificationTime,
      max_freshness_seconds: 120
    }));
    assert.equal(verification.command.state, "succeeded");
    assert.equal(verification.command.verificationState, "verified");

    const deleteCommandId = `command_${suffix}_delete`;
    const deleteApprovalId = `approval_${suffix}_delete`;
    const deleteCreatedAt = new Date().toISOString();
    const deleteExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const approvalExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const approvalScope = { deployment_id: deploymentId, organization_id: organizationId, user_id: userId, agent_id: agentId, server_id: serverId };
    const pendingApproval = nextEnvelope("approval-delete-pending", {
      created_at: deleteCreatedAt,
      approval_id: deleteApprovalId,
      command_id: deleteCommandId,
      action: "deployment.delete",
      risk_level: "critical",
      requested_by: userId,
      decision: "pending",
      reason_code: "policy_required",
      reason_ref: "ref:approval-reason:delete",
      expires_at: approvalExpiresAt,
      scope: approvalScope
    });
    const deleteIdempotency = `idempotency_command_delete_${suffix}`;
    const deleteRequest = await authority.requestCommand(nextEnvelope("command-delete", {
      idempotency_key: deleteIdempotency,
      created_at: deleteCreatedAt,
      command: {
        schema_version: "1.0",
        command_id: deleteCommandId,
        idempotency_key: deleteIdempotency,
        deployment_id: deploymentId,
        action: "deployment.delete",
        target: { module_id: "control-supervisor", instance_id: agentId },
        arguments: { agent_id: agentId },
        approval_id: deleteApprovalId,
        expected_observation_version: 2,
        created_at: deleteCreatedAt,
        expires_at: deleteExpiresAt
      }
    }), { approval: pendingApproval });
    assert.equal((await authority.leaseCommands(nextEnvelope("lease-delete-blocked", {
      limit: 10,
      lease_seconds: 120,
      requested_at: new Date().toISOString(),
      capability_refs: ["ref:contracts-v2.3.0-rc.2"]
    }))).length, 0);
    const selfDecisionAt = new Date().toISOString();
    await assert.rejects(() => authority.decideApproval(nextEnvelope("approval-self", {
      created_at: selfDecisionAt,
      approval_id: deleteRequest.approval.id,
      command_id: deleteCommandId,
      action: "deployment.delete",
      risk_level: "critical",
      requested_by: userId,
      decision: "approved",
      decided_by: userId,
      reason_code: "operator_requested",
      reason_ref: "ref:approval-decision:self",
      expires_at: approvalExpiresAt,
      decided_at: selfDecisionAt,
      scope: approvalScope
    })), (error) => error.code === "invalid_contract");
    const peerDecisionAt = new Date().toISOString();
    await authority.decideApproval(nextEnvelope("approval-peer", {
      created_at: peerDecisionAt,
      approval_id: deleteRequest.approval.id,
      command_id: deleteCommandId,
      action: "deployment.delete",
      risk_level: "critical",
      requested_by: userId,
      decision: "approved",
      decided_by: approverId,
      reason_code: "operator_requested",
      reason_ref: "ref:approval-decision:peer",
      expires_at: approvalExpiresAt,
      decided_at: peerDecisionAt,
      scope: approvalScope
    }));
    assert.equal((await authority.leaseCommands(nextEnvelope("lease-delete-approved", {
      limit: 10,
      lease_seconds: 120,
      requested_at: new Date().toISOString(),
      capability_refs: ["ref:contracts-v2.3.0-rc.2"]
    })))[0].command_id, deleteRequest.command.id);

    const release = await authority.registerReleaseManifest(nextEnvelope("release", {
      release_id: releaseId,
      version: `2.3.0-rc.${suffix}`,
      channel: "prerelease",
      status: "candidate",
      contracts_version: "2.3.0-rc.2",
      immutable: true,
      agent_commit: "c".repeat(40),
      artifacts: [{ component: "agent", version: "2.3.0-rc.2", ref: "ref:agent-image:rc2", digest: `sha256:${"c".repeat(64)}`, sbom_ref: "ref:agent-sbom:rc2", provenance_ref: "ref:agent-provenance:rc2" }],
      sbom_ref: "ref:release-sbom:rc2",
      provenance_ref: "ref:release-provenance:rc2",
      attestation_ref: "ref:release-attestation:rc2",
      migration_ref: "ref:migration:021",
      compatibility: { contracts_min: "2.3.0-rc.2", required_capabilities: ["control.events", "control.leases"] },
      release_notes_ref: "ref:release-notes:rc2"
    }));
    assert.equal(release.immutable, true);

    await assert.rejects(
      () => platform.pool.query("INSERT INTO control_outbox (id,organization_id,aggregate_type,aggregate_id,event_type,body) VALUES ($1,$2,'test','test','test.event',$3)", [`unsafe_${suffix}`, organizationId, { prompt: "must never persist" }]),
      (error) => error.code === "22023"
    );
    const aggregates = await authority.listDeploymentAggregates({ organization_id: organizationId, limit: 1 });
    assert.equal(aggregates.items[0].agentId, agentId);
    assert.equal(aggregates.items[0].desiredState.state, "running");
    assert.equal(aggregates.items[0].observation.status, "healthy");

    const [outboxLease] = await authority.leaseOutbox({ limit: 1, lease_seconds: 60 });
    assert.ok(outboxLease.lease_token.startsWith("ref:outbox-token:"));
    assert.equal(Object.hasOwn(outboxLease, "lease_token_hash"), false);
    assert.equal((await platform.pool.query("SELECT lease_token_hash=$2 AS hashed FROM control_outbox WHERE id=$1", [outboxLease.id, outboxLease.lease_token])).rows[0].hashed, false);
    assert.equal((await authority.settleOutbox({ outbox_id: outboxLease.id, lease_token: outboxLease.lease_token, outcome: "published" })).state, "published");
    await assert.rejects(() => authority.settleOutbox({ outbox_id: outboxLease.id, lease_token: outboxLease.lease_token, outcome: "published" }), (error) => error.code === "lease_not_found");

    const evidence = await platform.pool.query(
      `SELECT
         (SELECT count(*) FROM control_events WHERE deployment_id=$1) AS events,
         (SELECT count(*) FROM control_outbox WHERE organization_id=$2) AS outbox,
         (SELECT count(*) FROM control_audit_events WHERE organization_id=$2) AS audit,
         (SELECT count(*) FROM control_idempotency_records WHERE organization_id=$2) AS idempotency`,
      [deploymentId, organizationId]
    );
    assert.ok(Number(evidence.rows[0].events) >= 10);
    assert.ok(Number(evidence.rows[0].outbox) >= Number(evidence.rows[0].events));
    assert.ok(Number(evidence.rows[0].audit) >= Number(evidence.rows[0].events));
    assert.ok(Number(evidence.rows[0].idempotency) >= 8);
  } finally {
    await platform.pool.query("DELETE FROM release_manifests WHERE id=$1", [releaseId]).catch(() => {});
    await platform.pool.query("DELETE FROM organizations WHERE id=$1", [organizationId]).catch(() => {});
    await platform.close();
  }
});
