import { useState, useCallback } from "react";
import {
  LEARNING_TYPES,
  KNOWN_LEARNING_TARGET_AGENTS,
  ENTITY_PRIORITIES,
} from "../../../shared/contracts";
import type { CreateLearningData } from "../../hooks/use-learning-actions";
import {
  canSubmitCreate,
  buildCreatePayload,
  INITIAL_CREATE_FORM,
  type CreateFormState,
} from "./create-dialog-logic";
import { capitalize } from "./learning-card-logic";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { Button } from "../ui/button";

type CollisionResult = {
  id: string;
  text: string;
  similarity: number;
};

type CreateDialogProps = {
  onConfirm: (data: CreateLearningData) => Promise<string | undefined>;
  onCancel: () => void;
  isSubmitting: boolean;
};

export function CreateDialog({ onConfirm, onCancel, isSubmitting }: CreateDialogProps) {
  const [form, setForm] = useState<CreateFormState>(INITIAL_CREATE_FORM);
  const [collisions, setCollisions] = useState<CollisionResult[]>([]);
  const [phase, setPhase] = useState<"form" | "collisions">("form");

  const updateField = useCallback(
    <K extends keyof CreateFormState>(field: K, value: CreateFormState[K]) => {
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

  const handleSubmit = useCallback(async () => {
    const payload = buildCreatePayload(form);
    const result = await onConfirm(payload);
    if (result) {
      setCollisions([]);
      setPhase("form");
    }
  }, [form, onConfirm]);

  const isValid = canSubmitCreate(form.text, form.learningType);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Learning</DialogTitle>
        </DialogHeader>

        {phase === "collisions" && collisions.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">Similar learnings found:</p>
            {collisions.map((collision) => (
              <div key={collision.id} className="flex items-start justify-between gap-2 rounded-md border border-border bg-muted p-2 text-xs">
                <span className="text-card-foreground">{collision.text}</span>
                <span className="shrink-0 text-muted-foreground">
                  {Math.round(collision.similarity * 100)}% match
                </span>
              </div>
            ))}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPhase("form")} disabled={isSubmitting}>
                Go Back
              </Button>
              <Button onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Anyway"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {phase === "form" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-text">Learning text (required)</Label>
              <Textarea
                id="create-text"
                value={form.text}
                onChange={(e) => updateField("text", e.target.value)}
                placeholder="Describe the learning rule or constraint..."
                rows={4}
                disabled={isSubmitting}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-type">Type (required)</Label>
              <select
                id="create-type"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:border-ring focus:outline-none"
                value={form.learningType}
                onChange={(e) => updateField("learningType", e.target.value as CreateFormState["learningType"])}
                disabled={isSubmitting}
              >
                <option value="">Select type...</option>
                {LEARNING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {capitalize(t)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-priority">Priority</Label>
              <select
                id="create-priority"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:border-ring focus:outline-none"
                value={form.priority}
                onChange={(e) => updateField("priority", e.target.value as CreateFormState["priority"])}
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

            <DialogFooter>
              <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!isValid || isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Learning"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
