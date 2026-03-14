/**
 * Behavior Definition CRUD Acceptance Tests (US-DB-001)
 *
 * Validates that workspace admins can create, read, update, and archive
 * behavior definitions with plain-language goals, scoring logic, and
 * telemetry type configuration.
 *
 * Driving ports:
 *   POST /api/workspaces/:workspaceId/behavior-definitions   (create)
 *   GET  /api/workspaces/:workspaceId/behavior-definitions    (list)
 *   GET  /api/workspaces/:workspaceId/behavior-definitions/:id (detail)
 *   PUT  /api/workspaces/:workspaceId/behavior-definitions/:id (update)
 *   SurrealDB direct queries                                   (verification)
 */
import { describe, expect, it } from "bun:test";
import {
  setupDynamicBehaviorsSuite,
  setupBehaviorWorkspace,
  createBehaviorDefinition,
  createScoredBehaviorRecord,
  createAgentIdentity,
  getBehaviorDefinition,
  listBehaviorDefinitions,
  getBehaviorRecords,
} from "./dynamic-behaviors-test-kit";

const getRuntime = setupDynamicBehaviorsSuite("definition_crud");

// =============================================================================
// Happy Path: Create a behavior definition (AC-001.1, AC-001.2)
// =============================================================================
describe("Happy Path: Admin creates a behavior definition (US-DB-001)", () => {
  it("definition is created with title, goal, scoring logic, and workspace scope", async () => {
    const { surreal } = getRuntime();

    // Given Elena is a workspace admin
    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-create-${crypto.randomUUID()}`,
    );

    // When Elena creates a behavior definition for "Honesty"
    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "Agents must not fabricate claims. Every factual assertion must be verifiable against graph data.",
      scoring_logic:
        "Score 0.9-1.0: All claims verifiable. " +
        "Score 0.5-0.8: Most claims verifiable. " +
        "Score 0.0-0.4: Fabricated claims.",
      telemetry_types: ["chat_response", "decision_proposal"],
      category: "integrity",
    });

    // Then the definition is persisted with all fields
    const definition = await getBehaviorDefinition(surreal, definitionId);
    expect(definition).toBeDefined();
    expect(definition!.title).toBe("Honesty");
    expect(definition!.goal).toContain("fabricate claims");
    expect(definition!.telemetry_types).toEqual(["chat_response", "decision_proposal"]);
    expect(definition!.category).toBe("integrity");
    expect(definition!.status).toBe("draft");
    expect(definition!.version).toBe(1);
    expect(definition!.enforcement_mode).toBe("warn_only");

    // And the definition is scoped to the workspace
    expect(definition!.workspace.id).toBe(workspaceId);
    expect(definition!.created_by!.id).toBe(adminId);
  }, 60_000);

  it("multiple definitions can coexist in a workspace", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-multi-${crypto.randomUUID()}`,
    );

    // When Elena creates two distinct behavior definitions
    await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "Agents must not fabricate claims.",
      scoring_logic: "Verify claims against graph data.",
      telemetry_types: ["chat_response"],
    });

    await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Evidence-Based Reasoning",
      goal: "Recommendations must cite supporting evidence from the knowledge graph.",
      scoring_logic: "Score based on citation count and accuracy.",
      telemetry_types: ["decision_proposal", "observation_creation"],
    });

    // Then both definitions exist in the workspace
    const definitions = await listBehaviorDefinitions(surreal, workspaceId);
    expect(definitions).toHaveLength(2);
    const titles = definitions.map((d) => d.title);
    expect(titles).toContain("Honesty");
    expect(titles).toContain("Evidence-Based Reasoning");
  }, 60_000);
});

