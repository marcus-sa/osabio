/**
 * Unit tests for device-auth.ts — challenge generation, device fingerprint, Ed25519 verification.
 *
 * Pure functions tested with properties and examples.
 */
import { describe, expect, it } from "bun:test";
import {
  generateChallenge,
  computeDeviceFingerprint,
  verifyEd25519Signature,
} from "../../../app/src/server/gateway/device-auth";

describe("generateChallenge", () => {
  it("returns a non-empty base64url nonce and a recent timestamp", () => {
    const before = Date.now();
    const challenge = generateChallenge();
    const after = Date.now();

    expect(typeof challenge.nonce).toBe("string");
    expect(challenge.nonce.length).toBeGreaterThan(0);
    // 32 bytes base64-encoded = 44 characters (with padding) or 43 (base64url no padding)
    // base64 of 32 bytes = ceil(32/3)*4 = 44 chars
    expect(challenge.nonce.length).toBeGreaterThanOrEqual(32);

    expect(challenge.ts).toBeGreaterThanOrEqual(before);
    expect(challenge.ts).toBeLessThanOrEqual(after);
  });

  it("generates unique nonces on successive calls", () => {
    const challenges = Array.from({ length: 10 }, () => generateChallenge());
    const nonces = new Set(challenges.map((c) => c.nonce));
    expect(nonces.size).toBe(10);
  });
});

describe("computeDeviceFingerprint", () => {
  it("returns a hex-encoded SHA-256 hash of the public key bytes", async () => {
    // Generate a real Ed25519 key pair for testing
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]);
    const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const publicKeyBase64 = Buffer.from(publicKeyRaw).toString("base64");

    const fingerprint = await computeDeviceFingerprint(publicKeyBase64);

    // SHA-256 hex = 64 characters
    expect(typeof fingerprint).toBe("string");
    expect(fingerprint.length).toBe(64);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces identical fingerprint for identical public key", async () => {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]);
    const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const publicKeyBase64 = Buffer.from(publicKeyRaw).toString("base64");

    const fp1 = await computeDeviceFingerprint(publicKeyBase64);
    const fp2 = await computeDeviceFingerprint(publicKeyBase64);

    expect(fp1).toBe(fp2);
  });

  it("produces different fingerprints for different keys", async () => {
    const kp1 = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const kp2 = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);

    const raw1 = await crypto.subtle.exportKey("raw", kp1.publicKey);
    const raw2 = await crypto.subtle.exportKey("raw", kp2.publicKey);

    const fp1 = await computeDeviceFingerprint(Buffer.from(raw1).toString("base64"));
    const fp2 = await computeDeviceFingerprint(Buffer.from(raw2).toString("base64"));

    expect(fp1).not.toBe(fp2);
  });
});

describe("verifyEd25519Signature", () => {
  it("returns true for a valid signature", async () => {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]);
    const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const publicKeyBase64 = Buffer.from(publicKeyRaw).toString("base64");

    const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    const nonceBytes = Buffer.from(nonce, "base64");
    const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, nonceBytes);
    const signatureBase64 = Buffer.from(signature).toString("base64");

    const result = await verifyEd25519Signature(publicKeyBase64, nonce, signatureBase64);
    expect(result).toBe(true);
  });

  it("returns false for a tampered signature", async () => {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]);
    const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const publicKeyBase64 = Buffer.from(publicKeyRaw).toString("base64");

    const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    const nonceBytes = Buffer.from(nonce, "base64");
    const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, nonceBytes);

    // Tamper with signature
    const tampered = new Uint8Array(signature);
    tampered[0] ^= 0xff;
    const tamperedBase64 = Buffer.from(tampered).toString("base64");

    const result = await verifyEd25519Signature(publicKeyBase64, nonce, tamperedBase64);
    expect(result).toBe(false);
  });

  it("returns false when signed with a different key", async () => {
    const kp1 = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const kp2 = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);

    const publicKeyRaw = await crypto.subtle.exportKey("raw", kp1.publicKey);
    const publicKeyBase64 = Buffer.from(publicKeyRaw).toString("base64");

    const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    const nonceBytes = Buffer.from(nonce, "base64");
    // Sign with kp2's private key
    const signature = await crypto.subtle.sign("Ed25519", kp2.privateKey, nonceBytes);
    const signatureBase64 = Buffer.from(signature).toString("base64");

    const result = await verifyEd25519Signature(publicKeyBase64, nonce, signatureBase64);
    expect(result).toBe(false);
  });
});
