import { randomUUID } from "node:crypto";
import { signControlMutation } from "../../packages/security/control-mutation.mjs";

export const CONTROL_SCOPE = Object.freeze({
  organizationId: "org_a",
  userId: "user_a",
  agentId: "agent_a",
  serverId: "server_a"
});

export const CONTROL_TOKEN = "server-token-that-is-longer-than-thirty-two-characters";

export function canonicalLease(request, options = {}) {
  const issuedMs = Math.max(Date.now(), Date.parse(request.created_at));
  const issuedAt = new Date(issuedMs).toISOString();
  const leaseExpiresAt = new Date(issuedMs + (options.leaseMilliseconds ?? 120_000)).toISOString();
  const commandExpiresAt = new Date(issuedMs + (options.commandMilliseconds ?? 60_000)).toISOString();
  const leaseId = options.leaseId ?? `lease_${randomUUID()}`;
  const action = options.action ?? "deployment.start";
  const command = {
    schema_version: "1.0",
    command_id: options.commandId ?? `command_${randomUUID()}`,
    idempotency_key: options.commandIdempotencyKey ?? `command:${randomUUID()}`,
    deployment_id: options.deploymentId ?? "deployment_a",
    action,
    target: { module_id: "control-supervisor", instance_id: request.agent_id },
    arguments: options.arguments ?? { agent_id: request.agent_id },
    ...(options.approvalId ? { approval_id: options.approvalId } : {}),
    expected_observation_version: options.expectedObservationVersion ?? 1,
    created_at: issuedAt,
    expires_at: commandExpiresAt,
    attempt: options.attempt ?? 1,
    lease_id: leaseId,
    lease_token: options.leaseToken ?? `ref:lease-token-${randomUUID()}`,
    lease_expires_at: leaseExpiresAt,
    placement: {
      organization_id: request.organization_id,
      user_id: request.user_id,
      agent_id: request.agent_id,
      server_id: request.server_id,
      ...options.placement
    },
    ...(options.secretRefs ? { secret_refs: options.secretRefs } : {}),
    ...(options.extraCommand ?? {})
  };
  return signControlMutation({
    schema_version: "1.0",
    organization_id: request.organization_id,
    user_id: request.user_id,
    agent_id: request.agent_id,
    server_id: request.server_id,
    request_id: request.request_id,
    correlation_id: request.correlation_id,
    idempotency_key: `lease-grant:${randomUUID()}`,
    created_at: issuedAt,
    revision: 1,
    sequence: request.sequence + 1,
    lease_id: leaseId,
    lease_expires_at: leaseExpiresAt,
    issued_at: issuedAt,
    commands: [command],
    ...options.extraLease
  }, {
    token: options.token ?? CONTROL_TOKEN,
    keyId: options.keyId ?? request.server_id,
    signedAt: issuedAt,
    now: issuedMs
  });
}

export function canonicalClientOptions(overrides = {}) {
  return {
    platformUrl: "https://platform.example.test",
    ...CONTROL_SCOPE,
    token: CONTROL_TOKEN,
    ...overrides
  };
}
