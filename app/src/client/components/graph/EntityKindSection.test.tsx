import { describe, it, expect, mock } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import { EntityKindSection } from "./EntityKindSection";

describe("EntityKindSection", () => {
  describe("observation entity", () => {
    it("renders text, severity, status, and source_agent fields", () => {
      render(
        <EntityKindSection
          kind="observation"
          data={{
            text: "Vendor delivery SLA breach detected in Southeast Asia corridor",
            severity: "conflict",
            status: "open",
            source_agent: "supply-chain-monitor",
            observation_type: "anomaly",
          }}
        />,
      );

      expect(screen.getByText("Vendor delivery SLA breach detected in Southeast Asia corridor")).toBeInTheDocument();
      expect(screen.getByText("conflict")).toBeInTheDocument();
      expect(screen.getByText("open")).toBeInTheDocument();
      expect(screen.getByText("supply-chain-monitor")).toBeInTheDocument();
    });
  });

  describe("learning entity", () => {
    it("renders text, learning_type, status, and source fields", () => {
      render(
        <EntityKindSection
          kind="learning"
          data={{
            text: "Customs clearance requires advance filing 72 hours before arrival",
            learning_type: "constraint",
            status: "active",
            source: "human",
          }}
        />,
      );

      expect(screen.getByText("Customs clearance requires advance filing 72 hours before arrival")).toBeInTheDocument();
      expect(screen.getByText("constraint")).toBeInTheDocument();
      expect(screen.getByText("active")).toBeInTheDocument();
      expect(screen.getByText("human")).toBeInTheDocument();
    });
  });

  describe("git_commit entity", () => {
    it("renders message, truncated sha, author_name, and repository fields", () => {
      render(
        <EntityKindSection
          kind="git_commit"
          data={{
            message: "fix(logistics): correct duty calculation for cross-border shipments",
            sha: "abc123def456789012345678901234567890abcd",
            author_name: "logistics-dev",
            repository: "supply-chain/logistics-engine",
          }}
        />,
      );

      expect(screen.getByText("fix(logistics): correct duty calculation for cross-border shipments")).toBeInTheDocument();
      expect(screen.getByText("abc123d")).toBeInTheDocument(); // truncated to 7 chars
      expect(screen.getByText("logistics-dev")).toBeInTheDocument();
      expect(screen.getByText("supply-chain/logistics-engine")).toBeInTheDocument();
    });
  });

  describe("intent entity", () => {
    it("renders goal and status fields", () => {
      render(
        <EntityKindSection
          kind="intent"
          data={{
            goal: "Reroute shipments through alternate port due to congestion",
            status: "pending_auth",
            action_type: "reroute",
          }}
        />,
      );

      expect(screen.getByText("Reroute shipments through alternate port due to congestion")).toBeInTheDocument();
      expect(screen.getByText("pending auth")).toBeInTheDocument();
    });

    it("renders resolved evidence refs with entity names as clickable buttons", () => {
      const handleEntityClick = mock(() => {});
      render(
        <EntityKindSection
          kind="intent"
          data={{
            goal: "Submit quarterly compliance filing",
            status: "authorized",
            evidence_refs: [
              { table: "decision", id: "dec-001", name: "Standardize on tRPC for all internal APIs" },
              { table: "task", id: "task-002", name: "Migrate billing service to event sourcing" },
            ],
          }}
          onEntityClick={handleEntityClick}
        />,
      );

      expect(screen.getByText("Evidence References")).toBeInTheDocument();
      expect(screen.getByText("Standardize on tRPC for all internal APIs")).toBeInTheDocument();
      expect(screen.getByText("Migrate billing service to event sourcing")).toBeInTheDocument();

      // Clicking a ref triggers onEntityClick with table:id
      fireEvent.click(screen.getByText("Standardize on tRPC for all internal APIs"));
      expect(handleEntityClick).toHaveBeenCalledWith("decision:dec-001");

      fireEvent.click(screen.getByText("Migrate billing service to event sourcing"));
      expect(handleEntityClick).toHaveBeenCalledWith("task:task-002");
    });

    it("does not render evidence refs section when refs are empty", () => {
      render(
        <EntityKindSection
          kind="intent"
          data={{
            goal: "Review supplier risk assessment",
            status: "draft",
            evidence_refs: [],
          }}
        />,
      );

      expect(screen.queryByText("Evidence References")).toBeNull();
    });
  });

  describe("unsupported entity kind", () => {
    it("returns nothing for a kind without custom rendering", () => {
      const { container } = render(
        <EntityKindSection
          kind="project"
          data={{ description: "Some project" }}
        />,
      );

      expect(container.innerHTML).toBe("");
    });
  });
});
