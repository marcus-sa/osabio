import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useCreateSkill, type SkillSourceType } from "../hooks/use-skills";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";

type FormErrors = {
  name?: string;
  description?: string;
  version?: string;
  source?: string;
};

const SOURCE_TYPE_OPTIONS: { value: SkillSourceType; title: string; description: string }[] = [
  {
    value: "github",
    title: "GitHub Repository",
    description: "Reference a skill definition hosted on GitHub.",
  },
  {
    value: "git",
    title: "Git URL",
    description: "Reference a skill definition from any Git URL.",
  },
];

function validateForm(
  name: string,
  description: string,
  version: string,
  source: string,
): FormErrors {
  const errors: FormErrors = {};
  if (!name.trim()) errors.name = "Name is required.";
  if (!description.trim()) errors.description = "Description is required.";
  if (!version.trim()) errors.version = "Version is required.";
  if (!source.trim()) errors.source = "Repository or URL is required.";
  return errors;
}

function hasErrors(errors: FormErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function SkillCreatePage() {
  const navigate = useNavigate();
  const { createSkill, isSubmitting, error, clearError } = useCreateSkill();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [sourceType, setSourceType] = useState<SkillSourceType>("github");
  const [source, setSource] = useState("");
  const [ref, setRef] = useState("");
  const [subpath, setSubpath] = useState("");
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);

  function handleValidation() {
    const errors = validateForm(name, description, version, source);
    setFormErrors(errors);
    return !hasErrors(errors);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    clearError();

    if (!handleValidation()) return;

    const result = await createSkill({
      name: name.trim(),
      description: description.trim(),
      version: version.trim(),
      source: {
        type: sourceType,
        source: source.trim(),
        ref: ref.trim() || undefined,
        subpath: subpath.trim() || undefined,
      },
    });

    if (result) {
      void navigate({ to: "/skills" });
    }
  }

  const sourceFieldLabel = sourceType === "github" ? "Repository" : "URL";
  const sourcePlaceholder = sourceType === "github"
    ? "e.g. owner/repo"
    : "e.g. https://git.example.com/repo.git";

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Create Skill</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="skill-name">Name</Label>
          <Input
            id="skill-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (submitted) handleValidation();
            }}
            placeholder="e.g. Code Review"
          />
          {formErrors.name ? (
            <p className="text-xs text-destructive">{formErrors.name}</p>
          ) : undefined}
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="skill-description">Description</Label>
          <Textarea
            id="skill-description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              if (submitted) handleValidation();
            }}
            placeholder="What does this skill enable agents to do?"
            rows={3}
          />
          {formErrors.description ? (
            <p className="text-xs text-destructive">{formErrors.description}</p>
          ) : undefined}
        </div>

        {/* Version */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="skill-version">Version</Label>
          <Input
            id="skill-version"
            value={version}
            onChange={(e) => {
              setVersion(e.target.value);
              if (submitted) handleValidation();
            }}
            placeholder="e.g. 1.0.0"
          />
          {formErrors.version ? (
            <p className="text-xs text-destructive">{formErrors.version}</p>
          ) : undefined}
        </div>

        {/* Source type radio */}
        <div className="flex flex-col gap-1.5">
          <Label>Source Type</Label>
          <div className="flex gap-3">
            {SOURCE_TYPE_OPTIONS.map(({ value, title, description: desc }) => (
              <button
                key={value}
                type="button"
                className={`flex flex-1 flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${
                  sourceType === value
                    ? "border-primary bg-muted"
                    : "border-border hover:border-primary hover:bg-muted"
                }`}
                onClick={() => setSourceType(value)}
              >
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs text-muted-foreground">{desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Source (repository or URL) */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="skill-source">{sourceFieldLabel}</Label>
          <Input
            id="skill-source"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              if (submitted) handleValidation();
            }}
            placeholder={sourcePlaceholder}
          />
          {formErrors.source ? (
            <p className="text-xs text-destructive">{formErrors.source}</p>
          ) : undefined}
        </div>

        {/* Ref */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="skill-ref">Ref (optional)</Label>
          <Input
            id="skill-ref"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="e.g. main, v1.0.0, abc1234"
          />
        </div>

        {/* Subpath */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="skill-subpath">Subpath (optional)</Label>
          <Input
            id="skill-subpath"
            value={subpath}
            onChange={(e) => setSubpath(e.target.value)}
            placeholder="e.g. skills/code-review"
          />
        </div>

        {/* Server error */}
        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : undefined}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => void navigate({ to: "/skills" })}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating..." : "Create Skill"}
          </Button>
        </div>
      </form>
    </section>
  );
}
