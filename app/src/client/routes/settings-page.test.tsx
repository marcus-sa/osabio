import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";

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
    // Dynamic import so mocks are in place before module evaluation
    const { SettingsPage } = await import("./settings-page");

    render(<SettingsPage />);

    // Should show heading
    expect(screen.getByText("Settings")).toBeInTheDocument();

    // After fetch completes, should show enforcement mode badge
    await waitFor(() => {
      const badge = screen.getByTestId("enforcement-mode-badge");
      expect(badge).toHaveTextContent("soft");
    });

    // Should show workspace name
    expect(screen.getByText(WORKSPACE_NAME)).toBeInTheDocument();
  });

  it("sends PUT request when enforcement mode is changed via selector", async () => {
    const { SettingsPage } = await import("./settings-page");
    const { fireEvent } = await import("@testing-library/react");

    const putCalls: Array<{ url: string; body: string }> = [];

    // Override fetch to capture PUT calls and respond to both GET and PUT
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes(`/api/workspaces/${WS}/settings`)) {
        if (init?.method === "PUT") {
          putCalls.push({ url, body: init.body as string });
          return new Response(
            JSON.stringify({ enforcementMode: "hard", thresholds: { min_decisions: 3, min_tasks: 5 } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // GET -- return current state based on whether PUT has been called
        const currentMode = putCalls.length > 0 ? "hard" : "soft";
        return new Response(
          JSON.stringify({
            enforcementMode: currentMode,
            thresholds: { min_decisions: 3, min_tasks: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    render(<SettingsPage />);

    // Wait for initial load showing 'soft'
    await waitFor(() => {
      const badge = screen.getByTestId("enforcement-mode-badge");
      expect(badge).toHaveTextContent("soft");
    });

    // Find the enforcement mode selector and change to 'hard'
    const modeSelector = screen.getByLabelText("Enforcement Mode");
    fireEvent.change(modeSelector, { target: { value: "hard" } });

    // Verify PUT was called with the correct payload
    await waitFor(() => {
      expect(putCalls.length).toBe(1);
    });
    expect(JSON.parse(putCalls[0].body)).toEqual({ enforcementMode: "hard" });

    // After successful PUT, the badge should reflect 'hard'
    await waitFor(() => {
      const badge = screen.getByTestId("enforcement-mode-badge");
      expect(badge).toHaveTextContent("hard");
    });
  });

  it("displays threshold values and sends PUT with updated thresholds on save", async () => {
    const { SettingsPage } = await import("./settings-page");
    const { fireEvent } = await import("@testing-library/react");

    const putCalls: Array<{ url: string; body: string }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes(`/api/workspaces/${WS}/settings`)) {
        if (init?.method === "PUT") {
          putCalls.push({ url, body: init.body as string });
          const payload = JSON.parse(init.body as string);
          return new Response(
            JSON.stringify({
              enforcementMode: "soft",
              thresholds: {
                min_decisions: payload.thresholds?.min_decisions ?? 5,
                min_tasks: payload.thresholds?.min_tasks ?? 10,
              },
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

    // Wait for initial load with thresholds displayed
    await waitFor(() => {
      const minDecisionsInput = screen.getByLabelText("min decisions");
      expect(minDecisionsInput).toBeInTheDocument();
      expect((minDecisionsInput as HTMLInputElement).value).toBe("5");
    });

    const minTasksInput = screen.getByLabelText("min tasks") as HTMLInputElement;
    expect(minTasksInput.value).toBe("10");

    // Change min_decisions to 3
    const minDecisionsInput = screen.getByLabelText("min decisions") as HTMLInputElement;
    fireEvent.change(minDecisionsInput, { target: { value: "3" } });

    // Click save thresholds button
    const saveButton = screen.getByRole("button", { name: /save thresholds/i });
    fireEvent.click(saveButton);

    // Verify PUT was called with correct thresholds payload
    await waitFor(() => {
      expect(putCalls.length).toBe(1);
    });
    const putBody = JSON.parse(putCalls[0].body);
    expect(putBody.thresholds).toEqual({ min_decisions: 3, min_tasks: 10 });
  });
});
