/**
 * Unit Tests: Evidence Verification Pipeline (pure functions)
 *
 * Tests the pure pipeline functions in evidence-verification.ts.
 * No IO -- mock query results are passed directly to pure functions.
 */
import { describe, it, expect } from "bun:test";
import { RecordId } from "surrealdb";
import {
  parseEvidenceRef,
  classifyQueryResults,
  buildVerificationResult,
  countIndependentAuthors,
  evaluateRiskTierRequirements,
  type EvidenceQueryRow,
} from "../../../app/src/server/intent/evidence-verification";
import {
  EVIDENCE_TABLE_ALLOWLIST,
} from "../../../app/src/server/intent/evidence-constants";
import type {
  EvidenceEnforcementMode,
  ParsedEvidenceRef,
} from "../../../app/src/server/intent/evidence-types";

// ---------------------------------------------------------------------------
// parseEvidenceRef
// ---------------------------------------------------------------------------

describe("parseEvidenceRef", () => {
  it("parses valid table:id format into ParsedEvidenceRef", () => {
    const result = parseEvidenceRef("decision:abc123");
    expect(result).toBeDefined();
    expect(result!.table).toBe("decision");
    expect(result!.id).toBe("abc123");
    expect(result!.record.table.name).toBe("decision");
  });

  it("rejects unknown table names", () => {
    const result = parseEvidenceRef("unknown_table:abc123");
    expect(result).toBeUndefined();
  });

  it("rejects malformed refs without colon", () => {
    const result = parseEvidenceRef("no-colon-here");
    expect(result).toBeUndefined();
  });

  it("rejects empty string", () => {
    const result = parseEvidenceRef("");
    expect(result).toBeUndefined();
  });

  it("accepts all allowlisted tables", () => {
    for (const table of EVIDENCE_TABLE_ALLOWLIST) {
      const result = parseEvidenceRef(`${table}:test-id`);
      expect(result).toBeDefined();
      expect(result!.table).toBe(table);
    }
  });
});

// ---------------------------------------------------------------------------
// classifyQueryResults
// ---------------------------------------------------------------------------

