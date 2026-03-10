/**
 * Unit tests for DPoP pure functions.
 *
 * Tests:
 * - ES256 key pair generation
 * - JWK thumbprint computation (RFC 7638)
 * - DPoP proof validation (structure, signature, claims, clock skew)
 *
 * Acceptance criteria traced: M1-K1, M1-K2, M1-K3, M1-K4
 */
import { describe, expect, it } from "bun:test";
import * as jose from "jose";
import {
  generateKeyPair,
  computeJwkThumbprint,
  validateDPoPProof,
} from "../../../app/src/server/oauth/dpop";

// ---------------------------------------------------------------------------
// Helpers -- create signed DPoP proofs for testing validation
// ---------------------------------------------------------------------------

async function createSignedProof(
  keyPair: Awaited<ReturnType<typeof generateKeyPair>>,
  overrides?: {
    typ?: string;
    alg?: string;
    htm?: string;
    htu?: string;
    iat?: number;
    jti?: string;
    omitJwk?: boolean;
  },
): Promise<string> {
  const header: Record<string, unknown> = {
    typ: overrides?.typ ?? "dpop+jwt",
    alg: overrides?.alg ?? "ES256",
  };

  if (!overrides?.omitJwk) {
    header.jwk = {
      kty: keyPair.publicJwk.kty,
      crv: keyPair.publicJwk.crv,
      x: keyPair.publicJwk.x,
      y: keyPair.publicJwk.y,
    };
  }

  const payload = {
    jti: overrides?.jti ?? crypto.randomUUID(),
    htm: overrides?.htm ?? "POST",
    htu: overrides?.htu ?? "https://brain.example.com/api/auth/token",
    iat: overrides?.iat ?? Math.floor(Date.now() / 1000),
  };

  const importedKey = await jose.importJWK(
    await crypto.subtle.exportKey("jwk", keyPair.privateKey),
    "ES256",
  );

  return await new jose.SignJWT(payload)
    .setProtectedHeader(header as jose.JWTHeaderParameters)
    .sign(importedKey);
}

// ===========================================================================
// M1-K1: ES256 key pair generation
// ===========================================================================

describe("generateKeyPair", () => {
  it("generates an ES256 key pair with EC P-256 public JWK", async () => {
    const keyPair = await generateKeyPair();

    expect(keyPair.publicJwk.kty).toBe("EC");
    expect(keyPair.publicJwk.crv).toBe("P-256");
    expect(keyPair.publicJwk.x).toBeTruthy();
    expect(keyPair.publicJwk.y).toBeTruthy();
    // Private key components should not leak into public JWK
    expect(keyPair.publicJwk.d).toBeUndefined();
  });

  it("includes a pre-computed thumbprint", async () => {
    const keyPair = await generateKeyPair();

    expect(keyPair.thumbprint).toBeTruthy();
    expect(keyPair.thumbprint.length).toBeGreaterThan(20);
  });

  it("produces keys usable for signing and verification", async () => {
    const keyPair = await generateKeyPair();

    // Sign some data
    const data = new TextEncoder().encode("test-payload");
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.privateKey,
      data,
    );

    // Verify with public key
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.publicKey,
      signature,
      data,
    );
    expect(valid).toBe(true);
  });
});

// ===========================================================================
// M1-K2: JWK thumbprint (RFC 7638)
// ===========================================================================

describe("computeJwkThumbprint", () => {
  it("is deterministic for the same key", async () => {
    const keyPair = await generateKeyPair();

    const thumbprint1 = await computeJwkThumbprint(keyPair.publicJwk);
    const thumbprint2 = await computeJwkThumbprint(keyPair.publicJwk);

    expect(thumbprint1).toBe(thumbprint2);
  });

  it("matches the pre-computed thumbprint from generateKeyPair", async () => {
    const keyPair = await generateKeyPair();

    const computed = await computeJwkThumbprint(keyPair.publicJwk);

    expect(computed).toBe(keyPair.thumbprint);
  });

  it("produces different thumbprints for different keys", async () => {
    const keyPair1 = await generateKeyPair();
    const keyPair2 = await generateKeyPair();

    expect(keyPair1.thumbprint).not.toBe(keyPair2.thumbprint);
  });

  it("matches thumbprint computed by the acceptance test kit algorithm", async () => {
    // Reproduce the test kit's base64url(SHA-256(JSON({crv,kty,x,y}))) algorithm
    const keyPair = await generateKeyPair();

    const thumbprintInput = JSON.stringify({
      crv: keyPair.publicJwk.crv,
      kty: keyPair.publicJwk.kty,
      x: keyPair.publicJwk.x,
      y: keyPair.publicJwk.y,
    });

    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(thumbprintInput),
    );

    const bytes = new Uint8Array(hashBuffer);
    const binary = String.fromCharCode(...bytes);
    const expected = btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    expect(keyPair.thumbprint).toBe(expected);
  });
});

// ===========================================================================
// M1-K3: DPoP proof structure validation
// ===========================================================================

