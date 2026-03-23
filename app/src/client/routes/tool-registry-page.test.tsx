import { describe, it, expect, mock, beforeAll, afterAll, afterEach } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import type { McpServerListItem } from "../hooks/use-mcp-servers";
import type { ProviderListItem } from "../hooks/use-providers";
import type { ToolListItem } from "../hooks/use-tools";
import type { AccountListItem } from "../hooks/use-accounts";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const WS = "ws-test-123";

const MOCK_SERVERS: McpServerListItem[] = [
  {
    id: "srv-1",
    name: "github-mcp",
    url: "https://mcp.github.example.com",
    transport: "streamable-http",
    auth_mode: "oauth",
    has_static_headers: false,
    last_status: "ok",
    tool_count: 5,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "srv-2",
    name: "internal-mcp",
    url: "https://internal.example.com",
    transport: "streamable-http",
    auth_mode: "static_headers",
    has_static_headers: true,
    last_status: "ok",
    tool_count: 2,
    created_at: "2026-01-02T00:00:00Z",
  },
];

const MOCK_PROVIDERS: ProviderListItem[] = [
  {
    id: "prov-1",
    name: "github-oauth",
    display_name: "GitHub OAuth",
    auth_method: "oauth2",
    has_client_secret: true,
    created_at: "2026-01-01T00:00:00Z",
  },
];

const MOCK_TOOLS: ToolListItem[] = [
  {
    id: "tool-1",
    name: "list_repos",
    toolkit: "github",
    description: "List repositories",
    risk_level: "low",
    status: "active",
    grant_count: 1,
    governance_count: 0,
    provider_name: "GitHub OAuth",
    created_at: "2026-01-01T00:00:00Z",
  },
];

const MOCK_ACCOUNTS: AccountListItem[] = [
  {
    id: "acct-1",
    provider_id: "prov-1",
    status: "active",
    has_api_key: false,
    has_bearer_token: false,
    has_basic_credentials: false,
    has_access_token: true,
    connected_at: "2026-01-01T00:00:00Z",
  },
];

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

let mockSearchParams: Record<string, string> = {};
const mockNavigate = mock(() => {});

mock.module("@tanstack/react-router", () => ({
  useSearch: () => mockSearchParams,
  useNavigate: () => mockNavigate,
}));

mock.module("../stores/workspace-state", () => ({
  useWorkspaceState: (selector: (state: { workspaceId?: string }) => unknown) =>
    selector({ workspaceId: WS }),
}));

// Hook mocks — data hooks are mocked so we control what the page renders.
// Action fetches (discover-auth, authorize, delete, etc.) go through real fetch → MSW.
let mockServers = MOCK_SERVERS;
const mockRefreshServers = mock(() => {});
const mockRefreshProviders = mock(() => {});
const mockRefreshTools = mock(() => {});
const mockRefreshAccounts = mock(() => {});

mock.module("../hooks/use-mcp-servers", () => ({
  useMcpServers: () => ({
    mcpServers: mockServers,
    isLoading: false,
    refresh: mockRefreshServers,
  }),
}));

mock.module("../hooks/use-providers", () => ({
  useProviders: () => ({
    providers: MOCK_PROVIDERS,
    isLoading: false,
    refresh: mockRefreshProviders,
  }),
}));

mock.module("../hooks/use-tools", () => ({
  useTools: () => ({
    tools: MOCK_TOOLS,
    isLoading: false,
    refresh: mockRefreshTools,
  }),
}));

mock.module("../hooks/use-accounts", () => ({
  useAccounts: () => ({
    accounts: MOCK_ACCOUNTS,
    isLoading: false,
    refresh: mockRefreshAccounts,
  }),
}));

// Import after mocks
const { ToolRegistryPage, deriveToolRegistryViewModel, TOOL_REGISTRY_TABS } = await import(
  "./tool-registry-page"
);

// ---------------------------------------------------------------------------
// MSW Server — intercepts action fetches from the page component
// ---------------------------------------------------------------------------

// happy-dom doesn't set location by default — relative fetch URLs need a base.
// Setting location.href lets fetch("/api/...") resolve to "http://localhost/api/...".
if (!globalThis.location?.href || globalThis.location.href === "about:blank") {
  Object.defineProperty(globalThis, "location", {
    value: new URL("http://localhost"),
    writable: true,
  });
}

