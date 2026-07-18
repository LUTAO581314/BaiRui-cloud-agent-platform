import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { toBailongmaHotspots } from "../packages/bailongma-ui/compatibility.mjs";
import { createPanelManifest, PANEL_DEFINITIONS, PANEL_STATES } from "../packages/bailongma-ui/panel-contracts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "u01-05-panel-golden.json"), "utf8"));
const matrix = JSON.parse(fs.readFileSync(path.join(root, "docs", "BAILONGMA-LIVE-PANEL-MATRIX.json"), "utf8"));

test("U01-05 P0 panel manifest has explicit live-loop contracts and deterministic states", () => {
  const manifest = createPanelManifest({
    agentId: golden.ownerScope.agent_id,
    ownerScope: golden.ownerScope,
    facts: golden.facts,
    generatedAt: golden.generatedAt
  });
  assert.equal(manifest.schema_version, "bairui.panel-manifest.v1");
  assert.equal(manifest.upstream.commit, "34d939eabe226c561550079cb810090015b49817");
  assert.deepEqual(Object.fromEntries(manifest.panels.filter((panel) => panel.priority === "P0").map((panel) => [panel.id, panel.state])), golden.p0States);
  for (const panel of manifest.panels.filter((item) => item.priority === "P0")) {
    assert.ok(PANEL_STATES.includes(panel.state), `${panel.id} has an invalid state`);
    for (const field of ["snapshot", "command", "events", "persistence", "revision", "recovery", "ownership"]) assert.ok(panel[field], `${panel.id} is missing ${field}`);
    assert.ok(PANEL_STATES.includes(panel.snapshot.status), `${panel.id} has an invalid snapshot state`);
    assert.ok(PANEL_STATES.includes(panel.command.status), `${panel.id} has an invalid command state`);
    assert.ok(PANEL_STATES.includes(panel.events.status), `${panel.id} has an invalid event state`);
    assert.ok(panel.persistence.authority);
    assert.ok(panel.revision.strategy);
    assert.ok(panel.recovery.strategy);
    assert.ok(Array.isArray(panel.ownership.scope));
  }
  assert.match(manifest.revision, /^[a-f0-9]{64}$/);
});

test("every matrix panel is represented by the executable panel contract", () => {
  assert.deepEqual(new Set(PANEL_DEFINITIONS.map((panel) => panel.id)), new Set(matrix.panels.map((panel) => panel.id)));
  assert.equal(matrix.panelContract.schema, "bairui.panel-manifest.v1");
  assert.equal(matrix.panelContract.implementation, "packages/bailongma-ui/panel-contracts.mjs");
  assert.ok(matrix.panelContract.tests.includes("tests/u01-05-panel-contract-golden.test.mjs"));
});

test("BaiLongma hotspot compatibility response matches the redacted golden fixture", () => {
  assert.deepEqual(toBailongmaHotspots(golden.hotspotSource), golden.hotspotNative);
  assert.doesNotMatch(JSON.stringify(golden), /api[_-]?key|password|authorization|cookie/i);
});
