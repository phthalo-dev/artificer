# Impeccable Craft

Adapted from impeccable. Core frontend design principles for distinctive, production-grade UI.

## Design context (read before designing)

1. Check the plan and workstream goal for audience, tone, and constraints.
2. Read `.impeccable.md` in the project root if it exists — it holds Design Context.
3. If context is missing, state assumptions explicitly in your output and keep changes reversible.

## Iron law

Commit to a **bold, intentional** aesthetic. Generic AI UI is a failure mode.

**AI slop test:** If someone said "AI made this," would they believe it immediately? If yes, redesign.

## Absolute bans (never use)

- **Side-stripe borders** — `border-left` or `border-right` > 1px as a colored accent on cards/alerts
- **Gradient text** — `background-clip: text` with gradient fills
- **AI palette** — cyan-on-dark, purple-blue gradients, neon glows on dark backgrounds
- **Template layouts** — identical card grids (icon + heading + text), hero metric templates, everything centered
- **Reflex fonts** — Inter, DM Sans, Outfit, Space Grotesk, Syne, Fraunces, IBM Plex family, etc.

## Typography

- Pair a distinctive display font with a refined body font — never one family for everything
- App UIs: fixed `rem` scale. Marketing pages: fluid `clamp()` on headings only
- 5-step scale with ≥1.25 ratio between steps; cap body at ~65–75ch
- Light text on dark: add 0.05–0.1 to line-height

## Color

- Use OKLCH, not HSL. Tint neutrals toward the brand hue (even chroma 0.005 helps)
- 60-30-10 visual weight: surfaces / secondary / accent — accents stay rare
- No pure #000 or #fff. No gray text on colored backgrounds — shade from the background hue
- Theme (light vs dark) from audience and viewing context — not a default

## Layout

- 4pt spacing scale with semantic tokens (`--space-sm`, not `--spacing-8`)
- Use `gap` for sibling spacing. Vary spacing for hierarchy — not equal padding everywhere
- `repeat(auto-fit, minmax(280px, 1fr))` for card grids; container queries for components
- Don't wrap everything in cards. Don't nest cards. Break the grid intentionally when it serves emphasis

## Motion & interaction

- Animate `transform` and `opacity` only — not width/height/padding/margin
- Ease-out (quart/quint/expo) for entrances; no bounce/elastic
- Progressive disclosure over showing everything at once
- Empty states should teach, not just say "nothing here"