const BASE = `http://localhost`;
const mcpBase = `${BASE}/api/workspaces/${WS}/mcp-servers`;

// Track which endpoints were called
let calledEndpoints: { method: string; url: string; body?: unknown }[] = [];

const handlers = [
  // POST create server
  http.post(mcpBase, async ({ request }) => {
    const body = await request.json();
    calledEndpoints.push({ method: "POST", url: mcpBase, body });
    return HttpResponse.json({ id: "srv-new" }, { status: 201 });
  }),

  // POST discover-auth
  http.post(`${mcpBase}/:serverId/discover-auth`, ({ params }) => {
    calledEndpoints.push({ method: "POST", url: `${mcpBase}/${params.serverId}/discover-auth` });
    return HttpResponse.json({
      discovered: true,
      auth_server: "https://auth.example.com",
      provider_id: "prov-new",
    });
  }),

  // POST authorize
  http.post(`${mcpBase}/:serverId/authorize`, ({ params }) => {
    calledEndpoints.push({ method: "POST", url: `${mcpBase}/${params.serverId}/authorize` });
    return HttpResponse.json({
      authorization_url: "https://auth.example.com/authorize?state=abc",
    });
  }),

  // POST discover
  http.post(`${mcpBase}/:serverId/discover`, ({ params }) => {
    calledEndpoints.push({ method: "POST", url: `${mcpBase}/${params.serverId}/discover` });
    return HttpResponse.json({ tools_discovered: 3 });
  }),

  // POST sync
  http.post(`${mcpBase}/:serverId/sync`, ({ params }) => {
    calledEndpoints.push({ method: "POST", url: `${mcpBase}/${params.serverId}/sync` });
    return HttpResponse.json({ synced: true });
  }),

  // DELETE server
  http.delete(`${mcpBase}/:serverId`, ({ params }) => {
    calledEndpoints.push({ method: "DELETE", url: `${mcpBase}/${params.serverId}` });
    return new HttpResponse(null, { status: 204 });
  }),
];

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  calledEndpoints = [];
  mockSearchParams = {};
  mockNavigate.mockClear();
  mockRefreshServers.mockClear();
  mockRefreshProviders.mockClear();
  mockRefreshTools.mockClear();
  mockRefreshAccounts.mockClear();
  mockServers = MOCK_SERVERS;
});
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Pure view model tests
// ---------------------------------------------------------------------------

describe("deriveToolRegistryViewModel", () => {
  it("defaults to tools tab when no tab param", () => {
    const vm = deriveToolRegistryViewModel({
      toolsCount: 3,
      providersCount: 1,
      accountsCount: 2,
      mcpServersCount: 1,
    });
    expect(vm.activeTab).toBe("tools");
  });

  it("selects the tab matching tabParam", () => {
    const vm = deriveToolRegistryViewModel({
      tabParam: "servers",
      toolsCount: 3,
      providersCount: 1,
      accountsCount: 2,
      mcpServersCount: 1,
    });
    expect(vm.activeTab).toBe("servers");
  });

  it("falls back to tools for invalid tabParam", () => {
    const vm = deriveToolRegistryViewModel({
      tabParam: "bogus",
      toolsCount: 0,
      providersCount: 0,
      accountsCount: 0,
      mcpServersCount: 0,
    });
    expect(vm.activeTab).toBe("tools");
  });

  it("formats tab labels with counts", () => {
    const vm = deriveToolRegistryViewModel({
      toolsCount: 3,
      providersCount: 1,
      accountsCount: 0,
      mcpServersCount: 2,
    });
    expect(vm.tabLabels.servers).toBe("Servers (2)");
    expect(vm.tabLabels.tools).toBe("Tools (3)");
    expect(vm.tabLabels.providers).toBe("Providers (1)");
    expect(vm.tabLabels.accounts).toBe("Accounts");
  });

  it("shows empty state when active tab count is 0", () => {
    const vm = deriveToolRegistryViewModel({
      tabParam: "accounts",
      toolsCount: 3,
      providersCount: 1,
      accountsCount: 0,
      mcpServersCount: 1,
    });
    expect(vm.showEmptyState).toBe(true);
  });

  it("TOOL_REGISTRY_TABS includes servers tab", () => {
    const serverTab = TOOL_REGISTRY_TABS.find((t: { id: string }) => t.id === "servers");
    expect(serverTab).toBeDefined();
    expect(serverTab!.label).toBe("Servers");
  });
});

