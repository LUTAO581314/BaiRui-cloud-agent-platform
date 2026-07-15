import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { BairuiRuntimeClient } from "../packages/server-protocol/runtime-client.mjs";

const secret = "platform-runtime-test-secret-longer-than-32-characters";

test("runtime client derives tenant and actor from the authenticated principal", async () => {
  let captured;
  const fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return Response.json({ result: { status: "completed", run_id: "run_1", reply: { content: "Hello" } } });
  };
  const client = new BairuiRuntimeClient({ baseUrl: "http://runtime.test", sharedSecret: secret, fetch });
  const result = await client.invoke({ principal: { userId: "user_a", organizationId: "org_a", role: "user" }, agent: { id: "agent_a", ownerUserId: "user_a", organizationId: "org_a" }, conversation: { id: "conversation_a" }, content: "Hello" });
  assert.equal(result.content, "Hello");
  assert.equal(captured.body.request.tenant.organization_id, "org_a");
  assert.equal(captured.body.request.tenant.agent_id, "agent_a");
  assert.equal(captured.body.request.actor.user_id, "user_a");
  const canonical = `${captured.options.headers["x-bairui-timestamp"]}.${captured.options.headers["x-bairui-nonce"]}.${captured.options.body}`;
  assert.equal(captured.options.headers["x-bairui-signature"], createHmac("sha256", secret).update(canonical).digest("base64url"));
});

test("runtime client does not convert runtime failures into assistant text", async () => {
  const client = new BairuiRuntimeClient({ sharedSecret: secret, fetch: async () => Response.json({ error: "runtime_failed" }, { status: 502 }) });
  await assert.rejects(() => client.invoke({ principal: { userId: "u", organizationId: "o", role: "user" }, agent: { id: "a", ownerUserId: "u", organizationId: "o" }, conversation: { id: "c" }, content: "x" }), { statusCode: 503 });
});

test("runtime client rejects a cross-user Agent before making a request", async () => {
  let called = false;
  const client = new BairuiRuntimeClient({ sharedSecret: secret, fetch: async () => { called = true; return Response.json({}); } });
  await assert.rejects(() => client.invoke({ principal: { userId: "user_a", organizationId: "org_a", role: "user" }, agent: { id: "agent_b", ownerUserId: "user_b", organizationId: "org_a" }, conversation: { id: "c" }, content: "x" }), { code: "agent_ownership_mismatch", statusCode: 403 });
  assert.equal(called, false);
});

test("runtime client signs service integration requests", async () => {
  let captured;
  const client = new BairuiRuntimeClient({ sharedSecret: secret, fetch: async (url, options) => {
    captured = { url, body: JSON.parse(options.body), headers: options.headers };
    return Response.json({ status: "completed", output: { items: [] } });
  } });
  await client.invokeIntegration({ integrationId: "trendradar", capability: "list_hotspots" });
  assert.match(captured.url, /\/v1\/integrations\/requests$/);
  assert.equal(captured.body.request.integration_id, "trendradar");
  assert.ok(captured.headers["x-bairui-signature"]);
});

test("runtime client resolves an Agent-specific Runtime for operations and native streams", async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (url.endsWith("/v1/runtime/streams")) return new Response('data: {"event":"run.completed"}\n\n', { headers: { "content-type": "text/event-stream" } });
    return Response.json({ object: "list", data: [] });
  };
  const client = new BairuiRuntimeClient({
    sharedSecret: secret,
    fetch,
    resolveRuntime: async (agent) => ({ baseUrl: `https://${agent.id}.runtime.test`, sharedSecret: `secret-for-${agent.id}-that-is-longer-than-32` })
  });
  const principal = { userId: "user_a", organizationId: "org_a", role: "user" };
  const agent = { id: "agent_a", ownerUserId: "user_a", organizationId: "org_a" };
  await client.operation({ principal, agent, operation: "sessions.list" });
  const stream = await client.streamOperation({ principal, agent, operation: "runs.events", input: { run_id: "run_a" } });
  assert.match(calls[0].url, /^https:\/\/agent_a\.runtime\.test/);
  assert.equal(calls[0].body.tenant.agent_id, "agent_a");
  assert.equal(calls[1].body.operation, "runs.events");
  assert.match(await stream.text(), /run\.completed/);
});
