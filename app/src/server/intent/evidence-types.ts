/**
 * Evidence Types -- Domain types for evidence-backed intent authorization
 *
 * Pure type definitions. No IO, no side effects.
 */
import type { RecordId } from "surrealdb";

// --- Evidence Enforcement Mode ---

export type EvidenceEnforcementMode = "bootstrap" | "soft" | "hard";

// --- Parsed Evidence Reference ---

export type ParsedEvidenceRef = {
  readonly table: string;
  readonly id: string;
  readonly record: RecordId;
};

// --- Evidence Verification Result ---

export type EvidenceVerificationResult = {
  readonly verified_count: number;
  readonly total_count: number;
  readonly failed_refs?: string[];
  readonly verification_time_ms: number;
  readonly warnings?: string[];
  readonly enforcement_mode: EvidenceEnforcementMode;
};
