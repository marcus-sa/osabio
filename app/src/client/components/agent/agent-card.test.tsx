import { describe, it, expect, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Module mocks -- must be set before component import
// ---------------------------------------------------------------------------

mock.module("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    params,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
    params?: Record<string, string>;
  }) => (
    <a
      href={params ? to.replace("$agentId", params.agentId ?? "") : to}
      {...rest}
    >
      {children}
    </a>
  ),
  useNavigate: () => () => {},
  useParams: () => ({}),
  useSearch: () => ({}),
  useMatchRoute: () => () => false,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BRAIN_AGENT = {
  id: "agent-brain-1",
  name: "Extraction Agent",
  description: "Extracts entities from conversations",
  runtime: "brain" as const,
  model: "haiku",
  identity_id: "id-1",
  created_at: "2026-01-15T10:00:00Z",
};

const EXTERNAL_AGENT = {
  id: "agent-ext-1",
  name: "Coding Agent",
  description: "Writes code via MCP",
  runtime: "external" as const,
  model: "sonnet",
  identity_id: "id-2",
  created_at: "2026-02-20T14:30:00Z",
};

const SANDBOX_AGENT = {
  id: "agent-sandbox-1",
  name: "Review Agent",
  runtime: "sandbox" as const,
  model: "opus",
  identity_id: "id-3",
  created_at: "2026-03-10T09:00:00Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentCard", () => {
  it("renders runtime badge with correct label for each runtime", async () => {
    const { AgentCard } = await import("./agent-card");

    const { unmount } = render(<AgentCard agent={BRAIN_AGENT} />);
    expect(screen.getByText("Brain")).toBeInTheDocument();
    unmount();

    const { unmount: unmount2 } = render(<AgentCard agent={EXTERNAL_AGENT} />);
    expect(screen.getByText("External")).toBeInTheDocument();
    unmount2();

    render(<AgentCard agent={SANDBOX_AGENT} />);
    expect(screen.getByText("Sandbox")).toBeInTheDocument();
  });

  it("shows View button for brain agents without Edit or Delete", async () => {
    const { AgentCard } = await import("./agent-card");
    render(<AgentCard agent={BRAIN_AGENT} onDelete={mock(() => {})} />);

    expect(screen.getByText("View")).toBeInTheDocument();
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("shows Edit and Delete buttons for external agents", async () => {
    const { AgentCard } = await import("./agent-card");
    const onDelete = mock(() => {});
    render(<AgentCard agent={EXTERNAL_AGENT} onDelete={onDelete} />);

    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.queryByText("View")).not.toBeInTheDocument();
  });

  it("renders agent name as a link to /agents/$agentId", async () => {
    const { AgentCard } = await import("./agent-card");
    render(<AgentCard agent={EXTERNAL_AGENT} />);

    const link = screen.getByText("Coding Agent").closest("a");
    expect(link).toBeInTheDocument();
    expect(link?.getAttribute("href")).toBe("/agents/agent-ext-1");
  });

  it("shows description when present and omits when absent", async () => {
    const { AgentCard } = await import("./agent-card");

    const { unmount } = render(<AgentCard agent={EXTERNAL_AGENT} />);
    expect(screen.getByText("Writes code via MCP")).toBeInTheDocument();
    unmount();

    render(<AgentCard agent={SANDBOX_AGENT} />);
    expect(screen.queryByText("Writes code via MCP")).not.toBeInTheDocument();
    // SANDBOX_AGENT has no description field, so no description paragraph should render
  });

  it("calls onDelete callback when Delete button is clicked", async () => {
    const { AgentCard } = await import("./agent-card");
    const onDelete = mock(() => {});
    render(<AgentCard agent={EXTERNAL_AGENT} onDelete={onDelete} />);

    await userEvent.click(screen.getByText("Delete"));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(EXTERNAL_AGENT);
  });
});
