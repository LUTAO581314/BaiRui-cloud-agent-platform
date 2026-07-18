import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readBailongmaPatchManifest, BAILONGMA_PATCH_MANIFEST } from "../packages/bailongma-ui/patch-queue.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("BaiLongma patch queue is pinned, complete and source-addressable", () => {
  const manifestPath = path.join(root, BAILONGMA_PATCH_MANIFEST);
  const { manifest, manifestSha256 } = readBailongmaPatchManifest(manifestPath);
  assert.equal(manifest.upstream.repository, "xiaoyuanda666-ship-it/BaiLongma");
  assert.equal(manifest.upstream.pinnedCommit, "34d939eabe226c561550079cb810090015b49817");
  assert.match(manifestSha256, /^[a-f0-9]{64}$/);
  assert.ok(manifest.patches.length >= 6);
  assert.equal(new Set(manifest.patches.map((patch) => patch.id)).size, manifest.patches.length);
  for (const patch of manifest.patches) {
    assert.ok(patch.target);
    assert.ok(patch.handler);
    assert.ok(patch.anchors.length > 0);
    assert.ok(patch.tests.length > 0);
    assert.ok(patch.removalCondition);
  }
});

test("BaiLongma patch queue does not authorize global browser transport replacement", () => {
  const manifest = fs.readFileSync(path.join(root, BAILONGMA_PATCH_MANIFEST), "utf8");
  assert.doesNotMatch(manifest, /window\.fetch\s*=|window\.EventSource\s*=/);
});
