/**
 * Acceptance Tests: Policy Enforcement (US-LP-005)
 *
 * Traces: US-LP-005 — Policy Enforcement at the LLM Call Boundary
 * Driving port: POST /proxy/llm/anthropic/v1/messages
 *
 * Validates that the proxy checks model access policies, budget limits,
 * and rate limits before forwarding requests, with clear error responses
 * for violations.
 *
 * Implementation sequence:
 * 1. Authorized request passes policy check — ENABLED
 * 2. Unauthorized model blocked with policy reference
 * 3. Budget exceeded blocked with spend details
 * 4. Rate limit exceeded with retry guidance
 * 5. No policies defaults to permissive
 * 6. Policy decision logged for audit
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  sendProxyRequest,
  createProxyTestWorkspace,
  createModelAccessPolicy,
  setWorkspaceBudget,
  seedLlmTrace,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_policy");

// ---------------------------------------------------------------------------
// Scenario: Authorized request passes policy check and is forwarded
// ---------------------------------------------------------------------------
describe("Authorized request passes policy check and is forwarded", () => {
  it("forwards request when model, budget, and rate policies all pass", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-policy-ok-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId, { dailyBudget: 50.0 });

    // Given workspace allows coding-agent to use sonnet
    await createModelAccessPolicy(surreal, workspaceId, {
      policyId: `pol-allow-${crypto.randomUUID()}`,
      agentType: "coding-agent",
      allowedModels: ["claude-sonnet-4-20250514"],
    });

    // When a coding-agent requests an allowed model within budget
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      workspaceHeader: workspaceId,
      agentTypeHeader: "coding-agent",
    });

    // Then the request is forwarded successfully
    expect(response.status).toBe(200);
    const body = await response.json() as { type: string };
    expect(body.type).toBe("message");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------

describe("Unauthorized model request blocked with policy reference", () => {
  it.skip("returns policy violation error when model is not in allowed list", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-policy-deny-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given workspace allows observer to use only haiku
    const policyId = `pol-restrict-${crypto.randomUUID()}`;
    await createModelAccessPolicy(surreal, workspaceId, {
      policyId,
      agentType: "observer",
      allowedModels: ["claude-haiku-3.5"],
    });

    // When the observer requests opus (not allowed)
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-opus-4-20250514",
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      workspaceHeader: workspaceId,
      agentTypeHeader: "observer",
    });

    // Then the request is rejected with policy violation
    expect(response.status).toBe(403);

    const body = await response.json() as {
      error: string;
      policy_ref?: string;
      remediation?: string;
    };
    expect(body.error).toBe("policy_violation");
    expect(body.remediation).toBeDefined();
  }, 15_000);
});

describe("Budget exceeded request blocked with spend details", () => {
  it.skip("returns budget exceeded error with current spend and limit", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-budget-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId, { dailyBudget: 50.0 });

    // Given workspace spend is at $49.80 (just under $50 limit)
    // Seed traces to push spend near the limit
    for (let i = 0; i < 50; i++) {
      await seedLlmTrace(surreal, `trace-budget-${crypto.randomUUID()}`, {
        model: "claude-sonnet-4-20250514",
        input_tokens: 10000,
        output_tokens: 2000,
        cost_usd: 0.996,
        latency_ms: 3000,
        workspaceId,
      });
    }

    // When any agent makes an LLM request
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      workspaceHeader: workspaceId,
      agentTypeHeader: "coding-agent",
    });

    // Then the request is rejected as over budget
    expect(response.status).toBe(429);

    const body = await response.json() as {
      error: string;
      current_spend?: string;
      daily_limit?: string;
      remediation?: string;
    };
    expect(body.error).toBe("budget_exceeded");
    expect(body.remediation).toBeDefined();
  }, 15_000);
});

describe("Rate limited request blocked with retry guidance", () => {
  it.skip("returns rate limit error with Retry-After header", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-rate-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given 60 requests have been made in the current minute
    // (Rate limiting is in-memory, so we need to send actual requests)
    // This test sends rapid requests to trigger the rate limit

    // Note: This test depends on the rate limiter being configured for this workspace.
    // The actual rate limit triggering requires sending > limit requests rapidly,
    // which is expensive. The crafter may implement this with a lower test-specific limit.

    // Placeholder: verify the rate limit response shape
    // when the feature is implemented
    expect(true).toBe(true);
  }, 15_000);
});

describe("No policies defaults to permissive with warning", () => {
  it.skip("forwards request when no policies exist, creates warning observation", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-nopolicy-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given workspace has NO model access policies

    // When any agent requests any model
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      workspaceHeader: workspaceId,
      agentTypeHeader: "coding-agent",
    });

    // Then the request is forwarded (permissive default)
    expect(response.status).toBe(200);

    // And a warning observation should be created (verified via graph query)
  }, 30_000);
});

describe("Policy decision logged for audit trail", () => {
  it.skip("records policy pass/fail with policy reference and timestamp", async () => {
    // This test validates that policy decisions are persisted for audit.
    // Requires US-LP-007 audit infrastructure.
    // The crafter should create a policy_decision record or edge for each evaluation.
    expect(true).toBe(true);
  });
});
