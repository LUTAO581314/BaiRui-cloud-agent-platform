import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import { FeishuChannelAdapter } from "../packages/channels/adapters/feishu.mjs";
import { QQChannelAdapter } from "../packages/channels/adapters/qq.mjs";
import { WechatOfficialChannelAdapter } from "../packages/channels/adapters/wechat-official.mjs";
import { ChannelWorker } from "../packages/channels/worker.mjs";
import { ChannelPlatformClient } from "../packages/channels/platform-client.mjs";
import { deriveMachineKey, verifyMachineRequest } from "../packages/security/machine-request.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function platform(bindingId, agentId = "agent_channel") {
  const calls = { health: [], ingress: [], receipts: [] };
  return {
    agentId,
    calls,
    async health(value) { calls.health.push(value); return value; },
    async ingress(value) { calls.ingress.push(value); return { schema_version: "1.0", ingress_id: value.ingress_id, status: "accepted", acknowledged_at: new Date().toISOString(), trace: value.trace }; },
    async receipt(value) { calls.receipts.push(value); return {}; },
    async resolveBinding(id) { return { binding: { id, agent_id: agentId, channel: "feishu" }, credential: { values: { appId: "app_feishu", appSecret: "secret_feishu" } } }; },
    async lease() { return { schema_version: "1.0", lease_id: "lease_empty", worker_id: "worker", deliveries: [], leased_until: new Date(Date.now() + 60_000).toISOString(), trace: { correlation_id: "trace_empty" } }; }
  };
}

test("Feishu reports connected only after SDK readiness and normalizes inbound messages", async () => {
  const client = platform("binding_feishu");
  let wsOptions;
  let handlers;
  class EventDispatcher {
    register(value) { handlers = value; return this; }
  }
  class WSClient {
    constructor(options) { wsOptions = options; }
    start() {}
    close() {}
  }
  const fetch = async (url) => {
    if (String(url).includes("tenant_access_token")) return Response.json({ code: 0, tenant_access_token: "token_feishu", expire: 7200 });
    return Response.json({ code: 0, data: { message_id: "reply_feishu" } });
  };
  const adapter = new FeishuChannelAdapter({ binding: { id: "binding_feishu", workerId: "worker_feishu" }, credentials: { appId: "app_feishu", appSecret: "secret_feishu" }, platform: client, fetch, loadSdk: async () => ({ WSClient, EventDispatcher, LoggerLevel: { warn: 2 } }) });
  await adapter.start();
  assert.equal(client.calls.health.some((item) => item.status === "connected"), false);
  await wsOptions.onReady();
  assert.equal(client.calls.health.at(-1).status, "connected");
  await handlers["im.message.receive_v1"]({ sender: { sender_id: { open_id: "ou_feishu" } }, message: { message_id: "message_feishu", chat_id: "chat_feishu", chat_type: "group", message_type: "text", content: JSON.stringify({ text: "hello Feishu" }) } });
  assert.equal(client.calls.ingress[0].sender.channel_user_id, "ou_feishu");
  assert.equal(client.calls.ingress[0].conversation.channel_conversation_id, "chat_feishu");
  const delivered = await adapter.deliver({ outbound_id: "out_feishu", conversation: { channel_conversation_id: "chat_feishu" }, content: { kind: "text", text: "reply" } });
  assert.deepEqual(delivered, { status: "delivered", channelMessageId: "reply_feishu" });
  await adapter.stop();
});

class HttpResponse {
  writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; }
  end(body) { this.body = body; }
}

