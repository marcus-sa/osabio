/**
 * Agent Activator
 *
 * POST endpoint handler called by SurrealDB DEFINE EVENT webhook when
 * observations are created. Routes observations to semantically matched
 * agent types via KNN vector search (observation embedding vs agent
 * description embeddings), then signals to start new agent sessions.
 *
 * Observations targeting entities with active agent sessions are skipped —
 * the LLM proxy handles enriching those sessions via its own vector search.
 *
 * Uses the same DEFINE EVENT webhook pattern as the 8 existing observer
 * webhooks (session_ended, task_completed, decision_confirmed, etc.).
 *
 * Pure core: filterAboveThreshold, parseWebhookPayload
 * Stateful shell: createAgentActivator
 *
 * Step: 03-02 (Graph-Reactive Coordination)
 */
import { RecordId, type Surreal } from "surrealdb";
import type { LoopDampener, DampenerEvent } from "./loop-dampener";

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

/** Webhook payload from SurrealDB DEFINE EVENT on observation CREATE. */
export type ObservationWebhookPayload = {
  observation_id: string;
  workspace: string;
  embedding: number[];
  text: string;
  severity: string;
  source_agent: string;
};

/** A matched agent type that should be started for an observation. */
export type AgentMatch = {
  agentId: string;
  agentType: string;
  workspaceId: string;
  similarity: number;
  observationId: string;
  observationText: string;
};

/** Callback invoked when the router decides to start a new agent. */
export type OnAgentMatch = (match: AgentMatch) => void;

/** Configuration for the agent activator's KNN search. */
export type AgentActivatorConfig = {
  similarityThreshold: number;
  knnCandidates: number;
};

/** Inflight tracker for background async work. */
export type InflightTracker = {
  track: (promise: Promise<unknown>) => void;
};

/** Dependencies injected into the agent activator. */
export type AgentActivatorDeps = {
  surreal: Surreal;
  loopDampener: LoopDampener;
  inflight: InflightTracker;
  onAgentMatch: OnAgentMatch;
  config?: Partial<AgentActivatorConfig>;
};

// ---------------------------------------------------------------------------
// Pure Functions
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: AgentActivatorConfig = {
  similarityThreshold: 0.3,
  knnCandidates: 20,
};

/**
 * Filters KNN candidates above the similarity threshold.
 */
export function filterAboveThreshold(
  candidates: ReadonlyArray<{ agentId: string; similarity: number }>,
  threshold: number,
): Array<{ agentId: string; similarity: number }> {
  return candidates.filter((c) => c.similarity >= threshold);
}

/**
 * Parses and validates the webhook payload from SurrealDB DEFINE EVENT.
 * Returns undefined if the payload is invalid.
 */
export function parseWebhookPayload(
  body: unknown,
): ObservationWebhookPayload | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;

  const observation_id = b.observation_id;
  const workspace = b.workspace;
  const embedding = b.embedding;
  const text = b.text;
  const severity = b.severity;
  const source_agent = b.source_agent;

  if (
    typeof observation_id !== "string" ||
    typeof text !== "string" ||
    typeof severity !== "string" ||
    typeof source_agent !== "string" ||
    !Array.isArray(embedding) ||
    embedding.length === 0
  ) {
    return undefined;
  }

  // workspace may be a string "workspace:id" or just the id
  let workspaceId: string;
  if (typeof workspace === "string") {
    workspaceId = workspace.includes(":") ? workspace.split(":").slice(1).join(":") : workspace;
  } else if (workspace instanceof RecordId) {
    workspaceId = workspace.id as string;
  } else {
    return undefined;
  }

  return {
    observation_id: typeof observation_id === "string" && observation_id.includes(":")
      ? observation_id.split(":").slice(1).join(":")
      : observation_id,
    workspace: workspaceId,
    embedding: embedding as number[],
    text,
    severity,
    source_agent,
  };
}

/**
 * Builds a dampener event key from webhook payload fields.
 */
export function buildDampenerEvent(
  workspaceId: string,
  entityId: string,
  sourceAgent: string,
): DampenerEvent {
  return { workspaceId, entityId, sourceAgent };
}

// ---------------------------------------------------------------------------
// DB Queries (Side-Effect Boundary)
// ---------------------------------------------------------------------------

type KnnCandidate = {
  agentId: string;
  agentType: string;
  similarity: number;
};

/**
 * Two-step KNN: observation embedding vs agent.description_embedding.
 * Step 1: KNN candidates from agent table (HNSW index, no WHERE)
 * Step 2: Filter application-side by similarity threshold
 */
async function findMatchingAgentTypes(
  surreal: Surreal,
  observationEmbedding: number[],
  config: AgentActivatorConfig,
): Promise<KnnCandidate[]> {
  const knnResult = await surreal.query<[Array<{
    id: RecordId;
    agent_type: string;
    similarity: number;
  }>]>(
    `SELECT
      id,
      agent_type,
      vector::similarity::cosine(description_embedding, $embedding) AS similarity
    FROM agent
    WHERE description_embedding <|${config.knnCandidates}, COSINE|> $embedding
    ORDER BY similarity DESC;`,
    { embedding: observationEmbedding },
  );

  const candidates = knnResult[0] ?? [];
  if (candidates.length === 0) {
    console.log(`[AgentActivator] KNN returned 0 agent candidates`);
    return [];
  }
  console.log(`[AgentActivator] KNN returned ${candidates.length} candidates, top similarity: ${candidates[0]?.similarity}`);

  const aboveThreshold = candidates
    .filter((c) => c.similarity >= config.similarityThreshold)
    .map((c) => ({
      agentId: c.id.id as string,
      agentType: c.agent_type,
      similarity: c.similarity,
    }));

  if (aboveThreshold.length === 0) {
    console.log(`[AgentActivator] No candidates above threshold ${config.similarityThreshold}`);
  } else {
    console.log(`[AgentActivator] ${aboveThreshold.length} candidates above threshold`);
  }

  return aboveThreshold;
}

