/**
 * Shared helpers for normalizing SurrealDB record-id values that may arrive
 * as raw IDs, table-prefixed strings, escaped strings, or serialized objects.
 */

export const stripRecordIdEscaping = (id: string): string =>
  id.replace(/^[`\u27e8]|[`\u27e9]$/g, "");

export function normalizeRecordIdValue(value: unknown): string {
  const raw = typeof value === "object" && value !== null && "id" in value
    ? String((value as { id: unknown }).id)
    : String(value);
  const trimmed = raw.trim();
  const withoutTable = trimmed.includes(":") ? trimmed.slice(trimmed.indexOf(":") + 1) : trimmed;
  return stripRecordIdEscaping(withoutTable);
}
