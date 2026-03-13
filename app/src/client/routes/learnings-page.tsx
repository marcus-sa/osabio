import { useCallback } from "react";
import { StatusTabs, computeStatusCounts } from "../components/learning/StatusTabs";
import { LearningFilters } from "../components/learning/LearningFilters";
import { LearningList } from "../components/learning/LearningList";
import { filterLearningsByStatus } from "../components/learning/learning-card-logic";
import { useLearnings } from "../hooks/use-learnings";
import type { LearningCardAction } from "../components/learning/LearningCard";
import type { LearningStatus, LearningType } from "../../shared/contracts";

export function LearningsPage() {
  const { learnings, isLoading, error, filters, setFilters } = useLearnings();

  const activeStatus: LearningStatus = filters.status ?? "active";
  const counts = computeStatusCounts(learnings);
  const filteredLearnings = filterLearningsByStatus(learnings, activeStatus);

  const handleCardAction = useCallback(
    (_action: LearningCardAction) => {
      // Action dialog wiring is step 03-03
    },
    [],
  );

  const handleStatusChange = useCallback(
    (status: LearningStatus) => {
      setFilters({ ...filters, status });
    },
    [filters, setFilters],
  );

  const handleTypeChange = useCallback(
    (type?: LearningType) => {
      setFilters({ ...filters, type });
    },
    [filters, setFilters],
  );

  const handleAgentChange = useCallback(
    (agent?: string) => {
      setFilters({ ...filters, agent });
    },
    [filters, setFilters],
  );

  return (
    <section className="learnings-page">
      <h1>Learnings</h1>
      <StatusTabs
        activeStatus={activeStatus}
        counts={counts}
        onStatusChange={handleStatusChange}
      />
      <LearningFilters
        selectedType={filters.type}
        selectedAgent={filters.agent}
        onTypeChange={handleTypeChange}
        onAgentChange={handleAgentChange}
      />
      {error && <p className="learnings-page__error">{error}</p>}
      <LearningList
        learnings={filteredLearnings}
        isLoading={isLoading}
        onAction={handleCardAction}
      />
    </section>
  );
}
