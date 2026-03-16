import { useState, useCallback } from "react";
import type { LearningSummary } from "../../../shared/contracts";
import { canSubmitApproval, buildApprovePayload } from "./dialog-logic";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { Button } from "../ui/button";

type ApproveDialogProps = {
  learning: LearningSummary;
  onConfirm: (learningId: string, editedText?: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
};

export function ApproveDialog({ learning, onConfirm, onCancel, isSubmitting }: ApproveDialogProps) {
  const [editedText, setEditedText] = useState(learning.text);

  const handleConfirm = useCallback(() => {
    const payload = buildApprovePayload(learning.id, learning.text, editedText);
    onConfirm(payload.learningId, payload.editedText);
  }, [learning.id, learning.text, editedText, onConfirm]);

  const isValid = canSubmitApproval(editedText);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve Learning</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="approve-text">Learning text (optional edit)</Label>
          <Textarea
            id="approve-text"
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            rows={4}
            disabled={isSubmitting}
          />
        </div>

        {learning.patternConfidence !== undefined && learning.patternConfidence < 0.7 && (
          <div className="rounded-md border border-entity-decision bg-entity-decision-muted px-3 py-2 text-xs text-entity-decision-fg">
            Low confidence ({Math.round(learning.patternConfidence * 100)}%) -- review text carefully before approving.
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!isValid || isSubmitting}>
            {isSubmitting ? "Approving..." : "Approve as Active"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