test("WeChat verifies callback signatures, suppresses replays, and gates connected on handshake", async () => {
  const client = platform("binding_wechat");
  const fetch = async (url) => String(url).includes("stable_token")
    ? Response.json({ access_token: "token_wechat", expires_in: 7200 })
    : Response.json({ errcode: 0, msgid: 42 });
  const adapter = new WechatOfficialChannelAdapter({ binding: { id: "binding_wechat", workerId: "worker_wechat" }, credentials: { appId: "app_wechat", appSecret: "secret_wechat", token: "verify_wechat" }, platform: client, fetch });
  await adapter.start();
  assert.equal(client.calls.health.at(-1).status, "pending");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const handshakeUrl = new URL(`http://worker.test/callbacks/wechat/binding_wechat?timestamp=${timestamp}&nonce=nonce_handshake&echostr=verified`);
  handshakeUrl.searchParams.set("signature", adapter.signature(timestamp, "nonce_handshake"));
  const handshakeResponse = new HttpResponse();
  const handshakeRequest = Readable.from([]);
  handshakeRequest.method = "GET";
  await adapter.handle(handshakeRequest, handshakeResponse, handshakeUrl);
  assert.equal(handshakeResponse.body, "verified");
  assert.equal(client.calls.health.at(-1).status, "connected");

  const xml = `<xml><ToUserName><![CDATA[gh_bot]]></ToUserName><FromUserName><![CDATA[openid_user]]></FromUserName><CreateTime>${timestamp}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hello WeChat]]></Content><MsgId>123456</MsgId></xml>`;
  const callbackUrl = new URL(`http://worker.test/callbacks/wechat/binding_wechat?timestamp=${timestamp}&nonce=nonce_message`);
  callbackUrl.searchParams.set("signature", adapter.signature(timestamp, "nonce_message"));
  const first = new HttpResponse();
  const firstRequest = Readable.from([Buffer.from(xml)]);
  firstRequest.method = "POST";
  await adapter.handle(firstRequest, first, callbackUrl);
  assert.equal(first.body, "success");
  assert.equal(client.calls.ingress.length, 1);
  const replay = new HttpResponse();
  const replayRequest = Readable.from([Buffer.from(xml)]);
  replayRequest.method = "POST";
  await adapter.handle(replayRequest, replay, callbackUrl);
  assert.equal(replay.body, "success");
  assert.equal(client.calls.ingress.length, 1);
  const delivered = await adapter.deliver({ conversation: { channel_conversation_id: "openid_user" }, content: { kind: "text", text: "reply" } });
  assert.equal(delivered.status, "delivered");
  await adapter.stop();
});

class FakeSocket extends EventEmitter {
  constructor() { super(); this.sent = []; }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.emit("close", { code: 1000 }); }
}

test("QQ performs official Gateway identify, normalizes C2C ingress, and sends passive replies", async () => {
  const client = platform("binding_qq");
  const socket = new FakeSocket();
  const requests = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("getAppAccessToken")) return Response.json({ access_token: "token_qq", expires_in: 7200 });
    if (String(url).endsWith("/gateway")) return Response.json({ url: "wss://gateway.qq.test" });
    return Response.json({ id: "reply_qq" });
  };
  const adapter = new QQChannelAdapter({ binding: { id: "binding_qq", workerId: "worker_qq" }, credentials: { appId: "app_qq", appSecret: "secret_qq" }, platform: client, fetch, webSocketFactory: () => socket });
  await adapter.start();
  socket.emit("message", JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } }));
  assert.equal(socket.sent[0].op, 2);
  assert.match(socket.sent[0].d.token, /^QQBot /);
  socket.emit("message", JSON.stringify({ op: 0, t: "READY", s: 1, d: { session_id: "session_qq" } }));
  await tick();
  assert.equal(client.calls.health.at(-1).status, "connected");
  socket.emit("message", JSON.stringify({ op: 0, t: "C2C_MESSAGE_CREATE", s: 2, d: { id: "message_qq", content: "hello QQ", timestamp: new Date().toISOString(), author: { user_openid: "openid_qq" } } }));
  await tick();
  assert.equal(client.calls.ingress[0].conversation.channel_conversation_id, "c2c:openid_qq");
  const delivered = await adapter.deliver({ conversation: { channel_conversation_id: "c2c:openid_qq" }, content: { kind: "text", text: "reply" }, reply_to_message_id: "message_qq" });
  assert.deepEqual(delivered, { status: "delivered", channelMessageId: "reply_qq" });
  const sendRequest = requests.find((item) => item.url.includes("/v2/users/openid_qq/messages"));
  assert.equal(JSON.parse(sendRequest.options.body).msg_id, "message_qq");
  await adapter.stop();
});

test("Channel Worker resolves credentials, delegates deliveries, and emits durable receipts", async () => {
  const client = platform("binding_worker");
  client.resolveBinding = async (id) => ({ binding: { id, agent_id: client.agentId, channel: "feishu" }, credential: { values: { appId: "app", appSecret: "secret" } } });
  client.lease = async () => ({ schema_version: "1.0", lease_id: "lease_worker", worker_id: "worker_test", leased_until: new Date(Date.now() + 60_000).toISOString(), trace: { correlation_id: "trace_worker" }, deliveries: [{ outbound_id: "out_worker", binding_id: "binding_worker", channel: "feishu", channel_account_id: "app", conversation: { channel_conversation_id: "chat", kind: "group" }, content: { kind: "text", text: "reply" }, attachments: [], attempt: 1, lease_token: "lease_token", available_at: new Date().toISOString(), trace: { correlation_id: "trace_worker" } }] });
  const adapter = { binding: { id: "binding_worker", channel: "feishu" }, async start() {}, async deliver() { return { status: "delivered", channelMessageId: "vendor_worker" }; }, async stop() {} };
  const worker = new ChannelWorker({ platform: client, workerId: "worker_test", bindings: [{ id: "binding_worker", channel: "feishu" }], adapterFactories: { feishu: () => adapter }, intervalMs: 60_000 });
  await worker.start();
  const deliveries = await worker.runOnce();
  assert.equal(deliveries.length, 1);
  assert.equal(client.calls.receipts[0].status, "delivered");
  assert.equal(client.calls.receipts[0].channel_message_id, "vendor_worker");
  await worker.stop();
});

