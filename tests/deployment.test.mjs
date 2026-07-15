import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDeploymentConfig, verifyDeliveryBundle, writeDeliveryBundle } from "../packages/deployment/bundle.mjs";

test("deployment bundles are explicit and hash verified", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bairui-delivery-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = { organizationId: "org_a", licenseId: "lic_a", serverId: "server_a", platformUrl: "https://platform.example.test/", generatedAt: "2026-01-01T00:00:00.000Z" };
  assert.equal(createDeploymentConfig(input).platformUrl, "https://platform.example.test");
  writeDeliveryBundle(directory, input);
  assert.equal(verifyDeliveryBundle(directory).valid, true);
  fs.appendFileSync(path.join(directory, "deployment.json"), "tampered");
  assert.equal(verifyDeliveryBundle(directory).valid, false);
});