describe("classifyQueryResults", () => {
  const workspaceId = new RecordId("workspace", "ws-test");

  it("marks all refs as verified when all records exist in the same workspace", () => {
    const parsedRefs: ParsedEvidenceRef[] = [
      { table: "decision", id: "d1", record: new RecordId("decision", "d1") },
      { table: "task", id: "t1", record: new RecordId("task", "t1") },
    ];
    const queryRows: EvidenceQueryRow[] = [
      { id: new RecordId("decision", "d1"), workspace: workspaceId },
      { id: new RecordId("task", "t1"), workspace: workspaceId },
    ];

    const result = classifyQueryResults(parsedRefs, queryRows, workspaceId);
    expect(result.verifiedCount).toBe(2);
    expect(result.failedRefs).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("marks missing records as failed with warning", () => {
    const parsedRefs: ParsedEvidenceRef[] = [
      { table: "decision", id: "d1", record: new RecordId("decision", "d1") },
      { table: "task", id: "t-missing", record: new RecordId("task", "t-missing") },
    ];
    const queryRows: EvidenceQueryRow[] = [
      { id: new RecordId("decision", "d1"), workspace: workspaceId },
    ];

    const result = classifyQueryResults(parsedRefs, queryRows, workspaceId);
    expect(result.verifiedCount).toBe(1);
    expect(result.failedRefs).toContain("task:t-missing");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("marks records from wrong workspace as failed", () => {
    const otherWorkspace = new RecordId("workspace", "ws-other");
    const parsedRefs: ParsedEvidenceRef[] = [
      { table: "decision", id: "d1", record: new RecordId("decision", "d1") },
    ];
    const queryRows: EvidenceQueryRow[] = [
      { id: new RecordId("decision", "d1"), workspace: otherWorkspace },
    ];

    const result = classifyQueryResults(parsedRefs, queryRows, workspaceId);
    expect(result.verifiedCount).toBe(0);
    expect(result.failedRefs).toContain("decision:d1");
    expect(result.warnings.some(w => w.includes("workspace"))).toBe(true);
  });

  it("returns zero verified when no refs provided", () => {
    const result = classifyQueryResults([], [], workspaceId);
    expect(result.verifiedCount).toBe(0);
    expect(result.failedRefs).toHaveLength(0);
  });

  it("marks evidence created after intent as temporal violation", () => {
    const intentCreatedAt = new Date("2026-01-15T10:00:00Z");
    const parsedRefs: ParsedEvidenceRef[] = [
      { table: "observation", id: "obs1", record: new RecordId("observation", "obs1") },
    ];
    const queryRows: EvidenceQueryRow[] = [
      {
        id: new RecordId("observation", "obs1"),
        workspace: workspaceId,
        created_at: new Date("2026-01-15T10:01:00Z"), // 1 minute AFTER intent
      },
    ];

    const result = classifyQueryResults(parsedRefs, queryRows, workspaceId, intentCreatedAt);
    expect(result.verifiedCount).toBe(0);
    expect(result.failedRefs).toContain("observation:obs1");
    expect(result.warnings.some(w => w.toLowerCase().includes("temporal"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildVerificationResult
// ---------------------------------------------------------------------------

describe("buildVerificationResult", () => {
  it("builds a result with all fields populated", () => {
    const result = buildVerificationResult({
      verifiedCount: 2,
      totalCount: 2,
      failedRefs: [],
      warnings: [],
      verificationTimeMs: 5,
      enforcementMode: "soft",
    });

    expect(result.verified_count).toBe(2);
    expect(result.total_count).toBe(2);
    expect(result.verification_time_ms).toBe(5);
    expect(result.enforcement_mode).toBe("soft");
    expect(result.failed_refs).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it("includes failed_refs when present", () => {
    const result = buildVerificationResult({
      verifiedCount: 1,
      totalCount: 2,
      failedRefs: ["task:t-missing"],
      warnings: ["task:t-missing not found"],
      verificationTimeMs: 3,
      enforcementMode: "hard",
    });

    expect(result.verified_count).toBe(1);
    expect(result.total_count).toBe(2);
    expect(result.failed_refs).toEqual(["task:t-missing"]);
    expect(result.warnings).toEqual(["task:t-missing not found"]);
  });

  it("omits failed_refs and warnings when arrays are empty", () => {
    const result = buildVerificationResult({
      verifiedCount: 3,
      totalCount: 3,
      failedRefs: [],
      warnings: [],
      verificationTimeMs: 1,
      enforcementMode: "bootstrap",
    });

    expect(result.failed_refs).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// countIndependentAuthors
// ---------------------------------------------------------------------------

describe("countIndependentAuthors", () => {
  const workspaceId = new RecordId("workspace", "ws-test");

  it("counts authors that are different from the requester", () => {
    const queryRows: EvidenceQueryRow[] = [
      {
        id: new RecordId("observation", "obs1"),
        workspace: workspaceId,
        source_agent: "observer-agent",
      },
      {
        id: new RecordId("decision", "d1"),
        workspace: workspaceId,
        source_agent: "architect-agent",
      },
      {
        id: new RecordId("task", "t1"),
        workspace: workspaceId,
        source_agent: "logistics-planner",
      },
    ];

    const result = countIndependentAuthors(queryRows, "logistics-planner");
    // observer-agent and architect-agent are independent (not the requester)
    expect(result).toBe(2);
  });

  it("returns zero when all evidence is authored by the requester", () => {
    const queryRows: EvidenceQueryRow[] = [
      {
        id: new RecordId("observation", "obs1"),
        workspace: workspaceId,
        source_agent: "logistics-planner",
      },
      {
        id: new RecordId("observation", "obs2"),
        workspace: workspaceId,
        source_agent: "logistics-planner",
      },
    ];

    const result = countIndependentAuthors(queryRows, "logistics-planner");
    expect(result).toBe(0);
  });

  it("counts distinct independent authors, not distinct evidence refs", () => {
    const queryRows: EvidenceQueryRow[] = [
      {
        id: new RecordId("observation", "obs1"),
        workspace: workspaceId,
        source_agent: "observer-agent",
      },
      {
        id: new RecordId("observation", "obs2"),
        workspace: workspaceId,
        source_agent: "observer-agent",  // same author as obs1
      },
      {
        id: new RecordId("decision", "d1"),
        workspace: workspaceId,
        source_agent: "architect-agent",
      },
    ];

    const result = countIndependentAuthors(queryRows, "logistics-planner");
    // 2 distinct independent authors: observer-agent, architect-agent
    expect(result).toBe(2);
  });

  it("treats evidence with no source_agent as independently authored", () => {
    const queryRows: EvidenceQueryRow[] = [
      {
        id: new RecordId("decision", "d1"),
        workspace: workspaceId,
        // no source_agent -- entity type without explicit authorship, treated as independent
      },
      {
        id: new RecordId("observation", "obs1"),
        workspace: workspaceId,
        source_agent: "observer-agent",
      },
    ];

    const result = countIndependentAuthors(queryRows, "logistics-planner");
    // decision (anonymous, independent) + observer-agent (independent) = 2
    expect(result).toBe(2);
  });

  it("returns zero for empty query rows", () => {
    const result = countIndependentAuthors([], "logistics-planner");
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// evaluateRiskTierRequirements
// ---------------------------------------------------------------------------

describe("evaluateRiskTierRequirements", () => {
  it("high-risk tier met with 3+ refs including decision and 2 independent authors", () => {
    const result = evaluateRiskTierRequirements({
      riskScore: 85,
      verifiedCount: 3,
      verifiedTableCounts: { decision: 1, task: 1, observation: 1 },
      independentAuthorCount: 2,
    });

    expect(result.tierMet).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("high-risk tier fails when independent author count is below 2", () => {
    const result = evaluateRiskTierRequirements({
      riskScore: 85,
      verifiedCount: 3,
      verifiedTableCounts: { decision: 1, task: 1, observation: 1 },
      independentAuthorCount: 1,
    });

    expect(result.tierMet).toBe(false);
    expect(result.warnings.some(w => w.toLowerCase().includes("independent"))).toBe(true);
  });

  it("medium-risk tier met with 2+ refs including decision and 1 independent author", () => {
    const result = evaluateRiskTierRequirements({
      riskScore: 50,
      verifiedCount: 2,
      verifiedTableCounts: { decision: 1, observation: 1 },
      independentAuthorCount: 1,
    });

    expect(result.tierMet).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("medium-risk tier fails when no decision or task type present", () => {
    const result = evaluateRiskTierRequirements({
      riskScore: 50,
      verifiedCount: 2,
      verifiedTableCounts: { observation: 2 },
      independentAuthorCount: 1,
    });

    expect(result.tierMet).toBe(false);
    expect(result.warnings.some(w => w.toLowerCase().includes("decision") || w.toLowerCase().includes("task"))).toBe(true);
  });

  it("low-risk tier met with 1 ref of any type and no independent authors required", () => {
    const result = evaluateRiskTierRequirements({
      riskScore: 15,
      verifiedCount: 1,
      verifiedTableCounts: { task: 1 },
      independentAuthorCount: 0,
    });

    expect(result.tierMet).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("low-risk tier fails when zero verified refs", () => {
    const result = evaluateRiskTierRequirements({
      riskScore: 15,
      verifiedCount: 0,
      verifiedTableCounts: {},
      independentAuthorCount: 0,
    });

    expect(result.tierMet).toBe(false);
  });

  it("high-risk tier fails when no decision type present", () => {
    const result = evaluateRiskTierRequirements({
      riskScore: 85,
      verifiedCount: 3,
      verifiedTableCounts: { task: 2, observation: 1 },
      independentAuthorCount: 2,
    });

    expect(result.tierMet).toBe(false);
    expect(result.warnings.some(w => w.toLowerCase().includes("decision"))).toBe(true);
  });
});
