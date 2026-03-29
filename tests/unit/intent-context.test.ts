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
// Capture real modules BEFORE mocking so other test files sharing the bun
// worker keep the full export surface.
// ---------------------------------------------------------------------------

const realQueries = await import("../../app/src/server/graph/queries");
const realBm25 = await import("../../app/src/server/graph/bm25-search");

const mockBuildTaskContext = mock(() => Promise.resolve(TASK_CONTEXT));
const mockBuildProjectContext = mock(() => Promise.resolve(PROJECT_CONTEXT));
const mockBuildWorkspaceOverview = mock(() => Promise.resolve(WORKSPACE_OVERVIEW));
const mockSearchEntitiesByBm25 = mock(() => Promise.resolve([] as any[]));

mock.module("../../app/src/server/mcp/context-builder", () => ({
  buildTaskContext: mockBuildTaskContext,
  buildProjectContext: mockBuildProjectContext,
  buildWorkspaceOverview: mockBuildWorkspaceOverview,
}));

mock.module("../../app/src/server/graph/queries", () => ({
  ...realQueries,
}));

mock.module("../../app/src/server/graph/bm25-search", () => ({
  ...realBm25,
  searchEntitiesByBm25: mockSearchEntitiesByBm25,
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
    mockSearchEntitiesByBm25.mockReset();

    mockBuildTaskContext.mockImplementation(() => Promise.resolve(TASK_CONTEXT));
    mockBuildProjectContext.mockImplementation(() => Promise.resolve(PROJECT_CONTEXT));
    mockBuildWorkspaceOverview.mockImplementation(() => Promise.resolve(WORKSPACE_OVERVIEW));
    mockSearchEntitiesByBm25.mockImplementation(() => Promise.resolve([]));
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
        makeInput({ surreal, intent: "help", cwd: "/workspace/osabio-platform-services/src" }),
      );
      expect(result.level).toBe("project");
      expect((mockBuildProjectContext.mock.calls[0][0] as any).projectRecord.id).toBe("proj-2");
    });
  });

});
