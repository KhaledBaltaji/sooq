# Design System — MENA Prediction Market

## Product Context
- **What this is:** Real-money political prediction exchange for the MENA region
- **Who it's for:** Politically opinionated men (18-39) in Lebanon and MENA
- **Space/industry:** Fintech / prediction markets / political betting
- **Project type:** Mobile-first web app (PWA)
- **Positioning:** Prediction exchange (not gambling). Fintech feel (Revolut/Cash App), not trading terminal or crypto platform.

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian meets Fintech
- **Decoration level:** Intentional — subtle grain texture on dark surfaces, glowing accent colors on interactive elements. No decorative blobs, gradients, or ornamental elements.
- **Mood:** Energetic and alive. Like checking a live sports score. The app pulses with activity — real-time pool updates, countdown timers ticking, numbers animating.
- **Anti-patterns:** No purple gradients, no 3-column icon grids, no centered-everything layouts, no decorative blobs, no generic hero sections. Every visual element earns its pixels.

## Typography
- **Display/Hero:** Satoshi (Black 900, Bold 700) — geometric, modern. The payout number "$87.50" in 48px Satoshi Black is the hero element.
- **Body:** DM Sans (400, 500, 600, 700) — clean, readable, pairs well with Arabic
- **UI/Labels:** DM Sans 500
- **Data/Tables:** DM Sans with `font-variant-numeric: tabular-nums` — numbers align perfectly in columns
- **Arabic:** Noto Sans Arabic (400, 500, 600, 700) — the standard for Arabic web typography
- **Code:** JetBrains Mono (if needed for admin)
- **Loading:** Google Fonts / Bunny Fonts CDN. Satoshi via Fontshare.
- **Scale:**
  - xs: 11px / 0.6875rem
  - sm: 12px / 0.75rem
  - base: 14px / 0.875rem
  - md: 16px / 1rem
  - lg: 20px / 1.25rem
  - xl: 24px / 1.5rem
  - 2xl: 32px / 2rem
  - 3xl: 42px / 2.625rem
  - hero: 48px / 3rem

## Color

### Light Mode (default)
- **Approach:** Soft neutral canvas with vivid accents. Blue and Red are the only accent colors. Light mode is the default for new users; dark mode is opt-in via the in-app toggle.

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | #F5F5F7 | Page background |
| `--surface` | #FFFFFF | Cards, panels, bottom sheets |
| `--elevated` | #F0F0F2 | Hover states, active surfaces |
| `--border` | #D4D4D8 | Borders, dividers |
| `--text` | #09090B | Primary text, headings |
| `--muted` | #71717A | Secondary text, labels, metadata |
| `--dim` | #A1A1AA | Placeholder text, disabled states |
| `--yes` | #1D6FE8 | YES bets (deeper for white bg contrast) |
| `--no` | #E03131 | NO bets (deeper red for white bg contrast) |
| `--success` | #16A34A | Win notifications |
| `--error` | #E03131 | Errors (same as no) |
| `--warning` | #D97706 | Caution states, pending actions |
| `--info` | #1D6FE8 | Informational (same as yes) |

### Dark Mode
- **Approach:** Near-black canvas with electric accents for high contrast and low eye strain. Same semantic tokens, different hex values.

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | #0A0B0E | Page background (near-black) |
| `--surface` | #161618 | Cards, panels, bottom sheets |
| `--elevated` | #222226 | Hover states, active surfaces |
| `--border` | #2E2E36 | Borders, dividers |
| `--text` | #EDEDF0 | Primary text, headings |
| `--muted` | #8A8A98 | Secondary text, labels, metadata |
| `--dim` | #3A3A42 | Placeholder text, disabled states |
| `--yes` | #2D8CFF | YES bets, positive actions, active nav, primary CTAs |
| `--no` | #FF4757 | NO bets, sell actions, destructive states |
| `--success` | #34D399 | Win notifications, deposits confirmed |
| `--error` | #FF4757 | Insufficient balance, failures (same as no) |
| `--warning` | #FBBF24 | Caution states, pending actions |
| `--info` | #2D8CFF | Informational alerts (same as yes) |

### Theme Strategy
- Default: **light mode** (`<html data-theme="light">` on SSR; matches the manifest `theme_color` + `background_color` of `#F5F5F7`)
- User preference saved to localStorage (`theme = "light" | "dark" | "system"`); toggling opts into dark, which persists
- `system` explicitly respects `prefers-color-scheme` with a live listener
- On app install as PWA, Android Chrome address bar tracks the theme via a dynamic `<meta name="theme-color">` update in `ThemeProvider.applyTheme`
- All colors via CSS custom properties — zero hardcoded colors in components

### Accent Usage Rules
- Blue (`--yes`) for: YES bets, primary CTAs, active navigation, links, info alerts
- Red (`--no`) for: NO bets, sell actions, destructive confirmations
- Never use both accents in the same component (creates visual noise)
- Glowing accent borders: interactive elements get `box-shadow: 0 0 16px rgba(accent, 0.15)` on hover/active

