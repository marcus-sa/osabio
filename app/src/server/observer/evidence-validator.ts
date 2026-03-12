/**
 * Evidence validator: pure core function to strip invalid entity refs from LLM output.
 *
 * Pure module — no IO imports. Takes LLM output + valid entity set, returns cleaned output.
 */

const VALID_TABLES = new Set([
  "project", "feature", "task", "decision", "question",
  "observation", "intent", "git_commit",
]);

/**
 * Parses a "table:id" string into its components.
 * Returns undefined if the format is invalid or the table is not in the allowlist.
 */
export function parseEntityRef(ref: string): { table: string; id: string } | undefined {
  const colonIndex = ref.indexOf(":");
  if (colonIndex < 1) return undefined;

  const table = ref.slice(0, colonIndex);
  const id = ref.slice(colonIndex + 1);

  if (!VALID_TABLES.has(table) || id.length === 0) return undefined;

  return { table, id };
}

/**
 * Strips entity references that don't exist in the provided valid entity set.
 *
 * @param refs - Array of "table:id" strings from LLM output
 * @param validEntityIds - Set of "table:id" strings known to exist in the workspace
 * @returns Filtered array containing only valid, existing references
 */
export function validateEvidenceRefs(
  refs: string[],
  validEntityIds: Set<string>,
): string[] {
  return refs.filter((ref) => {
    const parsed = parseEntityRef(ref);
    if (!parsed) return false;
    return validEntityIds.has(ref);
  });
}
