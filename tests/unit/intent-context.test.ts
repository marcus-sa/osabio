import { describe, expect, it, mock, beforeEach } from "bun:test";
import { RecordId } from "surrealdb";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WS = new RecordId("workspace", "ws1");
const WS_NAME = "Test Workspace";

const PROJECT_A = {
  id: new RecordId("project", "proj-a"),
  name: "Brain Platform",
  status: "active",
};

const PROJECT_B = {
  id: new RecordId("project", "proj-b"),
  name: "Mobile App",
  status: "active",
};

const TASK_CONTEXT = {
  workspace: { id: "ws1", name: WS_NAME },
  project: { id: "proj-a", name: "Brain Platform", status: "active" },
  task_scope: {
    task: { id: "task1", title: "Implement auth", status: "open" },
    subtasks: [],
    sibling_tasks: [],
    dependencies: [],
    related_sessions: [],
  },
  hot_items: { contested_decisions: [], open_observations: [], pending_suggestions: [] },
  active_sessions: [],
};

const PROJECT_CONTEXT = {
  workspace: { id: "ws1", name: WS_NAME },
  project: { id: "proj-a", name: "Brain Platform", status: "active" },
  decisions: { confirmed: [], provisional: [], contested: [] },
  active_tasks: [],
  open_questions: [],
  recent_changes: [],
  observations: [],
  pending_suggestions: [],
  active_sessions: [],
};

const WORKSPACE_OVERVIEW = {
  workspace: { id: "ws1", name: WS_NAME },
  projects: [],
  hot_items: { contested_decisions: [], open_observations: [], pending_suggestions: [] },
  active_sessions: [],
};

// ---------------------------------------------------------------------------
// Module mocks — must precede dynamic import of module under test
// ---------------------------------------------------------------------------

const mockBuildTaskContext = mock(() => Promise.resolve(TASK_CONTEXT));
const mockBuildProjectContext = mock(() => Promise.resolve(PROJECT_CONTEXT));
const mockBuildWorkspaceOverview = mock(() => Promise.resolve(WORKSPACE_OVERVIEW));
const mockSearchEntitiesByEmbedding = mock(() => Promise.resolve([] as any[]));
const mockCreateEmbeddingVector = mock(() => Promise.resolve(undefined as number[] | undefined));

mock.module("../../app/src/server/mcp/context-builder", () => ({
  buildTaskContext: mockBuildTaskContext,
  buildProjectContext: mockBuildProjectContext,
  buildWorkspaceOverview: mockBuildWorkspaceOverview,
}));

mock.module("../../app/src/server/graph/queries", () => ({
  searchEntitiesByEmbedding: mockSearchEntitiesByEmbedding,
}));

mock.module("../../app/src/server/graph/embeddings", () => ({
  createEmbeddingVector: mockCreateEmbeddingVector,
}));

const { resolveIntentContext } = await import("../../app/src/server/mcp/intent-context");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ProjectFixture = { id: RecordId<"project", string>; name: string; status: string };

function createMockSurreal(config: {
  projects?: ProjectFixture[];
  featureProjectIn?: RecordId<"project", string>;
  belongsToProjectOut?: RecordId<"project", string>;
} = {}) {
  return {
    query: mock((_sql: string) => ({
      collect: mock(() => {
        if (_sql.includes("FROM project")) {
          return Promise.resolve([config.projects ?? []]);
        }
        if (_sql.includes("FROM has_feature")) {
          const rows = config.featureProjectIn ? [{ in: config.featureProjectIn }] : [];
          return Promise.resolve([rows]);
        }
        if (_sql.includes("FROM belongs_to")) {
          const rows = config.belongsToProjectOut ? [{ out: config.belongsToProjectOut }] : [];
          return Promise.resolve([rows]);
        }
        return Promise.resolve([[]]);
      }),
    })),
  } as any;
}

