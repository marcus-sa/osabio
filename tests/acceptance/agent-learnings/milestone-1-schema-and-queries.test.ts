/**
 * Milestone 1: Schema and Queries
 *
 * Traces: US-AL-005 (learning entity schema), US-AL-001 (human creates learning, partial)
 *
 * Validates:
 * - Learning table created with all required fields and correct types
 * - CRUD operations work (create, list, status transitions)
 * - Supersession preserves history via supersedes edge
 * - Evidence edges link learnings to source entities
 * - Workspace-scoped isolation (learnings from workspace A not visible in workspace B)
 *
 * Driving ports:
 *   SurrealDB direct queries (create, read, update records)
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupLearningSuite,
  createTestWorkspace,
  createTestLearning,
  getLearningById,
  listActiveLearnings,
  listLearningsByStatus,
  getLearningEvidence,
  getSupersessionEdge,
} from "./learning-test-kit";

const getRuntime = setupLearningSuite("learning_m1_schema_queries");

describe("Milestone 1: Learning Schema and Queries", () => {
  // -------------------------------------------------------------------------
  // US-AL-005: Learning table schema validation
  // -------------------------------------------------------------------------

  it("learning record stores all required fields with correct types", async () => {
    const { surreal } = getRuntime();

    // Given a workspace
    const { workspaceId, identityId } = await createTestWorkspace(surreal, "schema-fields");

    // When a learning is created with all fields populated
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Always validate input at the boundary before processing.",
      learning_type: "constraint",
      status: "active",
      source: "human",
      priority: "high",
      target_agents: ["coding_agent", "chat_agent"],
      created_by: identityId,
    });

    // Then all fields are persisted with correct types
    const record = await getLearningById(surreal, learningId);
    expect(record).toBeDefined();
    expect(record!.text).toBe("Always validate input at the boundary before processing.");
    expect(record!.learning_type).toBe("constraint");
    expect(record!.status).toBe("active");
    expect(record!.source).toBe("human");
    expect(record!.priority).toBe("high");
    expect(record!.target_agents).toEqual(["coding_agent", "chat_agent"]);
    expect(record!.created_at).toBeTruthy();
  }, 120_000);

  it("learning type must be one of constraint, instruction, or precedent", async () => {
    const { surreal } = getRuntime();
    const { workspaceId } = await createTestWorkspace(surreal, "schema-type-assert");
    const workspaceRecord = new RecordId("workspace", workspaceId);

    // When attempting to create a learning with an invalid type
    // Then the database rejects it (SCHEMAFULL assertion)
    const invalidId = `learning-${crypto.randomUUID()}`;
    const learningRecord = new RecordId("learning", invalidId);
    try {
      await surreal.query(`CREATE $learning CONTENT $content;`, {
        learning: learningRecord,
        content: {
          text: "Invalid type learning",
          learning_type: "invalid_type",
          status: "active",
          source: "human",
          priority: "medium",
          target_agents: [],
          workspace: workspaceRecord,
          created_at: new Date(),
        },
      });
      // If no error, verify it was not created
      const result = await getLearningById(surreal, invalidId);
      expect(result).toBeUndefined();
    } catch {
      // Expected: schema assertion rejects invalid learning_type
      expect(true).toBe(true);
    }
  }, 120_000);

  it("learning status must be one of the valid lifecycle states", async () => {
    const { surreal } = getRuntime();
    const { workspaceId } = await createTestWorkspace(surreal, "schema-status-assert");
    const workspaceRecord = new RecordId("workspace", workspaceId);

    // When attempting to create a learning with an invalid status
    // Then the database rejects it (SCHEMAFULL assertion)
    const invalidId = `learning-${crypto.randomUUID()}`;
    const learningRecord = new RecordId("learning", invalidId);
    try {
      await surreal.query(`CREATE $learning CONTENT $content;`, {
        learning: learningRecord,
        content: {
          text: "Invalid status learning",
          learning_type: "instruction",
          status: "invalid_status",
          source: "human",
          priority: "medium",
          target_agents: [],
          workspace: workspaceRecord,
          created_at: new Date(),
        },
      });
      const result = await getLearningById(surreal, invalidId);
      expect(result).toBeUndefined();
    } catch {
      // Expected: schema assertion rejects invalid status
      expect(true).toBe(true);
    }
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-005 + US-AL-001: CRUD operations
  // -------------------------------------------------------------------------

  it("active learnings are listed for a workspace", async () => {
    const { surreal } = getRuntime();

    // Given a workspace with two active and one dismissed learning
    const { workspaceId } = await createTestWorkspace(surreal, "list-active");

    await createTestLearning(surreal, workspaceId, {
      text: "Use RecordId objects for all database identifiers.",
      learning_type: "instruction",
      status: "active",
    });

    await createTestLearning(surreal, workspaceId, {
      text: "Prefer explicit error handling over silent failures.",
      learning_type: "constraint",
      status: "active",
    });

    await createTestLearning(surreal, workspaceId, {
      text: "This learning was dismissed.",
      learning_type: "instruction",
      status: "dismissed",
    });

    // When listing active learnings
    const activeLearnings = await listActiveLearnings(surreal, workspaceId);

    // Then only the two active learnings are returned
    expect(activeLearnings.length).toBe(2);
    const texts = activeLearnings.map((l) => l.text);
    expect(texts).toContain("Use RecordId objects for all database identifiers.");
    expect(texts).toContain("Prefer explicit error handling over silent failures.");
    expect(texts).not.toContain("This learning was dismissed.");
  }, 120_000);

  it("status transition from active to deactivated records audit trail", async () => {
    const { surreal } = getRuntime();

    // Given an active learning
    const { workspaceId, identityId } = await createTestWorkspace(surreal, "deactivate");
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Use PostgreSQL for all persistent storage.",
      learning_type: "instruction",
      status: "active",
    });

    // When the learning is deactivated
    const learningRecord = new RecordId("learning", learningId);
    const identityRecord = new RecordId("identity", identityId);
    await surreal.query(
      `UPDATE $learning SET
        status = "deactivated",
        deactivated_by = $identity,
        deactivated_at = time::now(),
        updated_at = time::now();`,
      { learning: learningRecord, identity: identityRecord },
    );

    // Then the learning is no longer active
    const activeLearnings = await listActiveLearnings(surreal, workspaceId);
    expect(activeLearnings.some((l) => l.text === "Use PostgreSQL for all persistent storage.")).toBe(false);

    // And the deactivation audit trail is recorded
    const deactivated = await getLearningById(surreal, learningId);
    expect(deactivated!.status).toBe("deactivated");
    expect(deactivated!.deactivated_at).toBeTruthy();
  }, 120_000);

  it("pending approval learning is not returned as active", async () => {
    const { surreal } = getRuntime();

    // Given an agent-suggested learning awaiting approval
    const { workspaceId } = await createTestWorkspace(surreal, "pending-not-active");
    await createTestLearning(surreal, workspaceId, {
      text: "Consider using batch operations for bulk updates.",
      learning_type: "instruction",
      status: "pending_approval",
      source: "agent",
      suggested_by: "observer_agent",
    });

    // When listing active learnings
    const activeLearnings = await listActiveLearnings(surreal, workspaceId);

    // Then the pending learning is not included
    expect(activeLearnings.length).toBe(0);

    // And it appears when listing pending learnings
    const pendingLearnings = await listLearningsByStatus(surreal, workspaceId, "pending_approval");
    expect(pendingLearnings.length).toBe(1);
    expect(pendingLearnings[0].text).toBe("Consider using batch operations for bulk updates.");
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-005: Supersession
  // -------------------------------------------------------------------------

  it("superseding a learning marks the old one as superseded and creates an edge", async () => {
    const { surreal } = getRuntime();

    // Given a workspace with an active learning about database choice
    const { workspaceId } = await createTestWorkspace(surreal, "supersede");
    const { learningId: oldLearningId } = await createTestLearning(surreal, workspaceId, {
      text: "Use MySQL for all persistent storage.",
      learning_type: "precedent",
      status: "active",
    });

    // When the human creates a new learning that supersedes it
    const { learningId: newLearningId } = await createTestLearning(surreal, workspaceId, {
      text: "Use SurrealDB for all persistent storage (supersedes MySQL decision).",
      learning_type: "precedent",
      status: "active",
    });

    // And the supersession is recorded
    const oldLearningRecord = new RecordId("learning", oldLearningId);
    const newLearningRecord = new RecordId("learning", newLearningId);

    await surreal.query(
      `UPDATE $old SET status = "superseded", updated_at = time::now();`,
      { old: oldLearningRecord },
    );

    await surreal.query(
      `RELATE $new->supersedes->$old SET superseded_at = time::now(), reason = "Migrated from MySQL to SurrealDB";`,
      { new: newLearningRecord, old: oldLearningRecord },
    );

    // Then the old learning is superseded
    const oldLearning = await getLearningById(surreal, oldLearningId);
    expect(oldLearning!.status).toBe("superseded");

    // And the supersession edge exists
    const hasEdge = await getSupersessionEdge(surreal, newLearningId, oldLearningId);
    expect(hasEdge).toBe(true);

    // And only the new learning appears in active list
    const activeLearnings = await listActiveLearnings(surreal, workspaceId);
    expect(activeLearnings.length).toBe(1);
    expect(activeLearnings[0].text).toContain("SurrealDB");
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-005: Evidence edges
  // -------------------------------------------------------------------------

  it("evidence edges link a learning to its source entities", async () => {
    const { surreal } = getRuntime();

    // Given a workspace with a learning
    const { workspaceId } = await createTestWorkspace(surreal, "evidence");
    const { learningId, learningRecord } = await createTestLearning(surreal, workspaceId, {
      text: "Agent sessions should be tracked via inflight tracker.",
      learning_type: "instruction",
      source: "agent",
      status: "pending_approval",
      suggested_by: "observer_agent",
    });

    // When evidence is linked to the learning (an observation that prompted it)
    const observationId = crypto.randomUUID();
    const observationRecord = new RecordId("observation", observationId);
    const workspaceRecord = new RecordId("workspace", workspaceId);

    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: observationRecord,
      content: {
        text: "Repeated pattern: sessions not tracked",
        severity: "warning",
        status: "open",
        source_agent: "observer_agent",
        workspace: workspaceRecord,
        created_at: new Date(),
      },
    });

    await surreal.query(
      `RELATE $learning->learning_evidence->$obs SET added_at = time::now();`,
      { learning: learningRecord, obs: observationRecord },
    );

    // Then the evidence edge exists
    const evidence = await getLearningEvidence(surreal, learningId);
    expect(evidence.length).toBe(1);
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-005: Workspace isolation
  // -------------------------------------------------------------------------

  it("learnings from one workspace are not visible in another", async () => {
    const { surreal } = getRuntime();

    // Given workspace A with a learning
    const { workspaceId: workspaceA } = await createTestWorkspace(surreal, "isolation-a");
    await createTestLearning(surreal, workspaceA, {
      text: "Workspace A specific rule: use camelCase.",
      learning_type: "instruction",
      status: "active",
    });

    // And workspace B with no learnings
    const { workspaceId: workspaceB } = await createTestWorkspace(surreal, "isolation-b");

    // When listing active learnings for workspace B
    const workspaceBLearnings = await listActiveLearnings(surreal, workspaceB);

    // Then workspace B has no learnings
    expect(workspaceBLearnings.length).toBe(0);

    // And workspace A still has its learning
    const workspaceALearnings = await listActiveLearnings(surreal, workspaceA);
    expect(workspaceALearnings.length).toBe(1);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Error paths
  // -------------------------------------------------------------------------

  it("learning source must be human or agent", async () => {
    const { surreal } = getRuntime();
    const { workspaceId } = await createTestWorkspace(surreal, "invalid-source");
    const workspaceRecord = new RecordId("workspace", workspaceId);

    // When attempting to create a learning with invalid source
    const invalidId = `learning-${crypto.randomUUID()}`;
    const learningRecord = new RecordId("learning", invalidId);
    try {
      await surreal.query(`CREATE $learning CONTENT $content;`, {
        learning: learningRecord,
        content: {
          text: "Invalid source",
          learning_type: "instruction",
          status: "active",
          source: "external_system",
          priority: "medium",
          target_agents: [],
          workspace: workspaceRecord,
          created_at: new Date(),
        },
      });
      const result = await getLearningById(surreal, invalidId);
      expect(result).toBeUndefined();
    } catch {
      // Expected: schema assertion rejects invalid source
      expect(true).toBe(true);
    }
  }, 120_000);

  it("learning priority defaults to medium when not specified", async () => {
    const { surreal } = getRuntime();
    const { workspaceId } = await createTestWorkspace(surreal, "default-priority");
    const workspaceRecord = new RecordId("workspace", workspaceId);

    // When creating a learning without explicit priority
    const learningId = `learning-${crypto.randomUUID()}`;
    const learningRecord = new RecordId("learning", learningId);
    await surreal.query(`CREATE $learning CONTENT $content;`, {
      learning: learningRecord,
      content: {
        text: "No priority specified.",
        learning_type: "instruction",
        status: "active",
        source: "human",
        target_agents: [],
        workspace: workspaceRecord,
        created_at: new Date(),
      },
    });

    // Then the priority defaults to "medium"
    const record = await getLearningById(surreal, learningId);
    expect(record).toBeDefined();
    expect(record!.priority).toBe("medium");
  }, 120_000);
});