// ---------------------------------------------------------------------------
// Servers tab rendering
// ---------------------------------------------------------------------------

describe("ToolRegistryPage servers tab", () => {
  it("renders MCP servers with names", () => {
    mockSearchParams = { tab: "servers" };
    render(<ToolRegistryPage />);

    expect(screen.getByText("github-mcp")).toBeInTheDocument();
    expect(screen.getByText("internal-mcp")).toBeInTheDocument();
    expect(screen.getByText("MCP Servers (2)")).toBeInTheDocument();
  });

  it("shows auth badges for different auth modes", () => {
    mockSearchParams = { tab: "servers" };
    render(<ToolRegistryPage />);

    expect(screen.getByText("OAuth")).toBeInTheDocument();
    expect(screen.getByText("Headers")).toBeInTheDocument();
  });

  it("shows Discover Auth button only for oauth servers", () => {
    mockSearchParams = { tab: "servers" };
    render(<ToolRegistryPage />);

    const discoverAuthButtons = screen.getAllByRole("button", { name: /discover auth/i });
    expect(discoverAuthButtons).toHaveLength(1);
  });

  it("shows Authorize button for oauth server", () => {
    mockSearchParams = { tab: "servers" };
    render(<ToolRegistryPage />);

    expect(screen.getByRole("button", { name: /^authorize$/i })).toBeInTheDocument();
  });

  it("shows empty state when no servers", () => {
    mockSearchParams = { tab: "servers" };
    mockServers = [];
    render(<ToolRegistryPage />);

    expect(screen.getByText("No MCP servers configured.")).toBeInTheDocument();
  });

  it("shows auth_error status indicator", () => {
    mockSearchParams = { tab: "servers" };
    mockServers = [{ ...MOCK_SERVERS[0], last_status: "auth_error" }];
    render(<ToolRegistryPage />);

    expect(screen.getByLabelText("Auth Error")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Server actions (API calls via MSW)
// ---------------------------------------------------------------------------

describe("ToolRegistryPage server actions", () => {
  it("POSTs discover-auth and refreshes servers + providers", async () => {
    mockSearchParams = { tab: "servers" };
    const user = userEvent.setup();
    render(<ToolRegistryPage />);

    await user.click(screen.getByRole("button", { name: /discover auth/i }));

    await waitFor(() => {
      expect(calledEndpoints.some((e) => e.url.includes("/discover-auth"))).toBe(true);
    });

    await waitFor(() => {
      expect(mockRefreshServers).toHaveBeenCalled();
      expect(mockRefreshProviders).toHaveBeenCalled();
    });
  });

  it("POSTs authorize and opens authorization URL in new tab", async () => {
    mockSearchParams = { tab: "servers" };
    const user = userEvent.setup();
    const openSpy = mock(() => null);
    const originalOpen = window.open;
    window.open = openSpy as unknown as typeof window.open;

    render(<ToolRegistryPage />);

    await user.click(screen.getByRole("button", { name: /^authorize$/i }));

    await waitFor(() => {
      expect(calledEndpoints.some((e) => e.url.includes("/authorize"))).toBe(true);
    });

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "https://auth.example.com/authorize?state=abc",
        "_blank",
      );
    });

    window.open = originalOpen;
  });

  it("POSTs discover and refreshes servers + tools", async () => {
    mockSearchParams = { tab: "servers" };
    const user = userEvent.setup();
    render(<ToolRegistryPage />);

    const discoverButtons = screen.getAllByRole("button", { name: /^discover$/i });
    await user.click(discoverButtons[0]);

    await waitFor(() => {
      const discoverCall = calledEndpoints.find(
        (e) => e.url.includes("/discover") && !e.url.includes("/discover-auth"),
      );
      expect(discoverCall).toBeDefined();
    });

    await waitFor(() => {
      expect(mockRefreshServers).toHaveBeenCalled();
      expect(mockRefreshTools).toHaveBeenCalled();
    });
  });

  it("POSTs sync and refreshes servers + tools", async () => {
    mockSearchParams = { tab: "servers" };
    const user = userEvent.setup();
    render(<ToolRegistryPage />);

    const syncButtons = screen.getAllByRole("button", { name: /sync/i });
    await user.click(syncButtons[1]);

    await waitFor(() => {
      expect(calledEndpoints.some((e) => e.url.includes("/sync"))).toBe(true);
    });

    await waitFor(() => {
      expect(mockRefreshServers).toHaveBeenCalled();
      expect(mockRefreshTools).toHaveBeenCalled();
    });
  });

  it("DELETEs server when remove confirmed", async () => {
    mockSearchParams = { tab: "servers" };
    const user = userEvent.setup();
    render(<ToolRegistryPage />);

    const removeButtons = screen.getAllByRole("button", { name: /remove/i });
    await user.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/remove github-mcp/i)).toBeInTheDocument();
    });

    const confirmBtns = screen.getAllByRole("button", { name: /^remove$/i });
    await user.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => {
      expect(calledEndpoints.some((e) => e.method === "DELETE" && e.url.includes("srv-1"))).toBe(true);
    });

    await waitFor(() => {
      expect(mockRefreshServers).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Add server dialog — error handling
// ---------------------------------------------------------------------------

describe("ToolRegistryPage add server dialog", () => {
  it("shows API error in dialog when create fails", async () => {
    mockSearchParams = { tab: "servers" };
    const user = userEvent.setup();

    server.use(
      http.post(mcpBase, () =>
        new HttpResponse("Duplicate server name", { status: 409 }),
      ),
    );

    render(<ToolRegistryPage />);

    const addButtons = screen.getAllByRole("button", { name: /add mcp server/i });
    await user.click(addButtons[0]);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("e.g. github-mcp")).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText("e.g. github-mcp"), "dup-server");
    await user.type(
      screen.getByPlaceholderText("https://mcp-server.example.com"),
      "https://dup.example.com",
    );

    await user.click(screen.getByRole("button", { name: /^add server$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText("Duplicate server name")).toBeInTheDocument();
  });

  it("POSTs create server with correct payload shape", async () => {
    mockSearchParams = { tab: "servers" };
    const user = userEvent.setup();
    render(<ToolRegistryPage />);

    const addButtons = screen.getAllByRole("button", { name: /add mcp server/i });
    await user.click(addButtons[0]);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("e.g. github-mcp")).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText("e.g. github-mcp"), "new-server");
    await user.type(
      screen.getByPlaceholderText("https://mcp-server.example.com"),
      "https://new.example.com",
    );

    await user.click(screen.getByRole("button", { name: /^add server$/i }));

    await waitFor(() => {
      const createCall = calledEndpoints.find(
        (e) => e.method === "POST" && e.url === mcpBase,
      );
      expect(createCall).toBeDefined();
      const body = createCall!.body as Record<string, unknown>;
      expect(body.name).toBe("new-server");
      expect(body.url).toBe("https://new.example.com");
      expect(body.transport).toBe("streamable-http");
      expect(body.auth_mode).toBe("none");
    });
  });
});

// ---------------------------------------------------------------------------
// Tab navigation
// ---------------------------------------------------------------------------

describe("ToolRegistryPage tab navigation", () => {
  it("navigates when a tab is clicked", async () => {
    mockSearchParams = { tab: "servers" };
    const user = userEvent.setup();
    render(<ToolRegistryPage />);

    const toolsTab = screen.getByRole("tab", { name: /tools/i });
    await user.click(toolsTab);

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: { tab: "tools" } }),
    );
  });

  it("shows providers tab content when tab=providers", () => {
    mockSearchParams = { tab: "providers" };
    render(<ToolRegistryPage />);

    expect(screen.getByText("GitHub OAuth")).toBeInTheDocument();
  });

  it("shows all tab labels", () => {
    render(<ToolRegistryPage />);

    expect(screen.getByRole("tab", { name: /servers/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /tools/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /providers/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /accounts/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /access/i })).toBeInTheDocument();
  });
});
