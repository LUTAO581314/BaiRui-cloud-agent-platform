import process from "node:process";

async function check(name, url, options = {}) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5_000) });
    return { name, status: response.ok ? "passed" : "failed", httpStatus: response.status };
  } catch (error) {
    return { name, status: "failed", error: error.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}

const platformUrl = String(process.env.BAIRUI_PLATFORM_URL ?? "").replace(/\/$/, "");
const runtimeUrl = String(process.env.BAIRUI_RUNTIME_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const hermesUrl = String(process.env.HERMES_API_URL ?? "http://127.0.0.1:8642").replace(/\/$/, "");
if (!platformUrl) throw new Error("BAIRUI_PLATFORM_URL is required");

const checks = await Promise.all([
  check("platform", `${platformUrl}/ready`),
  check("runtime-boundary", `${runtimeUrl}/health`),
  check("hermes", `${hermesUrl}/v1/health`, { headers: process.env.HERMES_API_SERVER_KEY ? { authorization: `Bearer ${process.env.HERMES_API_SERVER_KEY}` } : {} })
]);
const report = { schemaVersion: "1.0", timestamp: new Date().toISOString(), status: checks.every((item) => item.status === "passed") ? "passed" : "failed", checks };
console.log(JSON.stringify(report, null, 2));
if (report.status === "failed") process.exitCode = 1;