// =============================================================================
// Happy Path: Status lifecycle (AC-001.3)
// =============================================================================
describe("Happy Path: Definition status lifecycle (US-DB-001)", () => {
  it("draft definition can be activated", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-activate-${crypto.randomUUID()}`,
    );

    // Given Elena has a draft definition
    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "Agents must not fabricate claims.",
      scoring_logic: "Verify all assertions.",
      telemetry_types: ["chat_response"],
      status: "draft",
    });

    // When Elena activates the definition
    const defRecord = new (await import("surrealdb")).RecordId("behavior_definition", definitionId);
    await surreal.query(`UPDATE $def SET status = 'active', updated_at = time::now();`, {
      def: defRecord,
    });

    // Then the definition status is "active"
    const definition = await getBehaviorDefinition(surreal, definitionId);
    expect(definition!.status).toBe("active");
  }, 60_000);

  it("active definition can be archived", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-archive-${crypto.randomUUID()}`,
    );

    // Given Elena has an active definition "Conciseness"
    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Conciseness",
      goal: "Agents should communicate concisely without unnecessary verbosity.",
      scoring_logic: "Score based on signal-to-noise ratio.",
      telemetry_types: ["chat_response"],
      status: "active",
    });

    // When Elena archives the definition
    const defRecord = new (await import("surrealdb")).RecordId("behavior_definition", definitionId);
    await surreal.query(`UPDATE $def SET status = 'archived', updated_at = time::now();`, {
      def: defRecord,
    });

    // Then the definition status is "archived"
    const definition = await getBehaviorDefinition(surreal, definitionId);
    expect(definition!.status).toBe("archived");
  }, 60_000);

  it("draft definition can be archived directly", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-draft-archive-${crypto.randomUUID()}`,
    );

    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Collaboration",
      goal: "Agents should coordinate with team members on shared tasks.",
      scoring_logic: "Score based on cross-agent coordination signals.",
      telemetry_types: ["chat_response"],
      status: "draft",
    });

    // When Elena archives the draft definition
    const defRecord = new (await import("surrealdb")).RecordId("behavior_definition", definitionId);
    await surreal.query(`UPDATE $def SET status = 'archived', updated_at = time::now();`, {
      def: defRecord,
    });

    // Then the definition is archived
    const definition = await getBehaviorDefinition(surreal, definitionId);
    expect(definition!.status).toBe("archived");
  }, 60_000);
});

// =============================================================================
// Happy Path: Version increment on active edit (AC-001.5)
// =============================================================================
describe("Happy Path: Editing active definition increments version (US-DB-001)", () => {
  it("updating scoring logic on active definition increments version to 2", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-version-${crypto.randomUUID()}`,
    );

    // Given Elena has an active definition at version 1
    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "Agents must not fabricate claims.",
      scoring_logic: "Verify every claim against graph data.",
      telemetry_types: ["chat_response"],
      status: "active",
      version: 1,
    });

    // When Elena updates the scoring logic
    const defRecord = new (await import("surrealdb")).RecordId("behavior_definition", definitionId);
    await surreal.query(
      `UPDATE $def SET scoring_logic = $newLogic, version = version + 1, updated_at = time::now();`,
      {
        def: defRecord,
        newLogic: "Verify key claims against graph data. Minor omissions acceptable.",
      },
    );

    // Then the version increments to 2
    const definition = await getBehaviorDefinition(surreal, definitionId);
    expect(definition!.version).toBe(2);
    expect(definition!.scoring_logic).toContain("key claims");
  }, 60_000);

  it("editing a draft definition does not increment version", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-draft-edit-${crypto.randomUUID()}`,
    );

    // Given Elena has a draft definition at version 1
    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Thoroughness",
      goal: "Agents should explore all reasonable alternatives.",
      scoring_logic: "Score based on alternatives considered.",
      telemetry_types: ["decision_proposal"],
      status: "draft",
      version: 1,
    });

    // When Elena edits the draft (no version increment)
    const defRecord = new (await import("surrealdb")).RecordId("behavior_definition", definitionId);
    await surreal.query(
      `UPDATE $def SET scoring_logic = $newLogic, updated_at = time::now();`,
      {
        def: defRecord,
        newLogic: "Score based on number and quality of alternatives explored.",
      },
    );

    // Then version remains 1
    const definition = await getBehaviorDefinition(surreal, definitionId);
    expect(definition!.version).toBe(1);
  }, 60_000);
});

// =============================================================================
// Happy Path: Deterministic scorers as definitions (AC-001, business rule 4)
// =============================================================================
describe("Happy Path: Deterministic scorers represented as behavior definitions (US-DB-001)", () => {
  it("TDD Adherence exists as a deterministic behavior definition", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-deterministic-${crypto.randomUUID()}`,
    );

    // When the workspace is seeded with a TDD definition
    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "TDD Adherence",
      goal: "Agents must write tests alongside production code.",
      scoring_logic: "Score = test_files_changed / files_changed.",
      telemetry_types: ["agent_session"],
      status: "active",
    });

    // Then the definition is active with correct telemetry types
    const definition = await getBehaviorDefinition(surreal, definitionId);
    expect(definition!.status).toBe("active");
    expect(definition!.telemetry_types).toEqual(["agent_session"]);
  }, 60_000);
});

