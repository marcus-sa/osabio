/**
 * Sandbox Agent Adapter — port types and mock factory.
 *
 * Port types define the contract for interacting with a SandboxAgent server.
 * The adapter abstracts at the SDK level: one factory creates the adapter,
 * sessions are created through it.
 *
 * Mock factory provides a test-injectable implementation with overridable behavior.
 */

// ── Port Types ──

export type SessionHandle = {
  id: string;
  prompt: (
    messages: Array<{ type: string; text: string }>,
  ) => Promise<{ success: boolean }>;
  onEvent: (handler: (event: unknown) => void) => () => void;
  onPermissionRequest: (
    handler: (request: unknown) => void,
  ) => () => void;
  respondPermission: (id: string, decision: string) => Promise<void>;
};

export type SessionConfig = {
  agent: string;
  cwd: string;
  env?: Record<string, string>;
};

export type McpServerConfig = {
  type: string;
  url: string;
  headers?: Record<string, string>;
};

export type SandboxAgentAdapter = {
  createSession: (config: SessionConfig) => Promise<SessionHandle>;
  resumeSession: (sessionId: string) => Promise<SessionHandle>;
  destroySession: (sessionId: string) => Promise<void>;
  setMcpConfig: (
    cwd: string,
    name: string,
    config: McpServerConfig,
  ) => Promise<void>;
};

// ── Mock Adapter Factory ──

export function createMockAdapter(
  overrides?: Partial<SandboxAgentAdapter>,
): SandboxAgentAdapter {
  const sessions = new Map<string, SessionHandle>();
  const destroyed = new Set<string>();

  const createHandle = (id: string): SessionHandle => ({
    id,
    prompt: async () => {
      if (destroyed.has(id)) {
        throw new Error(`Session ${id} has been destroyed`);
      }
      return { success: true };
    },
    onEvent: () => () => {},
    onPermissionRequest: () => () => {},
    respondPermission: async () => {
      if (destroyed.has(id)) {
        throw new Error(`Session ${id} has been destroyed`);
      }
    },
  });

  return {
    createSession: async (config) => {
      const id = `session-${crypto.randomUUID()}`;
      const handle = createHandle(id);
      sessions.set(id, handle);
      return handle;
    },
    resumeSession: async (sessionId) => {
      if (destroyed.has(sessionId)) {
        throw new Error(`Session ${sessionId} has been destroyed`);
      }
      const existing = sessions.get(sessionId);
      if (existing) {
        return existing;
      }
      const handle = createHandle(sessionId);
      sessions.set(sessionId, handle);
      return handle;
    },
    destroySession: async (sessionId) => {
      sessions.delete(sessionId);
      destroyed.add(sessionId);
    },
    setMcpConfig: async () => {},
    ...overrides,
  };
}