## Spacing
- **Base unit:** 4px
- **Density:** Compact — fintech apps are data-dense, not spacious
- **Scale:**

| Token | Value | Usage |
|-------|-------|-------|
| 2xs | 2px | Tight gaps, icon margins |
| xs | 4px | Inline element spacing |
| sm | 8px | Within-component padding |
| md | 16px | Component padding, card padding |
| lg | 24px | Section gaps, card margins |
| xl | 32px | Between sections |
| 2xl | 48px | Page-level vertical rhythm |
| 3xl | 64px | Major section breaks |

## Layout
- **Approach:** Grid-disciplined
- **Grid:** Single column on mobile (375px), two-column on tablet (768px+), three-column on desktop (1024px+)
- **Max content width:** 1200px (centered)
- **Border radius:**

| Token | Value | Usage |
|-------|-------|-------|
| sm | 4px | Small elements, badges |
| md | 8px | Buttons, inputs, cards |
| lg | 12px | Market cards, modals |
| full | 9999px | Pills, balance chips, avatars |

- **Cards:** Only for market items and wallet transaction items (they ARE the interaction). No decorative card grids.
- **Mobile navigation:** Bottom nav bar with 4 items (Markets, Portfolio, Wallet, Profile)
- **Desktop navigation:** Top nav bar (no bottom nav)

## Motion
- **Approach:** Intentional — motion creates the "alive" feeling
- **Easing:** enter: ease-out, exit: ease-in, move: ease-in-out
- **Duration:** micro: 50-100ms, short: 150-250ms, medium: 250-400ms, long: 400-700ms
- **Specific animations:**
  - Pool bar: animate width on bet placement (300ms ease-out)
  - Payout numbers: odometer animation when values change (400ms)
  - Countdown timers: gentle pulse every second (opacity 0.8 → 1.0)
  - Bet placement success: confetti burst (600ms)
  - Market card entrance: fade-up on scroll (250ms, staggered 50ms)
  - Activity feed: new items slide in from right (200ms)
  - Balance update: number tick animation (300ms)

## Interaction Patterns
- **Bet confirmation:** Swipe-to-confirm gesture (like Cash App's swipe-to-pay). Prevents accidental bets on a real-money platform.
- **Preset amounts:** +$1, +$5, +$10, +$100, Max as additive quick-add buttons. Custom amount input available.
- **Language toggle:** Accessible from every screen. Browser language detection on first visit.
- **RTL:** Full right-to-left layout for Arabic. Numbers remain LTR. Currency symbols on left. Mirror the entire layout.

## Interaction States
Every feature must specify all states:

| Feature | Loading | Empty | Error | Success | Partial |
|---------|---------|-------|-------|---------|---------|
| Markets list | Skeleton cards (pulsing) | "No active markets. Check back soon." + countdown | "Couldn't load markets. Pull to refresh." | Markets displayed | N/A |
| Bet placement | "Placing your bet..." (spinner on button) | N/A | "Bet failed: [reason]" | Confetti + "You're in! Payout: $X if [side] wins" | N/A |
| Deposit | "Waiting for deposit..." (animated dots) | N/A | "Deposit failed. Contact support." | "Deposited! Balance: $X" | "Pending — waiting for confirmation" |
| Portfolio | Skeleton list | "No bets yet. Find a market you believe in." | "Couldn't load your bets." | Bets displayed | N/A |
| Activity feed | Skeleton lines | Simulated activity (first 48h) | Silent fail (hide feed) | Real-time updates | N/A |

## Accessibility
- **Touch targets:** 44px minimum height for all interactive elements
- **Color contrast:** All text meets WCAG AA (4.5:1 ratio) on both dark and light backgrounds
- **Keyboard navigation:** Tab through markets, Enter to select, Tab to amount, swipe/Enter to confirm
- **Screen readers:** Market cards announce question + current odds + bettor count
- **Focus indicators:** 2px ring in `--yes` color with 2px offset

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-23 | Electric Blue/Coral Red accents | Differentiate from every other prediction/stock app. Electrified, not muted. |
| 2026-03-24 | Pure black bg (#000000) | Maximum contrast for electric accent colors. OLED-friendly. |
| 2026-03-24 | Polymarket-style trade panel | Clean card layout with animated expand, additive presets, large $ display. |
| 2026-03-23 | Satoshi + DM Sans typography | Satoshi's geometry matches data-forward personality. DM Sans is clean and Arabic-adjacent. |
| 2026-03-23 | Swipe-to-confirm for bets | Real-money platform needs accident prevention. Cash App pattern. |
| 2026-03-23 | Dark mode default, light mode available | User requested both. Dark is default per brief. User toggle saved to localStorage. |
| 2026-03-23 | Odometer number animations | Creates the "alive" feeling. Unusual for fintech, common in gaming. Deliberate risk. |
| 2026-03-23 | Glowing accent borders on hover | Premium dark-UI feel. CSS only, zero performance cost. |
| 2026-03-23 | Compact spacing density | Fintech apps are data-dense. Users need information density, not whitespace. |
| 2026-03-23 | Browser language detection | Arabic/English default based on browser Accept-Language. Most respectful default. |
