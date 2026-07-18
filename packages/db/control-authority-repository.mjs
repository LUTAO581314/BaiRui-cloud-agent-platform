import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import {
  APPROVAL_ACTIONS,
  assertOperationalMetadata,
  assertSafeControlPayload,
  controlError,
  digestControlValue,
  redactControlMetadata
} from "../control-authority/policy.mjs";

const iso = (value) => value?.toISOString?.() ?? value ?? null;
const hashToken = (value) => createHash("sha256").update(value).digest("hex");
const jsonb = (value) => JSON.stringify(value ?? null);

async function inTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function mapDesiredState(row) {
  return row ? {
    id: row.id,
    schemaVersion: row.schema_version,
    organizationId: row.organization_id,
    agentId: row.agent_id,
    serverId: row.server_id,
    deploymentId: row.deployment_id,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    version: Number(row.version),
    sequence: Number(row.sequence),
    status: row.lifecycle_status,
    targetState: row.state,
    configRevisionId: row.config_revision_id,
    releaseManifestId: row.release_manifest_id,
    backupId: row.backup_id,
    moduleVersions: row.module_versions ?? {},
    modules: row.modules ?? [],
    validFrom: iso(row.valid_from),
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  } : null;
}

function mapObservation(row) {
  return row ? {
    id: row.id,
    schemaVersion: row.schema_version,
    organizationId: row.organization_id,
    agentId: row.agent_id,
    serverId: row.server_id,
    deploymentId: row.deployment_id,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    observationVersion: Number(row.version),
    sequence: Number(row.sequence),
    desiredStateVersion: Number(row.desired_state_version),
    status: row.status,
    freshness: row.freshness,
    components: row.modules ?? [],
    summary: row.summary ?? {},
    evidenceRefs: row.evidence_refs ?? [],
    redactionStatus: row.redaction_status,
    sourceIdentity: row.source_identity,
    freshnessSeconds: Number(row.freshness_seconds),
    observedAt: iso(row.observed_at),
    receivedAt: iso(row.received_at)
  } : null;
}

function mapApproval(row) {
  return row ? {
    id: row.id,
    organizationId: row.organization_id,
    agentId: row.agent_id,
    serverId: row.server_id,
    commandId: row.command_id,
    action: row.action,
    riskLevel: row.risk_level,
    requestedBy: row.requested_by,
    decidedBy: row.decided_by,
    decision: row.decision,
    reasonCode: row.reason_code,
    reasonRef: row.reason_ref,
    scope: row.scope ?? {},
    expiresAt: iso(row.expires_at),
    decidedAt: iso(row.decided_at),
    createdAt: iso(row.created_at)
  } : null;
}

