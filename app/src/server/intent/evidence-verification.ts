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
};

export function classifyQueryResults(
  parsedRefs: ParsedEvidenceRef[],
  queryRows: EvidenceQueryRow[],
  workspaceId: RecordId,
  intentCreatedAt?: Date,
): ClassificationResult {
  if (parsedRefs.length === 0) {
    return { verifiedCount: 0, failedRefs: [], warnings: [] };
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
  }

  return { verifiedCount, failedRefs, warnings };
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
  const statements = parsedRefs.map((_, i) => `SELECT id, workspace, status, created_at FROM $r${i};`).join(" ");
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

  const elapsedMs = Date.now() - startMs;

  // Pure: build final result
  return buildVerificationResult({
    verifiedCount: classification.verifiedCount,
    totalCount: evidenceRefs.length,
    failedRefs: [...classification.failedRefs, ...invalidRefs],
    warnings: [...classification.warnings, ...warnings],
    verificationTimeMs: elapsedMs,
    enforcementMode,
  });
}
