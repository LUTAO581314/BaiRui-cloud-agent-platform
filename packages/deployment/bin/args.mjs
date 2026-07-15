export function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    if (!values[index].startsWith("--")) continue;
    const [key, inline] = values[index].slice(2).split("=", 2);
    result[key] = inline ?? values[++index];
  }
  return result;
}

export function deploymentInput(options) {
  return { organizationId: options["organization-id"], licenseId: options["license-id"], serverId: options["server-id"], platformUrl: options["platform-url"], agentRef: options["agent-ref"] };
}
