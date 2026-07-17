function errorCode(error) {
  return String(error?.code ?? "channel_runtime_failed").replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 200) || "channel_runtime_failed";
}

function messageText(job) {
  if (!["text", "markdown"].includes(job.content?.kind) || typeof job.content.text !== "string" || !job.content.text.trim()) {
    throw Object.assign(new Error("Channel content is not supported by the Runtime bridge"), { code: "unsupported_channel_content" });
  }
  return job.content.text.trim();
}

export class ChannelIngressWorker {
  constructor(options) {
    this.repository = options.repository;
    this.runtimeClient = options.runtimeClient;
    this.intervalMs = Math.max(100, Number(options.intervalMs) || 1_000);
    this.batchSize = Math.max(1, Math.min(Number(options.batchSize) || 8, 100));
    this.leaseSeconds = Math.max(5, Math.min(Number(options.leaseSeconds) || 90, 300));
    this.baseRetryMs = Math.max(100, Number(options.baseRetryMs) || 1_000);
    this.maxRetryMs = Math.max(this.baseRetryMs, Number(options.maxRetryMs) || 300_000);
    this.logger = options.logger ?? console;
    this.timer = null;
    this.running = false;
  }

  async process(job) {
    try {
      const agent = await this.repository.getAgent(job.agentId);
      if (!agent || agent.organizationId !== job.organizationId || agent.ownerUserId !== job.userId) throw Object.assign(new Error("Channel Agent ownership is invalid"), { code: "channel_agent_not_found" });
      const conversation = await this.repository.ensureChannelConversation({
        organizationId: job.organizationId,
        userId: job.userId,
        agentId: job.agentId,
        bindingId: job.bindingId,
        channel: job.channel,
        channelConversationId: job.conversation.channel_conversation_id,
        conversationKind: job.conversation.kind,
        lastMessageAt: job.receivedAt
      });
      const result = await this.runtimeClient.invoke({
        principal: { organizationId: job.organizationId, userId: job.userId, role: "user" },
        agent,
        conversation: { id: conversation.runtimeConversationId },
        content: messageText(job),
        channelContext: {
          channel: job.channel,
          bindingId: job.bindingId,
          channelAccountId: job.channelAccountId,
          externalSenderId: job.sender.channel_user_id,
          externalMessageId: job.externalMessageId,
          conversationKind: job.conversation.kind
        }
      });
      const reply = typeof result.content === "string" ? result.content.trim() : "";
      const completed = await this.repository.completeChannelIngress({
        id: job.id,
        leaseToken: job.leaseToken,
        outbound: reply ? { content: { kind: "text", text: reply }, trace: job.trace, replyToMessageId: job.externalMessageId } : null
      });
      if (!completed) throw Object.assign(new Error("Channel ingress lease was lost"), { code: "channel_ingress_lease_lost" });
      return completed;
    } catch (error) {
      const code = errorCode(error);
      const delay = Math.min(this.maxRetryMs, this.baseRetryMs * (2 ** Math.max(0, job.attempts - 1)));
      await this.repository.failChannelIngress({ id: job.id, leaseToken: job.leaseToken, errorCode: code, availableAt: new Date(Date.now() + delay).toISOString() });
      this.logger.error?.("Channel ingress processing failed", { ingressId: job.id, agentId: job.agentId, channel: job.channel, errorCode: code });
      return null;
    }
  }

  async runOnce() {
    if (this.running) return [];
    this.running = true;
    try {
      const jobs = await this.repository.leaseChannelIngress({ limit: this.batchSize, leaseSeconds: this.leaseSeconds });
      return Promise.all(jobs.map((job) => this.process(job)));
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer) return this;
    const tick = async () => {
      await this.runOnce().catch((error) => this.logger.error?.("Channel ingress worker failed", { errorCode: errorCode(error) }));
      if (this.timer) this.timer = setTimeout(tick, this.intervalMs);
    };
    this.timer = setTimeout(tick, 0);
    return this;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
