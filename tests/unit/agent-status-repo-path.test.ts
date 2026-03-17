/**
 * Unit tests for repo path banner visibility logic in AgentStatusSection.
 *
 * The shouldShowRepoPathBanner function determines whether the repo path
 * configuration banner is visible based on the worktree manager feature flag.
 */
import { describe, expect, it } from "bun:test";
import { shouldShowRepoPathBanner } from "../../app/src/client/components/graph/AgentStatusSection";

describe("shouldShowRepoPathBanner", () => {
  it("returns false when worktreeManagerEnabled is false, even if repoPath is missing", () => {
    expect(shouldShowRepoPathBanner({ worktreeManagerEnabled: false, repoPath: undefined })).toBe(false);
  });

  it("returns false when worktreeManagerEnabled is false and repoPath is set", () => {
    expect(shouldShowRepoPathBanner({ worktreeManagerEnabled: false, repoPath: "/some/path" })).toBe(false);
  });

  it("returns true when worktreeManagerEnabled is true and repoPath is missing", () => {
    expect(shouldShowRepoPathBanner({ worktreeManagerEnabled: true, repoPath: undefined })).toBe(true);
  });

  it("returns false when worktreeManagerEnabled is true and repoPath is already set", () => {
    expect(shouldShowRepoPathBanner({ worktreeManagerEnabled: true, repoPath: "/some/path" })).toBe(false);
  });
});
