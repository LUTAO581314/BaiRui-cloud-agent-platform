import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function derivedKey(masterKey) {
  if (typeof masterKey !== "string" || masterKey.length < 32) throw new TypeError("Provider encryption key must contain at least 32 characters");
  return createHash("sha256").update(masterKey, "utf8").digest();
}

export class SecretEnvelope {
  constructor(masterKey) { this.key = derivedKey(masterKey); }

  seal(value) {
    if (typeof value !== "string" || !value) throw new TypeError("Secret value is required");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return { version: 1, algorithm: "aes-256-gcm", iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
  }

  open(envelope) {
    if (envelope?.version !== 1 || envelope?.algorithm !== "aes-256-gcm") throw new TypeError("Unsupported secret envelope");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(envelope.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]).toString("utf8");
  }
}

export function secretHint(value) {
  const text = String(value ?? "");
  return text.length >= 4 ? text.slice(-4) : "set";
}
