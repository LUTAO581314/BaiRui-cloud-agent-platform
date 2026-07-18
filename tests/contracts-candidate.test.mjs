import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CONTRACTS_VERSION,
  CONTROL_ACTIONS,
  CONTROL_QUARANTINED_ACTIONS,
  CONTROL_RECEIPT_STATES
} from "@bairui/contracts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Platform consumes the published Contracts release without claiming Gate C00", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const status = fs.readFileSync(path.join(root, "docs/C00-02-CONSUMER-STATUS.md"), "utf8");
  const declarations = fs.readFileSync(path.join(root, "node_modules/@bairui/contracts/dist/index.d.ts"), "utf8");
  const protocol = fs.readFileSync(path.join(root, "packages/server-protocol/control-plane.mjs"), "utf8");
  const dependency = "https://codeload.github.com/LUTAO581314/BaiRui-contracts/tar.gz/refs/tags/v2.3.0-rc.2";
  assert.equal(manifest.dependencies["@bairui/contracts"], dependency);
  assert.equal(lock.packages["node_modules/@bairui/contracts"].resolved, dependency);
  assert.equal(lock.packages["node_modules/@bairui/contracts"].version, "2.3.0-rc.2");
  assert.match(lock.packages["node_modules/@bairui/contracts"].integrity, /^sha512-/);
  assert.equal(CONTRACTS_VERSION, "2.3.0-rc.2");
  assert.equal(CONTROL_ACTIONS.includes("config.apply-user"), false);
  assert.equal(CONTROL_QUARANTINED_ACTIONS.includes("config.apply-user"), true);
  assert.equal(CONTROL_RECEIPT_STATES.includes("succeeded"), false);
  for (const type of ["CanonicalControlCommandEnvelope", "CanonicalLeaseEnvelope", "LeaseRequestEnvelope", "ReceiptEnvelope", "ControlError"]) assert.match(declarations, new RegExp(`(?:interface|type) ${type}`));
  for (const type of ["CanonicalControlCommandEnvelope", "CanonicalLeaseEnvelope", "LeaseRequestEnvelope", "ReceiptEnvelope"]) assert.ok(protocol.includes(type));
  assert.match(status, /f5c14223e8f26ff00712f4b0ab65402621a1239e/);
  assert.match(status, /not a `GATE-C00` result/);
});
