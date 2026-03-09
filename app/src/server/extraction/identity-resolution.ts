import { RecordId, type Surreal } from "surrealdb";
import type { PersistableExtractableEntityKind } from "./types";

/**
 * Known agent role aliases: maps common natural-language mentions
 * to the canonical identity.role value stored in the identity table.
 */
const AGENT_ROLE_ALIASES: ReadonlyMap<string, string> = new Map([
  ["pm", "management"],
  ["pm agent", "management"],
  ["project manager", "management"],
  ["management", "management"],
  ["management agent", "management"],
  ["code agent", "coder"],
  ["code", "coder"],
  ["coder", "coder"],
  ["coding agent", "coder"],
  ["observer", "observer"],
  ["observer agent", "observer"],
  ["architect", "architect"],
  ["architect agent", "architect"],
  ["design partner", "design_partner"],
  ["design partner agent", "design_partner"],
]);

/**
 * Patterns that indicate an ambiguous, non-specific agent mention.
 * These should NOT resolve to any identity to avoid false positives.
 */
const AMBIGUOUS_PATTERNS: ReadonlyArray<RegExp> = [
  /^(an?\s+)?agent$/i,
  /^the\s+agent$/i,
  /^some\s+agent$/i,
  /^(an?\s+)?ai(\s+agent)?$/i,
];

/**
 * Returns true when the mention is too vague to attribute to a specific agent identity.
 * Pure function -- no IO, no side effects.
 */
export function isAmbiguousAgentMention(mention: string): boolean {
  const trimmed = mention.trim();
  return AMBIGUOUS_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Extracts a candidate agent role from a natural-language mention.
 * Strips common prefixes like "the" before looking up the alias map.
 * Returns the canonical role string or undefined if no match.
 */
function extractAgentRole(mention: string): string | undefined {
  const normalized = mention
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, "");

  return AGENT_ROLE_ALIASES.get(normalized);
}

/**
 * Finds an agent identity by role within a workspace.
 * Returns the identity RecordId if exactly one match exists.
 */
async function findWorkspaceAgentByRole(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  role: string;
}): Promise<RecordId<"identity", string> | undefined> {
  // Note: cannot combine type + workspace + role in a single WHERE due to
  // SurrealDB v3.0 index planner bug (identity_type_workspace index causes
  // empty results when combined with additional conditions). Omitting type
  // is safe because role values are agent-specific.
  const results = await input.surreal.query<[Array<{ id: RecordId<"identity", string> }>]>(
    [
      "SELECT id",
      "FROM identity",
      "WHERE workspace = $workspace",
      "AND role = $role",
      "LIMIT 1;",
    ].join(" "),
    {
      workspace: input.workspaceRecord,
      role: input.role,
    },
  );
  const rows = results[0] as Array<{ id: RecordId<"identity", string> }>;
  return rows?.[0]?.id;
}

export type IdentityAttributionPatch =
  | { kind: "feature"; field: "owner"; value: string }
  | { kind: "feature"; field: "owner_name"; value: string }
  | { kind: "task"; field: "owner"; value: string }
  | { kind: "task"; field: "owner_name"; value: string }
  | { kind: "decision"; field: "decided_by"; value: string }
  | { kind: "decision"; field: "decided_by_name"; value: string }
  | { kind: "question"; field: "assigned_to"; value: string }
  | { kind: "question"; field: "assigned_to_name"; value: string };

export async function findWorkspaceIdentityByName(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  identityName: string;
}): Promise<RecordId<"identity", string> | undefined> {
  const normalizedName = input.identityName.trim();
  if (normalizedName.length === 0) {
    return undefined;
  }

  const [rows] = await input.surreal
    .query<[Array<{ id: RecordId<"identity", string> }>]>(
      [
        "SELECT id",
        "FROM identity",
        "WHERE workspace = $workspace",
        "AND string::lowercase(name) = string::lowercase($name)",
        "LIMIT 1;",
      ].join(" "),
      {
        workspace: input.workspaceRecord,
        name: normalizedName,
      },
    )
    .collect<[Array<{ id: RecordId<"identity", string> }>]>();

  return rows[0]?.id;
}

/**
 * Composite resolver: ambiguity guard -> exact name match -> role-based agent match.
 * Never creates phantom records -- returns undefined when no match found.
 */
export async function resolveWorkspaceIdentity(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  identityName: string;
}): Promise<RecordId<"identity", string> | undefined> {
  const trimmed = input.identityName.trim();
  if (trimmed.length === 0) return undefined;

  // Guard: reject ambiguous mentions before any DB query
  if (isAmbiguousAgentMention(trimmed)) return undefined;

  // Step 1: exact name match (works for both human and agent identities)
  const byName = await findWorkspaceIdentityByName(input);
  if (byName) return byName;

  // Step 2: role-based agent resolution (e.g. "the PM agent" -> role: management)
  const role = extractAgentRole(trimmed);
  if (role) {
    return findWorkspaceAgentByRole({
      surreal: input.surreal,
      workspaceRecord: input.workspaceRecord,
      role,
    });
  }

  return undefined;
}

export function resolveIdentityAttributionPatch(input: {
  targetKind: PersistableExtractableEntityKind;
  assigneeName: string;
  identityRecordId?: string;
}): IdentityAttributionPatch {
  if (input.targetKind === "feature") {
    if (input.identityRecordId) {
      return { kind: "feature", field: "owner", value: input.identityRecordId };
    }

    return { kind: "feature", field: "owner_name", value: input.assigneeName };
  }

  if (input.targetKind === "task") {
    if (input.identityRecordId) {
      return { kind: "task", field: "owner", value: input.identityRecordId };
    }

    return { kind: "task", field: "owner_name", value: input.assigneeName };
  }

  if (input.targetKind === "decision") {
    if (input.identityRecordId) {
      return { kind: "decision", field: "decided_by", value: input.identityRecordId };
    }

    return { kind: "decision", field: "decided_by_name", value: input.assigneeName };
  }

  if (input.identityRecordId) {
    return { kind: "question", field: "assigned_to", value: input.identityRecordId };
  }

  return { kind: "question", field: "assigned_to_name", value: input.assigneeName };
}
