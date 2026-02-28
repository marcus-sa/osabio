import type { EntityCategory } from "../../../shared/contracts";

const CATEGORY_CONFIG: Record<EntityCategory, { icon: string; label: string }> = {
  engineering: { icon: "\u2699\uFE0F", label: "Engineering" },
  research: { icon: "\uD83D\uDD0D", label: "Research" },
  marketing: { icon: "\uD83D\uDCE2", label: "Marketing" },
  operations: { icon: "\uD83D\uDD27", label: "Operations" },
  design: { icon: "\uD83C\uDFA8", label: "Design" },
  sales: { icon: "\uD83E\uDD1D", label: "Sales" },
};

export function CategoryBadge({ category }: { category: EntityCategory }) {
  const config = CATEGORY_CONFIG[category];
  return (
    <span className="category-badge">
      {config.icon} {config.label}
    </span>
  );
}
