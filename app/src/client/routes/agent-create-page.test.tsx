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
// Tests
// ---------------------------------------------------------------------------

describe("AgentCreatePage", () => {
  it("shows runtime selection with external and sandbox options", async () => {
    const { AgentCreatePage } = await import("./agent-create-page");
    render(<AgentCreatePage />);

    // Both runtime option titles are rendered
    expect(screen.getByText("External")).toBeInTheDocument();
    expect(screen.getByText("Sandbox")).toBeInTheDocument();
    expect(screen.getByText(/choose a runtime/i)).toBeInTheDocument();
  });

  it("shows form fields after selecting a runtime", async () => {
    const { AgentCreatePage } = await import("./agent-create-page");
    render(<AgentCreatePage />);

    // Select external runtime
    await userEvent.click(screen.getByText("External"));

    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    });
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

    // Select runtime first
    await userEvent.click(screen.getByText("External"));

    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText(/name/i);
    await userEvent.type(nameInput, "Existing Agent");
    fireEvent.blur(nameInput);

    await waitFor(() => {
      expect(screen.getByText(/already taken/i)).toBeInTheDocument();
    });
  });

  it("renders authority scope form with 11 actions defaulting to propose", async () => {
    const { AgentCreatePage } = await import("./agent-create-page");
    render(<AgentCreatePage />);

    await userEvent.click(screen.getByText("External"));

    await waitFor(() => {
      expect(screen.getByText(/authority scopes/i)).toBeInTheDocument();
    });

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
    // Each action has one checked radio — there are 11 actions, so 11 checked radios
    expect(proposeRadios.length).toBe(11);
  });

  it("posts correct payload to create API on submit", async () => {
    stubFetch({
      "check-name": () =>
        new Response(JSON.stringify({ available: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      "/agents": (url, init) => {
        if (init?.method === "POST") {
          return new Response(
            JSON.stringify({
              agent: {
                id: "new-agent-1",
                name: "My Agent",
                runtime: "external",
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

    // Select runtime
    await userEvent.click(screen.getByText("External"));

    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    });

    // Fill name
    await userEvent.type(screen.getByLabelText(/name/i), "My Agent");

    // Submit
    const createButton = screen.getByRole("button", { name: /create/i });
    await userEvent.click(createButton);

    await waitFor(() => {
      const postCall = fetchCalls.find(
        (c) => c.method === "POST" && c.url.includes(`/api/workspaces/${WS}/agents`),
      );
      expect(postCall).toBeDefined();
      expect(postCall!.body).toMatchObject({
        name: "My Agent",
        runtime: "external",
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
    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    });

    // Fill name and submit
    await userEvent.type(screen.getByLabelText(/name/i), "External Bot");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

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

    // Select sandbox runtime
    await userEvent.click(screen.getByText("Sandbox"));
    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    });

    // Fill name and submit
    await userEvent.type(screen.getByLabelText(/name/i), "Sandbox Bot");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    // Should navigate to /agents since no proxy_token
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/agents" });
    });
  });
});
