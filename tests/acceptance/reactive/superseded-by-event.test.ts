/**
 * Tests the DEFINE EVENT on superseded_by that automatically sets
 * decision status to "superseded" when the edge is created.
 *
 * The edge is the source of truth; status is a derived consequence.
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupReactiveSuite,
  createTestWorkspace,
  createDecision,
  supersedeDecision,
} from "./reactive-test-kit";

const getRuntime = setupReactiveSuite("superseded_by_event");

describe("superseded_by edge automatically sets decision status", () => {
  it("creating superseded_by edge sets old decision status to superseded", async () => {
    const { surreal } = getRuntime();
    const { workspaceId } = await createTestWorkspace(surreal, "supersede-auto");

    // Given two confirmed decisions
    const { decisionId: oldId } = await createDecision(surreal, workspaceId, {
      summary: "Use REST for all API endpoints",
      status: "confirmed",
    });
    const { decisionId: newId } = await createDecision(surreal, workspaceId, {
      summary: "Use tRPC for all API endpoints",
      status: "confirmed",
    });

    // Verify old decision starts as confirmed
    const beforeRows = (await surreal.query(
      `SELECT status FROM $dec;`,
      { dec: new RecordId("decision", oldId) },
    )) as Array<Array<{ status: string }>>;
    expect(beforeRows[0]?.[0]?.status).toBe("confirmed");

    // When the superseded_by edge is created
    await supersedeDecision(surreal, oldId, newId);

    // Then the old decision's status is automatically set to "superseded"
    const afterRows = (await surreal.query(
      `SELECT status FROM $dec;`,
      { dec: new RecordId("decision", oldId) },
    )) as Array<Array<{ status: string }>>;
    expect(afterRows[0]?.[0]?.status).toBe("superseded");

    // And the new decision remains confirmed
    const newRows = (await surreal.query(
      `SELECT status FROM $dec;`,
      { dec: new RecordId("decision", newId) },
    )) as Array<Array<{ status: string }>>;
    expect(newRows[0]?.[0]?.status).toBe("confirmed");
  });

  it("superseded_by edge is traversable from old decision", async () => {
    const { surreal } = getRuntime();
    const { workspaceId } = await createTestWorkspace(surreal, "supersede-traverse");

    const { decisionId: oldId } = await createDecision(surreal, workspaceId, {
      summary: "Use monolith architecture",
      status: "confirmed",
    });
    const { decisionId: newId } = await createDecision(surreal, workspaceId, {
      summary: "Use microservices architecture",
      status: "confirmed",
    });

    await supersedeDecision(surreal, oldId, newId);

    // Traverse forward: old ->superseded_by-> new
    const forwardRows = (await surreal.query(
      `SELECT ->superseded_by->decision AS replacement FROM $dec;`,
      { dec: new RecordId("decision", oldId) },
    )) as Array<Array<{ replacement: RecordId[] }>>;
    const replacements = forwardRows[0]?.[0]?.replacement ?? [];
    expect(replacements.length).toBe(1);
    expect((replacements[0] as RecordId).id).toBe(newId);

    // Traverse backward: new <-superseded_by<- old
    const backwardRows = (await surreal.query(
      `SELECT <-superseded_by<-decision AS predecessor FROM $dec;`,
      { dec: new RecordId("decision", newId) },
    )) as Array<Array<{ predecessor: RecordId[] }>>;
    const predecessors = backwardRows[0]?.[0]?.predecessor ?? [];
    expect(predecessors.length).toBe(1);
    expect((predecessors[0] as RecordId).id).toBe(oldId);
  });

  it("superseding a provisional decision also sets status to superseded", async () => {
    const { surreal } = getRuntime();
    const { workspaceId } = await createTestWorkspace(surreal, "supersede-provisional");

    // Given a provisional decision (default status from createDecision)
    const { decisionId: oldId } = await createDecision(surreal, workspaceId, {
      summary: "Maybe use Redis for caching",
    });
    const { decisionId: newId } = await createDecision(surreal, workspaceId, {
      summary: "Use Valkey for caching",
      status: "confirmed",
    });

    // Verify it starts as provisional
    const beforeRows = (await surreal.query(
      `SELECT status FROM $dec;`,
      { dec: new RecordId("decision", oldId) },
    )) as Array<Array<{ status: string }>>;
    expect(beforeRows[0]?.[0]?.status).toBe("provisional");

    // When superseded
    await supersedeDecision(surreal, oldId, newId);

    // Then status changes to superseded regardless of prior status
    const afterRows = (await surreal.query(
      `SELECT status FROM $dec;`,
      { dec: new RecordId("decision", oldId) },
    )) as Array<Array<{ status: string }>>;
    expect(afterRows[0]?.[0]?.status).toBe("superseded");
  });
});
