import type { SuggestionCategory } from "../../../shared/contracts";
import { entityColor, entityMutedColor } from "../graph/graph-theme";

type SuggestionToolOutput = {
  text: string;
  category: string;
  rationale: string;
  confidence: number;
  target?: string;
};

export function SuggestionToolCard({ output }: { output: SuggestionToolOutput }) {
  return (
    <div
      className="suggestion-tool-card"
      style={{
        borderColor: entityColor("suggestion"),
        background: entityMutedColor("suggestion"),
      }}
    >
      <div className="suggestion-tool-card-header">
        <span className="suggestion-tool-card-category">
          {output.category as SuggestionCategory}
        </span>
        <span className="suggestion-tool-card-confidence">
          {Math.round(output.confidence * 100)}%
        </span>
      </div>
      <div className="suggestion-tool-card-text">{output.text}</div>
      <div className="suggestion-tool-card-rationale">{output.rationale}</div>
      {output.target ? (
        <div className="suggestion-tool-card-target">Target: {output.target}</div>
      ) : undefined}
    </div>
  );
}
