import { randomUUID } from "node:crypto";
import {
  validateChannelBindingInventory,
  validateChannelBindingInventoryRequest,
  validateChannelCredentialResolution,
  validateChannelDeliveryBatch,
  validateChannelDeliveryLeaseRequest,
  validateChannelDeliveryReceipt,
  validateChannelHealthReport,
  validateChannelIngress,
  validateChannelIngressAck
} from "@bairui/contracts";
import { signMachineRequest } from "../security/machine-request.mjs";

export class ChannelPlatformClient {
  constructor(options) {
    this.platformUrl = String(options.platformUrl).replace(/\/$/, "");
    this.machineId = options.machineId ?? options.agentId;
    this.token = options.token;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = Math.max(1_000, Number(options.timeoutMs) || 30_000);
    if (!this.platformUrl || !this.machineId || !this.token || this.token.length < 32) throw new TypeError("Channel Platform client requires a URL and Channel Worker machine credential");
  }

  async request(path, payload, options = {}) {
    const body = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const nonce = randomUUID().replaceAll("-", "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetch(`${this.platformUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bairui-machine-id": this.machineId,
          "x-bairui-timestamp": timestamp,
          "x-bairui-nonce": nonce,
          "x-bairui-signature": signMachineRequest({ method: "POST", path, timestamp, nonce, body, token: this.token })
        },
        body,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(`Channel Platform request failed: ${path}`), { code: result.error ?? "channel_platform_unavailable", statusCode: response.status, retryable: response.status === 429 || response.status >= 500 });
    return result;
  }

  async resolveBinding(bindingId) {
    return validateChannelCredentialResolution(await this.request(`/api/internal/channels/bindings/${encodeURIComponent(bindingId)}/resolve`, {}));
  }

  async inventory({ workerId = this.machineId, channels, traceId = randomUUID() }) {
    const request = validateChannelBindingInventoryRequest({ schema_version: "1.0", worker_id: workerId, channels, trace: { correlation_id: traceId } });
    return validateChannelBindingInventory(await this.request("/api/internal/channels/bindings", request));
  }

  async ingress(payload) {
    return validateChannelIngressAck(await this.request("/api/internal/channels/ingress", validateChannelIngress(payload)));
  }

  async lease({ workerId, channels, bindingIds = [], limit = 10, leaseSeconds = 60, traceId = randomUUID() }) {
    const request = validateChannelDeliveryLeaseRequest({ schema_version: "1.0", worker_id: workerId, channels, binding_ids: bindingIds, limit, lease_seconds: leaseSeconds, requested_at: new Date().toISOString(), trace: { correlation_id: traceId } });
    return validateChannelDeliveryBatch(await this.request("/api/internal/channels/deliveries/lease", request));
  }

  async receipt(payload) {
    validateChannelDeliveryReceipt(payload);
    return this.request("/api/internal/channels/delivery-receipts", payload);
  }

  async health(payload) {
    validateChannelHealthReport(payload);
    return this.request("/api/internal/channels/health", payload);
  }
}
