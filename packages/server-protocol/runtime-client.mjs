import { createHmac, randomUUID } from "node:crypto";
import {
  validateIntegrationRequestEnvelope,
  validateRuntimeOperationEnvelope,
  validateRuntimeRequestEnvelope,
  validateRuntimeStreamEnvelope
} from "@bairui/contracts";

function sign(body, timestamp, nonce, secret) {
  return createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("base64url");
}

export class BairuiRuntimeClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl ?? "http://127.0.0.1:8787").replace(/\/$/, "");
    this.sharedSecret = options.sharedSecret;
    this.resolveRuntime = options.resolveRuntime ?? (() => ({ baseUrl: this.baseUrl, sharedSecret: this.sharedSecret }));
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 125_000;
    if (!this.sharedSecret || this.sharedSecret.length < 32) throw new TypeError("Runtime shared secret must contain at least 32 characters");
  }

  async signedPost(path, payload, options = {}) {
    const body = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const nonce = randomUUID();
    const runtime = options.runtime ?? { baseUrl: this.baseUrl, sharedSecret: this.sharedSecret };
    if (!runtime?.baseUrl || !runtime?.sharedSecret) throw Object.assign(new Error("Agent Runtime route is unavailable"), { code: "runtime_route_unavailable", statusCode: 503 });
    const controller = options.signal ? null : new AbortController();
    const signal = options.signal ?? controller.signal;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
    let response;
    try {
      response = await this.fetch(`${String(runtime.baseUrl).replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bairui-timestamp": timestamp,
          "x-bairui-nonce": nonce,
          "x-bairui-signature": sign(body, timestamp, nonce, runtime.sharedSecret)
        },
        body,
        signal
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (options.stream && response.ok) return response;
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error("BaiRui runtime is unavailable"), { code: result.error ?? "runtime_unavailable", statusCode: 503 });
    return result;
  }

  async invoke({ principal, agent, conversation, content, model }) {
    if (!agent?.id || agent.ownerUserId !== principal.userId || agent.organizationId !== principal.organizationId) {
      throw Object.assign(new Error("Agent ownership does not match the authenticated principal"), { code: "agent_ownership_mismatch", statusCode: 403 });
    }
    const requestId = randomUUID();
    const configId = `config:${principal.organizationId}:${agent.id}`;
    const payload = {
      request: {
        request_id: requestId,
        request_type: "message",
        tenant: { organization_id: principal.organizationId, agent_id: agent.id },
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
        memory_policy: { scope: "agent" },
        approval_policy: { mode: "required-for-risky-actions" },
        storage_policy: {},
        integration_policy: {},
        channel_policy: { channel: "web" }
      }
    };
    const response = await this.signedPost("/v1/runtime/requests", validateRuntimeRequestEnvelope(payload), { runtime: await this.resolveRuntime(agent) });
    const result = response.result;
    if (result?.status === "completed") return { content: result.reply?.content ?? "", metadata: { requestId, runId: result.run_id, status: result.status } };
    if (result?.status === "requires_approval") return { content: "This action requires administrator approval.", metadata: { requestId, runId: result.run_id, status: result.status, approval: result.approval_request } };
    throw Object.assign(new Error("BaiRui runtime did not complete the request"), { code: result?.error?.code ?? result?.status ?? "runtime_failed", statusCode: 503 });
  }

  async invokeIntegration({ integrationId, capability, input = {}, authorizationId, principal, agent }) {
    if ((principal && !agent) || (!principal && agent)) throw new TypeError("Integration requests require both principal and Agent");
    if (principal && agent) this.validateAgent(principal, agent);
    const requestId = randomUUID();
    return this.signedPost("/v1/integrations/requests", validateIntegrationRequestEnvelope({
      request: {
        request_id: requestId,
        integration_id: integrationId,
        capability,
        input,
        ...(authorizationId ? { options: { authorization_id: authorizationId } } : {}),
        timeout_ms: this.timeoutMs,
        trace: { correlation_id: requestId }
      }
    }), agent ? { runtime: await this.resolveRuntime(agent) } : {});
  }

  validateAgent(principal, agent) {
    if (!agent?.id || agent.ownerUserId !== principal.userId || agent.organizationId !== principal.organizationId) {
      throw Object.assign(new Error("Agent ownership does not match the authenticated principal"), { code: "agent_ownership_mismatch", statusCode: 403 });
    }
  }

  operationEnvelope({ principal, agent, operation, input = {} }) {
    this.validateAgent(principal, agent);
    return {
      operation,
      tenant: { organization_id: principal.organizationId, agent_id: agent.id },
      actor: { user_id: principal.userId, roles: [principal.role] },
      channel_context: { channel: "web", conversation_id: input.session_id },
      input,
      trace: { correlation_id: randomUUID() },
      created_at: new Date().toISOString()
    };
  }

  async operation(options) {
    const envelope = validateRuntimeOperationEnvelope(this.operationEnvelope(options));
    return this.signedPost("/v1/runtime/operations", envelope, { runtime: await this.resolveRuntime(options.agent) });
  }

  async streamOperation(options) {
    const envelope = validateRuntimeStreamEnvelope(this.operationEnvelope(options));
    return this.signedPost("/v1/runtime/streams", envelope, { runtime: await this.resolveRuntime(options.agent), signal: options.signal, stream: true });
  }
}
