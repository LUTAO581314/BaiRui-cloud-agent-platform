import { createServer } from "node:http";
import { ChannelPlatformClient } from "../../packages/channels/platform-client.mjs";
import { ChannelWorker } from "../../packages/channels/worker.mjs";

function channels(value) {
  const parsed = String(value ?? "feishu,wechat,qq").split(",").map((item) => item.trim()).filter(Boolean);
  if (!parsed.length || parsed.some((item) => !["feishu", "wechat", "qq"].includes(item))) throw new Error("BAIRUI_CHANNEL_WORKER_CHANNELS is invalid");
  return [...new Set(parsed)];
}

const platform = new ChannelPlatformClient({ platformUrl: process.env.BAIRUI_PLATFORM_URL, machineId: process.env.BAIRUI_CHANNEL_WORKER_ID, token: process.env.BAIRUI_CHANNEL_WORKER_TOKEN });
const worker = new ChannelWorker({
  platform,
  workerId: process.env.BAIRUI_CHANNEL_WORKER_ID,
  channels: channels(process.env.BAIRUI_CHANNEL_WORKER_CHANNELS),
  inventoryIntervalMs: process.env.BAIRUI_CHANNEL_INVENTORY_INTERVAL_MS,
  intervalMs: process.env.BAIRUI_CHANNEL_DELIVERY_INTERVAL_MS,
  batchSize: process.env.BAIRUI_CHANNEL_DELIVERY_BATCH_SIZE,
  leaseSeconds: process.env.BAIRUI_CHANNEL_DELIVERY_LEASE_SECONDS,
  logger: console
});

await worker.start();

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://channel-worker.internal");
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ status: "ok" }));
    }
    if (request.method === "GET" && url.pathname === "/ready") {
      const ready = worker.inventoryReady;
      response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
      return response.end(JSON.stringify({ ready, adapters: worker.adapters.size }));
    }
    if (await worker.handleCallback(request, response, url)) return;
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  } catch (error) {
    console.error("Channel callback failed", { path: url.pathname, errorCode: String(error?.code ?? "channel_callback_failed") });
    if (!response.headersSent) response.writeHead(error?.statusCode ?? 500, { "content-type": "text/plain; charset=utf-8" });
    response.end("request failed");
  }
});

const stop = async () => {
  server.close();
  await worker.stop();
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

server.listen(Number(process.env.BAIRUI_CHANNEL_WORKER_PORT) || 8790, process.env.BAIRUI_CHANNEL_WORKER_HOST ?? "127.0.0.1", () => console.log("bairui-agent Channel Worker is listening"));
