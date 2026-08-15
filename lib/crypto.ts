import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM helpers for secrets at rest — currently the user's own Anthropic
 * API key in `profiles.anthropic_key_encrypted`.
 *
 * Payload format: `v1.<base64(iv | authTag | ciphertext)>`, iv 12 bytes,
 * auth tag 16 bytes. Server-only: importing this from a client component will
 * fail the build because of `node:crypto`.
 *
 * APP_ENCRYPTION_KEY must be 32 bytes, given as 64 hex chars or base64.
 * Generate one with: openssl rand -hex 32
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const VERSION = "v1";

export class EncryptionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionConfigError";
  }
}

function parseKeyMaterial(raw: string): Buffer | null {
  const value = raw.trim();
  if (value.length === 0) return null;

  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }

  const decoded = Buffer.from(value, "base64");
  return decoded.length === KEY_BYTES ? decoded : null;
}

function getEncryptionKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new EncryptionConfigError(
      "APP_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and add it to .env.local.",
    );
  }

  const key = parseKeyMaterial(raw);
  if (!key) {
    throw new EncryptionConfigError(
      "APP_ENCRYPTION_KEY must be 32 bytes — 64 hex characters or base64 of 32 bytes.",
    );
  }

  return key;
}

export function isEncryptionConfigured(): boolean {
  const raw = process.env.APP_ENCRYPTION_KEY;
  return typeof raw === "string" && parseKeyMaterial(raw) !== null;
}

/** Encrypts a secret into the storable `v1.<base64>` payload. */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${VERSION}.${Buffer.concat([iv, authTag, ciphertext]).toString("base64")}`;
}

/** Reverses `encryptSecret`. Throws if the payload is malformed or tampered with. */
export function decryptSecret(payload: string): string {
  const key = getEncryptionKey();

  const separator = payload.indexOf(".");
  const version = separator === -1 ? "" : payload.slice(0, separator);
  if (version !== VERSION) {
    throw new EncryptionConfigError(`Unsupported encrypted payload version: ${version || "none"}.`);
  }

  const bytes = Buffer.from(payload.slice(separator + 1), "base64");
  if (bytes.length <= IV_BYTES + TAG_BYTES) {
    throw new EncryptionConfigError("Encrypted payload is truncated.");
  }

  const iv = bytes.subarray(0, IV_BYTES);
  const authTag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = bytes.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** `sk-ant-…9f2a` — safe to render in the settings form. */
export function maskSecret(secret: string): string {
  const value = secret.trim();
  if (value.length <= 12) return "•".repeat(Math.max(value.length, 4));
  return `${value.slice(0, 7)}…${value.slice(-4)}`;
}
