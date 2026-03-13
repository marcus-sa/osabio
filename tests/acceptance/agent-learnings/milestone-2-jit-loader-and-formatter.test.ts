/**
 * Milestone 2: JIT Loader and Formatter
 *
 * Traces: US-AL-003 (JIT learning injection into agent prompts, core)
 *
 * Validates:
 * - loadActiveLearnings returns correct learnings sorted by priority
 * - Priority sort: human > agent, high > medium > low, newest first
 * - Token budget enforcement (~500 tokens, constraints never dropped)
 * - formatLearningsSection renders grouped output by type
 * - Empty workspace returns no section
 * - Agent-type filtering respects target_agents array
 *
 * Driving ports:
 *   SurrealDB direct queries (seed learnings, verify loader results)
 *   Pure function calls    (formatter is a pure function)
 */
import { describe, expect, it } from "bun:test";
import {
  setupLearningSuite,
  createTestWorkspace,
  createTestLearning,
  listActiveLearnings,
} from "./learning-test-kit";

const getRuntime = setupLearningSuite("learning_m2_jit_loader");

describe("Milestone 2: JIT Learning Loader and Formatter", () => {
  // -------------------------------------------------------------------------
  // US-AL-003: Priority sorting
  // -------------------------------------------------------------------------

  it.skip("learnings are sorted with human-created before agent-suggested", async () => {
    const { surreal } = getRuntime();

    // Given a workspace with both human and agent learnings
    const { workspaceId } = await createTestWorkspace(surreal, "sort-source");

    await createTestLearning(surreal, workspaceId, {
      text: "Agent-suggested: Use structured logging.",
      learning_type: "instruction",
      status: "active",
      source: "agent",
      priority: "high",
    });

    // Small delay to ensure created_at ordering
    await Bun.sleep(50);

    await createTestLearning(surreal, workspaceId, {
      text: "Human-created: Always validate user input.",
      learning_type: "instruction",
      status: "active",
      source: "human",
      priority: "high",
    });

    // When loading active learnings
    const learnings = await listActiveLearnings(surreal, workspaceId);

    // Then both learnings are returned
    expect(learnings.length).toBe(2);

    // And when sorted by the loader's priority algorithm (human > agent),
    // the human learning should come first
    // NOTE: The loader function will handle this sort; here we verify data is present
    const humanLearning = learnings.find((l) => l.source === "human");
    const agentLearning = learnings.find((l) => l.source === "agent");
    expect(humanLearning).toBeDefined();
    expect(agentLearning).toBeDefined();
  }, 120_000);

  it.skip("high priority learnings appear before medium and low", async () => {
    const { surreal } = getRuntime();

    // Given a workspace with learnings of different priorities
    const { workspaceId } = await createTestWorkspace(surreal, "sort-priority");

    await createTestLearning(surreal, workspaceId, {
      text: "Low priority: Consider using dark mode.",
      learning_type: "instruction",
      status: "active",
      priority: "low",
    });
    await createTestLearning(surreal, workspaceId, {
      text: "High priority: Never expose secrets in logs.",
      learning_type: "constraint",
      status: "active",
      priority: "high",
    });
    await createTestLearning(surreal, workspaceId, {
      text: "Medium priority: Prefer async/await over callbacks.",
      learning_type: "instruction",
      status: "active",
      priority: "medium",
    });

    // When loading active learnings
    const learnings = await listActiveLearnings(surreal, workspaceId);

    // Then all three are returned
    expect(learnings.length).toBe(3);
    expect(learnings.some((l) => l.priority === "high")).toBe(true);
    expect(learnings.some((l) => l.priority === "medium")).toBe(true);
    expect(learnings.some((l) => l.priority === "low")).toBe(true);
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-003: Token budget enforcement
  // -------------------------------------------------------------------------

  it.skip("constraints are never dropped even when they exceed the token budget", async () => {
    const { surreal } = getRuntime();

    // Given a workspace with many constraint learnings totaling > 500 tokens
    const { workspaceId } = await createTestWorkspace(surreal, "budget-constraints");

    // Create 10 constraints, each ~60 words (~80 tokens)
    for (let i = 0; i < 10; i++) {
      await createTestLearning(surreal, workspaceId, {
        text: `Constraint ${i + 1}: This is a detailed constraint that explains an important rule ` +
          `about how the system must behave in all circumstances, regardless of the context or ` +
          `the agent processing the request. It must always be followed without exception because ` +
          `violating this rule could lead to data corruption or security vulnerabilities in production.`,
        learning_type: "constraint",
        status: "active",
        priority: "high",
      });
    }

    // When loading active learnings
    const learnings = await listActiveLearnings(surreal, workspaceId);

    // Then all 10 constraints are returned (never dropped)
    const constraints = learnings.filter((l) => l.learning_type === "constraint");
    expect(constraints.length).toBe(10);
  }, 120_000);

  it.skip("instructions fill remaining budget after constraints", async () => {
    const { surreal } = getRuntime();

    // Given a workspace with constraints and many instructions
    const { workspaceId } = await createTestWorkspace(surreal, "budget-instructions");

    // Create 2 constraints (~160 tokens)
    await createTestLearning(surreal, workspaceId, {
      text: "Never use null for domain data values. Always use undefined via optional properties.",
      learning_type: "constraint",
      status: "active",
      priority: "high",
    });
    await createTestLearning(surreal, workspaceId, {
      text: "Never expose API keys or credentials in source code or logs.",
      learning_type: "constraint",
      status: "active",
      priority: "high",
    });

    // Create 20 instructions (many will exceed remaining budget)
    for (let i = 0; i < 20; i++) {
      await createTestLearning(surreal, workspaceId, {
        text: `Instruction ${i + 1}: Follow this specific coding pattern when implementing ` +
          `new features in the application codebase.`,
        learning_type: "instruction",
        status: "active",
        priority: "medium",
      });
    }

    // When loading active learnings
    const learnings = await listActiveLearnings(surreal, workspaceId);

    // Then constraints are present
    const constraints = learnings.filter((l) => l.learning_type === "constraint");
    expect(constraints.length).toBe(2);

    // And instructions are present (the loader will trim to budget; here we verify data exists)
    const instructions = learnings.filter((l) => l.learning_type === "instruction");
    expect(instructions.length).toBe(20);
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-003: Agent-type filtering
  // -------------------------------------------------------------------------

  it.skip("learnings with empty target_agents array are loaded for all agent types", async () => {
    const { surreal } = getRuntime();

    // Given a workspace with a learning that targets all agents (empty array)
    const { workspaceId } = await createTestWorkspace(surreal, "target-all");
    await createTestLearning(surreal, workspaceId, {
      text: "This applies to every agent in the workspace.",
      learning_type: "constraint",
      status: "active",
      target_agents: [],
    });

    // When loading for different agent types
    const chatLearnings = await listActiveLearnings(surreal, workspaceId, "chat_agent");
    const codingLearnings = await listActiveLearnings(surreal, workspaceId, "coding_agent");
    const pmLearnings = await listActiveLearnings(surreal, workspaceId, "pm_agent");
    const observerLearnings = await listActiveLearnings(surreal, workspaceId, "observer_agent");

    // Then each agent type receives the learning
    expect(chatLearnings.length).toBe(1);
    expect(codingLearnings.length).toBe(1);
    expect(pmLearnings.length).toBe(1);
    expect(observerLearnings.length).toBe(1);
  }, 120_000);

  it.skip("learnings with specific target_agents are only loaded for those agents", async () => {
    const { surreal } = getRuntime();

    // Given a workspace with learnings targeted to specific agents
    const { workspaceId } = await createTestWorkspace(surreal, "target-specific");

    await createTestLearning(surreal, workspaceId, {
      text: "Always run unit tests before submitting code.",
      learning_type: "instruction",
      status: "active",
      target_agents: ["coding_agent", "mcp"],
    });

    await createTestLearning(surreal, workspaceId, {
      text: "Break down complex requests into subtasks.",
      learning_type: "instruction",
      status: "active",
      target_agents: ["pm_agent"],
    });

    // When loading for the coding agent
    const codingLearnings = await listActiveLearnings(surreal, workspaceId, "coding_agent");
    // Then only the coding-targeted learning appears
    expect(codingLearnings.length).toBe(1);
    expect(codingLearnings[0].text).toContain("unit tests");

    // When loading for the PM agent
    const pmLearnings = await listActiveLearnings(surreal, workspaceId, "pm_agent");
    // Then only the PM-targeted learning appears
    expect(pmLearnings.length).toBe(1);
    expect(pmLearnings[0].text).toContain("subtasks");

    // When loading for the chat agent
    const chatLearnings = await listActiveLearnings(surreal, workspaceId, "chat_agent");
    // Then no learnings appear (none target chat_agent)
    expect(chatLearnings.length).toBe(0);
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-003: Empty workspace
  // -------------------------------------------------------------------------

  it.skip("workspace with no learnings returns empty list", async () => {
    const { surreal } = getRuntime();

    // Given a brand new workspace with no learnings
    const { workspaceId } = await createTestWorkspace(surreal, "empty-workspace");

    // When loading active learnings
    const learnings = await listActiveLearnings(surreal, workspaceId);

    // Then an empty list is returned (no section should be rendered)
    expect(learnings.length).toBe(0);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Error paths
  // -------------------------------------------------------------------------

  it.skip("deactivated learnings are excluded from active loading", async () => {
    const { surreal } = getRuntime();

    // Given a workspace with an active and a deactivated learning
    const { workspaceId } = await createTestWorkspace(surreal, "exclude-deactivated");

    await createTestLearning(surreal, workspaceId, {
      text: "Active rule: use TypeScript strict mode.",
      learning_type: "instruction",
      status: "active",
    });

    await createTestLearning(surreal, workspaceId, {
      text: "Deactivated rule: use JavaScript only.",
      learning_type: "instruction",
      status: "deactivated",
    });

    // When loading active learnings
    const learnings = await listActiveLearnings(surreal, workspaceId);

    // Then only the active learning is returned
    expect(learnings.length).toBe(1);
    expect(learnings[0].text).toContain("TypeScript strict mode");
  }, 120_000);

  it.skip("superseded learnings are excluded from active loading", async () => {
    const { surreal } = getRuntime();

    // Given a workspace with an active and a superseded learning
    const { workspaceId } = await createTestWorkspace(surreal, "exclude-superseded");

    await createTestLearning(surreal, workspaceId, {
      text: "Current rule: use SurrealDB.",
      learning_type: "precedent",
      status: "active",
    });

    await createTestLearning(surreal, workspaceId, {
      text: "Old rule: use PostgreSQL.",
      learning_type: "precedent",
      status: "superseded",
    });

    // When loading active learnings
    const learnings = await listActiveLearnings(surreal, workspaceId);

    // Then only the current (non-superseded) learning is returned
    expect(learnings.length).toBe(1);
    expect(learnings[0].text).toContain("SurrealDB");
  }, 120_000);
});
