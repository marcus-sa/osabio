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
  task_scope: { task: { id: "task1", title: "Implement auth", status: "open" } },
};

const PROJECT_CONTEXT = {
  workspace: { id: "ws1", name: WS_NAME },
  project: { id: "proj-a", name: "Brain Platform", status: "active" },
};

const WORKSPACE_OVERVIEW = {
  workspace: { id: "ws1", name: WS_NAME },
  projects: [],
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
        if (_sql.includes("FROM project")) return Promise.resolve([config.projects ?? []]);
        if (_sql.includes("FROM has_feature")) {
          return Promise.resolve([config.featureProjectIn ? [{ in: config.featureProjectIn }] : []]);
        }
        if (_sql.includes("FROM belongs_to")) {
          return Promise.resolve([config.belongsToProjectOut ? [{ out: config.belongsToProjectOut }] : []]);
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
// Tests — only logic that integration tests cannot reach
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

  // ---- Entity ref parsing edge cases (regex behavior) ----

  describe("entity ref parsing", () => {
    it("does not match refs embedded in longer words", async () => {
      await resolveIntentContext(makeInput({ intent: "Check mytask:abc status" }));
      expect(mockBuildTaskContext).not.toHaveBeenCalled();
    });

    it("matches case-insensitively", async () => {
      await resolveIntentContext(makeInput({ intent: "Working on Task:ABC123" }));
      expect(mockBuildTaskContext.mock.calls[0][0]).toMatchObject({ taskId: "ABC123" });
    });

    it("prefers task over project when both present", async () => {
      const result = await resolveIntentContext(
        makeInput({ intent: "Working on task:t1 in project:p1" }),
      );
      expect(result.level).toBe("task");
      expect(mockBuildProjectContext).not.toHaveBeenCalled();
    });

    it("falls back to project ref when task ref fails", async () => {
      mockBuildTaskContext.mockImplementation(() => Promise.reject(new Error("not found")));
      const result = await resolveIntentContext(
        makeInput({ intent: "task:missing in project:proj-a" }),
      );
      expect(result.level).toBe("project");
      expect((mockBuildProjectContext.mock.calls[0][0] as any).projectRecord.id).toBe("proj-a");
    });
  });

  // ---- Vector search (cannot test in smoke — requires real embeddings) ----

  describe("vector search", () => {
    it("resolves high-scoring task match to task context", async () => {
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

    it("resolves feature match to parent project via has_feature", async () => {
      const surreal = createMockSurreal({
        projects: [PROJECT_A, PROJECT_B],
        featureProjectIn: PROJECT_A.id,
      });
      mockCreateEmbeddingVector.mockImplementation(() => Promise.resolve([0.1, 0.2, 0.3]));
      mockSearchEntitiesByEmbedding.mockImplementation(() =>
        Promise.resolve([{ id: "feature:feat1", kind: "feature", name: "Auth Feature", score: 0.6 }]),
      );

      const result = await resolveIntentContext(makeInput({ surreal, intent: "auth feature" }));
      expect(result.level).toBe("project");
    });

    it("falls back to project when task build fails on task match", async () => {
      const surreal = createMockSurreal({
        projects: [PROJECT_A, PROJECT_B],
        belongsToProjectOut: PROJECT_A.id,
      });
      mockCreateEmbeddingVector.mockImplementation(() => Promise.resolve([0.1, 0.2, 0.3]));
      mockSearchEntitiesByEmbedding.mockImplementation(() =>
        Promise.resolve([{ id: "task:missing", kind: "task", name: "Missing", score: 0.8 }]),
      );
      mockBuildTaskContext.mockImplementation(() => Promise.reject(new Error("not found")));

      const result = await resolveIntentContext(makeInput({ surreal, intent: "missing task" }));
      expect(result.level).toBe("project");
    });

    it("ignores results at exactly 0.3 threshold", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A, PROJECT_B] });
      mockCreateEmbeddingVector.mockImplementation(() => Promise.resolve([0.1, 0.2, 0.3]));
      mockSearchEntitiesByEmbedding.mockImplementation(() =>
        Promise.resolve([{ id: "task:task1", kind: "task", name: "Task", score: 0.3 }]),
      );

      const result = await resolveIntentContext(makeInput({ surreal, intent: "vague" }));
      expect(result.level).toBe("workspace");
      expect(mockBuildTaskContext).not.toHaveBeenCalled();
    });

    it("skips search entirely when embedding fails", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A, PROJECT_B] });
      await resolveIntentContext(makeInput({ surreal, intent: "something" }));
      expect(mockSearchEntitiesByEmbedding).not.toHaveBeenCalled();
    });

    it("handles entity id without table: prefix", async () => {
      const surreal = createMockSurreal({ projects: [PROJECT_A, PROJECT_B] });
      mockCreateEmbeddingVector.mockImplementation(() => Promise.resolve([0.1, 0.2, 0.3]));
      mockSearchEntitiesByEmbedding.mockImplementation(() =>
        Promise.resolve([{ id: "task1-raw", kind: "task", name: "Auth", score: 0.8 }]),
      );

      await resolveIntentContext(makeInput({ surreal, intent: "auth" }));
      expect(mockBuildTaskContext.mock.calls[0][0]).toMatchObject({ taskId: "task1-raw" });
    });
  });

  // ---- Path matching token logic ----

  describe("path matching", () => {
    it("ignores tokens with 2 or fewer characters", async () => {
      const surreal = createMockSurreal({
        projects: [
          { id: new RecordId("project", "proj-x"), name: "XY Tool", status: "active" },
          PROJECT_B,
        ],
      });

      const result = await resolveIntentContext(
        makeInput({ surreal, intent: "help", cwd: "/a/xy/b/cd" }),
      );
      expect(result.level).toBe("workspace");
    });

    it("picks project with the best token overlap", async () => {
      const surreal = createMockSurreal({
        projects: [
          { id: new RecordId("project", "proj-1"), name: "Brain Core", status: "active" },
          { id: new RecordId("project", "proj-2"), name: "Brain Platform Services", status: "active" },
        ],
      });

      const result = await resolveIntentContext(
        makeInput({ surreal, intent: "help", cwd: "/workspace/brain-platform-services/src" }),
      );
      expect(result.level).toBe("project");
      expect((mockBuildProjectContext.mock.calls[0][0] as any).projectRecord.id).toBe("proj-2");
    });
  });

  // ---- Waterfall priority (vector > path can't be tested in smoke) ----

  describe("waterfall priority", () => {
    it("vector search beats path matching", async () => {
      const surreal = createMockSurreal({
        projects: [PROJECT_A, PROJECT_B],
        belongsToProjectOut: PROJECT_B.id,
      });
      mockCreateEmbeddingVector.mockImplementation(() => Promise.resolve([0.1, 0.2, 0.3]));
      mockSearchEntitiesByEmbedding.mockImplementation(() =>
        Promise.resolve([{ id: "decision:dec1", kind: "decision", name: "Mobile-first", score: 0.7 }]),
      );

      const result = await resolveIntentContext(
        makeInput({
          surreal,
          intent: "mobile first approach",
          cwd: "/workspace/brain-platform/src", // would match PROJECT_A
        }),
      );

      expect(result.level).toBe("project");
      expect((mockBuildProjectContext.mock.calls[0][0] as any).projectRecord).toBe(PROJECT_B.id);
    });
  });
});
