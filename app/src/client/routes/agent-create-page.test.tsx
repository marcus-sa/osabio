import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS = "ws-create-test";

// ---------------------------------------------------------------------------
// Module mocks — must be set before component import
// ---------------------------------------------------------------------------

const mockNavigate = mock(() => {});

mock.module("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>{children}</a>
  ),
  useNavigate: () => mockNavigate,
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
let fetchCalls: Array<{ url: string; method: string; body?: unknown }> = [];

const EMPTY_SKILLS_RESPONSE = new Response(
  JSON.stringify({ skills: [] }),
  { status: 200, headers: { "Content-Type": "application/json" } },
);

const EMPTY_TOOLS_RESPONSE = new Response(
  JSON.stringify({ tools: [] }),
  { status: 200, headers: { "Content-Type": "application/json" } },
);

function stubFetch(handlers: Record<string, (url: string, init?: RequestInit) => Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    fetchCalls.push({ url, method, body });

    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) {
        return handler(url, init);
      }
    }

    // Default stubs for skills and tools list endpoints
    if (url.includes("/skills")) {
      return new Response(JSON.stringify({ skills: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/tools")) {
      return new Response(JSON.stringify({ tools: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }) as typeof fetch;
}

beforeEach(() => {
  fetchCalls = [];
  mockNavigate.mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate from step 1 to step 3 (Tools / Create Agent) by filling name and clicking Next twice. */
async function navigateToStep3(name: string) {
  // Fill required name field
  const nameInput = screen.getByLabelText(/name/i);
  await userEvent.type(nameInput, name);

  // Step 1 → Step 2
  const nextButton = screen.getByRole("button", { name: /next/i });
  await userEvent.click(nextButton);

  // Step 2 → Step 3 (skip skills)
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /skip|next/i })).toBeInTheDocument();
  });
  const skipButton = screen.getByRole("button", { name: /skip|next/i });
  await userEvent.click(skipButton);

  // Wait for step 3 to render
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /create agent/i })).toBeInTheDocument();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentCreatePage", () => {
  it("shows runtime selection with external and sandbox options", async () => {
    stubFetch({});
    const { AgentCreatePage } = await import("./agent-create-page");
    render(<AgentCreatePage />);

    // Both runtime option titles are rendered as radio labels
    expect(screen.getByText("External")).toBeInTheDocument();
    expect(screen.getByText("Sandbox")).toBeInTheDocument();
  });

  it("shows form fields on step 1 with name input and authority scopes", async () => {
    stubFetch({});
    const { AgentCreatePage } = await import("./agent-create-page");
    render(<AgentCreatePage />);

    // Step 1 shows name input and authority scopes immediately (sandbox is default runtime)
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByText(/authority scopes/i)).toBeInTheDocument();
  });

  it("validates name uniqueness via check-name API on blur", async () => {
    stubFetch({
      "check-name": () =>
        new Response(JSON.stringify({ available: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    const { AgentCreatePage } = await import("./agent-create-page");
    render(<AgentCreatePage />);

    const nameInput = screen.getByLabelText(/name/i);
    await userEvent.type(nameInput, "Existing Agent");
    fireEvent.blur(nameInput);

    await waitFor(() => {
      expect(screen.getByText(/already taken/i)).toBeInTheDocument();
    });
  });

  it("renders authority scope form with 11 actions defaulting to propose", async () => {
    stubFetch({});
    const { AgentCreatePage } = await import("./agent-create-page");
    render(<AgentCreatePage />);

    expect(screen.getByText(/authority scopes/i)).toBeInTheDocument();

    // All 11 action labels should appear
    expect(screen.getByText("Create decisions")).toBeInTheDocument();
    expect(screen.getByText("Confirm decisions")).toBeInTheDocument();
    expect(screen.getByText("Create tasks")).toBeInTheDocument();
    expect(screen.getByText("Complete tasks")).toBeInTheDocument();
    expect(screen.getByText("Create observations")).toBeInTheDocument();
    expect(screen.getByText("Acknowledge observations")).toBeInTheDocument();
    expect(screen.getByText("Resolve observations")).toBeInTheDocument();
    expect(screen.getByText("Create questions")).toBeInTheDocument();
    expect(screen.getByText("Create suggestions")).toBeInTheDocument();
    expect(screen.getByText("Create intents")).toBeInTheDocument();
    expect(screen.getByText("Submit intents")).toBeInTheDocument();

    // All radio groups should have "propose" checked by default
    const proposeRadios = screen.getAllByRole("radio", { checked: true });
    // 11 authority scope radios (propose) + 1 runtime radio (sandbox) = 12
    expect(proposeRadios.length).toBe(12);
  });

  it("posts correct payload to create API on submit", async () => {
    stubFetch({
      "check-name": () =>
        new Response(JSON.stringify({ available: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      "/agents": (_url, init) => {
        if (init?.method === "POST") {
          return new Response(
            JSON.stringify({
              agent: {
                id: "new-agent-1",
                name: "My Agent",
                runtime: "sandbox",
                identity_id: "id-new",
                created_at: "2026-03-28T00:00:00Z",
              },
              workspace_id: WS,
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const { AgentCreatePage } = await import("./agent-create-page");
    render(<AgentCreatePage />);

    // Navigate through wizard to step 3
    await navigateToStep3("My Agent");

    // Submit from step 3
    await userEvent.click(screen.getByRole("button", { name: /create agent/i }));

    await waitFor(() => {
      const postCall = fetchCalls.find(
        (c) => c.method === "POST" && c.url.includes(`/api/workspaces/${WS}/agents`),
      );
      expect(postCall).toBeDefined();
      expect(postCall!.body).toMatchObject({
        name: "My Agent",
        runtime: "sandbox",
        authority_scopes: expect.arrayContaining([
          expect.objectContaining({ action: "create_task", permission: "propose" }),
        ]),
      });
    });
  });

  it("shows proxy token dialog when creation response includes proxy_token", async () => {
    stubFetch({
      "check-name": () =>
        new Response(JSON.stringify({ available: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      "/agents": (_url, init) => {
        if (init?.method === "POST") {
          return new Response(
            JSON.stringify({
              agent: {
                id: "new-ext-1",
                name: "External Bot",
                runtime: "external",
                identity_id: "id-ext",
                created_at: "2026-03-28T00:00:00Z",
              },
              proxy_token: "brp_secret_token_123",
              workspace_id: WS,
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const { AgentCreatePage } = await import("./agent-create-page");
    render(<AgentCreatePage />);

    // Select external runtime
    await userEvent.click(screen.getByText("External"));

    // Navigate through wizard to step 3
    await navigateToStep3("External Bot");

    // Submit
    await userEvent.click(screen.getByRole("button", { name: /create agent/i }));

    // Proxy token dialog should appear with the token
    await waitFor(() => {
      expect(screen.getByTestId("proxy-token-value")).toHaveTextContent("brp_secret_token_123");
    });
    expect(screen.getByText(/External Bot/)).toBeInTheDocument();
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();

    // Should NOT have navigated yet
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("navigates directly to /agents when creation has no proxy_token (sandbox)", async () => {
    stubFetch({
      "check-name": () =>
        new Response(JSON.stringify({ available: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      "/agents": (_url, init) => {
        if (init?.method === "POST") {
          return new Response(
            JSON.stringify({
              agent: {
                id: "new-sand-1",
                name: "Sandbox Bot",
                runtime: "sandbox",
                identity_id: "id-sand",
                created_at: "2026-03-28T00:00:00Z",
              },
              workspace_id: WS,
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const { AgentCreatePage } = await import("./agent-create-page");
    render(<AgentCreatePage />);

    // Navigate through wizard to step 3
    await navigateToStep3("Sandbox Bot");

    // Submit
    await userEvent.click(screen.getByRole("button", { name: /create agent/i }));

    // Should navigate to /agents since no proxy_token
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/agents" });
    });
  });
});
