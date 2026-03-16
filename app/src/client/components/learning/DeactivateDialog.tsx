import { useCallback } from "react";
import type { LearningSummary } from "../../../shared/contracts";
import { resolveAgentLabels } from "./learning-card-logic";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";

type DeactivateDialogProps = {
  learning: LearningSummary;
  onConfirm: (learningId: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
};

export function DeactivateDialog({ learning, onConfirm, onCancel, isSubmitting }: DeactivateDialogProps) {
  const affectedAgents = resolveAgentLabels(learning.targetAgents);

  const handleConfirm = useCallback(() => {
    onConfirm(learning.id);
  }, [learning.id, onConfirm]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deactivate Learning</DialogTitle>
          <DialogDescription>Are you sure you want to deactivate this learning?</DialogDescription>
        </DialogHeader>

        <blockquote className="border-l-2 border-border pl-3 text-xs italic text-muted-foreground">
          {learning.text}
        </blockquote>

        <p className="text-xs text-muted-foreground">
          Affected agents: {affectedAgents.join(", ")}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Deactivating..." : "Deactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
