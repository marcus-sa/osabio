import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS = "ws-settings-test";
const WORKSPACE_NAME = "Acme Corp";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

mock.module("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useSearch: () => ({}),
  useNavigate: () => mock(() => {}),
}));

mock.module("../stores/workspace-state", () => ({
  useWorkspaceState: (selector: (state: { workspaceId?: string; workspaceName?: string }) => unknown) =>
    selector({ workspaceId: WS, workspaceName: WORKSPACE_NAME }),
}));

// Mock the shadcn Select with a native <select> so tests can use fireEvent.change
mock.module("../components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <div data-testid="select-root" data-value={value ?? ""}>{children}
      <select
        data-testid="select-native-proxy"
        value={value ?? ""}
        onChange={(e) => onValueChange(e.target.value)}
        style={{ display: "none" }}
      >
        {/* Enforcement mode options */}
        <option value="bootstrap">bootstrap</option>
        <option value="soft">soft</option>
        <option value="hard">hard</option>
        {/* Sandbox provider options */}
        <option value="local">local</option>
        <option value="e2b">e2b</option>
        <option value="daytona">daytona</option>
        <option value="docker">docker</option>
      </select>
    </div>
  ),
  SelectTrigger: ({ children, ...props }: { children: React.ReactNode; "aria-label"?: string }) => (
    <button type="button" aria-label={props["aria-label"]}>{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span data-testid="select-value">{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <div data-value={value}>{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Stub fetch for the settings API call
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes(`/api/workspaces/${WS}/settings`)) {
      return new Response(
        JSON.stringify({
          enforcementMode: "soft",
          thresholds: { min_decisions: 3, min_tasks: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SettingsPage", () => {
  it("displays workspace name and enforcement mode after loading", async () => {
    const { SettingsPage } = await import("./settings-page");

    render(<SettingsPage />);

    expect(screen.getByText("Settings")).toBeInTheDocument();

    await waitFor(() => {
      const badge = screen.getByTestId("enforcement-mode-badge");
      expect(badge).toHaveTextContent("soft");
    });

    expect(screen.getByText(WORKSPACE_NAME)).toBeInTheDocument();
  });

  it("does not save enforcement mode until Save Settings is clicked (regression)", async () => {
    const { SettingsPage } = await import("./settings-page");

    const putCalls: Array<{ url: string; body: string }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes(`/api/workspaces/${WS}/settings`)) {
        if (init?.method === "PUT") {
          putCalls.push({ url, body: init.body as string });
          const payload = JSON.parse(init.body as string);
          return new Response(
            JSON.stringify({
              enforcementMode: payload.enforcementMode ?? "soft",
              thresholds: payload.thresholds ?? { min_decisions: 3, min_tasks: 5 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            enforcementMode: "soft",
            thresholds: { min_decisions: 3, min_tasks: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("enforcement-mode-badge")).toHaveTextContent("soft");
    });

    // Change mode via the enforcement Select (first proxy) — should NOT fire a PUT
    const enforcementProxy = screen.getByLabelText("Enforcement Mode")
      .closest("[data-testid='select-root']")
      ?.querySelector("[data-testid='select-native-proxy']") as HTMLSelectElement;
    fireEvent.change(enforcementProxy, { target: { value: "hard" } });
    expect(putCalls).toHaveLength(0);

    // Badge must still show the persisted server value, not the local edit
    expect(screen.getByTestId("enforcement-mode-badge")).toHaveTextContent("soft");

    // Click Save Settings — single PUT with both mode and thresholds
    const saveButton = screen.getByRole("button", { name: /save settings/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(putCalls).toHaveLength(1);
    });

    const body = JSON.parse(putCalls[0].body);
    expect(body.enforcementMode).toBe("hard");
    expect(body.thresholds).toEqual({ min_decisions: 3, min_tasks: 5 });
  });

  it("sends a single PUT with both mode and thresholds on save", async () => {
    const { SettingsPage } = await import("./settings-page");

    const putCalls: Array<{ url: string; body: string }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes(`/api/workspaces/${WS}/settings`)) {
        if (init?.method === "PUT") {
          putCalls.push({ url, body: init.body as string });
          const payload = JSON.parse(init.body as string);
          return new Response(
            JSON.stringify({
              enforcementMode: payload.enforcementMode ?? "soft",
              thresholds: payload.thresholds ?? { min_decisions: 5, min_tasks: 10 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            enforcementMode: "soft",
            thresholds: { min_decisions: 5, min_tasks: 10 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    render(<SettingsPage />);

    await waitFor(() => {
      const minDecisionsInput = screen.getByLabelText("min decisions");
      expect(minDecisionsInput).toBeInTheDocument();
      expect((minDecisionsInput as HTMLInputElement).value).toBe("5");
    });

    // Edit a threshold
    const minDecisionsInput = screen.getByLabelText("min decisions") as HTMLInputElement;
    fireEvent.change(minDecisionsInput, { target: { value: "3" } });

    // Change mode via the enforcement Select
    const enforcementProxy = screen.getByLabelText("Enforcement Mode")
      .closest("[data-testid='select-root']")
      ?.querySelector("[data-testid='select-native-proxy']") as HTMLSelectElement;
    fireEvent.change(enforcementProxy, { target: { value: "hard" } });

    // No PUT yet
    expect(putCalls).toHaveLength(0);

    // Save — should produce exactly one PUT with everything
    const saveButton = screen.getByRole("button", { name: /save settings/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(putCalls).toHaveLength(1);
    });

    const body = JSON.parse(putCalls[0].body);
    expect(body.enforcementMode).toBe("hard");
    expect(body.thresholds).toEqual({ min_decisions: 3, min_tasks: 10 });
  });

  it("renders sandbox provider section with current provider value", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes(`/api/workspaces/${WS}/settings`)) {
        return new Response(
          JSON.stringify({
            enforcementMode: "soft",
            sandboxProvider: "e2b",
            thresholds: { min_decisions: 3 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return originalFetch(input);
    }) as typeof fetch;

    const { SettingsPage } = await import("./settings-page");
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Sandbox Provider")).toBeInTheDocument();
    });

    const providerSelect = screen.getByLabelText("Sandbox Provider");
    expect(providerSelect).toBeInTheDocument();

    // All four options should be present as SelectItem divs
    for (const provider of ["local", "e2b", "daytona", "docker"]) {
      const items = screen.getAllByText(provider);
      const selectItem = items.find((el) => el.getAttribute("data-value") === provider);
      expect(selectItem).toBeDefined();
    }
  });

  it("shows 'Not configured' placeholder when no sandbox provider is set", async () => {
    // Default fetch stub already returns no sandboxProvider
    const { SettingsPage } = await import("./settings-page");
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Sandbox Provider")).toBeInTheDocument();
    });

    expect(screen.getByText("Not configured")).toBeInTheDocument();
  });

  it("saves sandbox provider on selection change via PUT /settings", async () => {
    const putCalls: Array<{ url: string; body: string }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes(`/api/workspaces/${WS}/settings`)) {
        if (init?.method === "PUT") {
          putCalls.push({ url, body: init.body as string });
          return new Response(
            JSON.stringify({
              enforcementMode: "soft",
              sandboxProvider: "daytona",
              thresholds: { min_decisions: 3 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            enforcementMode: "soft",
            thresholds: { min_decisions: 3 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const { SettingsPage } = await import("./settings-page");
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Sandbox Provider")).toBeInTheDocument();
    });

    // Find the sandbox provider select (second native proxy)
    const selects = screen.getAllByTestId("select-native-proxy");
    const sandboxSelect = selects.find((el) => {
      const root = el.closest("[data-testid='select-root']");
      return root?.getAttribute("data-value") === "";
    });
    expect(sandboxSelect).toBeDefined();

    fireEvent.change(sandboxSelect!, { target: { value: "daytona" } });

    await waitFor(() => {
      expect(putCalls).toHaveLength(1);
    });

    const body = JSON.parse(putCalls[0].body);
    expect(body.sandboxProvider).toBe("daytona");
  });
});
