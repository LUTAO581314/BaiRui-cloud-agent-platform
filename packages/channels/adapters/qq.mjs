import { CHANNEL_PROTOCOL_VERSION } from "@bairui/contracts";
import { adapterErrorCode, jsonResponse, retryAfterMs, stableIdentifier, submitIngress } from "./utilities.mjs";

const FULL_INTENTS = (1 << 30) | (1 << 12) | (1 << 25) | (1 << 26);
const MESSAGE_EVENTS = new Set(["C2C_MESSAGE_CREATE", "GROUP_AT_MESSAGE_CREATE", "GROUP_MESSAGE_CREATE", "AT_MESSAGE_CREATE", "DIRECT_MESSAGE_CREATE"]);

function listen(socket, event, handler) {
  if (typeof socket.addEventListener === "function") socket.addEventListener(event, handler);
  else socket.on(event, handler);
}

function eventData(event) {
  return event?.data ?? event;
}

function decode(data) {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  return "";
}

function normalizeEvent(type, event) {
  const content = String(event?.content ?? "").replace(/<@!?[^>]+>/g, "").trim();
  const messageId = event?.id;
  if (!messageId || !content) return null;
  if (type === "C2C_MESSAGE_CREATE") {
    const sender = event.author?.user_openid ?? event.author?.id;
    return sender ? { sender, conversation: `c2c:${sender}`, kind: "direct", messageId, content } : null;
  }
  if (["GROUP_AT_MESSAGE_CREATE", "GROUP_MESSAGE_CREATE"].includes(type)) {
    const sender = event.author?.member_openid ?? event.author?.id;
    const group = event.group_openid;
    return sender && group ? { sender, conversation: `group:${group}`, kind: "group", messageId, content } : null;
  }
  if (type === "DIRECT_MESSAGE_CREATE") {
    const sender = event.author?.id;
    const guild = event.guild_id;
    return sender && guild ? { sender, conversation: `dm:${guild}`, kind: "direct", messageId, content } : null;
  }
  const sender = event.author?.id;
  const channel = event.channel_id;
  return sender && channel ? { sender, conversation: `channel:${channel}`, kind: "group", messageId, content } : null;
}

function deliveryTarget(value) {
  const match = String(value).match(/^(c2c|group|channel|dm):(.+)$/);
  if (!match) throw Object.assign(new Error("Invalid QQ conversation target"), { code: "invalid_qq_target" });
  return { type: match[1], id: match[2] };
}

export async function startQQCredentialOnboarding(callbacks, options = {}) {
  const connector = await import("@tencent-connect/qqbot-connector");
  return connector.startQrConnect(callbacks, { displayQrCodeToConsole: false, source: "bairui-agent", ...options });
}

export class QQChannelAdapter {
  constructor(options) {
    this.binding = options.binding;
    this.credentials = options.credentials;
    this.platform = options.platform;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
    this.logger = options.logger ?? console;
    this.sequence = 0;
    this.token = null;
    this.tokenExpiresAt = 0;
    this.socket = null;
    this.sessionId = null;
    this.lastSequence = null;
    this.heartbeat = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.stopped = false;
    this.clientSecret = this.credentials.clientSecret ?? this.credentials.appSecret ?? this.credentials.token;
    if (!this.credentials.appId || !this.clientSecret) throw Object.assign(new Error("QQ credentials are incomplete"), { code: "invalid_qq_credentials" });
  }

  async report(status, capabilities, error = null) {
    return this.platform.health({ schema_version: CHANNEL_PROTOCOL_VERSION, owner_scope: this.binding.ownerScope, binding_id: this.binding.id, channel: "qq", worker_id: this.binding.workerId, sequence: ++this.sequence, status, capabilities, adapter_version: "bairui-qq/1.0.0", ...(error ? { error_code: adapterErrorCode(error, "qq_connection_failed") } : {}), observed_at: new Date().toISOString() });
  }

