/**
 * Evidence Verification Pipeline -- Pure functions + single effect boundary
 *
 * Verifies that evidence references on an intent point to real, workspace-scoped
 * graph entities. Follows the evaluatePolicyGate pattern: batch DB query as the
 * single effect boundary, all classification and result building are pure.
 *
 * Pipeline: parse refs -> batch query -> classify results -> build verification result
 */
import { RecordId, type Surreal } from "surrealdb";
import { EVIDENCE_TABLE_ALLOWLIST, VALID_EVIDENCE_STATUSES } from "./evidence-constants";
import type {
  EvidenceEnforcementMode,
  EvidenceVerificationResult,
  ParsedEvidenceRef,
} from "./evidence-types";

// ---------------------------------------------------------------------------
// Query Row Type (what comes back from SurrealDB)
// ---------------------------------------------------------------------------

export type EvidenceQueryRow = {
  id: RecordId;
  workspace: RecordId;
  status?: string;
  created_at?: Date;
  source_agent?: string;
};

// ---------------------------------------------------------------------------
// Pure: Parse a single evidence reference string
// ---------------------------------------------------------------------------

/**
 * Strip SurrealDB record-ID escaping from a string.
 *
 * SurrealDB wraps record IDs that contain special characters (e.g. hyphens)
 * in backticks when serialized as strings in JSON payloads (e.g. via
 * SurrealDB EVENT http::post webhooks). The SDK's String() uses Unicode
 * angle brackets (⟨⟩) for display, but over-the-wire JSON uses backticks.
 *
 * Examples: "`decision-abc123`" -> "decision-abc123"
 *           "⟨decision-abc123⟩" -> "decision-abc123"
 */
const stripRecordIdEscaping = (id: string): string =>
  id.replace(/^[`\u27e8]|[`\u27e9]$/g, "");

export function parseEvidenceRef(ref: string): ParsedEvidenceRef | undefined {
  const colonIndex = ref.indexOf(":");
  if (colonIndex <= 0 || colonIndex === ref.length - 1) return undefined;

  const table = ref.slice(0, colonIndex);
  const rawId = stripRecordIdEscaping(ref.slice(colonIndex + 1));

  if (!EVIDENCE_TABLE_ALLOWLIST.has(table)) return undefined;

  return { table, id: rawId, record: new RecordId(table, rawId) };
}

// ---------------------------------------------------------------------------
// Pure: Parse all evidence refs, collecting valid and invalid
// ---------------------------------------------------------------------------

export function parseAllEvidenceRefs(
  refs: ReadonlyArray<string | RecordId>,
): { parsed: ParsedEvidenceRef[]; invalidRefs: string[] } {
  const parsed: ParsedEvidenceRef[] = [];
  const invalidRefs: string[] = [];

  for (const ref of refs) {
    if (typeof ref === "object" && ref !== null && "table" in ref) {
      // Already a RecordId
      const table = ref.table.name;
      const id = ref.id as string;
      if (EVIDENCE_TABLE_ALLOWLIST.has(table)) {
        parsed.push({ table, id, record: ref as RecordId });
      } else {
        invalidRefs.push(`${table}:${id}`);
      }
    } else {
      const result = parseEvidenceRef(String(ref));
      if (result) {
        parsed.push(result);
      } else {
        invalidRefs.push(String(ref));
      }
    }
  }

  return { parsed, invalidRefs };
}

// ---------------------------------------------------------------------------
// Pure: Classify query results against parsed refs
// ---------------------------------------------------------------------------

type ClassificationResult = {
  verifiedCount: number;
  failedRefs: string[];
  warnings: string[];
  verifiedTableCounts: Record<string, number>;
};

