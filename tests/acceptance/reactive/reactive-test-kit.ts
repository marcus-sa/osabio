/**
 * Graph-Reactive Coordination Acceptance Test Kit
 *
 * Extends the shared acceptance-test-kit with reactive coordination helpers.
 * All helpers use business language -- no technical jargon in function names.
 *
 * Driving ports:
 *   GET  /api/workspaces/:workspaceId/feed/stream   (SSE feed stream)
 *   GET  /api/workspaces/:workspaceId/feed           (initial feed state)
 *   POST /proxy/llm/anthropic/v1/messages            (LLM proxy -- context injection)
 *   POST /api/mcp/:workspaceId/context               (MCP context resolution)
 *   SurrealDB direct queries                         (verification of outcomes + seed data)
 */
import { RecordId, type Surreal } from "surrealdb";
import { embedMany } from "ai";

// ---------------------------------------------------------------------------
// Re-exports from shared kit
// ---------------------------------------------------------------------------

export {
  setupAcceptanceSuite,
  createTestUser,
  createTestUserWithMcp,
  fetchJson,
  fetchRaw,
  collectSseEvents,
  testAI,
  type AcceptanceTestRuntime,
  type TestUser,
  type TestUserWithMcp,
} from "../acceptance-test-kit";

import {
  setupAcceptanceSuite,
  fetchRaw,
  testAI,
  type AcceptanceTestRuntime,
  type TestUser,
} from "../acceptance-test-kit";

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

export type ObservationSeverity = "info" | "warning" | "conflict";
export type ObservationStatus = "open" | "acknowledged" | "resolved";

export type FeedItem = {
  id: string;
  type: string;
  tier: string;
  title: string;
  severity?: string;
  source?: string;
  created_at: string;
};

export type FeedStreamEvent = {
  items: FeedItem[];
  removals?: string[];
};

export type AgentDescription = {
  agentId: string;
  agentType: string;
  description: string;
  descriptionEmbedding?: number[];
};

// ---------------------------------------------------------------------------
// Suite Setup
// ---------------------------------------------------------------------------

/**
 * Sets up a reactive coordination acceptance test suite with an isolated server + DB.
 */
export function setupReactiveSuite(
  suiteName: string,
): () => AcceptanceTestRuntime {
  return setupAcceptanceSuite(suiteName);
}

// ---------------------------------------------------------------------------
// Workspace and Identity Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a workspace directly in SurrealDB for reactive coordination tests.
 */
