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

function opaqueProvider(provider, apiKeyEnvelope) {
  const metadata = {
    provider: provider.provider,
    baseUrl: provider.baseUrl,
    model: provider.model,
    ...(provider.keyHint ? { keyHint: provider.keyHint } : {})
  };
  // Keep the sealed value available to the provisioning path without serializing it.
  Object.defineProperty(metadata, "apiKeyEnvelope", { value: apiKeyEnvelope, enumerable: false, writable: false });
  return metadata;
}

function opaqueAuthorization(authorization) {
  if (!authorization) return null;
  return {
    id: authorization.id,
    service: authorization.service,
    label: authorization.label,
    authType: authorization.authType,
    endpointUrl: authorization.endpointUrl ?? null,
    metadata: authorization.metadata ?? {},
    status: authorization.status,
    configured: Boolean(authorization.credentialEnvelope),
    credentialMasked: authorization.credentialHint ? `****${authorization.credentialHint}` : null
  };
}

async function resolveAgentAuthorization({ repository, providerVault, principal, agent, authorizationId }) {
  if (!authorizationId || !providerVault) return null;
  const authorization = await repository.getAgentAuthorization(principal.organizationId, principal.userId, agent.id, authorizationId);
  if (!authorization || authorization.service !== "model-provider" || authorization.status !== "stored" || !authorization.credentialEnvelope) return null;
  let credential;
  try { credential = JSON.parse(providerVault.open(authorization.credentialEnvelope)); }
  catch { throw exposedError("model_provider_credential_invalid", 409); }
  const secret = typeof credential?.secret === "string" ? credential.secret.trim() : "";
  if (!secret) throw exposedError("model_provider_credential_invalid", 409);
  return { authorization, secret };
}

export function createAgentInitializationProvider({ repository, providerVault }) {
  return async function agentInitializationProvider(principal, agent, body) {
    if (!principal || !agent || principal.organizationId !== agent.organizationId || principal.userId !== agent.ownerUserId) {
      throw exposedError("agent_not_found", 404);
    }
    const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
    const requestedMode = typeof input.mode === "string" ? input.mode.trim() : "";
    if (requestedMode && !["agent", "platform"].includes(requestedMode)) throw exposedError("invalid_provider_mode", 400);
    const hasInlineProvider = [input.provider, input.baseUrl, input.model, input.apiKey].some((item) => typeof item === "string" && item.trim());
    const authorizationId = typeof input.authorizationId === "string" && input.authorizationId ? input.authorizationId : "";
    if (["provisioning", "ready"].includes(agent.initializationStatus) && (hasInlineProvider || authorizationId)) {
      throw exposedError(agent.initializationStatus === "ready" ? "agent_already_initialized" : "agent_initialization_in_progress", 409);
    }
    if (requestedMode === "platform" && (hasInlineProvider || authorizationId)) throw exposedError("invalid_provider_mode", 400);
    const requestedAuthorization = authorizationId ? await resolveAgentAuthorization({ repository, providerVault, principal, agent, authorizationId }) : null;
    if (authorizationId && !requestedAuthorization) throw exposedError("authorization_not_found", 404);
    const authorizations = requestedAuthorization ? [requestedAuthorization.authorization] : await repository.listAgentAuthorizations(principal.organizationId, principal.userId, agent.id);
    const existing = requestedAuthorization?.authorization ?? authorizations.find((item) => item.service === "model-provider" && item.status === "stored" && item.credentialEnvelope);
    const mode = requestedMode || (hasInlineProvider || existing ? "agent" : "platform");

    if (mode === "platform") {
      const provider = await repository.getProviderConfiguration(principal.organizationId);
      if (!provider?.apiKeyEnvelope || !provider.provider || !provider.model) throw exposedError("model_provider_not_configured", 409);
      return { provider: opaqueProvider(provider, provider.apiKeyEnvelope), source: "platform", authorization: null };
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

    let apiKey = requestedAuthorization?.secret ?? (typeof input.apiKey === "string" ? input.apiKey.trim() : "");
    if (!apiKey && existing?.credentialEnvelope) {
      const resolved = await resolveAgentAuthorization({ repository, providerVault, principal, agent, authorizationId: existing.id });
      apiKey = resolved?.secret ?? "";
    }
    if (!apiKey || apiKey.length > 64_000 || /[\0\r\n]/.test(apiKey)) throw exposedError("provider_api_key_required", 400);

    const authorization = await repository.upsertAgentAuthorization({
      id: existing?.id, organizationId: principal.organizationId, userId: principal.userId, agentId: agent.id,
      service: "model-provider", label: existing?.label || AUTHORIZATION_LABEL, authType, endpointUrl: baseUrl,
      metadata: { provider: providerId, model }, credentialEnvelope: providerVault.seal(JSON.stringify({ secret: apiKey })), credentialHint: secretHint(apiKey)
    });
    await repository.markAgentAuthorizationUsed(authorization.id);
    return { provider: opaqueProvider({ provider: providerId, baseUrl, model, keyHint: secretHint(apiKey) }, providerVault.seal(apiKey)), source: "agent", authorization: opaqueAuthorization(authorization) };
  };
}
