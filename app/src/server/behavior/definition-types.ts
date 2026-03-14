/**
 * Behavior Definition Types
 *
 * Type definitions for the behavior_definition table and related inputs.
 * Behavior definitions are admin-created standards that describe how agents
 * should behave, with LLM-based scoring logic and enforcement modes.
 */
import type { RecordId } from "surrealdb";

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

export type DefinitionStatus = "draft" | "active" | "archived";
export type EnforcementMode = "warn_only" | "automatic";

// ---------------------------------------------------------------------------
// Database Record Shape
// ---------------------------------------------------------------------------

export type BehaviorDefinitionRecord = {
  id: RecordId<"behavior_definition">;
  title: string;
  goal: string;
  scoring_logic: string;
  telemetry_types: string[];
  category?: string;
  status: DefinitionStatus;
  version: number;
  enforcement_mode: EnforcementMode;
  enforcement_threshold?: number;
  workspace: RecordId<"workspace">;
  created_by?: RecordId<"identity">;
  created_at: string;
  updated_at?: string;
};

// ---------------------------------------------------------------------------
// API Input Shapes
// ---------------------------------------------------------------------------

export type CreateBehaviorDefinitionInput = {
  title: string;
  goal: string;
  scoring_logic: string;
  telemetry_types: string[];
  category?: string;
};

export type UpdateBehaviorDefinitionInput = {
  goal?: string;
  scoring_logic?: string;
  telemetry_types?: string[];
  category?: string;
  status?: DefinitionStatus;
  enforcement_mode?: EnforcementMode;
  enforcement_threshold?: number;
};

// ---------------------------------------------------------------------------
// LLM Scorer Output
// ---------------------------------------------------------------------------

export type LlmScorerResult = {
  score: number;
  rationale: string;
  evidence_checked: string[];
};
