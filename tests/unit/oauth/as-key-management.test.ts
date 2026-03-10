/**
 * Unit tests for AS signing key management.
 *
 * Tests:
 * - ES256 key pair generation and JWK export
 * - JWKS response building (RFC 7517 JWK Set)
 * - Key bootstrap logic (generate-or-load)
 * - Key persistence round-trip via stubs
 *
 * Step: 02-01
 */
import { describe, expect, it } from "bun:test";
import * as jose from "jose";
import {
  generateAsSigningKey,
  buildJwksResponse,
  bootstrapSigningKey,
  loadActiveKey,
  type AsSigningKey,
  type AsSigningKeyRow,
} from "../../../app/src/server/oauth/as-key-management";

// ---------------------------------------------------------------------------
// Port stubs -- pure functions satisfying driven port signatures
// ---------------------------------------------------------------------------

function createKeyStoreSpy(): {
  saved: AsSigningKeyRow[];
  loadResult: AsSigningKeyRow | undefined;
  saveKey: (row: AsSigningKeyRow) => Promise<void>;
  loadActiveKey: () => Promise<AsSigningKeyRow | undefined>;
} {
  const saved: AsSigningKeyRow[] = [];
  return {
    saved,
    loadResult: undefined,
    saveKey: async (row: AsSigningKeyRow) => {
      saved.push(row);
    },
    loadActiveKey: async () => saved[0] ?? undefined,
  };
}

// ===========================================================================
// generateAsSigningKey: ES256 key generation with JWK export
// ===========================================================================

describe("generateAsSigningKey", () => {
  it("generates a valid ES256 key with kid, public JWK, and private JWK", async () => {
    const key = await generateAsSigningKey();

    expect(key.kid).toBeTruthy();
    expect(key.algorithm).toBe("ES256");
    expect(key.publicJwk.kty).toBe("EC");
    expect(key.publicJwk.crv).toBe("P-256");
    expect(key.publicJwk.x).toBeTruthy();
    expect(key.publicJwk.y).toBeTruthy();
    // No private key material in public JWK
    expect(key.publicJwk.d).toBeUndefined();
  });

  it("includes kid and alg in the public JWK for JWKS compatibility", async () => {
    const key = await generateAsSigningKey();

    expect(key.publicJwk.kid).toBe(key.kid);
    expect(key.publicJwk.alg).toBe("ES256");
    expect(key.publicJwk.use).toBe("sig");
  });

  it("provides a CryptoKey usable for signing JWTs", async () => {
    const key = await generateAsSigningKey();

    // Verify the privateKey can sign using jose
    const jwt = await new jose.SignJWT({ test: true })
      .setProtectedHeader({ alg: "ES256", kid: key.kid })
      .setIssuedAt()
      .sign(key.privateKey);

    expect(jwt).toBeTruthy();
    expect(jwt.split(".")).toHaveLength(3);

    // Verify with the public key
    const publicKey = await jose.importJWK(key.publicJwk, "ES256");
    const { payload } = await jose.jwtVerify(jwt, publicKey);
    expect(payload.test).toBe(true);
  });

  it("generates unique kids across invocations", async () => {
    const key1 = await generateAsSigningKey();
    const key2 = await generateAsSigningKey();

    expect(key1.kid).not.toBe(key2.kid);
  });
});

// ===========================================================================
// buildJwksResponse: RFC 7517 JWK Set format
// ===========================================================================

