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
  const result = await client.invoke({ principal: { userId: "user_a", organizationId: "org_a", role: "user" }, conversation: { id: "conversation_a" }, content: "Hello" });
  assert.equal(result.content, "Hello");
  assert.equal(captured.body.request.tenant.organization_id, "org_a");
  assert.equal(captured.body.request.actor.user_id, "user_a");
  const canonical = `${captured.options.headers["x-bairui-timestamp"]}.${captured.options.headers["x-bairui-nonce"]}.${captured.options.body}`;
  assert.equal(captured.options.headers["x-bairui-signature"], createHmac("sha256", secret).update(canonical).digest("base64url"));
});

test("runtime client does not convert runtime failures into assistant text", async () => {
  const client = new BairuiRuntimeClient({ sharedSecret: secret, fetch: async () => Response.json({ error: "runtime_failed" }, { status: 502 }) });
  await assert.rejects(() => client.invoke({ principal: { userId: "u", organizationId: "o", role: "user" }, conversation: { id: "c" }, content: "x" }), { statusCode: 503 });
});
