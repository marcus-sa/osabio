# ADR-066: AES-256-GCM for Credential Encryption at Rest

## Status
Proposed

## Context
NFR-1 requires all credential fields (client_secret, access_token, refresh_token, api_key, basic_password) encrypted at rest with AES-256-GCM. Credentials must never appear in LLM context, agent logs, or API responses.

The encryption must happen at the application layer (not database-level) because:
1. SurrealDB does not offer transparent field-level encryption
2. Credentials must be decrypted only at the execution boundary (credential-resolver), not on every DB read
3. The encrypted form must be opaque to any SurrealDB query or admin console access

## Decision
Use Node.js/Bun native `crypto` module for AES-256-GCM encryption. Each encrypted field stored as a base64 string containing `IV || ciphertext || authTag`. The encryption key is a 256-bit key loaded from `ServerConfig.toolEncryptionKey` at startup.

Encrypted field names use `_encrypted` suffix in the schema (e.g., `client_secret_encrypted`) to make ciphertext storage explicit and prevent accidental plaintext reads.

Decryption happens only in `credential-resolver.ts` at the moment of tool call execution. No other code path decrypts credentials.

## Alternatives Considered

### Alternative 1: SurrealDB-level encryption (surrealkv encryption at rest)
- **What**: Rely on SurrealKV's storage engine encryption for at-rest protection.
- **Expected impact**: Zero application code for encryption.
- **Why rejected**: SurrealKV encryption protects the storage files, not individual fields. Any SurrealDB query returns plaintext. Admin console access, query logs, and backup exports would contain raw credentials. Does not satisfy NFR-1's requirement that credentials never appear in query results.

### Alternative 2: HashiCorp Vault for key management + encryption
- **What**: Use Vault's Transit secrets engine for encrypt/decrypt operations.
- **Expected impact**: Enterprise-grade key management with rotation, audit, and access policies.
- **Why rejected**: Adds external service dependency (Vault) to a single-developer project. Operational complexity (Vault server, unsealing, token renewal) exceeds the current deployment model. The encryption key in `ServerConfig` is sufficient for the current threat model. Vault can be layered on later by replacing the encryption adapter.

### Alternative 3: libsodium (sodium-native) for encryption
- **What**: Use libsodium's `crypto_secretbox_easy` (XSalsa20-Poly1305) instead of AES-256-GCM.
- **Expected impact**: Slightly simpler API, misuse-resistant.
- **Why rejected**: Requires native addon (`sodium-native`), which adds compilation dependency. Bun's native `crypto` module supports AES-256-GCM natively with zero additional dependencies. AES-256-GCM is the industry standard for authenticated encryption and is NIST-approved.

## Consequences
- **Positive**: Zero external dependencies (Bun native crypto)
- **Positive**: Authenticated encryption (GCM) prevents tampering
- **Positive**: Unique IV per encryption prevents ciphertext analysis
- **Positive**: `_encrypted` suffix makes ciphertext explicit in schema and code
- **Positive**: Encryption adapter is swappable (Vault, KMS) without changing the rest of the system
- **Negative**: Key rotation requires re-encryption of all stored credentials (future enhancement)
- **Negative**: Key compromise exposes all credentials (mitigated by: key stored in env, not in DB; server access required)