export function classifyQueryResults(
  parsedRefs: ParsedEvidenceRef[],
  queryRows: EvidenceQueryRow[],
  workspaceId: RecordId,
  intentCreatedAt?: Date,
): ClassificationResult {
  if (parsedRefs.length === 0) {
    return { verifiedCount: 0, failedRefs: [], warnings: [], verifiedTableCounts: {} };
  }

  // Build a lookup map: "table:id" -> query row
  const rowMap = new Map<string, EvidenceQueryRow>();
  for (const row of queryRows) {
    const key = `${row.id.table.name}:${row.id.id}`;
    rowMap.set(key, row);
  }

  // Normalize workspace ID: strip SurrealDB angle-bracket escaping and table prefix.
  // The workspace RecordId may arrive via JSON (EVENT webhook) with the full string
  // representation embedded in .id (e.g. "workspace:⟨uuid⟩"), or as a clean UUID.
  const normalizeWsId = (id: unknown): string => {
    const s = String(id);
    // Strip table prefix if present (e.g. "workspace:⟨uuid⟩" -> "⟨uuid⟩")
    const afterColon = s.includes(":") ? s.slice(s.indexOf(":") + 1) : s;
    return stripRecordIdEscaping(afterColon);
  };
  const targetWsId = normalizeWsId(workspaceId.id);
  let verifiedCount = 0;
  const failedRefs: string[] = [];
  const warnings: string[] = [];
  const verifiedTableCounts: Record<string, number> = {};

  for (const ref of parsedRefs) {
    const key = `${ref.table}:${ref.id}`;
    const row = rowMap.get(key);

    if (!row) {
      failedRefs.push(key);
      warnings.push(`${key} not found`);
      continue;
    }

    // Check workspace scope
    const rowWsId = normalizeWsId(row.workspace.id);
    if (rowWsId !== targetWsId) {
      failedRefs.push(key);
      warnings.push(`${key} belongs to a different workspace`);
      continue;
    }

    // Check liveness: entity status must be in the valid set for its table
    const validStatuses = VALID_EVIDENCE_STATUSES[ref.table];
    if (validStatuses && row.status && !validStatuses.has(row.status)) {
      failedRefs.push(key);
      warnings.push(`${key} has status '${row.status}' which is not live`);
      continue;
    }

    // Check temporal ordering: evidence must have been created before the intent
    if (intentCreatedAt && row.created_at) {
      const toMs = (d: unknown): number =>
        d instanceof Date ? d.getTime() : new Date(d as string).getTime();
      const evidenceTime = toMs(row.created_at);
      const intentTime = toMs(intentCreatedAt);
      if (evidenceTime > intentTime) {
        failedRefs.push(key);
        warnings.push(`${key} has temporal_violation: created after the intent`);
        continue;
      }
    }

    verifiedCount++;
    verifiedTableCounts[ref.table] = (verifiedTableCounts[ref.table] ?? 0) + 1;
  }

  return { verifiedCount, failedRefs, warnings, verifiedTableCounts };
}

// ---------------------------------------------------------------------------
// Pure: Count independent authors (not the requester)
// ---------------------------------------------------------------------------

/**
 * Counts distinct authors of evidence that are not the requesting agent.
 *
 * Uses `source_agent` field on query rows. Rows where `source_agent` matches
 * the requester are excluded. Rows without `source_agent` (entity types like
 * decisions or tasks that lack explicit authorship tracking) are treated as
 * independently authored -- the absence of authorship attribution means
 * we cannot prove the requester created them.
 *
 * Returns the count of distinct non-requester authors. Entities with unknown
 * authorship each count as a separate anonymous author.
 */
export function countIndependentAuthors(
  queryRows: ReadonlyArray<EvidenceQueryRow>,
  requesterAgent: string,
): number {
  const independentAuthors = new Set<string>();
  let anonymousCount = 0;

  for (const row of queryRows) {
    if (!row.source_agent) {
      // Entity without authorship tracking -- treated as independent
      anonymousCount++;
      continue;
    }
    if (row.source_agent !== requesterAgent) {
      independentAuthors.add(row.source_agent);
    }
  }

  return independentAuthors.size + anonymousCount;
}

// ---------------------------------------------------------------------------
// Pure: Evaluate risk-tiered evidence requirements
// ---------------------------------------------------------------------------

type RiskTierInput = {
  riskScore: number;
  verifiedCount: number;
  verifiedTableCounts: Record<string, number>;
  independentAuthorCount: number;
};

type RiskTierResult = {
  tierMet: boolean;
  warnings: string[];
};

/**
 * Evaluates whether evidence meets the requirements for the intent's risk tier.
 *
 * Risk tiers:
 * - Low (0-30):    1+ ref any type, 0 independent authors required
 * - Medium (31-70): 2+ refs with decision or task, 1+ independent author
 * - High (71-100):  3+ refs with decision AND (task or observation), 2+ independent authors
 */
export function evaluateRiskTierRequirements(input: RiskTierInput): RiskTierResult {
  const { riskScore, verifiedCount, verifiedTableCounts, independentAuthorCount } = input;
  const warnings: string[] = [];

  if (riskScore <= 30) {
    // Low risk: 1 ref any type, no independent authors required
    if (verifiedCount < 1) {
      warnings.push("Low-risk tier requires at least 1 verified evidence reference");
      return { tierMet: false, warnings };
    }
    return { tierMet: true, warnings };
  }

  if (riskScore <= 70) {
    // Medium risk: 2+ refs with decision or task, 1 independent author
    let met = true;
    if (verifiedCount < 2) {
      warnings.push("Medium-risk tier requires at least 2 verified evidence references");
      met = false;
    }
    const hasDecisionOrTask = (verifiedTableCounts.decision ?? 0) > 0
      || (verifiedTableCounts.task ?? 0) > 0;
    if (!hasDecisionOrTask) {
      warnings.push("Medium-risk tier requires at least one decision or task reference");
      met = false;
    }
    if (independentAuthorCount < 1) {
      warnings.push("Medium-risk tier requires at least 1 independent author");
      met = false;
    }
    return { tierMet: met, warnings };
  }

  // High risk (71-100): 3+ refs with decision AND (task or observation), 2 independent authors
  let met = true;
  if (verifiedCount < 3) {
    warnings.push("High-risk tier requires at least 3 verified evidence references");
    met = false;
  }
  const hasDecision = (verifiedTableCounts.decision ?? 0) > 0;
  if (!hasDecision) {
    warnings.push("High-risk tier requires at least one decision reference");
    met = false;
  }
  const hasTaskOrObservation = (verifiedTableCounts.task ?? 0) > 0
    || (verifiedTableCounts.observation ?? 0) > 0;
  if (!hasTaskOrObservation) {
    warnings.push("High-risk tier requires at least one task or observation reference");
    met = false;
  }
  if (independentAuthorCount < 2) {
    warnings.push("High-risk tier requires at least 2 independent authors");
    met = false;
  }
  return { tierMet: met, warnings };
}

