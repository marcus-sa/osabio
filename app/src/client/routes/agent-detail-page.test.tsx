import { describe, it, expect, mock, afterEach } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS = "ws-agent-detail-test";
const AGENT_ID = "agent-test-123";

// ---------------------------------------------------------------------------
// Module mocks -- must be set before component import
// ---------------------------------------------------------------------------

const mockNavigate = mock(() => {});

mock.module("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} data-testid="link" {...rest}>{children}</a>
  ),
  useParams: () => ({ agentId: AGENT_ID }),
  useNavigate: () => mockNavigate,
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

function stubFetchWithDetail(detail: Record<string, unknown>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes(`/api/workspaces/${WS}/agents/${AGENT_ID}`)) {
      return new Response(JSON.stringify(detail), {
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

const BRAIN_AGENT_DETAIL = {
  agent: {
    id: AGENT_ID,
    name: "Extraction Agent",
    description: "Extracts entities from conversations",
    runtime: "osabio",
    model: "haiku",
    identity_id: "id-osabio-1",
    created_at: "2026-01-15T10:00:00Z",
  },
  identity: { id: "id-osabio-1", name: "Extraction Agent", type: "agent", role: "system" },
  authority_scopes: [
    { action: "create_task", permission: "auto" },
    { action: "create_decision", permission: "propose" },
    { action: "resolve_observation", permission: "blocked" },
  ],
  sessions: [
    {
      id: "sess-1",
      started_at: "2026-03-27T08:00:00Z",
      ended_at: "2026-03-27T08:15:00Z",
      orchestrator_status: "completed",
      summary: "Processed 12 entities",
    },
  ],
};

const EXTERNAL_AGENT_DETAIL = {
  agent: {
    id: AGENT_ID,
    name: "Coding Agent",
    description: "Writes code via MCP",
    runtime: "external",
    model: "sonnet",
    identity_id: "id-ext-1",
    created_at: "2026-02-20T14:30:00Z",
  },
  identity: { id: "id-ext-1", name: "Coding Agent", type: "agent", role: "custom" },
  authority_scopes: [
    { action: "create_task", permission: "propose" },
  ],
  sessions: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentDetailPage", () => {
  it("renders agent name and description after loading", async () => {
    stubFetchWithDetail(BRAIN_AGENT_DETAIL);
    const { AgentDetailPage } = await import("./agent-detail-page");
    render(<AgentDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Extraction Agent" })).toBeInTheDocument();
    });

    expect(screen.getByText("Extracts entities from conversations")).toBeInTheDocument();
  });

  it("shows authority scopes table with action-permission rows", async () => {
    stubFetchWithDetail(BRAIN_AGENT_DETAIL);
    const { AgentDetailPage } = await import("./agent-detail-page");
    render(<AgentDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("create_task")).toBeInTheDocument();
    });

    expect(screen.getByText("auto")).toBeInTheDocument();
    expect(screen.getByText("create_decision")).toBeInTheDocument();
    expect(screen.getByText("propose")).toBeInTheDocument();
    expect(screen.getByText("resolve_observation")).toBeInTheDocument();
    expect(screen.getByText("blocked")).toBeInTheDocument();
  });

  it("shows read-only note for osabio agents", async () => {
    stubFetchWithDetail(BRAIN_AGENT_DETAIL);
    const { AgentDetailPage } = await import("./agent-detail-page");
    render(<AgentDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Extraction Agent" })).toBeInTheDocument();
    });

    expect(screen.getByText(/system agent/i)).toBeInTheDocument();
  });

  it("shows delete button for external agents but not read-only note", async () => {
    stubFetchWithDetail(EXTERNAL_AGENT_DETAIL);
    const { AgentDetailPage } = await import("./agent-detail-page");
    render(<AgentDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Coding Agent" })).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
    expect(screen.queryByText(/system agent/i)).not.toBeInTheDocument();
  });

  it("shows back link to /agents", async () => {
    stubFetchWithDetail(BRAIN_AGENT_DETAIL);
    const { AgentDetailPage } = await import("./agent-detail-page");
    render(<AgentDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Extraction Agent" })).toBeInTheDocument();
    });

    const backLink = screen.getByText(/back to agents/i);
    expect(backLink).toBeInTheDocument();
    expect(backLink.closest("a")).toHaveAttribute("href", "/agents");
  });

  it("renders recent workspace sessions", async () => {
    stubFetchWithDetail(BRAIN_AGENT_DETAIL);
    const { AgentDetailPage } = await import("./agent-detail-page");
    render(<AgentDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Processed 12 entities")).toBeInTheDocument();
    });
  });
});
