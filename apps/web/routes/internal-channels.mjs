import {
  CHANNEL_PROTOCOL_VERSION,
  validateChannelBindingInventory,
  validateChannelBindingInventoryRequest,
  validateChannelCredentialResolution,
  validateChannelCredentialResolutionRequest,
  validateChannelDeliveryBatch,
  validateChannelDeliveryLeaseRequest,
  validateChannelDeliveryReceipt,
  validateChannelHealthReport,
  validateChannelIngress,
  validateChannelIngressAck
} from "@bairui/contracts";
import { json, readSignedJson } from "../http.mjs";
import { workspaceIdFromRef } from "../../../packages/server-protocol/runtime-client.mjs";

function accepted(validator, value) {
  try { return validator(value); }
  catch { return null; }
}

async function ownerScope(repository, item, conversationId) {
  const runtime = await repository.getAgentRuntimeByAgent(item.agentId);
  if (!runtime || runtime.organizationId !== item.organizationId || runtime.ownerUserId !== item.userId) return null;
  const scope = {
    organization_id: item.organizationId,
    user_id: item.userId,
    agent_id: item.agentId,
    workspace_id: workspaceIdFromRef(runtime.workspaceRef)
  };
  if (conversationId) scope.conversation_id = conversationId;
  return scope;
}

function sameOwnerScope(left, right) {
  if (!left || !right) return false;
  const fields = ["organization_id", "user_id", "agent_id", "workspace_id"];
  if (left.conversation_id !== undefined || right.conversation_id !== undefined) fields.push("conversation_id");
  return fields.every((field) => left[field] === right[field]);
}

async function publicDelivery(repository, item) {
  const conversationId = item.conversation?.runtime_conversation_id;
  const scope = conversationId ? await ownerScope(repository, item, conversationId) : null;
  if (!scope) throw Object.assign(new Error("Channel delivery is missing its Runtime conversation scope"), { code: "channel_delivery_scope_unavailable" });
  return {
    owner_scope: scope,
    outbound_id: item.id,
    binding_id: item.bindingId,
    channel: item.channel,
    channel_account_id: item.channelAccountId,
    conversation: {
      channel_conversation_id: item.conversation.channel_conversation_id,
      kind: item.conversation.kind
    },
    content: item.content,
    attachments: item.attachments ?? [],
    ...(item.replyToMessageId ? { reply_to_message_id: item.replyToMessageId } : {}),
    attempt: item.attempts,
    lease_token: item.leaseToken,
    available_at: item.availableAt,
    trace: item.trace
  };
}

function authorized(machine, binding) {
  return Boolean(binding)
    && (!machine.credential.organizationId || binding.organizationId === machine.credential.organizationId)
    && machine.credential.allowedChannels.includes(binding.channel);
}

function channelAccountId(binding) {
  const value = binding.metadata?.accountId;
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value) ? value : binding.id;
}

