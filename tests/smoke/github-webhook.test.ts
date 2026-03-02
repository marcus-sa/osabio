import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { fetchJson, setupSmokeSuite } from "./smoke-test-kit";

const getRuntime = setupSmokeSuite("github-webhook");

function makePushEvent(overrides: {
  ref?: string;
  defaultBranch?: string;
  commits?: Array<{ id: string; message: string; timestamp: string; url: string; author: { name: string; email: string; username?: string } }>;
} = {}) {
  const defaultBranch = overrides.defaultBranch ?? "main";
  return {
    ref: overrides.ref ?? `refs/heads/${defaultBranch}`,
    repository: {
      full_name: "acme/brain",
      default_branch: defaultBranch,
      html_url: "https://github.com/acme/brain",
    },
    commits: overrides.commits ?? [
      {
        id: "abc1234567890def",
        message: "feat(auth): swap bcrypt for argon2id in password hashing\n\nMigrate all password hashing to argon2id. Update user model\nand add migration script for existing hashes.",
        timestamp: new Date().toISOString(),
        url: "https://github.com/acme/brain/commit/abc1234567890def",
        author: { name: "Marcus", email: "marcus@acme.com", username: "marcus-sa" },
      },
    ],
  };
}

async function pollForRecord<T>(
  query: () => Promise<T[]>,
  timeoutMs: number,
  intervalMs = 500,
): Promise<T[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await query();
    if (rows.length > 0) return rows;
    await Bun.sleep(intervalMs);
  }
  return [];
}

describe("github webhook smoke", () => {
  it("rejects request without x-github-event header", async () => {
    const { baseUrl } = getRuntime();

    const workspace = await fetchJson<{ workspaceId: string }>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Webhook Smoke ${Date.now()}`, ownerDisplayName: "Marcus" }),
    });

    const res = await fetch(`${baseUrl}/api/workspaces/${workspace.workspaceId}/webhooks/github`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makePushEvent()),
    });

    expect(res.status).toBe(400);
  }, 30_000);

  it("returns 200 for non-push events", async () => {
    const { baseUrl } = getRuntime();

    const workspace = await fetchJson<{ workspaceId: string }>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Webhook Smoke ${Date.now()}`, ownerDisplayName: "Marcus" }),
    });

    const res = await fetch(`${baseUrl}/api/workspaces/${workspace.workspaceId}/webhooks/github`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-github-event": "issues",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { accepted: boolean; reason: string };
    expect(body.accepted).toBe(true);
    expect(body.reason).toBe("event type not processed");
  }, 30_000);

  it("returns 200 for non-default branch pushes", async () => {
    const { baseUrl } = getRuntime();

    const workspace = await fetchJson<{ workspaceId: string }>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Webhook Smoke ${Date.now()}`, ownerDisplayName: "Marcus" }),
    });

    const event = makePushEvent({ ref: "refs/heads/feature-branch", defaultBranch: "main" });
    const res = await fetch(`${baseUrl}/api/workspaces/${workspace.workspaceId}/webhooks/github`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-github-event": "push",
      },
      body: JSON.stringify(event),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { accepted: boolean; reason: string };
    expect(body.reason).toBe("non-default branch");
  }, 30_000);

  it("accepts push to default branch and creates git_commit with extraction", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspace = await fetchJson<{ workspaceId: string }>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Webhook Smoke ${Date.now()}`, ownerDisplayName: "Marcus" }),
    });

    const sha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    const event = makePushEvent({
      commits: [
        {
          id: sha,
          message: "refactor(api): migrate REST endpoints from Express to Hono\n\nReplace Express router with Hono for all /api/v2 routes.\nAdd request validation middleware and update integration tests.",
          timestamp: new Date().toISOString(),
          url: `https://github.com/acme/brain/commit/${sha}`,
          author: { name: "Marcus", email: "marcus@acme.com", username: "marcus-sa" },
        },
      ],
    });

    const res = await fetch(`${baseUrl}/api/workspaces/${workspace.workspaceId}/webhooks/github`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-github-event": "push",
      },
      body: JSON.stringify(event),
    });

    expect(res.status).toBe(202);
    const body = await res.json() as { accepted: boolean; commitsQueued: number };
    expect(body.accepted).toBe(true);
    expect(body.commitsQueued).toBe(1);

    // Poll for git_commit record (async processing)
    const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
    const commitRows = await pollForRecord(
      async () => {
        const [rows] = await surreal
          .query<[Array<{ id: RecordId<"git_commit", string>; sha: string; message: string; repository: string; embedding?: number[] }>]>(
            "SELECT id, sha, message, repository, embedding FROM git_commit WHERE sha = $sha AND workspace = $workspace;",
            { sha, workspace: workspaceRecord },
          )
          .collect<[Array<{ id: RecordId<"git_commit", string>; sha: string; message: string; repository: string; embedding?: number[] }>]>();
        return rows;
      },
      20_000,
    );

    expect(commitRows.length).toBe(1);
    const commit = commitRows[0]!;
    expect(commit.sha).toBe(sha);
    expect(commit.message).toContain("migrate REST endpoints from Express to Hono");
    expect(commit.repository).toBe("acme/brain");
    expect(Array.isArray(commit.embedding)).toBe(true);
    expect((commit.embedding ?? []).length).toBeGreaterThan(0);

    // Poll for extraction_relation edges (extraction runs after commit creation)
    const edgeRows = await pollForRecord(
      async () => {
        const [rows] = await surreal
          .query<[Array<{ id: RecordId; out: RecordId }>]>(
            "SELECT id, out FROM extraction_relation WHERE `in` = $commit;",
            { commit: commit.id },
          )
          .collect<[Array<{ id: RecordId; out: RecordId }>]>();
        return rows;
      },
      20_000,
    );

    expect(edgeRows.length).toBeGreaterThan(0);
  }, 45_000);

  it("returns 404 for unknown workspace", async () => {
    const { baseUrl } = getRuntime();

    const event = makePushEvent();
    const res = await fetch(`${baseUrl}/api/workspaces/nonexistent-workspace-id/webhooks/github`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-github-event": "push",
      },
      body: JSON.stringify(event),
    });

    expect(res.status).toBe(404);
  }, 30_000);
});
