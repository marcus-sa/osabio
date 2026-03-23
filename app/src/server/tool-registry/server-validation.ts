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

/**
 * Validate that a URL uses only http:// or https:// schemes.
 * Rejects file://, javascript://, ftp://, and malformed URLs.
 */
export function validateMcpServerUrl(url: string): ValidationResult {
  if (!url) {
    return { ok: false, error: "url is required" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "url is not a valid URL" };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, error: `url must use http or https scheme, got ${parsed.protocol.replace(":", "")}` };
  }

  return { ok: true };
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
