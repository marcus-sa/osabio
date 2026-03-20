/**
 * JIT learning loader for agent prompt injection.
 *
 * IO boundary: queries SurrealDB for active learnings.
 * Pure budget logic is exported for unit testing.
 */
import { RecordId, type Surreal } from "surrealdb";
import type { EntityPriority, LearningSource, LearningType } from "../../shared/contracts";
import { estimateTokens } from "./formatter";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LoadedLearning = {
  id: string;
  text: string;
  learningType: LearningType;
  source: LearningSource;
  priority: EntityPriority;
  createdAt: string;
  similarity?: number;
};

type LearningRow = {
  id: RecordId<"learning", string>;
  text: string;
  learning_type: LearningType;
  source: LearningSource;
  priority: EntityPriority;
  target_agents: string[];
  created_at: string | Date;
  similarity?: number;
};

export type TokenBudgetResult = {
  learnings: LoadedLearning[];
  constraintBudgetExceeded: boolean;
};

// ---------------------------------------------------------------------------
// Priority sort (pure)
// ---------------------------------------------------------------------------

const SOURCE_RANK: Record<string, number> = { human: 0, agent: 1 };
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function compareLearningPriority(a: LoadedLearning, b: LoadedLearning): number {
  const sourceCompare = (SOURCE_RANK[a.source] ?? 2) - (SOURCE_RANK[b.source] ?? 2);
  if (sourceCompare !== 0) return sourceCompare;

  const priorityCompare = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3);
  if (priorityCompare !== 0) return priorityCompare;

  // Newest first
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

// ---------------------------------------------------------------------------
// Token budget (pure)
// ---------------------------------------------------------------------------

const DEFAULT_TOKEN_BUDGET = 500;

/**
 * Applies token budget to sorted learnings.
 *
 * Rules:
 * - Constraints are ALWAYS included, never dropped (even if they alone exceed budget)
 * - Instructions fill remaining budget in priority order; oversized ones skipped
 * - Precedents fill remaining budget by similarity order
 */
export function applyTokenBudget(
  learnings: ReadonlyArray<LoadedLearning>,
  tokenBudget: number = DEFAULT_TOKEN_BUDGET,
): TokenBudgetResult {
  const constraints = learnings.filter((l) => l.learningType === "constraint");
  const instructions = learnings.filter((l) => l.learningType === "instruction");
  const precedents = learnings.filter((l) => l.learningType === "precedent");

  // Constraints always included
  let usedTokens = constraints.reduce((sum, c) => sum + estimateTokens(c.text), 0);
  const constraintBudgetExceeded = usedTokens > tokenBudget;
  if (constraintBudgetExceeded) {
    log.warn("learning.budget.constraints_exceeded", "Constraints alone exceed token budget", {
      constraintTokens: usedTokens,
      tokenBudget,
      constraintCount: constraints.length,
    });
  }

  // Instructions fill remaining budget; skip oversized, try next
  const includedInstructions: LoadedLearning[] = [];
  for (const instruction of instructions) {
    const tokens = estimateTokens(instruction.text);
    if (usedTokens + tokens <= tokenBudget) {
      includedInstructions.push(instruction);
      usedTokens += tokens;
    }
    // Skip oversized and try next (no break)
  }

  // Precedents fill remaining budget by similarity (already sorted by similarity from query)
  const includedPrecedents: LoadedLearning[] = [];
  for (const precedent of precedents) {
    const tokens = estimateTokens(precedent.text);
    if (usedTokens + tokens <= tokenBudget) {
      includedPrecedents.push(precedent);
      usedTokens += tokens;
    }
  }

  return {
    learnings: [...constraints, ...includedInstructions, ...includedPrecedents],
    constraintBudgetExceeded,
  };
}

// ---------------------------------------------------------------------------
// Row mapping (pure)
// ---------------------------------------------------------------------------

function toLoadedLearning(row: LearningRow): LoadedLearning {
  return {
    id: row.id.id as string,
    text: row.text,
    learningType: row.learning_type,
    source: row.source,
    priority: row.priority,
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString(),
    ...(row.similarity !== undefined ? { similarity: row.similarity } : {}),
  };
}

// ---------------------------------------------------------------------------
// Loader (IO boundary)
// ---------------------------------------------------------------------------

/**
 * Loads active learnings for prompt injection, applying priority sort and token budget.
 *
 * 1. Queries constraints + instructions (non-semantic, priority-sorted)
 * 2. If contextText provided, queries precedents via BM25 fulltext search
 * 3. Applies token budget (~500 tokens)
 */
export async function loadActiveLearnings(input: {
  surreal: Surreal;
  workspaceId: string;
  agentType: string;
  contextText?: string;
  tokenBudget?: number;
}): Promise<TokenBudgetResult> {
  const workspaceRecord = new RecordId("workspace", input.workspaceId);
  const budget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

  // Query constraints + instructions
  const [nonSemanticRows] = await input.surreal
    .query<[LearningRow[]]>(
      [
        "SELECT id, text, learning_type, source, priority, target_agents, created_at",
        "FROM learning",
        "WHERE workspace = $workspace",
        'AND status = "active"',
        'AND learning_type IN ["constraint", "instruction"]',
        "AND (array::len(target_agents) = 0 OR $agentType IN target_agents)",
        "ORDER BY created_at DESC",
        "LIMIT 50;",
      ].join(" "),
      { workspace: workspaceRecord, agentType: input.agentType },
    )
    .collect<[LearningRow[]]>();

  const nonSemanticLearnings = nonSemanticRows.map(toLoadedLearning);

  // Query precedents via BM25 fulltext search when context text is provided
  let precedentLearnings: LoadedLearning[] = [];
  if (input.contextText && input.contextText.trim().length > 0) {
    const escaped = input.contextText.trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const [candidates] = await input.surreal
      .query<[LearningRow[]]>(
        [
          `SELECT id, text, learning_type, source, priority, target_agents, created_at, workspace,`,
          `search::score(1) AS score`,
          `FROM learning`,
          `WHERE text @1@ '${escaped}'`,
          `AND workspace = $workspace`,
          `AND status = "active"`,
          `AND learning_type = "precedent"`,
          `AND (array::len(target_agents) = 0 OR $agentType IN target_agents)`,
          `ORDER BY score DESC`,
          `LIMIT 10;`,
        ].join(" "),
        {
          workspace: workspaceRecord,
          agentType: input.agentType,
        },
      )
      .collect<[LearningRow[]]>();

    precedentLearnings = candidates.map(toLoadedLearning);
  }

  // Sort non-semantic by priority, then apply budget
  const sortedNonSemantic = [...nonSemanticLearnings].sort(compareLearningPriority);
  const allLearnings = [...sortedNonSemantic, ...precedentLearnings];

  return applyTokenBudget(allLearnings, budget);
}
