import { describe, expect, it } from "bun:test";
import { setupAcceptanceSuite } from "../acceptance-test-kit";

const getRuntime = setupAcceptanceSuite("signup-guard", {
  env: {
    SELF_HOSTED: "true",
  },
});

describe("POST /api/auth/sign-up/email (SELF_HOSTED=true)", () => {
  it("returns 403 when signup is attempted in self-hosted mode", async () => {
    const { baseUrl } = getRuntime();
    const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `test-${crypto.randomUUID()}@example.com`,
        password: "securepassword123",
        name: "Test User",
      }),
    });

    expect(response.status).toBe(403);
  });
});
