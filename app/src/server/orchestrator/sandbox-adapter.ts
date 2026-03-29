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
} from "sandbox-agent";

// Derive prompt types from Session's method signature (not directly exported by sandbox-agent)
type PromptInput = Parameters<Session["prompt"]>[0];
type PromptResponse = Awaited<ReturnType<Session["prompt"]>>;

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
 * Brain-owned session creation request.
 * Extends the SDK's SessionCreateRequest with env for passing environment
 * variables (e.g. ANTHROPIC_BASE_URL, X-Osabio-Auth) into the sandbox.
 */
export type CreateSessionRequest = SessionCreateRequest & {
  env?: Record<string, string>;
};

/**
 * MCP server config for remote MCP servers.
 * Matches the sandbox-agent SDK's McpServerConfig remote variant.
 */
export type McpServerConfig = {
  readonly type: "remote";
  readonly url: string;
  readonly transport?: string;
  readonly headers?: Record<string, string>;
};

export type SessionHandle = {
  id: string;
  prompt: (
    messages: PromptInput,
  ) => Promise<PromptResponse>;
  onEvent: (listener: SessionEventListener) => () => void;
  onPermissionRequest: (listener: PermissionRequestListener) => () => void;
  respondPermission: (permissionId: string, reply: PermissionReply) => Promise<void>;
};

export type SandboxAgentAdapter = {
  createSession: (request: CreateSessionRequest) => Promise<SessionHandle>;
  resumeSession: (sessionId: string) => Promise<SessionHandle>;
  destroySession: (sessionId: string) => Promise<void>;
  /**
   * Configure a remote MCP server on the SDK, keyed by (directory, name).
   * Call before createSession -- the session inherits MCP configs matching its cwd.
   * Each session uses a unique worktree path as cwd, so configs are effectively per-session.
   */
  setMcpConfig: (directory: string, name: string, config: McpServerConfig) => Promise<void>;
  /** Exposed for test assertion -- last request passed to createSession. */
  lastCreateSessionRequest?: CreateSessionRequest;
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
      const { env: _env, ...sdkRequest } = request;
      const session = await sdk.createSession(sdkRequest);
      return wrapSession(session);
    },
    resumeSession: async (sessionId) => {
      const session = await sdk.resumeSession(sessionId);
      return wrapSession(session);
    },
    destroySession: async (sessionId) => {
      await sdk.destroySession(sessionId);
    },
    setMcpConfig: async (directory, name, config) => {
      await sdk.setMcpConfig({ directory, mcpName: name }, config);
    },
  };
}

// ── Mock Adapter Factory ──

export function createMockAdapter(
  overrides?: Partial<SandboxAgentAdapter>,
): SandboxAgentAdapter {
  const sessions = new Map<string, SessionHandle>();
  const destroyed = new Set<string>();
  let lastCreateSessionRequest: CreateSessionRequest | undefined;
  const mcpConfigs = new Map<string, Map<string, McpServerConfig>>();

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
    get lastCreateSessionRequest() {
      return lastCreateSessionRequest;
    },
    createSession: async (request) => {
      lastCreateSessionRequest = request;
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
    setMcpConfig: async (directory, name, config) => {
      const key = `${directory}:${name}`;
      if (!mcpConfigs.has(key)) mcpConfigs.set(key, new Map());
      mcpConfigs.get(key)!.set(name, config);
    },
    ...overrides,
  };
}