describe("buildJwksResponse", () => {
  it("wraps the public key in a JWK Set with keys array", async () => {
    const key = await generateAsSigningKey();
    const jwks = buildJwksResponse(key);

    expect(jwks.keys).toBeArrayOfSize(1);
    expect(jwks.keys[0].kty).toBe("EC");
    expect(jwks.keys[0].crv).toBe("P-256");
    expect(jwks.keys[0].kid).toBe(key.kid);
    expect(jwks.keys[0].alg).toBe("ES256");
    expect(jwks.keys[0].use).toBe("sig");
  });

  it("never includes private key material in the JWKS response", async () => {
    const key = await generateAsSigningKey();
    const jwks = buildJwksResponse(key);

    expect(jwks.keys[0].d).toBeUndefined();
  });

  it("produces a JWKS consumable by jose.createRemoteJWKSet equivalent", async () => {
    const key = await generateAsSigningKey();
    const jwks = buildJwksResponse(key);

    // Create a local JWKS from the response
    const jwkSet = jose.createLocalJWKSet(jwks);

    // Sign a JWT with the AS key
    const jwt = await new jose.SignJWT({ sub: "test" })
      .setProtectedHeader({ alg: "ES256", kid: key.kid })
      .sign(key.privateKey);

    // Verify using the JWKS -- this proves the JWKS format is correct
    const { payload } = await jose.jwtVerify(jwt, jwkSet);
    expect(payload.sub).toBe("test");
  });
});

// ===========================================================================
// bootstrapSigningKey: load-or-generate with persistence
// ===========================================================================

describe("bootstrapSigningKey", () => {
  it("generates and persists a new key when none exists", async () => {
    const store = createKeyStoreSpy();

    const key = await bootstrapSigningKey(store.saveKey, store.loadActiveKey);

    expect(key.kid).toBeTruthy();
    expect(key.algorithm).toBe("ES256");
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0].kid).toBe(key.kid);
    expect(store.saved[0].status).toBe("active");
  });

  it("loads existing key from store without generating new one", async () => {
    const store = createKeyStoreSpy();

    // First bootstrap generates
    const original = await bootstrapSigningKey(store.saveKey, store.loadActiveKey);

    // Second bootstrap loads (store already has the key)
    const loaded = await bootstrapSigningKey(store.saveKey, store.loadActiveKey);

    expect(loaded.kid).toBe(original.kid);
    // Only one key was saved (from first bootstrap)
    expect(store.saved).toHaveLength(1);
  });

  it("round-trips key material through JWK serialization", async () => {
    const store = createKeyStoreSpy();

    const original = await bootstrapSigningKey(store.saveKey, store.loadActiveKey);

    // Sign with original key
    const jwt = await new jose.SignJWT({ test: "roundtrip" })
      .setProtectedHeader({ alg: "ES256", kid: original.kid })
      .sign(original.privateKey);

    // Load from store (simulates restart)
    const loaded = await bootstrapSigningKey(store.saveKey, store.loadActiveKey);

    // Verify JWT signed by original key using loaded key's public JWK
    const publicKey = await jose.importJWK(loaded.publicJwk, "ES256");
    const { payload } = await jose.jwtVerify(jwt, publicKey);
    expect(payload.test).toBe("roundtrip");
  });
});

// ===========================================================================
// loadActiveKey: reconstruct AsSigningKey from stored row
// ===========================================================================

describe("loadActiveKey (from row)", () => {
  it("reconstructs a usable CryptoKey from stored JWK material", async () => {
    const generated = await generateAsSigningKey();

    // Simulate what would be stored in DB
    const privateJwk = await crypto.subtle.exportKey("jwk", generated.privateKey);

    const row: AsSigningKeyRow = {
      kid: generated.kid,
      algorithm: "ES256",
      public_jwk: generated.publicJwk,
      private_jwk: privateJwk as JsonWebKey,
      status: "active",
      created_at: new Date().toISOString(),
    };

    const restored = await loadActiveKey(row);

    expect(restored.kid).toBe(generated.kid);
    expect(restored.algorithm).toBe("ES256");

    // Verify the restored private key can sign
    const jwt = await new jose.SignJWT({ restored: true })
      .setProtectedHeader({ alg: "ES256", kid: restored.kid })
      .sign(restored.privateKey);

    const publicKey = await jose.importJWK(restored.publicJwk, "ES256");
    const { payload } = await jose.jwtVerify(jwt, publicKey);
    expect(payload.restored).toBe(true);
  });
});
