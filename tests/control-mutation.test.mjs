import assert from "node:assert/strict";
import test from "node:test";
import { signControlMutation, verifyControlMutationSignature } from "../packages/security/control-mutation.mjs";
import { CONTROL_TOKEN } from "./helpers/control-envelopes.mjs";

const now = Date.now();
const mutation = {
  schema_version: "1.0",
  organization_id: "org_a",
  user_id: "user_a",
  agent_id: "agent_a",
  server_id: "server_a",
  request_id: "request_a",
  correlation_id: "correlation_a",
  idempotency_key: "idempotency_a",
  created_at: new Date(now).toISOString(),
  revision: 1,
  sequence: 1
};

test("embedded control signatures bind the canonical mutation body and signing time", () => {
  const signed = signControlMutation(mutation, { token: CONTROL_TOKEN, keyId: "server_a", now });
  assert.equal(verifyControlMutationSignature(signed, { token: CONTROL_TOKEN, expectedKeyId: "server_a", now }), true);
  assert.equal(verifyControlMutationSignature({ ...signed, sequence: 2 }, { token: CONTROL_TOKEN, expectedKeyId: "server_a", now }), false);
  assert.equal(verifyControlMutationSignature(signed, { token: CONTROL_TOKEN, expectedKeyId: "server_b", now }), false);
  assert.equal(verifyControlMutationSignature(signed, { token: CONTROL_TOKEN, expectedKeyId: "server_a", now: now + 600_000 }), false);
});
