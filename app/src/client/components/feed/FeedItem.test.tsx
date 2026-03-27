import { describe, it, expect } from "bun:test";
import { render, screen } from "@testing-library/react";
import { FeedItem } from "./FeedItem";
import type { GovernanceFeedItem } from "../../../shared/contracts";

function buildFeedItem(overrides: Partial<GovernanceFeedItem> = {}): GovernanceFeedItem {
  return {
    id: "intent:test-123:pending_veto",
    tier: "review",
    entityId: "intent:test-123",
    entityKind: "intent",
    entityName: "Migrate supplier onboarding portal",
    reason: "Intent awaiting human review",
    status: "pending_veto",
    priority: "high",
    createdAt: new Date().toISOString(),
    actions: [],
    ...overrides,
  };
}

describe("FeedItem evidence summary badge", () => {
  it("displays 'N/M verified' badge when evidenceSummary is present", () => {
    const item = buildFeedItem({
      evidenceSummary: { verified: 2, total: 3 },
    });

    render(<FeedItem item={item} onAction={() => {}} />);

    expect(screen.getByText("2/3 verified")).toBeInTheDocument();
  });

  it("does not display evidence badge when evidenceSummary is absent", () => {
    const item = buildFeedItem();

    render(<FeedItem item={item} onAction={() => {}} />);

    expect(screen.queryByText(/verified/)).not.toBeInTheDocument();
  });
});
