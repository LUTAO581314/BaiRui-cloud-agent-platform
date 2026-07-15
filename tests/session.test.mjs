import test from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, verifySessionToken, sessionCookie } from "../packages/auth/session.mjs";

const secret = "test-session-secret-that-is-longer-than-32-characters";

test("signed sessions preserve identity and reject tampering", () => {
  const token = createSessionToken({ userId: "user_a", organizationId: "org_a", role: "user" }, secret, { ttlSeconds: 60 });
  assert.equal(verifySessionToken(token, secret).userId, "user_a");
  assert.equal(verifySessionToken(`${token}x`, secret), null);
});

test("expired sessions are rejected", () => {
  const token = createSessionToken({ userId: "user_a", organizationId: "org_a", role: "user" }, secret, { ttlSeconds: 1 });
  assert.equal(verifySessionToken(token, secret, Math.floor(Date.now() / 1000) + 2), null);
});

test("session cookies use browser security attributes", () => {
  const cookie = sessionCookie("token");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
});
