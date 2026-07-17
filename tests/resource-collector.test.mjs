import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectAgentResourceSamples, parseDockerBytes } from "../server-agent/resource-collector.mjs";

test("resource collector reads only managed containers through fixed Docker arguments", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bairui-resources-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const instance = path.join(root, "managed-instance");
  fs.mkdirSync(path.join(instance, "hermes-data"), { recursive: true });
  fs.writeFileSync(path.join(instance, "hermes-data", "MEMORY.md"), "resource-test");
  fs.writeFileSync(path.join(instance, "instance.json"), JSON.stringify({ agentId: "agent_a", runtimeId: "runtime_a", deploymentId: "deployment_a", names: { hermes: "bairui-hermes-a", runtime: "bairui-runtime-a" } }));
  const calls = [];
  const execFile = async (file, args) => {
    calls.push({ file, args });
    if (args[0] === "info") return { stdout: JSON.stringify({ OSType: "linux", Architecture: "amd64", OperatingSystem: "Test Linux", ServerVersion: "27.1.0", NCPU: 8 }) };
    if (args[0] === "container" && args[1] === "ls") return { stdout: [
      JSON.stringify({ ID: "h".repeat(64), Names: "bairui-hermes-a", Image: "hermes:test", State: "running" }),
      JSON.stringify({ ID: "r".repeat(64), Names: "bairui-runtime-a", Image: "runtime:test", State: "running" }),
      JSON.stringify({ ID: "x".repeat(64), Names: "unmanaged-container", Image: "private:test", State: "running" })
    ].join("\n") };
    if (args[0] === "container" && args[1] === "inspect") return { stdout: JSON.stringify([
      { Id: "h".repeat(64), Name: "/bairui-hermes-a", SizeRw: 1024, State: { Status: "running", StartedAt: "2026-07-16T06:00:00.000Z" }, Config: { Image: "hermes:test", Labels: { "org.opencontainers.image.version": "1.2.3" } } },
      { Id: "r".repeat(64), Name: "/bairui-runtime-a", SizeRw: 2048, State: { Status: "running", StartedAt: "" }, Config: { Image: "runtime:test", Labels: {} } }
    ]) };
    if (args[0] === "stats") return { stdout: [
      JSON.stringify({ Name: "bairui-hermes-a", CPUPerc: "3.1%", MemUsage: "128MiB / 2GiB" }),
      JSON.stringify({ Name: "bairui-runtime-a", CPUPerc: "2.2%", MemUsage: "64MiB / 2GiB" })
    ].join("\n") };
    throw new Error(`Unexpected Docker call: ${args.join(" ")}`);
  };
  const samples = await collectAgentResourceSamples({
    instancesRoot: root,
    execFile,
    now: "2026-07-16T07:00:00.000Z",
    statfs: () => ({ bsize: 4096n, blocks: 1000n, bavail: 400n })
  });
  assert.equal(samples.length, 1);
  assert.equal(samples[0].status, "running");
  assert.equal(samples[0].cpuPercent, 5.3);
  assert.equal(samples[0].memoryUsedBytes, 192 * 1024 * 1024);
  assert.equal(samples[0].memoryLimitBytes, 2 * 1024 * 1024 * 1024);
  assert.equal(samples[0].hostStorageUsedBytes, 600 * 4096);
  assert.equal(samples[0].containers[0].role, "hermes");
  assert.equal(samples[0].containers[1].role, "runtime-boundary");
  assert.equal("version" in samples[0].containers[1], false);
  assert.equal("startedAt" in samples[0].containers[1], false);
  assert.equal(samples[0].startedAt, "2026-07-16T06:00:00.000Z");
  assert.ok(calls.every((call) => call.file === "docker"));
  assert.ok(calls.every((call) => !call.args.includes("unmanaged-container")));
  assert.doesNotMatch(JSON.stringify(samples), /private:test|MEMORY\.md|resource-test/);
});

test("Docker byte parser accepts structured stats units only", () => {
  assert.equal(parseDockerBytes("15.5MiB"), Math.round(15.5 * 1024 * 1024));
  assert.equal(parseDockerBytes("2 GB"), 2_000_000_000);
  assert.equal(parseDockerBytes("../../etc/passwd"), null);
});
