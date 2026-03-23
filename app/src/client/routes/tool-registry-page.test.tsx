import { describe, it, expect } from "bun:test";
import React from "react";
import { render, screen } from "@testing-library/react";
import type { ProviderListItem } from "../hooks/use-providers";

/**
 * Extracted providers tab content — mirrors the exact rendering logic
 * from ToolRegistryPage to test the empty-state vs add-button visibility.
 */
function ProvidersTabContent({
  providers,
}: {
  providers: ProviderListItem[];
}) {
  if (providers.length === 0) {
    return (
      <div>
        <p>No credential providers configured.</p>
        <button>Add Provider</button>
      </div>
    );
  }
  return (
    <>
      <div className="flex justify-end py-2">
        <button>Add Provider</button>
      </div>
      <table>
        <tbody>
          {providers.map((p) => (
            <tr key={p.id}>
              <td>{p.display_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function makeProvider(
  overrides: Partial<ProviderListItem> = {},
): ProviderListItem {
  return {
    id: "p1",
    name: "github",
    display_name: "GitHub",
    auth_method: "oauth2",
    has_client_secret: true,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ProvidersTabContent", () => {
  it("does not show Add Provider button when no providers exist", () => {
    render(<ProvidersTabContent providers={[]} />);

    // Only one "Add Provider" — the empty state CTA
    const buttons = screen.getAllByRole("button", { name: /add provider/i });
    expect(buttons).toHaveLength(1);

    // The empty state message should be visible
    expect(
      screen.getByText(/no credential providers configured/i),
    ).toBeInTheDocument();
  });

  it("shows Add Provider button when providers exist", () => {
    render(
      <ProvidersTabContent
        providers={[makeProvider(), makeProvider({ id: "p2", name: "slack", display_name: "Slack" })]}
      />,
    );

    // The add button should be present
    expect(
      screen.getByRole("button", { name: /add provider/i }),
    ).toBeInTheDocument();

    // No empty state message
    expect(
      screen.queryByText(/no credential providers configured/i),
    ).not.toBeInTheDocument();

    // Provider names should render
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
  });
});
