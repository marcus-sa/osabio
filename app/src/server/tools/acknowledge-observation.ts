import { tool } from "ai";
import { parseRecordIdString } from "../graph/queries";
import { acknowledgeObservationSchema } from "../mcp/osabio-tool-definitions";
import { acknowledgeObservation } from "../observation/queries";
import { requireAuthorizedContext } from "../iam/authority";
import type { ChatToolDeps } from "./types";

export function createAcknowledgeObservationTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Mark an observation as acknowledged — reviewed but still needs resolution. Transitions from open to acknowledged.",
    inputSchema: acknowledgeObservationSchema,
    execute: async (input, options) => {
      const { context } = await requireAuthorizedContext(options, "acknowledge_observation", deps);
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
