import crypto from "node:crypto";

let warnedFallback = false;

function derivedFallbackSecret() {
  const raw = process.env.TRUST_API_KEYS || "agent-trust-registry-local-fallback-key";
  return crypto.createHash("sha256").update(raw).digest();
}

function encryptionKey() {
  const raw = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("DATA_ENCRYPTION_KEY is required in production.");
    }
    if (!warnedFallback) {
      warnedFallback = true;
      // eslint-disable-next-line no-console
      console.warn("DATA_ENCRYPTION_KEY not set; using derived fallback key. Configure DATA_ENCRYPTION_KEY in production.");
    }
    return derivedFallbackSecret();
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plainText) {
  const iv = crypto.randomBytes(12);
  const key = encryptionKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(value) {
  const raw = String(value ?? "");
  if (!raw.startsWith("enc:v1:")) {
    return raw;
  }

  const [, , ivB64, tagB64, payloadB64] = raw.split(":");
  if (!ivB64 || !tagB64 || !payloadB64) {
    throw new Error("Invalid encrypted secret format.");
  }

  const key = encryptionKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(payloadB64, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}
