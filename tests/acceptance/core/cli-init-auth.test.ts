import { describe, expect, it, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { RecordId } from "surrealdb";
import { setupAcceptanceSuite } from "../acceptance-test-kit";
import { setupAuth } from "../../../cli/commands/init";
import type { BrainGlobalConfig } from "../../../cli/config";

const getRuntime = setupAcceptanceSuite("cli-init-auth");

/** Sign up a test user and return session headers for OAuth flow */
async function signUpAndGetSession(baseUrl: string, email: string, name: string): Promise<{
  userId: string;
  headers: Record<string, string>;
}> {
  const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "test-password-123!", name }),
  });
  if (!res.ok) throw new Error(`Sign up failed: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as { user: { id: string }; token: string };
  const cookies = res.headers.getSetCookie();
  const sessionCookie = cookies.find((c) => c.startsWith("better-auth.session_token="));
  const sessionToken = sessionCookie
    ? decodeURIComponent(sessionCookie.split("=")[1].split(";")[0])
    : data.token;

  return {
    userId: data.user.id,
    headers: { Cookie: `better-auth.session_token=${sessionToken}` },
  };
}

describe("CLI init setupAuth", () => {
  let configDir: string;
  let gitRoot: string;
  const originalConfigDir = process.env.BRAIN_CONFIG_DIR;

  afterAll(() => {
    // Restore env so other tests aren't affected
    if (originalConfigDir) {
      process.env.BRAIN_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.BRAIN_CONFIG_DIR;
    }
    if (configDir) rmSync(configDir, { recursive: true, force: true });
    if (gitRoot) rmSync(gitRoot, { recursive: true, force: true });
  });

  it("completes full OAuth PKCE flow and saves tokens", async () => {
    const { baseUrl, surreal } = getRuntime();

    // 1. Create workspace with required SCHEMAFULL fields
    const workspaceId = crypto.randomUUID();
    const wsRecord = new RecordId("workspace", workspaceId);
    await surreal.query(
      `CREATE $ws CONTENT {
        name: "CLI Init Test Workspace",
        status: "active",
        onboarding_complete: true,
        onboarding_turn_count: 0,
        onboarding_summary_pending: false,
        onboarding_started_at: time::now(),
        created_at: time::now()
      };`,
      { ws: wsRecord },
    );

    // Create a project (listProjects needs at least one)
    const projRecord = new RecordId("project", crypto.randomUUID());
    await surreal.query(
      `CREATE $proj CONTENT {
        name: "Test Project",
        status: "active",
        workspace: $ws,
        created_at: time::now()
      };`,
      { proj: projRecord, ws: wsRecord },
    );
    await surreal.query(`RELATE $ws->has_project->$proj SET added_at = time::now();`, {
      ws: wsRecord,
      proj: projRecord,
    });

    // 2. Sign up user and create workspace membership
    const { userId, headers: sessionHeaders } = await signUpAndGetSession(
      baseUrl,
      "cli-init-test@example.com",
      "CLI Init Tester",
    );
    const personRecord = new RecordId("person", userId);
    const identityRecord = new RecordId("identity", crypto.randomUUID());
    await surreal.query(
      `CREATE $identity CONTENT { name: "CLI Init Tester", type: "human", role: "admin", workspace: $ws, created_at: time::now() };`,
      { identity: identityRecord, ws: wsRecord },
    );
    await surreal.query(
      `RELATE $identity->identity_person->$person SET added_at = time::now();`,
      { identity: identityRecord, person: personRecord },
    );
    await surreal.query(`RELATE $identity->member_of->$ws SET role = "admin", added_at = time::now();`, {
      identity: identityRecord,
      ws: wsRecord,
    });

    // Trigger JWKS key generation
    await fetch(`${baseUrl}/api/auth/jwks`);

    // 3. Set up temp git repo and isolated config dir
    gitRoot = mkdtempSync(join(tmpdir(), "brain-init-auth-"));
    execSync("git init", { cwd: gitRoot, stdio: "ignore" });

    configDir = mkdtempSync(join(tmpdir(), "brain-init-config-"));
    process.env.BRAIN_CONFIG_DIR = configDir;

    // 4. Run setupAuth with injectable openUrl that simulates the browser
    await setupAuth(baseUrl, workspaceId, gitRoot, {
      openUrl: (url: string) => {
        // Fire-and-forget async: programmatically complete the OAuth dance
        (async () => {
          try {
            // Parse the auth URL to extract client_id for skipConsent
            const authUrl = new URL(url);
            const clientId = authUrl.searchParams.get("client_id")!;

            // Skip consent screen in test
            await surreal.query(`UPDATE oauthClient SET skipConsent = true WHERE clientId = $cid;`, {
              cid: clientId,
            });

            // Sign in again to get fresh session (signup session may have expired)
            const signInRes = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: "cli-init-test@example.com", password: "test-password-123!" }),
            });
            const signInData = (await signInRes.json()) as { token: string };
            const cookies = signInRes.headers.getSetCookie();
            const sessionCookie = cookies.find((c) => c.startsWith("better-auth.session_token="));
            const token = sessionCookie
              ? decodeURIComponent(sessionCookie.split("=")[1].split(";")[0])
              : signInData.token;

            // Hit the authorize endpoint — server redirects to the callback URL with the code
            const authRes = await fetch(url, {
              headers: { Cookie: `better-auth.session_token=${token}` },
              redirect: "manual",
            });

            if (authRes.status !== 302) {
              throw new Error(`Authorize did not redirect: ${authRes.status}`);
            }

            // Follow the redirect to setupAuth's local callback server
            const location = authRes.headers.get("location")!;
            await fetch(location);
          } catch (err) {
            console.error("openUrl simulation failed:", err);
          }
        })();
      },
    });

    // 5. Verify config was saved
    const configPath = join(configDir, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as BrainGlobalConfig;

    expect(config.server_url).toBe(baseUrl);
    expect(config.repos[gitRoot]).toBeDefined();

    const repo = config.repos[gitRoot];
    expect(repo.workspace).toBe(workspaceId);
    expect(repo.client_id).toBeTruthy();
    expect(repo.access_token).toBeTruthy();
    expect(repo.refresh_token).toBeTruthy();
    expect(repo.token_expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // 6. Verify the access token actually works on an MCP route
    const mcpRes = await fetch(`${baseUrl}/api/mcp/${workspaceId}/projects`, {
      headers: { Authorization: `Bearer ${repo.access_token}` },
    });
    expect(mcpRes.status).toBe(200);
  }, 60_000);
});
