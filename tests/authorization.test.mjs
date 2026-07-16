import test from "node:test";
import assert from "node:assert/strict";
import { PERMISSIONS, ROLES, can, requirePermission } from "../packages/auth/authorization.mjs";

const user = { userId: "user_a", organizationId: "org_a", role: ROLES.USER };
const orgAdmin = { userId: "admin_a", organizationId: "org_a", role: ROLES.ORG_ADMIN };
const platformAdmin = { userId: "root", organizationId: "org_platform", role: ROLES.PLATFORM_ADMIN };

test("ordinary users can use only their own organization resources", () => {
  assert.equal(can(user, PERMISSIONS.AGENT_USE, { organizationId: "org_a" }), true);
  assert.equal(can(user, PERMISSIONS.AGENT_MANAGE_OWN, { organizationId: "org_a", userId: "user_a" }), true);
  assert.equal(can(user, PERMISSIONS.AGENT_MANAGE_OWN, { organizationId: "org_a", userId: "user_b" }), false);
  assert.equal(can(user, PERMISSIONS.AGENT_USE, { organizationId: "org_b" }), false);
  assert.equal(can(user, PERMISSIONS.CONTROL_PLANE_READ), false);
});

test("organization administrators cannot cross organization boundaries", () => {
  assert.equal(can(orgAdmin, PERMISSIONS.ORG_MEMBERS_MANAGE, { organizationId: "org_a" }), true);
  assert.equal(can(orgAdmin, PERMISSIONS.CONTROL_PLANE_MANAGE, { organizationId: "org_a" }), true);
  assert.equal(can(orgAdmin, PERMISSIONS.DATA_GOVERNANCE_MANAGE, { organizationId: "org_a" }), true);
  assert.equal(can(orgAdmin, PERMISSIONS.SENSITIVE_ACCESS_MANAGE, { organizationId: "org_a" }), false);
  assert.equal(can(orgAdmin, PERMISSIONS.ORG_MEMBERS_MANAGE, { organizationId: "org_b" }), false);
  assert.throws(() => requirePermission(orgAdmin, PERMISSIONS.ORG_AUDIT_READ, { organizationId: "org_b" }), { name: "AuthorizationError" });
});

test("platform administrators receive explicit platform permissions", () => {
  assert.equal(can(platformAdmin, PERMISSIONS.PLATFORM_USERS_MANAGE), true);
  assert.equal(can(platformAdmin, PERMISSIONS.CONTROL_PLANE_READ, { organizationId: "org_a" }), true);
});
