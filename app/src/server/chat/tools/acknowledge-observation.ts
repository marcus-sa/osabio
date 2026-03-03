import { tool } from "ai";
import { z } from "zod";
import { parseRecordIdString } from "../../graph/queries";
import { acknowledgeObservation } from "../../observation/queries";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";

export function createAcknowledgeObservationTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Mark an observation as acknowledged — reviewed but still needs resolution. Transitions from open to acknowledged.",
    inputSchema: z.object({
      observation_id: z.string().min(1).describe("Observation record ID, e.g. observation:abc123"),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);
      const observationRecord = parseRecordIdString(input.observation_id, ["observation"], "observation");

      await acknowledgeObservation({
        surreal: deps.surreal,
        workspaceRecord: context.workspaceRecord,
        observationRecord,
        now: new Date(),
      });

      return {
        observation_id: `observation:${observationRecord.id as string}`,
        status: "acknowledged",
      };
    },
  });
}
