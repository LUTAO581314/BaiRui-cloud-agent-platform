import assert from "node:assert/strict";
import test from "node:test";
import { validateLeaseRequestEnvelope, validateReceiptEnvelope } from "@bairui/contracts";
import { executeControlCycle, leaseControlCommands, sendCommandReceipt } from "../server-agent/control-client.mjs";
import { CONTROL_TOKEN, canonicalClientOptions, canonicalLease } from "./helpers/control-envelopes.mjs";

function authorityFetch(options = {}) {
  const receipts = [];
  const requests = [];
  const fetch = async (url, request) => {
    const body = JSON.parse(request.body);
    requests.push({ url, body, headers: request.headers });
    if (url.endsWith("/lease")) {
      const leaseRequest = validateLeaseRequestEnvelope(body);
      const lease = canonicalLease(leaseRequest, options.lease ?? {});
      if (options.mutateLease) options.mutateLease(lease);
      return Response.json(lease);
    }
    receipts.push(validateReceiptEnvelope(body));
    return Response.json({ accepted: true, receipt_id: body.receipt_id, state: body.state }, { status: 202 });
  };
  return { fetch, receipts, requests };
}

test("Server Agent sends canonical owner-scoped envelopes and completion candidates", async () => {
  const authority = authorityFetch();
  const results = await executeControlCycle(canonicalClientOptions({
    fetch: authority.fetch,
    executor: { execute: async () => ({ observationVersion: 2, evidenceRefs: ["ref:postcondition-a"], resultRef: "ref:result-a" }) }
  }));
  assert.equal(results[0].state, "completion_candidate");
  assert.deepEqual(authority.receipts.map((receipt) => receipt.state), ["accepted", "running", "completion_candidate"]);
  assert.equal(authority.requests[0].body.organization_id, "org_a");
  assert.equal(authority.requests[0].body.agent_id, "agent_a");
  assert.ok(authority.requests.every((item) => item.headers["x-bairui-timestamp"] && item.headers["x-bairui-nonce"] && item.headers["x-bairui-signature"]));
  assert.ok(authority.requests.every((item) => item.body.signature?.value));
  assert.doesNotMatch(JSON.stringify(authority.requests), /state":"succeeded"/);
});

test("Server Agent rejects invalid signatures, placement, expiry, raw payloads, and quarantined actions before execution", async () => {
  for (const scenario of [
    { lease: { token: "different-token-that-is-longer-than-thirty-two-characters" }, code: "invalid_signature" },
    { lease: { placement: { server_id: "server_b" } }, code: "invalid_lease_envelope" },
    { lease: { commandMilliseconds: -1 }, code: "invalid_lease_envelope" },
    { lease: { extraCommand: { config: { secrets: { api_key: "raw-secret" } } } }, code: "invalid_lease_envelope" },
    { lease: { action: "config.apply-user", arguments: { config_revision_id: "config_a" } }, code: "invalid_lease_envelope" }
  ]) {
    let executed = false;
    const authority = authorityFetch({ lease: scenario.lease });
    await assert.rejects(() => executeControlCycle(canonicalClientOptions({ fetch: authority.fetch, executor: { execute: async () => { executed = true; return {}; } } })), { code: scenario.code });
    assert.equal(executed, false);
    assert.equal(authority.receipts.length, 0);
  }
});

test("opaque secret references resolve locally and never enter receipts", async () => {
  const secret = "local-resolved-provider-secret";
  const authority = authorityFetch({ lease: { action: "config.apply", arguments: { config_revision_id: "config_a" }, approvalId: "approval_a", secretRefs: ["sr_1234567890abcdef"] } });
  let executorInput;
  const results = await executeControlCycle(canonicalClientOptions({
    fetch: authority.fetch,
    resolveSecretRefs: async ({ command, secretRefs }) => ({ ...command, localSecrets: Object.fromEntries(secretRefs.map((ref) => [ref, secret])) }),
    executor: { execute: async (command) => { executorInput = command; return { observationVersion: 3, evidenceRefs: ["ref:config-applied"] }; } }
  }));
  assert.equal(results[0].state, "completion_candidate");
  assert.match(JSON.stringify(executorInput), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(authority.receipts), new RegExp(secret));
  assert.equal(authority.receipts.at(-1).state, "completion_candidate");
});

test("missing completion evidence and unknown executor errors fail closed without leaking paths", async () => {
  for (const error of [null, Object.assign(new Error("Failed reading C:/private/secret-file"), { code: "backup_read_failed" })]) {
    const authority = authorityFetch();
    const result = await executeControlCycle(canonicalClientOptions({
      fetch: authority.fetch,
      executor: { execute: async () => {
        if (error) throw error;
        return { observationVersion: 2, evidenceRefs: [] };
      } }
    }));
    assert.equal(result[0].state, "failed");
    const failure = authority.receipts.at(-1);
    assert.equal(failure.state, "failed");
    assert.equal(failure.error_code, "verification_failed");
    assert.doesNotMatch(JSON.stringify(failure), /private|secret-file|backup_read_failed/);
  }
});

test("a lease signed with another machine token cannot be executed", async () => {
  const authority = authorityFetch({ lease: { token: `${CONTROL_TOKEN}-other` } });
  await assert.rejects(() => executeControlCycle(canonicalClientOptions({ fetch: authority.fetch, executor: { execute: async () => ({}) } })), { code: "invalid_signature" });
});

test("a rejected completion receipt is not rewritten as an executor failure", async () => {
  const receipts = [];
  const fetch = async (url, request) => {
    const body = JSON.parse(request.body);
    if (url.endsWith("/lease")) return Response.json(canonicalLease(validateLeaseRequestEnvelope(body)));
    receipts.push(validateReceiptEnvelope(body));
    if (body.state === "completion_candidate") {
      return Response.json({ schema_version: "1.0", error_code: "verification_failed", retryable: true, request_id: body.request_id, correlation_id: body.correlation_id, occurred_at: new Date().toISOString() }, { status: 503 });
    }
    return Response.json({ accepted: true }, { status: 202 });
  };
  await assert.rejects(() => executeControlCycle(canonicalClientOptions({
    fetch,
    executor: { execute: async () => ({ observationVersion: 2, evidenceRefs: ["ref:postcondition-a"] }) }
  })), { code: "verification_failed", statusCode: 503 });
  assert.deepEqual(receipts.map((receipt) => receipt.state), ["accepted", "running", "completion_candidate"]);
});

test("receipts cannot substitute a command, lease token, or owner scope", async () => {
  const authority = authorityFetch();
  const options = canonicalClientOptions({ fetch: authority.fetch });
  const lease = await leaseControlCommands(options);
  const command = lease.commands[0];
  await assert.rejects(() => sendCommandReceipt({ ...options, lease, command: { ...command, lease_token: "ref:other-token" }, state: "accepted", eventSequence: 1 }), { code: "lease_not_found" });
  await assert.rejects(() => sendCommandReceipt({ ...options, userId: "user_b", lease, command, state: "accepted", eventSequence: 1 }), { code: "owner_mismatch" });
  assert.equal(authority.receipts.length, 0);
});
