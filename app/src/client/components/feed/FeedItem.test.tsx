import { describe, it, expect } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("FeedItem expandable evidence detail section", () => {
  it("expands to show per-ref rows with entity type, title, verification state, and failure reason", async () => {
    const item = buildFeedItem({
      evidenceSummary: { verified: 2, total: 3 },
      evidenceRefs: [
        { entityId: "dec-1", entityKind: "decision", title: "Standardize procurement workflow", verified: true },
        { entityId: "task-1", entityKind: "task", title: "Audit procurement thresholds", verified: true },
        { entityId: "dec-2", entityKind: "decision", title: "External partner policy", verified: false, failureReason: "scope_mismatch" },
      ],
    });

    render(<FeedItem item={item} onAction={() => {}} />);

    // Before expanding, per-ref details should not be visible
    expect(screen.queryByText("Standardize procurement workflow")).not.toBeInTheDocument();
    expect(screen.queryByText("Audit procurement thresholds")).not.toBeInTheDocument();
    expect(screen.queryByText("External partner policy")).not.toBeInTheDocument();

    // Click the evidence summary badge to expand
    const trigger = screen.getByText("2/3 verified");
    await userEvent.click(trigger);

    // After expanding, each ref row shows title
    expect(screen.getByText("Standardize procurement workflow")).toBeInTheDocument();
    expect(screen.getByText("Audit procurement thresholds")).toBeInTheDocument();
    expect(screen.getByText("External partner policy")).toBeInTheDocument();

    // The failed ref shows the failure reason
    expect(screen.getByText("scope_mismatch")).toBeInTheDocument();
  });

  it("does not render expandable section when evidenceRefs is absent", () => {
    const item = buildFeedItem({
      evidenceSummary: { verified: 2, total: 3 },
    });

    render(<FeedItem item={item} onAction={() => {}} />);

    // Summary badge is visible
    expect(screen.getByText("2/3 verified")).toBeInTheDocument();
  });
});
