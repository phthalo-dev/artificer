# Typeset

Adapted from typeset. Use when implementing or refining typography.

## Assess before changing

- Font choices match brand voice — not Inter/Roboto/Syne defaults
- Hierarchy obvious at a glance (size + weight contrast)
- Consistent type scale — not arbitrary pixel sizes
- Body 16px+ where readable; line-length ~65–75ch

## Rules

- Display + body font pairing; max 2–3 families
- App UI: fixed `rem` steps. Marketing headings: `clamp()` for fluid scale
- Line-height inversely with line length; extra leading on light-on-dark
- No long passages in all-caps

## Implementation

Use project tokens/CSS variables when they exist. When adding fonts, load via the project's established pattern (`@font-face`, `next/font`, etc.). Verify contrast after changes.