test("Channel Worker hot reloads adapters when inventory generations change", async () => {
  const client = platform("binding_reload");
  client.machineId = "worker_reload";
  let inventory = [{ id: "binding_reload", channel: "feishu", connection_generation: 1 }];
  client.inventory = async () => ({ bindings: inventory });
  client.resolveBinding = async (id) => ({ binding: { id, agent_id: "agent_channel", channel: "feishu" }, credential: { values: { appId: "app", appSecret: "secret" } } });
  let starts = 0;
  let stops = 0;
  const worker = new ChannelWorker({ platform: client, workerId: "worker_reload", channels: ["feishu"], adapterFactories: { feishu: ({ binding }) => ({ binding, async start() { starts += 1; }, async stop() { stops += 1; }, async deliver() { return { status: "delivered" }; } }) }, intervalMs: 60_000, inventoryIntervalMs: 60_000 });
  await worker.start();
  assert.equal(starts, 1);
  inventory = [{ ...inventory[0], connection_generation: 2 }];
  await worker.refreshInventory();
  assert.equal(starts, 2);
  assert.equal(stops, 1);
  inventory = [];
  await worker.refreshInventory();
  assert.equal(worker.adapters.size, 0);
  assert.equal(stops, 2);
  await worker.stop();
});

test("Channel Worker retries an adapter that fails during startup", async () => {
  const client = platform("binding_retry");
  client.machineId = "worker_retry";
  client.inventory = async () => ({ bindings: [{ id: "binding_retry", channel: "feishu", connection_generation: 1 }] });
  client.resolveBinding = async (id) => ({ binding: { id, agent_id: "agent_channel", channel: "feishu" }, credential: { values: { appId: "app", appSecret: "secret" } } });
  let starts = 0;
  const worker = new ChannelWorker({
    platform: client,
    workerId: "worker_retry",
    channels: ["feishu"],
    adapterFactories: {
      feishu: ({ binding }) => ({
        binding,
        async start() {
          starts += 1;
          if (starts === 1) throw Object.assign(new Error("temporary startup failure"), { code: "temporary_startup_failure" });
        },
        async stop() {},
        async report() {},
        async deliver() { return { status: "delivered" }; }
      })
    },
    intervalMs: 60_000,
    inventoryIntervalMs: 60_000,
    logger: { error() {} }
  });
  await worker.start();
  assert.equal(worker.adapters.size, 0);
  assert.equal(worker.generations.has("binding_retry"), false);
  await worker.refreshInventory();
  assert.equal(starts, 2);
  assert.equal(worker.adapters.size, 1);
  await worker.stop();
});

test("Channel Platform client signs inventory requests with the dedicated Worker identity", async () => {
  const token = "channel-platform-client-token-at-least-32-characters";
  let captured;
  const fetch = async (url, options) => {
    captured = { url: String(url), options };
    return Response.json({ schema_version: "1.0", worker_id: "worker_client", bindings: [], generated_at: new Date().toISOString(), trace: { correlation_id: "trace_client" } });
  };
  const client = new ChannelPlatformClient({ platformUrl: "https://platform.test", machineId: "worker_client", token, fetch });
  const result = await client.inventory({ channels: ["feishu"], traceId: "trace_client" });
  assert.equal(result.worker_id, "worker_client");
  assert.equal(captured.options.headers["x-bairui-machine-id"], "worker_client");
  assert.equal(verifyMachineRequest({ method: "POST", path: "/api/internal/channels/bindings", timestamp: captured.options.headers["x-bairui-timestamp"], nonce: captured.options.headers["x-bairui-nonce"], body: captured.options.body, signature: captured.options.headers["x-bairui-signature"], keyHash: deriveMachineKey(token), now: Number(captured.options.headers["x-bairui-timestamp"]) }), true);
});
