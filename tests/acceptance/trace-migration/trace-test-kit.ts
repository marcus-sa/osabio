import { randomUUID } from "node:crypto";
import { RecordId, type Surreal } from "surrealdb";
import type { SubagentTrace } from "../../../app/src/shared/contracts";
import { fetchJson, type TestUser } from "../acceptance-test-kit";

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

export type TraceFixture = {
  rootTraceId: string;
  childTraceIds: string[];
  spawnsEdgeId: string;
};

export type SeededConversation = {
  workspaceId: string;
  workspaceRecord: RecordId<"workspace", string>;
  conversationId: string;
  conversationRecord: RecordId<"conversation", string>;
  identityRecord: RecordId<"identity", string>;
};

// ---------------------------------------------------------------------------
// Workspace + conversation scaffolding
// ---------------------------------------------------------------------------

export async function seedConversation(
  baseUrl: string,
  surreal: Surreal,
  user: TestUser,
  suffix: string,
): Promise<SeededConversation> {
  const workspace = await fetchJson<{ workspaceId: string; conversationId: string }>(
    `${baseUrl}/api/workspaces`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ name: `TraceMigration ${suffix} ${randomUUID().slice(0, 8)}` }),
    },
  );

  const workspaceRecord = new RecordId("workspace", workspace.workspaceId);

  // Mark onboarding complete so bootstrap returns full messages
  await surreal.update(workspaceRecord).merge({
    onboarding_complete: true,
    onboarding_summary_pending: false,
    onboarding_completed_at: new Date(),
  });

  // Create an identity record (required for trace.actor)
  const identityId = randomUUID();
  const identityRecord = new RecordId("identity", identityId);
  await surreal.create(identityRecord).content({
    name: `test-user-${suffix}`,
    type: "human",
    workspace: workspaceRecord,
    created_at: new Date(),
  });

  return {
    workspaceId: workspace.workspaceId,
    workspaceRecord,
    conversationId: workspace.conversationId,
    conversationRecord: new RecordId("conversation", workspace.conversationId),
    identityRecord,
  };
}

// ---------------------------------------------------------------------------
// Message seeding
// ---------------------------------------------------------------------------

export async function seedAssistantMessage(
  surreal: Surreal,
  conversationRecord: RecordId<"conversation", string>,
  text: string,
  createdAt?: Date,
): Promise<RecordId<"message", string>> {
  const messageRecord = new RecordId("message", randomUUID());
  await surreal.create(messageRecord).content({
    conversation: conversationRecord,
    role: "assistant",
    text,
    createdAt: createdAt ?? new Date(),
  });
  return messageRecord;
}

export async function seedUserMessage(
  surreal: Surreal,
  conversationRecord: RecordId<"conversation", string>,
  text: string,
  createdAt?: Date,
): Promise<RecordId<"message", string>> {
  const messageRecord = new RecordId("message", randomUUID());
  await surreal.create(messageRecord).content({
    conversation: conversationRecord,
    role: "user",
    text,
    createdAt: createdAt ?? new Date(),
  });
  return messageRecord;
}

// ---------------------------------------------------------------------------
// Trace seeding (simulates the normalized write path)
// ---------------------------------------------------------------------------

/**
 * Seed a full trace tree for a message: root trace + child traces + spawns edge.
 * This simulates what chat-route.ts onFinish will do after migration.
 */
