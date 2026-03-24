import { describe, it, expect } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountTable } from "./AccountTable";
import type { AccountListItem } from "../../hooks/use-accounts";
import type { ProviderInfo } from "./AccountTable";

const PROVIDERS: ProviderInfo[] = [
  { id: "prov-1", displayName: "GitHub", authMethod: "oauth2" },
  { id: "prov-2", displayName: "Slack", authMethod: "api_key" },
];

function makeAccount(overrides: Partial<AccountListItem> = {}): AccountListItem {
  return {
    id: "acc-1",
    provider_id: "prov-1",
    status: "active",
    has_api_key: false,
    has_bearer_token: false,
    has_basic_credentials: false,
    has_access_token: true,
    connected_at: "2026-01-15T00:00:00Z",
    ...overrides,
  };
}

describe("AccountTable", () => {
  const noop = () => {};

  it("renders account rows with provider names", () => {
    const accounts = [
      makeAccount({ id: "a1", provider_id: "prov-1" }),
      makeAccount({ id: "a2", provider_id: "prov-2" }),
    ];
    render(
      <AccountTable accounts={accounts} providers={PROVIDERS} onRevoke={noop} onReconnect={noop} />,
    );
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
  });

  it("shows Active badge for active account", () => {
    render(
      <AccountTable
        accounts={[makeAccount({ status: "active" })]}
        providers={PROVIDERS}
        onRevoke={noop}
        onReconnect={noop}
      />,
    );
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows Revoked badge for revoked account", () => {
    render(
      <AccountTable
        accounts={[makeAccount({ status: "revoked" })]}
        providers={PROVIDERS}
        onRevoke={noop}
        onReconnect={noop}
      />,
    );
    expect(screen.getByText("Revoked")).toBeInTheDocument();
  });

  it("shows Expired badge for expired account", () => {
    render(
      <AccountTable
        accounts={[makeAccount({ status: "expired" })]}
        providers={PROVIDERS}
        onRevoke={noop}
        onReconnect={noop}
      />,
    );
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("active account shows Revoke action button", () => {
    render(
      <AccountTable
        accounts={[makeAccount({ status: "active" })]}
        providers={PROVIDERS}
        onRevoke={noop}
        onReconnect={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /revoke/i })).toBeInTheDocument();
  });

  it("revoked account shows Reconnect action button", () => {
    render(
      <AccountTable
        accounts={[makeAccount({ status: "revoked" })]}
        providers={PROVIDERS}
        onRevoke={noop}
        onReconnect={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /reconnect/i })).toBeInTheDocument();
  });

  it("shows empty state when no accounts", () => {
    render(
      <AccountTable accounts={[]} providers={PROVIDERS} onRevoke={noop} onReconnect={noop} />,
    );
    expect(screen.getByText(/no connected accounts/i)).toBeInTheDocument();
  });

  it("revoke button opens confirmation dialog", async () => {
    const user = userEvent.setup();
    render(
      <AccountTable
        accounts={[makeAccount({ status: "active", provider_id: "prov-1" })]}
        providers={PROVIDERS}
        onRevoke={noop}
        onReconnect={noop}
      />,
    );
    await user.click(screen.getByRole("button", { name: /revoke/i }));
    expect(screen.getByText("Revoke GitHub?")).toBeInTheDocument();
  });

  it("confirming revoke calls onRevoke with account id", async () => {
    const user = userEvent.setup();
    const revokeCalls: string[] = [];
    render(
      <AccountTable
        accounts={[makeAccount({ id: "acc-99", status: "active" })]}
        providers={PROVIDERS}
        onRevoke={(id) => revokeCalls.push(id)}
        onReconnect={noop}
      />,
    );
    await user.click(screen.getByRole("button", { name: /revoke/i }));
    // The dialog has a second "Revoke" button for confirmation
    const revokeButtons = screen.getAllByRole("button", { name: /revoke/i });
    await user.click(revokeButtons[revokeButtons.length - 1]);
    expect(revokeCalls).toEqual(["acc-99"]);
  });

  it("reconnect button calls onReconnect with account id and auth method", async () => {
    const user = userEvent.setup();
    const reconnectCalls: [string, string][] = [];
    render(
      <AccountTable
        accounts={[makeAccount({ id: "acc-5", status: "revoked", provider_id: "prov-2" })]}
        providers={PROVIDERS}
        onRevoke={noop}
        onReconnect={(id, method) => reconnectCalls.push([id, method])}
      />,
    );
    await user.click(screen.getByRole("button", { name: /reconnect/i }));
    expect(reconnectCalls).toEqual([["acc-5", "api_key"]]);
  });
});