// ---------------------------------------------------------------------------
// Pure: Build the final verification result
// ---------------------------------------------------------------------------

type BuildVerificationInput = {
  verifiedCount: number;
  totalCount: number;
  failedRefs: string[];
  warnings: string[];
  verificationTimeMs: number;
  enforcementMode: EvidenceEnforcementMode;
  independentAuthorCount?: number;
  tierMet?: boolean;
};

export function buildVerificationResult(
  input: BuildVerificationInput,
): EvidenceVerificationResult {
  return {
    verified_count: input.verifiedCount,
    total_count: input.totalCount,
    verification_time_ms: input.verificationTimeMs,
    enforcement_mode: input.enforcementMode,
    ...(input.failedRefs.length > 0 ? { failed_refs: input.failedRefs } : {}),
    ...(input.warnings.length > 0 ? { warnings: input.warnings } : {}),
    ...(input.independentAuthorCount !== undefined ? { independent_author_count: input.independentAuthorCount } : {}),
    ...(input.tierMet !== undefined ? { tier_met: input.tierMet } : {}),
  };
}

// ---------------------------------------------------------------------------
// Effect Boundary: Batch query SurrealDB for evidence existence + scope
// ---------------------------------------------------------------------------

async function batchQueryEvidence(
  surreal: Surreal,
  parsedRefs: ParsedEvidenceRef[],
): Promise<EvidenceQueryRow[]> {
  if (parsedRefs.length === 0) return [];

  // SurrealDB does not support SELECT FROM $array where $array is an array
  // of RecordIds (throws "Specify a database to use"). Use per-ref SELECT
  // statements combined in a single .query() call for one round-trip.
  const statements = parsedRefs.map((_, i) => `SELECT id, workspace, status, created_at, source_agent FROM $r${i};`).join(" ");
  const bindings: Record<string, RecordId> = {};
  for (let i = 0; i < parsedRefs.length; i++) {
    bindings[`r${i}`] = parsedRefs[i].record;
  }

  const results = await surreal.query(statements, bindings);

  // Each statement returns an array; flatten all results
  const rows: EvidenceQueryRow[] = [];
  for (const result of results as Array<EvidenceQueryRow[]>) {
    if (Array.isArray(result)) {
      rows.push(...result);
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Composition Root: verifyEvidence
// ---------------------------------------------------------------------------

export async function verifyEvidence(
  surreal: Surreal,
  evidenceRefs: ReadonlyArray<string | RecordId>,
  workspaceId: RecordId<"workspace">,
  enforcementMode: EvidenceEnforcementMode,
  intentCreatedAt?: Date,
  riskScore?: number,
  requesterAgent?: string,
): Promise<EvidenceVerificationResult> {
  const startMs = Date.now();

  // Pure: parse refs
  const { parsed, invalidRefs } = parseAllEvidenceRefs(evidenceRefs);

  // Collect warnings from invalid refs
  const warnings: string[] = invalidRefs.map(
    (ref) => `${ref} is not a valid evidence reference`,
  );

  // Effect boundary: single batched DB query
  const queryRows = await batchQueryEvidence(surreal, parsed);

  // Pure: classify results
  const classification = classifyQueryResults(parsed, queryRows, workspaceId, intentCreatedAt);

  // Pure: authorship independence check
  const independentAuthorCount = requesterAgent
    ? countIndependentAuthors(queryRows, requesterAgent)
    : undefined;

  // Pure: risk-tier evaluation
  let tierResult: RiskTierResult | undefined;
  if (riskScore !== undefined && independentAuthorCount !== undefined) {
    tierResult = evaluateRiskTierRequirements({
      riskScore,
      verifiedCount: classification.verifiedCount,
      verifiedTableCounts: classification.verifiedTableCounts,
      independentAuthorCount,
    });
  }

  const allWarnings = [
    ...classification.warnings,
    ...warnings,
    ...(tierResult?.warnings ?? []),
  ];

  const elapsedMs = Date.now() - startMs;

  // Pure: build final result
  return buildVerificationResult({
    verifiedCount: classification.verifiedCount,
    totalCount: evidenceRefs.length,
    failedRefs: [...classification.failedRefs, ...invalidRefs],
    warnings: allWarnings,
    verificationTimeMs: elapsedMs,
    enforcementMode,
    independentAuthorCount,
    tierMet: tierResult?.tierMet,
  });
}
