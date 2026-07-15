import { randomUUID, sign, verify } from "node:crypto";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function issueLicense(input, privateKey) {
  if (!privateKey) throw new TypeError("License private key is required");
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const payload = {
    schemaVersion: "1.0",
    licenseId: input.licenseId ?? randomUUID(),
    organizationId: input.organizationId,
    plan: input.plan,
    features: [...new Set(input.features ?? [])].sort(),
    limits: input.limits ?? {},
    issuedAt,
    expiresAt: input.expiresAt,
    issuer: "bairui"
  };
  if (!payload.organizationId || !payload.plan || !payload.expiresAt) throw new TypeError("organizationId, plan, and expiresAt are required");
  const signature = sign(null, Buffer.from(canonical(payload)), privateKey).toString("base64url");
  return { payload, signature, algorithm: "Ed25519" };
}

export function verifyLicense(document, publicKey, now = Date.now()) {
  if (!document?.payload || !document.signature || document.algorithm !== "Ed25519") return { valid: false, reason: "invalid_document" };
  const authentic = verify(null, Buffer.from(canonical(document.payload)), publicKey, Buffer.from(document.signature, "base64url"));
  if (!authentic) return { valid: false, reason: "invalid_signature" };
  if (Date.parse(document.payload.expiresAt) <= now) return { valid: false, reason: "expired" };
  return { valid: true, payload: document.payload };
}
