/**
 * Loop Dampener
 *
 * Pure sliding window counter per entity, per source, per workspace.
 * Detects rapid-fire observations that would cause cascading agent
 * invocations (feedback loops).
 *
 * Pure core: composeDampenerKey, shouldDampen
 * Stateful shell: createLoopDampener (factory with injected clock + callback)
 *
 * Step: 03-01 (Graph-Reactive Coordination)
 */

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

/** Configuration for the dampener's sliding window. */
export type DampenerConfig = {
  /** Number of events within the window that triggers dampening. */
  threshold: number;
  /** Sliding window duration in milliseconds. */
  windowMs: number;
};

/** An event to be checked against the dampener. */
export type DampenerEvent = {
  workspaceId: string;
  entityId: string;
  sourceAgent: string;
};

/** Result of a dampening check. */
export type DampenerResult = {
  dampened: boolean;
};

/** Callback invoked when dampening first activates for a key. */
export type OnDampenActivated = (key: string, event: DampenerEvent) => void;

/** Clock function for testability -- returns current time in ms. */
export type Clock = () => number;

// ---------------------------------------------------------------------------
// Pure Functions
// ---------------------------------------------------------------------------

/**
 * Composes a dampener key from workspace, entity, and source.
 * The key uniquely identifies the dampening scope.
 */
export function composeDampenerKey(
  workspaceId: string,
  entityId: string,
  sourceAgent: string,
): string {
  return `${workspaceId}:${entityId}:${sourceAgent}`;
}

/**
 * Determines whether an event should be dampened based on the
 * number of timestamps within the sliding window.
 *
 * Pure function -- no side effects, no mutation.
 */
export function shouldDampen(
  timestamps: ReadonlyArray<number>,
  now: number,
  config: DampenerConfig,
): DampenerResult {
  const windowStart = now - config.windowMs;
  const countInWindow = timestamps.filter((t) => t > windowStart).length;
  return { dampened: countInWindow >= config.threshold };
}

// ---------------------------------------------------------------------------
// Stateful Shell: Loop Dampener Factory
// ---------------------------------------------------------------------------

export type LoopDampener = {
  /** Record an event and return whether it is dampened. */
  record: (event: DampenerEvent) => DampenerResult;
};

/**
 * Creates a loop dampener with a sliding window counter.
 *
 * State is in-memory (resets on server restart -- acceptable per architecture).
 * Dependencies injected: clock for testability, onDampen callback for side effects.
 *
 * The onDampen callback fires only on the transition from not-dampened to dampened
 * (first event that hits the threshold), not on every subsequent dampened event.
 */
export function createLoopDampener(
  config: DampenerConfig,
  clock?: Clock,
  onDampen?: OnDampenActivated,
): LoopDampener {
  const getClock = clock ?? (() => Date.now());
  const windows = new Map<string, number[]>();
  const activeDampening = new Set<string>();

  function record(event: DampenerEvent): DampenerResult {
    const key = composeDampenerKey(
      event.workspaceId,
      event.entityId,
      event.sourceAgent,
    );
    const now = getClock();

    // Get or create timestamp list for this key
    let timestamps = windows.get(key);
    if (!timestamps) {
      timestamps = [];
      windows.set(key, timestamps);
    }

    // Add the current event timestamp
    timestamps.push(now);

    // Prune expired timestamps (outside the window)
    const windowStart = now - config.windowMs;
    const pruned = timestamps.filter((t) => t > windowStart);
    windows.set(key, pruned);

    // Check dampening
    const result = shouldDampen(pruned, now, config);

    // Fire callback on activation transition only
    if (result.dampened && !activeDampening.has(key)) {
      activeDampening.add(key);
      onDampen?.(key, event);
    }

    // Clear activation flag when window resets
    if (!result.dampened && activeDampening.has(key)) {
      activeDampening.delete(key);
    }

    return result;
  }

  return { record };
}
