import type { SuggestionCategory } from "../../../shared/contracts";
import { Badge } from "../ui/badge";

type SuggestionToolOutput = {
  text: string;
  category: string;
  rationale: string;
  confidence: number;
  target?: string;
};

export function SuggestionToolCard({ output }: { output: SuggestionToolOutput }) {
  return (
    <div className="rounded-lg border border-entity-question bg-entity-question-muted p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <Badge variant="secondary" className="text-[0.65rem]">
          {output.category as SuggestionCategory}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {Math.round(output.confidence * 100)}%
        </span>
      </div>
      <div className="text-sm text-foreground">{output.text}</div>
      <div className="mt-1 text-xs italic text-muted-foreground">{output.rationale}</div>
      {output.target ? (
        <div className="mt-1 text-xs text-muted-foreground">Target: {output.target}</div>
      ) : undefined}
    </div>
  );
}
