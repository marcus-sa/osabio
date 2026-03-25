import { tool } from "ai";
import { parseRecordIdString } from "../graph/queries";
import { resolveObservationSchema } from "../mcp/brain-tool-definitions";
import { resolveObservation } from "../observation/queries";
import { requireAuthorizedContext } from "../iam/authority";
import type { ChatToolDeps } from "./types";

export function createResolveObservationTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Resolve an observation — the concern has been addressed. Transitions from open or acknowledged to resolved.",
    inputSchema: resolveObservationSchema,
    execute: async (input, options) => {
      const { context } = await requireAuthorizedContext(options, "resolve_observation", deps);
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