export async function createTestWorkspace(
  surreal: Surreal,
  suffix: string,
): Promise<{ workspaceId: string; identityId: string }> {
  const workspaceId = `ws-${crypto.randomUUID()}`;
  const identityId = `id-${crypto.randomUUID()}`;
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const identityRecord = new RecordId("identity", identityId);

  await surreal.query(`CREATE $workspace CONTENT $content;`, {
    workspace: workspaceRecord,
    content: {
      name: `Reactive Test Workspace ${suffix}`,
      status: "active",
      onboarding_complete: true,
      onboarding_turn_count: 0,
      onboarding_summary_pending: false,
      onboarding_started_at: new Date(),
      created_at: new Date(),
    },
  });

  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: identityRecord,
    content: {
      name: `Test Admin ${suffix}`,
      type: "human",
      identity_status: "active",
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  await surreal.query(
    `RELATE $identity->member_of->$workspace SET added_at = time::now();`,
    { identity: identityRecord, workspace: workspaceRecord },
  );

  return { workspaceId, identityId };
}

// ---------------------------------------------------------------------------
// Observation Helpers (Graph Write -- Triggers LIVE SELECT)
// ---------------------------------------------------------------------------

/**
 * Creates an observation in the graph, simulating what the Observer agent produces.
 * This is the primary event source that triggers the reactive coordination layer.
 */
export async function createObservation(
  surreal: Surreal,
  workspaceId: string,
  options: {
    text: string;
    severity: ObservationSeverity;
    sourceAgent: string;
    category?: string;
    embedding?: number[];
    targetEntity?: { table: string; id: string };
  },
): Promise<{ observationId: string }> {
  const observationId = `obs-${crypto.randomUUID()}`;
  const observationRecord = new RecordId("observation", observationId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const content: Record<string, unknown> = {
    text: options.text,
    severity: options.severity,
    status: "open",
    source_agent: options.sourceAgent,
    workspace: workspaceRecord,
    created_at: new Date(),
  };

  if (options.category) {
    content.category = options.category;
  }
  if (options.embedding) {
    content.embedding = options.embedding;
  }

  await surreal.query(`CREATE $obs CONTENT $content;`, {
    obs: observationRecord,
    content,
  });

  // If targeting a specific entity, create the observes edge
  if (options.targetEntity) {
    const targetRecord = new RecordId(options.targetEntity.table, options.targetEntity.id);
    await surreal.query(
      `RELATE $obs->observes->$target SET added_at = time::now();`,
      { obs: observationRecord, target: targetRecord },
    );
  }

  return { observationId };
}

/**
 * Creates an observation AND triggers the coordinator webhook endpoint.
 * In production, the SurrealDB DEFINE EVENT fires the webhook automatically.
 * In tests, we simulate this by POSTing to the coordinator endpoint directly.
 */
export async function createObservationWithCoordinator(
  surreal: Surreal,
  baseUrl: string,
  workspaceId: string,
  options: {
    text: string;
    severity: ObservationSeverity;
    sourceAgent: string;
    category?: string;
    embedding?: number[];
    targetEntity?: { table: string; id: string };
  },
): Promise<{ observationId: string }> {
  const result = await createObservation(surreal, workspaceId, options);

  // Simulate DEFINE EVENT webhook — POST to agent activator endpoint
  await fetch(`${baseUrl}/api/internal/activator/observation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      observation_id: result.observationId,
      workspace: workspaceId,
      text: options.text,
      severity: options.severity,
      source_agent: options.sourceAgent,
    }),
  });

  return result;
}

/**
 * Creates multiple observations in rapid succession with coordinator webhook calls.
 */
export async function createObservationBurstWithCoordinator(
  surreal: Surreal,
  baseUrl: string,
  workspaceId: string,
  options: {
    count: number;
    sourceAgent: string;
    targetEntity: { table: string; id: string };
    severity: ObservationSeverity;
    textPrefix: string;
    embedding?: number[];
  },
): Promise<string[]> {
  // Use provided embedding or generate a fake one so the coordinator webhook accepts the payload
  const embedding = options.embedding ?? fakeEmbedding(42);
  const ids: string[] = [];
  for (let i = 0; i < options.count; i++) {
    const { observationId } = await createObservationWithCoordinator(surreal, baseUrl, workspaceId, {
      text: `${options.textPrefix} (${i + 1} of ${options.count})`,
      severity: options.severity,
      sourceAgent: options.sourceAgent,
      targetEntity: options.targetEntity,
      embedding,
    });
    ids.push(observationId);
  }
  return ids;
}

/**
 * Creates multiple observations in rapid succession for loop dampening tests.
 */
export async function createObservationBurst(
  surreal: Surreal,
  workspaceId: string,
  options: {
    count: number;
    sourceAgent: string;
    targetEntity: { table: string; id: string };
    severity: ObservationSeverity;
    textPrefix: string;
  },
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < options.count; i++) {
    const { observationId } = await createObservation(surreal, workspaceId, {
      text: `${options.textPrefix} (${i + 1} of ${options.count})`,
      severity: options.severity,
      sourceAgent: options.sourceAgent,
      targetEntity: options.targetEntity,
    });
    ids.push(observationId);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Decision Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a decision in the graph.
 */
export async function createDecision(
  surreal: Surreal,
  workspaceId: string,
  options: {
    summary: string;
    status?: string;
    embedding?: number[];
  },
): Promise<{ decisionId: string }> {
  const decisionId = `dec-${crypto.randomUUID()}`;
  const decisionRecord = new RecordId("decision", decisionId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $dec CONTENT $content;`, {
    dec: decisionRecord,
    content: {
      summary: options.summary,
      status: options.status ?? "provisional",
      workspace: workspaceRecord,
      created_at: new Date(),
      updated_at: new Date(),
      ...(options.embedding ? { embedding: options.embedding } : {}),
    },
  });

  return { decisionId };
}

/**
 * Confirms a provisional decision, simulating the chat agent confirming it.
 */
export async function confirmDecision(
  surreal: Surreal,
  decisionId: string,
): Promise<void> {
  const decisionRecord = new RecordId("decision", decisionId);
  await surreal.query(
    `UPDATE $dec SET status = "confirmed", updated_at = time::now();`,
    { dec: decisionRecord },
  );
}

/**
 * Supersedes a decision with a new one.
 */
export async function supersedeDecision(
  surreal: Surreal,
  oldDecisionId: string,
  newDecisionId: string,
): Promise<void> {
  const oldRecord = new RecordId("decision", oldDecisionId);
  const newRecord = new RecordId("decision", newDecisionId);
  // The DEFINE EVENT on superseded_by automatically sets
  // status = "superseded" on the old decision when the edge is created.
  await surreal.query(
    `RELATE $old->superseded_by->$new SET superseded_at = time::now();`,
    { old: oldRecord, new: newRecord },
  );
}

// ---------------------------------------------------------------------------
// Task Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a task in the graph.
 */
export async function createTask(
  surreal: Surreal,
  workspaceId: string,
  options: {
    title: string;
    status?: string;
    embedding?: number[];
  },
): Promise<{ taskId: string }> {
  const taskId = `task-${crypto.randomUUID()}`;
  const taskRecord = new RecordId("task", taskId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $task CONTENT $content;`, {
    task: taskRecord,
    content: {
      title: options.title,
      status: options.status ?? "open",
      workspace: workspaceRecord,
      created_at: new Date(),
      updated_at: new Date(),
      ...(options.embedding ? { embedding: options.embedding } : {}),
    },
  });

  return { taskId };
}

/**
 * Blocks a task, simulating a human or agent marking it blocked.
 */
export async function blockTask(
  surreal: Surreal,
  taskId: string,
): Promise<void> {
  const taskRecord = new RecordId("task", taskId);
  await surreal.query(
    `UPDATE $task SET status = "blocked", updated_at = time::now();`,
    { task: taskRecord },
  );
}

/**
 * Creates a dependency between a task and a decision.
 */
export async function linkTaskToDecision(
  surreal: Surreal,
  taskId: string,
  decisionId: string,
): Promise<void> {
  const taskRecord = new RecordId("task", taskId);
  const decisionRecord = new RecordId("decision", decisionId);
  await surreal.query(
    `RELATE $task->depends_on->$dec SET created_at = time::now();`,
    { task: taskRecord, dec: decisionRecord },
  );
}

// ---------------------------------------------------------------------------
// Agent Session Helpers
// ---------------------------------------------------------------------------

/**
 * Creates an agent with a description, simulating agent registration.
 * The description (text) is used by the agent activator's LLM classification (ADR-061).
 */
export async function registerAgent(
  surreal: Surreal,
  workspaceId: string,
  identityId: string,
  options: {
    agentType: string;
    description?: string;
    descriptionEmbedding?: number[];
  },
): Promise<{ agentId: string }> {
  const agentId = `agent-${crypto.randomUUID()}`;
  const agentRecord = new RecordId("agent", agentId);
  const identityRecord = new RecordId("identity", identityId);

  const content: Record<string, unknown> = {
    agent_type: options.agentType,
    managed_by: identityRecord,
    created_at: new Date(),
  };

  if (options.description) {
    content.description = options.description;
  }
  if (options.descriptionEmbedding) {
    content.description_embedding = options.descriptionEmbedding;
  }

  await surreal.query(`CREATE $agent CONTENT $content;`, {
    agent: agentRecord,
    content,
  });

  return { agentId };
}

/**
 * Creates an active agent session, simulating an agent starting work.
 */
export async function startAgentSession(
  surreal: Surreal,
  workspaceId: string,
  options: {
    agentType: string;
    taskId?: string;
    description?: string;
    descriptionEmbedding?: number[];
  },
): Promise<{ sessionId: string }> {
  const sessionId = `sess-${crypto.randomUUID()}`;
  const sessionRecord = new RecordId("agent_session", sessionId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const content: Record<string, unknown> = {
    agent: options.agentType,
    started_at: new Date(),
    workspace: workspaceRecord,
    orchestrator_status: "active",
    created_at: new Date(),
  };

  if (options.taskId) {
    content.task_id = new RecordId("task", options.taskId);
  }

  if (options.descriptionEmbedding) {
    content.description_embedding = options.descriptionEmbedding;
  }

  await surreal.query(`CREATE $sess CONTENT $content;`, {
    sess: sessionRecord,
    content,
  });

  return { sessionId };
}

/**
 * Ends an agent session.
 */
export async function endAgentSession(
  surreal: Surreal,
  sessionId: string,
): Promise<void> {
  const sessionRecord = new RecordId("agent_session", sessionId);
  await surreal.query(
    `UPDATE $sess SET orchestrator_status = "completed", ended_at = time::now();`,
    { sess: sessionRecord },
  );
}

// ---------------------------------------------------------------------------
// Feed Stream Helpers
// ---------------------------------------------------------------------------

/**
 * Opens an SSE connection to the governance feed stream for a workspace.
 * Returns a controller that can collect events and close the connection.
 */
export function openFeedStream(
  baseUrl: string,
  workspaceId: string,
  user: TestUser,
  options?: { lastEventId?: string },
): FeedStreamController {
  return new FeedStreamController(baseUrl, workspaceId, user, options);
}

export class FeedStreamController {
  private events: FeedStreamEvent[] = [];
  private rawEvents: string[] = [];
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private abortController = new AbortController();
  private buffer = "";
  private decoder = new TextDecoder();
  private connected = false;
  private connectionPromise: Promise<void> | undefined;
  private lastEventId: string | undefined;

  constructor(
    private baseUrl: string,
    private workspaceId: string,
    private user: TestUser,
    private options?: { lastEventId?: string },
  ) {
    this.lastEventId = options?.lastEventId;
  }

  /** Start listening for SSE events. */
  async connect(): Promise<void> {
    this.connectionPromise = this._connect();
    // Give the connection a moment to establish
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  /** Get the last event ID received from the server. */
  getLastEventId(): string | undefined {
    return this.lastEventId;
  }

  private async _connect(): Promise<void> {
    const url = `${this.baseUrl}/api/workspaces/${this.workspaceId}/feed/stream`;
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      ...this.user.headers,
    };
    if (this.lastEventId) {
      headers["Last-Event-ID"] = this.lastEventId;
    }
    const response = await fetch(url, {
      headers,
      signal: this.abortController.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to open feed stream (${response.status})`);
    }

    this.connected = true;
    this.reader = response.body.getReader();

    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;

        this.buffer += this.decoder.decode(value, { stream: true });
        const segments = this.buffer.split("\n\n");
        this.buffer = segments.pop() ?? "";

        for (const segment of segments) {
          const lines = segment.split("\n");
          const idLine = lines.find((line) => line.startsWith("id: "));
          const dataLine = lines.find((line) => line.startsWith("data: "));
          if (!dataLine) continue;

          // Track the last event ID for reconnection
          if (idLine) {
            this.lastEventId = idLine.slice("id: ".length).trim();
          }

          const raw = dataLine.slice("data: ".length);
          this.rawEvents.push(raw);

          try {
            const event = JSON.parse(raw) as FeedStreamEvent;
            this.events.push(event);
          } catch {
            // Non-JSON event (keep-alive comment, etc.)
          }
        }
      }
    } catch (e: unknown) {
      // AbortError is expected when we close the stream
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (e instanceof Error && e.message.includes("abort")) return;
      throw e;
    }
  }

  /** Wait for at least N feed_update events, with timeout. */
  async waitForEvents(count: number, timeoutMs: number = 5000): Promise<FeedStreamEvent[]> {
    const start = Date.now();
    while (this.events.length < count && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return [...this.events];
  }

  /** Get all collected events so far. */
  getEvents(): FeedStreamEvent[] {
    return [...this.events];
  }

  /** Get all raw event strings. */
  getRawEvents(): string[] {
    return [...this.rawEvents];
  }

  /** Whether the stream connection was established. */
  isConnected(): boolean {
    return this.connected;
  }

  /** Close the SSE connection. */
  close(): void {
    this.abortController.abort();
    this.connected = false;
  }
}

