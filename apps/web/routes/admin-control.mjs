import { randomUUID } from "node:crypto";
import {
  AuthorizationError,
  PERMISSIONS,
  ROLES,
  requirePermission
} from "../../../packages/auth/authorization.mjs";
import { json, readJson } from "../http.mjs";

export function createAdminControlRoutes(options) {
  const {
    repository,
    requireLogin,
    managedOrganizationId,
    adminControlActions,
    platformControlActions,
    approvalControlActions,
    controlOperationArguments,
    immutableImage
  } = options;

  return async function routeAdminControl(context) {
    const { method, url, request, response, principal } = context;
    const send = (statusCode, body) => {
      json(response, statusCode, body);
      return true;
    };

    if (method === "GET" && url.pathname === "/api/admin/control-commands") {
      requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
      const scope = principal.role === ROLES.PLATFORM_ADMIN && !url.searchParams.get("organization_id") ? undefined : managedOrganizationId(principal, url);
      return send(200, { commands: await repository.listControlCommands(scope, url.searchParams.get("limit")) });
    }
    if (method === "POST" && url.pathname === "/api/admin/control-commands") {
      requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_MANAGE, { organizationId: principal.organizationId });
      const body = await readJson(request);
      if (!adminControlActions.has(body.action) || typeof body.agentId !== "string") return send(400, { error: "invalid_control_operation" });
      if (platformControlActions.has(body.action) && principal.role !== ROLES.PLATFORM_ADMIN) throw new AuthorizationError();
      const agent = await repository.getAgent(body.agentId);
      if (!agent || (principal.role !== ROLES.PLATFORM_ADMIN && agent.organizationId !== principal.organizationId)) return send(404, { error: "agent_not_found" });
      const requestedOrganization = url.searchParams.get("organization_id");
      if (requestedOrganization && requestedOrganization !== agent.organizationId) return send(400, { error: "agent_scope_mismatch" });
      const operationArguments = controlOperationArguments(body.action, body);
      if (!operationArguments) return send(400, { error: "invalid_control_arguments" });
      const approvalRequired = approvalControlActions.has(body.action);
      if (approvalRequired && (typeof body.reason !== "string" || body.reason.trim().length < 10)) return send(400, { error: "control_reason_required" });
      const suppliedIdempotencyKey = request.headers["idempotency-key"];
      const idempotencyToken = typeof suppliedIdempotencyKey === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(suppliedIdempotencyKey) ? suppliedIdempotencyKey : randomUUID();
      const result = await repository.requestControlOperation({
        organizationId: agent.organizationId,
        agentId: agent.id,
        action: body.action,
        arguments: operationArguments,
        requestedBy: principal.userId,
        idempotencyKey: [agent.id, body.action, idempotencyToken].join("/"),
        approvalRequired,
        riskLevel: ["backup.restore", "release.apply", "release.rollback", "credential.revoke"].includes(body.action) ? "critical" : approvalRequired ? "high" : "medium",
        reason: typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : ""
      });
      await repository.recordAudit({ organizationId: agent.organizationId, actorUserId: principal.userId, action: "control.command.request", targetType: "control_command", targetId: result.command.id, metadata: { agentId: agent.id, action: body.action, approvalRequired, arguments: operationArguments } });
      return send(202, result);
    }
    if (method === "GET" && url.pathname === "/api/admin/control-approvals") {
      requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
      const scope = principal.role === ROLES.PLATFORM_ADMIN && !url.searchParams.get("organization_id") ? undefined : managedOrganizationId(principal, url);
      return send(200, { approvals: await repository.listControlApprovals(scope, url.searchParams.get("limit")) });
    }
    const approvalDecisionMatch = url.pathname.match(/^\/api\/admin\/control-approvals\/([^/]+)$/);
    if (approvalDecisionMatch && method === "PATCH") {
      requirePermission(requireLogin(principal), PERMISSIONS.PLATFORM_RELEASES_MANAGE);
      const body = await readJson(request);
      if (!["approved", "rejected"].includes(body.decision) || typeof body.reason !== "string" || body.reason.trim().length < 10) return send(400, { error: "invalid_approval_decision" });
      const approval = await repository.decideControlApproval({ approvalId: approvalDecisionMatch[1], decision: body.decision, reason: body.reason.trim().slice(0, 1000), decidedBy: principal.userId });
      if (!approval) return send(404, { error: "approval_not_found" });
      await repository.recordAudit({ organizationId: approval.organizationId, actorUserId: principal.userId, action: "control.approval." + body.decision, targetType: "control_approval", targetId: approval.id, metadata: { commandId: approval.commandId, action: approval.action, reason: approval.reason } });
      return send(200, { approval });
    }
    if (method === "GET" && url.pathname === "/api/admin/release-manifests") {
      requirePermission(requireLogin(principal), PERMISSIONS.CONTROL_PLANE_READ, { organizationId: principal.organizationId });
      return send(200, { manifests: await repository.listReleaseManifests() });
    }
    if (method === "POST" && url.pathname === "/api/admin/release-manifests") {
      requirePermission(requireLogin(principal), PERMISSIONS.PLATFORM_RELEASES_MANAGE);
      const body = await readJson(request);
      if (typeof body.version !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(body.version) || typeof body.agentCommit !== "string" || !/^[0-9a-f]{40}$/.test(body.agentCommit) || !immutableImage.test(body.hermesImage) || !immutableImage.test(body.runtimeImage) || !immutableImage.test(body.imageDigest)) return send(400, { error: "invalid_release_manifest" });
      const trustedUrl = (value) => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === "https:" && !parsed.username && !parsed.password;
        } catch {
          return false;
        }
      };
      if (!trustedUrl(body.sbomUri) || !trustedUrl(body.provenanceUri) || typeof body.signature !== "string" || body.signature.length < 32 || body.signature.length > 20_000) return send(400, { error: "invalid_release_evidence" });
      const manifest = await repository.createReleaseManifest({ version: body.version, agentCommit: body.agentCommit, imageDigest: body.imageDigest, sbomUri: body.sbomUri, provenanceUri: body.provenanceUri, signature: body.signature, migrationVersion: typeof body.migrationVersion === "string" ? body.migrationVersion.slice(0, 200) : null, compatibility: { hermes_image: body.hermesImage, runtime_image: body.runtimeImage }, status: "candidate", createdBy: principal.userId });
      await repository.recordAudit({ organizationId: principal.organizationId, actorUserId: principal.userId, action: "release.manifest.create", targetType: "release_manifest", targetId: manifest.id, metadata: { version: manifest.version, agentCommit: manifest.agentCommit, imageDigest: manifest.imageDigest } });
      return send(201, { manifest });
    }
    return false;
  };
}