function makeInput(overrides: Record<string, any> = {}) {
  return {
    surreal: createMockSurreal(),
    embeddingModel: {} as any,
    embeddingDimension: 1536,
    workspaceRecord: WS,
    workspaceName: WS_NAME,
    intent: "generic intent",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveIntentContext", () => {
  beforeEach(() => {
    mockBuildTaskContext.mockReset();
    mockBuildProjectContext.mockReset();
    mockBuildWorkspaceOverview.mockReset();
    mockSearchEntitiesByEmbedding.mockReset();
    mockCreateEmbeddingVector.mockReset();

    mockBuildTaskContext.mockImplementation(() => Promise.resolve(TASK_CONTEXT));
    mockBuildProjectContext.mockImplementation(() => Promise.resolve(PROJECT_CONTEXT));
    mockBuildWorkspaceOverview.mockImplementation(() => Promise.resolve(WORKSPACE_OVERVIEW));
    mockSearchEntitiesByEmbedding.mockImplementation(() => Promise.resolve([]));
    mockCreateEmbeddingVector.mockImplementation(() => Promise.resolve(undefined));
  });

  // -----------------------------------------------------------------------
  // Step 1: Explicit entity references
  // -----------------------------------------------------------------------

  describe("explicit entity references", () => {
    it("returns task context for task:id in intent", async () => {
      const result = await resolveIntentContext(
        makeInput({ intent: "I'm working on task:abc123 right now" }),
      );

      expect(result.level).toBe("task");
      expect(mockBuildTaskContext).toHaveBeenCalledTimes(1);
      expect(mockBuildTaskContext.mock.calls[0][0]).toMatchObject({ taskId: "abc123" });
    });

    it("returns project context for project:id in intent", async () => {
      const result = await resolveIntentContext(
        makeInput({ intent: "Give me context for project:proj-a" }),
      );

      expect(result.level).toBe("project");
      expect(mockBuildProjectContext).toHaveBeenCalledTimes(1);
      const arg = mockBuildProjectContext.mock.calls[0][0] as any;
      expect(arg.projectRecord.table.name).toBe("project");
      expect(arg.projectRecord.id).toBe("proj-a");
    });

    it("extracts hyphenated ids", async () => {
      await resolveIntentContext(makeInput({ intent: "Check task:my-long-task-id" }));

      expect(mockBuildTaskContext.mock.calls[0][0]).toMatchObject({ taskId: "my-long-task-id" });
    });

    it("matches entity refs case-insensitively", async () => {
      await resolveIntentContext(makeInput({ intent: "Working on Task:ABC123" }));

      expect(mockBuildTaskContext.mock.calls[0][0]).toMatchObject({ taskId: "ABC123" });
    });

    it("falls through when explicit task is not found", async () => {
      mockBuildTaskContext.mockImplementation(() => Promise.reject(new Error("not found")));

      const result = await resolveIntentContext(
        makeInput({ intent: "Working on task:nonexistent" }),
      );

      expect(result.level).toBe("workspace");
    });

    it("falls through when explicit project is not found", async () => {
      mockBuildProjectContext.mockImplementation(() => Promise.reject(new Error("not found")));

      const result = await resolveIntentContext(
        makeInput({ intent: "Context for project:nonexistent" }),
      );

      expect(result.level).toBe("workspace");
    });

    it("does not match entity refs embedded in longer words", async () => {
      const result = await resolveIntentContext(
        makeInput({ intent: "Check mytask:abc status" }),
      );

      expect(mockBuildTaskContext).not.toHaveBeenCalled();
      expect(result.level).toBe("workspace");
    });

    it("prefers task over project when both present", async () => {
      const result = await resolveIntentContext(
        makeInput({ intent: "Working on task:t1 in project:p1" }),
      );

      expect(result.level).toBe("task");
      expect(mockBuildTaskContext.mock.calls[0][0]).toMatchObject({ taskId: "t1" });
      expect(mockBuildProjectContext).not.toHaveBeenCalled();
    });

    it("tries project ref when task ref fails", async () => {
      mockBuildTaskContext.mockImplementation(() => Promise.reject(new Error("not found")));

      const result = await resolveIntentContext(
        makeInput({ intent: "task:missing in project:proj-a" }),
      );

      expect(result.level).toBe("project");
      const arg = mockBuildProjectContext.mock.calls[0][0] as any;
      expect(arg.projectRecord.id).toBe("proj-a");
    });
  });

  // -----------------------------------------------------------------------
  // Step 2: Single-project shortcut
  // -----------------------------------------------------------------------

  describe("single-project shortcut", () => {
    it("returns project context when workspace has exactly one project", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A] });

      const result = await resolveIntentContext(
        makeInput({ surreal, intent: "What should I work on?" }),
      );

      expect(result.level).toBe("project");
      const arg = mockBuildProjectContext.mock.calls[0][0] as any;
      expect(arg.projectRecord).toBe(PROJECT_A.id);
    });

    it("does not shortcut when workspace has multiple projects", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A, PROJECT_B] });

      const result = await resolveIntentContext(
        makeInput({ surreal, intent: "What should I work on?" }),
      );

      expect(result.level).toBe("workspace");
    });

    it("does not shortcut when workspace has no projects", async () => {
      const result = await resolveIntentContext(
        makeInput({ intent: "What should I work on?" }),
      );

      expect(result.level).toBe("workspace");
    });
  });

  // -----------------------------------------------------------------------
  // Step 3: Vector search
  // -----------------------------------------------------------------------

  describe("vector search", () => {
    it("returns task context for high-scoring task match", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A, PROJECT_B] });
      mockCreateEmbeddingVector.mockImplementation(() => Promise.resolve([0.1, 0.2, 0.3]));
      mockSearchEntitiesByEmbedding.mockImplementation(() =>
        Promise.resolve([{ id: "task:task1", kind: "task", name: "Implement auth", score: 0.8 }]),
      );

      const result = await resolveIntentContext(
        makeInput({ surreal, intent: "implement login authentication" }),
      );

      expect(result.level).toBe("task");
      expect(mockBuildTaskContext.mock.calls[0][0]).toMatchObject({ taskId: "task1" });
    });

    it("returns project context for high-scoring project match", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A, PROJECT_B] });
      mockCreateEmbeddingVector.mockImplementation(() => Promise.resolve([0.1, 0.2, 0.3]));
      mockSearchEntitiesByEmbedding.mockImplementation(() =>
        Promise.resolve([
          { id: "project:proj-a", kind: "project", name: "Brain Platform", score: 0.7 },
        ]),
      );

      const result = await resolveIntentContext(
        makeInput({ surreal, intent: "brain platform status" }),
      );

      expect(result.level).toBe("project");
      const arg = mockBuildProjectContext.mock.calls[0][0] as any;
      expect(arg.projectRecord.id).toBe("proj-a");
    });

    it("resolves feature match to parent project via has_feature", async () => {
      const surreal = createMockSurreal({
        projects: [PROJECT_A, PROJECT_B],
        featureProjectIn: PROJECT_A.id,
      });
      mockCreateEmbeddingVector.mockImplementation(() => Promise.resolve([0.1, 0.2, 0.3]));
      mockSearchEntitiesByEmbedding.mockImplementation(() =>
        Promise.resolve([
          { id: "feature:feat1", kind: "feature", name: "Auth Feature", score: 0.6 },
        ]),
      );

      const result = await resolveIntentContext(
        makeInput({ surreal, intent: "authentication feature" }),
      );

      expect(result.level).toBe("project");
    });

    it("resolves decision match to project via belongs_to", async () => {
      const surreal = createMockSurreal({
        projects: [PROJECT_A, PROJECT_B],
        belongsToProjectOut: PROJECT_A.id,
      });
      mockCreateEmbeddingVector.mockImplementation(() => Promise.resolve([0.1, 0.2, 0.3]));
      mockSearchEntitiesByEmbedding.mockImplementation(() =>
        Promise.resolve([
          { id: "decision:dec1", kind: "decision", name: "Use JWT tokens", score: 0.5 },
        ]),
      );

      const result = await resolveIntentContext(
        makeInput({ surreal, intent: "JWT authentication decision" }),
      );

      expect(result.level).toBe("project");
    });

    it("falls back to project when task build fails on task match", async () => {
      const surreal = createMockSurreal({
        projects: [PROJECT_A, PROJECT_B],
        belongsToProjectOut: PROJECT_A.id,
      });
      mockCreateEmbeddingVector.mockImplementation(() => Promise.resolve([0.1, 0.2, 0.3]));
      mockSearchEntitiesByEmbedding.mockImplementation(() =>
        Promise.resolve([
          { id: "task:missing-task", kind: "task", name: "Missing Task", score: 0.8 },
        ]),
      );
      mockBuildTaskContext.mockImplementation(() => Promise.reject(new Error("not found")));

      const result = await resolveIntentContext(
        makeInput({ surreal, intent: "work on missing task" }),
      );

      expect(result.level).toBe("project");
    });

    it("ignores results at the 0.3 threshold (not strictly above)", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A, PROJECT_B] });
      mockCreateEmbeddingVector.mockImplementation(() => Promise.resolve([0.1, 0.2, 0.3]));
      mockSearchEntitiesByEmbedding.mockImplementation(() =>
        Promise.resolve([{ id: "task:task1", kind: "task", name: "Some Task", score: 0.3 }]),
      );

      const result = await resolveIntentContext(
        makeInput({ surreal, intent: "something vague" }),
      );

      expect(result.level).toBe("workspace");
      expect(mockBuildTaskContext).not.toHaveBeenCalled();
    });

    it("falls through when no search results returned", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A, PROJECT_B] });
      mockCreateEmbeddingVector.mockImplementation(() => Promise.resolve([0.1, 0.2, 0.3]));

      const result = await resolveIntentContext(
        makeInput({ surreal, intent: "something" }),
      );

      expect(result.level).toBe("workspace");
    });

    it("skips vector search entirely when embedding fails", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A, PROJECT_B] });

      const result = await resolveIntentContext(
        makeInput({ surreal, intent: "something" }),
      );

      expect(result.level).toBe("workspace");
      expect(mockSearchEntitiesByEmbedding).not.toHaveBeenCalled();
    });

    it("handles entity id without table: prefix", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A, PROJECT_B] });
      mockCreateEmbeddingVector.mockImplementation(() => Promise.resolve([0.1, 0.2, 0.3]));
      mockSearchEntitiesByEmbedding.mockImplementation(() =>
        Promise.resolve([{ id: "task1-no-prefix", kind: "task", name: "Auth task", score: 0.8 }]),
      );

      const result = await resolveIntentContext(
        makeInput({ surreal, intent: "implement auth" }),
      );

      expect(result.level).toBe("task");
      expect(mockBuildTaskContext.mock.calls[0][0]).toMatchObject({ taskId: "task1-no-prefix" });
    });
  });

  // -----------------------------------------------------------------------
  // Step 4: Path matching
  // -----------------------------------------------------------------------

  describe("path matching", () => {
    it("matches cwd directory segments to project name", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A, PROJECT_B] });

      const result = await resolveIntentContext(
        makeInput({
          surreal,
          intent: "what should I do?",
          cwd: "/Users/marcus/projects/brain-platform/src",
        }),
      );

      expect(result.level).toBe("project");
      const arg = mockBuildProjectContext.mock.calls[0][0] as any;
      expect(arg.projectRecord).toBe(PROJECT_A.id);
    });

    it("matches paths array to project name", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A, PROJECT_B] });

      const result = await resolveIntentContext(
        makeInput({
          surreal,
          intent: "what files?",
          paths: ["/workspace/mobile-app/components/Button.tsx"],
        }),
      );

      expect(result.level).toBe("project");
      const arg = mockBuildProjectContext.mock.calls[0][0] as any;
      expect(arg.projectRecord).toBe(PROJECT_B.id);
    });

    it("combines cwd and paths for matching", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A, PROJECT_B] });

      const result = await resolveIntentContext(
        makeInput({
          surreal,
          intent: "help",
          cwd: "/some/dir",
          paths: ["/workspace/brain-platform/index.ts"],
        }),
      );

      expect(result.level).toBe("project");
      const arg = mockBuildProjectContext.mock.calls[0][0] as any;
      expect(arg.projectRecord).toBe(PROJECT_A.id);
    });

    it("ignores path tokens with 2 or fewer characters", async () => {
      const surreal = createMockSurreal({
        projects: [{ id: new RecordId("project", "proj-x"), name: "XY Tool", status: "active" }],
      });

      // Single project would trigger shortcut, so need 2+ projects
      const surreal2 = createMockSurreal({
        projects: [
          { id: new RecordId("project", "proj-x"), name: "XY Tool", status: "active" },
          PROJECT_B,
        ],
      });

      const result = await resolveIntentContext(
        makeInput({
          surreal: surreal2,
          intent: "help",
          cwd: "/a/xy/b/cd",
        }),
      );

      expect(result.level).toBe("workspace");
    });

    it("does not match when paths have no overlap with project names", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A, PROJECT_B] });

      const result = await resolveIntentContext(
        makeInput({
          surreal,
          intent: "help",
          cwd: "/Users/marcus/completely/unrelated/directory",
        }),
      );

      expect(result.level).toBe("workspace");
    });

    it("picks project with the best token overlap", async () => {
      const surreal = createMockSurreal({
        projects: [
          { id: new RecordId("project", "proj-1"), name: "Brain Core", status: "active" },
          {
            id: new RecordId("project", "proj-2"),
            name: "Brain Platform Services",
            status: "active",
          },
        ],
      });

      const result = await resolveIntentContext(
        makeInput({
          surreal,
          intent: "help",
          cwd: "/workspace/brain-platform-services/src",
        }),
      );

      expect(result.level).toBe("project");
      const arg = mockBuildProjectContext.mock.calls[0][0] as any;
      expect(arg.projectRecord.id).toBe("proj-2");
    });
  });

  // -----------------------------------------------------------------------
  // Step 5: Fallback
  // -----------------------------------------------------------------------

  describe("fallback", () => {
    it("returns workspace overview when no step matches", async () => {
      const result = await resolveIntentContext(
        makeInput({ intent: "something completely generic" }),
      );

      expect(result.level).toBe("workspace");
      expect(result.data).toBe(WORKSPACE_OVERVIEW);
      expect(mockBuildWorkspaceOverview).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Waterfall priority ordering
  // -----------------------------------------------------------------------

  describe("waterfall priority", () => {
    it("explicit ref beats single-project shortcut", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A] });

      const result = await resolveIntentContext(
        makeInput({ surreal, intent: "task:specific-task context" }),
      );

      expect(result.level).toBe("task");
      expect(mockBuildTaskContext.mock.calls[0][0]).toMatchObject({ taskId: "specific-task" });
    });

    it("single-project shortcut beats vector search", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A] });
      mockCreateEmbeddingVector.mockImplementation(() => Promise.resolve([0.1, 0.2, 0.3]));
      mockSearchEntitiesByEmbedding.mockImplementation(() =>
        Promise.resolve([{ id: "task:task1", kind: "task", name: "Task", score: 0.9 }]),
      );

      const result = await resolveIntentContext(
        makeInput({ surreal, intent: "implement authentication" }),
      );

      expect(result.level).toBe("project");
      expect(mockSearchEntitiesByEmbedding).not.toHaveBeenCalled();
    });

    it("vector search beats path matching", async () => {
      const surreal = createMockSurreal({
        projects: [PROJECT_A, PROJECT_B],
        belongsToProjectOut: PROJECT_B.id,
      });
      mockCreateEmbeddingVector.mockImplementation(() => Promise.resolve([0.1, 0.2, 0.3]));
      mockSearchEntitiesByEmbedding.mockImplementation(() =>
        Promise.resolve([
          { id: "decision:dec1", kind: "decision", name: "Mobile-first approach", score: 0.7 },
        ]),
      );

      const result = await resolveIntentContext(
        makeInput({
          surreal,
          intent: "mobile first approach",
          cwd: "/workspace/brain-platform/src", // would match PROJECT_A
        }),
      );

      // Vector search resolves to PROJECT_B, not PROJECT_A from path
      expect(result.level).toBe("project");
      const arg = mockBuildProjectContext.mock.calls[0][0] as any;
      expect(arg.projectRecord).toBe(PROJECT_B.id);
    });
  });
});
