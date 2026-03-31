/**
 * Skill Domain Types
 *
 * Types for the skill catalog module. Defines the domain model for
 * skill creation, source tracking, tool requirements, and lifecycle
 * management.
 *
 * No null types -- absence is represented by optional fields only.
 */

import type { RecordId } from "surrealdb";

// ---------------------------------------------------------------------------
// Status and source classification
// ---------------------------------------------------------------------------

/** Lifecycle status of a skill: draft -> active -> deprecated. */
export type SkillStatus = "draft" | "active" | "deprecated";

/** Where the skill definition is hosted. */
export type SkillSourceType = "github" | "git";

/** Source reference for a skill definition. */
export type SkillSource = {
  readonly type: SkillSourceType;
  readonly source: string;
  readonly ref?: string;
  readonly subpath?: string;
  readonly skills?: string[];
};

// ---------------------------------------------------------------------------
// Record types
// ---------------------------------------------------------------------------

/** SurrealDB record identifier for a skill. */
export type SkillRecord = RecordId<"skill", string>;

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** Input for creating a new skill in a workspace. */
export type CreateSkillInput = {
  name: string;
  description: string;
  version: string;
  source: SkillSource;
  required_tool_ids?: string[];
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** Skill summary returned from the list endpoint. */
export type SkillListItem = {
  id: string;
  name: string;
  description: string;
  version: string;
  status: SkillStatus;
  source: SkillSource;
  required_tools: Array<{ id: string; name: string }>;
  agent_count: number;
  created_at: string;
};

/** Full skill detail returned from the detail endpoint. */
export type SkillDetailResponse = {
  skill: SkillListItem & {
    created_by?: string;
    updated_at?: string;
  };
  required_tools: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
  governed_by: Array<{ id: string; name: string; status: string }>;
};
