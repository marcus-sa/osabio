/**
 * Agent Activator
 *
 * POST endpoint handler called by SurrealDB DEFINE EVENT webhook when
 * observations are created. Uses LLM classification to determine which
 * registered agent types should be activated for a given observation,
 * then starts new agent sessions for matched agents.
 *
 * Observations targeting entities with active agent sessions are skipped —
 * the LLM proxy handles enriching those sessions via its own vector search.
 *
 * LLM classification over KNN because the question is "which agents can
 * ACT on this observation?" — a judgment problem, not a proximity problem.
 * See ADR-061.
 *
 * Step: 03-02 (Graph-Reactive Coordination)
 */
import { RecordId, type Surreal } from "surrealdb";
import { generateObject } from "ai";
import { z } from "zod";
import type { LoopDampener, DampenerEvent } from "./loop-dampener";

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

/** Webhook payload from SurrealDB DEFINE EVENT on observation CREATE. */
export type ObservationWebhookPayload = {
  observation_id: string;
  workspace: string;
  text: string;
  severity: string;
  source_agent: string;
};

/** A registered agent type with its description. */
export type RegisteredAgent = {
  agentId: string;
  agentType: string;
  description: string;
};

/** An agent matched by LLM classification for activation. */
export type AgentActivation = {
  agentId: string;
  agentType: string;
  workspaceId: string;
  reason: string;
  observationId: string;
  observationText: string;
};

/** Callback invoked when the activator decides to start a new agent. */
export type OnAgentActivation = (activation: AgentActivation) => void;

/** Inflight tracker for background async work. */
export type InflightTracker = {
  track: (promise: Promise<unknown>) => void;
};

/** Dependencies injected into the agent activator. */
export type AgentActivatorDeps = {
  surreal: Surreal;
  loopDampener: LoopDampener;
  inflight: InflightTracker;
  classifierModel: unknown; // AI SDK LanguageModel (Haiku)
  onAgentActivation: OnAgentActivation;
};

