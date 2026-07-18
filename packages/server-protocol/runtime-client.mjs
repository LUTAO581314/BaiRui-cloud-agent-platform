import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  DATA_PROTOCOL_VERSION,
  RUNTIME_PROTOCOL_VERSION,
  validateIntegrationRequestEnvelope,
  validateRuntimeOperationEnvelope,
  validateRuntimeRequestEnvelope,
  validateRuntimeStreamEnvelope
} from "@bairui/contracts";

function sign(body, timestamp, nonce, secret) {
  return createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("base64url");
}

export function workspaceIdFromRef(workspaceRef) {
  const value = String(workspaceRef ?? "").trim();
  if (!value) throw Object.assign(new Error("Agent Runtime workspace reference is missing"), { code: "runtime_scope_unavailable", statusCode: 503 });
  return `ws_${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 48)}`;
}

export class BairuiRuntimeClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl ?? "http://127.0.0.1:8787").replace(/\/$/, "");
    this.sharedSecret = options.sharedSecret;
    this.resolveRuntime = options.resolveRuntime ?? (() => ({ baseUrl: this.baseUrl, sharedSecret: this.sharedSecret }));
    this.systemOwnerScope = options.systemOwnerScope ?? {
      organization_id: options.organizationId ?? "org_bairui",
      user_id: options.userId ?? "system",
      agent_id: options.agentId ?? "agent_bairui",
      runtime_id: options.runtimeId ?? "runtime:system",
      workspace_id: options.workspaceId ?? workspaceIdFromRef(options.workspaceRef ?? "hermes:system")
    };
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

  async invoke({ principal, agent, conversation, content, model, channelContext = {} }) {
    if (!agent?.id || agent.ownerUserId !== principal.userId || agent.organizationId !== principal.organizationId) {
      throw Object.assign(new Error("Agent ownership does not match the authenticated principal"), { code: "agent_ownership_mismatch", statusCode: 403 });
    }
    const runtime = await this.resolveRuntime(agent);
    const ownerScope = this.ownerScope(principal, agent, runtime, conversation?.id);
    const requestId = randomUUID();
    const configId = `config:${principal.organizationId}:${agent.id}`;
    const channel = typeof channelContext.channel === "string" && channelContext.channel ? channelContext.channel : "web";
    const runtimeChannelContext = {
      channel,
      conversation_id: conversation.id,
      ...(channelContext.bindingId ? { binding_id: channelContext.bindingId } : {}),
      ...(channelContext.channelAccountId ? { channel_account_id: channelContext.channelAccountId } : {}),
      ...(channelContext.externalSenderId ? { external_sender_id: channelContext.externalSenderId } : {}),
      ...(channelContext.externalMessageId ? { external_message_id: channelContext.externalMessageId } : {}),
      ...(channelContext.conversationKind ? { conversation_kind: channelContext.conversationKind } : {})
    };
    const payload = {
      schema_version: RUNTIME_PROTOCOL_VERSION,
      request: {
        request_id: requestId,
        request_type: "message",
        owner_scope: ownerScope,
        actor: { user_id: principal.userId, roles: [principal.role] },
        channel_context: runtimeChannelContext,
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
        channel_policy: { channel }
      }
    };
    const response = await this.signedPost("/v1/runtime/requests", validateRuntimeRequestEnvelope(payload), { runtime });
    const result = response.result;
    if (result?.status === "completed") return { content: result.reply?.content ?? "", metadata: { requestId, runId: result.run_id, status: result.status } };
    if (result?.status === "requires_approval") return { content: "This action requires administrator approval.", metadata: { requestId, runId: result.run_id, status: result.status, approval: result.approval_request } };
    throw Object.assign(new Error("BaiRui runtime did not complete the request"), { code: result?.error?.code ?? result?.status ?? "runtime_failed", statusCode: 503 });
  }

  async invokeIntegration({ integrationId, capability, input = {}, authorizationId, principal, agent }) {
    if ((principal && !agent) || (!principal && agent)) throw new TypeError("Integration requests require both principal and Agent");
    if (principal && agent) this.validateAgent(principal, agent);
    const runtime = agent ? await this.resolveRuntime(agent) : undefined;
    const ownerScope = principal && agent ? this.ownerScope(principal, agent, runtime) : { ...this.systemOwnerScope };
    const requestId = randomUUID();
    return this.signedPost("/v1/integrations/requests", validateIntegrationRequestEnvelope({
      schema_version: DATA_PROTOCOL_VERSION,
      request: {
        request_id: requestId,
        ...(ownerScope ? { owner_scope: ownerScope } : {}),
        integration_id: integrationId,
        capability,
        input,
        ...(authorizationId ? { options: { authorization_id: authorizationId } } : {}),
        timeout_ms: this.timeoutMs,
        trace: { correlation_id: requestId }
      }
    }), agent ? { runtime } : {});
  }

  validateAgent(principal, agent) {
    if (!agent?.id || agent.ownerUserId !== principal.userId || agent.organizationId !== principal.organizationId) {
      throw Object.assign(new Error("Agent ownership does not match the authenticated principal"), { code: "agent_ownership_mismatch", statusCode: 403 });
    }
  }

  ownerScope(principal, agent, runtime = {}, conversationId) {
    this.validateAgent(principal, agent);
    const runtimeId = runtime.runtimeId ?? runtime.runtime_id ?? runtime.runtime?.id ?? agent.runtimeId ?? `runtime:${agent.id}`;
    const workspaceRef = runtime.workspaceRef ?? runtime.workspace_ref ?? runtime.runtime?.workspaceRef ?? agent.workspaceRef ?? `hermes:${principal.organizationId}:${principal.userId}:${agent.id}`;
    const scope = {
      organization_id: principal.organizationId,
      user_id: principal.userId,
      agent_id: agent.id,
      runtime_id: runtimeId,
      workspace_id: runtime.workspaceId ?? runtime.workspace_id ?? workspaceIdFromRef(workspaceRef)
    };
    if (conversationId) scope.conversation_id = conversationId;
    return scope;
  }

  operationEnvelope({ principal, agent, operation, input = {}, runtime }) {
    this.validateAgent(principal, agent);
    return {
      schema_version: RUNTIME_PROTOCOL_VERSION,
      operation,
      owner_scope: this.ownerScope(principal, agent, runtime, input.session_id ?? input.conversation_id),
      actor: { user_id: principal.userId, roles: [principal.role] },
      channel_context: { channel: "web", conversation_id: input.session_id },
      input,
      trace: { correlation_id: randomUUID() },
      created_at: new Date().toISOString()
    };
  }

  async operation(options) {
    const runtime = await this.resolveRuntime(options.agent);
    const envelope = validateRuntimeOperationEnvelope(this.operationEnvelope({ ...options, runtime }));
    return this.signedPost("/v1/runtime/operations", envelope, { runtime });
  }

  async streamOperation(options) {
    const runtime = await this.resolveRuntime(options.agent);
    const envelope = validateRuntimeStreamEnvelope(this.operationEnvelope({ ...options, runtime }));
    return this.signedPost("/v1/runtime/streams", envelope, { runtime, signal: options.signal, stream: true });
  }
}
