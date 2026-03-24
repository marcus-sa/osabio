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
  deriveCreateProviderFormFields,
  validateCreateProviderForm,
  type AuthMethod,
  type CreateProviderFormData,
  type CreateProviderFieldName,
} from "./ProviderTable";

// ---------------------------------------------------------------------------
// Field metadata for rendering
// ---------------------------------------------------------------------------

type FieldMeta = {
  label: string;
  placeholder: string;
  type: string;
};

const FIELD_METADATA: Record<CreateProviderFieldName, FieldMeta> = {
  name: { label: "Name", placeholder: "e.g. github", type: "text" },
  display_name: { label: "Display Name", placeholder: "e.g. GitHub", type: "text" },
  auth_method: { label: "Auth Method", placeholder: "", type: "select" },
  authorization_url: {
    label: "Authorization URL",
    placeholder: "https://provider.com/oauth/authorize",
    type: "url",
  },
  token_url: {
    label: "Token URL",
    placeholder: "https://provider.com/oauth/token",
    type: "url",
  },
  client_id: { label: "Client ID", placeholder: "Your client ID", type: "text" },
  client_secret: {
    label: "Client Secret",
    placeholder: "Your client secret",
    type: "password",
  },
  scopes: { label: "Scopes", placeholder: "e.g. repo,user", type: "text" },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type CreateProviderDialogProps = {
  onSubmit: (formData: CreateProviderFormData) => Promise<{ error?: string }>;
  trigger?: React.ReactNode;
};

// ---------------------------------------------------------------------------
// Initial form state
// ---------------------------------------------------------------------------

function initialFormData(): CreateProviderFormData {
  return {
    name: "",
    display_name: "",
    auth_method: "oauth2",
    authorization_url: "",
    token_url: "",
    client_id: "",
    client_secret: "",
    scopes: "",
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateProviderDialog({ onSubmit, trigger }: CreateProviderDialogProps) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<CreateProviderFormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();

  const validation = validateCreateProviderForm(formData);
  const visibleFields = deriveCreateProviderFormFields(formData.auth_method);

  const handleFieldChange = useCallback(
    (field: CreateProviderFieldName, value: string) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      setSubmitError(undefined);
    },
    [],
  );

  const handleAuthMethodChange = useCallback((value: string | null) => {
    if (!value) return;
    setFormData((prev) => ({ ...prev, auth_method: value as AuthMethod }));
    setSubmitError(undefined);
  }, []);

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
      <DialogTrigger render={trigger ? <>{trigger}</> : <Button size="sm">Add Provider</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Provider</DialogTitle>
          <DialogDescription>
            Configure a credential provider to connect external services.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Auth method selector -- always visible */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auth_method">{FIELD_METADATA.auth_method.label}</Label>
            <Select value={formData.auth_method} onValueChange={handleAuthMethodChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="oauth2">OAuth2</SelectItem>
                <SelectItem value="api_key">API Key</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Dynamic fields based on auth method */}
          {visibleFields
            .filter((field) => field !== "auth_method")
            .map((field) => {
              const meta = FIELD_METADATA[field];
              return (
                <div key={field} className="flex flex-col gap-1.5">
                  <Label htmlFor={field}>{meta.label}</Label>
                  <Input
                    id={field}
                    type={meta.type}
                    placeholder={meta.placeholder}
                    value={formData[field]}
                    onChange={(e) => handleFieldChange(field, e.target.value)}
                    aria-invalid={validation.errors[field] ? true : undefined}
                  />
                  {validation.errors[field] && (
                    <p className="text-xs text-destructive">{validation.errors[field]}</p>
                  )}
                </div>
              );
            })}

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
            {submitting ? "Creating..." : "Create Provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
