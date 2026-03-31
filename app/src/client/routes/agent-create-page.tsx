import { useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAgentActions, type AuthorityScopeInput, type CreateAgentResult } from "../hooks/use-agent-actions";
import { useSkills } from "../hooks/use-skills";
import { WizardStepConfig, type ConfigStepState } from "../components/agent/wizard-step-config";
import { WizardStepSkills } from "../components/agent/wizard-step-skills";
import { WizardStepTools } from "../components/agent/wizard-step-tools";
import { ProxyTokenDialog } from "../components/agent/proxy-token-dialog";
import { AUTHORITY_ACTIONS } from "../components/agent/authority-scope-form";

type WizardStep = 1 | 2 | 3;

const STEP_LABELS: Record<WizardStep, string> = {
  1: "Configuration",
  2: "Skills",
  3: "Tools",
};

function buildDefaultScopes(): AuthorityScopeInput[] {
  return AUTHORITY_ACTIONS.map(({ action }) => ({ action, permission: "propose" as const }));
}

function buildInitialConfigState(): ConfigStepState {
  return {
    runtime: "sandbox",
    name: "",
    description: "",
    model: "",
    scopes: buildDefaultScopes(),
    sandboxConfig: { image: "", snapshot: "" },
  };
}

function StepIndicator({ currentStep }: { currentStep: WizardStep }) {
  const steps: WizardStep[] = [1, 2, 3];

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {steps.map((step) => (
        <div key={step} className="flex items-center gap-2">
          {step > 1 ? <span className="text-border">--</span> : undefined}
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium ${
              step === currentStep
                ? "bg-primary text-primary-foreground"
                : step < currentStep
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {step}
          </span>
          <span className={step === currentStep ? "font-medium text-foreground" : ""}>
            {STEP_LABELS[step]}
          </span>
        </div>
      ))}
    </div>
  );
}

export function AgentCreatePage() {
  const navigate = useNavigate();
  const { createAgent, checkName, isSubmitting, error, clearError } = useAgentActions();

  // Wizard navigation state
  const [step, setStep] = useState<WizardStep>(1);

  // Step 1: Config state
  const [configState, setConfigState] = useState<ConfigStepState>(buildInitialConfigState);
  const [nameError, setNameError] = useState<string | undefined>();

  // Step 2: Skills state
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);

  // Step 3: Additional tools state
  const [additionalToolIds, setAdditionalToolIds] = useState<string[]>([]);

  // Post-creation state
  const [createdResult, setCreatedResult] = useState<CreateAgentResult | undefined>();

  // Fetch active skills (needed by both step 2 and step 3 for tool derivation)
  const { skills } = useSkills("active");

  // Name validation
  const handleNameBlur = useCallback(async () => {
    if (!configState.name.trim()) {
      setNameError(undefined);
      return;
    }
    const available = await checkName(configState.name.trim());
    setNameError(available ? undefined : "This name is already taken.");
  }, [configState.name, checkName]);

  // Step 1 validation: name required, no name error
  const isStep1NextDisabled = !configState.name.trim() || !!nameError;

  // Navigation handlers
  const handleStep1Next = useCallback(() => {
    clearError();
    setStep(2);
  }, [clearError]);

  const handleStep2Next = useCallback(() => {
    clearError();
    setStep(3);
  }, [clearError]);

  const handleStep2Back = useCallback(() => setStep(1), []);
  const handleStep3Back = useCallback(() => setStep(2), []);
  const handleCancel = useCallback(() => void navigate({ to: "/agents" }), [navigate]);

  // Submit handler (Step 3)
  const handleSubmit = useCallback(async () => {
    clearError();

    const sandboxConfig = configState.runtime === "sandbox"
      ? {
          ...(configState.sandboxConfig.image.trim() ? { image: configState.sandboxConfig.image.trim() } : {}),
          ...(configState.sandboxConfig.snapshot.trim() ? { snapshot: configState.sandboxConfig.snapshot.trim() } : {}),
        }
      : undefined;

    const hasSandboxConfig = sandboxConfig && Object.keys(sandboxConfig).length > 0;

    const result = await createAgent({
      name: configState.name.trim(),
      description: configState.description.trim() || undefined,
      runtime: configState.runtime,
      model: configState.model.trim() || undefined,
      authority_scopes: configState.scopes,
      ...(selectedSkillIds.length > 0 ? { skill_ids: selectedSkillIds } : {}),
      ...(additionalToolIds.length > 0 ? { additional_tool_ids: additionalToolIds } : {}),
      ...(hasSandboxConfig ? { sandbox_config: sandboxConfig } : {}),
    });

    if (result) {
      if (result.proxy_token) {
        setCreatedResult(result);
      } else {
        void navigate({ to: "/agents" });
      }
    }
  }, [configState, selectedSkillIds, additionalToolIds, createAgent, clearError, navigate]);

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">Create Agent</h1>
        <StepIndicator currentStep={step} />
      </div>

      {step === 1 ? (
        <WizardStepConfig
          state={configState}
          onChange={setConfigState}
          nameError={nameError}
          onNameBlur={() => void handleNameBlur()}
          onNext={handleStep1Next}
          onCancel={handleCancel}
          isNextDisabled={isStep1NextDisabled}
        />
      ) : step === 2 ? (
        <WizardStepSkills
          selectedSkillIds={selectedSkillIds}
          onChangeSkillIds={setSelectedSkillIds}
          onNext={handleStep2Next}
          onBack={handleStep2Back}
          isExternalRuntime={configState.runtime === "external"}
        />
      ) : (
        <WizardStepTools
          selectedSkillIds={selectedSkillIds}
          skills={skills}
          additionalToolIds={additionalToolIds}
          onChangeAdditionalToolIds={setAdditionalToolIds}
          onBack={handleStep3Back}
          onSubmit={() => void handleSubmit()}
          isSubmitting={isSubmitting}
          error={error}
        />
      )}

      {createdResult?.proxy_token ? (
        <ProxyTokenDialog
          open={true}
          token={createdResult.proxy_token}
          agentName={createdResult.agent.name}
          onClose={() => {
            setCreatedResult(undefined);
            void navigate({ to: "/agents" });
          }}
        />
      ) : undefined}
    </section>
  );
}
