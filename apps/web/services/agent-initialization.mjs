import { secretHint } from "../../../packages/security/secret-envelope.mjs";

const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const AUTHORIZATION_TYPES = new Set(["api_key", "bearer_token"]);
const AUTHORIZATION_LABEL = "Hermes 推理模型";

function providerEndpoint(value) {
  if (value === undefined || value === null || value === "" || String(value).length > 2_000) return null;
  let endpoint;
  try { endpoint = new URL(String(value)); } catch { return null; }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) return null;
  return endpoint.toString().replace(/\/$/, "");
}

function exposedError(code, statusCode) {
  return Object.assign(new Error(code), { statusCode, expose: true });
}

export function createAgentInitializationProvider({ repository, providerVault }) {
  return async function agentInitializationProvider(principal, agent, body) {
    const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
    const requestedMode = typeof input.mode === "string" ? input.mode.trim() : "";
    if (requestedMode && !["agent", "platform"].includes(requestedMode)) throw exposedError("invalid_provider_mode", 400);
    const authorizations = await repository.listAgentAuthorizations(principal.organizationId, principal.userId, agent.id);
    const requestedAuthorization = typeof input.authorizationId === "string" && input.authorizationId ? authorizations.find((item) => item.id === input.authorizationId) : null;
    if (input.authorizationId && !requestedAuthorization) throw exposedError("authorization_not_found", 404);
    const existing = requestedAuthorization ?? authorizations.find((item) => item.service === "model-provider" && item.status === "stored" && item.credentialEnvelope);
    const hasInlineProvider = [input.provider, input.baseUrl, input.model, input.apiKey].some((item) => typeof item === "string" && item.trim());
    const mode = requestedMode || (hasInlineProvider || existing ? "agent" : "platform");

    if (mode === "platform") {
      const provider = await repository.getProviderConfiguration(principal.organizationId);
      if (!provider?.apiKeyEnvelope || !provider.provider || !provider.model) throw exposedError("model_provider_not_configured", 409);
      return { provider, source: "platform", authorization: null };
    }

    const policy = await repository.getModelPolicy(principal.organizationId);
    if (policy?.userCustomKeysAllowed === false) throw exposedError("user_custom_keys_disabled", 403);
    if (!providerVault) throw exposedError("secret_storage_unavailable", 503);
    if (existing && (existing.service !== "model-provider" || existing.status !== "stored" || !existing.credentialEnvelope)) throw exposedError("model_provider_authorization_unavailable", 409);

    const providerId = String(input.provider || existing?.metadata?.provider || "custom").trim().toLowerCase();
    const baseUrl = providerEndpoint(input.baseUrl ?? existing?.endpointUrl);
    const model = String(input.model || existing?.metadata?.model || agent.settings?.preferredModel || "").trim();
    const authType = String(input.authType || existing?.authType || "api_key").trim();
    if (!PROVIDER_ID.test(providerId) || !baseUrl || !model || model.length > 200 || /[\0\r\n]/.test(model) || !AUTHORIZATION_TYPES.has(authType)) throw exposedError("invalid_hermes_provider_configuration", 400);
    if (policy?.allowedModels?.length && !policy.allowedModels.includes(model)) throw exposedError("model_not_allowed", 400);

    let apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    if (!apiKey && existing?.credentialEnvelope) {
      try { apiKey = String(JSON.parse(providerVault.open(existing.credentialEnvelope)).secret ?? "").trim(); }
      catch { throw exposedError("model_provider_credential_invalid", 409); }
    }
    if (!apiKey || apiKey.length > 64_000 || /[\0\r\n]/.test(apiKey)) throw exposedError("provider_api_key_required", 400);

    const authorization = await repository.upsertAgentAuthorization({
      id: existing?.id, organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id,
      service: "model-provider", label: existing?.label || AUTHORIZATION_LABEL, authType, endpointUrl: baseUrl,
      metadata: { provider: providerId, model }, credentialEnvelope: providerVault.seal(JSON.stringify({ secret: apiKey })), credentialHint: secretHint(apiKey)
    });
    await repository.markAgentAuthorizationUsed(authorization.id);
    return { provider: { provider: providerId, baseUrl, model, apiKeyEnvelope: providerVault.seal(apiKey), keyHint: secretHint(apiKey) }, source: "agent", authorization };
  };
}
