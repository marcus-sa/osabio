import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { RecordId } from "surrealdb";
import { createTestUser, fetchJson, setupAcceptanceSuite } from "../acceptance-test-kit";
import type { WorkspaceConversationResponse } from "../../../app/src/shared/contracts";
import {
  seedConversation,
  seedAssistantMessage,
  seedUserMessage,
  seedTraceForMessage,
  makeSampleTrace,
} from "./trace-test-kit";

const getRuntime = setupAcceptanceSuite("trace_migration_branch");

describe("Branch Inheritance: Traces on inherited messages survive branching", () => {
  it("branched conversation inherits parent messages with their traces", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "trace-branch-1");
    const conv = await seedConversation(baseUrl, surreal, user, "branch-parent");

    // GIVEN a parent conversation with a traced assistant message
    const t0 = new Date();
    const userMsg = await seedUserMessage(
      surreal,
      conv.conversationRecord,
      "Plan the authentication module",
      t0,
    );
    const t1 = new Date(t0.getTime() + 1000);
    const assistantMsg = await seedAssistantMessage(
      surreal,
      conv.conversationRecord,
      "Created auth module tasks with OAuth and session management.",
      t1,
    );
    await seedTraceForMessage(
      surreal,
      assistantMsg,
      conv.workspaceRecord,
      conv.identityRecord,
      makeSampleTrace({ intent: "plan_work", agentId: "pm_agent" }),
    );

    // AND a child conversation branched from the assistant message
    const childConvId = randomUUID();
    const childConvRecord = new RecordId("conversation", childConvId);
    await surreal.create(childConvRecord).content({
      createdAt: new Date(t1.getTime() + 1000),
      updatedAt: new Date(t1.getTime() + 1000),
      workspace: conv.workspaceRecord,
      title: "Branch: auth alternatives",
      title_source: "message",
    });

    // Create branched_from edge
    const branchedFromId = randomUUID();
    await surreal
      .relate(
        childConvRecord,
        new RecordId("branched_from", branchedFromId),
        conv.conversationRecord,
        { branch_point_message: assistantMsg, branched_at: new Date(t1.getTime() + 1000) },
      )
      .output("after");

    // AND the child conversation has its own follow-up messages
    const t2 = new Date(t1.getTime() + 2000);
    await seedUserMessage(surreal, childConvRecord, "What about SAML support?", t2);
    const t3 = new Date(t2.getTime() + 1000);
    await seedAssistantMessage(
      surreal,
      childConvRecord,
      "SAML would require additional federation setup.",
      t3,
    );

    // WHEN the child conversation is loaded via API
    const conversation = await fetchJson<WorkspaceConversationResponse>(
      `${baseUrl}/api/workspaces/${conv.workspaceId}/conversations/${childConvId}`,
      { headers: user.headers },
    );

    // THEN inherited messages from parent include the trace
    const inheritedAssistant = conversation.messages.find(
      (m) => m.id === (assistantMsg.id as string),
    );
    expect(inheritedAssistant).toBeDefined();
    expect(inheritedAssistant!.inherited).toBe(true);
    expect(inheritedAssistant!.subagentTraces).toBeDefined();
    expect(inheritedAssistant!.subagentTraces!.length).toBe(1);
    expect(inheritedAssistant!.subagentTraces![0]!.agentId).toBe("pm_agent");
    expect(inheritedAssistant!.subagentTraces![0]!.intent).toBe("plan_work");

    // AND the child's own messages are present without traces
    const childMessages = conversation.messages.filter((m) => !m.inherited);
    // At minimum the child's own user + assistant messages exist
    expect(childMessages.length).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
