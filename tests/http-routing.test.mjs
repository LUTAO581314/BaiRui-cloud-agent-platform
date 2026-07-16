import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  MAX_BODY_BYTES,
  constantTokenMatch,
  json,
  readJson,
  securityHeaders
} from "../apps/web/http.mjs";
import { createAdminControlRoutes } from "../apps/web/routes/admin-control.mjs";
import { createAuthRoutes } from "../apps/web/routes/auth.mjs";
import { createUserRuntimeRoutes } from "../apps/web/routes/user-runtime.mjs";

function requestBody(value) {
  const request = Readable.from([Buffer.from(value)]);
  request.headers = {};
  return request;
}

test("shared HTTP body parsing applies one bounded JSON policy", async () => {
  assert.deepEqual(await readJson(requestBody('{"ok":true}')), { ok: true });
  await assert.rejects(() => readJson(requestBody("{broken")), (error) => error.statusCode === 400);
  await assert.rejects(() => readJson(requestBody("x".repeat(MAX_BODY_BYTES + 1))), (error) => error.statusCode === 413);
});

test("shared HTTP responses and security headers remain deterministic", () => {
  const headers = new Map();
  const response = {
    setHeader(name, value) { headers.set(name, value); },
    writeHead(statusCode, values) { this.statusCode = statusCode; this.headers = values; },
    end(body) { this.body = body; }
  };
  securityHeaders(response);
  json(response, 202, { accepted: true }, { "x-test": "1" });
  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { accepted: true });
  assert.equal(response.headers["x-test"], "1");
  assert.match(headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(constantTokenMatch("token-a", "token-a"), true);
  assert.equal(constantTokenMatch("token-a", "token-b"), false);
});

test("route modules decline paths outside their owned domain", async () => {
  const context = { method: "GET", url: new URL("http://platform.internal/not-owned"), request: {}, response: {}, principal: null };
  const auth = createAuthRoutes({ repository: {}, sessionSecret: "x".repeat(32), secureCookies: false, allowRegistration: false, requireLogin() {} });
  const runtime = createUserRuntimeRoutes({});
  const control = createAdminControlRoutes({});
  assert.equal(await auth(context), false);
  assert.equal(await runtime(context), false);
  assert.equal(await control(context), false);
});
