/**
 * AS Signing Key Management
 *
 * Generates, persists, and loads ES256 signing keys for the Authorization Server.
 * Exposes JWKS response building for the /.well-known/jwks endpoint.
 *
 * Pure functions + thin DB adapters. Domain logic has no IO imports.
 *
 * Step: 02-01
 */
import { RecordId, type Surreal } from "surrealdb";
import * as jose from "jose";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AsSigningKey = {
  kid: string;
  algorithm: "ES256";
  publicJwk: JsonWebKey & { kid: string; alg: string; use: string };
  privateKey: CryptoKey;
};

/** Row shape matching the as_signing_key SurrealDB table. */
export type AsSigningKeyRow = {
  kid: string;
  algorithm: "ES256";
  public_jwk: JsonWebKey;
  private_jwk: JsonWebKey;
  status: "active" | "rotated";
  created_at: string;
  rotated_at?: string;
};

// ---------------------------------------------------------------------------
// Port signatures (driven ports)
// ---------------------------------------------------------------------------

type SaveKey = (row: AsSigningKeyRow) => Promise<void>;
type LoadActiveKeyFromStore = () => Promise<AsSigningKeyRow | undefined>;

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/** Generate a new ES256 signing key with kid, exportable JWKs, and CryptoKey. */
export async function generateAsSigningKey(): Promise<AsSigningKey> {
  const kid = crypto.randomUUID();

  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );

  const rawPublicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  // Add JWKS metadata fields for RFC 7517 compliance
  const publicJwk = {
    ...rawPublicJwk,
    kid,
    alg: "ES256",
    use: "sig",
  } as AsSigningKey["publicJwk"];

  // Remove private key material from public JWK
  delete (publicJwk as Record<string, unknown>).d;

  return {
    kid,
    algorithm: "ES256",
    publicJwk,
    privateKey: keyPair.privateKey,
  };
}

/** Reconstruct an AsSigningKey from a stored DB row. */
export async function loadActiveKey(row: AsSigningKeyRow): Promise<AsSigningKey> {
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    row.private_jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const publicJwk = {
    ...row.public_jwk,
    kid: row.kid,
    alg: "ES256",
    use: "sig",
  } as AsSigningKey["publicJwk"];

  // Ensure no private material in public JWK
  delete (publicJwk as Record<string, unknown>).d;

  return {
    kid: row.kid,
    algorithm: "ES256",
    publicJwk,
    privateKey,
  };
}

/** Build RFC 7517 JWK Set response for the JWKS endpoint. */
export function buildJwksResponse(key: AsSigningKey): jose.JSONWebKeySet {
  const jwk = { ...key.publicJwk };
  // Defensive: strip private material
  delete (jwk as Record<string, unknown>).d;

  return {
    keys: [jwk as jose.JWK],
  };
}

/**
 * Bootstrap: load existing active key from store, or generate and persist a new one.
 * Dependency injection via function parameters (driven ports).
 */
export async function bootstrapSigningKey(
  saveKey: SaveKey,
  loadActiveKeyFromStore: LoadActiveKeyFromStore,
): Promise<AsSigningKey> {
  const existingRow = await loadActiveKeyFromStore();
  if (existingRow) {
    return loadActiveKey(existingRow);
  }

  const key = await generateAsSigningKey();

  const privateJwk = await crypto.subtle.exportKey("jwk", key.privateKey);

  const row: AsSigningKeyRow = {
    kid: key.kid,
    algorithm: "ES256",
    public_jwk: key.publicJwk,
    private_jwk: privateJwk as JsonWebKey,
    status: "active",
    created_at: new Date().toISOString(),
  };

  await saveKey(row);
  return key;
}

// ---------------------------------------------------------------------------
// SurrealDB adapters (driven port implementations)
// ---------------------------------------------------------------------------

/** Save a signing key row to the as_signing_key table. */
export async function saveSigningKeyToSurreal(
  surreal: Surreal,
  row: AsSigningKeyRow,
): Promise<void> {
  const record = new RecordId("as_signing_key", row.kid);
  await surreal.query(
    `CREATE $record CONTENT {
      kid: $kid,
      algorithm: $algorithm,
      public_jwk: $publicJwk,
      private_jwk: $privateJwk,
      status: $status,
      created_at: time::now()
    };`,
    {
      record,
      kid: row.kid,
      algorithm: row.algorithm,
      publicJwk: row.public_jwk,
      privateJwk: row.private_jwk,
      status: row.status,
    },
  );
}

/** Load the active signing key from SurrealDB. */
export async function loadActiveKeyFromSurreal(
  surreal: Surreal,
): Promise<AsSigningKeyRow | undefined> {
  const result = await surreal.query<[AsSigningKeyRow[]]>(
    `SELECT kid, algorithm, public_jwk, private_jwk, status, created_at
     FROM as_signing_key
     WHERE status = 'active'
     ORDER BY created_at DESC
     LIMIT 1;`,
  );

  const rows = result[0];
  if (!rows || rows.length === 0) return undefined;
  return rows[0];
}

/**
 * Bootstrap the AS signing key using SurrealDB as the backing store.
 * Called once during server startup in dependencies.ts.
 */
export async function bootstrapSigningKeyFromSurreal(
  surreal: Surreal,
): Promise<AsSigningKey> {
  return bootstrapSigningKey(
    (row) => saveSigningKeyToSurreal(surreal, row),
    () => loadActiveKeyFromSurreal(surreal),
  );
}
