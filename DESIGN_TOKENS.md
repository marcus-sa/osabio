# Design Tokens & Visual Language

**Platform:** AI-Native Business Management Platform
**Aesthetic:** Modern SaaS with visual continuity to the landing page. Instrument Sans typography, lime-green accent, rounded cards with hover lift — polished but content-first.
**Principle:** The UI serves the content. Entities, relationships, and actions are the visual language. Color is reserved for meaning and primary actions.

---

## 1. Color System

### 1.1 Base Theme — Dark Mode Default

Dark mode is the default. Colors are hex values matching the landing page palette for visual continuity.

```css
:root {
  /* Dark mode — default */
  --background: #0a0a0c;        /* deep black */
  --foreground: #e8e6e3;        /* warm off-white */
  --card: #111114;              /* raised surface */
  --card-foreground: #e8e6e3;   /* warm off-white */
  --muted: #18181c;             /* subtle background */
  --muted-foreground: #9a9a9a;  /* medium gray */
  --border: #1e1e26;            /* subtle dividers */
  --input: #1e1e26;             /* input borders */
  --ring: #c4f042;              /* focus ring — accent green */
  --destructive: #d66a8a;       /* error/danger — rose */
  --hover: #2a2a32;             /* hover surface */
  --active: #32323c;            /* active/pressed surface */

  /* Accent / brand */
  --accent: #c4f042;            /* lime green — primary CTA */
  --accent-glow: rgba(196, 240, 66, 0.08);
  --accent-hover: #d4ff52;      /* lighter lime for hover */

  /* Typography */
  --font-mono: "JetBrains Mono", monospace;

  /* Radius */
  --radius: 12px;               /* cards, panels, overlays */
  --radius-sm: 8px;             /* buttons, inputs, pills */
  --radius-xs: 6px;             /* badges, small inline elements */
}

.light {
  --background: #fafaf9;
  --foreground: #1a1a1c;
  --card: #ffffff;
  --card-foreground: #1a1a1c;
  --muted: #f0f0ed;
  --muted-foreground: #6a6a6a;
  --border: #e2e2dd;
  --input: #e2e2dd;
  --ring: #a0c830;
  --hover: #eaeae5;
  --active: #e0e0da;
}
```

### 1.2 Entity Type Colors

The visual vocabulary of the product. Each entity type has a single accent color mapped to the landing page palette, used consistently across chat (EntityCard borders), graph (node fills), feed (card accents), and suggestions.

```css
:root {
  /* Entity accent palette — mapped to landing page colors */
  --entity-project:   #5b8dee;  /* blue — primary containers */
  --entity-feature:   #6ee7b7;  /* teal — capabilities */
  --entity-task:      #c4f042;  /* lime — actionable items */
  --entity-decision:  #e8944a;  /* orange — ratified choices */
  --entity-question:  #a78bfa;  /* purple — open items */
  --entity-person:    #d66a8a;  /* rose — people */

  /* Foregrounds — light tints for text on accent backgrounds */
  --entity-project-fg:   #c4d8f8;
  --entity-feature-fg:   #c4f5e4;
  --entity-task-fg:      #e8f8b0;
  --entity-decision-fg:  #f5d4a8;
  --entity-question-fg:  #d8c8f8;
  --entity-person-fg:    #f0c0d0;

  /* Muted variants — dark subtle backgrounds */
  --entity-project-muted:   #161c2a;
  --entity-feature-muted:   #142420;
  --entity-task-muted:      #1c2010;
  --entity-decision-muted:  #241c12;
  --entity-question-muted:  #1c162a;
  --entity-person-muted:    #2a1620;
}
```

**Usage rules:**
- Entity colors and the accent are the *only* non-neutral colors in the product
- Never use raw color values in components — always use entity/accent tokens
- EntityCard: muted background + accent left border (3px)
- Graph nodes: accent fill at 80% opacity
- Suggestions: muted background, accent text
- Primary action buttons: `--accent` background with dark text (`#0a0a0c`)

### 1.3 Governance Tiers

```css
:root {
  --tier-blocking: #d66a8a;       /* rose */
  --tier-blocking-muted: #2a1a20;
  --tier-review: #e8944a;         /* orange */
  --tier-review-muted: #2a221a;
  --tier-awareness: #6ee7b7;      /* teal */
  --tier-awareness-muted: #1a2a22;
}
```

---

## 2. Typography

- **Primary font:** Instrument Sans (400, 500, 600, 700) — loaded from Google Fonts
- **Monospace:** JetBrains Mono (400, 500) — loaded from Google Fonts
- **Font smoothing:** `-webkit-font-smoothing: antialiased`

---

## 3. Border Radius

Three tiers applied consistently:

| Token | Value | Usage |
|-------|-------|-------|
| `--radius` | 12px | Cards, panels, overlays, modals |
| `--radius-sm` | 8px | Buttons, inputs, selects, pills, chips |
| `--radius-xs` | 6px | Badges, small inline elements, sidebar items |

---

## 4. Interactive Effects

- **Hover lift:** Cards (entity-card, feed-item, search-result-card) lift 1px on hover with border color transition
- **Accent glow:** Primary buttons emit subtle green glow on hover via `box-shadow: 0 0 20px var(--accent-glow)`
- **Transitions:** All interactive elements use `0.2s` transitions for border-color, transform, and background
