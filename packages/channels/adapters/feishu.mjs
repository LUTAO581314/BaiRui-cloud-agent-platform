import { randomUUID } from "node:crypto";
import { adapterErrorCode, jsonResponse, retryAfterMs, stableIdentifier, submitIngress } from "./utilities.mjs";

const DOMAINS = Object.freeze({ feishu: "https://open.feishu.cn", lark: "https://open.larksuite.com" });

function domain(value) {
  if (!value) return DOMAINS.feishu;
  if (DOMAINS[value]) return DOMAINS[value];
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw Object.assign(new Error("Invalid Feishu domain"), { code: "invalid_feishu_domain" });
  return parsed.origin;
}

function messageText(message) {
  if (message?.message_type && message.message_type !== "text") return "";
  try {
    const content = JSON.parse(message?.content ?? "{}");
    return String(content.text ?? "").trim();
  } catch {
    return "";
  }
}

export class FeishuChannelAdapter {
  constructor(options) {
    this.binding = options.binding;
    this.credentials = options.credentials;
    this.platform = options.platform;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.loadSdk = options.loadSdk ?? (() => import("@larksuiteoapi/node-sdk"));
    this.logger = options.logger ?? console;
    this.sequence = 0;
    this.token = null;
    this.tokenExpiresAt = 0;
    this.wsClient = null;
    this.stopped = false;
    this.domain = domain(this.credentials.domain);
    if (!this.credentials.appId || !this.credentials.appSecret) throw Object.assign(new Error("Feishu credentials are incomplete"), { code: "invalid_feishu_credentials" });
  }

  async report(status, capabilities, error = null) {
    return this.platform.health({
      schema_version: "1.0",
      binding_id: this.binding.id,
      channel: "feishu",
      worker_id: this.binding.workerId,
      sequence: ++this.sequence,
      status,
      capabilities,
      adapter_version: "bairui-feishu/1.0.0",
      ...(error ? { error_code: adapterErrorCode(error, "feishu_connection_failed") } : {}),
      observed_at: new Date().toISOString()
    });
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    const response = await this.fetch(`${this.domain}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: this.credentials.appId, app_secret: this.credentials.appSecret })
    });
    const data = await jsonResponse(response);
    if (!response.ok || data.code !== 0 || !data.tenant_access_token) throw Object.assign(new Error("Feishu authentication failed"), { code: `feishu_auth_${data.code ?? response.status}`, retryable: response.status === 429 || response.status >= 500 });
    this.token = data.tenant_access_token;
    this.tokenExpiresAt = Date.now() + Math.max(60, (Number(data.expire) || 7200) - 120) * 1000;
    return this.token;
  }

  async inbound(event) {
    const message = event?.message ?? {};
    const senderId = event?.sender?.sender_id?.open_id ?? event?.sender?.sender_id?.user_id;
    const text = messageText(message);
    if (!message.message_id || !senderId || !message.chat_id || !text) return;
    const messageId = stableIdentifier("feishu-message", message.message_id);
    await submitIngress(this.platform, {
      schema_version: "1.0",
      ingress_id: stableIdentifier("feishu-ingress", `feishu:${this.binding.id}:${message.message_id}`),
      binding_id: this.binding.id,
      channel: "feishu",
      channel_account_id: stableIdentifier("feishu-account", this.credentials.appId),
      message_id: messageId,
      sender: { channel_user_id: stableIdentifier("feishu-user", senderId), ...(event?.sender?.sender_id?.union_id ? { identity_id: stableIdentifier("feishu-union", event.sender.sender_id.union_id) } : {}) },
      conversation: { channel_conversation_id: stableIdentifier("feishu-chat", message.chat_id), kind: message.chat_type === "p2p" ? "direct" : "group" },
      content: { kind: "text", text },
      attachments: [],
      received_at: new Date().toISOString(),
      trace: { correlation_id: stableIdentifier("feishu-trace", message.message_id) }
    });
  }

  async start() {
    await this.report("pending", []);
    await this.accessToken();
    const imported = await this.loadSdk();
    const sdk = imported.WSClient ? imported : imported.default ?? imported;
    if (!sdk?.WSClient || !sdk?.EventDispatcher) throw Object.assign(new Error("Feishu SDK is unavailable"), { code: "feishu_sdk_unavailable" });
    const dispatcher = new sdk.EventDispatcher({}).register({ "im.message.receive_v1": (event) => this.inbound(event).catch((error) => this.logger.error?.("Feishu ingress failed", { bindingId: this.binding.id, errorCode: adapterErrorCode(error) })) });
    this.wsClient = new sdk.WSClient({
      appId: this.credentials.appId,
      appSecret: this.credentials.appSecret,
      domain: this.domain,
      loggerLevel: sdk.LoggerLevel?.warn ?? 2,
      onReady: () => this.report("connected", ["receive", "send", "reply", "websocket"]).catch(() => undefined),
      onError: (error) => this.report("error", [], error).catch(() => undefined),
      onReconnecting: () => this.report("degraded", ["send"], { code: "feishu_reconnecting" }).catch(() => undefined),
      onReconnected: () => this.report("connected", ["receive", "send", "reply", "websocket"]).catch(() => undefined)
    });
    const started = this.wsClient.start({ eventDispatcher: dispatcher });
    if (started?.catch) started.catch((error) => this.report("error", [], error).catch(() => undefined));
    return this;
  }

  async deliver(delivery) {
    const token = await this.accessToken();
    const response = await this.fetch(`${this.domain}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ receive_id: delivery.conversation.channel_conversation_id, msg_type: "text", content: JSON.stringify({ text: String(delivery.content.text ?? "") }), uuid: delivery.outbound_id ?? randomUUID() })
    });
    const data = await jsonResponse(response);
    if (response.ok && data.code === 0) return { status: "delivered", channelMessageId: data.data?.message_id ?? data.message_id };
    const retryable = response.status === 429 || response.status >= 500 || [99991663, 99991400].includes(data.code);
    return { status: retryable ? "retryable" : "failed", errorCode: `feishu_send_${data.code ?? response.status}`, ...(retryable ? { retryAfterMs: retryAfterMs(response) } : {}) };
  }

  async stop() {
    this.stopped = true;
    try { this.wsClient?.close?.(); } catch {}
    try { this.wsClient?.stop?.(); } catch {}
    this.wsClient = null;
    await this.report("disconnected", []).catch(() => undefined);
  }
}
