import { describe, expect, it } from "bun:test";
import {
  executeCommitCheck,
  type GetLatestCommitMessage,
  type PostCommitCheck,
} from "../../../cli/commands/commit-check";

/**
 * Unit tests for the commit-check CLI command logic.
 *
 * Tests the pure pipeline: read latest commit message -> POST to server.
 * Uses function stubs for ports (getLatestCommitMessage, postCommitCheck).
 */

function createPostCommitCheckSpy(): {
  port: PostCommitCheck;
  calls: Array<{ message: string }>;
} {
  const calls: Array<{ message: string }> = [];
  const port: PostCommitCheck = async (message) => {
    calls.push({ message });
  };
  return { port, calls };
}

describe("executeCommitCheck", () => {
  it("Given a commit message, When executed, Then POSTs message to server", async () => {
    const getLatestCommitMessage: GetLatestCommitMessage = () => "feat: add login flow\n\ntask:abc-123";
    const { port: postCommitCheck, calls } = createPostCommitCheckSpy();

    await executeCommitCheck({ getLatestCommitMessage, postCommitCheck });

    expect(calls).toEqual([{ message: "feat: add login flow\n\ntask:abc-123" }]);
  });

  it("Given an empty commit message, When executed, Then does not POST", async () => {
    const getLatestCommitMessage: GetLatestCommitMessage = () => "";
    const { port: postCommitCheck, calls } = createPostCommitCheckSpy();

    await executeCommitCheck({ getLatestCommitMessage, postCommitCheck });

    expect(calls).toEqual([]);
  });

  it("Given getLatestCommitMessage throws, When executed, Then returns without error", async () => {
    const getLatestCommitMessage: GetLatestCommitMessage = () => {
      throw new Error("not a git repo");
    };
    const { port: postCommitCheck, calls } = createPostCommitCheckSpy();

    await executeCommitCheck({ getLatestCommitMessage, postCommitCheck });

    expect(calls).toEqual([]);
  });

  it("Given postCommitCheck throws, When executed, Then returns without error", async () => {
    const getLatestCommitMessage: GetLatestCommitMessage = () => "fix: something";
    const postCommitCheck: PostCommitCheck = async () => {
      throw new Error("server down");
    };

    // Should not throw — fire-and-forget
    await executeCommitCheck({ getLatestCommitMessage, postCommitCheck });
  });
});
