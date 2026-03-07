import type { EntityDetailResponse, AgentSessionSummary } from "../../shared/contracts";
import type { EntityDetail } from "../graph/queries";

export type AgentSessionRow = {
  id: string;
  orchestrator_status: string;
  stream_id: string;
  started_at: string;
  files_changed_count: number;
};

function toAgentSessionSummary(row: AgentSessionRow): AgentSessionSummary {
  return {
    agentSessionId: row.id,
    orchestratorStatus: row.orchestrator_status,
    streamId: row.stream_id,
    startedAt: row.started_at,
    filesChangedCount: row.files_changed_count,
  };
}

export function buildEntityDetailResponse(
  detail: EntityDetail,
  agentSessionRow?: AgentSessionRow,
): EntityDetailResponse {
  const response: EntityDetailResponse = {
    entity: detail.entity,
    relationships: detail.relationships,
    provenance: detail.provenance,
  };

  if (detail.entity.kind === "task" && agentSessionRow) {
    response.agentSession = toAgentSessionSummary(agentSessionRow);
  }

  return response;
}
