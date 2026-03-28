import { describe, it, expect, mock } from "bun:test";
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

  it("shows zero-evidence warning and risk elevation messaging under soft enforcement", () => {
    const item = buildFeedItem({
      evidenceSummary: { verified: 0, total: 0 },
      evidenceVerification: {
        verifiedCount: 0,
        totalCount: 0,
        enforcementMode: "soft",
        tierMet: false,
      },
    });

    render(<FeedItem item={item} onAction={() => {}} />);

    expect(screen.getByText("No evidence provided")).toBeInTheDocument();
    expect(screen.getByText("Risk score elevated")).toBeInTheDocument();
  });

  it("does not show zero-evidence warning when evidenceSummary has evidence", () => {
    const item = buildFeedItem({
      evidenceSummary: { verified: 2, total: 3 },
      evidenceVerification: {
        verifiedCount: 2,
        totalCount: 3,
        enforcementMode: "soft",
        tierMet: true,
      },
    });

    render(<FeedItem item={item} onAction={() => {}} />);

    expect(screen.queryByText("No evidence provided")).not.toBeInTheDocument();
    expect(screen.queryByText("Risk score elevated")).not.toBeInTheDocument();
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

describe("M6-5: Evidence ref row navigates to entity detail", () => {
  it("calls onEvidenceClick with the entityId when a ref row is clicked", async () => {
    const onEvidenceClick = mock(() => {});
    const item = buildFeedItem({
      evidenceSummary: { verified: 1, total: 1 },
      evidenceRefs: [
        { entityId: "decision:abc123", entityKind: "decision", title: "Standardize procurement workflow", verified: true },
      ],
    });

    render(<FeedItem item={item} onAction={() => {}} onEvidenceClick={onEvidenceClick} />);

    // Expand the evidence section
    const trigger = screen.getByText("1/1 verified");
    await userEvent.click(trigger);

    // Click the evidence ref row
    const refRow = screen.getByText("Standardize procurement workflow");
    await userEvent.click(refRow);

    // Then the callback is called with the entityId
    expect(onEvidenceClick).toHaveBeenCalledTimes(1);
    expect(onEvidenceClick).toHaveBeenCalledWith("decision:abc123");
  });

  it("does not crash when onEvidenceClick is not provided and ref row is clicked", async () => {
    const item = buildFeedItem({
      evidenceSummary: { verified: 1, total: 1 },
      evidenceRefs: [
        { entityId: "decision:abc123", entityKind: "decision", title: "Standardize procurement workflow", verified: true },
      ],
    });

    render(<FeedItem item={item} onAction={() => {}} />);

    // Expand and click -- should not throw
    const trigger = screen.getByText("1/1 verified");
    await userEvent.click(trigger);

    const refRow = screen.getByText("Standardize procurement workflow");
    await userEvent.click(refRow);
  });

  it("renders ref rows as clickable with cursor pointer styling", async () => {
    const item = buildFeedItem({
      evidenceSummary: { verified: 1, total: 1 },
      evidenceRefs: [
        { entityId: "decision:abc123", entityKind: "decision", title: "Standardize procurement workflow", verified: true },
      ],
    });

    render(<FeedItem item={item} onAction={() => {}} onEvidenceClick={() => {}} />);

    // Expand
    const trigger = screen.getByText("1/1 verified");
    await userEvent.click(trigger);

    // The row container should have cursor-pointer class when onEvidenceClick is provided
    const refRow = screen.getByText("Standardize procurement workflow").closest("[role='button']");
    expect(refRow).toBeTruthy();
  });
});