// =============================================================================
// Happy Path: Listing and filtering (AC-001.2)
// =============================================================================
describe("Happy Path: Definitions listed and filtered by status (US-DB-001)", () => {
  it("definitions are filtered by status when requested", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-filter-${crypto.randomUUID()}`,
    );

    // Given Elena has definitions in various statuses
    await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "No fabrication.",
      scoring_logic: "Verify claims.",
      telemetry_types: ["chat_response"],
      status: "active",
    });

    await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Collaboration",
      goal: "Coordinate with team.",
      scoring_logic: "Cross-agent coordination.",
      telemetry_types: ["chat_response"],
      status: "draft",
    });

    await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Conciseness",
      goal: "Be concise.",
      scoring_logic: "Signal-to-noise ratio.",
      telemetry_types: ["chat_response"],
      status: "archived",
    });

    // When filtering by status "active"
    const active = await listBehaviorDefinitions(surreal, workspaceId, "active");
    expect(active).toHaveLength(1);
    expect(active[0].title).toBe("Honesty");

    // And filtering by "draft"
    const drafts = await listBehaviorDefinitions(surreal, workspaceId, "draft");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].title).toBe("Collaboration");

    // And listing all
    const all = await listBehaviorDefinitions(surreal, workspaceId);
    expect(all).toHaveLength(3);
  }, 60_000);
});

// =============================================================================
// Error Path: Missing required fields (AC-001.4)
// =============================================================================
describe("Error Path: Definition creation fails with missing required fields (US-DB-001)", () => {
  it.skip("creation fails when goal is missing", async () => {
    // Given Elena submits a behavior definition without a goal
    // When the creation request is processed
    // Then it fails with 400 and error "Goal is required"
  });

  it.skip("creation fails when title is missing", async () => {
    // Given Elena submits a behavior definition without a title
    // When the creation request is processed
    // Then it fails with 400 and error "Title is required"
  });

  it.skip("creation fails when telemetry_types is empty", async () => {
    // Given Elena submits a behavior definition with no telemetry types
    // When the creation request is processed
    // Then it fails with 400 and error "At least one telemetry type is required"
  });
});

// =============================================================================
// Error Path: Invalid status transitions (AC-001.3)
// =============================================================================
describe("Error Path: Invalid status transitions are rejected (US-DB-001)", () => {
  it.skip("archived definition cannot be reactivated", async () => {
    // Given Elena has an archived definition "Conciseness"
    // When she attempts to change status back to "active"
    // Then the transition is rejected with error "Cannot reactivate archived definition"
  });

  it.skip("active definition cannot return to draft", async () => {
    // Given Elena has an active definition "Honesty"
    // When she attempts to change status to "draft"
    // Then the transition is rejected with error "Cannot return active definition to draft"
  });
});

// =============================================================================
// Boundary: Workspace isolation (AC-001.2)
// =============================================================================
describe("Boundary: Definitions are workspace-scoped (US-DB-001)", () => {
  it("definitions in one workspace are not visible from another", async () => {
    const { surreal } = getRuntime();

    // Given two separate workspaces
    const { workspaceId: wsA, adminId: adminA } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-iso-a-${crypto.randomUUID()}`,
    );
    const { workspaceId: wsB } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-iso-b-${crypto.randomUUID()}`,
    );

    // And a definition exists only in workspace A
    await createBehaviorDefinition(surreal, wsA, adminA, {
      title: "Honesty",
      goal: "No fabrication.",
      scoring_logic: "Verify claims.",
      telemetry_types: ["chat_response"],
    });

    // When listing definitions in workspace B
    const defsB = await listBehaviorDefinitions(surreal, wsB);
    expect(defsB).toHaveLength(0);

    // And workspace A still has its definition
    const defsA = await listBehaviorDefinitions(surreal, wsA);
    expect(defsA).toHaveLength(1);
  }, 60_000);
});

// =============================================================================
// Boundary: Archiving preserves existing scores (AC-001.3)
// =============================================================================
describe("Boundary: Archiving a definition preserves existing behavior records (US-DB-001)", () => {
  it("behavior records referencing an archived definition remain intact", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-preserve-${crypto.randomUUID()}`,
    );

    // Given an active definition with scored behavior records
    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Conciseness",
      goal: "Be concise.",
      scoring_logic: "Signal-to-noise ratio.",
      telemetry_types: ["chat_response"],
      status: "active",
    });

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-alpha",
    );

    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Conciseness",
      score: 0.75,
      definitionId,
    });

    // When Elena archives the definition
    const defRecord = new (await import("surrealdb")).RecordId("behavior_definition", definitionId);
    await surreal.query(`UPDATE $def SET status = 'archived', updated_at = time::now();`, {
      def: defRecord,
    });

    // Then existing behavior records still reference the definition
    const records = await getBehaviorRecords(surreal, agentId, "Conciseness");
    expect(records).toHaveLength(1);
    expect(records[0].score).toBe(0.75);
    expect(records[0].definition.id).toBe(definitionId);
  }, 60_000);
});
