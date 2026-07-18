import assert from "node:assert/strict";
import test from "node:test";
import { deriveMachineKey, signMachineRequest, verifyMachineRequest } from "../packages/security/machine-request.mjs";

test("machine requests bind method, path, timestamp, nonce, and body", () => {
  const token = "machine-token-that-is-longer-than-thirty-two-characters";
  const input = { method: "POST", path: "/api/internal/control-plane/leases", timestamp: "1784160000000", nonce: "nonce_value_1234567890", body: '{"serverId":"server_a"}' };
  const signature = signMachineRequest({ ...input, token });
  assert.equal(verifyMachineRequest({ ...input, signature, keyHash: deriveMachineKey(token), now: Number(input.timestamp) }), true);
  assert.equal(verifyMachineRequest({ ...input, path: "/other", signature, keyHash: deriveMachineKey(token), now: Number(input.timestamp) }), false);
  assert.equal(verifyMachineRequest({ ...input, body: "{}", signature, keyHash: deriveMachineKey(token), now: Number(input.timestamp) }), false);
  assert.equal(verifyMachineRequest({ ...input, signature, keyHash: deriveMachineKey(token), now: Number(input.timestamp) + 600_000 }), false);
});
