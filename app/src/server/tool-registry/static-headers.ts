/**
 * Static header validation and encryption for MCP servers.
 *
 * Pure core:
 *   validateHeaders  -- rejects restricted names, empty values, duplicates
 *   buildHeaderMap   -- converts decrypted HeaderEntry[] to Record<string, string>
 *
 * Effect shell (delegates to encryption.ts):
 *   encryptHeaders   -- encrypts each header value via AES-256-GCM
 *   decryptHeaders   -- decrypts each encrypted header value
 *
 * ADR-066, ADR-068.
 */
import { encryptSecret, decryptSecret } from "./encryption";
import type { HeaderEntry, EncryptedHeaderEntry } from "./types";

// ---------------------------------------------------------------------------
// Restricted header names (case-insensitive)
// ---------------------------------------------------------------------------

const RESTRICTED_HEADER_NAMES: ReadonlySet<string> = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
]);

// ---------------------------------------------------------------------------
// Validation result type
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

/**
 * Validate header entries before encryption.
 *
 * Rules:
 *  - No restricted header names (Host, Content-Length, Transfer-Encoding, Connection)
 *  - Non-empty name and value
 *  - No duplicate names (case-insensitive)
 */
export function validateHeaders(headers: HeaderEntry[]): ValidationResult {
  const seenNames = new Set<string>();

  for (const header of headers) {
    if (!header.name || header.name.trim().length === 0) {
      return { ok: false, error: "Header name must not be empty" };
    }

    if (!header.value || header.value.length === 0) {
      return { ok: false, error: `Header "${header.name}" must have a non-empty value` };
    }

    const normalizedName = header.name.toLowerCase();

    if (RESTRICTED_HEADER_NAMES.has(normalizedName)) {
      return { ok: false, error: `Restricted header name: ${header.name}` };
    }

    if (seenNames.has(normalizedName)) {
      return { ok: false, error: `Duplicate header name (case-insensitive): ${header.name}` };
    }

    seenNames.add(normalizedName);
  }

  return { ok: true };
}

/**
 * Convert decrypted header entries to a plain key-value map.
 */
export function buildHeaderMap(headers: HeaderEntry[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const header of headers) {
    map[header.name] = header.value;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Effect shell
// ---------------------------------------------------------------------------

/**
 * Encrypt each header value using AES-256-GCM.
 * Header names are stored in plaintext; only values are encrypted.
 */
export function encryptHeaders(
  headers: HeaderEntry[],
  keyHex: string,
): EncryptedHeaderEntry[] {
  return headers.map((header) => ({
    name: header.name,
    value_encrypted: encryptSecret(header.value, keyHex),
  }));
}

/**
 * Decrypt each encrypted header value back to plaintext.
 */
export function decryptHeaders(
  encrypted: EncryptedHeaderEntry[],
  keyHex: string,
): HeaderEntry[] {
  return encrypted.map((entry) => ({
    name: entry.name,
    value: decryptSecret(entry.value_encrypted, keyHex),
  }));
}
