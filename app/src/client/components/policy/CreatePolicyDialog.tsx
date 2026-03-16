/**
 * Dialog for creating a new policy.
 */

import { useCallback, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useWorkspaceState } from "../../stores/workspace-state";
import {
  type RuleEntry,
  RuleBuilder,
  createEmptyRule,
  ruleEntryToApiRule,
} from "./RuleBuilder";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";

// ---------------------------------------------------------------------------
// Form state types
// ---------------------------------------------------------------------------

type PolicyFormState = {
  title: string;
  description: string;
  agentRole: string;
  humanVetoRequired: boolean;
  maxTtl: string;
  rules: RuleEntry[];
};

type FormErrors = {
  title?: string;
  description?: string;
  rules?: string;
  submit?: string;
};

// ---------------------------------------------------------------------------
// Pure form helpers
// ---------------------------------------------------------------------------

function createInitialFormState(): PolicyFormState {
  return {
    title: "",
    description: "",
    agentRole: "",
    humanVetoRequired: false,
    maxTtl: "",
    rules: [createEmptyRule()],
  };
}

function validateForm(state: PolicyFormState): FormErrors {
  const errors: FormErrors = {};
  if (state.title.trim() === "") errors.title = "Title is required";
  if (state.description.trim() === "") errors.description = "Description is required";
  if (state.rules.length === 0) {
    errors.rules = "At least one rule is required";
  } else {
    const hasEmptyField = state.rules.some((r) => r.field.trim() === "");
    if (hasEmptyField) errors.rules = "All rules must have a non-empty field";
  }
  return errors;
}

function hasErrors(errors: FormErrors): boolean {
  return Object.keys(errors).length > 0;
}

function buildRequestBody(state: PolicyFormState) {
  const body: Record<string, unknown> = {
    title: state.title.trim(),
    description: state.description.trim(),
    rules: state.rules.map(ruleEntryToApiRule),
  };
  if (state.agentRole.trim()) body.selector = { agent_role: state.agentRole.trim() };
  if (state.humanVetoRequired) body.human_veto_required = true;
  if (state.maxTtl.trim()) body.max_ttl = state.maxTtl.trim();
  return body;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type CreatePolicyDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function CreatePolicyDialog({ open, onClose }: CreatePolicyDialogProps) {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const navigate = useNavigate();

  const [form, setForm] = useState<PolicyFormState>(createInitialFormState);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = useCallback(
    <K extends keyof PolicyFormState>(field: K, value: PolicyFormState[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => {
        const next = { ...prev };
        if (field === "title") delete next.title;
        if (field === "rules") delete next.rules;
        delete next.submit;
        return next;
      });
    },
    [],
  );

  const handleRulesChange = useCallback(
    (rules: RuleEntry[]) => { updateField("rules", rules); },
    [updateField],
  );

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    setForm(createInitialFormState());
    setErrors({});
    onClose();
  }, [isSubmitting, onClose]);

  const handleSubmit = useCallback(async () => {
    const validationErrors = validateForm(form);
    if (hasErrors(validationErrors)) { setErrors(validationErrors); return; }
    if (!workspaceId) return;

    setIsSubmitting(true);
    setErrors({});

    try {
      const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/policies`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(form)),
      });

      if (!response.ok) {
        const text = await response.text();
        let message: string;
        try {
          const parsed = JSON.parse(text) as { error?: string };
          message = parsed.error ?? text;
        } catch { message = text; }
        setErrors({ submit: message || "Failed to create policy" });
        return;
      }

      const data = (await response.json()) as { policy_id: string };
      setForm(createInitialFormState());
      setErrors({});
      onClose();
      void navigate({ to: "/policies/$policyId", params: { policyId: data.policy_id } });
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : "Failed to create policy" });
    } finally {
      setIsSubmitting(false);
    }
  }, [form, workspaceId, onClose, navigate]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Policy</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {errors.submit && (
            <p className="text-sm text-destructive">{errors.submit}</p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="policy-title">Title <span className="text-destructive">*</span></Label>
            <Input
              id="policy-title"
              placeholder="e.g. Restrict code deployment"
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
            />
            {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="policy-description">Description <span className="text-destructive">*</span></Label>
            <Textarea
              id="policy-description"
              placeholder="Describe what this policy governs"
              rows={3}
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="policy-agent-role">Agent Role</Label>
              <Input
                id="policy-agent-role"
                placeholder="e.g. coding_agent"
                value={form.agentRole}
                onChange={(e) => updateField("agentRole", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="policy-max-ttl">Max TTL</Label>
              <Input
                id="policy-max-ttl"
                placeholder="e.g. 1h, 30m"
                value={form.maxTtl}
                onChange={(e) => updateField("maxTtl", e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="rounded border-input"
              checked={form.humanVetoRequired}
              onChange={(e) => updateField("humanVetoRequired", e.target.checked)}
            />
            Human veto required
          </label>

          <div className="flex flex-col gap-1.5">
            <RuleBuilder rules={form.rules} onRulesChange={handleRulesChange} />
            {errors.rules && <p className="text-xs text-destructive">{errors.rules}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Policy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
