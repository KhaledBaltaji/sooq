# Icon System

Sooq uses **`lucide-react`** as the single icon system for all UI icons. This file is the authoritative reference — keep new icons aligned with these rules.

## Rules

1. **Use `lucide-react` for every UI icon.**
   ```tsx
   import { Search, X, ChevronRight } from "lucide-react";
   ```
   Don't pull in `react-icons`, `@heroicons/react`, `@radix-ui/react-icons`, or any other icon library. They are not installed and shouldn't be added.

2. **Don't write inline `<svg>` for UI icons.** If lucide doesn't have what you need, add it to `src/components/icons/` as a shared component (see Brand icons below). Inline SVGs are reserved for **data visualization** (charts, gauges, sparklines, avatars) — never for UI affordances.

3. **Stroke width: lucide default (`2`).** Override only when the visual context demands it (e.g. `strokeWidth={2.5}` for a small ≤ 14 px icon that would otherwise look thin, or `strokeWidth={1.5}` for a soft-touch hero illustration). Stay consistent within a screen.

4. **Size scale** (Tailwind classes):
   | Size | Class | Use |
   |---|---|---|
   | 12 px | `w-3 h-3` | tiny inline cues, status dots |
   | 14 px | `w-3.5 h-3.5` | compact rails, micro-buttons |
   | 16 px | `w-4 h-4` | **default** for buttons, list items |
   | 20 px | `w-5 h-5` | medium emphasis, sheet headers |
   | 24 px | `w-6 h-6` | large emphasis, empty states |
   Don't pick non-scale sizes (`w-[18px]` etc.) without a strong reason.

5. **Colour via Tailwind tokens**, not hard-coded hex:
   - `text-muted-custom` — secondary
   - `text-text` — primary
   - `text-yes` / `text-no` — brand
   - `text-success` / `text-warning` / `text-no` — status
   Brand-locked colours (e.g. WhatsApp green) are the exception — see below.

## Brand icons

Brand marks (WhatsApp, Telegram, X, etc.) aren't in lucide. Put them in `src/components/icons/` as small wrapper components that accept a `className` and forward it to a single `<svg>`. Lock the brand colour with the consumer's class, not hard-coded fill in the SVG. Example: [`src/components/icons/whatsapp.tsx`](../src/components/icons/whatsapp.tsx).

## Data viz (NOT icons)

Files like [`sparkline.tsx`](../src/components/ui/sparkline.tsx), [`generated-avatar.tsx`](../src/components/ui/generated-avatar.tsx), [`css-probability-gauge.tsx`](../src/components/market/css-probability-gauge.tsx), and the inline gauge in [`live-markets.tsx`](../src/components/home/live-markets.tsx) render data, not affordances. They're allowed to use inline `<svg>` because their geometry is computed from props at render time. Don't migrate them.

## When you add a new icon

1. Search lucide first: <https://lucide.dev/icons>.
2. If found → import and use with the size/stroke conventions above.
3. If not found and it's a **brand mark** → drop a wrapper in `src/components/icons/`.
4. If not found and it's a **generic UI icon** → re-check lucide; the catalogue is wide. As a last resort, propose the addition in code review with the reasoning.
