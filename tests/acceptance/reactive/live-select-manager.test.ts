/**
 * Live Select Manager: Acceptance Tests
 *
 * Step: 01-03 (graph-reactive-coordination)
 *
 * Proves:
 * - LIVE SELECT subscriptions are created for governance tables
 * - Events are received when records are created/updated in subscribed tables
 * - Events are filtered application-side by workspace
 * - Subscription start/stop is logged for observability
 *
 * Driving ports:
 *   SurrealDB direct queries (graph writes trigger LIVE SELECT)
 *   LiveSelectManager.start() / stop() (subscription lifecycle)
 */
import { describe, expect, it, afterEach } from "bun:test";
import { RecordId, Table } from "surrealdb";
import {
  setupReactiveSuite,
  createTestWorkspace,
} from "./reactive-test-kit";
import {
  createLiveSelectManager,
  type LiveSelectEvent,
  type LiveSelectManager,
} from "../../../app/src/server/reactive/live-select-manager";

const getRuntime = setupReactiveSuite("live_select_manager");

describe("Live Select Manager: subscribe to governance tables and route events", () => {
  let manager: LiveSelectManager | undefined;

  afterEach(async () => {
    if (manager) {
      await manager.stop();
      manager = undefined;
    }
  });

  // ---------------------------------------------------------------------------
  // AC: Subscriptions created per workspace for governance tables
  // AC: Events filtered application-side by workspace
  // ---------------------------------------------------------------------------
  it("receives events for the correct workspace when a decision is created", async () => {
    const { surreal } = getRuntime();

    // Given two workspaces
    const { workspaceId: targetWorkspaceId } = await createTestWorkspace(surreal, "lsm-target");
    const { workspaceId: otherWorkspaceId } = await createTestWorkspace(surreal, "lsm-other");

    // And a Live Select Manager subscribed to governance tables
    const receivedEvents: LiveSelectEvent[] = [];
    const handleEvent = (event: LiveSelectEvent) => {
      receivedEvents.push(event);
    };

    manager = createLiveSelectManager({ surreal });
    manager.onEvent(targetWorkspaceId, handleEvent);
    await manager.start();

    // Allow subscriptions to establish
    await new Promise((resolve) => setTimeout(resolve, 500));

    // When a decision is created in the target workspace
    const targetDecisionId = `dec-${crypto.randomUUID()}`;
    await surreal.query(`CREATE $rec CONTENT $content;`, {
      rec: new RecordId("decision", targetDecisionId),
      content: {
        summary: "Use tRPC for all APIs",
        status: "provisional",
        workspace: new RecordId("workspace", targetWorkspaceId),
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    // And a decision is created in the other workspace (should be filtered out)
    const otherDecisionId = `dec-${crypto.randomUUID()}`;
    await surreal.query(`CREATE $rec CONTENT $content;`, {
      rec: new RecordId("decision", otherDecisionId),
      content: {
        summary: "Use REST for all APIs",
        status: "provisional",
        workspace: new RecordId("workspace", otherWorkspaceId),
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    // Then within a few seconds, only the target workspace event is received
    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(receivedEvents.length).toBeGreaterThanOrEqual(1);

    const targetEvents = receivedEvents.filter(
      (e) => e.table === "decision" && e.action === "CREATE",
    );
    expect(targetEvents.length).toBe(1);
    expect(targetEvents[0].recordId).toContain(targetDecisionId);
  }, 15_000);

  // ---------------------------------------------------------------------------
  // AC: Subscriptions for all governance tables (not just decision)
  // ---------------------------------------------------------------------------
  it("receives events from multiple governance tables", async () => {
    const { surreal } = getRuntime();

    const { workspaceId } = await createTestWorkspace(surreal, "lsm-multi");

    const receivedEvents: LiveSelectEvent[] = [];
    manager = createLiveSelectManager({ surreal });
    manager.onEvent(workspaceId, (event) => receivedEvents.push(event));
    await manager.start();

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Create records in different governance tables
    const workspaceRecord = new RecordId("workspace", workspaceId);

    await surreal.query(`CREATE $rec CONTENT $content;`, {
      rec: new RecordId("task", `task-${crypto.randomUUID()}`),
      content: {
        title: "Implement rate limiting",
        status: "open",
        workspace: workspaceRecord,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    await surreal.query(`CREATE $rec CONTENT $content;`, {
      rec: new RecordId("observation", `obs-${crypto.randomUUID()}`),
      content: {
        text: "Schema drift detected",
        severity: "warning",
        status: "open",
        source_agent: "observer_agent",
        workspace: workspaceRecord,
        created_at: new Date(),
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const tables = new Set(receivedEvents.map((e) => e.table));
    expect(tables.has("task")).toBe(true);
    expect(tables.has("observation")).toBe(true);
  }, 15_000);

  // ---------------------------------------------------------------------------
  // AC: Subscription start/stop logged for observability
  // ---------------------------------------------------------------------------
  it("logs subscription lifecycle for observability", async () => {
    const { surreal } = getRuntime();

    const logEntries: Array<{ level: string; message: string }> = [];
    const testLogger = {
      info: (message: string) => logEntries.push({ level: "info", message }),
      warn: (message: string) => logEntries.push({ level: "warn", message }),
      error: (message: string) => logEntries.push({ level: "error", message }),
    };

    manager = createLiveSelectManager({ surreal, logger: testLogger });
    await manager.start();

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Should have logged subscription starts
    const startLogs = logEntries.filter(
      (e) => e.level === "info" && e.message.includes("subscribed"),
    );
    expect(startLogs.length).toBeGreaterThanOrEqual(1);

    // Stop the manager
    await manager.stop();

    // Should have logged subscription stops
    const stopLogs = logEntries.filter(
      (e) => e.level === "info" && e.message.includes("stopped"),
    );
    expect(stopLogs.length).toBeGreaterThanOrEqual(1);

    manager = undefined; // already stopped
  }, 15_000);
});
