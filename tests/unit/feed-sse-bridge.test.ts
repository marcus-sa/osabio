/**
 * Feed SSE Bridge — Pure Function Unit Tests
 *
 * Tests the pure transform layer that converts LiveSelectEvents into
 * GovernanceFeedItem-shaped SSE events with tier assignment, batching,
 * and monotonic event IDs.
 *
 * Behaviors tested:
 *   1. Event-to-feed-item transform (LiveSelectEvent -> FeedItem shape)
 *   2. Tier assignment rules (blocking / review / awareness)
 *   3. Batching within 500ms window
 *   4. Monotonic event ID assignment
 *   5. Removal tracking for tier transitions
 */
import { describe, expect, it } from "bun:test";
import {
  transformToFeedItem,
  assignTier,
  createBatcher,
  createEventIdCounter,
  classifyTierTransition,
  type FeedBridgeItem,
} from "../../app/src/server/reactive/feed-sse-bridge";
import type { LiveSelectEvent } from "../../app/src/server/reactive/live-select-manager";

// ---------------------------------------------------------------------------
// 1. Event-to-feed-item transform
// ---------------------------------------------------------------------------

describe("transformToFeedItem", () => {
  it("transforms a decision CREATE event into a feed item", () => {
    const event: LiveSelectEvent = {
      table: "decision",
      action: "CREATE",
      recordId: "decision:dec-abc-123",
      value: {
        summary: "Use event sourcing for audit trail",
        status: "provisional",
        workspace: "workspace:ws-1",
        created_at: "2026-03-17T10:00:00Z",
      },
    };

    const item = transformToFeedItem(event);

    expect(item).toBeDefined();
    expect(item!.entityKind).toBe("decision");
    expect(item!.entityName).toBe("Use event sourcing for audit trail");
    expect(item!.status).toBe("provisional");
    expect(item!.entityId).toBe("decision:dec-abc-123");
  });

  it("transforms a task UPDATE event into a feed item", () => {
    const event: LiveSelectEvent = {
      table: "task",
      action: "UPDATE",
      recordId: "task:task-xyz",
      value: {
        title: "Implement rate limiter",
        status: "blocked",
        workspace: "workspace:ws-1",
        created_at: "2026-03-17T10:00:00Z",
      },
    };

    const item = transformToFeedItem(event);

    expect(item).toBeDefined();
    expect(item!.entityKind).toBe("task");
    expect(item!.entityName).toBe("Implement rate limiter");
    expect(item!.status).toBe("blocked");
  });

  it("transforms an observation CREATE event into a feed item", () => {
    const event: LiveSelectEvent = {
      table: "observation",
      action: "CREATE",
      recordId: "observation:obs-1",
      value: {
        text: "Schema drift detected",
        severity: "warning",
        status: "open",
        source_agent: "observer_agent",
        workspace: "workspace:ws-1",
        created_at: "2026-03-17T10:00:00Z",
      },
    };

    const item = transformToFeedItem(event);

    expect(item).toBeDefined();
    expect(item!.entityKind).toBe("observation");
    expect(item!.entityName).toBe("Schema drift detected");
    expect(item!.severity).toBe("warning");
  });

  it("transforms a question CREATE event into a feed item", () => {
    const event: LiveSelectEvent = {
      table: "question",
      action: "CREATE",
      recordId: "question:q-1",
      value: {
        text: "Should we use PostgreSQL or MongoDB?",
        status: "open",
        priority: "high",
        workspace: "workspace:ws-1",
        created_at: "2026-03-17T10:00:00Z",
      },
    };

    const item = transformToFeedItem(event);

    expect(item).toBeDefined();
    expect(item!.entityKind).toBe("question");
    expect(item!.entityName).toBe("Should we use PostgreSQL or MongoDB?");
  });

  it("returns undefined for DELETE events", () => {
    const event: LiveSelectEvent = {
      table: "decision",
      action: "DELETE",
      recordId: "decision:dec-1",
      value: {},
    };

    const item = transformToFeedItem(event);
    expect(item).toBeUndefined();
  });

  it("transforms a suggestion CREATE event", () => {
    const event: LiveSelectEvent = {
      table: "suggestion",
      action: "CREATE",
      recordId: "suggestion:sug-1",
      value: {
        text: "Consider adding rate limiting",
        category: "optimization",
        status: "pending",
        suggested_by: "pm_agent",
        confidence: 0.85,
        workspace: "workspace:ws-1",
        created_at: "2026-03-17T10:00:00Z",
      },
    };

    const item = transformToFeedItem(event);

    expect(item).toBeDefined();
    expect(item!.entityKind).toBe("suggestion");
    expect(item!.entityName).toBe("Consider adding rate limiting");
  });

  it("transforms a learning CREATE event", () => {
    const event: LiveSelectEvent = {
      table: "learning",
      action: "CREATE",
      recordId: "learning:learn-1",
      value: {
        text: "Always validate input at boundaries",
        status: "pending_approval",
        source: "agent",
        suggested_by: "observer_agent",
        workspace: "workspace:ws-1",
        created_at: "2026-03-17T10:00:00Z",
      },
    };

    const item = transformToFeedItem(event);

    expect(item).toBeDefined();
    expect(item!.entityKind).toBe("learning");
    expect(item!.entityName).toBe("Always validate input at boundaries");
  });
});

