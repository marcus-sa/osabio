/**
 * Milestone 1: Schema Migration and Model Configuration
 *
 * Traces: Roadmap Phase 01 (01-01, 01-02, 01-03)
 *   - US-5 (AC-4.1, AC-4.2, AC-4.3): Model configuration
 *   - R5: Structured output schemas
 *   - R7: Model configuration
 *
 * Validates that:
 * - New observation fields (confidence, evidence_refs) persist correctly
 * - Workspace settings.observer_skip_deterministic field persists
 * - Schema migration applies cleanly
 *
 * Driving ports:
 *   SurrealDB direct queries (schema validation)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupObserverSuite,
  setupObserverWorkspace,
  setWorkspaceObserverSkip,
} from "./llm-reasoning-test-kit";

const getRuntime = setupObserverSuite("observer_llm_m1_schema");

// =============================================================================
// Phase 01-02: Schema Migration — observation confidence + evidence_refs
// =============================================================================

describe("Milestone 1: Observation LLM Fields (Phase 01-02)", () => {
  // ---------------------------------------------------------------------------
  // confidence field persists as optional float
  // ---------------------------------------------------------------------------
  it("observation confidence field persists when provided", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "schema-conf");
    const wsRecord = new RecordId("workspace", workspaceId);

    const obsId = crypto.randomUUID();
    const obsRecord = new RecordId("observation", obsId);

    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: obsRecord,
      content: {
        text: "LLM verdict: task aligns with decision",
        severity: "info",
        status: "open",
        source_agent: "observer_agent",
        source: "llm",
        confidence: 0.87,
        workspace: wsRecord,
        created_at: new Date(),
      },
    });

    const rows = (await surreal.query(
      `SELECT confidence FROM $obs;`,
      { obs: obsRecord },
    )) as Array<Array<{ confidence: number }>>;

    expect(rows[0]?.[0]?.confidence).toBe(0.87);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // confidence field absent when not provided (optional)
  // ---------------------------------------------------------------------------
  it("observation confidence field is absent when not provided", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "schema-noconf");
    const wsRecord = new RecordId("workspace", workspaceId);

    const obsId = crypto.randomUUID();
    const obsRecord = new RecordId("observation", obsId);

    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: obsRecord,
      content: {
        text: "Deterministic verification passed",
        severity: "info",
        status: "open",
        source_agent: "observer_agent",
        workspace: wsRecord,
        created_at: new Date(),
      },
    });

    const rows = (await surreal.query(
      `SELECT confidence FROM $obs;`,
      { obs: obsRecord },
    )) as Array<Array<{ confidence?: number }>>;

    expect(rows[0]?.[0]?.confidence).toBeUndefined();
  }, 30_000);

  // ---------------------------------------------------------------------------
  // evidence_refs field persists as optional array of records
  // ---------------------------------------------------------------------------
  it("observation evidence_refs field persists record references", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "schema-evrefs");
    const wsRecord = new RecordId("workspace", workspaceId);

    // Create referenced entities first
    const taskId = crypto.randomUUID();
    const taskRecord = new RecordId("task", taskId);
    await surreal.query(`CREATE $task CONTENT $content;`, {
      task: taskRecord,
      content: {
        title: "Referenced task",
        status: "completed",
        workspace: wsRecord,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    const decId = `dec-${crypto.randomUUID()}`;
    const decRecord = new RecordId("decision", decId);
    await surreal.query(`CREATE $dec CONTENT $content;`, {
      dec: decRecord,
      content: {
        summary: "Referenced decision",
        status: "confirmed",
        workspace: wsRecord,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    const obsId = crypto.randomUUID();
    const obsRecord = new RecordId("observation", obsId);

    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: obsRecord,
      content: {
        text: "LLM found contradiction between task and decision",
        severity: "conflict",
        status: "open",
        source_agent: "observer_agent",
        source: "llm",
        confidence: 0.92,
        evidence_refs: [taskRecord, decRecord],
        workspace: wsRecord,
        created_at: new Date(),
      },
    });

    const rows = (await surreal.query(
      `SELECT evidence_refs FROM $obs;`,
      { obs: obsRecord },
    )) as Array<Array<{ evidence_refs: RecordId[] }>>;

    const refs = rows[0]?.[0]?.evidence_refs;
    expect(refs).toBeDefined();
    expect(refs).toHaveLength(2);
  }, 30_000);
});

// =============================================================================
// Phase 01-01: Workspace settings for observer skip optimization
// =============================================================================

describe("Milestone 1: Workspace Observer Settings (Phase 01-01)", () => {
  // ---------------------------------------------------------------------------
  // settings.observer_skip_deterministic persists as optional bool
  // ---------------------------------------------------------------------------
  it("workspace settings.observer_skip_deterministic persists", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "settings-skip");

    // When skip optimization is explicitly set to false
    await setWorkspaceObserverSkip(surreal, workspaceId, false);

    // Then the setting persists
    const wsRecord = new RecordId("workspace", workspaceId);
    const rows = (await surreal.query(
      `SELECT settings FROM $ws;`,
      { ws: wsRecord },
    )) as Array<Array<{ settings: { observer_skip_deterministic: boolean } }>>;

    expect(rows[0]?.[0]?.settings?.observer_skip_deterministic).toBe(false);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // settings.observer_skip_deterministic can be set to true
  // ---------------------------------------------------------------------------
  it("workspace settings.observer_skip_deterministic can be set to true", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "settings-skip-true");

    await setWorkspaceObserverSkip(surreal, workspaceId, true);

    const wsRecord = new RecordId("workspace", workspaceId);
    const rows = (await surreal.query(
      `SELECT settings FROM $ws;`,
      { ws: wsRecord },
    )) as Array<Array<{ settings: { observer_skip_deterministic: boolean } }>>;

    expect(rows[0]?.[0]?.settings?.observer_skip_deterministic).toBe(true);
  }, 30_000);
});
