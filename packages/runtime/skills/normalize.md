# Normalize (Design System Alignment)

Adapted from normalize. Use when aligning UI to an existing design system.

## Process

1. **Discover the system** — grep for design tokens, component libraries, style guides, `tailwind.config`, CSS variables
2. **Map deviations** — hard-coded colors, one-off spacing, custom components that duplicate system ones
3. **Replace with tokens** — use existing primitives before inventing new ones
4. **Preserve UX** — consistency should improve usability, not just visuals

## Rules

- Reuse existing components over bespoke copies
- Match established patterns for forms, buttons, modals, empty states
- When no system exists, extract repeated values into tokens in the change — don't scatter magic numbers

## Scope

Normalize only what your task touches. Do not refactor unrelated pages.
