import { createHash, timingSafeEqual } from "node:crypto";

export const MAX_BODY_BYTES = 256 * 1024;

export function json(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

export function html(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

export function redirect(response, location) {
  response.writeHead(303, { location });
  response.end();
}

export async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  return (await readSignedJson(request, maxBytes)).body;
}

export async function readSignedJson(request, maxBytes = MAX_BODY_BYTES) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return { raw: "", body: {} };
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return { raw, body: JSON.parse(raw) };
  } catch {
    const error = new Error("Invalid JSON");
    error.statusCode = 400;
    throw error;
  }
}

export function sameOrigin(request, configuredOrigin) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const expected = configuredOrigin ?? String(request.headers["x-forwarded-proto"] ?? "http") + "://" + request.headers.host;
  return origin === expected;
}

export function constantTokenMatch(actual, expected) {
  if (!actual || !expected) return false;
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

export function securityHeaders(response) {
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("cache-control", "no-store");
}
