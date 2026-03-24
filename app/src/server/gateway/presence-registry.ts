/**
 * Presence registry — pure in-memory tracking of active gateway connections.
 *
 * No IO, no side effects, no imports from IO modules.
 * The registry is a Map keyed by connectionId. Each entry stores
 * device metadata for presence queries and broadcasts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PresenceEntry = {
  readonly connectionId: string;
  readonly deviceFingerprint?: string;
  readonly agentType: string;
  readonly connectedAt: number;
  readonly workspaceId: string;
};

export type DevicePresence = {
  readonly deviceFingerprint: string;
  readonly status: "online";
  readonly agentType: string;
  readonly connectedAt: number;
  readonly connectionId: string;
};

export type PresenceRegistry = {
  readonly add: (entry: PresenceEntry) => void;
  readonly remove: (connectionId: string) => PresenceEntry | undefined;
  readonly queryByWorkspace: (workspaceId: string) => readonly DevicePresence[];
  readonly size: () => number;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPresenceRegistry(): PresenceRegistry {
  const entries = new Map<string, PresenceEntry>();

  return {
    add(entry: PresenceEntry): void {
      entries.set(entry.connectionId, entry);
    },

    remove(connectionId: string): PresenceEntry | undefined {
      const entry = entries.get(connectionId);
      if (entry) {
        entries.delete(connectionId);
      }
      return entry;
    },

    queryByWorkspace(workspaceId: string): readonly DevicePresence[] {
      const devices: DevicePresence[] = [];
      for (const entry of entries.values()) {
        if (entry.workspaceId === workspaceId) {
          devices.push({
            deviceFingerprint: entry.deviceFingerprint ?? entry.connectionId,
            status: "online",
            agentType: entry.agentType,
            connectedAt: entry.connectedAt,
            connectionId: entry.connectionId,
          });
        }
      }
      return devices;
    },

    size(): number {
      return entries.size;
    },
  };
}
