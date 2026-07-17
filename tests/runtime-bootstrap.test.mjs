import assert from "node:assert/strict";
import test from "node:test";
import { MemoryPlatformRepository } from "../packages/db/memory-repository.mjs";
import { agentWorkspaceRef, ensureActiveAgentRuntimes } from "../packages/db/runtime-bootstrap.mjs";

test("Runtime bootstrap backfills active Agents idempotently and skips deleted Agents", async () => {
  const repository = new MemoryPlatformRepository();
  const organization = await repository.createOrganization({ id: "org_bootstrap", name: "Bootstrap" });
  const user = await repository.createUser({ id: "user_bootstrap", organizationId: organization.id, email: "bootstrap@example.test", displayName: "Bootstrap", passwordHash: "hash", role: "user" });
  const active = await repository.createAgent({ id: "agent_active", organizationId: organization.id, ownerUserId: user.id, name: "Active" });
  const deleted = await repository.createAgent({ id: "agent_deleted", organizationId: organization.id, ownerUserId: user.id, name: "Deleted", status: "deleted" });

  const first = await ensureActiveAgentRuntimes(repository);
  const second = await ensureActiveAgentRuntimes(repository);

  assert.equal(first.length, 1);
  assert.equal(second[0].id, first[0].id);
  assert.equal((await repository.getAgentRuntimeByAgent(active.id)).workspaceRef, agentWorkspaceRef(active));
  assert.equal(await repository.getAgentRuntimeByAgent(deleted.id), null);
});
