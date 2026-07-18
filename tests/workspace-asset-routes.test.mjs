import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceAssetRoutes } from "../apps/web/routes/workspace-assets.mjs";

const SCRIPT_NAME = "bairui-workspace-skills.js";
const SCRIPT_PATH = `/assets/${SCRIPT_NAME}`;
const SCRIPT = "window.bairuiWorkspaceSkills = true;";

function responseFake() {
  return {
    statusCode: undefined,
    headers: undefined,
    body: undefined,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    }
  };
}

function urlFor(pathname) {
  return new URL(pathname, "http://platform.internal");
}

test("workspace asset routes decline unrelated, arbitrary, and traversal paths", async () => {
  const authenticatedRequests = [];
  const route = createWorkspaceAssetRoutes({
    scripts: {
      [SCRIPT_NAME]: SCRIPT,
      "user.js": "must-not-be-served"
    },
    authenticate: async (request) => {
      authenticatedRequests.push(request);
      return true;
    }
  });

  for (const pathname of [
    "/app",
    "/assets/user.js",
    "/assets/../bairui-workspace-skills.js",
    "/assets/%2e%2e/bairui-workspace-skills.js",
    "/assets/bairui-workspace-skills.js/extra",
    "/assets/bairui-workspace-skills.js%2f..%2fuser.js"
  ]) {
    const response = responseFake();
    assert.equal(await route({ method: "GET", url: urlFor(pathname), request: {}, response }), false, pathname);
    assert.equal(response.statusCode, undefined, pathname);
  }

  const response = responseFake();
  assert.equal(await route({ method: "POST", url: urlFor(SCRIPT_PATH), request: {}, response }), false);
  assert.equal(authenticatedRequests.length, 0);
});

test("a missing allowlisted workspace script returns 404 before authentication", async () => {
  let authenticationCalls = 0;
  const route = createWorkspaceAssetRoutes({
    scripts: { "bairui-workspace.js": "another-script" },
    authenticate: async () => {
      authenticationCalls += 1;
      return true;
    }
  });
  const response = responseFake();

  assert.equal(await route({ method: "GET", url: urlFor(SCRIPT_PATH), request: {}, response }), true);
  assert.equal(response.statusCode, 404);
  assert.deepEqual(JSON.parse(response.body), { error: "not_found" });
  assert.equal(authenticationCalls, 0);
});

test("an existing workspace script returns 401 when injected authentication fails", async () => {
  const request = { headers: { cookie: "missing-or-invalid-session" } };
  let authenticatedRequest;
  const route = createWorkspaceAssetRoutes({
    scripts: { [SCRIPT_NAME]: SCRIPT },
    authenticate: async (receivedRequest) => {
      authenticatedRequest = receivedRequest;
      return false;
    }
  });
  const response = responseFake();

  assert.equal(await route({ method: "GET", url: urlFor(SCRIPT_PATH), request, response }), true);
  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), { error: "authentication_required" });
  assert.equal(authenticatedRequest, request);
});

test("an authenticated allowlisted workspace script is private JavaScript", async () => {
  const request = { headers: { cookie: "valid-session" } };
  let authenticatedRequest;
  const route = createWorkspaceAssetRoutes({
    scripts: { [SCRIPT_NAME]: SCRIPT },
    authenticate: async (receivedRequest) => {
      authenticatedRequest = receivedRequest;
      return { userId: "user_a" };
    }
  });
  const response = responseFake();

  assert.equal(await route({ method: "GET", url: urlFor(SCRIPT_PATH), request, response }), true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/javascript; charset=utf-8");
  assert.equal(response.headers["cache-control"], "private, max-age=300");
  assert.equal(response.body, SCRIPT);
  assert.equal(authenticatedRequest, request);
});