// ---------------------------------------------------------------------------
// Embedding Helpers
// ---------------------------------------------------------------------------

/**
 * Generates real embedding vectors using the configured embedding model.
 */
export async function generateEmbeddings(
  texts: string[],
): Promise<Map<string, number[]>> {
  const { embeddings } = await embedMany({
    model: testAI.embeddingModel,
    values: texts,
  });
  const result = new Map<string, number[]>();
  for (let i = 0; i < texts.length; i++) {
    result.set(texts[i], embeddings[i]);
  }
  return result;
}

/**
 * Generates a real embedding vector for a single text.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const map = await generateEmbeddings([text]);
  return map.get(text)!;
}

/**
 * Creates a deterministic fake embedding vector for testing.
 * Uses a seed to produce a reproducible 1536-dimension unit vector.
 */
export function fakeEmbedding(seed: number): number[] {
  const dimension = 1536;
  const embedding = new Array<number>(dimension);
  let state = seed;
  for (let i = 0; i < dimension; i++) {
    state = ((state * 1103515245 + 12345) & 0x7fffffff);
    embedding[i] = (state / 0x7fffffff) * 2 - 1;
  }
  const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  for (let i = 0; i < dimension; i++) {
    embedding[i] = embedding[i] / magnitude;
  }
  return embedding;
}

