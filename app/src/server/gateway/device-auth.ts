/**
 * Device authentication — Ed25519 challenge/response, fingerprinting, and signature verification.
 *
 * Effect boundary: these functions use Web Crypto API (crypto.getRandomValues, crypto.subtle).
 * They are adapters, NOT part of the pure core. The pure state machine (connection.ts)
 * receives challenge data as values, never calls these functions directly.
 */
import type { PendingChallenge } from "./types";

// ---------------------------------------------------------------------------
// Challenge generation — random nonce + timestamp
// ---------------------------------------------------------------------------

/**
 * Generate a fresh challenge for the connect.challenge event.
 *
 * Returns 32 cryptographically random bytes as base64-encoded nonce
 * and the current timestamp in milliseconds.
 */
export function generateChallenge(): PendingChallenge {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const nonce = Buffer.from(bytes).toString("base64");
  const ts = Date.now();
  return { nonce, ts };
}

// ---------------------------------------------------------------------------
// Device fingerprint — SHA-256 of raw public key bytes, hex-encoded
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic device fingerprint from a base64-encoded Ed25519 public key.
 *
 * The fingerprint is the SHA-256 hash of the raw public key bytes, hex-encoded.
 */
export async function computeDeviceFingerprint(
  publicKeyBase64: string,
): Promise<string> {
  const publicKeyBytes = Buffer.from(publicKeyBase64, "base64");
  const hashBuffer = await crypto.subtle.digest("SHA-256", publicKeyBytes);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Ed25519 signature verification
// ---------------------------------------------------------------------------

/**
 * Verify an Ed25519 signature over a base64-encoded nonce.
 *
 * Returns true if the signature is valid for the given public key and nonce.
 * Returns false for any verification failure (invalid key, tampered signature, wrong key).
 */
export async function verifyEd25519Signature(
  publicKeyBase64: string,
  nonce: string,
  signatureBase64: string,
): Promise<boolean> {
  try {
    const publicKeyBytes = Buffer.from(publicKeyBase64, "base64");
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      "Ed25519",
      false,
      ["verify"],
    );

    const nonceBytes = Buffer.from(nonce, "base64");
    const signatureBytes = Buffer.from(signatureBase64, "base64");

    return await crypto.subtle.verify(
      "Ed25519",
      cryptoKey,
      signatureBytes,
      nonceBytes,
    );
  } catch {
    return false;
  }
}
