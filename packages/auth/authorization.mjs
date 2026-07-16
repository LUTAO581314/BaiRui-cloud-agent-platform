export const ROLES = Object.freeze({
  USER: "user",
  ORG_ADMIN: "org_admin",
  PLATFORM_ADMIN: "platform_admin"
});

export const PERMISSIONS = Object.freeze({
  SELF_READ: "self:read",
  AGENT_CREATE: "agent:create",
  AGENT_READ: "agent:read",
  AGENT_MANAGE_OWN: "agent:manage-own",
  AGENT_USE: "agent:use",
  CONVERSATION_READ: "conversation:read",
  CONVERSATION_WRITE: "conversation:write",
  ORG_MEMBERS_MANAGE: "org:members:manage",
  ORG_AGENTS_MANAGE: "org:agents:manage",
  ORG_AUDIT_READ: "org:audit:read",
  PLATFORM_OVERVIEW_READ: "platform:overview:read",
  PLATFORM_USERS_MANAGE: "platform:users:manage",
  PLATFORM_ORGS_MANAGE: "platform:organizations:manage",
  PLATFORM_LICENSES_MANAGE: "platform:licenses:manage",
  PLATFORM_SERVERS_MANAGE: "platform:servers:manage",
  PLATFORM_RELEASES_MANAGE: "platform:releases:manage",
  PLATFORM_PROVIDER_SETTINGS_MANAGE: "platform:provider-settings:manage",
  CONTROL_PLANE_READ: "control-plane:read",
  CONTROL_PLANE_MANAGE: "control-plane:manage",
  DATA_GOVERNANCE_MANAGE: "data-governance:manage",
  SENSITIVE_ACCESS_MANAGE: "sensitive-access:manage",
  CONTROL_PLANE_INGEST: "control-plane:ingest"
});

const grants = new Map([
  [ROLES.USER, new Set([
    PERMISSIONS.SELF_READ,
    PERMISSIONS.AGENT_CREATE,
    PERMISSIONS.AGENT_READ,
    PERMISSIONS.AGENT_MANAGE_OWN,
    PERMISSIONS.AGENT_USE,
    PERMISSIONS.CONVERSATION_READ,
    PERMISSIONS.CONVERSATION_WRITE
  ])],
  [ROLES.ORG_ADMIN, new Set([
    PERMISSIONS.SELF_READ,
    PERMISSIONS.AGENT_CREATE,
    PERMISSIONS.AGENT_READ,
    PERMISSIONS.AGENT_MANAGE_OWN,
    PERMISSIONS.AGENT_USE,
    PERMISSIONS.CONVERSATION_READ,
    PERMISSIONS.CONVERSATION_WRITE,
    PERMISSIONS.ORG_MEMBERS_MANAGE,
    PERMISSIONS.ORG_AGENTS_MANAGE,
    PERMISSIONS.ORG_AUDIT_READ,
    PERMISSIONS.CONTROL_PLANE_READ,
    PERMISSIONS.CONTROL_PLANE_MANAGE,
    PERMISSIONS.DATA_GOVERNANCE_MANAGE
  ])],
  [ROLES.PLATFORM_ADMIN, new Set(Object.values(PERMISSIONS))]
]);

export class AuthorizationError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "AuthorizationError";
    this.statusCode = 403;
  }
}

export function isRole(value) {
  return Object.values(ROLES).includes(value);
}

export function can(principal, permission, resource = {}) {
  if (!principal || !isRole(principal.role)) return false;
  if (!grants.get(principal.role)?.has(permission)) return false;
  if (principal.role === ROLES.PLATFORM_ADMIN) return true;
  if (resource.organizationId && resource.organizationId !== principal.organizationId) return false;
  if (principal.role === ROLES.USER && resource.userId && resource.userId !== principal.userId) return false;
  return true;
}

export function requirePermission(principal, permission, resource) {
  if (!can(principal, permission, resource)) throw new AuthorizationError();
  return principal;
}
