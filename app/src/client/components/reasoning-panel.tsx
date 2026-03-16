import { ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./ui/collapsible";

type ReasoningSource =
  | { type: "available"; reasoning: string; model?: string }
  | { type: "intent"; reasoning: string; evaluationReasoning?: string }
  | { type: "deterministic" }
  | { type: "legacy" };

function deriveObservationSource(data: Record<string, unknown>): ReasoningSource | undefined {
  const reasoning = data.reasoning as string | undefined;
  const sourceAgent = data.source_agent as string | undefined;

  if (reasoning) {
    return { type: "available", reasoning };
  }

  if (sourceAgent === "observer_agent" || sourceAgent === "policy_engine") {
    return { type: "deterministic" };
  }

  return { type: "legacy" };
}

function deriveIntentSource(data: Record<string, unknown>): ReasoningSource | undefined {
  const reasoning = data.reasoning as string | undefined;
  const evaluation = data.evaluation as Record<string, unknown> | undefined;
  const evaluationReasoning = evaluation?.reasoning as string | undefined;

  if (reasoning) {
    return { type: "intent", reasoning, evaluationReasoning };
  }

  return { type: "legacy" };
}

export function deriveReasoningSource(
  kind: string,
  data: Record<string, unknown>,
): ReasoningSource | undefined {
  if (kind === "observation") return deriveObservationSource(data);
  if (kind === "intent") return deriveIntentSource(data);
  return undefined;
}

export function ReasoningPanel({ source }: { source: ReasoningSource }) {
  return (
    <Collapsible defaultOpen={false} className="px-4">
      <CollapsibleTrigger
        render={
          <Button variant="ghost" size="xs" className="group w-full justify-start gap-1.5 text-xs text-muted-foreground">
            <ChevronRight className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
            View Logic
          </Button>
        }
      />
      <CollapsibleContent>
        <div className="mt-1.5 rounded-md border border-border bg-muted/50 p-2.5">
          <ReasoningBody source={source} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ReasoningBody({ source }: { source: ReasoningSource }) {
  switch (source.type) {
    case "available":
      return (
        <div className="flex flex-col gap-1.5">
          {source.model ? (
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
              {source.model}
            </span>
          ) : undefined}
          <pre className="whitespace-pre-wrap font-mono text-xs text-foreground">
            {source.reasoning}
          </pre>
        </div>
      );
    case "intent":
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
              Intent Reasoning
            </span>
            <pre className="whitespace-pre-wrap font-mono text-xs text-foreground">
              {source.reasoning}
            </pre>
          </div>
          {source.evaluationReasoning ? (
            <div className="flex flex-col gap-1">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
                Evaluation Reasoning
              </span>
              <pre className="whitespace-pre-wrap font-mono text-xs text-foreground">
                {source.evaluationReasoning}
              </pre>
            </div>
          ) : undefined}
        </div>
      );
    case "deterministic":
      return (
        <p className="text-xs text-muted-foreground italic">
          This decision was made by deterministic policy evaluation without LLM reasoning.
        </p>
      );
    case "legacy":
      return (
        <p className="text-xs text-muted-foreground italic">
          Reasoning trace not available for this record.
        </p>
      );
  }
}
