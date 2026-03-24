import { useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  validateCreateGrantForm,
  type CreateGrantFormData,
} from "./GrantTable";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IdentityOption = {
  id: string;
  name: string;
};

export type DropdownOption = {
  label: string;
  value: string;
};

export type CreateGrantDialogInput = {
  identities: IdentityOption[];
  isLoading: boolean;
};

export type CreateGrantDialogViewModel = {
  identityOptions: DropdownOption[];
  isLoadingIdentities: boolean;
  placeholderText: string;
};

// ---------------------------------------------------------------------------
// View model derivation
// ---------------------------------------------------------------------------

function toDropdownOption(identity: IdentityOption): DropdownOption {
  return {
    label: identity.name,
    value: identity.id,
  };
}

export function deriveCreateGrantDialogViewModel(
  input: CreateGrantDialogInput,
): CreateGrantDialogViewModel {
  const identityOptions = input.identities.map(toDropdownOption);

  const placeholderText = input.isLoading
    ? "Loading identities..."
    : identityOptions.length === 0
      ? "No identities available"
      : "Select an identity";

  return {
    identityOptions,
    isLoadingIdentities: input.isLoading,
    placeholderText,
  };
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

type CreateGrantDialogProps = {
  toolId: string;
  toolName: string;
  identities: IdentityOption[];
  isLoadingIdentities: boolean;
  onSubmit: (formData: CreateGrantFormData) => Promise<{ error?: string }>;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function initialFormData(): CreateGrantFormData {
  return {
    identity_id: "",
  };
}

export function CreateGrantDialog({
  toolName,
  identities,
  isLoadingIdentities,
  onSubmit,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: CreateGrantDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = isControlled ? (controlledOnOpenChange ?? (() => {})) : setUncontrolledOpen;
  const [formData, setFormData] = useState<CreateGrantFormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();

  const validation = validateCreateGrantForm(formData);
  const vm = deriveCreateGrantDialogViewModel({
    identities,
    isLoading: isLoadingIdentities,
  });

  const handleIdentityChange = useCallback((value: string | null) => {
    if (!value) return;
    setFormData((prev) => ({ ...prev, identity_id: value }));
    setSubmitError(undefined);
  }, []);

  const handleRateLimitChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const parsed = raw === "" ? undefined : Number.parseInt(raw, 10);
      setFormData((prev) => ({
        ...prev,
        max_calls_per_hour: Number.isNaN(parsed) ? undefined : parsed,
      }));
      setSubmitError(undefined);
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    if (!validation.isValid || submitting) return;

    setSubmitting(true);
    setSubmitError(undefined);

    const result = await onSubmit(formData);

    setSubmitting(false);
    if (result.error) {
      setSubmitError(result.error);
    } else {
      setOpen(false);
      setFormData(initialFormData());
    }
  }, [validation.isValid, submitting, formData, onSubmit]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen && !submitting) {
        setFormData(initialFormData());
        setSubmitError(undefined);
      }
    },
    [submitting],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger
          render={trigger ? <>{trigger}</> : <Button size="sm">Grant Access</Button>}
        />
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Grant Access to {toolName}</DialogTitle>
          <DialogDescription>
            Select an identity to grant access to this tool.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Identity selector */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="identity_id">Identity</Label>
            <Select
              value={formData.identity_id || undefined}
              onValueChange={handleIdentityChange}
              disabled={vm.isLoadingIdentities}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={vm.placeholderText} />
              </SelectTrigger>
              <SelectContent>
                {vm.identityOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {validation.errors.identity_id && (
              <p className="text-xs text-destructive">{validation.errors.identity_id}</p>
            )}
          </div>

          {/* Optional rate limit */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="max_calls_per_hour">Max Calls Per Hour (optional)</Label>
            <Input
              id="max_calls_per_hour"
              type="number"
              placeholder="Leave empty for unlimited"
              value={formData.max_calls_per_hour ?? ""}
              onChange={handleRateLimitChange}
            />
          </div>

          {submitError && (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            size="sm"
            disabled={!validation.isValid || submitting}
            onClick={handleSubmit}
          >
            {submitting ? "Granting..." : "Grant Access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