function mapCommand(row) {
  return row ? {
    id: row.id,
    organizationId: row.organization_id,
    agentId: row.agent_id,
    serverId: row.server_id,
    deploymentId: row.deployment_id,
    idempotencyKey: row.idempotency_key,
    action: row.action,
    targetModuleId: row.target_module_id,
    targetInstanceId: row.target_instance_id,
    arguments: row.arguments ?? {},
    secretRefs: row.secret_refs ?? [],
    approvalId: row.approval_id,
    expectedObservationVersion: Number(row.expected_observation_version),
    state: row.state,
    verificationState: row.verification_state,
    priority: row.priority,
    notBefore: iso(row.not_before),
    expiresAt: iso(row.expires_at),
    completionCandidateAt: iso(row.completion_candidate_at),
    finalizedAt: iso(row.finalized_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  } : null;
}

function mapReceipt(row) {
  return row ? {
    id: row.id,
    commandId: row.command_id,
    deploymentId: row.deployment_id,
    serverId: row.server_id,
    leaseId: row.lease_id,
    attempt: row.attempt,
    state: row.state,
    eventSequence: row.event_sequence === null ? null : Number(row.event_sequence),
    evidenceRefs: row.evidence_refs ?? [],
    resultRef: row.result_ref,
    endpointRef: row.endpoint_ref,
    sourceIdentity: row.source_identity,
    observationVersion: row.observation_version === null ? null : Number(row.observation_version),
    errorCode: row.error_code,
    errorRef: row.error_ref,
    errorSummary: row.error_summary,
    resultSummary: row.result_summary ?? {},
    completionCandidate: row.completion_candidate,
    observedAt: iso(row.observed_at),
    completedAt: iso(row.completed_at),
    createdAt: iso(row.created_at)
  } : null;
}

export class ControlAuthorityRepository {
  constructor(options = {}) {
    this.pool = options.pool ?? new pg.Pool({ connectionString: options.connectionString, ssl: options.ssl });
  }

  async close() {
    await this.pool.end();
  }

  async lockIdempotency(client, input) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`bairui-control-idempotency:${input.namespace}:${input.organizationId}:${input.idempotencyKey}`]);
    const { rows } = await client.query(
      "SELECT * FROM control_idempotency_records WHERE namespace=$1 AND organization_id=$2 AND idempotency_key=$3 FOR UPDATE",
      [input.namespace, input.organizationId, input.idempotencyKey]
    );
    const existing = rows[0];
    if (existing && existing.request_hash !== input.requestHash) throw controlError("idempotency_conflict", "The idempotency key was already used with a different request", 409);
    return existing ?? null;
  }

  async saveIdempotency(client, input) {
    await client.query(
      `INSERT INTO control_idempotency_records
         (id, namespace, organization_id, deployment_id, idempotency_key, request_hash, aggregate_type, aggregate_id, status, result_ref, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed',$9,now()+interval '30 days')`,
      [randomUUID(), input.namespace, input.organizationId, input.deploymentId ?? null, input.idempotencyKey, input.requestHash, input.aggregateType, input.aggregateId, input.resultRef ?? null]
    );
  }

  async appendAudit(client, input) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`bairui-control-audit:${input.organizationId}`]);
    const { rows: previousRows } = await client.query(
      "SELECT sequence,event_hash FROM control_audit_events WHERE organization_id=$1 ORDER BY sequence DESC LIMIT 1",
      [input.organizationId]
    );
    const sequence = Number(previousRows[0]?.sequence ?? 0) + 1;
    const previousHash = previousRows[0]?.event_hash ?? null;
    const redacted = redactControlMetadata(input.metadata ?? {});
    assertSafeControlPayload(redacted.value, "audit.metadata");
    const createdAt = input.createdAt ?? new Date().toISOString();
    const id = randomUUID();
    const eventHash = digestControlValue({
      id,
      organizationId: input.organizationId,
      deploymentId: input.deploymentId ?? null,
      sequence,
      actorIdentity: input.actorIdentity ?? null,
      action: input.action,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      metadata: redacted.value,
      previousHash,
      createdAt
    });
    await client.query(
      `INSERT INTO control_audit_events
         (id, organization_id, deployment_id, sequence, actor_identity, action, aggregate_type, aggregate_id, metadata, redaction_status, previous_hash, event_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'redacted',$10,$11,$12)`,
      [id, input.organizationId, input.deploymentId ?? null, sequence, input.actorIdentity ?? null, input.action, input.aggregateType, input.aggregateId, jsonb(redacted.value), previousHash, eventHash, createdAt]
    );
    return { id, sequence, eventHash, redacted: redacted.redacted };
  }

  async appendEvent(client, input) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`bairui-control-event:${input.deploymentId}`]);
    const { rows: sequenceRows } = await client.query("SELECT COALESCE(MAX(event_sequence),0)+1 AS next_sequence FROM control_events WHERE deployment_id=$1", [input.deploymentId]);
    const eventSequence = Number(sequenceRows[0].next_sequence);
    const eventId = input.eventId ?? randomUUID();
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const redacted = redactControlMetadata(input.summary ?? {});
    assertSafeControlPayload(redacted.value, "event.summary");
    await client.query(
      `INSERT INTO control_events
         (id, schema_version, organization_id, agent_id, server_id, deployment_id, command_id, identity_id,
          request_id, correlation_id, idempotency_key, source_identity, attempt, lease_id, lease_token_ref,
          observation_version, event_sequence, event_type, state, summary, evidence_refs, created_at, occurred_at)
       VALUES ($1,'1.0',$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20)`,
      [eventId, input.organizationId, input.agentId, input.serverId ?? null, input.deploymentId, input.commandId ?? null,
        input.requestId ?? eventId, input.correlationId ?? eventId, input.idempotencyKey, input.sourceIdentity ?? null,
        input.attempt ?? null, input.leaseId ?? null, input.leaseTokenRef ?? null, input.observationVersion ?? null,
        eventSequence, input.eventType, input.state ?? null, jsonb(redacted.value), input.evidenceRefs ?? [], occurredAt]
    );
    const outboxId = randomUUID();
    const outboxBody = {
      schema_version: "1.0",
      event_id: eventId,
      deployment_id: input.deploymentId,
      event_sequence: eventSequence,
      event_type: input.eventType,
      state: input.state ?? null,
      evidence_refs: input.evidenceRefs ?? [],
      occurred_at: occurredAt
    };
    assertSafeControlPayload(outboxBody, "outbox.body");
    await client.query(
      `INSERT INTO control_outbox
         (id, organization_id, deployment_id, event_id, aggregate_type, aggregate_id, event_type, idempotency_key, body, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')`,
      [outboxId, input.organizationId, input.deploymentId, eventId, input.aggregateType, input.aggregateId, input.eventType, `event:${eventId}`, jsonb(outboxBody)]
    );
    const audit = await this.appendAudit(client, {
      organizationId: input.organizationId,
      deploymentId: input.deploymentId,
      actorIdentity: input.sourceIdentity,
      action: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      metadata: { event_id: eventId, event_sequence: eventSequence, state: input.state ?? null, ...redacted.value },
      createdAt: occurredAt
    });
    return { id: eventId, eventSequence, outboxId, auditId: audit.id, occurredAt };
  }

  async appendGlobalChange(client, input) {
    const outboxId = randomUUID();
    const body = redactControlMetadata(input.body ?? {}).value;
    assertSafeControlPayload(body, "outbox.body");
    await client.query(
      `INSERT INTO control_outbox
         (id, organization_id, deployment_id, aggregate_type, aggregate_id, event_type, idempotency_key, body, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
      [outboxId, input.organizationId, input.deploymentId ?? null, input.aggregateType, input.aggregateId, input.eventType, input.idempotencyKey, jsonb(body)]
    );
    const audit = await this.appendAudit(client, {
      organizationId: input.organizationId,
      deploymentId: input.deploymentId,
      actorIdentity: input.actorIdentity,
      action: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      metadata: body,
      createdAt: input.createdAt
    });
    return { outboxId, auditId: audit.id };
  }

  async getDeploymentForUpdate(client, input) {
    const { rows } = await client.query(
      `SELECT deployment.*, agent.owner_user_id
       FROM control_deployments deployment
       JOIN agents agent ON agent.id=deployment.agent_id
       WHERE deployment.id=$1 AND deployment.organization_id=$2 AND deployment.agent_id=$3
         AND agent.owner_user_id=$4
       FOR UPDATE OF deployment`,
      [input.deploymentId, input.organizationId, input.agentId, input.userId]
    );
    const deployment = rows[0];
    if (!deployment) throw controlError("owner_mismatch", "Control deployment does not belong to the supplied owner scope", 404);
    if (input.serverId && deployment.server_id !== input.serverId) throw controlError("server_mismatch", "Control deployment is assigned to another server", 409);
    return deployment;
  }

  async createDesiredState(input) {
    assertSafeControlPayload(input.moduleVersions, "DesiredState.module_versions");
    assertSafeControlPayload(input.modules, "DesiredState.modules");
    const requestHash = digestControlValue(input);
    return inTransaction(this.pool, async (client) => {
      const existing = await this.lockIdempotency(client, { namespace: "desired-state", organizationId: input.organizationId, idempotencyKey: input.idempotencyKey, requestHash });
      if (existing) return mapDesiredState((await client.query("SELECT * FROM desired_states WHERE id=$1", [existing.aggregate_id])).rows[0]);
      const deployment = await this.getDeploymentForUpdate(client, input);
      const { rows: versionRows } = await client.query("SELECT COALESCE(MAX(version),0)+1 AS next_version, COALESCE(MAX(sequence),0)+1 AS next_sequence FROM desired_states WHERE deployment_id=$1", [deployment.id]);
      if (Number(versionRows[0].next_version) !== input.version) throw controlError("revision_conflict", "DesiredState.version is not the next deployment revision", 409);
      if (Number(versionRows[0].next_sequence) !== input.sequence) throw controlError("sequence_conflict", "DesiredState.sequence is not monotonic", 409);
      if (input.configRevisionId) {
        const { rowCount } = await client.query("SELECT 1 FROM config_revisions WHERE id=$1 AND organization_id=$2 AND agent_id=$3", [input.configRevisionId, input.organizationId, input.agentId]);
        if (rowCount !== 1) throw controlError("owner_mismatch", "DesiredState config revision is outside the deployment scope", 409);
      }
      if (input.releaseManifestId) {
        const { rowCount } = await client.query("SELECT 1 FROM release_manifests WHERE id=$1 AND immutable=true", [input.releaseManifestId]);
        if (rowCount !== 1) throw controlError("release_not_immutable", "DesiredState release manifest is unavailable or mutable", 409);
      }
      if (input.backupId) {
        const { rowCount } = await client.query("SELECT 1 FROM backup_records WHERE id=$1 AND deployment_id=$2", [input.backupId, deployment.id]);
        if (rowCount !== 1) throw controlError("owner_mismatch", "DesiredState backup is outside the deployment scope", 409);
      }
      if (input.lifecycleStatus === "active") {
        await client.query("UPDATE desired_states SET lifecycle_status='superseded', updated_at=now() WHERE deployment_id=$1 AND lifecycle_status='active'", [deployment.id]);
      }
      const id = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO desired_states
           (id, schema_version, organization_id, agent_id, server_id, deployment_id, request_id, correlation_id,
            idempotency_key, version, sequence, state, lifecycle_status, config_revision_id, release_manifest_id, backup_id,
            module_versions, modules, created_by, created_at, valid_from, expires_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
        [id, input.schemaVersion, input.organizationId, input.agentId, input.serverId, deployment.id, input.requestId,
          input.correlationId, input.idempotencyKey, input.version, input.sequence, input.state, input.lifecycleStatus,
          input.configRevisionId, input.releaseManifestId, input.backupId, jsonb(input.moduleVersions), jsonb(input.modules),
          input.createdBy, input.createdAt, input.validFrom, input.expiresAt, input.updatedAt]
      );
      if (input.lifecycleStatus === "active") {
        await client.query("UPDATE control_deployments SET desired_state_version=$2, updated_at=now() WHERE id=$1", [deployment.id, input.version]);
      }
      await this.appendEvent(client, {
        organizationId: input.organizationId, agentId: input.agentId, serverId: input.serverId, deploymentId: deployment.id,
        requestId: input.requestId, correlationId: input.correlationId, idempotencyKey: `${input.idempotencyKey}:event`,
        sourceIdentity: input.userId, eventType: "desired.changed", state: input.lifecycleStatus,
        aggregateType: "desired_state", aggregateId: id,
        summary: { desired_state_id: id, desired_state_version: input.version, lifecycle_status: input.lifecycleStatus, target_state: input.state }, occurredAt: input.createdAt
      });
      await this.saveIdempotency(client, { namespace: "desired-state", organizationId: input.organizationId, deploymentId: deployment.id, idempotencyKey: input.idempotencyKey, requestHash, aggregateType: "desired_state", aggregateId: id });
      return mapDesiredState(rows[0]);
    });
  }

  async recordObservation(input) {
    assertOperationalMetadata(input.summary, "Observation.summary");
    assertSafeControlPayload(input.modules, "Observation.modules");
    const requestHash = digestControlValue(input);
    return inTransaction(this.pool, async (client) => {
      const existing = await this.lockIdempotency(client, { namespace: "observation", organizationId: input.organizationId, idempotencyKey: input.idempotencyKey, requestHash });
      if (existing) return mapObservation((await client.query("SELECT * FROM observations WHERE id=$1", [existing.aggregate_id])).rows[0]);
      const deployment = await this.getDeploymentForUpdate(client, input);
      const { rows: versionRows } = await client.query("SELECT COALESCE(MAX(version),0) AS version, COALESCE(MAX(sequence),0) AS sequence FROM observations WHERE deployment_id=$1", [deployment.id]);
      if (input.version <= Number(versionRows[0].version)) throw controlError("revision_conflict", "Observation.version is stale", 409);
      if (input.sequence <= Number(versionRows[0].sequence)) throw controlError("sequence_conflict", "Observation.sequence is stale", 409);
      if (input.desiredStateVersion > Number(deployment.desired_state_version)) throw controlError("revision_conflict", "Observation references a future DesiredState", 409);
      const receivedAt = input.receivedAt;
      const calculatedFreshness = Math.max(0, Math.floor((Date.parse(receivedAt) - Date.parse(input.observedAt)) / 1000));
      if (input.freshnessSeconds < calculatedFreshness) throw controlError("stale_observation", "Observation freshness_seconds understates its signed timestamps", 409);
      const { rows } = await client.query(
        `INSERT INTO observations
           (id, schema_version, organization_id, agent_id, server_id, deployment_id, request_id, correlation_id,
            idempotency_key, version, sequence, desired_state_version, status, summary, modules, evidence_refs,
            redaction_status, source_identity, freshness, freshness_seconds, observed_at, received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
        [input.id, input.schemaVersion, input.organizationId, input.agentId, input.serverId, deployment.id, input.requestId,
          input.correlationId, input.idempotencyKey, input.version, input.sequence, input.desiredStateVersion, input.status,
          jsonb(input.summary), jsonb(input.modules), input.evidenceRefs, input.redactionStatus, input.sourceIdentity, input.freshness,
          input.freshnessSeconds, input.observedAt, receivedAt]
      );
      await client.query("UPDATE control_deployments SET observed_state_version=$2, status=CASE WHEN $3='healthy' THEN 'active' WHEN $3='unknown' THEN status ELSE 'degraded' END, updated_at=now() WHERE id=$1", [deployment.id, input.version, input.status]);
      await this.appendEvent(client, {
        organizationId: input.organizationId, agentId: input.agentId, serverId: input.serverId, deploymentId: deployment.id,
        requestId: input.requestId, correlationId: input.correlationId, idempotencyKey: `${input.idempotencyKey}:event`,
        sourceIdentity: input.sourceIdentity, observationVersion: input.version, eventType: "observation.received", state: input.status,
        aggregateType: "observation", aggregateId: input.id, evidenceRefs: input.evidenceRefs,
        summary: { observation_id: input.id, observation_version: input.version, desired_state_version: input.desiredStateVersion, freshness: input.freshness, freshness_seconds: input.freshnessSeconds },
        occurredAt: receivedAt
      });
      await this.saveIdempotency(client, { namespace: "observation", organizationId: input.organizationId, deploymentId: deployment.id, idempotencyKey: input.idempotencyKey, requestHash, aggregateType: "observation", aggregateId: input.id });
      return mapObservation(rows[0]);
    });
  }

  async createCommand(input) {
    assertSafeControlPayload(input.arguments, "ControlCommand.arguments");
    const requestHash = digestControlValue(input);
    return inTransaction(this.pool, async (client) => {
      const existing = await this.lockIdempotency(client, { namespace: "control-command", organizationId: input.organizationId, idempotencyKey: input.idempotencyKey, requestHash });
      if (existing) {
        const { rows } = await client.query("SELECT command.*, deployment.organization_id, deployment.agent_id, deployment.server_id FROM control_commands command JOIN control_deployments deployment ON deployment.id=command.deployment_id WHERE command.id=$1", [existing.aggregate_id]);
        const approval = rows[0]?.approval_id ? mapApproval((await client.query("SELECT * FROM control_approvals WHERE id=$1", [rows[0].approval_id])).rows[0]) : null;
        return { command: mapCommand(rows[0]), approval };
      }
      const deployment = await this.getDeploymentForUpdate(client, input);
      if (input.expectedObservationVersion !== Number(deployment.observed_state_version)) throw controlError("revision_conflict", "ControlCommand expected_observation_version is stale", 409);
      if (Date.parse(input.expiresAt) <= Date.now()) throw controlError("invalid_timestamp", "ControlCommand is already expired", 409);
      if (input.secretRefs.length) {
        const { rows } = await client.query(
          "SELECT id FROM control_secret_references WHERE id=ANY($1::text[]) AND organization_id=$2 AND agent_id=$3 AND state='active' AND (expires_at IS NULL OR expires_at>now())",
          [input.secretRefs, input.organizationId, input.agentId]
        );
        if (new Set(rows.map((row) => row.id)).size !== new Set(input.secretRefs).size) throw controlError("owner_mismatch", "One or more secret references are unavailable for this Agent", 409);
      }
      await client.query(
        `INSERT INTO control_commands
           (id, deployment_id, idempotency_key, action, target_module_id, target_instance_id, arguments, secret_refs,
            approval_id, expected_observation_version, state, verification_state, priority, not_before, expires_at,
            requested_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued','pending',$11,$12,$13,$14,$15,$15)`,
        [input.id, deployment.id, input.idempotencyKey, input.action, input.targetModuleId, input.targetInstanceId,
          jsonb(input.arguments), input.secretRefs, input.approval?.id ?? null, input.expectedObservationVersion,
          input.priority, input.notBefore, input.expiresAt, input.userId, input.createdAt]
      );
      let approval = null;
      if (input.approval) {
        const { rows } = await client.query(
          `INSERT INTO control_approvals
             (id, schema_version, organization_id, agent_id, server_id, command_id, request_id, correlation_id,
              idempotency_key, sequence, action, risk_level, requested_by, decision, reason, reason_code, reason_ref, scope,
              expires_at, created_at)
           VALUES ($1,'1.0',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13,$13,$14,$15,$16,$17) RETURNING *`,
          [input.approval.id, input.organizationId, input.agentId, input.serverId, input.id, input.requestId, input.correlationId,
            input.approval.idempotencyKey, input.approval.sequence, input.action, input.approval.riskLevel, input.approval.requestedBy,
            input.approval.reasonCode, input.approval.reasonRef, jsonb(input.approval.scope), input.approval.expiresAt,
            input.approval.createdAt]
        );
        approval = mapApproval(rows[0]);
      }
      await this.appendEvent(client, {
        organizationId: input.organizationId, agentId: input.agentId, serverId: input.serverId, deploymentId: deployment.id,
        commandId: input.id, requestId: input.requestId, correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:event`, sourceIdentity: input.userId, eventType: "command.queued", state: "queued",
        aggregateType: "control_command", aggregateId: input.id,
        summary: { command_id: input.id, action: input.action, expected_observation_version: input.expectedObservationVersion, approval_id: input.approval?.id ?? null }
      });
      await this.saveIdempotency(client, { namespace: "control-command", organizationId: input.organizationId, deploymentId: deployment.id, idempotencyKey: input.idempotencyKey, requestHash, aggregateType: "control_command", aggregateId: input.id });
      const commandRow = (await client.query("SELECT command.*, deployment.organization_id, deployment.agent_id, deployment.server_id FROM control_commands command JOIN control_deployments deployment ON deployment.id=command.deployment_id WHERE command.id=$1", [input.id])).rows[0];
      return { command: mapCommand(commandRow), approval };
    });
  }

  async decideApproval(input) {
    const requestHash = digestControlValue(input);
    return inTransaction(this.pool, async (client) => {
      const existing = await this.lockIdempotency(client, { namespace: "approval-decision", organizationId: input.organizationId, idempotencyKey: input.idempotencyKey, requestHash });
      if (existing) return mapApproval((await client.query("SELECT * FROM control_approvals WHERE id=$1", [existing.aggregate_id])).rows[0]);
      const { rows } = await client.query(
        `SELECT approval.*, command.deployment_id, command.state AS command_state, deployment.organization_id AS deployment_organization_id,
                deployment.agent_id AS deployment_agent_id, deployment.server_id AS deployment_server_id,
                agent.owner_user_id AS deployment_user_id
         FROM control_approvals approval
         JOIN control_commands command ON command.id=approval.command_id
         JOIN control_deployments deployment ON deployment.id=command.deployment_id
         JOIN agents agent ON agent.id=deployment.agent_id
         WHERE approval.id=$1 FOR UPDATE OF approval,command`,
        [input.approvalId]
      );
      const current = rows[0];
      const expectedScope = input.scope;
      if (!current
        || current.deployment_organization_id !== input.organizationId
        || current.deployment_user_id !== input.userId
        || current.deployment_agent_id !== input.agentId
        || current.deployment_server_id !== input.serverId
        || current.deployment_id !== expectedScope.deployment_id
        || current.command_id !== input.commandId
        || current.action !== input.action
        || current.requested_by !== input.requestedBy) {
        throw controlError("owner_mismatch", "Approval is outside the supplied command and owner scope", 404);
      }
      if (current.decision !== "pending" || Date.parse(current.expires_at) <= Date.now()) throw controlError("approval_not_valid", "Approval is no longer pending", 409);
      if (input.decision === "approved" && current.requested_by === input.decidedBy) throw controlError("approval_not_valid", "The requester cannot approve the same high-risk command", 409);
      const { rows: updatedRows } = await client.query(
        `UPDATE control_approvals
         SET decision=$2, decided_by=$3, reason=$4, reason_code=$4, reason_ref=$5, decided_at=$6
         WHERE id=$1 RETURNING *`,
        [input.approvalId, input.decision, input.decidedBy, input.reasonCode, input.reasonRef, input.decidedAt]
      );
      if (input.decision === "rejected") await client.query("UPDATE control_commands SET state='cancelled', verification_state='blocked', finalized_at=$2, updated_at=now() WHERE id=$1 AND state='queued'", [current.command_id, input.decidedAt]);
      await this.appendEvent(client, {
        organizationId: input.organizationId, agentId: input.agentId, serverId: input.serverId, deploymentId: current.deployment_id,
        commandId: current.command_id, requestId: input.requestId, correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:event`, sourceIdentity: input.decidedBy,
        eventType: `approval.${input.decision}`, state: input.decision,
        aggregateType: "control_approval", aggregateId: input.approvalId,
        summary: { approval_id: input.approvalId, command_id: current.command_id, decision: input.decision, reason_code: input.reasonCode },
        occurredAt: input.decidedAt
      });
      await this.saveIdempotency(client, { namespace: "approval-decision", organizationId: input.organizationId, deploymentId: current.deployment_id, idempotencyKey: input.idempotencyKey, requestHash, aggregateType: "control_approval", aggregateId: input.approvalId });
      return mapApproval(updatedRows[0]);
    });
  }

  async createReleaseManifest(input) {
    assertSafeControlPayload(input.artifacts, "ReleaseManifest.artifacts");
    assertOperationalMetadata(input.compatibility, "ReleaseManifest.compatibility");
    const requestHash = digestControlValue(input);
    return inTransaction(this.pool, async (client) => {
      const existing = await this.lockIdempotency(client, { namespace: "release-manifest", organizationId: input.organizationId, idempotencyKey: input.idempotencyKey, requestHash });
      if (existing) return (await client.query("SELECT * FROM release_manifests WHERE id=$1", [existing.aggregate_id])).rows[0];
      const primaryArtifact = input.artifacts[0];
      const legacySbomRef = input.sbomRef ?? primaryArtifact.sbom_ref ?? `ref:sbom-pending:${input.id}`;
      const legacyProvenanceRef = input.provenanceRef ?? primaryArtifact.provenance_ref ?? `ref:provenance-pending:${input.id}`;
      const legacyAttestationRef = input.attestationRef ?? `ref:attestation-pending:${input.id}`;
      const { rows } = await client.query(
        `INSERT INTO release_manifests
           (id, version, agent_commit, image_digest, sbom_uri, provenance_uri, signature, migration_version,
            compatibility, status, created_by, schema_version, channel, contracts_version, immutable, artifacts,
            sbom_ref, provenance_ref, attestation_ref, migration_ref, release_notes_ref, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
        [input.id, input.version, input.agentCommit, primaryArtifact.digest, legacySbomRef, legacyProvenanceRef,
          legacyAttestationRef, input.migrationRef, jsonb(input.compatibility), input.status, input.createdBy, input.schemaVersion,
          input.channel, input.contractsVersion, jsonb(input.artifacts), input.sbomRef, input.provenanceRef, input.attestationRef,
          input.migrationRef, input.releaseNotesRef, input.createdAt]
      );
      await this.appendGlobalChange(client, {
        organizationId: input.organizationId, aggregateType: "release_manifest", aggregateId: input.id,
        eventType: "release.manifest.registered", idempotencyKey: `release:${input.idempotencyKey}`,
        actorIdentity: input.userId, createdAt: input.createdAt,
        body: { release_id: input.id, version: input.version, channel: input.channel, status: input.status, contracts_version: input.contractsVersion, artifact_digests: input.artifacts.map((item) => item.digest) }
      });
      await this.saveIdempotency(client, { namespace: "release-manifest", organizationId: input.organizationId, idempotencyKey: input.idempotencyKey, requestHash, aggregateType: "release_manifest", aggregateId: input.id });
      return rows[0];
    });
  }

  async registerSecretReference(input) {
    const requestHash = digestControlValue(input);
    return inTransaction(this.pool, async (client) => {
      const existing = await this.lockIdempotency(client, { namespace: "secret-reference", organizationId: input.organizationId, idempotencyKey: input.idempotencyKey, requestHash });
      if (existing) return (await client.query("SELECT * FROM control_secret_references WHERE id=$1", [existing.aggregate_id])).rows[0];
      const { rowCount: agentCount } = await client.query("SELECT 1 FROM agents WHERE id=$1 AND organization_id=$2", [input.agentId, input.organizationId]);
      if (agentCount !== 1) throw controlError("owner_mismatch", "Secret reference Agent is outside the organization scope", 404);
      let deploymentId = input.deploymentId;
      if (deploymentId) {
        const deployment = await this.getDeploymentForUpdate(client, input);
        deploymentId = deployment.id;
      }
      const { rows } = await client.query(
        `INSERT INTO control_secret_references
           (id, organization_id, deployment_id, agent_id, purpose, version, state, masked, fingerprint,
            authorized_identity, last_verified_at, expires_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
        [input.id, input.organizationId, deploymentId, input.agentId, input.purpose, input.version, input.state,
          input.masked, input.fingerprint, input.authorizedIdentity, input.lastVerifiedAt, input.expiresAt, input.createdAt]
      );
      await this.appendGlobalChange(client, {
        organizationId: input.organizationId, deploymentId, aggregateType: "secret_reference", aggregateId: input.id,
        eventType: "secret-reference.registered", idempotencyKey: `secret-reference:${input.idempotencyKey}`,
        actorIdentity: input.userId, createdAt: input.createdAt,
        body: { secret_ref: input.id, agent_id: input.agentId, purpose: input.purpose, version: input.version, state: input.state, masked: input.masked, fingerprint: input.fingerprint }
      });
      await this.saveIdempotency(client, { namespace: "secret-reference", organizationId: input.organizationId, deploymentId, idempotencyKey: input.idempotencyKey, requestHash, aggregateType: "secret_reference", aggregateId: input.id });
      return rows[0];
    });
  }

  async expireLeases(client) {
    const { rows } = await client.query(
      `SELECT lease.*, command.state AS command_state, command.idempotency_key AS command_idempotency_key,
              deployment.organization_id, deployment.agent_id
       FROM control_command_leases lease
       JOIN control_commands command ON command.id=lease.command_id
       JOIN control_deployments deployment ON deployment.id=lease.deployment_id
       WHERE lease.state='active' AND lease.expires_at<=now()
       FOR UPDATE OF lease,command`
    );
    for (const lease of rows) {
      await client.query("UPDATE control_command_leases SET state='expired' WHERE id=$1", [lease.id]);
      const safeToRetry = lease.command_state === "leased";
      await client.query(
        "UPDATE control_commands SET state=$2, verification_state=CASE WHEN $2='expired' THEN 'blocked' ELSE verification_state END, lease_server_id=NULL, lease_expires_at=NULL, finalized_at=CASE WHEN $2='expired' THEN now() ELSE finalized_at END, updated_at=now() WHERE id=$1",
        [lease.command_id, safeToRetry ? "queued" : "expired"]
      );
      await client.query("UPDATE command_attempts SET state='expired', completed_at=now(), error_code='lease_expired', error_summary='Control command lease expired' WHERE command_id=$1 AND attempt=$2", [lease.command_id, lease.attempt]);
      await this.appendEvent(client, {
        organizationId: lease.organization_id, agentId: lease.agent_id, serverId: lease.server_id, deploymentId: lease.deployment_id,
        commandId: lease.command_id, idempotencyKey: `lease-expired:${lease.id}`, sourceIdentity: lease.server_id,
        attempt: lease.attempt, leaseId: lease.id, leaseTokenRef: `hint:lease-token:${lease.id}`,
        eventType: "command.lease-expired", state: safeToRetry ? "queued" : "expired",
        aggregateType: "control_command", aggregateId: lease.command_id,
        summary: { command_id: lease.command_id, lease_id: lease.id, attempt: lease.attempt, retryable: safeToRetry }
      });
    }
  }

  async leaseCommands(input) {
    const limit = Math.max(1, Math.min(input.limit, 50));
    const leaseSeconds = Math.max(15, Math.min(input.leaseSeconds, 300));
    return inTransaction(this.pool, async (client) => {
      await this.expireLeases(client);
      const { rows } = await client.query(
        `SELECT command.*, deployment.organization_id, deployment.agent_id, deployment.server_id,
                agent.owner_user_id
         FROM control_commands command
         JOIN control_deployments deployment ON deployment.id=command.deployment_id
         JOIN agents agent ON agent.id=deployment.agent_id
         WHERE deployment.organization_id=$1 AND deployment.server_id=$2
           AND ($3::text IS NULL OR deployment.agent_id=$3)
           AND agent.owner_user_id=$4
           AND command.action<>'config.apply-user'
           AND command.state='queued' AND command.not_before<=now() AND command.expires_at>now()
           AND (
             (command.action=ANY($5::text[]) AND command.approval_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM control_approvals approval
               WHERE approval.id=command.approval_id AND approval.command_id=command.id
                 AND approval.action=command.action AND approval.decision='approved' AND approval.expires_at>now()
             ))
             OR (NOT (command.action=ANY($5::text[])) AND command.approval_id IS NULL)
           )
         ORDER BY command.priority,command.created_at
         FOR UPDATE OF command SKIP LOCKED LIMIT $6`,
        [input.organizationId, input.serverId, input.agentId ?? null, input.userId, [...APPROVAL_ACTIONS], limit]
      );
      const leases = [];
      for (const row of rows) {
        const { rows: attemptRows } = await client.query("SELECT COALESCE(MAX(attempt),0)+1 AS attempt FROM command_attempts WHERE command_id=$1", [row.id]);
        const attempt = Number(attemptRows[0].attempt);
        const leaseId = randomUUID();
        const leaseToken = `ref:lease-token:${randomUUID()}`;
        const leaseExpiresAt = new Date(Math.min(Date.now() + leaseSeconds * 1000, Date.parse(row.expires_at))).toISOString();
        await client.query(
          `INSERT INTO control_command_leases (id, command_id, deployment_id, server_id, attempt, token_hash, state, issued_at, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,'active',now(),$7)`,
          [leaseId, row.id, row.deployment_id, input.serverId, attempt, hashToken(leaseToken), leaseExpiresAt]
        );
        await client.query("INSERT INTO command_attempts (id, command_id, attempt, state) VALUES ($1,$2,$3,'leased')", [randomUUID(), row.id, attempt]);
        await client.query("UPDATE control_commands SET state='leased', lease_server_id=$2, lease_expires_at=$3, updated_at=now() WHERE id=$1", [row.id, input.serverId, leaseExpiresAt]);
        await this.appendEvent(client, {
          organizationId: row.organization_id, agentId: row.agent_id, serverId: row.server_id, deploymentId: row.deployment_id,
          commandId: row.id, idempotencyKey: `lease:${leaseId}`, sourceIdentity: input.serverId,
          attempt, leaseId, leaseTokenRef: `hint:lease-token:${leaseId}`, eventType: "command.leased", state: "leased",
          aggregateType: "control_command", aggregateId: row.id,
          summary: { command_id: row.id, lease_id: leaseId, attempt, lease_expires_at: leaseExpiresAt }
        });
        leases.push({
          schema_version: "1.0",
          command_id: row.id,
          idempotency_key: row.idempotency_key,
          deployment_id: row.deployment_id,
          action: row.action,
          target: { module_id: row.target_module_id, ...(row.target_instance_id ? { instance_id: row.target_instance_id } : {}) },
          arguments: row.arguments,
          secret_refs: row.secret_refs ?? [],
          ...(row.approval_id ? { approval_id: row.approval_id } : {}),
          expected_observation_version: Number(row.expected_observation_version),
          created_at: iso(row.created_at),
          expires_at: iso(row.expires_at),
          attempt,
          lease_id: leaseId,
          lease_token: leaseToken,
          lease_expires_at: leaseExpiresAt,
          placement: {
            organization_id: row.organization_id,
            user_id: row.owner_user_id,
            agent_id: row.agent_id,
            server_id: row.server_id
          },
          ...(row.arguments?.config_revision_id ? { config_revision_ref: `ref:config-revision:${row.arguments.config_revision_id}` } : {}),
          ...(row.arguments?.release_id ? { release_manifest_ref: `ref:release:${row.arguments.release_id}` } : {})
        });
      }
      return leases;
    });
  }

  async recordReceipt(input) {
    assertOperationalMetadata(input.resultSummary, "Receipt.result_summary");
    const requestHash = digestControlValue({ ...input, leaseToken: "[opaque]" });
    return inTransaction(this.pool, async (client) => {
      const existing = await this.lockIdempotency(client, { namespace: "command-receipt", organizationId: input.organizationId, idempotencyKey: input.idempotencyKey, requestHash });
      if (existing) {
        const receipt = mapReceipt((await client.query("SELECT * FROM command_receipts WHERE id=$1", [existing.aggregate_id])).rows[0]);
        const command = mapCommand((await client.query("SELECT command.*, deployment.organization_id, deployment.agent_id, deployment.server_id FROM control_commands command JOIN control_deployments deployment ON deployment.id=command.deployment_id WHERE command.id=$1", [receipt.commandId])).rows[0]);
        return { receipt, command, verificationId: receipt.completionCandidate ? `verification:${receipt.id}` : null };
      }
      const { rows } = await client.query(
        `SELECT lease.id AS lease_id, lease.command_id, lease.deployment_id, lease.server_id AS lease_server_id,
                lease.attempt, lease.token_hash, lease.state AS lease_state, lease.expires_at AS lease_expires_at,
                command.*, attempt.state AS attempt_state, deployment.organization_id, deployment.agent_id,
                deployment.server_id, agent.owner_user_id
         FROM control_command_leases lease
         JOIN control_commands command ON command.id=lease.command_id
         JOIN command_attempts attempt ON attempt.command_id=lease.command_id AND attempt.attempt=lease.attempt
         JOIN control_deployments deployment ON deployment.id=lease.deployment_id
         JOIN agents agent ON agent.id=deployment.agent_id
         WHERE lease.id=$1 AND lease.command_id=$2 AND lease.attempt=$3
         FOR UPDATE OF lease,command,attempt`,
        [input.leaseId, input.commandId, input.attempt]
      );
      const current = rows[0];
      if (!current) throw controlError("lease_not_found", "Control command lease was not found", 404);
      if (current.organization_id !== input.organizationId
        || current.owner_user_id !== input.userId
        || current.agent_id !== input.agentId
        || current.server_id !== input.serverId
        || current.lease_server_id !== input.serverId
        || input.sourceIdentity !== input.serverId
        || current.deployment_id !== input.deploymentId) {
        throw controlError("owner_mismatch", "Receipt owner, deployment, or source scope does not match the lease", 404);
      }
      if (current.lease_state !== "active") throw controlError("lease_expired", "Control command lease is no longer active", 409);
      if (Date.parse(current.lease_expires_at) <= Date.now()) throw controlError("lease_expired", "Control command lease has expired", 409);
      if (current.token_hash !== hashToken(input.leaseToken)) throw controlError("lease_not_found", "Control command lease token is invalid", 404);
      const { rows: receiptSequenceRows } = await client.query("SELECT COALESCE(MAX(event_sequence),0) AS event_sequence FROM command_receipts WHERE command_id=$1 AND attempt=$2", [input.commandId, input.attempt]);
      if (input.eventSequence <= Number(receiptSequenceRows[0].event_sequence)) throw controlError("sequence_conflict", "Receipt event_sequence is not monotonic", 409);
      const transitions = {
        leased: ["accepted"],
        accepted: ["running", "executing", "failed", "cancelled", "expired"],
        running: ["running", "executing", "completion_candidate", "failed", "cancelled", "expired"]
      };
      if (!transitions[current.state]?.includes(input.state)) throw controlError("receipt_conflict", `Receipt cannot move command from ${current.state} to ${input.state}`, 409);
      const terminal = ["completion_candidate", "failed", "cancelled", "expired"].includes(input.state);
      if (terminal && !input.completedAt) throw controlError("missing_field", "Terminal receipts require completed_at", 400);
      const authorityState = input.state === "completion_candidate" ? "verifying" : input.state === "executing" ? "running" : input.state;
      const attemptState = input.state === "completion_candidate" ? "succeeded" : input.state === "executing" ? "running" : input.state;
      const verificationState = input.state === "completion_candidate" ? "checking" : input.state === "failed" ? "failed" : ["cancelled", "expired"].includes(input.state) ? "blocked" : "pending";
      const eventType = {
        accepted: "command.accepted",
        running: "command.started",
        executing: "command.executing",
        completion_candidate: "command.verification.started",
        failed: "command.failed",
        cancelled: "command.cancelled",
        expired: "command.expired"
      }[input.state];
      const eventState = input.state === "completion_candidate" ? "verifying" : input.state;
      const redactedError = input.errorCode ? `Control operation failed (${input.errorCode})` : null;
      const event = await this.appendEvent(client, {
        organizationId: input.organizationId, agentId: input.agentId, serverId: input.serverId, deploymentId: current.deployment_id,
        commandId: input.commandId, requestId: input.requestId, correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:event`, sourceIdentity: input.sourceIdentity ?? input.serverId, attempt: input.attempt,
        leaseId: input.leaseId, leaseTokenRef: `hint:lease-token:${input.leaseId}`,
        eventType, state: eventState, aggregateType: "control_command", aggregateId: input.commandId,
        evidenceRefs: input.evidenceRefs,
        summary: {
          receipt_id: input.id,
          command_id: input.commandId,
          attempt: input.attempt,
          receipt_state: input.state,
          authority_state: authorityState,
          error_code: input.errorCode,
          error_summary: redactedError,
          result_ref: input.resultRef,
          endpoint_ref: input.endpointRef
        },
        occurredAt: input.observedAt
      });
      const { rows: receiptRows } = await client.query(
        `INSERT INTO command_receipts
           (id, command_id, deployment_id, server_id, attempt, state, error_code, error_summary,
            runtime_endpoint_ref, result_summary, evidence_refs, lease_id, idempotency_key, event_sequence,
            observed_at, completed_at, result_ref, endpoint_ref, completion_candidate, source_identity,
            observation_version, error_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
        [input.id, input.commandId, current.deployment_id, input.serverId, input.attempt, input.state, input.errorCode,
          redactedError, input.endpointRef, jsonb(input.resultSummary), input.evidenceRefs, input.leaseId, input.idempotencyKey,
          input.eventSequence, input.observedAt, input.completedAt, input.resultRef, input.endpointRef,
          input.state === "completion_candidate", input.sourceIdentity, input.observationVersion, input.errorRef]
      );
      await client.query(
        `UPDATE control_commands
         SET state=$2, verification_state=$3,
             completion_candidate_at=CASE WHEN $2='verifying' THEN COALESCE($4,now()) ELSE completion_candidate_at END,
             finalized_at=CASE WHEN $2 IN ('failed','cancelled','expired') THEN COALESCE($4,now()) ELSE finalized_at END,
             lease_expires_at=CASE WHEN $2 IN ('accepted','running') THEN lease_expires_at ELSE NULL END,
             updated_at=now()
         WHERE id=$1`,
        [input.commandId, authorityState, verificationState, input.completedAt]
      );
      await client.query(
        `UPDATE command_attempts
         SET state=$3, error_code=$4, error_summary=$5,
             started_at=CASE WHEN $3 IN ('accepted','running') THEN COALESCE(started_at,now()) ELSE started_at END,
             completed_at=CASE WHEN $3 IN ('succeeded','failed','cancelled','expired') THEN COALESCE($6,now()) ELSE completed_at END,
             evidence_refs=$7
         WHERE command_id=$1 AND attempt=$2`,
        [input.commandId, input.attempt, attemptState, input.errorCode, redactedError, input.completedAt, input.evidenceRefs]
      );
      if (terminal) await client.query("UPDATE control_command_leases SET state='consumed', consumed_at=COALESCE($2,now()) WHERE id=$1 AND state='active'", [input.leaseId, input.completedAt]);
      let verificationId = null;
      if (input.state === "completion_candidate") {
        verificationId = `verification:${input.id}`;
        await client.query(
          `INSERT INTO command_verifications
             (id, command_id, deployment_id, attempt, receipt_id, expected_observation_version, observation_version, status, evidence_refs, started_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'checking',$8,now())`,
          [verificationId, input.commandId, current.deployment_id, input.attempt, input.id, Number(current.expected_observation_version), input.observationVersion, input.evidenceRefs]
        );
      }
      await this.saveIdempotency(client, { namespace: "command-receipt", organizationId: input.organizationId, deploymentId: current.deployment_id, idempotencyKey: input.idempotencyKey, requestHash, aggregateType: "command_receipt", aggregateId: input.id, resultRef: `ref:control-event:${event.id}` });
      const commandRow = (await client.query("SELECT command.*, deployment.organization_id, deployment.agent_id, deployment.server_id FROM control_commands command JOIN control_deployments deployment ON deployment.id=command.deployment_id WHERE command.id=$1", [input.commandId])).rows[0];
      return { receipt: mapReceipt(receiptRows[0]), command: mapCommand(commandRow), verificationId };
    });
  }

  async verifyCommand(input) {
    assertOperationalMetadata(input.checks, "Verification.checks");
    const requestHash = digestControlValue(input);
    return inTransaction(this.pool, async (client) => {
      const existing = await this.lockIdempotency(client, { namespace: "command-verification", organizationId: input.organizationId, idempotencyKey: input.idempotencyKey, requestHash });
      if (existing) {
        const verification = (await client.query("SELECT * FROM command_verifications WHERE id=$1", [existing.result_ref?.replace(/^ref:verification:/, "") ?? input.id])).rows[0];
        const command = mapCommand((await client.query("SELECT command.*, deployment.organization_id, deployment.agent_id, deployment.server_id FROM control_commands command JOIN control_deployments deployment ON deployment.id=command.deployment_id WHERE command.id=$1", [existing.aggregate_id])).rows[0]);
        return { verification, command };
      }
      const { rows } = await client.query(
        `SELECT verification.*, command.state AS command_state, command.verification_state AS command_verification_state,
                command.expected_observation_version, command.action, receipt.completed_at AS receipt_completed_at,
                receipt.created_at AS receipt_created_at, deployment.organization_id, deployment.agent_id,
                deployment.server_id, deployment.desired_state_version, agent.owner_user_id
         FROM command_verifications verification
         JOIN control_commands command ON command.id=verification.command_id
         JOIN command_receipts receipt ON receipt.id=verification.receipt_id
         JOIN control_deployments deployment ON deployment.id=verification.deployment_id
         JOIN agents agent ON agent.id=deployment.agent_id
         WHERE verification.command_id=$1 AND verification.attempt=$2
         FOR UPDATE OF verification,command`,
        [input.commandId, input.attempt]
      );
      const current = rows[0];
      if (!current || current.id !== input.id) throw controlError("evidence_not_found", "Command verification candidate was not found", 404);
      if (current.organization_id !== input.organizationId || current.owner_user_id !== input.userId || current.agent_id !== input.agentId || current.server_id !== input.serverId) throw controlError("owner_mismatch", "Verification owner scope does not match the command", 404);
      if (current.command_state !== "verifying" || current.command_verification_state !== "checking" || current.status !== "checking") throw controlError("receipt_conflict", "Command is not awaiting verification", 409);
      const { rows: observationRows } = await client.query("SELECT * FROM observations WHERE id=$1 AND deployment_id=$2", [input.observationId, current.deployment_id]);
      const observation = observationRows[0];
      if (!observation) throw controlError("evidence_not_found", "Verification observation was not found", 404);
      if (input.status === "verified") {
        const receiptCompletedAt = current.receipt_completed_at ?? current.receipt_created_at;
        const freshnessSeconds = Math.max(0, Math.floor((Date.parse(input.completedAt) - Date.parse(observation.observed_at)) / 1000));
        if (observation.status !== "healthy" || observation.freshness !== "fresh") throw controlError("stale_observation", "A verified command requires a fresh healthy observation", 409);
        if (Number(observation.version) !== Number(current.observation_version)) throw controlError("revision_conflict", "Verification observation does not match the completion candidate", 409);
        if (Number(observation.version) <= Number(current.expected_observation_version)) throw controlError("revision_conflict", "Verification observation is not newer than the command precondition", 409);
        if (Number(observation.desired_state_version) !== Number(current.desired_state_version)) throw controlError("revision_conflict", "Verification observation does not match the active DesiredState", 409);
        if (Date.parse(observation.received_at) < Date.parse(receiptCompletedAt) || freshnessSeconds > input.maxFreshnessSeconds) throw controlError("evidence_not_found", "Verification observation is stale", 409);
        if (!current.evidence_refs?.length || !observation.evidence_refs?.length || !input.evidenceRefs.length) throw controlError("evidence_not_found", "Receipt, observation, and verification evidence references are required", 409);
      }
      const finalCommandState = input.status === "verified" ? "succeeded" : "failed";
      const { rows: verificationRows } = await client.query(
        `UPDATE command_verifications
         SET observation_id=$2, observation_version=$3, status=$4, checks=$5, evidence_refs=$6,
             verified_by=$7, completed_at=$8, updated_at=now()
         WHERE id=$1 RETURNING *`,
        [input.id, input.observationId, Number(observation.version), input.status, jsonb(input.checks), input.evidenceRefs, input.verifiedBy, input.completedAt]
      );
      await client.query("UPDATE control_commands SET state=$2, verification_state=$3, finalized_at=$4, updated_at=now() WHERE id=$1", [input.commandId, finalCommandState, input.status, input.completedAt]);
      await this.appendEvent(client, {
        organizationId: input.organizationId, agentId: input.agentId, serverId: input.serverId, deploymentId: current.deployment_id,
        commandId: input.commandId, requestId: input.requestId, correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:event`, sourceIdentity: input.verifiedBy, attempt: input.attempt,
        observationVersion: Number(observation.version), eventType: input.status === "verified" ? "command.verified" : "command.failed",
        state: finalCommandState, aggregateType: "control_command", aggregateId: input.commandId,
        evidenceRefs: input.evidenceRefs,
        summary: { command_id: input.commandId, verification_id: input.id, verification_status: input.status, observation_id: input.observationId, observation_version: Number(observation.version) },
        occurredAt: input.completedAt
      });
      await this.saveIdempotency(client, { namespace: "command-verification", organizationId: input.organizationId, deploymentId: current.deployment_id, idempotencyKey: input.idempotencyKey, requestHash, aggregateType: "control_command", aggregateId: input.commandId, resultRef: `ref:verification:${input.id}` });
      const commandRow = (await client.query("SELECT command.*, deployment.organization_id, deployment.agent_id, deployment.server_id FROM control_commands command JOIN control_deployments deployment ON deployment.id=command.deployment_id WHERE command.id=$1", [input.commandId])).rows[0];
      return { verification: verificationRows[0], command: mapCommand(commandRow) };
    });
  }

  async leaseOutbox(input = {}) {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    const leaseSeconds = Math.max(15, Math.min(input.leaseSeconds ?? 60, 300));
    return inTransaction(this.pool, async (client) => {
      await client.query("UPDATE control_outbox SET state='retry', lease_token_hash=NULL, lease_expires_at=NULL, available_at=now(), last_error_code='publisher_lease_expired', updated_at=now() WHERE state='processing' AND lease_expires_at<=now()");
      const { rows } = await client.query(
        `SELECT * FROM control_outbox
         WHERE state IN ('pending','retry') AND available_at<=now() AND attempts<max_attempts
         ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit]
      );
      const leased = [];
      for (const row of rows) {
        const leaseToken = `ref:outbox-token:${randomUUID()}`;
        const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
        const { rows: updatedRows } = await client.query(
          `UPDATE control_outbox
           SET state='processing', attempts=attempts+1, lease_token_hash=$2, lease_expires_at=$3, updated_at=now()
           WHERE id=$1 RETURNING *`,
          [row.id, hashToken(leaseToken), leaseExpiresAt]
        );
        const updated = updatedRows[0];
        leased.push({
          id: updated.id,
          organization_id: updated.organization_id,
          deployment_id: updated.deployment_id,
          event_id: updated.event_id,
          aggregate_type: updated.aggregate_type,
          aggregate_id: updated.aggregate_id,
          event_type: updated.event_type,
          body: updated.body,
          attempts: updated.attempts,
          lease_token: leaseToken,
          lease_expires_at: iso(updated.lease_expires_at)
        });
      }
      return leased;
    });
  }

  async settleOutbox(input) {
    return inTransaction(this.pool, async (client) => {
      const { rows } = await client.query("SELECT * FROM control_outbox WHERE id=$1 FOR UPDATE", [input.id]);
      const current = rows[0];
      if (!current || current.state !== "processing" || current.lease_token_hash !== hashToken(input.leaseToken)) throw controlError("lease_not_found", "Outbox lease was not found", 404);
      if (Date.parse(current.lease_expires_at) <= Date.now()) throw controlError("lease_expired", "Outbox lease has expired", 409);
      if (input.outcome === "published") {
        const { rows: publishedRows } = await client.query("UPDATE control_outbox SET state='published', published_at=now(), lease_token_hash=NULL, lease_expires_at=NULL, last_error_code=NULL, updated_at=now() WHERE id=$1 RETURNING *", [input.id]);
        return publishedRows[0];
      }
      const redactedError = redactControlMetadata(input.errorSummary).value ?? "Outbox delivery failed";
      if (Number(current.attempts) >= Number(current.max_attempts)) {
        await client.query(
          `INSERT INTO control_dead_letters
             (id, outbox_id, organization_id, deployment_id, event_type, body, error_code, error_summary, evidence_refs)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [randomUUID(), current.id, current.organization_id, current.deployment_id, current.event_type, jsonb(current.body),
            input.errorCode ?? "outbox_delivery_failed", redactedError, []]
        );
        const { rows: deadRows } = await client.query("UPDATE control_outbox SET state='dead_letter', lease_token_hash=NULL, lease_expires_at=NULL, last_error_code=$2, updated_at=now() WHERE id=$1 RETURNING *", [input.id, input.errorCode ?? "outbox_delivery_failed"]);
        return deadRows[0];
      }
      const { rows: retryRows } = await client.query(
        `UPDATE control_outbox
         SET state='retry', available_at=now()+($2::integer*interval '1 second'), lease_token_hash=NULL,
             lease_expires_at=NULL, last_error_code=$3, updated_at=now()
         WHERE id=$1 RETURNING *`,
        [input.id, Math.max(1, Math.min(input.retryDelaySeconds, 3600)), input.errorCode ?? "outbox_delivery_failed"]
      );
      return retryRows[0];
    });
  }

  async listDeploymentAggregates(input) {
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    const values = [input.organizationId];
    let cursorClause = "";
    if (input.cursor) {
      if (!input.cursor.updatedAt || !input.cursor.id || !Number.isFinite(Date.parse(input.cursor.updatedAt))) throw controlError("invalid_cursor", "Deployment query cursor is invalid");
      values.push(input.cursor.updatedAt, input.cursor.id);
      cursorClause = ` AND (deployment.updated_at,deployment.id)<($${values.length - 1}::timestamptz,$${values.length})`;
    }
    values.push(limit + 1);
    const { rows } = await this.pool.query(
      `SELECT deployment.id, deployment.organization_id, deployment.agent_id, deployment.server_id,
              deployment.name, deployment.environment, deployment.status, deployment.desired_state_version,
              deployment.observed_state_version, deployment.updated_at, agent.owner_user_id,
              to_jsonb(desired) AS desired_state, to_jsonb(observation) AS observation,
              COALESCE(command_counts.queued,0)::integer AS queued_commands,
              COALESCE(command_counts.verifying,0)::integer AS verifying_commands,
              COALESCE(command_counts.failed,0)::integer AS failed_commands
       FROM control_deployments deployment
       JOIN agents agent ON agent.id=deployment.agent_id
       LEFT JOIN LATERAL (
         SELECT id,version,state,lifecycle_status,config_revision_id,release_manifest_id,backup_id,valid_from,expires_at,updated_at
         FROM desired_states WHERE deployment_id=deployment.id ORDER BY version DESC LIMIT 1
       ) desired ON true
       LEFT JOIN LATERAL (
         SELECT id,version,desired_state_version,status,freshness,evidence_refs,observed_at,received_at,freshness_seconds
         FROM observations WHERE deployment_id=deployment.id ORDER BY version DESC LIMIT 1
       ) observation ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE state='queued') AS queued,
                count(*) FILTER (WHERE state='verifying') AS verifying,
                count(*) FILTER (WHERE state='failed') AS failed
         FROM control_commands WHERE deployment_id=deployment.id
       ) command_counts ON true
       WHERE deployment.organization_id=$1${cursorClause}
       ORDER BY deployment.updated_at DESC,deployment.id DESC LIMIT $${values.length}`,
      values
    );
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      ownerUserId: row.owner_user_id,
      agentId: row.agent_id,
      serverId: row.server_id,
      name: row.name,
      environment: row.environment,
      status: row.status,
      desiredStateVersion: Number(row.desired_state_version),
      observedStateVersion: Number(row.observed_state_version),
      desiredState: row.desired_state,
      observation: row.observation,
      commandCounts: { queued: row.queued_commands, verifying: row.verifying_commands, failed: row.failed_commands },
      updatedAt: iso(row.updated_at)
    }));
    const last = items.at(-1);
    return { items, nextCursor: hasMore && last ? { updatedAt: last.updatedAt, id: last.id } : null };
  }
}
