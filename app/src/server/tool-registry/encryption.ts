/**
 * AES-256-GCM encryption adapter for credential secrets.
 *
 * Each encrypted value = base64(IV || ciphertext || authTag).
 * 12-byte random IV per encryption. 16-byte auth tag.
 * Key must be a 256-bit (32-byte) hex string.
 *
 * Pure functions with no side effects beyond crypto randomness.
 * ADR-066, ADR-068.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns base64-encoded string containing IV + ciphertext + authTag.
 */
export function encryptSecret(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("Encryption key must be 256 bits (64 hex characters)");
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Pack: IV || ciphertext || authTag
  const packed = Buffer.concat([iv, encrypted, authTag]);
  return packed.toString("base64");
}

/**
 * Decrypt a base64-encoded AES-256-GCM ciphertext.
 * Input format: base64(IV || ciphertext || authTag).
 */
export function decryptSecret(ciphertextBase64: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("Encryption key must be 256 bits (64 hex characters)");
  }

  const packed = Buffer.from(ciphertextBase64, "base64");

  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Ciphertext too short to contain IV and auth tag");
  }

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(packed.length - AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH, packed.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
