/**
 * Pure validation functions for MCP server input.
 *
 * No IO, no dependencies -- these are domain validation rules as pure functions.
 */

type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const ALLOWED_TRANSPORTS = new Set(["streamable-http", "sse"]);

type UrlValidationResult =
  | { readonly ok: true; readonly normalizedUrl: string }
  | { readonly ok: false; readonly error: string };

/**
 * Validate and normalize an MCP server URL.
 *
 * - Trims whitespace
 * - Rejects non-http(s) schemes
 * - Returns the normalized URL string from `new URL()` (consistent trailing slash, encoding)
 */
export function validateMcpServerUrl(url: string): UrlValidationResult {
  const trimmed = url?.trim() ?? "";
  if (!trimmed) {
    return { ok: false, error: "url is required" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "url is not a valid URL" };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, error: `url must use http or https scheme, got ${parsed.protocol.replace(":", "")}` };
  }

  return { ok: true, normalizedUrl: parsed.href };
}

/**
 * Validate that transport is one of the allowed values.
 */
export function validateMcpServerTransport(transport: string): ValidationResult {
  if (!ALLOWED_TRANSPORTS.has(transport)) {
    return { ok: false, error: `transport must be "streamable-http" or "sse", got "${transport}"` };
  }
  return { ok: true };
}