// ---------------------------------------------------------------------------
// 2. Tier assignment rules
// ---------------------------------------------------------------------------

describe("assignTier", () => {
  // Blocking tier: provisional decisions, open questions
  it("assigns blocking tier to provisional decisions", () => {
    expect(assignTier("decision", "provisional", undefined)).toBe("blocking");
  });

  it("assigns blocking tier to proposed decisions", () => {
    expect(assignTier("decision", "proposed", undefined)).toBe("blocking");
  });

  it("assigns blocking tier to extracted decisions", () => {
    expect(assignTier("decision", "extracted", undefined)).toBe("blocking");
  });

  it("assigns blocking tier to open questions", () => {
    expect(assignTier("question", "open", undefined)).toBe("blocking");
  });

  // Review tier: warning/conflict observations, blocked tasks, pending learnings
  it("assigns review tier to warning observations", () => {
    expect(assignTier("observation", "open", "warning")).toBe("review");
  });

  it("assigns review tier to conflict observations", () => {
    expect(assignTier("observation", "open", "conflict")).toBe("review");
  });

  it("assigns review tier to blocked tasks", () => {
    expect(assignTier("task", "blocked", undefined)).toBe("review");
  });

  it("assigns review tier to pending learnings", () => {
    expect(assignTier("learning", "pending_approval", undefined)).toBe("review");
  });

  it("assigns review tier to pending suggestions", () => {
    expect(assignTier("suggestion", "pending", undefined)).toBe("review");
  });

  // Awareness tier: everything else
  it("assigns awareness tier to confirmed decisions", () => {
    expect(assignTier("decision", "confirmed", undefined)).toBe("awareness");
  });

  it("assigns awareness tier to completed tasks", () => {
    expect(assignTier("task", "completed", undefined)).toBe("awareness");
  });

  it("assigns awareness tier to done tasks", () => {
    expect(assignTier("task", "done", undefined)).toBe("awareness");
  });

  it("assigns awareness tier to info observations", () => {
    expect(assignTier("observation", "open", "info")).toBe("awareness");
  });

  it("assigns awareness tier to resolved observations", () => {
    expect(assignTier("observation", "resolved", "warning")).toBe("awareness");
  });

  it("assigns awareness tier to agent sessions", () => {
    expect(assignTier("agent_session", "active", undefined)).toBe("awareness");
  });
});

// ---------------------------------------------------------------------------
// 3. Tier transition classification (removals)
// ---------------------------------------------------------------------------

