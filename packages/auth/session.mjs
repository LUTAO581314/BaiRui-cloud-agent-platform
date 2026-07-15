import { createHmac, timingSafeEqual } from "node:crypto";
import { isRole } from "./authorization.mjs";

export const SESSION_COOKIE = "br_session";

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSessionToken(principal, secret, options = {}) {
  if (!secret || secret.length < 32) throw new TypeError("Session secret must contain at least 32 characters");
  if (!principal?.userId || !principal.organizationId || !isRole(principal.role)) throw new TypeError("Invalid principal");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    sub: principal.userId,
    org: principal.organizationId,
    role: principal.role,
    iat: now,
    exp: now + (options.ttlSeconds ?? 8 * 60 * 60)
  })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token, secret, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== "string" || !secret) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (parsed.v !== 1 || !parsed.sub || !parsed.org || !isRole(parsed.role) || parsed.exp <= now) return null;
    return { userId: parsed.sub, organizationId: parsed.org, role: parsed.role, issuedAt: parsed.iat, expiresAt: parsed.exp };
  } catch {
    return null;
  }
}

export function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((item) => item.trim()).filter(Boolean).map((item) => {
    const index = item.indexOf("=");
    return index < 0 ? [item, ""] : [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
  }));
}

export function sessionCookie(token, options = {}) {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${options.maxAge ?? 8 * 60 * 60}`
  ];
  if (options.secure !== false) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearSessionCookie(options = {}) {
  return sessionCookie("", { ...options, maxAge: 0 });
}
