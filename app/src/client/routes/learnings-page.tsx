import { useCallback, useState } from "react";
import { StatusTabs, computeStatusCounts } from "../components/learning/StatusTabs";
import { LearningFilters } from "../components/learning/LearningFilters";
import { LearningList } from "../components/learning/LearningList";
import { CreateDialog } from "../components/learning/CreateDialog";
import { ApproveDialog } from "../components/learning/ApproveDialog";
import { DismissDialog } from "../components/learning/DismissDialog";
import { EditDialog } from "../components/learning/EditDialog";
import { DeactivateDialog } from "../components/learning/DeactivateDialog";
import { filterLearningsByStatus } from "../components/learning/learning-card-logic";
import {
  type DialogState,
  resolveDialogFromCardAction,
  closeDialog,
} from "../components/learning/page-dialog-logic";
import { useLearnings } from "../hooks/use-learnings";
import { useLearningActions } from "../hooks/use-learning-actions";
import type { LearningCardAction } from "../components/learning/LearningCard";
import type { LearningStatus, LearningType } from "../../shared/contracts";
import { Button } from "../components/ui/button";

export function LearningsPage() {
  const { learnings, isLoading, error, filters, setFilters, refresh } = useLearnings();
  const { approve, dismiss, create, edit, deactivate, isSubmitting } = useLearningActions();
  const [dialogState, setDialogState] = useState<DialogState | undefined>();

  const activeStatus: LearningStatus = filters.status ?? "active";
  const counts = computeStatusCounts(learnings);
  const filteredLearnings = filterLearningsByStatus(learnings, activeStatus);

  const handleCardAction = useCallback(
    (cardAction: LearningCardAction) => {
      const nextState = resolveDialogFromCardAction(cardAction, learnings);
      if (nextState) setDialogState(nextState);
    },
    [learnings],
  );

  const handleCloseDialog = useCallback(() => {
    setDialogState(closeDialog(dialogState));
  }, [dialogState]);

  const handleApproveConfirm = useCallback(
    async (learningId: string, _editedText?: string) => {
      const success = await approve(learningId);
      if (success) {
        handleCloseDialog();
        refresh();
      }
    },
    [approve, handleCloseDialog, refresh],
  );

  const handleDismissConfirm = useCallback(
    async (learningId: string, _reason: string) => {
      const success = await dismiss(learningId);
      if (success) {
        handleCloseDialog();
        refresh();
      }
    },
    [dismiss, handleCloseDialog, refresh],
  );

  const handleCreateConfirm = useCallback(
    async (data: Parameters<typeof create>[0]) => {
      const result = await create(data);
      if (result) {
        handleCloseDialog();
        refresh();
      }
      return result;
    },
    [create, handleCloseDialog, refresh],
  );

  const handleEditConfirm = useCallback(
    async (learningId: string, data: Parameters<typeof edit>[1]) => {
      const success = await edit(learningId, data);
      if (success) {
        handleCloseDialog();
        refresh();
      }
    },
    [edit, handleCloseDialog, refresh],
  );

  const handleDeactivateConfirm = useCallback(
    async (learningId: string) => {
      const success = await deactivate(learningId);
      if (success) {
        handleCloseDialog();
        refresh();
      }
    },
    [deactivate, handleCloseDialog, refresh],
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
    <section className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Learnings</h1>
        <Button size="sm" onClick={() => setDialogState({ type: "create" })}>
          New Learning
        </Button>
      </div>
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
      {error && <p className="text-sm text-destructive">{error}</p>}
      <LearningList
        learnings={filteredLearnings}
        isLoading={isLoading}
        onAction={handleCardAction}
      />

      {dialogState?.type === "create" && (
        <CreateDialog
          onConfirm={handleCreateConfirm}
          onCancel={handleCloseDialog}
          isSubmitting={isSubmitting}
        />
      )}

      {dialogState?.type === "approve" && (
        <ApproveDialog
          learning={dialogState.learning}
          onConfirm={handleApproveConfirm}
          onCancel={handleCloseDialog}
          isSubmitting={isSubmitting}
        />
      )}

      {dialogState?.type === "dismiss" && (
        <DismissDialog
          learning={dialogState.learning}
          onConfirm={handleDismissConfirm}
          onCancel={handleCloseDialog}
          isSubmitting={isSubmitting}
        />
      )}

      {dialogState?.type === "edit" && (
        <EditDialog
          learning={dialogState.learning}
          onConfirm={handleEditConfirm}
          onCancel={handleCloseDialog}
          isSubmitting={isSubmitting}
        />
      )}

      {dialogState?.type === "deactivate" && (
        <DeactivateDialog
          learning={dialogState.learning}
          onConfirm={handleDeactivateConfirm}
          onCancel={handleCloseDialog}
          isSubmitting={isSubmitting}
        />
      )}
    </section>
  );
}
