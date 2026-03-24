/**
 * Presence registry — unit tests for the pure in-memory presence tracker.
 */
import { describe, expect, it } from "bun:test";
import {
  createPresenceRegistry,
  type PresenceEntry,
} from "../../../app/src/server/gateway/presence-registry";

function makeEntry(overrides?: Partial<PresenceEntry>): PresenceEntry {
  return {
    connectionId: crypto.randomUUID(),
    agentType: "operator",
    connectedAt: Date.now(),
    workspaceId: "ws-1",
    ...overrides,
  };
}

describe("PresenceRegistry", () => {
  it("starts empty", () => {
    const registry = createPresenceRegistry();
    expect(registry.size()).toBe(0);
    expect(registry.queryByWorkspace("ws-1")).toEqual([]);
  });

  it("tracks added connections", () => {
    const registry = createPresenceRegistry();
    const entry = makeEntry();
    registry.add(entry);

    expect(registry.size()).toBe(1);
    const devices = registry.queryByWorkspace("ws-1");
    expect(devices.length).toBe(1);
    expect(devices[0].connectionId).toBe(entry.connectionId);
    expect(devices[0].status).toBe("online");
    expect(devices[0].agentType).toBe("operator");
  });

  it("removes connections and returns the entry", () => {
    const registry = createPresenceRegistry();
    const entry = makeEntry();
    registry.add(entry);

    const removed = registry.remove(entry.connectionId);
    expect(removed).toBeDefined();
    expect(removed!.connectionId).toBe(entry.connectionId);
    expect(registry.size()).toBe(0);
    expect(registry.queryByWorkspace("ws-1")).toEqual([]);
  });

  it("returns undefined when removing non-existent connection", () => {
    const registry = createPresenceRegistry();
    expect(registry.remove("non-existent")).toBeUndefined();
  });

  it("filters by workspace", () => {
    const registry = createPresenceRegistry();
    registry.add(makeEntry({ workspaceId: "ws-1" }));
    registry.add(makeEntry({ workspaceId: "ws-2" }));
    registry.add(makeEntry({ workspaceId: "ws-1" }));

    expect(registry.queryByWorkspace("ws-1").length).toBe(2);
    expect(registry.queryByWorkspace("ws-2").length).toBe(1);
    expect(registry.queryByWorkspace("ws-3").length).toBe(0);
  });

  it("uses connectionId as fingerprint when deviceFingerprint is absent", () => {
    const registry = createPresenceRegistry();
    const entry = makeEntry({ deviceFingerprint: undefined });
    registry.add(entry);

    const devices = registry.queryByWorkspace("ws-1");
    expect(devices[0].deviceFingerprint).toBe(entry.connectionId);
  });

  it("uses deviceFingerprint when present", () => {
    const registry = createPresenceRegistry();
    const entry = makeEntry({ deviceFingerprint: "fp-abc123" });
    registry.add(entry);

    const devices = registry.queryByWorkspace("ws-1");
    expect(devices[0].deviceFingerprint).toBe("fp-abc123");
  });
});
