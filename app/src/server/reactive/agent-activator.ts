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
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { log } from "../telemetry/logger";
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
  classifierModel: LanguageModel;
  onAgentActivation: OnAgentActivation;
  /** Shared secret for webhook authentication. If undefined, all requests are allowed (dev mode). */
  internalWebhookSecret?: string;
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

  const rawObsId = b.observation_id;
  const workspace = b.workspace;
  const text = b.text;
  const severity = b.severity;
  const source_agent = b.source_agent;

  if (
    typeof text !== "string" ||
    typeof severity !== "string" ||
    typeof source_agent !== "string" ||
    !rawObsId ||
    !workspace
  ) {
    return undefined;
  }

  // observation_id may be a string "observation:id", a bare id, or a RecordId object
  let observationId: string;
  if (typeof rawObsId === "string") {
    observationId = rawObsId.includes(":") ? rawObsId.split(":").slice(1).join(":") : rawObsId;
  } else if (rawObsId instanceof RecordId) {
    observationId = rawObsId.id as string;
  } else {
    return undefined;
  }

  // workspace may be a string "workspace:id", a bare id, or a RecordId object
  let workspaceId: string;
  if (typeof workspace === "string") {
    workspaceId = workspace.includes(":") ? workspace.split(":").slice(1).join(":") : workspace;
  } else if (workspace instanceof RecordId) {
    workspaceId = workspace.id as string;
  } else {
    return undefined;
  }

  return {
    observation_id: observationId,
    workspace: workspaceId,
    text,
    severity,
    source_agent,
  };
}

/**
 * Validates the webhook request's Authorization header against the shared secret.
 * Returns true if the secret is not configured (dev mode) or if the header matches.
 */
export function validateWebhookSecret(
  authHeader: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) return true; // dev mode: no secret configured, allow all
  if (!authHeader) return false;
  return authHeader === `Bearer ${secret}`;
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
 * Creates a governance observation when the LLM hallucinates unknown agent IDs.
 * Makes the hallucination visible in the feed for human oversight.
 */
async function createHallucinationObservation(
  surreal: Surreal,
  workspaceId: string,
  observationId: string,
  hallucinatedIds: string[],
): Promise<void> {
  const metaId = `meta-halluc-${crypto.randomUUID()}`;
  const metaRecord = new RecordId("observation", metaId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const sourceObsRecord = new RecordId("observation", observationId);

  await surreal.query(`CREATE $obs CONTENT $content;`, {
    obs: metaRecord,
    content: {
      text: `Agent activator LLM hallucinated ${hallucinatedIds.length} agent ID(s) for observation ${observationId}: ${hallucinatedIds.join(", ")}`,
      severity: "info",
      status: "open",
      category: "engineering",
      source_agent: "agent_activator",
      workspace: workspaceRecord,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  // Link to the source observation
  await surreal.query(
    `RELATE $meta->observes->$obs SET created_at = time::now();`,
    { meta: metaRecord, obs: sourceObsRecord },
  );
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
  const { surreal, loopDampener, inflight, classifierModel, onAgentActivation, internalWebhookSecret } = deps;

  return async function handleObservationWebhook(request: Request): Promise<Response> {
    // Validate shared secret if configured
    const authHeader = request.headers.get("authorization") ?? undefined;
    if (!validateWebhookSecret(authHeader, internalWebhookSecret)) {
      return new Response("unauthorized", { status: 401 });
    }

    const body = await request.json().catch(() => undefined);
    const payload = parseWebhookPayload(body);

    if (!payload) {
      return new Response("invalid payload", { status: 200 });
    }

    // Process async — return 200 immediately (same pattern as observer-route.ts)
    inflight.track(
      processObservation(payload).catch((err) => {
        log.error("activator.process_failed", "Failed to process observation", {
          observationId: payload.observation_id,
          error: err instanceof Error ? err.message : String(err),
        });
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
        log.error("activator.dampening_meta_failed", "Failed to create dampening meta-observation", {
          workspaceId: workspace,
          entityId: dampenerEntityKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      return;
    }

    // Skip if target entity already has an active agent session — proxy handles it
    if (target) {
      const covered = await hasActiveCoverage(surreal, target, workspace);
      if (covered) {
        log.info("activator.skipped_active_coverage", "Skipping observation — target has active agent session", {
          observationId: observation_id,
          target: `${target.table}:${target.id}`,
          workspaceId: workspace,
        });
        return;
      }
    }

    // Load registered agents for this workspace
    const agents = await loadWorkspaceAgents(surreal, workspace);
    if (agents.length === 0) {
      log.warn("activator.no_agents", "No agents registered with descriptions in workspace", {
          workspaceId: workspace,
          observationId: observation_id,
        });
      return;
    }

    // LLM classification: which agents should handle this observation?
    const prompt = buildClassificationPrompt({ text, severity }, agents);
    const classification = await generateObject({
      model: classifierModel,
      schema: classificationSchema,
      prompt,
    });

    const activations = classification.object.activations;
    log.info("activator.classified", "LLM classified agents for observation", {
      observationId: observation_id,
      agentCount: activations.length,
      workspaceId: workspace,
    });

    // Validate agent IDs against registered agents
    const agentMap = new Map(agents.map((a) => [a.agentId, a]));
    const validActivations: Array<{ agent: RegisteredAgent; reason: string }> = [];
    const hallucinatedIds: string[] = [];

    for (const activation of activations) {
      const agent = agentMap.get(activation.agent_id);
      if (!agent) {
        log.warn("activator.hallucinated_agent", "LLM returned unknown agent_id", {
          agentId: activation.agent_id,
          observationId: observation_id,
          workspaceId: workspace,
        });
        hallucinatedIds.push(activation.agent_id);
        continue;
      }
      validActivations.push({ agent, reason: activation.reason });
    }

    // Create governance observation for hallucinated agent IDs
    if (hallucinatedIds.length > 0) {
      await createHallucinationObservation(
        surreal,
        workspace,
        observation_id,
        hallucinatedIds,
      ).catch((err) => {
        log.error("activator.hallucination_obs_failed", "Failed to create hallucination observation", {
          observationId: observation_id,
          workspaceId: workspace,
          error: err instanceof Error ? err.message : String(err),
        });
      });
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
        log.error("activator.decision_failed", "Failed to create activation decision", {
          observationId: observation_id,
          workspaceId: workspace,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Start agent sessions for matched agents
    for (const { agent, reason } of validActivations) {
      try {
        await createActivatedSession(surreal, {
          agentType: agent.agentType,
          workspaceId: workspace,
          observationId: observation_id,
        });
      } catch (err) {
        log.error("activator.session_failed", "Failed to create activated session", {
          agentType: agent.agentType,
          observationId: observation_id,
          workspaceId: workspace,
          error: err instanceof Error ? err.message : String(err),
        });
        continue; // skip activation callback — no DB record exists
      }

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