// ---------------------------------------------------------------------------
// Pure Functions
// ---------------------------------------------------------------------------

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
  const text = b.text;
  const severity = b.severity;
  const source_agent = b.source_agent;

  if (
    typeof observation_id !== "string" ||
    typeof text !== "string" ||
    typeof severity !== "string" ||
    typeof source_agent !== "string"
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

/**
 * Builds the LLM classification prompt from observation + agent descriptions.
 */
export function buildClassificationPrompt(
  observation: { text: string; severity: string },
  agents: ReadonlyArray<RegisteredAgent>,
): string {
  const agentList = agents
    .map((a) => `- Agent "${a.agentId}" (type: ${a.agentType}): ${a.description}`)
    .join("\n");

  return `You are an agent activator. Given an observation from a knowledge graph, determine which registered agents should be started to handle it.

## Observation
Severity: ${observation.severity}
Text: ${observation.text}

## Registered Agents
${agentList}

## Instructions
- Select agents that can TAKE ACTION on this observation (not just agents with related keywords)
- Consider the severity: conflict observations need immediate action, info observations may not need any agent
- If no agent is relevant, return an empty list
- For each selected agent, explain briefly why it should be activated`;
}

// ---------------------------------------------------------------------------
// LLM Classification Schema
// ---------------------------------------------------------------------------

const classificationSchema = z.object({
  activations: z.array(z.object({
    agent_id: z.string().describe("The agent ID to activate"),
    reason: z.string().describe("Brief explanation of why this agent should handle the observation"),
  })),
});

// ---------------------------------------------------------------------------
// DB Queries (Side-Effect Boundary)
// ---------------------------------------------------------------------------

/**
 * Loads all registered agents for a workspace (via identity membership).
 */
async function loadWorkspaceAgents(
  surreal: Surreal,
  workspaceId: string,
): Promise<RegisteredAgent[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  // Two-step: get workspace member identities, then find their agents
  const result = await surreal.query<[unknown, Array<{
    id: RecordId;
    agent_type: string;
    description: string;
  }>]>(
    `LET $members = (SELECT VALUE in FROM member_of WHERE out = $ws);
     SELECT id, agent_type, description FROM agent
     WHERE managed_by IN $members
     AND description IS NOT NONE;`,
    { ws: workspaceRecord },
  );

  return (result[1] ?? []).map((a) => ({
    agentId: a.id.id as string,
    agentType: a.agent_type,
    description: a.description,
  }));
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
 * Creates a new agent session for a matched agent, marking it as "spawning".
 */
async function createActivatedSession(
  surreal: Surreal,
  match: { agentType: string; workspaceId: string; observationId: string },
): Promise<string> {
  const sessionId = `sess-${crypto.randomUUID()}`;
  const sessionRecord = new RecordId("agent_session", sessionId);
  const workspaceRecord = new RecordId("workspace", match.workspaceId);
  const observationRecord = new RecordId("observation", match.observationId);

  await surreal.query(`CREATE $sess CONTENT $content;`, {
    sess: sessionRecord,
    content: {
      agent: match.agentType,
      started_at: new Date(),
      workspace: workspaceRecord,
      orchestrator_status: "spawning",
      source: "activator",
      triggered_by: observationRecord,
      created_at: new Date(),
    },
  });

  return sessionId;
}

/**
 * Creates a provisional decision recording the activator's routing choice.
 * Only for conflict/warning severity observations. Links to the observation
 * via relates_to edge. Appears in the governance feed for human oversight.
 */
async function createActivationDecision(
  surreal: Surreal,
  workspaceId: string,
  observationId: string,
  observationText: string,
  severity: string,
  activatedAgents: Array<{ agentType: string; reason: string }>,
): Promise<string> {
  const decisionId = `dec-act-${crypto.randomUUID()}`;
  const decisionRecord = new RecordId("decision", decisionId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const observationRecord = new RecordId("observation", observationId);

  const agentSummary = activatedAgents.length > 0
    ? activatedAgents.map((a) => `${a.agentType}: ${a.reason}`).join("; ")
    : "No agents matched — observation logged for future context";

  const summary = activatedAgents.length > 0
    ? `Activated ${activatedAgents.length} agent(s) for ${severity} observation`
    : `No agents activated for ${severity} observation`;

  await surreal.query(`CREATE $dec CONTENT $content;`, {
    dec: decisionRecord,
    content: {
      summary,
      rationale: `Observation: "${observationText}"\n\nRouting: ${agentSummary}`,
      status: "provisional",
      inferred_by: "agent_activator",
      category: "operations",
      workspace: workspaceRecord,
      based_on: [observationRecord],
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  // Link decision to observation
  await surreal.query(
    `RELATE $dec->relates_to->$obs SET created_at = time::now();`,
    { dec: decisionRecord, obs: observationRecord },
  );

  return decisionId;
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
 * uses LLM to classify which agents should handle the observation,
 * starts new agent sessions for matched agents.
 */
export function createAgentActivatorHandler(deps: AgentActivatorDeps) {
  const { surreal, loopDampener, inflight, classifierModel, onAgentActivation } = deps;

  return async function handleObservationWebhook(request: Request): Promise<Response> {
    const body = await request.json().catch(() => undefined);
    const payload = parseWebhookPayload(body);

    if (!payload) {
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
    const { observation_id, workspace, text, severity, source_agent } = payload;

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

    // Load registered agents for this workspace
    const agents = await loadWorkspaceAgents(surreal, workspace);
    if (agents.length === 0) {
      console.log(`[AgentActivator] No registered agents with descriptions in workspace ${workspace}`);
      return;
    }

    // LLM classification: which agents should handle this observation?
    const prompt = buildClassificationPrompt({ text, severity }, agents);
    const classification = await generateObject({
      model: classifierModel as any,
      schema: classificationSchema,
      prompt,
    });

    const activations = classification.object.activations;
    console.log(`[AgentActivator] LLM classified ${activations.length} agents for observation ${observation_id}`);

    // Validate agent IDs against registered agents
    const agentMap = new Map(agents.map((a) => [a.agentId, a]));
    const validActivations: Array<{ agent: RegisteredAgent; reason: string }> = [];

    for (const activation of activations) {
      const agent = agentMap.get(activation.agent_id);
      if (!agent) {
        console.log(`[AgentActivator] LLM returned unknown agent_id "${activation.agent_id}", skipping`);
        continue;
      }
      validActivations.push({ agent, reason: activation.reason });
    }

    // Record the routing decision for conflict/warning observations (governance trail)
    if (severity === "conflict" || severity === "warning") {
      await createActivationDecision(
        surreal,
        workspace,
        observation_id,
        text,
        severity,
        validActivations.map((v) => ({ agentType: v.agent.agentType, reason: v.reason })),
      ).catch((err) => {
        console.error(
          `[AgentActivator] Failed to create activation decision:`,
          err instanceof Error ? err.message : String(err),
        );
      });
    }

    // Start agent sessions for matched agents
    for (const { agent, reason } of validActivations) {
      await createActivatedSession(surreal, {
        agentType: agent.agentType,
        workspaceId: workspace,
        observationId: observation_id,
      }).catch((err) => {
        console.error(
          `[AgentActivator] Failed to create activated session for ${agent.agentType}:`,
          err instanceof Error ? err.message : String(err),
        );
      });

      onAgentActivation({
        agentId: agent.agentId,
        agentType: agent.agentType,
        workspaceId: workspace,
        reason,
        observationId: observation_id,
        observationText: text,
      });
    }
  }
}