describe("classifyTierTransition", () => {
  it("detects removal when decision moves from provisional to confirmed", () => {
    const result = classifyTierTransition("decision", "provisional", "confirmed");
    expect(result.previousTier).toBe("blocking");
    expect(result.newTier).toBe("awareness");
    expect(result.isTransition).toBe(true);
  });

  it("detects removal when task moves from blocked to in_progress", () => {
    const result = classifyTierTransition("task", "blocked", "in_progress");
    expect(result.previousTier).toBe("review");
    expect(result.newTier).toBe("awareness");
    expect(result.isTransition).toBe(true);
  });

  it("reports no transition for same-tier status change", () => {
    const result = classifyTierTransition("task", "open", "in_progress");
    expect(result.isTransition).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Monotonic event ID counter
// ---------------------------------------------------------------------------

describe("createEventIdCounter", () => {
  it("returns monotonically increasing IDs", () => {
    const nextId = createEventIdCounter();

    const id1 = nextId();
    const id2 = nextId();
    const id3 = nextId();

    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(id3).toBe(3);
  });

  it("starts from a custom initial value", () => {
    const nextId = createEventIdCounter(100);

    expect(nextId()).toBe(101);
    expect(nextId()).toBe(102);
  });
});

// ---------------------------------------------------------------------------
// 5. Batching within 500ms window
// ---------------------------------------------------------------------------

describe("createBatcher", () => {
  it("batches multiple items within the window into a single emission", async () => {
    const emitted: Array<{ items: FeedBridgeItem[]; removals: string[] }> = [];
    const batcher = createBatcher({
      windowMs: 100, // shorter for testing
      onFlush: (items, removals) => {
        emitted.push({ items: [...items], removals: [...removals] });
      },
    });

    const item1: FeedBridgeItem = {
      id: "decision:d1:provisional",
      tier: "blocking",
      entityId: "decision:d1",
      entityKind: "decision",
      entityName: "Test decision 1",
      reason: "Provisional decision",
      status: "provisional",
      createdAt: "2026-03-17T10:00:00Z",
    };

    const item2: FeedBridgeItem = {
      id: "observation:o1:warning",
      tier: "review",
      entityId: "observation:o1",
      entityKind: "observation",
      entityName: "Test observation",
      reason: "Warning observation",
      status: "open",
      severity: "warning",
      createdAt: "2026-03-17T10:00:01Z",
    };

    batcher.add(item1);
    batcher.add(item2);

    // Wait for the window to flush
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(emitted.length).toBe(1);
    expect(emitted[0].items.length).toBe(2);

    batcher.dispose();
  });

  it("emits separate batches for events outside the window", async () => {
    const emitted: Array<{ items: FeedBridgeItem[]; removals: string[] }> = [];
    const batcher = createBatcher({
      windowMs: 50,
      onFlush: (items, removals) => {
        emitted.push({ items: [...items], removals: [...removals] });
      },
    });

    const item1: FeedBridgeItem = {
      id: "decision:d1:provisional",
      tier: "blocking",
      entityId: "decision:d1",
      entityKind: "decision",
      entityName: "First batch",
      reason: "test",
      status: "provisional",
      createdAt: "2026-03-17T10:00:00Z",
    };

    batcher.add(item1);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const item2: FeedBridgeItem = {
      id: "observation:o1:warning",
      tier: "review",
      entityId: "observation:o1",
      entityKind: "observation",
      entityName: "Second batch",
      reason: "test",
      status: "open",
      createdAt: "2026-03-17T10:00:01Z",
    };

    batcher.add(item2);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(emitted.length).toBe(2);
    expect(emitted[0].items.length).toBe(1);
    expect(emitted[1].items.length).toBe(1);

    batcher.dispose();
  });

  it("includes removals in the batch when tier transitions occur", async () => {
    const emitted: Array<{ items: FeedBridgeItem[]; removals: string[] }> = [];
    const batcher = createBatcher({
      windowMs: 100,
      onFlush: (items, removals) => {
        emitted.push({ items: [...items], removals: [...removals] });
      },
    });

    const item: FeedBridgeItem = {
      id: "decision:d1:confirmed",
      tier: "awareness",
      entityId: "decision:d1",
      entityKind: "decision",
      entityName: "Confirmed decision",
      reason: "Decision confirmed",
      status: "confirmed",
      createdAt: "2026-03-17T10:00:00Z",
    };

    batcher.add(item, "decision:d1:provisional");

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(emitted.length).toBe(1);
    expect(emitted[0].removals).toContain("decision:d1:provisional");

    batcher.dispose();
  });

  it("dispose cancels pending flush", async () => {
    const emitted: Array<{ items: FeedBridgeItem[] }> = [];
    const batcher = createBatcher({
      windowMs: 200,
      onFlush: (items) => {
        emitted.push({ items: [...items] });
      },
    });

    batcher.add({
      id: "decision:d1:provisional",
      tier: "blocking",
      entityId: "decision:d1",
      entityKind: "decision",
      entityName: "Should not emit",
      reason: "test",
      status: "provisional",
      createdAt: "2026-03-17T10:00:00Z",
    });

    batcher.dispose();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(emitted.length).toBe(0);
  });
});
