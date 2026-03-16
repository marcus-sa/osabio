import type { AnchorHTMLAttributes, ReactNode } from "react";
import { useViewState } from "../../stores/view-state";
import { Badge } from "../ui/badge";

const ENTITY_PREFIX = "#entity/";

const kindLabels: Record<string, string> = {
  project: "Project",
  feature: "Feature",
  task: "Task",
  decision: "Decision",
  question: "Question",
  person: "Person",
  observation: "Observation",
};

/**
 * Renders #entity/ links as styled inline entity references.
 * Falls through to a regular <a> for all other links.
 */
export function EntityLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) {
  const { href, children, ...rest } = props;
  const navigateToGraph = useViewState((s) => s.navigateToGraph);

  if (!href?.startsWith(ENTITY_PREFIX)) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }

  const entityId = href.slice(ENTITY_PREFIX.length);
  const kind = entityId.split(":")[0];
  const label = kindLabels[kind];

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    navigateToGraph(entityId);
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      className="inline-flex items-center gap-1 border-b border-dotted border-ring text-ring no-underline transition-colors hover:border-solid hover:text-accent-hover"
      title={label ? `${label} — view in graph` : "View in graph"}
      {...rest}
    >
      {label ? <Badge variant="secondary" className="h-3.5 px-1 text-[0.6rem]">{label}</Badge> : undefined}
      {children}
    </a>
  );
}

/**
 * Markdown component override that renders #entity/ links as EntityLink.
 */
export const entityLinkMarkdownComponents = {
  a: EntityLink,
};