export async function seedTraceForMessage(
  surreal: Surreal,
  messageRecord: RecordId<"message", string>,
  workspaceRecord: RecordId<"workspace", string>,
  identityRecord: RecordId<"identity", string>,
  trace: SubagentTrace,
): Promise<TraceFixture> {
  const rootTraceId = randomUUID();
  const rootTraceRecord = new RecordId("trace", rootTraceId);
  const now = new Date();

  // Create root trace record (type: "subagent_spawn")
  await surreal.create(rootTraceRecord).content({
    type: "subagent_spawn",
    actor: identityRecord,
    workspace: workspaceRecord,
    tool_name: "invoke_pm_agent",
    input: { intent: trace.intent, agentId: trace.agentId },
    duration_ms: trace.totalDurationMs,
    created_at: now,
  });

  // Create child trace records for each step (offset created_at for deterministic ordering)
  const childTraceIds: string[] = [];
  for (let i = 0; i < trace.steps.length; i++) {
    const step = trace.steps[i]!;
    const childId = randomUUID();
    const childRecord = new RecordId("trace", childId);
    childTraceIds.push(childId);
    const childTime = new Date(now.getTime() + i + 1);

    if (step.type === "tool_call") {
      await surreal.create(childRecord).content({
        type: "tool_call",
        actor: identityRecord,
        workspace: workspaceRecord,
        parent_trace: rootTraceRecord,
        tool_name: step.toolName,
        input: step.argsJson ? JSON.parse(step.argsJson) : undefined,
        output: step.resultJson ? JSON.parse(step.resultJson) : undefined,
        duration_ms: step.durationMs,
        created_at: childTime,
      });
    } else {
      // type: "text" → stored as type: "message" in trace table
      await surreal.create(childRecord).content({
        type: "message",
        actor: identityRecord,
        workspace: workspaceRecord,
        parent_trace: rootTraceRecord,
        input: { text: step.text },
        created_at: childTime,
      });
    }
  }

  // Create spawns edge: message ->spawns-> root trace
  const spawnsId = randomUUID();
  await surreal
    .relate(messageRecord, new RecordId("spawns", spawnsId), rootTraceRecord, {})
    .output("after");

  return { rootTraceId, childTraceIds, spawnsEdgeId: spawnsId };
}

// ---------------------------------------------------------------------------
// Sample trace fixtures
// ---------------------------------------------------------------------------

export function makeSampleTrace(overrides?: Partial<SubagentTrace>): SubagentTrace {
  return {
    agentId: "pm_agent",
    intent: "plan_work",
    totalDurationMs: 1500,
    steps: [
      {
        type: "tool_call",
        toolName: "search_entities",
        argsJson: JSON.stringify({ query: "dashboard features" }),
        resultJson: JSON.stringify({ results: [] }),
        durationMs: 200,
      },
      {
        type: "tool_call",
        toolName: "create_work_item",
        argsJson: JSON.stringify({ title: "Build dashboard", kind: "task" }),
        resultJson: JSON.stringify({ id: "task:abc123" }),
        durationMs: 300,
      },
      {
        type: "text",
        text: "I've created a task for the dashboard feature.",
      },
    ],
    ...overrides,
  };
}

export function makeSampleTraceMinimal(): SubagentTrace {
  return {
    agentId: "pm_agent",
    intent: "check_status",
    totalDurationMs: 400,
    steps: [
      {
        type: "tool_call",
        toolName: "get_project_status",
        argsJson: JSON.stringify({ projectId: "proj-1" }),
        resultJson: JSON.stringify({ status: "active", taskCount: 3 }),
        durationMs: 400,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Query trace records linked to a message via spawns edge.
 */
export async function querySpawnedTraces(
  surreal: Surreal,
  messageRecord: RecordId<"message", string>,
): Promise<Array<{ id: RecordId; type: string; parent_trace?: RecordId }>> {
  const [rows] = await surreal
    .query<[Array<{ id: RecordId; type: string; parent_trace?: RecordId }>]>(
      "SELECT id, type, parent_trace FROM trace WHERE <-spawns<-message CONTAINS $msg;",
      { msg: messageRecord },
    )
    .collect<[Array<{ id: RecordId; type: string; parent_trace?: RecordId }>]>();
  return rows;
}

/**
 * Query all child traces for a root trace.
 */
export async function queryChildTraces(
  surreal: Surreal,
  rootTraceRecord: RecordId<"trace", string>,
): Promise<Array<{ id: RecordId; type: string; tool_name?: string; input?: Record<string, unknown> }>> {
  const [rows] = await surreal
    .query<[Array<{ id: RecordId; type: string; tool_name?: string; input?: Record<string, unknown> }>]>(
      "SELECT id, type, tool_name, input, created_at FROM trace WHERE parent_trace = $root ORDER BY created_at ASC, id ASC;",
      { root: rootTraceRecord },
    )
    .collect<[Array<{ id: RecordId; type: string; tool_name?: string; input?: Record<string, unknown> }>]>();
  return rows;
}
