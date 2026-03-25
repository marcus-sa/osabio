/**
 * Sandbox Agent Adapter -- port types and adapter factories.
 *
 * Port types define the contract for interacting with a SandboxAgent server.
 * The adapter abstracts at the SDK level: one factory wraps the real SDK instance,
 * another provides a test-injectable mock with overridable behavior.
 *
 * Real SDK types are re-exported for use by callers without direct SDK dependency.
 */
import type {
  SandboxAgent,
  Session,
  SessionCreateRequest,
  SessionEvent,
  SessionEventListener,
  SessionPermissionRequest,
  PermissionRequestListener,
  PermissionReply,
  PromptRequest,
  PromptResponse,
} from "sandbox-agent";

// Re-export SDK types used at port boundaries
export type {
  SessionEvent,
  SessionEventListener,
  SessionPermissionRequest,
  PermissionRequestListener,
  PermissionReply,
  PromptResponse,
};

// ── Port Types ──

/**
 * Thin wrapper around the SDK's Session, exposing only the methods Brain needs.
 * Keeps the port boundary narrow -- callers never depend on the full Session class.
 */
export type SessionHandle = {
  id: string;
  prompt: (
    messages: PromptRequest["prompt"],
  ) => Promise<PromptResponse>;
  onEvent: (listener: SessionEventListener) => () => void;
  onPermissionRequest: (listener: PermissionRequestListener) => () => void;
  respondPermission: (permissionId: string, reply: PermissionReply) => Promise<void>;
};

export type SandboxAgentAdapter = {
  createSession: (request: SessionCreateRequest) => Promise<SessionHandle>;
  resumeSession: (sessionId: string) => Promise<SessionHandle>;
  destroySession: (sessionId: string) => Promise<void>;
};

// ── Production Adapter Factory ──

function wrapSession(session: Session): SessionHandle {
  return {
    id: session.id,
    prompt: (messages) => session.prompt(messages),
    onEvent: (listener) => session.onEvent(listener),
    onPermissionRequest: (listener) => session.onPermissionRequest(listener),
    respondPermission: (permissionId, reply) => session.respondPermission(permissionId, reply),
  };
}

/**
 * Creates a production adapter backed by a real SandboxAgent SDK instance.
 * The SDK instance should be created via `SandboxAgent.start()` or `SandboxAgent.connect()`.
 */
export function createSandboxAgentAdapter(
  sdk: SandboxAgent,
): SandboxAgentAdapter {
  return {
    createSession: async (request) => {
      const session = await sdk.createSession(request);
      return wrapSession(session);
    },
    resumeSession: async (sessionId) => {
      const session = await sdk.resumeSession(sessionId);
      return wrapSession(session);
    },
    destroySession: async (sessionId) => {
      await sdk.destroySession(sessionId);
    },
  };
}

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
      return { stopReason: "end_turn" as const } as PromptResponse;
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
    createSession: async (request) => {
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
    ...overrides,
  };
}
