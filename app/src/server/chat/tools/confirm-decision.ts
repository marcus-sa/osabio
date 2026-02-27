import { tool } from "ai";
import { z } from "zod";
import { confirmDecisionRecord, getDecisionRecordForWorkspace, getWorkspaceOwnerRecord } from "../../graph/queries";
import { requireToolContext, toDecisionRecordId } from "./helpers";
import type { ChatToolDeps } from "./types";

const CONFIRMABLE_STATUSES = new Set(["provisional", "inferred"]);

export function createConfirmDecisionTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Confirm a provisional or inferred decision. ONLY use this when the user explicitly approves a decision in conversation. Never call this without clear user authorization.",
    inputSchema: z.object({
      decision_id: z.string().min(1).describe("Decision record ID to confirm"),
      notes: z.string().optional().describe("Additional user context"),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);

      if (context.actor !== "chat_agent") {
        throw new Error("confirm_decision is only available for chat_agent context");
      }

      const decisionRecord = toDecisionRecordId(input.decision_id);
      const decision = await getDecisionRecordForWorkspace({
        surreal: deps.surreal,
        workspaceRecord: context.workspaceRecord,
        decisionInput: `decision:${decisionRecord.id as string}`,
      });

      if (!CONFIRMABLE_STATUSES.has(decision.status)) {
        throw new Error(`decision is not confirmable from status '${decision.status}'`);
      }

      const ownerRecord = context.workspaceOwnerRecord
        ? context.workspaceOwnerRecord
        : await getWorkspaceOwnerRecord({
            surreal: deps.surreal,
            workspaceRecord: context.workspaceRecord,
          });

      const confirmedAt = new Date();
      await confirmDecisionRecord({
        surreal: deps.surreal,
        decisionRecord: decision.id,
        confirmedAt,
        ...(ownerRecord ? { confirmedBy: ownerRecord } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      });

      return {
        decision_id: `decision:${decision.id.id as string}`,
        status: "confirmed",
        name: decision.summary,
      };
    },
  });
}
