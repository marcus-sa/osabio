/**
 * Gateway Protocol test helpers for acceptance tests.
 *
 * Provides WebSocket connection management, protocol frame helpers,
 * event collection utilities, and data seeding for testing the Gateway Protocol v3.
 */
import { RecordId, type Surreal } from "surrealdb";

// --- Protocol Frame Types ---

export type RequestFrame = {
  readonly type: "req";
  readonly id: string;
  readonly method: string;
  readonly params?: unknown;
};

export type ResponseFrame =
  | {
      readonly type: "res";
      readonly id: string;
      readonly ok: true;
      readonly payload?: unknown;
    }
  | {
      readonly type: "res";
      readonly id: string;
      readonly ok: false;
      readonly error: { code: string; message: string; details?: unknown };
    };

export type EventFrame = {
  readonly type: "event";
  readonly event: string;
  readonly payload?: unknown;
  readonly seq?: number;
};

export type GatewayFrame = RequestFrame | ResponseFrame | EventFrame;

// --- Gateway Test Client ---

export type GatewayTestClient = {
  /** Send a request frame and wait for the matching response */
  readonly request: (
    method: string,
    params?: unknown,
  ) => Promise<ResponseFrame>;
  /** Collect event frames until predicate returns true or timeout */
  readonly collectEvents: (
    predicate: (event: EventFrame) => boolean,
    timeoutMs?: number,
  ) => Promise<readonly EventFrame[]>;
  /** Wait for a single event matching a predicate */
  readonly waitForEvent: (
    predicate: string | ((event: EventFrame) => boolean),
    timeoutMs?: number,
  ) => Promise<EventFrame>;
  /** Send a raw text message (for malformed frame testing) */
  readonly sendRaw: (text: string) => void;
  /** Close the WebSocket connection */
  readonly close: () => void;
  /** Whether the connection is open */
  readonly isOpen: () => boolean;
  /** All received frames (for debugging) */
  readonly receivedFrames: readonly GatewayFrame[];
};

/**
 * Connect to the gateway WebSocket endpoint and return a test client.
 *
 * Uses Bun's built-in WebSocket client. The client automatically parses
 * incoming frames and routes them to pending request promises or event collectors.
 */
export function connectGateway(
  baseUrl: string,
  options?: { connectTimeoutMs?: number },
): Promise<GatewayTestClient> {
  const connectTimeout = options?.connectTimeoutMs ?? 10_000;

  return new Promise((resolve, reject) => {
    const wsUrl = baseUrl.replace(/^http/, "ws") + "/api/gateway";

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      return reject(
        new Error(`Gateway WS creation failed: ${(e as Error).message}`),
      );
    }

    const receivedFrames: GatewayFrame[] = [];
    const pendingRequests = new Map<
      string,
      {
        resolve: (frame: ResponseFrame) => void;
        reject: (err: Error) => void;
      }
    >();
    const eventListeners: Array<(event: EventFrame) => void> = [];

    ws.onmessage = (msg) => {
      const frame = JSON.parse(
        typeof msg.data === "string" ? msg.data : msg.data.toString(),
      ) as GatewayFrame;
      receivedFrames.push(frame);

      if (frame.type === "res") {
        const pending = pendingRequests.get(frame.id);
        if (pending) {
          pendingRequests.delete(frame.id);
          pending.resolve(frame);
        }
      } else if (frame.type === "event") {
        for (const listener of eventListeners) {
          listener(frame);
        }
      }
    };

    ws.onopen = () => {
      const client: GatewayTestClient = {
        request: (method, params) => {
          const id = crypto.randomUUID();
          const frame: RequestFrame = { type: "req", id, method, params };
          ws.send(JSON.stringify(frame));

          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              pendingRequests.delete(id);
              rej(
                new Error(
                  `Gateway request timeout: ${method} (id: ${id}) after 10s`,
                ),
              );
            }, 10_000);

            pendingRequests.set(id, {
              resolve: (f) => {
                clearTimeout(timer);
                res(f);
              },
              reject: (e) => {
                clearTimeout(timer);
                rej(e);
              },
            });
          });
        },

        collectEvents: (predicate, timeoutMs = 10_000) => {
          return new Promise((res) => {
            const collected: EventFrame[] = [];
            const timer = setTimeout(() => {
              const idx = eventListeners.indexOf(listener);
              if (idx >= 0) eventListeners.splice(idx, 1);
              res(collected);
            }, timeoutMs);

            const listener = (event: EventFrame) => {
              collected.push(event);
              if (predicate(event)) {
                clearTimeout(timer);
                const idx = eventListeners.indexOf(listener);
                if (idx >= 0) eventListeners.splice(idx, 1);
                res(collected);
              }
            };
            eventListeners.push(listener);
          });
        },

        waitForEvent: (predicateOrName, timeoutMs = 10_000) => {
          const matchFn =
            typeof predicateOrName === "string"
              ? (e: EventFrame) => e.event === predicateOrName
              : predicateOrName;
          const label =
            typeof predicateOrName === "string"
              ? predicateOrName
              : "predicate";

          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              const idx = eventListeners.indexOf(listener);
              if (idx >= 0) eventListeners.splice(idx, 1);
              rej(
                new Error(
                  `Gateway event timeout: waiting for "${label}" after ${timeoutMs}ms`,
                ),
              );
            }, timeoutMs);

            const listener = (event: EventFrame) => {
              if (matchFn(event)) {
                clearTimeout(timer);
                const idx = eventListeners.indexOf(listener);
                if (idx >= 0) eventListeners.splice(idx, 1);
                res(event);
              }
            };
            eventListeners.push(listener);
          });
        },

        sendRaw: (text) => ws.send(text),
        close: () => ws.close(),
        isOpen: () => ws.readyState === WebSocket.OPEN,
        receivedFrames,
      };

      resolve(client);
    };

    ws.onerror = (err) =>
      reject(new Error(`Gateway WS connect failed: ${err}`));

    setTimeout(
      () => reject(new Error(`Gateway WS connect timeout after ${connectTimeout}ms`)),
      connectTimeout,
    );
  });
}

