import { randomUUID } from "node:crypto";
import { FeishuChannelAdapter } from "./adapters/feishu.mjs";
import { QQChannelAdapter } from "./adapters/qq.mjs";
import { WechatOfficialChannelAdapter } from "./adapters/wechat-official.mjs";
import { adapterErrorCode } from "./adapters/utilities.mjs";

const SUPPORTED_CHANNELS = new Set(["feishu", "wechat", "qq"]);

export class ChannelWorker {
  constructor(options) {
    this.platform = options.platform;
    this.workerId = options.workerId ?? this.platform.machineId;
    this.bindings = Array.isArray(options.bindings) ? options.bindings : [];
    this.channels = options.channels ?? ["feishu", "wechat", "qq"];
    this.logger = options.logger ?? console;
    this.intervalMs = Math.max(250, Number(options.intervalMs) || 1_000);
    this.leaseSeconds = Math.max(5, Math.min(Number(options.leaseSeconds) || 60, 300));
    this.batchSize = Math.max(1, Math.min(Number(options.batchSize) || 20, 100));
    this.inventoryIntervalMs = Math.max(1_000, Number(options.inventoryIntervalMs) || 30_000);
    this.adapterFactories = options.adapterFactories ?? {
      feishu: (config) => new FeishuChannelAdapter(config),
      wechat: (config) => new WechatOfficialChannelAdapter(config),
      qq: (config) => new QQChannelAdapter(config)
    };
    this.adapters = new Map();
    this.generations = new Map();
    this.timer = null;
    this.inventoryTimer = null;
    this.running = false;
    this.refreshing = false;
    this.inventoryReady = false;
    this.stopped = false;
    for (const binding of this.bindings) if (!binding?.id || !SUPPORTED_CHANNELS.has(binding.channel)) throw new TypeError("Channel Worker binding is invalid");
    if (!Array.isArray(this.channels) || !this.channels.length || this.channels.some((channel) => !SUPPORTED_CHANNELS.has(channel))) throw new TypeError("Channel Worker channels are invalid");
  }

  async startAdapter(descriptor) {
    const resolved = await this.platform.resolveBinding(descriptor.id);
    if (resolved.binding.id !== descriptor.id || resolved.binding.channel !== descriptor.channel) throw Object.assign(new Error("Channel binding scope does not match Worker inventory"), { code: "channel_binding_scope_mismatch" });
    const factory = this.adapterFactories[descriptor.channel];
    const adapter = factory({ binding: { id: descriptor.id, channel: descriptor.channel, workerId: this.workerId }, credentials: resolved.credential.values, platform: this.platform, logger: this.logger });
    try {
      await adapter.start();
      this.adapters.set(descriptor.id, adapter);
      return true;
    }
    catch (error) {
      await adapter.stop?.().catch(() => undefined);
      await adapter.report?.("error", [], error).catch(() => undefined);
      this.logger.error?.("Channel adapter failed to start", { bindingId: descriptor.id, channel: descriptor.channel, errorCode: adapterErrorCode(error) });
      return false;
    }
  }

  async refreshInventory() {
    if (this.refreshing || this.stopped) return;
    this.refreshing = true;
    try {
      const discovered = typeof this.platform.inventory === "function"
        ? (await this.platform.inventory({ workerId: this.workerId, channels: this.channels })).bindings.map((item) => ({ id: item.id, channel: item.channel, generation: item.connection_generation }))
        : this.bindings;
      this.inventoryReady = true;
      const next = new Map(discovered.map((item) => [item.id, item]));
      for (const [bindingId, adapter] of this.adapters) {
        const descriptor = next.get(bindingId);
        if (descriptor && this.generations.get(bindingId) === (descriptor.generation ?? 0)) continue;
        await adapter.stop?.().catch?.(() => undefined);
        this.adapters.delete(bindingId);
        this.generations.delete(bindingId);
      }
      for (const descriptor of discovered) {
        const generation = descriptor.generation ?? 0;
        if (this.adapters.has(descriptor.id) && this.generations.get(descriptor.id) === generation) continue;
        if (await this.startAdapter(descriptor)) this.generations.set(descriptor.id, generation);
      }
    } finally {
      this.refreshing = false;
    }
  }

  async deliver(item) {
    const adapter = this.adapters.get(item.binding_id);
    let result;
    try {
      result = adapter ? await adapter.deliver(item) : { status: "failed", errorCode: "channel_adapter_not_running" };
    } catch (error) {
      result = { status: error?.retryable === false ? "failed" : "retryable", errorCode: adapterErrorCode(error, "channel_delivery_failed"), retryAfterMs: 5_000 };
    }
    await this.platform.receipt({
      schema_version: "1.0",
      outbound_id: item.outbound_id,
      binding_id: item.binding_id,
      lease_token: item.lease_token,
      status: result.status,
      attempt: item.attempt,
      ...(result.channelMessageId ? { channel_message_id: String(result.channelMessageId) } : {}),
      ...(result.errorCode ? { error_code: adapterErrorCode({ code: result.errorCode }) } : {}),
      ...(result.retryAfterMs !== undefined ? { retry_after_ms: Math.max(0, Math.min(Number(result.retryAfterMs) || 0, 86_400_000)) } : {}),
      observed_at: new Date().toISOString(),
      trace: item.trace ?? { correlation_id: randomUUID() }
    });
  }

  async runOnce() {
    if (this.running || this.stopped || !this.adapters.size) return [];
    this.running = true;
    try {
      const descriptors = [...this.adapters.keys()];
      const channels = [...new Set([...this.adapters.entries()].map(([, adapter]) => adapter.binding.channel))];
      const batch = await this.platform.lease({ workerId: this.workerId, channels, bindingIds: descriptors, limit: this.batchSize, leaseSeconds: this.leaseSeconds });
      await Promise.all(batch.deliveries.map((item) => this.deliver(item)));
      return batch.deliveries;
    } finally {
      this.running = false;
    }
  }

  async start() {
    await this.refreshInventory();
    const tick = async () => {
      await this.runOnce().catch((error) => this.logger.error?.("Channel delivery loop failed", { errorCode: adapterErrorCode(error, "channel_delivery_loop_failed") }));
      if (!this.stopped) this.timer = setTimeout(tick, this.intervalMs);
    };
    this.timer = setTimeout(tick, 0);
    const refresh = async () => {
      await this.refreshInventory().catch((error) => this.logger.error?.("Channel binding inventory refresh failed", { errorCode: adapterErrorCode(error, "channel_inventory_failed") }));
      if (!this.stopped) this.inventoryTimer = setTimeout(refresh, this.inventoryIntervalMs);
    };
    this.inventoryTimer = setTimeout(refresh, this.inventoryIntervalMs);
    return this;
  }

  async handleCallback(request, response, url) {
    const match = url.pathname.match(/^\/callbacks\/wechat\/([^/]+)$/);
    if (!match) return false;
    const adapter = this.adapters.get(decodeURIComponent(match[1]));
    if (!(adapter instanceof WechatOfficialChannelAdapter) && adapter?.binding?.channel !== "wechat") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return true;
    }
    await adapter.handle(request, response, url);
    return true;
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.inventoryTimer) clearTimeout(this.inventoryTimer);
    this.timer = null;
    this.inventoryTimer = null;
    await Promise.allSettled([...this.adapters.values()].map((adapter) => adapter.stop?.()));
    this.adapters.clear();
    this.generations.clear();
  }
}
