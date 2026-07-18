import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveMachineKey } from "./machine-request.mjs";

const MAX_SIGNATURE_AGE_MS = 5 * 60_000;

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalValue(value[key])]));
}

function keyBuffer(options) {
  const keyHash = options.keyHash ?? (options.token ? deriveMachineKey(options.token) : null);
  if (typeof keyHash !== "string" || !/^[a-f0-9]{64}$/.test(keyHash)) throw new TypeError("A derived control mutation key is required");
  return Buffer.from(keyHash, "hex");
}

export function controlMutationCanonical(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Control mutation must be an object");
  const signature = value.signature;
  if (!signature || typeof signature !== "object" || Array.isArray(signature)) throw new TypeError("Control mutation signature metadata is required");
  const unsigned = {
    ...value,
    signature: {
      algorithm: signature.algorithm,
      key_id: signature.key_id,
      signed_at: signature.signed_at
    }
  };
  return JSON.stringify(canonicalValue(unsigned));
}

export function signControlMutation(value, options) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Control mutation must be an object");
  if (typeof options?.keyId !== "string" || !options.keyId) throw new TypeError("Control mutation key id is required");
  const signedAt = options.signedAt ?? new Date(options.now ?? Date.now()).toISOString();
  const envelope = {
    ...value,
    signature: {
      algorithm: "hmac-sha256",
      key_id: options.keyId,
      signed_at: signedAt,
      value: "pending-control-signature"
    }
  };
  const signature = createHmac("sha256", keyBuffer(options)).update(controlMutationCanonical(envelope)).digest("base64url");
  return { ...envelope, signature: { ...envelope.signature, value: signature } };
}

export function verifyControlMutationSignature(value, options) {
  const signature = value?.signature;
  if (signature?.algorithm !== "hmac-sha256" || typeof signature.value !== "string") return false;
  if (options?.expectedKeyId && signature.key_id !== options.expectedKeyId) return false;
  const signedAt = Date.parse(signature.signed_at);
  const createdAt = Date.parse(value.created_at);
  const now = Number(options?.now ?? Date.now());
  const maxAgeMs = Number(options?.maxAgeMs ?? MAX_SIGNATURE_AGE_MS);
  if (!Number.isFinite(signedAt) || !Number.isFinite(createdAt) || signedAt < createdAt || Math.abs(now - signedAt) > maxAgeMs) return false;
  let actual;
  try { actual = Buffer.from(signature.value, "base64url"); } catch { return false; }
  const expected = createHmac("sha256", keyBuffer(options)).update(controlMutationCanonical(value)).digest();
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
