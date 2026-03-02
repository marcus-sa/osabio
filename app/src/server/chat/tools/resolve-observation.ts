import { tool } from "ai";
import { z } from "zod";
import { parseRecordIdString } from "../../graph/queries";
import { resolveObservation } from "../../observation/queries";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";

export function createResolveObservationTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Resolve an observation — the concern has been addressed. Transitions from open or acknowledged to resolved.",
    inputSchema: z.object({
      observation_id: z.string().min(1).describe("Observation record ID, e.g. observation:abc123"),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);
      const observationRecord = parseRecordIdString(input.observation_id, ["observation"], "observation");

      await resolveObservation({
        surreal: deps.surreal,
        workspaceRecord: context.workspaceRecord,
        observationRecord,
        now: new Date(),
        ...(context.workspaceOwnerRecord ? { resolvedByRecord: context.workspaceOwnerRecord } : {}),
      });

      return {
        observation_id: `observation:${observationRecord.id as string}`,
        status: "resolved",
      };
    },
  });
}