export function createInternalChannelRoutes(options) {
  const { repository, providerVault, authenticateMachine } = options;

  return async function routeInternalChannels(context) {
    const { method, url, request, response } = context;
    if (method !== "POST" || !url.pathname.startsWith("/api/internal/channels/")) return false;
    const send = (statusCode, body) => {
      json(response, statusCode, body);
      return true;
    };

    const signed = await readSignedJson(request);
    const machine = await authenticateMachine(request, url, signed.raw, "channel-worker");
    if (!machine) return send(401, { error: "invalid_channel_worker_credential" });

    if (url.pathname === "/api/internal/channels/bindings") {
      const inventoryRequest = accepted(validateChannelBindingInventoryRequest, signed.body);
      if (!inventoryRequest || inventoryRequest.worker_id !== machine.machineId) return send(400, { error: "invalid_channel_binding_inventory_request" });
      const bindings = await repository.listChannelBindingsForWorker({ organizationId: machine.credential.organizationId, allowedChannels: machine.credential.allowedChannels, channels: inventoryRequest.channels });
      const publicBindings = await Promise.all(bindings.map(async (binding) => ({
        id: binding.id,
        owner_scope: await ownerScope(repository, binding),
        channel: binding.channel,
        channel_account_id: channelAccountId(binding),
        status: binding.status,
        connection_generation: binding.connectionGeneration,
        ...(binding.channel === "wechat" ? { callback_path: `/callbacks/wechat/${encodeURIComponent(binding.id)}` } : {}),
        updated_at: binding.updatedAt
      })));
      if (publicBindings.some((binding) => !binding.owner_scope)) return send(409, { error: "channel_binding_scope_unavailable" });
      const inventory = validateChannelBindingInventory({
        schema_version: CHANNEL_PROTOCOL_VERSION,
        worker_id: machine.machineId,
        bindings: publicBindings,
        generated_at: new Date().toISOString(),
        trace: inventoryRequest.trace
      });
      return send(200, inventory);
    }

    const credentialMatch = url.pathname.match(/^\/api\/internal\/channels\/bindings\/([^/]+)\/resolve$/);
    if (credentialMatch) {
      if (!providerVault) return send(503, { error: "channel_secret_storage_unavailable" });
      const bindingId = decodeURIComponent(credentialMatch[1]);
      const resolutionRequest = accepted(validateChannelCredentialResolutionRequest, signed.body);
      const binding = await repository.getChannelBindingById(bindingId);
      const bindingScope = binding ? await ownerScope(repository, binding) : null;
      if (!resolutionRequest || resolutionRequest.worker_id !== machine.machineId || resolutionRequest.binding_id !== bindingId || !authorized(machine, binding) || !sameOwnerScope(resolutionRequest.owner_scope, bindingScope) || !binding.credentialEnvelope || ["disabled", "unconfigured"].includes(binding.status)) return send(404, { error: "channel_binding_not_available" });
      let values;
      try {
        const opened = JSON.parse(providerVault.open(binding.credentialEnvelope));
        values = Object.fromEntries(Object.entries(opened).filter(([, value]) => typeof value === "string" && value.length > 0));
      } catch {
        return send(500, { error: "channel_credential_unavailable" });
      }
      const resolved = accepted(validateChannelCredentialResolution, {
        schema_version: CHANNEL_PROTOCOL_VERSION,
        binding: {
          id: binding.id,
          owner_scope: bindingScope,
          channel: binding.channel,
          channel_account_id: channelAccountId(binding),
          metadata: binding.metadata ?? {}
        },
        credential: { values }
      });
      if (!resolved) return send(500, { error: "invalid_stored_channel_credential" });
      await repository.recordAudit({ organizationId: binding.organizationId, actorUserId: null, action: "agent.channel.credential.resolve", targetType: "agent_channel_binding", targetId: binding.id, metadata: { agentId: binding.agentId, channel: binding.channel, machineCredentialId: machine.credential.id } });
      return send(200, resolved);
    }

    if (url.pathname === "/api/internal/channels/ingress") {
      const ingress = accepted(validateChannelIngress, signed.body);
      if (!ingress) return send(400, { error: "invalid_channel_ingress" });
      const binding = await repository.getChannelBindingById(ingress.binding_id);
      const bindingScope = binding ? await ownerScope(repository, binding) : null;
      if (!authorized(machine, binding) || binding.channel !== ingress.channel || !sameOwnerScope(ingress.owner_scope, bindingScope)) return send(404, { error: "channel_binding_not_available" });
      const result = await repository.acceptChannelIngress({
        id: ingress.ingress_id,
        bindingId: ingress.binding_id,
        agentId: binding.agentId,
        channel: ingress.channel,
        channelAccountId: ingress.channel_account_id,
        externalMessageId: ingress.message_id,
        sender: ingress.sender,
        conversation: ingress.conversation,
        content: ingress.content,
        attachments: ingress.attachments ?? [],
        replyToMessageId: ingress.reply_to_message_id,
        trace: ingress.trace,
        receivedAt: ingress.received_at
      });
      if (!result) return send(404, { error: "channel_binding_not_available" });
      const acknowledgement = validateChannelIngressAck({ schema_version: CHANNEL_PROTOCOL_VERSION, owner_scope: ingress.owner_scope, ingress_id: ingress.ingress_id, status: result.status, acknowledged_at: new Date().toISOString(), trace: ingress.trace });
      if (result.status === "accepted") await repository.recordAudit({ organizationId: result.binding.organizationId, actorUserId: null, action: "agent.channel.ingress.accept", targetType: "agent_channel_binding", targetId: result.binding.id, metadata: { agentId: result.binding.agentId, channel: result.binding.channel, ingressId: result.inbox.id } });
      return send(202, acknowledgement);
    }

    if (url.pathname === "/api/internal/channels/deliveries/lease") {
      const leaseRequest = accepted(validateChannelDeliveryLeaseRequest, signed.body);
      if (!leaseRequest || leaseRequest.worker_id !== machine.machineId) return send(400, { error: "invalid_channel_delivery_lease" });
      const channels = leaseRequest.channels.filter((channel) => machine.credential.allowedChannels.includes(channel));
      if (!channels.length) return send(403, { error: "channel_not_allowed" });
      const leased = await repository.leaseChannelDeliveries({ organizationId: machine.credential.organizationId, workerId: leaseRequest.worker_id, channels, bindingIds: leaseRequest.binding_ids ?? [], limit: leaseRequest.limit, leaseSeconds: leaseRequest.lease_seconds });
      const leasedUntil = leased.deliveries.map((item) => item.leaseExpiresAt).filter(Boolean).sort()[0] ?? new Date(Date.now() + leaseRequest.lease_seconds * 1000).toISOString();
      const deliveries = await Promise.all(leased.deliveries.map((item) => publicDelivery(repository, item)));
      const batch = validateChannelDeliveryBatch({ schema_version: CHANNEL_PROTOCOL_VERSION, lease_id: leased.leaseId, worker_id: leaseRequest.worker_id, deliveries, leased_until: leasedUntil, trace: leaseRequest.trace });
      return send(200, batch);
    }

    if (url.pathname === "/api/internal/channels/delivery-receipts") {
      const receipt = accepted(validateChannelDeliveryReceipt, signed.body);
      if (!receipt) return send(400, { error: "invalid_channel_delivery_receipt" });
      const [binding, outbound] = await Promise.all([
        repository.getChannelBindingById(receipt.binding_id),
        repository.getChannelOutboundById(receipt.outbound_id)
      ]);
      const deliveryScope = outbound?.bindingId === receipt.binding_id && outbound.conversation?.runtime_conversation_id
        ? await ownerScope(repository, outbound, outbound.conversation.runtime_conversation_id)
        : null;
      if (!authorized(machine, binding) || !sameOwnerScope(receipt.owner_scope, deliveryScope)) return send(404, { error: "channel_binding_not_available" });
      const result = await repository.recordChannelDeliveryReceipt({
        outboundId: receipt.outbound_id,
        bindingId: receipt.binding_id,
        agentId: binding.agentId,
        workerId: machine.machineId,
        leaseToken: receipt.lease_token,
        status: receipt.status,
        attempt: receipt.attempt,
        channelMessageId: receipt.channel_message_id,
        errorCode: receipt.error_code,
        retryAfterMs: receipt.retry_after_ms,
        observedAt: receipt.observed_at
      });
      if (!result) return send(409, { error: "channel_delivery_lease_not_found" });
      return send(202, { receipt: { outboundId: result.receipt.outboundId, status: result.receipt.status, observedAt: result.receipt.observedAt } });
    }

    if (url.pathname === "/api/internal/channels/health") {
      const health = accepted(validateChannelHealthReport, signed.body);
      if (!health || health.worker_id !== machine.machineId) return send(400, { error: "invalid_channel_health" });
      const binding = await repository.getChannelBindingById(health.binding_id);
      const bindingScope = binding ? await ownerScope(repository, binding) : null;
      if (!authorized(machine, binding) || binding.channel !== health.channel || !sameOwnerScope(health.owner_scope, bindingScope)) return send(404, { error: "channel_binding_not_available" });
      const result = await repository.saveChannelHealthReport({ bindingId: health.binding_id, agentId: binding.agentId, channel: health.channel, workerId: health.worker_id, sequence: health.sequence, status: health.status, capabilities: health.capabilities, adapterVersion: health.adapter_version, latencyMs: health.latency_ms, lastInboundAt: health.last_inbound_at, lastOutboundAt: health.last_outbound_at, errorCode: health.error_code, observedAt: health.observed_at });
      if (!result) return send(404, { error: "channel_binding_not_available" });
      return send(202, { bindingId: result.binding.id, status: result.binding.status, observedAt: result.observation.observedAt });
    }

    return false;
  };
}