  async accessToken(force = false) {
    if (!force && this.token && Date.now() < this.tokenExpiresAt) return this.token;
    const response = await this.fetch("https://bots.qq.com/app/getAppAccessToken", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ appId: this.credentials.appId, clientSecret: this.clientSecret }) });
    const data = await jsonResponse(response);
    if (!response.ok || !data.access_token) throw Object.assign(new Error("QQ authentication failed"), { code: `qq_auth_${data.code ?? response.status}`, retryable: response.status === 429 || response.status >= 500 });
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + Math.max(60, (Number(data.expires_in) || 7200) - 120) * 1000;
    return this.token;
  }

  async gatewayUrl(token) {
    const response = await this.fetch("https://api.sgroup.qq.com/gateway", { headers: { authorization: `QQBot ${token}` } });
    const data = await jsonResponse(response);
    if (!response.ok || !data.url) throw Object.assign(new Error("QQ gateway discovery failed"), { code: `qq_gateway_${response.status}`, retryable: response.status === 429 || response.status >= 500 });
    return data.url;
  }

  clearConnection() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    const current = this.socket;
    this.socket = null;
    try { current?.close?.(); } catch {}
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delays = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];
    const delay = delays[Math.min(this.reconnectAttempt++, delays.length - 1)];
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => {
        this.report("error", [], error).catch(() => undefined);
        this.scheduleReconnect();
      });
    }, delay);
  }

  async inbound(type, event) {
    const normalized = normalizeEvent(type, event);
    if (!normalized) return;
    await submitIngress(this.platform, {
      schema_version: CHANNEL_PROTOCOL_VERSION,
      owner_scope: this.binding.ownerScope,
      ingress_id: stableIdentifier("qq-ingress", `qq:${this.binding.id}:${normalized.messageId}`),
      binding_id: this.binding.id,
      channel: "qq",
      channel_account_id: stableIdentifier("qq-account", this.credentials.appId),
      message_id: stableIdentifier("qq-message", normalized.messageId),
      sender: { channel_user_id: stableIdentifier("qq-user", normalized.sender) },
      conversation: { channel_conversation_id: stableIdentifier("qq-conversation", normalized.conversation), kind: normalized.kind },
      content: { kind: "text", text: normalized.content },
      attachments: [],
      received_at: event.timestamp && Number.isFinite(Date.parse(event.timestamp)) ? new Date(event.timestamp).toISOString() : new Date().toISOString(),
      trace: { correlation_id: stableIdentifier("qq-trace", normalized.messageId) }
    });
  }

  handlePayload(socket, token, raw) {
    let payload;
    try { payload = JSON.parse(decode(raw)); }
    catch { return; }
    if (Number.isSafeInteger(payload.s)) this.lastSequence = payload.s;
    if (payload.op === 10) {
      const data = this.sessionId && this.lastSequence !== null
        ? { op: 6, d: { token: `QQBot ${token}`, session_id: this.sessionId, seq: this.lastSequence } }
        : { op: 2, d: { token: `QQBot ${token}`, intents: FULL_INTENTS, shard: [0, 1] } };
      socket.send(JSON.stringify(data));
      const interval = Math.max(1_000, Number(payload.d?.heartbeat_interval) || 45_000);
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => { if (this.socket === socket) socket.send(JSON.stringify({ op: 1, d: this.lastSequence })); }, interval);
      return;
    }
    if (payload.op === 0) {
      if (payload.t === "READY") {
        this.sessionId = payload.d?.session_id ?? null;
        this.reconnectAttempt = 0;
        this.report("connected", ["receive", "send", "reply", "websocket"]).catch(() => undefined);
      } else if (payload.t === "RESUMED") {
        this.reconnectAttempt = 0;
        this.report("connected", ["receive", "send", "reply", "websocket"]).catch(() => undefined);
      } else if (MESSAGE_EVENTS.has(payload.t)) {
        this.inbound(payload.t, payload.d).catch((error) => this.logger.error?.("QQ ingress failed", { bindingId: this.binding.id, errorCode: adapterErrorCode(error) }));
      }
      return;
    }
    if (payload.op === 7 || payload.op === 9) {
      if (payload.op === 9 && !payload.d) { this.sessionId = null; this.lastSequence = null; }
      this.clearConnection();
      this.report("degraded", ["send"], { code: "qq_reconnecting" }).catch(() => undefined);
      this.scheduleReconnect();
    }
  }

  async connect() {
    const token = await this.accessToken();
    const socket = this.webSocketFactory(await this.gatewayUrl(token));
    this.socket = socket;
    listen(socket, "message", (event) => this.handlePayload(socket, token, eventData(event)));
    listen(socket, "close", () => {
      if (this.socket !== socket || this.stopped) return;
      this.clearConnection();
      this.report("disconnected", [], { code: "qq_gateway_closed" }).catch(() => undefined);
      this.scheduleReconnect();
    });
    listen(socket, "error", (event) => this.report("error", [], event?.error ?? { code: "qq_gateway_error" }).catch(() => undefined));
  }

  async start() {
    await this.report("pending", []);
    await this.connect();
    return this;
  }

  async deliver(delivery) {
    const target = deliveryTarget(delivery.conversation.channel_conversation_id);
    const token = await this.accessToken();
    const path = target.type === "c2c" ? `/v2/users/${encodeURIComponent(target.id)}/messages` : target.type === "group" ? `/v2/groups/${encodeURIComponent(target.id)}/messages` : target.type === "channel" ? `/channels/${encodeURIComponent(target.id)}/messages` : `/dms/${encodeURIComponent(target.id)}/messages`;
    const body = ["c2c", "group"].includes(target.type)
      ? { content: String(delivery.content.text ?? ""), msg_type: 0, msg_seq: 1, ...(delivery.reply_to_message_id ? { msg_id: delivery.reply_to_message_id } : {}) }
      : { content: String(delivery.content.text ?? ""), ...(delivery.reply_to_message_id ? { msg_id: delivery.reply_to_message_id } : {}) };
    const response = await this.fetch(`https://api.sgroup.qq.com${path}`, { method: "POST", headers: { authorization: `QQBot ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await jsonResponse(response);
    if (response.ok && (data.id || data.message_id)) return { status: "delivered", channelMessageId: data.id ?? data.message_id };
    const retryable = response.status === 429 || response.status >= 500;
    return { status: retryable ? "retryable" : "failed", errorCode: `qq_send_${data.code ?? response.status}`, ...(retryable ? { retryAfterMs: retryAfterMs(response) } : {}) };
  }

  async stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearConnection();
    await this.report("disconnected", []).catch(() => undefined);
  }
}
