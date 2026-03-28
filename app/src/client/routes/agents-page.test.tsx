import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { render, screen, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS = "ws-agents-test";

// ---------------------------------------------------------------------------
// Module mocks — must be set before component import
// ---------------------------------------------------------------------------

mock.module("@tanstack/react-router", () => ({
  Link: ({ to, children, params, ...rest }: { to: string; children: React.ReactNode; params?: Record<string, string> }) => (
    <a href={params ? to.replace("$agentId", params.agentId ?? "") : to} {...rest}>{children}</a>
  ),
  useNavigate: () => mock(() => {}),
  useParams: () => ({}),
  useSearch: () => ({}),
  useMatchRoute: () => () => false,
}));

mock.module("../stores/workspace-state", () => ({
  useWorkspaceState: (selector: (state: { workspaceId?: string }) => unknown) =>
    selector({ workspaceId: WS }),
}));

// ---------------------------------------------------------------------------
// Fetch stub
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function stubFetchWithAgents(agents: Array<Record<string, unknown>>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes(`/api/workspaces/${WS}/agents`)) {
      return new Response(JSON.stringify({ agents }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input);
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BRAIN_AGENT = {
  id: "agent-brain-1",
  name: "Extraction Agent",
  description: "Extracts entities from conversations",
  runtime: "brain",
  model: "haiku",
  identity_id: "id-1",
  created_at: "2026-01-15T10:00:00Z",
};

const EXTERNAL_AGENT = {
  id: "agent-ext-1",
  name: "Coding Agent",
  description: "Writes code via MCP",
  runtime: "external",
  model: "sonnet",
  identity_id: "id-2",
  created_at: "2026-02-20T14:30:00Z",
};

const SANDBOX_AGENT = {
  id: "agent-sandbox-1",
  name: "Review Agent",
  description: "Reviews pull requests in sandbox",
  runtime: "sandbox",
  model: "opus",
  identity_id: "id-3",
  created_at: "2026-03-10T09:00:00Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentsPage", () => {
  it("renders runtime-grouped sections with agent counts", async () => {
    stubFetchWithAgents([BRAIN_AGENT, EXTERNAL_AGENT, SANDBOX_AGENT]);
    const { AgentsPage } = await import("./agents-page");
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Brain Agents \(1\)/)).toBeInTheDocument();
    });

    expect(screen.getByText(/External Agents \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Sandbox Agents \(1\)/)).toBeInTheDocument();
  });

  it("shows View button for brain agents, not Edit or Delete", async () => {
    stubFetchWithAgents([BRAIN_AGENT]);
    const { AgentsPage } = await import("./agents-page");
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByText("Extraction Agent")).toBeInTheDocument();
    });

    expect(screen.getByText("View")).toBeInTheDocument();
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("shows Edit and Delete buttons for external agents", async () => {
    stubFetchWithAgents([EXTERNAL_AGENT]);
    const { AgentsPage } = await import("./agents-page");
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByText("Coding Agent")).toBeInTheDocument();
    });

    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("shows empty state text for sections with no agents", async () => {
    stubFetchWithAgents([]);
    const { AgentsPage } = await import("./agents-page");
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Brain Agents \(0\)/)).toBeInTheDocument();
    });

    expect(screen.getByText(/No brain agents found/)).toBeInTheDocument();
    expect(screen.getByText(/No external agents yet/)).toBeInTheDocument();
    expect(screen.getByText(/No sandbox agents yet/)).toBeInTheDocument();
  });

  it("displays runtime badge on each agent card", async () => {
    stubFetchWithAgents([BRAIN_AGENT, EXTERNAL_AGENT]);
    const { AgentsPage } = await import("./agents-page");
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByText("Extraction Agent")).toBeInTheDocument();
    });

    expect(screen.getByText("Brain")).toBeInTheDocument();
    expect(screen.getByText("External")).toBeInTheDocument();
  });
});
