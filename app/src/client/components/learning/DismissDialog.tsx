import { useState, useCallback } from "react";
import type { LearningSummary } from "../../../shared/contracts";
import { canSubmitDismissal, buildDismissPayload } from "./dialog-logic";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { Button } from "../ui/button";

type DismissDialogProps = {
  learning: LearningSummary;
  onConfirm: (learningId: string, reason: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
};

export function DismissDialog({ learning, onConfirm, onCancel, isSubmitting }: DismissDialogProps) {
  const [reason, setReason] = useState("");

  const handleConfirm = useCallback(() => {
    const payload = buildDismissPayload(learning.id, reason);
    onConfirm(payload.learningId, payload.reason);
  }, [learning.id, reason, onConfirm]);

  const isValid = canSubmitDismissal(reason);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dismiss Learning</DialogTitle>
          <DialogDescription>{learning.text}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="dismiss-reason">Reason for dismissal (required)</Label>
          <Textarea
            id="dismiss-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this learning being dismissed?"
            rows={3}
            disabled={isSubmitting}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!isValid || isSubmitting}>
            {isSubmitting ? "Dismissing..." : "Dismiss"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
