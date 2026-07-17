import { createHash } from "node:crypto";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

export function stableIdentifier(prefix, value) {
  const raw = String(value ?? "");
  if (IDENTIFIER.test(raw)) return raw;
  return `${prefix}:${createHash("sha256").update(raw).digest("hex")}`;
}

export function adapterErrorCode(error, fallback = "channel_adapter_failed") {
  return String(error?.code ?? fallback).replace(/[^A-Za-z0-9._:/-]/g, "_").slice(0, 200) || fallback;
}

export function retryAfterMs(response, fallback = 5_000) {
  const value = response?.headers?.get?.("retry-after");
  if (!value) return fallback;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, 86_400_000));
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Math.min(timestamp - Date.now(), 86_400_000)) : fallback;
}

export async function jsonResponse(response, limit = 256 * 1024) {
  const text = await response.text();
  if (Buffer.byteLength(text) > limit) throw Object.assign(new Error("Channel vendor response is too large"), { code: "vendor_response_too_large" });
  try { return text ? JSON.parse(text) : {}; }
  catch { throw Object.assign(new Error("Channel vendor returned invalid JSON"), { code: "invalid_vendor_response" }); }
}

export async function submitIngress(platform, payload, options = {}) {
  const attempts = Math.max(1, Math.min(Number(options.attempts) || 5, 10));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await platform.ingress(payload); }
    catch (error) {
      lastError = error;
      if (error?.retryable === false || (error?.statusCode && error.statusCode < 500 && error.statusCode !== 429) || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(4_000, 250 * (2 ** (attempt - 1)))));
    }
  }
  throw lastError;
}
