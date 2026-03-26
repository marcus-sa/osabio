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
import { describe, expect, it } from "bun:test";
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
  // ---------------------------------------------------------------------------
  // AC: Subscriptions created per workspace for governance tables
  // AC: Events filtered application-side by workspace
  // ---------------------------------------------------------------------------
  it("receives events for the correct workspace when a decision is created", async () => {
    const { surreal } = getRuntime();

    const { workspaceId: targetWorkspaceId } = await createTestWorkspace(surreal, "lsm-target");
    const { workspaceId: otherWorkspaceId } = await createTestWorkspace(surreal, "lsm-other");

    const receivedEvents: LiveSelectEvent[] = [];
    const handleEvent = (event: LiveSelectEvent) => {
      receivedEvents.push(event);
    };

    const manager = createLiveSelectManager({ surreal });
    try {
      manager.onEvent(targetWorkspaceId, handleEvent);
      await manager.start();

      await new Promise((resolve) => setTimeout(resolve, 500));

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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      expect(receivedEvents.length).toBeGreaterThanOrEqual(1);

      const targetEvents = receivedEvents.filter(
        (e) => e.table === "decision" && e.action === "CREATE",
      );
      expect(targetEvents.length).toBe(1);
      expect(targetEvents[0].recordId).toContain(targetDecisionId);
    } finally {
      await manager.stop();
    }
  }, 15_000);

  // ---------------------------------------------------------------------------
  // AC: Subscriptions for all governance tables (not just decision)
  // ---------------------------------------------------------------------------
  it("receives events from multiple governance tables", async () => {
    const { surreal } = getRuntime();

    const { workspaceId } = await createTestWorkspace(surreal, "lsm-multi");

    const receivedEvents: LiveSelectEvent[] = [];
    const manager = createLiveSelectManager({ surreal });
    try {
      manager.onEvent(workspaceId, (event) => receivedEvents.push(event));
      await manager.start();

      await new Promise((resolve) => setTimeout(resolve, 500));

      const workspaceRecord = new RecordId("workspace", workspaceId);

      await surreal.query(`CREATE $rec CONTENT $content;`, {
        rec: new RecordId("task", crypto.randomUUID()),
        content: {
          title: "Implement rate limiting",
          status: "open",
          workspace: workspaceRecord,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      await surreal.query(`CREATE $rec CONTENT $content;`, {
        rec: new RecordId("observation", crypto.randomUUID()),
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
    } finally {
      await manager.stop();
    }
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

    const manager = createLiveSelectManager({ surreal, logger: testLogger });
    try {
      await manager.start();

      await new Promise((resolve) => setTimeout(resolve, 500));

      const startLogs = logEntries.filter(
        (e) => e.level === "info" && e.message.includes("subscribed"),
      );
      expect(startLogs.length).toBeGreaterThanOrEqual(1);

      await manager.stop();

      const stopLogs = logEntries.filter(
        (e) => e.level === "info" && e.message.includes("stopped"),
      );
      expect(stopLogs.length).toBeGreaterThanOrEqual(1);
    } finally {
      // stop() is idempotent -- safe to call again if already stopped
      await manager.stop().catch(() => {});
    }
  }, 15_000);
});
