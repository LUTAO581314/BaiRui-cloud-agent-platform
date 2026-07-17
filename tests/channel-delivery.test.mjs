import assert from "node:assert/strict";
import test from "node:test";
import { MemoryPlatformRepository } from "../packages/db/memory-repository.mjs";
import { ChannelIngressWorker } from "../packages/channels/ingress-worker.mjs";

async function fixture() {
  const repository = new MemoryPlatformRepository();
  await repository.createOrganization({ id: "org_channel", name: "Channel Test" });
  await repository.createUser({ id: "user_channel", organizationId: "org_channel", email: "channel@test.invalid", displayName: "Channel User", passwordHash: "unused", role: "user" });
  await repository.createAgent({ id: "agent_channel", organizationId: "org_channel", ownerUserId: "user_channel", name: "Channel Agent" });
  const binding = await repository.upsertAgentChannelBinding({ id: "binding_channel", organizationId: "org_channel", userId: "user_channel", agentId: "agent_channel", channel: "feishu", displayName: "Feishu", status: "pending", credentialEnvelope: { encrypted: true } });
  return { repository, binding };
}

function ingress(binding, overrides = {}) {
  return {
    id: "ingress_channel_1",
    bindingId: binding.id,
    agentId: binding.agentId,
    channel: binding.channel,
    channelAccountId: "app_channel",
    externalMessageId: "message_channel_1",
    sender: { channel_user_id: "sender_channel" },
    conversation: { channel_conversation_id: "conversation_channel", kind: "group" },
    content: { kind: "text", text: "hello" },
    attachments: [],
    trace: { correlation_id: "trace_channel_1" },
    receivedAt: new Date().toISOString(),
    ...overrides
  };
}

test("channel inbox is deduplicated and produces one durable outbound delivery", async () => {
  const { repository, binding } = await fixture();
  const accepted = await repository.acceptChannelIngress(ingress(binding));
  assert.equal(accepted.status, "accepted");
  assert.equal((await repository.acceptChannelIngress(ingress(binding))).status, "duplicate");

  const [job] = await repository.leaseChannelIngress({ limit: 1, leaseSeconds: 30, leaseId: "inbox_lease" });
  assert.equal(job.attempts, 1);
  assert.deepEqual(await repository.leaseChannelIngress({ limit: 1, leaseSeconds: 30 }), []);

  const firstConversation = await repository.ensureChannelConversation({ organizationId: job.organizationId, userId: job.userId, agentId: job.agentId, bindingId: job.bindingId, channel: job.channel, channelConversationId: job.conversation.channel_conversation_id, conversationKind: job.conversation.kind, runtimeConversationId: "runtime_conversation_1" });
  const sameConversation = await repository.ensureChannelConversation({ organizationId: job.organizationId, userId: job.userId, agentId: job.agentId, bindingId: job.bindingId, channel: job.channel, channelConversationId: job.conversation.channel_conversation_id, conversationKind: job.conversation.kind, runtimeConversationId: "must_not_replace" });
  assert.equal(sameConversation.runtimeConversationId, firstConversation.runtimeConversationId);

  const completed = await repository.completeChannelIngress({ id: job.id, leaseToken: job.leaseToken, outbound: { id: "outbound_channel_1", content: { kind: "text", text: "reply" } } });
  assert.equal(completed.inbox.state, "completed");
  assert.equal(completed.outbound.state, "pending");

  const firstLease = await repository.leaseChannelDeliveries({ agentId: binding.agentId, workerId: "worker_channel", channels: ["feishu"], limit: 10, leaseSeconds: 30, leaseId: "outbox_lease_1" });
  assert.equal(firstLease.deliveries.length, 1);
  const firstDelivery = firstLease.deliveries[0];
  const retry = await repository.recordChannelDeliveryReceipt({ outboundId: firstDelivery.id, bindingId: firstDelivery.bindingId, agentId: firstDelivery.agentId, workerId: "worker_channel", leaseToken: firstDelivery.leaseToken, attempt: firstDelivery.attempts, status: "retryable", retryAfterMs: 0, errorCode: "vendor_busy", observedAt: new Date().toISOString() });
  assert.equal(retry.outbound.state, "retry");

  const secondDelivery = (await repository.leaseChannelDeliveries({ agentId: binding.agentId, workerId: "worker_channel", channels: ["feishu"], limit: 10, leaseSeconds: 30, leaseId: "outbox_lease_2" })).deliveries[0];
  assert.equal(secondDelivery.attempts, 2);
  const delivered = await repository.recordChannelDeliveryReceipt({ outboundId: secondDelivery.id, bindingId: secondDelivery.bindingId, agentId: secondDelivery.agentId, workerId: "worker_channel", leaseToken: secondDelivery.leaseToken, attempt: secondDelivery.attempts, status: "delivered", channelMessageId: "vendor_message_2", observedAt: new Date().toISOString() });
  assert.equal(delivered.outbound.state, "delivered");
  assert.equal((await repository.getChannelBindingById(binding.id)).lastOutboundAt, delivered.receipt.observedAt);
});

test("channel health is metadata only and updates connection evidence monotonically", async () => {
  const { repository, binding } = await fixture();
  const observedAt = new Date().toISOString();
  const saved = await repository.saveChannelHealthReport({ bindingId: binding.id, agentId: binding.agentId, channel: binding.channel, workerId: "worker_channel", sequence: 1, status: "connected", capabilities: ["receive", "send", "websocket"], adapterVersion: "1.0.0", latencyMs: 12, observedAt });
  assert.equal(saved.binding.status, "connected");
  assert.deepEqual(saved.binding.capabilities, ["receive", "send", "websocket"]);

  const older = new Date(Date.parse(observedAt) - 60_000).toISOString();
  await repository.saveChannelHealthReport({ bindingId: binding.id, agentId: binding.agentId, channel: binding.channel, workerId: "worker_channel", sequence: 2, status: "error", capabilities: [], errorCode: "stale_probe", observedAt: older });
  assert.equal((await repository.getChannelBindingById(binding.id)).status, "connected");
});

test("channel ingress worker invokes Runtime with tenant and external identity context", async () => {
  const { repository, binding } = await fixture();
  await repository.acceptChannelIngress(ingress(binding));
  let invocation;
  const worker = new ChannelIngressWorker({
    repository,
    runtimeClient: { invoke: async (input) => { invocation = input; return { content: "Runtime reply" }; } },
    logger: { error: () => assert.fail("worker should not log an error") }
  });
  const [processed] = await worker.runOnce();
  assert.equal(processed.inbox.state, "completed");
  assert.equal(invocation.principal.organizationId, binding.organizationId);
  assert.equal(invocation.channelContext.channel, "feishu");
  assert.equal(invocation.channelContext.externalSenderId, "sender_channel");
  assert.equal(invocation.channelContext.externalMessageId, "message_channel_1");
  const delivery = (await repository.leaseChannelDeliveries({ agentId: binding.agentId, workerId: "worker_channel", channels: ["feishu"], limit: 1, leaseSeconds: 30 })).deliveries[0];
  assert.equal(delivery.content.text, "Runtime reply");
});
