# Arrange (Layout & Spacing)

Adapted from arrange. Use when composing or fixing layout.

## Assess

- Spacing on a scale (4, 8, 12, 16, 24, 32, 48…) — no random 13px gaps
- Related items grouped tight; sections separated generously
- Hierarchy via space and weight — not identical padding everywhere
- Monotonous identical card grids? Break the pattern.

## Rules

- Semantic spacing tokens (`--space-md`), not pixel-named variables
- `gap` over margin hacks for sibling spacing
- Left-aligned asymmetric layouts often feel more designed than center-everything
- `repeat(auto-fit, minmax(280px, 1fr))` for responsive card areas
- Container queries for component-level responsiveness

## Avoid

- Nesting cards inside cards
- Wrapping every element in a card container
- Body text wider than ~80ch without max-width
