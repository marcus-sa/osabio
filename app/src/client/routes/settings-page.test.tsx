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

    // After fetch completes, should show enforcement mode
    await waitFor(() => {
      expect(screen.getByText("soft")).toBeInTheDocument();
    });

    // Should show workspace name
    expect(screen.getByText(WORKSPACE_NAME)).toBeInTheDocument();
  });
});
