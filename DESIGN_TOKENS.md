# Design Tokens & Visual Language

**Platform:** AI-Native Business Management Platform
**Aesthetic:** Scandinavian clarity meets developer tooling. Inspired by Tana's restraint — typography-led, content-first, with color reserved for meaning.
**Principle:** The UI disappears. Entities, relationships, and actions are the visual language, not chrome.

---

## 1. Color System

### 1.1 Base Theme — Dark Mode Default

Built on shadcn/ui's Zinc base with OKLCH color space (Tailwind v4). Dark mode is the default — developers and founders live here.

```css
:root {
  /* Light mode — available but not default */
  --background: oklch(0.985 0 0);           /* zinc-50 */
  --foreground: oklch(0.145 0 0);           /* zinc-950 */
  --card: oklch(1.0 0 0);                   /* white */
  --card-foreground: oklch(0.145 0 0);      /* zinc-950 */
  --muted: oklch(0.94 0 0);                 /* zinc-100 */
  --muted-foreground: oklch(0.55 0 0);      /* zinc-500 */
  --border: oklch(0.87 0 0);               /* zinc-200 */
  --input: oklch(0.87 0 0);                /* zinc-200 */
  --ring: oklch(0.145 0 0);                /* zinc-950 */
}

.dark {
  /* Dark mode — default */
  --background: oklch(0.12 0.005 285);      /* near-black with subtle cool tint */
  --foreground: oklch(0.94 0 0);            /* zinc-100 */
  --card: oklch(0.16 0.005 285);            /* raised surface */
  --card-foreground: oklch(0.94 0 0);       /* zinc-100 */
  --muted: oklch(0.21 0.005 285);           /* subtle background */
  --muted-foreground: oklch(0.55 0 0);      /* zinc-500 */
  --border: oklch(0.26 0.005 285);          /* subtle dividers */
  --input: oklch(0.26 0.005 285);           /* input borders */
  --ring: oklch(0.55 0.15 250);             /* focus ring — brand blue */
}
```

### 1.2 Entity Type Colors

The visual vocabulary of the product. Each entity type has a single accent color used consistently across chat (EntityCard borders), graph (node fills), feed (card accents), and suggestions. Muted in dark mode, slightly saturated in light mode.

```css
:root, .dark {
  /* Entity accent palette — 6 colors, OKLCH for perceptual uniformity */
  --entity-project:   oklch(0.65 0.15 250);  /* blue — primary containers */
  --entity-feature:   oklch(0.65 0.15 170);  /* teal — capabilities */
  --entity-task:      oklch(0.70 0.15 145);  /* green — actionable items */
  --entity-decision:  oklch(0.70 0.15 55);   /* amber — ratified choices */
  --entity-question:  oklch(0.65 0.15 300);  /* purple — open items */
  --entity-person:    oklch(0.65 0.15 25);   /* warm coral — people */

  /* Foregrounds — high contrast text on entity accent backgrounds */
  --entity-project-fg:   oklch(0.95 0.02 250);
  --entity-feature-fg:   oklch(0.95 0.02 170);
  --entity-task-fg:      oklch(0.95 0.02 145);
  --entity-decision-fg:  oklch(0.95 0.02 55);
  --entity-question-fg:  oklch(0.95 0.02 300);
  --entity-person-fg:    oklch(0.95 0.02 25);

  /* Muted variants — for backgrounds, badges, subtle indicators */
  --entity-project-muted:   oklch(0.25 0.05 250);
  --entity-feature-muted:   oklch(0.25 0.05 170);
  --entity-task-muted:      oklch(0.25 0.05 145);
  --entity-decision-muted:  oklch(0.25 0.05 55);
  --entity-question-muted:  oklch(0.25 0.05 300);
  --entity-person-muted:    oklch(0.25 0.05 25);
}
```

**Usage rules:**
- Entity colors are the *only* non-neutral colors in the product
- Never use raw Tailwind color classes (no `bg-blue-500`) — always use entity tokens
- EntityCard: muted background + accent left border (3px)
- Graph nodes: accent fill at 80% opacity
- Suggestions: muted background, accent text
