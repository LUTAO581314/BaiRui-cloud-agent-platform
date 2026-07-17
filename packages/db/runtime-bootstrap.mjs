export function agentWorkspaceRef(agent) {
  return `hermes:${agent.organizationId}:${agent.ownerUserId}:${agent.id}`;
}

export async function ensureAgentRuntime(repository, agent) {
  return repository.createAgentRuntime({
    organizationId: agent.organizationId,
    ownerUserId: agent.ownerUserId,
    agentId: agent.id,
    workspaceRef: agentWorkspaceRef(agent)
  });
}

export async function ensureActiveAgentRuntimes(repository) {
  const runtimes = [];
  for (const agent of await repository.listAgents()) {
    if (["deleting", "deleted"].includes(agent.status)) continue;
    runtimes.push(await ensureAgentRuntime(repository, agent));
  }
  return runtimes;
}
