import { useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  deriveConnectFormFields,
  deriveOAuth2ConnectViewModel,
  validateConnectForm,
  type ConnectFormData,
  type ConnectFormFieldName,
  type ProviderInfo,
} from "./AccountTable";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type ConnectAccountDialogProps = {
  provider: ProviderInfo;
  scopes?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (providerId: string, formData: ConnectFormData) => Promise<{ error?: string }>;
  onOAuth2Continue?: (providerId: string) => void;
};

// ---------------------------------------------------------------------------
// Initial form state
// ---------------------------------------------------------------------------

function initialFormData(authMethod: string): ConnectFormData {
  return {
    authMethod,
    apiKey: "",
    bearerToken: "",
    username: "",
    password: "",
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConnectAccountDialog({
  provider,
  scopes,
  open,
  onOpenChange,
  onSubmit,
  onOAuth2Continue,
}: ConnectAccountDialogProps) {
  const [formData, setFormData] = useState<ConnectFormData>(() =>
    initialFormData(provider.authMethod),
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();

  const isOAuth2 = provider.authMethod === "oauth2";
  const fields = deriveConnectFormFields(provider.authMethod);
  const validation = validateConnectForm(formData);

  const handleFieldChange = useCallback(
    (field: ConnectFormFieldName, value: string) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      setSubmitError(undefined);
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    if (!validation.isValid || submitting) return;

    setSubmitting(true);
    setSubmitError(undefined);

    const result = await onSubmit(provider.id, formData);

    setSubmitting(false);
    if (result.error) {
      setSubmitError(result.error);
    } else {
      onOpenChange(false);
      setFormData(initialFormData(provider.authMethod));
    }
  }, [validation.isValid, submitting, formData, onSubmit, provider.id, provider.authMethod, onOpenChange]);

  const handleOAuth2Continue = useCallback(() => {
    onOAuth2Continue?.(provider.id);
  }, [onOAuth2Continue, provider.id]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen);
      if (!nextOpen && !submitting) {
        setFormData(initialFormData(provider.authMethod));
        setSubmitError(undefined);
      }
    },
    [onOpenChange, submitting, provider.authMethod],
  );

  if (isOAuth2) {
    const oauth2Vm = deriveOAuth2ConnectViewModel(
      provider.displayName,
      scopes ?? "",
    );

    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect to {oauth2Vm.providerName}</DialogTitle>
            <DialogDescription>{oauth2Vm.securityExplanation}</DialogDescription>
          </DialogHeader>

          {oauth2Vm.scopes.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>Requested scopes</Label>
              <div className="flex flex-wrap gap-1">
                {oauth2Vm.scopes.map((scope) => (
                  <Badge key={scope} variant="secondary">
                    {scope}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleOAuth2Continue}>
              {oauth2Vm.continueButtonText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect to {provider.displayName}</DialogTitle>
          <DialogDescription>
            Enter your credentials to connect this account.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {fields.map((field) => (
            <div key={field.name} className="flex flex-col gap-1.5">
              <Label htmlFor={field.name}>{field.label}</Label>
              <Input
                id={field.name}
                type={field.inputType}
                placeholder={field.placeholder}
                value={formData[field.name]}
                onChange={(e) => handleFieldChange(field.name, e.target.value)}
                aria-invalid={validation.errors[field.name] ? true : undefined}
              />
              {validation.errors[field.name] && (
                <p className="text-xs text-destructive">{validation.errors[field.name]}</p>
              )}
            </div>
          ))}

          {submitError && (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!validation.isValid || submitting}
            onClick={handleSubmit}
          >
            {submitting ? "Connecting..." : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
