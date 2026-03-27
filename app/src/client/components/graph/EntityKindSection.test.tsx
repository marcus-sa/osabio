import { describe, it, expect } from "bun:test";
import { render, screen } from "@testing-library/react";
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
