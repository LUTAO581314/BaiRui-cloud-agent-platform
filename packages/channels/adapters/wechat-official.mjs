import { createHash, timingSafeEqual } from "node:crypto";
import { adapterErrorCode, jsonResponse, retryAfterMs, stableIdentifier, submitIngress } from "./utilities.mjs";

const MAX_BODY_BYTES = 256 * 1024;
const SIGNATURE_WINDOW_MS = 5 * 60_000;

function xmlValue(source, name) {
  const match = source.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/${name}>`, "i"));
  return String(match?.[1] ?? match?.[2] ?? "").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&apos;", "'");
}

export function parseWechatMessage(source) {
  const xml = String(source);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !/^\s*<xml>[\s\S]*<\/xml>\s*$/i.test(xml)) throw Object.assign(new Error("Invalid WeChat XML"), { code: "invalid_wechat_xml" });
  return Object.fromEntries(["ToUserName", "FromUserName", "CreateTime", "MsgType", "Content", "MsgId", "Event", "EventKey"].map((name) => [name, xmlValue(xml, name)]));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("WeChat callback is too large"), { code: "wechat_callback_too_large", statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function text(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  response.end(body);
}

export class WechatOfficialChannelAdapter {
  constructor(options) {
    this.binding = options.binding;
    this.credentials = options.credentials;
    this.platform = options.platform;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sequence = 0;
    this.token = null;
    this.tokenExpiresAt = 0;
    this.handshakeVerified = false;
    this.replays = new Map();
    if (!this.credentials.appId || !this.credentials.appSecret || !this.credentials.token) throw Object.assign(new Error("WeChat Official credentials are incomplete"), { code: "invalid_wechat_credentials" });
  }

  async report(status, capabilities, error = null) {
    return this.platform.health({ schema_version: "1.0", binding_id: this.binding.id, channel: "wechat", worker_id: this.binding.workerId, sequence: ++this.sequence, status, capabilities, adapter_version: "bairui-wechat-official/1.0.0", ...(error ? { error_code: adapterErrorCode(error, "wechat_connection_failed") } : {}), observed_at: new Date().toISOString() });
  }

  signature(timestamp, nonce) {
    return createHash("sha1").update([this.credentials.token, timestamp, nonce].sort().join("")).digest("hex");
  }

  verify(url) {
    const signature = url.searchParams.get("signature") ?? "";
    const timestamp = url.searchParams.get("timestamp") ?? "";
    const nonce = url.searchParams.get("nonce") ?? "";
    const timestampMs = Number(timestamp) * 1000;
    if (!signature || !timestamp || !nonce || !Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > SIGNATURE_WINDOW_MS) return null;
    const expected = Buffer.from(this.signature(timestamp, nonce));
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const key = `${timestamp}:${nonce}`;
    const replay = this.replays.has(key);
    for (const [item, expiry] of this.replays) if (expiry < Date.now()) this.replays.delete(item);
    return { key, replay };
  }

  markReplay(key) {
    this.replays.set(key, Date.now() + SIGNATURE_WINDOW_MS);
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    const url = `https://api.weixin.qq.com/cgi-bin/stable_token`;
    const response = await this.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "client_credential", appid: this.credentials.appId, secret: this.credentials.appSecret, force_refresh: false }) });
    const data = await jsonResponse(response);
    if (!response.ok || !data.access_token) throw Object.assign(new Error("WeChat authentication failed"), { code: `wechat_auth_${data.errcode ?? response.status}`, retryable: response.status === 429 || response.status >= 500 });
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + Math.max(60, (Number(data.expires_in) || 7200) - 120) * 1000;
    return this.token;
  }

  async start() {
    await this.report("pending", []);
    await this.accessToken();
    await this.report("pending", ["send", "webhook"]);
    return this;
  }

  async handle(request, response, url) {
    const verified = this.verify(url);
    if (!verified) return text(response, 403, "forbidden");
    if (request.method === "GET") {
      const echo = url.searchParams.get("echostr") ?? "";
      if (!this.handshakeVerified) {
        this.handshakeVerified = true;
        await this.report("connected", ["receive", "send", "reply", "webhook"]);
      }
      this.markReplay(verified.key);
      return text(response, 200, echo);
    }
    if (request.method !== "POST") return text(response, 405, "method not allowed");
    if (verified.replay) return text(response, 200, "success");
    let message;
    try { message = parseWechatMessage(await readBody(request)); }
    catch (error) { return text(response, error.statusCode ?? 400, "invalid request"); }
    if (!message.FromUserName || !message.CreateTime) return text(response, 400, "invalid request");
    const sourceId = message.MsgId || createHash("sha256").update(`${message.FromUserName}\n${message.CreateTime}\n${message.MsgType}\n${message.Content}\n${message.Event}`).digest("hex");
    const content = message.MsgType === "text" && message.Content ? message.Content : `[${message.MsgType || "unknown"}:${message.Event || "message"}]`;
    const receivedAt = Number(message.CreateTime) * 1000;
    if (!Number.isFinite(receivedAt) || receivedAt <= 0) return text(response, 400, "invalid request");
    await submitIngress(this.platform, {
      schema_version: "1.0",
      ingress_id: stableIdentifier("wechat-ingress", `wechat:${this.binding.id}:${sourceId}`),
      binding_id: this.binding.id,
      channel: "wechat",
      channel_account_id: stableIdentifier("wechat-account", this.credentials.appId),
      message_id: stableIdentifier("wechat-message", sourceId),
      sender: { channel_user_id: stableIdentifier("wechat-user", message.FromUserName) },
      conversation: { channel_conversation_id: stableIdentifier("wechat-conversation", message.FromUserName), kind: "direct" },
      content: { kind: "text", text: content },
      attachments: [],
      received_at: new Date(receivedAt).toISOString(),
      trace: { correlation_id: stableIdentifier("wechat-trace", sourceId) }
    });
    if (!this.handshakeVerified) {
      this.handshakeVerified = true;
      await this.report("connected", ["receive", "send", "reply", "webhook"]);
    }
    this.markReplay(verified.key);
    return text(response, 200, "success");
  }

  async deliver(delivery) {
    const token = await this.accessToken();
    const response = await this.fetch(`https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ touser: delivery.conversation.channel_conversation_id, msgtype: "text", text: { content: String(delivery.content.text ?? "") } }) });
    const data = await jsonResponse(response);
    if (response.ok && (!data.errcode || data.errcode === 0)) return { status: "delivered", channelMessageId: data.msgid ? String(data.msgid) : undefined };
    const retryable = response.status === 429 || response.status >= 500 || [-1, 45009].includes(data.errcode);
    return { status: retryable ? "retryable" : "failed", errorCode: `wechat_send_${data.errcode ?? response.status}`, ...(retryable ? { retryAfterMs: retryAfterMs(response) } : {}) };
  }

  async stop() {
    await this.report("disconnected", []).catch(() => undefined);
  }
}