/**
 * Resolves the target entity for an observation by querying the observes edge.
 */
async function resolveObservationTarget(
  surreal: Surreal,
  observationId: string,
): Promise<{ table: string; id: string } | undefined> {
  const obsRecord = new RecordId("observation", observationId);
  const result = await surreal.query<[Array<{ out: RecordId }>]>(
    `SELECT out FROM observes WHERE in = $obs LIMIT 1;`,
    { obs: obsRecord },
  );
  const edge = result[0]?.[0];
  if (edge?.out instanceof RecordId) {
    return { table: edge.out.table.name, id: edge.out.id as string };
  }
  return undefined;
}

/**
 * Checks whether the observation's target entity already has an active
 * agent session. If so, the proxy handles context enrichment.
 */
async function hasActiveCoverage(
  surreal: Surreal,
  target: { table: string; id: string },
  workspaceId: string,
): Promise<boolean> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const taskRecord = new RecordId(target.table, target.id);

  const result = await surreal.query<[Array<{ count: number }>]>(
    `SELECT count() AS count FROM agent_session
     WHERE task_id = $task AND workspace = $ws AND orchestrator_status = "active"
     LIMIT 1;`,
    { task: taskRecord, ws: workspaceRecord },
  );

  const count = result[0]?.[0]?.count ?? 0;
  return count > 0;
}

/**
 * Creates a meta-observation when the loop dampener activates.
 */
async function createDampeningMetaObservation(
  surreal: Surreal,
  workspaceId: string,
  entityId: string,
  sourceAgent: string,
): Promise<void> {
  const metaId = `meta-${crypto.randomUUID()}`;
  const metaRecord = new RecordId("observation", metaId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $obs CONTENT $content;`, {
    obs: metaRecord,
    content: {
      text: `Loop dampener activated: rapid-fire observations from ${sourceAgent} targeting ${entityId} have been dampened to prevent cascading agent invocations`,
      severity: "info",
      status: "open",
      category: "engineering",
      source_agent: "agent_activator",
      workspace: workspaceRecord,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// Agent Activator Handler (Side-Effect Shell)
// ---------------------------------------------------------------------------

/**
 * Creates the agent activator POST endpoint handler.
 *
 * Called by SurrealDB DEFINE EVENT webhook on observation CREATE.
 * Parses the webhook payload, checks loop dampener, checks active coverage,
 * runs KNN against agent description embeddings, invokes matched agents.
 */
export function createAgentActivatorHandler(deps: AgentActivatorDeps) {
  const { surreal, loopDampener, inflight, onAgentMatch } = deps;
  const config: AgentActivatorConfig = {
    ...DEFAULT_CONFIG,
    ...deps.config,
  };

  return async function handleObservationWebhook(request: Request): Promise<Response> {
    const body = await request.json().catch(() => undefined);
    const payload = parseWebhookPayload(body);

    if (!payload) {
      // Return 200 to prevent SurrealDB retries for invalid payloads
      return new Response("invalid payload", { status: 200 });
    }

    // Process async — return 200 immediately (same pattern as observer-route.ts)
    inflight.track(
      processObservation(payload).catch((err) => {
        console.error(
          `[AgentActivator] Failed to process observation ${payload.observation_id}:`,
          err instanceof Error ? err.message : String(err),
        );
      }),
    );

    return new Response("accepted", { status: 200 });
  };

  async function processObservation(payload: ObservationWebhookPayload): Promise<void> {
    const { observation_id, workspace, embedding, text, source_agent } = payload;

    // Resolve target entity for dampener keying and active coverage check
    const target = await resolveObservationTarget(surreal, observation_id);
    const dampenerEntityKey = target ? `${target.table}:${target.id}` : observation_id;
    const dampenerEvent = buildDampenerEvent(workspace, dampenerEntityKey, source_agent);
    const dampenerResult = loopDampener.record(dampenerEvent);

    if (dampenerResult.dampened) {
      await createDampeningMetaObservation(
        surreal,
        workspace,
        dampenerEntityKey,
        source_agent,
      ).catch((err) => {
        console.error(
          `[AgentActivator] Failed to create dampening meta-observation:`,
          err instanceof Error ? err.message : String(err),
        );
      });
      return;
    }

    // Skip if target entity already has an active agent session — proxy handles it
    if (target) {
      const covered = await hasActiveCoverage(surreal, target, workspace);
      if (covered) {
        console.log(`[AgentActivator] Skipping observation ${observation_id}: target ${target.table}:${target.id} has active agent coverage`);
        return;
      }
    }

    const matches = await findMatchingAgentTypes(surreal, embedding, config);

    for (const match of matches) {
      onAgentMatch({
        agentId: match.agentId,
        agentType: match.agentType,
        workspaceId: workspace,
        similarity: match.similarity,
        observationId: observation_id,
        observationText: text,
      });
    }
  }
}
