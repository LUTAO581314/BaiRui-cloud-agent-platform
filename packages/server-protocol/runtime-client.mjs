import { createHmac, randomUUID } from "node:crypto";

function sign(body, timestamp, nonce, secret) {
  return createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("base64url");
}

export class BairuiRuntimeClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl ?? "http://127.0.0.1:8787").replace(/\/$/, "");
    this.sharedSecret = options.sharedSecret;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 125_000;
    if (!this.sharedSecret || this.sharedSecret.length < 32) throw new TypeError("Runtime shared secret must contain at least 32 characters");
  }

  async signedPost(path, payload) {
    const body = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const nonce = randomUUID();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bairui-timestamp": timestamp,
          "x-bairui-nonce": nonce,
          "x-bairui-signature": sign(body, timestamp, nonce, this.sharedSecret)
        },
        body,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error("BaiRui runtime is unavailable"), { code: result.error ?? "runtime_unavailable", statusCode: 503 });
    return result;
  }

  async invoke({ principal, conversation, content, model }) {
    const requestId = randomUUID();
    const configId = `config:${principal.organizationId}`;
    const payload = {
      request: {
        request_id: requestId,
        request_type: "message",
        tenant: { organization_id: principal.organizationId },
        actor: { user_id: principal.userId, roles: [principal.role] },
        channel_context: { channel: "web", conversation_id: conversation.id },
        input: { content },
        runtime_config_ref: configId,
        trace: { correlation_id: requestId },
        created_at: new Date().toISOString()
      },
      config: {
        config_id: configId,
        model_policy: model ? { model } : {},
        tool_policy: {},
        memory_policy: { scope: "organization-user" },
        approval_policy: { mode: "required-for-risky-actions" },
        storage_policy: {},
        integration_policy: {},
        channel_policy: { channel: "web" }
      }
    };
    const response = await this.signedPost("/v1/runtime/requests", payload);
    const result = response.result;
    if (result?.status === "completed") return { content: result.reply?.content ?? "", metadata: { requestId, runId: result.run_id, status: result.status } };
    if (result?.status === "requires_approval") return { content: "This action requires administrator approval.", metadata: { requestId, runId: result.run_id, status: result.status, approval: result.approval_request } };
    throw Object.assign(new Error("BaiRui runtime did not complete the request"), { code: result?.error?.code ?? result?.status ?? "runtime_failed", statusCode: 503 });
  }

  async invokeIntegration({ integrationId, capability, input = {} }) {
    const requestId = randomUUID();
    return this.signedPost("/v1/integrations/requests", {
      request: {
        request_id: requestId,
        integration_id: integrationId,
        capability,
        input,
        timeout_ms: this.timeoutMs,
        trace: { correlation_id: requestId }
      }
    });
  }
}
