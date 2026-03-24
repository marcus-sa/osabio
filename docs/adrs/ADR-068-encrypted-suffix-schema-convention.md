# ADR-068: Encrypted Field Suffix Convention in Schema

## Status
Proposed

## Context
The MCP Tool Registry stores sensitive credential data (OAuth tokens, API keys, passwords) encrypted at rest (ADR-066). The SurrealDB schema needs to represent these fields. The original issue schema (#178) uses plaintext field names (`client_secret`, `access_token`), which creates ambiguity: does the field contain plaintext or ciphertext?

This ambiguity is dangerous because:
1. A developer might read `client_secret` and assume it's usable directly
2. Query results in admin tools / debugging show the field -- the name should signal "this is ciphertext"
3. Code review cannot distinguish encrypted vs plaintext fields without checking encryption call sites

## Decision
All encrypted fields use an `_encrypted` suffix: `client_secret_encrypted`, `access_token_encrypted`, `refresh_token_encrypted`, `api_key_encrypted`, `basic_password_encrypted`.

The plaintext field names (`client_secret`, `access_token`, etc.) do NOT exist in the schema. There is no "plaintext version" stored anywhere.

Domain types in TypeScript also use the suffix. Decrypted values exist only as local variables within `credential-resolver.ts`, never as persisted or typed domain fields.

## Alternatives Considered

### Alternative 1: Same field names as issue schema (no suffix)
- **What**: Use `client_secret`, `access_token` as field names, store ciphertext in them.
- **Expected impact**: Simpler schema, matches the original issue spec.
- **Why rejected**: Ambiguous. A field named `access_token` containing base64 ciphertext is misleading. Every reader of the schema or query result must know the encryption convention. The suffix makes it self-documenting.

### Alternative 2: Separate encrypted fields table
- **What**: Store all encrypted values in a dedicated `encrypted_field` table with `entity`, `field_name`, `ciphertext` columns.
- **Expected impact**: Centralized encryption, single decryption code path.
- **Why rejected**: Splits the domain model across tables. Credential resolution requires a JOIN for every field. Increases query complexity and latency. The per-field suffix approach keeps the data model cohesive.

## Consequences
- **Positive**: Self-documenting schema -- any reader knows the field contains ciphertext
- **Positive**: Code review can verify that `_encrypted` fields are only read via the decryption adapter
- **Positive**: Prevents accidental plaintext exposure in query results, admin consoles, backups
- **Negative**: Diverges from the original issue schema field names (documented in data-models.md)
- **Negative**: Slightly longer field names
