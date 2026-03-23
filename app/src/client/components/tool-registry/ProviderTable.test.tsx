import { describe, it, expect } from "bun:test";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProviderTable } from "./ProviderTable";
import type { ProviderListItem } from "../../hooks/use-providers";

function makeProvider(overrides: Partial<ProviderListItem> = {}): ProviderListItem {
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

describe("ProviderTable", () => {
  it("renders provider rows with names", () => {
    const providers = [
      makeProvider({ id: "p1", name: "github", display_name: "GitHub" }),
      makeProvider({ id: "p2", name: "slack", display_name: "Slack" }),
    ];
    render(<ProviderTable providers={providers} onDelete={() => {}} />);

    expect(screen.getByText("github")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
  });

  it("shows empty state when no providers", () => {
    render(<ProviderTable providers={[]} onDelete={() => {}} />);
    expect(screen.getByText(/no credential providers configured/i)).toBeInTheDocument();
  });

  it("shows OAuth2 badge for oauth2 auth method", () => {
    render(<ProviderTable providers={[makeProvider({ auth_method: "oauth2" })]} onDelete={() => {}} />);
    expect(screen.getByText("OAuth2")).toBeInTheDocument();
  });

  it("shows API Key badge for api_key auth method", () => {
    render(<ProviderTable providers={[makeProvider({ auth_method: "api_key" })]} onDelete={() => {}} />);
    expect(screen.getByText("API Key")).toBeInTheDocument();
  });

  it("shows Yes when has_client_secret is true", () => {
    render(<ProviderTable providers={[makeProvider({ has_client_secret: true })]} onDelete={() => {}} />);
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it("shows No when has_client_secret is false", () => {
    render(<ProviderTable providers={[makeProvider({ has_client_secret: false })]} onDelete={() => {}} />);
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("delete button opens confirmation dialog", async () => {
    const user = userEvent.setup();
    render(<ProviderTable providers={[makeProvider({ display_name: "GitHub" })]} onDelete={() => {}} />);

    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(screen.getByText("Delete GitHub?")).toBeInTheDocument();
  });

  it("confirming delete calls onDelete with provider id", async () => {
    const user = userEvent.setup();
    const deleteCalls: string[] = [];
    render(
      <ProviderTable
        providers={[makeProvider({ id: "p1", display_name: "GitHub" })]}
        onDelete={(id) => deleteCalls.push(id)}
      />,
    );

    await user.click(screen.getByRole("button", { name: /delete/i }));
    // Click the destructive "Delete" button inside the dialog
    const dialogButtons = screen.getAllByRole("button", { name: /delete/i });
    const confirmButton = dialogButtons[dialogButtons.length - 1];
    await user.click(confirmButton);

    expect(deleteCalls).toEqual(["p1"]);
  });

  it("cancelling delete does not call onDelete", async () => {
    const user = userEvent.setup();
    const deleteCalls: string[] = [];
    render(
      <ProviderTable
        providers={[makeProvider({ id: "p1", display_name: "GitHub" })]}
        onDelete={(id) => deleteCalls.push(id)}
      />,
    );

    await user.click(screen.getByRole("button", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(deleteCalls).toEqual([]);
  });
});