describe("validateDPoPProof structure checks", () => {
  it("accepts a well-formed DPoP proof", async () => {
    const keyPair = await generateKeyPair();
    const proof = await createSignedProof(keyPair);

    const result = await validateDPoPProof(
      proof,
      "POST",
      "https://brain.example.com/api/auth/token",
    );

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.thumbprint).toBe(keyPair.thumbprint);
      expect(result.claims.htm).toBe("POST");
      expect(result.claims.htu).toBe(
        "https://brain.example.com/api/auth/token",
      );
    }
  });

  it("rejects proof with wrong typ header", async () => {
    const keyPair = await generateKeyPair();
    const proof = await createSignedProof(keyPair, { typ: "JWT" });

    const result = await validateDPoPProof(
      proof,
      "POST",
      "https://brain.example.com/api/auth/token",
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("dpop_invalid_structure");
    }
  });

  it("rejects proof with missing jwk in header", async () => {
    const keyPair = await generateKeyPair();
    const proof = await createSignedProof(keyPair, { omitJwk: true });

    const result = await validateDPoPProof(
      proof,
      "POST",
      "https://brain.example.com/api/auth/token",
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("dpop_invalid_structure");
    }
  });

  it("rejects proof with mismatched HTTP method", async () => {
    const keyPair = await generateKeyPair();
    const proof = await createSignedProof(keyPair, { htm: "GET" });

    const result = await validateDPoPProof(
      proof,
      "POST",
      "https://brain.example.com/api/auth/token",
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("dpop_invalid_structure");
    }
  });

  it("rejects proof with mismatched target URI", async () => {
    const keyPair = await generateKeyPair();
    const proof = await createSignedProof(keyPair, {
      htu: "https://evil.example.com/steal",
    });

    const result = await validateDPoPProof(
      proof,
      "POST",
      "https://brain.example.com/api/auth/token",
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("dpop_invalid_structure");
    }
  });

  it("rejects non-JWT garbage input", async () => {
    const result = await validateDPoPProof(
      "not-a-jwt",
      "POST",
      "https://brain.example.com/api/auth/token",
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("dpop_invalid_structure");
    }
  });
});

// ===========================================================================
// M1-K3: DPoP signature verification
// ===========================================================================

describe("validateDPoPProof signature verification", () => {
  it("rejects proof signed with a different key", async () => {
    const signingKeyPair = await generateKeyPair();
    const differentKeyPair = await generateKeyPair();

    // Create proof with signing key's private key but different key's public JWK in header
    const header = {
      typ: "dpop+jwt" as const,
      alg: "ES256" as const,
      jwk: {
        kty: differentKeyPair.publicJwk.kty,
        crv: differentKeyPair.publicJwk.crv,
        x: differentKeyPair.publicJwk.x,
        y: differentKeyPair.publicJwk.y,
      },
    };

    const payload = {
      jti: crypto.randomUUID(),
      htm: "POST",
      htu: "https://brain.example.com/api/auth/token",
      iat: Math.floor(Date.now() / 1000),
    };

    const importedKey = await jose.importJWK(
      await crypto.subtle.exportKey("jwk", signingKeyPair.privateKey),
      "ES256",
    );

    const proof = await new jose.SignJWT(payload)
      .setProtectedHeader(header)
      .sign(importedKey);

    const result = await validateDPoPProof(
      proof,
      "POST",
      "https://brain.example.com/api/auth/token",
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("dpop_invalid_signature");
    }
  });
});

// ===========================================================================
// M1-K4: Clock skew tolerance
// ===========================================================================

describe("validateDPoPProof clock skew", () => {
  it("accepts proof within default 60s past tolerance", async () => {
    const keyPair = await generateKeyPair();
    const fiftySecondsAgo = Math.floor(Date.now() / 1000) - 50;
    const proof = await createSignedProof(keyPair, { iat: fiftySecondsAgo });

    const result = await validateDPoPProof(
      proof,
      "POST",
      "https://brain.example.com/api/auth/token",
    );

    expect(result.valid).toBe(true);
  });

  it("rejects proof older than 60s past tolerance", async () => {
    const keyPair = await generateKeyPair();
    const twoMinutesAgo = Math.floor(Date.now() / 1000) - 120;
    const proof = await createSignedProof(keyPair, { iat: twoMinutesAgo });

    const result = await validateDPoPProof(
      proof,
      "POST",
      "https://brain.example.com/api/auth/token",
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("dpop_proof_expired");
    }
  });

  it("accepts proof within default 5s future tolerance", async () => {
    const keyPair = await generateKeyPair();
    const threeSecondsAhead = Math.floor(Date.now() / 1000) + 3;
    const proof = await createSignedProof(keyPair, {
      iat: threeSecondsAhead,
    });

    const result = await validateDPoPProof(
      proof,
      "POST",
      "https://brain.example.com/api/auth/token",
    );

    expect(result.valid).toBe(true);
  });

  it("rejects proof too far in the future", async () => {
    const keyPair = await generateKeyPair();
    const tenSecondsAhead = Math.floor(Date.now() / 1000) + 10;
    const proof = await createSignedProof(keyPair, {
      iat: tenSecondsAhead,
    });

    const result = await validateDPoPProof(
      proof,
      "POST",
      "https://brain.example.com/api/auth/token",
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("dpop_proof_expired");
    }
  });

  it("respects custom clock skew configuration", async () => {
    const keyPair = await generateKeyPair();
    const ninetySecondsAgo = Math.floor(Date.now() / 1000) - 90;
    const proof = await createSignedProof(keyPair, { iat: ninetySecondsAgo });

    // With extended past tolerance of 120s, this should pass
    const result = await validateDPoPProof(
      proof,
      "POST",
      "https://brain.example.com/api/auth/token",
      { pastSeconds: 120, futureSeconds: 5 },
    );

    expect(result.valid).toBe(true);
  });
});
