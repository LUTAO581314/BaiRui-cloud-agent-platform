import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { issueLicense, verifyLicense } from "../packages/license/license.mjs";

test("licenses are signed, scoped, and locally verifiable", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const document = issueLicense({ organizationId: "org_a", plan: "business", features: ["runtime", "web"], expiresAt: "2030-01-01T00:00:00.000Z" }, privateKey);
  const result = verifyLicense(document, publicKey, Date.parse("2029-01-01T00:00:00.000Z"));
  assert.equal(result.valid, true);
  assert.equal(result.payload.organizationId, "org_a");
});

test("tampered and expired licenses are rejected", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const document = issueLicense({ organizationId: "org_a", plan: "starter", expiresAt: "2026-01-01T00:00:00.000Z" }, privateKey);
  assert.equal(verifyLicense({ ...document, payload: { ...document.payload, plan: "enterprise" } }, publicKey, 0).reason, "invalid_signature");
  assert.equal(verifyLicense(document, publicKey, Date.parse("2027-01-01T00:00:00.000Z")).reason, "expired");
});