/**
 * Connect to the gateway and authenticate with a hardcoded skeleton identity.
 *
 * Walking skeleton mode: the gateway's connect handler recognizes a well-known
 * skeleton token ("skeleton-test-token") and transitions directly to active state
 * with a hardcoded identity. This lets us test the full pipeline without Ed25519.
 *
 * This function sends an actual `connect` frame with the skeleton token and waits
 * for the `hello-ok` response before returning. If the gateway does not respond
 * with ok: true, the test fails immediately (not silently).
 *
 * For R1+ tests, use Ed25519 auth via connectGatewayWithDeviceAuth().
 */
export async function connectGatewayWithSkeletonAuth(
  baseUrl: string,
): Promise<GatewayTestClient> {
  const client = await connectGateway(baseUrl);

  // Send skeleton connect frame — gateway recognizes the skeleton token
  // and bypasses Ed25519 verification, transitioning directly to active.
  const connectRes = await client.request("connect", {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: "skeleton-test-client",
      version: "0.0.0-test",
      platform: "test",
      mode: "remote",
    },
    role: "operator",
    scopes: ["operator.read", "operator.write", "operator.approvals"],
    auth: { token: "skeleton-test-token" },
    device: {
      id: "skeleton-device",
      publicKey: "",
      signature: "",
      signedAt: 0,
      nonce: "",
    },
  });

  if (!connectRes.ok) {
    client.close();
    const error = connectRes.error;
    throw new Error(
      `Skeleton auth failed: ${error.code} — ${error.message}`,
    );
  }

  return client;
}

// --- Test Data Seeding Helpers ---

/**
 * Seed decisions in a workspace for context injection testing.
 * Returns the created decision RecordIds.
 */
export async function seedDecisions(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  projectRecord: RecordId<"project", string>,
  count: number,
): Promise<RecordId<"decision", string>[]> {
  const records: RecordId<"decision", string>[] = [];
  for (let i = 0; i < count; i++) {
    const decisionRecord = new RecordId("decision", crypto.randomUUID());
    await surreal.create(decisionRecord).content({
      summary: `Test decision ${i + 1}`,
      status: "confirmed",
      workspace: workspaceRecord,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await surreal
      .relate(
        decisionRecord,
        new RecordId("belongs_to", crypto.randomUUID()),
        projectRecord,
        { added_at: new Date() },
      )
      .output("after");
    records.push(decisionRecord);
  }
  return records;
}

/**
 * Seed constraints in a workspace for context injection testing.
 * Returns the created constraint RecordIds.
 */
export async function seedConstraints(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  projectRecord: RecordId<"project", string>,
  count: number,
): Promise<RecordId<"constraint", string>[]> {
  const records: RecordId<"constraint", string>[] = [];
  for (let i = 0; i < count; i++) {
    const constraintRecord = new RecordId("constraint", crypto.randomUUID());
    await surreal.create(constraintRecord).content({
      text: `Test constraint ${i + 1}`,
      workspace: workspaceRecord,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await surreal
      .relate(
        constraintRecord,
        new RecordId("belongs_to", crypto.randomUUID()),
        projectRecord,
        { added_at: new Date() },
      )
      .output("after");
    records.push(constraintRecord);
  }
  return records;
}

/**
 * Seed a project in a workspace. Returns the project RecordId.
 */
export async function seedProject(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  name: string,
): Promise<RecordId<"project", string>> {
  const projectRecord = new RecordId("project", crypto.randomUUID());
  await surreal.create(projectRecord).content({
    name,
    status: "active",
    workspace: workspaceRecord,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return projectRecord;
}

/**
 * Helper to check if an event is a "done" lifecycle event.
 * Used as predicate for collectEvents/waitForEvent to avoid brittle deep checks.
 */
export function isDoneEvent(event: EventFrame): boolean {
  const payload = event.payload as
    | { stream?: string; data?: { phase?: string } }
    | undefined;
  return (
    event.event === "agent.stream" &&
    payload?.stream === "lifecycle" &&
    payload?.data?.phase === "done"
  );
}

/**
 * Helper to check if an event is an assistant stream event (token delta).
 */
export function isAssistantEvent(event: EventFrame): boolean {
  const payload = event.payload as { stream?: string } | undefined;
  return event.event === "agent.stream" && payload?.stream === "assistant";
}
