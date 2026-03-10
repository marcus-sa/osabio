import { RecordId, type Surreal } from "surrealdb";
import type { SubagentTrace, SubagentTraceStep } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Row types returned by SurrealDB queries
// ---------------------------------------------------------------------------

type RootTraceRow = {
  id: RecordId<"trace", string>;
  type: string;
  tool_name?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  duration_ms?: number;
  created_at: Date;
  source_message: Array<RecordId<"message", string>>;
};

type ChildTraceRow = {
  id: RecordId<"trace", string>;
  type: string;
  parent_trace: RecordId<"trace", string>;
  tool_name?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  duration_ms?: number;
  created_at: Date;
};

// ---------------------------------------------------------------------------
// Pure reconstruction: trace rows -> SubagentTrace wire format
// ---------------------------------------------------------------------------

/**
 * Reconstruct SubagentTrace wire format from root and child trace rows.
 * Pure function - no IO, no side effects.
 */
export function reconstructTraces(
  rootRows: unknown[],
  childRows: unknown[],
): Map<string, SubagentTrace[]> {
  const roots = rootRows as RootTraceRow[];
  const children = childRows as ChildTraceRow[];

  if (roots.length === 0) return new Map();

  // Group children by parent_trace id
  const childrenByParent = new Map<string, ChildTraceRow[]>();
  for (const child of children) {
    const parentId = child.parent_trace.id as string;
    const existing = childrenByParent.get(parentId);
    if (existing) {
      existing.push(child);
    } else {
      childrenByParent.set(parentId, [child]);
    }
  }

  // Build traces grouped by message id
  const tracesByMessage = new Map<string, SubagentTrace[]>();

  for (const root of roots) {
    const messageId = extractMessageId(root.source_message);
    if (!messageId) continue;

    const rootId = root.id.id as string;
    const rootChildren = childrenByParent.get(rootId) ?? [];
    const steps = rootChildren.map(mapChildToStep);

    const input = root.input as Record<string, unknown> | undefined;
    const trace: SubagentTrace = {
      agentId: (input?.agentId as string) ?? "unknown",
      intent: (input?.intent as string) ?? "unknown",
      steps,
      totalDurationMs: root.duration_ms ?? 0,
    };

    const existing = tracesByMessage.get(messageId);
    if (existing) {
      existing.push(trace);
    } else {
      tracesByMessage.set(messageId, [trace]);
    }
  }

  return tracesByMessage;
}

function extractMessageId(sourceMessage: Array<{ id: string | unknown }>): string | undefined {
  if (!sourceMessage || sourceMessage.length === 0) return undefined;
  return sourceMessage[0]!.id as string;
}

function mapChildToStep(child: ChildTraceRow): SubagentTraceStep {
  if (child.type === "message") {
    return {
      type: "text",
      text: (child.input as Record<string, unknown>)?.text as string | undefined,
    };
  }

  return {
    type: "tool_call",
    ...(child.tool_name ? { toolName: child.tool_name } : {}),
    ...(child.input ? { argsJson: JSON.stringify(child.input) } : {}),
    ...(child.output ? { resultJson: JSON.stringify(child.output) } : {}),
    ...(child.duration_ms !== undefined ? { durationMs: child.duration_ms } : {}),
  };
}

// ---------------------------------------------------------------------------
// Write path: persist SubagentTrace as normalized trace records + spawns edge
// ---------------------------------------------------------------------------

/**
 * Persist a SubagentTrace as a root trace record + child trace records + spawns edge.
 * All records are created in a single transaction for atomicity.
 */
export async function persistSubagentTrace(
  surreal: Surreal,
  messageRecord: RecordId<"message", string>,
  workspaceRecord: RecordId<"workspace", string>,
  actorRecord: RecordId<"identity", string>,
  trace: SubagentTrace,
): Promise<void> {
  const rootId = crypto.randomUUID();
  const now = new Date();

  // Build child trace content records
  const childEntries = trace.steps.map((step, i) => ({
    id: crypto.randomUUID(),
    type: step.type === "text" ? "message" : "tool_call",
    tool_name: step.type === "tool_call" ? step.toolName : undefined,
    input: step.type === "tool_call"
      ? (step.argsJson ? JSON.parse(step.argsJson) : undefined)
      : (step.text ? { text: step.text } : undefined),
    output: step.type === "tool_call" && step.resultJson
      ? JSON.parse(step.resultJson)
      : undefined,
    duration_ms: step.durationMs,
    created_at: new Date(now.getTime() + i + 1),
  }));

  // Single transaction: root + children + spawns edge
  const childCreates = childEntries
    .map((c) => {
      const fields = [
        `type: ${JSON.stringify(c.type)}`,
        `actor: $actor`,
        `workspace: $workspace`,
        `parent_trace: $rootRecord`,
        `created_at: <datetime> ${JSON.stringify(c.created_at.toISOString())}`,
      ];
      if (c.tool_name) fields.push(`tool_name: ${JSON.stringify(c.tool_name)}`);
      if (c.input) fields.push(`input: ${JSON.stringify(c.input)}`);
      if (c.output) fields.push(`output: ${JSON.stringify(c.output)}`);
      if (c.duration_ms !== undefined) fields.push(`duration_ms: ${c.duration_ms}`);
      return `CREATE type::thing("trace", ${JSON.stringify(c.id)}) CONTENT { ${fields.join(", ")} };`;
    })
    .join("\n    ");

  await surreal.query(
    `
    BEGIN TRANSACTION;
    LET $rootRecord = type::thing("trace", $rootId);
    CREATE $rootRecord CONTENT {
      type: "subagent_spawn",
      actor: $actor,
      workspace: $workspace,
      tool_name: "invoke_pm_agent",
      input: $rootInput,
      duration_ms: $durationMs,
      created_at: <datetime> $now
    };
    ${childCreates}
    RELATE $message -> spawns -> $rootRecord;
    COMMIT TRANSACTION;
    `,
    {
      rootId,
      actor: actorRecord,
      workspace: workspaceRecord,
      rootInput: { intent: trace.intent, agentId: trace.agentId },
      durationMs: trace.totalDurationMs,
      now: now.toISOString(),
      message: messageRecord,
    },
  );
}

// ---------------------------------------------------------------------------
// Batch loading: 2-query pattern
// ---------------------------------------------------------------------------

/**
 * Batch-load SubagentTraces for a set of message IDs.
 * Uses exactly 2 queries: one for root traces via spawns edges, one for children.
 * Returns a Map keyed by message ID (string) to SubagentTrace[].
 * Messages with no traces are simply absent from the Map.
 */
export async function batchLoadTraces(
  surreal: Surreal,
  messageIds: RecordId<"message", string>[],
): Promise<Map<string, SubagentTrace[]>> {
  if (messageIds.length === 0) return new Map();

  // Query 1: All root traces for the message batch via spawns edges
  const [rootRows] = await surreal
    .query<[RootTraceRow[]]>(
      "SELECT *, <-spawns<-message AS source_message FROM trace WHERE <-spawns<-message CONTAINSANY $message_ids;",
      { message_ids: messageIds },
    )
    .collect<[RootTraceRow[]]>();

  if (rootRows.length === 0) return new Map();

  // Query 2: All children of those roots
  const rootIds = rootRows.map((r) => r.id);
  const [childRows] = await surreal
    .query<[ChildTraceRow[]]>(
      "SELECT * FROM trace WHERE parent_trace INSIDE $root_ids ORDER BY created_at ASC, id ASC;",
      { root_ids: rootIds },
    )
    .collect<[ChildTraceRow[]]>();

  return reconstructTraces(rootRows, childRows);
}