// ---------------------------------------------------------------------------
// Verification Helpers
// ---------------------------------------------------------------------------

/**
 * Queries observations for a workspace.
 */
export async function getObservations(
  surreal: Surreal,
  workspaceId: string,
  options?: { status?: ObservationStatus; category?: string },
): Promise<Array<{ id: RecordId; text: string; severity: string; status: string; category?: string }>> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  let query = `SELECT id, text, severity, status, category, created_at FROM observation WHERE workspace = $ws`;
  const params: Record<string, unknown> = { ws: workspaceRecord };

  if (options?.status) {
    query += ` AND status = $status`;
    params.status = options.status;
  }
  if (options?.category) {
    query += ` AND category = $category`;
    params.category = options.category;
  }

  query += ` ORDER BY created_at DESC;`;

  const rows = (await surreal.query(query, params)) as Array<
    Array<{ id: RecordId; text: string; severity: string; status: string; category?: string }>
  >;
  return rows[0] ?? [];
}

/**
 * Queries provisional decisions created by the agent activator.
 */
export async function getActivationDecisions(
  surreal: Surreal,
  workspaceId: string,
): Promise<Array<{ id: RecordId; summary: string; rationale: string; status: string; category?: string }>> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const rows = (await surreal.query(
    `SELECT id, summary, rationale, status, category, created_at FROM decision
     WHERE workspace = $ws AND category = "operations" AND inferred_by = "agent_activator"
     ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  )) as Array<
    Array<{ id: RecordId; summary: string; rationale: string; status: string; category?: string }>
  >;
  return rows[0] ?? [];
}

/**
 * Gets the current feed state via the existing GET endpoint.
 */
export async function getFeedState(
  baseUrl: string,
  workspaceId: string,
  user: TestUser,
): Promise<Record<string, unknown>> {
  const response = await fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/feed`,
    { headers: user.headers },
  );
  if (!response.ok) {
    throw new Error(`Failed to get feed state (${response.status})`);
  }
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Checks whether the agent session has a last_request_at timestamp.
 */
export async function getSessionLastRequestAt(
  surreal: Surreal,
  sessionId: string,
): Promise<string | undefined> {
  const sessionRecord = new RecordId("agent_session", sessionId);
  const rows = (await surreal.query(
    `SELECT last_request_at FROM $sess;`,
    { sess: sessionRecord },
  )) as Array<Array<{ last_request_at?: string }>>;
  return rows[0]?.[0]?.last_request_at;
}

/**
 * Queries agent sessions created by the activator (orchestrator_status = "spawning").
 * These are sessions started by the agent activator when LLM classification
 * matched an agent type to an observation.
 */
export async function getActivatedSessions(
  surreal: Surreal,
  workspaceId: string,
): Promise<Array<{ id: RecordId; agent: string; orchestrator_status: string; triggered_by?: RecordId }>> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const rows = (await surreal.query(
    `SELECT id, agent, orchestrator_status, triggered_by, created_at FROM agent_session
     WHERE workspace = $ws AND source = "activator"
     ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  )) as Array<
    Array<{ id: RecordId; agent: string; orchestrator_status: string; triggered_by?: RecordId }>
  >;
  return rows[0] ?? [];
}

/**
 * Queries meta-observations created by the loop dampener.
 */
export async function getMetaObservations(
  surreal: Surreal,
  workspaceId: string,
): Promise<Array<{ id: RecordId; text: string; category: string }>> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const rows = (await surreal.query(
    `SELECT id, text, category, created_at FROM observation
     WHERE workspace = $ws AND source_agent = "agent_activator"
     ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  )) as Array<Array<{ id: RecordId; text: string; category: string }>>;
  return rows[0] ?? [];
}
