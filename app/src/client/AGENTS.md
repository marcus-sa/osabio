## UI Stack

- **shadcn/ui** for component primitives (built on **Base UI** / `@base-ui/react`, not Radix UI)

## Base UI Select: `items` Prop Required for Trigger Label

The shadcn `Select` component wraps `@base-ui/react/select`, **not** Radix UI. Unlike Radix, Base UI does not automatically propagate `SelectItem` children text to the `SelectValue` trigger display.

Without an explicit `items` prop on `<Select>`, the trigger renders the raw `value` string (e.g. a UUID) instead of the human-readable label.

**Always pass `items`** when the value differs from the display label:

```tsx
<Select
  value={selectedId}
  onValueChange={setSelectedId}
  items={Object.fromEntries(
    options.map((o) => [o.id, o.label]),
  )}
>
  <SelectTrigger>
    <SelectValue placeholder="Choose..." />
  </SelectTrigger>
  <SelectContent>
    {options.map((o) => (
      <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

The `items` prop accepts `Record<string, ReactNode>` mapping values to display labels. `SelectValue` uses this map to resolve what to show in the trigger after selection.
