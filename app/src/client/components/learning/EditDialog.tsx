import { useState, useCallback } from "react";
import {
  ENTITY_PRIORITIES,
  KNOWN_LEARNING_TARGET_AGENTS,
} from "../../../shared/contracts";
import type { LearningSummary } from "../../../shared/contracts";
import type { EditLearningData } from "../../hooks/use-learning-actions";
import {
  buildEditFormState,
  canSubmitEdit,
  buildEditPayload,
  type EditFormState,
} from "./edit-dialog-logic";
import { capitalize } from "./learning-card-logic";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { Button } from "../ui/button";

type EditDialogProps = {
  learning: LearningSummary;
  onConfirm: (learningId: string, data: EditLearningData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
};

export function EditDialog({ learning, onConfirm, onCancel, isSubmitting }: EditDialogProps) {
  const [form, setForm] = useState<EditFormState>(() => buildEditFormState(learning));

  const updateField = useCallback(
    <K extends keyof EditFormState>(field: K, value: EditFormState[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const toggleAgent = useCallback((agentValue: string) => {
    setForm((prev) => {
      const isSelected = prev.selectedAgents.includes(agentValue);
      const selectedAgents = isSelected
        ? prev.selectedAgents.filter((a) => a !== agentValue)
        : [...prev.selectedAgents, agentValue];
      return { ...prev, selectedAgents };
    });
  }, []);

  const handleConfirm = useCallback(() => {
    const payload = buildEditPayload(learning, form);
    if (payload) {
      onConfirm(learning.id, payload);
    }
  }, [learning, form, onConfirm]);

  const isValid = canSubmitEdit(form.text, form.priority);
  const hasChanges = buildEditPayload(learning, form) !== undefined;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Learning</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-text">Learning text</Label>
            <Textarea
              id="edit-text"
              value={form.text}
              onChange={(e) => updateField("text", e.target.value)}
              rows={4}
              disabled={isSubmitting}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-priority">Priority</Label>
            <select
              id="edit-priority"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:border-ring focus:outline-none"
              value={form.priority}
              onChange={(e) => updateField("priority", e.target.value as EditFormState["priority"])}
              disabled={isSubmitting}
            >
              {ENTITY_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {capitalize(p)}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-foreground">Target Agents</legend>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="rounded border-input"
                checked={form.targetAllAgents}
                onChange={(e) => updateField("targetAllAgents", e.target.checked)}
                disabled={isSubmitting}
              />
              All agents
            </label>

            {!form.targetAllAgents && (
              <div className="flex flex-col gap-1 pl-4">
                {KNOWN_LEARNING_TARGET_AGENTS.map((agent) => (
                  <label key={agent.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="rounded border-input"
                      checked={form.selectedAgents.includes(agent.value)}
                      onChange={() => toggleAgent(agent.value)}
                      disabled={isSubmitting}
                    />
                    {agent.label}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!isValid || !hasChanges || isSubmitting}>
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
