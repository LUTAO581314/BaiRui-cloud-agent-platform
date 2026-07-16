import { PERMISSIONS, ROLES, requirePermission } from "../../../packages/auth/authorization.mjs";
import { hashPassword, verifyPassword } from "../../../packages/auth/password.mjs";
import {
  clearSessionCookie,
  createSessionToken,
  sessionCookie
} from "../../../packages/auth/session.mjs";
import { json, readJson } from "../http.mjs";

export function createAuthRoutes(options) {
  const {
    repository,
    sessionSecret,
    secureCookies,
    allowRegistration,
    requireLogin
  } = options;
  const loginAttempts = new Map();

  return async function routeAuth(context) {
    const { method, url, request, response, principal } = context;
    if (method === "POST" && url.pathname === "/api/auth/login") {
      const ip = request.socket.remoteAddress ?? "unknown";
      const attempt = loginAttempts.get(ip) ?? { count: 0, resetAt: Date.now() + 60_000 };
      if (attempt.resetAt <= Date.now()) Object.assign(attempt, { count: 0, resetAt: Date.now() + 60_000 });
      if (attempt.count >= 10) {
        json(response, 429, { error: "too_many_attempts" });
        return true;
      }
      attempt.count += 1;
      loginAttempts.set(ip, attempt);
      const body = await readJson(request);
      const user = typeof body.email === "string" ? await repository.findUserByEmail(body.email) : null;
      if (!user || user.status !== "active" || !(await verifyPassword(body.password, user.passwordHash))) {
        json(response, 401, { error: "invalid_credentials" });
        return true;
      }
      loginAttempts.delete(ip);
      const token = createSessionToken({ userId: user.id, organizationId: user.organizationId, role: user.role }, sessionSecret);
      await repository.recordAudit({ organizationId: user.organizationId, actorUserId: user.id, action: "auth.login", targetType: "user", targetId: user.id });
      json(response, 200, { user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } }, { "set-cookie": sessionCookie(token, { secure: secureCookies }) });
      return true;
    }

    if (method === "POST" && url.pathname === "/api/auth/register") {
      if (!allowRegistration) {
        json(response, 404, { error: "not_found" });
        return true;
      }
      const body = await readJson(request);
      const organization = await repository.createOrganization({ name: body.organizationName || "Personal workspace" });
      const passwordHash = await hashPassword(body.password);
      const user = await repository.createUser({ organizationId: organization.id, email: body.email, displayName: body.displayName || body.email, passwordHash, role: ROLES.ORG_ADMIN });
      await repository.createAgent({ organizationId: organization.id, ownerUserId: user.id, name: "bairui-agent", description: "User-owned Hermes agent" });
      await repository.recordAudit({ organizationId: organization.id, actorUserId: user.id, action: "organization.register", targetType: "organization", targetId: organization.id });
      json(response, 201, { id: user.id });
      return true;
    }

    if (method === "POST" && url.pathname === "/api/auth/logout") {
      json(response, 200, { ok: true }, { "set-cookie": clearSessionCookie({ secure: secureCookies }) });
      return true;
    }
    if (method === "GET" && url.pathname === "/api/me") {
      requirePermission(requireLogin(principal), PERMISSIONS.SELF_READ, { userId: principal.userId, organizationId: principal.organizationId });
      json(response, 200, { user: principal });
      return true;
    }
    return false;
  };
}
