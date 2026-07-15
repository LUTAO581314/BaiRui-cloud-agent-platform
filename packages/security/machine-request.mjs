import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export function deriveMachineKey(token) {
  if (typeof token !== "string" || token.length < 32) throw new TypeError("Machine token must contain at least 32 characters");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function machineCanonical({ method, path, timestamp, nonce, body = "" }) {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return `${String(method).toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

export function signMachineRequest({ method, path, timestamp, nonce, body = "", token }) {
  const key = Buffer.from(deriveMachineKey(token), "hex");
  return createHmac("sha256", key).update(machineCanonical({ method, path, timestamp, nonce, body })).digest("base64url");
}

export function verifyMachineRequest({ method, path, timestamp, nonce, body = "", signature, keyHash, now = Date.now(), maxClockSkewMs = MAX_CLOCK_SKEW_MS }) {
  const timestampMs = Number(timestamp);
  if (!Number.isSafeInteger(timestampMs) || Math.abs(now - timestampMs) > maxClockSkewMs) return false;
  if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return false;
  if (typeof signature !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(signature)) return false;
  if (typeof keyHash !== "string" || !/^[0-9a-f]{64}$/.test(keyHash)) return false;
  const expected = createHmac("sha256", Buffer.from(keyHash, "hex")).update(machineCanonical({ method, path, timestamp, nonce, body })).digest();
  let actual;
  try { actual = Buffer.from(signature, "base64url"); } catch { return false; }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
